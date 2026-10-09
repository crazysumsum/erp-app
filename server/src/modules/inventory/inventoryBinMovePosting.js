import { inventoryError } from "./inventoryErrors.js";
import { inventoryPositiveInteger, validateInventoryCommandContext } from "./inventoryValidation.js";

const AUTHORIZATION = Object.freeze({ purpose: "bin_move.post", requiredCallerPermission: "inventory.operation" });
const PAYLOAD_FIELDS = new Set(["warehouseId", "reason", "lines"]);
const LINE_FIELDS = new Set(["sourceBalanceId", "destinationBinId", "quantity", "expectedSourceVersion", "expectedDestinationVersion"]);

function exactFields(value, fields, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !fields.has(key))) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
}
function id(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}
function normalize(payload) {
  exactFields(payload, PAYLOAD_FIELDS, "payload");
  const warehouseId = id(payload.warehouseId, "warehouseId");
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 100) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  }
  const reason = payload.reason === undefined ? "" : payload.reason;
  if (typeof reason !== "string" || /[\p{Cc}]/u.test(reason) || Buffer.byteLength(reason.trim(), "utf8") > 500) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reason" });
  }
  const lines = payload.lines.map(line => {
    exactFields(line, LINE_FIELDS, "lines");
    return { sourceBalanceId: id(line.sourceBalanceId, "sourceBalanceId"),
      destinationBinId: id(line.destinationBinId, "destinationBinId"),
      quantity: inventoryPositiveInteger(line.quantity),
      expectedSourceVersion: id(line.expectedSourceVersion, "expectedSourceVersion"),
      expectedDestinationVersion: line.expectedDestinationVersion === null
        ? null : id(line.expectedDestinationVersion, "expectedDestinationVersion") };
  });
  return { warehouseId, reason: reason.trim(), lines };
}
function dimensions(row, binId = Number(row.bin_id)) {
  return { warehouseId: Number(row.warehouse_id), skuId: Number(row.sku_id), binId,
    lotId: row.lot_id === null ? null : Number(row.lot_id), stockStatus: row.stock_status };
}
function key(value) {
  return `${value.warehouseId}:${value.skuId}:${value.binId}:${value.lotId ?? 0}:${value.stockStatus}`;
}
function quantity(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw inventoryError("INVENTORY_QUANTITY_INVALID");
  return result;
}
function checkpoint(tx, point) { tx.checkpoint?.(point); }

// Internal implementation owned by InventoryPostingService; no alternate writer or transaction boundary.
export async function postBinMoveInTransaction(service, tx, command) {
  const context = validateInventoryCommandContext(tx, command, AUTHORIZATION);
  if (context.actor.userId === null) throw new TypeError("Bin Move requires a user actor");
  const payload = normalize(context.payload);
  const actor = await service.authorize(tx, { actorId: context.actor.userId,
    claimedRoles: context.actor.claimedRoles, claimedPermissions: context.actor.claimedPermissions });
  if (!actor?.permissions?.includes(AUTHORIZATION.requiredCallerPermission)) throw inventoryError("PERMISSION_STALE");
  const postedAt = service.time.nowMs();
  const actorLabel = actor.username || `user:${context.actor.userId}`;
  const claim = await service.operations.claim(tx, { commandType: "BIN_MOVE_POST", source: context.source,
    payload, actorUserId: context.actor.userId, actorLabel, requestId: context.correlationId,
    correlationId: context.correlationId, createdAt: postedAt });
  checkpoint(tx, "operation");
  if (claim.replay) return { status: claim.replay.resultSummary.status,
    operationId: Number(claim.replay.resultSummary.operationId),
    movementGroupId: claim.replay.resultSummary.movementGroupId,
    lineCount: Number(claim.replay.resultSummary.lineCount) };

  const sourceIds = [...new Set(payload.lines.map(line => line.sourceBalanceId))].sort((a, b) => a - b);
  // Discovery only: never lock a Balance before its Warehouse/Control/Bins/Lot.
  const [staged] = await tx.query(
    `SELECT b.*, l.normalized_lot_number FROM inventory_stock_balances b
      LEFT JOIN inventory_lots l ON l.id = b.lot_id
      WHERE b.id IN (${sourceIds.map(() => "?").join(", ")}) ORDER BY b.id`, sourceIds);
  const sources = new Map(staged.map(row => [Number(row.id), row]));
  const buckets = new Map();
  const expected = new Map();
  const outgoing = new Map();
  const incoming = new Map();
  const legs = new Map();
  const addBucket = (dimension, version) => {
    const bucketKey = key(dimension);
    if (expected.has(bucketKey) && expected.get(bucketKey) !== version) throw inventoryError("VERSION_CONFLICT");
    expected.set(bucketKey, version);
    buckets.set(bucketKey, dimension);
    legs.set(bucketKey, (legs.get(bucketKey) ?? 0) + 1);
    return bucketKey;
  };
  for (const line of payload.lines) {
    const source = sources.get(line.sourceBalanceId);
    if (!source) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    if (Number(source.warehouse_id) !== payload.warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
    if (Number(source.bin_id) === line.destinationBinId) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "destinationBinId" });
    const sourceKey = addBucket(dimensions(source), line.expectedSourceVersion);
    const destinationKey = addBucket(dimensions(source, line.destinationBinId), line.expectedDestinationVersion);
    outgoing.set(sourceKey, quantity((outgoing.get(sourceKey) ?? 0) + line.quantity));
    incoming.set(destinationKey, quantity((incoming.get(destinationKey) ?? 0) + line.quantity));
  }
  const locked = await service.locks.lockForCommand(tx, {
    warehouseIds: [payload.warehouseId],
    stockControls: [...new Set(staged.map(row => Number(row.sku_id)))].map(skuId => ({ warehouseId: payload.warehouseId, skuId })),
    binIds: [...buckets.values()].map(value => value.binId),
    lots: staged.filter(row => row.lot_id !== null).map(row => ({ skuId: Number(row.sku_id), normalizedLotNumber: row.normalized_lot_number })),
    now: postedAt
  });
  const warehouse = locked.warehouses.find(row => Number(row.id) === payload.warehouseId);
  if (!warehouse || warehouse.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
  for (const bucket of buckets.values()) {
    const bin = locked.bins.find(row => Number(row.id) === bucket.binId);
    if (!bin || Number(bin.warehouse_id) !== payload.warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
    if (bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
    if (!locked.stockControls.some(row => Number(row.warehouse_id) === payload.warehouseId && Number(row.sku_id) === bucket.skuId)) {
      throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    }
    if (bucket.lotId !== null && !locked.lots.some(row => Number(row.id) === bucket.lotId && Number(row.sku_id) === bucket.skuId)) {
      throw inventoryError("LOT_DATA_CONFLICT");
    }
  }
  if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
  const profiles = new Map();
  for (const skuId of [...new Set(staged.map(row => Number(row.sku_id)))].sort((a, b) => a - b)) {
    const profile = await service.itemLookup.getInventoryProfileInTransaction(tx, skuId);
    if (!profile) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
    if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
    if (!profile.usable) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
    profiles.set(skuId, profile);
  }
  const ordered = [...buckets.values()].sort((a, b) => a.warehouseId - b.warehouseId || a.skuId - b.skuId ||
    a.binId - b.binId || (a.lotId ?? 0) - (b.lotId ?? 0) || (a.stockStatus < b.stockStatus ? -1 : a.stockStatus > b.stockStatus ? 1 : 0));
  // Current locking read under Control distinguishes absent destinations from upserted zero rows.
  const [existing] = await tx.query(
    `SELECT * FROM inventory_stock_balances WHERE ${ordered.map(() =>
      "(warehouse_id = ? AND sku_id = ? AND bin_id = ? AND lot_scope = ? AND stock_status = ?)").join(" OR ")}
      ORDER BY warehouse_id, sku_id, bin_id, lot_scope, stock_status FOR UPDATE`,
    ordered.flatMap(row => [row.warehouseId, row.skuId, row.binId, row.lotId ?? 0, row.stockStatus]));
  const original = new Map(existing.map(row => [key(dimensions(row)), row]));
  for (const stagedSource of staged) {
    const current = original.get(key(dimensions(stagedSource)));
    if (!current || Number(current.id) !== Number(stagedSource.id)) throw inventoryError("VERSION_CONFLICT");
  }
  for (const [bucketKey, version] of expected) {
    const row = original.get(bucketKey);
    if (version === null ? Boolean(row) : !row || Number(row.version) !== version) throw inventoryError("VERSION_CONFLICT");
    const onHand = quantity(row?.on_hand_quantity ?? 0);
    const allocated = quantity(row?.allocated_quantity ?? 0);
    if ((outgoing.get(bucketKey) ?? 0) > onHand - allocated) throw inventoryError("INSUFFICIENT_STOCK");
    quantity(onHand + (incoming.get(bucketKey) ?? 0));
    if (Number(row?.version ?? 1) + legs.get(bucketKey) > 4_294_967_295) throw inventoryError("CONCURRENT_OPERATION");
  }
  const balances = await service.locks.lockBalancesAfterLot(tx, { balances: ordered, now: postedAt });
  const current = new Map(balances.map(row => [key(dimensions(row)), { ...row }]));
  const movementGroupId = service.createMovementGroupId();
  for (const line of payload.lines) {
    const source = sources.get(line.sourceBalanceId);
    const profile = profiles.get(Number(source.sku_id));
    const lot = locked.lots.find(row => Number(row.id) === Number(source.lot_id));
    for (const [dimension, direction] of [[dimensions(source), "OUT"], [dimensions(source, line.destinationBinId), "IN"]]) {
      const row = current.get(key(dimension));
      if (!row) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const before = quantity(row.on_hand_quantity);
      const after = quantity(before + (direction === "IN" ? line.quantity : -line.quantity));
      const version = Number(row.version);
      const fifoAnchor = after === 0 ? null : before === 0 ? service.time.fileDate() : row.fifo_anchor_date;
      const [updated] = await tx.execute(`UPDATE inventory_stock_balances
        SET on_hand_quantity = ?, fifo_anchor_date = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`, [after, fifoAnchor, postedAt, Number(row.id), version]);
      if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      checkpoint(tx, "current_state");
      const bin = locked.bins.find(value => Number(value.id) === dimension.binId);
      const [movement] = await tx.execute(`INSERT INTO inventory_movements
        (movement_group_id, operation_request_id, movement_type, location_kind,
         warehouse_id, bin_id, sku_id, lot_id, stock_status, direction, quantity,
         balance_before, balance_after, balance_version_after, reservation_id, allocation_id,
         transfer_id, transfer_line_id, stocktake_id, stocktake_line_id, reversal_of_movement_id,
         reason_category, reason_text, sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot,
         bin_code_snapshot, lot_number_snapshot, expiry_date_snapshot, posted_at, posted_by, posted_by_label)
        VALUES (?, ?, 'BIN_MOVE', 'BIN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [movementGroupId, claim.operationId, dimension.warehouseId, dimension.binId, dimension.skuId,
        dimension.lotId, dimension.stockStatus, direction, line.quantity, before, after, version + 1,
        payload.reason, profile.skuCode, profile.skuName, warehouse.warehouse_code, bin.bin_code,
        lot?.lot_number ?? "", lot?.expiry_date ?? null, postedAt, context.actor.userId, actorLabel]);
      checkpoint(tx, "movement");
      await service.audit.recordSucceeded(tx, { actorUserId: context.actor.userId, actorLabel,
        action: "bin_move.post", targetType: "movement_group", targetId: Number(movement.insertId), targetLabel: movementGroupId,
        reasonText: payload.reason, beforeSummary: { balanceId: Number(row.id), onHandQuantity: before, version },
        afterSummary: { balanceId: Number(row.id), onHandQuantity: after, version: version + 1,
          allocatedQuantity: quantity(row.allocated_quantity), baseQuantity: line.quantity, baseUomId: profile.baseUom.uomId,
          movementId: Number(movement.insertId), operationId: claim.operationId, movementGroupId,
          skuId: dimension.skuId, lotId: dimension.lotId, stockStatus: dimension.stockStatus },
        operationRequestId: claim.operationId, requestId: context.correlationId, correlationId: context.correlationId, ip: "" });
      checkpoint(tx, "audit");
      row.on_hand_quantity = after;
      row.version = version + 1;
      row.fifo_anchor_date = fifoAnchor;
    }
  }
  const result = { status: "POSTED", operationId: claim.operationId, movementGroupId, lineCount: payload.lines.length };
  await service.operations.complete(tx, { operationId: claim.operationId, resultType: "MOVEMENT_GROUP",
    resultId: movementGroupId, resultSummary: result, completedAt: postedAt });
  return result;
}

import { INVENTORY_ADJUSTMENT_REASON_CATEGORIES } from "./inventoryConstants.js";
import { inventoryError } from "./inventoryErrors.js";
import { consumeInventoryHighRiskContext } from "./inventoryHighRiskContext.js";
import { calculateInventoryAvailability, inventoryPositiveInteger, isInventoryLotExpired, meetsMinimumRemainingLife,
  toBaseQuantity, validateInventoryCommandContext, validateInventoryLotInput, validateInventoryStockStatus } from "./inventoryValidation.js";

const COMMON = ["quantity", "uomId", "reasonText"];
const IN_FIELDS = new Set([...COMMON, "direction", "warehouseId", "binId", "skuId", "stockStatus",
  "expectedBalanceVersion", "reasonCategory", "lotNumber", "expiryDate", "manufactureDate"]);
const OUT_FIELDS = new Set([...COMMON, "direction", "balanceId", "expectedBalanceVersion", "reasonCategory"]);
const STATUS_FIELDS = new Set([...COMMON, "sourceBalanceId", "destinationStatus", "expectedSourceVersion", "expectedDestinationVersion"]);

function id(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}
function version(value, field, nullable = false) {
  if (nullable && value === null) return null;
  if (id(value, field) > 4_294_967_295) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}

export function normalizeAdjustmentCommand(tx, command, action) {
  if (!["adjustment.post", "status_transfer.post"].includes(action)) throw inventoryError("INVENTORY_INPUT_INVALID");
  const context = validateInventoryCommandContext(tx, command, { purpose: action, requiredCallerPermission: "inventory.adjust" });
  if (context.actor.userId === null) throw inventoryError("PERMISSION_STALE");
  const source = context.payload;
  const status = action === "status_transfer.post";
  if (!status && !["IN", "OUT"].includes(source.direction)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "direction" });
  const fields = status ? STATUS_FIELDS : source.direction === "IN" ? IN_FIELDS : OUT_FIELDS;
  if (Object.keys(source).some(field => !fields.has(field))) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "payload" });
  const reasonText = typeof source.reasonText === "string" ? source.reasonText.trim() : "";
  if (!reasonText || Buffer.byteLength(reasonText, "utf8") > 500 || /[\p{Cc}]/u.test(reasonText) ||
    (!status && source.reasonCategory === "OTHER" && [...reasonText].filter(char => !/\s/u.test(char)).length < 10)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reasonText" });
  }
  const payload = { quantity: inventoryPositiveInteger(source.quantity), uomId: id(source.uomId, "uomId"), reasonText };
  if (status) {
    Object.assign(payload, { sourceBalanceId: id(source.sourceBalanceId, "sourceBalanceId"),
      destinationStatus: validateInventoryStockStatus(source.destinationStatus),
      expectedSourceVersion: version(source.expectedSourceVersion, "expectedSourceVersion"),
      expectedDestinationVersion: version(source.expectedDestinationVersion, "expectedDestinationVersion", true) });
  } else {
    if (!INVENTORY_ADJUSTMENT_REASON_CATEGORIES.includes(source.reasonCategory)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reasonCategory" });
    }
    Object.assign(payload, { direction: source.direction, reasonCategory: source.reasonCategory,
      expectedBalanceVersion: version(source.expectedBalanceVersion, "expectedBalanceVersion", source.direction === "IN") });
    if (source.direction === "OUT") payload.balanceId = id(source.balanceId, "balanceId");
    else {
      Object.assign(payload, { warehouseId: id(source.warehouseId, "warehouseId"), binId: id(source.binId, "binId"),
        skuId: id(source.skuId, "skuId"), stockStatus: validateInventoryStockStatus(source.stockStatus) });
      if (source.lotNumber !== undefined) {
        if (typeof source.lotNumber !== "string" || !source.lotNumber.trim() || [...source.lotNumber.trim()].length > 100 || /[\p{Cc}]/u.test(source.lotNumber)) {
          throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lotNumber" });
        }
        payload.lotNumber = source.lotNumber.trim();
      }
      for (const field of ["expiryDate", "manufactureDate"]) {
        if (source[field] === undefined) continue;
        const value = source[field];
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
          !Number.isFinite(Date.parse(value + "T00:00:00.000Z")) || new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) !== value) {
          throw inventoryError("INVENTORY_INPUT_INVALID", { field });
        }
        payload[field] = value;
      }
    }
  }
  return { ...context, payload };
}

function dimension(row, stockStatus = row.stock_status) {
  return { warehouseId: Number(row.warehouse_id), skuId: Number(row.sku_id), binId: Number(row.bin_id),
    lotId: row.lot_id === null ? null : Number(row.lot_id), stockStatus };
}
function sameBucket(row, value) {
  return Number(row.warehouse_id) === value.warehouseId && Number(row.sku_id) === value.skuId &&
    Number(row.bin_id) === value.binId && (row.lot_id === null ? null : Number(row.lot_id)) === value.lotId && row.stock_status === value.stockStatus;
}
function quantity(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw inventoryError("INVENTORY_QUANTITY_INVALID");
  return result;
}
function assertProfile(profile) {
  if (!profile) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
  if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
  if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
  if (!profile.usable) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
}
function resultFromSummary(summary) {
  return { status: summary.status, operationId: Number(summary.operationId), movementGroupId: summary.movementGroupId,
    lineCount: Number(summary.lineCount), inputQuantity: Number(summary.inputQuantity),
    inputUom: { id: Number(summary.inputUomId), code: summary.inputUomCode }, baseQuantity: Number(summary.baseQuantity),
    baseUom: { id: Number(summary.baseUomId), code: summary.baseUomCode } };
}

// InventoryPostingService remains the transaction owner for these two single-operation commands.
export async function postAdjustmentInTransaction(service, tx, command, context, action) {
  const normalized = normalizeAdjustmentCommand(tx, command, action);
  const guard = consumeInventoryHighRiskContext(context, normalized);
  try {
    return await post(service, tx, normalized, guard, action);
  } catch (error) {
    if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.cause?.code ?? error?.code)) throw inventoryError("CONCURRENT_OPERATION");
    throw error;
  }
}

async function post(service, tx, command, guard, action) {
  const { payload, actor: requestedActor, source, correlationId } = command;
  const statusTransfer = action === "status_transfer.post";
  const positive = !statusTransfer && payload.direction === "IN";
  let actor = await guard.check(tx);
  const startedAt = service.time.nowMs();
  const commandType = statusTransfer ? "STATUS_TRANSFER_POST" : "ADJUSTMENT_POST";
  // Non-null user FKs would acquire implicit security locks before stock waits.
  const claim = await service.operations.claim(tx, { commandType,
    source, payload, actorUserId: null, actorLabel: actor.username || `user:${requestedActor.userId}`,
    requestId: correlationId, correlationId, createdAt: startedAt });
  tx.checkpoint?.("operation");
  if (claim.replay) {
    await guard.check(tx, { locking: true });
    return resultFromSummary(claim.replay.resultSummary);
  }
  let staged;
  if (!positive) {
    const [rows] = await tx.query(`SELECT b.*, l.normalized_lot_number FROM inventory_stock_balances b
      LEFT JOIN inventory_lots l ON l.id = b.lot_id WHERE b.id = ?`, [statusTransfer ? payload.sourceBalanceId : payload.balanceId]);
    staged = rows[0];
    if (!staged) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
  }
  const warehouseId = positive ? payload.warehouseId : Number(staged.warehouse_id);
  const skuId = positive ? payload.skuId : Number(staged.sku_id);
  const binId = positive ? payload.binId : Number(staged.bin_id);
  const initialProfile = await service.itemLookup.getInventoryProfileInTransaction(tx, skuId);
  assertProfile(initialProfile);
  const lotInput = positive ? validateInventoryLotInput({ trackingPolicy: initialProfile.trackingPolicy,
    lotNumber: payload.lotNumber, expiryDate: payload.expiryDate, manufactureDate: payload.manufactureDate }) : null;
  const lotNumber = positive ? lotInput.normalizedLotNumber : staged.normalized_lot_number;
  const locked = await service.locks.lockForCommand(tx, { warehouseIds: [warehouseId], stockControls: [{ warehouseId, skuId }],
    binIds: [binId], lots: lotNumber ? [{ skuId, normalizedLotNumber: lotNumber }] : [], now: startedAt });
  const warehouse = locked.warehouses.find(row => Number(row.id) === warehouseId);
  const bin = locked.bins.find(row => Number(row.id) === binId);
  const control = locked.stockControls.find(row => Number(row.warehouse_id) === warehouseId && Number(row.sku_id) === skuId);
  if (!warehouse || warehouse.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
  if (!bin || Number(bin.warehouse_id) !== warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
  if (bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
  if (!control) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
  const lotDate = service.time.fileDate();
  const createdLotIds = new Set();
  let lot = positive ? await service.resolveReceiptLotInTransaction(tx, locked.lots, {
    payload: { ...payload, skuId }, profile: initialProfile, lotInput, currentDate: lotDate,
    postedAt: service.time.nowMs(), actorUserId: null, createdLotIds
  }) : locked.lots.find(row => Number(row.id) === Number(staged.lot_id));
  if (!positive && lot) {
    const [rows] = await tx.query(`SELECT id, sku_id, lot_number, normalized_lot_number,
      DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
      DATE_FORMAT(manufacture_date, '%Y-%m-%d') AS manufacture_date
      FROM inventory_lots WHERE id = ? FOR UPDATE`, [Number(lot.id)]);
    [lot] = rows;
  }
  if (!positive && staged.lot_id !== null && (!lot || Number(lot.sku_id) !== skuId)) throw inventoryError("LOT_DATA_CONFLICT");
  const target = positive ? { warehouseId, skuId, binId, lotId: lot?.id === undefined ? null : Number(lot.id), stockStatus: payload.stockStatus }
    : dimension(staged);
  if (statusTransfer && target.stockStatus === payload.destinationStatus) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "destinationStatus" });
  const dimensions = statusTransfer ? [target, { ...target, stockStatus: payload.destinationStatus }] : [target];
  const ordered = [...dimensions].sort((a, b) => a.stockStatus < b.stockStatus ? -1 : a.stockStatus > b.stockStatus ? 1 : 0);
  const [original] = await tx.query(`SELECT id, warehouse_id, sku_id, bin_id, lot_id, lot_scope, stock_status, version,
    DATE_FORMAT(fifo_anchor_date, '%Y-%m-%d') AS fifo_anchor_date FROM inventory_stock_balances WHERE ${ordered.map(() =>
    "(warehouse_id = ? AND sku_id = ? AND bin_id = ? AND lot_scope = ? AND stock_status = ?)").join(" OR ")}
    ORDER BY warehouse_id, sku_id, bin_id, lot_scope, stock_status FOR UPDATE`,
  ordered.flatMap(value => [warehouseId, skuId, binId, value.lotId ?? 0, value.stockStatus]));
  for (const [index, value] of dimensions.entries()) {
    const row = original.find(row => sameBucket(row, value));
    const expected = statusTransfer ? index === 0 ? payload.expectedSourceVersion : payload.expectedDestinationVersion : payload.expectedBalanceVersion;
    if (expected === null ? Boolean(row) : !row || Number(row.version) !== expected) throw inventoryError("VERSION_CONFLICT");
    if (!positive && index === 0 && Number(row.id) !== Number(staged.id)) throw inventoryError("VERSION_CONFLICT");
  }
  const balances = await service.locks.lockBalancesAfterLot(tx, { balances: ordered, now: service.time.nowMs() });
  // Only existing Item-owned SELECTs run through this current-read executor; no Item rules or SQL are copied.
  const profile = await service.itemLookup.getInventoryProfileInTransaction(tx, skuId);
  assertProfile(profile);
  for (const field of ["skuId", "skuCode", "skuName", "skuStatus", "itemStatus", "inventoryTracked", "trackingPolicy",
    "minimumReceiptLifeDays", "minimumSaleLifeDays"]) {
    if (profile[field] !== initialProfile[field]) throw inventoryError("CONCURRENT_OPERATION");
  }
  if (profile.baseUom.uomId !== initialProfile.baseUom.uomId || profile.baseUom.uomCode !== initialProfile.baseUom.uomCode) {
    throw inventoryError("CONCURRENT_OPERATION");
  }
  const uom = await service.itemLookup.resolveUomInTransaction(tx, skuId, payload.uomId);
  if (!uom) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "uomId" });
  const baseQuantity = toBaseQuantity(payload.quantity, uom.toBaseFactor);
  const date = service.time.fileDate();
  if (positive) {
    if (date !== lotDate) throw inventoryError("CONCURRENT_OPERATION");
    if (isInventoryLotExpired(lot?.expiry_date ?? null, date)) throw inventoryError("LOT_EXPIRED");
    if (!meetsMinimumRemainingLife(lot?.expiry_date ?? null, date, profile.minimumReceiptLifeDays ?? 0)) throw inventoryError("LOT_MINIMUM_LIFE_FAILED");
  }
  const legs = dimensions.map((value, index) => {
    const row = balances.find(row => sameBucket(row, value));
    if (!row) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    const direction = positive || (statusTransfer && index === 1) ? "IN" : "OUT";
    const before = quantity(row.on_hand_quantity), allocated = quantity(row.allocated_quantity);
    if (allocated > before || (direction === "OUT" && baseQuantity > before - allocated)) throw inventoryError("INSUFFICIENT_STOCK");
    const after = quantity(before + (direction === "IN" ? baseQuantity : -baseQuantity));
    const version = Number(row.version);
    if (!Number.isSafeInteger(version) || version < 1 || version >= 4_294_967_295) throw inventoryError("CONCURRENT_OPERATION");
    return { value, row, direction, before, after, version, allocated };
  });
  if (!positive) {
    const [available] = await tx.query(`SELECT b.*, DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS expiry_date FROM inventory_stock_balances b
      LEFT JOIN inventory_lots l ON l.id = b.lot_id
      WHERE b.warehouse_id = ? AND b.sku_id = ? AND b.stock_status = 'AVAILABLE'
      ORDER BY b.warehouse_id, b.sku_id, b.bin_id, b.lot_scope, b.stock_status FOR SHARE`, [warehouseId, skuId]);
    let before = 0, after = 0;
    for (const row of available) {
      if (!meetsMinimumRemainingLife(row.expiry_date ?? null, date, profile.minimumSaleLifeDays ?? 0)) continue;
      before = quantity(before + quantity(row.on_hand_quantity));
      const leg = legs.find(leg => Number(leg.row.id) === Number(row.id));
      after = quantity(after + (leg ? leg.after : quantity(row.on_hand_quantity)));
    }
    const reserved = quantity(control.reserved_quantity);
    if (calculateInventoryAvailability({ eligibleOnHand: after, reserved }).uncoveredReserved >
        calculateInventoryAvailability({ eligibleOnHand: before, reserved }).uncoveredReserved) throw inventoryError("INSUFFICIENT_ATP");
  }
  actor = await guard.check(tx, { locking: true });
  if (service.time.fileDate() !== date) throw inventoryError("CONCURRENT_OPERATION");
  const [bound] = await tx.execute(`UPDATE inventory_operation_requests SET actor_user_id = ?
    WHERE id = ? AND command_type = ? AND actor_user_id IS NULL AND completed_at IS NULL`,
  [actor.id, claim.operationId, commandType]);
  if (Number(bound.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
  if (lot && createdLotIds.has(Number(lot.id))) {
    const [creator] = await tx.execute(`UPDATE inventory_lots SET created_by = ?
      WHERE id = ? AND sku_id = ? AND created_by IS NULL`, [actor.id, Number(lot.id), skuId]);
    if (Number(creator.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
  }
  guard.assertTime();
  const actorLabel = actor.username || `user:${requestedActor.userId}`;
  const postedAt = service.time.nowMs(), movementGroupId = service.createMovementGroupId();
  for (const { value, row, direction, before, after, version, allocated } of legs) {
    const anchor = after === 0 ? null : before === 0 ? date : original.find(value => Number(value.id) === Number(row.id)).fifo_anchor_date;
    const [updated] = await tx.execute(`UPDATE inventory_stock_balances
      SET on_hand_quantity = ?, fifo_anchor_date = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`, [after, anchor, postedAt, Number(row.id), version]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    tx.checkpoint?.("current_state");
    const [movement] = await tx.execute(`INSERT INTO inventory_movements
      (movement_group_id, operation_request_id, movement_type, location_kind, warehouse_id, bin_id, sku_id, lot_id,
       stock_status, direction, quantity, balance_before, balance_after, balance_version_after, reservation_id, allocation_id,
       transfer_id, transfer_line_id, stocktake_id, stocktake_line_id, reversal_of_movement_id, reason_category, reason_text,
       sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot, lot_number_snapshot,
       expiry_date_snapshot, posted_at, posted_by, posted_by_label)
      VALUES (?, ?, ?, 'BIN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [movementGroupId, claim.operationId, statusTransfer ? "STATUS_TRANSFER" : "ADJUSTMENT", warehouseId, binId, skuId,
      value.lotId, value.stockStatus, direction, baseQuantity, before, after, version + 1, payload.reasonCategory ?? "",
      payload.reasonText, profile.skuCode, profile.skuName, warehouse.warehouse_code, bin.bin_code,
      lot?.lot_number ?? "", lot?.expiry_date ?? null, postedAt, requestedActor.userId, actorLabel]);
    tx.checkpoint?.("movement");
    await service.audit.recordSucceeded(tx, { actorUserId: requestedActor.userId, actorLabel, action,
      targetType: "movement_group", targetId: Number(movement.insertId), targetLabel: movementGroupId,
      reasonCategory: payload.reasonCategory ?? "", reasonText: payload.reasonText,
      beforeSummary: { balanceId: Number(row.id), onHandQuantity: before, version },
      afterSummary: { balanceId: Number(row.id), onHandQuantity: after, allocatedQuantity: allocated, version: version + 1,
        movementId: Number(movement.insertId), operationId: claim.operationId, movementGroupId,
        inputQuantity: payload.quantity, inputUomId: payload.uomId, baseQuantity, baseUomId: profile.baseUom.uomId, ...guard.audit },
      operationRequestId: claim.operationId, requestId: correlationId, correlationId, ip: "" });
    tx.checkpoint?.("audit");
  }
  const summary = { status: "POSTED", operationId: claim.operationId, movementGroupId, lineCount: legs.length,
    inputQuantity: payload.quantity, inputUomId: payload.uomId, inputUomCode: uom.uomCode, baseQuantity,
    baseUomId: profile.baseUom.uomId, baseUomCode: profile.baseUom.uomCode };
  guard.assertTime();
  await service.operations.complete(tx, { operationId: claim.operationId, resultType: "MOVEMENT_GROUP",
    resultId: movementGroupId, resultSummary: summary, completedAt: service.time.nowMs() });
  guard.assertTime();
  return resultFromSummary(summary);
}

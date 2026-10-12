import { inventoryError } from "./inventoryErrors.js";
import { consumeInventoryHighRiskContext } from "./inventoryHighRiskContext.js";
import { calculateInventoryAvailability, meetsMinimumRemainingLife, validateInventoryCommandContext,
  validateInventoryLotInput } from "./inventoryValidation.js";

const PAYLOAD_FIELDS = new Set(["movementId", "reasonText", "expectedBalances"]);
const BALANCE_FIELDS = new Set(["balanceId", "expectedVersion"]);

function id(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}

export function normalizeReversalCommand(tx, command) {
  const context = validateInventoryCommandContext(tx, command, { purpose: "movement.reverse", requiredCallerPermission: "inventory.adjust" });
  if (context.actor.userId === null) throw inventoryError("PERMISSION_STALE");
  const source = context.payload;
  if (Object.keys(source).some(field => !PAYLOAD_FIELDS.has(field))) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "payload" });
  const reasonText = typeof source.reasonText === "string" ? source.reasonText.trim() : "";
  if (!reasonText || Buffer.byteLength(reasonText, "utf8") > 500 || /[\p{Cc}]/u.test(reasonText)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reasonText" });
  }
  if (!Array.isArray(source.expectedBalances) || source.expectedBalances.length < 1 || source.expectedBalances.length > 200) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "expectedBalances" });
  }
  const seen = new Set();
  const expectedBalances = source.expectedBalances.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(field => !BALANCE_FIELDS.has(field))) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "expectedBalances" });
    }
    const balanceId = id(row.balanceId, "balanceId"), expectedVersion = id(row.expectedVersion, "expectedVersion");
    if (expectedVersion > 4_294_967_295 || seen.has(balanceId)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "expectedBalances" });
    seen.add(balanceId);
    return { balanceId, expectedVersion };
  }).sort((a, b) => a.balanceId - b.balanceId);
  return { ...context, payload: { movementId: id(source.movementId, "movementId"), reasonText, expectedBalances } };
}

const ORIGINAL_COMMANDS = Object.freeze({ RECEIPT: "RECEIPT_POST", ISSUE: "ISSUE_POST", BIN_MOVE: "BIN_MOVE_POST",
  STATUS_TRANSFER: "STATUS_TRANSFER_POST", ADJUSTMENT: "ADJUSTMENT_POST" });
const GROUP_SELECT = `SELECT m.*, DATE_FORMAT(m.expiry_date_snapshot, '%Y-%m-%d') AS expiry_date_snapshot
  FROM inventory_movements m WHERE movement_group_id = ? ORDER BY id LIMIT 201`;

function denied() { return inventoryError("REVERSAL_NOT_ALLOWED"); }
function quantity(value) {
  const result = Number(value);
  if (value === null || !Number.isSafeInteger(result) || result < 0) throw denied();
  return result;
}
function dimension(row) {
  return { warehouseId: Number(row.warehouse_id), skuId: Number(row.sku_id), binId: Number(row.bin_id),
    lotId: row.lot_id === null ? null : Number(row.lot_id), stockStatus: row.stock_status };
}
function key(row) {
  return `${row.warehouse_id}:${row.sku_id}:${row.bin_id}:${row.lot_id ?? 0}:${row.stock_status}`;
}
function assertOriginal(rows, groupId, selectedId) {
  if (rows.length < 1 || rows.length > 200 || !rows.some(row => Number(row.id) === selectedId)) throw denied();
  const first = rows[0];
  if (!Object.hasOwn(ORIGINAL_COMMANDS, first.movement_type)) throw inventoryError("MOVEMENT_TYPE_NOT_REVERSIBLE");
  for (const row of rows) {
    if (row.location_kind !== "BIN") throw inventoryError("MOVEMENT_TYPE_NOT_REVERSIBLE");
    if (row.movement_group_id !== groupId || row.movement_type !== first.movement_type ||
        Number(row.operation_request_id) !== Number(first.operation_request_id) || row.reversal_of_movement_id !== null ||
        [row.transfer_id, row.transfer_line_id, row.stocktake_id, row.stocktake_line_id].some(value => value !== null) ||
        !["IN", "OUT"].includes(row.direction) || !["AVAILABLE", "QUARANTINED", "DAMAGED"].includes(row.stock_status)) throw denied();
    for (const value of [row.id, row.operation_request_id, row.warehouse_id, row.sku_id, row.bin_id,
      ...(row.lot_id === null ? [] : [row.lot_id]), row.balance_version_after]) {
      if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw denied();
    }
    const amount = quantity(row.quantity), before = quantity(row.balance_before), after = quantity(row.balance_after);
    if (amount === 0 || after !== before + (row.direction === "IN" ? amount : -amount) ||
        Number(row.balance_version_after) > 4_294_967_295) throw denied();
  }
}
function assertCompletedGroup(operation, rows) {
  const first = rows[0];
  if (!operation || Number(operation.id) !== Number(first.operation_request_id) || operation.completed_at === null ||
      operation.completed_at === undefined || operation.result_type !== "MOVEMENT_GROUP" ||
      operation.result_id !== first.movement_group_id || operation.command_type !== ORIGINAL_COMMANDS[first.movement_type]) throw denied();
  let summary;
  try { summary = typeof operation.result_summary === "string" ? JSON.parse(operation.result_summary) : operation.result_summary; }
  catch { throw denied(); }
  if (!summary || summary.status !== "POSTED" || Number(summary.operationId) !== Number(operation.id) ||
      summary.movementGroupId !== first.movement_group_id) throw denied();
  const type = first.movement_type;
  const count = type === "RECEIPT" ? 1 : type === "ISSUE" ? Number(summary.rowCount)
    : Number(summary.lineCount) * (type === "BIN_MOVE" ? 2 : 1);
  if (!Number.isSafeInteger(count) || count !== rows.length ||
      (type === "RECEIPT" && (Number(summary.movementId) !== Number(first.id) || first.direction !== "IN")) ||
      (type === "ADJUSTMENT" && count !== 1) || (type === "STATUS_TRANSFER" && count !== 2) ||
      (type === "ISSUE" && rows.some(row => row.direction !== "OUT"))) throw denied();
  if (!["BIN_MOVE", "STATUS_TRANSFER"].includes(type)) return;
  for (let index = 0; index < rows.length; index += 2) {
    const out = rows[index], incoming = rows[index + 1];
    if (!incoming || out.direction !== "OUT" || incoming.direction !== "IN" ||
        ["warehouse_id", "sku_id", "lot_id", "quantity"].some(field => out[field] !== incoming[field]) ||
        (type === "BIN_MOVE" ? out.stock_status !== incoming.stock_status || out.bin_id === incoming.bin_id
          : out.bin_id !== incoming.bin_id || out.stock_status === incoming.stock_status)) throw denied();
  }
}
function groupIdentity(rows) {
  return JSON.stringify(rows.map(row => [row.id, row.operation_request_id, row.movement_group_id, row.movement_type,
    row.location_kind, key(row), row.direction, row.quantity, row.balance_before, row.balance_after, row.balance_version_after,
    row.reversal_of_movement_id, row.expiry_date_snapshot, row.transfer_id, row.transfer_line_id, row.stocktake_id, row.stocktake_line_id]));
}
function replayResult(summary) {
  return { status: summary.status, operationId: Number(summary.operationId), movementGroupId: summary.movementGroupId,
    lineCount: Number(summary.lineCount) };
}

// The Posting owner supplies the sole transaction; no workflow state or original ledger is rewritten.
export async function reverseMovementInTransaction(service, tx, command, context) {
  const normalized = normalizeReversalCommand(tx, command);
  const guard = consumeInventoryHighRiskContext(context, normalized);
  try { return await post(service, tx, normalized, guard); }
  catch (error) {
    if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.cause?.code ?? error?.code)) throw inventoryError("CONCURRENT_OPERATION");
    throw error;
  }
}

async function post(service, tx, command, guard) {
  const { payload, actor: requestedActor, source, correlationId } = command;
  let actor = await guard.check(tx);
  const startedAt = service.time.nowMs();
  const claim = await service.operations.claim(tx, { commandType: "MOVEMENT_REVERSE", source, payload, actorUserId: null,
    actorLabel: actor.username || `user:${requestedActor.userId}`, requestId: correlationId, correlationId, createdAt: startedAt });
  tx.checkpoint?.("operation");
  if (claim.replay) {
    await guard.check(tx, { locking: true });
    return replayResult(claim.replay.resultSummary);
  }
  const [[anchor]] = await tx.query("SELECT movement_group_id FROM inventory_movements WHERE id = ?", [payload.movementId]);
  if (!anchor) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
  const groupId = anchor.movement_group_id;
  const [discovered] = await tx.query(GROUP_SELECT, [groupId]);
  assertOriginal(discovered, groupId, payload.movementId);
  const buckets = [...new Map(discovered.map(row => [key(row), dimension(row)])).values()]
    .sort((a, b) => a.warehouseId - b.warehouseId || a.skuId - b.skuId || a.binId - b.binId ||
      (a.lotId ?? 0) - (b.lotId ?? 0) || (a.stockStatus < b.stockStatus ? -1 : a.stockStatus > b.stockStatus ? 1 : 0));
  const controls = [...new Map(buckets.map(row => [`${row.warehouseId}:${row.skuId}`, { warehouseId: row.warehouseId, skuId: row.skuId }])).values()];
  const lotIds = [...new Set(buckets.flatMap(row => row.lotId === null ? [] : [row.lotId]))];
  const [discoveredLots] = lotIds.length ? await tx.query(`SELECT id, sku_id, normalized_lot_number FROM inventory_lots
    WHERE id IN (${lotIds.map(() => "?").join(", ")})`, lotIds) : [[]];
  if (discoveredLots.length !== lotIds.length) throw denied();
  const locked = await service.locks.lockForCommand(tx, { warehouseIds: buckets.map(row => row.warehouseId), stockControls: controls,
    binIds: buckets.map(row => row.binId), lots: discoveredLots.map(row => ({ skuId: Number(row.sku_id), normalizedLotNumber: row.normalized_lot_number })), now: startedAt });
  if (locked.binLocks.length) throw denied();
  for (const bucket of buckets) {
    const warehouse = locked.warehouses.find(row => Number(row.id) === bucket.warehouseId);
    const bin = locked.bins.find(row => Number(row.id) === bucket.binId);
    if (warehouse?.status !== "ACTIVE" || bin?.status !== "ACTIVE" || Number(bin.warehouse_id) !== bucket.warehouseId ||
        !locked.stockControls.some(row => Number(row.warehouse_id) === bucket.warehouseId && Number(row.sku_id) === bucket.skuId)) throw denied();
  }
  const [lots] = lotIds.length ? await tx.query(`SELECT id, sku_id, lot_number, normalized_lot_number,
    DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date, DATE_FORMAT(manufacture_date, '%Y-%m-%d') AS manufacture_date,
    DATE_FORMAT(first_receipt_date, '%Y-%m-%d') AS first_receipt_date FROM inventory_lots
    WHERE id IN (${lotIds.map(() => "?").join(", ")}) ORDER BY sku_id, normalized_lot_number FOR UPDATE`, lotIds) : [[]];
  if (lots.length !== lotIds.length || lots.some(row => !discoveredLots.some(original => Number(original.id) === Number(row.id) &&
      Number(original.sku_id) === Number(row.sku_id) && original.normalized_lot_number === row.normalized_lot_number))) throw denied();
  // Do not call lockBalancesAfterLot: absent historical buckets must fail, never be recreated.
  const [balances] = await tx.query(`SELECT id, warehouse_id, bin_id, sku_id, lot_id, stock_status,
    on_hand_quantity, allocated_quantity, version, DATE_FORMAT(fifo_anchor_date, '%Y-%m-%d') AS fifo_anchor_date
    FROM inventory_stock_balances WHERE ${buckets.map(() =>
    "(warehouse_id = ? AND sku_id = ? AND bin_id = ? AND lot_scope = ? AND stock_status = ?)").join(" OR ")}
    ORDER BY warehouse_id, sku_id, bin_id, lot_scope, stock_status FOR UPDATE`,
  buckets.flatMap(row => [row.warehouseId, row.skuId, row.binId, row.lotId ?? 0, row.stockStatus]));
  if (balances.length !== buckets.length) throw denied();
  const expected = new Map(payload.expectedBalances.map(row => [row.balanceId, row.expectedVersion]));
  if (expected.size !== balances.length || balances.some(row => !expected.has(Number(row.id)))) throw denied();
  // Current reads, only after stock locks. Never decide once-only from the discovery RR snapshot.
  // Source: https://dev.mysql.com/doc/refman/26.7/en/innodb-locking-reads.html
  const [[operation]] = await tx.query(`SELECT id, command_type, result_type, result_id, result_summary, completed_at
    FROM inventory_operation_requests WHERE id = ? FOR UPDATE`, [Number(discovered[0].operation_request_id)]);
  const [originals] = await tx.query(GROUP_SELECT + " FOR UPDATE", [groupId]);
  assertOriginal(originals, groupId, payload.movementId);
  if (groupIdentity(originals) !== groupIdentity(discovered)) throw denied();
  assertCompletedGroup(operation, originals);
  const [reversals] = await tx.query(`SELECT id FROM inventory_movements
    WHERE reversal_of_movement_id IN (${originals.map(() => "?").join(", ")}) ORDER BY reversal_of_movement_id FOR UPDATE`,
  originals.map(row => Number(row.id)));
  if (reversals.length) throw inventoryError("MOVEMENT_ALREADY_REVERSED");
  for (const row of balances) if (expected.get(Number(row.id)) !== Number(row.version)) throw inventoryError("VERSION_CONFLICT");
  const profiles = new Map();
  const currentItem = { query: (sql, params) => tx.query(sql + " FOR SHARE", params) };
  for (const skuId of [...new Set(buckets.map(row => row.skuId))].sort((a, b) => a - b)) {
    const profile = await service.itemLookup.getInventoryProfileInTransaction(currentItem, skuId);
    if (!profile || Number(profile.skuId) !== skuId || !profile.inventoryTracked || !profile.usable ||
        !["none", "batch", "batch_expiry"].includes(profile.trackingPolicy)) throw denied();
    profiles.set(skuId, profile);
  }
  const byLot = new Map(lots.map(row => [Number(row.id), row]));
  const working = new Map(balances.map(row => [key(row), { ...row }]));
  for (const row of originals) {
    const lot = byLot.get(Number(row.lot_id)), profile = profiles.get(Number(row.sku_id));
    if (row.lot_id !== null && (!lot || Number(lot.sku_id) !== Number(row.sku_id) || lot.expiry_date !== row.expiry_date_snapshot)) throw denied();
    try { validateInventoryLotInput({ trackingPolicy: profile.trackingPolicy, lotNumber: lot?.lot_number,
      expiryDate: lot?.expiry_date, manufactureDate: lot?.manufacture_date }); }
    catch { throw denied(); }
    if (!working.has(key(row))) throw denied();
  }
  const outgoing = new Map();
  for (const row of originals) if (row.direction === "IN") outgoing.set(key(row), quantity((outgoing.get(key(row)) ?? 0) + quantity(row.quantity)));
  for (const row of balances) {
    const onHand = quantity(row.on_hand_quantity), allocated = quantity(row.allocated_quantity);
    if (allocated > onHand || (outgoing.get(key(row)) ?? 0) > onHand - allocated) throw denied();
  }
  const date = service.time.fileDate();
  const legs = [];
  for (const original of [...originals].reverse()) {
    const row = working.get(key(original)), before = quantity(row.on_hand_quantity), version = Number(row.version);
    const direction = original.direction === "IN" ? "OUT" : "IN", amount = quantity(original.quantity);
    const after = quantity(before + (direction === "IN" ? amount : -amount));
    if (after < quantity(row.allocated_quantity) || !Number.isSafeInteger(version) || version < 1 || version >= 4_294_967_295) throw denied();
    const fifoAnchor = after === 0 ? null : before === 0 ? date : row.fifo_anchor_date;
    legs.push({ original, row, direction, amount, before, after, version, fifoAnchor });
    row.on_hand_quantity = after; row.version = version + 1; row.fifo_anchor_date = fifoAnchor;
  }
  for (const scope of controls) {
    const profile = profiles.get(scope.skuId);
    const [available] = await tx.query(`SELECT b.id, b.on_hand_quantity, DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS expiry_date
      FROM inventory_stock_balances b LEFT JOIN inventory_lots l ON l.id = b.lot_id
      WHERE b.warehouse_id = ? AND b.sku_id = ? AND b.stock_status = 'AVAILABLE'
      ORDER BY b.warehouse_id, b.sku_id, b.bin_id, b.lot_scope, b.stock_status FOR SHARE`, [scope.warehouseId, scope.skuId]);
    let before = 0, after = 0;
    for (const row of available) {
      if (!meetsMinimumRemainingLife(row.expiry_date ?? null, date, profile.minimumSaleLifeDays ?? 0)) continue;
      before = quantity(before + quantity(row.on_hand_quantity));
      const changed = [...working.values()].find(value => Number(value.id) === Number(row.id));
      after = quantity(after + quantity(changed ? changed.on_hand_quantity : row.on_hand_quantity));
    }
    const control = locked.stockControls.find(row => Number(row.warehouse_id) === scope.warehouseId && Number(row.sku_id) === scope.skuId);
    const reserved = quantity(control.reserved_quantity);
    if (calculateInventoryAvailability({ eligibleOnHand: after, reserved }).uncoveredReserved >
        calculateInventoryAvailability({ eligibleOnHand: before, reserved }).uncoveredReserved) throw denied();
  }
  actor = await guard.check(tx, { locking: true });
  if (date !== service.time.fileDate()) throw inventoryError("CONCURRENT_OPERATION");
  const [bound] = await tx.execute(`UPDATE inventory_operation_requests SET actor_user_id = ?
    WHERE id = ? AND command_type = ? AND actor_user_id IS NULL AND completed_at IS NULL`, [actor.id, claim.operationId, "MOVEMENT_REVERSE"]);
  if (Number(bound.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
  guard.assertTime();
  const actorLabel = actor.username || `user:${requestedActor.userId}`, postedAt = service.time.nowMs(), movementGroupId = service.createMovementGroupId();
  for (const { original, row, direction, amount, before, after, version, fifoAnchor } of legs) {
    const [updated] = await tx.execute(`UPDATE inventory_stock_balances
      SET on_hand_quantity = ?, fifo_anchor_date = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`, [after, fifoAnchor, postedAt, Number(row.id), version]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    tx.checkpoint?.("current_state");
    const warehouse = locked.warehouses.find(value => Number(value.id) === Number(row.warehouse_id));
    const bin = locked.bins.find(value => Number(value.id) === Number(row.bin_id));
    const profile = profiles.get(Number(row.sku_id)), lot = byLot.get(Number(row.lot_id));
    let movement;
    try {
      [movement] = await tx.execute(`INSERT INTO inventory_movements
        (movement_group_id, operation_request_id, movement_type, location_kind, warehouse_id, bin_id, sku_id, lot_id,
         stock_status, direction, quantity, balance_before, balance_after, balance_version_after, reservation_id, allocation_id,
         transfer_id, transfer_line_id, stocktake_id, stocktake_line_id, reversal_of_movement_id, reason_category, reason_text,
         sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot, lot_number_snapshot,
         expiry_date_snapshot, posted_at, posted_by, posted_by_label)
        VALUES (?, ?, 'REVERSAL', 'BIN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [movementGroupId, claim.operationId, Number(row.warehouse_id), Number(row.bin_id), Number(row.sku_id), row.lot_id === null ? null : Number(row.lot_id),
        row.stock_status, direction, amount, before, after, version + 1, Number(original.id), payload.reasonText,
        profile.skuCode, profile.skuName, warehouse.warehouse_code, bin.bin_code, lot?.lot_number ?? "", lot?.expiry_date ?? null, postedAt, actor.id, actorLabel]);
    } catch (error) {
      const native = error?.cause ?? error;
      if (native.code === "ER_DUP_ENTRY" && /for key ['`](?:inventory_movements\.)?uq_inventory_movement_reversal['`]/u.test(native.sqlMessage ?? "")) {
        throw inventoryError("MOVEMENT_ALREADY_REVERSED");
      }
      throw error;
    }
    tx.checkpoint?.("movement");
    await service.audit.recordSucceeded(tx, { actorUserId: actor.id, actorLabel, action: "movement.reverse",
      targetType: "movement_group", targetId: Number(movement.insertId), targetLabel: movementGroupId, reasonText: payload.reasonText,
      beforeSummary: { balanceId: Number(row.id), onHandQuantity: before, version, movementId: Number(original.id),
        operationId: Number(operation.id), movementGroupId: groupId },
      afterSummary: { balanceId: Number(row.id), onHandQuantity: after, allocatedQuantity: quantity(row.allocated_quantity), version: version + 1,
        movementId: Number(movement.insertId), operationId: claim.operationId, movementGroupId, skuId: Number(row.sku_id),
        lotId: row.lot_id === null ? null : Number(row.lot_id), stockStatus: row.stock_status, baseQuantity: amount,
        baseUomId: profile.baseUom.uomId, ...guard.audit },
      operationRequestId: claim.operationId, requestId: correlationId, correlationId, ip: "" });
    tx.checkpoint?.("audit");
  }
  const result = { status: "POSTED", operationId: claim.operationId, movementGroupId, lineCount: legs.length };
  guard.assertTime();
  await service.operations.complete(tx, { operationId: claim.operationId, resultType: "MOVEMENT_GROUP",
    resultId: movementGroupId, resultSummary: result, completedAt: service.time.nowMs() });
  guard.assertTime();
  return result;
}

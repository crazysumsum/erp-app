import { ItemLookupService } from "../item/ItemLookupService.js";
import { consumePurchaseReversalContext } from "./InventoryPurchaseContext.js";
import { normalizePurchaseReversal } from "./inventoryPurchaseValidation.js";
import { claimPurchaseReversal, completePurchaseReversal, readPurchaseReceipt } from "./inventoryPurchaseReceipts.js";
import { parseInventorySummary } from "./inventorySafeJson.js";
import { inventoryError } from "./inventoryErrors.js";
import { calculateInventoryAvailability, meetsMinimumRemainingLife, validateInventoryLotInput } from "./inventoryValidation.js";

const denied = () => inventoryError("REVERSAL_NOT_ALLOWED");
const key = row => JSON.stringify([Number(row.warehouse_id), Number(row.sku_id), Number(row.bin_id),
  row.lot_id === null ? null : Number(row.lot_id), row.stock_status]);
const ORIGINAL_FIELDS = new Set(["status", "sourceLineId", "operationId", "movementId", "movementGroupId", "baseQuantity",
  "rootOperationId", "skuId", "trackingPolicy", "baseUomId", "baseUomCode"]);
const ORIGINAL_SELECT = `SELECT m.*, DATE_FORMAT(m.expiry_date_snapshot, '%Y-%m-%d') AS expiry_date_snapshot,
  o.command_type, o.source_module, o.source_document_type, o.source_document_id, o.source_line_id, o.source_event_id,
  o.result_summary, o.completed_at FROM inventory_movements m
  JOIN inventory_operation_requests o ON o.id = m.operation_request_id`;

function number(value, minimum = 0) {
  const result = typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(result) || result < minimum) throw denied();
  return result;
}

function originalPolicy(row, line, command) {
  if (!row || number(row.id, 1) !== line.originalMovementId || row.command_type !== "PURCHASE_RECEIPT_LINE" ||
      row.source_module !== "PURCHASING_RECEIVING" || row.source_document_type !== "GOODS_RECEIPT" ||
      row.source_document_id !== command.goodsReceiptId || row.source_line_id !== line.originalSourceLineId ||
      row.completed_at == null || row.movement_type !== "RECEIPT" || row.direction !== "IN" || row.location_kind !== "BIN" ||
      row.reversal_of_movement_id !== null || [row.reservation_id, row.allocation_id, row.transfer_id, row.transfer_line_id,
        row.stocktake_id, row.stocktake_line_id].some(value => value !== null) ||
      !["AVAILABLE", "QUARANTINED", "DAMAGED"].includes(row.stock_status)) throw denied();
  let snapshot;
  try { snapshot = parseInventorySummary(row.result_summary, ORIGINAL_FIELDS, "Purchase original receipt"); }
  catch { throw denied(); }
  if (!snapshot || snapshot.status !== "POSTED" || snapshot.sourceLineId !== line.originalSourceLineId ||
      snapshot.operationId !== number(row.operation_request_id, 1) || snapshot.movementId !== line.originalMovementId ||
      snapshot.movementGroupId !== row.movement_group_id || snapshot.baseQuantity !== number(row.quantity, 1) ||
      snapshot.skuId !== number(row.sku_id, 1) || number(row.balance_after) !== number(row.balance_before) + number(row.quantity, 1) ||
      !["none", "batch", "batch_expiry"].includes(snapshot.trackingPolicy)) throw denied();
  number(snapshot.baseUomId, 1); number(row.warehouse_id, 1); number(row.bin_id, 1);
  if (row.lot_id !== null) number(row.lot_id, 1);
  return snapshot;
}

async function result(tx, command, batch) {
  const receipt = await readPurchaseReceipt(tx, { documentType: "GOODS_RECEIPT_REVERSAL", ...command.source },
    { locking: true, expectedBatch: batch });
  const byId = new Map(receipt.result.lines.map(line => [line.sourceLineId, line]));
  return { ...receipt.result, lines: command.lines.map(line => byId.get(line.sourceLineId)) };
}

// All source claims precede stock locks; only the consumer owns commit/rollback.
export async function reversePurchaseReceiptBatchInTransaction(service, tx, input) {
  const command = normalizePurchaseReversal(input), guard = consumePurchaseReversalContext(tx, input.context, input, service.database);
  let actor = await guard.check();
  const batch = await claimPurchaseReversal(tx, { command, actorLabel: actor.username,
    requestId: service.database.context.get().requestId ?? "", timestamp: service.time.nowMs(), operations: service.operations });
  if (batch.replay) {
    await guard.check({ locking: true }); const replay = await result(tx, command, batch); guard.assertTime(); return replay;
  }
  if (guard.ownerStatus === "REVERSED") throw denied();
  const ids = command.lines.map(line => line.originalMovementId).sort((a, b) => a - b);
  const placeholders = ids.map(() => "?").join(",");
  const [discovered] = await tx.query(`${ORIGINAL_SELECT} WHERE m.id IN (${placeholders}) ORDER BY m.id`, ids);
  if (discovered.length !== ids.length) throw denied();
  for (const line of command.lines) originalPolicy(discovered.find(row => Number(row.id) === line.originalMovementId), line, command);
  const dimensions = [...new Map(discovered.map(row => [key(row), row])).values()];
  const lotIds = [...new Set(discovered.filter(row => row.lot_id !== null).map(row => number(row.lot_id, 1)))];
  const [discoveredLots] = lotIds.length ? await tx.query(`SELECT id,sku_id,normalized_lot_number FROM inventory_lots
    WHERE id IN (${lotIds.map(() => "?").join(",")})`, lotIds) : [[]];
  if (discoveredLots.length !== lotIds.length) throw denied();
  const scopes = [...new Map(discovered.map(row => [`${row.warehouse_id}:${row.sku_id}`,
    { warehouseId: number(row.warehouse_id, 1), skuId: number(row.sku_id, 1) }])).values()]
    .sort((a, b) => a.warehouseId - b.warehouseId || a.skuId - b.skuId);
  const locked = await service.locks.lockForCommand(tx, { warehouseIds: scopes.map(row => row.warehouseId), stockControls: scopes,
    binIds: dimensions.map(row => number(row.bin_id, 1)), lots: discoveredLots.map(row => ({
      skuId: number(row.sku_id, 1), normalizedLotNumber: row.normalized_lot_number })), now: batch.timestamp });
  if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
  for (const row of dimensions) {
    const warehouse = locked.warehouses.find(w => Number(w.id) === Number(row.warehouse_id));
    const bin = locked.bins.find(b => Number(b.id) === Number(row.bin_id));
    if (warehouse?.status !== "ACTIVE" || bin?.status !== "ACTIVE" || Number(bin.warehouse_id) !== Number(row.warehouse_id) ||
        !locked.stockControls.some(c => Number(c.warehouse_id) === Number(row.warehouse_id) && Number(c.sku_id) === Number(row.sku_id))) throw denied();
  }
  const [lots] = lotIds.length ? await tx.query(`SELECT id,sku_id,lot_number,normalized_lot_number,
    DATE_FORMAT(expiry_date,'%Y-%m-%d') AS expiry_date, DATE_FORMAT(manufacture_date,'%Y-%m-%d') AS manufacture_date
    FROM inventory_lots WHERE id IN (${lotIds.map(() => "?").join(",")}) ORDER BY sku_id,normalized_lot_number FOR UPDATE`, lotIds) : [[]];
  if (lots.length !== lotIds.length || lots.some(lot => !discoveredLots.some(old => Number(old.id) === Number(lot.id) &&
      Number(old.sku_id) === Number(lot.sku_id) && old.normalized_lot_number === lot.normalized_lot_number))) throw denied();
  // Historical buckets must already exist; do not upsert missing stock on reversal.
  const [balances] = await tx.query(`SELECT *, DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS fifo_anchor_date FROM inventory_stock_balances
    WHERE ${dimensions.map(() => "(warehouse_id=? AND sku_id=? AND bin_id=? AND lot_scope=? AND stock_status=?)").join(" OR ")}
    ORDER BY warehouse_id,sku_id,bin_id,lot_scope,stock_status FOR UPDATE`,
  dimensions.flatMap(row => [number(row.warehouse_id, 1), number(row.sku_id, 1), number(row.bin_id, 1), row.lot_id === null ? 0 : number(row.lot_id, 1), row.stock_status]));
  if (balances.length !== dimensions.length) throw denied();
  const [originals] = await tx.query(`${ORIGINAL_SELECT} WHERE m.id IN (${placeholders}) ORDER BY m.id FOR UPDATE OF m`, ids);
  if (originals.length !== ids.length) throw denied();
  const policies = new Map(), receipts = new Map();
  for (const line of command.lines) {
    const row = originals.find(m => Number(m.id) === line.originalMovementId), old = discovered.find(m => Number(m.id) === line.originalMovementId);
    const policy = originalPolicy(row, line, command);
    if (key(row) !== key(old) || row.movement_group_id !== old.movement_group_id || Number(row.quantity) !== Number(old.quantity) ||
        Number(row.operation_request_id) !== Number(old.operation_request_id)) throw denied();
    policies.set(line.originalMovementId, policy);
    if (!receipts.has(row.source_event_id)) receipts.set(row.source_event_id, await readPurchaseReceipt(tx,
      { documentType: "GOODS_RECEIPT", documentId: command.goodsReceiptId, eventId: row.source_event_id }, { locking: true }));
    const receiptLine = receipts.get(row.source_event_id).result?.lines.find(value => value.sourceLineId === line.originalSourceLineId);
    if (!receiptLine || receiptLine.movementId !== line.originalMovementId || receiptLine.baseQuantity !== number(row.quantity, 1)) throw denied();
  }
  const [links] = await tx.query(`SELECT original_movement_id,quantity FROM inventory_purchase_reversal_links
    WHERE original_movement_id IN (${placeholders}) ORDER BY original_movement_id,id FOR UPDATE`, ids);
  const totals = new Map();
  for (const link of links) totals.set(number(link.original_movement_id, 1), number((totals.get(number(link.original_movement_id, 1)) ?? 0) + number(link.quantity, 1)));
  const profiles = new Map(), lookup = new ItemLookupService({ database: service.database, logger: service.logger, time: service.time });
  for (const skuId of [...new Set(scopes.map(scope => scope.skuId))].sort((a, b) => a - b)) {
    const profile = await lookup.getInventoryProfileInTransaction(tx, skuId);
    if (!profile) throw denied(); profiles.set(skuId, profile);
  }
  const working = new Map(balances.map(row => [key(row), { ...row, on_hand_quantity: number(row.on_hand_quantity),
    allocated_quantity: number(row.allocated_quantity), version: number(row.version, 1) }]));
  const writes = [];
  for (const member of batch.members) {
    const line = member.line, original = originals.find(row => Number(row.id) === line.originalMovementId);
    if (line.baseQuantity > number(original.quantity, 1) - (totals.get(line.originalMovementId) ?? 0)) throw denied();
    const policy = policies.get(line.originalMovementId), lot = lots.find(row => Number(row.id) === Number(original.lot_id));
    if (original.lot_id !== null && (!lot || Number(lot.sku_id) !== Number(original.sku_id) || lot.expiry_date !== original.expiry_date_snapshot)) throw denied();
    try { validateInventoryLotInput({ trackingPolicy: policy.trackingPolicy, lotNumber: lot?.lot_number,
      expiryDate: lot?.expiry_date, manufactureDate: lot?.manufacture_date }); } catch { throw denied(); }
    const balance = working.get(key(original)); if (!balance) throw denied();
    const before = balance.on_hand_quantity, after = number(before - line.baseQuantity), version = balance.version;
    if (after < balance.allocated_quantity || version >= 4_294_967_295) throw denied();
    writes.push({ member, original, policy, balance, before, after, version });
    balance.on_hand_quantity = after; balance.version = version + 1;
  }
  const date = service.time.fileDate();
  for (const scope of scopes) {
    const profile = profiles.get(scope.skuId);
    const [available] = await tx.query(`SELECT b.id,b.lot_id,l.id AS observed_lot_id,b.on_hand_quantity,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry_date
      FROM inventory_stock_balances b LEFT JOIN inventory_lots l ON l.id=b.lot_id
      WHERE b.warehouse_id=? AND b.sku_id=? AND b.stock_status='AVAILABLE'
      ORDER BY b.warehouse_id,b.sku_id,b.bin_id,b.lot_scope,b.stock_status FOR SHARE OF b`, [scope.warehouseId, scope.skuId]);
    let before = 0, after = 0;
    for (const row of available) {
      // A Lot committed after this RR snapshot is not a no-expiry bucket; retry the whole original event.
      if (row.lot_id !== null && (row.observed_lot_id === null || number(row.lot_id, 1) !== number(row.observed_lot_id, 1))) {
        throw inventoryError("CONCURRENT_OPERATION");
      }
      if (!profile.usable || !profile.inventoryTracked || !meetsMinimumRemainingLife(row.expiry_date ?? null, date, profile.minimumSaleLifeDays ?? 0)) continue;
      const current = [...working.values()].find(value => Number(value.id) === Number(row.id));
      before = number(before + number(row.on_hand_quantity)); after = number(after + (current ? current.on_hand_quantity : number(row.on_hand_quantity)));
    }
    const control = locked.stockControls.find(row => Number(row.warehouse_id) === scope.warehouseId && Number(row.sku_id) === scope.skuId);
    const reserved = number(control.reserved_quantity);
    if (calculateInventoryAvailability({ eligibleOnHand: after, reserved }).uncoveredReserved >
        calculateInventoryAvailability({ eligibleOnHand: before, reserved }).uncoveredReserved) throw denied();
  }
  actor = await guard.check({ locking: true }); guard.assertTime();
  if (date !== service.time.fileDate()) throw inventoryError("CONCURRENT_OPERATION");
  const results = [];
  for (const write of writes) {
    guard.assertTime(); const { original, policy, balance, member, before, after, version } = write;
    const [updated] = await tx.execute(`UPDATE inventory_stock_balances SET on_hand_quantity=?,
      fifo_anchor_date=IF(?=0,NULL,fifo_anchor_date), version=?, updated_at=? WHERE id=? AND version=?`,
    [after, after, version + 1, batch.timestamp, number(balance.id, 1), version]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const movementGroupId = service.createMovementGroupId();
    const [movement] = await tx.execute(`INSERT INTO inventory_movements
      (movement_group_id,operation_request_id,movement_type,location_kind,warehouse_id,bin_id,sku_id,lot_id,stock_status,
       direction,quantity,balance_before,balance_after,balance_version_after,reason_text,sku_code_snapshot,sku_name_snapshot,
       warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,posted_at,posted_by,posted_by_label)
      VALUES(?,?,'REVERSAL','BIN',?,?,?,?,?,'OUT',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [movementGroupId, member.operationId, number(original.warehouse_id, 1), number(original.bin_id, 1), number(original.sku_id, 1),
      original.lot_id === null ? null : number(original.lot_id, 1), original.stock_status, member.line.baseQuantity,
      before, after, version + 1, command.reasonText, original.sku_code_snapshot, original.sku_name_snapshot,
      original.warehouse_code_snapshot, original.bin_code_snapshot, original.lot_number_snapshot, original.expiry_date_snapshot,
      batch.timestamp, actor.id, actor.username]);
    const movementId = number(movement.insertId, 1);
    await tx.execute(`INSERT INTO inventory_purchase_reversal_links
      (original_movement_id,reversal_movement_id,operation_request_id,quantity,created_at) VALUES(?,?,?,?,?)`,
    [member.line.originalMovementId, movementId, member.operationId, member.line.baseQuantity, batch.timestamp]);
    await service.audit.recordSucceeded(tx, { actorUserId: actor.id, actorLabel: actor.username, action: "movement.reverse",
      targetType: "movement_group", targetId: movementId, targetLabel: movementGroupId, reasonText: command.reasonText,
      beforeSummary: { balanceId: number(balance.id, 1), onHandQuantity: before, version, movementId: member.line.originalMovementId },
      afterSummary: { balanceId: number(balance.id, 1), onHandQuantity: after, allocatedQuantity: balance.allocated_quantity,
        version: version + 1, movementId, operationId: member.operationId, movementGroupId, skuId: number(original.sku_id, 1),
        lotId: original.lot_id === null ? null : number(original.lot_id, 1), stockStatus: original.stock_status,
        baseQuantity: member.line.baseQuantity, baseUomId: policy.baseUomId, ...guard.audit },
      operationRequestId: member.operationId, requestId: service.database.context.get().requestId ?? "",
      correlationId: command.correlationId, ip: service.database.context.get().clientIp ?? "" });
    results.push({ sourceLineId: member.sourceLineId, operationId: member.operationId, movementId, movementGroupId,
      baseQuantity: member.line.baseQuantity, originalMovementId: member.line.originalMovementId });
  }
  await completePurchaseReversal(tx, batch, results); guard.assertTime();
  const response = await result(tx, command, batch); guard.assertTime(); return response;
}

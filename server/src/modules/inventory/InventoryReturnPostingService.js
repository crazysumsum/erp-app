import { randomUUID } from "node:crypto";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService, inventoryOperationHash } from "./InventoryOperationService.js";
import { consumeInventoryReturnContext } from "./InventoryReturnContext.js";
import { lockInventoryCorrectionCosts, persistInventoryCostBatch, readInventoryCostInstallation } from "./inventoryCostLedger.js";
import { inboundCost, originalCostShare, outboundCost } from "./inventoryCostMath.js";
import { inventoryError } from "./inventoryErrors.js";
import { meetsMinimumRemainingLife } from "./inventoryValidation.js";

const variants = {
  customer: { type: "CUSTOMER_RETURN", from: "ISSUE", direction: "IN", action: "return.customer.post", commandType: "RETURN_CUSTOMER_POST" },
  supplier: { type: "SUPPLIER_RETURN", from: "RECEIPT", direction: "OUT", action: "return.supplier.post", commandType: "RETURN_SUPPLIER_POST" }
};
const bucket = (warehouse, bin, sku, lot, status) => JSON.stringify([String(warehouse), String(bin), String(sku),
  lot == null ? null : String(lot), status]);
const number = value => {
  const numeric = Number(value);
  if (value == null || !Number.isSafeInteger(numeric) || numeric < 0) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  return numeric;
};
const conflict = () => inventoryError("INVENTORY_SOURCE_CONFLICT");

export class InventoryReturnPostingService {
  constructor({ database, logger, time }) {
    Object.assign(this, { database, time,
      operations: new InventoryOperationService({ database }), locks: new InventoryLockService(),
      audit: new InventoryAuditService({ database, logger, time }), items: new ItemLookupService({ database, logger, time }) });
  }

  postCustomerReturnReceiptBatchInTransaction(tx, command, context) {
    return this.#post(tx, command, context, "customer");
  }

  postSupplierReturnIssueBatchInTransaction(tx, command, context) {
    return this.#post(tx, command, context, "supplier");
  }

  async #post(tx, command, context, kind) {
    const guard = consumeInventoryReturnContext(tx, context, command, { kind, database: this.database });
    let actor = await guard.check();
    const variant = variants[kind], at = this.time.nowMs();
    const request = this.database.context.get();
    const requestId = request.requestId ?? "";
    const source = { ...command.source, module: "RETURNS", documentType: variant.type };
    const sorted = command.lines.toSorted((a, b) => Number(a.sourceLineId) - Number(b.sourceLineId));
    const rootRequestHash = inventoryOperationHash({ commandType: variant.commandType, payload: sorted });
    const lines = [];
    for (const line of sorted) {
      const fact = guard.factFor(line.sourceLineId);
      const claim = await this.operations.claim(tx, { commandType: variant.commandType,
        source: { ...source, lineId: line.sourceLineId }, payload: { rootRequestHash, line, fact },
        actorUserId: actor.id, actorLabel: actor.username, requestId, correlationId: requestId, createdAt: at });
      lines.push({ ...line, fact, claim, stockStatus: kind === "customer" ? "QUARANTINED" : line.stockStatus });
    }
    const mode = Boolean(lines[0].claim.replay);
    if (lines.some(line => Boolean(line.claim.replay) !== mode)) throw conflict();
    if (mode) {
      await guard.check({ locking: true });
      return this.#result(command, lines.map(line => {
        const replay = line.claim.replay, summary = replay.resultSummary;
        if (replay.resultType !== variant.type || replay.resultId !== line.sourceLineId ||
            summary?.status !== "POSTED" || summary.sourceLineId !== line.sourceLineId ||
            !Number.isSafeInteger(summary.movementId) || summary.movementId < 1) throw conflict();
        return { sourceLineId: line.sourceLineId, movementId: String(summary.movementId) };
      }));
    }
    if (!await readInventoryCostInstallation(tx)) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    const lotIds = [...new Set(lines.map(line => line.fact.lotId).filter(value => value !== null))];
    const [lotKeys] = lotIds.length === 0 ? [[]] : await tx.query(`SELECT id,sku_id,normalized_lot_number
      FROM inventory_lots WHERE id IN (${lotIds.map(() => "?").join(",")})`, lotIds);
    if (lotKeys.length !== lotIds.length) throw conflict();
    const scopes = [...new Map(lines.map(line => {
      const { warehouseId, skuId } = line.fact;
      return [`${warehouseId}:${skuId}`, { warehouseId: Number(warehouseId), skuId: Number(skuId) }];
    })).values()];
    const locked = await this.locks.lockForCommand(tx, {
      warehouseIds: scopes.map(row => row.warehouseId), stockControls: scopes,
      binIds: lines.map(line => Number(line.binId)),
      lots: lotKeys.map(row => ({ skuId: Number(row.sku_id), normalizedLotNumber: row.normalized_lot_number })), now: at
    });
    if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
    const warehouses = new Map(locked.warehouses.map(warehouse => [String(warehouse.id), warehouse]));
    const bins = new Map(locked.bins.map(bin => [String(bin.id), bin]));
    for (const line of lines) {
      const warehouse = warehouses.get(line.fact.warehouseId), bin = bins.get(line.binId);
      if (warehouse?.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
      if (!bin || String(bin.warehouse_id) !== line.fact.warehouseId) throw inventoryError("INVENTORY_RETURN_WAREHOUSE_MISMATCH");
      if (bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
      if (line.fact.lotId !== null && !locked.lots.some(lot =>
        String(lot.id) === line.fact.lotId && String(lot.sku_id) === line.fact.skuId)) throw conflict();
    }
    const balances = await this.locks.lockBalancesAfterLot(tx, {
      balances: lines.map(line => ({ warehouseId: Number(line.fact.warehouseId), skuId: Number(line.fact.skuId),
        binId: Number(line.binId), lotId: line.fact.lotId === null ? null : Number(line.fact.lotId), stockStatus: line.stockStatus })), now: at
    });
    const originals = await this.#originals(tx, lines, variant);
    const plan = this.#planStock(lines, balances, kind);
    const day = this.time.fileDate();
    if (kind === "supplier") await this.#protectReservations(tx, scopes, locked.stockControls, plan.final, day);
    actor = await guard.check({ locking: true });
    const { basis: basisByMovement, pools: costPools } = await lockInventoryCorrectionCosts(
      tx, originals.map(row => ({ ...row, kind: variant.from })));
    for (const line of lines) {
      const basis = basisByMovement.get(line.originalMovementId), quantity = BigInt(line.baseQuantity);
      if (basis.used + quantity > basis.quantity) throw inventoryError("REVERSAL_NOT_ALLOWED");
      line.basis = { id: basis.id, share: originalCostShare(basis.value, basis.quantity, basis.used, quantity) };
      basis.used += quantity;
    }
    const workingCosts = new Map(), byOriginal = new Map(originals.map(row => [String(row.id), row]));
    const entries = [], results = [];
    for (const line of lines) {
      guard.assertTime();
      const skuId = line.fact.skuId, pool = workingCosts.get(skuId) ?? costPools.get(skuId);
      const quantity = BigInt(line.baseQuantity);
      if (kind === "supplier" && quantity > pool.quantity) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const changed = kind === "customer" ? inboundCost(pool, quantity, line.basis.share) : outboundCost(pool, quantity, line.basis.share);
      workingCosts.set(skuId, changed);
      const movementId = await this.#write(tx, { line, variant, original: byOriginal.get(line.originalMovementId),
        warehouse: warehouses.get(line.fact.warehouseId), bin: bins.get(line.binId), actor, at, day, requestId });
      entries.push({ ...changed, skuId, movementId, kind: variant.type,
        originalEntryId: line.basis.id, originalValue: line.basis.share, source: "ORIGINAL" });
      results.push({ sourceLineId: line.sourceLineId, movementId: String(movementId) });
    }
    await persistInventoryCostBatch(tx, costPools, entries, at);
    guard.assertTime();
    if (day !== this.time.fileDate()) throw inventoryError("CONCURRENT_OPERATION");
    return this.#result(command, results);
  }

  async #originals(tx, lines, variant) {
    const ids = [...new Set(lines.map(line => line.originalMovementId))].sort((a, b) => Number(a) - Number(b));
    const [originals] = await tx.query(`SELECT id,sku_id,lot_id,warehouse_id,movement_type,direction,location_kind,quantity,
      sku_code_snapshot,sku_name_snapshot,lot_number_snapshot,DATE_FORMAT(expiry_date_snapshot,'%Y-%m-%d') expiry_date_snapshot
      FROM inventory_movements WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, ids);
    const byId = new Map(originals.map(row => [String(row.id), row]));
    for (const line of lines) {
      const original = byId.get(line.originalMovementId), fact = line.fact;
      if (original?.movement_type !== variant.from || original.location_kind !== "BIN" ||
          original.direction === variant.direction || String(original.sku_id) !== fact.skuId ||
          String(original.warehouse_id) !== fact.warehouseId ||
          (original.lot_id === null ? null : String(original.lot_id)) !== fact.lotId || number(original.quantity) === 0) throw conflict();
    }
    return originals;
  }

  #planStock(lines, balances, kind) {
    const working = new Map(balances.map(row => [bucket(row.warehouse_id,row.bin_id,row.sku_id,row.lot_id,row.stock_status),
      { id: number(row.id), quantity: number(row.on_hand_quantity), allocated: number(row.allocated_quantity), version: number(row.version) }]));
    const final = new Map();
    for (const line of lines) {
      const state = working.get(bucket(line.fact.warehouseId,line.binId,line.fact.skuId,line.fact.lotId,line.stockStatus));
      if (!state) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const quantity = Number(line.baseQuantity), before = state.quantity;
      const after = kind === "customer" ? before + quantity : before - quantity;
      if (!Number.isSafeInteger(after) || after < state.allocated) throw inventoryError("INSUFFICIENT_STOCK");
      if (state.version >= 4294967295) throw inventoryError("VERSION_CONFLICT");
      line.stock = { id: state.id, before, after, version: state.version };
      state.quantity = after;
      state.version++;
      final.set(state.id, after);
    }
    return { final };
  }

  async #protectReservations(tx, scopes, stockControls, final, day) {
    const control = new Map(stockControls.map(row => [`${row.warehouse_id}:${row.sku_id}`, row]));
    for (const { warehouseId, skuId } of scopes) {
      const profile = await this.items.getInventoryProfileInTransaction(tx, skuId);
      if (!profile) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const [rows] = await tx.query(`SELECT b.id,b.lot_id,b.on_hand_quantity,l.id AS observed_lot_id,
        DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry_date FROM inventory_stock_balances b
        LEFT JOIN inventory_lots l ON l.id=b.lot_id WHERE b.warehouse_id=? AND b.sku_id=? AND b.stock_status='AVAILABLE'
        ORDER BY b.warehouse_id,b.sku_id,b.bin_id,b.lot_scope,b.stock_status FOR SHARE OF b`, [warehouseId, skuId]);
      let before = 0, after = 0;
      for (const row of rows) {
        if (row.lot_id !== null && String(row.lot_id) !== String(row.observed_lot_id)) throw inventoryError("CONCURRENT_OPERATION");
        if (!profile.usable || !profile.inventoryTracked ||
            !meetsMinimumRemainingLife(row.expiry_date, day, profile.minimumSaleLifeDays ?? 0)) continue;
        before += number(row.on_hand_quantity);
        after += final.get(number(row.id)) ?? number(row.on_hand_quantity);
      }
      const reserved = number(control.get(`${warehouseId}:${skuId}`)?.reserved_quantity);
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      if (Math.max(0, reserved - after) > Math.max(0, reserved - before)) throw inventoryError("REVERSAL_NOT_ALLOWED");
    }
  }

  async #write(tx, { line, variant, original, warehouse, bin, actor, at, day, requestId }) {
    const { id, before, after, version } = line.stock, movementGroupId = randomUUID();
    const [updated] = await tx.execute(`UPDATE inventory_stock_balances SET fifo_anchor_date=CASE
      WHEN ?=0 THEN NULL WHEN on_hand_quantity=0 THEN ? ELSE fifo_anchor_date END,
      on_hand_quantity=?,version=version+1,updated_at=? WHERE id=? AND version=? AND on_hand_quantity=?`,
    [after, day, after, at, id, version, before]);
    if (updated.affectedRows !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const [movement] = await tx.execute(`INSERT INTO inventory_movements (movement_group_id,operation_request_id,movement_type,location_kind,
      warehouse_id,bin_id,sku_id,lot_id,stock_status,direction,quantity,balance_before,balance_after,balance_version_after,
      sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,posted_at,posted_by,posted_by_label)
      VALUES(?,?,?,'BIN',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [movementGroupId,line.claim.operationId,variant.type,line.fact.warehouseId,line.binId,line.fact.skuId,line.fact.lotId,line.stockStatus,
      variant.direction,line.baseQuantity,before,after,version+1,original.sku_code_snapshot,original.sku_name_snapshot,warehouse.warehouse_code,
      bin.bin_code,original.lot_number_snapshot,original.expiry_date_snapshot,at,actor.id,actor.username]);
    const movementId = number(movement.insertId);
    if (movementId === 0) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    await this.audit.recordSucceeded(tx,{ actorUserId: actor.id, actorLabel: actor.username, action: variant.action, targetType: "movement_group",
      targetId: movementId, targetLabel: movementGroupId, beforeSummary: { balanceId: id, quantity: before, version },
      afterSummary: { balanceId: id, quantity: after, version: version+1, movementId }, operationRequestId: line.claim.operationId,
      requestId, correlationId: requestId });
    await this.operations.complete(tx,{ operationId: line.claim.operationId, resultType: variant.type, resultId: line.sourceLineId,
      resultSummary: { status: "POSTED", sourceLineId: line.sourceLineId, movementId }, completedAt: at });
    return movementId;
  }

  #result(command, results) {
    const byLine = new Map(results.map(line => [line.sourceLineId, line]));
    return { lines: command.lines.map(line => byLine.get(line.sourceLineId)) };
  }
}

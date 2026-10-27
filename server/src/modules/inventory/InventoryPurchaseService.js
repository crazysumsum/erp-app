import { ItemLookupService } from "../item/ItemLookupService.js";
import { authorizePurchaseLookup, consumePurchaseReceiptContext } from "./InventoryPurchaseContext.js";
import { normalizePurchaseReceipt } from "./inventoryPurchaseValidation.js";
import { claimPurchaseReceipt, completePurchaseReceipt, readPurchaseReceipt } from "./inventoryPurchaseReceipts.js";
import { inventoryError } from "./inventoryErrors.js";
import { reversePurchaseReceiptBatchInTransaction } from "./inventoryPurchaseReversal.js";
import { inventoryRemainingLifeDays, isInventoryLotExpired, validateInventoryLotInput } from "./inventoryValidation.js";

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const bucketKey = (warehouseId, skuId, binId, lotId, status) => JSON.stringify([warehouseId, skuId, binId, lotId, status]);
function number(value, field, minimum = 0) {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw inventoryError("INVENTORY_QUANTITY_INVALID", { field });
  return parsed;
}

function checkProfile(line, profile, date, actor) {
  if (!profile || profile.skuId !== line.skuId) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
  const bases = profile.uoms.filter(uom => uom.isBase), snapshot = line.commitment;
  if (bases.length !== 1) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  const drift = profile.warnings.length > 0 || profile.trackingPolicy !== snapshot.trackingPolicySnapshot ||
    bases[0].uomId !== snapshot.baseUomIdSnapshot || bases[0].uomCode !== snapshot.baseUomCodeSnapshot;
  if (drift && !snapshot.skuExceptionReason) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuExceptionReason" });
  if (line.expiryDate !== null && isInventoryLotExpired(line.expiryDate, date)) throw inventoryError("LOT_EXPIRED");
  const minimum = Math.max(snapshot.minimumReceiptLifeDaysSnapshot ?? 0,
    number(profile.minimumReceiptLifeDays ?? 0, "minimumReceiptLifeDays"));
  const actual = line.expiryDate === null ? null : inventoryRemainingLifeDays(line.expiryDate, date);
  const evidence = line.minimumLifeEvidence;
  if (actual !== null && actual < minimum) {
    if (!evidence) throw inventoryError("LOT_MINIMUM_LIFE_FAILED");
    if (!actor.permissions.includes("receiving.expiry.override")) throw inventoryError("PERMISSION_STALE");
    if (evidence.minimumLifeDaysApplied !== minimum || evidence.actualRemainingLifeDays !== actual) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "minimumLifeEvidence" });
    }
  } else if (evidence !== null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "minimumLifeEvidence" });
}

export class InventoryPurchaseService {
  constructor(options) {
    Object.assign(this, options);
  }

  reversePurchaseReceiptBatchInTransaction(tx, command) {
    return reversePurchaseReceiptBatchInTransaction(this, tx, command);
  }

  async findOperationsBySource(tx, query) {
    const check = await authorizePurchaseLookup(tx, this);
    const result = await readPurchaseReceipt(tx, query);
    check();
    return result;
  }

  async postPurchaseReceiptBatchInTransaction(tx, input) {
    const command = normalizePurchaseReceipt(input);
    const guard = consumePurchaseReceiptContext(tx, input.context, input, this.database);
    let actor = await guard.check();
    const batch = await claimPurchaseReceipt(tx, { command, actorLabel: actor.username,
      requestId: this.database.context.get().requestId ?? "", timestamp: this.time.nowMs(), operations: this.operations });
    if (batch.replay) {
      await guard.check({ locking: true });
      const result = await this.#result(tx, command, batch);
      guard.assertTime();
      return result;
    }
    const lines = batch.members.map(m => m.line);
    const locked = await this.locks.lockForCommand(tx, {
      warehouseIds: lines.map(line => line.warehouseId),
      stockControls: lines.map(({ warehouseId, skuId }) => ({ warehouseId, skuId })),
      binIds: lines.map(line => line.binId),
      lots: lines.filter(line => line.lotNumber !== null).map(line => ({ skuId: line.skuId, normalizedLotNumber: line.lotNumber })),
      now: batch.timestamp
    });
    const warehouses = new Map(locked.warehouses.map(row => [Number(row.id), row]));
    const bins = new Map(locked.bins.map(row => [Number(row.id), row]));
    for (const line of lines) {
      if (warehouses.get(line.warehouseId)?.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
      const bin = bins.get(line.binId);
      if (!bin || Number(bin.warehouse_id) !== line.warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
      if (bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
      if (!locked.stockControls.some(row => Number(row.warehouse_id) === line.warehouseId && Number(row.sku_id) === line.skuId)) {
        throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      }
    }
    if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
    const lookup = new ItemLookupService({ database: { query: (sql, params) => tx.query(`${sql} FOR SHARE`, params) },
      logger: this.logger, time: this.time });
    const skuIds = [...new Set(lines.map(line => line.skuId))].sort((a, b) => a - b), profiles = new Map();
    for (let offset = 0; offset < skuIds.length; offset += 100) {
      for (const [id, profile] of await lookup.findManyForCommittedReceipt(skuIds.slice(offset, offset + 100), { atMs: this.time.nowMs() })) {
        profiles.set(id, profile);
      }
    }
    for (const line of lines) checkProfile(line, profiles.get(line.skuId), this.time.fileDate(), actor);
    const lots = new Map();
    const lotLines = lines.filter(line => line.lotNumber !== null).sort((a, b) => a.skuId - b.skuId || compareText(a.lotNumber, b.lotNumber));
    for (const line of lotLines) {
      const key = JSON.stringify([line.skuId, line.lotNumber]);
      if (!lots.has(key)) lots.set(key, await this.resolveLot(tx, locked.lots, { payload: line, profile: profiles.get(line.skuId),
        lotInput: validateInventoryLotInput({ trackingPolicy: line.commitment.trackingPolicySnapshot,
          lotNumber: line.lotNumber, expiryDate: line.expiryDate, manufactureDate: line.manufactureDate }),
        currentDate: this.time.fileDate(), postedAt: batch.timestamp, actorUserId: command.actor.userId }));
    }
    const lotFor = line => line.lotNumber === null ? null : lots.get(JSON.stringify([line.skuId, line.lotNumber]));
    const dimensions = new Set();
    for (const line of lines) {
      const key = JSON.stringify([line.commitment.purchaseOrderId, line.commitment.purchaseOrderLineId,
        bucketKey(line.warehouseId, line.skuId, line.binId, lotFor(line)?.id ?? null, line.stockStatus)]);
      if (dimensions.has(key)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
      dimensions.add(key);
    }
    const balances = await this.locks.lockBalancesAfterLot(tx, { now: batch.timestamp,
      balances: lines.map(line => ({ warehouseId: line.warehouseId, skuId: line.skuId, binId: line.binId,
        lotId: lotFor(line) === null ? null : number(lotFor(line).id, "lotId", 1), stockStatus: line.stockStatus })) });
    actor = await guard.check({ locking: true });
    for (const line of lines) checkProfile(line, profiles.get(line.skuId), this.time.fileDate(), actor);
    const working = new Map(balances.map(row => [bucketKey(Number(row.warehouse_id), Number(row.sku_id), Number(row.bin_id),
      row.lot_id === null ? null : Number(row.lot_id), row.stock_status), {
      id: number(row.id, "balanceId", 1), quantity: number(row.on_hand_quantity, "onHandQuantity"),
      allocated: number(row.allocated_quantity, "allocatedQuantity"), version: number(row.version, "version", 1)
    }]));
    const writes = batch.members.map(member => {
      const line = member.line, lot = lotFor(line), lotId = lot === null ? null : number(lot.id, "lotId", 1);
      const balance = working.get(bucketKey(line.warehouseId, line.skuId, line.binId, lotId, line.stockStatus));
      if (!balance || balance.quantity < balance.allocated) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const before = balance.quantity, version = balance.version;
      balance.quantity = number(before + line.baseQuantity, "onHandQuantity");
      balance.version = number(version + 1, "version", 1);
      return { member, line, lot, lotId, balanceId: balance.id, allocated: balance.allocated, before, after: balance.quantity,
        version, nextVersion: balance.version };
    });
    const results = [];
    for (const write of writes) {
      guard.assertTime();
      results.push(await this.#write(tx, command, batch, write, profiles.get(write.line.skuId),
        warehouses.get(write.line.warehouseId), bins.get(write.line.binId), actor));
    }
    await completePurchaseReceipt(tx, batch, results);
    guard.assertTime();
    const result = await this.#result(tx, command, batch);
    guard.assertTime();
    return result;
  }

  async #result(tx, command, batch) {
    const decoded = await readPurchaseReceipt(tx, { documentType: "GOODS_RECEIPT", ...command.source },
      { locking: true, expectedBatch: batch });
    const byId = new Map(decoded.result.lines.map(line => [line.sourceLineId, line]));
    return { ...decoded.result, lines: command.lines.map(line => byId.get(line.sourceLineId)) };
  }

  async #write(tx, command, batch, write, profile, warehouse, bin, actor) {
    const { line, member, lot, lotId, balanceId, allocated, before, after, version, nextVersion } = write;
    const [updated] = await tx.execute(`UPDATE inventory_stock_balances
      SET fifo_anchor_date = IF(on_hand_quantity = 0, ?, fifo_anchor_date), on_hand_quantity = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ?`, [this.time.fileDate(), after, nextVersion, batch.timestamp, balanceId, version]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const movementGroupId = this.createMovementGroupId(), evidence = line.minimumLifeEvidence;
    const reasonCategory = evidence ? "MINIMUM_LIFE_OVERRIDE" : line.commitment.skuExceptionReason ? "SKU_COMMITMENT_EXCEPTION" : "";
    const reasonText = evidence?.reason ?? line.commitment.skuExceptionReason ?? "";
    const [movement] = await tx.execute(`INSERT INTO inventory_movements
      (movement_group_id, operation_request_id, movement_type, location_kind, warehouse_id, bin_id, sku_id, lot_id,
       stock_status, direction, quantity, balance_before, balance_after, balance_version_after, reason_category, reason_text,
       sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot, lot_number_snapshot,
       expiry_date_snapshot, posted_at, posted_by, posted_by_label)
      VALUES (?, ?, 'RECEIPT', 'BIN', ?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [movementGroupId, member.operationId, line.warehouseId, line.binId, line.skuId, lotId, line.stockStatus,
      line.baseQuantity, before, after, nextVersion, reasonCategory, reasonText, profile.skuCode, profile.skuName,
      warehouse.warehouse_code, bin.bin_code, lot?.lot_number ?? "", lot?.expiry_date ?? null,
      batch.timestamp, command.actor.userId, actor.username]);
    const movementId = number(movement.insertId, "movementId", 1);
    await this.audit.recordSucceeded(tx, { actorUserId: command.actor.userId, actorLabel: actor.username,
      action: "receipt.post", targetType: "movement_group", targetId: movementId, targetLabel: movementGroupId,
      reasonCategory, reasonText, beforeSummary: { id: balanceId, quantity: before, version },
      afterSummary: { id: balanceId, quantity: after, version: nextVersion, movementId, operationId: member.operationId,
        skuId: line.skuId, lotId, stockStatus: line.stockStatus, baseQuantity: line.baseQuantity,
        baseUomId: line.commitment.baseUomIdSnapshot, onHandQuantity: after, allocatedQuantity: allocated,
        ...(evidence ? { minimumLifeDaysApplied: evidence.minimumLifeDaysApplied, actualRemainingLifeDays: evidence.actualRemainingLifeDays,
          overrideActorId: command.actor.userId, receiptId: command.source.documentId, requestId: command.correlationId } : {}) },
      operationRequestId: member.operationId, requestId: this.database.context.get().requestId ?? "",
      correlationId: command.correlationId, ip: this.database.context.get().clientIp ?? "" });
    return { sourceLineId: line.sourceLineId, operationId: member.operationId, movementId, movementGroupId, baseQuantity: line.baseQuantity };
  }
}

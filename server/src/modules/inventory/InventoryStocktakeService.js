import { randomUUID } from "node:crypto";

import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { uomConversionInvalid } from "../item/itemErrors.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService } from "./InventoryOperationService.js";
import { consumeInventoryStocktakeCancelContext } from "./inventoryStocktakeCancelContext.js";
import { consumeInventoryHighRiskContext } from "./inventoryHighRiskContext.js";
import { INVENTORY_STOCK_STATUSES } from "./inventoryConstants.js";
import { inventoryError } from "./inventoryErrors.js";
import { inventoryStringHasInvalidCharacters } from "./inventorySafeJson.js";
import { calculateInventoryAvailability, meetsMinimumRemainingLife, validateInventoryCommandContext } from "./inventoryValidation.js";

function id(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}
function fields(value, allowed) {
  for (const field of Object.keys(value)) if (!allowed.includes(field)) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
}
function binIds(value) {
  if (!Array.isArray(value) || !value.length) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "binIds" });
  const result = value.map(value => id(value, "binId"));
  if (new Set(result).size !== result.length) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "binIds" });
  return result.sort((a, b) => a - b);
}
function reason(value = "", required = false) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 500 || inventoryStringHasInvalidCharacters(value) ||
      (required && !value.trim())) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reason" });
  return value.trim();
}
function concurrent(error) {
  if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.cause?.code ?? error?.code)) throw inventoryError("CONCURRENT_OPERATION");
  throw error;
}
function countInputs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  const result = value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
    fields(row, ["lineId", "expectedVersion", "countedQuantity", "notFound"]);
    const counted = Object.hasOwn(row, "countedQuantity"), missing = Object.hasOwn(row, "notFound");
    if (counted === missing || (missing && row.notFound !== true)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "notFound" });
    if (counted && (!Number.isSafeInteger(row.countedQuantity) || row.countedQuantity < 0)) throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "countedQuantity" });
    return { lineId: id(row.lineId, "lineId"), expectedVersion: id(row.expectedVersion, "expectedVersion"),
      ...(counted ? { countedQuantity: row.countedQuantity } : { notFound: true }) };
  }).sort((a, b) => a.lineId - b.lineId);
  if (new Set(result.map(row => row.lineId)).size !== result.length) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  return result;
}
function countSummary(row) {
  const missing = Number(row.is_not_found), quantity = row.counted_quantity === null ? null : Number(row.counted_quantity);
  if (![0, 1].includes(missing) || (missing === 1 && quantity !== null) ||
      (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0))) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  return { id: Number(row.id), stocktakeId: Number(row.stocktake_id), quantity: missing ? 0 : quantity,
    version: Number(row.version), status: missing ? "NOT_FOUND" : quantity === null ? "UNCOUNTED" : "COUNTED" };
}
function stockQuantity(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  return result;
}
function lineDimension(row) {
  return `${Number(row.bin_id)}:${Number(row.sku_id)}:${row.lot_id === null ? 0 : Number(row.lot_id)}:${row.stock_status}`;
}

export function toStocktakeInventoryProfile(projection) {
  const baseUom = projection.uoms.find(uom => uom.isBase);
  if (!baseUom || baseUom.toBaseFactor !== 1) {
    throw uomConversionInvalid("Inventory profile requires exactly one Base UOM with factor 1");
  }
  return {
    skuId: projection.skuId,
    skuCode: projection.skuCode,
    skuName: projection.skuName,
    skuStatus: projection.skuStatus,
    itemStatus: projection.itemStatus,
    inventoryTracked: projection.inventoryTracked,
    trackingPolicy: projection.trackingPolicy,
    shelfLifeDays: projection.shelfLifeDays,
    minimumReceiptLifeDays: projection.minimumReceiptLifeDays,
    minimumSaleLifeDays: projection.minimumSaleLifeDays,
    baseUom: { uomId: baseUom.uomId, uomCode: baseUom.uomCode },
    usable: projection.usable,
    reasons: projection.reasons
  };
}

export class InventoryStocktakeService {
  constructor({ database, logger, time, authorize = assertActorFresh, audit, operations, locks, itemLookup, inventoryProfileLookupFactory } = {}) {
    if (!database || typeof database.withTransaction !== "function" || !time || typeof time.nowMs !== "function" || typeof authorize !== "function") {
      throw new TypeError("InventoryStocktakeService requires database, time and authorization services");
    }
    Object.assign(this, { database, logger, time, authorize, itemLookup, inventoryProfileLookupFactory, audit: audit ?? new InventoryAuditService({ database, logger, time }),
      operations: operations ?? new InventoryOperationService(), locks: locks ?? new InventoryLockService() });
  }
  create(command) { return this.database.withTransaction(tx => this.createInTransaction(tx, command)).catch(concurrent); }
  update(command) { return this.database.withTransaction(tx => this.updateInTransaction(tx, command)).catch(concurrent); }
  cancelDraft(command) { return this.database.withTransaction(tx => this.cancelDraftInTransaction(tx, command)).catch(concurrent); }
  start(command) { return this.database.withTransaction(tx => this.startInTransaction(tx, command)).catch(concurrent); }
  saveCounts(command) { return this.database.withTransaction(tx => this.saveCountsInTransaction(tx, command)).catch(concurrent); }
  addLine(command) { return this.database.withTransaction(tx => this.addLineInTransaction(tx, command)).catch(concurrent); }
  ready(command) { return this.database.withTransaction(tx => this.readyInTransaction(tx, command)).catch(concurrent); }
  cancel(command, proof) { return this.database.withTransaction(tx => this.cancelInTransaction(tx, command, proof)).catch(concurrent); }
  post(command, proof) { return this.database.withTransaction(tx => this.postInTransaction(tx, command, proof)).catch(concurrent); }

  async postInTransaction(tx, command, proof) {
    const context = validateInventoryCommandContext(tx, command, { purpose: "stocktake.post", requiredCallerPermission: "inventory.adjust" });
    fields(context.payload, ["stocktakeId", "expectedVersion", "reason"]);
    const payload = { stocktakeId: id(context.payload.stocktakeId, "stocktakeId"), expectedVersion: id(context.payload.expectedVersion, "expectedVersion"), reason: reason(context.payload.reason, true) };
    if (context.actor.userId === null || payload.expectedVersion > 4294967295) throw inventoryError("INVENTORY_INPUT_INVALID");
    const guard = consumeInventoryHighRiskContext(proof, { ...context, payload });
    context.actorLabel = (await guard.check(tx)).username; context.now = this.time.nowMs();
    const claim = await this.operations.claim(tx, { commandType: "STOCKTAKE_POST", payload, source: context.source,
      actorUserId: null, actorLabel: context.actorLabel, requestId: context.correlationId, correlationId: context.correlationId, createdAt: context.now });
    if (claim.replay) { await guard.check(tx, { locking: true }); return claim.replay.resultSummary; }
    const date = this.time.fileDate();
    const [[discovered]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [payload.stocktakeId]);
    if (!discovered) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const [discoveredScopes] = await tx.query("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ? ORDER BY bin_id,id", [payload.stocktakeId]);
    const [discoveredLines] = await tx.query("SELECT * FROM inventory_stocktake_lines WHERE stocktake_id = ? ORDER BY id", [payload.stocktakeId]);
    const requested = binIds(discoveredScopes.map(row => Number(row.bin_id))), warehouseId = id(Number(discovered.warehouse_id), "warehouseId");
    const changedSkus = [...new Set(discoveredLines.filter(row => Number(row.variance_quantity) !== 0).map(row => id(Number(row.sku_id), "skuId")))].sort((a,b) => a-b);
    const lotIds = [...new Set(discoveredLines.filter(row => row.lot_id !== null).map(row => id(Number(row.lot_id), "lotId")))].sort((a,b) => a-b);
    const lotQuery = `SELECT *,DATE_FORMAT(expiry_date,'%Y-%m-%d') AS expiry_date,DATE_FORMAT(manufacture_date,'%Y-%m-%d') AS manufacture_date,
      DATE_FORMAT(first_receipt_date,'%Y-%m-%d') AS first_receipt_date FROM inventory_lots
      WHERE id IN (${lotIds.map(() => "?").join(",")}) ORDER BY sku_id,normalized_lot_number,id`;
    const [discoveredLots] = lotIds.length ? await tx.query(lotQuery, lotIds) : [[]];
    const locked = await this.locks.lockForCommand(tx, { warehouseIds: [warehouseId], binIds: requested, now: context.now,
      stockControls: changedSkus.map(skuId => ({ warehouseId, skuId })),
      lots: discoveredLots.map(row => ({ skuId: Number(row.sku_id), normalizedLotNumber: row.normalized_lot_number })) });
    this.#bins(locked, warehouseId, requested);
    const [lots] = lotIds.length ? await tx.query(lotQuery + " FOR UPDATE", lotIds) : [[]];
    const [balances] = await tx.query(`SELECT *,DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS fifo_anchor_date
      FROM inventory_stock_balances WHERE warehouse_id = ? AND bin_id IN (${requested.map(() => "?").join(",")})
      ORDER BY warehouse_id,sku_id,bin_id,lot_scope,stock_status FOR UPDATE`, [warehouseId, ...requested]);
    const [[header]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ? ORDER BY id FOR UPDATE", [payload.stocktakeId]);
    const [scopes] = await tx.query("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ? ORDER BY bin_id,id FOR UPDATE", [payload.stocktakeId]);
    const [rows] = await tx.query("SELECT * FROM inventory_stocktake_lines WHERE stocktake_id = ? ORDER BY id FOR UPDATE", [payload.stocktakeId]);
    if (!header || Number(header.version) !== payload.expectedVersion || Number(header.version) !== Number(discovered.version) || Number(header.version) >= 4294967295) throw inventoryError("VERSION_CONFLICT");
    if (header.status !== "READY_TO_POST" || Number(header.warehouse_id) !== warehouseId || scopes.length !== requested.length || scopes.some(scope => !requested.includes(Number(scope.bin_id)))) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    const owned = this.#ownedLocks(header, scopes, locked.binLocks);
    const discoveryPin = values => JSON.stringify(values.map(row => [Number(row.id),lineDimension(row),row.stock_balance_id,row.snapshot_quantity,row.snapshot_balance_version,row.counted_quantity,row.is_not_found,row.variance_quantity,row.version]));
    if (discoveryPin(rows) !== discoveryPin(discoveredLines)) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
    if (new Set(rows.map(lineDimension)).size !== rows.length) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
    const profiles = new Map();
    const skuIds = [...new Set(rows.map(row => id(Number(row.sku_id), "skuId")))].sort((a,b) => a-b);
    const acceptProfile = (skuId, profile) => {
      if (!profile) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
      if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
      if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
      if (!profile.usable || !profile.baseUom) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
      profiles.set(skuId, profile);
    };
    if (skuIds.length > 100) {
      const shareExecutor = { query: (sql, params) => tx.query(sql + " FOR SHARE", params) };
      const lookup = this.inventoryProfileLookupFactory === undefined
        ? new ItemLookupService({ database: shareExecutor, logger: this.logger, time: this.time })
        : this.inventoryProfileLookupFactory(shareExecutor);
      for (let offset = 0; offset < skuIds.length; offset += 100) {
        const chunk = skuIds.slice(offset, offset + 100);
        const projections = await lookup.findManyByIds(chunk, { purpose: "inventory" });
        for (const skuId of chunk) {
          const projection = projections.get(skuId);
          acceptProfile(skuId, projection ? toStocktakeInventoryProfile(projection) : null);
        }
      }
    } else {
      const lookup = this.itemLookup ?? new ItemLookupService({ database: this.database, logger: this.logger, time: this.time });
      for (const skuId of skuIds) {
        acceptProfile(skuId, await lookup.getInventoryProfileInTransaction(tx, skuId));
      }
    }
    const balanceByDimension = new Map();
    for (const balance of balances) {
      const key = lineDimension(balance), match = balanceByDimension.get(key);
      if (match) match.count++;
      else balanceByDimension.set(key, { first: balance, count: 1 });
    }
    const firstByNumber = (values, column) => {
      const index = new Map();
      for (const value of values) {
        const key = Number(value[column]);
        // Map matches NaN keys, unlike the original Number(...) === Number(...) predicates.
        if (!Number.isNaN(key) && !index.has(key)) index.set(key, value);
      }
      return index;
    };
    const lotById = firstByNumber(lots, "id"), controlBySku = firstByNumber(locked.stockControls, "sku_id"), binById = firstByNumber(locked.bins, "id");
    const scopeKeys = new Set();
    for (const scope of scopes) {
      const scopeId = Number(scope.id), binId = Number(scope.bin_id);
      if (!Number.isNaN(scopeId) && !Number.isNaN(binId)) scopeKeys.add(`${scopeId}:${binId}`);
    }
    const legs = rows.map(row => {
      if (!scopeKeys.has(`${Number(row.stocktake_bin_id)}:${Number(row.bin_id)}`) ||
          !INVENTORY_STOCK_STATUSES.includes(row.stock_status) || row.movement_id != null) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
      const count = countSummary(row), before = stockQuantity(row.snapshot_quantity), actual = count.quantity, variance = actual - before;
      if (count.status === "UNCOUNTED" || row.variance_quantity === null || !Number.isSafeInteger(variance) || Number(row.variance_quantity) !== variance) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
      const match = balanceByDimension.get(lineDimension(row)), balance = match?.first, matchCount = match?.count ?? 0;
      if (row.stock_balance_id === null ? matchCount !== 0 || before !== 0 || Number(row.snapshot_balance_version) !== 0
        : matchCount !== 1 || Number(balance.id) !== Number(row.stock_balance_id) || stockQuantity(balance.on_hand_quantity) !== before || Number(balance.version) !== Number(row.snapshot_balance_version)) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
      const allocated = balance ? stockQuantity(balance.allocated_quantity) : 0;
      if (allocated > before || actual < allocated) throw inventoryError("INSUFFICIENT_STOCK");
      const version = balance ? id(Number(balance.version), "balanceVersion") : 1;
      if (variance && (version >= 4294967295 || id(Number(row.version), "lineVersion") >= 4294967295)) throw inventoryError("CONCURRENT_OPERATION");
      const profile = profiles.get(Number(row.sku_id)), lot = row.lot_id === null ? null : lotById.get(Number(row.lot_id));
      if (profile.trackingPolicy === "none" ? row.lot_id !== null : row.lot_id === null) throw inventoryError("LOT_DATA_CONFLICT");
      if (row.lot_id !== null && (!lot || Number(lot.sku_id) !== Number(row.sku_id))) throw inventoryError("LOT_DATA_CONFLICT");
      if (profile.trackingPolicy === "batch_expiry" && !lot?.expiry_date) throw inventoryError("EXPIRY_REQUIRED");
      if (lot) {
        for (const value of [lot.expiry_date,lot.manufacture_date,lot.first_receipt_date]) if (value) meetsMinimumRemainingLife(value, date, 0);
        if (!lot.first_receipt_date || (lot.expiry_date && lot.manufacture_date && lot.manufacture_date > lot.expiry_date)) throw inventoryError("LOT_DATA_CONFLICT");
      }
      return { row, balance, before, actual, variance, version, lot, profile };
    });
    const legByDimension = new Map(), newAvailableBySku = new Map();
    for (const leg of legs) {
      const key = lineDimension(leg.row), skuId = Number(leg.row.sku_id);
      if (!legByDimension.has(key)) legByDimension.set(key, leg);
      if (!leg.balance && leg.row.stock_status === "AVAILABLE") {
        if (!newAvailableBySku.has(skuId)) newAvailableBySku.set(skuId, []);
        newAvailableBySku.get(skuId).push(leg);
      }
    }
    // Compare the complete final effect, not a sequence of unrelated single adjustments.
    let availableBySku;
    if (changedSkus.length > 100) {
      availableBySku = new Map();
      for (let offset = 0; offset < changedSkus.length; offset += 100) {
        guard.assertTime();
        const skus = changedSkus.slice(offset, offset + 100);
        const [available] = await tx.query(`SELECT b.*,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry_date FROM inventory_stock_balances b
          LEFT JOIN inventory_lots l ON l.id = b.lot_id WHERE b.warehouse_id = ? AND b.sku_id IN (${skus.map(() => "?").join(",")}) AND b.stock_status = 'AVAILABLE'
          ORDER BY b.warehouse_id,b.sku_id,b.bin_id,b.lot_scope,b.stock_status FOR SHARE`, [warehouseId, ...skus]);
        guard.assertTime();
        for (const row of available) {
          guard.assertTime();
          const skuId = Number(row.sku_id);
          if (!availableBySku.has(skuId)) availableBySku.set(skuId, []);
          availableBySku.get(skuId).push(row);
        }
      }
    }
    for (const skuId of changedSkus) {
      const [available] = availableBySku ? [availableBySku.get(skuId) ?? []] : await tx.query(`SELECT b.*,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry_date FROM inventory_stock_balances b
        LEFT JOIN inventory_lots l ON l.id = b.lot_id WHERE b.warehouse_id = ? AND b.sku_id = ? AND b.stock_status = 'AVAILABLE'
        ORDER BY b.warehouse_id,b.sku_id,b.bin_id,b.lot_scope,b.stock_status FOR SHARE`, [warehouseId, skuId]);
      const profile = profiles.get(skuId), control = controlBySku.get(skuId);
      if (!profile || !control) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      let before = 0, after = 0;
      for (const balance of available) {
        if (balance.stock_status !== "AVAILABLE" || !meetsMinimumRemainingLife(balance.expiry_date ?? null, date, profile.minimumSaleLifeDays ?? 0)) continue;
        const leg = Number(balance.sku_id) === skuId ? legByDimension.get(lineDimension(balance)) : undefined;
        before = stockQuantity(before + stockQuantity(balance.on_hand_quantity)); after = stockQuantity(after + (leg ? leg.actual : stockQuantity(balance.on_hand_quantity)));
      }
      for (const leg of newAvailableBySku.get(skuId) ?? []) {
        if (meetsMinimumRemainingLife(leg.lot?.expiry_date ?? null, date, profile.minimumSaleLifeDays ?? 0)) after = stockQuantity(after + leg.actual);
      }
      const reserved = stockQuantity(control.reserved_quantity);
      if (calculateInventoryAvailability({ eligibleOnHand: after, reserved }).uncoveredReserved > calculateInventoryAvailability({ eligibleOnHand: before, reserved }).uncoveredReserved) throw inventoryError("INSUFFICIENT_ATP");
    }
    context.actorLabel = (await guard.check(tx, { locking: true })).username; context.now = this.time.nowMs();
    if (this.time.fileDate() !== date) throw inventoryError("CONCURRENT_OPERATION");
    await this.#bindFlowActor(tx, context, claim.operationId, "STOCKTAKE_POST");
    const changed = legs.filter(leg => leg.variance !== 0), movementGroupId = changed.length ? randomUUID() : null;
    if (changed.length > 100) {
      await this.#postBatches(tx, { changed, context, guard, warehouseId, header, operationId: claim.operationId,
        movementGroupId, date, reason: payload.reason, binById, warehouseCode: locked.warehouses[0].warehouse_code });
    } else for (const leg of changed) {
      let balance = leg.balance;
      if (!balance) {
        const [inserted] = await tx.execute(`INSERT INTO inventory_stock_balances
          (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,allocated_quantity,fifo_anchor_date,version,created_at,updated_at)
          VALUES (?,?,?,?,?,0,0,NULL,1,?,?)`, [warehouseId, leg.row.bin_id, leg.row.sku_id, leg.row.lot_id, leg.row.stock_status, context.now, context.now]);
        balance = { id: id(Number(inserted.insertId), "balanceId"), fifo_anchor_date: null };
      }
      const anchor = leg.actual === 0 ? null : leg.lot ? balance.fifo_anchor_date : leg.before === 0 ? date : balance.fifo_anchor_date;
      const [updated] = await tx.execute(`UPDATE inventory_stock_balances SET on_hand_quantity = ?,fifo_anchor_date = ?,version = version + 1,updated_at = ?
        WHERE id = ? AND version = ?`, [leg.actual, anchor, context.now, balance.id, leg.version]);
      if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      const bin = binById.get(Number(leg.row.bin_id));
      const [movement] = await tx.execute(`INSERT INTO inventory_movements
        (movement_group_id,operation_request_id,movement_type,location_kind,warehouse_id,bin_id,sku_id,lot_id,stock_status,direction,
         quantity,balance_before,balance_after,balance_version_after,stocktake_id,stocktake_line_id,reason_text,
         sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,posted_at,posted_by,posted_by_label)
        VALUES (?,?,'STOCKTAKE_VARIANCE','BIN',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [movementGroupId, claim.operationId, warehouseId, leg.row.bin_id, leg.row.sku_id, leg.row.lot_id, leg.row.stock_status,
        leg.variance > 0 ? "IN" : "OUT", Math.abs(leg.variance), leg.before, leg.actual, leg.version + 1, header.id, leg.row.id, payload.reason,
        leg.profile.skuCode, leg.profile.skuName, locked.warehouses[0].warehouse_code, bin.bin_code, leg.lot?.lot_number ?? "", leg.lot?.expiry_date ?? null,
        context.now, context.actor.userId, context.actorLabel]);
      const movementId = id(Number(movement.insertId), "movementId");
      const [linked] = await tx.execute(`UPDATE inventory_stocktake_lines SET movement_id = ?,version = version + 1
        WHERE id = ? AND stocktake_id = ? AND version = ? AND movement_id IS NULL`, [movementId, leg.row.id, header.id, leg.row.version]);
      if (Number(linked.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      await this.#countAudit(tx, context, "post", header, claim.operationId,
        { id: Number(leg.row.id), stocktakeId: Number(header.id), quantity: leg.before, version: leg.version, status: leg.row.stock_status, movementId: null },
        { id: Number(leg.row.id), stocktakeId: Number(header.id), quantity: leg.actual, version: leg.version + 1, status: leg.row.stock_status, movementId });
      guard.assertTime();
    }
    const [updated] = await tx.execute(`UPDATE inventory_stocktakes SET status = 'POSTED',reason = ?,post_operation_id = ?,
      posted_at = ?,posted_by = ?,updated_at = ?,updated_by = ?,version = version + 1
      WHERE id = ? AND version = ? AND status = 'READY_TO_POST'`,
    [payload.reason, claim.operationId, context.now, context.actor.userId, context.now, context.actor.userId, header.id, payload.expectedVersion]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("VERSION_CONFLICT");
    await this.#releaseLocks(tx, context, header, owned, "POSTED");
    const result = { id: Number(header.id), operationId: claim.operationId, status: "POSTED", version: Number(header.version) + 1, rowCount: changed.length, movementGroupId };
    await this.#countAudit(tx, context, "post", header, claim.operationId, { stocktakeId: result.id, status: header.status, version: Number(header.version) },
      { stocktakeId: result.id, status: result.status, version: result.version, rowCount: result.rowCount });
    await this.operations.complete(tx, { operationId: claim.operationId, resultType: "STOCKTAKE", resultId: String(header.id), resultSummary: result, completedAt: context.now });
    guard.assertTime();
    if (this.time.fileDate() !== date) throw inventoryError("CONCURRENT_OPERATION");
    return result;
  }

  #postAuditInput(context, header, operationId, leg, movementId) {
    const summary = (quantity, version, movementId) => ({ id: Number(leg.row.id), stocktakeId: Number(header.id),
      quantity, version, status: leg.row.stock_status, movementId });
    return { actorUserId: context.actor.userId, actorLabel: context.actorLabel, action: "stocktake.post",
      targetType: "stocktake", targetId: Number(header.id), targetLabel: header.stocktake_number,
      beforeSummary: summary(leg.before, leg.version, null), afterSummary: summary(leg.actual, leg.version + 1, movementId),
      operationRequestId: operationId, requestId: context.correlationId, correlationId: context.correlationId };
  }

  async #postBatches(tx, options) {
    const { changed, context, guard, warehouseId, header, operationId, movementGroupId, date, reason, binById, warehouseCode } = options;
    const stringBytes = values => values.reduce((sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0), 0);
    const run = async (method, sql, params) => {
      guard.assertTime();
      const result = await tx[method](sql, params);
      guard.assertTime();
      return result;
    };
    const affected = (result, count) => {
      if (Number(result?.affectedRows) !== count) throw inventoryError("CONCURRENT_OPERATION");
    };
    const movementColumns = ["movement_group_id", "operation_request_id", "movement_type", "location_kind", "warehouse_id", "bin_id", "sku_id", "lot_id", "stock_status", "direction",
      "quantity", "balance_before", "balance_after", "balance_version_after", "stocktake_id", "stocktake_line_id", "reason_text",
      "sku_code_snapshot", "sku_name_snapshot", "warehouse_code_snapshot", "bin_code_snapshot", "lot_number_snapshot", "expiry_date_snapshot", "posted_at", "posted_by", "posted_by_label"];
    const numericMovement = new Set(["operation_request_id", "warehouse_id", "bin_id", "sku_id", "lot_id", "quantity", "balance_before", "balance_after", "balance_version_after", "stocktake_id", "stocktake_line_id", "posted_at", "posted_by"]);
    let watermark = 0;
    for (let offset = 0; offset < changed.length;) {
      const chunk = [], bytes = { balance: 0, update: 0, movement: 0, audit: 0 };
      while (offset + chunk.length < changed.length && chunk.length < 100) {
        guard.assertTime();
        const leg = changed[offset + chunk.length], balance = leg.balance;
        const anchor = leg.actual === 0 ? null : leg.lot ? balance?.fifo_anchor_date ?? null : leg.before === 0 ? date : balance.fifo_anchor_date;
        const entry = { leg, balance, anchor,
          newValues: balance ? [] : [warehouseId, leg.row.bin_id, leg.row.sku_id, leg.row.lot_id, leg.row.stock_status, 0, 0, null, 1, context.now, context.now],
          movement: [movementGroupId, operationId, "STOCKTAKE_VARIANCE", "BIN", warehouseId, leg.row.bin_id, leg.row.sku_id, leg.row.lot_id, leg.row.stock_status,
            leg.variance > 0 ? "IN" : "OUT", Math.abs(leg.variance), leg.before, leg.actual, leg.version + 1, header.id, leg.row.id, reason,
            leg.profile.skuCode, leg.profile.skuName, warehouseCode, binById.get(Number(leg.row.bin_id)).bin_code, leg.lot?.lot_number ?? "", leg.lot?.expiry_date ?? null,
            context.now, context.actor.userId, context.actorLabel] };
        const audit = this.#postAuditInput(context, header, operationId, leg, 1);
        const size = { balance: stringBytes(entry.newValues), update: stringBytes([anchor, balance?.id]), movement: stringBytes(entry.movement),
          audit: stringBytes([audit.actorLabel, audit.action, audit.targetType, audit.targetLabel, JSON.stringify(audit.beforeSummary), JSON.stringify(audit.afterSummary), audit.requestId, audit.correlationId]) };
        if (Object.keys(bytes).some(key => bytes[key] + size[key] > 1_048_576)) {
          if (!chunk.length) throw inventoryError("CONCURRENT_OPERATION");
          break;
        }
        for (const key of Object.keys(bytes)) bytes[key] += size[key];
        chunk.push(entry);
      }
      const fresh = chunk.filter(entry => !entry.balance);
      if (fresh.length) {
        const [inserted] = await run("execute", `INSERT INTO inventory_stock_balances
          (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,allocated_quantity,fifo_anchor_date,version,created_at,updated_at)
          VALUES ${fresh.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`, fresh.flatMap(entry => entry.newValues));
        affected(inserted, fresh.length);
        const [created] = await run("query", `SELECT * FROM inventory_stock_balances WHERE ${fresh.map(() => "(warehouse_id=? AND bin_id=? AND sku_id=? AND lot_scope=? AND stock_status=?)").join(" OR ")}`,
          fresh.flatMap(({ leg }) => [warehouseId, leg.row.bin_id, leg.row.sku_id, leg.row.lot_id ?? 0, leg.row.stock_status]));
        if (created.length !== fresh.length) throw inventoryError("CONCURRENT_OPERATION");
        const byKey = new Map(), ids = new Set();
        for (const balance of created) {
          guard.assertTime();
          const key = lineDimension(balance), balanceId = Number(balance.id);
          if (Number(balance.warehouse_id) !== warehouseId || byKey.has(key) || ids.has(balanceId) || !Number.isSafeInteger(balanceId) || balanceId <= 0 ||
              Number(balance.lot_scope) !== Number(balance.lot_id ?? 0) || Number(balance.on_hand_quantity) !== 0 || Number(balance.allocated_quantity) !== 0 || Number(balance.version) !== 1 || balance.fifo_anchor_date !== null) throw inventoryError("CONCURRENT_OPERATION");
          byKey.set(key, balance); ids.add(balanceId);
        }
        for (const entry of fresh) {
          guard.assertTime();
          entry.balance = byKey.get(lineDimension(entry.leg.row));
          if (!entry.balance) throw inventoryError("CONCURRENT_OPERATION");
        }
      }
      const cases = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const [updated] = await run("execute", `UPDATE inventory_stock_balances SET on_hand_quantity = CASE id ${cases} END,
        fifo_anchor_date = CASE id ${cases} END,version = version + 1,updated_at = ? WHERE ${chunk.map(() => "(id=? AND version=?)").join(" OR ")}`,
        [...chunk.flatMap(entry => [entry.balance.id, entry.leg.actual]), ...chunk.flatMap(entry => [entry.balance.id, entry.anchor]), context.now,
          ...chunk.flatMap(entry => [entry.balance.id, entry.leg.version])]);
      affected(updated, chunk.length);
      const [inserted] = await run("execute", `INSERT INTO inventory_movements (${movementColumns.join(",")}) VALUES ${chunk.map(() => `(${movementColumns.map(() => "?").join(",")})`).join(",")}`,
        chunk.flatMap(entry => entry.movement));
      affected(inserted, chunk.length);
      const [movements] = await run("query", `SELECT *,DATE_FORMAT(expiry_date_snapshot,'%Y-%m-%d') AS expiry_date_snapshot FROM inventory_movements
        WHERE operation_request_id=? AND id>? ORDER BY id LIMIT 101`, [operationId, watermark]);
      if (movements.length !== chunk.length) throw inventoryError("CONCURRENT_OPERATION");
      const expected = new Map(chunk.map(entry => [Number(entry.leg.row.id), entry])), mapped = new Map(), movementIds = new Set();
      for (const movement of movements) {
        guard.assertTime();
        const lineId = Number(movement.stocktake_line_id), movementId = Number(movement.id), entry = expected.get(lineId);
        if (!entry || mapped.has(lineId) || movementIds.has(movementId) || !Number.isSafeInteger(movementId) || movementId <= watermark ||
            movementColumns.some((column, index) => {
              const actual = movement[column], value = entry.movement[index];
              return value === null ? actual !== null : numericMovement.has(column) ? Number(actual) !== Number(value) : actual !== value;
            })) throw inventoryError("CONCURRENT_OPERATION");
        mapped.set(lineId, movementId); movementIds.add(movementId);
      }
      const [linked] = await run("execute", `UPDATE inventory_stocktake_lines SET movement_id = CASE id ${cases} END,version = version + 1
        WHERE ${chunk.map(() => "(id=? AND stocktake_id=? AND version=? AND movement_id IS NULL)").join(" OR ")}`,
        [...chunk.flatMap(({ leg }) => [leg.row.id, mapped.get(Number(leg.row.id))]), ...chunk.flatMap(({ leg }) => [leg.row.id, header.id, leg.row.version])]);
      affected(linked, chunk.length);
      const audits = [];
      for (const { leg } of chunk) {
        guard.assertTime();
        audits.push(this.#postAuditInput(context, header, operationId, leg, mapped.get(Number(leg.row.id))));
      }
      guard.assertTime();
      await this.audit.recordSucceededBatch(tx, audits);
      guard.assertTime();
      watermark = Math.max(...movementIds);
      offset += chunk.length;
    }
  }

  async cancelInTransaction(tx, command, proof) {
    const context = validateInventoryCommandContext(tx, command, { purpose: "stocktake.cancel", requiredCallerPermission: "inventory.operation" });
    fields(context.payload, ["stocktakeId", "expectedVersion", "reason"]);
    const payload = { stocktakeId: id(context.payload.stocktakeId, "stocktakeId"), expectedVersion: id(context.payload.expectedVersion, "expectedVersion"), reason: reason(context.payload.reason, true) };
    if (context.actor.userId === null || payload.expectedVersion > 4294967295) throw inventoryError("INVENTORY_INPUT_INVALID");
    const guard = consumeInventoryStocktakeCancelContext(proof, { ...context, payload });
    context.actorLabel = (await guard.check(tx)).username; context.now = this.time.nowMs();
    const claim = await this.operations.claim(tx, { commandType: "STOCKTAKE_CANCEL", payload, source: context.source,
      actorUserId: null, actorLabel: context.actorLabel, requestId: context.correlationId, correlationId: context.correlationId, createdAt: context.now });
    if (claim.replay) { await guard.check(tx, { locking: true }); return claim.replay.resultSummary; }
    const [[discovered]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [payload.stocktakeId]);
    if (!discovered) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const [discoveredScopes] = await tx.query("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ? ORDER BY bin_id,id", [payload.stocktakeId]);
    const requested = binIds(discoveredScopes.map(row => Number(row.bin_id)));
    const warehouseId = Number(discovered.warehouse_id);
    const locked = await this.locks.lockForCommand(tx, { warehouseIds: [warehouseId], binIds: requested });
    const [[header]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ? ORDER BY id FOR UPDATE", [payload.stocktakeId]);
    const [scopes] = await tx.query("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ? ORDER BY bin_id,id FOR UPDATE", [payload.stocktakeId]);
    if (!header || Number(header.version) !== payload.expectedVersion || Number(header.version) !== Number(discovered.version) || Number(header.version) >= 4294967295) throw inventoryError("VERSION_CONFLICT");
    if (!["DRAFT", "COUNTING", "READY_TO_POST"].includes(header.status) || Number(header.warehouse_id) !== warehouseId ||
        scopes.length !== requested.length || scopes.some(scope => !requested.includes(Number(scope.bin_id)))) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    if (!locked.warehouses.some(row => Number(row.id) === warehouseId) || scopes.some(scope => !locked.bins.some(bin => Number(bin.id) === Number(scope.bin_id) && Number(bin.warehouse_id) === warehouseId))) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    const owned = this.#ownedLocks(header, scopes, locked.binLocks);
    context.actorLabel = (await guard.check(tx, { locking: true })).username; context.now = this.time.nowMs();
    await this.#bindFlowActor(tx, context, claim.operationId, "STOCKTAKE_CANCEL");
    const [updated] = await tx.execute(`UPDATE inventory_stocktakes SET status = 'CANCELLED',reason = ?,cancel_operation_id = ?,
      cancelled_at = ?,cancelled_by = ?,updated_at = ?,updated_by = ?,version = version + 1
      WHERE id = ? AND version = ? AND status IN ('DRAFT','COUNTING','READY_TO_POST')`,
    [payload.reason, claim.operationId, context.now, context.actor.userId, context.now, context.actor.userId, header.id, payload.expectedVersion]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("VERSION_CONFLICT");
    await this.#releaseLocks(tx, context, header, owned, "CANCELLED");
    const result = await this.#finish(tx, context, "cancel", { ...header, status: "CANCELLED", version: Number(header.version) + 1, reason: payload.reason },
      { stocktakeId: Number(header.id), status: header.status, version: Number(header.version) }, scopes.length, claim.operationId);
    guard.assertTime(); return result;
  }
  #ownedLocks(header, scopes, locks) {
    if (header.status === "DRAFT") {
      if (locks.some(lock => Number(lock.stocktake_id) === Number(header.id))) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
      return [];
    }
    return scopes.map(scope => {
      const matches = locks.filter(lock => Number(lock.stocktake_id) === Number(header.id) && Number(lock.stocktake_bin_id) === Number(scope.id) &&
        Number(lock.bin_id) === Number(scope.bin_id) && lock.released_at === null && lock.lock_type === "STOCKTAKE");
      if (matches.length !== 1) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
      return matches[0];
    });
  }
  async #releaseLocks(tx, context, header, locks, label) {
    for (const lock of locks) {
      const [released] = await tx.execute(`UPDATE inventory_bin_locks SET released_at = ?,released_by = ?,release_reason = ?
        WHERE id = ? AND stocktake_id = ? AND stocktake_bin_id = ? AND bin_id = ? AND released_at IS NULL AND lock_type = 'STOCKTAKE'`,
      [context.now, context.actor.userId, label, lock.id, header.id, lock.stocktake_bin_id, lock.bin_id]);
      if (Number(released.affectedRows) !== 1) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    }
  }
  async #bindFlowActor(tx, context, operationId, commandType) {
    const [bound] = await tx.execute(`UPDATE inventory_operation_requests SET actor_user_id = ?
      WHERE id = ? AND command_type = ? AND actor_user_id IS NULL AND completed_at IS NULL`, [context.actor.userId, operationId, commandType]);
    if (Number(bound.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
  }

  async readyInTransaction(tx, command) {
    const context = await this.#context(tx, command, "ready");
    fields(context.payload, ["stocktakeId", "expectedVersion"]);
    const payload = { stocktakeId: id(context.payload.stocktakeId, "stocktakeId"), expectedVersion: id(context.payload.expectedVersion, "expectedVersion") };
    if (payload.expectedVersion > 4294967295) throw inventoryError("VERSION_CONFLICT");
    const claim = await this.operations.claim(tx, { commandType: "STOCKTAKE_READY", payload, source: context.source,
      actorUserId: null, actorLabel: context.actorLabel, requestId: context.correlationId, correlationId: context.correlationId, createdAt: context.now });
    if (claim.replay) { await this.#actor(tx, context, true); return claim.replay.resultSummary; }
    const [[discovered]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [payload.stocktakeId]);
    if (!discovered) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const [discoveredScopes] = await tx.query("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ? ORDER BY bin_id,id", [payload.stocktakeId]);
    const requested = binIds(discoveredScopes.map(row => Number(row.bin_id)));
    const locked = await this.locks.lockForCommand(tx, { warehouseIds: [Number(discovered.warehouse_id)], binIds: requested });
    const { header, scopes } = await this.#counting(tx, discovered, requested, locked, payload.expectedVersion);
    if (Number(header.version) !== payload.expectedVersion || Number(header.version) >= 4294967295) throw inventoryError("VERSION_CONFLICT");
    const [rows] = await tx.query("SELECT * FROM inventory_stocktake_lines WHERE stocktake_id = ? ORDER BY id FOR UPDATE", [header.id]);
    const changes = rows.map(row => {
      const count = countSummary(row), snapshot = Number(row.snapshot_quantity);
      if (count.status === "UNCOUNTED") throw inventoryError("STOCKTAKE_STATE_CONFLICT");
      if (!scopes.some(scope => Number(scope.id) === Number(row.stocktake_bin_id) && Number(scope.bin_id) === Number(row.bin_id)) ||
          !Number.isSafeInteger(snapshot) || snapshot < 0 || !Number.isSafeInteger(count.quantity - snapshot) ||
          !INVENTORY_STOCK_STATUSES.includes(row.stock_status)) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
      return { row, variance: count.quantity - snapshot };
    });
    context.actorLabel = await this.#actor(tx, context, true);
    await this.#bindFlowActor(tx, context, claim.operationId, "STOCKTAKE_READY");
    for (const { row, variance } of changes) {
      const [updated] = await tx.execute("UPDATE inventory_stocktake_lines SET variance_quantity = ? WHERE id = ? AND stocktake_id = ?",
        [variance, row.id, header.id]);
      if (Number(updated.affectedRows) !== 1) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    }
    const [updated] = await tx.execute(`UPDATE inventory_stocktakes SET status = 'READY_TO_POST',ready_operation_id = ?,
      ready_at = ?,ready_by = ?,updated_at = ?,updated_by = ?,version = version + 1
      WHERE id = ? AND version = ? AND status = 'COUNTING'`,
    [claim.operationId, context.now, context.actor.userId, context.now, context.actor.userId, header.id, payload.expectedVersion]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("VERSION_CONFLICT");
    return this.#finish(tx, context, "ready", { ...header, status: "READY_TO_POST", version: Number(header.version) + 1 },
      { stocktakeId: Number(header.id), status: header.status, version: Number(header.version) }, rows.length, claim.operationId);
  }

  async #counting(tx, discovered, requested, locked, expectedVersion = null) {
    this.#bins(locked, Number(discovered.warehouse_id), requested);
    const [[header]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ? ORDER BY id FOR UPDATE", [discovered.id]);
    if (!header) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    if (expectedVersion !== null && (Number(header.version) !== expectedVersion || Number(header.version) >= 4294967295)) throw inventoryError("VERSION_CONFLICT");
    if (header.status !== "COUNTING") throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    if (Number(header.warehouse_id) !== Number(discovered.warehouse_id) || Number(header.version) !== Number(discovered.version)) throw inventoryError("VERSION_CONFLICT");
    const [scopes] = await tx.query(`SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ?
      AND bin_id IN (${requested.map(() => "?").join(",")}) ORDER BY bin_id,id FOR UPDATE`, [header.id, ...requested]);
    if (scopes.length !== requested.length || scopes.some(scope => !locked.binLocks.some(lock =>
      Number(lock.bin_id) === Number(scope.bin_id) && Number(lock.stocktake_id) === Number(header.id) &&
      Number(lock.stocktake_bin_id) === Number(scope.id) && lock.released_at === null && lock.lock_type === "STOCKTAKE"))) {
      throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    }
    return { header, scopes };
  }
  async #countAudit(tx, context, action, header, operationId, before, after) {
    await this.audit.recordSucceeded(tx, { actorUserId: context.actor.userId, actorLabel: context.actorLabel,
      action: `stocktake.${action}`, targetType: "stocktake", targetId: Number(header.id), targetLabel: header.stocktake_number,
      beforeSummary: before, afterSummary: after, operationRequestId: operationId,
      requestId: context.correlationId, correlationId: context.correlationId });
  }
  async #countComplete(tx, context, header, result) {
    const [updated] = await tx.execute("UPDATE inventory_stocktakes SET updated_at = ?,updated_by = ? WHERE id = ? AND status = 'COUNTING'",
      [context.now, context.actor.userId, header.id]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    await this.operations.complete(tx, { operationId: result.operationId, resultType: "STOCKTAKE", resultId: String(header.id), resultSummary: result, completedAt: context.now });
    return result;
  }
  async saveCountsInTransaction(tx, command) {
    const context = await this.#context(tx, command, "count");
    fields(context.payload, ["stocktakeId", "lines"]);
    const payload = { stocktakeId: id(context.payload.stocktakeId, "stocktakeId"), lines: countInputs(context.payload.lines) };
    const claim = await this.#claim(tx, context, "count", payload);
    if (claim.replay) return claim.replay.resultSummary;
    const [[discovered]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [payload.stocktakeId]);
    if (!discovered) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const ids = payload.lines.map(row => row.lineId);
    const query = `SELECT * FROM inventory_stocktake_lines WHERE stocktake_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id`;
    const [discoveredLines] = await tx.query(query, [payload.stocktakeId, ...ids]);
    if (discoveredLines.length !== ids.length) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const requested = [...new Set(discoveredLines.map(row => id(Number(row.bin_id), "binId")))].sort((a, b) => a - b);
    const locked = await this.locks.lockForCommand(tx, { warehouseIds: [Number(discovered.warehouse_id)], binIds: requested });
    const { header, scopes } = await this.#counting(tx, discovered, requested, locked);
    const [rows] = await tx.query(query + " FOR UPDATE", [payload.stocktakeId, ...ids]);
    if (rows.length !== ids.length) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const byId = new Map(rows.map(row => [Number(row.id), row]));
    const changes = payload.lines.map(input => {
      const row = byId.get(input.lineId);
      if (!row || !scopes.some(scope => Number(scope.id) === Number(row.stocktake_bin_id) && Number(scope.bin_id) === Number(row.bin_id))) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
      if (Number(row.version) !== input.expectedVersion || Number(row.version) >= 4294967295) throw inventoryError("VERSION_CONFLICT");
      return { row, input, before: countSummary(row) };
    });
    context.actorLabel = await this.#actor(tx, context, true);
    for (const { row, input, before } of changes) {
      const missing = input.notFound === true;
      const [updated] = await tx.execute(`UPDATE inventory_stocktake_lines SET counted_quantity = ?,is_not_found = ?,
        counted_at = ?,counted_by = ?,version = version + 1 WHERE id = ? AND stocktake_id = ? AND version = ?`,
      [missing ? null : input.countedQuantity, missing ? 1 : 0, context.now, context.actor.userId, row.id, header.id, input.expectedVersion]);
      if (Number(updated.affectedRows) !== 1) throw inventoryError("VERSION_CONFLICT");
      await this.#countAudit(tx, context, "count", header, claim.operationId, before,
        { ...before, quantity: missing ? 0 : input.countedQuantity, version: before.version + 1, status: missing ? "NOT_FOUND" : "COUNTED" });
    }
    return this.#countComplete(tx, context, header,
      { id: Number(header.id), operationId: claim.operationId, status: header.status, version: Number(header.version), rowCount: changes.length });
  }
  async addLineInTransaction(tx, command) {
    const context = await this.#context(tx, command, "add_line");
    fields(context.payload, ["stocktakeId", "binId", "skuId", "lotId", "stockStatus"]);
    if (!Object.hasOwn(context.payload, "lotId") || !INVENTORY_STOCK_STATUSES.includes(context.payload.stockStatus)) throw inventoryError("INVENTORY_INPUT_INVALID");
    const payload = { stocktakeId: id(context.payload.stocktakeId, "stocktakeId"), binId: id(context.payload.binId, "binId"),
      skuId: id(context.payload.skuId, "skuId"), lotId: context.payload.lotId === null ? null : id(context.payload.lotId, "lotId"), stockStatus: context.payload.stockStatus };
    const claim = await this.#claim(tx, context, "add_line", payload);
    if (claim.replay) return claim.replay.resultSummary;
    const [[discovered]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [payload.stocktakeId]);
    if (!discovered) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const warehouseId = Number(discovered.warehouse_id);
    const locked = await this.locks.lockForCommand(tx, { warehouseIds: [warehouseId], binIds: [payload.binId] });
    this.#bins(locked, warehouseId, [payload.binId]);
    const [[lot]] = payload.lotId === null ? [[]] : await tx.query(`SELECT id,sku_id,lot_number,
      DATE_FORMAT(expiry_date,'%Y-%m-%d') AS expiry_date,DATE_FORMAT(manufacture_date,'%Y-%m-%d') AS manufacture_date
      FROM inventory_lots WHERE id = ? ORDER BY sku_id,normalized_lot_number,id FOR UPDATE`, [payload.lotId]);
    if (payload.lotId !== null && !lot) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND", { field: "lotId", rule: "REGISTERED_LOT_REQUIRED" });
    if (lot && Number(lot.sku_id) !== payload.skuId) throw inventoryError("LOT_DATA_CONFLICT", { field: "lotId" });
    const dimension = [warehouseId, payload.binId, payload.skuId, payload.lotId ?? 0, payload.stockStatus];
    const [balances] = await tx.query(`SELECT id FROM inventory_stock_balances WHERE warehouse_id = ? AND bin_id = ?
      AND sku_id = ? AND lot_scope = ? AND stock_status = ? ORDER BY warehouse_id,sku_id,bin_id,lot_scope,stock_status FOR UPDATE`, dimension);
    const { header, scopes } = await this.#counting(tx, discovered, [payload.binId], locked);
    const [existing] = await tx.query(`SELECT id FROM inventory_stocktake_lines WHERE stocktake_id = ? AND bin_id = ?
      AND sku_id = ? AND lot_scope = ? AND stock_status = ? ORDER BY id FOR UPDATE`, [header.id, ...dimension.slice(1)]);
    if (existing.length) throw inventoryError("STOCKTAKE_STATE_CONFLICT", { rule: "DUPLICATE_DIMENSION" });
    if (balances.length) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
    const lookup = this.itemLookup ?? new ItemLookupService({ database: this.database, logger: this.logger, time: this.time });
    const profile = await lookup.getInventoryProfileInTransaction(tx, payload.skuId);
    if (!profile) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
    if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
    if (!profile.usable || !profile.baseUom) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
    if (profile.trackingPolicy === "none" && payload.lotId !== null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lotId" });
    if (profile.trackingPolicy !== "none" && payload.lotId === null) throw inventoryError("LOT_REQUIRED");
    if (profile.trackingPolicy === "batch_expiry" && !lot?.expiry_date) throw inventoryError("EXPIRY_REQUIRED");
    if (lot?.expiry_date && lot?.manufacture_date && lot.manufacture_date > lot.expiry_date) throw inventoryError("LOT_DATA_CONFLICT");
    context.actorLabel = await this.#actor(tx, context, true);
    let inserted;
    try {
      [inserted] = await tx.execute(`INSERT INTO inventory_stocktake_lines
        (stocktake_id,stocktake_bin_id,bin_id,sku_id,lot_id,stock_status) VALUES (?,?,?,?,?,?)`,
      [header.id, scopes[0].id, payload.binId, payload.skuId, payload.lotId, payload.stockStatus]);
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY" && (error?.cause?.message ?? error?.message ?? "").includes("uq_inventory_stocktake_dimension")) {
        throw inventoryError("STOCKTAKE_STATE_CONFLICT", { rule: "DUPLICATE_DIMENSION" });
      }
      throw error;
    }
    const lineId = id(Number(inserted.insertId), "lineId");
    await this.#countAudit(tx, context, "add_line", header, claim.operationId, null,
      { id: lineId, stocktakeId: Number(header.id), quantity: null, version: 1, status: "UNCOUNTED",
        binId: payload.binId, skuId: payload.skuId, lotId: payload.lotId, stockStatus: payload.stockStatus });
    return this.#countComplete(tx, context, header,
      { id: lineId, stocktakeId: Number(header.id), operationId: claim.operationId, status: header.status, version: 1, rowCount: 1 });
  }

  async #actor(tx, context, current = false) {
    // Current locking reads defeat an earlier RR snapshot after operation/business lock waits.
    const reader = current ? { query: (sql, params) => tx.query(sql + " FOR SHARE", params) } : tx;
    const actor = await this.authorize(reader, { actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles, claimedPermissions: context.actor.claimedPermissions });
    if (!actor?.permissions?.includes("inventory.operation")) throw inventoryError("PERMISSION_STALE");
    return actor.username || `user:${context.actor.userId}`;
  }
  async #context(tx, command, action) {
    const context = validateInventoryCommandContext(tx, command, { purpose: `stocktake.${action}`, requiredCallerPermission: "inventory.operation" });
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    context.actorLabel = await this.#actor(tx, context);
    context.now = this.time.nowMs();
    return context;
  }
  async #claim(tx, context, action, payload) {
    const claim = await this.operations.claim(tx, { commandType: `STOCKTAKE_${action.toUpperCase()}`, payload,
      source: context.source, actorUserId: context.actor.userId, actorLabel: context.actorLabel,
      requestId: context.correlationId, correlationId: context.correlationId, createdAt: context.now });
    if (claim.replay) await this.#actor(tx, context, true);
    return claim;
  }
  async #roots(tx, warehouseId, ownId = null) {
    const [roots] = await tx.query(`SELECT * FROM inventory_stocktakes WHERE warehouse_id = ?
      AND (status IN ('DRAFT','COUNTING','READY_TO_POST') OR id = ?) ORDER BY id FOR UPDATE`, [warehouseId, ownId]);
    const [scopes] = roots.length ? await tx.query(`SELECT * FROM inventory_stocktake_bins
      WHERE stocktake_id IN (${roots.map(() => "?").join(",")}) ORDER BY stocktake_id,bin_id,id FOR UPDATE`, roots.map(row => row.id)) : [[]];
    return { roots, scopes };
  }
  #bins(locked, warehouseId, requested) {
    if (!locked.warehouses.some(row => Number(row.id) === warehouseId && row.status === "ACTIVE")) throw inventoryError("WAREHOUSE_INVALID");
    return requested.map(binId => {
      const row = locked.bins.find(row => Number(row.id) === binId);
      if (!row || row.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
      if (Number(row.warehouse_id) !== warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
      return row;
    });
  }
  #exclusive(scopes, requested, ownId = null) {
    if (scopes.some(row => Number(row.stocktake_id) !== ownId && requested.includes(Number(row.bin_id)))) {
      throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    }
  }
  async #insertScope(tx, stocktakeId, bins, now) {
    for (const bin of bins) await tx.execute(`INSERT INTO inventory_stocktake_bins
      (stocktake_id,bin_id,bin_code_snapshot,created_at) VALUES (?,?,?,?)`, [stocktakeId, bin.id, bin.bin_code, now]);
  }
  async #finish(tx, context, action, header, before, rowCount, operationId) {
    const result = { id: Number(header.id), operationId, status: header.status, version: Number(header.version), rowCount };
    await this.audit.recordSucceeded(tx, { actorUserId: context.actor.userId, actorLabel: context.actorLabel,
      action: `stocktake.${action}`, targetType: "stocktake", targetId: result.id, targetLabel: header.stocktake_number,
      reasonText: header.reason, beforeSummary: before,
      afterSummary: { stocktakeId: result.id, status: result.status, version: result.version, rowCount },
      operationRequestId: operationId, requestId: context.correlationId, correlationId: context.correlationId });
    await this.operations.complete(tx, { operationId, resultType: "STOCKTAKE", resultId: String(result.id), resultSummary: result, completedAt: context.now });
    return result;
  }
  async createInTransaction(tx, command) {
    const context = await this.#context(tx, command, "create");
    fields(context.payload, ["warehouseId", "binIds", "reason"]);
    const payload = { warehouseId: id(context.payload.warehouseId, "warehouseId"), binIds: binIds(context.payload.binIds), reason: reason(context.payload.reason) };
    const claim = await this.#claim(tx, context, "create", payload);
    if (claim.replay) return claim.replay.resultSummary;
    const locked = await this.locks.lockForStocktakeDraftCreate(tx,
      { warehouseIds: [payload.warehouseId], binIds: payload.binIds }, async rows => {
        const bins = this.#bins(rows, payload.warehouseId, payload.binIds);
        const { scopes } = await this.#roots(tx, payload.warehouseId);
        this.#exclusive(scopes, payload.binIds);
        context.actorLabel = await this.#actor(tx, context, true);
        const number = `ST-${claim.operationId}`;
        const [inserted] = await tx.execute(`INSERT INTO inventory_stocktakes
      (stocktake_number,warehouse_id,create_operation_id,reason,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)`,
        [number, payload.warehouseId, claim.operationId, payload.reason, context.now, context.now, context.actor.userId, context.actor.userId]);
        const draft = { id: Number(inserted.insertId), stocktake_number: number, status: "DRAFT", version: 1, reason: payload.reason };
        await this.#insertScope(tx, draft.id, bins, context.now);
        return draft;
      });
    context.actorLabel = await this.#actor(tx, context, true);
    return this.#finish(tx, context, "create", locked.draft, null, payload.binIds.length, claim.operationId);
  }
  async #prepare(tx, command, action) {
    const context = await this.#context(tx, command, action);
    fields(context.payload, ["stocktakeId", "expectedVersion", ...(action === "update" ? ["binIds", "reason"] : action === "cancel" ? ["reason"] : [])]);
    const payload = { stocktakeId: id(context.payload.stocktakeId, "stocktakeId"), expectedVersion: id(context.payload.expectedVersion, "expectedVersion"),
      ...(action === "update" ? { binIds: binIds(context.payload.binIds), reason: reason(context.payload.reason) }
        : action === "cancel" ? { reason: reason(context.payload.reason, true) } : {}) };
    const claim = await this.#claim(tx, context, action, payload);
    if (claim.replay) return { replay: claim.replay.resultSummary };
    const [[discovered]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [payload.stocktakeId]);
    if (!discovered) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const [discoveredScope] = await tx.query("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ? ORDER BY bin_id,id", [payload.stocktakeId]);
    const originalIds = binIds(discoveredScope.map(row => Number(row.bin_id)));
    const warehouseId = id(Number(discovered.warehouse_id), "warehouseId");
    const requested = action === "update" ? payload.binIds : originalIds;
    const locked = await this.locks.lockForCommand(tx, { warehouseIds: [warehouseId], binIds: [...new Set([...originalIds, ...requested])].sort((a, b) => a - b) });
    const bins = action === "cancel" ? [] : this.#bins(locked, warehouseId, requested);
    const [balances] = action === "start" ? await tx.query(`SELECT * FROM inventory_stock_balances
      WHERE warehouse_id = ? AND bin_id IN (${requested.map(() => "?").join(",")})
      ORDER BY warehouse_id,sku_id,bin_id,lot_scope,stock_status FOR UPDATE`, [warehouseId, ...requested]) : [[]];
    const { roots, scopes } = await this.#roots(tx, warehouseId, payload.stocktakeId);
    const header = roots.find(row => Number(row.id) === payload.stocktakeId);
    if (!header || Number(header.version) !== payload.expectedVersion || Number(discovered.version) !== Number(header.version)) throw inventoryError("VERSION_CONFLICT");
    if (header.status !== "DRAFT") throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    if (Number(header.version) >= 4294967295) throw inventoryError("VERSION_CONFLICT");
    const owned = scopes.filter(row => Number(row.stocktake_id) === payload.stocktakeId);
    if (JSON.stringify(owned.map(row => Number(row.bin_id)).sort((a, b) => a - b)) !== JSON.stringify(originalIds)) throw inventoryError("VERSION_CONFLICT");
    if (action !== "cancel") {
      this.#exclusive(scopes, requested, payload.stocktakeId);
      if (locked.binLocks.some(row => requested.includes(Number(row.bin_id)))) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
    } else if (locked.binLocks.some(row => Number(row.stocktake_id) === payload.stocktakeId)) throw inventoryError("STOCKTAKE_STATE_CONFLICT");
    context.actorLabel = await this.#actor(tx, context, true);
    return { context, payload, claim, header, owned, bins, balances,
      before: { stocktakeId: payload.stocktakeId, status: header.status, version: Number(header.version) } };
  }
  async updateInTransaction(tx, command) {
    const prepared = await this.#prepare(tx, command, "update");
    if (prepared.replay) return prepared.replay;
    const { context, payload, claim, header, bins, before } = prepared;
    const next = { ...header, version: Number(header.version) + 1, reason: payload.reason };
    const [updated] = await tx.execute(`UPDATE inventory_stocktakes SET reason = ?,version = version + 1,updated_at = ?,updated_by = ?
      WHERE id = ? AND version = ? AND status = 'DRAFT'`, [payload.reason, context.now, context.actor.userId, payload.stocktakeId, payload.expectedVersion]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("VERSION_CONFLICT");
    await tx.execute("DELETE FROM inventory_stocktake_bins WHERE stocktake_id = ?", [payload.stocktakeId]);
    await this.#insertScope(tx, payload.stocktakeId, bins, context.now);
    return this.#finish(tx, context, "update", next, before, bins.length, claim.operationId);
  }
  async cancelDraftInTransaction(tx, command) {
    const prepared = await this.#prepare(tx, command, "cancel");
    if (prepared.replay) return prepared.replay;
    const { context, payload, claim, header, owned, before } = prepared;
    const next = { ...header, status: "CANCELLED", version: Number(header.version) + 1, reason: payload.reason };
    const [updated] = await tx.execute(`UPDATE inventory_stocktakes SET status = 'CANCELLED',reason = ?,cancel_operation_id = ?,
      cancelled_at = ?,cancelled_by = ?,updated_at = ?,updated_by = ?,version = version + 1
      WHERE id = ? AND version = ? AND status = 'DRAFT'`,
    [payload.reason, claim.operationId, context.now, context.actor.userId, context.now, context.actor.userId, payload.stocktakeId, payload.expectedVersion]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("VERSION_CONFLICT");
    return this.#finish(tx, context, "cancel", next, before, owned.length, claim.operationId);
  }
  async startInTransaction(tx, command) {
    const prepared = await this.#prepare(tx, command, "start");
    if (prepared.replay) return prepared.replay;
    const { context, payload, claim, header, owned, balances, before } = prepared;
    const scopeByBin = new Map(owned.map(scope => [Number(scope.bin_id), scope.id]));
    for (const row of balances) {
      if (![row.id, row.bin_id, row.sku_id, row.version, ...(row.lot_id === null ? [] : [row.lot_id])]
        .every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0) ||
        !Number.isSafeInteger(Number(row.on_hand_quantity)) || Number(row.on_hand_quantity) < 0 ||
        !INVENTORY_STOCK_STATUSES.includes(row.stock_status) || !scopeByBin.has(Number(row.bin_id))) {
        throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
      }
    }
    for (const scope of owned) await tx.execute(`INSERT INTO inventory_bin_locks
      (stocktake_id,stocktake_bin_id,bin_id,lock_type,locked_at,locked_by) VALUES (?,?,?,'STOCKTAKE',?,?)`,
    [payload.stocktakeId, scope.id, scope.bin_id, context.now, context.actor.userId]);
    for (const row of balances) await tx.execute(`INSERT INTO inventory_stocktake_lines
      (stocktake_id,stocktake_bin_id,stock_balance_id,bin_id,sku_id,lot_id,stock_status,snapshot_quantity,snapshot_balance_version)
      VALUES (?,?,?,?,?,?,?,?,?)`, [payload.stocktakeId, scopeByBin.get(Number(row.bin_id)),
      row.id, row.bin_id, row.sku_id, row.lot_id, row.stock_status, row.on_hand_quantity, row.version]);
    const next = { ...header, status: "COUNTING", version: Number(header.version) + 1 };
    const [updated] = await tx.execute(`UPDATE inventory_stocktakes SET status = 'COUNTING',start_operation_id = ?,
      started_at = ?,started_by = ?,updated_at = ?,updated_by = ?,version = version + 1
      WHERE id = ? AND version = ? AND status = 'DRAFT'`,
    [claim.operationId, context.now, context.actor.userId, context.now, context.actor.userId, payload.stocktakeId, payload.expectedVersion]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("VERSION_CONFLICT");
    return this.#finish(tx, context, "start", next, before, balances.length, claim.operationId);
  }
}


import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import { inventoryStringHasInvalidCharacters } from "./inventorySafeJson.js";
import { assertTransferWarehouses, transferTransition } from "./inventoryStateMachines.js";
import { inventoryPositiveInteger, validateInventoryCommandContext,
  validateInventoryLotInput, validateInventoryStockStatus } from "./inventoryValidation.js";

function id(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}
function fields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inventoryError("INVENTORY_INPUT_INVALID");
  }
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
}
function reason(value = "", required = false) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 500 ||
      inventoryStringHasInvalidCharacters(value) || (required && !value.trim())) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reason" });
  }
  return value.trim();
}
function draftLines(value, updating = false) {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  }
  const lines = value.map((line) => {
    fields(line, ["skuId", "lotId", "sourceBinId", "stockStatus", "quantity",
      ...(updating ? ["id", "expectedVersion"] : [])]);
    const lineId = updating && line.id !== undefined ? id(line.id, "lineId") : null;
    if (lineId === null && line.expectedVersion !== undefined) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "expectedVersion" });
    }
    return { id: lineId, expectedVersion: lineId === null ? null : id(line.expectedVersion, "expectedVersion"),
      skuId: id(line.skuId, "skuId"), lotId: line.lotId == null ? null : id(line.lotId, "lotId"),
      sourceBinId: id(line.sourceBinId, "sourceBinId"), stockStatus: validateInventoryStockStatus(line.stockStatus),
      quantity: inventoryPositiveInteger(line.quantity) };
  });
  const existing = lines.filter((line) => line.id !== null);
  if (new Set(existing.map((line) => line.id)).size !== existing.length) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lineId" });
  }
  return lines;
}

/** Draft commands return an immutable operation receipt; list/detail use InventoryInquiryService.
 * Quantities are Base UOM positive integers. Full replacement retains submitted id+expectedVersion
 * lines, deletes omitted Draft lines, and creates lines without ids. Header version guards the set.
 */
export class InventoryTransferService {
  constructor({ database, logger, time, itemLookup, authorize = assertActorFresh, audit, operations, locks } = {}) {
    if (!database || typeof database.withTransaction !== "function" || !time ||
        typeof time.nowMs !== "function" || typeof authorize !== "function") {
      throw new TypeError("InventoryTransferService requires database, time and authorization services");
    }
    this.database = database;
    this.time = time;
    this.itemLookup = itemLookup ?? new ItemLookupService({ database, logger, time });
    this.authorize = authorize;
    this.audit = audit ?? new InventoryAuditService({ database, logger, time });
    this.operations = operations ?? new InventoryOperationService();
    this.locks = locks ?? new InventoryLockService();
  }

  create(command) {
    return this.database.withTransaction((tx) => this.createInTransaction(tx, command));
  }
  update(command) {
    return this.database.withTransaction((tx) => this.updateInTransaction(tx, command));
  }
  cancel(command) {
    return this.database.withTransaction((tx) => this.cancelInTransaction(tx, command));
  }

  async #context(tx, command, action) {
    const context = validateInventoryCommandContext(tx, command,
      { purpose: `transfer.${action}`, requiredCallerPermission: "inventory.operation" });
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    const actor = await this.authorize(tx, { actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles, claimedPermissions: context.actor.claimedPermissions });
    if (!actor?.permissions?.includes("inventory.operation")) throw inventoryError("PERMISSION_STALE");
    return { ...context, actorLabel: actor.username || `user:${context.actor.userId}`, now: this.time.nowMs() };
  }

  #claim(tx, context, action, payload) {
    return this.operations.claim(tx, { commandType: `TRANSFER_${action.toUpperCase()}`,
      source: context.source, payload, actorUserId: context.actor.userId, actorLabel: context.actorLabel,
      requestId: context.correlationId, correlationId: context.correlationId, createdAt: context.now });
  }

  async #references(tx, lines) {
    const profiles = new Map();
    for (const skuId of [...new Set(lines.map((line) => line.skuId))].sort((a, b) => a - b)) {
      const profile = await this.itemLookup.getInventoryProfileInTransaction(tx, skuId);
      if (!profile) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
      if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
      if (!profile.usable) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
      if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
      profiles.set(skuId, profile);
    }
    const lotIds = [...new Set(lines.flatMap((line) => line.lotId === null ? [] : [line.lotId]))].sort((a, b) => a - b);
    const [lots] = lotIds.length ? await tx.query(
      `SELECT * FROM inventory_lots WHERE id IN (${lotIds.map(() => "?").join(", ")})`, lotIds) : [[]];
    return { profiles, lots };
  }

  async #validateLocked(tx, locked, payload, references) {
    for (const warehouseId of [payload.sourceWarehouseId, payload.destinationWarehouseId]) {
      if (!locked.warehouses.some((row) => Number(row.id) === warehouseId && row.status === "ACTIVE")) {
        throw inventoryError("WAREHOUSE_INVALID");
      }
    }
    const lotIds = locked.lots.map((lot) => Number(lot.id));
    // DATE_FORMAT preserves calendar dates independently of mysql2's Date/timezone conversion.
    const [lots] = lotIds.length ? await tx.query(`SELECT id, sku_id, lot_number,
      DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
      DATE_FORMAT(manufacture_date, '%Y-%m-%d') AS manufacture_date
      FROM inventory_lots WHERE id IN (${lotIds.map(() => "?").join(", ")}) FOR UPDATE`, lotIds) : [[]];
    return payload.lines.map((line) => {
      const bin = locked.bins.find((row) => Number(row.id) === line.sourceBinId);
      if (!bin || bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
      if (Number(bin.warehouse_id) !== payload.sourceWarehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
      const profile = references.profiles.get(line.skuId);
      const lot = line.lotId === null ? null : lots.find((row) => Number(row.id) === line.lotId);
      if (line.lotId !== null && (!lot || Number(lot.sku_id) !== line.skuId)) throw inventoryError("LOT_DATA_CONFLICT");
      const lotInput = validateInventoryLotInput({ trackingPolicy: profile.trackingPolicy,
        lotNumber: lot?.lot_number, expiryDate: lot?.expiry_date, manufactureDate: lot?.manufacture_date });
      return { ...line, skuCode: profile.skuCode, lotNumber: lot?.lot_number ?? "", expiryDate: lotInput.expiryDate };
    });
  }

  async #finish(tx, context, action, header, beforeSummary, rowCount, operationId) {
    const result = { id: Number(header.id), operationId, status: header.status,
      version: Number(header.version), rowCount };
    await this.audit.recordSucceeded(tx, { actorUserId: context.actor.userId, actorLabel: context.actorLabel,
      action: `transfer.${action}`, targetType: "transfer", targetId: result.id,
      targetLabel: header.transfer_number, reasonText: header.reason, beforeSummary,
      afterSummary: { transferId: result.id, status: result.status, version: result.version, rowCount },
      operationRequestId: operationId, requestId: context.correlationId, correlationId: context.correlationId });
    await this.operations.complete(tx, { operationId, resultType: "TRANSFER", resultId: String(result.id),
      resultSummary: result, completedAt: context.now });
    return result;
  }

  async #insertLine(tx, transferId, lineNumber, line) {
    const [result] = await tx.execute(`INSERT INTO inventory_transfer_lines
      (transfer_id, line_number, sku_id, lot_id, source_bin_id, dispatch_stock_status, quantity,
       sku_code_snapshot, lot_number_snapshot, expiry_date_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [transferId, lineNumber, line.skuId, line.lotId, line.sourceBinId, line.stockStatus, line.quantity,
      line.skuCode, line.lotNumber, line.expiryDate]);
    return Number(result.insertId);
  }

  async createInTransaction(tx, command) {
    const context = await this.#context(tx, command, "create");
    fields(context.payload, ["sourceWarehouseId", "destinationWarehouseId", "reason", "lines"]);
    const payload = { sourceWarehouseId: id(context.payload.sourceWarehouseId, "sourceWarehouseId"),
      destinationWarehouseId: id(context.payload.destinationWarehouseId, "destinationWarehouseId"),
      reason: reason(context.payload.reason), lines: draftLines(context.payload.lines) };
    assertTransferWarehouses(payload.sourceWarehouseId, payload.destinationWarehouseId);
    const references = await this.#references(tx, payload.lines);
    const claim = await this.#claim(tx, context, "create", payload);
    if (claim.replay) return claim.replay.resultSummary;
    const locked = await this.locks.lockForCommand(tx, {
      warehouseIds: [payload.sourceWarehouseId, payload.destinationWarehouseId],
      binIds: payload.lines.map((line) => line.sourceBinId),
      lots: references.lots.map((lot) => ({ skuId: Number(lot.sku_id), normalizedLotNumber: lot.normalized_lot_number })) });
    const lines = await this.#validateLocked(tx, locked, payload, references);
    const transferNumber = `TR-${claim.operationId}`;
    const [inserted] = await tx.execute(`INSERT INTO inventory_transfers
      (transfer_number, source_warehouse_id, destination_warehouse_id, create_operation_id, reason,
       created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [transferNumber, payload.sourceWarehouseId, payload.destinationWarehouseId, claim.operationId,
      payload.reason, context.now, context.now, context.actor.userId, context.actor.userId]);
    const transferId = Number(inserted.insertId);
    for (const [index, line] of lines.entries()) await this.#insertLine(tx, transferId, index + 1, line);
    return this.#finish(tx, context, "create", { id: transferId, transfer_number: transferNumber,
      status: "DRAFT", version: 1, reason: payload.reason }, null, lines.length, claim.operationId);
  }

  async #lockDraft(tx, payload, references = { lots: [] }) {
    const [[preview]] = await tx.query("SELECT * FROM inventory_transfers WHERE id = ?", [payload.transferId]);
    if (!preview) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const locked = await this.locks.lockForCommand(tx, {
      warehouseIds: [Number(preview.source_warehouse_id), Number(preview.destination_warehouse_id),
        ...(payload.lines ? [payload.sourceWarehouseId, payload.destinationWarehouseId] : [])],
      binIds: payload.lines?.map((line) => line.sourceBinId) ?? [],
      lots: references.lots.map((lot) => ({ skuId: Number(lot.sku_id), normalizedLotNumber: lot.normalized_lot_number })),
      transferIds: [payload.transferId]
    });
    const header = locked.transfers.find((row) => Number(row.id) === payload.transferId);
    if (!header) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    // A preview never authorizes a write under a different, unlocked warehouse scope.
    if (Number(header.source_warehouse_id) !== Number(preview.source_warehouse_id) ||
        Number(header.destination_warehouse_id) !== Number(preview.destination_warehouse_id)) {
      throw inventoryError("CONCURRENT_OPERATION");
    }
    transferTransition(header.status, payload.lines ? "edit" : "cancel");
    if (Number(header.version) !== payload.expectedVersion) throw inventoryError("VERSION_CONFLICT");
    const [lines] = await tx.query(
      "SELECT * FROM inventory_transfer_lines WHERE transfer_id = ? ORDER BY id FOR UPDATE", [payload.transferId]);
    return { locked, header, lines };
  }

  async updateInTransaction(tx, command) {
    const context = await this.#context(tx, command, "update");
    fields(context.payload, ["transferId", "expectedVersion", "sourceWarehouseId", "destinationWarehouseId", "reason", "lines"]);
    const payload = { transferId: id(context.payload.transferId, "transferId"),
      expectedVersion: id(context.payload.expectedVersion, "expectedVersion"),
      sourceWarehouseId: id(context.payload.sourceWarehouseId, "sourceWarehouseId"),
      destinationWarehouseId: id(context.payload.destinationWarehouseId, "destinationWarehouseId"),
      reason: reason(context.payload.reason), lines: draftLines(context.payload.lines, true) };
    assertTransferWarehouses(payload.sourceWarehouseId, payload.destinationWarehouseId);
    const references = await this.#references(tx, payload.lines);
    const claim = await this.#claim(tx, context, "update", payload);
    if (claim.replay) return claim.replay.resultSummary;
    const { locked, header, lines: oldLines } = await this.#lockDraft(tx, payload, references);
    const lines = await this.#validateLocked(tx, locked, payload, references);
    const owned = new Map(oldLines.map((line) => [Number(line.id), line]));
    for (const line of lines.filter((line) => line.id !== null)) {
      const old = owned.get(line.id);
      if (!old) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
      if (Number(old.version) !== line.expectedVersion) throw inventoryError("VERSION_CONFLICT");
    }
    const retained = new Set(lines.map((line) => line.id));
    for (const old of oldLines) {
      if (!retained.has(Number(old.id))) await tx.execute(
        "DELETE FROM inventory_transfer_lines WHERE id = ? AND transfer_id = ?", [old.id, payload.transferId]);
    }
    // Park existing numbers above the old range so swaps cannot violate the unique line-number key.
    const offset = Math.max(0, ...oldLines.map((line) => Number(line.line_number))) + lines.length;
    if (offset * 2 > 4294967295) throw inventoryError("CONCURRENT_OPERATION");
    await tx.execute("UPDATE inventory_transfer_lines SET line_number = line_number + ? WHERE transfer_id = ?",
      [offset, payload.transferId]);
    for (const [index, line] of lines.entries()) {
      if (line.id === null) await this.#insertLine(tx, payload.transferId, index + 1, line);
      else {
        const [changed] = await tx.execute(`UPDATE inventory_transfer_lines
          SET line_number = ?, sku_id = ?, lot_id = ?, source_bin_id = ?, dispatch_stock_status = ?, quantity = ?,
              sku_code_snapshot = ?, lot_number_snapshot = ?, expiry_date_snapshot = ?, version = version + 1
          WHERE id = ? AND transfer_id = ? AND version = ?`,
        [index + 1, line.skuId, line.lotId, line.sourceBinId, line.stockStatus, line.quantity,
          line.skuCode, line.lotNumber, line.expiryDate, line.id, payload.transferId, line.expectedVersion]);
        if (Number(changed.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      }
    }
    const [changed] = await tx.execute(`UPDATE inventory_transfers
      SET source_warehouse_id = ?, destination_warehouse_id = ?, reason = ?, version = version + 1,
          updated_at = ?, updated_by = ? WHERE id = ? AND version = ? AND status = 'DRAFT'`,
    [payload.sourceWarehouseId, payload.destinationWarehouseId, payload.reason, context.now,
      context.actor.userId, payload.transferId, payload.expectedVersion]);
    if (Number(changed.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    return this.#finish(tx, context, "update", { ...header, reason: payload.reason, version: payload.expectedVersion + 1 },
      { transferId: payload.transferId, status: header.status, version: payload.expectedVersion, rowCount: oldLines.length },
      lines.length, claim.operationId);
  }

  async cancelInTransaction(tx, command) {
    const context = await this.#context(tx, command, "cancel");
    fields(context.payload, ["transferId", "expectedVersion", "reason"]);
    const payload = { transferId: id(context.payload.transferId, "transferId"),
      expectedVersion: id(context.payload.expectedVersion, "expectedVersion"), reason: reason(context.payload.reason, true) };
    const claim = await this.#claim(tx, context, "cancel", payload);
    if (claim.replay) return claim.replay.resultSummary;
    const { header, lines } = await this.#lockDraft(tx, payload);
    const [changed] = await tx.execute(`UPDATE inventory_transfers
      SET status = 'CANCELLED', reason = ?, cancel_operation_id = ?, cancelled_at = ?, cancelled_by = ?,
          updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'DRAFT'`,
    [payload.reason, claim.operationId, context.now, context.actor.userId, context.now,
      context.actor.userId, payload.transferId, payload.expectedVersion]);
    if (Number(changed.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    return this.#finish(tx, context, "cancel", { ...header, status: "CANCELLED", reason: payload.reason,
      version: payload.expectedVersion + 1 },
    { transferId: payload.transferId, status: header.status, version: payload.expectedVersion, rowCount: lines.length },
    lines.length, claim.operationId);
  }
}

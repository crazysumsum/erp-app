import { randomUUID } from "node:crypto";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import { inventoryStringHasInvalidCharacters } from "./inventorySafeJson.js";
import { assertCompleteTransferLines, assertTransferWarehouses, transferTransition } from "./inventoryStateMachines.js";
import { inventoryPositiveInteger, validateInventoryCommandContext,
  meetsMinimumRemainingLife, validateInventoryLotInput, validateInventoryStockStatus } from "./inventoryValidation.js";

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

function quantity(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw inventoryError("INVENTORY_QUANTITY_INVALID");
  return normalized;
}
function receiveLines(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  }
  return value.map((line) => {
    fields(line, ["id", "quantity", "destinationBinId", "stockStatus"]);
    return { id: id(line.id, "lineId"), quantity: inventoryPositiveInteger(line.quantity),
      destinationBinId: id(line.destinationBinId, "destinationBinId"),
      stockStatus: line.stockStatus === undefined ? null : validateInventoryStockStatus(line.stockStatus) };
  });
}

/** Draft commands return an immutable operation receipt; list/detail use InventoryInquiryService.
 * Quantities are Base UOM positive integers. Full replacement retains submitted id+expectedVersion
 * lines, deletes omitted Draft lines, and creates lines without ids. Header version guards the set.
 */
export class InventoryTransferService {
  constructor({ database, logger, time, itemLookup, authorize = assertActorFresh, audit, operations, locks } = {}) {
    if (!database || typeof database.withTransaction !== "function" || !time ||
        typeof time.nowMs !== "function" || typeof time.fileDate !== "function" || typeof authorize !== "function") {
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
  dispatch(command) {
    return this.database.withTransaction((tx) => this.dispatchInTransaction(tx, command));
  }
  receive(command) {
    return this.database.withTransaction((tx) => this.receiveInTransaction(tx, command));
  }
  dispatchInTransaction(tx, command) {
    return this.#post(tx, command, "dispatch");
  }
  receiveInTransaction(tx, command) {
    return this.#post(tx, command, "receive");
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

  async #validateLocked(tx, locked, payload, references, checkSourceBins = true) {
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
    locked.lotDates = lots;
    return payload.lines.map((line) => {
      if (checkSourceBins) {
        const bin = locked.bins.find((row) => Number(row.id) === line.sourceBinId);
        if (!bin || bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
        if (Number(bin.warehouse_id) !== payload.sourceWarehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
      }
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

  async #lockPosting(tx, payload, context, dispatching) {
    const [[preview]] = await tx.query("SELECT * FROM inventory_transfers WHERE id = ?", [payload.transferId]);
    if (!preview) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const query = `SELECT *, DATE_FORMAT(expiry_date_snapshot, '%Y-%m-%d') AS expiry_date_snapshot
      FROM inventory_transfer_lines WHERE transfer_id = ? ORDER BY id`;
    const [previewLines] = await tx.query(query, [payload.transferId]);
    const sourceWarehouseId = Number(preview.source_warehouse_id);
    const destinationWarehouseId = Number(preview.destination_warehouse_id);
    const lines = previewLines.map((r) => ({ id: Number(r.id), skuId: Number(r.sku_id),
      lotId: r.lot_id === null ? null : Number(r.lot_id), sourceBinId: Number(r.source_bin_id),
      stockStatus: r.dispatch_stock_status, quantity: inventoryPositiveInteger(Number(r.quantity)) }));
    if (!lines.length || lines.length > 100) throw inventoryError("INVENTORY_INPUT_INVALID");
    const skuIds = [...new Set(lines.map((line) => line.skuId))];
    const [sourceBalances] = dispatching ? await tx.query(`SELECT * FROM inventory_stock_balances
      WHERE warehouse_id = ? AND sku_id IN (${skuIds.map(() => "?").join(",")})`, [sourceWarehouseId, ...skuIds]) : [[]];
    const [reservations] = dispatching ? await tx.query(`SELECT id FROM inventory_reservations
      WHERE warehouse_id = ? AND sku_id IN (${skuIds.map(() => "?").join(",")}) AND outstanding_quantity > 0`,
    [sourceWarehouseId, ...skuIds]) : [[]];
    const references = await this.#references(tx, [...lines, ...sourceBalances.map((r) => ({
      skuId: Number(r.sku_id), lotId: r.lot_id === null ? null : Number(r.lot_id) }))]);
    const byId = new Map(payload.lines?.map((line) => [line.id, line]) ?? []);
    const balances = sourceBalances.map((r) => ({ warehouseId: sourceWarehouseId,
      skuId: Number(r.sku_id), binId: Number(r.bin_id), lotId: r.lot_id === null ? null : Number(r.lot_id),
      stockStatus: r.stock_status }));
    for (const line of lines) {
      const submitted = byId.get(line.id);
      if (!dispatching && !submitted) continue; // Exact-set validation follows the locked header/children.
      balances.push({ warehouseId: dispatching ? sourceWarehouseId : destinationWarehouseId,
        skuId: line.skuId, binId: dispatching ? line.sourceBinId : submitted.destinationBinId,
        lotId: line.lotId, stockStatus: dispatching ? line.stockStatus : submitted.stockStatus ?? line.stockStatus });
    }
    const binIds = [...new Set(balances.map((r) => r.binId))];
    const [binReferences] = binIds.length ? await tx.query(
      `SELECT id, warehouse_id FROM inventory_bins WHERE id IN (${binIds.map(() => "?").join(",")})`, binIds) : [[]];
    // Reject impossible FK scopes before the lock helper upserts; held-row validation remains authoritative.
    for (const balance of balances) {
      const bin = binReferences.find((r) => Number(r.id) === balance.binId);
      if (!bin) throw inventoryError("BIN_INVALID");
      if (Number(bin.warehouse_id) !== balance.warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
    }
    const locked = await this.locks.lockForCommand(tx, {
      warehouseIds: [sourceWarehouseId, destinationWarehouseId],
      stockControls: skuIds.flatMap((skuId) => [sourceWarehouseId, destinationWarehouseId].map((warehouseId) => ({ warehouseId, skuId }))),
      binIds: [...balances.map((row) => row.binId), ...(dispatching ? lines.map((row) => row.sourceBinId) : payload.lines.map((row) => row.destinationBinId))],
      lots: references.lots.map((lot) => ({ skuId: Number(lot.sku_id), normalizedLotNumber: lot.normalized_lot_number })),
      balances, reservationIds: reservations.map((row) => Number(row.id)), transferIds: [payload.transferId], now: context.now
    });
    const header = locked.transfers.find((r) => Number(r.id) === payload.transferId);
    if (!header || Number(header.source_warehouse_id) !== sourceWarehouseId ||
        Number(header.destination_warehouse_id) !== destinationWarehouseId) throw inventoryError("CONCURRENT_OPERATION");
    transferTransition(header.status, dispatching ? "dispatch" : "receive");
    if (Number(header.version) !== payload.expectedVersion) throw inventoryError("VERSION_CONFLICT");
    const [currentLines] = await tx.query(query + " FOR UPDATE", [payload.transferId]);
    if (JSON.stringify(currentLines) !== JSON.stringify(previewLines)) throw inventoryError("CONCURRENT_OPERATION");
    if (!dispatching) assertCompleteTransferLines(lines, payload.lines);
    const validated = await this.#validateLocked(tx, locked,
      { sourceWarehouseId, destinationWarehouseId, lines }, references, dispatching);
    for (const [i, line] of validated.entries()) {
      if (line.lotNumber !== currentLines[i].lot_number_snapshot ||
          line.expiryDate !== currentLines[i].expiry_date_snapshot) throw inventoryError("LOT_DATA_CONFLICT");
    }
    const touchedBins = new Set(dispatching ? lines.map((r) => r.sourceBinId) : payload.lines.map((r) => r.destinationBinId));
    if (locked.binLocks.some((r) => touchedBins.has(Number(r.bin_id)))) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
    return { locked, header, lines: currentLines, validated, references };
  }

  #protectReserved(locked, balances, header, references, today) {
    for (const [skuId, profile] of references.profiles) {
      const control = locked.stockControls.find((r) => Number(r.warehouse_id) === Number(header.source_warehouse_id) && Number(r.sku_id) === skuId);
      if (!control) throw inventoryError("CONCURRENT_OPERATION");
      const reserved = quantity(control.reserved_quantity);
      const reservations = locked.reservations.filter((r) => Number(r.sku_id) === skuId);
      if (reservations.reduce((sum, r) => sum + quantity(r.outstanding_quantity), 0) !== reserved) {
        throw inventoryError("CONCURRENT_OPERATION");
      }
      const minimum = Number(profile.minimumSaleLifeDays ?? 0);
      for (const days of new Set([minimum, ...reservations.map((r) => Number(r.minimum_remaining_days))])) {
        const required = days === minimum ? reserved : reservations.filter((r) => Number(r.minimum_remaining_days) >= days)
          .reduce((sum, r) => sum + quantity(r.outstanding_quantity), 0);
        const eligible = balances.filter((r) => Number(r.row.warehouse_id) === Number(header.source_warehouse_id) &&
          Number(r.row.sku_id) === skuId && r.row.stock_status === "AVAILABLE" &&
          locked.bins.some((b) => Number(b.id) === Number(r.row.bin_id) && b.status === "ACTIVE") &&
          meetsMinimumRemainingLife(locked.lotDates.find((l) => Number(l.id) === Number(r.row.lot_id))?.expiry_date ?? null, today, days))
          .reduce((sum, r) => sum + r.onHand, 0);
        if (!Number.isSafeInteger(eligible) || !Number.isSafeInteger(required)) throw inventoryError("INVENTORY_QUANTITY_INVALID");
        if (eligible < required) throw inventoryError("INSUFFICIENT_ATP");
      }
    }
  }

  async #movement(tx, context, header, line, profile, group, operationId, action, leg) {
    const warehouse = leg.warehouse;
    await tx.execute(`INSERT INTO inventory_movements
      (movement_group_id,operation_request_id,movement_type,location_kind,warehouse_id,bin_id,
       sku_id,lot_id,stock_status,direction,quantity,balance_before,balance_after,balance_version_after,
       transfer_id,transfer_line_id,reason_text,sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,
       bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,posted_at,posted_by,posted_by_label)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [group, operationId, `TRANSFER_${action.toUpperCase()}`, leg.bin ? "BIN" : "IN_TRANSIT", warehouse.id,
      leg.bin?.id ?? null, line.sku_id, line.lot_id, leg.status, leg.direction, line.quantity, leg.before, leg.after,
      leg.version ?? null, header.id, line.id, header.reason, profile.skuCode, profile.skuName,
      warehouse.warehouse_code, leg.bin?.bin_code ?? "", line.lot_number_snapshot, line.expiry_date_snapshot,
      context.now, context.actor.userId, context.actorLabel]);
  }

  async #post(tx, command, action) {
    const context = await this.#context(tx, command, action);
    const dispatching = action === "dispatch";
    fields(context.payload, ["transferId", "expectedVersion", ...(!dispatching ? ["lines", "reason"] : [])]);
    const payload = { transferId: id(context.payload.transferId, "transferId"),
      expectedVersion: id(context.payload.expectedVersion, "expectedVersion"),
      ...(!dispatching ? { lines: receiveLines(context.payload.lines), reason: reason(context.payload.reason) } : {}) };
    const claim = await this.#claim(tx, context, action, payload);
    if (claim.replay) return claim.replay.resultSummary;
    const { locked, header, lines, validated, references } = await this.#lockPosting(tx, payload, context, dispatching);
    const today = this.time.fileDate();
    const balances = locked.balances.map((row) => ({ row, onHand: quantity(row.on_hand_quantity),
      allocated: quantity(row.allocated_quantity), version: Number(row.version) }));
    const items = [];
    for (const [index, line] of lines.entries()) {
      const submitted = payload.lines?.find((r) => r.id === Number(line.id));
      const status = dispatching ? line.dispatch_stock_status : submitted.stockStatus ?? line.dispatch_stock_status;
      if (!dispatching && status !== line.dispatch_stock_status && status !== "QUARANTINED") throw inventoryError("STOCK_STATUS_INELIGIBLE");
      if (!dispatching && status === "QUARANTINED" && line.dispatch_stock_status !== "QUARANTINED" && !payload.reason) {
        throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reason" });
      }
      if (quantity(line.in_transit_quantity) !== (dispatching ? 0 : Number(line.quantity))) throw inventoryError("TRANSFER_STATE_CONFLICT");
      const warehouseId = Number(dispatching ? header.source_warehouse_id : header.destination_warehouse_id);
      const binId = dispatching ? validated[index].sourceBinId : submitted.destinationBinId;
      const bin = locked.bins.find((r) => Number(r.id) === binId);
      if (!bin || bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
      if (Number(bin.warehouse_id) !== warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
      const balance = balances.find((r) => Number(r.row.warehouse_id) === warehouseId && Number(r.row.bin_id) === binId &&
        Number(r.row.sku_id) === Number(line.sku_id) && r.row.lot_id === line.lot_id && r.row.stock_status === status);
      if (!balance || balance.allocated > balance.onHand) throw inventoryError("CONCURRENT_OPERATION");
      if (dispatching && Number(line.quantity) > balance.onHand - balance.allocated) throw inventoryError("INSUFFICIENT_STOCK");
      const before = balance.onHand;
      const after = before + (dispatching ? -Number(line.quantity) : Number(line.quantity));
      if (!Number.isSafeInteger(after) || after < 0) throw inventoryError("INVENTORY_QUANTITY_INVALID");
      items.push({ line, bin, balanceId: Number(balance.row.id), version: balance.version, before, after, status });
      balance.onHand = after;
      balance.version += 1;
    }
    if (dispatching) this.#protectReserved(locked, balances, header, references, today);
    const group = randomUUID();
    const destination = locked.warehouses.find((r) => Number(r.id) === Number(header.destination_warehouse_id));
    const source = locked.warehouses.find((r) => Number(r.id) === Number(header.source_warehouse_id));
    const nextHeader = { ...header, status: transferTransition(header.status, action), version: payload.expectedVersion + 1,
      reason: dispatching ? header.reason : payload.reason || header.reason };
    for (const item of items) {
      const [changed] = await tx.execute(`UPDATE inventory_stock_balances
        SET fifo_anchor_date = CASE WHEN ? = 0 THEN NULL WHEN on_hand_quantity = 0 THEN ? ELSE fifo_anchor_date END,
            on_hand_quantity = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
      [item.after, today, item.after, context.now, item.balanceId, item.version]);
      if (Number(changed.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      const binLeg = { warehouse: dispatching ? source : destination, bin: item.bin, status: item.status,
        direction: dispatching ? "OUT" : "IN", before: item.before, after: item.after, version: item.version + 1 };
      const transitLeg = { warehouse: destination, status: item.line.dispatch_stock_status,
        direction: dispatching ? "IN" : "OUT", before: dispatching ? 0 : Number(item.line.quantity),
        after: dispatching ? Number(item.line.quantity) : 0 };
      for (const leg of dispatching ? [binLeg, transitLeg] : [transitLeg, binLeg]) {
        await this.#movement(tx, context, nextHeader, item.line, references.profiles.get(Number(item.line.sku_id)), group, claim.operationId, action, leg);
      }
      const [lineUpdate] = await tx.execute(`UPDATE inventory_transfer_lines SET in_transit_quantity = ?,
        ${dispatching ? "dispatch_movement_group_id = ?" : "receive_movement_group_id = ?, destination_bin_id = ?, receive_stock_status = ?"},
        version = version + 1 WHERE id = ? AND transfer_id = ? AND version = ?`,
      [dispatching ? item.line.quantity : 0, group, ...(!dispatching ? [item.bin.id, item.status] : []),
        item.line.id, header.id, item.line.version]);
      if (Number(lineUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    }
    const [updated] = await tx.execute(`UPDATE inventory_transfers SET status = ?, reason = ?,
      ${dispatching ? "dispatch_operation_id = ?, dispatched_at = ?, dispatched_by = ?" : "receive_operation_id = ?, received_at = ?, received_by = ?"},
      updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ? AND status = ?`,
    [nextHeader.status, nextHeader.reason, claim.operationId, context.now, context.actor.userId,
      context.now, context.actor.userId, header.id, payload.expectedVersion, header.status]);
    if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    return this.#finish(tx, context, action, nextHeader,
      { transferId: payload.transferId, status: header.status, version: payload.expectedVersion, rowCount: lines.length },
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

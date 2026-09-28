import { randomUUID } from "node:crypto";

import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import {
  assertInventoryLotConsistency,
  inventoryPositiveInteger,
  inventoryRemainingLifeDays,
  isInventoryLotExpired,
  meetsMinimumRemainingLife,
  toBaseQuantity,
  validateInventoryCommandContext,
  validateInventoryLotInput,
  validateInventoryStockStatus
} from "./inventoryValidation.js";

const RECEIPT_AUTHORIZATION = Object.freeze({
  purpose: "receipt.post",
  requiredCallerPermission: "inventory.operation"
});
const OVERRIDE_PERMISSION = "receiving.expiry.override";
const PAYLOAD_FIELDS = new Set([
  "skuId", "quantity", "uomId", "warehouseId", "binId", "lotNumber", "expiryDate",
  "manufactureDate", "stockStatus", "minimumLifeOverride"
]);
const OVERRIDE_FIELDS = new Set([
  "permission", "reason", "minimumLifeDaysApplied", "actualRemainingLifeDays", "actorId",
  "receiptId", "requestId"
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: label });
  }
  return value;
}

function exactFields(value, fields, label) {
  object(value, label);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
}

function positiveId(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return normalized;
}

function boundedText(value, field, max, { minimum = 1, ascii = false } = {}) {
  if (typeof value !== "string") throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  const normalized = value.trim();
  if ([...normalized].length < minimum || Buffer.byteLength(normalized, "utf8") > max ||
      /[\p{Cc}]/u.test(normalized) || (ascii && /[^\x20-\x7e]/u.test(normalized))) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return normalized;
}

function receiptPayload(payload) {
  exactFields(payload, PAYLOAD_FIELDS, "payload");
  return {
    skuId: positiveId(payload.skuId, "skuId"),
    quantity: inventoryPositiveInteger(payload.quantity),
    uomId: positiveId(payload.uomId, "uomId"),
    warehouseId: positiveId(payload.warehouseId, "warehouseId"),
    binId: positiveId(payload.binId, "binId"),
    lotNumber: payload.lotNumber ?? null,
    expiryDate: payload.expiryDate ?? null,
    manufactureDate: payload.manufactureDate ?? null,
    stockStatus: validateInventoryStockStatus(payload.stockStatus),
    minimumLifeOverride: payload.minimumLifeOverride ?? null
  };
}

function assertProfile(profile) {
  if (!profile) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
  if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
  if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
  if (!profile.usable) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
}

function assertProfileUnchanged(before, after) {
  assertProfile(after);
  for (const field of [
    "skuId", "skuCode", "skuName", "skuStatus", "itemStatus", "inventoryTracked",
    "trackingPolicy", "minimumReceiptLifeDays"
  ]) {
    if (before[field] !== after[field]) throw inventoryError("CONCURRENT_OPERATION");
  }
  if (before.baseUom.uomId !== after.baseUom.uomId || before.baseUom.uomCode !== after.baseUom.uomCode) {
    throw inventoryError("CONCURRENT_OPERATION");
  }
}

function checkpoint(transaction, point) {
  if (typeof transaction.checkpoint === "function") transaction.checkpoint(point);
}

function resultSummary(result) {
  return {
    status: result.status,
    operationId: result.operationId,
    movementGroupId: result.movementGroupId,
    movementId: result.movementId,
    balanceId: result.balance.id,
    balanceVersion: result.balance.version,
    onHandQuantity: result.balance.onHandQuantity,
    allocatedQuantity: result.balance.allocatedQuantity,
    skuId: result.skuId,
    skuCode: result.skuCode,
    skuName: result.skuName,
    warehouseId: result.warehouseId,
    warehouseCode: result.warehouseCode,
    binId: result.binId,
    binCode: result.binCode,
    lotId: result.lotId,
    lotNumber: result.lotNumber,
    expiryDate: result.expiryDate,
    stockStatus: result.stockStatus,
    inputQuantity: result.inputQuantity,
    inputUomId: result.inputUom.id,
    inputUomCode: result.inputUom.code,
    baseQuantity: result.baseQuantity,
    baseUomId: result.baseUom.id,
    baseUomCode: result.baseUom.code,
    postedAt: result.postedAt
  };
}

function resultFromSummary(summary) {
  return {
    status: summary.status,
    operationId: Number(summary.operationId),
    movementGroupId: summary.movementGroupId,
    movementId: Number(summary.movementId),
    skuId: Number(summary.skuId),
    skuCode: summary.skuCode,
    skuName: summary.skuName,
    warehouseId: Number(summary.warehouseId),
    warehouseCode: summary.warehouseCode,
    binId: Number(summary.binId),
    binCode: summary.binCode,
    lotId: summary.lotId === null ? null : Number(summary.lotId),
    lotNumber: summary.lotNumber,
    expiryDate: summary.expiryDate,
    stockStatus: summary.stockStatus,
    inputQuantity: Number(summary.inputQuantity),
    inputUom: { id: Number(summary.inputUomId), code: summary.inputUomCode },
    baseQuantity: Number(summary.baseQuantity),
    baseUom: { id: Number(summary.baseUomId), code: summary.baseUomCode },
    balance: {
      id: Number(summary.balanceId),
      onHandQuantity: Number(summary.onHandQuantity),
      allocatedQuantity: Number(summary.allocatedQuantity),
      version: Number(summary.balanceVersion)
    },
    postedAt: Number(summary.postedAt)
  };
}

export class InventoryPostingService {
  constructor({
    database, logger, time, itemLookup, authorize = assertActorFresh, audit, operations, locks,
    createMovementGroupId = randomUUID
  } = {}) {
    if (!database || typeof database.withTransaction !== "function" || !time ||
        typeof time.nowMs !== "function" || typeof time.fileDate !== "function" ||
        typeof authorize !== "function" || typeof createMovementGroupId !== "function") {
      throw new TypeError("InventoryPostingService requires database, time and authorization services");
    }
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.itemLookup = itemLookup ?? new ItemLookupService({ database, logger, time });
    this.audit = audit ?? new InventoryAuditService({ database, logger, time });
    this.operations = operations ?? new InventoryOperationService();
    this.locks = locks ?? new InventoryLockService();
    this.createMovementGroupId = createMovementGroupId;
  }

  postReceipt(command) {
    return this.database.withTransaction((transaction) => this.postReceiptInTransaction(transaction, command));
  }

  async postReceiptInTransaction(transaction, command) {
    const context = validateInventoryCommandContext(transaction, command, RECEIPT_AUTHORIZATION);
    if (context.actor.userId === null) throw new TypeError("Receipt posting requires a user actor");
    const payload = receiptPayload(context.payload);
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(RECEIPT_AUTHORIZATION.requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }

    const profile = await this.itemLookup.getInventoryProfileInTransaction(transaction, payload.skuId);
    assertProfile(profile);
    const uom = await this.itemLookup.resolveUomInTransaction(transaction, payload.skuId, payload.uomId);
    if (!uom) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "uomId" });
    const baseQuantity = toBaseQuantity(payload.quantity, uom.toBaseFactor);
    const lotInput = validateInventoryLotInput({
      trackingPolicy: profile.trackingPolicy,
      lotNumber: payload.lotNumber,
      expiryDate: payload.expiryDate,
      manufactureDate: payload.manufactureDate
    });
    const currentDate = this.time.fileDate();
    const overrideEvidence = this.#minimumLifeEvidence({ context, actor, profile, lotInput, payload, currentDate });
    const postedAt = this.time.nowMs();
    const actorLabel = actor.username || context.actor.serviceName || `user:${context.actor.userId}`;
    const claim = await this.operations.claim(transaction, {
      commandType: "RECEIPT_POST",
      source: context.source,
      payload: { ...payload, minimumLifeOverride: overrideEvidence },
      actorUserId: context.actor.userId,
      actorLabel,
      requestId: context.correlationId,
      correlationId: context.correlationId,
      createdAt: postedAt
    });
    checkpoint(transaction, "operation");
    if (claim.replay) return resultFromSummary(claim.replay.resultSummary);

    const locked = await this.locks.lockForCommand(transaction, {
      warehouseIds: [payload.warehouseId],
      stockControls: [{ warehouseId: payload.warehouseId, skuId: payload.skuId }],
      binIds: [payload.binId],
      lots: lotInput.normalizedLotNumber
        ? [{ skuId: payload.skuId, normalizedLotNumber: lotInput.normalizedLotNumber }]
        : [],
      now: postedAt
    });
    const warehouse = locked.warehouses.find((row) => Number(row.id) === payload.warehouseId);
    if (!warehouse || warehouse.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
    if (!locked.stockControls.find((row) => Number(row.warehouse_id) === payload.warehouseId &&
        Number(row.sku_id) === payload.skuId)) {
      throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    }
    const bin = locked.bins.find((row) => Number(row.id) === payload.binId);
    if (!bin || Number(bin.warehouse_id) !== payload.warehouseId) throw inventoryError("BIN_WAREHOUSE_MISMATCH");
    if (bin.status !== "ACTIVE") throw inventoryError("BIN_INVALID");
    if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");

    const lot = await this.#resolveLot(transaction, locked.lots, {
      payload, profile, lotInput, currentDate, postedAt, actorUserId: context.actor.userId
    });
    const balances = await this.locks.lockBalancesAfterLot(transaction, {
      balances: [{
        warehouseId: payload.warehouseId,
        skuId: payload.skuId,
        binId: payload.binId,
        lotId: lot?.id ?? null,
        stockStatus: payload.stockStatus
      }],
      now: postedAt
    });
    const balance = balances[0];
    if (!balance) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");

    const currentProfile = await this.itemLookup.getInventoryProfileInTransaction(transaction, payload.skuId);
    assertProfileUnchanged(profile, currentProfile);
    const currentUom = await this.itemLookup.resolveUomInTransaction(transaction, payload.skuId, payload.uomId);
    if (!currentUom || currentUom.toBaseFactor !== uom.toBaseFactor || currentUom.uomCode !== uom.uomCode) {
      throw inventoryError("CONCURRENT_OPERATION");
    }

    const before = Number(balance.on_hand_quantity);
    const allocated = Number(balance.allocated_quantity);
    const after = before + baseQuantity;
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(allocated) || !Number.isSafeInteger(after)) {
      throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "quantity" });
    }
    const nextVersion = Number(balance.version) + 1;
    const [updated] = await transaction.execute(
      `UPDATE inventory_stock_balances
          SET on_hand_quantity = on_hand_quantity + ?,
              fifo_anchor_date = IF(on_hand_quantity = 0, ?, fifo_anchor_date),
              version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      [baseQuantity, currentDate, postedAt, Number(balance.id), Number(balance.version)]
    );
    if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    checkpoint(transaction, "current_state");

    const movementGroupId = this.createMovementGroupId();
    const [movement] = await transaction.execute(
      `INSERT INTO inventory_movements
         (movement_group_id, operation_request_id, movement_type, location_kind,
          warehouse_id, bin_id, sku_id, lot_id, stock_status, direction, quantity,
          balance_before, balance_after, balance_version_after, reservation_id, allocation_id,
          transfer_id, transfer_line_id, stocktake_id, stocktake_line_id,
          reversal_of_movement_id, reason_category, reason_text, sku_code_snapshot,
          sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot, lot_number_snapshot,
          expiry_date_snapshot, posted_at, posted_by, posted_by_label)
       VALUES (?, ?, 'RECEIPT', 'BIN', ?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        movementGroupId, claim.operationId, payload.warehouseId, payload.binId, payload.skuId,
        lot?.id ?? null, payload.stockStatus, baseQuantity, before, after, nextVersion,
        overrideEvidence ? "MINIMUM_LIFE_OVERRIDE" : "", overrideEvidence?.reason ?? "",
        profile.skuCode, profile.skuName, warehouse.warehouse_code, bin.bin_code,
        lot?.lot_number ?? "", lot?.expiry_date ?? null, postedAt, context.actor.userId, actorLabel
      ]
    );
    const movementId = Number(movement.insertId);
    checkpoint(transaction, "movement");

    const result = {
      status: "POSTED",
      operationId: claim.operationId,
      movementGroupId,
      movementId,
      skuId: payload.skuId,
      skuCode: profile.skuCode,
      skuName: profile.skuName,
      warehouseId: payload.warehouseId,
      warehouseCode: warehouse.warehouse_code,
      binId: payload.binId,
      binCode: bin.bin_code,
      lotId: lot?.id ?? null,
      lotNumber: lot?.lot_number ?? null,
      expiryDate: lot?.expiry_date ?? null,
      stockStatus: payload.stockStatus,
      inputQuantity: payload.quantity,
      inputUom: { id: payload.uomId, code: uom.uomCode },
      baseQuantity,
      baseUom: { id: profile.baseUom.uomId, code: profile.baseUom.uomCode },
      balance: { id: Number(balance.id), onHandQuantity: after, allocatedQuantity: allocated, version: nextVersion },
      postedAt
    };
    await this.audit.recordSucceeded(transaction, {
      actorUserId: context.actor.userId,
      actorLabel,
      action: "receipt.post",
      targetType: "movement_group",
      targetId: movementId,
      targetLabel: movementGroupId,
      reasonCategory: overrideEvidence ? "MINIMUM_LIFE_OVERRIDE" : "",
      reasonText: overrideEvidence?.reason ?? "",
      beforeSummary: { id: Number(balance.id), quantity: before, version: Number(balance.version) },
      afterSummary: {
        id: Number(balance.id), quantity: after, version: nextVersion,
        movementId, operationId: claim.operationId, skuId: payload.skuId, lotId: lot?.id ?? null,
        stockStatus: payload.stockStatus, inputQuantity: payload.quantity, inputUomId: payload.uomId,
        baseQuantity, baseUomId: profile.baseUom.uomId, onHandQuantity: after,
        allocatedQuantity: allocated,
        ...(overrideEvidence ? {
          minimumLifeDaysApplied: overrideEvidence.minimumLifeDaysApplied,
          actualRemainingLifeDays: overrideEvidence.actualRemainingLifeDays,
          overrideActorId: overrideEvidence.overrideActorId,
          receiptId: overrideEvidence.receiptId,
          requestId: overrideEvidence.requestId
        } : {})
      },
      operationRequestId: claim.operationId,
      requestId: context.correlationId,
      correlationId: context.correlationId,
      ip: ""
    });
    checkpoint(transaction, "audit");
    await this.operations.complete(transaction, {
      operationId: claim.operationId,
      resultType: "MOVEMENT_GROUP",
      resultId: movementGroupId,
      resultSummary: resultSummary(result),
      completedAt: postedAt
    });
    return result;
  }

  #minimumLifeEvidence({ context, actor, profile, lotInput, payload, currentDate }) {
    if (lotInput.expiryDate && isInventoryLotExpired(lotInput.expiryDate, currentDate)) {
      throw inventoryError("LOT_EXPIRED");
    }
    const minimum = profile.minimumReceiptLifeDays ?? 0;
    const passes = meetsMinimumRemainingLife(lotInput.expiryDate, currentDate, minimum);
    if (passes) {
      if (payload.minimumLifeOverride !== null) {
        throw inventoryError("INVENTORY_INPUT_INVALID", { field: "minimumLifeOverride" });
      }
      return null;
    }
    if (payload.minimumLifeOverride === null) throw inventoryError("LOT_MINIMUM_LIFE_FAILED");
    const value = payload.minimumLifeOverride;
    exactFields(value, OVERRIDE_FIELDS, "minimumLifeOverride");
    const actual = inventoryRemainingLifeDays(lotInput.expiryDate, currentDate);
    const reason = boundedText(value.reason, "minimumLifeOverride.reason", 500, { minimum: 5 });
    if (value.permission !== OVERRIDE_PERMISSION || !context.actor.claimedPermissions.includes(OVERRIDE_PERMISSION) ||
        !actor.permissions.includes(OVERRIDE_PERMISSION) || value.minimumLifeDaysApplied !== minimum ||
        value.actualRemainingLifeDays !== actual || positiveId(value.actorId, "minimumLifeOverride.actorId") !== context.actor.userId ||
        value.receiptId !== context.source.documentId || value.requestId !== context.correlationId) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "minimumLifeOverride" });
    }
    return {
      minimumLifeDaysApplied: minimum,
      actualRemainingLifeDays: actual,
      overrideActorId: context.actor.userId,
      receiptId: boundedText(value.receiptId, "minimumLifeOverride.receiptId", 100),
      requestId: boundedText(value.requestId, "minimumLifeOverride.requestId", 64, { ascii: true }),
      reason
    };
  }

  async #resolveLot(transaction, lockedLots, { payload, profile, lotInput, currentDate, postedAt, actorUserId }) {
    if (lotInput.normalizedLotNumber === null) return null;
    let lot = lockedLots.find((row) => Number(row.sku_id) === payload.skuId &&
      row.normalized_lot_number === lotInput.normalizedLotNumber);
    if (!lot) {
      await transaction.execute(
        `INSERT INTO inventory_lots
           (sku_id, lot_number, normalized_lot_number, expiry_date, manufacture_date,
            first_receipt_date, sku_code_snapshot, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [payload.skuId, lotInput.lotNumber, lotInput.normalizedLotNumber, lotInput.expiryDate,
          lotInput.manufactureDate, currentDate, profile.skuCode, postedAt, actorUserId]
      );
      const [rows] = await transaction.query(
        `SELECT * FROM inventory_lots
          WHERE sku_id = ? AND normalized_lot_number = ? FOR UPDATE`,
        [payload.skuId, lotInput.normalizedLotNumber]
      );
      [lot] = rows;
    }
    if (!lot) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    assertInventoryLotConsistency(
      { expiryDate: lot.expiry_date, manufactureDate: lot.manufacture_date },
      { expiryDate: lotInput.expiryDate, manufactureDate: lotInput.manufactureDate }
    );
    return lot;
  }
}

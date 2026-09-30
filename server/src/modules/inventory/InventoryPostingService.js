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
  providerInventoryCommand,
  toBaseQuantity,
  validateInventoryCommandContext,
  validateInventoryLotInput,
  validateInventoryStockStatus
} from "./inventoryValidation.js";

const RECEIPT_AUTHORIZATION = Object.freeze({
  purpose: "receipt.post",
  requiredCallerPermission: "inventory.operation"
});
const ISSUE_AUTHORIZATION = Object.freeze({
  purpose: "issue.post",
  requiredCallerPermission: "inventory.operation"
});
const FULFILLMENT_ISSUE = Object.freeze({
  authorization: Object.freeze({ purpose: "issue.post", requiredCallerPermission: "fulfillment.operation" }),
  module: "FULFILLMENT",
  documentType: "SHIPMENT"
});
const RECEIVING_RECEIPT = Object.freeze({
  authorization: Object.freeze({
    purpose: "PURCHASE_RECEIPT",
    requiredCallerPermission: "receiving.operation"
  }),
  module: "PURCHASING_RECEIVING",
  documentType: "GOODS_RECEIPT"
});
const CUSTOMER_RETURN_RECEIPT = Object.freeze({
  authorization: Object.freeze({
    purpose: "CUSTOMER_RETURN_RECEIPT",
    requiredCallerPermission: "returns.operation"
  }),
  module: "RETURNS",
  documentType: "CUSTOMER_RETURN",
  stockStatus: "QUARANTINED"
});
const OVERRIDE_PERMISSION = "receiving.expiry.override";
const PROVIDER_COMMAND_FIELDS = new Set(["actor", "source", "correlationId", "payload"]);
const PROVIDER_SOURCE_FIELDS = new Set(["documentId", "lineId", "eventId"]);
const PAYLOAD_FIELDS = new Set([
  "skuId", "quantity", "uomId", "warehouseId", "binId", "lotNumber", "expiryDate",
  "manufactureDate", "stockStatus", "minimumLifeOverride"
]);
const OVERRIDE_FIELDS = new Set([
  "permission", "reason", "minimumLifeDaysApplied", "actualRemainingLifeDays", "actorId",
  "receiptId", "requestId"
]);
const ISSUE_FIELDS = new Set(["reservationId", "expectedVersion", "lines"]);
const ISSUE_LINE_FIELDS = new Set([
  "allocationId", "expectedVersion", "balanceId", "expectedBalanceVersion", "quantity"
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

function issuePayload(payload) {
  exactFields(payload, ISSUE_FIELDS, "payload");
  if (!Array.isArray(payload.lines) || payload.lines.length === 0 || payload.lines.length > 100) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  }
  const lines = payload.lines.map((line) => {
    exactFields(line, ISSUE_LINE_FIELDS, "line");
    return {
      allocationId: positiveId(line.allocationId, "allocationId"),
      expectedVersion: positiveId(line.expectedVersion, "expectedVersion"),
      balanceId: positiveId(line.balanceId, "balanceId"),
      expectedBalanceVersion: positiveId(line.expectedBalanceVersion, "expectedBalanceVersion"),
      quantity: inventoryPositiveInteger(line.quantity)
    };
  });
  if (new Set(lines.map(({ allocationId }) => allocationId)).size !== lines.length) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  }
  const quantity = lines.reduce((total, line) => total + line.quantity, 0);
  if (!Number.isSafeInteger(quantity)) throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "quantity" });
  return { reservationId: positiveId(payload.reservationId, "reservationId"),
    expectedVersion: positiveId(payload.expectedVersion, "expectedVersion"), lines, quantity };
}

function safeQuantity(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw inventoryError("INVENTORY_QUANTITY_INVALID", { field });
  }
  return number;
}

function issueFromSummary(summary, payload) {
  const movementIds = JSON.parse(summary.allocationSnapshot);
  return { status: summary.status, operationId: Number(summary.operationId),
    movementGroupId: summary.movementGroupId, reservationId: Number(summary.reservationId),
    version: Number(summary.version), quantity: Number(summary.quantity),
    lines: payload.lines.map((line, index) => ({ movementId: Number(movementIds[index]),
      allocationId: line.allocationId, balanceId: line.balanceId, quantity: line.quantity,
      allocationVersion: line.expectedVersion + 1, balanceVersion: line.expectedBalanceVersion + 1 })) };
}

function providerReceiptCommand(command, contract) {
  exactFields(command, PROVIDER_COMMAND_FIELDS, "command");
  exactFields(command.source, PROVIDER_SOURCE_FIELDS, "source");
  object(command.payload, "payload");
  if (contract.stockStatus && command.payload.stockStatus !== undefined &&
      command.payload.stockStatus !== contract.stockStatus) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "stockStatus" });
  }
  return {
    actor: command.actor,
    authorization: contract.authorization,
    source: {
      module: contract.module,
      documentType: contract.documentType,
      documentId: command.source.documentId,
      lineId: command.source.lineId ?? "",
      eventId: command.source.eventId
    },
    correlationId: command.correlationId,
    payload: contract.stockStatus
      ? { ...command.payload, stockStatus: contract.stockStatus }
      : command.payload
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

  postReceiptInTransaction(transaction, command) {
    return this.#postReceiptInTransaction(transaction, command, RECEIPT_AUTHORIZATION);
  }

  postReceivingReceiptInTransaction(transaction, command) {
    return this.#postReceiptInTransaction(
      transaction,
      providerReceiptCommand(command, RECEIVING_RECEIPT),
      RECEIVING_RECEIPT.authorization
    );
  }

  postCustomerReturnReceiptInTransaction(transaction, command) {
    return this.#postReceiptInTransaction(
      transaction,
      providerReceiptCommand(command, CUSTOMER_RETURN_RECEIPT),
      CUSTOMER_RETURN_RECEIPT.authorization
    );
  }

  postIssue(command) {
    return this.database.withTransaction((transaction) => this.postIssueInTransaction(transaction, command));
  }

  postIssueInTransaction(transaction, command) {
    return this.#postIssueInTransaction(transaction, command, ISSUE_AUTHORIZATION);
  }

  postFulfillmentIssueInTransaction(transaction, command) {
    return this.#postIssueInTransaction(transaction,
      providerInventoryCommand(transaction, command, FULFILLMENT_ISSUE), FULFILLMENT_ISSUE.authorization);
  }

  async #postIssueInTransaction(transaction, command, expectedAuthorization) {
    const context = validateInventoryCommandContext(transaction, command, expectedAuthorization);
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    const payload = issuePayload(context.payload);
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(expectedAuthorization.requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }
    const postedAt = this.time.nowMs();
    const actorLabel = actor.username || `user:${context.actor.userId}`;
    const claim = await this.operations.claim(transaction, {
      commandType: "ISSUE_POST", source: context.source, payload: context.payload,
      actorUserId: context.actor.userId, actorLabel,
      requestId: context.correlationId, correlationId: context.correlationId, createdAt: postedAt
    });
    checkpoint(transaction, "operation");
    if (claim.replay) return issueFromSummary(claim.replay.resultSummary, payload);

    const [[scope]] = await transaction.query(
      "SELECT * FROM inventory_reservations WHERE id = ?", [payload.reservationId]
    );
    if (!scope) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const warehouseId = positiveId(scope.warehouse_id, "warehouseId");
    const skuId = positiveId(scope.sku_id, "skuId");
    const allocationIds = payload.lines.map(({ allocationId }) => allocationId).sort((a, b) => a - b);
    const [references] = await transaction.query(
      `SELECT a.id, a.reservation_id, a.stock_balance_id,
              b.warehouse_id, b.sku_id, b.bin_id, b.lot_id, b.stock_status
         FROM inventory_allocations a JOIN inventory_stock_balances b ON b.id = a.stock_balance_id
        WHERE a.id IN (${allocationIds.map(() => "?").join(", ")}) ORDER BY a.id`, allocationIds
    );
    if (references.length !== payload.lines.length || references.some((row) =>
      Number(row.reservation_id) !== payload.reservationId ||
      Number(row.warehouse_id) !== warehouseId || Number(row.sku_id) !== skuId)) {
      throw inventoryError("ALLOCATION_STATE_CONFLICT");
    }
    const byReference = new Map(references.map((row) => [Number(row.id), row]));
    if (payload.lines.some((line) => Number(byReference.get(line.allocationId)?.stock_balance_id) !== line.balanceId)) {
      throw inventoryError("ALLOCATION_STATE_CONFLICT");
    }
    const locked = await this.locks.lockForCommand(transaction, {
      warehouseIds: [warehouseId], stockControls: [{ warehouseId, skuId }],
      binIds: references.map((row) => Number(row.bin_id)),
      balances: references.map((row) => ({ warehouseId, skuId, binId: Number(row.bin_id),
        lotId: row.lot_id === null ? null : Number(row.lot_id), stockStatus: row.stock_status })),
      reservationIds: [payload.reservationId], now: postedAt
    });
    const warehouse = locked.warehouses.find((row) => Number(row.id) === warehouseId);
    if (!warehouse || warehouse.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
    if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
    const control = locked.stockControls.find((row) => Number(row.warehouse_id) === warehouseId &&
      Number(row.sku_id) === skuId);
    const reservation = locked.reservations.find((row) => Number(row.id) === payload.reservationId);
    if (!control || !reservation || Number(reservation.warehouse_id) !== warehouseId ||
        Number(reservation.sku_id) !== skuId) throw inventoryError("CONCURRENT_OPERATION");
    if (Number(reservation.version) !== payload.expectedVersion) throw inventoryError("VERSION_CONFLICT");
    if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(reservation.status)) {
      throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const original = safeQuantity(reservation.original_quantity, "originalQuantity");
    const consumed = safeQuantity(reservation.consumed_quantity, "consumedQuantity");
    const released = safeQuantity(reservation.released_quantity, "releasedQuantity");
    const outstanding = safeQuantity(reservation.outstanding_quantity, "outstandingQuantity");
    const reserved = safeQuantity(control.reserved_quantity, "reservedQuantity");
    if (original !== consumed + released + outstanding || payload.quantity > outstanding ||
        reserved < outstanding) throw inventoryError("RESERVATION_STATE_CONFLICT");
    const profile = await this.itemLookup.getInventoryProfileInTransaction(transaction, skuId);
    assertProfile(profile);
    const lotIds = [...new Set(references.flatMap((row) => row.lot_id === null ? [] : [Number(row.lot_id)]))];
    const [lots] = lotIds.length ? await transaction.query(
      `SELECT id, sku_id, lot_number, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date
         FROM inventory_lots WHERE id IN (${lotIds.map(() => "?").join(", ")})`, lotIds
    ) : [[]];
    const lotById = new Map(lots.map((row) => [Number(row.id), row]));
    const [allocations] = await transaction.query(
      `SELECT * FROM inventory_allocations WHERE id IN (${allocationIds.map(() => "?").join(", ")})
        ORDER BY id FOR UPDATE`, allocationIds
    );
    const byAllocation = new Map(allocations.map((row) => [Number(row.id), row]));
    const workingBalances = new Map(locked.balances.map((row) => [Number(row.id), {
      row, onHand: safeQuantity(row.on_hand_quantity, "onHandQuantity"),
      allocated: safeQuantity(row.allocated_quantity, "allocatedQuantity"), version: Number(row.version)
    }]));
    const currentDate = this.time.fileDate();
    const movementGroupId = this.createMovementGroupId();
    const resultLines = [];
    for (const line of payload.lines) {
      const reference = byReference.get(line.allocationId);
      const allocation = byAllocation.get(line.allocationId);
      const balance = workingBalances.get(line.balanceId);
      const bin = locked.bins.find((row) => Number(row.id) === Number(reference.bin_id));
      const lot = reference.lot_id === null ? null : lotById.get(Number(reference.lot_id));
      if (!allocation || Number(allocation.reservation_id) !== payload.reservationId ||
          Number(allocation.stock_balance_id) !== line.balanceId || !balance ||
          Number(balance.row.warehouse_id) !== warehouseId || Number(balance.row.sku_id) !== skuId ||
          Number(balance.row.bin_id) !== Number(reference.bin_id) ||
          (balance.row.lot_id === null ? null : Number(balance.row.lot_id)) !==
            (reference.lot_id === null ? null : Number(reference.lot_id)) ||
          balance.row.stock_status !== reference.stock_status) throw inventoryError("ALLOCATION_STATE_CONFLICT");
      if (!bin || Number(bin.warehouse_id) !== warehouseId || bin.status !== "ACTIVE") {
        throw inventoryError("BIN_INVALID");
      }
      if (balance.row.stock_status !== "AVAILABLE") throw inventoryError("STOCK_STATUS_INELIGIBLE");
      if ((profile.trackingPolicy === "none" && lot !== null) ||
          (profile.trackingPolicy !== "none" && (!lot || Number(lot.sku_id) !== skuId)) ||
          (profile.trackingPolicy === "batch_expiry" && !lot?.expiry_date)) {
        throw inventoryError("ALLOCATION_STATE_CONFLICT");
      }
      if (lot?.expiry_date && isInventoryLotExpired(lot.expiry_date, currentDate)) {
        throw inventoryError("LOT_EXPIRED");
      }
      if (!meetsMinimumRemainingLife(lot?.expiry_date ?? null, currentDate,
        Number(reservation.minimum_remaining_days))) throw inventoryError("LOT_MINIMUM_LIFE_FAILED");
      if (Number(allocation.version) !== line.expectedVersion || balance.version !== line.expectedBalanceVersion) {
        throw inventoryError("VERSION_CONFLICT");
      }
      if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(allocation.status)) {
        throw inventoryError("ALLOCATION_STATE_CONFLICT");
      }
      const allocationOriginal = safeQuantity(allocation.allocated_quantity, "allocatedQuantity");
      const allocationConsumed = safeQuantity(allocation.consumed_quantity, "consumedQuantity");
      const allocationReleased = safeQuantity(allocation.released_quantity, "releasedQuantity");
      const allocationOutstanding = safeQuantity(allocation.outstanding_quantity, "outstandingQuantity");
      if (allocationOriginal !== allocationConsumed + allocationReleased + allocationOutstanding ||
          line.quantity > allocationOutstanding || line.quantity > balance.onHand ||
          line.quantity > balance.allocated) throw inventoryError("ALLOCATION_INSUFFICIENT");
      const nextOnHand = balance.onHand - line.quantity;
      const nextAllocated = balance.allocated - line.quantity;
      const nextAllocationOutstanding = allocationOutstanding - line.quantity;
      const nextAllocationConsumed = allocationConsumed + line.quantity;
      const allocationStatus = nextAllocationOutstanding === 0 ? "CONSUMED" : "PARTIALLY_CONSUMED";
      const [balanceUpdate] = await transaction.execute(
        `UPDATE inventory_stock_balances SET on_hand_quantity = ?, allocated_quantity = ?,
                fifo_anchor_date = IF(? = 0, NULL, fifo_anchor_date),
                version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        [nextOnHand, nextAllocated, nextOnHand, postedAt, line.balanceId, balance.version]
      );
      if (Number(balanceUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      const [allocationUpdate] = await transaction.execute(
        `UPDATE inventory_allocations SET consumed_quantity = ?, outstanding_quantity = ?,
                status = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [nextAllocationConsumed, nextAllocationOutstanding, allocationStatus, postedAt,
          context.actor.userId, line.allocationId, line.expectedVersion]
      );
      if (Number(allocationUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      checkpoint(transaction, "current_state");
      const [movement] = await transaction.execute(
        `INSERT INTO inventory_movements
           (movement_group_id, operation_request_id, movement_type, location_kind,
            warehouse_id, bin_id, sku_id, lot_id, stock_status, direction, quantity,
            balance_before, balance_after, balance_version_after, reservation_id, allocation_id,
            transfer_id, transfer_line_id, stocktake_id, stocktake_line_id,
            reversal_of_movement_id, reason_category, reason_text, sku_code_snapshot,
            sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot, lot_number_snapshot,
            expiry_date_snapshot, posted_at, posted_by, posted_by_label)
         VALUES (?, ?, 'ISSUE', 'BIN', ?, ?, ?, ?, 'AVAILABLE', 'OUT', ?, ?, ?, ?, ?, ?,
                 NULL, NULL, NULL, NULL, NULL, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [movementGroupId, claim.operationId, warehouseId, Number(bin.id), skuId,
          lot ? Number(lot.id) : null, line.quantity, balance.onHand, nextOnHand, balance.version + 1,
          payload.reservationId, line.allocationId, profile.skuCode, profile.skuName,
          warehouse.warehouse_code, bin.bin_code, lot?.lot_number ?? "", lot?.expiry_date ?? null,
          postedAt, context.actor.userId, actorLabel]
      );
      const movementId = Number(movement.insertId);
      checkpoint(transaction, "movement");
      resultLines.push({ movementId, allocationId: line.allocationId, balanceId: line.balanceId,
        quantity: line.quantity, allocationVersion: line.expectedVersion + 1,
        balanceVersion: balance.version + 1 });
      balance.onHand = nextOnHand;
      balance.allocated = nextAllocated;
      balance.version += 1;
    }
    const nextConsumed = consumed + payload.quantity;
    const nextOutstanding = outstanding - payload.quantity;
    const status = nextOutstanding === 0 ? "CONSUMED" : "PARTIALLY_CONSUMED";
    if (!Number.isSafeInteger(nextConsumed) || original !== nextConsumed + released + nextOutstanding) {
      throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "quantity" });
    }
    const [controlUpdate] = await transaction.execute(
      `UPDATE inventory_stock_controls SET reserved_quantity = ?, version = version + 1,
              updated_at = ? WHERE id = ? AND version = ?`,
      [reserved - payload.quantity, postedAt, Number(control.id), Number(control.version)]
    );
    if (Number(controlUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const [reservationUpdate] = await transaction.execute(
      `UPDATE inventory_reservations SET consumed_quantity = ?, outstanding_quantity = ?,
              status = ?, version = version + 1, updated_at = ?, updated_by = ?
        WHERE id = ? AND version = ?`,
      [nextConsumed, nextOutstanding, status, postedAt, context.actor.userId,
        payload.reservationId, payload.expectedVersion]
    );
    if (Number(reservationUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    await this.audit.recordSucceeded(transaction, {
      actorUserId: context.actor.userId, actorLabel,
      action: "issue.post", targetType: "movement_group", targetId: resultLines[0].movementId,
      targetLabel: movementGroupId,
      beforeSummary: { reservationId: payload.reservationId, outstandingQuantity: outstanding,
        reservedQuantity: reserved },
      afterSummary: { reservationId: payload.reservationId, outstandingQuantity: nextOutstanding,
        consumedQuantity: nextConsumed, reservedQuantity: reserved - payload.quantity,
        quantity: payload.quantity, rowCount: resultLines.length, movementGroupId },
      operationRequestId: claim.operationId, requestId: context.correlationId,
      correlationId: context.correlationId, ip: ""
    });
    checkpoint(transaction, "audit");
    const result = { status: "POSTED", operationId: claim.operationId, movementGroupId,
      reservationId: payload.reservationId, version: payload.expectedVersion + 1,
      quantity: payload.quantity, lines: resultLines };
    await this.operations.complete(transaction, {
      operationId: claim.operationId, resultType: "MOVEMENT_GROUP", resultId: movementGroupId,
      resultSummary: { status: result.status, operationId: result.operationId,
        movementGroupId, reservationId: result.reservationId, version: result.version,
        quantity: result.quantity, rowCount: result.lines.length,
        allocationSnapshot: JSON.stringify(result.lines.map(({ movementId }) => movementId)) },
      completedAt: postedAt
    });
    return result;
  }

  async #postReceiptInTransaction(transaction, command, expectedAuthorization) {
    const context = validateInventoryCommandContext(transaction, command, expectedAuthorization);
    if (context.actor.userId === null) throw new TypeError("Receipt posting requires a user actor");
    const payload = receiptPayload(context.payload);
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(expectedAuthorization.requiredCallerPermission)) {
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

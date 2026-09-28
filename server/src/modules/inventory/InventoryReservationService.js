import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import {
  calculateInventoryAvailability,
  inventoryPositiveInteger,
  validateInventoryCommandContext
} from "./inventoryValidation.js";

const AUTHORIZATIONS = Object.freeze(Object.fromEntries(
  ["create", "release", "cancel"].map((action) => [action, Object.freeze({
    purpose: `reservation.${action}`,
    requiredCallerPermission: "inventory.operation"
  })])
));
const CREATE_FIELDS = new Set(["skuId", "warehouseId", "quantity", "purpose", "minimumRemainingDays"]);
const RELEASE_FIELDS = new Set(["reservationId", "expectedVersion", "quantity"]);
const CANCEL_FIELDS = new Set(["reservationId", "expectedVersion"]);

function positiveId(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 36_500) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return value;
}

function exactFields(value, allowed) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
}

function cutoffDate(currentDate, minimumRemainingDays) {
  const current = Date.parse(`${currentDate}T00:00:00.000Z`);
  if (!Number.isFinite(current) || new Date(current).toISOString().slice(0, 10) !== currentDate) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "currentDate" });
  }
  return new Date(current + minimumRemainingDays * 86_400_000).toISOString().slice(0, 10);
}

function safeQuantity(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw inventoryError("INVENTORY_QUANTITY_INVALID", { field });
  }
  return number;
}

function resultFromSummary(summary) {
  return {
    id: Number(summary.reservationId),
    operationId: Number(summary.operationId),
    warehouseId: Number(summary.warehouseId),
    skuId: Number(summary.skuId),
    purpose: summary.purpose,
    minimumRemainingDays: Number(summary.minimumRemainingDays),
    originalQuantity: Number(summary.originalQuantity),
    consumedQuantity: Number(summary.consumedQuantity),
    releasedQuantity: Number(summary.releasedQuantity),
    outstandingQuantity: Number(summary.outstandingQuantity),
    status: summary.status,
    version: Number(summary.version),
    ...(summary.eligibleOnHand === undefined ? {} : { availability: {
      eligibleOnHand: Number(summary.eligibleOnHand),
      reserved: Number(summary.reserved),
      rawAtp: Number(summary.rawAtp),
      atp: Number(summary.atp),
      uncoveredReserved: Number(summary.uncoveredReserved)
    } })
  };
}

function resultSummary(result) {
  return {
    reservationId: result.id,
    operationId: result.operationId,
    warehouseId: result.warehouseId,
    skuId: result.skuId,
    purpose: result.purpose,
    minimumRemainingDays: result.minimumRemainingDays,
    originalQuantity: result.originalQuantity,
    consumedQuantity: result.consumedQuantity,
    releasedQuantity: result.releasedQuantity,
    outstandingQuantity: result.outstandingQuantity,
    status: result.status,
    version: result.version,
    ...result.availability
  };
}

export class InventoryReservationService {
  constructor({ database, logger, time, itemLookup, authorize = assertActorFresh, audit, operations, locks } = {}) {
    if (!database || typeof database.withTransaction !== "function" || !time ||
        typeof time.nowMs !== "function" || typeof time.fileDate !== "function" ||
        typeof authorize !== "function") {
      throw new TypeError("InventoryReservationService requires database, time and authorization services");
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
    return this.database.withTransaction((transaction) => this.createInTransaction(transaction, command));
  }

  async createInTransaction(transaction, command) {
    const context = validateInventoryCommandContext(transaction, command, AUTHORIZATIONS.create);
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    exactFields(context.payload, CREATE_FIELDS);
    const payload = {
      skuId: positiveId(context.payload.skuId, "skuId"),
      warehouseId: positiveId(context.payload.warehouseId, "warehouseId"),
      quantity: inventoryPositiveInteger(context.payload.quantity),
      purpose: context.payload.purpose,
      minimumRemainingDays: nonNegativeInteger(context.payload.minimumRemainingDays, "minimumRemainingDays")
    };
    if (payload.purpose !== "SALE") throw inventoryError("INVENTORY_INPUT_INVALID", { field: "purpose" });

    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(AUTHORIZATIONS.create.requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }
    const profile = await this.itemLookup.getInventoryProfileInTransaction(transaction, payload.skuId);
    if (!profile) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
    if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
    if (!profile.usable) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
    const effectiveMinimum = Math.max(
      payload.minimumRemainingDays,
      nonNegativeInteger(profile.minimumSaleLifeDays ?? 0, "minimumSaleLifeDays")
    );
    const timestamp = this.time.nowMs();
    const actorLabel = actor.username || `user:${context.actor.userId}`;
    const claim = await this.operations.claim(transaction, {
      commandType: "RESERVATION_CREATE",
      source: context.source,
      payload,
      actorUserId: context.actor.userId,
      actorLabel,
      requestId: context.correlationId,
      correlationId: context.correlationId,
      createdAt: timestamp
    });
    if (claim.replay) return resultFromSummary(claim.replay.resultSummary);

    const locked = await this.locks.lockForCommand(transaction, {
      warehouseIds: [payload.warehouseId],
      stockControls: [{ warehouseId: payload.warehouseId, skuId: payload.skuId }],
      now: timestamp
    });
    const warehouse = locked.warehouses.find((row) => Number(row.id) === payload.warehouseId);
    if (!warehouse || warehouse.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
    const control = locked.stockControls.find((row) => Number(row.warehouse_id) === payload.warehouseId &&
      Number(row.sku_id) === payload.skuId);
    if (!control) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");

    const [[row]] = await transaction.query(
      `SELECT COALESCE(SUM(b.on_hand_quantity), 0) AS eligible_on_hand
         FROM inventory_stock_balances b
         LEFT JOIN inventory_lots l ON l.id = b.lot_id
        WHERE b.warehouse_id = ? AND b.sku_id = ? AND b.stock_status = 'AVAILABLE'
          AND (l.expiry_date IS NULL OR l.expiry_date >= ?)
        FOR SHARE OF b`,
      [payload.warehouseId, payload.skuId, cutoffDate(this.time.fileDate(), effectiveMinimum)]
    );
    const eligibleOnHand = safeQuantity(row?.eligible_on_hand, "eligibleOnHand");
    const reserved = safeQuantity(control.reserved_quantity, "reserved");
    const availability = calculateInventoryAvailability({ eligibleOnHand, reserved });
    if (availability.rawAtp < payload.quantity) {
      throw inventoryError("INSUFFICIENT_ATP", { requested: payload.quantity, ...availability });
    }
    const newReserved = reserved + payload.quantity;
    if (!Number.isSafeInteger(newReserved)) throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "reserved" });
    const [controlUpdate] = await transaction.execute(
      `UPDATE inventory_stock_controls
          SET reserved_quantity = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      [newReserved, timestamp, Number(control.id), Number(control.version)]
    );
    if (Number(controlUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const [inserted] = await transaction.execute(
      `INSERT INTO inventory_reservations
         (create_operation_id, warehouse_id, sku_id, original_quantity, outstanding_quantity,
          minimum_remaining_days, purpose, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      [claim.operationId, payload.warehouseId, payload.skuId, payload.quantity, payload.quantity,
        effectiveMinimum, payload.purpose, timestamp, timestamp, context.actor.userId, context.actor.userId]
    );
    const result = {
      id: Number(inserted.insertId), operationId: claim.operationId,
      warehouseId: payload.warehouseId, skuId: payload.skuId,
      purpose: payload.purpose, minimumRemainingDays: effectiveMinimum,
      originalQuantity: payload.quantity, consumedQuantity: 0, releasedQuantity: 0,
      outstandingQuantity: payload.quantity, status: "ACTIVE", version: 1,
      availability: calculateInventoryAvailability({ eligibleOnHand, reserved: newReserved })
    };
    await this.audit.recordSucceeded(transaction, {
      actorUserId: context.actor.userId, actorLabel,
      action: "reservation.create", targetType: "reservation", targetId: result.id,
      targetLabel: String(result.id),
      beforeSummary: { skuId: payload.skuId, warehouseId: payload.warehouseId, quantity: reserved },
      afterSummary: { reservationId: result.id, quantity: payload.quantity, status: result.status, version: 1 },
      operationRequestId: claim.operationId, requestId: context.correlationId,
      correlationId: context.correlationId, ip: ""
    });
    await this.operations.complete(transaction, {
      operationId: claim.operationId, resultType: "RESERVATION", resultId: String(result.id),
      resultSummary: resultSummary(result), completedAt: timestamp
    });
    return result;
  }

  release(command) {
    return this.database.withTransaction((transaction) => this.releaseInTransaction(transaction, command));
  }

  releaseInTransaction(transaction, command) {
    return this.#changeInTransaction(transaction, command, "release");
  }

  cancel(command) {
    return this.database.withTransaction((transaction) => this.cancelInTransaction(transaction, command));
  }

  cancelInTransaction(transaction, command) {
    return this.#changeInTransaction(transaction, command, "cancel");
  }

  async #changeInTransaction(transaction, command, action) {
    const context = validateInventoryCommandContext(transaction, command, AUTHORIZATIONS[action]);
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    exactFields(context.payload, action === "release" ? RELEASE_FIELDS : CANCEL_FIELDS);
    const reservationId = positiveId(context.payload.reservationId, "reservationId");
    const expectedVersion = positiveId(context.payload.expectedVersion, "expectedVersion");
    const requestedQuantity = action === "release"
      ? inventoryPositiveInteger(context.payload.quantity)
      : null;
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(AUTHORIZATIONS[action].requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }
    const timestamp = this.time.nowMs();
    const actorLabel = actor.username || `user:${context.actor.userId}`;
    const claim = await this.operations.claim(transaction, {
      commandType: `RESERVATION_${action.toUpperCase()}`,
      source: context.source,
      payload: context.payload,
      actorUserId: context.actor.userId,
      actorLabel,
      requestId: context.correlationId,
      correlationId: context.correlationId,
      createdAt: timestamp
    });
    if (claim.replay) return resultFromSummary(claim.replay.resultSummary);

    const [[scope]] = await transaction.query(
      "SELECT warehouse_id, sku_id FROM inventory_reservations WHERE id = ?",
      [reservationId]
    );
    if (!scope) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const warehouseId = positiveId(Number(scope.warehouse_id), "warehouseId");
    const skuId = positiveId(Number(scope.sku_id), "skuId");
    const locked = await this.locks.lockForCommand(transaction, {
      warehouseIds: [warehouseId], stockControls: [{ warehouseId, skuId }],
      reservationIds: [reservationId], now: timestamp
    });
    const warehouse = locked.warehouses.find((row) => Number(row.id) === warehouseId);
    if (!warehouse || warehouse.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
    const control = locked.stockControls.find((row) => Number(row.warehouse_id) === warehouseId &&
      Number(row.sku_id) === skuId);
    const reservation = locked.reservations.find((row) => Number(row.id) === reservationId);
    if (!control || !reservation) throw inventoryError("CONCURRENT_OPERATION");
    if (Number(reservation.warehouse_id) !== warehouseId || Number(reservation.sku_id) !== skuId) {
      throw inventoryError("CONCURRENT_OPERATION");
    }
    if (Number(reservation.version) !== expectedVersion) throw inventoryError("VERSION_CONFLICT");
    if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(reservation.status)) {
      throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const original = safeQuantity(reservation.original_quantity, "originalQuantity");
    const consumed = safeQuantity(reservation.consumed_quantity, "consumedQuantity");
    const released = safeQuantity(reservation.released_quantity, "releasedQuantity");
    const outstanding = safeQuantity(reservation.outstanding_quantity, "outstandingQuantity");
    if (original !== consumed + released + outstanding || outstanding === 0) {
      throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const quantity = requestedQuantity ?? outstanding;
    if (quantity > outstanding) throw inventoryError("RESERVATION_STATE_CONFLICT");
    const nextOutstanding = outstanding - quantity;
    const [[allocated]] = await transaction.query(
      `SELECT COALESCE(SUM(outstanding_quantity), 0) AS outstanding
         FROM inventory_allocations WHERE reservation_id = ? FOR SHARE`,
      [reservationId]
    );
    if (safeQuantity(allocated?.outstanding, "allocatedOutstanding") > nextOutstanding) {
      throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const controlReserved = safeQuantity(control.reserved_quantity, "reserved");
    if (controlReserved < quantity) throw inventoryError("RESERVATION_STATE_CONFLICT");
    const nextReleased = released + quantity;
    const nextVersion = expectedVersion + 1;
    if (!Number.isSafeInteger(nextReleased) || !Number.isSafeInteger(nextVersion) ||
        original !== consumed + nextReleased + nextOutstanding) {
      throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "quantity" });
    }
    const status = action === "cancel" ? "CANCELLED" : nextOutstanding === 0
      ? "RELEASED" : consumed > 0 ? "PARTIALLY_CONSUMED" : "ACTIVE";
    const [controlUpdate] = await transaction.execute(
      `UPDATE inventory_stock_controls
          SET reserved_quantity = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      [controlReserved - quantity, timestamp, Number(control.id), Number(control.version)]
    );
    if (Number(controlUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const [reservationUpdate] = await transaction.execute(
      `UPDATE inventory_reservations
          SET released_quantity = ?, outstanding_quantity = ?, status = ?,
              version = version + 1, updated_at = ?, updated_by = ?
        WHERE id = ? AND version = ?`,
      [nextReleased, nextOutstanding, status, timestamp, context.actor.userId,
        reservationId, expectedVersion]
    );
    if (Number(reservationUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const result = {
      id: reservationId, operationId: claim.operationId, warehouseId, skuId,
      purpose: reservation.purpose,
      minimumRemainingDays: Number(reservation.minimum_remaining_days),
      originalQuantity: original, consumedQuantity: consumed,
      releasedQuantity: nextReleased, outstandingQuantity: nextOutstanding,
      status, version: nextVersion
    };
    await this.audit.recordSucceeded(transaction, {
      actorUserId: context.actor.userId, actorLabel,
      action: `reservation.${action}`, targetType: "reservation", targetId: reservationId,
      targetLabel: String(reservationId),
      beforeSummary: { reservationId, quantity: outstanding, status: reservation.status, version: expectedVersion },
      afterSummary: { reservationId, quantity: nextOutstanding, status, version: nextVersion },
      operationRequestId: claim.operationId, requestId: context.correlationId,
      correlationId: context.correlationId, ip: ""
    });
    await this.operations.complete(transaction, {
      operationId: claim.operationId, resultType: "RESERVATION", resultId: String(reservationId),
      resultSummary: resultSummary(result), completedAt: timestamp
    });
    return result;
  }
}

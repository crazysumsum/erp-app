import { createHash } from "node:crypto";

import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService, inventoryOperationHash } from "./InventoryOperationService.js";
import { loadInventoryCandidates, recommendInventoryCandidates } from "./InventoryPickSequenceService.js";
import { inventoryError } from "./inventoryErrors.js";
import {
  assertInventoryTransaction,
  calculateInventoryAvailability,
  inventoryPositiveInteger,
  providerInventoryCommand,
  validateInventoryCommandContext
} from "./inventoryValidation.js";

const AUTHORIZATIONS = Object.freeze(Object.fromEntries(
  [["create", "reservation.create"], ["release", "reservation.release"],
    ["cancel", "reservation.cancel"], ["allocate", "allocation.create"],
    ["releaseAllocation", "allocation.release"],
    ["reallocateAllocation", "allocation.reallocate"]].map(([action, purpose]) => [action, Object.freeze({
    purpose,
    requiredCallerPermission: "inventory.operation"
  })])
));
const SALES_PROVIDER = { module: "SALES", documentType: "SALES_ORDER", permission: "sales.operation" };
const FULFILLMENT_PROVIDER = { module: "FULFILLMENT", documentType: "PICK", permission: "fulfillment.operation" };
function providerContract(action, provider) {
  return { authorization: { purpose: AUTHORIZATIONS[action].purpose,
    requiredCallerPermission: provider.permission },
  module: provider.module, documentType: provider.documentType };
}
const CREATE_FIELDS = new Set(["skuId", "warehouseId", "quantity", "purpose", "minimumRemainingDays"]);
const RELEASE_FIELDS = new Set(["reservationId", "expectedVersion", "quantity"]);
const CANCEL_FIELDS = new Set(["reservationId", "expectedVersion"]);
const ALLOCATE_FIELDS = new Set(["reservationId", "expectedVersion", "allocations", "overrideReason"]);
const ALLOCATION_FIELDS = new Set(["balanceId", "expectedVersion", "quantity"]);
const ALLOCATION_RELEASE_FIELDS = new Set(["reservationId", "expectedVersion", "releases"]);
const REALLOCATE_FIELDS = new Set(["reservationId", "expectedVersion", "releases", "allocations", "overrideReason"]);
const ALLOCATION_RELEASE_LINE_FIELDS = new Set(["allocationId", "expectedVersion", "quantity"]);
const RELEASE_STATUSES = ["ACTIVE", "PARTIALLY_CONSUMED", "RELEASED"];
const CANDIDATE_FIELDS = new Set(["reservationId", "requestedQuantity", "page"]);

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

function allocationResultFromSummary(summary) {
  return {
    reservationId: Number(summary.reservationId), operationId: Number(summary.operationId),
    version: Number(summary.version), quantity: Number(summary.quantity),
    allocations: JSON.parse(summary.allocationSnapshot).map(
      ([id, balanceId, quantity, balanceVersion, fefo, overridden]) => ({
        id, balanceId, quantity, version: 1, balanceVersion,
        selectionStrategy: fefo ? "FEFO" : "FIFO", isSequenceOverride: Boolean(overridden)
      })
    )
  };
}

function allocationLines(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "allocations" });
  }
  const lines = value.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "allocations" });
    }
    exactFields(line, ALLOCATION_FIELDS);
    return {
      balanceId: positiveId(line.balanceId, "balanceId"),
      expectedVersion: positiveId(line.expectedVersion, "expectedVersion"),
      quantity: inventoryPositiveInteger(line.quantity)
    };
  });
  if (new Set(lines.map(({ balanceId }) => balanceId)).size !== lines.length) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "allocations" });
  }
  return lines;
}

function allocationReleaseLines(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "releases" });
  }
  const lines = value.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "releases" });
    }
    exactFields(line, ALLOCATION_RELEASE_LINE_FIELDS);
    return { allocationId: positiveId(line.allocationId, "allocationId"),
      expectedVersion: positiveId(line.expectedVersion, "expectedVersion"),
      quantity: inventoryPositiveInteger(line.quantity) };
  });
  if (new Set(lines.map(({ allocationId }) => allocationId)).size !== lines.length) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "releases" });
  }
  return lines;
}

function allocationReleaseFromSummary(summary, lines) {
  const snapshot = JSON.parse(summary.allocationSnapshot);
  return { reservationId: Number(summary.reservationId), operationId: Number(summary.operationId),
    version: Number(summary.version), quantity: Number(summary.quantity),
    allocations: lines.map((line, index) => ({ id: line.allocationId,
      balanceId: Number(snapshot[index][0]), quantity: line.quantity,
      releasedQuantity: Number(snapshot[index][1]), outstandingQuantity: Number(snapshot[index][2]),
      status: RELEASE_STATUSES[snapshot[index][3]], version: line.expectedVersion + 1,
      balanceVersion: Number(snapshot[index][4]) })) };
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

  async #salesBatchContext(transaction, command, action) {
    const raw = command?.payload;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "payload" });
    exactFields(raw, new Set(action === "reserve" ? ["warehouseId", "expectedOrderVersion", "lines"] :
      action === "release" ? ["warehouseId", "expectedOrderVersion", "intent"] : ["warehouseId", "afterId"]));
    const payload = { warehouseId: positiveId(raw.warehouseId, "warehouseId") };
    if (action === "states") {
      payload.afterId = raw.afterId ?? 0;
      if (!Number.isSafeInteger(payload.afterId) || payload.afterId < 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "afterId" });
    } else payload.expectedOrderVersion = positiveId(raw.expectedOrderVersion, "expectedOrderVersion");
    if (action === "reserve") {
      if (!Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > 100) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
      payload.lines = raw.lines.map(line => {
        if (!line || typeof line !== "object" || Array.isArray(line)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
        exactFields(line, new Set(["sourceLineId", "skuId", "orderedBaseQuantity", "minimumRemainingDays"]));
        return { sourceLineId: positiveId(line.sourceLineId, "sourceLineId"), skuId: positiveId(line.skuId, "skuId"),
          orderedBaseQuantity: inventoryPositiveInteger(line.orderedBaseQuantity),
          minimumRemainingDays: nonNegativeInteger(line.minimumRemainingDays, "minimumRemainingDays") };
      }).sort((a, b) => a.skuId - b.skuId || a.sourceLineId - b.sourceLineId);
      if (new Set(payload.lines.map(line => line.sourceLineId)).size !== payload.lines.length) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "sourceLineId" });
    } else if (action === "release") {
      if (raw.intent !== "ALL_OUTSTANDING") throw inventoryError("INVENTORY_INPUT_INVALID", { field: "intent" });
      payload.intent = raw.intent;
    }
    // Fixed scalars and 100 demand lines bound serialization before the generic JSON copier/hash.
    if (Buffer.byteLength(JSON.stringify(payload)) > 65_536) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "payload" });
    const contract = { module: "SALES", documentType: "SALES_ORDER",
      authorization: { purpose: `sales.batch.${action}`, requiredCallerPermission: "sales.mgmt" } };
    const context = validateInventoryCommandContext(transaction,
      providerInventoryCommand(transaction, { ...command, payload }, contract), contract.authorization);
    if (context.actor.userId === null || context.actor.serviceName !== "" || context.source.lineId !== "" ||
        !/^[1-9][0-9]*$/u.test(context.source.documentId) || !Number.isSafeInteger(Number(context.source.documentId))) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "source/actor" });
    }
    const actor = await this.authorize(transaction, { actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles, claimedPermissions: context.actor.claimedPermissions });
    if (!actor?.permissions?.includes("sales.mgmt")) throw inventoryError("PERMISSION_STALE");
    return { ...context, actorLabel: actor.username || `user:${context.actor.userId}`, timestamp: this.time.nowMs() };
  }

  #salesClaimInput(context, commandType, payload, lineId = "") {
    return { commandType, payload, source: { ...context.source, lineId }, actorUserId: context.actor.userId,
      actorLabel: context.actorLabel, requestId: context.correlationId, correlationId: context.correlationId, createdAt: context.timestamp };
  }

  async #salesStockScope(transaction, context, skuIds) {
    const locked = await this.locks.lockForCommand(transaction, { warehouseIds: [context.payload.warehouseId],
      stockControls: skuIds.map(skuId => ({ warehouseId: context.payload.warehouseId, skuId })), now: context.timestamp });
    if (locked.warehouses[0]?.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
    const controls = new Map(locked.stockControls.map(row => [Number(row.sku_id), { ...row, reserved: safeQuantity(row.reserved_quantity, "reserved") }]));
    if (controls.size !== skuIds.length) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    return controls;
  }

  async #saveSalesControls(transaction, context, controls) {
    for (const control of controls.values()) {
      if (control.reserved === Number(control.reserved_quantity)) continue;
      const [updated] = await transaction.execute(
        `UPDATE inventory_stock_controls SET reserved_quantity = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        [control.reserved, context.timestamp, Number(control.id), Number(control.version)]);
      if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    }
  }

  async #verifySalesMembers(transaction, context, root, rootHash, type, expectedLines = null) {
    const summary = root.replay.resultSummary;
    if (!summary || root.replay.resultType !== (type === "SALES_LINE_RESERVE" ? "SALES_RESERVATION_BATCH" : "SALES_RELEASE_BATCH") ||
        root.replay.resultId !== context.source.documentId || summary.operationId !== root.operationId || summary.warehouseId !== context.payload.warehouseId ||
        summary.expectedOrderVersion !== context.payload.expectedOrderVersion || !Number.isSafeInteger(summary.lineCount) || summary.lineCount < 0) {
      throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    }
    let afterId = 0, count = 0;
    const digest = createHash("sha256");
    const lines = [];
    for (;;) {
      const page = await this.operations.listSalesBatchMembers(transaction, { source: context.source, afterId });
      if (!page.length) break;
      for (const member of page) {
        const s = member.resultSummary;
        if (member.operationId <= afterId || member.commandType !== type || member.completedAt === null || member.completedAt === undefined ||
            !s || s.rootOperationId !== root.operationId || s.rootRequestHash !== rootHash) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        const input = type === "SALES_LINE_RESERVE" ? expectedLines?.[count] : {
          reservationId: s.reservationId, sourceLineId: s.sourceLineId, skuId: s.skuId,
          expectedVersion: s.expectedVersion, releaseQuantity: s.releaseQuantity };
        if (!input || member.sourceLineId !== (type === "SALES_LINE_RESERVE" ? String(input.sourceLineId) : `reservation:${input.reservationId}`) ||
            member.requestHash !== inventoryOperationHash({ commandType: type, payload: { rootOperationId: root.operationId, rootRequestHash: rootHash, ...input } })) {
          throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        }
        digest.update(`${member.sourceLineId}:${member.requestHash}\n`);
        if (expectedLines) {
          if (s.sourceLineId !== input.sourceLineId || s.skuId !== input.skuId ||
              safeQuantity(s.reservedBaseQuantity, "reserved") + safeQuantity(s.uncoveredBaseQuantity, "uncovered") !== input.orderedBaseQuantity ||
              (s.reservedBaseQuantity === 0 ? s.reservationId !== null || s.version !== null : !Number.isSafeInteger(s.reservationId) || s.reservationId <= 0 || s.version !== 1)) {
            throw inventoryError("INVENTORY_SOURCE_CONFLICT");
          }
          lines.push(s);
        }
        afterId = member.operationId;
        count++;
      }
    }
    if (count !== summary.lineCount || (expectedLines && count !== expectedLines.length) || digest.digest("hex") !== summary.membershipDigest) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    return { operationId: root.operationId, lineCount: count, membershipDigest: summary.membershipDigest, ...(expectedLines ? { lines } : {}) };
  }

  async reserveAvailableForSalesBatchInTransaction(transaction, command) {
    const context = await this.#salesBatchContext(transaction, command, "reserve");
    const rootInput = this.#salesClaimInput(context, "SALES_BATCH_RESERVE", context.payload);
    const rootHash = inventoryOperationHash(rootInput);
    const root = await this.operations.claim(transaction, rootInput);
    if (root.replay) return this.#verifySalesMembers(transaction, context, root, rootHash, "SALES_LINE_RESERVE", context.payload.lines);
    const digest = createHash("sha256");
    const members = [];
    for (const line of context.payload.lines) {
      const input = this.#salesClaimInput(context, "SALES_LINE_RESERVE", { rootOperationId: root.operationId, rootRequestHash: rootHash, ...line }, String(line.sourceLineId));
      const child = await this.operations.claim(transaction, input);
      if (child.replay) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
      digest.update(`${input.source.lineId}:${inventoryOperationHash(input)}\n`);
      members.push({ ...line, operationId: child.operationId });
    }
    const skuIds = [...new Set(members.map(line => line.skuId))];
    const profiles = await this.itemLookup.getSalesInventoryProfilesInTransaction(transaction, skuIds, { atMs: context.timestamp });
    for (const line of members) {
      const profile = profiles.get(line.skuId);
      if (!profile?.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
      if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
      line.minimumRemainingDays = Math.max(line.minimumRemainingDays, nonNegativeInteger(profile.minimumSaleLifeDays ?? 0, "minimumSaleLifeDays"));
    }
    const controls = await this.#salesStockScope(transaction, context, skuIds);
    // Lock current lots before balances, in bounded pages; all stock writers share the control scope.
    let lotSku = 0, lotNumber = "";
    for (;;) {
      const [lots] = await transaction.query(
        `SELECT sku_id, normalized_lot_number FROM inventory_lots WHERE sku_id IN (${skuIds.map(() => "?").join(",")})
           AND (sku_id > ? OR (sku_id = ? AND normalized_lot_number > ?))
         ORDER BY sku_id, normalized_lot_number LIMIT 100 FOR SHARE`, [...skuIds, lotSku, lotSku, lotNumber]);
      if (!lots.length) break;
      lotSku = Number(lots.at(-1).sku_id); lotNumber = lots.at(-1).normalized_lot_number;
    }
    const [available] = await transaction.query(
      `SELECT d.source_line_id, COALESCE(SUM(b.on_hand_quantity), 0) AS eligible_on_hand
         FROM (${members.map(() => "SELECT ? AS source_line_id, ? AS sku_id, ? AS cutoff").join(" UNION ALL ")}) d
         LEFT JOIN inventory_stock_balances b ON b.warehouse_id = ? AND b.sku_id = d.sku_id AND b.stock_status = 'AVAILABLE'
         LEFT JOIN inventory_lots l ON l.id = b.lot_id
        WHERE l.expiry_date IS NULL OR l.expiry_date >= d.cutoff
        GROUP BY d.source_line_id FOR SHARE OF b, l`,
      [...members.flatMap(line => [line.sourceLineId, line.skuId, cutoffDate(this.time.fileDate(), line.minimumRemainingDays)]), context.payload.warehouseId]);
    const quantities = new Map(available.map(row => [Number(row.source_line_id), safeQuantity(row.eligible_on_hand, "eligibleOnHand")]));
    const lines = [];
    for (const line of members) {
      const control = controls.get(line.skuId);
      const reserved = Math.min(line.orderedBaseQuantity, Math.max((quantities.get(line.sourceLineId) ?? 0) - control.reserved, 0));
      control.reserved = safeQuantity(control.reserved + reserved, "reserved");
      let reservationId = null;
      if (reserved) {
        const [inserted] = await transaction.execute(
          `INSERT INTO inventory_reservations (create_operation_id, warehouse_id, sku_id, original_quantity, outstanding_quantity,
             minimum_remaining_days, purpose, status, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 'SALE', 'ACTIVE', ?, ?, ?, ?)`,
          [line.operationId, context.payload.warehouseId, line.skuId, reserved, reserved, line.minimumRemainingDays,
            context.timestamp, context.timestamp, context.actor.userId, context.actor.userId]);
        reservationId = positiveId(Number(inserted.insertId), "reservationId");
        await this.audit.recordSucceeded(transaction, { actorUserId: context.actor.userId, actorLabel: context.actorLabel,
          action: "reservation.create", targetType: "reservation", targetId: reservationId, targetLabel: String(reservationId),
          beforeSummary: null, afterSummary: { reservationId, quantity: reserved, status: "ACTIVE", version: 1 },
          operationRequestId: line.operationId, requestId: context.correlationId, correlationId: context.correlationId, ip: "" });
      }
      const result = { rootOperationId: root.operationId, rootRequestHash: rootHash, sourceLineId: line.sourceLineId, skuId: line.skuId,
        orderedBaseQuantity: line.orderedBaseQuantity, reservedBaseQuantity: reserved, uncoveredBaseQuantity: line.orderedBaseQuantity - reserved,
        reservationId, version: reserved ? 1 : null, minimumRemainingDays: line.minimumRemainingDays };
      await this.operations.complete(transaction, { operationId: line.operationId, resultType: "SALES_RESERVATION_LINE",
        resultId: String(line.sourceLineId), resultSummary: result, completedAt: context.timestamp });
      lines.push(result);
    }
    await this.#saveSalesControls(transaction, context, controls);
    const membershipDigest = digest.digest("hex");
    await this.operations.complete(transaction, { operationId: root.operationId, resultType: "SALES_RESERVATION_BATCH", resultId: context.source.documentId,
      resultSummary: { operationId: root.operationId, warehouseId: context.payload.warehouseId, expectedOrderVersion: context.payload.expectedOrderVersion,
        lineCount: lines.length, membershipDigest }, completedAt: context.timestamp });
    return { operationId: root.operationId, lineCount: lines.length, membershipDigest, lines };
  }

  async getSalesReservationStatesInTransaction(transaction, command) {
    const context = await this.#salesBatchContext(transaction, command, "states");
    return this.#salesOwnedReservationPage(transaction, context, context.payload.afterId, false, true);
  }

  async #salesOwnedReservationPage(transaction, context, afterId, outstandingOnly, current = false) {
    const [rows] = await transaction.query(
      `SELECT r.*, o.source_line_id FROM inventory_reservations r JOIN inventory_operation_requests o ON o.id = r.create_operation_id
        WHERE o.source_module = 'SALES' AND o.source_document_type = 'SALES_ORDER' AND o.source_document_id = ?
          AND r.warehouse_id = ? AND r.id > ? ${outstandingOnly ? "AND r.outstanding_quantity > 0" : ""}
        ORDER BY r.id LIMIT 100 ${current ? "FOR SHARE OF r, o" : ""}`, [context.source.documentId, context.payload.warehouseId, afterId]);
    return { rows, nextCursor: rows.length === 100 ? Number(rows.at(-1).id) : null };
  }

  async releaseSalesBatchInTransaction(transaction, command) {
    const context = await this.#salesBatchContext(transaction, command, "release");
    const rootInput = this.#salesClaimInput(context, "SALES_BATCH_RELEASE", context.payload);
    const rootHash = inventoryOperationHash(rootInput);
    const root = await this.operations.claim(transaction, rootInput);
    const skuIds = new Set();
    if (!root.replay) {
      let afterId = 0, lineCount = 0;
      const digest = createHash("sha256");
      for (;;) {
        const { rows } = await this.#salesOwnedReservationPage(transaction, context, afterId, true);
        if (!rows.length) break;
        for (const row of rows) {
          const reservationId = positiveId(Number(row.id), "reservationId");
          if (reservationId <= afterId || !/^[1-9][0-9]*$/u.test(row.source_line_id)) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
          const member = { reservationId, sourceLineId: positiveId(Number(row.source_line_id), "sourceLineId"), skuId: positiveId(Number(row.sku_id), "skuId"),
            expectedVersion: positiveId(Number(row.version), "expectedVersion"), releaseQuantity: inventoryPositiveInteger(Number(row.outstanding_quantity)) };
          skuIds.add(member.skuId);
          const input = this.#salesClaimInput(context, "SALES_LINE_RELEASE", { rootOperationId: root.operationId, rootRequestHash: rootHash, ...member }, `reservation:${reservationId}`);
          const child = await this.operations.claim(transaction, input);
          if (child.replay) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
          await this.operations.stageSalesBatchMember(transaction, { operationId: child.operationId, resultSummary: input.payload });
          digest.update(`${input.source.lineId}:${inventoryOperationHash(input)}\n`);
          afterId = reservationId; lineCount++;
        }
      }
      const controls = await this.#salesStockScope(transaction, context, [...skuIds].sort((a, b) => a - b));
      let childId = 0, completed = 0;
      for (;;) {
        const page = await this.operations.listSalesBatchMembers(transaction, { source: context.source, afterId: childId });
        if (!page.length) break;
        const ids = page.map(member => member.resultSummary.reservationId);
        const [rows] = await transaction.query(`SELECT * FROM inventory_reservations WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, ids);
        const [allocations] = await transaction.query(`SELECT reservation_id, COALESCE(SUM(outstanding_quantity), 0) AS outstanding
          FROM inventory_allocations WHERE reservation_id IN (${ids.map(() => "?").join(",")}) GROUP BY reservation_id FOR SHARE`, ids);
        const byId = new Map(rows.map(row => [Number(row.id), row]));
        if (allocations.some(row => safeQuantity(row.outstanding, "allocatedOutstanding") !== 0)) throw inventoryError("RESERVATION_STATE_CONFLICT");
        for (const child of page) {
          const s = child.resultSummary, row = byId.get(s.reservationId), control = controls.get(s.skuId);
          if (child.commandType !== "SALES_LINE_RELEASE" || child.completedAt || !row || !control ||
              s.rootOperationId !== root.operationId || s.rootRequestHash !== rootHash || Number(row.warehouse_id) !== context.payload.warehouseId ||
              Number(row.sku_id) !== s.skuId || Number(row.version) !== s.expectedVersion ||
              safeQuantity(row.outstanding_quantity, "outstanding") !== s.releaseQuantity) throw inventoryError("VERSION_CONFLICT");
          const original = safeQuantity(row.original_quantity, "original"), consumed = safeQuantity(row.consumed_quantity, "consumed"), released = safeQuantity(row.released_quantity, "released");
          if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(row.status) || original !== consumed + released + s.releaseQuantity || control.reserved < s.releaseQuantity) throw inventoryError("RESERVATION_STATE_CONFLICT");
          const version = safeQuantity(s.expectedVersion + 1, "version"), nextReleased = safeQuantity(released + s.releaseQuantity, "released");
          const [updated] = await transaction.execute(`UPDATE inventory_reservations SET released_quantity = ?, outstanding_quantity = 0,
            status = 'RELEASED', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?`,
          [nextReleased, context.timestamp, context.actor.userId, s.reservationId, s.expectedVersion]);
          if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
          control.reserved -= s.releaseQuantity;
          await this.audit.recordSucceeded(transaction, { actorUserId: context.actor.userId, actorLabel: context.actorLabel,
            action: "reservation.release", targetType: "reservation", targetId: s.reservationId, targetLabel: String(s.reservationId),
            beforeSummary: { reservationId: s.reservationId, quantity: s.releaseQuantity, status: row.status, version: s.expectedVersion },
            afterSummary: { reservationId: s.reservationId, quantity: 0, status: "RELEASED", version }, operationRequestId: child.operationId,
            requestId: context.correlationId, correlationId: context.correlationId, ip: "" });
          await this.operations.complete(transaction, { operationId: child.operationId, resultType: "SALES_RELEASE_LINE", resultId: String(s.reservationId),
            resultSummary: { ...s, version, releasedQuantity: nextReleased, outstandingQuantity: 0, status: "RELEASED" }, completedAt: context.timestamp });
          childId = child.operationId; completed++;
        }
      }
      if (completed !== lineCount) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
      // Discovery can predate a waiting claim under RR. Current locked ownership must contain no omitted outstanding member.
      if ((await this.#salesOwnedReservationPage(transaction, context, 0, true, true)).rows.length) throw inventoryError("CONCURRENT_OPERATION");
      await this.#saveSalesControls(transaction, context, controls);
      const summary = { operationId: root.operationId, warehouseId: context.payload.warehouseId, expectedOrderVersion: context.payload.expectedOrderVersion,
        lineCount, membershipDigest: digest.digest("hex") };
      await this.operations.complete(transaction, { operationId: root.operationId, resultType: "SALES_RELEASE_BATCH", resultId: context.source.documentId, resultSummary: summary, completedAt: context.timestamp });
      root.replay = { resultType: "SALES_RELEASE_BATCH", resultId: context.source.documentId, resultSummary: summary };
    }
    const result = await this.#verifySalesMembers(transaction, context, root, rootHash, "SALES_LINE_RELEASE");
    const operations = this.operations;
    result.results = (async function* () {
      let afterId = 0, count = 0;
      const digest = createHash("sha256");
      for (;;) {
        const page = await operations.listSalesBatchMembers(transaction, { source: context.source, afterId });
        if (!page.length) break;
        for (const child of page) { digest.update(`${child.sourceLineId}:${child.requestHash}\n`); count++; afterId = child.operationId; }
        yield page.map(child => child.resultSummary);
      }
      if (count !== result.lineCount || digest.digest("hex") !== result.membershipDigest) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    })();
    return result;
  }

  create(command) {
    return this.database.withTransaction((transaction) => this.createInTransaction(transaction, command));
  }

  createInTransaction(transaction, command) {
    return this.#createInTransaction(transaction, command, AUTHORIZATIONS.create);
  }

  createSalesReservationInTransaction(transaction, command) {
    const contract = providerContract("create", SALES_PROVIDER);
    return this.#createInTransaction(transaction,
      providerInventoryCommand(transaction, command, contract), contract.authorization);
  }

  async #createInTransaction(transaction, command, expectedAuthorization) {
    const context = validateInventoryCommandContext(transaction, command, expectedAuthorization);
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
    if (!actor?.permissions?.includes(expectedAuthorization.requiredCallerPermission)) {
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
    return this.#changeInTransaction(transaction, command, "release", AUTHORIZATIONS.release);
  }

  releaseSalesReservationInTransaction(transaction, command) {
    const contract = providerContract("release", SALES_PROVIDER);
    return this.#changeInTransaction(transaction,
      providerInventoryCommand(transaction, command, contract), "release", contract.authorization);
  }

  cancel(command) {
    return this.database.withTransaction((transaction) => this.cancelInTransaction(transaction, command));
  }

  cancelInTransaction(transaction, command) {
    return this.#changeInTransaction(transaction, command, "cancel", AUTHORIZATIONS.cancel);
  }

  cancelSalesReservationInTransaction(transaction, command) {
    const contract = providerContract("cancel", SALES_PROVIDER);
    return this.#changeInTransaction(transaction,
      providerInventoryCommand(transaction, command, contract), "cancel", contract.authorization);
  }

  listAllocationCandidates(query) {
    return this.database.withTransaction((transaction) => this.listAllocationCandidatesInTransaction(transaction, query));
  }

  async listFulfillmentAllocationCandidatesInTransaction(transaction, request) {
    assertInventoryTransaction(transaction);
    exactFields(request, new Set(["actor", "query"]));
    const authorization = { purpose: "allocation.candidates", requiredCallerPermission: "fulfillment.operation" };
    const context = validateInventoryCommandContext(transaction, {
      actor: request.actor, authorization,
      source: { module: "FULFILLMENT", documentType: "PICK", documentId: "candidate", eventId: "candidate" },
      correlationId: "", payload: request.query
    }, authorization);
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(authorization.requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }
    return this.listAllocationCandidatesInTransaction(transaction, context.payload);
  }

  async listAllocationCandidatesInTransaction(transaction, query) {
    assertInventoryTransaction(transaction);
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "query" });
    }
    exactFields(query, CANDIDATE_FIELDS);
    const reservationId = positiveId(query.reservationId, "reservationId");
    const requestedQuantity = inventoryPositiveInteger(query.requestedQuantity);
    const page = positiveId(query.page ?? 1, "page");
    if (page > Math.floor(Number.MAX_SAFE_INTEGER / 100)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "page" });
    }
    const [[reservation]] = await transaction.query(
      `SELECT r.*, w.status AS warehouse_status FROM inventory_reservations r
         JOIN inventory_warehouses w ON w.id = r.warehouse_id WHERE r.id = ?`, [reservationId]
    );
    if (!reservation) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    if (reservation.warehouse_status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
    if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(reservation.status)) {
      throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const [[allocated]] = await transaction.query(
      "SELECT COALESCE(SUM(outstanding_quantity), 0) AS outstanding FROM inventory_allocations WHERE reservation_id = ?",
      [reservationId]
    );
    const unallocatedQuantity = safeQuantity(reservation.outstanding_quantity, "outstandingQuantity") -
      safeQuantity(allocated?.outstanding, "allocatedOutstanding");
    if (requestedQuantity > unallocatedQuantity) {
      throw inventoryError("ALLOCATION_INSUFFICIENT", { requested: requestedQuantity });
    }
    const profile = await this.itemLookup.getInventoryProfileInTransaction(transaction, Number(reservation.sku_id));
    if (!profile?.usable || !profile.inventoryTracked || profile.trackingPolicy === "serial") {
      throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    }
    const asOf = this.time.fileDate();
    const rows = await loadInventoryCandidates(transaction, {
      warehouseId: Number(reservation.warehouse_id), skuId: Number(reservation.sku_id),
      currentDate: asOf, minimumRemainingDays: Number(reservation.minimum_remaining_days),
      trackingPolicy: profile.trackingPolicy,
      limit: 101, offset: (page - 1) * 100
    });
    return {
      reservationId, requestedQuantity, asOf,
      reservationVersion: Number(reservation.version), unallocatedQuantity,
      page, hasMore: rows.length > 100,
      items: rows.slice(0, 100).map((row, index) => ({
        balanceId: row.id, binId: row.binId, lotId: row.lotId,
        expiryDate: row.expiryDate, firstReceiptDate: row.firstReceiptDate,
        fifoAnchorDate: row.fifoAnchorDate, freeQuantity: row.freeQuantity,
        balanceVersion: row.version, selectionStrategy: row.expiryDate ? "FEFO" : "FIFO",
        rank: (page - 1) * 100 + index + 1
      }))
    };
  }

  allocate(command) {
    return this.database.withTransaction((transaction) => this.allocateInTransaction(transaction, command));
  }

  releaseAllocation(command) {
    return this.database.withTransaction((transaction) => this.releaseAllocationInTransaction(transaction, command));
  }

  releaseAllocationInTransaction(transaction, command) {
    return this.#releaseAllocationInTransaction(transaction, command, AUTHORIZATIONS.releaseAllocation);
  }

  releaseFulfillmentAllocationInTransaction(transaction, command) {
    const contract = providerContract("releaseAllocation", FULFILLMENT_PROVIDER);
    return this.#releaseAllocationInTransaction(transaction,
      providerInventoryCommand(transaction, command, contract), contract.authorization);
  }

  async #releaseAllocationInTransaction(transaction, command, expectedAuthorization) {
    const context = validateInventoryCommandContext(transaction, command, expectedAuthorization);
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    exactFields(context.payload, ALLOCATION_RELEASE_FIELDS);
    const reservationId = positiveId(context.payload.reservationId, "reservationId");
    const expectedVersion = positiveId(context.payload.expectedVersion, "expectedVersion");
    const lines = allocationReleaseLines(context.payload.releases);
    const quantity = lines.reduce((total, line) => total + line.quantity, 0);
    if (!Number.isSafeInteger(quantity)) throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "quantity" });
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(expectedAuthorization.requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }
    const timestamp = this.time.nowMs();
    const actorLabel = actor.username || `user:${context.actor.userId}`;
    const claim = await this.operations.claim(transaction, {
      commandType: "ALLOCATION_RELEASE", source: context.source, payload: context.payload,
      actorUserId: context.actor.userId, actorLabel,
      requestId: context.correlationId, correlationId: context.correlationId, createdAt: timestamp
    });
    if (claim.replay) return allocationReleaseFromSummary(claim.replay.resultSummary, lines);
    return this.#releaseAllocationsWithClaim(transaction, {
      context, reservationId, expectedVersion, lines, quantity, claim, actorLabel, timestamp
    });
  }

  async #releaseAllocationsWithClaim(transaction, {
    context, reservationId, expectedVersion, lines, quantity, claim, actorLabel, timestamp,
    auditAction = "allocation.release", complete = true, bumpReservationVersion = true
  }) {
    const [[scope]] = await transaction.query(
      "SELECT warehouse_id, sku_id FROM inventory_reservations WHERE id = ?", [reservationId]
    );
    if (!scope) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const warehouseId = positiveId(Number(scope.warehouse_id), "warehouseId");
    const skuId = positiveId(Number(scope.sku_id), "skuId");
    const allocationIds = lines.map(({ allocationId }) => allocationId).sort((left, right) => left - right);
    const [references] = await transaction.query(
      `SELECT a.id, a.reservation_id, a.stock_balance_id, b.warehouse_id, b.sku_id,
              b.bin_id, b.lot_id, b.stock_status
         FROM inventory_allocations a JOIN inventory_stock_balances b ON b.id = a.stock_balance_id
        WHERE a.id IN (${allocationIds.map(() => "?").join(", ")}) ORDER BY a.id`, allocationIds
    );
    if (references.length !== lines.length || references.some((row) =>
      Number(row.reservation_id) !== reservationId || Number(row.warehouse_id) !== warehouseId ||
      Number(row.sku_id) !== skuId)) throw inventoryError("ALLOCATION_STATE_CONFLICT");
    const locked = await this.locks.lockForCommand(transaction, {
      warehouseIds: [warehouseId], stockControls: [{ warehouseId, skuId }],
      binIds: references.map((row) => Number(row.bin_id)),
      balances: references.map((row) => ({ warehouseId, skuId, binId: Number(row.bin_id),
        lotId: row.lot_id === null ? null : Number(row.lot_id), stockStatus: row.stock_status })),
      reservationIds: [reservationId], now: timestamp
    });
    if (!locked.warehouses.some((row) => Number(row.id) === warehouseId && row.status === "ACTIVE")) {
      throw inventoryError("WAREHOUSE_INVALID");
    }
    if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
    const reservation = locked.reservations.find((row) => Number(row.id) === reservationId);
    if (!reservation || Number(reservation.warehouse_id) !== warehouseId || Number(reservation.sku_id) !== skuId) {
      throw inventoryError("CONCURRENT_OPERATION");
    }
    if (Number(reservation.version) !== expectedVersion) throw inventoryError("VERSION_CONFLICT");
    if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(reservation.status)) {
      throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const control = locked.stockControls.find((row) => Number(row.warehouse_id) === warehouseId &&
      Number(row.sku_id) === skuId);
    if (!control || safeQuantity(control.reserved_quantity, "reserved") <
        safeQuantity(reservation.outstanding_quantity, "outstandingQuantity")) {
      throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    }
    const [allocations] = await transaction.query(
      `SELECT * FROM inventory_allocations WHERE id IN (${allocationIds.map(() => "?").join(", ")})
        ORDER BY id FOR UPDATE`, allocationIds
    );
    const byId = new Map(allocations.map((row) => [Number(row.id), row]));
    const results = [];
    const balanceReleases = new Map();
    for (const line of lines) {
      const allocation = byId.get(line.allocationId);
      const reference = references.find((row) => Number(row.id) === line.allocationId);
      const balance = locked.balances.find((row) => Number(row.id) === Number(reference.stock_balance_id));
      if (!allocation || Number(allocation.reservation_id) !== reservationId ||
          Number(allocation.stock_balance_id) !== Number(reference.stock_balance_id) || !balance ||
          Number(balance.warehouse_id) !== warehouseId || Number(balance.sku_id) !== skuId ||
          Number(balance.bin_id) !== Number(reference.bin_id) ||
          (balance.lot_id === null ? null : Number(balance.lot_id)) !==
            (reference.lot_id === null ? null : Number(reference.lot_id)) ||
          balance.stock_status !== reference.stock_status) throw inventoryError("CONCURRENT_OPERATION");
      if (Number(allocation.version) !== line.expectedVersion) throw inventoryError("VERSION_CONFLICT");
      if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(allocation.status)) {
        throw inventoryError("ALLOCATION_STATE_CONFLICT");
      }
      const original = safeQuantity(allocation.allocated_quantity, "allocatedQuantity");
      const consumed = safeQuantity(allocation.consumed_quantity, "consumedQuantity");
      const released = safeQuantity(allocation.released_quantity, "releasedQuantity");
      const outstanding = safeQuantity(allocation.outstanding_quantity, "outstandingQuantity");
      const balanceAllocated = safeQuantity(balance.allocated_quantity, "balanceAllocated");
      const releasedFromBalance = balanceReleases.get(Number(balance.id)) ?? 0;
      if (original !== consumed + released + outstanding || line.quantity > outstanding ||
          balanceAllocated < releasedFromBalance + line.quantity) throw inventoryError("ALLOCATION_STATE_CONFLICT");
      balanceReleases.set(Number(balance.id), releasedFromBalance + line.quantity);
      const nextOutstanding = outstanding - line.quantity;
      const nextReleased = released + line.quantity;
      const status = nextOutstanding === 0 ? "RELEASED" : consumed > 0 ? "PARTIALLY_CONSUMED" : "ACTIVE";
      const [allocationUpdate] = await transaction.execute(
        `UPDATE inventory_allocations SET released_quantity = ?, outstanding_quantity = ?,
                status = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [nextReleased, nextOutstanding, status, timestamp, context.actor.userId,
          line.allocationId, line.expectedVersion]
      );
      if (Number(allocationUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      const result = { id: line.allocationId, balanceId: Number(balance.id), quantity: line.quantity,
        releasedQuantity: nextReleased, outstandingQuantity: nextOutstanding,
        status, version: line.expectedVersion + 1, balanceVersion: Number(balance.version) + 1 };
      results.push(result);
      await this.audit.recordSucceeded(transaction, {
        actorUserId: context.actor.userId, actorLabel,
        action: auditAction, targetType: "allocation", targetId: line.allocationId,
        targetLabel: String(line.allocationId),
        beforeSummary: { allocationId: line.allocationId, outstandingQuantity: outstanding,
          balanceAllocated: balanceAllocated - releasedFromBalance },
        afterSummary: { allocationId: line.allocationId, outstandingQuantity: nextOutstanding,
          releasedQuantity: nextReleased, balanceAllocated: balanceAllocated - releasedFromBalance - line.quantity,
          status, version: result.version },
        operationRequestId: claim.operationId, requestId: context.correlationId,
        correlationId: context.correlationId, ip: ""
      });
    }
    for (const [balanceId, releasedQuantity] of balanceReleases) {
      const balance = locked.balances.find((row) => Number(row.id) === balanceId);
      const [balanceUpdate] = await transaction.execute(
        `UPDATE inventory_stock_balances SET allocated_quantity = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`,
        [safeQuantity(balance.allocated_quantity, "balanceAllocated") - releasedQuantity,
          timestamp, balanceId, Number(balance.version)]
      );
      if (Number(balanceUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    }
    if (bumpReservationVersion) {
      const [reservationUpdate] = await transaction.execute(
        `UPDATE inventory_reservations SET version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [timestamp, context.actor.userId, reservationId, expectedVersion]
      );
      if (Number(reservationUpdate.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    }
    const result = { reservationId, operationId: claim.operationId,
      version: expectedVersion + Number(bumpReservationVersion), quantity, allocations: results };
    if (complete) {
      await this.operations.complete(transaction, {
        operationId: claim.operationId, resultType: "ALLOCATION", resultId: String(reservationId),
        resultSummary: { reservationId, operationId: claim.operationId, version: result.version,
          quantity, allocationSnapshot: JSON.stringify(results.map((result) => [
            result.balanceId, result.releasedQuantity, result.outstandingQuantity,
            RELEASE_STATUSES.indexOf(result.status), result.balanceVersion
          ])) }, completedAt: timestamp
      });
    }
    return result;
  }

  allocateInTransaction(transaction, command) {
    return this.#allocateInTransaction(transaction, command, AUTHORIZATIONS.allocate);
  }

  allocateForFulfillmentInTransaction(transaction, command) {
    const contract = providerContract("allocate", FULFILLMENT_PROVIDER);
    return this.#allocateInTransaction(transaction,
      providerInventoryCommand(transaction, command, contract), contract.authorization);
  }

  async #allocateInTransaction(transaction, command, expectedAuthorization) {
    const context = validateInventoryCommandContext(transaction, command, expectedAuthorization);
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    exactFields(context.payload, ALLOCATE_FIELDS);
    const reservationId = positiveId(context.payload.reservationId, "reservationId");
    const expectedVersion = positiveId(context.payload.expectedVersion, "expectedVersion");
    const lines = allocationLines(context.payload.allocations);
    const quantity = lines.reduce((total, line) => total + line.quantity, 0);
    if (!Number.isSafeInteger(quantity)) throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "quantity" });
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(expectedAuthorization.requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }
    const timestamp = this.time.nowMs();
    const actorLabel = actor.username || `user:${context.actor.userId}`;
    const claim = await this.operations.claim(transaction, {
      commandType: "ALLOCATION_CREATE", source: context.source, payload: context.payload,
      actorUserId: context.actor.userId, actorLabel,
      requestId: context.correlationId, correlationId: context.correlationId, createdAt: timestamp
    });
    if (claim.replay) return allocationResultFromSummary(claim.replay.resultSummary);
    return this.#allocateWithClaim(transaction, {
      context, reservationId, expectedVersion, lines, quantity, actor, claim, actorLabel, timestamp
    });
  }

  async #allocateWithClaim(transaction, {
    context, reservationId, expectedVersion, lines, quantity, actor, claim, actorLabel, timestamp,
    auditAction = "allocation.create"
  }) {
    const [[scope]] = await transaction.query(
      "SELECT warehouse_id, sku_id, minimum_remaining_days FROM inventory_reservations WHERE id = ?", [reservationId]
    );
    if (!scope) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const warehouseId = positiveId(Number(scope.warehouse_id), "warehouseId");
    const skuId = positiveId(Number(scope.sku_id), "skuId");
    const firstLock = await this.locks.lockForCommand(transaction, {
      warehouseIds: [warehouseId], stockControls: [{ warehouseId, skuId }], now: timestamp
    });
    if (!firstLock.warehouses.some((row) => Number(row.id) === warehouseId && row.status === "ACTIVE")) {
      throw inventoryError("WAREHOUSE_INVALID");
    }
    const profile = await this.itemLookup.getInventoryProfileInTransaction(transaction, skuId);
    if (!profile?.usable || !profile.inventoryTracked || profile.trackingPolicy === "serial") {
      throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    }
    const candidates = await loadInventoryCandidates(transaction, {
      warehouseId, skuId, currentDate: this.time.fileDate(),
      minimumRemainingDays: Number(scope.minimum_remaining_days),
      trackingPolicy: profile.trackingPolicy, locking: true
    });
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const selected = lines.map((line) => {
      const candidate = byId.get(line.balanceId);
      if (!candidate) throw inventoryError("ALLOCATION_INSUFFICIENT", { balanceId: line.balanceId });
      return { ...line, candidate };
    });
    const locked = await this.locks.lockForCommand(transaction, {
      warehouseIds: [warehouseId], stockControls: [{ warehouseId, skuId }],
      binIds: selected.map(({ candidate }) => candidate.binId),
      balances: selected.map(({ candidate }) => ({
        warehouseId, skuId, binId: candidate.binId, lotId: candidate.lotId, stockStatus: "AVAILABLE"
      })), reservationIds: [reservationId], now: timestamp
    });
    if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
    if (selected.some(({ candidate }) =>
      !locked.bins.some((bin) => Number(bin.id) === candidate.binId && bin.status === "ACTIVE"))) {
      throw inventoryError("BIN_INVALID");
    }
    const reservation = locked.reservations.find((row) => Number(row.id) === reservationId);
    if (!reservation || Number(reservation.warehouse_id) !== warehouseId || Number(reservation.sku_id) !== skuId) {
      throw inventoryError("CONCURRENT_OPERATION");
    }
    if (Number(reservation.version) !== expectedVersion) throw inventoryError("VERSION_CONFLICT");
    if (!["ACTIVE", "PARTIALLY_CONSUMED"].includes(reservation.status)) {
      throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const control = locked.stockControls.find((row) => Number(row.warehouse_id) === warehouseId &&
      Number(row.sku_id) === skuId);
    if (!control || safeQuantity(control.reserved_quantity, "reserved") <
        safeQuantity(reservation.outstanding_quantity, "outstandingQuantity")) {
      throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    }
    const [[allocated]] = await transaction.query(
      "SELECT COALESCE(SUM(outstanding_quantity), 0) AS outstanding FROM inventory_allocations WHERE reservation_id = ? FOR SHARE",
      [reservationId]
    );
    const unallocated = safeQuantity(reservation.outstanding_quantity, "outstandingQuantity") -
      safeQuantity(allocated?.outstanding, "allocatedOutstanding");
    if (unallocated < quantity) throw inventoryError("ALLOCATION_INSUFFICIENT", { requested: quantity });
    const recommended = recommendInventoryCandidates(candidates, quantity);
    const selectedQuantities = new Map(lines.map((line) => [line.balanceId, line.quantity]));
    const differs = recommended.some((line) => selectedQuantities.get(line.balanceId) !== line.quantity) ||
      recommended.length !== lines.length;
    const fefoDeviation = differs && recommended.some((line) =>
      byId.get(line.balanceId).expiryDate && selectedQuantities.get(line.balanceId) !== line.quantity);
    const reason = context.payload.overrideReason;
    const normalizedReason = typeof reason === "string" ? reason.trim() : "";
    if (differs) {
      if ([...normalizedReason].length < 5 || [...normalizedReason].length > 500 || /[\p{Cc}]/u.test(normalizedReason)) {
        throw inventoryError(fefoDeviation ? "FEFO_OVERRIDE_REQUIRED" : "PICK_SEQUENCE_REASON_REQUIRED");
      }
      if (fefoDeviation && !actor.permissions.includes("inventory.fefo.override")) {
        throw inventoryError("FEFO_OVERRIDE_DENIED");
      }
    } else if (reason !== undefined && reason !== "") {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "overrideReason" });
    }
    const firstRecommended = byId.get(recommended[0].balanceId);
    const rankById = new Map(candidates.map((candidate, index) => [candidate.id, index + 1]));
    const allocations = [];
    for (const { candidate, expectedVersion: balanceVersion, quantity: lineQuantity } of selected) {
      const balance = locked.balances.find((row) => Number(row.id) === candidate.id);
      if (!balance || Number(balance.warehouse_id) !== warehouseId || Number(balance.sku_id) !== skuId ||
          Number(balance.bin_id) !== candidate.binId ||
          (balance.lot_id === null ? null : Number(balance.lot_id)) !== candidate.lotId ||
          balance.stock_status !== "AVAILABLE" || Number(balance.version) !== balanceVersion) {
        throw inventoryError("VERSION_CONFLICT");
      }
      const onHand = safeQuantity(balance.on_hand_quantity, "onHandQuantity");
      const currentAllocated = safeQuantity(balance.allocated_quantity, "allocatedQuantity");
      if (onHand - currentAllocated < lineQuantity) throw inventoryError("ALLOCATION_INSUFFICIENT");
      const [updated] = await transaction.execute(
        `UPDATE inventory_stock_balances SET allocated_quantity = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`,
        [currentAllocated + lineQuantity, timestamp, candidate.id, balanceVersion]
      );
      if (Number(updated.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
      const strategy = candidate.expiryDate ? "FEFO" : "FIFO";
      const [inserted] = await transaction.execute(
        `INSERT INTO inventory_allocations
           (create_operation_id, reservation_id, stock_balance_id, allocated_quantity,
            outstanding_quantity, selection_strategy, is_sequence_override,
            recommended_rank_snapshot, recommended_summary, override_reason, status,
            created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
        [claim.operationId, reservationId, candidate.id, lineQuantity, lineQuantity,
          strategy, differs ? 1 : 0,
          differs ? rankById.get(candidate.id) : null,
          differs ? JSON.stringify({ recommendedBalanceId: firstRecommended.id,
            recommendedExpiryDate: firstRecommended.expiryDate, selectedBalanceId: candidate.id,
            selectedExpiryDate: candidate.expiryDate }) : null,
          normalizedReason, timestamp, timestamp, context.actor.userId, context.actor.userId]
      );
      const allocation = {
        id: Number(inserted.insertId), balanceId: candidate.id, quantity: lineQuantity,
        version: 1, balanceVersion: balanceVersion + 1, selectionStrategy: strategy,
        isSequenceOverride: differs
      };
      allocations.push(allocation);
      await this.audit.recordSucceeded(transaction, {
        actorUserId: context.actor.userId, actorLabel,
        action: auditAction, targetType: "allocation", targetId: allocation.id,
        targetLabel: String(allocation.id),
        beforeSummary: { balanceId: candidate.id, allocatedQuantity: currentAllocated },
        afterSummary: { allocationId: allocation.id, balanceId: candidate.id, quantity: lineQuantity,
          allocatedQuantity: currentAllocated + lineQuantity, version: 1,
          selectionStrategy: strategy, isSequenceOverride: differs,
          ...(differs ? { recommendedBalanceId: firstRecommended.id, selectedBalanceId: candidate.id,
            recommendedExpiryDate: firstRecommended.expiryDate, selectedExpiryDate: candidate.expiryDate } : {}) },
        reasonText: normalizedReason,
        operationRequestId: claim.operationId, requestId: context.correlationId,
        correlationId: context.correlationId, ip: ""
      });
    }
    if (fefoDeviation) {
      const firstSelected = selected.find(({ candidate }) => candidate.id !== firstRecommended.id) ?? selected[0];
      await this.audit.recordSucceeded(transaction, {
        actorUserId: context.actor.userId, actorLabel,
        action: "fefo.override", targetType: "reservation", targetId: reservationId,
        targetLabel: String(reservationId), reasonText: normalizedReason,
        beforeSummary: { recommendedBalanceId: firstRecommended.id,
          recommendedExpiryDate: firstRecommended.expiryDate },
        afterSummary: { recommendedBalanceId: firstRecommended.id,
          recommendedExpiryDate: firstRecommended.expiryDate,
          selectedBalanceId: firstSelected.candidate.id,
          selectedExpiryDate: firstSelected.candidate.expiryDate },
        operationRequestId: claim.operationId, requestId: context.correlationId,
        correlationId: context.correlationId, ip: ""
      });
    }
    const [updatedReservation] = await transaction.execute(
      `UPDATE inventory_reservations SET version = version + 1, updated_at = ?, updated_by = ?
        WHERE id = ? AND version = ?`,
      [timestamp, context.actor.userId, reservationId, expectedVersion]
    );
    if (Number(updatedReservation.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const result = { reservationId, operationId: claim.operationId, version: expectedVersion + 1,
      quantity, allocations };
    await this.operations.complete(transaction, {
      operationId: claim.operationId, resultType: "ALLOCATION", resultId: String(reservationId),
      resultSummary: { reservationId, operationId: claim.operationId, version: result.version,
        quantity, allocationSnapshot: JSON.stringify(allocations.map((line) => [
          line.id, line.balanceId, line.quantity, line.balanceVersion,
          line.selectionStrategy === "FEFO" ? 1 : 0, line.isSequenceOverride ? 1 : 0
        ])) }, completedAt: timestamp
    });
    return result;
  }

  reallocateAllocation(command) {
    return this.database.withTransaction((transaction) => this.reallocateAllocationInTransaction(transaction, command));
  }

  reallocateAllocationInTransaction(transaction, command) {
    return this.#reallocateAllocationInTransaction(transaction, command, AUTHORIZATIONS.reallocateAllocation);
  }

  reallocateFulfillmentAllocationInTransaction(transaction, command) {
    const contract = providerContract("reallocateAllocation", FULFILLMENT_PROVIDER);
    return this.#reallocateAllocationInTransaction(transaction,
      providerInventoryCommand(transaction, command, contract), contract.authorization);
  }

  async #reallocateAllocationInTransaction(transaction, command, expectedAuthorization) {
    const context = validateInventoryCommandContext(transaction, command, expectedAuthorization);
    if (context.actor.userId === null) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "actor" });
    exactFields(context.payload, REALLOCATE_FIELDS);
    const reservationId = positiveId(context.payload.reservationId, "reservationId");
    const expectedVersion = positiveId(context.payload.expectedVersion, "expectedVersion");
    const releases = allocationReleaseLines(context.payload.releases);
    const allocations = allocationLines(context.payload.allocations);
    const releasedQuantity = releases.reduce((total, line) => total + line.quantity, 0);
    const quantity = allocations.reduce((total, line) => total + line.quantity, 0);
    if (!Number.isSafeInteger(quantity) || quantity !== releasedQuantity) {
      throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "allocations" });
    }
    const actor = await this.authorize(transaction, {
      actorId: context.actor.userId,
      claimedRoles: context.actor.claimedRoles,
      claimedPermissions: context.actor.claimedPermissions
    });
    if (!actor?.permissions?.includes(expectedAuthorization.requiredCallerPermission)) {
      throw inventoryError("PERMISSION_STALE");
    }
    const timestamp = this.time.nowMs();
    const actorLabel = actor.username || `user:${context.actor.userId}`;
    const claim = await this.operations.claim(transaction, {
      commandType: "ALLOCATION_REALLOCATE", source: context.source, payload: context.payload,
      actorUserId: context.actor.userId, actorLabel,
      requestId: context.correlationId, correlationId: context.correlationId, createdAt: timestamp
    });
    if (claim.replay) return allocationResultFromSummary(claim.replay.resultSummary);
    const released = await this.#releaseAllocationsWithClaim(transaction, {
      context, reservationId, expectedVersion, lines: releases, quantity, claim, actorLabel, timestamp,
      auditAction: "allocation.reallocate", complete: false, bumpReservationVersion: false
    });
    return this.#allocateWithClaim(transaction, {
      context, reservationId, expectedVersion: released.version, lines: allocations,
      quantity, actor, claim, actorLabel, timestamp, auditAction: "allocation.reallocate"
    });
  }

  async #changeInTransaction(transaction, command, action, expectedAuthorization) {
    const context = validateInventoryCommandContext(transaction, command, expectedAuthorization);
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
    if (!actor?.permissions?.includes(expectedAuthorization.requiredCallerPermission)) {
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

    if (action === "cancel") {
      const [activeAllocations] = await transaction.query(
        `SELECT id, version, outstanding_quantity FROM inventory_allocations
          WHERE reservation_id = ? AND outstanding_quantity > 0 ORDER BY id`, [reservationId]
      );
      if (activeAllocations.length) {
        const lines = activeAllocations.map((row) => ({
          allocationId: positiveId(Number(row.id), "allocationId"),
          expectedVersion: positiveId(Number(row.version), "expectedVersion"),
          quantity: inventoryPositiveInteger(Number(row.outstanding_quantity))
        }));
        const quantity = lines.reduce((total, line) => total + line.quantity, 0);
        if (!Number.isSafeInteger(quantity)) {
          throw inventoryError("INVENTORY_QUANTITY_INVALID", { field: "quantity" });
        }
        await this.#releaseAllocationsWithClaim(transaction, {
          context, reservationId, expectedVersion, lines, quantity, claim, actorLabel, timestamp,
          complete: false, bumpReservationVersion: false
        });
      }
    }

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

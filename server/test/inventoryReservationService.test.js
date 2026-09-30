import assert from "node:assert/strict";
import test from "node:test";

import { InventoryReservationService } from "../src/modules/inventory/InventoryReservationService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const NOW = Date.parse("2026-09-28T04:00:00.000Z");

function command(payload, eventId = "reserve-1") {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "reservation.create", requiredCallerPermission: "inventory.operation" },
    source: { module: "SALES", documentType: "SALES_ORDER", eventId },
    correlationId: eventId,
    payload
  });
}

test("TASK-020 SALE Reservation uses the stricter SKU life and returns uncovered quantity", async () => {
  const queries = [];
  const database = {
    async withTransaction(work) {
      return work({
        async query(sql, params) {
          queries.push({ sql: String(sql), params });
          if (String(sql).includes("SUM(b.on_hand_quantity)")) return [[{ eligible_on_hand: 6 }]];
          return [[]];
        },
        async execute() { return [{ affectedRows: 1, insertId: 17 }]; }
      });
    }
  };
  const service = new InventoryReservationService({
    database,
    time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    authorize: async () => ({ username: "sam", permissions: ["inventory.operation"] }),
    itemLookup: { async getInventoryProfileInTransaction() {
      return { usable: true, inventoryTracked: true, trackingPolicy: "batch_expiry", minimumSaleLifeDays: 30 };
    } },
    operations: {
      async claim() { return { operationId: 19, replay: null }; },
      async complete() {}
    },
    locks: { async lockForCommand() {
      return {
        warehouses: [{ id: 2, status: "ACTIVE" }],
        stockControls: [{ id: 5, warehouse_id: 2, sku_id: 12, reserved_quantity: 2, version: 1 }]
      };
    } },
    audit: { async recordSucceeded() {} }
  });

  const result = await service.create(command({
    skuId: 12, warehouseId: 2, quantity: 3, purpose: "SALE", minimumRemainingDays: 10
  }));

  assert.equal(result.minimumRemainingDays, 30);
  assert.deepEqual(result.availability, {
    eligibleOnHand: 6, reserved: 5, rawAtp: 1, atp: 1, uncoveredReserved: 0
  });
  const availabilityQuery = queries.find(({ sql }) => sql.includes("SUM(b.on_hand_quantity)"));
  assert.ok(availabilityQuery);
  assert.ok(availabilityQuery.params.includes("2026-10-28"));
});

test("TASK-020 rejects insufficient raw ATP before Reservation writes", async () => {
  const executed = [];
  const database = { async withTransaction(work) {
    return work({
      async query(sql) {
        if (String(sql).includes("SUM(b.on_hand_quantity)")) return [[{ eligible_on_hand: 3 }]];
        return [[]];
      },
      async execute(sql) { executed.push(String(sql)); return [{ affectedRows: 1, insertId: 17 }]; }
    });
  } };
  const service = new InventoryReservationService({
    database,
    time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    authorize: async () => ({ username: "sam", permissions: ["inventory.operation"] }),
    itemLookup: { async getInventoryProfileInTransaction() {
      return { usable: true, inventoryTracked: true, trackingPolicy: "none", minimumSaleLifeDays: 0 };
    } },
    operations: { async claim() { return { operationId: 19, replay: null }; } },
    locks: { async lockForCommand() { return {
      warehouses: [{ id: 2, status: "ACTIVE" }],
      stockControls: [{ id: 5, warehouse_id: 2, sku_id: 12, reserved_quantity: 2, version: 1 }]
    }; } },
    audit: { async recordSucceeded() {} }
  });

  await assert.rejects(
    () => service.create(command({ skuId: 12, warehouseId: 2, quantity: 2, purpose: "SALE", minimumRemainingDays: 0 })),
    (error) => error.code === "INSUFFICIENT_ATP" && error.details?.rawAtp === 1
  );
  assert.equal(executed.some((sql) => sql.includes("inventory_reservations")), false);
});

function transitionSetup({ auditFails = false, permissions = ["inventory.operation"] } = {}) {
  const database = createFakeInventoryDatabase({
    initialState: {
      warehouse: { id: 2, status: "ACTIVE" },
      control: { id: 5, warehouse_id: 2, sku_id: 12, reserved_quantity: 10, version: 1 },
      reservation: {
        id: 17, warehouse_id: 2, sku_id: 12, purpose: "SALE", minimum_remaining_days: 30,
        original_quantity: 10, consumed_quantity: 0, released_quantity: 0,
        outstanding_quantity: 10, status: "ACTIVE", version: 1
      },
      audits: [], operations: []
    },
    async query({ sql, state }) {
      if (sql.includes("FROM inventory_reservations")) return [[state.reservation]];
      if (sql.includes("SUM(outstanding_quantity)")) return [[{ outstanding: 0 }]];
      return [[]];
    },
    async execute({ sql, params, state }) {
      if (sql.includes("UPDATE inventory_stock_controls")) {
        state.control.reserved_quantity = params[0];
        state.control.version += 1;
      }
      if (sql.includes("UPDATE inventory_reservations")) {
        state.reservation.released_quantity = params[0];
        state.reservation.outstanding_quantity = params[1];
        state.reservation.status = params[2];
        state.reservation.version += 1;
      }
      return [{ affectedRows: 1 }];
    }
  });
  const service = new InventoryReservationService({
    database,
    time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    authorize: async () => ({ username: "sam", permissions }),
    itemLookup: {},
    operations: {
      async claim() { return { operationId: 19, replay: null }; },
      async complete(transaction, input) { transaction.state.operations.push(input); }
    },
    locks: { async lockForCommand(transaction) {
      return {
        warehouses: [transaction.state.warehouse],
        stockControls: [transaction.state.control],
        reservations: [transaction.state.reservation]
      };
    } },
    audit: { async recordSucceeded(transaction, input) {
      if (auditFails) throw new Error("injected audit failure");
      transaction.state.audits.push(input);
    } }
  });
  return { service, database };
}

function transitionCommand(action, payload, eventId) {
  return {
    ...command(payload, eventId ? `${action}-${eventId}` : action),
    authorization: { purpose: `reservation.${action}`, requiredCallerPermission: "inventory.operation" }
  };
}

test("TASK-020 partial release and cancel preserve the quantity equation and terminal state", async () => {
  const { service, database } = transitionSetup();
  const released = await service.release(transitionCommand("release", {
    reservationId: 17, expectedVersion: 1, quantity: 3
  }));
  assert.deepEqual([released.releasedQuantity, released.outstandingQuantity, released.status, released.version],
    [3, 7, "ACTIVE", 2]);

  const cancelled = await service.cancel(transitionCommand("cancel", {
    reservationId: 17, expectedVersion: 2
  }));
  assert.deepEqual([cancelled.originalQuantity, cancelled.consumedQuantity,
    cancelled.releasedQuantity, cancelled.outstandingQuantity, cancelled.status, cancelled.version],
  [10, 0, 10, 0, "CANCELLED", 3]);
  assert.equal(database.state.control.reserved_quantity, 0);
  assert.equal(database.state.audits.length, 2);
  await assert.rejects(
    () => service.release(transitionCommand("release", {
      reservationId: 17, expectedVersion: 2, quantity: 1
    }, "stale")),
    (error) => error.code === "VERSION_CONFLICT"
  );
  await assert.rejects(
    () => service.release(transitionCommand("release", {
      reservationId: 17, expectedVersion: 3, quantity: 1
    }, "terminal")),
    (error) => error.code === "RESERVATION_STATE_CONFLICT"
  );
});

test("TASK-020 Audit failure rolls back Reservation and Stock Control together", async () => {
  const { service, database } = transitionSetup({ auditFails: true });
  await assert.rejects(
    () => service.release(transitionCommand("release", {
      reservationId: 17, expectedVersion: 1, quantity: 3
    })),
    /injected audit failure/
  );
  assert.deepEqual([database.state.reservation.released_quantity,
    database.state.reservation.outstanding_quantity, database.state.control.reserved_quantity],
  [0, 10, 10]);
});

test("TASK-023 Sales release provider commits and rolls back with caller transaction", async () => {
  const { service, database } = transitionSetup({ permissions: ["sales.operation"] });
  const request = {
    actor: { userId: 7, serviceName: "", claimedRoles: [], claimedPermissions: ["sales.operation"] },
    source: { documentId: "SO-42", eventId: "release-1" },
    correlationId: "release-1",
    payload: { reservationId: 17, expectedVersion: 1, quantity: 3 }
  };
  const released = await database.withTransaction(
    (transaction) => service.releaseSalesReservationInTransaction(transaction, request)
  );
  assert.equal(released.outstandingQuantity, 7);
  assert.equal(database.state.control.reserved_quantity, 7);

  await assert.rejects(() => database.withTransaction(async (transaction) => {
    await service.cancelSalesReservationInTransaction(transaction, {
      ...request, source: { documentId: "SO-42", eventId: "cancel-1" },
      payload: { reservationId: 17, expectedVersion: 2 }
    });
    throw new Error("caller source update failed");
  }), /caller source update failed/);
  assert.equal(database.state.reservation.outstanding_quantity, 7);
  assert.equal(database.state.control.reserved_quantity, 7);
});

function allocationSetup({
  permissions = ["inventory.operation"], expiryDates = ["2026-10-31", "2026-11-30"],
  auditFails = false, replayAfterCompletion = false, lockedBinIds = [],
  sameLot = false, allocatedOutstanding = 0
} = {}) {
  const database = createFakeInventoryDatabase({
    initialState: {
      warehouse: { id: 2, status: "ACTIVE" },
      control: { id: 5, warehouse_id: 2, sku_id: 12, reserved_quantity: 6, version: 1 },
      reservation: { id: 17, warehouse_id: 2, sku_id: 12, purpose: "SALE",
        minimum_remaining_days: 30, outstanding_quantity: 6, status: "ACTIVE", version: 1 },
      bins: [{ id: 31, status: "ACTIVE" }, { id: 32, status: "ACTIVE" }],
      balances: [
        { id: 41, warehouse_id: 2, bin_id: 31, sku_id: 12, lot_id: 51,
          stock_status: "AVAILABLE", on_hand_quantity: 3, allocated_quantity: 0, version: 1 },
        { id: 42, warehouse_id: 2, bin_id: 32, sku_id: 12, lot_id: sameLot ? 51 : 52,
          stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 0, version: 1 }
      ],
      audits: []
    },
    async query({ sql, state }) {
      if (sql.includes("FROM inventory_reservations")) return [[state.reservation]];
      if (sql.includes("SUM(outstanding_quantity)")) return [[{ outstanding: allocatedOutstanding }]];
      if (sql.includes("FROM inventory_stock_balances b")) return [[
        { ...state.balances[0], bin_code: "A", normalized_lot_number: "lot-1",
          expiry_date: expiryDates[0], first_receipt_date: "2026-09-01", fifo_anchor_date: null },
        { ...state.balances[1], bin_code: "B", normalized_lot_number: sameLot ? "lot-1" : "lot-2",
          expiry_date: expiryDates[1], first_receipt_date: "2026-09-02", fifo_anchor_date: null }
      ]];
      return [[]];
    },
    async execute({ sql, params, state }) {
      if (sql.includes("UPDATE inventory_stock_balances")) {
        const balance = state.balances.find(({ id }) => id === params[2]);
        balance.allocated_quantity = params[0];
        balance.version += 1;
      }
      if (sql.includes("UPDATE inventory_reservations")) state.reservation.version += 1;
      if (sql.includes("INSERT INTO inventory_allocations")) {
        state.nextAllocationId = (state.nextAllocationId ?? 70) + 1;
        return [{ affectedRows: 1, insertId: state.nextAllocationId }];
      }
      return [{ affectedRows: 1 }];
    }
  });
  let completedSummary;
  const service = new InventoryReservationService({
    database, time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    authorize: async () => ({ username: "sam", permissions }),
    itemLookup: { async getInventoryProfileInTransaction() {
      return { usable: true, inventoryTracked: true,
        trackingPolicy: expiryDates[0] === null ? "batch" : "batch_expiry" };
    } },
    operations: {
      async claim() { return { operationId: 21,
        replay: replayAfterCompletion && completedSummary ? { resultSummary: completedSummary } : null }; },
      async complete(_transaction, input) { completedSummary = input.resultSummary; }
    },
    locks: { async lockForCommand(transaction) { return {
      warehouses: [transaction.state.warehouse], stockControls: [transaction.state.control],
      bins: transaction.state.bins, binLocks: lockedBinIds.map((binId) => ({ bin_id: binId })),
      balances: transaction.state.balances,
      reservations: [transaction.state.reservation]
    }; } },
    audit: { async recordSucceeded(transaction, input) {
      if (auditFails) throw new Error("injected audit failure");
      transaction.state.audits.push(input);
    } }
  });
  return { service, database };
}

function allocationCommand(allocations, { reason, permissions = ["inventory.operation"], eventId = "pick-1" } = {}) {
  return inventoryCommandFixture({
    actor: { claimedPermissions: permissions },
    authorization: { purpose: "allocation.create", requiredCallerPermission: "inventory.operation" },
    source: { module: "FULFILLMENT", documentType: "PICK", eventId },
    payload: { reservationId: 17, expectedVersion: 1, allocations,
      ...(reason === undefined ? {} : { overrideReason: reason }) }
  });
}

test("TASK-021 allocates the recommended buckets without reducing On Hand", async () => {
  const { service, database } = allocationSetup();
  const result = await service.allocate(allocationCommand([
    { balanceId: 41, expectedVersion: 1, quantity: 3 },
    { balanceId: 42, expectedVersion: 1, quantity: 3 }
  ]));
  assert.equal(result.version, 2);
  assert.deepEqual(result.allocations.map(({ balanceId, quantity }) => [balanceId, quantity]), [[41, 3], [42, 3]]);
  assert.deepEqual(database.state.balances.map(({ on_hand_quantity, allocated_quantity }) =>
    [on_hand_quantity, allocated_quantity]), [[3, 3], [5, 3]]);
  assert.ok(database.calls.some(({ sql }) => sql.includes("INSERT INTO inventory_allocations") &&
    sql.includes("'ACTIVE'")));
  assert.equal(database.state.audits.length, 2);
});

test("TASK-023 Fulfillment allocation provider needs only downstream permission", async () => {
  const { service, database } = allocationSetup({ permissions: ["fulfillment.operation"] });
  const result = await database.withTransaction((transaction) => service.allocateForFulfillmentInTransaction(
    transaction, {
      actor: { userId: 7, serviceName: "", claimedRoles: [], claimedPermissions: ["fulfillment.operation"] },
      source: { documentId: "PICK-42", eventId: "allocated-1" },
      correlationId: "allocated-1",
      payload: { reservationId: 17, expectedVersion: 1,
        allocations: [{ balanceId: 41, expectedVersion: 1, quantity: 3 }] }
    }
  ));
  assert.equal(result.allocations[0].quantity, 3);
  assert.equal(database.state.balances[0].allocated_quantity, 3);
});

test("TASK-021 FEFO deviation needs fresh specialist permission and audited reason", async () => {
  const selected = [{ balanceId: 42, expectedVersion: 1, quantity: 2 }];
  const denied = allocationSetup();
  await assert.rejects(() => denied.service.allocate(allocationCommand(selected, { reason: "Customer-approved exception" })),
    (error) => error.code === "FEFO_OVERRIDE_DENIED");
  assert.equal(denied.database.state.balances[1].allocated_quantity, 0);

  const permissions = ["inventory.operation", "inventory.fefo.override"];
  const approved = allocationSetup({ permissions });
  await assert.rejects(() => approved.service.allocate(allocationCommand(selected, { permissions, eventId: "no-reason" })),
    (error) => error.code === "FEFO_OVERRIDE_REQUIRED");
  const result = await approved.service.allocate(allocationCommand(selected, {
    permissions, reason: "Customer-approved exception"
  }));
  assert.equal(result.allocations[0].isSequenceOverride, true);
  assert.equal(approved.database.state.balances[1].allocated_quantity, 2);
  assert.ok(approved.database.state.audits.some(({ action, reasonText, afterSummary }) =>
    action === "fefo.override" && reasonText === "Customer-approved exception" &&
    afterSummary.recommendedBalanceId === 41 && afterSummary.selectedBalanceId === 42));
});

test("TASK-021 FIFO deviation needs a reason but not FEFO specialist permission", async () => {
  const { service, database } = allocationSetup({ expiryDates: [null, null] });
  const selected = [{ balanceId: 42, expectedVersion: 1, quantity: 2 }];
  await assert.rejects(() => service.allocate(allocationCommand(selected)),
    (error) => error.code === "PICK_SEQUENCE_REASON_REQUIRED");
  const result = await service.allocate(allocationCommand(selected, { reason: "Urgent bin selection" }));
  assert.equal(result.allocations[0].selectionStrategy, "FIFO");
  assert.equal(result.allocations[0].isSequenceOverride, true);
  assert.equal(database.state.balances[1].allocated_quantity, 2);
});

test("TASK-021 candidate inquiry returns bounded eligible free quantities and versions without writes", async () => {
  const queries = [];
  const transaction = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes("FROM inventory_reservations")) return [[{
        warehouse_id: 2, sku_id: 12, outstanding_quantity: 6,
        minimum_remaining_days: 30, status: "ACTIVE", version: 1, warehouse_status: "ACTIVE"
      }]];
      if (String(sql).includes("SUM(outstanding_quantity)")) return [[{ outstanding: 1 }]];
      return [[{
        id: 41, bin_id: 31, lot_id: 51, version: 2, on_hand_quantity: 5,
        allocated_quantity: 1, bin_code: "A", normalized_lot_number: "lot-1",
        expiry_date: "2026-10-31", first_receipt_date: "2026-09-01", fifo_anchor_date: null
      }]];
    },
    async execute() { throw new Error("candidate inquiry must not write"); }
  };
  const service = new InventoryReservationService({
    database: { withTransaction: async (work) => work(transaction) },
    time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    itemLookup: { async getInventoryProfileInTransaction() {
      return { usable: true, inventoryTracked: true, trackingPolicy: "batch_expiry" };
    } }, authorize: async () => ({}), audit: {}, operations: {}, locks: {}
  });
  const result = await service.listAllocationCandidatesInTransaction(transaction, {
    reservationId: 17, requestedQuantity: 3
  });
  assert.deepEqual(result.items.map(({ balanceId, freeQuantity, balanceVersion }) =>
    [balanceId, freeQuantity, balanceVersion]), [[41, 4, 2]]);
  assert.equal(result.unallocatedQuantity, 5);
  assert.equal(result.hasMore, false);
  assert.ok(queries.some(({ sql, params }) => sql.includes("LIMIT ?") && params.at(-1) === 101));
});

test("TASK-021 Allocation replay returns the original lines without new writes", async () => {
  const { service, database } = allocationSetup({ replayAfterCompletion: true, expiryDates: [null, null] });
  const request = allocationCommand([{ balanceId: 41, expectedVersion: 1, quantity: 2 }]);
  const original = await service.allocate(request);
  const writes = database.calls.filter(({ method }) => method === "execute").length;
  assert.deepEqual(await service.allocate(request), original);
  assert.equal(database.calls.filter(({ method }) => method === "execute").length, writes);
});

test("TASK-021 Allocation rejects stale or locked buckets and rolls back Audit failure", async () => {
  const selected = [{ balanceId: 41, expectedVersion: 2, quantity: 2 }];
  const stale = allocationSetup();
  await assert.rejects(() => stale.service.allocate(allocationCommand(selected)),
    (error) => error.code === "VERSION_CONFLICT");
  assert.equal(stale.database.state.balances[0].allocated_quantity, 0);

  const locked = allocationSetup({ lockedBinIds: [31] });
  await assert.rejects(() => locked.service.allocate(allocationCommand([
    { balanceId: 41, expectedVersion: 1, quantity: 2 }
  ])), (error) => error.code === "BIN_LOCKED_BY_STOCKTAKE");

  const failing = allocationSetup({ auditFails: true });
  await assert.rejects(() => failing.service.allocate(allocationCommand([
    { balanceId: 41, expectedVersion: 1, quantity: 2 }
  ])), /injected audit failure/u);
  assert.equal(failing.database.state.balances[0].allocated_quantity, 0);
  assert.equal(failing.database.state.reservation.version, 1);
});

test("TASK-021 same Lot across Bins remains separate and cannot exceed unallocated Reservation", async () => {
  const sameLot = allocationSetup({ sameLot: true, expiryDates: ["2026-10-31", "2026-10-31"] });
  const lines = [
    { balanceId: 41, expectedVersion: 1, quantity: 3 },
    { balanceId: 42, expectedVersion: 1, quantity: 3 }
  ];
  const result = await sameLot.service.allocate(allocationCommand(lines));
  assert.deepEqual(result.allocations.map(({ balanceId }) => balanceId), [41, 42]);
  assert.deepEqual(sameLot.database.state.balances.map(({ allocated_quantity }) => allocated_quantity), [3, 3]);

  const over = allocationSetup({ allocatedOutstanding: 5 });
  await assert.rejects(() => over.service.allocate(allocationCommand([
    { balanceId: 41, expectedVersion: 1, quantity: 2 }
  ])), (error) => error.code === "ALLOCATION_INSUFFICIENT");
  assert.equal(over.database.state.balances[0].allocated_quantity, 0);
});

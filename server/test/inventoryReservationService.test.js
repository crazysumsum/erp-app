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

function transitionSetup({ auditFails = false } = {}) {
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
    authorize: async () => ({ username: "sam", permissions: ["inventory.operation"] }),
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

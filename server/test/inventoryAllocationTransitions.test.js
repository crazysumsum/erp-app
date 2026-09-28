import assert from "node:assert/strict";
import test from "node:test";

import { InventoryReservationService } from "../src/modules/inventory/InventoryReservationService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const NOW = Date.parse("2026-09-28T04:00:00.000Z");

function command(action, payload, eventId = action) {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: `allocation.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "FULFILLMENT", documentType: "PICK", eventId },
    correlationId: eventId, payload
  });
}

function setup({ auditFails = false, sharedBalance = false } = {}) {
  const database = createFakeInventoryDatabase({
    initialState: {
      warehouse: { id: 2, status: "ACTIVE" },
      control: { id: 5, warehouse_id: 2, sku_id: 12, reserved_quantity: 6, version: 1 },
      reservation: { id: 17, warehouse_id: 2, sku_id: 12, original_quantity: 6,
        consumed_quantity: 0, released_quantity: 0, outstanding_quantity: 6,
        minimum_remaining_days: 0, status: "ACTIVE", version: 2 },
      bin: { id: 31, warehouse_id: 2, status: "ACTIVE" },
      balance: { id: 41, warehouse_id: 2, sku_id: 12, bin_id: 31, lot_id: 51,
        stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 4, version: 2 },
      allocations: [71, ...(sharedBalance ? [72] : [])].map((id) => ({
        id, reservation_id: 17, stock_balance_id: 41,
        allocated_quantity: sharedBalance ? 2 : 4, consumed_quantity: 0, released_quantity: 0,
        outstanding_quantity: sharedBalance ? 2 : 4, status: "ACTIVE", version: 1
      })),
      audits: [], completed: null
    },
    async query({ sql, params, state }) {
      if (sql.includes("FROM inventory_reservations")) return [[state.reservation]];
      if (sql.includes("FROM inventory_allocations")) return [state.allocations.filter(({ id }) =>
        params.includes(id)).map((allocation) => ({
        ...allocation,
        warehouse_id: state.balance.warehouse_id, sku_id: state.balance.sku_id,
        bin_id: state.balance.bin_id, lot_id: state.balance.lot_id,
        stock_status: state.balance.stock_status
      }))];
      return [[]];
    },
    async execute({ sql, params, state }) {
      if (sql.includes("UPDATE inventory_allocations")) {
        const allocation = state.allocations.find(({ id }) => id === params.at(-2));
        allocation.released_quantity = params[0];
        allocation.outstanding_quantity = params[1];
        allocation.status = params[2];
        allocation.version += 1;
      }
      if (sql.includes("UPDATE inventory_stock_balances")) {
        if (state.balance.version !== params.at(-1)) return [{ affectedRows: 0 }];
        state.balance.allocated_quantity = params[0];
        state.balance.version += 1;
      }
      if (sql.includes("UPDATE inventory_reservations")) state.reservation.version += 1;
      return [{ affectedRows: 1 }];
    }
  });
  const service = new InventoryReservationService({
    database, time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    authorize: async () => ({ username: "sam", permissions: ["inventory.operation"] }),
    itemLookup: {},
    operations: {
      async claim(transaction, input) {
        if (transaction.state.completed && transaction.state.eventId === input.source.eventId) {
          return { operationId: 21, replay: { resultSummary: transaction.state.completed } };
        }
        transaction.state.eventId = input.source.eventId;
        return { operationId: 21, replay: null };
      },
      async complete(transaction, input) { transaction.state.completed = input.resultSummary; }
    },
    locks: { async lockForCommand(transaction) { return {
      warehouses: [transaction.state.warehouse], stockControls: [transaction.state.control],
      bins: [transaction.state.bin], binLocks: [], balances: [structuredClone(transaction.state.balance)],
      reservations: [transaction.state.reservation]
    }; } },
    audit: { async recordSucceeded(transaction, input) {
      if (auditFails) throw new Error("injected audit failure");
      transaction.state.audits.push(input);
    } }
  });
  return { service, database };
}

test("TASK-022 Allocation release reduces only its bucket hold and replays once", async () => {
  const { service, database } = setup();
  const request = command("release", { reservationId: 17, expectedVersion: 2,
    releases: [{ allocationId: 71, expectedVersion: 1, quantity: 2 }] });
  const result = await service.releaseAllocation(request);
  assert.deepEqual(await service.releaseAllocation(request), result);
  assert.deepEqual([result.version, result.quantity, result.allocations[0].outstandingQuantity], [3, 2, 2]);
  assert.deepEqual([database.state.reservation.outstanding_quantity, database.state.control.reserved_quantity,
    database.state.balance.on_hand_quantity, database.state.balance.allocated_quantity], [6, 6, 5, 2]);
  assert.deepEqual([database.state.allocations[0].released_quantity, database.state.allocations[0].outstanding_quantity,
    database.state.allocations[0].version], [2, 2, 2]);
  assert.equal(database.state.audits.length, 1);
});

test("TASK-022 releases two Allocation rows sharing one Balance without a stale version", async () => {
  const { service, database } = setup({ sharedBalance: true });
  const result = await service.releaseAllocation(command("release", {
    reservationId: 17, expectedVersion: 2,
    releases: [71, 72].map((allocationId) => ({ allocationId, expectedVersion: 1, quantity: 1 }))
  }));
  assert.equal(result.allocations.length, 2);
  assert.equal(database.state.balance.allocated_quantity, 2);
  assert.equal(database.state.balance.version, 3);
  assert.deepEqual(database.state.allocations.map(({ outstanding_quantity }) => outstanding_quantity), [1, 1]);
});

test("TASK-022 Allocation release rolls back all writes if required Audit fails", async () => {
  const { service, database } = setup({ auditFails: true });
  const before = database.state;
  await assert.rejects(() => service.releaseAllocation(command("release", {
    reservationId: 17, expectedVersion: 2,
    releases: [{ allocationId: 71, expectedVersion: 1, quantity: 4 }]
  })), /injected audit failure/u);
  assert.deepEqual(database.state, before);
});

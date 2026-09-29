import assert from "node:assert/strict";
import test from "node:test";

import { InventoryPostingService } from "../src/modules/inventory/InventoryPostingService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const NOW = Date.parse("2026-09-28T04:00:00.000Z");

function command(lines, eventId = "ship-1") {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "issue.post", requiredCallerPermission: "inventory.operation" },
    source: { module: "FULFILLMENT", documentType: "SHIPMENT", eventId },
    correlationId: eventId,
    payload: { reservationId: 17, expectedVersion: 2, lines }
  });
}

const lines = [
  { allocationId: 71, expectedVersion: 1, balanceId: 41, expectedBalanceVersion: 2, quantity: 2 },
  { allocationId: 72, expectedVersion: 1, balanceId: 42, expectedBalanceVersion: 3, quantity: 1 }
];

function setup({ auditFails = false, expired = false, lockedBin = false,
  sharedBalance = false, minimumRemainingDays = 0, permissions = ["inventory.operation"] } = {}) {
  const database = createFakeInventoryDatabase({
    initialState: {
      warehouse: { id: 2, warehouse_code: "WH-2", status: "ACTIVE" },
      control: { id: 5, warehouse_id: 2, sku_id: 12, reserved_quantity: 4, version: 3 },
      reservation: { id: 17, warehouse_id: 2, sku_id: 12,
        original_quantity: 6, consumed_quantity: 2, released_quantity: 0,
        outstanding_quantity: 4, minimum_remaining_days: minimumRemainingDays,
        status: "PARTIALLY_CONSUMED", version: 2 },
      bins: [
        { id: 31, warehouse_id: 2, bin_code: "A", status: "ACTIVE" },
        { id: 32, warehouse_id: 2, bin_code: "B", status: "ACTIVE" }
      ],
      balances: [
        { id: 41, warehouse_id: 2, sku_id: 12, bin_id: 31, lot_id: 51,
          stock_status: "AVAILABLE", on_hand_quantity: 5,
          allocated_quantity: sharedBalance ? 4 : 2, version: 2 },
        { id: 42, warehouse_id: 2, sku_id: 12, bin_id: 32, lot_id: 52,
          stock_status: "AVAILABLE", on_hand_quantity: 4,
          allocated_quantity: sharedBalance ? 0 : 2, version: 3 }
      ],
      lots: [
        { id: 51, sku_id: 12, lot_number: "LOT-51", expiry_date: expired ? "2026-09-27" : "2026-10-31" },
        { id: 52, sku_id: 12, lot_number: "LOT-52", expiry_date: "2026-11-30" }
      ],
      allocations: [
        { id: 71, reservation_id: 17, stock_balance_id: 41,
          allocated_quantity: 2, consumed_quantity: 0, released_quantity: 0,
          outstanding_quantity: 2, status: "ACTIVE", version: 1 },
        { id: 72, reservation_id: 17, stock_balance_id: sharedBalance ? 41 : 42,
          allocated_quantity: 2, consumed_quantity: 0, released_quantity: 0,
          outstanding_quantity: 2, status: "ACTIVE", version: 1 }
      ],
      movements: [], audits: [], completed: null
    },
    async query({ sql, params, state }) {
      if (sql.includes("FROM inventory_reservations")) return [[state.reservation]];
      if (sql.includes("FROM inventory_allocations a")) return [state.allocations.filter(({ id }) =>
        params.includes(id)).map((allocation) => {
        const balance = state.balances.find(({ id }) => id === allocation.stock_balance_id);
        const lot = state.lots.find(({ id }) => id === balance.lot_id);
        return { ...allocation, warehouse_id: balance.warehouse_id, sku_id: balance.sku_id,
          bin_id: balance.bin_id, lot_id: balance.lot_id, stock_status: balance.stock_status,
          expiry_date: lot.expiry_date, lot_number: lot.lot_number };
      })];
      if (sql.includes("FROM inventory_allocations")) return [state.allocations.filter(({ id }) => params.includes(id))];
      if (sql.includes("FROM inventory_lots")) return [state.lots.filter(({ id }) => params.includes(id))];
      return [[]];
    },
    async execute({ sql, params, state }) {
      if (sql.includes("UPDATE inventory_stock_controls")) {
        if (state.control.version !== params.at(-1)) return [{ affectedRows: 0 }];
        state.control.reserved_quantity = params[0];
        state.control.version += 1;
      }
      if (sql.includes("UPDATE inventory_stock_balances")) {
        const balance = state.balances.find(({ id }) => id === params.at(-2));
        if (balance.version !== params.at(-1)) return [{ affectedRows: 0 }];
        balance.on_hand_quantity = params[0];
        balance.allocated_quantity = params[1];
        balance.version += 1;
      }
      if (sql.includes("UPDATE inventory_allocations")) {
        const allocation = state.allocations.find(({ id }) => id === params.at(-2));
        if (allocation.version !== params.at(-1)) return [{ affectedRows: 0 }];
        allocation.consumed_quantity = params[0];
        allocation.outstanding_quantity = params[1];
        allocation.status = params[2];
        allocation.version += 1;
      }
      if (sql.includes("UPDATE inventory_reservations")) {
        if (state.reservation.version !== params.at(-1)) return [{ affectedRows: 0 }];
        state.reservation.consumed_quantity = params[0];
        state.reservation.outstanding_quantity = params[1];
        state.reservation.status = params[2];
        state.reservation.version += 1;
      }
      if (sql.includes("INSERT INTO inventory_movements")) {
        assert.equal((sql.match(/\?/gu) ?? []).length, params.length);
        const id = 701 + state.movements.length;
        state.movements.push({ id, params });
        return [{ affectedRows: 1, insertId: id }];
      }
      return [{ affectedRows: 1 }];
    }
  });
  const service = new InventoryPostingService({
    database, time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    authorize: async () => ({ username: "sam", permissions }),
    itemLookup: { async getInventoryProfileInTransaction() {
      return { usable: true, inventoryTracked: true, trackingPolicy: "batch_expiry",
        skuCode: "SKU-12", skuName: "Widget", baseUom: { uomId: 5, uomCode: "EA" } };
    } },
    operations: {
      async claim(transaction, input) {
        if (transaction.state.completed && transaction.state.eventId === input.source.eventId) {
          return { operationId: 91, replay: { resultSummary: transaction.state.completed } };
        }
        transaction.state.eventId = input.source.eventId;
        return { operationId: 91, replay: null };
      },
      async complete(transaction, input) { transaction.state.completed = input.resultSummary; }
    },
    locks: { async lockForCommand(transaction) { return {
      warehouses: [transaction.state.warehouse], stockControls: [structuredClone(transaction.state.control)],
      bins: transaction.state.bins, binLocks: lockedBin ? [{ bin_id: 31 }] : [],
      balances: transaction.state.balances.map((row) => structuredClone(row)),
      reservations: [structuredClone(transaction.state.reservation)]
    }; } },
    audit: { async recordSucceeded(transaction, input) {
      if (auditFails) throw new Error("injected Audit failure");
      transaction.state.audits.push(input);
    } },
    createMovementGroupId: () => "11111111-1111-4111-8111-111111111111"
  });
  return { service, database };
}

test("TASK-022 Issue consumes matching Allocations and persists one Movement per line", async () => {
  const { service, database } = setup();
  const request = command(lines);
  const result = await service.postIssue(request);
  assert.deepEqual(await service.postIssue(request), result);
  assert.deepEqual([result.status, result.quantity, result.version, result.lines.length], ["POSTED", 3, 3, 2]);
  assert.deepEqual(database.state.balances.map(({ on_hand_quantity, allocated_quantity }) =>
    [on_hand_quantity, allocated_quantity]), [[3, 0], [3, 1]]);
  assert.deepEqual([database.state.control.reserved_quantity,
    database.state.reservation.consumed_quantity, database.state.reservation.outstanding_quantity], [1, 5, 1]);
  assert.deepEqual(database.state.allocations.map(({ outstanding_quantity }) => outstanding_quantity), [0, 1]);
  assert.equal(database.state.movements.length, 2);
  assert.equal(database.state.audits.length, 1);
});

test("TASK-023 Fulfillment Issue provider posts without Inventory management permission", async () => {
  const { service, database } = setup({ permissions: ["fulfillment.operation"] });
  const result = await database.withTransaction((transaction) => service.postFulfillmentIssueInTransaction(
    transaction, {
      actor: { userId: 7, serviceName: "", claimedRoles: [], claimedPermissions: ["fulfillment.operation"] },
      source: { documentId: "SHIP-42", eventId: "posted-1" },
      correlationId: "posted-1",
      payload: { reservationId: 17, expectedVersion: 2, lines }
    }
  ));
  assert.equal(result.status, "POSTED");
  assert.equal(database.state.reservation.outstanding_quantity, 1);
});

test("TASK-022 Issue rejects Allocation/Balance mismatch without a partial posting", async () => {
  const { service, database } = setup();
  const before = database.state;
  await assert.rejects(() => service.postIssue(command([{ ...lines[0], balanceId: 42 }])),
    (error) => error.code === "ALLOCATION_STATE_CONFLICT");
  assert.deepEqual(database.state, before);
});

test("TASK-022 Issue advances one Balance version across two matching Allocations", async () => {
  const { service, database } = setup({ sharedBalance: true });
  const request = command([lines[0], { ...lines[1], balanceId: 41 }]);
  const result = await service.postIssue(request);
  assert.deepEqual(await service.postIssue(request), result);
  assert.deepEqual(result.lines.map(({ balanceVersion }) => balanceVersion), [3, 4]);
  assert.deepEqual([database.state.balances[0].on_hand_quantity,
    database.state.balances[0].allocated_quantity, database.state.balances[0].version], [2, 1, 4]);
});

test("TASK-022 Issue rejects an expired Lot and a Stocktake-locked Bin", async () => {
  for (const options of [{ expired: true }, { lockedBin: true }]) {
    const { service, database } = setup(options);
    const before = database.state;
    await assert.rejects(() => service.postIssue(command(lines)), (error) =>
      ["LOT_EXPIRED", "BIN_LOCKED_BY_STOCKTAKE"].includes(error.code));
    assert.deepEqual(database.state, before);
  }
});

test("TASK-022 Issue enforces Reservation minimum remaining life", async () => {
  const { service, database } = setup({ minimumRemainingDays: 40 });
  const before = database.state;
  await assert.rejects(() => service.postIssue(command(lines)),
    (error) => error.code === "LOT_MINIMUM_LIFE_FAILED");
  assert.deepEqual(database.state, before);
});

test("TASK-022 Issue rolls back Balance, Reservation, Allocation and Movement when Audit fails", async () => {
  const { service, database } = setup({ auditFails: true });
  const before = database.state;
  await assert.rejects(() => service.postIssue(command(lines)), /injected Audit failure/u);
  assert.deepEqual(database.state, before);
});

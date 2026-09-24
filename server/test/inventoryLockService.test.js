import assert from "node:assert/strict";
import test from "node:test";

import { InventoryLockService } from "../src/modules/inventory/InventoryLockService.js";

function recordingConnection() {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ method: "execute", sql: String(sql), params });
      return [{ affectedRows: params.length }];
    },
    async query(sql, params) {
      calls.push({ method: "query", sql: String(sql), params });
      return [[]];
    }
  };
}

test("InventoryLockService deduplicates, sorts and acquires every lock stage in the fixed order", async () => {
  const connection = recordingConnection();

  await new InventoryLockService().lockForCommand(connection, {
    warehouseIds: [9, 2, 9],
    stockControls: [
      { warehouseId: 9, skuId: 4 },
      { warehouseId: 2, skuId: 8 },
      { warehouseId: 2, skuId: 3 },
      { warehouseId: 2, skuId: 3 }
    ],
    binIds: [20, 4, 20],
    lots: [
      { skuId: 8, normalizedLotNumber: "LOT-Z" },
      { skuId: 3, normalizedLotNumber: "LOT-A" }
    ],
    balances: [
      { warehouseId: 9, skuId: 4, binId: 20, lotId: null, stockStatus: "AVAILABLE" },
      { warehouseId: 2, skuId: 8, binId: 4, lotId: 12, stockStatus: "DAMAGED" },
      { warehouseId: 2, skuId: 3, binId: 4, lotId: null, stockStatus: "AVAILABLE" }
    ],
    reservationIds: [7, 1, 7],
    transferIds: [8, 2],
    stocktakeIds: [6, 3],
    now: 1_700_000_000_000
  });

  assert.deepEqual(connection.calls.map(({ method, sql }) => [
    method,
    sql.match(/inventory_[a-z_]+/u)?.[0]
  ]), [
    ["query", "inventory_warehouses"],
    ["execute", "inventory_stock_controls"],
    ["query", "inventory_stock_controls"],
    ["query", "inventory_bins"],
    ["query", "inventory_bin_locks"],
    ["query", "inventory_lots"],
    ["execute", "inventory_stock_balances"],
    ["query", "inventory_stock_balances"],
    ["query", "inventory_reservations"],
    ["query", "inventory_transfers"],
    ["query", "inventory_stocktakes"]
  ]);
  assert.deepEqual(connection.calls[0].params, [2, 9]);
  assert.deepEqual(connection.calls[1].params.slice(0, 4), [2, 3, 1_700_000_000_000, 1_700_000_000_000]);
  assert.deepEqual(connection.calls[2].params, [2, 3, 2, 8, 9, 4]);
  assert.deepEqual(connection.calls[3].params, [4, 20]);
  assert.deepEqual(connection.calls[5].params, [3, "LOT-A", 8, "LOT-Z"]);
  assert.deepEqual(connection.calls[7].params, [2, 3, 4, 0, "AVAILABLE", 2, 8, 4, 12, "DAMAGED", 9, 4, 20, 0, "AVAILABLE"]);
  assert.deepEqual(connection.calls[8].params, [1, 7]);
  assert.deepEqual(connection.calls[9].params, [2, 8]);
  assert.deepEqual(connection.calls[10].params, [3, 6]);
  for (const call of connection.calls.filter(({ method }) => method === "query")) {
    assert.match(call.sql, /ORDER BY .* FOR UPDATE$/su);
  }
  assert.match(connection.calls[1].sql, /ON DUPLICATE KEY UPDATE id = id/u);
  assert.match(connection.calls[6].sql, /ON DUPLICATE KEY UPDATE id = id/u);
});

test("InventoryLockService requires a transaction executor and validates lock keys", async () => {
  const service = new InventoryLockService();

  await assert.rejects(() => service.lockForCommand(null, {}), /caller-owned transaction executor/);
  await assert.rejects(
    () => service.lockForCommand(recordingConnection(), {
      warehouseIds: [1],
      balances: [{ warehouseId: 1, skuId: 2, binId: 3, lotId: null, stockStatus: "UNKNOWN" }],
      now: 1
    }),
    /stock status/
  );
  await assert.rejects(
    () => service.lockForCommand(recordingConnection(), {
      warehouseIds: [1],
      stockControls: [{ warehouseId: 2, skuId: 3 }],
      now: 1
    }),
    /requires its warehouse lock/
  );
});

test("InventoryLockService maps MySQL deadlocks and lock timeouts to CONCURRENT_OPERATION", async () => {
  const service = new InventoryLockService();
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]) {
    const connection = {
      async execute() {},
      async query() { throw Object.assign(new Error("database detail"), { code }); }
    };
    await assert.rejects(
      () => service.lockForCommand(connection, { warehouseIds: [1] }),
      (error) => error.code === "CONCURRENT_OPERATION" && !error.message.includes("database detail")
    );
  }
});

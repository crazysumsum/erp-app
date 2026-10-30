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

test("TASK-018 post-Lot Balance lock maps an asynchronous timeout to CONCURRENT_OPERATION", async () => {
  const connection = {
    async execute() {
      throw Object.assign(new Error("database detail"), { code: "ER_LOCK_WAIT_TIMEOUT" });
    },
    async query() { return [[]]; }
  };

  await assert.rejects(
    () => new InventoryLockService().lockBalancesAfterLot(connection, {
      balances: [{ warehouseId: 1, skuId: 1, binId: 1, lotId: null, stockStatus: "AVAILABLE" }],
      now: 1
    }),
    (error) => error.code === "CONCURRENT_OPERATION" && !error.message.includes("database detail")
  );
});

test("InventoryLockService tolerates only the pre-Stocktake absence of semantic lock tables", async () => {
  const missingTable = Object.assign(new Error("missing"), { code: "ER_NO_SUCH_TABLE" });
  const connection = recordingConnection();
  connection.query = async (sql, params) => {
    connection.calls.push({ method: "query", sql: String(sql), params });
    if (String(sql).includes("information_schema.tables")) return [[]];
    if (String(sql).includes("inventory_bin_locks")) throw missingTable;
    return [[]];
  };

  const locked = await new InventoryLockService().lockForCommand(connection, {
    warehouseIds: [1],
    binIds: [2]
  });
  assert.deepEqual(locked.binLocks, []);

  connection.query = async (sql) => {
    if (String(sql).includes("information_schema.tables")) return [[{ table_name: "inventory_stocktakes" }]];
    if (String(sql).includes("inventory_bin_locks")) throw missingTable;
    return [[]];
  };
  await assert.rejects(
    () => new InventoryLockService().lockForCommand(connection, { warehouseIds: [1], binIds: [2] }),
    missingTable
  );
});

test("InventoryLockService locks a Balance only after its Lot identity is known", async () => {
  const connection = recordingConnection();

  await new InventoryLockService().lockBalancesAfterLot(connection, {
    balances: [{ warehouseId: 2, skuId: 3, binId: 4, lotId: 12, stockStatus: "QUARANTINED" }],
    now: 1_700_000_000_000
  });

  assert.deepEqual(connection.calls.map(({ method }) => method), ["execute", "query"]);
  assert.match(connection.calls[0].sql, /INSERT INTO inventory_stock_balances/u);
  assert.match(connection.calls[1].sql, /ORDER BY warehouse_id, sku_id, bin_id, lot_scope, stock_status FOR UPDATE$/su);
  assert.deepEqual(connection.calls[1].params, [2, 3, 4, 12, "QUARANTINED"]);
});

function controlInput(count) {
  return { warehouseIds: [1], stockControls: Array.from({ length: count }, (_, index) => ({
    warehouseId: 1, skuId: count - index
  })), now: 1_700_000_000_000 };
}

function controlCalls(connection, method) {
  return connection.calls.filter(call => call.method === method && call.sql.includes("inventory_stock_controls"));
}

function callerOwnedConnection() {
  const connection = recordingConnection();
  for (const method of ["beginTransaction", "commit", "rollback", "getConnection"]) {
    connection[method] = () => assert.fail(`LockService must not call ${method}`);
  }
  return connection;
}

test("ST041-LU07 empty Controls do not execute SQL or require a timestamp", async () => {
  const connection = callerOwnedConnection();
  const result = await new InventoryLockService().lockForCommand(connection, { warehouseIds: [1], binIds: [2] });
  assert.deepEqual(result.stockControls, []);
  assert.equal(controlCalls(connection, "execute").length, 0);
  assert.equal(controlCalls(connection, "query").length, 0);
  assert.deepEqual(connection.calls.map(call => call.sql.match(/inventory_[a-z_]+/u)[0]),
    ["inventory_warehouses", "inventory_bins", "inventory_bin_locks"]);
});

test("ST041-LU08 Controls retain sorted deduplication at 999, 1000 and 1001 key boundaries", async () => {
  for (const count of [999, 1000, 1001]) {
    const connection = callerOwnedConnection(), input = controlInput(count);
    input.warehouseIds = [2, 1, 2]; input.binIds = [7];
    for (const row of input.stockControls) if (row.skuId % 2 === 0) row.warehouseId = 2;
    const expected = [...input.stockControls].sort((a, b) => a.warehouseId - b.warehouseId || a.skuId - b.skuId);
    input.stockControls.push({ ...expected[0] }, { ...expected[Math.min(999, count - 1)] });
    await new InventoryLockService().lockForCommand(connection, input);
    const inserts = controlCalls(connection, "execute"), reads = controlCalls(connection, "query");
    assert.deepEqual(inserts.map(call => call.params.length), count <= 1000 ? [count * 4] : [4000, 4]);
    assert.deepEqual(reads.map(call => call.params.length), count <= 1000 ? [count * 2] : [2000, 2]);
    assert.deepEqual(inserts.flatMap(call => call.params), expected.flatMap(row => [row.warehouseId, row.skuId, input.now, input.now]));
    assert.deepEqual(reads.flatMap(call => call.params), expected.flatMap(row => [row.warehouseId, row.skuId]));
    assert.deepEqual(connection.calls.map(call => call.method),
      ["query", ...inserts.map(() => "execute"), ...reads.map(() => "query"), "query", "query"]);
    assert.match(connection.calls[0].sql, /inventory_warehouses/u);
    assert.match(connection.calls.at(-2).sql, /inventory_bins/u);
    for (const call of inserts) assert.match(call.sql, /ON DUPLICATE KEY UPDATE id = id$/u);
    for (const call of reads) assert.match(call.sql, /ORDER BY warehouse_id, sku_id FOR UPDATE$/u);
  }
});

test("ST041-LU09 fifty thousand Controls use bounded SQL without lost or repeated keys", async () => {
  const connection = callerOwnedConnection(), input = controlInput(50000);
  await new InventoryLockService().lockForCommand(connection, input);
  const inserts = controlCalls(connection, "execute"), reads = controlCalls(connection, "query");
  assert.equal(inserts.length, 50); assert.equal(reads.length, 50);
  assert.ok(inserts.every(call => call.params.length === 4000));
  assert.ok(reads.every(call => call.params.length === 2000));
  assert.deepEqual(inserts.flatMap(call => call.params), [...input.stockControls].reverse().flatMap(row => [1, row.skuId, input.now, input.now]));
  assert.deepEqual(reads.flatMap(call => call.params), [...input.stockControls].reverse().flatMap(row => [1, row.skuId]));
  assert.deepEqual(connection.calls.map(call => call.method), ["query", ...Array(50).fill("execute"), ...Array(50).fill("query")]);
});

test("ST041-LU10 aggregate Control rows preserve DB identities, fields and complete ordering", async () => {
  const connection = callerOwnedConnection(), input = controlInput(1001);
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: index + 90, warehouse_id: 1, sku_id: index + 1,
    reserved_quantity: index % 7, version: index + 2, created_at: input.now - 100, updated_at: input.now - 20 }));
  const query = connection.query.bind(connection);
  connection.query = async (sql, params) => {
    await query(sql, params);
    return [sql.includes("inventory_stock_controls") ? params.filter((_, index) => index % 2).map(skuId => rows[skuId - 1]) : []];
  };
  const result = await new InventoryLockService().lockForCommand(connection, input);
  assert.deepEqual(result.stockControls, rows);
  for (let index = 0; index < rows.length; index++) assert.equal(result.stockControls[index], rows[index]);
  for (const [key, value] of Object.entries(result)) if (key !== "stockControls") assert.deepEqual(value, []);
});

test("ST041-LU11 a second Control INSERT failure stops all reads and preserves error policy", async () => {
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "TEST_INJECTED"]) for (const wrapped of [false, true]) {
    const connection = callerOwnedConnection(), native = Object.assign(new Error("native detail"), { code });
    const error = wrapped ? Object.assign(new Error("outer"), { cause: native }) : native;
    const execute = connection.execute.bind(connection);
    connection.execute = async (sql, params) => {
      await execute(sql, params);
      if (controlCalls(connection, "execute").length === 2) throw error;
      return [{}];
    };
    const input = controlInput(1001); input.binIds = [2];
    await assert.rejects(() => new InventoryLockService().lockForCommand(connection, input),
      actual => code === "TEST_INJECTED" ? actual === error : actual.code === "CONCURRENT_OPERATION");
    assert.equal(controlCalls(connection, "execute").length, 2);
    assert.deepEqual(connection.calls.map(call => call.method), ["query", "execute", "execute"]);
    assert.equal(controlCalls(connection, "query").length, 0);
  }
});

test("ST041-LU12 a second Control read failure never returns a partial result or enters later stages", async () => {
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "TEST_INJECTED"]) for (const wrapped of [false, true]) {
    const connection = callerOwnedConnection(), native = Object.assign(new Error("native detail"), { code });
    const error = wrapped ? Object.assign(new Error("outer"), { cause: native }) : native;
    const query = connection.query.bind(connection);
    connection.query = async (sql, params) => {
      await query(sql, params);
      if (controlCalls(connection, "query").length === 2) throw error;
      return [[]];
    };
    const input = controlInput(1001); input.binIds = [2];
    await assert.rejects(() => new InventoryLockService().lockForCommand(connection, input),
      actual => code === "TEST_INJECTED" ? actual === error : actual.code === "CONCURRENT_OPERATION");
    assert.deepEqual(connection.calls.map(call => call.method), ["query", "execute", "execute", "query", "query"]);
    assert.equal(controlCalls(connection, "query").length, 2);
  }
});

function assertTupleLotCall(connection, params) {
  const calls = connection.calls.filter(call => call.sql.includes("inventory_lots"));
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.method, "query");
  assert.equal(call.sql.replace(/\s+/gu, " ").trim(),
    `SELECT * FROM inventory_lots WHERE (sku_id, normalized_lot_number) IN (${Array.from({ length: params.length / 2 }, () => "(?, ?)").join(", ")}) ORDER BY sku_id, normalized_lot_number FOR UPDATE`);
  assert.deepEqual(call.params, params);
}

test("ST041-LU13 empty and single Lot inputs retain caller-owned query and DB rows", async () => {
  const empty = callerOwnedConnection();
  assert.deepEqual((await new InventoryLockService().lockForCommand(empty, {})).lots, []);
  assert.deepEqual(empty.calls, []);
  const connection = callerOwnedConnection(), rows = [{ id: 9, sku_id: 3, normalized_lot_number: "ONLY" }];
  const query = connection.query.bind(connection);
  connection.query = async (sql, params) => { await query(sql, params); return [rows]; };
  const result = await new InventoryLockService().lockForCommand(connection, { lots: [{ skuId: 3, normalizedLotNumber: "ONLY" }] });
  assert.equal(result.lots, rows); assert.equal(result.lots[0], rows[0]);
  assertTupleLotCall(connection, [3, "ONLY"]);
});

test("ST041-LU14 tuple pairs retain exact deduplication and normalized parameter order", async () => {
  const connection = callerOwnedConnection();
  await new InventoryLockService().lockForCommand(connection, { lots: [
    { skuId: 7, normalizedLotNumber: "A" }, { skuId: 3, normalizedLotNumber: "Z" },
    { skuId: 3, normalizedLotNumber: "A" }, { skuId: 3, normalizedLotNumber: "A" },
    { skuId: 7, normalizedLotNumber: "Z" }
  ] });
  assertTupleLotCall(connection, [3, "A", 3, "Z", 7, "A", 7, "Z"]);
  assert.equal(connection.calls.length, 1);
});

test("ST041-LU15 twenty-five thousand Lot pairs stay in one complete parameterized query", async () => {
  const connection = callerOwnedConnection();
  const lots = Array.from({ length: 25000 }, (_, index) => ({ skuId: 25000 - index, normalizedLotNumber: `LOT-${25000 - index}` }));
  const rows = lots.map((lot, index) => ({ id: index + 1, sku_id: lot.skuId, normalized_lot_number: lot.normalizedLotNumber }));
  const query = connection.query.bind(connection);
  connection.query = async (sql, params) => { await query(sql, params); return [rows]; };
  const result = await new InventoryLockService().lockForCommand(connection, { lots });
  assertTupleLotCall(connection, [...lots].reverse().flatMap(lot => [lot.skuId, lot.normalizedLotNumber]));
  assert.equal(connection.calls.length, 1); assert.equal(result.lots, rows); assert.equal(result.lots.length, 25000);
});

test("ST041-LU16 Lot strings preserve Unicode and byte boundary while invalid keys fail before SQL", async () => {
  const names = ["a", "A", "café", "日本語", "😀", "O'HARE", "PAD ", "é".repeat(50)];
  const connection = callerOwnedConnection();
  await new InventoryLockService().lockForCommand(connection, { lots: names.map(normalizedLotNumber => ({ skuId: 3, normalizedLotNumber })) });
  assertTupleLotCall(connection, [...names].sort().flatMap(name => [3, name]));
  for (const lot of [
    ...["", "bad\n", "bad\u0000", "é".repeat(51)].map(normalizedLotNumber => ({ skuId: 3, normalizedLotNumber })),
    ...[0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1].map(skuId => ({ skuId, normalizedLotNumber: "VALID" }))
  ]) {
    const invalid = callerOwnedConnection();
    await assert.rejects(() => new InventoryLockService().lockForCommand(invalid, { lots: [lot] }), TypeError);
    assert.deepEqual(invalid.calls, []);
  }
});

test("ST041-LU17 Lot failures retain native mapping and stop every following lock stage", async () => {
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "TEST_INJECTED"]) for (const wrapped of [false, true]) {
    const connection = callerOwnedConnection(), native = Object.assign(new Error("native detail"), { code });
    const error = wrapped ? Object.assign(new Error("outer"), { cause: native }) : native;
    const query = connection.query.bind(connection);
    connection.query = async (sql, params) => {
      await query(sql, params);
      if (sql.includes("inventory_lots")) throw error;
      return [[]];
    };
    await assert.rejects(() => new InventoryLockService().lockForCommand(connection, {
      warehouseIds: [1], stockControls: [{ warehouseId: 1, skuId: 3 }], binIds: [2],
      lots: [{ skuId: 3, normalizedLotNumber: "A" }],
      balances: [{ warehouseId: 1, skuId: 3, binId: 2, lotId: 4, stockStatus: "AVAILABLE" }],
      reservationIds: [1], transferIds: [1], stocktakeIds: [1], now: 1
    }), actual => code === "TEST_INJECTED" ? actual === error : actual.code === "CONCURRENT_OPERATION" && !actual.message.includes("native detail"));
    assert.deepEqual(connection.calls.map(call => call.sql.match(/inventory_[a-z_]+/u)[0]),
      ["inventory_warehouses", "inventory_stock_controls", "inventory_stock_controls", "inventory_bins", "inventory_bin_locks", "inventory_lots"]);
    assertTupleLotCall(connection, [3, "A"]);
  }
});

test("ST041-LU18 complete multi-stage calls preserve database row objects and lock classes", async () => {
  const connection = callerOwnedConnection();
  const rows = [{ id: 7, sku_id: 3, normalized_lot_number: "Z", expiry_date: "2030-01-01", version: 9 },
    { id: 2, sku_id: 3, normalized_lot_number: "A", expiry_date: null, version: 4 }];
  const query = connection.query.bind(connection);
  connection.query = async (sql, params) => { await query(sql, params); return [sql.includes("inventory_lots") ? rows : []]; };
  const result = await new InventoryLockService().lockForCommand(connection, {
    warehouseIds: [1], stockControls: [{ warehouseId: 1, skuId: 3 }], binIds: [2],
    lots: [{ skuId: 3, normalizedLotNumber: "Z" }, { skuId: 3, normalizedLotNumber: "A" }],
    balances: [{ warehouseId: 1, skuId: 3, binId: 2, lotId: 7, stockStatus: "AVAILABLE" }],
    reservationIds: [8], transferIds: [9], stocktakeIds: [10], now: 1
  });
  assert.deepEqual(connection.calls.map(call => [call.method, call.sql.match(/inventory_[a-z_]+/u)[0]]), [
    ["query", "inventory_warehouses"], ["execute", "inventory_stock_controls"], ["query", "inventory_stock_controls"],
    ["query", "inventory_bins"], ["query", "inventory_bin_locks"], ["query", "inventory_lots"],
    ["execute", "inventory_stock_balances"], ["query", "inventory_stock_balances"], ["query", "inventory_reservations"],
    ["query", "inventory_transfers"], ["query", "inventory_stocktakes"]
  ]);
  assertTupleLotCall(connection, [3, "A", 3, "Z"]);
  assert.equal(result.lots, rows); assert.equal(result.lots[0], rows[0]); assert.equal(result.lots[1], rows[1]);
  assert.deepEqual(connection.calls[7].params, [1, 3, 2, 7, "AVAILABLE"]);
  assert.deepEqual(connection.calls.slice(-3).map(call => call.params), [[8], [9], [10]]);
});

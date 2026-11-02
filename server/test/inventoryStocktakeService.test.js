import assert from "node:assert/strict";
import test from "node:test";
import { InventoryStocktakeService } from "../src/modules/inventory/InventoryStocktakeService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const time = { nowMs: () => 1791763200000 };
const header = { id: 41, warehouse_id: 1, stocktake_number: "ST-21", status: "DRAFT", version: 1, reason: "" };
const scope = { id: 101, stocktake_id: 41, bin_id: 1, bin_code_snapshot: "BIN-1" };
function command(action = "create", payload = { warehouseId: 1, binIds: [1, 2] }, changes = {}) {
  return inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", eventId: action }, payload, ...changes });
}
function fixture(initial = {}, overrides = {}) {
  const database = createFakeInventoryDatabase({ initialState: { headers: [], scopes: [], lines: [], locks: [], audits: [], ...initial },
    query: async ({ sql, params, state }) => {
      if (sql.includes("FROM inventory_stocktakes")) return [state.headers.filter(row => sql.includes("FOR UPDATE")
        ? row.warehouse_id === params[0] && (["DRAFT", "COUNTING", "READY_TO_POST"].includes(row.status) || row.id === params[1])
        : row.id === params[0])];
      if (sql.includes("FROM inventory_stocktake_bins")) return [state.scopes.filter(row => params.includes(row.stocktake_id))];
      if (sql.includes("FROM inventory_stock_balances")) return [initial.balances ?? []];
      return [[]];
    }, execute: async ({ sql, params, state }) => {
      if (overrides.failSql?.test(sql)) throw new Error("synthetic write failure");
      if (sql.includes("INSERT INTO inventory_stocktakes")) {
        state.headers.push({ ...header, stocktake_number: params[0], warehouse_id: params[1], reason: params[3] });
        return [{ insertId: 41, affectedRows: 1 }];
      }
      if (sql.includes("DELETE FROM inventory_stocktake_bins")) state.scopes = state.scopes.filter(row => row.stocktake_id !== params[0]);
      if (sql.includes("INSERT INTO inventory_stocktake_bins")) state.scopes.push({ id: 101 + state.scopes.length,
        stocktake_id: params[0], bin_id: params[1], bin_code_snapshot: params[2] });
      if (sql.includes("INSERT INTO inventory_bin_locks")) state.locks.push(params);
      if (sql.includes("INSERT INTO inventory_stocktake_lines")) state.lines.push(params);
      if (sql.includes("UPDATE inventory_stocktakes")) {
        const row = state.headers.find(value => value.id === params.at(-2));
        if (row) { row.version += 1; row.status = sql.includes("'COUNTING'") ? "COUNTING" : sql.includes("'CANCELLED'") ? "CANCELLED" : "DRAFT"; }
      }
      return [{ affectedRows: 1 }];
    } });
  const lockCalls = [];
  const options = { database, time, logger: { error() {} }, authorize: async () => ({ username: "synthetic", permissions: ["inventory.operation"] }),
    audit: { recordSucceeded: async (tx, record) => tx.state.audits.push(record) },
    operations: { claim: async () => ({ operationId: 21 }), complete: async () => {} },
    locks: { lockForCommand: async (_tx, input) => {
      lockCalls.push(input);
      return { warehouses: [{ id: 1, status: "ACTIVE" }],
        bins: [1, 2].filter(id => input.binIds?.includes(id)).map(id => ({ id, warehouse_id: 1, bin_code: `BIN-${id}`, status: "ACTIVE" })),
        binLocks: overrides.binLocks ?? [] };
    }, lockForStocktakeDraftCreate: async (tx, input, writeDraft) => {
      const locked = await options.locks.lockForCommand(tx, input);
      const draft = await writeDraft(locked);
      if (locked.binLocks.length) throw Object.assign(new Error("Synthetic active lock"), { code: "BIN_LOCKED_BY_STOCKTAKE" });
      return { ...locked, draft };
    } }, ...overrides };
  return { database, lockCalls, service: new InventoryStocktakeService(options) };
}
test("ST036-U01 creates multi-Bin exclusive Draft without quantity, lock or snapshot effects", async () => {
  const f = fixture(); const result = await f.service.create(command());
  assert.deepEqual(result, { id: 41, operationId: 21, status: "DRAFT", version: 1, rowCount: 2 });
  assert.equal(f.database.state.scopes.length, 2); assert.equal(f.database.state.audits[0].action, "stocktake.create");
  assert.equal(f.database.state.locks.length, 0); assert.equal(f.database.state.lines.length, 0);
  assert.ok(f.database.calls.every(call => !/INSERT|UPDATE|DELETE/u.test(call.sql) || !/inventory_stock_balances|inventory_stock_controls|inventory_movements/u.test(call.sql)));
});
test("ST036-U02 rejects empty, repeated, coerced IDs and caller-owned fields before writes", async () => {
  for (const payload of [{ warehouseId: 1, binIds: [] }, { warehouseId: 1, binIds: [1, 1] },
    ...["1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ warehouseId: 1, binIds: [value] })),
    { warehouseId: "1", binIds: [1] }, { warehouseId: 1, binIds: [1], snapshotQuantity: 20 },
    { warehouseId: 1, binIds: [1], actorId: 7 }]) {
    const f = fixture(); await assert.rejects(f.service.create(command("create", payload)), { code: "INVENTORY_INPUT_INVALID" });
    assert.equal(f.database.state.headers.length, 0);
  }
});
test("ST036-U03 fresh permission and fixed authorization are mandatory, including replay", async () => {
  const f = fixture({}, { authorize: async () => ({ permissions: [] }) });
  await assert.rejects(f.service.create(command()), { code: "PERMISSION_STALE" });
  await assert.rejects(f.service.create(command("create", undefined, { authorization: { purpose: "stocktake.create", requiredCallerPermission: "sales.operation" } })), /authorization contract mismatch/u);
  const g = fixture({}, { authorize: async () => ({ permissions: [] }), operations: { claim: async () => ({ replay: { resultSummary: { id: 41 } } }) } });
  await assert.rejects(g.service.create(command()), { code: "PERMISSION_STALE" });
});
test("ST036-U04 full Draft scope replacement retains the header and has no stock effect", async () => {
  const f = fixture({ headers: [header], scopes: [scope] });
  const result = await f.service.update(command("update", { stocktakeId: 41, expectedVersion: 1, binIds: [2] }));
  assert.equal(result.version, 2); assert.deepEqual(f.database.state.scopes.map(row => row.bin_id), [2]);
  assert.equal(f.database.state.locks.length, 0); assert.equal(f.database.state.lines.length, 0);
});
test("ST036-U05 every other unfinished owner conflicts, self and terminal history do not", async () => {
  for (const status of ["DRAFT", "COUNTING", "READY_TO_POST"]) {
    const f = fixture({ headers: [{ ...header, id: 42, status }], scopes: [{ ...scope, stocktake_id: 42 }] });
    await assert.rejects(f.service.create(command()), { code: "STOCKTAKE_STATE_CONFLICT" });
    assert.equal(f.database.state.headers.length, 1);
  }
  for (const status of ["POSTED", "CANCELLED"]) await fixture({ headers: [{ ...header, id: 42, status }], scopes: [{ ...scope, stocktake_id: 42 }] }).service.create(command());
  await fixture({ headers: [header], scopes: [scope] }).service.update(command("update", { stocktakeId: 41, expectedVersion: 1, binIds: [1] }));
});
test("ST036-U06 stale versions and non-Draft mutations leave complete state unchanged", async () => {
  for (const state of [{ ...header, version: 2 }, { ...header, status: "COUNTING" }]) {
    const f = fixture({ headers: [state], scopes: [scope] }); const before = f.database.state;
    await assert.rejects(f.service.update(command("update", { stocktakeId: 41, expectedVersion: 1, binIds: [2] })),
      error => ["VERSION_CONFLICT", "STOCKTAKE_STATE_CONFLICT"].includes(error.code));
    assert.deepEqual(f.database.state, before);
  }
});
test("ST036-U07 Start keeps Bin-before-Balance-before-root-before-child lock order", async () => {
  const f = fixture({ headers: [header], scopes: [scope] }); await f.service.start(command("start", { stocktakeId: 41, expectedVersion: 1 }));
  assert.deepEqual(f.lockCalls[0].warehouseIds, [1]); assert.deepEqual(f.lockCalls[0].binIds, [1]);
  assert.equal(f.lockCalls[0].stocktakeIds, undefined); assert.equal(f.lockCalls[0].stockControls, undefined);
  const locked = f.database.calls.filter(call => call.sql.includes("FOR UPDATE"));
  assert.ok(locked.findIndex(call => call.sql.includes("inventory_stock_balances")) < locked.findIndex(call => call.sql.includes("inventory_stocktakes")));
  assert.ok(locked.findIndex(call => call.sql.includes("inventory_stocktakes")) < locked.findIndex(call => call.sql.includes("inventory_stocktake_bins")));
});
test("ST036-U08 multi-Bin snapshot keeps zero/all statuses/no-Lot and leaves counts NULL without stock writes", async () => {
  const balances = [0, 7].map((quantity, index) => ({ id: index + 1, warehouse_id: 1, bin_id: index + 1, sku_id: 12,
    lot_id: null, stock_status: index ? "DAMAGED" : "AVAILABLE", on_hand_quantity: quantity, version: 3 }));
  const f = fixture({ headers: [header], scopes: [scope, { ...scope, id: 102, bin_id: 2 }], balances });
  const result = await f.service.start(command("start", { stocktakeId: 41, expectedVersion: 1 }));
  assert.equal(result.rowCount, 2); assert.equal(f.database.state.lines.length, 2);
  assert.equal(f.database.state.lines[0][7], 0); assert.equal(f.database.state.lines[1][7], 7);
  assert.ok(f.database.calls.filter(call => call.sql.includes("INSERT INTO inventory_stocktake_lines")).every(call => !call.sql.includes("counted_quantity")));
  assert.deepEqual(f.database.state.lines.map(params => [params[1],params[3]]), [[101,1],[102,2]]);
  assert.equal(f.database.state.locks.length, 2); assert.equal(result.status, "COUNTING");
});
test("ST036-U09 invalid Bin and foreign physical lock reject whole Start", async () => {
  for (const f of [fixture({ headers: [header], scopes: [{ ...scope, bin_id: 3 }] }),
    fixture({ headers: [header], scopes: [scope] }, { binLocks: [{ bin_id: 1, stocktake_id: 42 }] })]) {
    const before = f.database.state;
    await assert.rejects(f.service.start(command("start", { stocktakeId: 41, expectedVersion: 1 })), error => ["BIN_INVALID", "BIN_LOCKED_BY_STOCKTAKE"].includes(error.code));
    assert.deepEqual(f.database.state, before);
  }
});
test("ST036-U10 replay returns original scalar receipt without reading changed workflow", async () => {
  const receipt = { id: 41, operationId: 21, status: "DRAFT", version: 1, rowCount: 2 };
  const f = fixture({}, { operations: { claim: async () => ({ replay: { resultSummary: receipt } }) } });
  assert.deepEqual(await f.service.create(command()), receipt); assert.equal(f.lockCalls.length, 0);
  assert.equal(f.database.calls.length, 0);
});
test("ST036-U11 Audit/completion and mid-Start failures roll back all business rows", async () => {
  for (const overrides of [{ audit: { recordSucceeded: async () => { throw new Error("audit failure"); } } },
    { operations: { claim: async () => ({ operationId: 21 }), complete: async () => { throw new Error("completion failure"); } } },
    { failSql: /INSERT INTO inventory_stocktake_lines/u }]) {
    const f = fixture({ headers: [header], scopes: [scope], balances: [{ id: 1, warehouse_id: 1, bin_id: 1, sku_id: 12,
      lot_id: null, stock_status: "AVAILABLE", on_hand_quantity: 7, version: 1 }] }, overrides);
    const before = f.database.state;
    await assert.rejects(f.service.start(command("start", { stocktakeId: 41, expectedVersion: 1 })), /failure/u);
    assert.deepEqual(f.database.state, before);
  }
});
test("ST036-U12 Draft cancel requires reason/version and preserves scope without releasing locks", async () => {
  const f = fixture({ headers: [header], scopes: [scope] });
  const result = await f.service.cancelDraft(command("cancel", { stocktakeId: 41, expectedVersion: 1, reason: "duplicate plan" }));
  assert.equal(result.status, "CANCELLED"); assert.equal(result.version, 2); assert.equal(f.database.state.scopes.length, 1);
  assert.equal(f.database.state.locks.length, 0); assert.equal(f.database.state.lines.length, 0);
  const g = fixture({ headers: [header], scopes: [scope] });
  await assert.rejects(g.service.cancelDraft(command("cancel", { stocktakeId: 41, expectedVersion: 1, reason: " " })), { code: "INVENTORY_INPUT_INVALID" });
});

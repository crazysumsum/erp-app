import assert from "node:assert/strict";
import test from "node:test";
import { InventoryAuditService } from "../src/modules/inventory/InventoryAuditService.js";
import { ExportInventoryStocktakeHandler, ListInventoryStocktakesHandler } from "../src/handlers/inventory/stocktakeHandlers.js";

const load = async () => (await import("../src/modules/inventory/inventoryStocktakeExportAudit.js")).createStocktakeExportAudit;
const CLOCKS = new WeakMap();
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const input = (changes = {}) => ({ actorUserId: 7, actorLabel: "counter", action: "inventory.export", targetType: "stocktake", targetId: 41,
  targetLabel: "stocktake:41", requestId: "request-1", correlationId: "request-1", beforeSummary: { rowCount: 1 }, ...changes });
function fixture(t, options = {}) {
  const original = new AbortController(); original.abort(new Error("Client disconnected"));
  const context = { signal: original.signal, deadline: "original", auth: { claims: { sub: "7" } } };
  let clock = CLOCKS.get(t);
  if (!clock) {
    clock = { now: 0 }; CLOCKS.set(t, clock);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(performance, "now", () => clock.now);
    t.mock.method(process.stderr, "write", () => true);
  }
  const f = { calls: [], rows: [], logs: [], original, context, elapse: ms => { clock.now += ms; }, clock: async ms => { clock.now += ms; t.mock.timers.tick(ms); await drain(); } };
  const tx = { execute: async (sql, values) => { options.execute?.(values); f.rows.push({ sql, values }); return [{ affectedRows: 1 }]; } };
  const database = { query: async () => [], closed: false, context: { get: () => context }, withTransaction(work, settings = {}) {
    f.calls.push({ work, settings });
    const signal = settings.signal ?? context.signal;
    if (signal.aborted) return Promise.reject(signal.reason);
    return options.transaction ? options.transaction(work, settings, tx) : Promise.resolve(work(tx));
  } };
  const logger = { error: (...args) => { f.logs.push(args); return options.log?.(...args); } };
  f.database = database; f.logger = logger; f.time = { nowMs: () => 1_800_000_000_000, fileDate: () => "2026-10-27" };
  f.create = async () => (await load())({ database, logger, time: f.time });
  return f;
}

test("FAU01 success retains caller transaction; non-export generic audit and construction remain unchanged", async t => {
  const f = fixture(t), audit = await f.create(), writes = [];
  const tx = { execute: async (...args) => { writes.push(args); return [{ affectedRows: 1 }]; } };
  assert.equal(await audit.recordSucceeded(tx, input()), undefined); assert.equal(writes.length, 1); assert.equal(f.calls.length, 0);
  assert.equal(await new InventoryAuditService({ database: f.database, logger: f.logger, time: f.time }).recordFailed(input()), false);
  const services = { config: { inventory: {} }, require: name => ({ mysqldatabase: f.database, time: f.time, logging: { logger: f.logger }, jwt: { config: { jwt: {} } } })[name],
    optional: () => null, scoped: () => false };
  services.get = name => services.require(name);
  const exported = new ExportInventoryStocktakeHandler(services), listed = new ListInventoryStocktakesHandler(services);
  assert.equal(exported.audit instanceof InventoryAuditService, false);
  assert.equal(exported.exports.audit instanceof InventoryAuditService, false);
  assert.equal(listed.audit instanceof InventoryAuditService, true);
});
test("FAU02 failure owns a live signal while original cancelled signal/context/claims remain untouched", async t => {
  const f = fixture(t), before = { ...f.context }, audit = await f.create();
  assert.equal(await audit.recordFailed(input()), true); assert.equal(f.rows.length, 1);
  assert.notEqual(f.calls[0].settings.signal, f.original.signal); assert.equal(f.calls[0].settings.signal.aborted, false);
  assert.deepEqual(f.context, before); assert.equal(f.original.signal.aborted, true);
});
test("FAU03 trusted scalar input is captured before awaiting and exact DOMAIN/ROUTE serialization is retained", async t => {
  const gate = deferred(); const f = fixture(t, { transaction: async work => { await gate.promise; return work({ execute: async (sql, values) => { f.rows.push({ sql, values }); } }); } });
  const audit = await f.create(), value = input(), result = audit.recordFailed(value); value.actorLabel = "changed"; value.beforeSummary.rowCount = 99;
  gate.resolve(); assert.equal(await result, true); assert.equal(f.rows[0].values[2], "counter"); assert.equal(JSON.parse(f.rows[0].values[10]).rowCount, 1);
  assert.equal(await audit.recordRejected(input({ targetId: null, targetLabel: "/api/v1/inventory/stocktakes/:id/export", actorLabel: "user:7" })), true);
  assert.deepEqual(f.rows[1].values.slice(4, 8), ["stocktake", null, "/api/v1/inventory/stocktakes/:id/export", "REJECTED"]);
});
test("FAU04 acquisition consumes original 5000ms; late cancelled acquisition invokes no Audit callback", async t => {
  const gate = deferred(); let callbacks = 0;
  const f = fixture(t, { transaction: async (work, { signal }, tx) => { await gate.promise; signal.throwIfAborted(); callbacks++; return work(tx); } });
  const audit = await f.create(), result = audit.recordFailed(input()); await f.clock(4999); assert.equal(f.calls[0].settings.signal.aborted, false);
  await f.clock(1); assert.equal(await result, false); assert.equal(f.calls[0].settings.signal.aborted, true);
  gate.resolve(); await drain(); assert.equal(callbacks, 0); assert.equal(f.rows.length, 0); assert.equal(await audit.recordFailed(input()), false); assert.equal(f.calls.length, 1);
});
test("FAU05 consumed BEGIN and INSERT time never renews original deadline or replaces export error", async t => {
  const begin = deferred(), insert = deferred(); let stage = "BEGIN";
  const f = fixture(t, { transaction: async (work, { signal }) => {
    await begin.promise; signal.throwIfAborted(); stage = "INSERT";
    return work({ execute: async () => { await insert.promise; signal.throwIfAborted(); } });
  } });
  const audit = await f.create(), original = new Error("original export failure"); let settled = false;
  const finish = (async () => { try { throw original; } catch (error) { await audit.recordFailed(input()); settled = true; throw error; } })();
  const assertion = assert.rejects(finish, error => error === original);
  await f.clock(2000); assert.equal(stage, "BEGIN"); begin.resolve(); await drain(); assert.equal(stage, "INSERT");
  await f.clock(2999); assert.equal(settled, false); await f.clock(1); await assertion;
  insert.resolve(); await drain(); assert.equal(f.rows.length, 0);
});
test("FAU06 indeterminate COMMIT remains false/quarantined, without retry or rollback claim", async t => {
  const f = fixture(t, { transaction: async () => { throw Object.assign(new Error("commit unknown"), { code: "DATABASE_TRANSACTION_INDETERMINATE" }); } });
  const audit = await f.create(); assert.equal(await audit.recordFailed(input()), false); assert.equal(await audit.recordFailed(input()), false);
  assert.equal(f.calls.length, 1); assert.equal(f.rows.length, 0); assert.equal(f.logs[0][2].databaseErrorCode, "DATABASE_TRANSACTION_INDETERMINATE");
});
test("FAU07 late true cannot revise public false or reopen admission; late rejection is consumed", async t => {
  const gate = deferred(), f = fixture(t, { transaction: () => gate.promise }), audit = await f.create(), result = audit.recordFailed(input());
  await f.clock(5000); assert.equal(await result, false); gate.resolve(); await drain(); assert.equal(await audit.recordFailed(input()), false); assert.equal(f.calls.length, 1);
  const late = deferred(), g = fixture(t, { transaction: () => late.promise }), other = await g.create(), pending = other.recordFailed(input());
  await g.clock(5000); assert.equal(await pending, false); late.reject(new Error("late DB error")); await drain(); assert.equal(g.logs.length, 1);
});
test("FAU08 same-primary factories share cap1 with no queue; distinct primary owners stay independent", async t => {
  const gate = deferred(), f = fixture(t, { transaction: () => gate.promise }), first = await f.create(), second = await f.create();
  const admitted = first.recordFailed(input()); assert.equal(await second.recordFailed(input()), false); assert.equal(f.calls.length, 1);
  const g = fixture(t), independent = await g.create(); assert.equal(await independent.recordFailed(input()), true);
  gate.resolve(); assert.equal(await admitted, true); assert.equal(await second.recordFailed(input()), true); assert.equal(f.calls.length, 2);
});
test("FAU09 only before-deadline true frees slot; false settlement and a new facade cannot reset quarantine", async t => {
  const f = fixture(t, { transaction: async () => { throw new Error("transient"); } }), first = await f.create();
  assert.equal(await first.recordFailed(input()), false); const second = await f.create(); assert.equal(await second.recordRejected(input()), false); assert.equal(f.calls.length, 1);
  const g = fixture(t), audit = await g.create(); assert.equal(await audit.recordFailed(input()), true); assert.equal(await audit.recordFailed(input()), true); assert.equal(g.calls.length, 2);
});
test("FAU10 fallback logger consumes only the remaining original budget and cannot reset quarantine", async t => {
  const transaction = deferred(), logging = deferred(); let loggerEntered = false, settled = false;
  const f = fixture(t, { transaction: () => transaction.promise, log: () => { loggerEntered = true; return logging.promise; } }), audit = await f.create();
  const result = audit.recordFailed(input()).then(value => { settled = true; return value; });
  await f.clock(2000); transaction.reject(new Error("DB failed")); await drain(); assert.equal(loggerEntered, true);
  await f.clock(2999); assert.equal(settled, false); await f.clock(1); assert.equal(await result, false);
  logging.resolve(); await drain(); assert.equal(await audit.recordFailed(input()), false);
  const g = fixture(t, { transaction: async () => { throw new Error("DB"); }, log: () => { throw new Error("logger"); } });
  assert.equal(await (await g.create()).recordFailed(input()), false);
});
test("FAU11 closed primary refuses without SQL or shutdown of borrowed resources", async t => {
  const f = fixture(t); f.database.closed = true; f.database.shutdown = () => assert.fail("must not own primary"); f.logger.shutdown = () => assert.fail("must not own logger");
  assert.equal(await (await f.create()).recordFailed(input()), false); assert.equal(f.calls.length, 0);
});
test("FAU12 live withTransaction is invoked synchronously for unchanged CS01 association", async t => {
  const f = fixture(t), audit = await f.create(), original = f.database.withTransaction.bind(f.database); let entered = false;
  f.database.withTransaction = (...args) => { entered = true; assert.equal(args[1].timeoutMs, undefined); return original(...args); };
  const result = audit.recordFailed(input()); assert.equal(entered, true); assert.equal(await result, true);
});
test("FAU13 DOMAIN and ROUTE remain separate identities, never request-wide deduplicated", async t => {
  const f = fixture(t), audit = await f.create();
  assert.equal(await audit.recordFailed(input()), true); assert.equal(await audit.recordFailed(input({ targetId: null, targetLabel: "/api/v1/inventory/stocktakes/:id/export" })), true);
  assert.deepEqual(f.rows.map(row => row.values[5]), [41, null]); assert.deepEqual(f.rows.map(row => row.values[7]), ["FAILED", "FAILED"]);
});
test("FAU14 monotonic before-deadline success releases; completion at deadline remains false", async t => {
  const gate = deferred(), f = fixture(t, { transaction: () => gate.promise }), audit = await f.create(), result = audit.recordFailed(input());
  await f.clock(4999); gate.resolve(); assert.equal(await result, true); await f.clock(1); assert.equal(f.calls[0].settings.signal.aborted, false);
  const other = deferred(), g = fixture(t, { transaction: () => other.promise }), a = await g.create(), p = a.recordFailed(input());
  g.elapse(5000); other.resolve(); assert.equal(await p, false); await drain(); assert.equal(await a.recordFailed(input()), false);
  const late = deferred(), h = fixture(t, { transaction: () => late.promise }), third = await h.create(), q = third.recordFailed(input());
  h.elapse(5001); late.resolve(); assert.equal(await q, false); assert.equal(await third.recordFailed(input()), false);
});
test("FAU15 invalid serialization and failed diagnostics return false without unhandled rejection", async t => {
  const f = fixture(t), audit = await f.create(); assert.equal(await audit.recordFailed(input({ beforeSummary: { forbidden: 1 } })), false);
  assert.equal(f.rows.length, 0); assert.equal(await audit.recordFailed(input()), false); assert.equal(f.calls.length, 1);
});
test("FAU16 independent signal, no renewal, sticky false and late true have distinct mutation-sensitive oracles", async t => {
  const gate = deferred(), f = fixture(t, { transaction: () => gate.promise }), audit = await f.create(), pending = audit.recordFailed(input());
  assert.notEqual(f.calls[0].settings.signal, f.context.signal); await f.clock(3000); assert.equal(await audit.recordFailed(input()), false); await f.clock(2000);
  assert.equal(await pending, false); gate.resolve(); await drain(); assert.equal(await (await f.create()).recordFailed(input()), false); assert.equal(f.calls.length, 1);
});

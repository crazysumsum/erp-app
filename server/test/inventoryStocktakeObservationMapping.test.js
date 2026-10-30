import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";
import * as mappingHelper from "../test-support/inventoryStocktakePerformanceChild.js";

// Controlled driver/IPC boundaries exercise the real helper. destroy() below records
// ownership cleanup; it is not evidence of an OS socket or SQL reaching terminal.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = promise => Promise.resolve(promise).then(value => ({ value }), error => ({ error }));
const turn = () => new Promise(resolve => { setImmediate(resolve); });
const ackFor = message => ({ type: "connection-mapping-ack", incarnation: message.incarnation,
  nonce: message.nonce, threadId: message.threadId, performanceThreadId: message.performanceThreadId });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fixture(options = {}) {
  const pool = new EventEmitter(), incarnation = options.incarnation ?? randomUUID(), messages = [], queries = [], events = [];
  const physical = new WeakSet(), wrappers = [], waiters = [];
  let rawCalls = 0;
  const core = (threadId, performanceThreadId = threadId + 1000) => ({ threadId, performanceThreadId,
    destroys: 0, releases: 0 });
  const initial = core(41);
  const borrow = actual => {
    if (!physical.has(actual)) { physical.add(actual); pool.emit("connection", actual); }
    const connection = { connection: actual, threadId: actual.threadId,
      async query(statement, params) {
        const sql = typeof statement === "string" ? statement : statement.sql;
        queries.push({ core: actual, sql, params }); events.push("query");
        if (options.query) return options.query({ core: actual, sql, params });
        return [[{ nativeId: actual.threadId, PROCESSLIST_ID: actual.threadId,
          THREAD_ID: actual.performanceThreadId, INSTRUMENTED: "YES" }], []];
      },
      destroy() { actual.destroys++; options.destroy?.(); },
      release() { actual.releases++; }
    };
    wrappers.push(connection); return connection;
  };
  let acquire = () => borrow(initial);
  pool.getConnection = async function () { assert.equal(this, pool); rawCalls++; return acquire(); };
  const send = message => {
    messages.push(structuredClone(message)); events.push(message.type);
    for (const waiter of waiters) if (waiter.type === message.type) waiter.resolve(message);
    if (options.send) return options.send(message, installed);
    if (message.type === "connection-mapping" && options.autoAck !== false) {
      queueMicrotask(() => installed.ack(ackFor(message)));
    }
    return Promise.resolve();
  };
  const installed = mappingHelper.installStocktakeObservationMapping(pool, { incarnation, send, ...(options.gate ? { gate: options.gate } : {}) });
  assert.equal(typeof installed.ack, "function");
  return { pool, incarnation, messages, queries, events, initial, core, borrow, wrappers, installed,
    get rawCalls() { return rawCalls; }, setAcquire(fn) { acquire = fn; },
    message(type) {
      const found = messages.find(message => message.type === type);
      if (found) return Promise.resolve(found);
      const pending = deferred(); waiters.push({ type, resolve: pending.resolve }); return pending.promise;
    }
  };
}
function assertFailureMessages(driver) {
  const failures = driver.messages.filter(message => message.type === "connection-mapping-failure");
  assert.ok(failures.length > 0, "attempt the fixed best-effort failure notification");
  for (const message of failures) {
    assert.deepEqual(Object.keys(message).sort(), ["incarnation", "nonce", "threadId", "type"]);
    assert.equal(message.incarnation, driver.incarnation);
    assert.ok(message.nonce === null || uuid.test(message.nonce));
    assert.ok(message.threadId === null || Number.isSafeInteger(message.threadId) && message.threadId > 0);
  }
}
async function assertLatched(driver) {
  const calls = driver.rawCalls;
  const later = await settle(driver.pool.getConnection());
  assert.ok(later.error, "failure permanently rejects later loans");
  assert.equal(driver.rawCalls, calls, "do not dispatch a fresh raw acquisition after failure");
}

test("OM01 actual core identity reuses one mapping across new promise wrappers and maps replacement cores", async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  const driver = fixture();
  const first = await driver.pool.getConnection(); first.release();
  const second = await driver.pool.getConnection(); second.release();
  assert.notEqual(first, second); assert.equal(first.connection, second.connection);
  assert.equal(driver.rawCalls, 2); assert.equal(driver.queries.length, 1);
  const replacement = driver.core(42, 2042); driver.setAcquire(() => driver.borrow(replacement));
  const third = await driver.pool.getConnection(); third.release();
  assert.equal(third.connection, replacement); assert.equal(driver.rawCalls, 3);
  assert.equal(driver.queries.length, 2);
  assert.deepEqual(driver.queries.map(row => row.core), [driver.initial, replacement]);
  const mappings = driver.messages.filter(message => message.type === "connection-mapping");
  assert.equal(mappings.length, 2); assert.notEqual(mappings[0].nonce, mappings[1].nonce);
  assert.deepEqual(mappings.map(message => message.performanceThreadId), [1041, 2042]);
});

test("OM02 pool waiting consumes the original absolute five-second mapping budget", { timeout: 10000 }, async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  const raw = deferred(), query = deferred();
  const driver = fixture({ query: () => query.promise }); driver.setAcquire(() => raw.promise);
  const started = performance.now(), result = settle(driver.pool.getConnection());
  const injectedPoolDelay = setTimeout(() => raw.resolve(driver.borrow(driver.initial)), 3200);
  try {
    assert.ok((await result).error);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 4500 && elapsed < 6500, `one original budget, observed ${elapsed}ms`);
    assert.equal(driver.queries.length, 1); assert.equal(driver.initial.destroys, 1);
    assert.equal(driver.initial.releases, 0); assertFailureMessages(driver); await assertLatched(driver);
    query.resolve([[{ nativeId: 41, PROCESSLIST_ID: 41, THREAD_ID: 1041, INSTRUMENTED: "YES" }], []]);
    await turn(); assert.equal(driver.messages.some(message => message.type === "connection-mapping"), false);
  } finally { clearTimeout(injectedPoolDelay); query.resolve([[], []]); }
});

test("OM03 hanging mapping SQL times out and consumes its later rejection without a loan", { timeout: 10000 }, async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  const failed = fixture({ query: async () => { throw new Error("injected mapping SQL failure"); } });
  assert.ok((await settle(failed.pool.getConnection())).error);
  assert.equal(failed.initial.destroys, 1); assert.equal(failed.initial.releases, 0);
  assertFailureMessages(failed); await assertLatched(failed);
  const cleanupThrows = fixture({ query: async () => { throw new Error("injected mapping failure before cleanup"); },
    destroy() { throw new Error("injected driver destroy failure"); } });
  assert.ok((await settle(cleanupThrows.pool.getConnection())).error);
  await assertLatched(cleanupThrows); assertFailureMessages(cleanupThrows);
  const query = deferred(), driver = fixture({ query: () => query.promise });
  const result = await settle(driver.pool.getConnection());
  assert.ok(result.error); assert.equal(driver.rawCalls, 1); assert.equal(driver.queries.length, 1);
  assert.equal(driver.initial.destroys, 1); assert.equal(driver.initial.releases, 0);
  query.reject(new Error("injected late driver query rejection")); await turn();
  assert.equal(driver.messages.some(message => message.type === "connection-mapping"), false);
  assertFailureMessages(driver); await assertLatched(driver);
});

test("OM04 lost and late matching ACK cannot unblock a timed-out loan or clear its latch", { timeout: 10000 }, async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  const driver = fixture({ autoAck: false });
  let businessDispatched = false;
  const result = settle(driver.pool.getConnection().then(connection => { businessDispatched = true; return connection; }));
  const mapping = await driver.message("connection-mapping"); await turn();
  assert.equal(businessDispatched, false, "IPC send completion alone is not parent ACK");
  assert.ok((await result).error); driver.installed.ack(ackFor(mapping)); await turn();
  assert.equal(businessDispatched, false); assert.equal(driver.initial.destroys, 1);
  assert.equal(driver.initial.releases, 0); assertFailureMessages(driver); await assertLatched(driver);
});

test("OM05 physical or mapping IPC rejection and an overdue send callback fail closed", { timeout: 10000 }, async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  await Promise.all(["connection", "connection-mapping", "callback"].map(async stage => {
    const callback = deferred();
    const driver = fixture({ send(message, installed) {
      if (message.type === "connection-mapping") queueMicrotask(() => installed.ack(ackFor(message)));
      if (message.type === stage) return Promise.reject(new Error("injected IPC failure"));
      if (stage === "callback" && message.type === "connection-mapping") return callback.promise;
      return Promise.resolve();
    } });
    const result = await settle(driver.pool.getConnection());
    assert.ok(result.error, stage); assert.equal(driver.initial.destroys, 1); assert.equal(driver.initial.releases, 0);
    callback.resolve(); await turn(); assertFailureMessages(driver); await assertLatched(driver);
  }));
});

test("OM06 wrong ACK fields and lost failure IPC permanently reject even an already mapped core", { timeout: 12000 }, async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  const variants = [ack => ({ ...ack, incarnation: randomUUID() }), ack => ({ ...ack, nonce: randomUUID() }),
    ack => ({ ...ack, threadId: ack.threadId + 1 }), ack => ({ ...ack, performanceThreadId: ack.performanceThreadId + 1 }),
    ack => ({ ...ack, extra: true })];
  await Promise.all(variants.map(async change => {
    let wrong = false;
    const driver = fixture({ send(message, installed) {
      if (message.type === "connection-mapping-failure") return Promise.reject(new Error("injected lost failure notification"));
      if (message.type === "connection-mapping") queueMicrotask(() => installed.ack(wrong ? change(ackFor(message)) : ackFor(message)));
      return Promise.resolve();
    } });
    const known = await driver.pool.getConnection(); known.release(); wrong = true;
    const replacement = driver.core(42); driver.setAcquire(() => driver.borrow(replacement));
    assert.ok((await settle(driver.pool.getConnection())).error);
    assert.equal(replacement.destroys, 1); assert.equal(replacement.releases, 0);
    driver.setAcquire(() => driver.borrow(driver.initial));
    await assertLatched(driver); assert.equal(driver.initial.destroys, 0);
    assertFailureMessages(driver); await turn();
  }));
  const gate = {}, failing = fixture({ gate, query: async () => { throw new Error("injected other-pool mapping failure"); } });
  const sibling = fixture({ gate, incarnation: failing.incarnation });
  const siblingCore = sibling.core(42);
  sibling.setAcquire(() => sibling.borrow(siblingCore));
  (await sibling.pool.getConnection()).release();
  assert.ok((await settle(failing.pool.getConnection())).error);
  await assertLatched(sibling);
  assert.equal(siblingCore.destroys, 0, "Do not destroy another pool's previously released connection");
});

test("OM07 a raw loan arriving after the deadline is destroyed precisely and late raw rejection is consumed", { timeout: 10000 }, async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  const failed = fixture(); failed.setAcquire(async () => { throw new Error("injected raw acquisition failure"); });
  assert.ok((await settle(failed.pool.getConnection())).error);
  assert.equal(failed.initial.destroys, 0); assert.equal(failed.initial.releases, 0);
  assertFailureMessages(failed); await assertLatched(failed);
  await Promise.all(["resolve", "reject"].map(async completion => {
    const raw = deferred(), driver = fixture(); driver.setAcquire(() => raw.promise);
    assert.ok((await settle(driver.pool.getConnection())).error);
    const unrelated = driver.core(99);
    if (completion === "resolve") raw.resolve(driver.borrow(driver.initial));
    else raw.reject(new Error("injected late raw acquisition rejection"));
    await turn();
    assert.equal(driver.initial.destroys, completion === "resolve" ? 1 : 0);
    assert.equal(unrelated.destroys, 0); assert.equal(driver.initial.releases, 0);
    assert.equal(driver.queries.length, 0); assertFailureMessages(driver); await assertLatched(driver);
  }));
});

test("OM08 physical identity precedes same-connection mapping and retained child history survives destruction", async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  assert.equal(typeof mappingHelper.rememberStocktakeDriverMapping, "function");
  const driver = fixture({ autoAck: false });
  let dispatched = false;
  const pending = driver.pool.getConnection().then(connection => { dispatched = true; return connection; });
  const mapping = await driver.message("connection-mapping"), physical = await driver.message("connection");
  assert.deepEqual(Object.keys(physical).sort(), ["incarnation", "nonce", "threadId", "type"]);
  assert.deepEqual(Object.keys(mapping).sort(), ["childObservedAt", "incarnation", "instrumented", "nonce", "performanceThreadId", "provenance", "threadId", "type"]);
  assert.equal(physical.incarnation, driver.incarnation); assert.match(physical.nonce, uuid);
  assert.equal(mapping.incarnation, physical.incarnation); assert.equal(mapping.nonce, physical.nonce);
  assert.equal(mapping.threadId, physical.threadId); assert.equal(mapping.threadId, 41);
  assert.equal(mapping.performanceThreadId, 1041); assert.equal(mapping.instrumented, "YES");
  assert.equal(mapping.provenance, "SAME_CONNECTION_DRIVER_QUERY");
  assert.ok(Number.isFinite(mapping.childObservedAt) && mapping.childObservedAt >= 0);
  assert.ok(driver.events.indexOf("connection") < driver.events.indexOf("connection-mapping"));
  assert.ok(driver.events.indexOf("query") < driver.events.indexOf("connection-mapping"));
  const sql = driver.queries[0].sql;
  assert.match(sql, /\bSELECT\b/iu); assert.match(sql, /CONNECTION_ID\s*\(/iu);
  assert.match(sql, /performance_schema\.threads/iu); assert.match(sql, /\bnativeId\b/u);
  assert.match(sql, /PROCESSLIST_ID\s*=\s*CONNECTION_ID\s*\(\s*\)|CONNECTION_ID\s*\(\s*\)\s*=\s*(?:\w+\.)?PROCESSLIST_ID/iu);
  await turn(); assert.equal(dispatched, false);
  const owner = { incarnation: driver.incarnation, connections: new Set([physical.threadId]),
    connectionEvents: [{ threadId: physical.threadId, nonce: physical.nonce, receivedAt: performance.now() }],
    observationIdentities: new Map() };
  const beforeReceipt = performance.now();
  const ack = mappingHelper.rememberStocktakeDriverMapping([owner], owner, mapping);
  const afterReceipt = performance.now(), entry = owner.observationIdentities.get(mapping.threadId);
  assert.ok(entry, "the parent must store positive history synchronously before returning ACK");
  assert.deepEqual(ack, ackFor(mapping));
  assert.deepEqual(Object.keys(ack).sort(), ["incarnation", "nonce", "performanceThreadId", "threadId", "type"]);
  assert.equal(entry.threadId, mapping.threadId); assert.equal(entry.performanceThreadId, mapping.performanceThreadId);
  assert.equal(entry.incarnation, mapping.incarnation); assert.equal(entry.nonce, mapping.nonce);
  assert.equal(entry.provenance, mapping.provenance); assert.equal(entry.childObservedAt, mapping.childObservedAt);
  assert.ok(entry.firstObservedAt >= beforeReceipt && entry.firstObservedAt <= afterReceipt);
  assert.deepEqual(entry.observedTransactionIds, []); assert.deepEqual(entry.observedEngineTokens, []);
  driver.installed.ack(ack); const connection = await pending; connection.destroy();
  assert.equal(driver.initial.destroys, 1);
  assert.deepEqual(driver.messages.filter(message => message.type === "connection-mapping"), [mapping]);
  assert.equal(owner.observationIdentities.get(mapping.threadId), entry,
    "destroying the controlled current connection does not erase positive parent history");
  assert.equal(entry.performanceThreadId, 1041); assert.equal(owner.connections.has(41), true);
  // This proves parent history retention only; fake destroy is not native SQL/socket terminal evidence.
});

test("OM09 missing, non-positive, foreign, duplicate or uninstrumented SQL identities never fall back to native ID", async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  assert.equal(typeof mappingHelper.rememberStocktakeDriverMapping, "function");
  const valid = { nativeId: 41, PROCESSLIST_ID: 41, THREAD_ID: 1041, INSTRUMENTED: "YES" };
  const rows = [[], [valid, valid], [{ ...valid, nativeId: null }], [{ ...valid, nativeId: 0 }],
    [{ ...valid, nativeId: 42 }], [{ ...valid, PROCESSLIST_ID: 42 }], [{ ...valid, THREAD_ID: null }],
    [{ ...valid, THREAD_ID: 0 }], [{ ...valid, INSTRUMENTED: "NO" }],
    [{ nativeId: 41, PROCESSLIST_ID: 41, INSTRUMENTED: "YES" }]];
  await Promise.all(rows.map(async result => {
    const driver = fixture({ query: async () => [result, []] });
    assert.ok((await settle(driver.pool.getConnection())).error, JSON.stringify(result));
    assert.equal(driver.messages.some(message => message.type === "connection-mapping"), false);
    assert.equal(driver.initial.destroys, 1); assert.equal(driver.initial.releases, 0);
    assertFailureMessages(driver); await assertLatched(driver);
  }));
  const makeOwner = (threadId = 41) => ({ incarnation: randomUUID(), connections: new Set([threadId]),
    connectionEvents: [{ threadId, nonce: randomUUID(), receivedAt: performance.now() }],
    observationIdentities: new Map() });
  const packet = (owner, threadId = 41, performanceThreadId = 1041) => ({ type: "connection-mapping",
    incarnation: owner.incarnation, nonce: owner.connectionEvents.find(event => event.threadId === threadId).nonce,
    threadId, performanceThreadId, instrumented: "YES", provenance: "SAME_CONNECTION_DRIVER_QUERY",
    childObservedAt: performance.now() });
  const invalidPackets = [
    message => ({ ...message, extra: true }),
    message => ({ ...message, type: "connection" }),
    message => ({ ...message, incarnation: randomUUID() }),
    message => ({ ...message, incarnation: "not-a-boot-uuid" }),
    message => ({ ...message, nonce: randomUUID() }),
    message => ({ ...message, nonce: "not-a-physical-uuid" }),
    message => ({ ...message, threadId: 0 }),
    message => ({ ...message, threadId: 42 }),
    message => ({ ...message, threadId: "41" }),
    message => ({ ...message, performanceThreadId: 0 }),
    message => ({ ...message, performanceThreadId: Number.MAX_SAFE_INTEGER + 1 }),
    message => ({ ...message, performanceThreadId: undefined }),
    message => ({ ...message, performanceThreadId: "1041" }),
    message => ({ ...message, instrumented: "NO" }),
    message => ({ ...message, provenance: "DRIVER_NATIVE_ID_ONLY" }),
    message => ({ ...message, childObservedAt: undefined }),
    message => ({ ...message, childObservedAt: NaN }),
    message => ({ ...message, childObservedAt: -1 }),
    message => ({ ...message, threadId: 0, performanceThreadId: 0 })
  ];
  const rejectWithoutMutation = (workers, owner, message) => {
    const before = structuredClone({ workers, owner });
    assert.throws(() => mappingHelper.rememberStocktakeDriverMapping(workers, owner, message));
    assert.deepEqual({ workers, owner }, before, "a rejected packet cannot add or rewrite identity history");
  };
  for (const change of invalidPackets) {
    const owner = makeOwner(); rejectWithoutMutation([owner], owner, change(packet(owner)));
  }
  {
    const owner = makeOwner(), message = packet(owner); owner.connectionEvents.length = 0;
    rejectWithoutMutation([owner], owner, message);
  }
  {
    const actual = makeOwner(), foreign = { ...actual, observationIdentities: new Map() };
    rejectWithoutMutation([actual], foreign, packet(foreign));
  }
  {
    const owner = makeOwner(); rejectWithoutMutation([owner, owner], owner, packet(owner));
  }
  {
    const owner = makeOwner(), collision = makeOwner();
    rejectWithoutMutation([owner, collision], owner, packet(owner));
  }
  {
    const owner = makeOwner(), other = makeOwner(42), workers = [owner, other];
    mappingHelper.rememberStocktakeDriverMapping(workers, other, packet(other, 42, 1041));
    rejectWithoutMutation(workers, owner, packet(owner));
  }
  {
    const owner = makeOwner(); owner.connections.add(42);
    owner.connectionEvents.push({ threadId: 42, nonce: randomUUID(), receivedAt: performance.now() });
    mappingHelper.rememberStocktakeDriverMapping([owner], owner, packet(owner, 42, 1041));
    rejectWithoutMutation([owner], owner, packet(owner));
  }
  {
    const owner = makeOwner(), message = packet(owner);
    mappingHelper.rememberStocktakeDriverMapping([owner], owner, message);
    rejectWithoutMutation([owner], owner, { ...message, performanceThreadId: 2041 });
    owner.connectionEvents[0].nonce = randomUUID();
    rejectWithoutMutation([owner], owner, { ...message, nonce: owner.connectionEvents[0].nonce });
    rejectWithoutMutation([owner], owner, { ...message, provenance: "UNVERIFIED_HISTORY" });
  }
});

test("OM10 a mapping result settling beyond the original cutoff cannot win against a delayed timeout callback", { timeout: 12000 }, async () => {
  assert.equal(typeof mappingHelper.installStocktakeObservationMapping, "function");
  const driver = fixture({ query: async () => {
    // Deliberate event-loop fault injection prevents the timeout callback from running.
    // A post-settle deadline check must still reject the successful driver result.
    const end = performance.now() + 5100; while (performance.now() < end) { /* controlled CPU hold */ }
    return [[{ nativeId: 41, PROCESSLIST_ID: 41, THREAD_ID: 1041, INSTRUMENTED: "YES" }], []];
  } });
  assert.ok((await settle(driver.pool.getConnection())).error);
  assert.equal(driver.initial.destroys, 1); assert.equal(driver.initial.releases, 0);
  assert.equal(driver.messages.some(message => message.type === "connection-mapping"), false);
  assertFailureMessages(driver); await assertLatched(driver);
  const afterAck = fixture({ send(message, installed) {
    if (message.type === "connection-mapping") queueMicrotask(() => {
      installed.ack(ackFor(message));
      queueMicrotask(() => queueMicrotask(() => {
        // Inject a hold after inner work settles, before the outer race resumes.
        const end = performance.now() + 5100;
        while (performance.now() < end) { /* controlled post-ACK CPU hold */ }
      }));
    });
    return Promise.resolve();
  } });
  assert.ok((await settle(afterAck.pool.getConnection())).error);
  assert.equal(afterAck.initial.destroys, 1); assert.equal(afterAck.initial.releases, 0);
  assertFailureMessages(afterAck); await assertLatched(afterAck);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import nodeTest, { after } from "node:test";
import { runInNewContext } from "node:vm";

// BEGIN createStocktakeCharacterizationCase
function createStocktakeCharacterizationCase(register) {
  let firstFailure;
  return (name, options, work) => register(name, options, async context => {
    if (firstFailure) { context.skip("NOT_RUN_AFTER_PRIOR_GATE_FAILURE"); return; }
    let pending = true;
    const aborted = () => { if (pending) firstFailure ??= context.signal.reason; };
    context.signal?.addEventListener("abort", aborted, { once: true });
    try {
      if (context.signal?.aborted) { aborted(); throw context.signal.reason; }
      return await work(context);
    } catch (error) { firstFailure ??= error; throw error; }
    finally { pending = false; context.signal?.removeEventListener("abort", aborted); }
  });
}
// END createStocktakeCharacterizationCase
const test = createStocktakeCharacterizationCase(nodeTest);
const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_CHARACTERIZATION_TESTS === "1";
let fixture;
after(async () => { await fixture?.close(); });

async function verifyStocktakeExportAuditExamples(verifyRows, registerIntent, readRows) {
  const intent = { requestId: "synthetic-export", actorId: 10, actorLabel: "synthetic-user", stocktakeId: 1,
    workflowVersion: 2, outcome: "COMPLETE" };
  const filterHash = createHash("sha256").update(JSON.stringify({ stocktakeId: 1, filters: {} })).digest("hex");
  const csv = { outcome: "COMPLETE", status: 200, requestId: intent.requestId, requestIdEchoObservation: "MATCHED",
    headers: { "x-inventory-export-generation-budget-ms": "60000" },
    summary: { filterHash, generationBudgetMs: "60000", truncated: "true", truncationReason: "ROW_LIMIT" } };
  const success = { id: 101, actor_user_id: 10, actor_label: intent.actorLabel, action: "inventory.export", target_type: "stocktake",
    target_id: 1, target_label: "stocktake:1", outcome: "SUCCEEDED", reason_category: "EXPORT",
    reason_text: `filterHash=${filterHash};truncated=true;reason=ROW_LIMIT;budgetMs=60000`, before_summary: null,
    after_summary: { stocktakeId: 1, rowCount: 100000, version: 2, status: "COUNTING" }, operation_request_id: null,
    request_id: intent.requestId, correlation_id: intent.requestId };
  const domain = { ...success, id: 102, outcome: "FAILED", reason_category: "", reason_text: "", after_summary: null };
  const route = { ...domain, id: 103, actor_label: "user:10", target_id: null, target_label: "/api/v1/inventory/stocktakes/:id/export" };
  const busy = { ...intent, outcome: "BUSY" };
  verifyRows([success], intent, csv);
  verifyRows([route, domain], busy);
  assert.throws(() => verifyRows([route], busy), "Missing DOMAIN");
  assert.throws(() => verifyRows([domain], busy), "Missing ROUTE / CP08 cannot discard NULL-target Audit");
  assert.throws(() => verifyRows([domain, route, { ...route, id: 104 }], busy), "Duplicate same-scope/outcome");
  assert.throws(() => verifyRows([domain, { ...route, id: domain.id }], busy), "Audit IDs must be globally unique");
  for (const wrong of [{ actor_user_id: 11 }, { actor_label: "wrong" }, { target_id: 0 }, { target_type: "other" },
    { target_label: "stocktake:999" }, { request_id: "other" }, { correlation_id: "other" }, { operation_request_id: 12 },
    { outcome: "REJECTED" }, { before_summary: {} }, { reason_category: "EXPORT" }, { reason_text: "unexpected" }, { after_summary: {} }]) {
    assert.throws(() => verifyRows([domain, { ...route, ...wrong }], busy));
  }
  for (const wrong of [{ after_summary: { ...success.after_summary, version: 3 } }, { reason_category: "" },
    { reason_text: "" }, { request_id: "other" }, { target_id: 999 }]) {
    assert.throws(() => verifyRows([{ ...success, ...wrong }], intent, csv));
  }
  assert.throws(() => verifyRows([{ ...success, after_summary: { ...success.after_summary, rowCount: 0 } }], intent, csv),
    "Readback is not its own expected summary");
  assert.throws(() => verifyRows([success], intent, { ...csv, summary: { ...csv.summary, filterHash: "wrong" } }));
  assert.throws(() => verifyRows([success], intent, { ...csv, headers: { "x-inventory-export-generation-budget-ms": "60001" } }));
  const registry = new Map(); registerIntent(registry, intent);
  assert.throws(() => registerIntent(registry, intent), "Duplicate request ID");
  assert.throws(() => registerIntent(registry, { ...intent, requestId: "unknown", outcome: "UNKNOWN" }), "Unknown phase is not an empty expectation");
  assert.equal(registry.size, 1);
  const mutable = { ...intent, requestId: "immutable-intent" }, fixed = registerIntent(registry, mutable);
  assert.notEqual(fixed, mutable); assert.equal(Object.isFrozen(fixed), true);
  mutable.actorId = 11; assert.equal(registry.get("immutable-intent").actorId, 10);
  assert.equal(Reflect.set(fixed, "actorId", 12), false); assert.equal(fixed.actorId, 10);
  const extraRows = [success, { ...success, id: 104, action: "wrong.action" }];
  const fakeDb = { execute: async (sql, parameters) => {
    assert.deepEqual(parameters, [intent.requestId]);
    // Model only the existing request readback's action predicate, not a real SQL engine.
    return [/\baction\s*=/iu.test(sql) ? extraRows.filter(row => row.action === "inventory.export") : extraRows];
  } };
  await assert.rejects(() => readRows(fakeDb, intent, csv), "Wrong-action extra rows cannot be filtered before validation");
  return { positives: 2, negativeClasses: 8, provenance: "SYNTHETIC_ORACLE_ONLY_NOT_NATIVE" };
}

test("ST041-CP01 full migrated capacity fixture, measurement self-check and twenty real logins", { skip: !enabled, timeout: 7200000 }, async () => {
  const { createPerformanceFixture, nearestRank, intendedOffer } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  assert.equal(nearestRank([4, 1, 3, 2], 0.95), 4);
  assert.equal(nearestRank([1, 2, 3, 4], 0.5), 2);
  assert.deepEqual(intendedOffer(1, 14399), { atMs: 1799937.5, actor: 9, minute: 29 });
  fixture = await createPerformanceFixture();
  assert.deepEqual(fixture.counts, { warehouses: 5, bins: 1000, skus: 100000, buckets: 500000,
    movements: 2000000, controls: 250000, operations: 500000, audits: 500000 });
  assert.equal(new Set(fixture.actors.map(actor => actor.id)).size, 20);
  assert.equal(fixture.reservations.length, 15);
});

test("ST041-CP09 native Control batches preserve fifty thousand rows and roll back later-batch failures", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyControlLockBoundary } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyControlLockBoundary(fixture);
});

test("ST041-CP14 native observation abort, historical SQL terminal and real replacement connection", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyObservationLifecycle } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyObservationLifecycle(fixture);
});

test("ST041-CP15 native short-lived connection mapping history, socket close and real replacement", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyShortLivedConnectionMapping } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyShortLivedConnectionMapping(fixture);
});

test("ST041-CP02 six original real HTTP query families preserve exact results and existing p95 below two seconds", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyQueryBaseline } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyQueryBaseline(fixture);
});

async function verifyLotSampleAdmissionExamples() {
  // Execute the real helper bodies without importing its native fixture/application dependencies.
  const source = await readFile(new URL("../../test-support/inventoryStocktakePerformanceChild.js", import.meta.url), "utf8");
  const extract = (start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `Missing actual helper body: ${start}`);
    return source.slice(first, last).replace(/^export /u, "");
  };
  const admissionBody = extract("function lotSampleAdmission(", "\n}") + "\n}";
  const admission = runInNewContext(`${admissionBody}; lotSampleAdmission`, {});
  // CA01-04: independent literal boundaries, including fractional remaining time and settled precedence.
  for (const [now, deadline, settled, expected] of [[19000, 20000, false, "ADMITTED"],
    [19000.001, 20000, false, "NOT_ADMITTED_RESERVE"], [19881, 20000, false, "NOT_ADMITTED_RESERVE"],
    [20000, 20000, false, "WINDOW_CLOSED_BEFORE_DISPATCH"], [20001, 20000, false, "WINDOW_CLOSED_BEFORE_DISPATCH"],
    [19000, 20000, true, "CHILD_SETTLED"], [20001, 20000, true, "CHILD_SETTLED"]]) {
    assert.equal(admission(now, deadline, settled), expected, `CA01-04 now=${now}, settled=${settled}`);
  }
  const probeBody = extract("  async function probe(shape, phase, round) {", "\n  let primary;");
  async function runProbe(options = {}) {
    let now = 0, complete, sampleCalls = 0, destroyed = 0;
    const deadlines = [], observation = { probes: [] }, samplingCalls = [], terminalCalls = [];
    const failure = options.failure ?? Object.assign(new Error("first monitor failure"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" });
    const identity = { threadId: 7, performanceThreadId: 9 };
    const result = { connectionId: 7, performanceThreadId: 9, outcome: "COMPLETE" };
    const worker = { quarantined: false, observationIdentities: new Map([[7, { observedEngineTokens: [] }]]), lotProbe(_shape, _phase, started) {
      return new Promise(resolve => {
        complete = () => { if (options.completeAt !== undefined) now = options.completeAt; resolve({ ...result, ...options.result }); };
        now = options.startAt ?? 0;
        if (!options.missingStart) started(identity);
        if (options.settled || options.missingStart) complete();
      });
    } };
    const errorObservation = error => ({ codes: [error.code ?? "UNKNOWN"] });
    const context = { assert, performance: { now: () => now }, workers: [worker], db: { destroy() { destroyed++; } }, observation,
      lotSampleAdmission: admission, errorObservation,
      observationFailure: () => Object.assign(new Error("original observation deadline"), { code: "TEST_OBSERVATION_TIMEOUT" }),
      async withinObservation(work, deadline) {
        deadlines.push(deadline);
        if (deadlines.length > 1) {
          if (options.missingCompletion) throw Object.assign(new Error("missing completion"), { code: "TEST_OBSERVATION_TIMEOUT" });
          complete();
        }
        const value = await work;
        if (now >= deadline) throw Object.assign(new Error("late completion"), { code: "TEST_OBSERVATION_TIMEOUT" });
        return value;
      },
      async setTimeout() {
        if (terminalCalls.length) { now = observation.probes[0].terminalDeadline; return; }
        if (sampleCalls >= options.reserveAfterSample) { now = 19200; return; }
        if (options.stopAt !== undefined) now = options.stopAt;
        else if (sampleCalls >= (options.samplesBeforeSettle ?? 1)) complete();
      },
      async lotProbeState(_db, _identity, seen, deadline, recording) {
        const sampling = recording.sampling === true;
        (sampling ? samplingCalls : terminalCalls).push({ now, deadline, seen: [...seen] });
        if (sampling) sampleCalls++;
        if (!sampling && options.terminalAt !== undefined) now = options.terminalAt;
        const failedQuery = sampling && (options.fail || sampleCalls === options.failAfterSample);
        const labels = failedQuery ? ["SESSION"] : ["SESSION", "THREAD", "TRANSACTION", "LOCK", "TRANSACTION", "WAIT", "STATEMENT"];
        for (const queryLabel of labels) {
          const event = { queryLabel, attemptAt: now, dispatchAt: now, remainingMs: Math.floor(Math.min(10000, deadline - now)),
            status: failedQuery ? "FAIL" : "COMPLETE", settledAt: now, elapsedMs: 0 };
          if (recording.events.length < 10000) recording.events.push(event); else recording.droppedEvents++;
        }
        if (sampling && options.badQueryDeadline) recording.events[0].remainingMs = 20001;
        if (sampling && options.partial) {
          seen.add("123"); now = deadline;
          worker.observationIdentities.get(7).observedEngineTokens.push({ engine: "INNODB", token: "456", performanceThreadId: 9, observedAt: 1 });
          throw Object.assign(new Error("next statement not sent"), { code: "TEST_SAMPLING_WINDOW_CLOSED" });
        }
        if (failedQuery) { context.db.destroy(); throw failure; }
        return { atMs: now, states: [{ COMMAND: "Sleep" }], threads: [{ THREAD_ID: 9 }], statements: [], activeStatement: false,
          transactions: 0, retainedTransactions: 0, observedTransactionIds: [...seen], observedEngineTokens: [], locks: 0, waits: 0,
          terminal: !options.missingTerminal };
      }
    };
    const probe = runInNewContext(`${admissionBody}\n${probeBody}\nprobe`, context);
    let error;
    try { await probe("TUPLE_IN_CANDIDATE", "PLAN", "SUPPORT_ONLY"); } catch (caught) { error = caught; }
    return { actual: observation.probes[0], error, deadlines, samplingCalls, terminalCalls, worker, destroyed, failure };
  }
  const reconcile = actual => {
    const a = actual.admission;
    assert.equal(a.reserveMs, 1000);
    assert.equal(a.attempted, a.admitted + a.notAdmitted);
    assert.equal(a.admitted, a.completed + a.partial + a.failed + a.pending);
    assert.equal(a.offers.length + a.droppedOffers, a.attempted);
    assert.equal(a.completed, actual.actualSampleCount);
    assert.equal(actual.samples.length + actual.droppedStoredSamples, actual.actualSampleCount);
    assert.equal(actual.samplingEventCount, actual.actualSampleCount * 7);
    for (const [index, offer] of a.offers.entries()) {
      assert.equal(offer.seq, index + 1);
      assert.equal(offer.remainingMs, actual.samplingDeadline - offer.now);
      const expected = offer.remainingMs >= 1000 ? "ADMITTED" : offer.remainingMs > 0 ? "NOT_ADMITTED_RESERVE" : "WINDOW_CLOSED_BEFORE_DISPATCH";
      assert.equal(offer.decision, expected);
      if (offer.decision !== "ADMITTED") { assert.equal(offer.queryStart, offer.queryEnd); assert.equal(offer.outcome, "NOT_ADMITTED"); }
    }
  };
  // CA02: a real loop offer with 119ms never dispatches sampling SQL.
  for (const startAt of [19881, 19000.001]) {
    const run = await runProbe({ startAt, completeAt: 21000 });
    assert.ok(run.error, "CA10 zero full samples must fail despite clean terminal");
    assert.equal(run.samplingCalls.length, 0); assert.equal(run.destroyed, 0);
    assert.equal(run.actual.admission.notAdmitted, 1); assert.equal(run.actual.admission.completed, 0);
    assert.equal(run.actual.admission.offers[0].remainingMs, 20000 - startAt);
    reconcile(run.actual);
  }
  // CA03: after a full sample, a subsequent zero/negative offer adds no SQL or complete sample.
  for (const stopAt of [20000, 20001]) {
    const run = await runProbe({ stopAt, completeAt: 21000 });
    assert.ifError(run.error); assert.equal(run.samplingCalls.length, 1);
    assert.equal(run.actual.admission.notAdmitted, 1); assert.equal(run.actual.admission.completed, 1);
    assert.equal(run.actual.admission.offers[1].decision, "WINDOW_CLOSED_BEFORE_DISPATCH");
    assert.equal(run.actual.admission.reserveBranch, "NOT_EXERCISED", "CA03 closed-window offer is not native reserve coverage");
    assert.equal(run.actual.admission.reserveCount, 0);
    reconcile(run.actual);
  }
  // CA04: already settled child causes no fabricated offer; matching identity remains mandatory.
  const settled = await runProbe({ settled: true });
  assert.equal(settled.samplingCalls.length, 0); assert.equal(settled.actual.admission.attempted, 0);
  assert.ok(settled.error);
  const mismatch = await runProbe({ result: { connectionId: 8 } });
  assert.ok(mismatch.error, "CA04 completion with a different connection cannot prove terminal");
  const missingStart = await runProbe({ missingStart: true });
  assert.ok(missingStart.error); assert.equal(missingStart.samplingCalls.length, 0);
  // CA05: an admitted sample retains the exact original absolute deadline.
  const admitted = await runProbe({ startAt: 19000, completeAt: 19500 });
  assert.ifError(admitted.error); assert.equal(admitted.samplingCalls[0].deadline, 20000);
  assert.equal(admitted.actual.admission.completed, 1); reconcile(admitted.actual);
  // CA06: first real error wins over later completion, and the failed owner remains quarantined.
  const failed = await runProbe({ fail: true, completeAt: 19500 });
  assert.equal(failed.error, failed.failure); assert.equal(failed.worker.quarantined, true);
  assert.equal(failed.destroyed, 1); assert.equal(failed.actual.admission.failed, 1);
  assert.equal(failed.actual.admission.partial, 0); assert.equal(failed.actual.admission.pending, 0);
  // CA07: partial work keeps the observed transaction IDs for terminal reads, and never becomes a full sample.
  const partial = await runProbe({ partial: true, completeAt: 21000 });
  assert.ok(partial.error); assert.equal(partial.actual.admission.partial, 1);
  assert.equal(partial.actual.admission.completed, 0); assert.equal(partial.actual.samples.length, 0);
  assert.ok(partial.terminalCalls.some(call => call.seen.includes("123")));
  assert.deepEqual([...partial.actual.admission.offers[0].observedTransactionIds], ["123"]);
  assert.equal(partial.actual.admission.offers[0].observedEngineTokens[0].token, "456");
  for (const options of [{ partial: true }, { fail: true }]) {
    const invalid = await runProbe({ ...options, badQueryDeadline: true, completeAt: 21000 });
    assert.ok(invalid.error); assert.equal(invalid.actual.admission.failed, 1);
    assert.equal(invalid.actual.admission.partial, 0); assert.ok(invalid.actual.admission.offers[0].auditError);
    if (options.fail) assert.equal(invalid.error, invalid.failure, "CA06 event auditing cannot hide the first SQL error");
  }
  // CA08: reserve stop at 19.2s followed by 19.5s completion tightens provisional 40s to 39.5s.
  for (const [terminalAt, passes] of [[39499, true], [39800, false]]) {
    const run = await runProbe({ stopAt: 19200, completeAt: 19500, terminalAt });
    assert.equal(run.actual.admission.notAdmitted, 1); assert.equal(run.actual.terminalDeadline, 39500);
    assert.equal(run.terminalCalls[0].deadline, 39500);
    assert.equal(run.actual.completionObservedAt, 19500);
    if (passes) { assert.ifError(run.error); reconcile(run.actual); } else assert.ok(run.error, "CA08 39.8s cannot use provisional 40s");
  }
  // CA09: neither missing/late completion nor missing positive SQL terminal evidence can pass.
  for (const options of [{ missingCompletion: true }, { completeAt: 40000 }, { terminalAt: 40000 }, { missingTerminal: true }]) {
    const run = await runProbe({ stopAt: 19200, ...options });
    assert.ok(run.error); assert.equal(run.worker.quarantined, true);
    assert.equal(run.deadlines[1], 40000, "Reserve stop must not restart the completion budget");
  }
  // CA11: three separate bounded stores retain full totals instead of truncating the denominator.
  const capped = await runProbe({ samplesBeforeSettle: 1500, completeAt: 19500 });
  assert.ifError(capped.error); assert.equal(capped.actual.admission.attempted, 1500);
  assert.equal(capped.actual.admission.offers.length, 500); assert.equal(capped.actual.admission.droppedOffers, 1000);
  assert.equal(capped.actual.samples.length, 500); assert.equal(capped.actual.droppedStoredSamples, 1000);
  assert.equal(capped.actual.events.length, 10000); assert.ok(capped.actual.samplingDroppedEvents > 0);
  assert.equal(capped.actual.samplingEventCount, 10500); assert.equal(capped.actual.admission.pending, 0);
  assert.equal(capped.actual.samplingDroppedEvents, 500); assert.equal(capped.actual.droppedEvents, 507);
  reconcile(capped.actual);
  const cappedFailure = await runProbe({ samplesBeforeSettle: 2000, failAfterSample: 1501, completeAt: 19500 });
  assert.equal(cappedFailure.error, cappedFailure.failure, "CA11 dropped failed query retains the original SQL error");
  assert.equal(cappedFailure.worker.quarantined, true); assert.equal(cappedFailure.destroyed, 1);
  assert.equal(cappedFailure.actual.requiredFailureEventMissing, true, "CA11 globally dropped FAIL must remain UNKNOWN");
  assert.equal(cappedFailure.actual.events.length, 10000); assert.equal(cappedFailure.actual.samplingEventCount, 10501);
  assert.equal(cappedFailure.actual.samplingDroppedEvents, 501); assert.equal(cappedFailure.actual.droppedEvents, 501);
  assert.equal(cappedFailure.actual.admission.attempted, 1501); assert.equal(cappedFailure.actual.admission.admitted, 1501);
  assert.equal(cappedFailure.actual.admission.completed, 1500); assert.equal(cappedFailure.actual.admission.failed, 1);
  assert.equal(cappedFailure.actual.admission.partial, 0); assert.equal(cappedFailure.actual.admission.pending, 0);
  assert.equal(cappedFailure.actual.admission.offers.length, 500); assert.equal(cappedFailure.actual.admission.droppedOffers, 1001);
  assert.equal(cappedFailure.actual.samples.length + cappedFailure.actual.droppedStoredSamples, 1500);
  const cappedNotSent = await runProbe({ samplesBeforeSettle: 2000, reserveAfterSample: 1500, completeAt: 19500 });
  assert.ifError(cappedNotSent.error); assert.equal(cappedNotSent.samplingCalls.length, 1500);
  assert.equal(cappedNotSent.actual.admission.attempted, 1501); assert.equal(cappedNotSent.actual.admission.notAdmitted, 1);
  assert.equal(cappedNotSent.actual.admission.admitted, 1500); assert.equal(cappedNotSent.actual.admission.completed, 1500);
  assert.equal(cappedNotSent.actual.admission.droppedOffers, 1001); assert.equal(cappedNotSent.actual.admission.reserveCount, 1);
  assert.equal(cappedNotSent.actual.samplingEventCount, 10500); assert.equal(cappedNotSent.actual.samplingDroppedEvents, 500);
  reconcile(cappedNotSent.actual);
  // Exercise the unchanged actual SQL reader, including dispatched failures and pre-dispatch partials.
  const readBody = extract("async function lotMonitorRead(", "\nasync function lotProbeState(");
  const stateBody = extract("async function lotProbeState(", "\nfunction rememberObservationIdentity(");
  async function runRead(options = {}) {
    let now = options.now ?? 0, destroyed = 0, queries = 0, expiry;
    const calls = [], seen = new Set(), entry = { observedTransactionIds: [], observedEngineTokens: [] };
    const recording = { events: Array.from({ length: options.prefill ?? 0 }, () => ({ status: "COMPLETE" })), droppedEvents: 0, sampling: true };
    const deadline = options.deadline ?? 20000;
    const failure = Object.assign(new Error("driver first failure"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" });
    const db = { destroy() { destroyed++; }, async query(query) {
      queries++; calls.push({ timeout: query.timeout, at: now });
      if (options.expire) { expiry(); return [[]]; }
      if (options.fail) throw failure;
      now += options.queryMs ?? 1;
      if (options.state) {
        if (queries === 1) return [[{ ID: 7, COMMAND: "Query", STATE: "executing" }]];
        if (queries === 2) return [[{ THREAD_ID: 9, PROCESSLIST_ID: 7, INSTRUMENTED: "YES" }]];
        if (queries === 3) return [[{ trx_id: "123" }]];
        if (queries === 4) {
          return [[{ ENGINE: "INNODB", get ENGINE_TRANSACTION_ID() { now = deadline; return "456"; }, THREAD_ID: 9 }]];
        }
        assert.fail("CA07 next metadata SQL must not dispatch after the original deadline");
      }
      return [[]];
    } };
    const context = { assert, db, performance: { now: () => now }, transactionObservationReads: new WeakMap(),
      observationFailure: code => Object.assign(new Error("original read window"), { code: code ?? "TEST_OBSERVATION_TIMEOUT" }),
      errorObservation: error => ({ codes: [error.code] }), rememberObservationIdentity: () => entry,
      async setTimeout(ms) { now += ms; },
      globalThis: { setTimeout(callback) { expiry = callback; return 1; }, clearTimeout() {} }
    };
    const read = runInNewContext(`${readBody}\n${stateBody}\n({ lotMonitorRead, lotProbeState })`, context);
    let error;
    try {
      if (options.state) await read.lotProbeState(db, { threadId: 7, performanceThreadId: 9 }, seen, deadline, recording);
      else await read.lotMonitorRead(db, "SELECT ID FROM information_schema.PROCESSLIST", [], deadline, recording);
    } catch (caught) { error = caught; }
    return { error, failure, destroyed, queries, calls, recording, entry, seen };
  }
  const readerAdmitted = await runRead({ now: 19000 });
  assert.ifError(readerAdmitted.error); assert.equal(readerAdmitted.calls[0].timeout, 1000);
  for (const options of [{ fail: true }, { expire: true }, { now: 19881, queryMs: 120 }]) {
    const run = await runRead(options);
    assert.ok(run.error, "CA06 issued SQL error or fired expiry must reject"); assert.equal(run.destroyed, 1); assert.equal(run.queries, 1);
    assert.equal(run.recording.events[0].status, "FAIL");
    if (options.fail) assert.equal(run.error, run.failure, "CA06 original driver error must survive");
    if (options.expire) assert.equal(run.error.code, "TEST_OBSERVATION_TIMEOUT", "CA06 fired expiry must reject even when the driver subsequently settles");
    if (options.now) assert.equal(run.calls[0].timeout, 119, "CA06 reserve never extends issued SQL");
  }
  const notSent = await runRead({ now: 20000 });
  assert.equal(notSent.error.code, "TEST_SAMPLING_WINDOW_CLOSED");
  assert.equal(notSent.queries, 0); assert.equal(notSent.destroyed, 0); assert.equal(notSent.recording.events.length, 0);
  const realPartial = await runRead({ state: true });
  assert.equal(realPartial.error.code, "TEST_SAMPLING_WINDOW_CLOSED");
  assert.equal(realPartial.queries, 4); assert.ok(realPartial.seen.has("123"));
  assert.deepEqual([...realPartial.entry.observedTransactionIds], ["123"]);
  assert.equal(realPartial.entry.observedEngineTokens[0].token, "456");
  assert.equal(realPartial.recording.events.length, 4); assert.equal(realPartial.destroyed, 0);
  const droppedFailure = await runRead({ fail: true, prefill: 10000 });
  assert.equal(droppedFailure.error, droppedFailure.failure); assert.equal(droppedFailure.recording.events.length, 10000);
  assert.equal(droppedFailure.recording.droppedEvents, 1); assert.equal(droppedFailure.recording.requiredFailureEventMissing, true);
  // CA12: run the actual cleanup loop after monitor failure for both capacity owners and a retired owner.
  const cleanupBody = extract("  async function stopWorkers() {", "\n  async function reconcileBusinessCleanup()");
  const cleanupCalls = [], cleanupReport = {}, owners = ["capacity-0", "capacity-1", "retired"].map(incarnation => ({
    incarnation, async close() { cleanupCalls.push(`close:${incarnation}`); },
    async stop() { cleanupCalls.push(`stop:${incarnation}`); return { incarnation, terminal: true }; }
  }));
  const deadMonitor = Object.assign(new Error("monitor already destroyed"), { code: "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR" });
  const cleanup = runInNewContext(`let stoppingWorkers; ${cleanupBody}; stopWorkers`, {
    assert, workers: owners.slice(0, 2), ownedWorkers: () => owners, report: cleanupReport, db: {}, setupError: undefined,
    observationOwners: new WeakMap(), cpuRecoveryRetirements: new WeakMap(), errorObservation: error => ({ codes: [error.code] }),
    async captureOwnedSql(_db, [owner]) { cleanupCalls.push(`capture:${owner.incarnation}`); throw deadMonitor; },
    async verifyOwnedSqlTerminal(_db, owner) { cleanupCalls.push(`terminal:${owner.incarnation}`); throw deadMonitor; }
  });
  await assert.rejects(cleanup, error => error === deadMonitor);
  for (const owner of owners) for (const stage of ["capture", "close", "stop", "terminal"]) assert.ok(cleanupCalls.includes(`${stage}:${owner.incarnation}`));
  assert.equal(cleanupReport.ownedSql.status, "SQL_TERMINAL_UNKNOWN");
  assert.equal(cleanupReport.ownedStops.length, 3); assert.ok(owners.every(owner => owner.quarantined));
  return { cases: 12, provenance: "FAKE_COLLABORATOR_REAL_HELPER_ONLY_NOT_NATIVE_SQL_SOCKET" };
}

test("ST041-CP10 full-capacity native Lot plans and balanced OR versus tuple-IN comparison", { skip: !enabled, timeout: 7200000 }, async () => {
  await verifyLotSampleAdmissionExamples();
  const { verifyLotQueryComparison } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyLotQueryComparison(fixture);
});

test("ST041-CP11 native Lot tuple semantics, collation, ordered rows and owner rollback", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyLotQuerySemantics } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyLotQuerySemantics(fixture);
});

test("ST041-CP12 native Lot waits, current reads, late keys, gap effects and owner rollback", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyLotLockSafety } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyLotLockSafety(fixture);
});

for (const [caseId, bins] of [["CP03", 1], ["CP04", 10], ["CP05", 200]]) {
  test(`ST041-${caseId} three complete real HTTP Stocktakes across ${bins} bins`, { skip: !enabled, timeout: 7200000 }, async () => {
    assert.equal(fixture?.controlLockVerified, true, "CP09 must complete before write workload");
    assert.equal(fixture?.lotSafetyVerified, true, "HD186 preimplementation comparison and lock safety must complete before another write workload");
    const { stocktakeWorkflow } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
    for (let round = 0; round < 3; round++) await stocktakeWorkflow(fixture, bins, round);
  });
}

test("ST041-CP06 all three full-scope rounds retain six query families and native SQL overlap in every phase", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyQueryCoexistence } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyQueryCoexistence(fixture);
});

test("ST041-CP07 real 100000-line COUNTING CSV, anonymous resources and serial primary-pool-one compatibility", { skip: !enabled, timeout: 7200000 }, async () => {
  assert.equal(fixture?.controlLockVerified, true);
  assert.equal(fixture?.lotSafetyVerified, true);
  const { verifyStocktakeExportCapacity } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  const { verifyStocktakeExportAuditRows, registerStocktakeExportAuditIntent, readStocktakeExportAuditEvidence } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  assert.deepEqual(await verifyStocktakeExportAuditExamples(verifyStocktakeExportAuditRows, registerStocktakeExportAuditIntent, readStocktakeExportAuditEvidence),
    { positives: 2, negativeClasses: 8, provenance: "SYNTHETIC_ORACLE_ONLY_NOT_NATIVE" });
  const result = await verifyStocktakeExportCapacity(fixture);
  assert.equal(result.outcome, "COMPLETE");
  for (const csv of [result.primaryTen, result.primaryOne]) {
    assert.equal(csv.outcome, "COMPLETE");
    assert.equal(csv.scopes, 200);
    assert.equal(csv.lines, 99800);
    assert.equal(csv.summaryCount, 1);
    assert.deepEqual([csv.summary.scopeCount, csv.summary.filteredLineCount, csv.summary.exportedRows,
      csv.summary.truncated, csv.summary.truncationReason], ["200", "100000", "100000", "true", "ROW_LIMIT"]);
    assert.equal(csv.orderedIdsSha256, result.expectedCsvIdsSha256);
    assert.equal(csv.dataSha256, result.expectedCsvDataSha256);
  }
  assert.equal(result.busyAttempt.outcome, "BUSY");
  assert.equal(result.busyAttempt.status, 503);
  for (const terminal of [result.primaryTenTerminal, result.primaryOneTerminal]) {
    assert.equal(terminal.files.length, 1); assert.equal(terminal.transports.length, 1);
    assert.ok(terminal.files.every(file => file.closeObservation === "ORIGINAL_CLOSE_FULFILLED" && file.closedAtMs <= terminal.atMs));
    assert.ok(terminal.transports.every(socket => socket.closedAtMs !== null && socket.closedAtMs <= terminal.atMs));
  }
  assert.equal(result.poolOneCleanup.status, "SQL_TERMINAL_CONFIRMED");
  assert.equal(result.poolOneCleanup.stop.forced, false);
  assert.equal(result.resourceCoverage.status, "COMPLETE");
  fixture.report.cp07Completion = { outcome: result.outcome, caseAssertions: "COMPLETE",
    resourceCoverage: result.resourceCoverage.status, poolOneSqlTerminal: result.poolOneCleanup.status,
    poolOneStop: result.poolOneCleanup.stop };
  fixture.characterizationCases.set("CP07", true);
});

test("ST041-CP08 zero-variance real HTTP Post/replay and complete full-capacity reconciliation", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyNormalWorkloadsReconciled } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  await verifyNormalWorkloadsReconciled(fixture);
  assert.equal(fixture.normalWorkloadsReconciled, true);
  assert.equal(fixture.characterizationCases.get("CP08"), true);
});


test("ST041-CP13 fixed CPU fault, parent watchdog and exact owned recovery preserve complete Inventory state", { skip: !enabled, timeout: 7200000 }, async () => {
  const { verifyCpuHoldRecovery } = await import("../../test-support/inventoryStocktakePerformanceChild.js");
  const result = await verifyCpuHoldRecovery(fixture);
  assert.equal(result.outcome, "EXPECTED_TEST_INJECTED_RECOVERY");
  assert.equal(result.stop.forced, true); assert.equal(result.stop.terminal, true);
  assert.equal(result.terminal.status, "SQL_TERMINAL_CONFIRMED");
  assert.deepEqual(result.after, result.before);
  assert.equal(fixture.characterizationCases.get("CP13"), true);
});

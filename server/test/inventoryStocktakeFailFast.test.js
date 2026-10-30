import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const execute = promisify(execFile);
const helperFile = new URL("../test-support/inventoryStocktakePerformanceChild.js", import.meta.url);
const charFile = new URL("./performance/inventoryStocktakeCharacterization.performance.test.js", import.meta.url);
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function extract(source, start, end) { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a, `Actual function markers ${start}`); return source.slice(a, b).replace(/^export /u, ""); }
async function charFactory() {
  return extract(await readFile(charFile, "utf8"), "function createStocktakeCharacterizationCase(", "// END createStocktakeCharacterizationCase");
}
async function laneFactory(extra = {}) {
  const source = extract(await readFile(helperFile, "utf8"), "export function createStocktakeSoakLane(", "// END createStocktakeSoakLane");
  const context = { assert, randomUUID, Buffer, performance, Date, AbortController,
    sha: value => createHash("sha256").update(value).digest("hex"), globalThis: { setTimeout, clearTimeout, fetch }, ...extra };
  return Function(...Object.keys(context), source + ";return createStocktakeSoakLane;")(...Object.values(context));
}
async function laneFixture(options = {}) {
  let now = 0;
  const actors = Array.from({ length: 2 }, (_, id) => ({ id: id + 1, worker: id, lane: id, writer: false, token: "synthetic", issuedAt: 0, expiresAt: 2_000_000,
    device: { headers: async () => ({ "X-Synthetic": "only" }) } }));
  const workers = actors.map(actor => ({ incarnation: `unit-${actor.id}`, origin: "http://127.0.0.1", diagnostics: async () => ({ synthetic: true }) }));
  const report = {}, factory = await laneFactory(options.globals), calls = [];
  const lane = factory({ workers, actors, report, epoch: 0, clock: () => now, wallClock: () => now,
    fetch: (...args) => { calls.push(args); return options.send ? options.send(...args) : Promise.resolve({ status: 200, headers: new Headers(), json: async () => ({ data: {} }) }); }, onFailure: options.onFailure });
  return { lane, report, actors, workers, calls, set: value => { now = value; }, plan: { family: "VIEW", route: "/q" } };
}
async function producerFixture({ at = "warmup", pending = false, cleanupError = false } = {}) {
  const source = extract(await readFile(helperFile, "utf8"), "export async function runStocktakeResourceSoak(", "\nasync function stocktakeSoakReadCases(");
  let now = 0, closeCount = 0, offered = 0, attemptedAfterStop = 0; const timers = [], journal = [], error = Object.assign(new Error("original producer failure"), { code: "TEST_ORIGINAL" });
  const actors = Array.from({ length: 20 }, (_, id) => ({ id: id + 1, worker: Math.floor(id / 10), lane: id % 10, writer: false }));
  const fixture = { mode: "CS01", workers: [{}, {}], actors, reservations: Array(15).fill({}), report: { offers: [], requests: [], exports: [] },
    cs01Journal: { checkpoint: (...args) => journal.push(args), flush: async () => {} }, soakOracle: { verify: async () => { throw error; }, cleanup: async () => assert.fail("Failure must not reach normal business cleanup") } };
  let lane;
  const context = { assert, performance: { now: () => now, timeOrigin: 0 }, Date, Map, Set, Math, Promise,
    errorObservation: value => ({ code: value.code, message: value.message }),
    characterizationQueryCases: async () => actors.map(actor => ({ actor, family: "VIEW", route: "/q", expected: {} })), characterizationQueryPlans: async () => {},
    characterizationQueryExpected: async () => ({}), prepareStocktakeSoakExportOracle: async () => ({}), stocktakeSoakReadCases: async () => [],
    stocktakeSoakWriterPlan: () => assert.fail("No synthetic writers"), stocktakeSoakCsvPlan: () => ({ family: "CSV", route: "/csv" }),
    intendedOffer: (worker, tick) => ({ atMs: tick * 125 + worker * 62.5, actor: tick % 10, minute: Math.floor(tick / 480) }),
    setTimeout: async ms => { now += ms; await drain(); }, nearestRank: values => Math.max(...values), characterizationQueryFamilies: [], stocktakeSoakSteadyQueries: () => [],
    startStocktakeResourceSampling: async () => ({ stop: async () => { closeCount++; if (cleanupError) throw new Error("secondary sampler cleanup error"); return {}; } }),
    stocktakeResourceCoverage: () => ({ status: "COMPLETE" }), proveStocktakeSoakBusyExports: async () => {},
    globalThis: { setTimeout: (fn, ms) => { timers.push(ms); queueMicrotask(() => { now += ms; fn(); }); return timers.length; }, clearTimeout() {} },
    createStocktakeSoakLane: options => {
      lane = { stopped: null, pending: new Set(pending ? [1] : []), stop: value => { lane.stopped ??= value; }, settle: () => pending ? new Promise(() => {}) : Promise.resolve([]), verifyRefreshes: () => assert.fail("Failed prefix cannot be a healthy thirty-minute run"),
        offer(actor, turn, intendedAt, plan) {
          if (lane.stopped) attemptedAfterStop++;
          assert.equal(lane.stopped, null, "Producer offered after first failure"); offered++;
          const row = { actor: actor.id, worker: actor.worker, turn, intendedAt, admittedAt: now, dispatchAt: null, responseCompleteAt: now, requestId: randomUUID(), family: plan.family, phase: plan.phase, outcome: "NOT_SENT_BUSY" };
          fixture.report.offers.push(row);
          if (at === "warmup" && offered === 1) { options.onFailure(error); if (pending) now += 12000; }
          return row;
        } }; return lane;
    } };
  fixture.workers.forEach(worker => { worker.soakExportCheckpoint = async () => ({ status: "COMPLETE" }); });
  const run = runInNewContext(source + ";runStocktakeResourceSoak", context);
  await assert.rejects(run(fixture), value => value === error);
  return { fixture, error, offered, attemptedAfterStop, timers, journal, closeCount, now, lane };
}

test("FF01 healthy Characterization retains fifteen ordered callbacks/options and normal abort is harmless", async () => {
  const factory = runInNewContext(await charFactory() + ";createStocktakeCharacterizationCase", {}), bodies = [], registrations = [];
  const register = factory((name, options, body) => { registrations.push({ name, options, body }); });
  const options = { timeout: 7200000 };
  for (let i = 0; i < 15; i++) register(`case-${i}`, options, async () => { bodies.push(i); });
  for (const entry of registrations) { const c = new AbortController(); await entry.body({ signal: c.signal, skip: () => assert.fail("Healthy case skipped") }); c.abort(); assert.equal(entry.options, options); }
  assert.deepEqual(bodies, Array.from({ length: 15 }, (_, i) => i));
});
test("FF02 real node:test assertion and runner timeout retain failure and skipped bodies under configured maxSkipped0", async () => {
  const profile = JSON.parse(await readFile(new URL("../../docs/inventory_management/00_project_profile.json", import.meta.url), "utf8"));
  assert.equal(profile.suites.find(suite => suite.id === "inventory-task041-characterization").max_skipped, 0);
  const dir = await mkdtemp(path.join(tmpdir(), "inventory-failfast-child-"));
  try {
    for (const timeout of [false, true]) {
      const result = path.join(dir, `result-${timeout}.json`), xml = path.join(dir, `cases-${timeout}.xml`), file = path.join(dir, `child-${timeout}.mjs`);
      const script = `import test,{after}from'node:test';import assert from'node:assert/strict';import{writeFile}from'node:fs/promises';\n${await charFactory()}\nconst register=createStocktakeCharacterizationCase(test);let calls=0,clean=0;after(async()=>{clean++;await writeFile(${JSON.stringify(result)},JSON.stringify({calls,clean}));});register('FFchild-first',{timeout:30},async()=>{calls++;${timeout ? "await new Promise(resolve=>setTimeout(resolve,1000));" : "assert.fail('original-child-failure');"}});register('FFchild-later',{},()=>{calls++;});`;
      await writeFile(file, script);
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      await assert.rejects(execute(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=junit", `--test-reporter-destination=${xml}`, file], { timeout: 5000, env }), value => value.code === 1);
      assert.deepEqual(JSON.parse(await readFile(result, "utf8")), { calls: 1, clean: 1 });
      const report = await readFile(xml, "utf8"); assert.match(report, /<failure\b/u); assert.match(report, /NOT_RUN_AFTER_PRIOR_GATE_FAILURE/u); assert.match(report, /<skipped\b/u);
      if (timeout) assert.match(report, /testTimeoutFailure/u); else assert.match(report, /original-child-failure/u);
    }
  } finally { await rm(dir, { recursive: true }); }
});
test("FF03 synchronous throw async rejection and pending runner cancel preserve first reason", async () => {
  for (const mode of ["throw", "reject", "cancel"]) {
    const factory = runInNewContext(await charFactory() + ";createStocktakeCharacterizationCase", {}), rows = [], original = new Error("first"), gate = deferred(), controller = new AbortController();
    const register = factory((_n, _o, body) => rows.push(body));
    register("first", {}, () => { if (mode === "throw") throw original; return mode === "reject" ? Promise.reject(original) : gate.promise; }); register("later", {}, () => assert.fail("Later body executed"));
    const pending = rows[0]({ signal: controller.signal, skip() {} });
    const rejected = assert.rejects(pending, value => value === original); let skipped = false;
    if (mode === "cancel") {
      controller.abort(original);
      try { await rows[1]({ skip: reason => { skipped = reason === "NOT_RUN_AFTER_PRIOR_GATE_FAILURE"; } }); assert.equal(skipped, true); }
      finally { gate.reject(original); await rejected; }
    } else { await rejected; await rows[1]({ skip: reason => { skipped = reason === "NOT_RUN_AFTER_PRIOR_GATE_FAILURE"; } }); assert.equal(skipped, true); }
  }
});
test("FF04 expected test-injected faults whose oracle passes do not close registration", async () => {
  const factory = runInNewContext(await charFactory() + ";createStocktakeCharacterizationCase", {}), rows = [], calls = [];
  const register = factory((_n, _o, body) => rows.push(body));
  register("expected fault", {}, async () => { await assert.rejects(Promise.reject(new Error("injected")), /injected/u); calls.push(1); }); register("next", {}, () => { calls.push(2); });
  for (const body of rows) await body({ signal: new AbortController().signal, skip: () => assert.fail("Wrongly skipped") }); assert.deepEqual(calls, [1, 2]);
});
test("FF05 actual warmup producer stops after first unexpected error and retains both planned remainders", async () => {
  const f = await producerFixture(); assert.equal(f.attemptedAfterStop, 0); assert.equal(f.offered, 1); assert.equal(f.fixture.soakOffersStopped, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.fixture.report.soak.stoppedWork)), { warmupPlanned: 1920, warmupOffered: 1, warmupNotOffered: 1919, steadyPlanned: 28800, steadyOffered: 0, steadyNotOffered: 28800 });
});
test("FF06 actual steady minute failure stops after waits and never manufactures a full steady pass", async () => {
  const f = await producerFixture({ at: "minute" }), stopped = f.fixture.report.soak.stoppedWork;
  assert.equal(f.attemptedAfterStop, 0); assert.equal(stopped.warmupOffered, 1920); assert.equal(stopped.steadyPlanned, 28800); assert.ok(stopped.steadyOffered > 0 && stopped.steadyNotOffered > 0);
  assert.equal(stopped.steadyOffered + stopped.steadyNotOffered, 28800); assert.equal(f.fixture.report.soak.status, "FAIL"); assert.ok(f.now < 1_920_000);
});
test("FF07 stopped pending refresh preparation cannot refresh or send and keeps intended identity", async () => {
  const gate = deferred(), f = await laneFixture(); f.actors[0].expiresAt = 120000; f.actors[0].device.headers = () => gate.promise;
  const row = f.lane.offer(f.actors[0], 0, 0, f.plan), error = new Error("stop"); f.lane.stop(error); gate.resolve({}); await row.pending;
  let signedAgain = 0; f.actors[1].device.headers = async () => { signedAgain++; return {}; };
  const count = f.report.requests.length, afterStop = f.lane.offer(f.actors[1], 0, 0, { ...f.plan, signed: true });
  assert.equal(afterStop.admittedAt, null); assert.equal(afterStop.notSentReason, "RUN_STOPPED"); assert.equal(afterStop.pending, undefined);
  assert.equal(f.report.requests.length, count); assert.equal(signedAgain, 0);
  assert.equal(row.family, "REFRESH"); assert.equal(row.dispatchAt, null); assert.equal(row.notSentReason, "RUN_STOPPED"); assert.equal(f.calls.length, 0); assert.equal(f.lane.pending.size, 0); assert.equal(f.lane.busy.size, 0);
});
test("FF08 lane failure latches before rejection so a competing signer cannot win the next microtask", async () => {
  const failing = deferred(), signing = deferred(), error = new Error("lane failure"); let notified;
  const f = await laneFixture({ send: () => failing.promise, onFailure: value => { notified = value; } });
  const first = f.lane.offer(f.actors[0], 0, 0, f.plan); const rejected = assert.rejects(first.pending, value => value === error);
  f.actors[1].device.headers = () => signing.promise; const later = f.lane.offer(f.actors[1], 0, 0, { ...f.plan, signed: true });
  failing.reject(error); queueMicrotask(() => signing.resolve({})); await rejected; await later.pending;
  assert.equal(notified, error); assert.equal(f.calls.length, 1); assert.equal(later.dispatchAt, null); assert.equal(later.notSentReason, "RUN_STOPPED");
  const timers = [], signer = deferred();
  const g = await laneFixture({ globals: { globalThis: { setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} } },
    send: (_url, { signal }) => {
      if (timers.length > 1) return Promise.resolve({ status: 200, headers: new Headers(), json: async () => ({ data: {} }) });
      return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => { signer.resolve({}); reject(signal.reason); }, { once: true }); });
    } });
  const active = g.lane.offer(g.actors[0], 0, 0, g.plan), timeoutRejection = assert.rejects(active.pending, value => value.code === "TEST_HTTP_WATCHDOG_TIMEOUT");
  g.set(29950); g.actors[1].device.headers = () => signer.promise;
  const waiting = g.lane.offer(g.actors[1], 0, 29950, { ...g.plan, signed: true }), waitingResult = waiting.pending;
  g.set(30000); timers[0](); await timeoutRejection; await waitingResult;
  assert.equal(g.calls.length, 1); assert.equal(waiting.notSentReason, "RUN_STOPPED");
  for (const custom of [false, true]) {
    const diagnostics = deferred(); let observed;
    const h = await laneFixture({ onFailure: value => { observed = value; }, send: async () => ({ status: 500, headers: new Headers(), json: async () => ({ error: { code: "INTERNAL" } }) }) });
    h.workers[0].diagnostics = () => diagnostics.promise;
    const action = { ...h.plan, ...(custom ? { accept: () => { throw error; } } : {}) };
    const failed = h.lane.offer(h.actors[0], 0, 0, action), rejected = assert.rejects(failed.pending);
    await drain(); const stopped = h.lane.offer(h.actors[1], 0, 0, h.plan);
    try { assert.ok(observed); assert.equal(stopped.admittedAt, null); assert.equal(h.calls.length, 1); }
    finally { diagnostics.resolve({}); await rejected; await stopped.pending?.catch(() => {}); }
  }
  const accepted = await laneFixture({ send: async () => ({ status: 503, headers: new Headers(), json: async () => ({ error: { code: "BUSY" } }) }) });
  let acceptedCalls = 0;
  const acceptedPlan = { ...accepted.plan, accept: (_value, response) => { acceptedCalls++; assert.equal(response.status, 503); } };
  await accepted.lane.offer(accepted.actors[0], 0, 0, acceptedPlan).pending;
  await accepted.lane.offer(accepted.actors[1], 0, 0, acceptedPlan).pending;
  assert.equal(accepted.calls.length, 2); assert.equal(acceptedCalls, 2);
});
test("FF09 already dispatched real loopback responses preserve success or failure after stop without retry", async () => {
  for (const status of [200, 500]) {
    const entered = deferred(), release = deferred(); let requests = 0;
    const server = http.createServer(async (_req, res) => { requests++; entered.resolve(); await release.promise; res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: { marker: `loopback-${status}` } })); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    try {
      const f = await laneFixture({ send: fetch }); f.workers[0].origin = `http://127.0.0.1:${server.address().port}`;
      const row = f.lane.offer(f.actors[0], 0, 0, f.plan), pending = row.pending;
      const stopReason = new Error("intentional test stop");
      const result = status === 500 ? assert.rejects(pending, error => error !== stopReason && error.code === "ERR_ASSERTION" && error.actual === 500 && error.expected === 200) : pending;
      await Promise.race([entered.promise, pending.then(() => { assert.fail("Request never reached loopback"); })]); f.lane.stop(stopReason); release.resolve(); const value = await result;
      if (status === 200) assert.deepEqual(value, { marker: "loopback-200" });
      assert.equal(row.outcome, status === 200 ? "COMPLETE" : "FAIL"); assert.equal(row.status, status);
      assert.equal(row.resultObservation, "HTTP_RESPONSE_CONSUMED"); assert.equal(requests, 1); assert.notEqual(row.dispatchAt, null);
    } finally { release.resolve(); server.closeAllConnections(); await new Promise(resolve => { server.close(resolve); }); }
  }
});
test("FF10 original failure drain budget cannot restart after twelve seconds of intervening work", async () => {
  const f = await producerFixture({ pending: true, cleanupError: true }); assert.deepEqual(f.timers, [168000]); assert.equal(f.closeCount, 1);
  assert.ok(f.fixture.workers.every(worker => worker.quarantined)); assert.equal(f.fixture.report.soak.status, "FAIL");
  const source = extract(await readFile(helperFile, "utf8"), "export async function runStocktakeResourceSoak(", "\nasync function stocktakeSoakReadCases(");
  const start = source.indexOf("  const failed="), end = source.indexOf("  const checkStopped=", start);
  assert.ok(start >= 0 && end > start);
  const error = new Error("drain already expired"), oldDeadline = 180000;
  const observed = Function("error", "performance", "fixture", "lane", "journal", "errorObservation", `let firstError,drainDeadline=${oldDeadline};const failures=[];${source.slice(start, end)}failed(error,'normal-drain');return {firstError,drainDeadline};`)(error, { now: () => 180000 }, {}, { stop() {} }, undefined, value => ({ message: value.message }));
  assert.equal(observed.firstError, error); assert.equal(observed.drainDeadline, oldDeadline, "First error must preserve an existing earlier normal drain deadline");
});
test("FF11 first producer failure survives later sampler failure and cleanup keeps truthful failed prefix", async () => {
  const f = await producerFixture({ cleanupError: true }); assert.equal(f.closeCount, 1); assert.equal(f.lane.stopped, f.error);
  assert.equal(f.fixture.report.soak.errors[0].error.code, "TEST_ORIGINAL"); assert.ok(f.fixture.report.soak.errors.some(value => value.stage === "resource-sampling"));
  assert.equal(f.journal.filter(value => value[0] === "RUN_ORIGINAL_ERROR").length, 1);
});
test("FF12 original callback bodies and all helper ranges outside the two approved functions stay byte-identical", async () => {
  const base = new URL("../../docs/inventory_management/implementation/hd227-before/", import.meta.url);
  const oldChar = await readFile(new URL("characterization.before.txt", base), "utf8"), currentChar = await readFile(charFile, "utf8");
  const strip = text => text.replace(/import (?:test|nodeTest), \{ after \}/u, 'import test, { after }').replace(/\n\/\/ BEGIN createStocktakeCharacterizationCase[\s\S]*?\/\/ END createStocktakeCharacterizationCase\nconst test = createStocktakeCharacterizationCase\(nodeTest\);\n/u, "\n");
  assert.equal(strip(currentChar), strip(oldChar));
  const oldHelper = await readFile(new URL("performance.before.txt", base), "utf8"), currentHelper = await readFile(helperFile, "utf8");
  const outside = text => text.replace(/export function createStocktakeSoakLane\([\s\S]*?\/\/ END createStocktakeSoakLane/u, "LANE").replace(/export async function runStocktakeResourceSoak\([\s\S]*?(?=\nasync function stocktakeSoakReadCases\()/u, "RUN");
  assert.equal(outside(currentHelper), outside(oldHelper));
});

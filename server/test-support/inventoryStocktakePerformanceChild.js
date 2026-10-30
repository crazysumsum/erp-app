import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { setTimeout } from "node:timers/promises";
import mysql from "mysql2/promise";
import { parse } from "csv-parse";
import { createTestDevice } from "./testDevice.js";
import { seedItemPerformanceFixtures } from "./itemPerformanceFixtures.js";
import { hashPassword } from "../src/modules/user/passwordHash.js";
import { inventoryOperationHash } from "../src/modules/inventory/InventoryOperationService.js";
import { defaultConfigurationSource, validateApplicationConfiguration } from "../src/framework/configuration/applicationConfiguration.js";

export async function createStocktakeSoakProgressJournal({runDir,helperSha256=null,testSha256=null}) {
  const stats={status:'OPEN',acceptedRecords:0,writtenRecords:0,syncedRecords:0,acceptedBytes:0,writtenBytes:0,
    pending:0,pendingPeak:0,lostRecords:0,openMs:0,writeMs:0,maxWriteMs:0,syncMs:0,closeMs:0,error:null};
  let handle,tail=Promise.resolve(),closed=false,writeFailed=false;
  const fail=error=>{stats.status='INCOMPLETE';stats.error??={code:/^[A-Z0-9_]{1,64}$/u.test(error?.code??'')?error.code:'CS01_JOURNAL_IO_ERROR'};};
  const safeError=error=>error?{name:/^[A-Za-z0-9_]{1,40}$/u.test(error.name??'')?error.name:'Error',
    code:/^[A-Z0-9_]{1,64}$/u.test(error.code??'')?error.code:null,messageSha256:sha(String(error.message??''))}:null;
  function checkpoint(stage,event,details={}) {
    if(closed||!handle||writeFailed){stats.lostRecords++;return false;}
    if(stats.acceptedRecords>=150){stats.lostRecords++;fail({code:'CS01_JOURNAL_OVERFLOW'});return false;}
    if(!/^[A-Z][A-Z0-9_-]{0,47}$/u.test(stage)||!['START','END','ERROR','CHECKPOINT','TERMINAL'].includes(event)){
      stats.lostRecords++;fail({code:'CS01_JOURNAL_INVALID_RECORD'});return false;
    }
    const row={schema:1,seq:stats.acceptedRecords+1,stage,event,atMs:performance.now(),wallMs:Date.now(),
      priorIo:{writtenRecords:stats.writtenRecords,syncedRecords:stats.syncedRecords,writeMs:stats.writeMs,syncMs:stats.syncMs},
      error:safeError(details.originalError)};
    for(const key of ['minute','completed','total'])if(Number.isSafeInteger(details[key])&&details[key]>=0)row[key]=details[key];
    if(['RETURNED','THREW','UNKNOWN'].includes(details.originalOutcome))row.originalOutcome=details.originalOutcome;
    if(stage==='SOURCE')row.source={helperSha256:/^[a-f0-9]{64}$/u.test(helperSha256??'')?helperSha256:null,
      testSha256:/^[a-f0-9]{64}$/u.test(testSha256??'')?testSha256:null};
    const data=Buffer.from(JSON.stringify(row)+'\n');
    if(data.length>1024){stats.lostRecords++;fail({code:'CS01_JOURNAL_RECORD_TOO_LARGE'});return false;}
    stats.acceptedRecords++;stats.acceptedBytes+=data.length;stats.pending++;stats.pendingPeak=Math.max(stats.pendingPeak,stats.pending);
    tail=tail.then(async()=>{
      if(writeFailed){stats.lostRecords++;stats.pending--;return;}
      const started=performance.now();
      try{await handle.writeFile(data);stats.writtenRecords++;stats.writtenBytes+=data.length;}
      catch(error){writeFailed=true;stats.lostRecords++;fail(error);}
      finally{const elapsed=performance.now()-started;stats.writeMs+=elapsed;stats.maxWriteMs=Math.max(stats.maxWriteMs,elapsed);stats.pending--;}
    });
    return true;
  }
  async function flush() {
    await tail;
    if(!handle||writeFailed||closed)return false;
    const written=stats.writtenRecords,started=performance.now();
    try{await handle.sync();stats.syncedRecords=written;}
    catch(error){fail(error);return false;}
    finally{stats.syncMs+=performance.now()-started;}
    return stats.status!=='INCOMPLETE';
  }
  async function close() {
    if(closed)return;
    await flush();closed=true;
    if(handle){const started=performance.now();try{await handle.close();}catch(error){fail(error);}finally{stats.closeMs+=performance.now()-started;}}
    if(stats.status!=='INCOMPLETE')stats.status='CLOSED';
  }
  const openedAt=performance.now();
  try{
    if(typeof runDir!=='string'||!path.isAbsolute(runDir))throw {code:'CS01_JOURNAL_INVALID_DIRECTORY'};
    handle=await fs.open(path.join(runDir,'stocktake-resource-soak-progress.ndjson'),'wx',0o600);
  }catch(error){fail(error);}finally{stats.openMs=performance.now()-openedAt;}
  checkpoint('SOURCE','CHECKPOINT');
  return {checkpoint,flush,close,stats};
}
// END createStocktakeSoakProgressJournal

export function nearestRank(values, fraction) {
  assert.ok(values.length && fraction > 0 && fraction <= 1);
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
}
export function intendedOffer(worker, tick) {
  assert.ok((worker === 0 || worker === 1) && Number.isInteger(tick) && tick >= 0 && tick < 14400);
  const atMs = tick * 125 + worker * 62.5;
  return { atMs, actor: tick % 10, minute: Math.floor(atMs / 60000) };
}
const sha = value => createHash("sha256").update(value).digest("hex");
const observationOwners = new WeakMap();
const cpuRecoveryRetirements = new WeakMap();
const transactionObservationReads = new WeakMap();
const source = () => ({ module: "INVENTORY", documentType: "STOCKTAKE", documentId: randomUUID(), lineId: "", eventId: randomUUID() });
function errorObservation(error) {
  const chain = [];
  for (let cause = error, depth = 0; cause && depth < 6; cause = cause.cause, depth++) {
    chain.push({ code: /^[A-Z][A-Z0-9_]*$/u.test(cause.code ?? "") ? cause.code : "UNCLASSIFIED_ERROR",
      errno: Number.isSafeInteger(cause.errno) ? cause.errno : null,
      sqlState: /^[A-Z0-9]{5}$/u.test(cause.sqlState ?? "") ? cause.sqlState : null,
      assertionOperator: /^[a-zA-Z=]+$/u.test(cause.operator ?? "") ? cause.operator : null,
      frames: String(cause.stack ?? "").split("\n").filter(line => /^\s+at /u.test(line)).slice(0, 4)
        .map(line => line.replaceAll(fileURLToPath(new URL("../../", import.meta.url)), "<repo>")) });
  }
  return { chain, codes: chain.map(value => value.code) };
}
const resourceClock = () => performance.timeOrigin + performance.now();
// Keep the observer on its original 1Hz grid; timer overshoot must not accumulate or backfill missed slots.
function startStocktakeSamplingClock(sample) {
  const anchorAtMs = resourceClock();
  let dueAtMs = anchorAtMs + 1000, timer, stopped = false;
  const schedule = () => {
    timer = globalThis.setTimeout(() => {
      if (stopped) return;
      const now = resourceClock();
      if (now < dueAtMs) { schedule(); return; }
      dueAtMs = anchorAtMs + (Math.floor((now - anchorAtMs) / 1000) + 1) * 1000;
      schedule();
      sample();
    }, Math.max(1, Math.ceil(dueAtMs - resourceClock())));
    timer.unref();
  };
  schedule();
  return { anchorAtMs, stop() { stopped = true; globalThis.clearTimeout(timer); } };
}
async function ownDescriptorCount() {
  const started = performance.now();
  try { return { count: (await fs.readdir(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd")).length,
    elapsedMs: performance.now() - started, observation: "PROCESS_OWN_FD_DIRECTORY_INCLUDES_OBSERVER" }; }
  catch (error) { return { count: null, elapsedMs: performance.now() - started, error: errorObservation(error) }; }
}

// Only this owned child installs these call-through observers. Closed handles/streams leave the live maps.
export function installStocktakeResourceSampler(root, incarnation, publish, mappingGate, getContext = () => null) {
  const originals = Object.fromEntries(["mkdtemp", "open", "unlink", "rmdir"].map(name => [name, fs[name]]));
  const directories = new Map(), names = new Map(), handles = new Map(), unresolvedHandles = new Map(), pools = new Map(), poolRefs = new Map(), sockets = new Map(), seenSockets = new WeakMap();
  const fileHistory = [], poolHistory = [], transportHistory = [], errors = [], warningCounts = new Map(), warningEmitters = new WeakMap(), warningEmitterIds = new Map();
  let emitterId = 0, warningStacks = 0, handleId = 0, socketId = 0, nextPool = 0, inProgress, stopped = false;
  const metrics = { callbacks: 0, callbackMs: 0, fstatCalls: 0, fstatMs: 0, snapshots: 0, snapshotMs: 0, publishErrors: 0, droppedErrors: 0,
    peakPrimaryTransports: 0, peakAuxiliaryTransports: 0, unmappedClosedTransports: 0, physicalHookCalls: 0, physicalHookMs: 0,
    warningTotal: 0, warningBucketOverflow: 0, warningEmitterOverflow: 0, warningBucketEmitterOverflow: 0 };
  const requestId = () => getContext()?.requestId ?? null;
  const failed = (stage, error) => {
    if (errors.length < 64) errors.push({ stage, atMs: resourceClock(), error: errorObservation(error) });
    else metrics.droppedErrors++;
  };
  const observe = (pending, callback) => {
    void pending.then(value => {
      const started = performance.now(); metrics.callbacks++;
      try { callback(value); } catch (error) { failed("call-through-observation", error); }
      finally { metrics.callbackMs += performance.now() - started; }
    }, () => {});
    return pending;
  };
  fs.mkdtemp = function (...args) {
    const ownerRequestId = requestId(), pending = originals.mkdtemp.apply(this, args);
    if (typeof args[0] === "string" && path.dirname(args[0]) === root) observe(pending, name => {
      directories.set(name, { name, requestId: ownerRequestId, createdAtMs: resourceClock(), identity: null, removed: false });
    });
    return pending;
  };
  fs.open = function (...args) {
    const ownerRequestId = requestId(), pending = originals.open.apply(this, args), name = args[0];
    if (typeof name === "string" && directories.has(path.dirname(name)) && args[1] === "wx+") observe(pending, handle => {
      const entry = { id: ++handleId, requestId: ownerRequestId, createdAtMs: resourceClock(), closedAtMs: null, fd: handle.fd,
        directoryCreatedAtMs: directories.get(path.dirname(name)).createdAtMs, dev: null, ino: null, size: null, nlink: null, closeObservation: "OPEN", io: {} };
      fileHistory.push(entry); names.set(name, { name, entry, removed: false });
      const stat = handle.stat.bind(handle); handles.set(entry.id, { handle, stat, entry });
      // The original promise and resolved FileHandle remain the application's result.
      for (const method of ["writeFile", "read", "close"]) {
        const original = handle[method];
        handle[method] = function (...values) {
          const started = performance.now(), operation = original.apply(this, values);
          observe(operation, () => {
            const counts = entry.io[method] ??= { calls: 0, elapsedMs: 0 };
            counts.calls++; counts.elapsedMs += performance.now() - started;
            if (method === "read" && entry.deliveryStatStartedAtMs === undefined) {
              entry.deliveryStatStartedAtMs = resourceClock(); const statStarted = performance.now(); metrics.fstatCalls++;
              void stat().then(current => {
                if (entry.dev !== null) assert.deepEqual([current.dev, current.ino], [entry.dev, entry.ino]);
                Object.assign(entry, { dev: current.dev, ino: current.ino, size: current.size, nlink: current.nlink, deliveryStatAtMs: resourceClock() });
              }).catch(error => failed("delivery-fstat", error)).finally(() => { metrics.fstatMs += performance.now() - statStarted; });
            }
            if (method === "close") {
              entry.closedAtMs = resourceClock(); entry.closeObservation = "ORIGINAL_CLOSE_FULFILLED";
              handles.delete(entry.id); unresolvedHandles.delete(entry.id);
            }
          });
          void operation.catch(error => {
            if (method === "close") {
              entry.closeObservation = "ORIGINAL_CLOSE_REJECTED_UNKNOWN";
              unresolvedHandles.set(entry.id, entry); handles.delete(entry.id); failed("handle-close", error);
            }
          });
          return operation;
        };
      }
    });
    return pending;
  };
  for (const method of ["unlink", "rmdir"]) fs[method] = function (...args) {
    const pending = originals[method].apply(this, args);
    return observe(pending, () => {
      const owned = (method === "unlink" ? names : directories).get(args[0]);
      if (owned) { owned.removed = true; owned.removedAtMs = resourceClock(); }
    });
  };
  const warning = value => {
    metrics.warningTotal++;
    const type = /^[A-Za-z][A-Za-z0-9]*$/u.test(value.name ?? "") ? value.name : "Warning";
    const frames = String(value.stack ?? "").split("\n").filter(line => /^\s+at /u.test(line)).slice(0, 8)
      .map(line => line.replaceAll(fileURLToPath(new URL("../../", import.meta.url)), "<repo>"));
    const stackHash = sha(String(value.stack ?? "")), key = `${type}:${stackHash}`;
    if (!warningCounts.has(key) && warningCounts.size >= 64) { metrics.warningBucketOverflow++; return; }
    const entry = warningCounts.get(key) ?? { type, stackHash, count: 0, firstAtMs: resourceClock(), emitterIds: [], earliestStacks: [] };
    entry.count++;
    if (value.emitter && (typeof value.emitter === "object" || typeof value.emitter === "function")) {
      if (!warningEmitters.has(value.emitter) && emitterId < 1024) warningEmitters.set(value.emitter, ++emitterId);
      const id = warningEmitters.get(value.emitter), ids = warningEmitterIds.get(key) ?? new Set();
      warningEmitterIds.set(key, ids);
      if (id === undefined) metrics.warningEmitterOverflow++;
      else if (!ids.has(id)) {
        if (ids.size < 32) { ids.add(id); entry.emitterIds.push(id); }
        else metrics.warningBucketEmitterOverflow++;
      }
    }
    if (warningStacks < 3) { entry.earliestStacks.push(frames); warningStacks++; }
    warningCounts.set(key, entry);
  };
  process.on("warning", warning);
  function observePool(pool, options) {
    const entry = { id: ++nextPool, requestId: requestId(), kind: typeof options.stream === "function" ? "AUXILIARY" : "PRIMARY",
      configuredLimit: options.connectionLimit, acquisitions: 0, releases: 0, enqueueEvents: 0, activeLoans: 0 };
    poolRefs.set(entry.id, new WeakRef(pool));
    const originalEnd = pool.end;
    pool.end = function (...args) {
      const pending = originalEnd.apply(this, args);
      return observe(pending, () => {
        if (entry.endObservedAtMs === undefined) {
          entry.endObservedAtMs = resourceClock(); poolHistory.push({ ...entry, poolEndObservation: "FULFILLED_NOT_SOCKET_TERMINAL" });
        }
        pools.delete(entry.id); poolRefs.delete(entry.id);
      });
    };
    pool.on("acquire", () => { entry.acquisitions++; entry.activeLoans++; });
    pool.on("release", () => { entry.releases++; entry.activeLoans = Math.max(0, entry.activeLoans - 1); });
    pool.on("enqueue", () => { entry.enqueueEvents++; });
    const remember = core => {
      const socket = core.stream;
      if (!socket || typeof socket.once !== "function") { failed("physical-stream", new Error("Driver physical stream unavailable")); return; }
      if (seenSockets.has(socket)) {
        const prior = seenSockets.get(socket);
        if (Number.isSafeInteger(Number(core.threadId)) && Number(core.threadId) > 0) prior.threadId = Number(core.threadId);
        if (Number.isInteger(socket._handle?.fd) && socket._handle.fd >= 0) prior.nativeFd = socket._handle.fd;
        prior.connectionNonce ??= mappingGate.state?.physical.get(core)?.nonce ?? null;
        return;
      }
      const transport = { id: ++socketId, poolId: entry.id, requestId: entry.kind === "AUXILIARY" ? entry.requestId : requestId(), kind: entry.kind, threadId: Number(core.threadId),
        openedAtMs: resourceClock(), closedAtMs: null, nativeFd: Number.isInteger(socket._handle?.fd) && socket._handle.fd >= 0 ? socket._handle.fd : null,
        connectionNonce: mappingGate.state?.physical.get(core)?.nonce ?? null, performanceThreadId: null,
        mappingObservation: "NOT_YET_MAPPED", closingObservedAtMs: null, closeHadError: null };
      if (!Number.isSafeInteger(transport.threadId) || transport.threadId <= 0) transport.threadId = null;
      seenSockets.set(socket, transport); transportHistory.push(transport); sockets.set(transport.id, { socket, transport, core });
      metrics.peakPrimaryTransports = Math.max(metrics.peakPrimaryTransports, [...sockets.values()].filter(value => value.transport.kind === "PRIMARY").length);
      metrics.peakAuxiliaryTransports = Math.max(metrics.peakAuxiliaryTransports, [...sockets.values()].filter(value => value.transport.kind === "AUXILIARY").length);
      socket.once("close", hadError => {
        transport.closedAtMs = resourceClock(); transport.closeHadError = hadError;
        const identity = mappingGate.state?.physical.get(core);
        if (identity?.mapped) { transport.threadId = identity.threadId; transport.connectionNonce = identity.nonce;
          transport.performanceThreadId = identity.performanceThreadId; transport.mappingObservation = "SAME_CONNECTION_DRIVER_QUERY_ACKNOWLEDGED"; }
        else { transport.mappingObservation = "CLOSED_WITHOUT_ACKNOWLEDGED_MAPPING_UNKNOWN"; metrics.unmappedClosedTransports++; }
        sockets.delete(transport.id);
      });
    };
    pools.set(entry.id, { entry, remember });
    const queue = pool.pool?._allConnections;
    if (typeof queue?.push !== "function") failed("driver-synchronous-insertion-hook-unavailable", new Error("Owned physical queue unavailable"));
    else {
      const push = queue.push;
      queue.push = function (...values) {
        const result = push.apply(this, values);
        const started = performance.now(); metrics.physicalHookCalls++;
        try { for (const core of values) remember(core); }
        catch (error) { failed("driver-synchronous-insertion", error); }
        finally { metrics.physicalHookMs += performance.now() - started; }
        return result;
      };
      for (const core of queue.toArray()) remember(core);
    }
    pool.on("connection", core => { try { remember(core); } catch (error) { failed("driver-connection-observation", error); } });
  }
  async function sample() {
    if (inProgress) return inProgress;
    inProgress = (async () => {
      const started = performance.now(), atMs = resourceClock(), files = [], failures = [], poolSamples = [];
      for (const { entry: pool, remember } of pools.values()) {
        const primitive = { ...pool };
        const value = poolRefs.get(pool.id)?.deref(), raw = value?.pool;
        if (!raw) {
          failures.push({ stage: "driver-pool-view-unavailable", poolId: pool.id }); continue;
        }
        if (typeof raw._allConnections?.toArray !== "function") {
          failures.push({ stage: "driver-physical-queue-unavailable", poolId: pool.id }); continue;
        }
        for (const core of raw._allConnections.toArray()) remember(core);
        poolSamples.push({ ...primitive, physicalQueue: raw._allConnections.length, freeQueue: raw._freeConnections.length,
          waitingQueue: raw._connectionQueue.length, closed: raw._closed === true,
          activeLoansObservation: "DRIVER_ACQUIRE_RELEASE_EVENTS_NOT_TRANSACTION_COUNT" });
      }
      const fstatStarted = performance.now();
      for (const { stat, entry } of [...handles.values()]) {
        try {
          metrics.fstatCalls++; const current = await stat();
          assert.equal(current.isFile(), true);
          if (entry.dev !== null) assert.deepEqual([current.dev, current.ino], [entry.dev, entry.ino]);
          Object.assign(entry, { dev: current.dev, ino: current.ino, size: current.size, nlink: current.nlink });
          files.push({ id: entry.id, requestId: entry.requestId, fd: entry.fd, dev: current.dev, ino: current.ino, size: current.size, nlink: current.nlink });
        } catch (error) { failures.push({ stage: "owned-handle-fstat", id: entry.id, error: errorObservation(error) }); }
      }
      const fstatMs = performance.now() - fstatStarted; metrics.fstatMs += fstatMs;
      for (const entry of unresolvedHandles.values()) failures.push({ stage: "owned-handle-close-unresolved", id: entry.id });
      if (metrics.unmappedClosedTransports) failures.push({ stage: "closed-transport-mapping-unknown", count: metrics.unmappedClosedTransports });
      if (errors.length || metrics.droppedErrors) failures.push({ stage: "observer-errors", retained: errors.length, overflow: metrics.droppedErrors });
      let visibleEmptyFiles = 0, visibleDirectories = 0;
      for (const owned of [...directories.values(), ...names.values()]) {
        if (owned.removed) continue;
        try {
          const current = await fs.lstat(owned.name);
          if (owned.entry) {
            if (owned.entry.dev === null) { owned.entry.dev = current.dev; owned.entry.ino = current.ino; }
            assert.deepEqual([current.dev, current.ino], [owned.entry.dev, owned.entry.ino]);
            if (current.isFile() && current.size === 0) visibleEmptyFiles++;
          } else {
            owned.identity ??= { dev: current.dev, ino: current.ino };
            assert.deepEqual([current.dev, current.ino], [owned.identity.dev, owned.identity.ino]); visibleDirectories++;
          }
        } catch (error) {
          if (error.code !== "ENOENT") failures.push({ stage: "owned-visible-metadata", error: errorObservation(error) });
          // Absence is only a pathname fact. Anonymous bytes are measured separately with fstat.
        }
      }
      const activeTransports = [];
      for (const { socket, transport, core } of sockets.values()) {
        const identity = mappingGate.state?.physical.get(core);
        if (identity?.mapped) { transport.threadId = identity.threadId; transport.connectionNonce = identity.nonce;
          transport.performanceThreadId = identity.performanceThreadId; transport.mappingObservation = "SAME_CONNECTION_DRIVER_QUERY_ACKNOWLEDGED"; }
        if (socket.destroyed && transport.closingObservedAtMs === null) transport.closingObservedAtMs = resourceClock();
        activeTransports.push({ ...transport, state: socket.destroyed ? "CLOSING_NOT_TERMINAL" : "LIVE" });
        if (transport.threadId === null || !identity?.mapped) failures.push({ stage: "physical-transport-mapping-not-yet-complete", transportId: transport.id });
      }
      const fd = await ownDescriptorCount();
      const sample = { atMs, incarnation, cadenceAnchorAtMs, memory: process.memoryUsage(), fd, files, visibleEmptyFiles, visibleDirectories,
        anonymousBytes: unresolvedHandles.size || failures.some(value => value.stage === "owned-handle-fstat") ? null : files.filter(file => file.nlink === 0).reduce((sum, file) => sum + file.size, 0),
        unresolvedHandles: unresolvedHandles.size,
        activeTransports, pools: poolSamples,
        transportHighWater: { primary: metrics.peakPrimaryTransports, auxiliary: metrics.peakAuxiliaryTransports },
        observation: "NON_ATOMIC_PROCESS_VIEWS; DRIVER_PHYSICAL_QUEUE_AND_SOCKET_CLOSE_EVENTS; PRE_HANDSHAKE_UNKNOWN_COUNTS_AS_INCOMPLETE",
        warnings: [...warningCounts.values()].map(({ type, stackHash, count }) => ({ type, stackHash, count })),
        failures, fstatMs, complete: failures.length === 0 && fd.count !== null, elapsedMs: performance.now() - started };
      metrics.snapshots++; metrics.snapshotMs += sample.elapsedMs;
      try { await publish({ type: "resource-observation", observation: sample }); }
      catch (error) { metrics.publishErrors++; failed("resource-publish", error); }
      return sample;
    })().finally(() => { inProgress = undefined; });
    return inProgress;
  }
  const clock = startStocktakeSamplingClock(() => { void sample().catch(error => failed("resource-sample", error)); });
  const cadenceAnchorAtMs = clock.anchorAtMs;
  return { observePool, sample, report: () => ({ incarnation, atMs: resourceClock(), metrics: { ...metrics }, errors: structuredClone(errors),
    warnings: structuredClone([...warningCounts.values()]), files: structuredClone(fileHistory),
    pools: [...structuredClone(poolHistory), ...[...pools.values()].map(({ entry }) => ({ ...entry }))], transports: structuredClone(transportHistory),
    activeHandles: handles.size + unresolvedHandles.size, unresolvedHandles: unresolvedHandles.size, activeTransports: sockets.size }),
  async stop() {
    if (stopped) return; stopped = true; clock.stop(); await sample();
    for (const [name, original] of Object.entries(originals)) fs[name] = original;
    process.removeListener("warning", warning);
  } };
}

export function rememberStocktakeDriverMapping(workers, owner, message) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  assert.deepEqual(Object.keys(message).sort(), ["childObservedAt", "incarnation", "instrumented", "nonce", "performanceThreadId", "provenance", "threadId", "type"]);
  assert.equal(message.type, "connection-mapping"); assert.match(message.incarnation, uuid); assert.match(message.nonce, uuid);
  assert.equal(message.incarnation, owner.incarnation); assert.equal(message.instrumented, "YES");
  assert.equal(message.provenance, "SAME_CONNECTION_DRIVER_QUERY");
  assert.ok(Number.isFinite(message.childObservedAt) && message.childObservedAt >= 0);
  for (const key of ["threadId", "performanceThreadId"]) assert.ok(Number.isSafeInteger(message[key]) && message[key] > 0);
  const owners = workers.filter(worker => worker.connections.has(message.threadId));
  assert.equal(owners.length, 1); assert.equal(owners[0], owner);
  const physical = owner.connectionEvents.filter(event => event.threadId === message.threadId && event.nonce === message.nonce);
  assert.equal(physical.length, 1, "Mapping needs its actual physical event and nonce");
  for (const worker of workers) for (const known of worker.observationIdentities.values()) {
    if (known.performanceThreadId === message.performanceThreadId) assert.ok(worker === owner && known.threadId === message.threadId, "Foreign P_S identity remains UNKNOWN");
  }
  const prior = owner.observationIdentities.get(message.threadId);
  if (prior) {
    assert.equal(prior.incarnation, message.incarnation); assert.equal(prior.performanceThreadId, message.performanceThreadId);
    assert.equal(prior.nonce, message.nonce); assert.equal(prior.provenance, message.provenance);
  } else owner.observationIdentities.set(message.threadId, {
    threadId: message.threadId, performanceThreadId: message.performanceThreadId, incarnation: message.incarnation,
    nonce: message.nonce, provenance: message.provenance, childObservedAt: message.childObservedAt,
    firstObservedAt: performance.now(), observedTransactionIds: [], observedEngineTokens: []
  });
  return { type: "connection-mapping-ack", incarnation: message.incarnation, nonce: message.nonce,
    threadId: message.threadId, performanceThreadId: message.performanceThreadId };
}

export function installStocktakeObservationMapping(pool, { incarnation, send, gate = {} }) {
  const shared = gate.state ??= { incarnation, physical: new WeakMap(), nativeOwners: new Map(), pending: new Map(), active: new Set(), destroyed: new WeakSet(), failure: null,
    metrics: { acquireCalls: 0, acquireMs: 0, mappingQueries: 0, mappingSqlMs: 0, ipcMessages: 0, ipcStringBytes: 0, failures: 0, cleanupFailures: 0 } };
  assert.equal(shared.incarnation, incarnation);
  const original = pool.getConnection, { physical, nativeOwners, pending, active, destroyed } = shared;
  const notify = message => {
    shared.metrics.ipcMessages++; shared.metrics.ipcStringBytes += Buffer.byteLength(JSON.stringify(message), "utf8");
    return send(message);
  };
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const fail = (error, identity) => {
    if (!shared.failure) {
      shared.failure = error; shared.metrics.failures++;
      for (const reject of active) reject(error);
      try {
        Promise.resolve(notify({ type: "connection-mapping-failure", incarnation, nonce: identity?.nonce ?? null,
          threadId: positive(identity?.threadId) ? identity.threadId : null })).catch(() => {});
      } catch { /* The local permanent latch does not depend on failure IPC. */ }
      for (const entry of pending.values()) entry.reject(error);
    }
    return shared.failure;
  };
  pool.on("connection", core => {
    const identity = { nonce: randomUUID(), threadId: Number(core.threadId), mapped: false };
    physical.set(core, identity);
    if (!positive(identity.threadId) || nativeOwners.has(identity.threadId)) {
      fail(new Error("Duplicate or invalid owned native connection"), identity); return;
    }
    nativeOwners.set(identity.threadId, core);
    try {
      identity.sent = Promise.resolve(notify({ type: "connection", incarnation, nonce: identity.nonce, threadId: identity.threadId }))
        .catch(error => { fail(error, identity); });
    } catch (error) { fail(error, identity); }
  });
  pool.getConnection = async function () {
    if (shared.failure) throw shared.failure;
    const started = performance.now(), deadline = started + 5000;
    shared.metrics.acquireCalls++;
    let connection, identity, rejectFailure;
    const failed = new Promise((_resolve, reject) => { rejectFailure = reject; });
    active.add(rejectFailure);
    const cutoff = () => {
      if (shared.failure) throw shared.failure;
      if (performance.now() >= deadline) throw Object.assign(new Error("Owned connection mapping deadline"), { code: "TEST_CONNECTION_MAPPING_TIMEOUT" });
    };
    const destroy = () => {
      if (connection && !destroyed.has(connection.connection)) {
        destroyed.add(connection.connection); connection.destroy();
      }
    };
    const rejectOwned = error => {
      const primary = fail(error, identity);
      try { destroy(); }
      catch (cleanupError) {
        shared.metrics.cleanupFailures++;
        if (primary instanceof Error) primary.mappingCleanupFailure = errorObservation(cleanupError);
      }
      return primary;
    };
    const timer = globalThis.setTimeout(() => { fail(Object.assign(new Error("Owned connection mapping deadline"), { code: "TEST_CONNECTION_MAPPING_TIMEOUT" }), identity); }, 5000);
    const work = (async () => {
      connection = await original.call(pool);
      cutoff();
      identity = physical.get(connection.connection);
      assert.ok(identity, "Missing physical connection event");
      await identity.sent; cutoff();
      if (!identity.mapped) {
        let rows;
        const queryStarted = performance.now(); shared.metrics.mappingQueries++;
        try {
          [rows] = await connection.query(`SELECT CONNECTION_ID() AS nativeId,PROCESSLIST_ID,THREAD_ID,INSTRUMENTED
            FROM performance_schema.threads WHERE PROCESSLIST_ID=CONNECTION_ID()`);
        } finally { shared.metrics.mappingSqlMs += performance.now() - queryStarted; }
        cutoff();
        assert.equal(rows.length, 1);
        const row = rows[0], performanceThreadId = Number(row.THREAD_ID);
        assert.equal(Number(row.nativeId), identity.threadId); assert.equal(Number(row.PROCESSLIST_ID), identity.threadId);
        assert.ok(positive(performanceThreadId)); assert.equal(row.INSTRUMENTED, "YES");
        let resolveAck, rejectAck;
        const acknowledged = new Promise((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
        void acknowledged.catch(() => {});
        pending.set(identity.nonce, { identity, performanceThreadId, resolve: resolveAck, reject: rejectAck, received: false });
        await notify({ type: "connection-mapping", incarnation, nonce: identity.nonce, threadId: identity.threadId,
          performanceThreadId, instrumented: "YES", provenance: "SAME_CONNECTION_DRIVER_QUERY", childObservedAt: performance.now() });
        cutoff(); await acknowledged; cutoff();
        identity.mapped = true; identity.performanceThreadId = performanceThreadId;
      }
      cutoff(); return connection;
    })().catch(error => { throw rejectOwned(error); });
    try {
      const result = await Promise.race([work, failed]);
      cutoff(); return result;
    } catch (error) { throw rejectOwned(error); }
    finally {
      clearTimeout(timer); active.delete(rejectFailure); shared.metrics.acquireMs += performance.now() - started;
      if (identity) pending.delete(identity.nonce);
    }
  };
  return { report: () => structuredClone(shared.metrics), ack(message) {
    if (shared.failure) return false;
    try {
      assert.deepEqual(Object.keys(message).sort(), ["incarnation", "nonce", "performanceThreadId", "threadId", "type"]);
      assert.equal(message.type, "connection-mapping-ack"); assert.equal(message.incarnation, incarnation);
      const entry = pending.get(message.nonce); assert.ok(entry); assert.equal(entry.received, false);
      assert.equal(message.threadId, entry.identity.threadId); assert.equal(message.performanceThreadId, entry.performanceThreadId);
      entry.received = true; entry.resolve(); return true;
    } catch (error) { fail(error); return false; }
  } };
}


function installTransactionObserver(database, context, publish) {
  const originalTransaction = database.withTransaction.bind(database), observer = { transactions: 0, publishErrors: 0 };
  const minimalError = error => {
    const observation = errorObservation(error);
    return { codes: observation.codes, chain: observation.chain.map(({ code, errno, sqlState, assertionOperator }) => ({ code, errno, sqlState, assertionOperator })) };
  };
  const tables = new Set(["inventory_warehouses", "inventory_bins", "inventory_lots", "inventory_stock_balances", "inventory_stock_controls",
    "inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_bin_locks", "inventory_movements",
    "inventory_operations", "inventory_audits", "inventory_reservations", "inventory_allocations", "inventory_issues", "inventory_issue_lines"]);
  database.withTransaction = (work, ...options) => {
    if (typeof work !== "function") return originalTransaction(work, ...options);
    const requestId = context.get()?.requestId, started = performance.now(), cpu = process.cpuUsage(), marked = new Set();
    const sample = { traceId: randomUUID(), requestId: /^[a-zA-Z0-9-]{1,100}$/u.test(requestId ?? "") ? requestId : null,
      scope: "TEST_ONLY_PROCESS_CPU_NOT_JS_PROFILE; WITH_TRANSACTION_INCLUDING_ACQUIRE_COMMIT_ROLLBACK; SQL_WALL_INCLUDES_WAIT",
      startedMs: started, completeMs: 0, cpuUserMicros: 0, cpuSystemMicros: 0, sqlCount: 0, sqlWallMs: 0,
      status: "IN_PROGRESS", milestones: [], droppedMilestones: 0, failures: [], droppedFailures: 0 };
    observer.transactions++;
    const mark = (name, semantics) => {
      if (marked.has(name)) return;
      marked.add(name);
      const delta = process.cpuUsage(cpu); sample.completeMs = performance.now() - started;
      sample.cpuUserMicros = delta.user; sample.cpuSystemMicros = delta.system;
      if (sample.milestones.length < 16) sample.milestones.push({ name, elapsedMs: sample.completeMs, sqlCount: sample.sqlCount, semantics });
      else sample.droppedMilestones++;
      try { Promise.resolve(publish(structuredClone(sample))).catch(() => { observer.publishErrors++; }); }
      catch { observer.publishErrors++; }
    };
    const finish = (status, error) => {
      sample.status = status; if (error) sample.error = minimalError(error);
      mark(status === "COMPLETE" ? "complete" : "fail", "ORIGINAL_WITH_TRANSACTION_SETTLED_NOT_JS_FUNCTION_PROFILE");
    };
    mark("start", "WITH_TRANSACTION_CALL_BEFORE_CONNECTION_ACQUISITION");
    let execution;
    try {
      execution = originalTransaction((tx, ...callbackArgs) => {
        for (const method of ["query", "execute"]) {
          const original = tx[method].bind(tx);
          tx[method] = (...args) => {
            const startedSql = performance.now(), sql = typeof args[0] === "string" ? args[0] : args[0]?.sql;
            sample.sqlCount++;
            if (/\bFROM\s+inventory_stock_balances\b/iu.test(sql) && /\bAVAILABLE\b/iu.test(sql) && /\bFOR SHARE\b/iu.test(sql)) mark("firstReservedSql", "WAREHOUSE_AVAILABLE_COVERAGE_QUERY_CALL_ATTEMPT");
            if (/^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+inventory_(?:stock_balances|movements)\b/iu.test(sql)) mark("firstMutation", "STOCK_BALANCE_OR_MOVEMENT_CALL_ATTEMPT_NOT_COMMIT");
            const failed = error => {
              const table = String(sql).match(/\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO)\s+(inventory_[a-z_]+)/iu)?.[1];
              if (sample.failures.length < 100) sample.failures.push({ method, sqlHash: sha(String(sql)), table: tables.has(table) ? table : "OTHER",
                binds: Array.isArray(args[1]) ? args[1].length : 0, error: minimalError(error) });
              else sample.droppedFailures++;
              sample.sqlWallMs += performance.now() - startedSql;
            };
            let query;
            try { query = original(...args); } catch (error) { failed(error); throw error; }
            return Promise.resolve(query).then(value => {
              sample.sqlWallMs += performance.now() - startedSql;
              if (/\bFROM\s+inventory_stocktake_lines\b/iu.test(sql) && /\bFOR UPDATE\b/iu.test(sql)) mark("lockedRowsRead", "LOCKING_LINE_READ_RETURNED_NOT_INDEPENDENT_LOCK_PROOF");
              return value;
            }, error => { failed(error); throw error; });
          };
        }
        return work(tx, ...callbackArgs);
      }, ...options);
    } catch (error) { finish("FAIL", error); throw error; }
    return Promise.resolve(execution).then(value => { finish("COMPLETE"); return value; }, error => { finish("FAIL", error); throw error; });
  };
  return observer;
}

function validateCpuHoldCommand(message, incarnation) {
  assert.ok(message && typeof message === "object" && !Array.isArray(message));
  assert.deepEqual(Object.keys(message).sort(), ["id", "incarnation", "nonce", "type"]);
  assert.equal(message.type, "TEST_ONLY_CPU_HOLD"); assert.equal(message.incarnation, incarnation);
  for (const key of ["id", "incarnation", "nonce"]) assert.match(message[key], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  return message;
}

async function testOnlyCpuHold(app, notify) {
  return app.services.require("mysqldatabase").withTransaction(async tx => {
    const [[connection]] = await tx.query("SELECT CONNECTION_ID() AS id");
    const threadId = Number(connection.id); assert.ok(Number.isSafeInteger(threadId) && threadId > 0);
    const [mapping] = await tx.query("SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [threadId]);
    assert.equal(mapping.length, 1); assert.equal(Number(mapping[0].PROCESSLIST_ID), threadId); assert.equal(mapping[0].INSTRUMENTED, "YES");
    const performanceThreadId = Number(mapping[0].THREAD_ID); assert.ok(Number.isSafeInteger(performanceThreadId) && performanceThreadId > 0);
    const [warehouse] = await tx.query("SELECT id FROM inventory_warehouses WHERE id=5 FOR UPDATE");
    assert.equal(warehouse.length, 1); assert.equal(Number(warehouse[0].id), 5);
    const [locks] = await tx.query(`SELECT DISTINCT ENGINE_TRANSACTION_ID AS id FROM performance_schema.data_locks
      WHERE THREAD_ID=? AND OBJECT_SCHEMA=DATABASE() AND OBJECT_NAME='inventory_warehouses' AND LOCK_TYPE='RECORD'`, [performanceThreadId]);
    const transactionIds = [...new Set(locks.map(row => String(row.id)))]; assert.ok(transactionIds.length > 0);
    for (const id of transactionIds) assert.match(id, /^[1-9]\d*$/u);
    await notify({ threadId, performanceThreadId, transactionIds });
    const started = performance.now(); let checksum = 1;
    while (performance.now() - started < 60000) checksum = Math.imul(checksum ^ 31, 1664525);
    return { heldMs: performance.now() - started, checksum };
  });
}

function workerConfiguration(root, secret) {
  const config = defaultConfigurationSource();
  const normalized = validateApplicationConfiguration(config);
  // Keep unrelated capabilities disabled; setting attachment roots would require a real scanner.
  assert.equal(normalized.customer.attachment, null);
  assert.equal(normalized.customer.import, null);
  assert.equal(normalized.supplier.import.root, null);
  return { ...config,
    logging: { ...config.logging, loggers: Object.fromEntries(Object.entries(config.logging.loggers).map(([name, value]) => [name, { ...value, directory: path.join(root, "logs", name) }])) },
    jwt: { ...config.jwt, secret }, application: { ...config.application, host: "127.0.0.1", port: 0 },
    item: { ...config.item, mediaDirectory: path.join(root, "media"), importDirectory: path.join(root, "imports") },
    api: { ...config.api, defaults: { ...config.api.defaults, upload: { ...config.api.defaults.upload, directory: path.join(root, "uploads") } } }
  };
}
function validateObservationCommand(message, incarnation) {
  assert.ok(message && typeof message === "object" && !Array.isArray(message));
  assert.deepEqual(Object.keys(message).sort(), ["id", "incarnation", "nonce", "type"]);
  assert.ok(["TEST_ONLY_OBSERVATION_HOLD", "TEST_ONLY_OBSERVATION_ABORT"].includes(message.type));
  assert.equal(message.incarnation, incarnation);
  for (const key of ["id", "incarnation", "nonce"]) assert.match(message[key], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
}
async function testOnlyObservationHold(app, signal, notify) {
  let callbackSettled = false, callbackExecution, identity;
  const deadline = performance.now() + 20000;
  const database = app.services.require("mysqldatabase");
  assert.equal(database.config.transactionTimeoutMs, 20000);
  try {
    await database.withTransaction((tx, { signal: transactionSignal }) => {
      callbackExecution = (async () => {
      let aborted;
      try {
        const [[connection]] = await tx.query("SELECT CONNECTION_ID() AS id");
        const [mapping] = await tx.query("SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [Number(connection.id)]);
        assert.equal(mapping.length, 1); assert.equal(mapping[0].INSTRUMENTED, "YES");
        identity = { threadId: Number(connection.id), performanceThreadId: Number(mapping[0].THREAD_ID) };
        assert.equal(Number(mapping[0].PROCESSLIST_ID), identity.threadId);
        for (const id of Object.values(identity)) assert.ok(Number.isSafeInteger(id) && id > 0);
        const [rows] = await tx.query("SELECT id FROM inventory_warehouses WHERE id=5 FOR UPDATE");
        assert.equal(rows.length, 1); assert.equal(Number(rows[0].id), 5);
        // Register before notifying the parent so an immediate ABORT cannot be missed.
        const cancelled = new Promise((_, reject) => {
          aborted = () => reject(transactionSignal.reason);
          transactionSignal.addEventListener("abort", aborted, { once: true });
          if (transactionSignal.aborted) aborted();
        });
        void cancelled.catch(() => {});
        await notify({ stage: "HOLDING", ...identity });
        await cancelled;
      } finally {
        if (aborted) transactionSignal.removeEventListener("abort", aborted);
      }
      })();
      return callbackExecution;
    }, { signal });
    return { outcome: "UNEXPECTED_SUCCESS", callbackSettled };
  } catch (error) {
    let callbackError, callbackWaitError;
    if (callbackExecution) {
      // The database race alone does not prove its callback has stopped.
      try {
        await withinObservation(callbackExecution.then(() => { callbackSettled = true; }, caught => {
          callbackSettled = true; callbackError = errorObservation(caught);
        }), deadline);
      } catch (waitError) { callbackWaitError = errorObservation(waitError); }
      if (callbackSettled && !callbackWaitError && identity) await notify({ stage: "CALLBACK_SETTLED", ...identity });
    }
    return { outcome: "FAILED", error: errorObservation(error), callbackSettled, callbackError, callbackWaitError };
  }
}
function databaseOptions() {
  assert.equal(process.env.DB_INTEGRATION_TESTS, "1");
  assert.equal(process.env.INVENTORY_STOCKTAKE_CHARACTERIZATION_TESTS, "1");
  assert.match(process.version, /^v26\./u);
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task041_perf_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task041-perf-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  return { socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
}
async function seedActors(db) {
  const actors = [], now = Date.now();
  for (let index = 0; index < 20; index++) {
    const lane = index % 10, writer = lane >= 6 && lane < 9;
    const permissions = writer ? ["inventory.view", "inventory.operation", "inventory.adjust"] : ["inventory.view"];
    const username = `st041-${randomUUID()}`, password = randomBytes(32).toString("hex"), device = await createTestDevice();
    const [role] = await db.execute("INSERT INTO roles (name,created_at) VALUES (?,?)", [username, now]);
    for (const permission of permissions) await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
    const [user] = await db.execute("INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic041',?,?)", [username, await hashPassword(password), now, now]);
    await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
    await db.execute("INSERT INTO user_devices (user_id,device_id,public_key,status,requested_at) VALUES (?,?,?,'approved',?)", [user.insertId, device.deviceId, device.publicKeyDer, now]);
    actors.push({ id: Number(user.insertId), username, password, device, worker: Math.floor(index / 10), lane, writer });
  }
  return actors;
}
async function seedCapacity(db, actorId, report) {
  const started = performance.now(), now = Date.now();
  for (const table of ["item_skus", "inventory_warehouses", "inventory_stock_balances", "inventory_movements", "inventory_operation_requests", "inventory_audit_logs"]) {
    assert.equal(Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n), 0, "Requires a fresh fully migrated schema");
  }
  const item = await seedItemPerformanceFixtures({ database: db, skuCount: 100000, uomsPerSku: 1, barcodesPerSku: 1, batchSize: 500 });
  const [[ids]] = await db.query("SELECT MIN(id) AS firstId,MAX(id) AS lastId FROM item_skus");
  assert.deepEqual([Number(ids.firstId), Number(ids.lastId)], [1, 100000]);
  await db.query("UPDATE item_skus SET tracking_policy=CASE WHEN MOD(id-1,4)<2 THEN 'none' WHEN MOD(id-1,4)=2 THEN 'batch' ELSE 'batch_expiry' END,min_sale_life_days=0");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const expiry = new Date(Date.parse(day + "T00:00:00Z") + 365 * 86400000).toISOString().slice(0, 10);
  await db.query(`INSERT INTO inventory_lots (id,sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at)
    SELECT id,id,CONCAT('L-',id),CONCAT('L-',id),IF(tracking_policy='batch_expiry',?,NULL),?,sku_code,?
    FROM item_skus WHERE id<=50000 AND tracking_policy<>'none'`, [expiry, day, now]);
  for (let warehouse = 1; warehouse <= 5; warehouse++) {
    await db.execute("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?, ?,?,?)", [warehouse, `WH-${warehouse}`, `WH-${warehouse}`, `Synthetic ${warehouse}`, now, now]);
    const bins = Array.from({ length: 200 }, (_, n) => [(warehouse - 1) * 200 + n + 1, warehouse, `B-${String(n + 1).padStart(3, "0")}`, `B-${String(n + 1).padStart(3, "0")}`, now, now]);
    await db.query("INSERT INTO inventory_bins (id,warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES ?", [bins]);
    await db.query("INSERT INTO inventory_stock_controls (warehouse_id,sku_id,reserved_quantity,version,created_at,updated_at) SELECT ?,id,0,1,?,? FROM item_skus WHERE id<=50000", [warehouse, now, now]);
    for (let leg = 0; leg < 2; leg++) await db.query(`INSERT INTO inventory_stock_balances
      (id,warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,allocated_quantity,fifo_anchor_date,version,created_at,updated_at)
      SELECT ?+(id-1)*2+?+1,?,?+MOD(FLOOR((id-1)/4)+?,200)+1,id,IF(tracking_policy='none',NULL,id),
        IF(?=0,'AVAILABLE',IF(MOD(id,2)=0,'QUARANTINED','DAMAGED')),100,0,?,4,?,?
      FROM item_skus WHERE id<=50000`, [(warehouse - 1) * 100000, leg, warehouse, (warehouse - 1) * 200, leg * 100, leg, day, now, now]);
  }
  for (let start = 1; start <= 500000; start += 5000) {
    const end = start + 4999;
    await db.query(`INSERT INTO inventory_operation_requests
      (id,command_type,source_module,source_document_type,source_document_id,source_line_id,source_event_id,request_hash,result_type,result_id,result_summary,completed_at,actor_user_id,actor_label,created_at)
      SELECT id,'RECEIPT_POST','PERFORMANCE','SYNTHETIC_BASELINE',CAST(id AS CHAR),'','baseline',SHA2(CONCAT('fixture-',id),256),'MOVEMENT_GROUP',
        CONCAT('00000000-0000-4000-8000-',LPAD(id,12,'0')),JSON_OBJECT('movementGroupId',CONCAT('00000000-0000-4000-8000-',LPAD(id,12,'0')),'status','POSTED','lineCount',4),?,?, 'Synthetic fixture, not Receipt execution',?
      FROM inventory_stock_balances WHERE id BETWEEN ? AND ?`, [now, actorId, now, start, end]);
    await db.query(`INSERT INTO inventory_audit_logs (occurred_at,actor_user_id,actor_label,action,target_type,target_id,target_label,outcome,after_summary,operation_request_id)
      SELECT ?,?,'Synthetic fixture','inventory.receipt','movement_group',id,CAST(id AS CHAR),'SUCCEEDED',JSON_OBJECT('quantity',100,'version',4,'rowCount',4),id
      FROM inventory_stock_balances WHERE id BETWEEN ? AND ?`, [now, actorId, start, end]);
    for (let leg = 1; leg <= 4; leg++) await db.query(`INSERT INTO inventory_movements
      (movement_group_id,operation_request_id,movement_type,location_kind,warehouse_id,bin_id,sku_id,lot_id,stock_status,direction,quantity,balance_before,balance_after,balance_version_after,
       sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,posted_at,posted_by,posted_by_label)
      SELECT CONCAT('00000000-0000-4000-8000-',LPAD(b.id,12,'0')),b.id,'RECEIPT','BIN',b.warehouse_id,b.bin_id,b.sku_id,b.lot_id,b.stock_status,'IN',25,?,?,?,
        s.sku_code,s.sku_name,w.warehouse_code,bn.bin_code,COALESCE(l.lot_number,''),l.expiry_date,?,?,'Synthetic fixture'
      FROM inventory_stock_balances b JOIN item_skus s ON s.id=b.sku_id JOIN inventory_warehouses w ON w.id=b.warehouse_id
      JOIN inventory_bins bn ON bn.id=b.bin_id LEFT JOIN inventory_lots l ON l.id=b.lot_id WHERE b.id BETWEEN ? AND ?`, [(leg - 1) * 25, leg * 25, leg, now - 5 + leg, actorId, start, end]);
  }
  await db.query("ANALYZE TABLE item_skus,item_sku_barcodes,inventory_stock_controls,inventory_stock_balances,inventory_movements");
  report.seed = { elapsedMs: performance.now() - started, marker: item.marker, syntheticOnly: true, receiptWorkflowEvidence: false,
    intent: Object.freeze({ actorId, day, expiry, timestamp: now }) };
}
async function counts(db) {
  const result = {}, tables = { warehouses: "inventory_warehouses", bins: "inventory_bins", skus: "item_skus", buckets: "inventory_stock_balances", movements: "inventory_movements", controls: "inventory_stock_controls", operations: "inventory_operation_requests", audits: "inventory_audit_logs" };
  for (const [name, table] of Object.entries(tables)) result[name] = Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n);
  const [[buckets]] = await db.query("SELECT MIN(n) AS lo,MAX(n) AS hi FROM (SELECT COUNT(*) AS n FROM inventory_stock_balances GROUP BY bin_id) b");
  assert.deepEqual([Number(buckets.lo), Number(buckets.hi)], [500, 500]);
  const [[normalized]] = await db.query(`SELECT
    (SELECT COUNT(*) FROM inventory_bins WHERE CAST(normalized_code AS BINARY)<>CAST(UPPER(bin_code) AS BINARY)) AS bins,
    (SELECT COUNT(*) FROM inventory_lots WHERE CAST(normalized_lot_number AS BINARY)<>CAST(TRIM(lot_number) AS BINARY)) AS lots`);
  assert.deepEqual([Number(normalized.bins), Number(normalized.lots)], [0, 0], "Fixture must use canonical Bin and Lot normalization");
  const [[invalid]] = await db.query(`SELECT COUNT(*) AS n FROM inventory_stock_balances b LEFT JOIN
    (SELECT warehouse_id,bin_id,sku_id,IFNULL(lot_id,0) AS lot_scope,stock_status,SUM(IF(direction='IN',quantity,-CAST(quantity AS SIGNED))) AS quantity
     FROM inventory_movements GROUP BY warehouse_id,bin_id,sku_id,lot_scope,stock_status) m
    ON m.warehouse_id=b.warehouse_id AND m.bin_id=b.bin_id AND m.sku_id=b.sku_id AND m.lot_scope=b.lot_scope AND m.stock_status=b.stock_status
    WHERE m.quantity IS NULL OR m.quantity<>b.on_hand_quantity OR b.allocated_quantity>b.on_hand_quantity`);
  assert.equal(Number(invalid.n), 0);
  return result;
}
async function worker(root, secret, peers = [], primaryLimit = 10, registerOwner, fixtureMode) {
  assert.ok(primaryLimit === 10 || primaryLimit === 1);
  const directory = await fs.mkdtemp(path.join(root, "worker-")), incarnation = randomUUID();
  const child = fork(new URL(import.meta.url), [], { execArgv: ["--import", new URL("./testEnv.js", import.meta.url).href], env: { ...process.env, TMPDIR: directory }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const pending = new Map(), connections = new Set(), connectionEvents = [], observationIdentities = new Map(), stderr = [], protocolErrors = [], transactionObservations = new Map();
  let exit, closing, stopping, shutdownError, cpuHoldInvocation;
  const owner = { child, incarnation, connections, connectionEvents, observationIdentities, directory, stderr, transactionObservations,
    quarantined: false, mappingStats: null, mappingFailures: [], resourceSamples: [], resourceFinal: null,
    ...(fixtureMode === "CS01" ? { soakExportEvents: [], soakObserverStatus: null } : {}),
    get cpuHoldInvocation() { return cpuHoldInvocation; } };
  const protocolFail = error => {
    owner.quarantined = true;
    if (protocolErrors.length < 16) protocolErrors.push(errorObservation(error));
  };
  const exited = new Promise(resolve => { child.once("exit", (code, signal) => { exit = { code, signal }; resolve(exit); }); });
  child.stderr.on("data", chunk => { stderr.push({ bytes: chunk.length, sha256: sha(chunk) }); });
  child.on("message", message => {
    if (message.incarnation !== incarnation || (message.type === "connection" && (!Number.isSafeInteger(message.threadId) || message.threadId <= 0))) {
      const error = Object.assign(new Error("Owned child identity mismatch"), { code: "TEST_CHILD_IDENTITY_MISMATCH" });
      protocolFail(error);
      const request = pending.get(message.id); pending.delete(message.id); request?.reject(error);
      return;
    }
    if (message.type === "stocktake-soak-export-event") {
      try {
        assert.equal(fixtureMode, "CS01"); assert.equal(message.event.incarnation, incarnation);
        assert.ok(owner.soakExportEvents.length < 200000, "CS01 lifecycle event capture overflow");
        owner.soakExportEvents.push(message.event);
      } catch (error) { protocolFail(error); }
      return;
    }
    if (message.type === "resource-observation") {
      try {
        assert.deepEqual(Object.keys(message).sort(), ["incarnation", "observation", "type"]);
        assert.equal(message.observation.incarnation, incarnation);
        assert.ok(Number.isFinite(message.observation.atMs));
        owner.resourceSamples.push(message.observation);
      } catch (error) { protocolFail(error); }
      return;
    }
    if (message.type === "resource-final") {
      try {
        assert.deepEqual(Object.keys(message).sort(), ["incarnation", "observation", "type"]);
        assert.equal(message.observation.incarnation, incarnation); owner.resourceFinal = message.observation;
      } catch (error) { protocolFail(error); }
      return;
    }
    if (message.type === "connection") {
      try {
        assert.deepEqual(Object.keys(message).sort(), ["incarnation", "nonce", "threadId", "type"]);
        assert.match(message.nonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
        assert.equal(connections.has(message.threadId), false);
        connections.add(message.threadId); connectionEvents.push({ threadId: message.threadId, nonce: message.nonce, receivedAt: performance.now() });
      } catch (error) { protocolFail(error); }
      return;
    }
    if (message.type === "connection-mapping") {
      try {
        const workers = peers.includes(owner) ? peers : [...peers, owner];
        const ack = rememberStocktakeDriverMapping(workers, owner, message);
        child.send(ack, error => { if (error) protocolFail(error); });
      } catch (error) { protocolFail(error); }
      return;
    }
    if (message.type === "connection-mapping-failure") {
      protocolFail(Object.assign(new Error("Owned connection mapping failed"), { code: "TEST_CONNECTION_MAPPING_FAILED" }));
      try {
        assert.deepEqual(Object.keys(message).sort(), ["incarnation", "nonce", "threadId", "type"]);
        assert.ok(message.nonce === null || /^[0-9a-f-]{36}$/u.test(message.nonce));
        assert.ok(message.threadId === null || Number.isSafeInteger(message.threadId) && message.threadId > 0);
        if (owner.mappingFailures.length < 16) owner.mappingFailures.push({ ...message, receivedAt: performance.now() });
      } catch (error) { protocolFail(error); }
      return;
    }
    if (message.type === "connection-mapping-stats") {
      try {
        assert.deepEqual(Object.keys(message).sort(), ["incarnation", "observation", "type"]);
        assert.deepEqual(Object.keys(message.observation).sort(), ["acquireCalls", "acquireMs", "cleanupFailures", "failures", "ipcMessages", "ipcStringBytes", "mappingQueries", "mappingSqlMs"]);
        for (const value of Object.values(message.observation)) assert.ok(Number.isFinite(value) && value >= 0);
        owner.mappingStats = { ...message.observation, receivedAt: performance.now() };
        if (message.observation.failures || message.observation.cleanupFailures) {
          protocolFail(Object.assign(new Error("Owned connection mapping reported failures"), { code: "TEST_CONNECTION_MAPPING_FAILED" }));
        }
      } catch (error) { protocolFail(error); }
      return;
    }
    if (message.type === "transaction-observation") {
      const value = message.observation;
      if (!value || !/^[0-9a-f-]{36}$/u.test(value.traceId ?? "") ||
        !["IN_PROGRESS", "COMPLETE", "FAIL"].includes(value.status) || !Array.isArray(value.milestones) || value.milestones.length > 16 ||
        !Array.isArray(value.failures) || value.failures.length > 100) {
        if (protocolErrors.length < 16) protocolErrors.push(errorObservation(Object.assign(new Error("Invalid private transaction observation"), { code: "TEST_INVALID_TRANSACTION_OBSERVATION" })));
        return;
      }
      transactionObservations.set(value.traceId, value); return;
    }
    const request = pending.get(message.id);
    if (message.type === "short-connection-checkpoint") {
      try {
        assert.equal(request?.type, "TEST_ONLY_SHORT_CONNECTION"); assert.equal(message.nonce, request.nonce);
        assert.deepEqual(Object.keys(message).sort(), ["connectionNonce", "id", "incarnation", "nonce", "performanceThreadId", "stage", "threadId", "type"]);
        assert.ok(["ORIGINAL", "FRESH"].includes(message.stage));
        request.onStart(message);
      } catch (error) { pending.delete(message.id); request?.reject(error); protocolFail(error); }
      return;
    }
    if (message.type === "observation-hold-checkpoint") {
      try {
        assert.equal(request?.type, "TEST_ONLY_OBSERVATION_HOLD"); assert.equal(message.nonce, request.nonce);
        assert.deepEqual(Object.keys(message).sort(), ["id", "incarnation", "nonce", "performanceThreadId", "stage", "threadId", "type"]);
        assert.ok(["HOLDING", "CALLBACK_SETTLED"].includes(message.stage));
        for (const key of ["threadId", "performanceThreadId"]) assert.ok(Number.isSafeInteger(message[key]) && message[key] > 0);
        request.onStart(message);
      } catch (error) { pending.delete(message.id); request?.reject(error); protocolErrors.push(errorObservation(error)); }
      return;
    }
    if (message.type === "cpu-hold-start" || (message.type === "lot-probe-start" && request?.type === "TEST_ONLY_CPU_HOLD")) {
      try {
        assert.equal(message.type, "cpu-hold-start");
        assert.equal(request?.type, "TEST_ONLY_CPU_HOLD"); assert.notEqual(request.started, true);
        assert.deepEqual(Object.keys(message).sort(), ["id", "incarnation", "nonce", "performanceThreadId", "threadId", "transactionIds", "type"]);
        assert.equal(message.nonce, request.nonce);
        for (const key of ["threadId", "performanceThreadId"]) assert.ok(Number.isSafeInteger(message[key]) && message[key] > 0);
        assert.ok(Array.isArray(message.transactionIds) && message.transactionIds.length > 0);
        for (const id of message.transactionIds) { assert.equal(typeof id, "string"); assert.match(id, /^[1-9]\d*$/u); }
        assert.equal(new Set(message.transactionIds).size, message.transactionIds.length);
        request.started = true; request.onStart(message);
      } catch (error) {
        if (protocolErrors.length < 16) protocolErrors.push(errorObservation(error));
        pending.delete(message.id); request?.reject(error);
      }
      return;
    }
    if (message.type === "lot-probe-start") { request?.onStart?.(message); return; }
    if (request) {
      pending.delete(message.id);
      if (request.type === "TEST_ONLY_CPU_HOLD") try {
        assert.equal(message.nonce, request.nonce);
        if (typeof message.error !== "string") assert.equal(request.started, true, "CPU hold completion requires matching start");
      } catch (error) {
        if (protocolErrors.length < 16) protocolErrors.push(errorObservation(error));
        request.reject(error); return;
      }
      if (typeof message.error === "string") request.reject(Object.assign(new Error(message.error), { code: message.error }));
      else request.resolve(message);
    }
  });
  function call(type, values = {}, onStart) {
    assert.ok(!exit && child.connected);
    return new Promise((resolve, reject) => {
      const id = randomUUID(); pending.set(id, { resolve, reject, onStart, type, nonce: values.nonce });
      child.send({ type, id, ...values }, error => { if (error) { pending.delete(id); reject(error); } });
    });
  }
  const failed = new Promise((_resolve, reject) => { child.once("exit", () => { for (const request of pending.values()) request.reject(new Error("Owned child exited")); pending.clear(); reject(new Error("Owned child boot exited")); }); });
  Object.assign(owner, { stop });
  registerOwner?.(owner);
  async function waitExit() {
    let timer;
    try { return await Promise.race([exited, new Promise(resolve => { timer = globalThis.setTimeout(() => resolve(null), 5000); })]); }
    finally { globalThis.clearTimeout(timer); }
  }
  function stop() {
    return stopping ??= (async () => {
      const started = performance.now(), observation = { incarnation, pid: child.pid, stages: [], errors: [], gracefulReply: null };
      let finished = false;
      if (!exit) {
        const at = performance.now(), stage = { kind: "IPC_STOP", budgetMs: 5000 }; observation.stages.push(stage);
        try {
          void call("stop").then(reply => { if (!finished) observation.gracefulReply = { exitCode: Number.isInteger(reply.exitCode) ? reply.exitCode : null }; },
            error => { if (!finished) { shutdownError ??= error; observation.errors.push({ stage: "IPC_STOP", error: errorObservation(error) }); } });
        } catch (error) { shutdownError ??= error; observation.errors.push({ stage: "IPC_STOP", error: errorObservation(error) }); }
        await waitExit(); stage.elapsedMs = performance.now() - at; stage.exitObserved = !!exit;
      }
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (exit) break;
        const at = performance.now(), stage = { kind: signal, budgetMs: 5000 }; observation.stages.push(stage);
        try { stage.signalAccepted = child.kill(signal); }
        catch (error) { observation.errors.push({ stage: signal, error: errorObservation(error) }); }
        await waitExit(); stage.elapsedMs = performance.now() - at; stage.exitObserved = !!exit;
      }
      finished = true;
      return { ...observation, exit: exit ?? null, terminal: !!exit, forced: observation.stages.some(stage => stage.kind !== "IPC_STOP"),
        connections: [...connections], completeMs: performance.now() - started, protocolErrors: [...protocolErrors] };
    })();
  }
  let ready;
  try { ready = await Promise.race([call("boot", { directory, secret, incarnation, primaryLimit, ...(fixtureMode === "CS01" ? { fixtureMode } : {}) }), failed]); }
  catch (error) {
    error.ownedStop = await stop();
    error.ownedResourceHistory = { incarnation, connectionEvents, identities: [...observationIdentities.values()],
      resourceSamples: owner.resourceSamples, resourceFinal: owner.resourceFinal, mappingStats: owner.mappingStats, mappingFailures: owner.mappingFailures };
    throw error;
  }
  return Object.assign(owner, { origin: ready.origin, stop,
    cpuHold(nonce, onStart) {
      assert.match(nonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      assert.equal(typeof onStart, "function"); assert.equal(cpuHoldInvocation, undefined, "Only one fixed CPU hold per worker");
      cpuHoldInvocation = Object.freeze({ nonce, incarnation, dispatchedAt: performance.now() });
      return call("TEST_ONLY_CPU_HOLD", { incarnation, nonce }, onStart);
    },
    diagnostics: () => call("diagnostics"),
    ...(fixtureMode === "CS01" ? { async soakExportCheckpoint() {
      const value = await call("stocktake-soak-export-report");
      owner.soakObserverStatus = value.observation; return value.observation;
    } } : {}),
    resourceCheckpoint: (history = false) => call("resource-checkpoint", { history }),
    shortConnection: (nonce, onStart) => call("TEST_ONLY_SHORT_CONNECTION", { incarnation, nonce }, onStart),
    observationHold: (nonce, onStart) => call("TEST_ONLY_OBSERVATION_HOLD", { incarnation, nonce }, onStart),
    observationAbort: nonce => call("TEST_ONLY_OBSERVATION_ABORT", { incarnation, nonce }),
    lotProbe: (shape, phase, onStart) => call("lot-probe", { shape, phase }, onStart),
    lotSemantics: () => call("lot-semantics"),
    lotLock: (shape, scenario, onStage) => call("lot-lock", { shape, scenario }, onStage),
    releaseLot: targetId => call("lot-release", { targetId }),
    controlLock: scenario => call("control-lock", { scenario }),
    close() {
      return closing ??= (async () => {
        const observation = await stop();
        try {
          if (shutdownError) throw shutdownError;
          assert.equal(observation.terminal, true, "Owned child exit is unknown");
          assert.equal(observation.forced, false, "Normal workload required forced child termination");
          assert.deepEqual(observation.exit, { code: 0, signal: null });
          assert.equal(observation.gracefulReply?.exitCode, 0, "Owned graceful shutdown was not acknowledged");
          assert.deepEqual(observation.protocolErrors, []);
        } catch (error) { error.ownedStop = observation; throw error; }
      })();
    }
  });
}
export function createStocktakeObservationLane({ workers, actors, nextDispatch, request, createWorker, capture, terminal, restoreMonitor, report }) {
  const capacity = [...workers], owners = [], records = [], errors = [], clocks = nextDispatch.slice(0, 2);
  let attempted = false, owner, actor, restored = false, closing, registration, registered;
  const pending = new Set();
  const record = { role: "OBSERVATION_ONLY", state: "NOT_STARTED", errors: [], requests: [] }; records.push(record);
  const unchanged = () => {
    assert.equal(workers[0], capacity[0]); assert.equal(workers[1], capacity[1]);
    assert.ok(nextDispatch[0] >= clocks[0] && nextDispatch[1] >= clocks[1], "Capacity dispatch clocks cannot be reset");
  };
  const failed = (error, stage) => {
    errors.push(error); record.errors.push({ stage, error: errorObservation(error) }); record.state = "FAIL";
    for (const w of new Set([...workers, ...owners])) w.quarantined = true;
  };
  const dispatch = async (...args) => {
    assert.equal(record.state, "ACTIVE", "Observation requests require a healthy ready owner");
    assert.equal(workers[2], owner); const first = report.requests.length;
    const work = request(actor, ...args); pending.add(work);
    try { return await work; }
    catch (error) { failed(error, "request"); throw error; }
    finally { pending.delete(work); for (const row of report.requests.slice(first)) if (row.worker === 2) {
      row.role = "OBSERVATION_ONLY"; row.incarnation = owner.incarnation;
      record.requests.push({ requestId: row.requestId ?? null, action: row.action ?? null, outcome: row.outcome ?? null });
    } }
  };
  return {
    get owner() { return owner; }, get actor() { return actor; }, get owners() { return owners; },
    get records() { return records; }, get restored() { return restored; }, request: dispatch,
    async open() {
      assert.equal(attempted, false, "Observation owner may only be created once"); attempted = true;
      registration = new Promise(resolve => { registered = resolve; });
      try {
        unchanged(); assert.equal(workers.length, 2); assert.equal(nextDispatch.length, 2); record.state = "CREATING";
        const ready = await createWorker(handle => {
          assert.equal(owners.length, 0); owner = handle; owner.role = "OBSERVATION_ONLY"; owners.push(owner);
          record.incarnation = owner.incarnation; record.createdAt = performance.now();
          registered();
        });
        assert.equal(record.state, "CREATING", "A closing or failed owner cannot become ready");
        assert.equal(closing, undefined, "A closing owner cannot become ready");
        assert.equal(ready, owner, "Ready must be the pre-registered actual owner"); assert.equal(owners.length, 1);
        unchanged(); assert.equal(workers.length, 2);
        const original = actors.find(value => value.worker === 1 && !value.writer); assert.ok(original);
        actor = { ...original, worker: 2 }; workers.push(owner); nextDispatch.push(0);
        record.readyAt = performance.now(); record.state = "ACTIVE"; return owner;
      } catch (error) { registered(); failed(error, "open"); throw error; }
    },
    async refresh() {
      const value = await dispatch("/api/v1/user/token/refresh", {}, true);
      actor.token = value.token; actor.expiresAt = Date.now() + value.expiresInSeconds * 1000;
      return value;
    },
    close() {
      if (closing) return closing;
      record.state = "CLOSING";
      return closing ??= (async () => {
        const observation = { workers: [] };
        const check = async (stage, work) => { try { return await work(); } catch (error) { failed(error, stage); } };
        if (!owner) await registration;
        assert.ok(owner, "Missing pre-registered observation owner"); record.closeStartedAt = performance.now();
        await Promise.allSettled([...pending]);
        await check("capture", () => capture([...new Set([...workers, ...owners])], observation));
        await check("close", () => owner.close());
        const stop = await check("stop", () => owner.stop());
        await check("terminal", async () => {
          const own = observation.workers.find(value => value.incarnation === owner.incarnation); assert.ok(own);
          await terminal(owner, stop, own); assert.equal(own.status, "SQL_TERMINAL_CONFIRMED"); record.terminal = own;
        });
        await check("normal-stop", () => {
          assert.equal(stop?.terminal, true); assert.equal(stop.forced, false);
          assert.deepEqual(stop.exit, { code: 0, signal: null }); assert.equal(stop.gracefulReply?.exitCode, 0);
          assert.deepEqual(stop.protocolErrors, []); record.stop = stop;
          const physical = owner.resourceFinal; assert.ok(physical); assert.equal(physical.incarnation, owner.incarnation);
          assert.equal(physical.activeTransports, 0); assert.deepEqual(physical.errors, []);
          assert.equal(physical.pools.length, 1); assert.equal(physical.pools[0].kind, "PRIMARY"); assert.equal(physical.pools[0].configuredLimit, 1);
          assert.ok(physical.transports.length > 0);
          assert.ok(physical.transports.every(socket => socket.kind === "PRIMARY" && Number.isFinite(socket.closedAtMs) && socket.mappingObservation === "SAME_CONNECTION_DRIVER_QUERY_ACKNOWLEDGED"));
          assert.deepEqual(physical.transports.map(socket => socket.threadId).sort((a, b) => a - b), [...owner.connections].sort((a, b) => a - b));
          record.resources = physical;
        });
        if (!errors.length) await check("restore", async () => {
          unchanged(); assert.equal(workers.length, 3); assert.equal(workers[2], owner); assert.equal(nextDispatch.length, 3);
          workers.pop(); nextDispatch.pop(); await restoreMonitor(workers); unchanged(); restored = true;
          record.retiredAt = performance.now(); record.state = "RETIRED";
        });
        if (errors.length) throw new AggregateError(errors, "Observation lane failed; original and cleanup errors retained", { cause: errors[0] });
      })();
    }
  };
}

function assertCpuRecoveryWatchdog(owner, row, error, route) {
  assert.equal(error?.code, "TEST_HTTP_WATCHDOG_TIMEOUT");
  assert.equal(owner.quarantined, true);
  assert.equal(row.workerIncarnation, owner.incarnation);
  assert.equal(row.action, route);
  assert.equal(row.budgetMs, 30000);
  assert.equal(row.status, null);
  assert.equal(row.outcome, "FAIL");
  assert.equal(row.resultObservation, "UNKNOWN");
  assert.ok(Number.isFinite(row.dispatchAt));
  assert.ok(row.completeMs >= 30000, "CP13 requires the actual parent watchdog, not an early transport failure");
  assert.ok(row.errorObservation.codes.includes("TEST_HTTP_WATCHDOG_TIMEOUT"));
}

function cpuRecoveryJwtExpiry(token) {
  assert.ok(typeof token === "string", "Fresh CPU-recovery JWT must be a string");
  const parts = token.split(".");
  assert.ok(parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/u.test(part)), "Fresh CPU-recovery JWT shape is invalid");
  let claims;
  try {
    const payload = Buffer.from(parts[1], "base64url");
    assert.ok(payload.toString("base64url") === parts[1], "Fresh CPU-recovery JWT payload encoding is invalid");
    claims = JSON.parse(payload.toString("utf8"));
  } catch { throw new Error("Fresh CPU-recovery JWT payload is invalid"); }
  assert.ok(claims && typeof claims === "object" && !Array.isArray(claims) && Number.isSafeInteger(claims.exp) && claims.exp > 0,
    "Fresh CPU-recovery JWT.exp is invalid");
  const expiresAt = claims.exp * 1000;
  assert.ok(Number.isSafeInteger(expiresAt), "Fresh CPU-recovery JWT expiry is outside the safe range");
  return expiresAt;
}

export async function verifyCpuHoldRecovery(fixture) {
  assert.ok(fixture);
  const { db, workers, actors, report, request } = fixture;
  const observation = { kind: "TEST_ONLY_CPU_HOLD_RECOVERY_NOT_PRODUCT_SLA", outcome: "IN_PROGRESS", cleanupErrors: [] };
  report.cpuHoldRecovery = observation;
  const w = workers[1], other = actors.find(actor => actor.worker === 0 && !actor.writer);
  const actor = actors.find(actor => actor.worker === 1 && !actor.writer);
  let primary, injected = false, holdResult, stop, captured;
  const failed = (stage, error) => {
    if (!primary) primary = error;
    else observation.cleanupErrors.push({ stage, error: errorObservation(error) });
    observation[`${stage}Error`] = errorObservation(error);
  };
  try {
    requireObservationLifecycle(fixture);
    assert.equal(fixture.normalWorkloadsReconciled, true);
    assert.equal(fixture.characterizationCases.get("CP08"), true);
    for (const prerequisite of ["controlLockVerified", "lotQueryCompared", "lotSemanticsVerified", "lotSafetyVerified", "lotLockSafetyCompared"])
      assert.equal(fixture[prerequisite], true, `${prerequisite} must complete before the fixed CPU fault`);
    for (const prerequisite of ["CP02", "CP06", "CP07"]) assert.equal(fixture.characterizationCases.get(prerequisite), true);
    const cp07 = report.cp07Completion;
    assert.equal(cp07?.caseAssertions, "COMPLETE", "CP07 must pass every actual testcase assertion before CPU fault dispatch");
    assert.equal(cp07.outcome, "COMPLETE"); assert.equal(cp07.resourceCoverage, "COMPLETE");
    assert.equal(cp07.poolOneSqlTerminal, "SQL_TERMINAL_CONFIRMED");
    assert.equal(cp07.poolOneStop.terminal, true); assert.equal(cp07.poolOneStop.forced, false);
    assert.deepEqual(cp07.poolOneStop.exit, { code: 0, signal: null });
    assert.equal(report.businessCleanup?.outcome, "COMPLETE", "CP08 normal business cleanup must finish before retiring worker1");
    assert.equal(workers.length, 2); assert.ok(w && other && actor);
    assert.equal(w.cpuHoldInvocation, undefined, "Only one preregistered CPU fault may receive this exception");
    assert.equal(report.requests.some(row => row.completeMs === null), false);
    const owners = [...new Set([...workers, ...(fixture.observationLane?.owners ?? [])])];
    const capture = { workers: [] };
    await captureOwnedSql(db, owners, capture);
    captured = capture.workers.find(value => value.incarnation === w.incarnation); assert.ok(captured);
    observation.before = await inventoryState(db);
    const originalTables = ["inventory_allocations", "inventory_audit_logs", "inventory_bin_locks", "inventory_bins", "inventory_lots",
      "inventory_movements", "inventory_operation_requests", "inventory_reservations", "inventory_stock_balances", "inventory_stock_controls",
      "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_stocktakes", "inventory_transfer_lines", "inventory_transfers", "inventory_warehouses"];
    for (const table of originalTables) assert.ok(observation.before[table], `CP13 must hash every original Inventory table: ${table}`);
    assert.ok(observation.before.inventory_purchase_reversal_links, "Merged main reversal links must also participate in complete rowhash equality");
    observation.tableCount = Object.keys(observation.before).length;
    const refreshStart = report.requests.length;
    const login = await request(actor, "/api/v1/user/token/refresh", {}, true);
    const tokenExpiresAt = cpuRecoveryJwtExpiry(login.token);
    actor.token = login.token; actor.expiresAt = tokenExpiresAt;
    assert.equal(login.expiresInSeconds, 900);
    assert.equal(report.requests.length, refreshStart + 1, "Preflight refresh is one real signed request, not relogin");
    const [[sku]] = await db.query("SELECT sku_code FROM item_skus WHERE id=1");
    const route = "/api/v1/inventory/sku-lookup?code=" + encodeURIComponent(sku.sku_code);
    const baselineIndex = report.requests.length; await request(actor, route);
    assert.equal(report.requests.length, baselineIndex + 1);
    assert.equal(report.requests[baselineIndex].outcome, "COMPLETE");
    assert.equal(report.requests[baselineIndex].workerIncarnation, w.incarnation);
    assert.ok(actor.token === login.token, "Baseline GET must verify the exact fresh JWT used for the CPU fault");
    assert.ok(tokenExpiresAt - Date.now() >= 210000, "Actual JWT.exp must remain safe throughout fixed hold/watchdog/stop; no post-hold refresh");
    const started = Promise.withResolvers(), nonce = randomUUID();
    observation.incarnation = w.incarnation; observation.nonce = nonce;
    injected = true;
    const hold = w.cpuHold(nonce, identity => {
      observation.start = { ...identity, receivedAt: performance.now() }; started.resolve(observation.start);
    });
    void hold.then(value => { holdResult = { status: "FULFILLED", value, observedAt: performance.now() }; },
      error => { holdResult = { status: "REJECTED", error: errorObservation(error), observedAt: performance.now() }; });
    const invocation = w.cpuHoldInvocation; assert.ok(invocation);
    observation.invocation = invocation;
    const identity = await withinObservation(Promise.race([started.promise, hold.then(() => { throw new Error("CPU hold completed before its matching identity"); })]), invocation.dispatchedAt + 20000);
    assert.equal(identity.incarnation, w.incarnation); assert.equal(identity.nonce, nonce);
    assert.equal(w.connections.has(identity.threadId), true);
    const deadline = identity.receivedAt + 5000;
    const state = await lotProbeState(db, identity, new Set(), deadline);
    assert.equal(state.terminal, false, "Actual CPU holder must still own active SQL locks");
    const [locks] = await lotMonitorRead(db, `SELECT ENGINE,CAST(ENGINE_TRANSACTION_ID AS CHAR) AS token,LOCK_DATA FROM performance_schema.data_locks
      WHERE THREAD_ID=? AND OBJECT_SCHEMA=DATABASE() AND OBJECT_NAME='inventory_warehouses'
      AND INDEX_NAME='PRIMARY' AND LOCK_TYPE='RECORD' AND LOCK_STATUS='GRANTED' AND LOCK_DATA='5'`, [identity.performanceThreadId], deadline);
    assert.ok(locks.length > 0, "Observe actual fixed warehouse5 lock before dispatching the blocked GET");
    assert.ok(locks.every(lock => lock.ENGINE === "INNODB" && identity.transactionIds.includes(lock.token)));
    observation.lock = { ...state, warehouseRecordLocks: locks };
    const requestIndex = report.requests.length; let requestError;
    try { await request(actor, route); } catch (error) { requestError = error; }
    observation.watchdog = report.requests[requestIndex];
    if (requestError) observation.originalWatchdogError = errorObservation(requestError);
    try {
      assert.equal(report.requests.length, requestIndex + 1, "Fixed CPU fault must dispatch one GET with no implicit token refresh");
      assertCpuRecoveryWatchdog(w, observation.watchdog, requestError, route);
    } catch (mismatch) {
      if (requestError) { requestError.cpuRecoveryMismatch = errorObservation(mismatch); throw requestError; }
      throw mismatch;
    }
    observation.rejectedAfterUnknown = [];
    for (const [path, body, signed] of [[route, undefined, false], ["/api/v1/user/token/refresh", {}, true]]) {
      const index = report.requests.length;
      await assert.rejects(() => request(actor, path, body, signed), { code: "TEST_WORKER_QUARANTINED" });
      assert.equal(report.requests.length, index + 1);
      const rejected = report.requests[index]; assert.equal(rejected.outcome, "NOT_SENT"); assert.equal(rejected.dispatchAt, null);
      observation.rejectedAfterUnknown.push(rejected);
    }
  } catch (error) { failed("primary", error); }
  if (injected) {
    w.quarantined = true;
    try {
      stop = await w.stop(); observation.stop = stop; observation.stopObservedAt = performance.now();
      assert.equal(stop.incarnation, w.incarnation); assert.equal(stop.terminal, true); assert.equal(stop.forced, true);
      assert.ok(["SIGTERM", "SIGKILL"].includes(stop.exit?.signal)); assert.deepEqual(stop.protocolErrors, []);
      assert.ok(observation.stopObservedAt < w.cpuHoldInvocation.dispatchedAt + 60000,
        "Forced actual exit must precede even the conservative dispatch+60s natural-hold boundary");
      assert.equal(holdResult?.status, "REJECTED", "Actual child exit must settle its fixed CPU command; natural completion is not recovery");
      observation.holdCompletion = holdResult;
    } catch (error) { failed("stop", error); }
    try {
      assert.ok(captured);
      // Every entry originates in actual driver/monitor live mapping, including identities
      // learned after the preflight capture; never fabricate a missing mapping from zero.
      captured.connections = [...w.observationIdentities.values()];
      await verifyOwnedSqlTerminal(db, w, stop, captured);
      assert.equal(captured.status, "SQL_TERMINAL_CONFIRMED"); observation.terminal = captured;
    } catch (error) { failed("terminal", error); }
    if (!primary) try {
      const [[sku]] = await db.query("SELECT sku_code FROM item_skus WHERE id=1");
      const route = "/api/v1/inventory/sku-lookup?code=" + encodeURIComponent(sku.sku_code), index = report.requests.length;
      await request(other, route);
      const healthy = report.requests.slice(index).filter(row => row.action === route);
      assert.equal(healthy.length, 1); assert.equal(healthy[0].status, 200); assert.equal(healthy[0].outcome, "COMPLETE");
      assert.equal(healthy[0].workerIncarnation, workers[0].incarnation); observation.healthyWorker = healthy[0];
      observation.after = await inventoryState(db);
      assert.deepEqual(observation.after, observation.before, "Complete original16 plus every merged Inventory table must retain identical full rowhashes");
    } catch (error) { failed("recovery", error); }
  }
  if (primary) {
    for (const owner of workers) owner.quarantined = true;
    observation.outcome = "FAIL"; observation.error = errorObservation(primary);
    primary.cpuRecoveryErrors = observation.cleanupErrors; throw primary;
  }
  observation.outcome = "EXPECTED_TEST_INJECTED_RECOVERY";
  cpuRecoveryRetirements.set(w, observation);
  fixture.characterizationCases.set("CP13", true);
  return observation;
}

export async function createPerformanceFixture({ mode = "CHARACTERIZATION", cs01Journal = null } = {}) {
  assert.ok(["CHARACTERIZATION", "CS01"].includes(mode));
  const options = databaseOptions(), db = await mysql.createConnection(options), workers = [], report = {
    kind: "DEVELOPER_CHARACTERIZATION", performanceAcceptance: "NOT_EVALUATED_PENDING_APPROVED_NUMERIC_GATE", task041: "IN_PROGRESS", p4: "NOT_READY", requests: [], cleanup: "NOT_STARTED"
  };
  const root = await fs.realpath(process.env.TMPDIR), runDir = process.env.HARNESS_RUN_DIR;
  assert.ok(runDir && path.isAbsolute(runDir));
  if (mode === "CS01" && cs01Journal) report.cs01ProgressJournal = cs01Journal.stats;
  const reservations = [], nextDispatch = [0, 0], stocktakeCommands = new Map(), reservationCommands = new Map();
  let actors = [], result, closingFixture, stoppingWorkers, setupError, businessBaseline, businessCleanup, poolOneUsed = false, observationLane;
  const ownedWorkers = () => [...new Set([...workers, ...(observationLane?.owners ?? [])])];
  async function request(actor, route, body, signed = false) {
    const ownedWorker = workers[actor.worker], intendedAt = performance.now(), key = randomUUID();
    const budgetMs = /^\/api\/v1\/inventory\/stocktakes\/\d+\/export(?:\?|$)/u.test(route) ? 120000 : 30000;
    const row = { actor: actor.id, worker: actor.worker, workerIncarnation: ownedWorker.incarnation,
      action: route.replace(/\/\d+(?=\/|\?|$)/gu, "/:id"), requestId: randomUUID(), budgetMs,
      status: null, code: null, intendedAt, dispatchAt: null, schedulerLatenessMs: null,
      firstByteMs: null, completeMs: null, keyHash: sha(key), outcome: "NOT_SENT",
      requestIdEcho: null, requestIdEchoObservation: "NOT_OBSERVED", resultObservation: "NOT_SENT" };
    report.requests.push(row);
    let timer, response, value, consumed = false, settled = false;
    const controller = new AbortController();
    try {
      if (ownedWorker.quarantined) throw Object.assign(new Error("Worker result is unknown"), { code: "TEST_WORKER_QUARANTINED" });
      if (actor.token && route !== "/api/v1/user/token/refresh" && Date.now() >= actor.expiresAt - 120000) {
        const refresh = await request(actor, "/api/v1/user/token/refresh", {}, true);
        actor.token = refresh.token; actor.expiresAt = Date.now() + refresh.expiresInSeconds * 1000;
      }
      const at = Math.max(performance.now(), nextDispatch[actor.worker]);
      nextDispatch[actor.worker] = at + 125;
      if (at > performance.now()) await setTimeout(at - performance.now());
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      const headers = { "Content-Type": "application/json", ...(actor.token ? { Authorization: `Bearer ${actor.token}` } : {}), "Idempotency-Key": key,
        ...(signed ? await actor.device.headers({ method: body === undefined ? "GET" : "POST", path: route, body: encoded, token: actor.token }) : {}),
        "X-Request-ID": row.requestId };
      // Another offered request may have quarantined this worker during refresh/signing/throttling.
      if (ownedWorker.quarantined) throw Object.assign(new Error("Worker result is unknown"), { code: "TEST_WORKER_QUARANTINED" });
      row.dispatchAt = performance.now(); row.schedulerLatenessMs = row.dispatchAt - intendedAt;
      const timeout = Object.assign(new Error("Parent HTTP watchdog expired"), { code: "TEST_HTTP_WATCHDOG_TIMEOUT" });
      const deadline = new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => { controller.abort(timeout); reject(timeout); }, budgetMs);
      });
      const transport = async () => {
        response = await fetch(ownedWorker.origin + route, { method: body === undefined ? "GET" : "POST", headers, body: encoded, signal: controller.signal });
        if (settled || controller.signal.aborted) throw timeout;
        row.status = response.status; row.firstByteMs = performance.now() - row.dispatchAt;
        if (response.headers.get("x-request-id") === row.requestId) {
          row.requestIdEcho = row.requestId; row.requestIdEchoObservation = "MATCHED";
        }
        const csv = budgetMs === 120000 && /^text\/csv(?:;|$)/iu.test(response.headers.get("content-type") ?? "");
        const data = csv ? await response.text() : await response.json();
        if (performance.now() - row.dispatchAt >= budgetMs) { controller.abort(timeout); throw timeout; }
        return csv ? { data } : data;
      };
      value = await Promise.race([transport(), deadline]); consumed = true;
      globalThis.clearTimeout(timer); timer = undefined;
      row.code = value.error?.code ?? null; row.resultObservation = "HTTP_RESPONSE_CONSUMED";
      if (response.status >= 500) {
        report.databaseDiagnostics ??= [];
        let diagnosticTimer;
        try {
          const remaining = Math.max(1, budgetMs - (performance.now() - row.dispatchAt));
          const diagnostics = await Promise.race([ownedWorker.diagnostics(), new Promise((_, reject) => {
            diagnosticTimer = globalThis.setTimeout(() => reject(Object.assign(new Error("Diagnostics deadline"), { code: "TEST_DIAGNOSTICS_TIMEOUT" })), remaining);
          })]);
          report.databaseDiagnostics.push({ requestId: row.requestId, worker: actor.worker,
            requestMatched: diagnostics.failures.some(failure => failure.requestId === row.requestId), ...diagnostics });
        } catch (error) { report.databaseDiagnostics.push({ requestId: row.requestId, worker: actor.worker, retrievalError: errorObservation(error) }); }
        finally { globalThis.clearTimeout(diagnosticTimer); }
      }
      assert.equal(response.status, 200, `Real HTTP ${route}: ${response.status} ${value.error?.code ?? "UNKNOWN"}`);
      row.outcome = "COMPLETE";
      return value.data;
    } catch (error) {
      row.outcome = row.dispatchAt === null ? "NOT_SENT" : "FAIL";
      row.errorObservation = errorObservation(error);
      if (row.dispatchAt !== null && !consumed) {
        row.resultObservation = "UNKNOWN"; ownedWorker.quarantined = true;
      }
      throw error;
    } finally {
      settled = true;
      globalThis.clearTimeout(timer);
      row.completeMs = performance.now() - (row.dispatchAt ?? intendedAt);
    }
  }
  async function stopWorkers() {
    return stoppingWorkers ??= (async () => {
      let primary;
      const owned = ownedWorkers();
      report.workerCleanupErrors = []; report.ownedStops = setupError?.ownedStop ? [setupError.ownedStop] : [];
      report.ownedSql = { status: "IN_PROGRESS", workers: [] };
      for (const w of owned) w.quarantined = true;
      const failed = (stage, error) => {
        primary ??= error; report.workerCleanupErrors.push({ stage, error: errorObservation(error), ownedStop: error.ownedStop ?? null });
      };
      for (const [index, w] of owned.entries()) {
        const capture = { workers: [] };
        try { await captureOwnedSql(db, [w], capture); }
        catch (error) { failed(`worker-${index}-sql-identities`, error); }
        finally { report.ownedSql.workers.push(...capture.workers); observationOwners.set(db, owned); }
      }
      for (const [index, w] of owned.entries()) {
        const expectedCpuRecovery = cpuRecoveryRetirements.get(w);
        try {
          if (expectedCpuRecovery) {
            assert.equal(expectedCpuRecovery.outcome, "EXPECTED_TEST_INJECTED_RECOVERY");
            assert.equal(expectedCpuRecovery.incarnation, w.incarnation);
            assert.equal(expectedCpuRecovery.terminal.status, "SQL_TERMINAL_CONFIRMED");
          } else await w.close();
        } catch (error) { failed(`worker-${index}-close`, error); }
        try {
          const observation = expectedCpuRecovery?.stop ?? await w.stop(); report.ownedStops.push(observation);
          assert.equal(observation.terminal, true, "Owned child exit remains unknown");
        } catch (error) { failed(`worker-${index}-stop`, error); }
      }
      for (const [index, w] of owned.entries()) {
        try {
          const capture = report.ownedSql.workers.find(row => row.incarnation === w.incarnation);
          const stop = report.ownedStops.find(row => row.incarnation === w.incarnation);
          await verifyOwnedSqlTerminal(db, w, stop, capture);
        } catch (error) { failed(`worker-${index}-sql-terminal`, error); }
      }
      report.ownedSql.status = !setupError?.ownedStop && report.ownedStops.length === owned.length &&
        report.ownedSql.workers.length === owned.length && report.ownedSql.workers.every(row => row.status === "SQL_TERMINAL_CONFIRMED") ? "SQL_TERMINAL_CONFIRMED" : "SQL_TERMINAL_UNKNOWN";
      observationOwners.set(db, workers);
      if (primary) { primary.ownedCleanupErrors = report.workerCleanupErrors; throw primary; }
      assert.equal(report.ownedSql.status, "SQL_TERMINAL_CONFIRMED", "Owned SQL terminal remains unknown");
      return report.ownedSql;
    })();
  }
  async function reconcileBusinessCleanup() {
    if (mode === "CS01") {
      assert.equal(typeof result?.reconcileBusinessCleanup, "function", "CS01 setup has no initialized cleanup route");
      return result.reconcileBusinessCleanup();
    }
    return businessCleanup ??= (async () => {
      const current = { db, workers, actors, reservations, stocktakeCommands, reservationCommands,
        exportAuditRequests: result?.exportAuditRequests ?? new Map(), exportAuditEvidence: result?.exportAuditEvidence ?? new Map(),
        businessBaseline, report, stocktakeFlowPins: result?.stocktakeFlowPins ?? new Map(), balanceEffects: result?.balanceEffects ?? new Map() };
      let primary;
      const failures = [];
      const failed = (stage, error) => { primary ??= error; failures.push({ stage, error: errorObservation(error) }); };
      const healthy = () => {
        if (workers.some(worker => worker.quarantined) || stoppingWorkers) {
          failed("unsafe-business-cleanup", new Error("Unknown requests or stopped workers forbid cleanup business writes"));
          primary.businessCleanupErrors = failures; throw primary;
        }
      };
      const check = async (stage, work) => { try { await work(); } catch (error) { failed(stage, error); } healthy(); };
      healthy();
      const who = actors.find(actor => actor.writer);
      if (actors.length) {
        const [owned] = await db.query("SELECT id,status,version FROM inventory_stocktakes WHERE created_by IN (?) ORDER BY id", [actors.map(actor => actor.id)]);
        for (const header of owned) if (!["POSTED", "CANCELLED"].includes(header.status)) await check(`stocktake-${header.id}`, async () => {
          healthy();
          const body = { source: source(), expectedVersion: Number(header.version), reason: "Owned test cleanup", password: who.password };
          const dispatchIndex = report.requests.length, route = `/api/v1/inventory/stocktakes/${header.id}/cancel`;
          const cancelled = await request(who, route, body), requestId = commandRequestId(report, dispatchIndex, who.id, route);
          stocktakeCommands.set(cancelled.operationId, { action: "cancel", body: { ...body, password: undefined }, result: cancelled, actorId: who.id, requestId, beforeStatus: header.status });
          const beforeReplay = await stocktakeCleanupHistory(current, Number(header.id));
          healthy(); assert.deepEqual(await request(who, route, body), cancelled);
          assert.deepEqual(await stocktakeCleanupHistory(current, Number(header.id)), beforeReplay, "Cancel replay changed Stocktake/scope Balance/Control history");
          await verifyStocktakeCommands(current, Number(header.id));
          const [locks] = await db.execute("SELECT * FROM inventory_bin_locks WHERE stocktake_id=? ORDER BY id LIMIT 201", [header.id]);
          for (const lock of locks) {
            assert.ok(lock.released_at !== null); assert.equal(Number(lock.released_by), who.id); assert.equal(lock.release_reason, "CANCELLED");
          }
        });
      }
      for (const reservation of reservations) await check(`reservation-${reservation.id}`, async () => {
        healthy();
        const body = { source: source(), version: reservation.version }, route = `/api/v1/inventory/reservations/${reservation.id}/cancel`;
        const dispatchIndex = report.requests.length;
        const cancelled = await request(who, route, body), requestId = commandRequestId(report, dispatchIndex, who.id, route);
        reservationCommands.set(cancelled.operationId, { action: "cancel", body, result: cancelled, actorId: who.id, requestId });
        const created = [...reservationCommands.values()].find(record => record.action === "create" && record.result.id === reservation.id);
        assert.ok(created); assertReservationIntent(cancelled, created, true);
        const beforeReplay = await reservationHistory(current, created);
        healthy(); assert.deepEqual(await request(who, route, body), cancelled);
        assert.deepEqual(await reservationHistory(current, created), beforeReplay, "Cancel replay changed Reservation/control/balance history");
      });
      if (businessBaseline) await check("final-business-reconciliation", () => verifyBusinessReconciliation(current, true));
      if (primary) { primary.businessCleanupErrors = failures; throw primary; }
      if (businessBaseline) report.businessCleanup = { outcome: "COMPLETE", reservations: reservations.length, originalSourceReplayVerified: true };
    })();
  }
  async function close() {
    return closingFixture ??= (async () => {
      let primary;
      if (mode === "CS01") { cs01Journal?.checkpoint("CLOSE", "START", { originalError: setupError }); await cs01Journal?.flush(); }
      report.cleanup = "IN_PROGRESS"; report.cleanupErrors = [];
      const failed = (stage, error) => {
        if (result) { result.observationLifecycleVerified = false; result.shortConnectionVerified = false; }
        if (mode !== "CS01") for (const w of ownedWorkers()) w.quarantined = true;
        primary ??= error;
        report.cleanupErrors.push({ stage, error: errorObservation(error), ownedStop: error.ownedStop ?? null });
      };
      if (setupError) failed("fixture-setup", setupError);
      if (!stoppingWorkers) try {
        assert.notEqual(setupError?.ownedStop?.terminal, false, "Unknown boot child exit forbids cleanup business writes");
        const retiredCpuOwners = workers.filter(w => cpuRecoveryRetirements.has(w));
        if (retiredCpuOwners.length) {
          assert.deepEqual(retiredCpuOwners, [workers[1]], "Only the one verified CP13 worker1 may skip repeated shutdown");
          assert.equal(result.normalWorkloadsReconciled, true);
          assert.equal(report.businessCleanup?.outcome, "COMPLETE", "Do not perform new cleanup writes after the CPU fault");
        }
        assert.equal(workers.some(w => w.quarantined && !cpuRecoveryRetirements.has(w)) || !!stoppingWorkers, false, "Unknown request or stopped workers forbid cleanup business writes");
        await reconcileBusinessCleanup();
      } catch (error) { failed("business-cleanup", error); }
      try { await stopWorkers(); } catch (error) { failed("owned-workers", error); }
      if (report.ownedSql.status === "SQL_TERMINAL_CONFIRMED") report.cleanup = "CHILD_EXIT_AND_SQL_TERMINAL_CONFIRMED";
      const owned = ownedWorkers();
      report.stderr = owned.map(w => w.stderr);
      report.connectionMapping = { scope: "TEST_ONLY_PRE_TRANSACTION_MAPPING_SQL_AND_IPC_NOT_UNINSTRUMENTED_PRODUCTION_SLA",
        workers: owned.map(w => ({ role: w.role ?? "CAPACITY", incarnation: w.incarnation, metrics: w.mappingStats, failures: w.mappingFailures,
          identities: [...w.observationIdentities.values()] })) };
      report.transactionObservations = owned.map(w => ({ role: w.role ?? "CAPACITY", incarnation: w.incarnation, observations: [...(w.transactionObservations?.values() ?? [])] }));
      report.resources = owned.map(w => ({ role: w.role ?? "CAPACITY", incarnation: w.incarnation, samples: w.resourceSamples, final: w.resourceFinal }));
      try { await db.end(); } catch (error) { failed("monitor-close", error); }
      if (primary || report.cleanup === "IN_PROGRESS") report.cleanup = "FAILED_OR_UNKNOWN";
      try { await fs.writeFile(path.join(runDir, mode === "CS01" ? "stocktake-resource-soak.json" : "stocktake-characterization.json"), JSON.stringify(report)); }
      catch (error) { failed("report-write", error); report.cleanup = "FAILED_OR_UNKNOWN"; }
      if (mode === "CS01") cs01Journal?.checkpoint("CLOSE", "END", { originalError: primary });
      if (primary) { primary.cleanupErrors = report.cleanupErrors; throw primary; }
    })();
  }
  try {
    const normalized = validateApplicationConfiguration(workerConfiguration(root, randomBytes(32).toString("hex")));
    assert.equal(normalized.customer.attachment, null);
    const [[actual]] = await db.query("SELECT VERSION() AS version,@@skip_networking AS isolated,DATABASE() AS name");
    assert.deepEqual([actual.version, Number(actual.isolated), actual.name], ["26.7.0", 1, options.database]);
    const names = (await fs.readdir(new URL("../database/migrations/", import.meta.url))).filter(name => /\.(?:js|sql)$/u.test(name)).map(name => "migrations/" + name);
    assert.deepEqual((await db.query("SELECT name FROM fr_schema_migrations ORDER BY name"))[0].map(row => row.name), [...names, "framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"].sort());
    actors = await seedActors(db);
    const secret = randomBytes(32).toString("hex");
    for (let index = 0; index < 2; index++) workers.push(await worker(root, secret, workers, 10, undefined, mode));
    observationOwners.set(db, workers);
    await captureOwnedSql(db, workers, { workers: [] });
    await seedCapacity(db, actors[0].id, report);
    if (mode === "CS01") {
      const verified = await verifyStocktakeSoakSeedCapacity(db, { ...report.seed.intent, marker: report.seed.marker });
      report.baselineVerificationMs = verified.verificationMs;
      report.counts = { warehouses: 5, bins: 1000, skus: 100000, buckets: 500000, movements: 2000000, controls: 250000, operations: 500000, audits: 500000 };
      report.businessBaseline = verified;
      result = { db, workers, actors, reservations, counts: report.counts, report, request, stopWorkers, close,
        stocktakeCommands, reservationCommands, businessBaseline: verified, cs01Journal };
      return await createStocktakeSoakFixture(result, verified);
    }
    const baseline = await counts(db); report.counts = baseline;
    const baselineStarted = performance.now();
    await verifySeedIntent(db, report.seed.intent);
    businessBaseline = await businessState(db);
    report.baselineVerificationMs = performance.now() - baselineStarted;
    report.businessBaseline = businessBaseline;
    for (const actor of actors) {
      const login = await request(actor, "/api/v1/user/login", { username: actor.username, password: actor.password }, true);
      actor.token = login.token;
      assert.equal(login.expiresInSeconds, 900);
      actor.expiresAt = Date.now() + login.expiresInSeconds * 1000;
      assert.deepEqual([...login.user.permissions].sort(), (actor.writer ? ["inventory.adjust", "inventory.operation", "inventory.view"] : ["inventory.view"]).sort());
      await setTimeout(126);
    }
    for (let warehouseId = 1; warehouseId <= 5; warehouseId++) for (const skuId of [1, 3, 4]) {
      const body = { source: source(), warehouseId, skuId, quantity: 1, purpose: "SALE", minimumRemainingDays: 0 }, who = actors.find(a => a.writer);
      const dispatchIndex = report.requests.length, route = "/api/v1/inventory/reservations/create";
      const reservation = await request(who, route, body);
      const requestId = commandRequestId(report, dispatchIndex, who.id, route);
      const record = { action: "create", body, result: reservation, actorId: who.id, requestId };
      assertReservationIntent(reservation, record); reservationCommands.set(reservation.operationId, record);
      assert.deepEqual([reservation.status, reservation.outstandingQuantity, reservation.version], ["ACTIVE", 1, 1]);
      reservations.push(reservation); await setTimeout(126);
    }
    result = { db, workers, actors, reservations, counts: baseline, report, request, stopWorkers, close, reconcileBusinessCleanup,
      stocktakeCommands, reservationCommands, businessBaseline, stocktakeFlowPins: new Map(), balanceEffects: new Map(),
      exportAuditRequests: new Map(), exportAuditEvidence: new Map(), characterizationCases: new Map(),
      async createPoolOneWorker() {
        assert.equal(poolOneUsed, false, "Only the approved serial primary-pool-one child may be created"); poolOneUsed = true;
        return worker(root, secret, [], 1);
      },
      async reserveReadDispatch(index) {
        const at = Math.max(performance.now(), nextDispatch[index]); nextDispatch[index] = at + 125;
        if (at > performance.now()) await setTimeout(at - performance.now());
      } };
    observationLane = createStocktakeObservationLane({ workers, actors, nextDispatch, request, report,
      createWorker: register => worker(root, secret, ownedWorkers(), 1, register),
      capture: (owned, observation) => captureOwnedSql(db, owned, observation),
      terminal: (owner, stop, capture) => verifyOwnedSqlTerminal(db, owner, stop, capture),
      restoreMonitor: active => observationOwners.set(db, active) });
    result.observationLane = observationLane; report.observationOwners = observationLane.records;
    await verifyBusinessReconciliation(result);
    return result;
  } catch (error) {
    setupError = error;
    try { await close(); } catch (cleanupError) { error.fixtureCleanup = { error: errorObservation(cleanupError), errors: report.cleanupErrors }; }
    throw error;
  }
}

const characterizationQueryFamilies = ["CODE_EXACT", "BARCODE_EXACT", "SKU_STOCK_SUMMARY", "BIN_DRILL_DOWN", "FEFO_FIFO_CANDIDATES", "MOVEMENT_FILTERS"];
function characterizationDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
async function characterizationQueryCases(fixture) {
  if (fixture.queryCases) return fixture.queryCases;
  const { db, actors, reservations } = fixture;
  assert.equal(actors.length, 20); assert.equal(reservations.length, 15);
  assert.equal(actors.filter(actor => actor.writer).length, 6);
  const [skus] = await db.query(`SELECT s.id,s.sku_code,s.sku_name,s.tracking_policy,u.id AS uom_id,u.code AS uom_code,bc.barcode
    FROM item_skus s JOIN item_sku_uoms su ON su.sku_id=s.id AND su.is_base=1
    JOIN item_uoms u ON u.id=su.uom_id JOIN item_sku_barcodes bc ON bc.sku_id=s.id
    WHERE s.id IN (1,3,4,50000,50001,100000) ORDER BY s.id`);
  assert.equal(skus.length, 6);
  const [[dates]] = await db.query("SELECT MIN(posted_at) AS firstAt,MAX(posted_at) AS lastAt FROM inventory_movements");
  const cases = [], add = (family, actor, input, sku) => {
    const routes = { CODE_EXACT: "sku-lookup", BARCODE_EXACT: "sku-lookup", SKU_STOCK_SUMMARY: "stocks/summary", BIN_DRILL_DOWN: "stocks", MOVEMENT_FILTERS: "movements" };
    const route = family === "FEFO_FIFO_CANDIDATES" ? `reservations/${input.reservationId}/allocation-candidates` : routes[family];
    const query = { ...input }; delete query.reservationId;
    cases.push({ family, actor, input, sku, route: `/api/v1/inventory/${route}?${new URLSearchParams(query)}` });
  };
  for (const [index, actor] of actors.entries()) for (const [sample, sku] of [...skus.slice(0, 4), skus[4 + index % 2]].entries()) {
    const warehouseId = (index + sample) % 5 + 1, skuId = Number(sku.id);
    add("CODE_EXACT", actor, { code: sku.sku_code }, sku);
    add("BARCODE_EXACT", actor, { barcode: sku.barcode }, sku);
    add("SKU_STOCK_SUMMARY", actor, { skuId, warehouseId, minimumRemainingDays: 0 }, sku);
    add("BIN_DRILL_DOWN", actor, { warehouseId, binId: (warehouseId - 1) * 200 + (skuId <= 50000 ? Math.floor((skuId - 1) / 4) % 200 : 0) + 1,
      ...(skuId > 50000 ? { skuId } : {}), page: sample % 2 + 1, pageSize: 100, sortBy: "skuCode", descending: false }, sku);
    add("MOVEMENT_FILTERS", actor, { warehouseId, skuId, postedFrom: Number(dates.firstAt), postedTo: Number(dates.lastAt), page: sample % 2 + 1, pageSize: 5 }, sku);
  }
  let candidate = 0;
  for (const [index, actor] of actors.filter(value => value.writer).entries()) for (let n = 0; n < (index < 4 ? 17 : 16); n++, candidate++) {
    const reservation = reservations[candidate % 15];
    add("FEFO_FIFO_CANDIDATES", actor, { reservationId: reservation.id, requestedQuantity: 1, page: Math.floor(candidate / 15) % 2 + 1 });
  }
  assert.equal(candidate, 100);
  fixture.queryCases = cases;
  return cases;
}

async function characterizationQueryExpected(db, testCase) {
  const { family, input, sku } = testCase, day = characterizationDay();
  if (family === "CODE_EXACT" || family === "BARCODE_EXACT") return { skuId: Number(sku.id), skuCode: sku.sku_code,
    skuName: sku.sku_name, trackingPolicy: sku.tracking_policy, baseUom: { uomId: Number(sku.uom_id), uomCode: sku.uom_code } };
  if (family === "SKU_STOCK_SUMMARY") {
    const [rows] = await db.execute(`SELECT b.stock_status,b.on_hand_quantity,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry
      FROM inventory_stock_balances b LEFT JOIN inventory_lots l ON l.id=b.lot_id WHERE b.sku_id=? AND b.warehouse_id=?`, [input.skuId, input.warehouseId]);
    const [[control]] = await db.execute("SELECT COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock_controls WHERE sku_id=? AND warehouse_id=?", [input.skuId, input.warehouseId]);
    const sum = predicate => rows.filter(predicate).reduce((n, row) => n + Number(row.on_hand_quantity), 0);
    const available = row => row.stock_status === "AVAILABLE", eligibleOnHand = sum(row => available(row) && (row.expiry === null || row.expiry >= day));
    const reserved = Number(control.reserved);
    return { totalOnHand: sum(() => true), availableOnHand: sum(available), eligibleOnHand, reserved,
      atp: Math.max(eligibleOnHand - reserved, 0), uncoveredReserved: Math.max(reserved - eligibleOnHand, 0),
      quarantined: sum(row => row.stock_status === "QUARANTINED"), damaged: sum(row => row.stock_status === "DAMAGED"), inTransit: 0 };
  }
  if (family === "BIN_DRILL_DOWN") {
    const [rows] = await db.execute(`SELECT b.*,w.warehouse_code,w.warehouse_name,bn.bin_code,bn.bin_name,s.sku_code,s.sku_name,
      su.uom_id,u.code AS uom_code,l.lot_number,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry,
      DATE_FORMAT(l.manufacture_date,'%Y-%m-%d') AS manufacture FROM inventory_stock_balances b
      JOIN inventory_warehouses w ON w.id=b.warehouse_id JOIN inventory_bins bn ON bn.id=b.bin_id
      JOIN item_skus s ON s.id=b.sku_id JOIN item_sku_uoms su ON su.sku_id=s.id AND su.is_base=1
      JOIN item_uoms u ON u.id=su.uom_id LEFT JOIN inventory_lots l ON l.id=b.lot_id
      WHERE b.warehouse_id=? AND b.bin_id=?${input.skuId ? " AND b.sku_id=?" : ""}
      ORDER BY s.sku_code,b.id`, [input.warehouseId, input.binId, ...(input.skuId ? [input.skuId] : [])]);
    const items = rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map(row => ({
      balanceId: Number(row.id), warehouse: { warehouseId: Number(row.warehouse_id), code: row.warehouse_code, name: row.warehouse_name },
      bin: { binId: Number(row.bin_id), code: row.bin_code, name: row.bin_name ?? null }, sku: { skuId: Number(row.sku_id), code: row.sku_code, name: row.sku_name },
      lot: row.lot_id === null ? null : { lotId: Number(row.lot_id), number: row.lot_number, expiryDate: row.expiry, manufactureDate: row.manufacture },
      stockStatus: row.stock_status, isExpired: row.expiry !== null && row.expiry < day, onHand: Number(row.on_hand_quantity),
      allocated: Number(row.allocated_quantity), bucketFree: Number(row.on_hand_quantity) - Number(row.allocated_quantity),
      baseUom: { uomId: Number(row.uom_id), uomCode: row.uom_code }, version: Number(row.version) }));
    return { items, total: rows.length, page: input.page, pageSize: input.pageSize };
  }
  if (family === "MOVEMENT_FILTERS") {
    const [rows] = await db.execute(`SELECT m.*,o.source_module,o.source_document_type,o.source_document_id,o.source_line_id,o.source_event_id,
      DATE_FORMAT(m.expiry_date_snapshot,'%Y-%m-%d') AS expiry FROM inventory_movements m
      JOIN inventory_operation_requests o ON o.id=m.operation_request_id
      WHERE m.warehouse_id=? AND m.sku_id=? AND m.posted_at>=? AND m.posted_at<=? ORDER BY m.posted_at DESC,m.id DESC`,
    [input.warehouseId, input.skuId, input.postedFrom, input.postedTo]);
    return { total: rows.length, page: input.page, pageSize: input.pageSize,
      items: rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map(row => ({ movementId: Number(row.id), groupId: row.movement_group_id,
        movementType: row.movement_type, locationKind: row.location_kind, warehouse: { warehouseId: Number(row.warehouse_id), code: row.warehouse_code_snapshot },
        bin: row.bin_id === null ? null : { binId: Number(row.bin_id), code: row.bin_code_snapshot }, sku: { skuId: Number(row.sku_id), code: row.sku_code_snapshot, name: row.sku_name_snapshot },
        lot: row.lot_id === null ? null : { lotId: Number(row.lot_id), number: row.lot_number_snapshot, expiryDate: row.expiry }, stockStatus: row.stock_status,
        direction: row.direction, quantity: Number(row.quantity), balanceBefore: row.balance_before === null ? null : Number(row.balance_before),
        balanceAfter: row.balance_after === null ? null : Number(row.balance_after), balanceVersionAfter: row.balance_version_after === null ? null : Number(row.balance_version_after),
        postedAt: Number(row.posted_at), postedBy: { userId: row.posted_by === null ? null : Number(row.posted_by), label: row.posted_by_label }, operationId: Number(row.operation_request_id),
        source: { module: row.source_module, documentType: row.source_document_type, documentId: row.source_document_id, lineId: row.source_line_id, eventId: row.source_event_id } })) };
  }
  assert.equal(family, "FEFO_FIFO_CANDIDATES"); assert.equal(testCase.actor.writer, true);
  const [[reservation]] = await db.execute("SELECT * FROM inventory_reservations WHERE id=?", [input.reservationId]);
  assert.equal(reservation.status, "ACTIVE"); assert.equal(Number(reservation.outstanding_quantity), 1);
  const [[allocated]] = await db.execute("SELECT COALESCE(SUM(outstanding_quantity),0) AS n FROM inventory_allocations WHERE reservation_id=?", [input.reservationId]);
  assert.equal(Number(allocated.n), 0);
  const [rows] = await db.execute(`SELECT b.*,bn.bin_code,l.normalized_lot_number,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry,
    DATE_FORMAT(l.first_receipt_date,'%Y-%m-%d') AS receipt,DATE_FORMAT(b.fifo_anchor_date,'%Y-%m-%d') AS fifo
    FROM inventory_stock_balances b JOIN inventory_bins bn ON bn.id=b.bin_id LEFT JOIN inventory_lots l ON l.id=b.lot_id
    WHERE b.warehouse_id=? AND b.sku_id=? AND b.stock_status='AVAILABLE' AND b.on_hand_quantity>b.allocated_quantity AND bn.status='ACTIVE'
      AND (l.expiry_date IS NULL OR l.expiry_date>=?) AND NOT EXISTS
        (SELECT 1 FROM inventory_bin_locks k WHERE k.bin_id=b.bin_id AND k.released_at IS NULL)`, [reservation.warehouse_id, reservation.sku_id, day]);
  // Each fixed SKU has exactly one AVAILABLE bucket; page two must be a legitimate empty response.
  assert.ok(rows.length <= 1);
  const items = input.page === 1 ? rows.map(row => ({ balanceId: Number(row.id), binId: Number(row.bin_id), lotId: row.lot_id === null ? null : Number(row.lot_id),
    expiryDate: row.expiry, firstReceiptDate: row.receipt, fifoAnchorDate: row.fifo, freeQuantity: Number(row.on_hand_quantity) - Number(row.allocated_quantity),
    balanceVersion: Number(row.version), selectionStrategy: row.expiry === null ? "FIFO" : "FEFO", rank: 1 })) : [];
  return { reservationId: input.reservationId, requestedQuantity: 1, asOf: day, reservationVersion: Number(reservation.version), unallocatedQuantity: 1, page: input.page, hasMore: false, items };
}

async function characterizationQueryPlans(fixture, cases, observation) {
  const [{ InventoryInquiryService }, { ItemLookupService }, { InventoryReservationService }] = await Promise.all([
    import("../src/modules/inventory/InventoryInquiryService.js"), import("../src/modules/item/ItemLookupService.js"), import("../src/modules/inventory/InventoryReservationService.js")]);
  const seen = new Set();
  for (const testCase of cases) {
    const key = JSON.stringify([testCase.family, testCase.input]); if (seen.has(key)) continue; seen.add(key);
    const query = async (sql, params = []) => {
      assert.match(sql, /^\s*(?:SELECT|WITH)\b/iu); assert.ok(params.length > 0, "Actual query must remain parameterized");
      const started = performance.now(), [rows] = await fixture.db.query("EXPLAIN FORMAT=TRADITIONAL " + sql, params);
      const plan = rows.map(row => ({ table: row.table, type: row.type, possibleKeys: row.possible_keys, key: row.key, rows: row.rows, extra: row.Extra })), entry = { family: testCase.family, sqlHash: sha(sql), binds: params.length,
        inputHash: sha(key), elapsedMs: performance.now() - started, plan };
      observation.plans.push(entry);
      assert.ok(plan.length > 0, "Plan shape must be observable");
      const references = [...sql.matchAll(/\b(?:FROM|JOIN)\s+(inventory_movements|item_skus|item_sku_barcodes)\b(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/giu)]
        .map(match => ({ table: match[1], alias: !match[2] || /^(?:WHERE|JOIN|LEFT|RIGHT|INNER|ON|ORDER|LIMIT)$/iu.test(match[2]) ? match[1] : match[2] }));
      for (const reference of references) {
        const movement = reference.table === "inventory_movements", lookup = ["CODE_EXACT", "BARCODE_EXACT"].includes(testCase.family);
        if (!movement && !lookup) continue;
        const nodes = plan.filter(node => node.table === reference.alias);
        assert.ok(nodes.length > 0, `Actual plan must expose ${reference.table} reference ${reference.alias}`);
        for (const node of nodes) {
          assert.ok(!["ALL", "INDEX"].includes(String(node.type).toUpperCase()), `${reference.table} ${reference.alias} must not traverse the full table or index`);
          if (lookup) assert.ok(node.key && ["CONST", "EQ_REF", "REF", "REF_OR_NULL", "RANGE", "INDEX_MERGE", "UNIQUE_SUBQUERY", "INDEX_SUBQUERY"].includes(String(node.type).toUpperCase()), "Code/Barcode exact lookup must use bounded indexed access");
        }
      }
      assert.equal(plan.some(node => /Using filesort/iu.test(node.extra ?? "")) && plan.some(node => ["m", "b", "s", "inventory_movements", "inventory_stock_balances", "item_skus"].includes(node.table) && node.type === "ALL"), false, "Uncontrolled full-table filesort violates the existing query gate");
      return fixture.db.query(sql, params);
    };
    const database = { query, execute: query, async withTransaction(work) {
      await fixture.db.beginTransaction();
      try { return await work(database); } finally { await fixture.db.rollback(); }
    } }, time = { fileDate: characterizationDay, nowMs: Date.now };
    const inquiry = new InventoryInquiryService({ database, time });
    if (testCase.family === "CODE_EXACT" || testCase.family === "BARCODE_EXACT") {
      const lookup = new ItemLookupService({ database, time, logger: console });
      if (testCase.family === "CODE_EXACT") await lookup.findByCode(testCase.input.code, { purpose: "inventory" });
      else await lookup.findByBarcode(testCase.input.barcode, { purpose: "inventory" });
      await lookup.getInventoryProfileInTransaction(database, Number(testCase.sku.id));
    } else if (testCase.family === "SKU_STOCK_SUMMARY") await inquiry.getStockSummary(testCase.input);
    else if (testCase.family === "BIN_DRILL_DOWN") await inquiry.listStocks(testCase.input);
    else if (testCase.family === "MOVEMENT_FILTERS") await inquiry.listMovements(testCase.input);
    else {
      observation.candidatePlanScope = "REAL_READ_TRANSACTION; RESERVATION_WAREHOUSE_ALLOCATION_ITEM_AND_CANDIDATES; NOT_HTTP_AUTH_EVIDENCE";
      const reservations = new InventoryReservationService({ database, time, logger: console });
      await database.withTransaction(transaction => reservations.listAllocationCandidatesInTransaction(transaction, testCase.input));
    }
  }
}

async function characterizationQuery(fixture, testCase, observation, phase = "BASELINE", active = () => true, before) {
  const sample = { family: testCase.family, actor: testCase.actor.id, worker: testCase.actor.worker, phase, inputHash: sha(JSON.stringify(testCase.input)), outcome: "IN_PROGRESS" };
  observation.samples.push(sample);
  try {
    const index = fixture.report.requests.length, response = await fixture.request(testCase.actor, testCase.route);
    const row = fixture.report.requests[index];
    assert.equal(row.actor, testCase.actor.id); assert.equal(row.action, testCase.route.replace(/\/\d+(?=\/|\?|$)/gu, "/:id"));
    sample.requestId = row.requestId; sample.elapsedMs = row.completeMs; sample.dispatchAt = row.dispatchAt;
    sample.withinActivePhase = active(row);
    // At Post, accept exactly one complete committed before/after result, never mixed fields.
    const oracleStarted = performance.now(), after = await characterizationQueryExpected(fixture.db, testCase);
    sample.oracleMs = performance.now() - oracleStarted;
    assert.ok(isDeepStrictEqual(response, after) || isDeepStrictEqual(response, before), `Exact ${testCase.family} result/pagination/order`);
    sample.responseSha256 = sha(JSON.stringify(response)); sample.outcome = "COMPLETE";
  } catch (error) { sample.outcome = "FAIL"; sample.error = errorObservation(error); throw error; }
}

function assertCharacterizationQueries(observation) {
  assert.equal(observation.samples.filter(sample => sample.outcome !== "COMPLETE").length, 0, "Every offered legal query must succeed");
  observation.families = characterizationQueryFamilies.map(family => {
    const samples = observation.samples.filter(sample => sample.family === family && sample.withinActivePhase !== false), values = samples.map(sample => sample.elapsedMs);
    const metrics = { family, count: values.length, p50: values.length ? nearestRank(values, .5) : null,
      p95: values.length ? nearestRank(values, .95) : null, p99: values.length ? nearestRank(values, .99) : null, max: values.length ? Math.max(...values) : null };
    assert.ok(metrics.count >= 100, `${family} needs 100 legal complete samples`); assert.ok(metrics.p95 < 2000, `${family} existing query p95 must be under 2000ms`);
    return metrics;
  });
}

export async function verifyQueryBaseline(fixture) {
  assert.ok(fixture, "CP01 must complete");
  requireObservationLifecycle(fixture);
  const observation = { status: "IN_PROGRESS", samples: [], plans: [], measurement: "HTTP_COMPLETE_BODY; ORACLE_AND_EXPLAIN_COST_RECORDED_SEPARATELY" };
  fixture.report.queryBaseline = observation;
  try {
    const [[active]] = await fixture.db.query("SELECT COUNT(*) AS n FROM inventory_stocktakes WHERE status NOT IN ('POSTED','CANCELLED')");
    assert.equal(Number(active.n), 0, "CP02 precedes Stocktake writes");
    const cases = await characterizationQueryCases(fixture), started = performance.now();
    await characterizationQueryPlans(fixture, cases, observation); observation.planAndOracleSetupMs = performance.now() - started;
    const expected = new Map(), oracleStarted = performance.now();
    for (const testCase of cases) expected.set(testCase, await characterizationQueryExpected(fixture.db, testCase));
    observation.oracleSetupMs = performance.now() - oracleStarted;
    for (const testCase of cases.filter(value => value.family === "FEFO_FIFO_CANDIDATES"))
      assert.equal(expected.get(testCase).items.length, testCase.input.page === 1 ? 1 : 0, "All fifteen real Reservations have one actual baseline candidate and an empty page two");
    const settled = await Promise.allSettled(fixture.actors.map(async actor => {
      for (const testCase of cases.filter(value => value.actor === actor)) {
        await characterizationQuery(fixture, testCase, observation, "BASELINE", () => true, expected.get(testCase));
      }
    }));
    for (const result of settled) if (result.status === "rejected") throw result.reason;
    assertCharacterizationQueries(observation);
    for (const family of characterizationQueryFamilies.filter(value => value !== "FEFO_FIFO_CANDIDATES")) for (const actor of fixture.actors)
      assert.equal(observation.samples.filter(sample => sample.family === family && sample.actor === actor.id).length, 5);
    assert.deepEqual(fixture.actors.filter(actor => actor.writer).map(actor => observation.samples.filter(sample => sample.family === "FEFO_FIFO_CANDIDATES" && sample.actor === actor.id).length), [17,17,17,17,16,16]);
    observation.status = "COMPLETE"; fixture.characterizationCases ??= new Map(); fixture.characterizationCases.set("CP02", true);
  } catch (error) { observation.status = "FAIL"; observation.error = errorObservation(error); throw error; }
}

function characterizationStatementKind(eventName, sql) {
  const execute = eventName === "statement/com/Execute";
  if (typeof sql !== "string" || (!execute && !/^statement\/sql\/(?:select|insert(?:_select)?|update(?:_multi)?|delete(?:_multi)?)$/u.test(eventName ?? ""))) return "OTHER";
  if ((execute || eventName !== "statement/sql/select") && /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+inventory_(?:stocktake\w*|bin_locks|stock_balances|movements)\b/iu.test(sql)) return "WRITE";
  if ((execute || eventName === "statement/sql/select") && /^\s*SELECT\b/iu.test(sql) && /\b(?:item_skus|item_sku_barcodes|inventory_stock_balances|inventory_movements|inventory_reservations)\b/iu.test(sql) && !/\bFOR\s+(?:UPDATE|SHARE)\b/iu.test(sql)) return "QUERY";
  return "OTHER";
}

async function beginQueryCoexistence(fixture, round) {
  assert.equal(fixture.characterizationCases?.get("CP02"), true, "CP02 must complete before coexistence");
  const cases = await characterizationQueryCases(fixture), observation = { round, status: "IN_PROGRESS", samples: [], plans: fixture.report.queryBaseline.plans, phases: [], monitorSqlCount: 0, monitorSqlMs: 0, oracleBeforeMs: 0 };
  const [consumers] = await lotMonitorRead(fixture.db, `SELECT NAME,ENABLED FROM performance_schema.setup_consumers
    WHERE NAME IN ('events_statements_current','global_instrumentation','thread_instrumentation') ORDER BY NAME`, [], performance.now() + 5000);
  assert.deepEqual(consumers.map(row => [row.NAME, row.ENABLED]), [["events_statements_current", "YES"], ["global_instrumentation", "YES"], ["thread_instrumentation", "YES"]], "Missing statement consumers are UNKNOWN, not overlap");
  const [instruments] = await lotMonitorRead(fixture.db, "SELECT NAME,ENABLED,TIMED FROM performance_schema.setup_instruments WHERE NAME LIKE 'statement/sql/%' OR NAME='statement/com/Execute'", [], performance.now() + 5000);
  assert.ok(instruments.length > 0 && instruments.every(row => row.ENABLED === "YES" && row.TIMED === "YES"), "Missing statement timing is UNKNOWN, not overlap");
  for (const name of ["statement/com/Execute", "statement/sql/select", "statement/sql/insert", "statement/sql/insert_select", "statement/sql/update", "statement/sql/delete"])
    assert.ok(instruments.some(row => row.NAME === name), `Missing ${name} timing is UNKNOWN, not overlap`);
  const sequences = [0, 3];
  const requiredViews = [0, 1].map(worker => cases.filter(value => value.actor.worker === worker && value.family !== "FEFO_FIFO_CANDIDATES"));
  const viewCursors = [0, 0];
  const collect = async () => {
    const identities = fixture.workers.flatMap((worker, index) => [...worker.observationIdentities.values()].map(value => ({ ...value, worker: index })));
    const ids = identities.map(value => value.performanceThreadId); assert.ok(ids.length > 0);
    const started = performance.now(); observation.monitorSqlCount++;
    const [rows] = await lotMonitorRead(fixture.db, `SELECT THREAD_ID,EVENT_ID,EVENT_NAME,CAST(TIMER_START AS CHAR) AS firstTick,
      CAST(COALESCE(TIMER_END,TIMER_START+TIMER_WAIT) AS CHAR) AS lastTick,SQL_TEXT FROM performance_schema.events_statements_current
      WHERE THREAD_ID IN (${ids.map(() => "?").join(",")})`, ids, started + 5000);
    observation.monitorSqlMs += performance.now() - started;
    return rows.map(row => ({ worker: identities.find(value => value.performanceThreadId === Number(row.THREAD_ID)).worker,
      threadId: Number(row.THREAD_ID), eventId: String(row.EVENT_ID), eventName: row.EVENT_NAME ?? null, firstTick: row.firstTick, lastTick: row.lastTick,
      sqlHash: typeof row.SQL_TEXT === "string" ? sha(row.SQL_TEXT) : null,
      kind: row.firstTick && row.lastTick ? characterizationStatementKind(row.EVENT_NAME, row.SQL_TEXT) : "OTHER" }));
  };
  return { observation, async phase(action, write) {
    for (const actor of fixture.actors) if (Date.now() >= actor.expiresAt - 120000) {
      const refresh = await fixture.request(actor, "/api/v1/user/token/refresh", {}, true);
      actor.token = refresh.token; actor.expiresAt = Date.now() + refresh.expiresInSeconds * 1000;
    }
    const phase = { action, offeredAt: performance.now(), completeAt: null, statements: [], overlap: "NOT_OBSERVED" }; observation.phases.push(phase);
    const firstSample = observation.samples.length;
    const prior = new Set((await collect()).map(row => `${row.threadId}:${row.eventId}`)), statements = new Map();
    let running = true, primary;
    const monitor = (async () => { for (;;) { if (!running) break; for (const row of await collect()) {
      const key = `${row.threadId}:${row.eventId}`; if (!prior.has(key)) statements.set(key, row);
    } } })().catch(error => { primary ??= error; });
    const readers = [0, 1].map(worker => (async () => {
      for (;;) {
        const sequence = sequences[worker], family = characterizationQueryFamilies[sequence % characterizationQueryFamilies.length];
        const available = cases.filter(value => value.family === family && value.actor.worker === worker);
        const required = viewCursors[worker] < requiredViews[worker].length;
        const testCase = required ? requiredViews[worker][viewCursors[worker]] : available[Math.floor(sequence / characterizationQueryFamilies.length) % available.length];
        const oracleStarted = performance.now();
        const before = await characterizationQueryExpected(fixture.db, testCase);
        observation.oracleBeforeMs += performance.now() - oracleStarted;
        if (!running) break;
        await characterizationQuery(fixture, testCase, observation, action, row => {
          const within = row.dispatchAt >= phase.offeredAt && row.dispatchAt < (phase.completeAt ?? Infinity);
          if (within) {
            if (required) viewCursors[worker]++;
            else sequences[worker]++;
          }
          return within;
        }, before);
        if (!running) break;
      }
    })().catch(error => { primary ??= error; }));
    let result; const writeStarted = performance.now(), writeIndex = fixture.report.requests.length;
    try { result = await write(); } catch (error) { primary ??= error; }
    finally {
      phase.completeAt = performance.now(); phase.writeElapsedMs = phase.completeAt - writeStarted; running = false;
      const row = fixture.report.requests[writeIndex];
      phase.writeHttp = row ? { requestId: row.requestId, dispatchAt: row.dispatchAt, queueMs: row.schedulerLatenessMs,
        firstByteMs: row.firstByteMs, completeBodyMs: row.completeMs, outcome: row.outcome } : { outcome: "NOT_OBSERVED" };
    }
    const settled = await Promise.allSettled([...readers, monitor]);
    for (const value of settled) if (value.status === "rejected") primary ??= value.reason;
    phase.sampleRange = { first: firstSample, end: observation.samples.length };
    phase.familyCounts = Object.fromEntries(characterizationQueryFamilies.map(family => [family,
      observation.samples.slice(firstSample).filter(sample => sample.family === family && sample.withinActivePhase).length]));
    phase.statements = [...statements.values()];
    const writes = phase.statements.filter(row => row.worker === 0 && row.kind === "WRITE"), queries = phase.statements.filter(row => row.worker === 1 && row.kind === "QUERY");
    for (const writing of writes) for (const reading of queries) if (BigInt(writing.firstTick) < BigInt(reading.lastTick) && BigInt(reading.firstTick) < BigInt(writing.lastTick)) {
      phase.overlap = "NATIVE_SQL_TIMER_OVERLAP"; phase.witness = { write: writing, query: reading }; break;
    }
    if (primary) throw primary;
    return result;
  } };
}

export async function verifyQueryCoexistence(fixture) {
  const flows = fixture?.report.flows?.filter(flow => flow.bins === 200 && !flow.zero) ?? [];
  assert.equal(flows.length, 3, "CP06 needs all three CP05 rounds");
  for (const flow of flows) {
    const observation = flow.queryCoexistence; assert.ok(observation, "Missing coexistence round is INCOMPLETE");
    try {
      assert.equal(flow.outcome, "COMPLETE"); assertCharacterizationQueries(observation);
      for (const family of characterizationQueryFamilies.filter(value => value !== "FEFO_FIFO_CANDIDATES")) for (const actor of fixture.actors)
        assert.ok(observation.samples.filter(sample => sample.family === family && sample.actor === actor.id && sample.withinActivePhase).length >= 5, "All twenty original actors retain their legal query workload");
      for (const action of ["start", "counts/save", "ready", "post"]) {
        const phases = observation.phases.filter(phase => phase.action === action);
        assert.ok(phases.length > 0 && phases.some(phase => phase.overlap === "NATIVE_SQL_TIMER_OVERLAP"), `${action} needs actual server query/write SQL overlap`);
      }
      observation.status = "COMPLETE";
    } catch (error) { observation.status = "FAIL"; observation.error = errorObservation(error); throw error; }
  }
  fixture.characterizationCases ??= new Map(); fixture.characterizationCases.set("CP06", true);
}

function stocktakeResourceDistribution(rows, from, to) {
  const minutes = new Map();
  for (const row of rows.filter(row => row.atMs >= from && row.atMs <= to)) {
    const minute = Math.floor((row.atMs - from) / 60000), samples = minutes.get(minute) ?? [];
    samples.push(row); minutes.set(minute, samples);
  }
  return [...minutes].map(([minute, samples]) => {
    samples.sort((a, b) => a.atMs - b.atMs);
    const metrics = {};
    for (const name of ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers", "fd", "anonymousBytes", "visibleEmptyFiles", "visibleDirectories", "elapsedMs", "monitorSqlMs"]) {
      const values = samples.map(row => ({ atMs: row.atMs, value: name === "fd" ? row.fd?.count : row.memory?.[name] ?? row[name] }))
        .filter(row => typeof row.value === "number" && Number.isFinite(row.value));
      if (!values.length) continue;
      const numbers = values.map(row => row.value), first = values[0], last = values.at(-1);
      metrics[name] = { samples: numbers.length, first: first.value, last: last.value, min: Math.min(...numbers), highWater: Math.max(...numbers),
        p50: nearestRank(numbers, 0.5), p95: nearestRank(numbers, 0.95), p99: nearestRank(numbers, 0.99),
        trendPerSecond: last.atMs > first.atMs ? (last.value - first.value) * 1000 / (last.atMs - first.atMs) : null };
    }
    return { minute, samples: samples.length, complete: samples.filter(row => row.complete).length, metrics };
  });
}

export async function startStocktakeResourceSampling(fixture, workers = fixture.workers) {
  const observation = { startedAtMs: resourceClock(), stoppedAtMs: null, samples: [],
    scope: "TEST_ONLY_PARENT_PROCESS_AND_OWNED_MONITOR_SQL; OBSERVER_COST_INCLUDED; NON_ATOMIC_VIEWS" };
  fixture.report.resourcePeriods ??= []; fixture.report.resourcePeriods.push(observation);
  let inProgress, stopped = false;
  const sample = () => inProgress ??= (async () => {
    const started = performance.now(), value = { atMs: resourceClock(), memory: process.memoryUsage(), failures: [] };
    let sqlStarted;
    try {
      value.fd = await ownDescriptorCount();
      const ids = [...new Set(workers.flatMap(worker => [...worker.connections]))];
      sqlStarted = performance.now();
      if (ids.length) {
        const [sessions] = await fixture.db.query({ sql: `SELECT PROCESSLIST_ID,THREAD_ID,PROCESSLIST_COMMAND,PROCESSLIST_STATE
          FROM performance_schema.threads WHERE PROCESSLIST_ID IN (?)`, timeout: 1000 }, [ids]);
        const [transactions] = await fixture.db.query({ sql: `SELECT trx_id,trx_mysql_thread_id,trx_state,trx_rows_locked,trx_rows_modified
          FROM information_schema.innodb_trx WHERE trx_mysql_thread_id IN (?)`, timeout: 1000 }, [ids]);
        const threadIds = workers.flatMap(worker => [...worker.observationIdentities.values()].map(identity => identity.performanceThreadId));
        const [waits] = threadIds.length ? await fixture.db.query({ sql: `SELECT REQUESTING_THREAD_ID,BLOCKING_THREAD_ID
          FROM performance_schema.data_lock_waits WHERE REQUESTING_THREAD_ID IN (?) OR BLOCKING_THREAD_ID IN (?)`, timeout: 1000 }, [threadIds, threadIds]) : [[]];
        value.sessions = sessions; value.transactions = transactions; value.waits = waits;
        value.mapping = workers.map(worker => ({ incarnation: worker.incarnation, nativeIds: [...worker.connections],
          identities: [...worker.observationIdentities.values()].map(({ threadId, performanceThreadId, nonce, provenance }) => ({ threadId, performanceThreadId, nonce, provenance })) }));
        for (const session of sessions) {
          const mapping = workers.flatMap(worker => [...worker.observationIdentities.values()]).filter(identity => identity.threadId === Number(session.PROCESSLIST_ID));
          if (mapping.length !== 1 || mapping[0].performanceThreadId !== Number(session.THREAD_ID)) value.failures.push({ stage: "non-atomic-session-mapping-unknown" });
        }
      } else value.failures.push({ stage: "no-positive-owned-sql-identities" });
    } catch (error) { value.failures.push({ stage: "parent-resource-observation", error: errorObservation(error) }); }
    if (sqlStarted !== undefined) value.monitorSqlMs = performance.now() - sqlStarted;
    value.elapsedMs = performance.now() - started; value.complete = value.failures.length === 0 && value.fd?.count !== null;
    observation.samples.push(value); return value;
  })().finally(() => { inProgress = undefined; });
  const clock = startStocktakeSamplingClock(() => { void sample(); });
  observation.cadenceAnchorAtMs = clock.anchorAtMs;
  const checkpoint = async () => {
    const results = await Promise.allSettled([sample(), ...workers.map(worker => worker.resourceCheckpoint())]);
    const failures = results.filter(result => result.status === "rejected");
    if (failures.length) {
      observation.checkpointFailures ??= []; observation.checkpointFailures.push(...failures.map(result => errorObservation(result.reason)));
      throw failures[0].reason;
    }
  };
  try { await checkpoint(); }
  catch (error) {
    stopped = true; clock.stop(); await inProgress?.catch(() => {});
    observation.stoppedAtMs = resourceClock(); observation.status = "STARTUP_FAILED_DRAINED"; throw error;
  }
  return { observation, checkpoint, async stop() {
    if (!stopped) {
      stopped = true; clock.stop();
      try { await checkpoint(); } finally { observation.stoppedAtMs = resourceClock(); }
      observation.minutes = { parent: stocktakeResourceDistribution(observation.samples, observation.startedAtMs, observation.stoppedAtMs),
        workers: workers.map(worker => ({ incarnation: worker.incarnation,
          samples: worker.resourceSamples.filter(row => row.atMs >= observation.startedAtMs && row.atMs <= observation.stoppedAtMs),
          minutes: stocktakeResourceDistribution(worker.resourceSamples, observation.startedAtMs, observation.stoppedAtMs) })) };
    }
    return observation;
  } };
}

function stocktakeResourceCoverage(period, workers, exports) {
  const from = Math.min(...exports.map(row => row.dispatchAtMs)), to = Math.max(...exports.map(row => row.responseCompleteAtMs));
  assert.ok(Number.isFinite(from) && Number.isFinite(to) && from <= to);
  const coverage = (rows, cadenceAnchorAtMs) => {
    assert.ok(Number.isFinite(cadenceAnchorAtMs));
    const samples = rows.filter(row => row.atMs >= from && row.atMs <= to);
    const complete = samples.filter(row => row.complete).sort((a, b) => a.atMs - b.atMs);
    const firstTick = Math.max(1, Math.ceil((from - cadenceAnchorAtMs) / 1000));
    const lastTick = Math.floor((to - cadenceAnchorAtMs) / 1000);
    const expected = Math.max(0, lastTick - firstTick + 1);
    const bins = new Set(complete.map(row => Math.floor((row.atMs - cadenceAnchorAtMs) / 1000))
      .filter(tick => tick >= firstTick && tick <= lastTick));
    const points = [from, ...complete.map(row => row.atMs), to];
    const maxGapMs = Math.max(...points.slice(1).map((point, index) => point - points[index]));
    const completeSampleFraction = samples.length ? complete.length / samples.length : 0;
    return { expected, observed: samples.length, complete: complete.length, completeSlots: bins.size,
      samplerMs: samples.reduce((sum, row) => sum + row.elapsedMs, 0),
      monitorSqlMs: samples.reduce((sum, row) => sum + (row.monitorSqlMs ?? 0), 0),
      fstatMs: samples.reduce((sum, row) => sum + (row.fstatMs ?? 0), 0),
      fraction: expected ? bins.size / expected : 1, completeSampleFraction, maxGapMs,
      status: (expected ? bins.size / expected : 1) >= 0.95 && completeSampleFraction >= 0.95 && maxGapMs <= 5000 ? "COMPLETE" : "INCOMPLETE" };
  };
  const parent = coverage(period.samples, period.cadenceAnchorAtMs), children = workers.map(worker => ({ incarnation: worker.incarnation,
    ...coverage(worker.resourceSamples, worker.resourceSamples[0]?.cadenceAnchorAtMs) }));
  return { from, to, elapsedMs: to - from, parent, children,
    status: [parent, ...children].every(value => value.status === "COMPLETE") ? "COMPLETE" : "INCOMPLETE" };
}

const stocktakeCsvColumns = ["recordType", "stocktakeId", "stocktakeNumber", "status", "cancelled", "varianceStage", "asOf", "workflowVersion",
  "scopeId", "binId", "binCodeSnapshot", "binCodeCurrent", "lineId", "lineVersion", "skuId", "skuCodeCurrent", "skuNameCurrent", "baseUomId", "baseUomCodeCurrent",
  "lotId", "lotNumberCurrent", "stockStatus", "snapshotBalanceId", "snapshotBalanceVersion", "snapshotQuantity", "countState", "actualQuantity", "varianceQuantity", "movementId",
  "filteredLineCount", "scopeCount", "exportedRows", "truncated", "truncationReason", "generationBudgetMs", "filterHash"];
const stocktakeCsvDigestColumns = stocktakeCsvColumns.filter(field => field !== "asOf");
function stocktakeCsvExpectedCell(value) {
  if (value == null) return "";
  return typeof value === "string" && /^[=+@\-\t\r]/u.test(value) ? `'${value}` : String(value);
}
function stocktakeCsvRecordDigest(hash, record) {
  hash.update(JSON.stringify(stocktakeCsvDigestColumns.map(field => stocktakeCsvExpectedCell(record[field]))) + "\n");
}

export function registerStocktakeExportAuditIntent(registry, intent) {
  assert.ok(registry instanceof Map);
  assert.deepEqual(Object.keys(intent).sort(), ["actorId", "actorLabel", "outcome", "requestId", "stocktakeId", "workflowVersion"]);
  assert.ok(typeof intent.requestId === "string" && /^[\x21-\x7e]{1,64}$/u.test(intent.requestId));
  assert.ok(!registry.has(intent.requestId), "Export request ID must be registered only once");
  for (const key of ["actorId", "stocktakeId", "workflowVersion"]) assert.ok(Number.isSafeInteger(intent[key]) && intent[key] > 0);
  assert.ok(typeof intent.actorLabel === "string" && intent.actorLabel.length > 0);
  assert.ok(["COMPLETE", "BUSY"].includes(intent.outcome), "Unknown export outcome has no approved Audit descriptor");
  const fixed = Object.freeze({ ...intent }); registry.set(intent.requestId, fixed); return fixed;
}

export function verifyStocktakeExportAuditRows(rows, intent, csv) {
  registerStocktakeExportAuditIntent(new Map(), intent);
  assert.ok(Array.isArray(rows));
  const required = intent.outcome === "COMPLETE" ? ["DOMAIN:SUCCEEDED"] : ["DOMAIN:FAILED", "ROUTE:FAILED"];
  assert.equal(rows.length, required.length, "Exact per-scope Audit multiset is required");
  const expectedSummary = { stocktakeId: intent.stocktakeId, rowCount: 100000, version: intent.workflowVersion, status: "COUNTING" };
  let successReason;
  if (intent.outcome === "COMPLETE") {
    assert.deepEqual([csv.outcome, csv.status, csv.requestId, csv.requestIdEchoObservation], ["COMPLETE", 200, intent.requestId, "MATCHED"]);
    const filterHash = sha(JSON.stringify({ stocktakeId: intent.stocktakeId, filters: {} }));
    assert.equal(csv.summary.filterHash, filterHash);
    assert.deepEqual([csv.summary.truncated, csv.summary.truncationReason], ["true", "ROW_LIMIT"]);
    const budget = Number(csv.summary.generationBudgetMs);
    assert.ok(Number.isSafeInteger(budget) && budget > 0 && budget <= 60000);
    assert.equal(csv.headers["x-inventory-export-generation-budget-ms"], csv.summary.generationBudgetMs);
    successReason = `filterHash=${filterHash};truncated=true;reason=ROW_LIMIT;budgetMs=${budget}`;
  }
  const ids = new Set(), seen = new Set(), evidence = [];
  for (const row of rows) {
    const id = Number(row.id); assert.ok(Number.isSafeInteger(id) && id > 0 && !ids.has(id)); ids.add(id);
    const scope = row.target_id === null && row.target_label === "/api/v1/inventory/stocktakes/:id/export" ? "ROUTE"
      : row.target_id !== null && Number(row.target_id) === intent.stocktakeId && row.target_label === `stocktake:${intent.stocktakeId}` ? "DOMAIN" : "UNKNOWN";
    const key = `${scope}:${row.outcome}`;
    assert.ok(required.includes(key) && !seen.has(key), "Unknown or repeated Audit scope/outcome"); seen.add(key);
    assert.deepEqual([row.action, row.target_type], ["inventory.export", "stocktake"]);
    assert.equal(Number(row.actor_user_id), intent.actorId);
    assert.equal(row.actor_label, scope === "DOMAIN" ? intent.actorLabel : `user:${intent.actorId}`);
    assert.equal(row.request_id, intent.requestId); assert.equal(row.correlation_id, intent.requestId);
    assert.equal(row.operation_request_id, null); assert.equal(row.before_summary, null);
    const afterSummary = typeof row.after_summary === "string" ? JSON.parse(row.after_summary) : row.after_summary;
    if (row.outcome === "SUCCEEDED") {
      assert.deepEqual(afterSummary, expectedSummary);
      assert.deepEqual([row.reason_category, row.reason_text], ["EXPORT", successReason]);
    } else {
      assert.equal(afterSummary, null); assert.deepEqual([row.reason_category, row.reason_text], ["", ""]);
    }
    evidence.push({ auditId: id, scope, outcome: row.outcome, row: { ...row, after_summary: afterSummary } });
  }
  assert.deepEqual([...seen].sort(), [...required].sort()); return evidence;
}

export async function readStocktakeExportAuditEvidence(database, intent, csv) {
  const [rows] = await database.execute(`SELECT id,actor_user_id,actor_label,action,target_type,target_id,target_label,outcome,reason_category,reason_text,before_summary,after_summary,operation_request_id,request_id,correlation_id
    FROM inventory_audit_logs WHERE request_id=? ORDER BY id`, [intent.requestId]);
  return verifyStocktakeExportAuditRows(rows, intent, csv);
}

export async function streamStocktakeCsv(fixture, actor, stocktakeId, worker = fixture.workers[actor.worker], sampling, auditIntent) {
  const route = `/api/v1/inventory/stocktakes/${stocktakeId}/export`, intendedAt = performance.now(), requestId = randomUUID();
  const row = { actor: actor.id, workerIncarnation: worker.incarnation, method: "GET", action: "/api/v1/inventory/stocktakes/:id/export",
    requestId, budgetMs: 120000, intendedAt, dispatchAt: null, firstByteMs: null, completeMs: null, status: null, code: null,
    bytes: 0, scopes: 0, lines: 0, summaryCount: 0, summary: null, clientYieldCalls: 0, clientYieldMs: 0, outcome: "NOT_SENT", resultObservation: "NOT_SENT",
    requestIdEchoObservation: "NOT_OBSERVED", clientMemoryBefore: process.memoryUsage() };
  fixture.report.requests.push(row);
  let response, timer, settled = false, fullyConsumed = false;
  const controller = new AbortController(), ids = createHash("sha256"), data = createHash("sha256"), body = createHash("sha256");
  try {
    assert.equal(worker.quarantined, false);
    if (Date.now() >= actor.expiresAt - 120000) {
      const refresh = await fixture.request(actor, "/api/v1/user/token/refresh", {}, true);
      actor.token = refresh.token; actor.expiresAt = Date.now() + refresh.expiresInSeconds * 1000;
    }
    await fixture.reserveReadDispatch(actor.worker); assert.equal(worker.quarantined, false);
    fixture.exportAuditRequests ??= new Map();
    registerStocktakeExportAuditIntent(fixture.exportAuditRequests, { requestId, actorId: actor.id, actorLabel: actor.username,
      stocktakeId, workflowVersion: auditIntent.workflowVersion, outcome: auditIntent.outcome });
    row.dispatchAt = performance.now(); row.dispatchAtMs = resourceClock(); row.schedulerLatenessMs = row.dispatchAt - intendedAt;
    const timeout = Object.assign(new Error("Streaming CSV parent deadline"), { code: "TEST_HTTP_WATCHDOG_TIMEOUT" });
    const deadline = new Promise((_resolve, reject) => {
      timer = globalThis.setTimeout(() => { controller.abort(timeout); reject(timeout); }, 120000);
    });
    const transport = async () => {
      response = await fetch(worker.origin + route, { headers: { Authorization: `Bearer ${actor.token}`, "X-Request-ID": requestId }, signal: controller.signal });
      if (settled || controller.signal.aborted) throw timeout;
      row.status = response.status; row.headersMs = performance.now() - row.dispatchAt;
      if (response.headers.get("x-request-id") === requestId) row.requestIdEchoObservation = "MATCHED";
      if (response.status !== 200) {
        const value = await response.json(); fullyConsumed = true;
        row.firstByteMs = row.headersMs; row.firstByteObservation = "NON_CSV_RESPONSE_HEADERS";
        row.code = value.error?.code ?? null; row.resultObservation = "HTTP_RESPONSE_CONSUMED";
        row.outcome = response.status === 503 && row.code === "INVENTORY_DEPENDENCY_UNAVAILABLE" ? "DEPENDENCY_FAIL_UNPROVEN_BUSY" : "HTTP_FAIL";
        row.responseCompleteAtMs = resourceClock();
        return;
      }
      assert.match(response.headers.get("content-type") ?? "", /^text\/csv(?:;|$)/iu);
      row.headers = Object.fromEntries(["x-inventory-export-truncated", "x-inventory-export-reason", "x-inventory-export-generation-budget-ms"].map(name => [name, response.headers.get(name)]));
      const source = Readable.fromWeb(response.body), parser = parse({ columns: columns => {
        assert.deepEqual(columns, stocktakeCsvColumns); return columns;
      }, bom: true, max_record_size: 1048576 });
      const receiving = (async function* () {
        for await (const chunk of source) {
          if (row.firstByteMs === null) row.firstByteMs = performance.now() - row.dispatchAt;
          row.bytes += chunk.length; body.update(chunk); yield chunk;
          const yieldStarted = performance.now();
          await new Promise(resolve => { globalThis.setImmediate(resolve); });
          row.clientYieldCalls++; row.clientYieldMs += performance.now() - yieldStarted;
        }
      })();
      let lastScope = 0, lastLine = 0, phase = "SCOPE";
      await pipeline(receiving, parser, async records => {
        for await (const record of records) {
          assert.equal(record.stocktakeId, String(stocktakeId)); assert.equal(record.status, "COUNTING");
          assert.equal(record.cancelled, "false"); assert.equal(record.varianceStage, "PREVIEW");
          assert.deepEqual(Object.keys(record), stocktakeCsvColumns);
          assert.ok(Number.isSafeInteger(Number(record.asOf)) && Number(record.asOf) > 0);
          row.asOf ??= record.asOf; assert.equal(record.asOf, row.asOf);
          const first = stocktakeCsvColumns.indexOf("filteredLineCount");
          if (record.recordType === "SUMMARY") {
            for (const field of stocktakeCsvColumns.slice(8, first)) assert.equal(record[field], "");
            row.summaryCount++; assert.equal(row.summaryCount, 1); row.summary = record; phase = "SUMMARY"; continue;
          }
          for (const field of stocktakeCsvColumns.slice(first)) assert.equal(record[field], "");
          assert.notEqual(phase, "SUMMARY", "SUMMARY must be the final CSV record");
          if (record.recordType === "SCOPE") {
            assert.equal(phase, "SCOPE"); const id = Number(record.scopeId); assert.ok(Number.isSafeInteger(id) && id > lastScope);
            lastScope = id; row.scopes++; ids.update(`SCOPE:${id}\n`);
            for (const field of stocktakeCsvColumns.slice(12, first)) assert.equal(record[field], "");
          } else {
            assert.equal(record.recordType, "LINE"); phase = "LINE";
            const id = Number(record.lineId); assert.ok(Number.isSafeInteger(id) && id > lastLine);
            lastLine = id; row.lines++; ids.update(`LINE:${id}\n`);
            assert.equal(record.countState, "UNCOUNTED"); assert.equal(record.actualQuantity, ""); assert.equal(record.varianceQuantity, ""); assert.equal(record.movementId, "");
          }
          // Parsed cells are already CSV-safe; do not apply formula escaping a second time.
          data.update(JSON.stringify(stocktakeCsvDigestColumns.map(field => record[field])) + "\n");
          assert.ok(row.scopes + row.lines <= 100000, "The cap includes SCOPE records");
        }
      }, { signal: controller.signal });
      fullyConsumed = true; row.resultObservation = "STREAM_PARSED_AND_HASHED";
      assert.equal(row.summaryCount, 1);
      assert.equal(Number(row.summary.exportedRows), row.scopes + row.lines);
      assert.ok(Number.isSafeInteger(Number(row.summary.generationBudgetMs)) && Number(row.summary.generationBudgetMs) > 0 && Number(row.summary.generationBudgetMs) <= 60000);
      assert.equal(row.headers["x-inventory-export-truncated"], row.summary.truncated);
      assert.equal(row.headers["x-inventory-export-reason"], row.summary.truncationReason);
      assert.equal(row.headers["x-inventory-export-generation-budget-ms"], row.summary.generationBudgetMs);
      row.outcome = "COMPLETE"; row.responseCompleteAtMs = resourceClock();
    };
    await Promise.race([Promise.all([transport(), sampling?.checkpoint()]), deadline]);
    assert.ok(performance.now() - row.dispatchAt < 120000);
    row.orderedIdsSha256 = ids.digest("hex"); row.dataSha256 = data.digest("hex"); row.bodySha256 = body.digest("hex");
    return row;
  } catch (error) {
    row.outcome = "FAIL"; row.error = errorObservation(error);
    if (row.dispatchAt !== null && !fullyConsumed) {
      row.resultObservation = "UNKNOWN"; worker.quarantined = true;
    }
    controller.abort(error); throw error;
  } finally {
    settled = true; globalThis.clearTimeout(timer); row.completeMs = performance.now() - (row.dispatchAt ?? intendedAt);
    row.clientMemoryAfter = process.memoryUsage();
  }
}

export async function verifyStocktakeExportCapacity(fixture) {
  requireObservationLifecycle(fixture);
  assert.equal(fixture.workers.length, 2); assert.equal(fixture.workers.some(worker => worker.quarantined), false);
  const { db, actors, report, request } = fixture, writer = actors.find(actor => actor.writer), exporter = actors.find(actor => actor.lane === 9);
  const firstRequest = report.requests.length;
  const observation = { outcome: "IN_PROGRESS", fullLineCount: null, phases: [], phaseCosts: {}, poolOneCleanup: { status: "NOT_STARTED" } };
  report.exportCapacity = observation;
  const root = "/api/v1/inventory/stocktakes", resourceWorkers = [...fixture.workers];
  let header, normalSampling, poolOneSampling, compatibility, primaryError, primaryExport;
  const command = async (action, body) => {
    const dispatchIndex = report.requests.length, route = action === "create" ? `${root}/create` : `${root}/${header.id}/${action}`;
    const result = await request(writer, route, body);
    const requestId = commandRequestId(report, dispatchIndex, writer.id, route);
    const { password: _password, ...oracleBody } = body;
    fixture.stocktakeCommands ??= new Map(); fixture.stocktakeCommands.set(result.operationId, { action, body: oracleBody, result, actorId: writer.id, requestId });
    observation.phases.push({ action, operationId: result.operationId }); return result;
  };
  try {
    normalSampling = await startStocktakeResourceSampling(fixture, resourceWorkers);
    observation.phaseCosts.setup = { startedAtMs: resourceClock() };
    header = await command("create", { source: source(), warehouseId: 5, binIds: Array.from({ length: 200 }, (_, index) => 801 + index), reason: "Synthetic full-capacity CSV characterization" });
    header = await command("start", { source: source(), expectedVersion: header.version });
    assert.equal(header.status, "COUNTING"); observation.stocktakeId = header.id;
    const [[state]] = await db.execute(`SELECT status,version,(SELECT COUNT(*) FROM inventory_stocktake_lines WHERE stocktake_id=?) AS lineCount,
      (SELECT COUNT(*) FROM inventory_stocktake_bins WHERE stocktake_id=?) AS scopeCount FROM inventory_stocktakes WHERE id=?`, [header.id, header.id, header.id]);
    assert.deepEqual([state.status, Number(state.version), Number(state.lineCount), Number(state.scopeCount)], ["COUNTING", header.version, 100000, 200]);
    observation.fullLineCount = Number(state.lineCount);
    observation.phaseCosts.setup.stoppedAtMs = resourceClock();
    observation.phaseCosts.oracle = { startedAtMs: resourceClock() };
    const csvIds = createHash("sha256"), csvData = createHash("sha256"), fullIds = createHash("sha256");
    const [[oracleHeader]] = await db.execute("SELECT id,stocktake_number,status,version FROM inventory_stocktakes WHERE id=?", [header.id]);
    assert.deepEqual([oracleHeader.status, Number(oracleHeader.version)], ["COUNTING", header.version]);
    const common = { stocktakeId: Number(oracleHeader.id), stocktakeNumber: oracleHeader.stocktake_number, status: oracleHeader.status,
      cancelled: false, varianceStage: "PREVIEW", workflowVersion: Number(oracleHeader.version) };
    const [scopes] = await db.execute(`SELECT scope.id,scope.bin_id,scope.bin_code_snapshot,bin.bin_code
      FROM inventory_stocktake_bins scope JOIN inventory_bins bin ON bin.id=scope.bin_id
      WHERE scope.stocktake_id=? ORDER BY scope.id LIMIT 201`, [header.id]);
    assert.equal(scopes.length, 200);
    for (const row of scopes) {
      csvIds.update(`SCOPE:${row.id}\n`);
      stocktakeCsvRecordDigest(csvData, { ...common, recordType: "SCOPE", scopeId: row.id, binId: row.bin_id,
        binCodeSnapshot: row.bin_code_snapshot, binCodeCurrent: row.bin_code });
    }
    let cursor = 0, actual = 0;
    while (true) {
      // Independently read bounded raw SQL pages; no product projection or CSV formatter supplies the oracle.
      const [lines] = await db.execute(`SELECT l.id,l.stocktake_id,l.stocktake_bin_id,l.bin_id,l.version,l.sku_id,l.lot_id,l.stock_status,
        l.stock_balance_id,l.snapshot_balance_version,l.snapshot_quantity,l.counted_quantity,l.is_not_found,l.variance_quantity,l.movement_id,
        scope.bin_code_snapshot,bin.bin_code,sku.sku_code,sku.sku_name,su.uom_id,u.code AS uom_code,lot.lot_number
        FROM (SELECT * FROM inventory_stocktake_lines WHERE stocktake_id=? AND id>? ORDER BY id LIMIT 1000) l
        JOIN inventory_stocktake_bins scope ON scope.id=l.stocktake_bin_id AND scope.stocktake_id=l.stocktake_id AND scope.bin_id=l.bin_id
        JOIN inventory_bins bin ON bin.id=l.bin_id JOIN item_skus sku ON sku.id=l.sku_id
        JOIN item_sku_uoms su ON su.sku_id=l.sku_id AND su.is_base=1 JOIN item_uoms u ON u.id=su.uom_id
        LEFT JOIN inventory_lots lot ON lot.id=l.lot_id AND lot.sku_id=l.sku_id ORDER BY l.id`, [header.id, cursor]);
      if (!lines.length) break;
      for (const line of lines) {
        const id = Number(line.id); assert.ok(id > cursor); cursor = id; actual++; fullIds.update(`LINE:${id}\n`);
        assert.equal(Number(line.stocktake_id), header.id);
        assert.deepEqual([line.counted_quantity, Number(line.is_not_found), line.variance_quantity, line.movement_id], [null, 0, null, null]);
        if (actual <= 99800) {
          csvIds.update(`LINE:${id}\n`);
          stocktakeCsvRecordDigest(csvData, { ...common, recordType: "LINE", scopeId: line.stocktake_bin_id, binId: line.bin_id,
            binCodeSnapshot: line.bin_code_snapshot, binCodeCurrent: line.bin_code, lineId: id, lineVersion: line.version,
            skuId: line.sku_id, skuCodeCurrent: line.sku_code, skuNameCurrent: line.sku_name, baseUomId: line.uom_id, baseUomCodeCurrent: line.uom_code,
            lotId: line.lot_id, lotNumberCurrent: line.lot_number, stockStatus: line.stock_status, snapshotBalanceId: line.stock_balance_id,
            snapshotBalanceVersion: line.snapshot_balance_version, snapshotQuantity: line.snapshot_quantity,
            countState: "UNCOUNTED", actualQuantity: null, varianceQuantity: null, movementId: null });
        }
      }
    }
    assert.equal(actual, 100000); observation.fullLineIdsSha256 = fullIds.digest("hex"); observation.expectedCsvIdsSha256 = csvIds.digest("hex");
    observation.expectedCsvDataSha256 = csvData.digest("hex"); observation.phaseCosts.oracle.stoppedAtMs = resourceClock();
    const exportWorker = fixture.workers[exporter.worker];
    let primarySettled = false;
    const primaryIndex = report.requests.length;
    const primary = primaryExport = streamStocktakeCsv(fixture, exporter, header.id, exportWorker, normalSampling,
      { workflowVersion: header.version, outcome: "COMPLETE" });
    const settlement = primary.then(() => { primarySettled = true; }, () => { primarySettled = true; });
    const primaryRequest = report.requests[primaryIndex];
    let ready;
    for (;;) {
      if (primarySettled) break;
      const checkpoint = await exportWorker.resourceCheckpoint();
      ready = checkpoint.sample.files.some(file => file.requestId === primaryRequest.requestId) &&
        checkpoint.sample.activeTransports.some(socket => socket.requestId === primaryRequest.requestId && socket.kind === "AUXILIARY");
      if (ready) break;
      await Promise.race([settlement, setTimeout(1000)]);
    }
    const parallel = await Promise.allSettled([primary,
      ready ? streamStocktakeCsv(fixture, exporter, header.id, exportWorker, normalSampling,
        { workflowVersion: header.version, outcome: "BUSY" }) : Promise.resolve(null)]);
    for (const attempt of parallel) if (attempt.status === "rejected") throw attempt.reason;
    observation.primaryTen = parallel[0].value; observation.busyAttempt = parallel[1].value;
    assert.ok(observation.busyAttempt, "UNKNOWN: primary generation ended before a resource-owned rejection could be dispatched");
    const completed = await exportWorker.resourceCheckpoint(true), owned = completed.resources;
    const primaryFiles = owned.files.filter(file => file.requestId === observation.primaryTen.requestId);
    const primarySockets = owned.transports.filter(socket => socket.kind === "AUXILIARY" && socket.requestId === observation.primaryTen.requestId);
    observation.primaryTenTerminal = { atMs: owned.atMs, files: primaryFiles, transports: primarySockets, provenance: "EXACT_REQUEST_CONTEXT_BEFORE_COMPATIBILITY_OR_SHUTDOWN" };
    assert.equal(primaryFiles.length, 1); assert.equal(primarySockets.length, 1);
    assert.ok(primaryFiles[0].nlink === 0 && primaryFiles[0].size > 0, "Primary-ten anonymous bytes were NOT_OBSERVED");
    assert.ok(primaryFiles.every(file => file.closeObservation === "ORIGINAL_CLOSE_FULFILLED" && file.closedAtMs !== null));
    assert.ok(primarySockets.every(socket => socket.closedAtMs !== null && socket.mappingObservation === "SAME_CONNECTION_DRIVER_QUERY_ACKNOWLEDGED"));
    assert.ok(primaryFiles[0].closedAtMs <= owned.atMs && primarySockets[0].closedAtMs <= owned.atMs);
    const busy = observation.busyAttempt;
    assert.equal(owned.files.filter(file => file.requestId === busy.requestId).length, 0, "Rejected dispatch created a second file");
    assert.equal(owned.pools.filter(pool => pool.requestId === busy.requestId && pool.kind === "AUXILIARY").length, 0, "Rejected dispatch created a second reader pool");
    assert.equal(owned.transports.filter(socket => socket.requestId === busy.requestId && socket.kind === "AUXILIARY").length, 0, "Rejected dispatch created a second reader transport");
    assert.ok(primaryFiles[0].createdAtMs <= busy.dispatchAtMs && primaryFiles[0].closedAtMs >= busy.responseCompleteAtMs &&
      primarySockets[0].openedAtMs <= busy.dispatchAtMs && primarySockets[0].closedAtMs >= busy.responseCompleteAtMs,
    "UNKNOWN: owned generation lifetime did not cover rejected dispatch through response consumption");
    assert.equal(busy.outcome, "DEPENDENCY_FAIL_UNPROVEN_BUSY");
    assert.deepEqual([observation.busyAttempt.status, observation.busyAttempt.code], [503, "INVENTORY_DEPENDENCY_UNAVAILABLE"]);
    busy.outcome = "BUSY"; busy.busyProvenance = "OWNED_PRIMARY_FILE_AND_AUXILIARY_TRANSPORT_SPAN_DISPATCH_AND_REJECTION; NO_REJECTED_REQUEST_RESOURCES";
    const verifyCsv = csv => {
      assert.equal(csv.outcome, "COMPLETE"); assert.equal(csv.scopes, 200); assert.equal(csv.lines, 99800);
      assert.deepEqual([csv.summary.scopeCount, csv.summary.filteredLineCount, csv.summary.exportedRows, csv.summary.truncated, csv.summary.truncationReason],
        ["200", "100000", "100000", "true", "ROW_LIMIT"]);
      assert.equal(csv.orderedIdsSha256, observation.expectedCsvIdsSha256);
      assert.equal(csv.dataSha256, observation.expectedCsvDataSha256);
      assert.equal(csv.summary.stocktakeNumber, stocktakeCsvExpectedCell(common.stocktakeNumber));
      assert.equal(csv.summary.workflowVersion, String(common.workflowVersion));
      assert.equal(csv.summary.filterHash, sha(JSON.stringify({ stocktakeId: header.id, filters: {} })));
    };
    verifyCsv(observation.primaryTen);
    const normalPeriod = await normalSampling.stop();
    observation.primaryTenCoverage = stocktakeResourceCoverage(normalPeriod, resourceWorkers, [observation.primaryTen, busy]);
    for (const phase of Object.values(observation.phaseCosts)) {
      phase.elapsedMs = phase.stoppedAtMs - phase.startedAtMs;
      phase.parent = stocktakeResourceDistribution(normalPeriod.samples, phase.startedAtMs, phase.stoppedAtMs);
      phase.workers = resourceWorkers.map(worker => ({ incarnation: worker.incarnation,
        minutes: stocktakeResourceDistribution(worker.resourceSamples, phase.startedAtMs, phase.stoppedAtMs) }));
    }
    observation.phaseCosts.primaryTenExport = observation.primaryTenCoverage;
    assert.equal(observation.primaryTenCoverage.status, "COMPLETE");
    // Existing workers are quiescent during this separately reported, approved compatibility child.
    compatibility = await fixture.createPoolOneWorker();
    poolOneSampling = await startStocktakeResourceSampling(fixture, [compatibility]);
    observation.primaryOne = await streamStocktakeCsv(fixture, exporter, header.id, compatibility, poolOneSampling,
      { workflowVersion: header.version, outcome: "COMPLETE" }); verifyCsv(observation.primaryOne);
    const ownOne = (await compatibility.resourceCheckpoint(true)).resources;
    observation.primaryOneTerminal = { atMs: ownOne.atMs,
      files: ownOne.files.filter(file => file.requestId === observation.primaryOne.requestId),
      transports: ownOne.transports.filter(socket => socket.kind === "AUXILIARY" && socket.requestId === observation.primaryOne.requestId),
      provenance: "EXACT_REQUEST_CONTEXT_BEFORE_SHUTDOWN" };
    assert.equal(observation.primaryOneTerminal.files.length, 1); assert.equal(observation.primaryOneTerminal.transports.length, 1);
    assert.ok(observation.primaryOneTerminal.files[0].nlink === 0 && observation.primaryOneTerminal.files[0].size > 0, "Primary-one anonymous bytes were NOT_OBSERVED");
    assert.ok(observation.primaryOneTerminal.files.every(file => file.closeObservation === "ORIGINAL_CLOSE_FULFILLED" && file.closedAtMs !== null));
    assert.ok(observation.primaryOneTerminal.transports.every(socket => socket.closedAtMs !== null && socket.mappingObservation === "SAME_CONNECTION_DRIVER_QUERY_ACKNOWLEDGED"));
    const poolOnePeriod = await poolOneSampling.stop();
    observation.primaryOneCoverage = stocktakeResourceCoverage(poolOnePeriod, [compatibility], [observation.primaryOne]);
    observation.phaseCosts.primaryOneExport = observation.primaryOneCoverage;
    assert.equal(observation.primaryOneCoverage.status, "COMPLETE");
    observation.resourceCoverage = { status: observation.primaryTenCoverage.status === "COMPLETE" && observation.primaryOneCoverage.status === "COMPLETE" ? "COMPLETE" : "INCOMPLETE" };
  } catch (error) {
    primaryError = error; observation.outcome = "FAIL"; observation.error = errorObservation(error);
    if (error.ownedStop) observation.poolOneCleanup = { status: "BOOT_FAILED_SQL_TERMINAL_UNKNOWN", stop: error.ownedStop, history: error.ownedResourceHistory ?? null };
  }
  finally {
    if (primaryExport) await primaryExport.catch(error => { primaryError ??= error; });
    for (const sampling of [normalSampling, poolOneSampling]) if (sampling) try { await sampling.stop(); }
    catch (error) { primaryError ??= error; observation.samplingStopError = errorObservation(error); }
    if (compatibility) {
      const cleanup = observation.poolOneCleanup; cleanup.status = "IN_PROGRESS";
      const capture = { workers: [] };
      try {
        await captureOwnedSql(db, [compatibility], capture); await compatibility.close();
        cleanup.stop = await compatibility.stop();
        await verifyOwnedSqlTerminal(db, compatibility, cleanup.stop, capture.workers[0]);
        cleanup.status = capture.workers[0].status;
      } catch (error) {
        primaryError ??= error; cleanup.status = "FAILED_OR_UNKNOWN"; cleanup.error = errorObservation(error);
        cleanup.stop ??= await compatibility.stop();
      } finally {
        observationOwners.set(db, fixture.workers);
        cleanup.capture = capture; cleanup.identities = [...compatibility.observationIdentities.values()];
        cleanup.connectionEvents = compatibility.connectionEvents; cleanup.mappingStats = compatibility.mappingStats;
        cleanup.resourceFinal = compatibility.resourceFinal; cleanup.resourceSamples = compatibility.resourceSamples;
        cleanup.stderr = compatibility.stderr;
      }
    }
    if (header && !fixture.workers[writer.worker].quarantined) try {
      const result = await command("cancel", { source: source(), expectedVersion: header.version, reason: "Owned CSV characterization cleanup", password: writer.password });
      assert.equal(result.status, "CANCELLED");
    } catch (error) { primaryError ??= error; observation.cancelError = errorObservation(error); }
  }
  const samples = [...fixture.workers[exporter.worker].resourceSamples, ...(compatibility?.resourceSamples ?? [])];
  const knownAnonymousBytes = samples.map(sample => sample.anonymousBytes).filter(value => value !== null);
  observation.resourceFacts = {
    anonymousHighWaterBytes: knownAnonymousBytes.length ? Math.max(...knownAnonymousBytes) : null,
    anonymousUnknownSamples: samples.filter(sample => sample.anonymousBytes === null).length,
    anonymousSamples: samples.flatMap(sample => sample.files).filter(file => file.nlink === 0 && file.size > 0).length,
    primaryOneConfiguredLimits: [...new Set((compatibility?.resourceSamples ?? []).flatMap(sample => sample.pools).filter(pool => pool.kind === "PRIMARY").map(pool => pool.configuredLimit))],
    maxAuxiliaryLive: Math.max(0, ...samples.map(sample => sample.transportHighWater.auxiliary))
  };
  try {
    fixture.exportAuditRequests ??= new Map(); observation.exportAudits = [];
    fixture.exportAuditEvidence ??= new Map();
    for (const exported of report.requests.slice(firstRequest).filter(row => row.action === "/api/v1/inventory/stocktakes/:id/export")) {
      assert.ok(fixture.exportAuditRequests.has(exported.requestId), "Export Audit discovery is limited to pre-registered dispatches");
      const intent = fixture.exportAuditRequests.get(exported.requestId);
      assert.equal(exported.outcome, intent.outcome); assert.equal(exported.requestIdEchoObservation, "MATCHED");
      const audits = await readStocktakeExportAuditEvidence(db, intent, exported);
      assert.ok(!fixture.exportAuditEvidence.has(exported.requestId)); fixture.exportAuditEvidence.set(exported.requestId, audits);
      observation.exportAudits.push({ requestId: exported.requestId, intent, audits, provenance: "ACTUAL_NATIVE_AUDIT_ROWS_NOT_EXPECTATIONS" });
    }
    assert.ok(observation.resourceFacts.anonymousSamples > 0, "Anonymous handle bytes/nlink were NOT_OBSERVED");
    assert.deepEqual(observation.resourceFacts.primaryOneConfiguredLimits, [1]);
    assert.ok(observation.resourceFacts.maxAuxiliaryLive <= 1);
    assert.equal(compatibility?.resourceFinal?.activeHandles, 0); assert.equal(compatibility?.resourceFinal?.activeTransports, 0);
    assert.ok(compatibility?.resourceFinal?.files.some(file => file.nlink === 0 && file.closeObservation === "ORIGINAL_CLOSE_FULFILLED"));
    assert.ok(compatibility.resourceFinal.files.some(file => file.nlink === 0 && file.size > 0), "Pool-one anonymous byte size was NOT_OBSERVED");
  } catch (error) { primaryError ??= error; observation.resourceError = errorObservation(error); }
  if (primaryError) { observation.outcome = "FAIL"; throw primaryError; }
  observation.outcome = "COMPLETE"; return observation;
}

async function stocktakeCleanupHistory(fixture, id) {
  const create = [...fixture.stocktakeCommands.values()].find(record => record.action === "create" && record.result.id === id);
  assert.ok(create);
  const { warehouseId, binIds } = create.body, state = await stocktakeHistory(fixture, id);
  state.scopeBalances = await rowDigest(fixture.db, "inventory_stock_balances", "warehouse_id=? AND bin_id IN (?)", [warehouseId, binIds]);
  state.scopeControls = await rowDigest(fixture.db, "inventory_stock_controls",
    "warehouse_id=? AND sku_id IN (SELECT sku_id FROM inventory_stock_balances WHERE warehouse_id=? AND bin_id IN (?))", [warehouseId, warehouseId, binIds]);
  return state;
}
async function reservationHistory(fixture, create) {
  const state = {}, id = create.result.id, scope = [create.body.warehouseId, create.body.skuId];
  state.reservation = await rowDigest(fixture.db, "inventory_reservations", "id=?", [id]);
  state.control = await rowDigest(fixture.db, "inventory_stock_controls", "warehouse_id=? AND sku_id=?", scope);
  state.balances = await rowDigest(fixture.db, "inventory_stock_balances", "warehouse_id=? AND sku_id=?", scope);
  for (const record of fixture.reservationCommands.values()) if (record.result.id === id) {
    for (const table of ["inventory_operation_requests", "inventory_audit_logs"])
      state[`${table}:${record.result.operationId}`] = await rowDigest(fixture.db, table, table === "inventory_operation_requests" ? "id=?" : "operation_request_id=?", [record.result.operationId]);
  }
  return state;
}
function assertReservationIntent(result, create, cancelled = false) {
  const { body } = create;
  assert.ok(Number.isSafeInteger(result.id) && result.id > 0);
  assert.ok(Number.isSafeInteger(result.operationId) && result.operationId > 0);
  assert.deepEqual([result.warehouseId, result.skuId, result.purpose, result.minimumRemainingDays, result.originalQuantity,
    result.consumedQuantity, result.releasedQuantity, result.outstandingQuantity, result.status, result.version],
  [body.warehouseId, body.skuId, body.purpose, body.minimumRemainingDays, body.quantity, 0,
    cancelled ? body.quantity : 0, cancelled ? 0 : body.quantity, cancelled ? "CANCELLED" : "ACTIVE", cancelled ? 2 : 1]);
  if (cancelled) assert.equal(result.id, create.result.id);
}
function commandRequestId(report, index, actorId, route) {
  assert.ok(Number.isSafeInteger(index) && index >= 0);
  const row = report.requests[index]; assert.ok(row, "Original command dispatch row is required");
  assert.equal(row.actor, actorId); assert.equal(row.action, route.replace(/\/\d+(?=\/|\?|$)/gu, "/:id"));
  assert.ok(row.dispatchAt !== null); assert.equal(row.outcome, "COMPLETE"); assert.equal(row.status, 200);
  assert.equal(row.requestIdEchoObservation, "MATCHED"); assert.equal(row.requestIdEcho, row.requestId);
  assert.equal(report.requests.filter(other => other.requestId === row.requestId).length, 1);
  return row.requestId;
}
function verifySeedAudit(row, intent) {
  const auditId = Number(row.id), operationId = Number(row.operation_request_id);
  assert.ok(Number.isSafeInteger(auditId) && auditId > 0);
  assert.ok(Number.isSafeInteger(operationId) && operationId >= 1 && operationId <= 500000);
  assert.deepEqual({ ...row, id: auditId, occurred_at: Number(row.occurred_at), actor_user_id: Number(row.actor_user_id),
    target_id: Number(row.target_id), operation_request_id: operationId,
    after_summary: typeof row.after_summary === "string" ? JSON.parse(row.after_summary) : row.after_summary }, {
    id: auditId, occurred_at: intent.timestamp, actor_user_id: intent.actorId, actor_label: "Synthetic fixture",
    action: "inventory.receipt", target_type: "movement_group", target_id: operationId, target_label: String(operationId),
    outcome: "SUCCEEDED", reason_category: "", reason_text: "", before_summary: null,
    after_summary: { quantity: 100, version: 4, rowCount: 4 }, operation_request_id: operationId,
    request_id: "", correlation_id: "", ip: ""
  });
  return operationId;
}
async function verifySeedIntent(db, intent) {
  const { actorId, day, expiry } = intent;
  let after = 0, count = 0;
  for (;;) {
    const [rows] = await db.query(`SELECT b.*,DATE_FORMAT(b.fifo_anchor_date,'%Y-%m-%d') AS seed_fifo,s.tracking_policy,l.sku_id AS lot_sku,l.lot_number,
      DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry_date,DATE_FORMAT(l.first_receipt_date,'%Y-%m-%d') AS first_receipt_date,
      o.command_type,o.source_module,o.source_document_type,o.source_document_id,o.source_line_id,o.source_event_id,o.request_hash,o.result_type,o.result_id,o.result_summary,o.actor_user_id,
      (SELECT COUNT(*) FROM inventory_movements m WHERE m.operation_request_id=b.id) AS legs,
      (SELECT COUNT(DISTINCT m.balance_version_after) FROM inventory_movements m WHERE m.operation_request_id=b.id) AS leg_versions,
      (SELECT COUNT(*) FROM inventory_movements m WHERE m.operation_request_id=b.id AND
        (BINARY m.movement_group_id<>BINARY o.result_id OR m.movement_type<>'RECEIPT' OR m.location_kind<>'BIN' OR m.warehouse_id<>b.warehouse_id OR m.bin_id<>b.bin_id OR
         m.sku_id<>b.sku_id OR NOT(m.lot_id<=>b.lot_id) OR m.stock_status<>b.stock_status OR m.direction<>'IN' OR m.quantity<>25 OR
         m.balance_version_after NOT BETWEEN 1 AND 4 OR m.balance_before<>(m.balance_version_after-1)*25 OR m.balance_after<>m.balance_version_after*25 OR
         BINARY m.sku_code_snapshot<>BINARY s.sku_code OR BINARY m.sku_name_snapshot<>BINARY s.sku_name OR BINARY m.warehouse_code_snapshot<>BINARY w.warehouse_code OR BINARY m.bin_code_snapshot<>BINARY bn.bin_code OR
         BINARY m.lot_number_snapshot<>BINARY COALESCE(l.lot_number,'') OR NOT(m.expiry_date_snapshot<=>l.expiry_date) OR NOT(m.posted_by<=>?))) AS bad_legs
      FROM inventory_stock_balances b JOIN item_skus s ON s.id=b.sku_id JOIN inventory_warehouses w ON w.id=b.warehouse_id
      JOIN inventory_bins bn ON bn.id=b.bin_id LEFT JOIN inventory_lots l ON l.id=b.lot_id JOIN inventory_operation_requests o ON o.id=b.id
      WHERE b.id>? ORDER BY b.id LIMIT 500`, [actorId, after]);
    if (!rows.length) break;
    for (const row of rows) {
      after = Number(row.id); count++;
      const warehouse = Math.floor((after - 1) / 100000) + 1, local = (after - 1) % 100000;
      const sku = Math.floor(local / 2) + 1, leg = local % 2, tracking = (sku - 1) % 4 < 2 ? "none" : (sku - 1) % 4 === 2 ? "batch" : "batch_expiry";
      assert.deepEqual([Number(row.warehouse_id), Number(row.bin_id), Number(row.sku_id), row.lot_id === null ? null : Number(row.lot_id), row.stock_status,
        Number(row.on_hand_quantity), Number(row.allocated_quantity), Number(row.version), Number(row.legs), Number(row.leg_versions), Number(row.bad_legs)],
      [warehouse, (warehouse - 1) * 200 + (Math.floor((sku - 1) / 4) + leg * 100) % 200 + 1, sku, tracking === "none" ? null : sku,
        leg === 0 ? "AVAILABLE" : sku % 2 === 0 ? "QUARANTINED" : "DAMAGED", 100, 0, 4, 4, 4, 0]);
      assert.equal(row.seed_fifo, day); assert.equal(row.tracking_policy, tracking);
      assert.deepEqual([row.lot_sku === null ? null : Number(row.lot_sku), row.lot_number, row.expiry_date],
        tracking === "none" ? [null, null, null] : [sku, `L-${sku}`, tracking === "batch_expiry" ? expiry : null]);
      assert.equal(row.first_receipt_date, tracking === "none" ? null : day);
      const group = `00000000-0000-4000-8000-${String(after).padStart(12, "0")}`;
      assert.deepEqual([row.command_type, row.source_module, row.source_document_type, row.source_document_id, row.source_line_id, row.source_event_id,
        row.request_hash, row.result_type, row.result_id, Number(row.actor_user_id)],
      ["RECEIPT_POST", "PERFORMANCE", "SYNTHETIC_BASELINE", String(after), "", "baseline", sha(`fixture-${after}`), "MOVEMENT_GROUP", group, actorId]);
      const summary = typeof row.result_summary === "string" ? JSON.parse(row.result_summary) : row.result_summary;
      assert.deepEqual(summary, { movementGroupId: group, status: "POSTED", lineCount: 4 });
    }
  }
  assert.equal(count, 500000);
  after = 0;
  const operations = new Set();
  for (;;) {
    const [rows] = await db.query("SELECT * FROM inventory_audit_logs WHERE id>? ORDER BY id LIMIT 500", [after]);
    if (!rows.length) break;
    for (const row of rows) {
      after = Number(row.id);
      const operationId = verifySeedAudit(row, intent);
      assert.equal(operations.has(operationId), false, "Exactly one baseline Audit per seeded Operation");
      operations.add(operationId);
    }
  }
  assert.equal(operations.size, 500000);
}

const jsonValue = value => typeof value === "string" ? JSON.parse(value) : value;
const businessMutableFields = {
  inventory_stock_balances: ["on_hand_quantity", "version", "updated_at"],
  inventory_stock_controls: ["reserved_quantity", "version", "updated_at"]
};
async function rowDigest(db, table, where = "1=1", parameters = [], omit = []) {
  assert.match(table, /^inventory_[a-z_]+$/u);
  const digest = createHash("sha256"); let lastId = 0, count = 0;
  for (;;) {
    const [rows] = await db.query(`SELECT * FROM ${table} WHERE (${where}) AND id>? ORDER BY id LIMIT 500`, [...parameters, lastId]);
    if (!rows.length) break;
    for (const row of rows) {
      assert.ok(Number(row.id) > lastId); lastId = Number(row.id); count++;
      digest.update(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !omit.includes(key)))) + "\n");
    }
  }
  return { count, lastId, sha256: digest.digest("hex") };
}
async function businessState(db) {
  const [tables] = await db.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,10)='inventory_' ORDER BY TABLE_NAME");
  const state = {};
  for (const { name } of tables) {
    state[name] = await rowDigest(db, name, "1=1", [], businessMutableFields[name]);
    if (name === "inventory_stock_balances") state[name].untouched = await rowDigest(db, name, "warehouse_id<>1");
    if (name === "inventory_stock_controls") state[name].untouched = await rowDigest(db, name, "sku_id NOT IN (1,3,4)");
  }
  return state;
}
async function verifyCommandOperation(db, record, family, actorLabel) {
  const { body, result, actorId, action } = record, origin = body.source;
  const input = Object.fromEntries(Object.entries(body).filter(([key]) => !["source", "password"].includes(key)));
  const payload = family === "STOCKTAKE" ? { ...(action === "create" ? {} : { stocktakeId: result.id }), ...input } :
    action === "create" ? input : { reservationId: result.id, expectedVersion: body.version };
  const type = `${family}_${action === "counts/save" ? "COUNT" : action.toUpperCase()}`;
  const [[operation]] = await db.execute("SELECT * FROM inventory_operation_requests WHERE id=?", [result.operationId]);
  assert.ok(operation); assert.equal(operation.command_type, type);
  assert.equal(operation.request_id, record.requestId); assert.equal(operation.correlation_id, record.requestId);
  assert.equal(sha(JSON.stringify([operation.source_module, operation.source_document_type, operation.source_document_id, operation.source_line_id, operation.source_event_id])),
    sha(JSON.stringify([origin.module, origin.documentType, origin.documentId, origin.lineId ?? "", origin.eventId])));
  assert.equal(operation.request_hash, inventoryOperationHash({ commandType: type, payload }));
  assert.equal(operation.actor_label, actorLabel);
  assert.equal(Number(operation.actor_user_id), actorId); assert.ok(Number(operation.completed_at) >= Number(operation.created_at));
  assert.equal(operation.result_type, family); assert.equal(operation.result_id, String(result.id));
  const expectedSummary = family === "RESERVATION" ? { ...Object.fromEntries(Object.entries(result).filter(([key]) => !["id", "availability"].includes(key))), reservationId: result.id, ...result.availability } : result;
  assert.deepEqual(jsonValue(operation.result_summary), expectedSummary);
  return operation;
}
function assertAudit(row, record, action, before, after, requestId) {
  assert.equal(row.action, action); assert.equal(row.outcome, "SUCCEEDED"); assert.equal(Number(row.actor_user_id), record.actorId);
  assert.equal(row.target_type, action.startsWith("reservation.") ? "reservation" : "stocktake");
  assert.equal(Number(row.target_id), record.result.id); assert.equal(Number(row.operation_request_id), record.result.operationId);
  assert.equal(row.actor_label, record.actorLabel);
  assert.equal(row.target_label, action.startsWith("reservation.") ? String(record.result.id) : record.stocktakeNumber);
  const reason = ["stocktake.create", "stocktake.start", "stocktake.ready"].includes(action) ? record.createReason : action === "stocktake.cancel" ? record.body.reason : "";
  assert.deepEqual([row.reason_category, row.reason_text], ["", reason]);
  assert.equal(row.request_id, requestId); assert.equal(row.correlation_id, requestId);
  assert.deepEqual(jsonValue(row.before_summary), before); assert.deepEqual(jsonValue(row.after_summary), after);
}
async function verifyStocktakeCommands(fixture, stocktakeId, lines = new Map()) {
  const { db, stocktakeCommands } = fixture;
  const records = [...stocktakeCommands.values()].filter(record => record.result.id === stocktakeId).sort((a,b) => a.result.operationId - b.result.operationId);
  assert.ok(records.length >= 2); let previous;
  const creates = records.filter(record => record.action === "create"); assert.equal(creates.length, 1);
  const expectedNumber = `ST-${creates[0].result.operationId}`;
  const [[storedHeader]] = await db.execute("SELECT stocktake_number FROM inventory_stocktakes WHERE id=?", [stocktakeId]);
  assert.equal(storedHeader.stocktake_number, expectedNumber);
  for (const record of records) {
    await verifyCommandOperation(db, record, "STOCKTAKE", fixture.actors.find(actor => actor.id === record.actorId).username);
    const { action, result, body } = record;
    record.actorLabel = fixture.actors.find(actor => actor.id === record.actorId).username;
    record.createReason = creates[0].body.reason;
    record.stocktakeNumber = expectedNumber;
    const expectedIds = new Set(action === "counts/save" ? body.lines.map(line => line.lineId) : action === "post" ? [...lines.keys()].filter(id => lines.get(id).variance !== 0) : []);
    let afterId = 0, headerAudits = 0, count = 0;
    for (;;) {
      const [audits] = await db.execute("SELECT * FROM inventory_audit_logs WHERE operation_request_id=? AND id>? ORDER BY id LIMIT 500", [result.operationId, afterId]);
      if (!audits.length) break;
      for (const audit of audits) {
        afterId = Number(audit.id); count++;
        const after = jsonValue(audit.after_summary), lineId = after?.id;
        if (action === "counts/save") {
          assert.equal(expectedIds.delete(lineId), true, "Exactly one Count Audit per original line");
          const input = body.lines.find(line => line.lineId === lineId);
          assertAudit(audit, record, "stocktake.count", { id: lineId, stocktakeId, quantity: null, version: input.expectedVersion, status: "UNCOUNTED" },
            { id: lineId, stocktakeId, quantity: input.countedQuantity, version: input.expectedVersion + 1, status: "COUNTED" }, record.requestId);
        } else if (action === "post" && lineId !== undefined) {
          assert.equal(expectedIds.delete(lineId), true, "Exactly one Post Audit per nonzero Movement");
          const line = lines.get(lineId);
          assertAudit(audit, record, "stocktake.post", { id: lineId, stocktakeId, quantity: line.snapshotQuantity, version: line.snapshotBalanceVersion, status: line.stockStatus, movementId: null },
            { id: lineId, stocktakeId, quantity: line.snapshotQuantity + line.variance, version: line.snapshotBalanceVersion + 1, status: line.stockStatus, movementId: line.movementId }, record.requestId);
        } else {
          headerAudits++;
          const before = action === "create" ? null : { stocktakeId, status: record.beforeStatus ?? previous.status, version: body.expectedVersion };
          assertAudit(audit, record, `stocktake.${action}`, before, { stocktakeId, status: result.status, version: result.version, rowCount: result.rowCount }, record.requestId);
        }
      }
    }
    assert.equal(expectedIds.size, 0); assert.equal(headerAudits, action === "counts/save" ? 0 : 1);
    assert.equal(count, action === "counts/save" ? body.lines.length : action === "post" ? result.rowCount + 1 : 1);
    previous = result;
  }
}
async function stocktakeHistory(fixture, id) {
  const state = {};
  for (const table of ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_bin_locks", "inventory_stocktake_lines"])
    state[table] = await rowDigest(fixture.db, table, table === "inventory_stocktakes" ? "id=?" : "stocktake_id=?", [id]);
  for (const record of fixture.stocktakeCommands.values()) if (record.result.id === id) {
    const operationId = record.result.operationId;
    for (const table of ["inventory_operation_requests", "inventory_audit_logs", "inventory_movements"])
      state[`${table}:${operationId}`] = await rowDigest(fixture.db, table, table === "inventory_operation_requests" ? "id=?" : "operation_request_id=?", [operationId]);
  }
  return state;
}
async function verifyStocktakeOwnership(fixture, id) {
  const records = [...fixture.stocktakeCommands.values()].filter(record => record.result.id === id).sort((a,b) => a.result.operationId - b.result.operationId);
  const created = records.filter(record => record.action === "create"), started = records.filter(record => record.action === "start");
  assert.equal(created.length, 1); assert.equal(started.length, 1);
  const latest = records.at(-1), binIds = created[0].body.binIds;
  assert.ok(["POSTED", "CANCELLED"].includes(latest.result.status), "All normal workloads must be terminal before reconciliation");
  const [[header]] = await fixture.db.execute("SELECT * FROM inventory_stocktakes WHERE id=?", [id]);
  assert.equal(header.stocktake_number, `ST-${created[0].result.operationId}`);
  assert.deepEqual([header.status, Number(header.version), Number(header.warehouse_id), Number(header.created_by)],
    [latest.result.status, latest.result.version, created[0].body.warehouseId, created[0].actorId]);
  for (const action of ["create", "start", "ready", "post", "cancel"]) {
    const command = records.find(record => record.action === action);
    assert.equal(header[`${action}_operation_id`] === null ? null : Number(header[`${action}_operation_id`]), command?.result.operationId ?? null);
  }
  const [scopes] = await fixture.db.execute("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id=? ORDER BY bin_id,id LIMIT 201", [id]);
  const [locks] = await fixture.db.execute("SELECT * FROM inventory_bin_locks WHERE stocktake_id=? ORDER BY bin_id,id LIMIT 201", [id]);
  assert.deepEqual(scopes.map(row => Number(row.bin_id)), binIds); assert.equal(locks.length, binIds.length);
  for (const [index, lock] of locks.entries()) {
    assert.deepEqual([Number(lock.stocktake_id), Number(lock.stocktake_bin_id), Number(lock.bin_id), lock.lock_type, Number(lock.locked_by), Number(lock.released_by), lock.release_reason],
      [id, Number(scopes[index].id), binIds[index], "STOCKTAKE", started[0].actorId, latest.actorId, latest.result.status]);
    assert.ok(lock.released_at !== null); assert.equal(lock.active_scope, null);
  }
  if (!records.some(record => ["post", "counts/save"].includes(record.action))) {
    await verifyStocktakeCommands(fixture, id);
    let after = 0, count = 0;
    for (;;) {
      const [rows] = await fixture.db.execute(`SELECT l.*,b.on_hand_quantity,b.version AS balance_version,b.bin_id AS balance_bin,b.sku_id AS balance_sku,b.lot_id AS balance_lot,b.stock_status AS balance_status
        FROM inventory_stocktake_lines l JOIN inventory_stock_balances b ON b.id=l.stock_balance_id WHERE l.stocktake_id=? AND l.id>? ORDER BY l.id LIMIT 500`, [id, after]);
      if (!rows.length) break;
      for (const row of rows) {
        after = Number(row.id); count++;
        assert.equal(scopes.some(scope => Number(scope.id) === Number(row.stocktake_bin_id) && Number(scope.bin_id) === Number(row.bin_id)), true);
        assert.deepEqual([Number(row.bin_id), Number(row.sku_id), row.lot_id, row.stock_status, Number(row.snapshot_quantity), Number(row.snapshot_balance_version), row.counted_quantity, row.variance_quantity, row.movement_id, Number(row.version)],
          [Number(row.balance_bin), Number(row.balance_sku), row.balance_lot, row.balance_status, Number(row.on_hand_quantity), Number(row.balance_version), null, null, null, 1]);
      }
    }
    assert.equal(count, started[0].result.rowCount);
  }
}
async function verifyBusinessReconciliation(fixture, cancelled = false) {
  const verificationStarted = performance.now();
  const { db, businessBaseline, stocktakeCommands, reservationCommands, reservations, exportAuditRequests, exportAuditEvidence, report, balanceEffects } = fixture;
  assert.ok(businessBaseline, "Full whole-database baseline is required");
  const knownOperations = new Map([...stocktakeCommands, ...reservationCommands]);
  const knownHeaders = new Set([...stocktakeCommands.values()].map(record => record.result.id));
  const reservationCreates = [...reservationCommands.values()].filter(record => record.action === "create");
  const knownReservations = new Map(reservationCreates.map(record => [record.result.id, record]));
  let movements = 0, audits = 0, lineCount = 0, scopes = 0, locks = 0;
  const operationTimes = new Map(), controlTimes = new Map();
  for (const id of knownHeaders) {
    const records = [...stocktakeCommands.values()].filter(record => record.result.id === id);
    if (["POSTED", "CANCELLED"].includes(records.at(-1).result.status)) await verifyStocktakeOwnership(fixture, id);
    else assert.equal(records.at(-1).result.status, "COUNTING");
  }
  for (const [id, record] of knownOperations) {
    assert.equal(id, record.result.operationId);
    const created = reservationCommands.has(id) ? knownReservations.get(record.result.id) : null;
    if (created) assertReservationIntent(record.result, created, record.action === "cancel");
    const checkedOperation = await verifyCommandOperation(db, record, stocktakeCommands.has(id) ? "STOCKTAKE" : "RESERVATION", fixture.actors.find(actor => actor.id === record.actorId).username);
    operationTimes.set(id, Number(checkedOperation.completed_at));
    if (reservationCommands.has(id)) {
      assert.ok(created); controlTimes.set(`${created.body.warehouseId}:${created.body.skuId}`, Number(checkedOperation.completed_at));
    }
    if (stocktakeCommands.has(id)) {
      if (record.action === "post") movements += record.result.rowCount;
      audits += record.action === "counts/save" ? record.body.lines.length : record.action === "post" ? record.result.rowCount + 1 : 1;
      if (record.action === "create") scopes += record.body.binIds.length;
      if (record.action === "start") { locks += record.body.binIds?.length ?? [...stocktakeCommands.values()].find(r => r.action === "create" && r.result.id === record.result.id).body.binIds.length; lineCount += record.result.rowCount; }
    } else {
      audits++;
      record.actorLabel = fixture.actors.find(actor => actor.id === record.actorId).username;
      const [auditRows] = await db.execute("SELECT * FROM inventory_audit_logs WHERE operation_request_id=? ORDER BY id LIMIT 2", [id]);
      assert.equal(auditRows.length, 1); const audit = auditRows[0];
      const before = record.action === "create" ? { skuId: created.body.skuId, warehouseId: created.body.warehouseId, quantity: 0 } : { reservationId: record.result.id, quantity: created.body.quantity, status: "ACTIVE", version: 1 };
      assertAudit(audit, record, `reservation.${record.action}`, before,
        { reservationId: record.result.id, quantity: record.result.outstandingQuantity, status: record.result.status, version: record.result.version }, record.requestId);
    }
  }
  const verifiedExportIds = new Set();
  for (const [requestId, intent] of exportAuditRequests) {
    assert.equal(requestId, intent.requestId);
    const sent = report.requests.filter(request => request.requestId === requestId);
    assert.equal(sent.length, 1); assert.ok(sent[0].dispatchAt !== null);
    const evidence = exportAuditEvidence.get(requestId); assert.ok(evidence, "Every export requires separate native evidence");
    const csv = [report.exportCapacity?.primaryTen, report.exportCapacity?.primaryOne].find(row => row?.requestId === requestId);
    const verified = verifyStocktakeExportAuditRows(evidence.map(item => item.row), intent, csv);
    for (const item of verified) { assert.equal(verifiedExportIds.has(item.auditId), false); verifiedExportIds.add(item.auditId); }
  }
  assert.equal(exportAuditEvidence.size, exportAuditRequests.size);
  const dispatchedExports = report.requests.filter(request => request.action === "/api/v1/inventory/stocktakes/:id/export" && request.dispatchAt !== null);
  assert.equal(dispatchedExports.length, exportAuditRequests.size);
  const exportAuditCount = verifiedExportIds.size;
  const additions = { inventory_operation_requests: knownOperations.size, inventory_audit_logs: audits + exportAuditCount,
    inventory_movements: movements, inventory_stocktakes: knownHeaders.size, inventory_stocktake_bins: scopes,
    inventory_bin_locks: locks, inventory_stocktake_lines: lineCount, inventory_reservations: reservations.length };
  const actualCounts = {};
  for (const [table, baseline] of Object.entries(businessBaseline)) {
    const { untouched, ...digest } = baseline;
    assert.deepEqual(await rowDigest(db, table, "id<=?", [baseline.lastId], businessMutableFields[table]), digest, `Original ${table} rows changed`);
    if (untouched) assert.deepEqual(await rowDigest(db, table, table === "inventory_stock_balances" ? "warehouse_id<>1" : "sku_id NOT IN (1,3,4)"), untouched, `Untouched ${table} rows changed, including timestamps`);
    const [[actual]] = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
    actualCounts[table] = Number(actual.n);
    assert.equal(Number(actual.n), baseline.count + (additions[table] ?? 0), `Unexpected ${table} rows`);
  }
  let lastId = businessBaseline.inventory_audit_logs.lastId;
  const seenExports = new Set();
  for (;;) {
    const [rows] = await db.execute("SELECT * FROM inventory_audit_logs WHERE id>? ORDER BY id LIMIT 500", [lastId]);
    if (!rows.length) break;
    for (const row of rows) {
      lastId = Number(row.id);
      if (row.operation_request_id !== null) { assert.ok(knownOperations.has(Number(row.operation_request_id)), "Foreign Audit Operation"); continue; }
      const intent = exportAuditRequests.get(row.request_id); assert.ok(intent, "Unregistered Audit request");
      assert.ok(verifiedExportIds.has(Number(row.id)), "Unexpected DOMAIN/ROUTE Audit increment");
      assert.equal(seenExports.has(Number(row.id)), false); seenExports.add(Number(row.id));
      const expected = exportAuditEvidence.get(row.request_id).find(item => item.auditId === Number(row.id)); assert.ok(expected);
      for (const field of Object.keys(expected.row)) assert.deepEqual(field === "after_summary" ? jsonValue(row[field]) : row[field], expected.row[field]);
    }
  }
  assert.equal(seenExports.size, exportAuditCount);
  // Read at a drained boundary; each bounded page reconciles exact bucket dimensions against its entire ledger.
  lastId = 0; let balanceCount = 0;
  const ledgerDigest = createHash("sha256"), controlDigest = createHash("sha256");
  for (;;) {
    const [rows] = await db.query(`SELECT b.*, (SELECT SUM(IF(m.direction='IN',m.quantity,-CAST(m.quantity AS SIGNED))) FROM inventory_movements m
      WHERE m.sku_id=b.sku_id AND m.warehouse_id=b.warehouse_id AND m.bin_id=b.bin_id AND m.lot_id<=>b.lot_id AND m.stock_status=b.stock_status) AS ledger,
      (SELECT COUNT(*) FROM inventory_movements m WHERE m.sku_id=b.sku_id AND m.warehouse_id=b.warehouse_id AND m.bin_id=b.bin_id AND m.lot_id<=>b.lot_id AND m.stock_status=b.stock_status) AS legs,
      (SELECT COALESCE(SUM(a.outstanding_quantity),0) FROM inventory_allocations a WHERE a.stock_balance_id=b.id) AS allocated
      FROM inventory_stock_balances b WHERE b.id>? ORDER BY b.id LIMIT 500`, [lastId]);
    if (!rows.length) break;
    for (const row of rows) {
      lastId = Number(row.id); balanceCount++;
      const effect = balanceEffects.get(lastId) ?? { quantity: 0, version: 0 };
      assert.equal(Number(row.on_hand_quantity), 100 + effect.quantity); assert.equal(Number(row.version), 4 + effect.version);
      assert.equal(Number(row.updated_at), effect.operationId ? operationTimes.get(effect.operationId) : Number(row.created_at), "Untouched and changed balance timestamps must match their command history");
      assert.equal(Number(row.on_hand_quantity), Number(row.ledger)); assert.equal(Number(row.version), Number(row.legs));
      assert.equal(Number(row.allocated_quantity), Number(row.allocated)); assert.ok(Number(row.on_hand_quantity) >= Number(row.allocated_quantity));
      ledgerDigest.update(JSON.stringify([lastId, row.warehouse_id, row.bin_id, row.sku_id, row.lot_id, row.stock_status, row.on_hand_quantity, row.version, row.ledger, row.legs, row.allocated]) + "\n");
    }
  }
  assert.equal(balanceCount, 500000);
  lastId = 0; let controlCount = 0;
  for (;;) {
    const [rows] = await db.query(`SELECT c.*, (SELECT COALESCE(SUM(r.outstanding_quantity),0) FROM inventory_reservations r WHERE r.warehouse_id=c.warehouse_id AND r.sku_id=c.sku_id) AS reserved,
      (SELECT COALESCE(SUM(b.on_hand_quantity),0) FROM inventory_stock_balances b WHERE b.warehouse_id=c.warehouse_id AND b.sku_id=c.sku_id AND b.stock_status='AVAILABLE') AS eligible
      FROM inventory_stock_controls c WHERE c.id>? ORDER BY c.id LIMIT 500`, [lastId]);
    if (!rows.length) break;
    for (const row of rows) {
      lastId = Number(row.id); controlCount++;
      const owned = reservationCreates.some(record => record.body.warehouseId === Number(row.warehouse_id) && record.body.skuId === Number(row.sku_id));
      assert.equal(Number(row.updated_at), controlTimes.get(`${row.warehouse_id}:${row.sku_id}`) ?? Number(row.created_at));
      assert.equal(Number(row.reserved_quantity), Number(row.reserved)); assert.ok(Number(row.eligible) >= Number(row.reserved));
      assert.equal(Number(row.reserved_quantity), owned && !cancelled ? 1 : 0); assert.equal(Number(row.version), 1 + (owned ? cancelled ? 2 : 1 : 0));
      controlDigest.update(JSON.stringify([lastId, row.warehouse_id, row.sku_id, row.reserved_quantity, row.version, row.reserved, row.eligible]) + "\n");
    }
  }
  assert.equal(controlCount, 250000);
  const [storedReservations] = await db.query("SELECT * FROM inventory_reservations ORDER BY id LIMIT 16");
  assert.equal(storedReservations.length, 15);
  for (const row of storedReservations) {
    const original = knownReservations.get(Number(row.id)); assert.ok(original);
    const created = [...reservationCommands.values()].find(record => record.action === "create" && record.result.id === Number(row.id)); assert.ok(created);
    assert.deepEqual([Number(row.create_operation_id), Number(row.minimum_remaining_days), row.purpose, Number(row.created_by), Number(row.updated_by)], [created.result.operationId, created.body.minimumRemainingDays, created.body.purpose, created.actorId, created.actorId]);
    assert.deepEqual([Number(row.warehouse_id), Number(row.sku_id), Number(row.original_quantity), Number(row.consumed_quantity), Number(row.released_quantity), Number(row.outstanding_quantity), row.status, Number(row.version)],
      [original.body.warehouseId, original.body.skuId, original.body.quantity, 0, cancelled ? original.body.quantity : 0, cancelled ? 0 : original.body.quantity, cancelled ? "CANCELLED" : "ACTIVE", cancelled ? 2 : 1]);
  }
  report.normalReconciliations ??= [];
  report.normalReconciliations.push({ outcome: "COMPLETE", actualCounts, balancesVerified: balanceCount, controlsVerified: controlCount, reservationsCancelled: cancelled,
    orderedLedgerSha256: ledgerDigest.digest("hex"), orderedControlsSha256: controlDigest.digest("hex"), discrepancyCount: 0, verificationMs: performance.now() - verificationStarted });
}

export async function verifyNormalWorkloadsReconciled(fixture) {
  fixture.normalWorkloadsReconciled = false;
  fixture.characterizationCases.set("CP08", false);
  requireObservationLifecycle(fixture);
  for (const bins of [1, 10, 200]) for (let round = 0; round < 3; round++) {
    const matches = (fixture.report.flows ?? []).filter(flow => !flow.zero && flow.bins === bins && flow.round === round);
    assert.equal(matches.length, 1); assert.equal(matches[0].outcome, "COMPLETE");
    assert.deepEqual(["create", "start", "counts/save", "ready", "post"].map(action => matches[0].phases.filter(phase => phase.action === action).length), [1, 1, bins * 5, 1, 2]);
    assert.deepEqual(await stocktakeHistory(fixture, matches[0].id), fixture.stocktakeFlowPins.get(matches[0].id), "Original complete workflow effects changed");
  }
  await stocktakeWorkflow(fixture, 1, 0, true);
  const zero = fixture.report.flows.filter(flow => flow.zero);
  assert.equal(zero.length, 1); assert.equal(zero[0].outcome, "COMPLETE");
  await verifyBusinessReconciliation(fixture);
  await fixture.reconcileBusinessCleanup();
  for (const flow of fixture.report.flows) assert.deepEqual(await stocktakeHistory(fixture, flow.id), fixture.stocktakeFlowPins.get(flow.id));
  fixture.normalWorkloadsReconciled = true;
  fixture.characterizationCases.set("CP08", true);
}

export async function stocktakeWorkflow(fixture, binCount, round, zero = false) {
  requireObservationLifecycle(fixture);
  assert.ok(fixture, "CP01 fixture must actually complete");
  assert.equal(fixture.workers.some(w => w.quarantined), false, "No new workload after an unknown request or owned stop");
  const { db, request, actors, report } = fixture, who = actors.find(a => a.writer);
  const root = "/api/v1/inventory/stocktakes", binIds = Array.from({ length: binCount }, (_, n) => n + 1);
  const flow = { bins: binCount, round, zero, phases: [], outcome: "IN_PROGRESS" };
  report.flows ??= []; report.flows.push(flow);
  const coexistence = binCount === 200 && !zero ? await beginQueryCoexistence(fixture, round) : null;
  if (coexistence) flow.queryCoexistence = coexistence.observation;
  let header, postBaseline, stage = "create";
  report.diagnosticObserver = "TEST_ONLY_TRANSACTION_ERROR_OBSERVER; timings instrumented, not production performance acceptance";
  const step = async (action, body, signed = false) => {
    stage = action; const started = performance.now();
    const route = action === "create" ? `${root}/create` : `${root}/${header.id}/${action}`;
    let dispatchIndex;
    const invoke = () => { dispatchIndex = report.requests.length; return request(who, route, body, signed); };
    const concurrent = coexistence && ["start", "counts/save", "ready", "post"].includes(action) && !(action === "post" && header.status === "POSTED");
    const value = await (concurrent ? coexistence.phase(action, invoke) : invoke());
    const requestId = commandRequestId(report, dispatchIndex, who.id, route);
    const record = { action, body: { ...body, password: undefined }, result: value, actorId: who.id, requestId, beforeStatus: header?.status };
    const previous = fixture.stocktakeCommands.get(value.operationId);
    if (previous) {
      const { actorLabel: _actorLabel, stocktakeNumber: _number, createReason: _reason, ...original } = previous;
      assert.deepEqual({ ...record, requestId: previous.requestId, beforeStatus: previous.beforeStatus }, original);
    } else fixture.stocktakeCommands.set(value.operationId, record);
    flow.phases.push({ action, elapsedMs: concurrent ? coexistence.observation.phases.at(-1).writeElapsedMs : performance.now() - started,
      ...(concurrent ? { observerWrapperOverheadMs: performance.now() - started - coexistence.observation.phases.at(-1).writeElapsedMs } : {}),
      coordinatorElapsedMs: performance.now() - started, operationId: value.operationId });
    return value;
  };
  try {
    const originalBalances = new Map(); let afterBalance = 0;
    for (;;) {
      const [rows] = await db.query(`SELECT b.*,s.sku_code,s.sku_name,s.tracking_policy,w.warehouse_code,bn.bin_code,lot.lot_number,lot.expiry_date
        FROM inventory_stock_balances b JOIN item_skus s ON s.id=b.sku_id JOIN inventory_warehouses w ON w.id=b.warehouse_id
        JOIN inventory_bins bn ON bn.id=b.bin_id LEFT JOIN inventory_lots lot ON lot.id=b.lot_id
        WHERE b.warehouse_id=1 AND b.bin_id IN (?) AND b.id>? ORDER BY b.id LIMIT 500`, [binIds, afterBalance]);
      if (!rows.length) break;
      for (const row of rows) {
        const { sku_code, sku_name, tracking_policy, warehouse_code, bin_code, lot_number, expiry_date, ...balance } = row;
        afterBalance = Number(row.id); originalBalances.set(afterBalance, { balance, trackingPolicy: tracking_policy,
          movementSnapshot: [sku_code, sku_name, warehouse_code, bin_code, lot_number ?? "", expiry_date] });
      }
    }
    assert.equal(originalBalances.size, binCount * 500);
    header = await step("create", { source: source(), warehouseId: 1, binIds, reason: "Synthetic capacity characterization" });
    flow.id = header.id;
    header = await step("start", { source: source(), expectedVersion: header.version });
    assert.equal(header.status, "COUNTING");
    stage = "lines";
    const lines = [];
    for (let page = 1; page <= binCount * 5; page++) {
      const data = await request(who, `${root}/${header.id}/lines?pageSize=100&page=${page}`);
      assert.equal(data.total, binCount * 500); lines.push(...data.items);
    }
    assert.equal(new Set(lines.map(line => line.id)).size, binCount * 500);
    flow.orderedIdsSha256 = sha(JSON.stringify(lines.map(line => line.id)));
    const [scopes] = await db.execute("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id=? ORDER BY bin_id,id LIMIT 201", [header.id]);
    assert.deepEqual(scopes.map(row => Number(row.bin_id)), binIds);
    const [ownedLocks] = await db.execute("SELECT * FROM inventory_bin_locks WHERE stocktake_id=? ORDER BY bin_id,id LIMIT 201", [header.id]);
    assert.equal(ownedLocks.length, binCount);
    for (const [index, lock] of ownedLocks.entries()) {
      assert.deepEqual([Number(lock.bin_id), Number(lock.stocktake_id), Number(lock.stocktake_bin_id), lock.lock_type, Number(lock.locked_by), lock.released_at],
        [binIds[index], header.id, Number(scopes[index].id), "STOCKTAKE", who.id, null]);
      assert.equal(scopes[index].bin_code_snapshot, `B-${String(binIds[index]).padStart(3, "0")}`);
    }
    const originals = new Map(lines.map(line => [line.id, line]));
    const seenBalances = new Set();
    for (const line of lines) {
      const balance = originalBalances.get(line.snapshotBalanceId)?.balance; assert.ok(balance); assert.equal(seenBalances.has(line.snapshotBalanceId), false); seenBalances.add(line.snapshotBalanceId);
      assert.deepEqual([line.stocktakeId, line.stocktakeBinId, line.binId, line.skuId, line.lotId, line.stockStatus, line.snapshotQuantity, line.snapshotBalanceVersion, line.countedQuantity, line.notFound, line.version],
        [header.id, Number(scopes.find(scope => Number(scope.bin_id) === Number(balance.bin_id)).id), Number(balance.bin_id), Number(balance.sku_id), balance.lot_id === null ? null : Number(balance.lot_id), balance.stock_status, Number(balance.on_hand_quantity), Number(balance.version), null, false, 1]);
    }
    assert.equal(seenBalances.size, originalBalances.size);
    for (let offset = 0; offset < lines.length; offset += 100) {
      const counted = lines.slice(offset, offset + 100).map(line => ({ lineId: line.id, expectedVersion: line.version,
        countedQuantity: line.snapshotQuantity + (zero ? 0 : line.id % 2 ? 1 : -1) }));
      const receipt = await step("counts/save", { source: source(), lines: counted });
      assert.equal(receipt.rowCount, counted.length); assert.equal(receipt.version, header.version);
    }
    header = await step("ready", { source: source(), expectedVersion: header.version });
    assert.equal(header.status, "READY_TO_POST");
    if (binCount === 200) postBaseline = await inventoryState(db);
    const post = { source: source(), expectedVersion: header.version, reason: "Synthetic physical count", password: who.password };
    header = await step("post", post, true);
    assert.equal(header.status, "POSTED"); assert.equal(header.rowCount, zero ? 0 : lines.length);
    stage = "verify";
    let afterLine = 0, storedCount = 0, gains = 0, losses = 0;
    const orderedIds = createHash("sha256"); orderedIds.update("[");
    const tracking = new Set(), statuses = new Set();
    for (;;) {
      const [stored] = await db.execute(`SELECT l.*,b.on_hand_quantity,b.version AS balance_version,b.allocated_quantity,b.fifo_anchor_date,
        m.id AS actual_movement_id,m.direction,m.quantity AS movement_quantity,m.operation_request_id,m.movement_group_id,m.movement_type,m.location_kind,
        m.warehouse_id AS movement_warehouse,m.bin_id AS movement_bin,m.sku_id AS movement_sku,m.lot_id AS movement_lot,m.stock_status AS movement_status,
        m.stocktake_id AS movement_stocktake,m.stocktake_line_id,m.balance_before,m.balance_after,m.balance_version_after,
        m.sku_code_snapshot,m.sku_name_snapshot,m.warehouse_code_snapshot,m.bin_code_snapshot,m.lot_number_snapshot,m.expiry_date_snapshot,m.posted_by,m.posted_by_label,m.reason_text
        FROM inventory_stocktake_lines l JOIN inventory_stock_balances b ON b.id=l.stock_balance_id
        LEFT JOIN inventory_movements m ON m.id=l.movement_id
        WHERE l.stocktake_id=? AND l.id>? ORDER BY l.id LIMIT 500`, [header.id, afterLine]);
      if (!stored.length) break;
      for (const row of stored) {
        afterLine = Number(row.id); const line = originals.get(afterLine); assert.ok(line);
        orderedIds.update((storedCount++ ? "," : "") + JSON.stringify(line.id));
        const variance = zero ? 0 : line.id % 2 ? 1 : -1, reference = originalBalances.get(line.snapshotBalanceId), balance = reference.balance;
        tracking.add(reference.trackingPolicy); statuses.add(row.stock_status); if (variance > 0) gains++; if (variance < 0) losses++;
        assert.deepEqual([Number(row.stocktake_id), Number(row.stocktake_bin_id), Number(row.stock_balance_id), Number(row.bin_id), Number(row.sku_id), row.lot_id === null ? null : Number(row.lot_id), row.stock_status],
          [header.id, line.stocktakeBinId, line.snapshotBalanceId, line.binId, line.skuId, line.lotId, line.stockStatus]);
        assert.equal(Number(row.snapshot_quantity), line.snapshotQuantity); assert.equal(Number(row.counted_quantity), line.snapshotQuantity + variance);
        assert.equal(Number(row.variance_quantity), variance); assert.equal(Number(row.on_hand_quantity), line.snapshotQuantity + variance);
        assert.equal(Number(row.balance_version), line.snapshotBalanceVersion + (zero ? 0 : 1));
        assert.equal(Number(row.version), line.version + (zero ? 1 : 2));
        assert.equal(Number(row.is_not_found), 0); assert.equal(Number(row.counted_by), who.id); assert.ok(Number(row.counted_at) > 0);
        assert.equal(Number(row.allocated_quantity), Number(balance.allocated_quantity)); assert.deepEqual(row.fifo_anchor_date, balance.fifo_anchor_date);
        if (!zero) {
          const effect = fixture.balanceEffects.get(line.snapshotBalanceId) ?? { quantity: 0, version: 0 };
          fixture.balanceEffects.set(line.snapshotBalanceId, { quantity: effect.quantity + variance, version: effect.version + 1, operationId: header.operationId });
        }
        line.variance = variance; line.movementId = row.movement_id === null ? null : Number(row.movement_id);
        if (zero) {
          assert.equal(row.movement_id, null);
          const [[actual]] = await db.execute("SELECT * FROM inventory_stock_balances WHERE id=?", [line.snapshotBalanceId]);
          assert.deepEqual(actual, balance, "Zero variance changed the full balance row");
        }
        else {
          assert.equal(row.direction, variance > 0 ? "IN" : "OUT"); assert.equal(Number(row.movement_quantity), 1);
          assert.equal(Number(row.operation_request_id), header.operationId); assert.equal(Number(row.balance_before), line.snapshotQuantity);
          assert.equal(Number(row.balance_after), line.snapshotQuantity + variance); assert.equal(Number(row.balance_version_after), line.snapshotBalanceVersion + 1);
          assert.equal(Number(row.actual_movement_id), line.movementId);
          assert.equal(row.reason_text, post.reason); assert.equal(row.posted_by_label, who.username);
          assert.deepEqual([row.movement_group_id, row.movement_type, row.location_kind, Number(row.movement_warehouse), Number(row.movement_bin), Number(row.movement_sku), row.movement_lot === null ? null : Number(row.movement_lot), row.movement_status, Number(row.movement_stocktake), Number(row.stocktake_line_id), Number(row.posted_by)],
            [header.movementGroupId, "STOCKTAKE_VARIANCE", "BIN", 1, line.binId, line.skuId, line.lotId, line.stockStatus, header.id, line.id, who.id]);
          assert.deepEqual([row.sku_code_snapshot, row.sku_name_snapshot, row.warehouse_code_snapshot, row.bin_code_snapshot, row.lot_number_snapshot, row.expiry_date_snapshot],
            reference.movementSnapshot);
        }
      }
    }
    orderedIds.update("]"); assert.equal(orderedIds.digest("hex"), flow.orderedIdsSha256); assert.equal(storedCount, lines.length);
    assert.deepEqual([...tracking].sort(), ["batch", "batch_expiry", "none"]); assert.deepEqual([...statuses].sort(), ["AVAILABLE", "DAMAGED", "QUARANTINED"]);
    assert.deepEqual([gains, losses], zero ? [0, 0] : [lines.length / 2, lines.length / 2]);
    const historyBeforeReplay = await stocktakeHistory(fixture, header.id);
    const balancesBeforeReplay = await rowDigest(db, "inventory_stock_balances");
    assert.deepEqual(await step("post", post, true), header);
    assert.deepEqual(await stocktakeHistory(fixture, header.id), historyBeforeReplay, "Replay changed historical effects");
    assert.deepEqual(await rowDigest(db, "inventory_stock_balances"), balancesBeforeReplay, "Replay changed stock balances, including timestamps");
    const [terminalLocks] = await db.execute("SELECT * FROM inventory_bin_locks WHERE stocktake_id=? ORDER BY bin_id,id LIMIT 201", [header.id]);
    assert.equal(terminalLocks.length, ownedLocks.length);
    for (const [index, lock] of terminalLocks.entries()) {
      assert.ok(lock.released_at !== null); assert.equal(Number(lock.released_by), who.id); assert.equal(lock.release_reason, "POSTED");
      assert.deepEqual({ ...lock, released_at: null, released_by: null, release_reason: "", active_scope: 1 }, ownedLocks[index]);
    }
    await verifyStocktakeCommands(fixture, header.id, originals);
    const [[storedHeader]] = await db.execute("SELECT * FROM inventory_stocktakes WHERE id=?", [header.id]);
    assert.deepEqual([storedHeader.status, Number(storedHeader.version), Number(storedHeader.warehouse_id), Number(storedHeader.post_operation_id), Number(storedHeader.posted_by)], ["POSTED", 4, 1, header.operationId, who.id]);
    const movementRows = await rowDigest(db, "inventory_movements", "operation_request_id=?", [header.operationId]);
    assert.equal(movementRows.count, zero ? 0 : lines.length);
    const history = await stocktakeHistory(fixture, header.id); fixture.stocktakeFlowPins.set(header.id, history);
    flow.verifiedHistorySha256 = sha(JSON.stringify(history)); flow.gains = gains; flow.losses = losses;
    flow.outcome = "COMPLETE";
    return header;
  } catch (error) {
    flow.outcome = "FAIL"; flow.failedPhase = stage;
    if (fixture.workers.some(w => w.quarantined)) {
      flow.recovery = { status: "IN_PROGRESS" };
      try { await fixture.stopWorkers(); }
      catch (stopError) { flow.recovery.error = errorObservation(stopError); }
      flow.recovery.status = report.ownedSql?.status ?? "SQL_TERMINAL_UNKNOWN";
      if (flow.recovery.status !== "SQL_TERMINAL_CONFIRMED") {
        flow.dataObservation = "DATA_SQL_TERMINAL_UNKNOWN";
        throw error;
      }
    }
    if (postBaseline && stage === "post") {
      flow.rollbackObservation = { before: postBaseline, classification: "ROW_RECONCILIATION_DIAGNOSTIC_NOT_AUTOMATIC_TRANSACTION_OUTCOME_PROOF" };
      try {
        const after = await inventoryState(db); flow.rollbackObservation.after = after;
        flow.rollbackObservation.changedTables = Object.keys(after).filter(table => JSON.stringify(after[table]) !== JSON.stringify(postBaseline[table]));
      } catch (diagnosticError) { flow.rollbackObservation.error = errorObservation(diagnosticError); }
    }
    if (header) {
      try {
        const [[state]] = await db.execute(`SELECT status,version,
          (SELECT COUNT(*) FROM inventory_stocktake_lines WHERE stocktake_id=?) AS lineCount,
          (SELECT COUNT(*) FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL) AS activeLocks
          FROM inventory_stocktakes WHERE id=?`, [header.id, header.id, header.id]);
        flow.persistedState = state;
      } catch (diagnosticError) { flow.persistedStateError = errorObservation(diagnosticError); }
    }
    throw error;
  }
}

async function inventoryState(db) {
  const [tables] = await db.query(`SELECT TABLE_NAME AS name FROM information_schema.tables
    WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,10)='inventory_' ORDER BY TABLE_NAME`);
  assert.ok(tables.length >= 14);
  const result = {};
  for (const { name } of tables) {
    assert.match(name, /^inventory_[a-z_]+$/u);
    const hash = createHash("sha256");
    let lastId = 0, count = 0;
    while (true) {
      const [rows] = await db.query(`SELECT * FROM ${name} WHERE id>? ORDER BY id LIMIT 500`, [lastId]);
      if (!rows.length) break;
      for (const row of rows) {
        assert.ok(Number(row.id) > lastId); lastId = Number(row.id);
        hash.update(JSON.stringify(row) + "\n"); count++;
      }
    }
    result[name] = { count, sha256: hash.digest("hex") };
  }
  return result;
}

export async function verifyControlLockBoundary(fixture) {
  assert.ok(fixture, "CP01 must complete first");
  const { db, workers, report } = fixture;
  const observation = { kind: "NATIVE_CONTROL_LOCK_NOT_HTTP_POST", scenarios: [], outcome: "IN_PROGRESS" };
  report.controlLock = observation;
  try {
    const baseline = await inventoryState(db);
    assert.equal(baseline.inventory_stock_controls.count, 250000);
    observation.before = baseline;
    for (const scenario of ["existing-50000", "new-1001-rollback", "second-insert-fault"]) {
      const actual = await workers[0].controlLock(scenario).catch(error => ({ scenario, outcome: "IPC_FAILURE", error: errorObservation(error) }));
      observation.scenarios.push(actual);
      let failure = actual.outcome === "COMPLETE" ? null : new Error(`${scenario}: ${actual.errorCodes?.join(",") ?? actual.outcome}`);
      actual.reconciliationErrors = []; actual.externalReconciliationAttempted = true;
      try {
        actual.after = await inventoryState(db);
        assert.deepEqual(actual.after, baseline, "Native Control transaction must leave all Inventory rows unchanged");
        actual.externalStateUnchanged = true;
      } catch (error) { actual.externalStateUnchanged = false; actual.reconciliationErrors.push(errorObservation(error)); failure ??= error; }
      try {
        assert.ok(Number.isSafeInteger(actual.connectionId), "Missing actual SQL connection identity");
        const [[transactions]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?", [actual.connectionId]);
        actual.activeTransactions = Number(transactions.n); assert.equal(actual.activeTransactions, 0);
        actual.transactionTerminal = true;
      } catch (error) { actual.transactionTerminal = false; actual.reconciliationErrors.push(errorObservation(error)); failure ??= error; }
      if (failure) throw failure;
    }
    observation.outcome = "COMPLETE";
    fixture.controlLockVerified = true;
  } catch (error) { observation.outcome = "FAIL"; throw error; }
}

async function controlLockScenario(app, scenario) {
  databaseOptions();
  assert.ok(["existing-50000", "new-1001-rollback", "second-insert-fault"].includes(scenario));
  const database = app.services.require("mysqldatabase");
  assert.equal(database.config.transactionTimeoutMs, 20000);
  const { InventoryLockService } = await import("../src/modules/inventory/InventoryLockService.js");
  const count = scenario === "existing-50000" ? 50000 : 1001, first = count === 50000 ? 1 : 50001;
  const input = { warehouseIds: [5], binIds: [801], stockControls: Array.from({ length: count }, (_, index) => ({ warehouseId: 5, skuId: first + count - index - 1 })), now: Date.now() };
  input.stockControls.push({ ...input.stockControls[0] }, { ...input.stockControls.at(-1) });
  const observation = { scenario, calls: [], lockStages: [], outcome: "IN_PROGRESS", connectionId: null, firstInsertVisible: null };
  observation.phase = "PRECONDITION";
  try {
    const [before] = await database.query("SELECT * FROM inventory_stock_controls WHERE warehouse_id=5 AND sku_id BETWEEN ? AND ? ORDER BY warehouse_id,sku_id", [first, first + count - 1]);
    assert.equal(before.length, scenario === "existing-50000" ? 50000 : 0);
    observation.phase = "TRANSACTION";
    let expectedRollback = false;
    try {
      await database.withTransaction(async tx => {
        const [[identity]] = await tx.query("SELECT CONNECTION_ID() AS id"); observation.connectionId = Number(identity.id);
        let inserts = 0;
        const connection = {};
        for (const method of ["execute", "query"]) connection[method] = async (sql, params) => {
          const control = sql.includes("inventory_stock_controls");
          const stage = { method, table: sql.match(/inventory_[a-z_]+/u)?.[0] ?? "UNKNOWN", binds: params.length, outcome: "NOT_EXECUTED" };
          observation.lockStages.push(stage);
          if (control) {
            const stride = method === "execute" ? 4 : 2;
            const keys = params.filter((_, index) => index % stride < 2);
            stage.keyHash = sha(JSON.stringify(keys)); observation.calls.push(stage);
            if (method === "execute" && ++inserts === 2 && scenario === "second-insert-fault") {
              const [[visible]] = await tx.query("SELECT COUNT(*) AS n FROM inventory_stock_controls WHERE warehouse_id=5 AND sku_id BETWEEN 50001 AND 51001");
              observation.firstInsertVisible = Number(visible.n); assert.equal(observation.firstInsertVisible, 1000);
              stage.outcome = "TEST_INJECTED_NOT_EXECUTED";
              expectedRollback = true; throw Object.assign(new Error("Explicit second-batch test fault"), { code: "TEST_INJECTED" });
            }
          }
          try { const result = await tx[method](sql, params); stage.outcome = "SUCCEEDED"; return result; }
          catch (error) { stage.outcome = "FAILED"; stage.error = errorObservation(error); throw error; }
        };
        const locked = await new InventoryLockService().lockForCommand(connection, input);
        assert.equal(locked.stockControls.length, count);
        assert.deepEqual(locked.bins.map(row => [Number(row.id), Number(row.warehouse_id)]), [[801, 5]]);
        const keys = locked.stockControls.flatMap(row => [Number(row.warehouse_id), Number(row.sku_id)]);
        assert.deepEqual(keys, Array.from({ length: count }, (_, index) => [5, first + index]).flat());
        if (scenario === "existing-50000") {
          assert.deepEqual(locked.stockControls, before);
          observation.fullRowsHash = sha(JSON.stringify(locked.stockControls));
        } else {
          for (const row of locked.stockControls) {
            assert.equal(Number(row.reserved_quantity), 0); assert.equal(Number(row.version), 1);
            assert.equal(Number(row.created_at), input.now); assert.equal(Number(row.updated_at), input.now);
          }
          expectedRollback = true; throw Object.assign(new Error("Explicit owner rollback"), { code: "TEST_ROLLBACK" });
        }
      });
      assert.equal(scenario, "existing-50000");
    } catch (error) {
      const codes = [];
      for (let cause = error, depth = 0; cause && depth < 6; cause = cause.cause, depth++) {
        if (/^[A-Z][A-Z0-9_]*$/u.test(cause.code ?? "")) codes.push(cause.code);
      }
      observation.errorCodes = codes; observation.error = errorObservation(error);
      const expected = scenario === "second-insert-fault" ? "TEST_INJECTED" : "TEST_ROLLBACK";
      if (!expectedRollback || !codes.includes(expected)) { observation.outcome = "FAIL"; return observation; }
      observation.ownerRollback = true;
    }
    observation.phase = "RESULT_ASSERTIONS";
    const batches = Math.ceil(count / 1000), calls = observation.calls;
    if (scenario === "second-insert-fault") {
      assert.deepEqual(calls.map(call => call.method), ["execute", "execute"]);
      assert.equal(observation.firstInsertVisible, 1000);
      assert.deepEqual(observation.lockStages.map(stage => stage.table), ["inventory_warehouses", "inventory_stock_controls", "inventory_stock_controls"]);
      assert.deepEqual(observation.lockStages.map(stage => stage.outcome), ["SUCCEEDED", "SUCCEEDED", "TEST_INJECTED_NOT_EXECUTED"]);
    } else assert.deepEqual(calls.map(call => call.method), [...Array(batches).fill("execute"), ...Array(batches).fill("query")]);
    if (scenario !== "second-insert-fault") {
      assert.deepEqual(observation.lockStages.map(stage => stage.table), ["inventory_warehouses", ...Array(batches * 2).fill("inventory_stock_controls"), "inventory_bins", "inventory_bin_locks"]);
      assert.ok(observation.lockStages.every(stage => stage.outcome === "SUCCEEDED"));
    }
    let insertOffset = 0, readOffset = 0;
    for (const call of calls) {
      const stride = call.method === "execute" ? 4 : 2, size = call.binds / stride;
      assert.ok(size > 0 && size <= 1000);
      const offset = call.method === "execute" ? insertOffset : readOffset;
      assert.equal(call.keyHash, sha(JSON.stringify(Array.from({ length: size }, (_, index) => [5, first + offset + index]).flat())));
      if (call.method === "execute") insertOffset += size; else readOffset += size;
    }
    observation.outcome = "COMPLETE";
    return observation;
  } catch (error) {
    observation.outcome = "FAIL"; observation.error = errorObservation(error); observation.errorCodes = observation.error.codes;
    return observation;
  }
}

function lotProbeSql(shape, lots) {
  assert.ok(["OR_BASELINE", "TUPLE_IN_CANDIDATE"].includes(shape));
  return `SELECT * FROM inventory_lots
           WHERE ${shape === "OR_BASELINE"
    ? lots.map(() => "(sku_id = ? AND normalized_lot_number = ?)").join(" OR ")
    : `(sku_id, normalized_lot_number) IN (${lots.map(() => "(?, ?)").join(", ")})`}
           ORDER BY sku_id, normalized_lot_number FOR UPDATE`;
}

async function lotSemanticsScenario(app) {
  databaseOptions();
  const database = app.services.require("mysqldatabase");
  const { InventoryLockService } = await import("../src/modules/inventory/InventoryLockService.js");
  const result = { kind: "TEST_ONLY_NATIVE_LOT_SEMANTICS", outcome: "IN_PROGRESS", scenarios: [] };
  const rollback = Object.assign(new Error("Explicit CP11 caller rollback"), { code: "TEST_OWNER_ROLLBACK" });
  const insertedIds = [];
  try {
    try {
      await database.withTransaction(async tx => {
        const [[identity]] = await tx.query("SELECT CONNECTION_ID() AS id"); result.connectionId = Number(identity.id);
        const [threads] = await tx.query("SELECT THREAD_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [result.connectionId]);
        assert.equal(threads.length, 1); assert.equal(threads[0].INSTRUMENTED, "YES");
        result.performanceThreadId = Number(threads[0].THREAD_ID);
        const [collation] = await tx.query(`SELECT c.COLLATION_NAME,k.PAD_ATTRIBUTE FROM information_schema.COLUMNS c
          JOIN information_schema.COLLATIONS k ON k.COLLATION_NAME=c.COLLATION_NAME
          WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='inventory_lots' AND c.COLUMN_NAME='normalized_lot_number'`);
        assert.deepEqual(collation.map(row => [row.COLLATION_NAME, row.PAD_ATTRIBUTE]), [["utf8mb4_bin", "PAD SPACE"]]);
        result.collation = collation;
        const [templates] = await tx.query("SELECT * FROM inventory_lots WHERE id IN (3,4,7) ORDER BY id");
        assert.deepEqual(templates.map(row => Number(row.sku_id)), [3, 4, 7]);
        const entries = [];
        for (const [sku, name] of [[3, "CP11-SHARED"], [7, "CP11-SHARED"], [3, "CP11-CASE"],
          [3, "CP11-café"], [3, "CP11-日本語"], [3, "CP11-😀"], [3, "CP11-O'HARE"], [3, "CP11-PAD"],
          [4, "é".repeat(50)], [7, "CP11-ONLY-SEVEN"]]) {
          const template = templates.find(row => Number(row.sku_id) === sku);
          const [insert] = await tx.execute(`INSERT INTO inventory_lots
            (sku_id,lot_number,normalized_lot_number,expiry_date,manufacture_date,first_receipt_date,sku_code_snapshot,created_at,created_by)
            VALUES (?,?,?,?,?,?,?,?,?)`, [sku, name, name, template.expiry_date, template.manufacture_date,
            template.first_receipt_date, template.sku_code_snapshot, template.created_at, template.created_by]);
          const id = Number(insert.insertId); insertedIds.push(id); entries.push({ skuId: sku, normalizedLotNumber: name, id });
        }
        const entry = (sku, name) => { const value = entries.find(row => row.skuId === sku && row.normalizedLotNumber === name); assert.ok(value); return value; };
        const first = entry(3, "CP11-SHARED"), other = entry(7, "CP11-ONLY-SEVEN");
        const scenarios = [
          { name: "single", keys: [first], ids: [first.id] },
          { name: "multi-SKU-reversed-not-cross-product", keys: [other, first], ids: [first.id, other.id] },
          { name: "same-text-different-SKU", keys: [entry(7, "CP11-SHARED"), first], ids: [first.id, entry(7, "CP11-SHARED").id] },
          { name: "duplicate-and-missing", keys: [first, first, { skuId: 3, normalizedLotNumber: "CP11-MISSING" }], ids: [first.id] },
          { name: "Unicode-quote-100-byte", keys: [...entries].reverse(), ids: insertedIds }
        ];
        for (const [name, stored, alias, expectedEqual] of [
          ["case-sensitive", "CP11-CASE", "CP11-case", 0], ["accent-sensitive", "CP11-café", "CP11-cafe", 0],
          ["trailing-space-PAD-alias", "CP11-PAD", "CP11-PAD ", 1]
        ]) {
          const row = entry(3, stored);
          const [[comparison]] = await tx.query("SELECT normalized_lot_number=? AS same FROM inventory_lots WHERE id=?", [alias, row.id]);
          assert.equal(Number(comparison.same), expectedEqual);
          scenarios.push({ name, keys: [{ skuId: 3, normalizedLotNumber: alias }], ids: expectedEqual ? [row.id] : [] });
        }
        for (const scenario of scenarios) {
          const [oracle] = scenario.ids.length ? await tx.query(`SELECT * FROM inventory_lots WHERE id IN (${scenario.ids.map(() => "?").join(",")}) ORDER BY sku_id,normalized_lot_number`, scenario.ids) : [[]];
          const actual = { name: scenario.name, expectedCount: oracle.length, expectedRowsHash: sha(JSON.stringify(oracle)), orderedIds: oracle.map(row => Number(row.id)), queries: [] };
          result.scenarios.push(actual);
          for (const shape of ["OR_BASELINE", "TUPLE_IN_CANDIDATE"]) {
            const [rows] = await tx.query(lotProbeSql(shape, scenario.keys), scenario.keys.flatMap(row => [row.skuId, row.normalizedLotNumber]));
            assert.deepEqual(rows, oracle);
            actual.queries.push({ shape, rowCount: rows.length, rowsHash: sha(JSON.stringify(rows)), orderedIds: rows.map(row => Number(row.id)) });
          }
          const locked = await new InventoryLockService().lockForCommand(tx, { lots: scenario.keys });
          assert.deepEqual(locked.lots, oracle);
          actual.serviceRowsHash = sha(JSON.stringify(locked.lots));
          for (const [key, value] of Object.entries(locked)) if (key !== "lots") assert.deepEqual(value, []);
        }
        assert.equal(result.scenarios.length, 8);
        result.rollbackRequested = true;
        throw rollback;
      });
      assert.fail("CP11 owner rollback must reject rather than commit");
    } catch (error) {
      if (error !== rollback && !(error.code === "DATABASE_TRANSACTION_FAILED" && error.cause === rollback)) throw error;
      result.rollbackError = errorObservation(error); result.ownerRollbackReturned = true;
    }
    const [[remaining]] = await database.query(`SELECT COUNT(*) AS n FROM inventory_lots WHERE id IN (${insertedIds.map(() => "?").join(",")})`, insertedIds);
    result.insertedRowsRemaining = Number(remaining.n); assert.equal(result.insertedRowsRemaining, 0);
    result.outcome = "COMPLETE";
  } catch (error) { result.outcome = "FAIL"; result.error = errorObservation(error); }
  return result;
}

export async function verifyLotQuerySemantics(fixture) {
  requireObservationLifecycle(fixture);
  assert.equal(fixture?.lotQueryCompared, true, "CP10 must complete before CP11");
  const { db, workers, report } = fixture, before = await inventoryState(db);
  const actual = { before, verificationOutcome: "IN_PROGRESS", externalStateUnchanged: false };
  report.lotSemantics = actual;
  let primary;
  try {
    Object.assign(actual, await workers[0].lotSemantics());
    assert.equal(actual.outcome, "COMPLETE"); assert.equal(actual.scenarios.length, 8);
    assert.equal(actual.ownerRollbackReturned, true); assert.equal(actual.insertedRowsRemaining, 0);
  } catch (error) { actual.primaryError = errorObservation(error); primary = error; }
  try {
    assert.ok(Number.isSafeInteger(actual.connectionId) && Number.isSafeInteger(actual.performanceThreadId));
    actual.terminal = await lotProbeState(db, { threadId: actual.connectionId, performanceThreadId: actual.performanceThreadId }, new Set(), performance.now() + 20000);
    assert.equal(actual.terminal.terminal, true);
  } catch (error) { actual.terminalError = errorObservation(error); primary ??= error; }
  try {
    actual.after = await inventoryState(db); assert.deepEqual(actual.after, before); actual.externalStateUnchanged = true;
  } catch (error) { actual.stateError = errorObservation(error); primary ??= error; }
  actual.verificationOutcome = primary ? "FAIL" : "COMPLETE";
  if (primary) throw primary;
  fixture.lotSemanticsVerified = true;
}

function lotSafetyKeys(scenario) {
  assert.ok(["CURRENT", "SAME", "CROSS", "MISSING", "UNRELATED", "MULTI", "FAULT"].includes(scenario));
  const key = (skuId, suffix) => ({ skuId, normalizedLotNumber: `CP12-${suffix}` });
  if (scenario === "SAME") return [key(3, "C"), key(3, "B"), key(3, "A"), key(3, "B")];
  if (scenario === "CROSS") return [key(7, "C"), key(7, "B"), key(3, "C")];
  if (scenario === "MISSING") return [key(3, "BB")];
  return [key(["MULTI", "FAULT"].includes(scenario) ? 50003 : 3, ["MULTI", "FAULT"].includes(scenario) ? "ROLLBACK" : "A")];
}

async function lotLockScenario(app, shape, scenario, notify, released) {
  databaseOptions(); assert.ok(["OR_BASELINE", "TUPLE_IN_CANDIDATE"].includes(shape));
  const keys = lotSafetyKeys(scenario), database = app.services.require("mysqldatabase");
  const { InventoryLockService } = await import("../src/modules/inventory/InventoryLockService.js");
  const result = { shape, scenario, outcome: "IN_PROGRESS", stages: [] };
  const rollback = Object.assign(new Error("CP12 explicit owner rollback"), { code: "TEST_OWNER_ROLLBACK" });
  const fault = Object.assign(new Error("CP12 after-Lot before-Balance fault"), { code: "TEST_INJECTED" });
  const expected = scenario === "FAULT" ? fault : rollback;
  try {
    try {
      await database.withTransaction(async (tx, { signal }) => {
        const [[identity]] = await tx.query("SELECT CONNECTION_ID() AS id"); result.connectionId = Number(identity.id);
        const [threads] = await tx.query("SELECT THREAD_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [result.connectionId]);
        assert.equal(threads.length, 1); assert.equal(threads[0].INSTRUMENTED, "YES"); result.performanceThreadId = Number(threads[0].THREAD_ID);
        const input = { lots: keys };
        if (["MULTI", "FAULT"].includes(scenario)) {
          const [insert] = await tx.execute(`INSERT INTO inventory_lots
            (sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at)
            SELECT id,'CP12-ROLLBACK','CP12-ROLLBACK',NULL,?,sku_code,? FROM item_skus WHERE id=50003 AND tracking_policy='batch'`,
          [new Date().toISOString().slice(0, 10), Date.now()]);
          assert.equal(insert.affectedRows, 1); result.newLotId = Number(insert.insertId);
          Object.assign(input, { warehouseIds: [5], stockControls: [{ warehouseId: 5, skuId: 50003 }], binIds: [801],
            balances: [{ warehouseId: 5, skuId: 50003, binId: 801, lotId: result.newLotId, stockStatus: "AVAILABLE" }],
            reservationIds: [1], transferIds: [1], stocktakeIds: [1], now: Date.now() });
        }
        await notify({ stage: "BEFORE", threadId: result.connectionId, performanceThreadId: result.performanceThreadId });
        const connection = {};
        for (const method of ["query", "execute"]) connection[method] = async (sql, params) => {
          const lot = sql.includes("FROM inventory_lots");
          result.stages.push({ method, table: sql.match(/inventory_[a-z_]+/u)?.[0] ?? "OTHER" });
          if (lot) {
            const normalized = [...new Map(keys.map(k => [`${k.skuId}:${k.normalizedLotNumber}`, k])).values()]
              .sort((a, b) => a.skuId - b.skuId || (a.normalizedLotNumber < b.normalizedLotNumber ? -1 : a.normalizedLotNumber > b.normalizedLotNumber ? 1 : 0));
            assert.deepEqual(params, normalized.flatMap(k => [k.skuId, k.normalizedLotNumber]));
            result.productLotShape = ["OR_BASELINE", "TUPLE_IN_CANDIDATE"].find(candidate =>
              sql.replace(/\s+/gu, " ").trim() === lotProbeSql(candidate, normalized).replace(/\s+/gu, " ").trim());
            assert.ok(result.productLotShape, "Only the exact approved Lot predicate may enter the comparison");
            sql = lotProbeSql(shape, normalized);
          }
          const rows = await tx[method](sql, params);
          if (lot && scenario === "FAULT") { result.faultAfterLot = true; throw fault; }
          return rows;
        };
        const locked = await new InventoryLockService().lockForCommand(connection, input);
        result.rowsHash = sha(JSON.stringify(locked.lots)); result.orderedIds = locked.lots.map(row => Number(row.id));
        if (scenario === "MULTI") {
          assert.equal(locked.stockControls.length, 1); assert.equal(locked.balances.length, 1);
          assert.equal(Number(locked.balances[0].lot_id), result.newLotId);
          const [oracle] = await tx.query("SELECT * FROM inventory_lots WHERE id=?", [result.newLotId]);
          assert.deepEqual(locked.lots, oracle);
          assert.deepEqual(result.stages.map(s => [s.method, s.table]), [["query", "inventory_warehouses"],
            ["execute", "inventory_stock_controls"], ["query", "inventory_stock_controls"], ["query", "inventory_bins"],
            ["query", "inventory_bin_locks"], ["query", "inventory_lots"], ["execute", "inventory_stock_balances"],
            ["query", "inventory_stock_balances"], ["query", "inventory_reservations"], ["query", "inventory_transfers"], ["query", "inventory_stocktakes"]]);
          result.newControlVisible = Number(locked.stockControls[0].sku_id); result.newBalanceVisible = Number(locked.balances[0].id);
        }
        let onAbort;
        try {
          const aborted = new Promise((_resolve, reject) => {
            onAbort = () => reject(signal.reason); signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          });
          await notify({ stage: "HOLDING", threadId: result.connectionId, performanceThreadId: result.performanceThreadId,
            rowsHash: result.rowsHash, orderedIds: result.orderedIds });
          await Promise.race([released, aborted]);
        } finally { signal.removeEventListener("abort", onAbort); }
        result.rollbackRequested = true; throw rollback;
      });
      assert.fail("CP12 must roll back, not commit");
    } catch (error) {
      if (error !== expected && !(error.code === "DATABASE_TRANSACTION_FAILED" && error.cause === expected)) throw error;
      result.expectedError = errorObservation(error); result.ownerRollbackReturned = true;
    }
    if (["MULTI", "FAULT"].includes(scenario)) {
      if (scenario === "FAULT") {
        assert.equal(result.faultAfterLot, true);
        assert.deepEqual(result.stages.map(s => [s.method, s.table]), [["query", "inventory_warehouses"],
          ["execute", "inventory_stock_controls"], ["query", "inventory_stock_controls"], ["query", "inventory_bins"],
          ["query", "inventory_bin_locks"], ["query", "inventory_lots"]]);
      }
      const [[remaining]] = await database.query(`SELECT
        (SELECT COUNT(*) FROM inventory_lots WHERE id=?) AS lots,
        (SELECT COUNT(*) FROM inventory_stock_controls WHERE warehouse_id=5 AND sku_id=50003) AS controls,
        (SELECT COUNT(*) FROM inventory_stock_balances WHERE warehouse_id=5 AND sku_id=50003) AS balances`, [result.newLotId]);
      result.remaining = remaining; assert.deepEqual([Number(remaining.lots), Number(remaining.controls), Number(remaining.balances)], [0, 0, 0]);
    }
    result.outcome = "COMPLETE";
  } catch (error) { result.outcome = "FAIL"; result.error = errorObservation(error); }
  return result;
}

function lotLockOwnsRow(lock, row) {
  if (lock.LOCK_TYPE !== "RECORD" || lock.LOCK_STATUS !== "GRANTED") return false;
  assert.equal(typeof lock.LOCK_DATA, "string", "Unknown native key data cannot prove later-key exclusion");
  assert.ok(["PRIMARY", "uq_inventory_lots_sku_number"].includes(lock.INDEX_NAME), "Unmapped native index cannot prove key exclusion");
  if (lock.LOCK_DATA === "supremum pseudo-record") return false;
  if (lock.INDEX_NAME === "PRIMARY") {
    assert.match(lock.LOCK_DATA, /^[1-9]\d*$/u, "Unknown native PRIMARY key encoding");
    return lock.LOCK_DATA === String(row.id);
  }
  assert.match(lock.LOCK_DATA, /^[1-9]\d*, '[^']+'(?:, [1-9]\d*)?$/u, "Unknown native secondary key encoding");
  const key = `${row.sku_id}, '${row.normalized_lot_number}'`;
  return lock.LOCK_DATA === key || lock.LOCK_DATA === `${key}, ${row.id}`;
}

function rememberTransactions(work, snapshot) {
  const tokens = work.observationIdentity.observedEngineTokens;
  const remember = (engine, token) => {
    assert.equal(engine, "INNODB"); assert.match(token, /^[1-9]\d*$/u);
    if (!tokens.some(value => value.engine === engine && value.token === token)) tokens.push({ engine, token,
      performanceThreadId: work.identity.performanceThreadId, observedAt: performance.now() });
  };
  for (const lock of snapshot.locks) if (Number(lock.THREAD_ID) === work.identity.performanceThreadId) {
    const id = String(lock.ENGINE_TRANSACTION_ID);
    remember(lock.ENGINE, id);
  }
  for (const wait of snapshot.waits) {
    const id = String(Number(wait.REQUESTING_THREAD_ID) === work.identity.performanceThreadId
      ? wait.REQUESTING_ENGINE_TRANSACTION_ID : wait.BLOCKING_ENGINE_TRANSACTION_ID);
    remember(wait.ENGINE, id);
  }
}

async function lotLockSnapshot(db, requesting, blocking, deadline, work) {
  await lotProbeState(db, work.identity, work.knownTransactions, deadline);
  work.observationIdentity = rememberObservationIdentity(db, work.identity, []);
  const [waits] = await lotMonitorRead(db, `SELECT w.ENGINE,w.REQUESTING_THREAD_ID,w.BLOCKING_THREAD_ID,
    CAST(w.REQUESTING_ENGINE_TRANSACTION_ID AS CHAR) AS REQUESTING_ENGINE_TRANSACTION_ID,CAST(w.BLOCKING_ENGINE_TRANSACTION_ID AS CHAR) AS BLOCKING_ENGINE_TRANSACTION_ID,
    r.INDEX_NAME,r.LOCK_DATA,r.LOCK_MODE,r.LOCK_STATUS,b.INDEX_NAME AS BLOCKING_INDEX,b.LOCK_DATA AS BLOCKING_DATA
    FROM performance_schema.data_lock_waits w
    JOIN performance_schema.data_locks r ON r.ENGINE=w.ENGINE AND r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
    JOIN performance_schema.data_locks b ON b.ENGINE=w.ENGINE AND b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID
    WHERE w.REQUESTING_THREAD_ID=? AND w.BLOCKING_THREAD_ID=? AND r.OBJECT_SCHEMA=? AND r.OBJECT_NAME='inventory_lots'`,
  [requesting, blocking, process.env.DB_NAME], deadline);
  rememberTransactions(work, { waits, locks: [] });
  const [locks] = await lotMonitorRead(db, `SELECT ENGINE,CAST(ENGINE_TRANSACTION_ID AS CHAR) AS ENGINE_TRANSACTION_ID,THREAD_ID,INDEX_NAME,LOCK_TYPE,LOCK_MODE,LOCK_STATUS,LOCK_DATA
    FROM performance_schema.data_locks WHERE OBJECT_SCHEMA=? AND OBJECT_NAME='inventory_lots' AND THREAD_ID IN (?,?)`,
  [process.env.DB_NAME, requesting, blocking], deadline);
  rememberTransactions(work, { waits: [], locks });
  return { waits, locks };
}

export async function verifyLotLockSafety(fixture) {
  requireObservationLifecycle(fixture);
  assert.equal(fixture?.lotSemanticsVerified, true, "CP11 must complete before CP12");
  const { db, workers, report } = fixture;
  const observation = { kind: "TEST_ONLY_NATIVE_LOT_LOCK_SAFETY", outcome: "IN_PROGRESS", scenarios: [], before: await inventoryState(db) };
  report.lotLockSafety = observation;
  const ownIds = [];
  let blocker, blockerId, blockingThread, primary, active = null;
  async function terminal(result, knownTransactions = new Set()) {
    assert.ok(Number.isSafeInteger(result.connectionId) && Number.isSafeInteger(result.performanceThreadId), "Unknown child identity is not terminal proof");
    const deadline = performance.now() + 20000, seen = knownTransactions;
    while (performance.now() < deadline) {
      result.terminal = await lotProbeState(db, { threadId: result.connectionId, performanceThreadId: result.performanceThreadId }, seen, deadline);
      if (performance.now() >= deadline) throw observationFailure();
      if (result.terminal.terminal) return;
      await setTimeout(25);
    }
    assert.fail("CP12 SQL/transaction/locks must be terminal");
  }
  async function waitForWait(requesting, blocking, completion, work) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const snapshot = await lotLockSnapshot(db, requesting, blocking, deadline, work);
      if (snapshot.waits.length) return { classification: "BLOCKED", ...snapshot };
      if (completion?.settled) return { classification: "COMPLETED_WITHOUT_WAIT", ...snapshot };
      await setTimeout(10);
    }
    assert.fail("Required exact native lock wait or completed contender was not observed");
  }
  function start(shape, scenario) {
    const resolvers = {}, phases = {};
    for (const stage of ["BEFORE", "HOLDING"]) phases[stage] = new Promise(resolve => { resolvers[stage] = resolve; });
    const work = { settled: false, identity: null, knownTransactions: new Set() };
    work.completion = workers[0].lotLock(shape, scenario, message => {
      work.identity = message; if (message.stage === "HOLDING") work.held = true; resolvers[message.stage]?.(message);
    }).then(result => { work.settled = true; return result; }, error => { work.settled = true; throw error; });
    // Attach a handler while native wait observations run; completion still propagates errors to the owner.
    void work.completion.catch(() => {});
    work.phase = stage => Promise.race([phases[stage], work.completion.then(() => assert.fail(`Missing CP12 ${stage} checkpoint`))]);
    work.release = () => workers[0].releaseLot(work.identity.id);
    return work;
  }
  try {
    blocker = await mysql.createConnection(databaseOptions());
    const metadataDeadline = performance.now() + 20000;
    [[blockerId]] = await lotMonitorRead(blocker, "SELECT CONNECTION_ID() AS id", [], metadataDeadline);
    const [blockerThreads] = await lotMonitorRead(db, "SELECT THREAD_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [blockerId.id], metadataDeadline);
    assert.equal(blockerThreads.length, 1); assert.equal(blockerThreads[0].INSTRUMENTED, "YES");
    blockingThread = Number(blockerThreads[0].THREAD_ID);
    observation.blockerConnectionId = Number(blockerId.id); observation.blockerThreadId = blockingThread;
    for (const skuId of [3, 7]) for (const suffix of ["A", "B", "C"]) {
      const [insert] = await db.execute(`INSERT INTO inventory_lots
        (sku_id,lot_number,normalized_lot_number,expiry_date,manufacture_date,first_receipt_date,sku_code_snapshot,created_at,created_by)
        SELECT sku_id,?,?,expiry_date,manufacture_date,first_receipt_date,sku_code_snapshot,created_at,created_by FROM inventory_lots WHERE id=?`,
      [`CP12-${suffix}`, `CP12-${suffix}`, skuId]);
      assert.equal(insert.affectedRows, 1); ownIds.push(Number(insert.insertId));
    }
    const [fixtureRows] = await db.query(`SELECT * FROM inventory_lots WHERE id IN (${ownIds.map(() => "?").join(",")}) ORDER BY sku_id,normalized_lot_number`, ownIds);
    assert.equal(fixtureRows.length, 6);
    observation.fixtureDbOrder = fixtureRows.map(r => ({ id: Number(r.id), skuId: Number(r.sku_id), lot: r.normalized_lot_number }));
    const row = (skuId, suffix) => { const found = fixtureRows.find(r => Number(r.sku_id) === skuId && r.normalized_lot_number === `CP12-${suffix}`); assert.ok(found); return found; };
    for (const scenario of ["CURRENT", "SAME", "CROSS", "MISSING", "UNRELATED", "MULTI", "FAULT"]) {
      const comparisons = [];
      for (const shape of ["OR_BASELINE", "TUPLE_IN_CANDIDATE"]) {
        const entry = { shape, scenario }; observation.scenarios.push(entry);
        await blocker.beginTransaction();
        if (["CURRENT", "SAME", "CROSS"].includes(scenario)) {
          const target = row(scenario === "CROSS" ? 7 : 3, scenario === "CURRENT" ? "A" : "B");
          await blocker.query("SELECT id FROM inventory_lots WHERE id=? FOR UPDATE", [target.id]);
          await blocker.execute("UPDATE inventory_lots SET sku_code_snapshot='CP12-COMMITTED' WHERE id=?", [target.id]);
          entry.targetId = Number(target.id);
        }
        active = start(shape, scenario);
        const identity = await active.phase("BEFORE"); entry.identity = identity;
        if (["CURRENT", "SAME", "CROSS"].includes(scenario)) {
          entry.wait = await waitForWait(identity.performanceThreadId, blockingThread, undefined, active);
          assert.ok(entry.wait.waits.every(w => String(w.LOCK_DATA) === String(entry.targetId) && w.INDEX_NAME === "PRIMARY" && w.BLOCKING_INDEX === "PRIMARY" && w.LOCK_STATUS === "WAITING"));
          for (const wait of entry.wait.waits) {
            assert.match(String(wait.REQUESTING_ENGINE_TRANSACTION_ID), /^\d+$/u); assert.match(String(wait.BLOCKING_ENGINE_TRANSACTION_ID), /^\d+$/u);
          }
          if (scenario !== "CURRENT") {
            const earlier = row(3, scenario === "SAME" ? "A" : "C"), later = row(scenario === "SAME" ? 3 : 7, "C");
            assert.ok(fixtureRows.indexOf(earlier) < fixtureRows.findIndex(r => Number(r.id) === entry.targetId) &&
              fixtureRows.findIndex(r => Number(r.id) === entry.targetId) < fixtureRows.indexOf(later));
            const own = entry.wait.locks.filter(l => Number(l.THREAD_ID) === identity.performanceThreadId);
            assert.ok(own.some(l => l.INDEX_NAME === "PRIMARY" && lotLockOwnsRow(l, earlier)), "Earlier DB key must be granted before the late-key wait");
            assert.ok(!own.some(l => lotLockOwnsRow(l, later)), "Later DB key must not be acquired ahead of blocked key");
          }
          await blocker.commit();
        }
        if (scenario !== "FAULT") {
          entry.held = await active.phase("HOLDING");
          entry.heldLocks = await lotLockSnapshot(db, identity.performanceThreadId, blockingThread, performance.now() + 20000, active);
          if (scenario !== "MULTI") {
            const wanted = lotSafetyKeys(scenario);
            const expectedIds = fixtureRows.filter(r => wanted.some(k => k.skuId === Number(r.sku_id) && k.normalizedLotNumber === r.normalized_lot_number)).map(r => Number(r.id));
            const [oracle] = expectedIds.length ? await db.query(`SELECT * FROM inventory_lots WHERE id IN (${expectedIds.map(() => "?").join(",")}) ORDER BY sku_id,normalized_lot_number`, expectedIds) : [[]];
            assert.equal(entry.held.rowsHash, sha(JSON.stringify(oracle))); assert.deepEqual(entry.held.orderedIds, oracle.map(r => Number(r.id)));
          }
          if (["MISSING", "UNRELATED"].includes(scenario)) {
            const contender = { settled: false };
            const query = scenario === "MISSING" ? blocker.execute(`INSERT INTO inventory_lots
              (sku_id,lot_number,normalized_lot_number,first_receipt_date,sku_code_snapshot,created_at)
              SELECT sku_id,'CP12-BB','CP12-BB',first_receipt_date,sku_code_snapshot,created_at FROM inventory_lots WHERE id=?`, [row(3, "B").id])
              : blocker.execute("UPDATE inventory_lots SET sku_code_snapshot='CP12-UNRELATED' WHERE id=?", [row(7, "A").id]);
            const completed = query.then(value => { contender.settled = true; return value; }, error => { contender.settled = true; entry.contenderError = errorObservation(error); throw error; });
            void completed.catch(() => {});
            entry.contender = await waitForWait(blockingThread, identity.performanceThreadId, contender, active);
            comparisons.push(entry.contender.classification);
            await active.release(); await completed; await blocker.rollback();
          } else { await active.release(); await blocker.rollback(); }
        } else await blocker.rollback();
        entry.result = await active.completion;
        let childFailure;
        try { assert.equal(entry.result.outcome, "COMPLETE"); assert.equal(entry.result.ownerRollbackReturned, true); }
        catch (error) { childFailure = error; }
        entry.observedTransactionIds = [...active.knownTransactions];
        try { await terminal(entry.result, active.knownTransactions); active = null; }
        catch (error) { entry.terminalError = errorObservation(error); childFailure ??= error; }
        if (childFailure) throw childFailure;
        await db.execute(`UPDATE inventory_lots SET sku_code_snapshot=CASE sku_id WHEN 3 THEN ? ELSE ? END WHERE id IN (${ownIds.map(() => "?").join(",")})`,
          [row(3, "A").sku_code_snapshot, row(7, "A").sku_code_snapshot, ...ownIds]);
      }
      if (comparisons.length) assert.equal(comparisons[0], comparisons[1], "Candidate-only gap or unrelated-SKU blocking regression");
    }
  } catch (error) { observation.error = errorObservation(error); primary = error; }
  try {
    if (active && !active.settled && active.held) await active.release();
    await blocker?.rollback();
    if (active) {
      if (!active.settled && !active.held && active.identity) await active.release();
      const actual = await active.completion.catch(error => {
        observation.failedWorkIpcError = errorObservation(error);
        return { outcome: "IPC_FAILURE", connectionId: active.identity?.threadId, performanceThreadId: active.identity?.performanceThreadId };
      });
      observation.failedWorkResult = actual; await terminal(actual, active.knownTransactions); active = null;
    }
  } catch (error) { observation.cleanupError = errorObservation(error); primary ??= error; }
  try {
    await blocker?.end();
    if (blockerId) {
      const [[gone]] = await lotMonitorRead(db, "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID=?", [blockerId.id], performance.now() + 20000);
      assert.equal(Number(gone.n), 0); observation.blockerClosed = true;
    }
  } catch (error) { observation.blockerCleanupError = errorObservation(error); primary ??= error; }
  try {
    assert.equal(active, null, "Unknown child terminal: leave exact fixture cleanup to owned runtime teardown");
    if (ownIds.length) assert.equal(observation.blockerClosed, true, "Unknown blocker terminal: no fixture deletion");
    if (ownIds.length) await db.execute(`DELETE FROM inventory_lots WHERE id IN (${ownIds.map(() => "?").join(",")}) AND normalized_lot_number IN ('CP12-A','CP12-B','CP12-C')`, ownIds);
    observation.after = await inventoryState(db); assert.deepEqual(observation.after, observation.before); observation.externalStateUnchanged = true;
  } catch (error) { observation.stateError = errorObservation(error); primary ??= error; }
  observation.outcome = primary ? "FAIL" : "COMPLETE";
  if (primary) throw primary;
  assert.equal(observation.scenarios.length, 14); fixture.lotLockSafetyCompared = true;
  fixture.lotSafetyVerified = observation.scenarios.every(entry => entry.result.productLotShape === "TUPLE_IN_CANDIDATE");
}

function minimizedPlan(value, result = []) {
  if (!value || typeof value !== "object") return result;
  const fields = ["table_name", "access_type", "possible_keys", "key", "used_key_parts",
    "rows_examined_per_scan", "rows_produced_per_join", "using_filesort", "json_schema_version",
    "index_name", "key_columns", "index_access_type", "estimated_rows", "estimated_total_cost", "covering"];
  const entry = Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  if (Object.keys(entry).length) result.push(entry);
  for (const child of Object.values(value)) if (typeof child === "object") minimizedPlan(child, result);
  return result;
}

async function lotQueryProbe(app, shape, phase, started) {
  databaseOptions();
  assert.ok(["OR_BASELINE", "TUPLE_IN_CANDIDATE"].includes(shape));
  assert.ok(["PLAN", "SELECT"].includes(phase));
  const database = app.services.require("mysqldatabase");
  assert.equal(database.config.queryTimeoutMs, 10000);
  assert.equal(database.config.transactionTimeoutMs, 20000);
  const [lots] = await database.query("SELECT sku_id,normalized_lot_number FROM inventory_lots ORDER BY sku_id,normalized_lot_number");
  assert.equal(lots.length, 25000);
  const sql = lotProbeSql(shape, lots), params = lots.flatMap(row => [Number(row.sku_id), row.normalized_lot_number]);
  const result = { shape, phase, sqlHash: sha(sql), binds: params.length, outcome: "IN_PROGRESS" };
  const wallStart = performance.now();
  try {
    await database.withTransaction(async tx => {
      const [[identity]] = await tx.query("SELECT CONNECTION_ID() AS id");
      result.connectionId = Number(identity.id);
      const [nativeThreads] = await tx.query("SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [result.connectionId]);
      assert.equal(nativeThreads.length, 1); assert.equal(nativeThreads[0].INSTRUMENTED, "YES");
      result.performanceThreadId = Number(nativeThreads[0].THREAD_ID);
      await started(result.connectionId, result.performanceThreadId);
      const queryStart = performance.now();
      try {
        const [rows] = await tx.query((phase === "PLAN" ? "EXPLAIN FORMAT=JSON " : "") + sql, params);
        result.sqlMs = performance.now() - queryStart;
        if (phase === "PLAN") {
          assert.equal(rows.length, 1);
          result.plan = minimizedPlan(JSON.parse(rows[0].EXPLAIN));
          assert.ok(result.plan.length);
          const tables = result.plan.filter(row => row.table_name === "inventory_lots");
          assert.equal(tables.length, 1);
          assert.ok(Number.isFinite(tables[0].estimated_rows ?? tables[0].rows_examined_per_scan));
          const [warnings] = await tx.query("SHOW WARNINGS");
          result.warningCodes = warnings.map(row => Number(row.Code));
        } else {
          result.rowCount = rows.length;
          result.rowsHash = sha(JSON.stringify(rows));
          result.idsHash = sha(JSON.stringify(rows.map(row => Number(row.id))));
        }
      } catch (error) { result.sqlMs = performance.now() - queryStart; throw error; }
    });
    result.outcome = "COMPLETE";
  } catch (error) { result.outcome = "FAILED"; result.error = errorObservation(error); }
  result.wallMs = performance.now() - wallStart;
  return result;
}

function observationFailure(code = "TEST_OBSERVATION_TIMEOUT") {
  return Object.assign(new Error("Owned SQL observation did not complete within its original budget"), { code });
}
async function withinObservation(work, deadline) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw observationFailure();
  let timer;
  try {
    const value = await Promise.race([work, new Promise((_, reject) => {
      timer = globalThis.setTimeout(() => reject(observationFailure()), remaining);
    })]);
    if (performance.now() >= deadline) throw observationFailure();
    return value;
  } finally { globalThis.clearTimeout(timer); }
}
async function lotMonitorRead(db, sql, params, deadline, observation) {
  const attemptedAt = performance.now(), readDeadline = Math.min(deadline, attemptedAt + 10000);
  const remaining = Math.floor(readDeadline - attemptedAt);
  const timeout = Object.assign(new Error("Owned Lot monitor observation timed out"), { code: "TEST_OBSERVATION_TIMEOUT" });
  if (remaining <= 0) throw observation?.sampling ? observationFailure("TEST_SAMPLING_WINDOW_CLOSED") : timeout;
  const label = /information_schema\.PROCESSLIST/u.test(sql) ? "SESSION" : /performance_schema\.threads/u.test(sql) ? "THREAD" :
    /information_schema\.innodb_trx/u.test(sql) ? "TRANSACTION" : /data_lock_waits/u.test(sql) ? "WAIT" :
      /data_locks/u.test(sql) ? "LOCK" : /events_statements_current/u.test(sql) ? "STATEMENT" : "INSTRUMENTATION";
  const event = { queryLabel: label, attemptAt: attemptedAt, dispatchAt: null, remainingMs: remaining, status: "IN_PROGRESS" };
  if (observation) {
    if (observation.events.length < 10000) observation.events.push(event);
    else { observation.droppedEvents++; event.dropped = true; }
  }
  function destroyOwnedMonitor(error) {
    try { db.destroy(); } catch (cleanupError) { error.monitorCleanupError = errorObservation(cleanupError); }
    return error;
  }
  // INNODB_TRX refresh needs >100ms without a read; rapid polling keeps its old snapshot alive.
  const transactionRead = sql.includes("information_schema.innodb_trx");
  let timer;
  try {
    if (transactionRead) {
      const notBefore = (transactionObservationReads.get(db) ?? -Infinity) + 125;
      if (notBefore >= readDeadline) throw observation?.sampling ? observationFailure("TEST_SAMPLING_WINDOW_CLOSED") : timeout;
      if (notBefore > performance.now()) await setTimeout(notBefore - performance.now());
    }
    const expired = new Promise((_resolve, reject) => {
      timer = globalThis.setTimeout(() => reject(destroyOwnedMonitor(timeout)), Math.max(0, Math.floor(readDeadline - performance.now())));
    });
    const value = await Promise.race([Promise.resolve().then(() => {
      const atDispatch = Math.floor(readDeadline - performance.now());
      if (atDispatch <= 0) throw observation?.sampling ? observationFailure("TEST_SAMPLING_WINDOW_CLOSED") : timeout;
      event.dispatchAt = performance.now(); event.remainingMs = atDispatch;
      return db.query({ sql, timeout: atDispatch }, params);
    }), expired]);
    if (performance.now() >= readDeadline) throw destroyOwnedMonitor(timeout);
    event.status = "COMPLETE";
    return value;
  } catch (error) {
    event.status = error.code === "TEST_SAMPLING_WINDOW_CLOSED" ? "SAMPLING_WINDOW_CLOSED" : "FAIL"; event.error = errorObservation(error);
    if (event.dropped && observation && event.status === "FAIL") observation.requiredFailureEventMissing = true;
    if (error.code === "PROTOCOL_SEQUENCE_TIMEOUT") destroyOwnedMonitor(error);
    throw error;
  } finally {
    globalThis.clearTimeout(timer); event.settledAt = performance.now(); event.elapsedMs = event.settledAt - (event.dispatchAt ?? event.attemptAt);
    if (transactionRead && event.dispatchAt !== null) transactionObservationReads.set(db, event.settledAt);
  }
}

async function lotProbeState(db, identity, seenTransactions, deadline, observation) {
  const read = (sql, params) => lotMonitorRead(db, sql, params, deadline, observation);
  const [states] = await read("SELECT ID,COMMAND,STATE FROM information_schema.PROCESSLIST WHERE ID=?", [identity.threadId]);
  const [threads] = await read("SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [identity.threadId]);
  if (states.length) assert.equal(threads.length, 1, "A live native session needs a real P_S mapping, not aggregate zero");
  const entry = rememberObservationIdentity(db, identity, threads);
  for (const id of seenTransactions) { assert.match(id, /^\d+$/u); if (!entry.observedTransactionIds.includes(id)) entry.observedTransactionIds.push(id); }
  const [transactions] = await read("SELECT CAST(trx_id AS CHAR) AS trx_id FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?", [identity.threadId]);
  for (const row of transactions) {
    const id = String(row.trx_id); assert.match(id, /^\d+$/u); seenTransactions.add(id);
    if (!entry.observedTransactionIds.includes(id)) entry.observedTransactionIds.push(id);
  }
  const tokens = entry.observedEngineTokens, conditions = tokens.map(() => "(ENGINE=? AND ENGINE_TRANSACTION_ID=?)");
  const [locks] = await read(`SELECT ENGINE,CAST(ENGINE_TRANSACTION_ID AS CHAR) AS ENGINE_TRANSACTION_ID,THREAD_ID FROM performance_schema.data_locks
    WHERE THREAD_ID=?${conditions.length ? " OR " + conditions.join(" OR ") : ""}`,
  [identity.performanceThreadId, ...tokens.flatMap(token => [token.engine, token.token])]);
  for (const row of locks) {
    assert.equal(Number(row.THREAD_ID), identity.performanceThreadId, "Ambiguous or foreign lock engine token is UNKNOWN");
    const token = String(row.ENGINE_TRANSACTION_ID); assert.match(token, /^\d+$/u); assert.equal(row.ENGINE, "INNODB");
    if (!tokens.some(value => value.engine === row.ENGINE && value.token === token)) tokens.push({ engine: row.ENGINE, token,
      performanceThreadId: identity.performanceThreadId, observedAt: performance.now() });
  }
  const [retained] = entry.observedTransactionIds.length ? await read(`SELECT CAST(trx_id AS CHAR) AS trx_id FROM information_schema.innodb_trx
    WHERE trx_id IN (${entry.observedTransactionIds.map(() => "?").join(",")})`, entry.observedTransactionIds) : [[]];
  const waitConditions = tokens.map(() => "(ENGINE=? AND (REQUESTING_ENGINE_TRANSACTION_ID=? OR BLOCKING_ENGINE_TRANSACTION_ID=?))");
  const [[waits]] = await read(`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits WHERE REQUESTING_THREAD_ID=? OR BLOCKING_THREAD_ID=?${waitConditions.length ? " OR " + waitConditions.join(" OR ") : ""}`,
  [identity.performanceThreadId, identity.performanceThreadId, ...tokens.flatMap(token => [token.engine, token.token, token.token])]);
  const [statements] = await read(`SELECT EVENT_ID,END_EVENT_ID,EVENT_NAME
    FROM performance_schema.events_statements_current WHERE THREAD_ID=?`, [identity.performanceThreadId]);
  const activeStatement = statements.some(row => row.END_EVENT_ID === null);
  const terminal = transactions.length === 0 && retained.length === 0 && locks.length === 0 && Number(waits.n) === 0 && !activeStatement &&
    (states.length === 0 ? threads.length === 0 : states.length === 1 && states[0].COMMAND === "Sleep");
  return { atMs: performance.now(), states, threads, statements, activeStatement, transactions: transactions.length,
    retainedTransactions: retained.length, observedTransactionIds: [...entry.observedTransactionIds], observedEngineTokens: [...tokens], locks: locks.length, waits: Number(waits.n), terminal };
}

function rememberObservationIdentity(db, identity, mapping) {
  const workers = observationOwners.get(db);
  assert.ok(workers, "Missing fixture identity owner is UNKNOWN");
  const owners = workers.filter(w => w.connections.has(identity.threadId));
  assert.equal(owners.length, 1, "Native connection must have one actual owned worker");
  const owner = owners[0]; owner.observationIdentities ??= new Map();
  let entry = owner.observationIdentities.get(identity.threadId);
  if (mapping.length) {
    assert.equal(mapping.length, 1); const row = mapping[0];
    assert.equal(Number(row.PROCESSLIST_ID), identity.threadId); assert.equal(row.INSTRUMENTED, "YES");
    const performanceThreadId = Number(row.THREAD_ID); assert.ok(Number.isSafeInteger(performanceThreadId) && performanceThreadId > 0);
    if (identity.performanceThreadId !== undefined) assert.equal(identity.performanceThreadId, performanceThreadId);
    for (const worker of workers) for (const known of worker.observationIdentities?.values() ?? []) {
      if (known.performanceThreadId === performanceThreadId) assert.ok(worker === owner && known.threadId === identity.threadId, "Foreign P_S identity is UNKNOWN");
    }
    if (entry) assert.equal(entry.performanceThreadId, performanceThreadId, "Reused native ID cannot change mapping");
    else {
      entry = { threadId: identity.threadId, performanceThreadId, incarnation: owner.incarnation,
        observedTransactionIds: [], observedEngineTokens: [], firstObservedAt: performance.now(), provenance: "OWNED_MONITOR_LIVE_QUERY" };
      owner.observationIdentities.set(identity.threadId, entry);
    }
  }
  assert.ok(entry, "Missing native P_S mapping without verified history is UNKNOWN, not aggregate zero");
  assert.equal(entry.incarnation, owner.incarnation);
  assert.ok(["SAME_CONNECTION_DRIVER_QUERY", "OWNED_MONITOR_LIVE_QUERY"].includes(entry.provenance), "Unverified mapping provenance remains UNKNOWN");
  if (entry.provenance === "SAME_CONNECTION_DRIVER_QUERY") {
    assert.ok(Number.isFinite(entry.childObservedAt) && entry.childObservedAt >= 0);
    assert.ok(owner.connectionEvents.some(event => event.threadId === entry.threadId && event.nonce === entry.nonce));
  }
  if (identity.incarnation !== undefined) assert.equal(identity.incarnation, owner.incarnation);
  if (identity.performanceThreadId !== undefined) assert.equal(identity.performanceThreadId, entry.performanceThreadId);
  return entry;
}

async function captureOwnedSql(db, workers, observation) {
  const deadline = performance.now() + 5000, usedThreads = new Set();
  observationOwners.set(db, workers);
  const read = (sql, params = []) => lotMonitorRead(db, sql, params, deadline);
  try {
    const [[instrumentation]] = await read("SELECT @@performance_schema AS enabled");
    assert.equal(Number(instrumentation.enabled), 1);
    const [consumers] = await read(`SELECT NAME,ENABLED FROM performance_schema.setup_consumers
      WHERE NAME IN ('events_statements_current','global_instrumentation','thread_instrumentation') ORDER BY NAME`);
    assert.deepEqual(consumers.map(row => [row.NAME, row.ENABLED]), [
      ["events_statements_current", "YES"], ["global_instrumentation", "YES"], ["thread_instrumentation", "YES"]
    ]);
    const [instruments] = await read("SELECT NAME,ENABLED FROM performance_schema.setup_instruments WHERE NAME LIKE 'statement/sql/%'");
    for (const name of ["select", "insert", "update", "delete", "begin", "commit", "rollback"]) {
      assert.ok(instruments.some(row => row.NAME === `statement/sql/${name}`), "Missing SQL instrumentation is UNKNOWN, not zero active statements");
    }
    assert.ok(instruments.every(row => row.ENABLED === "YES"), "Disabled SQL statement instrumentation is not zero active statements");
    for (const w of workers) {
      const captured = { incarnation: w.incarnation, connections: [] }; observation.workers.push(captured);
      assert.ok(w.connections.size > 0, "Owned native SQL connection identities were not observed");
      for (const threadId of w.connections) {
        assert.ok(Number.isSafeInteger(threadId) && threadId > 0);
        const [mapping] = await read("SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [threadId]);
        const identity = rememberObservationIdentity(db, { threadId }, mapping), performanceThreadId = identity.performanceThreadId;
        assert.equal(usedThreads.has(performanceThreadId), false, "Owned workers cannot share a native P_S thread");
        usedThreads.add(performanceThreadId);
        captured.connections.push(identity);
        const seen = new Set(identity.observedTransactionIds);
        try { await lotProbeState(db, identity, seen, deadline); }
        finally { identity.observedTransactionIds = [...seen]; }
      }
    }
    assert.ok(performance.now() < deadline, "SQL identity capture exceeded its original deadline");
    observation.status = "CAPTURED";
  } catch (error) { observation.status = "UNKNOWN"; observation.error = errorObservation(error); throw error; }
}

async function verifyOwnedSqlTerminal(db, ownedWorker, stop, capture) {
  const started = performance.now(), deadline = started + 20000;
  try {
    assert.equal(stop.terminal, true); assert.ok(stop.exit, "Unknown actual child exit is not SQL terminal proof");
    assert.equal(stop.incarnation, ownedWorker.incarnation); assert.equal(capture.incarnation, ownedWorker.incarnation);
    const ids = [...ownedWorker.connections].sort((a, b) => a - b);
    assert.deepEqual([...stop.connections].sort((a, b) => a - b), ids);
    assert.deepEqual(capture.connections.map(row => row.threadId).sort((a, b) => a - b), ids, "Uncaptured late native connections remain UNKNOWN");
    assert.ok(ids.length > 0);
    const seen = capture.connections.map(identity => new Set(identity.observedTransactionIds));
    capture.polls = 0; capture.status = "VERIFYING";
    while (performance.now() < deadline) {
      capture.polls++; const samples = [];
      for (const [index, identity] of capture.connections.entries()) {
        assert.ok(Number.isSafeInteger(identity.performanceThreadId) && identity.performanceThreadId > 0);
        try {
          const state = await lotProbeState(db, identity, seen[index], deadline), transactions = [...seen[index]];
          for (const id of transactions) assert.match(id, /^\d+$/u);
          const [[retained]] = transactions.length ? await lotMonitorRead(db,
            `SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_id IN (${transactions.map(() => "?").join(",")})`, transactions, deadline) : [[{ n: 0 }]];
          const related = { n: state.waits };
          samples.push({ ...state, retainedTransactions: Number(retained.n), relatedWaits: Number(related.n),
            terminal: state.terminal && state.states.length === 0 && state.threads.length === 0 && state.waits === 0 && Number(retained.n) === 0 && Number(related.n) === 0 });
        } finally { identity.observedTransactionIds = [...seen[index]]; }
      }
      capture.latest = samples;
      if (samples.every(sample => sample.terminal)) {
        assert.ok(performance.now() < deadline, "SQL terminal result exceeded its original deadline");
        capture.status = "SQL_TERMINAL_CONFIRMED"; capture.completeMs = performance.now() - started;
        return capture;
      }
      await setTimeout(Math.min(25, Math.max(0, deadline - performance.now())));
    }
    throw Object.assign(new Error("Owned SQL terminal was not observed within its original budget"), { code: "TEST_OBSERVATION_TIMEOUT" });
  } catch (error) { capture.status = "SQL_TERMINAL_UNKNOWN"; capture.error = errorObservation(error); throw error; }
}

function lotSampleAdmission(now, deadline, settled) {
  if (settled) return "CHILD_SETTLED";
  if (deadline - now <= 0) return "WINDOW_CLOSED_BEFORE_DISPATCH";
  return deadline - now >= 1000 ? "ADMITTED" : "NOT_ADMITTED_RESERVE";
}

export async function verifyLotQueryComparison(fixture) {
  requireObservationLifecycle(fixture);
  assert.equal(fixture?.controlLockVerified, true, "CP09 must complete before Lot comparison");
  const { db, workers, report } = fixture;
  const observation = { kind: "TEST_ONLY_OR_TUPLE_IN_COMPARISON_NOT_HTTP_POST", probes: [], outcome: "IN_PROGRESS",
    settingsUnchanged: true, cache: "FIRST_TOUCH_THEN_BALANCED_WARM; NOT_OS_COLD", queryDeadlineMs: 10000 };
  report.lotQueryComparison = observation;
  try {
    const deadline = performance.now() + 20000;
    const [[instrumentation]] = await lotMonitorRead(db, "SELECT @@performance_schema AS enabled", [], deadline);
    assert.equal(Number(instrumentation.enabled), 1);
    const [consumers] = await lotMonitorRead(db, `SELECT NAME,ENABLED FROM performance_schema.setup_consumers
      WHERE NAME IN ('events_statements_current','global_instrumentation','thread_instrumentation') ORDER BY NAME`, [], deadline);
    const [instruments] = await lotMonitorRead(db, "SELECT NAME,ENABLED FROM performance_schema.setup_instruments WHERE NAME='statement/sql/select'", [], deadline);
    observation.instrumentation = { consumers, instruments };
    assert.deepEqual(consumers.map(row => [row.NAME, row.ENABLED]), [
      ["events_statements_current", "YES"], ["global_instrumentation", "YES"], ["thread_instrumentation", "YES"]
    ]);
    assert.equal(instruments.length, 1); assert.equal(instruments[0].ENABLED, "YES");
  } catch (error) { observation.outcome = "FAIL"; observation.error = errorObservation(error); throw error; }
  const before = await inventoryState(db);
  const [expected] = await db.query("SELECT * FROM inventory_lots ORDER BY sku_id,normalized_lot_number");
  assert.equal(expected.length, 25000);
  observation.expectedRowsHash = sha(JSON.stringify(expected));
  observation.expectedIdsHash = sha(JSON.stringify(expected.map(row => Number(row.id))));
  async function probe(shape, phase, round) {
    let started;
    const start = new Promise(resolve => { started = resolve; });
    const dispatchAt = performance.now(), samplingDeadline = dispatchAt + 20000;
    let settled = false, completionObservedAt;
    const completion = workers[0].lotProbe(shape, phase, started).finally(() => { settled = true; completionObservedAt = performance.now(); });
    void completion.catch(() => {});
    const actual = { shape, phase, round, dispatchAt, samplingDeadline, events: [], droppedEvents: 0, terminalSamples: [], transactionTerminal: false,
      admission: { reserveMs: 1000, offers: [], attempted: 0, admitted: 0, completed: 0, partial: 0, failed: 0, notAdmitted: 0, reserveCount: 0, pending: 0, droppedOffers: 0 } };
    observation.probes.push(actual);
    const samples = [], seenTransactions = new Set();
    let monitorError, monitorFailure;
    let identity, result;
    try {
      identity = await withinObservation(Promise.race([start, completion.then(() => assert.fail("Missing native probe start identity"))]), samplingDeadline);
      assert.ok(Number.isSafeInteger(identity.performanceThreadId));
      actual.actualSampleCount = 0; actual.droppedStoredSamples = 0;
      const admission = actual.admission;
      while (true) {
        const now = performance.now(), decision = lotSampleAdmission(now, samplingDeadline, settled);
        if (decision === "CHILD_SETTLED") break;
        const offer = { seq: ++admission.attempted, now, remainingMs: samplingDeadline - now, decision,
          queryStart: actual.events.length + actual.droppedEvents, queryEnd: null, outcome: null };
        if (admission.offers.length < 500) admission.offers.push(offer); else admission.droppedOffers++;
        assert.equal(decision, offer.remainingMs <= 0 ? "WINDOW_CLOSED_BEFORE_DISPATCH" :
          offer.remainingMs < 1000 ? "NOT_ADMITTED_RESERVE" : "ADMITTED");
        if (decision !== "ADMITTED") {
          admission.notAdmitted++; offer.outcome = "NOT_ADMITTED"; offer.queryEnd = offer.queryStart;
          if (decision === "NOT_ADMITTED_RESERVE") admission.reserveCount++;
          actual.samplingStatus = decision; break;
        }
        admission.admitted++; admission.pending++;
        const samplingObservation = { events: [], droppedEvents: 0, sampling: true };
        try {
          const sample = await lotProbeState(db, identity, seenTransactions, samplingDeadline, samplingObservation);
          for (const label of ["SESSION", "THREAD", "TRANSACTION", "LOCK", "WAIT", "STATEMENT"]) {
            assert.ok(samplingObservation.events.some(event => event.queryLabel === label && event.status === "COMPLETE"), "Complete sample needs all native metadata labels");
          }
          admission.completed++; offer.outcome = "COMPLETE";
          actual.actualSampleCount++;
          if (samples.length < 500) samples.push(sample); else actual.droppedStoredSamples++;
        } catch (error) {
          if (error.code === "TEST_SAMPLING_WINDOW_CLOSED" && !samplingObservation.events.some(event => event.status === "FAIL")) {
            admission.partial++; offer.outcome = "PARTIAL_WINDOW_CLOSED"; actual.samplingStatus = "SAMPLING_WINDOW_CLOSED"; break;
          }
          admission.failed++; offer.outcome = "FAIL";
          monitorError ??= errorObservation(error); monitorFailure ??= error; break;
        } finally {
          admission.pending--;
          offer.observedTransactionIds = [...seenTransactions];
          offer.observedEngineTokens = (workers[0].observationIdentities?.get(identity.threadId)?.observedEngineTokens ?? [])
            .map(token => ({ engine: token.engine, token: token.token, performanceThreadId: token.performanceThreadId, observedAt: token.observedAt }));
          try {
            for (const event of samplingObservation.events) {
              assert.ok(event.attemptAt >= offer.now && event.attemptAt < samplingDeadline);
              assert.ok(Number.isFinite(event.settledAt) && event.settledAt >= event.attemptAt);
              if (event.dispatchAt !== null) {
                assert.ok(event.dispatchAt >= event.attemptAt && event.dispatchAt < samplingDeadline);
                assert.ok(event.remainingMs > 0 && event.remainingMs <= Math.min(10000, samplingDeadline - event.dispatchAt) + 1);
                assert.notEqual(event.status, "SAMPLING_WINDOW_CLOSED", "Window closure cannot hide a dispatched query");
              }
              if (event.status === "COMPLETE") {
                assert.notEqual(event.dispatchAt, null);
                assert.ok(event.settledAt < Math.min(samplingDeadline, event.attemptAt + 10000));
              } else assert.ok(["FAIL", "SAMPLING_WINDOW_CLOSED"].includes(event.status));
            }
          } catch (error) {
            offer.auditError = errorObservation(error);
            if (offer.outcome !== "FAIL") {
              if (offer.outcome === "COMPLETE") {
                admission.completed--; actual.actualSampleCount--;
                if (actual.droppedStoredSamples) actual.droppedStoredSamples--; else samples.pop();
              } else admission.partial--;
              admission.failed++; offer.outcome = "FAIL";
            }
            monitorError ??= errorObservation(error); monitorFailure ??= error;
          }
          for (const event of samplingObservation.events) {
            if (actual.events.length < 10000) actual.events.push(event);
            else { actual.droppedEvents++; if (event.status === "FAIL") actual.requiredFailureEventMissing = true; }
          }
          offer.queryEnd = actual.events.length + actual.droppedEvents;
        }
        if (monitorFailure) break;
        if (!settled) await setTimeout(Math.min(25, Math.max(0, samplingDeadline - performance.now())));
      }
      actual.samplingStatus ??= settled ? "CHILD_SETTLED" : "SAMPLING_WINDOW_CLOSED";
      actual.samplingEventCount = actual.events.length + actual.droppedEvents;
      actual.samplingDroppedEvents = actual.droppedEvents;
      assert.equal(admission.attempted, admission.admitted + admission.notAdmitted);
      assert.equal(admission.admitted, admission.completed + admission.partial + admission.failed);
      assert.equal(admission.pending, 0);
      assert.equal(admission.offers.length + admission.droppedOffers, admission.attempted);
      assert.equal(actual.actualSampleCount, admission.completed);
      assert.equal(samples.length + actual.droppedStoredSamples, admission.completed);
      admission.reserveBranch = admission.reserveCount ? "EXERCISED" : "NOT_EXERCISED";
      actual.terminalDeadline = Math.min(completionObservedAt ?? samplingDeadline, samplingDeadline) + 20000;
      result = await withinObservation(completion, actual.terminalDeadline);
      actual.completionObservedAt = completionObservedAt;
      actual.terminalDeadline = Math.min(completionObservedAt, samplingDeadline) + 20000;
      assert.ok(performance.now() < actual.terminalDeadline);
    } catch (error) {
      workers[0].quarantined = true;
      actual.error = errorObservation(error); throw monitorFailure ?? error;
    } finally { Object.assign(actual, { samples, monitorError }); }
    Object.assign(actual, result);
    assert.equal(actual.connectionId, identity.threadId);
    assert.equal(actual.performanceThreadId, identity.performanceThreadId);
    if (monitorFailure) { workers[0].quarantined = true; throw monitorFailure; }
    actual.terminalObservationStartedAt = performance.now();
    try {
      while (performance.now() < actual.terminalDeadline) {
        const terminalObservation = { events: [], droppedEvents: 0 };
        let sample;
        try { sample = await lotProbeState(db, identity, seenTransactions, actual.terminalDeadline, terminalObservation); }
        finally {
          for (const event of terminalObservation.events) {
            if (actual.events.length < 10000) actual.events.push(event);
            else { actual.droppedEvents++; if (event.status === "FAIL") actual.requiredFailureEventMissing = true; }
          }
        }
        if (performance.now() >= actual.terminalDeadline) throw observationFailure();
        for (const event of terminalObservation.events) {
          assert.ok(event.attemptAt >= actual.completionObservedAt);
          assert.equal(event.status, "COMPLETE");
          assert.ok(event.settledAt < Math.min(actual.terminalDeadline, event.attemptAt + 10000));
        }
        if (actual.terminalSamples.length < 500) actual.terminalSamples.push(sample);
        if (sample.terminal) { actual.transactionTerminal = true; break; }
        await setTimeout(Math.min(25, Math.max(0, actual.terminalDeadline - performance.now())));
      }
      assert.equal(actual.transactionTerminal, true, "Exact native session/statement/transaction/locks must be terminal before another probe");
      assert.ok(actual.terminalObservationStartedAt >= actual.completionObservedAt);
      assert.equal(actual.terminalDeadline, Math.min(actual.completionObservedAt, samplingDeadline) + 20000);
      for (const event of actual.events.slice(actual.samplingEventCount)) {
        assert.ok(event.attemptAt >= actual.completionObservedAt);
        if (event.status === "COMPLETE") assert.ok(event.settledAt < actual.terminalDeadline);
      }
      assert.notEqual(actual.requiredFailureEventMissing, true, "Required failure query event was dropped");
    } catch (error) { workers[0].quarantined = true; throw error; }
    assert.equal(monitorError, undefined, "Required native plan/wait observation must be available");
    assert.ok(samples.length > 0);
    if (actual.outcome === "FAILED") {
      assert.ok(actual.error.codes.includes("DATABASE_QUERY_TIMEOUT"), "Only original query timeout is an expected diagnostic outcome");
      actual.rightCensoredMs = 10000;
    } else if (phase === "SELECT") {
      assert.equal(actual.rowCount, 25000); assert.equal(actual.rowsHash, observation.expectedRowsHash);
      assert.equal(actual.idsHash, observation.expectedIdsHash);
    }
    return actual;
  }
  let primary;
  try {
    for (const shape of ["OR_BASELINE", "TUPLE_IN_CANDIDATE"]) await probe(shape, "PLAN", "FIRST_TOUCH");
    assert.equal(observation.probes.find(p => p.shape === "TUPLE_IN_CANDIDATE").outcome, "COMPLETE", "Candidate plan is mandatory");
    for (let round = 0; round < 6; round++) {
      for (const shape of round % 2 ? ["TUPLE_IN_CANDIDATE", "OR_BASELINE"] : ["OR_BASELINE", "TUPLE_IN_CANDIDATE"]) {
        await probe(shape, "SELECT", round);
      }
    }
    const reads = observation.probes.filter(p => p.phase === "SELECT");
    const baseline = reads.filter(p => p.shape === "OR_BASELINE"), candidate = reads.filter(p => p.shape === "TUPLE_IN_CANDIDATE");
    assert.equal(baseline.length, 6); assert.equal(candidate.length, 6);
    assert.ok(candidate.every(p => p.outcome === "COMPLETE" && p.sqlMs < 10000));
    observation.candidateMaxMs = Math.max(...candidate.map(p => p.sqlMs));
    observation.baselineMinimumOrCensorMs = Math.min(...baseline.map(p => p.outcome === "COMPLETE" ? p.sqlMs : p.rightCensoredMs));
    assert.ok(observation.candidateMaxMs < observation.baselineMinimumOrCensorMs, "Do not retain a neutral or slower optimization");
  } catch (error) { primary = error; observation.error = errorObservation(error); workers[0].quarantined = true; }
  try {
    assert.equal(workers.some(w => w.quarantined), false, "Unknown probe SQL forbids full-table reconciliation");
    observation.after = await inventoryState(db);
    assert.deepEqual(observation.after, before, "Read-only Lot comparison must leave all Inventory rows unchanged");
    observation.externalStateUnchanged = true;
  } catch (error) { observation.reconciliationError = errorObservation(error); primary ??= error; }
  observation.outcome = primary ? "FAIL" : "COMPLETE";
  if (primary) throw primary;
  fixture.lotQueryCompared = true;
}

function requireObservationLifecycle(fixture) {
  assert.equal(fixture?.observationLifecycleVerified, true, "CP14 observation lifecycle must complete before subsequent workload");
  assert.equal(fixture?.shortConnectionVerified, true, "CP15 short-lived connection proof must complete before subsequent workload");
  assert.equal(fixture.workers.some(w => w.quarantined), false, "Unknown lifecycle forbids later dispatch");
}
function assertObservationReplacement(w, before, dispatchAt, completeAt) {
  assert.equal(before.length, 1, "Replacement needs one actual original connection, not an alternate");
  const fresh = [...w.connections].filter(id => !before.includes(id)); assert.equal(fresh.length, 1);
  assert.equal(w.connections.size, 2);
  const events = w.connectionEvents.filter(event => event.threadId === fresh[0]);
  assert.equal(events.length, 1); assert.ok(events[0].receivedAt >= dispatchAt && events[0].receivedAt <= completeAt);
  for (const id of [...before, ...fresh]) {
    const entry = w.observationIdentities.get(id); assert.ok(entry); assert.equal(entry.incarnation, w.incarnation);
    assert.ok(Number.isSafeInteger(entry.performanceThreadId) && entry.performanceThreadId > 0);
  }
  assert.notEqual(w.observationIdentities.get(before[0]).performanceThreadId, w.observationIdentities.get(fresh[0]).performanceThreadId);
  return fresh[0];
}
export async function verifyObservationLifecycle(fixture) {
  assert.ok(fixture);
  const { db, workers, actors, report, request, observationLane: lane } = fixture;
  const observation = { kind: "TEST_ONLY_OWNED_OBSERVATION_LIFECYCLE_NOT_PRODUCT_RECOVERY_SLA", outcome: "IN_PROGRESS", checkpoints: [] };
  report.observationLifecycle = observation; fixture.observationLifecycleVerified = false;
  try {
    assert.equal(fixture.controlLockVerified, true); assert.equal(workers.some(w => w.quarantined), false);
    observation.before = await inventoryState(db);
    await lane.open(); await lane.refresh();
    const other = actors.find(a => a.worker === 0 && !a.writer), w = lane.owner;
    observation.role = w.role; observation.incarnation = w.incarnation;
    const [[sku]] = await db.query("SELECT sku_code FROM item_skus WHERE id=1");
    const route = "/api/v1/inventory/sku-lookup?code=" + encodeURIComponent(sku.sku_code);
    await lane.request(route);
    const captured = { workers: [] }; await captureOwnedSql(db, workers, captured);
    const before = [...w.connections]; assert.equal(before.length, 1);
    assert.ok(captured.workers.find(row => row.incarnation === w.incarnation).connections.every(entry => entry.threadId === before[0]));
    const nonce = randomUUID(), heldAt = performance.now(), deadline = heldAt + 5000;
    let holding, callbackSettled;
    const started = new Promise(resolve => { holding = resolve; });
    const completion = w.observationHold(nonce, checkpoint => {
      observation.checkpoints.push(checkpoint);
      if (checkpoint.stage === "HOLDING") holding(checkpoint); else callbackSettled = checkpoint;
    });
    void completion.catch(() => {});
    const identity = await withinObservation(Promise.race([started, completion.then(() => assert.fail("Missing HOLDING checkpoint"))]), deadline);
    assert.equal(identity.threadId, before[0]);
    const seen = new Set(); let state;
    while (performance.now() < deadline) {
      state = await lotProbeState(db, identity, seen, deadline);
      const [locks] = await lotMonitorRead(db, "SELECT ENGINE,CAST(ENGINE_TRANSACTION_ID AS CHAR) AS ENGINE_TRANSACTION_ID,THREAD_ID FROM performance_schema.data_locks WHERE THREAD_ID=? AND OBJECT_SCHEMA=DATABASE() AND OBJECT_NAME='inventory_warehouses' AND LOCK_TYPE='RECORD' AND LOCK_STATUS='GRANTED' AND INDEX_NAME='PRIMARY' AND LOCK_DATA='5'", [identity.performanceThreadId], deadline);
      if (locks.length) { observation.heldLock = locks; break; }
      await setTimeout(10);
    }
    assert.ok(observation.heldLock?.length); observation.held = state;
    const abortAt = performance.now(), terminalDeadline = abortAt + 20000;
    observation.abortReply = await withinObservation(w.observationAbort(nonce), terminalDeadline);
    assert.equal(observation.abortReply.aborted, true); assert.equal(observation.abortReply.nonce, nonce);
    observation.completion = await withinObservation(completion, terminalDeadline);
    assert.equal(observation.completion.outcome, "FAILED"); assert.equal(observation.completion.callbackSettled, true);
    assert.ok(observation.completion.error.codes.includes("TEST_OBSERVATION_ABORT"));
    assert.ok(observation.completion.callbackError?.codes.includes("TEST_OBSERVATION_ABORT"));
    assert.equal(observation.completion.nonce, nonce); assert.equal(callbackSettled?.threadId, identity.threadId);
    let terminal;
    while (performance.now() < terminalDeadline) {
      terminal = await lotProbeState(db, identity, seen, terminalDeadline);
      if (performance.now() >= terminalDeadline) throw observationFailure();
      if (terminal.terminal && terminal.states.length === 0 && terminal.threads.length === 0) break;
      await setTimeout(10);
    }
    assert.ok(terminal?.terminal && terminal.states.length === 0 && terminal.threads.length === 0);
    observation.terminal = terminal;
    assert.equal(w.child.exitCode, null); assert.equal(w.child.signalCode, null); assert.equal(w.child.connected, true);
    assert.deepEqual([...w.connections], before, "No alternate or unexpected new connection before recovery GET");
    assert.equal(report.requests.some(row => row.worker === 2 && row.completeMs === null), false, "Recovery cannot overlap another owned worker request");
    const requestCount = report.requests.length; await lane.request(route);
    const recoveryRows = report.requests.slice(requestCount); assert.equal(recoveryRows.length, 1, "Recovery GET must not create a token-refresh request");
    const recovery = recoveryRows[0]; assert.equal(recovery.action, route); assert.equal(recovery.outcome, "COMPLETE");
    assert.ok(Number.isFinite(recovery.dispatchAt) && Number.isFinite(recovery.completeMs));
    const recoveryAt = recovery.dispatchAt, recoveryCompleteAt = recovery.dispatchAt + recovery.completeMs;
    const after = { workers: [] }; await captureOwnedSql(db, workers, after);
    observation.replacementId = assertObservationReplacement(w, before, recoveryAt, recoveryCompleteAt);
    const [live] = await lotMonitorRead(db, "SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID IN (?,?)", [before[0], observation.replacementId], performance.now() + 5000);
    assert.equal(live.length, 1); assert.equal(Number(live[0].PROCESSLIST_ID), observation.replacementId); assert.equal(live[0].INSTRUMENTED, "YES");
    assert.equal(Number(live[0].THREAD_ID), w.observationIdentities.get(observation.replacementId).performanceThreadId);
    await request(other, route);
    observation.after = await inventoryState(db); assert.deepEqual(observation.after, observation.before);
    observation.outcome = "COMPLETE"; fixture.observationLifecycleVerified = true;
  } catch (error) {
    fixture.observationLifecycleVerified = false; fixture.shortConnectionVerified = false;
    if (lane?.owner) try { await lane.close(); } catch (cleanup) { error.observationCleanup = errorObservation(cleanup); }
    for (const w of new Set([...workers, ...(lane?.owners ?? [])])) w.quarantined = true;
    observation.outcome = "FAIL"; observation.error = errorObservation(error); throw error;
  }
}

async function testOnlyShortConnection(app, gate, notify) {
  const deadline = performance.now() + 20000, pool = app.services.require("mysqldatabase").pool;
  const connections = [];
  for (const stage of ["ORIGINAL", "FRESH"]) {
    const pending = pool.getConnection();
    let connection;
    try { connection = await withinObservation(pending, deadline); }
    catch (error) {
      void pending.then(late => { late.destroy(); }).catch(() => {});
      throw error;
    }
    const core = connection.connection, identity = gate.state.physical.get(core), socket = core.stream;
    let closed = false, primary;
    const onClose = () => { closed = true; resolveClose(); };
    let resolveClose;
    const completed = new Promise(resolve => { resolveClose = resolve; });
    socket.once("close", onClose);
    try {
      assert.ok(identity?.mapped); assert.ok(Number.isSafeInteger(identity.performanceThreadId) && identity.performanceThreadId > 0);
      assert.equal(socket.destroyed, false, "Loaned socket must be live before explicit own destruction");
      const receipt = { stage, threadId: identity.threadId, performanceThreadId: identity.performanceThreadId, connectionNonce: identity.nonce };
      await withinObservation(notify(receipt), deadline);
      connection.destroy(); await withinObservation(completed, deadline);
      assert.equal(closed, true); assert.equal(socket.destroyed, true);
      connections.push({ ...receipt, socketClosed: true });
    } catch (error) { primary = error; }
    finally {
      socket.off("close", onClose);
      if (!closed) try { connection.destroy(); }
      catch (error) { if (primary) primary.shortConnectionCleanupFailure = errorObservation(error); else primary = error; }
    }
    if (primary) throw primary;
  }
  return { outcome: "COMPLETE", callbackSettled: true, connections };
}

export async function verifyShortLivedConnectionMapping(fixture) {
  assert.ok(fixture);
  const { db, workers, actors, report, request, observationLane: lane } = fixture;
  const observation = { kind: "TEST_ONLY_OWNED_SHORT_CONNECTION_MAPPING_NOT_PRODUCT_SLA", outcome: "IN_PROGRESS",
    checkpoints: [], terminals: [] };
  report.shortConnectionMapping = observation; fixture.shortConnectionVerified = false;
  try {
    assert.equal(fixture.controlLockVerified, true); assert.equal(fixture.observationLifecycleVerified, true);
    assert.equal(workers.some(worker => worker.quarantined), false);
    assert.equal(observationOwners.get(db), workers, "CP14 must establish the actual owned monitor registry");
    const other = actors.find(value => value.worker === 0 && !value.writer), w = lane.owner;
    assert.equal(workers[2], w); assert.equal(w.role, "OBSERVATION_ONLY");
    observation.role = w.role; observation.incarnation = w.incarnation;
    assert.ok(other); assert.equal(typeof w.shortConnection, "function");
    assert.equal(report.requests.some(row => row.completeMs === null), false, "CP15 cannot overlap an owned HTTP request");
    observation.before = await inventoryState(db); assert.equal(Object.keys(observation.before).length, 17);
    assert.ok(Object.hasOwn(observation.before, "inventory_purchase_reversal_links"));
    await lane.refresh();
    const [[sku]] = await db.query("SELECT sku_code FROM item_skus WHERE id=1");
    const route = "/api/v1/inventory/sku-lookup?code=" + encodeURIComponent(sku.sku_code);
    await lane.request(route);
    const before = [...w.connections]; assert.ok(before.length > 0); observation.beforeConnections = before;
    const startedAt = performance.now(), deadline = startedAt + 20000, nonce = randomUUID();
    observation.startedAt = startedAt; observation.deadline = deadline; observation.nonce = nonce;
    const [live] = await lotMonitorRead(db,
      `SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID IN (${before.map(() => "?").join(",")})`,
      before, deadline);
    assert.equal(live.length, 1, "CP14 must leave exactly one current owned pool connection");
    const originalId = Number(live[0].PROCESSLIST_ID), originalEntry = w.observationIdentities.get(originalId);
    assert.ok(originalEntry); assert.equal(live[0].INSTRUMENTED, "YES");
    assert.equal(Number(live[0].THREAD_ID), originalEntry.performanceThreadId);
    assert.equal(originalEntry.provenance, "SAME_CONNECTION_DRIVER_QUERY");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    let commandId;
    const dispatchedAt = performance.now(); observation.dispatchedAt = dispatchedAt;
    const completion = w.shortConnection(nonce, checkpoint => {
      const receivedAt = performance.now(); assert.ok(receivedAt < deadline);
      assert.deepEqual(Object.keys(checkpoint).sort(), ["connectionNonce", "id", "incarnation", "nonce", "performanceThreadId", "stage", "threadId", "type"]);
      assert.equal(checkpoint.type, "short-connection-checkpoint"); assert.equal(checkpoint.incarnation, w.incarnation);
      assert.equal(checkpoint.nonce, nonce); assert.match(checkpoint.id, uuid); assert.match(checkpoint.connectionNonce, uuid);
      assert.equal(checkpoint.stage, ["ORIGINAL", "FRESH"][observation.checkpoints.length]);
      if (commandId === undefined) commandId = checkpoint.id; else assert.equal(checkpoint.id, commandId);
      for (const key of ["threadId", "performanceThreadId"]) assert.ok(Number.isSafeInteger(checkpoint[key]) && checkpoint[key] > 0);
      const entry = w.observationIdentities.get(checkpoint.threadId);
      assert.ok(entry, "positive parent mapping must already be retained before each pre-destruction checkpoint");
      assert.equal(entry.incarnation, w.incarnation); assert.equal(entry.threadId, checkpoint.threadId);
      assert.equal(entry.performanceThreadId, checkpoint.performanceThreadId); assert.equal(entry.nonce, checkpoint.connectionNonce);
      assert.equal(entry.provenance, "SAME_CONNECTION_DRIVER_QUERY");
      assert.ok(Number.isFinite(entry.childObservedAt) && entry.childObservedAt >= 0);
      assert.ok(Number.isFinite(entry.firstObservedAt) && entry.firstObservedAt >= 0 && entry.firstObservedAt <= receivedAt);
      assert.deepEqual(workers.filter(worker => worker.connections.has(checkpoint.threadId)), [w]);
      const physical = w.connectionEvents.filter(event => event.threadId === checkpoint.threadId);
      assert.equal(physical.length, 1); assert.equal(physical[0].nonce, checkpoint.connectionNonce);
      assert.ok(physical[0].receivedAt <= entry.firstObservedAt);
      if (checkpoint.stage === "ORIGINAL") {
        assert.equal(checkpoint.threadId, originalId); assert.equal(entry, originalEntry);
      } else {
        assert.equal(before.includes(checkpoint.threadId), false, "FRESH must be a genuinely new native connection");
        assert.notEqual(checkpoint.performanceThreadId, originalEntry.performanceThreadId);
        assert.notEqual(checkpoint.connectionNonce, originalEntry.nonce);
        assert.ok(physical[0].receivedAt >= dispatchedAt && entry.firstObservedAt >= dispatchedAt);
      }
      observation.checkpoints.push({ ...checkpoint, receivedAt });
    });
    void completion.catch(() => {});
    observation.completion = await withinObservation(completion, deadline);
    observation.commandCompletedAt = performance.now();
    const receipt = observation.completion;
    assert.deepEqual(Object.keys(receipt).sort(), ["callbackSettled", "connections", "id", "incarnation", "nonce", "outcome"]);
    assert.equal(receipt.id, commandId); assert.equal(receipt.incarnation, w.incarnation); assert.equal(receipt.nonce, nonce);
    assert.equal(receipt.outcome, "COMPLETE"); assert.equal(receipt.callbackSettled, true);
    assert.equal(observation.checkpoints.length, 2); assert.ok(Array.isArray(receipt.connections)); assert.equal(receipt.connections.length, 2);
    for (const [index, connection] of receipt.connections.entries()) {
      assert.deepEqual(Object.keys(connection).sort(), ["connectionNonce", "performanceThreadId", "socketClosed", "stage", "threadId"]);
      const checkpoint = observation.checkpoints[index];
      assert.deepEqual(connection, { stage: checkpoint.stage, threadId: checkpoint.threadId,
        performanceThreadId: checkpoint.performanceThreadId, connectionNonce: checkpoint.connectionNonce, socketClosed: true });
    }
    const freshId = receipt.connections[1].threadId;
    assert.deepEqual([...w.connections].filter(id => !before.includes(id)), [freshId]);
    const [gone] = await lotMonitorRead(db,
      "SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID IN (?,?)",
      [originalId, freshId], deadline);
    assert.deepEqual(gone, [], "both actual sockets must already be absent from live P_S mapping");
    for (const connection of receipt.connections) {
      const identity = rememberObservationIdentity(db, { threadId: connection.threadId,
        performanceThreadId: connection.performanceThreadId, incarnation: w.incarnation }, []);
      assert.equal(identity.nonce, connection.connectionNonce); assert.equal(identity.provenance, "SAME_CONNECTION_DRIVER_QUERY");
      const seen = new Set(identity.observedTransactionIds); let terminal;
      while (performance.now() < deadline) {
        terminal = await lotProbeState(db, identity, seen, deadline);
        if (performance.now() >= deadline) throw observationFailure();
        if (terminal.terminal && terminal.states.length === 0 && terminal.threads.length === 0 && terminal.statements.length === 0) break;
        await setTimeout(Math.min(25, Math.max(0, deadline - performance.now())));
      }
      assert.ok(terminal?.terminal); assert.deepEqual(terminal.states, []); assert.deepEqual(terminal.threads, []);
      assert.deepEqual(terminal.statements, []); assert.equal(terminal.activeStatement, false);
      for (const key of ["transactions", "retainedTransactions", "locks", "waits"]) assert.equal(terminal[key], 0);
      assert.equal(w.observationIdentities.get(connection.threadId), identity, "absent live mapping must retain the verified positive identity");
      observation.terminals.push({ stage: connection.stage, threadId: connection.threadId,
        performanceThreadId: connection.performanceThreadId, connectionNonce: connection.connectionNonce, ...terminal });
    }
    observation.nativeTerminalVerified = true;
    assert.equal(w.child.exitCode, null); assert.equal(w.child.signalCode, null); assert.equal(w.child.connected, true);
    assert.equal(workers.some(worker => worker.quarantined), false);
    const otherRequestCount = report.requests.length; await request(other, route);
    const otherRows = report.requests.slice(otherRequestCount); assert.equal(otherRows.length, 1);
    assert.equal(otherRows[0].worker, 0); assert.equal(otherRows[0].action, route); assert.equal(otherRows[0].outcome, "COMPLETE");
    observation.otherWorkerRequest = otherRows[0];
    const beforeRecovery = [...w.connections], requestCount = report.requests.length; await lane.request(route);
    const recoveryRows = report.requests.slice(requestCount); assert.equal(recoveryRows.length, 1);
    const recovery = recoveryRows[0]; assert.equal(recovery.worker, 2); assert.equal(recovery.role, "OBSERVATION_ONLY");
    assert.equal(recovery.incarnation, w.incarnation); assert.equal(recovery.action, route); assert.equal(recovery.outcome, "COMPLETE");
    assert.ok(Number.isFinite(recovery.dispatchAt) && Number.isFinite(recovery.completeMs));
    const replacements = [...w.connections].filter(id => !beforeRecovery.includes(id)); assert.equal(replacements.length, 1);
    const replacementId = replacements[0], replacement = w.observationIdentities.get(replacementId);
    assert.ok(replacement); assert.equal(replacement.incarnation, w.incarnation);
    assert.equal(replacement.provenance, "SAME_CONNECTION_DRIVER_QUERY"); assert.match(replacement.nonce, uuid);
    assert.ok(Number.isSafeInteger(replacement.performanceThreadId) && replacement.performanceThreadId > 0);
    assert.ok(!receipt.connections.some(connection => connection.performanceThreadId === replacement.performanceThreadId));
    assert.ok(!receipt.connections.some(connection => connection.connectionNonce === replacement.nonce));
    const replacementEvents = w.connectionEvents.filter(event => event.threadId === replacementId); assert.equal(replacementEvents.length, 1);
    assert.equal(replacementEvents[0].nonce, replacement.nonce);
    assert.ok(replacementEvents[0].receivedAt >= recovery.dispatchAt && replacementEvents[0].receivedAt <= recovery.dispatchAt + recovery.completeMs);
    observation.replacementId = replacementId; observation.recoveryRequest = recovery;
    assert.equal(w.child.exitCode, null); assert.equal(w.child.signalCode, null); assert.equal(w.child.connected, true);
    assert.equal(workers.some(worker => worker.quarantined), false);
    observation.reconciliationStartedAt = performance.now();
    observation.after = await inventoryState(db); assert.equal(Object.keys(observation.after).length, 17);
    assert.ok(Object.hasOwn(observation.after, "inventory_purchase_reversal_links"));
    assert.deepEqual(observation.after, observation.before, "CP15 and both real authenticated GETs must preserve every Inventory row");
    observation.externalStateUnchanged = true;
    await lane.close(); assert.equal(lane.restored, true); assert.equal(workers.length, 2);
    assert.equal(observationOwners.get(db), workers);
    observation.outcome = "COMPLETE"; fixture.shortConnectionVerified = true;
  } catch (error) {
    fixture.observationLifecycleVerified = false; fixture.shortConnectionVerified = false;
    if (lane?.owner) try { await lane.close(); } catch (cleanup) { error.observationCleanup = errorObservation(cleanup); }
    for (const worker of new Set([...workers, ...(lane?.owners ?? [])])) worker.quarantined = true;
    observation.outcome = "FAIL"; observation.error = errorObservation(error); throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  databaseOptions(); assert.ok(process.connected);
  let app, incarnation, transactionObserver, mappingReceiver, resourceSampler;
  const mappingGate = {};
  const lotReleases = new Map(), soakObservers = [];
  let cpuHoldUsed = false;
  let observationHoldUsed = false, observationHold;
  let shortConnectionUsed = false;
  const failures = []; let droppedFailures = 0;
  const send = message => new Promise((resolve, reject) => { process.send({ ...message, incarnation }, error => error ? reject(error) : resolve()); });
  process.on("disconnect", () => { void (async () => { const result = await app?.shutdown("owned_parent_disconnected"); process.exit(result?.exitCode ?? 0); })(); });
  process.on("message", message => { void (async () => {
    if (message.type === "connection-mapping-ack") {
      assert.ok(mappingReceiver); mappingReceiver.ack(message); return;
    } else if (message.type === "boot") {
      assert.equal(incarnation, undefined);
      assert.match(message.incarnation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      incarnation = message.incarnation;
      const { createApplication } = await import("../src/framework/application/createApplication.js");
      const root = await fs.realpath(message.directory);
      assert.equal(root, await fs.realpath(process.env.TMPDIR));
      for (const name of ["media", "imports", "uploads", "tmp"]) await fs.mkdir(path.join(root, name), { mode: 0o700 });
      const config = workerConfiguration(root, message.secret);
      assert.ok(message.primaryLimit === 10 || message.primaryLimit === 1);
      if (message.primaryLimit === 1) config.database = { ...config.database, connectionLimit: 1 };
      assert.equal(config.api.defaults.upload.enabled, false);
      assert.equal(config.api.defaults.upload.storageMode, "memory");
      const moduleUrls = ["inventory/stocktakeHandlers.js", "inventory/skuLookupHandlers.js", "inventory/inquiryHandlers.js", "inventory/reservationHandlers.js", "inventory/reservationInquiryHandlers.js", "user/loginHandler.js", "user/refreshTokenHandler.js"].map(name => new URL(`../src/handlers/${name}`, import.meta.url).href);
      for (const url of moduleUrls) for (const handler of Object.values(await import(url))) {
        assert.notEqual(handler?.api?.upload?.enabled, true, "No upload route may activate the unchanged managed disk-upload path");
      }
      const factory = mysql.createPool;
      resourceSampler = installStocktakeResourceSampler(root, incarnation, send, mappingGate, () => app?.services.require("context").get());
      mysql.createPool = options => {
        const pool = factory(options), installed = installStocktakeObservationMapping(pool, { incarnation, send, gate: mappingGate });
        resourceSampler.observePool(pool, options);
        mappingReceiver ??= installed; return pool;
      };
      app = await createApplication({ configurationSource: config,
        handlerRegistryOptions: { moduleUrls, ...(message.fixtureMode === "CS01" ? { moduleLoader: async url => wrapStocktakeSoakHandlerModule(await import(url), {
          incarnation, getContext: () => app?.services.require("context").get(),
          publish: event => send({ type: "stocktake-soak-export-event", event }),
          installed: observer => { assert.equal(soakObservers.length, 0); soakObservers.push(observer); }
        }) } : {}) } });
      const database = app.services.require("mysqldatabase");
      transactionObserver = installTransactionObserver(database, app.services.require("context"), observation => {
        if (observation.status === "FAIL") {
          if (failures.length < 100) failures.push({ requestId: observation.requestId, failedSql: observation.failures.at(-1) ?? null,
            error: observation.error, observer: "TEST_ONLY_CALL_THROUGH_ORIGINAL_TRANSACTION_BUDGET" });
          else droppedFailures++;
        }
        return send({ type: "transaction-observation", observation });
      });
      const started = await app.start();
      assert.equal(config.database.connectionLimit, message.primaryLimit);
      await send({ id: message.id, origin: started.url });
    } else if (message.type === "stocktake-soak-export-report") {
      assert.ok(app); assert.equal(soakObservers.length, 1);
      const { events: _events, ...observation } = soakObservers[0].report();
      await send({ id: message.id, observation });
    } else if (message.type === "resource-checkpoint") {
      assert.ok(app); assert.deepEqual(Object.keys(message).sort(), ["history", "id", "type"]); assert.equal(typeof message.history, "boolean");
      const sample = await resourceSampler.sample();
      await send({ id: message.id, observed: true, sample, resources: message.history ? resourceSampler.report() : null });
    } else if (message.type === "TEST_ONLY_SHORT_CONNECTION") {
      assert.ok(app); assert.equal(shortConnectionUsed, false);
      assert.deepEqual(Object.keys(message).sort(), ["id", "incarnation", "nonce", "type"]);
      assert.equal(message.incarnation, incarnation);
      for (const key of ["id", "incarnation", "nonce"]) assert.match(message[key], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      shortConnectionUsed = true;
      const result = await testOnlyShortConnection(app, mappingGate,
        receipt => send({ type: "short-connection-checkpoint", id: message.id, nonce: message.nonce, ...receipt }));
      await send({ id: message.id, nonce: message.nonce, ...result });
    } else if (message.type === "TEST_ONLY_OBSERVATION_HOLD") {
      assert.ok(app); validateObservationCommand(message, incarnation);
      assert.equal(observationHoldUsed, false); assert.equal(observationHold, undefined); observationHoldUsed = true;
      const current = { nonce: message.nonce, controller: new AbortController() }; observationHold = current;
      try {
        const result = await testOnlyObservationHold(app, current.controller.signal,
          checkpoint => send({ type: "observation-hold-checkpoint", id: message.id, nonce: message.nonce, ...checkpoint }));
        await send({ id: message.id, nonce: message.nonce, ...result });
      } finally { if (observationHold === current) observationHold = undefined; }
    } else if (message.type === "TEST_ONLY_OBSERVATION_ABORT") {
      assert.ok(app); validateObservationCommand(message, incarnation);
      assert.ok(observationHold); assert.equal(observationHold.nonce, message.nonce);
      assert.equal(observationHold.controller.signal.aborted, false);
      observationHold.controller.abort(Object.assign(new Error("Fixed private observation abort"), { code: "TEST_OBSERVATION_ABORT" }));
      await send({ id: message.id, nonce: message.nonce, aborted: true });
    } else if (message.type === "TEST_ONLY_CPU_HOLD") {
      assert.ok(app); validateCpuHoldCommand(message, incarnation);
      assert.equal(cpuHoldUsed, false, "Only one fixed CPU hold per worker"); cpuHoldUsed = true;
      const result = await testOnlyCpuHold(app, identity => send({ type: "cpu-hold-start", id: message.id, nonce: message.nonce, ...identity }));
      await send({ id: message.id, nonce: message.nonce, ...result });
    } else if (message.type === "control-lock") {
      assert.ok(app);
      assert.deepEqual(Object.keys(message).sort(), ["id", "scenario", "type"]);
      await send({ id: message.id, ...await controlLockScenario(app, message.scenario) });
    } else if (message.type === "diagnostics") {
      assert.ok(app); assert.deepEqual(Object.keys(message).sort(), ["id", "type"]);
      await send({ id: message.id, failures, droppedFailures, transactionObserver, connectionMapping: mappingReceiver?.report() });
    } else if (message.type === "lot-probe") {
      assert.ok(app); assert.deepEqual(Object.keys(message).sort(), ["id", "phase", "shape", "type"]);
      const result = await lotQueryProbe(app, message.shape, message.phase,
        (threadId, performanceThreadId) => send({ type: "lot-probe-start", id: message.id, threadId, performanceThreadId }));
      await send({ id: message.id, ...result });
    } else if (message.type === "lot-semantics") {
      assert.ok(app); assert.deepEqual(Object.keys(message).sort(), ["id", "type"]);
      await send({ id: message.id, ...await lotSemanticsScenario(app) });
    } else if (message.type === "lot-lock") {
      assert.ok(app); assert.deepEqual(Object.keys(message).sort(), ["id", "scenario", "shape", "type"]);
      let release;
      const released = new Promise(resolve => { release = resolve; }); lotReleases.set(message.id, release);
      try {
        const result = await lotLockScenario(app, message.shape, message.scenario,
          phase => send({ type: "lot-probe-start", id: message.id, ...phase }), released);
        await send({ id: message.id, ...result });
      } finally { lotReleases.delete(message.id); }
    } else if (message.type === "lot-release") {
      assert.deepEqual(Object.keys(message).sort(), ["id", "targetId", "type"]);
      const release = lotReleases.get(message.targetId); assert.equal(typeof release, "function");
      release(); await send({ id: message.id, released: true });
    } else if (message.type === "stop") {
      const result = await app.shutdown("stocktake_characterization_complete");
      await resourceSampler.stop(); await send({ type: "resource-final", observation: resourceSampler.report() });
      await send({ type: "connection-mapping-stats", observation: mappingReceiver.report() });
      await send({ id: message.id, exitCode: result.exitCode }); process.disconnect();
    }
  })().catch(async error => { if (process.connected) await send({ id: message.id, ...(["TEST_ONLY_CPU_HOLD", "TEST_ONLY_OBSERVATION_HOLD", "TEST_ONLY_OBSERVATION_ABORT"].includes(message.type) ? { nonce: message.nonce } : {}), error: /^[A-Z][A-Z0-9_]*$/u.test(error.code ?? "") ? error.code : message.type === "boot" ? "PERFORMANCE_CHILD_BOOT_FAILED" : "PERFORMANCE_CHILD_ACTION_FAILED" }); }); });
}

// CS01 only. The characterization transport and its four frozen components are not used or replaced.
export function createStocktakeSoakLane({ workers, actors, report, epoch, clock = () => performance.now(), wallClock = () => Date.now(), fetch: send = globalThis.fetch, onFailure }) {
  const busy = new Set(), preparing = new Set(), lastDispatch = workers.map(() => -Infinity), dueDone = new Map(actors.map(actor => [actor.id, new Set()]));
  const pending = new Set(), completions = new WeakMap(), safeError = error => ({ code: /^[A-Z0-9_]{1,80}$/u.test(error?.code ?? '') ? error.code : 'UNKNOWN', name: /^[A-Za-z0-9_]{1,80}$/u.test(error?.name ?? '') ? error.name : 'Error' });
  let firstFailure;
  const stop = error => { firstFailure ??= error; };
  const failed = error => {
    if (firstFailure) return;
    stop(error);
    try { onFailure?.(error); }
    catch (notificationError) { report.failureNotificationError = safeError(notificationError); }
  };
  report.offers ??= []; report.requests ??= []; report.refreshes ??= [];
  const due = actor => [600000,1200000].find(at => clock() >= epoch + at && !dueDone.get(actor.id).has(at));
  const family = (actor, turn, plan) => actor.writer && (turn + 1) % 4 === 0 ? 'FEFO_FIFO_CANDIDATES'
    : due(actor) !== undefined || actor.expiresAt - wallClock() <= 120000 ? 'REFRESH' : plan.family;
  function offer(actor, turn, intendedAt, plan) {
    assert.ok(actors.includes(actor));
    const planned = family(actor, turn, plan), dueAt = due(actor);
    const action = planned === 'FEFO_FIFO_CANDIDATES' ? plan.candidate : planned === 'REFRESH' ? { route: '/api/v1/user/token/refresh', body: {}, signed: true } : plan;
    const row = { actor: actor.id, worker: actor.worker, workerIncarnation: workers[actor.worker].incarnation, turn, intendedAt,
      family: planned, dueAtMs: dueAt === undefined ? null : epoch + dueAt, admittedAt: null, dispatchAt: null, responseCompleteAt: null,
      outcome: 'NOT_SENT', notSentReason: null, requestId: randomUUID(), status: null, resultObservation: 'NOT_SENT' };
    row.phase = plan.phase ?? 'STEADY';
    report.offers.push(row);
    if (action?.onOffer) action.onOffer(row);
    const rejectAdmission = () => {
      if (firstFailure) return ['NOT_SENT_BUSY','RUN_STOPPED'];
      lastDispatch[actor.worker]=Math.max(lastDispatch[actor.worker],workers[actor.worker].soakLastDispatchAt??-Infinity);
      if (preparing.has(actor.worker)) return ['NOT_SENT_BUSY','PREPARATION_BUSY'];
      if (busy.has(actor.id)) return ['NOT_SENT_BUSY','ACTOR_IN_FLIGHT'];
      if (workers[actor.worker].quarantined) return ['NOT_SENT_BUSY','WORKER_QUARANTINED'];
      if (row.phase==='STEADY'&&clock()>=epoch+1800000)return ['NOT_SENT_LATE','STEADY_WINDOW_CLOSED'];
      if (clock() - intendedAt >= 125) return ['NOT_SENT_LATE','TICK_EXPIRED'];
      if (clock() - lastDispatch[actor.worker] < 125) return ['NOT_SENT_RATE','ACTUAL_DISPATCH_SPACING'];
      return null;
    };
    const notSent = reason => { [row.outcome,row.notSentReason] = reason; row.responseCompleteAt = clock(); };
    const rejected = rejectAdmission();
    if (rejected) { notSent(rejected); return row; }
    assert.ok(action && typeof action.route === 'string', 'Candidate needs its original writer-only plan');
    row.admittedAt = clock(); preparing.add(actor.worker); busy.add(actor.id);
    const work = (async () => {
      let timer, response, consumed = false, settled = false, timeout, value;
      const worker = workers[actor.worker], controller = new AbortController(), oldExpiry = actor.expiresAt;
      const budgetMs = planned === 'CSV' ? 120000 : 30000;
      const signed = action.signed === true, encoded = action.body === undefined ? undefined : JSON.stringify(action.body);
      const request = { ...row, action: action.route.replace(/\/\d+(?=\/|\?|$)/gu, '/:id'), budgetMs, signed,
        keyHash: sha(row.requestId), intendedToCompleteMs: null, preparationMs: null };
      report.requests.push(request);
      let refresh;
      try {
        const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': row.requestId, 'X-Request-ID': row.requestId,
          ...(actor.token ? { Authorization: `Bearer ${actor.token}` } : {}) };
        if (signed) Object.assign(headers, await actor.device.headers({ method: encoded === undefined ? 'GET' : 'POST', path: action.route, body: encoded, token: actor.token }));
        // No await between this final admission and lastDispatch/fetch; the reservation covers only preparation.
        let final;
        if (firstFailure) final = ['NOT_SENT_BUSY','RUN_STOPPED'];
        else if (worker.quarantined) final = ['NOT_SENT_BUSY','WORKER_QUARANTINED'];
        else if(row.phase==='STEADY'&&clock()>=epoch+1800000)final=['NOT_SENT_LATE','STEADY_WINDOW_CLOSED'];
        else if (clock() - intendedAt >= 125) final = ['NOT_SENT_LATE','TICK_EXPIRED'];
        else if (clock() - lastDispatch[actor.worker] < 125) final = ['NOT_SENT_RATE','ACTUAL_DISPATCH_SPACING'];
        else if (actor.expiresAt - wallClock() <= budgetMs) final = ['NOT_SENT_BUSY','TOKEN_UNSAFE'];
        else if (family(actor, turn, plan) !== planned) final = ['NOT_SENT_BUSY','ACTION_FAMILY_CHANGED'];
        if (final) { notSent(final); return undefined; }
        row.dispatchAt = clock(); lastDispatch[actor.worker] = row.dispatchAt; worker.soakLastDispatchAt=row.dispatchAt;
        row.outcome = 'IN_FLIGHT'; row.resultObservation = 'UNKNOWN';
        request.dispatchAt = row.dispatchAt; if (action.onDispatch) action.onDispatch(row); request.preparationMs = row.dispatchAt - row.admittedAt;
        if (planned === 'REFRESH') {
          refresh = { actor: actor.id, worker: actor.worker, requestId: row.requestId, dueAtMs: dueAt === undefined ? null : epoch + dueAt,
            expiryRequired: oldExpiry - wallClock() <= 120000, issuedAt: actor.issuedAt, expiresAt: oldExpiry, intendedAt, admittedAt: row.admittedAt,
            dispatchAt: row.dispatchAt, responseCompleteAt: null, signed, outcome: 'IN_FLIGHT',
            dueDispatchLatenessMs: dueAt === undefined ? null : row.dispatchAt - (epoch + dueAt) };
          report.refreshes.push(refresh);
        }
        timeout = Object.assign(new Error('Parent HTTP watchdog expired'), { code: 'TEST_HTTP_WATCHDOG_TIMEOUT' });
        const deadline = new Promise((_, reject) => { timer = globalThis.setTimeout(() => { failed(timeout); controller.abort(timeout); reject(timeout); }, budgetMs); });
        let dispatched;
        try { dispatched = send(worker.origin + action.route, { method: encoded === undefined ? 'GET' : 'POST', headers, body: encoded, signal: controller.signal }); }
        finally { preparing.delete(actor.worker); }
        const transport = (async () => {
          try {
          response = await dispatched;
          if (settled || controller.signal.aborted) throw timeout;
          row.status = response.status; request.firstByteMs = clock() - row.dispatchAt;
          request.requestIdEchoObservation = response.headers.get('x-request-id') === row.requestId ? 'MATCHED' : 'NOT_MATCHED';
          const received = action.consume ? await action.consume(response, controller.signal, row, error => controller.abort(error)) : await response.json();
          row.responseCompleteAt=clock();
          if (clock() - row.dispatchAt >= budgetMs) { controller.abort(timeout); throw timeout; }
          return received;
          } catch (error) { failed(error); throw error; }
        })();
        value = await Promise.race([transport,deadline]); consumed = true;
        globalThis.clearTimeout(timer); timer = undefined;
        request.code = value?.error?.code ?? null;
        row.resultObservation = 'HTTP_RESPONSE_CONSUMED';
        let responseError;
        try {
          if (action.accept) action.accept(value, response, row);
          else assert.equal(response.status, 200, 'Unexpected real HTTP status');
        } catch (error) { responseError = error; failed(error); }
        if (response.status >= 500) {
          report.databaseDiagnostics ??= []; let diagnosticTimer;
          try {
            const remaining = Math.max(1, budgetMs - (clock() - row.dispatchAt));
            const diagnostics = await Promise.race([worker.diagnostics(), new Promise((_, reject) => {
              diagnosticTimer = globalThis.setTimeout(() => reject(Object.assign(new Error('Diagnostics deadline'), { code: 'TEST_DIAGNOSTICS_TIMEOUT' })), remaining);
            })]);
            report.databaseDiagnostics.push({ requestId: row.requestId, worker: actor.worker, ...diagnostics });
          } catch (error) { report.databaseDiagnostics.push({ requestId: row.requestId, error: safeError(error) }); }
          finally { globalThis.clearTimeout(diagnosticTimer); }
        }
        if (responseError) throw responseError;
        if (planned === 'REFRESH') {
          assert.equal(signed, true); assert.ok(clock() < epoch + 1800000 && wallClock() < oldExpiry, 'Refresh must complete within steady and before actual token expiry');
          assert.equal(value.data.expiresInSeconds, 900);
          const claims = JSON.parse(Buffer.from(value.data.token.split('.')[1], 'base64url').toString('utf8'));
          assert.ok(Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp) && claims.exp - claims.iat === 900);
          actor.token = value.data.token; actor.issuedAt = claims.iat * 1000; actor.expiresAt = claims.exp * 1000;
          if (dueAt !== undefined) dueDone.get(actor.id).add(dueAt);
          refresh.outcome = 'COMPLETE';
        }
        row.outcome = 'COMPLETE';
        if (action.complete) action.complete(value, row);
        return value.data ?? value;
      } catch (error) {
        row.error = safeError(error);
        row.outcome = row.dispatchAt === null ? 'NOT_SENT_SIGNING_FAILED' : 'FAIL';
        if (row.dispatchAt !== null && !consumed) { row.resultObservation = 'UNKNOWN'; worker.quarantined = true; }
        if (refresh) refresh.outcome = 'FAIL';
        failed(error);
        throw error;
      } finally {
        settled = true; globalThis.clearTimeout(timer); preparing.delete(actor.worker); busy.delete(actor.id);
        row.responseCompleteAt ??= clock();row.settledAt=clock(); Object.assign(request, row);
        request.intendedToCompleteMs = row.responseCompleteAt - intendedAt;
        request.completeMs = row.dispatchAt === null ? null : row.responseCompleteAt - row.dispatchAt;
        if (refresh) refresh.responseCompleteAt = row.responseCompleteAt;
      }
    })();
    pending.add(work);completions.set(row,work);
    const release=()=>{pending.delete(work);completions.delete(row);};void work.then(release,release);
    Object.defineProperty(row, 'pending', { get:()=>completions.get(row) }); return row;
  }
  return { offer, pending, busy, stop, async settle() { return Promise.allSettled([...pending]); }, verifyRefreshes(endAt) {
    assert.ok(endAt >= epoch + 1800000);
    for (const actor of actors) for (const at of [600000,1200000]) {
      const matches = report.refreshes.filter(row => row.actor === actor.id && row.dueAtMs === epoch + at);
      assert.equal(matches.length, 1, 'Each mandatory refresh requires a distinct dispatched request');
      assert.equal(matches[0].outcome, 'COMPLETE'); assert.equal(matches[0].signed, true);
      assert.ok(matches[0].responseCompleteAt < epoch + 1800000);
    }
  } };
}
// END createStocktakeSoakLane



export function installStocktakeSoakExportObserver(handler, { incarnation, getContext, publish, maxEvents = 200000, now = () => performance.now(), epochNow = () => Date.now() }) {
  const events = [], requests = new Map(), requestObjects = new WeakMap(), responses = new WeakMap(), transactions = new WeakMap(), observedDatabases = new WeakSet();
  const metrics = { events: 0, captureFailures: 0, droppedEvents: 0, publishFailures: 0, captureMs: 0, callbacks: 0, callbackMs: 0,scalarCaptureCalls:0,scalarCaptureInclusiveMs:0 };
  let sequence = 0, invocation = 0, streamId = 0, transactionId = 0, attemptId = 0, independent;
  const readClock=clock=>{try{const value=clock();if(Number.isFinite(value))return value;}catch{/* Observation clock failure is evidence only. */}metrics.captureFailures++;return null;};
  const safeError = error => capture(()=>{
    const code=error?.code,name=error?.name,statusCode=error?.statusCode;
    if((code!=null&&typeof code!=='string')||(name!=null&&typeof name!=='string'))throw new TypeError('Non-scalar error observation');
    return {code:typeof code==='string'&&/^[A-Z0-9_]{1,80}$/u.test(code)?code:'UNKNOWN',name:typeof name==='string'&&/^[A-Za-z0-9_]{1,80}$/u.test(name)?name:'Error',...(Number.isSafeInteger(statusCode)?{statusCode}:{})};
  })??{code:'UNKNOWN',name:'Error'};
  const fields = (input, keys) => Object.fromEntries(keys.filter(key => input?.[key] !== undefined).map(key => {
    const value = input[key];
    if (!(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 1024)) throw new TypeError('Observer scalar capture');
    return [key,value];
  }));
  const record = (owner, type, data = {}) => {
    const started = readClock(now);
    try {
      metrics.events++;
      const event = { incarnation, sequence: ++sequence, atMs: started, atEpochMs: readClock(epochNow), requestId: owner?.requestId ?? null,
        handler: 'exportInventoryStocktake', invocationId: owner?.invocationId ?? null, type, ...data };
      if (events.length >= maxEvents) { metrics.droppedEvents++; return; }
      // Only whitelisted scalar data and whitelisted summary objects may reach this storage.
      events.push(event);
      try { const sent = publish(event); if (sent && typeof sent.then === 'function') void sent.then(undefined, () => { metrics.publishFailures++; }); }
      catch { metrics.publishFailures++; }
    } catch { metrics.captureFailures++; }
    finally {const ended=readClock(now);if(started!==null&&ended!==null)metrics.captureMs+=Math.max(0,ended-started);}
  };
  const capture = work => { const started=readClock(now);metrics.scalarCaptureCalls++;try { return work(); } catch { metrics.captureFailures++; return undefined; }finally{const ended=readClock(now);if(started!==null&&ended!==null)metrics.scalarCaptureInclusiveMs+=Math.max(0,ended-started);} };
  const observe = (pending, fulfilled, rejected) => {
    const complete = (callback, value) => {
      const started = readClock(now); metrics.callbacks++;
      try { callback?.(value); } catch { metrics.captureFailures++; }
      finally {const ended=readClock(now);if(started!==null&&ended!==null)metrics.callbackMs+=Math.max(0,ended-started);}
    };
    capture(()=>{const then=pending?.then;if(typeof then==='function')void then.call(pending,value=>complete(fulfilled,value),error=>complete(rejected,error));else complete(fulfilled,pending);});
    return pending;
  };
  const ownerFor = () => capture(() => requests.get(getContext()?.requestId));
  function installDatabase(database, generationOwner) {
    if (observedDatabases.has(database)) return;
    observedDatabases.add(database);
    const original = database.withTransaction;
    database.withTransaction = function (work, ...options) {
      const owner = generationOwner ?? independent?.owner ?? ownerFor();
      if (!owner) return original.call(this,work,...options);
      const state = { owner, id: ++transactionId, attempts: [], settled: false }, parentIndependent = independent;
      if (parentIndependent?.owner === owner){state.attempts.push(parentIndependent);capture(()=>record(owner,'audit.association',{attemptId:parentIndependent.id,transactionId:state.id,generationTransactionId:owner.generationTransactionId??null,association:'SYNCHRONOUS_INDEPENDENT_AUDIT_INVOCATION'}));}
      const callback = function (...args) {
        capture(()=>{if (args[0] && typeof args[0] === 'object') transactions.set(args[0],state);});
        return work.apply(this,args);
      };
      let pending;
      try { pending = original.call(this,callback,...options); }
      catch (error) { transactionEnd(state,error); throw error; }
      return observe(pending, value => {
        state.settled = true;
        if (generationOwner) capture(() => {owner.generationTransactionId=state.id;record(owner,'generation.return', { transactionId: state.id,
          metadata: fields(value,['stocktakeId','stocktakeNumber','status','cancelled','varianceStage','asOf','workflowVersion','exportedRows','truncated','truncationReason','generationBudgetMs','filterHash']) });});
        transactionEnd(state);
      }, error => { if (generationOwner) record(owner,'generation.error',{ transactionId: state.id,error: safeError(error) }); transactionEnd(state,error); });
    };
  }
  function transactionEnd(state,error) {
    state.settled = true;
    for (const attempt of state.attempts) capture(()=>record(attempt.owner,error ? 'audit.transaction.error' : 'audit.transaction.result', {
      attemptId: attempt.id, transactionId: state.id,generationTransactionId:state.owner.generationTransactionId??null, ...(error ? { error: safeError(error), commitObservation: error.code === 'DATABASE_TRANSACTION_INDETERMINATE' ? 'UNKNOWN_COMMIT' : 'ERROR_NOT_COMMIT_CONFIRMED' }
        : { commitObservation: 'ORIGINAL_TRANSACTION_FULFILLED' }) }));
    state.attempts.length = 0;
  }
  installDatabase(handler.database);
  for (const [scope,audit] of [['DOMAIN',handler.exports.audit],['ROUTE',handler.audit]]) for (const method of ['recordSucceeded','recordFailed','recordRejected']) {
    if (typeof audit?.[method] !== 'function') continue;
    const original = audit[method];
    audit[method] = function (...args) {
      const input = args[method === 'recordSucceeded' ? 1 : 0], owner = capture(()=>requests.get(input?.requestId));
      if (!owner) return original.apply(this,args);
      const attempt = { id: ++attemptId, owner }, before = independent;
      capture(() => {
        const values = fields(input,['actorUserId','actorLabel','action','targetType','targetId','targetLabel','reasonCategory','reasonText','operationRequestId','requestId','correlationId','ip','errorCode']);
        for (const summary of ['beforeSummary','afterSummary']) if (input[summary] !== undefined) values[summary] = input[summary] === null ? null : fields(input[summary],['stocktakeId','rowCount','version','status']);
        record(owner,'audit.attempt',{ attemptId: attempt.id,generationTransactionId:owner.generationTransactionId??null, scope, method, outcome: { recordSucceeded:'SUCCEEDED',recordFailed:'FAILED',recordRejected:'REJECTED' }[method], input: values });
      });
      if (method === 'recordSucceeded') {
        const tx = transactions.get(args[0]);
        if (tx?.owner === owner && !tx.settled){tx.attempts.push(attempt);capture(()=>record(owner,'audit.association',{attemptId:attempt.id,transactionId:tx.id,generationTransactionId:owner.generationTransactionId??null,association:'ORIGINAL_CALLBACK_TRANSACTION'}));}
        else {metrics.captureFailures++;record(owner,'audit.association.missing',{ attemptId: attempt.id });}
      } else independent = attempt;
      let pending;
      try { pending = original.apply(this,args); }
      catch (error) { record(owner,'audit.error',{ attemptId: attempt.id,error: safeError(error) }); throw error; }
      finally { independent = before; }
      return observe(pending,value => record(owner,'audit.result',{ attemptId: attempt.id,result: value === undefined ? 'UNDEFINED' : typeof value === 'boolean' ? value : 'UNEXPECTED_RETURN' }),
        error => record(owner,'audit.error',{ attemptId: attempt.id,error: safeError(error) }));
    };
  }
  const originalCreate = handler.exports.createGenerationReader;
  if (typeof originalCreate === 'function') handler.exports.createGenerationReader = function (...args) {
    const owner = ownerFor(), reader = originalCreate.apply(this,args);
    if (!owner || !reader) return reader;
    const initialize = reader.initialize;
    reader.initialize = function (...values) {
      const pending = initialize.apply(this,values);
      return observe(pending,database => installDatabase(database,owner), error => record(owner,'generation.initialize.error',{ error: safeError(error) }));
    };
    return reader;
  };
  function installStream(stream, owner) {
    const id = ++streamId; owner.streamId = id;
    const flags = () => ({ readableEnded: stream.readableEnded === true, destroyed: stream.destroyed === true });
    const originalPipe = stream.pipe;
    stream.pipe = function (...args) {
      capture(()=>{const matched = responses.get(owner)?.deref() === args[0]; owner.pipe = matched;record(owner,'stream.pipe',{ streamId: id,responseMatched: matched,...flags() });});return originalPipe.apply(this,args);
    };
    const emit = stream.emit;
    stream.emit = function (event, ...args) {
      if (['end','error','close'].includes(event))capture(()=>record(owner,'stream.event',{ streamId: id,event,...flags(),...(event === 'error' ? { error: safeError(args[0]) } : {}) }));
      return emit.call(this,event,...args);
    };
    const destroy = stream._destroy;
    if (typeof destroy === 'function') stream._destroy = function (error,callback) {
      capture(()=>record(owner,'stream.destroy.call',{ streamId: id,errorPresent: error != null,...flags(),...(error ? { error:safeError(error) } : {}) }));
      return destroy.call(this,error,function (...args) {
        capture(()=>record(owner,'stream.destroy.result',{ streamId: id,errorPresent: args[0] != null,...flags(),...(args[0] ? { error:safeError(args[0]) } : {}) }));
        return callback.apply(this,args);
      });
    };
  }
  const prepare = handler.exports.prepare;
  if (typeof prepare === 'function') handler.exports.prepare = function (...args) {
    const owner = capture(()=>requests.get(args[0]?.requestId)), pending = prepare.apply(this,args);
    if (!owner) return pending;
    return observe(pending,value => capture(() => {
      if (!value?.stream) throw new TypeError('Missing original prepare stream');
      installStream(value.stream,owner);
      record(owner,'prepare.return',{ streamId:owner.streamId,descriptor:fields(value,['asOf','truncated','truncationReason','generationBudgetMs']) });
    }),error => record(owner,'prepare.error',{ error:safeError(error) }));
  };
  const handle = handler.handle;
  handler.handle = function (req,res,...args) {
    const owner=capture(()=>{const value={requestId:req.requestId,invocationId:++invocation,pipe:false,streamId:null};requests.set(value.requestId,value);requestObjects.set(req,value);responses.set(value,new WeakRef(res));return value;});
    if(!owner)return handle.call(this,req,res,...args);
    record(owner,'delivery.call');
    const settled = (type,error) => {capture(()=>{const response=responses.get(owner)?.deref();if(!response)throw new TypeError('Missing owned response observation');record(owner,type,{streamId:owner.streamId,pipe:owner.pipe,finished:response.finished===true,destroyed:response.destroyed===true,headersSent:response.headersSent===true,...(error?{error:safeError(error)}:{})});});responses.delete(owner);};
    let pending;
    try { pending = handle.call(this,req,res,...args); }
    catch (error) { settled('delivery.error',error); throw error; }
    return observe(pending,() => settled('delivery.return'),error => settled('delivery.error',error));
  };
  const auditFailure = handler.auditFailure;
  if (typeof auditFailure === 'function') handler.auditFailure = function (req,error,...args) {
    const owner = requestObjects.get(req);
    if (!owner) return auditFailure.call(this,req,error,...args);
    record(owner,'auditFailure.call',{ error:safeError(error) });
    let pending;
    try { pending = auditFailure.call(this,req,error,...args); }
    catch (failure) { record(owner,'auditFailure.error',{ error:safeError(failure) }); throw failure; }
    return observe(pending,() => record(owner,'auditFailure.result'),failure => record(owner,'auditFailure.error',{ error:safeError(failure) }));
  };
  return { report() { return { status:metrics.captureFailures || metrics.droppedEvents || metrics.publishFailures ? 'INCOMPLETE':'COMPLETE',events,metrics:{ ...metrics },costScope:'SCALAR_CAPTURE_INCLUSIVE_AND_SETTLEMENT_CALLBACK_COST; INSTRUMENTED_TIMINGS; NO_TIMING_NEUTRAL_CLAIM' }; } };
}
// END installStocktakeSoakExportObserver

export function verifyStocktakeSoakExportAudit({ rows, intents, events, live = false }) {
  const expected = [], pending = [], ids = new Set(), knownRequests = new Set(intents.keys());
  const eventSequences = new Map(),attemptIdentities=new Map(),transactionIdentities=new Map();
  const positive=value=>assert.ok(Number.isSafeInteger(value)&&value>0,'Positive safe primitive observation identity');
  const allowed=new Set(['delivery.call','delivery.return','delivery.error','generation.return','generation.error','generation.initialize.error','prepare.return','prepare.error','stream.pipe','stream.event','stream.destroy.call','stream.destroy.result','audit.attempt','audit.result','audit.error','audit.association','audit.transaction.result','audit.transaction.error','auditFailure.call','auditFailure.result','auditFailure.error']);
  for (const event of events) {
    assert.ok(knownRequests.has(event.requestId), 'Unjoined lifecycle request');
    assert.equal(event.handler,'exportInventoryStocktake');assert.ok(allowed.has(event.type),'Unmatched lifecycle observation');
    const attemptKey=`${event.incarnation}:${event.attemptId}`,transactionKey=`${event.incarnation}:${event.transactionId}`;
    if(event.type==='audit.attempt'){positive(event.attemptId);assert.equal(attemptIdentities.has(attemptKey),false,'Audit attempt identity reused');attemptIdentities.set(attemptKey,event.requestId);}
    else if(event.type.startsWith('audit.')){positive(event.attemptId);assert.equal(attemptIdentities.get(attemptKey),event.requestId,'Unmatched original Audit attempt identity');}
    if(['generation.return','generation.error','audit.association'].includes(event.type)){
      positive(event.transactionId);assert.equal(transactionIdentities.has(transactionKey),false,'Transaction identity reused across generation/Audit associations');transactionIdentities.set(transactionKey,event.type==='audit.association'?attemptKey:`generation:${event.requestId}`);
    }
    if(['audit.transaction.result','audit.transaction.error'].includes(event.type)){positive(event.transactionId);assert.equal(transactionIdentities.get(transactionKey),attemptKey,'Audit transaction does not match its actual original association');}
    const previous = eventSequences.get(event.incarnation) ?? 0;
    assert.ok(Number.isSafeInteger(event.sequence) && event.sequence > previous, 'Lifecycle sequence must strictly increase per worker');
    eventSequences.set(event.incarnation,event.sequence);
  }
  for (const [requestId,intent] of intents) {
    assert.equal(requestId,intent.requestId);
    const observed = events.filter(event => event.requestId === requestId);
    assert.ok(observed.every(event => event.incarnation === intent.incarnation), 'Wrong worker incarnation');
    assert.ok(observed.every(event => Number.isSafeInteger(event.invocationId) && event.invocationId > 0));
    assert.equal(new Set(observed.map(event => event.invocationId)).size, observed.length ? 1 : 0);
    const one = type => { const values = observed.filter(event => event.type === type); assert.ok(values.length <= 1, `Repeated ${type}`); return values[0]; };
    const generation = one('generation.return'), prepared = one('prepare.return'), returned = one('delivery.return'), rejected = one('delivery.error');
    assert.ok(!(returned && rejected));
    const attempts = observed.filter(event => event.type === 'audit.attempt');
    const failures = attempts.filter(event => event.outcome !== 'SUCCEEDED');
    const busy = intent.expectedPreGenerationBusy === true;
    const requireFact = (fact,label) => { if (!fact) { if (live) { pending.push({ requestId,reason:label }); return false; } assert.fail(label); } return true; };
    const deliveryCall=one('delivery.call'),failureCall=one('auditFailure.call'),failureResult=one('auditFailure.result'),failureError=one('auditFailure.error'),prepareError=one('prepare.error');
    assert.ok(!failureError,'Original auditFailure rejected; lifecycle evidence cannot PASS');
    assert.ok(!(prepared&&prepareError),'Dual prepare settlements');assert.ok(!(generation&&one('generation.error')),'Dual generation settlements');
    assert.ok(!one('generation.error')&&!one('generation.initialize.error'),'Generation failed before an accepted export branch');
    if(returned||rejected||prepared||generation)assert.ok(deliveryCall,'Missing original delivery call');else requireFact(deliveryCall,'Missing original delivery call');
    if(returned||rejected)assert.ok(deliveryCall.sequence<(returned??rejected).sequence,'Delivery settlement must match an earlier original call');
    if(failureResult)assert.ok(failureCall&&failureCall.sequence<failureResult.sequence,'Unmatched dispatcher result');
    if(returned)assert.ok(!failureCall&&!failureResult,'Clean delivery has no dispatcher failure lifecycle');
    if(rejected){requireFact(failureCall&&failureResult,'Missing original dispatcher call/result pair');if(failureCall)assert.ok(rejected.sequence<failureCall.sequence,'Dispatcher failure must follow original handle rejection');}
    if (busy) { assert.ok(!generation && !prepared);requireFact(prepareError?.error?.code==='INVENTORY_DEPENDENCY_UNAVAILABLE','BUSY requires original prepare rejection'); }
    else if (generation) {
      const data = generation.metadata;
      assert.deepEqual([data.stocktakeId,data.stocktakeNumber,data.status,data.cancelled,data.varianceStage,data.workflowVersion,data.filterHash],
        [intent.stocktakeId,intent.stocktakeNumber,'COUNTING',false,'PREVIEW',intent.workflowVersion,intent.filterHash]);
      assert.ok(Number.isSafeInteger(data.asOf) && data.asOf > 0);
      assert.ok(Number.isSafeInteger(data.exportedRows) && data.exportedRows > 0 && data.exportedRows <= 100000);
      assert.ok(Number.isSafeInteger(data.generationBudgetMs) && data.generationBudgetMs > 0 && data.generationBudgetMs <= 60000);
      assert.ok(['NONE','ROW_LIMIT','TIME_LIMIT'].includes(data.truncationReason));
      assert.equal(data.truncated,data.truncationReason !== 'NONE');
      if (prepared) assert.deepEqual([prepared.descriptor.asOf,prepared.descriptor.truncated,prepared.descriptor.truncationReason,prepared.descriptor.generationBudgetMs],
        [data.asOf,data.truncated,data.truncationReason,data.generationBudgetMs]);
    } else requireFact(false,'Missing generation return');
    if(prepared){
      assert.ok(Number.isSafeInteger(prepared.streamId)&&prepared.streamId>0);
      assert.ok(generation&&generation.sequence<prepared.sequence,'Generation transaction return must precede prepare return');
      for(const event of observed.filter(event=>event.type.startsWith('stream.')))assert.equal(event.streamId,prepared.streamId,'Exact returned stream identity');
      for(const event of [returned,rejected].filter(Boolean))assert.equal(event.streamId,prepared.streamId);
    }
    const sourceEvents = observed.filter(event => event.type === 'stream.event');
    const pipes = observed.filter(event => event.type === 'stream.pipe');
    assert.ok(pipes.length <= 1 && pipes.every(event => event.responseMatched === true));
    if(pipes.length){assert.ok(prepared&&prepared.sequence<pipes[0].sequence);if(returned||rejected)assert.ok(pipes[0].sequence<(returned??rejected).sequence);}
    for(const event of sourceEvents)assert.ok(['end','error','close'].includes(event.event),'Unmatched stream event');
    for(const type of ['end','error','close'])assert.ok(sourceEvents.filter(event=>event.event===type).length<=1,'Repeated original stream terminal event');
    const destroyCall=one('stream.destroy.call'),destroyResult=one('stream.destroy.result');
    if(destroyResult)assert.ok(destroyCall&&destroyCall.sequence<destroyResult.sequence,'Destroy callback must match original destroy call');
    if(busy)assert.ok(!sourceEvents.length&&!pipes.length&&!destroyCall&&!destroyResult,'BUSY has no returned stream lifecycle');
    if(prepared&&(returned||rejected))requireFact(destroyCall&&destroyResult,'Missing original destroy call/callback pair');
    const normal = sourceEvents.some(event => event.event === 'end' && event.readableEnded === true) &&destroyCall?.errorPresent===false&&destroyResult?.errorPresent===false;
    const sourceError = sourceEvents.some(event => event.event === 'error') || observed.some(event => ['stream.destroy.call','stream.destroy.result'].includes(event.type) && event.errorPresent === true);
    assert.ok(!(sourceError&&normal),'Contradictory normal EOF/destroy and source-error evidence');
    if(returned)assert.equal(sourceError,false,'Clean delivery cannot contain original source errors');
    if(prepareError&&!busy)assert.fail('Unmatched prepare rejection');
    const closed = sourceEvents.some(event => event.event === 'close' && event.destroyed === true);
    let required;
    if (busy) {
      if (requireFact(rejected && one('auditFailure.call'),'BUSY needs original dispatcher failure')) required = ['DOMAIN:FAILED','ROUTE:FAILED'];
    } else if (returned) {
      if (requireFact(prepared && pipes.length === 1 && returned.pipe === true && normal && closed,'Successful handle needs actual matching pipe, EOF, normal destroy and close')) required = ['DOMAIN:SUCCEEDED'];
      assert.equal(failures.length,0,'Clean source/delivery has no failure Audit attempt');
    } else if (rejected) {
      if (requireFact(prepared && pipes.length === 1 && rejected.pipe === true && closed && one('auditFailure.call'),'Delivery rejection needs actual pipe, terminal source and dispatcher failure')) {
        const routeError=one('auditFailure.call').error;
        const routeOutcome = routeError?.statusCode >= 400 && routeError?.statusCode < 500 ? 'REJECTED':'FAILED';
        if (sourceError) required = ['DOMAIN:SUCCEEDED','DOMAIN:FAILED',`ROUTE:${routeOutcome}`];
        else if (requireFact(normal,'Late delivery failure requires independently normal source termination')) required = ['DOMAIN:SUCCEEDED',`ROUTE:${routeOutcome}`];
      }
    } else requireFact(false,'Missing original handle settlement');
    if(required){
      const remaining=required.slice();for(const attempt of attempts){const index=remaining.indexOf(`${attempt.scope}:${attempt.outcome}`);assert.ok(index>=0,'Unexpected or duplicate original Audit attempt');remaining.splice(index,1);}
      if(live&&remaining.length)pending.push({requestId,reason:'Expected original Audit attempts not yet observed'});else assert.equal(remaining.length,0,'Exact independently established Audit attempts');
    }
    for (const attempt of attempts) {
      assert.ok(['DOMAIN','ROUTE'].includes(attempt.scope));positive(attempt.attemptId);
      assert.equal(attempt.generationTransactionId,generation?.transactionId??null,'Audit attempt must retain its actual generation transaction linkage');
      if(attempt.generationTransactionId!==null)positive(attempt.generationTransactionId);
      const associations=observed.filter(event=>event.type==='audit.association'&&event.attemptId===attempt.attemptId);
      assert.ok(associations.length<=1,'Duplicate Audit transaction association');
      if(associations[0]){const association=associations[0];positive(association.transactionId);assert.ok(association.sequence>attempt.sequence);assert.equal(association.generationTransactionId,attempt.generationTransactionId);assert.equal(association.association,attempt.outcome==='SUCCEEDED'?'ORIGINAL_CALLBACK_TRANSACTION':'SYNCHRONOUS_INDEPENDENT_AUDIT_INVOCATION');if(generation)assert.notEqual(association.transactionId,generation.transactionId);}

      assert.equal(attempt.method,{ SUCCEEDED:'recordSucceeded',FAILED:'recordFailed',REJECTED:'recordRejected' }[attempt.outcome]);
      const input = attempt.input, succeeded = attempt.outcome === 'SUCCEEDED', domain = attempt.scope === 'DOMAIN';
      assert.deepEqual([input.actorUserId,input.actorLabel,input.action,input.targetType,input.targetId ?? null,input.targetLabel,input.requestId,input.correlationId],
        [intent.actorId,domain ? intent.actorLabel:`user:${intent.actorId}`,'inventory.export','stocktake',domain ? intent.stocktakeId:null,domain ? `stocktake:${intent.stocktakeId}`:'/api/v1/inventory/stocktakes/:id/export',requestId,requestId]);
      assert.equal(input.beforeSummary ?? null,null); assert.equal(input.operationRequestId ?? null,null);
      if (succeeded) {
        assert.ok(generation && domain);
        const data = generation.metadata;
        assert.deepEqual(input.afterSummary,{ stocktakeId:intent.stocktakeId,rowCount:data.exportedRows,version:intent.workflowVersion,status:'COUNTING' });
        assert.deepEqual([input.reasonCategory,input.reasonText],['EXPORT',`filterHash=${intent.filterHash};truncated=${data.truncated};reason=${data.truncationReason};budgetMs=${data.generationBudgetMs}`]);
      } else { assert.equal(input.afterSummary ?? null,null); assert.deepEqual([input.reasonCategory ?? '',input.reasonText ?? ''],['','']); }
      const results = observed.filter(event => ['audit.result','audit.error'].includes(event.type) && event.attemptId === attempt.attemptId);
      const commits = observed.filter(event => ['audit.transaction.result','audit.transaction.error'].includes(event.type) && event.attemptId === attempt.attemptId);
      assert.ok(results.length <= 1 && commits.length <= 1,'Duplicated settlement');
      if(results[0])assert.ok(results[0].sequence>attempt.sequence,'Original Audit method settlement must follow its call');
      if (results[0]) {
        assert.equal(results[0].type,'audit.result','Audit method rejected');
        assert.equal(results[0].result,succeeded ? 'UNDEFINED':true,'AUDIT_WRITE_FAILED');
      }
      if(commits[0]){
        assert.equal(commits[0].commitObservation,'ORIGINAL_TRANSACTION_FULFILLED','Audit transaction lacks positive commit observation / UNKNOWN_COMMIT');
        assert.ok(associations[0],'Missing actual Audit transaction association');assert.equal(commits[0].transactionId,associations[0].transactionId);assert.equal(commits[0].generationTransactionId,attempt.generationTransactionId);assert.ok(commits[0].sequence>associations[0].sequence);
      }
      if(attempt.scope==='ROUTE'){assert.ok(failureCall&&attempt.sequence>failureCall.sequence,'Unmatched ROUTE Audit attempt');if(failureResult&&results[0])assert.ok(failureResult.sequence>results[0].sequence,'Dispatcher result must follow original ROUTE Audit method result');}
      if (!requireFact(results.length === 1 && commits.length === 1&&associations.length===1,'Missing Audit method, original association or transaction settlement')) continue;
      expected.push({ requestId,attemptId:attempt.attemptId,scope:attempt.scope,input,outcome:attempt.outcome,
        from:attempt.atEpochMs,to:commits[0].atEpochMs });
    }
  }
  const used = new Set(), shapes = new Set();
  for (const row of rows) {
    const id = Number(row.id); assert.ok(Number.isSafeInteger(id) && id > 0 && !ids.has(id),'Audit IDs must be globally unique'); ids.add(id);
    assert.ok(knownRequests.has(row.request_id),'Every actual Audit increment must join registered intent');
    const intent = intents.get(row.request_id), scope = row.target_id === null ? 'ROUTE':'DOMAIN';
    assert.deepEqual([Number(row.actor_user_id),row.actor_label,row.action,row.target_type,row.target_id === null ? null:Number(row.target_id),row.target_label,row.correlation_id],
      [intent.actorId,scope === 'DOMAIN' ? intent.actorLabel:`user:${intent.actorId}`,'inventory.export','stocktake',scope === 'DOMAIN' ? intent.stocktakeId:null,
        scope === 'DOMAIN' ? `stocktake:${intent.stocktakeId}`:'/api/v1/inventory/stocktakes/:id/export',intent.requestId]);
    assert.ok(['SUCCEEDED','FAILED','REJECTED'].includes(row.outcome));assert.equal(row.operation_request_id,null);assert.equal(row.before_summary,null);
    const shape = `${row.request_id}:${scope}:${row.outcome}`;
    assert.equal(shapes.has(shape),false,'Duplicate Audit scope/outcome remains an error during live load');shapes.add(shape);
    const matches = expected.filter((item,index) => !used.has(index) && item.requestId === row.request_id && item.outcome === row.outcome &&
      (item.scope === 'DOMAIN' ? Number(row.target_id) === item.input.targetId : row.target_id === null));
    if (live && matches.length === 0) {
      if (row.outcome !== 'SUCCEEDED') {assert.deepEqual([row.reason_category,row.reason_text],['','']);assert.equal(row.after_summary,null);}
      pending.push({requestId:row.request_id,auditId:id,reason:'Visible row awaits independent lifecycle/transaction receipt'});continue;
    }
    assert.equal(matches.length,1,'Exactly one independently known original write per actual Audit row');
    const item = matches[0], input = item.input; used.add(expected.indexOf(item));
    for (const [field,value] of Object.entries({ actor_user_id:input.actorUserId,actor_label:input.actorLabel,action:input.action,target_type:input.targetType,
      target_id:input.targetId ?? null,target_label:input.targetLabel,outcome:item.outcome,reason_category:input.reasonCategory ?? '',reason_text:input.reasonText ?? '',
      operation_request_id:null,request_id:item.requestId,correlation_id:item.requestId,ip:input.ip ?? '' })) assert.deepEqual(row[field],value,`Audit ${field}`);
    assert.equal(row.before_summary,null);
    assert.deepEqual(typeof row.after_summary === 'string' ? JSON.parse(row.after_summary):row.after_summary,item.outcome === 'SUCCEEDED' ? input.afterSummary:null);
    assert.ok(Number.isSafeInteger(item.from) && Number.isSafeInteger(item.to) && Number(row.occurred_at) >= item.from && Number(row.occurred_at) <= item.to,'Audit timestamp outside original call/transaction interval');
  }
  const missing = expected.filter((_,index) => !used.has(index));
  if (live) pending.push(...missing.map(item => ({ requestId:item.requestId,reason:'Committed write not visible in this snapshot' })));
  else { assert.equal(pending.length,0); assert.equal(missing.length,0,'Every positive write must persist exactly once'); }
  return { status:pending.length ? 'PENDING':'COMPLETE',ids:[...ids],pending,expectedCount:expected.length };
}
// END verifyStocktakeSoakExportAudit

export function wrapStocktakeSoakHandlerModule(module, options) {
  const Original = module.ExportInventoryStocktakeHandler;
  if (typeof Original !== 'function') return module;
  return { ...module, ExportInventoryStocktakeHandler: class extends Original {
    constructor(services) {
      super(services);
      const observer = installStocktakeSoakExportObserver(this,options);
      options.installed(observer);
    }
  } };
}
// END wrapStocktakeSoakHandlerModule
async function prepareStocktakeSoakExportOracle(fixture) {
  const header = fixture.exportHeader, { db } = fixture;
  assert.ok(header?.id && header.version === 2 && header.status === 'COUNTING');
  const common = { stocktakeId: header.id,stocktakeNumber:header.stocktakeNumber,status:'COUNTING',cancelled:false,varianceStage:'PREVIEW',workflowVersion:header.version };
  const hashes = [], ids = createHash('sha256'), data = createHash('sha256');
  const add = record => {
    const cells = stocktakeCsvDigestColumns.map(field => stocktakeCsvExpectedCell(record[field]));
    const text = JSON.stringify(cells) + '\n'; hashes.push(sha(text)); data.update(text);
    ids.update(`${record.recordType}:${record.recordType === 'SCOPE' ? record.scopeId:record.lineId}\n`);
  };
  let cursor = 0, scopes = 0, lines = 0;
  for (;;) {
    const [rows] = await db.execute(`SELECT scope.*,b.bin_code FROM inventory_stocktake_bins scope JOIN inventory_bins b ON b.id=scope.bin_id
      WHERE scope.stocktake_id=? AND scope.id>? ORDER BY scope.id LIMIT 500`,[header.id,cursor]);
    if (!rows.length) break;
    for (const row of rows) {
      cursor=Number(row.id); scopes++; assert.equal(Number(row.bin_id),800+scopes);
      add({ ...common,recordType:'SCOPE',scopeId:Number(row.id),binId:Number(row.bin_id),binCodeSnapshot:row.bin_code_snapshot,binCodeCurrent:row.bin_code });
    }
  }
  assert.equal(scopes,200); cursor=0;
  const fullLineIds = createHash('sha256');
  for (;;) {
    const [rows] = await db.execute(`SELECT l.*,scope.bin_code_snapshot,b.bin_code,s.sku_code,s.sku_name,su.uom_id,u.code AS uom_code,lot.lot_number
      FROM (SELECT * FROM inventory_stocktake_lines WHERE stocktake_id=? AND id>? ORDER BY id LIMIT 500) l
      JOIN inventory_stocktake_bins scope ON scope.id=l.stocktake_bin_id AND scope.stocktake_id=l.stocktake_id AND scope.bin_id=l.bin_id
      JOIN inventory_bins b ON b.id=l.bin_id JOIN item_skus s ON s.id=l.sku_id
      JOIN item_sku_uoms su ON su.sku_id=l.sku_id AND su.is_base=1 JOIN item_uoms u ON u.id=su.uom_id
      LEFT JOIN inventory_lots lot ON lot.id=l.lot_id AND lot.sku_id=l.sku_id ORDER BY l.id`,[header.id,cursor]);
    if (!rows.length) break;
    for (const line of rows) {
      cursor=Number(line.id); lines++; fullLineIds.update(`LINE:${cursor}\n`);
      assert.deepEqual([line.counted_quantity,Number(line.is_not_found),line.variance_quantity,line.movement_id,Number(line.snapshot_quantity),Number(line.snapshot_balance_version),Number(line.version)],[null,0,null,null,100,4,1]);
      if (lines<=99800) add({ ...common,recordType:'LINE',scopeId:line.stocktake_bin_id,binId:line.bin_id,binCodeSnapshot:line.bin_code_snapshot,binCodeCurrent:line.bin_code,
        lineId:cursor,lineVersion:line.version,skuId:line.sku_id,skuCodeCurrent:line.sku_code,skuNameCurrent:line.sku_name,baseUomId:line.uom_id,baseUomCodeCurrent:line.uom_code,
        lotId:line.lot_id,lotNumberCurrent:line.lot_number,stockStatus:line.stock_status,snapshotBalanceId:line.stock_balance_id,snapshotBalanceVersion:line.snapshot_balance_version,
        snapshotQuantity:line.snapshot_quantity,countState:'UNCOUNTED',actualQuantity:null,varianceQuantity:null,movementId:null });
    }
  }
  assert.equal(lines,100000); assert.equal(hashes.length,100000);
  const value = { hashes,orderedIdsSha256:ids.digest('hex'),dataSha256:data.digest('hex'),fullLineIdsSha256:fullLineIds.digest('hex'),filterHash:sha(JSON.stringify({stocktakeId:header.id,filters:{}})) };
  fixture.report.exportOracle = { scopes,lines,exportedPrefixRows:hashes.length,orderedIdsSha256:value.orderedIdsSha256,dataSha256:value.dataSha256,fullLineIdsSha256:value.fullLineIdsSha256,filterHash:value.filterHash };
  return value;
}

export function stocktakeSoakCsvPlan(fixture, actor, expected, attempt, phase) {
  const header=fixture.exportHeader, mustAbort=attempt%10===0;
  const observation={ actor:actor.id,worker:actor.worker,attempt,phase,mustAbort,bytes:0,rows:0,scopes:0,lines:0,summary:null,
    firstBodyAt:null,responseCompleteAt:null,outcome:'NOT_SENT',clientMemoryBefore:process.memoryUsage(),clientYieldCalls:0,clientYieldMs:0 };
  fixture.report.exports ??= [];
  return { family:'CSV',route:`/api/v1/inventory/stocktakes/${header.id}/export`,
    onOffer(row) { fixture.report.exports.push(observation); observation.requestId=row.requestId; observation.intendedAt=row.intendedAt; },
    onDispatch(row) {
      observation.dispatchAt=row.dispatchAt; observation.dispatchAtMs=resourceClock();
      assert.equal(fixture.soakExportIntents.has(row.requestId),false);
      fixture.soakExportIntents.set(row.requestId,Object.freeze({requestId:row.requestId,actorId:actor.id,actorLabel:actor.username,stocktakeId:header.id,
        stocktakeNumber:header.stocktakeNumber,workflowVersion:header.version,filterHash:expected.filterHash,incarnation:fixture.workers[actor.worker].incarnation,expectedPreGenerationBusy:false}));
    },
    async consume(response, signal, row, abort) {
      observation.status=response.status;
      assert.equal(response.headers.get('x-request-id'),row.requestId,'Real server request ID echo');
      if (response.status!==200) {
        const value=await response.json(); observation.code=value.error?.code ?? 'UNKNOWN'; observation.outcome=response.status===503&&observation.code==='INVENTORY_DEPENDENCY_UNAVAILABLE'?'DEPENDENCY_FAIL_UNPROVEN_BUSY':'HTTP_FAIL';
        // A 503 is preserved as its real status; proving BUSY needs independent owned-resource/lifecycle evidence.
        return value;
      }
      assert.match(response.headers.get('content-type') ?? '',/^text\/csv(?:;|$)/iu);
      const source=Readable.fromWeb(response.body);
      const ids=createHash('sha256'),data=createHash('sha256'),body=createHash('sha256');
      const ownAbort=Object.assign(new Error('CS01 scheduled post-first-byte client abort'),{code:'TEST_CS01_CLIENT_ABORT'});
      let summaryCount=0;
      const validateRecord=record=>{
            assert.deepEqual(Object.keys(record),stocktakeCsvColumns);
            assert.equal(record.stocktakeId,String(header.id));assert.equal(record.stocktakeNumber,stocktakeCsvExpectedCell(header.stocktakeNumber));
            assert.deepEqual([record.status,record.cancelled,record.varianceStage,record.workflowVersion],['COUNTING','false','PREVIEW',String(header.version)]);
            assert.ok(Number.isSafeInteger(Number(record.asOf))&&Number(record.asOf)>0);
            observation.asOf ??= record.asOf;assert.equal(record.asOf,observation.asOf);
            if(record.recordType==='SUMMARY') {
              summaryCount++;assert.equal(summaryCount,1);observation.summary=record;return;
            }
            assert.equal(summaryCount,0,'Footer must be final');
            const text=JSON.stringify(stocktakeCsvDigestColumns.map(field=>record[field]))+'\n';
            assert.equal(sha(text),expected.hashes[observation.rows],'Every actual received record must equal its independently ordered expected prefix');
            data.update(text);observation.rows++;
            if(record.recordType==='SCOPE') { observation.scopes++;ids.update(`SCOPE:${record.scopeId}\n`); }
            else {assert.equal(record.recordType,'LINE');observation.lines++;ids.update(`LINE:${record.lineId}\n`);}
            assert.ok(observation.rows<=100000);
      };
      const parser=parse({columns:columns=>{assert.deepEqual(columns,stocktakeCsvColumns);return columns;},bom:true,max_record_size:1048576,on_record:record=>{validateRecord(record);return record;}});
      const parsing=pipeline(parser,async records=>{for await(const record of records)void record;});
      void parsing.catch(()=>{});
      try {
        for await(const chunk of source) {
          if(observation.firstBodyAt===null)observation.firstBodyAt=performance.now();
          observation.bytes+=chunk.length;body.update(chunk);
          await new Promise((resolve,reject)=>{parser.write(chunk,error=>error?reject(error):resolve());});
          const started=performance.now();await new Promise(resolve=>{globalThis.setImmediate(resolve);});
          observation.clientYieldCalls++;observation.clientYieldMs+=performance.now()-started;
          if(mustAbort){observation.outcome='ABORTED_AFTER_FIRST_BYTE';abort(ownAbort);break;}
        }
        parser.end();await parsing;
        if(mustAbort){assert.ok(observation.bytes>0);return {data:{csvObservation:observation}};}
        assert.equal(summaryCount,1);const footer=observation.summary;
        assert.deepEqual([footer.scopeCount,footer.filteredLineCount,footer.filterHash],['200','100000',expected.filterHash]);
        assert.equal(Number(footer.exportedRows),observation.rows);
        assert.ok(Number.isSafeInteger(Number(footer.generationBudgetMs))&&Number(footer.generationBudgetMs)>0&&Number(footer.generationBudgetMs)<=60000);
        assert.equal(response.headers.get('x-inventory-export-generation-budget-ms'),footer.generationBudgetMs);
        assert.equal(response.headers.get('x-inventory-export-truncated'),footer.truncated);
        assert.equal(response.headers.get('x-inventory-export-reason'),footer.truncationReason);
        assert.ok(['NONE','ROW_LIMIT','TIME_LIMIT'].includes(footer.truncationReason));
        assert.equal(footer.truncated,String(footer.truncationReason!=='NONE'));
        if(footer.truncationReason==='ROW_LIMIT') {
          assert.equal(observation.rows,100000);assert.equal(observation.scopes,200);assert.equal(observation.lines,99800);
          assert.equal(ids.copy().digest('hex'),expected.orderedIdsSha256);assert.equal(data.copy().digest('hex'),expected.dataSha256);
        }
        observation.outcome='COMPLETE';
      } catch(error) {
        if(!(signal.aborted&&signal.reason===ownAbort&&(error===ownAbort||['ABORT_ERR','CSV_QUOTE_NOT_CLOSED','CSV_RECORD_INCONSISTENT_COLUMNS'].includes(error.code)))) throw error;
        assert.ok(observation.bytes>0&&observation.firstBodyAt!==null);
        observation.outcome='ABORTED_AFTER_FIRST_BYTE';
      } finally {
        source.destroy();parser.destroy();await parsing.catch(error=>{observation.parserTerminalCode=error.code??error.name;});
        observation.orderedIdsSha256=ids.digest('hex');observation.dataSha256=data.digest('hex');observation.bodySha256=body.digest('hex');
        observation.responseCompleteAt=performance.now();observation.responseCompleteAtMs=resourceClock();observation.clientMemoryAfter=process.memoryUsage();
      }
      return {data:{csvObservation:observation}};
    },
    accept(value,response) { assert.ok(response.status===200||(response.status===503&&value.error?.code==='INVENTORY_DEPENDENCY_UNAVAILABLE'),`CS01 CSV failed with original status ${response.status}/${value.error?.code ?? 'UNKNOWN'}`); },
    complete(_value,row) {row.outcome=observation.outcome;row.bytes=observation.bytes;row.firstByteMs=observation.firstBodyAt===null?null:observation.firstBodyAt-row.dispatchAt;}
  };
}

// END stocktakeSoakCsvPlan

function stocktakeSoakWriterPlan(fixture,actor,state,phase) {
  const root='/api/v1/inventory/stocktakes',scope=fixture.soakScopes.get(actor.id);
  const candidate=state.candidates[state.candidateIndex%state.candidates.length];
  const candidatePlan={family:'FEFO_FIFO_CANDIDATES',route:candidate.route,onOffer(){state.candidateIndex++;},complete(value,row) {
    assert.deepEqual(value.data??value,candidate.expected);fixture.report.querySamples.push({actor:actor.id,worker:actor.worker,family:'FEFO_FIFO_CANDIDATES',phase,requestId:row.requestId,dispatchAt:row.dispatchAt,responseCompleteAt:row.responseCompleteAt,completeMs:row.responseCompleteAt-row.dispatchAt,outcome:'COMPLETE'});
  }};
  const next=(action,body,expected,signed=false)=>{
    let receipt;
    return { family:'WORKFLOW',candidate:candidatePlan,route:action==='create'?`${root}/create`:`${root}/${state.header.id}/${action}`,body,signed,
      onOffer(row) {
        receipt=fixture.soakOracle.register({action,body:{...body,password:undefined},targetId:state.header?.id??null,actorId:actor.id,actorLabel:actor.username,requestId:row.requestId,
          expected,beforeStatus:state.header?.status??null,scope,phase});
      },onDispatch(row) {row.sourceHash=receipt.sourceHash;row.requestHash=receipt.requestHash;receipt.dispatchAt=row.dispatchAt;receipt.dispatchEpoch=Date.now();},complete(value,row) {
        const result=value.data??value;receipt.result=result;receipt.completeEpoch=Date.now();
        assert.deepEqual([result.status,result.version,result.rowCount],[expected.status,expected.version,expected.rowCount]);
        assert.ok(Number.isSafeInteger(result.id)&&result.id>0&&Number.isSafeInteger(result.operationId)&&result.operationId>0);
        if(state.header) assert.equal(result.id,state.header.id);
        fixture.stocktakeCommands.set(result.operationId,{action,body:{...body,password:undefined},result,actorId:actor.id,requestId:row.requestId,beforeStatus:state.header?.status??null});
        if(action==='create') {state.header=result;state.startedAt=row.dispatchAt;state.lines=[];state.page=1;state.offset=0;state.stage='start';}
        else if(action==='start') {state.header=result;state.stage='lines';}
        else if(action==='counts/save') {state.offset+=body.lines.length;if(state.offset===500)state.stage='ready';}
        else if(action==='ready') {state.header=result;state.stage='post';}
        else if(action==='post') {state.header=result;state.replay={action,body,result,receipt};state.stage='replay';}
      }
    };
  };
  if(!state.stage||state.stage==='create')return next('create',{source:source(),warehouseId:scope.warehouseId,binIds:scope.binIds,reason:'Synthetic CS01 rolling count'},{status:'DRAFT',version:1,rowCount:scope.binIds.length});
  if(state.stage==='start')return next('start',{source:source(),expectedVersion:state.header.version},{status:'COUNTING',version:state.header.version+1,rowCount:500});
  if(state.stage==='lines')return {family:'WORKFLOW',candidate:candidatePlan,route:`${root}/${state.header.id}/lines?pageSize=100&page=${state.page}`,
    complete(value) {
      const data=value.data??value;assert.equal(data.total,500);assert.equal(data.items.length,100);
      for(const line of data.items){assert.equal(line.stocktakeId,state.header.id);assert.equal(line.binId,scope.binIds[0]);assert.equal(line.countedQuantity,null);assert.equal(line.version,1);}
      state.lines.push(...data.items);state.page++;
      if(state.page===6){assert.equal(new Set(state.lines.map(line=>line.id)).size,500);state.stage='count';}
    }};
  if(state.stage==='count') {
    const lines=state.lines.slice(state.offset,state.offset+100).map(line=>({lineId:line.id,expectedVersion:line.version,countedQuantity:line.snapshotQuantity+(state.round%2===0?1:-1)}));
    return next('counts/save',{source:source(),lines},{status:'COUNTING',version:state.header.version,rowCount:100});
  }
  if(state.stage==='ready')return next('ready',{source:source(),expectedVersion:state.header.version},{status:'READY_TO_POST',version:state.header.version+1,rowCount:500});
  if(state.stage==='post')return next('post',{source:source(),expectedVersion:state.header.version,reason:'Synthetic CS01 physical count',password:actor.password},{status:'POSTED',version:state.header.version+1,rowCount:500},true);
  assert.equal(state.stage,'replay');
  const replay=state.replay;let replayEntry;
  return {family:'WORKFLOW',candidate:candidatePlan,route:`${root}/${state.header.id}/post`,body:replay.body,signed:true,
    onOffer(row){replay.receipt.replays??=[];replayEntry={requestId:row.requestId,phase};replay.receipt.replays.push(replayEntry);},
    onDispatch(row){assert.equal(replayEntry.requestId,row.requestId);replayEntry.dispatchAt=row.dispatchAt;replayEntry.dispatchEpoch=Date.now();},
    complete(value,row){
      assert.deepEqual(value.data??value,replay.result);assert.equal(replayEntry.requestId,row.requestId);Object.assign(replayEntry,{result:value.data??value,completeEpoch:Date.now()});fixture.report.workflows.push({actor:actor.id,id:state.header.id,round:state.round,startedAt:state.startedAt,completedAt:performance.now(),phase,sourceReplayVerified:true,requestId:row.requestId});
      state.round++;state.stage='create';state.header=null;state.replay=null;
    }};
}

export function stocktakeSoakSteadyQueries(samples,steadyEnd) {
  return samples.filter(row=>row.phase==='STEADY'&&Number.isFinite(row.responseCompleteAt)&&row.responseCompleteAt<=steadyEnd);
}
// END stocktakeSoakSteadyQueries

export async function runStocktakeResourceSoak(fixture) {
  const journal=fixture.cs01Journal;journal?.checkpoint('RUN_PREPARATION','START');
  assert.equal(fixture.mode,'CS01');assert.equal(fixture.workers.length,2);assert.equal(fixture.actors.length,20);assert.equal(fixture.reservations.length,15);
  const report=fixture.report;report.kind='DEVELOPER_CHARACTERIZATION';report.performanceAcceptance='NOT_EVALUATED_PENDING_APPROVED_NUMERIC_GATE';report.task041='IN_PROGRESS';report.p4='NOT_READY';
  report.querySamples=[];report.workflows=[];report.minuteChecks=[];report.soak={status:'IN_PROGRESS',warmupMs:120000,steadyMs:1800000,drainBudgetMs:180000,offersPerWorker:14400};
  const queryCases=await characterizationQueryCases(fixture);
  report.queryPlans={plans:[]};await characterizationQueryPlans(fixture,queryCases,report.queryPlans);
  const expectedCases=[];
  for(const testCase of queryCases) expectedCases.push({...testCase,expected:await characterizationQueryExpected(fixture.db,testCase)});
  const expectedExport=await prepareStocktakeSoakExportOracle(fixture);
  const stocktakeReads=await stocktakeSoakReadCases(fixture);
  const states=new Map(fixture.actors.map(actor=>[actor.id,{round:0,candidateIndex:0,queryIndex:0,exportAttempts:0,
    candidates:expectedCases.filter(testCase=>testCase.actor.id===actor.id&&testCase.family==='FEFO_FIFO_CANDIDATES'),
    queries:[...expectedCases.filter(testCase=>testCase.actor.id===actor.id&&testCase.family!=='FEFO_FIFO_CANDIDATES'),...stocktakeReads]} ]));
  journal?.checkpoint('RUN_PREPARATION','END');await journal?.flush();
  const warmupStartedAt=performance.now(),epoch=warmupStartedAt+120000,steadyEnd=epoch+1800000;
  journal?.checkpoint('WARMUP','START');
  report.soak.warmupStartedAt=warmupStartedAt;report.soak.steadyStartedAt=epoch;
  let firstError,snapshotPending,drainDeadline;const failures=[];
  const failed=(error,stage)=>{
    if(!firstError){
      firstError=error;fixture.soakOffersStopped=true;drainDeadline??=performance.now()+180000;
      lane?.stop(error);journal?.checkpoint('RUN_ORIGINAL_ERROR','ERROR',{originalError:error});
    }
    failures.push({stage,error:errorObservation(error)});
  };
  const checkStopped=()=>{if(firstError)throw firstError;};
  const lane=createStocktakeSoakLane({workers:fixture.workers,actors:fixture.actors,report,epoch,onFailure:error=>failed(error,'lane')});
  fixture.soakLane=lane;fixture.soakOffersStopped=false;
  const sampling=await startStocktakeResourceSampling(fixture);
  const planFor=(actor,phase)=>{
    const state=states.get(actor.id);
    if(actor.writer)return stocktakeSoakWriterPlan(fixture,actor,state,phase);
    if(actor.lane===9)return stocktakeSoakCsvPlan(fixture,actor,expectedExport,state.exportAttempts+1,phase);
    const testCase=state.queries[state.queryIndex%state.queries.length];
    return {family:testCase.family,route:testCase.route,complete(value,row){
      const data=value.data??value;
      if(testCase.family.startsWith('STOCKTAKE_')){const {asOf,...content}=data;assert.ok(Number.isSafeInteger(asOf)&&asOf>=Math.floor(performance.timeOrigin+row.dispatchAt)-1&&asOf<=Date.now());assert.deepEqual(content,testCase.expected);}
      else assert.deepEqual(data,testCase.expected);state.queryIndex++;
      report.querySamples.push({actor:actor.id,worker:actor.worker,family:testCase.family,phase,requestId:row.requestId,dispatchAt:row.dispatchAt,responseCompleteAt:row.responseCompleteAt,completeMs:row.responseCompleteAt-row.dispatchAt,outcome:'COMPLETE'});
    }};
  };
  const offer=(worker,tick,phase,start)=>{
    checkStopped();
    const intended=intendedOffer(worker,tick),actor=fixture.actors.find(value=>value.worker===worker&&value.lane===intended.actor);
    const plan=planFor(actor,phase),state=states.get(actor.id),onDispatch=plan.onDispatch;
    plan.onDispatch=row=>{onDispatch?.(row);if(row.family==='CSV')state.exportAttempts++;};
    plan.phase=phase;
    const row=lane.offer(actor,Math.floor(tick/10),start+intended.atMs,plan);row.phase=phase;row.tick=tick;row.minute=intended.minute;
    if(row.pending)void row.pending.catch(error=>failed(error,`${phase}:${row.requestId}`));
  };
  const minuteCheck=minute=>{
    const intendedAt=epoch+minute*60000;
    const value={minute,intendedAt,startedAt:performance.now(),completedAt:null,status:'IN_PROGRESS'};report.minuteChecks.push(value);
    journal?.checkpoint('MINUTE','START',{minute});
    if(snapshotPending){value.status='MISSED_PREVIOUS_IN_FLIGHT';failed(new Error('Overlapping minute reconciliation is incomplete'),'minute-check');journal?.checkpoint('MINUTE','END',{minute,originalError:firstError});return;}
    snapshotPending=(async()=>{
      await proveStocktakeSoakBusyExports(fixture);for(const worker of fixture.workers){const status=await worker.soakExportCheckpoint();assert.equal(status.status,'COMPLETE');}
      const {model:_model,...result}=await fixture.soakOracle.verify({final:false,minute});value.result=result;value.status='COMPLETE';
    })().catch(error=>{value.status='FAIL';failed(error,'minute-check');}).finally(()=>{value.completedAt=performance.now();snapshotPending=undefined;journal?.checkpoint('MINUTE','END',{minute,originalError:value.status==='FAIL'?firstError:null});});
  };
  try {
    // Warmup uses its own offers; it never consumes or replaces a steady tick.
    for(let tick=0;tick<960;tick++)for(const worker of [0,1]){
      checkStopped();const due=warmupStartedAt+tick*125+worker*62.5;if(performance.now()<due)await setTimeout(due-performance.now());checkStopped();offer(worker,tick,'WARMUP',warmupStartedAt);
    }
    checkStopped();if(performance.now()<epoch)await setTimeout(epoch-performance.now());checkStopped();
    journal?.checkpoint('WARMUP','END');journal?.checkpoint('STEADY','START');
    let nextMinute=1;
    for(let tick=0;tick<14400;tick++)for(const worker of [0,1]){
      checkStopped();const due=epoch+tick*125+worker*62.5;if(performance.now()<due)await setTimeout(due-performance.now());checkStopped();
      while(nextMinute<=30&&performance.now()>=epoch+nextMinute*60000){checkStopped();minuteCheck(nextMinute);nextMinute++;}
      offer(worker,tick,'STEADY',epoch);
    }
    checkStopped();if(performance.now()<steadyEnd)await setTimeout(steadyEnd-performance.now());checkStopped();
    while(nextMinute<=30){checkStopped();minuteCheck(nextMinute);nextMinute++;}
    checkStopped();fixture.soakOffersStopped=true;
    report.soak.steadyStoppedAt=performance.now();assert.ok(report.soak.steadyStoppedAt-epoch>=1800000);
    journal?.checkpoint('STEADY','END');journal?.checkpoint('DRAIN','START');
    const drainStartedAt=performance.now();report.soak.drainStartedAt=drainStartedAt;drainDeadline=drainStartedAt+180000;
    let drainTimer;
    try {await Promise.race([lane.settle(),new Promise((_,reject)=>{drainTimer=globalThis.setTimeout(()=>reject(Object.assign(new Error('CS01 original drain expired'),{code:'TEST_CS01_DRAIN_TIMEOUT'})),180000);})]);}
    finally{globalThis.clearTimeout(drainTimer);}
    if(snapshotPending)await snapshotPending;
    report.soak.drainCompletedAt=performance.now();assert.ok(report.soak.drainCompletedAt-drainStartedAt<=180000);
    journal?.checkpoint('DRAIN','END',{originalError:firstError});
    lane.verifyRefreshes(report.soak.steadyStoppedAt);
    const steady=report.offers.filter(row=>row.phase==='STEADY');assert.equal(steady.length,28800);
    for(const worker of [0,1]){
      const rows=steady.filter(row=>row.worker===worker);assert.equal(rows.length,14400);
      for(let minute=0;minute<30;minute++)assert.equal(rows.filter(row=>row.minute===minute).length,480);
      const sent=rows.filter(row=>row.dispatchAt!==null).sort((a,b)=>a.dispatchAt-b.dispatchAt);
      for(let n=1;n<sent.length;n++)assert.ok(sent[n].dispatchAt-sent[n-1].dispatchAt>=125);
    }
    const steadyQueries=stocktakeSoakSteadyQueries(report.querySamples,steadyEnd);
    for(const actor of fixture.actors){
      const rows=steady.filter(row=>row.actor===actor.id);assert.equal(rows.length,1440);
      for(let minute=0;minute<30;minute++)assert.equal(rows.filter(row=>row.minute===minute).length,48);
      for(const row of rows)if(actor.writer&&(row.turn+1)%4===0)assert.equal(row.family,'FEFO_FIFO_CANDIDATES');
      if(actor.writer)assert.ok(report.workflows.filter(row=>row.actor===actor.id&&row.startedAt>=epoch&&row.completedAt<=steadyEnd&&row.sourceReplayVerified).length>=3);
      else if(actor.lane===9){const exports=report.exports.filter(row=>row.actor===actor.id&&row.phase==='STEADY'&&row.dispatchAt!==undefined);assert.ok(exports.length>=10);assert.ok(exports.some(row=>row.outcome==='ABORTED_AFTER_FIRST_BYTE'));}
      else assert.ok(steadyQueries.filter(row=>row.actor===actor.id).length>=120);
    }
    for(const family of characterizationQueryFamilies){const samples=steadyQueries.filter(row=>row.family===family);assert.ok(samples.length>=100);assert.ok(nearestRank(samples.map(row=>row.completeMs),0.95)<2000);}
    assert.equal(report.minuteChecks.length,30);assert.ok(report.minuteChecks.every(row=>row.status==='COMPLETE'));
    for(const worker of [0,1])assert.ok(report.exports.some(row=>row.worker===worker&&row.phase==='STEADY'&&row.outcome==='COMPLETE'&&row.summary?.truncationReason==='ROW_LIMIT'&&row.responseCompleteAt<=steadyEnd));
    if(firstError)throw firstError;
    await proveStocktakeSoakBusyExports(fixture);for(const worker of fixture.workers){const status=await worker.soakExportCheckpoint();assert.equal(status.status,'COMPLETE');}
    journal?.checkpoint('SOAK_CLEANUP','START',{originalError:firstError});await journal?.flush();
    report.soak.cleanup=await fixture.soakOracle.cleanup();
    journal?.checkpoint('SOAK_CLEANUP','END');
    report.soak.status='COMPLETE';
  }catch(error){failed(error,'soak');report.soak.status='FAIL';}
  finally{
    fixture.soakOffersStopped=true;
    if(lane.pending.size||snapshotPending){
      drainDeadline??=performance.now()+180000;let timer;
      try{
        const remaining=drainDeadline-performance.now();assert.ok(remaining>0,'Original CS01 drain cannot restart');
        await Promise.race([Promise.all([lane.settle(),snapshotPending]),new Promise((_,reject)=>{timer=globalThis.setTimeout(()=>reject(Object.assign(new Error('CS01 original failure drain expired'),{code:'TEST_CS01_DRAIN_TIMEOUT'})),remaining);})]);
      }catch(error){failed(error,'failure-drain');for(const worker of fixture.workers)worker.quarantined=true;}finally{globalThis.clearTimeout(timer);}
    }
    try{
      const period=await sampling.stop();
      assert.ok(performance.now()>=steadyEnd,'Full steady resource coverage was not observed');
      const coverage=stocktakeResourceCoverage(period,fixture.workers,[{dispatchAtMs:performance.timeOrigin+epoch,responseCompleteAtMs:performance.timeOrigin+Math.min(performance.now(),steadyEnd)}]);
      report.soak.resourceCoverage=coverage;assert.equal(coverage.status,'COMPLETE');
    }catch(error){failed(error,'resource-sampling');report.soak.status='FAIL';}
    if(firstError){
      const warmupOffered=report.offers.filter(row=>row.phase==='WARMUP').length,steadyOffered=report.offers.filter(row=>row.phase==='STEADY').length;
      report.soak.stoppedWork={warmupPlanned:1920,warmupOffered,warmupNotOffered:1920-warmupOffered,steadyPlanned:28800,steadyOffered,steadyNotOffered:28800-steadyOffered};
    }
    report.soak.errors=failures;
    try{
    const requests=new Map(report.requests.map(row=>[row.requestId,row])),groups=new Map();
    for(const offered of report.offers){
      const request=requests.get(offered.requestId),key=JSON.stringify([offered.phase,offered.worker,offered.actor,offered.minute??-1,offered.family,offered.outcome,offered.status,request?.code??offered.error?.code??null]);
      const group=groups.get(key)??{phase:offered.phase,worker:offered.worker,actor:offered.actor,minute:offered.minute??null,family:offered.family,outcome:offered.outcome,status:offered.status,code:request?.code??offered.error?.code??null,intended:0,dispatched:0,values:{schedulerLatenessMs:[],preparationMs:[],firstByteMs:[],completeMs:[],intendedToCompleteMs:[]}};
      group.intended++;if(offered.dispatchAt!==null)group.dispatched++;
      for(const field of Object.keys(group.values)){const value=field==='schedulerLatenessMs'&&offered.dispatchAt!==null?offered.dispatchAt-offered.intendedAt:request?.[field];if(typeof value==='number'&&Number.isFinite(value))group.values[field].push(value);}
      groups.set(key,group);
    }
    report.soak.offerRollups=[...groups.values()].map(({values,...group})=>({...group,latency:Object.fromEntries(Object.entries(values).map(([field,samples])=>[field,{count:samples.length,p50:samples.length?nearestRank(samples,.5):null,p95:samples.length?nearestRank(samples,.95):null,p99:samples.length?nearestRank(samples,.99):null,max:samples.length?Math.max(...samples):null}]))}));
    assert.equal(report.soak.offerRollups.reduce((sum,row)=>sum+row.intended,0),report.offers.length,'Every NOT_SENT and dispatched offer remains in its actor/worker/minute/outcome denominator');
    }catch(error){failed(error,'offer-rollup');}
  }
  if(firstError){report.soak.status='FAIL';throw firstError;}
  return report.soak;
}

async function stocktakeSoakReadCases(fixture) {
  const {db,exportHeader}=fixture,id=exportHeader.id;
  const [[header]]=await db.execute('SELECT * FROM inventory_stocktakes WHERE id=?',[id]);
  assert.equal(header.status,'COUNTING');assert.equal(Number(header.version),2);
  const listHeader={id,number:header.stocktake_number,warehouseId:5,status:'COUNTING',version:2,reason:header.reason,
    createdAt:Number(header.created_at),updatedAt:Number(header.updated_at),startedAt:Number(header.started_at),readyAt:null,postedAt:null,cancelledAt:null};
  const summary={totalLines:100000,countedLines:0,notFoundLines:0,uncountedLines:100000,gainLines:0,lossLines:0,zeroLines:0};
  const [scopes]=await db.execute(`SELECT s.*,b.bin_code,b.status FROM inventory_stocktake_bins s JOIN inventory_bins b ON b.id=s.bin_id WHERE s.stocktake_id=? ORDER BY s.id LIMIT 20`,[id]);
  const [lines]=await db.execute(`SELECT l.*,s.bin_code_snapshot,b.bin_code,sku.sku_code,sku.sku_name,su.uom_id,u.code AS uom_code,lot.lot_number
    FROM (SELECT * FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY id LIMIT 100) l
    JOIN inventory_stocktake_bins s ON s.id=l.stocktake_bin_id JOIN inventory_bins b ON b.id=l.bin_id JOIN item_skus sku ON sku.id=l.sku_id
    JOIN item_sku_uoms su ON su.sku_id=l.sku_id AND su.is_base=1 JOIN item_uoms u ON u.id=su.uom_id LEFT JOIN inventory_lots lot ON lot.id=l.lot_id ORDER BY l.id`,[id]);
  assert.equal(scopes.length,20);assert.equal(lines.length,100);
  const items=lines.map(line=>({id:Number(line.id),stocktakeId:id,stocktakeBinId:Number(line.stocktake_bin_id),binId:Number(line.bin_id),skuId:Number(line.sku_id),lotId:line.lot_id===null?null:Number(line.lot_id),
    stockStatus:line.stock_status,snapshotBalanceId:Number(line.stock_balance_id),snapshotQuantity:100,snapshotBalanceVersion:4,countedQuantity:null,actualQuantity:null,notFound:false,countState:'UNCOUNTED',varianceQuantity:null,
    varianceStage:'PREVIEW',cancelled:false,version:1,movementId:null,countedAt:null,countedBy:null,binCodeSnapshot:line.bin_code_snapshot,binCodeCurrent:line.bin_code,skuCodeCurrent:line.sku_code,skuNameCurrent:line.sku_name,
    lotNumberCurrent:line.lot_number??null,baseUom:{uomId:Number(line.uom_id),uomCode:line.uom_code}}));
  return [
    {family:'STOCKTAKE_LIST',route:'/api/v1/inventory/stocktakes?warehouseId=5&pageSize=20&page=1',expected:{items:[listHeader],total:1,page:1,pageSize:20}},
    {family:'STOCKTAKE_DETAIL',route:`/api/v1/inventory/stocktakes/${id}?scopePageSize=20&scopePage=1`,expected:{...listHeader,varianceStage:'PREVIEW',cancelled:false,
      scope:{items:scopes.map(row=>({id:Number(row.id),binId:Number(row.bin_id),binCodeSnapshot:row.bin_code_snapshot,binCodeCurrent:row.bin_code,statusCurrent:'ACTIVE'})),total:200,page:1,pageSize:20},
      progress:{totalLines:100000,countedLines:0,notFoundLines:0,uncountedLines:100000},varianceSummary:summary}},
    {family:'STOCKTAKE_LINES',route:`/api/v1/inventory/stocktakes/${id}/lines?pageSize=100&page=1`,expected:{id,status:'COUNTING',version:2,varianceStage:'PREVIEW',cancelled:false,items,total:100000,page:1,pageSize:100,globalSummary:summary,filteredSummary:summary}}
  ];
}

async function proveStocktakeSoakBusyExports(fixture) {
  const attempts=(fixture.report.exports??[]).filter(row=>row.outcome==='DEPENDENCY_FAIL_UNPROVEN_BUSY');
  for(const worker of fixture.workers) {
    const waiting=attempts.filter(row=>row.worker===fixture.workers.indexOf(worker));if(!waiting.length)continue;
    const checkpoint=await worker.resourceCheckpoint(true),resources=checkpoint.resources;
    for(const row of waiting) {
      const events=worker.soakExportEvents.filter(event=>event.requestId===row.requestId);
      if(!events.some(event=>event.type==='prepare.error'&&event.error.code==='INVENTORY_DEPENDENCY_UNAVAILABLE'))continue;
      assert.equal(events.some(event=>event.type==='generation.return'||event.type==='prepare.return'),false);
      assert.equal(resources.files.some(file=>file.requestId===row.requestId),false);
      assert.equal(resources.pools.some(pool=>pool.kind==='AUXILIARY'&&pool.requestId===row.requestId),false);
      assert.equal(resources.transports.some(socket=>socket.kind==='AUXILIARY'&&socket.requestId===row.requestId),false);
      const file=resources.files.find(value=>value.requestId!==row.requestId&&value.createdAtMs<=row.dispatchAtMs&&value.closedAtMs>=row.responseCompleteAtMs);
      const socket=file&&resources.transports.find(value=>value.kind==='AUXILIARY'&&value.requestId===file.requestId&&value.openedAtMs<=row.dispatchAtMs&&value.closedAtMs>=row.responseCompleteAtMs);
      if(!file||!socket)continue;
      const intent=fixture.soakExportIntents.get(row.requestId);assert.ok(intent);
      fixture.soakExportIntents.set(row.requestId,Object.freeze({...intent,expectedPreGenerationBusy:true}));
      row.outcome='BUSY';row.busyProvenance={requestId:file.requestId,fileId:file.id,transportId:socket.id,observation:'OWNED_FILE_AND_AUXILIARY_TRANSPORT_SPAN_ACTUAL_DISPATCH_AND_503_COMPLETE'};
    }
  }
}

// CS01-only prospective helper source. Seed rows are specified from insertion intent, never copied from a DB baseline.
export function stocktakeSoakTables() {
  return ['inventory_allocations','inventory_audit_logs','inventory_bin_locks','inventory_bins','inventory_lots','inventory_movements',
    'inventory_operation_requests','inventory_purchase_reversal_links','inventory_reservations','inventory_stock_balances','inventory_stock_controls',
    'inventory_stocktake_bins','inventory_stocktake_lines','inventory_stocktakes','inventory_transfer_lines','inventory_transfers','inventory_warehouses'];
}
export function stocktakeSoakSeedRow(table, identity, seed) {
  const { timestamp: now, actorId, day, expiry, marker } = seed, id = Number(identity.id);
  assert.ok(Number.isSafeInteger(id) && id > 0);
  const bucket = value => {
    assert.ok(Number.isSafeInteger(value) && value > 0 && value <= 500000);
    const warehouse = Math.floor((value-1)/100000)+1, local=(value-1)%100000, sku=Math.floor(local/2)+1, leg=local%2;
    const tracked=(sku-1)%4>=2;
    return {id:value,warehouse_id:warehouse,bin_id:(warehouse-1)*200+(Math.floor((sku-1)/4)+leg*100)%200+1,sku_id:sku,
      lot_id:tracked?sku:null,lot_scope:tracked?sku:0,stock_status:leg===0?'AVAILABLE':sku%2===0?'QUARANTINED':'DAMAGED',
      on_hand_quantity:100,allocated_quantity:0,fifo_anchor_date:day,version:4,created_at:now,updated_at:now};
  };
  if(table==='inventory_stock_balances') return bucket(id);
  if(table==='inventory_stock_controls') {
    const w=Number(identity.warehouse_id),sku=Number(identity.sku_id);
    assert.ok(w>=1&&w<=5&&sku>=1&&sku<=50000);
    return {id,warehouse_id:w,sku_id:sku,reserved_quantity:0,version:1,created_at:now,updated_at:now};
  }
  if(table==='inventory_warehouses') {
    assert.ok(id<=5); return {id,warehouse_code:`WH-${id}`,normalized_code:`WH-${id}`,warehouse_name:`Synthetic ${id}`,address:null,description:'',status:'ACTIVE',version:1,created_at:now,updated_at:now,created_by:null,updated_by:null};
  }
  if(table==='inventory_bins') {
    assert.ok(id<=1000);const code=`B-${String((id-1)%200+1).padStart(3,'0')}`;
    return {id,warehouse_id:Math.floor((id-1)/200)+1,bin_code:code,normalized_code:code,bin_name:null,description:'',status:'ACTIVE',version:1,created_at:now,updated_at:now,created_by:null,updated_by:null};
  }
  if(table==='inventory_lots') {
    assert.ok(id<=50000&&(id-1)%4>=2);return {id,sku_id:id,lot_number:`L-${id}`,normalized_lot_number:`L-${id}`,expiry_date:(id-1)%4===3?expiry:null,manufacture_date:null,first_receipt_date:day,sku_code_snapshot:`PERF-SKU-${marker}-${id-1}`,created_at:now,created_by:null};
  }
  if(table==='inventory_operation_requests') {
    assert.ok(id<=500000);const group=`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`;
    return {id,command_type:'RECEIPT_POST',source_module:'PERFORMANCE',source_document_type:'SYNTHETIC_BASELINE',source_document_id:String(id),source_line_id:'',source_event_id:'baseline',request_hash:sha(`fixture-${id}`),result_type:'MOVEMENT_GROUP',result_id:group,result_summary:{movementGroupId:group,status:'POSTED',lineCount:4},completed_at:now,actor_user_id:actorId,actor_label:'Synthetic fixture, not Receipt execution',request_id:'',correlation_id:'',created_at:now};
  }
  if(table==='inventory_audit_logs') {
    const op=Number(identity.operation_request_id); assert.ok(Number.isSafeInteger(op)&&op>=1&&op<=500000);
    return {id,occurred_at:now,actor_user_id:actorId,actor_label:'Synthetic fixture',action:'inventory.receipt',target_type:'movement_group',target_id:op,target_label:String(op),outcome:'SUCCEEDED',reason_category:'',reason_text:'',before_summary:null,after_summary:{quantity:100,version:4,rowCount:4},operation_request_id:op,request_id:'',correlation_id:'',ip:''};
  }
  assert.equal(table,'inventory_movements','No seed rows are allowed in this table');
  const op=Number(identity.operation_request_id),version=Number(identity.balance_version_after),b=bucket(op);
  assert.ok(Number.isSafeInteger(version)&&version>=1&&version<=4);
  return {id,movement_group_id:`00000000-0000-4000-8000-${String(op).padStart(12,'0')}`,operation_request_id:op,movement_type:'RECEIPT',location_kind:'BIN',warehouse_id:b.warehouse_id,bin_id:b.bin_id,sku_id:b.sku_id,lot_id:b.lot_id,stock_status:b.stock_status,direction:'IN',quantity:25,balance_before:(version-1)*25,balance_after:version*25,balance_version_after:version,reservation_id:null,allocation_id:null,transfer_id:null,transfer_line_id:null,stocktake_id:null,stocktake_line_id:null,reversal_of_movement_id:null,reason_category:'',reason_text:'',sku_code_snapshot:`PERF-SKU-${marker}-${b.sku_id-1}`,sku_name_snapshot:`Perf SKU ${marker} ${b.sku_id-1}`,warehouse_code_snapshot:`WH-${b.warehouse_id}`,bin_code_snapshot:`B-${String((b.bin_id-1)%200+1).padStart(3,'0')}`,lot_number_snapshot:b.lot_id===null?'':`L-${b.sku_id}`,expiry_date_snapshot:b.lot_id!==null&&(b.sku_id-1)%4===3?expiry:null,posted_at:now-5+version,posted_by:actorId,posted_by_label:'Synthetic fixture'};
}
export function stocktakeSoakAssertRow(actual, expected, label) {
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),`${label}: exact columns`);
  for(const [field,value] of Object.entries(expected)) {
    let found=actual[field];
    if(found instanceof Date) found=`${found.getFullYear()}-${String(found.getMonth()+1).padStart(2,'0')}-${String(found.getDate()).padStart(2,'0')}`;
    if(['before_summary','after_summary','result_summary'].includes(field)&&typeof found==='string') found=JSON.parse(found);
    if(typeof value==='number') { assert.ok(found!==null&&found!=='',`${label}.${field}`);found=Number(found); }
    if(value!==null&&typeof value==='object'){const ordered=item=>JSON.stringify(item,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);assert.equal(ordered(found),ordered(value),`${label}.${field}`);}else assert.deepEqual(found,value,`${label}.${field}`);
  }
}
export function stocktakeSoakReadDb(db, deadline=Infinity) {
  const check=()=>{if(performance.now()>=deadline)throw Object.assign(new Error('Original reconciliation transaction deadline'),{code:'TEST_CS01_SNAPSHOT_TIMEOUT'});};
  const metrics={sqlCalls:0,sqlMs:0,maxSqlMs:0,failedSqlCalls:0};
  const read=async(method,sql,parameters)=>{check();const started=performance.now();metrics.sqlCalls++;try{const result=await db[method]({...(typeof sql==='string'?{sql}:sql),timeout:10000},parameters);check();return result;}catch(error){metrics.failedSqlCalls++;throw error;}finally{const elapsed=performance.now()-started;metrics.sqlMs+=elapsed;metrics.maxSqlMs=Math.max(metrics.maxSqlMs,elapsed);}};
  return {execute:(sql,parameters)=>read('execute',sql,parameters),query:(sql,parameters)=>read('query',sql,parameters),check,metrics};
}
export function scanStocktakeSoakTable(db, table, cutoff, visit, upper = null) {
  assert.ok(stocktakeSoakTables().includes(table));assert.ok(Number.isSafeInteger(cutoff)&&cutoff>=0);
  assert.ok(upper===null||(Number.isSafeInteger(upper)&&upper>=cutoff));
  return (async()=>{
    let after=cutoff,count=0;const digest=createHash('sha256');
    for(;;) {
      const [rows]=await db.execute(`SELECT * FROM ${table} WHERE id>?${upper===null?'':' AND id<=?'} ORDER BY id LIMIT 500`,upper===null?[after]:[after,upper]);
      assert.ok(rows.length<=500);
      if(!rows.length)break;
      for(const row of rows){const id=Number(row.id);assert.ok(Number.isSafeInteger(id)&&id>after);if(upper!==null)assert.ok(id<=upper);after=id;count++;await visit(row);digest.update(JSON.stringify(row)+'\n');}
    }
    return {count,lastId:after,sha256:digest.digest('hex')};
  })();
}
export function withStocktakeSoakSnapshot(db, work) {
  return (async()=>{
    const reads=stocktakeSoakReadDb(db,performance.now()+20000);
    await reads.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await reads.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    let primary,value;
    try{value=await work(reads);reads.check();}catch(error){primary=error;}
    finally{try{await db.rollback();}catch(error){if(primary)primary.snapshotRollbackError={code:error.code??'UNKNOWN'};else primary=error;}}
    if(primary)throw primary;
    return value;
  })();
}
export function verifyStocktakeSoakSeedCapacity(db, seed) {
  return (async()=>{
    db=stocktakeSoakReadDb(db);
    const started=performance.now(),tables=stocktakeSoakTables(),baseline={};
    const [actual]=await db.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,10)='inventory_' ORDER BY TABLE_NAME");
    assert.deepEqual(actual.map(row=>row.name),tables,'All 17 original inventory tables, including 0101 links');
    const required={inventory_warehouses:5,inventory_bins:1000,inventory_lots:25000,inventory_stock_controls:250000,inventory_stock_balances:500000,inventory_operation_requests:500000,inventory_audit_logs:500000,inventory_movements:2000000};
    for(const table of tables){
      const seen=new Uint8Array(table==='inventory_movements'||table==='inventory_audit_logs'?500001:table==='inventory_stock_controls'?250000:0);
      let ordered=0;const immutable=createHash('sha256');
      baseline[table]=await scanStocktakeSoakTable(db,table,0,row=>{
        assert.ok(required[table],`Fresh ${table} must have no rows`);
        stocktakeSoakAssertRow(row,stocktakeSoakSeedRow(table,row,seed),`${table}:${row.id}`);
        immutable.update(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>!(['inventory_stock_balances','inventory_stock_controls'].includes(table)&&['on_hand_quantity','reserved_quantity','version','updated_at','fifo_anchor_date'].includes(key)))))+'\n');
        if(table==='inventory_movements'){const key=Number(row.operation_request_id),mask=1<<(Number(row.balance_version_after)-1);assert.equal(seen[key]&mask,0);seen[key]|=mask;}
        else if(table==='inventory_audit_logs'){const key=Number(row.operation_request_id);assert.equal(seen[key],0);seen[key]=1;}
        else if(table==='inventory_stock_controls'){const key=(Number(row.warehouse_id)-1)*50000+Number(row.sku_id)-1;assert.equal(seen[key],0);seen[key]=1;}
        else if(table!=='inventory_lots')assert.equal(Number(row.id),++ordered);
      });
      baseline[table].immutableSha256=immutable.digest('hex');
      assert.equal(baseline[table].count,required[table]??0,`Full ${table} count`);
      if(table==='inventory_movements')for(let id=1;id<=500000;id++)assert.equal(seen[id],15,'Four exact independent seed legs');
    }
    let after=0,skus=0;
    for(;;){const [rows]=await db.execute('SELECT id,sku_code,sku_name,tracking_policy,min_sale_life_days,inventory_tracked,purchasable,sellable,status FROM item_skus WHERE id>? ORDER BY id LIMIT 500',[after]);if(!rows.length)break;assert.ok(rows.length<=500);
      for(const row of rows){assert.equal(Number(row.id),++skus);after=skus;stocktakeSoakAssertRow(row,{id:skus,sku_code:`PERF-SKU-${seed.marker}-${skus-1}`,sku_name:`Perf SKU ${seed.marker} ${skus-1}`,tracking_policy:(skus-1)%4<2?'none':(skus-1)%4===2?'batch':'batch_expiry',min_sale_life_days:0,inventory_tracked:1,purchasable:1,sellable:1,status:'active'},`SKU:${skus}`);}}
    assert.equal(skus,100000);
    return {seed:Object.freeze({...seed}),tables:baseline,skus,verifiedAt:performance.now(),verificationMs:performance.now()-started,sqlMetrics:db.metrics,provenance:'INDEPENDENT_INSERTION_INTENT_FULL_PAGED_SEED',status:'COMPLETE'};
  })();
}
export function createStocktakeSoakOracle({db,seed,actors,report,baseline,exportIntents=new Map(),exportEvents=()=>[],assertDrained=()=>assert.fail('Fresh final reconciliation requires positively drained actor lanes')}) {
  const commands=new Map(),requests=new Set();let checking=false;
  if(baseline){baseline={...baseline,tables:Object.freeze(Object.fromEntries(Object.entries(baseline.tables).map(([table,value])=>[table,Object.freeze({...value})])))};Object.freeze(baseline);}
  const keyFor=source=>JSON.stringify([source.module,source.documentType,source.documentId,source.lineId??'',source.eventId]);
  const parse=value=>typeof value==='string'?JSON.parse(value):value;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const jsonKey=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  const positive=value=>{const n=Number(value);assert.ok(Number.isSafeInteger(n)&&n>0);return n;};
  const payloadFor=record=>{
    const {body,action,family,targetId}=record,input=Object.fromEntries(Object.entries(body).filter(([key])=>!['source','password'].includes(key)));
    if(family==='RESERVATION')return action==='create'?input:{reservationId:targetId,expectedVersion:body.version??body.expectedVersion};
    return {...(action==='create'?{}:{stocktakeId:targetId}),...input,...(action==='create'?{binIds:[...input.binIds].sort((a,b)=>a-b),reason:(input.reason??'').trim()}:{}),...(action==='counts/save'?{lines:[...input.lines].sort((a,b)=>a.lineId-b.lineId)}:{})};
  };
  function register(input) {
    const record=clone(input),family=record.family??'STOCKTAKE';record.family=family;record.dispatchAt=null;
    assert.ok(['STOCKTAKE','RESERVATION'].includes(family));assert.ok(record.body?.source);
    assert.ok(['create','start','counts/save','ready','post','cancel'].includes(record.action));
    assert.ok(record.expected&&Object.hasOwn(record.expected,'status')&&Object.hasOwn(record.expected,'version'));
    const actor=actors.find(actor=>actor.id===record.actorId);assert.ok(actor);assert.equal(record.actorLabel,actor.username);
    if(record.requestId){assert.equal(requests.has(record.requestId),false);requests.add(record.requestId);}
    const sourceKey=keyFor(record.body.source);assert.equal(commands.has(sourceKey),false,'Original source must be registered exactly once; replays retain receipt');
    record.sourceHash=sha(sourceKey);record.commandType=`${family}_${record.action==='counts/save'?'COUNT':record.action.toUpperCase()}`;
    record.requestHash=inventoryOperationHash({commandType:record.commandType,payload:payloadFor(record)});
    commands.set(sourceKey,record);return record;
  }
  function matchOperation(row,snapshotEpoch=Date.now()) {
    const key=JSON.stringify([row.source_module,row.source_document_type,row.source_document_id,row.source_line_id,row.source_event_id]);
    const record=commands.get(key);assert.ok(record,'Unregistered committed original source');assert.ok(record.dispatchAt!==null&&record.dispatchAt!==undefined,'Committed source was never dispatched');const op=positive(row.id),summary=parse(row.result_summary),id=positive(row.result_id);
    assert.equal(row.command_type,record.commandType);assert.equal(row.request_hash,record.requestHash);assert.equal(row.result_type,record.family);
    assert.equal(Number(row.actor_user_id),record.actorId,'Flow actor must be bound at committed completion');assert.equal(row.actor_label,record.actorLabel);
    assert.ok(record.requestId);assert.equal(row.request_id,record.requestId);assert.equal(row.correlation_id,record.requestId);
    assert.ok(row.completed_at!==null);assert.ok(Number(row.completed_at)>=Number(row.created_at));
    if(record.dispatchEpoch!==undefined){assert.ok(Number(row.created_at)>=record.dispatchEpoch);assert.ok(Number(row.completed_at)<=snapshotEpoch);}
    if(record.targetId!==undefined&&record.targetId!==null)assert.equal(id,record.targetId);
    assert.ok(summary&&typeof summary==='object');
    const expected={...record.expected,id,operationId:op};
    if(record.family==='RESERVATION'){
      const create=record.action==='create'?record:[...commands.values()].find(r=>r.family==='RESERVATION'&&r.action==='create'&&(r.result?.id===id||r.committedId===id));
      assert.ok(create,'Reservation cancellation requires original independent creation intent');const body=create.body,cancelled=record.action==='cancel';
      const eligible=record.expected.eligibleOnHand??100,reserved=cancelled?0:body.quantity;
      const reservation={reservationId:id,operationId:op,warehouseId:body.warehouseId,skuId:body.skuId,purpose:body.purpose,minimumRemainingDays:body.minimumRemainingDays,originalQuantity:body.quantity,consumedQuantity:0,releasedQuantity:cancelled?body.quantity:0,outstandingQuantity:reserved,status:cancelled?'CANCELLED':'ACTIVE',version:cancelled?2:1,eligibleOnHand:eligible,reserved,rawAtp:eligible-reserved,atp:Math.max(eligible-reserved,0),uncoveredReserved:Math.max(reserved-eligible,0)};
      if(cancelled)for(const field of ['eligibleOnHand','reserved','rawAtp','atp','uncoveredReserved'])delete reservation[field];
      assert.equal(jsonKey(summary),jsonKey(reservation));
    }else{
      if(record.action==='post'){assert.ok(summary.movementGroupId===null||/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(summary.movementGroupId));expected.movementGroupId=summary.movementGroupId;assert.equal(expected.rowCount===0,summary.movementGroupId===null);}
      assert.equal(jsonKey(summary),jsonKey(expected),'Stored scalar result must match preregistered command intent');
    }
    if(record.result){const actual=record.family==='RESERVATION'?{...Object.fromEntries(Object.entries(record.result).filter(([key])=>!['id','availability'].includes(key))),reservationId:record.result.id,...record.result.availability}:record.result;assert.equal(jsonKey(actual),jsonKey(summary),'Original HTTP result and committed Operation disagree');}
    record.committedId=id;
    return {record,row,summary,id,operationId:op,time:Number(row.completed_at),observation:record.result?'COMMITTED_HTTP_SETTLED':'COMMITTED_HTTP_PENDING'};
  }
  function buildModel(rows,committed,snapshotEpoch) {
    const headers=new Map(),scopes=new Map(),lines=new Map(),locks=new Map(),reservations=new Map(),effects=new Map(),controls=new Map(),movements=new Map(),audits=[];
    const by=(table,field,value)=>rows[table].filter(row=>Number(row[field])===value);
    const assoc=(list,field,value,label)=>{const found=list.filter(row=>Number(row[field])===value);assert.equal(found.length,1,label);return positive(found[0].id);};
    const when=(row,record)=>{const value=Number(row.occurred_at);assert.ok(Number.isSafeInteger(value));assert.ok(value>=(record.dispatchEpoch??0)&&value<=(record.completeEpoch??snapshotEpoch),'Audit original call interval');return value;};
    const audit=(op,action,before,after,reason='')=>audits.push({record:op.record,operationId:op.operationId,targetId:op.id,targetLabel:op.record.family==='RESERVATION'?String(op.id):`ST-${headers.get(op.id).create_operation_id}`,action,before,after,reason});
    const balance=id=>{const b=stocktakeSoakSeedRow('inventory_stock_balances',{id},seed),e=effects.get(id);return e?{...b,...e}:b;};
    const scopeBalances=scope=>{const found=[],bins=new Set(scope.binIds);for(let sku=1;sku<=50000;sku++)for(let leg=0;leg<2;leg++){
      if(bins.has((scope.warehouseId-1)*200+(Math.floor((sku-1)/4)+leg*100)%200+1))found.push(balance((scope.warehouseId-1)*100000+(sku-1)*2+leg+1));
    }return found.sort((a,b)=>a.warehouse_id-b.warehouse_id||a.sku_id-b.sku_id||a.bin_id-b.bin_id||a.lot_scope-b.lot_scope||a.stock_status.localeCompare(b.stock_status));};
    // IDs order only associates serialized commands on the same actor-owned document; cross-document effects commute.
    for(const op of [...committed].sort((a,b)=>a.operationId-b.operationId)){
      const r=op.record,a=r.action,t=op.time,actor=r.actorId,id=op.id;
      if(r.family==='RESERVATION'){
        if(a==='create'){
          const b=r.body;assert.equal(reservations.has(id),false);const key=`${b.warehouseId}:${b.skuId}`;assert.equal(controls.has(key),false,'15 distinct Reservation dimensions');
          reservations.set(id,{id,create_operation_id:op.operationId,warehouse_id:b.warehouseId,sku_id:b.skuId,original_quantity:b.quantity,consumed_quantity:0,released_quantity:0,outstanding_quantity:b.quantity,minimum_remaining_days:b.minimumRemainingDays,purpose:b.purpose,status:'ACTIVE',version:1,created_at:t,updated_at:t,created_by:actor,updated_by:actor});
          controls.set(key,{reserved_quantity:b.quantity,version:2,updated_at:t});audit(op,'reservation.create',{skuId:b.skuId,warehouseId:b.warehouseId,quantity:0},{reservationId:id,quantity:b.quantity,status:'ACTIVE',version:1});
        }else{
          assert.equal(a,'cancel');const before=reservations.get(id);assert.ok(before);assert.equal(before.version,r.body.version??r.body.expectedVersion);const key=`${before.warehouse_id}:${before.sku_id}`;
          audit(op,'reservation.cancel',{reservationId:id,quantity:before.outstanding_quantity,status:before.status,version:before.version},{reservationId:id,quantity:0,status:'CANCELLED',version:2});
          Object.assign(before,{released_quantity:before.original_quantity,outstanding_quantity:0,status:'CANCELLED',version:2,updated_at:t,updated_by:actor});controls.set(key,{reserved_quantity:0,version:3,updated_at:t});
        }continue;
      }
      if(a==='create'){
        assert.equal(headers.has(id),false);const b=r.body,header={id,stocktake_number:`ST-${op.operationId}`,warehouse_id:b.warehouseId,status:'DRAFT',create_operation_id:op.operationId,start_operation_id:null,ready_operation_id:null,post_operation_id:null,cancel_operation_id:null,reason:b.reason.trim(),version:1,created_at:t,updated_at:t,created_by:actor,updated_by:actor,started_at:null,started_by:null,ready_at:null,ready_by:null,posted_at:null,posted_by:null,cancelled_at:null,cancelled_by:null};headers.set(id,header);
        assert.equal(jsonKey(r.scope),jsonKey({warehouseId:b.warehouseId,binIds:[...b.binIds].sort((a,b)=>a-b)}));
        const actual=by('inventory_stocktake_bins','stocktake_id',id);assert.equal(actual.length,b.binIds.length);
        for(const bin of b.binIds){const sid=assoc(actual,'bin_id',bin,'One original scope per independent Bin');scopes.set(sid,{id:sid,stocktake_id:id,bin_id:bin,bin_code_snapshot:`B-${String((bin-1)%200+1).padStart(3,'0')}`,created_at:t});}
        audit(op,'stocktake.create',null,{stocktakeId:id,status:'DRAFT',version:1,rowCount:b.binIds.length},header.reason);continue;
      }
      const h=headers.get(id);assert.ok(h,'Command has no independently committed creation');assert.equal(r.beforeStatus,h.status);
      if(a!=='counts/save')assert.equal(r.body.expectedVersion,h.version);
      const before={stocktakeId:id,status:h.status,version:h.version},owned=[...scopes.values()].filter(scope=>scope.stocktake_id===id);
      if(a==='start'){
        assert.equal(h.status,'DRAFT');const expected=scopeBalances(r.scope),actual=by('inventory_stocktake_lines','stocktake_id',id);assert.equal(actual.length,expected.length);
        const actualByBalance=new Map(actual.map(row=>[Number(row.stock_balance_id),row]));assert.equal(actualByBalance.size,actual.length);
        for(const b of expected){const actualLine=actualByBalance.get(b.id);assert.ok(actualLine,'Every independent Bucket must have exactly one snapshot line');const lid=positive(actualLine.id),scope=owned.find(scope=>scope.bin_id===b.bin_id);assert.ok(scope);lines.set(lid,{id:lid,stocktake_id:id,stocktake_bin_id:scope.id,stock_balance_id:b.id,bin_id:b.bin_id,sku_id:b.sku_id,lot_id:b.lot_id,stock_status:b.stock_status,lot_scope:b.lot_scope,snapshot_quantity:b.on_hand_quantity,snapshot_balance_version:b.version,counted_quantity:null,is_not_found:0,variance_quantity:null,movement_id:null,version:1,counted_at:null,counted_by:null});}
        const actualLocks=by('inventory_bin_locks','stocktake_id',id);assert.equal(actualLocks.length,owned.length);
        for(const s of owned){const lockId=assoc(actualLocks,'stocktake_bin_id',s.id,'One owned original lock per scope');locks.set(lockId,{id:lockId,bin_id:s.bin_id,lock_type:'STOCKTAKE',stocktake_id:id,stocktake_bin_id:s.id,locked_at:t,locked_by:actor,released_at:null,released_by:null,release_reason:'',active_scope:1});}
        Object.assign(h,{status:'COUNTING',version:h.version+1,start_operation_id:op.operationId,started_at:t,started_by:actor});audit(op,'stocktake.start',before,{stocktakeId:id,status:h.status,version:h.version,rowCount:expected.length},h.reason);
      }else if(a==='counts/save'){
        assert.equal(h.status,'COUNTING');assert.equal(r.expected.rowCount,r.body.lines.length);
        for(const input of [...r.body.lines].sort((a,b)=>a.lineId-b.lineId)){const line=lines.get(input.lineId);assert.ok(line&&line.stocktake_id===id);assert.equal(input.expectedVersion,line.version);const previous={id:line.id,stocktakeId:id,quantity:line.is_not_found?0:line.counted_quantity,version:line.version,status:line.is_not_found?'NOT_FOUND':line.counted_quantity===null?'UNCOUNTED':'COUNTED'};
          Object.assign(line,{counted_quantity:input.notFound?null:input.countedQuantity,is_not_found:input.notFound?1:0,version:line.version+1,counted_at:t,counted_by:actor});
          audit(op,'stocktake.count',previous,{...previous,quantity:input.notFound?0:input.countedQuantity,version:line.version,status:input.notFound?'NOT_FOUND':'COUNTED'});
        }
      }else if(a==='ready'){
        assert.equal(h.status,'COUNTING');const own=[...lines.values()].filter(line=>line.stocktake_id===id);assert.equal(own.length,r.expected.rowCount);
        for(const line of own){assert.ok(line.is_not_found||line.counted_quantity!==null);line.variance_quantity=(line.is_not_found?0:line.counted_quantity)-line.snapshot_quantity;}
        Object.assign(h,{status:'READY_TO_POST',version:h.version+1,ready_operation_id:op.operationId,ready_at:t,ready_by:actor});audit(op,'stocktake.ready',before,{stocktakeId:id,status:h.status,version:h.version,rowCount:own.length},h.reason);
      }else if(a==='post'){
        assert.equal(h.status,'READY_TO_POST');const changed=[...lines.values()].filter(line=>line.stocktake_id===id&&line.variance_quantity!==0),actual=by('inventory_movements','operation_request_id',op.operationId);assert.equal(changed.length,r.expected.rowCount);assert.equal(actual.length,changed.length);
        for(const line of changed){const b=balance(line.stock_balance_id),quantity=line.is_not_found?0:line.counted_quantity,mid=assoc(actual,'stocktake_line_id',line.id,'One exact Movement per changed line');assert.equal(b.version,line.snapshot_balance_version);assert.equal(b.on_hand_quantity,line.snapshot_quantity);assert.ok(quantity>=b.allocated_quantity);
          const next={on_hand_quantity:quantity,version:b.version+1,updated_at:t,fifo_anchor_date:quantity===0?null:b.fifo_anchor_date};effects.set(b.id,next);
          const m={...stocktakeSoakSeedRow('inventory_movements',{id:mid,operation_request_id:b.id,balance_version_after:1},seed),id:mid,movement_group_id:op.summary.movementGroupId,operation_request_id:op.operationId,movement_type:'STOCKTAKE_VARIANCE',direction:line.variance_quantity>0?'IN':'OUT',quantity:Math.abs(line.variance_quantity),balance_before:b.on_hand_quantity,balance_after:quantity,balance_version_after:b.version+1,stocktake_id:id,stocktake_line_id:line.id,reason_text:r.body.reason,posted_at:t,posted_by:actor,posted_by_label:r.actorLabel};movements.set(mid,m);
          audit(op,'stocktake.post',{id:line.id,stocktakeId:id,quantity:b.on_hand_quantity,version:b.version,status:b.stock_status,movementId:null},{id:line.id,stocktakeId:id,quantity,version:b.version+1,status:b.stock_status,movementId:mid});line.movement_id=mid;line.version++;
        }
        Object.assign(h,{status:'POSTED',reason:r.body.reason,version:h.version+1,post_operation_id:op.operationId,posted_at:t,posted_by:actor});audit(op,'stocktake.post',before,{stocktakeId:id,status:h.status,version:h.version,rowCount:changed.length});
      }else{
        assert.equal(a,'cancel');assert.ok(['DRAFT','COUNTING','READY_TO_POST'].includes(h.status));Object.assign(h,{status:'CANCELLED',reason:r.body.reason,version:h.version+1,cancel_operation_id:op.operationId,cancelled_at:t,cancelled_by:actor});audit(op,'stocktake.cancel',before,{stocktakeId:id,status:h.status,version:h.version,rowCount:owned.length},h.reason);
      }
      Object.assign(h,{updated_at:t,updated_by:actor});
      if(['POSTED','CANCELLED'].includes(h.status))for(const lock of locks.values())if(lock.stocktake_id===id)Object.assign(lock,{released_at:t,released_by:actor,release_reason:h.status,active_scope:null});
    }
    for(const [table,model] of Object.entries({inventory_stocktakes:headers,inventory_stocktake_bins:scopes,inventory_stocktake_lines:lines,inventory_bin_locks:locks,inventory_reservations:reservations,inventory_movements:movements})){
      assert.equal(rows[table].length,model.size,`Exact independent ${table} row union`);for(const row of rows[table]){const expected=model.get(Number(row.id));assert.ok(expected);stocktakeSoakAssertRow(row,expected,`${table}:${row.id}`);}
    }
    const remaining=new Map(),exportRows=[];
    let remainingCount=audits.length;
    const auditKey=(operationId,action,before,after)=>JSON.stringify([operationId,action,jsonKey(before),jsonKey(after)]);
    for(const expected of audits){
      const key=auditKey(expected.operationId,expected.action,expected.before,expected.after);
      let bucket=remaining.get(key);
      if(!bucket){bucket={items:[],cursor:0};remaining.set(key,bucket);}
      bucket.items.push(expected);
    }
    for(const row of rows.inventory_audit_logs){
      if(row.operation_request_id===null){exportRows.push(row);continue;}
      const bucket=remaining.get(auditKey(Number(row.operation_request_id),row.action,parse(row.before_summary),parse(row.after_summary)));
      assert.ok(bucket&&bucket.cursor<bucket.items.length,'Unexpected or duplicate command Audit');const expected=bucket.items[bucket.cursor++],r=expected.record;remainingCount--;
      stocktakeSoakAssertRow(row,{id:positive(row.id),occurred_at:when(row,r),actor_user_id:r.actorId,actor_label:r.actorLabel,action:expected.action,target_type:r.family==='RESERVATION'?'reservation':'stocktake',target_id:expected.targetId,target_label:expected.targetLabel,outcome:'SUCCEEDED',reason_category:'',reason_text:expected.reason,before_summary:expected.before,after_summary:expected.after,operation_request_id:expected.operationId,request_id:r.requestId,correlation_id:r.requestId,ip:''},`Audit:${row.id}`);
    }
    assert.equal(remainingCount,0,'Every expected command Audit persisted exactly once');
    return {headers,scopes,lines,locks,reservations,effects,controls,movements,exportRows};
  }
  async function verify({final=false,phase='MINUTE'}={}) {
    assert.equal(checking,false,'Single parent SQL oracle must not overlap snapshots');assert.ok(baseline?.status==='COMPLETE');checking=true;
    const started=performance.now(),sample={phase,final,startedAt:started,status:'IN_PROGRESS',seedCutoffs:Object.fromEntries(Object.entries(baseline.tables).map(([t,v])=>[t,v.lastId])),tables:{},committed:[]};
    report.soakReconciliations??=[];report.soakReconciliations.push(sample);
    try{if(final)assertDrained();const intentBefore=final?JSON.stringify([...commands.values()].map(r=>[r.sourceHash,r.dispatchAt,r.requestId,r.result,r.replays])):null;const work=async(db)=>{
      const snapshotEpoch=Date.now(),rows={};sample.snapshotEpoch=snapshotEpoch;sample.sqlMetrics=db.metrics;
      for(const table of stocktakeSoakTables()){
        rows[table]=[];const ids=[];const checked=await scanStocktakeSoakTable(db,table,baseline.tables[table].lastId,row=>{rows[table].push(row);ids.push(Number(row.id));});sample.tables[table]={...checked,checkedIds:ids,seedCutoff:baseline.tables[table].lastId};
      }
      const committed=rows.inventory_operation_requests.map(row=>matchOperation(row,snapshotEpoch));
      sample.committed=committed.map(op=>({operationId:op.operationId,requestId:op.record.requestId,sourceHash:op.record.sourceHash,observation:op.observation}));
      const seen=new Set();for(const op of committed){assert.equal(seen.has(op.record.sourceHash),false);seen.add(op.record.sourceHash);}
      const model=buildModel(rows,committed,snapshotEpoch);
      for(const table of ['inventory_allocations','inventory_bins','inventory_lots','inventory_purchase_reversal_links','inventory_stock_balances','inventory_stock_controls','inventory_transfer_lines','inventory_transfers','inventory_warehouses'])assert.equal(rows[table].length,0,`Foreign ${table} increment`);
      const exportResult=verifyStocktakeSoakExportAudit({rows:model.exportRows,intents:exportIntents,events:exportEvents(),live:!final});sample.exportAudit=exportResult;
      const touchedBins=new Set([...commands.values()].flatMap(r=>r.scope?.binIds??[])),touchedControls=new Set([...model.controls.keys()]);
      for(let warehouse=1;warehouse<=5;warehouse++){
        const bins=new Set([...touchedBins].filter(bin=>Math.floor((bin-1)/200)+1===warehouse));
        if(!bins.size)continue;
        for(let sku=1;sku<=50000;sku++)for(let leg=0;leg<2;leg++){
          const bin=(warehouse-1)*200+(Math.floor((sku-1)/4)+leg*100)%200+1;
          if(bins.has(bin))touchedControls.add(`${warehouse}:${sku}`);
        }
      }
      for(const id of model.effects.keys()){const b=stocktakeSoakSeedRow('inventory_stock_balances',{id},seed);touchedControls.add(`${b.warehouse_id}:${b.sku_id}`);}
      const seededTables=final?stocktakeSoakTables():['inventory_stock_balances','inventory_stock_controls'];sample.originalChecks={};
      for(const table of seededTables){
        if(!baseline.tables[table].count)continue;
        const immutable=createHash('sha256');const visit=row=>{
          immutable.update(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>!(['inventory_stock_balances','inventory_stock_controls'].includes(table)&&['on_hand_quantity','reserved_quantity','version','updated_at','fifo_anchor_date'].includes(key)))))+'\n');
          let expected=stocktakeSoakSeedRow(table,row,seed);
          if(table==='inventory_stock_balances'){const effect=model.effects.get(Number(row.id));if(effect)expected={...expected,...effect};assert.ok(expected.on_hand_quantity>=expected.allocated_quantity);}
          if(table==='inventory_stock_controls'){const effect=model.controls.get(`${row.warehouse_id}:${row.sku_id}`);if(effect)expected={...expected,...effect};}
          stocktakeSoakAssertRow(row,expected,`${table}:original:${row.id}`);
        };
        if(final)sample.originalChecks[table]=await scanStocktakeSoakTable(db,table,0,visit,baseline.tables[table].lastId);
        else {
          const ids=table==='inventory_stock_balances'?[...touchedBins]:[...touchedControls];let n=0;const digest=createHash('sha256');
          for(let offset=0;offset<ids.length;offset+=Math.min(200,ids.length-offset)){
            const group=ids.slice(offset,offset+200);if(!group.length)continue;
            const parameters=table==='inventory_stock_balances'?group:group.flatMap(key=>key.split(':').map(Number));
            const where=table==='inventory_stock_balances'?`bin_id IN (${group.map(()=>'?').join(',')})`:`(${group.map(()=>'(warehouse_id=? AND sku_id=?)').join(' OR ')})`;
            let after=0;for(;;){const [page]=await db.execute(`SELECT * FROM ${table} WHERE (${where}) AND id>? ORDER BY id LIMIT 500`,[...parameters,after]);assert.ok(page.length<=500);if(!page.length)break;for(const row of page){assert.ok(Number(row.id)>after);after=Number(row.id);visit(row);n++;digest.update(JSON.stringify(row)+'\n');}}
          }assert.equal(n,table==='inventory_stock_balances'?touchedBins.size*500:touchedControls.size,'Every touched independent seed dimension must be present');sample.originalChecks[table]={count:n,sha256:digest.digest('hex')};
        }
        if(final){assert.equal(immutable.digest('hex'),baseline.tables[table].immutableSha256,'Exact original immutable fields and identities remain unchanged');assert.equal(sample.originalChecks[table].count,baseline.tables[table].count,'Fresh final checks every original seeded row');if(!['inventory_stock_balances','inventory_stock_controls'].includes(table))assert.equal(sample.originalChecks[table].sha256,baseline.tables[table].sha256,'Every original immutable seed row identity and field is unchanged');}
      }
      // The known initial ledger is four independent 25-unit legs per Bucket. Every increment Movement was matched above to an independent count variance.
      const ledger=new Map(),eligibleChanges=new Map(),reservedByScope=new Map();
      for(const movement of model.movements.values()){const id=model.lines.get(movement.stocktake_line_id).stock_balance_id,prior=ledger.get(id)??{quantity:0,legs:0};prior.quantity+=movement.direction==='IN'?movement.quantity:-movement.quantity;prior.legs++;ledger.set(id,prior);}
      for(const [id,effect]of model.effects){const b=stocktakeSoakSeedRow('inventory_stock_balances',{id},seed),delta=ledger.get(id);assert.ok(delta);assert.equal(100+delta.quantity,effect.on_hand_quantity);assert.equal(4+delta.legs,effect.version);if(b.stock_status==='AVAILABLE'){const key=`${b.warehouse_id}:${b.sku_id}`;eligibleChanges.set(key,(eligibleChanges.get(key)??0)+effect.on_hand_quantity-100);}}
      for(const r of model.reservations.values()){const key=`${r.warehouse_id}:${r.sku_id}`;reservedByScope.set(key,(reservedByScope.get(key)??0)+r.outstanding_quantity);}
      for(const key of touchedControls){const eligible=100+(eligibleChanges.get(key)??0),reserved=reservedByScope.get(key)??0;assert.equal(reserved,model.controls.get(key)?.reserved_quantity??0);assert.ok(eligible>=reserved,'Per-Warehouse/SKU eligible ATP covers Reserved independently');}
      if(final){for(const record of commands.values()){for(const replay of record.replays??[]){if(replay.dispatchAt===null||replay.dispatchAt===undefined)continue;assert.ok(replay.result,'Final replay HTTP result unresolved');assert.equal(jsonKey(replay.result),jsonKey(record.result),'Original source replay result changed');}if(record.dispatchAt===null||record.dispatchAt===undefined)continue;assert.ok(record.result,'Final unresolved HTTP command');assert.ok(seen.has(record.sourceHash),'Final command has no committed original-source Operation');}assert.equal(exportResult.status,'COMPLETE');}
      if(final){assertDrained();assert.equal(JSON.stringify([...commands.values()].map(r=>[r.sourceHash,r.dispatchAt,r.requestId,r.result,r.replays])),intentBefore,'Drained intent/result set changed during full fresh verification');for(const table of stocktakeSoakTables()){const after=await scanStocktakeSoakTable(db,table,baseline.tables[table].lastId,()=>{});assert.equal(after.count,sample.tables[table].count,'Increment set changed during drained full read');assert.equal(after.sha256,sample.tables[table].sha256,'Increment content changed during drained full read');}sample.consistency='DRAINED_FULL_FRESH_WITH_EXACT_BEFORE_AFTER_INCREMENT_AND_INTENT_UNION';}
      sample.status='COMPLETE';sample.discrepancyCount=0;return {...sample,model};
    };return final?await work(stocktakeSoakReadDb(db)):await withStocktakeSoakSnapshot(db,work);}catch(error){sample.status='FAIL';sample.error={code:error.code??'ASSERTION_FAILED',name:error.name};throw error;}finally{sample.verificationMs=performance.now()-started;checking=false;}
  }
  return {register,matchOperation,verify,commands,get baseline(){return baseline;}};
}
export function createStocktakeSoakFixture(fixture, baseline) {
  return (async()=>{
    const {actors,workers,request,report,db}=fixture,seed=baseline.seed;
    fixture.mode='CS01';report.kind='DEVELOPER_CHARACTERIZATION';report.soakPreparation=[];
    const journal=fixture.cs01Journal;journal?.checkpoint('FIXTURE_PREPARATION','START');
    fixture.businessBaseline=baseline;fixture.soakExportIntents=new Map();fixture.soakScopes=new Map();
    const rolling=[{warehouseId:1,binIds:[20]},{warehouseId:1,binIds:[21]},{warehouseId:2,binIds:[220]},{warehouseId:2,binIds:[221]},{warehouseId:3,binIds:[420]},{warehouseId:4,binIds:[620]}];
    actors.filter(actor=>actor.writer).forEach((actor,index)=>fixture.soakScopes.set(actor.id,Object.freeze(rolling[index])));
    assert.equal(fixture.soakScopes.size,6);
    const oracle=createStocktakeSoakOracle({db,seed,actors,report,baseline,exportIntents:fixture.soakExportIntents,exportEvents:()=>workers.flatMap(worker=>worker.soakExportEvents??[]),assertDrained:()=>{assert.equal(preparedLane?.pending.size??0,0);if(fixture.soakLane){assert.equal(fixture.soakOffersStopped,true,'Offers must positively stop before final read');assert.equal(fixture.soakLane.pending.size,0,'All actual actor bodies must settle before final read');}}});fixture.soakOracle=oracle;
    let preparedLane=null,cleaning;
    const nextSetupDispatch=[0,0];
    const safe=()=>assert.equal(workers.some(worker=>worker.quarantined||worker.stopping||worker.stopped),false,'Unknown/quarantined/stopped worker forbids business cleanup');
    fixture.prepareRequest=async(actor,route,body,signed=false,intent=null,phase='SETUP',replayReceipt=null)=>{
      safe();
      // Preparation has its own explicit phase and spacing; it never consumes or changes a fixed steady offer.
      for(;;){
        const remaining=Math.max(nextSetupDispatch[actor.worker],(workers[actor.worker].soakLastDispatchAt??-Infinity)+125)-performance.now();
        if(remaining<=0)break;
        await setTimeout(Math.ceil(remaining));safe();
      }
      let receipt;
      const pending=preparedLane.offer(actor,0,performance.now(),{family:'PREPARATION',phase,route,body,signed,
        onOffer(offered){if(offered.family==='REFRESH')return;assert.ok(!intent||!replayReceipt);if(replayReceipt){replayReceipt.replays??=[];replayReceipt.replays.push({requestId:offered.requestId,phase});}if(intent){receipt=oracle.register({...intent,body:Object.fromEntries(Object.entries(body??{}).filter(([key])=>key!=='password')),actorId:actor.id,actorLabel:actor.username,requestId:offered.requestId});offered.sourceHash=receipt.sourceHash;}},
        onDispatch(offered){nextSetupDispatch[actor.worker]=offered.dispatchAt+125;if(receipt){receipt.dispatchAt=offered.dispatchAt;receipt.dispatchEpoch=Date.now();}if(replayReceipt)Object.assign(replayReceipt.replays.at(-1),{dispatchAt:offered.dispatchAt,dispatchEpoch:Date.now()});report.soakPreparation.push({phase,actorId:actor.id,requestId:offered.requestId,family:offered.family,dispatchAt:offered.dispatchAt,sourceHash:receipt?.sourceHash??null,replaySourceHash:replayReceipt?.sourceHash??null});}
      });
      const value=await pending.pending;if(pending.dispatchAt!==null)nextSetupDispatch[actor.worker]=Math.max(nextSetupDispatch[actor.worker],pending.dispatchAt+125);
      if(pending.family==='REFRESH')return fixture.prepareRequest(actor,route,body,signed,intent,phase,replayReceipt);
      assert.equal(pending.outcome,'COMPLETE');assert.equal(report.requests.find(row=>row.requestId===pending.requestId)?.requestIdEchoObservation,'MATCHED');
      assert.ok(value&&typeof value==='object','Adapter must expose consumed HTTP data value');
      if(receipt){receipt.result=value;receipt.completeEpoch=Date.now();const target=receipt.family==='RESERVATION'?fixture.reservationCommands:fixture.stocktakeCommands;target.set(value.operationId,receipt);}
      if(replayReceipt){assert.deepEqual(value,replayReceipt.result,'Original source replay changed the original result');Object.assign(replayReceipt.replays.at(-1),{result:value,completeEpoch:Date.now()});}
      return value;
    };
    async function checkpoint(){for(const worker of workers){assert.equal(typeof worker.soakExportCheckpoint,'function');const observed=await worker.soakExportCheckpoint();assert.equal(observed.status,'COMPLETE','Passive export observer evidence incomplete');}}
    fixture.reconcileBusinessCleanup=()=>cleaning??=(async()=>{
      const failures=[];let primary;
      const check=async(stage,work)=>{try{await work();}catch(error){primary??=error;failures.push({stage,error:{code:error.code??'ASSERTION_FAILED',name:error.name}});}};
      journal?.checkpoint('CLEANUP_BEFORE','START');
      await check('fresh-full-before-cleanup',async()=>{await checkpoint();await oracle.verify({final:true,phase:'BEFORE_CLEANUP'});});
      journal?.checkpoint('CLEANUP_BEFORE','END',{originalError:primary});
      const creates=[...oracle.commands.values()].filter(record=>record.family==='STOCKTAKE'&&record.action==='create'&&record.result);
      journal?.checkpoint('CLEANUP_STOCKTAKES','START',{total:creates.length});
      for(const create of creates)await check(`stocktake-${create.result.id}-cancel-and-replay`,async()=>{
        safe();const history=[...oracle.commands.values()].filter(record=>record.family==='STOCKTAKE'&&(record.targetId===create.result.id||record===create)&&record.result).sort((a,b)=>a.result.operationId-b.result.operationId),last=history.at(-1);
        if(['POSTED','CANCELLED'].includes(last.result.status))return;
        const actor=actors.find(actor=>actor.id===create.actorId),body={source:source(),expectedVersion:last.result.version,reason:'Owned CS01 cleanup',password:actor.password},route=`/api/v1/inventory/stocktakes/${create.result.id}/cancel`;
        await fixture.prepareRequest(actor,route,body,false,{action:'cancel',family:'STOCKTAKE',targetId:create.result.id,scope:create.scope,beforeStatus:last.result.status,expected:{status:'CANCELLED',version:last.result.version+1,rowCount:create.scope.binIds.length}},'CLEANUP');
        const receipt=[...oracle.commands.values()].find(record=>record.body.source.documentId===body.source.documentId);assert.ok(receipt);
        const before=await oracle.verify({final:false,phase:'BEFORE_STOCKTAKE_CANCEL_REPLAY'});await fixture.prepareRequest(actor,route,body,false,null,'CLEANUP',receipt);const after=await oracle.verify({final:false,phase:'AFTER_STOCKTAKE_CANCEL_REPLAY'});
        assert.deepEqual(after.tables,before.tables,'Cancel replay changed exact global post-seed row union');
      });
      journal?.checkpoint('CLEANUP_STOCKTAKES','END',{originalError:primary});
      journal?.checkpoint('CLEANUP_RESERVATIONS','START',{total:fixture.reservations.length});
      for(const reservation of fixture.reservations)await check(`reservation-${reservation.id}-cancel-and-replay`,async()=>{
        safe();const create=[...oracle.commands.values()].find(record=>record.family==='RESERVATION'&&record.action==='create'&&record.result?.id===reservation.id);assert.ok(create);
        const actor=actors.find(actor=>actor.id===create.actorId),body={source:source(),version:1},route=`/api/v1/inventory/reservations/${reservation.id}/cancel`;
        await fixture.prepareRequest(actor,route,body,false,{action:'cancel',family:'RESERVATION',targetId:reservation.id,scope:{warehouseId:create.body.warehouseId,binIds:[]},expected:{status:'CANCELLED',version:2}},'CLEANUP');
        const receipt=[...oracle.commands.values()].find(record=>record.body.source.documentId===body.source.documentId);const before=await oracle.verify({final:false,phase:'BEFORE_RESERVATION_CANCEL_REPLAY'});await fixture.prepareRequest(actor,route,body,false,null,'CLEANUP',receipt);const after=await oracle.verify({final:false,phase:'AFTER_RESERVATION_CANCEL_REPLAY'});assert.deepEqual(after.tables,before.tables,'Reservation replay changed exact global row union');
      });
      journal?.checkpoint('CLEANUP_RESERVATIONS','END',{originalError:primary});
      journal?.checkpoint('CLEANUP_AFTER','START');
      await check('fresh-full-after-cleanup',async()=>{await checkpoint();const final=await oracle.verify({final:true,phase:'AFTER_CLEANUP'});for(const lock of final.model.locks.values())assert.equal(lock.active_scope,null,'All owned locks must be released');for(const reservation of final.model.reservations.values())assert.equal(reservation.status,'CANCELLED');});
      journal?.checkpoint('CLEANUP_AFTER','END',{originalError:primary});
      report.soakBusinessCleanup={status:primary?'FAIL':'COMPLETE',failures,reservations:fixture.reservations.length};if(primary){primary.businessCleanupErrors=failures;throw primary;}return report.soakBusinessCleanup;
    })();
    oracle.cleanup=fixture.reconcileBusinessCleanup;
    for(const actor of actors){const login=await request(actor,'/api/v1/user/login',{username:actor.username,password:actor.password},true);actor.token=login.token;assert.equal(login.expiresInSeconds,900);const claims=JSON.parse(Buffer.from(login.token.split('.')[1],'base64url').toString('utf8'));assert.ok(Number.isSafeInteger(claims.iat)&&Number.isSafeInteger(claims.exp));actor.issuedAt=claims.iat*1000;actor.expiresAt=claims.exp*1000;assert.deepEqual([...login.user.permissions].sort(),(actor.writer?['inventory.adjust','inventory.operation','inventory.view']:['inventory.view']).sort());await setTimeout(126);}
    preparedLane=createStocktakeSoakLane({workers,actors,report,epoch:performance.now()+2700000});
    const writer=actors.find(actor=>actor.writer);
    for(let warehouseId=1;warehouseId<=5;warehouseId++)for(const skuId of [1,3,4]){
      const body={source:source(),warehouseId,skuId,quantity:1,purpose:'SALE',minimumRemainingDays:0};
      fixture.reservations.push(await fixture.prepareRequest(writer,'/api/v1/inventory/reservations/create',body,false,{action:'create',family:'RESERVATION',scope:{warehouseId,binIds:[]},expected:{status:'ACTIVE',version:1}},'SETUP'));
    }
    const scope={warehouseId:5,binIds:Array.from({length:200},(_,index)=>801+index)},body={source:source(),...scope,reason:'Fixed CS01 exporter snapshot'};
    const created=await fixture.prepareRequest(writer,'/api/v1/inventory/stocktakes/create',body,false,{action:'create',scope,expected:{status:'DRAFT',version:1,rowCount:200}},'SETUP');
    const started=await fixture.prepareRequest(writer,`/api/v1/inventory/stocktakes/${created.id}/start`,{source:source(),expectedVersion:1},false,{action:'start',targetId:created.id,scope,beforeStatus:'DRAFT',expected:{status:'COUNTING',version:2,rowCount:100000}},'SETUP');
    fixture.exportHeader={...started,warehouseId:5,binIds:scope.binIds,stocktakeNumber:`ST-${created.operationId}`};
    await oracle.verify({final:false,phase:'SETUP_COMPLETE'});journal?.checkpoint('FIXTURE_PREPARATION','END');return fixture;
  })();
}

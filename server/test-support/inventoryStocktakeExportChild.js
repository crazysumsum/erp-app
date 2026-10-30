import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";

// Instrument only native FS handles and existing SQL clients. HTTP is a real client.
const native = Object.fromEntries(["mkdtemp", "open", "unlink", "rmdir", "lstat", "readdir"].map(name => [name, fs[name].bind(fs)]));
let app, origin, actor, setting = {}, stopped = false, checkpointSequence = 0;
const gates = new Map(), requests = new Map(), pools = new Set(), handles = new Map(), connections = new Map();
let exportCount = 0, writes = 0, reads = 0, closed = 0, activeReaders = 0, maxReaders = 0, headerAt, schedulingElapsedMs;
let sqlSequence = 0;

function send(value) {
  return new Promise((resolve, reject) => {
    if (!process.connected) { reject(new Error("Owned parent disconnected")); return; }
    process.send(value, error => error ? reject(error) : resolve());
  });
}
const identity = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o7777,
  size: stat.size, nlink: stat.nlink, type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other" });
async function entry(name) {
  try { return identity(await native.lstat(name)); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function gate(stage, evidence = {}) {
  if (setting.checkpoint !== stage || setting.reached) return;
  setting.reached = true;
  const id = ++checkpointSequence;
  let resolve, reject;
  const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
  gates.set(id, { resolve, reject });
  await send({ type: "checkpoint", id, stage, pid: process.pid, ...evidence });
  try { await pending; } finally { gates.delete(id); }
}
async function observation(type, detail) { await send({ type, ...detail }); }
function sqlObservation(detail) {
  if (!setting.observeAudit) return;
  const context = app?.services.require("context").get();
  void send({ type: "sqlLifecycle", sequence: ++sqlSequence, atMs: performance.now(),
    requestSignalAborted: context?.signal?.aborted ?? null, ...detail }).catch(() => {});
}
function injected(operation) {
  if (setting.fail !== operation || setting.injected) return;
  setting.injected = true;
  const error = Object.assign(new Error("Explicit synthetic disk failure"), { code: setting.errno });
  return error;
}
async function fileEvidence(record) {
  return { file: record.name, directory: path.dirname(record.name), descriptor: identity(await record.stat()),
    fileEntry: await entry(record.name), directoryEntry: await entry(path.dirname(record.name)) };
}

fs.mkdtemp = async (...args) => {
  const directory = await native.mkdtemp(...args);
  if (path.dirname(directory) === await fs.realpath(os.tmpdir()) && path.basename(directory).startsWith("inventory-stocktake-export-")) {
    exportCount++;
    await observation("owned", { path: directory, identity: identity(await native.lstat(directory)) });
  }
  return directory;
};
fs.open = async (...args) => {
  const handle = await native.open(...args), name = String(args[0]);
  if (path.basename(name) !== "stocktake.csv" || path.dirname(path.dirname(name)) !== await fs.realpath(os.tmpdir())) return handle;
  assert.equal(args[1], "wx+");
  const record = { name, stat: handle.stat.bind(handle), closed: false, rows: 0, bytes: 0, summaryOffset: null, reads: 0 };
  handles.set(handle, record);
  await observation("owned", { path: name, identity: identity(await record.stat()) });
  const write = handle.writeFile.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
  handle.writeFile = async (...input) => {
    const text = Buffer.isBuffer(input[0]) ? input[0].toString("utf8") : String(input[0]);
    const summary = text.startsWith("SUMMARY,"), header = text.startsWith("recordType,");
    const kind = header ? "firstWrite" : summary ? "footer" : "write";
    const error = injected(kind);
    if (error) { await observation("injection", { operation: kind, errno: error.code }); throw error; }
    if (!record.bytes) {
      await observation("beforeFirstWrite", await fileEvidence(record));
      await gate("prewrite", await fileEvidence(record));
    }
    await write(...input);
    writes++;
    if (summary) record.summaryOffset = record.bytes;
    record.bytes += Buffer.byteLength(text);
    if (header) headerAt = performance.now();
    else if (!summary) record.rows += parse(text).filter(row => row[0] === "LINE").length;
    await observation("write", { kind, bytes: record.bytes, rows: record.rows, summaryOffset: record.summaryOffset, ...(await fileEvidence(record)) });
    if (header) await gate("header", await fileEvidence(record));
    if (record.rows >= 500 && !summary) await gate("batch", { rows: record.rows, ...(await fileEvidence(record)) });
    if (summary) await gate("summary", { generatedSize: record.bytes, summaryOffset: record.summaryOffset, ...(await fileEvidence(record)) });
  };
  handle.read = async (...input) => {
    if (record.reads === 1) await gate("secondRead", { nativeReadsStarted: record.reads, generatedSize: record.bytes, summaryOffset: record.summaryOffset });
    const error = injected("read");
    if (error) { await observation("injection", { operation: "read", errno: error.code }); throw error; }
    record.reads++; reads++;
    const result = await read(...input);
    await observation("read", { nativeRead: record.reads, bytesRead: result.bytesRead });
    if (record.reads === 1 && result.bytesRead) await gate("firstRead", { nativeReadsStarted: record.reads, bytesRead: result.bytesRead });
    return result;
  };
  handle.close = async () => {
    await close();
    assert.equal(record.closed, false, "owned descriptor closed twice"); record.closed = true; closed++;
    await observation("fileClosed", { path: name });
  };
  await gate("open", await fileEvidence(record));
  return handle;
};
for (const operation of ["unlink", "rmdir"]) fs[operation] = async (...args) => {
  const name = String(args[0]);
  const ours = operation === "unlink" ? [...handles.values()].find(record => record.name === name)
    : [...handles.values()].find(record => path.dirname(record.name) === name);
  if (!ours) return native[operation](...args);
  const error = injected(operation);
  if (error) { await observation("injection", { operation, errno: error.code }); throw error; }
  const result = await native[operation](...args);
  if (!ours.closed) {
    const proof = await fileEvidence(ours);
    await observation(operation, proof);
    await gate(operation === "unlink" ? "unlink" : "anonymous", proof);
  }
  return result;
};

const createPool = mysql.createPool.bind(mysql);
let poolSequence = 0;
mysql.createPool = (...args) => {
  const pool = createPool(...args), role = poolSequence++ === 0 ? "primary" : "reader";
  pools.add(pool);
  const getConnection = pool.getConnection.bind(pool), wrapped = new WeakSet();
  pool.getConnection = async (...input) => {
    const connection = await getConnection(...input);
    sqlObservation({ stage: "checkout", threadId: Number(connection.threadId), role });
    if (!wrapped.has(connection)) {
      wrapped.add(connection);
      const id = Number(connection.threadId);
      if (!connections.has(id)) {
        connections.set(id, { role, active: true });
        if (role === "reader") { activeReaders++; maxReaders = Math.max(maxReaders, activeReaders); }
        await observation("connection", { threadId: id, role, activeReaders });
        const raw = connection.connection ?? connection;
        const terminal = () => {
          const info = connections.get(id);
          if (info?.active) { info.active = false; if (role === "reader") activeReaders--; sqlObservation({ stage: "socketTerminal", threadId: id, role }); }
        };
        raw.once("end", terminal); raw.stream.once("close", terminal);
      }
      let audit;
      for (const method of ["beginTransaction", "commit", "rollback"]) {
        const original = connection[method].bind(connection);
        connection[method] = async (...values) => {
          sqlObservation({ stage: `${method}Started`, threadId: id, role, ...(audit ? { audit } : {}) });
          try {
            const result = await original(...values);
            sqlObservation({ stage: `${method}Completed`, threadId: id, role, ...(audit ? { audit } : {}) }); return result;
          } catch (error) {
            sqlObservation({ stage: `${method}Rejected`, threadId: id, role, ...(audit ? { audit } : {}), code: error?.code ?? "NO_CODE" }); throw error;
          }
        };
      }
      for (const method of ["query", "execute"]) {
        const original = connection[method].bind(connection);
        connection[method] = async (...values) => {
          const sql = typeof values[0] === "string" ? values[0] : values[0]?.sql ?? "";
          const category = /SELECT scope\.\*,bin\.bin_code/iu.test(sql) ? "scopeBatch"
            : /SELECT[\s\S]*FROM\s+inventory_stocktake_lines\b/iu.test(sql) ? "lineQuery"
              : /INSERT INTO inventory_audit_logs/iu.test(sql) ? "audit" : /SELECT 1 AS ok/iu.test(sql) ? "initialize"
                : /FROM users WHERE id|FROM roles r JOIN user_roles|SELECT DISTINCT p\.name|SELECT version FROM fr_token_versions/iu.test(sql) ? "authorization" : "other";
          if (role === "reader" && ["lineQuery", "initialize"].includes(category)) await observation("sqlAttempt", { threadId: id, category });
          if (category === "audit") {
            audit = { action: values[1]?.[3] ?? "unknown", outcome: values[1]?.[7] ?? "unknown" };
            sqlObservation({ stage: "auditStarted", threadId: id, role, audit });
          }
          let result;
          try { result = await original(...values); }
          catch (error) {
            if (category === "audit") sqlObservation({ stage: "auditRejected", threadId: id, role, audit, code: error?.code ?? "NO_CODE" });
            throw error;
          }
          if (category === "audit") {
            audit.insertId = Number(result[0].insertId);
            sqlObservation({ stage: "auditCompleted", threadId: id, role, audit });
          }
          if (role === "reader" && category === "lineQuery") await observation("lineSqlCompleted", { threadId: id, returnedRows: result[0].length });
          if (category === "authorization") await observation("authorizationSqlCompleted", { threadId: id, role });
          if (role === "reader" && category === "initialize") await gate("initialize", { threadId: id, nativeQueryCompleted: true });
          if (role === "reader" && category === "scopeBatch" && setting.processingDelay && !setting.processingInjected && result[0].length) {
            setting.processingInjected = true;
            const row = result[0][0], value = row.id;
            Object.defineProperty(row, "id", { enumerable: true, configurable: true, get() {
              Object.defineProperty(row, "id", { enumerable: true, configurable: true, writable: true, value });
              const until = headerAt + setting.processingDelay;
              while (performance.now() < until) { /* controlled real-row processing scheduling, no clock substitution */ }
              schedulingElapsedMs = performance.now() - headerAt;
              return value;
            } });
          }
          if (category === "audit") await observation("auditSqlCompleted", { threadId: id, outcome: values[1]?.[7] ?? "unknown", insertId: audit.insertId });
          return result;
        };
      }
    }
    return connection;
  };
  return pool;
};

function summarize(status, headers, body, ended, premature) {
  const text = body.toString("utf8"), csv = /^text\/csv/iu.test(String(headers["content-type"]));
  const result = { status, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), ended, premature,
    headers: Object.fromEntries(Object.entries(headers).filter(([name]) => /^(?:x-inventory-export-|cache-control|content-type|pragma)/u.test(name))) };
  if (csv && ended) {
    const rows = parse(text, { columns: true }), footer = rows.at(-1), lineIds = rows.filter(row => row.recordType === "LINE").map(row => row.lineId);
    result.csv = { records: rows.length, scopes: rows.filter(row => row.recordType === "SCOPE").length,
      lines: rows.filter(row => row.recordType === "LINE").length, footer,
      firstLineIds: lineIds.slice(0, 503), orderedLineIdsSha256: createHash("sha256").update(JSON.stringify(lineIds)).digest("hex"),
      stages: [...new Set(rows.map(row => row.varianceStage))],
      uncounted: rows.filter(row => row.recordType === "LINE" && row.countState === "UNCOUNTED").slice(0, 4).map(row => ({ actualQuantity: row.actualQuantity, varianceQuantity: row.varianceQuantity })),
      invalidUncounted: rows.filter(row => row.recordType === "LINE" && row.countState === "UNCOUNTED" && (row.actualQuantity !== "" || row.varianceQuantity !== "")).length,
      lineSamples: rows.filter(row => row.recordType === "LINE").slice(0, 4).map(row => ({ countState: row.countState, actualQuantity: row.actualQuantity, varianceQuantity: row.varianceQuantity })),
      unsafeCells: rows.filter(row => row.recordType === "LINE" && row.skuNameCurrent.startsWith("'=")).length };
  } else if (!csv && ended && body.length) {
    const value = JSON.parse(text);
    if (value.error) result.error = { code: value.error.code, message: value.error.message, keys: Object.keys(value.error) };
    else if (value.data) result.data = { id: value.data.id, version: value.data.version, status: value.data.status, total: value.data.total };
    result.safeError = !/SELECT |INSERT |stocktake\.csv|\/private\/|stack|password_hash/iu.test(text);
  }
  return result;
}

async function request(message) {
  assert.match(message.route, /^\/api\/v1\/inventory\/stocktakes(?:[/?]|$)/u);
  assert.ok(!requests.has(message.id));
  const token = app.services.require("jwt").issue({ roles: [actor.role], permissions: actor.permissions }, {
    subject: String(actor.id), version: await app.services.require("tokenRevocation").currentVersion(String(actor.id)), authTime: Math.floor(Date.now() / 1000)
  });
  await send({ type: "authorized", id: message.id });
  const body = message.body === undefined ? undefined : JSON.stringify(message.body), chunks = [];
  let response, finished = false, receivedBytes = 0, hasSummary = false, tail = Buffer.alloc(0);
  const done = async (ended, premature) => {
    if (finished) return; finished = true; requests.delete(message.id);
    await send({ type: "response", id: message.id, ...summarize(response?.statusCode ?? null, response?.headers ?? {}, Buffer.concat(chunks), ended, premature) });
  };
  const client = http.request(`${origin}${message.route}`, { method: body ? "POST" : "GET", agent: false,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Idempotency-Key": message.id } : {}) } }, incoming => {
    response = incoming;
    incoming.on("data", chunk => {
      chunks.push(chunk); receivedBytes += chunk.length;
      const sample = Buffer.concat([tail, chunk]); hasSummary ||= sample.includes(Buffer.from("\r\nSUMMARY,")); tail = sample.subarray(-10);
      void send({ type: "clientData", id: message.id, bytes: receivedBytes, hasSummary });
    });
    incoming.once("end", () => { void done(true, false); });
    incoming.once("aborted", () => { void done(false, true); });
    incoming.once("error", () => { void done(false, true); });
  });
  requests.set(message.id, client);
  client.once("error", () => { void done(false, true); });
  client.end(body);
}
async function state(id) {
  await send({ type: "state", id, exportCount, writes, reads, closed, openFiles: [...handles.values()].filter(record => !record.closed).length,
    activeReaders, maxReaders, connections: [...connections].map(([threadId, info]) => ({ threadId, ...info })),
    fdCount: (await native.readdir("/dev/fd")).length, resourceCounts: process.getActiveResourcesInfo().reduce((all, name) => ({ ...all, [name]: (all[name] ?? 0) + 1 }), {}), schedulingElapsedMs });
}
async function shutdown() {
  if (stopped) return; stopped = true;
  for (const gate of gates.values()) gate.reject(new Error("Owned parent disconnected"));
  for (const client of requests.values()) client.destroy();
  await app?.shutdown("task041_export_child_complete");
  for (const pool of pools) { try { await pool.end(); } catch { /* Parent independently verifies native SQL termination after exit. */ } }
}
process.on("disconnect", () => { void shutdown().finally(() => process.exit(0)); });
process.on("message", message => {
  if (message?.type === "release") { gates.get(message.id)?.resolve(); return; }
  void (async () => {
    if (message?.type === "boot") {
      assert.equal(app, undefined); actor = message.actor;
      assert.ok(Number.isSafeInteger(actor.id) && actor.id > 0);
      assert.ok(actor.permissions.every(value => ["inventory.view", "inventory.operation"].includes(value)));
      const { createApplication } = await import("../src/framework/application/createApplication.js");
      const { defaultConfigurationSource } = await import("../src/framework/configuration/applicationConfiguration.js");
      const config = defaultConfigurationSource();
      app = await createApplication({ configurationSource: { ...config,
        application: { ...config.application, host: "127.0.0.1", port: 0 }, database: { ...config.database, connectionLimit: 1 },
        inventory: { ...config.inventory, ...(message.inventory ?? {}) },
        logging: { ...config.logging, loggers: Object.fromEntries(Object.entries(config.logging.loggers).map(([name, value]) => [name, { ...value, enabled: false }])) } },
        handlerRegistryOptions: { moduleUrls: [new URL("../src/handlers/inventory/stocktakeHandlers.js", import.meta.url).href] } });
      const [[environment]] = await app.services.require("mysqldatabase").query("SELECT VERSION() AS version,DATABASE() AS schema_name,@@skip_networking AS isolated,@@datadir AS datadir");
      assert.deepEqual([environment.version, environment.schema_name, Number(environment.isolated)], ["26.7.0", process.env.DB_NAME, 1]);
      assert.equal(path.resolve(environment.datadir), path.join(path.dirname(process.env.DB_SOCKET_PATH), "data"));
      origin = (await app.start()).url;
      await send({ type: "ready", pid: process.pid, origin, runtime: process.version, euid: process.geteuid(), primaryLimit: app.services.require("mysqldatabase").config.connectionLimit });
    } else if (message?.type === "configure") {
      assert.equal(gates.size, 0); setting = { ...message.setting }; await send({ type: "configured", id: message.id });
    } else if (message?.type === "request") await request(message);
    else if (message?.type === "abort") requests.get(message.id)?.destroy();
    else if (message?.type === "state") await state(message.id);
    else if (message?.type === "stop") { await shutdown(); if (process.connected) process.disconnect(); }
  })().catch(async error => {
    if (process.connected) await send({ type: "fixtureError", code: /^[A-Z][A-Z0-9_]*$/u.test(error?.code ?? "") ? error.code : "FIXTURE_ERROR" });
  });
});

assert.equal(process.env.DB_INTEGRATION_TESTS, "1");
assert.equal(process.env.INVENTORY_STOCKTAKE_EXPORT_RECOVERY_TESTS, "1");
assert.match(process.version, /^v26\./u);
assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task041_export_[a-z0-9_]+$/u);
assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task041-export-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
assert.equal(process.env.DB_USER, "root"); assert.equal(process.env.DB_PASSWORD, "");
assert.ok(process.connected);
assert.equal(await fs.realpath(os.tmpdir()), await fs.realpath(process.env.TMPDIR));
assert.equal((await native.lstat(process.env.TMPDIR)).mode & 0o7777, 0o700);
await send({ type: "initialized", pid: process.pid });

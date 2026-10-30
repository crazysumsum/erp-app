import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { createStocktakeExportAudit } from "../../src/modules/inventory/inventoryStocktakeExportAudit.js";
import { InventoryAuditService } from "../../src/modules/inventory/InventoryAuditService.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1";
const native = (name, work) => test(name, { skip: !enabled, timeout: 90000 }, work);
const OWNER = new AsyncLocalStorage(), ISSUANCE = new AsyncLocalStorage();
const records = [], root = "/api/v1/inventory/stocktakes";
function latch() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(work, message, timeout = 10000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const value = await work(Math.max(1, Math.floor(end - performance.now()))); assert.ok(performance.now() < end, message); if (value) return value; await delay(10); }
  throw new Error(message);
}
async function fixture(t, { pool = 10, lines = 1 } = {}) {
  assert.ok(/^erp_inventory_[a-z0-9_]+$/u.test(process.env.DB_NAME ?? "") || (process.env.CI === "true" && process.env.DB_NAME === "erp_dev"), "Owned isolated schema or fresh CI database required");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), run = process.env.HARNESS_RUN_DIR ?? await fs.mkdtemp(path.join(os.tmpdir(), "inventory-audit-test-"));
  const config = defaultConfigurationSource(), f = { tag, calls: [], signals: [], ids: new Set(), sockets: [], readers: [], handles: [], closed: false, lineCount: lines, beforeClose: [], statements: [], acquisitions: [], streamErrors: [], handlerErrors: [], transports: new Map() };
  const logging = { ...config.logging, loggers: Object.fromEntries(Object.entries(config.logging.loggers).map(([key, value]) => [key, { ...value, directory: path.join(run, tag, key) }])) };
  const moduleUrl = new URL("../../src/handlers/inventory/stocktakeHandlers.js", import.meta.url).href;
  let observer = null;
  t.after(async () => {
    const errors = [];
    try { if (f.close) await f.close(); else await f.app?.shutdown("failure_audit_fixture_setup_failed"); } catch (error) { errors.push(error); }
    try { await observer?.end(); } catch (error) { errors.push(error); }
    records.push({ tag, ids: [...f.ids], primarySocketTerminal: f.sockets.map(socket => socket.destroyed), readerTerminal: f.readers.map(reader => reader.closed), calls: f.calls, statements: f.statements, acquisitions: f.acquisitions, ...f.observation });
    if (process.env.HARNESS_RUN_DIR) await fs.writeFile(path.join(run, "failure-audit-native-observations.json"), JSON.stringify(records, null, 2));
    if (!process.env.HARNESS_RUN_DIR) await fs.rm(run, { recursive: true });
    if (errors.length) throw new AggregateError(errors, "Failure Audit fixture cleanup failed");
  });
  f.app = await createApplication({ configurationSource: { ...config, logging, database: { ...config.database, connectionLimit: pool },
    application: { ...config.application, host: "127.0.0.1", port: 0 }, jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } },
    handlerRegistryOptions: { moduleUrls: [moduleUrl], moduleLoader: async url => {
      const original = await import(url);
      class ObservedExport extends original.ExportInventoryStocktakeHandler {
        constructor(services) {
          super(services); f.handler = this;
          for (const [target, audit] of [["DOMAIN", this.exports.audit], ["ROUTE", this.audit]]) {
            for (const method of ["recordSucceeded", "recordFailed", "recordRejected"]) {
              const call = audit[method].bind(audit);
              audit[method] = (...args) => {
                const input = args.at(-1), entry = { target, method, errorCode: input.errorCode, requestId: input.requestId, targetId: input.targetId ?? null, targetLabel: input.targetLabel, actor: input.actorUserId, actorLabel: input.actorLabel };
                f.calls.push(entry); const result = call(...args);
                Promise.resolve(result).then(value => { entry.settled = true; entry.result = value === undefined ? "UNDEFINED" : value; }, error => { entry.settled = true; entry.error = error.code ?? error.name; });
                return result;
              };
            }
          }
          const make = this.exports.createGenerationReader.bind(this.exports);
          this.exports.createGenerationReader = signal => {
            const reader = make(signal), initialize = reader.initialize.bind(reader); f.readers.push(reader);
            reader.initialize = async () => { const database = await initialize(); f.trackPool(database.pool); return database; }; return reader;
          };
          const prepare = this.exports.prepare.bind(this.exports);
          this.exports.prepare = (...args) => {
            const result = OWNER.run(f, () => prepare(...args));
            result.then(value => { value.stream.on("error", error => f.streamErrors.push(error)); }, () => {});
            return result;
          };
          const failed = this.auditFailure.bind(this);
          this.auditFailure = (req, error) => { f.handlerErrors.push(error); return failed(req, error); };
        }
        execute(req, res) { f.requestAuditIp = req.ip ?? ""; f.signals.push(req.requestTimeout.signal); return super.execute(req, res); }
      }
      return { ...original, ExportInventoryStocktakeHandler: ObservedExport };
    } } });
  f.db = f.app.services.require("mysqldatabase"); f.time = f.app.services.require("time"); f.context = f.app.services.require("context");
  const connections = new WeakSet();
  const track = connection => {
    if (connections.has(connection)) return; connections.add(connection);
    const id = Number(connection.threadId); f.ids.add(id); f.sockets.push(connection.stream); f.transports.set(id, connection.stream);
    for (const method of ["query", "execute"]) {
      const original = connection[method].bind(connection);
      connection[method] = (...args) => {
        f.statements.push({ id, method, auditRequestId: ISSUANCE.getStore() ?? null, sql: typeof args[0] === "string" ? args[0] : args[0]?.sql, at: performance.now() });
        return original(...args);
      };
    }
  };
  f.trackPool = pool => {
    const acquire = pool.getConnection.bind(pool);
    pool.getConnection = (...args) => { f.acquisitions.push({ auditRequestId: ISSUANCE.getStore() ?? null, at: performance.now() }); return acquire(...args); };
    pool.pool._allConnections.toArray().forEach(track); pool.pool.on("connection", track);
  };
  f.trackPool(f.db.pool);
  observer = await mysql.createConnection({ socketPath: process.env.DB_SOCKET_PATH, host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  f.observer = observer;
  for (const method of ["query", "execute"]) {
    const original = observer[method].bind(observer);
    observer[method] = (sql, values) => original(typeof sql === "string" ? { sql, timeout: 1000 } : sql, values);
  }
  const [[version]] = await observer.query("SELECT VERSION() AS version"); assert.equal(version.version, "26.7.0");
  const insert = async (sql, values = []) => Number((await observer.execute(sql, values))[0].insertId), now = Date.now();
  f.user = await insert("INSERT INTO users(username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic Audit',?,?)", [`fa-${tag}`, "unused synthetic hash", now, now]);
  f.role = await insert("INSERT INTO roles(name,created_at) VALUES (?,?)", [`fa-${tag}`, now]);
  await observer.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)", [f.user, f.role]);
  await observer.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.view'", [f.role]);
  const warehouse = await insert("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?, ?,?)", [`FA${tag}`, `fa${tag}`, "Synthetic Audit", now, now]);
  const bin = await insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,'A','a',?,?)", [warehouse, now, now]);
  const operation = await insert("INSERT INTO inventory_operation_requests(command_type,source_module,source_document_type,source_document_id,source_event_id,request_hash,actor_user_id,actor_label,created_at) VALUES ('stocktake.create','INVENTORY','STOCKTAKE',?,? ,?,?,'Synthetic Audit',?)", [tag, tag, "0".repeat(64), f.user, now]);
  f.stocktake = await insert("INSERT INTO inventory_stocktakes(stocktake_number,warehouse_id,status,create_operation_id,created_at,updated_at,started_at) VALUES (?,?,'COUNTING',?,?,?,?)", [`FA${tag}`, warehouse, operation, now, now, now]);
  const scope = await insert("INSERT INTO inventory_stocktake_bins(stocktake_id,bin_id,bin_code_snapshot,created_at) VALUES (?,?,'A',?)", [f.stocktake, bin, now]);
  const uom = await insert("INSERT INTO item_uoms(code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", [`F${tag}`, now, now]);
  const item = await insert("INSERT INTO items(name,product_type,status,created_at,updated_at) VALUES ('Synthetic Audit','standard','active',?,?)", [now, now]);
  for (let i = 0; i < lines; i++) {
    const sku = await insert("INSERT INTO item_skus(item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,?,'none',1,1,1,'active',?,?)", [item, `FA${tag}-${i}`, "商品".repeat(90), now, now]);
    await observer.execute("INSERT INTO item_sku_uoms(sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [sku, uom, now, now]);
    await observer.execute("INSERT INTO inventory_stocktake_lines(stocktake_id,stocktake_bin_id,bin_id,sku_id,stock_status,snapshot_quantity,counted_quantity) VALUES (?,?,?,?,'AVAILABLE',0,1)", [f.stocktake, scope, bin, sku]);
  }
  f.origin = (await f.app.start()).url;
  f.token = f.app.services.require("jwt").issue({ roles: [`fa-${tag}`], permissions: ["inventory.view"] }, { subject: String(f.user), version: await f.app.services.require("tokenRevocation").currentVersion(String(f.user)), authTime: Math.floor(Date.now() / 1000) });
  f.input = requestId => ({ actorUserId: f.user, actorLabel: `fa-${tag}`, action: "inventory.export", targetType: "stocktake", targetId: f.stocktake,
    targetLabel: `stocktake:${f.stocktake}`, requestId, correlationId: requestId, ip: "" });
  f.audit = (logger = f.handler.logger) => createStocktakeExportAudit({ database: f.db, logger, time: f.time });
  f.cancelled = work => { const controller = new AbortController(); controller.abort(new Error("Client disconnected")); return f.context.storage.run({ signal: controller.signal }, () => work(controller.signal)); };
  f.rows = async requestId => (await observer.execute("SELECT * FROM inventory_audit_logs WHERE request_id=? ORDER BY id", [requestId]))[0];
  f.pending = async (remaining = 1000) => (await observer.query({ sql: "SELECT ID,COMMAND,STATE,INFO FROM information_schema.PROCESSLIST WHERE DB=?", timeout: Math.min(1000, remaining) }, [process.env.DB_NAME]))[0].filter(row => f.ids.has(Number(row.ID)) && row.COMMAND !== "Sleep");
  f.close = async () => {
    if (f.closed) return;
    const cleanup = f.beforeClose.splice(0).reverse(), errors = [];
    for (const release of cleanup) { try { await release(); } catch (error) { errors.push(error); } }
    await f.app.shutdown("failure_audit_small_test_complete");
    if (errors.length) throw new AggregateError(errors, "Owned barrier/client cleanup failed");
    await until(() => f.sockets.every(socket => socket.destroyed), "Owned primary sockets did not close");
    await until(async remaining => (await observer.query({ sql: "SELECT ID FROM information_schema.PROCESSLIST WHERE DB=?", timeout: Math.min(1000, remaining) }, [process.env.DB_NAME]))[0].every(row => !f.ids.has(Number(row.ID))), "Owned primary SQL sessions remained");
    assert.ok(f.readers.every(reader => reader.closed), "Owned generation reader not terminal");
    for (const handle of f.handles) await assert.rejects(handle.stat(), { code: "EBADF" });
    f.closed = true;
  };
  return f;
}
function observeReads(t, f, mode) {
  const opened = fs.open.bind(fs), entered = latch(), released = latch(); let reads = 0;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await opened(...args);
    if (OWNER.getStore() === f && args[1] === "wx+" && path.basename(String(args[0])) === "stocktake.csv") {
      f.handles.push(handle); const read = handle.read.bind(handle);
      handle.read = async (...values) => {
        reads++;
        if (reads === 2) { entered.resolve(); await released.promise; if (mode === "fault") { f.sourceError = Object.assign(new Error("controlled native source read failure"), { code: "EIO" }); throw f.sourceError; } }
        const result = await read(...values);
        if (reads === 1) { f.firstRead = result.bytesRead; f.fileSize = (await handle.stat()).size; }
        return result;
      };
    }
    return handle;
  });
  f.beforeClose.push(() => released.resolve()); return { entered, released };
}
function client(f) {
  const complete = latch(), first = latch(), state = { bytes: 0, ended: false };
  const req = http.get(`${f.origin}${root}/${f.stocktake}/export`, { headers: { Authorization: `Bearer ${f.token}` } }, res => {
    state.status = res.statusCode; f.responseHeaders = res.headers; f.clientIp = req.socket.localAddress; res.on("data", bytes => { state.bytes += bytes.length; first.resolve(); });
    res.on("end", () => { state.ended = true; complete.resolve(); }); res.on("close", () => complete.resolve()); res.on("error", () => complete.resolve());
  });
  req.on("socket", socket => {
    const capture = () => { f.clientIp = socket.localAddress; };
    if (socket.connecting) socket.once("connect", capture); else capture();
  });
  req.on("error", () => { first.resolve(); complete.resolve(); }); f.beforeClose.push(() => req.destroy()); return { req, state, first: first.promise, complete: complete.promise };
}
async function expectedRows(f, requestId, expected) {
  const rows = await until(async () => { const value = await f.rows(requestId); return value.length >= expected.length && value; }, "Exact Audit rows were not persisted");
  assert.deepEqual(rows.map(row => [row.target_id === null ? null : Number(row.target_id), row.outcome]), expected);
  for (const row of rows) {
    assert.equal(Number(row.actor_user_id), f.user); assert.equal(row.action, "inventory.export"); assert.equal(row.target_type, "stocktake"); assert.equal(row.request_id, requestId); assert.equal(row.correlation_id, requestId);
    assert.equal(row.target_label, row.target_id === null ? `${root}/:id/export` : `stocktake:${f.stocktake}`); assert.equal(row.actor_label, row.target_id === null ? `user:${f.user}` : `fa-${f.tag}`);
    assert.equal(row.operation_request_id, null); assert.equal(row.before_summary, null); assert.equal(row.ip, row.target_id === null ? "" : f.requestAuditIp);
    if (row.outcome === "SUCCEEDED") {
      const budget = Number(f.responseHeaders["x-inventory-export-generation-budget-ms"]); assert.ok(Number.isSafeInteger(budget) && budget > 0 && budget <= 60000);
      const hash = createHash("sha256").update(JSON.stringify({ stocktakeId: f.stocktake, filters: {} })).digest("hex");
      assert.equal(row.reason_category, "EXPORT"); assert.equal(row.reason_text, `filterHash=${hash};truncated=false;reason=NONE;budgetMs=${budget}`);
      assert.deepEqual(row.after_summary, { stocktakeId: f.stocktake, rowCount: 1 + f.lineCount, version: 1, status: "COUNTING" });
    } else {
      assert.equal(row.reason_category, ""); assert.equal(row.reason_text, ""); assert.equal(row.after_summary, null);
    }
  }
  const calls = f.calls.filter(call => call.requestId === requestId);
  await until(() => calls.every(call => call.settled), "Observed Audit promise did not settle");
  assert.ok(calls.every(call => call.method === "recordSucceeded" ? call.result === "UNDEFINED" : call.result === true), "Strict original Audit return oracle remains true-only");
  return rows;
}
async function streamScenario(t, options = {}) {
  const f = await fixture(t, { pool: options.pool ?? 10, lines: 128 }), barrier = observeReads(t, f, options.mode), c = client(f);
  await c.first; assert.equal(c.state.status, 200); await barrier.entered.promise; assert.ok(f.fileSize > f.firstRead && f.firstRead > 0); assert.equal(c.state.ended, false);
  await until(() => c.state.bytes === f.firstRead, "First native chunk not fully delivered to client"); const before = c.state.bytes;
  if (options.mode === "revoke") await f.observer.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=(SELECT id FROM permissions WHERE name='inventory.view')", [f.role]);
  if (!options.mode) { c.req.destroy(); await until(() => f.signals.some(signal => signal.aborted), "Original HTTP close did not cancel request"); }
  barrier.released.resolve(); await c.complete;
  await until(() => f.calls.some(call => call.target === "ROUTE" && call.method !== "recordSucceeded"), "Original ROUTE failure was not observed");
  const id = f.calls.find(call => call.target === "DOMAIN" && call.method === "recordSucceeded").requestId;
  await expectedRows(f, id, [[f.stocktake, "SUCCEEDED"], [f.stocktake, "FAILED"], [null, options.mode === "revoke" ? "REJECTED" : "FAILED"]]);
  assert.equal(c.state.bytes, before); assert.equal(c.state.ended, false);
  if (options.mode === "fault") { assert.ok(f.streamErrors.includes(f.sourceError)); assert.ok(f.handlerErrors.includes(f.sourceError)); assert.equal(f.sourceError.code, "EIO"); }
  if (options.mode === "revoke") { const error = f.streamErrors.find(value => value.code === "PERMISSION_STALE"); assert.ok(error); assert.equal(error.statusCode, 403); assert.ok(f.handlerErrors.includes(error)); }
  await f.close(); return f;
}

native("FAD01 real independent writes preserve DOMAIN/ROUTE fields and caller success transaction", async t => {
  const f = await fixture(t), audit = f.audit(), requestId = randomUUID();
  await f.cancelled(async original => { assert.equal(await audit.recordFailed(f.input(requestId)), true); assert.equal(original.aborted, true); });
  assert.equal(await audit.recordRejected({ ...f.input(requestId), targetId: null, targetLabel: `${root}/:id/export`, actorLabel: `user:${f.user}` }), true);
  const rows = await f.rows(requestId); assert.deepEqual(rows.map(row => row.outcome), ["FAILED", "REJECTED"]); assert.deepEqual(rows.map(row => row.target_id === null ? null : Number(row.target_id)), [f.stocktake, null]);
  for (const row of rows) { assert.equal(row.actor_user_id, f.user); assert.equal(row.request_id, requestId); assert.equal(row.correlation_id, requestId); assert.equal(row.operation_request_id, null); assert.equal(row.before_summary, null); assert.equal(row.after_summary, null); assert.equal(row.reason_category, ""); assert.equal(row.reason_text, ""); assert.equal(row.ip, ""); }
  const success = randomUUID(); await f.db.withTransaction(tx => audit.recordSucceeded(tx, f.input(success))); assert.equal((await f.rows(success))[0].outcome, "SUCCEEDED");
});
native("FAD02 real incomplete HTTP client abort persists exact original Audit row multiset", async t => { await streamScenario(t); });
native("FAD03 real source error preserves failure and exact DOMAIN/ROUTE Audit and cleanup", async t => { await streamScenario(t, { mode: "fault" }); });
native("FAD04 real permission revoke sends zero additional CSV bytes and persists exact failure/rejection", async t => { await streamScenario(t, { mode: "revoke" }); });
native("FAD05 actual pool1 HTTP abort uses existing primary and closes original reader/files", async t => { await streamScenario(t, { pool: 1 }); });
native("FAD06 real blocked acquisition deadline cannot admit a second waiter before release", async t => {
  const f = await fixture(t, { pool: 1 }), held = await f.db.pool.getConnection(); let released = false;
  f.beforeClose.push(() => { if (!released) { held.release(); released = true; } });
  const requestId = randomUUID(), lateAcquisition = { calls: 0, returned: false }, acquire = f.db.pool.getConnection.bind(f.db.pool);
  // Observe only this Audit waiter; normal scheduler borrowers keep their original behavior.
  f.db.pool.getConnection = (...args) => {
    const ownAudit = ISSUANCE.getStore() === requestId, pending = acquire(...args);
    if (ownAudit) {
      lateAcquisition.calls++;
      void pending.then(connection => {
        lateAcquisition.connectionId = Number(connection.threadId);
        const release = connection.release;
        connection.release = (...values) => {
          connection.release = release;
          const result = release.apply(connection, values);
          lateAcquisition.returned = true;
          return result;
        };
      }, error => { lateAcquisition.error = error.code ?? error.name; });
    }
    return pending;
  };
  const audit = f.audit(), started = performance.now(), pending = ISSUANCE.run(requestId, () => f.cancelled(() => audit.recordFailed(f.input(requestId))));
  await until(() => f.db.pool.pool._connectionQueue.length === 1, "Actual pool waiter not observed"); assert.equal(await pending, false);
  const elapsed = performance.now() - started; assert.ok(elapsed >= 4900 && elapsed < 6500, `Own5s deadline actual elapsed ${elapsed}`);
  const queueBefore = f.db.pool.pool._connectionQueue.length, refusedId = randomUUID();
  const refused = ISSUANCE.run(refusedId, () => f.audit().recordFailed(f.input(refusedId)));
  assert.equal(f.db.pool.pool._connectionQueue.length, queueBefore, "Synchronous refusal must add no waiter despite independent background borrowers"); assert.equal(await refused, false);
  assert.deepEqual(f.acquisitions.filter(value => value.auditRequestId === refusedId), [], "Refused Audit acquired after an await");
  held.release(); released = true; await until(() => f.db.pool.pool._connectionQueue.length === 0, "Late pool waiter not returned"); assert.deepEqual(await f.rows(requestId), []);
  await until(() => lateAcquisition.returned, "Timed-out Audit waiter was not returned to its original pool");
  assert.equal(lateAcquisition.calls, 1); assert.equal(lateAcquisition.connectionId, Number(held.threadId));
  assert.equal(lateAcquisition.error, undefined);
  assert.equal(await f.audit().recordFailed(f.input(randomUUID())), false);
  assert.deepEqual(f.acquisitions.filter(value => value.auditRequestId === refusedId), [], "Refused Audit acquired after blocker release");
  assert.deepEqual(f.statements.filter(value => value.auditRequestId === refusedId), []);
  assert.deepEqual(f.statements.filter(statement => statement.auditRequestId === requestId), [], "Cancelled late acquisition issued SQL");
  f.observation = { deadlineElapsedMs: elapsed, initialOwnWaiter: 1, actualQueueBeforeRelease: queueBefore, queueAfterRelease: 0, lateAcquisition };
});
native("FAD07 real FK lock blocks Audit INSERT; own deadline and SQL terminal are independently checked", async t => {
  const f = await fixture(t);
  const hold = await mysql.createConnection({ socketPath: process.env.DB_SOCKET_PATH, host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  f.beforeClose.push(async () => { await hold.rollback(); await hold.end(); }); await hold.beginTransaction(); await hold.query("SELECT id FROM users WHERE id=? FOR UPDATE", [f.user]);
  const requestId = randomUUID(), started = performance.now(), pending = f.audit().recordFailed(f.input(requestId));
  const victim = await until(async remaining => (await f.pending(remaining)).find(row => /INSERT INTO inventory_audit_logs/u.test(row.INFO ?? "")), "Actual blocked Audit INSERT not observed");
  assert.equal(await pending, false); const elapsed = performance.now() - started;
  assert.ok(elapsed >= 4900 && elapsed < 6500, `Own5s INSERT deadline actual elapsed ${elapsed}`);
  const beforeRelease = (await f.observer.query({ sql: "SELECT ID,COMMAND,STATE FROM information_schema.PROCESSLIST WHERE ID=?", timeout: 1000 }, [victim.ID]))[0];
  assert.equal(await f.audit().recordFailed(f.input(randomUUID())), false, "Public false must keep quarantine even while server work is unproven");
  const transport = f.transports.get(Number(victim.ID)); assert.ok(transport); const transportAtPublicReturn = { destroyed: transport.destroyed, writableEnded: transport.writableEnded };
  // The test's own FK blocker can keep server SQL waiting after transport abort. Release it before terminal proof, never label the public timeout rollback.
  await hold.rollback();
  await until(async remaining => (await f.observer.query({ sql: "SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?", timeout: Math.min(1000, remaining) }, [victim.ID]))[0].length === 0, "Failed Audit session remained after own blocker release"); assert.deepEqual(await f.rows(requestId), []); assert.equal(await f.audit().recordFailed(f.input(requestId)), false); f.observation = { actualBlockedInsertObserved: true, elapsedMs: elapsed, transportAtPublicReturn, transportAfterBlockerRelease: { destroyed: transport.destroyed }, preReleaseServerState: beforeRelease, preReleaseTerminal: beforeRelease.length ? "UNPROVEN_NOT_ROLLBACK" : "SESSION_ABSENT", disappearedVictimId: Number(victim.ID), auditRows: 0 };
});
native("FAD08 labelled native COMMIT ack-loss injection remains unknown, persisted row is not retried", async t => {
  const f = await fixture(t), original = f.db.pool.getConnection.bind(f.db.pool); let commits = 0;
  t.mock.method(f.db.pool, "getConnection", async () => { const connection = await original(), commit = connection.commit.bind(connection); connection.commit = async () => { await commit(); commits++; throw Object.assign(new Error("controlled acknowledgement loss after actual COMMIT"), { code: "PROTOCOL_CONNECTION_LOST" }); }; return connection; });
  const requestId = randomUUID(), audit = f.audit(); assert.equal(await audit.recordFailed(f.input(requestId)), false); assert.equal(commits, 1); assert.equal((await f.rows(requestId)).length, 1);
  assert.equal(await audit.recordFailed(f.input(requestId)), false); assert.equal(commits, 1); f.observation = { faultInjection: "COMMIT_ACK_LOSS_AFTER_REAL_COMMIT", publicResult: false, persistedRows: 1, outcomeClassification: "UNKNOWN_COMMIT_NOT_ROLLBACK", retries: 0 };
});
native("FAD09 real FK error and stalled logger share deadline; late settlement cannot reset quarantine", async t => {
  const f = await fixture(t), gate = latch(), entered = latch(); let original;
  const audit = f.audit({ error: (_event, _message, context) => { original = context; entered.resolve(); return gate.promise; } }); f.beforeClose.push(() => gate.resolve());
  const requestId = randomUUID(), started = performance.now(), pending = audit.recordFailed({ ...f.input(requestId), actorUserId: Number.MAX_SAFE_INTEGER }); await entered.promise;
  assert.equal(await pending, false); const elapsed = performance.now() - started; assert.ok(elapsed >= 4900 && elapsed < 6500, `Own5s logger deadline actual elapsed ${elapsed}`); f.observation = { elapsedMs: elapsed }; assert.equal(original.databaseErrorCode, "ER_NO_REFERENCED_ROW_2"); gate.resolve(); await delay(0);
  assert.equal(await f.audit().recordFailed(f.input(requestId)), false); assert.deepEqual(await f.rows(requestId), []); assert.equal((await f.pending()).length, 0);
});
native("FAD10 real overlapping failures retain exact admitted/busy results with no queued write", async t => {
  const f = await fixture(t), gate = latch(), original = f.db.withTransaction.bind(f.db); let admitted = false;
  t.mock.method(f.db, "withTransaction", (work, options) => original(async (...args) => { admitted = true; await gate.promise; return work(...args); }, options)); f.beforeClose.push(() => gate.resolve());
  const id = randomUUID(), busy = randomUUID(), pending = f.audit().recordFailed(f.input(id)); await until(() => admitted, "Actual transaction did not start");
  assert.equal(await f.audit().recordFailed(f.input(busy)), false); gate.resolve(); assert.equal(await pending, true); assert.equal((await f.rows(id)).length, 1); assert.deepEqual(await f.rows(busy), []);
  f.observation = { admittedResult: true, busyResult: false, strictCS01WouldFailForBusy: true };
});
native("FAD11 actual shutdown keeps original process budget and refuses new failed Audit after primary closes", async t => {
  const f = await fixture(t, { pool: 1 }), hold = await f.db.pool.getConnection(), id = randomUUID(), pending = f.audit().recordFailed(f.input(id));
  f.beforeClose.push(() => { if (!hold.connection.stream.destroyed) hold.release(); }); await until(() => f.db.pool.pool._connectionQueue.length === 1, "Queued own acquisition absent");
  const budget = f.app.configuration.application.shutdownTimeoutMs; assert.equal(budget, defaultConfigurationSource().application.shutdownTimeoutMs); const started = performance.now(), close = f.app.shutdown("failure_audit_shutdown_race"); await until(() => f.db.closed, "Actual primary did not enter shutdown"); assert.equal(await f.audit().recordFailed(f.input(randomUUID())), false);
  assert.equal(await pending, false); await close; const elapsed = performance.now() - started; assert.ok(elapsed < budget, `Shutdown ${elapsed} exceeded original ${budget}`); await f.close(); const rows = await f.rows(id); assert.equal(rows.length, 0); f.observation = { shutdownResult: "CLOSED_WITHOUT_PERSISTENCE_GUARANTEE", configuredBudgetMs: budget, actualShutdownMs: elapsed, rowCount: 0 };
});
native("FAD12 actual busy503 keeps two failure targets; clean success and generic Audit cancellation unchanged", async t => {
  const f = await fixture(t), entered = latch(), release = latch(), opened = fs.open.bind(fs); f.beforeClose.push(() => release.resolve());
  t.mock.method(fs, "open", async (...args) => { const handle = await opened(...args); if (OWNER.getStore() === f && args[1] === "wx+" && path.basename(String(args[0])) === "stocktake.csv") {
    f.handles.push(handle); const write = handle.writeFile.bind(handle); handle.writeFile = async (...values) => { entered.resolve(); await release.promise; return write(...values); }; } return handle; });
  const before = (await f.observer.query("SELECT (SELECT COUNT(*) FROM inventory_stock_balances) AS balances,(SELECT COUNT(*) FROM inventory_movements) AS movements,(SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_bin_locks) AS locks"))[0];
  const first = client(f); await entered.promise;
  const response = await fetch(`${f.origin}${root}/${f.stocktake}/export`, { headers: { Authorization: `Bearer ${f.token}` } }); assert.equal(response.status, 503); await response.arrayBuffer();
  const id = f.calls.find(call => call.method === "recordFailed").requestId; await expectedRows(f, id, [[f.stocktake, "FAILED"], [null, "FAILED"]]);
  release.resolve(); await first.complete; assert.equal(first.state.status, 200); assert.equal(first.state.ended, true);
  const success = f.calls.find(call => call.method === "recordSucceeded").requestId; await expectedRows(f, success, [[f.stocktake, "SUCCEEDED"]]);
  const generic = new InventoryAuditService({ database: f.db, logger: f.handler.logger, time: f.time }), old = randomUUID(); assert.equal(await f.cancelled(() => generic.recordFailed(f.input(old))), false); assert.deepEqual(await f.rows(old), []);
  const after = (await f.observer.query("SELECT (SELECT COUNT(*) FROM inventory_stock_balances) AS balances,(SELECT COUNT(*) FROM inventory_movements) AS movements,(SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_bin_locks) AS locks"))[0]; assert.deepEqual(after, before);
});

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setImmediate, setTimeout } from "node:timers/promises";
import test, { before, after, afterEach } from "node:test";
import { createConnection } from "mysql2/promise";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { JwtService } from "../../src/services/auth/JwtService.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

const ROOT = "/api/v1/inventory/stocktakes", workers = new Set(), parentConnections = new Set();
const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_EXPORT_RECOVERY_TESTS === "1";
const integrationTest = (name, options, work) => test(name, { ...options, skip: !enabled }, work);
const tables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_bin_locks",
  "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_operation_requests"];
let db, scratch, scratchIdentity;
const identify = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o7777, size: stat.size,
  nlink: stat.nlink, type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other" });
async function entry(name) { try { return identify(await fs.lstat(name)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function waitFor(check, message = "Owned resource did not reach its expected state", ms = 15000) {
  const until = performance.now() + ms;
  while (performance.now() < until) { const value = await check(); if (value) return value; await setImmediate(); }
  assert.fail(message);
}
const source = () => ({ module: "INVENTORY", documentType: "STOCKTAKE", documentId: randomUUID(), lineId: "", eventId: randomUUID() });
async function connection() {
  const client = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", password: "", database: process.env.DB_NAME });
  parentConnections.add(Number(client.threadId)); return client;
}
async function snapshot() {
  const value = {};
  for (const table of tables) value[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function audits(f) { return (await db.execute("SELECT id,outcome,action,target_id,after_summary,actor_user_id,actor_label,target_type,target_label,request_id,correlation_id FROM inventory_audit_logs WHERE action='inventory.export' AND actor_user_id=? ORDER BY id", [f.actor.id]))[0]; }
async function inventory(root) {
  const result = [];
  async function visit(directory) {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name), stat = await entry(file); result.push({ path: file, identity: stat });
      if (stat.type === "directory") await visit(file);
    }
  }
  await visit(root); return result;
}
async function disappeared(w, readersOnly = false) {
  const ids = [...w.connections].filter(([_id, role]) => !readersOnly || role === "reader").map(([id]) => id);
  assert.ok(ids.length > 0);
  const started = performance.now(); w.sqlTerminalObservations ??= [];
  try {
    await waitFor(async () => {
      const [rows] = await db.query("SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (?)", [ids]);
      const [transactions] = await db.query("SELECT trx_mysql_thread_id,trx_state FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id IN (?)", [ids]);
      const observed = { processIds: rows.map(row => Number(row.ID)), transactions: transactions.map(row => ({ threadId: Number(row.trx_mysql_thread_id), state: row.trx_state })) };
      const previous = w.sqlTerminalObservations.at(-1);
      if (!previous || JSON.stringify(previous.state) !== JSON.stringify(observed)) w.sqlTerminalObservations.push({ elapsedMs: Math.round(performance.now() - started), state: observed });
      if (!rows.length && !transactions.length) return true;
      // Back off between native observations; convergence remains an assertion, not a cache guarantee.
      await setTimeout(200); return false;
    }, "Recorded native SQL connections/transactions did not disappear");
  } catch (error) { error.message += `; observed=${JSON.stringify(w.sqlTerminalObservations)}`; throw error; }
}
async function knownConnections() {
  const [rows] = await db.execute("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=?", [process.env.DB_NAME]);
  const ids = new Set([...parentConnections, ...[...workers].flatMap(w => [...w.connections.keys()])]);
  assert.ok(rows.every(row => ids.has(Number(row.ID))), "Unregistered native SQL connection in isolated schema");
  for (const w of workers) {
    const own = rows.filter(row => w.connections.has(Number(row.ID)));
    assert.ok(own.length <= 2, "Each worker is limited to its primary and one extra reader");
    assert.ok(own.filter(row => w.connections.get(Number(row.ID)) === "reader").length <= 1);
  }
  return rows.map(row => Number(row.ID));
}
async function sqlBlocker() {
  const lock = await connection(); let released = false;
  await lock.query("LOCK TABLES inventory_stocktake_lines WRITE");
  return { async release() { if (released) return; released = true; await lock.query("UNLOCK TABLES"); await lock.end(); } };
}
async function readerWait(w) {
  return waitFor(async () => {
    const ids = [...w.connections].filter(([, role]) => role === "reader").map(([id]) => id);
    if (!ids.length) return false;
    const [rows] = await db.query("SELECT ID,STATE FROM information_schema.PROCESSLIST WHERE ID IN (?)", [ids]);
    return rows.find(row => /Waiting.*(?:metadata|table)/iu.test(row.STATE ?? ""));
  }, "Actual owned reader SQL wait was not observed");
}
async function externalRequest(w, actor, route) {
  const [[version]] = await db.execute("SELECT version FROM fr_token_versions WHERE subject=?", [String(actor.id)]);
  const jwt = new JwtService({ config: defaultConfigurationSource() });
  const token = jwt.issue({ roles: [actor.role], permissions: actor.permissions }, {
    subject: String(actor.id), version: Number(version?.version ?? 0), authTime: Math.floor(Date.now() / 1000)
  });
  let resolve;
  const result = { bytes: 0, chunks: 0, ended: false, premature: false, hasSummary: false,
    terminal: new Promise(done => { resolve = done; }), body: Buffer.alloc(0) };
  const finish = premature => { result.premature ||= premature; resolve(); };
  result.client = http.get(`${w.ready.origin}${route}`, { agent: false, headers: { Authorization: `Bearer ${token}` } }, response => {
    result.status = response.statusCode;
    response.on("data", chunk => {
      result.bytes += chunk.length; result.chunks++; result.body = Buffer.concat([result.body, chunk]);
      result.hasSummary = result.body.includes(Buffer.from("\r\nSUMMARY,"));
    });
    response.once("end", () => { result.ended = true; finish(false); });
    response.once("aborted", () => finish(true)); response.once("error", () => finish(true));
    response.once("close", () => { if (!result.ended) finish(true); });
  });
  result.client.once("error", () => finish(true)); return result;
}
async function worker(actor, inventoryConfig = {}) {
  const root = await fs.mkdtemp(path.join(scratch, "worker-")); await fs.chmod(root, 0o700);
  const rootIdentity = await entry(root), env = {};
  for (const name of ["PATH", "DB_NAME", "DB_SOCKET_PATH", "DB_USER", "DB_PASSWORD", "JWT_SECRET", "SUPPLIER_BANK_ACTIVE_KEY_ID", "SUPPLIER_BANK_ENCRYPTION_KEYS", "SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID", "SUPPLIER_BANK_LOOKUP_KEYS", "CUSTOMER_BANK_ACTIVE_KEY_ID", "CUSTOMER_BANK_ENCRYPTION_KEYS", "CUSTOMER_BANK_LOOKUP_ACTIVE_KEY_ID", "CUSTOMER_BANK_LOOKUP_KEYS"]) if (process.env[name] !== undefined) env[name] = process.env[name];
  Object.assign(env, { TMPDIR: root, DB_INTEGRATION_TESTS: "1", INVENTORY_STOCKTAKE_EXPORT_RECOVERY_TESTS: "1" });
  const child = fork(new URL("../../test-support/inventoryStocktakeExportChild.js", import.meta.url), [], {
    execArgv: ["--import", new URL("../../test-support/testEnv.js", import.meta.url).href], stdio: ["ignore", "ignore", "pipe", "ipc"], env
  });
  const w = { child, root, rootIdentity, owned: new Map(), messages: [], connections: new Map(), exit: null, stderr: [], finalized: false };
  workers.add(w);
  child.on("message", message => {
    w.messages.push(message);
    if (message.type === "owned") {
      assert.equal(path.relative(root, message.path).startsWith(".."), false);
      assert.ok(message.path !== root); w.owned.set(message.path, message.identity);
    }
    if (message.type === "connection") {
      assert.ok(Number.isSafeInteger(message.threadId) && message.threadId > 0);
      w.connections.set(message.threadId, message.role);
    }
  });
  child.stderr.on("data", chunk => w.stderr.push({ bytes: chunk.length, sha256: createHash("sha256").update(chunk).digest("hex") }));
  child.once("exit", (code, signal) => { w.exit = { code, signal }; }); child.once("error", error => { w.error = error.code ?? "CHILD_ERROR"; });
  child.once("close", () => { w.closed = true; });
  w.message = async (type, predicate = () => true, after = 0, timeoutMs = 15000) => waitFor(() => {
    const found = w.messages.slice(after).find(message => message.type === type && predicate(message));
    const failure = w.messages.slice(after).find(message => message.type === "fixtureError");
    assert.ok(!failure, `Owned child fixture error: ${failure?.code}`);
    if (!found) assert.ok(!w.exit && !w.error, `Owned child ended before ${type}: ${w.error ?? w.exit?.code}`);
    return found;
  }, `Owned child did not report ${type}`, timeoutMs);
  await w.message("initialized");
  child.send({ type: "boot", actor: { id: actor.id, role: actor.role, permissions: actor.permissions }, inventory: inventoryConfig });
  w.ready = await w.message("ready"); assert.equal(w.ready.pid, child.pid); assert.equal(w.ready.primaryLimit, 1);
  w.configure = async setting => { const id = randomUUID(); child.send({ type: "configure", id, setting }); await w.message("configured", message => message.id === id); };
  w.start = (route, body) => {
    const id = randomUUID(), offset = w.messages.length;
    child.send({ type: "request", id, route, ...(body === undefined ? {} : { body }) });
    return { id, offset, response: () => w.message("response", message => message.id === id, offset, 135000), checkpoint: stage => w.message("checkpoint", message => message.stage === stage, offset) };
  };
  w.request = async (route, body) => w.start(route, body).response();
  w.state = async () => { const id = randomUUID(); child.send({ type: "state", id }); return w.message("state", message => message.id === id); };
  w.release = checkpoint => child.send({ type: "release", id: checkpoint.id });
  w.baseline = await w.state();
  return w;
}
async function quiescent(w) {
  await disappeared(w, true);
  const state = await waitFor(async () => {
    const observed = await w.state();
    return observed.openFiles === 0 && observed.activeReaders === 0 && observed.fdCount === w.baseline.fdCount && observed;
  }, "Worker files/readers/FD count did not return to observed baseline");
  assert.ok(state.maxReaders <= 1); assert.equal(state.closed, state.exportCount);
  for (const name of new Set([...Object.keys(state.resourceCounts), ...Object.keys(w.baseline.resourceCounts)].filter(name => /Socket|TCP|Pipe/u.test(name)))) {
    assert.equal(state.resourceCounts[name] ?? 0, w.baseline.resourceCounts[name] ?? 0, `Native ${name} count did not return to baseline`);
  }
  assert.deepEqual(await inventory(w.root), []); await knownConnections(); return state;
}
async function clean(w) {
  assert.ok(w.exit, "Positive child exit required before parent cleanup");
  const currentRoot = await entry(w.root);
  assert.deepEqual([currentRoot?.dev, currentRoot?.ino, currentRoot?.uid, currentRoot?.mode], [w.rootIdentity.dev, w.rootIdentity.ino, w.rootIdentity.uid, 0o700]);
  const found = await inventory(w.root);
  for (const item of found) {
    const known = w.owned.get(item.path); assert.ok(known, "Unknown path retained; no cleanup authority");
    assert.deepEqual([item.identity.dev, item.identity.ino, item.identity.uid, item.identity.type], [known.dev, known.ino, known.uid, known.type]);
    if (item.identity.type === "file") assert.equal(item.identity.size, 0, "Linked nonempty data retained for investigation");
    else assert.equal(item.identity.type, "directory");
  }
  for (const item of found.sort((a, b) => b.path.length - a.path.length)) {
    const current = await entry(item.path);
    assert.deepEqual([current?.dev, current?.ino, current?.uid, current?.type, current?.mode],
      [item.identity.dev, item.identity.ino, item.identity.uid, item.identity.type, item.identity.mode]);
    if (current.type === "file") assert.equal(current.size, 0);
    if (item.identity.type === "file") await fs.unlink(item.path); else await fs.rmdir(item.path);
  }
  assert.deepEqual(await fs.readdir(w.root), []); await fs.rmdir(w.root); w.finalized = true;
}
async function terminate(w, signal = "SIGKILL", releaseBlocker) {
  assert.ok(w.child.pid > 1 && w.child.pid !== process.pid);
  if (!w.exit) { if (signal === "SIGKILL") assert.equal(w.child.kill("SIGKILL"), true); else w.child.send({ type: "stop" }); }
  await waitFor(() => w.exit, "Owned process did not positively exit");
  if (signal === "SIGKILL") assert.equal(w.exit.signal, "SIGKILL"); else assert.equal(w.exit.code, 0);
  await releaseBlocker?.();
  await disappeared(w); await waitFor(() => w.closed, "Owned child stdio did not close"); await clean(w);
}
async function fixture(count = 1, config = {}, scopeCount = 1) {
  const now = Date.now(), code = randomUUID(), permissions = ["inventory.view", "inventory.operation"];
  const [role] = await db.execute("INSERT INTO roles (name,created_at) VALUES (?,?)", [code, now]);
  for (const permission of permissions) await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
  const [user] = await db.execute("INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic Export',?,?)", [code, await hashPassword(randomBytes(32).toString("hex")), now, now]);
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
  const actor = { id: Number(user.insertId), roleId: Number(role.insertId), role: code, permissions };
  const [warehouse] = await db.execute("INSERT INTO inventory_warehouses (warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?, ?,?)", [code, code, code, now, now]);
  const binIds = [];
  for (let i = 0; i < scopeCount; i++) {
    const [bin] = await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?,?,?)", [warehouse.insertId, `EXPORT${i}`, `export${i}`, now, now]);
    binIds.push(Number(bin.insertId));
  }
  const w = await worker(actor, config);
  const created = await w.request(`${ROOT}/create`, { source: source(), warehouseId: Number(warehouse.insertId), binIds }); assert.equal(created.status, 200);
  const started = await w.request(`${ROOT}/${created.data.id}/start`, { source: source(), expectedVersion: created.data.version }); assert.equal(started.status, 200);
  const [uom] = await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", [code.slice(0, 12), now, now]);
  const [item] = await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Synthetic Export','standard','active',?,?)", [now, now]);
  if (count) {
    const digit = "(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
    const numbers = `SELECT a.n+10*b.n+100*c.n+1000*d.n+10000*e.n+100000*f.n AS n FROM ${digit} a CROSS JOIN ${digit} b CROSS JOIN ${digit} c CROSS JOIN ${digit} d CROSS JOIN ${digit} e CROSS JOIN ${digit} f`;
    await db.query(`INSERT INTO item_skus (item_id,sku_code,sku_name,status,tracking_policy,inventory_tracked,created_at,updated_at)
      SELECT ?,CONCAT(?,n),CONCAT('=SYNTHETIC ',REPEAT('P',160),n),'active','none',1,?,? FROM (${numbers}) seq WHERE n<?`, [item.insertId, code, now, now, count]);
    await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) SELECT id,?,1,1,?,? FROM item_skus WHERE item_id=?", [uom.insertId, now, now, item.insertId]);
    await db.execute(`INSERT INTO inventory_stocktake_lines (stocktake_id,stocktake_bin_id,bin_id,sku_id,stock_status,snapshot_quantity,snapshot_balance_version)
      SELECT scope.stocktake_id,scope.id,scope.bin_id,sku.id,'AVAILABLE',0,0 FROM inventory_stocktake_bins scope JOIN item_skus sku ON sku.item_id=? WHERE scope.stocktake_id=?`, [item.insertId, started.data.id]);
  }
  const f = { actor, w, id: started.data.id, version: started.data.version, count: count * scopeCount, route: `${ROOT}/${started.data.id}/export` };
  f.before = await snapshot(); f.baseline = w.baseline; return f;
}
async function complete(w, route, count) {
  const response = await w.request(route); assert.equal(response.status, 200); assert.equal(response.ended, true); assert.equal(response.premature, false);
  assert.ok(response.csv); assert.equal(response.csv.lines, count); assert.equal(response.csv.footer.recordType, "SUMMARY");
  assert.equal(response.csv.footer.exportedRows, String(response.csv.scopes + count));
  assert.equal(response.csv.footer.truncated, response.headers["x-inventory-export-truncated"]);
  assert.equal(response.csv.footer.asOf, response.headers["x-inventory-export-as-of"]);
  return response;
}
async function recovered(f) {
  const replacement = await worker(f.actor); await complete(replacement, f.route, f.count); await terminate(replacement, "stop");
  assert.equal(await snapshot(), f.before);
}
async function crash(f, stage) {
  await f.w.configure({ checkpoint: stage });
  const request = f.w.start(f.route), checkpoint = await request.checkpoint(stage);
  const proof = await inventory(f.w.root);
  assert.ok(proof.every(item => item.identity.type === "directory" || item.identity.size === 0), "No linked nonempty CSV may exist at crash boundary");
  await terminate(f.w); assert.equal(await snapshot(), f.before); await recovered(f); return { ...checkpoint, requestOffset: request.offset };
}

before(async () => {
  if (!enabled) return;
  assert.equal(process.env.DB_INTEGRATION_TESTS, "1"); assert.equal(process.env.INVENTORY_STOCKTAKE_EXPORT_RECOVERY_TESTS, "1");
  assert.match(process.version, /^v26\./u); assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task041_export_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task041-export-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  assert.equal(process.env.DB_USER, "root"); assert.equal(process.env.DB_PASSWORD, "");
  scratch = await fs.realpath(process.env.TMPDIR); scratchIdentity = await entry(scratch);
  assert.equal(scratchIdentity.mode, 0o700); assert.equal(scratchIdentity.uid, process.geteuid()); assert.equal(scratchIdentity.type, "directory");
  db = await connection();
  const [[environment]] = await db.query("SELECT VERSION() AS version,DATABASE() AS name,@@skip_networking AS isolated,@@datadir AS datadir");
  assert.deepEqual([environment.version, environment.name, Number(environment.isolated)], ["26.7.0", process.env.DB_NAME, 1]);
  assert.equal(path.resolve(environment.datadir), path.join(path.dirname(process.env.DB_SOCKET_PATH), "data"));
  const migrations = (await fs.readdir(new URL("../../database/migrations/", import.meta.url))).filter(name => /\.(?:js|sql)$/u.test(name)).map(name => `migrations/${name}`);
  assert.deepEqual((await db.query("SELECT name FROM fr_schema_migrations ORDER BY name"))[0].map(row => row.name), [...migrations, "framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"].sort());
});
afterEach(async () => { if (!enabled) return; for (const w of workers) if (!w.finalized) await terminate(w); });
after(async () => {
  if (!enabled) return;
  await db?.end();
  const observed = await entry(scratch);
  assert.deepEqual([observed.dev, observed.ino, observed.uid, observed.mode], [scratchIdentity.dev, scratchIdentity.ino, scratchIdentity.uid, scratchIdentity.mode]);
});

integrationTest("ST041-ED01 real application/JWT/SQL and native anonymous-before-data capability", { timeout: 120000 }, async t => {
  const f = await fixture(), result = await complete(f.w, f.route, 1);
  const observed = f.w.messages.filter(message => message.type === "beforeFirstWrite"); assert.equal(observed.length, 1);
  assert.equal(observed[0].descriptor.nlink, 0); assert.equal(observed[0].descriptor.size, 0); assert.equal(observed[0].descriptor.mode, 0o600);
  assert.equal(observed[0].fileEntry, null); assert.equal(observed[0].directoryEntry, null); assert.equal(result.csv.unsafeCells, 1);
  assert.ok(result.csv.uncounted.every(row => row.actualQuantity === "" && row.varianceQuantity === ""));
  assert.deepEqual((await audits(f)).map(row => row.outcome), ["SUCCEEDED"]); assert.equal(await snapshot(), f.before);
  await waitFor(async () => (await f.w.state()).openFiles === 0); const state = await f.w.state(); assert.equal(state.maxReaders, 1); assert.equal(state.closed, 1);
  await terminate(f.w, "stop"); t.diagnostic(JSON.stringify({ runtime: f.w.ready.runtime, numericEffectiveUid: f.w.ready.euid, nlink: 0, generatedBytes: result.bytes, parsedLines: result.csv.lines }));
});
integrationTest("ST041-ED02 abrupt exit after actual empty exclusive open leaves only owned empty metadata", { timeout: 120000 }, async () => {
  const checkpoint = await crash(await fixture(), "open"); assert.equal(checkpoint.descriptor.size, 0); assert.equal(checkpoint.descriptor.nlink, 1);
});
integrationTest("ST041-ED03 abrupt exit after actual unlink preserves no named CSV", { timeout: 120000 }, async () => {
  const checkpoint = await crash(await fixture(), "unlink"); assert.equal(checkpoint.descriptor.size, 0); assert.equal(checkpoint.descriptor.nlink, 0); assert.equal(checkpoint.fileEntry, null); assert.equal(checkpoint.directoryEntry.type, "directory");
});
integrationTest("ST041-ED04 abrupt exit after actual empty-directory removal precedes first byte", { timeout: 120000 }, async () => {
  const checkpoint = await crash(await fixture(), "anonymous"); assert.equal(checkpoint.descriptor.size, 0); assert.equal(checkpoint.descriptor.nlink, 0); assert.equal(checkpoint.fileEntry, null); assert.equal(checkpoint.directoryEntry, null);
});
integrationTest("ST041-ED05 abrupt exit after native header write leaves anonymous data and requires a new export", { timeout: 120000 }, async () => {
  const f = await fixture(), checkpoint = await crash(f, "header");
  assert.ok(checkpoint.descriptor.size > 0); assert.equal(checkpoint.descriptor.nlink, 0);
  assert.equal(checkpoint.fileEntry, null); assert.equal(checkpoint.directoryEntry, null);
  assert.deepEqual((await audits(f)).map(row => row.outcome), ["SUCCEEDED"], "Only replacement export may succeed");
});
integrationTest("ST041-ED06 abrupt exit after one complete real 500-line batch leaves no successful old export", { timeout: 120000 }, async () => {
  const f = await fixture(1002), checkpoint = await crash(f, "batch");
  assert.equal(checkpoint.rows, 500); assert.equal(checkpoint.descriptor.nlink, 0); assert.ok(checkpoint.descriptor.size > 0);
  assert.equal(checkpoint.fileEntry, null); assert.equal(checkpoint.directoryEntry, null);
  assert.equal(f.w.messages.slice(checkpoint.requestOffset).some(message => message.type === "clientData"), false);
  assert.deepEqual((await audits(f)).map(row => row.outcome), ["SUCCEEDED"]);
});
integrationTest("ST041-ED07 abrupt exit after actual SUMMARY write precedes delivery and successful Audit", { timeout: 120000 }, async () => {
  const f = await fixture(501), checkpoint = await crash(f, "summary");
  assert.equal(checkpoint.generatedSize, checkpoint.descriptor.size); assert.ok(checkpoint.summaryOffset > 0);
  assert.equal(checkpoint.descriptor.nlink, 0); assert.equal(checkpoint.fileEntry, null); assert.equal(checkpoint.directoryEntry, null);
  assert.equal(f.w.messages.slice(checkpoint.requestOffset).some(message => message.type === "clientData" || message.type === "auditSqlCompleted" && message.outcome === "SUCCEEDED"), false);
  assert.deepEqual((await audits(f)).map(row => row.outcome), ["SUCCEEDED"]);
});
integrationTest("ST041-ED08 actual parent HTTP client receives only first source chunk before abrupt streaming exit", { timeout: 120000 }, async t => {
  const f = await fixture(1002); await f.w.configure({ checkpoint: "secondRead" });
  const offset = f.w.messages.length, client = await externalRequest(f.w, f.actor, f.route);
  try {
    const checkpoint = await f.w.message("checkpoint", message => message.stage === "secondRead", offset);
    assert.ok(checkpoint.generatedSize > 131072); assert.ok(checkpoint.summaryOffset > 65536); assert.equal(checkpoint.nativeReadsStarted, 1);
    const reads = f.w.messages.slice(offset).filter(message => message.type === "read");
    assert.equal(reads.length, 1); assert.ok(reads[0].bytesRead > 0 && reads[0].bytesRead <= 65536);
    await waitFor(() => client.bytes >= reads[0].bytesRead, "Actual parent HTTP first-source-chunk data events were not observed");
    assert.equal(client.status, 200); assert.equal(client.bytes, reads[0].bytesRead); assert.ok(client.bytes <= 65536); assert.equal(client.hasSummary, false); assert.equal(client.ended, false);
    assert.deepEqual((await audits(f)).map(row => row.outcome), ["SUCCEEDED"]);
    const originalAudit = await audits(f), firstBytes = client.bytes;
    await knownConnections(); await terminate(f.w); await client.terminal;
    assert.equal(client.ended, false); assert.equal(client.premature, true); assert.equal(client.bytes, firstBytes); assert.equal(client.hasSummary, false);
    assert.equal(f.w.messages.slice(offset).filter(message => message.type === "read").length, 1, "Second native read remained behind unreleased barrier");
    assert.deepEqual(await audits(f), originalAudit, "Real successful generation Audit survives delivery crash");
    assert.equal(await snapshot(), f.before); await recovered(f);
    t.diagnostic(JSON.stringify({ generatedSize: checkpoint.generatedSize, summaryOffset: checkpoint.summaryOffset, clientBodyBytes: client.bytes,
      clientDataEvents: client.chunks, nativeReadsStarted: 1, barrierReleased: false, endObserved: client.ended, prematureClose: client.premature,
      sha256: createHash("sha256").update(client.body).digest("hex"), positiveExit: f.w.exit }));
  } finally { client.client.destroy(); }
});
integrationTest("ST041-ED09 independent worker B finishes while worker A actually generates and is killed", { timeout: 120000 }, async () => {
  const f = await fixture(501), b = await worker(f.actor), bIdentity = await entry(b.root);
  await f.w.configure({ checkpoint: "header" }); const a = f.w.start(f.route); await a.checkpoint("header");
  assert.notEqual(f.w.child.pid, b.child.pid); assert.notEqual(f.w.root, b.root);
  await complete(b, f.route, f.count); await knownConnections();
  const aIds = [...f.w.connections.keys()]; assert.ok([...b.connections.keys()].every(id => !aIds.includes(id)));
  assert.equal((await f.w.state()).maxReaders, 1); assert.equal((await b.state()).maxReaders, 1);
  await terminate(f.w); assert.deepEqual(await entry(b.root), bIdentity); assert.equal(b.exit, null);
  await complete(b, f.route, f.count); assert.equal(await snapshot(), f.before); await terminate(b, "stop");
});
integrationTest("ST041-ED10 same-worker competing generation returns 503 without another reader or file", { timeout: 120000 }, async () => {
  const f = await fixture(501); await f.w.configure({ checkpoint: "header" });
  const a = f.w.start(f.route), checkpoint = await a.checkpoint("header"), before = await f.w.state();
  const ids = [...f.w.connections.keys()], owned = [...f.w.owned.keys()], denied = await f.w.request(f.route);
  assert.equal(denied.status, 503); assert.equal(denied.error.code, "INVENTORY_DEPENDENCY_UNAVAILABLE"); assert.equal(denied.csv, undefined); assert.equal(denied.safeError, true);
  const after = await f.w.state(); assert.equal(after.exportCount, before.exportCount); assert.equal(after.openFiles, before.openFiles); assert.equal(after.maxReaders, 1);
  assert.deepEqual([...f.w.connections.keys()], ids); assert.deepEqual([...f.w.owned.keys()], owned); await knownConnections();
  await waitFor(async () => (await f.w.state()).fdCount === before.fdCount, "Competing 503 left an extra native FD");
  f.w.release(checkpoint); const result = await a.response(); assert.equal(result.status, 200); assert.equal(result.csv.lines, f.count);
  await complete(f.w, f.route, f.count); assert.equal(await snapshot(), f.before); await terminate(f.w, "stop");
});
integrationTest("ST041-ED11 positive crash exit precedes releasing own metadata blocker and native SQL reclamation", { timeout: 120000 }, async t => {
  const f = await fixture(501), blocker = await sqlBlocker();
  try {
    f.w.start(f.route); const wait = await readerWait(f.w); await knownConnections();
    assert.ok(f.w.connections.has(Number(wait.ID))); assert.equal(f.w.connections.get(Number(wait.ID)), "reader");
    let exitBeforeRelease = false;
    await terminate(f.w, "SIGKILL", async () => { assert.ok(f.w.exit); exitBeforeRelease = true; await blocker.release(); });
    assert.equal(exitBeforeRelease, true); assert.equal(await snapshot(), f.before); await recovered(f);
    t.diagnostic(JSON.stringify({ observedWait: { threadId: Number(wait.ID), state: wait.STATE }, positiveExit: f.w.exit, exitBeforeBlockerRelease: exitBeforeRelease, recordedIds: [...f.w.connections.keys()], terminalSqlObservations: f.w.sqlTerminalObservations }));
  } finally { if (!f.w.finalized) await terminate(f.w, "SIGKILL", () => blocker.release()); else await blocker.release(); }
});
integrationTest("ST041-ED12 committed role/view revocation after actual native read discloses zero subsequent bytes", { timeout: 180000 }, async t => {
  const f = await fixture(1002), observations = [];
  for (const kind of ["role", "view"]) {
    await f.w.configure({ checkpoint: "firstRead", observeAudit: true });
    const beforeAudit = await audits(f);
    const request = f.w.start(f.route), checkpoint = await request.checkpoint("firstRead"), previousAudit = await audits(f);
    assert.ok(checkpoint.bytesRead > 0); assert.equal(checkpoint.nativeReadsStarted, 1);
    assert.deepEqual(previousAudit.slice(0, beforeAudit.length), beforeAudit);
    const generation = previousAudit.slice(beforeAudit.length);
    assert.equal(generation.length, 1); assert.equal(generation[0].outcome, "SUCCEEDED");
    const generationInsert = f.w.messages.slice(request.offset).filter(message => message.type === "auditSqlCompleted" && message.outcome === "SUCCEEDED");
    assert.equal(generationInsert.length, 1); assert.equal(generationInsert[0].insertId, Number(generation[0].id));
    assert.ok(f.w.messages.slice(request.offset).some(message => message.type === "sqlLifecycle" && message.stage === "commitCompleted" && message.audit?.insertId === Number(generation[0].id)));
    assert.equal(Number(generation[0].target_id), f.id);
    const summary = typeof generation[0].after_summary === "string" ? JSON.parse(generation[0].after_summary) : generation[0].after_summary;
    assert.deepEqual(summary, { stocktakeId: f.id, rowCount: f.count + 1, version: f.version, status: "COUNTING" });
    let revoked = false;
    try {
      const [change] = await db.execute(kind === "role" ? "DELETE FROM user_roles WHERE user_id=? AND role_id=?"
        : "DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.view'",
      kind === "role" ? [f.actor.id, f.actor.roleId] : [f.actor.roleId]);
      assert.equal(change.affectedRows, 1); revoked = true;
      f.w.release(checkpoint); const response = await request.response();
      assert.equal(response.bytes, 0); assert.equal(response.ended, false); assert.equal(response.premature, true);
      assert.equal(f.w.messages.slice(request.offset).some(message => message.type === "clientData" && message.id === request.id), false);
      try {
        await waitFor(() => ["FAILED", "REJECTED"].every(outcome => f.w.messages.slice(request.offset).some(message => message.type === "sqlLifecycle" && message.stage === "commitCompleted" && message.audit?.outcome === outcome)), "Independent DOMAIN and ROUTE failure Audit commits were not observed");
      } finally {
        t.diagnostic(JSON.stringify({ trigger: kind, nativeBytesRead: checkpoint.bytesRead, clientBytes: response.bytes, premature: response.premature,
          auditOutcomes: (await audits(f)).map(row => ({ id: Number(row.id), outcome: row.outcome })),
          actualSqlLifecycle: f.w.messages.slice(request.offset).filter(message => message.type === "sqlLifecycle").slice(-100) }));
      }
      assert.deepEqual((await audits(f)).slice(0, previousAudit.length), previousAudit);
      const requestAudits = (await audits(f)).slice(beforeAudit.length);
      assert.deepEqual(requestAudits.map(row => row.outcome), ["SUCCEEDED", "FAILED", "REJECTED"]);
      assert.deepEqual(requestAudits.map(row => ({ actorId: Number(row.actor_user_id), actorLabel: row.actor_label,
        action: row.action, targetType: row.target_type, targetId: row.target_id === null ? null : Number(row.target_id),
        targetLabel: row.target_label, requestId: row.request_id, correlationId: row.correlation_id })), [
        { actorId: f.actor.id, actorLabel: f.actor.role, action: "inventory.export", targetType: "stocktake", targetId: f.id,
          targetLabel: `stocktake:${f.id}`, requestId: "", correlationId: "" },
        { actorId: f.actor.id, actorLabel: f.actor.role, action: "inventory.export", targetType: "stocktake", targetId: f.id,
          targetLabel: `stocktake:${f.id}`, requestId: "", correlationId: "" },
        { actorId: f.actor.id, actorLabel: `user:${f.actor.id}`, action: "inventory.export", targetType: "stocktake", targetId: null,
          targetLabel: `${ROOT}/:id/export`, requestId: "", correlationId: "" }
      ]);
      const auditMessages = f.w.messages.slice(request.offset);
      const inserts = auditMessages.filter(message => message.type === "auditSqlCompleted");
      assert.deepEqual(inserts.map(message => ({ outcome: message.outcome, id: message.insertId })),
        requestAudits.map(row => ({ outcome: row.outcome, id: Number(row.id) })));
      for (const row of requestAudits) {
        assert.equal(auditMessages.filter(message => message.type === "sqlLifecycle" && message.stage === "commitCompleted"
          && message.audit?.insertId === Number(row.id) && message.audit?.outcome === row.outcome).length, 1);
      }
      assert.equal(requestAudits[1].after_summary, null); assert.equal(requestAudits[2].after_summary, null);
      const state = await quiescent(f.w); assert.equal(state.maxReaders, 1);
      observations.push({ trigger: kind, nativeBytesRead: checkpoint.bytesRead, clientBytesAfterCommittedRevocation: response.bytes, closedFiles: state.closed });
    } finally {
      if (revoked) {
        const [restored] = await db.execute(kind === "role" ? "INSERT INTO user_roles (user_id,role_id) VALUES (?,?)"
          : "INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.view'",
        kind === "role" ? [f.actor.id, f.actor.roleId] : [f.actor.roleId]);
        assert.equal(restored.affectedRows, 1);
      }
    }
    await f.w.configure({}); await complete(f.w, f.route, f.count); await quiescent(f.w);
  }
  assert.equal(await snapshot(), f.before); await terminate(f.w, "stop"); t.diagnostic(JSON.stringify(observations));
});
integrationTest("ST041-ED13 real generation timer and HTTP abort settle initialization SQL and filesystem ownership", { timeout: 240000 }, async t => {
  const observations = [];
  for (const stage of ["initialize", "sql", "open"]) for (const trigger of ["timeout", "abort"]) {
    const f = await fixture(1, { exportTimeoutMs: 1000 }), blocker = stage === "sql" ? await sqlBlocker() : null;
    let checkpoint;
    try {
      await f.w.configure(stage === "sql" ? {} : { checkpoint: stage });
      const request = f.w.start(f.route);
      const wait = stage === "sql" ? await readerWait(f.w) : (checkpoint = await request.checkpoint(stage));
      const before = await f.w.state(); let response;
      if (trigger === "abort") {
        f.w.child.send({ type: "abort", id: request.id }); response = await request.response();
        assert.equal(response.premature, true); assert.equal(response.ended, false);
        await blocker?.release(); if (checkpoint) f.w.release(checkpoint);
      } else {
        if (checkpoint) { await disappeared(f.w, true); f.w.release(checkpoint); }
        response = await request.response(); assert.equal(response.status, 504); assert.equal(response.safeError, true);
        await blocker?.release();
      }
      assert.equal(response.csv, undefined);
      if (trigger === "abort") assert.equal(response.bytes, 0);
      const state = await quiescent(f.w); assert.equal(state.writes, before.writes); assert.equal(state.reads, before.reads);
      assert.equal((await audits(f)).some(row => row.outcome === "SUCCEEDED"), false);
      if (trigger === "timeout") assert.ok((await audits(f)).some(row => row.outcome === "FAILED"));
      await f.w.configure({}); await complete(f.w, f.route, f.count); await quiescent(f.w);
      assert.equal(await snapshot(), f.before);
      observations.push({ stage, trigger, actualGenerationBudgetMs: 1000, status: response.status, premature: response.premature,
        nativeWaitObserved: stage === "sql" ? { threadId: Number(wait.ID), state: wait.STATE } : { checkpoint: wait.stage, nativeQueryCompleted: wait.nativeQueryCompleted },
        noLateWritesOrReads: true, filesClosed: state.closed, recoveredByNewAuthorization: true });
      await terminate(f.w, "stop");
    } finally {
      if (blocker) { if (!f.w.finalized) await terminate(f.w, "SIGKILL", () => blocker.release()); else await blocker.release(); }
      else if (checkpoint && !f.w.exit) f.w.release(checkpoint);
    }
  }
  t.diagnostic(JSON.stringify(observations));
});
integrationTest("ST041-ED14 explicit unsupported unlink/rmdir injections fail closed and preserve legal Inventory reads", { timeout: 180000 }, async t => {
  const f = await fixture(), observations = [];
  for (const operation of ["unlink", "rmdir"]) for (const errno of ["ENOSYS", "ENOTSUP", "EOPNOTSUPP"]) {
    const previous = await audits(f), offset = f.w.messages.length;
    await f.w.configure({ fail: operation, errno }); const result = await f.w.request(f.route);
    assert.equal(result.status, 503); assert.equal(result.error.code, "INVENTORY_DEPENDENCY_UNAVAILABLE"); assert.equal(result.safeError, true); assert.equal(result.csv, undefined);
    assert.equal(f.w.messages.slice(offset).some(message => message.type === "write"), false);
    assert.ok(f.w.messages.slice(offset).some(message => message.type === "injection" && message.operation === operation && message.errno === errno));
    await waitFor(async () => (await audits(f)).slice(previous.length).some(row => row.outcome === "FAILED"));
    assert.deepEqual((await audits(f)).slice(0, previous.length), previous); await quiescent(f.w);
    const get = await f.w.request(`${ROOT}/${f.id}`); assert.equal(get.status, 200); assert.equal(get.data.id, f.id);
    await f.w.configure({}); await complete(f.w, f.route, f.count); await quiescent(f.w);
    assert.equal(await snapshot(), f.before); observations.push({ operation, errno, explicitInjection: true, exportStatus: result.status, legalReadStatus: get.status });
  }
  await terminate(f.w, "stop"); t.diagnostic(JSON.stringify({ platformCapabilityClaim: false, observations }));
});
integrationTest("ST041-ED15 explicit first-write/footer disk errors remain safe500 and never truncated success", { timeout: 180000 }, async t => {
  const f = await fixture(), observations = [];
  for (const [operation, errno] of [["firstWrite", "EIO"], ["footer", "ENOSPC"], ["footer", "EDQUOT"]]) {
    const previous = await audits(f), offset = f.w.messages.length, before = await f.w.state();
    await f.w.configure({ fail: operation, errno }); const result = await f.w.request(f.route);
    assert.equal(result.status, 500); assert.equal(result.safeError, true); assert.equal(result.csv, undefined);
    assert.equal(result.headers["x-inventory-export-reason"], undefined);
    assert.ok(f.w.messages.slice(offset).some(message => message.type === "injection" && message.operation === operation && message.errno === errno));
    await waitFor(async () => (await audits(f)).slice(previous.length).some(row => row.outcome === "FAILED"));
    const added = (await audits(f)).slice(previous.length); assert.equal(added.some(row => row.outcome === "SUCCEEDED"), false);
    assert.deepEqual((await audits(f)).slice(0, previous.length), previous);
    const state = await quiescent(f.w); assert.equal(state.reads, before.reads, "Failed generation must not start delivery reads");
    await f.w.configure({}); await complete(f.w, f.route, f.count); await quiescent(f.w);
    assert.equal(await snapshot(), f.before); observations.push({ operation, errno, explicitErrorObjectInjection: true, status: result.status, safeError: result.safeError, filesClosed: state.closed });
  }
  await terminate(f.w, "stop"); t.diagnostic(JSON.stringify(observations));
});
integrationTest("ST041-ED16 killed-worker empty cleanup preserves parent synthetic foreign sentinel and active worker", { timeout: 180000 }, async t => {
  const f = await fixture(501), b = await worker(f.actor);
  const sentinelPath = path.join(scratch, `foreign-sentinel-${randomUUID()}`), bytes = Buffer.from(`synthetic-foreign-${randomUUID()}`);
  const handle = await fs.open(sentinelPath, "wx", 0o600); await handle.writeFile(bytes); await handle.close();
  const sentinel = { path: sentinelPath, identity: await entry(sentinelPath), sha256: createHash("sha256").update(bytes).digest("hex") };
  const assertSentinel = async () => {
    assert.deepEqual(await entry(sentinel.path), sentinel.identity);
    assert.equal(createHash("sha256").update(await fs.readFile(sentinel.path)).digest("hex"), sentinel.sha256);
  };
  await f.w.configure({ checkpoint: "open" }); await b.configure({ checkpoint: "header" });
  const aRequest = f.w.start(f.route), bRequest = b.start(f.route);
  const aCheckpoint = await aRequest.checkpoint("open"), bCheckpoint = await bRequest.checkpoint("header");
  assert.equal(aCheckpoint.descriptor.size, 0); assert.equal(bCheckpoint.descriptor.nlink, 0); assert.ok(bCheckpoint.descriptor.size > 0);
  const bIdentity = await entry(b.root); await knownConnections(); await terminate(f.w);
  assert.equal(b.exit, null); assert.deepEqual(await entry(b.root), bIdentity); assert.equal((await b.state()).openFiles, 1); await assertSentinel();
  b.release(bCheckpoint); const response = await bRequest.response(); assert.equal(response.status, 200); assert.equal(response.csv.lines, f.count);
  await quiescent(b); await assertSentinel(); assert.equal(await snapshot(), f.before); await terminate(b, "stop"); await assertSentinel();
  t.diagnostic(JSON.stringify({ sentinel, killedOwnedRoot: f.w.root, killedPositiveExit: f.w.exit, preservedWhileOtherWorkerActive: true, otherWorkerPid: b.child.pid,
    sentinelRetainedAfterWorkerCleanup: true, coordinatorOwnSyntheticFixtureCleanupNotObserved: true }));
});
integrationTest("ST041-ED17 ten serial mixed lifecycles restore each observed FD socket SQL transaction and pathname baseline", { timeout: 240000 }, async t => {
  const f = await fixture(), observations = []; await terminate(f.w, "stop");
  const kinds = ["normal", "abort", "fail", "crash", "normal", "abort", "fail", "crash", "normal", "normal"];
  for (const [round, kind] of kinds.entries()) {
    const parentFds = (await fs.readdir("/dev/fd")).length, names = (await fs.readdir(scratch)).sort(), priorAudit = await audits(f);
    const w = await worker(f.actor); let state, residue = [];
    if (kind === "normal") await complete(w, f.route, f.count);
    else if (kind === "fail") {
      await w.configure({ fail: "firstWrite", errno: "EIO" }); const result = await w.request(f.route); assert.equal(result.status, 500); assert.equal(result.safeError, true);
    } else {
      await w.configure({ checkpoint: "open" }); const request = w.start(f.route), checkpoint = await request.checkpoint("open");
      residue = await inventory(w.root); assert.ok(residue.every(item => item.identity.type === "directory" || item.identity.size === 0));
      if (kind === "crash") { await terminate(w); }
      else { w.child.send({ type: "abort", id: request.id }); const response = await request.response(); assert.equal(response.premature, true); assert.equal(response.bytes, 0); w.release(checkpoint); }
    }
    if (!w.finalized) {
      await quiescent(w); await w.configure({}); await complete(w, f.route, f.count); state = await quiescent(w); await terminate(w, "stop");
    } else {
      const replacement = await worker(f.actor); await complete(replacement, f.route, f.count); state = await quiescent(replacement); await terminate(replacement, "stop");
    }
    assert.equal(await snapshot(), f.before); assert.deepEqual((await audits(f)).slice(0, priorAudit.length), priorAudit);
    await waitFor(async () => (await fs.readdir("/dev/fd")).length === parentFds, "Parent FD count did not return to this round's baseline");
    assert.deepEqual((await fs.readdir(scratch)).sort(), names); await knownConnections();
    observations.push({ round: round + 1, kind, parentFdBefore: parentFds, parentFdAfter: (await fs.readdir("/dev/fd")).length,
      childFdBefore: w.baseline.fdCount, childFdAfterRecovery: state.fdCount, nativeResourceCounts: state.resourceCounts, maxExtraReaders: state.maxReaders,
      ownedEmptyResidueBeforeCleanup: residue, positiveExit: w.exit, terminalSql: w.sqlTerminalObservations, nextFreshAuthorizationSucceeded: true });
  }
  assert.equal(observations.length, 10); t.diagnostic(JSON.stringify({ functionalLifecycleOnlyNotCapacityOrSoak: true, rounds: observations }));
});
integrationTest("ST041-ED18 real pagination empty filtered PREVIEW FROZEN default row cap and legal TIME_LIMIT preserve CSV contract", { timeout: 360000 }, async t => {
  const observations = [], f = await fixture(503);
  const [lineIds] = await db.execute("SELECT id FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY id", [f.id]);
  await db.execute("UPDATE inventory_stocktake_lines SET snapshot_quantity=5,counted_quantity=3 WHERE id=?", [lineIds[0].id]);
  await db.execute("UPDATE inventory_stocktake_lines SET snapshot_quantity=5,counted_quantity=NULL,is_not_found=1 WHERE id=?", [lineIds[1].id]);
  f.before = await snapshot(); const offset = f.w.messages.length, preview = await complete(f.w, f.route, f.count);
  assert.deepEqual(preview.csv.stages, ["PREVIEW"]); assert.equal(preview.csv.invalidUncounted, 0);
  assert.deepEqual(preview.csv.firstLineIds, lineIds.map(row => String(row.id)));
  assert.equal(preview.csv.orderedLineIdsSha256, createHash("sha256").update(JSON.stringify(lineIds.map(row => String(row.id)))).digest("hex"));
  assert.ok(preview.csv.uncounted.length > 0); assert.ok(preview.csv.uncounted.every(row => row.actualQuantity === "" && row.varianceQuantity === ""));
  const batches = f.w.messages.slice(offset).filter(message => message.type === "lineSqlCompleted");
  assert.ok(batches.some(message => message.returnedRows === 500)); assert.ok(batches.some(message => message.returnedRows === 3));
  const filtered = await complete(f.w, `${f.route}?progress=NOT_FOUND&variance=LOSS`, 1);
  assert.deepEqual(filtered.csv.lineSamples, [{ countState: "NOT_FOUND", actualQuantity: "0", varianceQuantity: "-5" }]); assert.equal(filtered.csv.footer.filteredLineCount, "1");
  assert.deepEqual(filtered.csv.firstLineIds, [String(lineIds[1].id)]);
  assert.equal(await snapshot(), f.before);
  await db.execute("UPDATE inventory_stocktake_lines SET counted_quantity=COALESCE(counted_quantity,0) WHERE stocktake_id=? AND is_not_found=0", [f.id]);
  const ready = await f.w.request(`${ROOT}/${f.id}/ready`, { source: source(), expectedVersion: f.version }); assert.equal(ready.status, 200);
  f.before = await snapshot(); const frozen = await complete(f.w, `${f.route}?variance=LOSS`, 2); assert.deepEqual(frozen.csv.stages, ["FROZEN"]);
  assert.deepEqual(frozen.csv.firstLineIds, lineIds.slice(0, 2).map(row => String(row.id)));
  assert.equal(await snapshot(), f.before);
  const auth = f.w.messages.slice(offset).filter(message => message.type === "authorizationSqlCompleted");
  assert.ok(auth.length >= 4); assert.ok(auth.every(message => message.role === "primary"));
  assert.ok(f.w.messages.slice(offset).some(message => message.type === "auditSqlCompleted" && message.outcome === "SUCCEEDED" && f.w.connections.get(message.threadId) === "primary"));
  await quiescent(f.w); await terminate(f.w, "stop"); observations.push({ previewLines: preview.csv.lines, actualBatchSizes: batches.map(message => message.returnedRows), filteredPreviewLines: filtered.csv.lines, frozenLossLines: frozen.csv.lines, primaryAuthorizationSqlCalls: auth.length });

  const empty = await fixture(0), emptyResult = await complete(empty.w, empty.route, 0);
  assert.equal(emptyResult.csv.scopes, 1); assert.equal(emptyResult.csv.records, 2); assert.equal(emptyResult.csv.footer.filteredLineCount, "0"); assert.equal(await snapshot(), empty.before); await quiescent(empty.w); await terminate(empty.w, "stop");

  const timed = await fixture(1, { exportTimeoutMs: 1000 }, 2); await timed.w.configure({ processingDelay: 1100 });
  const timedResult = await timed.w.request(timed.route); assert.equal(timedResult.status, 200); assert.equal(timedResult.ended, true);
  assert.equal(timedResult.headers["x-inventory-export-reason"], "TIME_LIMIT"); assert.equal(timedResult.headers["x-inventory-export-truncated"], "true");
  assert.equal(timedResult.csv.footer.truncationReason, "TIME_LIMIT"); assert.equal(timedResult.csv.footer.generationBudgetMs, "1000");
  assert.equal(timedResult.csv.footer.scopeCount, "2"); assert.equal(timedResult.csv.footer.exportedRows, "0"); assert.equal(timedResult.csv.lines, 0); assert.equal(timedResult.csv.scopes, 0);
  const timedState = await quiescent(timed.w); assert.ok(timedState.schedulingElapsedMs >= 1000); assert.equal(await snapshot(), timed.before);
  observations.push({ controlledRealScopeRowProcessingScheduling: true, realSqlValuesPreserved: true, timeServiceUnchanged: true, configuredBudgetMs: 1000, actualHeaderToAccessorElapsedMs: timedState.schedulingElapsedMs, truncationReason: timedResult.csv.footer.truncationReason });
  await timed.w.configure({}); await complete(timed.w, timed.route, timed.count); await quiescent(timed.w); await terminate(timed.w, "stop");

  const capped = await fixture(100001), capResult = await complete(capped.w, capped.route, 99999);
  const [capIds] = await db.execute("SELECT id FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY id LIMIT 99999", [capped.id]);
  assert.equal(capResult.csv.orderedLineIdsSha256, createHash("sha256").update(JSON.stringify(capIds.map(row => String(row.id)))).digest("hex"));
  assert.equal(capResult.csv.footer.exportedRows, "100000"); assert.equal(capResult.csv.footer.filteredLineCount, "100001");
  assert.equal(capResult.headers["x-inventory-export-reason"], "ROW_LIMIT"); assert.equal(capResult.csv.footer.truncationReason, "ROW_LIMIT");
  assert.equal(capResult.headers["x-inventory-export-truncated"], "true"); assert.equal(capResult.csv.footer.truncated, "true"); assert.equal(capResult.csv.invalidUncounted, 0);
  assert.equal(await snapshot(), capped.before); await quiescent(capped.w); await terminate(capped.w, "stop");
  observations.push({ configuredDefaultRowCapUnchanged: 100000, fixtureLines: 100001, actualExportedRows: Number(capResult.csv.footer.exportedRows), actualLines: capResult.csv.lines, reason: capResult.csv.footer.truncationReason, generatedBytes: capResult.bytes });
  t.diagnostic(JSON.stringify(observations));
});

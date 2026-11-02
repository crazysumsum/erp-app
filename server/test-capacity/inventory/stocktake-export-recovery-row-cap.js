import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import path from "node:path";
import { setImmediate, setTimeout } from "node:timers/promises";
import test, { before, after, afterEach } from "node:test";
import { createConnection } from "mysql2/promise";
import { hashPassword } from "../../src/modules/user/passwordHash.js";



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

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate, setTimeout } from "node:timers/promises";
import test, { before, after } from "node:test";
import { createConnection } from "mysql2/promise";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { InventoryStocktakeService } from "../../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryTransferService } from "../../src/modules/inventory/InventoryTransferService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { issueInventoryHighRiskContext } from "../../src/modules/inventory/inventoryHighRiskContext.js";
import { issueInventoryStocktakeCancelContext } from "../../src/modules/inventory/inventoryStocktakeCancelContext.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_SAFETY_TESTS === "1";
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 90000 }, work);
const ROOT = "/api/v1/inventory/stocktakes", children = new Set(), observations = [];
const time = { nowMs: () => Date.now(), fileDate: () => new Date().toISOString().slice(0, 10) }, logger = { error() {} };
const tables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_bin_locks", "inventory_stock_balances",
  "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_transfers", "inventory_transfer_lines", "inventory_reservations", "inventory_allocations", "inventory_operation_requests"];
let app, db, origin, operator, adjuster, receiving, returning, fulfillment, uomId, skuId, interval, nextAt = 0, binSequence = 0;

async function actor(permissions, device = false) {
  const now = Date.now(), name = `st041-${randomUUID()}`, password = randomBytes(32).toString("hex");
  const [role] = await db.execute("INSERT INTO roles (name,created_at) VALUES (?,?)", [name, now]);
  for (const permission of permissions) {
    const [insert] = await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
    assert.equal(insert.affectedRows, 1, `existing permission ${permission} must exist`);
  }
  const [user] = await db.execute("INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic Safety041',?,?)", [name, await hashPassword(password), now, now]);
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
  await db.execute("INSERT INTO fr_token_versions (subject,version,updated_at) VALUES (?,0,?)", [String(user.insertId), now]);
  const who = { id: Number(user.insertId), roleId: Number(role.insertId), role: name, permissions, password };
  if (device) {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    who.privateKey = keys.privateKey; const publicKey = keys.publicKey.export({ type: "spki", format: "der" });
    who.did = app.services.require("deviceBinding").deviceIdFor(publicKey);
    await db.execute("INSERT INTO user_devices (user_id,device_id,public_key,status,requested_at) VALUES (?,?,?,'approved',?)", [who.id, who.did, publicKey, now]);
  }
  const version = await app.services.require("tokenRevocation").currentVersion(String(who.id));
  who.token = app.services.require("jwt").issue({ roles: [name], permissions, ...(who.did ? { did: who.did } : {}) }, { subject: String(who.id), version, authTime: Math.floor(now / 1000) });
  return who;
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task041_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task041-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  assert.ok(process.env.HARNESS_RUN_DIR, "owned evidence directory required");
  const config = defaultConfigurationSource(); interval = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  const logging = { ...config.logging, loggers: Object.fromEntries(Object.entries(config.logging.loggers).map(([name, value]) => [name, { ...value, directory: path.join(process.env.HARNESS_RUN_DIR, "api-logs", name) }])) };
  app = await createApplication({ configurationSource: { ...config, logging, application: { ...config.application, host: "127.0.0.1", port: 0 }, jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } },
    handlerRegistryOptions: { moduleUrls: ["stocktakeHandlers.js", "postingHandlers.js", "transferHandlers.js"].map(name => new URL(`../../src/handlers/inventory/${name}`, import.meta.url).href) } });
  db = app.services.require("mysqldatabase");
  const [[actual]] = await db.query("SELECT VERSION() AS version,@@skip_networking AS isolated,DATABASE() AS name,@@datadir AS datadir");
  assert.deepEqual([actual.version, Number(actual.isolated), actual.name, actual.datadir], ["26.7.0", 1, process.env.DB_NAME, path.dirname(process.env.DB_SOCKET_PATH) + "/data/"]);
  const migrations = (await fs.readdir(new URL("../../database/migrations/", import.meta.url))).filter(name => /\.(?:js|sql)$/u.test(name)).map(name => `migrations/${name}`);
  assert.deepEqual((await db.query("SELECT name FROM fr_schema_migrations ORDER BY name"))[0].map(row => row.name), [...migrations, "framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"].sort());
  operator = await actor(["inventory.view", "inventory.operation"]); adjuster = await actor(["inventory.view", "inventory.adjust"], true);
  // Downstream modules are absent: seed only their existing fixed contracts in this owned synthetic schema.
  for (const permission of ["receiving.operation", "returns.operation"]) await db.execute("INSERT IGNORE INTO permissions (name,description,created_at) VALUES (?,'Synthetic existing provider contract',?)", [permission, Date.now()]);
  receiving = await actor(["receiving.operation"]); returning = await actor(["returns.operation"]); fulfillment = await actor(["fulfillment.operation"]);
  const now = Date.now(), code = randomUUID();
  uomId = Number((await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", ["EA" + code.slice(0, 8), now, now]))[0].insertId);
  const itemId = (await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Synthetic041','standard','active',?,?)", [now, now]))[0].insertId;
  skuId = Number((await db.execute("INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,'Safety plain','none',1,1,1,'active',?,?)", [itemId, code, now, now]))[0].insertId);
  await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [skuId, uomId, now, now]);
  origin = (await app.start()).url;
  observations.push({ kind: "realRuntime", mysql: actual.version, schema: actual.name, synthetic: true, parentPid: process.pid });
});
after(async () => {
  let failure;
  for (const child of [...children]) { try { await terminate(child); } catch (error) { failure ??= error; } }
  if (app) await app.shutdown("task041_safety_complete");
  if (enabled && process.env.HARNESS_RUN_DIR) await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, "stocktake-safety-observations.json"), JSON.stringify(observations, null, 2));
  if (failure) throw failure;
});
function command(purpose, payload, who = operator, eventId = randomUUID()) {
  return inventoryCommandFixture({ actor: { userId: who.id, serviceName: "", claimedRoles: [who.role], claimedPermissions: who.permissions },
    authorization: { purpose, requiredCallerPermission: purpose === "stocktake.post" || ["adjustment.post", "status_transfer.post", "movement.reverse"].includes(purpose) ? "inventory.adjust" : "inventory.operation" },
    source: { module: "INVENTORY", documentType: purpose.startsWith("stocktake.") ? "STOCKTAKE" : "SAFETY", documentId: "synthetic-task041", lineId: "", eventId }, correlationId: eventId, payload });
}
const options = () => ({ database: db, time, logger });
async function nativeProof(input) {
  const action = input.authorization.purpose, high = action !== "stocktake.cancel", authType = high ? "jwt-device-password" : "jwt-password", now = Date.now();
  const [[binding]] = high ? await db.query("SELECT * FROM user_devices WHERE user_id=? AND status='approved'", [input.actor.userId]) : [[]];
  const route = action === "stocktake.post" ? `${ROOT}/:id/post` : action === "stocktake.cancel" ? `${ROOT}/:id/cancel`
    : action === "adjustment.post" ? "/api/v1/inventory/adjustments" : action === "status_transfer.post" ? "/api/v1/inventory/status-transfers" : "/api/v1/inventory/movements/:id/reverse";
  const req = { method: "POST", apiRoute: { path: route, authType }, input: { params: action.startsWith("stocktake.") ? { id: String(input.payload.stocktakeId) } : action === "movement.reverse" ? { id: String(input.payload.movementId) } : {} }, get: () => String(now),
    auth: { type: authType, claims: { sub: String(input.actor.userId), roles: input.actor.claimedRoles, permissions: input.actor.claimedPermissions, ver: 0, exp: Math.floor(now / 1000) + 900, auth_time: Math.floor(now / 1000), ...(high ? { did: binding.device_id } : {}) }, ...(high ? { deviceBinding: binding } : {}) } };
  return (high ? issueInventoryHighRiskContext : issueInventoryStocktakeCancelContext)(req, input, { time, signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0 });
}
async function native(operation, input) {
  const [family, method] = operation.split(":");
  const service = family === "stocktake" ? new InventoryStocktakeService(options()) : family === "transfer" ? new InventoryTransferService(options()) : new InventoryPostingService(options());
  const proof = ["post", "cancel", "postAdjustment", "postStatusTransfer", "reverseMovement"].includes(method.replace(/InTransaction$/u, "")) ? await nativeProof(input) : undefined;
  return method.endsWith("InTransaction") ? db.withTransaction(tx => service[method](tx, input, proof)) : service[method](input, proof);
}
async function snapshot(includeAudit = true) {
  const state = {}; for (const table of [...tables, ...(includeAudit ? ["inventory_audit_logs"] : [])]) state[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return JSON.stringify(state);
}
async function stockEffects() {
  const state = {};
  for (const table of tables.filter(name => !name.startsWith("inventory_stocktake") && !["inventory_bin_locks", "inventory_operation_requests"].includes(name))) state[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return JSON.stringify(state);
}
async function terminalState(beforeText, f, action, input, result) {
  const before = JSON.parse(beforeText), actual = JSON.parse(await snapshot()), expected = structuredClone(before), posting = action === "post";
  const oldHeader = before.inventory_stocktakes.find(row => Number(row.id) === f.header.id), header = actual.inventory_stocktakes.find(row => Number(row.id) === f.header.id);
  const status = posting ? "POSTED" : "CANCELLED", prefix = posting ? "posted" : "cancelled";
  assert.equal(result.id, f.header.id); assert.equal(result.status, status); assert.equal(result.version, Number(oldHeader.version) + 1);
  assert.ok(Number.isSafeInteger(Number(header.updated_at)) && Number(header.updated_at) >= Number(oldHeader.updated_at) && Number(header.updated_at) <= Date.now());
  const expectedHeader = { ...oldHeader, status, reason: input.payload.reason.trim(), version: Number(oldHeader.version) + 1,
    updated_at: header.updated_at, updated_by: input.actor.userId, [`${action}_operation_id`]: result.operationId,
    [`${prefix}_at`]: header.updated_at, [`${prefix}_by`]: input.actor.userId };
  expected.inventory_stocktakes = expected.inventory_stocktakes.map(row => Number(row.id) === f.header.id ? expectedHeader : row);
  const changed = before.inventory_stocktake_lines.filter(row => Number(row.stocktake_id) === f.header.id && posting && Number(row.variance_quantity) !== 0);
  const oldIds = name => new Set(before[name].map(row => Number(row.id)));
  const additions = name => actual[name].filter(row => !oldIds(name).has(Number(row.id)));
  const movements = additions("inventory_movements"), audits = additions("inventory_audit_logs"), operations = additions("inventory_operation_requests");
  assert.equal(movements.length, changed.length); assert.equal(operations.length, 1); assert.equal(audits.length, changed.length + 1);
  assert.equal(result.rowCount, posting ? changed.length : before.inventory_stocktake_bins.filter(row => Number(row.stocktake_id) === f.header.id).length);
  for (const line of changed) {
    const matches = movements.filter(row => Number(row.stocktake_line_id) === Number(line.id)); assert.equal(matches.length, 1);
    const movement = matches[0], balance = before.inventory_stock_balances.find(row => Number(row.id) === Number(line.stock_balance_id));
    assert.ok(balance, "this fixture uses existing Buckets");
    assert.deepEqual([Number(movement.operation_request_id), Number(movement.stocktake_id), movement.movement_type, movement.location_kind,
      Number(movement.warehouse_id), Number(movement.bin_id), Number(movement.sku_id), movement.lot_id, movement.stock_status,
      movement.direction, Number(movement.quantity), Number(movement.balance_before), Number(movement.balance_after), Number(movement.balance_version_after), Number(movement.posted_by)],
    [result.operationId, f.header.id, "STOCKTAKE_VARIANCE", "BIN", f.warehouseId, Number(line.bin_id), Number(line.sku_id), line.lot_id, line.stock_status,
      Number(line.variance_quantity) > 0 ? "IN" : "OUT", Math.abs(Number(line.variance_quantity)), Number(line.snapshot_quantity), Number(line.snapshot_quantity) + Number(line.variance_quantity), Number(balance.version) + 1, input.actor.userId]);
    assert.equal(movement.movement_group_id, result.movementGroupId); assert.equal(Number(movement.posted_at), Number(header.updated_at));
    expected.inventory_stock_balances = expected.inventory_stock_balances.map(row => Number(row.id) === Number(balance.id) ? { ...row,
      on_hand_quantity: Number(line.snapshot_quantity) + Number(line.variance_quantity), version: Number(row.version) + 1, updated_at: header.updated_at,
      fifo_anchor_date: Number(line.snapshot_quantity) + Number(line.variance_quantity) === 0 ? null : row.fifo_anchor_date } : row);
    expected.inventory_stocktake_lines = expected.inventory_stocktake_lines.map(row => Number(row.id) === Number(line.id) ? { ...row, movement_id: movement.id, version: Number(row.version) + 1 } : row);
    const lineAudits = audits.filter(row => Number((typeof row.after_summary === "string" ? JSON.parse(row.after_summary) : row.after_summary)?.id) === Number(line.id));
    assert.equal(lineAudits.length, 1); const summary = typeof lineAudits[0].after_summary === "string" ? JSON.parse(lineAudits[0].after_summary) : lineAudits[0].after_summary;
    assert.equal(Number(summary.movementId), Number(movement.id)); assert.equal(Number(summary.quantity), Number(movement.balance_after));
  }
  expected.inventory_bin_locks = expected.inventory_bin_locks.map(row => Number(row.stocktake_id) === f.header.id ? { ...row,
    released_at: header.updated_at, released_by: input.actor.userId, release_reason: status, active_scope: null } : row);
  for (const row of audits) assert.deepEqual([row.outcome, row.action, Number(row.actor_user_id), Number(row.operation_request_id), Number(row.target_id)],
    ["SUCCEEDED", `stocktake.${action}`, input.actor.userId, result.operationId, f.header.id]);
  const summaries = audits.map(row => typeof row.after_summary === "string" ? JSON.parse(row.after_summary) : row.after_summary);
  assert.equal(summaries.filter(row => row.status === status && Number(row.version) === result.version && Number(row.rowCount) === result.rowCount).length, 1);
  if (!posting) {
    const audit = audits[0], [[actorRow]] = await db.query("SELECT username FROM users WHERE id=?", [input.actor.userId]);
    assert.deepEqual(typeof audit.before_summary === "string" ? JSON.parse(audit.before_summary) : audit.before_summary,
      { stocktakeId: f.header.id, status: oldHeader.status, version: Number(oldHeader.version) });
    assert.deepEqual(summaries[0], { stocktakeId: f.header.id, status, version: result.version, rowCount: result.rowCount });
    assert.deepEqual([audit.actor_label, audit.target_type, audit.target_label, audit.reason_category, audit.reason_text, audit.request_id, audit.correlation_id, audit.ip],
      [actorRow.username, "stocktake", oldHeader.stocktake_number, "", input.payload.reason.trim(), input.correlationId, input.correlationId, ""]);
    assert.ok(Number(audit.occurred_at) >= Number(header.updated_at) && Number(audit.occurred_at) <= Date.now());
  }
  const operation = operations[0];
  assert.deepEqual([Number(operation.id), operation.command_type, operation.result_type, String(operation.result_id), Number(operation.actor_user_id)],
    [result.operationId, posting ? "STOCKTAKE_POST" : "STOCKTAKE_CANCEL", "STOCKTAKE", String(f.header.id), input.actor.userId]);
  assert.equal(Number(operation.completed_at), Number(header.updated_at));
  assert.deepEqual(typeof operation.result_summary === "string" ? JSON.parse(operation.result_summary) : operation.result_summary, result);
  assert.deepEqual(await new InventoryOperationService().findBySource(db, { source: input.source }), { operationId: result.operationId, resultType: "STOCKTAKE", resultId: String(f.header.id), resultSummary: result, completedAt: Number(header.updated_at) });
  for (const [name, rows] of [["inventory_movements", movements], ["inventory_operation_requests", operations], ["inventory_audit_logs", audits]]) expected[name].push(...rows);
  // Exact whole-state equality preserves foreign locks, frozen fields and all pre-existing history.
  assert.deepEqual(actual, expected);
}
async function authority(kind, revoked) {
  let changed;
  if (kind === "role") changed = revoked
    ? (await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.adjust'", [adjuster.roleId]))[0]
    : (await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.adjust'", [adjuster.roleId]))[0];
  if (kind === "device") changed = (await db.execute("UPDATE user_devices SET status=? WHERE user_id=?", [revoked ? "revoked" : "approved", adjuster.id]))[0];
  if (kind === "jwt") changed = (await db.execute("UPDATE fr_token_versions SET version=? WHERE subject=?", [revoked ? 1 : 0, String(adjuster.id)]))[0];
  assert.equal(changed.affectedRows, 1, "authority fixture must actually change exactly its owned row");
}
async function rejected(work, code = "BIN_LOCKED_BY_STOCKTAKE", http = false) {
  const before = await snapshot(!http), priorAudit = Number((await db.query("SELECT COALESCE(MAX(id),0) AS id FROM inventory_audit_logs"))[0][0].id);
  if (http) {
    const result = await work(); assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(result.body)); assert.equal(result.body.error.code, code);
    const [added] = await db.query("SELECT * FROM inventory_audit_logs WHERE id>?", [priorAudit]);
    assert.ok(added.every(row => ["REJECTED", "FAILED"].includes(row.outcome)), "rejected attempts must never record successful business Audit");
  } else await assert.rejects(work, { code });
  assert.equal(await snapshot(!http), before);
}
async function warehouse() {
  const code = randomUUID(), now = Date.now();
  return Number((await db.execute("INSERT INTO inventory_warehouses (warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,?)", [code, code, code, now, now]))[0].insertId);
}
async function bin(warehouseId) { const code = `B${String(++binSequence).padStart(6, "0")}-${randomUUID().slice(0, 8)}`; return Number((await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?,1,1)", [warehouseId, code, code]))[0].insertId); }
function receipt(f, binId = f.bins[0], quantity = 10, changes = {}) { return command("receipt.post", { skuId, uomId, warehouseId: f.warehouseId, binId, quantity, stockStatus: "AVAILABLE", ...changes }); }
async function fixture(count = 2) {
  const f = { warehouseId: await warehouse(), bins: [] };
  for (let i = 0; i < count; i++) { f.bins.push(await bin(f.warehouseId)); await native("writer:postReceipt", receipt(f, f.bins[i])); }
  return f;
}
async function draft(f, bins = f.bins) { f.header = await native("stocktake:create", command("stocktake.create", { warehouseId: f.warehouseId, binIds: bins })); return f; }
function workflow(f, action, changes = {}) { return command(`stocktake.${action}`, { stocktakeId: f.header.id, expectedVersion: f.header.version, ...(["post", "cancel"].includes(action) ? { reason: "Synthetic physical reconciliation" } : {}), ...changes }, action === "post" ? adjuster : operator); }
async function counting(f, bins = f.bins) { await draft(f, bins); f.header = await native("stocktake:start", workflow(f, "start")); return f; }
async function lines(f) { return (await db.query("SELECT * FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY id", [f.header.id]))[0]; }
async function ready(f, quantities) {
  const rows = await lines(f);
  if (rows.length) await native("stocktake:saveCounts", command("stocktake.count", { stocktakeId: f.header.id, lines: rows.map((row, i) => ({ lineId: Number(row.id), expectedVersion: Number(row.version), ...(quantities?.[i] === null ? { notFound: true } : { countedQuantity: quantities?.[i] ?? Number(row.snapshot_quantity) + 1 }) })) }));
  f.header = await native("stocktake:ready", workflow(f, "ready")); return f;
}
async function balances(f) { return (await db.query("SELECT * FROM inventory_stock_balances WHERE warehouse_id=? ORDER BY id", [f.warehouseId]))[0]; }
async function waitFor(check, message, milliseconds = 10000) {
  const stop = performance.now() + milliseconds;
  while (performance.now() < stop) { if (await check()) return; await setImmediate(); }
  assert.fail(message);
}
async function processJob(operation, input, checkpoint, keepAlive = false) {
  const child = fork(new URL("../../test-support/inventoryStocktakeSafetyChild.js", import.meta.url), [], { detached: true, execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"], env: {
    PATH: process.env.PATH, DB_NAME: process.env.DB_NAME, DB_SOCKET_PATH: process.env.DB_SOCKET_PATH, DB_USER: process.env.DB_USER, DB_PASSWORD: process.env.DB_PASSWORD,
    DB_INTEGRATION_TESTS: "1", INVENTORY_STOCKTAKE_SAFETY_TESTS: "1"
  } });
  const entry = { child, messages: [], stderr: "", connections: new Set(), transactions: new Set(), exit: null, workSent: false };
  children.add(entry); child.on("message", message => {
    entry.messages.push(message);
    if (["ready", "transaction"].includes(message.type)) {
      assert.ok(Number.isSafeInteger(message.threadId) && message.threadId > 0); entry.connections.add(message.threadId);
      if (message.type === "transaction") entry.transactions.add(message.threadId);
    }
  });
  child.stderr.on("data", chunk => { entry.stderr += chunk.toString(); });
  child.on("error", error => { entry.failure = error; }); child.on("exit", (code, signal) => { entry.exit = { code, signal }; });
  entry.message = async type => { let found; await waitFor(() => { found = entry.messages.find(message => message.type === type); if (!found && (entry.exit || entry.failure)) assert.fail(`owned child ended before ${type}: ${entry.failure?.code ?? entry.exit?.code}`); return found; }, `owned child did not reach ${type}`); return found; };
  await entry.message("ready"); assert.ok(child.pid > 1 && child.pid !== process.pid);
  entry.workSent = true; child.send({ type: "run", operation, input, checkpoint, keepAlive });
  return entry;
}
async function finish(entry) {
  const response = await entry.message("result");
  await waitFor(() => entry.exit !== null, "owned child failed to terminate"); children.delete(entry);
  assert.equal(entry.exit.code, 0); assert.equal(entry.stderr, "");
  if (!response.ok) throw Object.assign(new Error("native child command rejected"), { code: response.error.code });
  return response.result;
}
async function terminate(entry) {
  if (!entry.exit) { assert.ok(entry.child.pid > 1 && children.has(entry)); process.kill(-entry.child.pid, "SIGKILL"); await waitFor(() => entry.exit !== null, "owned SIGKILL exit not observed"); }
  for (const threadId of entry.connections) {
    await waitFor(async () => Number((await db.query("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID=?", [threadId]))[0][0].n) === 0 && Number((await db.query("SELECT COUNT(*) AS n FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?", [threadId]))[0][0].n) === 0, "owned connection/transaction termination not observed");
  }
  assert.ok(!entry.workSent || entry.connections.size > 0, "no work may begin without an observed owned connection");
  observations.push({ kind: "ownedChildTerminated", pid: entry.child.pid, connectionIds: [...entry.connections], transactionIds: [...entry.transactions], exit: entry.exit, databaseConnectionsGone: entry.connections.size > 0, noWorkSentBeforeReady: !entry.workSent }); children.delete(entry);
}
async function warehouseWait(entry) {
  const message = await entry.message("warehouseAttempt");
  await waitFor(async () => Number((await db.query(`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
    JOIN performance_schema.threads t ON t.thread_id=w.requesting_thread_id JOIN performance_schema.data_locks l ON l.engine_lock_id=w.requesting_engine_lock_id AND l.engine=w.engine
    WHERE t.processlist_id=? AND l.object_schema=? AND l.object_name='inventory_warehouses'`, [message.threadId, process.env.DB_NAME]))[0][0].n) > 0, "real Warehouse SQL wait not observed");
  observations.push({ kind: "actualWarehouseWait", pid: entry.child.pid, connectionId: message.threadId });
}
const warehouseBarrier = { stage: "afterQuery", pattern: "FROM inventory_warehouses[\\s\\S]*FOR UPDATE", nth: 1 };
async function race(firstOperation, firstInput, secondOperation, secondInput, duringWait = async () => {}) {
  const first = await processJob(firstOperation, firstInput, warehouseBarrier); let second;
  try {
    await first.message("checkpoint"); second = await processJob(secondOperation, secondInput); await warehouseWait(second); await duringWait();
    first.child.send({ type: "release" });
    return await Promise.all([finish(first).then(value => ({ value }), error => ({ error })), finish(second).then(value => ({ value }), error => ({ error }))]);
  } finally { if (children.has(first)) await terminate(first); if (second && children.has(second)) await terminate(second); }
}

function signedHeaders(who, body, route) {
  const device = app.services.require("deviceBinding"), timestamp = Date.now(), nonce = randomUUID();
  const input = device.signingInput({ accessTokenHash: device.accessTokenHash(who.token), bodyHash: device.bodyHash(Buffer.from(JSON.stringify(body))), deviceId: who.did, method: "POST", nonce, path: route, timestamp });
  return { "X-Device-Id": who.did, "X-Device-Timestamp": String(timestamp), "X-Device-Nonce": nonce,
    "X-Device-Signature": sign("sha256", Buffer.from(input), { key: who.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
}
async function httpWriter(w) {
  const at = Math.max(nextAt, performance.now()); nextAt = at + interval;
  if (at > performance.now()) await setTimeout(at - performance.now());
  const high = w.input.actor.userId === adjuster.id, who = high ? adjuster : operator;
  const { expectedVersion, transferId, movementId, ...payload } = w.input.payload;
  const route = w.kind === "receipt" ? "/api/v1/inventory/receipts" : w.kind === "issue" ? "/api/v1/inventory/issues"
    : w.kind.startsWith("move") ? "/api/v1/inventory/bin-moves" : w.kind.startsWith("adjust") ? "/api/v1/inventory/adjustments"
      : w.kind === "status" ? "/api/v1/inventory/status-transfers" : w.kind === "reverse" ? `/api/v1/inventory/movements/${movementId}/reverse` : `/api/v1/inventory/transfers/${transferId}/${w.kind}`;
  const body = { source: w.input.source, ...payload, ...(expectedVersion === undefined ? {} : { version: expectedVersion }), ...(high ? { password: who.password } : {}) };
  const result = await fetch(origin + route, { method: "POST", headers: { Authorization: `Bearer ${who.token}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...(high ? signedHeaders(who, body, route) : {}) }, body: JSON.stringify(body) });
  return { status: result.status, body: await result.json() };
}
async function issueCommand(f) {
  const reservations = new InventoryReservationService(options());
  const reserved = await reservations.create(command("reservation.create", { skuId, warehouseId: f.warehouseId, quantity: 12, purpose: "SALE", minimumRemainingDays: 0 }));
  const current = await balances(f), allocated = await reservations.allocate(command("allocation.create", { reservationId: reserved.id, expectedVersion: reserved.version,
    allocations: current.slice(0, 2).map((row, index) => ({ balanceId: Number(row.id), expectedVersion: Number(row.version), quantity: index === 0 ? 10 : 2 })) }));
  return command("issue.post", { reservationId: reserved.id, expectedVersion: allocated.version,
    lines: allocated.allocations.map(row => ({ allocationId: row.id, expectedVersion: row.version, balanceId: row.balanceId, expectedBalanceVersion: row.balanceVersion, quantity: 1 })) });
}
async function makeWriter(kind, sourceStatus = "AVAILABLE", destinationStatus = "DAMAGED") {
  let f = await fixture(); let input, operation;
  const current = await balances(f);
  if (kind === "receipt") { input = receipt(f); operation = "writer:postReceipt"; }
  if (kind === "issue") { input = await issueCommand(f); operation = "writer:postIssue"; }
  if (kind.startsWith("move")) {
    input = command("bin_move.post", { warehouseId: f.warehouseId, reason: "Synthetic move", lines: [{ sourceBalanceId: Number(current[0].id), destinationBinId: f.bins[1], quantity: 1,
      expectedSourceVersion: Number(current[0].version), expectedDestinationVersion: Number(current[1].version) }] }); operation = "writer:postBinMove";
  }
  if (kind === "adjustIn") {
    input = command("adjustment.post", { direction: "IN", warehouseId: f.warehouseId, binId: f.bins[0], skuId, stockStatus: "AVAILABLE", expectedBalanceVersion: Number(current[0].version), quantity: 1, uomId, reasonCategory: "COUNT_GAIN", reasonText: "Synthetic physical gain" }, adjuster); operation = "writer:postAdjustment";
  }
  if (kind === "adjustOut") {
    input = command("adjustment.post", { direction: "OUT", balanceId: Number(current[0].id), expectedBalanceVersion: Number(current[0].version), quantity: 1, uomId, reasonCategory: "COUNT_LOSS", reasonText: "Synthetic physical loss" }, adjuster); operation = "writer:postAdjustment";
  }
  if (kind === "status") {
    if (sourceStatus !== "AVAILABLE") await native("writer:postReceipt", receipt(f, f.bins[0], 10, { stockStatus: sourceStatus }));
    const rows = await balances(f), source = rows.find(row => Number(row.bin_id) === f.bins[0] && row.stock_status === sourceStatus), destination = rows.find(row => Number(row.bin_id) === f.bins[0] && row.stock_status === destinationStatus);
    input = command("status_transfer.post", { sourceBalanceId: Number(source.id), destinationStatus, expectedSourceVersion: Number(source.version), expectedDestinationVersion: destination ? Number(destination.version) : null, quantity: 1, uomId, reasonText: "Synthetic status correction" }, adjuster); operation = "writer:postStatusTransfer";
  }
  if (kind === "reverse") {
    const moved = await native("writer:postBinMove", command("bin_move.post", { warehouseId: f.warehouseId, reason: "Reversible group", lines: [{ sourceBalanceId: Number(current[0].id), destinationBinId: f.bins[1], quantity: 1, expectedSourceVersion: Number(current[0].version), expectedDestinationVersion: Number(current[1].version) }] }));
    const [[movement]] = await db.query("SELECT id FROM inventory_movements WHERE movement_group_id=? ORDER BY id LIMIT 1", [moved.movementGroupId]);
    input = command("movement.reverse", { movementId: Number(movement.id), reasonText: "Synthetic complete group reversal", expectedBalances: (await balances(f)).map(row => ({ balanceId: Number(row.id), expectedVersion: Number(row.version) })) }, adjuster); operation = "writer:reverseMovement";
  }
  if (kind === "dispatch" || kind === "receive") {
    const destinationWarehouseId = await warehouse(), destinationBins = [await bin(destinationWarehouseId), await bin(destinationWarehouseId)];
    const created = await native("transfer:create", command("transfer.create", { sourceWarehouseId: f.warehouseId, destinationWarehouseId, lines: f.bins.map(sourceBinId => ({ skuId, lotId: null, sourceBinId, stockStatus: "AVAILABLE", quantity: 1 })) }));
    input = command("transfer.dispatch", { transferId: created.id, expectedVersion: created.version }); operation = "transfer:dispatch";
    if (kind === "receive") {
      const dispatched = await native(operation, input), [transferLines] = await db.query("SELECT id,quantity FROM inventory_transfer_lines WHERE transfer_id=? ORDER BY id", [created.id]);
      input = command("transfer.receive", { transferId: created.id, expectedVersion: dispatched.version, lines: transferLines.map((row, i) => ({ id: Number(row.id), quantity: Number(row.quantity), destinationBinId: destinationBins[i] })) }); operation = "transfer:receive";
      f = { warehouseId: destinationWarehouseId, bins: destinationBins };
    }
  }
  assert.ok(input && operation); return { kind, f, input, operation, code: kind === "reverse" ? "REVERSAL_NOT_ALLOWED" : "BIN_LOCKED_BY_STOCKTAKE" };
}
const writerKinds = ["receipt", "issue", "moveSource", "moveDestination", "dispatch", "receive", "adjustIn", "adjustOut", "status", "reverse"];
async function lockWriter(w, frozen) {
  await counting(w.f, [w.f.bins[["receipt", "adjustIn", "adjustOut", "status", "moveSource"].includes(w.kind) ? 0 : w.f.bins.length - 1]]);
  if (frozen) await ready(w.f);
}
async function writerBoundary(kind, variants = [false, true]) {
  for (const frozen of variants) {
    const w = await makeWriter(kind);
    // An independent unlocked fixture establishes the same route/caller/data can actually commit.
    const control = await makeWriter(kind); assert.ok((await native(control.operation, control.input)).operationId);
    const httpControl = await makeWriter(kind), response = await httpWriter(httpControl); assert.equal(response.status, 200, JSON.stringify(response.body));
    await lockWriter(w, frozen); await rejected(() => native(w.operation, w.input), w.code); await rejected(() => httpWriter(w), w.code, true);
    if (kind.startsWith("move")) {
      const aliasControl = await makeWriter(kind); assert.ok((await native("writer:postBinMoveInTransaction", aliasControl.input)).operationId);
      await rejected(() => native("writer:postBinMoveInTransaction", w.input));
    }
    observations.push({ kind: "writerBoundary", writer: kind, phase: frozen ? "READY_TO_POST" : "COUNTING", nativeAndRealHttp: true, unlockedControls: true, code: w.code });
  }
}

integrationTest("ST041-S01 valid real HTTP Receipt rejects COUNTING/READY locked destination with no effects", async () => { await writerBoundary("receipt"); });
integrationTest("ST041-S02 ordinary/Receiving/Customer Return native aliases keep fixed authority and caller rollback", async () => {
  for (const frozen of [false, true]) for (const alias of ["postReceiptInTransaction", "postReceivingReceiptInTransaction", "postCustomerReturnReceiptInTransaction"]) {
    const w = await makeWriter("receipt"), control = await makeWriter("receipt"), who = alias === "postReceivingReceiptInTransaction" ? receiving : alias === "postCustomerReturnReceiptInTransaction" ? returning : operator;
    const input = f => {
      const request = receipt(f); if (alias === "postReceiptInTransaction") return request;
      return { actor: { userId: who.id, serviceName: "", claimedRoles: [who.role], claimedPermissions: who.permissions }, source: { documentId: randomUUID(), lineId: "1", eventId: randomUUID() }, correlationId: randomUUID(), payload: { ...request.payload, stockStatus: alias === "postCustomerReturnReceiptInTransaction" ? "QUARANTINED" : "AVAILABLE" } };
    };
    const run = body => db.withTransaction(async tx => { const result = await new InventoryPostingService(options())[alias](tx, body); return result; });
    assert.ok((await run(input(control.f))).operationId); await counting(w.f, [w.f.bins[0]]); if (frozen) await ready(w.f);
    await rejected(() => run(input(w.f))); observations.push({ kind: "realInternalAlias", alias, permission: who.permissions, frozen });
  }
});
integrationTest("ST041-S03 real HTTP Issue locks a later allocated Bucket and preserves entire Reservation", async () => { await writerBoundary("issue"); });
integrationTest("ST041-S04 ordinary and Fulfillment Issue entrypoints reach the same lock with distinct fixed callers", async () => {
  for (const frozen of [false, true]) for (const method of ["postIssue", "postIssueInTransaction", "postFulfillmentIssueInTransaction"]) {
    const w = await makeWriter("issue"), control = await makeWriter("issue");
    const adapt = input => method !== "postFulfillmentIssueInTransaction" ? input : { actor: { userId: fulfillment.id, serviceName: "", claimedRoles: [fulfillment.role], claimedPermissions: fulfillment.permissions }, source: { documentId: randomUUID(), lineId: "1", eventId: randomUUID() }, correlationId: input.correlationId, payload: input.payload };
    const run = input => method === "postIssue" ? native("writer:postIssue", adapt(input)) : db.withTransaction(tx => new InventoryPostingService(options())[method](tx, adapt(input)));
    assert.ok((await run(control.input)).operationId); await lockWriter(w, frozen); await rejected(() => run(w.input));
    observations.push({ kind: "realInternalAlias", method, permission: method === "postFulfillmentIssueInTransaction" ? "fulfillment.operation" : "inventory.operation", frozen });
  }
});
integrationTest("ST041-S05 Bin Move source lock rejects HTTP and caller-owned transaction without paired leg", async () => { await writerBoundary("moveSource"); });
integrationTest("ST041-S06 Bin Move destination lock protects existing and absent target Bucket", async () => {
  await writerBoundary("moveDestination");
  for (const frozen of [false, true]) {
    const w = await makeWriter("moveDestination"), destination = await bin(w.f.warehouseId); w.f.bins.push(destination); w.input.payload.lines[0].destinationBinId = destination; w.input.payload.lines[0].expectedDestinationVersion = null;
    const before = await snapshot(); await counting(w.f, [destination]); if (frozen) await ready(w.f);
    await rejected(() => native("writer:postBinMoveInTransaction", w.input)); await rejected(() => httpWriter(w), w.code, true);
    assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_stock_balances WHERE bin_id=?", [destination]))[0][0].n), 0); assert.ok(before);
  }
});
integrationTest("ST041-S07 whole Transfer Dispatch HTTP/native rejects a later locked source without partial transit", async () => { await writerBoundary("dispatch"); });
integrationTest("ST041-S08 whole Transfer Receive HTTP/native rejects later locked destination and no zero residue", async () => { await writerBoundary("receive"); });
integrationTest("ST041-S09 strong signed HTTP and native Adjustment IN/OUT respect active locks", async () => { await writerBoundary("adjustIn"); await writerBoundary("adjustOut"); });
integrationTest("ST041-S10 all six Status directions reject atomically under COUNTING and READY", async () => {
  for (const source of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) for (const destination of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    if (source === destination) continue;
    for (const frozen of [false, true]) {
      const control = await makeWriter("status", source, destination); assert.ok((await native(control.operation, control.input)).operationId);
      const w = await makeWriter("status", source, destination); await counting(w.f, [w.f.bins[0]]); if (frozen) await ready(w.f);
      await rejected(() => native(w.operation, w.input)); await rejected(() => httpWriter(w), w.code, true);
    }
  }
});
integrationTest("ST041-S11 real server-derived paired Reversal retains safe rejection contract and no inverse legs", async () => { await writerBoundary("reverse"); });
integrationTest("ST041-S12 original authorized reversible-writer replay stays identical after Start, new sources reject", async () => {
  for (const kind of ["receipt", "issue", "moveSource", "adjustIn", "adjustOut", "status", "reverse"]) {
    const w = await makeWriter(kind), original = await native(w.operation, w.input); await counting(w.f);
    const before = await snapshot(); assert.deepEqual(await native(w.operation, w.input), original); assert.equal(await snapshot(), before);
    const different = structuredClone(w.input); different.source.eventId = randomUUID(); different.correlationId = randomUUID();
    await rejected(() => native(w.operation, different), w.code);
    observations.push({ kind: "originalReplayAfterLock", writer: kind, exactOriginalOperation: original.operationId, noNewEffect: true });
  }
});
integrationTest("ST041-S13 Start-first real processes make every current writer wait then reject persistent locks", async () => {
  for (const kind of writerKinds) {
    const w = await makeWriter(kind); await draft(w.f); const before = await stockEffects(), history = JSON.parse(await snapshot());
    const result = await race("stocktake:start", workflow(w.f, "start"), w.operation, w.input);
    assert.equal(result[0].value.status, "COUNTING"); assert.equal(result[1].error.code, w.code);
    assert.equal(await stockEffects(), before); assert.equal(await new InventoryOperationService().findBySource(db, { source: w.input.source }), null);
    const after = JSON.parse(await snapshot());
    for (const name of ["inventory_movements", "inventory_operation_requests", "inventory_audit_logs"]) {
      const ids = new Set(history[name].map(row => Number(row.id)));
      assert.deepEqual(after[name].filter(row => ids.has(Number(row.id))), history[name]);
      const added = after[name].filter(row => !ids.has(Number(row.id))); assert.equal(added.length, name === "inventory_movements" ? 0 : 1);
      if (name === "inventory_operation_requests") assert.equal(Number(added[0].id), result[0].value.operationId);
      if (name === "inventory_audit_logs") assert.deepEqual([added[0].outcome, added[0].action, Number(added[0].operation_request_id)], ["SUCCEEDED", "stocktake.start", result[0].value.operationId]);
    }
    assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_movements WHERE stocktake_id=?", [w.f.header.id]))[0][0].n), 0);
  }
});
integrationTest("ST041-S14 writer-first real waits produce Start snapshots including every committed final Bucket", async () => {
  for (const kind of writerKinds) {
    const w = await makeWriter(kind); await draft(w.f);
    const result = await race(w.operation, w.input, "stocktake:start", workflow(w.f, "start")); assert.ok(result[0].value.operationId); w.f.header = result[1].value;
    assert.equal(w.f.header.status, "COUNTING");
    const actual = await balances(w.f), frozen = await lines(w.f);
    assert.deepEqual(frozen.map(row => [Number(row.stock_balance_id), Number(row.snapshot_quantity), Number(row.snapshot_balance_version)]).sort((a, b) => a[0] - b[0]), actual.filter(row => w.f.bins.includes(Number(row.bin_id))).map(row => [Number(row.id), Number(row.on_hand_quantity), Number(row.version)]).sort((a, b) => a[0] - b[0]));
  }
});
integrationTest("ST041-S15 legitimate Draft create/replace and same-Draft Start races preserve exclusive ownership", async () => {
  const f = await fixture(), firstCreate = command("stocktake.create", { warehouseId: f.warehouseId, binIds: [f.bins[0]] });
  let result = await race("stocktake:create", firstCreate, "stocktake:create", command("stocktake.create", firstCreate.payload));
  assert.equal(result[0].value.status, "DRAFT"); assert.equal(result[1].error.code, "STOCKTAKE_STATE_CONFLICT"); f.header = result[0].value;
  const other = await native("stocktake:create", command("stocktake.create", { warehouseId: f.warehouseId, binIds: [f.bins[1]] }));
  result = await race("stocktake:update", command("stocktake.update", { stocktakeId: f.header.id, expectedVersion: 1, binIds: [f.bins[0]] }), "stocktake:update", command("stocktake.update", { stocktakeId: other.id, expectedVersion: 1, binIds: f.bins }));
  assert.equal(result[0].value.status, "DRAFT"); assert.equal(result[1].error.code, "STOCKTAKE_STATE_CONFLICT"); f.header = result[0].value;
  result = await race("stocktake:start", workflow(f, "start"), "stocktake:start", workflow(f, "start")); assert.equal(result[0].value.status, "COUNTING"); assert.equal(result[1].error.code, "VERSION_CONFLICT");
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_bin_locks WHERE bin_id=? AND released_at IS NULL", [f.bins[0]]))[0][0].n), 1);
});

integrationTest("ST041-S16 COUNTING locks survive actual process termination and fresh processes reject every writer", async () => {
  const early = await ready(await counting(await fixture())), earlyInput = workflow(early, "post"), earlyBefore = await snapshot();
  const locker = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", password: "", database: process.env.DB_NAME }); let interrupted;
  try {
    await locker.query("LOCK TABLES user_devices WRITE"); interrupted = await processJob("stocktake:post", earlyInput);
    const connected = await interrupted.message("ready");
    await waitFor(async () => Number((await db.query("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID=? AND DB=? AND STATE='Waiting for table metadata lock' AND INFO LIKE '%FROM user_devices%'", [connected.threadId, process.env.DB_NAME]))[0][0].n) === 1, "actual pre-transaction trusted-context read did not wait");
    assert.equal(interrupted.messages.some(message => message.type === "transaction"), false);
    assert.ok(interrupted.connections.has(connected.threadId), "ready connection must be tracked before any transaction message");
    assert.equal(interrupted.transactions.size, 0);
  } finally {
    try {
      if (interrupted && !interrupted.exit) {
        process.kill(-interrupted.child.pid, "SIGKILL");
        await waitFor(() => interrupted.exit !== null, "owned pre-transaction child exit not observed");
      }
    } finally {
      try { await locker.query("UNLOCK TABLES"); }
      finally { try { if (interrupted && children.has(interrupted)) await terminate(interrupted); } finally { await locker.end(); } }
    }
  }
  assert.equal(await snapshot(), earlyBefore);
  for (const kind of writerKinds) {
    const w = await makeWriter(kind), f = await draft(w.f), neighborBin = await bin(f.warehouseId);
    await counting({ warehouseId: f.warehouseId, bins: [neighborBin] });
    const committed = await balances(f), input = workflow(f, "start"), child = await processJob("stocktake:start", input, undefined, true);
    const started = await child.message("result"), connected = await child.message("ready"), transaction = await child.message("transaction");
    assert.equal(started.ok, true); f.header = started.result;
    assert.ok(child.connections.has(connected.threadId) && child.connections.has(transaction.threadId) && child.transactions.has(transaction.threadId));
    const [[persisted]] = await db.query("SELECT * FROM inventory_stocktakes WHERE id=?", [f.header.id]);
    assert.deepEqual([persisted.status, Number(persisted.version), Number(persisted.start_operation_id), Number(persisted.started_by)], ["COUNTING", input.payload.expectedVersion + 1, f.header.operationId, operator.id]);
    const [locks] = await db.query("SELECT * FROM inventory_bin_locks WHERE stocktake_id=? ORDER BY bin_id", [f.header.id]);
    assert.deepEqual(locks.map(row => Number(row.bin_id)), [...f.bins].sort((a, b) => a - b));
    assert.ok(locks.every(row => row.lock_type === "STOCKTAKE" && row.released_at === null && Number(row.active_scope) === 1 && Number(row.locked_by) === operator.id));
    const scopes = (await db.query("SELECT * FROM inventory_stocktake_bins WHERE stocktake_id=? ORDER BY bin_id", [f.header.id]))[0];
    assert.deepEqual(scopes.map(row => Number(row.bin_id)), [...f.bins].sort((a, b) => a - b));
    assert.ok(locks.every(row => scopes.some(scope => Number(scope.id) === Number(row.stocktake_bin_id) && Number(scope.bin_id) === Number(row.bin_id))));
    const expectedLines = committed.filter(row => f.bins.includes(Number(row.bin_id))).map(row => [Number(row.id), Number(row.bin_id), Number(row.sku_id), row.lot_id, row.stock_status, Number(row.on_hand_quantity), Number(row.version), null, 0, null, null, 1]);
    assert.deepEqual((await lines(f)).map(row => [Number(row.stock_balance_id), Number(row.bin_id), Number(row.sku_id), row.lot_id, row.stock_status, Number(row.snapshot_quantity), Number(row.snapshot_balance_version), row.counted_quantity, Number(row.is_not_found), row.variance_quantity, row.movement_id, Number(row.version)]).sort((a, b) => a[0] - b[0]), expectedLines.sort((a, b) => a[0] - b[0]));
    assert.equal(f.header.rowCount, expectedLines.length);
    const before = await snapshot(); await terminate(child); assert.equal(await snapshot(), before);
    await rejected(() => finishAfterFork(w.operation, w.input), w.code);
    const aliases = kind === "receipt" ? ["postReceiptInTransaction", "postReceivingReceiptInTransaction", "postCustomerReturnReceiptInTransaction"]
      : kind === "issue" ? ["postIssueInTransaction", "postFulfillmentIssueInTransaction"] : kind.startsWith("move") ? ["postBinMoveInTransaction"]
        : kind.startsWith("adjust") ? ["postAdjustmentInTransaction"] : kind === "status" ? ["postStatusTransferInTransaction"] : kind === "reverse" ? ["reverseMovementInTransaction"] : [];
    for (const alias of aliases) {
      let input = w.input;
      const who = alias === "postReceivingReceiptInTransaction" ? receiving : alias === "postCustomerReturnReceiptInTransaction" ? returning : alias === "postFulfillmentIssueInTransaction" ? fulfillment : null;
      if (who) input = { actor: { userId: who.id, serviceName: "", claimedRoles: [who.role], claimedPermissions: who.permissions }, source: { documentId: randomUUID(), lineId: "1", eventId: randomUUID() }, correlationId: randomUUID(), payload: { ...w.input.payload, ...(alias === "postCustomerReturnReceiptInTransaction" ? { stockStatus: "QUARANTINED" } : {}) } };
      await rejected(() => finishAfterFork("writer:" + alias, input), w.code);
      observations.push({ kind: "realRestartAlias", alias, originalStart: f.header.operationId, permission: who?.permissions ?? w.input.actor.claimedPermissions });
    }
    const cancel = workflow(f, "cancel"), result = await finishAfterFork("stocktake:cancel", cancel); assert.equal(result.status, "CANCELLED"); await terminalState(before, f, "cancel", cancel, result);
    observations.push({ kind: "realCountingRestart", writer: kind, oldPid: child.child.pid, originalStart: f.header.operationId, trustedNativeNotHttp: true });
  }
});
async function finishAfterFork(operation, input) { return finish(await processJob(operation, input)); }
integrationTest("ST041-S17 READY frozen values survive fresh-process Post and Cancel with renewed native proof", async () => {
  for (const action of ["post", "cancel"]) {
    const f = await counting(await fixture()), counted = await lines(f);
    await native("stocktake:saveCounts", command("stocktake.count", { stocktakeId: f.header.id, lines: counted.map(row => ({ lineId: Number(row.id), expectedVersion: Number(row.version), countedQuantity: 11 })) }));
    const original = await processJob("stocktake:ready", workflow(f, "ready"), undefined, true), readyResult = await original.message("result");
    assert.equal(readyResult.ok, true); f.header = readyResult.result; const frozen = await lines(f), before = await snapshot(); await terminate(original);
    assert.equal(await snapshot(), before); const input = workflow(f, action), result = await finishAfterFork(`stocktake:${action}`, input); assert.equal(result.status, action === "post" ? "POSTED" : "CANCELLED");
    await terminalState(before, f, action, input, result);
    const afterLines = await lines(f); assert.deepEqual(afterLines.map(row => row.variance_quantity), frozen.map(row => row.variance_quantity));
    assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL", [f.header.id]))[0][0].n), 0);
  }
});
integrationTest("ST041-S18 kill real Start before COMMIT proves no partial snapshot or persistent lock and retry once", async () => {
  const f = await draft(await fixture()), input = workflow(f, "start"), before = await snapshot(), child = await processJob("stocktake:start", input, { stage: "beforeCommit", pattern: "COMMIT", nth: 1 });
  await child.message("checkpoint"); assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_bin_locks WHERE stocktake_id=?", [f.header.id]))[0][0].n), 0);
  await terminate(child); assert.equal(await snapshot(), before); const result = await finishAfterFork("stocktake:start", input); assert.equal(result.status, "COUNTING");
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL", [f.header.id]))[0][0].n), f.bins.length);
});
integrationTest("ST041-S19 killed mid-Post after actual second Movement rolls all inventory and workflow back", async () => {
  const f = await ready(await counting(await fixture())), input = workflow(f, "post"), before = await snapshot();
  const child = await processJob("stocktake:post", input, { stage: "afterExecute", pattern: "INSERT INTO inventory_movements", nth: 2 });
  await child.message("checkpoint"); await terminate(child); assert.equal(await snapshot(), before);
  const result = await finishAfterFork("stocktake:post", input); assert.equal(result.rowCount, 2); assert.equal(result.status, "POSTED");
});
integrationTest("ST041-S20 observed actual COMMIT with lost reply replays exact original scalar in fresh process", async () => {
  const f = await ready(await counting(await fixture())), input = workflow(f, "post"), child = await processJob("stocktake:post", input, { stage: "afterCommit", pattern: "COMMIT", nth: 1 });
  await child.message("checkpoint");
  const found = await new InventoryOperationService().findBySource(db, { source: input.source }); assert.equal(found.resultSummary.status, "POSTED");
  const before = await snapshot(); await terminate(child); const result = await finishAfterFork("stocktake:post", input); assert.deepEqual(result, found.resultSummary); assert.equal(await snapshot(), before);
  observations.push({ kind: "realCommitBeforeKill", stocktakeId: f.header.id, operationId: result.operationId, committedRowsObservedBeforeTermination: true });
});
integrationTest("ST041-S21 kill Cancel after first real unlock retains entire own lockset and history", async () => {
  for (const frozen of [false, true]) {
    const f = await counting(await fixture()); if (frozen) await ready(f);
    const input = workflow(f, "cancel"), before = await snapshot(), child = await processJob("stocktake:cancel", input, { stage: "afterExecute", pattern: "UPDATE inventory_bin_locks", nth: 1 });
    await child.message("checkpoint"); await terminate(child); assert.equal(await snapshot(), before);
    const result = await finishAfterFork("stocktake:cancel", input); assert.equal(result.status, "CANCELLED");
    assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_movements WHERE stocktake_id=?", [f.header.id]))[0][0].n), 0);
  }
});
integrationTest("ST041-S22 actual Post/Post and both Post/Cancel orders serialize to one complete terminal winner", async () => {
  for (const [first, second] of [["post", "post"], ["post", "cancel"], ["cancel", "post"]]) {
    const f = await ready(await counting(await fixture())); await counting(await fixture());
    const firstInput = workflow(f, first), secondInput = workflow(f, second), before = await snapshot();
    const result = await race(`stocktake:${first}`, firstInput, `stocktake:${second}`, secondInput);
    assert.equal(result[0].value.status, first === "post" ? "POSTED" : "CANCELLED"); assert.equal(result[1].error.code, "VERSION_CONFLICT");
    assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_movements WHERE stocktake_id=?", [f.header.id]))[0][0].n), first === "post" ? 2 : 0);
    await terminalState(before, f, first, firstInput, result[0].value);
    assert.equal(await new InventoryOperationService().findBySource(db, { source: secondInput.source }), null);
  }
});
integrationTest("ST041-S23 foreign ownership and real-wait permission/device/JWT revocation cannot post or replay", async () => {
  const f = await counting(await fixture()), foreign = await counting(await fixture()), before = await snapshot();
  await assert.rejects(db.execute("UPDATE inventory_bin_locks SET stocktake_id=? WHERE stocktake_id=?", [foreign.header.id, f.header.id]), error => (error.cause?.code ?? error.code) === "ER_NO_REFERENCED_ROW_2");
  assert.equal(await snapshot(), before);
  const [foreignLine] = await lines(foreign);
  await rejected(() => native("stocktake:saveCounts", command("stocktake.count", { stocktakeId: f.header.id, lines: [{ lineId: Number(foreignLine.id), expectedVersion: 1, countedQuantity: 1 }] })), "INVENTORY_RESOURCE_NOT_FOUND");
  for (const action of ["post", "cancel"]) {
    const target = await fixture(); await counting(target, [target.bins[0]]);
    const neighbor = await counting({ warehouseId: target.warehouseId, bins: [target.bins[1]] });
    if (action === "post") await ready(target);
    const input = workflow(target, action), prior = await snapshot(), result = await finishAfterFork(`stocktake:${action}`, input);
    await terminalState(prior, target, action, input, result);
    assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL", [neighbor.header.id]))[0][0].n), 1);
  }
  for (const kind of ["role", "device", "jwt"]) {
    const target = await ready(await counting(await fixture())), extra = await bin(target.warehouseId), input = workflow(target, "post"), prior = await snapshot();
    let result;
    try {
      result = await race("stocktake:create", command("stocktake.create", { warehouseId: target.warehouseId, binIds: [extra] }), "stocktake:post", input, () => authority(kind, true));
    } finally { await authority(kind, false); }
    assert.equal(result[1].error.code, kind === "role" ? "PERMISSION_STALE" : kind === "device" ? "DEVICE_REVOKED" : "JWT_INVALID");
    const after = JSON.parse(await snapshot()), holder = result[0].value;
    after.inventory_stocktakes = after.inventory_stocktakes.filter(row => Number(row.id) !== holder.id);
    after.inventory_stocktake_bins = after.inventory_stocktake_bins.filter(row => Number(row.stocktake_id) !== holder.id);
    after.inventory_operation_requests = after.inventory_operation_requests.filter(row => Number(row.id) !== holder.operationId);
    after.inventory_audit_logs = after.inventory_audit_logs.filter(row => Number(row.operation_request_id) !== holder.operationId);
    assert.deepEqual(after, JSON.parse(prior), "only the valid holding Draft may change business state");
    const complete = await native("stocktake:post", input), old = await snapshot();
    const proof = await nativeProof(input);
    try {
      await authority(kind, true);
      await assert.rejects(new InventoryStocktakeService(options()).post(input, proof), { code: kind === "role" ? "PERMISSION_STALE" : kind === "device" ? "DEVICE_REVOKED" : "JWT_INVALID" });
    } finally { await authority(kind, false); }
    assert.equal(await snapshot(), old); assert.ok(complete.operationId);
  }
});
integrationTest("ST041-S24 actual gain/loss/zero/notFound reconcile per Bucket/SKU/Warehouse, preserve commitments and Cancel", async () => {
  const f = await fixture(4); await issueCommand(f); await counting(f); await ready(f, [12, 8, 10, null]);
  const input = workflow(f, "post"), before = await snapshot(), result = await finishAfterFork("stocktake:post", input); assert.equal(result.rowCount, 3); await terminalState(before, f, "post", input, result);
  const [mismatches] = await db.query(`SELECT b.id FROM inventory_stock_balances b LEFT JOIN inventory_movements m ON m.location_kind='BIN'
    AND m.warehouse_id=b.warehouse_id AND m.bin_id=b.bin_id AND m.sku_id=b.sku_id AND m.lot_id <=> b.lot_id AND m.stock_status=b.stock_status
    WHERE b.warehouse_id=? GROUP BY b.id,b.on_hand_quantity HAVING b.on_hand_quantity<>COALESCE(SUM(CASE m.direction WHEN 'IN' THEN m.quantity ELSE -CAST(m.quantity AS SIGNED) END),0)`, [f.warehouseId]);
  assert.deepEqual(mismatches, []);
  const [[ledger]] = await db.query("SELECT COALESCE(SUM(CASE direction WHEN 'IN' THEN quantity ELSE -CAST(quantity AS SIGNED) END),0) AS quantity FROM inventory_movements WHERE warehouse_id=? AND location_kind='BIN'", [f.warehouseId]);
  const final = await balances(f); assert.equal(Number(ledger.quantity), final.reduce((sum, row) => sum + Number(row.on_hand_quantity), 0));
  assert.ok(final.every(row => Number(row.on_hand_quantity) >= Number(row.allocated_quantity)));
  const [varianceMismatches] = await db.query(`SELECT l.id FROM inventory_stocktake_lines l LEFT JOIN inventory_movements m ON m.id=l.movement_id
    WHERE l.stocktake_id=? AND ((l.variance_quantity=0 AND l.movement_id IS NOT NULL) OR (l.variance_quantity<>0 AND
      (m.id IS NULL OR m.stocktake_id<>l.stocktake_id OR m.stocktake_line_id<>l.id OR m.operation_request_id<>? OR m.quantity<>ABS(l.variance_quantity) OR m.direction<>IF(l.variance_quantity>0,'IN','OUT'))))`, [f.header.id, result.operationId]);
  assert.deepEqual(varianceMismatches, []);
  const [[control]] = await db.query("SELECT reserved_quantity FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id=?", [f.warehouseId, skuId]);
  const [[reserved]] = await db.query("SELECT SUM(outstanding_quantity) AS quantity FROM inventory_reservations WHERE warehouse_id=? AND sku_id=?", [f.warehouseId, skuId]);
  assert.equal(Number(control.reserved_quantity), Number(reserved.quantity)); assert.ok(Number(control.reserved_quantity) <= Number(ledger.quantity));
  for (const row of final) { const [[allocated]] = await db.query("SELECT COALESCE(SUM(outstanding_quantity),0) AS quantity FROM inventory_allocations WHERE stock_balance_id=?", [row.id]); assert.equal(Number(row.allocated_quantity), Number(allocated.quantity)); }
  const cancelled = await counting(await fixture()), prior = await balances(cancelled), cancelBefore = await snapshot(), cancelInput = workflow(cancelled, "cancel");
  const cancelResult = await finishAfterFork("stocktake:cancel", cancelInput); assert.deepEqual(await balances(cancelled), prior); await terminalState(cancelBefore, cancelled, "cancel", cancelInput, cancelResult);
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_movements WHERE stocktake_id=?", [cancelled.header.id]))[0][0].n), 0);
  observations.push({ kind: "realReconciliation", stocktakeId: f.header.id, operationId: result.operationId, bucketMismatches: mismatches.length, varianceMismatches: varianceMismatches.length, reservedAndAllocationMatch: true });
});

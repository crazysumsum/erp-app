import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { setTimeout, setImmediate } from "node:timers/promises";
import test, { before, after } from "node:test";
import { createConnection } from "mysql2/promise";
import { parse } from "csv-parse/sync";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryStocktakeExportService } from "../../src/modules/inventory/InventoryStocktakeExportService.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_API_TESTS === "1";
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 90000 }, work);
const ROOT = "/api/v1/inventory/stocktakes";
let app, db, origin, operator, viewer, adjuster, interval, nextRequestAt = 0, uomId, plainSku, lotSku, lotId;
const badPassword = randomBytes(32).toString("hex"), observations = [], secrets = [badPassword], domainTables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_bin_locks",
  "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_operation_requests"];
function latch() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const source = () => ({ module: "INVENTORY", documentType: "STOCKTAKE", documentId: randomUUID(), lineId: "", eventId: randomUUID() });
async function actor(permissions, device = false) {
  const now = Date.now(), name = `st039-${randomUUID()}`, password = randomBytes(32).toString("hex"); secrets.push(password);
  const [role] = await db.execute("INSERT INTO roles (name,created_at) VALUES (?,?)", [name, now]);
  for (const permission of permissions) await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
  const [user] = await db.execute("INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic Stocktake',?,?)", [name, await hashPassword(password), now, now]);
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
  const result = { id: user.insertId, roleId: role.insertId, role: name, permissions, password };
  if (device) {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), publicKey = keys.publicKey.export({ type: "spki", format: "der" });
    result.privateKey = keys.privateKey; result.publicKey = publicKey; result.did = app.services.require("deviceBinding").deviceIdFor(publicKey);
    const [binding] = await db.execute("INSERT INTO user_devices (user_id,device_id,public_key,status,requested_at) VALUES (?,?,?,'approved',?)", [result.id, result.did, publicKey, now]); result.bindingId = binding.insertId;
  }
  result.token = await token(result); return result;
}
async function token(who, payload = {}, authTime = Math.floor(Date.now() / 1000)) {
  const version = await app.services.require("tokenRevocation").currentVersion(String(who.id));
  const value = app.services.require("jwt").issue({ roles: [who.role], permissions: who.permissions, ...(who.did ? { did: who.did } : {}), ...payload }, { subject: String(who.id), version, authTime });
  secrets.push(value); return value;
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task039_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task039-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  const config = defaultConfigurationSource(); interval = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  const logging = { ...config.logging, loggers: Object.fromEntries(Object.entries(config.logging.loggers).map(([name, value]) => [name, { ...value, directory: path.join(process.env.HARNESS_RUN_DIR, "api-logs", name) }])) };
  app = await createApplication({ configurationSource: { ...config, logging, application: { ...config.application, host: "127.0.0.1", port: 0 }, jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } },
    handlerRegistryOptions: { moduleUrls: ["stocktakeHandlers.js", "transferHandlers.js", "postingHandlers.js", "inquiryHandlers.js"].map(name => new URL(`../../src/handlers/inventory/${name}`, import.meta.url).href) } });
  db = app.services.require("mysqldatabase");
  const [[server]] = await db.query("SELECT VERSION() AS version,@@skip_networking AS isolated,DATABASE() AS name");
  assert.deepEqual([server.version, Number(server.isolated), server.name], ["26.7.0", 1, process.env.DB_NAME]);
  const migrations = (await fs.readdir(new URL("../../database/migrations/", import.meta.url))).filter(name => /\.(?:js|sql)$/u.test(name)).map(name => `migrations/${name}`);
  assert.deepEqual((await db.query("SELECT name FROM fr_schema_migrations ORDER BY name"))[0].map(row => row.name), [...migrations, "framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"].sort());
  operator = await actor(["inventory.view", "inventory.operation"]); viewer = await actor(["inventory.view"]); adjuster = await actor(["inventory.view", "inventory.adjust"], true);
  const now = Date.now(), code = randomUUID().slice(0, 8);
  uomId = (await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", [`EA${code}`, now, now]))[0].insertId;
  const itemId = (await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Synthetic Stocktake','standard','active',?,?)", [now, now]))[0].insertId;
  const skus = [];
  for (const policy of ["none", "batch"]) {
    const id = (await db.execute("INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,?, ?,1,1,1,'active',?,?)", [itemId, `ST-${code}-${policy}`, "=SUM(1,2) 中文", policy, now, now]))[0].insertId;
    await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [id, uomId, now, now]); skus.push(id);
  }
  [plainSku, lotSku] = skus;
  lotId = (await db.execute("INSERT INTO inventory_lots (sku_id,lot_number,normalized_lot_number,first_receipt_date,sku_code_snapshot,created_at) VALUES (?,'KNOWN','known','2026-01-01',?,?)", [lotSku, `ST-${code}-batch`, now]))[0].insertId;
  origin = (await app.start()).url;
  if (process.env.HARNESS_RUN_DIR) await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, "stocktake-api-runtime.json"), JSON.stringify({ origin, database: process.env.DB_NAME, mysqlVersion: server.version, defaultReceiveTimeoutUnchanged: true, synthetic: true }));
});
after(async () => {
  if (app) await app.shutdown("task039_api_test_complete");
  if (process.env.HARNESS_RUN_DIR && enabled) await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, "stocktake-api-observations.json"), JSON.stringify(observations));
});
function signedHeaders(who, body, route, nonce = randomUUID()) {
  const device = app.services.require("deviceBinding"), timestamp = Date.now();
  const input = device.signingInput({ accessTokenHash: device.accessTokenHash(who.token), bodyHash: device.bodyHash(Buffer.from(JSON.stringify(body))), deviceId: who.did, method: "POST", nonce, path: route, timestamp });
  const signature = sign("sha256", Buffer.from(input), { key: who.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url"); secrets.push(signature);
  return { "X-Device-Id": who.did, "X-Device-Timestamp": String(timestamp), "X-Device-Nonce": nonce, "X-Device-Signature": signature };
}
async function raw(route, body, who = operator, options = {}) {
  const at = Math.max(nextRequestAt, performance.now()); nextRequestAt = at + interval;
  if (at > performance.now()) await setTimeout(at - performance.now());
  return fetch(`${origin}${route}`, { method: body === undefined ? "GET" : "POST", signal: options.signal,
    headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), "Content-Type": "application/json", "Idempotency-Key": options.key ?? randomUUID(), ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function request(route, body, who = operator, options = {}) {
  const response = await raw(route, body, who, options); return { status: response.status, body: await response.json(), replayed: response.headers.get("Idempotency-Replayed") };
}
async function success(route, body, who = operator, options = {}) {
  const response = await request(route, body, who, options); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.data;
}
async function fixture(quantities = [5], start = true) {
  const code = randomUUID(), now = Date.now();
  const warehouseId = (await db.execute("INSERT INTO inventory_warehouses (warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?, ?,?)", [code, code, code, now, now]))[0].insertId;
  const bins = [];
  for (let i = 0; i < Math.max(1, quantities.length); i++) {
    const binId = (await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?, ?,?)", [warehouseId, `BIN-${i}`, `bin-${i}`, now, now]))[0].insertId; bins.push(binId);
    if (i < quantities.length) await db.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (?,?,?,'AVAILABLE',?,'2026-01-01',?,?)", [warehouseId, binId, plainSku, quantities[i], now, now]);
  }
  let header = await success(`${ROOT}/create`, { source: source(), warehouseId, binIds: bins });
  if (start) header = await success(`${ROOT}/${header.id}/start`, { source: source(), expectedVersion: header.version });
  return { header, warehouseId, bins, lines: (await success(`${ROOT}/${header.id}/lines`)).items };
}
async function count(f, values = f.lines.map(line => line.snapshotQuantity)) {
  return success(`${ROOT}/${f.header.id}/counts/save`, { source: source(), lines: f.lines.map((line, i) => ({ lineId: line.id, expectedVersion: line.version, ...(values[i] === null ? { notFound: true } : { countedQuantity: values[i] }) })) });
}
async function ready(f, values) { if (f.lines.length) await count(f, values); f.header = await success(`${ROOT}/${f.header.id}/ready`, { source: source(), expectedVersion: f.header.version }); return f; }
function terminal(f, who) { return { source: source(), expectedVersion: f.header.version, reason: "Synthetic reconciliation", password: who.password }; }
async function post(f, options = {}) { const body = options.body ?? terminal(f, adjuster), route = `${ROOT}/${f.header.id}/post`; return request(route, body, adjuster, { ...options, headers: options.headers ?? signedHeaders(adjuster, body, route) }); }
async function snapshot() {
  const result = {}; for (const table of domainTables) result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  result.audit = (await db.query("SELECT * FROM inventory_audit_logs WHERE outcome='SUCCEEDED' ORDER BY id"))[0]; return JSON.stringify(result);
}
async function rejected(route, body, status, who = operator, options = {}) {
  const before = await snapshot(), result = await request(route, body, who, options); assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(await snapshot(), before); assert.doesNotMatch(JSON.stringify(result.body), /SELECT |INSERT |stack|password_hash/iu); return result;
}
async function permission(who, name, remove) { await db.execute(remove ? "DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name=?" : "INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [who.roleId, name]); }
async function ownedLocker() { return createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", password: "", database: process.env.DB_NAME }); }
async function waitFor(check) { const stop = performance.now() + 7000; while (performance.now() < stop) { if (await check()) return; await setImmediate(); } assert.fail("expected actual database wait was not observed"); }
async function warehouseWait(f, action, who, mutate, options = {}) {
  const lock = await ownedLocker(); await lock.beginTransaction(); await lock.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [f.warehouseId]);
  try {
    const body = options.body ?? (action === "counts/save" ? { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 4 }] } : terminal(f, who));
    const route = `${ROOT}/${f.header.id}/${action}`, pending = request(route, body, who, { ...options, headers: action === "post" ? signedHeaders(who, body, route) : {} });
    await waitFor(async () => Number((await lock.query("SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits"))[0][0].count) > 0);
    await mutate(); await lock.commit(); const response = await pending;
    observations.push({ kind: "actualWarehouseWait", action, status: response.status }); return response;
  } finally { await lock.rollback(); await lock.end(); }
}

integrationTest("ST039-A01 actual authentication rejects anonymous, tampered and expired JWT on all twelve routes", async () => {
  const invalid = { token: operator.token.slice(0, -8) + "abcdefgh" }, expired = { token: await token(operator, { iat: Math.floor(Date.now() / 1000) - app.services.require("jwt").expiresInSeconds - 10 }) };
  const routes = ["", "/1", "/1/lines", "/1/export"].map(suffix => [ROOT + suffix, undefined]);
  routes.push(...["create", "1/update", "1/start", "1/counts/save", "1/lines/add", "1/ready", "1/post", "1/cancel"].map(suffix => [ROOT + "/" + suffix, {}]));
  const before = await snapshot(), [[cache]] = await db.query("SELECT COUNT(*) AS count FROM fr_idempotency_keys");
  for (const [route, body] of routes) for (const who of [null, invalid, expired]) assert.equal((await request(route, body, who)).status, 401);
  assert.equal(await snapshot(), before); assert.equal(Number((await db.query("SELECT COUNT(*) AS count FROM fr_idempotency_keys"))[0][0].count), Number(cache.count));
});
integrationTest("ST039-A02 view, operation and adjust remain separate permissions", async () => {
  const f = await ready(await fixture());
  for (const who of [viewer, adjuster]) for (const action of ["create", "update", "start", "counts/save", "lines/add", "ready", "cancel"]) {
    const route = action === "create" ? `${ROOT}/create` : `${ROOT}/${f.header.id}/${action}`;
    const body = action === "cancel" ? terminal(f, who) : action === "create" ? { source: source(), warehouseId: f.warehouseId, binIds: f.bins } : {};
    await rejected(route, body, 403, who);
  }
  const deviceOperator = await actor(operator.permissions, true), body = terminal(f, deviceOperator), route = `${ROOT}/${f.header.id}/post`;
  await rejected(route, body, 403, deviceOperator, { headers: signedHeaders(deviceOperator, body, route) });
  for (const suffix of ["", `/${f.header.id}`, `/${f.header.id}/lines`]) await success(ROOT + suffix, undefined, viewer);
});
integrationTest("ST039-A03 Draft scope replacement and exclusive planning never lock inventory", async () => {
  const f = await fixture([5, 7], false);
  await rejected(`${ROOT}/create`, { source: source(), warehouseId: f.warehouseId, binIds: [f.bins[0]] }, 409);
  const updated = await success(`${ROOT}/${f.header.id}/update`, { source: source(), expectedVersion: 1, binIds: [f.bins[1]], reason: "Subset" }); assert.equal(updated.version, 2);
  const detail = await success(`${ROOT}/${f.header.id}`); assert.deepEqual(detail.scope.items.map(row => row.binId), [f.bins[1]]);
  assert.equal((await db.query("SELECT * FROM inventory_bin_locks WHERE stocktake_id=?", [f.header.id]))[0].length, 0);
  await success(`${ROOT}/create`, { source: source(), warehouseId: f.warehouseId, binIds: [f.bins[0]] });
});
integrationTest("ST039-A04 Start owns persistent multi-Bucket snapshots", async () => {
  const f = await fixture([5, 7]); assert.equal(f.header.status, "COUNTING"); assert.deepEqual(f.lines.map(row => row.snapshotQuantity), [5, 7]);
  const [locks] = await db.query("SELECT bin_id FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL ORDER BY bin_id", [f.header.id]); assert.deepEqual(locks.map(row => Number(row.bin_id)), f.bins);
  assert.equal((await success(`${ROOT}/${f.header.id}`)).progress.uncountedLines, 2);
});
integrationTest("ST039-A05 zero, notFound and untouched values stay distinct and only line versions advance", async () => {
  const f = await fixture([5, 7, 9]); await success(`${ROOT}/${f.header.id}/counts/save`, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 0 }, { lineId: f.lines[1].id, expectedVersion: 1, notFound: true }] });
  const result = await success(`${ROOT}/${f.header.id}/lines`); assert.equal(result.version, 2); assert.equal(result.varianceStage, "PREVIEW");
  assert.deepEqual(result.items.map(row => [row.actualQuantity, row.countState, row.version]), [[0, "COUNTED", 2], [0, "NOT_FOUND", 2], [null, "UNCOUNTED", 1]]);
  assert.ok((await db.query("SELECT variance_quantity FROM inventory_stocktake_lines WHERE stocktake_id=?", [f.header.id]))[0].every(row => row.variance_quantity === null));
});
integrationTest("ST039-A06 Add only references existing legal Lot, without creating stock or Lot", async () => {
  const f = await fixture([]), base = { source: source(), binId: f.bins[0], skuId: lotSku, lotId, stockStatus: "AVAILABLE" };
  const [[before]] = await db.query("SELECT (SELECT COUNT(*) FROM inventory_lots) lots,(SELECT COUNT(*) FROM inventory_stock_balances) balances,(SELECT COUNT(*) FROM inventory_movements) movements");
  const add = await success(`${ROOT}/${f.header.id}/lines/add`, base); assert.equal(add.stocktakeId, f.header.id); assert.equal(add.version, 1);
  await success(`${ROOT}/${f.header.id}/lines/add`, { ...base, source: source(), skuId: plainSku, lotId: null });
  await rejected(`${ROOT}/${f.header.id}/lines/add`, { ...base, source: source(), lotId: 99999999 }, 404);
  await rejected(`${ROOT}/${f.header.id}/lines/add`, { ...base, source: source(), skuId: plainSku }, 409);
  assert.deepEqual((await db.query("SELECT (SELECT COUNT(*) FROM inventory_lots) lots,(SELECT COUNT(*) FROM inventory_stock_balances) balances,(SELECT COUNT(*) FROM inventory_movements) movements"))[0][0], before);
});
integrationTest("ST039-A07 Ready freezes complete counts and explicitly accepts empty scope inventory", async () => {
  const f = await fixture(); await rejected(`${ROOT}/${f.header.id}/ready`, { source: source(), expectedVersion: 2 }, 409);
  await ready(f, [8]); const lines = await success(`${ROOT}/${f.header.id}/lines`); assert.equal(lines.varianceStage, "FROZEN"); assert.equal(lines.items[0].varianceQuantity, 3);
  await rejected(`${ROOT}/${f.header.id}/counts/save`, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 2, countedQuantity: 7 }] }, 409);
  await rejected(`${ROOT}/${f.header.id}/lines/add`, { source: source(), binId: f.bins[0], skuId: plainSku, lotId: null, stockStatus: "DAMAGED" }, 409);
  assert.equal((await ready(await fixture([]))).header.status, "READY_TO_POST");
});
integrationTest("ST039-A08 real password, JWT and approved P-256 device commit atomic Post", async () => {
  const f = await ready(await fixture([5, 7]), [8, 6]), result = await post(f); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.data.status, "POSTED");
  const [balances] = await db.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE warehouse_id=? ORDER BY bin_id", [f.warehouseId]); assert.deepEqual(balances.map(row => Number(row.on_hand_quantity)), [8, 6]);
  assert.equal((await db.query("SELECT id FROM inventory_movements WHERE operation_request_id=?", [result.body.data.operationId]))[0].length, 2);
  assert.equal((await db.query("SELECT id FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL", [f.header.id]))[0].length, 0);
});
integrationTest("ST039-A09 actual password and cryptographic failures leave READY locks intact", async () => {
  const f = await ready(await fixture()), route = `${ROOT}/${f.header.id}/post`, body = terminal(f, adjuster);
  for (const [value, headers, status] of [[{ ...body, password: badPassword }, null, 403], [body, {}, 400], [body, { ...signedHeaders(adjuster, body, route), "X-Device-Signature": randomBytes(64).toString("base64url") }, 400]]) await rejected(route, value, status, adjuster, { headers: headers ?? signedHeaders(adjuster, value, route) });
  await db.execute("UPDATE user_devices SET status='pending' WHERE id=?", [adjuster.bindingId]);
  try { await rejected(route, body, 403, adjuster, { headers: signedHeaders(adjuster, body, route) }); } finally { await db.execute("UPDATE user_devices SET status='approved' WHERE id=?", [adjuster.bindingId]); }
  const nonce = randomUUID(), first = await post(f, { headers: signedHeaders(adjuster, body, route, nonce), body }); assert.equal(first.status, 200, JSON.stringify(first.body));
  await rejected(route, body, 400, adjuster, { headers: signedHeaders(adjuster, body, route, nonce) });
});
integrationTest("ST039-A10 device-free operator password Cancel preserves all predecessor histories", async () => {
  for (const phase of ["DRAFT", "COUNTING", "READY_TO_POST"]) {
    const f = await fixture([5], phase !== "DRAFT"); if (phase === "READY_TO_POST") await ready(f);
    const body = terminal(f, operator); await rejected(`${ROOT}/${f.header.id}/cancel`, { ...body, password: badPassword }, 403);
    const result = await success(`${ROOT}/${f.header.id}/cancel`, body); assert.equal(result.status, "CANCELLED");
    const detail = await success(`${ROOT}/${f.header.id}`); assert.equal(detail.cancelled, true); assert.equal(detail.progress.totalLines, phase === "DRAFT" ? 0 : 1);
    assert.equal((await db.query("SELECT id FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL", [f.header.id]))[0].length, 0);
  }
});
integrationTest("ST039-A11 strict public input rejects spoofed authority, quantity and ambiguous URI", async () => {
  const f = await fixture(); for (const field of ["actor", "proof", "varianceQuantity", "snapshotQuantity", "password"]) await rejected(`${ROOT}/${f.header.id}/counts/save`, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 0 }], [field]: "forged" }, 400);
  for (const id of ["01", "9007199254740992"]) await rejected(`${ROOT}/${id}/lines`, undefined, 400);
  for (const quantity of ["0", -1, 9007199254740992]) await rejected(`${ROOT}/${f.header.id}/counts/save`, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: quantity }] }, 400);
});
integrationTest("ST039-A12 HTTP cached receipt excludes credentials but detects changed business intent", async () => {
  const f = await fixture([], false), route = `${ROOT}/${f.header.id}/cancel`, body = terminal(f, operator), key = randomUUID();
  const first = await request(route, body, operator, { key }); assert.equal(first.status, 200, JSON.stringify(first.body));
  const old = operator.password, replacement = randomBytes(32).toString("hex"); secrets.push(replacement); await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(replacement), operator.id]); operator.password = replacement;
  try {
    const before = await snapshot(), replay = await request(route, { ...body, password: replacement }, operator, { key }); assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.deepEqual(replay.body.data, first.body.data); assert.equal(await snapshot(), before);
    await rejected(route, { ...body, password: replacement, reason: "Different reason" }, 409, operator, { key });
  } finally { operator.password = old; await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(old), operator.id]); }
});
integrationTest("ST039-A13 new HTTP keys replay original Count, Add and Post scalar results", async () => {
  const f = await fixture(), route = `${ROOT}/${f.header.id}/counts/save`, body = { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 8 }] };
  const first = await success(route, body); await success(route, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 2, countedQuantity: 9 }] }); const before = await snapshot(); assert.deepEqual(await success(route, body), first); assert.equal(await snapshot(), before);
  const addRoute = `${ROOT}/${f.header.id}/lines/add`, addBody = { source: source(), binId: f.bins[0], skuId: lotSku, lotId, stockStatus: "DAMAGED" }, added = await success(addRoute, addBody); assert.deepEqual(await success(addRoute, addBody), added);
  const lines = (await success(`${ROOT}/${f.header.id}/lines`)).items; await success(route, { source: source(), lines: lines.map(line => ({ lineId: line.id, expectedVersion: line.version, countedQuantity: line.snapshotQuantity })) });
  f.header = await success(`${ROOT}/${f.header.id}/ready`, { source: source(), expectedVersion: 2 }); const postBody = terminal(f, adjuster), posted = await post(f, { body: postBody }); assert.equal(posted.status, 200, JSON.stringify(posted.body));
  const final = await snapshot(), replay = await post(f, { body: postBody }); assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.deepEqual(replay.body.data, posted.body.data); assert.equal(await snapshot(), final);
  await rejected(route, { ...body, lines: [{ ...body.lines[0], countedQuantity: 10 }] }, 409);
});
integrationTest("ST039-A14 cached responses recheck actual role, JWT, device status and public key", async () => {
  const f = await ready(await fixture()), body = terminal(f, adjuster), route = `${ROOT}/${f.header.id}/post`, key = randomUUID();
  assert.equal((await post(f, { body, key })).status, 200);
  const [cache] = await db.query("SELECT * FROM fr_idempotency_keys ORDER BY store_key");
  for (const kind of ["role", "device", "key", "jwt"]) {
    if (kind === "role") await permission(adjuster, "inventory.adjust", true);
    if (kind === "device") await db.execute("UPDATE user_devices SET status='revoked' WHERE id=?", [adjuster.bindingId]);
    if (kind === "key") await db.execute("UPDATE user_devices SET public_key=? WHERE id=?", [generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }), adjuster.bindingId]);
    if (kind === "jwt") {
      const claims = app.services.require("jwt").verify(adjuster.token);
      await db.execute("INSERT INTO fr_token_versions (subject,version,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),updated_at=VALUES(updated_at)", [String(adjuster.id), claims.ver + 1, Date.now()]);
      assert.equal(Number((await db.query("SELECT version FROM fr_token_versions WHERE subject=?", [String(adjuster.id)]))[0][0].version), claims.ver + 1);
    }
    try { const result = await request(route, body, adjuster, { key, headers: signedHeaders(adjuster, body, route) }); assert.ok([400, 401, 403].includes(result.status), kind + ": " + JSON.stringify(result.body)); assert.equal(result.replayed, null); assert.deepEqual((await db.query("SELECT * FROM fr_idempotency_keys ORDER BY store_key"))[0], cache); }
    finally {
      if (kind === "role") await permission(adjuster, "inventory.adjust", false);
      if (kind === "device") await db.execute("UPDATE user_devices SET status='approved' WHERE id=?", [adjuster.bindingId]);
      if (kind === "key") await db.execute("UPDATE user_devices SET public_key=? WHERE id=?", [adjuster.publicKey, adjuster.bindingId]);
      if (kind === "jwt") adjuster.token = await token(adjuster);
    }
  }
});
integrationTest("ST039-A15 real Warehouse waits recheck committed permission revocation", async () => {
  for (const action of ["counts/save", "cancel", "post"]) {
    const f = await fixture(); if (action === "post") await ready(f); const who = action === "post" ? adjuster : operator, name = action === "post" ? "inventory.adjust" : "inventory.operation";
    const before = await snapshot(); try { const response = await warehouseWait(f, action, who, () => permission(who, name, true)); assert.equal(response.status, 403, JSON.stringify(response.body)); assert.equal(await snapshot(), before); } finally { await permission(who, name, false); }
  }
  const f = await fixture(), route = `${ROOT}/${f.header.id}/counts/save`, body = { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 4 }] }, key = randomUUID();
  const keys = new Set((await db.query("SELECT store_key FROM fr_idempotency_keys"))[0].map(row => row.store_key));
  const first = await request(route, body, operator, { key }); assert.equal(first.status, 200);
  const added = (await db.query("SELECT * FROM fr_idempotency_keys"))[0].filter(row => !keys.has(row.store_key)); assert.equal(added.length, 1); assert.equal(added[0].state, "completed");
  const lock = await ownedLocker(); await lock.beginTransaction(); await lock.query("SELECT store_key FROM fr_idempotency_keys WHERE store_key=? FOR UPDATE", [added[0].store_key]);
  try {
    const before = await snapshot(), second = request(route, body, operator, { key });
    await waitFor(async () => Number((await lock.query("SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits"))[0][0].count) > 0);
    await permission(operator, "inventory.operation", true); await lock.commit(); const result = await second; assert.equal(result.status, 403, JSON.stringify(result.body)); assert.equal(result.replayed, null); assert.equal(await snapshot(), before);
    assert.deepEqual((await db.query("SELECT * FROM fr_idempotency_keys WHERE store_key=?", [added[0].store_key]))[0][0], added[0]); observations.push({ kind: "actualHttpCompletedCacheRowLockWait", status: 403 });
  } finally { await lock.rollback(); await lock.end(); await permission(operator, "inventory.operation", false); }
});
integrationTest("ST039-A16 actual lock waits reject original JWT/session/signature expiry and client abort", async () => {
  const clock = app.services.require("time"), original = clock.nowMs.bind(clock);
  for (const kind of ["jwt", "session", "signature"]) {
    const f = await ready(await fixture()), who = kind === "signature" ? adjuster : operator, action = kind === "signature" ? "post" : "cancel";
    const oldToken = who.token;
    if (kind === "session") who.token = await token(who, { iat: Math.floor(Date.now() / 1000) + app.services.require("jwt").sessionMaxAgeSeconds + 60 });
    const claims = app.services.require("jwt").verify(who.token), skew = app.services.require("deviceBinding").config.deviceBinding.signatureMaxSkewSeconds;
    const future = kind === "jwt" ? (claims.exp + 10) * 1000 : kind === "session" ? (claims.auth_time + app.services.require("jwt").sessionMaxAgeSeconds + 10) * 1000 : Date.now() + (skew + 10) * 1000;
    if (kind === "session") assert.ok(future < claims.exp * 1000, "session expiry isolated from JWT expiry");
    const before = await snapshot(); try { const response = await warehouseWait(f, action, who, () => { clock.nowMs = () => future; }); assert.ok([400, 401, 403].includes(response.status), JSON.stringify(response.body)); if (kind === "session") { assert.equal(response.status, 401); assert.equal(response.body.error.code, "Unauthorized Access"); } assert.equal(await snapshot(), before); observations.push({ kind: "controlledServerClockDuringActualWait", field: kind }); } finally { clock.nowMs = original; who.token = oldToken; }
  }
  const f = await fixture(), controller = new AbortController(), lock = await ownedLocker(); await lock.beginTransaction(); await lock.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [f.warehouseId]);
  const before = await snapshot(), body = terminal(f, operator), pending = request(`${ROOT}/${f.header.id}/cancel`, body, operator, { signal: controller.signal });
  try { await waitFor(async () => Number((await lock.query("SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits"))[0][0].count) > 0); controller.abort(); await assert.rejects(pending); await lock.commit(); await waitFor(async () => Number((await lock.query("SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits"))[0][0].count) === 0); await setImmediate(); assert.equal(await snapshot(), before); } finally { await lock.rollback(); await lock.end(); }
});
integrationTest("ST039-A17 concurrent HTTP Count and Post/Cancel produce exactly one valid winner", async () => {
  const f = await fixture(), route = `${ROOT}/${f.header.id}/counts/save`, base = { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 8 }] };
  const results = await Promise.all([request(route, base), request(route, { ...base, source: source(), lines: [{ ...base.lines[0], countedQuantity: 9 }] })]); assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  f.header = await success(`${ROOT}/${f.header.id}/ready`, { source: source(), expectedVersion: 2 }); const responses = await Promise.all([post(f), request(`${ROOT}/${f.header.id}/cancel`, terminal(f, operator))]); assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
  const detail = await success(`${ROOT}/${f.header.id}`); assert.ok(["POSTED", "CANCELLED"].includes(detail.status)); assert.equal(detail.version, 4);
});
integrationTest("ST039-A18 all public queries preserve projections, filters and read-only state", async () => {
  const f = await fixture([5, 7]); await count(f, [0, null]); const before = await snapshot();
  const list = await success(`${ROOT}?warehouseId=${f.warehouseId}&status=COUNTING&pageSize=1`); assert.equal(list.total, 1); assert.equal(list.items[0].id, f.header.id);
  const detail = await success(`${ROOT}/${f.header.id}?scopePageSize=1`); assert.equal(detail.scope.total, 2); assert.equal(detail.scope.items.length, 1);
  const lines = await success(`${ROOT}/${f.header.id}/lines?progress=NOT_FOUND&variance=LOSS&pageSize=1`); assert.equal(lines.total, 1); assert.equal(lines.globalSummary.totalLines, 2); assert.equal(lines.filteredSummary.notFoundLines, 1); assert.equal(lines.items[0].actualQuantity, 0);
  assert.equal(await snapshot(), before);
});
integrationTest("ST039-A19 actual HTTP CSV metadata, SUMMARY, cancellation and spreadsheet safety", async () => {
  const f = await fixture(); await count(f, [3]);
  for (const cancelled of [false, true]) {
    if (cancelled) f.header = await success(`${ROOT}/${f.header.id}/cancel`, terminal(f, operator));
    const response = await raw(`${ROOT}/${f.header.id}/export?variance=LOSS`, undefined, viewer); assert.equal(response.status, 200);
    const rows = parse(await response.text(), { columns: true }), footer = rows.at(-1); assert.equal(footer.recordType, "SUMMARY"); assert.equal(footer.exportedRows, "2"); assert.equal(footer.truncated, response.headers.get("X-Inventory-Export-Truncated")); assert.equal(footer.asOf, response.headers.get("X-Inventory-Export-As-Of")); assert.ok(Number(footer.generationBudgetMs) <= 60000);
    const line = rows.find(row => row.recordType === "LINE"); assert.equal(line.varianceQuantity, "-2"); assert.equal(line.cancelled, String(cancelled)); assert.ok(line.skuNameCurrent.startsWith("'="));
  }
  const empty = await fixture([]), response = await raw(`${ROOT}/${empty.header.id}/export`, undefined, viewer); const rows = parse(await response.text(), { columns: true }); assert.deepEqual(rows.map(row => row.recordType), ["SCOPE", "SUMMARY"]);
  const originalPrepare = InventoryStocktakeExportService.prototype.prepare;
  InventoryStocktakeExportService.prototype.prepare = async function(input) { const old = this.config; this.config = { ...old, exportMaxRows: 1 }; try { return await originalPrepare.call(this, input); } finally { this.config = old; } };
  try { const limited = await raw(`${ROOT}/${f.header.id}/export`, undefined, viewer), rows = parse(await limited.text(), { columns: true }); assert.equal(limited.status, 200); assert.equal(limited.headers.get("X-Inventory-Export-Truncated"), "true"); assert.equal(limited.headers.get("X-Inventory-Export-Reason"), "ROW_LIMIT"); assert.equal(rows.at(-1).exportedRows, "1"); assert.equal(rows.at(-1).truncated, "true"); observations.push({ kind: "actualHttpCsvControlledLowerRowLimit", configuredRows: 1 }); }
  finally { InventoryStocktakeExportService.prototype.prepare = originalPrepare; }
});
integrationTest("ST039-A20 revocation during an actual file read discloses no subsequent chunk", async () => {
  const f = await fixture(), originalOpen = fs.open, beforeDirs = new Set(await fs.readdir(os.tmpdir())); let reached = false;
  fs.open = async (...args) => {
    const file = await originalOpen(...args); if (String(args[0]).endsWith("/stocktake.csv")) {
      const read = file.read.bind(file); file.read = async (...input) => { const result = await read(...input); if (result.bytesRead && !reached) { reached = true; await permission(viewer, "inventory.view", true); } return result; };
    } return file;
  };
  try {
    let bytes = 0, failed = false;
    try { const response = await raw(`${ROOT}/${f.header.id}/export`, undefined, viewer); const reader = response.body.getReader(); while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.length; } } catch { failed = true; }
    assert.equal(reached, true); assert.equal(failed, true, "revoked stream must fail, never complete"); assert.equal(bytes, 0, "a chunk read after committed revocation must never be disclosed");
    await waitFor(async () => !(await fs.readdir(os.tmpdir())).some(name => name.startsWith("inventory-stocktake-export-") && !beforeDirs.has(name)));
  } finally { fs.open = originalOpen; await permission(viewer, "inventory.view", false); }
  const clock = app.services.require("time"), originalClock = clock.nowMs.bind(clock);
  for (const kind of ["expiry", "abort"]) {
    const controller = new AbortController(); let reached = false, ownedDirectory;
    fs.open = async (...args) => { const file = await originalOpen(...args); if (String(args[0]).endsWith("/stocktake.csv")) {
      ownedDirectory = path.dirname(String(args[0])); const read = file.read.bind(file);
      file.read = async (...input) => { const result = await read(...input); if (result.bytesRead && !reached) { reached = true; if (kind === "expiry") clock.nowMs = () => Date.now() + 86400000; else controller.abort(); } return result; };
    } return file; };
    try {
      let bytes = 0, failed = false;
      try { const response = await raw(`${ROOT}/${f.header.id}/export`, undefined, viewer, { signal: controller.signal }); const reader = response.body.getReader(); while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.length; } } catch { failed = true; }
      assert.equal(reached, true); assert.equal(failed, true); assert.equal(bytes, 0);
      await waitFor(async () => { try { await fs.lstat(ownedDirectory); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; } });
      observations.push({ kind: "actualHttpFileReadDeliveryFailure", trigger: kind, bytes: 0, cleanup: true, ...(kind === "expiry" ? { controlledServerClock: true } : {}) });
    } finally { fs.open = originalOpen; clock.nowMs = originalClock; }
  }
  const large = await fixture([]), digits = "(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
  const numbers = `SELECT a.n+10*b.n+100*c.n AS n FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c`;
  const [[plain]] = await db.query("SELECT item_id FROM item_skus WHERE id=?", [plainSku]);
  // Read/export fixtures only, not proof of executing 1000 Add workflows or a capacity SLA.
  await db.query(`INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy,inventory_tracked,created_at,updated_at) SELECT 4000000+n,?,CONCAT('PRESSURE-',n),REPEAT('P',100),'active','none',1,?,? FROM (${numbers}) seq`, [plain.item_id, Date.now(), Date.now()]);
  await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) SELECT id,?,1,1,?,? FROM item_skus WHERE id>=4000000 AND id<4001000", [uomId, Date.now(), Date.now()]);
  await db.execute(`INSERT INTO inventory_stocktake_lines (stocktake_id,stocktake_bin_id,bin_id,sku_id,stock_status,snapshot_quantity,snapshot_balance_version)
    SELECT scope.stocktake_id,scope.id,scope.bin_id,sku.id,'AVAILABLE',0,0 FROM inventory_stocktake_bins scope JOIN item_skus sku ON sku.id>=4000000 AND sku.id<4001000 WHERE scope.stocktake_id=?`, [large.header.id]);
  const originalPrepare = InventoryStocktakeExportService.prototype.prepare, paused = latch(), drain = latch(), ended = latch(); let stream, committed = false, released = false, afterRevocationBytes = 0, transferFailed = false, consumer, client;
  InventoryStocktakeExportService.prototype.prepare = async function(input) {
    const result = await originalPrepare.call(this, input);
    if (input.stocktakeId === large.header.id) {
      stream = result.stream; const emit = stream.emit.bind(stream), resume = stream.resume.bind(stream); let held = false;
      stream.emit = (event, ...values) => { if (event === "data" && committed) afterRevocationBytes += values[0].length; return emit(event, ...values); };
      stream.once("pause", () => { held = true; paused.resolve(); });
      // Hold the actual HTTP pipeline's first write(false)/drain boundary; no fake SQL/auth/response.
      stream.resume = () => { if (held && !released) { drain.resolve(); return stream; } return resume(); };
    } return result;
  };
  try {
    const at = Math.max(nextRequestAt, performance.now()); nextRequestAt = at + interval; if (at > performance.now()) await setTimeout(at - performance.now());
    client = http.get(`${origin}${ROOT}/${large.header.id}/export`, { headers: { Authorization: `Bearer ${viewer.token}` } }, response => {
      consumer = response; response.pause(); response.on("error", () => { transferFailed = true; ended.resolve(); }); response.once("aborted", () => { transferFailed = true; ended.resolve(); }); response.once("end", () => ended.resolve());
    });
    client.once("error", () => { transferFailed = true; ended.resolve(); }); await paused.promise; await drain.promise;
    await waitFor(async () => !!consumer && stream.isPaused() && (stream.readableLength > 0 || stream.readableHighWaterMark === 0));
    const bufferedAtRevoke = stream.readableLength; await permission(viewer, "inventory.view", true); committed = true; released = true; stream.resume(); consumer.resume(); await ended.promise;
    assert.equal(transferFailed, true); assert.equal(afterRevocationBytes, 0, "actual HTTP pipeline must not drain an earlier-authorized prefetched chunk after committed revocation");
    observations.push({ kind: "actualHttpBackpressureControlledDrain", sourceBufferedAtRevocation: bufferedAtRevoke, sourceBytesDeliveredAfterRevocation: afterRevocationBytes, alreadySentBytesNotRecalled: true });
  } finally { released = true; stream?.destroy(); client?.destroy(); InventoryStocktakeExportService.prototype.prepare = originalPrepare; await permission(viewer, "inventory.view", false); }
});
integrationTest("ST039-A21 stale snapshot and a real second Audit SQL error roll back all Post legs", async () => {
  const stale = await ready(await fixture(), [8]); await db.execute("UPDATE inventory_stock_balances SET version=version+1 WHERE warehouse_id=?", [stale.warehouseId]); const before = await snapshot(), denied = await post(stale); assert.equal(denied.status, 409); assert.equal(await snapshot(), before);
  const f = await ready(await fixture([5, 7]), [8, 9]), original = db.withTransaction.bind(db); let audits = 0;
  db.withTransaction = (work, options) => original(async tx => { const execute = tx.execute.bind(tx); tx.execute = async (sql, ...params) => { if (/INSERT INTO inventory_audit_logs/iu.test(sql) && ++audits === 2) return execute("INSERT INTO inventory_audit_logs (not_a_real_column) VALUES (1)"); return execute(sql, ...params); }; return work(tx); }, options);
  const initial = await snapshot(); try { const result = await post(f); assert.equal(result.status, 500, JSON.stringify(result.body)); assert.equal(await snapshot(), initial); assert.equal(audits >= 2, true); } finally { db.withTransaction = original; }
  for (const kind of ["allocated", "reserved"]) {
    const g = await ready(await fixture(), [1]), now = Date.now();
    const reservation = await db.withTransaction(async tx => {
      const operation = new InventoryOperationService(), claim = await operation.claim(tx, { commandType: "RESERVATION_CREATE", payload: { quantity: 2 }, source: { ...source(), documentType: "RESERVATION" }, actorUserId: null, actorLabel: "Synthetic", createdAt: now });
      const [created] = await tx.execute("INSERT INTO inventory_reservations (create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES (?,?,?,2,2,'SALE','ACTIVE',?,?)", [claim.operationId, g.warehouseId, plainSku, now, now]);
      await tx.execute("INSERT INTO inventory_stock_controls (warehouse_id,sku_id,reserved_quantity,created_at,updated_at) VALUES (?,?,2,?,?)", [g.warehouseId, plainSku, now, now]);
      await operation.complete(tx, { operationId: claim.operationId, resultType: "RESERVATION", resultId: String(created.insertId), resultSummary: { id: Number(created.insertId), quantity: 2, status: "ACTIVE" }, completedAt: now }); return { id: created.insertId, operationId: claim.operationId };
    });
    if (kind === "allocated") {
      const [[balance]] = await db.query("SELECT id FROM inventory_stock_balances WHERE warehouse_id=?", [g.warehouseId]);
      await db.execute("INSERT INTO inventory_allocations (create_operation_id,reservation_id,stock_balance_id,allocated_quantity,outstanding_quantity,selection_strategy,status,created_at,updated_at) VALUES (?,?,?,2,2,'FIFO','ACTIVE',?,?)", [reservation.operationId, reservation.id, balance.id, now, now]);
      await db.execute("UPDATE inventory_stock_balances SET allocated_quantity=2 WHERE id=?", [balance.id]);
    }
    const before = await snapshot(), result = await post(g); assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.error.code, kind === "allocated" ? "INSUFFICIENT_STOCK" : "INSUFFICIENT_ATP"); assert.equal(await snapshot(), before);
  }
});
integrationTest("ST039-A22 synthetic credentials never enter domain fingerprints, Audit or HTTP cache", async () => {
  const f = await ready(await fixture()), result = await post(f); assert.equal(result.status, 200);
  const output = JSON.stringify({ domain: (await db.query("SELECT * FROM inventory_operation_requests ORDER BY id"))[0], audit: (await db.query("SELECT * FROM inventory_audit_logs ORDER BY id"))[0], cache: (await db.query("SELECT * FROM fr_idempotency_keys ORDER BY store_key"))[0] });
  for (const secret of secrets) assert.equal(output.includes(secret), false, "synthetic credential leaked into persistence");
  const logging = app.services.require("logging"); let scanned = 0;
  for (const name of ["request", "system"]) {
    const logger = logging.require(name); await logger.flush();
    for (const entry of await fs.readdir(logger.config.directory, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith(".log")) {
      const text = await fs.readFile(path.join(logger.config.directory, entry.name), "utf8"); for (const secret of secrets) assert.equal(text.includes(secret), false, "synthetic credential leaked into owned actual log"); scanned++;
    }
  }
  assert.ok(scanned > 0); observations.push({ kind: "ownedActualLoggerSecretScan", files: scanned, distinctiveSyntheticValues: secrets.length, leaked: 0 });
  assert.equal(JSON.stringify(result.body).includes(adjuster.password), false);
});
integrationTest("ST039-A23 response lost after commit resolves by source and retries original receipt", async () => {
  const f = await fixture(), route = `${ROOT}/${f.header.id}/counts/save`, body = { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 8 }] };
  const reached = latch(), release = latch(), original = db.withTransaction.bind(db); let captured = false;
  db.withTransaction = async (work, options) => { const result = await original(work, options); if (!captured && result?.operationId && result?.id === f.header.id) { captured = true; reached.resolve(); await release.promise; } return result; };
  const controller = new AbortController(), pending = request(route, body, operator, { signal: controller.signal });
  try { await reached.promise; controller.abort(); await assert.rejects(pending); release.resolve(); await setImmediate(); const before = await snapshot();
    const params = new URLSearchParams({ sourceModule: body.source.module, sourceDocumentType: body.source.documentType, sourceDocumentId: body.source.documentId, sourceLineId: "", sourceEventId: body.source.eventId });
    const operation = await success(`/api/v1/inventory/operations/by-source?${params}`, undefined, viewer); assert.equal(operation.resultSummary.id, f.header.id); assert.ok(operation.completedAt > 0);
    const replay = await success(route, body); assert.equal(replay.rowCount, 1); assert.equal(await snapshot(), before); assert.equal((await db.query("SELECT id FROM inventory_operation_requests WHERE source_event_id=?", [body.source.eventId]))[0].length, 1); }
  finally { release.resolve(); db.withTransaction = original; }
});
integrationTest("ST039-A24 existing signed Adjustment and Transfer routes remain functional at default startup", async () => {
  const f = await fixture([], false), route = "/api/v1/inventory/adjustments", body = { source: { ...source(), documentType: "ADJUSTMENT" }, password: adjuster.password, direction: "IN", warehouseId: f.warehouseId, binId: f.bins[0], skuId: plainSku, stockStatus: "DAMAGED", expectedBalanceVersion: null, uomId, quantity: 1, reasonCategory: "OTHER", reasonText: "Synthetic regression" };
  const adjustment = await success(route, body, adjuster, { headers: signedHeaders(adjuster, body, route) }); assert.ok(adjustment.operationId);
  const [[movement]] = await db.query("SELECT id FROM inventory_movements WHERE operation_request_id=?", [adjustment.operationId]), [[balance]] = await db.query("SELECT id,version FROM inventory_stock_balances WHERE warehouse_id=?", [f.warehouseId]);
  const reversalRoute = `/api/v1/inventory/movements/${movement.id}/reverse`, reversalBody = { source: { ...source(), documentType: "REVERSAL" }, password: adjuster.password, reasonText: "Synthetic reversal regression", expectedBalances: [{ balanceId: Number(balance.id), expectedVersion: Number(balance.version) }] };
  await success(reversalRoute, reversalBody, adjuster, { headers: signedHeaders(adjuster, reversalBody, reversalRoute) });
  const replenished = { ...body, source: { ...source(), documentType: "ADJUSTMENT" }, expectedBalanceVersion: Number(balance.version) + 1 };
  await success(route, replenished, adjuster, { headers: signedHeaders(adjuster, replenished, route) });
  const destination = await fixture([], false), transfer = await success("/api/v1/inventory/transfers/create", { source: { ...source(), documentType: "TRANSFER" }, sourceWarehouseId: f.warehouseId, destinationWarehouseId: destination.warehouseId, lines: [{ skuId: plainSku, sourceBinId: f.bins[0], lotId: null, stockStatus: "DAMAGED", quantity: 1 }] }); assert.equal(transfer.status, "DRAFT");
});

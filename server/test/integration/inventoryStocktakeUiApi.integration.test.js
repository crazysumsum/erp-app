import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout, setImmediate } from "node:timers/promises";
import test, { before, after } from "node:test";
import { createConnection } from "mysql2/promise";
import { parse } from "csv-parse/sync";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_UI_API_TESTS === "1";
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 90000 }, work);
const ROOT = "/api/v1/inventory/stocktakes", LOOKUP = "/api/v1/inventory/sku-lookup";
const source = () => ({ module: "INVENTORY", documentType: "STOCKTAKE", documentId: randomUUID(), lineId: "", eventId: randomUUID() });
let app, db, origin, viewer, operator, adjuster, itemOnly, uomId, plainSku, lotSku, lotId, collision, packBarcode, interval, nextAt = 0, paged;
const observations = [], tables = ["inventory_stock_balances", "inventory_stock_controls", "inventory_movements", "inventory_operation_requests", "inventory_bin_locks", "inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines"];
async function actor(permissions, device = false) {
  const now = Date.now(), name = `st040-${randomUUID()}`, password = randomBytes(32).toString("hex");
  const [role] = await db.execute("INSERT INTO roles (name,created_at) VALUES (?,?)", [name, now]);
  for (const permission of permissions) await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
  const [user] = await db.execute("INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic Stocktake040',?,?)", [name, await hashPassword(password), now, now]);
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
  const who = { id: user.insertId, roleId: role.insertId, role: name, permissions, password };
  if (device) {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), publicKey = keys.publicKey.export({ type: "spki", format: "der" });
    who.privateKey = keys.privateKey; who.did = app.services.require("deviceBinding").deviceIdFor(publicKey);
    await db.execute("INSERT INTO user_devices (user_id,device_id,public_key,status,requested_at) VALUES (?,?,?,'approved',?)", [who.id, who.did, publicKey, now]);
  }
  const version = await app.services.require("tokenRevocation").currentVersion(String(who.id));
  who.token = app.services.require("jwt").issue({ roles: [name], permissions, ...(who.did ? { did: who.did } : {}) }, { subject: String(who.id), version, authTime: Math.floor(Date.now() / 1000) });
  return who;
}
async function sku(code, name, policy = "none", base = true) {
  const now = Date.now();
  const [item] = await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Synthetic040','standard','active',?,?)", [now, now]);
  const [created] = await db.execute("INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,?,?,0,0,1,'active',?,?)", [item.insertId, code, name, policy, now, now]);
  let mapping;
  if (base) mapping = (await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [created.insertId, uomId, now, now]))[0].insertId;
  return { id: created.insertId, itemId: item.insertId, mapping, code };
}
async function barcode(item, value, mapping = item.mapping) {
  const now = Date.now(); await db.execute("INSERT INTO item_sku_barcodes (sku_id,sku_uom_id,barcode,normalized_barcode,barcode_type,created_at,updated_at) VALUES (?,?,?,?,'internal',?,?)", [item.id, mapping, value, value, now, now]);
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task040_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task040-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  const config = defaultConfigurationSource(); interval = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  const logging = { ...config.logging, loggers: Object.fromEntries(Object.entries(config.logging.loggers).map(([name, value]) => [name, { ...value, directory: path.join(process.env.HARNESS_RUN_DIR, "api-logs", name) }])) };
  app = await createApplication({ configurationSource: { ...config, logging, application: { ...config.application, host: "127.0.0.1", port: 0 }, jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } },
    handlerRegistryOptions: { moduleUrls: ["stocktakeHandlers.js", "skuLookupHandlers.js", "inquiryHandlers.js"].map(name => new URL(`../../src/handlers/inventory/${name}`, import.meta.url).href) } });
  db = app.services.require("mysqldatabase");
  const [[actual]] = await db.query("SELECT VERSION() AS version,@@skip_networking AS isolated,DATABASE() AS name");
  assert.deepEqual([actual.version, Number(actual.isolated), actual.name], ["26.7.0", 1, process.env.DB_NAME]);
  const migrations = (await fs.readdir(new URL("../../database/migrations/", import.meta.url))).filter(name => /\.(?:js|sql)$/u.test(name)).map(name => `migrations/${name}`);
  assert.deepEqual((await db.query("SELECT name FROM fr_schema_migrations ORDER BY name"))[0].map(row => row.name), [...migrations, "framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"].sort());
  viewer = await actor(["inventory.view"]); operator = await actor(["inventory.view", "inventory.operation"]); adjuster = await actor(["inventory.view", "inventory.adjust"], true); itemOnly = await actor(["item.view"]);
  const now = Date.now(), prefix = randomUUID().slice(0, 8);
  uomId = (await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", [`EA${prefix}`, now, now]))[0].insertId;
  collision = `COLL-${prefix}`; plainSku = await sku(`SKU-%_!${prefix}`, "Name 中文 plain"); lotSku = await sku(collision, "Batch 中文", "batch");
  await barcode(plainSku, collision); await barcode(plainSku, "12345670"); await barcode(lotSku, `BATCH-${prefix}`);
  const packUom = (await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?,'Pack','active',?,?)", [`PK${prefix}`, now, now]))[0].insertId;
  const packMapping = (await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,4,0,?,?)", [plainSku.id, packUom, now, now]))[0].insertId;
  packBarcode = `PACK-${prefix}`; await barcode(plainSku, packBarcode, packMapping);
  lotId = (await db.execute("INSERT INTO inventory_lots (sku_id,lot_number,normalized_lot_number,first_receipt_date,expiry_date,sku_code_snapshot,created_at) VALUES (?,'KNOWN','known','2026-01-01','2026-01-02',?,?)", [lotSku.id, lotSku.code, now]))[0].insertId;
  origin = (await app.start()).url;
  observations.push({ kind: "realRuntime", origin, mysqlVersion: actual.version, schema: actual.name, unchangedAuthAndLimiter: true, synthetic: true });
});
after(async () => {
  if (app) await app.shutdown("task040_api_complete");
  if (enabled && process.env.HARNESS_RUN_DIR) await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, "stocktake-ui-api-observations.json"), JSON.stringify(observations));
});
async function raw(route, body, who = operator, options = {}) {
  const at = Math.max(nextAt, performance.now()); nextAt = at + interval; if (at > performance.now()) await setTimeout(at - performance.now());
  return fetch(origin + route, { method: body === undefined ? "GET" : "POST", signal: options.signal,
    headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), "Content-Type": "application/json", "Idempotency-Key": options.key ?? randomUUID(), ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function request(route, body, who = operator, options) { const result = await raw(route, body, who, options); return { status: result.status, body: await result.json() }; }
async function success(route, body, who = operator, options) { const result = await request(route, body, who, options); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.data; }
const lookup = (mode, value, who = viewer) => request(`${LOOKUP}?${new URLSearchParams({ [mode]: value })}`, undefined, who);
async function snapshot() { const state = {}; for (const table of tables) state[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0]; return JSON.stringify(state); }
function safeError(result, status, code) { assert.equal(result.status, status, JSON.stringify(result.body)); if (code) assert.equal(result.body.error.code, code); assert.doesNotMatch(JSON.stringify(result.body), /SELECT |INSERT |stack|password_hash|mysql\.sock/iu); }
async function permission(who, remove) {
  await db.execute(remove ? "DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.view'" : "INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.view'", [who.roleId]);
}
function signedHeaders(who, body, route) {
  const device = app.services.require("deviceBinding"), timestamp = Date.now(), nonce = randomUUID();
  const input = device.signingInput({ accessTokenHash: device.accessTokenHash(who.token), bodyHash: device.bodyHash(Buffer.from(JSON.stringify(body))), deviceId: who.did, method: "POST", nonce, path: route, timestamp });
  return { "X-Device-Id": who.did, "X-Device-Timestamp": String(timestamp), "X-Device-Nonce": nonce,
    "X-Device-Signature": sign("sha256", Buffer.from(input), { key: who.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
}
async function fixture(rows = []) {
  const code = randomUUID(), now = Date.now();
  const warehouseId = (await db.execute("INSERT INTO inventory_warehouses (warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?, ?,?)", [code, code, code, now, now]))[0].insertId;
  const bins = [];
  for (const name of ["COUNT", "EMPTY"]) bins.push((await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?, ?,?)", [warehouseId, name, name.toLowerCase(), now, now]))[0].insertId);
  for (const row of rows) await db.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (?,?,?,?,?,?,'2026-01-01',?,?)", [warehouseId, bins[row.bin ?? 0], row.skuId, row.lotId ?? null, row.status ?? "AVAILABLE", row.quantity ?? 5, now, now]);
  let header = await success(`${ROOT}/create`, { source: source(), warehouseId, binIds: bins });
  header = await success(`${ROOT}/${header.id}/start`, { source: source(), expectedVersion: header.version });
  return { header, warehouseId, bins, lines: (await success(`${ROOT}/${header.id}/lines?pageSize=100`)).items };
}
async function pagedFixture() {
  if (paged) return paged;
  const rows = [{ skuId: plainSku.id }, { skuId: plainSku.id, status: "QUARANTINED" }, { skuId: lotSku.id, lotId, bin: 1 }];
  for (let i = 3; i < 200; i++) rows.push({ skuId: (await sku(`Q-${randomUUID()}`, `Count 中文 ${i}`)).id, bin: i % 2 });
  paged = await fixture(rows); return paged;
}
async function terminalFixture(status) {
  const f = await fixture([{ skuId: plainSku.id }]);
  await success(`${ROOT}/${f.header.id}/counts/save`, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 3 }] });
  f.header = await success(`${ROOT}/${f.header.id}/ready`, { source: source(), expectedVersion: 2 });
  const action = status === "POSTED" ? "post" : "cancel", who = action === "post" ? adjuster : operator;
  const body = { source: source(), expectedVersion: 3, reason: "Synthetic physical reconciliation", password: who.password }, route = `${ROOT}/${f.header.id}/${action}`;
  f.header = await success(route, body, who, { headers: action === "post" ? signedHeaders(who, body, route) : {} }); return f;
}
async function waitFor(check) { const stop = performance.now() + 7000; while (performance.now() < stop) { if (await check()) return; await setImmediate(); } assert.fail("controlled real condition not observed"); }

integrationTest("ST040-A01 actual Inventory view allows Barcode without Item grant and rejects anonymous/Item-only", async () => {
  assert.equal((await lookup("barcode", collision)).body.data.skuId, plainSku.id);
  safeError(await lookup("barcode", collision, null), 401); safeError(await lookup("barcode", collision, itemOnly), 403);
});
integrationTest("ST040-A02 known legal Lot without Balance can be looked up and added at snapshot0", async () => {
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_stock_balances WHERE sku_id=?", [lotSku.id]))[0][0].n), 0);
  const f = await fixture(), before = (await db.query("SELECT COUNT(*) AS n FROM inventory_lots"))[0][0].n;
  const result = await success(`${ROOT}/${f.header.id}/lines/add`, { source: source(), binId: f.bins[0], skuId: lotSku.id, lotId, stockStatus: "AVAILABLE" });
  assert.equal(result.stocktakeId, f.header.id); const [[line]] = await db.query("SELECT * FROM inventory_stocktake_lines WHERE id=?", [result.id]);
  assert.equal(Number(line.snapshot_quantity), 0); assert.equal(line.counted_quantity, null);
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM inventory_lots"))[0][0].n, before);
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_stock_balances WHERE sku_id=?", [lotSku.id]))[0][0].n), 0);
});
integrationTest("ST040-A03 real raw-query strictness rejects malformed Barcode safely while valid bounds reach lookup", async () => {
  const before = await snapshot();
  for (const query of ["", "code=x&barcode=y", "barcode=x&barcode=y", "barcode=", "barcode=%20%20", `barcode=${"a".repeat(191)}`,
    ...["\u0000", "\t", "\r", "\n", "\u007f", "\u0085", "\u009f"].map(control => new URLSearchParams({ barcode: control + collision }).toString())]) {
    safeError(await request(`${LOOKUP}?${query}`, undefined, viewer), 400, "REQUEST_VALIDATION_FAILED");
  }
  for (const value of ["a".repeat(190), "😀".repeat(190), "' OR 1=1 --"]) safeError(await lookup("barcode", value), 404, "INVENTORY_RESOURCE_NOT_FOUND");
  assert.equal(await snapshot(), before);
});
integrationTest("ST040-A04 colliding Code and Barcode resolve distinct explicit identities", async () => {
  assert.equal((await lookup("code", collision)).body.data.skuId, lotSku.id);
  assert.equal((await lookup("barcode", collision)).body.data.skuId, plainSku.id);
});
integrationTest("ST040-A05 numeric scanner normalization and internal text preserve minimal Base response", async () => {
  for (const value of ["12-34 56 70", ` ${collision} `, packBarcode]) {
    const result = (await lookup("barcode", value)).body.data; assert.equal(result.skuId, plainSku.id);
    assert.deepEqual(Object.keys(result).sort(), ["baseUom", "skuCode", "skuId", "skuName", "trackingPolicy"].sort());
    assert.deepEqual(Object.keys(result.baseUom).sort(), ["uomCode", "uomId"]);
    assert.equal(result.baseUom.uomId, uomId);
  }
});
integrationTest("ST040-A06 actual Inventory profile excludes inactive/serial/no-Base but not purchase/sale flags", async () => {
  assert.equal((await lookup("barcode", collision)).status, 200);
  for (const policy of ["serial", "none"]) {
    const item = await sku(`BAD-${randomUUID()}`, "Unsafe", policy); await barcode(item, item.code);
    if (policy === "none") await db.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [item.id]);
    safeError(await lookup("barcode", item.code), 400);
  }
  const absent = await sku(`NOUOM-${randomUUID()}`, "No Base", "none", false);
  safeError(await lookup("code", absent.code), 400, "UOM_CONVERSION_INVALID");
});
integrationTest("ST040-A07 genuinely interrupted owned Item query yields private failure without business effect", async () => {
  const lock = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", password: "", database: process.env.DB_NAME });
  const observe = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", password: "", database: process.env.DB_NAME });
  const before = await snapshot(); let pending;
  try {
    await lock.query("LOCK TABLES item_sku_barcodes WRITE"); pending = lookup("barcode", collision);
    let queryId;
    await waitFor(async () => { const [rows] = await observe.query("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND STATE='Waiting for table metadata lock' AND INFO LIKE '%JOIN item_sku_barcodes%'", [process.env.DB_NAME]); queryId = rows[0]?.ID; return queryId !== undefined; });
    assert.ok(Number.isSafeInteger(Number(queryId))); await observe.query(`KILL QUERY ${Number(queryId)}`);
    const result = await pending; assert.ok(result.status >= 500 && result.status <= 504); assert.doesNotMatch(JSON.stringify(result.body), /SELECT |stack|mysql\.sock|password_hash/iu);
    observations.push({ kind: "actualOwnedQueryInterrupted", metadataWaitObserved: true, status: result.status });
  } finally { await lock.query("UNLOCK TABLES"); await pending?.catch(() => {}); await lock.end(); await observe.end(); }
  assert.equal(await snapshot(), before);
});
integrationTest("ST040-A08 q matches literal Code/Unicode Name only inside selected Stocktake", async () => {
  const f = await pagedFixture(), other = await fixture([{ skuId: plainSku.id }]);
  const literal = await success(`${ROOT}/${f.header.id}/lines?${new URLSearchParams({ q: "%_!" })}`);
  assert.equal(literal.total, 2); assert.ok(literal.items.every(line => line.stocktakeId === f.header.id && line.skuId === plainSku.id));
  assert.equal((await success(`${ROOT}/${other.header.id}/lines?${new URLSearchParams({ q: "Count 中文" })}`)).total, 0);
  const injected = await success(`${ROOT}/${f.header.id}/lines?${new URLSearchParams({ q: "' OR 1=1 --" })}`); assert.equal(injected.total, 0);
  safeError(await request(`${ROOT}/${f.header.id}/lines?q=${"x".repeat(191)}`, undefined), 400);
});
integrationTest("ST040-A09 real200-row q pagination and multi-Bucket filters are stable and global counts distinct", async () => {
  const f = await pagedFixture(), ids = [];
  for (let page = 1; page <= 6; page++) {
    const result = await success(`${ROOT}/${f.header.id}/lines?${new URLSearchParams({ q: "中文", page, pageSize: 37 })}`);
    assert.equal(result.total, 200); assert.equal(result.globalSummary.totalLines, 200); ids.push(...result.items.map(line => line.id));
  }
  assert.equal(new Set(ids).size, 200); assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  const one = await success(`${ROOT}/${f.header.id}/lines?${new URLSearchParams({ q: "%_!", skuId: plainSku.id, binId: f.bins[0], stockStatus: "QUARANTINED" })}`);
  assert.equal(one.total, 1); assert.equal(one.globalSummary.totalLines, 200); assert.equal(one.filteredSummary.totalLines, 1);
});
integrationTest("ST040-A10 Counting q/CSV preserve untouched NULL, counted0,notFound and PREVIEW without variance writes", async () => {
  const f = await pagedFixture(), rows = f.lines.slice(0, 3);
  await success(`${ROOT}/${f.header.id}/counts/save`, { source: source(), lines: rows.map((line, i) => ({ lineId: line.id, expectedVersion: 1, ...(i === 1 ? { notFound: true } : { countedQuantity: i === 0 ? 0 : 7 }) })) });
  const result = await success(`${ROOT}/${f.header.id}/lines?${new URLSearchParams({ q: "中文", pageSize: 100 })}`);
  assert.equal(result.varianceStage, "PREVIEW"); assert.equal(result.globalSummary.uncountedLines, 197);
  assert.deepEqual(result.items.slice(0, 3).map(line => [line.actualQuantity, line.countState]), [[0, "COUNTED"], [0, "NOT_FOUND"], [7, "COUNTED"]]);
  assert.equal(result.items[3].actualQuantity, null); assert.equal(result.items[3].varianceQuantity, null);
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM inventory_stocktake_lines WHERE stocktake_id=? AND variance_quantity IS NOT NULL", [f.header.id]))[0][0].n), 0);
  const csv = parse(await (await raw(`${ROOT}/${f.header.id}/export?${new URLSearchParams({ q: "%_!" })}`, undefined, viewer)).text(), { columns: true });
  assert.equal(csv.filter(row => row.recordType === "LINE").length, 2); assert.equal(csv.at(-1).filteredLineCount, "2"); assert.equal(csv.at(-1).truncated, "false");
});
integrationTest("ST040-A11 Ready/Posted/Cancelled q history stays FROZEN and CSV keeps empty Bin scope", async () => {
  for (const status of ["POSTED", "CANCELLED"]) {
    const f = await terminalFixture(status), result = await success(`${ROOT}/${f.header.id}/lines?${new URLSearchParams({ q: "Name 中文" })}`);
    assert.equal(result.status, status); assert.equal(result.varianceStage, "FROZEN"); assert.equal(result.cancelled, status === "CANCELLED"); assert.equal(result.items[0].varianceQuantity, -2);
    const csv = parse(await (await raw(`${ROOT}/${f.header.id}/export?q=missing`, undefined, viewer)).text(), { columns: true });
    assert.equal(csv.filter(row => row.recordType === "SCOPE").length, 2); assert.equal(csv.filter(row => row.recordType === "LINE").length, 0); assert.equal(csv.at(-1).filteredLineCount, "0");
  }
});
integrationTest("ST040-A12 actual q CSV file-read revocation stops all post-revoke bytes and cleans owned file", async () => {
  const f = await pagedFixture(), open = fs.open, beforeDirs = new Set(await fs.readdir(os.tmpdir())); let reached = false;
  fs.open = async (...args) => { const file = await open(...args); if (String(args[0]).endsWith("/stocktake.csv")) {
    const read = file.read.bind(file); file.read = async (...input) => { const result = await read(...input); if (result.bytesRead && !reached) { reached = true; await permission(viewer, true); } return result; };
  } return file; };
  try {
    let bytes = 0, failed = false;
    try { const result = await raw(`${ROOT}/${f.header.id}/export?${new URLSearchParams({ q: "中文" })}`, undefined, viewer), reader = result.body.getReader();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; }
    } catch { failed = true; }
    assert.equal(reached, true); assert.equal(failed, true); assert.equal(bytes, 0);
    await waitFor(async () => !(await fs.readdir(os.tmpdir())).some(name => name.startsWith("inventory-stocktake-export-") && !beforeDirs.has(name)));
    observations.push({ kind: "actualQCsvRevocation", bytes, cleanup: true });
  } finally { fs.open = open; await permission(viewer, false); }
});
integrationTest("ST040-A13 actual Code/Barcode/q data reads do not mutate Balance/Movement/Operation/locks", async () => {
  const f = await pagedFixture(), before = await snapshot();
  assert.equal((await lookup("code", plainSku.code)).status, 200); assert.equal((await lookup("barcode", collision)).status, 200);
  await success(`${ROOT}/${f.header.id}/lines?${new URLSearchParams({ q: "中文", variance: "GAIN", progress: "COUNTED" })}`);
  await success(`${ROOT}/${f.header.id}`); assert.equal(await snapshot(), before);
});
integrationTest("ST040-A14 legacy Code and existing Stocktake scalar/permission/version contracts remain compatible", async () => {
  const old = (await lookup("code", ` ${plainSku.code} `)).body.data; assert.equal(old.skuId, plainSku.id);
  const f = await fixture([{ skuId: plainSku.id }]), original = source(), body = { source: original, lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 0 }] };
  const key = randomUUID(), first = await success(`${ROOT}/${f.header.id}/counts/save`, body, operator, { key });
  assert.equal(first.version, 2); assert.equal(first.rowCount, 1); assert.deepEqual(await success(`${ROOT}/${f.header.id}/counts/save`, body, operator, { key }), first);
  safeError(await request(`${ROOT}/${f.header.id}/counts/save`, { ...body, source: source() }, viewer), 403);
  assert.equal((await success(`${ROOT}/${f.header.id}/lines`)).items[0].version, 2);
});

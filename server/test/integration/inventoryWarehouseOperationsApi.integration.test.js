import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { readdir } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { createConnection } from "mysql2/promise";
import test, { before, after } from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { UserAdminService } from "../../src/modules/user/UserAdminService.js";
import { INVENTORY_ADJUSTMENT_REASON_CATEGORIES } from "../../src/modules/inventory/inventoryConstants.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_WAREHOUSE_OPERATIONS_API_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
let app, db, origin, manager, viewer, managerToken, viewerToken, skuId, sourceWarehouseId, destinationWarehouseId, sourceBinId, destinationBinId;
let requestIntervalMs, nextRequestAt = 0;
let itemOnlyToken, lookupUomId;
let adjuster, adjustToken, deviceKey, deviceId, password, adminActor;
async function token(actor) {
  const version = await app.services.require("tokenRevocation").currentVersion(String(actor.id));
  return app.services.require("jwt").issue({ roles: [actor.role], permissions: actor.permissions, ...(actor.did ? { did: actor.did } : {}) },
    { subject: String(actor.id), version, authTime: Math.floor(Date.now() / 1000) });
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_p3_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-p3-mysql-2670\.[a-zA-Z0-9]+\/mysql\.sock$/u);
  const config = defaultConfigurationSource();
  // Keep the real limiter enabled; schedule requests within its configured steady rate.
  requestIntervalMs = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  app = await createApplication({ configurationSource: { ...config,
    application: { ...config.application, host: "127.0.0.1", port: 0 },
    jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } },
  handlerRegistryOptions: { moduleUrls: ["transferHandlers.js", "skuLookupHandlers.js", "postingHandlers.js"].map(name => new URL(`../../src/handlers/inventory/${name}`, import.meta.url).href) } });
  db = app.services.require("mysqldatabase");
  const [[server]] = await db.query("SELECT VERSION() AS version, @@skip_networking AS skip_networking, DATABASE() AS db_name");
  assert.deepEqual([server.version, Number(server.skip_networking), server.db_name], ["26.7.0", 1, process.env.DB_NAME]);
  const migrations = (await readdir(new URL("../../database/migrations/", import.meta.url)))
    .filter(name => /\.(?:js|sql)$/u.test(name)).map(name => `migrations/${name}`);
  const [applied] = await db.query("SELECT name FROM fr_schema_migrations ORDER BY name");
  assert.deepEqual(applied.map(row => row.name), [...migrations, "framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"].sort());
  const now = Date.now(), suffix = randomUUID().slice(0, 8);
  async function actor(permissions) {
    const name = `transfer-${randomUUID()}`;
    const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [name, now]);
    for (const permission of permissions) await db.execute("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role.insertId, permission]);
    const [user] = await db.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'synthetic-disabled-login', 'Transfer test', ?, ?)", [name, now, now]);
    await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user.insertId, role.insertId]);
    return { id: user.insertId, roleId: role.insertId, role: name, permissions };
  }
  manager = await actor(["inventory.view", "inventory.operation"]); viewer = await actor(["inventory.view"]);
  managerToken = await token(manager); viewerToken = await token(viewer);
  itemOnlyToken = await token(await actor(["item.view"]));
  adjuster = await actor(["inventory.view", "inventory.adjust"]);
  adminActor = await actor(["user.mgmt"]);
  password = randomBytes(32).toString("hex");
  await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password), adjuster.id]);
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  deviceKey = keys.privateKey;
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" });
  deviceId = app.services.require("deviceBinding").deviceIdFor(publicKey);
  await db.execute("INSERT INTO user_devices (user_id,device_id,public_key,status,requested_at) VALUES (?,?,?,'approved',?)",
    [adjuster.id, deviceId, publicKey, now]);
  adjuster.did = deviceId;
  adjustToken = await token(adjuster);
  const [uom] = await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?, 'Each','active',?,?)", [`EA${suffix}`, now, now]);
  lookupUomId = uom.insertId;
  const [item] = await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Transfer item','standard','active',?,?)", [now, now]);
  const [sku] = await db.execute(`INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at)
    VALUES (?,?,'Transfer SKU','none',1,1,1,'active',?,?)`, [item.insertId, `TR-${suffix}`, now, now]);
  skuId = sku.insertId;
  await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [skuId, uom.insertId, now, now]);
  const ids = [];
  for (const code of ["SOURCE", "DESTINATION"]) {
    const [warehouse] = await db.execute("INSERT INTO inventory_warehouses (warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,?)", [code, code.toLowerCase(), code, now, now]);
    const [bin] = await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,'SAME','same',?,?)", [warehouse.insertId, now, now]);
    ids.push([warehouse.insertId, bin.insertId]);
  }
  [[sourceWarehouseId, sourceBinId], [destinationWarehouseId, destinationBinId]] = ids;
  await db.execute(`INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at)
    VALUES (?,?,?,'AVAILABLE',100,'2026-10-06',?,?)`, [sourceWarehouseId, sourceBinId, skuId, now, now]);
  origin = (await app.start()).url;
});
after(async () => { if (app) await app.shutdown("task029_api_test_complete"); });

const source = () => ({ module: "INVENTORY", documentType: "TRANSFER", documentId: randomUUID(), lineId: "", eventId: randomUUID() });
function draftBody(twoLines = false) {
  const line = { skuId, sourceBinId, lotId: null, stockStatus: "AVAILABLE", quantity: 3 };
  return { source: source(), sourceWarehouseId, destinationWarehouseId, lines: twoLines ? [line, { ...line, quantity: 2 }] : [line] };
}
async function request(path, body, token = managerToken, key = randomUUID(), base = "/api/v1/inventory/transfers", headers = {}) {
  const waitMs = nextRequestAt - performance.now();
  if (waitMs > 0) await setTimeout(waitMs);
  nextRequestAt = performance.now() + requestIntervalMs;
  const response = await fetch(`${origin}${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", "Idempotency-Key": key, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json(), replayed: response.headers.get("Idempotency-Replayed") };
}
async function success(path, body) {
  const response = await request(path, body);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}
async function create(twoLines = false) { return success("/create", draftBody(twoLines)); }
async function snapshot() {
  const result = {};
  for (const table of ["inventory_transfers", "inventory_transfer_lines", "inventory_stock_balances", "inventory_stock_controls", "inventory_operation_requests", "inventory_movements", "inventory_audit_logs", "inventory_reservations", "inventory_allocations", "inventory_lots"]) {
    result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  }
  return JSON.stringify(result);
}
async function rejected(path, body, status, code, token = managerToken) {
  const before = await snapshot(), response = await request(path, body, token);
  assert.equal(response.status, status, JSON.stringify(response.body));
  if (code) assert.equal(response.body.error.code, code);
  assert.doesNotMatch(JSON.stringify(response.body), /SELECT |INSERT |inventory_stock|stack|synthetic-disabled-login/iu);
  assert.equal(await snapshot(), before);
}
const receiveBody = detail => ({ source: source(), version: detail.version,
  lines: detail.lines.map(line => ({ id: line.id, quantity: line.quantity, destinationBinId })) });

integrationTest("DEV-029-API-01 Draft full replacement, filters and cancellation leave stock untouched", async () => {
  const before = JSON.stringify((await db.query("SELECT * FROM inventory_stock_balances ORDER BY id"))[0]);
  const created = await create(true), detail = await success(`/${created.id}`);
  assert.equal(detail.lines.length, 2); assert.equal(detail.createdBy, manager.id);
  const list = await success(`?number=${detail.number}&status=DRAFT&pageSize=1`);
  assert.equal(list.total, 1); assert.equal(list.items[0].id, created.id);
  const line = detail.lines[0];
  const updated = await success(`/${created.id}/update`, { source: source(), version: detail.version,
    sourceWarehouseId, destinationWarehouseId, lines: [{ id: line.id, expectedVersion: line.version,
      skuId, sourceBinId, lotId: null, stockStatus: "AVAILABLE", quantity: 4 }] });
  const replaced = await success(`/${created.id}`);
  assert.equal(updated.version, 2); assert.equal(replaced.lines.length, 1); assert.equal(replaced.lines[0].version, 2);
  const cancelled = await success(`/${created.id}/cancel`, { source: source(), version: updated.version, reason: "Operator cancelled" });
  assert.equal(cancelled.status, "CANCELLED"); assert.equal(cancelled.version, 3);
  const final = await success(`/${created.id}`);
  assert.equal(final.cancelledBy, manager.id); assert.equal(final.lines.length, 1); assert.equal(final.movements.length, 0);
  assert.equal(JSON.stringify((await db.query("SELECT * FROM inventory_stock_balances ORDER BY id"))[0]), before);
});

integrationTest("DEV-029-API-02 whole Dispatch and Receive conserve stock with paired immutable legs", async () => {
  const [[before]] = await db.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE bin_id = ? AND stock_status='AVAILABLE'", [sourceBinId]);
  const created = await create(true);
  const dispatched = await success(`/${created.id}/dispatch`, { source: source(), version: created.version });
  const transit = await success(`/${created.id}`);
  assert.equal(dispatched.status, "IN_TRANSIT"); assert.equal(transit.inTransitQuantity, 5); assert.equal(transit.movements.length, 4);
  assert.equal(transit.dispatchedBy, manager.id); assert.ok(transit.dispatchedAt);
  const [[remaining]] = await db.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE bin_id = ? AND stock_status='AVAILABLE'", [sourceBinId]);
  assert.equal(Number(remaining.on_hand_quantity), Number(before.on_hand_quantity) - 5);
  const received = await success(`/${created.id}/receive`, receiveBody(transit));
  const final = await success(`/${created.id}`);
  assert.equal(received.status, "RECEIVED"); assert.equal(final.inTransitQuantity, 0); assert.equal(final.movements.length, 8);
  assert.equal(final.receivedBy, manager.id); assert.ok(final.lines.every(line => line.destinationBinId === destinationBinId && line.inTransitQuantity === 0));
  const [[quantity]] = await db.query("SELECT SUM(on_hand_quantity) AS quantity FROM inventory_stock_balances WHERE sku_id = ?", [skuId]);
  assert.equal(Number(quantity.quantity), 100);
  const [[audit]] = await db.query("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE operation_request_id IN (?,?)", [dispatched.operationId, received.operationId]);
  assert.equal(Number(audit.count), 2);
});

integrationTest("DEV-029-API-03 missing, repeated, extra and partial Receive lines have zero business effects", async () => {
  const created = await create(true);
  await success(`/${created.id}/dispatch`, { source: source(), version: created.version });
  const detail = await success(`/${created.id}`), body = receiveBody(detail), [first, second] = body.lines;
  for (const lines of [[first], [first, { ...first, stockStatus: "QUARANTINED" }], [first, second, { ...first, id: 999999 }], [first, { ...second, quantity: second.quantity - 1 }]]) {
    await rejected(`/${created.id}/receive`, { ...body, source: source(), lines }, 409, "TRANSFER_PARTIAL_NOT_SUPPORTED");
  }
});

integrationTest("DEV-029-API-04 path-owned children, versions, same-name Bin ownership and InTransit immutability", async () => {
  const created = await create(), other = await create(), detail = await success(`/${other.id}`);
  await rejected(`/${created.id}/update`, { ...draftBody(), version: 1,
    lines: [{ skuId, sourceBinId, stockStatus: "AVAILABLE", quantity: 3, id: detail.lines[0].id, expectedVersion: 1 }] }, 404, "INVENTORY_RESOURCE_NOT_FOUND");
  await rejected(`/${created.id}/dispatch`, { source: source(), version: 2 }, 409, "VERSION_CONFLICT");
  await success(`/${created.id}/dispatch`, { source: source(), version: 1 });
  const transit = await success(`/${created.id}`);
  await rejected(`/${created.id}/receive`, { ...receiveBody(transit), lines: [{ id: transit.lines[0].id, quantity: 3, destinationBinId: sourceBinId }] }, 400, "BIN_WAREHOUSE_MISMATCH");
  await rejected(`/${created.id}/update`, { ...draftBody(), version: transit.version }, 409, "TRANSFER_STATE_CONFLICT");
  await rejected(`/${created.id}/cancel`, { source: source(), version: transit.version, reason: "Not allowed in transit" }, 409, "TRANSFER_STATE_CONFLICT");
});

integrationTest("DEV-029-API-05 Quarantined receipt requires reason and preserves exact dimensions", async () => {
  const created = await create();
  await success(`/${created.id}/dispatch`, { source: source(), version: 1 });
  const transit = await success(`/${created.id}`), body = receiveBody(transit);
  await rejected(`/${created.id}/receive`, { ...body, lines: [{ ...body.lines[0], stockStatus: "QUARANTINED" }] }, 400, "INVENTORY_INPUT_INVALID");
  await rejected(`/${created.id}/receive`, { ...body, source: source(), lines: [{ ...body.lines[0], stockStatus: "DAMAGED" }] }, 409, "STOCK_STATUS_INELIGIBLE");
  await success(`/${created.id}/receive`, { ...body, source: source(), reason: "Inspection required", lines: [{ ...body.lines[0], stockStatus: "QUARANTINED" }] });
  const final = await success(`/${created.id}`);
  assert.equal(final.reason, "Inspection required"); assert.equal(final.lines[0].receiveStockStatus, "QUARANTINED");
  assert.deepEqual([final.lines[0].skuId, final.lines[0].lotId, final.lines[0].quantity], [skuId, null, 3]);
});

integrationTest("DEV-029-API-06 anonymous, read-only and freshly revoked JWT permissions cannot write or replay", async () => {
  const body = draftBody(), created = await success("/create", body);
  await rejected("", undefined, 401, undefined, null);
  await rejected("/create", draftBody(), 401, undefined, null);
  assert.equal((await request(`/${created.id}`, undefined, viewerToken)).status, 200);
  await rejected("/create", draftBody(), 403, undefined, viewerToken);
  await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? AND p.name = 'inventory.operation'", [manager.roleId]);
  try { await rejected("/create", body, 403); }
  finally { await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?, id FROM permissions WHERE name='inventory.operation'", [manager.roleId]); }
});

integrationTest("DEV-029-API-07 HTTP key and domain event replay retain original receipts after later state", async () => {
  const body = draftBody(), key = randomUUID();
  const first = await request("/create", body, managerToken, key);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const before = await snapshot(), repeat = await request("/create", body, managerToken, key);
  assert.deepEqual(repeat.body.data, first.body.data); assert.equal(await snapshot(), before);
  const created = first.body.data;
  await success(`/${created.id}/dispatch`, { source: source(), version: created.version });
  const dispatchedState = await snapshot(), replay = await request("/create", body);
  assert.equal(replay.status, 200); assert.deepEqual(replay.body.data, created); assert.equal(await snapshot(), dispatchedState);
  await rejected("/create", { ...body, lines: [{ ...body.lines[0], quantity: 4 }] }, 409, "INVENTORY_SOURCE_CONFLICT");
  await rejected(`/${created.id}/cancel`, { source: body.source, version: 2, reason: "Conflicting event" }, 409, "INVENTORY_SOURCE_CONFLICT");
});

integrationTest("DEV-029-API-08 Audit failure rolls back Dispatch and same-intent retry posts once", async () => {
  const created = await create(), body = { source: source(), version: 1 };
  // Fixture DDL uses only the already-guarded owned instance's admin, never the HTTP app user.
  const fixtureDb = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", database: process.env.DB_NAME });
  try {
    await fixtureDb.query("CREATE TRIGGER task029_reject_audit BEFORE INSERT ON inventory_audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    await rejected(`/${created.id}/dispatch`, body, 500);
  } finally {
    try { await fixtureDb.query("DROP TRIGGER IF EXISTS task029_reject_audit"); }
    finally { await fixtureDb.end(); }
  }
  const posted = await success(`/${created.id}/dispatch`, body), detail = await success(`/${created.id}`);
  assert.equal(posted.status, "IN_TRANSIT"); assert.equal(detail.movements.length, 2);
  const [[audit]] = await db.query("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE operation_request_id = ?", [posted.operationId]);
  assert.equal(Number(audit.count), 1);
});

const lookupQuery = (query, token = viewerToken) => request(`?${query}`, undefined, token, randomUUID(), "/api/v1/inventory/sku-lookup");
const lookupCode = (code, token = viewerToken) => lookupQuery(new URLSearchParams({ code }), token);
async function lookupSku({ code = `LK-%_${randomUUID()}`, itemStatus = "active", status = "active", tracked = 1, policy = "none", base = true, factor = 1 } = {}) {
  const now = Date.now();
  const [item] = await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Private lookup item','standard',?,?,?)", [itemStatus, now, now]);
  const [sku] = await db.execute(`INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at)
    VALUES (?,?,'Lookup SKU',?,1,1,?,?,?,?)`, [item.insertId, code, policy, tracked, status, now, now]);
  if (base) await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,?,1,?,?)", [sku.insertId, lookupUomId, factor, now, now]);
  return { id: sku.insertId, code };
}
async function rejectedLookup(query, status, code, token = viewerToken) {
  const before = await snapshot(), response = await lookupQuery(query, token);
  assert.equal(response.status, status, JSON.stringify(response.body));
  if (code) assert.equal(response.body.error.code, code);
  assert.doesNotMatch(JSON.stringify(response.body), /SELECT |INSERT |stack|password_hash|Private lookup item/iu);
  assert.equal(await snapshot(), before);
}

integrationTest("DEV-029-LOOKUP-01 Inventory-only lookup enforces framework JWT revocation without Item grants", async () => {
  const sku = await lookupSku();
  assert.equal((await lookupCode(sku.code)).status, 200);
  const query = new URLSearchParams({ code: sku.code });
  await rejectedLookup(query, 401, undefined, null);
  await rejectedLookup(query, 403, undefined, itemOnlyToken);
  await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.view'", [viewer.roleId]);
  try {
    // Read routes inherit JWT claims and version revocation, not the write-side freshness guard.
    await app.services.require("tokenRevocation").revoke(String(viewer.id), { reason: "synthetic lookup revocation" });
    await rejectedLookup(query, 401, "Unauthorized Access");
    await rejectedLookup(query, 403, undefined, await token({ ...viewer, permissions: [] }));
  } finally {
    await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.view'", [viewer.roleId]);
    viewerToken = await token(viewer);
  }
});

integrationTest("DEV-029-LOOKUP-02 strict whitelist and no-Balance SKU support Draft but never authorize Dispatch", async () => {
  const sku = await lookupSku({ itemStatus: "discontinued" });
  const before = await snapshot(), result = await lookupCode(` ${sku.code} `);
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(await snapshot(), before);
  assert.deepEqual(Object.keys(result.body.data).sort(), ["skuId", "skuCode", "skuName", "trackingPolicy", "baseUom"].sort());
  assert.deepEqual(Object.keys(result.body.data.baseUom).sort(), ["uomCode", "uomId"]);
  assert.equal(result.body.data.skuId, sku.id); assert.equal(result.body.data.skuCode, sku.code);
  assert.equal((await db.query("SELECT id FROM inventory_stock_balances WHERE sku_id=?", [sku.id]))[0].length, 0);
  const stocks = JSON.stringify((await db.query("SELECT * FROM inventory_stock_balances ORDER BY id"))[0]);
  const body = draftBody(); body.lines[0].skuId = sku.id;
  const created = await success("/create", body);
  assert.equal(JSON.stringify((await db.query("SELECT * FROM inventory_stock_balances ORDER BY id"))[0]), stocks);
  const response = await request(`/${created.id}/dispatch`, { source: source(), version: 1 });
  assert.equal(response.status, 409, JSON.stringify(response.body)); assert.equal(response.body.error.code, "INSUFFICIENT_STOCK");
  assert.equal(JSON.stringify((await db.query("SELECT * FROM inventory_stock_balances ORDER BY id"))[0]), stocks);
  const detail = await success(`/${created.id}`); assert.equal(detail.status, "DRAFT"); assert.equal(detail.movements.length, 0);
});

integrationTest("DEV-029-LOOKUP-03 bounded Code, literal wildcards and collation never become catalogue search", async () => {
  const code = `Case-%_${randomUUID()}`, sku = await lookupSku({ code });
  assert.equal((await lookupCode(code.toLowerCase())).body.data.skuId, sku.id);
  await rejectedLookup(new URLSearchParams({ code: "Case-%_" }), 404, "INVENTORY_RESOURCE_NOT_FOUND");
  for (const query of ["", "code=a&code=b", "code=a&permission=item.view", new URLSearchParams({ code: "\u0000bad" }),
    new URLSearchParams({ code: "bad\u007f" }), new URLSearchParams({ code: "😀".repeat(191) })]) {
    await rejectedLookup(query, 400, "REQUEST_VALIDATION_FAILED");
  }
  await rejectedLookup("code=%20%20", 400, "SKU_CODE_INVALID");
  const boundary = await lookupSku({ code: "😀".repeat(190) });
  assert.equal((await lookupCode(boundary.code)).body.data.skuId, boundary.id);
});

integrationTest("DEV-029-LOOKUP-04 Item profile rejects invalid tracking/status/Base UOM and stale Draft input", async () => {
  for (const [options, error] of [[{ tracked: 0 }, "SKU_NOT_INVENTORY_TRACKED"], [{ status: "inactive" }, "INVENTORY_INPUT_INVALID"],
    [{ status: "archived" }, "INVENTORY_INPUT_INVALID"], [{ itemStatus: "archived" }, "INVENTORY_INPUT_INVALID"],
    [{ policy: "serial" }, "SERIAL_TRACKING_UNSUPPORTED"], [{ base: false }, "UOM_CONVERSION_INVALID"], [{ factor: 2 }, "UOM_CONVERSION_INVALID"]]) {
    const sku = await lookupSku(options);
    await rejectedLookup(new URLSearchParams({ code: sku.code }), 400, error);
    const body = draftBody(); body.lines[0].skuId = sku.id;
    await rejected("/create", body, 400, error);
  }
});

integrationTest("DEV-029-LOOKUP-05 two-connection rename/inactivation cannot mix read snapshots or exempt later writes", async () => {
  const sku = await lookupSku(), renamed = `CHANGED-${randomUUID()}`;
  const original = db.withTransaction;
  let entered, release;
  const readReached = new Promise(resolve => { entered = resolve; });
  const continueRead = new Promise(resolve => { release = resolve; });
  db.withTransaction = function (work, options) {
    return original.call(this, tx => work({ async query(sql, params) {
      const rows = await tx.query(sql, params);
      if (sql.includes("s.sku_code = ?")) { entered(); await continueRead; }
      return rows;
    } }), options);
  };
  const writer = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", database: process.env.DB_NAME });
  let pending;
  try {
    pending = lookupCode(sku.code);
    await readReached;
    await writer.execute("UPDATE item_skus SET sku_code=?,status='inactive' WHERE id=?", [renamed, sku.id]);
    release();
    const result = await pending;
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.data.skuCode, sku.code);
  } finally { release(); db.withTransaction = original; await writer.end(); if (pending) await pending; }
  await rejectedLookup(new URLSearchParams({ code: sku.code }), 404, "INVENTORY_RESOURCE_NOT_FOUND");
  await rejectedLookup(new URLSearchParams({ code: renamed }), 400, "INVENTORY_INPUT_INVALID");
  const body = draftBody(); body.lines[0].skuId = sku.id;
  await rejected("/create", body, 400, "INVENTORY_INPUT_INVALID");
});

const binMove = (body, actorToken = managerToken, key = randomUUID()) => request("", body, actorToken, key, "/api/v1/inventory/bin-moves");
async function moveBody() {
  const [[balance]] = await db.query("SELECT id,version FROM inventory_stock_balances WHERE bin_id=? AND sku_id=? AND stock_status='AVAILABLE'", [sourceBinId, skuId]);
  const now = Date.now(), code = `MOVE-${randomUUID().slice(0, 8)}`;
  const [bin] = await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?,?,?)", [sourceWarehouseId, code, code.toLowerCase(), now, now]);
  return { source: { ...source(), documentType: "BIN_MOVE" }, warehouseId: sourceWarehouseId, reason: "Move bins",
    lines: [{ sourceBalanceId: Number(balance.id), destinationBinId: bin.insertId, quantity: 1, expectedSourceVersion: Number(balance.version), expectedDestinationVersion: null }] };
}
async function rejectedMove(body, status, code, actorToken = managerToken, key = randomUUID()) {
  const before = await snapshot(), response = await binMove(body, actorToken, key);
  assert.equal(response.status, status, JSON.stringify(response.body));
  if (code) assert.equal(response.body.error.code, code);
  assert.doesNotMatch(JSON.stringify(response.body), /SELECT |INSERT |inventory_stock|stack|synthetic-disabled-login/iu);
  assert.equal(await snapshot(), before);
}

integrationTest("DEV-030-API-01 whole Bin Move posts paired legs and immutable HTTP/domain replay", async () => {
  const body = await moveBody(), key = randomUUID();
  body.lines.push({ ...body.lines[0], quantity: 2 });
  const [[beforeTotals]] = await db.query("SELECT SUM(on_hand_quantity) AS quantity FROM inventory_stock_balances WHERE sku_id=?", [skuId]);
  const first = await binMove(body, managerToken, key);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const result = first.body.data;
  assert.deepEqual(Object.keys(result).sort(), ["status", "operationId", "movementGroupId", "lineCount"].sort());
  assert.equal(result.status, "POSTED"); assert.equal(result.lineCount, 2);
  const [legs] = await db.query("SELECT * FROM inventory_movements WHERE operation_request_id=? ORDER BY id", [result.operationId]);
  assert.deepEqual(legs.map(row => [row.direction, Number(row.quantity)]), [["OUT", 1], ["IN", 1], ["OUT", 2], ["IN", 2]]);
  assert.ok(legs.every(row => row.movement_group_id === result.movementGroupId && row.posted_by === manager.id && row.movement_type === "BIN_MOVE"));
  const [[totals]] = await db.query("SELECT SUM(on_hand_quantity) AS quantity FROM inventory_stock_balances WHERE sku_id=?", [skuId]);
  assert.equal(Number(totals.quantity), Number(beforeTotals.quantity));
  const [[audit]] = await db.query("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE operation_request_id=?", [result.operationId]);
  assert.equal(Number(audit.count), 4);
  const before = await snapshot();
  assert.deepEqual((await binMove(body, managerToken, key)).body.data, result);
  assert.deepEqual((await binMove(body)).body.data, result);
  assert.equal(await snapshot(), before);
  await rejectedMove({ ...body, lines: [...body.lines].reverse() }, 409, "INVENTORY_SOURCE_CONFLICT");
  for (const quantity of ["1", true]) {
    const invalid = structuredClone(body); invalid.lines[0].quantity = quantity;
    await rejectedMove(invalid, 400, "REQUEST_VALIDATION_FAILED", managerToken, key);
  }
});

integrationTest("DEV-030-API-02 numeric-only bounded schema rejects all coerced IDs/versions and forged fields before claims", async () => {
  const body = await moveBody();
  const beforeCache = (await db.query("SELECT COUNT(*) AS count FROM fr_idempotency_keys"))[0][0].count;
  for (const field of ["sourceBalanceId", "destinationBinId", "quantity", "expectedSourceVersion", "expectedDestinationVersion"]) {
    for (const value of ["1", true]) {
      const invalid = structuredClone(body); invalid.lines[0][field] = value;
      await rejectedMove(invalid, 400, "REQUEST_VALIDATION_FAILED");
    }
  }
  for (const invalid of [{ ...body, warehouseId: "1" }, { ...body, warehouseId: true }, { ...body, actor: { userId: manager.id } },
    { ...body, permission: "inventory.operation" }, { ...body, lines: [] }, { ...body, lines: Array.from({ length: 101 }, () => body.lines[0]) },
    { ...body, lines: [{ ...body.lines[0], skuId }] }, { ...body, reason: "bad\u0000reason" }]) {
    await rejectedMove(invalid, 400, "REQUEST_VALIDATION_FAILED");
  }
  const omitted = structuredClone(body); delete omitted.lines[0].expectedDestinationVersion;
  await rejectedMove(omitted, 400, "REQUEST_VALIDATION_FAILED");
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM fr_idempotency_keys"))[0][0].count, beforeCache);
});

integrationTest("DEV-030-API-03 stale versions, absent/present destinations, ownership and free stock reject whole document", async () => {
  const body = await moveBody(), line = body.lines[0];
  for (const [change, status, code] of [
    [{ expectedSourceVersion: line.expectedSourceVersion + 1 }, 409, "VERSION_CONFLICT"],
    [{ expectedDestinationVersion: 1 }, 409, "VERSION_CONFLICT"],
    [{ destinationBinId: sourceBinId }, 400, "INVENTORY_INPUT_INVALID"],
    [{ destinationBinId }, 400, "BIN_WAREHOUSE_MISMATCH"],
    [{ quantity: 100000 }, 409, "INSUFFICIENT_STOCK"]
  ]) await rejectedMove({ ...body, source: source(), lines: [line, { ...line, ...change }] }, status, code);
  await db.execute("UPDATE inventory_bins SET status='INACTIVE' WHERE id=?", [line.destinationBinId]);
  try { await rejectedMove(body, 400, "BIN_INVALID"); }
  finally { await db.execute("UPDATE inventory_bins SET status='ACTIVE' WHERE id=?", [line.destinationBinId]); }
  const posted = await binMove(body); assert.equal(posted.status, 200, JSON.stringify(posted.body));
  const [[current]] = await db.query("SELECT version FROM inventory_stock_balances WHERE id=?", [line.sourceBalanceId]);
  await rejectedMove({ ...body, source: source(), lines: [{ ...line, expectedSourceVersion: Number(current.version) }] }, 409, "VERSION_CONFLICT");
});

integrationTest("DEV-030-API-04 both permissions, fresh domain reauthorization and revoked JWT protect writes/replays", async () => {
  const body = await moveBody(), key = randomUUID();
  const posted = await binMove(body, managerToken, key); assert.equal(posted.status, 200, JSON.stringify(posted.body));
  await rejectedMove(body, 401, undefined, null);
  await rejectedMove(body, 403, undefined, viewerToken);
  await rejectedMove(body, 403, undefined, itemOnlyToken);
  await rejectedMove(body, 403, undefined, await token({ ...manager, permissions: ["inventory.operation"] }));
  await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.operation'", [manager.roleId]);
  try { await rejectedMove(body, 403, "PERMISSION_STALE"); }
  finally { await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.operation'", [manager.roleId]); }
  await app.services.require("tokenRevocation").revoke(String(manager.id), { reason: "synthetic Bin Move revocation" });
  try { await rejectedMove(body, 401, "Unauthorized Access", managerToken, key); }
  finally { managerToken = await token(manager); }
});

integrationTest("DEV-030-API-05 real Audit failure rolls back whole Move and same-intent retry posts once", async () => {
  const body = await moveBody(); body.lines.push({ ...body.lines[0] });
  const fixtureDb = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", database: process.env.DB_NAME });
  try {
    await fixtureDb.query("CREATE TRIGGER task030_reject_move_audit BEFORE INSERT ON inventory_audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic move audit failure'");
    await rejectedMove(body, 500);
  } finally {
    try { await fixtureDb.query("DROP TRIGGER IF EXISTS task030_reject_move_audit"); }
    finally { await fixtureDb.end(); }
  }
  const posted = await binMove(body); assert.equal(posted.status, 200, JSON.stringify(posted.body));
  const [[counts]] = await db.query("SELECT COUNT(*) AS count FROM inventory_movements WHERE operation_request_id=?", [posted.body.data.operationId]);
  assert.equal(Number(counts.count), 4);
});

function signedHeaders(body, path, actorToken = adjustToken, nonce = randomUUID()) {
  const device = app.services.require("deviceBinding"), timestamp = Date.now();
  const input = device.signingInput({ accessTokenHash: device.accessTokenHash(actorToken),
    bodyHash: device.bodyHash(Buffer.from(JSON.stringify(body))), deviceId, method: "POST", nonce, path, timestamp });
  return { "X-Device-Id": deviceId, "X-Device-Timestamp": String(timestamp), "X-Device-Nonce": nonce,
    "X-Device-Signature": sign("sha256", Buffer.from(input), { key: deviceKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
}
function adjustBody() {
  return { source: { ...source(), documentType: "ADJUSTMENT" }, password, direction: "IN", warehouseId: sourceWarehouseId,
    binId: sourceBinId, skuId, stockStatus: "DAMAGED", expectedBalanceVersion: null, uomId: lookupUomId,
    quantity: 1, reasonCategory: "OTHER", reasonText: "Synthetic adjustment reason" };
}
const highRisk = (body, path = "/api/v1/inventory/adjustments", key = randomUUID(), actorToken = adjustToken,
  headers = signedHeaders(body, path, actorToken)) => request("", body, actorToken, key, path, headers);
async function businessSnapshot() {
  const state = JSON.parse(await snapshot());
  state.inventory_audit_logs = state.inventory_audit_logs.filter(row => row.outcome === "SUCCEEDED");
  return JSON.stringify(state);
}
async function rejectedHighRisk(body, status, code, options = {}) {
  const before = await businessSnapshot(), response = await highRisk(body, options.path, options.key, options.token, options.headers);
  assert.equal(response.status, status, JSON.stringify(response.body));
  if (code) assert.equal(response.body.error.code, code);
  assert.equal(response.replayed, null);
  assert.equal(await businessSnapshot(), before);
  assert.ok(!JSON.stringify(response.body).includes(password));
  return response;
}
async function currentAdjustmentBody() {
  const body = adjustBody();
  const [[balance]] = await db.query("SELECT id,version FROM inventory_stock_balances WHERE warehouse_id=? AND bin_id=? AND sku_id=? AND stock_status='DAMAGED'",
    [sourceWarehouseId, sourceBinId, skuId]);
  if (balance) body.expectedBalanceVersion = Number(balance.version);
  return body;
}

integrationTest("ADJ031-INPUT real strong-auth HTTP rejects forged, mixed and coerced fields before claims", async () => {
  const body = adjustBody(), [[before]] = await db.query("SELECT COUNT(*) AS count FROM fr_idempotency_keys");
  for (const changes of [{ quantity: "1" }, { uomId: true }, { warehouseId: "1" }, { expectedBalanceVersion: "1" },
    { actor: { userId: adjuster.id } }, { context: {} }, { permission: "inventory.adjust" }, { balanceId: 1 },
    { expectedBalanceVersion: undefined }, { uomId: undefined }]) {
    await rejectedHighRisk({ ...body, ...changes }, 400, "REQUEST_VALIDATION_FAILED");
  }
  await rejectedHighRisk({ source: body.source, password, sourceBalanceId: 1, destinationStatus: "IN_TRANSIT",
    expectedSourceVersion: 1, expectedDestinationVersion: null, quantity: 1, uomId: lookupUomId, reasonText: "Not a manual status" },
  400, "REQUEST_VALIDATION_FAILED", { path: "/api/v1/inventory/status-transfers" });
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM fr_idempotency_keys"))[0][0].count, before.count);
});

integrationTest("ADJ031-REASON exact categories, Unicode byte limit and OTHER detail survive real Audit", async () => {
  for (const category of INVENTORY_ADJUSTMENT_REASON_CATEGORIES) {
    const body = await currentAdjustmentBody(); body.reasonCategory = category;
    body.reasonText = category === "OTHER" ? "1234567890" : "中".repeat(166) + "ab";
    const result = await highRisk(body); assert.equal(result.status, 200, JSON.stringify(result.body));
    const [[audit]] = await db.query("SELECT reason_category,reason_text FROM inventory_audit_logs WHERE operation_request_id=? AND outcome='SUCCEEDED'",
      [result.body.data.operationId]);
    assert.deepEqual([audit.reason_category, audit.reason_text], [category, body.reasonText]);
  }
  for (const change of [{ reasonText: "123456789" }, { reasonText: "中".repeat(167) }, { reasonText: " " },
    { reasonText: "control\u0000" }, { reasonCategory: "UNKNOWN" }]) {
    const body = { ...await currentAdjustmentBody(), ...change };
    await rejectedHighRisk(body, 400);
  }
});

integrationTest("ADJ031-PROOF actual JWT, P-256 device and scrypt password are all mandatory", async () => {
  const body = await currentAdjustmentBody();
  await rejectedHighRisk(body, 400, "DEVICE_SIGNATURE_REQUIRED", { headers: {} });
  await rejectedHighRisk(body, 403, "DEVICE_MISMATCH", { token: managerToken });
  await rejectedHighRisk({ ...body, password: "wrong synthetic password" }, 403, "PASSWORD_INVALID");
  await rejectedHighRisk({ ...body, password: undefined }, 400, "PASSWORD_REQUIRED");
  const headers = signedHeaders(body, "/api/v1/inventory/adjustments"); headers["X-Device-Signature"] = randomBytes(64).toString("base64url");
  await rejectedHighRisk(body, 400, "DEVICE_SIGNATURE_INVALID", { headers });
});

integrationTest("ADJ031-HTTP-REPLAY fresh credential/signature preserve immutable domain result and credential-free cache", async () => {
  const body = await currentAdjustmentBody(), key = randomUUID();
  const first = await highRisk(body, undefined, key); assert.equal(first.status, 200, JSON.stringify(first.body));
  const before = await businessSnapshot();
  const replacement = randomBytes(32).toString("hex");
  await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(replacement), adjuster.id]);
  try {
    const changedCredential = { ...body, password: replacement };
    const repeat = await highRisk(changedCredential, undefined, key);
    assert.equal(repeat.status, 200, JSON.stringify(repeat.body)); assert.equal(repeat.replayed, "true");
    assert.deepEqual(repeat.body.data, first.body.data); assert.equal(await businessSnapshot(), before);
    const domain = await highRisk(changedCredential);
    assert.equal(domain.status, 200, JSON.stringify(domain.body)); assert.deepEqual(domain.body.data, first.body.data);
    assert.equal(await businessSnapshot(), before);
    await rejectedHighRisk({ ...changedCredential, quantity: 2 }, 409, "IDEMPOTENCY_CONFLICT", { key });
    const headers = signedHeaders(changedCredential, "/api/v1/inventory/adjustments");
    assert.equal((await highRisk(changedCredential, undefined, key, undefined, headers)).status, 200);
    await rejectedHighRisk(changedCredential, 400, "DEVICE_SIGNATURE_INVALID", { key, headers });
    const cache = JSON.stringify((await db.query("SELECT * FROM fr_idempotency_keys"))[0]);
    assert.ok(!cache.includes(password) && !cache.includes(replacement));
    assert.ok(!JSON.stringify(JSON.parse(await snapshot()).inventory_audit_logs).includes(replacement));
  } finally { await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password), adjuster.id]); }
});

integrationTest("ADJ031-CACHE-WAIT committed revocations and original proof deadline reject after real cache wait", async () => {
  const store = app.services.require("idempotency").store, time = app.services.require("time");
  for (const kind of ["permission", "role", "user", "device", "token", "deadline"]) {
    const body = await currentAdjustmentBody(), key = randomUUID();
    const first = await highRisk(body, undefined, key); assert.equal(first.status, 200, JSON.stringify(first.body));
    const before = await businessSnapshot(), keysBefore = JSON.stringify((await db.query("SELECT * FROM fr_idempotency_keys ORDER BY store_key"))[0]);
    const originalBegin = store.begin, originalNow = time.nowMs;
    let entered, release;
    const reached = new Promise(resolve => { entered = resolve; }), proceed = new Promise(resolve => { release = resolve; });
    store.begin = async function (...args) { const result = await originalBegin.apply(this, args); entered(); await proceed; return result; };
    let pending;
    try {
      pending = highRisk(body, undefined, key).then(result => ({ result }), error => ({ error }));
      await reached;
      if (kind === "permission") await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.adjust'", [adjuster.roleId]);
      if (kind === "role") await db.execute("DELETE FROM user_roles WHERE user_id=?", [adjuster.id]);
      if (kind === "user") await db.execute("UPDATE users SET status='inactive' WHERE id=?", [adjuster.id]);
      if (kind === "device") await db.execute("UPDATE user_devices SET status='revoked' WHERE user_id=? AND device_id=?", [adjuster.id, deviceId]);
      if (kind === "token") await app.services.require("tokenRevocation").revoke(String(adjuster.id), { reason: "synthetic cached replay revocation" });
      if (kind === "deadline") time.nowMs = () => originalNow.call(time) + 60001;
      release();
      const settled = await pending; assert.ifError(settled.error);
      assert.equal(settled.result.status, kind === "token" ? 401 : kind === "deadline" ? 400 : 403, JSON.stringify(settled.result.body));
      assert.equal(settled.result.replayed, null); assert.equal(await businessSnapshot(), before);
      assert.equal(JSON.stringify((await db.query("SELECT * FROM fr_idempotency_keys ORDER BY store_key"))[0]), keysBefore);
    } finally {
      release(); store.begin = originalBegin; time.nowMs = originalNow; if (pending) await pending;
      if (kind === "permission") await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.adjust'", [adjuster.roleId]);
      if (kind === "role") await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [adjuster.id, adjuster.roleId]);
      if (kind === "user") await db.execute("UPDATE users SET status='active' WHERE id=?", [adjuster.id]);
      if (kind === "device") await db.execute("UPDATE user_devices SET status='approved' WHERE user_id=? AND device_id=?", [adjuster.id, deviceId]);
      if (kind === "token") adjustToken = await token(adjuster);
    }
  }
});

integrationTest("ADJ031-STATUS strong-auth HTTP posts all six pairs with exact actor, conservation and immutable replay", async () => {
  for (const from of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) for (const to of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    if (from === to) continue;
    const sku = await lookupSku(), now = Date.now();
    const [balance] = await db.execute(`INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,created_at,updated_at)
      VALUES (?,?,?, ?,10,?,?)`, [sourceWarehouseId, sourceBinId, sku.id, from, now, now]);
    const body = { source: { ...source(), documentType: "STATUS_TRANSFER" }, password, sourceBalanceId: balance.insertId,
      destinationStatus: to, expectedSourceVersion: 1, expectedDestinationVersion: null, quantity: 2,
      uomId: lookupUomId, reasonText: "Synthetic manual status inspection" };
    const path = "/api/v1/inventory/status-transfers", key = randomUUID();
    const first = await highRisk(body, path, key); assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.lineCount, 2);
    const [legs] = await db.query("SELECT direction,stock_status,posted_by FROM inventory_movements WHERE operation_request_id=? ORDER BY id", [first.body.data.operationId]);
    assert.deepEqual(legs.map(row => [row.direction,row.stock_status,Number(row.posted_by)]), [["OUT",from,adjuster.id],["IN",to,adjuster.id]]);
    const [[total]] = await db.query("SELECT SUM(on_hand_quantity) AS quantity FROM inventory_stock_balances WHERE sku_id=?", [sku.id]);
    assert.equal(Number(total.quantity), 10);
    const before = await businessSnapshot();
    const repeat = await highRisk(body, path, key); assert.equal(repeat.replayed, "true");
    assert.deepEqual(repeat.body.data, first.body.data); assert.equal(await businessSnapshot(), before);
  }
});

integrationTest("ADJ031-REVOKE-ORDER real UserAdminService token-first disable commits before Warehouse wait release", async () => {
  const body = await currentAdjustmentBody(), before = await businessSnapshot();
  const blocker = await createConnection({ socketPath: process.env.DB_SOCKET_PATH, user: "root", database: process.env.DB_NAME });
  const original = db.withTransaction;
  let entered, pending;
  const reached = new Promise(resolve => { entered = resolve; });
  db.withTransaction = function (work, options) { return original.call(this, tx => work({
    execute: (...args) => tx.execute(...args), query: (sql, params) => {
      if (sql.includes("FROM inventory_warehouses") && sql.includes("FOR UPDATE")) entered();
      return tx.query(sql, params);
    }
  }), options); };
  try {
    await blocker.beginTransaction();
    await blocker.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [sourceWarehouseId]);
    pending = highRisk(body).then(result => ({ result }), error => ({ error }));
    await reached;
    const administration = new UserAdminService({ database: db, logger: app.services.require("logging").logger,
      time: app.services.require("time"), tokenRevocation: app.services.require("tokenRevocation") });
    await administration.disable({ actorId: adminActor.id, claimedRoles: [adminActor.role], claimedPermissions: adminActor.permissions,
      id: adjuster.id, reason: "Synthetic stock-wait revocation", requestId: randomUUID(), ip: "127.0.0.1" });
    const [[actor]] = await db.query("SELECT status FROM users WHERE id=?", [adjuster.id]);
    assert.equal(actor.status, "disabled");
    assert.ok(await app.services.require("tokenRevocation").currentVersion(String(adjuster.id)) > 0);
    await blocker.commit();
    const settled = await pending; assert.ifError(settled.error);
    assert.equal(settled.result.status, 403, JSON.stringify(settled.result.body));
    assert.equal(settled.result.body.error.code, "PERMISSION_STALE");
    assert.equal(await businessSnapshot(), before);
  } finally {
    await blocker.rollback(); await blocker.end(); db.withTransaction = original; if (pending) await pending;
    await db.execute("UPDATE users SET status='active' WHERE id=?", [adjuster.id]); adjustToken = await token(adjuster);
  }
});

async function reversalBody() {
  const sku = await lookupSku(), now = Date.now();
  const [balance] = await db.execute(`INSERT INTO inventory_stock_balances
    (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at)
    VALUES (?,?,?,'AVAILABLE',10,'2026-01-01',?,?)`, [sourceWarehouseId,sourceBinId,sku.id,now,now]);
  const posted = await highRisk({ source: { ...source(), documentType: "STATUS_TRANSFER" }, password,
    sourceBalanceId: balance.insertId, destinationStatus: "DAMAGED", expectedSourceVersion: 1,
    expectedDestinationVersion: null, quantity: 2, uomId: lookupUomId, reasonText: "Synthetic original status" },
  "/api/v1/inventory/status-transfers");
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  const [legs] = await db.query("SELECT * FROM inventory_movements WHERE operation_request_id=? ORDER BY id", [posted.body.data.operationId]);
  const [guards] = await db.query("SELECT id,version FROM inventory_stock_balances WHERE sku_id=? ORDER BY id", [sku.id]);
  return { sku, legs, path: `/api/v1/inventory/movements/${legs[0].id}/reverse`, body: {
    source: { ...source(), documentType: "REVERSAL" }, password, reasonText: "Synthetic full group correction",
    expectedBalances: guards.map(row => ({ balanceId: Number(row.id), expectedVersion: Number(row.version) })) } };
}

integrationTest("REV032-INPUT real HTTP keeps canonical path and complete numeric guards strict before cache claims", async () => {
  const f = await reversalBody(), [[before]] = await db.query("SELECT COUNT(*) AS n FROM fr_idempotency_keys");
  for (const changes of [{ quantity: 2 }, { uomId: lookupUomId }, { movementId: f.legs[0].id }, { context: {} },
    { expectedBalances: [{ balanceId: String(f.body.expectedBalances[0].balanceId), expectedVersion: 2 }] },
    { expectedBalances: [{ balanceId: f.body.expectedBalances[0].balanceId, expectedVersion: "2" }] },
    { expectedBalances: [{ balanceId: f.body.expectedBalances[0].balanceId, expectedVersion: null }] },
    { expectedBalances: [f.body.expectedBalances[0],f.body.expectedBalances[0]] },
    { reasonText: "中".repeat(167) }, { reasonText: "control\u007f" }]) {
    await rejectedHighRisk({ ...f.body, ...changes }, 400, undefined, { path: f.path });
  }
  await rejectedHighRisk(f.body, 400, undefined, { path: `/api/v1/inventory/movements/0${f.legs[0].id}/reverse` });
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM fr_idempotency_keys"))[0][0].n), Number(before.n));
  await rejectedHighRisk({ ...f.body, expectedBalances: f.body.expectedBalances.slice(0,1) }, 409, "REVERSAL_NOT_ALLOWED", { path: f.path });
});

integrationTest("REV032-HTTP-BOUNDARY real third route requires current JWT-device-password and fixed inventory view plus adjust", async () => {
  const f = await reversalBody();
  await rejectedHighRisk(f.body, 400, "DEVICE_SIGNATURE_REQUIRED", { path: f.path, headers: {} });
  await rejectedHighRisk(f.body, 403, "DEVICE_MISMATCH", { path: f.path, token: managerToken });
  await rejectedHighRisk({ ...f.body, password: "wrong synthetic password" }, 403, "PASSWORD_INVALID", { path: f.path });
  await rejectedHighRisk({ ...f.body, password: undefined }, 400, "PASSWORD_REQUIRED", { path: f.path });
  const headers = signedHeaders(f.body,f.path);
  headers["X-Device-Signature"] = randomBytes(64).toString("base64url");
  await rejectedHighRisk(f.body, 400, "DEVICE_SIGNATURE_INVALID", { path: f.path, headers });
});

integrationTest("REV032-HTTP-REPLAY real permuted guards and fresh password replay the exact four scalars without credentials or second effects", async () => {
  const f = await reversalBody(), key = randomUUID(), first = await highRisk(f.body,f.path,key);
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.data.lineCount, 2);
  assert.deepEqual(Object.keys(first.body.data).sort(), ["lineCount","movementGroupId","operationId","status"]);
  const [legs] = await db.query("SELECT * FROM inventory_movements WHERE operation_request_id=? ORDER BY id", [first.body.data.operationId]);
  assert.deepEqual(legs.map(row => Number(row.reversal_of_movement_id)), f.legs.map(row => Number(row.id)).reverse());
  assert.ok(legs.every(row => Number(row.posted_by) === adjuster.id && row.reservation_id === null && row.allocation_id === null));
  const before = await businessSnapshot(), replacement = randomBytes(32).toString("hex");
  await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(replacement),adjuster.id]);
  try {
    const body = { ...f.body, password: replacement, expectedBalances: [...f.body.expectedBalances].reverse() };
    const replay = await highRisk(body,f.path,key);
    assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.replayed,"true");
    assert.deepEqual(replay.body.data,first.body.data); assert.equal(await businessSnapshot(),before);
    const domain = await highRisk(body,f.path);
    assert.equal(domain.status,200,JSON.stringify(domain.body)); assert.deepEqual(domain.body.data,first.body.data);
    assert.equal(await businessSnapshot(),before);
    await rejectedHighRisk({ ...body, expectedBalances: body.expectedBalances.map(row => ({ ...row, expectedVersion: row.expectedVersion + 1 })) },
      409,"IDEMPOTENCY_CONFLICT",{ path:f.path,key });
    await rejectedHighRisk(body,409,"INVENTORY_SOURCE_CONFLICT",{ path:`/api/v1/inventory/movements/${f.legs[1].id}/reverse` });
    await rejectedHighRisk({ ...body, source: { ...source(), documentType:"REVERSAL" } },409,"MOVEMENT_ALREADY_REVERSED",{ path:f.path });
    const cache = JSON.stringify((await db.query("SELECT * FROM fr_idempotency_keys"))[0]);
    assert.ok(!cache.includes(password) && !cache.includes(replacement));
    assert.ok(!JSON.stringify(JSON.parse(await snapshot()).inventory_audit_logs).includes(replacement));
    const signed = signedHeaders(body,f.path);
    assert.equal((await highRisk(body,f.path,key,undefined,signed)).status,200);
    await rejectedHighRisk(body,400,"DEVICE_SIGNATURE_INVALID",{ path:f.path,key,headers:signed });
  } finally { await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password),adjuster.id]); }
});

integrationTest("REV032-HTTP-REPLAY real cache waits recheck all committed revocations and the original deadline without replacing keys", async () => {
  const store = app.services.require("idempotency").store, time = app.services.require("time");
  for (const kind of ["permission","role","user","device","token","deadline"]) {
    const f = await reversalBody(), key = randomUUID(), first = await highRisk(f.body,f.path,key);
    assert.equal(first.status,200,JSON.stringify(first.body));
    const before = await businessSnapshot(), keys = JSON.stringify((await db.query("SELECT * FROM fr_idempotency_keys ORDER BY store_key"))[0]);
    const originalBegin = store.begin, originalNow = time.nowMs;
    let entered, release;
    const reached = new Promise(resolve => { entered = resolve; }), proceed = new Promise(resolve => { release = resolve; });
    store.begin = async function (...args) { const result = await originalBegin.apply(this,args); entered(); await proceed; return result; };
    let pending;
    try {
      pending = highRisk(f.body,f.path,key).then(result => ({ result }),error => ({ error })); await reached;
      if (kind === "permission") await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.adjust'",[adjuster.roleId]);
      if (kind === "role") await db.execute("DELETE FROM user_roles WHERE user_id=?",[adjuster.id]);
      if (kind === "user") await db.execute("UPDATE users SET status='inactive' WHERE id=?",[adjuster.id]);
      if (kind === "device") await db.execute("UPDATE user_devices SET status='revoked' WHERE user_id=? AND device_id=?",[adjuster.id,deviceId]);
      if (kind === "token") await app.services.require("tokenRevocation").revoke(String(adjuster.id),{ reason:"Synthetic reversal replay revocation" });
      if (kind === "deadline") time.nowMs = () => originalNow.call(time) + 60001;
      release(); const settled = await pending; assert.ifError(settled.error);
      assert.equal(settled.result.status,kind === "token" ? 401 : kind === "deadline" ? 400 : 403,JSON.stringify(settled.result.body));
      assert.equal(settled.result.replayed,null); assert.equal(await businessSnapshot(),before);
      assert.equal(JSON.stringify((await db.query("SELECT * FROM fr_idempotency_keys ORDER BY store_key"))[0]),keys);
    } finally {
      release(); store.begin = originalBegin; time.nowMs = originalNow; if (pending) await pending;
      if (kind === "permission") await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.adjust'",[adjuster.roleId]);
      if (kind === "role") await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)",[adjuster.id,adjuster.roleId]);
      if (kind === "user") await db.execute("UPDATE users SET status='active' WHERE id=?",[adjuster.id]);
      if (kind === "device") await db.execute("UPDATE user_devices SET status='approved' WHERE user_id=? AND device_id=?",[adjuster.id,deviceId]);
      if (kind === "token") adjustToken = await token(adjuster);
    }
  }
});

integrationTest("REV032-REVOKE-ORDER real token-first UserAdmin disable commits before reversal Warehouse wait release", async () => {
  const f = await reversalBody(), before = await businessSnapshot();
  const blocker = await createConnection({ socketPath:process.env.DB_SOCKET_PATH,user:"root",database:process.env.DB_NAME });
  const original = db.withTransaction;
  let entered, pending;
  const reached = new Promise(resolve => { entered = resolve; });
  db.withTransaction = function (work,options) { return original.call(this,tx => work({
    execute:(...args) => tx.execute(...args),query:(sql,params) => {
      if (sql.includes("FROM inventory_warehouses") && sql.includes("FOR UPDATE")) entered();
      return tx.query(sql,params);
    }
  }),options); };
  try {
    await blocker.beginTransaction(); await blocker.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE",[sourceWarehouseId]);
    pending = highRisk(f.body,f.path).then(result => ({ result }),error => ({ error })); await reached;
    const administration = new UserAdminService({ database:db,logger:app.services.require("logging").logger,
      time:app.services.require("time"),tokenRevocation:app.services.require("tokenRevocation") });
    await administration.disable({ actorId:adminActor.id,claimedRoles:[adminActor.role],claimedPermissions:adminActor.permissions,
      id:adjuster.id,reason:"Synthetic reversal stock wait",requestId:randomUUID(),ip:"127.0.0.1" });
    assert.equal((await db.query("SELECT status FROM users WHERE id=?",[adjuster.id]))[0][0].status,"disabled");
    assert.ok(await app.services.require("tokenRevocation").currentVersion(String(adjuster.id)) > 0);
    await blocker.commit(); const settled = await pending; assert.ifError(settled.error);
    assert.equal(settled.result.status,403,JSON.stringify(settled.result.body)); assert.equal(settled.result.body.error.code,"PERMISSION_STALE");
    assert.equal(await businessSnapshot(),before);
  } finally {
    await blocker.rollback(); await blocker.end(); db.withTransaction = original; if (pending) await pending;
    await db.execute("UPDATE users SET status='active' WHERE id=?",[adjuster.id]); adjustToken = await token(adjuster);
  }
});

integrationTest("REV032-ROLLBACK real required Audit failure leaves no inverse leg/link and same intent retry posts once", async () => {
  const f = await reversalBody(), fixtureDb = await createConnection({ socketPath:process.env.DB_SOCKET_PATH,user:"root",database:process.env.DB_NAME });
  try {
    await fixtureDb.query("CREATE TRIGGER task032_reject_audit BEFORE INSERT ON inventory_audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic reversal audit failure'");
    await rejectedHighRisk(f.body,500,undefined,{ path:f.path });
  } finally { try { await fixtureDb.query("DROP TRIGGER IF EXISTS task032_reject_audit"); } finally { await fixtureDb.end(); } }
  const result = await highRisk(f.body,f.path); assert.equal(result.status,200,JSON.stringify(result.body)); assert.equal(result.body.data.lineCount,2);
  const [[audit]] = await db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs WHERE operation_request_id=? AND outcome='SUCCEEDED'",[result.body.data.operationId]);
  assert.equal(Number(audit.n),2);
});

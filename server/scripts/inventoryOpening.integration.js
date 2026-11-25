import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import path from "node:path";
import test, { after, before } from "node:test";
import { createApplication } from "../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../src/modules/user/passwordHash.js";
import { inventoryOperationHash } from "../src/modules/inventory/InventoryOperationService.js";
import { up as openingMigration } from "../database/migrations/0066_create_inventory_opening.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_OPENING_TESTS === "1";
const native = (name, work) => test(name, { skip: !enabled, timeout: 30_000 }, work);
const root = "/api/v1/inventory/opening";
const header = "warehouseCode,binCode,skuCode,lotNumber,expiryDate,stockStatus,baseQuantity,unitCostHkd";
let app, db, origin, manager, viewer, managerDevice;

async function actor(name, permissions) {
  const now = Date.now();
  const [role] = await db.execute("INSERT INTO roles (name,created_at) VALUES (?,?)", [name, now]);
  for (const permission of permissions) {
    const [insert] = await db.execute(
      "INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name = ?",
      [role.insertId, permission]
    );
    assert.equal(insert.affectedRows, 1);
  }
  const password = randomBytes(32).toString("hex");
  const [user] = await db.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [name, await hashPassword(password), name, now, now]
  );
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
  const subject = String(user.insertId);
  const version = await app.services.require("tokenRevocation").currentVersion(subject);
  if (name === "opening-manager") {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKey = keys.publicKey.export({ type: "spki", format: "der" });
    const did = app.services.require("deviceBinding").deviceIdFor(publicKey);
    await db.execute("INSERT INTO user_devices (user_id,device_id,public_key,status,requested_at) VALUES (?,?,?,'approved',?)",
      [user.insertId, did, publicKey, now]);
    managerDevice = { did, password, privateKey: keys.privateKey };
  }
  return app.services.require("jwt").issue({ roles: [name], permissions, ...(managerDevice && name === "opening-manager" ? { did: managerDevice.did } : {}) },
    { subject, version, authTime: Math.floor(now / 1000) });
}

before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_opening_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-opening-[a-z0-9_]+\/mysql\.sock$/u);
  const runDir = path.dirname(process.env.DB_SOCKET_PATH);
  const config = defaultConfigurationSource();
  const logging = { ...config.logging, loggers: Object.fromEntries(Object.entries(config.logging.loggers)
    .map(([key, value]) => [key, { ...value, directory: path.join(runDir, "logs", key) }])) };
  app = await createApplication({ configurationSource: {
    ...config, logging, application: { ...config.application, host: "127.0.0.1", port: 0 },
    jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") }
  }, handlerRegistryOptions: { moduleUrls: [new URL("../src/handlers/inventory/openingHandlers.js", import.meta.url).href] } });
  db = app.services.require("mysqldatabase");
  const [[server]] = await db.query("SELECT VERSION() version, @@skip_networking isolated, DATABASE() db");
  assert.deepEqual([server.version, Number(server.isolated), server.db], ["26.7.0", 1, process.env.DB_NAME]);
  assert.deepEqual(await domainCounts(), [0, 0, 0, 0]);
  manager = await actor("opening-manager", ["inventory.view", "inventory.mgmt"]);
  viewer = await actor("opening-viewer", ["inventory.view"]);

  const now = Date.now();
  const [warehouse] = await db.execute(
    "INSERT INTO inventory_warehouses (warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES ('W1','W1','Synthetic',?,?)",
    [now, now]
  );
  await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,'B1','B1',?,?)",
    [warehouse.insertId, now, now]);
  await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,'B2','B2',?,?)",
    [warehouse.insertId, now, now]);
  const [uom] = await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES ('OPEN-EA','Each','active',?,?)", [now, now]);
  const [item] = await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Opening fixture','standard','active',?,?)", [now, now]);
  const [sku] = await db.execute(
    `INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at)
     VALUES (?,'SKU1','Synthetic','none',1,1,1,'active',?,?)`, [item.insertId, now, now]
  );
  await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)",
    [sku.insertId, uom.insertId, now, now]);
  const [batchSku] = await db.execute(
    `INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at)
     VALUES (?,'SKU2','Synthetic batch','batch_expiry',1,1,1,'active',?,?)`, [item.insertId, now, now]
  );
  await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)",
    [batchSku.insertId, uom.insertId, now, now]);
  origin = (await app.start()).url;
});

after(async () => { if (app) await app.shutdown("inventory_opening_test_complete"); });

async function domainCounts() {
  const [[row]] = await db.query(`SELECT
    (SELECT COUNT(*) FROM inventory_lots) lots,
    (SELECT COUNT(*) FROM inventory_stock_balances) balances,
    (SELECT COUNT(*) FROM inventory_movements) movements,
    (SELECT COUNT(*) FROM inventory_opening_jobs) jobs`);
  return [row.lots, row.balances, row.movements, row.jobs].map(Number);
}

async function request(suffix, token, rows) {
  const body = rows === undefined ? undefined : new FormData();
  if (body) body.set("file", new Blob([[header, ...rows.map(row => row + ",2.05")].join("\n")],
    { type: "text/csv" }), "opening.csv");
  const reply = await fetch(origin + root + suffix, { method: body ? "POST" : "GET", body,
    headers: token ? { Authorization: "Bearer " + token } : {} });
  return { status: reply.status, json: await reply.json() };
}

native("Opening migration reruns without resetting its singleton version", async () => {
  await db.execute("UPDATE inventory_control SET version=2 WHERE id=1");
  await openingMigration(db);
  const [[control]] = await db.query("SELECT lifecycle_status,version FROM inventory_control");
  assert.deepEqual(control, { lifecycle_status: "PRE_GO_LIVE", version: 2 });
});

native("Opening upload saves normalized ready rows and detail returns the same result", async () => {
  const upload = await request("/upload", manager, ["W1,B1,SKU1,,,AVAILABLE,4", "W1,B1,SKU1,,,AVAILABLE,0"]);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  const job = upload.json.data;
  assert.deepEqual([job.status, job.readyRows, job.skippedRows, job.errors], ["READY", 1, [3], []]);
  const stored = (await db.execute("SELECT csv_row_number, normalized_input FROM inventory_opening_rows WHERE job_id=?", [job.id]))[0];
  assert.deepEqual(stored.map(row => {
    const input = typeof row.normalized_input === "string" ? JSON.parse(row.normalized_input) : row.normalized_input;
    return [row.csv_row_number, input.baseQuantity, input.unitCostHkd];
  }), [[2, 4, "2.0500"]]);
  const detail = await request("/jobs/" + job.id, manager);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  assert.deepEqual(detail.json.data, job);
  assert.deepEqual(await domainCounts(), [0, 0, 0, 1]);
});

native("Opening invalid preview persists safe row errors and no normalized or stock rows", async () => {
  const upload = await request("/upload", manager, ["W1,B1,SKU1,,,AVAILABLE,4", "W1,B1,SKU1,LOT,,AVAILABLE,2"]);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  const job = upload.json.data;
  assert.deepEqual([job.status, job.readyRows, job.errors], ["INVALID", 0,
    [{ row: 3, field: "lotNumber", code: "INVENTORY_INPUT_INVALID" }]]);
  assert.equal((await db.query("SELECT csv_row_number FROM inventory_opening_rows WHERE job_id=?", [job.id]))[0].length, 0);
  assert.deepEqual((await request("/jobs/" + job.id, manager)).json.data, job);
  assert.deepEqual(await domainCounts(), [0, 0, 0, 2]);
});

native("Opening authorization protects upload and detail and LIVE blocks new uploads", async () => {
  assert.equal((await request("/upload", null, ["W1,B1,SKU1,,,AVAILABLE,4"])).status, 401);
  assert.equal((await request("/upload", viewer, ["W1,B1,SKU1,,,AVAILABLE,4"])).status, 403);
  assert.equal((await request("/jobs/1", viewer)).status, 403);
  assert.equal((await request("/jobs/99999", manager)).status, 404);
  await db.execute("UPDATE inventory_control SET lifecycle_status='LIVE',go_live_at=1 WHERE id=1");
  try {
    const closed = await request("/upload", manager, ["W1,B1,SKU1,,,AVAILABLE,4"]);
    assert.equal(closed.status, 403, JSON.stringify(closed.json));
    assert.equal(closed.json.error.code, "OPENING_CLOSED");
    assert.equal((await request("/jobs/1", manager)).json.data.control.status, "LIVE");
    assert.deepEqual(await domainCounts(), [0, 0, 0, 2]);
  } finally {
    await db.execute("UPDATE inventory_control SET lifecycle_status='PRE_GO_LIVE',go_live_at=NULL WHERE id=1");
  }
});

function confirmation(job) {
  return { eventId: randomUUID(), expectedVersion: job.version, reason: "Opening reconciliation", password: managerDevice.password };
}

async function confirm(job, body, { signed = true } = {}) {
  const route = root + "/jobs/" + job.id + "/confirm";
  const headers = { Authorization: "Bearer " + manager, "Content-Type": "application/json" };
  if (signed) {
    const device = app.services.require("deviceBinding"), nonce = randomUUID(), timestamp = Date.now();
    const input = device.signingInput({ accessTokenHash: device.accessTokenHash(manager),
      bodyHash: device.bodyHash(Buffer.from(JSON.stringify(body))), deviceId: managerDevice.did,
      method: "POST", nonce, path: route, timestamp });
    Object.assign(headers, { "X-Device-Id": managerDevice.did, "X-Device-Nonce": nonce, "X-Device-Timestamp": String(timestamp),
      "X-Device-Signature": sign("sha256", Buffer.from(input), { key: managerDevice.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") });
  }
  const reply = await fetch(origin + route, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: reply.status, json: await reply.json() };
}

native("Opening confirmation rolls back both rows when the second movement link fails", async () => {
  const upload = await request("/upload", manager, ["W1,B1,SKU1,,,AVAILABLE,4", "W1,B2,SKU2,L1,2027-01-01,AVAILABLE,6"]);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  const job = upload.json.data;
  assert.equal(job.status, "READY");
  const before = await domainCounts();
  const [[operations]] = await db.query("SELECT COUNT(*) total FROM inventory_operation_requests");
  const [[audit]] = await db.query("SELECT COUNT(*) total FROM inventory_audit_logs");
  await db.query(`CREATE TRIGGER test_opening_second_link BEFORE UPDATE ON inventory_opening_rows
    FOR EACH ROW BEGIN IF NEW.csv_row_number = 3 AND NEW.movement_id IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic second row failure'; END IF; END`);
  try {
    const failed = await confirm(job, confirmation(job));
    assert.equal(failed.status, 500, JSON.stringify(failed.json));
    assert.doesNotMatch(JSON.stringify(failed.json), /Synthetic second row failure/u);
    assert.deepEqual(await domainCounts(), before);
    assert.equal((await request("/jobs/" + job.id, manager)).json.data.status, "READY");
    assert.deepEqual((await db.query("SELECT movement_id FROM inventory_opening_rows WHERE job_id=? ORDER BY csv_row_number", [job.id]))[0],
      [{ movement_id: null }, { movement_id: null }]);
    assert.deepEqual((await db.query("SELECT COUNT(*) total FROM inventory_operation_requests"))[0], [operations]);
    assert.deepEqual((await db.query("SELECT COUNT(*) total FROM inventory_audit_logs"))[0], [audit]);
    assert.deepEqual(await costCounts(), [0, 0]);
  } finally {
    await db.query("DROP TRIGGER test_opening_second_link");
  }
});

native("Opening confirmation posts both rows once and rejects another file for the same position", async () => {
  const sourceRows = ["W1,B1,SKU1,,,AVAILABLE,4", "W1,B2,SKU2,L1,2027-01-01,AVAILABLE,6"];
  const upload = await request("/upload", manager, sourceRows);
  const overlap = await request("/upload", manager, [sourceRows[0].replace("AVAILABLE", "QUARANTINED")]);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  assert.equal(overlap.status, 201, JSON.stringify(overlap.json));
  const job = upload.json.data;
  const body = confirmation(job);
  const unsigned = await confirm(job, body, { signed: false });
  assert.equal(unsigned.status, 400);
  assert.equal(unsigned.json.error.code, "DEVICE_SIGNATURE_REQUIRED");
  const posted = await confirm(job, body);
  assert.equal(posted.status, 200, JSON.stringify(posted.json));
  assert.equal(posted.json.data.status, "COMPLETED");
  assert.equal(posted.json.data.control.version, job.control.version + 1);
  assert.deepEqual((await confirm(job, body)).json.data, posted.json.data);
  assert.equal((await confirm(job, { ...body, eventId: randomUUID() })).status, 409);
  const conflict = await confirm(overlap.json.data, confirmation(overlap.json.data));
  assert.equal(conflict.status, 409, JSON.stringify(conflict.json));
  assert.equal(conflict.json.error.code, "OPENING_POSITION_OCCUPIED");
  assert.deepEqual((await domainCounts()).slice(0, 3), [1, 2, 2]);
  const [movements] = await db.query("SELECT movement_type,quantity,operation_request_id FROM inventory_movements ORDER BY quantity");
  assert.deepEqual(movements.map(row => [row.movement_type, Number(row.quantity), Number(row.operation_request_id)]),
    [["OPENING", 4, posted.json.data.operationId], ["OPENING", 6, posted.json.data.operationId]]);
  const [costs] = await db.query(`SELECT ce.entry_kind, ce.unit_cost_source, ce.quantity_delta, ce.value_delta_hkd,
    ce.pool_quantity_after, ce.pool_value_after_hkd, cp.costed_quantity, cp.value_hkd
    FROM inventory_cost_entries ce JOIN inventory_movements m ON m.id=ce.movement_id AND m.sku_id=ce.sku_id
    JOIN inventory_cost_pools cp ON cp.sku_id=m.sku_id
    WHERE m.operation_request_id=? ORDER BY m.quantity`, [posted.json.data.operationId]);
  assert.deepEqual(costs.map(row => Object.values(row)), [
    ["OPENING", "OPENING_FILE", 4, "8.2000", 4, "8.2000", 4, "8.2000"],
    ["OPENING", "OPENING_FILE", 6, "12.3000", 6, "12.3000", 6, "12.3000"]
  ]);
  assert.deepEqual(await costCounts(), [2, 2]);
  assert.equal(Number((await db.query("SELECT COUNT(*) count FROM inventory_audit_logs WHERE action='opening.post'"))[0][0].count), 1);
});

async function costCounts() {
  const [[row]] = await db.query(`SELECT (SELECT COUNT(*) FROM inventory_cost_pools) pools,
    (SELECT COUNT(*) FROM inventory_cost_entries) entries`);
  return Object.values(row).map(Number);
}

native("Opening rejects a pre-cost READY snapshot and rolls back when the cost journal write fails", async () => {
  const rows = ["W1,B2,SKU1,,,AVAILABLE,1"];
  const original = (await request("/upload", manager, rows)).json.data;
  assert.equal(original.status, "READY");
  const [[stored]] = await db.query("SELECT normalized_input FROM inventory_opening_rows WHERE job_id=?", [original.id]);
  const input = typeof stored.normalized_input === "string" ? JSON.parse(stored.normalized_input) : stored.normalized_input;
  delete input.unitCostHkd;
  const hash = inventoryOperationHash({ commandType: "OPENING_POST", payload: [input] });
  await db.execute("UPDATE inventory_opening_rows SET normalized_input=? WHERE job_id=?", [JSON.stringify(input), original.id]);
  await db.execute("UPDATE inventory_opening_jobs SET precheck_snapshot_hash=? WHERE id=?", [hash, original.id]);
  const stale = await confirm(original, confirmation(original));
  assert.equal(stale.status, 409, JSON.stringify(stale.json));
  assert.equal(stale.json.error.code, "OPENING_PRECHECK_STALE");

  const fresh = (await request("/upload", manager, rows)).json.data;
  assert.equal(fresh.status, "READY");
  const before = await domainCounts(), costs = await costCounts();
  await db.query(`CREATE TRIGGER test_opening_journal BEFORE INSERT ON inventory_cost_entries
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic opening journal failure'`);
  try {
    const failed = await confirm(fresh, confirmation(fresh));
    assert.equal(failed.status, 500, JSON.stringify(failed.json));
    assert.deepEqual(await domainCounts(), before);
    assert.deepEqual(await costCounts(), costs);
    const [[link]] = await db.query("SELECT movement_id FROM inventory_opening_rows WHERE job_id=?", [fresh.id]);
    assert.equal(link.movement_id, null);
    assert.equal((await request("/jobs/" + fresh.id, manager)).json.data.status, "READY");
  } finally {
    await db.query("DROP TRIGGER test_opening_journal");
  }
});

native("Opening confirmation rejects an active persistent Stocktake Bin lock without effects", async () => {
  const upload = await request("/upload", manager, ["W1,B2,SKU1,,,AVAILABLE,4"]);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  const job = upload.json.data;
  assert.equal(job.status, "READY");
  const [[bin]] = await db.query("SELECT id, warehouse_id FROM inventory_bins WHERE normalized_code='B2'");
  const [operation] = await db.execute(
    `INSERT INTO inventory_operation_requests (command_type,source_module,source_document_type,source_document_id,
      source_event_id,request_hash,actor_label,created_at) VALUES ('STOCKTAKE_CREATE','INVENTORY','STOCKTAKE','lock',?,?,?,1)`,
    [randomUUID(), "a".repeat(64), "Synthetic"]
  );
  const [stocktake] = await db.execute(
    `INSERT INTO inventory_stocktakes (stocktake_number,warehouse_id,status,create_operation_id,created_at,updated_at)
     VALUES ('OPENING-LOCK',?,'COUNTING',?,1,1)`, [bin.warehouse_id, operation.insertId]
  );
  const [scope] = await db.execute(
    "INSERT INTO inventory_stocktake_bins (stocktake_id,bin_id,bin_code_snapshot,created_at) VALUES (?,?,'B2',1)",
    [stocktake.insertId, bin.id]
  );
  const [lock] = await db.execute(
    "INSERT INTO inventory_bin_locks (bin_id,lock_type,stocktake_id,stocktake_bin_id,locked_at) VALUES (?,'STOCKTAKE',?,?,1)",
    [bin.id, stocktake.insertId, scope.insertId]
  );
  const before = await domainCounts();
  try {
    const failed = await confirm(job, confirmation(job));
    assert.equal(failed.status, 409, JSON.stringify(failed.json));
    assert.equal(failed.json.error.code, "BIN_LOCKED_BY_STOCKTAKE");
    assert.deepEqual(await domainCounts(), before);
    assert.equal((await request("/jobs/" + job.id, manager)).json.data.status, "READY");
  } finally {
    await db.execute("UPDATE inventory_bin_locks SET released_at=2 WHERE id=?", [lock.insertId]);
  }
});

native("Opening rejects the complete snapshot if an Item SKU was renamed after precheck", async () => {
  const response = await request("/upload", manager, [
    "W1,B1,SKU2,SKU-STALE,2027-01-01,AVAILABLE,2",
    "W1,B2,SKU2,SKU-STALE,2027-01-01,AVAILABLE,3"
  ]);
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const job = response.json.data;
  assert.equal(job.status, "READY");
  const before = await domainCounts();
  await db.execute("UPDATE item_skus SET sku_code='SKU2-RENAMED', version=version+1 WHERE sku_code='SKU2'");
  try {
    const result = await confirm(job, confirmation(job));
    assert.equal(result.status, 409, JSON.stringify(result.json));
    assert.equal(result.json.error.code, "OPENING_PRECHECK_STALE");
    assert.equal(result.json.error.details.row, 2);
    assert.deepEqual(await domainCounts(), before);
    assert.deepEqual((await request("/jobs/" + job.id, manager)).json.data, job);
  } finally {
    await db.execute("UPDATE item_skus SET sku_code='SKU2', version=version+1 WHERE sku_code='SKU2-RENAMED'");
  }
});

native("Opening precheck enforces the normalized UTF-8 Lot lock key boundary", async () => {
  const lot = "批".repeat(33) + "A";
  const invalid = await request("/upload", manager, [`W1,B1,SKU2,${lot}A,2027-01-01,AVAILABLE,3`]);
  assert.equal(invalid.status, 201, JSON.stringify(invalid.json));
  assert.deepEqual([invalid.json.data.status, invalid.json.data.errors], ["INVALID", [
    { row: 2, field: "lotNumber", code: "INVENTORY_INPUT_INVALID" }
  ]]);
  const valid = await request("/upload", manager, [`W1,B1,SKU2,${lot},2027-01-01,AVAILABLE,3`]);
  assert.equal(valid.status, 201, JSON.stringify(valid.json));
  assert.equal(valid.json.data.status, "READY");
  const posted = await confirm(valid.json.data, confirmation(valid.json.data));
  assert.equal(posted.status, 200, JSON.stringify(posted.json));
  assert.equal(posted.json.data.status, "COMPLETED");
});

import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import test, { before, after, mock } from "node:test";
import { parse } from "csv-parse/sync";
import { parse as csvParser } from "csv-parse";
import { pipeline } from "node:stream/promises";
import { up as permissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as operations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as audit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as master } from "../../database/migrations/0058_create_inventory_master.js";
import { up as stock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as movements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as reservations } from "../../database/migrations/0063_create_inventory_reservations.js";
import { up as transfers } from "../../database/migrations/0064_create_inventory_transfers.js";
import { up as stocktakes } from "../../database/migrations/0065_create_inventory_stocktakes.js";
import { normalizeDatabaseConfig } from "../../src/framework/configuration/normalizeDatabaseConfig.js";
import { createMySqlDatabasePool } from "../../src/services/mysqldatabase/connection.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { InventoryStocktakeService } from "../../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryInquiryService } from "../../src/modules/inventory/InventoryInquiryService.js";
import { InventoryStocktakeExportService } from "../../src/modules/inventory/InventoryStocktakeExportService.js";
import { issueInventoryHighRiskContext } from "../../src/modules/inventory/inventoryHighRiskContext.js";
import { issueInventoryStocktakeCancelContext, checkInventoryStocktakeCancelContext, consumeInventoryStocktakeCancelContext } from "../../src/modules/inventory/inventoryStocktakeCancelContext.js";
import { assertActorFresh } from "../../src/modules/authorization/directoryLookups.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";
import { formatDateForFile } from "../../src/services/time/timeFormat.js";
import { AuthenticationError } from "../../src/framework/auth/AuthenticationError.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_QUERY_TESTS === "1";
const clock = { nowMs: () => Date.now(), fileDate: (value = new Date()) => formatDateForFile(value, "Asia/Hong_Kong") };
const logger = { error() {}, debug() {}, info() {} }, counterPermissions = ["inventory.view", "inventory.operation"], postPermissions = ["inventory.view", "inventory.adjust"];
const context = new RequestContextService({ config: {}, services: { require: () => clock } });
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 60000 }, () => context.storage.run({}, work));
let db, domain, inquiry;
const extras = [], allTables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_bin_locks",
  "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_operation_requests"];
function database(limit = 10, changes = {}) {
  const config = normalizeDatabaseConfig({ host: "127.0.0.1", port: 3306, user: "root", password: "", database: process.env.DB_NAME,
    socketPath: process.env.DB_SOCKET_PATH, connectionLimit: limit, queueLimit: 50, waitForConnections: true,
    acquireTimeoutMs: 1000, queryTimeoutMs: 5000, transactionTimeoutMs: 20000, abandonedConnectionAction: "destroy", ...changes });
  return new MySqlDatabaseService({ pool: createMySqlDatabasePool(config), config, context, logger });
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task039_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task039-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  db = database(); await db.initialize();
  const [[actual]] = await db.query("SELECT VERSION() AS version,DATABASE() AS name,@@skip_networking AS isolated");
  assert.deepEqual([actual.version, actual.name, Number(actual.isolated)], ["26.7.0", process.env.DB_NAME, 1]);
  assert.equal((await db.query("SHOW TABLES"))[0].length, 0, "fresh owned schema only; no reset of shared data");
  for (const ddl of [
    "CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY,username VARCHAR(190),status VARCHAR(20)) ENGINE=InnoDB",
    "CREATE TABLE roles (id BIGINT UNSIGNED PRIMARY KEY,name VARCHAR(190)) ENGINE=InnoDB",
    "CREATE TABLE user_roles (user_id BIGINT UNSIGNED,role_id BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE role_permissions (role_id BIGINT UNSIGNED,permission_id BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE permissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(190) UNIQUE,description VARCHAR(255) DEFAULT '',created_at BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE fr_token_versions (subject VARCHAR(190) PRIMARY KEY,version BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE user_devices (id BIGINT UNSIGNED PRIMARY KEY,user_id BIGINT UNSIGNED,device_id VARCHAR(64),public_key BLOB,status VARCHAR(20)) ENGINE=InnoDB",
    "CREATE TABLE items (id BIGINT UNSIGNED PRIMARY KEY,name VARCHAR(190),product_type VARCHAR(20),status VARCHAR(20),version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB",
    `CREATE TABLE item_skus (id BIGINT UNSIGNED PRIMARY KEY,item_id BIGINT UNSIGNED,sku_code VARCHAR(190),sku_name VARCHAR(190),status VARCHAR(20),
      purchasable BOOLEAN DEFAULT1,sellable BOOLEAN DEFAULT1,inventory_tracked BOOLEAN DEFAULT1,tracking_policy VARCHAR(20),shelf_life_days INT,
      min_receipt_life_days INT,min_sale_life_days INT,effective_from DATE,effective_to DATE,version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB`,
    "CREATE TABLE item_uoms (id BIGINT UNSIGNED PRIMARY KEY,code VARCHAR(20),name VARCHAR(100),status VARCHAR(20),version INT UNSIGNED DEFAULT1) ENGINE=InnoDB",
    `CREATE TABLE item_sku_uoms (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,sku_id BIGINT UNSIGNED,uom_id BIGINT UNSIGNED,to_base_factor DECIMAL(18,6),
      is_base BOOLEAN,is_default_purchase BOOLEAN,is_default_sale BOOLEAN,version INT UNSIGNED DEFAULT1,
      UNIQUE KEY uq_item_sku_uoms_sku_uom (sku_id,uom_id)) ENGINE=InnoDB`
  ]) await db.query(ddl.replaceAll("DEFAULT1", "DEFAULT 1"));
  for (const migration of [permissions, operations, audit, master, stock, movements, reservations, transfers, stocktakes]) await migration(db);
  await db.query("INSERT INTO users VALUES (7,'synthetic-counter','active'),(8,'synthetic-approver','active')");
  await db.query("INSERT INTO roles VALUES (1,'warehouse-operator'),(2,'warehouse-approver')"); await db.query("INSERT INTO user_roles VALUES (7,1),(8,2)");
  await db.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name IN ('inventory.view','inventory.operation')");
  await db.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");
  await db.query("INSERT INTO fr_token_versions VALUES ('7',0),('8',0)");
  await db.execute("INSERT INTO user_devices VALUES (5,8,?,?,'approved')", ["a".repeat(64), Buffer.from("synthetic-trusted-fixture-public-key")]);
  await db.query("INSERT INTO items (id,name,product_type,status) VALUES (1,'Synthetic','physical','active')");
  await db.query("INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy) VALUES (12,1,'PLAIN','Plain','active','none'),(13,1,'LOT','Lot','active','batch'),(14,1,'WEIGHT','Weight','active','none')");
  await db.query("INSERT INTO item_uoms (id,code,name,status) VALUES (1,'EA','Each','active'),(2,'KG','Kilogram','active')");
  await db.query("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (12,1,1,1,1,1),(13,1,1,1,1,1),(14,2,1,1,1,1)");
  await db.query("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (1,'SYN','syn','Synthetic',1,1)");
  await db.query("INSERT INTO inventory_lots (id,sku_id,lot_number,normalized_lot_number,first_receipt_date,sku_code_snapshot,created_at) VALUES (1,13,'KNOWN','known','2026-01-01','LOT',1)");
  domain = new InventoryStocktakeService({ database: db, time: clock, logger }); inquiry = new InventoryInquiryService({ database: db, time: clock });
});
after(async () => { mock.restoreAll(); for (const extra of extras) await extra.shutdown(); if (db) await db.shutdown(); });
function latch() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function command(action, payload, eventId = randomUUID()) {
  const high = action === "post";
  return inventoryCommandFixture({ actor: { userId: high ? 8 : 7, claimedRoles: [high ? "warehouse-approver" : "warehouse-operator"], claimedPermissions: high ? postPermissions : counterPermissions },
    authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: high ? "inventory.adjust" : "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "synthetic-task039", eventId }, correlationId: eventId, payload });
}
function proof(action, input) {
  const now = clock.nowMs(), high = action === "post", authType = high ? "jwt-device-password" : "jwt-password";
  const req = { method: "POST", apiRoute: { path: `/api/v1/inventory/stocktakes/:id/${action}`, authType }, input: { params: { id: String(input.payload.stocktakeId) } },
    get: () => String(now), auth: { type: authType, claims: { sub: String(input.actor.userId), roles: input.actor.claimedRoles, permissions: input.actor.claimedPermissions,
      ver: 0, exp: Math.floor(now / 1000) + 900, auth_time: Math.floor(now / 1000), ...(high ? { did: "a".repeat(64) } : {}) },
    ...(high ? { deviceBinding: { id: 5, user_id: 8, device_id: "a".repeat(64), public_key: Buffer.from("synthetic-trusted-fixture-public-key"), status: "approved" } } : {}) } };
  return (high ? issueInventoryHighRiskContext : issueInventoryStocktakeCancelContext)(req, input, { time: clock, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0, signatureMaxSkewSeconds: 60 });
}
async function bin() { const code = randomUUID(); return Number((await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (1,?,?,1,1)", [code, code]))[0].insertId); }
async function rows(id) { return (await db.query("SELECT * FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY id", [id]))[0]; }
async function counting(entries = [{ quantity: 5 }], emptyBins = 0) {
  const bins = [];
  for (const entry of entries) {
    const binId = await bin(); bins.push(binId);
    await db.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (1,?,?,?,?,?,'2026-01-01',1,1)",
      [binId, entry.sku ?? 12, entry.lot ?? null, entry.status ?? "AVAILABLE", entry.quantity ?? 5]);
  }
  for (let i = 0; i < emptyBins; i++) bins.push(await bin());
  const draft = await domain.create(command("create", { warehouseId: 1, binIds: bins }));
  const header = await domain.start(command("start", { stocktakeId: draft.id, expectedVersion: 1 }));
  return { header, bins, lines: await rows(header.id) };
}
async function save(f, quantities) {
  return domain.saveCounts(command("count", { stocktakeId: f.header.id, lines: f.lines.map((line, i) => ({ lineId: Number(line.id), expectedVersion: Number(line.version),
    ...(quantities[i] === null ? { notFound: true } : { countedQuantity: quantities[i] }) })) }));
}
async function ready(f, quantities = f.lines.map(() => 5)) { await save(f, quantities); f.header = await domain.ready(command("ready", { stocktakeId: f.header.id, expectedVersion: f.header.version })); return f; }
async function terminal(action, f) { const input = command(action, { stocktakeId: f.header.id, expectedVersion: f.header.version, reason: "synthetic reconciliation" }); return domain[action](input, proof(action, input)); }
async function snapshot() { return JSON.stringify(Object.fromEntries(await Promise.all(allTables.map(async table => [table, (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0]])))); }
async function authorize(database = db, signal) {
  return database.withTransaction(async tx => {
    const reader = { query: (sql, values) => tx.query(sql + " FOR SHARE", values) };
    const actor = await assertActorFresh(reader, { actorId: 7, claimedRoles: ["warehouse-operator"], claimedPermissions: counterPermissions });
    const [[token]] = await reader.query("SELECT version FROM fr_token_versions WHERE subject='7'");
    if (Number(token?.version ?? 0) !== 0) throw new AuthenticationError("JWT_INVALID", "Synthetic JWT revoked");
    return actor;
  }, { signal });
}
const ownedDirs = async () => (await fs.readdir(os.tmpdir())).filter(name => name.startsWith("inventory-stocktake-export-")).sort();
function exporter(database = db, options = {}) { return new InventoryStocktakeExportService({ database, time: clock, logger, config: options }); }
function exportOptions(f, changes = {}, database = db) {
  return { stocktakeId: f.header.id, filters: {}, deadline: new Date(Date.now() + 120000).toISOString(), requestId: randomUUID(),
    authorize: ({ signal } = {}) => authorize(database, signal), ...changes };
}
async function collect(result) { const chunks = []; for await (const chunk of result.stream) chunks.push(chunk); return parse(Buffer.concat(chunks), { columns: true }); }
async function csv(f, config = {}, options = {}) { return collect(await exporter(db, config).prepare(exportOptions(f, options))); }
function wrapReads(database, afterQuery) {
  return { query: (...args) => database.query(...args), withTransaction: (work, options) => database.withTransaction(tx => work({ query: async (...args) => {
    const result = await tx.query(...args); await afterQuery(args[0], result); return result;
  } }), options) };
}
function interceptReader(service, hook) {
  const create = service.createGenerationReader.bind(service);
  service.createGenerationReader = signal => {
    const reader = create(signal), initialize = reader.initialize;
    reader.initialize = async () => {
      const database = await initialize(), transaction = database.withTransaction.bind(database);
      database.withTransaction = (work, options) => transaction(tx => work({ query: async (...args) => {
        await hook(args[0], tx); return tx.query(...args);
      } }), options); return database;
    }; return reader;
  };
}

integrationTest("ST039-D01 real preview preserves zero/notFound/untouched NULL without stored variance or stock writes", async () => {
  const f = await counting([{}, {}, {}, {}]);
  await domain.saveCounts(command("count", { stocktakeId: f.header.id, lines: f.lines.slice(0, 3).map((line, i) => ({ lineId: Number(line.id), expectedVersion: 1, ...(i === 1 ? { notFound: true } : { countedQuantity: i === 0 ? 3 : 0 }) })) }));
  const before = await snapshot(), result = await inquiry.listStocktakeLines({ stocktakeId: f.header.id });
  assert.deepEqual(result.items.map(line => [line.actualQuantity, line.varianceQuantity, line.countState]), [[3, -2, "COUNTED"], [0, -5, "NOT_FOUND"], [0, -5, "COUNTED"], [null, null, "UNCOUNTED"]]);
  assert.ok((await rows(f.header.id)).every(line => line.variance_quantity === null)); assert.equal(await snapshot(), before);
});
integrationTest("ST039-D02 Ready/Posted and all Cancel predecessors distinguish frozen/preview/notStarted", async () => {
  const f = await ready(await counting(), [7]); assert.equal((await inquiry.listStocktakeLines({ stocktakeId: f.header.id })).varianceStage, "FROZEN");
  f.header = await terminal("post", f); const posted = await inquiry.listStocktakeLines({ stocktakeId: f.header.id }); assert.equal(posted.status, "POSTED"); assert.equal(posted.items[0].varianceQuantity, 2); assert.ok(posted.items[0].movementId);
  for (const stage of ["DRAFT", "COUNTING", "READY_TO_POST"]) {
    const g = await counting(); if (stage === "DRAFT") { await terminal("cancel", g); const draft = await domain.create(command("create", { warehouseId: 1, binIds: g.bins })); g.header = draft; g.lines = []; }
    if (stage === "COUNTING") await save(g, [3]); if (stage === "READY_TO_POST") await ready(g, [3]);
    await terminal("cancel", g); const detail = await inquiry.getStocktake(g.header.id);
    assert.equal(detail.cancelled, true); assert.equal(detail.varianceStage, stage === "DRAFT" ? "NOT_STARTED" : stage === "COUNTING" ? "PREVIEW" : "FROZEN");
  }
});
integrationTest("ST039-D03 competing committed Count between header/summary/page cannot mix RR data", async () => {
  const f = await counting(); await save(f, [3]); let observed = false;
  const read = new InventoryInquiryService({ database: wrapReads(db, async sql => { if (!observed && sql.includes("SELECT * FROM inventory_stocktakes")) {
    observed = true; await domain.saveCounts(command("count", { stocktakeId: f.header.id, lines: [{ lineId: Number(f.lines[0].id), expectedVersion: 2, countedQuantity: 7 }] }));
  } }), time: clock });
  const result = await read.listStocktakeLines({ stocktakeId: f.header.id }); assert.equal(observed, true); assert.equal(result.items[0].actualQuantity, 3); assert.equal(result.globalSummary.lossLines, 1);
  assert.equal((await inquiry.listStocktakeLines({ stocktakeId: f.header.id })).items[0].actualQuantity, 7);
});
integrationTest("ST039-D04 SQL filter matrix and mixed-UOM summaries match independent line sets", async () => {
  const f = await counting([{}, { sku: 13, lot: 1, status: "DAMAGED" }, { sku: 14, status: "QUARANTINED" }]); await save(f, [7, 3, null]);
  for (const [filters, count] of [[{ variance: "GAIN" }, 1], [{ variance: "LOSS" }, 2], [{ progress: "NOT_FOUND" }, 1], [{ skuId: 13, lotId: 1, stockStatus: "DAMAGED" }, 1], [{ binId: f.bins[0] }, 1]]) {
    const result = await inquiry.listStocktakeLines({ stocktakeId: f.header.id, ...filters }); assert.equal(result.total, count); assert.equal(result.items.length, count); assert.equal(result.globalSummary.totalLines, 3); assert.equal(result.filteredSummary.totalLines, count);
    assert.ok(Object.keys(result.globalSummary).every(field => field.endsWith("Lines")));
  }
});
integrationTest("ST039-D05 local created-date exact boundaries/list paging/EXISTS do not duplicate roots", async () => {
  const f = await counting([{}, {}]); const midnight = Date.parse("2026-10-12T16:00:00Z");
  await db.execute("UPDATE inventory_stocktakes SET created_at=? WHERE id=?", [midnight, f.header.id]);
  const included = await inquiry.listStocktakes({ binId: f.bins[0], dateFrom: "2026-10-13", dateTo: "2026-10-13", pageSize: 1 });
  assert.equal(included.total, 1); assert.equal(included.items[0].id, f.header.id);
  await db.execute("UPDATE inventory_stocktakes SET created_at=? WHERE id=?", [midnight - 1, f.header.id]);
  assert.equal((await inquiry.listStocktakes({ binId: f.bins[0], dateFrom: "2026-10-13", dateTo: "2026-10-13" })).total, 0);
});
integrationTest("ST039-D06 more than100 scopes remain paginated and current labels do not replace snapshots", async () => {
  const f = await counting([{}], 101); const before = (await inquiry.getStocktake(f.header.id, { scopePageSize: 100 })).scope.items[0];
  await db.execute("UPDATE inventory_bins SET bin_code='RENAMED' WHERE id=?", [before.binId]);
  const result = await inquiry.getStocktake(f.header.id, { scopePage: 2, scopePageSize: 100 }); assert.equal(result.scope.total, 102); assert.equal(result.scope.items.length, 2);
  const first = (await inquiry.getStocktake(f.header.id)).scope.items[0]; assert.equal(first.binCodeSnapshot, before.binCodeSnapshot); assert.equal(first.binCodeCurrent, "RENAMED");
});
integrationTest("ST039-D07 missing header/foreign Bin or Lot filters never cross stocktake ownership", async () => {
  const a = await counting(), b = await counting(); await assert.rejects(inquiry.getStocktake(9007199254740991), { code: "INVENTORY_RESOURCE_NOT_FOUND" });
  assert.equal((await inquiry.listStocktakeLines({ stocktakeId: a.header.id, binId: b.bins[0] })).total, 0); assert.equal((await inquiry.listStocktakeLines({ stocktakeId: a.header.id, lotId: 1 })).total, 0);
});
integrationTest("ST039-D08 corrupt frozen/null/count marker/safe integer fails integrity even behind filters", async () => {
  const f = await ready(await counting(), [3]), id = Number(f.lines[0].id);
  for (const [column, value] of [["variance_quantity", null], ["variance_quantity", -1], ["counted_quantity", "9007199254740992"], ["is_not_found", 1]]) {
    const original = (await rows(f.header.id))[0][column]; await db.execute(`UPDATE inventory_stocktake_lines SET ${column}=? WHERE id=?`, [value, id]);
    try { await assert.rejects(inquiry.listStocktakeLines({ stocktakeId: f.header.id, binId: 9007199254740991 }), { code: "STOCKTAKE_SNAPSHOT_MISMATCH" }); }
    finally { await db.execute(`UPDATE inventory_stocktake_lines SET ${column}=? WHERE id=?`, [original, id]); }
  }
});
integrationTest("ST039-D09 actual filtered CSV retains empty scope, NULL/notFound metadata and no stock effects", async () => {
  const f = await counting([{}, {}, {}], 1); await save(f, [3, null, 7]); const before = await snapshot(), output = await csv(f, {}, { filters: { variance: "LOSS" } });
  assert.equal(output.filter(row => row.recordType === "SCOPE").length, 4); assert.equal(output.filter(row => row.recordType === "LINE").length, 2);
  assert.equal(output.at(-1).filteredLineCount, "2"); assert.equal(output.at(-1).exportedRows, "6"); assert.equal(output.at(-1).truncated, "false"); assert.equal(await snapshot(), before);
  const hash = createHash("sha256").update(JSON.stringify({ stocktakeId: f.header.id, filters: { variance: "LOSS" } })).digest("hex"); assert.equal(output.at(-1).filterHash, hash);
});
integrationTest("ST039-D10 committed Count and Ready between export batches remain one original RR snapshot", async () => {
  const f = await counting([{}, {}]); await save(f, [3, 3]); const service = exporter(); let observed = false;
  interceptReader(service, async sql => { if (!observed && sql.includes("scope.id>?")) { observed = true; await domain.saveCounts(command("count", { stocktakeId: f.header.id, lines: f.lines.map(line => ({ lineId: Number(line.id), expectedVersion: 2, countedQuantity: 7 })) }));
    await domain.ready(command("ready", { stocktakeId: f.header.id, expectedVersion: f.header.version })); } });
  const output = await collect(await service.prepare(exportOptions(f))); assert.equal(observed, true); assert.ok(output.every(row => row.status === "COUNTING")); assert.deepEqual(output.filter(row => row.recordType === "LINE").map(row => row.actualQuantity), ["3", "3"]);
  assert.equal((await inquiry.getStocktake(f.header.id)).status, "READY_TO_POST");
});
integrationTest("ST039-D11 actual primarypool1 works; >500 keysets and delayed socket close block replacement503", async () => {
  const f = await counting([], 501), one = database(1); extras.push(one); await one.initialize();
  // Query fixtures only: valid snapshot-zero rows, not a claim of executing1002 Add workflows.
  await db.execute(`INSERT INTO inventory_stocktake_lines (stocktake_id,stocktake_bin_id,bin_id,sku_id,stock_status,snapshot_quantity,snapshot_balance_version)
    SELECT stocktake_id,id,bin_id,12,'AVAILABLE',0,0 FROM inventory_stocktake_bins WHERE stocktake_id=?`, [f.header.id]);
  await db.execute(`INSERT INTO inventory_stocktake_lines (stocktake_id,stocktake_bin_id,bin_id,sku_id,stock_status,snapshot_quantity,snapshot_balance_version)
    SELECT stocktake_id,id,bin_id,12,'DAMAGED',0,0 FROM inventory_stocktake_bins WHERE stocktake_id=?`, [f.header.id]);
  const service = exporter(one); const before = await ownedDirs(); const output = await collect(await service.prepare(exportOptions(f, {}, one)));
  assert.equal(output.filter(row => row.recordType === "SCOPE").length, 501); assert.equal(output.at(-1).truncated, "false");
  const lines = output.filter(row => row.recordType === "LINE"); assert.equal(lines.length, 1002); assert.equal(new Set(lines.map(row => row.lineId)).size, 1002);
  const lower = await collect(await exporter(one, { exportMaxRows: 503 }).prepare(exportOptions(f, {}, one))); assert.equal(lower.at(-1).exportedRows, "503"); assert.equal(lower.at(-1).truncationReason, "ROW_LIMIT");
  const real = net.createConnection.bind(net), sawClose = latch(), release = latch(); let socket;
  mock.method(net, "createConnection", (...args) => { socket = real(...args); const emit = socket.emit.bind(socket);
    socket.emit = (event, ...values) => { if (event === "close") { sawClose.resolve(); void release.promise.then(() => emit(event, ...values)); return true; } return emit(event, ...values); }; return socket; });
  let pending;
  try {
    pending = service.prepare(exportOptions(f, {}, one)); await sawClose.promise;
    await assert.rejects(service.prepare(exportOptions(f, {}, one)), { code: "INVENTORY_DEPENDENCY_UNAVAILABLE", statusCode: 503 }); assert.equal(socket.destroyed, true);
    release.resolve(); await collect(await pending);
  } finally { release.resolve(); mock.restoreAll(); }
  const defaultService = exporter(), held = latch(), finish = latch(); let auxiliaryCalls = 0;
  const create = defaultService.createGenerationReader.bind(defaultService);
  defaultService.createGenerationReader = signal => { auxiliaryCalls++; const reader = create(signal), close = reader.close; reader.close = async () => { held.resolve(); await finish.promise; return close(); }; return reader; };
  const active = defaultService.prepare(exportOptions(f)); await held.promise;
  try { const busy = await Promise.allSettled(Array.from({ length: 10 }, () => context.storage.run({}, () => defaultService.prepare(exportOptions(f)))));
    assert.ok(busy.every(result => result.status === "rejected" && result.reason.code === "INVENTORY_DEPENDENCY_UNAVAILABLE")); assert.equal(auxiliaryCalls, 1);
  } finally { finish.resolve(); }
  await collect(await active);
  // Functional100k ceiling verification, not fullscale latency/memory/soak acceptance.
  const large = await counting([], 1), digits = "(SELECT0 AS n UNION ALL SELECT1 UNION ALL SELECT2 UNION ALL SELECT3 UNION ALL SELECT4 UNION ALL SELECT5 UNION ALL SELECT6 UNION ALL SELECT7 UNION ALL SELECT8 UNION ALL SELECT9)".replaceAll(/SELECT([0-9])/gu, "SELECT $1");
  const numbers = `SELECT a.n+10*b.n+100*c.n+1000*d.n+10000*e.n+100000*f.n AS n FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN ${digits} e CROSS JOIN (SELECT0 AS n UNION ALL SELECT1) f`.replaceAll(/SELECT([0-9])/gu, "SELECT $1");
  await db.query(`INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy) SELECT 3000000+n,1,CONCAT('CAP-',n),'Synthetic cap','active','none' FROM (${numbers}) seq WHERE n<100001`);
  await db.query("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) SELECT id,1,1,1,1,1 FROM item_skus WHERE id>=3000000 AND id<3100001");
  await db.execute(`INSERT INTO inventory_stocktake_lines (stocktake_id,stocktake_bin_id,bin_id,sku_id,stock_status,snapshot_quantity,snapshot_balance_version)
    SELECT scope.stocktake_id,scope.id,scope.bin_id,sku.id,'AVAILABLE',0,0 FROM inventory_stocktake_bins scope JOIN item_skus sku ON sku.id>=3000000 AND sku.id<3100001 WHERE scope.stocktake_id=?`, [large.header.id]);
  // Match the existing0016 SKU/UOM lookup index; no invented tuning index or raised DB timeout.
  await db.query("ANALYZE TABLE item_sku_uoms,inventory_stocktake_lines");
  const [plan] = await db.query(`EXPLAIN FORMAT=TRADITIONAL SELECT l.id FROM inventory_stocktake_lines l JOIN item_sku_uoms su ON su.sku_id=l.sku_id AND su.is_base=1
    WHERE l.stocktake_id=? AND l.id>? ORDER BY l.id ASC LIMIT500`.replace("LIMIT500", "LIMIT 500"), [large.header.id, 0]);
  assert.equal(plan.find(step => step.table === "su").key, "uq_item_sku_uoms_sku_uom");
  const capService = exporter(db, { exportMaxRows: 200000 }), diagnostics = { purpose: "SUPPORTING_QUERY_DIAGNOSIS_NOT_SLA", plan: null, batches: [] };
  const runDir = process.env.HARNESS_RUN_DIR;
  assert.ok(runDir?.startsWith(path.resolve("docs/inventory_management/evidence") + path.sep));
  const diagnosticPath = path.join(runDir, "stocktake-export-query-diagnostic.json"), createCap = capService.createGenerationReader.bind(capService);
  capService.createGenerationReader = signal => {
    const reader = createCap(signal), initialize = reader.initialize;
    reader.initialize = async () => {
      const database = await initialize(), transaction = database.withTransaction.bind(database);
      database.withTransaction = (work, options) => transaction(tx => work({ query: async (sql, values) => {
      const batch = sql.startsWith("SELECT l.*");
      if (batch && !diagnostics.plan) {
        const [[explained]] = await db.query("EXPLAIN FORMAT=JSON " + sql, values);
        diagnostics.plan = JSON.parse(explained.EXPLAIN);
      }
      const started = performance.now();
      try { const result = await tx.query(sql, values); if (batch) diagnostics.batches.push({ elapsedMs: Math.round(performance.now() - started), rows: result[0].length }); return result; }
      finally { if (batch) await fs.writeFile(diagnosticPath, JSON.stringify(diagnostics, null, 2) + "\n", { mode: 0o600 }); }
      } }), options); return database;
    }; return reader;
  };
  const capped = await capService.prepare(exportOptions(large)); let count = 0, footer;
  await pipeline(capped.stream, csvParser({ columns: true }), async source => { for await (const record of source) { if (record.recordType === "SUMMARY") footer = record; else count++; } });
  assert.equal(count, 100000); assert.equal(footer.exportedRows, "100000"); assert.equal(footer.filteredLineCount, "100001"); assert.equal(footer.truncationReason, "ROW_LIMIT"); assert.equal(capped.truncated, true);
  assert.deepEqual(await ownedDirs(), before);
});
integrationTest("ST039-D12 real slow metadata/batch and current auth cutoff504; genuine SQL timeout stays failure", async () => {
  const f = await counting(); const before = await ownedDirs();
  for (const needle of ["SELECT * FROM inventory_stocktakes", "scope.id>?"]) {
    const service = exporter(db, { exportTimeoutMs: 100 }); let reached = false;
    interceptReader(service, async (sql, tx) => { if (!reached && sql.includes(needle)) { reached = true; await tx.query("SELECT SLEEP(0.4)"); } });
    await assert.rejects(service.prepare(exportOptions(f)), { code: "REQUEST_TIMEOUT", statusCode: 504 }); assert.equal(reached, true);
  }
  const service = exporter(db, { exportTimeoutMs: 100 }); let calls = 0;
  await assert.rejects(service.prepare(exportOptions(f, { authorize: async ({ signal } = {}) => {
    if (++calls === 2) await db.query("SELECT SLEEP(0.4)", [], { signal }); return authorize(db, signal);
  } })), { code: "REQUEST_TIMEOUT", statusCode: 504 });
  const genuine = exporter(db, { exportTimeoutMs: 2000 }); let queried = false;
  interceptReader(genuine, async (_sql, tx) => { if (!queried) { queried = true; await tx.query("SELECT SLEEP(0.2)", [], { timeoutMs: 20 }); } });
  await assert.rejects(genuine.prepare(exportOptions(f)), { code: "DATABASE_QUERY_TIMEOUT" }); assert.equal(queried, true); assert.deepEqual(await ownedDirs(), before);
  const empty = await counting([], 1), emptyService = exporter(db, { exportTimeoutMs: 100 }); let reachedEmpty = false;
  interceptReader(emptyService, async (sql, tx) => { if (!reachedEmpty && sql.includes("SELECT * FROM inventory_stocktakes")) { reachedEmpty = true; await tx.query("SELECT SLEEP(0.4)"); } });
  await assert.rejects(emptyService.prepare(exportOptions(empty)), { code: "REQUEST_TIMEOUT", statusCode: 504 }); assert.equal(reachedEmpty, true);
  // Real data/SQL with a controlled generation clock; not a wall-clock SLA claim.
  const scopes = await counting([], 501), safe = exporter(db, { exportTimeoutMs: 1000 }); let now = Date.now(), batches = 0;
  safe.time = { ...clock, nowMs: () => now };
  const create = safe.createGenerationReader.bind(safe);
  safe.createGenerationReader = signal => { const reader = create(signal), initialize = reader.initialize;
    reader.initialize = async () => {
      const database = await initialize(), transaction = database.withTransaction.bind(database);
      database.withTransaction = (work, options) => transaction(tx => work({ query: async (sql, values) => {
      const result = await tx.query(sql, values);
      if (sql.includes("scope.id>?") && ++batches === 2) {
        const native = result[0][Symbol.iterator].bind(result[0]);
        result[0][Symbol.iterator] = function* () { for (const row of native()) { now += 1001; yield row; } };
      } return result;
      } }), options); return database;
    }; return reader; };
  const stopped = await safe.prepare(exportOptions(scopes)); const prefix = await collect(stopped);
  assert.equal(stopped.truncationReason, "TIME_LIMIT"); assert.equal(prefix.at(-1).exportedRows, "500"); assert.equal(prefix.at(-1).scopeCount, "501"); assert.equal(prefix.filter(row => row.recordType === "SCOPE").length, 500);
  assert.deepEqual(await ownedDirs(), before);
});
integrationTest("ST039-D13 real display text is UTF8/quoted/formula neutralized while negative quantity is numeric", async () => {
  const f = await counting(); await save(f, [3]); const [[original]] = await db.query("SELECT sku_name FROM item_skus WHERE id=12");
  try { await db.execute("UPDATE item_skus SET sku_name=? WHERE id=12", ['=中,"quoted"\nname']); const output = await csv(f); const line = output.find(row => row.recordType === "LINE"); assert.equal(line.skuNameCurrent, '\'=中,"quoted"\nname'); assert.equal(line.varianceQuantity, "-2"); }
  finally { await db.execute("UPDATE item_skus SET sku_name=? WHERE id=12", [original.sku_name]); }
});
integrationTest("ST039-D14 real bounded export Audit and forced actual SQL audit failure prohibit delivery", async () => {
  const f = await counting(); const output = await csv(f, { exportMaxRows: 1 });
  const [[record]] = await db.query("SELECT * FROM inventory_audit_logs WHERE action='inventory.export' AND target_id=? AND outcome='SUCCEEDED' ORDER BY id DESC LIMIT1".replace("LIMIT1", "LIMIT 1"), [f.header.id]);
  assert.equal(record.reason_category, "EXPORT"); assert.ok(record.reason_text.includes(output.at(-1).filterHash)); assert.equal(record.after_summary.rowCount, 1); assert.equal(record.operation_request_id, null);
  const service = exporter(), succeeded = service.audit.recordSucceeded.bind(service.audit);
  service.audit.recordSucceeded = async (tx, input) => { await tx.query("SELECT intended_missing_column FROM inventory_audit_logs"); return succeeded(tx, input); };
  await assert.rejects(service.prepare(exportOptions(f))); assert.equal((await db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs WHERE action='inventory.export' AND target_id=? AND outcome='SUCCEEDED'", [f.header.id]))[0][0].n, 1);
});
integrationTest("ST039-D15 committed user/role/token revocation during generation denies current authority outside RR", async () => {
  const f = await counting();
  for (const target of ["token", "role", "user"]) {
    let checks = 0;
    try {
      await assert.rejects(exporter().prepare(exportOptions(f, { authorize: async options => {
        if (++checks === 2) {
          if (target === "token") await db.execute("UPDATE fr_token_versions SET version=1 WHERE subject='7'");
          else if (target === "user") await db.execute("UPDATE users SET status='inactive' WHERE id=7");
          else await db.execute("DELETE FROM role_permissions WHERE role_id=1 AND permission_id=(SELECT id FROM permissions WHERE name='inventory.view')");
        } return authorize(db, options?.signal);
      } })), error => ["JWT_INVALID", "PERMISSION_STALE"].includes(error.code));
    } finally { await db.execute("UPDATE fr_token_versions SET version=0 WHERE subject='7'"); await db.execute("UPDATE users SET status='active' WHERE id=7"); await db.execute("INSERT INTO role_permissions SELECT 1,id FROM permissions p WHERE p.name='inventory.view' AND NOT EXISTS (SELECT1 FROM role_permissions rp WHERE rp.role_id=1 AND rp.permission_id=p.id)".replace("SELECT1", "SELECT 1")); }
  }
});
integrationTest("ST039-D16 current committed revocation or request abort stops real stream before further disclosure", async () => {
  const f = await counting([{}], 501), before = await ownedDirs(), result = await exporter().prepare(exportOptions(f));
  await db.execute("UPDATE fr_token_versions SET version=1 WHERE subject='7'");
  try { await assert.rejects(collect(result), { code: "JWT_INVALID" }); }
  finally { await db.execute("UPDATE fr_token_versions SET version=0 WHERE subject='7'"); }
  const controller = new AbortController(), aborted = await exporter().prepare(exportOptions(f, { signal: controller.signal }));
  aborted.stream.on("error", () => {}); controller.abort(Object.assign(new Error("owned request aborted"), { code: "REQUEST_TIMEOUT" }));
  await assert.rejects(collect(aborted)); assert.deepEqual(await ownedDirs(), before);
});
integrationTest("ST039-D17 actual initializer/handshake/shutdown faults preserve errors, cleanup and recover slot", async () => {
  const f = await counting(), before = await ownedDirs(), fault = Object.assign(new Error("synthetic disk error"), { code: "EIO" });
  const nativeHealth = MySqlDatabaseService.prototype.healthCheck, nativeInitialize = MySqlDatabaseService.prototype.initialize;
  let healthChecks = 0, ownedDatabase;
  mock.method(MySqlDatabaseService.prototype, "healthCheck", async function () {
    if (this.services) {
      healthChecks++; ownedDatabase = this;
      assert.equal(this.services.require("logging").logger, db.logger);
      assert.notEqual(this.context, db.context); assert.equal(this.context.get().deadline, db.context.get().deadline);
      assert.ok(this.context.get().signal instanceof AbortSignal);
    }
    return nativeHealth.call(this);
  });
  try {
    await csv(f); assert.equal(healthChecks, 1); assert.equal(ownedDatabase.closed, true);
    assert.equal(db.closed, false); assert.equal(context.get().signal, undefined);
    assert.equal((await db.query("SELECT 1 AS ok"))[0][0].ok, 1);
  } finally { mock.restoreAll(); }
  const preAbort = new AbortController(), abortReason = Object.assign(new Error("synthetic request abort"), { code: "REQUEST_ABORTED" });
  preAbort.abort(abortReason); const unstarted = exporter().createGenerationReader(preAbort.signal);
  await assert.rejects(unstarted.initialize(), error => error === abortReason); await unstarted.close(); assert.equal(unstarted.closed, true);
  let slowHealth = false;
  mock.method(MySqlDatabaseService.prototype, "healthCheck", async function () {
    if (this.services) { slowHealth = true; await this.query("SELECT SLEEP(0.4)", [], { operationName: "synthetic-health-wait" }); }
    return nativeHealth.call(this);
  });
  try { await assert.rejects(exporter(db, { exportTimeoutMs: 100 }).prepare(exportOptions(f)), { code: "REQUEST_TIMEOUT", statusCode: 504 }); assert.equal(slowHealth, true); }
  finally { mock.restoreAll(); }
  // Real SELECT1 completes before a controlled initializer settlement pause; this is not a real SQL-delay claim.
  const entered = latch(), release = latch(), cancelled = new AbortController(), delayed = exporter(), createDelayed = delayed.createGenerationReader.bind(delayed);
  let lateOwner, lateDatabase;
  delayed.createGenerationReader = signal => { lateOwner = createDelayed(signal); return lateOwner; };
  mock.method(MySqlDatabaseService.prototype, "initialize", async function () {
    await nativeInitialize.call(this);
    if (this.services) { lateDatabase = this; entered.resolve(); await release.promise; }
  });
  const pending = delayed.prepare(exportOptions(f, { signal: cancelled.signal })); void pending.catch(() => {});
  try {
    await entered.promise; cancelled.abort(abortReason);
    assert.equal(lateOwner.closed, false);
    await assert.rejects(delayed.prepare(exportOptions(f)), { code: "INVENTORY_DEPENDENCY_UNAVAILABLE", statusCode: 503 });
    release.resolve(); await assert.rejects(pending, error => error === abortReason);
    assert.equal(lateOwner.closed, true); assert.equal(lateDatabase.closed, true); assert.equal(db.closed, false);
  } finally { release.resolve(); await pending.catch(() => {}); mock.restoreAll(); }
  const startupFault = Object.assign(new Error("synthetic health failure"), { code: "SYNTHETIC_HEALTH_FAILURE" }); let failedHealth = false;
  mock.method(MySqlDatabaseService.prototype, "healthCheck", async function () {
    await nativeHealth.call(this); if (this.services) { failedHealth = true; throw startupFault; } return true;
  });
  try { await assert.rejects(exporter().prepare(exportOptions(f)), error => error === startupFault); assert.equal(failedHealth, true); }
  finally { mock.restoreAll(); }
  // Relay the real MySQL greeting but hold it before the driver handshake completes; no fake SQL or server reply.
  for (const mode of ["request", "generation"]) {
    const socketPath = path.join(path.dirname(process.env.DB_SOCKET_PATH), "handshake-" + randomUUID().slice(0, 8) + ".sock");
    const realConnection = net.createConnection.bind(net), greeting = latch(), sawClose = latch(), releaseClose = latch(), transports = new Set(), relayTerminals = [];
    let holdGreeting = true, handshakeCaptured = false, opened = 0, completedCloses = 0, ownedTransactions = 0, owner, clientBytes = 0;
    const relay = net.createServer(client => {
      const heldHandshake = holdGreeting && !handshakeCaptured; handshakeCaptured = true;
      const upstream = realConnection(process.env.DB_SOCKET_PATH); transports.add(client); transports.add(upstream);
      for (const socket of [client, upstream]) relayTerminals.push(new Promise(resolve => { socket.once("close", resolve); }));
      client.on("error", () => {}); upstream.on("error", () => {});
      client.on("data", chunk => { if (heldHandshake) clientBytes += chunk.length; upstream.write(chunk); });
      upstream.on("data", chunk => { if (heldHandshake) { upstream.pause(); greeting.resolve(); } else client.write(chunk); });
      client.once("close", () => { transports.delete(client); upstream.destroy(); });
      upstream.once("close", () => { transports.delete(upstream); client.destroy(); });
    });
    await new Promise((resolve, reject) => { relay.once("error", reject); relay.listen(socketPath, resolve); });
    const primary = database(1, { socketPath }); extras.push(primary); const service = exporter(primary, { exportTimeoutMs: mode === "generation" ? 100 : 2000 });
    const create = service.createGenerationReader.bind(service), cancel = new AbortController();
    service.createGenerationReader = signal => { owner = create(signal); return owner; };
    mock.method(net, "createConnection", (...args) => {
      const socket = realConnection(...args);
      if (args[0] === socketPath) {
        opened++; const emit = socket.emit.bind(socket);
        socket.emit = (event, ...values) => {
          if (event === "close" && holdGreeting) { sawClose.resolve(); void releaseClose.promise.then(() => { completedCloses++; emit(event, ...values); }); return true; }
          if (event === "close") completedCloses++;
          return emit(event, ...values);
        };
      } return socket;
    });
    const transaction = MySqlDatabaseService.prototype.withTransaction;
    mock.method(MySqlDatabaseService.prototype, "withTransaction", function (...args) { if (this.services) ownedTransactions++; return transaction.apply(this, args); });
    const requestId = randomUUID(), busyRequestId = randomUUID();
    const preparing = service.prepare(exportOptions(f, { requestId, signal: cancel.signal, authorize: () => authorize(db) }, primary)); void preparing.catch(() => {});
    try {
      await greeting.promise; assert.equal(clientBytes, 0, "native greeting is held before client authentication/query");
      if (mode === "request") cancel.abort(abortReason);
      await sawClose.promise; assert.equal(opened, 1); assert.equal(owner.closed, false); assert.equal(ownedTransactions, 0);
      await assert.rejects(service.prepare(exportOptions(f, { requestId: busyRequestId }, primary)), { code: "INVENTORY_DEPENDENCY_UNAVAILABLE", statusCode: 503 });
      assert.equal((await db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs WHERE request_id=? AND outcome='FAILED' AND target_id=?", [busyRequestId, f.header.id]))[0][0].n, 1, "primary pool1 fresh auth and FAILED Audit succeed while reader handshake is outstanding");
      releaseClose.resolve();
      await assert.rejects(preparing, error => mode === "generation" ? error.code === "REQUEST_TIMEOUT" && error.statusCode === 504 : error === abortReason || error.cause === abortReason);
      assert.equal((await db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs WHERE request_id=? AND outcome='FAILED' AND target_id=?", [requestId, f.header.id]))[0][0].n, 1, "request abort/timeout Audit persisted on primary pool1");
      assert.equal(owner.closed, true); assert.equal(completedCloses, 1); assert.equal(opened, 1); assert.equal(ownedTransactions, 0);
      holdGreeting = false;
      await collect(await service.prepare(exportOptions(f, {}, primary)));
      assert.equal(opened, 2); assert.equal(completedCloses, 2); assert.equal(ownedTransactions, 1); assert.equal(primary.closed, false);
    } finally {
      releaseClose.resolve(); await preparing.catch(() => {}); mock.restoreAll();
      for (const socket of transports) socket.destroy();
      await Promise.all(relayTerminals); assert.equal(transports.size, 0);
      await new Promise(resolve => { relay.close(resolve); });
      await assert.rejects(fs.lstat(socketPath), { code: "ENOENT" });
    }
  }
  await csv(f); assert.equal(db.closed, false); assert.deepEqual(await ownedDirs(), before);
  mock.method(fs, "chmod", async () => { throw fault; }, { times: 1 });
  try { await assert.rejects(exporter().prepare(exportOptions(f)), error => error === fault); } finally { mock.restoreAll(); }
  const failed = exporter(), create = failed.createGenerationReader.bind(failed); let reader;
  failed.createGenerationReader = signal => { reader = create(signal); const initialize = reader.initialize;
    reader.initialize = async () => { const database = await initialize(), shutdown = database.shutdown.bind(database);
      database.shutdown = async () => { await shutdown(); throw fault; }; return database; }; return reader; };
  await assert.rejects(failed.prepare(exportOptions(f)), error => error === fault); assert.equal(reader.closed, true); await csv(f);
  const wrong = database(1, { user: "unknown_synthetic_task039" }); extras.push(wrong); const handshake = exporter(wrong);
  await assert.rejects(handshake.prepare(exportOptions(f, { authorize: () => authorize(db) }))); assert.deepEqual(await ownedDirs(), before);
});
integrationTest("ST039-D18 real Cancel non-consuming preflight/current revocation/one consume retains flow contract", async () => {
  const f = await counting(), input = command("cancel", { stocktakeId: f.header.id, expectedVersion: f.header.version, reason: "synthetic abandon" }), capsule = proof("cancel", input);
  await db.withTransaction(tx => checkInventoryStocktakeCancelContext(tx, capsule, input)); await db.withTransaction(tx => checkInventoryStocktakeCancelContext(tx, capsule, input));
  const guard = consumeInventoryStocktakeCancelContext(capsule, input); await db.withTransaction(tx => guard.check(tx, { locking: true }));
  await db.execute("UPDATE fr_token_versions SET version=1 WHERE subject='7'");
  try { await assert.rejects(db.withTransaction(tx => guard.check(tx, { locking: true })), { code: "JWT_INVALID" }); assert.throws(() => consumeInventoryStocktakeCancelContext(capsule, input), { code: "PERMISSION_STALE" }); }
  finally { await db.execute("UPDATE fr_token_versions SET version=0 WHERE subject='7'"); }
  const cancelled = await domain.cancel(input, proof("cancel", input)); assert.equal(cancelled.status, "CANCELLED");
});
integrationTest("ST039-D19 Count/Add original scalar receipts retain line/parent versions through public queries", async () => {
  const f = await counting(), input = command("count", { stocktakeId: f.header.id, lines: [{ lineId: Number(f.lines[0].id), expectedVersion: 1, countedQuantity: 0 }] });
  const original = await domain.saveCounts(input); assert.equal(original.id, f.header.id); assert.equal(original.version, f.header.version); assert.deepEqual(await domain.saveCounts(input), original);
  const added = await domain.addLine(command("add_line", { stocktakeId: f.header.id, binId: f.bins[0], skuId: 13, lotId: 1, stockStatus: "AVAILABLE" }));
  const output = await inquiry.listStocktakeLines({ stocktakeId: f.header.id }); assert.equal(added.stocktakeId, f.header.id); assert.equal(added.version, 1); assert.equal(output.items.find(line => line.id === added.id).snapshotQuantity, 0); assert.equal(output.version, f.header.version);
});
integrationTest("ST039-D20 unchanged migration rerun/domain replay/legacy count query remain real compatible", async () => {
  await stocktakes(db); const f = await counting(); const input = command("count", { stocktakeId: f.header.id, lines: [{ lineId: Number(f.lines[0].id), expectedVersion: 1, countedQuantity: 3 }] });
  const result = await domain.saveCounts(input); assert.deepEqual(await domain.saveCounts(input), result);
  const old = await inquiry.listStocktakeCountLines({ stocktakeId: f.header.id }); assert.equal(old.items.length, 1); assert.equal(old.items[0].countedQuantity, 3);
  const before = await snapshot(); await inquiry.getStocktake(f.header.id); await inquiry.listStocktakeLines({ stocktakeId: f.header.id }); assert.equal(await snapshot(), before);
});

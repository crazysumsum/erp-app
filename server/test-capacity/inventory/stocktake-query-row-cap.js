import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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


import { assertActorFresh } from "../../src/modules/authorization/directoryLookups.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";
import { formatDateForFile } from "../../src/services/time/timeFormat.js";
import { AuthenticationError } from "../../src/framework/auth/AuthenticationError.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_QUERY_TESTS === "1";
const clock = { nowMs: () => Date.now(), fileDate: (value = new Date()) => formatDateForFile(value, "Asia/Hong_Kong") };
const logger = { error() {}, debug() {}, info() {} }, counterPermissions = ["inventory.view", "inventory.operation"], postPermissions = ["inventory.view", "inventory.adjust"];
const context = new RequestContextService({ config: {}, services: { require: () => clock } });
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 60000 }, () => context.storage.run({}, work));
let db, domain, _inquiry;
const extras = [], _allTables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_bin_locks",
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
  domain = new InventoryStocktakeService({ database: db, time: clock, logger }); _inquiry = new InventoryInquiryService({ database: db, time: clock });
});
after(async () => { mock.restoreAll(); for (const extra of extras) await extra.shutdown(); if (db) await db.shutdown(); });
function latch() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function command(action, payload, eventId = randomUUID()) {
  const high = action === "post";
  return inventoryCommandFixture({ actor: { userId: high ? 8 : 7, claimedRoles: [high ? "warehouse-approver" : "warehouse-operator"], claimedPermissions: high ? postPermissions : counterPermissions },
    authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: high ? "inventory.adjust" : "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "synthetic-task039", eventId }, correlationId: eventId, payload });
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










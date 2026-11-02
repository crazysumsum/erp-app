import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import mysql from "mysql2/promise";
import { up as permissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as operations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as auditMigration } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as master } from "../../database/migrations/0058_create_inventory_master.js";
import { up as stock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as movements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as reservations } from "../../database/migrations/0063_create_inventory_reservations.js";
import { up as transfers } from "../../database/migrations/0064_create_inventory_transfers.js";
import { up as stocktakes } from "../../database/migrations/0065_create_inventory_stocktakes.js";
import { InventoryStocktakeService } from "../../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryAuditService } from "../../src/modules/inventory/InventoryAuditService.js";
import { issueInventoryHighRiskContext } from "../../src/modules/inventory/inventoryHighRiskContext.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_POST_BATCH_TESTS === "1";
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 120000, concurrency: false }, work);
const NOW = 1791763200000, time = { nowMs: () => NOW, fileDate: () => "2026-10-12" }, logger = { error() {} };
const counterPermissions = ["inventory.view", "inventory.operation"], postPermissions = ["inventory.view", "inventory.adjust"];
const binding = { id: 5, user_id: 8, device_id: "a".repeat(64), public_key: Buffer.from("synthetic-public-key"), status: "approved" };
const businessTables = ["inventory_warehouses", "inventory_bins", "inventory_stocktakes", "inventory_stocktake_bins", "inventory_bin_locks",
  "inventory_stocktake_lines", "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements",
  "inventory_reservations", "inventory_allocations", "inventory_transfers", "inventory_transfer_lines", "inventory_operation_requests", "inventory_audit_logs"];
let pool, database, service, sentinel, nextSku = 100;
const number = value => value === null ? null : Number(value);
const json = value => typeof value === "string" ? JSON.parse(value) : value;
const dimension = row => [number(row.warehouse_id ?? 1), number(row.bin_id), number(row.sku_id), number(row.lot_id) ?? 0, row.stock_status].join(":");

// Real caller-owned transactions. All fault hooks await their actual SQL callbacks;
// reconciliation happens only after commit/rollback and a same-connection terminal query.
function transactionDatabase(hooks = {}) {
  const observation = { transactions: [], calls: [], injections: [] };
  const db = { observation, query: (...args) => pool.query(...args), async withTransaction(work) {
    const connection = await pool.getConnection(), record = { connectionId: null, outcome: null, callbackSettled: false, terminal: false, released: false };
    observation.transactions.push(record);
    let begun = false, sessionBefore, globalBefore;
    try {
      const [[identity]] = await connection.query("SELECT CONNECTION_ID() AS id");
      record.connectionId = Number(identity.id); assert.ok(record.connectionId > 0); assert.equal(record.connectionId, connection.threadId);
      if (hooks.increment) {
        [[sessionBefore]] = await connection.query("SELECT @@SESSION.auto_increment_increment AS step,@@SESSION.auto_increment_offset AS offset_value");
        [[globalBefore]] = await connection.query("SELECT @@GLOBAL.auto_increment_increment AS step,@@GLOBAL.auto_increment_offset AS offset_value");
        record.sessionBefore = { ...sessionBefore }; record.globalBefore = { ...globalBefore };
        await connection.query("SET SESSION auto_increment_increment=7, SESSION auto_increment_offset=1");
        const [[active]] = await connection.query("SELECT @@SESSION.auto_increment_increment AS step,@@SESSION.auto_increment_offset AS offset_value");
        record.sessionActive = { ...active }; assert.equal(Number(active.step), 7); assert.equal(Number(active.offset_value), 1);
      }
      await connection.beginTransaction(); begun = true;
      const tx = { async query(sql, params = []) { return dispatch("query", sql, params); }, async execute(sql, params = []) { return dispatch("execute", sql, params); } };
      async function dispatch(method, sql, params) {
        const context = { sql: String(sql), params, connection, tx, observation };
        await hooks[method === "query" ? "beforeQuery" : "beforeExecute"]?.(context);
        const call = { method, sql: String(sql), params: [...params], settled: false }; observation.calls.push(call);
        let result;
        try { result = await connection[method](sql, params); call.affectedRows = result[0]?.affectedRows; }
        finally { call.settled = true; }
        return await hooks[method === "query" ? "afterQuery" : "afterExecute"]?.({ ...context, result, call }) ?? result;
      }
      const result = await work(tx); await connection.commit(); record.callbackSettled = true; record.outcome = "COMMITTED"; return result;
    } catch (error) {
      if (begun) {
        try { await connection.rollback(); record.callbackSettled = true; record.outcome = "ROLLED_BACK"; }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "Rollback callback failed; database state is unproven"); }
      }
      throw error;
    } finally {
      try {
        if (record.callbackSettled) {
          const [[terminal]] = await connection.query("SELECT COUNT(*) AS remaining FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?", [record.connectionId]);
          assert.equal(Number(terminal.remaining), 0, "Actual transaction must end before any reconciliation");
          assert.ok(observation.calls.every(call => call.settled)); record.terminal = true;
        }
        if (sessionBefore) {
          await connection.query("SET SESSION auto_increment_increment=?, SESSION auto_increment_offset=?", [Number(sessionBefore.step), Number(sessionBefore.offset_value)]);
          const [[restored]] = await connection.query("SELECT @@SESSION.auto_increment_increment AS step,@@SESSION.auto_increment_offset AS offset_value");
          const [[globalAfter]] = await connection.query("SELECT @@GLOBAL.auto_increment_increment AS step,@@GLOBAL.auto_increment_offset AS offset_value");
          record.sessionAfter = { ...restored }; record.globalAfter = { ...globalAfter };
          assert.deepEqual(restored, sessionBefore); assert.deepEqual(globalAfter, globalBefore); record.sessionRestored = true;
        }
      } finally {
        if (record.terminal && (!sessionBefore || record.sessionRestored)) connection.release();
        else { connection.destroy(); record.destroyed = true; }
        record.released = true;
      }
    }
  } };
  return db;
}
function settled(db, outcome) {
  assert.equal(db.observation.transactions.length, 1, "No nested transaction, retry or partial commit");
  const record = db.observation.transactions[0];
  assert.equal(record.outcome, outcome); assert.equal(record.callbackSettled, true); assert.equal(record.terminal, true); assert.equal(record.released, true);
  assert.ok(db.observation.calls.every(call => call.settled));
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task041_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET ?? "", /^\/private\/tmp\/erp-inventory-task041-[a-z0-9-]+-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  pool = mysql.createPool({ user: "root", database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET, connectionLimit: 4, dateStrings: true });
  const [[environment]] = await pool.query("SELECT VERSION() AS version,DATABASE() AS schema_name,@@skip_networking AS isolated");
  assert.equal(environment.version, "26.7.0"); assert.equal(environment.schema_name, process.env.DB_NAME); assert.equal(Number(environment.isolated), 1);
  assert.equal((await pool.query("SHOW TABLES"))[0].length, 0, "Require a fresh owned schema; never erase an existing schema");
  // Minimal Item/authorization tables are the established TASK038 fixture schema.
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
      purchasable BOOLEAN DEFAULT 1,sellable BOOLEAN DEFAULT 1,inventory_tracked BOOLEAN DEFAULT 1,tracking_policy VARCHAR(20),shelf_life_days INT,
      min_receipt_life_days INT,min_sale_life_days INT,effective_from DATE,effective_to DATE,version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB`,
    "CREATE TABLE item_uoms (id BIGINT UNSIGNED PRIMARY KEY,code VARCHAR(20),name VARCHAR(100),status VARCHAR(20),version INT UNSIGNED DEFAULT 1) ENGINE=InnoDB",
    `CREATE TABLE item_sku_uoms (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,sku_id BIGINT UNSIGNED,uom_id BIGINT UNSIGNED,to_base_factor DECIMAL(18,6),
      is_base BOOLEAN,is_default_purchase BOOLEAN,is_default_sale BOOLEAN,version INT UNSIGNED DEFAULT 1) ENGINE=InnoDB`
  ]) await pool.query(ddl);
  // 0061/0062 belong to Supplier imports and are not part of the unchanged Inventory bootstrap.
  for (const migrate of [permissions, operations, auditMigration, master, stock, movements, reservations, transfers, stocktakes]) await migrate(pool);
  await pool.query("INSERT INTO users VALUES (7,'synthetic-counter','active'),(8,'synthetic-approver','active')");
  await pool.query("INSERT INTO roles VALUES (1,'warehouse-operator'),(2,'warehouse-approver')"); await pool.query("INSERT INTO user_roles VALUES (7,1),(8,2)");
  await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name IN ('inventory.view','inventory.operation')");
  await pool.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");
  await pool.query("INSERT INTO fr_token_versions VALUES ('7',0),('8',0)");
  await pool.execute("INSERT INTO user_devices VALUES (?,?,?,?,?)", [binding.id, binding.user_id, binding.device_id, binding.public_key, binding.status]);
  await pool.query("INSERT INTO items (id,name,product_type,status) VALUES (1,'Synthetic','physical','active')"); await pool.query("INSERT INTO item_uoms (id,code,name,status) VALUES (1,'EA','Each','active')");
  await pool.query("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (1,'SYN-1','syn-1','Synthetic',1,1)");
  database = transactionDatabase(); service = new InventoryStocktakeService({ database, logger, time });
  sentinel = await readyFixture([{}]); // A real foreign READY document/lock/history survives every tested Post.
});
after(async () => { if (pool) await pool.end(); });
function command(action, payload, eventId = randomUUID()) {
  const high = action === "post";
  return inventoryCommandFixture({ actor: { userId: high ? 8 : 7, claimedRoles: [high ? "warehouse-approver" : "warehouse-operator"], claimedPermissions: high ? postPermissions : counterPermissions },
    authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: high ? "inventory.adjust" : "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "synthetic-task041-post-batch", eventId }, correlationId: eventId, payload });
}
function capsule(input, clock = time, claims = {}) {
  return issueInventoryHighRiskContext({ method: "POST", apiRoute: { path: "/api/v1/inventory/stocktakes/:id/post", authType: "jwt-device-password" },
    input: { params: { id: String(input.payload.stocktakeId) } }, get: () => String(NOW),
    auth: { type: "jwt-device-password", deviceBinding: binding, claims: { sub: "8", roles: input.actor.claimedRoles, permissions: input.actor.claimedPermissions,
      did: binding.device_id, ver: 0, exp: NOW / 1000 + 900, auth_time: NOW / 1000, ...claims } } }, input,
  { time: clock, signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0 });
}
async function bin() {
  const code = randomUUID(); return Number((await pool.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (1,?,?,1,1)", [code, code]))[0].insertId);
}
async function seedSku(policy = "none", name = "Synthetic") {
  const id = nextSku++;
  await pool.execute("INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy,min_receipt_life_days,min_sale_life_days) VALUES (?,1,?,?,'active',?,90,30)", [id, `SKU-${id}`, name, policy]);
  await pool.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (?,1,1,1,1,1)", [id]);
  await pool.execute("INSERT INTO inventory_stock_controls (warehouse_id,sku_id,created_at,updated_at) VALUES (1,?,1,1)", [id]); return id;
}
async function seedBalance(entry) {
  return Number((await pool.execute(`INSERT INTO inventory_stock_balances
    (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (1,?,?,?,?,?,?,1,1)`,
  [entry.bin_id, entry.sku_id, entry.lot_id, entry.stock_status, entry.quantity, entry.quantity ? "2026-01-01" : null]))[0].insertId);
}
async function rows(table, stocktakeId) { return (await pool.execute(`SELECT * FROM ${table} WHERE stocktake_id=? ORDER BY id`, [stocktakeId]))[0]; }
async function snapshot() {
  const state = {}; for (const table of businessTables) state[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0]; return state;
}
function entries(size, extra = {}) { return Array.from({ length: size }, (_, i) => ({ group: i, ...extra })); }
async function readyFixture(input = entries(101), { zero = false, name } = {}) {
  const groups = new Map(), bins = new Map(), lots = new Map(), seeded = [];
  for (const [i, entry] of input.entries()) {
    const group = entry.group ?? i, binGroup = entry.binGroup ?? 0;
    if (!groups.has(group)) groups.set(group, await seedSku(entry.policy ?? (entry.lotKey ? "batch_expiry" : "none"), name));
    if (!bins.has(binGroup)) bins.set(binGroup, await bin());
    const sku_id = groups.get(group), bin_id = bins.get(binGroup); let lot_id = null;
    if (entry.lotKey) {
      const key = `${sku_id}:${entry.lotKey}`;
      if (!lots.has(key)) lots.set(key, Number((await pool.execute(`INSERT INTO inventory_lots
        (sku_id,lot_number,normalized_lot_number,first_receipt_date,manufacture_date,expiry_date,sku_code_snapshot,created_at)
        VALUES (?,?,?,'2020-01-01','2019-01-01',?,?,1)`, [sku_id, entry.lotKey, entry.lotKey, entry.expiry ?? "2027-01-01", `SKU-${sku_id}`]))[0].insertId));
      lot_id = lots.get(key);
    }
    const row = { ...entry, bin_id, sku_id, lot_id, stock_status: entry.status ?? "AVAILABLE", quantity: entry.quantity ?? 4 };
    if (!entry.absent) row.balanceId = await seedBalance(row);
    seeded.push(row);
  }
  const draft = await service.create(command("create", { warehouseId: 1, binIds: [...bins.values()] }));
  let header = await service.start(command("start", { stocktakeId: draft.id, expectedVersion: draft.version }));
  for (const row of seeded.filter(row => row.absent)) await service.addLine(command("add_line", { stocktakeId: header.id, binId: row.bin_id,
    skuId: row.sku_id, lotId: row.lot_id, stockStatus: row.stock_status }));
  let lines = await rows("inventory_stocktake_lines", header.id);
  const byDimension = new Map(seeded.map(row => [dimension(row), row]));
  for (let offset = 0; offset < lines.length; offset += 100) await service.saveCounts(command("count", { stocktakeId: header.id,
    lines: lines.slice(offset, offset + 100).map(row => { const entry = byDimension.get(dimension(row)); assert.ok(entry);
      return { lineId: Number(row.id), expectedVersion: Number(row.version), countedQuantity: zero ? Number(row.snapshot_quantity) : entry.actual ?? 7 }; }) }));
  header = await service.ready(command("ready", { stocktakeId: header.id, expectedVersion: header.version }));
  lines = await rows("inventory_stocktake_lines", header.id); return { header, lines, seeded, groups, bins: [...bins.values()], skuName: name ?? "Synthetic" };
}
function postCommand(f, reason = "synthetic physical reconciliation") {
  return command("post", { stocktakeId: f.header.id, expectedVersion: f.header.version, reason });
}
async function post(f, { db = transactionDatabase(), clock = time, input = postCommand(f), proof = capsule(input, clock) } = {}) {
  const result = await new InventoryStocktakeService({ database: db, logger, time: clock }).post(input, proof); return { result, db, input };
}
async function unchanged(f, db, expected, options = {}) {
  const before = await snapshot(); await assert.rejects(post(f, { ...options, db }), expected);
  settled(db, "ROLLED_BACK"); assert.deepEqual(await snapshot(), before, "Native rollback must restore all 16 business tables and foreign owners");
  const [[header]] = await pool.execute("SELECT status,version FROM inventory_stocktakes WHERE id=?", [f.header.id]);
  assert.equal(header.status, "READY_TO_POST"); assert.equal(Number(header.version), f.header.version);
  assert.ok((await rows("inventory_bin_locks", f.header.id)).every(row => row.released_at === null));
}
function calls(db, pattern) { return db.observation.calls.filter(call => pattern.test(call.sql)); }
function sizes(db, table) { return calls(db, new RegExp(`INSERT INTO ${table}\\b`, "iu")).map(call => Number(call.affectedRows)); }
function budgets(db) {
  for (const call of db.observation.calls) {
    assert.ok(call.params.length <= 3200); assert.ok(call.params.filter(value => typeof value === "string").reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0) <= 1048576);
    if (/INSERT INTO inventory_(?:stock_balances|movements|audit_logs)\b/iu.test(call.sql)) assert.ok(Number(call.affectedRows) <= 100);
  }
}
async function succeeds(f, options = {}) {
  const before = await snapshot(), posted = await post(f, options), { result, db, input } = posted;
  settled(db, "COMMITTED"); budgets(db); const after = await snapshot();
  const changed = f.lines.filter(row => Number(row.variance_quantity) !== 0), movementRows = after.inventory_movements.filter(row => Number(row.operation_request_id) === result.operationId);
  const auditRows = after.inventory_audit_logs.filter(row => Number(row.operation_request_id) === result.operationId);
  assert.deepEqual(result, { id: f.header.id, operationId: result.operationId, status: "POSTED", version: f.header.version + 1,
    rowCount: changed.length, movementGroupId: changed.length ? result.movementGroupId : null });
  assert.equal(movementRows.length, changed.length); assert.equal(new Set(movementRows.map(row => Number(row.id))).size, changed.length);
  assert.equal(auditRows.length, changed.length + 1);
  for (const original of f.lines) {
    const row = after.inventory_stocktake_lines.find(row => Number(row.id) === Number(original.id));
    assert.equal(row.stock_balance_id, original.stock_balance_id, "Original snapshot FK remains unchanged, including NULL");
    if (Number(original.variance_quantity) === 0) { assert.deepEqual(row, original); continue; }
    const movement = movementRows.find(movement => Number(movement.id) === Number(row.movement_id)); assert.ok(movement);
    assert.deepEqual([Number(movement.stocktake_id), Number(movement.stocktake_line_id), Number(movement.operation_request_id), movement.movement_group_id,
      Number(movement.warehouse_id), Number(movement.bin_id), Number(movement.sku_id), number(movement.lot_id), movement.stock_status],
    [f.header.id, Number(original.id), result.operationId, result.movementGroupId, 1, Number(original.bin_id), Number(original.sku_id), number(original.lot_id), original.stock_status]);
    const version = Number(original.snapshot_balance_version) || 1;
    assert.deepEqual([movement.movement_type, movement.location_kind, movement.direction, Number(movement.quantity), Number(movement.balance_before),
      Number(movement.balance_after), Number(movement.balance_version_after), movement.reason_text, Number(movement.posted_at), Number(movement.posted_by), movement.posted_by_label],
    ["STOCKTAKE_VARIANCE", "BIN", Number(original.variance_quantity) > 0 ? "IN" : "OUT", Math.abs(Number(original.variance_quantity)), Number(original.snapshot_quantity),
      Number(original.counted_quantity), version + 1, input.payload.reason, NOW, 8, "synthetic-approver"]);
    assert.deepEqual(row, { ...original, movement_id: movement.id, version: Number(original.version) + 1 }, "Only the movement link and line version may change");
    const balance = after.inventory_stock_balances.find(balance => dimension(balance) === dimension(original)); assert.ok(balance);
    assert.equal(Number(balance.on_hand_quantity), Number(original.counted_quantity)); assert.equal(Number(balance.version), version + 1);
    const oldBalance = before.inventory_stock_balances.find(balance => Number(balance.id) === number(original.stock_balance_id));
    assert.equal(Number(balance.allocated_quantity), Number(oldBalance?.allocated_quantity ?? 0));
    const anchor = Number(original.counted_quantity) === 0 ? null : original.lot_id !== null ? oldBalance?.fifo_anchor_date ?? null : Number(original.snapshot_quantity) === 0 ? "2026-10-12" : oldBalance.fifo_anchor_date;
    assert.equal(balance.fifo_anchor_date, anchor);
    if (oldBalance) assert.deepEqual(balance, { ...oldBalance, on_hand_quantity: Number(original.counted_quantity), fifo_anchor_date: anchor, version: version + 1, updated_at: NOW });
    else assert.deepEqual([Number(balance.warehouse_id), Number(balance.bin_id), Number(balance.sku_id), number(balance.lot_id), Number(balance.lot_scope), balance.stock_status,
      Number(balance.created_at), Number(balance.updated_at)], [1, Number(original.bin_id), Number(original.sku_id), number(original.lot_id), number(original.lot_id) ?? 0, original.stock_status, NOW, NOW]);
    const lot = before.inventory_lots.find(row => Number(row.id) === number(original.lot_id));
    const bin = before.inventory_bins.find(row => Number(row.id) === Number(original.bin_id));
    assert.deepEqual([movement.sku_code_snapshot, movement.sku_name_snapshot, movement.warehouse_code_snapshot, movement.bin_code_snapshot, movement.lot_number_snapshot, movement.expiry_date_snapshot],
      [`SKU-${original.sku_id}`, f.skuName, "SYN-1", bin.bin_code, lot?.lot_number ?? "", lot?.expiry_date ?? null]);
    const audit = auditRows.find(audit => Number(json(audit.after_summary)?.id) === Number(original.id)); assert.ok(audit);
    assert.deepEqual(json(audit.before_summary), { id: Number(original.id), stocktakeId: f.header.id, quantity: Number(original.snapshot_quantity), version, status: original.stock_status, movementId: null });
    assert.deepEqual(json(audit.after_summary), { id: Number(original.id), stocktakeId: f.header.id, quantity: Number(original.counted_quantity), version: version + 1, status: original.stock_status, movementId: Number(movement.id) });
    assert.deepEqual([audit.action, audit.target_type, Number(audit.target_id), audit.outcome, Number(audit.actor_user_id), audit.actor_label, audit.request_id, audit.correlation_id],
      ["stocktake.post", "stocktake", f.header.id, "SUCCEEDED", 8, "synthetic-approver", input.correlationId, input.correlationId]);
    assert.deepEqual([audit.target_label, Number(audit.occurred_at), audit.reason_category, audit.reason_text, audit.ip],
      [before.inventory_stocktakes.find(row => Number(row.id) === f.header.id).stocktake_number, NOW, "", "", ""]);
  }
  const headerAudit = auditRows.find(row => json(row.after_summary)?.status === "POSTED"); assert.ok(headerAudit);
  assert.deepEqual(json(headerAudit.before_summary), { stocktakeId: f.header.id, status: "READY_TO_POST", version: f.header.version });
  assert.deepEqual(json(headerAudit.after_summary), { stocktakeId: f.header.id, status: "POSTED", version: f.header.version + 1, rowCount: changed.length });
  const operation = after.inventory_operation_requests.find(row => Number(row.id) === result.operationId);
  assert.equal(Number(operation.actor_user_id), 8); assert.equal(Number(operation.completed_at), NOW); assert.deepEqual(json(operation.result_summary), result);
  assert.deepEqual([operation.command_type, operation.result_type, operation.result_id, operation.actor_label, operation.request_id, operation.correlation_id],
    ["STOCKTAKE_POST", "STOCKTAKE", String(f.header.id), "synthetic-approver", input.correlationId, input.correlationId]);
  const header = after.inventory_stocktakes.find(row => Number(row.id) === f.header.id);
  assert.deepEqual([header.status, Number(header.version), Number(header.post_operation_id)], ["POSTED", f.header.version + 1, result.operationId]);
  assert.deepEqual(header, { ...before.inventory_stocktakes.find(row => Number(row.id) === f.header.id), status: "POSTED", reason: input.payload.reason,
    post_operation_id: result.operationId, posted_at: NOW, posted_by: 8, updated_at: NOW, updated_by: 8, version: f.header.version + 1 });
  for (const row of before.inventory_bin_locks) {
    const actual = after.inventory_bin_locks.find(value => Number(value.id) === Number(row.id));
    if (Number(row.stocktake_id) === f.header.id) assert.deepEqual(actual, { ...row, released_at: NOW, released_by: 8, release_reason: "POSTED", active_scope: null });
    else assert.deepEqual(actual, row, "Foreign active and historical locks are untouched");
  }
  const balanceIds = new Set(changed.map(row => number(row.stock_balance_id)));
  for (const row of before.inventory_stock_balances.filter(row => !balanceIds.has(Number(row.id)))) assert.deepEqual(after.inventory_stock_balances.find(actual => Number(actual.id) === Number(row.id)), row);
  for (const table of ["inventory_stocktakes", "inventory_stocktake_lines"]) for (const row of before[table].filter(row => Number(table === "inventory_stocktakes" ? row.id : row.stocktake_id) !== f.header.id)) assert.deepEqual(after[table].find(actual => Number(actual.id) === Number(row.id)), row);
  for (const table of ["inventory_movements", "inventory_audit_logs", "inventory_operation_requests"]) for (const row of before[table]) assert.deepEqual(after[table].find(actual => Number(actual.id) === Number(row.id)), row);
  const added = {
    inventory_stock_balances: changed.filter(row => row.stock_balance_id === null).map(row => Number(after.inventory_stock_balances.find(balance => dimension(balance) === dimension(row)).id)),
    inventory_movements: movementRows.map(row => Number(row.id)), inventory_audit_logs: auditRows.map(row => Number(row.id)),
    inventory_operation_requests: [result.operationId]
  };
  for (const table of businessTables) {
    const expectedIds = [...before[table].map(row => Number(row.id)), ...(added[table] ?? [])].sort((a, b) => a - b);
    assert.deepEqual(after[table].map(row => Number(row.id)).sort((a, b) => a - b), expectedIds,
      `${table}: reject every unexpected added or missing row, including foreign owners`);
  }
  for (const table of ["inventory_warehouses", "inventory_bins", "inventory_stocktake_bins", "inventory_stock_controls", "inventory_lots", "inventory_reservations", "inventory_allocations", "inventory_transfers", "inventory_transfer_lines"]) assert.deepEqual(after[table], before[table]);
  assert.ok((await rows("inventory_bin_locks", sentinel.header.id)).every(row => row.released_at === null));
  return { ...posted, before, after, movementRows, auditRows };
}
async function reserved(sku, quantity) { await pool.execute("UPDATE inventory_stock_controls SET reserved_quantity=? WHERE warehouse_id=1 AND sku_id=?", [quantity, sku]); }
async function nativeFault(connection, observation, label) {
  observation.injections.push({ label, kind: "AWAITED_NATIVE_SQL_FAULT" });
  await connection.query("SELECT * FROM inventory_task041_intended_missing_fault_table");
}
async function injectedFailure(f, pattern, nth, { before = false, mutate, expected = error => error.code === "ER_NO_SUCH_TABLE" } = {}) {
  let hits = 0, reached = false;
  const hook = async context => { if (pattern.test(context.sql) && ++hits === nth) { reached = true;
    if (mutate) { context.observation.injections.push({ label: "injected native CAS conflict", kind: "AWAITED_SQL_MUTATION" }); await mutate(context.connection); }
    else await nativeFault(context.connection, context.observation, `after/before actual SQL ${pattern} hit ${nth}`);
  } };
  const db = transactionDatabase({ [before ? "beforeExecute" : "afterExecute"]: hook });
  await unchanged(f, db, expected); assert.ok(reached, "Intended native injection checkpoint must execute"); return db;
}

integrationTest("ST041-DB01 100 changed rows retain single-row effects and complete exact own unlock", async () => {
  const { db } = await succeeds(await readyFixture(entries(100)));
  assert.deepEqual(sizes(db, "inventory_movements"), Array(100).fill(1)); assert.deepEqual(sizes(db, "inventory_audit_logs"), Array(101).fill(1));
  assert.equal(calls(db, /UPDATE inventory_stock_balances/iu).length, 100); assert.equal(calls(db, /FROM inventory_movements/iu).length, 0);
  assert.equal(calls(db, /LEFT JOIN inventory_lots/iu).length, 100); assert.ok(calls(db, /UPDATE inventory_stock_balances/iu).every(call => !/CASE/iu.test(call.sql)));
});
integrationTest("ST041-DB02 101 changed rows and SKUs cross both batch thresholds with complete owner mappings", async () => {
  const { db } = await succeeds(await readyFixture());
  assert.deepEqual(sizes(db, "inventory_movements"), [100, 1]); assert.deepEqual(sizes(db, "inventory_audit_logs"), [100, 1, 1]);
  assert.deepEqual(calls(db, /LEFT JOIN inventory_lots/iu).map(call => call.params.length - 1), [100, 1]);
  assert.equal(calls(db, /UPDATE inventory_stock_balances/iu).length, 2); assert.equal(calls(db, /UPDATE inventory_stocktake_lines/iu).length, 2);
  assert.equal(calls(db, /FROM inventory_movements/iu).length, 2);
  for (const call of calls(db, /FROM inventory_movements/iu)) assert.match(call.sql, /operation_request_id\s*=\s*\?[\s\S]*id\s*>\s*\?[\s\S]*ORDER BY id LIMIT 101/iu);
});
integrationTest("ST041-DB03 201 changed rows complete all three bounded chunks in one real transaction", async () => {
  const { db } = await succeeds(await readyFixture(entries(201)));
  assert.deepEqual(sizes(db, "inventory_movements"), [100, 100, 1]); assert.deepEqual(sizes(db, "inventory_audit_logs"), [100, 100, 1, 1]);
  assert.equal(calls(db, /UPDATE inventory_stock_balances/iu).length, 3); assert.equal(calls(db, /UPDATE inventory_stocktake_lines/iu).length, 3);
  for (const call of calls(db, /UPDATE inventory_(?:stock_balances|stocktake_lines)/iu)) { assert.match(call.sql, /CASE/iu); assert.ok(Number(call.affectedRows) <= 100); }
});
integrationTest("ST041-DB04 off-book NULL-Lot three-status balances retain snapshot FKs and FIFO anchors", async () => {
  const input = entries(101).map((row, i) => ({ ...row, absent: i % 2 === 0, status: ["AVAILABLE", "DAMAGED", "QUARANTINED"][i % 3], quantity: i === 1 ? 0 : 4, actual: i === 3 ? 0 : 7 }));
  const f = await readyFixture(input), { after, db } = await succeeds(f);
  assert.deepEqual(sizes(db, "inventory_stock_balances"), [50, 1]);
  assert.ok(f.lines.filter(row => row.stock_balance_id === null).every(row => after.inventory_stocktake_lines.find(actual => Number(actual.id) === Number(row.id)).stock_balance_id === null));
  assert.equal(new Set(f.lines.map(row => row.stock_status)).size, 3);
});
integrationTest("ST041-DB05 legal expired and short-life gains preserve Lot dates but never grant AVAILABLE eligibility", async () => {
  const gains = Array.from({ length: 102 }, (_, i) => ({ group: 0, binGroup: i, lotKey: i % 2 ? "short" : "expired", expiry: i % 2 ? "2026-10-13" : "2020-02-01", status: ["AVAILABLE", "DAMAGED", "QUARANTINED"][i % 3] }));
  const fillers = entries(100).map((row, i) => ({ ...row, group: i + 1 }));
  const gainResult = await succeeds(await readyFixture([...gains, ...fillers]));
  assert.ok(calls(gainResult.db, /b\.sku_id IN/iu).length > 0, "Exercise batched AVAILABLE, not the old single-SKU policy path");
  for (const expiry of ["2020-02-01", "2026-10-13"]) {
    const input = Array.from({ length: 101 }, (_, i) => ({ group: 0, binGroup: i, lotKey: i ? "excluded" : "eligible", expiry: i ? expiry : "2027-01-01", actual: i ? 7 : 1 }));
    const f = await readyFixture([...input, ...fillers]), db = transactionDatabase();
    await reserved(f.groups.get(0), 4); await unchanged(f, db, { code: "INSUFFICIENT_ATP" });
    assert.ok(calls(db, /b\.sku_id IN/iu).length > 0, "Expiry rejection must exercise the new query projection");
  }
});
integrationTest("ST041-DB06 outside-Bin AVAILABLE and same-SKU final gains cover Reserved while cross-SKU gains cannot", async () => {
  for (const sameSku of [true, false]) {
    const input = entries(102).map((row, i) => ({ ...row, group: i === 1 && sameSku ? 0 : i, binGroup: i === 1 ? 1 : 0, actual: i === 0 ? 1 : 7 }));
    const f = await readyFixture(input), sku = f.groups.get(0);
    await seedBalance({ bin_id: await bin(), sku_id: sku, lot_id: null, stock_status: "AVAILABLE", quantity: 3 });
    await reserved(sku, sameSku ? 11 : 7);
    const db = transactionDatabase();
    if (sameSku) await succeeds(f, { db }); else await unchanged(f, db, { code: "INSUFFICIENT_ATP" });
    assert.ok(calls(db, /b\.sku_id IN/iu).length > 0);
  }
  const outside = await readyFixture(entries(101).map((row, i) => ({ ...row, actual: i === 0 ? 1 : 7 })));
  await seedBalance({ bin_id: await bin(), sku_id: outside.groups.get(0), lot_id: null, stock_status: "AVAILABLE", quantity: 3 });
  await reserved(outside.groups.get(0), 4);
  const { db } = await succeeds(outside);
  assert.ok(calls(db, /b\.sku_id IN/iu).length > 0, "Outside-bin coverage is necessary for this successful batched Post");
});
integrationTest("ST041-DB07 a real Allocation bucket floor rejects despite another bucket gain and fully rolls back", async () => {
  const input = entries(101).map((row, i) => ({ ...row, group: i === 1 ? 0 : i, binGroup: i === 1 ? 1 : 0, actual: i === 0 ? 1 : i === 1 ? 20 : 7 }));
  const f = await readyFixture(input), first = f.lines.find(row => Number(row.sku_id) === f.groups.get(0)), op = new InventoryOperationService();
  await database.withTransaction(async tx => {
    const input = command("create", {}), claim = await op.claim(tx, { commandType: "RESERVATION_CREATE", payload: { quantity: 2 }, source: { ...input.source, documentType: "RESERVATION" }, actorUserId: 7, actorLabel: "synthetic-counter", createdAt: NOW });
    const [reservation] = await tx.execute("INSERT INTO inventory_reservations (create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES (?,1,?,2,2,'SALE','ACTIVE',?,?)", [claim.operationId, first.sku_id, NOW, NOW]);
    await tx.execute("INSERT INTO inventory_allocations (create_operation_id,reservation_id,stock_balance_id,allocated_quantity,outstanding_quantity,selection_strategy,status,created_at,updated_at) VALUES (?,?,?,2,2,'FIFO','ACTIVE',?,?)", [claim.operationId, reservation.insertId, first.stock_balance_id, NOW, NOW]);
    await tx.execute("UPDATE inventory_stock_balances SET allocated_quantity=2 WHERE id=?", [first.stock_balance_id]);
    await tx.execute("UPDATE inventory_stock_controls SET reserved_quantity=2 WHERE warehouse_id=1 AND sku_id=?", [first.sku_id]);
    await op.complete(tx, { operationId: claim.operationId, resultType: "RESERVATION", resultId: String(reservation.insertId), resultSummary: { id: Number(reservation.insertId), quantity: 2, status: "ACTIVE" }, completedAt: NOW });
  });
  await unchanged(f, transactionDatabase(), { code: "INSUFFICIENT_STOCK" });
});
integrationTest("ST041-DB08 only the own test SESSION uses sparse AUTO_INCREMENT IDs and is exactly restored", async () => {
  const f = await readyFixture(entries(101, { absent: true })), db = transactionDatabase({ increment: true });
  const { movementRows, after } = await succeeds(f, { db });
  const movementIds = movementRows.map(row => Number(row.id)).sort((a, b) => a - b);
  const balances = after.inventory_stock_balances.filter(row => f.bins.includes(Number(row.bin_id))).map(row => Number(row.id)).sort((a, b) => a - b);
  assert.equal(movementIds.length, 101); assert.equal(balances.length, 101);
  assert.ok(movementIds.slice(1).every((id, i) => id - movementIds[i] >= 7)); assert.ok(balances.slice(1).every((id, i) => id - balances[i] >= 7));
  const record = db.observation.transactions[0]; assert.deepEqual(record.sessionAfter, record.sessionBefore); assert.deepEqual(record.globalAfter, record.globalBefore);
  assert.equal(Number(record.sessionActive.step), 7); assert.equal(Number(record.sessionActive.offset_value), 1);
});
integrationTest("ST041-DB09 second Balance CASE loses a real expected-version CAS and rolls back earlier chunks", async () => {
  const f = await readyFixture(entries(201));
  const db = await injectedFailure(f, /UPDATE inventory_stock_balances/iu, 2, { before: true, expected: { code: "CONCURRENT_OPERATION" },
    mutate: connection => connection.execute("UPDATE inventory_stock_balances SET version=version+1 WHERE id=?", [f.lines[100].stock_balance_id]) });
  assert.deepEqual(sizes(db, "inventory_movements"), [100]); assert.deepEqual(sizes(db, "inventory_audit_logs"), [100]);
  assert.equal(Number(calls(db, /UPDATE inventory_stock_balances/iu).at(-1).affectedRows), 99, "The real second CASE must lose exactly the injected expected-version target");
});
integrationTest("ST041-DB10 second real Movement insert/read failures or missing/foreign readback roll back complete owners", async () => {
  const f = await readyFixture(entries(201));
  const fault = await injectedFailure(f, /INSERT INTO inventory_movements/iu, 2); assert.deepEqual(sizes(fault, "inventory_movements"), [100, 100]);
  for (const mode of ["missing", "foreign"]) {
    let hits = 0, reached = false;
    const db = transactionDatabase({ afterQuery: ({ sql, result, observation }) => {
      if (/FROM inventory_movements/iu.test(sql) && ++hits === 2) { reached = true; observation.injections.push({ label: `injected ${mode} after awaited native read`, kind: "ALTERED_DRIVER_RESULT" });
        return [mode === "missing" ? result[0].slice(1) : result[0].map((row, i) => i ? row : { ...row, operation_request_id: sentinel.header.operationId }), result[1]];
      }
    } });
    await unchanged(f, db, { code: "CONCURRENT_OPERATION" }); assert.ok(reached);
  }
});
integrationTest("ST041-DB11 second line CASE loses its real version predicate and rolls back Movement Balance and Audit", async () => {
  const f = await readyFixture(entries(201));
  const db = await injectedFailure(f, /UPDATE inventory_stocktake_lines/iu, 2, { before: true, expected: { code: "CONCURRENT_OPERATION" },
    mutate: connection => connection.execute("UPDATE inventory_stocktake_lines SET version=version+1 WHERE id=?", [f.lines[100].id]) });
  assert.deepEqual(sizes(db, "inventory_movements"), [100, 100]); assert.deepEqual(sizes(db, "inventory_audit_logs"), [100]);
  assert.equal(Number(calls(db, /UPDATE inventory_stocktake_lines/iu).at(-1).affectedRows), 99);
});
integrationTest("ST041-DB12 second Audit native SQL fault rolls back the earlier complete Audit chunk", async () => {
  const f = await readyFixture(entries(201, { absent: true })); let hits = 0, reached = false;
  const db = transactionDatabase({ beforeExecute: async ({ sql, connection, observation }) => {
    if (/INSERT INTO inventory_audit_logs/iu.test(sql) && ++hits === 2) { reached = true; observation.injections.push({ label: "injected second Audit native SQL error", kind: "AWAITED_NATIVE_SQL_FAULT" });
      await connection.query("INSERT INTO inventory_audit_logs (task041_intended_invalid_column) VALUES (1)");
    }
  } });
  await unchanged(f, db, error => error.code === "ER_BAD_FIELD_ERROR"); assert.ok(reached);
  assert.deepEqual(sizes(db, "inventory_audit_logs"), [100]); assert.deepEqual(sizes(db, "inventory_movements"), [100, 100]);
});
integrationTest("ST041-DB13 fault after the real final header update restores READY and every original lock", async () => {
  const f = await readyFixture(); const db = await injectedFailure(f, /UPDATE inventory_stocktakes SET status\s*=\s*'POSTED'/iu, 1);
  assert.deepEqual(sizes(db, "inventory_movements"), [100, 1]); assert.deepEqual(sizes(db, "inventory_audit_logs"), [100, 1]);
});
integrationTest("ST041-DB14 fault midway through actual own unlock rolls back header and releases without touching foreign locks", async () => {
  const f = await readyFixture(entries(101).map((row, i) => ({ ...row, binGroup: i % 2 })));
  const db = await injectedFailure(f, /UPDATE inventory_bin_locks/iu, 1);
  assert.equal(calls(db, /UPDATE inventory_bin_locks/iu).length, 1); assert.equal(calls(db, /UPDATE inventory_stocktakes SET status\s*=\s*'POSTED'/iu).length, 1);
});
async function restoreAuth() {
  await pool.query("DELETE FROM role_permissions WHERE role_id=2");
  await pool.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");
  await pool.query("UPDATE fr_token_versions SET version=0 WHERE subject='8'"); await pool.query("UPDATE user_devices SET status='approved' WHERE id=5");
}
integrationTest("ST041-DB15 actual role JWT-version and device revocations reject fresh Post and cached scalar replay", async () => {
  for (const [sql, code] of [["DELETE FROM role_permissions WHERE role_id=2", "PERMISSION_STALE"], ["UPDATE fr_token_versions SET version=1 WHERE subject='8'", "JWT_INVALID"], ["UPDATE user_devices SET status='revoked' WHERE id=5", "DEVICE_REVOKED"]]) {
    const f = await readyFixture(), input = postCommand(f), trusted = capsule(input);
    await pool.query(sql);
    try { await unchanged(f, transactionDatabase(), { code }, { input, proof: trusted }); } finally { await restoreAuth(); }
    const { result } = await succeeds(f, { input });
    const replayProof = capsule(input); await pool.query(sql); const before = await snapshot(), db = transactionDatabase();
    try { await assert.rejects(post(f, { db, input, proof: replayProof }), { code }); settled(db, "ROLLED_BACK"); assert.deepEqual(await snapshot(), before); }
    finally { await restoreAuth(); }
    assert.equal(result.rowCount, 101);
  }
});
integrationTest("ST041-DB16 injected original clock and local-date crossings roll back after real batch SQL", async () => {
  for (const mode of ["signature", "jwt", "session", "date"]) {
    const f = await readyFixture(entries(201)); let now = NOW, date = "2026-10-12", reached = false;
    const clock = { nowMs: () => now, fileDate: () => date }, input = postCommand(f);
    const claims = mode === "jwt" ? { exp: NOW / 1000 + 1 } : mode === "session" ? { auth_time: NOW / 1000 - 3599 } : {};
    const trusted = capsule(input, clock, claims), db = transactionDatabase({ afterExecute: ({ sql, observation }) => {
      if (!reached && /INSERT INTO inventory_movements/iu.test(sql)) { reached = true; observation.injections.push({ label: `injected ${mode} clock/date`, kind: "CONTROLLED_CLOCK" });
        if (mode === "signature") now += 60001; else if (mode === "date") date = "2026-10-13"; else now += 2000;
      }
    } });
    await unchanged(f, db, { code: { signature: "DEVICE_SIGNATURE_STALE", jwt: "JWT_INVALID", session: "SESSION_EXPIRED", date: "CONCURRENT_OPERATION" }[mode] }, { clock, input, proof: trusted }); assert.ok(reached);
  }
});
integrationTest("ST041-DB17 same-intent replay returns the original scalar receipt without repeated versions Movement or Audit", async () => {
  const f = await readyFixture(), { result, input } = await succeeds(f), before = await snapshot(), db = transactionDatabase();
  assert.deepEqual((await post(f, { input, db })).result, result); settled(db, "COMMITTED"); assert.deepEqual(await snapshot(), before);
  assert.equal(calls(db, /INSERT INTO inventory_movements|UPDATE inventory_stock_balances|INSERT INTO inventory_audit_logs/iu).length, 0);
  assert.deepEqual((await new InventoryOperationService().findBySource(pool, { source: input.source })).resultSummary, result);
});
integrationTest("ST041-DB18 large all-zero strong-auth Post and UTF8 summary boundaries retain exact native Audit values", async () => {
  const f = await readyFixture(entries(201), { zero: true, name: "盤".repeat(63) }), input = postCommand(f, "盤".repeat(166));
  await unchanged(f, transactionDatabase(), { code: "PERMISSION_STALE" }, { input, proof: {} });
  const { result, db } = await succeeds(f, { input }); assert.equal(result.rowCount, 0); assert.equal(result.movementGroupId, null);
  assert.equal(calls(db, /UPDATE inventory_stock_balances|INSERT INTO inventory_movements|UPDATE inventory_stocktake_lines/iu).length, 0);
  assert.equal(calls(db, /LEFT JOIN inventory_lots/iu).length, 0); assert.deepEqual(sizes(db, "inventory_audit_logs"), [1]);
  const overhead = Buffer.byteLength(JSON.stringify({ name: "" })), room = 8192 - overhead;
  const name = "盤".repeat(Math.floor(room / 3)) + "x".repeat(room % 3), summary = { name };
  assert.equal(Buffer.byteLength(JSON.stringify(summary), "utf8"), 8192);
  const boundaryDb = transactionDatabase(), audit = new InventoryAuditService({ database: boundaryDb, logger, time });
  const auditInput = { action: "stocktake.post", actorUserId: 8, actorLabel: "synthetic-approver", targetType: "stocktake", targetId: f.header.id,
    targetLabel: "UTF8 boundary", beforeSummary: summary, afterSummary: summary, operationRequestId: result.operationId, requestId: randomUUID(), correlationId: randomUUID() };
  await boundaryDb.withTransaction(tx => audit.recordSucceededBatch(tx, Array.from({ length: 100 }, () => ({ ...auditInput }))));
  settled(boundaryDb, "COMMITTED"); budgets(boundaryDb); assert.ok(sizes(boundaryDb, "inventory_audit_logs").length > 1, "Two exact 8192-byte summaries require UTF8 budget splitting");
  const [persisted] = await pool.execute("SELECT before_summary,after_summary FROM inventory_audit_logs WHERE request_id=? ORDER BY id", [auditInput.requestId]);
  assert.equal(persisted.length, 100); assert.ok(persisted.every(row => json(row.before_summary).name === name && json(row.after_summary).name === name));
  const before = await snapshot(), rejectedDb = transactionDatabase(), rejectedAudit = new InventoryAuditService({ database: rejectedDb, logger, time });
  await assert.rejects(rejectedDb.withTransaction(tx => rejectedAudit.recordSucceededBatch(tx, [{ ...auditInput, afterSummary: { name: `${name}x` } }])), /8192/u);
  settled(rejectedDb, "ROLLED_BACK"); assert.deepEqual(await snapshot(), before);
});

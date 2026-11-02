import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import test, { before, after } from "node:test";
import mysql from "mysql2/promise";
import { up as permissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as operations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as audit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as master } from "../../database/migrations/0058_create_inventory_master.js";
import { up as stock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as movements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as reservations } from "../../database/migrations/0063_create_inventory_reservations.js";
import { up as transfers } from "../../database/migrations/0064_create_inventory_transfers.js";
import { up as stocktakes } from "../../database/migrations/0065_create_inventory_stocktakes.js";
import { InventoryStocktakeService } from "../../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { createInventoryBarrier } from "../../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_TESTS === "1";
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 30000 }, work);
const time = { nowMs: () => 1791763200000, fileDate: () => "2026-10-12" };
const logger = { error() {} };
let pool, database, service;
const claims = ["inventory.operation"];
const businessTables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_bin_locks", "inventory_stocktake_lines",
  "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_reservations",
  "inventory_allocations", "inventory_operation_requests", "inventory_audit_logs"];
function latch() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function transactionDatabase({ beforeQuery, afterQuery, beforeExecute, beforeCommit } = {}) {
  return { async withTransaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.query("SET SESSION innodb_lock_wait_timeout = 5"); await connection.beginTransaction();
      const tx = { threadId: connection.threadId,
        async query(sql, params) { await beforeQuery?.(sql, tx); const result = await connection.query(sql, params); await afterQuery?.(sql, tx); return result; },
        async execute(sql, params) { await beforeExecute?.(sql, tx); return connection.execute(sql, params); } };
      const result = await work(tx); await beforeCommit?.(); await connection.commit(); return result;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } };
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task036_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET ?? "", /^\/private\/tmp\/erp-inventory-task036-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  pool = mysql.createPool({ user: "root", database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET, connectionLimit: 6 });
  const [[environment]] = await pool.query("SELECT VERSION() AS version, DATABASE() AS schema_name, @@skip_networking AS isolated");
  assert.equal(environment.version, "26.7.0"); assert.equal(environment.schema_name, process.env.DB_NAME); assert.equal(Number(environment.isolated), 1);
  assert.equal((await pool.query("SHOW TABLES"))[0].length, 0, "fresh owned schema required; never reset existing data");
  for (const ddl of [
    "CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY, username VARCHAR(190), status VARCHAR(20)) ENGINE=InnoDB",
    "CREATE TABLE roles (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(190)) ENGINE=InnoDB",
    "CREATE TABLE user_roles (user_id BIGINT UNSIGNED, role_id BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE role_permissions (role_id BIGINT UNSIGNED, permission_id BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE permissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190) UNIQUE, description VARCHAR(255) DEFAULT '', created_at BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE items (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(190), product_type VARCHAR(20), status VARCHAR(20),version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB",
    `CREATE TABLE item_skus (id BIGINT UNSIGNED PRIMARY KEY, item_id BIGINT UNSIGNED, sku_code VARCHAR(190), sku_name VARCHAR(190), status VARCHAR(20),
      purchasable BOOLEAN DEFAULT 1, sellable BOOLEAN DEFAULT 1, inventory_tracked BOOLEAN DEFAULT 1, tracking_policy VARCHAR(20), shelf_life_days INT,
      min_receipt_life_days INT, min_sale_life_days INT, effective_from DATE, effective_to DATE,version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB`,
    "CREATE TABLE item_uoms (id BIGINT UNSIGNED PRIMARY KEY, code VARCHAR(20), name VARCHAR(100), status VARCHAR(20), version INT UNSIGNED DEFAULT 1) ENGINE=InnoDB",
    `CREATE TABLE item_sku_uoms (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sku_id BIGINT UNSIGNED, uom_id BIGINT UNSIGNED,
      to_base_factor DECIMAL(18,6), is_base BOOLEAN, is_default_purchase BOOLEAN, is_default_sale BOOLEAN, version INT UNSIGNED DEFAULT 1) ENGINE=InnoDB`
  ]) await pool.query(ddl);
  for (const migrate of [permissions, operations, audit, master, stock, movements, reservations, transfers, stocktakes]) await migrate(pool);
  await pool.query("INSERT INTO users VALUES (7,'synthetic-stocktake-operator','active')");
  await pool.query("INSERT INTO roles VALUES (1,'warehouse-operator')"); await pool.query("INSERT INTO user_roles VALUES (7,1)");
  await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name = 'inventory.operation'");
  await pool.query("INSERT INTO items (id,name,product_type,status) VALUES (1,'Synthetic','physical','active')");
  await pool.query("INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy) VALUES (12,1,'SKU-12','Synthetic plain','active','none'),(13,1,'SKU-13','Synthetic lot','active','batch')");
  await pool.query("INSERT INTO item_uoms (id,code,name,status) VALUES (1,'EA','Each','active')");
  await pool.query("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (12,1,1,1,1,1),(13,1,1,1,1,1)");
  for (const id of [1, 2]) await pool.execute("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,1,1)", [id, `SYN-${id}`, `syn-${id}`, `Synthetic ${id}`]);
  await pool.query("INSERT INTO inventory_lots (id,sku_id,lot_number,normalized_lot_number,first_receipt_date,sku_code_snapshot,created_at) VALUES (1,13,'LOT-13','lot-13','2026-10-12','SKU-13',1)");
  database = transactionDatabase(); service = new InventoryStocktakeService({ database, logger, time });
});
after(async () => { if (pool) await pool.end(); });
function command(action, payload, eventId = randomUUID()) {
  return inventoryCommandFixture({ actor: { claimedPermissions: claims }, authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "synthetic-task036", eventId }, correlationId: eventId, payload });
}
async function bin(warehouse = 1) {
  const code = randomUUID();
  return (await pool.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?,1,1)", [warehouse, code, code]))[0].insertId;
}
async function balance(binId, quantity = 3, status = "AVAILABLE", sku = 12, lot = null) {
  return (await pool.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,created_at,updated_at) VALUES (1,?,?,?,?,?,1,1)", [binId, sku, lot, status, quantity]))[0].insertId;
}
async function draft(bins) { return service.create(command("create", { warehouseId: 1, binIds: bins })); }
function start(header) { return command("start", { stocktakeId: header.id, expectedVersion: header.version }); }
function replace(header, bins) { return command("update", { stocktakeId: header.id, expectedVersion: header.version, binIds: bins }); }
function cancel(header) { return command("cancel", { stocktakeId: header.id, expectedVersion: header.version, reason: "synthetic cancelled plan" }); }
async function rows(table, stocktakeId) { return (await pool.execute(`SELECT * FROM ${table} WHERE stocktake_id = ? ORDER BY id`, [stocktakeId]))[0]; }
async function snapshot() {
  const result = {};
  for (const table of businessTables) result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return result;
}
function receipt(binId) {
  const eventId = randomUUID();
  return inventoryCommandFixture({ actor: { claimedPermissions: claims }, authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "RECEIPT", documentId: "synthetic-task036-receipt", eventId }, correlationId: eventId,
    payload: { warehouseId: 1, binId, skuId: 12, uomId: 1, stockStatus: "AVAILABLE", quantity: 2 } });
}
async function waitForWarehouse(threadId) {
  const deadline = Date.now() + 5000;
  do {
    const [[row]] = await pool.execute(`SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w
      JOIN performance_schema.threads t ON t.thread_id = w.requesting_thread_id
      JOIN performance_schema.data_locks l ON l.engine_lock_id = w.requesting_engine_lock_id AND l.engine = w.engine
      WHERE t.processlist_id = ? AND l.object_schema = ? AND l.object_name = 'inventory_warehouses'`, [threadId, process.env.DB_NAME]);
    if (Number(row.waiting) > 0) return;
    await setImmediate();
  } while (Date.now() < deadline);
  throw new Error("intended Warehouse wait was not observed");
}
async function ordered(firstWork, secondWork, whileWaiting = async () => {}) {
  const acquired = latch(), entered = latch(), release = latch(); let held = false;
  const firstDb = transactionDatabase({ afterQuery: async sql => {
    if (!held && sql.includes("FROM inventory_warehouses") && sql.includes("FOR UPDATE")) { held = true; acquired.resolve(); await release.promise; }
  } });
  const secondDb = transactionDatabase({ beforeQuery: async (sql, tx) => {
    if (sql.includes("FROM inventory_warehouses") && sql.includes("FOR UPDATE")) entered.resolve(tx.threadId);
  } });
  const first = firstWork(firstDb).then(value => ({ value }), error => ({ error })); let second;
  try {
    await Promise.race([acquired.promise, first.then(result => { throw result.error ?? new Error("first command ended before its Warehouse barrier"); })]);
    second = secondWork(secondDb).then(value => ({ value }), error => ({ error }));
    const thread = await Promise.race([entered.promise, second.then(result => { throw result.error ?? new Error("second command ended before its Warehouse wait"); })]);
    await waitForWarehouse(thread); await whileWaiting();
  } finally { release.resolve(); }
  const results = await Promise.all([first, second]); assert.ok(held); return results;
}
function options(db = database, extra = {}) { return { database: db, logger, time, ...extra }; }
function racingOperations() {
  const barrier = createInventoryBarrier(), real = new InventoryOperationService();
  return { claim: async (...args) => { const claim = await real.claim(...args); await barrier.wait(); return claim; }, complete: (...args) => real.complete(...args) };
}
integrationTest("ST036-D01 real multi-Bin Draft persists without stock/lock/snapshot effects", async () => {
  const bins = [await bin(), await bin()]; await balance(bins[0]); const before = await snapshot();
  const result = await draft(bins); assert.equal(result.status, "DRAFT"); assert.equal((await rows("inventory_stocktake_bins", result.id)).length, 2);
  const after = await snapshot(); for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_bin_locks", "inventory_stocktake_lines"]) assert.deepEqual(after[table], before[table]);
});
integrationTest("ST036-D02 every unfinished scope owner conflicts but terminal history does not", async () => {
  for (const status of ["DRAFT", "COUNTING", "READY_TO_POST"]) {
    const id = await bin(), original = await draft([id]); await pool.execute("UPDATE inventory_stocktakes SET status = ? WHERE id = ?", [status, original.id]);
    const before = await snapshot(); await assert.rejects(draft([id]), { code: "STOCKTAKE_STATE_CONFLICT" }); assert.deepEqual(await snapshot(), before);
    await pool.execute("UPDATE inventory_stocktakes SET status = 'CANCELLED' WHERE id = ?", [original.id]); await draft([id]);
  }
});
integrationTest("ST036-D03 concurrent Draft creates have exactly one complete owner", async () => {
  const id = await bin(), contender = new InventoryStocktakeService(options(database, { operations: racingOperations() }));
  const results = await Promise.allSettled([contender.create(command("create", { warehouseId: 1, binIds: [id] })), contender.create(command("create", { warehouseId: 1, binIds: [id] }))]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1); assert.equal(results.find(row => row.status === "rejected").reason.code, "STOCKTAKE_STATE_CONFLICT");
  const [[count]] = await pool.execute("SELECT COUNT(*) AS n FROM inventory_stocktake_bins WHERE bin_id = ?", [id]); assert.equal(Number(count.n), 1);
});
integrationTest("ST036-D04 complete scope replacement conflict has no partial mutation", async () => {
  const bins = [await bin(), await bin(), await bin()], first = await draft([bins[0]]); await draft([bins[1]]);
  const before = await snapshot(); await assert.rejects(service.update(replace(first, [bins[2], bins[1]])), { code: "STOCKTAKE_STATE_CONFLICT" }); assert.deepEqual(await snapshot(), before);
});
integrationTest("ST036-D05 scope removal and Draft cancel free membership while retaining terminal scope", async () => {
  const bins = [await bin(), await bin()], first = await draft([bins[0]]);
  const updated = await service.update(replace(first, [bins[1]])); await draft([bins[0]]);
  await service.cancelDraft(cancel(updated)); const history = await rows("inventory_stocktake_bins", first.id); assert.equal(history[0].bin_id, bins[1]);
  await draft([bins[1]]); assert.deepEqual(await rows("inventory_stocktake_bins", first.id), history);
});
integrationTest("ST036-D06 Draft does not block a genuine Receipt transaction", async () => {
  const id = await bin(), header = await draft([id]); await new InventoryPostingService(options()).postReceipt(receipt(id));
  const [[row]] = await pool.execute("SELECT on_hand_quantity FROM inventory_stock_balances WHERE bin_id = ?", [id]); assert.equal(Number(row.on_hand_quantity), 2);
  assert.equal((await rows("inventory_bin_locks", header.id)).length, 0);
});
integrationTest("ST036-D07 multi-Bin Start snapshots all statuses, zero and Lot dimensions with NULL counts", async () => {
  const id = await bin(), second = await bin(); await balance(id, 3); await balance(id, 0, "QUARANTINED"); await balance(id, 2, "DAMAGED"); await balance(id, 7, "AVAILABLE", 13, 1); await balance(second,4);
  const header = await draft([id,second]), before = await snapshot(), result = await service.start(start(header));
  const lines = await rows("inventory_stocktake_lines", header.id), scopes = await rows("inventory_stocktake_bins",header.id);
  assert.equal(result.rowCount, 5); assert.equal(result.status, "COUNTING");
  assert.deepEqual(lines.map(row => Number(row.snapshot_quantity)).sort((a,b) => a-b), [0,2,3,4,7]); assert.ok(lines.every(row => row.counted_quantity === null && row.is_not_found === 0));
  assert.ok(lines.every(row => scopes.some(scope => scope.id===row.stocktake_bin_id && scope.bin_id===row.bin_id && scope.stocktake_id===row.stocktake_id)));
  assert.equal((await rows("inventory_bin_locks",header.id)).length,2);
  const after = await snapshot(); for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_reservations", "inventory_allocations"]) assert.deepEqual(after[table], before[table]);
});
integrationTest("ST036-D08 late inactive or wrong-Warehouse Bin rejects entire multi-Bin Start", async () => {
  for (const changes of ["status = 'INACTIVE'", "warehouse_id = 2"]) {
    const bins = [await bin(), await bin()], header = await draft(bins); await balance(bins[0]); await pool.execute(`UPDATE inventory_bins SET ${changes} WHERE id = ?`, [bins[1]]);
    const before = await snapshot(); await assert.rejects(service.start(start(header)), error => ["BIN_INVALID","BIN_WAREHOUSE_MISMATCH"].includes(error.code)); assert.deepEqual(await snapshot(), before);
  }
});
integrationTest("ST036-D09 foreign active lock can never be acquired or released by Start", async () => {
  const id = await bin(), header = await draft([id]), foreign = await draft([await bin()]);
  const [scope] = await pool.execute("INSERT INTO inventory_stocktake_bins (stocktake_id,bin_id,bin_code_snapshot,created_at) VALUES (?,?,'synthetic-corrupt-overlap',1)", [foreign.id, id]);
  await pool.execute("INSERT INTO inventory_bin_locks (stocktake_id,stocktake_bin_id,bin_id,lock_type,locked_at) VALUES (?,?,?,'STOCKTAKE',1)", [foreign.id, scope.insertId, id]);
  const before = await snapshot(); await assert.rejects(service.start(start(header)), error => ["STOCKTAKE_STATE_CONFLICT","BIN_LOCKED_BY_STOCKTAKE"].includes(error.code)); assert.deepEqual(await snapshot(), before);
});
integrationTest("ST036-D10 competing same-version Starts have one snapshot and lock set", async () => {
  const id = await bin(), header = await draft([id]); await balance(id);
  const contender = new InventoryStocktakeService(options(database, { operations: racingOperations() }));
  const result = await Promise.allSettled([contender.start(start(header)), contender.start(start(header))]);
  assert.equal(result.filter(row => row.status === "fulfilled").length, 1); assert.equal(result.find(row => row.status === "rejected").reason.code, "VERSION_CONFLICT");
  assert.equal((await rows("inventory_bin_locks",header.id)).length, 1); assert.equal((await rows("inventory_stocktake_lines",header.id)).length, 1);
});
integrationTest("ST036-D11 committed scope/version replacement during Warehouse wait defeats stale discovery", async () => {
  const bins = [await bin(), await bin()], header = await draft([bins[0]]);
  const [winner, loser] = await ordered(db => new InventoryStocktakeService(options(db)).update(replace(header,[bins[1]])), db => new InventoryStocktakeService(options(db)).start(start(header)));
  assert.ok(winner.value); assert.equal(loser.error?.code,"VERSION_CONFLICT"); assert.deepEqual((await rows("inventory_stocktake_bins",header.id)).map(row => row.bin_id), [bins[1]]);
  assert.equal((await rows("inventory_bin_locks",header.id)).length, 0); assert.equal((await rows("inventory_stocktake_lines",header.id)).length, 0);
});
integrationTest("ST036-D12 Receipt-first commit is included in Start snapshot after actual lock wait", async () => {
  const id = await bin(), header = await draft([id]);
  const [receiptResult, started] = await ordered(db => new InventoryPostingService(options(db)).postReceipt(receipt(id)), db => new InventoryStocktakeService(options(db)).start(start(header)));
  assert.ok(receiptResult.value); assert.ok(started.value); assert.equal(Number((await rows("inventory_stocktake_lines",header.id))[0].snapshot_quantity), 2);
});
integrationTest("ST036-D13 Start-first commit blocks Receipt with no second quantity or movement effect", async () => {
  const id = await bin(), header = await draft([id]); await balance(id);
  const before = await snapshot(); const [started, receiptResult] = await ordered(db => new InventoryStocktakeService(options(db)).start(start(header)), db => new InventoryPostingService(options(db)).postReceipt(receipt(id)));
  assert.ok(started.value); assert.equal(receiptResult.error?.code,"BIN_LOCKED_BY_STOCKTAKE");
  const after = await snapshot(); assert.deepEqual(after.inventory_stock_balances,before.inventory_stock_balances); assert.deepEqual(after.inventory_movements,before.inventory_movements);
});
integrationTest("ST036-D14 each intended mid-lock/snapshot/Audit/completion/commit failure rolls back wholly", async () => {
  for (const [name, pattern, occurrence] of [["second lock",/INSERT INTO inventory_bin_locks/u,2],["snapshot",/INSERT INTO inventory_stocktake_lines/u,1],
    ["audit",/INSERT INTO inventory_audit_logs/u,1],["completion",/UPDATE inventory_operation_requests/u,1],["commit",null,1]]) {
    const bins = [await bin(),await bin()], header = await draft(bins); await balance(bins[0]); const before = await snapshot(); let hits=0, triggered=false;
    const fail = () => { triggered=true; throw new Error(`intended ${name} fault`); };
    const db = transactionDatabase({ beforeExecute: async sql => { if (pattern?.test(sql) && ++hits===occurrence) fail(); }, beforeCommit: name==="commit" ? fail : undefined });
    await assert.rejects(new InventoryStocktakeService(options(db)).start(start(header)), new RegExp(`intended ${name} fault`,"u"));
    assert.equal(triggered,true); assert.deepEqual(await snapshot(),before);
  }
});
integrationTest("ST036-D15 domain replay keeps original receipts and altered source payload conflicts", async () => {
  const id = await bin(), createCommand = command("create",{warehouseId:1,binIds:[id]}), header = await service.create(createCommand), startCommand = start(header);
  const started = await service.start(startCommand), before = await snapshot();
  assert.deepEqual(await service.create(createCommand),header); assert.deepEqual(await service.start(startCommand),started);
  await assert.rejects(service.create({...createCommand,payload:{warehouseId:1,binIds:[id],reason:"changed intent"}}),{code:"INVENTORY_SOURCE_CONFLICT"}); assert.deepEqual(await snapshot(),before);
});
integrationTest("ST036-D16 revoked permission rejects new commands and successful replay without effects", async () => {
  const id=await bin(), request=command("create",{warehouseId:1,binIds:[id]}); await service.create(request); const before=await snapshot();
  await pool.query("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=1 AND p.name='inventory.operation'");
  try { await assert.rejects(service.create(request),{code:"PERMISSION_STALE"}); await assert.rejects(draft([await bin()]),{code:"PERMISSION_STALE"}); assert.deepEqual(await snapshot(),before); }
  finally { await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name='inventory.operation'"); }
});
integrationTest("ST036-D17 committed permission revocation during Warehouse wait defeats stale RR claims", async () => {
  const bins=[await bin(),await bin()], holder=await draft([bins[0]]), waiting=await draft([bins[1]]);
  try {
    const [cancelled, rejected]=await ordered(db=>new InventoryStocktakeService(options(db)).cancelDraft(cancel(holder)),db=>new InventoryStocktakeService(options(db)).start(start(waiting)),
      async()=>pool.query("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=1 AND p.name='inventory.operation'"));
    assert.equal(cancelled.error?.code,"PERMISSION_STALE"); assert.equal(rejected.error?.code,"PERMISSION_STALE");
    assert.equal((await rows("inventory_bin_locks",waiting.id)).length,0); assert.equal((await rows("inventory_stocktake_lines",waiting.id)).length,0);
  } finally { await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name='inventory.operation'"); }
});
integrationTest("ST036-D18 Draft cancel/replace version race retains history and cancel permits an inactive Bin", async () => {
  const bins=[await bin(),await bin()], header=await draft([bins[0]]), contender=new InventoryStocktakeService(options(database,{operations:racingOperations()}));
  const results=await Promise.allSettled([contender.cancelDraft(cancel(header)),contender.update(replace(header,[bins[1]]))]);
  assert.equal(results.filter(row=>row.status==="fulfilled").length,1); assert.equal(results.find(row=>row.status==="rejected").reason.code,"VERSION_CONFLICT");
  assert.equal((await rows("inventory_stocktake_bins",header.id)).length,1); assert.equal((await rows("inventory_bin_locks",header.id)).length,0);
  const id=await bin(), inactive=await draft([id]); await pool.execute("UPDATE inventory_bins SET status='INACTIVE' WHERE id=?",[id]);
  assert.equal((await service.cancelDraft(cancel(inactive))).status,"CANCELLED"); assert.equal((await rows("inventory_stocktake_bins",inactive.id)).length,1);
});

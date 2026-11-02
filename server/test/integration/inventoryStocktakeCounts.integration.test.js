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
import { InventoryInquiryService } from "../../src/modules/inventory/InventoryInquiryService.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_COUNTS_TESTS === "1";
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
  return { query: (...args) => pool.query(...args), async withTransaction(work) {
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
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task037_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET ?? "", /^\/private\/tmp\/erp-inventory-task037-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
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
  await pool.query(`INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy,inventory_tracked,min_sale_life_days) VALUES
    (14,1,'SKU-14','Expiry','active','batch_expiry',1,30),(15,1,'SKU-15','Serial','active','serial',1,NULL),
    (16,1,'SKU-16','Nontracked','active','none',0,NULL),(17,1,'SKU-17','Inactive','inactive','none',1,NULL)`);
  await pool.query("INSERT INTO item_uoms (id,code,name,status) VALUES (1,'EA','Each','active')");
  await pool.query("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (12,1,1,1,1,1),(13,1,1,1,1,1)");
  await pool.query("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (14,1,1,1,1,1),(15,1,1,1,1,1),(16,1,1,1,1,1),(17,1,1,1,1,1)");
  for (const id of [1, 2]) await pool.execute("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,1,1)", [id, `SYN-${id}`, `syn-${id}`, `Synthetic ${id}`]);
  await pool.query("INSERT INTO inventory_lots (id,sku_id,lot_number,normalized_lot_number,first_receipt_date,sku_code_snapshot,created_at) VALUES (1,13,'LOT-13','lot-13','2026-10-12','SKU-13',1)");
  await pool.query(`INSERT INTO inventory_lots (id,sku_id,lot_number,normalized_lot_number,first_receipt_date,expiry_date,sku_code_snapshot,created_at) VALUES
    (2,14,'EXPIRED','expired','2020-01-01','2020-02-01','SKU-14',1),
    (3,14,'SHORT','short','2026-10-01','2026-10-13','SKU-14',1),
    (4,14,'MISSING-EXPIRY','missing-expiry','2026-10-01',NULL,'SKU-14',1),
    (5,12,'WRONG-NONE','wrong-none','2026-10-01',NULL,'SKU-12',1)`);
  database = transactionDatabase(); service = new InventoryStocktakeService({ database, logger, time });
});
after(async () => { if (pool) await pool.end(); });
function command(action, payload, eventId = randomUUID()) {
  return inventoryCommandFixture({ actor: { claimedPermissions: claims }, authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "synthetic-task037", eventId }, correlationId: eventId, payload });
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
async function rows(table, stocktakeId) { return (await pool.execute(`SELECT * FROM ${table} WHERE stocktake_id = ? ORDER BY id`, [stocktakeId]))[0]; }
async function snapshot() {
  const result = {};
  for (const table of businessTables) result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return result;
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
function options(db = database) { return { database: db, logger, time }; }
const stockTables = ["inventory_stock_balances","inventory_stock_controls","inventory_lots","inventory_movements","inventory_reservations","inventory_allocations","inventory_bin_locks"];
async function counting(size = 1) {
  const bins = [];
  for (let i=0;i<size;i++) { const id=await bin(); bins.push(id); await balance(id); }
  const header=await draft(bins), started=await service.start(start(header));
  return { header:started, bins, lines:await rows("inventory_stocktake_lines",header.id) };
}
function countRequest(f, inputs=f.lines.map(row=>({lineId:Number(row.id),expectedVersion:Number(row.version),countedQuantity:0}))) {
  return command("count",{stocktakeId:f.header.id,lines:inputs});
}
function addRequest(f, changes={}) {
  return command("add_line",{stocktakeId:f.header.id,binId:f.bins[0],skuId:12,lotId:null,stockStatus:"QUARANTINED",...changes});
}
async function unchanged(work, expected) { const before=await snapshot(); await assert.rejects(work,expected); assert.deepEqual(await snapshot(),before); }
function unchangedStock(before, after) { for (const table of stockTables) assert.deepEqual(after[table],before[table],table); }
async function operationAudits(id) { return (await pool.execute("SELECT * FROM inventory_audit_logs WHERE operation_request_id=? ORDER BY id",[id]))[0]; }
async function operation(id) { return (await pool.execute("SELECT * FROM inventory_operation_requests WHERE id=?",[id]))[0][0]; }
function json(value) { return typeof value==="string" ? JSON.parse(value) : value; }
function scalar(value) { assert.ok(Object.values(value).every(v=>v===null||["string","number","boolean"].includes(typeof v))); assert.ok(Buffer.byteLength(JSON.stringify(value))<=8192); }
async function revoke() { await pool.query("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=1 AND p.name='inventory.operation'"); }
async function restore() { await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name='inventory.operation'"); }
async function holder(db, work=async()=>{}) {
  return db.withTransaction(async tx=>{ await tx.query("SELECT id FROM inventory_warehouses WHERE id=1 FOR UPDATE"); await work(tx); });
}

integrationTest("ST037-D01 real zero, positive and notFound preserve distinct state and scalar Audit",async()=>{
  const f=await counting(3),before=await snapshot();
  const result=await service.saveCounts(countRequest(f,f.lines.map((row,i)=>({lineId:row.id,expectedVersion:1,...(i===2?{notFound:true}:{countedQuantity:i===0?0:7})}))));
  assert.deepEqual(result,{id:f.header.id,operationId:result.operationId,status:"COUNTING",version:f.header.version,rowCount:3});
  const current=await rows("inventory_stocktake_lines",f.header.id);
  assert.deepEqual(current.map(r=>[Number(r.counted_quantity),r.counted_quantity===null,r.is_not_found,r.version]),[[0,false,0,2],[7,false,0,2],[0,true,1,2]]);
  assert.ok(current.every(r=>Number(r.counted_at)===time.nowMs()&&Number(r.counted_by)===7&&r.variance_quantity===null));
  const logs=await operationAudits(result.operationId); assert.equal(logs.length,3);
  assert.deepEqual(logs.map(r=>json(r.after_summary).status),["COUNTED","COUNTED","NOT_FOUND"]);
  for(const row of logs) { scalar(json(row.before_summary));scalar(json(row.after_summary));assert.equal(json(row.before_summary).status,"UNCOUNTED");assert.equal(Number(row.target_id),f.header.id); }
  unchangedStock(before,await snapshot());
});
integrationTest("ST037-D02 full100 safe-integer counts commit exactly100 scalar Audits and one receipt",async()=>{
  const f=await counting(100),before=await snapshot(),started=Date.now();
  const result=await service.saveCounts(countRequest(f,f.lines.map(r=>({lineId:r.id,expectedVersion:1,countedQuantity:Number.MAX_SAFE_INTEGER}))));
  assert.equal(result.rowCount,100);scalar(result);
  const logs=await operationAudits(result.operationId);assert.equal(logs.length,100);
  assert.equal(new Set(logs.map(r=>json(r.after_summary).id)).size,100);
  assert.ok(logs.every(r=>json(r.after_summary).quantity===Number.MAX_SAFE_INTEGER&&json(r.after_summary).version===2));
  for(const row of logs) {scalar(json(row.before_summary));scalar(json(row.after_summary));}
  const op=await operation(result.operationId);assert.deepEqual(json(op.result_summary),result);assert.equal(op.result_type,"STOCKTAKE");assert.equal(op.result_id,String(f.header.id));
  assert.ok((await rows("inventory_stocktake_lines",f.header.id)).every(r=>Number(r.counted_quantity)===Number.MAX_SAFE_INTEGER&&r.version===2));
  const [[root]]=await pool.execute("SELECT version FROM inventory_stocktakes WHERE id=?",[f.header.id]);assert.equal(root.version,f.header.version);
  unchangedStock(before,await snapshot());assert.ok(Date.now()-started<30000,"100-Audit transaction test budget");
});
integrationTest("ST037-D03 all invalid forms, limits and client overrides reject with no effects",async()=>{
  const f=await counting(),row=f.lines[0],valid={lineId:row.id,expectedVersion:1,countedQuantity:0};
  const cases=[[],Array.from({length:101},(_,i)=>({...valid,lineId:i+1})),[valid,valid],[null],
    ...[null,"0",-1,0.1,Number.MAX_SAFE_INTEGER+1].map(countedQuantity=>[{...valid,countedQuantity}]),
    [{...valid,notFound:true}],[{lineId:row.id,expectedVersion:1,notFound:false}],[{...valid,snapshotQuantity:7}],[{...valid,version:1}]];
  for(const lines of cases) await unchanged(()=>service.saveCounts(countRequest(f,lines)),e=>["INVENTORY_INPUT_INVALID","INVENTORY_QUANTITY_INVALID"].includes(e.code));
  await unchanged(()=>service.saveCounts({...countRequest(f),payload:{...countRequest(f).payload,actorId:8}}),{code:"INVENTORY_INPUT_INVALID"});
});
integrationTest("ST037-D04 one stale version rolls back the entire valid-plus-stale batch",async()=>{
  const f=await counting(2);await service.saveCounts(countRequest(f,[{lineId:f.lines[1].id,expectedVersion:1,countedQuantity:9}]));
  await unchanged(()=>service.saveCounts(countRequest(f)),{code:"VERSION_CONFLICT"});
});
integrationTest("ST037-D05 valid-plus-foreign line rejects without horizontal ownership effects",async()=>{
  const f=await counting(),foreign=await counting();
  await unchanged(()=>service.saveCounts(countRequest(f,[{lineId:f.lines[0].id,expectedVersion:1,countedQuantity:1},{lineId:foreign.lines[0].id,expectedVersion:1,notFound:true}])),{code:"INVENTORY_RESOURCE_NOT_FOUND"});
});
integrationTest("ST037-D06 nonCOUNTING states reject both writes and retain owned lock history",async()=>{
  for(const status of ["DRAFT","READY_TO_POST","POSTED","CANCELLED"]) {
    const f=await counting();await pool.execute("UPDATE inventory_stocktakes SET status=? WHERE id=?",[status,f.header.id]);
    await unchanged(()=>service.saveCounts(countRequest(f)),{code:"STOCKTAKE_STATE_CONFLICT"});
    await unchanged(()=>service.addLine(addRequest(f)),{code:"STOCKTAKE_STATE_CONFLICT"});
  }
});
integrationTest("ST037-D07 concurrent same-line versions have exactly one complete winner",async()=>{
  const f=await counting(),before=await snapshot();
  const [winner,loser]=await ordered(db=>new InventoryStocktakeService(options(db)).saveCounts(countRequest(f,[{lineId:f.lines[0].id,expectedVersion:1,countedQuantity:0}])),
    db=>new InventoryStocktakeService(options(db)).saveCounts(countRequest(f,[{lineId:f.lines[0].id,expectedVersion:1,countedQuantity:9}])));
  assert.ok(winner.value);assert.equal(loser.error?.code,"VERSION_CONFLICT");
  const after=await snapshot();assert.equal(after.inventory_operation_requests.length,before.inventory_operation_requests.length+1);assert.equal(after.inventory_audit_logs.length,before.inventory_audit_logs.length+1);
  assert.equal((await rows("inventory_stocktake_lines",f.header.id))[0].version,2);unchangedStock(before,after);
});
integrationTest("ST037-D08 distinct-line concurrent saves retain both updates and workflow version",async()=>{
  const f=await counting(2);
  const results=await ordered(db=>new InventoryStocktakeService(options(db)).saveCounts(countRequest(f,[{lineId:f.lines[0].id,expectedVersion:1,countedQuantity:3}])),
    db=>new InventoryStocktakeService(options(db)).saveCounts(countRequest(f,[{lineId:f.lines[1].id,expectedVersion:1,countedQuantity:4}])));
  assert.ok(results.every(r=>r.value?.version===f.header.version));assert.deepEqual((await rows("inventory_stocktake_lines",f.header.id)).map(r=>[Number(r.counted_quantity),r.version]),[[3,2],[4,2]]);
});
integrationTest("ST037-D09 real parser and source replay keep original count/add receipts after later edits",async()=>{
  const f=await counting(),count=countRequest(f),saved=await service.saveCounts(count),add=addRequest(f),added=await service.addLine(add);
  await service.saveCounts(countRequest(f,[{lineId:f.lines[0].id,expectedVersion:2,countedQuantity:8},{lineId:added.id,expectedVersion:1,notFound:true}]));
  const before=await snapshot(),inquiry=new InventoryInquiryService({database:{query:(...args)=>pool.query(...args)},time});
  for(const [request,result,method] of [[count,saved,"saveCounts"],[add,added,"addLine"]]) {
    assert.deepEqual(await service[method](request),result);
    const lookup=await inquiry.findOperationBySource({source:request.source});assert.deepEqual(lookup.resultSummary,result);assert.equal(lookup.resultId,String(f.header.id));assert.equal(lookup.resultType,"STOCKTAKE");
  }
  await assert.rejects(service.saveCounts({...count,payload:{...count.payload,lines:[{lineId:f.lines[0].id,expectedVersion:1,countedQuantity:1}]}}),{code:"INVENTORY_SOURCE_CONFLICT"});
  await assert.rejects(service.addLine({...add,payload:{...add.payload,stockStatus:"DAMAGED"}}),{code:"INVENTORY_SOURCE_CONFLICT"});
  await assert.rejects(service.addLine({...add,source:count.source}),{code:"INVENTORY_SOURCE_CONFLICT"});assert.deepEqual(await snapshot(),before);
});
integrationTest("ST037-D10 actual Warehouse waits recheck committed permission revocation for save/add",async()=>{
  for(const method of ["saveCounts","addLine"]) {
    const f=await counting(),before=await snapshot(),request=method==="saveCounts"?countRequest(f):addRequest(f);
    try {const [held,rejected]=await ordered(db=>holder(db),db=>new InventoryStocktakeService(options(db))[method](request),revoke);
      assert.ok(!held.error);assert.equal(rejected.error?.code,"PERMISSION_STALE");assert.deepEqual(await snapshot(),before);
    } finally {await restore();}
  }
});
integrationTest("ST037-D11 revoked actor blocks new writes and original successful receipt replay",async()=>{
  const f=await counting(),count=countRequest(f),add=addRequest(f);await service.saveCounts(count);await service.addLine(add);const before=await snapshot();
  await revoke();try {
    for(const [method,request] of [["saveCounts",count],["addLine",add],["saveCounts",countRequest(f)],["addLine",addRequest(f,{stockStatus:"DAMAGED"})]]) await assert.rejects(service[method](request),{code:"PERMISSION_STALE"});
    assert.deepEqual(await snapshot(),before);
  } finally {await restore();}
});
integrationTest("ST037-D12 reached second-row/second-Audit/complete/commit faults rollback all prior effects",async()=>{
  for(const method of ["saveCounts","addLine"]) {
    const cases=method==="saveCounts"?[["second row",/UPDATE inventory_stocktake_lines/u,2],["second Audit",/INSERT INTO inventory_audit_logs/u,2]]:[["insert",/INSERT INTO inventory_stocktake_lines/u,1],["Audit",/INSERT INTO inventory_audit_logs/u,1]];
    for(const [name,pattern,nth] of [...cases,["complete",/UPDATE inventory_operation_requests/u,1],["commit",null,1]]) {
      const f=await counting(2),before=await snapshot();let hits=0,reached=false;
      const fault=()=>{reached=true;throw new Error(`intended ${name}`);};
      const db=transactionDatabase({beforeExecute:async sql=>{if(pattern?.test(sql)&&++hits===nth) fault();},beforeCommit:name==="commit"?fault:undefined});
      await assert.rejects(new InventoryStocktakeService(options(db))[method](method==="saveCounts"?countRequest(f):addRequest(f)),new RegExp(`intended ${name}`,"u"));assert.equal(reached,true);assert.deepEqual(await snapshot(),before);
    }
  }
});
integrationTest("ST037-D13 none Bucket add is an uncounted zero snapshot with scalar line/parent binding",async()=>{
  const f=await counting(),before=await snapshot(),added=await service.addLine(addRequest(f));
  assert.deepEqual(added,{id:added.id,stocktakeId:f.header.id,operationId:added.operationId,status:"COUNTING",version:1,rowCount:1});scalar(added);
  const line=(await rows("inventory_stocktake_lines",f.header.id)).find(r=>r.id===added.id);
  assert.equal(line.stock_balance_id,null);assert.equal(Number(line.snapshot_quantity),0);assert.equal(line.snapshot_balance_version,0);assert.equal(line.counted_quantity,null);assert.equal(line.is_not_found,0);
  const [log]=await operationAudits(added.operationId);assert.equal(log.before_summary,null);assert.equal(json(log.after_summary).status,"UNCOUNTED");assert.equal(json(log.after_summary).id,added.id);assert.equal(json(log.after_summary).stocktakeId,f.header.id);
  const op=await operation(added.operationId);assert.equal(op.result_id,String(f.header.id));assert.deepEqual(json(op.result_summary),added);
  for(const [version,form] of [[1,{countedQuantity:0}],[2,{countedQuantity:5}],[3,{notFound:true}],[4,{countedQuantity:2}]]) await service.saveCounts(countRequest(f,[{lineId:added.id,expectedVersion:version,...form}]));
  const final=(await rows("inventory_stocktake_lines",f.header.id)).find(r=>r.id===added.id);assert.equal(Number(final.counted_quantity),2);assert.equal(final.is_not_found,0);assert.equal(final.version,5);unchangedStock(before,await snapshot());
});
integrationTest("ST037-D14 registered batch and expired/low-life Lots accept every physical Status only",async()=>{
  const f=await counting(),before=await snapshot();
  for(const [skuId,lotId] of [[13,1],[14,2],[14,3]]) for(const stockStatus of ["AVAILABLE","QUARANTINED","DAMAGED"]) {
    const added=await service.addLine(addRequest(f,{skuId,lotId,stockStatus}));const line=(await rows("inventory_stocktake_lines",f.header.id)).find(r=>r.id===added.id);
    assert.equal(line.sku_id,skuId);assert.equal(line.lot_id,lotId);assert.equal(line.stock_status,stockStatus);assert.equal(line.stocktake_bin_id,f.lines[0].stocktake_bin_id);assert.equal(Number(line.snapshot_quantity),0);
  }
  unchangedStock(before,await snapshot());
});
integrationTest("ST037-D15 unknown/wrong Lot, tracking, inactive and forged dates reject without invented IN",async()=>{
  const f=await counting();
  for(const [changes,code] of [[{skuId:13,lotId:999999},"INVENTORY_RESOURCE_NOT_FOUND"],[{skuId:14,lotId:1},"LOT_DATA_CONFLICT"],
    [{lotId:5},"INVENTORY_INPUT_INVALID"],[{skuId:13,lotId:null},"LOT_REQUIRED"],[{skuId:14,lotId:4},"EXPIRY_REQUIRED"],
    [{skuId:15},"SERIAL_TRACKING_UNSUPPORTED"],[{skuId:16},"SKU_NOT_INVENTORY_TRACKED"],[{skuId:17},"INVENTORY_INPUT_INVALID"],
    [{expiryDate:"2030-01-01"},"INVENTORY_INPUT_INVALID"],[{firstReceiptDate:"2026-10-12"},"INVENTORY_INPUT_INVALID"],[{lotNumber:"NEW"},"INVENTORY_INPUT_INVALID"]])
    await unchanged(()=>service.addLine(addRequest(f,changes)),{code});
});
integrationTest("ST037-D16 actual Warehouse wait observes a newly inactive Item profile",async()=>{
  const f=await counting(),before=await snapshot();
  try {const [held,rejected]=await ordered(db=>holder(db),db=>new InventoryStocktakeService(options(db)).addLine(addRequest(f)),async()=>pool.query("UPDATE item_skus SET status='inactive' WHERE id=12"));
    assert.ok(!held.error);assert.equal(rejected.error?.code,"INVENTORY_INPUT_INVALID");assert.deepEqual(await snapshot(),before);
  } finally {await pool.query("UPDATE item_skus SET status='active' WHERE id=12");}
});
integrationTest("ST037-D17 NULL-Lot and known-Lot add races commit one unique owned line each",async()=>{
  for(const changes of [{},{skuId:13,lotId:1}]) {
    const f=await counting(),before=await snapshot();
    const [winner,loser]=await ordered(db=>new InventoryStocktakeService(options(db)).addLine(addRequest(f,changes)),db=>new InventoryStocktakeService(options(db)).addLine(addRequest(f,changes)));
    assert.ok(winner.value);assert.equal(loser.error?.code,"STOCKTAKE_STATE_CONFLICT");
    const after=await snapshot();assert.equal(after.inventory_stocktake_lines.length,before.inventory_stocktake_lines.length+1);assert.equal(after.inventory_operation_requests.length,before.inventory_operation_requests.length+1);assert.equal(after.inventory_audit_logs.length,before.inventory_audit_logs.length+1);
    const line=(await rows("inventory_stocktake_lines",f.header.id)).at(-1);assert.equal(line.stocktake_bin_id,f.lines[0].stocktake_bin_id);
    await assert.rejects(pool.execute(`INSERT INTO inventory_stocktake_lines (stocktake_id,stocktake_bin_id,bin_id,sku_id,lot_id,stock_status) VALUES (?,?,?,?,?,?)`,[f.header.id,line.stocktake_bin_id,line.bin_id,line.sku_id,line.lot_id,line.stock_status]),{code:"ER_DUP_ENTRY"});
  }
});
integrationTest("ST037-D18 missing, released, foreign semantic owners and scope corruption reject both writes",async()=>{
  for(const kind of ["missing","released","foreign","wrongscope"]) {
    const f=await counting();
    if(kind==="missing") await pool.execute("DELETE FROM inventory_bin_locks WHERE stocktake_id=?",[f.header.id]);
    if(kind==="released") await pool.execute("UPDATE inventory_bin_locks SET released_at=1 WHERE stocktake_id=?",[f.header.id]);
    if(kind==="foreign") {
      const foreign=await draft([await bin()]);await pool.execute("DELETE FROM inventory_bin_locks WHERE stocktake_id=?",[f.header.id]);
      const [scope]=await pool.execute("INSERT INTO inventory_stocktake_bins (stocktake_id,bin_id,bin_code_snapshot,created_at) VALUES (?,?,'synthetic-corrupt-owner',1)",[foreign.id,f.bins[0]]);
      await pool.execute("INSERT INTO inventory_bin_locks (stocktake_id,stocktake_bin_id,bin_id,lock_type,locked_at) VALUES (?,?,?,'STOCKTAKE',1)",[foreign.id,scope.insertId,f.bins[0]]);
    }
    if(kind==="wrongscope") {
      const foreign=await counting(),before=await snapshot();
      await assert.rejects(pool.execute("UPDATE inventory_bin_locks SET stocktake_bin_id=? WHERE stocktake_id=?",[foreign.lines[0].stocktake_bin_id,f.header.id]),{code:"ER_NO_REFERENCED_ROW_2"});assert.deepEqual(await snapshot(),before);
      await pool.execute("DELETE FROM inventory_bin_locks WHERE stocktake_id=?",[f.header.id]);
    }
    await unchanged(()=>service.saveCounts(countRequest(f)),{code:"STOCKTAKE_STATE_CONFLICT"});await unchanged(()=>service.addLine(addRequest(f)),{code:"STOCKTAKE_STATE_CONFLICT"});
  }
});
integrationTest("ST037-D19 current root rejects committed READY state after actual Warehouse wait",async()=>{
  for(const method of ["saveCounts","addLine"]) {
    const f=await counting(),before=await snapshot(),request=method==="saveCounts"?countRequest(f):addRequest(f);
    const [transition,rejected]=await ordered(db=>holder(db,tx=>tx.execute("UPDATE inventory_stocktakes SET status='READY_TO_POST',version=version+1 WHERE id=?",[f.header.id])),db=>new InventoryStocktakeService(options(db))[method](request));
    assert.ok(!transition.error);assert.equal(rejected.error?.code,"STOCKTAKE_STATE_CONFLICT");
    const after=await snapshot();for(const table of businessTables.filter(t=>t!=="inventory_stocktakes")) assert.deepEqual(after[table],before[table]);
    const [[root]]=await pool.execute("SELECT status,version FROM inventory_stocktakes WHERE id=?",[f.header.id]);assert.deepEqual(root,{status:"READY_TO_POST",version:f.header.version+1});
  }
});
integrationTest("ST037-D20 bounded progress pages and all filters exactly partition more than100 lines",async()=>{
  const f=await counting(101),added=await service.addLine(addRequest(f));
  await service.saveCounts(countRequest(f,f.lines.slice(0,60).map((r,i)=>({lineId:r.id,expectedVersion:1,...(i<40?{countedQuantity:i}:{notFound:true})}))));
  await service.saveCounts(countRequest(f,[{lineId:added.id,expectedVersion:1,notFound:true}]));
  const before=await snapshot(),inquiry=new InventoryInquiryService({database,time}),summary={totalLines:102,countedLines:40,notFoundLines:21,uncountedLines:41};
  for(const [progress,total] of [["ALL",102],["COUNTED",40],["NOT_FOUND",21],["UNCOUNTED",41]]) {
    const all=[];
    for(let page=1;page<=Math.ceil(total/20)+1;page++) {const result=await inquiry.listStocktakeCountLines({stocktakeId:f.header.id,progress,page,pageSize:20});assert.deepEqual(result.summary,summary);assert.equal(result.total,total);assert.ok(result.items.length<=20);all.push(...result.items);}
    assert.equal(all.length,total);assert.equal(new Set(all.map(r=>r.id)).size,total);assert.deepEqual(all.map(r=>r.id),all.map(r=>r.id).sort((a,b)=>a-b));
    if(progress==="NOT_FOUND") assert.ok(all.every(r=>r.notFound&&r.actualQuantity===0&&r.countedQuantity===null));
    if(progress==="UNCOUNTED") assert.ok(all.every(r=>!r.notFound&&r.actualQuantity===null));
  }
  for(const query of [{page:0},{pageSize:101},{page:1.1},{page:Number.MAX_SAFE_INTEGER,pageSize:100},{progress:"UNKNOWN"},{progress:["ALL"]},{sort:"id"}]) await assert.rejects(inquiry.listStocktakeCountLines({stocktakeId:f.header.id,...query}),{code:"INVENTORY_INPUT_INVALID"});
  await assert.rejects(inquiry.listStocktakeCountLines({stocktakeId:999999}),{code:"INVENTORY_RESOURCE_NOT_FOUND"});assert.deepEqual(await snapshot(),before);
});
integrationTest("ST037-D21 progress header, aggregate and page share one consistent read without writer locks",async()=>{
  const f=await counting(),seen=latch(),release=latch(),calls=[];
  const db=transactionDatabase({afterQuery:async sql=>{calls.push(sql);if(sql.startsWith("SELECT id,status,version FROM inventory_stocktakes")){seen.resolve();await release.promise;}},beforeExecute:async()=>{throw new Error("progress must not write");}});
  const reading=new InventoryInquiryService({database:db,time}).listStocktakeCountLines({stocktakeId:f.header.id});
  try {await Promise.race([seen.promise,reading.then(()=>{throw new Error("query ended before consistency barrier");})]);await service.saveCounts(countRequest(f));} finally {release.resolve();}
  const original=await reading;assert.deepEqual(original.summary,{totalLines:1,countedLines:0,notFoundLines:0,uncountedLines:1});assert.equal(original.items[0].actualQuantity,null);assert.equal(original.items[0].version,1);
  assert.ok(calls.every(sql=>!sql.includes("FOR UPDATE")&&!sql.includes("FOR SHARE")));
  const current=await new InventoryInquiryService({database,time}).listStocktakeCountLines({stocktakeId:f.header.id});assert.equal(current.summary.countedLines,1);assert.equal(current.items[0].actualQuantity,0);assert.equal(current.items[0].version,2);
});
integrationTest("ST037-D22 unexpected existing Balance cannot become an invented zero snapshot",async()=>{
  for(const quantity of [0,7]) {const f=await counting();await balance(f.bins[0],quantity,"QUARANTINED");await unchanged(()=>service.addLine(addRequest(f)),{code:"STOCKTAKE_SNAPSHOT_MISMATCH"});
    const progress=await new InventoryInquiryService({database,time}).listStocktakeCountLines({stocktakeId:f.header.id});assert.equal(progress.total,1);assert.equal(progress.items[0].actualQuantity,null);
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import test, { before, after, beforeEach, afterEach } from "node:test";
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
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_DRAFT_LOCK_RANGE_TESTS === "1";
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 30000 }, work);
const time = { nowMs: () => 1791763200000, fileDate: () => "2026-10-12" };
const logger = { error() {} };
let pool, database, service, owner, caseNumber=0;
const baseSchema=process.env.DB_NAME;let schemaName=baseSchema;
const allConnections=new Map(),closedConnections=new Set();
const claims = ["inventory.operation"];
const observations=[];const rawErrors=[];
const businessTables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_bin_locks", "inventory_stocktake_lines",
  "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_reservations",
  "inventory_allocations", "inventory_operation_requests", "inventory_audit_logs", "inventory_warehouses", "inventory_bins", "inventory_transfers", "inventory_transfer_lines"];
function latch() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function transactionDatabase({ beforeQuery, afterQuery, beforeExecute, afterExecute, beforeCommit } = {}) {
  return { async withTransaction(work) {
    const connection = await pool.getConnection();
    allConnections.set(connection.threadId,connection.connection.stream);
    try {
      await connection.query("SET SESSION innodb_lock_wait_timeout = 5"); await connection.beginTransaction();
      const tx = { threadId: connection.threadId,
        async query(sql, params) { await beforeQuery?.(sql, tx); const result = await connection.query(sql, params); await afterQuery?.(sql, tx); return result; },
        async execute(sql, params) { await beforeExecute?.(sql, tx); try { const result=await connection.execute(sql, params);await afterExecute?.(sql,tx);return result;}catch(error){rawErrors.push({threadId:connection.threadId,code:error.code,errno:error.errno,sqlState:error.sqlState,sql});throw error;} } };
      const result = await work(tx); await beforeCommit?.(); await connection.commit(); return result;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } };
}
async function setupSchema() {
  if (!enabled) return;
  assert.match(schemaName ?? "", /^erp_inventory_task041_draftlock_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET ?? "", /^\/private\/tmp\/erp-inventory-task041-draftlock-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  pool = mysql.createPool({ user: "root", database: schemaName, socketPath: process.env.DB_SOCKET, connectionLimit: 6 });
  pool.on('connection',connection=>{allConnections.set(connection.threadId,connection.stream);connection.stream.once('close',()=>closedConnections.add(connection.threadId));});
  const [[environment]] = await pool.query("SELECT VERSION() AS version, DATABASE() AS schema_name, @@skip_networking AS isolated");
  assert.equal(environment.version, "26.7.0"); assert.equal(environment.schema_name, schemaName); assert.equal(Number(environment.isolated), 1);
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
  for (const id of [1, 2, 3, 4, 5]) await pool.execute("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,1,1)", [id, `SYN-${id}`, `syn-${id}`, `Synthetic ${id}`]);
  await pool.query("INSERT INTO inventory_lots (id,sku_id,lot_number,normalized_lot_number,first_receipt_date,sku_code_snapshot,created_at) VALUES (1,13,'LOT-13','lot-13','2026-10-12','SKU-13',1)");
  await pool.query("INSERT INTO users VALUES (8,'synthetic-stocktake-peer','active')");await pool.query('INSERT INTO user_roles VALUES (8,1)');
  database = transactionDatabase(); service = new InventoryStocktakeService({ database, logger, time });
}
async function bin(warehouse = 1) {
  const code = randomUUID();
  return (await pool.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?,1,1)", [warehouse, code, code]))[0].insertId;
}
async function balance(binId, quantity = 3, status = "AVAILABLE", sku = 12, lot = null) {
  return (await pool.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,created_at,updated_at) VALUES (1,?,?,?,?,?,1,1)", [binId, sku, lot, status, quantity]))[0].insertId;
}
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
      WHERE t.processlist_id = ? AND l.object_schema = ? AND l.object_name = 'inventory_warehouses'`, [threadId, schemaName]);
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
  } finally { release.resolve(); await Promise.all([first, ...(second ? [second] : [])]); }
  const results = await Promise.all([first, second]); assert.ok(held); return results;
}
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { InventoryReservationService } from '../../src/modules/inventory/InventoryReservationService.js';
let originalClass;
async function legacyClass(){if(originalClass)return originalClass;const bytes=await readFile(new URL('../../../docs/inventory_management/implementation/hd231-before/InventoryStocktakeService.js.txt',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),'ec949b058b79babc023d9baf6581b861c9867985ede00020ba66a9447a676725');const code=bytes.toString().replace(/from "(\.[^"]+)"/gu,(_s,path)=>'from "'+new URL(path,new URL('../../src/modules/inventory/InventoryStocktakeService.js',import.meta.url)).href+'"');originalClass=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).InventoryStocktakeService;return originalClass;}


async function closePoolAndObserve(){if(!pool)return;await pool.end();const until=Date.now()+5000;while((closedConnections.size!==allConnections.size||[...allConnections.values()].some(x=>!x.destroyed))&&Date.now()<until)await setImmediate();assert.ok([...allConnections.values()].every(x=>x.destroyed)&&closedConnections.size===allConnections.size,'owned pool actual close events terminal');pool=null;}
before(async()=>{if(!enabled)return;assert.match(baseSchema,/^erp_inventory_task041_draftlock_[a-z0-9_]+$/u);owner=await mysql.createConnection({socketPath:process.env.DB_SOCKET,user:'root',database:baseSchema,connectTimeout:2000});});
beforeEach(async()=>{if(!enabled)return;caseNumber++;schemaName=caseNumber===1?baseSchema:baseSchema+'_d'+caseNumber;assert.ok(schemaName===baseSchema||schemaName.startsWith(baseSchema+'_d'));if(caseNumber!==1)await owner.query('CREATE DATABASE `'+schemaName+'`');allConnections.clear();closedConnections.clear();rawErrors.length=0;await setupSchema();observations.push({kind:'FRESH_OWNED_CASE_SCHEMA',schema:schemaName,immutableAuditPreserved:true});});
afterEach(async()=>{if(!enabled||!pool)return;let snapshotError;try{observations.push({kind:'CASE_FINAL_FULL_SNAPSHOT',schema:schemaName,snapshot:await snapshot(),rawErrors:[...rawErrors]});}catch(error){snapshotError=error;observations.push({kind:'CASE_SNAPSHOT_ERROR',schema:schemaName,error:{code:error.code,message:error.message}});}await closePoolAndObserve();const [[terminal]]=await owner.query('SELECT (SELECT COUNT(*) FROM information_schema.innodb_trx) AS tx,(SELECT COUNT(*) FROM performance_schema.data_locks WHERE object_schema=?) AS locks',[schemaName]);assert.deepEqual(Object.values(terminal).map(Number),[0,0]);observations.push({kind:'CASE_SQL_TERMINAL',schema:schemaName,sql:terminal,connectionIds:[...allConnections.keys()],actualCloseIds:[...closedConnections]});if(caseNumber!==1){await owner.query('DROP DATABASE `'+schemaName+'`');observations.push({kind:'OWN_CASE_SCHEMA_DROPPED',schema:schemaName});}if(snapshotError)throw snapshotError;});
after(async()=>{if(!enabled)return;try{await closePoolAndObserve();}finally{if(owner)await owner.end();if(process.env.HARNESS_RUN_DIR)await writeFile(process.env.HARNESS_RUN_DIR+'/draft-lock-range-observations.json',JSON.stringify({kind:'ACTUAL_SMALL_NATIVE_DEVELOPMENT_OBSERVATIONS',observations,rawErrors,allOwnedDriverStreamsDestroyed:[...allConnections.values()].every(x=>x.destroyed),allOwnedDriverCloseObserved:closedConnections.size===allConnections.size},null,2)+'\n',{flag:'wx',mode:0o600});}});

function cmd(action,payload,actor=7,event=randomUUID()){return inventoryCommandFixture({actor:{userId:actor,claimedPermissions:claims},authorization:{purpose:'stocktake.'+action,requiredCallerPermission:'inventory.operation'},source:{module:'INVENTORY',documentType:'STOCKTAKE',documentId:event,eventId:event},correlationId:event,payload});}
async function fixedBin(id,wh){await pool.execute('INSERT INTO inventory_bins (id,warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?,?,1,1)',[id,wh,'D-'+id,'d-'+id]);return id;}
async function history(){const ids=[];for(let id=801;id<=1000;id++)ids.push(await fixedBin(id,5));let h=await service.create(cmd('create',{warehouseId:5,binIds:ids}));await service.start(cmd('start',{stocktakeId:h.id,expectedVersion:1}));
 for(let i=0;i<60;i++){const wh=i>=58?i-57:i%5+1;await fixedBin(i+1,wh);h=await service.create(cmd('create',{warehouseId:wh,binIds:[i+1]}));if(i<58)await service.cancelDraft(cmd('cancel',{stocktakeId:h.id,expectedVersion:1,reason:'Synthetic history'}));}
}
async function cycle(Class){await history();await fixedBin(61,1);await fixedBin(62,2);const h=await service.create(cmd('create',{warehouseId:2,binIds:[62]},8));await pool.query('ANALYZE TABLE inventory_stocktakes,inventory_stocktake_bins,inventory_bin_locks');
 const [headerPlan]=await pool.query("EXPLAIN SELECT * FROM inventory_stocktakes WHERE warehouse_id=? AND (status IN ('DRAFT','COUNTING','READY_TO_POST') OR id=?) ORDER BY id FOR UPDATE",[2,h.id]);observations.push({kind:'SMALL_FIXTURE_ACTUAL_STATISTICS_AND_HEADER_PLAN',tables:'Only owned fixture; no SQL hint or DB setting change',headerPlan});
 const a=cmd('create',{warehouseId:1,binIds:[61]}),b=cmd('start',{stocktakeId:h.id,expectedVersion:1},8);
 const reached=latch(),release=latch();let aThread,bThread,second,mode='NOT_REACHED',released=false;const go=()=>{released=true;release.resolve();};
 const aDb=transactionDatabase({afterExecute:async(sql,tx)=>{if(sql.includes('INSERT INTO inventory_stocktakes')){aThread=tx.threadId;reached.resolve();await release.promise;}}}),bDb=transactionDatabase({beforeQuery:async(_sql,tx)=>{bThread=tx.threadId;},afterQuery:async sql=>{if(!released&&sql.includes('FROM inventory_stocktake_bins')&&sql.includes('stocktake_id IN (')&&sql.includes('FOR UPDATE')){mode='ORIGINAL_SCOPE_CHECKPOINT_REACHED';go();}}});
 const first=new Class({database:aDb,logger,time}).create(a).then(value=>({value}),error=>({error:{code:error.code,message:error.message}}));let observationError,results;
 try{await Promise.race([reached.promise,first.then(x=>{throw Error('Create ended before header barrier: '+JSON.stringify(x));})]);second=new InventoryStocktakeService({database:bDb,logger,time}).start(b).then(value=>({value}),error=>({error:{code:error.code,message:error.message}}));const deadline=Date.now()+4000;
  while(Date.now()<deadline){if(released)break;if(bThread){const [waits]=await pool.query({sql:'SELECT r.processlist_id AS requester,b.processlist_id AS blocker,l.object_name,l.index_name,l.lock_mode FROM performance_schema.data_lock_waits w JOIN performance_schema.threads r ON r.thread_id=w.requesting_thread_id JOIN performance_schema.threads b ON b.thread_id=w.blocking_thread_id JOIN performance_schema.data_locks l ON l.engine_lock_id=w.requesting_engine_lock_id AND l.engine=w.engine WHERE r.processlist_id=? AND b.processlist_id=? AND l.object_schema=?',timeout:Math.max(1,deadline-Date.now())},[bThread,aThread,schemaName]);if(waits.length){mode='OBSERVED_EARLIER_SQL_SERIALIZATION';observations.push({kind:'EARLIER_CREATE_START_SQL_WAIT',waits});go();break;}}await setImmediate();}
  assert.ok(released,'Neither scope checkpoint nor actual SQL wait was observed');
 }catch(error){observationError=error;}finally{go();results=await Promise.all([first,...(second?[second]:[])]);}
 const [[status]]=await pool.query('SHOW ENGINE INNODB STATUS');const [ops]=await pool.query('SELECT id,source_document_id,completed_at FROM inventory_operation_requests WHERE source_document_id IN (?,?)',[a.source.documentId,b.source.documentId]);const [headers]=await pool.query('SELECT s.id,b.bin_id,s.status FROM inventory_stocktakes s JOIN inventory_stocktake_bins b ON b.stocktake_id=s.id WHERE b.bin_id IN (61,62)');observations.push({kind:'CONTROLLED_CREATE_START',legacy:Class!==InventoryStocktakeService,results,ops,headers,rawErrors:[...rawErrors],releaseMode:mode,graph:rawErrors.some(x=>x.code==='ER_LOCK_DEADLOCK')?status.Status:null});if(observationError)throw observationError;return{results,ops,headers};}
async function rejectedUnchanged(work,expected){const before=await snapshot();await assert.rejects(work,expected);const after=await snapshot();observations.push({kind:"NEGATIVE_FULL_TABLE_SNAPSHOT",before,after});assert.deepEqual(after,before);}
async function terminalScope(id=1){const b=await bin();const h=await service.create(cmd('create',{warehouseId:1,binIds:[b]}));await service.cancelDraft(cmd('cancel',{stocktakeId:h.id,expectedVersion:1,reason:'seed terminal'}));return{b,h,id};}

integrationTest('DL-D01 pinned original SQL exact scope INSERT1213 negative control',async()=>{const r=await cycle(await legacyClass());assert.equal(r.results[0].error?.code,'CONCURRENT_OPERATION');assert.ok(r.results[1].value);assert.ok(rawErrors.some(x=>x.code==='ER_LOCK_DEADLOCK'&&x.sql.includes('INSERT INTO inventory_stocktake_bins')));assert.equal(r.ops.length,1);assert.equal(r.headers.some(x=>x.bin_id===61),false);assert.match(observations.at(-1).graph,/uq_inventory_bin_active_lock/u);assert.match(observations.at(-1).graph,/uq_inventory_stocktake_bin/u);});

integrationTest('DL-D02 current product controlled same schedule commits both operations and full scopes',async()=>{const r=await cycle(InventoryStocktakeService);assert.ok(r.results.every(x=>x.value));assert.equal(r.ops.length,2);assert.ok(r.ops.every(x=>x.completed_at!==null));assert.deepEqual(r.headers.map(x=>Number(x.bin_id)).sort((a,b)=>a-b),[61,62]);assert.equal(rawErrors.length,0);});
integrationTest('DL-D03 natural cross warehouse mixed history Create Start both commit',async()=>{await history();const bins=[await bin(1),await bin(2)],h=await service.create(cmd('create',{warehouseId:2,binIds:[bins[1]]},8));const events=[];const db=transactionDatabase({beforeQuery:async(sql,tx)=>events.push({threadId:tx.threadId,method:'query',sql,at:performance.now()}),beforeExecute:async(sql,tx)=>events.push({threadId:tx.threadId,method:'execute',sql,at:performance.now()})});const startAt=performance.now();const svc=new InventoryStocktakeService({database:db,logger,time}),r=await Promise.all([svc.create(cmd('create',{warehouseId:1,binIds:[bins[0]]})),svc.start(cmd('start',{stocktakeId:h.id,expectedVersion:1},8))]);assert.deepEqual(r.map(x=>x.status),['DRAFT','COUNTING']);assert.equal(rawErrors.length,0);observations.push({kind:'NATURAL_MIXED_CREATE_START',elapsedMs:performance.now()-startAt,sqlCount:events.length,events,waits:'No forced barrier; SQLwall measurements include any natural wait, no independent positive wait claim'});});

integrationTest('DL-D04 multiBin all scope inserts precede late active lock; full rollback',async()=>{const f=await terminalScope();await pool.execute("INSERT INTO inventory_bin_locks (bin_id,lock_type,stocktake_id,stocktake_bin_id,locked_at,locked_by) SELECT bin_id,'STOCKTAKE',stocktake_id,id,1,7 FROM inventory_stocktake_bins WHERE stocktake_id=?",[f.h.id]);const other=await bin();let inserted=0,reads=0;const db=transactionDatabase({afterExecute:async sql=>{if(sql.includes('INSERT INTO inventory_stocktake_bins'))inserted++;},beforeQuery:async sql=>{if(sql.includes('FROM inventory_bin_locks')){reads++;assert.equal(inserted,2);}}});await rejectedUnchanged(()=>new InventoryStocktakeService({database:db,logger,time}).create(cmd('create',{warehouseId:1,binIds:[f.b,other]})),{code:'BIN_LOCKED_BY_STOCKTAKE'});assert.equal(inserted,2);assert.equal(reads,1);});

integrationTest('DL-D05 sameBin concurrent Create has one Draft winner no orphan',async()=>{const b=await bin(),r=await Promise.allSettled([service.create(cmd('create',{warehouseId:1,binIds:[b]})),service.create(cmd('create',{warehouseId:1,binIds:[b]},8))]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await pool.query('SELECT * FROM inventory_stocktakes'))[0].length,1);assert.equal((await pool.query('SELECT * FROM inventory_operation_requests'))[0].length,1);});
integrationTest('DL-D06 actual Warehouse wait Replace Create sees latest committed Draft scope',async()=>{for(const replaceFirst of [true,false]){const bins=[await bin(),await bin()],h=await service.create(cmd('create',{warehouseId:1,binIds:[bins[0]]}));const replace=db=>new InventoryStocktakeService({database:db,logger,time}).update(cmd('update',{stocktakeId:h.id,expectedVersion:1,binIds:bins}));const create=db=>new InventoryStocktakeService({database:db,logger,time}).create(cmd('create',{warehouseId:1,binIds:[bins[1]]},8));const r=await ordered(replaceFirst?replace:create,replaceFirst?create:replace);assert.ok(r[0].value);assert.equal(r[1].error?.code,'STOCKTAKE_STATE_CONFLICT');const [rows]=await pool.query('SELECT bin_id,COUNT(*) AS n FROM inventory_stocktake_bins WHERE bin_id IN (?,?) GROUP BY bin_id',bins);assert.ok(rows.every(x=>Number(x.n)===1));observations.push({kind:'ACTUAL_REPLACE_CREATE_WAIT_CURRENT_READ',replaceFirst,results:r.map(x=>x.value??{code:x.error.code})});}});

integrationTest('DL-D07 real sameBin Warehouse wait Start first and conflicting Create first',async()=>{for(const firstStart of [true,false]){const a=await bin(),h=await service.create(cmd('create',{warehouseId:1,binIds:[a]}));const start=db=>new InventoryStocktakeService({database:db,logger,time}).start(cmd('start',{stocktakeId:h.id,expectedVersion:1},8));const create=db=>new InventoryStocktakeService({database:db,logger,time}).create(cmd('create',{warehouseId:1,binIds:[a]}));const r=await ordered(firstStart?start:create,firstStart?create:start);assert.equal(r[firstStart?1:0].error?.code,'STOCKTAKE_STATE_CONFLICT');assert.equal(r[firstStart?0:1].value.status,'COUNTING');const owned=await rows('inventory_bin_locks',h.id);assert.equal(owned.length,1);assert.equal(Number(owned[0].bin_id),a);assert.equal(owned[0].released_at,null);observations.push({kind:'SAME_BIN_START_CREATE_WAREHOUSE_WAIT',firstStart,header:h.id,bin:a});}});

integrationTest('DL-D08 Draft permits Receipt; started locks block Receipt Issue and Move',async()=>{const a=await bin(),b=await bin(),stock=await balance(a,20);const reservations=new InventoryReservationService({database,logger,time});const input=(purpose,payload)=>inventoryCommandFixture({actor:{claimedPermissions:claims},authorization:{purpose,requiredCallerPermission:'inventory.operation'},source:{module:'INVENTORY',documentType:'DIAGNOSTIC',eventId:randomUUID()},payload});const reserved=await reservations.create(input('reservation.create',{skuId:12,warehouseId:1,quantity:2,purpose:'SALE',minimumRemainingDays:0}));const allocation=await reservations.allocate(input('allocation.create',{reservationId:reserved.id,expectedVersion:reserved.version,allocations:[{balanceId:stock,expectedVersion:1,quantity:2}]}));const h=await service.create(cmd('create',{warehouseId:1,binIds:[a]}));const posting=new InventoryPostingService({database,logger,time});await posting.postReceipt(receipt(a));await service.start(cmd('start',{stocktakeId:h.id,expectedVersion:1}));await rejectedUnchanged(()=>posting.postReceipt(receipt(a)),{code:'BIN_LOCKED_BY_STOCKTAKE'});const [[row]]=await pool.query('SELECT version FROM inventory_stock_balances WHERE id=?',[stock]);await rejectedUnchanged(()=>posting.postBinMove(input('bin_move.post',{warehouseId:1,reason:'blocked',lines:[{sourceBalanceId:stock,destinationBinId:b,quantity:1,expectedSourceVersion:Number(row.version),expectedDestinationVersion:null}]})),{code:'BIN_LOCKED_BY_STOCKTAKE'});await rejectedUnchanged(()=>posting.postIssue(input('issue.post',{reservationId:reserved.id,expectedVersion:allocation.version,lines:allocation.allocations.map(x=>({allocationId:x.id,expectedVersion:x.version,balanceId:x.balanceId,expectedBalanceVersion:Number(row.version),quantity:1}))})),{code:'BIN_LOCKED_BY_STOCKTAKE'});});
integrationTest('DL-D09 stale initial auth rejected by prewrite current read; late revoker serializes',async()=>{const b=await bin(),initial=latch(),go=latch();let paused=false;const firstDb=transactionDatabase({afterQuery:async sql=>{if(!paused&&sql.includes('FROM users')&&!sql.includes('FOR SHARE')){paused=true;initial.resolve();await go.promise;}}});let initialObservationError;const first=new InventoryStocktakeService({database:firstDb,logger,time}).create(cmd('create',{warehouseId:1,binIds:[b]}));const settled=first.then(value=>({value}),error=>({error}));try{await Promise.race([initial.promise,settled.then(x=>{throw x.error??Error('Initial auth barrier not reached');})]);await pool.query("UPDATE users SET status='inactive' WHERE id=7");}catch(error){initialObservationError=error;}finally{go.resolve();await settled;}if(initialObservationError)throw initialObservationError;const rejected=await settled;assert.equal(rejected.error?.code,'PERMISSION_STALE');assert.equal((await pool.query('SELECT * FROM inventory_stocktakes'))[0].length,0);assert.equal((await pool.query('SELECT * FROM inventory_operation_requests'))[0].length,0);await pool.query("UPDATE users SET status='active' WHERE id=7");
 const reached=latch(),release=latch(),events=[];let binPaused=false;const db=transactionDatabase({afterQuery:async sql=>{events.push({kind:'query',sql});if(sql.includes('FROM inventory_bin_locks')&&!binPaused){binPaused=true;reached.resolve();await release.promise;}},beforeExecute:async sql=>events.push({kind:'execute',sql})});const work=new InventoryStocktakeService({database:db,logger,time}).create(cmd('create',{warehouseId:1,binIds:[b]}));const outcome=work.then(value=>({value}),error=>({error}));let revoker,revoke;try{await Promise.race([reached.promise,outcome.then(x=>{throw x.error??Error('Final bin read pause not reached');})]);revoker=await pool.getConnection();await revoker.beginTransaction();revoke=revoker.query("UPDATE users SET status='inactive' WHERE id=7");const limit=Date.now()+5000;let waited=false;while(Date.now()<limit){const [[row]]=await pool.query({sql:'SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.thread_id=w.requesting_thread_id WHERE t.processlist_id=?',timeout:Math.max(1,limit-Date.now())},[revoker.threadId]);if(Number(row.n)>0){waited=true;break;}await setImmediate();}assert.ok(waited,'actual auth-row SQL wait required');release.resolve();const complete=await outcome;assert.ok(complete.value?.id);await revoke;await revoker.commit();const binRead=events.findIndex(x=>x.sql.includes('FROM inventory_bin_locks')),auth=events.map((x,i)=>({x,i})).filter(x=>x.x.sql.includes('FROM users')&&x.x.sql.includes('FOR SHARE')),audit=events.findIndex(x=>x.sql.includes('INSERT INTO inventory_audit_logs'));assert.equal(auth.length,2);assert.ok(auth[0].i<binRead&&auth[1].i>binRead&&audit>auth[1].i);observations.push({kind:'AUTH_ROW_WAIT_AFTER_PREWRITE_SHARE',revokerThread:revoker.threadId,events,controlledPause:'after active-bin read, not active-bin SQL wait'});}finally{release.resolve();await outcome;if(revoke)await revoke.catch(()=>{});if(revoker){await revoker.rollback();revoker.release();}}});

integrationTest('DL-D10 concurrent same source replay is original once; changed body conflicts',async()=>{const b=await bin(),input=cmd('create',{warehouseId:1,binIds:[b]});const r=await Promise.all([service.create(input),service.create(input)]);assert.deepEqual(r[0],r[1]);assert.equal((await pool.query('SELECT * FROM inventory_stocktakes'))[0].length,1);await assert.rejects(()=>service.create({...input,payload:{...input.payload,reason:'different'}}));});
integrationTest('DL-D11 header secondscope latecheck Audit completion faults each roll back',async()=>{for(const pattern of [/INSERT INTO inventory_stocktakes/u,/INSERT INTO inventory_stocktake_bins/u,/FROM inventory_bin_locks/u,/INSERT INTO inventory_audit_logs/u,/UPDATE inventory_operation_requests/u]){const bins=[await bin(),await bin()];let scopes=0;const fail=sql=>{if(pattern.test(sql)&&(!sql.includes('INSERT INTO inventory_stocktake_bins')||++scopes===2))throw Error('Injected same-tx fault');};const db=transactionDatabase({beforeQuery:fail,beforeExecute:fail});await rejectedUnchanged(()=>new InventoryStocktakeService({database:db,logger,time}).create(cmd('create',{warehouseId:1,binIds:bins})),/Injected/u);}});
integrationTest('DL-D12 inactive Warehouse Bin and mismatch reject complete transaction',async()=>{const a=await bin(),b=await bin(2);await rejectedUnchanged(()=>service.create(cmd('create',{warehouseId:1,binIds:[b]})),{code:'BIN_WAREHOUSE_MISMATCH'});await pool.query("UPDATE inventory_bins SET status='INACTIVE' WHERE id=?",[a]);await rejectedUnchanged(()=>service.create(cmd('create',{warehouseId:1,binIds:[a]})),{code:'BIN_INVALID'});await pool.query("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=1");await rejectedUnchanged(()=>service.create(cmd('create',{warehouseId:1,binIds:[a]})),{code:'WAREHOUSE_INVALID'});await pool.query("UPDATE inventory_warehouses SET status='ACTIVE'");});
integrationTest('DL-D13 foreign locks and all untouched tables survive failed create',async()=>{const a=await bin(2),h=await service.create(cmd('create',{warehouseId:2,binIds:[a]},8));await service.start(cmd('start',{stocktakeId:h.id,expectedVersion:1},8));const own=await bin();const before=await snapshot();const db=transactionDatabase({beforeExecute:async sql=>{if(sql.includes('INSERT INTO inventory_stocktake_bins'))throw Error('scope failure');}});await assert.rejects(()=>new InventoryStocktakeService({database:db,logger,time}).create(cmd('create',{warehouseId:1,binIds:[own]})));assert.deepEqual(await snapshot(),before);});
integrationTest('DL-D14 independent transport closes and actual SQL transaction lock terminal',async()=>{const connection=await mysql.createConnection({user:'root',database:schemaName,socketPath:process.env.DB_SOCKET});const id=connection.threadId,stream=connection.connection.stream;let closed=false,primary;stream.once('close',()=>closed=true);try{await connection.beginTransaction();await connection.query('SELECT * FROM inventory_warehouses WHERE id=1 FOR UPDATE');await connection.rollback();}catch(error){primary=error;}finally{try{await connection.end();}catch(error){connection.destroy();primary??=error;}const deadline=Date.now()+5000;while(Date.now()<deadline){if(closed)break;await setImmediate();}if(!closed){connection.destroy();primary??=Error('Owned independent socket close unknown');}}if(primary)throw primary;assert.ok(closed&&stream.destroyed);const [[state]]=await pool.query('SELECT (SELECT COUNT(*) FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?) AS tx,(SELECT COUNT(*) FROM performance_schema.threads WHERE processlist_id=?) AS threads,(SELECT COUNT(*) FROM performance_schema.data_locks WHERE object_schema=?) AS locks',[id,id,schemaName]);assert.deepEqual(Object.values(state).map(Number),[0,0,0]);observations.push({kind:'INDEPENDENT_TRANSPORT_TERMINAL',connectionId:id,closed,sql:state,notClaimed:'All process/runtime cleanup checked separately by external coordinator'});});

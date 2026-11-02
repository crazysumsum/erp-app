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
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { issueInventoryHighRiskContext } from "../../src/modules/inventory/inventoryHighRiskContext.js";
import { issueInventoryStocktakeCancelContext } from "../../src/modules/inventory/inventoryStocktakeCancelContext.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled=process.env.DB_INTEGRATION_TESTS==="1"&&process.env.INVENTORY_STOCKTAKE_FLOW_TESTS==="1";
const integrationTest=(name,work)=>test(name,{skip:!enabled,timeout:60000},work);
const NOW=1791763200000,time={nowMs:()=>NOW,fileDate:()=>"2026-10-12"},logger={error(){}};
let pool,database,service;
const counterPermissions=["inventory.view","inventory.operation"],postPermissions=["inventory.view","inventory.adjust"];
const binding={id:5,user_id:8,device_id:"a".repeat(64),public_key:Buffer.from("synthetic-public-key"),status:"approved"};
const businessTables=["inventory_stocktakes","inventory_stocktake_bins","inventory_bin_locks","inventory_stocktake_lines","inventory_stock_balances","inventory_stock_controls","inventory_lots","inventory_movements","inventory_reservations","inventory_allocations","inventory_operation_requests","inventory_audit_logs"];
function latch(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function transactionDatabase({beforeQuery,afterQuery,beforeExecute,beforeCommit}={}) {
  return {query:(...args)=>pool.query(...args),async withTransaction(work){const connection=await pool.getConnection();
    try{await connection.query("SET SESSION innodb_lock_wait_timeout=5");await connection.beginTransaction();
      const tx={threadId:connection.threadId,async query(sql,params){await beforeQuery?.(sql,tx);const result=await connection.query(sql,params);await afterQuery?.(sql,tx);return result;},
        async execute(sql,params){await beforeExecute?.(sql,tx);return connection.execute(sql,params);}};
      const result=await work(tx);await beforeCommit?.();await connection.commit();return result;
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}}
  };
}
function options(db=database,clock=time){return {database:db,logger,time:clock};}
before(async()=>{
  if(!enabled)return;
  assert.match(process.env.DB_NAME??"",/^erp_inventory_task038_[a-z0-9_]+$/u);assert.match(process.env.DB_SOCKET??"",/^\/private\/tmp\/erp-inventory-task038-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  pool=mysql.createPool({user:"root",database:process.env.DB_NAME,socketPath:process.env.DB_SOCKET,connectionLimit:8});
  const [[environment]]=await pool.query("SELECT VERSION() AS version,DATABASE() AS schema_name,@@skip_networking AS isolated");
  assert.equal(environment.version,"26.7.0");assert.equal(environment.schema_name,process.env.DB_NAME);assert.equal(Number(environment.isolated),1);assert.equal((await pool.query("SHOW TABLES"))[0].length,0,"fresh owned schema, never reset shared data");
  for(const ddl of [
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
  ])await pool.query(ddl);
  for(const migrate of [permissions,operations,audit,master,stock,movements,reservations,transfers,stocktakes])await migrate(pool);
  await pool.query("INSERT INTO users VALUES (7,'synthetic-counter','active'),(8,'synthetic-approver','active')");
  await pool.query("INSERT INTO roles VALUES (1,'warehouse-operator'),(2,'warehouse-approver')");await pool.query("INSERT INTO user_roles VALUES (7,1),(8,2)");
  await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name IN ('inventory.view','inventory.operation')");
  await pool.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");
  await pool.query("INSERT INTO fr_token_versions VALUES ('7',0),('8',0)");
  await pool.execute("INSERT INTO user_devices VALUES (?,?,?,?,?)",[binding.id,binding.user_id,binding.device_id,binding.public_key,binding.status]);
  await pool.query("INSERT INTO items (id,name,product_type,status) VALUES (1,'Synthetic','physical','active')");
  await pool.query(`INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy,min_receipt_life_days,min_sale_life_days) VALUES
    (12,1,'SKU-12','Plain','active','none',NULL,NULL),(13,1,'SKU-13','Lot','active','batch',NULL,NULL),(14,1,'SKU-14','Expiry','active','batch_expiry',90,30),
    (15,1,'SKU-15','Serial','active','serial',NULL,NULL),(16,1,'SKU-16','Nontracked','active','none',NULL,NULL),(17,1,'SKU-17','Inactive','inactive','none',NULL,NULL),
    (18,1,'SKU-18','Boundary','active','none',NULL,NULL),(19,1,'SKU-19','Fresh Control','active','none',NULL,NULL)`);
  await pool.query("UPDATE item_skus SET inventory_tracked=0 WHERE id=16");await pool.query("INSERT INTO item_uoms (id,code,name,status) VALUES (1,'EA','Each','active')");
  for(const sku of [12,13,14,15,16,17,18,19])await pool.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (?,1,1,1,1,1)",[sku]);
  for(const id of [1,2])await pool.execute("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,1,1)",[id,`SYN-${id}`,`syn-${id}`,`Synthetic ${id}`]);
  await pool.query(`INSERT INTO inventory_lots (id,sku_id,lot_number,normalized_lot_number,first_receipt_date,expiry_date,sku_code_snapshot,created_at) VALUES
    (1,13,'LOT','lot','2026-01-01',NULL,'SKU-13',1),(2,14,'EXPIRED','expired','2020-01-01','2020-02-01','SKU-14',1),
    (3,14,'SHORT','short','2026-10-01','2026-10-13','SKU-14',1),(4,14,'NO-EXPIRY','no-expiry','2026-10-01',NULL,'SKU-14',1)`);
  database=transactionDatabase();service=new InventoryStocktakeService(options());
});
after(async()=>{if(pool)await pool.end();});
function command(action,payload,eventId=randomUUID()) {
  const high=action==="post";
  return inventoryCommandFixture({actor:{userId:high?8:7,claimedRoles:[high?"warehouse-approver":"warehouse-operator"],claimedPermissions:high?postPermissions:counterPermissions},
    authorization:{purpose:`stocktake.${action}`,requiredCallerPermission:high?"inventory.adjust":"inventory.operation"},source:{module:"INVENTORY",documentType:"STOCKTAKE",documentId:"synthetic-task038",eventId},correlationId:eventId,payload});
}
function capsule(action,input,{clock=time,reqChanges={},claimsChanges={}}={}) {
  const high=action==="post",authType=high?"jwt-device-password":"jwt-password",actor=input.actor;
  const req={method:"POST",apiRoute:{path:`/api/v1/inventory/stocktakes/:id/${action}`,authType},input:{params:{id:String(input.payload.stocktakeId)}},get:()=>String(NOW),
    auth:{type:authType,claims:{sub:String(actor.userId),roles:actor.claimedRoles,permissions:actor.claimedPermissions,ver:0,exp:NOW/1000+900,auth_time:NOW/1000,...(high?{did:binding.device_id}:{}),...claimsChanges},...(high?{deviceBinding:binding}:{})},...reqChanges};
  return (high?issueInventoryHighRiskContext:issueInventoryStocktakeCancelContext)(req,input,{time:clock,signatureMaxSkewSeconds:60,sessionMaxAgeSeconds:3600,clockToleranceSeconds:0});
}
async function bin(warehouse=1){const code=randomUUID();return Number((await pool.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?,1,1)",[warehouse,code,code]))[0].insertId);}
async function balance(binId,quantity=4,status="AVAILABLE",sku=12,lot=null){return Number((await pool.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (1,?,?,?,?,?,?,1,1)",[binId,sku,lot,status,quantity,quantity===0?null:"2026-01-01"]))[0].insertId);}
async function rows(table,id){return (await pool.execute(`SELECT * FROM ${table} WHERE stocktake_id=? ORDER BY id`,[id]))[0];}
async function snapshot(){const result={};for(const table of businessTables)result[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}
async function unchanged(work,expected){const before=await snapshot();await assert.rejects(work,expected);assert.deepEqual(await snapshot(),before);}
async function operation(id){return (await pool.execute("SELECT * FROM inventory_operation_requests WHERE id=?",[id]))[0][0];}
async function operationAudits(id){return (await pool.execute("SELECT * FROM inventory_audit_logs WHERE operation_request_id=? ORDER BY id",[id]))[0];}
async function counting(entries=[{}]) {
  const bins=[],ids=[];for(const entry of entries){const id=entry.binId??await bin();if(!bins.includes(id))bins.push(id);ids.push(await balance(id,entry.quantity??4,entry.status??"AVAILABLE",entry.sku??12,entry.lot??null));}
  const draft=await service.create(command("create",{warehouseId:1,binIds:bins})),header=await service.start(command("start",{stocktakeId:draft.id,expectedVersion:1}));
  return {header,bins,balances:ids,lines:await rows("inventory_stocktake_lines",header.id)};
}
function countRequest(f,quantities=f.lines.map(()=>7)){return command("count",{stocktakeId:f.header.id,lines:f.lines.map((row,index)=>({lineId:Number(row.id),expectedVersion:Number(row.version),...(quantities[index]===null?{notFound:true}:{countedQuantity:quantities[index]})}))});}
function workflow(action,f,changes={}){return command(action,{stocktakeId:f.header.id,expectedVersion:f.header.version,...(action==="ready"?{}:{reason:"synthetic physical reconciliation"}),...changes});}
async function readyFixture(entries,quantities){const f=await counting(entries);await service.saveCounts(countRequest(f,quantities));f.header=await service.ready(workflow("ready",f));f.lines=await rows("inventory_stocktake_lines",f.header.id);return f;}
async function submit(action,f,{input=workflow(action,f),db=database,clock=time,proofOptions={}}={}){return new InventoryStocktakeService(options(db,clock))[action](input,capsule(action,input,proofOptions));}
async function waitForWarehouse(threadId){const deadline=Date.now()+5000;do{const [[row]]=await pool.execute(`SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w
  JOIN performance_schema.threads t ON t.thread_id=w.requesting_thread_id JOIN performance_schema.data_locks l ON l.engine_lock_id=w.requesting_engine_lock_id AND l.engine=w.engine
  WHERE t.processlist_id=? AND l.object_schema=? AND l.object_name='inventory_warehouses'`,[threadId,process.env.DB_NAME]);if(Number(row.waiting)>0)return;await setImmediate();}while(Date.now()<deadline);throw new Error("intended Warehouse wait was not observed");}
async function ordered(firstWork,secondWork,whileWaiting=async()=>{}){
  const acquired=latch(),entered=latch(),release=latch();let held=false;
  const firstDb=transactionDatabase({afterQuery:async sql=>{if(!held&&sql.includes("FROM inventory_warehouses")&&sql.includes("FOR UPDATE")){held=true;acquired.resolve();await release.promise;}}});
  const secondDb=transactionDatabase({beforeQuery:async(sql,tx)=>{if(sql.includes("FROM inventory_warehouses")&&sql.includes("FOR UPDATE"))entered.resolve(tx.threadId);}});
  const first=firstWork(firstDb).then(value=>({value}),error=>({error}));let second;
  try{await Promise.race([acquired.promise,first.then(result=>{throw result.error??new Error("first ended before Warehouse barrier");})]);second=secondWork(secondDb).then(value=>({value}),error=>({error}));
    const thread=await Promise.race([entered.promise,second.then(result=>{throw result.error??new Error("second ended before Warehouse wait");})]);await waitForWarehouse(thread);await whileWaiting();
  }finally{release.resolve();}const result=await Promise.all([first,second]);assert.ok(held);return result;
}
async function fault(action,f,pattern,nth=1){let hits=0,reached=false;const db=transactionDatabase({beforeExecute:async sql=>{if(pattern.test(sql)&&++hits===nth){reached=true;throw new Error("intended flow storage fault");}}});
  await unchanged(()=>action==="ready"?new InventoryStocktakeService(options(db)).ready(workflow(action,f)):submit(action,f,{db}),/intended flow storage fault/u);assert.ok(reached,"fault checkpoint must be reached");}

integrationTest("ST038-D01 Ready stores three counted forms and only workflow metadata/scalar Audit",async()=>{
  const f=await counting([{}, {status:"DAMAGED"},{status:"QUARANTINED"}]);await service.saveCounts(countRequest(f,[7,4,null]));const before=await snapshot();
  const result=await service.ready(workflow("ready",f)),lines=await rows("inventory_stocktake_lines",f.header.id);assert.deepEqual(lines.map(row=>Number(row.variance_quantity)),[3,0,-4]);assert.ok(lines.every(row=>Number(row.version)===2));assert.equal(result.rowCount,3);
  const after=await snapshot();for(const table of ["inventory_stock_balances","inventory_stock_controls","inventory_lots","inventory_movements","inventory_bin_locks"])assert.deepEqual(after[table],before[table]);
  assert.equal((await operationAudits(result.operationId)).length,1);assert.equal(Number((await operation(result.operationId)).actor_user_id),7);
});
integrationTest("ST038-D02 incomplete Ready rejects while an explicit empty scope is valid",async()=>{
  const f=await counting([{},{}]);await service.saveCounts(command("count",{stocktakeId:f.header.id,lines:[{lineId:Number(f.lines[0].id),expectedVersion:1,countedQuantity:0}]}));await unchanged(()=>service.ready(workflow("ready",f)),{code:"STOCKTAKE_STATE_CONFLICT"});
  const b=await bin(),draft=await service.create(command("create",{warehouseId:1,binIds:[b]})),started=await service.start(command("start",{stocktakeId:draft.id,expectedVersion:1}));assert.equal((await service.ready(command("ready",{stocktakeId:started.id,expectedVersion:2}))).rowCount,0);
});
integrationTest("ST038-D03 two real Ready requests wait and freeze exactly once",async()=>{
  const f=await counting();await service.saveCounts(countRequest(f));const result=await ordered(db=>new InventoryStocktakeService(options(db)).ready(workflow("ready",f)),db=>new InventoryStocktakeService(options(db)).ready(workflow("ready",f)));
  assert.equal(result[0].value.version,3);assert.equal(result[1].error.code,"VERSION_CONFLICT");assert.equal((await rows("inventory_stocktake_lines",f.header.id))[0].variance_quantity,3);
});
integrationTest("ST038-D04 Count/Ready both wait orders freeze latest count or reject late Count",async()=>{
  for(const countFirst of [true,false]){const f=await counting();await service.saveCounts(countRequest(f,[5]));f.lines=await rows("inventory_stocktake_lines",f.header.id);
    const count=db=>new InventoryStocktakeService(options(db)).saveCounts(countRequest(f,[9])),ready=db=>new InventoryStocktakeService(options(db)).ready(workflow("ready",f));const results=await ordered(countFirst?count:ready,countFirst?ready:count);
    assert.ok(results[0].value);if(countFirst)assert.ok(results[1].value);else assert.equal(results[1].error.code,"STOCKTAKE_STATE_CONFLICT");
    assert.equal(Number((await rows("inventory_stocktake_lines",f.header.id))[0].counted_quantity),countFirst?9:5);
  }
});
integrationTest("ST038-D05 Add/Ready both wait orders never admit an untouched line into Ready",async()=>{
  for(const addFirst of [true,false]){const f=await counting();await service.saveCounts(countRequest(f));const add=db=>new InventoryStocktakeService(options(db)).addLine(command("add_line",{stocktakeId:f.header.id,binId:f.bins[0],skuId:12,lotId:null,stockStatus:"DAMAGED"})),ready=db=>new InventoryStocktakeService(options(db)).ready(workflow("ready",f));
    const results=await ordered(addFirst?add:ready,addFirst?ready:add);assert.ok(results[0].value);assert.equal(results[1].error.code,"STOCKTAKE_STATE_CONFLICT");assert.equal((await rows("inventory_stocktake_lines",f.header.id)).length,addFirst?2:1);}
});
integrationTest("ST038-D06 real Ready later variance/header/Audit/completion/commit faults rollback",async()=>{
  const f=await counting([{},{}]);await service.saveCounts(countRequest(f));for(const [pattern,nth] of [[/SET variance_quantity/u,2],[/SET status = 'READY_TO_POST'/u,1],[/INSERT INTO inventory_audit_logs/u,1],[/SET result_type/u,1]])await fault("ready",f,pattern,nth);
  let reached=false;const db=transactionDatabase({beforeCommit:async()=>{reached=true;throw new Error("intended flow storage fault");}});await unchanged(()=>new InventoryStocktakeService(options(db)).ready(workflow("ready",f)),/intended flow storage fault/u);assert.ok(reached);
});
function holdWarehouse(db){return db.withTransaction(tx=>tx.query("SELECT * FROM inventory_warehouses WHERE id IN (?) ORDER BY id FOR UPDATE",[1]));}
async function restoreAuth(){await pool.query("UPDATE users SET status='active'");await pool.query("UPDATE fr_token_versions SET version=0");await pool.query("DELETE FROM role_permissions");await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name IN ('inventory.view','inventory.operation')");await pool.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");await pool.execute("UPDATE user_devices SET status='approved',public_key=? WHERE id=5",[binding.public_key]);}
integrationTest("ST038-D07 Ready detects actual permission revocation committed during its Warehouse wait",async()=>{
  const f=await counting();await service.saveCounts(countRequest(f));const before=await snapshot();let result;
  try{result=await ordered(holdWarehouse,db=>new InventoryStocktakeService(options(db)).ready(workflow("ready",f)),()=>pool.query("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=1 AND p.name='inventory.operation'"));}finally{await restoreAuth();}
  assert.equal(result[1].error.code,"PERMISSION_STALE");assert.deepEqual(await snapshot(),before);
});
integrationTest("ST038-D08 Cancel actual issuer denies forged auth/method/path/id/actor/changed intent and reuse",async()=>{
  const f=await counting(),input=workflow("cancel",f);
  for(const reqChanges of [{method:"GET"},{apiRoute:{path:"/wrong",authType:"jwt-password"}},{input:{params:{id:"0"}}},{auth:{type:"jwt-device-password"}}])await unchanged(async()=>submit("cancel",f,{input,proofOptions:{reqChanges}}),{code:"PERMISSION_STALE"});
  const proof=capsule("cancel",input),changed={...input,payload:{...input.payload,reason:"changed"}};await unchanged(()=>service.cancel(changed,proof),{code:"PERMISSION_STALE"});
  await service.cancel(input,proof);await unchanged(()=>service.cancel(input,proof),{code:"PERMISSION_STALE"});
});
integrationTest("ST038-D09 Cancel Draft/Counting/Ready keeps scope/history and only owned locks even inactive",async()=>{
  for(const status of ["DRAFT","COUNTING","READY_TO_POST"]){let f;
    if(status==="DRAFT"){const b=await bin();f={header:await service.create(command("create",{warehouseId:1,binIds:[b]})),bins:[b]};}
    else f=status==="COUNTING"?await counting():await readyFixture();
    const beforeLines=await rows("inventory_stocktake_lines",f.header.id),before=await snapshot();
    await pool.query("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=1");await pool.execute("UPDATE inventory_bins SET status='INACTIVE' WHERE id=?",[f.bins[0]]);
    let result;try{result=await submit("cancel",f);}finally{await pool.query("UPDATE inventory_warehouses SET status='ACTIVE' WHERE id=1");await pool.execute("UPDATE inventory_bins SET status='ACTIVE' WHERE id=?",[f.bins[0]]);}
    assert.equal(result.status,"CANCELLED");assert.deepEqual(await rows("inventory_stocktake_lines",f.header.id),beforeLines);assert.ok((await rows("inventory_bin_locks",f.header.id)).every(row=>row.released_at!==null));
    const after=await snapshot();for(const table of ["inventory_stock_balances","inventory_stock_controls","inventory_movements","inventory_reservations","inventory_allocations"])assert.deepEqual(after[table],before[table]);
  }
});
integrationTest("ST038-D10 Cancel missing/released owners reject; real composite FK rejects mismatched owner",async()=>{
  for(const change of ["DELETE FROM inventory_bin_locks WHERE stocktake_id=?","UPDATE inventory_bin_locks SET released_at=1 WHERE stocktake_id=?"]){const f=await counting();await pool.execute(change,[f.header.id]);await unchanged(()=>submit("cancel",f),{code:"STOCKTAKE_STATE_CONFLICT"});}
  const f=await counting(),g=await counting();await assert.rejects(pool.execute("UPDATE inventory_bin_locks SET stocktake_id=? WHERE stocktake_id=?",[g.header.id,f.header.id]),error=>error.code==="ER_NO_REFERENCED_ROW_2");await submit("cancel",f);assert.equal((await rows("inventory_bin_locks",g.header.id))[0].released_at,null);
});
integrationTest("ST038-D11 Cancel rechecks token/user/role/time during actual Warehouse waits",async()=>{
  for(const kind of ["token","user","role","time"]){const f=await counting(),before=await snapshot();let now=NOW;const clock={nowMs:()=>now};let result;
    try{result=await ordered(holdWarehouse,db=>submit("cancel",f,{db,proofOptions:{clock}}),async()=>{
      if(kind==="token")await pool.query("UPDATE fr_token_versions SET version=1 WHERE subject='7'");
      if(kind==="user")await pool.query("UPDATE users SET status='inactive' WHERE id=7");
      if(kind==="role")await pool.query("DELETE FROM role_permissions WHERE role_id=1");
      if(kind==="time")now+=901000;
    });}finally{await restoreAuth();}assert.equal(result[1].error.code,kind==="token"||kind==="time"?"JWT_INVALID":"PERMISSION_STALE");assert.deepEqual(await snapshot(),before);
  }
});
integrationTest("ST038-D12 Cancel/Cancel and Ready/Cancel actual races have one complete outcome",async()=>{
  for(const firstAction of ["cancel","ready"]){const f=await counting();await service.saveCounts(countRequest(f));const run=(action,db)=>action==="ready"?new InventoryStocktakeService(options(db)).ready(workflow(action,f)):submit(action,f,{db});
    const result=await ordered(db=>run(firstAction,db),db=>run("cancel",db));assert.ok(result[0].value);assert.equal(result[1].error.code,"VERSION_CONFLICT");
    assert.equal((await rows("inventory_bin_locks",f.header.id))[0].released_at===null,firstAction==="ready");}
});
integrationTest("ST038-D13 Cancel second release/header/Audit/completion/commit faults leave all own locks",async()=>{
  const f=await counting([{},{}]);for(const [pattern,nth] of [[/UPDATE inventory_bin_locks/u,2],[/SET status = 'CANCELLED'/u,1],[/INSERT INTO inventory_audit_logs/u,1],[/SET result_type/u,1]])await fault("cancel",f,pattern,nth);
  let reached=false;const db=transactionDatabase({beforeCommit:async()=>{reached=true;throw new Error("intended flow storage fault");}});await unchanged(()=>submit("cancel",f,{db}),/intended flow storage fault/u);assert.ok(reached);
});
integrationTest("ST038-D14 Cancel source lookup/replay preserve original scalar and terminal/source conflicts",async()=>{
  const f=await counting(),input=workflow("cancel",f),result=await submit("cancel",f,{input}),before=await snapshot();assert.deepEqual(await submit("cancel",f,{input}),result);assert.deepEqual(await snapshot(),before);
  const found=await new InventoryOperationService().findBySource(pool,{source:input.source});assert.deepEqual(found.resultSummary,result);
  await unchanged(()=>submit("cancel",f),{code:"VERSION_CONFLICT"});const changed={...input,payload:{...input.payload,reason:"other"}};await unchanged(()=>submit("cancel",f,{input:changed}),{code:"INVENTORY_SOURCE_CONFLICT"});
});
integrationTest("ST038-D15 Post issuer fixes route/action/id and rejects forged/mismatched/one-use contexts",async()=>{
  const f=await readyFixture(),input=workflow("post",f);
  for(const reqChanges of [{method:"GET"},{apiRoute:{path:"/api/v1/inventory/adjustments",authType:"jwt-device-password"}},{input:{params:{id:"01"}}},{auth:{type:"jwt-password"}}])await unchanged(async()=>submit("post",f,{input,proofOptions:{reqChanges}}),{code:"PERMISSION_STALE"});
  await unchanged(()=>service.post(input,{}),{code:"PERMISSION_STALE"});const proof=capsule("post",input);const result=await service.post(input,proof);assert.equal(result.status,"POSTED");await unchanged(()=>service.post(input,proof),{code:"PERMISSION_STALE"});
});
integrationTest("ST038-D16 Post actual user/role/JWT/device/key revocation committed during Warehouse wait",async()=>{
  for(const [kind,expected] of [["user","PERMISSION_STALE"],["role","PERMISSION_STALE"],["jwt","JWT_INVALID"],["device","DEVICE_REVOKED"],["key","DEVICE_MISMATCH"]]){const f=await readyFixture(),before=await snapshot();let result;
    try{result=await ordered(holdWarehouse,db=>submit("post",f,{db}),async()=>{
      if(kind==="user")await pool.query("UPDATE users SET status='inactive' WHERE id=8");if(kind==="role")await pool.query("DELETE FROM role_permissions WHERE role_id=2");if(kind==="jwt")await pool.query("UPDATE fr_token_versions SET version=1 WHERE subject='8'");
      if(kind==="device")await pool.query("UPDATE user_devices SET status='revoked' WHERE id=5");if(kind==="key")await pool.query("UPDATE user_devices SET public_key='changed' WHERE id=5");
    });}finally{await restoreAuth();}assert.equal(result[1].error.code,expected);assert.deepEqual(await snapshot(),before);
  }
});
integrationTest("ST038-D17 Post original signed time/session/JWT/abort cannot renew during waits",async()=>{
  for(const [kind,expected] of [["signature","DEVICE_SIGNATURE_STALE"],["jwt","JWT_INVALID"],["session","SESSION_EXPIRED"],["abort","REQUEST_TIMEOUT"]]){const f=await readyFixture(),before=await snapshot();let now=NOW;const clock={nowMs:()=>now};const abort=new AbortController();
    const input=workflow("post",f),proofOptions={clock,reqChanges:{get:()=>String(kind==="signature"?NOW:now),requestTimeout:{signal:abort.signal}}};
    if(kind==="session")proofOptions.claimsChanges={auth_time:NOW/1000-3599};if(kind==="jwt")proofOptions.claimsChanges={exp:NOW/1000+1};
    const result=await ordered(holdWarehouse,db=>submit("post",f,{db,input,proofOptions}),async()=>{if(kind==="signature")now+=60001;if(kind==="jwt"||kind==="session")now+=2000;if(kind==="abort")abort.abort(Object.assign(new Error("intended timeout"),{code:"REQUEST_TIMEOUT"}));});
    assert.equal(result[1].error.code,expected);assert.deepEqual(await snapshot(),before);
  }
});
integrationTest("ST038-D18 mixed statuses and dimensions post one group with exact lines/Audits and release",async()=>{
  const f=await readyFixture([{}, {status:"DAMAGED"},{status:"QUARANTINED"},{sku:13,lot:1}],[7,1,4,6]),before=await snapshot(),result=await submit("post",f);
  assert.equal(result.rowCount,3);const movements=(await pool.execute("SELECT * FROM inventory_movements WHERE operation_request_id=? ORDER BY id",[result.operationId]))[0];assert.equal(movements.length,3);assert.equal(new Set(movements.map(row=>row.movement_group_id)).size,1);assert.ok(movements.every(row=>row.movement_type==="STOCKTAKE_VARIANCE"&&Number(row.stocktake_id)===f.header.id));
  const lines=await rows("inventory_stocktake_lines",f.header.id);assert.deepEqual(lines.map(row=>Number(row.version)),[3,3,2,3]);assert.equal(lines[2].movement_id,null);assert.equal((await operationAudits(result.operationId)).length,4);
  const after=await snapshot();for(const table of ["inventory_reservations","inventory_allocations","inventory_lots"])assert.deepEqual(after[table],before[table]);assert.ok((await rows("inventory_bin_locks",f.header.id)).every(row=>row.released_at!==null));assert.equal(Number((await operation(result.operationId)).actor_user_id),8);
  for(const movement of movements){const line=lines.find(row=>Number(row.id)===Number(movement.stocktake_line_id));assert.equal(Number(movement.quantity),Math.abs(Number(line.variance_quantity)));assert.equal(Number(movement.balance_after),Number(line.counted_quantity));assert.equal(Number(movement.balance_version_after),Number(line.snapshot_balance_version)+1);}
});
integrationTest("ST038-D19 known expired/low-receipt-life physical gains in all three statuses do not alter Lot dates",async()=>{
  const entries=[];for(const lot of [2,3])for(const status of ["AVAILABLE","DAMAGED","QUARANTINED"])entries.push({sku:14,lot,status});
  const f=await readyFixture(entries,entries.map(()=>8)),lots=(await pool.query("SELECT * FROM inventory_lots ORDER BY id"))[0];await submit("post",f);assert.deepEqual((await pool.query("SELECT * FROM inventory_lots ORDER BY id"))[0],lots);
  for(const id of f.balances){const [[row]]=await pool.execute("SELECT on_hand_quantity FROM inventory_stock_balances WHERE id=?",[id]);assert.equal(Number(row.on_hand_quantity),8);}
  const [[eligible]]=await pool.query("SELECT COALESCE(SUM(b.on_hand_quantity),0) AS qty FROM inventory_stock_balances b JOIN inventory_lots l ON l.id=b.lot_id WHERE b.sku_id=14 AND b.stock_status='AVAILABLE' AND l.expiry_date >= '2026-11-11'");assert.equal(Number(eligible.qty),0,"expired/short gains do not grant sale eligibility");
});
integrationTest("ST038-D20 zero and added-absent-zero Post create no Balance/Control/Movement or line versions",async()=>{
  const f=await counting();const added=await service.addLine(command("add_line",{stocktakeId:f.header.id,binId:f.bins[0],skuId:13,lotId:1,stockStatus:"DAMAGED"}));f.lines=await rows("inventory_stocktake_lines",f.header.id);await service.saveCounts(countRequest(f,[4,0]));f.header=await service.ready(workflow("ready",f));const before=await snapshot(),result=await submit("post",f);assert.equal(result.movementGroupId,null);assert.equal(result.rowCount,0);
  const after=await snapshot();for(const table of ["inventory_stock_balances","inventory_stock_controls","inventory_lots","inventory_movements"])assert.deepEqual(after[table],before[table]);assert.ok((await rows("inventory_stocktake_lines",f.header.id)).every(row=>row.movement_id===null&&Number(row.version)===2));assert.equal((await operationAudits(result.operationId)).length,1);assert.ok(added.id>0);
});
integrationTest("ST038-D21 snapshot identity/quantity/version or a later Balance rejects and keeps READY/locks",async()=>{
  for(const change of ["on_hand_quantity=on_hand_quantity+1","version=version+1"]){const f=await readyFixture();await pool.query(`UPDATE inventory_stock_balances SET ${change} WHERE id=?`,[f.balances[0]]);await unchanged(()=>submit("post",f),{code:"STOCKTAKE_SNAPSHOT_MISMATCH"});}
  const f=await readyFixture();const other=await balance(await bin());await pool.execute("UPDATE inventory_stocktake_lines SET stock_balance_id=? WHERE id=?",[other,f.lines[0].id]);await unchanged(()=>submit("post",f),{code:"STOCKTAKE_SNAPSHOT_MISMATCH"});
  const g=await counting();const added=await service.addLine(command("add_line",{stocktakeId:g.header.id,binId:g.bins[0],skuId:12,lotId:null,stockStatus:"DAMAGED"}));g.lines=await rows("inventory_stocktake_lines",g.header.id);await service.saveCounts(countRequest(g,[4,0]));g.header=await service.ready(workflow("ready",g));await balance(g.bins[0],0,"DAMAGED");await unchanged(()=>submit("post",g),{code:"STOCKTAKE_SNAPSHOT_MISMATCH"});assert.ok(added.id>0);
});
async function reserve(quantity,sku=12){return database.withTransaction(async tx=>{const request=command("create",{}),op=new InventoryOperationService();const claim=await op.claim(tx,{commandType:"RESERVATION_CREATE",payload:{quantity,sku},source:{...request.source,documentType:"RESERVATION"},actorUserId:7,actorLabel:"synthetic-counter",createdAt:NOW});
  const [created]=await tx.execute("INSERT INTO inventory_reservations (create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES (?,1,?,?,?,'SALE','ACTIVE',?,?)",[claim.operationId,sku,quantity,quantity,NOW,NOW]);
  await tx.execute("INSERT INTO inventory_stock_controls (warehouse_id,sku_id,reserved_quantity,created_at,updated_at) VALUES (1,?,?,?,?) ON DUPLICATE KEY UPDATE reserved_quantity=reserved_quantity+VALUES(reserved_quantity)",[sku,quantity,NOW,NOW]);
  await op.complete(tx,{operationId:claim.operationId,resultType:"RESERVATION",resultId:String(created.insertId),resultSummary:{id:Number(created.insertId),quantity,status:"ACTIVE"},completedAt:NOW});return {id:Number(created.insertId),operationId:claim.operationId};});}
integrationTest("ST038-D22 a real current Allocation floor rejects even with another Bucket gain",async()=>{
  const f=await readyFixture([{},{}],[1,10]),reserved=await reserve(2);
  await pool.execute("INSERT INTO inventory_allocations (create_operation_id,reservation_id,stock_balance_id,allocated_quantity,outstanding_quantity,selection_strategy,status,created_at,updated_at) VALUES (?,?,?,2,2,'FIFO','ACTIVE',?,?)",[reserved.operationId,reserved.id,f.balances[0],NOW,NOW]);await pool.execute("UPDATE inventory_stock_balances SET allocated_quantity=2 WHERE id=?",[f.balances[0]]);
  await unchanged(()=>submit("post",f),{code:"INSUFFICIENT_STOCK"});
});
integrationTest("ST038-D23 current complete final reserved coverage can net gains but never increase uncovered",async()=>{
  const [[old]]=await pool.query("SELECT reserved_quantity FROM inventory_stock_controls WHERE warehouse_id=1 AND sku_id=12");
  try{for(const mode of ["loss","net","already-uncovered","uncovered-gain"]){const f=await readyFixture(mode==="net"?[{},{}]:[{}],mode==="net"?[1,7]:mode==="uncovered-gain"?[5]:[1]);const [[total]]=await pool.query("SELECT SUM(on_hand_quantity) AS quantity FROM inventory_stock_balances WHERE warehouse_id=1 AND sku_id=12 AND stock_status='AVAILABLE'");
      await pool.execute("UPDATE inventory_stock_controls SET reserved_quantity=? WHERE warehouse_id=1 AND sku_id=12",[Number(total.quantity)+(["already-uncovered","uncovered-gain"].includes(mode)?3:0)]);
      if(mode==="net"||mode==="uncovered-gain"){const beforeReservations=(await pool.query("SELECT * FROM inventory_reservations ORDER BY id"))[0];await submit("post",f);assert.deepEqual((await pool.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],beforeReservations);}
      else await unchanged(()=>submit("post",f),{code:"INSUFFICIENT_ATP"});
    }}finally{await pool.execute("UPDATE inventory_stock_controls SET reserved_quantity=? WHERE warehouse_id=1 AND sku_id=12",[old?.reserved_quantity??0]);}
});
integrationTest("ST038-D24 none-Lot FIFO preserves/initializes/clears while Lot dates stay unchanged",async()=>{
  for(const [quantity,actual,anchor] of [[4,7,"2026-01-01"],[0,2,"2026-10-12"],[4,0,null]]){const f=await readyFixture([{quantity}],[actual]);await submit("post",f);const [[row]]=await pool.query("SELECT DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS anchor,version FROM inventory_stock_balances WHERE id=?",[f.balances[0]]);assert.equal(row.anchor,anchor);assert.equal(Number(row.version),2);}
  const f=await readyFixture([{sku:13,lot:1}],[0]),lot=(await pool.query("SELECT * FROM inventory_lots WHERE id=1"))[0];await submit("post",f);assert.equal((await pool.execute("SELECT fifo_anchor_date FROM inventory_stock_balances WHERE id=?",[f.balances[0]]))[0][0].fifo_anchor_date,null);assert.deepEqual((await pool.query("SELECT * FROM inventory_lots WHERE id=1"))[0],lot);
});
integrationTest("ST038-D25 safe MAX quantity accepted in isolated SKU; unsafe and version ceilings rollback",async()=>{
  const f=await readyFixture([{sku:18,quantity:0}],[Number.MAX_SAFE_INTEGER]);await submit("post",f);assert.equal(Number((await pool.execute("SELECT on_hand_quantity FROM inventory_stock_balances WHERE id=?",[f.balances[0]]))[0][0].on_hand_quantity),Number.MAX_SAFE_INTEGER);
  for(const change of ["counted_quantity=9007199254740992","version=4294967295"]){const g=await readyFixture();await pool.query(`UPDATE inventory_stocktake_lines SET ${change} WHERE id=?`,[g.lines[0].id]);await unchanged(()=>submit("post",g),error=>["STOCKTAKE_SNAPSHOT_MISMATCH","CONCURRENT_OPERATION"].includes(error.code));}
  const g=await readyFixture();await pool.execute("UPDATE inventory_stock_balances SET version=4294967295 WHERE id=?",[g.balances[0]]);await pool.execute("UPDATE inventory_stocktake_lines SET snapshot_balance_version=4294967295 WHERE id=?",[g.lines[0].id]);await unchanged(()=>submit("post",g),{code:"CONCURRENT_OPERATION"});
});
integrationTest("ST038-D26 local date crossing during actual Warehouse wait rejects without effects",async()=>{
  const f=await readyFixture(),before=await snapshot();let date="2026-10-12";const clock={nowMs:time.nowMs,fileDate:()=>date};
  const result=await ordered(holdWarehouse,db=>submit("post",f,{db,clock}),async()=>{date="2026-10-13";});assert.equal(result[1].error.code,"CONCURRENT_OPERATION");assert.deepEqual(await snapshot(),before);
});
integrationTest("ST038-D27 Item-owned current Tracking/BaseUOM/Lot validation defeats stale discovery",async()=>{
  for(const kind of ["inactive","serial","nontracked","uom"]){const f=await readyFixture(),before=await snapshot();let result;
    try{result=await ordered(holdWarehouse,db=>submit("post",f,{db}),async()=>{
      if(kind==="inactive")await pool.query("UPDATE item_skus SET status='inactive' WHERE id=12");if(kind==="serial")await pool.query("UPDATE item_skus SET tracking_policy='serial' WHERE id=12");if(kind==="nontracked")await pool.query("UPDATE item_skus SET inventory_tracked=0 WHERE id=12");if(kind==="uom")await pool.query("UPDATE item_sku_uoms SET to_base_factor=2 WHERE sku_id=12");
    });}finally{await pool.query("UPDATE item_skus SET status='active',tracking_policy='none',inventory_tracked=1 WHERE id=12");await pool.query("UPDATE item_sku_uoms SET to_base_factor=1 WHERE sku_id=12");}
    assert.ok(["INVENTORY_INPUT_INVALID","SERIAL_TRACKING_UNSUPPORTED","SKU_NOT_INVENTORY_TRACKED","UOM_CONVERSION_INVALID"].includes(result[1].error.code));assert.deepEqual(await snapshot(),before);
  }
  const g=await readyFixture([{sku:14,lot:3}]),before=await snapshot();let result;try{result=await ordered(holdWarehouse,db=>submit("post",g,{db}),()=>pool.query("UPDATE inventory_lots SET expiry_date=NULL WHERE id=3"));assert.equal(result[1].error.code,"EXPIRY_REQUIRED");}finally{await pool.query("UPDATE inventory_lots SET expiry_date='2026-10-13' WHERE id=3");}assert.deepEqual(await snapshot(),before);
});
integrationTest("ST038-D28 Post inactive/missing/released ownership rejects without foreign unlock",async()=>{
  for(const kind of ["inactive","missing","released"]){const f=await readyFixture();if(kind==="inactive")await pool.execute("UPDATE inventory_bins SET status='INACTIVE' WHERE id=?",[f.bins[0]]);else if(kind==="missing")await pool.execute("DELETE FROM inventory_bin_locks WHERE stocktake_id=?",[f.header.id]);else await pool.execute("UPDATE inventory_bin_locks SET released_at=1 WHERE stocktake_id=?",[f.header.id]);
    await unchanged(()=>submit("post",f),{code:kind==="inactive"?"BIN_INVALID":"STOCKTAKE_STATE_CONFLICT"});}
});
integrationTest("ST038-D29 second Balance/Movement/link/Audit/header/release/complete/commit faults rollback all",async()=>{
  const f=await readyFixture([{},{}]);for(const [pattern,nth] of [[/UPDATE inventory_stock_balances/u,2],[/INSERT INTO inventory_movements/u,2],[/SET movement_id/u,2],[/INSERT INTO inventory_audit_logs/u,2],[/SET status = 'POSTED'/u,1],[/UPDATE inventory_bin_locks/u,2],[/SET result_type/u,1]])await fault("post",f,pattern,nth);
  let reached=false;const db=transactionDatabase({beforeCommit:async()=>{reached=true;throw new Error("intended flow storage fault");}});await unchanged(()=>submit("post",f,{db}),/intended flow storage fault/u);assert.ok(reached);
  const g=await counting();await service.addLine(command("add_line",{stocktakeId:g.header.id,binId:g.bins[0],skuId:19,lotId:null,stockStatus:"DAMAGED"}));g.lines=await rows("inventory_stocktake_lines",g.header.id);await service.saveCounts(countRequest(g,[7,5]));g.header=await service.ready(workflow("ready",g));assert.equal((await pool.query("SELECT * FROM inventory_stock_controls WHERE warehouse_id=1 AND sku_id=19"))[0].length,0);await fault("post",g,/INSERT INTO inventory_audit_logs/u,2);assert.equal((await pool.query("SELECT * FROM inventory_stock_controls WHERE warehouse_id=1 AND sku_id=19"))[0].length,0);
});
integrationTest("ST038-D30 two real Post requests with same workflowversion have one complete winner",async()=>{
  const f=await readyFixture([{},{}]),result=await ordered(db=>submit("post",f,{db}),db=>submit("post",f,{db}));assert.equal(result[0].value.status,"POSTED");assert.equal(result[1].error.code,"VERSION_CONFLICT");
  const [[row]]=await pool.execute("SELECT COUNT(*) AS count FROM inventory_movements WHERE stocktake_id=?",[f.header.id]);assert.equal(Number(row.count),2);assert.equal((await operationAudits(result[0].value.operationId)).length,3);
});
integrationTest("ST038-D31 Post-first/Cancel-first actual waits have one terminal effect and no partial unlock",async()=>{
  for(const first of ["post","cancel"]){const f=await readyFixture(),result=await ordered(db=>submit(first,f,{db}),db=>submit(first==="post"?"cancel":"post",f,{db}));assert.ok(result[0].value);assert.equal(result[1].error.code,"VERSION_CONFLICT");
    const [[row]]=await pool.execute("SELECT COUNT(*) AS count FROM inventory_movements WHERE stocktake_id=?",[f.header.id]);assert.equal(Number(row.count),first==="post"?1:0);assert.ok((await rows("inventory_bin_locks",f.header.id)).every(row=>row.released_at!==null));}
});
integrationTest("ST038-D32 Post real source replay after unrelated write is original, current-authorized, effect-free",async()=>{
  const f=await readyFixture(),input=workflow("post",f),result=await submit("post",f,{input});await balance(await bin(),9);const before=await snapshot();assert.deepEqual(await submit("post",f,{input}),result);assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await new InventoryOperationService().findBySource(pool,{source:input.source})).resultSummary,result);await unchanged(()=>submit("post",f),{code:"VERSION_CONFLICT"});await unchanged(()=>submit("post",f,{input:{...input,payload:{...input.payload,reason:"different"}}}),{code:"INVENTORY_SOURCE_CONFLICT"});
  await pool.query("UPDATE fr_token_versions SET version=1 WHERE subject='8'");try{await unchanged(()=>submit("post",f,{input}),{code:"JWT_INVALID"});}finally{await restoreAuth();}
});
integrationTest("ST038-D33 terminal Ready/Count/Add/Cancel/NewPost mutations reject, original Count replay survives",async()=>{
  const f=await counting(),count=countRequest(f),counted=await service.saveCounts(count);f.header=await service.ready(workflow("ready",f));await submit("post",f);
  for(const action of ["ready","cancel","post"])await unchanged(()=>action==="ready"?service.ready(workflow(action,f)):submit(action,f),{code:"VERSION_CONFLICT"});
  await unchanged(()=>service.saveCounts(command("count",{stocktakeId:f.header.id,lines:[{lineId:Number(f.lines[0].id),expectedVersion:2,countedQuantity:5}]})),{code:"STOCKTAKE_STATE_CONFLICT"});
  await unchanged(()=>service.addLine(command("add_line",{stocktakeId:f.header.id,binId:f.bins[0],skuId:12,lotId:null,stockStatus:"DAMAGED"})),{code:"STOCKTAKE_STATE_CONFLICT"});const before=await snapshot();assert.deepEqual(await service.saveCounts(count),counted);assert.deepEqual(await snapshot(),before);
});
integrationTest("ST038-D34 100 nonzero plus100 zero functional transactions retain exact Movement/Audit/link absence",async()=>{
  for(const changed of [true,false]){const entries=Array.from({length:100},()=>({})),f=await readyFixture(entries,entries.map(()=>changed?5:4)),result=await submit("post",f);
    assert.equal(result.rowCount,changed?100:0);assert.equal((await operationAudits(result.operationId)).length,changed?101:1);
    const lines=await rows("inventory_stocktake_lines",f.header.id);assert.equal(lines.filter(row=>row.movement_id!==null).length,changed?100:0);assert.ok(lines.every(row=>Number(row.version)===(changed?3:2)));
    const [[mov]]=await pool.execute("SELECT COUNT(*) AS count,COUNT(DISTINCT movement_group_id) AS group_count FROM inventory_movements WHERE stocktake_id=?",[f.header.id]);assert.equal(Number(mov.count),changed?100:0);assert.equal(Number(mov.group_count),changed?1:0);
    assert.equal((await rows("inventory_bin_locks",f.header.id)).filter(row=>row.released_at===null).length,0);
  }
});

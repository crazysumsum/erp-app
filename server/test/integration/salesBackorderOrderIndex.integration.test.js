import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {ownedArchiveExportFixture} from "../sales/phase4/ownedArchiveExportFixture.js";
import {up,inspectSalesBackorderOrderIndex} from "../../database/migrations/0108_add_sales_backorder_order_index.js";
import {inspectSalesBackorderSchema} from "../../database/migrations/0079_create_sales_backorder_entries.js";
import {SalesOrderService} from "../../src/modules/sales/SalesOrderService.js";
import {SalesOrderLifecycleService} from "../../src/modules/sales/SalesOrderLifecycleService.js";
import {revealSecret} from "../../src/framework/configuration/SecretValue.js";
import {salesArchiveWindow} from "../../src/modules/sales/SalesArchiveBatchService.js";
import {SalesReconciliationService} from "../../src/modules/sales/SalesReconciliationService.js";

const native=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const settings="SELECT CONNECTION_ID() AS connection_id,@@SESSION.innodb_ddl_threads AS ddl_threads,@@SESSION.innodb_parallel_read_threads AS read_threads,@@SESSION.lock_wait_timeout AS wait_seconds";
const mysql=createRequire(import.meta.url)("mysql2/promise");
async function state(db){return (await db.query(settings))[0][0];}

native("TC-029 DEF037 native additive index preserves rows/contracts, restores actual DDL session limits and rejects drift",async t=>{
 const f=await ownedArchiveExportFixture(t),before=await state(f.db),rows=(await f.db.query("SELECT * FROM sales_backorder_entries ORDER BY id"))[0];
 await f.db.query("SET SESSION innodb_ddl_threads=1,innodb_parallel_read_threads=1,lock_wait_timeout=10");
 await f.db.query({sql:"ALTER TABLE sales_backorder_entries DROP INDEX idx_sales_backorder_order",timeout:600000});
 await f.db.query("SET SESSION innodb_ddl_threads=?,innodb_parallel_read_threads=?,lock_wait_timeout=?",[before.ddl_threads,before.read_threads,before.wait_seconds]);
 assert.equal(await inspectSalesBackorderOrderIndex(f.db),false);
 const query=f.db.query.bind(f.db);let additions=0,limits;
 f.db.query=async(sql,...args)=>{
  if(typeof sql==="object"&&sql.sql.startsWith("ALTER TABLE sales_backorder_entries ADD INDEX")){
   additions++;assert.equal(sql.timeout,600000);limits=(await query(settings))[0][0];
  }
  return query(sql,...args);
 };
 try{await up(f.db);await up(f.db);}finally{f.db.query=query;}
 assert.equal(additions,1);assert.deepEqual(limits,{connection_id:before.connection_id,ddl_threads:1,read_threads:1,wait_seconds:10});assert.deepEqual(await state(f.db),before);
 assert.equal(await inspectSalesBackorderSchema(f.db),true);assert.equal(await inspectSalesBackorderOrderIndex(f.db),true);assert.deepEqual((await f.db.query("SELECT * FROM sales_backorder_entries ORDER BY id"))[0],rows);
 await f.db.query("SET SESSION innodb_ddl_threads=1,innodb_parallel_read_threads=1,lock_wait_timeout=10");
 try{
  await f.db.query({sql:"ALTER TABLE sales_backorder_entries DROP INDEX idx_sales_backorder_order, ADD INDEX idx_sales_backorder_order (id,sales_order_id), ALGORITHM=INPLACE, LOCK=NONE",timeout:600000});
  await assert.rejects(()=>up(f.db),/Incompatible Sales Backorder order index/u);
  const [parts]=await f.db.query("SELECT column_name AS field FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='sales_backorder_entries' AND index_name='idx_sales_backorder_order' ORDER BY seq_in_index");assert.deepEqual(parts.map(row=>row.field),["id","sales_order_id"]);
  await f.db.query({sql:"ALTER TABLE sales_backorder_entries DROP INDEX idx_sales_backorder_order",timeout:600000});
  const [applied]=await f.db.query("SELECT name FROM fr_schema_migrations WHERE name LIKE '%_add_sales_backorder_order_index.js'");assert.equal(applied.length,1);assert.equal((await f.db.execute("DELETE FROM fr_schema_migrations WHERE name=?",[applied[0].name]))[0].affectedRows,1);
  const config=f.app.configuration.database,connection=await mysql.createConnection({socketPath:config.socketPath,host:config.host,port:config.port,user:config.user,password:revealSecret(config.password),database:config.database}),original=connection.query.bind(connection),destroy=connection.destroy.bind(connection);let lost=false,destroyed=0;
  connection.destroy=()=>{destroyed++;return destroy();};
  connection.query=async(sql,...args)=>{const result=await original(sql,...args);if(typeof sql==="object"&&sql.sql.startsWith("ALTER TABLE sales_backorder_entries ADD INDEX")){lost=true;throw Object.assign(new Error("Controlled DDL acknowledgement loss"),{code:"CONTROLLED_DDL_UNKNOWN"});}return result;};
  try{await assert.rejects(()=>up(connection),{code:"CONTROLLED_DDL_UNKNOWN"});assert.equal(lost,true);assert.equal(destroyed,1,"Migration must discard the unknown session before test cleanup");}finally{if(!destroyed)destroy();}
  // Inspect with the healthy owned observer, rather than retrying on a destroyed or unknown session.
  assert.equal(await inspectSalesBackorderOrderIndex(f.db),true);assert.equal((await f.db.query("SELECT name FROM fr_schema_migrations WHERE name=?",[applied[0].name]))[0].length,0,"Committed DDL with lost acknowledgement is not an applied migration ledger entry");
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url))],{env:{...process.env,DB_NAME:config.database,DB_USER:config.user,DB_PASSWORD:revealSecret(config.password),DB_SOCKET_PATH:config.socketPath},timeout:600000,maxBuffer:1024*1024});
  assert.equal((await f.db.query("SELECT name FROM fr_schema_migrations WHERE name=?",[applied[0].name]))[0].length,1);assert.deepEqual((await f.db.query("SELECT * FROM sales_backorder_entries ORDER BY id"))[0],rows);
 }finally{await f.db.query("SET SESSION innodb_ddl_threads=?,innodb_parallel_read_threads=?,lock_wait_timeout=?",[before.ddl_threads,before.read_threads,before.wait_seconds]);}
});

native("TC-054 DEF037 native original order predicates retain bounded plans, cancellation replay, reconciliation and actual Archive behavior",async t=>{
 const f=await ownedArchiveExportFixture(t,{archiveEnabled:true}),runtime=f.app.services.require("salesJobs"),now=f.time.nowMs(),label="idx_"+randomUUID().slice(0,8),itemId=await f.insert("items",{name:label,status:"active",created_at:now,updated_at:now}),uomId=await f.insert("item_uoms",{code:label,name:"Synthetic each",status:"active",created_at:now,updated_at:now}),skus=[];
 for(let i=0;i<100;i++){
  const skuId=await f.insert("item_skus",{item_id:itemId,sku_code:label+"_"+i,sku_name:"Synthetic index case",status:"active",sellable:1,inventory_tracked:1,tracking_policy:"none",created_at:now,updated_at:now}),skuUomId=await f.insert("item_sku_uoms",{sku_id:skuId,uom_id:uomId,to_base_factor:1,is_base:1,is_default_sale:1,created_at:now,updated_at:now});skus.push({skuId,skuUomId});
 }
 const [[parent]]=await f.db.query("SELECT currency_code,fulfillment_warehouse_id FROM sales_orders WHERE id=?",[f.request.id]),orders=[];
 for(const count of [1,100]){
  const created=await new SalesOrderService(f).create({claims:f.claims,input:{eventId:randomUUID(),customerId:f.customerId,currencyCode:parent.currency_code,fulfillmentWarehouseId:Number(parent.fulfillment_warehouse_id),orderDate:f.time.fileDate(),lines:skus.slice(0,count).map(sku=>({...sku,quantity:"10.000000",unitSellingPrice:"1.0000"}))}}),eventId=randomUUID(),intent=await runtime.confirmation.startConfirmation({claims:f.claims,id:created.salesOrder.id,input:{eventId,version:created.salesOrder.version}}),result=await runtime.confirmation.completeConfirmation({eventId,claims:f.claims,leaseOwner:intent.leaseOwner,signal:new AbortController().signal});orders.push(result.salesOrder);
 }
 const all=(await f.db.query("SELECT id,sales_order_id FROM sales_backorder_entries ORDER BY id"))[0];
 for(const order of [...orders,{id:Number.MAX_SAFE_INTEGER}])for(const paged of [false,true]){
  const sql="SELECT id FROM sales_backorder_entries WHERE sales_order_id=?"+(paged?" AND id>? ORDER BY id LIMIT 500":""),args=paged?[order.id,0]:[order.id],[plan]=await f.db.query("EXPLAIN FORMAT=TRADITIONAL "+sql,args);assert.equal(plan.length,1);assert.equal(plan[0].key,"idx_sales_backorder_order");assert.ok(["ref","range"].includes(plan[0].type));assert.ok(Number(plan[0].rows)<=100);
  const [actual]=await f.db.query(sql,args),expected=all.filter(row=>Number(row.sales_order_id)===order.id).map(row=>Number(row.id));assert.deepEqual(actual.map(row=>Number(row.id)).sort((a,b)=>a-b),expected);
 }
 const order=orders[1],input={eventId:randomUUID(),version:order.version,reason:"Synthetic index regression cancellation"},lifecycle=new SalesOrderLifecycleService({...f,services:f.app.services}),asActor=work=>f.database.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:{sub:String(f.claims.actorId),roles:f.claims.claimedRoles,permissions:f.claims.claimedPermissions}}},work),first=await asActor(()=>lifecycle.cancel({claims:f.claims,id:order.id,input})),replay=await asActor(()=>lifecycle.cancel({claims:f.claims,id:order.id,input}));assert.equal(first.salesOrder.status,"CANCELLED");assert.deepEqual(replay.salesOrder,first.salesOrder);
 const reconcile=new SalesReconciliationService(f);for(const current of orders)assert.equal((await reconcile.reconcileOrder({claims:f.claims,orderId:current.id})).status,"CONSISTENT");
 const queue=(await f.db.query("SELECT * FROM sales_backorder_entries ORDER BY id"))[0],scheduler=f.app.services.require("scheduler");assert.ok(f.app.services.names().includes("fulfillmentOpenMatter"));
 // Resume an owned unfinished batch, so the original registered worker executes independently of today's calendar window.
 const window=salesArchiveWindow(f.time.nowMs(),f.app.configuration.sales);
 await f.db.execute("INSERT INTO sales_archive_batches(batch_number,period_key,cutoff_at,status,started_at,updated_at)VALUES(?,?,?,'RUNNING',?,?)",["SYNTHETIC-INDEX-ARCHIVE",window.periodKey,window.cutoffMs,f.time.nowMs(),f.time.nowMs()]);
 await scheduler.execute(scheduler.jobs.get("sales.archive"));assert.equal(scheduler.stats.get("sales.archive").lastOutcome,"succeeded");assert.deepEqual((await f.db.query("SELECT * FROM sales_backorder_entries ORDER BY id"))[0],queue);const [[archived]]=await f.db.query("SELECT COUNT(*) AS n FROM sales_archive_order_manifests");assert.ok(Number(archived.n)>0);
});

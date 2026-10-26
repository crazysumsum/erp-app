import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {createFulfillmentArchiveDatabase} from "../sales/phase4/fulfillmentArchiveFixtures.js";
import {seedCancelledFulfillment,seedFulfillmentSalesOrder} from "../sales/phase4/fulfillmentOwnerFixtures.js";
import {issueFixture} from "../fulfillment/shipmentFixture.js";
import {archiveFactsFixture} from "../fulfillment/archiveFactsFixture.js";
import {FulfillmentOpenMatterService} from "../../src/modules/fulfillment/FulfillmentOpenMatterService.js";
import {readFulfillmentArchiveState,archiveStateFacts} from "../../src/modules/fulfillment/fulfillmentArchiveState.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS,hashFulfillmentArchiveRow} from "../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
import {FulfillmentOpenMatterService as OpenMatterAdapter} from "../../src/services/fulfillment/FulfillmentOpenMatterService.js";
import {FulfillmentArchiveService as ArchiveAdapter} from "../../src/services/fulfillmentArchive/FulfillmentArchiveService.js";
import {MySqlDatabaseService} from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import {RequestContextService} from "../../src/services/context/RequestContextService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
function runtime(t,f){
 const time={nowMs:()=>Date.now(),timestamp:()=>Date.now()},context=new RequestContextService({services:{require:()=>time}}),pool=mysql.createPool({...f.connectionOptions,database:f.name,multipleStatements:false,connectionLimit:2});
 const database=new MySqlDatabaseService({pool,context,logger:{},config:{queryTimeoutMs:5000,transactionTimeoutMs:15000,acquireTimeoutMs:5000,abandonedConnectionAction:"destroy"}});
 t.after(()=>database.shutdown());const service=new FulfillmentOpenMatterService({database});
 const transaction=work=>context.storage.run({databaseTransaction:null,signal:null,auth:null,startedAt:Date.now()},()=>database.withTransaction(work));
 return {database,context,service,transaction,status:id=>service.getOrderArchiveStatus(String(id),{atMs:Date.now()})};
}
nativeTest("DEC029 pre-owner schema returns UNKNOWN rather than empty CLOSED",async t=>{
 const f=await createFulfillmentArchiveDatabase(t),r=runtime(t,f);assert.deepEqual(await r.status("1"),{version:"1",status:"UNKNOWN",reasonCodes:["SCHEMA_MISSING"]});
});
nativeTest("DEC029 current formal schema advisory and actual transaction refusal",async t=>{
 const f=await createFulfillmentArchiveDatabase(t,{baseOnly:false}),r=runtime(t,f),a=await seedCancelledFulfillment(f.db);
 await t.test("fresh advisory terminal owner read is CLOSED and leaves all business bytes unchanged",async()=>{
  const before=(await f.db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]))[0];assert.deepEqual(await r.status(a.orderId),{version:"1",status:"CLOSED",reasonCodes:[]});assert.deepEqual((await f.db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]))[0],before);assert.equal(r.context.get(),null);
 });
 await t.test("complete empty owner with installed current schema is CLOSED",async()=>assert.equal((await r.status("9007199254740991")).status,"CLOSED"));
 await t.test("actual RR executor without private coordinator scope cannot grant authoritative CLOSED",async()=>r.transaction(async tx=>{
  await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]);
  assert.deepEqual(await r.service.getOrderArchiveStatusInTransaction(tx,{orderId:String(a.orderId),atMs:Date.now()}),{version:"1",status:"UNKNOWN",reasonCodes:["PROVIDER_UNAVAILABLE"]});assert.equal((await r.status(a.orderId)).status,"UNKNOWN");
 }));
 await t.test("real DRAFT owner is OPEN and its actual terminal transition becomes CLOSED",async()=>{
  const [[template]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]),[[line]]=await f.db.query("SELECT * FROM fulfillment_lines WHERE id=?",[a.fulfillmentLineId]);
  delete template.id;template.fulfillment_number="FUL-"+randomUUID().slice(0,12);template.status="DRAFT";const id=await a.insert("fulfillments",template);delete line.id;line.fulfillment_id=id;await a.insert("fulfillment_lines",line);
  assert.deepEqual(await r.status(a.orderId),{version:"1",status:"OPEN",reasonCodes:["FULFILLMENT_NONTERMINAL"]});await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[id]);assert.equal((await r.status(a.orderId)).status,"CLOSED");
 });
 await t.test("an unavailable private adapter yields safe UNKNOWN without granting read authority",async()=>r.transaction(async tx=>{
  const service=new FulfillmentOpenMatterService({database:r.database,authorizeArchiveRead(){throw new Error("Synthetic unavailable adapter");}});
  assert.deepEqual(await service.getOrderArchiveStatusInTransaction(tx,{orderId:String(a.orderId),atMs:Date.now()}),{version:"1",status:"UNKNOWN",reasonCodes:["PROVIDER_UNAVAILABLE"]});
 }));
 await t.test("advisory snapshots validated time before connection acquisition awaits",async()=>{
  const options={atMs:Date.now()},pending=r.service.getOrderArchiveStatus(String(a.orderId),options);options.atMs=0;assert.equal((await pending).status,"CLOSED");
 });
 await t.test("deferred internal authorizer cannot switch the validated order or time via caller mutation",async()=>r.transaction(async tx=>{
  let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;}),command={orderId:String(a.orderId),atMs:Date.now()};
  const service=new FulfillmentOpenMatterService({database:r.database,async authorizeArchiveRead(actual,scope){assert.equal(actual,tx);enter(scope);await gate;return true;}});
  const pending=service.getOrderArchiveStatusInTransaction(tx,command),observed=await entered;command.orderId="9007199254740991";command.atMs=0;release();const result=await pending;assert.notEqual(observed,command);assert.ok(Object.isFrozen(observed));assert.equal(result.status,"CLOSED");
  // This private dependency test proves input snapshotting only; it is no qualification of the real job capability.
 }));
 await t.test("nonnull order route blocks an unassigned CREATE intent",async()=>{
  const b=await seedFulfillmentSalesOrder(f.db);await b.insert("fulfillment_operation_requests",{event_id:randomUUID(),operation_type:"CREATE",target_type:"FULFILLMENT",sales_order_id:b.orderId,payload_hash:"a".repeat(64),status:"IN_PROGRESS",lease_owner:"synthetic-owner",lease_expires_at:Date.now()+60000,attempt_count:1,correlation_id:randomUUID(),created_at:b.now,updated_at:b.now});assert.deepEqual(await r.status(b.orderId),{version:"1",status:"OPEN",reasonCodes:["OPERATION_IN_PROGRESS"]});
 });
 await t.test("cross-order nonnull target is inconsistent even with an immutable routed intent",async()=>{
  const b=await seedFulfillmentSalesOrder(f.db);await b.insert("fulfillment_operation_requests",{event_id:randomUUID(),operation_type:"UPDATE",target_type:"FULFILLMENT",target_id:a.fulfillmentId,sales_order_id:b.orderId,payload_hash:"a".repeat(64),status:"FAILED",attempt_count:1,completed_at:b.now,public_error_code:"VERSION_CONFLICT",correlation_id:randomUUID(),created_at:b.now,updated_at:b.now});assert.deepEqual((await r.status(b.orderId)).reasonCodes,["OWNER_STATE_INCONSISTENT"]);
 });
 await t.test("retained terminal operation accepts an exact historical target owner and rejects foreign Archive ownership",async()=>{
  const b=await seedFulfillmentSalesOrder(f.db),[[template]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]);
  const batch=await b.insert("sales_archive_batches",{batch_number:"HISTORICAL-SYNTHETIC",period_key:"202610",cutoff_at:b.now,status:"RUNNING",started_at:b.now,updated_at:b.now});
  Object.assign(template,{id:7000000000001,sales_order_id:b.orderId,customer_id:b.customerId,warehouse_id:b.warehouseId});await b.insert("fulfillments_archive",{...template,archive_batch_id:batch,archived_at:Date.now(),row_hash:hashFulfillmentArchiveRow("fulfillments",template)});
  const operation={event_id:randomUUID(),operation_type:"UPDATE",target_type:"FULFILLMENT",target_id:template.id,sales_order_id:b.orderId,payload_hash:"a".repeat(64),status:"FAILED",attempt_count:1,completed_at:b.now,public_error_code:"VERSION_CONFLICT",correlation_id:randomUUID(),created_at:b.now,updated_at:b.now,is_document_archived:1};
  await b.insert("fulfillment_operation_requests",operation);assert.equal((await r.status(b.orderId)).status,"CLOSED");
  const c=await seedFulfillmentSalesOrder(f.db);await c.insert("fulfillment_operation_requests",{...operation,event_id:randomUUID(),sales_order_id:c.orderId,correlation_id:randomUUID()});assert.deepEqual((await r.status(c.orderId)).reasonCodes,["OWNER_STATE_INCONSISTENT"]);
 });
 await t.test("all501 routed operations are observed across pages including an in-progress tail",async()=>{
  const b=await seedFulfillmentSalesOrder(f.db),rows=Array.from({length:501},(_,i)=>[randomUUID(),"CREATE","FULFILLMENT",b.orderId,"a".repeat(64),i===500?"IN_PROGRESS":"FAILED",i===500?"synthetic-owner":"",i===500?Date.now()+60000:null,1,randomUUID(),i===500?null:b.now,i===500?"":"VERSION_CONFLICT",b.now,b.now]);
  await f.db.query("INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,sales_order_id,payload_hash,status,lease_owner,lease_expires_at,attempt_count,correlation_id,completed_at,public_error_code,created_at,updated_at) VALUES ?",[rows]);assert.deepEqual(await r.status(b.orderId),{version:"1",status:"OPEN",reasonCodes:["OPERATION_IN_PROGRESS"]});
 });
 await t.test("read-only EXPORT has no business order route",async()=>{
  await f.db.execute("INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,payload_hash,status,lease_owner,lease_expires_at,attempt_count,correlation_id,created_at,updated_at) VALUES (?,'EXPORT','EXPORT',?,'IN_PROGRESS','synthetic-owner',?,1,?,1,1)",[randomUUID(),"b".repeat(64),Date.now()+60000,randomUUID()]);assert.equal((await r.status(a.orderId)).status,"CLOSED");
 });
 await t.test("future business time and incomplete owner lines cannot imply CLOSED",async()=>{
  await f.db.execute("UPDATE fulfillments SET last_business_updated_at=?,version=version+1 WHERE id=?",[Date.now()+86400000,a.fulfillmentId]);assert.deepEqual((await r.status(a.orderId)).reasonCodes,["OWNER_STATE_INCONSISTENT"]);
  await f.db.execute("UPDATE fulfillments SET last_business_updated_at=?,line_count=2,version=version+1 WHERE id=?",[a.now,a.fulfillmentId]);assert.deepEqual((await r.status(a.orderId)).reasonCodes,["OWNER_STATE_INCONSISTENT"]);await f.db.execute("UPDATE fulfillments SET line_count=1,version=version+1 WHERE id=?",[a.fulfillmentId]);
 });
 await t.test("missing version refuses current physical tables and cannot use cached CLOSED",async()=>{
  const [[v]]=await f.db.query("SELECT * FROM fr_schema_migrations WHERE name='migrations/0105_add_fulfillment_archive_routing.js'");await f.db.execute("DELETE FROM fr_schema_migrations WHERE name=?",[v.name]);assert.deepEqual((await r.status(a.orderId)).reasonCodes,["SCHEMA_VERSION_UNAVAILABLE"]);await f.db.query("INSERT INTO fr_schema_migrations SET ?",v);assert.equal((await r.status(a.orderId)).status,"CLOSED");
 });
 await t.test("missing immutable guard is UNKNOWN without repair",async()=>{
  await f.db.query("DROP TRIGGER trg_ful_operation_order_update");assert.deepEqual((await r.status(a.orderId)).reasonCodes,["SCHEMA_INCOMPATIBLE"]);assert.equal((await f.db.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name='trg_ful_operation_order_update'"))[0].length,0);
 });
 await t.test("unavailable connection returns safe UNKNOWN",async()=>{await r.database.shutdown();assert.deepEqual((await r.status(a.orderId)).reasonCodes,["PROVIDER_UNAVAILABLE"]);});
});
nativeTest("DEC029 all12 real Inventory-backed terminal owner projections are observed read-only",async t=>{
 const f=await archiveFactsFixture(t),file=fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url));
 // Use the real migration runner to populate the missing official ledger, never forge installed versions.
 await promisify(execFile)(process.execPath,[file],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const service=new FulfillmentOpenMatterService({database:f.database}),before={},inventoryBefore=(await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0];
 for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS){before[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];assert.ok(before[table].length,table);}
 assert.deepEqual(await service.getOrderArchiveStatus(String(f.s.orderId),{atMs:Date.now()}),{version:"1",status:"CLOSED",reasonCodes:[]});
 const state=await readFulfillmentArchiveState(f.db,String(f.s.orderId));assert.equal(archiveStateFacts(state,Date.now()).inconsistent,false);
 for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS)assert.deepEqual(state[table],before[table],table);
 assert.deepEqual((await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],inventoryBefore);
});

nativeTest("DEC029 real Inventory-backed active Claim/Allocation and reversing Shipment remain OPEN",async t=>{
 const f=await issueFixture(t),file=fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url));await promisify(execFile)(process.execPath,[file],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const service=new FulfillmentOpenMatterService({database:f.database}),status=()=>service.getOrderArchiveStatus(String(f.s.orderId),{atMs:Date.now()});
 const open=await status();assert.equal(open.status,"OPEN");assert.ok(open.reasonCodes.includes("CLAIM_ACTIVE"));assert.ok(open.reasonCodes.includes("ALLOCATION_OUTSTANDING"));
 const event=randomUUID();await f.db.execute("UPDATE shipments SET status='REVERSING',reversal_event_id=?,version=version+1 WHERE id=?",[event,f.shipment]);await f.s.insert("shipment_reversals",{reversal_number:"REV-202610-000001",shipment_id:f.shipment,status:"REVERSING",event_id:event,correlation_id:randomUUID(),reason:"Synthetic in-progress reversal",goods_under_company_control:1,goods_returned_to_original_bins:1,created_at:f.s.now});
 const reversing=await status();assert.equal(reversing.status,"OPEN");assert.ok(reversing.reasonCodes.includes("SHIPMENT_NONTERMINAL"));assert.ok(reversing.reasonCodes.includes("REVERSAL_IN_PROGRESS"));
});
nativeTest("DEC029 mixed-target Audit pagination locks complete global primary IDs in ascending order",async t=>{
 const f=await archiveFactsFixture(t),file=fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url));await promisify(execFile)(process.execPath,[file],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const [[reversal]]=await f.db.query("SELECT id FROM shipment_reversals WHERE shipment_id=?",[f.shipment]);
 const rows=[["SHIPMENT",f.shipment],["REVERSAL",reversal.id],...Array.from({length:501},()=>["FULFILLMENT",f.doc.id])].map(([type,id])=>[type,id,"RECONCILE",randomUUID(),"Synthetic",f.s.now]);
 await f.db.query("INSERT INTO fulfillment_audit_logs(target_type,target_id,action,correlation_id,actor_label,occurred_at) VALUES ?",[rows]);
 const trace=[];await f.run(null,async tx=>{
  const state=await readFulfillmentArchiveState({query(sql,args){if(sql.includes("fulfillment_audit_logs FORCE INDEX"))trace.push(...args.map(String));return tx.query(sql,args);}},String(f.s.orderId),{lock:true});assert.equal(state.fulfillment_audit_logs.length,504);assert.deepEqual(trace,state.fulfillment_audit_logs.map(row=>String(row.id)));assert.equal(new Set(trace).size,504);assert.equal(archiveStateFacts(state,Date.now()).inconsistent,false);
 },{isolationLevel:"REPEATABLE READ"});
});

nativeTest("DEC029 non-null native Shipment DATE is observed without locale or Date coercion",async t=>{
 const f=await issueFixture(t,{shipmentDate:"2023-11-14"}),file=fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url));await promisify(execFile)(process.execPath,[file],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const state=await readFulfillmentArchiveState(f.db,String(f.s.orderId));assert.equal(state.shipments[0].shipment_date,"2023-11-14");assert.equal(archiveStateFacts(state,Date.now()).inconsistent,false);const service=new FulfillmentOpenMatterService({database:f.database});assert.equal((await service.getOrderArchiveStatus(String(f.s.orderId),{atMs:Date.now()})).status,"OPEN");
});

nativeTest("DEC029 fixed lazy adapters use the actual executor but unavailable real job scope cannot authorize mutation",async t=>{
 const f=await createFulfillmentArchiveDatabase(t,{baseOnly:false}),r=runtime(t,f),calls=[],services={require:name=>name==="mysqldatabase"?r.database:{nowMs:()=>Date.now()},async resolve(name){calls.push(name);assert.equal(name,"salesJobs");return {authorizeArchiveReadInTransaction:()=>false,authorizeArchiveInTransaction:()=>false};}};
 const open=new OpenMatterAdapter({services}),archive=new ArchiveAdapter({services});assert.deepEqual(calls,[]);assert.equal((await open.getOrderArchiveStatus("1",{atMs:Date.now()})).status,"CLOSED");assert.deepEqual(calls,[]);
 await r.transaction(async tx=>{assert.deepEqual(await open.getOrderArchiveStatusInTransaction(tx,{orderId:"1",atMs:Date.now()}),{version:"1",status:"UNKNOWN",reasonCodes:["PROVIDER_UNAVAILABLE"]});await assert.rejects(()=>archive.prepareOrderInTransaction(tx,{orderId:"1",archiveBatchId:"1",cutoffMs:1}),{code:"FULFILLMENT_ARCHIVE_FORBIDDEN"});});assert.deepEqual(calls,["salesJobs","salesJobs"]);assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillments_archive"))[0][0].n),0);
});

import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {shipmentFixture} from "../fulfillment/shipmentFixture.js";
import {SalesArchiveLockService} from "../../src/modules/sales/SalesArchiveLockService.js";
const native=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t){const f=await shipmentFixture(t);return {...f,locks:new SalesArchiveLockService({database:f.database}),rr:work=>f.run({claims:f.claims},work,{isolationLevel:"REPEATABLE READ"})};}
async function insert(db,type,target,created=1,status="FAILED"){
 return db.execute("INSERT INTO sales_operation_requests(event_id,command_type,target_type,target_id,request_hash,status,actor_label,created_at,updated_at) VALUES (?,'ARCHIVE_TEST',?,?,?,?,'Synthetic',?,?)",[randomUUID(),type,target,"a".repeat(64),status,created,created]);
}
async function waited(f,connection){const end=performance.now()+5000;while(performance.now()<end){const [[row]]=await f.db.query("SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads th ON th.THREAD_ID=w.REQUESTING_THREAD_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='sales_operation_requests' AND th.PROCESSLIST_ID=?",[f.f.name,connection]);if(Number(row.n)>0)return;await delay(10);}assert.fail("competing intent must enter an actual Sales operation lock wait");}
native("Archive Sales operation prefixes require the actual bound RR executor and exact canonical scope before SQL",async t=>{
 const f=await fixture(t);let calls=0,closed;const forged={query(){calls++;throw Error("unexpected SQL");}};
 for(const tx of [forged,f.db])await assert.rejects(f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[]}),TypeError);
 await f.rr(async tx=>{closed=tx;});await assert.rejects(f.locks.lockOrderOperationsInTransaction(closed,{orderId:String(f.s.orderId),shipmentIds:[]}),TypeError);
 await assert.rejects(f.run({claims:f.claims},tx=>f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[]})),e=>e instanceof TypeError||e.cause instanceof TypeError);
 await f.rr(async tx=>{const query=tx.query.bind(tx);tx.query=(...args)=>{calls++;return query(...args);};for(const scope of [{orderId:1,shipmentIds:[]},{orderId:"01",shipmentIds:[]},{orderId:String(f.s.orderId),shipmentIds:["2","2"]},{orderId:String(f.s.orderId),shipmentIds:["3","2"]},{orderId:String(f.s.orderId),shipmentIds:[],grant:true}])await assert.rejects(f.locks.lockOrderOperationsInTransaction(tx,scope),TypeError);});assert.equal(calls,0);
});
native("Archive Sales source prefix uses the real Shipment ID independently of the SO ID",async t=>{
 const f=await fixture(t),shipmentId=String(f.s.orderId+1000);await f.s.insert("shipments",{...f.row,id:Number(shipmentId)});
 await insert(f.db,"SALES_ORDER",f.s.orderId,0,"SUCCEEDED");await insert(f.db,"FULFILLMENT_SOURCE",shipmentId,0,"IN_PROGRESS");await insert(f.db,"FULFILLMENT_SOURCE",f.s.orderId,0,"IN_PROGRESS");
 await f.rr(async tx=>{const queries=[],query=tx.query.bind(tx);tx.query=(sql,args)=>{queries.push({sql,args});return query(sql,args);};assert.deepEqual(await f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[shipmentId]}),{operationCount:2,hasInProgress:true});assert.equal(queries.length,2);assert.deepEqual(queries.map(q=>q.args.slice(0,2)),[["FULFILLMENT_SOURCE",shipmentId],["SALES_ORDER",String(f.s.orderId)]]);for(const q of queries){assert.match(q.sql,/FORCE INDEX \(idx_sales_operations_target\)/u);assert.match(q.sql,/ORDER BY created_at,id LIMIT 500 FOR UPDATE$/u);assert.doesNotMatch(q.sql,/NOWAIT|SKIP LOCKED/u);}});
});
native("Archive Sales immutable timestamp-ID cursor includes equal timestamps, mixed statuses and the exact empty tail",async t=>{
 const f=await fixture(t),rows=Array.from({length:1000},(_,i)=>[randomUUID(),"UPDATE_ORDER","SALES_ORDER",f.s.orderId,"a".repeat(64),["FAILED","IN_PROGRESS","SUCCEEDED"][i%3],"Synthetic",i<500?0:1,1]);await f.db.query("INSERT INTO sales_operation_requests(event_id,command_type,target_type,target_id,request_hash,status,actor_label,created_at,updated_at) VALUES ?",[rows]);
 await f.rr(async tx=>{const pages=[],query=tx.query.bind(tx);tx.query=async(sql,args)=>{const result=await query(sql,args);pages.push(result[0].length);return result;};assert.deepEqual(await f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[]}),{operationCount:1000,hasInProgress:true});assert.deepEqual(pages,[500,500,0]);});
});
for(const type of ["SALES_ORDER","FULFILLMENT_SOURCE"])native(`Archive empty Sales ${type} prefix blocks a new intent before the Sales root`,async t=>{
 const f=await fixture(t),target=type==="SALES_ORDER"?String(f.s.orderId):String(f.s.orderId+1000);let release,entered,writerEntered;const hold=new Promise(r=>{release=r;}),locked=new Promise(r=>{entered=r;}),started=new Promise(r=>{writerEntered=r;});
 const archive=f.rr(async tx=>{await f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:type==="SALES_ORDER"?[]:[target]});await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[f.s.orderId]);entered();await hold;});await locked;
 const writer=f.run({claims:f.claims},async tx=>{const [[row]]=await tx.query("SELECT CONNECTION_ID() AS id");writerEntered(row.id);await insert(tx,type,target);});const joined=Promise.allSettled([archive,writer]);try{await waited(f,await started);}finally{release();}for(const result of await joined)if(result.status==="rejected")throw result.reason;
});

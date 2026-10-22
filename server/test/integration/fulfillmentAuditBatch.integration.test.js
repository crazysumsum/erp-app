import assert from "node:assert/strict";
import test from "node:test";
import {InventoryAuditService} from "../../src/modules/inventory/InventoryAuditService.js";
import {inventoryNativeFixture} from "../fulfillment/inventoryNativeFixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const input=(f,i=0)=>({actorUserId:f.actor.userId,actorLabel:"Synthetic",action:"allocation.create",targetType:"allocation",targetId:String(i+1),targetLabel:String(i+1),beforeSummary:{allocatedQuantity:i},afterSummary:{allocatedQuantity:i+1},reasonText:"保留原因",requestId:"request",correlationId:"correlation"});
const service=(f,time=f.time)=>new InventoryAuditService({database:f.database,logger:f.logger,time});
nativeTest("P0 audit batches preserve101 immutable event snapshots and timestamps with100-row bound and final tail",async t=>{
 const f=await inventoryNativeFixture(t);let now=100,writes=0;const audit=service(f,{nowMs:()=>now++});
 await f.withActor(async tx=>{const execute=tx.execute.bind(tx);tx.execute=(sql,args)=>{writes++;assert.equal(args.length,writes===1?1600:16);return execute(sql,args);};const batch=audit.createSucceededBatch(tx);
  for(let i=0;i<101;i++){const event=input(f,i);await batch.record(event);event.beforeSummary.allocatedQuantity=999;event.afterSummary.allocatedQuantity=999;event.reasonText="changed";}
  assert.equal(writes,1);await batch.flush();await batch.flush();assert.equal(writes,2);
 });
 const [rows]=await f.db.query("SELECT * FROM inventory_audit_logs ORDER BY id");assert.equal(rows.length,101);
 for(const [i,row]of rows.entries()){assert.equal(Number(row.occurred_at),100+i);assert.equal(row.actor_user_id,f.actor.userId);assert.equal(row.actor_label,"Synthetic");assert.equal(row.action,"allocation.create");assert.equal(row.target_id,i+1);assert.equal(row.target_label,String(i+1));assert.equal(row.outcome,"SUCCEEDED");assert.equal(row.reason_text,"保留原因");assert.deepEqual(row.before_summary,{allocatedQuantity:i});assert.deepEqual(row.after_summary,{allocatedQuantity:i+1});assert.equal(row.request_id,"request");assert.equal(row.correlation_id,"correlation");assert.equal(row.operation_request_id,null);}
 await assert.rejects(f.db.execute("UPDATE inventory_audit_logs SET reason_text='changed' WHERE id=?",[rows[0].id]));await assert.rejects(f.db.execute("DELETE FROM inventory_audit_logs WHERE id=?",[rows[0].id]));
});
nativeTest("P0 audit batch retains owner validation and an invalid later event rolls earlier100 rows back",async t=>{
 const f=await inventoryNativeFixture(t),audit=service(f);
 for(const bad of [{action:"unknown"},{afterSummary:{token:"unsafe"}},{reasonText:"x".repeat(501)},{actorLabel:"bad\nlabel"},{actorUserId:0}]){
  await assert.rejects(f.withActor(async tx=>{const batch=audit.createSucceededBatch(tx);for(let i=0;i<100;i++)await batch.record(input(f,i));await batch.record({...input(f,100),...bad});await batch.flush();}),error=>error.cause instanceof TypeError);
  const [[row]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs");assert.equal(row.n,0);
 }
});
nativeTest("P0 audit final-tail FK failure rolls earlier100 rows back and poisons the buffer",async t=>{
 const f=await inventoryNativeFixture(t),audit=service(f);let writes=0;
 await assert.rejects(f.withActor(async tx=>{const execute=tx.execute.bind(tx);tx.execute=(...args)=>{writes++;return execute(...args);};const batch=audit.createSucceededBatch(tx);for(let i=0;i<100;i++)await batch.record(input(f,i));await batch.record({...input(f,100),operationRequestId:Number.MAX_SAFE_INTEGER});let failure;try{await batch.flush();}catch(error){failure=error;}assert.ok(failure);await assert.rejects(()=>batch.flush());await assert.rejects(()=>batch.record(input(f,101)));throw failure;}));
 assert.equal(writes,2);const [[row]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs");assert.equal(row.n,0);
});
nativeTest("P0 audit batches reject autocommit, forged and closed transactions before SQL",async t=>{
 const f=await inventoryNativeFixture(t),audit=service(f);let writes=0,closed,batch;const fake={isolationLevel:"READ COMMITTED",execute(){writes++;}};
 for(const tx of [null,f.db,fake])assert.throws(()=>audit.createSucceededBatch(tx),TypeError);
 await f.withActor(async tx=>{closed=tx;batch=audit.createSucceededBatch(tx);await batch.record(input(f));});
 assert.throws(()=>audit.createSucceededBatch(closed),TypeError);await assert.rejects(()=>batch.flush(),TypeError);await assert.rejects(()=>batch.record(input(f)),TypeError);assert.equal(writes,0);
 const [[row]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs");assert.equal(row.n,0);
});
nativeTest("P0 audit in-flight record or flush fails closed without losing or duplicating events",async t=>{
 const f=await inventoryNativeFixture(t),audit=service(f);
 for(const concurrent of ["record","flush"]){let writes=0;
  await assert.rejects(f.withActor(async tx=>{
   let entered,release;const barrier=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;}),execute=tx.execute.bind(tx);
   tx.execute=async(...args)=>{writes++;entered();await gate;return execute(...args);};
   const batch=audit.createSucceededBatch(tx);for(let i=0;i<99;i++)await batch.record(input(f,i));const pending=batch.record(input(f,99));
   await barrier;try{await assert.rejects(()=>concurrent==="record"?batch.record(input(f,100)):batch.flush(),/already flushing/u);}finally{release();}
   await pending;await batch.flush();
  }),error=>error.cause instanceof TypeError&&/has failed/u.test(error.cause.message));
  assert.equal(writes,1);const [[row]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs");assert.equal(row.n,0);
 }
});

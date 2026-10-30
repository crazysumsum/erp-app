import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {inventoryNativeFixture} from "../fulfillment/inventoryNativeFixture.js";
import {claimFulfillmentInventoryBatch} from "../../src/modules/inventory/inventoryFulfillmentReceipts.js";
import {assertOwnedOperationWait} from "../fulfillment/inventoryConcurrency.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const rc={isolationLevel:"READ COMMITTED"};
const inputs=(f,n,event=randomUUID())=>Array.from({length:n},(_,i)=>({commandType:"ALLOCATION_REALLOCATE",source:{module:"FULFILLMENT",documentType:"PICK",documentId:"1",lineId:String(i+1),eventId:event},payload:{quantity:1},actorUserId:f.actor.userId,actorLabel:"Synthetic",createdAt:1}));
const facts=f=>f.db.query("SELECT * FROM inventory_operation_requests ORDER BY id").then(([rows])=>rows);
nativeTest("Reallocate child batches persist exact real IDs and all pending records across100 boundary",async t=>{
 const f=await inventoryNativeFixture(t),values=inputs(f,101);let calls=0;
 const claims=await f.withActor(async tx=>{const execute=tx.execute.bind(tx);tx.execute=(...args)=>{calls++;return execute(...args);};return [...await f.operations.claimReallocationChildren(tx,values.slice(0,100)),...await f.operations.claimReallocationChildren(tx,values.slice(100))];},rc);
 assert.equal(calls,2);const rows=await facts(f);assert.equal(rows.length,101);for(const [i,v]of values.entries()){const row=rows.find(r=>r.source_line_id===v.source.lineId);assert.equal(Number(row.id),claims[i].operationId);assert.equal(row.completed_at,null);assert.equal(row.result_summary,null);}
});
nativeTest("Reallocate child duplicate classifications preserve whole transaction rollback",async t=>{
 const f=await inventoryNativeFixture(t);
 for(const kind of ["hash","pending","completed"]){const values=inputs(f,3),old=await f.operations.claim(f.db,{...values[1],...(kind==="hash"?{payload:{quantity:2}}:{})});
  if(kind==="completed")await f.operations.complete(f.db,{operationId:old.operationId,resultType:"FULFILLMENT_REALLOCATE_MEMBER",resultId:"2",resultSummary:null,completedAt:2});
  const before=await facts(f);await assert.rejects(f.withActor(tx=>f.operations.claimReallocationChildren(tx,values),rc),{code:kind==="pending"?"CONCURRENT_OPERATION":"INVENTORY_SOURCE_CONFLICT"});assert.deepEqual(await facts(f),before);
 }
});
nativeTest("Reallocate later child batch collision rolls back all earlier batches",async t=>{
 const f=await inventoryNativeFixture(t),values=inputs(f,101);await f.operations.claim(f.db,values[100]);const before=await facts(f);
 await assert.rejects(f.withActor(async tx=>{await f.operations.claimReallocationChildren(tx,values.slice(0,100));await f.operations.claimReallocationChildren(tx,values.slice(100));},rc),{code:"CONCURRENT_OPERATION"});assert.deepEqual(await facts(f),before);
});
nativeTest("Reallocate child FK failure rolls back previous batch and preserves DB error",async t=>{
 const f=await inventoryNativeFixture(t),values=inputs(f,2),before=await facts(f);
 await assert.rejects(f.withActor(async tx=>{await f.operations.claimReallocationChildren(tx,[values[0]]);await f.operations.claimReallocationChildren(tx,[{...values[1],actorUserId:9007199254740991}]);},rc),e=>e.cause?.code==="ER_NO_REFERENCED_ROW_2");assert.deepEqual(await facts(f),before);
});
nativeTest("Reallocate batch builder retains member then leg identity through partial chunks",async t=>{
 const f=await inventoryNativeFixture(t),members=Array.from({length:51},(_,i)=>({claimId:String(i+1),inventoryReservationId:String(i+1),expectedVersion:1,baseQuantity:"1",releases:[{inventoryAllocationId:String(i+1),baseQuantity:"1"}],allocations:[{inventoryBalanceId:"1",baseQuantity:"1"}]}));
 const batch=await f.withActor(tx=>claimFulfillmentInventoryBatch(tx,{operations:f.operations,action:"REALLOCATE",payload:{fulfillmentId:"1",lines:[{fulfillmentLineId:"1",salesOrderLineId:"1",baseQuantity:"50",reservations:members.slice(0,50)},{fulfillmentLineId:"2",salesOrderLineId:"2",baseQuantity:"1",reservations:members.slice(50)}]},source:{eventId:randomUUID()},actor:f.actor,actorLabel:"Synthetic",timestamp:1,correlationId:""}),rc);
 const rows=await facts(f);assert.equal(rows.length,154);assert.equal(batch.members.length,51);
 for(const [i,m]of batch.members.entries()){assert.equal(m.input.claimId,String(i+1));assert.equal(m.legs.length,2);assert.deepEqual(m.legs.map(l=>l.kind),["RELEASE","ALLOCATE"]);for(const l of m.legs){const row=rows.find(r=>Number(r.id)===l.operationId);assert.equal(row.source_line_id,`${i+1}:${l.ordinal}`);assert.equal(row.request_hash,l.requestHash);}}
 assert.ok(Math.max(...batch.members.map(m=>m.operationId))<Math.min(...batch.members.flatMap(m=>m.legs.map(l=>l.operationId))));
});
nativeTest("Reallocate competing child insertion waits then rejects incomplete duplicate without partial rows",async t=>{
 const f=await inventoryNativeFixture(t),values=inputs(f,2);let entered,release,waiterReady,waiterId;
 const held=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{waiterReady=r;});
 const winner=f.withActor(async tx=>{await f.operations.claimReallocationChildren(tx,[values[0]]);entered();await gate;},rc);
 const winnerOutcome=Promise.allSettled([winner]);winner.catch(entered);
 await held;
 const waiter=f.withActor(async tx=>{waiterId=(await tx.query("SELECT CONNECTION_ID() AS id"))[0][0].id;waiterReady();await f.operations.claimReallocationChildren(tx,values);},rc);
 const waiterOutcome=Promise.allSettled([waiter]);waiter.catch(waiterReady);await ready;
 let failure;try{await assertOwnedOperationWait(f,waiterId);}catch(error){failure=error;}finally{release();}
 const [a]=await winnerOutcome,[b]=await waiterOutcome;if(failure)throw failure;assert.equal(a.status,"fulfilled");assert.equal(b.status,"rejected");assert.equal(b.reason.code,"CONCURRENT_OPERATION");
 const rows=await facts(f);assert.equal(rows.length,1);assert.equal(rows[0].source_line_id,"1");assert.equal(rows[0].completed_at,null);
});
nativeTest("Reallocate first conflicting child never waits on an unrelated later locked child",async t=>{
 const f=await inventoryNativeFixture(t),values=inputs(f,2);
 await f.operations.claim(f.db,{...values[0],payload:{quantity:2}});const second=await f.operations.claim(f.db,values[1]);
 let held,release,id,ready;const locked=new Promise(r=>{held=r;}),gate=new Promise(r=>{release=r;}),identified=new Promise(r=>{ready=r;});
 const holder=f.withActor(async tx=>{await tx.query("SELECT id FROM inventory_operation_requests WHERE id=? FOR UPDATE",[second.operationId]);held();await gate;},rc);
 const holderOutcome=Promise.allSettled([holder]);holder.catch(held);await locked;
 let settled=false;const challenger=f.withActor(async tx=>{id=(await tx.query("SELECT CONNECTION_ID() AS id"))[0][0].id;ready();return f.operations.claimReallocationChildren(tx,values);},rc);
 const outcome=Promise.allSettled([challenger]);challenger.then(()=>{settled=true;ready();},()=>{settled=true;ready();});await identified;
 let failure;try{const deadline=performance.now()+3000;while(true){if(settled)break;
  assert.ok(performance.now()<deadline,"first conflict must resolve without releasing the unrelated later lock");
  const [[wait]]=await f.db.query(`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads th ON th.THREAD_ID=l.THREAD_ID WHERE l.OBJECT_SCHEMA=? AND th.PROCESSLIST_ID=?`,[f.name,id]);assert.equal(Number(wait.n),0);await new Promise(r=>{setImmediate(r);});
 }}catch(error){failure=error;}finally{release();}
 const [h]=await holderOutcome,[c]=await outcome;if(failure)throw failure;assert.equal(h.status,"fulfilled");assert.equal(c.status,"rejected");assert.equal(c.reason.code,"INVENTORY_SOURCE_CONFLICT");assert.equal((await facts(f)).length,2);
});

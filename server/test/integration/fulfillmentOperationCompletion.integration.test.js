import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {inventoryNativeFixture} from "../fulfillment/inventoryNativeFixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function pending(f,count){const entries=[];for(let i=0;i<count;i++){const operation=await f.operations.claim(f.db,{commandType:"ALLOCATION_CREATE",source:{module:"FULFILLMENT",documentType:"PICK",documentId:"1",lineId:String(i+1),eventId:randomUUID()},payload:{quantity:1},actorUserId:f.actor.userId,actorLabel:"Synthetic",createdAt:1});entries.push({operationId:operation.operationId,resultType:"FULFILLMENT_LEG",resultId:String(i+1),resultSummary:i===0?null:{quantity:1,status:"ACTIVE"},completedAt:2});}return entries;}
nativeTest("P0 bounded owner receipt completion persists all100 exact validated results",async t=>{
 const f=await inventoryNativeFixture(t),entries=await pending(f,100);await f.withActor(tx=>f.operations.completeBatch(tx,entries));
 const [rows]=await f.db.query("SELECT id,result_type,result_id,result_summary,completed_at FROM inventory_operation_requests WHERE id IN (?) ORDER BY id",[entries.map(e=>e.operationId)]);
 assert.equal(rows.length,100);for(const [i,row]of rows.entries()){assert.equal(String(row.id),String(entries[i].operationId));assert.equal(row.result_type,entries[i].resultType);assert.equal(row.result_id,entries[i].resultId);assert.deepEqual(row.result_summary,entries[i].resultSummary);assert.equal(Number(row.completed_at),2);}
});
nativeTest("P0 bounded owner completion rejects duplicate IDs, oversized batches and unsafe summaries before writing",async t=>{
 const f=await inventoryNativeFixture(t),entries=await pending(f,2);let writes=0;
 await f.withActor(async tx=>{const execute=tx.execute.bind(tx);tx.execute=(...args)=>{writes++;return execute(...args);};
  for(const input of [null,{},[],Array(101).fill(entries[0]),[entries[0],{...entries[0],operationId:String(entries[0].operationId)}],[entries[0],{...entries[1],resultSummary:{token:"synthetic"}}]])await assert.rejects(()=>f.operations.completeBatch(tx,input),TypeError);
 });
 assert.equal(writes,0);const [[row]]=await f.db.query("SELECT COUNT(*) AS count FROM inventory_operation_requests WHERE completed_at IS NOT NULL");assert.equal(row.count,0);
});
nativeTest("P0 one conflicting receipt CAS rolls the entire bounded completion transaction back",async t=>{
 const f=await inventoryNativeFixture(t),entries=await pending(f,3);await f.operations.complete(f.db,entries[1]);const [before]=await f.db.query("SELECT * FROM inventory_operation_requests ORDER BY id");
 await assert.rejects(f.withActor(tx=>f.operations.completeBatch(tx,entries)),{code:"CONCURRENT_OPERATION"});
 await assert.rejects(f.withActor(tx=>f.operations.completeBatch(tx,[entries[0],{...entries[2],operationId:Number.MAX_SAFE_INTEGER}])),{code:"CONCURRENT_OPERATION"});const [after]=await f.db.query("SELECT * FROM inventory_operation_requests ORDER BY id");assert.deepEqual(after,before);
});

nativeTest("P0 bounded completion rejects autocommit, forged and closed executors before SQL",async t=>{
 const f=await inventoryNativeFixture(t),entries=await pending(f,1);let writes=0,closed;const fake={isolationLevel:"READ COMMITTED",execute(){writes++;throw Error("SQL must not execute");}};
 await assert.rejects(()=>f.operations.completeBatch(f.db,entries),TypeError);await assert.rejects(()=>f.operations.completeBatch(fake,entries),TypeError);
 await f.withActor(async tx=>{closed=tx;const execute=tx.execute.bind(tx);tx.execute=(...args)=>{writes++;return execute(...args);};});
 await assert.rejects(()=>f.operations.completeBatch(closed,entries),TypeError);assert.equal(writes,0);
 const [[row]]=await f.db.query("SELECT COUNT(*) AS count FROM inventory_operation_requests WHERE completed_at IS NOT NULL");assert.equal(row.count,0);
});

nativeTest("P0 a later bounded receipt SQL failure rolls the earlier written chunk back",async t=>{
 const f=await inventoryNativeFixture(t),entries=await pending(f,200);const [before]=await f.db.query("SELECT * FROM inventory_operation_requests ORDER BY id");let writes=0;
 await assert.rejects(f.withActor(async tx=>{const execute=tx.execute.bind(tx);tx.execute=(...args)=>{if(++writes===2)throw Error("synthetic second receipt chunk failure");return execute(...args);};await f.operations.completeBatch(tx,entries.slice(0,100));await f.operations.completeBatch(tx,entries.slice(100));}),error=>error.cause?.message==="synthetic second receipt chunk failure");
 assert.equal(writes,2);const [after]=await f.db.query("SELECT * FROM inventory_operation_requests ORDER BY id");assert.deepEqual(after,before);
});

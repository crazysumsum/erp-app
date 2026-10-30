import assert from "node:assert/strict";
import test from "node:test";
import {InventoryOperationService,inventoryOperationHash} from "../src/modules/inventory/InventoryOperationService.js";
import {MySqlDatabaseService} from "../src/services/mysqldatabase/MySqlDatabaseService.js";
import {RequestContextService} from "../src/services/context/RequestContextService.js";
import {createTestTime,servicesWithTime} from "../test-support/createTestTime.js";

const input=i=>({commandType:"ALLOCATION_REALLOCATE",source:{module:"FULFILLMENT",documentType:"PICK",documentId:"8",lineId:String(i),eventId:"event"},payload:{quantity:1},actorUserId:7,actorLabel:"Synthetic",createdAt:1});
const row=(v,id)=>({id,command_type:v.commandType,source_module:v.source.module,source_document_type:v.source.documentType,source_document_id:v.source.documentId,source_line_id:v.source.lineId,source_event_id:v.source.eventId,request_hash:inventoryOperationHash(v),result_type:null,result_id:null,result_summary:null,completed_at:null});
async function transaction(work,{execute=async()=>[{affectedRows:1}],query=async()=>[[]],isolationLevel="READ COMMITTED"}={}){
 const connection={query:async(s,p)=>String(typeof s==="string"?s:s.sql).startsWith("SET ")?[[]]:query(typeof s==="string"?s:s.sql,p),execute:async(s,p)=>execute(s.sql,p),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
 const database=new MySqlDatabaseService({pool:{query:connection.query,getConnection:async()=>connection},config:{queryTimeoutMs:2000,acquireTimeoutMs:2000,transactionTimeoutMs:20000},logger:{debug:async()=>{},error:async()=>{}},context:new RequestContextService({services:servicesWithTime(createTestTime())})});
 return database.withTransaction(work,{isolationLevel});
}
const service=new InventoryOperationService();
for(const size of [1,99,100])test(`Reallocation child claims map ${size} real nonconsecutive IDs in input order`,async()=>{
 const inputs=Array.from({length:size},(_,i)=>input(i+1));let writes=0,reads=0;
 const result=await transaction(tx=>service.claimReallocationChildren(tx,inputs),{execute:async(sql,params)=>{writes++;assert.match(sql,/^INSERT INTO inventory_operation_requests/u);assert.equal(params.length,size*12);return [{affectedRows:size,insertId:9999}];},query:async(sql,params)=>{reads++;assert.equal(params.length,size+4);assert.doesNotMatch(sql,/FOR UPDATE/u);return [inputs.map((v,i)=>row(v,10+i*3)).reverse()];}});
 assert.deepEqual(result,inputs.map((_,i)=>({operationId:10+i*3,replay:null})));assert.equal(writes,1);assert.equal(reads,1);
});
test("Reallocation child bounds, scope and legacy validators reject before SQL",async()=>{
 let calls=0;
 await transaction(async tx=>{
  for(const values of [[],Array(101).fill(input(1)),[input(1),input(1)],[input(1),{...input(2),source:{...input(2).source,eventId:"other"}}],[{...input(1),actorLabel:""}],[{...input(1),commandType:"ALLOCATION_CREATE"}]])await assert.rejects(()=>service.claimReallocationChildren(tx,values),TypeError);
 },{execute:async()=>{calls++;throw Error("unexpected SQL");}});assert.equal(calls,0);
});
test("Reallocation child claims reject RR, forged and closed executors",async()=>{
 await assert.rejects(()=>service.claimReallocationChildren({execute(){},query(){},isolationLevel:"READ COMMITTED"},[input(1)]),TypeError);
 await transaction(tx=>assert.rejects(()=>service.claimReallocationChildren(tx,[input(1)]),TypeError),{isolationLevel:"REPEATABLE READ"});
 let closed;await transaction(tx=>{closed=tx;});await assert.rejects(()=>service.claimReallocationChildren(closed,[input(1)]),TypeError);
});
test("Reallocation child readback rejects missing, extra, duplicate, foreign, wrong hash and completed records",async()=>{
 const a=row(input(1),1),b=row(input(2),2);
 for(const found of [[],[a],[a,b,row(input(3),3)],[a,a],[a,{...b,id:1}],[a,{...b,source_event_id:"other"}],[a,{...b,request_hash:"x"}],[a,{...b,command_type:"ALLOCATION_CREATE"}],[a,{...b,result_summary:{}}],[a,{...b,completed_at:1}]])await assert.rejects(()=>transaction(tx=>service.claimReallocationChildren(tx,[input(1),input(2)]),{execute:async()=>[{affectedRows:2}],query:async()=>[found]}),{code:"INVENTORY_SOURCE_CONFLICT"});
});
test("Reallocation duplicate uses first logical conflicting key and preserves error classification",async()=>{
 const duplicate=Object.assign(Error("duplicate"),{code:"ER_DUP_ENTRY"});
 for(const [found,code]of [[[row(input(2),2),{...row(input(1),1),request_hash:"wrong"}],"INVENTORY_SOURCE_CONFLICT"],[[row(input(1),1),{...row(input(2),2),request_hash:"wrong"}],"CONCURRENT_OPERATION"],[[{...row(input(1),1),completed_at:1,result_summary:null}],"INVENTORY_SOURCE_CONFLICT"]]){
  const keys=[];
  await assert.rejects(()=>transaction(tx=>service.claimReallocationChildren(tx,[input(1),input(2)]),{execute:async()=>{throw duplicate;},query:async(sql,params)=>{assert.match(sql,/FOR UPDATE$/u);assert.doesNotMatch(sql,/\bIN\s*\(/u);keys.push(params[3]);return [found.filter(row=>row.source_line_id===params[3])];}}),{code});
  assert.deepEqual(keys,["1"]);
 }
});
test("Reallocation unknown duplicate, FK, deadlock and timeout are not converted into successful claims",async()=>{
 for(const code of ["ER_DUP_ENTRY","ER_NO_REFERENCED_ROW_2","ER_LOCK_DEADLOCK","ER_LOCK_WAIT_TIMEOUT"]){let reads=0;await assert.rejects(()=>transaction(tx=>service.claimReallocationChildren(tx,[input(1)]),{execute:async()=>{throw Object.assign(Error(code),{code});},query:async()=>{reads++;return [[]];}}),e=>e.cause?.code===code);assert.equal(reads,code==="ER_DUP_ENTRY"?1:0);}
 await assert.rejects(()=>transaction(tx=>service.claimReallocationChildren(tx,[input(1)]),{execute:async()=>[{affectedRows:0}]}),{code:"CONCURRENT_OPERATION"});
});

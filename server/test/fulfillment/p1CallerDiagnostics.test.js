import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {MySqlDatabaseService} from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import {capacityDiagnostics} from "./p1CapacityDiagnostics.js";
import {callerDiagnostics} from "./p1CallerDiagnostics.js";
import {postingDiagnostics,tracePostingAsync,tracePostingSync,markPostingTailStart} from "./p1PostingDiagnostics.js";
import {callerTraceManifest} from "./p1CallerTraceSource.js";
import {transformPostingSource} from "./p1PostingTraceSource.js";
function fixture(){
 let context={};const after=[],messages=[],t={after:fn=>after.push(fn),diagnostic:value=>messages.push(JSON.parse(value))};
 const connection={query:async()=>[[]],execute:async()=>[{affectedRows:1}],async beginTransaction(){},async commit(){},async rollback(){},release(){},destroy(){}};
 const database=new MySqlDatabaseService({pool:{query:connection.query,getConnection:async()=>connection},context:{get:()=>context,update:v=>{context={...context,...v};}},config:{acquireTimeoutMs:1000,queryTimeoutMs:1000,transactionTimeoutMs:20000}}),original=database.withTransaction,parent=capacityDiagnostics(t,database);
 return {database,parent,t,original,messages,finish(){after.forEach(fn=>fn());return messages.find(m=>m.postingDiagnostics);}};
}
test("Caller root selects actual RC phases, marks one successful provider return and excludes RR Inquiry",async()=>{
 const f=fixture(),input={privateValue:"never-log"},owner={async post(tx,value){assert.equal(this,owner);assert.equal(value,input);await tx.execute("UPDATE inventory_reservations SET version=version+1",[input]);return input;}},original=owner.post;
 callerDiagnostics(f.t,f.database,tx=>f.parent.transactionInfo(tx)).inventory(owner,"post");
 for(const phase of ["CREATE","REALLOCATE_ROLLBACK","REALLOCATE"]){
  await f.parent.phase(phase,()=>f.database.withTransaction(async tx=>{
   await tx.query("SELECT 1");assert.equal(await owner.post(tx,input),input);
   await tracePostingAsync("F_SAVE_PROJECTIONS",()=>tx.execute("INSERT INTO fulfillment_allocations (id) VALUES (?)",[input]));
   tracePostingSync("F_ASSERT_OWNER",()=>7);await tx.query("SELECT 2");
  },{isolationLevel:"READ COMMITTED"}));
 }
 await f.parent.phase("REALLOCATE",()=>f.database.withTransaction(tx=>tx.query("SELECT 3")));
 const result=f.finish();assert.equal(result.records.length,2);assert.equal(f.database.withTransaction,f.original);assert.equal(owner.post,original);
 for(const record of result.records){assert.equal(record.parent.timeoutMs,20000);assert.equal(record.instrumentationComplete,true);assert.equal(record.tail.qualified,true);assert.equal(record.tail.sql.F_NEW_PROJECTION.executes,1);assert.equal(record.tail.sql.OTHER_SELECT.queries,1);assert.equal(record.tail.sql.RESERVATION_CAS.executes,0);assert.equal(record.spans.F_SAVE_PROJECTIONS.entered,1);assert.ok(record.spans.F_SAVE_PROJECTIONS.firstOffsetMs>=record.tailStartOffsetMs);assert.ok(Math.abs(record.tail.elapsedMs-record.tail.childMs-record.tail.directSqlMs-record.tail.otherWallMs)<0.001);}
 assert.equal(JSON.stringify(result).includes("never-log"),false);
});
test("Failed provider does not create a post-return marker and retains original error identity",async()=>{
 const f=fixture(),error=new Error("original failure"),owner={async post(){throw error;}};callerDiagnostics(f.t,f.database,tx=>f.parent.transactionInfo(tx)).inventory(owner,"post");
 await assert.rejects(f.parent.phase("REALLOCATE",()=>f.database.withTransaction(tx=>owner.post(tx),{isolationLevel:"READ COMMITTED"})),e=>e.cause===error||e===error);
 const r=f.finish().records[0];assert.equal(r.tailStarted,undefined);assert.equal(r.tail,undefined);assert.equal(r.spans.CALLER_TRANSACTION.failed,1);
});
test("Marker wrong executor, duplicate and nonquiescent child cannot qualify a capture",async()=>{
 for(const variant of ["wrong","duplicate","child"]){
  const after=[],messages=[],tx={async query(){return [[]];},async execute(){return [{affectedRows:1}];}},owner={async run(actual){return tracePostingAsync("CALLER_TRANSACTION",async()=>{
   if(variant==="wrong")assert.equal(markPostingTailStart({}),false);
   if(variant==="duplicate"){assert.equal(markPostingTailStart(actual),true);assert.equal(markPostingTailStart(actual),false);}
   if(variant==="child")await tracePostingAsync("CALLER_TRANSACTION",async()=>assert.equal(markPostingTailStart(actual),false));
  });}};
  postingDiagnostics({after:fn=>after.push(fn),diagnostic:v=>messages.push(JSON.parse(v))},{config:{transactionTimeoutMs:20000}},()=>({ordinal:6,phase:"REALLOCATE",timeoutMs:20000}),{rootLabel:"CALLER_TRANSACTION"}).provider(owner,"run");await owner.run(tx);after.forEach(fn=>fn());assert.equal(messages[0].records[0].observerInvalid,true);
 }
});
test("Pending callback and span survive watchdog rejection as an explicit unqualified as-of snapshot",async t=>{
 const f=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let child;const keepAlive=setInterval(()=>{},1000);t.after(()=>{clearInterval(keepAlive);gate.resolve();});
 callerDiagnostics(f.t,f.database,tx=>f.parent.transactionInfo(tx));
 await assert.rejects(f.parent.phase("REALLOCATE",()=>f.database.withTransaction(async tx=>{
  markPostingTailStart(tx);child=tracePostingAsync("F_SAVE_PROJECTIONS",async()=>{entered.resolve();await gate.promise;});await child;
 },{isolationLevel:"READ COMMITTED",timeoutMs:20})),{code:"DATABASE_TRANSACTION_TIMEOUT"});
 await entered.promise;const record=f.finish().records[0];assert.equal(record.timeoutMs,20);assert.equal(record.parent.timeoutMs,20);assert.equal(record.settled,false);assert.equal(record.spans.F_SAVE_PROJECTIONS.inFlight,1);assert.ok(record.spans.F_SAVE_PROJECTIONS.inFlightMs>0);assert.equal(record.tail.callbackSpanSettled,false);assert.equal(record.tail.qualified,false);gate.resolve();await child;clearInterval(keepAlive);
});
test("Caller AST targets are pinned, class-qualified and restore unchanged business code",async()=>{
 let targets=0;
 for(const [name,entry]of Object.entries(callerTraceManifest)){
  const source=await readFile(new URL("../../src/modules/"+name,import.meta.url),"utf8"),result=transformPostingSource(name,source,"file:///caller-helper.js",callerTraceManifest);targets+=result.proof.spans.length;assert.equal(result.proof.businessAstEquivalent,true);assert.equal(result.proof.originalSha256,entry.sha256);assert.throws(()=>transformPostingSource(name,source+"\n","file:///caller-helper.js",callerTraceManifest),/baseline changed/u);
  if(name.endsWith("FulfillmentOperationService.js")){const altered=structuredClone(callerTraceManifest);altered[name].targets.complete.className="OtherClass";assert.throws(()=>transformPostingSource(name,source,"file:///caller-helper.js",altered),/Missing posting trace target/u);altered[name].targets.complete.className="FulfillmentOperationService";altered[name].targets.complete.async=false;assert.throws(()=>transformPostingSource(name,source,"file:///caller-helper.js",altered));}
 }
 assert.equal(targets,10);
});

test("Five-module thirteen-target output pins four unchanged modules and approved child-claim receipts",async()=>{
 const expected={"inventoryFulfillmentAllocation.js":"91734b625d764ed8ed9cf6303b10a5c753444a7d9495d32cf843e3e67d6cdc70","InventoryPickSequenceService.js":"b732e9c4203fd80ffe4ff60b930f785f012e5daa434b87b2766777c7a6773d54","InventoryLockService.js":"36737121048a154e161eace45b7daa8e3bdd1eb270a85744cd4147e17808c271","inventoryFulfillmentReceipts.js":"a8f16854c75da4bcbd83f7d8e54b8b58cf4d3e606fb05c3a450f640628cfdaa0","InventoryAuditService.js":"fe63d8020d44cee95a8b24b712ee06916231ac8b64169e701328b7b1ced69f9e"};
 for(const [name,sha]of Object.entries(expected)){const source=await readFile(new URL("../../src/modules/inventory/"+name,import.meta.url),"utf8");assert.equal(transformPostingSource(name,source,"file:///fixed-diagnostic-helper.js").proof.transformedSha256,sha);}
});
test("Caller selector observer errors never replace the business result or original error",async()=>{
 for(const failure of [false,true]){
  const f=fixture(),observerError=new Error("observer"),businessError=new Error("business");let called=0;
  callerDiagnostics(f.t,f.database,()=>{throw observerError;});
  const work=()=>{called++;if(failure)throw businessError;return 42;};
  if(failure)await assert.rejects(f.database.withTransaction(work,{isolationLevel:"READ COMMITTED"}),e=>e===businessError||e.cause===businessError);else assert.equal(await f.database.withTransaction(work,{isolationLevel:"READ COMMITTED"}),42);
  f.finish();assert.equal(called,1);assert.equal(f.messages.find(m=>m.callerSelectionDiagnostics).selectionFailures,1);
 }
});
test("Caller Inventory wrapper preserves synchronous throw and return identities",()=>{
 const after=[],t={after:fn=>after.push(fn),diagnostic(){}},database={withTransaction(){},config:{transactionTimeoutMs:20000}},error=new Error("native sync failure"),result={ok:true},owner={post(){throw error;},value(){return result;}};
 const capture=callerDiagnostics(t,database,()=>null);capture.inventory(owner,"post");capture.inventory(owner,"value");assert.throws(()=>owner.post({}),e=>e===error);assert.equal(owner.value({}),result);after.forEach(fn=>fn());
});
test("Caller phase metadata getter failure is an observer failure and cannot suppress business work",async()=>{
 const f=fixture();let called=0;callerDiagnostics(f.t,f.database,()=>Object.defineProperty({},"phase",{get(){throw Error("observer getter");}}));
 assert.equal(await f.database.withTransaction(()=>{called++;return 43;},{isolationLevel:"READ COMMITTED"}),43);f.finish();assert.equal(called,1);assert.equal(f.messages.find(m=>m.callerSelectionDiagnostics).selectionFailures,1);
});

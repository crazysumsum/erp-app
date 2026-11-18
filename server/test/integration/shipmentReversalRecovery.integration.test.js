import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readdir,readFile } from "node:fs/promises";
import path from "node:path";
import { reversalFixture,startReversal,completeReversal,facts,removeReversePermission,
 observeCommittedInputs,assertCommittedReversal,reversalRecoveryRuntime,boundReversalCleanup } from "../fulfillment/shipmentReversalFixture.js";
import { getTransactionOutcome } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";

const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const nativeOptions={timeout:120000};
const operation=(snapshot,f)=>snapshot.fulfillment_operation_requests.find(row=>row.event_id===f.command.eventId);
async function expire(f){
 const [changed]=await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=0,next_attempt_at=NULL WHERE id=? AND event_id=? AND status='IN_PROGRESS'",[f.started.operationId,f.command.eventId]);assert.equal(changed.affectedRows,1);
}
async function ownedRuntime(f,t){
 const runtime=await reversalRecoveryRuntime({applicationSource:f.f.applicationSource,eventId:f.command.eventId,shipmentId:f.shipmentId});
 const previous=f.f.cleanup.shutdown;
 f.f.cleanup.shutdown=async()=>{try{await runtime.close();}catch(error){f.f.cleanup.preserveSchema=true;throw error;}t.diagnostic(JSON.stringify({id:"TASK036-RECOVERY-cleanup",eventId:f.command.eventId,...runtime.state.cleanup}));await previous?.();};
 await runtime.start();return runtime;
}
function sameIdentity(before,after){
 for(const field of ["id","event_id","operation_type","target_type","target_id","payload_hash","initiated_by","correlation_id"])
  assert.deepEqual(after[field],before[field],field+" original identity");
}
function assertNoWriter(runtime){assert.equal(runtime.state.takeovers.length,0);assert.equal(runtime.state.phaseBs,0);assert.equal(runtime.state.preclaims,0);assert.equal(runtime.state.posts,0);}

nativeTest("TASK036-RECOVERY genuine Job restart and stale writer fence",nativeOptions,async t=>{
 const f=await reversalFixture(t,{twoLines:true,archives:true,noDownstream:true,preflightConfiguration:true});await startReversal(f);await expire(f);
 const before=await facts(f),old=operation(before,f),entered=Promise.withResolvers(),resume=Promise.withResolvers(),originalTransaction=f.database.withTransaction;
 let paused=false,oldClaims=0,worker;const controller=new AbortController(),callbacks=new Set();
 const inventory=f.reversal.inventoryLookup.fulfillment,claim=inventory.claimFulfillmentBatchInTransaction;
 inventory.claimFulfillmentBatchInTransaction=function(...args){oldClaims++;return claim.apply(this,args);};
 f.database.withTransaction=async function(work,options){
  if(!paused&&options?.eventAdmissionId===f.command.eventId){paused=true;entered.resolve();await resume.promise;}
  return originalTransaction.call(this,(tx,details)=>{const callback=Promise.resolve().then(()=>work(tx,details));callbacks.add(callback);callback.then(()=>callbacks.delete(callback),()=>callbacks.delete(callback));return callback;},options);
 };
 const child=fork(new URL("../../test-support/fulfillmentReversalRecoveryChild.js",import.meta.url),[],{
  execArgv:["--import",new URL("../../test-support/testEnv.js",import.meta.url).href],serialization:"advanced",stdio:["ignore","pipe","pipe","ipc"],env:{...process.env}
 });
 const messages=[],waiters=new Map(),output={stdout:"",stderr:""};let childError;
 child.stdout.on("data",chunk=>{output.stdout+=chunk;});child.stderr.on("data",chunk=>{output.stderr+=chunk;});
 child.on("message",message=>{messages.push(message);if(message.type==="error"){childError=new Error(message.message);for(const waiter of waiters.values())waiter.reject(childError);waiters.clear();}else{waiters.get(message.type)?.resolve(message);waiters.delete(message.type);}});
 const exit=once(child,"exit");void exit.catch(()=>{});
 child.once("exit",(code,signal)=>{for(const waiter of waiters.values())waiter.reject(new Error(`TASK036 child exited before its expected message: ${code}/${signal}`));waiters.clear();});
 child.once("error",error=>{childError=error;for(const waiter of waiters.values())waiter.reject(error);waiters.clear();});
 function message(type){const found=messages.find(item=>item.type===type);if(found)return Promise.resolve(found);if(childError)return Promise.reject(childError);const waiter=Promise.withResolvers();waiters.set(type,waiter);return waiter.promise;}
 const previous=f.f.cleanup.shutdown;
 let drained;
 async function drain(){return drained??=(async()=>{
  controller.abort(new Error("TASK036 parent owned cleanup"));resume.resolve();
  if(child.connected)child.send({type:"stop"},()=>{});
  try{
   await boundReversalCleanup(Promise.allSettled([...(worker?[worker]:[]),...callbacks,exit]),f.f.applicationSource.application.shutdownTimeoutMs);
   assert.equal(callbacks.size,0);assert.ok(child.exitCode!==null||child.signalCode!==null,"Owned child exited");
  }catch(error){
   f.f.cleanup.preserveSchema=true;
   if(child.exitCode===null&&child.signalCode===null){child.kill("SIGTERM");try{await boundReversalCleanup(exit,5000);}catch{/* Preserve unknown cleanup; never drop this schema. */}}
   throw error;
  }
 })();}
 f.f.cleanup.shutdown=async()=>{await drain();f.database.withTransaction=originalTransaction;inventory.claimFulfillmentBatchInTransaction=claim;await previous?.();};
 const abort=()=>{controller.abort(t.signal.reason);resume.resolve();if(child.connected)child.send({type:"stop"},()=>{});};t.signal.addEventListener("abort",abort,{once:true});
 try{
  worker=completeReversal(f,f.started,{signal:controller.signal});const outcome=Promise.allSettled([worker]);
  await Promise.race([entered.promise,worker.then(()=>assert.fail("old writer never reached pre-BEGIN gate"))]);
  child.send({type:"start",schema:f.f.name,connectionOptions:f.f.connectionOptions,eventId:f.command.eventId,cleanupTimeoutMs:f.f.applicationSource.application.shutdownTimeoutMs});
  const unknown=await message("unknown");assert.deepEqual(unknown.snapshot,before);assert.equal(unknown.dispatches,1);
  await message("takeover");
  const [[taken]]=await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=?",[f.command.eventId]);
  sameIdentity(old,taken);assert.equal(Number(taken.attempt_count),2);assert.notEqual(taken.lease_owner,old.lease_owner);
  resume.resolve();const [stale]=await outcome;assert.equal(stale.status,"rejected");assert.equal(stale.reason.code,"CONCURRENT_OPERATION");assert.equal(oldClaims,0);
  child.send({type:"release"});
  const result=await message("done");const [code,signal]=await exit;assert.equal(code,0,output.stderr);assert.equal(signal,null);
  assert.deepEqual(result.counts,{dispatches:3,posts:1,preclaims:1,takeovers:1,phaseBs:1,cloneRefusals:2,fakeInvocationRefusals:1});
  assert.equal(result.coverageEnabled,Boolean(process.env.NODE_V8_COVERAGE));
  assert.equal(result.cleanup.drained,true);assert.equal(result.cleanup.shutdownExitCode,0);assert.equal(result.cleanup.callbacks,0);assert.equal(result.cleanup.jobs,0);assert.ok(result.cleanup.refreshRuns<=8);assert.equal(result.cleanup.refreshFailures,0);
  if(process.env.NODE_V8_COVERAGE){
   const files=(await readdir(process.env.NODE_V8_COVERAGE)).filter(file=>file.startsWith(`coverage-${child.pid}-`)&&file.endsWith(".json"));assert.equal(files.length,1,"Exited child emitted its own raw V8 coverage");
   const coverage=JSON.parse(await readFile(path.join(process.env.NODE_V8_COVERAGE,files[0]),"utf8"));
   assert.ok(coverage.result.some(script=>script.url.endsWith("/ShipmentReversalService.js")&&script.functions.some(fn=>fn.ranges.some(range=>range.count>0))));
  }
  const after=await facts(f),completed=operation(after,f);sameIdentity(old,completed);assert.equal(completed.status,"SUCCEEDED");assert.equal(Number(completed.attempt_count),2);
  assert.equal(after.inventory_movements.length-before.inventory_movements.length,2);assert.equal(after.shipment_reversal_details.length-before.shipment_reversal_details.length,2);
  t.diagnostic(JSON.stringify({id:"TASK036-C1",counts:result.counts,childPid:child.pid,exitCode:code,signal,coverage:result.coverageEnabled}));
 }finally{t.signal.removeEventListener("abort",abort);await drain();f.database.withTransaction=originalTransaction;inventory.claimFulfillmentBatchInTransaction=claim;}
});

nativeTest("TASK036-RECOVERY ineligible unknown and exhausted work stays fenced",nativeOptions,async t=>{
 const f=await reversalFixture(t,{archives:true,noDownstream:true,preflightConfiguration:true});await startReversal(f);await expire(f);
 const runtime=await ownedRuntime(f,t);runtime.state.declared=true;
 async function unchanged(label,expected,{ineligible=false}={}){
  const before=await facts(f),offset=runtime.state.proofs.length,result=await runtime.dispatch("failed");assert.deepEqual(result,[expected],label);
  if(ineligible)assert.deepEqual(runtime.state.proofs.slice(offset),[{owner:"inventory",result:{state:"ABSENT",eligibility:"INELIGIBLE"}},{owner:"sales",result:{state:"ABSENT",eligibility:"ELIGIBLE"}}]);
  assert.deepEqual(await facts(f),before,label+" all 26 tables");assertNoWriter(runtime);
 }
 await f.db.execute("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=?",[f.s.warehouseId]);await unchanged("inactive Warehouse",{state:"UNKNOWN"},{ineligible:true});
 await f.db.execute("UPDATE inventory_warehouses SET status='ACTIVE' WHERE id=?",[f.s.warehouseId]);
 const initial=await facts(f),issue=initial.shipment_issue_details[0],balance=initial.inventory_stock_balances.find(row=>String(row.id)===String(issue.inventory_balance_id));
 await f.db.execute("UPDATE inventory_bins SET status='INACTIVE' WHERE id=?",[issue.bin_id]);await unchanged("inactive Bin",{state:"UNKNOWN"},{ineligible:true});
 await f.db.execute("UPDATE inventory_bins SET status='ACTIVE' WHERE id=?",[issue.bin_id]);
 const create=await f.s.insert("inventory_operation_requests",{command_type:"STOCKTAKE_CREATE",source_module:"INVENTORY",source_document_type:"STOCKTAKE",source_document_id:"task036-c2",source_event_id:randomUUID(),request_hash:"a".repeat(64),actor_user_id:f.userId,actor_label:"Synthetic",result_type:"STOCKTAKE",result_id:"1",result_summary:JSON.stringify({status:"DRAFT"}),completed_at:f.s.now,created_at:f.s.now});
 const start=await f.s.insert("inventory_operation_requests",{command_type:"STOCKTAKE_START",source_module:"INVENTORY",source_document_type:"STOCKTAKE",source_document_id:"task036-c2",source_event_id:randomUUID(),request_hash:"b".repeat(64),actor_user_id:f.userId,actor_label:"Synthetic",result_type:"STOCKTAKE",result_id:"1",result_summary:JSON.stringify({status:"COUNTING"}),completed_at:f.s.now,created_at:f.s.now});
 const header=await f.s.insert("inventory_stocktakes",{stocktake_number:"ST-TASK036-C2",warehouse_id:f.s.warehouseId,status:"COUNTING",create_operation_id:create,start_operation_id:start,reason:"Synthetic active lock",created_at:f.s.now,updated_at:f.s.now});
 const bin=await f.s.insert("inventory_stocktake_bins",{stocktake_id:header,bin_id:issue.bin_id,bin_code_snapshot:issue.bin_code_snapshot,created_at:f.s.now});
 await f.s.insert("inventory_stocktake_lines",{stocktake_id:header,stocktake_bin_id:bin,stock_balance_id:balance.id,bin_id:issue.bin_id,sku_id:balance.sku_id,stock_status:balance.stock_status,snapshot_quantity:balance.on_hand_quantity,snapshot_balance_version:balance.version});
 const lock=await f.s.insert("inventory_bin_locks",{bin_id:issue.bin_id,lock_type:"STOCKTAKE",stocktake_id:header,stocktake_bin_id:bin,locked_at:f.s.now,locked_by:f.userId});
 await unchanged("active Stocktake lock",{state:"UNKNOWN"},{ineligible:true});
 await f.db.execute("UPDATE inventory_bin_locks SET released_at=?,released_by=?,release_reason='Synthetic lock released' WHERE id=?",[f.s.now,f.userId,lock]);
 const restore=await removeReversePermission(f,f.userId);try{const offset=runtime.state.proofs.length;await unchanged("reverse permission revoked",{state:"UNKNOWN"});assert.equal(runtime.state.proofs.length,offset);}finally{await restore();}
 runtime.state.missingIssue=true;try{await unchanged("forwarded Issue query missing one original row",{error:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});assert.ok(runtime.state.missingRows>0);}finally{runtime.state.missingIssue=false;}
 await f.db.execute("UPDATE fulfillment_operation_requests SET attempt_count=10 WHERE id=?",[f.started.operationId]);
 const before=await facts(f),old=operation(before,f),[[clock]]=await f.db.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
 assert.deepEqual(await runtime.dispatch("failed"),[{state:"EXHAUSTED"}]);
 const after=await facts(f),deferred=operation(after,f);sameIdentity(old,deferred);assert.equal(Number(deferred.attempt_count),10);assert.equal(deferred.lease_owner,old.lease_owner);
 assert.ok(Number(deferred.next_attempt_at)>=Number(clock.now_ms)+300000);assert.ok(Number(deferred.next_attempt_at)<=Number(deferred.updated_at)+300000);
 const expected=structuredClone(before),allowed=operation(expected,f);allowed.next_attempt_at=deferred.next_attempt_at;allowed.updated_at=deferred.updated_at;assert.deepEqual(after,expected);assertNoWriter(runtime);
 assert.deepEqual(await runtime.dispatch("succeeded"),[]);assert.deepEqual(await facts(f),after);
 await f.db.execute("UPDATE fulfillment_operation_requests SET next_attempt_at=NULL WHERE id=?",[f.started.operationId]);
 await f.s.insert("inventory_operation_requests",{command_type:"FULFILLMENT_BATCH_ISSUE",source_module:"FULFILLMENT",source_document_type:"SHIPMENT",source_document_id:f.shipmentId,source_event_id:f.command.eventId,request_hash:"c".repeat(64),actor_user_id:f.userId,actor_label:"Synthetic",created_at:f.s.now});
 await unchanged("pending foreign Inventory source under original event",{state:"UNKNOWN"});
 assert.deepEqual(runtime.state.proofs.slice(-2),[{owner:"inventory",result:{state:"UNKNOWN",eligibility:"UNKNOWN"}},{owner:"sales",result:{state:"ABSENT",eligibility:"ELIGIBLE"}}]);
 assert.equal(runtime.state.dispatches,8);assert.equal(runtime.state.recoveries.length,7);assertNoWriter(runtime);
 t.diagnostic(JSON.stringify({id:"TASK036-C2",dispatches:8,fixtureControlDml:17,missingRows:runtime.state.missingRows,proofs:runtime.state.proofs}));
});

nativeTest("TASK036-RECOVERY Sales version exhaustion preserves the original attempt",nativeOptions,async t=>{
 const f=await reversalFixture(t,{archives:true,noDownstream:true,preflightConfiguration:true});await startReversal(f);await expire(f);
 const runtime=await ownedRuntime(f,t);runtime.state.declared=true;
 const [[header]]=await f.db.query("SELECT version FROM sales_orders WHERE id=?",[f.s.orderId]);
 await f.db.execute("UPDATE sales_orders SET version=4294967295 WHERE id=?",[f.s.orderId]);
 async function ineligible(label){
  const before=await facts(f),offset=runtime.state.proofs.length;
  assert.deepEqual(await runtime.dispatch("failed"),[{state:"UNKNOWN"}]);assert.deepEqual(await facts(f),before,label);assertNoWriter(runtime);
  assert.deepEqual(runtime.state.proofs.slice(offset),[
   {owner:"inventory",result:{state:"ABSENT",eligibility:"ELIGIBLE"}},
   {owner:"sales",result:{state:"ABSENT",eligibility:"INELIGIBLE"}}
  ]);
 }
 await ineligible("exhausted Sales header version");
 await f.db.execute("UPDATE sales_orders SET version=? WHERE id=?",[header.version,f.s.orderId]);
 await f.db.execute("UPDATE sales_order_lines SET version=4294967295 WHERE id=?",[f.s.lineId]);
 await ineligible("exhausted Sales line version");
 assert.equal(runtime.state.dispatches,2);t.diagnostic(JSON.stringify({id:"TASK036-C3",dispatches:2,fixtureVersionUpdates:3,proofs:runtime.state.proofs}));
});

nativeTest("TASK036-RECOVERY unknown takeover commit never creates a writer binding",nativeOptions,async t=>{
 const f=await reversalFixture(t,{archives:true,noDownstream:true,preflightConfiguration:true});await startReversal(f);await expire(f);
 const before=await facts(f),old=operation(before,f),runtime=await ownedRuntime(f,t);runtime.state.declared=true;runtime.state.loseTakeoverAck=true;
 const first=await runtime.dispatch("failed");assert.deepEqual(first,[{error:"DATABASE_TRANSACTION_INDETERMINATE"}]);
 assert.equal(runtime.state.ackLosses,1);assert.equal(runtime.state.destroys,1);assert.equal(runtime.state.releasesAfterAck,0);
 assert.deepEqual(runtime.state.unknownOutcomes,[{state:"INDETERMINATE"}]);assert.equal(runtime.state.phaseBs,0);assert.equal(runtime.state.preclaims,0);assert.equal(runtime.state.posts,0);
 const pending=await facts(f),row=operation(pending,f);sameIdentity(old,row);assert.equal(Number(row.attempt_count),2);assert.notEqual(row.lease_owner,old.lease_owner);
 const expected=structuredClone(before),changed=operation(expected,f);for(const field of ["lease_owner","lease_expires_at","attempt_count","next_attempt_at","updated_at"])changed[field]=row[field];assert.deepEqual(pending,expected,"Only the genuinely committed takeover changed");
 assert.deepEqual(await runtime.dispatch("succeeded"),[]);assert.deepEqual(await facts(f),pending);assert.equal(runtime.state.takeovers.length,1);
 await expire(f);
 const observed={...f,reversal:runtime.state.service,database:runtime.database,context:runtime.database.context,options:{...f.options,time:runtime.app.services.require("time")}},evidence=observeCommittedInputs(observed);
 try{
  assert.deepEqual(await runtime.dispatch("succeeded"),[{state:"SUCCEEDED"}]);
  const after=await facts(f),final=operation(after,f);sameIdentity(old,final);assert.equal(Number(final.attempt_count),3);
  const baseline=structuredClone(before);operation(baseline,f).attempt_count=3;assertCommittedReversal(baseline,after,observed);
  assert.equal(runtime.state.dispatches,3);assert.equal(runtime.state.takeovers.length,2);assert.equal(runtime.state.phaseBs,1);assert.equal(runtime.state.posts,1);assert.equal(runtime.state.preclaims,1);
  assert.deepEqual(runtime.state.takeovers.map(item=>getTransactionOutcome(item.tx).state),["INDETERMINATE","COMMITTED"]);
  assert.notEqual(runtime.state.takeovers[0].nonce,runtime.state.takeovers[1].nonce);
  t.diagnostic(JSON.stringify({id:"TASK036-C4",dispatches:3,takeovers:2,phaseBs:1,posts:1,ackLosses:1,destroys:1,releasesAfterAck:0}));
 }finally{evidence.restore();}
});

import assert from "node:assert/strict";
import { task036ApplicationSource } from "../test/sales/phase4/salesFulfillmentFixtures.js";
import { reversalRecoveryRuntime,facts,observeCommittedInputs,assertCommittedReversal,boundReversalCleanup } from "../test/fulfillment/shipmentReversalFixture.js";

let started=false,stopping=false,runtime,evidence,second,closing,errorReported=false,cleanupTimeoutMs=30000;
const initialized=Promise.withResolvers(),reads=new Set();
const send=message=>new Promise((resolve,reject)=>{process.send(message,error=>error?reject(error):resolve());});
function running(){if(stopping)throw Object.assign(new Error("TASK036 child stopped"),{code:"TASK036_CANCELLED"});}
function cancel(){stopping=true;runtime?.abortOwned();runtime?.state.resumePhaseB();}
async function readFacts(f){
 running();const read=facts(f);reads.add(read);
 try{return await read;}finally{reads.delete(read);}
}
async function close(){
 cancel();
 if(!started)initialized.resolve();
 return closing??=(async()=>{
  const deadline=performance.now()+cleanupTimeoutMs,remaining=()=>Math.max(1,deadline-performance.now());
  await boundReversalCleanup(initialized.promise,remaining());
  runtime?.abortOwned();runtime?.state.resumePhaseB();
  await boundReversalCleanup(Promise.allSettled([...reads]),remaining());assert.equal(reads.size,0);
  if(runtime)await boundReversalCleanup(runtime.close(),remaining());
  if(second)await boundReversalCleanup(Promise.allSettled([second]),remaining());
  evidence?.restore();
 })();
}
async function initialize(input){
 try{
  running();const source=await task036ApplicationSource(input.connectionOptions,input.schema);running();
  assert.equal(source.application.shutdownTimeoutMs,cleanupTimeoutMs);
  runtime=await reversalRecoveryRuntime({applicationSource:source,eventId:input.eventId,restart:true});
  running();const job=await runtime.start();running();return job;
 }finally{initialized.resolve();}
}
async function run(input){
 assert.equal(process.env.DB_INTEGRATION_TESTS,"1");
 assert.ok(typeof process.env.DB_NAME==="string"&&input.schema.startsWith(process.env.DB_NAME+"_sf_"));
 assert.match(input.schema,/^[A-Za-z0-9_]{1,64}$/u);
 assert.equal(input.connectionOptions.socketPath,process.env.DB_SOCKET_PATH);
 assert.equal(input.connectionOptions.user,process.env.DB_ADMIN_USER??process.env.DB_USER);
 assert.ok(Number.isSafeInteger(input.cleanupTimeoutMs)&&input.cleanupTimeoutMs>0&&input.cleanupTimeoutMs<=120000);cleanupTimeoutMs=input.cleanupTimeoutMs;
 const job=await initialize(input);running();
 const f={db:runtime.database,database:runtime.database,options:{time:runtime.app.services.require("time")}};
 const before=await readFacts(f),operation=before.fulfillment_operation_requests.find(row=>row.event_id===input.eventId);
 assert.ok(operation);assert.equal(Number(operation.attempt_count),1);
 const reversal=before.shipment_reversals.find(row=>row.event_id===input.eventId),shipment=before.shipments.find(row=>String(row.id)===String(operation.target_id));assert.ok(reversal&&shipment);
 f.shipmentId=String(shipment.id);f.userId=String(operation.initiated_by);
 f.command={eventId:input.eventId,version:Number(shipment.version)-1,reason:reversal.reason,goodsUnderCompanyControl:Number(reversal.goods_under_company_control)===1,goodsReturnedToOriginalBins:Number(reversal.goods_returned_to_original_bins)===1};
 f.started={operationId:String(operation.id),correlationId:operation.correlation_id,reversal:{id:String(reversal.id)}};
 running();assert.deepEqual(await runtime.dispatch("failed"),[{error:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"}]);running();
 const unchanged=await readFacts(f);assert.deepEqual(unchanged,before);assert.equal(runtime.state.takeovers.length,0);assert.equal(runtime.state.posts,0);
 await send({type:"unknown",snapshot:unchanged,dispatches:runtime.state.dispatches});running();
 await assert.rejects(job.run(new AbortController().signal),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});running();
 runtime.state.declared=true;f.reversal=runtime.state.service;evidence=observeCommittedInputs(f);
 running();second=runtime.dispatch("succeeded");
 await Promise.race([runtime.state.phaseBReached,second.then(()=>assert.fail("genuine takeover never reached fresh Phase B"))]);running();
 await send({type:"takeover"});
 assert.deepEqual(await second,[{state:"SUCCEEDED"}]);running();
 assert.equal(runtime.state.cloneRefusals,2);
 const after=await readFacts(f),baseline=structuredClone(before);baseline.fulfillment_operation_requests.find(row=>row.event_id===input.eventId).attempt_count=2;
 assertCommittedReversal(baseline,after,f);
 running();assert.deepEqual(await runtime.dispatch("succeeded"),[]);running();assert.deepEqual(await readFacts(f),after);
 const counts={dispatches:runtime.state.dispatches,posts:runtime.state.posts,preclaims:runtime.state.preclaims,takeovers:runtime.state.takeovers.length,phaseBs:runtime.state.phaseBs,cloneRefusals:runtime.state.cloneRefusals,fakeInvocationRefusals:1};
 await close();await send({type:"done",counts,cleanup:runtime.state.cleanup,coverageEnabled:Boolean(process.env.NODE_V8_COVERAGE)});process.disconnect();
}
async function report(error){
 process.exitCode=1;
 if(errorReported)return;errorReported=true;
 try{if(process.connected)await send({type:"error",message:error.stack??error.message});}
 catch{process.stderr.write("TASK036 child failure could not be delivered over owned IPC\n");}
 finally{if(process.connected)process.disconnect();}
}
process.on("message",message=>{
 if(message.type==="release"){if(!stopping)runtime?.state.resumePhaseB();return;}
 if(message.type==="stop"){void close().then(()=>{if(process.connected)process.disconnect();},report);return;}
 if(message.type!=="start"||started||stopping)return;
 started=true;
 void run(message).catch(async error=>{
  initialized.resolve();
  try{await close();}catch(cleanupError){error=new AggregateError([error,cleanupError],"TASK036 child and owned cleanup failed");}
  await report(error);
 });
});
process.on("disconnect",()=>{void close().catch(error=>{process.exitCode=1;process.stderr.write(String(error));});});

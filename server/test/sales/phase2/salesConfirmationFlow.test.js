import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SalesOrderConfirmationService } from "../../../src/modules/sales/SalesOrderConfirmationService.js";
import { salesError } from "../../../src/modules/sales/salesErrors.js";
const eventId=randomUUID(),leaseOwner=randomUUID(),intent={operationId:9,eventId,status:"IN_PROGRESS",leaseOwner,replay:null};
const request={claims:{actorId:7},id:1,input:{eventId,version:1}};
function flow() {const service=new SalesOrderConfirmationService({database:{},time:{nowMs:()=>1},config:{manualConfirmationWaitMs:100,transactionTimeoutMs:1000}});
 service.startConfirmation=async()=>intent;return service;}
test("TC-022 bounded confirmation returns actual terminal result and strips internal lease/operation hashes",async()=>{
 const service=flow();let called;
 service.completeConfirmation=async input=>{called=input;return {salesOrder:{id:1,status:"CONFIRMED"},warnings:[{code:"PARTIAL_BACKORDER"}]};};
 const result=await service.confirm(request);
 assert.equal(result.statusCode,200);assert.deepEqual(result.data,{outcome:"CONFIRMED",salesOrder:{id:1,status:"CONFIRMED"},warnings:["PARTIAL_BACKORDER"]});
 assert.equal(called.eventId,eventId);assert.equal(called.leaseOwner,leaseOwner);assert.ok(called.signal instanceof AbortSignal);
});
test("TC-022 bounded wait returns 202 on the same original event while observing late execution rejection",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});const service=flow();let reject,signal;
 service.completeConfirmation=input=>{signal=input.signal;return new Promise((_,fail)=>{reject=fail;});};
 const pending=service.confirm(request);await Promise.resolve();await Promise.resolve();t.mock.timers.tick(100);
 const result=await pending;assert.equal(result.statusCode,202);assert.equal(result.data.operationId,9);assert.equal(result.data.eventId,eventId);
 assert.equal(result.data.statusUrl,`/api/v1/sales-operations/by-event/${eventId}`);assert.equal(result.retryAfterSeconds,2);assert.equal(signal.aborted,false);
 reject(new Error("Late technical failure"));await Promise.resolve();
});
test("TC-022 technical unknown/lease/dependency outcomes stay pending while qualification failure remains actionable",async()=>{
 for(const code of ["TRANSACTION_OUTCOME_UNKNOWN","CONCURRENT_OPERATION","SALES_DEPENDENCY_UNAVAILABLE"]){const service=flow();service.completeConfirmation=async()=>{throw salesError(code);};assert.equal((await service.confirm(request)).statusCode,202);}
 const service=flow();service.completeConfirmation=async()=>{throw salesError("CUSTOMER_NOT_SALEABLE");};await assert.rejects(()=>service.confirm(request),{code:"CUSTOMER_NOT_SALEABLE"});
});
test("TC-026 uncertain Phase A commit preserves observed intent ID/event and performs no blind Phase B",async()=>{
 const service=flow();service.startConfirmation=async()=>({...intent,outcomeUnknown:true});service.completeConfirmation=async()=>{throw new Error("Must not execute uncertain intent");};
 const result=await service.confirm(request);assert.equal(result.statusCode,202);assert.equal(result.data.operationId,9);assert.equal(result.data.eventId,eventId);
});

import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {SalesOrderConfirmationService} from "../../../src/modules/sales/SalesOrderConfirmationService.js";
import {SalesJobRuntimeService} from "../../../src/services/salesJobs/SalesJobRuntimeService.js";
import {SalesConfirmationRecoveryJob} from "../../../src/services/salesJobs/jobs/SalesConfirmationRecoveryJob.js";
import {waitForWorkerEntry} from "./fixtures.js";
const eventId=randomUUID();
test("TC-026 scheduler fixture fails promptly when lease admission ends without entering its worker",async()=>{
 await assert.rejects(()=>waitForWorkerEntry(new Promise(()=>{}),Promise.resolve()),/did not enter its worker/u);
 await assert.rejects(()=>waitForWorkerEntry(new Promise(()=>{}),Promise.reject(new Error("lease unavailable"))),/lease unavailable/u);
});
function fixture({status="IN_PROGRESS",leaseUntil=1000,now=1001,updatedAt=0}={}){
 const reads=[],writes=[],logs=[],completed=[];
 const tx={query:async(sql,args)=>{reads.push({sql,args});return sql.includes("FOR UPDATE")?[[{status,lease_until:leaseUntil,updated_at:updatedAt,now_ms:now}]]:sql.includes("CURRENT_TIMESTAMP")?[[{now_ms:now}]]:[];},execute:async(sql,args)=>{writes.push({sql,args});return [{affectedRows:1}];}};
 const database={query:async(sql,args,options)=>{reads.push({sql,args,options});return [[{event_id:eventId,oldest_age_ms:8000}]];},withTransaction:async(work,options)=>{reads.push({options});return work(tx);}};
 const service=new SalesOrderConfirmationService({database,time:{nowMs:()=>1},config:{confirmationRecoveryBatchSize:1,confirmationLeaseMs:60000,transactionTimeoutMs:30000},logger:{warn:async(...args)=>logs.push(args)}});
 service.completeConfirmation=async request=>{completed.push(request);return {};};
 return {service,reads,writes,logs,completed};
}
test("TC-026 recovery is a registered cluster job every30s and passes scheduler cancellation",async()=>{
 assert.deepEqual(SalesConfirmationRecoveryJob.jobs,[{name:"sales.confirmationRecovery",method:"run",scope:"cluster",intervalMs:30000,timeoutMs:30000}]);let registered;
 const runtime={recoverConfirmations:async signal=>signal},scheduler={register:value=>{registered=value;}};
 const job=new SalesConfirmationRecoveryJob({services:{require:name=>name==="scheduler"?scheduler:runtime}});await job.initialize();assert.equal(registered,job);const signal=new AbortController().signal;assert.equal(await job.run(signal),signal);
});
test("TC-026 recovery scans only expired original events in one bounded DB-clock batch and delegates PhaseB without fabricated claims",async()=>{
 const f=fixture(),signal=new AbortController().signal;assert.deepEqual(await f.service.recover({signal}),{processed:1,recovered:1,failed:0,deferred:0,oldestAgeMs:8000});
 assert.match(f.reads[0].sql,/lease_until<=CAST\(UNIX_TIMESTAMP\(CURRENT_TIMESTAMP\(3\)\)\*1000 AS UNSIGNED\)/u);assert.deepEqual(f.reads[0].args,[1]);assert.equal(f.reads[0].options.signal,signal);
 assert.deepEqual(f.completed,[{eventId,recovery:true,signal}]);assert.equal(f.writes.length,0);
});
test("TC-026 already-aborted recovery does no query or effect",async()=>{const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(()=>f.service.recover({signal:controller.signal}));assert.equal(f.reads.length,0);});
test("TC-026 abort after one candidate prevents the next effect and retry metadata writes",async()=>{
 const f=fixture(),controller=new AbortController();f.service.database.query=async()=>[[{event_id:eventId,oldest_age_ms:1},{event_id:randomUUID(),oldest_age_ms:1}]];
 f.service.completeConfirmation=async()=>{controller.abort();throw new Error("private database error");};await assert.rejects(()=>f.service.recover({signal:controller.signal}));assert.equal(f.writes.length,0);
});
test("TC-026 technical rollback preserves identity and rotates expired owner with persisted bounded exponential cooldown",async()=>{
 const f=fixture({leaseUntil:60000,now:60001});f.service.completeConfirmation=async()=>{throw new Error("private SQL/token");};assert.deepEqual(await f.service.recover(),{processed:1,recovered:0,failed:0,deferred:1,oldestAgeMs:8000});
 assert.match(f.writes[0].sql,/lease_owner=\?,lease_until=\?,updated_at=\?/u);const [owner,until,updated,event]=f.writes[0].args;assert.match(owner,/^[a-f0-9-]{36}$/u);assert.equal(until,180001);assert.equal(updated,60001);assert.equal(event,eventId);
 assert.equal(JSON.stringify(f.logs).includes("private SQL/token"),false);assert.equal(f.logs[0][2].errorCode,"SALES_DEPENDENCY_UNAVAILABLE");
});
test("TC-026 retry delay caps at five minutes and is durably derived from previous lease window",async()=>{
 const f=fixture({leaseUntil:900000,now:900001,updatedAt:1});f.service.completeConfirmation=async()=>{throw {code:"INVENTORY_CONTRACT_MISMATCH"};};await f.service.recover();assert.equal(f.writes[0].args[1]-f.writes[0].args[2],300000);assert.equal(f.logs[0][2].errorCode,"INVENTORY_CONTRACT_MISMATCH");
});
test("TC-026 an indeterminate commit is reconciled as succeeded before retry metadata or new execution",async()=>{
 const f=fixture({status:"SUCCEEDED"});f.service.completeConfirmation=async()=>{throw {code:"TRANSACTION_OUTCOME_UNKNOWN"};};assert.equal((await f.service.recover()).recovered,1);assert.equal(f.writes.length,0);
});
test("TC-026 committed business failure is terminal and does not receive another lease",async()=>{
 const f=fixture({status:"FAILED"});f.service.completeConfirmation=async()=>{throw {code:"CUSTOMER_CREDIT_ON_HOLD"};};assert.equal((await f.service.recover()).failed,1);assert.equal(f.writes.length,0);
});
test("TC-026 re-read after operation lock protects a newer live owner",async()=>{
 const f=fixture({leaseUntil:2000});f.service.completeConfirmation=async()=>{throw {code:"CONCURRENT_OPERATION"};};assert.equal((await f.service.recover()).deferred,1);assert.equal(f.writes.length,0);
});
test("TC-026 unknown retry metadata commit is propagated instead of blindly repeating it",async()=>{
 const f=fixture();f.service.completeConfirmation=async()=>{throw new Error("technical failure");};f.service.database.withTransaction=async()=>{throw {code:"DATABASE_TRANSACTION_INDETERMINATE"};};await assert.rejects(()=>f.service.recover(),{code:"DATABASE_TRANSACTION_INDETERMINATE"});assert.equal(f.completed.length,0);
});
test("TC-026 runtime uses normalized Sales settings and logs only aggregate recovery metrics",async()=>{
 const logs=[],database={query:async()=>[[]]},time={nowMs:()=>1},runtime=new SalesJobRuntimeService({config:{sales:{confirmationRecoveryBatchSize:7}},services:{require:name=>name==="logging"?{logger:{info:async(...args)=>logs.push(args),error:async(...args)=>logs.push(args)}}:name==="time"?time:database}});
 assert.equal(runtime.confirmation.config.confirmationRecoveryBatchSize,7);runtime.confirmation={recover:async()=>({processed:1,recovered:1,failed:0,deferred:0,oldestAgeMs:1})};assert.equal((await runtime.recoverConfirmations()).recovered,1);assert.equal(logs[0][0],"sales.confirmation_recovery_completed");assert.deepEqual(Object.keys(logs[0][2]).sort(),["deferred","failed","oldestAgeMs","processed","recovered"]);
});
test("TC-026 unresolved technical recovery surfaces scheduler failure and oldest-age alert without raw error contents",async()=>{
 const logs=[],runtime=new SalesJobRuntimeService({services:{require:name=>name==="logging"?{logger:{info:async()=>{},error:async(...args)=>logs.push(args)}}:{query:async()=>[[]]}}});
 runtime.confirmation={recover:async()=>({processed:1,recovered:0,failed:0,deferred:1,oldestAgeMs:300001})};await assert.rejects(()=>runtime.recoverConfirmations(),/Sales confirmation recovery incomplete/u);assert.equal(logs[0][0],"sales.confirmation_recovery_overdue");
 runtime.confirmation={recover:async()=>{throw new Error("private SQL/token");}};await assert.rejects(()=>runtime.recoverConfirmations(),error=>error.message==="Sales confirmation recovery failed");
});

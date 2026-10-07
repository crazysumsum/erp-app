import {fork} from "node:child_process";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import process from "node:process";
import {reconcileCommitments} from "../sales/phase2/commitmentReconciliation.js";
import assert from "node:assert/strict";
import test from "node:test";
import {setup,stock,waitForWorkerEntry} from "../sales/phase2/fixtures.js";
import {SchedulerService} from "../../src/services/scheduler/SchedulerService.js";
import {SalesConfirmationRecoveryJob} from "../../src/services/salesJobs/jobs/SalesConfirmationRecoveryJob.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function expire(f){await f.db.execute("UPDATE sales_operation_requests SET lease_until=0,updated_at=0 WHERE event_id=?",[f.request.input.eventId]);}
async function pending(t){const f=await setup(t);await stock(f,10);await f.service().startConfirmation(f.request);return f;}
async function effects(f){const [[row]]=await f.db.query(`SELECT o.status,o.version,p.status AS operation_status,p.lease_owner,p.lease_until,p.updated_at,
 (SELECT COUNT(*) FROM inventory_reservations r WHERE r.sku_id=?) AS reservations,
 (SELECT COUNT(*) FROM sales_order_status_history h WHERE h.sales_order_id=o.id AND h.action='confirmed') AS confirmations
 FROM sales_orders o JOIN sales_operation_requests p ON p.event_id=o.confirmation_event_id WHERE o.id=?`,[f.skuId,f.request.id]);return row;}
integrationTest("TC-026 live lease is excluded and expired original-human lease is completed exactly once",async t=>{
 const f=await pending(t);assert.equal((await f.service().recover()).processed,0);await expire(f);const result=await f.service().recover();assert.equal(result.recovered,1);const row=await effects(f);assert.equal(row.status,"CONFIRMED");assert.equal(row.operation_status,"SUCCEEDED");assert.equal(row.confirmations,1);assert.equal(row.reservations,1);assert.equal((await f.service().recover()).processed,0);
});
integrationTest("TC-026 an initiating application clock ahead of DB time clamps age without disabling expired recovery",async t=>{
 const f=await pending(t);await expire(f);await f.db.execute("UPDATE sales_operation_requests SET created_at=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)+600000 WHERE event_id=?",[f.request.input.eventId]);
 const result=await f.service().recover();assert.equal(result.recovered,1);assert.equal(result.oldestAgeMs,0);assert.equal((await effects(f)).reservations,1);
});
integrationTest("TC-026 actual revoked original actor causes no Inventory effect and persists retry cooldown across a new service",async t=>{
 const f=await pending(t);await expire(f);await f.db.execute("DELETE FROM role_permissions WHERE role_id=?",[f.roleId]);const before=await effects(f),result=await f.service().recover();assert.equal(result.deferred,1);const after=await effects(f);assert.equal(after.status,"CONFIRMING");assert.equal(after.reservations,0);assert.notEqual(after.lease_owner,before.lease_owner);assert.equal(Number(after.lease_until)-Number(after.updated_at),30000);assert.equal((await f.service().recover()).processed,0);
 for(const permission of ["sales.view","sales.mgmt"])await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?",[f.roleId,permission]);
 await assert.rejects(()=>f.service().completeConfirmation({eventId:f.request.input.eventId,claims:f.claims,leaseOwner:before.lease_owner}),{code:"CONCURRENT_OPERATION"});
 await expire(f);assert.equal((await f.service().recover()).recovered,1);
});
integrationTest("TC-026 newly inactive Customer is durably rejected as Draft/FAILED with no Inventory and no technical retry lease",async t=>{
 const f=await pending(t);await expire(f);await f.db.execute("UPDATE customers SET status='inactive' WHERE id=?",[f.customerId]);const result=await f.service().recover();assert.equal(result.failed,1);assert.equal(result.deferred,0);
 const [[row]]=await f.db.query("SELECT o.status,o.confirmation_event_id,p.status AS operation_status,p.lease_until FROM sales_orders o JOIN sales_operation_requests p ON p.event_id=? WHERE o.id=?",[f.request.input.eventId,f.request.id]);assert.equal(row.status,"DRAFT");assert.equal(row.operation_status,"FAILED");assert.equal(row.confirmation_event_id,null);assert.equal(row.lease_until,null);assert.equal((await f.service().recover()).processed,0);
 assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE sku_id=?",[f.skuId]))[0][0].n,0);
});
integrationTest("TC-026 real Inventory technical rollback persists a doubled cooldown, keeps same UUID and cannot create a second effect",async t=>{
 const f=await pending(t);await f.db.execute("UPDATE sales_operation_requests SET lease_until=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)-1,updated_at=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)-60001 WHERE event_id=?",[f.request.input.eventId]);
 const service=f.service({inventory:{reserveAvailableForSalesBatchInTransaction:async()=>{throw new Error("Synthetic unavailable provider");}}});assert.equal((await service.recover()).deferred,1);const row=await effects(f);assert.equal(row.status,"CONFIRMING");assert.equal(row.reservations,0);assert.equal(Number(row.lease_until)-Number(row.updated_at),120000);assert.equal((await f.service().recover()).processed,0);await expire(f);assert.equal((await f.service().recover()).recovered,1);
});
integrationTest("TC-026 real COMMIT followed by lost acknowledgement is read as terminal and never replays effects blindly",async t=>{
 const f=await pending(t);await expire(f);let writes=0;
 const database=Object.create(f.database);database.withTransaction=async(work,options)=>{const value=await f.database.withTransaction(work,options);if(writes++===0)throw Object.assign(new Error("Synthetic lost COMMIT acknowledgement"),{code:"DATABASE_TRANSACTION_INDETERMINATE"});return value;};
 const result=await f.service({database}).recover();assert.equal(result.recovered,1);assert.equal(result.deferred,0);const row=await effects(f);assert.equal(row.reservations,1);assert.equal(row.confirmations,1);assert.equal(row.operation_status,"SUCCEEDED");assert.equal((await f.service().recover()).processed,0);
});
integrationTest("TC-026 concurrent recovery workers commit only one reservation and one confirmation",async t=>{
 const f=await pending(t);await expire(f);const results=await Promise.all([f.service().recover(),f.service().recover()]);assert.ok(results.some(r=>r.recovered===1));const row=await effects(f);assert.equal(row.reservations,1);assert.equal(row.confirmations,1);assert.equal(row.operation_status,"SUCCEEDED");
});
integrationTest("TC-026 registered cluster scheduler instances and overlap use real shared SQL lease",async t=>{
 const f=await pending(t);await expire(f);const sources={mysqldatabase:f.database,time:f.time,logging:{logger:f.logger}};const config={scheduler:{enabled:true,clusterLeaseGraceMs:30000,defaultTimeoutMs:30000,startupJitterRatio:0,jobs:{}}};
 const make=runtime=>{const scheduler=new SchedulerService({config,services:{require:name=>sources[name]}}),job=new SalesConfirmationRecoveryJob({services:{require:name=>name==="scheduler"?scheduler:runtime}});scheduler.register(job);return scheduler;};
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 const first=make({recoverConfirmations:async signal=>{entered();await held;return f.service().recover({signal});}}),second=make({recoverConfirmations:async()=>{throw new Error("Second scheduler cannot enter");}});t.after(async()=>{await first.stop();await second.stop();});
 await first.leaseStore.prepare(["sales.confirmationRecovery"]);const work=first.execute(first.jobs.get("sales.confirmationRecovery"));await waitForWorkerEntry(started,work);
 await first.execute(first.jobs.get("sales.confirmationRecovery"));await second.execute(second.jobs.get("sales.confirmationRecovery"));assert.equal(first.stats.get("sales.confirmationRecovery").skippedOverlapping,1);assert.equal(second.stats.get("sales.confirmationRecovery").skippedNotLeader,1);release();await work;assert.equal(first.stats.get("sales.confirmationRecovery").runs,1);assert.equal((await effects(f)).reservations,1);
});
integrationTest("TC-026 aborted recovery keeps durable intent and shutdown cancels the registered worker",async t=>{
 const f=await pending(t);await expire(f);const controller=new AbortController();controller.abort();await assert.rejects(()=>f.service().recover({signal:controller.signal}));assert.equal((await effects(f)).status,"CONFIRMING");
 const scheduler=new SchedulerService({config:{scheduler:{enabled:true,clusterLeaseGraceMs:30000,defaultTimeoutMs:30000,startupJitterRatio:0,jobs:{}}},services:{require:name=>name==="logging"?{logger:f.logger}:name==="time"?f.time:f.database}});t.after(()=>scheduler.stop({timeoutMs:1000}));let entered;const started=new Promise(resolve=>{entered=resolve;});const job=new SalesConfirmationRecoveryJob({services:{require:name=>name==="scheduler"?scheduler:{recoverConfirmations:signal=>new Promise((resolve,reject)=>{entered();signal.addEventListener("abort",()=>reject(signal.reason),{once:true});})}}});scheduler.register(job);await scheduler.leaseStore.prepare(["sales.confirmationRecovery"]);const work=scheduler.execute(scheduler.jobs.get("sales.confirmationRecovery"));await waitForWorkerEntry(started,work);await scheduler.stop({timeoutMs:1000});await work;assert.equal(scheduler.running.size,0);assert.equal((await effects(f)).reservations,0);
});

for(const boundary of ["phaseA","inventory","beforeCommit","afterCommit"])integrationTest(`${boundary==="afterCommit"?"TC-026":"TC-025"} owned child SIGKILL at ${boundary} restarts from the same durable event exactly once`,async t=>{
 const f=await setup(t);await stock(f,10);const runId=randomUUID(),script=fileURLToPath(new URL("../sales/phase2/confirmationCrashWorker.js",import.meta.url)),child=fork(script,{execArgv:[],stdio:["ignore","ignore","ignore","ipc"]}),exit=Promise.withResolvers();child.once("exit",(code,signal)=>exit.resolve({code,signal}));
 const reached=Promise.withResolvers(),onMessage=value=>{if(value.runId!==runId)return;if(value.error)reached.reject(Error(`${value.error} at ${value.stage}: ${value.code} ${value.sections??[]}`));else reached.resolve(value);};child.on("message",onMessage);let timer;
 try{
  child.send({runId,boundary,request:f.request});const proof=await Promise.race([reached.promise,exit.promise.then(()=>{throw Error("Owned crash child exited before its boundary");}),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error("Owned crash child boundary timeout")),15000);})]);clearTimeout(timer);
  assert.equal(proof.pid,child.pid);assert.equal(proof.uid,process.getuid());assert.equal(proof.script,script);assert.equal(proof.boundary,boundary);assert.equal(child.kill("SIGKILL"),true);assert.deepEqual(await exit.promise,{code:null,signal:"SIGKILL"});
 }finally{clearTimeout(timer);child.removeListener("message",onMessage);if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");await exit.promise;}
 // Locking this owned operation waits for the killed connection's transaction to settle before synthetic lease expiry/recovery.
 await f.database.withTransaction(async tx=>{await tx.query("SELECT id FROM sales_operation_requests WHERE event_id=? FOR UPDATE",[f.request.input.eventId]);await tx.execute("UPDATE sales_operation_requests SET lease_until=0,updated_at=0 WHERE event_id=? AND status='IN_PROGRESS'",[f.request.input.eventId]);});
 const result=await f.service().recover();assert.equal(result.deferred,0);assert.equal(result.recovered,boundary==="afterCommit"?0:1);const lookup=await f.service().lookup({claims:f.claims,eventId:f.request.input.eventId});assert.equal(lookup.status,"SUCCEEDED");await f.service().completeConfirmation({eventId:f.request.input.eventId,claims:f.claims});
 const [[effects]]=await f.db.query("SELECT (SELECT COUNT(*) FROM sales_order_status_history WHERE sales_order_id=? AND action='confirmed') AS confirmations,(SELECT COUNT(*) FROM sales_order_line_reservations r JOIN sales_order_lines l ON l.id=r.sales_order_line_id WHERE l.sales_order_id=?) AS mappings",[f.request.id,f.request.id]);assert.equal(effects.confirmations,1);assert.equal(effects.mappings,1);assert.deepEqual((await reconcileCommitments(f)).mismatches,{conservation:0,mappings:0,queue:0,flags:0,reservations:0,controls:0});assert.equal((await f.service().recover()).processed,0);
});

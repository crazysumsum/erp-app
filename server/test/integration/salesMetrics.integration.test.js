import assert from "node:assert/strict";
import test from "node:test";
import {setup} from "../sales/phase2/fixtures.js";
import {MySqlJobStatsStore} from "../../src/services/scheduler/JobStatsStore.js";
import {collectSalesQueueMetrics,salesQueueAlerts} from "../../src/modules/sales/salesMetrics.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("TASK-062 developer queue gauges read a real confirmation intent without changing domain, job or lease rows",async t=>{
 const f=await setup(t);await f.service().startConfirmation(f.request);
 const tables=["sales_orders","sales_order_lines","sales_operation_requests","sales_audit_logs","sales_backorder_entries","sales_intake_orders","sales_archive_batches","fr_job_leases","fr_job_stats"],before={};
 for(const table of tables)before[table]=(await f.db.query(`SELECT * FROM ${table}`))[0];
 const now=f.time.nowMs()+300001,metrics=await f.runAsFixtureRequest(f.claims,()=>collectSalesQueueMetrics({database:f.database,nowMs:now,archiveEnabled:false}));
 assert.ok(metrics.confirmation.pending>=1);assert.ok(metrics.confirmation.oldestAgeMs>=300000);assert.equal(metrics.confirmation.brokenBindings,0);assert.ok(salesQueueAlerts(metrics).some(a=>a.event==="sales.alert.confirmation_overdue"));
 assert.equal(metrics.archive.enabled,false);assert.ok(!salesQueueAlerts(metrics).some(a=>a.event==="sales.alert.archive_window_overdue"));
 assert.equal(metrics.backorder.historyComplete,false,"Current scheduler rows are not a durable24h history");
 for(const table of tables)assert.deepEqual((await f.db.query(`SELECT * FROM ${table}`))[0],before[table],table);
 for(const value of ["customerId","salesOrderNumber","eventId","externalOrderId","reason","payload","last_error"])assert.ok(!JSON.stringify(metrics).includes(value));
 await f.runAsFixtureRequest(f.claims,()=>f.database.withTransaction(async()=>{await assert.rejects(()=>collectSalesQueueMetrics({database:f.database,nowMs:now,archiveEnabled:false}),TypeError);}));
 const signal=AbortSignal.abort();await assert.rejects(()=>collectSalesQueueMetrics({database:f.database,nowMs:now,archiveEnabled:false,signal}),{name:"AbortError"});
});

nativeTest("TASK-062 developer real registered instance metrics job publishes safe gauges and reports native dependency failure",async t=>{
 const f=await setup(t),scheduler=f.app.services.require("scheduler"),job=scheduler.jobs.get("sales.metrics");assert.ok(job,"Actual metrics job must be discovered");assert.equal(job.scope,"instance");assert.equal(job.intervalMs,300000);
 scheduler.setTimer=()=>({unref(){}});scheduler.clearTimer=()=>{};await f.app.start();
 const logger=f.app.services.require("logging").logger,info=logger.info,entries=[];logger.info=async function(event,message,context){if(event==="sales.metrics")entries.push(context);return info.call(this,event,message,context);};
 t.after(()=>{logger.info=info;});
 const tables=["sales_orders","sales_order_lines","sales_operation_requests","sales_audit_logs","sales_backorder_entries","sales_intake_orders","sales_archive_batches"],before={};for(const table of tables)before[table]=(await f.db.query(`SELECT * FROM ${table}`))[0];
 await scheduler.execute(job);assert.equal(scheduler.stats.get(job.name).lastOutcome,"succeeded");assert.equal(entries.length,1);
 for(const table of tables)assert.deepEqual((await f.db.query(`SELECT * FROM ${table}`))[0],before[table],table);
 const original=f.database.withTransaction;let injected=false;f.database.withTransaction=function(work,options){return original.call(this,async tx=>work(new Proxy(tx,{get(target,key){if(key!=="query")return Reflect.get(target,key);return (sql,...args)=>{if(!injected&&sql.includes("SELECT COUNT(*) AS pending")){injected=true;return target.query("SELECT * FROM synthetic_absent_sales_metrics_dependency");}return target.query(sql,...args);};}})),options);};
 try{await scheduler.execute(job);assert.equal(injected,true);assert.equal(scheduler.stats.get(job.name).lastOutcome,"failed");assert.match(scheduler.stats.get(job.name).lastError,/Sales operational metrics unavailable/u);assert.ok(!scheduler.stats.get(job.name).lastError.includes("SELECT"));assert.equal(entries.length,1,"Failure must not publish an all-zero healthy snapshot");}finally{f.database.withTransaction=original;}
 for(const table of tables)assert.deepEqual((await f.db.query(`SELECT * FROM ${table}`))[0],before[table],table);
});

nativeTest("TASK-062 developer Archive overdue observation follows the last due real window across month and year",async t=>{
 const f=await setup(t);
 for(const [clock,day,period]of [["2026-05-01T04:00:00+08:00",30,"202604"],["2027-01-01T04:00:00+08:00",31,"202612"],["2027-02-01T04:00:00+08:00",31,"202701"]]){
  const m=await collectSalesQueueMetrics({database:f.database,nowMs:Date.parse(clock),archiveEnabled:true,config:{archiveDayOfMonth:day,archiveHourHkt:2},statsFreshnessMs:900000});
  assert.equal(m.archive.windowOverdue,true,clock);assert.equal(m.archive.observedPeriodKey,period);
 }
});
nativeTest("TASK-062 developer synthetic standard-batch projections with absent or future start never become healthy zero",async t=>{
 const f=await setup(t),now=f.time.nowMs(),job=await f.insert("sales_import_jobs",{batch_number:"MET-"+crypto.randomUUID().slice(0,8),template_version:"1",original_file_name:"synthetic.csv",file_sha256:Buffer.alloc(32),file_size_bytes:1,status:"QUEUED",source_order_count:10000,created_at:now,updated_at:now});
 // Metadata corruption projections, not a claim that10000 source orders were actually ingested.
 for(const at of [null,now+1]){await f.db.execute("UPDATE sales_import_jobs SET confirmed_at=?,processing_started_at=NULL WHERE id=?",[at,job]);const m=await collectSalesQueueMetrics({database:f.database,nowMs:now,archiveEnabled:false,statsFreshnessMs:900000});assert.ok(salesQueueAlerts(m).some(a=>a.event==="sales.alert.import_batch_time_unobserved"));assert.ok(m.imports.unobservedStandardBatches>=1);}
});
nativeTest("TASK-062 developer stale or future scheduler diagnostic rows cannot report current healthy recovery",async t=>{
 const f=await setup(t),now=f.time.nowMs(),instance="metrics-stale-"+crypto.randomUUID(),[[clock]]=await f.db.query("SELECT UNIX_TIMESTAMP() AS seconds");
 await f.insert("fr_job_stats",{instance_id:instance,job_name:"sales.confirmationRecovery",last_finished_at:now-1,last_success_at:now-1,consecutive_failures:0,updated_at:Number(clock.seconds)-901},"instance_id");
 for(const updated of [Number(clock.seconds)-901,Number(clock.seconds)+60]){await f.db.execute("UPDATE fr_job_stats SET updated_at=? WHERE instance_id=?",[updated,instance]);const m=await collectSalesQueueMetrics({database:f.database,nowMs:f.time.nowMs(),archiveEnabled:false,statsFreshnessMs:900000});assert.equal(m.recovery.consecutiveFailures,null);assert.ok(salesQueueAlerts(m).some(a=>a.event==="sales.alert.recovery_history_unobserved"));}
});
nativeTest("TASK-062 developer a completed current Archive batch cannot mask an older unresolved batch",async t=>{
 const f=await setup(t),now=Date.parse("2027-03-05T12:00:00+08:00"),label=crypto.randomUUID().slice(0,8);
 // Controlled Batch metadata projections, not actual archived order workflows.
 await f.insert("sales_archive_batches",{batch_number:"MET-OLD-"+label,period_key:"202702",cutoff_at:Date.parse("2025-02-02T02:00:00+08:00"),status:"RUNNING",started_at:Date.parse("2027-02-02T02:00:00+08:00"),updated_at:Date.parse("2027-02-02T02:00:00+08:00")});
 await f.insert("sales_archive_batches",{batch_number:"MET-NEW-"+label,period_key:"202703",cutoff_at:Date.parse("2025-03-02T02:00:00+08:00"),status:"COMPLETED",started_at:now-86400000,updated_at:now-1,completed_at:now-1});
 const m=await collectSalesQueueMetrics({database:f.database,nowMs:now,archiveEnabled:true,statsFreshnessMs:900000});assert.equal(m.archive.windowOverdue,true);assert.ok(salesQueueAlerts(m).some(a=>a.event==="sales.alert.archive_window_overdue"));
});

nativeTest("TASK-062 developer real MySql stats publisher seconds timestamp preserves fresh success and failure observations",async t=>{
 const f=await setup(t),instance="metrics-publisher-"+crypto.randomUUID(),store=new MySqlJobStatsStore({database:f.database});f.beforeParents.push(()=>f.db.execute("DELETE FROM fr_job_stats WHERE instance_id=?",[instance]));
 for(const failures of [0,2]){const finished=f.time.nowMs()-1;await store.write([{instanceId:instance,jobName:"sales.confirmationRecovery",host:"synthetic",address:"",scope:"cluster",lastStartedAt:finished-1,lastFinishedAt:finished,lastSuccessAt:failures?null:finished,lastOutcome:failures?"failed":"succeeded",lastDurationMs:1,lastError:failures?"synthetic":null,runs:1,failures,timeouts:0,skippedOverlapping:0,skippedNotLeader:0,consecutiveFailures:failures}]);
  const [[row]]=await f.db.query("SELECT updated_at,last_finished_at FROM fr_job_stats WHERE instance_id=?",[instance]);assert.ok(Number(row.updated_at)<Number(row.last_finished_at)/100,"Real writer stores seconds and instance completion stores milliseconds");
  const m=await collectSalesQueueMetrics({database:f.database,nowMs:f.time.nowMs(),archiveEnabled:false,statsFreshnessMs:900000});assert.equal(m.recovery.consecutiveFailures,failures);assert.equal(salesQueueAlerts(m).some(a=>a.event==="sales.alert.confirmation_recovery_failed"),failures===2);
 }
});

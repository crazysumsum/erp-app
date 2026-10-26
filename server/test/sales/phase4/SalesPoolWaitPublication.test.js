import assert from "node:assert/strict";
import test from "node:test";
import {SalesMetricsJob} from "../../../src/services/scheduler/jobs/SalesMetricsJob.js";
const bounds=[1,5,10,25,50,100,250,500,1000,5000,10000,30000,null];
const reading=()=>({inFlight:0,observations:0,durationSumMs:0,maxDurationMs:0,aboveThreshold:0,outcomes:{acquired:0,timeout:0,aborted:0,rejected:0},buckets:bounds.map(()=>0),boundsMs:[...bounds],thresholdMs:1000});
for(const failAt of ["info","alert"])test(`TASK-062 W09 publication failure at ${failAt} cannot discard timeout interval`,async()=>{
 const current=reading();let now=1700000000000,fail=false;const published=[],alerts=[];
 const database={getConnectionWaitMetrics:()=>structuredClone(current),withTransaction:async work=>work({query:async sql=>{
 if(sql.includes("FROM sales_orders s"))return [[{pending:0,oldest_at:null,broken:0}]];
 if(sql.includes("FROM sales_intake_orders i"))return [[{pending:0,oldest_at:null,unknown_count:0}]];
 if(sql.includes("FROM (SELECT COALESCE(processing_started_at"))return [[{overdue:0,unobserved:0}]];
 if(sql.includes("FROM sales_backorder_entries"))return [[{open_count:0,oldest_at:null}]];
 if(sql.includes("FROM sales_export_jobs"))return [[{pending:0,oldest_at:null}]];
 if(sql.includes("MAX(last_success_at)"))return [[{observed_success_at:now}]];
 if(sql.includes("FROM sales_archive_batches"))return [[]];
 throw Error("unexpected fixture statement");}})};
 const logger={info:async(event,message,context)=>{if(fail&&failAt==="info"){fail=false;throw Error("synthetic publisher failure");}published.push(context);},warn:async()=>{},error:async(event,message,context)=>{if(fail&&failAt==="alert"&&event==="sales.alert.pool_capacity_failed"){fail=false;throw Error("synthetic alert publisher failure");}alerts.push({event,context});}};
 const services={require:name=>({scheduler:{describeJobs:()=>[]},mysqldatabase:database,time:{nowMs:()=>now},logging:{logger}})[name]},job=new SalesMetricsJob({config:{scheduler:{jobs:{"sales.archive":{enabled:false}}}},services});
 await job.report();assert.equal(published.at(-1).poolWait.coverage,"BASELINE");
 now+=1000;current.observations=1;current.outcomes.timeout=1;current.buckets[9]=1;current.durationSumMs=1001;current.maxDurationMs=1001;current.aboveThreshold=1;fail=true;
 await assert.rejects(()=>job.report(),/Sales operational metrics unavailable/u);
 now+=1000;current.observations=2;current.outcomes.acquired=1;current.buckets[1]=1;current.durationSumMs=1003;
 const next=await job.report();assert.equal(next.poolWait.coverage,"WINDOW");
 assert.equal(next.poolWait.outcomes.timeout,1,"unpublished capacity failure must still be observed");
 assert.equal(next.poolWait.samples,2);assert.equal(next.poolWait.windowStartAtMs,1700000000000);assert.equal(next.poolWait.windowEndAtMs,now);if(failAt==="alert"){const partial=published.at(-2).poolWait;assert.equal(partial.windowStartAtMs,next.poolWait.windowStartAtMs);assert.ok(partial.windowEndAtMs<next.poolWait.windowEndAtMs);}assert.ok(alerts.some(row=>row.event==="sales.alert.pool_capacity_failed"));
});

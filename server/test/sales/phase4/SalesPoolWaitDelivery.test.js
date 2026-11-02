import {observeSalesQuery} from "../../../src/modules/sales/salesQueryObservations.js";
import assert from "node:assert/strict";
import test from "node:test";
import {createSalesMetricsPublicationFixture} from "./salesMetricsPublicationFixture.js";
import {SystemLogger} from "../../../src/services/logging/systemLogger.js";
const bounds=[1,5,10,25,50,100,250,500,1000,5000,10000,30000,null];
const reading=()=>({inFlight:0,observations:0,durationSumMs:0,maxDurationMs:0,aboveThreshold:0,outcomes:{acquired:0,timeout:0,aborted:0,rejected:0},buckets:bounds.map(()=>0),boundsMs:[...bounds],thresholdMs:1000});
test("TASK-062 W10 actual SystemLogger writer outage cannot erase later observable capacity failure",async()=>{
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
 const logger=new SystemLogger({logger:{enabled:true,isSensitiveField:()=>false,write:async entry=>{if(fail)throw Error("synthetic reviewed writer outage");if(entry.event==="sales.metrics")published.push(entry.context);else alerts.push(entry);}}});
 const {job,signal}=await createSalesMetricsPublicationFixture({database,time:{nowMs:()=>now},logger});
 await job.report(signal);assert.equal(published.at(-1).poolWait.coverage,"BASELINE");
 now+=1000;current.observations=1;current.outcomes.timeout=1;current.buckets[9]=1;current.durationSumMs=1001;current.maxDurationMs=1001;current.aboveThreshold=1;let tick=0;await assert.rejects(()=>observeSalesQuery(database,"active_list",()=>{throw Error("Synthetic private query failure");},{clock:()=>tick++?2001:0}));fail=true;
 await job.report(signal);fail=false; // Actual SystemLogger swallows writer rejection; no invented scheduler rejection.
 now+=1000;current.observations=2;current.outcomes.acquired=1;current.buckets[1]=1;current.durationSumMs=1003;
 tick=0;await observeSalesQuery(database,"active_list",()=>1,{clock:()=>tick++?1:0});
 const next=await job.report(signal);assert.equal(next.poolWait.coverage,"WINDOW");
 assert.equal(next.poolWait.outcomes.timeout,0,"newinterval itself has no timeout; this must not hide lifetime failure");
 assert.equal(next.poolWait.lifetime.outcomes.timeout,1);assert.equal(next.poolWait.lifetime.observations,2);assert.equal(next.poolWait.deliveryCoverage,"UNKNOWN");
 const query=next.queryOperations;assert.equal(query.operations[0].samples,1);assert.equal(query.operations[0].outcomes.error,0);assert.equal(query.operations[0].lifetime.observations,2);assert.equal(query.operations[0].lifetime.outcomes.error,1);assert.equal(query.operations[0].lifetime.aboveThreshold,1);assert.equal(query.deliveryCoverage,"UNKNOWN");assert.ok(!JSON.stringify(query).includes("Synthetic private"));
});

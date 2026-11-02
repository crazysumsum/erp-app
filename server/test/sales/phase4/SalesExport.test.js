import assert from "node:assert/strict";
import test from "node:test";
import {validateSalesExportInput} from "../../../src/modules/sales/SalesExportService.js";
import {salesPayloadHash} from "../../../src/modules/sales/salesCanonicalHash.js";

test("TC-045 Export accepts only the two approved stores and refuses client file/actor fields",()=>{
 for(const input of [{scope:"IMPORT_RESULT",filters:{}},{scope:"ACTIVE",filters:{},filePath:"x"},{scope:"ACTIVE",filters:{createdBy:2}},{scope:"ACTIVE",filters:{page:2}},{scope:"ACTIVE",filters:{pageSize:100}},{scope:"ACTIVE",filters:{sortBy:"id DESC;"}}])assert.throws(()=>validateSalesExportInput(input),{code:"SALES_INPUT_INVALID"});
});
test("TC-045 Export snapshots canonical filters without altering the initiating query",()=>{
 const filters=Object.freeze({hasBackorder:false,view:"mine",sortBy:"updatedAt",descending:false}),input={scope:"ACTIVE",filters},snapshot=validateSalesExportInput(input);
 assert.deepEqual(snapshot,{scope:"ACTIVE",filters:{...filters}});assert.deepEqual(filters,input.filters);assert.equal(salesPayloadHash(snapshot),salesPayloadHash(validateSalesExportInput({scope:"ACTIVE",filters:{descending:false,sortBy:"updatedAt",view:"mine",hasBackorder:false}})));
});
test("TC-050 Archive export rejects an empty or unrestricted search",()=>{
 for(const filters of [{},{q:"customer"},{status:["COMPLETED"]},{orderDateFrom:"2025-01-01"},{orderDateTo:"2025-12-31"}])assert.throws(()=>validateSalesExportInput({scope:"ARCHIVE",filters}),{code:"SALES_INPUT_INVALID"});
});
test("TC-050 Archive export accepts each approved independent bound",()=>{
 for(const filters of [{number:"SO-202601-000001"},{externalOrderId:"Exact_%"},{customerId:1},{orderDateFrom:"2025-01-01",orderDateTo:"2025-12-31"}])assert.equal(validateSalesExportInput({scope:"ARCHIVE",filters}).scope,"ARCHIVE");
});
test("TC-050 Archive export retains the 366-day maximum and calendar validation",()=>{
 assert.equal(validateSalesExportInput({scope:"ARCHIVE",filters:{orderDateFrom:"2024-01-01",orderDateTo:"2024-12-31"}}).scope,"ARCHIVE");
 assert.throws(()=>validateSalesExportInput({scope:"ARCHIVE",filters:{orderDateFrom:"2025-02-30",orderDateTo:"2025-03-01"}}),{code:"SALES_DATE_INVALID"});
 for(const filters of [{orderDateFrom:"2024-01-01",orderDateTo:"2025-01-02"},{orderDateFrom:"2025-02-02",orderDateTo:"2025-02-01"}])assert.throws(()=>validateSalesExportInput({scope:"ARCHIVE",filters}),{code:"SALES_INPUT_INVALID"});
});

import {SalesExportJob} from "../../../src/services/salesJobs/jobs/SalesExportJob.js";
import {SalesJobRuntimeService} from "../../../src/services/salesJobs/SalesJobRuntimeService.js";
import {SalesAuditService} from "../../../src/modules/sales/SalesAuditService.js";
import {randomUUID} from "node:crypto";
test("TC-045 Export job uses only its fixed registered cluster lease and actual running signal",async()=>{
 const controller=new AbortController(),job={name:"sales.exportWorker",serviceName:"job.salesExport",method:"run",scope:"cluster",enabled:true},scheduler={jobs:new Map(),running:new Map(),owner:"synthetic-owner",started:true,stopped:false,schedulerConfig:{enabled:true},register(instance){assert.ok(instance instanceof SalesExportJob);this.jobs.set(job.name,job);}},sources={mysqldatabase:{query(){throw Error("Unexpected SQL");},withTransaction(){throw Error("Unexpected SQL");}},time:{nowMs:()=>100},logging:{logger:{info:async()=>{}}}},services={require:key=>sources[key]},runtime=new SalesJobRuntimeService({services});sources.scheduler=scheduler;sources.salesJobs=runtime;
 const service=new SalesExportJob({services});await service.initialize();assert.equal(runtime.exportPrincipal(),null);assert.equal(SalesExportJob.jobs[0].scope,"cluster");scheduler.running.set(job.name,{controller});assert.deepEqual(runtime.exportPrincipal(),{leaseOwner:scheduler.owner,signal:controller.signal});
 for(const change of [()=>job.enabled=false,()=>scheduler.started=false,()=>scheduler.stopped=true,()=>scheduler.schedulerConfig.enabled=false,()=>scheduler.jobs.delete(job.name)]){change();assert.equal(runtime.exportPrincipal(),null);job.enabled=true;scheduler.started=true;scheduler.stopped=false;scheduler.schedulerConfig.enabled=true;scheduler.jobs.set(job.name,job);}
 let actual;runtime.exports.runBatch=async request=>{actual=request.signal;return {processed:1,failed:0};};assert.equal((await service.run(controller.signal)).processed,1);assert.equal(actual,controller.signal);runtime.exports.runBatch=async()=>{throw Error("Synthetic private path /unsafe/payload.csv");};await assert.rejects(()=>service.run(controller.signal),error=>error.message==="Sales Export processing failed"&&!error.cause);await assert.rejects(()=>service.run(new AbortController().signal));controller.abort();assert.equal(runtime.exportPrincipal(),null);await assert.rejects(()=>service.run(controller.signal));
});
test("TC-045 Export Audit keeps only allowlisted hashes/counts and rejects payload fields",async()=>{
 const audit=new SalesAuditService(),writes=[],connection={async execute(sql,args){writes.push({sql,args});}},event={actor:{id:1,username:"synthetic"},targetId:2,targetNumber:"2",eventId:randomUUID(),nowMs:1,details:{scope:"ACTIVE",filtersHash:"a".repeat(64),rowCount:250000}};
 for(const action of ["sales_export.created","sales_export.completed","sales_export.downloaded","sales_export.expired"])await audit.record(connection,{...event,action});assert.equal(writes.length,4);assert.ok(writes.every(x=>x.args[4]==="EXPORT_JOB"));
 for(const details of [{...event.details,rowCount:250001},{...event.details,filters:{customerId:1}},{...event.details,scope:"IMPORT_RESULT"},{...event.details,filtersHash:"payload"}])await assert.rejects(()=>audit.record(connection,{...event,action:"sales_export.created",details}));assert.equal(writes.length,4);
});

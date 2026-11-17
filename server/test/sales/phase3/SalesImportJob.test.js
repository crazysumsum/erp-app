import assert from "node:assert/strict";
import test from "node:test";
import {AsyncLocalStorage} from "node:async_hooks";
import {SalesImportJob} from "../../../src/services/salesJobs/jobs/SalesImportJob.js";
import {SalesJobRuntimeService} from "../../../src/services/salesJobs/SalesJobRuntimeService.js";
test("TC-035 registered Import job exposes only its active running signal and fixed cluster principal",async()=>{
 const storage=new AsyncLocalStorage(),controller=new AbortController(),job={name:"sales.importWorker",serviceName:"job.salesImport",method:"run",scope:"cluster",enabled:true},scheduler={jobs:new Map(),running:new Map(),owner:"test-owner",started:true,stopped:false,schedulerConfig:{enabled:true},register(instance){assert.ok(instance instanceof SalesImportJob);this.jobs.set(job.name,job);}},sources={mysqldatabase:{context:{storage},query(){throw Error("Unexpected SQL");},withTransaction(){throw Error("Unexpected transaction");}},time:{nowMs:()=>100},logging:{logger:{info:async()=>{},error:async()=>{}}}},services={require:key=>sources[key]},runtime=new SalesJobRuntimeService({services});sources.scheduler=scheduler;sources.salesJobs=runtime;
 const service=new SalesImportJob({services});await service.initialize();assert.equal(runtime.importPrincipal(),null);scheduler.running.set(job.name,{controller});assert.deepEqual(runtime.importPrincipal(),{leaseOwner:scheduler.owner,signal:controller.signal});
 for(const change of [()=>job.enabled=false,()=>scheduler.started=false,()=>scheduler.stopped=true,()=>scheduler.schedulerConfig.enabled=false,()=>scheduler.jobs.delete(job.name)]){change();assert.equal(runtime.importPrincipal(),null);job.enabled=true;scheduler.started=true;scheduler.stopped=false;scheduler.schedulerConfig.enabled=true;scheduler.jobs.set(job.name,job);}
 let received,processingSignal;const stores=[];runtime.importer.runProcessingBatch=async({signal})=>{processingSignal=signal;assert.equal(storage.getStore(),stores.at(-1));return {processed:0};};runtime.importer.runPrecheckBatch=async request=>{received=request;const current=storage.getStore();assert.deepEqual(current,{signal:controller.signal,auth:null,databaseTransaction:null});stores.push(current);return {processed:1,classified:2};};
 assert.equal((await service.run(controller.signal)).classified,2);assert.equal(received.signal,controller.signal);assert.equal(processingSignal,controller.signal);assert.equal(storage.getStore(),undefined);
 const foreign={signal:new AbortController().signal,auth:{claims:{sub:"foreign"}},databaseTransaction:{}};
 await storage.run(foreign,async()=>{assert.equal((await service.run(controller.signal)).classified,2);assert.equal(storage.getStore(),foreign);});assert.equal(storage.getStore(),undefined);assert.equal(stores.length,2);assert.notEqual(stores[0],stores[1]);
 await assert.rejects(()=>service.run(new AbortController().signal));
 const context=sources.mysqldatabase.context;delete sources.mysqldatabase.context;try{await assert.rejects(()=>service.run(controller.signal),{message:"Sales Import worker unavailable"});}finally{sources.mysqldatabase.context=context;}
 controller.abort();assert.equal(runtime.importPrincipal(),null);await assert.rejects(()=>service.run(controller.signal));assert.equal(stores.length,2);
});

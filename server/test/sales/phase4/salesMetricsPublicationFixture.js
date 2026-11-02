import assert from 'node:assert/strict';
import {SalesMetricsJob} from '../../../src/services/scheduler/jobs/SalesMetricsJob.js';
// Publication-only unit fixture. Real ledger/provider SQL and principal isolation have separate required native cases.
export async function createSalesMetricsPublicationFixture({database,time,logger}){
 const controller=new AbortController(),definition={name:'sales.metrics',serviceName:'job.salesMetrics',method:'report',scope:'instance',enabled:true};
 const scheduler={started:true,stopped:false,owner:'publication-fixture',schedulerConfig:{enabled:true},jobs:new Map(),running:new Map([[definition.name,{controller}]]),describeJobs:()=>[],register(instance){assert.ok(instance instanceof SalesMetricsJob);this.jobs.set(definition.name,definition);}};
 const job=new SalesMetricsJob({config:{scheduler:{jobs:{'sales.archive':{enabled:false}}}},services:{require:name=>({scheduler,mysqldatabase:database,time,logging:{logger}})[name]}});await job.initialize();
 job.observations.collect=async({signal})=>{assert.equal(signal,controller.signal);return {version:'1',history:{coverage:'UNKNOWN',historyComplete:false,noSuccessOver24h:false,lastSuccessAgeMs:0},fifo:{coverage:'COMPLETE',observedScopes:0,unknownScopes:0,active:0},providerUnknown:{active:false,samples:0,sampledSpanMs:0}};};
 return {job,signal:controller.signal};
}

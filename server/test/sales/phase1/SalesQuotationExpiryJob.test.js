import assert from "node:assert/strict";
import test from "node:test";
import { SalesQuotationService } from "../../../src/modules/sales/SalesQuotationService.js";
import { SalesQuotationExpiryJob } from "../../../src/services/salesJobs/jobs/SalesQuotationExpiryJob.js";
import { SalesJobRuntimeService } from "../../../src/services/salesJobs/SalesJobRuntimeService.js";
const time = { nowMs: () => Date.parse("2026-10-05T16:00:00Z"), at: value => new Date(value) };
function fixture(pages, { auditError, abort } = {}) {
  const reads=[], writes=[], audits=[];let cursor=0;
  const candidates=new Map(pages.flat().map(row=>[row.id,row]));
  const tx={ async query(sql,args){reads.push({sql,args});return sql.includes("WHERE id=? FOR UPDATE")?[[candidates.get(args[0])]]:[pages[cursor++] ?? []];},async execute(sql,args){writes.push({sql,args});return [{affectedRows:1}];} };
  const database={async withTransaction(work,options){assert.equal(options?.signal,abort?.signal);return work(tx);} };
  const audit={async record(_tx,event){audits.push(event);if(auditError)throw auditError;if(abort)abort.abort();}};
  return {service:new SalesQuotationService({database,time,audit,customerProvider:{},itemProvider:{},businessMaster:{}}),reads,writes,audits};
}
const row = id => ({id,quotation_number:`QT-202610-${String(id).padStart(6,"0")}`,status:"ISSUED",version:2,valid_until:"2026-10-05"});
test("TC-013 expiry is a cluster hourly job registered through the runtime",async()=>{
 assert.deepEqual(SalesQuotationExpiryJob.jobs,[{name:"sales.quotationExpire",method:"run",scope:"cluster",intervalMs:3600000,timeoutMs:30000}]);
 let registered;const runtime={expireQuotations:async signal=>({signal})};const job=new SalesQuotationExpiryJob({services:{require:name=>name==="scheduler"?{register:value=>{registered=value;}}:runtime}});
 await job.initialize();assert.equal(registered,job);const signal=new AbortController().signal;assert.deepEqual(await job.run(signal),{signal});assert.ok(SalesJobRuntimeService.service.dependencies.includes("mysqldatabase"));
});
test("TC-013 expiry uses HKT date, the shared effective rule and atomic safe system audit",async()=>{
 const f=fixture([[row(1)]]);const result=await f.service.expire();assert.equal(result.expired,1);assert.equal(result.lastId,1);assert.equal(f.reads[0].args[0],"2026-10-06");assert.match(f.reads[1].sql,/WHERE id=\? FOR UPDATE/u);
 assert.equal(f.audits[0].actor.id,null);assert.equal(f.audits[0].action,"sales_quotation.expired");assert.deepEqual(f.audits[0].details,{fromStatus:"ISSUED",toStatus:"EXPIRED",version:3});assert.match(f.audits[0].eventId,/^[a-f0-9-]{36}$/u);
});
test("TC-013 expiry limits work to five batches of one hundred using ascending ID keysets",async()=>{
 const pages=Array.from({length:6},(_,page)=>Array.from({length:100},(_,index)=>row(page*100+index+1))),f=fixture(pages);
 const result=await f.service.expire();assert.equal(result.expired,500);const scans=f.reads.filter(read=>read.sql.includes("ORDER BY id"));assert.equal(scans.length,5);assert.equal(result.lastId,500);assert.equal(scans[1].args[1],100);assert.equal(scans[0].args[2],100);
});
test("TC-013 expiry leaves an equal valid-until date and other states unchanged",async()=>{
 const f=fixture([[{...row(1),valid_until:"2026-10-06"},{...row(2),status:"DRAFT"},{...row(3),status:"EXPIRED"}]]);assert.equal((await f.service.expire()).expired,0);assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);
});
test("TC-013 expiry does no database work for an already aborted run",async()=>{
 const abort=new AbortController();abort.abort();const f=fixture([],{abort});await assert.rejects(()=>f.service.expire({signal:abort.signal}));assert.equal(f.reads.length,0);
});
test("TC-013 expiry propagates audit failure and abort before transaction completion",async()=>{
 const f=fixture([[row(1)]],{auditError:new Error("required audit failure")});await assert.rejects(()=>f.service.expire(),/required audit failure/u);
 const abort=new AbortController(),a=fixture([[row(1),row(2)]],{abort});await assert.rejects(()=>a.service.expire({signal:abort.signal}));assert.equal(a.audits.length,1);assert.equal(a.writes.length,1);
});

test("TC-013 HKT midnight changes the shared expiry boundary without waiting for the next job",async()=>{
 const f=fixture([[row(1)]]);f.service.time={...time,nowMs:()=>Date.parse("2026-10-05T15:59:59.999Z")};assert.equal((await f.service.expire()).expired,0);assert.equal(f.reads[0].args[0],"2026-10-05");
});
test("TC-013 runtime emits only safe aggregate metrics and sanitizes scheduler-facing errors",async()=>{
 const messages=[],runtime=new SalesJobRuntimeService({services:{require:name=>name==="logging"?{logger:{info:async(...args)=>messages.push(args)}}:name==="time"?time:{query:async()=>[[]]}}});
 runtime.quotation={expire:async()=>({processed:1,expired:1,batches:1,lastId:1})};assert.deepEqual(await runtime.expireQuotations(),{processed:1,expired:1,batches:1,lastId:1});assert.deepEqual(messages[0][2],{processed:1,expired:1,batches:1,lastId:1});runtime.quotation={expire:async()=>{throw new Error("private SQL probe");}};await assert.rejects(()=>runtime.expireQuotations(),error=>error.message==="Quotation expiry failed" && error.cause.message==="private SQL probe");
});

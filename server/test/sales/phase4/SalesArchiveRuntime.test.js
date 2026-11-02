import assert from "node:assert/strict";
import test from "node:test";
import {SalesJobRuntimeService} from "../../../src/services/salesJobs/SalesJobRuntimeService.js";
function fixture(){let queries=0;const database={context:{get:()=>null},query(){queries++;}},services={require(name){return name==="mysqldatabase"?database:name==="logging"?{logger:{}}:name==="time"?{nowMs:()=>Date.now()}:{jobs:new Map()};}};return {runtime:new SalesJobRuntimeService({config:{},services}),queries:()=>queries};}
test("actual SalesJobs denies caller scopes and scheduler lookalikes without creating SQL authority",async()=>{
 const f=fixture();assert.equal(await f.runtime.authorizeArchiveInTransaction({}, {orderId:"1",archiveBatchId:"1",cutoffMs:1}),false);assert.equal(await f.runtime.authorizeArchiveReadInTransaction({}, {orderId:"1",atMs:2}),false);await assert.rejects(()=>f.runtime.bindArchiveScheduler({jobs:new Map()}));await assert.rejects(()=>f.runtime.processArchives(new AbortController().signal),/Archive worker unavailable/u);assert.equal(f.queries(),0);assert.equal(f.runtime.archive,undefined);assert.equal(f.runtime.archiveScopes,undefined);
});

test("Archive caller with omitted signal is rejected before any metadata SQL",async()=>{
 const f=fixture();await assert.rejects(()=>f.runtime.processArchives(),{message:"Sales Archive worker unavailable"});assert.equal(f.queries(),0);
});

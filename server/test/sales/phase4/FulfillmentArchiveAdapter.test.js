import assert from "node:assert/strict";
import test from "node:test";
import {FulfillmentOpenMatterService} from "../../../src/services/fulfillment/FulfillmentOpenMatterService.js";
import {FulfillmentArchiveService} from "../../../src/services/fulfillmentArchive/FulfillmentArchiveService.js";
const fixture=()=>{const calls=[],database={context:{get:()=>null},query(){calls.push("query");}},services={require(name){calls.push(name);return name==="mysqldatabase"?database:{nowMs:()=>2};},resolve(name){calls.push(name);throw new Error("No executing job");}};return {services,calls};};
test("formal adapters declare unique existing provider and participant names with no constructor Runtime resolution",()=>{
 const f=fixture(),open=new FulfillmentOpenMatterService(f),archive=new FulfillmentArchiveService(f);assert.equal(FulfillmentOpenMatterService.service.name,"fulfillmentOpenMatter");assert.equal(FulfillmentArchiveService.service.name,"fulfillmentArchive");assert.equal(typeof open.getOrderArchiveStatus,"function");assert.equal(typeof archive.prepareOrderInTransaction,"function");assert.ok(!f.calls.includes("salesJobs"));
});
test("OpenMatter adapter preserves the numeric lifecycle refusal and strict Archive input",async()=>{
 const f=fixture(),service=new FulfillmentOpenMatterService(f);assert.deepEqual(await service.assertSalesLifecycleAllowedInTransaction({},{}),{status:"UNKNOWN"});await assert.rejects(()=>service.getOrderArchiveStatus(1,{atMs:2}),TypeError);await assert.rejects(()=>service.getOrderArchiveStatus("1",{atMs:2,actor:"salesJobs"}),TypeError);assert.ok(!f.calls.includes("query"));assert.ok(!f.calls.includes("salesJobs"));
});
test("Archive adapter cannot grant authority from service names, caller fields or fabricated executor",async()=>{
 const f=fixture(),service=new FulfillmentArchiveService(f),scope={orderId:"1",archiveBatchId:"1",cutoffMs:1};await assert.rejects(()=>service.prepareOrderInTransaction({},scope),{code:"FULFILLMENT_ARCHIVE_FORBIDDEN"});await assert.rejects(()=>service.prepareOrderInTransaction({}, {...scope,serviceName:"salesJobs"}),TypeError);assert.ok(!f.calls.includes("query"));assert.ok(!f.calls.includes("salesJobs"));
});

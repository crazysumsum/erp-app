import assert from "node:assert/strict";
import test from "node:test";
import {SalesIntakeWorker} from "../../../src/modules/sales/SalesIntakeWorker.js";
test("TC-038 processing worker refuses missing/stale registered signal before a Job claim or source effect",async()=>{
 const signal=new AbortController().signal,query=()=>assert.fail("Unauthorized SQL"),database={query,withTransaction:work=>work({query})};
 for(const authorizeSalesImport of [undefined,()=>({leaseOwner:"owner",signal:new AbortController().signal})]){const worker=new SalesIntakeWorker({database,time:{},intakeService:{process:()=>assert.fail("Unauthorized effect")},authorizeSalesImport});await assert.rejects(()=>worker.runBatch({signal}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});}
});

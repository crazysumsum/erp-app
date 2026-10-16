import assert from "node:assert/strict";
import test from "node:test";
import { validateSalesAuditQuery,validateSalesOrderQuery } from "../../../src/modules/sales/SalesInquiryService.js";
import { safeSalesOperationResult } from "../../../src/modules/sales/SalesOperationService.js";
test("TC-046 Audit query rejects unknown filters and sort fragments",()=>{
 for(const input of [{extra:1},{sortBy:"occurred_at DESC;"},{targetType:"users"},{targetId:0},{actorId:-1},{action:"x".repeat(81)}])assert.throws(()=>validateSalesAuditQuery(input),{code:"SALES_INPUT_INVALID"});
});
test("TC-046 Audit pagination and time bounds reject unsafe or inverted values",()=>{
 for(const input of [{page:0},{pageSize:101},{page:Number.MAX_SAFE_INTEGER,pageSize:100},{occurredFrom:-1},{occurredFrom:2,occurredTo:1},{descending:"false"}])assert.throws(()=>validateSalesAuditQuery(input),{code:"SALES_INPUT_INVALID"});
 const q=validateSalesAuditQuery({targetType:"ORDER",targetId:2,occurredFrom:0,occurredTo:1});assert.equal(q.pageSize,20);assert.equal(q.page,1);assert.equal(q.descending,true);
});
test("TC-044 common order views have an explicit allowlist",()=>{
 for(const view of ["all","mine","outstanding","backorder","finalized"])assert.equal(validateSalesOrderQuery({view}).view,view);
 assert.throws(()=>validateSalesOrderQuery({view:"created_by=7"}),{code:"SALES_INPUT_INVALID"});
});
test("TC-046 Upload operation result exposes only its original safe Import identity",()=>{
 const result=safeSalesOperationResult({importJob:{id:7,batchNumber:"SI-202610-000001",status:"UPLOADED",version:1,filePath:"private",originalFileName:"private.csv"},warnings:[]},"UPLOAD_IMPORT");
 assert.deepEqual(result,{id:7,number:"SI-202610-000001",status:"UPLOADED",version:1});
});
test("TC-046 Operation safe results reject unexpected fields, statuses and corrupt identities",()=>{
 const valid={id:1,number:"SO-202610-000001",status:"DRAFT",version:1};
 for(const patch of [{id:0},{number:"private-path"},{status:"UNKNOWN"},{filePath:"private"}])assert.throws(()=>safeSalesOperationResult({...valid,...patch}),TypeError);
 assert.throws(()=>safeSalesOperationResult({id:1,number:"SI-202610-000001",status:"UPLOADED",version:1}),TypeError);
 assert.throws(()=>safeSalesOperationResult({importJob:{id:1,batchNumber:"SI-202610-000001",status:"PROCESSING",version:1}},"UPLOAD_IMPORT"),TypeError);
});

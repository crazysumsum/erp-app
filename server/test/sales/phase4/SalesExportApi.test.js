import assert from "node:assert/strict";
import test from "node:test";
import {validateSalesExportJobsQuery} from "../../../src/modules/sales/SalesExportService.js";
import {CreateSalesExportHandler,ListSalesExportsHandler,GetSalesExportHandler,DownloadSalesExportHandler} from "../../../src/handlers/sales-exports/salesExportHandlers.js";
import {SALES_EXPORT_INPUT,SALES_EXPORT_SUMMARY} from "../../../src/handlers/sales-exports/salesExportSchemas.js";
test("TC-045 Export job list accepts bounded pages and never accepts an owner override",()=>{
 assert.deepEqual(validateSalesExportJobsQuery({}),{page:1,pageSize:20});
 for(const input of [{actorId:2},{createdBy:2},{filePath:"private"},{page:0},{pageSize:101},{page:Number.MAX_SAFE_INTEGER,pageSize:100}])assert.throws(()=>validateSalesExportJobsQuery(input),{code:"SALES_INPUT_INVALID"});
});
test("TC-045 Export HTTP handlers use view permission and create always declares202",()=>{
 for(const Handler of [CreateSalesExportHandler,ListSalesExportsHandler,GetSalesExportHandler,DownloadSalesExportHandler]){assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions,["sales.view"]);assert.ok(Handler.api.path.startsWith("/api/v1/sales-exports"));}
 assert.equal(CreateSalesExportHandler.api.method,"POST");assert.equal(CreateSalesExportHandler.api.path,"/api/v1/sales-exports/create");assert.ok(CreateSalesExportHandler.api.responseSchema[202]);assert.equal(CreateSalesExportHandler.api.idempotency?.enabled,true);assert.equal(typeof CreateSalesExportHandler.prototype.authorizeRequest,"function");assert.ok(SALES_EXPORT_INPUT.required.includes("eventId"));assert.equal(DownloadSalesExportHandler.api.download.enabled,true);
});
test("TC-045 Export contracts close filter and safe summary boundaries",()=>{
 assert.equal(SALES_EXPORT_INPUT.additionalProperties,false);assert.deepEqual(SALES_EXPORT_INPUT.properties.scope.enum,["ACTIVE","ARCHIVE"]);assert.equal(SALES_EXPORT_INPUT.properties.filters.additionalProperties,false);
 assert.ok(!Object.hasOwn(SALES_EXPORT_INPUT.properties.filters.properties,"page"));assert.ok(!Object.hasOwn(SALES_EXPORT_INPUT.properties.filters.properties,"pageSize"));assert.equal(SALES_EXPORT_SUMMARY.additionalProperties,false);assert.doesNotMatch(JSON.stringify(SALES_EXPORT_SUMMARY),/filePath|file_path|lease|createdBy|actorId|filters_hash/);
});

import {safeSalesOperationResult} from "../../../src/modules/sales/SalesOperationService.js";
test("TC-045 Export operation identity contains only id and cannot masquerade as a document",()=>{
 assert.deepEqual(safeSalesOperationResult({id:7},"CREATE_EXPORT"),{id:7});
 for(const input of [{id:0},{id:7,filePath:"private"},{id:7,number:"SO-202610-000001",status:"DRAFT",version:1}])assert.throws(()=>safeSalesOperationResult(input,"CREATE_EXPORT"),TypeError);
 assert.throws(()=>safeSalesOperationResult({id:7}),TypeError);
});

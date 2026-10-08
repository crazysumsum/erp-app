import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {SalesImportService,validateSalesImportCommand} from "../../../src/modules/sales/SalesImportService.js";
import {SalesOperationService} from "../../../src/modules/sales/SalesOperationService.js";
import {SalesAuditService} from "../../../src/modules/sales/SalesAuditService.js";
import {safeSalesCsvCell} from "../../../src/modules/sales/salesCsv.js";
import {ConfirmSalesImportHandler,CancelSalesImportHandler} from "../../../src/handlers/sales-imports/salesImportCommandHandlers.js";
import {DownloadSalesImportResultHandler} from "../../../src/handlers/sales-imports/downloadSalesImportResultHandler.js";
const actor={id:1,username:"synthetic",permissions:["sales.view","sales.import"]},claims={actorId:1,claimedRoles:["importer"],claimedPermissions:actor.permissions};
function fixture({status="READY",version=1,replay=null,permissions=actor.permissions,purged=null}={}){
 const calls=[],job={id:2,batch_number:"SI-261008-000001",status,version,source_file_path:"SI-261008-000001/source.csv",files_purged_at:purged},tx={async query(sql,params){calls.push({sql,params});if(sql.startsWith("SELECT username FROM users"))return [[{username:actor.username}]];if(sql.includes("FROM roles r JOIN user_roles"))return [[{name:"importer"}]];if(sql.includes("SELECT DISTINCT p.name"))return [permissions.map(name=>({name}))];if(sql.includes("FROM sales_import_jobs"))return [[job]];throw Error("Unexpected query");},async execute(sql,params){calls.push({sql,params});return [{affectedRows:1}];}},service=new SalesImportService({database:{withTransaction:work=>work(tx)},time:{nowMs:()=>10}});
 service.operations={run:(database,work)=>database.withTransaction(work),claim:async()=>({operationId:4,replay}),succeed:async(tx,result)=>calls.push({succeeded:result})};service.audit={record:async(tx,data)=>calls.push({audit:data})};return {service,calls,job};
}
test("TC-037 Import commands reject unknown fields, invalid version and event before a transaction",()=>{
 const eventId=randomUUID();assert.deepEqual(validateSalesImportCommand({eventId,version:1}),{eventId,version:1});
 for(const input of [null,[],{eventId,version:0},{eventId,version:1,force:true},{eventId:"invalid",version:1},{eventId,version:Number.MAX_SAFE_INTEGER}])assert.throws(()=>validateSalesImportCommand(input));
});
test("TC-037 confirmation queues only valid children and records actual confirmer, CAS and safe audit in one transaction",async()=>{
 const f=fixture(),eventId=randomUUID(),result=await f.service.confirm({claims,id:2,input:{eventId,version:1}});assert.deepEqual(result,{importJob:{id:2,batchNumber:f.job.batch_number,status:"QUEUED",version:2},warnings:[]});
 const children=f.calls.find(c=>c.sql?.startsWith("UPDATE sales_intake_orders"));assert.match(children.sql,/status='VALID'/u);assert.match(children.sql,/import_job_id=\?/u);
 const header=f.calls.find(c=>c.sql?.startsWith("UPDATE sales_import_jobs"));assert.match(header.sql,/confirmed_by/u);assert.match(header.sql,/version=\?/u);assert.ok(header.params.includes(actor.id));assert.equal(f.calls.find(c=>c.audit).audit.action,"sales_import.confirmed");assert.equal(f.calls.filter(c=>c.succeeded).length,1);
});
test("TC-037 replay returns original summary after worker progress and reauthorizes before replay",async()=>{
 const replay={id:2,number:"SI-261008-000001",status:"QUEUED",version:2},f=fixture({status:"COMPLETED",version:5,replay});assert.equal((await f.service.confirm({claims,id:2,input:{eventId:randomUUID(),version:1}})).importJob.status,"QUEUED");assert.equal(f.calls.filter(c=>c.audit||c.sql?.startsWith("UPDATE")).length,0);
 const forbidden=fixture({replay,permissions:["sales.view"]});await assert.rejects(()=>forbidden.service.confirm({claims:{...claims,claimedPermissions:["sales.view"]},id:2,input:{eventId:randomUUID(),version:1}}),{code:"FORBIDDEN"});
});
test("TC-037 confirmation and cancellation enforce precise READY/QUEUED diagram and version",async()=>{
 for(const status of ["UPLOADED","VALIDATING","PROCESSING","COMPLETED","PARTIAL_SUCCESS","FAILED","CANCELLED"]){const f=fixture({status});await assert.rejects(()=>f.service.cancel({claims,id:2,input:{eventId:randomUUID(),version:1}}),{code:"SALES_STATE_CONFLICT"});assert.equal(f.calls.filter(c=>c.audit).length,0);}
 for(const status of ["READY","QUEUED"]){const f=fixture({status});assert.equal((await f.service.cancel({claims,id:2,input:{eventId:randomUUID(),version:1}})).importJob.status,"CANCELLED");}
 await assert.rejects(()=>fixture({version:2}).service.confirm({claims,id:2,input:{eventId:randomUUID(),version:1}}),{code:"VERSION_CONFLICT"});
 await assert.rejects(()=>fixture({status:"QUEUED"}).service.confirm({claims,id:2,input:{eventId:randomUUID(),version:1}}),{code:"SALES_STATE_CONFLICT"});
});
test("TC-037 generic operation persists Import identity and accepts only narrow SI summaries",async()=>{
 const operations=new SalesOperationService(),calls=[],tx={async execute(sql,params){calls.push({sql,params});return [{insertId:4,affectedRows:1}];}},eventId=randomUUID();
 await operations.claim(tx,{eventId,commandType:"CONFIRM_IMPORT",targetId:2,payload:{version:1},actor,nowMs:1});assert.equal(calls[0].params[2],"IMPORT_JOB");
 await operations.succeed(tx,{operationId:4,result:{id:2,number:"SI-261008-000001",status:"QUEUED",version:2},nowMs:1});assert.equal(calls[1].params[0],"IMPORT_JOB");
 for(const result of [{id:2,number:"SI-261008-000001",status:"CONFIRMED",version:2},{id:2,number:"SO-261008-000001",status:"QUEUED",version:2}])await assert.rejects(()=>operations.succeed(tx,{operationId:4,result,nowMs:1}),TypeError);
});
test("TC-037 import audit uses bounded action-specific facts, excludes source payload and preserves required failure",async()=>{
 const service=new SalesAuditService(),request={actor,action:"sales_import.prechecked",targetId:2,targetNumber:"SI-261008-000001",eventId:randomUUID(),nowMs:1,details:{version:1,rowCount:100000,sourceOrderCount:10000,validCount:9999,invalidCount:1,duplicateCount:0}};let calls=0;
 const tx={async execute(sql,params){calls++;assert.equal(params[4],"IMPORT_JOB");throw Error("required audit failed");}};
 await assert.rejects(()=>service.record(tx,{...request,details:{...request.details,payload:"private"}}),TypeError);assert.equal(calls,0);await assert.rejects(()=>service.record(tx,request),/required audit failed/u);assert.equal(calls,1);
});
test("TC-037 CSV cells neutralize standard and whitespace-prefixed formula triggers without changing normal IDs",()=>{
 for(const value of ["=1+1","+CMD","-1","@SUM(A1)","\ttext","\rtext","  =1","\n@SUM(A1)"])assert.equal(safeSalesCsvCell(value),"'"+value);
 assert.equal(safeSalesCsvCell("normal"),"normal");assert.equal(safeSalesCsvCell("'already"),"'already");
});
test("TC-037 result refuses purged/nonterminal Jobs before opening private files",async()=>{
 await assert.rejects(()=>fixture({status:"COMPLETED",purged:1}).service.resolveResultDownload({claims,id:2}),{code:"SALES_IMPORT_RESULT_EXPIRED"});await assert.rejects(()=>fixture({status:"READY"}).service.resolveResultDownload({claims,id:2}),{code:"SALES_STATE_CONFLICT"});
});
test("TC-037 handlers require fresh write preflight before framework cache and view-only stream download",()=>{
 for(const Handler of [ConfirmSalesImportHandler,CancelSalesImportHandler]){assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions,["sales.view","sales.import"]);assert.equal(Handler.api.idempotency.enabled,true);assert.equal(typeof Handler.prototype.authorizeRequest,"function");}
 assert.equal(ConfirmSalesImportHandler.api.responseSchema[202].additionalProperties,false);assert.equal(DownloadSalesImportResultHandler.api.download.enabled,true);assert.deepEqual(DownloadSalesImportResultHandler.api.authorizationPolicies[0].options.permissions,["sales.view"]);
});
test("TC-037 result streaming preserves RFC4180, neutralizes every cell, uses bounded exact-parent keyset and excludes raw values",async()=>{
 const {createSalesImportResultStream,SALES_IMPORT_RESULT_COLUMNS}=await import("../../../src/modules/sales/salesImportResult.js"),{parse}=await import("csv-parse/sync"),calls=[];
 const database={async query(sql,params){calls.push({sql,params});return [calls.length===1?[{id:1,error_id:2,source_order_key:"  =1,\"quoted\"",channel_code:"SYNTHETIC",external_order_id:"@cmd",status:"INVALID",sales_order_number:"",error_code:"BAD",error_field:"field",error_message:"\n+cmd"}]:[]];}};
 let csv="";for await(const chunk of createSalesImportResultStream({database,id:3}))csv+=chunk;assert.ok(csv.startsWith("\uFEFF"));const rows=parse(csv,{bom:true});assert.deepEqual(rows[0],SALES_IMPORT_RESULT_COLUMNS);assert.equal(rows[1][0],"'  =1,\"quoted\"");assert.equal(rows[1][2],"'@cmd");assert.equal(rows[1][7],"'\n+cmd");assert.deepEqual(calls[1].params,[3,1,1,2]);assert.match(calls[0].sql,/LIMIT 100/u);assert.doesNotMatch(calls[0].sql,/safe_payload|value_summary|processing_event_id/);
 const controller=new AbortController();controller.abort(Error("owned abort"));await assert.rejects(async()=>{for await(const _chunk of createSalesImportResultStream({database,id:3,signal:controller.signal})){assert.ok(_chunk);}},/owned abort/u);
});

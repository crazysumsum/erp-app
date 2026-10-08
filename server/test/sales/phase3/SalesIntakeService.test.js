import assert from "node:assert/strict";
import test from "node:test";
import {salesSourceHash} from "../../../src/modules/sales/salesImportPrecheck.js";
import {SalesIntakeService} from "../../../src/modules/sales/SalesIntakeService.js";
test("TC-038 Intake rejects caller credentials and missing/mismatched live runtime signal before SQL or business effects",async()=>{
 const signal=new AbortController().signal,calls=[],query=()=>{calls.push("sql");assert.fail("no unauthorized SQL");},database={query,withTransaction:work=>work({query})},base={database,time:{nowMs:()=>1},orderService:{},confirmationService:{}};
 for(const options of [{},{authorizeSalesImport:()=>({leaseOwner:"owner",signal:AbortSignal.abort()})},{authorizeSalesImport:()=>({leaseOwner:"owner",signal:new AbortController().signal})}]){const s=new SalesIntakeService({...base,...options});await assert.rejects(()=>s.process({intakeOrderId:1,signal}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});}
 const service=new SalesIntakeService({...base,authorizeSalesImport:()=>({leaseOwner:"owner",signal})});for(const request of [{intakeOrderId:0,signal},{intakeOrderId:1,signal,actor:{id:1}},{intakeOrderId:1,signal,jobClaimToken:"spoof"}])await assert.rejects(()=>service.process(request),{code:"SALES_INPUT_INVALID"});assert.equal(calls.length,0);
});

// Existing successful source routing needs no Draft/Inventory dependency; exercise its real coordinator and persisted facts.
function duplicateFixture({channel=false,expiredAt=Infinity}={}){
 const signal=new AbortController().signal,event="12345678-1234-4234-8234-123456789abc",token="87654321-4321-4321-8321-cba987654321",identity={code:"SYNTHETIC",serviceId:"synthetic-adapter"},hash="0".repeat(64),intake={id:1,source_type:channel?"CHANNEL":"CSV",import_job_id:channel?null:2,status:"QUEUED",processing_event_id:event,payload_hash:hash,channel_code:"SYNTHETIC",external_order_id:"source-1",external_order_id_hash:salesSourceHash("source-1"),safe_payload:{channelIdentity:identity},sales_order_id:null,sales_order_number:""};let clocks=0,operation,commits=0;
 const tx={async query(sql){
  if(sql.includes("FROM fr_job_leases"))return [[{owner:"scheduler-owner",expires_at:1000}]];
  if(sql.includes(" AS now_ms")){clocks++;return [[{now:clocks>=expiredAt?105:100,now_ms:clocks>=expiredAt?105000:100000}]];}
  if(sql.includes("FROM sales_intake_orders"))return [[{...intake}]];
  if(sql.startsWith("SELECT confirmed_by"))return [[{confirmed_by:1}]];
  if(sql.includes("FROM sales_import_jobs"))return [[{status:"PROCESSING",lease_owner:token,lease_until:101000,confirmed_by:1}]];
  if(sql.includes("FROM users"))return [[{username:"importer"}]];
  if(sql.includes("FROM roles"))return [[{name:"import-role"}]];
  if(sql.includes("FROM permissions"))return [[{name:"sales.view"},{name:"sales.import"}]];
  if(sql.includes("FROM sales_external_order_keys"))return [[{id:9,status:"SUCCEEDED",external_order_id:intake.external_order_id,sales_order_id:123,sales_order_number:"SO-202610-000001",is_order_archived:0,payload_hash:hash}]];
  if(sql.includes("FROM sales_operation_requests"))return [[operation]];assert.fail("Unexpected duplicate dependency");
 },async execute(sql,p){
  if(sql.startsWith("INSERT INTO sales_operation_requests"))operation={id:5,command_type:"PROCESS_INTAKE",target_type:"INTAKE_ORDER",target_id:p[1],request_hash:p[2],status:"IN_PROGRESS",actor_user_id:p[3],actor_label:p[4]};
  else if(sql.startsWith("UPDATE sales_intake_orders SET external_order_key_id")){intake.external_order_key_id=p[0];intake.safe_payload=p[1];}
  else if(sql.startsWith("UPDATE sales_operation_requests SET status"))Object.assign(operation,{status:"SUCCEEDED",result_type:"INTAKE_RESULT",result_summary:p[1]});
  else if(sql.startsWith("UPDATE sales_intake_orders SET status=?"))Object.assign(intake,{status:p[0],sales_order_id:p[1],sales_order_number:p[2]});else assert.fail("Unexpected duplicate effect");return [{affectedRows:1,insertId:5}];}};
 const service=new SalesIntakeService({database:{async withTransaction(work){const value=await work(tx);commits++;return value;}},time:{},config:{importChannelCodes:["SYNTHETIC"],transactionTimeoutMs:10000},orderService:{},confirmationService:{},authorizeSalesImport:()=>({leaseOwner:"scheduler-owner",signal}),channelVerifier:async value=>value?.serviceId===identity.serviceId?{...identity,active:true}:null});return {service,intake,request:{intakeOrderId:1,...(!channel?{jobClaimToken:token}:{}),signal},commits:()=>commits};
}
test("TC-038 Channel duplicate retains verified identity for fresh same-event terminal replay",async()=>{const f=duplicateFixture({channel:true}),result=await f.service.process(f.request);assert.equal(result.status,"DUPLICATE");assert.deepEqual(await f.service.process(f.request),result);});
test("TC-038 CSV Job lock wait, effect completion and final DB clock cannot commit an expired original claim",async()=>{for(const expiredAt of [2,3,4]){const f=duplicateFixture({expiredAt});await assert.rejects(()=>f.service.process(f.request),{code:"CONCURRENT_OPERATION"});assert.equal(f.commits(),0);}});

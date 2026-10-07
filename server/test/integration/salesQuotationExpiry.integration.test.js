import assert from "node:assert/strict";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { SalesQuotationService } from "../../src/modules/sales/SalesQuotationService.js";
import { SalesSequenceService } from "../../src/modules/sales/SalesSequenceService.js";
import { SalesAuditService } from "../../src/modules/sales/SalesAuditService.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function setup(t){
 const f=await migrationFixture(t,[]),source=defaultConfigurationSource();
 const app=await createApplication({configurationSource:{...source,application:{...source.application,port:0}}});t.after(()=>app.shutdown("sales_expiry_done"));
 const database=app.services.require("mysqldatabase"),time={nowMs:()=>Date.parse("2026-10-05T16:00:00Z"),at:value=>new Date(value)};
 const logger=app.services.require("logging").logger;
 const quotation=new SalesQuotationService({database,time,logger}),sequence=new SalesSequenceService({time});
 f.beforeParents.push(()=>f.db.execute("DELETE FROM sales_audit_logs WHERE target_type='QUOTATION' AND target_id IN (SELECT id FROM sales_quotations WHERE customer_id=?)",[f.customerId]));
 async function insert(status="ISSUED",validUntil="2026-10-05"){
  const number=await database.withTransaction(tx=>sequence.nextNumberInTransaction(tx,{documentType:"QUOTATION",nowMs:time.nowMs()}));
  return f.insert("sales_quotations",{quotation_number:number,status,customer_id:f.customerId,customer_code_snapshot:"Synthetic",customer_name_snapshot:"Synthetic",currency_code:f.currency,quotation_date:"2026-10-01",valid_until:validUntil,line_count:1,total_amount:"6.6666",version:2,created_at:f.now,updated_at:f.now,last_business_updated_at:f.now});
 }
 return {...f,database,time,logger,quotation,insert};
}
integrationTest("TC-013 native expiry changes only past HKT Issued documents and audits one transition",async t=>{
 const f=await setup(t),expired=await f.insert(),today=await f.insert("ISSUED","2026-10-06"),draft=await f.insert("DRAFT"),cancelled=await f.insert("CANCELLED");
 assert.equal((await f.quotation.expire()).expired,1);
 const [rows]=await f.db.query("SELECT id,status,version,total_amount FROM sales_quotations WHERE customer_id=? ORDER BY id",[f.customerId]);
 assert.deepEqual(rows.map(r=>[Number(r.id),r.status,r.version,r.total_amount]),[[expired,"EXPIRED",3,"6.6666"],[today,"ISSUED",2,"6.6666"],[draft,"DRAFT",2,"6.6666"],[cancelled,"CANCELLED",2,"6.6666"]]);
 const [audit]=await f.db.query("SELECT action,actor_user_id,details FROM sales_audit_logs WHERE target_type='QUOTATION' AND target_id=?",[expired]);assert.equal(audit.length,1);assert.equal(audit[0].actor_user_id,null);assert.equal(audit[0].action,"sales_quotation.expired");assert.deepEqual(audit[0].details,{fromStatus:"ISSUED",toStatus:"EXPIRED",version:3});assert.equal((await f.quotation.expire()).expired,0);
});
integrationTest("TC-013 native overlap locks and rechecks without duplicate transition or audit",async t=>{
 const f=await setup(t),id=await f.insert();const results=await Promise.all([f.quotation.expire(),f.quotation.expire()]);assert.equal(results.reduce((n,r)=>n+r.expired,0),1);assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE target_type='QUOTATION' AND target_id=?",[id]))[0][0].n,1);
});
integrationTest("TC-013 native required audit failure rolls the expiry and version back",async t=>{
 const f=await setup(t),id=await f.insert(),service=new SalesQuotationService({database:f.database,time:f.time,logger:f.logger,audit:{async record(){throw new Error("synthetic required audit failure");}}});await assert.rejects(()=>service.expire());const [[row]]=await f.db.query("SELECT status,version FROM sales_quotations WHERE id=?",[id]);assert.deepEqual(row,{status:"ISSUED",version:2});
});
integrationTest("TC-013 native shutdown abort rolls back an in-flight expiry batch",async t=>{
 const f=await setup(t),id=await f.insert(),controller=new AbortController(),audit=new SalesAuditService();
 const service=new SalesQuotationService({database:f.database,time:f.time,logger:f.logger,audit:{async record(tx,event){await audit.record(tx,event);controller.abort();}}});await assert.rejects(()=>service.expire({signal:controller.signal}));const [[row]]=await f.db.query("SELECT status,version FROM sales_quotations WHERE id=?",[id]);assert.deepEqual(row,{status:"ISSUED",version:2});assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE target_type='QUOTATION' AND target_id=?",[id]))[0][0].n,0);
});

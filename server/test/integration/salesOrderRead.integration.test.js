import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { formatDateForFile } from "../../src/services/time/timeFormat.js";
import { SalesQuotationService } from "../../src/modules/sales/SalesQuotationService.js";
import { SalesOrderService } from "../../src/modules/sales/SalesOrderService.js";
import { SalesInquiryService } from "../../src/modules/sales/SalesInquiryService.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function setup(t) {
  const f = await migrationFixture(t, []);
  const source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  t.after(() => app.shutdown("sales_phase1_commands_complete"));
  const database = app.services.require("mysqldatabase"), time = app.services.require("time"), logger = app.services.require("logging").logger;
  const username = `sales-p1-${randomUUID().slice(0, 8)}`, roleName = `${username}-role`;
  const roleId = await f.insert("roles", { name: roleName, created_at: f.now });
  const userId = await f.insert("users", { username, password_hash: "test-only", display_name: "Sales native probe", created_at: f.now, updated_at: f.now });
  await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId, roleId]);
  for (const permission of ["sales.view", "sales.mgmt"]) await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [roleId, permission]);
  f.beforeParents.push(async () => {
    await f.db.execute("DELETE FROM sales_quotation_conversions WHERE quotation_id IN (SELECT id FROM sales_quotations WHERE customer_id=?)", [f.customerId]);
    await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM sales_audit_logs WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM sales_operation_requests WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM sales_quotations WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM fr_token_versions WHERE subject=?", [String(userId)]);
    await f.db.execute("DELETE FROM user_roles WHERE user_id=?", [userId]);
    await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [roleId]);
  });
  await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [f.currency]);
  await f.db.execute("UPDATE item_skus SET sellable=1, suggested_price_amount='3.3333' WHERE id=?", [f.skuId]);
  const claims = { actorId: userId, claimedRoles: [roleName], claimedPermissions: ["sales.mgmt", "sales.view"] };
  const quotation = new SalesQuotationService({ database, time, logger });
  const input = () => ({ eventId: randomUUID(), customerId: f.customerId, currencyCode: f.currency, quotationDate: formatDateForFile(new Date(f.now), "Asia/Hong_Kong"), validUntil: formatDateForFile(new Date(f.now + 30 * 86400000), "Asia/Hong_Kong"),
    notes: "Synthetic", lines: [{ skuId: f.skuId, skuUomId: f.skuUomId, quantity: "2.000000", unitSellingPrice: "3.3333" }] });
  return { ...f, app, database, time, logger, claims, quotation, input, userId, roleId };
}

function orderInput(f){return {eventId:randomUUID(),customerId:f.customerId,currencyCode:f.currency,fulfillmentWarehouseId:f.warehouseId,orderDate:"2026-10-06",customerPoReference:"PO_SYNTHETIC",lines:[{skuId:f.skuId,skuUomId:f.skuUomId,quantity:"2.000000",unitSellingPrice:"3.3333"}]};}
async function create(f){return (await new SalesOrderService({database:f.database,time:f.time,logger:f.logger}).create({claims:f.claims,input:orderInput(f)})).salesOrder;}
function inquiry(f){return new SalesInquiryService({database:f.database,time:f.time,logger:f.logger});}
integrationTest("TC-019 SO native list count, pagination, filters and exact escaped keys",async t=>{
 const f=await setup(t),first=await create(f),second=await create(f),steps=[];
 const database={withTransaction:work=>f.database.withTransaction(tx=>work({query:async(sql,args)=>{if(sql.includes("FROM sales_orders"))steps.push(sql.startsWith("SELECT COUNT")?"count":sql.startsWith("SELECT id FROM")?"ids":sql.includes("WHERE id IN")?"projection":"other");return tx.query(sql,args);}}))};
 const service=new SalesInquiryService({database,time:f.time,logger:f.logger});
 const page=await service.list({claims:f.claims,input:{customerId:f.customerId,pageSize:1,page:2,sortBy:"number",descending:false}});assert.equal(page.total,2);assert.equal(page.items.length,1);assert.equal(page.items[0].id,second.id);assert.equal(page.items[0].totalAmount,"6.6666");assert.equal(page.items[0].sourceType,"MANUAL");assert.deepEqual(steps,["count","ids","projection"]);
 for(const input of [{number:first.number},{q:first.number},{q:"PO_SYNTHETIC"},{warehouseId:f.warehouseId,status:["DRAFT"],sourceType:["MANUAL"],hasBackorder:false,orderDateFrom:"2026-10-06",orderDateTo:"2026-10-06",updatedFrom:0,updatedTo:Date.now()+60000}])assert.ok((await service.list({claims:f.claims,input:{customerId:f.customerId,...input}})).items.some(row=>row.id===first.id));
 assert.equal((await service.list({claims:f.claims,input:{customerId:f.customerId,q:"_"}})).total,2);assert.equal((await service.list({claims:f.claims,input:{customerId:f.customerId,q:"%"}})).total,0);assert.equal((await service.list({claims:f.claims,input:{customerId:f.customerId,page:3,pageSize:1}})).items.length,0);
});
integrationTest("TC-019 native exact external hash lookup selects only Active source keys",async t=>{
 const f=await setup(t),first=await create(f),second=await create(f),external="external_%雪";
 for(const [id,channel,archived] of [[first.id,"WEB",0],[second.id,"CSV",1]]){const key=await f.insert("sales_external_order_keys",{channel_code:channel,external_order_id:external,external_order_id_hash:createHash("sha256").update(external).digest(),source_type:"CSV",payload_hash:"a".repeat(64),status:"SUCCEEDED",sales_order_id:id,sales_order_number:id===first.id?first.number:second.number,is_order_archived:archived,claimed_at:f.now,updated_at:f.now});await f.db.execute("UPDATE sales_orders SET source_type='CSV',external_order_key_id=?,channel_code_snapshot=?,external_order_id_snapshot=? WHERE id=?",[key,channel,external,id]);}
 const service=inquiry(f);assert.deepEqual((await service.list({claims:f.claims,input:{externalOrderId:external}})).items.map(row=>row.id),[first.id]);assert.equal((await service.list({claims:f.claims,input:{externalOrderId:external,channelCode:"CSV"}})).total,0);assert.equal((await service.list({claims:f.claims,input:{externalOrderId:"external"}})).total,0);
});
integrationTest("TC-019 native detail keeps snapshots, fresh permissions and bounded status history",async t=>{
 const f=await setup(t),order=await create(f),service=inquiry(f);
 await f.db.execute("UPDATE customers SET legal_name='Current Customer',status='blocked' WHERE id=?",[f.customerId]);await f.db.execute("UPDATE item_skus SET sku_name='Current SKU',status='inactive' WHERE id=?",[f.skuId]);
 const detail=await service.get({claims:f.claims,id:order.id});assert.equal(detail.customerName,order.customerName);assert.equal(detail.lines[0].skuName,order.lines[0].skuName);assert.equal(detail.currentMaster.customer.customerName,"Current Customer");assert.equal(detail.currentMaster.skus[0].skuName,"Current SKU");assert.equal(detail.currentMaster.skus[0].skuStatus,"inactive");assert.equal(detail.isArchived,false);assert.deepEqual(detail.allowedActions,["edit"]);assert.equal(detail.history[0].action,"created");assert.equal(detail.lines[0].orderedBaseQuantity,"2");assert.equal(detail.lines[0].reservedBaseQuantity,"0");
 for(let sequence=2;sequence<=102;sequence++)await f.db.execute("INSERT INTO sales_order_status_history (sales_order_id,sequence_no,from_status,to_status,action,order_version_after,event_id,actor_user_id,actor_label,occurred_at) VALUES (?,?,'DRAFT','DRAFT','synthetic_history',1,?,?,?,?)",[order.id,sequence,randomUUID(),f.userId,"Synthetic",f.now]);
 const bounded=await service.get({claims:f.claims,id:order.id});assert.equal(bounded.history.length,100);assert.equal(bounded.historyTruncated,true);assert.equal(bounded.history[0].sequence,3);assert.equal(bounded.history.at(-1).sequence,102);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.mgmt'",[f.roleId]);await assert.rejects(()=>service.get({claims:f.claims,id:order.id}),{code:"PERMISSION_STALE"});const viewer={...f.claims,claimedPermissions:["sales.view"]};assert.deepEqual((await service.get({claims:viewer,id:order.id})).allowedActions,[]);await assert.rejects(()=>service.get({claims:viewer,id:Number.MAX_SAFE_INTEGER}),{code:"SALES_ORDER_NOT_FOUND"});await f.db.execute("DELETE FROM role_permissions WHERE role_id=?",[f.roleId]);await assert.rejects(()=>service.get({claims:viewer,id:order.id}),{code:"PERMISSION_STALE"});
});
integrationTest("TC-019 SO actual HTTP response schemas, strict query and unauthorized ID access",async t=>{
 const f=await setup(t),order=await create(f),version=await f.app.services.require("tokenRevocation").currentVersion(String(f.userId));const token=await f.app.services.require("jwt").issue({roles:f.claims.claimedRoles,permissions:f.claims.claimedPermissions},{subject:String(f.userId),version,authTime:Math.floor(f.now/1000)}),{url}=await f.app.start();
 async function request(path,auth=true){const response=await fetch(url+path,{headers:auth?{Authorization:`Bearer ${token}`}:{}});return {status:response.status,data:await response.json()};}
 const detail=await request(`/api/v1/sales-orders/${order.id}`);assert.equal(detail.status,200);assert.equal(detail.data.data.lines[0].quantity,"2.000000");assert.equal(detail.data.data.currentMaster.customer.customerName,order.customerName);assert.deepEqual(detail.data.data.allowedActions,["edit"]);
 const list=await request(`/api/v1/sales-orders?customerId=${f.customerId}&page=1&pageSize=10&status=DRAFT&sourceType=MANUAL&hasBackorder=false`);assert.equal(list.status,200);assert.equal(list.data.data.total,1);assert.equal(list.data.data.items[0].id,order.id);assert.equal((await request("/api/v1/sales-orders?sortBy=constructor")).status,400);assert.equal((await request("/api/v1/sales-orders?extra=1")).status,400);assert.equal((await request(`/api/v1/sales-orders/${order.id}`,false)).status,401);assert.equal((await request(`/api/v1/sales-orders/${Number.MAX_SAFE_INTEGER}`)).status,404);
 await f.db.execute("UPDATE users SET status='inactive' WHERE id=?",[f.userId]);assert.equal((await request(`/api/v1/sales-orders/${order.id}`)).status,403);
});

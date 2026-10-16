import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {setup,stock,createOrder} from "../sales/phase2/fixtures.js";
import {SalesInquiryService} from "../../src/modules/sales/SalesInquiryService.js";
import {SalesOrderLifecycleService} from "../../src/modules/sales/SalesOrderLifecycleService.js";
import {SalesOrderService} from "../../src/modules/sales/SalesOrderService.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function http(f) {
 const {url}=await f.app.start();
 return async(path,{claims=f.claims,auth=true}={})=>{
  const token=auth?await f.app.services.require("jwt").issue({roles:claims.claimedRoles,permissions:claims.claimedPermissions},{subject:String(claims.actorId),version:await f.app.services.require("tokenRevocation").currentVersion(String(claims.actorId)),authTime:Math.floor(f.now/1000)}):null;
  const response=await fetch(url+path,{headers:token?{Authorization:`Bearer ${token}`}:{}});return {status:response.status,body:await response.json()};
 };
}
integrationTest("TC-044 Outstanding real HTTP excludes Draft and returns committed remaining quantity without row multiplication",async t=>{
 const f=await setup(t),sku=await f.insert("item_skus",{item_id:f.itemId,sku_code:"p4-second-"+randomUUID(),sku_name:"Second synthetic",status:"active",sellable:1,inventory_tracked:1,created_at:f.now,updated_at:f.now});
 const [[uom]]=await f.db.query("SELECT uom_id FROM item_sku_uoms WHERE id=?",[f.skuUomId]),skuUom=await f.insert("item_sku_uoms",{sku_id:sku,uom_id:uom.uom_id,to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.now,updated_at:f.now});
 await new SalesOrderService(f).update({claims:f.claims,id:f.request.id,input:{eventId:randomUUID(),version:1,customerId:f.customerId,currencyCode:f.currency,fulfillmentWarehouseId:f.warehouseId,orderDate:f.time.fileDate(),lines:[{skuId:f.skuId,skuUomId:f.skuUomId,quantity:"10.000000",unitSellingPrice:"1.0000"},{skuId:sku,skuUomId:skuUom,quantity:"2.000000",unitSellingPrice:"1.0000"}]}});
 f.request.input.version=2;const request=await http(f),path=`/api/v1/outstanding-sales-orders?customerId=${f.customerId}`;
 const draft=await request(path);assert.equal(draft.status,200);assert.equal(draft.body.data.total,0);
 await stock(f,4);await f.service().confirm(f.request);
 const actual=await request(path);assert.equal(actual.status,200,JSON.stringify(actual.body));assert.equal(actual.body.data.total,1);assert.equal(actual.body.data.items.length,1);
 const row=actual.body.data.items[0];assert.equal(row.id,f.request.id);assert.deepEqual(row.quantities,{orderedBaseQuantity:"12",reservedBaseQuantity:"4",backorderedBaseQuantity:"8",fulfilledBaseQuantity:"0",cancelledBaseQuantity:"0",outstandingBaseQuantity:"12"});
 assert.equal((await request(path+"&hasBackorder=false")).body.data.total,0);assert.equal((await request(path+"&status=DRAFT")).body.data.total,0);
 assert.equal((await request(path+"&page=2&pageSize=1")).body.data.items.length,0);
 assert.equal((await request(path+"&sortBy=constructor")).status,400);assert.equal((await request(path,{auth:false})).status,401);
});
integrationTest("TC-044 common views filter current actor and finalized states with fresh authorization",async t=>{
 const f=await setup(t),service=new SalesInquiryService(f),base={customerId:f.customerId};
 const other=await f.insert("users",{username:"p4-view-"+randomUUID(),password_hash:"synthetic",display_name:"Synthetic",created_at:f.now,updated_at:f.now});await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",[other,f.roleId]);f.beforeParents.push(()=>f.db.execute("DELETE FROM user_roles WHERE user_id=?",[other]));
 await createOrder({...f,claims:{...f.claims,actorId:other}},f.database);
 assert.equal((await service.list({claims:f.claims,input:base})).total,2);
 assert.equal((await service.list({claims:f.claims,input:{...base,view:"mine"}})).total,1);
 assert.equal((await service.list({claims:f.claims,input:{...base,view:"finalized"}})).total,0);
 await new SalesOrderLifecycleService(f).cancel({claims:f.claims,id:f.request.id,input:{eventId:randomUUID(),version:1,reason:"Synthetic cancellation"}});
 assert.equal((await service.list({claims:f.claims,input:{...base,view:"finalized"}})).total,1);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.view'",[f.roleId]);
 await assert.rejects(()=>service.list({claims:f.claims,input:{...base,view:"mine"}}),{code:"PERMISSION_STALE"});
});
integrationTest("TC-046 Audit real HTTP has bounded projection, filters and strict query validation",async t=>{
 const f=await setup(t),request=await http(f),path=`/api/v1/sales-audit-logs?targetType=ORDER&targetId=${f.request.id}`;
 const result=await request(path);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.data.total,1);
 const row=result.body.data.items[0];assert.equal(row.action,"sales_order.created");assert.equal(row.targetId,f.request.id);assert.ok(!("ipAddress" in row));assert.ok(!("requestId" in row));assert.ok(!("details" in row));
 assert.equal((await request(path+`&actorId=${f.userId}&action=sales_order.created&occurredFrom=0`)).body.data.total,1);
 assert.equal((await request(path+"&pageSize=1&page=2")).body.data.items.length,0);
 for(const extra of ["&unknown=1","&pageSize=101","&occurredFrom=2&occurredTo=1","&sortBy=constructor"])assert.equal((await request(path+extra)).status,400);
 assert.equal((await request(path,{auth:false})).status,401);
});
integrationTest("TC-046 operation lookup binds exact owner and original write permission without exposing recovery payload",async t=>{
 const f=await setup(t);await stock(f,10);await f.service().confirm(f.request);const request=await http(f),path=`/api/v1/sales-operations/by-event/${f.request.input.eventId}`;
 const own=await request(path);assert.equal(own.status,200,JSON.stringify(own.body));assert.equal(own.body.data.result.id,f.request.id);assert.equal(own.body.data.status,"SUCCEEDED");assert.ok(!("recoveryPayload" in own.body.data));
 const other=await f.insert("users",{username:"p4-other-"+randomUUID(),password_hash:"synthetic",display_name:"Synthetic",created_at:f.now,updated_at:f.now});await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",[other,f.roleId]);f.beforeParents.push(()=>f.db.execute("DELETE FROM user_roles WHERE user_id=?",[other]));
 assert.equal((await request(path,{claims:{...f.claims,actorId:other}})).status,404);assert.equal((await request(`/api/v1/sales-operations/by-event/${randomUUID()}`)).status,404);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.mgmt'",[f.roleId]);
 assert.equal((await request(path,{claims:{...f.claims,claimedPermissions:["sales.view"]}})).status,403);
});
integrationTest("TC-046 Import upload operation uses original import permission and a safe result identity",async t=>{
 const f=await setup(t);await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='sales.import'",[f.roleId]);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.mgmt'",[f.roleId]);
 const claims={...f.claims,claimedPermissions:["sales.view","sales.import"]},event=randomUUID(),batch="SI-202610-999999";
 const [job]=await f.db.query("INSERT INTO sales_import_jobs SET ?",{batch_number:batch,template_version:"1.0",original_file_name:"synthetic.csv",file_sha256:Buffer.alloc(32,1),file_size_bytes:1,status:"UPLOADED",created_by:f.userId,created_at:f.now,updated_at:f.now});
 f.beforeParents.push(()=>f.db.execute("DELETE FROM sales_import_jobs WHERE id=?",[job.insertId]));
 await f.db.query("INSERT INTO sales_operation_requests SET ?",{event_id:event,command_type:"UPLOAD_IMPORT",target_type:"IMPORT_JOB",target_id:job.insertId,request_hash:"a".repeat(64),status:"SUCCEEDED",actor_user_id:f.userId,actor_label:"Synthetic",created_at:f.now,updated_at:f.now,result_summary:JSON.stringify({importJob:{id:Number(job.insertId),batchNumber:batch,status:"UPLOADED",version:1,filePath:"must-not-expose"},warnings:[]})});
 const request=await http(f),path=`/api/v1/sales-operations/by-event/${event}`,result=await request(path,{claims});assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body.data.result,{id:Number(job.insertId),number:batch,status:"UPLOADED",version:1});
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.import'",[f.roleId]);assert.equal((await request(path,{claims:{...f.claims,claimedPermissions:["sales.view"]}})).status,403);
});

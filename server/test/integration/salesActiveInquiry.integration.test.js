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
 const [[uom]]=await f.db.query("SELECT m.uom_id,u.code FROM item_sku_uoms m JOIN item_uoms u ON u.id=m.uom_id WHERE m.id=?",[f.skuUomId]),skuUom=await f.insert("item_sku_uoms",{sku_id:sku,uom_id:uom.uom_id,to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.now,updated_at:f.now});
 await new SalesOrderService(f).update({claims:f.claims,id:f.request.id,input:{eventId:randomUUID(),version:1,customerId:f.customerId,currencyCode:f.currency,fulfillmentWarehouseId:f.warehouseId,orderDate:f.time.fileDate(),lines:[{skuId:f.skuId,skuUomId:f.skuUomId,quantity:"10.000000",unitSellingPrice:"1.0000"},{skuId:sku,skuUomId:skuUom,quantity:"2.000000",unitSellingPrice:"1.0000"}]}});
 f.request.input.version=2;const request=await http(f),path=`/api/v1/outstanding-sales-orders?customerId=${f.customerId}`;
 const draft=await request(path);assert.equal(draft.status,200);assert.equal(draft.body.data.total,0);
 await stock(f,4);await f.service().confirm(f.request);
 const actual=await request(path);assert.equal(actual.status,200,JSON.stringify(actual.body));assert.equal(actual.body.data.total,1);assert.equal(actual.body.data.items.length,1);
 const row=actual.body.data.items[0];assert.equal(row.id,f.request.id);assert.deepEqual(row.quantities,{baseUomCode:uom.code,orderedBaseQuantity:"12",reservedBaseQuantity:"4",backorderedBaseQuantity:"8",fulfilledBaseQuantity:"0",cancelledBaseQuantity:"0",outstandingBaseQuantity:"12"});
 assert.equal((await request(path+"&hasBackorder=false")).body.data.total,0);assert.equal((await request(path+"&status=DRAFT")).body.data.total,0);
 assert.equal((await request(path+"&page=2&pageSize=1")).body.data.items.length,0);
 assert.equal((await request(path+"&sortBy=constructor")).status,400);assert.equal((await request(path,{auth:false})).status,401);
 const mixedUom=await f.insert("item_uoms",{code:"kg-"+randomUUID().slice(0,8),name:"Kilogram",status:"active",created_at:f.now,updated_at:f.now});
 const mixedSku=await f.insert("item_skus",{item_id:f.itemId,sku_code:"mixed-"+randomUUID(),sku_name:"Mixed unit synthetic",status:"active",sellable:1,inventory_tracked:1,created_at:f.now,updated_at:f.now});
 const mixedSkuUom=await f.insert("item_sku_uoms",{sku_id:mixedSku,uom_id:mixedUom,to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.now,updated_at:f.now});
 const {salesOrder:mixed}=await new SalesOrderService(f).create({claims:f.claims,input:{eventId:randomUUID(),customerId:f.customerId,currencyCode:f.currency,fulfillmentWarehouseId:f.warehouseId,orderDate:f.time.fileDate(),lines:[
  {skuId:f.skuId,skuUomId:f.skuUomId,quantity:"10.000000",unitSellingPrice:"1.0000"},
  {skuId:mixedSku,skuUomId:mixedSkuUom,quantity:"2.000000",unitSellingPrice:"1.0000"}
 ]}});
 await f.service().confirm({claims:f.claims,id:mixed.id,input:{eventId:randomUUID(),version:1}});
 const mixedResult=await request(path+"&number="+mixed.number);
 assert.equal(mixedResult.status,200,JSON.stringify(mixedResult.body));assert.equal(mixedResult.body.data.total,1);
 assert.equal(mixedResult.body.data.items[0].quantities,null);
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

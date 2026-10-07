import assert from "node:assert/strict";
import test from "node:test";
import { SalesFulfillmentGuardService } from "../../../src/modules/sales/SalesFulfillmentGuardService.js";
import { validateSalesLifecycleInput, validateLifecycleRelease } from "../../../src/modules/sales/SalesOrderLifecycleService.js";
import { inventoryOperationHash } from "../../../src/modules/inventory/InventoryOperationService.js";
import { createHash } from "node:crypto";
import { ServiceContainer } from "../../../src/framework/services/ServiceContainer.js";
const input={eventId:"11111111-1111-4111-8111-111111111111",version:3,reason:"客戶要求撤回訂單"};
test("TC-029 lifecycle reason/event/version boundary rejects coercion, controls and surplus authority",()=>{
 assert.deepEqual(validateSalesLifecycleInput(input),input);
 for(const change of [{eventId:"bad"},{version:"3"},{version:0},{reason:"abcd"},{reason:"x".repeat(501)},{reason:"hello\u0000world"},{actorId:7}])assert.throws(()=>validateSalesLifecycleInput({...input,...change}),{code:"SALES_INPUT_INVALID"});
});
function guardFixture({tables=[],history=[],error=false,services={names:()=>[],resolve:async()=>undefined}}={}){return new SalesFulfillmentGuardService({services}).assertAllowed({query:async sql=>{if(error)throw Error("SQL unavailable");return [sql.includes("information_schema")?[{owned_count:tables.filter(name=>["fulfillments","shipments"].includes(name)||["fulfillment_","fulfillments_","shipment_","shipments_"].some(prefix=>name.startsWith(prefix))).length}]:history.filter(name=>/(^|[/_])(fulfillment|fulfillments|shipment|shipments)(_|[.])/u.test(name)).map(name=>({name}))];}},{orderId:1,action:"WITHDRAW",eventId:input.eventId,expectedVersion:3});}
test("TC-029 uninstalled guard returns distinct NOT_REQUIRED only with both current tables and migration facts absent",async()=>{
 assert.equal(await guardFixture({tables:["sales_orders","some_fulfillment_notes"],history:["migrations/0073_create_sales_orders.js"]}),"NOT_REQUIRED");
 for(const name of ["fulfillments","fulfillment_lines","fulfillments_archive","fulfillment_lines_archive","shipments","shipment_lines_archive"])await assert.rejects(()=>guardFixture({tables:[name]}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
 for(const name of ["migrations/0080_create_fulfillments.js","migrations/0081_create_shipment_lines.js","migrations/0082_archive_fulfillment_lines.js"])await assert.rejects(()=>guardFixture({history:[name]}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
 await assert.rejects(()=>guardFixture({error:true}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
});
test("TC-029 registered unavailable/UNKNOWN/OPEN provider never falls back to absence",async()=>{
 for(const provider of [null,{}, {assertSalesLifecycleAllowedInTransaction:async()=>({status:"UNKNOWN"})}])await assert.rejects(()=>guardFixture({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>provider}}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
 await assert.rejects(()=>guardFixture({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>({assertSalesLifecycleAllowedInTransaction:async()=>({status:"OPEN"})})}}),{code:"OPEN_FULFILLMENT_EXISTS"});
 let called=0;assert.equal(await guardFixture({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>({assertSalesLifecycleAllowedInTransaction:async(_tx,c)=>{called++;assert.equal(c.orderId,1);}})}}),"ALLOWED");assert.equal(called,1);
});
const payload={warehouseId:2,expectedOrderVersion:3,intent:"ALL_OUTSTANDING"},mapping={id:1,inventory_reservation_id:9,sales_order_line_id:4,sku_id:5,original_base_quantity:10,consumed_base_quantity:2,released_base_quantity:1,outstanding_base_quantity:7,inventory_version:3};
function release(){const rootRequestHash=inventoryOperationHash({commandType:"SALES_BATCH_RELEASE",payload}),member={rootOperationId:8,rootRequestHash,reservationId:9,sourceLineId:4,skuId:5,expectedVersion:3,releaseQuantity:7,version:4,releasedQuantity:8,outstandingQuantity:0,status:"RELEASED"};const hash=inventoryOperationHash({commandType:"SALES_LINE_RELEASE",payload:{rootOperationId:8,rootRequestHash,reservationId:9,sourceLineId:4,skuId:5,expectedVersion:3,releaseQuantity:7}});return {operationId:8,lineCount:1,membershipDigest:createHash("sha256").update(`reservation:9:${hash}\n`).digest("hex"),members:[member]};}
test("TC-029 exact release membership binds root/hash/reservation/line/SKU/version/conservation and digest",()=>{
 const result=release();assert.deepEqual(validateLifecycleRelease(result,payload,[mapping]),result.members);
 for(const change of [{reservationId:10},{sourceLineId:6},{skuId:6},{expectedVersion:2},{releaseQuantity:6},{version:5},{releasedQuantity:9},{outstandingQuantity:1},{status:"ACTIVE"},{rootOperationId:9},{rootRequestHash:"a".repeat(64)}])assert.throws(()=>validateLifecycleRelease({...result,members:[{...result.members[0],...change}]},payload,[mapping]),{code:"INVENTORY_CONTRACT_MISMATCH"});
 for(const change of [{members:[]},{members:[...result.members,...result.members]},{membershipDigest:"b".repeat(64)},{lineCount:0}])assert.throws(()=>validateLifecycleRelease({...result,...change},payload,[mapping]),{code:"INVENTORY_CONTRACT_MISMATCH"});
 assert.throws(()=>validateLifecycleRelease(result,payload,[{...mapping,original_base_quantity:11}]),{code:"INVENTORY_CONTRACT_MISMATCH"});
});

test("TC-029 dependency-scoped has=false cannot conceal a registered OPEN provider; missing registry is UNKNOWN",async()=>{
 let calls=0;const provider={assertSalesLifecycleAllowedInTransaction:async()=>{calls++;return {status:"OPEN"};}},container=new ServiceContainer({values:{fulfillmentOpenMatter:provider}}),access=container.createServiceAccess(new Map());
 assert.equal(access.has("fulfillmentOpenMatter"),false);await assert.rejects(()=>guardFixture({services:access}),{code:"OPEN_FULFILLMENT_EXISTS"});assert.equal(calls,1);
 for(const services of [null,{}, {names:()=>null,resolve:async()=>{}},{names:()=>[7],resolve:async()=>{}}])await assert.rejects(()=>guardFixture({services}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
});

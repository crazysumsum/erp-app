import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { shipmentDraftFixture } from "../fulfillment/shipmentDraftFixture.js";
import { startP1Http,ownerQuantities } from "../fulfillment/p1Fixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("P2 actual HTTP Draft supports strict create/update/detail/cancel and original event replay",async t=>{
 const f=await shipmentDraftFixture(t),request=await startP1Http(t,f),path=`/api/v1/fulfillments/${f.created.outcome.id}/shipments/create`,body=f.body(),before=await ownerQuantities(f),key=randomUUID();
 const created=await request("POST",path,body,{key});assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.data.outcome.id;assert.equal(created.body.data.shipment.totalWeight,"1.25");assert.equal(created.headers.cacheControl,"no-store");
 assert.deepEqual((await request("POST",path,body,{key})).body.data,created.body.data);assert.deepEqual((await request("POST",path,body)).body.data.outcome,created.body.data.outcome);
 const detail=await request("GET",`/api/v1/shipments/${id}`);assert.equal(detail.status,200);assert.equal(detail.body.data.shipment.id,id);
 const changed=await request("POST",`/api/v1/shipments/${id}/update`,{...f.body(),version:1,totalWeight:null,weightUom:"",notes:"Synthetic update"});assert.equal(changed.status,200,JSON.stringify(changed.body));assert.equal(changed.body.data.shipment.version,2);assert.equal(changed.body.data.shipment.totalWeight,null);
 const cancelled=await request("POST",`/api/v1/shipments/${id}/cancel`,{eventId:randomUUID(),version:2});assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));assert.equal(cancelled.body.data.shipment.status,"CANCELLED");assert.deepEqual(await ownerQuantities(f),before);
});
nativeTest("P2 actual HTTP rejects weight Number coercion, unknown fields, stale address and missing permission",async t=>{
 const f=await shipmentDraftFixture(t),request=await startP1Http(t,f),path=`/api/v1/fulfillments/${f.created.outcome.id}/shipments/create`;
 assert.equal((await request("POST",path,f.body(),{auth:false})).status,401);assert.equal((await request("POST",path,f.body(),{auth:"denied"})).status,403);
 for(const patch of [{totalWeight:1.25},{totalWeight:1},{status:"DRAFT"},{skuId:1},{shippingAddressId:String(f.s.addressId)},{totalWeight:"1.0000000"},{weightUom:"LB"},{shippingContactId:4},{notes:null}]){
  const response=await request("POST",path,{...f.body(),...patch});assert.equal(response.status,400,JSON.stringify({patch,response:response.body}));
 }
 const stale=await request("POST",path,{...f.body(),shippingAddressVersion:2});assert.equal(stale.status,409);assert.equal(stale.body.error.code,"SHIPPING_ADDRESS_CHANGED");
 const unknown=await request("POST",path,{...f.body(),shippingAddressId:999999});assert.equal(unknown.status,409);assert.equal(unknown.body.error.code,"SHIPPING_ADDRESS_UNAVAILABLE");assert.equal(Number((await f.db.query("SELECT COUNT(*) n FROM shipments"))[0][0].n),0);
 const created=await request("POST",path,f.body());assert.equal(created.status,201);const read=await request("GET",`/api/v1/shipments/${created.body.data.outcome.id}`,undefined,{auth:"denied"});assert.equal(read.status,403);
 assert.equal((await request("GET","/api/v1/shipments/999999")).status,404);
});
nativeTest("P2 actual HTTP rechecks revoked role before cached or domain replay",async t=>{
 const f=await shipmentDraftFixture(t),request=await startP1Http(t,f),path=`/api/v1/fulfillments/${f.created.outcome.id}/shipments/create`,body=f.body(),key=randomUUID();assert.equal((await request("POST",path,body,{key})).status,201);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.operation'",[f.roleId]);
 for(const options of [{key},{}]){const result=await request("POST",path,body,options);assert.equal(result.status,403);assert.equal(result.body.error.code,"PERMISSION_STALE");}
 assert.equal(Number((await f.db.query("SELECT COUNT(*) n FROM shipments"))[0][0].n),1);
});

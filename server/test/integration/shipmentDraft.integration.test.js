import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ownerQuantities } from "../fulfillment/p1Fixture.js";
import { fulfillmentError } from "../../src/modules/fulfillment/fulfillmentErrors.js";
import { shipmentDraftFixture as setup, shipmentDraftFacts as localFacts } from "../fulfillment/p1CancellationFixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("P2 Draft creates exact picked lines, canonical decimal, active pointer and original replay without owner effects",async t=>{
 const f=await setup(t),before=await ownerQuantities(f),body=f.body(),created=await f.create(body);
 assert.equal(created.outcome.status,"DRAFT");assert.equal(created.shipment.totalWeight,"1.25");assert.equal(created.shipment.weightUom,"KG");assert.equal(created.shipment.shippingAddressId,String(f.s.addressId));assert.equal(created.shipment.lines[0].shippedBaseQuantity,"3");
 const [[header]]=await f.db.query("SELECT status,active_shipment_id FROM fulfillments WHERE id=?",[f.created.outcome.id]);assert.equal(header.status,"PICKED");assert.equal(String(header.active_shipment_id),created.outcome.id);
 const [[row]]=await f.db.query("SELECT total_weight,address_line1_snapshot FROM shipments WHERE id=?",[created.outcome.id]);assert.equal(row.total_weight,"1.250000");assert.equal(row.address_line1_snapshot,"");
 const [[line]]=await f.db.query("SELECT sku_code_snapshot,sku_name_snapshot,base_uom_code_snapshot FROM shipment_lines WHERE shipment_id=?",[created.outcome.id]);assert.deepEqual(Object.values(line),["","",""]);
 assert.deepEqual(await ownerQuantities(f),before);assert.deepEqual((await f.create({...body,totalWeight:"1.25"})).outcome,created.outcome);
 await assert.rejects(()=>f.create({...body,weightUom:"G"}),{code:"FULFILLMENT_SOURCE_CONFLICT"});await assert.rejects(()=>f.create(f.body()),{code:"SHIPMENT_ALREADY_EXISTS"});
});
nativeTest("P2 Draft concurrent same-event and different-event Create retain one effective Shipment",async t=>{
 const f=await setup(t),body=f.body(),same=await Promise.all([f.create(body),f.create(body)]);assert.deepEqual(same[0].outcome,same[1].outcome);assert.equal(Number((await f.db.query("SELECT COUNT(*) n FROM shipments"))[0][0].n),1);
 await f.cancelDraft(same[0].outcome.id,{eventId:randomUUID(),version:1});
 const different=await Promise.allSettled([f.create(f.body()),f.create(f.body())]);assert.equal(different.filter(x=>x.status==="fulfilled").length,1);assert.equal(different.find(x=>x.status==="rejected").reason.code,"SHIPMENT_ALREADY_EXISTS");
});
nativeTest("P2 Draft update uses exact child versions and CAS; cancellation clears pointer without changing picked facts",async t=>{
 const f=await setup(t),before=await ownerQuantities(f),created=await f.create(f.body()),update={...f.body(),version:1,totalWeight:"0.000001",weightUom:"G",notes:"Synthetic logistics"};
 const changed=await f.update(created.outcome.id,update);assert.equal(changed.outcome.version,2);assert.equal(changed.shipment.totalWeight,"0.000001");assert.deepEqual((await f.update(created.outcome.id,update)).outcome,changed.outcome);
 await assert.rejects(()=>f.update(created.outcome.id,{...update,eventId:randomUUID()}),{code:"VERSION_CONFLICT"});
 const command={eventId:randomUUID(),version:2},cancelled=await f.cancelDraft(created.outcome.id,command);assert.equal(cancelled.outcome.status,"CANCELLED");assert.deepEqual((await f.cancelDraft(created.outcome.id,command)).outcome,cancelled.outcome);
 const [[root]]=await f.db.query("SELECT status,active_shipment_id FROM fulfillments WHERE id=?",[f.created.outcome.id]);assert.equal(root.status,"PICKED");assert.equal(root.active_shipment_id,null);assert.deepEqual(await ownerQuantities(f),before);assert.notEqual((await f.create(f.body())).outcome.id,created.outcome.id);
});
nativeTest("P2 Draft rejects stale or inactive shipping address and wrong parent state without partial effects",async t=>{
 const f=await setup(t),before=await localFacts(f);
 await assert.rejects(()=>f.create({...f.body(),shippingAddressVersion:2}),{code:"SHIPPING_ADDRESS_CHANGED"});assert.deepEqual(await localFacts(f),before);
 await f.db.execute("UPDATE customer_addresses SET status='inactive',version=version+1 WHERE id=?",[f.s.addressId]);await assert.rejects(()=>f.create({...f.body(),shippingAddressVersion:2}),{code:"SHIPPING_ADDRESS_UNAVAILABLE"});assert.deepEqual(await localFacts(f),before);
 await f.db.execute("UPDATE customer_addresses SET status='active',version=version+1 WHERE id=?",[f.s.addressId]);await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[f.created.outcome.id]);await assert.rejects(()=>f.create({...f.body(),shippingAddressVersion:3}),{code:"FULFILLMENT_STATE_CONFLICT"});
});
nativeTest("P2 Draft late audit failure rolls back all document, line, history and pointer changes",async t=>{
 const f=await setup(t),before=await localFacts(f),owner=await ownerQuantities(f),body=f.body();
 await f.db.query("CREATE TRIGGER synthetic_shipment_audit_fail BEFORE INSERT ON fulfillment_audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic late shipment audit failure'");
 await assert.rejects(()=>f.create(body),error=>{let current=error;for(let i=0;i<10&&current;i++,current=current.cause)if(current.code==="ER_SIGNAL_EXCEPTION"&&current.message?.includes("Synthetic late shipment audit failure"))return true;return false;});assert.deepEqual(await localFacts(f),before);assert.deepEqual(await ownerQuantities(f),owner);
 await f.db.query("DROP TRIGGER synthetic_shipment_audit_fail");assert.equal((await f.create(body)).outcome.status,"DRAFT");
});

nativeTest("P2 Draft committed success survives projection failure and original event recovery",async t=>{
 const f=await setup(t),body=f.body(),detail=f.service.detail.bind(f.service);f.service.detail=async()=>{throw new Error("Synthetic projection unavailable");};
 await assert.rejects(()=>f.create(body),error=>error.code==="FULFILLMENT_DEPENDENCY_UNAVAILABLE"&&typeof error.publicDetails?.correlationId==="string");
 const [[operation]]=await f.db.query("SELECT status,result_json FROM fulfillment_operation_requests WHERE event_id=?",[body.eventId]);assert.equal(operation.status,"SUCCEEDED");
 f.service.detail=detail;const recovered=await f.create(body),original=typeof operation.result_json==="string"?JSON.parse(operation.result_json):operation.result_json;assert.deepEqual(recovered.outcome,original);assert.equal(Number((await f.db.query("SELECT COUNT(*) n FROM shipments"))[0][0].n),1);
 f.service.detail=async()=>{throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");};await assert.rejects(()=>f.create(body),{code:"FULFILLMENT_PERMISSION_DENIED"});f.service.detail=detail;assert.deepEqual((await f.create(body)).outcome,original);
});

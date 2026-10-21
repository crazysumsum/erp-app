import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSalesFulfillmentIntent, salesFulfillmentIntentHash, SalesFulfillmentService } from "../src/modules/sales/SalesFulfillmentService.js";
const fixture=()=>({actor:{userId:"9",serviceName:"",claimedRoles:["operator"],claimedPermissions:["fulfillment.view","fulfillment.operation"]},purpose:"SHIPMENT_CONFIRMED",salesOrderId:"1",expectedOrderVersion:3,eventId:"00000000-0000-4000-8000-000000000001",shipmentId:"21",inventoryRequestHash:"a".repeat(64),lines:[{salesOrderLineId:"2",expectedVersion:2,baseQuantity:"6",reservations:[{claimId:"31",inventoryReservationId:"41",expectedVersion:4,baseQuantity:"6"}]},{salesOrderLineId:"3",expectedVersion:2,baseQuantity:"0",reservations:[]}]});
const mismatch=fn=>assert.throws(fn,{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
test("Sales intent normalizer binds explicit zero selection without caller mutation",()=>{
 const c=fixture(),n=normalizeSalesFulfillmentIntent(c);assert.deepEqual(n,c);assert.ok(Object.isFrozen(n.lines[0].reservations[0]));c.lines[0].baseQuantity="7";assert.equal(n.lines[0].baseQuantity,"6");
});
test("Sales intent hash covers all business/source fields and exact Inventory payload hash",()=>{
 const c=fixture(),hash=salesFulfillmentIntentHash(normalizeSalesFulfillmentIntent(c));for(const patch of [{shipmentId:"22"},{salesOrderId:"2"},{inventoryRequestHash:"b".repeat(64)},{expectedOrderVersion:4}])assert.notEqual(salesFulfillmentIntentHash(normalizeSalesFulfillmentIntent({...c,...patch})),hash);
 const n=fixture();n.actor.claimedRoles.push("viewer");assert.equal(salesFulfillmentIntentHash(normalizeSalesFulfillmentIntent(n)),hash);
});
test("CLAIM pure lock command accepts no source journal fields",()=>{
 const c=fixture();c.purpose="CLAIM";for(const k of ["eventId","shipmentId","inventoryRequestHash"])delete c[k];assert.equal(normalizeSalesFulfillmentIntent(c).purpose,"CLAIM");mismatch(()=>normalizeSalesFulfillmentIntent({...c,eventId:fixture().eventId}));
});
test("Reversal binds original confirmation and original Inventory member operation",()=>{
 const c=fixture();c.purpose="SHIPMENT_REVERSED";c.originalConfirmationEventId="00000000-0000-4000-8000-000000000002";c.lines[0].reservations[0].originalInventoryOperationId="51";assert.equal(normalizeSalesFulfillmentIntent(c).lines[0].reservations[0].originalInventoryOperationId,"51");delete c.originalConfirmationEventId;mismatch(()=>normalizeSalesFulfillmentIntent(c));
});
test("unknown command fields and service-name bearer fail closed",()=>{
 for(const patch of [{extra:true},{purpose:"arbitrary"},{actor:{...fixture().actor,serviceName:"trusted-by-name"}}])mismatch(()=>normalizeSalesFulfillmentIntent({...fixture(),...patch}));
});
test("safe canonical string IDs and positive Number versions are enforced",()=>{
 for(const value of [1,"01","0","9007199254740992",null])mismatch(()=>normalizeSalesFulfillmentIntent({...fixture(),salesOrderId:value}));for(const value of ["3",0,1.1,4294967296])mismatch(()=>normalizeSalesFulfillmentIntent({...fixture(),expectedOrderVersion:value}));
});
test("missing or duplicate reservation sets, quantities and unsorted Lines fail closed",()=>{
 for(const change of [c=>c.lines.reverse(),c=>c.lines[0].reservations.push({...c.lines[0].reservations[0]}),c=>c.lines[0].reservations[0].baseQuantity="5",c=>c.lines[0].reservations=[],c=>c.lines[1].reservations.push({...c.lines[0].reservations[0]})]){const c=fixture();change(c);mismatch(()=>normalizeSalesFulfillmentIntent(c));}
});
test("all-zero intent is rejected before any journal claim",()=>{const c=fixture();c.lines[0].baseQuantity="0";c.lines[0].reservations=[];mismatch(()=>normalizeSalesFulfillmentIntent(c));});
test("missing or fabricated transaction executor fails before any effect",async()=>{
 const s=new SalesFulfillmentService({context:{get:()=>({databaseTransaction:{}})}});await assert.rejects(()=>s.lockLinesForFulfillmentInTransaction({query(){throw new Error("must not execute");},execute(){}},fixture()),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
});
test("apply without the private bound lock receipt fails before Inventory verification",async()=>{
 const tx={query(){},execute(){}},s=new SalesFulfillmentService({context:{get:()=>({databaseTransaction:tx})}});await assert.rejects(()=>s.applyFulfillmentResultInTransaction(tx,{intent:fixture(),inventoryResult:{operationId:"1",lines:[]}}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
});
test("legal 5000-member intent is retained and 5001 members are refused before hashing/journaling",()=>{
 const c=fixture();c.lines=[{salesOrderLineId:"2",expectedVersion:2,baseQuantity:"5000",reservations:Array.from({length:5000},(_,i)=>({claimId:String(i+1),inventoryReservationId:String(i+1),expectedVersion:1,baseQuantity:"1"}))}];
 assert.equal(normalizeSalesFulfillmentIntent(c).lines[0].reservations.length,5000);c.lines[0].baseQuantity="5001";c.lines[0].reservations.push({claimId:"5001",inventoryReservationId:"5001",expectedVersion:1,baseQuantity:"1"});mismatch(()=>normalizeSalesFulfillmentIntent(c));
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentInventoryBatch } from "../../src/modules/inventory/inventoryFulfillmentValidation.js";
const member=()=>({claimId:"3",inventoryReservationId:"4",expectedVersion:1,baseQuantity:"5",allocations:[{inventoryAllocationId:"6",inventoryBalanceId:"7",expectedVersion:1,expectedBalanceVersion:1,baseQuantity:"5"}]});
const payload=()=>({fulfillmentId:"1",shipmentId:"2",lines:[{fulfillmentLineId:"8",salesOrderLineId:"9",baseQuantity:"5",reservations:[member()]},{fulfillmentLineId:"10",salesOrderLineId:"11",baseQuantity:"0",reservations:[]}]});
test("Inventory Fulfillment wire retains zero lines and canonicalizes deterministic full sets",()=>{
  const value=normalizeFulfillmentInventoryBatch("ISSUE",payload());
  assert.equal(value.lines[1].baseQuantity,"0");assert.deepEqual(value,payload());
  for(const mutate of [p=>p.lines.reverse(),p=>p.lines.push(p.lines[0]),p=>p.lines[0].reservations.push(member()),p=>p.lines[0].reservations[0].allocations.push(member().allocations[0]),p=>p.lines[0].baseQuantity="4",p=>p.lines[0].reservations[0].baseQuantity="4",p=>p.lines[0].reservations[0].allocations[0].baseQuantity="0",p=>p.lines[0].reservations[0].expectedVersion=0,p=>p.fulfillmentId="01",p=>p.lines[0].reservations[0].allocations[0].expectedBalanceVersion=4294967296,p=>p.extra=true]){
    const p=payload();mutate(p);assert.throws(()=>normalizeFulfillmentInventoryBatch("ISSUE",p));
  }
  assert.throws(()=>normalizeFulfillmentInventoryBatch("ISSUE",{...payload(),lines:[payload().lines[1]]}));
});
test("Inventory reverse accepts only original references without caller bucket destinations",()=>{
  const p=payload(),m=p.lines[0].reservations[0];m.originalInventoryOperationId="12";
  m.allocations=[{shipmentIssueId:"13",originalMovementId:"14",inventoryAllocationId:"6",expectedBalanceVersion:2,baseQuantity:"5"}];
  assert.deepEqual(normalizeFulfillmentInventoryBatch("REVERSE",p),p);
  for(const key of ["inventoryBalanceId","binId","warehouseId","lotId"]){const copy=structuredClone(p);copy.lines[0].reservations[0].allocations[0][key]="7";assert.throws(()=>normalizeFulfillmentInventoryBatch("REVERSE",copy));}
});
test("Inventory allocation/release/reallocation use a single event payload and independently bound old/new sets",()=>{
  const p=payload();delete p.shipmentId;
  const m=p.lines[0].reservations[0];m.allocations=[{inventoryBalanceId:"7",expectedBalanceVersion:1,baseQuantity:"5"}];m.overrideReason="";
  assert.deepEqual(normalizeFulfillmentInventoryBatch("ALLOCATE",p),p);
  const release=structuredClone(p);delete release.lines[0].reservations[0].overrideReason;
  release.lines[0].reservations[0].allocations=[member().allocations[0]];
  assert.deepEqual(normalizeFulfillmentInventoryBatch("RELEASE",release),release);
  m.releases=[member().allocations[0]];
  assert.deepEqual(normalizeFulfillmentInventoryBatch("REALLOCATE",p),p);
  const full={fulfillmentId:"1",lines:Array.from({length:100},(_,i)=>({fulfillmentLineId:String(i+1),salesOrderLineId:String(i+1),baseQuantity:"50",reservations:[{claimId:String(i+1),inventoryReservationId:String(i+1),expectedVersion:1,baseQuantity:"50",overrideReason:"",allocations:Array.from({length:50},(_,j)=>({inventoryBalanceId:String(j+1),expectedBalanceVersion:1,baseQuantity:"1"})),releases:Array.from({length:50},(_,j)=>({inventoryAllocationId:String(i*50+j+1),inventoryBalanceId:String(j+1),expectedVersion:1,expectedBalanceVersion:1,baseQuantity:"1"}))}]}))};
  assert.equal(normalizeFulfillmentInventoryBatch("REALLOCATE",full).lines.length,100);
  full.lines[0].reservations[0].allocations.push({inventoryBalanceId:"51",expectedBalanceVersion:1,baseQuantity:"1"});
  assert.throws(()=>normalizeFulfillmentInventoryBatch("REALLOCATE",full));
});

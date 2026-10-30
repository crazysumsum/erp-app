import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentReallocation } from "../../src/modules/fulfillment/fulfillmentReallocationCommand.js";
const body=()=>({eventId:"00000000-0000-4000-8000-000000000017",version:2,lines:[{fulfillmentLineId:2,releases:[{fulfillmentAllocationId:7,inventoryAllocationVersion:1}],allocations:[{inventoryReservationId:3,inventoryBalanceId:4,balanceVersion:2,baseQuantity:"5"}],overrideReason:""}]});
test("Reallocate keeps complete new selection and exact old projection versions in immutable canonical intent",()=>{
 const input=body();input.lines[0].releases.unshift({fulfillmentAllocationId:8,inventoryAllocationVersion:3});const normalized=normalizeFulfillmentReallocation(input);assert.deepEqual(normalized.lines[0].releases.map(row=>row.fulfillmentAllocationId),[7,8]);assert.equal(Object.isFrozen(normalized.lines[0].releases[0]),true);assert.deepEqual(input.lines[0].releases.map(row=>row.fulfillmentAllocationId),[8,7]);
});
test("Reallocate rejects duplicate, incomplete, client-derived old facts and oversized old sets without weakening new selection bounds",()=>{
 for(const mutate of [b=>{delete b.lines[0].releases;},b=>{b.lines[0].releases=[];},b=>{b.lines[0].releases.push({...b.lines[0].releases[0]});},b=>{b.lines[0].releases[0].inventoryAllocationVersion=0;},b=>{b.lines[0].releases[0].fulfillmentAllocationId="7";},b=>{b.lines[0].releases[0].baseQuantity="5";},b=>{b.lines[0].allocations[0].baseQuantity="0";},b=>{b.lines[0].releases=Array.from({length:51},(_,index)=>({fulfillmentAllocationId:index+1,inventoryAllocationVersion:1}));}]){const input=body();mutate(input);assert.throws(()=>normalizeFulfillmentReallocation(input),{code:"FULFILLMENT_INPUT_INVALID"});}
});

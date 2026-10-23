import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentAllocation } from "../../src/modules/fulfillment/fulfillmentAllocationCommand.js";
const body=()=>({eventId:"00000000-0000-4000-8000-000000000016",version:1,lines:[{fulfillmentLineId:2,allocations:[{inventoryReservationId:3,inventoryBalanceId:4,balanceVersion:1,baseQuantity:"5"}],overrideReason:""}]});
test("Allocate intent is immutable, canonical and never accepts caller strategy or owner projections",()=>{
 const input=body(),result=normalizeFulfillmentAllocation(input);assert.deepEqual(result,input);assert.equal(Object.isFrozen(result.lines[0].allocations[0]),true);assert.throws(()=>{result.lines[0].allocations[0].baseQuantity="6";},TypeError);
 const second=body().lines[0];second.fulfillmentLineId=1;second.allocations[0].inventoryReservationId=6;
 assert.deepEqual(normalizeFulfillmentAllocation({...body(),lines:[body().lines[0],second]}).lines.map(line=>line.fulfillmentLineId),[1,2]);
 for(const mutate of [value=>{value.status="PICKING";},value=>{value.lines[0].claimId=8;},value=>{value.lines[0].allocations[0].selectionStrategy="FIFO";},value=>{value.lines[0].allocations[0].baseQuantity="0";},value=>{value.lines[0].allocations[0].baseQuantity=5;},value=>{value.lines[0].allocations[0].balanceVersion=0;},value=>{value.version=4294967296;},value=>{value.eventId="invalid";},value=>{value.lines[0].fulfillmentLineId="2";}]){const input=body();mutate(input);assert.throws(()=>normalizeFulfillmentAllocation(input),{code:"FULFILLMENT_INPUT_INVALID"});}
});
test("Allocate retains exact per-Line50/total5000 leg limits and rejects duplicate sets or inconsistent shared Balance CAS",()=>{
 const input=body();input.lines[0].allocations.push({...input.lines[0].allocations[0]});assert.throws(()=>normalizeFulfillmentAllocation(input),{code:"FULFILLMENT_INPUT_INVALID"});
 const count=length=>({...body(),lines:[{fulfillmentLineId:2,allocations:Array.from({length},(_,index)=>({inventoryReservationId:index+1,inventoryBalanceId:4,balanceVersion:1,baseQuantity:"1"}))}]});assert.equal(normalizeFulfillmentAllocation(count(50)).lines[0].allocations.length,50);assert.throws(()=>normalizeFulfillmentAllocation(count(51)),{code:"FULFILLMENT_INPUT_INVALID"});
 const inconsistent=count(2);inconsistent.lines[0].allocations[1].balanceVersion=2;assert.throws(()=>normalizeFulfillmentAllocation(inconsistent),{code:"FULFILLMENT_INPUT_INVALID"});
});

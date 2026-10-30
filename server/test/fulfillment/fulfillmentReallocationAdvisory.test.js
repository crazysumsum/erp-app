import test from "node:test";
import assert from "node:assert/strict";
import {normalizeReallocationAdvisoryQuery} from "../../src/modules/inventory/inventoryFulfillmentReallocationAdvisory.js";
import {FULFILLMENT_CANDIDATE_RESPONSE} from "../../src/handlers/fulfillments/fulfillmentCandidateSchemas.js";
import {FULFILLMENT_REALLOCATION_CANDIDATE_RESPONSE} from "../../src/handlers/fulfillments/fulfillmentReallocationCandidateSchemas.js";
const query=()=>({fulfillmentId:"1",salesOrderId:"2",warehouseId:"3",page:1,asOf:1700000000000,lines:[{fulfillmentLineId:"4",salesOrderLineId:"5",skuId:"6",baseQuantity:"10",reservations:[{claimId:"8",inventoryReservationId:"12",baseQuantity:"5",releases:[{inventoryAllocationId:"22",expectedVersion:2,baseQuantity:"5"}]},{claimId:"7",inventoryReservationId:"11",baseQuantity:"5",releases:[{inventoryAllocationId:"21",expectedVersion:1,baseQuantity:"5"}]}]}]});
test("HD020 copies/freezes the exact source scope before awaits and orders members as the writer",()=>{
 const input=query(),result=normalizeReallocationAdvisoryQuery(input);input.lines[0].reservations[1].releases[0].baseQuantity="4";assert.equal(result.lines[0].reservations[0].inventoryReservationId,"11");assert.equal(result.lines[0].reservations[0].releases[0].baseQuantity,"5");assert.throws(()=>{result.lines[0].reservations[0].releases[0].baseQuantity="4";},TypeError);assert.equal(Object.isFrozen(result.lines),true);
});
test("HD020 rejects injected credits/modes/selections, duplicate identities, invalid CAS and incomplete quantity scope",()=>{
 for(const mutate of [q=>{q.credits={21:5};},q=>{q.mode="release";},q=>{q.lines[0].reservations[0].allocations=[];},q=>{q.lines[0].reservations[1].inventoryReservationId="12";},q=>{q.lines[0].reservations[1].claimId="8";},q=>{q.lines[0].reservations[1].releases[0].inventoryAllocationId="22";},q=>{q.lines[0].reservations[0].releases[0].expectedVersion=0;},q=>{q.lines[0].reservations[0].releases[0].baseQuantity="4";},q=>{q.lines[0].baseQuantity="9";},q=>{q.page=0;}]){const input=query();mutate(input);assert.throws(()=>normalizeReallocationAdvisoryQuery(input));}
});
test("HD020 distinct response schema adds physical/own/after fields without mutating the old DRAFT schema",()=>{
 const old=FULFILLMENT_CANDIDATE_RESPONSE.properties.demands.items.properties.candidates.items,next=FULFILLMENT_REALLOCATION_CANDIDATE_RESPONSE.properties.demands.items.properties.candidates.items;assert.equal(old.required.includes("freeQuantity"),true);assert.equal(Object.hasOwn(old.properties,"physicalFreeQuantity"),false);assert.equal(next.required.includes("freeQuantity"),false);for(const key of ["physicalFreeQuantity","ownReleaseCredit","availableAfterOwnRelease"])assert.equal(next.required.includes(key),true);assert.equal(next.additionalProperties,false);assert.equal(FULFILLMENT_REALLOCATION_CANDIDATE_RESPONSE.additionalProperties,false);
});

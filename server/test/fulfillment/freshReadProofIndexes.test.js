import test from "node:test";
import assert from "node:assert/strict";
import {pickWorkScope,assertPickOwnerShape,assertPickOwnerVersions,assertPickOwnerMatches,pickReleasePayload,assertPickCurrentOwner} from "../../src/modules/fulfillment/fulfillmentPickingScope.js";
import {planFulfillmentCancel} from "../../src/modules/fulfillment/fulfillmentCancelCommand.js";
import {freshReadProofFixture} from "./freshReadProofFixture.js";

test("Fresh proof joins retain all100lines/5000members, original order, Short quantities and immutable inputs",()=>{
 const f=freshReadProofFixture(100,50),before=structuredClone(f),scope=pickWorkScope(f.snapshot,f.command);assert.equal(scope.plan.allocations.length,5000);assert.equal(scope.query.inventoryAllocationIds.length,5000);assertPickOwnerShape(f.facts,f.query);assertPickOwnerVersions(f.snapshot,f.facts);assertPickOwnerMatches(f.snapshot,f.facts);const payload=pickReleasePayload(f.snapshot,scope.plan,f.facts);assert.equal(payload.lines.length,100);assert.equal(payload.lines.flatMap(row=>row.reservations).length,4999);assert.equal(payload.lines[99].baseQuantity,"49");assert.deepEqual(f,before);assert.deepEqual(scope.plan.allocations.map(row=>row.fulfillmentAllocationId),f.snapshot.allocations.map(row=>String(row.id)));
});
test("Fresh proof shape still rejects duplicate, substituted, missing and contradictory owner facts",()=>{
 for(const mutate of [f=>{f.facts.allocations[1]=structuredClone(f.facts.allocations[0]);},f=>{f.facts.allocations[1].inventoryAllocationId="999999";},f=>{f.facts.allocations.pop();},f=>{f.facts.reservationFacts[1]=structuredClone(f.facts.reservationFacts[0]);},f=>{f.facts.reservationFacts[1].inventoryReservationId="999999";},f=>{f.facts.allocations[1].balanceVersion++;},f=>{f.facts.reservationFacts[0].outstandingQuantity="2";}]){const f=freshReadProofFixture();mutate(f);assert.throws(()=>assertPickOwnerShape(f.facts,f.query),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});}
});
test("Each fresh owner proof observes changed versions, immutable links and complete current counters",()=>{
 const f=freshReadProofFixture();assertPickOwnerVersions(f.snapshot,f.facts);f.facts.allocations[0].version++;assert.throws(()=>assertPickOwnerVersions(f.snapshot,f.facts),{code:"VERSION_CONFLICT"});f.facts.allocations[0].version--;assertPickOwnerMatches(f.snapshot,f.facts);f.facts.allocations[0].claimId="999999";assert.throws(()=>assertPickOwnerMatches(f.snapshot,f.facts),{code:"FULFILLMENT_SOURCE_CONFLICT"});
 const g=freshReadProofFixture(),plan=pickWorkScope(g.snapshot,g.command).plan,before=structuredClone(g.facts);assertPickCurrentOwner(before,g.facts,{allocations:plan.allocations.map(row=>({...row,shortBaseQuantity:"0"}))},g.snapshot);g.facts.reservationFacts[0].version++;assert.throws(()=>assertPickCurrentOwner(before,g.facts,{allocations:plan.allocations.map(row=>({...row,shortBaseQuantity:"0"}))},g.snapshot),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});
});
test("Cancel fresh grouping preserves allclaims, missinglink rejection and returned-goods requirement",()=>{
 const f=freshReadProofFixture(100,50),command={version:2,reason:"Wrong warehouse task",goodsReturnedToOriginalBins:false};assert.equal(planFulfillmentCancel(f.snapshot,command).allocations.length,5000);f.snapshot.allocations[4999].claim_id=999999;assert.throws(()=>planFulfillmentCancel(f.snapshot,command),{code:"FULFILLMENT_SOURCE_CONFLICT"});
 const g=freshReadProofFixture();g.snapshot.header.status="PICKED";g.snapshot.header.picked_at=1;for(const row of g.snapshot.lines)row.picked_base_quantity=row.planned_base_quantity;for(const row of g.snapshot.allocations)row.picked_base_quantity=1;for(const row of g.snapshot.allocationTotals)row.picked=row.allocated;assert.throws(()=>planFulfillmentCancel(g.snapshot,command),{code:"FULFILLMENT_INPUT_INVALID"});assert.equal(planFulfillmentCancel(g.snapshot,{...command,goodsReturnedToOriginalBins:true}).allocations.length,6);
});

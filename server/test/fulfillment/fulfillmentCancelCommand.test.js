import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentCancel } from "../../src/modules/fulfillment/fulfillmentCancelCommand.js";
const body=reason=>({eventId:"00000000-0000-4000-8000-000000000019",version:1,reason});
test("Cancel reason boundaries count supplementary Unicode characters, not UTF16 units",()=>{
 for(const reason of ["😀😀a","😀😀ab","😀".repeat(501)])assert.throws(()=>normalizeFulfillmentCancel(body(reason)),{code:"FULFILLMENT_INPUT_INVALID"});
 for(const reason of ["😀😀abc","😀".repeat(300),"😀".repeat(500)])assert.equal(normalizeFulfillmentCancel(body(reason)).reason,reason);
 assert.equal(normalizeFulfillmentCancel(body("  😀😀abc  ")).reason,"😀😀abc");
});
test("Cancel intent rejects injected quantities, actor, coerced flags and control characters",()=>{
 const input=body("Wrong warehouse task");assert.ok(Object.isFrozen(normalizeFulfillmentCancel(input)));
 for(const extra of [{actor:1},{quantity:"5"},{goodsReturnedToOriginalBins:"true"},{reason:"bad\nreason"},{reason:"hidden\u200breason"},{version:0}])assert.throws(()=>normalizeFulfillmentCancel({...input,...extra}),{code:"FULFILLMENT_INPUT_INVALID"});
});
test("Cancel preserves unknown commit identity and unclassified database errors",async()=>{
 const {FulfillmentCancellationService}=await import("../../src/modules/fulfillment/FulfillmentCancellationService.js"),service=new FulfillmentCancellationService({database:{withTransaction(){}},time:{nowMs:()=>1},logger:{error(){}}});for(const code of ["DATABASE_TRANSACTION_INDETERMINATE","DATABASE_TRANSACTION_FAILED","DATABASE_CONNECTION_TIMEOUT"]){const error=Object.assign(new Error("Synthetic unknown cancellation outcome"),{code,cause:{code:"ER_LOCK_DEADLOCK"}});service.transactions.withTransaction=async()=>{throw error;};await assert.rejects(()=>service.cancel("1",body("Wrong warehouse task")),actual=>actual===error);}
});
test("Cancel policy validates every supported state's history, actual goods return and active quantities",async()=>{
 const {planFulfillmentCancel}=await import("../../src/modules/fulfillment/fulfillmentCancelCommand.js");
 const snapshot=status=>({header:{id:1,status,version:1,line_count:1,active_shipment_id:null,allocated_at:status==="DRAFT"?null:1,picked_at:status==="PICKED"?2:null,shipped_at:null,reversed_at:null},lines:[{id:2,fulfillment_id:1,planned_base_quantity:"5",allocated_base_quantity:status==="DRAFT"?"0":"10",picked_base_quantity:status==="PICKED"?"3":"0",short_base_quantity:status==="PICKED"?"2":"0",shipped_base_quantity:"0",reversed_base_quantity:"0",version:2}],claims:[{id:3,fulfillment_id:1,fulfillment_line_id:2,inventory_reservation_id:4,original_claimed_quantity:"5",active_claimed_quantity:status==="PICKED"?"3":"5",released_quantity:status==="PICKED"?"2":"0",consumed_quantity:"0",reversed_quantity:"0",status:"ACTIVE",inventory_version:2}],allocations:status==="DRAFT"?[]:[{id:5,fulfillment_id:1,fulfillment_line_id:2,claim_id:3,inventory_reservation_id:4,inventory_allocation_id:6,allocated_base_quantity:"5",released_base_quantity:status==="PICKED"?"2":"0",picked_base_quantity:status==="PICKED"?"3":"0",status:status==="PICKED"?"PARTIALLY_RELEASED":"ACTIVE",inventory_version:2}],allocationTotals:status==="DRAFT"?[]:[{fulfillment_line_id:2,allocated:"10",released:status==="PICKED"?"7":"5",picked:status==="PICKED"?"3":"0"}],hasShipment:false});
 for(const status of ["DRAFT","PICKING","PICKED"]){const s=snapshot(status),before=structuredClone(s),input=normalizeFulfillmentCancel({...body(status==="DRAFT"?"":"Wrong warehouse task"),goodsReturnedToOriginalBins:status==="PICKED"}),plan=planFulfillmentCancel(s,input);assert.equal(plan.status,status);assert.deepEqual(s,before);if(status==="PICKED"){assert.equal(plan.allocations[0].shortBaseQuantity,"3");assert.throws(()=>planFulfillmentCancel(s,{...input,goodsReturnedToOriginalBins:false}),{code:"FULFILLMENT_INPUT_INVALID"});}if(status!=="DRAFT")assert.throws(()=>planFulfillmentCancel(s,{...input,reason:""}),{code:"FULFILLMENT_INPUT_INVALID"});
  for(const change of [v=>{v.header.version=2;},v=>{v.hasShipment=true;},v=>{v.header.active_shipment_id=1;},v=>{v.claims[0].consumed_quantity="1";},v=>{v.claims[0].active_claimed_quantity="6";},v=>{v.lines[0].planned_base_quantity="6";}]){const bad=structuredClone(s);change(bad);assert.throws(()=>planFulfillmentCancel(bad,input));}
 }
});

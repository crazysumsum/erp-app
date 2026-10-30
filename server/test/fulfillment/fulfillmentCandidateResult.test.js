import assert from "node:assert/strict";
import test from "node:test";
import { assertFulfillmentCandidateResult } from "../../src/modules/fulfillment/fulfillmentCandidateResult.js";
function fixture(){
 const demand={fulfillmentLineId:"1",claimId:"2",inventoryReservationId:"3",skuId:"4",requestedQuantity:"5",page:1},result={warehouseId:"5",asOf:1,demands:[{...demand,expectedReservationVersion:2,minimumRemainingDays:0,baseUom:{uomId:"6",uomCode:"EA",version:1},hasMore:false,candidates:[{inventoryBalanceId:"7",binId:"8",binCode:"A",lotId:null,expiryDate:null,firstReceiptDate:null,fifoAnchorDate:"2026-10-01",freeQuantity:"5",batchAvailableQuantity:"5",expectedBalanceVersion:1,selectionStrategy:"FIFO",rank:1,eligible:true,recommendedQuantity:"5"}],summary:{requestedBaseQuantity:"5",recommendedBaseQuantity:"5",quantityComplete:true,insufficientStock:false}}]};
 return {result,check:()=>assertFulfillmentCandidateResult(result,[demand],[{inventoryReservationId:"3",inventoryVersion:2}],"5",new Map([["1","6"]]))};
}
test("HD018 complete visible recommendations must reconcile exactly with the quantity summary",()=>{
 const f=fixture();f.check();f.result.demands[0].candidates[0].recommendedQuantity="4";assert.throws(f.check,{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});
});
test("HD018 candidate Base UOM must match the already verified parent Line identity",()=>{
 const f=fixture();f.result.demands[0].baseUom.uomId="99";assert.throws(f.check,{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});
});

test("HD018 malformed Lot/expiry combinations cannot masquerade as eligible FEFO",()=>{
 const f=fixture();f.result.demands[0].candidates[0].expiryDate="2026-11-01";f.result.demands[0].candidates[0].selectionStrategy="FEFO";assert.throws(f.check,{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFulfillmentBatchCandidates } from "../../src/modules/inventory/inventoryFulfillmentCandidateAdvisory.js";
function setup(rows,demands,days=[]) {
 const physical=rows.map((row,index)=>({id:index+1,bin_id:index+1,lot_id:null,version:7,on_hand_quantity:row.quantity,allocated_quantity:0,bin_code:String(index).padStart(3,"0"),normalized_lot_number:null,expiry_date:null,first_receipt_date:null,fifo_anchor_date:"2026-10-01",...row}));
 const statements=[],tx={async query(sql,values){statements.push(sql);assert.match(sql,/^SELECT /u);const eligible=physical.filter(row=>row.expiry_date===null||row.expiry_date>=values[2]);return [eligible.slice(values[4]??0,(values[4]??0)+values[3])];}};
 const requests=demands.map((requestedQuantity,index)=>({fulfillmentLineId:String(index+1),claimId:String(index+1),inventoryReservationId:String(index+1),skuId:"1",requestedQuantity:String(requestedQuantity),page:1}));
 const reservations=new Map(requests.map((demand,index)=>[demand.inventoryReservationId,{minimum_remaining_days:days[index]??0,version:3}])),profiles=new Map([["1",{trackingPolicy:physical.some(row=>row.lot_id!==null)?"batch_expiry":"none",baseUom:{uomId:"1",uomCode:"EA",uomName:"Each"}}]]);
 return {physical,requests,statements,read:()=>readFulfillmentBatchCandidates(tx,{warehouseId:"1",demands:requests,profiles,reservations,time:{fileDate:()=>"2026-10-21",nowMs:()=>1}})};
}
test("HD018 shared virtual budget changes next-member rank while preserving physical quantities and initial CAS",async()=>{
 const f=setup([{quantity:4},{quantity:3}],[4,3]),before=structuredClone(f.physical),result=await f.read();
 assert.equal(result.demands[1].candidates.length,1);const candidate=result.demands[1].candidates[0];assert.equal(candidate.inventoryBalanceId,"2");assert.equal(candidate.rank,1);assert.equal(candidate.expectedBalanceVersion,7);assert.equal(candidate.freeQuantity,"3");assert.equal(candidate.batchAvailableQuantity,"3");assert.deepEqual(f.physical,before);
});
test("HD018 later pages replay every prior member's full recommendation, not only its visible page",async()=>{
 const f=setup(Array.from({length:205},()=>({quantity:1})),[101,104]);for(const request of f.requests)request.page=2;
 const result=await f.read();assert.equal(result.demands[0].candidates[0].inventoryBalanceId,"101");assert.equal(result.demands[1].candidates[0].inventoryBalanceId,"202");assert.equal(result.demands[1].candidates[0].rank,101);assert.equal(result.demands[1].candidates.length,4);assert.equal(result.demands[1].hasMore,false);assert.equal(result.demands[1].summary.recommendedBaseQuantity,"104");assert.equal(result.demands[1].summary.quantityComplete,true);
});
test("HD018 budget is shared by Balance even across different minimum-life eligibility sets",async()=>{
 const f=setup([{quantity:5,lot_id:1,expiry_date:"2026-10-25"},{quantity:3,lot_id:2,expiry_date:"2026-11-01"}],[4,4],[7,0]);
 const result=await f.read();assert.deepEqual(result.demands[0].candidates.map(row=>[row.inventoryBalanceId,row.recommendedQuantity]),[["2","3"]]);assert.equal(result.demands[0].summary.insufficientStock,true);
 assert.deepEqual(result.demands[1].candidates.map(row=>[row.inventoryBalanceId,row.recommendedQuantity]),[["1","4"]]);assert.equal(result.demands[1].summary.quantityComplete,true);
});
test("HD018 a proven stock shortage is explicit and never a fabricated complete recommendation",async()=>{
 const result=await setup([{quantity:5}],[4,4]).read(),second=result.demands[1];assert.deepEqual(second.summary,{requestedBaseQuantity:"4",recommendedBaseQuantity:"1",quantityComplete:false,insufficientStock:true});assert.equal(second.candidates[0].freeQuantity,"5");assert.equal(second.candidates[0].batchAvailableQuantity,"1");
});

test("HD018 repeated physical Balance IDs across pages fail closed instead of returning a partial proof",async()=>{
 const rows=Array.from({length:100},(_,index)=>({id:index+1,bin_id:index+1,lot_id:null,version:1,on_hand_quantity:1,allocated_quantity:0,bin_code:String(index).padStart(3,"0"),normalized_lot_number:null,expiry_date:null,first_receipt_date:null,fifo_anchor_date:"2026-10-01"}));
 const tx={async query(){return [rows];}},demand={fulfillmentLineId:"1",claimId:"1",inventoryReservationId:"1",skuId:"1",requestedQuantity:"101",page:1};
 await assert.rejects(()=>readFulfillmentBatchCandidates(tx,{warehouseId:"1",demands:[demand],profiles:new Map([["1",{trackingPolicy:"none",baseUom:{}}]]),reservations:new Map([["1",{version:1,minimum_remaining_days:0}]]),time:{fileDate:()=>"2026-10-21",nowMs:()=>1}}),{code:"INVENTORY_DEPENDENCY_UNAVAILABLE"});
});

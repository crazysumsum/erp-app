import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFulfillmentAllocationPreview,fulfillmentAllocationPreviewScope} from "../../src/modules/fulfillment/fulfillmentAllocationPreview.js";
const request=()=>({version:2,selectedClaimId:11,page:1,selections:[{claimId:11,allocations:[{inventoryBalanceId:21,expectedBalanceVersion:3,baseQuantity:"4"}]}],lineReasons:[{fulfillmentLineId:31,reason:""}]});
test("HD024 preview request copies and freezes only editable selections, without source or write authority",()=>{
 const input=request(),result=normalizeFulfillmentAllocationPreview(input);input.selections[0].allocations[0].baseQuantity="999";input.lineReasons[0].reason="changed";
 assert.equal(result.selections[0].allocations[0].baseQuantity,"4");assert.equal(result.lineReasons[0].reason,"");assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.selections[0].allocations[0]));assert.ok(Object.isFrozen(result.lineReasons));
});
test("HD024 permits incomplete editable selections and short reasons without claiming readiness",()=>{
 const input=request();input.selections[0].allocations=[];input.lineReasons[0].reason="一";const result=normalizeFulfillmentAllocationPreview(input);assert.equal(result.lineReasons[0].reason,"一");assert.deepEqual(result.selections[0].allocations,[]);input.selections=[];assert.deepEqual(normalizeFulfillmentAllocationPreview(input).selections,[]);
});
test("HD024 rejects injected authority, ambiguous identities, invalid CAS, duplicate legs and malformed quantities",()=>{
 const cases=[input=>input.eventId=crypto.randomUUID(),input=>input.purpose="REALLOCATE",input=>input.credits={},input=>input.selectedClaimId="11",input=>input.version=4294967296,input=>input.page=Number.MAX_SAFE_INTEGER,input=>input.selections.push(input.selections[0]),input=>input.selections[0].allocations.push(input.selections[0].allocations[0]),input=>input.selections[0].inventoryReservationId=1,input=>input.selections[0].allocations[0].expectedBalanceVersion=0,input=>input.selections[0].allocations[0].baseQuantity="0",input=>input.selections[0].allocations[0].baseQuantity="04",input=>input.selections[0].allocations[0].baseQuantity=4,input=>input.lineReasons.push(input.lineReasons[0]),input=>input.lineReasons[0].reason="bad\nreason",input=>input.lineReasons[0].reason="😀".repeat(501)];
 for(const change of cases){const input=request();change(input);assert.throws(()=>normalizeFulfillmentAllocationPreview(input),{code:"FULFILLMENT_INPUT_INVALID"});}
});
test("HD024 retains initial per-leg CAS for owner assessment instead of rejecting an editable stale choice",()=>{
 const input=request();input.selections.push({claimId:12,allocations:[{inventoryBalanceId:21,expectedBalanceVersion:4,baseQuantity:"4"}]});const result=normalizeFulfillmentAllocationPreview(input);assert.deepEqual(result.selections.map(row=>row.allocations[0].expectedBalanceVersion),[3,4]);
});
test("HD024 preserves500 Unicode codepoints and complete5000-member request limits",()=>{
 const input=request();input.lineReasons[0].reason="😀".repeat(500);input.selections=Array.from({length:5000},(_,index)=>({claimId:index+1,allocations:[{inventoryBalanceId:21,expectedBalanceVersion:3,baseQuantity:"1"}]}));assert.equal(normalizeFulfillmentAllocationPreview(input).selections.length,5000);input.selections[0].allocations.push({inventoryBalanceId:22,expectedBalanceVersion:3,baseQuantity:"1"});assert.throws(()=>normalizeFulfillmentAllocationPreview(input),{code:"FULFILLMENT_INPUT_INVALID"});
});
const snapshot=()=>({header:{id:8,version:2,status:"DRAFT",sales_order_id:9,warehouse_id:10,line_count:1,active_shipment_id:null,allocated_at:null,picked_at:null,shipped_at:null,reversed_at:null},lines:[{id:31,fulfillment_id:8,sales_order_line_id:41,sku_id:51,version:1,planned_base_quantity:5,allocated_base_quantity:0,picked_base_quantity:0,short_base_quantity:0,shipped_base_quantity:0,reversed_base_quantity:0}],claims:[{id:11,fulfillment_id:8,fulfillment_line_id:31,inventory_reservation_id:61,original_claimed_quantity:5,active_claimed_quantity:5,released_quantity:0,consumed_quantity:0,reversed_quantity:0,status:"ACTIVE"}]});
test("HD024 source scope derives real source identities without dummy allocations or caller purpose",()=>{
 const source=snapshot(),query=fulfillmentAllocationPreviewScope(source,normalizeFulfillmentAllocationPreview(request()),100);
 assert.equal(query.purpose,"ALLOCATE");assert.equal(query.fulfillmentId,"8");assert.equal(query.lines[0].salesOrderLineId,"41");assert.equal(query.lines[0].reservations[0].inventoryReservationId,"61");assert.equal(query.lines[0].reservations[0].baseQuantity,"5");assert.equal(query.selectedClaimId,"11");assert.equal(query.selections[0].allocations[0].inventoryBalanceId,"21");assert.ok(!Object.hasOwn(query.lines[0].reservations[0],"allocations"));assert.ok(Object.isFrozen(query.lines[0].reservations[0]));
});
test("HD024 source scope rejects wrong version, foreign selectors and malformed or exhausted source",()=>{
 for(const change of [source=>source.header.version++,source=>source.lines[0].version=4294967295,source=>source.historySequence=4294967295]){const source=snapshot();change(source);assert.throws(()=>fulfillmentAllocationPreviewScope(source,normalizeFulfillmentAllocationPreview(request()),100),{code:"VERSION_CONFLICT"});}
 for(const change of [input=>input.selectedClaimId=12,input=>input.selections[0].claimId=12,input=>input.lineReasons[0].fulfillmentLineId=32]){const input=request();change(input);assert.throws(()=>fulfillmentAllocationPreviewScope(snapshot(),normalizeFulfillmentAllocationPreview(input),100),{code:"FULFILLMENT_INPUT_INVALID"});}
 const source=snapshot();source.claims[0].active_claimed_quantity=4;assert.throws(()=>fulfillmentAllocationPreviewScope(source,normalizeFulfillmentAllocationPreview(request()),100),{code:"FULFILLMENT_SOURCE_CONFLICT"});
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentPick,planFulfillmentPick } from "../../src/modules/fulfillment/fulfillmentPickingCommand.js";
const body=()=>({eventId:"00000000-0000-4000-8000-000000000018",version:2,lines:[{fulfillmentLineId:2,shortPickReason:"",allocations:[{fulfillmentAllocationId:3,inventoryAllocationVersion:1,pickedBaseQuantity:"5"}]}]});
const snapshot=()=>({header:{id:1,status:"PICKING",version:2,line_count:1},lines:[{id:2,planned_base_quantity:"5",allocated_base_quantity:"10",picked_base_quantity:"0",short_base_quantity:"0",shipped_base_quantity:"0",reversed_base_quantity:"0"}],allocations:[{id:3,fulfillment_line_id:2,allocated_base_quantity:"5",released_base_quantity:"0",picked_base_quantity:"0",inventory_version:1,status:"ACTIVE"}]});
test("Pick intent is strict, immutable and keeps explicit zero quantities and exact owner versions",()=>{
 const input=body(),command=normalizeFulfillmentPick(input);assert.deepEqual(command,input);assert.equal(Object.isFrozen(command.lines[0].allocations[0]),true);
 const zero=body();zero.lines[0].allocations[0].pickedBaseQuantity="0";assert.equal(normalizeFulfillmentPick(zero).lines[0].allocations[0].pickedBaseQuantity,"0");
 for(const mutate of [v=>{v.pickedBy=1;},v=>{v.lines[0].allocations=[];},v=>{v.lines[0].allocations[0].inventoryReservationId=1;},v=>{v.lines[0].allocations[0].pickedBaseQuantity=-1;},v=>{v.lines[0].allocations[0].pickedBaseQuantity="01";},v=>{v.lines[0].allocations[0].pickedBaseQuantity="-1";},v=>{v.lines[0].allocations[0].inventoryAllocationVersion=0;},v=>{v.lines[0].shortPickReason="bad\nreason";},v=>{v.lines[0].allocations.push({...v.lines[0].allocations[0]});}]){const input=body();mutate(input);assert.throws(()=>normalizeFulfillmentPick(input),{code:"FULFILLMENT_INPUT_INVALID"});}
});
test("Pick plan verifies exact active set, current versions and quantities after cumulative Reallocate history",()=>{
 const command=normalizeFulfillmentPick(body()),plan=planFulfillmentPick(snapshot(),command);assert.deepEqual(plan.lines.map(line=>[line.fulfillmentLineId,line.pickedBaseQuantity,line.shortBaseQuantity,line.shortPickReason]),[["2","5","0",""]]);assert.equal(plan.allocations[0].shortBaseQuantity,"0");
 for(const mutate of [s=>{s.header.status="PICKED";},s=>{s.header.version=3;},s=>{s.allocations[0].inventory_version=2;},s=>{s.allocations.push({...s.allocations[0],id:4});},s=>{s.allocations[0].fulfillment_line_id=4;},s=>{s.lines[0].planned_base_quantity="6";}]){const s=snapshot();mutate(s);assert.throws(()=>planFulfillmentPick(s,command));}
 const excess=body();excess.lines[0].allocations[0].pickedBaseQuantity="6";assert.throws(()=>planFulfillmentPick(snapshot(),normalizeFulfillmentPick(excess)),{code:"PICK_RESULT_INVALID"});
});
test("Short Pick requires a per-Line reason and an explicit nonzero result somewhere in the document",()=>{
 const input=body();input.lines[0].allocations[0].pickedBaseQuantity="3";assert.throws(()=>planFulfillmentPick(snapshot(),normalizeFulfillmentPick(input)),{code:"SHORT_PICK_REASON_REQUIRED"});
 input.lines[0].shortPickReason="  Missing two units  ";const plan=planFulfillmentPick(snapshot(),normalizeFulfillmentPick(input));assert.deepEqual(plan.lines.map(line=>[line.pickedBaseQuantity,line.shortBaseQuantity,line.shortPickReason]),[["3","2","Missing two units"]]);assert.equal(plan.allocations[0].shortBaseQuantity,"2");assert.equal(Object.isFrozen(plan.allocations[0]),true);
 input.lines[0].allocations[0].pickedBaseQuantity="0";assert.throws(()=>planFulfillmentPick(snapshot(),normalizeFulfillmentPick(input)),{code:"PICK_RESULT_INVALID"});
 input.lines[0].shortPickReason="";assert.throws(()=>planFulfillmentPick(snapshot(),normalizeFulfillmentPick(input)),{code:"PICK_RESULT_INVALID"});
});
test("Pick retains per-Line50/global5000 limits without coercion or loss of integer precision",()=>{
 const input=body();input.lines[0].allocations=Array.from({length:50},(_,index)=>({fulfillmentAllocationId:index+1,inventoryAllocationVersion:1,pickedBaseQuantity:"0"}));assert.equal(normalizeFulfillmentPick(input).lines[0].allocations.length,50);input.lines[0].allocations.push({fulfillmentAllocationId:51,inventoryAllocationVersion:1,pickedBaseQuantity:"1"});assert.throws(()=>normalizeFulfillmentPick(input),{code:"FULFILLMENT_INPUT_INVALID"});
});
test("One entirely short Line is allowed when another Line has a positive pick; original planned quantities stay unchanged",()=>{
 const input=body(),s=snapshot();input.lines[0].allocations[0].pickedBaseQuantity="0";input.lines[0].shortPickReason="Original bucket is empty";input.lines.push({fulfillmentLineId:4,shortPickReason:"",allocations:[{fulfillmentAllocationId:5,inventoryAllocationVersion:1,pickedBaseQuantity:"2"}]});s.header.line_count=2;s.lines.push({...s.lines[0],id:4,planned_base_quantity:"2",allocated_base_quantity:"2"});s.allocations.push({...s.allocations[0],id:5,fulfillment_line_id:4,allocated_base_quantity:"2"});
 const before=structuredClone(s),plan=planFulfillmentPick(s,normalizeFulfillmentPick(input));assert.deepEqual(plan.lines.map(line=>[line.pickedBaseQuantity,line.shortBaseQuantity]),[["0","5"],["2","0"]]);assert.deepEqual(s,before);
});
test("Pick preserves unknown commit and unclassified database outcomes instead of inviting a new operation",async()=>{
 const {FulfillmentPickingService}=await import("../../src/modules/fulfillment/FulfillmentPickingService.js"),service=new FulfillmentPickingService({database:{withTransaction(){}},time:{nowMs:()=>1},logger:{error(){}}});
 for(const code of ["DATABASE_TRANSACTION_INDETERMINATE","DATABASE_TRANSACTION_FAILED","DATABASE_CONNECTION_TIMEOUT"]){const error=Object.assign(new Error("Synthetic unknown Pick outcome"),{code,cause:{code:"ER_LOCK_DEADLOCK"}});service.transactions.withTransaction=async()=>{throw error;};await assert.rejects(()=>service.confirmPick("1",body()),actual=>actual===error);}
});

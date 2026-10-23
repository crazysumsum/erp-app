import assert from "node:assert/strict";
import test from "node:test";
import { planSalesFulfillmentQuantities } from "../src/modules/sales/salesFulfillmentQuantities.js";
const line=(id,reserved="10",fulfilled="0",cancelled="0",backorder="0")=>({salesOrderLineId:id,version:2,orderedBaseQuantity:(BigInt(reserved)+BigInt(fulfilled)+BigInt(cancelled)+BigInt(backorder)).toString(),reservedOutstandingBaseQuantity:reserved,backorderedBaseQuantity:backorder,fulfilledBaseQuantity:fulfilled,cancelledBaseQuantity:cancelled});
const order=(lines,status="CONFIRMED")=>({orderId:"1",status,version:3,lines});
const selected=(id,q,version=2)=>({salesOrderLineId:id,expectedVersion:version,baseQuantity:q});
const run=(o,lines,action="SHIPMENT_CONFIRMED")=>planSalesFulfillmentQuantities(o,{action,lines});
const mismatch=fn=>assert.throws(fn,{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
test("confirm moves only selected quantity Reserved to Fulfilled and increments changed versions",()=>{
 const o=order([line("2"),line("3","2")]),before=structuredClone(o),r=run(o,[selected("2","6"),selected("3","0")]);
 assert.deepEqual(r,{orderId:"1",status:"PARTIALLY_FULFILLED",version:4,lines:[{...line("2","4","6"),version:3},line("3","2")]});assert.deepEqual(o,before);
});
test("all remaining quantities fulfilled completes in first or later shipment",()=>{
 for(const status of ["CONFIRMED","PARTIALLY_FULFILLED"])assert.equal(run(order([line("2","6",status==="CONFIRMED"?"0":"4")],status),[selected("2","6")]).status,"COMPLETED");
});
test("unselected SO line contributes to aggregate state but is absent from selected result",()=>{
 const r=run(order([line("2"),line("3")]),[selected("2","10")]);assert.equal(r.status,"PARTIALLY_FULFILLED");assert.deepEqual(r.lines.map(l=>l.salesOrderLineId),["2"]);
});
test("Reversal reopens completed and preserves original quantity totals",()=>{
 const r=run(order([line("2","0","10")],"COMPLETED"),[selected("2","10")],"SHIPMENT_REVERSED");assert.equal(r.status,"CONFIRMED");assert.deepEqual(r.lines,[{...line("2"),version:3}]);
});
test("Reversal from CLOSED preserves Cancelled and Backorder while reopening",()=>{
 const r=run(order([line("2","0","6","4")],"CLOSED"),[selected("2","2")],"SHIPMENT_REVERSED");assert.equal(r.status,"PARTIALLY_FULFILLED");assert.deepEqual(r.lines,[{...line("2","2","4","4"),version:3}]);
});
test("full Reversal of CLOSED preserves cancelled remainder and returns CONFIRMED",()=>{
 const r=run(order([line("2","0","6","4")],"CLOSED"),[selected("2","6")],"SHIPMENT_REVERSED");assert.equal(r.status,"CONFIRMED");assert.equal(r.lines[0].cancelledBaseQuantity,"4");
});
test("Backorder and cancelled amounts are never folded into fulfilled quantity",()=>{
 const r=run(order([line("2","6","0","1","3")]),[selected("2","6")]);assert.equal(r.status,"PARTIALLY_FULFILLED");assert.equal(r.lines[0].backorderedBaseQuantity,"3");assert.equal(r.lines[0].cancelledBaseQuantity,"1");
});
test("large aggregate totals use exact arithmetic beyond JavaScript safe summed range",()=>{
 const q=String(Number.MAX_SAFE_INTEGER);assert.equal(run(order([line("2",q),line("3",q)]),[selected("2",q),selected("3",q)]).status,"COMPLETED");
});
test("explicit zero lines remain unchanged in a mixed positive shipment",()=>{
 const r=run(order([line("2"),line("3")]),[selected("2","1"),selected("3","0")]);assert.equal(r.lines[1].version,2);assert.equal(r.lines[1].reservedOutstandingBaseQuantity,"10");
});
test("all-zero document cannot create history or business version increments",()=>mismatch(()=>run(order([line("2")]),[selected("2","0")])));
test("missing/duplicate/unsorted selected identities and stale selected versions fail closed",()=>{
 for(const lines of [[],[selected("9","1")],[selected("2","1"),selected("2","1")],[selected("3","1"),selected("2","1")],[selected("2","1",1)]])mismatch(()=>run(order([line("2"),line("3")]),lines));
});
test("Confirm over-reserve and Reversal over-fulfilled quantities fail closed",()=>{
 mismatch(()=>run(order([line("2")]),[selected("2","11")]));mismatch(()=>run(order([line("2","4","6")],"PARTIALLY_FULFILLED"),[selected("2","7")],"SHIPMENT_REVERSED"));
});
test("malformed decimal strings, unsafe values, absent quantities and original imbalance fail closed",()=>{
 for(const value of [1,"01","1.0","-1","9007199254740992",null])mismatch(()=>run(order([line("2")]),[selected("2",value)]));
 const l=line("2");delete l.cancelledBaseQuantity;mismatch(()=>run(order([l]),[selected("2","1")]));mismatch(()=>run(order([{...line("2"),orderedBaseQuantity:"11"}]),[selected("2","1")]));
});
test("unknown action and forbidden current order states fail closed",()=>{
 for(const status of ["DRAFT","CONFIRMING","CANCELLED","CLOSED","COMPLETED"])mismatch(()=>run(order([line("2")],status),[selected("2","1")]));mismatch(()=>run(order([line("2")]),[selected("2","1")],"arbitrary"));
});
test("version overflow rejects instead of producing values SQL cannot persist",()=>{
 mismatch(()=>run({...order([line("2")]),version:4294967295},[selected("2","1")]));mismatch(()=>run(order([{...line("2"),version:4294967295}]),[selected("2","1",4294967295)]));
});
test("malformed row objects and selected members use the stable contract mismatch",()=>{
 for(const lines of [[null],[undefined]])mismatch(()=>run(order(lines),[selected("2","1")]));
 for(const lines of [[null],[undefined]])mismatch(()=>run(order([line("2")]),lines));
 mismatch(()=>run(order([line("2")]),[selected("2","9".repeat(10000))]));
});

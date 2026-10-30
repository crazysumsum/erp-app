import assert from "node:assert/strict";
import test from "node:test";
import { loadFulfillmentReallocationCandidates } from "../../src/modules/inventory/InventoryPickSequenceService.js";
const query={warehouseId:1,skuId:2,currentDate:"2026-10-23",minimumRemainingDays:0,trackingPolicy:"none",limit:100};
const row=()=>({id:3,bin_id:4,lot_id:null,version:7,on_hand_quantity:5,allocated_quantity:5,bin_code:"A",normalized_lot_number:null,expiry_date:null,first_receipt_date:null,fifo_anchor_date:"2026-10-01",own_release_credit:5});
test("Owner release-aware reader exposes physical zero separately from own credit and initial CAS",async()=>{
 let statement,values;const rows=await loadFulfillmentReallocationCandidates({query:async(sql,args)=>{statement=sql;values=args;return [[row()]];}},query,new Map([["3",5]]));assert.equal(rows.length,1);assert.deepEqual([rows[0].version,rows[0].physicalFreeQuantity,rows[0].ownReleaseCredit,rows[0].availableAfterOwnRelease,rows[0].freeQuantity],[7,0,5,5,5]);assert.match(statement,/LEFT JOIN/u);assert.match(statement,/release_quantity/u);assert.ok(statement.indexOf("release_quantity")<statement.indexOf("LIMIT"));assert.equal(values.includes(3)||values.includes("3"),true);assert.equal(values.includes(5),true);
});
test("Own release credit cannot hide corrupt physical quantities or exceed allocated stock",async()=>{
 for(const bad of [{...row(),on_hand_quantity:4},{...row(),own_release_credit:6}])await assert.rejects(()=>loadFulfillmentReallocationCandidates({query:async()=>[[bad]]},query,new Map([["3",5]])),{code:"INVENTORY_DEPENDENCY_UNAVAILABLE"});
});

import test from "node:test";
import assert from "node:assert/strict";
import {labelFulfillmentPreviewOptions} from "../../src/modules/inventory/inventoryFulfillmentAllocationPreview.js";
test("HD024 selected labels are read once with bounded actual Lot IDs and owner-local remaining days",async()=>{
 for(const [today,expiry,days]of [["2026-10-26","2026-10-26",0],["2026-10-26","2026-10-27",1],["2028-02-28","2028-03-01",2],["2026-12-31","2027-01-01",1]]){
  let calls=0;const tx={query:async(sql,ids)=>{calls++;assert.match(sql,/WHERE id IN \(\?\)/u);assert.deepEqual(ids,["11"]);return [[{id:11,sku_id:7,lot_number:"批號😀",expiry_date:expiry}]];}},result=await labelFulfillmentPreviewOptions(tx,{skuId:"7",options:[{lotId:"11",expiryDate:expiry},{lotId:"11",expiryDate:expiry}]},today);assert.equal(calls,1);assert.deepEqual(result.map(option=>[option.lotNumber,option.remainingDays]),[["批號😀",days],["批號😀",days]]);
 }
});
test("HD024 nonexpiry Lots retain their number; nonlot options use strict nulls without a query",async()=>{
 const tx={query:async()=>[[{id:11,sku_id:7,lot_number:"A",expiry_date:null}]]};assert.deepEqual(await labelFulfillmentPreviewOptions(tx,{skuId:"7",options:[{lotId:"11",expiryDate:null}]},"2026-10-26"),[{lotId:"11",expiryDate:null,lotNumber:"A",remainingDays:null}]);
 assert.deepEqual(await labelFulfillmentPreviewOptions({query(){assert.fail("Nonlot option must not query Lots");}},{skuId:"7",options:[{lotId:null,expiryDate:null}]},"2026-10-26"),[{lotId:null,expiryDate:null,lotNumber:null,remainingDays:null}]);
});
test("HD024 missing, wrong, oversized or inconsistent owner Lot facts fail closed",async()=>{
 const row={id:11,sku_id:7,lot_number:"A",expiry_date:"2026-10-27"},selected={skuId:"7",options:[{lotId:"11",expiryDate:"2026-10-27"}]};
 for(const rows of [[],[row,row],[{...row,id:12}],[{...row,sku_id:8}],[{...row,lot_number:"😀".repeat(101)}],[{...row,lot_number:""}],[{...row,expiry_date:null}]])await assert.rejects(()=>labelFulfillmentPreviewOptions({query:async()=>[rows]},selected,"2026-10-26"),{code:"INVENTORY_DEPENDENCY_UNAVAILABLE"});
 const hundred=Array.from({length:100},(_,index)=>({id:index+1,sku_id:7,lot_number:"😀".repeat(100),expiry_date:null}));let count=0;assert.equal((await labelFulfillmentPreviewOptions({query:async(_sql,ids)=>{count++;assert.equal(ids.length,100);return [hundred];}},{skuId:"7",options:hundred.map(row=>({lotId:String(row.id),expiryDate:null}))},"2026-10-26")).length,100);assert.equal(count,1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { validateSalesBackorderScope } from "../../../src/modules/sales/SalesBackorderService.js";

test("Backorder wake accepts only positive order or Warehouse/SKU scope, never priority or authority input",()=>{
 assert.deepEqual(validateSalesBackorderScope({orderId:1}),{orderId:1});assert.deepEqual(validateSalesBackorderScope({warehouseId:2,skuId:3}),{warehouseId:2,skuId:3});assert.equal(validateSalesBackorderScope(undefined,{optional:true}),null);
 for(const input of [undefined,null,[],{}, {orderId:"1"},{orderId:0},{orderId:1,priorityAt:0},{orderId:1,warehouseId:2,skuId:3},{warehouseId:2},{warehouseId:2,skuId:0},{warehouseId:2,skuId:3,actor:{userId:7}},{warehouseId:2,skuId:3,leaseOwner:"owner"}])assert.throws(()=>validateSalesBackorderScope(input),{code:"SALES_INPUT_INVALID"});
});

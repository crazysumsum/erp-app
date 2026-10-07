import assert from "node:assert/strict";
import test from "node:test";
import { SalesBackorderService, validateSalesBackorderScope } from "../../../src/modules/sales/SalesBackorderService.js";

test("Backorder wake accepts only positive order or Warehouse/SKU scope, never priority or authority input",()=>{
 assert.deepEqual(validateSalesBackorderScope({orderId:1}),{orderId:1});assert.deepEqual(validateSalesBackorderScope({warehouseId:2,skuId:3}),{warehouseId:2,skuId:3});assert.equal(validateSalesBackorderScope(undefined,{optional:true}),null);
 for(const input of [undefined,null,[],{}, {orderId:"1"},{orderId:0},{orderId:1,priorityAt:0},{orderId:1,warehouseId:2,skuId:3},{warehouseId:2},{warehouseId:2,skuId:0},{warehouseId:2,skuId:3,actor:{userId:7}},{warehouseId:2,skuId:3,leaseOwner:"owner"}])assert.throws(()=>validateSalesBackorderScope(input),{code:"SALES_INPUT_INVALID"});
});

test("TC-027 Backorder rejects invalid batch limits and missing, aborted or mismatched worker authority before SQL",async()=>{
 const signal=new AbortController().signal,database={query(){throw Error("Unauthorized SQL");},withTransaction(){throw Error("Unauthorized transaction");}},service=authorize=>new SalesBackorderService({database,itemProvider:{},inventory:{},authorizeSalesBackorder:authorize});
 for(const maxEntries of [0,-1,1.5,"1",1000000])await assert.rejects(()=>service(()=>({leaseOwner:"owner",signal})).runBatch({maxEntries}),{code:"SALES_INPUT_INVALID"});
 for(const authorize of [undefined,()=>null,()=>({signal}),()=>({leaseOwner:"owner",signal:AbortSignal.abort()})])await assert.rejects(()=>service(authorize).runBatch(),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
 await assert.rejects(()=>service(()=>({leaseOwner:"owner",signal})).runBatch({signal:new AbortController().signal}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
});

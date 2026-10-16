import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {SalesOrderService} from "../../../src/modules/sales/SalesOrderService.js";
test("TC-038 intake Draft entry validates exact source and uses caller-owned transaction without manual permission impersonation",async()=>{
 const service=new SalesOrderService({database:{withTransaction(){assert.fail("caller owns transaction");}},time:{nowMs:()=>1},customerProvider:{},itemProvider:{},businessMaster:{}}),eventId=randomUUID(),request={actor:{id:1,username:"Synthetic"},eventId,nowMs:1,number:"SO-202610-000001",document:{eventId,customerId:1,currencyCode:"HKD",fulfillmentWarehouseId:1,orderDate:"2026-10-08",lines:[{skuId:1,skuUomId:1,quantity:"1.000000",unitSellingPrice:"0.0000"}]},source:{type:"CSV",intakeOrderId:1,externalOrderKeyId:1,channelCode:"SYNTHETIC",externalOrderId:"source"}};
 const tx={query(){assert.fail("invalid source before SQL");},execute(){assert.fail("invalid source before SQL");}};
 for(const source of [{...request.source,type:"MANUAL"},{...request.source,intakeOrderId:0},{...request.source,externalOrderKeyId:0},{...request.source,channelCode:"spoof"},{...request.source,unknown:true}])await assert.rejects(async()=>service.createIntakeDraftInTransaction(tx,{...request,source}),{code:"SALES_INPUT_INVALID"});
});

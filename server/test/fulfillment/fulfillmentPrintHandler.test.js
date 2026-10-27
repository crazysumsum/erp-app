import test from "node:test";
import assert from "node:assert/strict";
import {GetFulfillmentPickListHandler} from "../../src/handlers/fulfillments/getFulfillmentPickListHandler.js";
import {FULFILLMENT_PICK_LIST_RESPONSE} from "../../src/handlers/fulfillments/fulfillmentPrintSchemas.js";
import {RequestValidator} from "../../src/framework/validation/requestValidator.js";
test("Pick List is a strict view-only GET with no user supplied stock/actor/print mode",()=>{
 const api=GetFulfillmentPickListHandler.api;assert.equal(api.path,"/api/v1/fulfillments/:id/pick-list");assert.equal(api.method,"GET");assert.deepEqual(api.authorizationPolicies,[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}]);const validate=new RequestValidator({config:{enabled:true,coerceTypes:false}}).compile(api.requestSchema,"Pick List");validate({params:{id:1},query:{},body:{}});for(const input of [{params:{id:1},query:{warehouseId:2},body:{}},{params:{id:1},query:{},body:{actorId:2}},{params:{id:0},query:{},body:{}}])assert.throws(()=>validate(input));assert.equal(FULFILLMENT_PICK_LIST_RESPONSE.properties.rows.maxItems,5000);assert.equal(FULFILLMENT_PICK_LIST_RESPONSE.properties.lines.maxItems,100);assert.doesNotMatch(JSON.stringify(FULFILLMENT_PICK_LIST_RESPONSE),/price|cost|bank|address|tax/iu);
});

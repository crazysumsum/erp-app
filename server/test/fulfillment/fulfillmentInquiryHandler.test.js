import assert from "node:assert/strict";
import test from "node:test";
import { fulfillmentListRequest,fulfillmentDetailRequest } from "../../src/handlers/fulfillments/fulfillmentInquiryRequests.js";
import { ListFulfillmentsHandler } from "../../src/handlers/fulfillments/listFulfillmentsHandler.js";
import { GetFulfillmentHandler } from "../../src/handlers/fulfillments/getFulfillmentHandler.js";
import { UpdateFulfillmentHandler } from "../../src/handlers/fulfillments/updateFulfillmentHandler.js";
test("Inquiry query conversion is bounded and isolated; detail rejects unknown child ownership fields",()=>{
 const query={pageSize:"2",hasShortPick:"false",createdFrom:"1"},result=fulfillmentListRequest({input:{query}});assert.equal(result.pageSize,2);assert.equal(result.hasShortPick,false);assert.equal(query.pageSize,"2");
 for(const query of [{unknown:"x"},{page:"2"},{hasShortPick:"maybe"},{createdFrom:"2",createdTo:"1"}])assert.throws(()=>fulfillmentListRequest({input:{query}}),{code:"FULFILLMENT_INPUT_INVALID"});
 assert.deepEqual(fulfillmentDetailRequest({input:{query:{allocationAfterId:"12",historyBeforeSequence:"3"}}}),{allocationAfterId:"12",historyBeforeSequence:3});
 for(const query of [{fulfillmentId:"2"},{historyBeforeSequence:"0"},{allocationAfterId:"01"}])assert.throws(()=>fulfillmentDetailRequest({input:{query}}),{code:"FULFILLMENT_INPUT_INVALID"});
});
test("List/detail require view; Update requires operation and fresh permission before HTTP cache replay",()=>{
 assert.equal(ListFulfillmentsHandler.api.path,"/api/v1/fulfillments");assert.equal(GetFulfillmentHandler.api.path,"/api/v1/fulfillments/:id");assert.equal(UpdateFulfillmentHandler.api.path,"/api/v1/fulfillments/:id/update");assert.equal(UpdateFulfillmentHandler.api.idempotency.enabled,true);assert.equal(typeof UpdateFulfillmentHandler.prototype.authorizeRequest,"function");
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentCandidateQuery } from "../../src/modules/fulfillment/FulfillmentAllocationService.js";
import { fulfillmentCandidateRequest,GetFulfillmentCandidatesHandler } from "../../src/handlers/fulfillments/getFulfillmentCandidatesHandler.js";
test("Candidate query binds only version/page and rejects forged owner or policy fields",()=>{
 assert.deepEqual(normalizeFulfillmentCandidateQuery({version:1}),{version:1,page:1});
 for(const value of [null,[],{version:"1"},{version:0},{version:4294967296},{version:1,page:true},{version:1,page:0},{version:1,page:1.1},{version:1,page:Number.MAX_SAFE_INTEGER},{version:1,warehouseId:"9"},{version:1,minimumRemainingDays:0},{version:1,claimId:"9"}])assert.throws(()=>normalizeFulfillmentCandidateQuery(value),{code:"FULFILLMENT_INPUT_INVALID"});
});
test("Candidate transport conversion is strict without mutating user input or accepting aliases",()=>{
 const query={version:"2",page:"3"};assert.deepEqual(fulfillmentCandidateRequest({input:{query}}),{version:2,page:3});assert.deepEqual(query,{version:"2",page:"3"});
 for(const query of [{},{version:"01"},{version:"1e1"},{version:"1",page:"+1"},{version:"1",page:"2.0"},{version:1},{version:"1",salesOrderId:"9"}])assert.throws(()=>fulfillmentCandidateRequest({input:{query}}),{code:"FULFILLMENT_INPUT_INVALID"});
 assert.equal(GetFulfillmentCandidatesHandler.api.method,"GET");assert.equal(GetFulfillmentCandidatesHandler.api.path,"/api/v1/fulfillments/:id/allocation-candidates");assert.deepEqual(GetFulfillmentCandidatesHandler.api.authorizationPolicies[0].options.permissions,["fulfillment.view","fulfillment.operation"]);
});

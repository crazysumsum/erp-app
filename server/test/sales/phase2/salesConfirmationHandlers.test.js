import assert from "node:assert/strict";
import test from "node:test";
import { ConfirmSalesOrderHandler } from "../../../src/handlers/sales-orders/confirmSalesOrderHandler.js";
import { SalesOperationLookupHandler } from "../../../src/handlers/sales-operations/salesOperationLookupHandler.js";
import { validateSalesConfirmationInput } from "../../../src/handlers/sales/salesSchemas.js";
const input={eventId:"11111111-1111-4111-8111-111111111111",version:1};
test("TC-022 confirm body preserves types and rejects authoritative/surplus fields",()=>{
 assert.deepEqual(validateSalesConfirmationInput(input),input);
 for(const invalid of [{...input,version:"1"},{...input,version:0},{...input,eventId:"bad"},{...input,leaseOwner:input.eventId},{...input,actorId:7},{...input,status:"CONFIRMED"}])
  assert.throws(()=>validateSalesConfirmationInput(invalid),{code:"SALES_INPUT_INVALID"});
});
test("TC-022 confirm and by-event handlers declare exact namespace, write authorization and bounded response contracts",()=>{
 assert.equal(ConfirmSalesOrderHandler.api.path,"/api/v1/sales-orders/:id/confirm");assert.equal(ConfirmSalesOrderHandler.api.idempotency.enabled,true);
 assert.equal(SalesOperationLookupHandler.api.path,"/api/v1/sales-operations/by-event/:eventId");
 for(const handler of [ConfirmSalesOrderHandler,SalesOperationLookupHandler])assert.deepEqual(handler.api.authorizationPolicies[0].options.permissions,["sales.view","sales.mgmt"]);
 assert.deepEqual(Object.keys(ConfirmSalesOrderHandler.api.responseSchema),["200","202"]);
 const pending=ConfirmSalesOrderHandler.api.responseSchema[202];assert.equal(pending.additionalProperties,false);assert.ok(!pending.properties.leaseOwner);
});
test("TC-022 confirm 202 sets Retry-After, retains original event, and fresh preflight precedes framework replay",async()=>{
 const h=Object.create(ConfirmSalesOrderHandler.prototype),headers={};let captured;
 h.order={authorizeWrite:async claims=>{assert.equal(claims.actorId,7);return true;}};
 h.confirmation={confirm:async value=>{captured=value;return {statusCode:202,retryAfterSeconds:2,data:{outcome:"CONFIRMING",eventId:input.eventId}};}};
 h.response=(data,options)=>({data,...options});
 const req={input:{params:{id:"1"},body:input},auth:{claims:{sub:"7",roles:[],permissions:["sales.mgmt","sales.view"]}}};
 assert.equal(await h.authorizeRequest(req),true);
 const result=await h.execute(req,{setHeader:(name,value)=>headers[name]=value});
 assert.equal(result.statusCode,202);assert.equal(headers["Retry-After"],"2");assert.deepEqual(captured.input,input);assert.equal(captured.id,1);
});

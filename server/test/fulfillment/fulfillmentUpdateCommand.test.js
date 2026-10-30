import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentUpdate } from "../../src/modules/fulfillment/fulfillmentUpdateCommand.js";
const body=()=>({eventId:"14d89307-0222-481c-b9e1-e53140b640ac",version:1,lines:[{salesOrderLineId:4,plannedBaseQuantity:"2"}]});
test("Update requires the entire positive desired line set and distinguishes omitted notes from explicit clearing",()=>{
 const input=body(),normalized=normalizeFulfillmentUpdate(input);assert.deepEqual(normalized,input);assert.ok(Object.isFrozen(normalized.lines[0]));assert.equal(normalizeFulfillmentUpdate({...input,notes:""}).notes,"");
});
test("Update refuses client-owned identities/status, partial unsafe input or empty replacement",()=>{
 for(const patch of [{version:"1"},{version:0},{lines:[]},{lines:[...body().lines,...body().lines]},{salesOrderId:1},{status:"DRAFT"},{notes:null},{eventId:"bad"},{lines:[{salesOrderLineId:4,plannedBaseQuantity:"0"}]}])assert.throws(()=>normalizeFulfillmentUpdate({...body(),...patch}),{code:"FULFILLMENT_INPUT_INVALID"});
});

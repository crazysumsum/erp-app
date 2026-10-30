import test from "node:test";
import assert from "node:assert/strict";
import {PreviewFulfillmentAllocationHandler} from "../../src/handlers/fulfillments/previewFulfillmentAllocationHandler.js";
import {RequestValidator} from "../../src/framework/validation/requestValidator.js";
import {resolveApiDefinitions} from "../../src/framework/api/apiDefinitionResolver.js";
import {normalizeApiConfig} from "../../src/framework/api/normalizeApiConfig.js";
import apiConfig from "../../config/api.js";
const body=()=>({version:1,selectedClaimId:21,page:1,selections:[{claimId:21,allocations:[{inventoryBalanceId:41,expectedBalanceVersion:3,baseQuantity:"5"}]}],lineReasons:[]});
test("HD024 readonly POST uses trusted2MiB policy and no transport idempotency or write preclaim",()=>{
 const handler=Object.create(PreviewFulfillmentAllocationHandler.prototype),[route]=resolveApiDefinitions({previewFulfillmentAllocation:handler},normalizeApiConfig(apiConfig).defaults);
 assert.equal(route.method,"POST");assert.equal(route.path,"/api/v1/fulfillments/:id/allocation-preview");assert.equal(route.jsonBodyLimitBytes,2097152);assert.equal(route.idempotency.enabled,false);assert.equal(route.idempotencyPreparation,undefined);assert.deepEqual(route.authorizationPolicies,[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}]);
 assert.equal(route.responseSchema[200].additionalProperties,false);assert.equal(route.responseSchema[200].properties.selectedClaim.properties.options.maxItems,100);assert.equal(route.responseSchema[200].properties.assessments.maxItems,100);
});
test("HD024 HTTP schema accepts editable incomplete choices and500 Unicode reasons but rejects injected authority and changed scalar types",()=>{
 const validate=new RequestValidator({config:{enabled:true,coerceTypes:false}}).compile(PreviewFulfillmentAllocationHandler.api.requestSchema,"Allocation preview"),input=()=>({params:{id:8},query:{},body:body()});validate(input());const incomplete=input();incomplete.body.selections=[];incomplete.body.lineReasons=[{fulfillmentLineId:11,reason:"😀".repeat(500)}];validate(incomplete);
 for(const mutate of [value=>value.body.eventId=crypto.randomUUID(),value=>value.body.purpose="ALLOCATE",value=>value.body.credits={},value=>value.body.selectedClaimId="21",value=>value.body.version="1",value=>value.body.page=0,value=>value.body.selections[0].allocations[0].expectedBalanceVersion=0,value=>value.body.selections[0].allocations[0].baseQuantity=5,value=>value.body.lineReasons=[{fulfillmentLineId:11,reason:"😀".repeat(501)}],value=>value.query.mode="release",value=>value.body.selections=Array.from({length:5001},()=>body().selections[0])]){const value=input();mutate(value);assert.throws(()=>validate(value));}
});

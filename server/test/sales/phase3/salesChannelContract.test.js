import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {SalesIntakeService} from "../../../src/modules/sales/SalesIntakeService.js";
import {normalizeSalesChannelV1} from "../../../src/modules/sales/salesSchemas.js";
const fixture=JSON.parse(readFileSync(new URL("./channel-v1.fixture.json",import.meta.url),"utf8"));
const identity={code:"SYNTHETIC",serviceId:"synthetic-adapter"};
test("TC-040 V1 fixture is stable, transport claims cannot choose Channel identity and decimals normalize exactly",()=>{
 const original=structuredClone(fixture),input={...fixture,channelIdentity:{code:"SPOOFED",serviceId:"untrusted"}},result=normalizeSalesChannelV1(input,identity);assert.deepEqual(fixture,original);assert.deepEqual(result.errors,[]);assert.equal(result.group.channelCode,identity.code);assert.equal(result.group.payload.lines[0].quantity,"2.000000");assert.equal(result.group.payload.lines[0].unitSellingPrice,"39.9000");assert.equal(result.group.payload.warehouseCode,"WH-01");
 const older=structuredClone(fixture);delete older.order.notes;delete older.order.lines[0].lineNote;assert.deepEqual(normalizeSalesChannelV1(older,identity).errors,[]);
});
test("TC-040 submit fails closed without server verification and malformed payload never reaches SQL",async()=>{
 const database={withTransaction:()=>assert.fail("Unauthorized SQL")},signal=new AbortController().signal;
 for(const channelVerifier of [undefined,()=>null,()=>({code:"SYNTHETIC",serviceId:"synthetic-adapter",active:false}),()=>{throw Error("secret SQL stack");}]){const service=new SalesIntakeService({database,time:{},channelVerifier,orderService:{},confirmationService:{}});assert.deepEqual(await service.submit(fixture,{context:{authenticated:true,serviceId:"synthetic-adapter"},signal}),{outcome:"TECHNICAL_RETRY",requestId:fixture.requestId,retryAfterSeconds:2});const rejected=await service.submit({...fixture,authenticated:true},{context:{authenticated:true},signal});assert.equal(rejected.outcome,"VALIDATION_FAILED");assert.equal(rejected.intakeOrderId,null);assert.doesNotMatch(JSON.stringify(rejected),/secret|SQL|stack/);}
});
test("TC-040 V1 rejects unknown/version/address/auth fields, noncanonical identifiers, unsafe decimals and dates without raw payload diagnostics",()=>{
 const invalid=[v=>v.schemaVersion="2.0",v=>v.authenticated=true,v=>v.order.shippingAddress="private",v=>v.order.customerId="31",v=>v.order.lines[0].skuId=1,v=>v.order.lines[0].quantity="1e3",v=>v.order.lines[0].unitSellingPrice=39.9,v=>v.order.orderDate="2026-02-30",v=>v.order.requestedDeliveryDate="2026-01-01",v=>v.order.lines=[],v=>v.idempotencyKey="\u0000secret",v=>v.order.lines=Array.from({length:101},()=>v.order.lines[0])];
 for(const mutate of invalid){const input=structuredClone(fixture);mutate(input);const {errors}=normalizeSalesChannelV1(input,identity);assert.ok(errors.length>0);assert.ok(errors.length<=200);for(const error of errors)assert.deepEqual(Object.keys(error).sort(),["code","field"]);assert.doesNotMatch(JSON.stringify(errors),/private|secret|39\.9|SQL|stack/);}
});
test("TC-040 raw V1 may exceed128KiB before owner mapping; the limit applies to the complete stored normalized payload",()=>{
 const input=structuredClone(fixture);input.order.lines=Array.from({length:100},(_,index)=>({...input.order.lines[0],skuCode:"品".repeat(185)+index,salesUomCode:"單".repeat(100),lineNote:"註".repeat(400)}));assert.ok(Buffer.byteLength(JSON.stringify(input))>131072);assert.deepEqual(normalizeSalesChannelV1(input,identity).errors,[]);
});
test("TC-040 same-key conflict still requires final fresh SUBMIT verification and cannot self-certify stored service identity",async()=>{
 let calls=0;const context=Object.freeze({transport:"synthetic"}),database={withTransaction:work=>work({query:async()=>[[{id:7,source_order_key:fixture.idempotencyKey,payload_hash:"0".repeat(64)}]]})},service=new SalesIntakeService({database,time:{},orderService:{},confirmationService:{},channelVerifier:async(value,{purpose})=>{assert.equal(purpose,"SUBMIT");if(value!==context||++calls===3)return null;return {...identity,active:true};}});
 assert.deepEqual(await service.submit(fixture,{context}),{outcome:"TECHNICAL_RETRY",requestId:fixture.requestId,retryAfterSeconds:2});assert.equal(calls,3);assert.equal((await service.submit(fixture,{context:{...identity,authenticated:true}})).outcome,"TECHNICAL_RETRY");
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShipmentDraft, normalizeShipmentCancel } from "../../src/modules/fulfillment/shipmentDraftCommand.js";
const body=()=>({eventId:"14d89307-0222-481c-b9e1-e53140b640ac",shippingAddressId:501,shippingAddressVersion:7});
const invalid={code:"FULFILLMENT_INPUT_INVALID"};
test("Shipment Draft canonical complete form preserves selected versions and approved optional weight",()=>{
 const input={...body(),shippingContactId:601,shippingContactVersion:3,totalWeight:"1.250000",weightUom:"KG"},result=normalizeShipmentDraft(input);
 assert.deepEqual(result,{...input,carrierName:"",trackingNumber:"",packageCount:null,totalWeight:"1.25",notes:""});assert.ok(Object.isFrozen(result));assert.equal(input.totalWeight,"1.250000");
 const absent=normalizeShipmentDraft(body());assert.equal(absent.shippingContactId,null);assert.equal(absent.shippingContactVersion,null);assert.equal(absent.totalWeight,null);assert.equal(absent.weightUom,"");
 assert.equal(normalizeShipmentDraft({...body(),version:2},{update:true}).version,2);
});
test("Shipment Draft refuses derived fields, incomplete pairs, unsafe identities, versions and logistics",()=>{
 for(const patch of [{version:1},{status:"SHIPPED"},{snapshot:{}},{fulfillmentId:2},{skuId:3},{shippingAddressId:"501"},{shippingAddressVersion:4294967296},{shippingContactId:601},{shippingContactVersion:2},{shippingContactId:null,shippingContactVersion:2},{packageCount:0},{packageCount:4294967296},{packageCount:"1"},{totalWeight:1.25,weightUom:"KG"},{totalWeight:"1",weightUom:"LB"},{carrierName:"x".repeat(191)},{trackingNumber:{}},{carrierName:null},{notes:null},{notes:"x".repeat(2001)}])assert.throws(()=>normalizeShipmentDraft({...body(),...patch}),invalid);
 for(const input of [null,[],Object.create(body()),{...body(),eventId:"bad"}])assert.throws(()=>normalizeShipmentDraft(input),invalid);
 for(const version of [undefined,0,"1",4294967296])assert.throws(()=>normalizeShipmentDraft({...body(),version},{update:true}),invalid);
});
test("Draft cancel accepts bounded optional reason and only the original event/version contract",()=>{
 const value=normalizeShipmentCancel({eventId:body().eventId,version:1});assert.deepEqual(value,{eventId:body().eventId,version:1,reason:""});assert.ok(Object.isFrozen(value));
 for(const patch of [{status:"CANCELLED"},{version:0},{reason:"x".repeat(501)},{reason:2},{reason:null}])assert.throws(()=>normalizeShipmentCancel({eventId:body().eventId,version:1,...patch}),invalid);
});

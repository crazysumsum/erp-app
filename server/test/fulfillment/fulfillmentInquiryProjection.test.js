import assert from "node:assert/strict";
import test from "node:test";
import { fulfillmentAllowedActions } from "../../src/modules/fulfillment/FulfillmentInquiryService.js";
test("Allowed P1 actions require fresh operation permission and status; Shipment work blocks mutations",()=>{
  assert.deepEqual(fulfillmentAllowedActions({status:"DRAFT",active_shipment_id:null,allocated_at:null},["fulfillment.view"],false),[]);
  assert.deepEqual(fulfillmentAllowedActions({status:"DRAFT",active_shipment_id:null,allocated_at:null},["fulfillment.operation"],false),["update","allocate","cancel"]);
  assert.deepEqual(fulfillmentAllowedActions({status:"PICKING",active_shipment_id:null,allocated_at:1},["fulfillment.operation"],false),["reallocate","pickConfirm","cancel","printPickList"]);
  assert.deepEqual(fulfillmentAllowedActions({status:"PICKED",active_shipment_id:2,allocated_at:1},["fulfillment.operation"],false),["printPickList"]);
  assert.deepEqual(fulfillmentAllowedActions({status:"DRAFT",active_shipment_id:null,allocated_at:null},["fulfillment.operation"],true),[]);
});

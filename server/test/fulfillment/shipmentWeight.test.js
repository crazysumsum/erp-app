import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShipmentWeight } from "../../src/modules/fulfillment/shipmentWeight.js";
import { fulfillmentOperationHash } from "../../src/modules/fulfillment/fulfillmentOperationHash.js";
const invalid = { code: "FULFILLMENT_INPUT_INVALID" };
test("HD025A preserves exact decimal boundaries and canonicalizes only validated fraction zeros", () => {
  assert.deepEqual(normalizeShipmentWeight(null,""), {totalWeight:null,weightUom:""});
  for (const unit of ["KG","G"]) {
    for (const [value,expected] of [["0.000001","0.000001"],["99999999999999.999999","99999999999999.999999"],["1.250000","1.25"],["1.000000","1"],["90071992547409.123456","90071992547409.123456"]]) {
      const output=normalizeShipmentWeight(value,unit);
      assert.deepEqual(output,{totalWeight:expected,weightUom:unit});assert.ok(Object.isFrozen(output));
    }
  }
});
test("HD025A rejects coercion, rounding, invalid null pairs and unapproved units", () => {
  for(const value of [undefined,0,1,1.25,Number.NaN,Number.POSITIVE_INFINITY,{},[],"","0","0.000000","-1","+1","01","00.1",".1","1.","1e2"," 1","1 ","1\n","1.0000000","0.0000001","100000000000000","999999999999999.1"])assert.throws(()=>normalizeShipmentWeight(value,"KG"),invalid);
  for(const unit of ["","kg","g","LB","OZ",null,undefined,{},"KG "])assert.throws(()=>normalizeShipmentWeight("1",unit),invalid);
  for(const unit of ["KG","G",null,undefined])assert.throws(()=>normalizeShipmentWeight(null,unit),invalid);
});
test("HD025A keeps original operation hash strict while equivalent DB readback has identical intent", () => {
  const hash=(value,unit)=>fulfillmentOperationHash({operationType:"SHIPMENT_CREATE",target:{type:"SHIPMENT",id:null},payload:{...normalizeShipmentWeight(value,unit)}});
  assert.equal(hash("1.250000","KG"),hash("1.25","KG"));
  assert.notEqual(hash("1.25","KG"),hash("1.25","G"));
  assert.notEqual(hash("1.25","KG"),hash("1.26","KG"));
  assert.throws(()=>fulfillmentOperationHash({operationType:"SHIPMENT_CREATE",target:{type:"SHIPMENT",id:null},payload:{totalWeight:1.25}}),TypeError);
});

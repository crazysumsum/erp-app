import assert from "node:assert/strict";
import test from "node:test";
import { assertFulfillmentTransition, assertShipmentTransition, assertReversalTransition } from "../../src/modules/fulfillment/fulfillmentStateMachines.js";
import { assertFulfillmentQuantities, assertClaimQuantities } from "../../src/modules/fulfillment/fulfillmentQuantityMath.js";
import { fulfillmentInteger } from "../../src/modules/fulfillment/fulfillmentValidation.js";

test("every state transition is explicitly allowed or rejected, including terminal self transitions", () => {
  for (const [check, graph] of [
    [assertFulfillmentTransition, { DRAFT:["PICKING","CANCELLED"], PICKING:["PICKED","CANCELLED"], PICKED:["SHIPPED","CANCELLED"], SHIPPED:["REVERSED"], CANCELLED:[], REVERSED:[] }],
    [assertShipmentTransition, { DRAFT:["SHIPPING","CANCELLED"], SHIPPING:["SHIPPED","DRAFT"], SHIPPED:["REVERSING"], REVERSING:["REVERSED","SHIPPED"], CANCELLED:[], REVERSED:[] }],
    [assertReversalTransition, { REVERSING:["REVERSED","FAILED"], REVERSED:[], FAILED:[] }]
  ]) {
    for (const from of Object.keys(graph)) for (const to of Object.keys(graph)) {
      if (graph[from].includes(to)) assert.equal(check(from,to), true);
      else assert.throws(() => check(from,to));
    }
    assert.throws(() => check("UNKNOWN", "DRAFT"));
  }
});

const line = changes => ({ planned:"10",allocated:"0",released:"0",picked:"0",short:"0",shipped:"0",reversed:"0",...changes });

test("state-conditioned conservation preserves reallocation and fully short-picked lines", () => {
  assert.equal(assertFulfillmentQuantities("DRAFT", [line()]), true);
  assert.equal(assertFulfillmentQuantities("PICKING", [line({allocated:"25",released:"15"})]), true);
  const picked = line({allocated:"25",released:"19",picked:"6",short:"4"});
  const short = line({allocated:"10",released:"10",short:"10"});
  assert.equal(assertFulfillmentQuantities("PICKED", [picked,short]), true);
  assert.equal(assertFulfillmentQuantities("SHIPPED", [{...picked,shipped:"6"},short]), true);
  assert.equal(assertFulfillmentQuantities("REVERSED", [{...picked,shipped:"6",reversed:"6"},short]), true);
  for (const original of [line(),line({allocated:"25",released:"15"}),picked]) {
    assert.equal(assertFulfillmentQuantities("CANCELLED", [{...original,released:original.allocated}]), true);
  }
});

test("zero picks, partial shipment/reversal, over-allocation facts and broken state equations fail closed", () => {
  for (const [state, input] of [
    ["PICKED",line({allocated:"10",released:"10",short:"10"})],
    ["DRAFT",line({allocated:"1"})], ["PICKING",line({allocated:"11"})],
    ["PICKED",line({allocated:"10",picked:"6",short:"3",released:"4"})],
    ["SHIPPED",line({allocated:"10",picked:"6",short:"4",released:"4",shipped:"5"})],
    ["REVERSED",line({allocated:"10",picked:"6",short:"4",released:"4",shipped:"6",reversed:"5"})],
    ["CANCELLED",line({allocated:"10",released:"9"})],
    ["CANCELLED",line({picked:"11"})], ["CANCELLED",line({planned:"0"})],
    ["UNKNOWN",line()]
  ]) assert.throws(() => assertFulfillmentQuantities(state,[input]));
  assert.throws(() => assertFulfillmentQuantities("DRAFT",[]));
  for (const lines of [
    [line({ allocated:"10", released:"10", picked:"10", short:"10" })],
    [line({ picked:"6", short:"4" })],
    [line(), line({ allocated:"10", released:"10" })],
    [line({ allocated:"10", released:"10", short:"10" })],
    [line({ allocated:"10", released:"10", picked:"6", short:"4" }), line({ allocated:"10", released:"10" })]
  ]) assert.throws(() => assertFulfillmentQuantities("CANCELLED", lines));
  for (const status of ["PICKED", "SHIPPED", "REVERSED"]) {
    const positive = line({ allocated:"6", picked:"6", short:"4", shipped:status === "PICKED" ? "0" : "6", reversed:status === "REVERSED" ? "6" : "0" });
    assert.throws(() => assertFulfillmentQuantities(status, [positive]));
    const legal = { ...positive, allocated:"10", released:"4" };
    assert.throws(() => assertFulfillmentQuantities(status, [legal, line({ short:"10" })]));
  }
});

test("claim conservation keeps reversal within immutable consumed history", () => {
  assert.equal(assertClaimQuantities({original:"10",active:"0",released:"4",consumed:"6",reversed:"6"}), true);
  for (const changes of [{active:"1"},{reversed:"7"},{consumed:"5"}]) {
    assert.throws(() => assertClaimQuantities({original:"10",active:"0",released:"4",consumed:"6",reversed:"0",...changes}));
  }
});

test("wire quantities never coerce numbers, signs, fractions or unsafe integers", () => {
  assert.equal(fulfillmentInteger(String(Number.MAX_SAFE_INTEGER)), BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(fulfillmentInteger("0", { positive:false }), 0n);
  for (const value of [1,null,"","01","-1","+1","1.0"," 1",String(BigInt(Number.MAX_SAFE_INTEGER)+1n)]) assert.throws(() => fulfillmentInteger(value));
});

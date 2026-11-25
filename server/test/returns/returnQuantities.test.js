import assert from "node:assert/strict";
import test from "node:test";
import { assertReturnQuantities } from "../../src/modules/returns/returnQuantities.js";

const source = new Map([["4", { quantity: "10", reversed: "3" }], ["9", { quantity: "9007199254740991", reversed: "0" }]]);
const alreadyPosted = new Map([["4", "2"], ["9", "0"]]);
const line = (sourceDetailId, baseQuantity) => ({ sourceDetailId, baseQuantity });

test("a return may use the remaining quantity across multiple bins", () => {
  assert.doesNotThrow(() => assertReturnQuantities([line("4", "2"), line("4", "3")], source, alreadyPosted));
});

test("the combined request cannot exceed the remaining quantity after returns and reversals", () => {
  assert.throws(() => assertReturnQuantities([line("4", "3"), line("4", "3")], source, alreadyPosted),
    { code: "RETURN_QUANTITY_EXCEEDED" });
  assert.throws(() => assertReturnQuantities([line("9", "9007199254740991"), line("9", "1")], source, alreadyPosted),
    { code: "RETURN_QUANTITY_EXCEEDED" });
});

test("a return rejects missing or unrelated source facts", () => {
  assert.throws(() => assertReturnQuantities([line("10", "1")], source, alreadyPosted), { code: "RETURN_SOURCE_CONFLICT" });
  assert.throws(() => assertReturnQuantities([line("4", "1")], source, new Map()), { code: "RETURN_SOURCE_CONFLICT" });
});

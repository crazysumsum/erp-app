import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSalesPayload, salesPayloadHash } from "../../src/modules/sales/salesCanonicalHash.js";

test("TC-007 canonical keys are stable while decimal strings, arrays and exact Unicode remain unchanged", () => {
  const first = { eventId: "synthetic-event", lines: [{ quantity: "1.000000", price: "2.0000" }], note: "漢字" };
  const second = { note: "漢字", lines: [{ price: "2.0000", quantity: "1.000000" }], eventId: "synthetic-event" };
  assert.equal(salesPayloadHash(first), salesPayloadHash(second));
  assert.notEqual(salesPayloadHash(first), salesPayloadHash({ ...first, note: "different" }));
  assert.notEqual(salesPayloadHash({ quantity: "1" }), salesPayloadHash({ quantity: "1.000000" }));
  assert.notEqual(salesPayloadHash([1, 2]), salesPayloadHash([2, 1]));
  assert.notEqual(salesPayloadHash("é"), salesPayloadHash("é"));
  assert.deepEqual(JSON.parse(canonicalSalesPayload(first)), first);
  assert.match(salesPayloadHash(first), /^[a-f0-9]{64}$/);
  const cyclic = {}; cyclic.self = cyclic;
  for (const invalid of [undefined, NaN, Infinity, 1n, new Date(), cyclic, { value: undefined }, Array(2)]) assert.throws(() => canonicalSalesPayload(invalid));
});

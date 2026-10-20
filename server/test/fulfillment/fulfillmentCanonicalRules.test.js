import assert from "node:assert/strict";
import test from "node:test";
import { fulfillmentOperationHash } from "../../src/modules/fulfillment/fulfillmentOperationHash.js";
import { sameFulfillmentSelection } from "../../src/modules/fulfillment/fulfillmentPickSelection.js";

const command = payload => ({ operationType: "ALLOCATE", target: { fulfillmentId: "1" }, payload });
test("canonical operation hash sorts keys, normalizes only decimal identities/quantities, and hashes UTF-8", () => {
  const a = command({ plannedBaseQuantity: "0010", skuCode: "001", reason: "先出貨", lines: [{ skuId: "02", baseQuantity: "5" }] });
  const b = command({ lines: [{ baseQuantity: 5, skuId: 2 }], reason: "先出貨", skuCode: "001", plannedBaseQuantity: 10 });
  assert.match(fulfillmentOperationHash(a), /^[a-f0-9]{64}$/);
  assert.equal(fulfillmentOperationHash(a), fulfillmentOperationHash(b));
  for (const changed of [command({ ...a.payload, skuCode: "1" }), command({ ...a.payload, reason: "後出貨" }),
    command({ ...a.payload, plannedBaseQuantity: "11" }), { ...a, operationType: "REALLOCATE" },
    { ...a, target: { fulfillmentId: "2" } }]) assert.notEqual(fulfillmentOperationHash(a), fulfillmentOperationHash(changed));
  assert.notEqual(fulfillmentOperationHash(command({ lines: [1,2] })), fulfillmentOperationHash(command({ lines: [2,1] })));
});

test("canonical hashing rejects unsupported values instead of dropping intent", () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [undefined, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER+1, 1n, new Date(), cyclic, () => {}]) {
    assert.throws(() => fulfillmentOperationHash(command({ value })));
  }
  for (const value of ["-1", "+1", "1.5", "", String(BigInt(Number.MAX_SAFE_INTEGER)+1n)]) {
    assert.throws(() => fulfillmentOperationHash(command({ baseQuantity: value })));
  }
  assert.throws(() => fulfillmentOperationHash({ ...command({}), operationType: "UNKNOWN" }));
  assert.doesNotThrow(() => fulfillmentOperationHash(command({ optional: null, enabled: true, baseQuantity: "0" })));
  assert.doesNotThrow(() => fulfillmentOperationHash(command({ shippingContactId: null })));
  assert.notEqual(fulfillmentOperationHash(command({ shippingContactId: null })), fulfillmentOperationHash(command({ shippingContactId: "1" })));
  for (const field of ["shippingAddressId", "skuId", "baseQuantity"]) assert.throws(() => fulfillmentOperationHash(command({ [field]: null })));
});

test("selection equality consumes owner recommendations without ranking or inferring permission", () => {
  const owner = [{ balanceId: "2", quantity: "4" }, { balanceId: "10", quantity: "6" }];
  assert.equal(sameFulfillmentSelection([...owner].reverse(), owner), true);
  assert.equal(sameFulfillmentSelection([{ balanceId: "2", quantity: "5" }, { balanceId: "10", quantity: "5" }], owner), false);
  assert.equal(sameFulfillmentSelection(owner.slice(0,1), owner), false);
  assert.equal(sameFulfillmentSelection([], []), true);
  for (const bad of [[...owner, owner[0]], [{ balanceId: "2", quantity: "0" }], [{ balanceId: 2, quantity: "4" }], null]) {
    assert.throws(() => sameFulfillmentSelection(bad, owner));
  }
});

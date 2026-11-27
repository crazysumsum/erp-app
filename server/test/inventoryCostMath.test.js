import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInventoryCost, formatInventoryCost, receiptCost, originalCostShare, inboundCost, outboundCost
} from "../src/modules/inventory/inventoryCostMath.js";

test("Inventory cost parses fixed-decimal values without Number or silent rounding", () => {
  assert.equal(parseInventoryCost("999999999999999.9999"), 9999999999999999999n);
  assert.equal(parseInventoryCost("-0.0001"), -1n);
  assert.equal(formatInventoryCost(-1n), "-0.0001");
  assert.equal(formatInventoryCost(parseInventoryCost("001.02")), "1.0200");
  assert.equal(formatInventoryCost(0n), "0.0000");
  for (const invalid of [0.1, "1e2", " 1", "1.12345", "1000000000000000", "+1", "", ".5"]) {
    assert.throws(() => parseInventoryCost(invalid), RangeError);
  }
});

test("Inventory receipt converts the locked purchase unit price and rounds per receipt line", () => {
  assert.equal(receiptCost(3n, 10001n, 2n), 15002n);
  assert.equal(receiptCost(1n, 1n, 2n), 1n);
  assert.equal(receiptCost(9n, 0n, 1n), 0n);
  assert.throws(() => receiptCost(3n, 10001n, 0n), RangeError);
  assert.throws(() => receiptCost(2n, 9999999999999999999n, 1n), RangeError);
});

test("Inventory original-value shares are cumulative and exactly recover rounding remainders", () => {
  const shares = [0n, 1n, 2n, 3n].map(prior => originalCostShare(2n, 4n, prior, 1n));
  assert.deepEqual(shares, [1n, 0n, 1n, 0n]);
  assert.equal(shares.reduce((sum, value) => sum + value, 0n), 2n);
  assert.equal(originalCostShare(27n, 7n, 0n, 7n), 27n);
  assert.throws(() => originalCostShare(2n, 4n, 3n, 2n), RangeError);
});

test("Inventory inbound movement adds accepted HKD value and preserves exact integer quantity", () => {
  assert.deepEqual(inboundCost({ quantity: 5n, value: 50005n }, 2n, 30001n), {
    quantity: 7n, value: 80006n, quantityDelta: 2n, valueDelta: 30001n
  });
  assert.deepEqual(inboundCost({ quantity: 0n, value: 0n }, 2n, 0n), {
    quantity: 2n, value: 0n, quantityDelta: 2n, valueDelta: 0n
  });
});

test("Inventory ordinary issue uses pooled value and full depletion takes every remainder", () => {
  assert.deepEqual(outboundCost({ quantity: 3n, value: 2n }, 1n), {
    quantity: 2n, value: 1n, quantityDelta: -1n, valueDelta: -1n
  });
  assert.deepEqual(outboundCost({ quantity: 2n, value: 1n }, 2n), {
    quantity: 0n, value: 0n, quantityDelta: -2n, valueDelta: -1n
  });
});

test("Inventory purchase and positive-adjustment reversals cap actual amount but retain the original share", () => {
  assert.deepEqual(outboundCost({ quantity: 10n, value: 190000n }, 5n, 500000n), {
    quantity: 5n, value: 0n, quantityDelta: -5n, valueDelta: -190000n
  });
  assert.deepEqual(outboundCost({ quantity: 10n, value: 190000n }, 10n, 50000n), {
    quantity: 0n, value: 0n, quantityDelta: -10n, valueDelta: -190000n
  });
  assert.equal(outboundCost({ quantity: 10n, value: 190000n }, 5n, 0n).valueDelta, 0n);
});

test("Inventory cost rejects amount overflow, insufficient stock and inconsistent empty pools", () => {
  assert.throws(() => outboundCost({ quantity: 2n, value: 1000n }, 3n), RangeError);
  assert.throws(() => inboundCost({ quantity: 0n, value: 1n }, 1n, 0n), RangeError);
  assert.throws(() => inboundCost({ quantity: 2n, value: 9999999999999999999n }, 1n, 1n), RangeError);
  assert.throws(() => inboundCost({ quantity: 18446744073709551615n, value: 0n }, 1n, 0n), RangeError);
  assert.throws(() => outboundCost({ quantity: 2n, value: 0n }, 0n), RangeError);
});

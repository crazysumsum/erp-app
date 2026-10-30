/**
 * TASK-009／TC-002：數量及 UOM 換算純算法（設計 §2.8、§10.2；BR-009、BR-010）。
 * 全部用 decimal string 入、BigInt 計，唔經 Number 乘除。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeQuantity, parseQuantity, toBaseQuantity } from "../../src/modules/purchasing/quantityMath.js";

const code = (expected) => (error) => error.code === expected && error.statusCode === 400;

test("TC-002 quantity is a positive decimal string of at most 6 places and 14 integer digits", () => {
  assert.equal(normalizeQuantity("3"), "3.000000");
  assert.equal(normalizeQuantity("0.5"), "0.500000");
  assert.equal(normalizeQuantity("0.000001"), "0.000001");
  assert.equal(normalizeQuantity("99999999999999.999999"), "99999999999999.999999");
  assert.equal(normalizeQuantity("0012.50"), "12.500000");
  assert.equal(parseQuantity("1.5"), 1_500_000n);

  for (const bad of ["0", "0.000000", "-1", "-0.5", "1.0000001", "100000000000000", "1e2", "1E2", "+1", ".5", "1.",
    " 1", "1 ", "", "1,000", "1_000", "0x10", "١", "NaN", "Infinity", "0".repeat(65) + "1"]) {
    assert.throws(() => parseQuantity(bad), code("PURCHASING_QUANTITY_INVALID"), JSON.stringify(bad));
  }
  // 數字唔准入嚟：0.1 呢類值喺 Number 已經唔準。
  for (const bad of [3, 0.5, 3n, null, undefined, {}, ["3"]]) {
    assert.throws(() => parseQuantity(bad), code("PURCHASING_QUANTITY_INVALID"));
  }
});

test("TC-002 a Purchase UOM quantity converts to an exact positive Base integer", () => {
  assert.equal(toBaseQuantity("3", 24), 72);
  assert.equal(toBaseQuantity("0.5", 24), 12);
  assert.equal(toBaseQuantity("0.000001", 1_000_000), 1);
  assert.equal(toBaseQuantity("12.5", 2), 25);

  // 換算後唔係整數 Base：BOX 唔可以收 7.2 EA。
  for (const [quantity, factor] of [["0.3", 24], ["1.000001", 1], ["0.5", 3], ["0.000001", 999_999]]) {
    assert.throws(() => toBaseQuantity(quantity, factor), code("UOM_CONVERSION_INVALID"), `${quantity}×${factor}`);
  }
  for (const factor of [0, -1, 1_000_001, 1.5, Number.NaN, Infinity, "24", 24n, null, undefined]) {
    assert.throws(() => toBaseQuantity("1", factor), code("UOM_CONVERSION_INVALID"), String(factor));
  }
  assert.throws(() => toBaseQuantity("0", 24), code("PURCHASING_QUANTITY_INVALID"));
});

test("TC-002 Base quantity stays within MAX_SAFE_INTEGER, computed in BigInt", () => {
  // 9007199254.740991 × 1,000,000 正好係 MAX_SAFE_INTEGER；Number 乘法喺呢度會失準。
  const atLimit = toBaseQuantity("9007199254.740991", 1_000_000);
  assert.equal(atLimit, Number.MAX_SAFE_INTEGER);
  assert.ok(Number.isSafeInteger(atLimit));
  assert.throws(() => toBaseQuantity("9007199254.740992", 1_000_000), code("PURCHASING_QUANTITY_INVALID"));
  assert.throws(() => toBaseQuantity("99999999999999.999999", 1_000_000), code("PURCHASING_QUANTITY_INVALID"));
});

test("TC-002 the configured Base quantity cap is enforced and may only lower the ceiling", () => {
  assert.equal(toBaseQuantity("4", 24, { maxBaseQuantity: 96 }), 96);
  assert.throws(() => toBaseQuantity("4.5", 24, { maxBaseQuantity: 100 }), code("PURCHASING_QUANTITY_INVALID"));
  for (const cap of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "100", 100n, null]) {
    assert.throws(() => toBaseQuantity("1", 1, { maxBaseQuantity: cap }), TypeError, String(cap));
  }
});

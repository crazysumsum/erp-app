/**
 * TASK-009／TC-002：金額純算法（設計 §2.8、§10.2；FR-PO-010～011、BR-011～012）。
 * Line Amount = roundHalfUp(orderedQuantity × unitPrice, Currency 小數位)，逐行 round 後先加總。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { documentTotal, formatAmount, lineAmount, normalizeUnitPrice } from "../../src/modules/purchasing/moneyMath.js";

const code = (expected, field) => (error) => error.code === expected && error.statusCode === 400 &&
  (field === undefined || error.publicDetails?.field === field);

test("TC-002 Unit Price is a non-negative decimal string of at most 4 places", () => {
  assert.equal(normalizeUnitPrice("125.5"), "125.5000");
  assert.equal(normalizeUnitPrice("0"), "0.0000");
  assert.equal(normalizeUnitPrice("0.0001"), "0.0001");
  assert.equal(normalizeUnitPrice("007.5"), "7.5000");
  assert.equal(normalizeUnitPrice("999999999999999.9999"), "999999999999999.9999");

  for (const bad of ["-1", "-0.0001", "1.23456", "1000000000000000", "1000000000000000.0000", "1e3", "1E3", "+1",
    ".5", "1.", " 1", "1 ", "", "1,000", "0x10", "NaN", "0".repeat(65) + "1"]) {
    assert.throws(() => normalizeUnitPrice(bad), code("UNIT_PRICE_INVALID"), JSON.stringify(bad));
  }
  for (const bad of [125.5, 0, 1n, null, undefined]) assert.throws(() => normalizeUnitPrice(bad), code("UNIT_PRICE_INVALID"));
});

test("TC-002 Line Amount rounds HALF_UP at the Currency scale", () => {
  assert.equal(lineAmount("1", "1.004", 2), "1.00");
  assert.equal(lineAmount("1", "1.005", 2), "1.01");
  assert.equal(lineAmount("1", "1.006", 2), "1.01");
  assert.equal(lineAmount("1", "1.0005", 3), "1.001");
  assert.equal(lineAmount("0.5", "0.0001", 4), "0.0001");
  assert.equal(lineAmount("0.000001", "0.0001", 4), "0.0000");

  // HKD 2 位、JPY 0 位：同一張單唔同 Currency 結果唔同。
  assert.equal(lineAmount("3", "125.5", 2), "376.50");
  assert.equal(lineAmount("3", "125.5", 0), "377");
  assert.equal(lineAmount("3", "125.4999", 0), "376");
  assert.equal(lineAmount("2", "0", 2), "0.00");
});

test("TC-002 Line Amount does not inherit binary float error", () => {
  // Number：1.005 * 100 = 100.49999999999999，Math.round 會得 1.00。
  assert.equal(lineAmount("1.005", "1", 2), "1.01");
  // Number：0.1 * 3 = 0.30000000000000004。
  assert.equal(lineAmount("3", "0.1", 2), "0.30");
  assert.equal(lineAmount("0.1", "0.2", 4), "0.0200");
});

test("TC-002 PO Total is the sum of already-rounded lines, not the rounded sum", () => {
  const lines = [lineAmount("1", "1.005", 2), lineAmount("1", "1.005", 2)];
  assert.deepEqual(lines, ["1.01", "1.01"]);
  assert.equal(documentTotal(lines, 2), "2.02"); // 先總後 round 會係 2.010 → 2.01
  assert.equal(documentTotal([lineAmount("3", "125.5", 0), lineAmount("1", "0.4", 0)], 0), "377");
  assert.equal(documentTotal([], 2), "0.00");
});

test("TC-002 large products stay exact and an amount beyond DECIMAL(25,4) is rejected", () => {
  assert.equal(lineAmount("99999999999999.999999", "0.0001", 2), "10000000000.00");
  // 9.999…e20：Number 會失去最後幾位。
  assert.equal(lineAmount("1000000", "999999999999999.9999", 2), "999999999999999999900.00");
  assert.equal(lineAmount("99999.999999", "999999999999999.9999", 4), "99999999998999999990.0000");
  assert.throws(() => lineAmount("1000001", "999999999999999.9999", 2), code("PURCHASING_INPUT_INVALID", "lineAmount"));
  assert.throws(() => lineAmount("99999999999999.999999", "999999999999999.9999", 0),
    code("PURCHASING_INPUT_INVALID", "lineAmount"));

  const nearMax = lineAmount("1000000", "999999999999999.9999", 2);
  assert.equal(documentTotal([nearMax], 2), nearMax);
  assert.throws(() => documentTotal([nearMax, nearMax], 2), code("PURCHASING_INPUT_INVALID", "totalAmount"));
});

test("TC-002 inputs are validated before any arithmetic", () => {
  assert.throws(() => lineAmount("0", "1", 2), code("PURCHASING_QUANTITY_INVALID"));
  assert.throws(() => lineAmount("1.0000001", "1", 2), code("PURCHASING_QUANTITY_INVALID"));
  assert.throws(() => lineAmount("1", "-1", 2), code("UNIT_PRICE_INVALID"));
  assert.throws(() => lineAmount("1", "1.00001", 2), code("UNIT_PRICE_INVALID"));

  // Currency 小數位嚟自已驗證嘅 provider 快照（TASK-008 釘住 0～4）；超出即係資料錯誤，唔係用戶輸入。
  for (const places of [-1, 5, 2.5, "2", null, undefined, Number.NaN]) {
    assert.throws(() => lineAmount("1", "1", places), TypeError, String(places));
    assert.throws(() => documentTotal(["1.00"], places), TypeError, String(places));
    assert.throws(() => formatAmount(1n, places), TypeError, String(places));
  }
  // documentTotal 只收 lineAmount 嘅輸出：scale 唔啱即係 server 自己嘅 bug。
  for (const bad of ["1.0", "1.001", "1", "-1.00", "1e2", 1.5, null]) {
    assert.throws(() => documentTotal([bad], 2), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => documentTotal("1.00", 2), TypeError);
});

test("TC-002 one formatter emits every amount at the fixed Currency scale", () => {
  // API、CSV 同 print 用同一個 formatter（§2.8）。
  assert.equal(formatAmount(0n, 0), "0");
  assert.equal(formatAmount(0n, 2), "0.00");
  assert.equal(formatAmount(5n, 2), "0.05");
  assert.equal(formatAmount(1_234_567n, 4), "123.4567");
  assert.equal(formatAmount(110n, 2), "1.10");
  assert.equal(lineAmount("1", "1.1", 2), formatAmount(110n, 2));
  for (const bad of [-1n, 1, "1", null]) assert.throws(() => formatAmount(bad, 2), TypeError, String(bad));
});

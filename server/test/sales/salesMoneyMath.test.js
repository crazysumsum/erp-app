import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMoney, lineAmount, documentTotal, displayMoney } from "../../src/modules/sales/salesMoneyMath.js";

test("TC-007 exact money normalization, rounding, totals and DECIMAL overflow", () => {
  assert.equal(normalizeMoney("0001.2"), "1.2000");
  assert.equal(normalizeMoney("0"), "0.0000");
  assert.equal(lineAmount("0.000001", "50"), "0.0001");
  assert.equal(lineAmount("0.000001", "49.9999"), "0.0000");
  assert.equal(lineAmount("3", "0.1"), "0.3000");
  assert.equal(documentTotal(["0.1000", "0.2000"]), "0.3000");
  assert.equal(normalizeMoney("999999999999999.9999"), "999999999999999.9999");
  for (const value of [1, "-1", "1e3", "NaN", "Infinity", "1,000", "1.00001", "1000000000000000", " 1", ".1"]) {
    assert.throws(() => normalizeMoney(value), { code: "SALES_PRICE_INVALID" });
  }
  assert.throws(() => lineAmount("2", "999999999999999.9999"), { code: "SALES_PRICE_INVALID" });
  assert.throws(() => documentTotal(["999999999999999.9999", "0.0001"]), { code: "SALES_PRICE_INVALID" });
  assert.equal(displayMoney("1.2350", 2), "1.24");
  assert.equal(displayMoney("1.2350", 4), "1.2350");
  assert.equal(displayMoney("1.5000", 0), "2");
  assert.throws(() => displayMoney("1", 5));
});

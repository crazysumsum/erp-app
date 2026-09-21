import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCustomerCode,
  normalizeIdentifierValue,
  normalizeLegalName,
  normalizeTradingName
} from "../src/modules/customer/customerNormalization.js";

test("Customer Code：顯示值只 trim，而 equality key 做 NFKC 與 locale-independent lowercase", () => {
  assert.deepEqual(normalizeCustomerCode("  ＣＵＳ-Ａ１  "), {
    value: "ＣＵＳ-Ａ１",
    key: "cus-a1"
  });
  assert.equal(normalizeCustomerCode("AcMe").key, normalizeCustomerCode("acme").key);
});

test("Customer Code：拒絕空白、控制字元及超過 64 個 code points 的值", () => {
  for (const value of ["   ", `C${String.fromCharCode(0)}01`, "a".repeat(65), 123]) {
    assert.throws(() => normalizeCustomerCode(value), { code: "CUSTOMER_NORMALIZATION_INVALID" });
  }

  assert.equal(normalizeCustomerCode("a".repeat(64)).value, "a".repeat(64));
});

test("Legal Name：NFKC、Unicode whitespace collapse 與 lowercase 僅影響 equality key", () => {
  assert.deepEqual(normalizeLegalName("  ACME\u00A0\u00A0Trading　有限公司  "), {
    value: "ACME\u00A0\u00A0Trading　有限公司",
    key: "acme trading 有限公司"
  });
  assert.equal(normalizeLegalName("ＣＡＦÉ").key, normalizeLegalName("café").key);
});

test("Legal Name：保留標點與公司後綴，避免過度合併", () => {
  assert.notEqual(normalizeLegalName("Acme, Ltd.").key, normalizeLegalName("Acme Ltd").key);
  assert.notEqual(normalizeLegalName("Acme Limited").key, normalizeLegalName("Acme Ltd").key);
});

test("Legal Name：拒絕空白、控制字元及超過 190 個 code points 的值", () => {
  for (const value of ["\t\n", `Acme${String.fromCharCode(127)}`, "a".repeat(191), null]) {
    assert.throws(() => normalizeLegalName(value), { code: "CUSTOMER_NORMALIZATION_INVALID" });
  }

  assert.equal(normalizeLegalName("a".repeat(190)).value, "a".repeat(190));
});

test("Trading Name 使用同一名稱 key，但空白值以 null key 表示且不參與唯一性", () => {
  assert.deepEqual(normalizeTradingName("  Acme　Shop  "), { value: "Acme　Shop", key: "acme shop" });
  assert.deepEqual(normalizeTradingName("  "), { value: "", key: null });
});

test("Identifier：沒有 type-specific 規則時只 collapse spaces；已批准的空格／連字號才移除", () => {
  assert.deepEqual(normalizeIdentifierValue("  hk  123-45  "), {
    value: "hk  123-45",
    key: "HK 123-45"
  });
  assert.deepEqual(normalizeIdentifierValue("  hk  123-45  ", { removableSeparators: [" ", "-"] }), {
    value: "hk  123-45",
    key: "HK12345"
  });
});

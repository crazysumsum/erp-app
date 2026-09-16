import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeContactEmail,
  normalizeIdentifier,
  normalizeSupplierCode,
  normalizeSupplierName,
  normalizeSupplierOptionalText,
  normalizeSupplierUrl
} from "../src/modules/supplier/supplierNormalization.js";

test("Supplier Code keeps the trimmed display value and derives an NFKC case-insensitive key", () => {
  assert.deepEqual(normalizeSupplierCode("  ＡＢＣ-零食  "), {
    value: "ＡＢＣ-零食",
    key: "abc-零食"
  });
  assert.deepEqual(normalizeSupplierCode("manual code.with spaces"), {
    value: "manual code.with spaces",
    key: "manual code.with spaces"
  });
});

test("Supplier Name collapses whitespace only in the comparison key", () => {
  assert.deepEqual(normalizeSupplierName("  Café   Trading  "), {
    value: "Café   Trading",
    key: "café trading"
  });
  assert.deepEqual(normalizeSupplierName("  ＡＢ　公司  "), {
    value: "ＡＢ　公司",
    key: "ab 公司"
  });
});

test("Identifier normalization is scoped by type and issuer country", () => {
  assert.deepEqual(normalizeIdentifier({
    type: "company_registration",
    issuerCountryCode: " hk ",
    value: " 1234- 56 78 "
  }), {
    type: "company_registration",
    issuerCountryCode: "HK",
    value: "1234- 56 78",
    key: "12345678"
  });
  assert.equal(normalizeIdentifier({ type: "other", issuerCountryCode: "US", value: " a/b " }).key, "A/B");
});

test("Email comparison and URL validation do not rewrite display values", () => {
  assert.deepEqual(normalizeContactEmail(" Finance@Example.COM "), {
    value: "Finance@Example.COM",
    key: "finance@example.com"
  });
  assert.equal(normalizeSupplierUrl(" https://example.com/supplier "), "https://example.com/supplier");
  assert.throws(() => normalizeSupplierUrl("javascript:alert(1)"), (error) => error.publicCode === "WEBSITE_INVALID");
});

test("normalizers reject blank, overlong and control-character input", () => {
  assert.throws(() => normalizeSupplierCode("   "), (error) => error.publicCode === "SUPPLIER_CODE_INVALID");
  assert.throws(() => normalizeSupplierCode(`ABC\u0000DEF`), (error) => error.publicCode === "SUPPLIER_CODE_INVALID");
  assert.throws(() => normalizeSupplierCode("x".repeat(65)), (error) => error.publicCode === "SUPPLIER_CODE_INVALID");
  assert.throws(() => normalizeSupplierName("x".repeat(191)), (error) => error.publicCode === "SUPPLIER_NAME_INVALID");
});

test("optional Supplier root text is trimmed and rejects control characters", () => {
  assert.equal(normalizeSupplierOptionalText("  note  ", { field: "notes", maxLength: 20 }), "note");
  assert.equal(normalizeSupplierOptionalText(null, { field: "notes", maxLength: 20 }), "");
  assert.throws(
    () => normalizeSupplierOptionalText("bad\u0000note", { field: "notes", maxLength: 20 }),
    (error) => error.publicCode === "SUPPLIER_FIELD_INVALID"
  );
});

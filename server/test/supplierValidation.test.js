import assert from "node:assert/strict";
import test from "node:test";

import {
  assertKnownSupplierFields,
  assertSupplierActivatable,
  supplierActivatabilityIssues,
  supplierCompletenessWarnings
} from "../src/modules/supplier/supplierValidation.js";

const valid = Object.freeze({
  supplierCode: "SUP-1",
  supplierName: "Demo Supplier",
  status: "draft",
  defaultCurrency: { code: "HKD", status: "ACTIVE" }
});

test("Supplier activation requires only Code, Name, an Active Currency and an allowed source state", () => {
  assert.doesNotThrow(() => assertSupplierActivatable(valid));
  assert.doesNotThrow(() => assertSupplierActivatable({ ...valid, status: "suspended" }));
  assert.throws(
    () => assertSupplierActivatable({ ...valid, supplierCode: "", supplierName: "", defaultCurrency: null }),
    (error) => error.publicCode === "SUPPLIER_NOT_ACTIVATABLE" &&
      error.details.issues.map((issue) => issue.code).join(",") === "SUPPLIER_CODE_REQUIRED,SUPPLIER_NAME_REQUIRED,CURRENCY_NOT_ACTIVE"
  );
  assert.throws(
    () => assertSupplierActivatable({ ...valid, status: "blocked" }),
    (error) => error.details.issues.some((issue) => issue.code === "STATUS_NOT_ACTIVATABLE")
  );
});

test("missing optional data produces bounded warnings and never activation issues", () => {
  assert.deepEqual(supplierCompletenessWarnings({}), [
    { field: "defaultPaymentTermId", code: "PAYMENT_TERM_MISSING", message: "尚未設定預設付款條款" },
    { field: "addresses", code: "ORDERING_ADDRESS_MISSING", message: "尚未設定採購用途地址" },
    { field: "contacts", code: "ORDERS_CONTACT_MISSING", message: "尚未設定訂單用途主要聯絡人" },
    { field: "identifiers", code: "IDENTIFIER_MISSING", message: "尚未設定供應商識別資料" },
    { field: "bankAccounts", code: "BANK_ACCOUNT_MISSING", message: "尚未設定銀行帳戶" }
  ]);
  assert.deepEqual(supplierCompletenessWarnings({
    defaultPaymentTermId: 2,
    hasOrderingAddress: true,
    hasOrdersContact: true,
    hasIdentifier: true,
    hasBankAccount: true
  }), []);
});

test("activation issues can be projected separately from non-blocking completeness warnings", () => {
  assert.deepEqual(
    supplierActivatabilityIssues({ ...valid, defaultCurrency: { code: "HKD", status: "INACTIVE" } }).map((issue) => issue.code),
    ["CURRENCY_NOT_ACTIVE"]
  );
});

test("unknown write fields are rejected instead of silently persisted", () => {
  assert.doesNotThrow(() => assertKnownSupplierFields({ supplierCode: "S1", supplierName: "Name" }));
  assert.throws(
    () => assertKnownSupplierFields({ supplierCode: "S1", surprise: true }),
    (error) => error.publicCode === "SUPPLIER_INPUT_INVALID" && error.details.unknownFields[0] === "surprise"
  );
});

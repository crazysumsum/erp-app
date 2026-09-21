import assert from "node:assert/strict";
import test from "node:test";

import { customerCodeTaken, customerNotFound, versionConflict } from "../src/modules/customer/customerErrors.js";
import { toCustomerDetail, toCustomerSummary } from "../src/modules/customer/customerProjections.js";

const row = {
  id: 7,
  customer_code: "CUS-001",
  customer_code_key: "cus-001",
  legal_name: "Example Trading Limited",
  legal_name_key: "example trading limited",
  trading_name: "Example",
  trading_name_key: "example",
  default_currency_code: "HKD",
  default_payment_term_id: 3,
  account_manager_user_id: 11,
  category_id: 2,
  industry_id: 4,
  territory_id: 6,
  website: "https://example.test",
  general_phone: "+852 1234 5678",
  general_email: "ops@example.test",
  notes: "Internal note",
  status: "draft",
  ever_activated_at: null,
  version: 2,
  created_at: 1,
  updated_at: 2,
  created_by: 10,
  updated_by: 11,
  account_ciphertext: "must-not-leak",
  bank_account_number: "must-not-leak"
};

test("Customer summary is a stable allowlist with no internal or sensitive fields", () => {
  const summary = toCustomerSummary(row);

  assert.deepEqual(summary, {
    id: 7,
    code: "CUS-001",
    legalName: "Example Trading Limited",
    displayName: "Example",
    generalPhone: "+852 1234 5678",
    generalEmail: "ops@example.test",
    defaultCurrencyCode: "HKD",
    defaultPaymentTermId: 3,
    accountManagerUserId: 11,
    categoryId: 2,
    industryId: 4,
    territoryId: 6,
    creditStatus: "not_configured",
    status: "draft",
    version: 2,
    updatedAt: 2
  });
  assert.equal("notes" in summary, false);
  assert.equal(JSON.stringify(summary).includes("key"), false);
  assert.equal(JSON.stringify(summary).includes("bank"), false);
});

test("Customer detail allowlists root fields but never normalized keys or bank data", () => {
  const detail = toCustomerDetail(row);

  assert.equal(detail.notes, "Internal note");
  assert.equal(detail.website, "https://example.test");
  assert.equal("customerCodeKey" in detail, false);
  assert.equal("legalNameKey" in detail, false);
  assert.equal(JSON.stringify(detail).includes("must-not-leak"), false);
});

test("Customer errors expose stable codes without SQL or conflicting customer values", () => {
  const taken = customerCodeTaken("duplicate-key", "Duplicate entry 'CUS-002' for key 'uq_customers_code_key'");
  const stale = versionConflict(4);
  const missing = customerNotFound(7);

  assert.equal(taken.statusCode, 409);
  assert.equal(taken.publicCode, "CUSTOMER_CODE_TAKEN");
  assert.doesNotMatch(taken.publicMessage, /CUS-002|uq_customers|SQL/i);
  assert.deepEqual(stale.publicDetails, { currentVersion: 4 });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.publicCode, "CUSTOMER_NOT_FOUND");
});

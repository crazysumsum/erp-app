import assert from "node:assert/strict";
import test from "node:test";

import {
  toMaskedBankResponse,
  toSupplierDetailResponse,
  toSupplierSummaryResponse
} from "../src/modules/supplier/supplierProjections.js";

const row = {
  id: 7,
  supplier_code: "SUP-7",
  supplier_code_key: "sup-7",
  supplier_name: "Demo",
  supplier_name_key: "demo",
  display_name: "D",
  default_currency_code: "HKD",
  default_payment_term_id: null,
  website: "https://example.com",
  general_phone: "123",
  general_email: "hello@example.com",
  notes: "note",
  status: "active",
  version: 2,
  created_at: 10,
  updated_at: 20,
  account_ciphertext: Buffer.from("secret"),
  unknown_internal: "never"
};

test("Supplier summary and detail projections are explicit allowlists", () => {
  assert.deepEqual(toSupplierSummaryResponse(row), {
    id: 7, supplierCode: "SUP-7", supplierName: "Demo", displayName: "D",
    defaultCurrencyCode: "HKD", defaultPaymentTermId: null, primaryContactName: "",
    status: "active", version: 2, updatedAt: 20
  });
  const detail = toSupplierDetailResponse(row, { warnings: [] });
  assert.equal(detail.website, "https://example.com");
  assert.equal(detail.supplierCodeKey, undefined);
  assert.equal(detail.accountCiphertext, undefined);
  assert.equal(detail.unknownInternal, undefined);
});

test("Supplier summary exposes only the primary-order Contact display name", () => {
  const result = toSupplierSummaryResponse({
    id: 7, supplier_code: "SUP-007", supplier_name: "Evergreen", display_name: "",
    default_currency_code: "HKD", default_payment_term_id: null, primary_contact_name: "Amy Chan",
    status: "active", version: 1, updated_at: 100, email: "must-not-leak@example.com"
  });
  assert.equal(result.primaryContactName, "Amy Chan");
  assert.equal("email" in result, false);
});

test("masked Bank projection never exposes encrypted material, key IDs or a short account tail", () => {
  const bank = toMaskedBankResponse({
    id: 5, bank_name: "Bank", account_holder_name: "Demo", bank_country_code: "HK",
    account_currency_code: "HKD", last_four: "1234", account_length: 12,
    status: "active", is_default: 1, version: 3, updated_at: 30,
    account_ciphertext: Buffer.from("secret"), encryption_key_id: "k1", account_blind_index: Buffer.alloc(32)
  });
  assert.equal(bank.maskedAccountNumber, "•••• 1234");
  assert.equal(bank.accountCiphertext, undefined);
  assert.equal(bank.encryptionKeyId, undefined);
  assert.equal(toMaskedBankResponse({ ...bank, last_four: "123", account_length: 3 }).maskedAccountNumber, "•••");
});

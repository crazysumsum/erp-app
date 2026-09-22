import assert from "node:assert/strict";
import test from "node:test";

import { CustomerService } from "../src/modules/customer/CustomerService.js";

test("TASK-017 completeness uses the authoritative Currency status and child defaults", async () => {
  const database = { async query(sql) {
    if (String(sql).includes("FROM customers WHERE")) return [[{ id: 7, customer_code: "CUS-007", legal_name: "Evergreen", default_currency_code: "HKD", default_payment_term_id: null }]];
    return [[{ billing_default: 1, shipping_default: 0, contact_default: 1, identifier: 0, credit_policy: 0 }]];
  } };
  const service = new CustomerService({ database, time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "sam" }), businessMaster: { getCurrencyHistory: async () => ({ code: "HKD", status: "INACTIVE" }) } });
  const result = await service.getCompleteness({ actorId: 1, claimedRoles: [], claimedPermissions: ["customer.view"], id: 7 });
  assert.deepEqual(result.issues.map(({ code }) => code), ["CURRENCY_NOT_ACTIVE"]);
  assert.deepEqual(result.warnings.map(({ code }) => code), ["SHIPPING_DEFAULT_MISSING", "IDENTIFIER_MISSING", "PAYMENT_TERM_MISSING", "CREDIT_POLICY_MISSING"]);
});

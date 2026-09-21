import assert from "node:assert/strict";
import test from "node:test";
import { up as createCustomerEqualityKeyFoundation } from "../database/migrations/0038_create_customer_equality_key_foundation.js";

test("Customer equality-key foundation migration creates only the minimal additive customers table", async () => {
  const calls = [];
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      return [{ affectedRows: 0 }];
    }
  };

  await createCustomerEqualityKeyFoundation(connection);

  assert.equal(calls.length, 1);
  assert.match(calls[0], /CREATE TABLE IF NOT EXISTS customers/);
  assert.match(calls[0], /customer_code_key\s+VARCHAR\(64\)\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/);
  assert.match(calls[0], /legal_name_key\s+VARCHAR\(190\)\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/);
  assert.match(calls[0], /UNIQUE KEY uq_customers_code_key \(customer_code_key\)/);
  assert.match(calls[0], /UNIQUE KEY uq_customers_legal_name_key \(legal_name_key\)/);
  assert.doesNotMatch(calls[0], /customer_audit_logs|default_currency_code|payment_terms/);
});

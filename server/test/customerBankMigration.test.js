import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerBankAccountSchema } from "../database/migrations/0049_create_customer_bank_accounts.js";

test("Customer bank schema inspector accepts absence and rejects plaintext or partial schemas", async () => {
  assert.equal(await inspectCustomerBankAccountSchema({ async query() { return [[]]; } }), false);

  const incompatible = {
    async query(sql) {
      if (sql.includes("information_schema.columns")) {
        return [[{
          column_name: "account_number",
          column_type: "varchar(512)",
          is_nullable: "NO",
          column_default: null,
          collation_name: "utf8mb4_unicode_ci",
          extra: "",
          generation_expression: ""
        }]];
      }
      return [[]];
    }
  };
  await assert.rejects(
    () => inspectCustomerBankAccountSchema(incompatible),
    /Incompatible existing Customer bank account schema/
  );
});

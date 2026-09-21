import assert from "node:assert/strict";
import test from "node:test";

import { up as extendCustomerRoot } from "../database/migrations/0040_extend_customer_root.js";

const FOUNDATION_COLUMNS = [
  ["id", "bigint unsigned", "NO", null],
  ["customer_code", "varchar(64)", "NO", null],
  ["customer_code_key", "varchar(64)", "NO", "utf8mb4_bin"],
  ["legal_name", "varchar(190)", "NO", null],
  ["legal_name_key", "varchar(190)", "NO", "utf8mb4_bin"],
  ["created_at", "bigint unsigned", "NO", null],
  ["updated_at", "bigint unsigned", "NO", null]
];

function foundationConnection({ codeKeyCollation = "utf8mb4_bin" } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("information_schema.columns")) {
        return [FOUNDATION_COLUMNS.map(([column_name, column_type, is_nullable, collation_name]) => ({
          table_name: "customers",
          column_name,
          column_type,
          is_nullable,
          collation_name: column_name === "customer_code_key" ? codeKeyCollation : collation_name
        }))];
      }
      if (String(sql).includes("information_schema.statistics")) return [[]];
      if (String(sql).includes("information_schema.key_column_usage")) return [[]];
      return [[]];
    }
  };
}

test("TC-003 extends the equality-key foundation with only additive Customer-root columns, indexes and foreign keys", async () => {
  const connection = foundationConnection();

  await extendCustomerRoot(connection);

  const sql = connection.calls.map(({ sql }) => sql).join("\n");
  assert.match(sql, /ADD COLUMN trading_name\s+VARCHAR\(190\) NOT NULL DEFAULT ''/);
  assert.match(sql, /ADD COLUMN trading_name_key\s+VARCHAR\(190\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL/);
  assert.match(sql, /ADD COLUMN default_currency_code\s+CHAR\(3\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
  assert.match(sql, /ADD COLUMN status\s+VARCHAR\(30\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft'/);
  assert.match(sql, /ADD KEY idx_customers_status_updated \(status, updated_at, id\)/);
  assert.match(sql, /ADD CONSTRAINT fk_customers_default_currency FOREIGN KEY \(default_currency_code\) REFERENCES currencies \(code\) ON DELETE RESTRICT/);
  assert.match(sql, /ADD CONSTRAINT fk_customers_category FOREIGN KEY \(category_id\) REFERENCES customer_categories \(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|INSERT INTO/);
});

test("TC-003 rejects a mismatched equality-key foundation before any ALTER", async () => {
  const connection = foundationConnection({ codeKeyCollation: "utf8mb4_unicode_ci" });

  await assert.rejects(
    () => extendCustomerRoot(connection),
    /Incompatible existing Customer root schema: customers.customer_code_key/
  );
  assert.equal(connection.calls.some(({ sql }) => /ALTER TABLE/.test(sql)), false);
});

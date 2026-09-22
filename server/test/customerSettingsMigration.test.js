import assert from "node:assert/strict";
import test from "node:test";

import { up as createCustomerSettings } from "../database/migrations/0047_create_customer_settings.js";

test("Customer settings migration creates and seeds only the typed OFF singleton", async () => {
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      calls.push([String(sql), params]);
      if (String(sql).includes("information_schema.columns")) return [[]];
      if (String(sql).includes("SELECT id FROM customer_settings")) return [[{ id: 1 }]];
      return [[]];
    }
  };
  await createCustomerSettings(connection);
  const ddl = calls.find(([sql]) => sql.includes("CREATE TABLE IF NOT EXISTS customer_settings"))?.[0] ?? "";
  assert.match(ddl, /id\s+TINYINT UNSIGNED NOT NULL/u);
  assert.match(ddl, /require_activation_approval\s+TINYINT\(1\) NOT NULL DEFAULT 0/u);
  assert.match(ddl, /FOREIGN KEY \(updated_by\) REFERENCES users \(id\) ON DELETE SET NULL/u);
  const seed = calls.find(([sql]) => sql.includes("INSERT INTO customer_settings"))?.[0] ?? "";
  assert.match(seed, /SELECT 1, 0, 1/u);
  assert.doesNotMatch(seed, /INSERT IGNORE|UPDATE|DELETE/u);
});

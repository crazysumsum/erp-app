import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerPartySchema, up as createCustomerPartyTables } from "../database/migrations/0044_create_customer_party_tables.js";

test("TC-018 creates party ownership and database-enforced single-purpose defaults", async () => {
  const sql = [];
  await createCustomerPartyTables({ async query(statement) { sql.push(String(statement)); return [[]]; } });
  const ddl = sql.join("\n");
  assert.match(ddl, /UNIQUE KEY uq_customer_addresses_owner \(id, customer_id\)/);
  assert.match(ddl, /FOREIGN KEY \(address_id, customer_id\) REFERENCES customer_addresses \(id, customer_id\) ON DELETE CASCADE/);
  assert.match(ddl, /default_slot TINYINT\(1\) GENERATED ALWAYS AS \(IF\(is_default = 1, 1, NULL\)\) STORED/);
  assert.match(ddl, /UNIQUE KEY uq_customer_address_default \(customer_id, purpose_code, default_slot\)/);
  assert.match(ddl, /UNIQUE KEY uq_customer_contact_default \(customer_id, purpose_code, default_slot\)/);
  assert.doesNotMatch(ddl, /DROP TABLE|DELETE FROM/);
});

test("TC-018 rejects an incompatible adopted party table before DDL", async () => {
  const connection = { async query(sql) {
    if (String(sql).includes("information_schema.tables")) return [[{ tableName: "customer_addresses" }]];
    if (String(sql).includes("information_schema.columns")) return [[{ columnName: "id", columnType: "varchar(20)", isNullable: "NO", extraValue: "" }]];
    return [[]];
  } };
  await assert.rejects(() => inspectCustomerPartySchema(connection), /Incompatible existing Customer party schema: customer_addresses.id/);
});

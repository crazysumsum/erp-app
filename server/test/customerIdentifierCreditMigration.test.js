import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerIdentifierSchema, up as createCustomerIdentifiers } from "../database/migrations/0044_create_customer_identifiers.js";
import { inspectCustomerCreditSchema, up as createCustomerCreditProfiles } from "../database/migrations/0045_create_customer_credit_profiles.js";

test("TC-021 creates globally unique, owner-scoped Customer identifiers", async () => {
  const sql = [];
  await createCustomerIdentifiers({ async query(statement) { sql.push(String(statement)); return [[]]; } });
  const ddl = sql.join("\n");
  assert.match(ddl, /UNIQUE KEY uq_customer_identifiers_global \(identifier_type, issuer_country_code, identifier_value_key\)/);
  assert.match(ddl, /UNIQUE KEY uq_customer_identifiers_owner \(id, customer_id\)/);
  assert.match(ddl, /KEY idx_customer_identifiers_owner \(customer_id, status, identifier_type\)/);
  assert.match(ddl, /FOREIGN KEY \(customer_id\) REFERENCES customers \(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(ddl, /DROP TABLE|DELETE FROM/);
});

test("TC-021 refuses to adopt an incompatible identifier table", async () => {
  const connection = { async query(sql) {
    if (String(sql).includes("information_schema.tables")) return [[{ tableName: "customer_identifiers" }]];
    if (String(sql).includes("information_schema.columns")) return [[{ columnName: "identifier_value_key", columnType: "varchar(100)", isNullable: "NO", extraValue: "", collationName: "utf8mb4_bin" }]];
    return [[]];
  } };
  await assert.rejects(() => inspectCustomerIdentifierSchema(connection), /Incompatible existing Customer identifier schema/);
});

test("TC-022 creates the optional credit policy with exact DECIMAL and restrictive Currency FK", async () => {
  const sql = [];
  await createCustomerCreditProfiles({ async query(statement) { sql.push(String(statement)); return [[]]; } });
  const ddl = sql.join("\n");
  assert.match(ddl, /customer_id BIGINT UNSIGNED NOT NULL/);
  assert.match(ddl, /credit_limit DECIMAL\(19,4\) NULL/);
  assert.match(ddl, /credit_currency_code CHAR\(3\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
  assert.match(ddl, /PRIMARY KEY \(customer_id\)/);
  assert.match(ddl, /KEY idx_customer_credit_status \(credit_status, customer_id\)/);
  assert.match(ddl, /FOREIGN KEY \(credit_currency_code\) REFERENCES currencies \(code\) ON DELETE RESTRICT/);
  assert.doesNotMatch(ddl, /DROP TABLE|DELETE FROM/);
});

test("TC-022 refuses to adopt an incompatible credit policy table", async () => {
  const connection = { async query(sql) {
    if (String(sql).includes("information_schema.tables")) return [[{ tableName: "customer_credit_profiles" }]];
    if (String(sql).includes("information_schema.columns")) return [[{ columnName: "credit_limit", columnType: "double", isNullable: "YES", extraValue: "" }]];
    return [[]];
  } };
  await assert.rejects(() => inspectCustomerCreditSchema(connection), /Incompatible existing Customer credit schema/);
});

test("TC-022 rejects a credit Currency column whose collation cannot support the Business Master FK", async () => {
  const columns = [
    ["customer_id", "bigint unsigned", "NO", null],
    ["credit_limit", "decimal(19,4)", "YES", null],
    ["credit_currency_code", "char(3)", "YES", "utf8mb4_unicode_ci"],
    ["credit_status", "varchar(20)", "NO", "utf8mb4_unicode_ci"],
    ["credit_notes", "varchar(1000)", "NO", "utf8mb4_unicode_ci"],
    ["last_change_reason", "varchar(500)", "NO", "utf8mb4_unicode_ci"],
    ["version", "int unsigned", "NO", null]
  ].map(([columnName, columnType, isNullable, collationName]) => ({ columnName, columnType, isNullable, collationName }));
  const connection = { async query(sql) {
    if (String(sql).includes("information_schema.tables")) return [[{ tableName: "customer_credit_profiles" }]];
    if (String(sql).includes("information_schema.columns")) return [columns];
    return [[]];
  } };
  await assert.rejects(() => inspectCustomerCreditSchema(connection), /customer_credit_profiles.credit_currency_code/);
});

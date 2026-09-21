import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectCustomerClassificationCatalogSchema,
  up as createCustomerClassificationCatalogs
} from "../database/migrations/0040_create_customer_classification_catalogs.js";

const TABLES = ["customer_categories", "customer_industries", "customer_territories"];

function freshConnection() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("information_schema.columns")) return [[]];
      return [[]];
    }
  };
}

test("TC-003 creates only Customer-owned classification catalogs with no invented seed data", async () => {
  const connection = freshConnection();

  await createCustomerClassificationCatalogs(connection);

  const ddl = connection.calls.filter(({ sql }) => /CREATE TABLE IF NOT EXISTS/.test(sql));
  assert.equal(ddl.length, 3);
  assert.deepEqual(ddl.map(({ sql }) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql)?.[1]), TABLES);

  for (const { sql } of ddl) {
    assert.match(sql, /code_key\s+VARCHAR\(50\)\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/);
    assert.match(sql, /UNIQUE KEY uq_customer_\w+_code_key \(code_key\)/);
    assert.match(sql, /KEY idx_customer_\w+_status_sort_name \(status, sort_order, name\)/);
    assert.match(sql, /FOREIGN KEY \(created_by\) REFERENCES users \(id\) ON DELETE SET NULL/);
    assert.doesNotMatch(sql, /INSERT INTO|currencies|payment_terms/);
  }
});

test("TC-003 rejects an incompatible adopted Customer classification table before issuing DDL", async () => {
  const connection = freshConnection();
  connection.query = async (sql, params = []) => {
    connection.calls.push({ sql: String(sql), params });
    if (String(sql).includes("information_schema.columns")) {
      return [[{
        table_name: "customer_categories",
        column_name: "code_key",
        column_type: "varchar(50)",
        is_nullable: "NO",
        collation_name: "utf8mb4_unicode_ci"
      }]];
    }
    return [[]];
  };

  await assert.rejects(
    () => createCustomerClassificationCatalogs(connection),
    /Incompatible existing Customer classification catalog schema: customer_categories/
  );
  assert.equal(connection.calls.some(({ sql }) => /CREATE TABLE|INSERT INTO/.test(sql)), false);
});

test("TC-003 recognizes a compatible adopted catalog shape", async () => {
  const connection = freshConnection();
  const columns = [
    ["id", "bigint unsigned", "NO", null],
    ["code", "varchar(50)", "NO", "utf8mb4_unicode_ci"],
    ["code_key", "varchar(50)", "NO", "utf8mb4_bin"],
    ["name", "varchar(100)", "NO", "utf8mb4_unicode_ci"],
    ["description", "varchar(500)", "NO", "utf8mb4_unicode_ci"],
    ["status", "varchar(20)", "NO", "ascii_bin"],
    ["sort_order", "int unsigned", "NO", null],
    ["version", "int unsigned", "NO", null],
    ["created_at", "bigint unsigned", "NO", null],
    ["created_by", "bigint unsigned", "YES", null],
    ["updated_at", "bigint unsigned", "NO", null],
    ["updated_by", "bigint unsigned", "YES", null]
  ];
  connection.query = async (sql, params = []) => {
    connection.calls.push({ sql: String(sql), params });
    if (String(sql).includes("information_schema.columns")) {
      return [TABLES.flatMap((table_name) => columns.map(([column_name, column_type, is_nullable, collation_name]) => ({
        table_name,
        column_name,
        column_type,
        is_nullable,
        collation_name
      })))];
    }
    if (String(sql).includes("information_schema.statistics")) {
      return [TABLES.flatMap((table_name) => [
        { table_name, index_name: "PRIMARY", non_unique: 0, seq_in_index: 1, column_name: "id" },
        { table_name, index_name: `uq_${table_name}_code_key`, non_unique: 0, seq_in_index: 1, column_name: "code_key" },
        { table_name, index_name: `idx_${table_name}_status_sort_name`, non_unique: 1, seq_in_index: 1, column_name: "status" },
        { table_name, index_name: `idx_${table_name}_status_sort_name`, non_unique: 1, seq_in_index: 2, column_name: "sort_order" },
        { table_name, index_name: `idx_${table_name}_status_sort_name`, non_unique: 1, seq_in_index: 3, column_name: "name" }
      ])];
    }
    return [[]];
  };

  const found = await inspectCustomerClassificationCatalogSchema(connection);
  assert.deepEqual([...found.keys()], TABLES);
});

import assert from "node:assert/strict";
import test from "node:test";

import { up } from "../../database/migrations/0027_create_business_master.js";

function freshDatabaseConnection() {
  const calls = [];
  let nextId = 10;
  const connection = {
    calls,
    async query(sql, params = []) {
      calls.push({ method: "query", sql: String(sql), params });
      if (String(sql).includes("information_schema.columns")) return [[]];
      if (String(sql).includes("FROM roles WHERE name")) return [[{ id: 1 }]];
      if (String(sql).includes("FROM permissions WHERE name")) return [[]];
      if (String(sql).includes("FROM role_permissions")) return [[]];
      if (String(sql).includes("FROM currencies WHERE code")) return [[]];
      return [[]];
    },
    async execute(sql, params = []) {
      calls.push({ method: "execute", sql: String(sql), params });
      return [{ insertId: nextId++ }];
    }
  };
  return connection;
}

test("TC-001 creates sole-owner tables, seeds two permissions, and only HKD catalog data", async () => {
  const connection = freshDatabaseConnection();
  await up(connection);

  const ddl = connection.calls.filter((call) => /CREATE TABLE IF NOT EXISTS/.test(call.sql));
  assert.equal(ddl.length, 3);
  assert.match(ddl[0].sql, /currencies/);
  assert.match(ddl[1].sql, /payment_terms/);
  assert.match(ddl[2].sql, /business_master_audit_logs/);

  const permissionInserts = connection.calls.filter(
    (call) => /INSERT INTO permissions/.test(call.sql)
  );
  assert.deepEqual(permissionInserts.map((call) => call.params[0]), [
    "business_master.view",
    "business_master.mgmt"
  ]);

  const catalogInserts = connection.calls.filter(
    (call) => /INSERT INTO currencies/.test(call.sql) || /INSERT INTO payment_terms/.test(call.sql)
  );
  assert.equal(catalogInserts.length, 1);
  assert.match(catalogInserts[0].sql, /INSERT INTO currencies/);
  assert.equal(catalogInserts[0].params[0], "HKD");
});

test("TC-001 rejects an incompatible adopted table before issuing DDL or seed writes", async () => {
  const connection = freshDatabaseConnection();
  connection.query = async (sql, params = []) => {
    connection.calls.push({ method: "query", sql: String(sql), params });
    if (String(sql).includes("information_schema.columns")) {
      return [[{ table_name: "currencies", column_name: "code", column_type: "varchar(3)", is_nullable: "NO" }]];
    }
    return [[]];
  };

  await assert.rejects(() => up(connection), /Incompatible existing Business Master schema/);
  assert.equal(connection.calls.some((call) => /CREATE TABLE|INSERT INTO/.test(call.sql)), false);
});

test("TC-001 rejects an adopted Payment Term table with compatible names but incompatible types", async () => {
  const connection = freshDatabaseConnection();
  const originalQuery = connection.query.bind(connection);
  const columns = ["id", "code", "code_key", "name", "description", "calculation_type", "due_days", "status", "version", "created_at", "created_by", "updated_at", "updated_by"];
  connection.query = async (sql, params = []) => {
    if (String(sql).includes("information_schema.columns")) {
      connection.calls.push({ method: "query", sql: String(sql), params });
      return [columns.map((column) => ({ table_name: "payment_terms", column_name: column, column_type: column === "id" ? "varchar(20)" : "varchar(50)", is_nullable: ["due_days", "created_by", "updated_by"].includes(column) ? "YES" : "NO", collation_name: "utf8mb4_bin" }))];
    }
    return originalQuery(sql, params);
  };

  await assert.rejects(() => up(connection), /Incompatible existing Business Master schema: payment_terms.id/);
  assert.equal(connection.calls.some((call) => /CREATE TABLE|INSERT INTO/.test(call.sql)), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { PERMISSION_CATALOGUE } from "../../src/modules/authorization/permissionCatalogue.js";
import { SALES_PERMISSIONS } from "../../src/modules/sales/salesConstants.js";

test("TC-007 Sales permission seed is idempotent and grants no roles", async () => {
  const { up } = await import("../../database/migrations/0067_seed_sales_permissions.js");
  const rows = new Map();
  const connection = {
    query: async (sql, [name]) => {
      assert.equal(sql, "SELECT id FROM permissions WHERE name = ?");
      return [rows.has(name) ? [{ id: rows.size }] : []];
    },
    execute: async (sql, [name, description, createdAt]) => {
      assert.equal(sql, "INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?)");
      assert.ok(Number.isSafeInteger(createdAt));
      assert.equal(rows.has(name), false);
      rows.set(name, description);
    }
  };
  await up(connection);
  await up(connection);
  assert.deepEqual([...rows.keys()], [...SALES_PERMISSIONS]);
  for (const [name, description] of rows) {
    assert.equal(PERMISSION_CATALOGUE.find((permission) => permission.name === name)?.description, description);
  }
  assert.equal(rows.has("sales.operation"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { inspectInventoryTransferSchema, up } from "../database/migrations/0064_create_inventory_transfers.js";

test("Transfer inspector reports an absent schema", async () => {
  assert.equal(await inspectInventoryTransferSchema({ query: async () => [[]] }), false);
});

test("Transfer migration refuses incompatible partial columns before DDL", async () => {
  const statements = [];
  const connection = { query: async (sql) => {
    statements.push(sql);
    return sql.includes("information_schema.columns") ? [[{
      table_name: "inventory_transfers", column_name: "id", column_type: "bigint unsigned", is_nullable: "NO"
    }]] : [[]];
  } };
  await assert.rejects(() => up(connection), /Incompatible.*columns/u);
  assert.equal(statements.some((sql) => /CREATE|ALTER/u.test(sql)), false);
});

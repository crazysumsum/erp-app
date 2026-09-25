import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectInventoryMasterSchema,
  up
} from "../database/migrations/0057_create_inventory_master.js";

test("Inventory master inspector reports an absent schema", async () => {
  const connection = { query: async () => [[]] };

  assert.equal(await inspectInventoryMasterSchema(connection), false);
});

test("Inventory master migration rejects an incompatible partial schema before DDL", async () => {
  const statements = [];
  const connection = {
    query: async (sql) => {
      statements.push(sql);
      if (sql.includes("information_schema.columns")) {
        return [[{
          table_name: "inventory_warehouses",
          column_name: "id",
          column_type: "bigint unsigned",
          is_nullable: "NO",
          collation_name: null
        }]];
      }
      return [[]];
    }
  };

  await assert.rejects(() => up(connection), /unexpected columns/u);
  assert.equal(statements.some((sql) => sql.includes("CREATE TABLE")), false);
});

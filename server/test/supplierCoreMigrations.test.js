import assert from "node:assert/strict";
import test from "node:test";

import { inspectSuppliersSchema } from "../database/migrations/0029_create_suppliers.js";
import { inspectSupplierNameGramsSchema } from "../database/migrations/0030_create_supplier_name_grams.js";

test("Supplier core schema inspectors accept an absent table and reject a partial table", async () => {
  const absent = { async query() { return [[]]; } };
  assert.equal(await inspectSuppliersSchema(absent), false);
  assert.equal(await inspectSupplierNameGramsSchema(absent), false);

  const partial = {
    async query(sql) {
      if (sql.includes("information_schema.columns")) {
        return [[{ column_name: "id", column_type: "bigint unsigned", is_nullable: "NO", collation_name: null }]];
      }
      return [[]];
    }
  };
  await assert.rejects(() => inspectSuppliersSchema(partial), /Incompatible existing Supplier schema: suppliers/);
  await assert.rejects(() => inspectSupplierNameGramsSchema(partial), /Incompatible existing Supplier schema: supplier_name_grams/);
});

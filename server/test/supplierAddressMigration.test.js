import assert from "node:assert/strict";
import test from "node:test";

import { inspectSupplierAddressSchema } from "../database/migrations/0032_create_supplier_addresses.js";

test("Address migration inspector accepts absence and rejects partial schemas", async () => {
  assert.equal(await inspectSupplierAddressSchema({ async query() { return [[]]; } }), false);
  await assert.rejects(
    () => inspectSupplierAddressSchema({ async query() { return [[{ table_name: "supplier_addresses", column_name: "id" }]]; } }),
    /Incompatible existing Supplier address schema/u
  );
});

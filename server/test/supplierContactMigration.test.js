import assert from "node:assert/strict";
import test from "node:test";

import { inspectSupplierContactSchema } from "../database/migrations/0033_create_supplier_contacts.js";

test("Contact migration inspector accepts absence and rejects partial schemas", async () => {
  assert.equal(await inspectSupplierContactSchema({ async query() { return [[]]; } }), false);
  await assert.rejects(
    () => inspectSupplierContactSchema({ async query() { return [[{ table_name: "supplier_contacts", column_name: "id" }]]; } }),
    /Incompatible existing Supplier contact schema/u
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { inspectSupplierIdentifierSchema } from "../database/migrations/0034_create_supplier_identifiers.js";

test("Identifier migration inspector accepts absence and rejects a partial schema", async () => {
  assert.equal(await inspectSupplierIdentifierSchema({ async query() { return [[]]; } }), false);
  await assert.rejects(
    () => inspectSupplierIdentifierSchema({ async query() { return [[{ column_name: "id" }]]; } }),
    /Incompatible existing Supplier identifier schema/u
  );
});

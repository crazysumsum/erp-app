import assert from "node:assert/strict";
import test from "node:test";

import { SupplierReferenceService } from "../src/modules/supplier/SupplierReferenceService.js";

test("Supplier reference guard returns named deterministic counts and a total", async () => {
  const calls = [];
  const service = new SupplierReferenceService({
    checkers: [
      { name: "supplierSkuRefs", async count(connection, id) { calls.push([connection, id]); return 2; } },
      { name: "activationRequests", async count() { return 1; } }
    ]
  });
  const connection = { query() {} };
  assert.deepEqual(await service.describeReferences(connection, 9), {
    references: { activationRequests: 1, supplierSkuRefs: 2 },
    total: 3
  });
  assert.deepEqual(calls, [[connection, 9]]);
});

test("Supplier reference guard rejects duplicate checker names and invalid counts", async () => {
  assert.throws(() => new SupplierReferenceService({ checkers: [{ name: "x", count() {} }, { name: "x", count() {} }] }), /unique/u);
  const service = new SupplierReferenceService({ checkers: [{ name: "x", async count() { return -1; } }] });
  await assert.rejects(() => service.describeReferences({}, 1), /non-negative integer/u);
});

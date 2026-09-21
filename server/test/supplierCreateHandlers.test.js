import assert from "node:assert/strict";
import test from "node:test";

import { CreateSupplierHandler } from "../src/handlers/suppliers/createSupplierHandler.js";

test("Supplier create route is idempotent, permission protected and accepts only the minimum root fields", () => {
  assert.equal(CreateSupplierHandler.api.method, "POST");
  assert.equal(CreateSupplierHandler.api.path, "/api/v1/suppliers/create");
  assert.equal(CreateSupplierHandler.api.idempotency.enabled, true);
  assert.deepEqual(CreateSupplierHandler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
  assert.deepEqual(CreateSupplierHandler.api.requestSchema.body.required, ["supplierCode", "supplierName", "defaultCurrencyCode"]);
  assert.equal(CreateSupplierHandler.api.requestSchema.body.additionalProperties, false);
});

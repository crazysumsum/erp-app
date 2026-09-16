import assert from "node:assert/strict";
import test from "node:test";

import { CreateSupplierAddressHandler, DeactivateSupplierAddressHandler, UpdateSupplierAddressHandler } from "../src/handlers/suppliers/supplierAddressHandlers.js";

test("Address handlers use supplier.mgmt, ownership route ids and closed schemas", () => {
  assert.equal(CreateSupplierAddressHandler.api.path, "/api/v1/suppliers/:supplierId/addresses/create");
  assert.equal(UpdateSupplierAddressHandler.api.path, "/api/v1/suppliers/:supplierId/addresses/:addressId/update");
  assert.equal(DeactivateSupplierAddressHandler.api.path, "/api/v1/suppliers/:supplierId/addresses/:addressId/deactivate");
  for (const Handler of [CreateSupplierAddressHandler, UpdateSupplierAddressHandler, DeactivateSupplierAddressHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
    assert.equal(Handler.api.requestSchema.body.additionalProperties, false);
  }
  assert.ok(UpdateSupplierAddressHandler.api.requestSchema.body.required.includes("version"));
  assert.ok(DeactivateSupplierAddressHandler.api.requestSchema.body.required.includes("version"));
});

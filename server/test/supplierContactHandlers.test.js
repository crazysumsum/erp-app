import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSupplierContactHandler,
  DeactivateSupplierContactHandler,
  UpdateSupplierContactHandler
} from "../src/handlers/suppliers/supplierContactHandlers.js";

test("Contact handlers use supplier.mgmt, ownership route ids and closed schemas", () => {
  assert.equal(CreateSupplierContactHandler.api.path, "/api/v1/suppliers/:supplierId/contacts/create");
  assert.equal(UpdateSupplierContactHandler.api.path, "/api/v1/suppliers/:supplierId/contacts/:contactId/update");
  assert.equal(DeactivateSupplierContactHandler.api.path, "/api/v1/suppliers/:supplierId/contacts/:contactId/deactivate");
  for (const Handler of [CreateSupplierContactHandler, UpdateSupplierContactHandler, DeactivateSupplierContactHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
    assert.equal(Handler.api.requestSchema.body.additionalProperties, false);
  }
  assert.ok(UpdateSupplierContactHandler.api.requestSchema.body.required.includes("version"));
  assert.ok(DeactivateSupplierContactHandler.api.requestSchema.body.required.includes("version"));
  assert.equal(CreateSupplierContactHandler.api.requestSchema.body.properties.email.maxLength, 254);
  assert.equal(CreateSupplierContactHandler.api.requestSchema.body.properties.phone.maxLength, 50);
});

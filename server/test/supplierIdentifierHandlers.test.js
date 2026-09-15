import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSupplierIdentifierHandler,
  DeleteSupplierIdentifierHandler,
  UpdateSupplierIdentifierHandler
} from "../src/handlers/suppliers/supplierIdentifierHandlers.js";

test("Identifier handlers use supplier.mgmt, ownership routes, version and reasons", () => {
  assert.equal(CreateSupplierIdentifierHandler.api.path, "/api/v1/suppliers/:supplierId/identifiers/create");
  assert.equal(UpdateSupplierIdentifierHandler.api.path, "/api/v1/suppliers/:supplierId/identifiers/:identifierId/update");
  assert.equal(DeleteSupplierIdentifierHandler.api.path, "/api/v1/suppliers/:supplierId/identifiers/:identifierId/delete");
  for (const Handler of [CreateSupplierIdentifierHandler, UpdateSupplierIdentifierHandler, DeleteSupplierIdentifierHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
    assert.equal(Handler.api.requestSchema.body.additionalProperties, false);
  }
  assert.ok(UpdateSupplierIdentifierHandler.api.requestSchema.body.required.includes("reason"));
  assert.ok(DeleteSupplierIdentifierHandler.api.requestSchema.body.required.includes("reason"));
  assert.ok(DeleteSupplierIdentifierHandler.api.requestSchema.body.required.includes("version"));
});

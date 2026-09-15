import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangeSupplierCodeHandler,
  UpdateSupplierHandler
} from "../src/handlers/suppliers/supplierUpdateHandlers.js";

test("general Supplier update excludes Supplier Code and requires optimistic version", () => {
  assert.equal(UpdateSupplierHandler.api.path, "/api/v1/suppliers/:id/update");
  assert.equal(UpdateSupplierHandler.api.authType ?? "jwt", "jwt");
  assert.deepEqual(UpdateSupplierHandler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
  assert.ok(UpdateSupplierHandler.api.requestSchema.body.required.includes("version"));
  assert.equal("supplierCode" in UpdateSupplierHandler.api.requestSchema.body.properties, false);
  assert.equal(UpdateSupplierHandler.api.requestSchema.body.additionalProperties, false);
});

test("Supplier Code correction is a device-password command with a reason and password", () => {
  assert.equal(ChangeSupplierCodeHandler.api.path, "/api/v1/suppliers/:id/code/change");
  assert.equal(ChangeSupplierCodeHandler.api.authType, "jwt-device-password");
  assert.deepEqual(ChangeSupplierCodeHandler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
  assert.deepEqual(ChangeSupplierCodeHandler.api.requestSchema.body.required.sort(), ["password", "reason", "supplierCode", "version"]);
  assert.equal(ChangeSupplierCodeHandler.api.requestSchema.body.properties.reason.minLength, 5);
  assert.equal(ChangeSupplierCodeHandler.api.requestSchema.body.additionalProperties, false);
});

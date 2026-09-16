import assert from "node:assert/strict";
import test from "node:test";

import {
  ActivateSupplierHandler,
  ArchiveSupplierHandler,
  BlockSupplierHandler,
  DeleteSupplierHandler,
  ReactivateSupplierHandler,
  RestoreSupplierHandler,
  SuspendSupplierHandler,
  UnblockSupplierHandler
} from "../src/handlers/suppliers/supplierLifecycleHandlers.js";

const mgmtHandlers = [ActivateSupplierHandler, SuspendSupplierHandler, ReactivateSupplierHandler, ArchiveSupplierHandler, RestoreSupplierHandler, DeleteSupplierHandler];

test("Supplier lifecycle handlers expose the designed routes and management permission", () => {
  assert.deepEqual(mgmtHandlers.map((Handler) => Handler.api.path), [
    "/api/v1/suppliers/:id/activate", "/api/v1/suppliers/:id/suspend", "/api/v1/suppliers/:id/reactivate",
    "/api/v1/suppliers/:id/archive", "/api/v1/suppliers/:id/restore", "/api/v1/suppliers/:id/delete"
  ]);
  for (const Handler of mgmtHandlers) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
    assert.ok(Handler.api.requestSchema.body.required.includes("version"));
  }
});

test("high-risk auth and reason requirements match the lifecycle contract", () => {
  assert.equal(ActivateSupplierHandler.api.authType ?? "jwt", "jwt");
  assert.equal(SuspendSupplierHandler.api.authType, "jwt-password");
  assert.equal(ReactivateSupplierHandler.api.authType, "jwt-password");
  assert.equal(ArchiveSupplierHandler.api.authType, "jwt-password");
  assert.equal(RestoreSupplierHandler.api.authType, "jwt-password");
  assert.equal(DeleteSupplierHandler.api.authType, "jwt-device-password");
  for (const Handler of [SuspendSupplierHandler, ReactivateSupplierHandler, ArchiveSupplierHandler, RestoreSupplierHandler, DeleteSupplierHandler]) {
    assert.ok(Handler.api.requestSchema.body.required.includes("reason"));
    assert.ok(Handler.api.requestSchema.body.required.includes("password"));
  }
});

test("block and unblock require both view and approval with device-password auth", () => {
  for (const Handler of [BlockSupplierHandler, UnblockSupplierHandler]) {
    assert.equal(Handler.api.authType, "jwt-device-password");
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["supplier.view", "supplier.approval"]);
    assert.ok(Handler.api.requestSchema.body.required.includes("reason"));
    assert.ok(Handler.api.requestSchema.body.required.includes("password"));
  }
});

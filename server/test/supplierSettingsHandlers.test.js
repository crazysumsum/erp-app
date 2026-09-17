import assert from "node:assert/strict";
import test from "node:test";

import { CreateSupplierHandler } from "../src/handlers/suppliers/createSupplierHandler.js";
import { GetSupplierSettingsHandler, UpdateSupplierSettingsHandler } from "../src/handlers/supplier-settings/settingsHandlers.js";
import { ActivateSupplierHandler } from "../src/handlers/suppliers/supplierLifecycleHandlers.js";
import { getActivationPolicy } from "../src/modules/supplier/SupplierSettingsService.js";

test("both settings routes require supplier.settings and nothing weaker", () => {
  // BR-022: 一般 Supplier 管理權限唔包含設定權限。
  for (const Handler of [GetSupplierSettingsHandler, UpdateSupplierSettingsHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["supplier.settings"]);
  }
  assert.equal(GetSupplierSettingsHandler.api.path, "/api/v1/supplier-settings");
  assert.equal(UpdateSupplierSettingsHandler.api.path, "/api/v1/supplier-settings/update");
});

test("the write route demands device-password re-auth, the read route does not", () => {
  assert.equal(UpdateSupplierSettingsHandler.api.authType, "jwt-device-password");
  assert.equal(GetSupplierSettingsHandler.api.authType, undefined, "reading settings must not demand a password");
});

test("the update body is closed and demands version, reason and password", () => {
  const body = UpdateSupplierSettingsHandler.api.requestSchema.body;
  assert.equal(body.additionalProperties, false, "an undefined parameter must be a 400, not a stored setting");
  for (const field of ["requireActivationApproval", "version", "reason", "password"]) {
    assert.ok(body.required.includes(field), `${field} must be required`);
  }
  assert.deepEqual(Object.keys(body.properties).sort(), ["password", "reason", "requireActivationApproval", "version"]);
});

test("every request schema on both routes is closed", () => {
  for (const Handler of [GetSupplierSettingsHandler, UpdateSupplierSettingsHandler]) {
    for (const [part, schema] of Object.entries(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, `${Handler.handlerName}.${part} is open`);
    }
  }
});

test("the activation policy is the one the create and activate routes actually consult", () => {
  // The setting only means anything if the commands read it. Before TASK-026 the
  // service defaulted to `async () => false`, so the stored value had no effect.
  for (const Handler of [CreateSupplierHandler, ActivateSupplierHandler]) {
    const services = { require: () => ({ logger: { warn() {} }, nowMs: () => 1 }) };
    const handler = new Handler(services);
    assert.equal(handler.suppliers.approvalRequired, getActivationPolicy,
      `${Handler.handlerName} does not consult the stored activation policy`);
  }
});

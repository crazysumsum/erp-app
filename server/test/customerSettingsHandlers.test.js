import assert from "node:assert/strict";
import test from "node:test";

import {
  GetCustomerSettingsHandler,
  UpdateCustomerSettingsHandler
} from "../src/handlers/customer-settings/settingsHandlers.js";

test("Customer settings routes require the distinct view-plus-settings policy and a high-risk update", () => {
  for (const Handler of [GetCustomerSettingsHandler, UpdateCustomerSettingsHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.settings"]);
    for (const schema of Object.values(Handler.api.requestSchema)) assert.equal(schema.additionalProperties, false);
  }
  assert.equal(GetCustomerSettingsHandler.api.path, "/api/v1/customer-settings");
  assert.equal(UpdateCustomerSettingsHandler.api.path, "/api/v1/customer-settings/update");
  assert.equal(UpdateCustomerSettingsHandler.api.authType, "jwt-device-password");
  assert.deepEqual(Object.keys(UpdateCustomerSettingsHandler.api.requestSchema.body.properties).sort(), ["password", "reason", "requireActivationApproval", "version"]);
});

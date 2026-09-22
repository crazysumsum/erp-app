import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateCustomerCatalogHandler,
  DeactivateCustomerCatalogHandler,
  ListCustomerCatalogHandler,
  UpdateCustomerCatalogHandler
} from "../src/handlers/customer-catalog/customerCatalogHandlers.js";

test("Customer classification catalog routes have fixed catalog enums, closed schemas and high-risk writes", () => {
  const handlers = [ListCustomerCatalogHandler, CreateCustomerCatalogHandler, UpdateCustomerCatalogHandler, DeactivateCustomerCatalogHandler];
  for (const Handler of handlers) assert.match(Handler.api.description, /endpoint\.$/);
  for (const Handler of handlers.slice(1)) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.settings"]);
    for (const schema of Object.values(Handler.api.requestSchema)) assert.equal(schema.additionalProperties, false);
  }
  assert.deepEqual(ListCustomerCatalogHandler.api.authorizationPolicies[0].options.permissions, ["customer.view"]);
  for (const schema of Object.values(ListCustomerCatalogHandler.api.requestSchema)) assert.equal(schema.additionalProperties, false);
  assert.deepEqual(ListCustomerCatalogHandler.api.requestSchema.params.properties.catalog.enum, ["categories", "industries", "territories"]);
  for (const Handler of handlers.slice(1)) assert.equal(Handler.api.authType, "jwt-device-password");
  assert.ok(UpdateCustomerCatalogHandler.api.requestSchema.body.required.includes("reason"));
  assert.ok(DeactivateCustomerCatalogHandler.api.requestSchema.body.required.includes("password"));
});

import assert from "node:assert/strict";
import test from "node:test";

import { CreateCustomerExportHandler, DownloadCustomerExportHandler, GetCustomerExportHandler } from "../src/handlers/customer-exports/customerExportHandlers.js";

test("Customer export handlers are owner-facing management routes with strict inputs", () => {
  for (const Handler of [CreateCustomerExportHandler, GetCustomerExportHandler, DownloadCustomerExportHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.mgmt"]);
    assert.equal(Handler.api.requestSchema.params.additionalProperties, false);
    assert.equal(Handler.api.requestSchema.query.additionalProperties, false);
  }
  assert.equal(CreateCustomerExportHandler.api.authType, "jwt-password");
  assert.equal(CreateCustomerExportHandler.api.idempotency.enabled, true);
  assert.equal(CreateCustomerExportHandler.api.requestSchema.body.additionalProperties, false);
  assert.equal(CreateCustomerExportHandler.api.requestSchema.body.properties.filters.additionalProperties, false);
  assert.equal(DownloadCustomerExportHandler.api.download.enabled, true);
  assert.equal(CreateCustomerExportHandler.api.path, "/api/v1/customer-exports/create");
  assert.equal(GetCustomerExportHandler.api.path, "/api/v1/customer-exports/:id");
  assert.equal(DownloadCustomerExportHandler.api.path, "/api/v1/customer-exports/:id/result");
});

test("Customer export create forwards the durable idempotency key and excludes the password", async () => {
  let received;
  const handler = Object.create(CreateCustomerExportHandler.prototype);
  handler.customerExport = { async create(input) { received = input; return { id: 3 }; } };
  await handler.execute({
    auth: { claims: { sub: "7", roles: [], permissions: [] } },
    input: { body: { password: "secret", filters: { q: "Acme" } } },
    get(name) { return name === "Idempotency-Key" ? "export-3" : undefined; }, requestId: "request-1", ip: "127.0.0.1"
  });
  assert.equal(received.idempotencyKey, "export-3");
  assert.deepEqual(received.filters, { q: "Acme" });
  assert.equal(Object.hasOwn(received, "password"), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { DownloadCustomerImportTemplateHandler } from "../src/handlers/customer-imports/downloadCustomerImportTemplateHandler.js";
import { DownloadCustomerImportResultHandler } from "../src/handlers/customer-imports/downloadCustomerImportResultHandler.js";
import { CancelCustomerImportHandler } from "../src/handlers/customer-imports/cancelCustomerImportHandler.js";
import { ConfirmCustomerImportHandler } from "../src/handlers/customer-imports/confirmCustomerImportHandler.js";
import { GetCustomerImportHandler } from "../src/handlers/customer-imports/getCustomerImportHandler.js";
import { ListCustomerImportsHandler } from "../src/handlers/customer-imports/listCustomerImportsHandler.js";
import { UploadCustomerImportHandler } from "../src/handlers/customer-imports/uploadCustomerImportHandler.js";

const handlers = [DownloadCustomerImportTemplateHandler, DownloadCustomerImportResultHandler, UploadCustomerImportHandler, ListCustomerImportsHandler, GetCustomerImportHandler, ConfirmCustomerImportHandler, CancelCustomerImportHandler];

test("Customer import handlers enforce management permissions and strict schemas", () => {
  for (const Handler of handlers) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.mgmt"]);
    assert.equal(Handler.api.requestSchema.params.additionalProperties, false);
    assert.equal(Handler.api.requestSchema.query.additionalProperties, false);
  }
  assert.equal(UploadCustomerImportHandler.api.idempotency.enabled, true);
  assert.equal(ConfirmCustomerImportHandler.api.authType, "jwt-password");
  assert.equal(ConfirmCustomerImportHandler.api.idempotency.enabled, true);
  assert.equal(CancelCustomerImportHandler.api.idempotency.enabled, true);
  assert.equal(UploadCustomerImportHandler.api.upload.memoryOnly, true);
  assert.equal(UploadCustomerImportHandler.api.upload.maxFiles, 1);
  assert.equal(UploadCustomerImportHandler.api.upload.maxFileSizeBytes, 20 * 1024 * 1024);
  assert.equal(UploadCustomerImportHandler.api.requestSchema.body.additionalProperties, false);
  assert.equal(DownloadCustomerImportTemplateHandler.api.download.enabled, true);
  assert.equal(DownloadCustomerImportResultHandler.api.download.enabled, true);
});

test("Customer import route contract keeps static template ahead of parameter detail", () => {
  assert.equal(DownloadCustomerImportTemplateHandler.api.path, "/api/v1/customer-imports/template");
  assert.equal(UploadCustomerImportHandler.api.path, "/api/v1/customer-imports/upload");
  assert.equal(ListCustomerImportsHandler.api.path, "/api/v1/customer-imports");
  assert.equal(GetCustomerImportHandler.api.path, "/api/v1/customer-imports/:id");
  assert.equal(ConfirmCustomerImportHandler.api.path, "/api/v1/customer-imports/:id/confirm");
  assert.equal(CancelCustomerImportHandler.api.path, "/api/v1/customer-imports/:id/cancel");
  assert.equal(DownloadCustomerImportResultHandler.api.path, "/api/v1/customer-imports/:id/result");
});

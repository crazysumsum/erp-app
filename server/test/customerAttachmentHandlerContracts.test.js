import assert from "node:assert/strict";
import test from "node:test";

import * as handlers from "../src/handlers/customers/customerAttachmentHandlers.js";

test("TC-055/056 Customer attachment routes declare strict auth, upload and download contracts", () => {
  const values = Object.values(handlers).filter((value) => typeof value === "function" && value.api);
  assert.equal(values.length, 9);
  for (const Handler of values) {
    for (const schema of Object.values(Handler.api.requestSchema)) assert.equal(schema.additionalProperties, false, Handler.handlerName);
  }
  assert.equal(handlers.UploadCustomerAttachmentHandler.api.upload.memoryOnly, true);
  assert.equal(handlers.UploadCustomerAttachmentHandler.api.upload.maxFiles, 1);
  assert.deepEqual(handlers.UploadCustomerAttachmentHandler.api.authorizationPolicies[0].options.permissions, ["customer.view"]);
  assert.equal(handlers.AuthorizeCustomerAttachmentUploadHandler.api.authType, "jwt-device-password");
  assert.deepEqual(handlers.AuthorizeCustomerAttachmentUploadHandler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.bank.view", "customer.bank.mgmt"]);
  assert.equal(handlers.AuthorizeCustomerAttachmentDownloadHandler.api.authType, "jwt-password");
  assert.deepEqual(handlers.AuthorizeCustomerAttachmentDownloadHandler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.bank.view"]);
  assert.equal(handlers.DeleteCustomerAttachmentHandler.api.authType, "jwt-device-password");
  assert.equal(handlers.DownloadCustomerAttachmentHandler.api.download.enabled, true);
  assert.equal(handlers.PreviewCustomerAttachmentHandler.api.download.enabled, true);
});

test("TC-056 attachment downloads set safe headers and honor one bounded byte range", async () => {
  const handler = Object.create(handlers.DownloadCustomerAttachmentHandler.prototype);
  handler.handlerName = "downloadCustomerAttachment";
  handler.attachments = { async read() { return { attachment: { originalFilename: "contract.pdf", mimeType: "application/pdf" }, content: Buffer.from("0123456789") }; } };
  const headers = new Map();
  const req = {
    auth: { claims: { sub: "1", roles: [], permissions: ["customer.view"] } }, requestId: "req", ip: "127.0.0.1",
    input: { params: { id: "7", attachmentId: "9" } },
    get(name) { return String(name).toLowerCase() === "range" ? "bytes=2-5" : undefined; }
  };
  const result = await handler.execute(req, { setHeader(name, value) { headers.set(name.toLowerCase(), value); } });

  assert.deepEqual(result.buffer, Buffer.from("2345"));
  assert.equal(result.statusCode, 206);
  assert.equal(headers.get("pragma"), "no-cache");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.equal(headers.get("accept-ranges"), "bytes");
  assert.equal(headers.get("content-range"), "bytes 2-5/10");
});

import assert from "node:assert/strict";
import test from "node:test";

import { secretValue } from "../src/framework/configuration/SecretValue.js";
import { CustomerAttachmentAccessToken, customerAttachmentUploadBinding } from "../src/modules/customer/CustomerAttachmentAccessToken.js";

test("Customer attachment access tokens are signed, actor/file bound and expire", () => {
  let now = 1000;
  const tokens = new CustomerAttachmentAccessToken({
    encryption: { activeKeyId: "v1", keyRing: { v1: secretValue(Buffer.alloc(32, 7).toString("base64")) } },
    time: { nowMs: () => now }, ttlMs: 100
  });
  const issued = tokens.issue({ purpose: "download", actorId: 1, customerId: 7, attachmentId: 9, mode: "preview" });

  assert.equal(tokens.verify(issued.token, { purpose: "download", actorId: 1, customerId: 7, attachmentId: 9, mode: "preview" }).actorId, 1);
  assert.throws(() => tokens.verify(issued.token, { purpose: "download", actorId: 2 }), /operation failed/u);
  assert.throws(() => tokens.verify(`${issued.token}x`, { purpose: "download", actorId: 1 }), /operation failed/u);
  now = 1101;
  assert.throws(() => tokens.verify(issued.token, { purpose: "download", actorId: 1 }), /operation failed/u);
});

test("sensitive upload binding covers the file and all submitted metadata", () => {
  const upload = {
    contentSha256: "a".repeat(64), displayName: "Proof", documentType: "bank_proof",
    mimeType: "application/pdf", notes: "original", originalFilename: "proof.pdf",
    reason: "upload bank proof", sensitivity: "bank_sensitive", sortOrder: 1
  };
  const binding = customerAttachmentUploadBinding(upload);

  for (const [field, value] of [["contentSha256", "b".repeat(64)], ["notes", "changed"], ["reason", "changed reason"], ["sortOrder", 2]]) {
    assert.notEqual(customerAttachmentUploadBinding({ ...upload, [field]: value }), binding);
  }
});

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mysql from "mysql2/promise";

import { CustomerAttachmentRecoveryService, CustomerAttachmentService } from "../../src/modules/customer/CustomerAttachmentService.js";
import { normalizeCustomerConfig } from "../../src/modules/customer/normalizeCustomerConfig.js";
import { CustomerAttachmentStorage } from "../../src/services/customerFile/CustomerAttachmentStorage.js";
import { FileTypeService } from "../../src/services/filetype/FileTypeService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PDF = Buffer.from("%PDF-1.7\nprivate customer contract\n%%EOF\n");

integrationTest("Customer attachment upload is encrypted, durable, replay-safe and operation-complete", async (t) => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "customer-attachment-integration-"));
  const suffix = randomUUID().slice(0, 8); const now = Date.now();
  const [user] = await connection.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [`attachment-service-${suffix}`, "unused", "Attachment Service Test", now, now]
  );
  const userId = Number(user.insertId);
  const [customer] = await connection.execute(
    "INSERT INTO customers (customer_code,customer_code_key,legal_name,legal_name_key,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    [`ATS-${suffix}`, `ats-${suffix}`, `Attachment Service ${suffix}`, `attachment service ${suffix}`, now, now]
  );
  const customerId = Number(customer.insertId); const cleanup = { operationIds: [] };
  t.after(async () => {
    await connection.execute("DELETE FROM customer_audit_logs WHERE customer_id = ?", [customerId]);
    await connection.execute("DELETE FROM customers WHERE id = ?", [customerId]);
    for (const id of cleanup.operationIds) await connection.execute("DELETE FROM customer_operation_requests WHERE id = ?", [id]);
    await connection.execute("DELETE FROM users WHERE id = ?", [userId]);
    await connection.end(); await rm(root, { recursive: true, force: true });
  });
  const database = {
    query: connection.query.bind(connection),
    async withTransaction(work) {
      await connection.beginTransaction();
      try { const result = await work(connection); await connection.commit(); return result; }
      catch (error) { await connection.rollback(); throw error; }
    }
  };
  const config = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "enc", keyRing: { enc: randomBytes(32).toString("base64") } },
    bankLookup: { activeKeyId: "lookup", keyRing: { lookup: randomBytes(32).toString("base64") } },
    attachment: {
      generalRoot: path.join(root, "general"), bankSensitiveRoot: path.join(root, "bank"), tempRoot: path.join(root, "temp"),
      malwareScanner: { mode: "clamd", host: "127.0.0.1", port: 3310, timeoutMs: 1000 }
    }
  });
  const storage = new CustomerAttachmentStorage({
    config: config.attachment, encryption: config.bankEncryption,
    scanner: { async scan() { return { status: "clean" }; } }, fileTypes: new FileTypeService()
  });
  const service = new CustomerAttachmentService({
    database, storage, time: { nowMs: () => Date.now() },
    authorize: async () => ({ username: `attachment-service-${suffix}`, permissions: ["customer.view", "customer.mgmt"] })
  });
  const request = {
    actorId: userId, claimedRoles: [], claimedPermissions: ["customer.view", "customer.mgmt"],
    idempotencyKey: randomUUID(), customerId, displayName: "Contract", documentType: "contract", sensitivity: "general",
    originalFilename: "contract.pdf", mimeType: "application/pdf", content: PDF, notes: "", sortOrder: 0,
    reason: "integration attachment upload", requestId: randomUUID(), ip: "127.0.0.1"
  };
  const created = await service.create(request);
  const replay = await service.create(request);
  assert.equal(replay.id, created.id);
  const [[row]] = await connection.query("SELECT operation_id,stored_name,status,version FROM customer_attachments WHERE id = ?", [created.id]);
  const operationId = row.operation_id; cleanup.operationIds.push(operationId);
  assert.equal(row.status, "active"); assert.equal(Number(row.version), 2);
  const [[operation]] = await connection.query("SELECT status,resource_type,resource_id,result_version FROM customer_operation_requests WHERE id = ?", [operationId]);
  assert.deepEqual({ status: operation.status, resourceType: operation.resource_type, resourceId: Number(operation.resource_id), resultVersion: Number(operation.result_version) },
    { status: "succeeded", resourceType: "customer_attachment", resourceId: created.id, resultVersion: 2 });
  const encrypted = await readFile(path.join(root, "general", row.stored_name));
  assert.equal(encrypted.includes(PDF), false);
  const listed = await service.list(request);
  assert.deepEqual(listed.items.map(({ id }) => id), [created.id]);
  assert.equal(listed.restrictedCount, 0);
  const downloaded = await service.read({ ...request, attachmentId: created.id, mode: "download" });
  assert.deepEqual(downloaded.content, PDF);
  const updated = await service.update({
    ...request, attachmentId: created.id, displayName: "Signed Contract", documentType: "contract",
    notes: "signed", sortOrder: 2, version: created.version, reason: "update attachment metadata"
  });
  assert.equal(updated.version, 3);
  const inactive = await service.deactivate({ ...request, attachmentId: created.id, version: updated.version, reason: "deactivate old contract" });
  assert.equal(inactive.status, "inactive");
  assert.deepEqual(await service.delete({ ...request, attachmentId: created.id, version: inactive.version, reason: "delete unreferenced draft attachment" }), { deleted: true });
  await assert.rejects(() => readFile(path.join(root, "general", row.stored_name)), (error) => error.code === "ENOENT");
  const [[count]] = await connection.query("SELECT COUNT(*) AS count FROM customer_attachments WHERE operation_id = ?", [operationId]);
  assert.equal(Number(count.count), 0);
  const [[stageCount]] = await connection.query("SELECT COUNT(*) AS count FROM customer_attachment_stages WHERE operation_id = ?", [operationId]);
  assert.equal(Number(stageCount.count), 0);

  const stagedId = randomUUID(); const stagedName = "c".repeat(64); cleanup.operationIds.push(stagedId);
  await connection.execute(
    "INSERT INTO customer_operation_requests (id,actor_user_id,route_key,idempotency_key,payload_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,'processing',?,?)",
    [stagedId, userId, "customer.attachment.upload", randomUUID(), randomBytes(32), now - 1000, now - 1000]
  );
  await connection.execute(
    "INSERT INTO customer_attachment_stages (operation_id,stored_name,created_at,updated_at) VALUES (?,?,?,?)",
    [stagedId, stagedName, now - 1000, now - 1000]
  );
  const discarded = [];
  const stageRecovery = new CustomerAttachmentRecoveryService({
    database, storage: { async discardTemp(value) { discarded.push(value.storedName); } }, time: { nowMs: () => now }
  });
  assert.deepEqual(await stageRecovery.cleanupStaleStages({ cutoffMs: now - 1 }), { processed: 1, cleaned: 1, failed: 0 });
  const [[stagedOperation]] = await connection.query("SELECT status,error_code FROM customer_operation_requests WHERE id = ?", [stagedId]);
  const [[remainingStage]] = await connection.query("SELECT COUNT(*) AS count FROM customer_attachment_stages WHERE operation_id = ?", [stagedId]);
  assert.deepEqual(stagedOperation, { status: "failed", error_code: "CUSTOMER_ATTACHMENT_ABANDONED" });
  assert.equal(Number(remainingStage.count), 0); assert.deepEqual(discarded, [stagedName]);

  const abandonedId = randomUUID(); cleanup.operationIds.push(abandonedId);
  await connection.execute(
    "INSERT INTO customer_operation_requests (id,actor_user_id,route_key,idempotency_key,payload_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,'processing',?,?)",
    [abandonedId, userId, "customer.attachment.upload", randomUUID(), randomBytes(32), now - 1000, now - 1000]
  );
  const recovery = new CustomerAttachmentRecoveryService({ database, storage: {}, time: { nowMs: () => now } });
  assert.deepEqual(await recovery.failAbandonedOperations({ cutoffMs: now - 1 }), { failed: 1 });
  const [[abandoned]] = await connection.query("SELECT status,error_code FROM customer_operation_requests WHERE id = ?", [abandonedId]);
  assert.deepEqual(abandoned, { status: "failed", error_code: "CUSTOMER_ATTACHMENT_ABANDONED" });
});

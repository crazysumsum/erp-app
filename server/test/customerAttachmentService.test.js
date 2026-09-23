import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  CustomerAttachmentRecoveryService,
  CustomerAttachmentService
} from "../src/modules/customer/CustomerAttachmentService.js";

const PDF = Buffer.from("%PDF-1.7\nattachment\n%%EOF\n");
const metadata = {
  storedName: "a".repeat(64), mimeType: "application/pdf", extension: "pdf", sizeBytes: PDF.length,
  sha256: Buffer.alloc(32, 1), storageClass: "general_private", scanStatus: "clean"
};

function createHarness({ finalizeError = null, authorize = null, replay = null } = {}) {
  const events = [];
  const operationId = randomUUID();
  const row = {
    id: 9, customer_id: 7, display_name: "Contract", document_type: "contract", sensitivity: "general",
    original_filename: "contract.pdf", mime_type: "application/pdf", extension: "pdf", size_bytes: PDF.length,
    storage_class: "general_private", scan_status: "clean", status: "active", sort_order: 0, notes: "", version: 2,
    updated_at: 101
  };
  const connection = {
    async query(sql) {
      events.push(["query", String(sql)]);
      if (String(sql).includes("FROM customer_operation_requests")) return [[{ status: "processing" }]];
      if (String(sql).includes("FROM customers")) return [[{ id: 7, customer_code: "CUS-7" }]];
      if (String(sql).includes("FROM customer_attachments")) return [[row]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", String(sql), params]);
      if (String(sql).includes("INSERT INTO customer_attachments")) return [{ insertId: 9 }];
      if (String(sql).includes("UPDATE customer_attachments")) {
        row.status = params[0]; row.version += 1;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const database = {
    async query(sql) { events.push(["query", String(sql)]); return [row.status ? [row] : []]; },
    async withTransaction(work) {
      events.push(["transaction", "begin"]);
      const result = await work(connection);
      events.push(["transaction", "commit"]);
      return result;
    }
  };
  const storage = {
    async stage() { events.push(["storage", "stage"]); return metadata; },
    async finalize() { events.push(["storage", "finalize"]); if (finalizeError) throw finalizeError; },
    async discardTemp() { events.push(["storage", "discard"]); }
  };
  const service = new CustomerAttachmentService({
    database, storage, time: { nowMs: () => 101 },
    authorize: authorize ?? (async () => ({ username: "sam", permissions: ["customer.view", "customer.mgmt"] })),
    audit: { async record(_connection, input) { events.push(["audit", input]); } },
    operations: {
      async begin() { events.push(["operation", "begin"]); return { operationId, replay }; },
      async succeed() { events.push(["operation", "succeed"]); },
      async fail() { events.push(["operation", "fail"]); }
    }
  });
  return { service, events, row, operationId };
}

function input(overrides = {}) {
  return {
    actorId: 1, claimedRoles: [], claimedPermissions: ["customer.view", "customer.mgmt"],
    idempotencyKey: randomUUID(), customerId: 7, displayName: "Contract", documentType: "contract",
    sensitivity: "general", originalFilename: "../contract.pdf", mimeType: "application/pdf", content: PDF,
    notes: "", sortOrder: 0, reason: "upload customer contract", requestId: "req-1", ip: "127.0.0.1",
    ...overrides
  };
}

test("Customer attachment upload performs storage work outside transactions and commits processing before active", async () => {
  const { service, events } = createHarness();
  const result = await service.create(input());
  assert.equal(result.status, "active");
  assert.equal(result.originalFilename, "contract.pdf");
  assert.deepEqual(events.filter(([kind]) => kind === "storage").map((event) => event[1]), ["stage", "finalize"]);
  let inTransaction = false;
  for (const [kind, value] of events) {
    if (kind === "transaction") inTransaction = value === "begin";
    if (kind === "storage") assert.equal(inTransaction, false);
  }
  const index = (kind, value) => events.findIndex((event) => event[0] === kind && String(event[1]).includes(value));
  assert.ok(index("execute", "INSERT INTO customer_attachment_stages") < index("storage", "stage"));
  assert.ok(index("storage", "stage") < index("execute", "INSERT INTO customer_attachments"));
  assert.ok(index("execute", "DELETE FROM customer_attachment_stages") < index("storage", "finalize"));
  assert.ok(index("storage", "finalize") < index("operation", "succeed"));
  assert.equal(events.some(([kind, value]) => kind === "operation" && value === "succeed"), true);
  assert.equal(events.filter(([kind]) => kind === "audit").length, 2);
  assert.equal(JSON.stringify(events.filter(([kind]) => kind === "audit")).includes("contract.pdf"), false);
});

test("Customer attachment upload records storage_error when atomic finalize fails", async () => {
  const { service, events, row } = createHarness({ finalizeError: new Error("disk unavailable") });
  await assert.rejects(() => service.create(input()), (error) => error.publicCode === "CUSTOMER_ATTACHMENT_STORAGE_FAILED" && error.statusCode === 503);
  assert.equal(row.status, "storage_error");
  assert.equal(events.filter(([kind]) => kind === "audit").at(-1)[1].detail.after.status, "storage_error");
  assert.equal(events.some(([kind, value]) => kind === "operation" && value === "fail"), true);
});

test("Customer attachment upload enforces sensitive permissions before touching storage", async () => {
  const { service, events } = createHarness();
  await assert.rejects(
    () => service.create(input({ documentType: "bank_proof", sensitivity: "bank_sensitive" })),
    (error) => error.publicCode === "CUSTOMER_ATTACHMENT_PERMISSION_LOST"
  );
  assert.equal(events.some(([kind]) => kind === "storage"), false);
  assert.equal(events.find(([kind]) => kind === "audit")[1].detail.after.status, "denied");
});

test("Customer attachment upload distinguishes rejected content from scanner or storage outage", async () => {
  for (const [code, expectedCode, expectedStatus] of [
    ["CUSTOMER_ATTACHMENT_REJECTED", "CUSTOMER_ATTACHMENT_REJECTED", 422],
    ["ECONNREFUSED", "CUSTOMER_ATTACHMENT_STORAGE_UNAVAILABLE", 503]
  ]) {
    const fixture = createHarness();
    fixture.service.storage.stage = async () => { throw Object.assign(new Error("failed"), { code }); };
    await assert.rejects(() => fixture.service.create(input()), (error) => error.publicCode === expectedCode && error.statusCode === expectedStatus);
    assert.equal(fixture.events.some(([kind]) => kind === "audit"), true);
  }
});

test("Customer attachment upload does not publish a finalized object after permission revocation", async () => {
  let checks = 0;
  const { service, row, events } = createHarness({ authorize: async () => ({
    username: "sam", permissions: ++checks < 3 ? ["customer.view", "customer.mgmt"] : []
  }) });
  await assert.rejects(() => service.create(input()), (error) => error.publicCode === "CUSTOMER_ATTACHMENT_PERMISSION_LOST");
  assert.equal(row.status, "inactive");
  assert.equal(checks, 3);
  assert.equal(events.some(([kind, value]) => kind === "operation" && value === "fail"), true);
});

test("Customer attachment upload discards staged data when metadata commit is rejected", async () => {
  let checks = 0;
  const { service, events } = createHarness({ authorize: async () => {
    checks += 1;
    if (checks === 2) throw Object.assign(new Error("revoked"), { publicCode: "PERMISSION_STALE" });
    return { username: "sam", permissions: ["customer.view", "customer.mgmt"] };
  } });
  await assert.rejects(() => service.create(input()), (error) => error.publicCode === "PERMISSION_STALE");
  assert.equal(events.some(([kind, value]) => kind === "storage" && value === "discard"), true);
});

test("Customer attachment upload replays an active durable operation without touching storage", async () => {
  const fixture = createHarness({ replay: { status: "succeeded" } });
  assert.equal((await fixture.service.create(input())).status, "active");
  assert.equal(fixture.events.some(([kind]) => kind === "storage"), false);
});

test("Customer attachment upload exposes a failed durable operation as terminal conflict", async () => {
  const fixture = createHarness({ replay: { status: "failed" } });
  fixture.row.status = "storage_error";
  await assert.rejects(() => fixture.service.create(input()), (error) => error.publicCode === "CUSTOMER_ATTACHMENT_OPERATION_CONFLICT");
  assert.equal(fixture.events.some(([kind]) => kind === "storage"), false);
});

test("Customer attachment recovery performs file recovery outside its short CAS transaction", async () => {
  const events = [];
  const rows = [
    { id: 10, customer_id: 7, operation_id: randomUUID(), stored_name: "a".repeat(64), sensitivity: "general", size_bytes: 8, sha256: Buffer.alloc(32), scan_status: "clean", version: 1 },
    { id: 11, customer_id: 8, operation_id: randomUUID(), stored_name: "b".repeat(64), sensitivity: "bank_sensitive", size_bytes: 9, sha256: Buffer.alloc(32), scan_status: "error", version: 2 }
  ];
  const connection = {
    async execute(_sql, params) { events.push(["update", params[2], params[0]]); return [{ affectedRows: 1 }]; }
  };
  const database = {
    async query() { return [rows]; },
    async withTransaction(work) { events.push(["tx", "begin"]); const result = await work(connection); events.push(["tx", "commit"]); return result; }
  };
  const service = new CustomerAttachmentRecoveryService({
    database, time: { nowMs: () => 200 },
    storage: { async recover(value) { events.push(["recover", value.storedName]); return value.storedName.startsWith("a") ? "active" : "storage_error"; } },
    audit: { async record() {} },
    operations: {
      async succeed() { events.push(["operation", "succeed"]); },
      async fail() { events.push(["operation", "fail"]); }
    }
  });
  assert.deepEqual(await service.recoverBatch({ staleBeforeMs: 100 }), { processed: 2, activated: 1, failed: 1, lastId: 11 });
  assert.deepEqual(events.map(([kind]) => kind), ["recover", "tx", "update", "operation", "tx", "tx", "update", "operation", "tx"]);
});

test("Customer attachment recovery cleans a bounded durable stage outside its transaction", async () => {
  const events = []; const operationId = randomUUID(); const storedName = "a".repeat(64);
  const connection = {
    async query(sql) {
      if (String(sql).includes("customer_operation_requests")) return [[{ status: "processing" }]];
      if (String(sql).includes("customer_attachment_stages")) return [[{ stored_name: storedName, updated_at: 90 }]];
      return [[]];
    },
    async execute(sql) { events.push(["delete", String(sql)]); return [{ affectedRows: 1 }]; }
  };
  const service = new CustomerAttachmentRecoveryService({
    database: {
      async query() { return [[{ operation_id: operationId, stored_name: storedName }]]; },
      async withTransaction(work) { events.push(["tx", "begin"]); const value = await work(connection); events.push(["tx", "commit"]); return value; }
    },
    time: { nowMs: () => 1 },
    storage: { async discardTemp(value) { events.push(["discard", value.storedName]); } },
    operations: { async fail() { events.push(["operation", "fail"]); } }
  });
  assert.deepEqual(await service.cleanupStaleStages({ cutoffMs: 100 }), { processed: 1, cleaned: 1, failed: 0 });
  const discard = events.findIndex(([kind]) => kind === "discard");
  const finalDelete = events.findLastIndex(([kind]) => kind === "delete");
  assert.ok(events.findIndex(([kind]) => kind === "operation") < discard && discard < finalDelete);
});

test("Customer attachment recovery releases a stale stage when attachment metadata exists", async () => {
  let discarded = 0; let failed = 0; let deleted = 0;
  const operationId = randomUUID(); const storedName = "b".repeat(64);
  const connection = {
    async query(sql) {
      if (String(sql).includes("customer_operation_requests")) return [[{ status: "processing" }]];
      if (String(sql).includes("customer_attachment_stages")) return [[{ stored_name: storedName, updated_at: 90 }]];
      return [[{ id: 9 }]];
    },
    async execute() { deleted += 1; return [{ affectedRows: 1 }]; }
  };
  const service = new CustomerAttachmentRecoveryService({
    database: { async query() { return [[{ operation_id: operationId, stored_name: storedName }]]; }, async withTransaction(work) { return work(connection); } },
    time: { nowMs: () => 1 },
    storage: { async discardTemp() { discarded += 1; } },
    operations: { async fail() { failed += 1; } }
  });
  assert.deepEqual(await service.cleanupStaleStages({ cutoffMs: 100 }), { processed: 1, cleaned: 1, failed: 0 });
  assert.equal(discarded, 0); assert.equal(failed, 0); assert.equal(deleted, 1);
});

test("Customer attachment recovery retains its durable stage when temp deletion fails", async () => {
  let deleted = 0; let failedOperation = 0;
  const operationId = randomUUID(); const storedName = "c".repeat(64);
  const connection = {
    async query(sql) {
      if (String(sql).includes("customer_operation_requests")) return [[{ status: "processing" }]];
      if (String(sql).includes("customer_attachment_stages")) return [[{ stored_name: storedName, updated_at: 90 }]];
      return [[]];
    },
    async execute() { deleted += 1; return [{ affectedRows: 1 }]; }
  };
  const service = new CustomerAttachmentRecoveryService({
    database: { async query() { return [[{ operation_id: operationId, stored_name: storedName }]]; }, async withTransaction(work) { return work(connection); } },
    time: { nowMs: () => 1 }, storage: { async discardTemp() { throw new Error("disk unavailable"); } },
    operations: { async fail() { failedOperation += 1; } }
  });
  assert.deepEqual(await service.cleanupStaleStages({ cutoffMs: 100 }), { processed: 1, cleaned: 0, failed: 1 });
  assert.equal(failedOperation, 1); assert.equal(deleted, 0);
});

test("Customer attachment recovery fails abandoned durable operations without attachment metadata", async () => {
  const failed = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customer_operation_requests")) return [[{ id: "operation-1" }]];
      return [[]];
    }
  };
  const service = new CustomerAttachmentRecoveryService({
    database: {
      async query() { return [[{ id: "operation-1" }]]; },
      async withTransaction(work) { return work(connection); }
    },
    time: { nowMs: () => 200 }, storage: {},
    operations: { async fail(_connection, value) { failed.push(value); } }
  });
  assert.deepEqual(await service.failAbandonedOperations({ cutoffMs: 100 }), { failed: 1 });
  assert.deepEqual(failed, [{ operationId: "operation-1", errorCode: "CUSTOMER_ATTACHMENT_ABANDONED", nowMs: 200 }]);
});

test("Customer attachment recovery rechecks metadata under the operation lock before failing it", async () => {
  let failed = 0;
  const connection = { async query(sql) {
    if (String(sql).includes("FROM customer_operation_requests")) return [[{ id: "operation-1" }]];
    if (String(sql).includes("FROM customer_attachments")) return [[{ id: 9 }]];
    return [[]];
  } };
  const service = new CustomerAttachmentRecoveryService({
    database: {
      async query() { return [[{ id: "operation-1" }]]; },
      async withTransaction(work) { return work(connection); }
    },
    time: { nowMs: () => 200 }, storage: {},
    operations: { async fail() { failed += 1; } }
  });
  assert.deepEqual(await service.failAbandonedOperations({ cutoffMs: 100 }), { failed: 0 });
  assert.equal(failed, 0);
});

test("Customer attachment list hides every sensitive metadata field without bank.view", async () => {
  const rows = [
    { id: 1, customer_id: 7, display_name: "Contract", document_type: "contract", sensitivity: "general", original_filename: "contract.pdf", mime_type: "application/pdf", extension: "pdf", size_bytes: 8, storage_class: "general_private", scan_status: "clean", status: "active", sort_order: 0, notes: "", version: 1, updated_at: 1 },
    { id: 2, customer_id: 7, display_name: "Secret bank proof", document_type: "bank_proof", sensitivity: "bank_sensitive", original_filename: "secret.pdf", mime_type: "application/pdf", extension: "pdf", size_bytes: 9, storage_class: "bank_sensitive_private", scan_status: "clean", status: "active", sort_order: 1, notes: "", version: 1, updated_at: 1 }
  ];
  const audits = [];
  const connection = { async query(sql) { return String(sql).includes("FROM customers") ? [[{ id: 7, customer_code: "CUS-7" }]] : [rows]; } };
  const service = new CustomerAttachmentService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 1 }, storage: {},
    authorize: async () => ({ username: "viewer", permissions: ["customer.view"] }),
    audit: { async record(_connection, value) { audits.push(value); } }
  });

  const result = await service.list(input());
  assert.deepEqual(result.items.map(({ id }) => id), [1]);
  assert.equal(result.restrictedCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret|bank_proof|secret\.pdf/u);
  assert.equal(audits[0].action, "attachment.view");
});

test("Customer attachment failure audits are owner-safe and contain no attachment metadata", async () => {
  const audits = [];
  const connection = { async query(sql) {
    if (String(sql).includes("FROM customers")) return [[{ id: 7 }]];
    return [[]];
  } };
  const service = new CustomerAttachmentService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 1 }, storage: {},
    audit: { async record(_connection, value) { audits.push(value); } }
  });

  await service.auditFailure({ ...input(), action: "attachment.download", attachmentId: 999, sensitivity: "bank_sensitive", errorCode: "CUSTOMER_ATTACHMENT_NOT_FOUND" });

  assert.deepEqual(audits[0].detail, { after: { sensitivity: "bank_sensitive", status: "failed", errorCode: "CUSTOMER_ATTACHMENT_NOT_FOUND" } });
  assert.equal(audits[0].customerId, 7);
  assert.doesNotMatch(JSON.stringify(audits[0]), /filename|stored|path|token|password/iu);
});

test("Customer attachment read commits its audit before opening general content", async () => {
  const events = [];
  const row = { id: 9, customer_id: 7, operation_id: randomUUID(), stored_name: "a".repeat(64), display_name: "Contract", document_type: "contract", sensitivity: "general", original_filename: "contract.pdf", mime_type: "application/pdf", extension: "pdf", size_bytes: PDF.length, sha256: Buffer.alloc(32), storage_class: "general_private", scan_status: "clean", status: "active", sort_order: 0, notes: "", version: 1, updated_at: 1 };
  const connection = { async query() { return [[row]]; } };
  const service = new CustomerAttachmentService({
    database: { async withTransaction(work) { events.push("begin"); const value = await work(connection); events.push("commit"); return value; } },
    time: { nowMs: () => 1 }, authorize: async () => ({ username: "viewer", permissions: ["customer.view"] }),
    audit: { async record() { events.push("audit"); } }, storage: { async read() { events.push("read"); return PDF; } }
  });

  assert.deepEqual((await service.read({ ...input(), attachmentId: 9, mode: "download" })).content, PDF);
  assert.deepEqual(events, ["begin", "audit", "commit", "read"]);
});

test("Sensitive attachment sessions are audited once and bound before file reads", async () => {
  const events = [];
  const row = { id: 9, customer_id: 7, operation_id: randomUUID(), stored_name: "a".repeat(64), display_name: "Proof", document_type: "bank_proof", sensitivity: "bank_sensitive", original_filename: "proof.pdf", mime_type: "application/pdf", extension: "pdf", size_bytes: PDF.length, sha256: Buffer.alloc(32), storage_class: "bank_sensitive_private", scan_status: "clean", status: "active", sort_order: 0, notes: "", version: 1, updated_at: 1 };
  const connection = { async query() { return [[row]]; } };
  const accessTokens = {
    issue(claims) { events.push("issue"); return { token: "signed", expiresAt: 2, claims }; },
    verify(token, expected) { events.push("verify"); assert.equal(token, "signed"); assert.equal(expected.attachmentId, 9); }
  };
  const service = new CustomerAttachmentService({
    database: { async withTransaction(work) { events.push("begin"); const value = await work(connection); events.push("commit"); return value; } },
    time: { nowMs: () => 1 }, accessTokens,
    authorize: async () => ({ username: "bank", permissions: ["customer.view", "customer.bank.view"] }),
    audit: { async record() { events.push("audit"); } }, storage: { async read() { events.push("read"); return PDF; } }
  });

  await service.issueDownloadSession({ ...input(), attachmentId: 9, mode: "preview" });
  await service.read({ ...input(), attachmentId: 9, mode: "preview", sessionToken: "signed" });
  assert.deepEqual(events, ["begin", "audit", "issue", "commit", "begin", "verify", "commit", "read"]);
});

test("Customer attachment delete marks and audits before deleting bytes, then removes metadata", async () => {
  const events = [];
  const row = { id: 9, customer_id: 7, stored_name: "a".repeat(64), sensitivity: "general", status: "inactive", version: 2 };
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 7, status: "draft", ever_activated_at: null }]];
      return [[row]];
    },
    async execute(sql) { events.push(String(sql).startsWith("DELETE") ? "metadata-delete" : "mark-deleting"); return [{ affectedRows: 1 }]; }
  };
  const service = new CustomerAttachmentService({
    database: { async withTransaction(work) { events.push("begin"); const value = await work(connection); events.push("commit"); return value; } },
    time: { nowMs: () => 1 }, authorize: async () => ({ username: "manager", permissions: ["customer.view", "customer.mgmt"] }),
    isReferenced: async () => false, audit: { async record() { events.push("audit"); } },
    storage: { async delete() { events.push("file-delete"); } }
  });

  assert.deepEqual(await service.delete({ ...input(), attachmentId: 9, version: 2 }), { deleted: true });
  assert.deepEqual(events, ["begin", "mark-deleting", "audit", "commit", "file-delete", "begin", "metadata-delete", "commit"]);
});

test("Customer attachment delete retry never removes metadata when physical deletion fails", async () => {
  let metadataDeletes = 0;
  const service = new CustomerAttachmentRecoveryService({
    database: {
      async query() { return [[{ id: 9, customer_id: 7, stored_name: "a".repeat(64), sensitivity: "general", status: "delete_failed", version: 3 }]]; },
      async withTransaction(work) { return work({ async execute() { metadataDeletes += 1; return [{ affectedRows: 1 }]; } }); }
    }, time: { nowMs: () => 1 }, storage: { async delete() { throw new Error("disk unavailable"); } }
  });
  assert.deepEqual(await service.retryDeletes(), { processed: 1, deleted: 0, failed: 1 });
  assert.equal(metadataDeletes, 0);
});

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { CustomerExportService } from "../src/modules/customer/CustomerExportService.js";

function job(overrides = {}) {
  return {
    id: 7, idempotency_key: "export-7", operation_id: randomUUID(), filter_snapshot: { q: "Acme" },
    result_stored_name: "a".repeat(64), result_sha256: null, result_storage_status: "processing",
    status: "processing", total_count: 0, expires_at: null, last_error_code: "", error_summary: "",
    created_by: 3, created_at: 100, updated_at: 100, completed_at: null, version: 1, ...overrides
  };
}

test("Customer export streams the allowlisted filtered projection and publishes one durable result", async () => {
  const source = job(); const operationId = source.operation_id; let csv = ""; const events = [];
  const connection = {
    async query(sql) { return String(sql).includes("FROM users") ? [[{ id: 3, username: "sam" }]] : [[source]]; },
    async execute(sql, params) {
      const text = String(sql);
      if (text.includes("INSERT INTO customer_export_jobs")) return [{ insertId: source.id }];
      if (text.includes("result_sha256 = ?") && text.includes("result_sha256 IS NULL")) {
        source.result_sha256 = params[0]; source.total_count = params[1]; source.version += 1;
      }
      if (text.includes("result_storage_status = 'active'")) {
        source.result_storage_status = "active"; source.status = "completed";
        source.expires_at = params[0]; source.completed_at = params[2]; source.version += 1;
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerExportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 }, maxRows: 10,
    authorize: async () => ({ id: 3, username: "sam" }), loadPermissions: async () => ["customer.view", "customer.mgmt"],
    customerService: {
      async list({ page }) {
        if (page > 1) return { items: [], total: 1 };
        return { total: 1, items: [{ id: 9, code: "=C-9", legalName: "  +Acme", displayName: "Acme", generalPhone: "", generalEmail: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, accountManagerUserId: null, categoryId: null, industryId: null, territoryId: null, creditStatus: "normal", status: "active", version: 2, updatedAt: 90 }] };
      }
    },
    storage: {
      async stageResult({ source: chunks }) { for await (const chunk of chunks) csv += chunk; return { storedName: source.result_stored_name, sha256: createHash("sha256").update(csv).digest() }; },
      async finalizeResult() { events.push("finalized"); }
    },
    audit: { async record(_connection, input) { events.push(input.action); } },
    operations: {
      async begin() { return { operationId, replay: null }; },
      async succeed() { events.push("operation.succeeded"); }, async fail() { events.push("operation.failed"); }
    }
  });
  const result = await service.create({ actorId: 3, idempotencyKey: "export-7", filters: { q: "Acme" } });
  assert.equal(result.status, "completed");
  assert.equal(result.totalCount, 1);
  assert.match(csv, /^id,customerCode,legalName,/u);
  assert.match(csv, /9,'=C-9,' {2}\+Acme,/u);
  assert.doesNotMatch(csv, /creditNotes|bank|attachment/iu);
  assert.deepEqual(events, ["finalized", "export.create", "operation.succeeded"]);
});

test("Customer export enforces the approved row bound before publishing", async () => {
  const source = job(); let failed = 0;
  const connection = {
    async query() { return [[source]]; },
    async execute(sql) { if (String(sql).includes("status = 'failed'")) source.status = "failed"; return [{ insertId: source.id, affectedRows: 1 }]; }
  };
  const service = new CustomerExportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 }, maxRows: 1,
    authorize: async () => ({ id: 3, username: "sam" }),
    customerService: { async list() { return { items: [], total: 2 }; } },
    storage: { async stageResult({ source: chunks }) { for await (const chunk of chunks) void chunk; }, async finalizeResult() {} },
    operations: { async begin() { return { operationId: source.operation_id, replay: null }; }, async fail() { failed += 1; } }
  });
  await assert.rejects(() => service.create({ actorId: 3, idempotencyKey: "export-7", filters: {} }), (error) => error.publicCode === "CUSTOMER_EXPORT_TOO_LARGE");
  assert.equal(source.status, "failed");
  assert.equal(failed, 1);
});

test("Customer export fails instead of publishing when 101-row paging drifts", async () => {
  const source = job(); let failed = 0;
  const connection = {
    async query() { return [[source]]; },
    async execute(sql) { if (String(sql).includes("status = 'failed'")) source.status = "failed"; return [{ insertId: source.id, affectedRows: 1 }]; }
  };
  const service = new CustomerExportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 }, maxRows: 1000,
    authorize: async () => ({ id: 3, username: "sam" }),
    customerService: {
      async list({ page }, reader) {
        assert.equal(reader, connection);
        if (page === 1) return { total: 101, items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) };
        return { total: 101, items: [{ id: 100 }, { id: 101 }] };
      }
    },
    storage: { async stageResult() { throw new Error("drifted rows must not reach storage"); } },
    operations: { async begin() { return { operationId: source.operation_id, replay: null }; }, async fail() { failed += 1; } }
  });
  await assert.rejects(
    () => service.create({ actorId: 3, idempotencyKey: "export-7", filters: {} }),
    (error) => error.publicCode === "CUSTOMER_EXPORT_STATE_CONFLICT"
  );
  assert.equal(source.status, "failed");
  assert.equal(failed, 1);
});

test("Customer export recovery converges staged, finalized and missing registered results", async () => {
  const rows = [
    job({ id: 7, result_stored_name: "a".repeat(64), result_sha256: Buffer.alloc(32, 1), total_count: 1, updated_at: 1 }),
    job({ id: 8, result_stored_name: "b".repeat(64), result_sha256: Buffer.alloc(32, 2), total_count: 2, updated_at: 2 }),
    job({ id: 9, result_stored_name: "c".repeat(64), result_sha256: Buffer.alloc(32, 3), total_count: 3, updated_at: 3 }),
    job({ id: 10, result_stored_name: "d".repeat(64), result_sha256: null, total_count: 0, updated_at: 4 })
  ];
  const events = [];
  const connection = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("FROM users")) return [[{ id: 3, username: "sam" }]];
      if (text.includes("FROM permissions")) return [[{ name: "customer.mgmt" }, { name: "customer.view" }]];
      if (text.includes("FROM customer_export_jobs WHERE id")) return [[rows.find((row) => row.id === Number(params[0]))]];
      return [[]];
    },
    async execute(sql, params) {
      const text = String(sql);
      if (text.includes("result_storage_status = 'active'")) {
        const row = rows.find((item) => item.id === Number(params[3]));
        row.result_storage_status = "active"; row.status = "completed"; row.version += 1; return [{ affectedRows: 1 }];
      }
      if (text.includes("status = 'failed'")) {
        const row = rows.find((item) => item.id === Number(params.at(-1)));
        row.result_storage_status = "storage_error"; row.status = "failed"; row.version += 1; return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerExportService({
    database: {
      async query() { return [rows]; },
      async withTransaction(work) { return work(connection); }
    },
    time: { nowMs: () => 1000 }, maxRows: 10,
    storage: { async finalizeResult(metadata) { events.push(metadata.storedName); if (metadata.storedName === "c".repeat(64)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; } } },
    audit: { async record(_connection, input) { events.push(`${input.action}:${input.detail.after.recovered}`); } },
    operations: { async succeed(_connection, input) { events.push(`succeeded:${input.resourceId}`); }, async fail(_connection, input) { events.push(`failed:${input.errorCode}`); } }
  });
  assert.deepEqual(await service.recoverFiles({ staleBefore: 50, limit: 10 }), { recovered: 2, failed: 2 });
  assert.deepEqual(rows.map((row) => row.status), ["completed", "completed", "failed", "failed"]);
  assert.equal(events.filter((value) => value === "export.create:true").length, 2);
  assert.ok(events.includes("failed:RESULT_STORAGE_ERROR"));
  assert.ok(events.includes("failed:CUSTOMER_EXPORT_INTERRUPTED"));
});

test("Customer export detail is owner scoped without revealing another actor's job", async () => {
  const source = job({ status: "completed", result_storage_status: "active", result_sha256: Buffer.alloc(32, 2), expires_at: 1000 });
  const service = new CustomerExportService({
    database: { async query() { return [[source]]; } }, time: { nowMs: () => 100 }, maxRows: 10, storage: {},
    authorize: async () => ({ id: 4, username: "other" })
  });
  await assert.rejects(() => service.get({ actorId: 4, id: 7 }), (error) => error.publicCode === "CUSTOMER_EXPORT_NOT_FOUND" && error.statusCode === 404);
});

test("Customer export download reads outside transactions, audits, and returns 410 after expiry", async () => {
  const source = job({ status: "completed", result_storage_status: "active", result_sha256: Buffer.alloc(32, 2), expires_at: 1000 });
  let inTransaction = false; const audits = [];
  const database = {
    async withTransaction(work) { inTransaction = true; try { return await work(this); } finally { inTransaction = false; } },
    async query() { return [[source]]; }
  };
  const service = new CustomerExportService({
    database, time: { nowMs: () => 100 }, maxRows: 10, authorize: async () => ({ id: 3, username: "sam" }),
    storage: { async readResult() { assert.equal(inTransaction, false); return Buffer.from("csv"); } },
    audit: { async record(_connection, input) { audits.push(input.action); } }
  });
  const downloaded = await service.download({ actorId: 3, id: 7 });
  assert.equal(downloaded.buffer.toString(), "csv");
  assert.equal(downloaded.fileName, "customers-export-7.csv");
  assert.deepEqual(audits, ["export.download"]);
  source.expires_at = 99;
  await assert.rejects(() => service.download({ actorId: 3, id: 7 }), (error) => error.publicCode === "CUSTOMER_EXPORT_EXPIRED" && error.statusCode === 410);
});

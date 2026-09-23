import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { CustomerImportService } from "../src/modules/customer/CustomerImportService.js";

function job(overrides = {}) {
  return {
    id: 11, idempotency_key: "key-1", template_version: "v1", operation_id: randomUUID(),
    source_stored_name: "a".repeat(64), source_sha256: Buffer.alloc(32, 1), source_storage_status: "processing",
    result_storage_status: null, mode: "upsert", activation_mode: "draft", status: "uploaded",
    total_count: 0, valid_count: 0, warning_count: 0, invalid_count: 0, success_count: 0,
    failed_count: 0, skipped_count: 0, lease_owner: "", lease_until: null, last_error_code: "",
    error_summary: "", created_by: 3, confirmed_by: null, created_at: 100, updated_at: 100,
    confirmed_at: null, completed_at: null, version: 1, ...overrides
  };
}

test("Customer import upload commits recoverable metadata before private storage and activates it after finalize", async () => {
  const events = []; const operationId = randomUUID(); const content = Buffer.from("csv");
  const sha256 = createHash("sha256").update(content).digest(); const row = job({ operation_id: operationId, source_sha256: sha256 });
  const connection = {
    async query(sql) { events.push(["query", String(sql)]); return [[row]]; },
    async execute(sql) {
      events.push(["execute", String(sql)]);
      if (String(sql).includes("INSERT INTO customer_import_jobs")) return [{ insertId: row.id }];
      if (String(sql).includes("source_storage_status = 'active'")) { row.source_storage_status = "active"; row.version += 1; }
      return [{ affectedRows: 1 }];
    }
  };
  const database = {
    async withTransaction(work) { events.push(["transaction", "begin"]); const result = await work(connection); events.push(["transaction", "commit"]); return result; }
  };
  const service = new CustomerImportService({
    database, time: { nowMs: () => 100 }, authorize: async () => ({ username: "sam" }),
    storage: {
      async stageSource() { events.push(["storage", "stage"]); return { storedName: row.source_stored_name, sha256 }; },
      async finalizeSource() { events.push(["storage", "finalize"]); }
    },
    audit: { async record() { events.push(["audit"]); } },
    operations: {
      async begin() { events.push(["operation", "begin"]); return { operationId, replay: null }; },
      async succeed() { events.push(["operation", "succeed"]); }, async fail() { events.push(["operation", "fail"]); }
    }
  });
  const result = await service.createFromUpload({
    actorId: 3, claimedRoles: [], claimedPermissions: [], idempotencyKey: "key-1", templateVersion: "v1",
    mode: "upsert", fileSha256: sha256.toString("hex"), content
  });
  assert.equal(result.sourceStorageStatus, "active");
  assert.ok(events.findIndex(([type, value]) => type === "transaction" && value === "commit") < events.findIndex(([type]) => type === "storage"));
  assert.deepEqual(events.filter(([type]) => type === "operation").map(([, action]) => action), ["begin", "succeed"]);
});

test("Customer import precheck persists only import rows and summary under its lease", async () => {
  const statements = []; const row = job({ status: "validating", source_storage_status: "active", lease_owner: "worker-1" });
  const connection = {
    async query(sql) {
      statements.push(String(sql));
      if (String(sql).includes("FROM users")) return [[{ username: "sam" }]];
      return [[row]];
    },
    async execute(sql, params) {
      statements.push(String(sql));
      if (String(sql).includes("UPDATE customer_import_jobs SET status = ?")) {
        row.status = params[0]; row.total_count = params[1]; row.valid_count = params[2]; row.warning_count = params[3]; row.invalid_count = params[4]; row.version += 1;
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 200 }, storage: {},
    audit: { async record() {} }
  });
  await service.preparePrecheck({ jobId: 11, leaseOwner: "worker-1" });
  await service.appendPrecheckRows({
    jobId: 11, leaseOwner: "worker-1", leaseDurationMs: 1000,
    rows: [{ rowNumber: 1, operation: "create", matchCustomerId: null, expectedCustomerVersion: null, normalizedPayload: { root: { customerCode: "C-1" } }, status: "valid", errors: [], warnings: [] }]
  });
  const result = await service.recordPrecheck({
    jobId: 11, leaseOwner: "worker-1",
    counts: { total: 1, valid: 1, warning: 0, invalid: 0 }
  });
  assert.equal(result.status, "ready");
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO customer_import_rows")));
  assert.equal(statements.some((sql) => /INSERT|UPDATE|DELETE/u.test(sql) && /\bcustomers\b/u.test(sql)), false);
});

test("Customer import validation claim includes expired leases but only active sources", async () => {
  const row = job({ status: "validating", source_storage_status: "active", lease_owner: "old", lease_until: 1 });
  const connection = {
    async query(sql) { assert.match(String(sql), /source_storage_status = 'active'.*status = 'uploaded'.*lease_until < \?/su); return [[row]]; },
    async execute() { return [{ affectedRows: 1 }]; }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 }, storage: {}
  });
  const claimed = await service.claimForPrecheck({ leaseOwner: "worker-2", leaseDurationMs: 1000 });
  assert.equal(claimed.id, 11);
  assert.equal(claimed.sourceStoredName, row.source_stored_name);
});

test("Customer import upload marks durable storage failure and operation failure", async () => {
  const operationId = randomUUID(); const content = Buffer.from("csv");
  const sha256 = createHash("sha256").update(content).digest(); const row = job({ operation_id: operationId, source_sha256: sha256 });
  const events = [];
  const connection = {
    async query() { return [[row]]; },
    async execute(sql) {
      if (String(sql).includes("INSERT INTO customer_import_jobs")) return [{ insertId: row.id }];
      if (String(sql).includes("source_storage_status = 'storage_error'")) { row.source_storage_status = "storage_error"; row.status = "failed"; }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 },
    authorize: async () => ({ username: "sam" }), storage: { async stageSource() { throw new Error("disk offline"); } },
    audit: { async record() {} }, operations: {
      async begin() { return { operationId, replay: null }; }, async succeed() {}, async fail() { events.push("failed"); }
    }
  });
  await assert.rejects(() => service.createFromUpload({
    actorId: 3, idempotencyKey: "key-1", templateVersion: "v1", mode: "upsert",
    fileSha256: sha256.toString("hex"), content
  }), (error) => error.publicCode === "CUSTOMER_IMPORT_STORAGE_ERROR");
  assert.deepEqual(events, ["failed"]);
  assert.equal(row.status, "failed");
});

test("Customer import precheck records safe job-level failures without row inserts", async () => {
  const row = job({ status: "validating", source_storage_status: "active", lease_owner: "worker-1" });
  const statements = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM users")) return [[{ username: "sam" }]];
      return [[row]];
    },
    async execute(sql, params) {
      statements.push(String(sql));
      if (String(sql).includes("status = 'failed'")) {
        row.status = "failed"; row.last_error_code = params[0]; row.error_summary = params[1]; row.completed_at = params[3]; row.version += 1;
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 200 }, storage: {},
    audit: { async record() {} }
  });
  const result = await service.recordPrecheck({
    jobId: 11, leaseOwner: "worker-1", jobLevelError: { code: "CSV_MALFORMED", message: "CSV 格式不正確" }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.lastErrorCode, "CSV_MALFORMED");
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO customer_import_rows")), false);
  assert.equal(statements.some((sql) => sql.includes("DELETE FROM customer_import_rows")), true);
});

test("Customer import list and detail expose paged safe projections", async () => {
  const source = job({ status: "ready", source_storage_status: "active" });
  const row = {
    row_number: 1, operation: "create", match_customer_id: null, expected_customer_version: null,
    normalized_payload: { root: { customerCode: "C-1" } }, status: "valid", applied_customer_id: null,
    errors: [], warnings: [], started_at: null, completed_at: null, version: 1
  };
  const database = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("COUNT(*) AS total FROM customer_import_jobs")) return [[{ total: 1 }]];
      if (text.includes("COUNT(*) AS total FROM customer_import_rows")) return [[{ total: 1 }]];
      if (text.includes("FROM customer_import_rows WHERE")) return [[row]];
      return [[source]];
    }
  };
  const service = new CustomerImportService({ database, time: {}, storage: {}, authorize: async () => ({ username: "sam" }) });
  const listed = await service.list({ actorId: 3, page: 1, pageSize: 20, status: "ready" });
  assert.equal(listed.items[0].sourceStoredName, undefined);
  const detail = await service.get({ actorId: 3, id: 11, page: 1, pageSize: 20, rowStatus: "valid" });
  assert.equal(detail.rows[0].normalizedPayload.root.customerCode, "C-1");
  assert.equal(detail.total, 1);
});

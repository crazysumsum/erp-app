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

test("Customer import confirm snapshots approval policy and queues once", async () => {
  const row = job({ status: "ready_with_errors", source_storage_status: "active", version: 4 });
  const audits = []; const operationId = randomUUID(); let operationStarts = 0; let operationSuccesses = 0;
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM customer_settings")) return [[{ require_activation_approval: 1, version: 7 }]];
      if (text.includes("FROM users WHERE id")) return [[{ id: 9, username: "approver" }]];
      return [[row]];
    },
    async execute(sql, params) {
      if (String(sql).includes("SET activation_mode")) {
        row.activation_mode = params[0]; row.approver_user_id = params[1];
        row.approval_setting_value = params[2]; row.approval_setting_version = params[3];
        row.status = "queued"; row.confirmed_by = params[4]; row.version += 1;
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 300 }, storage: {},
    authorize: async () => ({ username: "sam" }), loadPermissions: async () => ["customer.approval"],
    audit: { async record(_connection, input) { audits.push(input); } },
    operations: {
      async begin() {
        operationStarts += 1;
        return operationStarts === 1
          ? { operationId, replay: null }
          : { operationId, replay: { status: "succeeded", resourceType: "import", resourceId: 11, resultVersion: 5 } };
      },
      async succeed() { operationSuccesses += 1; }
    }
  });
  const input = { actorId: 3, id: 11, version: 4, activationMode: "activate", approverUserId: 9, idempotencyKey: "confirm-11" };
  const result = await service.confirm(input);
  assert.equal(result.status, "queued");
  assert.equal(result.activationMode, "activate");
  assert.equal(row.approval_setting_version, 7);
  assert.equal(audits[0].action, "import.confirm");
  const replay = await service.confirm(input);
  assert.equal(replay.status, "queued");
  assert.equal(audits.length, 1);
  assert.equal(operationSuccesses, 1);
});

test("Customer import cancel rejects running work and closes queued work", async () => {
  const row = job({ status: "queued", source_storage_status: "active", version: 2 });
  const connection = {
    async query() { return [[row]]; },
    async execute() { row.status = "cancelled"; row.version += 1; return [{ affectedRows: 1 }]; }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 300 }, storage: {},
    authorize: async () => ({ username: "sam" }), audit: { async record() {} }
  });
  assert.equal((await service.cancel({ actorId: 3, id: 11, version: 2 })).status, "cancelled");
  row.status = "running"; row.version = 4;
  await assert.rejects(() => service.cancel({ actorId: 3, id: 11, version: 4 }), (error) => error.publicCode === "CUSTOMER_IMPORT_STATE_CONFLICT");
});

test("Customer import execution applies one row and its terminal marker in one transaction", async () => {
  const source = job({ status: "running", lease_owner: "worker-1", lease_until: 500, confirmed_by: 3 });
  const importRow = { job_id: 11, row_number: 1, operation: "create", normalized_payload: { root: {} }, status: "valid", applied_customer_id: null, version: 1 };
  const events = [];
  const connection = {
    async query(sql) {
      const text = String(sql); events.push(["query", text]);
      if (text.includes("FROM users")) return [[{ id: 3, username: "sam" }]];
      if (text.includes("FROM customer_import_rows")) return [[importRow]];
      return [[source]];
    },
    async execute(sql, params) {
      const text = String(sql); events.push(["execute", text]);
      if (text.includes("SET status = 'applied'")) { importRow.status = "applied"; importRow.applied_customer_id = params[0]; }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { events.push(["tx", "begin"]); const value = await work(connection); events.push(["tx", "commit"]); return value; } },
    time: { nowMs: () => 100 }, storage: {}, loadPermissions: async () => ["customer.view", "customer.mgmt"]
  });
  const result = await service.processNextRow({
    jobId: 11, leaseOwner: "worker-1", leaseDurationMs: 1000,
    async applyRow() { events.push(["apply", "customer+audit"]); return 91; }
  });
  assert.deepEqual(result, { rowNumber: 1, status: "applied", appliedCustomerId: 91 });
  assert.ok(events.findIndex(([type]) => type === "apply") < events.findIndex(([type, sql]) => type === "execute" && sql.includes("status = 'applied'")));
  assert.ok(events.findIndex(([type, value]) => type === "tx" && value === "commit") > events.findIndex(([type, sql]) => type === "execute" && sql.includes("status = 'applied'")));
});

test("Customer import commit-unknown reconciliation never replays an applied row", async () => {
  const source = job({ status: "running", lease_owner: "worker-1", lease_until: 500, confirmed_by: 3 });
  const importRow = { job_id: 11, row_number: 1, operation: "create", normalized_payload: { root: {} }, status: "valid", applied_customer_id: null, version: 1 };
  let transactions = 0; let applyCount = 0;
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM users")) return [[{ id: 3, username: "sam" }]];
      if (text.includes("FROM customer_import_rows")) return [[importRow]];
      if (text.includes("SELECT status, applied_customer_id")) return [[importRow]];
      return [[source]];
    },
    async execute(sql, params) {
      if (String(sql).includes("SET status = 'applied'")) { importRow.status = "applied"; importRow.applied_customer_id = params[0]; }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { transactions += 1; const value = await work(connection); if (transactions === 1) throw Object.assign(new Error("commit result lost"), { code: "ECONNRESET" }); return value; } },
    time: { nowMs: () => 100 }, storage: {}, loadPermissions: async () => ["customer.view", "customer.mgmt"]
  });
  const result = await service.processNextRow({
    jobId: 11, leaseOwner: "worker-1", leaseDurationMs: 1000,
    async applyRow() { applyCount += 1; return 91; }
  });
  assert.deepEqual(result, { rowNumber: 1, status: "applied", appliedCustomerId: 91 });
  assert.equal(applyCount, 1);
});

test("Customer import finalization publishes only a safe row result before completing the job", async () => {
  const source = job({
    status: "running", lease_owner: "worker-1", lease_until: 500, confirmed_by: 3,
    result_stored_name: null, result_sha256: null, result_storage_status: null
  });
  const rows = [{
    row_number: 1, operation: "create", status: "applied", applied_customer_id: 91,
    errors: [], warnings: [{ code: "=FORMULA", field: "x", message: "secret payload must not be exported" }]
  }];
  const csvRuns = []; const events = []; let finalizeCalls = 0;
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("COUNT(*) AS total") && text.includes("status IN")) return [[{ total: 0 }]];
      if (text.includes("SUM(status = 'applied')")) return [[{ total: 1, success_count: 1, failed_count: 0, skipped_count: 0 }]];
      if (text.includes("FROM users")) return [[{ username: "sam" }]];
      return [[source]];
    },
    async execute(sql, params) {
      const text = String(sql);
      if (text.includes("result_storage_status = 'processing'")) {
        source.result_stored_name = params[0]; source.result_sha256 = params[1]; source.result_storage_status = "processing";
      }
      if (text.includes("result_storage_status = 'active'")) {
        source.result_storage_status = "active"; source.status = params[0]; source.total_count = params[1];
        source.success_count = params[2]; source.failed_count = params[3]; source.skipped_count = params[4];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const database = {
    async withTransaction(work) { return work(connection); },
    async query(_sql, params) { return Number(params[1]) === 0 ? [rows] : [[]]; }
  };
  const service = new CustomerImportService({
    database, time: { nowMs: () => 100 },
    loadPermissions: async () => ["customer.view", "customer.mgmt"],
    storage: {
      async stageResult({ source: resultSource }) {
        let csv = ""; for await (const chunk of resultSource) csv += chunk; csvRuns.push(csv);
        return { storedName: "b".repeat(64), sha256: Buffer.alloc(32, 2) };
      },
      async finalizeResult() { finalizeCalls += 1; if (finalizeCalls === 1) throw new Error("crash before result finalize"); events.push("finalized"); }
    },
    audit: { async record(_connection, input) { events.push(input.action); } }
  });
  await assert.rejects(() => service.finalizeExecution({ jobId: 11, leaseOwner: "worker-1" }), /crash before result finalize/u);
  const result = await service.finalizeExecution({ jobId: 11, leaseOwner: "worker-1" });
  assert.equal(result.status, "completed");
  assert.equal(csvRuns.length, 2);
  assert.match(csvRuns[1], /1,create,applied,91,,"?'=FORMULA/u);
  assert.doesNotMatch(csvRuns[1], /secret payload/u);
  assert.deepEqual(events, ["finalized", "import.complete"]);
});

test("Customer import finalization fails closed when confirmer permission is revoked after result finalize", async () => {
  const source = job({
    status: "running", lease_owner: "worker-1", lease_until: 500, confirmed_by: 3,
    result_stored_name: null, result_sha256: null, result_storage_status: null
  });
  let permissionChecks = 0; let finalized = 0;
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("COUNT(*) AS total") && text.includes("status IN")) return [[{ total: 0 }]];
      if (text.includes("FROM users")) return [[{ id: 3, username: "sam" }]];
      return [[source]];
    },
    async execute(sql, params) {
      const text = String(sql);
      if (text.includes("result_storage_status = 'processing'")) {
        source.result_stored_name = params[0]; source.result_sha256 = params[1]; source.result_storage_status = "processing";
      }
      if (text.includes("AUTHORIZATION_REVOKED")) {
        source.status = "failed"; source.result_storage_status = "storage_error";
        source.last_error_code = "AUTHORIZATION_REVOKED"; source.version += 1;
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: {
      async withTransaction(work) { return work(connection); },
      async query() { return [[]]; }
    },
    time: { nowMs: () => 100 },
    loadPermissions: async () => ++permissionChecks < 3 ? ["customer.view", "customer.mgmt"] : ["customer.view"],
    storage: {
      async stageResult() { return { storedName: "b".repeat(64), sha256: Buffer.alloc(32, 2) }; },
      async finalizeResult() { finalized += 1; }
    }
  });
  const result = await service.finalizeExecution({ jobId: 11, leaseOwner: "worker-1" });
  assert.equal(finalized, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.lastErrorCode, "AUTHORIZATION_REVOKED");
  assert.equal(result.resultStorageStatus, "storage_error");
});

test("Customer import execution claim skips invalid rows and fails closed after permission revocation", async () => {
  const source = job({ status: "queued", confirmed_by: 3, version: 4 }); const statements = [];
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM users")) return [[{ id: 3, username: "sam" }]];
      return [[source]];
    },
    async execute(sql) { statements.push(String(sql)); return [{ affectedRows: 1 }]; }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 }, storage: {},
    loadPermissions: async () => ["customer.view", "customer.mgmt"]
  });
  assert.deepEqual(await service.claimForExecution({ leaseOwner: "worker-1", leaseDurationMs: 1000 }), { id: 11 });
  assert.ok(statements.some((sql) => sql.includes("status = 'skipped'")));

  const revoked = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 }, storage: {},
    loadPermissions: async () => ["customer.view"]
  });
  assert.equal(await revoked.claimForExecution({ leaseOwner: "worker-2", leaseDurationMs: 1000 }), null);
  assert.ok(statements.some((sql) => sql.includes("AUTHORIZATION_REVOKED")));
});

test("Customer import row failure rolls back the aggregate then records a safe terminal error", async () => {
  const source = job({ status: "running", lease_owner: "worker-1", lease_until: 500, confirmed_by: 3 });
  const importRow = { job_id: 11, row_number: 1, operation: "create", normalized_payload: { root: {} }, status: "valid", applied_customer_id: null, version: 1 };
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM users")) return [[{ id: 3, username: "sam" }]];
      if (text.includes("FROM customer_import_rows") || text.includes("SELECT status, applied_customer_id")) return [[importRow]];
      return [[source]];
    },
    async execute(sql, params) {
      if (String(sql).includes("SET status = 'failed'")) { importRow.status = "failed"; importRow.errors = JSON.parse(params[0]); }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerImportService({
    database: { async withTransaction(work) { return work(connection); } }, time: { nowMs: () => 100 }, storage: {},
    loadPermissions: async () => ["customer.view", "customer.mgmt"]
  });
  const result = await service.processNextRow({
    jobId: 11, leaseOwner: "worker-1", leaseDurationMs: 1000,
    async applyRow() { throw Object.assign(new Error("sensitive database detail"), { code: "ER_DUP_ENTRY" }); }
  });
  assert.deepEqual(result, { rowNumber: 1, status: "failed", appliedCustomerId: null });
  assert.deepEqual(importRow.errors, [{ field: "row", code: "ER_DUP_ENTRY", message: "此列套用失敗，未寫入客戶資料" }]);
});

test("Customer import result download is audited and expired files return 410", async () => {
  const source = job({ status: "completed", result_storage_status: "active", result_stored_name: "b".repeat(64), result_sha256: Buffer.alloc(32, 2) });
  const audits = [];
  let inTransaction = false;
  const service = new CustomerImportService({
    database: {
      async withTransaction(work) {
        inTransaction = true;
        try { return await work(this); } finally { inTransaction = false; }
      },
      async query() { return [[source]]; }
    },
    time: { nowMs: () => 100 }, authorize: async () => ({ username: "sam" }),
    storage: { async readResult() { assert.equal(inTransaction, false); return Buffer.from("safe"); } },
    audit: { async record(_connection, input) { audits.push(input.action); } }
  });
  const downloaded = await service.downloadResult({ actorId: 3, id: 11 });
  assert.equal(downloaded.buffer.toString("utf8"), "safe");
  assert.equal(downloaded.fileName, "customer-import-11-result.csv");
  assert.deepEqual(audits, ["import.result_download"]);
  source.result_storage_status = "purged";
  await assert.rejects(() => service.downloadResult({ actorId: 3, id: 11 }), (error) => error.publicCode === "CUSTOMER_IMPORT_RESULT_EXPIRED" && error.statusCode === 410);
});

test("Customer import file recovery finalizes durable files or records explicit storage errors", async () => {
  const sourceJobs = new Map([
    [1, job({ id: 1, operation_id: randomUUID(), source_stored_name: "a".repeat(64), source_sha256: Buffer.alloc(32, 1), created_by: 3 })],
    [2, job({ id: 2, operation_id: randomUUID(), source_stored_name: "b".repeat(64), source_sha256: Buffer.alloc(32, 2), created_by: 3 })]
  ]);
  const sourceRows = [...sourceJobs.values()].map(({ id, source_stored_name, source_sha256 }) => ({ id, source_stored_name, source_sha256 }));
  const resultRows = [{ id: 3, result_stored_name: "c".repeat(64), result_sha256: Buffer.alloc(32, 3) }];
  const statements = []; const operationOutcomes = []; const audits = [];
  const connection = {
    async query(sql, params) {
      if (String(sql).includes("FROM users")) return [[{ username: "sam" }]];
      return [[sourceJobs.get(Number(params[0]))]];
    },
    async execute(sql, params) {
      const text = String(sql); statements.push(text);
      const source = sourceJobs.get(Number(params.at(-1)));
      if (source && text.includes("source_storage_status = 'active'")) { source.source_storage_status = "active"; source.version += 1; }
      if (source && text.includes("source_storage_status = 'storage_error'")) { source.source_storage_status = "storage_error"; source.status = "failed"; source.version += 1; }
      return [{ affectedRows: 1 }];
    }
  };
  const database = {
    async query(sql) { return String(sql).includes("source_storage_status") ? [sourceRows] : [resultRows]; },
    async execute(sql) { statements.push(String(sql)); return [{ affectedRows: 1 }]; },
    async withTransaction(work) { return work(connection); }
  };
  const service = new CustomerImportService({
    database, time: { nowMs: () => 200 },
    storage: {
      async finalizeSource(metadata) { if (metadata.storedName.startsWith("b")) throw new Error("missing"); },
      async finalizeResult() {}
    },
    audit: { async record(_connection, input) { audits.push(input); } },
    operations: {
      async succeed(_connection, input) { operationOutcomes.push([input.operationId, "succeeded"]); },
      async fail(_connection, input) { operationOutcomes.push([input.operationId, "failed"]); }
    }
  });
  assert.deepEqual(await service.recoverFiles({ staleBefore: 100, limit: 10 }), { recovered: 2, failed: 1 });
  assert.ok(statements.some((sql) => sql.includes("source_storage_status = 'active'")));
  assert.ok(statements.some((sql) => sql.includes("SOURCE_STORAGE_ERROR")));
  assert.ok(statements.some((sql) => sql.includes("result_storage_status = 'processing'")));
  assert.deepEqual(operationOutcomes, [[sourceJobs.get(1).operation_id, "succeeded"], [sourceJobs.get(2).operation_id, "failed"]]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].detail.after.recovered, true);
});

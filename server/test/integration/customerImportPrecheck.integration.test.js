import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mysql from "mysql2/promise";

import { CustomerImportService } from "../../src/modules/customer/CustomerImportService.js";
import { CustomerAuditLogService } from "../../src/modules/customer/CustomerAuditLogService.js";
import { parseAndPrecheckCustomerCsv } from "../../src/modules/customer/import/CustomerImportProcessor.js";
import { CUSTOMER_IMPORT_COLUMN_NAMES } from "../../src/modules/customer/import/customerCsvSchema.js";
import { CustomerImportStorage } from "../../src/services/customerImport/CustomerImportStorage.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("TC-059 real MySQL Customer precheck persists evidence without changing Customer aggregates", async (t) => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "erp_dev"
  });
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "customer-import-integration-"));
  const suffix = randomUUID().slice(0, 8); const nowMs = Date.now();
  const [user] = await connection.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [`customer-import-${suffix}`, "unused", "Customer Import Test", nowMs, nowMs]
  );
  const actor = { id: Number(user.insertId), username: `customer-import-${suffix}` };
  const operationId = randomUUID(); let jobId = null;
  t.after(async () => {
    if (jobId) {
      await connection.execute("DELETE FROM customer_audit_logs WHERE target_type = 'import' AND target_id = ?", [jobId]);
      await connection.execute("DELETE FROM customer_import_jobs WHERE id = ?", [jobId]);
    }
    await connection.execute("DELETE FROM customer_operation_requests WHERE id = ?", [operationId]);
    await connection.execute("DELETE FROM users WHERE id = ?", [actor.id]);
    await connection.end(); await rm(storageRoot, { recursive: true, force: true });
  });
  const database = {
    query: (...args) => connection.query(...args), execute: (...args) => connection.execute(...args),
    async withTransaction(work) {
      await connection.beginTransaction();
      try { const result = await work(connection); await connection.commit(); return result; }
      catch (error) { await connection.rollback(); throw error; }
    }
  };
  const idempotencyKey = randomUUID();
  await connection.execute(
    `INSERT INTO customer_operation_requests
       (id,actor_user_id,route_key,idempotency_key,payload_hash,status,created_at,updated_at)
     VALUES (?,?,'customer.import.upload',?,?, 'processing',?,?)`,
    [operationId, actor.id, idempotencyKey, Buffer.alloc(32), nowMs, nowMs]
  );
  const operations = {
    async begin() { return { operationId, replay: null }; },
    async succeed(executor, input) { await executor.execute("UPDATE customer_operation_requests SET status = 'succeeded', resource_type = 'import', resource_id = ?, result_version = ?, updated_at = ?, completed_at = ? WHERE id = ?", [input.resourceId, input.resultVersion, input.nowMs, input.nowMs, operationId]); },
    async fail(executor, input) { await executor.execute("UPDATE customer_operation_requests SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ? WHERE id = ?", [input.errorCode, input.nowMs, input.nowMs, operationId]); }
  };
  const storage = new CustomerImportStorage({ config: { root: storageRoot, maxFileBytes: 20 * 1024 * 1024 } });
  const service = new CustomerImportService({
    database, time: { nowMs: () => Date.now() }, storage, operations, audit: new CustomerAuditLogService(),
    authorize: async () => ({ username: actor.username })
  });
  const unique = randomUUID().slice(0, 8); const values = Object.fromEntries(CUSTOMER_IMPORT_COLUMN_NAMES.map((name) => [name, ""]));
  Object.assign(values, { customerCode: `TC059-${unique}`, legalName: `TC059 Customer ${unique}`, defaultCurrencyCode: "HKD" });
  const content = Buffer.from(`\uFEFF${CUSTOMER_IMPORT_COLUMN_NAMES.join(",")}\r\n${CUSTOMER_IMPORT_COLUMN_NAMES.map((name) => values[name]).join(",")}\r\n`);
  const digest = createHash("sha256").update(content).digest("hex");
  const [[before]] = await connection.query("SELECT COUNT(*) AS count FROM customers");
  const uploaded = await service.createFromUpload({
    actorId: Number(actor.id), claimedRoles: [], claimedPermissions: [], idempotencyKey,
    templateVersion: "v1", mode: "upsert", fileSha256: digest, content, requestId: "tc-059", ip: "127.0.0.1"
  });
  jobId = uploaded.id;
  const claimed = await service.claimForPrecheck({ leaseOwner: "tc-059", leaseDurationMs: 30_000 });
  await service.preparePrecheck({ jobId, leaseOwner: "tc-059" });
  const source = await service.readSource(claimed);
  const result = await parseAndPrecheckCustomerCsv({
    source, mode: claimed.mode, connection: database, batchSize: 100,
    onRows: (rows) => service.appendPrecheckRows({ jobId, leaseOwner: "tc-059", leaseDurationMs: 30_000, rows })
  });
  const summary = await service.recordPrecheck({ jobId, leaseOwner: "tc-059", ...result });
  const [[after]] = await connection.query("SELECT COUNT(*) AS count FROM customers");
  assert.equal(Number(after.count), Number(before.count));
  assert.equal(summary.totalCount, 1);
  assert.ok(["ready", "ready_with_errors"].includes(summary.status));
  const [[persisted]] = await connection.query("SELECT status, normalized_payload FROM customer_import_rows WHERE job_id = ? AND `row_number` = 1", [jobId]);
  assert.ok(persisted);
  assert.doesNotMatch(JSON.stringify(persisted.normalized_payload), /bank|attachment|secret/iu);
});

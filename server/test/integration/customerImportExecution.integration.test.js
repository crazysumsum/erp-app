import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mysql from "mysql2/promise";

import { CustomerAuditLogService } from "../../src/modules/customer/CustomerAuditLogService.js";
import { CustomerImportService } from "../../src/modules/customer/CustomerImportService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { CustomerImportStorage, customerImportStoredName } from "../../src/services/customerImport/CustomerImportStorage.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("TC-060..063 import execution atomically resumes commit-unknown and publishes a safe result", async (t) => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "erp_dev"
  });
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "customer-import-execution-"));
  const nowMs = Date.now(); const suffix = randomUUID().slice(0, 8); const operationId = randomUUID();
  const [createdUser] = await connection.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [`customer-import-exec-${suffix}`, "unused", "Customer Import Execution", nowMs, nowMs]
  );
  const actorId = Number(createdUser.insertId); const cleanup = { jobId: null, customerId: null };
  t.after(async () => {
    await connection.execute("DELETE FROM customer_audit_logs WHERE actor_user_id = ?", [actorId]);
    if (cleanup.jobId) await connection.execute("DELETE FROM customer_import_jobs WHERE id = ?", [cleanup.jobId]);
    if (cleanup.customerId) await connection.execute("DELETE FROM customers WHERE id = ?", [cleanup.customerId]);
    await connection.execute("DELETE FROM customer_operation_requests WHERE id = ?", [operationId]);
    await connection.execute("DELETE FROM users WHERE id = ?", [actorId]);
    await connection.end(); await rm(storageRoot, { recursive: true, force: true });
  });
  await connection.execute(
    `INSERT INTO customer_operation_requests
       (id,actor_user_id,route_key,idempotency_key,payload_hash,status,resource_type,created_at,updated_at)
     VALUES (?,?,'customer.import.upload',?,?, 'succeeded','import',?,?)`,
    [operationId, actorId, randomUUID(), Buffer.alloc(32), nowMs, nowMs]
  );
  const [createdJob] = await connection.execute(
    `INSERT INTO customer_import_jobs
       (idempotency_key,template_version,operation_id,source_stored_name,source_sha256,source_storage_status,
        mode,activation_mode,approval_setting_value,approval_setting_version,status,created_by,confirmed_by,
        created_at,updated_at,confirmed_at)
     VALUES (?,'v1',?,?,?,'active','upsert','activate',0,1,'queued',?,?,?,?,?)`,
    [randomUUID(), operationId, customerImportStoredName(operationId), Buffer.alloc(32, 1), actorId, actorId, nowMs, nowMs, nowMs]
  );
  const jobId = Number(createdJob.insertId); cleanup.jobId = jobId;
  const payload = {
    root: { customerCode: `TC060-${suffix}`, legalName: `TC060 Customer ${suffix}`, tradingName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, accountManagerUserId: null, categoryId: null, industryId: null, territoryId: null, website: "", generalPhone: "", generalEmail: "", notes: "" },
    address: { label: "Office", recipientCompanyDepartment: "", addressLine1: "1 Test Road", addressLine2: "", addressLine3: "", city: "", stateRegion: "", postalCode: "", countryCode: "HK", phone: "", notes: "", sortOrder: 0, purposes: [{ code: "billing", isDefault: true }] },
    contact: { name: "Import Contact", jobTitle: "", department: "", email: "", phone: "", mobile: "", preferredLanguage: "", notes: "", sortOrder: 0, purposes: [{ code: "general", isDefault: true }] },
    identifier: { identifierType: "tax", issuerCountryCode: "HK", identifierValue: `TAX-${suffix}`, validFrom: null, expiresAt: null, notes: "" },
    credit: { creditLimit: "1000.0000", creditCurrencyCode: "HKD", creditStatus: "normal" }
  };
  await connection.execute(
    `INSERT INTO customer_import_rows
       (job_id,\`row_number\`,operation,normalized_payload,status,errors,warnings)
     VALUES (?,1,'create',?,'valid',JSON_ARRAY(),JSON_ARRAY())`,
    [jobId, JSON.stringify(payload)]
  );

  let throwAfterCommit = false;
  const database = {
    query: (...args) => connection.query(...args), execute: (...args) => connection.execute(...args),
    async withTransaction(work) {
      await connection.beginTransaction();
      try {
        const result = await work(connection); await connection.commit();
        if (throwAfterCommit) { throwAfterCommit = false; throw Object.assign(new Error("commit response lost"), { code: "ECONNRESET" }); }
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  };
  const storage = new CustomerImportStorage({ config: { root: storageRoot, maxFileBytes: 20 * 1024 * 1024 } });
  const audit = new CustomerAuditLogService();
  const imports = new CustomerImportService({
    database, time: { nowMs: () => Date.now() }, storage, audit,
    loadPermissions: async () => ["customer.view", "customer.mgmt"]
  });
  const customers = new CustomerService({ database, time: { nowMs: () => Date.now() }, audit });
  assert.equal((await imports.claimForExecution({ leaseOwner: "tc-061", leaseDurationMs: 30_000 })).id, jobId);
  throwAfterCommit = true;
  const applied = await imports.processNextRow({
    jobId, leaseOwner: "tc-061", leaseDurationMs: 30_000,
    applyRow: (executor, context) => customers.applyImportRowInTransaction(executor, context)
  });
  const customerId = applied.appliedCustomerId; cleanup.customerId = customerId;
  assert.equal(applied.status, "applied");
  assert.equal(await imports.processNextRow({ jobId, leaseOwner: "tc-061", leaseDurationMs: 30_000, applyRow: () => assert.fail("terminal row replayed") }), null);
  const completed = await imports.finalizeExecution({ jobId, leaseOwner: "tc-061" });
  assert.equal(completed.status, "completed");
  assert.equal(completed.successCount, 1);

  const [[customer]] = await connection.query("SELECT status FROM customers WHERE id = ?", [customerId]);
  const [[row]] = await connection.query("SELECT status, applied_customer_id FROM customer_import_rows WHERE job_id = ? AND `row_number` = 1", [jobId]);
  const [[children]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM customer_addresses WHERE customer_id = ?) AS addresses,
       (SELECT COUNT(*) FROM customer_contacts WHERE customer_id = ?) AS contacts,
       (SELECT COUNT(*) FROM customer_identifiers WHERE customer_id = ?) AS identifiers,
       (SELECT COUNT(*) FROM customer_credit_profiles WHERE customer_id = ?) AS credits`,
    [customerId, customerId, customerId, customerId]
  );
  assert.equal(customer.status, "active");
  assert.deepEqual([Number(children.addresses), Number(children.contacts), Number(children.identifiers), Number(children.credits)], [1, 1, 1, 1]);
  assert.deepEqual([row.status, Number(row.applied_customer_id)], ["applied", customerId]);
  const result = (await storage.readResult({ storedName: customerImportStoredName(operationId, "result"), sha256: Buffer.from((await connection.query("SELECT result_sha256 FROM customer_import_jobs WHERE id = ?", [jobId]))[0][0].result_sha256) })).toString("utf8");
  assert.match(result, new RegExp(`1,create,applied,${customerId},,`, "u"));
  assert.doesNotMatch(result, /legalName|address|creditLimit|TAX-/u);
});

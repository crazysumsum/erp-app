import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mysql from "mysql2/promise";

import { CustomerAuditLogService } from "../../src/modules/customer/CustomerAuditLogService.js";
import { CustomerExportService } from "../../src/modules/customer/CustomerExportService.js";
import { CustomerOperationService } from "../../src/modules/customer/CustomerOperationService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { CustomerImportStorage, customerImportStoredName } from "../../src/services/customerImport/CustomerImportStorage.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function deferred() {
  let resolve;
  return { promise: new Promise((done) => { resolve = done; }), resolve };
}

function pooledDatabase(pool, { beforeQuery, afterQuery } = {}) {
  return {
    query: (...args) => pool.query(...args), execute: (...args) => pool.execute(...args),
    async withTransaction(work, { isolationLevel = "REPEATABLE READ" } = {}) {
      const connection = await pool.getConnection();
      const executor = {
        async query(...args) { await beforeQuery?.(...args); const result = await connection.query(...args); await afterQuery?.(...args); return result; },
        async execute(...args) { return connection.execute(...args); }
      };
      try {
        await connection.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
        await connection.beginTransaction();
        const result = await work(executor);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    }
  };
}

integrationTest("TC-066 real MySQL export is filtered, formula-safe, replayable, owner-scoped and expiring", async (t) => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "erp_dev"
  });
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "customer-export-integration-"));
  const suffix = randomUUID().slice(0, 8); const nowMs = Date.now();
  const actorIds = []; const customerIds = []; let exportId = null; let operationId = null;
  t.after(async () => {
    if (exportId) {
      await connection.execute("DELETE FROM customer_audit_logs WHERE target_type = 'export' AND target_id = ?", [exportId]);
      await connection.execute("DELETE FROM customer_export_jobs WHERE id = ?", [exportId]);
    }
    if (operationId) await connection.execute("DELETE FROM customer_operation_requests WHERE id = ?", [operationId]);
    if (customerIds.length) await connection.query(`DELETE FROM customers WHERE id IN (${customerIds.map(() => "?").join(",")})`, customerIds);
    if (actorIds.length) await connection.query(`DELETE FROM users WHERE id IN (${actorIds.map(() => "?").join(",")})`, actorIds);
    await connection.end(); await rm(storageRoot, { recursive: true, force: true });
  });
  for (const label of ["owner", "other"]) {
    const [result] = await connection.execute(
      "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
      [`customer-export-${label}-${suffix}`, "unused", `Customer Export ${label}`, nowMs, nowMs]
    );
    actorIds.push(Number(result.insertId));
  }
  for (const [code, legalName, status, notes] of [
    [`TC066-A-${suffix}`, `+Formula ${suffix}`, "active", "creditNotes: should never export"],
    [`TC066-D-${suffix}`, `Draft ${suffix}`, "draft", "sensitive draft note"]
  ]) {
    const [result] = await connection.execute(
      `INSERT INTO customers
         (customer_code,customer_code_key,legal_name,legal_name_key,notes,status,created_at,updated_at,created_by,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [code, code.toLowerCase(), legalName, legalName.toLowerCase(), notes, status, nowMs, nowMs, actorIds[0], actorIds[0]]
    );
    customerIds.push(Number(result.insertId));
  }
  const database = {
    query: (...args) => connection.query(...args), execute: (...args) => connection.execute(...args),
    async withTransaction(work) {
      await connection.beginTransaction();
      try { const value = await work(connection); await connection.commit(); return value; }
      catch (error) { await connection.rollback(); throw error; }
    }
  };
  const actor = { id: actorIds[0], username: `customer-export-owner-${suffix}` };
  const authorize = async () => actor;
  const time = { nowMs: () => Date.now() };
  const customerService = new CustomerService({ database, time, actorVerifier: authorize });
  const storage = new CustomerImportStorage({ config: { root: storageRoot, maxFileBytes: 20 * 1024 * 1024 } });
  const service = new CustomerExportService({ database, time, storage, customerService, authorize, audit: new CustomerAuditLogService() });
  const idempotencyKey = `tc066-${suffix}`;
  const created = await service.create({ actorId: actorIds[0], claimedRoles: [], claimedPermissions: [], idempotencyKey, filters: { status: "active", q: `TC066-A-${suffix}` } });
  exportId = created.id;
  [[{ operation_id: operationId }]] = await connection.query("SELECT operation_id FROM customer_export_jobs WHERE id = ?", [exportId]);
  const replayed = await service.create({ actorId: actorIds[0], claimedRoles: [], claimedPermissions: [], idempotencyKey, filters: { status: "active", q: `TC066-A-${suffix}` } });
  assert.equal(replayed.id, exportId);
  const downloaded = await service.download({ actorId: actorIds[0], claimedRoles: [], claimedPermissions: [], id: exportId });
  const csv = downloaded.buffer.toString("utf8");
  assert.equal(created.totalCount, 1);
  assert.match(csv, new RegExp(`TC066-A-${suffix}`));
  assert.match(csv, new RegExp(`'\\+Formula ${suffix}`));
  assert.doesNotMatch(csv, /TC066-D|creditNotes|sensitive draft note|bank|attachment/iu);
  await assert.rejects(
    () => service.get({ actorId: actorIds[1], claimedRoles: [], claimedPermissions: [], id: exportId }),
    (error) => error.publicCode === "CUSTOMER_EXPORT_NOT_FOUND" && error.statusCode === 404
  );
  const [[audit]] = await connection.query("SELECT COUNT(*) AS count FROM customer_audit_logs WHERE target_type = 'export' AND target_id = ? AND action IN ('export.create','export.download')", [exportId]);
  assert.equal(Number(audit.count), 2);
  await connection.execute("UPDATE customer_export_jobs SET expires_at = ? WHERE id = ?", [Date.now() - 1, exportId]);
  await assert.rejects(
    () => service.download({ actorId: actorIds[0], claimedRoles: [], claimedPermissions: [], id: exportId }),
    (error) => error.publicCode === "CUSTOMER_EXPORT_EXPIRED" && error.statusCode === 410
  );
});

integrationTest("TC-066 concurrent export retry and recovery use operation-first locking without corrupting outcome", async (t) => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "erp_dev",
    connectionLimit: 4
  });
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "customer-export-lock-order-"));
  const suffix = randomUUID().slice(0, 8); const idempotencyKey = `tc066-lock-${suffix}`; const nowMs = Date.now();
  const [userResult] = await pool.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [`customer-export-lock-${suffix}`, "unused", "Customer Export Lock", nowMs, nowMs]
  );
  const actorId = Number(userResult.insertId); let exportId = null; let operationId = null;
  t.after(async () => {
    if (exportId) await pool.execute("DELETE FROM customer_export_jobs WHERE id = ?", [exportId]);
    if (operationId) await pool.execute("DELETE FROM customer_operation_requests WHERE id = ?", [operationId]);
    await pool.execute("DELETE FROM users WHERE id = ?", [actorId]);
    await pool.end(); await rm(storageRoot, { recursive: true, force: true });
  });
  const setup = await pool.getConnection();
  try {
    const started = await new CustomerOperationService().begin(setup, {
      actorId, routeKey: "customer.export.create", idempotencyKey, payload: { filters: {} }, nowMs: 1
    });
    operationId = started.operationId;
    const [jobResult] = await setup.execute(
      `INSERT INTO customer_export_jobs
         (idempotency_key,operation_id,filter_snapshot,result_stored_name,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      [idempotencyKey, operationId, JSON.stringify({}), customerImportStoredName(operationId, "result"), actorId, 1, 1]
    );
    exportId = Number(jobResult.insertId);
  } finally { setup.release(); }

  const retryLocked = deferred(); const allowRetry = deferred(); const recoveryAttempted = deferred();
  const retryDatabase = pooledDatabase(pool, {
    async afterQuery(sql) {
      if (String(sql).includes("FROM customer_operation_requests") && String(sql).includes("payload_hash")) {
        retryLocked.resolve(); await allowRetry.promise;
      }
    }
  });
  const recoveryDatabase = pooledDatabase(pool, {
    async beforeQuery(sql) {
      if (String(sql).includes("SELECT id FROM customer_operation_requests") && String(sql).includes("FOR UPDATE")) recoveryAttempted.resolve();
    }
  });
  const storage = new CustomerImportStorage({ config: { root: storageRoot, maxFileBytes: 1024 * 1024 } });
  const common = { time: { nowMs: () => Date.now() }, storage, maxRows: 10, authorize: async () => ({ id: actorId, username: `customer-export-lock-${suffix}` }), customerService: { async list() { return { items: [], total: 0 }; } } };
  const retryService = new CustomerExportService({ ...common, database: retryDatabase });
  const recoveryService = new CustomerExportService({ ...common, database: recoveryDatabase });
  const retry = retryService.create({ actorId, claimedRoles: [], claimedPermissions: [], idempotencyKey, filters: {} });
  await retryLocked.promise;
  const recovery = recoveryService.recoverFiles({ staleBefore: nowMs - 1, limit: 10 });
  await Promise.race([recoveryAttempted.promise, new Promise((_, reject) => { setTimeout(() => reject(new Error("recovery did not request the operation lock first")), 2000); })]);
  allowRetry.resolve();
  const [result, recoveryResult] = await Promise.all([retry, recovery]);
  assert.equal(result.status, "completed");
  assert.deepEqual(recoveryResult, { recovered: 0, failed: 0 });
  const [[jobRow]] = await pool.query("SELECT status,result_storage_status FROM customer_export_jobs WHERE id = ?", [exportId]);
  const [[operationRow]] = await pool.query("SELECT status FROM customer_operation_requests WHERE id = ?", [operationId]);
  assert.deepEqual(jobRow, { status: "completed", result_storage_status: "active" });
  assert.equal(operationRow.status, "succeeded");
});

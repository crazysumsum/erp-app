import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mysql from "mysql2/promise";

import { CustomerAuditLogService } from "../../src/modules/customer/CustomerAuditLogService.js";
import { CustomerExportService } from "../../src/modules/customer/CustomerExportService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { CustomerImportStorage } from "../../src/services/customerImport/CustomerImportStorage.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

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

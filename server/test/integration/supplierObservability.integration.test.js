import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import { collectSupplierMetrics } from "../../src/modules/supplier/supplierMetrics.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const MINUTE = 60_000;

integrationTest("TASK-050 (HD-083): the metrics read pending approvals, waiting and stalled import jobs from the real tables", async (t) => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  // 一個 transaction，最後 rollback：唔留低嘢，其他測試亦睇唔到。表係全局嘅，所以對比前後差。
  await connection.beginTransaction();
  t.after(async () => { await connection.rollback(); await connection.end(); });
  const now = Date.now();
  const before = await collectSupplierMetrics(connection, now);

  const [supplier] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code, status, version,
       created_at, updated_at) VALUES (?, ?, 'Metrics', 'metrics', 'HKD', 'pending_approval', 1, ?, ?)`,
    [`MET-${now}`, `met-${now}`, now, now]);
  await connection.execute(`INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, status, requested_at)
    VALUES (?, 1, JSON_OBJECT(), 'pending', ?)`, [supplier.insertId, now - 30 * 60 * MINUTE]);
  const job = (status, { createdAt = now, confirmedAt = null, leaseUntil = null, updatedAt = now } = {}) => connection.execute(
    `INSERT INTO supplier_import_jobs (template_version, source_stored_name, source_sha256, mode, activation_mode, status, total_count,
       lease_owner, lease_until, created_at, updated_at, confirmed_at) VALUES ('v1', ?, ?, 'create_only', 'draft', ?, 1, '', ?, ?, ?, ?)`,
    [randomBytes(32).toString("hex"), randomBytes(32), status, leaseUntil, createdAt, updatedAt, confirmedAt]);
  await job("uploaded", { createdAt: now - 20 * MINUTE });
  await job("queued", { createdAt: now - 90 * MINUTE, confirmedAt: now - 40 * MINUTE });
  await job("running", { leaseUntil: now + 5 * MINUTE });
  await job("running", { leaseUntil: now - 20 * MINUTE });
  await job("validating", { leaseUntil: null, updatedAt: now - 16 * MINUTE });
  await job("completed", { createdAt: now - 500 * MINUTE });

  const after = await collectSupplierMetrics(connection, now);
  assert.equal(after.approvals.pending - before.approvals.pending, 1);
  assert.ok(after.approvals.oldestAgeMs >= 30 * 60 * MINUTE);
  assert.deepEqual(["uploaded", "validating", "queued", "running"].map((status) => after.imports[status] - before.imports[status]), [1, 1, 1, 2]);
  assert.equal(after.imports.stalled - before.imports.stalled, 2, "the expired running lease and the released validating job");
  // 等得最耐嘅係 queued 由確認計（40 分鐘），唔係由上載計（90 分鐘）。
  assert.ok(after.imports.oldestWaitingMs >= 40 * MINUTE);
  if (before.imports.oldestWaitingMs === null) assert.equal(after.imports.oldestWaitingMs, 40 * MINUTE);
});

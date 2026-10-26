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
  // 已決定嘅申請唔計（就算佢更舊）。
  await connection.execute(`INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, status, requested_at, decided_at)
    VALUES (?, 1, JSON_OBJECT(), 'approved', ?, ?)`, [supplier.insertId, now - 90 * 60 * MINUTE, now - 80 * 60 * MINUTE]);
  const job = (status, { createdAt = now, confirmedAt = null, leaseUntil = null, updatedAt = now } = {}) => connection.execute(
    `INSERT INTO supplier_import_jobs (template_version, source_stored_name, source_sha256, mode, activation_mode, status, total_count,
       lease_owner, lease_until, created_at, updated_at, confirmed_at) VALUES ('v1', ?, ?, 'create_only', 'draft', ?, 1, '', ?, ?, ?, ?)`,
    [randomBytes(32).toString("hex"), randomBytes(32), status, leaseUntil, createdAt, updatedAt, confirmedAt]);
  // 最舊等緊嘅係 uploaded（60 分鐘）；queued 由確認計係 40 分鐘，由上載計就係 90 分鐘。
  await job("uploaded", { createdAt: now - 60 * MINUTE });
  await job("queued", { createdAt: now - 90 * MINUTE, confirmedAt: now - 40 * MINUTE });
  await job("running", { leaseUntil: now + 5 * MINUTE });
  await job("running", { leaseUntil: now - 20 * MINUTE });
  // Lease 過咗 5 分鐘：未夠 15 分鐘，唔算卡住。
  await job("running", { leaseUntil: now - 5 * MINUTE });
  await job("validating", { leaseUntil: null, updatedAt: now - 16 * MINUTE });
  await job("completed", { createdAt: now - 500 * MINUTE });

  const after = await collectSupplierMetrics(connection, now);
  assert.equal(after.approvals.pending - before.approvals.pending, 1);
  // 表入面可能有其他測試留低嘅舊資料：最舊嘅就係舊有最舊同我哋嗰個之間較大嗰個，同一個 now 計。
  assert.equal(after.approvals.oldestAgeMs, Math.max(before.approvals.oldestAgeMs ?? 0, 30 * 60 * MINUTE));
  assert.deepEqual(["uploaded", "validating", "queued", "running"].map((status) => after.imports[status] - before.imports[status]), [1, 1, 1, 3]);
  assert.equal(after.imports.stalled - before.imports.stalled, 2, "the expired running lease and the released validating job");
  assert.equal(after.imports.oldestWaitingMs, Math.max(before.imports.oldestWaitingMs ?? 0, 60 * MINUTE));
});

integrationTest("DEF-047 (HD-142 A): the bank counts read the last whole bucket and count a system-admin actor by the role it holds now", async (t) => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await connection.beginTransaction();
  t.after(async () => { await connection.rollback(); await connection.end(); });
  const now = Date.now();
  const before = await collectSupplierMetrics(connection, now);

  const user = async (name) => (await connection.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', ?, ?, ?)",
    [`${name}-${now}`, name, now, now]))[0].insertId;
  const admin = await user("met-admin");
  const officer = await user("met-officer");
  await connection.execute("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'system-admin'", [admin]);
  // Officer 都有角色，只係唔係 system-admin：「有任何角色」同「係 system-admin」要分得出（REV-124 R3）。
  const [role] = await connection.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`met-officer-${now}`, now]);
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [officer, role.insertId]);
  const audit = (actor, action, occurredAt) => connection.execute(
    `INSERT INTO supplier_audit_logs (occurred_at, actor_user_id, actor_username, action, target_type, target_id, supplier_id, target_label, detail)
     VALUES (?, ?, 'metrics', ?, 'bank', 1, NULL, 'Metrics Bank', JSON_OBJECT())`, [occurredAt, actor, action]);
  // 報嘅係上一個完整嘅 5 分鐘桶 [start, end)：兩邊邊界都要釘住（REV-124 N1）。
  const end = Math.floor(now / (5 * MINUTE)) * 5 * MINUTE;
  const start = end - 5 * MINUTE;
  await audit(admin, "supplier.bank.reveal", start);
  await audit(admin, "supplier.bank.update", end - 1);
  await audit(officer, "supplier.bank.reveal", start + MINUTE);
  await audit(officer, "supplier.bank.deactivate", end - MINUTE);
  // 桶外（前一毫秒、桶尾本身、而家）同唔係 bank 嘅動作都唔計。
  await audit(admin, "supplier.bank.reveal", start - 1);
  await audit(admin, "supplier.bank.reveal", end);
  await audit(admin, "supplier.bank.update", now);
  await audit(admin, "supplier.update", start + MINUTE);

  const after = await collectSupplierMetrics(connection, now);
  assert.equal(after.bank.reveals - before.bank.reveals, 2);
  assert.equal(after.bank.changes - before.bank.changes, 2);
  assert.equal(after.bank.privilegedUses - before.bank.privilegedUses, 2, "the admin's reveal and update, not the officer's");
  assert.equal(after.bank.bucketStart, start);
});

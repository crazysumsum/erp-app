import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import mysql from "mysql2/promise";
import os from "node:os";
import path from "node:path";

import { ApplicationError } from "../../src/framework/errors/ApplicationError.js";
import { SupplierImportService } from "../../src/modules/supplier/SupplierImportService.js";
import { inspectSupplierImportJobSchema, up as createJobs } from "../../database/migrations/0061_create_supplier_import_jobs.js";
import { inspectSupplierImportRowSchema, up as createRows } from "../../database/migrations/0062_create_supplier_import_rows.js";

/**
 * TASK-042：import 執行嘅交易規則打真 MySQL（設計 §8.8）。Unit double 模仿唔到 FOR UPDATE、
 * CHECK、FK 同 rollback，而呢個 task 嘅保證正正住喺嗰度。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = { application: null, db: null, logRoot: "", jobIds: [], supplierIds: [], userId: null };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-import-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  h.application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } }
  });
  h.db = h.application.services.require("mysqldatabase");
  // 確認人：T45 會用佢再驗權限，所以 queued job 冇佢就唔可以執行。
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', 'Import confirmer', ?, ?)",
    [`imp-${randomUUID().slice(0, 8)}`, Date.now(), Date.now()]);
  h.userId = Number(user.insertId);
  // T45 每列之前再驗確認人（HD-060 5A）：要 active 而且有 supplier.mgmt。
  const [role] = await h.db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`imp-confirmer-${randomUUID().slice(0, 8)}`, Date.now()]);
  h.roleId = Number(role.insertId);
  const [[permission]] = await h.db.query("SELECT id FROM permissions WHERE name = 'supplier.mgmt'");
  await h.db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [h.roleId, permission.id]);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [h.userId, h.roleId]);
});

after(async () => {
  if (!h.db) return;
  for (const id of h.jobIds) await h.db.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [id]);
  for (const id of h.jobIds) await h.db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [id]);
  for (const id of h.supplierIds) {
    await h.db.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [id]);
    await h.db.execute("DELETE FROM suppliers WHERE id = ?", [id]);
  }
  if (h.userId) await h.db.execute("DELETE FROM user_roles WHERE user_id = ?", [h.userId]);
  if (h.roleId) {
    await h.db.execute("DELETE FROM role_permissions WHERE role_id = ?", [h.roleId]);
    await h.db.execute("DELETE FROM roles WHERE id = ?", [h.roleId]);
  }
  if (h.userId) await h.db.execute("DELETE FROM users WHERE id = ?", [h.userId]);
  await h.application.shutdown("test");
  fs.rmSync(h.logRoot, { recursive: true, force: true });
});

let clock = Date.now();
const time = { nowMs: () => clock };
const service = (logger = null) => new SupplierImportService({ database: h.db, time, logger });

async function seedJob({ status = "queued", rows = ["valid", "valid"], leaseOwner = "", leaseUntil = null, confirmedAt = clock,
  confirmedBy = h.userId }) {
  const [job] = await h.db.execute(
    `INSERT INTO supplier_import_jobs (template_version, source_stored_name, source_sha256, mode, activation_mode,
       status, total_count, lease_owner, lease_until, created_at, updated_at, confirmed_at, confirmed_by)
     VALUES ('v1', ?, ?, 'create_only', 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomBytes(32).toString("hex"), randomBytes(32), status, rows.length, leaseOwner, leaseUntil, clock, clock, confirmedAt,
      confirmedBy]);
  const id = Number(job.insertId);
  h.jobIds.push(id);
  for (const [index, rowStatus] of rows.entries()) {
    await h.db.execute(
      `INSERT INTO supplier_import_rows (job_id, \`row_number\`, operation, normalized_payload, status, created_at, updated_at)
       VALUES (?, ?, 'create', ?, ?, ?, ?)`,
      [id, index + 1, JSON.stringify({ n: index + 1 }), rowStatus, clock, clock]);
  }
  return id;
}

/**
 * 領取係全域嘅：開始之前收埋其他測試留低未完成嘅 job（queued → cancelled、running → failed，
 * 都係狀態機容許嘅）。只有呢個檔案用呢兩張表 —— 唔好喺有人做緊人手驗證嘅 schema 上面跑。
 */
async function quiesce() {
  await h.db.execute("UPDATE supplier_import_jobs SET status = 'cancelled' WHERE status = 'queued'");
  await h.db.execute("UPDATE supplier_import_jobs SET status = 'failed', lease_owner = '', lease_until = NULL WHERE status = 'running'");
}

/** 資料庫錯誤包咗一層（MySqlDatabaseOperationError），constraint 名喺 cause 入面。 */
function violates(pattern) {
  return (error) => [error, error?.cause].some((link) => pattern.test(String(link?.message ?? "")));
}

async function rows(jobId) {
  const [result] = await h.db.query(
    "SELECT `row_number`, status, applied_supplier_id, errors FROM supplier_import_rows WHERE job_id = ? ORDER BY `row_number`",
    [jobId]);
  return result;
}

/** 一個真嘅 applyRow：喺收到嘅 connection 上面寫 Supplier 同 audit，好似 T45 會做嘅咁。 */
function writeSupplier({ failAfterWrite = false, returnId = true, stealRow = false } = {}) {
  return async (connection, { job, row }) => {
    const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
    const tag = randomUUID().slice(0, 8);
    const [supplier] = await connection.execute(
      `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
         default_currency_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`IMP-${tag}`, `imp-${tag}`, `Import ${tag}`, `import ${tag}`, currency.code ?? currency.CODE, clock, clock]);
    const supplierId = Number(supplier.insertId);
    h.supplierIds.push(supplierId);
    await connection.execute(
      `INSERT INTO supplier_audit_logs (occurred_at, actor_username, action, target_type, target_id, supplier_id,
         target_label, reason, detail, request_id, ip) VALUES (?, 'import', 'supplier.create', 'supplier', ?, ?, ?, '', ?, '', '')`,
      [clock, supplierId, supplierId, `IMP-${tag}`, JSON.stringify({ jobId: Number(job.id), row: Number(row.row_number) })]);
    // 一個 domain 錯誤：內部 message 帶住資料，對外 code／message 冇 —— 好似 Supplier 驗證失敗咁。
    if (failAfterWrite) {
      throw new ApplicationError(`secret CSV value IMP-${tag} leaked into a message`,
        { code: "SUPPLIER_DUPLICATE", statusCode: 409, publicMessage: "供應商重覆" });
    }
    // 喺 marker 寫之前令佢寫唔到：證明 marker 同 Supplier 喺同一個 transaction。
    if (stealRow) {
      await connection.execute("UPDATE supplier_import_rows SET status = 'skipped' WHERE job_id = ? AND `row_number` = ?",
        [job.id, row.row_number]);
    }
    return returnId ? supplierId : 0;
  };
}

async function supplierCount(ids) {
  if (ids.length === 0) return 0;
  const [[row]] = await h.db.query(`SELECT COUNT(*) AS n FROM suppliers WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  return Number(row.n);
}

integrationTest("TASK-042: the two migrations converge on rerun and refuse a hand-divergent table", async (t) => {
  const connection = await h.db.pool?.getConnection?.() ?? null;
  const runner = connection ?? h.db;
  t.after(() => connection?.release?.());
  await createJobs(runner); await createJobs(runner);
  await createRows(runner); await createRows(runner);
  assert.equal(await inspectSupplierImportJobSchema(runner), true);
  assert.equal(await inspectSupplierImportRowSchema(runner), true);

  // 一張冇 CHECK 嘅 rows probe 表一定要被拒絕 —— 否則「CHECK 由資料庫執行」只係一句說話。
  const probe = `sirp_${randomUUID().slice(0, 8)}`;
  t.after(() => h.db.query(`DROP TABLE IF EXISTS \`${probe}\``));
  await h.db.query(`CREATE TABLE \`${probe}\` LIKE supplier_import_rows`);
  await h.db.query(`ALTER TABLE \`${probe}\` ADD CONSTRAINT fk_${probe} FOREIGN KEY (job_id) REFERENCES supplier_import_jobs (id) ON DELETE RESTRICT`);
  const [checks] = await h.db.query(
    "SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_type = 'CHECK'", [probe]);
  for (const check of checks) await h.db.query(`ALTER TABLE \`${probe}\` DROP CHECK \`${check.name ?? check.NAME}\``);
  await assert.rejects(() => inspectSupplierImportRowSchema(runner, { table: probe }), /applied_supplier_id check/u);
  await h.db.query(`ALTER TABLE \`${probe}\` ADD CONSTRAINT chk_${probe} CHECK ((status = 'applied') = (applied_supplier_id IS NOT NULL))`);
  assert.equal(await inspectSupplierImportRowSchema(runner, { table: probe }), true, "control: with the check restored it passes");
  await h.db.query(`ALTER TABLE \`${probe}\` MODIFY status VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`);
  await assert.rejects(() => inspectSupplierImportRowSchema(runner, { table: probe }), /column status/u);
  await h.db.query(`ALTER TABLE \`${probe}\` MODIFY status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`);
  await h.db.query(`ALTER TABLE \`${probe}\` DROP FOREIGN KEY fk_${probe}`);
  await h.db.query(`ALTER TABLE \`${probe}\` ADD CONSTRAINT fk_${probe} FOREIGN KEY (job_id) REFERENCES supplier_import_jobs (id) ON DELETE CASCADE`);
  await assert.rejects(() => inspectSupplierImportRowSchema(runner, { table: probe }), /ON DELETE RESTRICT/u,
    "rows that would vanish with their job are refused");

  // Jobs：`LIKE` 唔抄 FK，所以對照組要啱啱好死喺 FK 嗰步；改一個欄位類型就要早過佢死。
  const jobProbe = `sijp_${randomUUID().slice(0, 8)}`;
  t.after(() => h.db.query(`DROP TABLE IF EXISTS \`${jobProbe}\``));
  await h.db.query(`CREATE TABLE \`${jobProbe}\` LIKE supplier_import_jobs`);
  await assert.rejects(() => inspectSupplierImportJobSchema(runner, { table: jobProbe }), /foreign keys/u, "control");
  await h.db.query(`ALTER TABLE \`${jobProbe}\` MODIFY source_sha256 BINARY(16) NOT NULL`);
  await assert.rejects(() => inspectSupplierImportJobSchema(runner, { table: jobProbe }), /column source_sha256/u);
  await h.db.query(`ALTER TABLE \`${jobProbe}\` MODIFY source_sha256 BINARY(32) NOT NULL`);

  // REV-061 L-1：契約以外嘅嘢一樣要拒絕。每個 case 改一樣，驗完改返。
  for (const [what, change, undo, expected] of [
    ["no AUTO_INCREMENT", "MODIFY id BIGINT UNSIGNED NOT NULL", "MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT", /column id/u],
    ["an extra UNIQUE", "ADD UNIQUE KEY uq_probe_status (status)", "DROP INDEX uq_probe_status", /unexpected unique index/u],
    ["latin1 error summary", "MODIFY error_summary VARCHAR(500) CHARACTER SET latin1 NOT NULL DEFAULT ''",
      "MODIFY error_summary VARCHAR(500) NOT NULL DEFAULT ''", /column error_summary/u]
  ]) {
    await h.db.query(`ALTER TABLE \`${jobProbe}\` ${change}`);
    await assert.rejects(() => inspectSupplierImportJobSchema(runner, { table: jobProbe }), expected, what);
    await h.db.query(`ALTER TABLE \`${jobProbe}\` ${undo}`);
  }
  await h.db.query(`ALTER TABLE \`${jobProbe}\` ADD CONSTRAINT chk_${jobProbe} CHECK (status <> 'cancelled')`);
  await assert.rejects(() => inspectSupplierImportJobSchema(runner, { table: jobProbe }), /CHECK constraints/u,
    "an extra CHECK on jobs (checked before the FKs, so the FK-less probe can reach it)");

  await h.db.query(`ALTER TABLE \`${probe}\` DROP FOREIGN KEY fk_${probe}`);
  await h.db.query(`ALTER TABLE \`${probe}\` ADD CONSTRAINT fk_${probe} FOREIGN KEY (job_id) REFERENCES supplier_import_jobs (id) ON DELETE RESTRICT`);
  await h.db.query(`ALTER TABLE \`${probe}\` ADD CONSTRAINT chk2_${probe} CHECK (status <> 'skipped')`);
  await assert.rejects(() => inspectSupplierImportRowSchema(runner, { table: probe }), /not alone/u, "an extra rows CHECK");
  await h.db.query(`ALTER TABLE \`${probe}\` DROP CHECK chk2_${probe}`);
  await h.db.query(`ALTER TABLE \`${probe}\` ADD UNIQUE KEY uq_probe_status (job_id, status)`);
  await assert.rejects(() => inspectSupplierImportRowSchema(runner, { table: probe }), /unexpected unique index/u);
  await h.db.query(`ALTER TABLE \`${probe}\` DROP INDEX uq_probe_status`);
  const [[appliedCheck]] = await h.db.query(
    "SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_type = 'CHECK'", [probe]);
  await h.db.query(`ALTER TABLE \`${probe}\` ALTER CHECK \`${appliedCheck.name ?? appliedCheck.NAME}\` NOT ENFORCED`);
  await assert.rejects(() => inspectSupplierImportRowSchema(runner, { table: probe }), /not enforced/u, "a CHECK that is not enforced");
  await h.db.query(`ALTER TABLE \`${probe}\` ALTER CHECK \`${appliedCheck.name ?? appliedCheck.NAME}\` ENFORCED`);
  // 對照：改晒返之後又合格；然後加一個 trigger 就要拒絕。
  assert.equal(await inspectSupplierImportRowSchema(runner, { table: probe }), true, "control: the restored probe passes");
  // CREATE TRIGGER 要 admin（binlog 開住，erp_user 冇 SUPER）。跟 supplierBankRestore 嘅慣例：
  // DB_ADMIN_*，GitHub Actions 上面 fallback 去 root/root。攞唔到 admin 就失敗，唔靜靜雞跳過。
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME ?? "erp_dev",
    user: process.env.DB_ADMIN_USER ?? (githubActions ? "root" : undefined),
    password: process.env.DB_ADMIN_PASSWORD ?? (githubActions ? "root" : undefined)
  });
  t.after(() => admin.end());
  await admin.query(`CREATE TRIGGER trg_${probe} BEFORE INSERT ON \`${probe}\` FOR EACH ROW SET NEW.errors = NULL`);
  await assert.rejects(() => inspectSupplierImportRowSchema(runner, { table: probe }), /carries triggers/u);
});

integrationTest("TASK-042: the database itself enforces the applied marker and keeps rows when a job is deleted", async () => {
  const jobId = await seedJob({ rows: ["valid"] });
  await assert.rejects(() => h.db.execute(
    "UPDATE supplier_import_rows SET status = 'applied' WHERE job_id = ?", [jobId]), violates(/chk_supplier_import_row_applied/u),
  "applied without a Supplier ID");
  await assert.rejects(() => h.db.execute(
    "UPDATE supplier_import_rows SET applied_supplier_id = 1 WHERE job_id = ?", [jobId]), violates(/chk_supplier_import_row_applied/u),
  "a Supplier ID on a row that is not applied");
  await assert.rejects(() => h.db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [jobId]), violates(/foreign key constraint fails/iu),
    "a job with rows cannot be deleted");
});

integrationTest("TASK-042: a worker claims only queued or lease-expired jobs, oldest first, and skips invalid rows", async () => {
  clock += 1_000_000;
  await quiesce();
  const live = await seedJob({ status: "running", leaseOwner: "other", leaseUntil: clock + 60_000, confirmedAt: clock - 30 });
  const expired = await seedJob({ status: "running", leaseOwner: "dead", leaseUntil: clock - 1, confirmedAt: clock - 20 });
  const queued = await seedJob({ rows: ["valid", "invalid", "warning"], confirmedAt: clock - 10 });
  const ready = await seedJob({ status: "ready", confirmedAt: clock - 40 });

  const first = await service().claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  assert.deepEqual(first, { id: expired, resumed: true }, "the oldest claimable is the one whose worker died");
  const second = await service().claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  assert.deepEqual(second, { id: queued, resumed: false });
  assert.deepEqual((await rows(queued)).map((row) => row.status), ["valid", "skipped", "warning"]);
  // 仲有 lease 嘅 running 同未 confirm 嘅 ready 都唔會被領取。
  for (const id of [live, ready]) {
    const [[job]] = await h.db.query("SELECT status, lease_owner FROM supplier_import_jobs WHERE id = ?", [id]);
    assert.notEqual(job.lease_owner, "me", `job ${id} must not be claimed`);
  }
});

integrationTest("TASK-042: a row's Supplier, audit and applied marker commit together, or none of them does", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "valid", "warning", "valid"] });
  const logged = [];
  const importer = service({ error: (...args) => logged.push(args) });
  await importer.claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });

  const applied = await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow: writeSupplier() });
  assert.equal(applied.status, "applied");
  const [[audit]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ?", [applied.appliedSupplierId]);
  assert.equal(Number(audit.n), 1, "the audit committed with the row");

  const before = [...h.supplierIds];
  const failed = await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000,
    applyRow: writeSupplier({ failAfterWrite: true }) });
  assert.equal(failed.status, "failed");
  const leaked = h.supplierIds.at(-1);
  assert.equal(await supplierCount([leaked]), 0, "the Supplier written before the failure rolled back");
  const [[orphanAudit]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ?", [leaked]);
  assert.equal(Number(orphanAudit.n), 0, "and so did its audit");
  const [, second] = await rows(jobId);
  assert.equal(second.applied_supplier_id, null);
  assert.deepEqual(second.errors, [{ code: "SUPPLIER_DUPLICATE", message: "供應商重覆" }],
    "a row error keeps the public code and message, never the internal one");

  // Supplier 寫咗，但 marker 寫唔到：成個 transaction rollback，Supplier 唔可以留低。
  const stolen = await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000,
    applyRow: writeSupplier({ stealRow: true }) });
  assert.equal(await supplierCount([h.supplierIds.at(-1)]), 0, "no Supplier survives a marker that could not be written");
  assert.equal(stolen.status, "failed", "the row went back to pending with the rollback and is then marked failed");

  const noId = await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000,
    applyRow: writeSupplier({ returnId: false }) });
  assert.equal(noId.status, "failed", "an applyRow that does not return the Supplier it wrote is a failure");
  assert.equal(logged.at(-1)[2].causeCode, "SUPPLIER_IMPORT_NO_SUPPLIER_ID", "and the log says so (REV-063 L-9)");
  assert.equal(await supplierCount([h.supplierIds.at(-1)]), 0, "and its Supplier rolled back");
  assert.ok(before.length > 0);

  assert.equal(await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow: writeSupplier() }), null);
  const done = await importer.finalizeExecution({ jobId, leaseOwner: "me" });
  assert.deepEqual([done.status, done.applied, done.failed, done.skipped], ["completed_with_errors", 1, 3, 0]);
});

integrationTest("TASK-042: a row applied before a crash is not applied again, and the job resumes after the lease expires", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "valid"] });
  const first = service();
  await first.claimForExecution({ leaseOwner: "worker-a", leaseDurationMs: 60_000 });
  const one = await first.processNextRow({ jobId, leaseOwner: "worker-a", leaseDurationMs: 60_000, applyRow: writeSupplier() });
  // worker-a 喺呢度死咗：lease 仲喺，第二個 worker 攞唔到，亦都寫唔到。
  const second = service();
  assert.equal(await second.claimForExecution({ leaseOwner: "worker-b", leaseDurationMs: 60_000 }), null);
  await assert.rejects(() => second.processNextRow({ jobId, leaseOwner: "worker-b", leaseDurationMs: 60_000, applyRow: writeSupplier() }),
    (error) => error.publicCode === "SUPPLIER_IMPORT_LEASE_LOST");

  clock += 61_000;
  assert.deepEqual(await second.claimForExecution({ leaseOwner: "worker-b", leaseDurationMs: 60_000 }), { id: jobId, resumed: true });
  let calls = 0;
  const counting = async (connection, context) => { calls += 1; return writeSupplier()(connection, context); };
  const next = await second.processNextRow({ jobId, leaseOwner: "worker-b", leaseDurationMs: 60_000, applyRow: counting });
  assert.equal(next.rowNumber, 2, "row 1 was committed by worker-a and is not redone");
  assert.equal(await second.processNextRow({ jobId, leaseOwner: "worker-b", leaseDurationMs: 60_000, applyRow: counting }), null);
  assert.equal(calls, 1);
  // 舊 worker 返嚟都寫唔到：lease 已經唔係佢嘅。
  await assert.rejects(() => first.finalizeExecution({ jobId, leaseOwner: "worker-a" }),
    (error) => error.publicCode === "SUPPLIER_IMPORT_LEASE_LOST");
  const done = await second.finalizeExecution({ jobId, leaseOwner: "worker-b" });
  assert.deepEqual([done.status, done.applied], ["completed", 2]);
  assert.equal(one.status, "applied");
});

integrationTest("TASK-042: job counts are rebuilt from rows, and a job with pending rows cannot be finalized", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "invalid"] });
  const importer = service();
  await importer.claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  await assert.rejects(() => importer.finalizeExecution({ jobId, leaseOwner: "me" }),
    (error) => error.publicCode === "SUPPLIER_IMPORT_ROWS_PENDING");
  // 將 job 上面嘅 count 改亂：finalize 要照 rows 重算，唔係信佢。
  await h.db.execute("UPDATE supplier_import_jobs SET applied_count = 99, failed_count = 99 WHERE id = ?", [jobId]);
  await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow: writeSupplier() });
  await importer.finalizeExecution({ jobId, leaseOwner: "me" });
  const [[job]] = await h.db.query(
    "SELECT status, applied_count, failed_count, skipped_count, lease_owner, lease_until FROM supplier_import_jobs WHERE id = ?", [jobId]);
  assert.deepEqual([job.status, Number(job.applied_count), Number(job.failed_count), Number(job.skipped_count), job.lease_owner, job.lease_until],
    ["completed", 1, 0, 1, "", null]);
});

integrationTest("TASK-043 (HD-049): a job whose rows no longer add up to the precheck total fails instead of completing", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "invalid"] });
  // 模擬 precheck 之後有列被刪走：total_count 仍然係 2，rows 得返 1。
  await h.db.execute("DELETE FROM supplier_import_rows WHERE job_id = ? AND `row_number` = 2", [jobId]);
  const logged = [];
  const importer = service({ error: (event, _message, context) => logged.push([event, context]) });
  await importer.claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow: writeSupplier() });
  const done = await importer.finalizeExecution({ jobId, leaseOwner: "me" });
  assert.equal(done.status, "failed");
  const [[job]] = await h.db.query(
    "SELECT status, last_error_code, applied_count, lease_owner, lease_until, completed_at FROM supplier_import_jobs WHERE id = ?", [jobId]);
  assert.deepEqual([job.status, job.last_error_code, Number(job.applied_count), job.lease_owner, job.lease_until],
    ["failed", "SUPPLIER_IMPORT_COUNT_MISMATCH", 1, "", null]);
  assert.notEqual(job.completed_at, null);
  assert.deepEqual(logged, [["supplier.import.count_mismatch", { jobId, expected: 2, actual: 1 }]]);
});

integrationTest("TASK-042: a queued job without a confirmer fails instead of jumping the queue, and a running job without a lease is resumable", async () => {
  clock += 1_000_000;
  await quiesce();
  const logged = [];
  for (const [label, missing] of [["no confirmer", { confirmedBy: null }], ["no confirmation time", { confirmedAt: null }]]) {
    const unconfirmed = await seedJob(missing);
    assert.equal(await service({ error: (...args) => logged.push(args) }).claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 }),
      null, label);
    const [[failed]] = await h.db.query("SELECT status, last_error_code FROM supplier_import_jobs WHERE id = ?", [unconfirmed]);
    assert.deepEqual([failed.status, failed.last_error_code], ["failed", "SUPPLIER_IMPORT_NOT_CONFIRMED"], label);
  }
  assert.deepEqual(logged.map(([event]) => event), ["supplier.import.not_confirmed", "supplier.import.not_confirmed"]);
  const leaseless = await seedJob({ status: "running", leaseOwner: "gone", leaseUntil: null });
  assert.deepEqual(await service().claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 }), { id: leaseless, resumed: true });
});

integrationTest("TASK-042: a claim skips a job another transaction holds instead of waiting for it", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({});
  const outcome = await h.db.withTransaction(async (connection) => {
    await connection.query("SELECT id FROM supplier_import_jobs WHERE id = ? FOR UPDATE", [jobId]);
    return Promise.race([
      service().claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 }),
      new Promise((resolve) => { setTimeout(() => resolve("waited"), 3_000).unref(); })
    ]);
  });
  assert.equal(outcome, null, "SKIP LOCKED: a locked job is passed over at once, not waited on");
});

integrationTest("TASK-042: every row renews the lease, applied or failed", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "valid"] });
  const importer = service();
  await importer.claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  const leaseUntil = async () => Number((await h.db.query("SELECT lease_until FROM supplier_import_jobs WHERE id = ?", [jobId]))[0][0].lease_until);
  clock += 30_000;
  await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow: writeSupplier() });
  assert.equal(await leaseUntil(), clock + 60_000, "after an applied row");
  clock += 30_000;
  await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow: writeSupplier({ failAfterWrite: true }) });
  assert.equal(await leaseUntil(), clock + 60_000, "after a failed row");
});

integrationTest("TASK-042: a worker that loses its lease while a row fails leaves that row for the new owner", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid"] });
  const oldLog = [];
  const old = service({ error: (...args) => oldLog.push(args) });
  await old.claimForExecution({ leaseOwner: "old", leaseDurationMs: 60_000 });
  const expireThenFail = async () => { clock += 61_000; throw new Error("slow row"); };
  await assert.rejects(() => old.processNextRow({ jobId, leaseOwner: "old", leaseDurationMs: 60_000, applyRow: expireThenFail }),
    (error) => error.publicCode === "SUPPLIER_IMPORT_LEASE_LOST");
  assert.equal((await rows(jobId))[0].status, "valid", "the old worker may not mark a row of a job it no longer owns");
  assert.deepEqual(oldLog, [], "and it logs no 'row failed' for a row it did not mark (REV-062 I-18)");
  const next = service();
  await next.claimForExecution({ leaseOwner: "new", leaseDurationMs: 60_000 });
  assert.equal((await next.processNextRow({ jobId, leaseOwner: "new", leaseDurationMs: 60_000, applyRow: writeSupplier() })).status, "applied");
});

integrationTest("TASK-042: a failure that is not a domain error is stored as the fixed Supplier pair and logged once, without its message", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "valid", "valid"] });
  const logged = [];
  const importer = service({ error: (...args) => logged.push(args) });
  await importer.claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  const typeError = async () => { throw new TypeError("secret CSV value in a type error"); };
  const badSql = async (connection) => { await connection.query("SELECT secret_column FROM no_such_table_t42"); };
  const unavailable = async () => {
    throw new ApplicationError("secret pool detail", { code: "DATABASE_POOL_EXHAUSTED", statusCode: 503, publicCode: "SERVICE_UNAVAILABLE" });
  };
  for (const applyRow of [typeError, badSql, unavailable]) {
    assert.equal((await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow })).status, "failed");
  }
  for (const row of await rows(jobId)) {
    assert.deepEqual(row.errors, [{ code: "SUPPLIER_IMPORT_ROW_FAILED", message: "匯入資料列處理失敗" }]);
  }
  assert.deepEqual(logged.map(([event, , context]) => [event, context.rowNumber]),
    [["supplier.import.failed", 1], ["supplier.import.failed", 2], ["supplier.import.failed", 3]]);
  assert.ok(!JSON.stringify(logged).includes("secret"), "the log carries codes, never the message");
  assert.deepEqual(Object.keys(logged[0][2]).sort(), ["causeCode", "causeName", "code", "jobId", "name", "publicCode", "rowNumber"]);
  assert.equal(logged[0][2].causeName, "TypeError", "a TypeError is told apart from other wrapped failures (REV-062 L-6)");
  assert.equal(logged[1][2].causeCode, "ER_NO_SUCH_TABLE", "and a driver error carries its code");
  assert.equal(logged[2][2].publicCode, "SERVICE_UNAVAILABLE");
});

integrationTest("TASK-042: applyRow cannot commit the Supplier ahead of its marker", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid"] });
  const refusals = [];
  const importer = service({ error: (...args) => refusals.push(args) });
  await importer.claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  // 真 MySQL 上面試 REV-062 嘅繞過寫法：每一個都要被拒絕，Supplier 跟住 rollback。
  // execute（prepared statement）一樣行到 COMMIT，所以兩個 method 都要守。
  const bypasses = [["query", "COMMIT"], ["execute", "COMMIT"], ["query", "/* x */ COMMIT"], ["query", "/*!COMMIT*/"],
    ["query", "SET @@autocommit = 0"], ["execute", "SET foreign_key_checks = 0"]];
  await h.db.execute("UPDATE supplier_import_rows SET status = 'valid' WHERE job_id = ?", [jobId]);
  for (const [method, statement] of bypasses) {
    await h.db.execute("UPDATE supplier_import_rows SET status = 'valid', errors = NULL WHERE job_id = ?", [jobId]);
    const committing = async (connection, context) => {
      await writeSupplier()(connection, context);
      await connection[method](statement);
      return h.supplierIds.at(-1);
    };
    assert.equal((await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow: committing })).status,
      "failed", `${method} ${statement}`);
    assert.equal(await supplierCount([h.supplierIds.at(-1)]), 0, `${method} ${statement}: refused, so the Supplier rolled back with the row`);
  }
  assert.ok(refusals.length === bypasses.length &&
    refusals.every(([, , context]) => context.causeCode === "SUPPLIER_IMPORT_STATEMENT_REFUSED"),
  "the log names a guard refusal as such, not as a bare TypeError (REV-063 L-9)");
});

integrationTest("TASK-045 (HD-060 4A): a deadlock, lock-wait or transaction timeout fails the row with a code that says it can be retried", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "valid", "valid", "valid"] });
  const importer = service({ error() {} });
  await importer.claimForExecution({ leaseOwner: "me", leaseDurationMs: 60_000 });
  // 驅動嘅錯誤（code 喺最外層）同 database service 包過嘅錯誤（code 喺 cause 入面）都要認到。
  const driver = (code) => async () => { throw Object.assign(new Error(`driver ${code}`), { code }); };
  const wrapped = (code) => async () => {
    throw new ApplicationError("wrapped", { code: "DATABASE_OPERATION_FAILED", statusCode: 500, cause: Object.assign(new Error("x"), { code }) });
  };
  for (const applyRow of [driver("ER_LOCK_DEADLOCK"), wrapped("ER_LOCK_WAIT_TIMEOUT"), wrapped("DATABASE_TRANSACTION_TIMEOUT"),
    driver("ER_NO_SUCH_TABLE")]) {
    assert.equal((await importer.processNextRow({ jobId, leaseOwner: "me", leaseDurationMs: 60_000, applyRow })).status, "failed");
  }
  assert.deepEqual((await rows(jobId)).map((row) => row.errors[0].code),
    ["SUPPLIER_IMPORT_ROW_BUSY", "SUPPLIER_IMPORT_ROW_BUSY", "SUPPLIER_IMPORT_ROW_BUSY", "SUPPLIER_IMPORT_ROW_FAILED"],
    "only lock and timeout failures are marked retryable");
});

integrationTest("TASK-049 (HD-075): a worker that stops between rows releases its lease, so the job resumes at once without redoing a row", async () => {
  clock += 1_000_000;
  await quiesce();
  const jobId = await seedJob({ rows: ["valid", "valid", "valid"] });
  const first = service();
  await first.claimForExecution({ leaseOwner: "worker-a", leaseDurationMs: 660_000 });
  await first.processNextRow({ jobId, leaseOwner: "worker-a", leaseDurationMs: 660_000, applyRow: writeSupplier() });
  // 逾時或者關機：喺兩列之間停低，放返 lease。
  assert.equal(await first.releaseExecutionLease({ jobId, leaseOwner: "worker-a" }), true);
  assert.equal(await service().releaseExecutionLease({ jobId, leaseOwner: "worker-x" }), false, "only the owner can release");

  // 冇等 11 分鐘：同一刻另一個 worker（或者同一個嘅下一輪）就領到。
  assert.deepEqual(await service().claimForExecution({ leaseOwner: "worker-b", leaseDurationMs: 660_000 }), { id: jobId, resumed: true });
  let calls = 0;
  const counting = async (connection, context) => { calls += 1; return writeSupplier()(connection, context); };
  const next = await service().processNextRow({ jobId, leaseOwner: "worker-b", leaseDurationMs: 660_000, applyRow: counting });
  assert.equal(next.rowNumber, 2, "row 1 is not redone");
  await service().processNextRow({ jobId, leaseOwner: "worker-b", leaseDurationMs: 660_000, applyRow: counting });
  assert.equal(await service().processNextRow({ jobId, leaseOwner: "worker-b", leaseDurationMs: 660_000, applyRow: counting }), null);
  assert.equal(calls, 2);
  assert.deepEqual([(await service().finalizeExecution({ jobId, leaseOwner: "worker-b" })).applied], [3]);
  assert.equal(await first.releaseExecutionLease({ jobId, leaseOwner: "worker-b" }), false, "a finished job has no lease to release");

  // 只放 running 嘅 job：一個 queued 但留低 lease 欄位嘅 job 唔郁（REV-078 I-1）。
  const queued = await seedJob({ status: "queued", leaseOwner: "worker-q", leaseUntil: clock + 60_000 });
  assert.equal(await service().releaseExecutionLease({ jobId: queued, leaseOwner: "worker-q" }), false);
  const [[still]] = await h.db.query("SELECT lease_until FROM supplier_import_jobs WHERE id = ?", [queued]);
  assert.equal(Number(still.lease_until), clock + 60_000);
  await assert.rejects(() => service().releaseExecutionLease({ jobId: 0, leaseOwner: "worker-q" }), TypeError);
  await assert.rejects(() => service().releaseExecutionLease({ jobId: queued, leaseOwner: " " }), TypeError);
});

integrationTest("TASK-049 (REV-078 M-1, REV-079 I-B): the capacity benchmark refuses to start while another import job is pending", async () => {
  const { spawnSync } = await import("node:child_process");
  clock += 1_000_000;
  await quiesce();
  // 每種未完成狀態都要擋：uploaded 等預檢，queued 等執行（REV-080 m11）。
  for (const status of ["uploaded", "queued"]) {
    const pending = await seedJob({ status, rows: ["valid"] });
    const output = path.join(os.tmpdir(), `bench-guard-${process.pid}-${status}.json`);
    const run = spawnSync(process.execPath, ["scripts/benchmarkSupplierImport.js", `--database=${process.env.DB_NAME}`, "--rows=2",
      "--output", output], { env: { ...process.env, DB_INTEGRATION_TESTS: "" }, encoding: "utf8" });
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    fs.rmSync(output, { force: true });
    assert.equal(run.status, 1, status);
    assert.match(report.error, /refusing to run: \d+ other import job\(s\) are pending/u, status);
    assert.deepEqual(report.cleanup, { suppliers: 0, job: null, user: null, role: null }, "nothing was created");
    const [[row]] = await h.db.query("SELECT status, version FROM supplier_import_jobs WHERE id = ?", [pending]);
    assert.deepEqual([row.status, Number(row.version)], [status, 1], "the pending job is untouched");
    await h.db.execute("UPDATE supplier_import_jobs SET status = 'cancelled' WHERE id = ?", [pending]);
  }
});

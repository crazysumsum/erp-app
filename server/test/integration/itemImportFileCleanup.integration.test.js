/**
 * T34 嘅 Import 檔案保留清理，對一個真的、已經 migrate 過的 MySQL 驗收。
 * 呢度只驗 `ItemImportService.listRetentionCandidateJobs()`／
 * `markImportFilesPurged()` 呢兩個直接掂 SQL 嘅方法——`ItemImportFileCleanupJob`
 * 本身嘅檔案系統行為（symlink、path 逃逸、UTC 週年計算、部分刪除失敗）用假
 * database 喺 test/itemImportFileCleanupJob.test.js 驗，唔使真 MySQL。設計說明見
 * docs/items_management/design_spec.md §5.13、§12.1。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { ItemImportService } from "../../src/modules/item/ItemImportService.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

async function seedImportJob(
  db,
  { fileStoredName, resultStoredName = null, status, completedAt = null, updatedAt, filesPurgedAt = null }
) {
  const nowMs = Date.now();
  const [result] = await db.query(
    `INSERT INTO item_import_jobs
       (file_stored_name, result_stored_name, file_sha256, template_version, mode, status,
        created_at, updated_at, completed_at, files_purged_at)
     VALUES (?, ?, ?, 'v1', 'create_only', ?, ?, ?, ?, ?)`,
    [fileStoredName, resultStoredName, "a".repeat(64), status, nowMs, updatedAt ?? nowMs, completedAt, filesPurgedAt]
  );
  return result.insertId;
}

async function cleanupImportJob(db, jobId) {
  if (!jobId) return;
  await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
}

test("listRetentionCandidateJobs：只回傳指定狀態、files_purged_at 未設嘅 job", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const service = new ItemImportService({ database: db, logger: application.services.require("logging").logger, time: application.services.require("time") });

  const terminalId = await seedImportJob(db, {
    fileStoredName: `${randomUUID()}.csv`,
    status: "completed",
    completedAt: Date.now() - 1000
  });
  const alreadyPurgedId = await seedImportJob(db, {
    fileStoredName: `${randomUUID()}.csv`,
    status: "completed",
    completedAt: Date.now() - 1000,
    filesPurgedAt: Date.now()
  });
  const nonTerminalId = await seedImportJob(db, {
    fileStoredName: `${randomUUID()}.csv`,
    status: "ready",
    completedAt: null
  });

  t.after(async () => {
    await cleanupImportJob(db, terminalId);
    await cleanupImportJob(db, alreadyPurgedId);
    await cleanupImportJob(db, nonTerminalId);
    await application.shutdown("integration_test_complete");
  });

  const rows = await service.listRetentionCandidateJobs({ statuses: ["completed", "failed", "cancelled", "invalid"] });
  const ids = rows.map((row) => row.id);

  assert.ok(ids.includes(terminalId), "未清理過嘅 terminal job 應該出現");
  assert.ok(!ids.includes(alreadyPurgedId), "files_purged_at 已經有值嘅 job 唔應該再出現");
  assert.ok(!ids.includes(nonTerminalId), "非 terminal 狀態嘅 job 唔應該出現");

  const found = rows.find((row) => row.id === terminalId);
  assert.equal(found.fileStoredName.length > 0, true);
  assert.equal(typeof found.completedAt, "number");
  assert.equal(typeof found.updatedAt, "number");
});

test("listRetentionCandidateJobs：依 id 升序，並受 limit 限制", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const service = new ItemImportService({ database: db, logger: application.services.require("logging").logger, time: application.services.require("time") });

  const idA = await seedImportJob(db, { fileStoredName: `${randomUUID()}.csv`, status: "failed", completedAt: Date.now() });
  const idB = await seedImportJob(db, { fileStoredName: `${randomUUID()}.csv`, status: "failed", completedAt: Date.now() });

  t.after(async () => {
    await cleanupImportJob(db, idA);
    await cleanupImportJob(db, idB);
    await application.shutdown("integration_test_complete");
  });

  const rows = await service.listRetentionCandidateJobs({ statuses: ["failed"], limit: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, Math.min(idA, idB));
});

test("markImportFilesPurged：compare-and-set，只有第一次呼叫成功", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const service = new ItemImportService({ database: db, logger: application.services.require("logging").logger, time: application.services.require("time") });

  const jobId = await seedImportJob(db, {
    fileStoredName: `${randomUUID()}.csv`,
    status: "completed",
    completedAt: Date.now()
  });

  t.after(async () => {
    await cleanupImportJob(db, jobId);
    await application.shutdown("integration_test_complete");
  });

  const purgedAtMs = Date.now();
  const first = await service.markImportFilesPurged({ jobId, purgedAtMs });
  assert.equal(first, true);

  const second = await service.markImportFilesPurged({ jobId, purgedAtMs: purgedAtMs + 1000 });
  assert.equal(second, false, "已經標記過就唔應該再改，模擬另一個 instance 撞正同一個 job");

  const [[row]] = await db.query("SELECT files_purged_at FROM item_import_jobs WHERE id = ?", [jobId]);
  assert.equal(Number(row.files_purged_at), purgedAtMs, "第二次呼叫唔應該覆蓋第一次寫入嘅時間");
});

test("markImportFilesPurged：唔存在嘅 job id 回 false", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const service = new ItemImportService({ database: db, logger: application.services.require("logging").logger, time: application.services.require("time") });

  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const result = await service.markImportFilesPurged({ jobId: 999_999_999, purgedAtMs: Date.now() });
  assert.equal(result, false);
});

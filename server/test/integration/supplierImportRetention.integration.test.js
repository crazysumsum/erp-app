import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "csv-stringify/sync";

import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierImportService } from "../../src/modules/supplier/SupplierImportService.js";
import { SupplierImportFilePurgeJob } from "../../src/services/supplierImport/jobs/SupplierImportFilePurgeJob.js";
import { SUPPLIER_IMPORT_JOB_NAMES } from "../../src/services/supplierImport/supplierImportFiles.js";

/**
 * TASK-048：import 檔案保留期打真 MySQL 同真檔案系統（設計 §12.5；HD-071 B；HD-044／050／053；REV-059 L-6）。
 * Purge 由測試直接叫；排程嘅第一輪喺開機後大約一日先跑，所以其他測試檔唔會撞到。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const DAY = 86_400_000;
const h = { application: null, db: null, importBase: "", logRoot: "", outside: "", purge: null, service: null, root: "",
  userId: null, jobIds: [], logs: [] };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-retention-logs-"));
  h.importBase = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-retention-root-"));
  h.outside = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-retention-outside-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  h.application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs,
        [SUPPLIER_IMPORT_JOB_NAMES.precheck]: { enabled: false }, [SUPPLIER_IMPORT_JOB_NAMES.worker]: { enabled: false },
        [SUPPLIER_IMPORT_JOB_NAMES.purge]: { enabled: false } } },
      supplier: { ...source.supplier, import: { ...source.supplier.import, root: path.join(h.importBase, "imports") } },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } }
  });
  await h.application.start();
  h.db = h.application.services.require("mysqldatabase");
  h.purge = h.application.services.require("job.supplierImportFilePurge");
  assert.ok(h.purge instanceof SupplierImportFilePurgeJob, "the purge job is discovered and registered");
  assert.deepEqual([h.purge.retention.executedDays, h.purge.retention.unconfirmedDays], [365, 30]);
  // 記低 purge 寫嘅 log，等測試睇到失敗有冇記、記咗乜。
  const logger = h.purge.logger;
  h.purge.logger = new Proxy(logger, { get: (target, name) => (["error", "info"].includes(name)
    ? (event, message, data) => { h.logs.push({ level: name, event, data }); return target[name](event, message, data); }
    : target[name]) });
  h.service = new SupplierImportService({ database: h.db, time: { nowMs: () => Date.now() } });
  h.root = h.application.services.require("job.supplierImportWorker").preparedRoot;
  const now = Date.now();
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', 'Retention uploader', ?, ?)",
    [`ret48-${randomUUID().slice(0, 8)}`, now, now]);
  h.userId = Number(user.insertId);
});

after(async () => {
  if (!h.db) return;
  for (const id of h.jobIds) {
    await h.db.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [id]);
    await h.db.execute("DELETE FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ?", [id]);
    await h.db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [id]);
  }
  if (h.userId) await h.db.execute("DELETE FROM users WHERE id = ?", [h.userId]);
  await h.application.shutdown("test");
  for (const directory of [h.logRoot, h.importBase, h.outside]) {
    fs.chmodSync(directory, 0o700);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const sourcePath = (name) => path.join(h.root, "source", name);
const job = async (id) => (await h.db.query("SELECT * FROM supplier_import_jobs WHERE id = ?", [id]))[0][0];

/** 真上載（真檔、真 job），再將狀態同時間改到要測嘅樣。 */
async function seedJob({ status, createdDaysAgo = 0, completedDaysAgo = null, confirmed = false }) {
  const content = Buffer.from(stringify([SUPPLIER_IMPORT_COLUMN_NAMES,
    SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => (name === "supplierCode" ? `R48-${randomUUID().slice(0, 6)}` : ""))],
  SUPPLIER_CSV_STRINGIFY_OPTIONS));
  const created = await h.service.createFromUpload({ actorId: h.userId, claimedRoles: [], claimedPermissions: [], root: h.root,
    mode: "create_only", content, maxFileBytes: 1_000_000 });
  h.jobIds.push(created.id);
  const now = Date.now();
  await h.db.execute(
    `UPDATE supplier_import_jobs SET status = ?, created_at = ?, confirmed_at = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    [status, now - createdDaysAgo * DAY - DAY, confirmed ? now - createdDaysAgo * DAY : null,
      completedDaysAgo === null ? null : now - completedDaysAgo * DAY, now, created.id]);
  return { id: created.id, storedName: (await job(created.id)).source_stored_name };
}

/** 放一個冇 job 指住嘅檔；`daysOld` 改佢嘅 mtime。 */
function strayFile(daysOld) {
  const name = randomUUID().replace(/-/gu, "").padEnd(64, "a");
  fs.writeFileSync(sourcePath(name), "stray", { mode: 0o600 });
  const when = new Date(Date.now() - daysOld * DAY);
  fs.utimesSync(sourcePath(name), when, when);
  return name;
}

const purge = () => h.purge.purge(new AbortController().signal);

integrationTest("TASK-048: executed jobs past 365 days lose their files and answer 410; the job, its rows and audit stay", async () => {
  const due = await seedJob({ status: "completed", createdDaysAgo: 400, completedDaysAgo: 366, confirmed: true });
  const failedRunning = await seedJob({ status: "failed", createdDaysAgo: 400, completedDaysAgo: 366, confirmed: true });
  const dueWithErrors = await seedJob({ status: "completed_with_errors", createdDaysAgo: 400, completedDaysAgo: 366, confirmed: true });
  // 未確認就被執行標為失敗（SUPPLIER_IMPORT_NOT_CONFIRMED）：一樣到期（REV-076 I-3）。
  const failedUnconfirmed = await seedJob({ status: "failed", createdDaysAgo: 400, completedDaysAgo: 366 });
  const young = await seedJob({ status: "completed_with_errors", createdDaysAgo: 400, completedDaysAgo: 364, confirmed: true });
  const queued = await seedJob({ status: "queued", createdDaysAgo: 400, confirmed: true });
  const audits = async () => Number((await h.db.query(
    "SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ?", [due.id]))[0][0].n);
  const auditsBefore = await audits();
  assert.ok(auditsBefore >= 1, "the upload was audited");

  const counts = await purge();
  assert.ok(counts.retained >= 4 && counts.failed === 0, JSON.stringify(counts));

  for (const { id, storedName } of [due, failedRunning, dueWithErrors, failedUnconfirmed]) {
    const row = await job(id);
    assert.ok(row.files_purged_at !== null, `job ${id} is marked purged`);
    assert.ok(["completed", "failed", "completed_with_errors"].includes(row.status), "the status is kept");
    assert.equal(fs.existsSync(sourcePath(storedName)), false, "the source is deleted");
  }
  await assert.rejects(h.service.resultCsv({ actorId: h.userId, claimedRoles: [], claimedPermissions: [], id: due.id }),
    (error) => error.code === "IMPORT_FILE_EXPIRED" && error.statusCode === 410);
  assert.equal(await audits(), auditsBefore, "the job's audit is kept and a file purge adds none");

  for (const { id, storedName } of [young, queued]) {
    assert.equal((await job(id)).files_purged_at, null, `job ${id} is not due`);
    assert.ok(fs.existsSync(sourcePath(storedName)));
  }
  const again = await purge();
  assert.deepEqual([again.retained, again.expired, again.filesDeleted], [0, 0, 0], "a second run changes nothing");
});

integrationTest("TASK-048 (HD-071 B): a job never confirmed for 30 days is cancelled as expired, audited, and its source deleted", async () => {
  const stale = [await seedJob({ status: "ready", createdDaysAgo: 31 }), await seedJob({ status: "uploaded", createdDaysAgo: 31 }),
    await seedJob({ status: "ready_with_errors", createdDaysAgo: 31 })];
  const fresh = await seedJob({ status: "ready", createdDaysAgo: 28 });
  const now = Date.now();
  for (const { id } of [stale[0], fresh]) {
    await h.db.execute(`INSERT INTO supplier_import_rows (job_id, \`row_number\`, operation, normalized_payload, status, errors, warnings,
      created_at, updated_at) VALUES (?, 1, 'create', ?, 'valid', JSON_ARRAY(), JSON_ARRAY(), ?, ?)`,
    [id, JSON.stringify({ root: { supplierName: "Personal Name", generalEmail: "person@example.com" } }), now, now]);
  }
  const validating = await seedJob({ status: "validating", createdDaysAgo: 31 });

  const counts = await purge();
  assert.ok(counts.expired >= 3, JSON.stringify(counts));
  for (const { id, storedName } of stale) {
    const row = await job(id);
    assert.deepEqual([row.status, row.last_error_code, row.files_purged_at !== null], ["cancelled", "SUPPLIER_IMPORT_EXPIRED", true]);
    assert.equal(fs.existsSync(sourcePath(storedName)), false);
    const [[audit]] = await h.db.query(
      "SELECT actor_user_id, actor_username, detail FROM supplier_audit_logs WHERE action = 'import.expire' AND target_id = ?", [id]);
    const detail = typeof audit.detail === "string" ? JSON.parse(audit.detail) : audit.detail;
    assert.deepEqual([audit.actor_user_id, audit.actor_username, detail.after.status, detail.outcome],
      [null, "system", "cancelled", "SUPPLIER_IMPORT_EXPIRED"]);
  }
  assert.equal((await job(fresh.id)).status, "ready", "28 days is not yet due");
  const payload = async (id) => (await h.db.query("SELECT status, normalized_payload FROM supplier_import_rows WHERE job_id = ?", [id]))[0][0];
  assert.deepEqual([(await payload(stale[0].id)).status, (await payload(stale[0].id)).normalized_payload], ["valid", {}],
    "an expired job's rows keep their outcome but lose the CSV content (HD-072 I-5 A)");
  assert.equal((await payload(fresh.id)).normalized_payload.root.generalEmail, "person@example.com", "a job not yet due keeps it");
  assert.equal((await job(validating.id)).status, "validating", "a job being prechecked is left to the precheck");

  // 揀咗做候選之後先被確認或者已經清咗：唔郁佢。
  assert.equal(await h.service.expireUnconfirmed({ id: validating.id, nowMs: Date.now() }), null, "claimed by the precheck meanwhile");
  assert.equal((await job(validating.id)).status, "validating");
  const confirmedMeanwhile = await seedJob({ status: "queued", createdDaysAgo: 31, confirmed: true });
  assert.equal(await h.service.expireUnconfirmed({ id: confirmedMeanwhile.id, nowMs: Date.now() }), null);
  assert.deepEqual([(await job(confirmedMeanwhile.id)).status, (await job(confirmedMeanwhile.id)).files_purged_at], ["queued", null]);
  assert.equal(await h.service.expireUnconfirmed({ id: stale[0].id, nowMs: Date.now() }), null, "already expired");
  assert.equal(await h.service.markExecutedFilesPurged({ id: fresh.id, nowMs: Date.now() }), null, "not an executed job");
  assert.equal((await job(fresh.id)).files_purged_at, null);
});

integrationTest("TASK-048 (HD-044/050/053): unreferenced files older than a day are removed; newer ones and symlinks are not", async () => {
  const old = strayFile(2);
  const fresh = strayFile(0);
  const purgedJob = await seedJob({ status: "cancelled", createdDaysAgo: 5 });
  await h.db.execute("UPDATE supplier_import_jobs SET files_purged_at = ? WHERE id = ?", [Date.now(), purgedJob.id]);
  const old2 = new Date(Date.now() - 2 * DAY);
  fs.utimesSync(sourcePath(purgedJob.storedName), old2, old2);
  // 仲有 job 指住（未到期）嘅舊檔：唔係孤兒，唔刪。
  const live = await seedJob({ status: "ready", createdDaysAgo: 3 });
  fs.utimesSync(sourcePath(live.storedName), old2, old2);
  // Root 入面一個指去 root 外面嘅 symlink：唔跟、唔刪目標。
  const target = path.join(h.outside, "keep.txt");
  fs.writeFileSync(target, "outside");
  const link = "f".repeat(64);
  fs.symlinkSync(target, sourcePath(link));

  const counts = await purge();
  assert.ok(counts.orphansDeleted >= 2, JSON.stringify(counts));
  assert.equal(fs.existsSync(sourcePath(old)), false, "an old stray file is removed");
  assert.equal(fs.existsSync(sourcePath(purgedJob.storedName)), false, "a file whose job is already purged is removed (a failed earlier delete)");
  assert.ok(fs.existsSync(sourcePath(fresh)), "a file newer than a day may belong to an upload still inserting its job");
  assert.ok(fs.existsSync(sourcePath(live.storedName)), "an old file a live job still names is kept");
  assert.ok(fs.lstatSync(sourcePath(link)).isSymbolicLink(), "a symlink is never followed or removed");
  assert.equal(fs.readFileSync(target, "utf8"), "outside");
  fs.unlinkSync(sourcePath(link));
  fs.unlinkSync(sourcePath(fresh));
});

integrationTest("TASK-048 (REV-059 L-6): a hard-linked or undeletable file is refused, logged without detail, and retried next run", async () => {
  const linked = await seedJob({ status: "completed", createdDaysAgo: 400, completedDaysAgo: 366, confirmed: true });
  const outsideCopy = path.join(h.outside, "hardlink");
  fs.linkSync(sourcePath(linked.storedName), outsideCopy);
  const blocked = await seedJob({ status: "completed", createdDaysAgo: 400, completedDaysAgo: 366, confirmed: true });
  h.logs.length = 0;
  fs.chmodSync(path.join(h.root, "source"), 0o500);
  let counts;
  try {
    // 有檔刪唔到：記低摘要之後拋錯，scheduler 會記呢輪失敗（REV-076 M-1）。
    await assert.rejects(purge(), (error) => {
      counts = error.counts;
      return error.code === "SUPPLIER_IMPORT_PURGE_INCOMPLETE" && !error.message.includes(h.root);
    });
  } finally {
    fs.chmodSync(path.join(h.root, "source"), 0o700);
  }
  assert.ok(counts.failed >= 2, JSON.stringify(counts));
  assert.ok(h.logs.some((entry) => entry.event === "supplier.import.purged" && entry.data.failed === counts.failed), "the summary is logged first");
  const failures = h.logs.filter((entry) => entry.event === "supplier.import.purge_failed");
  assert.ok(failures.some((entry) => entry.data.jobId === linked.id && entry.data.code === "SUPPLIER_IMPORT_PURGE_UNSAFE"));
  assert.ok(failures.some((entry) => entry.data.jobId === blocked.id && entry.data.code === "EACCES"));
  assert.ok(failures.every((entry) => Object.keys(entry.data).every((key) => ["jobId", "storedName", "kind", "code"].includes(key))),
    "only IDs and an error code are logged");
  for (const { id } of [linked, blocked]) assert.ok((await job(id)).files_purged_at !== null, "the job is marked before the delete");
  assert.ok(fs.existsSync(sourcePath(linked.storedName)) && fs.existsSync(outsideCopy), "a hard-linked file is not touched");

  // 下一輪：權限返咗，冇人指住嘅舊檔當孤兒刪走；hard link 嘅照樣唔刪。
  const old = new Date(Date.now() - 2 * DAY);
  fs.utimesSync(sourcePath(blocked.storedName), old, old);
  fs.utimesSync(sourcePath(linked.storedName), old, old);
  let retry;
  await assert.rejects(purge(), (error) => { retry = error.counts; return error.code === "SUPPLIER_IMPORT_PURGE_INCOMPLETE"; });
  assert.equal(fs.existsSync(sourcePath(blocked.storedName)), false, "the retry removes the file");
  assert.ok(fs.existsSync(outsideCopy) && fs.existsSync(sourcePath(linked.storedName)));
  assert.ok(retry.failed >= 1, "the hard link is refused again");
  fs.unlinkSync(outsideCopy);
  fs.unlinkSync(sourcePath(linked.storedName));
});

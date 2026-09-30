import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "csv-stringify/sync";

import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierImportService } from "../../src/modules/supplier/SupplierImportService.js";
import { SupplierImportWorkerService } from "../../src/services/supplierImport/SupplierImportWorkerService.js";
import { SUPPLIER_IMPORT_JOB_NAMES } from "../../src/services/supplierImport/supplierImportFiles.js";

/**
 * TASK-043：上載同 precheck 打真 MySQL 同真檔案系統（IMP-003/004/005/011/014；TC-090、TC-096、TC-099）。
 *
 * App 有自己嘅 import root，但 import 兩件排程工作關咗：precheck 只由測試叫 worker 去做，時間由測試控制。
 * 只有呢個檔案會產生 uploaded／validating 嘅 job。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = { application: null, url: "", db: null, jwt: null, logRoot: "", importBase: "", worker: null, jobIds: [], supplierIds: [],
  userId: null, roleIds: [], userIds: [] };
const BANK_VALUE = "GB29NWBK60161331926819";
let clock = Date.now();
const time = { nowMs: () => clock };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-import-logs-"));
  h.importBase = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-import-root-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  h.application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      // 只停 Supplier import 兩件工作（成個 scheduler 停唔得：JWT revocation 要佢）。
      scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs,
        [SUPPLIER_IMPORT_JOB_NAMES.precheck]: { enabled: false }, [SUPPLIER_IMPORT_JOB_NAMES.worker]: { enabled: false } } },
      supplier: { ...source.supplier, import: { ...source.supplier.import, root: path.join(h.importBase, "imports") } },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } }
  });
  h.db = h.application.services.require("mysqldatabase");
  h.jwt = h.application.services.require("jwt");
  h.worker = h.application.services.require("job.supplierImportWorker");
  assert.ok(h.worker instanceof SupplierImportWorkerService);
  h.worker.importService = new SupplierImportService({ database: h.db, time, logger: h.worker.logger });
  ({ url: h.url } = await h.application.start());
  // 之前中斷咗嘅 run 可能留低 uploaded／validating 嘅 job（佢哋嘅 root 已經刪咗）；只有呢個檔案會整呢兩種。
  await h.db.execute("UPDATE supplier_import_jobs SET status = 'cancelled' WHERE status = 'uploaded'");
  await h.db.execute("UPDATE supplier_import_jobs SET status = 'failed', lease_owner = '', lease_until = NULL WHERE status = 'validating'");
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', 'Import uploader', ?, ?)",
    [`imp43-${randomUUID().slice(0, 8)}`, clock, clock]);
  h.userId = Number(user.insertId);
});

after(async () => {
  if (!h.db) return;
  for (const id of h.jobIds) {
    await h.db.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [id]);
    await h.db.execute("DELETE FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ?", [id]);
    await h.db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [id]);
  }
  for (const id of h.supplierIds) {
    await h.db.execute("DELETE FROM supplier_identifiers WHERE supplier_id = ?", [id]);
    await h.db.execute("DELETE FROM suppliers WHERE id = ?", [id]);
  }
  if (h.userId) await h.db.execute("DELETE FROM users WHERE id = ?", [h.userId]);
  for (const id of h.userIds) {
    await h.db.execute("DELETE FROM supplier_audit_logs WHERE actor_user_id = ?", [id]);
    await h.db.execute("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await h.db.execute("DELETE FROM users WHERE id = ?", [id]);
  }
  for (const id of h.roleIds) {
    await h.db.execute("DELETE FROM role_permissions WHERE role_id = ?", [id]);
    await h.db.execute("DELETE FROM roles WHERE id = ?", [id]);
  }
  await h.application.shutdown("test");
  fs.rmSync(h.logRoot, { recursive: true, force: true });
  fs.rmSync(h.importBase, { recursive: true, force: true });
});

const csv = (records, header = SUPPLIER_IMPORT_COLUMN_NAMES) =>
  Buffer.from(stringify([header, ...records.map((record) => header.map((name) => record[name] ?? ""))], SUPPLIER_CSV_STRINGIFY_OPTIONS));

async function upload(content, { mode = "create_only", claimedPermissions = [] } = {}) {
  const job = await h.worker.importService.createFromUpload({
    actorId: h.userId, claimedRoles: [], claimedPermissions, root: h.worker.preparedRoot, mode, content,
    maxFileBytes: h.worker.limits.maxFileBytes, requestId: "req-t43", ip: "127.0.0.1"
  });
  h.jobIds.push(job.id);
  return job;
}

/** 跑 precheck 直至處理到指定嘅 job（之前未完成嘅其他 job 會先被處理）。 */
async function precheck(jobId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await h.worker.runPrecheck(new AbortController().signal);
    if (!result.claimed || result.jobId === jobId) return result;
  }
  throw new Error(`job ${jobId} was never prechecked`);
}

async function seedSupplier({ code, name, status = "active", identifier = null }) {
  const [inserted] = await h.db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
       status, created_at, updated_at) VALUES (?, ?, ?, ?, 'HKD', ?, ?, ?)`,
    [code, code.toLowerCase(), name, name.toLowerCase(), status, clock, clock]);
  const id = Number(inserted.insertId);
  h.supplierIds.push(id);
  if (identifier) {
    await h.db.execute(
      `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key,
         created_at, updated_at) VALUES (?, 'tax', 'HK', ?, ?, ?, ?)`,
      [id, identifier, identifier, clock, clock]);
  }
  return id;
}

async function job(id) {
  const [[row]] = await h.db.query("SELECT * FROM supplier_import_jobs WHERE id = ?", [id]);
  return row;
}

async function rows(jobId) {
  const [result] = await h.db.query(
    "SELECT `row_number`, operation, match_supplier_id, status, normalized_payload, errors, warnings FROM supplier_import_rows WHERE job_id = ? ORDER BY `row_number`",
    [jobId]);
  return result.map((row) => ({
    ...row, errors: row.errors.map(({ field, code }) => [field, code]), warnings: row.warnings.map(({ code }) => code)
  }));
}

/** Supplier 正式資料嘅行數（IMP-004：precheck 前後要一樣）。 */
async function supplierTableCounts() {
  const tables = ["suppliers", "supplier_name_grams", "supplier_addresses", "supplier_address_purposes", "supplier_contacts",
    "supplier_contact_purposes", "supplier_identifiers", "supplier_bank_accounts", "supplier_activation_requests"];
  const counts = {};
  for (const table of tables) counts[table] = Number((await h.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n);
  counts.businessAudit = Number((await h.db.query(
    "SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE action NOT LIKE 'import.%'"))[0][0].n);
  return counts;
}

integrationTest("TASK-043 IMP-003: upload stores the file under a server-made name, 0600, inside the root, and records the job", async () => {
  const content = csv([{ supplierCode: `U-${randomUUID().slice(0, 6)}`, supplierName: "Upload Only", defaultCurrencyCode: "HKD" }]);
  const created = await upload(content);
  assert.deepEqual([created.status, created.mode, created.templateVersion, created.totalCount], ["uploaded", "create_only", "v1", 0]);
  assert.deepEqual(Object.keys(created).filter((key) => /stored|sha|path|lease/iu.test(key)), [], "no file detail in the response");
  const row = await job(created.id);
  assert.match(row.source_stored_name, /^[0-9a-f]{64}$/u);
  const file = path.join(h.worker.preparedRoot, "source", row.source_stored_name);
  assert.equal(path.dirname(file), path.join(h.worker.preparedRoot, "source"));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(file), content);
  const [[audit]] = await h.db.query(
    "SELECT action, actor_user_id, detail FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.upload'",
    [created.id]);
  assert.equal(Number(audit.actor_user_id), h.userId);
});

integrationTest("TASK-043: an upload the actor may no longer make leaves neither a job nor a file", async () => {
  const before = await readdir(path.join(h.worker.preparedRoot, "source"));
  const [[{ n: jobsBefore }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_import_jobs");
  await assert.rejects(() => upload(csv([{ supplierCode: "STALE" }]), { claimedPermissions: ["supplier.mgmt"] }),
    (error) => error.statusCode >= 400 && error.statusCode < 500, "claims that no longer match the database are refused");
  assert.deepEqual((await readdir(path.join(h.worker.preparedRoot, "source"))).sort(), before.sort(), "the stored file is removed again");
  const [[{ n: jobsAfter }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_import_jobs");
  assert.equal(Number(jobsAfter), Number(jobsBefore));
});

integrationTest("TASK-043 IMP-004/005/011 (TC-090, TC-096): precheck classifies each row and writes nothing to Supplier tables", async () => {
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const existingId = await seedSupplier({ code: `EX-${tag}`, name: `Existing ${tag}`, identifier: `TX${tag}` });
  const archivedId = await seedSupplier({ code: `AR-${tag}`, name: `Archived ${tag}`, status: "archived" });
  // 每列配對唔同嘅 Supplier：同一個 Supplier 出現兩次本身就係錯（SUPPLIER_IMPORT_SUPPLIER_DUPLICATED_IN_FILE）。
  const childTargetId = await seedSupplier({ code: `CH-${tag}`, name: `Child target ${tag}` });
  const mismatchId = await seedSupplier({ code: `MM-${tag}`, name: `Mismatch ${tag}` });
  const content = csv([
    { supplierCode: `NEW-${tag}`, supplierName: `Fresh ${tag}`, defaultCurrencyCode: "HKD", postalCode: "00123",
      addressLabel: "HQ", addressPurpose: "office", contactName: "Alex", contactPurpose: "orders" },
    { supplierCode: `SIM-${tag}`, supplierName: `Existing ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `BAD-${tag}`, supplierName: "No currency" },
    { supplierId: String(existingId), supplierCode: `EX-${tag}`, notes: "updated note" },
    { supplierCode: `CH-${tag}`, contactName: "Child on update" },
    { supplierId: String(mismatchId), supplierCode: `ZZ-${tag}` },
    { supplierId: String(archivedId) },
    { supplierCode: `ID-${tag}`, supplierName: `Id ${tag}`, defaultCurrencyCode: "HKD", identifierType: "tax",
      issuerCountryCode: "HK", identifierValue: `TX${tag}` }
  ]);
  const baseline = await supplierTableCounts();
  const created = await upload(content, { mode: "upsert" });
  const result = await precheck(created.id);
  assert.deepEqual(result, { claimed: true, jobId: created.id, status: "ready_with_errors" });
  assert.deepEqual(await supplierTableCounts(), baseline, "precheck changed no Supplier table and wrote no business audit");

  const checked = await rows(created.id);
  assert.deepEqual(checked.map((row) => [row.row_number, row.operation, row.status]), [
    [1, "create", "valid"], [2, "create", "warning"], [3, "create", "invalid"], [4, "update", "valid"],
    [5, "update", "invalid"], [6, "update", "invalid"], [7, "update", "invalid"], [8, "create", "invalid"]
  ]);
  assert.deepEqual(checked[1].warnings, ["SUPPLIER_IMPORT_NAME_SIMILAR"]);
  assert.deepEqual(checked[2].errors, [["defaultCurrencyCode", "SUPPLIER_IMPORT_REQUIRED_FIELD"]]);
  assert.equal(Number(checked[3].match_supplier_id), existingId);
  assert.deepEqual(checked[3].normalized_payload, { root: { notes: "updated note" } }, "blank optional cells keep the stored value");
  assert.deepEqual(checked[4].errors, [["children", "IMPORT_CHILD_UPDATE_UNSUPPORTED"]]);
  assert.equal(Number(checked[4].match_supplier_id), childTargetId, "matched by code alone");
  assert.deepEqual(checked[5].errors, [["supplierCode", "SUPPLIER_IMPORT_MATCH_CONFLICT"]]);
  assert.deepEqual(checked[6].errors, [["supplierId", "SUPPLIER_UPDATE_NOT_ALLOWED"]]);
  assert.deepEqual(checked[7].errors, [["identifierValue", "SUPPLIER_IDENTIFIER_TAKEN"]]);
  assert.equal(checked[0].normalized_payload.address.postalCode, "00123");

  const summary = await job(created.id);
  assert.deepEqual([summary.status, summary.total_count, summary.valid_count, summary.warning_count, summary.invalid_count].map(String),
    ["ready_with_errors", "8", "2", "1", "5"], "the summary equals the rows");
  assert.deepEqual([summary.lease_owner, summary.lease_until], ["", null]);
  const [[audit]] = await h.db.query(
    "SELECT actor_user_id, detail FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.precheck'",
    [created.id]);
  assert.equal(Number(audit.actor_user_id), h.userId);
  assert.equal(audit.detail.after.totalCount, 8);
});

integrationTest("TASK-043 IMP-014 (TC-099): a Bank column fails the file and its value reaches no row, job, audit or log", async () => {
  const header = [...SUPPLIER_IMPORT_COLUMN_NAMES, "IBAN"];
  const created = await upload(csv([{ supplierCode: "BANK-1", supplierName: "Bank Co", defaultCurrencyCode: "HKD", IBAN: BANK_VALUE }], header));
  const result = await precheck(created.id);
  assert.equal(result.status, "failed");
  const failed = await job(created.id);
  assert.deepEqual([failed.last_error_code, Number(failed.total_count)], ["SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN", 0]);
  assert.match(failed.error_summary, /銀行/u);
  assert.equal(failed.completed_at !== null, true);
  assert.deepEqual(await rows(created.id), []);

  const [scan] = await h.db.query(
    `SELECT (SELECT COUNT(*) FROM supplier_import_rows WHERE CAST(normalized_payload AS CHAR) LIKE ?) AS payload,
            (SELECT COUNT(*) FROM supplier_import_jobs WHERE error_summary LIKE ?) AS jobs,
            (SELECT COUNT(*) FROM supplier_audit_logs WHERE CAST(detail AS CHAR) LIKE ?) AS audits,
            (SELECT COUNT(*) FROM suppliers WHERE notes LIKE ?) AS suppliers`,
    Array(4).fill(`%${BANK_VALUE}%`));
  assert.deepEqual(Object.values(scan[0]).map(Number), [0, 0, 0, 0]);
  const logged = [];
  for (const directory of ["system", "requests"]) {
    const full = path.join(h.logRoot, directory);
    if (!fs.existsSync(full)) continue;
    for (const name of await readdir(full)) logged.push(await readFile(path.join(full, name), "utf8"));
  }
  assert.equal(logged.join("\n").includes(BANK_VALUE), false, "the system and request logs never contain it");
});

integrationTest("TASK-043: a precheck whose lease expired is redone from the start by the next worker", async () => {
  const created = await upload(csv([{ supplierCode: `L-${randomUUID().slice(0, 6)}`, supplierName: "Lease", defaultCurrencyCode: "HKD" }]));
  const service = h.worker.importService;
  let claimed;
  for (let attempt = 0; attempt < 20 && claimed?.id !== created.id; attempt += 1) {
    claimed = await service.claimForPrecheck({ leaseOwner: "crashed-worker", leaseDurationMs: 1000 });
    if (claimed && claimed.id !== created.id) await precheck(claimed.id);   // 其他測試留低嘅
  }
  await service.appendPrecheckRows({ jobId: created.id, leaseOwner: "crashed-worker", leaseDurationMs: 1000, rows: [{
    rowNumber: 1, operation: "create", matchSupplierId: null, expectedSupplierVersion: null,
    normalizedPayload: { root: {} }, status: "invalid", errors: [], warnings: []
  }] });
  assert.deepEqual(await h.worker.runPrecheck(new AbortController().signal), { claimed: false }, "a live lease is not taken over");
  clock += 5_000;   // lease 過期
  const result = await precheck(created.id);
  assert.equal(result.status, "ready");
  assert.deepEqual((await rows(created.id)).map((row) => [row.row_number, row.status]), [[1, "valid"]], "the partial rows were replaced");
  await assert.rejects(() => service.completePrecheck({ jobId: created.id, leaseOwner: "crashed-worker" }),
    { publicCode: "SUPPLIER_IMPORT_LEASE_LOST" }, "the old owner cannot complete it afterwards");
  await assert.rejects(() => service.appendPrecheckRows({ jobId: created.id, leaseOwner: "crashed-worker", leaseDurationMs: 1000,
    rows: [{ rowNumber: 2, operation: "create", matchSupplierId: null, expectedSupplierVersion: null, normalizedPayload: { root: {} },
      status: "valid", errors: [], warnings: [] }] }),
  { publicCode: "SUPPLIER_IMPORT_LEASE_LOST" }, "nor add rows to it");
  assert.equal((await rows(created.id)).length, 1);
});

integrationTest("TASK-043: a precheck claim skips a job another transaction holds instead of waiting for it", async () => {
  const created = await upload(csv([{ supplierCode: `K-${randomUUID().slice(0, 6)}`, supplierName: "Locked", defaultCurrencyCode: "HKD" }]));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let locked;
  const locking = new Promise((resolve) => { locked = resolve; });
  const holder = h.db.withTransaction(async (connection) => {
    await connection.query("SELECT id FROM supplier_import_jobs WHERE id = ? FOR UPDATE", [created.id]);
    locked();
    await held;
  });
  await locking;
  const started = Date.now();
  const claimed = await h.worker.importService.claimForPrecheck({ leaseOwner: "other", leaseDurationMs: 60_000 });
  assert.notEqual(claimed?.id, created.id);
  assert.ok(Date.now() - started < 3_000, "the claim did not wait for the lock");
  release();
  await holder;
  assert.equal((await precheck(created.id)).status, "ready");
});

integrationTest("TASK-043: a file that fails after some rows were written leaves no rows behind", async () => {
  const created = await upload(csv([{ supplierCode: `P-${randomUUID().slice(0, 6)}`, supplierName: "Partial", defaultCurrencyCode: "HKD" }]));
  const service = h.worker.importService;
  let claimed;
  for (let attempt = 0; attempt < 20 && claimed?.id !== created.id; attempt += 1) {
    claimed = await service.claimForPrecheck({ leaseOwner: "partial", leaseDurationMs: 60_000 });
    if (claimed && claimed.id !== created.id) throw new Error(`unexpected job ${claimed.id} was waiting`);
  }
  // 好似一個 500 列之後先壞嘅檔：第一批已經寫咗，之後先發現問題。
  await service.appendPrecheckRows({ jobId: created.id, leaseOwner: "partial", leaseDurationMs: 60_000, rows: [{
    rowNumber: 1, operation: "create", matchSupplierId: null, expectedSupplierVersion: null,
    normalizedPayload: { root: {} }, status: "valid", errors: [], warnings: []
  }] });
  const summary = await service.completePrecheck({ jobId: created.id, leaseOwner: "partial",
    jobLevelError: { code: "SUPPLIER_IMPORT_CSV_MALFORMED", message: "CSV 格式不符合 RFC 4180（引號或欄數不正確）" } });
  assert.deepEqual([summary.status, summary.totalCount, summary.lastErrorCode], ["failed", 0, "SUPPLIER_IMPORT_CSV_MALFORMED"]);
  assert.deepEqual(await rows(created.id), []);
});

/** 一個有指定權限嘅用戶同佢嘅 JWT（呢兩條 route 係 jwt，唔使設備簽章）。 */
async function makeUser(label, permissions) {
  const now = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [role] = await h.db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`imp43-${label}-${suffix}`, now]);
  const roleId = Number(role.insertId);
  h.roleIds.push(roleId);
  for (const name of permissions) {
    const [[permission]] = await h.db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await h.db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', ?, ?, ?)",
    [`imp43-${label}-${suffix}`, `Import ${label}`, now, now]);
  const userId = Number(user.insertId);
  h.userIds.push(userId);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  const version = await h.application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await h.jwt.issue({ roles: [`imp43-${label}-${suffix}`], permissions },
    { subject: String(userId), version, authTime: Math.floor(Date.now() / 1000) });
  return { userId, token };
}

async function httpUpload(user, content, { key = randomUUID(), mode = "create_only", type = "text/csv" } = {}) {
  const form = new FormData();
  form.append("mode", mode);
  form.append("file", new Blob([content], { type }), "suppliers.csv");
  const response = await fetch(`${h.url}/api/v1/supplier-imports/upload`, {
    method: "POST", body: form, headers: { authorization: `Bearer ${user.token}`, "idempotency-key": key }
  });
  const body = await response.json().catch(() => null);
  if (response.status === 201) h.jobIds.push(body.data?.id ?? body.id);
  return { status: response.status, body, job: body?.data ?? body };
}

integrationTest("TASK-043 manual-check flow over HTTP: template, mixed and Bank uploads, replay, permission and MIME", async () => {
  const manager = await makeUser("mgmt", ["supplier.mgmt"]);
  const viewer = await makeUser("view", ["supplier.view"]);

  const template = await fetch(`${h.url}/api/v1/supplier-imports/template`, { headers: { authorization: `Bearer ${manager.token}` } });
  assert.equal(template.status, 200);
  assert.match(template.headers.get("content-type"), /^text\/csv/u);
  assert.equal(template.headers.get("x-supplier-import-template-version"), "v1");
  // 睇原始 bytes：fetch 嘅 text() 會食咗 BOM。
  const templateBytes = Buffer.from(await template.arrayBuffer());
  assert.ok(templateBytes.toString("utf8").startsWith(`\uFEFF${SUPPLIER_IMPORT_COLUMN_NAMES.join(",")}\r\n`));

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const mixed = csv([
    { supplierCode: `H1-${tag}`, supplierName: `Http One ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `H2-${tag}`, supplierName: `Http One ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `H3-${tag}`, supplierName: `Http Three ${tag}` }
  ]);
  const key = randomUUID();
  const first = await httpUpload(manager, mixed, { key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.job.status, "uploaded");
  assert.equal(JSON.stringify(first.body).includes(h.worker.preparedRoot), false, "no filesystem path in the response");
  const replay = await httpUpload(manager, mixed, { key });
  assert.deepEqual([replay.status, replay.job.id], [201, first.job.id], "the same key and file replay the first job");
  const reused = await httpUpload(manager, csv([{ supplierCode: "OTHER" }]), { key });
  assert.ok(reused.status >= 400 && reused.status < 500, `the same key with another file is refused (${reused.status})`);
  const [[{ n: jobsForKey }]] = await h.db.query(
    "SELECT COUNT(*) AS n FROM supplier_import_jobs WHERE created_by = ?", [manager.userId]);
  assert.equal(Number(jobsForKey), 1, "one job, however often it was sent");

  assert.equal((await httpUpload(viewer, mixed)).status, 403, "supplier.view cannot upload");
  const wrongType = await httpUpload(manager, mixed, { type: "application/json" });
  assert.ok(wrongType.status >= 400 && wrongType.status < 500, `a non-CSV MIME type is refused (${wrongType.status})`);

  assert.equal((await precheck(first.job.id)).status, "ready_with_errors");
  assert.deepEqual((await rows(first.job.id)).map((row) => [row.row_number, row.status]),
    [[1, "valid"], [2, "warning"], [3, "invalid"]]);

  const bank = await httpUpload(manager, csv([{ supplierCode: `HB-${tag}`, accountNumber: BANK_VALUE }],
    [...SUPPLIER_IMPORT_COLUMN_NAMES, "accountNumber"]));
  assert.equal(bank.status, 201);
  assert.equal((await precheck(bank.job.id)).status, "failed");
  assert.equal((await job(bank.job.id)).last_error_code, "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN");

  await h.application.services.require("logging").logger.flush?.();
  const requests = path.join(h.logRoot, "requests");
  const logged = fs.existsSync(requests)
    ? (await Promise.all((await readdir(requests)).map((name) => readFile(path.join(requests, name), "utf8")))).join("\n") : "";
  assert.equal(logged.includes(BANK_VALUE), false, "the request log never holds the uploaded content");
});

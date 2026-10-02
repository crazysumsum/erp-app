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
import { hashNameBigrams } from "../../src/modules/supplier/supplierDuplicateCandidates.js";
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
  userId: null, roleIds: [], userIds: [], currencies: [], approvalSetting: null };
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
    // T45 嘅執行會整齊成個 aggregate（子資料、name grams、審批申請、audit）。
    for (const table of ["supplier_address_purposes", "supplier_addresses", "supplier_contact_purposes", "supplier_contacts",
      "supplier_identifiers", "supplier_name_grams", "supplier_activation_requests", "supplier_audit_logs"]) {
      await h.db.execute(`DELETE FROM ${table} WHERE supplier_id = ?`, [id]);
    }
    await h.db.execute("DELETE FROM suppliers WHERE id = ?", [id]);
  }
  for (const code of h.currencies) await h.db.execute("DELETE FROM currencies WHERE code = ?", [code]);
  if (h.approvalSetting !== null) {
    await h.db.execute("UPDATE supplier_settings SET require_activation_approval = ? WHERE id = 1", [h.approvalSetting]);
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
  assert.deepEqual(checked[1].warnings, ["SUPPLIER_IMPORT_NAME_EXISTS"]);
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
  assert.equal((await stat(path.join(h.worker.preparedRoot, "source", summary.source_stored_name))).isFile(), true,
    "a job that is ready keeps its source for confirm and the result");
  assert.equal(summary.files_purged_at, null);
  const [[audit]] = await h.db.query(
    "SELECT actor_user_id, detail FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.precheck'",
    [created.id]);
  assert.equal(Number(audit.actor_user_id), h.userId);
  assert.equal(audit.detail.after.totalCount, 8);
});

/** Root 入面有冇檔含呢個值（IMP-014 嘅 files 通道；REV-064 M-1）。 */
async function rootHolds(value) {
  for (const kind of ["source", "result"]) {
    const directory = path.join(h.worker.preparedRoot, kind);
    for (const name of await readdir(directory)) {
      if ((await readFile(path.join(directory, name), "utf8")).includes(value)) return true;
    }
  }
  return false;
}

async function logsHold(value) {
  const logged = [];
  for (const directory of ["system", "requests"]) {
    const full = path.join(h.logRoot, directory);
    if (!fs.existsSync(full)) continue;
    for (const name of await readdir(full)) logged.push(await readFile(path.join(full, name), "utf8"));
  }
  return logged.join("\n").includes(value);
}

integrationTest("TASK-043 IMP-014 (TC-099): a Bank column is refused at upload and its value reaches no row, job, file, audit or log", async () => {
  const header = [...SUPPLIER_IMPORT_COLUMN_NAMES, "IBAN"];
  const [[{ n: jobsBefore }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_import_jobs");
  await assert.rejects(() => upload(csv([{ supplierCode: "BANK-1", supplierName: "Bank Co", defaultCurrencyCode: "HKD", IBAN: BANK_VALUE }], header)),
    (error) => error.publicCode === "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN" && error.statusCode === 400 && /銀行/u.test(error.publicMessage));
  const [[{ n: jobsAfter }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_import_jobs");
  assert.equal(Number(jobsAfter), Number(jobsBefore), "no job");
  const [scan] = await h.db.query(
    `SELECT (SELECT COUNT(*) FROM supplier_import_rows WHERE CAST(normalized_payload AS CHAR) LIKE ?) AS payload,
            (SELECT COUNT(*) FROM supplier_import_jobs WHERE error_summary LIKE ?) AS jobs,
            (SELECT COUNT(*) FROM supplier_audit_logs WHERE CAST(detail AS CHAR) LIKE ?) AS audits,
            (SELECT COUNT(*) FROM suppliers WHERE notes LIKE ?) AS suppliers`,
    Array(4).fill(`%${BANK_VALUE}%`));
  assert.deepEqual(Object.values(scan[0]).map(Number), [0, 0, 0, 0]);
  assert.equal(await rootHolds(BANK_VALUE), false, "nothing was stored in the import root");
  // 開頭一行空行，或者 BOM 之後先空行：上載同 precheck 要讀到同一個 header（REV-065 M-1）。
  for (const prefix of ["\r\n", "\n", "\uFEFF\r\n"]) {
    const file = Buffer.concat([Buffer.from(prefix), csv([{ supplierCode: "BANK-2", IBAN: BANK_VALUE }], header)]);
    await assert.rejects(() => upload(file), { publicCode: "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN", statusCode: 400 }, JSON.stringify(prefix));
  }
  assert.equal(await logsHold(BANK_VALUE), false, "the system and request logs never contain it");
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

/** 一個有指定權限嘅用戶同佢嘅 JWT（呢啲 route 係 jwt 或 jwt-password，唔使設備簽章）。 */
const PASSWORD = "Imp0rt-Pa55-T45";
async function makeUser(label, permissions, { withPassword = false } = {}) {
  const now = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [role] = await h.db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`imp43-${label}-${suffix}`, now]);
  const roleId = Number(role.insertId);
  h.roleIds.push(roleId);
  for (const name of permissions) {
    const [[permission]] = await h.db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await h.db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  // confirm 係 jwt-password：要真 hash，password re-auth 先驗得到。
  const passwordHash = withPassword ? await (await import("../../src/modules/user/passwordHash.js")).hashPassword(PASSWORD) : "x";
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [`imp43-${label}-${suffix}`, passwordHash, `Import ${label}`, now, now]);
  const userId = Number(user.insertId);
  h.userIds.push(userId);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  const version = await h.application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await h.jwt.issue({ roles: [`imp43-${label}-${suffix}`], permissions },
    { subject: String(userId), version, authTime: Math.floor(Date.now() / 1000) });
  return { userId, token, roleId };
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
  assert.equal(bank.status, 400, "a Bank column is refused at upload (HD-053 A)");
  assert.equal(JSON.stringify(bank.body).includes("SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN"), true);
  assert.equal(await rootHolds(BANK_VALUE), false);

  await h.application.services.require("logging").logger.flush?.();
  const requests = path.join(h.logRoot, "requests");
  const logged = fs.existsSync(requests)
    ? (await Promise.all((await readdir(requests)).map((name) => readFile(path.join(requests, name), "utf8")))).join("\n") : "";
  assert.equal(logged.includes(BANK_VALUE), false, "the request log never holds the uploaded content");
});

integrationTest("TASK-043 (REV-064 H-1): a stray quote fails the job as malformed and its cell text reaches no log", async () => {
  const header = SUPPLIER_IMPORT_COLUMN_NAMES.join(",");
  const cells = SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({
    supplierCode: `Q-${randomUUID().slice(0, 6)}`, supplierName: "Quote", defaultCurrencyCode: "HKD", notes: `iban ${BANK_VALUE} "x"`
  })[name] ?? "");
  const created = await upload(Buffer.from(`${header}\r\n${cells.join(",")}\r\n`));
  const result = await precheck(created.id);
  const failed = await job(created.id);
  assert.deepEqual([result.status, failed.last_error_code], ["failed", "SUPPLIER_IMPORT_CSV_MALFORMED"]);
  assert.notEqual(failed.files_purged_at, null, "a failed precheck purges its source at once (HD-053 A)");
  assert.equal(await rootHolds(BANK_VALUE), false, "the stored file with the value in it is gone");
  assert.equal(await logsHold(BANK_VALUE), false);
});

integrationTest("TASK-043 (REV-064 H-1/H-2): a precheck that keeps failing is abandoned after three attempts", async () => {
  const created = await upload(csv([{ supplierCode: `A-${randomUUID().slice(0, 6)}`, supplierName: "Again", defaultCurrencyCode: "HKD" }]));
  const service = h.worker.importService;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claimed = await service.claimForPrecheck({ leaseOwner: `crash-${attempt}`, leaseDurationMs: 1000 });
    assert.equal(claimed?.id, created.id, `attempt ${attempt} is claimed`);
    // 每次都寫低一列先死：放棄嘅時候呢啲列（有名、聯絡資料）要一齊刪（REV-065 L-2）。
    await service.appendPrecheckRows({ jobId: created.id, leaseOwner: `crash-${attempt}`, leaseDurationMs: 1000, rows: [{
      rowNumber: 1, operation: "create", matchSupplierId: null, expectedSupplierVersion: null,
      normalizedPayload: { root: { supplierName: "Again" } }, status: "valid", errors: [], warnings: []
    }] });
    clock += 5_000;   // 每次都死咗，lease 過期
  }
  const stored = (await job(created.id)).source_stored_name;
  assert.deepEqual(await h.worker.runPrecheck(new AbortController().signal), { claimed: true, jobId: created.id, status: "failed" });
  const abandoned = await job(created.id);
  assert.deepEqual([abandoned.status, abandoned.last_error_code, abandoned.lease_until], ["failed", "SUPPLIER_IMPORT_PRECHECK_FAILED", null]);
  assert.notEqual(abandoned.completed_at, null);
  assert.notEqual(abandoned.files_purged_at, null);
  assert.deepEqual(await rows(created.id), [], "the abandoned job keeps no row payloads");
  await assert.rejects(() => stat(path.join(h.worker.preparedRoot, "source", stored)), { code: "ENOENT" }, "its source is deleted");
  const [[audit]] = await h.db.query(
    "SELECT detail FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.precheck'", [created.id]);
  assert.equal(audit.detail.after.errorCode, "SUPPLIER_IMPORT_PRECHECK_FAILED");
});

integrationTest("TASK-043 (REV-064 L-2): every appended batch renews the precheck lease", async () => {
  const created = await upload(csv([{ supplierCode: `R-${randomUUID().slice(0, 6)}`, supplierName: "Renew", defaultCurrencyCode: "HKD" }]));
  const service = h.worker.importService;
  const claimed = await service.claimForPrecheck({ leaseOwner: "renewer", leaseDurationMs: 1000 });
  assert.equal(claimed?.id, created.id);
  const before = Number((await job(created.id)).lease_until);
  clock += 500;
  await service.appendPrecheckRows({ jobId: created.id, leaseOwner: "renewer", leaseDurationMs: 1000, rows: [{
    rowNumber: 1, operation: "create", matchSupplierId: null, expectedSupplierVersion: null,
    normalizedPayload: { root: {} }, status: "valid", errors: [], warnings: []
  }] });
  assert.equal(Number((await job(created.id)).lease_until), before + 500);
  await service.completePrecheck({ jobId: created.id, leaseOwner: "renewer" });
});

integrationTest("TASK-043 (REV-064 H-2, IMP-003): a 10,000-row file finishes precheck against 2,000 Suppliers well inside the job timeout", async (t) => {
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const now = clock;
  const seeded = Array.from({ length: 2_000 }, (_, index) => {
    const name = `Seeded ${index} Trading Company Limited ${tag}`;
    return [`SD-${tag}-${index}`, `sd-${tag.toLowerCase()}-${index}`, name, name.toLowerCase(), "HKD", "active", now, now];
  });
  await h.db.query(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
       status, created_at, updated_at) VALUES ?`, [seeded]);
  // 真 Supplier 一定有 name grams；冇嘅話，逐列模糊比對（H-2 嘅成因）放返入去都唔會慢，測試就捉唔到（REV-065 L-1）。
  const [seededRows] = await h.db.query("SELECT id, supplier_name_key FROM suppliers WHERE supplier_code_key LIKE ?", [`sd-${tag.toLowerCase()}-%`]);
  const grams = seededRows.flatMap((row) => hashNameBigrams(row.supplier_name_key).map((hash) => [row.id, hash]));
  for (let start = 0; start < grams.length; start += 5_000) {
    await h.db.query("INSERT INTO supplier_name_grams (supplier_id, gram_hash) VALUES ?", [grams.slice(start, start + 5_000)]);
  }
  t.after(async () => {
    await h.db.query("DELETE FROM supplier_name_grams WHERE supplier_id IN (?)", [seededRows.map((row) => row.id)]);
    await h.db.query("DELETE FROM suppliers WHERE supplier_code_key LIKE ?", [`sd-${tag.toLowerCase()}-%`]);
  });
  const records = Array.from({ length: 10_000 }, (_, index) => ({
    supplierCode: `BIG-${tag}-${index}`, supplierName: `Imported ${index} Trading Company Limited ${tag}`, defaultCurrencyCode: "HKD"
  }));
  const created = await upload(csv(records));
  const started = Date.now();
  const result = await precheck(created.id);
  const elapsed = Date.now() - started;
  assert.equal(result.status, "ready");
  assert.equal(Number((await job(created.id)).total_count), 10_000);
  t.diagnostic(`10,000-row precheck against 2,000 Suppliers took ${elapsed} ms`);
  assert.ok(elapsed < 60_000, `took ${elapsed} ms; the job timeout is 150 s`);
});

/** TASK-044：叫 job API，回 `{ status, data, body }`。每個 IP 每秒 20 個請求：429 就照 Retry-After 等。 */
async function api(user, method, url, { body, key } = {}) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key) headers["idempotency-key"] = key;
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(`${h.url}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status !== 429) break;
    await response.arrayBuffer();
    await new Promise((resolve) => { setTimeout(resolve, 1000 * Number(response.headers.get("retry-after") ?? 1)); });
  }
  const parsed = await response.json().catch(() => null);
  return { status: response.status, body: parsed, data: parsed?.data ?? parsed };
}

const errorCode = (result) => JSON.stringify(result.body).match(/"(?:code|publicCode)":"([A-Z_]+)"/u)?.[1];

async function sourceExists(jobId) {
  const { source_stored_name: name } = await job(jobId);
  return fs.existsSync(path.join(h.worker.preparedRoot, "source", name));
}

integrationTest("TASK-044 IMP-015: only the uploader lists, reads and cancels a job; the job API tells no one else it exists", async () => {
  const owner = await makeUser("own", ["supplier.mgmt"]);
  const other = await makeUser("oth", ["supplier.mgmt"]);
  const viewer = await makeUser("v44", ["supplier.view"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const created = await httpUpload(owner, csv([{ supplierCode: `O-${tag}`, supplierName: `Owner ${tag}`, defaultCurrencyCode: "HKD" }]));
  assert.equal(created.status, 201);
  const id = created.job.id;

  const mine = await api(owner, "GET", "/api/v1/supplier-imports");
  assert.deepEqual([mine.status, mine.data.items.map((item) => item.id), mine.data.total], [200, [id], 1]);
  assert.equal((await api(owner, "GET", "/api/v1/supplier-imports?status=ready")).data.total, 0, "the status filter applies");
  const theirs = await api(other, "GET", "/api/v1/supplier-imports");
  assert.deepEqual([theirs.status, theirs.data.items, theirs.data.total], [200, [], 0], "another manager's list is empty");

  const [[{ maxId }]] = await h.db.query("SELECT MAX(id) AS maxId FROM supplier_import_jobs");
  const missing = Number(maxId) + 1000;
  for (const [method, suffix, body] of [["GET", "", undefined], ["POST", "/cancel", { version: 1 }]]) {
    const foreign = await api(other, method, `/api/v1/supplier-imports/${id}${suffix}`, { body, key: randomUUID() });
    const absent = await api(other, method, `/api/v1/supplier-imports/${missing}${suffix}`, { body, key: randomUUID() });
    assert.deepEqual([foreign.status, errorCode(foreign)], [404, "SUPPLIER_IMPORT_NOT_FOUND"], `${method} ${suffix}`);
    assert.deepEqual([absent.status, errorCode(absent)], [foreign.status, errorCode(foreign)], "same answer as a job that does not exist");
    assert.equal(foreign.body?.error?.message ?? foreign.body?.message, absent.body?.error?.message ?? absent.body?.message);
    assert.equal((await api(viewer, method, `/api/v1/supplier-imports/${id}${suffix}`, { body, key: randomUUID() })).status, 403,
      "supplier.view is not enough");
  }
  assert.equal((await api(viewer, "GET", "/api/v1/supplier-imports")).status, 403);
  assert.equal((await job(id)).status, "uploaded", "nobody else changed it");
  assert.equal(await sourceExists(id), true);
  // template 仲係 template，唔係 `/:id`（handler 註冊次序）。
  assert.equal((await api(owner, "GET", "/api/v1/supplier-imports/template")).status, 200);
  const own = await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version: 1 }, key: randomUUID() });
  assert.deepEqual([own.status, own.data.status], [200, "cancelled"], "the uploader can");
});

integrationTest("TASK-044: detail pages the rows by row number, filters by status, and serves none before precheck finishes", async () => {
  const owner = await makeUser("det", ["supplier.mgmt"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const existing = await seedSupplier({ code: `D6-${tag}`, name: `Detail Six ${tag}` });
  const created = await httpUpload(owner, csv([
    { supplierCode: `D1-${tag}`, supplierName: `Detail One ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `D2-${tag}`, supplierName: `Detail Two ${tag}` },
    { supplierCode: `D3-${tag}`, supplierName: `Detail Three ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `D4-${tag}`, supplierName: `Detail Four ${tag}` },
    { supplierCode: `D5-${tag}`, supplierName: `Detail Five ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `D6-${tag}`, supplierName: `Detail Six Renamed ${tag}` }
  ]), { mode: "upsert" });
  const id = created.job.id;
  const before = await api(owner, "GET", `/api/v1/supplier-imports/${id}`);
  assert.deepEqual([before.status, before.data.job.status, before.data.rows, before.data.total], [200, "uploaded", [], 0]);

  // validating：rows 已經寫咗一批，但未完成嘅預檢一列都唔回（REV-068 I-2）。
  const service = h.worker.importService;
  const claimed = await service.claimForPrecheck({ leaseOwner: "t44", leaseDurationMs: 60_000 });
  assert.equal(claimed?.id, id, "this test's job is the only one waiting");
  await service.appendPrecheckRows({ jobId: id, leaseOwner: "t44", leaseDurationMs: 60_000, rows: [{
    rowNumber: 1, operation: "create", matchSupplierId: null, expectedSupplierVersion: null,
    normalizedPayload: { root: { supplierCode: `D1-${tag}` } }, status: "valid", errors: [], warnings: []
  }] });
  const during = await api(owner, "GET", `/api/v1/supplier-imports/${id}`);
  assert.deepEqual([during.data.job.status, during.data.rows, during.data.total], ["validating", [], 0]);
  assert.equal((await rows(id)).length, 1, "the rows exist; they are just not served");
  const busy = await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version: during.data.job.version }, key: randomUUID() });
  assert.deepEqual([busy.status, errorCode(busy)], [409, "SUPPLIER_IMPORT_NOT_CANCELLABLE"], "a prechecking job cannot be cancelled");
  clock += 120_000;
  assert.equal((await precheck(id)).status, "ready_with_errors");

  const page2 = await api(owner, "GET", `/api/v1/supplier-imports/${id}?page=2&pageSize=2`);
  assert.equal(page2.status, 200);
  assert.deepEqual([page2.data.total, page2.data.page, page2.data.pageSize, page2.data.rows.map((row) => row.rowNumber)], [6, 2, 2, [3, 4]]);
  const page3 = await api(owner, "GET", `/api/v1/supplier-imports/${id}?page=3&pageSize=2`);
  assert.deepEqual(page3.data.rows.map((row) => [row.rowNumber, row.operation, row.matchSupplierId, row.appliedSupplierId]),
    [[5, "create", null, null], [6, "update", existing, null]]);
  assert.deepEqual(page2.data.job, (await api(owner, "GET", "/api/v1/supplier-imports")).data.items[0], "list and detail agree");
  assert.deepEqual([page2.data.job.totalCount, page2.data.job.validCount, page2.data.job.invalidCount, page2.data.job.filesPurged],
    [6, 4, 2, false]);
  const invalid = await api(owner, "GET", `/api/v1/supplier-imports/${id}?rowStatus=invalid`);
  assert.deepEqual(invalid.data.rows.map((row) => [row.rowNumber, row.status, row.errors[0].field]),
    [[2, "invalid", "defaultCurrencyCode"], [4, "invalid", "defaultCurrencyCode"]]);
  assert.equal(invalid.data.total, 2);
  assert.equal(invalid.data.rows[0].normalizedPayload.root.supplierCode, `D2-${tag}`);

  for (const query of ["pageSize=101", "pageSize=0", "page=0", "rowStatus=nope", "extra=1"]) {
    assert.equal((await api(owner, "GET", `/api/v1/supplier-imports/${id}?${query}`)).status, 400, query);
  }
  assert.equal((await api(owner, "GET", "/api/v1/supplier-imports?status=nope")).status, 400);
  assert.equal((await api(owner, "GET", "/api/v1/supplier-imports/abc")).status, 400);
  // T45 嘅執行錯誤冇 field（rowError 只有 code 同 message）；response schema 一樣要收。
  await h.db.execute("UPDATE supplier_import_rows SET status = 'failed', errors = ? WHERE job_id = ? AND `row_number` = 1",
    [JSON.stringify([{ code: "SUPPLIER_IMPORT_ROW_FAILED", message: "匯入資料列處理失敗" }]), id]);
  const failed = await api(owner, "GET", `/api/v1/supplier-imports/${id}?rowStatus=failed`);
  assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.deepEqual(failed.data.rows.map((row) => [row.rowNumber, row.errors]),
    [[1, [{ code: "SUPPLIER_IMPORT_ROW_FAILED", message: "匯入資料列處理失敗" }]]]);
  const text = JSON.stringify(page2.body) + JSON.stringify(invalid.body);
  const stored = await job(id);
  for (const secret of [h.worker.preparedRoot, stored.source_stored_name, Buffer.from(stored.source_sha256).toString("hex")]) {
    assert.equal(text.includes(secret), false, "no path, stored name or hash in a response");
  }
});

integrationTest("TASK-044 (HD-058 2A/3A): cancel ends the job, deletes the source, keeps the rows and is replay-safe", async () => {
  const owner = await makeUser("can", ["supplier.mgmt"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const ready = await httpUpload(owner, csv([{ supplierCode: `C1-${tag}`, supplierName: `Cancel ${tag}`, defaultCurrencyCode: "HKD" }]));
  assert.equal((await precheck(ready.job.id)).status, "ready");
  const id = ready.job.id;
  const { version } = (await api(owner, "GET", `/api/v1/supplier-imports/${id}`)).data.job;

  const stale = await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version: version - 1 }, key: randomUUID() });
  assert.deepEqual([stale.status, errorCode(stale)], [409, "VERSION_CONFLICT"]);
  assert.equal((await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version } })).status, 400,
    "an idempotency key is required");

  const key = randomUUID();
  const cancelled = await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version }, key });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.deepEqual([cancelled.data.status, cancelled.data.filesPurged, cancelled.data.version], ["cancelled", true, version + 1]);
  assert.ok(cancelled.data.completedAt > 0);
  assert.equal(await sourceExists(id), false, "the source file is gone");
  const replay = await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version }, key });
  assert.deepEqual([replay.status, replay.data], [200, cancelled.data], "the same key replays the first answer");
  const again = await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version: version + 1 }, key: randomUUID() });
  assert.deepEqual([again.status, errorCode(again)], [409, "SUPPLIER_IMPORT_NOT_CANCELLABLE"], "a cancelled job stays cancelled");

  const detail = await api(owner, "GET", `/api/v1/supplier-imports/${id}`);
  assert.deepEqual([detail.data.job.status, detail.data.total, detail.data.rows[0].status], ["cancelled", 1, "valid"],
    "summary and rows are kept");
  const [audits] = await h.db.query(
    "SELECT actor_user_id, detail FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.cancel'", [id]);
  assert.equal(audits.length, 1, "one audit row, however often it was sent");
  assert.equal(Number(audits[0].actor_user_id), owner.userId);
  assert.deepEqual(typeof audits[0].detail === "string" ? JSON.parse(audits[0].detail) : audits[0].detail,
    { before: { status: "ready" }, after: { status: "cancelled" } });

  // uploaded 都取消得，取消咗嘅 job precheck 唔會再領。
  const uploaded = await httpUpload(owner, csv([{ supplierCode: `C2-${tag}`, supplierName: `Cancel Two ${tag}`, defaultCurrencyCode: "HKD" }]));
  const early = await api(owner, "POST", `/api/v1/supplier-imports/${uploaded.job.id}/cancel`, { body: { version: 1 }, key: randomUUID() });
  assert.deepEqual([early.status, early.data.status], [200, "cancelled"]);
  assert.equal(await sourceExists(uploaded.job.id), false);
  const next = await h.worker.runPrecheck(new AbortController().signal);
  assert.notEqual(next.jobId, uploaded.job.id, "precheck never picks a cancelled job");
  const filtered = await api(owner, "GET", "/api/v1/supplier-imports?status=cancelled&pageSize=1");
  assert.deepEqual([filtered.data.total, filtered.data.items.map((item) => item.id)], [2, [uploaded.job.id]], "newest first");
  const second = await api(owner, "GET", "/api/v1/supplier-imports?status=cancelled&pageSize=1&page=2");
  assert.deepEqual(second.data.items.map((item) => item.id), [id], "page 2 is the older one");
});

integrationTest("TASK-044 (HD-058 3A): a source that cannot be deleted is logged and left for T48; the cancel still stands", async () => {
  const errors = [];
  const service = new SupplierImportService({ database: h.db, time, logger: { error: (...entry) => errors.push(entry) } });
  const created = await upload(csv([{ supplierCode: `N-${randomUUID().slice(0, 6)}`, supplierName: "No Root", defaultCurrencyCode: "HKD" }]));
  const cancelled = await service.cancel({ actorId: h.userId, claimedRoles: [], claimedPermissions: [], id: created.id, version: 1, root: null });
  assert.deepEqual([cancelled.status, cancelled.filesPurged], ["cancelled", true]);
  assert.equal(await sourceExists(created.id), true, "nothing could delete it without a root");
  assert.deepEqual(errors.map(([event, , detail]) => [event, detail.jobId, detail.code]),
    [["supplier.import.source_cleanup_failed", created.id, "SUPPLIER_IMPORT_UNAVAILABLE"]]);
  const { source_stored_name: name } = await job(created.id);
  fs.rmSync(path.join(h.worker.preparedRoot, "source", name));
});

integrationTest("TASK-044: a manager whose permission was withdrawn after the token was issued is refused at once", async () => {
  const owner = await makeUser("stl", ["supplier.mgmt"]);
  const created = await httpUpload(owner, csv([{ supplierCode: `S-${randomUUID().slice(0, 6)}`, supplierName: "Stale", defaultCurrencyCode: "HKD" }]));
  await h.db.execute(
    "DELETE rp FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?", [owner.userId]);
  for (const [method, url, body] of [["GET", "/api/v1/supplier-imports", undefined], ["GET", `/api/v1/supplier-imports/${created.job.id}`, undefined],
    ["POST", `/api/v1/supplier-imports/${created.job.id}/cancel`, { version: 1 }]]) {
    const refused = await api(owner, method, url, { body, key: randomUUID() });
    assert.deepEqual([refused.status, errorCode(refused)], [403, "PERMISSION_STALE"], `${method} ${url}`);
  }
  assert.equal((await job(created.job.id)).status, "uploaded", "the cancel did nothing");
  await h.db.execute("UPDATE supplier_import_jobs SET status = 'cancelled' WHERE id = ?", [created.job.id]);
});

integrationTest("TASK-044 (REV-069 M-1): cancel waits for a claim that holds the job, then refuses the job it moved on", async () => {
  const service = h.worker.importService;
  const actor = { actorId: h.userId, claimedRoles: [], claimedPermissions: [] };
  for (const [from, to] of [["uploaded", "validating"], ["queued", "running"]]) {
    const created = await upload(csv([{ supplierCode: `R-${randomUUID().slice(0, 6)}`, supplierName: "Race", defaultCurrencyCode: "HKD" }]));
    if (from === "queued") {
      await h.db.execute("UPDATE supplier_import_jobs SET status = 'queued', confirmed_by = ?, confirmed_at = ? WHERE id = ?",
        [h.userId, clock, created.id]);
    }
    let pending;
    let settled = false;
    let settledWhileHeld;
    // 一個未 commit 嘅 claim：鎖住 job、改咗狀態。Cancel 要等佢，見到新狀態就拒絕。
    await h.db.withTransaction(async (connection) => {
      await connection.query("SELECT id FROM supplier_import_jobs WHERE id = ? FOR UPDATE", [created.id]);
      await connection.execute("UPDATE supplier_import_jobs SET status = ?, lease_owner = 'race', lease_until = ? WHERE id = ?",
        [to, clock + 60_000, created.id]);
      pending = service.cancel({ ...actor, id: created.id, version: 1, root: h.worker.preparedRoot }).then(
        (value) => ({ value }), (error) => ({ error }));
      pending.then(() => { settled = true; });
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      settledWhileHeld = settled;
    });
    const outcome = await pending;
    assert.equal(settledWhileHeld, false, `${from}: cancel waited for the claim`);
    assert.equal(outcome.error?.publicCode, "SUPPLIER_IMPORT_NOT_CANCELLABLE", `${from} -> ${to}`);
    assert.equal((await job(created.id)).status, to);
    assert.equal(await sourceExists(created.id), true, "the claimed job keeps its source");
    await h.db.execute("UPDATE supplier_import_jobs SET status = 'failed', lease_owner = '', lease_until = NULL WHERE id = ?", [created.id]);
  }
});

integrationTest("TASK-044 (REV-069 L-1): another user's cancel answers 404 at once, without waiting on a job someone holds", async () => {
  const stranger = { actorId: h.userId, claimedRoles: [], claimedPermissions: [] };
  const owner = await makeUser("lck", ["supplier.mgmt"]);
  const created = await httpUpload(owner, csv([{ supplierCode: `L-${randomUUID().slice(0, 6)}`, supplierName: "Locked", defaultCurrencyCode: "HKD" }]));
  let elapsed;
  let outcome;
  await h.db.withTransaction(async (connection) => {
    await connection.query("SELECT id FROM supplier_import_jobs WHERE id = ? FOR UPDATE", [created.job.id]);
    const started = Date.now();
    outcome = await h.worker.importService.cancel({ ...stranger, id: created.job.id, version: 1, root: h.worker.preparedRoot })
      .then((value) => ({ value }), (error) => ({ error }));
    elapsed = Date.now() - started;
  });
  assert.equal(outcome.error?.publicCode, "SUPPLIER_IMPORT_NOT_FOUND");
  assert.ok(elapsed < 1_000, `answered in ${elapsed} ms while the job was locked`);
  const own = await api(owner, "POST", `/api/v1/supplier-imports/${created.job.id}/cancel`, { body: { version: 1 }, key: randomUUID() });
  assert.equal(own.data.status, "cancelled");
});

integrationTest("TASK-044 (REV-069 L-3, HD-058 3A): the source is deleted only after the cancel commits", async () => {
  const created = await upload(csv([{ supplierCode: `T-${randomUUID().slice(0, 6)}`, supplierName: "Rolled Back", defaultCurrencyCode: "HKD" }]));
  // 成個 cancel 做完先拋：等同 commit 失敗，transaction rollback。
  const failingCommit = { withTransaction: (work) => h.db.withTransaction(async (connection) => {
    await work(connection);
    throw new Error("commit failed");
  }) };
  const service = new SupplierImportService({ database: failingCommit, time, logger: {} });
  await assert.rejects(() => service.cancel({ actorId: h.userId, claimedRoles: [], claimedPermissions: [], id: created.id, version: 1,
    root: h.worker.preparedRoot }), (error) => error.cause?.message === "commit failed" || error.message === "commit failed");
  assert.equal((await job(created.id)).status, "uploaded", "the cancel rolled back");
  assert.equal(await sourceExists(created.id), true, "so the source is still there");
  await h.db.execute("UPDATE supplier_import_jobs SET status = 'cancelled' WHERE id = ?", [created.id]);
});

/* ---------------------------------------------------------------- TASK-045 ---------------------------------------------------------------- */

const confirmJob = (user, id, body, key = randomUUID()) =>
  api(user, "POST", `/api/v1/supplier-imports/${id}/confirm`, { body: { password: PASSWORD, ...body }, key });

async function setApproval(on) {
  if (h.approvalSetting === null) h.approvalSetting = Number((await h.db.query("SELECT require_activation_approval AS v FROM supplier_settings WHERE id = 1"))[0][0].v);
  await h.db.execute("UPDATE supplier_settings SET require_activation_approval = ?, version = version + 1 WHERE id = 1", [on ? 1 : 0]);
  return Number((await h.db.query("SELECT version FROM supplier_settings WHERE id = 1"))[0][0].version);
}

/** 上載、預檢，回 `{ id, version }`（ready 或 ready_with_errors）。 */
async function readyJob(owner, records, { mode = "create_only" } = {}) {
  const created = await httpUpload(owner, csv(records), { mode });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const result = await precheck(created.job.id);
  assert.ok(["ready", "ready_with_errors"].includes(result.status), result.status);
  return { id: created.job.id, version: Number((await job(created.job.id)).version) };
}

/** 用 app 嘅 worker（真 applyRow）做完指定 job；之後記低佢寫過嘅 Supplier 等 after() 清走。 */
async function execute(jobId) {
  let result;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    result = await h.worker.runExecution(new AbortController().signal);
    if (!result.claimed || result.jobId === jobId) break;
  }
  const [applied] = await h.db.query("SELECT applied_supplier_id AS id FROM supplier_import_rows WHERE job_id = ? AND applied_supplier_id IS NOT NULL", [jobId]);
  h.supplierIds.push(...applied.map((row) => Number(row.id)));
  return result;
}

async function rowOutcomes(jobId) {
  const [result] = await h.db.query(
    "SELECT `row_number`, status, applied_supplier_id, errors FROM supplier_import_rows WHERE job_id = ? ORDER BY `row_number`", [jobId]);
  return result.map((row) => [Number(row.row_number), row.status, row.errors.map((error) => error.code)[0] ?? null]);
}

const supplierByCode = async (code) => (await h.db.query("SELECT * FROM suppliers WHERE supplier_code_key = ?", [code.toLowerCase()]))[0][0];

integrationTest("TASK-045: confirm needs the uploader's password, a ready job at its version and, to activate with approval on, an eligible approver", async () => {
  const owner = await makeUser("cf", ["supplier.mgmt"], { withPassword: true });
  const outsider = await makeUser("cx", ["supplier.mgmt"], { withPassword: true });
  const approver = await makeUser("ap", ["supplier.view", "supplier.approval"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const early = await httpUpload(owner, csv([{ supplierCode: `E-${tag}`, supplierName: `Early ${tag}`, defaultCurrencyCode: "HKD" }]));
  const notYet = await confirmJob(owner, early.job.id, { version: 1, activationMode: "draft" });
  assert.deepEqual([notYet.status, errorCode(notYet)], [409, "SUPPLIER_IMPORT_NOT_CONFIRMABLE"], "an unprechecked job cannot be confirmed");
  await api(owner, "POST", `/api/v1/supplier-imports/${early.job.id}/cancel`, { body: { version: 1 }, key: randomUUID() });

  const { id, version } = await readyJob(owner, [{ supplierCode: `C-${tag}`, supplierName: `Confirm ${tag}`, defaultCurrencyCode: "HKD" }]);
  const foreign = await confirmJob(outsider, id, { version, activationMode: "draft" });
  assert.deepEqual([foreign.status, errorCode(foreign)], [404, "SUPPLIER_IMPORT_NOT_FOUND"], "only the uploader confirms (HD-060 1A)");
  const noPassword = await api(owner, "POST", `/api/v1/supplier-imports/${id}/confirm`, { body: { version, activationMode: "draft" }, key: randomUUID() });
  assert.equal(noPassword.status, 400, "the password is required");
  const wrongPassword = await confirmJob(owner, id, { version, activationMode: "draft", password: "not-it" });
  assert.deepEqual([wrongPassword.status, errorCode(wrongPassword)], [403, "PASSWORD_INVALID"]);
  const stale = await confirmJob(owner, id, { version: version - 1, activationMode: "draft" });
  assert.deepEqual([stale.status, errorCode(stale)], [409, "VERSION_CONFLICT"]);

  await setApproval(false);
  const notRequired = await confirmJob(owner, id, { version, activationMode: "activate", approverUserId: approver.userId });
  assert.deepEqual([notRequired.status, errorCode(notRequired)], [400, "APPROVER_NOT_REQUIRED"]);
  const settingVersion = await setApproval(true);
  for (const [approverUserId, code] of [[undefined, "APPROVER_REQUIRED"], [owner.userId, "APPROVER_MUST_DIFFER"],
    [outsider.userId, "APPROVER_NOT_ELIGIBLE"]]) {
    const refused = await confirmJob(owner, id, { version, activationMode: "activate", approverUserId });
    assert.deepEqual([refused.status, errorCode(refused)], [400, code], String(approverUserId));
  }
  assert.equal((await job(id)).status, "ready", "no refusal changed the job");

  const key = randomUUID();
  const confirmed = await confirmJob(owner, id, { version, activationMode: "activate", approverUserId: approver.userId }, key);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.deepEqual([confirmed.data.status, confirmed.data.activationMode, confirmed.data.version], ["queued", "activate", version + 1]);
  assert.ok(confirmed.data.confirmedAt > 0);
  const stored = await job(id);
  assert.deepEqual([stored.approver_user_id, stored.approval_setting_value, stored.approval_setting_version, stored.confirmed_by].map(Number),
    [approver.userId, 1, settingVersion, owner.userId], "the policy, approver and confirmer are snapshotted (AC-013)");
  const replay = await confirmJob(owner, id, { version, activationMode: "activate", approverUserId: approver.userId }, key);
  assert.deepEqual([replay.status, replay.data], [200, confirmed.data], "the same key replays the first answer");
  const again = await confirmJob(owner, id, { version: version + 1, activationMode: "draft" });
  assert.deepEqual([again.status, errorCode(again)], [409, "SUPPLIER_IMPORT_NOT_CONFIRMABLE"]);
  const [audits] = await h.db.query("SELECT detail FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.confirm'", [id]);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].detail.after, { status: "queued", activationMode: "activate", approvalRequired: true,
    approverUserId: approver.userId, approvalSettingVersion: settingVersion });
  await api(owner, "POST", `/api/v1/supplier-imports/${id}/cancel`, { body: { version: version + 1 }, key: randomUUID() });
  await setApproval(false);
});

integrationTest("TASK-045: a draft import writes each valid row as one Supplier aggregate with its children and audit, and skips invalid rows", async () => {
  const owner = await makeUser("dr", ["supplier.mgmt"], { withPassword: true });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const { id, version } = await readyJob(owner, [
    { supplierCode: `A1-${tag}`, supplierName: `Aggregate One ${tag}`, defaultCurrencyCode: "HKD", displayName: "Agg One",
      addressLabel: "Head office", addressPurpose: "office", addressLine1: "1 Example Road", city: "Hong Kong", countryCode: "HK",
      contactName: "Alex Chan", contactPurpose: "orders", contactEmail: `alex.${tag.toLowerCase()}@example.com`,
      identifierType: "tax", issuerCountryCode: "HK", identifierValue: `T${tag}01` },
    { supplierCode: `A2-${tag}`, supplierName: `Aggregate Two ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `A3-${tag}`, supplierName: `Aggregate Three ${tag}` }
  ]);
  assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
  const result = await execute(id);
  assert.deepEqual([result.status, result.applied], ["completed", 2]);
  assert.deepEqual(await rowOutcomes(id), [[1, "applied", null], [2, "applied", null], [3, "skipped", "SUPPLIER_IMPORT_REQUIRED_FIELD"]]);

  const one = await supplierByCode(`A1-${tag}`);
  assert.deepEqual([one.status, one.display_name, Number(one.created_by)], ["draft", "Agg One", owner.userId], "the confirmer is the actor");
  const count = async (table) => Number((await h.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE supplier_id = ?`, [one.id]))[0][0].n);
  assert.deepEqual(await Promise.all(["supplier_addresses", "supplier_address_purposes", "supplier_contacts", "supplier_contact_purposes",
    "supplier_identifiers"].map(count)), [1, 1, 1, 1, 1]);
  assert.ok(await count("supplier_name_grams") > 0, "name grams are written as by the UI");
  const [audits] = await h.db.query("SELECT action, actor_user_id FROM supplier_audit_logs WHERE supplier_id = ? ORDER BY id", [one.id]);
  assert.deepEqual(audits.map((audit) => audit.action).sort(),
    ["supplier.address.create", "supplier.contact.create", "supplier.create", "supplier.identifier.create"]);
  assert.ok(audits.every((audit) => Number(audit.actor_user_id) === owner.userId));
  const [[marker]] = await h.db.query("SELECT applied_supplier_id FROM supplier_import_rows WHERE job_id = ? AND `row_number` = 1", [id]);
  assert.equal(Number(marker.applied_supplier_id), Number(one.id));
  const detail = await api(owner, "GET", `/api/v1/supplier-imports/${id}`);
  assert.deepEqual([detail.data.job.status, detail.data.job.appliedCount, detail.data.job.failedCount, detail.data.job.skippedCount],
    ["completed", 2, 0, 1]);
});

integrationTest("TASK-045 (AC-013, BR-012): activation follows the policy snapshotted at confirm; with approval it opens a request that already lists the new identifier", async () => {
  const owner = await makeUser("ac", ["supplier.mgmt"], { withPassword: true });
  const approver = await makeUser("aa", ["supplier.view", "supplier.approval"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  await setApproval(true);
  const pendingJob = await readyJob(owner, [{ supplierCode: `P-${tag}`, supplierName: `Pending ${tag}`, defaultCurrencyCode: "HKD",
    identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `BR${tag}` }]);
  assert.equal((await confirmJob(owner, pendingJob.id, { version: pendingJob.version, activationMode: "activate", approverUserId: approver.userId })).status, 200);
  await setApproval(false); // 確認之後改設定：唔追溯
  const directJob = await readyJob(owner, [{ supplierCode: `D-${tag}`, supplierName: `Direct ${tag}`, defaultCurrencyCode: "HKD" }]);
  assert.equal((await confirmJob(owner, directJob.id, { version: directJob.version, activationMode: "activate" })).status, 200);
  await execute(pendingJob.id);
  await execute(directJob.id);

  const pending = await supplierByCode(`P-${tag}`);
  assert.equal(pending.status, "pending_approval", "approval was on at confirm, so the later switch does not apply");
  const [[request]] = await h.db.query("SELECT assigned_approver_id, requested_by, status, summary FROM supplier_activation_requests WHERE supplier_id = ?", [pending.id]);
  assert.deepEqual([Number(request.assigned_approver_id), Number(request.requested_by), request.status], [approver.userId, owner.userId, "pending"]);
  assert.equal(request.summary.identifierCount, 1, "the request's snapshot includes the identifier created in the same row");
  assert.equal((await supplierByCode(`D-${tag}`)).status, "active", "approval off at confirm: active at once");
});

integrationTest("TASK-045 (HD-060 3A): an approver who lost the permission after confirm fails every activating row, and no Supplier is left", async () => {
  const owner = await makeUser("al", ["supplier.mgmt"], { withPassword: true });
  const approver = await makeUser("ag", ["supplier.view", "supplier.approval"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  await setApproval(true);
  const { id, version } = await readyJob(owner, [{ supplierCode: `G-${tag}`, supplierName: `Gone ${tag}`, defaultCurrencyCode: "HKD" }]);
  assert.equal((await confirmJob(owner, id, { version, activationMode: "activate", approverUserId: approver.userId })).status, 200);
  await setApproval(false);
  await h.db.execute("DELETE FROM role_permissions WHERE role_id = ?", [approver.roleId]);
  const result = await execute(id);
  assert.equal(result.status, "completed_with_errors");
  assert.deepEqual(await rowOutcomes(id), [[1, "failed", "APPROVER_NOT_ELIGIBLE"]]);
  assert.equal(await supplierByCode(`G-${tag}`), undefined);
});

integrationTest("TASK-045: update rows change root fields only, keep blank cells, and treat a pending Supplier as the UI does", async () => {
  const owner = await makeUser("up", ["supplier.mgmt"], { withPassword: true });
  const approver = await makeUser("uq", ["supplier.view", "supplier.approval"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const other = `Q${tag.slice(0, 2)}`.replace(/[^A-Z]/gu, "Q").padEnd(3, "Q").slice(0, 3);
  await h.db.execute(`INSERT INTO currencies (code, name, decimal_places, status, version, created_at, updated_at)
    VALUES (?, 'T45 test currency', 2, 'ACTIVE', 1, ?, ?)`, [other, clock, clock]);
  h.currencies.push(other);
  // 兩個 pending（各有申請）同一個 active Supplier，經匯入整出嚟。
  await setApproval(true);
  const seed = await readyJob(owner, [
    { supplierCode: `U1-${tag}`, supplierName: `Update One ${tag}`, defaultCurrencyCode: "HKD", notes: "keep me" },
    { supplierCode: `U2-${tag}`, supplierName: `Update Two ${tag}`, defaultCurrencyCode: "HKD" }
  ]);
  await confirmJob(owner, seed.id, { version: seed.version, activationMode: "activate", approverUserId: approver.userId });
  await setApproval(false);
  await execute(seed.id);
  const active = await readyJob(owner, [{ supplierCode: `U3-${tag}`, supplierName: `Update Three ${tag}`, defaultCurrencyCode: "HKD", displayName: "Three" }]);
  await confirmJob(owner, active.id, { version: active.version, activationMode: "activate" });
  await execute(active.id);

  const update = await readyJob(owner, [
    { supplierCode: `U1-${tag}`, generalPhone: "+852 2000 0001" },                  // 唔顯著：申請保留
    { supplierCode: `U2-${tag}`, supplierName: `Update Two Renamed ${tag}` },       // 顯著：申請失效、回 draft
    { supplierCode: `U3-${tag}`, defaultCurrencyCode: other }                      // 改幣別：要原因
  ], { mode: "upsert" });
  assert.equal((await confirmJob(owner, update.id, { version: update.version, activationMode: "activate" })).status, 200);
  const result = await execute(update.id);
  assert.equal(result.status, "completed", JSON.stringify(await rowOutcomes(update.id)));

  const one = await supplierByCode(`U1-${tag}`);
  assert.deepEqual([one.status, one.general_phone, one.notes, one.supplier_name], ["pending_approval", "+852 2000 0001", "keep me", `Update One ${tag}`],
    "blank cells keep their values; an update never changes the status");
  const [[kept]] = await h.db.query("SELECT status, supplier_version FROM supplier_activation_requests WHERE supplier_id = ?", [one.id]);
  assert.deepEqual([kept.status, Number(kept.supplier_version)], ["pending", Number(one.version)], "the request follows the new version");
  const two = await supplierByCode(`U2-${tag}`);
  const [[invalidated]] = await h.db.query("SELECT status FROM supplier_activation_requests WHERE supplier_id = ?", [two.id]);
  assert.deepEqual([two.status, invalidated.status], ["draft", "invalidated"], "a significant change invalidates the request (REV-064 I-4)");
  const three = await supplierByCode(`U3-${tag}`);
  assert.deepEqual([three.status, three.default_currency_code, three.display_name], ["active", other, "Three"]);
  const [[audit]] = await h.db.query("SELECT reason FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier.update'", [three.id]);
  assert.equal(audit.reason, `CSV 匯入 #${update.id}`, "the currency change carries the import as its reason");
});

integrationTest("TASK-045: execution re-checks what precheck saw — a Code or Identifier taken since, an archived target, a moved version, a retired currency", async () => {
  const owner = await makeUser("rc", ["supplier.mgmt"], { withPassword: true });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const retired = `R${tag.replace(/[^A-Z]/gu, "R").slice(0, 2)}`.padEnd(3, "R");
  await h.db.execute(`INSERT INTO currencies (code, name, decimal_places, status, version, created_at, updated_at)
    VALUES (?, 'T45 retired currency', 2, 'ACTIVE', 1, ?, ?)`, [retired, clock, clock]);
  h.currencies.push(retired);
  const archivedId = await seedSupplier({ code: `X1-${tag}`, name: `Archive Me ${tag}` });
  const movedId = await seedSupplier({ code: `X2-${tag}`, name: `Move Me ${tag}` });
  const { id, version } = await readyJob(owner, [
    { supplierCode: `X1-${tag}`, notes: "archived later" },
    { supplierCode: `X2-${tag}`, notes: "version moves" },
    { supplierCode: `N1-${tag}`, supplierName: `Code Taken ${tag}`, defaultCurrencyCode: "HKD" },
    { supplierCode: `N2-${tag}`, supplierName: `Identifier Taken ${tag}`, defaultCurrencyCode: "HKD",
      identifierType: "tax", issuerCountryCode: "HK", identifierValue: `ID${tag}` },
    { supplierCode: `N3-${tag}`, supplierName: `Retired Currency ${tag}`, defaultCurrencyCode: retired },
    { supplierCode: `N4-${tag}`, supplierName: `Still Fine ${tag}`, defaultCurrencyCode: "HKD" }
  ], { mode: "upsert" });
  assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
  await h.db.execute("UPDATE suppliers SET status = 'archived' WHERE id = ?", [archivedId]);
  await h.db.execute("UPDATE suppliers SET version = version + 1 WHERE id = ?", [movedId]);
  await seedSupplier({ code: `N1-${tag}`, name: `Squatter ${tag}` });
  await seedSupplier({ code: `S-${tag}`, name: `Holder ${tag}`, identifier: `ID${tag}` });
  await h.db.execute("UPDATE currencies SET status = 'INACTIVE' WHERE code = ?", [retired]);

  const result = await execute(id);
  assert.equal(result.status, "completed_with_errors");
  const outcomes = await rowOutcomes(id);
  assert.deepEqual(outcomes.map(([row, status]) => [row, status]),
    [[1, "failed"], [2, "failed"], [3, "failed"], [4, "failed"], [5, "failed"], [6, "applied"]]);
  assert.deepEqual(outcomes.slice(0, 4).map(([, , code]) => code),
    ["SUPPLIER_UPDATE_NOT_ALLOWED", "VERSION_CONFLICT", "SUPPLIER_CODE_TAKEN", "SUPPLIER_IDENTIFIER_TAKEN"]);
  assert.match(outcomes[4][2], /CURRENCY/u, "a currency retired since precheck is refused by Business Master");
  assert.equal(await supplierByCode(`N2-${tag}`), undefined, "the identifier failure rolled back the Supplier it would have joined");
});

integrationTest("TASK-045 (HD-048 4): a failure after the real Supplier write leaves no Supplier, child, name gram or audit behind", async () => {
  const owner = await makeUser("fw", ["supplier.mgmt"], { withPassword: true });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const { id, version } = await readyJob(owner, [{ supplierCode: `F-${tag}`, supplierName: `Fails Late ${tag}`, defaultCurrencyCode: "HKD",
    contactName: "Late Contact", contactPurpose: "general", identifierType: "tax", issuerCountryCode: "HK", identifierValue: `FL${tag}` }]);
  assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
  const service = h.worker.importService;
  assert.equal((await service.claimForExecution({ leaseOwner: "late", leaseDurationMs: 60_000 }))?.id, id);
  let written;
  const outcome = await service.processNextRow({ jobId: id, leaseOwner: "late", leaseDurationMs: 60_000,
    applyRow: async (connection, context) => {
      written = await h.worker.applyRow(connection, context);
      throw new Error("injected after the Supplier write");
    } });
  assert.ok(written > 0, "the real writer ran");
  assert.equal(outcome.status, "failed");
  assert.equal(Number((await h.db.query("SELECT COUNT(*) AS n FROM suppliers WHERE id = ?", [written]))[0][0].n), 0);
  for (const table of ["supplier_name_grams", "supplier_contacts", "supplier_identifiers", "supplier_audit_logs"]) {
    assert.equal(Number((await h.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE supplier_id = ?`, [written]))[0][0].n), 0, table);
  }
  await service.finalizeExecution({ jobId: id, leaseOwner: "late" });
});

integrationTest("TASK-045 (HD-060 5A): a confirmer who loses supplier.mgmt stops the job; applied rows stay, the rest fail", async () => {
  const owner = await makeUser("rv", ["supplier.mgmt"], { withPassword: true });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const { id, version } = await readyJob(owner, [1, 2, 3].map((n) => ({ supplierCode: `V${n}-${tag}`, supplierName: `Revoked ${n} ${tag}`, defaultCurrencyCode: "HKD" })));
  assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
  const service = h.worker.importService;
  assert.equal((await service.claimForExecution({ leaseOwner: "rv", leaseDurationMs: 60_000 }))?.id, id);
  const first = await service.processNextRow({ jobId: id, leaseOwner: "rv", leaseDurationMs: 60_000, applyRow: h.worker.applyRow });
  assert.equal(first.status, "applied");
  h.supplierIds.push(first.appliedSupplierId);
  await h.db.execute("DELETE FROM role_permissions WHERE role_id = ?", [owner.roleId]);
  const stopped = await service.processNextRow({ jobId: id, leaseOwner: "rv", leaseDurationMs: 60_000, applyRow: h.worker.applyRow });
  assert.equal(stopped.status, "revoked");
  assert.deepEqual(await rowOutcomes(id), [[1, "applied", null], [2, "failed", "SUPPLIER_IMPORT_AUTHORIZATION_REVOKED"],
    [3, "failed", "SUPPLIER_IMPORT_AUTHORIZATION_REVOKED"]]);
  const stored = await job(id);
  assert.deepEqual([stored.status, stored.last_error_code, Number(stored.applied_count), Number(stored.failed_count), stored.lease_owner],
    ["failed", "SUPPLIER_IMPORT_AUTHORIZATION_REVOKED", 1, 2, ""]);
  assert.equal(await supplierByCode(`V2-${tag}`), undefined);
});

/** 起一個真 worker process，做到 `point` 就 SIGKILL 自己；回佢點樣死。 */
async function crashWorker(point) {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["--import", "./test-support/testEnv.js", "test-support/supplierImportCrashChild.js",
    point, path.join(h.importBase, "imports"), h.logRoot], { cwd: path.resolve(import.meta.dirname, "../.."), env: process.env, stdio: "ignore" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("crash worker did not die in time")); }, 60_000);
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

integrationTest("TASK-045 fault injection: a worker killed before or after a row's commit leaves both or neither, and the next worker finishes once", async () => {
  const owner = await makeUser("kl", ["supplier.mgmt"], { withPassword: true });
  for (const point of ["before", "after"]) {
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const codes = [1, 2, 3].map((n) => `K${n}-${tag}`);
    const { id, version } = await readyJob(owner, codes.map((code) => ({ supplierCode: code, supplierName: `Killed ${code}`, defaultCurrencyCode: "HKD" })));
    assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
    assert.deepEqual(await crashWorker(point), { code: null, signal: "SIGKILL" }, `${point}: the worker died by SIGKILL`);

    const stored = await job(id);
    assert.equal(stored.status, "running", `${point}: the dead worker still holds the lease`);
    const first = await supplierByCode(codes[0]);
    if (point === "before") {
      assert.equal(first, undefined, "killed before commit: no Supplier");
      assert.deepEqual(await rowOutcomes(id), [[1, "valid", null], [2, "valid", null], [3, "valid", null]], "and no marker");
    } else {
      assert.ok(first, "killed after commit: the Supplier is there");
      assert.deepEqual((await rowOutcomes(id))[0], [1, "applied", null], "and so is its marker");
    }
    // 下一個 worker：lease 過期之後接手（佢用測試時鐘）。
    clock = Number(stored.lease_until) + 1;
    const result = await execute(id);
    assert.deepEqual([result.status, (await rowOutcomes(id)).map(([, status]) => status)], ["completed", ["applied", "applied", "applied"]]);
    for (const code of codes) {
      assert.equal(Number((await h.db.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key = ?", [code.toLowerCase()]))[0][0].n), 1,
        `${point}: ${code} applied exactly once`);
    }
  }
});

integrationTest("TASK-045: two workers never apply a row twice — one claim wins, and a worker that lost its lease writes nothing", async () => {
  const owner = await makeUser("tw", ["supplier.mgmt"], { withPassword: true });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const codes = [1, 2, 3].map((n) => `W${n}-${tag}`);
  const { id, version } = await readyJob(owner, codes.map((code) => ({ supplierCode: code, supplierName: `Twin ${code}`, defaultCurrencyCode: "HKD" })));
  assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
  const first = h.worker.importService;
  const second = new SupplierImportService({ database: h.db, time, logger: h.worker.logger });
  const claims = await Promise.all([first, second].map((service, index) =>
    service.claimForExecution({ leaseOwner: `twin-${index}`, leaseDurationMs: 1_000 })));
  assert.equal(claims.filter((claim) => claim?.id === id).length, 1, "exactly one worker claims the job");
  const [owning, waiting] = claims[0]?.id === id ? [[first, "twin-0"], [second, "twin-1"]] : [[second, "twin-1"], [first, "twin-0"]];
  const step = ([service, leaseOwner]) => service.processNextRow({ jobId: id, leaseOwner, leaseDurationMs: 1_000, applyRow: h.worker.applyRow });
  assert.equal((await step(owning)).status, "applied");
  clock += 2_000; // 第一個 worker 停咗，lease 過期
  assert.equal((await waiting[0].claimForExecution({ leaseOwner: waiting[1], leaseDurationMs: 1_000 }))?.id, id, "the other worker takes over");
  const [stale, fresh] = await Promise.allSettled([step(owning), step(waiting)]);
  assert.equal(stale.reason?.publicCode, "SUPPLIER_IMPORT_LEASE_LOST", "the old owner cannot write");
  assert.equal(fresh.value?.status, "applied");
  while (await step(waiting)) { /* 做完 */ }
  await waiting[0].finalizeExecution({ jobId: id, leaseOwner: waiting[1] });
  const [applied] = await h.db.query("SELECT applied_supplier_id AS id FROM supplier_import_rows WHERE job_id = ?", [id]);
  h.supplierIds.push(...applied.map((row) => Number(row.id)));
  for (const code of codes) {
    assert.equal(Number((await h.db.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key = ?", [code.toLowerCase()]))[0][0].n), 1, code);
  }
});

integrationTest("TASK-045 (HD-060 5A): a confirmer whose account was deactivated after confirm writes nothing", async () => {
  const owner = await makeUser("dx", ["supplier.mgmt"], { withPassword: true });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const { id, version } = await readyJob(owner, [{ supplierCode: `DX-${tag}`, supplierName: `Deactivated ${tag}`, defaultCurrencyCode: "HKD" }]);
  assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
  await h.db.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [owner.userId]);
  const result = await execute(id);
  assert.equal(result.status, "failed");
  assert.deepEqual(await rowOutcomes(id), [[1, "failed", "SUPPLIER_IMPORT_AUTHORIZATION_REVOKED"]]);
  assert.equal(await supplierByCode(`DX-${tag}`), undefined);
});

integrationTest("TASK-045 (HD-048 3): each row, job lock included, finishes far inside DB_TRANSACTION_TIMEOUT_MS", async (t) => {
  const owner = await makeUser("tm", ["supplier.mgmt"], { withPassword: true });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const records = Array.from({ length: 300 }, (_, index) => ({
    supplierCode: `TM${index}-${tag}`, supplierName: `Timed ${index} Trading ${tag}`, defaultCurrencyCode: "HKD",
    addressLabel: "Office", addressPurpose: "office", addressLine1: `${index} Road`, contactName: `Contact ${index}`, contactPurpose: "orders",
    identifierType: "tax", issuerCountryCode: "HK", identifierValue: `TM${tag}${index}`
  }));
  const { id, version } = await readyJob(owner, records);
  assert.equal((await confirmJob(owner, id, { version, activationMode: "draft" })).status, 200);
  const service = h.worker.importService;
  assert.equal((await service.claimForExecution({ leaseOwner: "timer", leaseDurationMs: 600_000 }))?.id, id);
  let slowest = 0;
  const started = Date.now();
  for (;;) {
    const before = Date.now();
    const row = await service.processNextRow({ jobId: id, leaseOwner: "timer", leaseDurationMs: 600_000, applyRow: h.worker.applyRow });
    if (!row) break;
    assert.equal(row.status, "applied");
    h.supplierIds.push(row.appliedSupplierId);
    slowest = Math.max(slowest, Date.now() - before);
  }
  await service.finalizeExecution({ jobId: id, leaseOwner: "timer" });
  t.diagnostic(`300 full rows in ${Date.now() - started} ms; slowest row ${slowest} ms (DB_TRANSACTION_TIMEOUT_MS defaults to 20,000)`);
  assert.ok(slowest < 2_000, `slowest row took ${slowest} ms`);
});

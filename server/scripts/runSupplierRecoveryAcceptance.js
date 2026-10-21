import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "csv-stringify/sync";

import { normalizeSupplierConfig } from "../src/modules/supplier/normalizeSupplierConfig.js";
import { SupplierBankCrypto } from "../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../src/modules/supplier/SupplierBankService.js";
import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";
import { createSupplierHarness } from "../test/integration/supplierHttpHarness.js";
import {
  adminConnection, adminCredentials, checklist, errorText, mysqlClient, outputPath, scratchName, tableChecksums, writeReport
} from "../test/integration/supplierAcceptanceRunner.js";

/**
 * TC-133（OPS-006）：Supplier 全模組 backup／restore（HD-119 A）。
 *
 * 本機做得到嘅：經真 HTTP 種齊 core、child、Bank（真加密）、settings、待審批申請、匯入 job 同佢嘅檔案、audit，
 * 最後一筆寫入做 transaction marker；`mysqldump` 成個 DB_NAME 同複製匯入檔目錄；還原去一個獨立 schema
 * （`${DB_NAME}_rh_*`）；逐張 table CHECKSUM、逐個檔 SHA-256 對賬；喺還原嘅 schema 上面起一個新 app 做 smoke
 * （detail、masked Bank、有授權 reveal 攞返原本帳號、審批隊列、匯入結果下載）；冇 key ring 或者錯 key 一定 fail closed。
 *
 * 本機做唔到嘅：RTO ≤ 4 小時、RPO ≤ 15 分鐘。嗰兩個數取決於 production 嘅備份排程、binlog 同還原環境，
 * 本機量到嘅秒數同 RPO 0 唔代表佢哋，所以另開一項 NOT_RUN。
 */
const reportPath = outputPath();
const LOCAL = "TC-133 local full-module backup and isolated restore: table and file reconciliation, smoke, key ring";
const PRODUCTION = "TC-133 production restore drill: RTO within 4 hours and RPO within 15 minutes";
const NOT_RUN_REASON = "Needs the production backup schedule, binlog retention and an isolated restore environment; a local logical copy cannot show RTO or RPO.";
const REASON = "TC-133 recovery rehearsal";
const tag = randomUUID().slice(0, 8).toUpperCase();
const { checks, check, passed } = checklist();
const metrics = {};
const work = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-recovery-"));
const source = createSupplierHarness("rh133", { importRoot: path.join(work, "source-imports") });
let restored = null;
let restoreName = null;
let admin = null;
let originalApproval = null;
let settings = null;
let localStatus = "FAIL";

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fileManifest(root) {
  if (!fs.existsSync(root)) return {};
  return Object.fromEntries(fs.readdirSync(root, { recursive: true }).map(String).sort()
    .filter((name) => fs.statSync(path.join(root, name)).isFile()).map((name) => [name, sha256(path.join(root, name))]));
}

async function expectOk(name, response) {
  if (response.status < 200 || response.status > 299) throw new Error(`${name}: ${response.status} ${String(response.text).slice(0, 300)}`);
  return response.json?.data;
}

async function setApproval(h, user, on) {
  const current = (await h.send(user, h.route("GET /api/v1/supplier-settings"))).json.data;
  if (current.requireActivationApproval === on) return current.requireActivationApproval;
  await expectOk("settings", await h.send(user, h.route("POST /api/v1/supplier-settings/update"),
    { body: { requireActivationApproval: on, version: current.version, reason: `${REASON} ${on ? "on" : "off"}` } }));
  return current.requireActivationApproval;
}

async function uploadImport(h, user, code) {
  const content = stringify([SUPPLIER_IMPORT_COLUMN_NAMES,
    SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({ supplierCode: code, supplierName: `Imported ${code}`, defaultCurrencyCode: "HKD" })[name] ?? "")],
  SUPPLIER_CSV_STRINGIFY_OPTIONS);
  const form = new FormData();
  form.append("mode", "create_only");
  form.append("file", new Blob([content], { type: "text/csv" }), `${code}.csv`);
  const response = await fetch(`${h.url}/api/v1/supplier-imports/upload`, { method: "POST", body: form,
    headers: { authorization: `Bearer ${user.token}`, "idempotency-key": randomUUID() } });
  const json = await response.json();
  if (response.status !== 201) throw new Error(`import upload: ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
  h.jobIds.push(json.data.id);
  return json.data;
}

/** 一個只認得 `encryption`／`lookup` 入面嗰啲 key 嘅 Bank service，直接打還原咗嘅 schema。 */
function bankServiceWith(database, { encryption, lookup }) {
  const config = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: Object.keys(encryption)[0], keyRing: JSON.stringify(encryption) },
    bankLookup: { activeKeyId: Object.keys(lookup)[0], keyRing: JSON.stringify(lookup) }
  });
  return new SupplierBankService({
    database, logger: { warn() {}, info() {}, error() {} }, time: { nowMs: () => Date.now() },
    crypto: new SupplierBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup }),
    authorize: async () => ({ id: null, username: "rh133-key-check", permissions: ["supplier.view", "supplier.bank.view"] }),
    audit: { async record() {} }
  });
}

try {
  // ---- 種資料（真 HTTP、真 MySQL）----
  await source.start();
  const mgmt = await source.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
  const approver = await source.makeUser("apr", ["supplier.view", "supplier.approval"]);
  const bank = await source.makeUser("bank", ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]);
  settings = await source.makeUser("set", ["supplier.settings"]);
  const send = (user, key, options) => source.send(user, source.route(key), options);
  originalApproval = await setApproval(source, settings, false);

  const supplier = await expectOk("create", await send(mgmt, "POST /api/v1/suppliers/create",
    { body: { supplierCode: `RCV-${tag}`, supplierName: `Recovery ${tag}`, defaultCurrencyCode: "HKD" } }));
  source.supplierIds.push(supplier.id);
  const ids = { id: supplier.id, supplierId: supplier.id };
  await expectOk("activate", await send(mgmt, "POST /api/v1/suppliers/:id/activate", { ids, body: { version: supplier.version } }));
  await expectOk("address", await send(mgmt, "POST /api/v1/suppliers/:supplierId/addresses/create",
    { ids, body: { label: "HQ", purposes: [{ purposeCode: "ordering", isPrimary: true }] } }));
  await expectOk("contact", await send(mgmt, "POST /api/v1/suppliers/:supplierId/contacts/create",
    { ids, body: { name: "Recovery Contact", purposes: [{ purposeCode: "orders", isPrimary: true }] } }));
  await expectOk("identifier", await send(mgmt, "POST /api/v1/suppliers/:supplierId/identifiers/create",
    { ids, body: { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `RC${tag}` } }));
  const account = `64${randomBytes(6).readUIntBE(0, 6).toString().padStart(12, "0").slice(0, 12)}`;
  const bankAccount = await expectOk("bank create", await send(bank, "POST /api/v1/suppliers/:id/bank-accounts/create",
    { ids, body: { accountHolderName: "Recovery Holder", bankName: "Recovery Bank", accountNumber: account, isDefault: true, reason: REASON } }));

  await setApproval(source, settings, true);
  const pending = await expectOk("pending create", await send(mgmt, "POST /api/v1/suppliers/create", { body: { supplierCode: `RCP-${tag}`,
    supplierName: `Recovery pending ${tag}`, defaultCurrencyCode: "HKD", activate: true, approverUserId: approver.userId } }));
  source.supplierIds.push(pending.id);
  await setApproval(source, settings, false);

  const job = await uploadImport(source, mgmt, `RCI-${tag}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await source.worker.runPrecheck(new AbortController().signal);
    if (!result.claimed || result.jobId === job.id) break;
  }
  const ready = (await send(mgmt, "GET /api/v1/supplier-imports/:id", { ids: { id: job.id } })).json.data.job;
  await expectOk("import confirm", await send(mgmt, "POST /api/v1/supplier-imports/:id/confirm",
    { ids: { id: job.id }, body: { version: ready.version, activationMode: "draft", approverUserId: null } }));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await source.worker.runExecution(new AbortController().signal);
    if (!result.claimed || result.jobId === job.id) break;
  }
  const [[imported]] = await source.db.query("SELECT id FROM suppliers WHERE supplier_code = ?", [`RCI-${tag}`]);
  if (imported) source.supplierIds.push(Number(imported.id));
  const finished = (await send(mgmt, "GET /api/v1/supplier-imports/:id", { ids: { id: job.id } })).json.data.job;
  const sourceResult = await send(mgmt, "GET /api/v1/supplier-imports/:id/result", { ids: { id: job.id } });
  check("seed.import_completed", finished.status === "completed" && sourceResult.status === 200 && Boolean(imported),
    { jobStatus: finished.status, resultStatus: sourceResult.status });

  // 最後一筆寫入：transaction marker。
  const marker = `marker-${randomUUID()}`;
  const current = (await send(mgmt, "GET /api/v1/suppliers/:id", { ids })).json.data;
  await expectOk("marker", await send(mgmt, "POST /api/v1/suppliers/:id/update", { ids, body: { version: current.version,
    supplierName: current.supplierName, displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null,
    website: "", generalPhone: "", generalEmail: "", notes: marker } }));
  const markerAt = Date.now();

  // ---- 備份 ----
  const database = process.env.DB_NAME;
  const dumpFile = path.join(work, "backup.sql");
  let started = Date.now();
  const fd = fs.openSync(dumpFile, "w");
  try {
    mysqlClient("mysqldump", ["--set-gtid-purged=OFF", "--hex-blob", "--single-transaction", "--routines", "--triggers", "--events", database],
      { stdoutFile: fd });
  } finally {
    fs.closeSync(fd);
  }
  fs.cpSync(path.join(work, "source-imports"), path.join(work, "backup-files"), { recursive: true });
  metrics.backupMs = Date.now() - started;
  metrics.backupBytes = fs.statSync(dumpFile).size;
  admin = await adminConnection();
  const sourceSums = await tableChecksums(admin, database);
  const sourceFiles = fileManifest(path.join(work, "source-imports"));

  // ---- 還原去獨立 schema ----
  restoreName = scratchName();
  started = Date.now();
  await admin.query(`CREATE DATABASE \`${restoreName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  mysqlClient("mysql", [restoreName], { input: fs.readFileSync(dumpFile, "utf8") });
  fs.cpSync(path.join(work, "backup-files"), path.join(work, "restored-imports"), { recursive: true });
  metrics.restoreMs = Date.now() - started;

  // ---- 對賬 ----
  const restoredSums = await tableChecksums(admin, restoreName);
  const differing = Object.keys({ ...sourceSums, ...restoredSums }).filter((table) => sourceSums[table] !== restoredSums[table]);
  check("reconcile.tables", Object.keys(sourceSums).length > 0 && differing.length === 0,
    { tables: Object.keys(sourceSums).length, differing });
  const supplierTables = Object.keys(sourceSums).filter((table) => table.startsWith("supplier"));
  check("reconcile.supplier_tables_present", supplierTables.length >= 15, { supplierTables: supplierTables.length });
  const restoredFiles = fileManifest(path.join(work, "restored-imports"));
  check("reconcile.files", Object.keys(sourceFiles).length > 0 && JSON.stringify(sourceFiles) === JSON.stringify(restoredFiles),
    { files: Object.keys(sourceFiles).length });
  const [[markerRow]] = await admin.query(`SELECT notes FROM \`${restoreName}\`.suppliers WHERE id = ?`, [supplier.id]);
  check("reconcile.transaction_marker", markerRow?.notes === marker, { markerAt });

  // ---- 喺還原嘅 schema 上面起一個新 app 做 smoke ----
  const { user, password } = adminCredentials();
  restored = createSupplierHarness("rh133r", { database: { database: restoreName, user, password: password ?? "" },
    importRoot: path.join(work, "restored-imports") });
  await restored.start();
  const rsend = (who, key, options) => restored.send(who, restored.route(key), options);
  const detail = await rsend(mgmt, "GET /api/v1/suppliers/:id", { ids });
  check("smoke.detail", detail.status === 200 && detail.json.data.supplierCode === `RCV-${tag}` && detail.json.data.notes === marker);
  const listed = await rsend(bank, "GET /api/v1/suppliers/:id/bank-accounts", { ids });
  const masks = listed.json?.data?.items?.map((item) => item.maskedAccountNumber) ?? [];
  check("smoke.bank_masked", listed.status === 200 && masks.length === 1 && masks[0].endsWith(account.slice(-4)) && !listed.text.includes(account));
  const revealed = await rsend(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal",
    { ids: { id: supplier.id, bankAccountId: bankAccount.id }, body: { reason: REASON } });
  check("smoke.bank_reveal", revealed.status === 200 && revealed.json.data.accountNumber === account, { status: revealed.status });
  const queue = await restored.send(approver, { ...restored.route("GET /api/v1/supplier-approvals"),
    path: "/api/v1/supplier-approvals?scope=all&pageSize=100" });
  check("smoke.approval_pending", queue.status === 200 && queue.json.data.items.some((item) => item.supplierId === pending.id));
  const restoredJob = await rsend(mgmt, "GET /api/v1/supplier-imports/:id", { ids: { id: job.id } });
  const restoredResult = await rsend(mgmt, "GET /api/v1/supplier-imports/:id/result", { ids: { id: job.id } });
  check("smoke.import_job_and_result", restoredJob.status === 200 && restoredJob.json.data.job.status === finished.status
    && restoredResult.status === 200 && restoredResult.text === sourceResult.text, { jobStatus: restoredJob.json?.data?.job?.status });
  const audits = await restored.send(mgmt, { ...restored.route("GET /api/v1/supplier-audit/logs"),
    path: `/api/v1/supplier-audit/logs?supplierId=${supplier.id}` });
  check("smoke.audit_readable", audits.status === 200 && audits.json.data.items.length > 0, { status: audits.status });

  // ---- Key ring：冇正確 key 一定 fail closed；對照組係上面嘅 reveal 真係攞返帳號 ----
  const [[row]] = await restored.db.query("SELECT encryption_key_id FROM supplier_bank_accounts WHERE id = ?", [bankAccount.id]);
  const keyId = row.encryption_key_id;
  for (const [name, encryption] of [["missing", { [`other-${tag}`]: randomBytes(32).toString("base64") }],
    ["wrong", { [keyId]: randomBytes(32).toString("base64") }]]) {
    const service = bankServiceWith(restored.db, { encryption, lookup: { [`look-${tag}`]: randomBytes(32).toString("base64") } });
    let leaked = null;
    let failedClosed = false;
    try {
      leaked = await service.reveal({ actorId: null, claimedRoles: [], claimedPermissions: ["supplier.view", "supplier.bank.view"],
        supplierId: supplier.id, bankAccountId: bankAccount.id, reason: REASON, requestId: `rh133-${name}`, ip: "127.0.0.1" });
    } catch (error) {
      failedClosed = !String(error?.message ?? "").includes(account);
    }
    check(`keyring.${name}_key_fails_closed`, failedClosed && leaked === null);
  }

  localStatus = passed() ? "PASS" : "FAIL";
} catch (error) {
  check("runner.completed", false, errorText(error));
  localStatus = "FAIL";
} finally {
  await restored?.stop().catch((error) => check("cleanup.restored_app", false, errorText(error)));
  if (admin && restoreName) await admin.query(`DROP DATABASE IF EXISTS \`${restoreName}\``).catch((error) => check("cleanup.restore_schema", false, errorText(error)));
  await admin?.end().catch(() => {});
  if (settings && originalApproval !== null) {
    await setApproval(source, settings, originalApproval).catch((error) => check("cleanup.settings", false, errorText(error)));
  }
  await source.stop().catch((error) => check("cleanup.source_fixtures", false, errorText(error)));
  fs.rmSync(work, { recursive: true, force: true });
  if (checks.some(({ id, status }) => id.startsWith("cleanup.") && status === "FAIL")) localStatus = "FAIL";
  console.log(JSON.stringify({ database: process.env.DB_NAME, restoreSchema: restoreName, metrics, checks,
    notRun: { [PRODUCTION]: NOT_RUN_REASON } }, null, 2));
  await writeReport(reportPath, [
    { name: LOCAL, id: "TC-133", status: localStatus },
    { name: PRODUCTION, id: "TC-133", status: "NOT_RUN" }
  ]);
  if (localStatus !== "PASS") process.exitCode = 1;
}

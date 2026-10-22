// 第一個 import：config/jwt.js 冇預設 JWT_SECRET，而 harness 只傳 profile 嘅 env_keys（REV-109 H-1）。
import "../test-support/testEnv.js";
import { execFile, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";
import { createSupplierHarness } from "../test/integration/supplierHttpHarness.js";
import {
  adminConnection, adminCredentials, checklist, errorText, outputPath, scratchName, writeReport
} from "../test/integration/supplierAcceptanceRunner.js";
import { databaseState, runStartupCases, tryStart } from "../test/integration/supplierStartupCases.js";

/**
 * TC-130～132（OPS-003～005）：Supplier resilience（HD-117 A；HD-121 A）。三個 TC 都喺一個全新 migrate 嘅
 * `${DB_NAME}_rh_*` schema 上面做，完咗成個剷走，唔郁共用嘅 DB_NAME。
 *
 * - TC-130 本機：Bank key 唔喺 ring、Business Master 未 ready、app 嘅 DB 連線俾人斷、一行俾人鎖住，各自要明確失敗
 *   或者按設計降級，唔漏 Bank、唔開放非 Active Supplier，恢復之後正常。部署環境網絡層嘅故障係 NOT_RUN。
 * - TC-131 本機：缺 table、column、settings 行、permission、Bank key ring，開機都要拒絕、唔改 DB，修好之後開到機。
 * - TC-132 本機：成功、4xx、409、5xx、審批積壓、import 卡住都留低 log 同指標；integrity 錯誤係 error 級；冇明文。
 *   告警真係送到值班係 NOT_RUN。
 */
const SCRIPT = fileURLToPath(import.meta.url);
const SERVER = fileURLToPath(new URL("../", import.meta.url));
const BANK_ENV = ["SUPPLIER_BANK_ACTIVE_KEY_ID", "SUPPLIER_BANK_ENCRYPTION_KEYS", "SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID", "SUPPLIER_BANK_LOOKUP_KEYS",
  "CUSTOMER_BANK_ACTIVE_KEY_ID", "CUSTOMER_BANK_ENCRYPTION_KEYS", "CUSTOMER_BANK_LOOKUP_ACTIVE_KEY_ID", "CUSTOMER_BANK_LOOKUP_KEYS"];

// 子程序模式：喺冇 Bank key 嘅環境開一次機（config module 喺 import 時讀 env，所以要另一個 process）。
if (process.argv[2] === "--probe-start") {
  const { user, password } = adminCredentials();
  console.log(JSON.stringify(await tryStart({ database: process.argv[3], user, password })));
  process.exit(0);
}

const reportPath = outputPath();
const REASON = "TC-130/132 resilience rehearsal";
const tag = randomUUID().slice(0, 8).toUpperCase();
const NOT_RUN = [
  { id: "TC-130", name: "TC-130 production network faults between the app and its dependencies",
    reason: "Timeouts and resets at the network layer (proxy, load balancer, MySQL failover) need the deployed environment. An in-flight reset of the app's MySQL connection and a lock wait are tested here." },
  { id: "TC-132", name: "TC-132 production alert delivery",
    reason: "Delivering error-level events and alerts to the on-call channel needs the production log pipeline; here the events are read from the log files." }
];
const evidence = {};
const results = {};
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function expectOk(name, response) {
  if (response.status < 200 || response.status > 299) throw new Error(`${name}: ${response.status} ${String(response.text).slice(0, 300)}`);
  return response.json?.data;
}

async function migratedSchema(admin, name) {
  const { user, password } = adminCredentials();
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await promisify(execFile)(process.execPath, [path.join(SERVER, "scripts/migrate.js")], { cwd: SERVER,
    env: { ...process.env, DB_NAME: name, DB_USER: user, DB_PASSWORD: password ?? "", DB_SOCKET_PATH: "", DB_SSL_ENABLED: "false" } });
}

async function startupReadiness(admin, schema) {
  const { checks, check, passed } = checklist();
  evidence["TC-131"] = checks;
  const { user, password } = adminCredentials();
  try {
    check("control.complete_schema_starts", (await tryStart({ database: schema, user, password })).started);
    for (const result of await runStartupCases({ admin, schema, user, password })) {
      check(`refuse.${result.name.replace(/\s+/gu, "_")}`, result.passed,
        { refused: result.refused, unchanged: result.unchanged, startsAfterRestore: result.startsAfterRestore, message: result.message, error: result.error });
    }
    // Bank key ring：要另一個冇 key 嘅 process。修好 = 有 key，即係上面嘅對照組。
    const before = await databaseState(admin, schema);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !BANK_ENV.includes(key)));
    const child = spawnSync(process.execPath, [SCRIPT, "--probe-start", schema], { cwd: SERVER, env, encoding: "utf8", timeout: 120_000 });
    const outcome = JSON.parse(String(child.stdout).trim().split("\n").at(-1) || "{}");
    check("refuse.missing_bank_key_rings", outcome.started === false && /key rings?/u.test(outcome.message ?? "")
      && (await databaseState(admin, schema)) === before, { message: String(outcome.message ?? child.stderr).slice(0, 300) });
    check("control.starts_with_key_rings", (await tryStart({ database: schema, user, password })).started);
    return passed() ? "PASS" : "FAIL";
  } catch (error) {
    check("runner.completed", false, errorText(error));
    return "FAIL";
  }
}

async function purchasableSku(db) {
  const now = Date.now();
  const code = `RSSKU-${tag}`;
  const [item] = await db.execute("INSERT INTO items (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)", [code, now, now]);
  const [sku] = await db.execute(
    "INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
    [item.insertId, code, code, now, now]);
  const [uom] = await db.execute("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, 'Each', ?, ?)", [code, now, now]);
  const [mapping] = await db.execute(
    "INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)",
    [sku.insertId, uom.insertId, now, now]);
  return { skuId: Number(sku.insertId), uomId: Number(mapping.insertId) };
}

/** 一個 Active（有 Bank、有 SKU relation）同一個 Suspended（有 SKU relation）。 */
async function seed(app, users) {
  const send = (who, key, options) => app.send(who, app.route(key), options);
  const { skuId, uomId } = await purchasableSku(app.db);
  const make = async (code) => {
    const created = await expectOk(`create ${code}`, await send(users.mgmt, "POST /api/v1/suppliers/create",
      { body: { supplierCode: code, supplierName: `Resilience ${code}`, defaultCurrencyCode: "HKD", activate: true } }));
    await expectOk(`relation ${code}`, await send(users.mgmt, "POST /api/v1/suppliers/:id/sku-relations/create",
      { ids: { id: created.id }, body: { skuId, purchaseSkuUomId: uomId } }));
    return created;
  };
  const active = await make(`RSA-${tag}`);
  const suspended = await make(`RSS-${tag}`);
  await expectOk("suspend", await send(users.mgmt, "POST /api/v1/suppliers/:id/suspend",
    { ids: { id: suspended.id }, body: { version: (await send(users.mgmt, "GET /api/v1/suppliers/:id", { ids: { id: suspended.id } })).json.data.version, reason: REASON } }));
  const account = `66${randomBytes(6).readUIntBE(0, 6).toString().padStart(12, "0").slice(0, 12)}`;
  const bank = await expectOk("bank", await send(users.bank, "POST /api/v1/suppliers/:id/bank-accounts/create",
    { ids: { id: active.id }, body: { accountHolderName: "Resilience Holder", bankName: "Resilience Bank", accountNumber: account, isDefault: true, reason: REASON } }));
  return { active, suspended, bank, account, skuId };
}

async function dependencyFailures(app, users, fixture, admin, schema) {
  const { checks, check, passed } = checklist();
  evidence["TC-130"] = checks;
  const send = (who, key, options) => app.send(who, app.route(key), options);
  const { active, suspended, bank, account, skuId } = fixture;
  const lookup = async () => {
    const response = await app.send(users.view, { ...app.route("GET /api/v1/supplier-lookups/for-sku/:skuId"), path: `/api/v1/supplier-lookups/for-sku/${skuId}` });
    const ids = response.json?.data?.items?.map((item) => item.supplierId) ?? [];
    return { ok: response.status === 200 && JSON.stringify(ids) === JSON.stringify([active.id]) && !/bank|account/iu.test(response.text), status: response.status, ids };
  };
  const reveal = () => send(users.bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal",
    { ids: { id: active.id, bankAccountId: bank.id }, body: { reason: REASON } });
  const q = (sql, params) => admin.query(sql.replaceAll("$$", `\`${schema}\``), params);
  try {
    // 1. Bank key 唔喺 ring：reveal 明確 503，其他照用，唔漏帳號。
    const [[row]] = await q("SELECT encryption_key_id AS id FROM $$.supplier_bank_accounts WHERE id = ?", [bank.id]);
    await q("UPDATE $$.supplier_bank_accounts SET encryption_key_id = ? WHERE id = ?", [`gone-${tag}`, bank.id]);
    const refused = await reveal();
    const detail = await send(users.bank, "GET /api/v1/suppliers/:id", { ids: { id: active.id } });
    const masked = await send(users.bank, "GET /api/v1/suppliers/:id/bank-accounts", { ids: { id: active.id } });
    check("bank_unavailable.reveal_fails_explicitly", refused.status === 503 && refused.code === "BANK_KEY_UNAVAILABLE" && !refused.text.includes(account),
      { status: refused.status, code: refused.code });
    check("bank_unavailable.rest_still_works", detail.status === 200 && masked.status === 200 && !detail.text.includes(account) && !masked.text.includes(account),
      { detail: detail.status, masked: masked.status });
    check("bank_unavailable.lookup_active_only_no_bank", (await lookup()).ok);
    await q("UPDATE $$.supplier_bank_accounts SET encryption_key_id = ? WHERE id = ?", [row.id, bank.id]);
    const recovered = await reveal();
    check("bank_unavailable.recovers", recovered.status === 200 && recovered.json.data.accountNumber === account);

    // 2. 預設貨幣停用（業務規則拒絕，唔係 BUSINESS_MASTER_NOT_READY 嗰條依賴路徑，REV-110 L-4）：新增明確失敗，讀取同 lookup 照用。
    await q("UPDATE $$.currencies SET status = 'INACTIVE' WHERE code = 'HKD'");
    const blocked = await send(users.mgmt, "POST /api/v1/suppliers/create",
      { body: { supplierCode: `RSB-${tag}`, supplierName: `Resilience blocked ${tag}`, defaultCurrencyCode: "HKD" } });
    const list = await send(users.view, "GET /api/v1/suppliers");
    check("currency_inactive.create_fails_explicitly", blocked.status >= 400 && blocked.status < 600 && blocked.status !== 500 && Boolean(blocked.code),
      { status: blocked.status, code: blocked.code });
    check("currency_inactive.reads_still_work", list.status === 200 && (await lookup()).ok, { list: list.status });
    await q("UPDATE $$.currencies SET status = 'ACTIVE' WHERE code = 'HKD'");
    const created = await send(users.mgmt, "POST /api/v1/suppliers/create",
      { body: { supplierCode: `RSB-${tag}`, supplierName: `Resilience recovered ${tag}`, defaultCurrencyCode: "HKD" } });
    check("currency_inactive.recovers", created.status >= 200 && created.status < 300, { status: created.status });

    // 3. Request 做緊嘅時候條 DB 連線俾人斷（REV-110 M-1）：鎖住 suppliers，等 app 嘅 thread 喺 metadata lock 度等，
    //    KILL 佢。回應要係乾淨嘅錯誤（有 code、冇帳號），條 thread 真係冇咗，之後自己恢復。
    const tableHolder = await adminConnection(schema);
    let victim = null;
    let reset = null;
    try {
      await tableHolder.query("LOCK TABLES suppliers WRITE");
      const inFlight = send(users.view, "GET /api/v1/suppliers");
      for (let attempt = 0; attempt < 100 && victim === null; attempt += 1) {
        const [waiting] = await q("SELECT id FROM information_schema.processlist WHERE db = ? AND state = 'Waiting for table metadata lock'", [schema]);
        victim = waiting[0]?.id ?? null;
        if (victim === null) await sleep(100);
      }
      if (victim !== null) await q(`KILL CONNECTION ${Number(victim)}`);
      reset = await inFlight;
    } finally {
      await tableHolder.query("UNLOCK TABLES").catch(() => {});
      await tableHolder.end().catch(() => {});
    }
    const [[gone]] = await q("SELECT COUNT(*) AS n FROM information_schema.processlist WHERE id = ?", [victim ?? 0]);
    check("connection_reset.in_flight_request_fails_cleanly", victim !== null && Number(gone.n) === 0 && reset.status >= 500
      && Boolean(reset.json?.error?.code) && !reset.text.includes(account), { killed: victim, status: reset?.status, code: reset?.code });
    const after = [];
    for (let attempt = 0; attempt < 3; attempt += 1) after.push((await send(users.view, "GET /api/v1/suppliers")).status);
    check("connection_reset.recovers", after.every((status) => status === 200), { statuses: after });
    check("connection_reset.lookup_active_only", (await lookup()).ok);

    // 4. 一行俾人鎖住：狀態變更要明確失敗（唔係靜靜雞遲啲先寫），lookup 照答；放鎖之後正常。
    const holder = await adminConnection(schema);
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM suppliers WHERE id = ? FOR UPDATE", [active.id]);
      const version = (await send(users.mgmt, "GET /api/v1/suppliers/:id", { ids: { id: active.id } })).json.data.version;
      const started = Date.now();
      const pending = send(users.mgmt, "POST /api/v1/suppliers/:id/suspend", { ids: { id: active.id }, body: { version, reason: REASON } });
      const during = await lookup();
      const locked = await pending;
      evidence.lockWaitMs = Date.now() - started;
      await holder.rollback();
      // App 放棄咗嘅 thread 可能仲喺度：等佢走晒先睇有冇遲咗先寫（REV-110 L-3）。
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [busy] = await q("SELECT id FROM information_schema.processlist WHERE db = ? AND command <> 'Sleep' AND id <> CONNECTION_ID()", [schema]);
        if (busy.length === 0) break;
        await sleep(100);
      }
      const [[state]] = await q("SELECT status FROM $$.suppliers WHERE id = ?", [active.id]);
      const timeoutMs = app.application.services.config.database.transactionTimeoutMs;
      check("lock_timeout.fails_explicitly_after_the_transaction_timeout", locked.status >= 500 && Boolean(locked.code)
        && evidence.lockWaitMs >= timeoutMs - 1_000 && state.status === "active",
        { status: locked.status, code: locked.code, statusAfterRelease: state.status, waitedMs: evidence.lockWaitMs });
      check("lock_timeout.lookup_answers_meanwhile", during.ok, during);
    } finally {
      await holder.end().catch(() => {});
    }
    const latest = (await send(users.mgmt, "GET /api/v1/suppliers/:id", { ids: { id: active.id } })).json.data;
    const retried = await send(users.mgmt, "POST /api/v1/suppliers/:id/suspend", { ids: { id: active.id }, body: { version: latest.version, reason: REASON } });
    check("lock_timeout.recovers", retried.status === 200 && retried.json.data.status === "suspended", { status: retried.status });
    check("never_opens_suspended", !(await lookup()).ids.includes(suspended.id));
    return passed() ? "PASS" : "FAIL";
  } catch (error) {
    check("runner.completed", false, errorText(error));
    return "FAIL";
  }
}

const readLines = (directory) => (fs.existsSync(directory) ? fs.readdirSync(directory, { recursive: true }).map(String)
  .filter((name) => fs.statSync(path.join(directory, name)).isFile())
  .flatMap((name) => fs.readFileSync(path.join(directory, name), "utf8").split("\n").filter(Boolean)) : []);
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };

async function observability(app, users, fixture, admin, schema) {
  const { checks, check, passed } = checklist();
  evidence["TC-132"] = checks;
  const send = (who, key, options) => app.send(who, app.route(key), options);
  const q = (sql, params) => admin.query(sql.replaceAll("$$", `\`${schema}\``), params);
  const { bank, account } = fixture;
  try {
    const requests = {};
    const record = (name, response) => { requests[name] = { requestId: response.json?.meta?.requestId, status: response.status }; return response; };
    record("success", await send(users.view, "GET /api/v1/suppliers"));
    record("not_found", await send(users.view, "GET /api/v1/suppliers/:id", { ids: { id: 999_999_999 } }));
    const current = (await send(users.mgmt, "GET /api/v1/suppliers/:id", { ids: { id: fixture.suspended.id } })).json.data;
    record("conflict", await send(users.mgmt, "POST /api/v1/suppliers/:id/update", { ids: { id: current.id }, body: { version: current.version + 7,
      supplierName: current.supplierName, displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, website: "", generalPhone: "",
      generalEmail: "", notes: "" } }));
    // 5xx：認證標籤壞咗 = integrity 失敗，要 error 級。
    const [[tagRow]] = await q("SELECT account_auth_tag AS tag FROM $$.supplier_bank_accounts WHERE id = ?", [bank.id]);
    await q("UPDATE $$.supplier_bank_accounts SET account_auth_tag = ? WHERE id = ?", [randomBytes(tagRow.tag.length), bank.id]);
    record("integrity", await send(users.bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal",
      { ids: { id: fixture.active.id, bankAccountId: bank.id }, body: { reason: REASON } }));
    await q("UPDATE $$.supplier_bank_accounts SET account_auth_tag = ? WHERE id = ?", [tagRow.tag, bank.id]);
    check("statuses", JSON.stringify(Object.values(requests).map(({ status }) => status)) === JSON.stringify([200, 404, 409, 500]),
      Object.fromEntries(Object.entries(requests).map(([name, { status }]) => [name, status])));

    // 審批積壓同 import 卡住，再叫 metrics job 報一次。
    const settings = (await send(users.settings, "GET /api/v1/supplier-settings")).json.data;
    await expectOk("settings on", await send(users.settings, "POST /api/v1/supplier-settings/update",
      { body: { requireActivationApproval: true, version: settings.version, reason: `${REASON} on` } }));
    const submitted = await expectOk("submit", await send(users.mgmt, "POST /api/v1/suppliers/create", { body: { supplierCode: `RSP-${tag}`,
      supplierName: `Resilience pending ${tag}`, defaultCurrencyCode: "HKD", activate: true, approverUserId: users.approver.userId } }));
    await q("UPDATE $$.supplier_activation_requests SET requested_at = ? WHERE supplier_id = ?", [Date.now() - 25 * 3_600_000, submitted.id]);
    const now = (await send(users.settings, "GET /api/v1/supplier-settings")).json.data;
    await expectOk("settings off", await send(users.settings, "POST /api/v1/supplier-settings/update",
      { body: { requireActivationApproval: false, version: now.version, reason: `${REASON} off` } }));
    // 卡住嘅 import：真流程上載、預檢、確認，再俾一個「死咗」嘅 worker 領咗，lease 已過期 20 分鐘。
    const csv = `${SUPPLIER_IMPORT_COLUMN_NAMES.join(",")}\n${SUPPLIER_IMPORT_COLUMN_NAMES.map((name) =>
      ({ supplierCode: `RSI-${tag}`, supplierName: `Resilience import ${tag}`, defaultCurrencyCode: "HKD" })[name] ?? "").join(",")}\n`;
    const form = new FormData();
    form.append("mode", "create_only");
    form.append("file", new Blob([csv], { type: "text/csv" }), "stalled.csv");
    const uploaded = await fetch(`${app.url}/api/v1/supplier-imports/upload`, { method: "POST", body: form,
      headers: { authorization: `Bearer ${users.mgmt.token}`, "idempotency-key": randomUUID() } }).then((response) => response.json());
    const jobId = uploaded.data.id;
    app.jobIds.push(jobId);
    await app.worker.runPrecheck(new AbortController().signal);
    const ready = (await send(users.mgmt, "GET /api/v1/supplier-imports/:id", { ids: { id: jobId } })).json.data.job;
    await expectOk("confirm", await send(users.mgmt, "POST /api/v1/supplier-imports/:id/confirm",
      { ids: { id: jobId }, body: { version: ready.version, activationMode: "draft", approverUserId: null } }));
    await app.worker.importService.claimForExecution({ leaseOwner: `gone-${tag}`, leaseDurationMs: 60_000 });
    await q("UPDATE $$.supplier_import_jobs SET lease_until = ?, updated_at = ? WHERE id = ?", [Date.now() - 20 * 60_000, Date.now() - 20 * 60_000, jobId]);
    const metrics = await app.application.services.require("job.supplierMetrics").report();
    check("metrics.values", metrics.approvals.pending >= 1 && metrics.approvals.oldestAgeMs > 24 * 3_600_000 && metrics.imports.stalled >= 1, metrics);

    // Log 係非同步寫：等佢出現。
    let system = [];
    let request = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      system = readLines(path.join(app.logRoot, "system")).map(parse).filter(Boolean);
      request = readLines(path.join(app.logRoot, "requests")).map(parse).filter(Boolean);
      if (["supplier.metrics", "supplier.alert.approval_overdue", "supplier.alert.import_stalled", "supplier.bank.integrity_failed"]
        .every((event) => system.some((line) => JSON.stringify(line).includes(`"${event}"`)))) break;
      await new Promise((resolve) => { setTimeout(resolve, 200); });
    }
    const event = (name) => system.find((line) => JSON.stringify(line).includes(`"${name}"`));
    check("log.metrics_and_alerts", Boolean(event("supplier.metrics") && event("supplier.alert.approval_overdue") && event("supplier.alert.import_stalled")),
      { found: ["supplier.metrics", "supplier.alert.approval_overdue", "supplier.alert.import_stalled"].map((name) => Boolean(event(name))) });
    const keyError = event("supplier.bank.key_unavailable");
    check("log.key_unavailable_is_error_level", keyError?.level === "error", { level: keyError?.level ?? null });
    const integrity = event("supplier.bank.integrity_failed");
    check("log.integrity_is_error_level", /error/iu.test(String(integrity?.level ?? integrity?.severity ?? "")), { line: integrity ? Object.keys(integrity) : null,
      level: integrity?.level ?? integrity?.severity ?? null });
    const perRequest = Object.fromEntries(Object.entries(requests).map(([name, { requestId, status }]) => {
      const line = request.find((entry) => JSON.stringify(entry).includes(requestId));
      const text = JSON.stringify(line ?? {});
      return [name, Boolean(line) && text.includes(String(status)) && /durationMs|duration/u.test(text) && /\/api\/v1\/supplier/u.test(text)];
    }));
    check("log.request_route_status_duration", Object.values(perRequest).every(Boolean), perRequest);
    const everything = [...readLines(path.join(app.logRoot, "system")), ...readLines(path.join(app.logRoot, "requests"))].join("\n");
    check("log.low_sensitivity", everything.length > 0 && !everything.includes(account) && !everything.includes("Supplier-T51-Password!"));
    return passed() ? "PASS" : "FAIL";
  } catch (error) {
    check("runner.completed", false, errorText(error));
    return "FAIL";
  }
}

const admin = await adminConnection();
const schema = scratchName();
let app = null;
let cleaned = null;
// 一次過清：正常完、出錯、或者俾人 SIGINT／SIGTERM 都行（REV-110 L-5）。
const cleanup = () => (cleaned ??= (async () => {
  await app?.stop().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch((error) => { evidence.cleanup = errorText(error); });
  await admin.end().catch(() => {});
})());
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
}
try {
  await migratedSchema(admin, schema);
  results["TC-131"] = await startupReadiness(admin, schema);
  const { user, password } = adminCredentials();
  app = createSupplierHarness("rh130", { database: { database: schema, user, password: password ?? "" } });
  await app.start();
  const users = {
    mgmt: await app.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]),
    view: await app.makeUser("view", ["supplier.view"]),
    bank: await app.makeUser("bank", ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]),
    approver: await app.makeUser("apr", ["supplier.view", "supplier.approval"]),
    settings: await app.makeUser("set", ["supplier.settings"])
  };
  const fixture = await seed(app, users);
  results["TC-130"] = await dependencyFailures(app, users, fixture, admin, schema);
  results["TC-132"] = await observability(app, users, fixture, admin, schema);
} catch (error) {
  console.error(`Supplier resilience acceptance failed: ${errorText(error)}`);
  evidence.setup = errorText(error);
} finally {
  await cleanup();
}
const tests = [
  { name: "TC-130 local dependency failures: Bank key, inactive currency, in-flight connection reset, lock wait", id: "TC-130", status: results["TC-130"] ?? "FAIL" },
  { name: "TC-131 local startup refuses a missing table, column, settings row, permission or key ring", id: "TC-131", status: results["TC-131"] ?? "FAIL" },
  { name: "TC-132 local logs and metrics for success, 4xx, conflict, 5xx, approval backlog and stalled import", id: "TC-132", status: results["TC-132"] ?? "FAIL" },
  ...NOT_RUN.map(({ id, name }) => ({ name, id, status: "NOT_RUN" }))
];
console.log(JSON.stringify({ database: process.env.DB_NAME, schema, evidence,
  notRun: Object.fromEntries(NOT_RUN.map(({ name, reason }) => [name, reason])) }, null, 2));
await writeReport(reportPath, tests);
if (tests.some((test) => test.status === "FAIL") || evidence.cleanup) process.exitCode = 1;

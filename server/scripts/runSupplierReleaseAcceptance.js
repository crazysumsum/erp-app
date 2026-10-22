// 第一個 import：config/jwt.js 冇預設 JWT_SECRET，而 harness 只傳 profile 嘅 env_keys（REV-109 H-1）。
import "../test-support/testEnv.js";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { stringify } from "csv-stringify/sync";

import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";
import { createSupplierHarness } from "../test/integration/supplierHttpHarness.js";
import {
  adminConnection, adminCredentials, checklist, errorText, outputPath, schemaObjects, scratchName, tableChecksums, writeReport
} from "../test/integration/supplierAcceptanceRunner.js";

/**
 * TC-134～136（OPS-007～009）：Supplier release operations（HD-119 A）。
 *
 * - TC-134 本機：真 import worker、真 MySQL。停 claim 之後唔再領 job；一個 worker 做咗一列就「死咗」，新起嘅 app
 *   （即係 restart）喺 lease 仲有效時唔搶，lease 過期先接手，做完餘下嘅列，已經做咗嗰列唔重做；完成咗嘅 job 唔再做。
 * - TC-135 本機：一個全新 schema 由 migration 跑起（部署順序 §14.1 第 2 步），重跑係 no-op；六個 permission、
 *   system-admin、settings 預設 OFF、有 active 貨幣；新 app 註冊嘅每條 Supplier route 都受 supplier.* 權限保護；
 *   分開嘅日常角色行 §14.1 第 7 步嘅 smoke 同 §14.4 嘅核對（Draft、直接啟用、審批、暫停、封鎖、masked Bank、
 *   reveal、purchase lookup、audit）。
 * - Production 先做到嘅部分（真部署時間線、按 §14 逐步部署、break-glass 帳號）同成個 TC-136 都係 NOT_RUN。
 */
const reportPath = outputPath();
const SERVER = fileURLToPath(new URL("../", import.meta.url));
const REASON = "TC-134/135 release rehearsal";
const tag = randomUUID().slice(0, 8).toUpperCase();
const NOT_RUN = [
  { id: "TC-134", name: "TC-134 production worker rollback and restart timeline",
    reason: "Needs a deployed server, its process manager and the runbook timeline. Here the restart is a second app in the same process and lease expiry is set in the database; that client rollback leaves data in place is not shown here." },
  { id: "TC-135", name: "TC-135 production staged capability deployment and break-glass accounts",
    reason: "Needs the real environment: deploying capabilities in §14 order, and showing that only approved break-glass accounts hold system-admin, with their use audited. The client menu inventory is covered by the supplier-client-ui suite (TC-121)." },
  { id: "TC-136", name: "TC-136 release regression and evidence gate",
    reason: "The release gate is the harness verify_gate over the candidate's CI and suite evidence, the open P0/P1 cases and defects, and the Product Owner's GO; a runner cannot decide it." }
];
const results = {};
const evidence = {};

async function expectOk(name, response) {
  if (response.status < 200 || response.status > 299) throw new Error(`${name}: ${response.status} ${String(response.text).slice(0, 300)}`);
  return response.json?.data;
}

async function uploadImport(h, user, codes, mode) {
  const rows = codes.map((code) => SUPPLIER_IMPORT_COLUMN_NAMES.map((name) =>
    ({ supplierCode: code, supplierName: `Imported ${code}`, defaultCurrencyCode: "HKD" })[name] ?? ""));
  const form = new FormData();
  form.append("mode", mode);
  form.append("file", new Blob([stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...rows], SUPPLIER_CSV_STRINGIFY_OPTIONS)], { type: "text/csv" }), "release.csv");
  const response = await fetch(`${h.url}/api/v1/supplier-imports/upload`, { method: "POST", body: form,
    headers: { authorization: `Bearer ${user.token}`, "idempotency-key": randomUUID() } });
  const json = await response.json();
  if (response.status !== 201) throw new Error(`import upload: ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
  h.jobIds.push(json.data.id);
  return json.data;
}

async function workerRollback() {
  const { checks, check, passed } = checklist();
  evidence["TC-134"] = checks;
  const first = createSupplierHarness("rh134a");
  const second = createSupplierHarness("rh134b");
  try {
    await first.start();
    const [[busy]] = await first.db.query(
      "SELECT COUNT(*) AS n FROM supplier_import_jobs WHERE status IN ('uploaded', 'validating', 'queued', 'running')");
    if (!check("precondition.no_other_open_jobs", Number(busy.n) === 0, { open: Number(busy.n) })) return "FAIL";
    const mgmt = await first.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
    // 第一列更新一個現有 Supplier，另外兩列新增：重做一列新增會撞 Code 唯一，但重做一列更新可以靜靜雞再寫一次（REV-109 L-3）。
    const codes = [0, 2, 3].map((n) => `RLS-${tag}-${n}`);
    const existing = await expectOk("existing", await first.send(mgmt, first.route("POST /api/v1/suppliers/create"),
      { body: { supplierCode: codes[0], supplierName: `Existing ${codes[0]}`, defaultCurrencyCode: "HKD" } }));
    const job = await uploadImport(first, mgmt, codes, "upsert");
    await first.worker.runPrecheck(new AbortController().signal);
    const ready = (await first.send(mgmt, first.route("GET /api/v1/supplier-imports/:id"), { ids: { id: job.id } })).json.data.job;
    await expectOk("confirm", await first.send(mgmt, first.route("POST /api/v1/supplier-imports/:id/confirm"),
      { ids: { id: job.id }, body: { version: ready.version, activationMode: "draft", approverUserId: null } }));
    const status = async () => (await first.db.query("SELECT status, lease_owner FROM supplier_import_jobs WHERE id = ?", [job.id]))[0][0];

    // 停 claim：shutdown 之後唔再領新 job。
    await first.worker.shutdown();
    const stopped = await first.worker.runExecution(new AbortController().signal);
    check("stop_claim.no_new_claim", stopped.claimed === false && (await status()).status === "queued");

    // 做咗一列就死咗：lease 仲喺佢手。
    const crashed = `crashed-${tag}`;
    const importer = first.worker.importService;
    const claimed = await importer.claimForExecution({ leaseOwner: crashed, leaseDurationMs: 600_000 });
    const one = await importer.processNextRow({ jobId: job.id, leaseOwner: crashed, leaseDurationMs: 600_000, applyRow: first.worker.applyRow });
    check("crash.one_row_applied", claimed?.id === job.id && one?.status === "applied" && (await status()).lease_owner === crashed);

    // Restart：新 app、新 worker。Lease 有效時唔搶；過期先接手，做完餘下兩列。
    await second.start();
    const early = await second.worker.runExecution(new AbortController().signal);
    check("restart.respects_live_lease", early.claimed === false && (await status()).lease_owner === crashed);
    await first.db.execute("UPDATE supplier_import_jobs SET lease_until = ? WHERE id = ?", [Date.now() - 1, job.id]);
    const resumed = await second.worker.runExecution(new AbortController().signal);
    check("restart.takes_over_after_expiry", resumed.claimed === true && resumed.jobId === job.id && resumed.status === "completed"
      && resumed.applied === 2, resumed);
    const [suppliers] = await first.db.query("SELECT id, supplier_code FROM suppliers WHERE supplier_code IN (?, ?, ?)", codes);
    const [rows] = await first.db.query("SELECT status FROM supplier_import_rows WHERE job_id = ? ORDER BY `row_number`", [job.id]);
    const [[updates]] = await first.db.query(
      "SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE action = 'supplier.update' AND supplier_id = ?", [existing.id]);
    const [[updated]] = await first.db.query("SELECT version, supplier_name FROM suppliers WHERE id = ?", [existing.id]);
    check("restart.no_redo", suppliers.length === 3 && rows.every((row) => row.status === "applied") && Number(updates.n) === 1
      && Number(updated.version) === Number(existing.version) + 1 && updated.supplier_name === `Imported ${codes[0]}`,
    { suppliers: suppliers.length, rows: rows.map((row) => row.status), updates: Number(updates.n),
      versionBefore: Number(existing.version), versionAfter: Number(updated.version) });

    // 完成咗嘅 job 唔會再做。
    const before = await tableChecksums(first.db, process.env.DB_NAME);
    const again = await second.worker.runExecution(new AbortController().signal);
    const after = await tableChecksums(first.db, process.env.DB_NAME);
    const changed = Object.keys(before).filter((table) => table.startsWith("supplier") && before[table] !== after[table]);
    check("completed.not_redone", again.claimed === false && changed.length === 0, { changed });
    return passed() ? "PASS" : "FAIL";
  } catch (error) {
    check("runner.completed", false, errorText(error));
    return "FAIL";
  } finally {
    // 中途失敗都要清：import 建立嘅 Supplier 由今次嘅 tag 搵返，唔靠上面有冇行到登記嗰步。
    if (first.db) {
      const [made] = await first.db.query("SELECT id FROM suppliers WHERE supplier_code LIKE ?", [`RLS-${tag}-%`]).catch(() => [[]]);
      first.supplierIds.push(...made.map((row) => Number(row.id)));
    }
    await second.stop().catch((error) => check("cleanup.second", false, errorText(error)));
    await first.stop().catch((error) => check("cleanup.first", false, errorText(error)));
  }
}

async function purchasableSku(h) {
  const now = Date.now();
  const code = `RLSKU-${tag}`;
  const [item] = await h.db.execute("INSERT INTO items (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)", [code, now, now]);
  const [sku] = await h.db.execute(
    "INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
    [item.insertId, code, code, now, now]);
  const [uom] = await h.db.execute("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, 'Each', ?, ?)", [code, now, now]);
  const [mapping] = await h.db.execute(
    "INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)",
    [sku.insertId, uom.insertId, now, now]);
  return { skuId: Number(sku.insertId), uomId: Number(mapping.insertId) };
}

async function capabilityDeployment() {
  const { checks, check, passed } = checklist();
  evidence["TC-135"] = checks;
  const fresh = scratchName();
  const admin = await adminConnection();
  const { user, password } = adminCredentials();
  const app = createSupplierHarness("rh135", { database: { database: fresh, user, password: password ?? "" } });
  try {
    // §14.1 第 2 步：一個空 schema 由 migration 跑起；再跑一次係 no-op。
    await admin.query(`CREATE DATABASE \`${fresh}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    const env = { ...process.env, DB_NAME: fresh, DB_USER: user, DB_PASSWORD: password ?? "", DB_SOCKET_PATH: "", DB_SSL_ENABLED: "false" };
    const migrate = () => promisify(execFile)(process.execPath, [path.join(SERVER, "scripts/migrate.js")], { cwd: SERVER, env });
    await migrate();
    const count = async () => Number((await admin.query(`SELECT COUNT(*) AS n FROM \`${fresh}\`.fr_schema_migrations`))[0][0].n);
    const applied = await count();
    await migrate();
    check("deploy.migrations_rerun_is_noop", applied > 0 && (await count()) === applied, { applied });
    // 每個 migration 檔都入咗 ledger（§14.4「Migration count」）；schema 嘅 digest 記低做證據，未有 release baseline 可以比。
    const files = fs.readdirSync(path.join(SERVER, "database/migrations")).filter((name) => /\.(js|sql)$/u.test(name)).map((name) => `migrations/${name}`);
    const [ledger] = await admin.query(`SELECT name FROM \`${fresh}\`.fr_schema_migrations`);
    const recorded = new Set(ledger.map((row) => row.name));
    check("deploy.every_migration_applied", files.length > 0 && files.every((name) => recorded.has(name)),
      { files: files.length, missing: files.filter((name) => !recorded.has(name)) });
    const objects = await schemaObjects(admin, fresh);
    evidence.schemaDigest = createHash("sha256").update(JSON.stringify(Object.entries(objects).sort())).digest("hex");

    // §14.4 核對。
    const [permissions] = await admin.query(`SELECT name FROM \`${fresh}\`.permissions WHERE name LIKE 'supplier.%' ORDER BY name`);
    const six = ["supplier.approval", "supplier.bank.mgmt", "supplier.bank.view", "supplier.mgmt", "supplier.settings", "supplier.view"];
    check("deploy.six_permissions_no_extra", JSON.stringify(permissions.map((row) => row.name)) === JSON.stringify(six),
      { permissions: permissions.map((row) => row.name) });
    const [[admins]] = await admin.query(`SELECT COUNT(*) AS n FROM \`${fresh}\`.role_permissions rp JOIN \`${fresh}\`.roles r ON r.id = rp.role_id
      JOIN \`${fresh}\`.permissions p ON p.id = rp.permission_id WHERE r.name = 'system-admin' AND p.name LIKE 'supplier.%'`);
    check("deploy.system_admin_holds_six", Number(admins.n) === 6, { granted: Number(admins.n) });
    const [settingsRows] = await admin.query(`SELECT id, require_activation_approval FROM \`${fresh}\`.supplier_settings`);
    check("deploy.settings_singleton_approval_off", settingsRows.length === 1 && Number(settingsRows[0].id) === 1
      && Number(settingsRows[0].require_activation_approval) === 0);
    const [[currencies]] = await admin.query(`SELECT COUNT(*) AS n FROM \`${fresh}\`.currencies WHERE status = 'ACTIVE'`);
    check("deploy.active_currency", Number(currencies.n) >= 1, { active: Number(currencies.n) });

    // §14.1 第 4 步：server 喺新 schema 上面起得到，每條 Supplier route 都受 supplier.* 權限保護。
    await app.start();
    const unguarded = app.routes.filter((route) => route.authType === "public" || route.policies.length === 0
      || !route.policies.every((policy) => policy.name === "hasPermission" && policy.options.permissions.length > 0
        && policy.options.permissions.every((name) => six.includes(name))));
    check("server.routes_guarded", app.routes.length > 0 && unguarded.length === 0,
      { routes: app.routes.length, unguarded: unguarded.map((route) => route.key) });

    // §14.1 第 6、7 步：分開嘅日常角色行 smoke。
    const mgmt = await app.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
    const approver = await app.makeUser("apr", ["supplier.view", "supplier.approval"]);
    const bankRead = await app.makeUser("bankr", ["supplier.view", "supplier.bank.view"]);
    const bankWrite = await app.makeUser("bankw", ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]);
    const settings = await app.makeUser("set", ["supplier.settings"]);
    const outsider = await app.makeUser("none", []);
    const send = (who, key, options) => app.send(who, app.route(key), options);
    const requestIds = {};
    const step = async (name, who, key, options) => {
      const response = await send(who, key, options);
      const data = await expectOk(name, response);
      requestIds[name] = response.json?.meta?.requestId;
      return data;
    };

    check("roles.outsider_refused", (await send(outsider, "GET /api/v1/suppliers")).status === 403);
    const draft = await step("create", mgmt, "POST /api/v1/suppliers/create",
      { body: { supplierCode: `RLA-${tag}`, supplierName: `Release A ${tag}`, defaultCurrencyCode: "HKD" } });
    check("smoke.draft_created", draft.status === "draft");
    const active = await step("activate", mgmt, "POST /api/v1/suppliers/:id/activate", { ids: { id: draft.id }, body: { version: draft.version } });
    check("smoke.direct_activation", active.status === "active");

    const current = await step("settings read", settings, "GET /api/v1/supplier-settings");
    await step("settings on", settings, "POST /api/v1/supplier-settings/update",
      { body: { requireActivationApproval: true, version: current.version, reason: `${REASON} on` } });
    const submitted = await step("approval submit", mgmt, "POST /api/v1/suppliers/create", { body: { supplierCode: `RLB-${tag}`,
      supplierName: `Release B ${tag}`, defaultCurrencyCode: "HKD", activate: true, approverUserId: approver.userId } });
    const queue = await app.send(approver, { ...app.route("GET /api/v1/supplier-approvals"), path: "/api/v1/supplier-approvals?scope=all&pageSize=100" });
    const request = queue.json.data.items.find((item) => item.supplierId === submitted.id);
    await step("approval approve", approver, "POST /api/v1/supplier-approvals/:id/approve", { ids: { id: request.id }, body: { version: request.version } });
    const approved = await step("approved read", mgmt, "GET /api/v1/suppliers/:id", { ids: { id: submitted.id } });
    check("smoke.approval_flow", submitted.status === "pending_approval" && approved.status === "active", { submitted: submitted.status });
    const now = await step("settings read 2", settings, "GET /api/v1/supplier-settings");
    await step("settings off", settings, "POST /api/v1/supplier-settings/update",
      { body: { requireActivationApproval: false, version: now.version, reason: `${REASON} off` } });
    const third = await step("create third", mgmt, "POST /api/v1/suppliers/create",
      { body: { supplierCode: `RLC-${tag}`, supplierName: `Release C ${tag}`, defaultCurrencyCode: "HKD", activate: true } });

    // Purchase lookup：三個都有 SKU relation，暫停同封鎖之後即刻消失，history 仲睇得到。
    const { skuId, uomId } = await purchasableSku(app);
    for (const supplier of [active, approved, third]) {
      await step(`relation ${supplier.supplierCode}`, mgmt, "POST /api/v1/suppliers/:id/sku-relations/create",
        { ids: { id: supplier.id }, body: { skuId, purchaseSkuUomId: uomId } });
    }
    const latest = async (id) => (await send(mgmt, "GET /api/v1/suppliers/:id", { ids: { id } })).json.data;
    await step("suspend", mgmt, "POST /api/v1/suppliers/:id/suspend",
      { ids: { id: active.id }, body: { version: (await latest(active.id)).version, reason: REASON } });
    await step("block", approver, "POST /api/v1/suppliers/:id/block",
      { ids: { id: approved.id }, body: { version: (await latest(approved.id)).version, reason: REASON } });
    const lookup = await app.send(mgmt, { ...app.route("GET /api/v1/supplier-lookups/for-sku/:skuId"),
      path: `/api/v1/supplier-lookups/for-sku/${skuId}` });
    const visible = lookup.json?.data?.items?.map((item) => item.supplierId) ?? [];
    check("smoke.lookup_hides_suspended_and_blocked", lookup.status === 200 && JSON.stringify(visible) === JSON.stringify([third.id]), { visible });
    check("smoke.history_still_visible", (await latest(active.id)).status === "suspended" && (await latest(approved.id)).status === "blocked");

    // Bank：讀同寫分開；DB 同 audit 冇明文；有授權 reveal 攞返帳號。
    const account = `65${String(Date.now()).slice(-12)}`;
    const bankBody = { accountHolderName: "Release Holder", bankName: "Release Bank", accountNumber: account, isDefault: true, reason: REASON };
    check("roles.bank_reader_cannot_write",
      (await send(bankRead, "POST /api/v1/suppliers/:id/bank-accounts/create", { ids: { id: third.id }, body: bankBody })).status === 403);
    const created = await step("bank create", bankWrite, "POST /api/v1/suppliers/:id/bank-accounts/create", { ids: { id: third.id }, body: bankBody });
    const listed = await send(bankRead, "GET /api/v1/suppliers/:id/bank-accounts", { ids: { id: third.id } });
    check("smoke.bank_masked", listed.status === 200 && listed.json.data.items[0]?.maskedAccountNumber.endsWith(account.slice(-4))
      && !listed.text.includes(account));
    const [stored] = await app.db.query("SELECT * FROM supplier_bank_accounts WHERE id = ?", [created.id]);
    const [audited] = await app.db.query("SELECT CAST(detail AS CHAR) AS detail FROM supplier_audit_logs WHERE supplier_id = ?", [third.id]);
    // VARBINARY 欄係 Buffer：JSON.stringify 會變成數字陣列，要逐欄喺 bytes 入面搵（REV-109 M-1）。
    const holds = (value) => (Buffer.isBuffer(value) ? value.includes(account) : String(value ?? "").includes(account));
    check("smoke.no_plaintext_stored", stored.length === 1 && !Object.values(stored[0]).some(holds)
      && Buffer.isBuffer(stored[0].account_ciphertext) && !stored[0].account_ciphertext.equals(Buffer.from(account))
      && audited.every((row) => !holds(row.detail)));
    const revealRoute = "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal";
    const revealIds = { id: third.id, bankAccountId: created.id };
    check("roles.manager_cannot_reveal", (await send(mgmt, revealRoute, { ids: revealIds, body: { reason: REASON } })).status === 403);
    const revealed = await step("reveal", bankRead, revealRoute, { ids: revealIds, body: { reason: REASON } });
    check("smoke.reveal", revealed.accountNumber === account);

    // 每個寫入或者敏感讀取都對應到 audit 行。
    const audited2 = {};
    for (const [name, requestId] of Object.entries(requestIds)) {
      if (/read/u.test(name)) continue;
      const [[row]] = await app.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE request_id = ?", [requestId]);
      audited2[name] = Number(row.n);
    }
    check("smoke.audit_for_each_action", Object.values(audited2).every((n) => n >= 1), audited2);
    return passed() ? "PASS" : "FAIL";
  } catch (error) {
    check("runner.completed", false, errorText(error));
    return "FAIL";
  } finally {
    await app.stop().catch((error) => check("cleanup.app", false, errorText(error)));
    await admin.query(`DROP DATABASE IF EXISTS \`${fresh}\``).catch((error) => check("cleanup.schema", false, errorText(error)));
    await admin.end().catch(() => {});
  }
}

try {
  results["TC-134"] = await workerRollback();
  results["TC-135"] = await capabilityDeployment();
} catch (error) {
  console.error(`Supplier release acceptance failed: ${errorText(error)}`);
}
const tests = [
  { name: "TC-134 local worker stop-claim, lease expiry, restart takeover and no redo", id: "TC-134", status: results["TC-134"] ?? "FAIL" },
  { name: "TC-135 local fresh deployment, route and permission inventory, separated-role smoke", id: "TC-135", status: results["TC-135"] ?? "FAIL" },
  ...NOT_RUN.map(({ id, name }) => ({ name, id, status: "NOT_RUN" }))
];
console.log(JSON.stringify({ database: process.env.DB_NAME, evidence,
  notRun: Object.fromEntries(NOT_RUN.map(({ name, reason }) => [name, reason])) }, null, 2));
await writeReport(reportPath, tests);
if (tests.some((test) => test.status === "FAIL")) process.exitCode = 1;

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

/**
 * `server/scripts/runSupplier*Acceptance.js` 共用嘅小工具（HD-117 A、HD-119 A）。報告格式係 harness 嘅
 * HARNESS_JSON：`{"tests":[{name,id,status}]}`，status 只有 PASS／FAIL／SKIPPED／NOT_RUN。要 production 先做到嘅部分
 * 一律另開一項 NOT_RUN，原因寫喺 stdout 嘅 JSON，唔當 PASS。
 */

export function outputPath(argv = process.argv) {
  const index = argv.indexOf("--output");
  if (index < 0 || !argv[index + 1]) throw new Error("--output is required");
  return argv[index + 1];
}

export async function writeReport(file, tests) {
  await writeFile(file, `${JSON.stringify({ tests }, null, 2)}\n`);
}

/** 逐項檢查：記低結果，唔即刻拋，等報告列得出邊幾項唔過。 */
export function checklist() {
  const checks = [];
  return {
    checks,
    check(id, ok, detail = undefined) {
      checks.push({ id, status: ok ? "PASS" : "FAIL", ...(detail === undefined ? {} : { detail }) });
      return Boolean(ok);
    },
    passed: () => checks.length > 0 && checks.every(({ status }) => status === "PASS")
  };
}

/**
 * 開／剷 scratch database、還原有 definer 嘅 trigger、跑 migration 都要 admin（HD-123 A 起 profile 會傳 DB_ADMIN_*）。
 * 一對一齊用，唔逐個欄位退返去 DB_USER：嗰樣會變成用 erp_user 加 admin 密碼登入（REV-112 L-2）。
 */
export function adminCredentials() {
  return { user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD ?? "" };
}

/**
 * 冇 admin 帳號係環境前提唔齊，唔係測試失敗：每個 TC 報 NOT_RUN（suite 係 BLOCKED）就收工，唔郁任何資料庫（REV-112 L-2）。
 */
export async function exitUnlessAdmin(file, ids) {
  if (process.env.DB_ADMIN_USER) return;
  console.error("DB_ADMIN_USER is not set: these runners create and drop scratch databases, restore triggers and run migrations");
  await writeReport(file, ids.map((id) => ({ name: `${id} not run: DB_ADMIN_USER is not set`, id, status: "NOT_RUN" })));
  process.exit(0);
}

export function adminConnection(database = undefined) {
  return mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), ...adminCredentials(), database,
    multipleStatements: true });
}

/** 名一定喺 `${DB_NAME}_rh_` 之下：清理只會剷呢個前綴。 */
export function scratchName() {
  return `${process.env.DB_NAME}_rh_${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
}

/**
 * 呼叫 mysql／mysqldump。密碼經 MYSQL_PWD，唔放 argv（ps 睇得到）。`stdin`／`stdout` 係 file descriptor：成份 dump
 * 唔使變一條 JS 字串，mysql 中途退出亦唔會變 EPIPE 蓋住真正原因。exit 0 但 stderr 有 Error（例如權限不足）都當失敗。
 */
export function mysqlClient(binary, args, { stdin = "pipe", stdout = "pipe" } = {}) {
  const { user, password } = adminCredentials();
  const bin = process.env.MYSQL_BIN ? path.join(process.env.MYSQL_BIN, binary) : binary;
  const result = spawnSync(bin, [`--host=${process.env.DB_HOST}`, `--port=${process.env.DB_PORT}`, `--user=${user}`,
    "--default-character-set=utf8mb4", ...args], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MYSQL_PWD: password ?? "" }, stdio: [stdin, stdout, "pipe"]
  });
  const stderr = String(result.stderr ?? "").trim().slice(0, 500);
  if (result.error) throw new Error(`${binary}: ${result.error.message}${stderr ? `: ${stderr}` : ""}`);
  if (result.status !== 0 || /\berror\b/iu.test(stderr)) throw new Error(`${binary} exited ${result.status}: ${stderr}`);
  return result.stdout;
}

/** 每張 table 嘅 CHECKSUM，key 係 table 名。 */
export async function tableChecksums(connection, database) {
  const [tables] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name", [database]);
  if (tables.length === 0) return {};
  const [rows] = await connection.query(`CHECKSUM TABLE ${tables.map(({ name }) => `\`${database}\`.\`${name}\``).join(", ")}`);
  return Object.fromEntries(rows.map((row) => [row.Table.slice(database.length + 1), String(row.Checksum)]));
}

export const errorText = (error) => (error instanceof Error ? error.message : String(error));

const hash = (value) => createHash("sha256").update(value).digest("hex");

/**
 * CHECKSUM 只計資料。Schema 物件另外比：每張 table 嘅 `SHOW CREATE TABLE`（去咗 AUTO_INCREMENT 計數）、trigger、
 * routine 同 event 嘅定義。Schema 名唔計，因為還原嘅 schema 名一定唔同。
 */
export async function schemaObjects(connection, database) {
  const objects = {};
  const [tables] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name", [database]);
  for (const { name } of tables) {
    const [[row]] = await connection.query(`SHOW CREATE TABLE \`${database}\`.\`${name}\``);
    // 還原之後 column 會明寫 `CHARACTER SET x COLLATE y`，原本只寫 `COLLATE y`：collation 已經決定 charset，所以拎走前者。
    objects[`table:${name}`] = hash(row["Create Table"].replace(/ AUTO_INCREMENT=\d+/u, "").replace(/CHARACTER SET \w+ (?=COLLATE )/gu, ""));
  }
  const [triggers] = await connection.query(`SELECT trigger_name AS name, event_manipulation AS event, event_object_table AS tbl,
    action_timing AS timing, action_statement AS body FROM information_schema.triggers WHERE trigger_schema = ?`, [database]);
  for (const row of triggers) objects[`trigger:${row.name}`] = hash(JSON.stringify([row.event, row.tbl, row.timing, row.body]));
  const [routines] = await connection.query(`SELECT routine_name AS name, routine_type AS type, routine_definition AS body
    FROM information_schema.routines WHERE routine_schema = ?`, [database]);
  for (const row of routines) objects[`${row.type.toLowerCase()}:${row.name}`] = hash(String(row.body));
  const [events] = await connection.query(`SELECT event_name AS name, event_definition AS body, interval_value AS every, interval_field AS unit
    FROM information_schema.events WHERE event_schema = ?`, [database]);
  for (const row of events) objects[`event:${row.name}`] = hash(JSON.stringify([row.body, row.every, row.unit]));
  return objects;
}

export async function expectOk(name, response) {
  if (response.status < 200 || response.status > 299) throw new Error(`${name}: ${response.status} ${String(response.text).slice(0, 300)}`);
  return response.json?.data;
}

export const SUPPLIER_PERMISSIONS = Object.freeze(["supplier.approval", "supplier.bank.mgmt", "supplier.bank.view", "supplier.mgmt",
  "supplier.settings", "supplier.view"]);
const DATABASE = fileURLToPath(new URL("../../database/", import.meta.url));

/**
 * 設計 §14.4 嘅資料核對，只讀（TC-135、smokeSupplierManagement.js）。Ledger 要有呢個 release 每個 migration 檔，亦唔可以有
 * 呢個 release 唔認識嘅檔（即係 schema 比 code 新，例如 server rollback 咗）。回 approval 狀態同一個 active 貨幣。
 */
export async function deploymentChecks(connection, schema, check, { approvalMustBeOff = true } = {}) {
  const listed = (directory) => fs.readdirSync(path.join(DATABASE, directory)).filter((name) => /\.(js|sql)$/u.test(name))
    .map((name) => `${directory}/${name}`);
  const files = listed("migrations");
  const [ledger] = await connection.query(`SELECT name FROM \`${schema}\`.fr_schema_migrations`);
  const recorded = new Set(ledger.map((row) => row.name));
  const known = new Set([...files, ...listed("framework")]);
  check("deploy.every_migration_applied", files.length > 0 && files.every((name) => recorded.has(name)),
    { files: files.length, missing: files.filter((name) => !recorded.has(name)) });
  check("deploy.no_unknown_migration", ledger.every((row) => known.has(row.name)),
    { unknown: ledger.map((row) => row.name).filter((name) => !known.has(name)) });
  const [permissions] = await connection.query(`SELECT name FROM \`${schema}\`.permissions WHERE name LIKE 'supplier.%' ORDER BY name`);
  check("deploy.six_permissions_no_extra", JSON.stringify(permissions.map((row) => row.name)) === JSON.stringify(SUPPLIER_PERMISSIONS),
    { permissions: permissions.map((row) => row.name) });
  const [[admins]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${schema}\`.role_permissions rp JOIN \`${schema}\`.roles r ON r.id = rp.role_id
    JOIN \`${schema}\`.permissions p ON p.id = rp.permission_id WHERE r.name = 'system-admin' AND p.name LIKE 'supplier.%'`);
  check("deploy.system_admin_holds_six", Number(admins.n) === 6, { granted: Number(admins.n) });
  const [settingsRows] = await connection.query(`SELECT id, require_activation_approval FROM \`${schema}\`.supplier_settings`);
  const approval = settingsRows.length === 1 ? Number(settingsRows[0].require_activation_approval) === 1 : null;
  const singleton = settingsRows.length === 1 && Number(settingsRows[0].id) === 1;
  if (approvalMustBeOff) check("deploy.settings_singleton_approval_off", singleton && approval === false);
  else check("deploy.settings_singleton", singleton, { requireActivationApproval: approval });
  const [active] = await connection.query(`SELECT code FROM \`${schema}\`.currencies WHERE status = 'ACTIVE' ORDER BY code`);
  check("deploy.active_currency", active.length >= 1, { active: active.length });
  return { approval, currencyCode: active.some((row) => row.code === "HKD") ? "HKD" : active[0]?.code ?? null };
}

async function purchasableSku(h, tag) {
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

/**
 * 設計 §14.1 第 4、6、7 步：一個已經起咗嘅 harness app（`createSupplierHarness`）上面，每條 Supplier route 都受 supplier.*
 * 權限保護；分開嘅日常角色行 smoke：Draft、直接啟用、審批、暫停、封鎖、purchase lookup、masked Bank、reveal、audit。
 * 會寫 Supplier、SKU、Bank 同設定，所以只喺 scratch schema 或者還原副本跑（TC-135、HD-148 B）。
 */
export async function separatedRoleSmoke(app, check, { tag, reason, currencyCode = "HKD" }) {
  const unguarded = app.routes.filter((route) => route.authType === "public" || route.policies.length === 0
    || !route.policies.every((policy) => policy.name === "hasPermission" && policy.options.permissions.length > 0
      && policy.options.permissions.every((name) => SUPPLIER_PERMISSIONS.includes(name))));
  check("server.routes_guarded", app.routes.length > 0 && unguarded.length === 0,
    { routes: app.routes.length, unguarded: unguarded.map((route) => route.key) });

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
    { body: { supplierCode: `RLA-${tag}`, supplierName: `Release A ${tag}`, defaultCurrencyCode: currencyCode } });
  check("smoke.draft_created", draft.status === "draft");
  const active = await step("activate", mgmt, "POST /api/v1/suppliers/:id/activate", { ids: { id: draft.id }, body: { version: draft.version } });
  check("smoke.direct_activation", active.status === "active");

  const current = await step("settings read", settings, "GET /api/v1/supplier-settings");
  await step("settings on", settings, "POST /api/v1/supplier-settings/update",
    { body: { requireActivationApproval: true, version: current.version, reason: `${reason} on` } });
  const submitted = await step("approval submit", mgmt, "POST /api/v1/suppliers/create", { body: { supplierCode: `RLB-${tag}`,
    supplierName: `Release B ${tag}`, defaultCurrencyCode: currencyCode, activate: true, approverUserId: approver.userId } });
  const queue = await app.send(approver, { ...app.route("GET /api/v1/supplier-approvals"), path: "/api/v1/supplier-approvals?scope=all&pageSize=100" });
  const request = queue.json.data.items.find((item) => item.supplierId === submitted.id);
  await step("approval approve", approver, "POST /api/v1/supplier-approvals/:id/approve", { ids: { id: request.id }, body: { version: request.version } });
  const approved = await step("approved read", mgmt, "GET /api/v1/suppliers/:id", { ids: { id: submitted.id } });
  check("smoke.approval_flow", submitted.status === "pending_approval" && approved.status === "active", { submitted: submitted.status });
  const now = await step("settings read 2", settings, "GET /api/v1/supplier-settings");
  await step("settings off", settings, "POST /api/v1/supplier-settings/update",
    { body: { requireActivationApproval: false, version: now.version, reason: `${reason} off` } });
  const third = await step("create third", mgmt, "POST /api/v1/suppliers/create",
    { body: { supplierCode: `RLC-${tag}`, supplierName: `Release C ${tag}`, defaultCurrencyCode: currencyCode, activate: true } });

  // Purchase lookup：三個都有 SKU relation，暫停同封鎖之後即刻消失，history 仲睇得到。
  const { skuId, uomId } = await purchasableSku(app, tag);
  for (const supplier of [active, approved, third]) {
    await step(`relation ${supplier.supplierCode}`, mgmt, "POST /api/v1/suppliers/:id/sku-relations/create",
      { ids: { id: supplier.id }, body: { skuId, purchaseSkuUomId: uomId } });
  }
  const latest = async (id) => (await send(mgmt, "GET /api/v1/suppliers/:id", { ids: { id } })).json.data;
  await step("suspend", mgmt, "POST /api/v1/suppliers/:id/suspend",
    { ids: { id: active.id }, body: { version: (await latest(active.id)).version, reason } });
  await step("block", approver, "POST /api/v1/suppliers/:id/block",
    { ids: { id: approved.id }, body: { version: (await latest(approved.id)).version, reason } });
  const lookup = await app.send(mgmt, { ...app.route("GET /api/v1/supplier-lookups/for-sku/:skuId"),
    path: `/api/v1/supplier-lookups/for-sku/${skuId}` });
  const visible = lookup.json?.data?.items?.map((item) => item.supplierId) ?? [];
  check("smoke.lookup_hides_suspended_and_blocked", lookup.status === 200 && JSON.stringify(visible) === JSON.stringify([third.id]), { visible });
  check("smoke.history_still_visible", (await latest(active.id)).status === "suspended" && (await latest(approved.id)).status === "blocked");

  // Bank：讀同寫分開；DB 同 audit 冇明文；有授權 reveal 攞返帳號。
  const account = `65${String(Date.now()).slice(-12)}`;
  const bankBody = { accountHolderName: "Release Holder", bankName: "Release Bank", accountNumber: account, isDefault: true, reason };
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
  check("roles.manager_cannot_reveal", (await send(mgmt, revealRoute, { ids: revealIds, body: { reason } })).status === 403);
  const revealed = await step("reveal", bankRead, revealRoute, { ids: revealIds, body: { reason } });
  check("smoke.reveal", revealed.accountNumber === account);

  // 每個寫入或者敏感讀取都對應到 audit 行。
  const audited2 = {};
  for (const [name, requestId] of Object.entries(requestIds)) {
    if (/read/u.test(name)) continue;
    const [[row]] = await app.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE request_id = ?", [requestId]);
    audited2[name] = Number(row.n);
  }
  check("smoke.audit_for_each_action", Object.values(audited2).every((n) => n >= 1), audited2);
}

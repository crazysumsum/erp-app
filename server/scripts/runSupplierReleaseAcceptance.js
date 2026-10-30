// 第一個 import：config/jwt.js 冇預設 JWT_SECRET，而 harness 只傳 profile 嘅 env_keys（REV-109 H-1）。
import "../test-support/testEnv.js";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { stringify } from "csv-stringify/sync";

import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";
import { createSupplierHarness } from "../test/integration/supplierHttpHarness.js";
import {
  adminConnection, adminCredentials, deploymentChecks, exitUnlessAdmin, expectOk, checklist, errorText, outputPath, schemaObjects, scratchName,
  separatedRoleSmoke, tableChecksums, writeReport
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
 * - Production 先做到嘅部分（真部署時間線、按 §14 逐步部署、break-glass 帳號）由 HD-157 豁免，照列喺輸出（`waived`），
 *   唔當測試案例。成個 TC-136（release gate）仍然係 NOT_RUN。
 */
const reportPath = outputPath();
await exitUnlessAdmin(reportPath, ["TC-134", "TC-135", "TC-136"]);
const SERVER = fileURLToPath(new URL("../", import.meta.url));
const REASON = "TC-134/135 release rehearsal";
const tag = randomUUID().slice(0, 8).toUpperCase();
const WAIVED = [
  { id: "TC-134", name: "TC-134 production worker rollback and restart timeline",
    reason: "Waived by HD-157 (2026-10-30); the local part is the acceptance evidence. Needs a deployed server, its process manager and the runbook timeline. Here the restart is a second app in the same process and lease expiry is set in the database; that client rollback leaves data in place is not shown here." },
  { id: "TC-135", name: "TC-135 production staged capability deployment and break-glass accounts",
    reason: "Waived by HD-157 (2026-10-30); the local part is the acceptance evidence. Needs the real environment: deploying capabilities in §14 order, and showing that only approved break-glass accounts hold system-admin, with their use audited. The client menu inventory is covered by the supplier-client-ui suite (TC-121)." }
];
const NOT_RUN = [
  { id: "TC-136", name: "TC-136 release regression and evidence gate",
    reason: "The release gate is the harness verify_gate over the candidate's CI and suite evidence, the open P0/P1 cases and defects, and the Product Owner's GO; a runner cannot decide it." }
];
const results = {};
const evidence = {};

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
    const objects = await schemaObjects(admin, fresh);
    // Schema 嘅 digest 記低做證據，未有 release baseline 可以比。
    evidence.schemaDigest = createHash("sha256").update(JSON.stringify(Object.entries(objects).sort())).digest("hex");
    await deploymentChecks(admin, fresh, check);

    // §14.1 第 4、6、7 步：server 喺新 schema 上面起得到，route 受保護，分開嘅日常角色行 smoke。
    await app.start();
    await separatedRoleSmoke(app, check, { tag, reason: REASON });
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
  notRun: Object.fromEntries(NOT_RUN.map(({ name, reason }) => [name, reason])),
  waived: Object.fromEntries(WAIVED.map(({ name, reason }) => [name, reason])) }, null, 2));
await writeReport(reportPath, tests);
if (tests.some((test) => test.status === "FAIL")) process.exitCode = 1;

// 第一個 import：config/jwt.js 冇預設 JWT_SECRET，而 harness 只傳 profile 嘅 env_keys（REV-109 H-1）。
import "../test-support/testEnv.js";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createSupplierHarness } from "../test/integration/supplierHttpHarness.js";
import {
  adminConnection, adminCredentials, checklist, errorText, outputPath, scratchName, writeReport
} from "../test/integration/supplierAcceptanceRunner.js";

/**
 * TC-085、TC-101、TC-128、TC-129（SKU-008、IMP-016、OPS-001、OPS-002）：Supplier 效能（HD-117 A）。
 *
 * 喺一個全新 migrate 嘅 `${DB_NAME}_rh_*` schema 上面 seed 100,000 個 Supplier（T50 嘅 seed，NFR-003 形狀），然後用 T50
 * 嘅工具量度，再對門檻判斷：
 * - TC-128：50 個用戶混合負載（benchmarkSupplierManagement.js），一般操作 p95 < 2 秒、錯誤率 ≤ 1%，之後仲答到。
 * - TC-085：只跑 for-SKU（`--only=forSku`，最差情況），p95 < 2 秒；熱門 SKU 嘅總數同 SQL 數一樣；計劃冇全表掃描。
 * - TC-129：相似名稱有上限（HD-084／HD-087：最多 3,000 個候選計分，頭 50 個），召回率同冇上限差唔超過 2 點；
 *   常用 query 用 index（文字搜尋嘅全表掃描係 HD-088 決定）；列表總數唔會因為 join 膨脹。
 * - TC-101：10,000 列匯入同 50 個用戶負載同時跑：預檢加執行 ≤ 10 分鐘、每列只寫一次、線上 p95 仍然 < 2 秒。
 * TC-128 嘅 production-like 環境（OPS-001 寫明）係 NOT_RUN。完咗成個 schema 剷走；SIGINT／SIGTERM 一樣。
 */
const reportPath = outputPath();
const SERVER = fileURLToPath(new URL("../", import.meta.url));
const SCRIPTS = path.join(SERVER, "scripts");
const LIMIT_MS = 2_000;
const NOT_RUN = [
  { id: "TC-128", name: "TC-128 production-like MySQL and hardware",
    reason: "OPS-001 asks for a production-like MySQL. This run uses a local MySQL 26.7.0 on the developer machine with the app's default pool; the figures show the design holds at 100k rows, not production capacity." }
];
const evidence = {};
const results = {};
// T50 工具嘅完整報告留喺 output 隔籬（harness 嘅 run_dir），唔係 temp：FAIL 要睇得返細節。
const work = path.join(path.dirname(path.resolve(reportPath)), "supplier-performance-details");
fs.mkdirSync(work, { recursive: true });
const admin = await adminConnection();
const schema = scratchName();
const { user, password } = adminCredentials();
const childEnv = { ...process.env, DB_NAME: schema, DB_USER: user, DB_PASSWORD: password ?? "", DB_ADMIN_USER: user,
  DB_ADMIN_PASSWORD: password ?? "", DB_SOCKET_PATH: "", DB_SSL_ENABLED: "false" };
const children = new Set();
let app = null;
let cleaned = null;

const cleanup = () => (cleaned ??= (async () => {
  for (const child of children) child.kill("SIGTERM");
  await app?.stop().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch((error) => { evidence.cleanup = errorText(error); });
  await admin.end().catch(() => {});
})());
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });

/** 跑一個 T50 script；佢自己寫報告（--output），我哋讀返。 */
function runScript(script, args, { output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), `--database=${schema}`, ...args, ...(output ? [`--output=${output}`] : [])],
      { cwd: SERVER, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      children.delete(child);
      const report = output && fs.existsSync(output) && fs.statSync(output).size > 0 ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
      resolve({ code, report, stdout, stderr: stderr.slice(-2_000) });
    });
  });
}

const p95 = (report, name) => report?.operations?.[name]?.p95 ?? null;
const summary = (report) => (report ? { ok: report.ok, overall: report.overall, nfr001: report.nfr001, nfr005: report.nfr005, error: report.error,
  resources: report.resources, statements: report.topStatements?.length ?? 0, digestTable: report.digestTable } : null);
/** 查詢計劃要有得睇：digest 表滿咗或者冇記錄，就唔可以話「冇全表掃描」（空集合唔算證據）。 */
const plansSeen = (report) => (report?.topStatements?.length ?? 0) > 0 && !(report?.digestTable?.lostDuringRun > 0);
const LOAD_ARGS = ["--users=50", "--seconds=120", "--warmup-seconds=20", "--think-ms=1000"];

/** 有冇全表掃描：文字搜尋（LIKE）係 HD-088 決定嘅掃描，唔計。 */
function fullScans(report, pick = () => true) {
  return (report?.topStatements ?? []).filter((row) => pick(row) && !/\bLIKE\b/iu.test(row.digest) && Array.isArray(row.plan)
    && row.plan.some((step) => step.type === "ALL")).map((row) => row.digest.slice(0, 160));
}

async function totals(view) {
  const [[active]] = await admin.query(`SELECT COUNT(*) AS n FROM \`${schema}\`.suppliers WHERE status = 'active'`);
  const listed = await app.send(view, { ...app.route("GET /api/v1/suppliers"), path: "/api/v1/suppliers?status=active&pageSize=1" });
  // for-SKU lookup 列晒所有 Active Supplier，有 relation 嘅排前（設計 §8.7）：熱門 SKU 有 20,000 條 relation，總數膨脹嘅話會多過 Active 數。
  const [[hot]] = await admin.query(`SELECT id FROM \`${schema}\`.item_skus WHERE sku_code = 'PERF-SKU-HOT'`);
  const lookup = await app.send(view, { ...app.route("GET /api/v1/supplier-lookups/for-sku/:skuId"),
    path: `/api/v1/supplier-lookups/for-sku/${hot.id}?pageSize=1` });
  return { list: { api: listed.json?.data?.total ?? null, sql: Number(active.n), status: listed.status },
    forSku: { api: lookup.json?.data?.total ?? null, sql: Number(active.n), status: lookup.status } };
}

try {
  // ---- 準備：全新 schema、migrate、seed 100k ----
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await promisify(execFile)(process.execPath, [path.join(SCRIPTS, "migrate.js")], { cwd: SERVER, env: childEnv });
  const seeded = await runScript("seedSupplierPerformanceFixtures.js", ["--suppliers=100000", "--heavy-percent=1"]);
  evidence.seed = seeded.code === 0 ? JSON.parse(seeded.stdout.slice(seeded.stdout.indexOf("{"))) : { code: seeded.code, stderr: seeded.stderr };
  if (seeded.code !== 0) throw new Error("seed failed");

  // ---- TC-128：混合負載 ----
  const mixed = await runScript("benchmarkSupplierManagement.js", LOAD_ARGS, { output: path.join(work, "load.json") });
  evidence.load = summary(mixed.report);
  {
    const { checks, check, passed } = checklist();
    evidence["TC-128"] = checks;
    check("load.completed", mixed.code === 0 && mixed.report?.ok === true && !mixed.report?.error, { code: mixed.code, error: mixed.report?.error });
    check("load.list_and_exact_code_p95_under_2s", ["list.default", "list.codeExact"].every((name) => p95(mixed.report, name) !== null && p95(mixed.report, name) < LIMIT_MS),
      { listDefault: p95(mixed.report, "list.default"), codeExact: p95(mixed.report, "list.codeExact") });
    check("load.every_general_operation_within_limits", mixed.report?.nfr001?.pass === true, mixed.report?.nfr001);
    check("load.resources_recorded", Boolean(mixed.report?.resources?.dbThreadsConnected?.max), mixed.report?.resources);
    results["TC-128"] = passed() ? "PASS" : "FAIL";
  }

  // ---- TC-085：for-SKU 最差情況 ----
  const forSku = await runScript("benchmarkSupplierManagement.js", [...LOAD_ARGS, "--only=forSku"], { output: path.join(work, "for-sku.json") });
  evidence.forSku = summary(forSku.report);

  // 之後嘅總數檢查同「負載後仲答到」用一個真 app。
  app = createSupplierHarness("rh128", { database: { database: schema, user, password: password ?? "" } });
  await app.start();
  const view = await app.makeUser("view", ["supplier.view"]);
  const counted = await totals(view);
  evidence.totals = counted;
  {
    const { checks, check, passed } = checklist();
    evidence["TC-085"] = checks;
    check("for_sku.completed", forSku.code === 0 && forSku.report?.ok === true, { code: forSku.code, error: forSku.report?.error });
    check("for_sku.p95_under_2s", forSku.report?.nfr005?.pass === true, forSku.report?.nfr005);
    check("for_sku.count_not_inflated", counted.forSku.status === 200 && counted.forSku.api === counted.forSku.sql, counted.forSku);
    check("for_sku.no_full_scan", plansSeen(forSku.report) && fullScans(forSku.report).length === 0,
      { statements: forSku.report?.topStatements?.length ?? 0, digestTable: forSku.report?.digestTable, scans: fullScans(forSku.report) });
    results["TC-085"] = passed() ? "PASS" : "FAIL";
  }

  // ---- TC-129：相似名稱有上限、常用 query 用 index、總數唔膨脹 ----
  const recall = await runScript("measureSupplierDuplicateRecall.js", ["--queries=200", "--seed=50"], { output: path.join(work, "recall.json") });
  evidence.recall = recall.report?.variants ?? { code: recall.code, stderr: recall.stderr };
  {
    const { checks, check, passed } = checklist();
    evidence["TC-129"] = checks;
    const capped = recall.report?.variants?.capped;
    const uncapped = recall.report?.variants?.uncapped;
    check("duplicates.bounded_by_the_candidate_cap", recall.code === 0 && capped?.candidateCap === 3_000 && capped.p95Ms < uncapped.p95Ms
      && capped.p95Ms < LIMIT_MS, { capped, uncapped });
    check("duplicates.recall_within_two_points", capped !== undefined && uncapped.recall - capped.recall <= 0.02, { capped: capped?.recall, uncapped: uncapped?.recall });
    check("duplicates.check_p95_under_2s", p95(mixed.report, "duplicates.check") !== null && p95(mixed.report, "duplicates.check") < LIMIT_MS,
      { p95: p95(mixed.report, "duplicates.check") });
    check("plans.no_full_scan_outside_text_search", plansSeen(mixed.report) && fullScans(mixed.report).length === 0,
      { statements: mixed.report?.topStatements?.length ?? 0, digestTable: mixed.report?.digestTable, scans: fullScans(mixed.report) });
    check("list.count_not_inflated", counted.list.status === 200 && counted.list.api === counted.list.sql, counted.list);
    results["TC-129"] = passed() ? "PASS" : "FAIL";
  }

  // ---- TC-101：10,000 列匯入同 50 個用戶負載同時跑 ----
  {
    const { checks, check, passed } = checklist();
    evidence["TC-101"] = checks;
    const online = runScript("benchmarkSupplierManagement.js", LOAD_ARGS, { output: path.join(work, "load-during-import.json") });
    await new Promise((resolve) => { setTimeout(resolve, 21_000); });
    const imported = await runScript("benchmarkSupplierImport.js", ["--rows=10000"], { output: path.join(work, "import.json") });
    const during = await online;
    evidence.import = imported.report ? { ok: imported.report.ok, precheck: imported.report.precheck, execute: imported.report.execute,
      nfr004: imported.report.nfr004, verification: imported.report.verification, error: imported.report.error } : { code: imported.code, stderr: imported.stderr };
    evidence.loadDuringImport = summary(during.report);
    check("import.within_10_minutes", imported.report?.nfr004?.pass === true, imported.report?.nfr004);
    check("import.exactly_once_and_counts_consistent", imported.report?.verification?.exactlyOnce === true
      && imported.report?.verification?.countsConsistent === true, imported.report?.verification);
    check("import.report_ok", imported.code === 0 && imported.report?.ok === true, { code: imported.code, error: imported.report?.error });
    check("online.p95_under_2s_during_import", during.code === 0 && during.report?.nfr001?.pass === true, during.report?.nfr001);
    results["TC-101"] = passed() ? "PASS" : "FAIL";
  }

  // 負載之後仲答到（TC-128「冇不可恢復嘅飽和」）。
  const after = await app.send(view, app.route("GET /api/v1/suppliers"));
  const recovered = after.status === 200;
  evidence["TC-128"].push({ id: "load.answers_after_all_runs", status: recovered ? "PASS" : "FAIL", detail: { status: after.status } });
  if (!recovered) results["TC-128"] = "FAIL";
} catch (error) {
  console.error(`Supplier performance acceptance failed: ${errorText(error)}`);
  evidence.setup = errorText(error);
} finally {
  await cleanup();
}
const tests = [
  { name: "TC-085 local for-SKU lookup at 100k under 50 users", id: "TC-085", status: results["TC-085"] ?? "FAIL" },
  { name: "TC-101 local 10,000-row import alongside 50 online users", id: "TC-101", status: results["TC-101"] ?? "FAIL" },
  { name: "TC-128 local 100k Suppliers and 50 users, general operations", id: "TC-128", status: results["TC-128"] ?? "FAIL" },
  { name: "TC-129 local duplicate cap, query plans and counts", id: "TC-129", status: results["TC-129"] ?? "FAIL" },
  ...NOT_RUN.map(({ id, name }) => ({ name, id, status: "NOT_RUN" }))
];
console.log(JSON.stringify({ database: process.env.DB_NAME, schema, evidence,
  notRun: Object.fromEntries(NOT_RUN.map(({ name, reason }) => [name, reason])) }, null, 2));
await writeReport(reportPath, tests);
if (tests.some((test) => test.status === "FAIL") || evidence.cleanup) process.exitCode = 1;

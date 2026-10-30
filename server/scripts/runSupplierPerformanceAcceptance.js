// 第一個 import：config/jwt.js 冇預設 JWT_SECRET，而 harness 只傳 profile 嘅 env_keys（REV-109 H-1）。
import "../test-support/testEnv.js";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createSupplierHarness } from "../test/integration/supplierHttpHarness.js";
import {
  adminConnection, adminCredentials, exitUnlessAdmin, errorText, outputPath, scratchName, writeReport
} from "../test/integration/supplierAcceptanceRunner.js";
import { performanceVerdicts } from "../test/integration/supplierPerformanceVerdicts.js";

/**
 * TC-085、TC-101、TC-128、TC-129（SKU-008、IMP-016、OPS-001、OPS-002）：Supplier 效能（HD-117 A）。
 *
 * 喺一個全新 migrate 嘅 `${DB_NAME}_rh_*` schema 上面 seed 100,000 個 Supplier（T50 嘅 seed，NFR-003 形狀），然後用 T50
 * 嘅工具量度，再對門檻判斷：
 * - TC-128：50 個用戶混合負載（benchmarkSupplierManagement.js），一般操作 p95 < 2 秒、錯誤率 ≤ 1%，之後仲答到。
 * - TC-085：只跑 for-SKU（`--only=forSku`，最差情況），p95 < 3 秒（NFR-005，HD-157）；熱門 SKU 嘅總數同 SQL 數一樣；計劃冇全表掃描。
 * - TC-129：相似名稱有上限（HD-084／HD-087：最多 3,000 個候選計分，頭 50 個），召回率同冇上限差唔超過 2 點；
 *   常用 query 用 index（文字搜尋嘅全表掃描係 HD-088 決定）；列表總數唔會因為 join 膨脹。
 * - TC-101：10,000 列匯入同 50 個用戶負載同時跑：預檢加執行 ≤ 10 分鐘、每列只寫一次、線上 p95 仍然 < 2 秒。
 * TC-128 嘅 production-like 重測由 HD-157 豁免，本機結果就係證據；豁免項目照列喺輸出（`waived`），唔當測試案例。
 * 完咗成個 schema 剷走；SIGINT／SIGTERM 一樣。
 */
const reportPath = outputPath();
await exitUnlessAdmin(reportPath, ["TC-085", "TC-101", "TC-128", "TC-129"]);
const SERVER = fileURLToPath(new URL("../", import.meta.url));
const SCRIPTS = path.join(SERVER, "scripts");
const WAIVED = [
  { id: "TC-128", name: "TC-128 production-like MySQL and hardware",
    reason: "Waived by HD-157 (2026-10-30): no production-like re-test; this local run on MySQL 26.7.0 with the app's default pool is the acceptance evidence. It shows the design holds at 100k rows, not production capacity." }
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
  children.clear();
  await app?.stop().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch((error) => { evidence.cleanup = errorText(error); });
  await admin.end().catch(() => {});
})());
// 俾人停：清理、寫一份 FAIL 報告，用 128 加訊號號碼退出（REV-111 L-1）。
for (const [signal, number] of [["SIGINT", 2], ["SIGTERM", 15]]) {
  process.once(signal, () => {
    void cleanup()
      .then(() => writeReport(reportPath, ["TC-085", "TC-101", "TC-128", "TC-129"].map((id) => ({ name: `${id} interrupted by ${signal}`, id, status: "FAIL" }))))
      .finally(() => process.exit(128 + number));
  });
}

/** 跑一個 T50 script；佢自己寫報告（--output），我哋讀返。 */
function runScript(script, args, { output, onLine } = {}) {
  // 已經喺度清理就唔好再開新工具（REV-111 L-1）；舊報告先剷，唔好判斷到上一次嘅結果（L-2）。
  if (cleaned) return Promise.reject(new Error(`interrupted before ${script}`));
  if (output) fs.rmSync(output, { force: true });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), `--database=${schema}`, ...args, ...(output ? [`--output=${output}`] : [])],
      { cwd: SERVER, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const before = stdout.length;
      stdout += chunk;
      if (onLine) for (const line of stdout.slice(stdout.lastIndexOf("\n", before) + 1).split("\n").slice(0, -1)) onLine(line);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      children.delete(child);
      let report = null;
      try {
        report = output && fs.existsSync(output) && fs.statSync(output).size > 0 ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
      } catch (error) {
        stderr += `\nreport unreadable: ${errorText(error)}`;
      }
      // 有指定報告但讀唔到（冇寫或者壞咗）就當失敗；冇報告嘅工具（seed）睇 exit code。
      resolve({ code: output && report === null && code === 0 ? 1 : code, report, stdout, stderr: stderr.slice(-2_000) });
    });
  });
}

const summary = (report) => (report ? { ok: report.ok, overall: report.overall, nfr001: report.nfr001, nfr005: report.nfr005, error: report.error,
  resources: report.resources, statements: report.topStatements?.length ?? 0, digestTable: report.digestTable } : null);
const LOAD_ARGS = ["--users=50", "--seconds=120", "--warmup-seconds=20", "--think-ms=1000"];

async function totals(view) {
  const [[active]] = await admin.query(`SELECT COUNT(*) AS n FROM \`${schema}\`.suppliers WHERE status = 'active'`);
  const listed = await app.send(view, { ...app.route("GET /api/v1/suppliers"), path: "/api/v1/suppliers?status=active&pageSize=1" });
  // for-SKU lookup 列晒所有 Active Supplier，有 relation 嘅排前（設計 §8.7；LEFT JOIN、數 Supplier 行）。Relation 有
  // (supplier_id, sku_id) unique，按 SKU 篩嘅 JOIN 本身唔會膨脹；呢個比較捉到嘅係漏咗 SKU 條件或者 JOIN 錯 child 表（REV-111 L-4）。
  const [[hot]] = await admin.query(`SELECT id FROM \`${schema}\`.item_skus WHERE sku_code = 'PERF-SKU-HOT'`);
  const lookup = await app.send(view, { ...app.route("GET /api/v1/supplier-lookups/for-sku/:skuId"),
    path: `/api/v1/supplier-lookups/for-sku/${hot.id}?pageSize=1` });
  // 搜尋「123」：中嘅 Supplier 兩個識別號（BR<id>、TX-<id>）通常一齊中，JOIN 會數兩次；API 要等於 distinct（REV-111 M-1）。
  const term = "123";
  const searched = await app.send(view, { ...app.route("GET /api/v1/suppliers"), path: `/api/v1/suppliers?q=${term}&pageSize=1` });
  const [[joined]] = await admin.query(`SELECT COUNT(*) AS joined, COUNT(DISTINCT s.id) AS \`distinct\` FROM \`${schema}\`.suppliers s
    LEFT JOIN \`${schema}\`.supplier_identifiers i ON i.supplier_id = s.id AND i.identifier_value_key LIKE ?
    WHERE s.status <> 'archived' AND (s.supplier_code_key LIKE ? OR s.supplier_name LIKE ? OR s.display_name LIKE ? OR s.general_phone LIKE ?
      OR s.general_email LIKE ? OR i.id IS NOT NULL)`, [`%${term}%`, `${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`]);
  return { list: { api: listed.json?.data?.total ?? null, sql: Number(active.n), status: listed.status },
    listSearch: { term, api: searched.json?.data?.total ?? null, distinct: Number(joined.distinct), joined: Number(joined.joined), status: searched.status },
    forSku: { api: lookup.json?.data?.total ?? null, sql: Number(active.n), status: lookup.status } };
}

evidence.loadAverageAtStart = os.loadavg().map((value) => Math.round(value * 10) / 10);
try {
  // DEF-048（HD-153 A、REV-133 R1）：deadlock 偵測關咗嘅話計數永遠係 0，下面嘅檢查會白白 PASS；print_all_deadlocks 要開，
  // 個 FAIL 先分得出係咪 name-gram deadlock。一開始就查，唔使等 seed 完先知。
  const [[settings]] = await admin.query("SELECT @@innodb_deadlock_detect AS detect, @@innodb_print_all_deadlocks AS printAll");
  evidence.deadlockSettings = { innodbDeadlockDetect: Number(settings.detect), innodbPrintAllDeadlocks: Number(settings.printAll) };
  if (evidence.deadlockSettings.innodbDeadlockDetect !== 1 || evidence.deadlockSettings.innodbPrintAllDeadlocks !== 1) {
    throw new Error("innodb_deadlock_detect and innodb_print_all_deadlocks must both be ON: the deadlock checks would otherwise pass without measuring");
  }
  // ---- 準備：全新 schema、migrate、seed 100k ----
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await promisify(execFile)(process.execPath, [path.join(SCRIPTS, "migrate.js")], { cwd: SERVER, env: childEnv });
  const seeded = await runScript("seedSupplierPerformanceFixtures.js", ["--suppliers=100000", "--heavy-percent=1"]);
  evidence.seed = seeded.code === 0 ? JSON.parse(seeded.stdout.slice(seeded.stdout.indexOf("{"))) : { code: seeded.code, stderr: seeded.stderr };
  if (seeded.code !== 0) throw new Error("seed failed");

  // ---- 量度：混合負載（TC-128、TC-129）、for-SKU 最差情況（TC-085）、相似名稱（TC-129）、匯入加負載（TC-101）----
  // DEF-048（HD-153 A）：InnoDB 嘅 deadlock 計數。Retry 會遮住 deadlock，TC-101 試過有 defect 都 PASS，所以有一個就 FAIL。
  // 計數係成個 instance 嘅：同一個 mysqld 上面其他嘢嘅 deadlock 都會計入，所以要用獨立嘅 instance 跑。
  const deadlocks = async () => {
    const [[row]] = await admin.query("SELECT `COUNT` AS n, `STATUS` AS status FROM information_schema.INNODB_METRICS WHERE NAME = 'lock_deadlocks'");
    if (row?.status !== "enabled") throw new Error("INNODB_METRICS lock_deadlocks is not enabled, so deadlocks cannot be counted");
    return Number(row.n);
  };
  const deadlocksBeforeMixed = await deadlocks();
  const mixed = await runScript("benchmarkSupplierManagement.js", LOAD_ARGS, { output: path.join(work, "load.json") });
  evidence.load = summary(mixed.report);
  const deadlocksAfterMixed = await deadlocks();
  const deadlocksMixed = deadlocksAfterMixed - deadlocksBeforeMixed;
  const forSku = await runScript("benchmarkSupplierManagement.js", [...LOAD_ARGS, "--only=forSku"], { output: path.join(work, "for-sku.json") });
  evidence.forSku = summary(forSku.report);
  const recall = await runScript("measureSupplierDuplicateRecall.js", ["--queries=200", "--seed=50"], { output: path.join(work, "recall.json") });
  evidence.recall = recall.report?.variants ?? { code: recall.code, stderr: recall.stderr };
  // 匯入喺負載工具報出嘅量度窗口開始之後先起步（HD-122 A；REV-111 M-4），唔再靠固定延遲。
  const deadlocksBeforeImport = await deadlocks();
  let windowStart;
  const windowSeen = new Promise((resolve) => { windowStart = resolve; });
  const online = runScript("benchmarkSupplierManagement.js", LOAD_ARGS, { output: path.join(work, "load-during-import.json"), onLine: (line) => {
    if (line.includes('"supplier.benchmark.window"')) windowStart(JSON.parse(line));
  } });
  const loadWindow = await Promise.race([windowSeen, online.then(() => null)]);
  if (!loadWindow) throw new Error("the load benchmark ended before reporting its measured window");
  await new Promise((resolve) => { setTimeout(resolve, Math.max(0, Date.parse(loadWindow.measureFrom) - Date.now()) + 1_000); });
  const imported = await runScript("benchmarkSupplierImport.js", ["--rows=10000"], { output: path.join(work, "import.json") });
  const during = await online;
  const deadlocksAfterImport = await deadlocks();
  const deadlocksDuringImport = deadlocksAfterImport - deadlocksBeforeImport;
  evidence.deadlocks = { mixedLoad: deadlocksMixed, loadDuringImport: deadlocksDuringImport,
    counter: { beforeMixed: deadlocksBeforeMixed, afterMixed: deadlocksAfterMixed, beforeImport: deadlocksBeforeImport, afterImport: deadlocksAfterImport } };
  evidence.import = imported.report ? { ok: imported.report.ok, precheck: imported.report.precheck, execute: imported.report.execute,
    nfr004: imported.report.nfr004, verification: imported.report.verification, notApplied: imported.report.notApplied, error: imported.report.error }
    : { code: imported.code, stderr: imported.stderr };
  evidence.loadDuringImport = summary(during.report);

  // 總數同「負載之後仲答到」用一個真 app。
  app = createSupplierHarness("rh128", { database: { database: schema, user, password: password ?? "" } });
  await app.start();
  const view = await app.makeUser("view", ["supplier.view"]);
  const counted = await totals(view);
  evidence.totals = counted;
  const after = await app.send(view, app.route("GET /api/v1/suppliers"));

  Object.assign(evidence, performanceVerdicts({ mixed, forSku, recall, imported, during, counted }));
  // TC-128「冇不可恢復嘅飽和」：全部量度之後仲答到。
  evidence["TC-128"].push({ id: "load.answers_after_all_runs", status: after.status === 200 ? "PASS" : "FAIL", detail: { status: after.status } });
  evidence["TC-128"].push({ id: "db.no_deadlocks_mixed_load", status: deadlocksMixed === 0 ? "PASS" : "FAIL", detail: { deadlocks: deadlocksMixed } });
  evidence["TC-101"].push({ id: "db.no_deadlocks_during_import", status: deadlocksDuringImport === 0 ? "PASS" : "FAIL",
    detail: { deadlocks: deadlocksDuringImport } });
  for (const id of ["TC-085", "TC-101", "TC-128", "TC-129"]) {
    results[id] = evidence[id].length > 0 && evidence[id].every(({ status }) => status === "PASS") ? "PASS" : "FAIL";
  }
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
];
evidence.loadAverageAtEnd = os.loadavg().map((value) => Math.round(value * 10) / 10);
console.log(JSON.stringify({ database: process.env.DB_NAME, schema, evidence,
  waived: Object.fromEntries(WAIVED.map(({ name, reason }) => [name, reason])) }, null, 2));
await writeReport(reportPath, tests);
if (tests.some((test) => test.status === "FAIL") || evidence.cleanup) process.exitCode = 1;

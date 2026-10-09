/**
 * Supplier import 容量同 crash 恢復驗收（TASK-049；NFR-004；HD-074 1A／3A）。
 *
 *   node scripts/benchmarkSupplierImport.js --database=<DB_NAME> --rows=10000 --output <report.json> [--crash]
 *
 * 用 DB_* 環境變數指去一個**用完即棄**嘅資料庫（會寫入再刪走 `BM49-<run>-` 開頭嘅 Supplier）。五個 DB_* 都一定要明確
 * 設定（唔會退返去 `erp_dev`），`--database` 要同 `DB_NAME` 一樣（親手確認目標），資料庫入面有其他未完成嘅匯入
 * job 就拒絕執行：benchmark 嘅 worker 係真 worker，會處理佢見到嘅所有 job（REV-078 M-1）。跑嘅期間有其他 job 被郁過，
 * 報告就係 `ok: false` 並列出佢哋（REV-079 L-B）。**只可以對用完即棄嘅資料庫跑。**
 *
 * - 呢個 process 負責上載、確認、量度同核對；預檢同執行由另一個 process（同一個 script 加 `--worker`）做：佢用同一個
 *   `createApplication`、真 scheduler（每 5 秒領 job、真 lease）同真 SupplierImportWorkerService，但只開 Supplier
 *   嘅預檢同執行兩件工作，其他模組嘅背景工作全部關閉，唔會郁到其他資料（REV-080 L-C）；log 寫入臨時目錄。
 * - 收到 SIGINT／SIGTERM 會停 worker、清理、寫報告（`interrupted`）先退出（REV-080 L-D）；之後再收到嘅訊號唔理
 *   （REV-081 I-1）。Worker 經 IPC 連住呢個 process，呢個 process 點死都好（包括 SIGKILL），worker 都會自己收工
 *   （REV-081 I-2）。
 * - `--crash`：執行到一半 SIGKILL 個 worker，再開第二個接手。Lease 係 11 分鐘；kill 之後將 `lease_until`
 *   改做而家，代替等 lease 過期（報告會寫明），驗證接手後啱啱好寫入一次、冇重複 Supplier。
 * - 跟住量 10,000 列結果下載（T46）同匯出（T47；REV-075 L-4）嘅時間同記憶體。
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "csv-stringify/sync";

import { createApplication } from "../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../src/framework/configuration/applicationConfiguration.js";
import { discoverServiceDefinitions } from "../src/framework/services/serviceDiscovery.js";
import { BusinessMasterProvider } from "../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../src/modules/businessMaster/BusinessMasterRepository.js";
import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierExportService } from "../src/modules/supplier/SupplierExportService.js";
import { SupplierImportService } from "../src/modules/supplier/SupplierImportService.js";
import { SUPPLIER_IMPORT_JOB_NAMES } from "../src/services/supplierImport/supplierImportFiles.js";

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (found) return found.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  return next !== undefined && !next.startsWith("--") ? next : true;
};
const ROWS = Number(arg("rows", 10_000));
const OUTPUT = arg("output", null);
const CRASH = arg("crash", false) === true;
// 診斷用：每列只填主檔欄位，唔建地址、聯絡人、識別號。
const ROOT_ONLY = arg("root-only", false) === true;
// 診斷用：名稱互不相似（隨機字），對比「Benchmark Supplier <n>」呢種全部相似嘅最壞情況。
const DISTINCT_NAMES = arg("distinct-names", false) === true;
const WORDS = ["Amber", "Basalt", "Cedar", "Delta", "Ember", "Fjord", "Garnet", "Harbor", "Indigo", "Juniper", "Kestrel", "Lumen",
  "Maple", "Nimbus", "Onyx", "Pioneer", "Quarry", "Raven", "Summit", "Tundra", "Umber", "Vertex", "Willow", "Xenon", "Yarrow", "Zephyr"];
const distinctName = (index) => {
  const pick = (n) => WORDS[n % WORDS.length];
  return `${pick(index * 7)} ${pick(index * 13 + 3)} ${pick(Math.floor(index / 26) * 5 + 1)} ${randomBytes(3).toString("hex")} Trading`;
};
const WORKER = arg("worker", false) === true;
if (!WORKER && (!Number.isSafeInteger(ROWS) || ROWS < 2 || ROWS > 10_000 || typeof OUTPUT !== "string")) {
  throw new Error("usage: node scripts/benchmarkSupplierImport.js --database=<DB_NAME> --rows=<2..10000> --output <report.json> [--crash]");
}
const DB_KEYS = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];
// 密碼可以係空（冇密碼嘅臨時 user）；其餘一定要有值（REV-079 I-E）。
const missing = DB_KEYS.filter((key) => (key === "DB_PASSWORD" ? process.env[key] === undefined : !process.env[key]));
if (missing.length > 0) {
  throw new Error(`set ${missing.join(", ")} explicitly to a throwaway database: the benchmark writes and deletes Suppliers and runs a real import worker against it`);
}
if (arg("database", null) !== process.env.DB_NAME) {
  throw new Error(`--database must repeat DB_NAME (${process.env.DB_NAME}) to confirm it is a throwaway database`);
}
// 一開始就試寫：寫唔到報告就唔好跑（REV-081 I-5）。唔清走原有內容，之後成個覆寫。
if (!WORKER) fs.appendFileSync(OUTPUT, "");

/** 只開 Supplier 預檢同執行嘅 app；其餘背景工作（Item、Customer、Sales……）全部關閉（REV-080 L-C）。 */
async function supplierOnlyApplication({ work: directory, root: importRoot, keep }) {
  const source = defaultConfigurationSource();
  const names = (await discoverServiceDefinitions()).flatMap((definition) => (definition.ServiceClass?.jobs ?? []).map((job) => job.name));
  // tokenRevocation.refresh 一定要開（設定驗證要求），佢只係讀撤銷名單，唔郁業務資料。
  const always = ["tokenRevocation.refresh"];
  const jobs = Object.fromEntries(names.map((name) => [name,
    { ...(source.scheduler.jobs?.[name] ?? {}), enabled: keep.includes(name) || always.includes(name) }]));
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      scheduler: { ...source.scheduler, jobs },
      supplier: { ...source.supplier, import: { ...source.supplier.import, root: importRoot } },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(directory, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(directory, "system") } } } }
  });
}

if (WORKER) {
  // Child：等 SIGTERM，或者父 process 消失（IPC 斷線，REV-081 I-2）；或者被 SIGKILL。
  const stopped = new Promise((resolve) => { process.once("SIGTERM", resolve); process.once("disconnect", resolve); });
  const app = await supplierOnlyApplication({ work: process.env.BENCH_WORKER_DIR, root: process.env.BENCH_IMPORT_ROOT,
    keep: [SUPPLIER_IMPORT_JOB_NAMES.precheck, SUPPLIER_IMPORT_JOB_NAMES.worker] });
  if (!process.connected) process.exit(0);
  await app.start();
  await stopped;
  await app.shutdown("benchmark-worker");
  process.exit(0);
}

const RUN = randomBytes(3).toString("hex").toUpperCase();
const PREFIX = `BM49-${RUN}-`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-bench-"));
const root = path.join(work, "imports");
const report = { run: RUN, rows: ROWS, crash: CRASH, rootOnly: ROOT_ONLY, distinctNames: DISTINCT_NAMES, command: process.argv.slice(1).join(" "), startedAt: new Date().toISOString() };
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const RUN_STARTED = Date.now();
const now = () => Date.now();

function environment(mysqlVersion, durability) {
  return {
    os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cpus: os.cpus().length,
    totalMemoryGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version, mysql: mysqlVersion, durability,
    // 有 DB_SOCKET_PATH 就用 socket，host 同 port 唔會用到（REV-081 I-4、I-7）。
    database: { name: process.env.DB_NAME, host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
      socketPath: process.env.DB_SOCKET_PATH || null },
    worker: "a separate process with createApplication and the real scheduler; only supplier.import.precheck and supplier.import.execute enabled (every 5 s, lease 11 min), plus tokenRevocation.refresh, which configuration requires"
  };
}

function csv() {
  const records = [];
  for (let index = 1; index <= ROWS; index += 1) {
    const n = String(index).padStart(5, "0");
    records.push(SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({
      supplierCode: `${PREFIX}${n}`, supplierName: DISTINCT_NAMES ? distinctName(index) : `Benchmark Supplier ${RUN} ${n}`, displayName: `Bench ${n}`,
      defaultCurrencyCode: "HKD", generalPhone: "+852 2123 4567", generalEmail: `bench${n}@example.com`,
      notes: "T49 capacity run", addressLabel: "Head office", addressPurpose: "office", addressLine1: `${index} Benchmark Road`,
      city: "Hong Kong", countryCode: "HK", contactName: `Contact ${n}`, contactPurpose: "orders", contactEmail: `c${n}@example.com`,
      identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `BM${RUN}${n}`
    })[name] ?? "").map((value, column) => (ROOT_ONLY && column >= SUPPLIER_IMPORT_COLUMN_NAMES.indexOf("addressLabel") ? "" : value)));
  }
  return Buffer.from(stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...records], SUPPLIER_CSV_STRINGIFY_OPTIONS));
}

/** 收到訊號之後，主流程喺下一個檢查點停，唔再開 worker、唔再核對（REV-081 N-1）。 */
function throwIfInterrupted() {
  if (report.interrupted) throw new Error(`interrupted by ${report.interrupted}`);
}

function startWorker(label) {
  throwIfInterrupted();
  const log = fs.openSync(path.join(work, `${label}.log`), "a");
  // 同一個 script 嘅 `--worker` mode；log 落臨時目錄（REV-079 I-A 對 benchmark 嚟講解決咗）。
  return spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", `--database=${process.env.DB_NAME}`], {
    cwd: SERVER_DIR, stdio: ["ignore", log, log, "ipc"],
    env: { ...process.env, BENCH_WORKER_DIR: path.join(work, label), BENCH_IMPORT_ROOT: root, DB_INTEGRATION_TESTS: "" }
  });
}

function rssMiB(pid) {
  try {
    return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024);
  } catch {
    return null;
  }
}

let application;
let db;
const children = [];
// 建立咗乜就記低，`finally` 照住清（REV-078 L-1）：成功同失敗都清。
const created = { roleId: null, userId: null, jobId: null };

async function cleanup() {
  const ids = (await db.query("SELECT id FROM suppliers WHERE supplier_code_key LIKE ?", [`${PREFIX.toLowerCase()}%`]))[0].map((row) => row.id);
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    for (const table of ["supplier_address_purposes", "supplier_addresses", "supplier_contact_purposes", "supplier_contacts",
      "supplier_identifiers", "supplier_name_grams", "supplier_activation_requests", "supplier_audit_logs"]) {
      await db.query(`DELETE FROM ${table} WHERE supplier_id IN (?)`, [chunk]);
    }
    await db.query("DELETE FROM suppliers WHERE id IN (?)", [chunk]);
  }
  if (created.jobId !== null) {
    await db.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [created.jobId]);
    await db.execute("DELETE FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ?", [created.jobId]);
    await db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [created.jobId]);
  }
  if (created.userId !== null) {
    await db.execute("DELETE FROM supplier_audit_logs WHERE target_type IN ('import', 'export') AND actor_user_id = ?", [created.userId]);
    await db.execute("DELETE FROM user_roles WHERE user_id = ?", [created.userId]);
    await db.execute("DELETE FROM users WHERE id = ?", [created.userId]);
  }
  if (created.roleId !== null) {
    await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [created.roleId]);
    await db.execute("DELETE FROM roles WHERE id = ?", [created.roleId]);
  }
  return { suppliers: ids.length, job: created.jobId, user: created.userId, role: created.roleId };
}
let finished = null;
/** 停 worker、睇有冇其他 job 被郁過、清理、寫報告；正常完結同收到訊號都行呢度，只行一次。 */
function finish() {
  finished ??= (async () => {
    // 被 SIGKILL 嘅 child exitCode 仍然係 null（記喺 signalCode），所以兩樣都要睇。
    const running = children.filter((child) => child.exitCode === null && child.signalCode === null);
    for (const child of running) child.kill("SIGTERM");
    await Promise.all(running.map((child) => new Promise((resolve) => { child.once("exit", resolve); })));
    if (db) {
      // 分開兩個 try：檢查出錯都要清理（REV-080 I-G）。
      try {
        const [touched] = await db.query("SELECT id, status FROM supplier_import_jobs WHERE id <> ? AND updated_at >= ?",
          [created.jobId ?? 0, RUN_STARTED]);
        if (touched.length > 0) {
          report.ok = false;
          report.foreignJobsTouched = touched.map((row) => ({ id: Number(row.id), status: row.status }));
          process.exitCode = 1;
        }
      } catch (error) {
        report.ok = false;
        report.checkError = error.message;
        process.exitCode = 1;
      }
      try {
        report.cleanup = await cleanup();
      } catch (error) {
        report.ok = false;
        report.cleanupError = error.message;
        process.exitCode = 1;
      }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    if (application) await application.shutdown("benchmark");
    fs.rmSync(work, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
  })();
  return finished;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (report.interrupted) return;
    report.ok = false;
    report.interrupted = signal;
    void finish().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

try {
  // 呢個 process 自己唔跑任何背景工作。
  application = await supplierOnlyApplication({ work: path.join(work, "parent"), root, keep: [] });
  db = application.services.require("mysqldatabase");
  const preparedRoot = application.services.require("job.supplierImportWorker").preparedRoot;
  const [[{ version: mysqlVersion }]] = await db.query("SELECT VERSION() AS version");
  const [[durability]] = await db.query(
    "SELECT @@innodb_flush_log_at_trx_commit AS innodbFlushLogAtTrxCommit, @@sync_binlog AS syncBinlog, @@log_bin AS logBin");
  report.environment = environment(mysqlVersion, durability);
  const [[{ pending }]] = await db.query(
    "SELECT COUNT(*) AS pending FROM supplier_import_jobs WHERE status IN ('uploaded', 'validating', 'ready', 'ready_with_errors', 'queued', 'running')");
  if (Number(pending) > 0) {
    throw new Error(`refusing to run: ${pending} other import job(s) are pending in ${process.env.DB_NAME}, and the benchmark's worker would process them`);
  }
  const time = { nowMs: now };
  const imports = new SupplierImportService({ database: db, time });

  const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`bm49-${RUN}`, now()]);
  created.roleId = Number(role.insertId);
  const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = 'supplier.mgmt'");
  await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [role.insertId, permission.id]);
  const [user] = await db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', 'Benchmark', ?, ?)",
    [`bm49-${RUN}`, now(), now()]);
  created.userId = Number(user.insertId);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user.insertId, role.insertId]);
  const actor = { actorId: Number(user.insertId), claimedRoles: [`bm49-${RUN}`], claimedPermissions: ["supplier.mgmt"] };

  const content = csv();
  report.fileBytes = content.length;
  const uploadStarted = now();
  const job = await imports.createFromUpload({ ...actor, root: preparedRoot, mode: "create_only", content, maxFileBytes: 10_485_760 });
  created.jobId = Number(job.id);
  report.uploadMs = now() - uploadStarted;

  const samples = { rssMiB: [], dbConnections: [] };
  const sampling = { on: true };
  const sampler = (async () => {
    while (sampling.on) {
      for (const child of children.filter((candidate) => candidate.exitCode === null && candidate.signalCode === null)) {
        const rss = rssMiB(child.pid);
        if (rss !== null) samples.rssMiB.push(rss);
      }
      const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.processlist WHERE user = ?", [process.env.DB_USER]);
      samples.dbConnections.push(Number(n));
      await sleep(500);
    }
  })();
  const status = async () => (await db.query(
    "SELECT status, applied_count, failed_count, skipped_count, total_count, valid_count, version FROM supplier_import_jobs WHERE id = ?",
    [job.id]))[0][0];
  const waitFor = async (predicate, limitMs) => {
    const deadline = now() + limitMs;
    for (;;) {
      throwIfInterrupted();
      const current = await status();
      if (predicate(current)) return current;
      if (now() > deadline) throw new Error(`timed out waiting; job is ${JSON.stringify(current)}`);
      await sleep(250);
    }
  };

  children.push(startWorker("worker-a"));
  const precheckStarted = now();
  const ready = await waitFor((current) => ["ready", "ready_with_errors", "failed"].includes(current.status), 600_000);
  report.precheck = { ms: now() - precheckStarted, status: ready.status, total: ready.total_count, valid: ready.valid_count };
  if (ready.status !== "ready") throw new Error(`precheck ended ${ready.status}`);

  const executeStarted = now();
  await imports.confirm({ ...actor, id: job.id, version: Number(ready.version), activationMode: "draft" });
  if (CRASH) {
    const half = Math.floor(ROWS / 2);
    // Job 嘅 applied_count 要 finalize 先寫，所以數 rows。
    const appliedRows = async () => Number((await db.query(
      "SELECT COUNT(*) AS n FROM supplier_import_rows WHERE job_id = ? AND status = 'applied'", [job.id]))[0][0].n);
    for (const deadline = now() + 600_000; await appliedRows() < half; await sleep(50)) {
      throwIfInterrupted();
      if (now() > deadline) throw new Error("timed out waiting for half of the rows");
    }
    const applied = await appliedRows();
    children[0].kill("SIGKILL");
    await new Promise((resolve) => { children[0].once("exit", resolve); });
    const killedAt = now();
    // Lease 11 分鐘：唔等佢過期，改做而家（報告寫明），量嘅係接手之後嘅處理。
    await db.execute("UPDATE supplier_import_jobs SET lease_until = ? WHERE id = ? AND status = 'running'", [now(), job.id]);
    children.push(startWorker("worker-b"));
    report.crash = { appliedRowsAtKill: Number(applied), midRun: Number(applied) > 0 && Number(applied) < ROWS,
      leaseExpirySimulated: true, realLeaseMs: 660_000, killedAtMs: killedAt - executeStarted };
  }
  const done = await waitFor((current) => ["completed", "completed_with_errors", "failed"].includes(current.status), 1_200_000);
  report.execute = { ms: now() - executeStarted, status: done.status, applied: done.applied_count, failed: done.failed_count,
    skipped: done.skipped_count };
  report.nfr004 = { precheckPlusExecuteMs: report.precheck.ms + report.execute.ms, limitMs: 600_000,
    pass: report.precheck.ms + report.execute.ms <= 600_000,
    note: CRASH ? "includes the crash, the restart of a second worker and its first poll; the 11-minute lease wait is simulated" : "" };
  sampling.on = false;
  await sampler;
  report.workerPeakRssMiB = Math.max(...samples.rssMiB);
  report.dbConnectionsPeak = { userConnections: Math.max(...samples.dbConnections),
    note: "all connections of DB_USER, including this process's own pool" };

  // 每 1,000 列平均每列幾耐（由上一列完成到呢列完成），睇成本會唔會隨數量上升。
  const [buckets] = await db.query(
    `SELECT FLOOR((\`row_number\` - 1) / 1000) AS bucket, ROUND(AVG(gap), 1) AS msPerRow FROM (
       SELECT \`row_number\`, completed_at - LAG(completed_at) OVER (ORDER BY \`row_number\`) AS gap
         FROM supplier_import_rows WHERE job_id = ? AND status = 'applied') timed
      WHERE gap IS NOT NULL GROUP BY bucket ORDER BY bucket`, [job.id]);
  report.msPerRowByThousand = buckets.map((row) => Number(row.msPerRow));

  // 核對：每列啱啱好寫一次。
  const [[suppliers]] = await db.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key LIKE ?", [`${PREFIX.toLowerCase()}%`]);
  const [[rowStats]] = await db.query(
    `SELECT COUNT(*) AS rowsTotal, SUM(status = 'applied') AS applied, COUNT(DISTINCT applied_supplier_id) AS distinctSuppliers
       FROM supplier_import_rows WHERE job_id = ?`, [job.id]);
  const [[audits]] = await db.query(
    "SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE action = 'supplier.create' AND target_label LIKE ?", [`${PREFIX}%`]);
  // 清理緊嘅資料唔算數：中斷咗就唔寫核對結果（REV-081 N-1）。
  throwIfInterrupted();
  report.verification = {
    suppliersCreated: Number(suppliers.n), rowsApplied: Number(rowStats.applied), distinctAppliedSuppliers: Number(rowStats.distinctSuppliers),
    createAudits: Number(audits.n),
    exactlyOnce: Number(suppliers.n) === ROWS && Number(rowStats.applied) === ROWS && Number(rowStats.distinctSuppliers) === ROWS,
    countsConsistent: done.applied_count + done.failed_count + done.skipped_count === done.total_count
  };

  // 結果下載（T46）同匯出（T47）：時間同記憶體。
  global.gc?.();
  let before = process.memoryUsage();
  let started = now();
  const result = await imports.resultCsv({ ...actor, id: job.id });
  report.resultDownload = { ms: now() - started, bytes: Buffer.byteLength(result.content), heapDeltaMiB: Math.round((process.memoryUsage().heapUsed - before.heapUsed) / 2 ** 20),
    rssDeltaMiB: Math.round((process.memoryUsage().rss - before.rss) / 2 ** 20) };
  global.gc?.();
  before = process.memoryUsage();
  started = now();
  const exporter = new SupplierExportService({ database: db, time,
    businessMaster: new BusinessMasterProvider({ database: db, repository: new BusinessMasterRepository() }) });
  const exported = await exporter.exportCsv({ ...actor, filters: { q: PREFIX } });
  report.export = { ms: now() - started, rows: exported.rowCount, bytes: Buffer.byteLength(exported.content),
    heapDeltaMiB: Math.round((process.memoryUsage().heapUsed - before.heapUsed) / 2 ** 20),
    rssDeltaMiB: Math.round((process.memoryUsage().rss - before.rss) / 2 ** 20) };
  throwIfInterrupted();
  report.ok = report.verification.exactlyOnce && report.verification.countsConsistent && report.nfr004.pass &&
    (!CRASH || report.crash.midRun);

} catch (error) {
  if (!report.interrupted) {
    report.ok = false;
    report.error = error.message;
    process.exitCode = 1;
  }
} finally {
  await finish();
}

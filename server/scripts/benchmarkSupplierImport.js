/**
 * Supplier import 容量同 crash 恢復驗收（TASK-049；NFR-004；HD-074 1A／3A）。
 *
 *   node scripts/benchmarkSupplierImport.js --rows=10000 --output <report.json> [--crash]
 *
 * 用 DB_* 環境變數指去一個**用完即棄**嘅資料庫（會寫入再刪走 `BM49-<run>-` 開頭嘅 Supplier）。
 *
 * - 呢個 process 負責上載、確認、量度同核對；預檢同執行由一個真 API process（`node src/index.js`，
 *   正式 scheduler 設定：每 5 秒領 job、真 lease）做，等同 production 嘅 worker。
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
if (!Number.isSafeInteger(ROWS) || ROWS < 2 || ROWS > 10_000 || typeof OUTPUT !== "string") {
  throw new Error("usage: node scripts/benchmarkSupplierImport.js --rows=<2..10000> --output <report.json> [--crash]");
}

const RUN = randomBytes(3).toString("hex").toUpperCase();
const PREFIX = `BM49-${RUN}-`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-bench-"));
const root = path.join(work, "imports");
const report = { run: RUN, rows: ROWS, crash: CRASH, command: process.argv.slice(1).join(" "), startedAt: new Date().toISOString() };
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const now = () => Date.now();

function environment(mysqlVersion) {
  return {
    os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cpus: os.cpus().length,
    totalMemoryGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version, mysql: mysqlVersion,
    worker: "node src/index.js, development config, scheduler defaults (precheck/execute every 5 s, lease 11 min)"
  };
}

function csv() {
  const records = [];
  for (let index = 1; index <= ROWS; index += 1) {
    const n = String(index).padStart(5, "0");
    records.push(SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({
      supplierCode: `${PREFIX}${n}`, supplierName: `Benchmark Supplier ${RUN} ${n}`, displayName: `Bench ${n}`,
      defaultCurrencyCode: "HKD", generalPhone: "+852 2123 4567", generalEmail: `bench${n}@example.com`,
      notes: "T49 capacity run", addressLabel: "Head office", addressPurpose: "office", addressLine1: `${index} Benchmark Road`,
      city: "Hong Kong", countryCode: "HK", contactName: `Contact ${n}`, contactPurpose: "orders", contactEmail: `c${n}@example.com`,
      identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `BM${RUN}${n}`
    })[name] ?? ""));
  }
  return Buffer.from(stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...records], SUPPLIER_CSV_STRINGIFY_OPTIONS));
}

function startWorker(label) {
  const log = fs.openSync(path.join(work, `${label}.log`), "a");
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER_DIR, stdio: ["ignore", log, log],
    env: { ...process.env, NODE_ENV: "development", APP_HOST: "127.0.0.1", APP_PORT: String(3490 + (label === "worker-b" ? 1 : 0)),
      JWT_SECRET: randomBytes(32).toString("hex"), SUPPLIER_IMPORT_ROOT: root, LOG_DIRECTORY: path.join(work, `${label}-logs`),
      ITEM_MEDIA_DIRECTORY: path.join(work, "items"), DB_INTEGRATION_TESTS: "" }
  });
  return child;
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
try {
  const source = defaultConfigurationSource();
  application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs, [SUPPLIER_IMPORT_JOB_NAMES.precheck]: { enabled: false },
        [SUPPLIER_IMPORT_JOB_NAMES.worker]: { enabled: false }, [SUPPLIER_IMPORT_JOB_NAMES.purge]: { enabled: false } } },
      supplier: { ...source.supplier, import: { ...source.supplier.import, root } },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(work, "parent-requests") },
        system: { ...source.logging.loggers.system, directory: path.join(work, "parent-system") } } } }
  });
  db = application.services.require("mysqldatabase");
  const preparedRoot = application.services.require("job.supplierImportWorker").preparedRoot;
  const [[{ version: mysqlVersion }]] = await db.query("SELECT VERSION() AS version");
  report.environment = environment(mysqlVersion);
  const time = { nowMs: now };
  const imports = new SupplierImportService({ database: db, time });

  const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`bm49-${RUN}`, now()]);
  const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = 'supplier.mgmt'");
  await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [role.insertId, permission.id]);
  const [user] = await db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', 'Benchmark', ?, ?)",
    [`bm49-${RUN}`, now(), now()]);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user.insertId, role.insertId]);
  const actor = { actorId: Number(user.insertId), claimedRoles: [`bm49-${RUN}`], claimedPermissions: ["supplier.mgmt"] };

  const content = csv();
  report.fileBytes = content.length;
  const uploadStarted = now();
  const job = await imports.createFromUpload({ ...actor, root: preparedRoot, mode: "create_only", content, maxFileBytes: 10_485_760 });
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
    await waitFor((current) => current.applied_count >= half || current.status === "completed", 600_000);
    const [[{ applied }]] = await db.query("SELECT COUNT(*) AS applied FROM supplier_import_rows WHERE job_id = ? AND status = 'applied'", [job.id]);
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

  // 核對：每列啱啱好寫一次。
  const [[suppliers]] = await db.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key LIKE ?", [`${PREFIX.toLowerCase()}%`]);
  const [[rowStats]] = await db.query(
    `SELECT COUNT(*) AS rowsTotal, SUM(status = 'applied') AS applied, COUNT(DISTINCT applied_supplier_id) AS distinctSuppliers
       FROM supplier_import_rows WHERE job_id = ?`, [job.id]);
  const [[audits]] = await db.query(
    "SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE action = 'supplier.create' AND target_label LIKE ?", [`${PREFIX}%`]);
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
  report.ok = report.verification.exactlyOnce && report.verification.countsConsistent && report.nfr004.pass &&
    (!CRASH || report.crash.midRun);

  // 清走：Supplier 連子資料、job、user。
  const ids = (await db.query("SELECT id FROM suppliers WHERE supplier_code_key LIKE ?", [`${PREFIX.toLowerCase()}%`]))[0].map((row) => row.id);
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    for (const table of ["supplier_address_purposes", "supplier_addresses", "supplier_contact_purposes", "supplier_contacts",
      "supplier_identifiers", "supplier_name_grams", "supplier_activation_requests", "supplier_audit_logs"]) {
      await db.query(`DELETE FROM ${table} WHERE supplier_id IN (?)`, [chunk]);
    }
    await db.query("DELETE FROM suppliers WHERE id IN (?)", [chunk]);
  }
  await db.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [job.id]);
  await db.execute("DELETE FROM supplier_audit_logs WHERE target_type IN ('import', 'export') AND actor_user_id = ?", [actor.actorId]);
  await db.execute("DELETE FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ?", [job.id]);
  await db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [job.id]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [actor.actorId]);
  await db.execute("DELETE FROM users WHERE id = ?", [actor.actorId]);
  await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [role.insertId]);
  await db.execute("DELETE FROM roles WHERE id = ?", [role.insertId]);
} catch (error) {
  report.ok = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  // 被 SIGKILL 嘅 child exitCode 仍然係 null（記喺 signalCode），所以兩樣都要睇。
  const running = children.filter((child) => child.exitCode === null && child.signalCode === null);
  for (const child of running) child.kill("SIGTERM");
  await Promise.all(running.map((child) => new Promise((resolve) => { child.once("exit", resolve); })));
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  if (application) await application.shutdown("benchmark");
  fs.rmSync(work, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}

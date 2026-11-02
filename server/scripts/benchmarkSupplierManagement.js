/**
 * Supplier 管理效能驗收（TASK-050；設計 §11.5；NFR-001、NFR-002、NFR-003；HD-082 A）。
 *
 *   node scripts/benchmarkSupplierManagement.js --database=<DB_NAME> --output <report.json>
 *     [--users=50] [--seconds=120] [--warmup-seconds=20] [--think-ms=1000] [--only=<operation prefix>] [--general-limit-ms=2000]
 *
 * 先用 `seedSupplierPerformanceFixtures.js` 準備資料。**只可以對用完即棄嘅資料庫跑**：佢會建 Supplier、改 seed
 * 嘅 Supplier（版本會加），完咗刪走自己建嘅 Supplier、user 同 role。寫入時嘅 idempotency 紀錄（`fr_idempotency_keys`）
 * 會留低，等佢哋按 TTL 過期（store key 係 hash，認唔出邊條係 benchmark 嘅）。
 *
 * - 同一個 process 起真 app（`createApplication`，HTTP、認證、權限、idempotency 全部照行），每 IP 嘅 request
 *   limiter 調高，因為所有虛擬用戶都由 127.0.0.1 發出。背景工作全部關閉，唔影響量度。
 * - `--users` 個虛擬用戶各自循環：揀一個操作（見 MIX）、等回應、再等 0..think-ms 隨機時間。即係「同時在線」，唔係
 *   每秒固定請求數。暖身期嘅結果唔計。`--only=forSku` 只跑名以 forSku 開頭嘅操作（SKU-008 嘅最差情況）。
 *   `--general-limit-ms` 係一般操作（NFR-001）嘅 p95 上限，預設 2 秒；匯入期間嘅負載用 5 秒（HD-158）。
 * - for-SKU 操作要 seed 嘅 `PERF-SKU-*`（seedSupplierPerformanceFixtures.js）；app 會好似 src/index.js 咁註冊
 *   `supplierCoreProvider`，連線池用設定檔嘅預設（正式環境一樣）。
 * - 每個操作記 p50／p95／p99、錯誤率；另外記 process CPU、RSS、DB 連線數。負載產生器同 app 喺同一個 process，
 *   所以 CPU 係兩者加埋。
 * - 量度開始同結束各讀一次 performance_schema 嘅 statement digest（要 DB_ADMIN_USER）再相減，攞量度期間最多時間
 *   嘅 SQL 同佢哋嘅 EXPLAIN：證明用咗邊個 index、掃咗幾多行，而唔係靠估。唔清空成個 server 嘅統計。
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

import { createApplication } from "../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../src/framework/configuration/applicationConfiguration.js";
import { discoverServiceDefinitions } from "../src/framework/services/serviceDiscovery.js";

const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (found) return found.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
};
const USERS = Number(arg("users", 50));
const SECONDS = Number(arg("seconds", 120));
const WARMUP_SECONDS = Number(arg("warmup-seconds", 20));
const THINK_MS = Number(arg("think-ms", 1000));
const OUTPUT = arg("output", null);
const ONLY = arg("only", "");
const GENERAL_LIMIT_MS = Number(arg("general-limit-ms", 2000));
const WARNING_LINES = 200;
if (![USERS, SECONDS, WARMUP_SECONDS, THINK_MS, GENERAL_LIMIT_MS].every(Number.isSafeInteger) || USERS < 1 || SECONDS < 1 || WARMUP_SECONDS < 0 ||
    THINK_MS < 0 || GENERAL_LIMIT_MS < 1 || typeof OUTPUT !== "string") {
  throw new Error("usage: node scripts/benchmarkSupplierManagement.js --database=<DB_NAME> --output <report.json> [--users=50] [--seconds=120] [--warmup-seconds=20] [--think-ms=1000] [--only=<operation prefix>] [--general-limit-ms=2000]");
}
const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_ADMIN_USER", "DB_ADMIN_PASSWORD"]
  .filter((key) => (key.endsWith("PASSWORD") ? process.env[key] === undefined : !process.env[key]));
if (missing.length > 0) throw new Error(`set ${missing.join(", ")} explicitly to a throwaway database`);
if (arg("database", null) !== process.env.DB_NAME) {
  throw new Error(`--database must repeat DB_NAME (${process.env.DB_NAME}) to confirm it is a throwaway database`);
}
fs.appendFileSync(OUTPUT, "");

/**
 * 操作同比重。原本嘅 12 個加埋 100：讀為主，寫入約一成，似日常採購／會計用法。for-SKU（TASK-040）另加 11，
 * 令原本操作之間嘅比例同之前嘅報告一樣；熱門 SKU 嘅名稱搜尋同 head 之後嘅深頁都包埋（REV-087 M-1、REV-089 M-2）。
 */
const ALL_OPERATIONS = [
  ["list.default", 20], ["list.codeExact", 15], ["list.nameSearch", 12], ["list.statusFilter", 8], ["list.currencyFilter", 5],
  ["list.sortByName", 5], ["detail", 15], ["detail.heavy", 3], ["bank.list", 5], ["duplicates.check", 4], ["create", 4], ["update", 4],
  ["forSku.typical", 3], ["forSku.cold", 1], ["forSku.hot", 2], ["forSku.codeExact", 2], ["forSku.nameSearch", 2], ["forSku.deepPage", 1],
  // HD-107：識別號搜尋、缺資料篩選同建立日期範圍。缺資料嘅結果可能好少，要掃晒先知，係最差情況。
  ["list.identifierSearch", 3], ["list.missingFilter", 3], ["list.createdRange", 2]
];
const MIX = ALL_OPERATIONS.filter(([name]) => name.startsWith(ONLY));
if (MIX.length === 0) throw new Error(`--only=${ONLY} matches no operation`);
const NAME_TERMS = ["Pacific", "Trading", "Golden Dragon", "Harbour", "Electronics", "貿易", "有限公司", "華興", "Kowloon", "Packaging"];
const percentile = (sorted, fraction) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]);
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const work = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-perf-"));
const RUN = randomBytes(3).toString("hex").toUpperCase();
const report = { run: RUN, command: process.argv.slice(1).join(" "), startedAt: new Date().toISOString(),
  load: { users: USERS, seconds: SECONDS, warmupSeconds: WARMUP_SECONDS, thinkMs: `uniform 0..${THINK_MS}`, mix: Object.fromEntries(MIX) } };
const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_ADMIN_USER,
  password: process.env.DB_ADMIN_PASSWORD, database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET_PATH || undefined });
const created = { roleId: null, userId: null };
let application;
try {
  const [[data]] = await admin.query(`SELECT COUNT(*) AS suppliers, SUM(status = 'active') AS active,
    (SELECT COUNT(*) FROM supplier_addresses) AS addresses, (SELECT COUNT(*) FROM supplier_contacts) AS contacts,
    (SELECT COUNT(*) FROM supplier_identifiers) AS identifiers, (SELECT COUNT(*) FROM supplier_bank_accounts) AS bankAccounts,
    (SELECT COUNT(*) FROM supplier_name_grams) AS nameGrams FROM suppliers`);
  report.data = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Number(value)]));
  if (report.data.suppliers < 1_000) throw new Error("seed the database first (scripts/seedSupplierPerformanceFixtures.js)");
  const [ids] = await admin.query("SELECT id, supplier_code, status FROM suppliers WHERE supplier_code_key LIKE 'p50-%' ORDER BY id");
  const [heavyRows] = await admin.query(
    "SELECT supplier_id AS id FROM supplier_contacts GROUP BY supplier_id HAVING COUNT(*) >= 50 ORDER BY supplier_id LIMIT 200");
  if (ids.length === 0 || heavyRows.length === 0) throw new Error("the seeded P50- Suppliers or their heavy subset are missing");
  const [skuRows] = await admin.query("SELECT id, sku_code FROM item_skus WHERE sku_code LIKE 'PERF-SKU-%' ORDER BY id");
  const hotSku = Number(skuRows.find((row) => row.sku_code === "PERF-SKU-HOT")?.id);
  const coldSku = Number(skuRows.find((row) => row.sku_code === "PERF-SKU-COLD")?.id);
  const spreadSkus = skuRows.filter((row) => /^PERF-SKU-\d{4}$/u.test(row.sku_code)).map((row) => Number(row.id));
  if (!hotSku || !coldSku || spreadSkus.length === 0) throw new Error("the seeded PERF-SKU-* fixtures for the for-SKU lookup are missing");
  // 深頁要喺 head（有排序理由嘅 Supplier）之後，先會行到最貴嘅 rest 讀法（REV-089 M-2）：用實際資料計頁數範圍，唔好寫死。
  const [[pages]] = await admin.query(`SELECT
      (SELECT COUNT(*) FROM supplier_sku_refs y JOIN suppliers s ON s.id = y.supplier_id AND s.status = 'active' WHERE y.sku_id = ?
        AND (y.relationship_status = 'preferred' OR (y.relationship_status <> 'stopped' AND y.last_supplied_at IS NOT NULL))) AS head,
      (SELECT COUNT(*) FROM suppliers WHERE status = 'active') AS active`, [hotSku]);
  const restPages = { first: Math.floor(Number(pages.head) / 20) + 2, last: Math.ceil(Number(pages.active) / 20) };
  report.data.hotSkuPages = { headRows: Number(pages.head), activeSuppliers: Number(pages.active), deepPageRange: [restPages.first, restPages.last] };
  const [[{ relations }]] = await admin.query("SELECT COUNT(*) AS relations FROM supplier_sku_refs");
  report.data.skuRelations = Number(relations);

  const nowMs = Date.now();
  const permissions = ["supplier.view", "supplier.mgmt", "supplier.bank.view"];
  const [role] = await admin.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`perf50-${RUN}`, nowMs]);
  created.roleId = Number(role.insertId);
  await admin.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)", [created.roleId, permissions]);
  const [user] = await admin.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', 'Perf', ?, ?)",
    [`perf50-${RUN}`, nowMs, nowMs]);
  created.userId = Number(user.insertId);
  await admin.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [created.userId, created.roleId]);

  // 只量 HTTP：背景工作全部關閉（tokenRevocation.refresh 係設定要求，保留）。
  const source = defaultConfigurationSource();
  const names = (await discoverServiceDefinitions()).flatMap((definition) => (definition.ServiceClass?.jobs ?? []).map((job) => job.name));
  application = await createApplication({ configurationSource: { ...source,
    application: { ...source.application, port: 0 },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100_000 },
    scheduler: { ...source.scheduler, jobs: Object.fromEntries(names.map((name) => [name,
      { ...(source.scheduler.jobs?.[name] ?? {}), enabled: name === "tokenRevocation.refresh" }])) },
    logging: { loggers: {
      request: { ...source.logging.loggers.request, directory: path.join(work, "requests") },
      system: { ...source.logging.loggers.system, directory: path.join(work, "system") } } } },
  // 同 src/index.js 一樣：for-SKU 經 supplierCoreProvider（依賴 businessMaster）。
  serviceDiscoveryOptions: { additionalModuleUrls: [
    new URL("../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
    new URL("../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href] } });
  const { url } = await application.start();
  const version = await application.services.require("tokenRevocation").currentVersion(String(created.userId));
  const token = await application.services.require("jwt").issue({ roles: [`perf50-${RUN}`], permissions },
    { subject: String(created.userId), version, authTime: Math.floor(nowMs / 1000) });
  const db = application.services.require("mysqldatabase");
  const [[mysqlInfo]] = await admin.query(`SELECT VERSION() AS version, @@innodb_buffer_pool_size AS bufferPoolBytes,
    @@innodb_flush_log_at_trx_commit AS innodbFlushLogAtTrxCommit, @@sync_binlog AS syncBinlog, @@max_connections AS maxConnections`);
  report.environment = { os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cpus: os.cpus().length,
    totalMemoryGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version,
    mysql: Object.fromEntries(Object.entries(mysqlInfo).map(([key, value]) => [key, key === "version" ? value : Number(value)])),
    database: { name: process.env.DB_NAME, host: process.env.DB_HOST, port: Number(process.env.DB_PORT), socketPath: process.env.DB_SOCKET_PATH || null },
    appPoolConnectionLimit: application.services.config.database?.connectionLimit ?? null,
    note: "the load generator and the app share one Node process" };

  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const get = (pathAndQuery) => fetch(`${url}${pathAndQuery}`, { headers });
  const post = (pathName, body) => fetch(`${url}${pathName}`, { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() },
    body: JSON.stringify(body) });
  const anyId = () => Number(ids[randomInt(ids.length)].id);
  let createdCount = 0;
  const operations = {
    "list.default": () => get("/api/v1/suppliers"),
    "list.codeExact": () => get(`/api/v1/suppliers?q=${encodeURIComponent(ids[randomInt(ids.length)].supplier_code)}`),
    "list.nameSearch": () => get(`/api/v1/suppliers?q=${encodeURIComponent(NAME_TERMS[randomInt(NAME_TERMS.length)])}`),
    "list.statusFilter": () => get(`/api/v1/suppliers?status=${["active", "suspended", "draft"][randomInt(3)]}&page=${randomInt(1, 6)}`),
    "list.currencyFilter": () => get(`/api/v1/suppliers?currencyCode=${["HKD", "USD", "CNY", "EUR"][randomInt(4)]}&pageSize=50`),
    "list.sortByName": () => get(`/api/v1/suppliers?sortBy=supplierName&descending=false&page=${randomInt(1, 6)}`),
    "list.identifierSearch": () => get(`/api/v1/suppliers?q=${encodeURIComponent(`BR${ids[randomInt(ids.length)].id}`.slice(0, 6))}`),
    "list.missingFilter": () => get(`/api/v1/suppliers?${["missingPrimaryContact", "missingAddress", "missingBank"][randomInt(3)]}=true&page=${randomInt(1, 6)}`),
    "list.createdRange": () => {
      const from = Date.now() - randomInt(3 * 365) * 86_400_000;
      return get(`/api/v1/suppliers?createdFrom=${from}&createdTo=${from + 30 * 86_400_000}&page=${randomInt(1, 4)}`);
    },
    detail: () => get(`/api/v1/suppliers/${anyId()}`),
    "detail.heavy": () => get(`/api/v1/suppliers/${heavyRows[randomInt(heavyRows.length)].id}`),
    "bank.list": () => get(`/api/v1/suppliers/${anyId()}/bank-accounts`),
    "duplicates.check": () => post("/api/v1/suppliers/duplicates/check",
      { supplierCode: `P50W-${RUN}-CHK`, supplierName: `${NAME_TERMS[randomInt(NAME_TERMS.length)]} Trading Co., Ltd.` }),
    create: () => {
      createdCount += 1;
      return post("/api/v1/suppliers/create", { supplierCode: `P50W-${RUN}-${createdCount}`,
        supplierName: `Golden Pacific Trading ${RUN} ${createdCount} Limited`, defaultCurrencyCode: "HKD" });
    },
    "forSku.typical": () => get(`/api/v1/supplier-lookups/for-sku/${spreadSkus[randomInt(spreadSkus.length)]}`),
    "forSku.hot": () => get(`/api/v1/supplier-lookups/for-sku/${hotSku}`),
    "forSku.codeExact": () => get(`/api/v1/supplier-lookups/for-sku/${hotSku}?q=${encodeURIComponent(ids[randomInt(ids.length)].supplier_code)}`),
    "forSku.nameSearch": () => get(`/api/v1/supplier-lookups/for-sku/${hotSku}?q=${encodeURIComponent(NAME_TERMS[randomInt(NAME_TERMS.length)])}`),
    "forSku.cold": () => get(`/api/v1/supplier-lookups/for-sku/${coldSku}?page=${randomInt(1, restPages.last + 1)}`),
    "forSku.deepPage": () => get(`/api/v1/supplier-lookups/for-sku/${hotSku}?page=${randomInt(restPages.first, restPages.last + 1)}`),
    // 每個虛擬用戶改自己嗰份 Supplier（id ≡ 用戶號 mod USERS），避免版本衝突；先讀版本再寫，兩步一齊計時。
    update: async (userNumber) => {
      // 封存咗嘅 Supplier 唔可以改（409），只揀改得嘅狀態。
      const mine = ids.filter((row, index) => index % USERS === userNumber && ["active", "draft", "suspended"].includes(row.status));
      const id = Number(mine[randomInt(mine.length)].id);
      const detail = await get(`/api/v1/suppliers/${id}`);
      const body = await detail.json();
      if (detail.status !== 200) return detail;
      const s = body.data ?? body;
      return post(`/api/v1/suppliers/${id}/update`, { supplierName: s.supplierName, displayName: s.displayName,
        defaultCurrencyCode: s.defaultCurrencyCode, defaultPaymentTermId: s.defaultPaymentTermId ?? null, website: s.website,
        generalPhone: s.generalPhone, generalEmail: s.generalEmail, notes: `perf ${RUN} ${Date.now()}`, version: s.version });
    }
  };
  const weighted = MIX.flatMap(([name, weight]) => Array(weight).fill(name));
  const samples = Object.fromEntries(MIX.map(([name]) => [name, { ms: [], errors: 0, statuses: {} }]));

  // Digest 統計係成個 server 共用嘅：唔清空，喺量度開始同結束各讀一次再相減（REV-083 L-5），暖身期亦唔計。
  const readDigests = async () => new Map((await admin.query(`SELECT DIGEST AS id, DIGEST_TEXT AS digest, QUERY_SAMPLE_TEXT AS sample,
      COUNT_STAR AS count, SUM_TIMER_WAIT AS wait, MAX_TIMER_WAIT AS maxWait, SUM_ROWS_EXAMINED AS rowsExamined, SUM_ROWS_SENT AS rowsSent,
      SUM_NO_INDEX_USED AS noIndexUsed
     FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME = ? AND DIGEST_TEXT LIKE 'SELECT%'`,
  [process.env.DB_NAME]))[0].map((row) => [row.id, row]));
  const startedAt = Date.now();
  const measureFrom = startedAt + WARMUP_SECONDS * 1000;
  const endAt = measureFrom + SECONDS * 1000;
  // 量度窗口（HD-122 A）：報告記低，亦即刻印一行，等同時跑嘅工具（例如匯入）可以喺量度開始之後先起步。
  report.window = { measureFrom: new Date(measureFrom).toISOString(), measureTo: new Date(endAt).toISOString() };
  console.log(JSON.stringify({ event: "supplier.benchmark.window", ...report.window }));
  // Digest 表滿咗嘅話，新 SQL 唔會有自己一行：用 Performance_schema_digest_lost 喺量度期間嘅增加量講明（REV-089 L-3）。
  const digestLost = async () => Number((await admin.query("SHOW GLOBAL STATUS LIKE 'Performance_schema_digest_lost'"))[0][0]?.Value ?? 0);
  const digestsAtStart = sleep(WARMUP_SECONDS * 1000).then(async () => ({ digests: await readDigests(), lost: await digestLost() }));
  // 等到量度完先 await：先掛個 handler，讀唔到都唔好令 process 即刻死、跳過清理（REV-084 L-2）。下面 await 時照樣拋。
  digestsAtStart.catch(() => {});
  const resources = { cpuPercent: [], rssMiB: [], dbThreadsConnected: [] };
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  const sampler = (async () => {
    while (Date.now() < endAt) {
      await sleep(1000);
      if (Date.now() < measureFrom) { lastCpu = process.cpuUsage(); lastAt = performance.now(); continue; }
      const cpu = process.cpuUsage(lastCpu);
      const elapsed = performance.now() - lastAt;
      lastCpu = process.cpuUsage();
      lastAt = performance.now();
      resources.cpuPercent.push(Math.round(((cpu.user + cpu.system) / 1000 / elapsed) * 100));
      resources.rssMiB.push(Math.round(process.memoryUsage().rss / 2 ** 20));
      const [[threads]] = await admin.query("SHOW GLOBAL STATUS LIKE 'Threads_connected'");
      resources.dbThreadsConnected.push(Number(threads.Value));
    }
  })();
  await Promise.all(Array.from({ length: USERS }, async (_, userNumber) => {
    while (Date.now() < endAt) {
      const name = weighted[randomInt(weighted.length)];
      const begun = performance.now();
      let status;
      try {
        const response = await operations[name](userNumber);
        status = response.status;
        await response.arrayBuffer().catch(() => {});
      } catch (error) {
        status = `error:${error.code ?? error.name}`;
      }
      const ms = performance.now() - begun;
      if (Date.now() >= measureFrom && Date.now() <= endAt) {
        samples[name].ms.push(ms);
        samples[name].statuses[status] = (samples[name].statuses[status] ?? 0) + 1;
        if (typeof status !== "number" || status >= 400) samples[name].errors += 1;
      }
      if (THINK_MS > 0) await sleep(randomInt(THINK_MS + 1));
    }
  }));
  await sampler;

  const summarize = (ms, errors) => {
    const sorted = [...ms].sort((a, b) => a - b);
    return { count: sorted.length, p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? null), errorRate: sorted.length === 0 ? null : Math.round((errors / sorted.length) * 10_000) / 10_000 };
  };
  report.operations = Object.fromEntries(MIX.map(([name]) => [name, { ...summarize(samples[name].ms, samples[name].errors),
    statuses: samples[name].statuses }]));
  const allMs = MIX.flatMap(([name]) => samples[name].ms);
  const allErrors = MIX.reduce((sum, [name]) => sum + samples[name].errors, 0);
  report.overall = { ...summarize(allMs, allErrors), throughputPerSecond: Math.round(allMs.length / SECONDS) };
  const stats = (values) => ({ avg: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null, max: values.length ? Math.max(...values) : null });
  report.resources = { processCpuPercent: stats(resources.cpuPercent), rssMiB: stats(resources.rssMiB), dbThreadsConnected: stats(resources.dbThreadsConnected) };

  // 量度期間最多時間嘅 SQL（只計呢個 schema），連 EXPLAIN。maxMs 係 server 上次清空 digest 以嚟嘅最大值，可能包括之前嘅 run。
  const { digests: before, lost: lostAtStart } = await digestsAtStart;
  const digests = [...(await readDigests()).values()].map((row) => {
    const start = before.get(row.id);
    const minus = (field) => Number(row[field]) - Number(start?.[field] ?? 0);
    return { digest: row.digest, sample: row.sample, count: minus("count"), totalMs: Math.round(minus("wait") / 1e8) / 10,
      maxMs: Math.round(Number(row.maxWait) / 1e8) / 10, rowsExamined: minus("rowsExamined"), rowsSent: minus("rowsSent"), noIndexUsed: minus("noIndexUsed") };
  }).filter((row) => row.count > 0).sort((left, right) => right.totalMs - left.totalMs).slice(0, 12)
    .map((row) => ({ ...row, avgMs: Math.round((row.totalMs / row.count) * 100) / 100 }));
  const [[digestTable]] = await admin.query(`SELECT COUNT(*) AS used, @@performance_schema_digests_size AS size
    FROM performance_schema.events_statements_summary_by_digest`);
  report.digestTable = { used: Number(digestTable.used), size: Number(digestTable.size), lostDuringRun: (await digestLost()) - lostAtStart };
  if (report.digestTable.lostDuringRun > 0) {
    report.digestTable.note = "performance_schema digest table was full during the run; those statements are not attributed, so topStatements is incomplete";
  }
  report.topStatements = [];
  for (const row of digests) {
    let plan = null;
    if (row.sample && !row.sample.endsWith("...")) {
      try {
        plan = (await admin.query(`EXPLAIN FORMAT=TRADITIONAL ${row.sample}`))[0].map((step) => ({ table: step.table, type: step.type, key: step.key,
          rows: Number(step.rows), filtered: Number(step.filtered), extra: step.Extra }));
      } catch (error) {
        plan = `EXPLAIN failed: ${error.code ?? error.message}`;
      }
    }
    // 完整 digest（HD-122 A）：截短咗就睇唔到排喺後面嘅 LIKE，文字搜尋嘅掃描就會被當成意外。
    report.topStatements.push({ digest: row.digest, count: Number(row.count), totalMs: Number(row.totalMs),
      avgMs: Number(row.avgMs), maxMs: Number(row.maxMs), rowsExaminedPerCall: Math.round(Number(row.rowsExamined) / Number(row.count)),
      rowsSentPerCall: Math.round(Number(row.rowsSent) / Number(row.count)), noIndexUsed: Number(row.noIndexUsed), plan });
  }
  // NFR-001（一般操作）同 NFR-005（for-SKU 揀選器）各自只計自己嗰類操作；冇跑過就記 null，唔當通過（REV-089 M-1）。
  // NFR-005 嘅上限係 3 秒（HD-157），NFR-001 係 2 秒；匯入期間一般操作 5 秒（HD-158，用 --general-limit-ms 傳入）。
  const verdict = (pick, limitP95Ms) => {
    const names = MIX.map(([name]) => name).filter(pick);
    if (names.length === 0) return null;
    const failing = names.filter((name) => { const value = report.operations[name]; return value.p95 === null || value.p95 >= limitP95Ms || value.errorRate > 0.01; });
    return { limitP95Ms, maxErrorRate: 0.01, operations: names.length, failing, pass: failing.length === 0 };
  };
  report.nfr001 = verdict((name) => !name.startsWith("forSku"), GENERAL_LIMIT_MS);
  report.nfr005 = verdict((name) => name.startsWith("forSku"), 3000);
  const verdicts = [report.nfr001, report.nfr005].filter(Boolean);
  report.ok = verdicts.length > 0 && verdicts.every((item) => item.pass);
  void db;
} catch (error) {
  report.ok = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  try {
    const [made] = await admin.query("SELECT id FROM suppliers WHERE supplier_code_key LIKE ?", [`p50w-${RUN.toLowerCase()}-%`]);
    const madeIds = made.map((row) => row.id);
    if (madeIds.length > 0) {
      for (const table of ["supplier_name_grams", "supplier_audit_logs"]) await admin.query(`DELETE FROM ${table} WHERE supplier_id IN (?)`, [madeIds]);
      await admin.query("DELETE FROM suppliers WHERE id IN (?)", [madeIds]);
    }
    report.cleanup = { createdSuppliers: madeIds.length };
    if (created.userId) {
      await admin.query("DELETE FROM supplier_audit_logs WHERE actor_user_id = ?", [created.userId]);
      await admin.query("DELETE FROM user_roles WHERE user_id = ?", [created.userId]);
      await admin.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(created.userId)]).catch(() => {});
      await admin.query("DELETE FROM users WHERE id = ?", [created.userId]);
    }
    if (created.roleId) {
      await admin.query("DELETE FROM role_permissions WHERE role_id = ?", [created.roleId]);
      await admin.query("DELETE FROM roles WHERE id = ?", [created.roleId]);
    }
  } catch (error) {
    report.ok = false;
    report.cleanupError = error.message;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  await application?.shutdown("supplier-performance").catch(() => {});
  await admin.end();
  // Server 嘅 warn／error 留喺報告隔籬（DEF-048）：之前成個目錄連 log 一齊剷，500 嘅原因就冇得查。
  // 最多留 200 行（error 行連 stack 每行幾 KB）再寫總數；repository 路徑換成 $REPO，咁先可以直接 commit 做證據（REV-133 O2）。
  const systemLog = path.join(work, "system");
  const lines = [];
  if (fs.existsSync(systemLog)) {
    for (const name of fs.readdirSync(systemLog).sort()) {
      lines.push(...fs.readFileSync(path.join(systemLog, name), "utf8").split("\n").filter((line) => /"level":"(warn|error)"/u.test(line)));
    }
  }
  const repo = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/u, "");
  const kept = lines.slice(0, WARNING_LINES).map((line) => line.split(repo).join("$REPO"));
  if (lines.length > WARNING_LINES) kept.push(`… ${lines.length - WARNING_LINES} more warn/error lines not kept (${lines.length} in all)`);
  fs.writeFileSync(`${OUTPUT}.warnings.log`, kept.length ? `${kept.join("\n")}\n` : "");
  fs.rmSync(work, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: report.ok, overall: report.overall, nfr001: report.nfr001, nfr005: report.nfr005, error: report.error }, null, 2));
}

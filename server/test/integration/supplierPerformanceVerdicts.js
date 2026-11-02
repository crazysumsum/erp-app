import { checklist } from "./supplierAcceptanceRunner.js";

/**
 * `runSupplierPerformanceAcceptance.js` 嘅判斷（HD-117 A）：只睇 T50 工具嘅報告同總數，唔郁 DB，所以單元測試可以逐項
 * 改壞份報告，證明每一項都會唔過。每個 run 係 `{ code, report }`（工具嘅 exit code 同佢寫嘅 JSON）。
 */
export const LIMIT_MS = 2_000;
// NFR-005（for-SKU 揀選器）：3 秒（HD-157，2026-10-30）。
export const FOR_SKU_LIMIT_MS = 3_000;
// 10,000 列匯入期間嘅線上一般操作（TC-101、IMP-016、NFR-004）：5 秒（HD-158，2026-10-30）。
export const DURING_IMPORT_LIMIT_MS = 5_000;
export const CANDIDATE_CAP = 3_000;
// 資源上限（OPS-001、IMP-016「bounded」）：一個 app 嘅連線池（config/database.js 嘅 10）加 benchmark 自己嘅 admin 連線；
// 匯入期間有三個 app process（負載、上載、worker）。RSS 以 1 GiB 為界。
export const POOL = 10;
export const RSS_LIMIT_MIB = 1_024;

const p95 = (report, name) => report?.operations?.[name]?.p95 ?? null;

/** 查詢計劃要有得睇：digest 表滿咗或者冇記錄，就唔可以話「冇全表掃描」（空集合唔算證據）。 */
export const plansSeen = (report) => (report?.topStatements?.length ?? 0) > 0 && !(report?.digestTable?.lostDuringRun > 0);

/**
 * 有冇真 table 嘅全表掃描：`<derived2>`、`<union2,3>` 呢類係 MySQL 自己嘅臨時結果，唔係掃 table；文字搜尋（LIKE）
 * 係 HD-088 決定嘅掃描，唔計。
 */
export function fullScans(report) {
  return (report?.topStatements ?? []).filter((row) => Array.isArray(row.plan) && row.plan.some((step) => step.type === "ALL"
    && !String(step.table).startsWith("<") && !likeTables(row.digest).has(step.table))).map((row) => row.digest.slice(0, 160));
}

/**
 * HD-088 豁免只限文字搜尋本身掃嘅 table（REV-112 L-3）：`alias`.`col` LIKE 嘅 alias；冇 qualifier 嘅 LIKE 就係冇 alias 嘅
 * FROM／JOIN table。同一句入面另一張 table 全表掃描照計。
 */
export function likeTables(digest) {
  const tables = new Set([...String(digest).matchAll(/`(\w+)` \. `\w+` LIKE\b/gu)].map((match) => match[1]));
  if (/(?<!` \. )`\w+` LIKE\b/u.test(String(digest))) {
    for (const match of String(digest).matchAll(/\b(?:FROM|JOIN) `(\w+)`(?! `)/gu)) tables.add(match[1]);
  }
  return tables;
}

/**
 * 睇唔到計劃嘅 statement（sample 被截斷或者 EXPLAIN 失敗）而佢又有冇用 index 嘅執行，就唔可以當冇問題（REV-111 H-1）。
 */
export function unverifiedPlans(report) {
  return (report?.topStatements ?? []).filter((row) => !Array.isArray(row.plan) && Number(row.noIndexUsed) > 0)
    .map((row) => ({ digest: row.digest.slice(0, 160), calls: row.count, noIndexUsed: row.noIndexUsed, plan: row.plan }));
}

const planDetail = (report) => ({ statements: report?.topStatements?.length ?? 0, digestTable: report?.digestTable,
  scans: fullScans(report), unverified: unverifiedPlans(report) });
const plansClean = (report) => plansSeen(report) && fullScans(report).length === 0 && unverifiedPlans(report).length === 0;

export function performanceVerdicts({ mixed, forSku, recall, imported, during, counted }) {
  const verdicts = {};

  const tc128 = checklist();
  tc128.check("load.completed", mixed.code === 0 && mixed.report?.ok === true && !mixed.report?.error, { code: mixed.code, error: mixed.report?.error });
  tc128.check("load.list_and_exact_code_p95_under_2s", ["list.default", "list.codeExact"]
    .every((name) => p95(mixed.report, name) !== null && p95(mixed.report, name) < LIMIT_MS),
  { listDefault: p95(mixed.report, "list.default"), codeExact: p95(mixed.report, "list.codeExact") });
  tc128.check("load.every_general_operation_within_limits", mixed.report?.nfr001?.pass === true
    && mixed.report.nfr001.limitP95Ms === LIMIT_MS, mixed.report?.nfr001);
  const resources = mixed.report?.resources;
  tc128.check("load.resources_bounded", Number.isFinite(resources?.dbThreadsConnected?.max) && resources.dbThreadsConnected.max <= POOL + 3
    && Number.isFinite(resources?.rssMiB?.max) && resources.rssMiB.max <= RSS_LIMIT_MIB, resources);
  verdicts["TC-128"] = tc128.checks;

  const tc085 = checklist();
  tc085.check("for_sku.completed", forSku.code === 0 && forSku.report?.ok === true, { code: forSku.code, error: forSku.report?.error });
  tc085.check("for_sku.p95_under_3s", forSku.report?.nfr005?.pass === true && forSku.report.nfr005.limitP95Ms === FOR_SKU_LIMIT_MS,
    forSku.report?.nfr005);
  tc085.check("for_sku.count_not_inflated", counted.forSku.status === 200 && counted.forSku.api === counted.forSku.sql, counted.forSku);
  tc085.check("for_sku.no_full_scan", forSku.code === 0 && plansClean(forSku.report), planDetail(forSku.report));
  verdicts["TC-085"] = tc085.checks;

  const tc129 = checklist();
  const capped = recall.report?.variants?.capped;
  const uncapped = recall.report?.variants?.uncapped;
  // 「有上限」要睇得出：最少快 5 倍（T50：93 對 950 ms），而且喺 2 秒內。
  tc129.check("duplicates.bounded_by_the_candidate_cap", recall.code === 0 && capped?.candidateCap === CANDIDATE_CAP
    && Number.isFinite(uncapped?.p95Ms) && capped.p95Ms * 5 <= uncapped.p95Ms && capped.p95Ms < LIMIT_MS, { capped, uncapped });
  tc129.check("duplicates.recall_within_two_points", capped !== undefined && uncapped !== undefined && uncapped.recall - capped.recall <= 0.02,
    { capped: capped?.recall, uncapped: uncapped?.recall });
  tc129.check("duplicates.check_p95_under_2s", mixed.code === 0 && p95(mixed.report, "duplicates.check") !== null
    && p95(mixed.report, "duplicates.check") < LIMIT_MS, { p95: p95(mixed.report, "duplicates.check") });
  tc129.check("plans.no_full_scan_outside_text_search", mixed.code === 0 && plansClean(mixed.report), planDetail(mixed.report));
  // 一個每個 Supplier 有兩個識別號都中嘅搜尋：JOIN 會數兩次（`joined` > `distinct`），API 嘅總數要等於 distinct。
  const search = counted.listSearch;
  tc129.check("list.count_not_inflated", search?.status === 200 && search.api === search.distinct && search.joined > search.distinct, search);
  verdicts["TC-129"] = tc129.checks;

  const tc101 = checklist();
  tc101.check("import.within_10_minutes", imported.report?.nfr004?.pass === true, imported.report?.nfr004);
  tc101.check("import.exactly_once_and_counts_consistent", imported.report?.verification?.exactlyOnce === true
    && imported.report?.verification?.countsConsistent === true, imported.report?.verification);
  tc101.check("import.report_ok", imported.code === 0 && imported.report?.ok === true, { code: imported.code, error: imported.report?.error });
  tc101.check("online.p95_under_5s_during_import", during.code === 0 && during.report?.nfr001?.pass === true
    && during.report.nfr001.limitP95Ms === DURING_IMPORT_LIMIT_MS, during.report?.nfr001);
  // 匯入要喺負載嘅量度窗口入面（REV-111 M-4）：由上載開始，到執行完（上載＋預檢＋執行嘅時間），唔計之後嘅核對同匯出。
  const window = during.report?.window;
  const importStart = Date.parse(imported.report?.startedAt ?? "");
  const importEnd = importStart + Number(imported.report?.uploadMs ?? NaN) + Number(imported.report?.precheck?.ms ?? NaN)
    + Number(imported.report?.execute?.ms ?? NaN);
  tc101.check("import.inside_measured_window", Number.isFinite(importEnd) && importStart >= Date.parse(window?.measureFrom ?? "")
    && importEnd <= Date.parse(window?.measureTo ?? ""), { window, importStart: imported.report?.startedAt,
    importEnd: Number.isFinite(importEnd) ? new Date(importEnd).toISOString() : null });
  const connections = imported.report?.dbConnectionsPeak?.userConnections;
  tc101.check("import.resources_bounded", Number.isFinite(connections) && connections <= 3 * POOL + 3
    && Number.isFinite(imported.report?.workerPeakRssMiB) && imported.report.workerPeakRssMiB <= RSS_LIMIT_MIB,
  { dbConnections: connections, workerPeakRssMiB: imported.report?.workerPeakRssMiB });
  verdicts["TC-101"] = tc101.checks;

  return verdicts;
}

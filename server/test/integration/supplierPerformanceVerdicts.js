import { checklist } from "./supplierAcceptanceRunner.js";

/**
 * `runSupplierPerformanceAcceptance.js` 嘅判斷（HD-117 A）：只睇 T50 工具嘅報告同總數，唔郁 DB，所以單元測試可以逐項
 * 改壞份報告，證明每一項都會唔過。每個 run 係 `{ code, report }`（工具嘅 exit code 同佢寫嘅 JSON）。
 */
export const LIMIT_MS = 2_000;
export const CANDIDATE_CAP = 3_000;

const p95 = (report, name) => report?.operations?.[name]?.p95 ?? null;

/** 查詢計劃要有得睇：digest 表滿咗或者冇記錄，就唔可以話「冇全表掃描」（空集合唔算證據）。 */
export const plansSeen = (report) => (report?.topStatements?.length ?? 0) > 0 && !(report?.digestTable?.lostDuringRun > 0);

/**
 * 有冇真 table 嘅全表掃描：`<derived2>`、`<union2,3>` 呢類係 MySQL 自己嘅臨時結果，唔係掃 table；文字搜尋（LIKE）
 * 係 HD-088 決定嘅掃描，唔計。
 */
export function fullScans(report) {
  return (report?.topStatements ?? []).filter((row) => !/\bLIKE\b/iu.test(row.digest) && Array.isArray(row.plan)
    && row.plan.some((step) => step.type === "ALL" && !String(step.table).startsWith("<"))).map((row) => row.digest.slice(0, 160));
}

export function performanceVerdicts({ mixed, forSku, recall, imported, during, counted }) {
  const verdicts = {};

  const tc128 = checklist();
  tc128.check("load.completed", mixed.code === 0 && mixed.report?.ok === true && !mixed.report?.error, { code: mixed.code, error: mixed.report?.error });
  tc128.check("load.list_and_exact_code_p95_under_2s", ["list.default", "list.codeExact"]
    .every((name) => p95(mixed.report, name) !== null && p95(mixed.report, name) < LIMIT_MS),
  { listDefault: p95(mixed.report, "list.default"), codeExact: p95(mixed.report, "list.codeExact") });
  tc128.check("load.every_general_operation_within_limits", mixed.report?.nfr001?.pass === true, mixed.report?.nfr001);
  tc128.check("load.resources_recorded", Boolean(mixed.report?.resources?.dbThreadsConnected?.max), mixed.report?.resources);
  verdicts["TC-128"] = tc128.checks;

  const tc085 = checklist();
  tc085.check("for_sku.completed", forSku.code === 0 && forSku.report?.ok === true, { code: forSku.code, error: forSku.report?.error });
  tc085.check("for_sku.p95_under_2s", forSku.report?.nfr005?.pass === true, forSku.report?.nfr005);
  tc085.check("for_sku.count_not_inflated", counted.forSku.status === 200 && counted.forSku.api === counted.forSku.sql, counted.forSku);
  tc085.check("for_sku.no_full_scan", plansSeen(forSku.report) && fullScans(forSku.report).length === 0,
    { statements: forSku.report?.topStatements?.length ?? 0, digestTable: forSku.report?.digestTable, scans: fullScans(forSku.report) });
  verdicts["TC-085"] = tc085.checks;

  const tc129 = checklist();
  const capped = recall.report?.variants?.capped;
  const uncapped = recall.report?.variants?.uncapped;
  tc129.check("duplicates.bounded_by_the_candidate_cap", recall.code === 0 && capped?.candidateCap === CANDIDATE_CAP
    && capped.p95Ms < uncapped?.p95Ms && capped.p95Ms < LIMIT_MS, { capped, uncapped });
  tc129.check("duplicates.recall_within_two_points", capped !== undefined && uncapped !== undefined && uncapped.recall - capped.recall <= 0.02,
    { capped: capped?.recall, uncapped: uncapped?.recall });
  tc129.check("duplicates.check_p95_under_2s", p95(mixed.report, "duplicates.check") !== null && p95(mixed.report, "duplicates.check") < LIMIT_MS,
    { p95: p95(mixed.report, "duplicates.check") });
  tc129.check("plans.no_full_scan_outside_text_search", plansSeen(mixed.report) && fullScans(mixed.report).length === 0,
    { statements: mixed.report?.topStatements?.length ?? 0, digestTable: mixed.report?.digestTable, scans: fullScans(mixed.report) });
  tc129.check("list.count_not_inflated", counted.list.status === 200 && counted.list.api === counted.list.sql, counted.list);
  verdicts["TC-129"] = tc129.checks;

  const tc101 = checklist();
  tc101.check("import.within_10_minutes", imported.report?.nfr004?.pass === true, imported.report?.nfr004);
  tc101.check("import.exactly_once_and_counts_consistent", imported.report?.verification?.exactlyOnce === true
    && imported.report?.verification?.countsConsistent === true, imported.report?.verification);
  tc101.check("import.report_ok", imported.code === 0 && imported.report?.ok === true, { code: imported.code, error: imported.report?.error });
  tc101.check("online.p95_under_2s_during_import", during.code === 0 && during.report?.nfr001?.pass === true, during.report?.nfr001);
  verdicts["TC-101"] = tc101.checks;

  return verdicts;
}

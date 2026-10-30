import assert from "node:assert/strict";
import test from "node:test";

import { performanceVerdicts } from "./integration/supplierPerformanceVerdicts.js";

/** 同 T50 工具報告一樣形狀嘅最細一份「全部過」嘅輸入。每份報告有自己嘅 statements，改一份唔會連累另一份。 */
function passing() {
  const op = (p95) => ({ p50: p95 / 2, p95, p99: p95 * 1.2, errorRate: 0 });
  const verdict = (limitP95Ms = 2000) => ({ limitP95Ms, maxErrorRate: 0.01, operations: 1, failing: [], pass: true });
  const statements = () => [
    { digest: "SELECT COUNT ( * ) FROM `suppliers` WHERE `status` = ?", count: 900, noIndexUsed: 0,
      plan: [{ table: "suppliers", type: "ref", key: "idx_suppliers_status_updated_id", rows: 20 }, { table: "<derived2>", type: "ALL", key: null, rows: 31_594 }] },
    { digest: "SELECT `id` FROM `suppliers` WHERE `supplier_name` LIKE ?", count: 700, noIndexUsed: 700,
      plan: [{ table: "suppliers", type: "ALL", key: null, rows: 100_000 }] },
    { digest: "SELECT `s` . `id` FROM `suppliers` `s` WHERE `s` . `id` = ?", count: 300, noIndexUsed: 0, plan: null }
  ];
  const digestTable = () => ({ used: 900, size: 10_000, lostDuringRun: 0 });
  return {
    mixed: { code: 0, report: { ok: true, operations: { "list.default": op(66), "list.codeExact": op(248), "duplicates.check": op(127) }, nfr001: verdict(),
      resources: { dbThreadsConnected: { avg: 12, max: 12 }, rssMiB: { avg: 270, max: 336 } }, topStatements: statements(), digestTable: digestTable() } },
    forSku: { code: 0, report: { ok: true, nfr005: verdict(3000), topStatements: statements(), digestTable: digestTable() } },
    recall: { code: 0, report: { variants: { capped: { candidateCap: 3_000, recall: 0.966, p95Ms: 93 },
      uncapped: { candidateCap: Number.MAX_SAFE_INTEGER, recall: 0.977, p95Ms: 950 } } } },
    imported: { code: 0, report: { ok: true, startedAt: "2026-10-22T02:55:33.000Z", uploadMs: 900, precheck: { ms: 6_307 }, execute: { ms: 78_714 }, nfr004: { precheckPlusExecuteMs: 82_766, limitMs: 600_000, pass: true },
      verification: { exactlyOnce: true, countsConsistent: true }, dbConnectionsPeak: { userConnections: 16 }, workerPeakRssMiB: 253 } },
    during: { code: 0, report: { ok: true, nfr001: verdict(5000), window: { measureFrom: "2026-10-22T02:55:32.800Z", measureTo: "2026-10-22T02:57:32.800Z" } } },
    counted: { list: { api: 80_225, sql: 80_225, status: 200 }, listSearch: { term: "123", api: 452, distinct: 452, joined: 904, status: 200 },
      forSku: { api: 80_225, sql: 80_225, status: 200 } }
  };
}

const failing = (verdicts) => Object.values(verdicts).flat().filter(({ status }) => status === "FAIL").map(({ id }) => id);

test("HD-117 A: a passing set of T50 reports passes every performance check, LIKE scans, derived tables and indexed unseen plans included", () => {
  const verdicts = performanceVerdicts(passing());
  assert.deepEqual(failing(verdicts), []);
  assert.deepEqual(Object.keys(verdicts).sort(), ["TC-085", "TC-101", "TC-128", "TC-129"]);
  assert.equal(Object.values(verdicts).flat().length, 19);
});

test("HD-117 A: every condition of every performance check fails on its own broken input (REV-111 M-3)", () => {
  const cases = [
    ["load.completed", (input) => { input.mixed.code = 1; }],
    ["load.completed", (input) => { input.mixed.report.ok = false; }],
    ["load.list_and_exact_code_p95_under_2s", (input) => { input.mixed.report.operations["list.codeExact"].p95 = 2_000; }],
    ["load.list_and_exact_code_p95_under_2s", (input) => { delete input.mixed.report.operations["list.default"]; }],
    ["load.every_general_operation_within_limits", (input) => { input.mixed.report.nfr001.pass = false; }],
    // NFR-001 仍然係 2 秒：用 3 秒判斷嘅報告唔算（REV-139 L4）。
    ["load.every_general_operation_within_limits", (input) => { input.mixed.report.nfr001.limitP95Ms = 3000; }],
    ["load.resources_bounded", (input) => { input.mixed.report.resources.dbThreadsConnected.max = 14; }],
    ["load.resources_bounded", (input) => { input.mixed.report.resources.rssMiB.max = 1_025; }],
    ["load.resources_bounded", (input) => { delete input.mixed.report.resources; }],
    ["for_sku.completed", (input) => { input.forSku.code = 1; }],
    ["for_sku.completed", (input) => { input.forSku.report.ok = false; }],
    ["for_sku.p95_under_3s", (input) => { input.forSku.report.nfr005.pass = false; }],
    // 上限要係 HD-157 嘅 3 秒：寬鬆過佢嘅報告唔算。
    ["for_sku.p95_under_3s", (input) => { input.forSku.report.nfr005.limitP95Ms = 4000; }],
    ["for_sku.count_not_inflated", (input) => { input.counted.forSku.api = 100_225; }],
    ["for_sku.count_not_inflated", (input) => { input.counted.forSku.status = 500; }],
    ["for_sku.no_full_scan", (input) => { input.forSku.report.topStatements[0].plan[0].type = "ALL"; }],
    ["for_sku.no_full_scan", (input) => { input.forSku.report.topStatements = []; }],
    ["for_sku.no_full_scan", (input) => { input.forSku.report.digestTable.lostDuringRun = 1; }],
    ["for_sku.no_full_scan", (input) => { input.forSku.report.topStatements[2].noIndexUsed = 300; }],
    ["for_sku.no_full_scan", (input) => { input.forSku.report.topStatements[0].plan = "EXPLAIN failed: ER_PARSE_ERROR"; input.forSku.report.topStatements[0].noIndexUsed = 1; }],
    ["duplicates.bounded_by_the_candidate_cap", (input) => { input.recall.code = 1; }],
    ["duplicates.bounded_by_the_candidate_cap", (input) => { input.recall.report.variants.capped.candidateCap = Number.MAX_SAFE_INTEGER; }],
    ["duplicates.bounded_by_the_candidate_cap", (input) => { input.recall.report.variants.capped.p95Ms = 900; }],
    ["duplicates.bounded_by_the_candidate_cap", (input) => { input.recall.report.variants.capped.p95Ms = 2_000; input.recall.report.variants.uncapped.p95Ms = 20_000; }],
    ["duplicates.recall_within_two_points", (input) => { input.recall.report.variants.capped.recall = 0.95; }],
    ["duplicates.check_p95_under_2s", (input) => { input.mixed.report.operations["duplicates.check"].p95 = 2_400; }],
    ["duplicates.check_p95_under_2s", (input) => { input.mixed.code = 1; }],
    ["plans.no_full_scan_outside_text_search", (input) => { input.mixed.report.digestTable.lostDuringRun = 3; }],
    ["plans.no_full_scan_outside_text_search", (input) => { input.mixed.report.topStatements[0].plan[0].type = "ALL"; }],
    ["plans.no_full_scan_outside_text_search", (input) => { input.mixed.report.topStatements[2].noIndexUsed = 10; }],
    ["plans.no_full_scan_outside_text_search", (input) => { input.mixed.code = 1; }],
    // 文字搜尋句入面，LIKE 以外嘅 table 全表掃描唔豁免（REV-112 L-3）。
    ["plans.no_full_scan_outside_text_search", (input) => { input.mixed.report.topStatements[1].plan.push({ table: "contacts", type: "ALL", key: null, rows: 1_000_000 }); }],
    ["list.count_not_inflated", (input) => { input.counted.listSearch.api = 904; }],
    ["list.count_not_inflated", (input) => { input.counted.listSearch.joined = 452; }],
    ["list.count_not_inflated", (input) => { input.counted.listSearch.status = 500; }],
    ["import.within_10_minutes", (input) => { input.imported.report.nfr004.pass = false; }],
    ["import.exactly_once_and_counts_consistent", (input) => { input.imported.report.verification.exactlyOnce = false; }],
    ["import.exactly_once_and_counts_consistent", (input) => { input.imported.report.verification.countsConsistent = false; }],
    ["import.report_ok", (input) => { input.imported.code = 1; }],
    ["import.report_ok", (input) => { input.imported.report.ok = false; }],
    ["online.p95_under_5s_during_import", (input) => { input.during.report.nfr001.pass = false; }],
    ["online.p95_under_5s_during_import", (input) => { input.during.report.nfr001.limitP95Ms = 2000; }],
    ["online.p95_under_5s_during_import", (input) => { input.during.report.nfr001.limitP95Ms = 10_000; }],
    ["online.p95_under_5s_during_import", (input) => { input.during.code = 1; }],
    ["import.resources_bounded", (input) => { input.imported.report.dbConnectionsPeak.userConnections = 34; }],
    ["import.resources_bounded", (input) => { input.imported.report.workerPeakRssMiB = 1_025; }],
    ["import.inside_measured_window", (input) => { input.imported.report.startedAt = "2026-10-22T02:55:32.300Z"; }],
    ["import.inside_measured_window", (input) => { input.imported.report.execute.ms = 120_000; }],
    ["import.inside_measured_window", (input) => { delete input.during.report.window; }]
  ];
  for (const [id, breakIt] of cases) {
    const input = passing();
    breakIt(input);
    const failed = failing(performanceVerdicts(input));
    assert.ok(failed.includes(id), `${id} must fail: ${breakIt}`);
  }
});

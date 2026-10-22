import assert from "node:assert/strict";
import test from "node:test";

import { performanceVerdicts } from "./integration/supplierPerformanceVerdicts.js";

/** 同 T50 工具報告一樣形狀嘅最細一份「全部過」嘅輸入。 */
function passing() {
  const op = (p95) => ({ p50: p95 / 2, p95, p99: p95 * 1.2, errorRate: 0 });
  const verdict = { limitP95Ms: 2000, maxErrorRate: 0.01, operations: 1, failing: [], pass: true };
  const plan = (key) => [{ table: "suppliers", type: "ref", key, rows: 20 }, { table: "<derived2>", type: "ALL", key: null, rows: 31_594 }];
  const statements = [{ digest: "SELECT COUNT ( * ) FROM `suppliers` WHERE `status` = ?", plan: plan("idx_suppliers_status_updated_id") },
    { digest: "SELECT `id` FROM `suppliers` WHERE `supplier_name` LIKE ?", plan: [{ table: "suppliers", type: "ALL", key: null, rows: 100_000 }] }];
  const load = { ok: true, operations: { "list.default": op(66), "list.codeExact": op(248), "duplicates.check": op(127) }, nfr001: verdict,
    resources: { dbThreadsConnected: { avg: 12, max: 12 } }, topStatements: statements, digestTable: { used: 900, size: 10_000, lostDuringRun: 0 } };
  return {
    mixed: { code: 0, report: load },
    forSku: { code: 0, report: { ok: true, nfr005: verdict, topStatements: statements, digestTable: { used: 900, size: 10_000, lostDuringRun: 0 } } },
    recall: { code: 0, report: { variants: { capped: { candidateCap: 3_000, recall: 0.966, p95Ms: 93 },
      uncapped: { candidateCap: Number.MAX_SAFE_INTEGER, recall: 0.977, p95Ms: 950 } } } },
    imported: { code: 0, report: { ok: true, nfr004: { precheckPlusExecuteMs: 82_766, limitMs: 600_000, pass: true },
      verification: { exactlyOnce: true, countsConsistent: true } } },
    during: { code: 0, report: { ok: true, nfr001: verdict } },
    counted: { list: { api: 80_225, sql: 80_225, status: 200 }, forSku: { api: 80_225, sql: 80_225, status: 200 } }
  };
}

const failing = (verdicts) => Object.values(verdicts).flat().filter(({ status }) => status === "FAIL").map(({ id }) => id);

test("HD-117 A: a passing set of T50 reports passes every performance check, LIKE scans and derived tables included", () => {
  const verdicts = performanceVerdicts(passing());
  assert.deepEqual(failing(verdicts), []);
  assert.deepEqual(Object.keys(verdicts).sort(), ["TC-085", "TC-101", "TC-128", "TC-129"]);
  assert.equal(Object.values(verdicts).flat().length, 17);
});

test("HD-117 A: each performance check fails on its own broken input", () => {
  const cases = [
    ["load.completed", (input) => { input.mixed.code = 1; }],
    ["load.list_and_exact_code_p95_under_2s", (input) => { input.mixed.report.operations["list.codeExact"].p95 = 2_000; }],
    ["load.every_general_operation_within_limits", (input) => { input.mixed.report.nfr001 = { ...input.mixed.report.nfr001, pass: false }; }],
    ["load.resources_recorded", (input) => { delete input.mixed.report.resources; }],
    ["for_sku.completed", (input) => { input.forSku.report.ok = false; }],
    ["for_sku.p95_under_2s", (input) => { input.forSku.report.nfr005 = { ...input.forSku.report.nfr005, pass: false }; }],
    ["for_sku.count_not_inflated", (input) => { input.counted.forSku.api = 100_225; }],
    ["for_sku.no_full_scan", (input) => { input.forSku.report.topStatements[0].plan[0].type = "ALL"; }],
    ["for_sku.no_full_scan", (input) => { input.forSku.report.topStatements = []; }],
    ["duplicates.bounded_by_the_candidate_cap", (input) => { input.recall.report.variants.capped.candidateCap = Number.MAX_SAFE_INTEGER; }],
    ["duplicates.recall_within_two_points", (input) => { input.recall.report.variants.capped.recall = 0.95; }],
    ["duplicates.check_p95_under_2s", (input) => { input.mixed.report.operations["duplicates.check"].p95 = 2_400; }],
    ["plans.no_full_scan_outside_text_search", (input) => { input.mixed.report.digestTable.lostDuringRun = 3; }],
    ["plans.no_full_scan_outside_text_search", (input) => { input.mixed.report.topStatements[0].plan[0].type = "ALL"; }],
    ["list.count_not_inflated", (input) => { input.counted.list.api = 80_226; }],
    ["import.within_10_minutes", (input) => { input.imported.report.nfr004 = { ...input.imported.report.nfr004, pass: false }; }],
    ["import.exactly_once_and_counts_consistent", (input) => { input.imported.report.verification.exactlyOnce = false; }],
    ["import.report_ok", (input) => { input.imported.code = 1; }],
    ["online.p95_under_2s_during_import", (input) => { input.during.report.nfr001 = { ...input.during.report.nfr001, pass: false }; }]
  ];
  for (const [id, breakIt] of cases) {
    const input = passing();
    breakIt(input);
    assert.ok(failing(performanceVerdicts(input)).includes(id), `${id} must fail`);
  }
});

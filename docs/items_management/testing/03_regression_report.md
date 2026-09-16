# Regression Report

- Trigger / Related DEF/CR: `TASK-044`; post-TASK-040/041 regression; `DEF-101`–`DEF-105`.
- Build / Environment: candidate `49d487e876932e6684cbdbec46043312b3f730bd`; runtime `ITEM-TASK044-LOCAL-20260914`; local MySQL `erp_dev` with synthetic fixtures.

## Impact Analysis

The highest-risk regression areas were Item aggregate create/update/lifecycle, Catalog deletion guards, import transaction/audit behavior, permission expansion for `item.mgmt`, client navigation/forms and performance. The repository-native full server suite and full client suite cover the broadest available implementation surface; targeted true-browser and bounded performance runs address the changed authorization and Item user journeys. Recovery and true downstream SKU-reference behavior require external capabilities not present in this environment.

## Selected Regression Cases

| Test | Rationale | Status | Evidence |
|---|---|---|---|
| Full server, default parallel | Detect broad regressions under project default scheduling | FAIL (test isolation) | `item-server-supporting.xml`: 1,446 pass / 1 fail / 1 skip |
| Missing-source import targeted retest | Determine whether the one default-parallel failure is reproducible product behavior | PASS | `item-import-targeted.xml`: 1/1 pass |
| Full server, serialized | Remove cross-file global import-job claim race while retaining complete product coverage | PASS_WITH_LIMITATION | `item-server-serial.xml`: 1,447 pass / 0 fail / 1 opt-in performance skip |
| Full client | Detect client component/service/navigation regressions | PASS | formal run `20260914T092606-54f0584eddea`: 476/476 |
| Bounded performance | Check lookup/query/import KPI logic under 50 concurrent workers and 10k import | PASS_WITH_LIMITATION | `item-performance-bounded.xml`: 3/3; 1,000 SKU rather than 100k |
| Browser-assisted Item flows | Verify runtime UI, requests, validation, navigation and expanded permission contract | PASS_WITH_LIMITATION | `07_browser_assisted_evidence.md` and two screenshots |
| Recovery | Required operational regression | BLOCKED | missing adapter and staging-like environment |

## Outstanding Risks

- After the high-severity defects were registered, each formal `REGRESSION` suite attempt was stopped by the Harness `PLAN_READY` defect preflight. No stage-specific run artifact was created; `REQUIRED_RUN_MISSING` is therefore an explicit blocker, not an unreported pass.
- No formal suite can map its successful raw tests to mandatory canonical IDs.
- Default-parallel integration execution may intermittently claim another test's import job.
- The 100k-SKU/2.1M-row performance fixture was not executed.
- Backup/restore RTO/RPO, real downstream SKU references and manual business decisions remain unverified.

## Status

`BLOCKED`

## Identity and evidence

- Plan hash / source fingerprint / exact code commit: `85253762f1aad08a605b0dc91f90dc0a8e524cd70b1ae1d2cbe567738e0fc3f3` / `905b8478823c24e24f89af163c0d551edb42d616178572b1fd11dd64b04a3073` / `49d487e876932e6684cbdbec46043312b3f730bd`.
- Runtime/data references and actual run paths: local isolated runtime and synthetic `erp_dev`; evidence paths listed in `02_technical_test_report.md`.
- Targeted retest versus impact regression (separate): single missing-source test is the targeted retest; serialized server, full client, bounded performance and browser flows are impact regression.
- Skipped/not-run cases and approved rationale: the performance case's opt-in skip is not accepted as formal PASS; recovery/UAT commands did not start cases; formal regression attempts were blocked by already-registered high defects; no waiver was granted.

## Remediation impact regression — 2026-09-15

- Latest `main` was merged before retest; lint and client production build pass.
- Item-owned server regression passes 459/459 against local MySQL with zero skip/fail.
- Full client regression passes 492/492.
- Playwright runs the live API/UI and passes 11 cases; its final assertions record no unexpected browser console error, request failure or server 5xx.
- Browser fixtures are removed after execution: zero matching users, roles, brands, UOMs and Items remain, and ports 3000/4173 are not left listening.
- A whole-repository DB run was rejected as evidence because the shared schema contains unmerged Supplier permission rows. The profile now names Item-owned test files explicitly, which is the module-scoped contract and avoids false cross-module failures.

Result: remediation impact regression is locally green; formal Regression remains `BLOCKED` until the changed PLAN/profile baseline is reviewed and approved.

## Candidate `5c620bd` formal Regression — 2026-09-15

| Suite | Result | Current-baseline evidence |
|---|---|---|
| `item-server-technical` | `PASS` | `20260915T030140-5f4671994278`: 459/459, required server TC mappings PASS |
| `item-client-technical` | `PASS` | `20260915T030248-57050e3d96b5`: 492/492, TC-011 PASS |
| `item-performance` | `PASS_WITH_LIMITATION` | `20260915T030312-a6347c1d7274`: 3/3 bounded regression, TC-012 PASS |
| `item-recovery` | `BLOCKED_DEFERRED` | `20260915T030630-20d57aa8c7d5`: TC-016 remains unexecuted under APR-020 |

The executable Item application suites are green in both Technical and Regression stages. Overall Regression/Technical Acceptance remains `BLOCKED`, because risk deferral preserves the missing recovery result rather than converting it to PASS. Post-run cleanup was verified: zero `PERF-*` SKU fixtures, performance users or performance roles remained, and the MySQL advisory lock was released successfully.

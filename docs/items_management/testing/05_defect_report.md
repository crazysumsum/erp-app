# Defect Report

## DEF-101 — Formal server suite cannot discover tests on Node 26

- Source Test/Finding: formal `item-server-technical`, run `20260914T092531-d37464deab2b`
- Severity: HIGH
- Failure Type: TEST_INFRASTRUCTURE / COMMAND_CONTRACT
- Requirement: TC-001–TC-010, TC-013–TC-015 evidence execution
- Design: Harness project profile suite contract
- Phase: PHASE-006
- Task: TASK-044
- Expected: approved command discovers and executes the server test files.
- Actual: `node --test ... server/test` treats the directory as an ESM import and raises `ERR_UNSUPPORTED_DIR_IMPORT`; one synthetic failing testcase is emitted and no product test executes.
- Evidence: `docs/items_management/evidence/20260914T092531-d37464deab2b/run.json`
- Root Cause: the approved command passes a directory entry under Node 26 instead of running from `server` with auto-discovery or enumerating files.
- Remediation Route: explicit `REMEDIATE_AND_RETEST`; review the profile command and preserve its canonical contract.
- Retest Cases: formal `item-server-technical`.
- Regression Scope: full server plus MySQL integration.
- Status: CLOSED
- Closure Evidence: targeted `testing/evidence/remediation-server-scoped.junit.xml`; impact regression `testing/evidence/remediation-client.junit.xml` plus lint/build checks recorded in `03_regression_report.md`.
- Residual Risk / Notes: the module-scoped replacement command passed 459/459 locally. Formal Technical Acceptance remains separate and requires a newly approved PLAN baseline and Harness rerun.

## DEF-102 — Successful JUnit cases do not emit canonical TC IDs

- Source Test/Finding: formal client/performance evidence and static server suite review
- Severity: HIGH
- Failure Type: TEST_EVIDENCE_MAPPING
- Requirement: TC-001–TC-015
- Design: Harness required-case contract
- Phase: PHASE-006
- Task: TASK-044
- Expected: each mandatory canonical case has a trusted `harness_id` or unambiguous `TC-*` name in normalized evidence.
- Actual: client runs 476/476, but maps zero tests to `TC-011`; server and performance tests likewise have no canonical IDs.
- Evidence: `docs/items_management/evidence/20260914T092606-54f0584eddea/run.json`, `docs/items_management/evidence/20260914T092629-d4f1cf71d1e8/run.json`
- Root Cause: legacy project test names were not adapted to the canonical acceptance catalogue.
- Remediation Route: explicit `REMEDIATE_AND_RETEST`; add reviewed trustworthy mapping/adapters without lowering required IDs.
- Retest Cases: TC-001–TC-015.
- Regression Scope: all technical acceptance suites.
- Status: CLOSED
- Closure Evidence: targeted canonical-ID results in `testing/evidence/remediation-server-scoped.junit.xml` and `testing/evidence/remediation-client.junit.xml`; impact/performance regression in `testing/evidence/remediation-performance-bounded.junit.xml`.
- Residual Risk / Notes: canonical IDs are now emitted by meaningful server, client and performance cases. Formal Technical Acceptance remains pending against the approved/frozen baseline.

## DEF-103 — Recovery acceptance adapter and staging-like environment are absent

- Source Test/Finding: formal `item-recovery`, run `20260914T093142-11c20da04269`
- Severity: HIGH
- Failure Type: TEST_INFRASTRUCTURE / ENVIRONMENT
- Requirement: NFR-010, NFR-011, NFR-014, NFR-015 / TC-016
- Design: DES-018, DES-019
- Phase: PHASE-006
- Task: TASK-044
- Expected: timed backup/restore adapter runs in an approved staging-like environment and proves RTO/RPO plus integrity.
- Actual: `server/scripts/runItemRecoveryAcceptance.js` is missing; no approved staging-like backup/storage environment or backup identifiers exist.
- Evidence: `docs/items_management/evidence/20260914T093142-11c20da04269/run.json`
- Root Cause: recovery execution capability was planned but not implemented/provisioned.
- Remediation Route: provide adapter under controlled implementation mode and separately authorize a destructive-safe staging-like exercise.
- Retest Cases: TC-016.
- Regression Scope: post-restore service smoke and reconciliation.
- Status: DEFERRED (environment-blocked)
- Residual Risk / Notes: local MySQL is not an acceptable substitute for operational DR evidence.

## DEF-104 — Configured Item UAT Playwright project is absent

- Source Test/Finding: formal `item-uat-browser`, run `20260914T093146-7574b753a291`
- Severity: HIGH
- Failure Type: TEST_INFRASTRUCTURE
- Requirement: UAT-001–UAT-012, UAT-015 automated assistance
- Design: approved project profile
- Phase: PHASE-006
- Task: TASK-044
- Expected: `client/e2e/item-management/playwright.config.js` loads and produces canonical UAT JUnit evidence.
- Actual: config file does not exist; zero cases execute.
- Evidence: `docs/items_management/evidence/20260914T093146-7574b753a291/run.json`
- Root Cause: canonical UAT catalogue was documented without the configured automation project.
- Remediation Route: explicit `REMEDIATE_AND_RETEST`; implement reviewed Playwright project/cases, then rerun in a stable environment.
- Retest Cases: UAT-001–UAT-012, UAT-015.
- Regression Scope: all Item browser journeys, console and network.
- Status: CLOSED
- Closure Evidence: targeted browser execution `testing/evidence/remediation-item-uat-browser.junit.xml`; impact regression `testing/evidence/remediation-client.junit.xml`.
- Residual Risk / Notes: the project now executes 13 canonical cases (11 pass, 2 external-condition skips); the missing-project defect is fixed, while UAT-005/UAT-015 remain independently blocked and do not receive PASS credit.

## DEF-105 — Parallel integration files can claim each other's import jobs

- Source Test/Finding: repository-native default-parallel full server regression
- Severity: MEDIUM
- Failure Type: TEST_ISOLATION / FLAKY_TEST
- Requirement: TC-009, TC-015 evidence reliability
- Design: isolated synthetic test data contract
- Phase: PHASE-006
- Task: TASK-044
- Expected: every import worker fixture claims only the job owned by its test, independent of file scheduling.
- Actual: missing-source test returned `source_missing` for a different migration test's globally visible `uploaded` job; its own row remained `uploaded`, causing one failure and leaving the other row behind.
- Evidence: `testing/evidence/item-server-supporting.xml` (1,446/1/1); targeted `item-import-targeted.xml` (1/1); serialized `item-server-serial.xml` (1,447/0/1).
- Root Cause: multiple test files share one schema and globally claim the oldest eligible import job without per-test ownership; Node test files run in parallel by default.
- Remediation Route: explicit `REMEDIATE_AND_RETEST`; isolate schemas/jobs or serialize DB integration files in the approved runner.
- Retest Cases: failed missing-source case, full default runner, TC-009 and TC-015.
- Regression Scope: import migrations, validation, execution and cleanup.
- Status: CLOSED
- Closure Evidence: targeted `testing/evidence/item-import-targeted.xml`; serialized impact regression `testing/evidence/remediation-server-scoped.junit.xml`.
- Residual Risk / Notes: the approved Item suite is now serialized and module-scoped; the repository-wide default runner remains unsuitable for shared-schema formal evidence.

## Closure integrity

- Original failed baseline/run (retain): all run IDs and JUnit evidence above remain unchanged.
- New baseline / actual human disposition if material: remediation was authorized on 2026-09-15; the changed PLAN still requires explicit approval before formal acceptance execution.
- Targeted retest evidence: retained for `DEF-101`, `DEF-102`, `DEF-104`, and `DEF-105`.
- Impact regression evidence: retained in `03_regression_report.md`.
- State DEF/CR entry and current status: to be registered by revision-checked Harness checkpoint; statuses must match this report.

## Remediation cycle — 2026-09-15

The user explicitly authorized `REMEDIATE_AND_RETEST`. Remediation changed test infrastructure and evidence mapping only; no Item production handler, service, schema or UI behavior was changed.

| Defect | Targeted retest | Impact regression | Disposition |
|---|---|---|---|
| DEF-101 | Corrected Node 26 command runs from `server/` and enumerates Item-owned tests: 459/459, 0 skip/fail | lint and client build pass; all Item integration areas execute on local MySQL | `CLOSED` |
| DEF-102 | JUnit contains each required `TC-001`–`TC-010`, `TC-013`–`TC-015`; client emits `TC-011`; performance emits `TC-012` | server 459/459 and client 492/492 | `CLOSED` |
| DEF-104 | Configured Playwright project loads and executes all 13 configured UAT IDs | 11 pass; UAT-005 and UAT-015 are explicit external-condition skips; console/network assertions pass | `CLOSED` |
| DEF-105 | Item DB tests run with `--test-concurrency=1`; import canonical cases pass | complete module-scoped server regression 459/459 | `CLOSED` |

Evidence: `testing/evidence/remediation-server-scoped.junit.xml`, `remediation-client.junit.xml`, `remediation-performance-bounded.junit.xml`, and `remediation-item-uat-browser.junit.xml` (developer remediation artifacts only; formal retest remains pending).

The first attempted whole-repository retest is deliberately not counted: the shared `erp_dev` contains Supplier permissions from a local migration newer than `origin/main`, causing 12 User/Role tests to return `PERMISSION_STALE`. The Item suite was therefore corrected to a module-scoped contract rather than treating unrelated module state as an Item failure.

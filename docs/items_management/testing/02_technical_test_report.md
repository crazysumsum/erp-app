# Technical Test Report

## Scope / Build / Environment

- Scope: Item Management canonical `TC-001`–`TC-016` under `TASK-044`.
- Candidate: metadata-only commit `49d487e876932e6684cbdbec46043312b3f730bd`; unchanged product source fingerprint `905b8478823c24e24f89af163c0d551edb42d616178572b1fd11dd64b04a3073`.
- Environment: local isolated runtime `ITEM-TASK044-LOCAL-20260914`, Node `v26.6.0`, MySQL `26.7.0`, synthetic `erp_dev` data.
- Formal execution occurred between `2026-09-14T09:25:32Z` and `2026-09-14T09:31:46Z`. Browser-assisted evidence continued afterward.

## Summary

| Metric | Count |
|---|---:|
| Planned | 16 |
| PASS | 0 |
| FAIL | 0 |
| BLOCKED | 16 |
| NOT_RUN | 0 |

`FAIL=0` is the canonical product-case result. The formal server command itself failed before product tests started; that infrastructure failure is retained separately as `DEF-101` and is not reclassified as an Item behavior failure.

## Results

| TC | Requirement | Phase/Task | Status | Evidence | DEF |
|---|---|---|---|---|---|
| TC-001 | Migration/DB | PHASE-006 / TASK-044 | BLOCKED | Formal server run never entered product tests; serialized supporting server regression passed. | DEF-101, DEF-102 |
| TC-002 | List/read/API/UI | PHASE-006 / TASK-044 | BLOCKED | Supporting server/client/browser evidence passed available paths; no canonical JUnit mapping or approved 100k fixture. | DEF-101, DEF-102 |
| TC-003 | Create/transaction | PHASE-006 / TASK-044 | BLOCKED | Supporting server tests and browser validation error path passed; canonical case ID absent. | DEF-101, DEF-102 |
| TC-004 | Update/concurrency | PHASE-006 / TASK-044 | BLOCKED | Serialized supporting server regression passed; real downstream SKU reference remains unavailable. | DEF-101, DEF-102 |
| TC-005 | Lifecycle/delete | PHASE-006 / TASK-044 | BLOCKED | Serialized supporting server regression passed; canonical case ID absent and real downstream reference remains unavailable. | DEF-101, DEF-102 |
| TC-006 | UOM/barcode | PHASE-006 / TASK-044 | BLOCKED | Serialized supporting server regression passed; canonical case ID absent. | DEF-101, DEF-102 |
| TC-007 | Price/tracking/catalog | PHASE-006 / TASK-044 | BLOCKED | Serialized supporting server regression passed; canonical case ID absent. | DEF-101, DEF-102 |
| TC-008 | Media/security | PHASE-006 / TASK-044 | BLOCKED | Serialized supporting server regression passed; canonical case ID absent. | DEF-101, DEF-102 |
| TC-009 | Import/export | PHASE-006 / TASK-044 | BLOCKED | Serialized supporting server regression passed; default-parallel run exposed a fixture race and targeted retest passed. | DEF-101, DEF-102, DEF-105 |
| TC-010 | Auth/audit | PHASE-006 / TASK-044 | BLOCKED | `item.mgmt`-only browser create/read/delete/audit path passed; canonical case ID absent. | DEF-101, DEF-102 |
| TC-011 | Client/browser/accessibility | PHASE-006 / TASK-044 | BLOCKED | Formal client run: 476/476 pass, but none emitted `TC-011`; real-browser subset passed. | DEF-102 |
| TC-012 | Performance/observability | PHASE-006 / TASK-044 | BLOCKED | Formal case skipped. Supporting 1,000-SKU/50-user/10k-import run passed 3/3; not the required 100k fixture. | DEF-102 |
| TC-013 | Detail projection | PHASE-006 / TASK-044 | BLOCKED | Serialized supporting server regression passed; canonical case ID absent. | DEF-101, DEF-102 |
| TC-014 | `CATALOG_IN_USE` | PHASE-006 / TASK-044 | BLOCKED | Serialized true-MySQL supporting server regression passed; canonical case ID absent. | DEF-101, DEF-102 |
| TC-015 | Import aggregate transaction/audit | PHASE-006 / TASK-044 | BLOCKED | Serialized true-MySQL supporting server regression passed; canonical case ID absent. | DEF-101, DEF-102, DEF-105 |
| TC-016 | Backup/restore/DR | PHASE-006 / TASK-044 | BLOCKED | Recovery command failed because adapter is absent; no approved staging-like restore environment. | DEF-103 |

## Retest / Regression

- Formal `item-server-technical` run `20260914T092531-d37464deab2b`: infrastructure `FAIL`, 1 synthetic testcase (`server/test`), error `ERR_UNSUPPORTED_DIR_IMPORT`; no product tests executed.
- Repository-native parallel server run: 1,446 pass, 1 fail, 1 expected performance skip. The failure involved an import worker claiming another test file's globally visible `uploaded` job.
- Targeted missing-source retest: 1/1 pass (`item-import-targeted.xml`).
- Full serialized server regression (`--test-concurrency=1`): 1,447 pass, 0 fail, 1 expected opt-in performance skip (`item-server-serial.xml`). This supports product behavior while retaining `DEF-105` for default parallel isolation.
- Formal `item-client-technical` run `20260914T092606-54f0584eddea`: command exit 0; 476 pass, 0 fail, 0 skip; formal result BLOCKED only because `TC-011` was not emitted.
- Formal `item-performance` run `20260914T092629-d4f1cf71d1e8`: 1 skipped; `ITEM_PERFORMANCE_TESTS` cannot pass through the approved profile contract.
- Bounded supporting performance: 3/3 pass; 50-concurrent mixed-load testcase 0.417 seconds; 10,000-row import testcase 7.849 seconds; actual fixture 1,000 SKU, not formal 100k.

## Open Defects / Blockers

- `DEF-101`: formal server suite command imports a directory under Node 26 and cannot start product tests.
- `DEF-102`: formal JUnit evidence lacks canonical `TC-*` IDs, so mandatory cases cannot be credited.
- `DEF-103`: recovery adapter and staging-like restore environment are absent.
- `DEF-104`: configured Item UAT Playwright project is absent.
- `DEF-105`: repository-native parallel integration execution shares global import-job claim state and is flaky; serialized execution is green.

## Technical Readiness

`BLOCKED`

## Contract / identity

- Plan hash / exact commit / source fingerprint: `85253762f1aad08a605b0dc91f90dc0a8e524cd70b1ae1d2cbe567738e0fc3f3` / `49d487e876932e6684cbdbec46043312b3f730bd` / `905b8478823c24e24f89af163c0d551edb42d616178572b1fd11dd64b04a3073`.
- Required suite contract hashes and real run paths: server `77dd0b...` / `evidence/20260914T092531-d37464deab2b/run.json`; client `3aab64...` / `evidence/20260914T092606-54f0584eddea/run.json`; performance `22bd72...` / `evidence/20260914T092629-d4f1cf71d1e8/run.json`; recovery `d44ddb...` / `evidence/20260914T093142-11c20da04269/run.json`.
- Total/pass/fail/skipped/not-run and mandatory-case results: raw formal commands are detailed above; canonical mandatory result is 0 PASS, 0 FAIL, 16 BLOCKED.
- Tool/runtime/data observations and missing evidence: exact versions and lease are in `01_environment_verification.md`; missing canonical IDs, recovery adapter/staging environment and full-scale performance evidence prevent Technical Acceptance.

## REMEDIATE_AND_RETEST developer evidence — 2026-09-15

This section supplements, but does not rewrite, the original formal blocked run. The PLAN/profile changed and therefore requires independent review plus a new human approval before these results may become formal acceptance evidence.

| Suite | Result | Canonical mapping / limitation | Evidence |
|---|---:|---|---|
| Item server, serialized and module-scoped | 459 pass / 0 fail / 0 skip | `TC-001`–`TC-010`, `TC-013`–`TC-015` each emitted once | `testing/evidence/remediation-server-scoped.junit.xml` |
| Full client | 492 pass / 0 fail / 0 skip | seven meaningful component cases emit `TC-011` | `testing/evidence/remediation-client.junit.xml` |
| Bounded performance | 4 pass / 0 fail / 0 skip | `TC-012`; 1,000 SKU, 50 concurrent workers, 10,000 import rows; not the formal 100k data volume | `testing/evidence/remediation-performance-bounded.junit.xml` |
| Item browser UAT | 11 pass / 0 fail / 2 skip | all 13 configured `UAT-*` IDs emitted; UAT-005 and UAT-015 retain external blockers | `testing/evidence/remediation-item-uat-browser.junit.xml` |

These JUnit files are remediation/developer artifacts, not formal Harness gate evidence. The original `.xml` state references now contain explicit `BLOCKED` correction records so the accidental raw-XML registration remains preserved without being misread as a formal result.

## Approved-baseline formal rerun — 2026-09-15

| Suite | Formal result | Evidence / disposition |
|---|---|---|
| `item-server-technical` | `BLOCKED` | Run `20260915T022734-0e13fa08d720`: process exit 0, but duplicate JUnit names prevented trustworthy normalization; `DEF-106` opened. |
| `item-client-technical` | `PASS` | Run `20260915T022954-219f01eed099`: 492/492, 0 skipped/failed; required `TC-011` PASS. An unrelated Business Master test also emits `TC-016`, but it cannot substitute for the separately required Item recovery suite. |
| `item-performance` | `PASS_WITH_LIMITATION` | Run `20260915T023008-644114a5c002`: 3/3, required `TC-012` PASS under the approved bounded profile; not the outstanding 100k capacity exercise. |
| `item-recovery` | `BLOCKED_DEFERRED` | Run `20260915T023324-35fe8b579a91`: TC-016 not run because the adapter/staging-like environment is absent; risk deferral approved as `APR-020`, never counted as PASS. |

Technical Acceptance remains `BLOCKED`: `DEF-106` requires a test-only candidate correction, and the required recovery suite remains deferred rather than passed.

### DEF-106 remediation result

The approved test-title-only correction passed targeted testing (59/59) and the complete module-scoped server regression (459/459). All 459 normalized JUnit names are unique, and required `TC-001`–`TC-010` plus `TC-013`–`TC-015` map to PASS. Evidence: `testing/evidence/def106-targeted.junit.xml` and `testing/evidence/def106-server-regression.junit.xml`. This is developer remediation evidence; the previous blocked formal run remains preserved and a new-candidate formal rerun is still required.

The profile now allows `ITEM_PERFORMANCE_TESTS` for the dedicated performance suite. Full-scale performance and `TC-016` recovery remain unexecuted, so Technical Acceptance remains `BLOCKED` pending the formal retest and external prerequisites.

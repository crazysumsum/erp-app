# UAT Test Report — Supplier Management (limited business UAT, 2026-10-30 to 2026-11-02)

## Scope / Build / Environment

- **What this is:** a limited business UAT before Technical Acceptance (HD-161, HD-162 B). It is **not** the formal business UAT window, and it does not replace it.
- **Scope:** the 41 UAT cases Supplier can run without other modules (24 P0, 17 P1).
- **Out of scope:** 14 cases.
  - UAT-005, 016, 024, 029, 032–036, 050, 051 and 053 wait for Purchasing, Receiving and AP (TASK-051 group B).
  - UAT-044 and 045 wait for Operations and the DR owner.
- **Build:** main `3b9ef58d` (the PR #309 merge). The run was made at `3780b1ce`, which adds ledger only (`code_unchanged` and `spec_unchanged` true).
- **Plan baseline:** `cfb4af71`. **Design baseline:** `5003b391`.
- **Environment:** the suite's own webServer started a real API server (3021), a real client (5216) and a fresh `erp_t51_rh_uat*` scratch database on the throwaway mysqld 3450 (MySQL 26.7.0), then dropped them. Browser: Playwright Chrome, one account per role.
- **Technical readiness:** Technical Acceptance is **not** complete. It is blocked by TASK-051 group B, TC-136 (release gate) and a formal run on the then-current baseline (`07_technical_acceptance_report.md`).

## Summary

| Metric | Count |
|---|---:|
| Planned | 55 |
| In scope (HD-161) | 41 |
| PASS | 41 |
| FAIL | 0 |
| BLOCKED | 0 |
| NOT_RUN (out of scope, `test.fixme`) | 14 |
| Business acceptance: ACCEPTED | 41 |
| Business acceptance: REJECTED or query | 0 |

## Results

Technical Execution comes from the run `evidence/20261030T093238-52ea32e0c5b7` (`supplier-uat-browser`, stage UAT, 2026-10-30 09:32:39–09:35:39Z). Its result is BLOCKED only because of the 14 skips (`max_skipped` 0). Business Acceptance comes from the Product Owner (see below).

| UAT | Priority | Role | Requirement / AC | Technical Execution | Business Acceptance | Evidence | DEF/CR |
|---|---|---|---|---|---|---|---|
| UAT-001 | P0 | CLERK | FR-016～FR-023；AC-001 | PASS | ACCEPTED | 3 screenshots |  |
| UAT-002 | P0 | CLERK | FR-017；AC-002 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-003 | P1 | CLERK | FR-018；AC-003 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-004 | P0 | CLERK | FR-043；AC-004 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-005 | P0 | CLERK | FR-025；AC-005 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-006 | P1 | CLERK | FR-025～FR-028；AC-006 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-007 | P1 | VIEWER | FR-001～FR-015 | PASS | ACCEPTED | 3 screenshots |  |
| UAT-008 | P1 | CLERK | FR-024～FR-030；NFR-007；AC-038 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-009 | P0 | CLERK | FR-023；AC-007 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-010 | P0 | CLERK | FR-052～FR-058；AC-008 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-011 | P0 | CLERK | FR-052；AC-009 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-012 | P0 | APPROVER-A | FR-055；AC-010 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-013 | P1 | APPROVER-A | FR-055；AC-011 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-014 | P0 | CLERK/APPROVER-A | FR-057；AC-012 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-015 | P1 | SETTINGS-ADMIN | FR-063；AC-013 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-016 | P0 | CLERK/BUYER | FR-031；AC-014 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-017 | P0 | CLERK | FR-034～FR-035；AC-015 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-018 | P0 | APPROVER-A | FR-035；AC-016 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-019 | P1 | CLERK | FR-036～FR-037；AC-017 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-020 | P0 | CLERK | FR-038；AC-018 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-021 | P0 | CLERK | FR-038；AC-019 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-022 | P1 | CLERK | FR-039～FR-044；AC-020 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-023 | P1 | CLERK | FR-040；AC-021 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-024 | P1 | CLERK/BUYER | FR-020；AC-022 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-025 | P0 | VIEWER | FR-046；AC-023 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-026 | P0 | BANK-READER | FR-046, FR-050；AC-024 | PASS | ACCEPTED | 3 screenshots |  |
| UAT-027 | P0 | CLERK/BANK-READER | FR-045；AC-025 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-028 | P0 | BANK-OFFICER | FR-048；AC-026 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-029 | P1 | CLERK/BUYER | FR-051；AC-027 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-030 | P0 | SYSTEM-ADMIN | SEC-005～SEC-014；HD-001 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-031 | P1 | CLERK | FR-020, FR-024；HD-002 | PASS | ACCEPTED | 3 screenshots |  |
| UAT-032 | P0 | BUYER | FR-065～FR-070；AC-028 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-033 | P1 | BUYER | FR-067～FR-068；AC-029 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-034 | P0 | BUYER | FR-069；AC-030 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-035 | P1 | BUYER | FR-066；AC-031 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-036 | P0 | CLERK/BUYER | FR-030；AC-032 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-037 | P0 | CLERK | FR-071～FR-079；AC-033 | PASS | ACCEPTED | 4 screenshots |  |
| UAT-038 | P0 | CLERK | FR-073；AC-034 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-039 | P0 | CLERK | FR-077；AC-035 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-040 | P0 | CLERK | FR-059；AC-036 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-041 | P1 | SETTINGS-ADMIN | FR-060～FR-064；AC-037 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-042 | P0 | VIEWER | SEC-001～SEC-009；AC-039 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-043 | P0 | CLERK、SYSTEM-ADMIN；VIEWER只驗證被拒 | FR-007, FR-080, FR-087；AC-040 | PASS | ACCEPTED | 3 screenshots |  |
| UAT-044 | P1 | 營運代表 | NFR-001～NFR-005 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-045 | P0 | 營運／DR owner | NFR-009, NFR-011 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-046 | P1 | 各業務角色 | NFR-006～NFR-010 | PASS | ACCEPTED | 3 screenshots |  |
| UAT-047 | P1 | 鍵盤使用者 | NFR-006；frontend-design | PASS | ACCEPTED | 18 screenshots |  |
| UAT-048 | P1 | CLERK | FR-039～FR-042；AC-020～AC-021 | PASS | ACCEPTED | 2 screenshots |  |
| UAT-049 | P1 | CLERK | FR-039～FR-042, FR-044；AC-020～AC-021 | PASS | ACCEPTED | 1 screenshots |  |
| UAT-050 | P0 | CLERK | FR-043～FR-044；AC-004 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-051 | P0 | APPROVER-A | FR-032～FR-038；AC-015～AC-019 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-052 | P0 | CLERK/APPROVER-A | FR-056～FR-057；AC-012 | PASS | ACCEPTED | 3 screenshots |  |
| UAT-053 | P0 | BANK-OFFICER | FR-045～FR-051；SEC-005～SEC-013；AC-023～AC-027 | NOT_RUN (`test.fixme`) | NOT_APPLICABLE (out of HD-161 scope) | — |  |
| UAT-054 | P1 | VIEWER | FR-001～FR-010 | PASS | ACCEPTED | 4 screenshots |  |
| UAT-055 | P1 | VIEWER（UAT fixture沒有AUDITOR角色；HD-146 A修訂） | FR-081～FR-087 | PASS | ACCEPTED | 4 screenshots |  |

**Screenshots:** 99 screenshots are attached to the run's junit (`supplier-uat-browser.xml`). They were stored outside the repository, under `/tmp/supplier-management-uat-artifacts/34753d87`, because Playwright traces can hold typed passwords (REV-115 L-2).
- **Limitation of the evidence (REV-145 L1):** the originals were lost when `/tmp` was cleaned (checked 2026-11-02), so the junit's attachment paths now point at nothing.
  - The only copies left are the 99 compressed JPEGs on the private review page. They are what the Product Owner reviewed, and their per-case counts match the junit.
  - UAT-040-01, UAT-042-02 and UAT-054-04 are byte-identical. All three show the 「冇權限」 page, which is each case's expected refusal screen (REV-145 N2, checked).
- **Code identity after the merges (REV-145 L2):** this branch later merged main `aae9c744` (PR #313). It brought only `.github/scripts/*`, `ci.yml`, `AGENTS.md` and `docs/ci-capacity-routing.md`, and no server or client code.
  - The accepted behaviour is therefore the one tested, and the "reconfirm if the code changes" condition is not triggered.
  - The harness still counts the run as stale: the source fingerprint moved, so `verify_gate UAT_EXECUTION` reports it missing.

## Defects

None. No case failed, and the Product Owner raised nothing.

## Change Requests

None.

## Pending User Acceptance

- **The 14 out-of-scope cases.** They are accepted when they are run: group B when the downstream modules ship, and UAT-044 and 045 with Operations and the DR owner.
- **The 41 cases.** If the code changes before release, the affected cases need reconfirming.
- **UAT-046 (REV-145 L3).** `08_traceability.json` registers UAT-046 as manual (`suite_id` null), but it runs in `supplier-uat-browser`, under the HD-145 A amendment. Here it passed in that suite and was accepted.
  - The manual-UAT check of `verify_gate UAT_EXECUTION` still reports it missing. This acceptance is not used to satisfy that check.
  - Registering the suite for UAT-046 is for a later plan change.

## UAT Status

PENDING_USER_ACCEPTANCE: 41 of 55 accepted in this limited UAT; 14 not run.

## Contract / sign-off identity

- **Plan hash / exact code and environment baseline:** plan `cfb4af71`, design `5003b391`, code `3b9ef58d` (run at `3780b1ce`), throwaway mysqld 3450 with a fresh scratch database.
- **Actual automated/manual evidence and executor:**
  - The harness agent (Claude Opus 5.5) ran the existing Playwright UAT suite through `run_check` (HD-162 B). No case was run by hand.
  - The Product Owner reviewed the expected results and the screenshots on a private review page.
- **Separate business authority/source/time:**
  - The Product Owner (Sam) replied "接受" in chat on 2026-11-02, after the review page asked for acceptance per case or in bulk.
  - The page itself held no per-case choices at that time. The agent therefore recorded all 41 cases as ACCEPTED from that reply, and stated this reading to him in the same reply. He has not confirmed that reading since.
- **Pending decisions are not automated acceptance:**
  - The automated PASS is execution evidence only.
  - This acceptance covers the limited UAT before Technical Acceptance. It is not the formal business sign-off (T51 AC 4) or the release approval, which come after Technical Acceptance and the full UAT.

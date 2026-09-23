# Inventory Management Final Alignment Review

## Outcome

**0.4 DATABASE BASELINE AND PLAN APPROVED; IMPLEMENT PAUSED.** Sam approved the final 0.4 requirement/design and P0→P5 plan hashes with exact MySQL Server 26.7.0 on 2026-09-23. No product implementation, migration execution, test execution, UAT, Go-Live or release occurred; resuming `IMPLEMENT` remains a separate decision.

## Mode, module and baselines

| Item | Observed value |
| --- | --- |
| Mode | `DESIGN_AND_PLAN` |
| Module / output | `inventory-management` / `docs/inventory_management` |
| Mode-entry commit / recovery point | `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7`; all four legacy inputs were clean at entry |
| First alignment PR / merge | [PR #85](https://github.com/crazysumsum/erp-app/pull/85) / `87601a08e6f6d2d51a853f86f76f5bfa0cc1d268` |
| Decision-alignment PR | [PR #88](https://github.com/crazysumsum/erp-app/pull/88); created from `codex/inventory-decision-alignment` for `main` under Sam's merge authorization |
| Default for decision alignment / pre-delivery refresh | `b948c92fecc31555bdc4043feea26f8c72ddf7a2` / `134c2722f92eae298da7ad1a1b01b6a75522550e`; intervening changes were limited to out-of-scope `customer_management` documents |
| Current topic branch / worktree | `codex/inventory-p0-foundation` / `/private/tmp/erp-inventory-p0-foundation`; retained temporarily for the planning correction because no product code was started |
| Product-code changes | None |
| Formal tests / CI / UAT | `NOT_RUN`; no acceptance result claimed |

## Canonical artifacts

- Added `00_module_manifest.json`, `00_project_profile.json`, `00_harness_state.json` and `08_traceability.json`.
- Consolidated the complete legacy requirement, design, plan and UAT narratives into `01_requirement_spec.md`, `03_design_spec.md`, `05_development_tasks.md` and `07_uat_test_cases.md`.
- Added requirement/design reviews, a standalone technical-test specification, deterministic traceability view, gap analysis and this alignment review.
- Preserved 153 requirements (125 FR, 14 SEC, 14 NFR), 10 design indexes, 6 phases, 51 tasks, 10 technical cases and 113 detailed UAT cases.
- Retained all cases as `NOT_RUN` and all implementation tasks as `PENDING`.

## Recovery and no-loss result

The pre-alignment files are recoverable at commit `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7` with hashes recorded in `00_artifact_inventory.md`. Each entire legacy body was preserved before applying the explicitly recorded owner/decision/MySQL baseline updates; document title and active internal filename references were also corrected. No OpenAPI, JSON Schema, migration, executable test or diagram source existed in the module directory or was deleted. Repository implementation/configuration sources were read-only verification inputs.

## Review and findings

The initial `SELF_REVIEW` by `/root` is retained as historical review `REV-001`. Sam subsequently identified himself as the independent human reviewer, reviewed the planning baseline, approved the current requirement/design and P0→P5 plan, and accepted the explicitly planned implementation prerequisites. This satisfies the manifest's independent-review policy for planning; it does not create implementation, test, UAT, business or release evidence.

## Traceability and command profile

- Typed path: Requirement → Design → Phase → Task → mandatory Technical Test; UAT is grounded in requirements and linked to technical readiness.
- `08_traceability_matrix.md` is generated deterministically from `08_traceability.json` after the confirmed-owner gate.
- Observed local commands are recorded in `00_project_profile.json`: root lint, client build and a Node test/JUnit contract using the repository test environment.
- Observed GitHub Actions checks are Dependency audit, Lint, Test (server + client, MySQL integration) and Build frontend. Their existence is not a PASS observation for this approved planning baseline.

## Human decisions

| ID | Status | Disposition |
| --- | --- | --- |
| HD-001 | ANSWERED | Accountable owner: `ERP Product Owner (Sam)`. |
| HD-002 | ANSWERED | `DEC-014` through `DEC-019` approved as written. |
| HD-003 | ANSWERED | MySQL 8.0 selected as the supported production and CI compatibility baseline. |
| HD-004 | ANSWERED | Serial fail-closed/Go-Live guard; `receiving.expiry.override`; Customer Return→`QUARANTINED`; fixed Adjustment reasons; Data Freeze and Go-Live responsibilities; DB-account separation and backup/restore rehearsal. |
| HD-005 | ANSWERED | Sam authorized entry to `IMPLEMENT` on 2026-09-23; execution was later paused by the material baseline change. |
| HD-006 | ANSWERED | Exact MySQL Server 26.7.0 supersedes the earlier MySQL 8.0 production/CI/developer integration baseline; patch upgrades are not implicit, and Sam approved the resulting 0.4 design/plan baseline. |

## HD-001 — Accountable owner

- Answer source: user response in the active Codex task on 2026-09-14 (Asia/Hong_Kong): “1 確認”.
- Recorded interpretation: the proposed owner `ERP Product Owner (Sam)` is confirmed.
- Scope: accountable ownership for Inventory design, residual-risk and business-acceptance decisions.
- Boundary: this answer identifies the owner; it does not approve the whole requirement, design, plan, implementation or release.

## HD-002 — DEC-014 through DEC-019

- Answer source: user response in the active Codex task on 2026-09-14 (Asia/Hong_Kong): “2 批准”.
- Recorded interpretation: all six proposed decisions `DEC-014` through `DEC-019` are approved as written.
- Scope: atomic Bin Move, whole Transfer dispatch/receive, Bin-scoped Stocktake lock, pre-Go-Live Opening and no dual approval as defined in the canonical requirement/design.
- Boundary: approval is limited to these decision records and is not whole-spec or implementation approval.

## HD-003 — MySQL 8.0 baseline

- Answer source: user response in the active Codex task on 2026-09-14 (Asia/Hong_Kong): “3 MySQL 8.0”.
- Recorded interpretation: MySQL 8.0 is the supported production and CI compatibility baseline.
- Scope: DDL, constraints, locking, migrations and technical verification for this module.
- Boundary: selecting a compatibility baseline does not authorize schema execution or product-code changes.

## HD-004 — Integration and Go-Live constraints

- Answer source: Sam's逐題回答 in the active Codex task on 2026-09-14 (Asia/Hong_Kong).
- Serial:本期不實作Serial Tracking；所有Serial SKU過帳fail closed，存在Active inventory-tracked Serial SKU時禁止Go-Live。
- Receiving low-life:固定使用`receiving.expiry.override`；只允許尚未過期的Lot，並要求一般收貨權限、專門權限、逐筆原因及完整threshold／actor／source／request／movement evidence。
- Returns: Customer Return固定預設`QUARANTINED`；品質檢查後才可轉`AVAILABLE`或`DAMAGED`。
- Adjustment:固定allowlist為`COUNT_GAIN, COUNT_LOSS, DAMAGE, EXPIRY, DATA_CORRECTION, TRANSFER_VARIANCE, OTHER`；`OTHER`須有更詳細說明。
- Cutover:採明確Data Freeze，凍結後舊系統不得再寫庫存；Warehouse／Operations Lead負責對賬，Sam負責最終Go-Live簽核；實際時間及Opening資料在P5提供。
- Database: Production application與migration DB accounts分離；Go-Live前完成backup／restore rehearsal。

## HD-005 — IMPLEMENT authorization

- Answer source: user response in the active Codex task on 2026-09-23: “Inventory Management 切換到 IMPLEMENT”.
- Recorded interpretation: P0 implementation was authorized against the then-approved 0.3 baseline.
- Boundary: the later `HD-006` material compatibility change invalidated the affected baseline approval and paused implementation before product work began.

## HD-006 — MySQL Server 26.7.0 baseline

- Answer source: user response in the active Codex task on 2026-09-23: “那就改以26.7.0為基線”.
- Recorded interpretation: production, CI and developer integration environments must report exactly MySQL Server 26.7.0; this supersedes `HD-003` but preserves it as history.
- Scope: DDL, constraints, generated columns, locking, migrations and all database integration evidence for Inventory.
- Boundary: 26.7 is the Calendar Versioning Innovation track under MySQL's [official release model](https://dev.mysql.com/doc/refman/26.7/en/mysql-releases.html); the [26.7 release notes](https://dev.mysql.com/doc/relnotes/mysql/26.7/en/) list 26.7.0 and later patches. A later patch such as 26.7.1 is not silently accepted; changing the exact version requires compatibility review. Current CI remains `mysql:8.0` until P0 changes and verifies it.

## Independent review and baseline approval

- Reviewer / method: Sam / `HUMAN`.
- Historical decision: approved the 0.3 requirement/design baseline and P0→P5 plan/order after `HD-001`–`HD-004` were propagated.
- Binding: design `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`; plan `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`. Later requirement/design/plan changes invalidate the affected approval and require re-review.
- Current decision: Sam independently approved design `f163be7810a83112d23a8a3d18c501f242dd623e52f00ef75d8fd05e2ddd6a41` and plan `b9a4a3874e84e70b1025b0d2fb9d06ff7f80bd66b5ff3aa4e1bc8fa93dc84bb9` on 2026-09-23. Resuming `IMPLEMENT` remains a separate explicit decision.

## Readiness and next safe action

- Design/review: final 0.4 planning baseline approved with zero open CRITICAL/HIGH review findings; CI/runtime alignment is an accepted P0 prerequisite.
- Implementation readiness: `PLANNED`; every Task remains `PENDING` and no product code has started.
- Business/release: not accepted and not approved.
- Next safe action: separately ask Sam whether to resume `IMPLEMENT`; if confirmed, P0 first reconciles CI and the isolated local runtime to exact MySQL Server 26.7.0 before migration verification.

# Fulfillment & Shipping Management Existing Artifact Inventory and Consolidation Dry Run

## Scope and recoverable baseline

- Module: `fulfillment-shipping-management`
- Selected directory: `docs/fulfillment_shipping_management`
- Mode: `REVIEW_AND_ALIGN`; no application source code is written in this run.
- Mode-entry recovery point: Git commit `b6f03219259129de6735263a4d369de2b15a5f9f`. `git fetch origin --prune` showed local `main` and `origin/main` at the same commit, and the working tree carried no tracked modifications, so the recovery point is observed rather than assumed.
- Topic branch / worktree: `codex/fulfillment-shipping-harness-v2-alignment` / `/Users/sam/Documents/workspace/erp-app-worktrees/fulfillment-shipping-alignment`, created from that commit.
- Pre-alignment module state: `git ls-tree origin/main -- docs/fulfillment_shipping_management` returns exactly the four legacy narratives listed below, all tracked and clean at the recovery point.
- Product source was read as verification evidence only: `package.json`, `client/package.json`, `server/package.json`, `.github/workflows/ci.yml`, `server/src/modules/**`, `client/src/pages/**` and `server/src/modules/authorization/permissionCatalogue.js`.

| Source | Type / authority | Source hash / recovery | Canonical destination | Unique content / assets | Planned action | Link check | Human decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `requirement.md` | Primary business-requirement narrative, 0.1 Draft | `bdaf1cb263b1737183706b6ff388b98cc2b628c09c174b139b7a882775fe4233`; Git recovery point above | `01_requirement_spec.md` | 9 objectives, 10 KPIs, 5 capabilities, 107 legacy FRs, 12 SECs, 7 numbered NFRs plus 19 unnumbered non-functional statements, 36 BRs, 56 ACs, DEC-001–010, GATE-001–007, glossary, state tables, error handling, go-live and sign-off tables | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | `tasks.md` → `05_development_tasks.md`; `design_spec.md` → `03_design_spec.md` | HD-002: Sam approved the aligned baseline as named independent human reviewer |
| `design_spec.md` | Primary system-design narrative, "Implementation-ready" | `89ea6e33a4f1707fbc01a6cac73e408310f589f295284353964665b7665bee1a`; Git recovery point above | `03_design_spec.md` | FSD-001–012 locked decisions, GATE closure table, component architecture, two-phase Confirm/Reversal, global lock order, three-layer idempotency, state machines and quantity invariants, 17 Active tables plus 12 archive mirrors, HTTP API contracts, stable error catalogue, provider/consumer contracts, permission and threat model, 11 services, migration slices, frontend design, 8-layer test design, configuration/observability/runbooks, deployment and rollback | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | `requirement.md` → `01_requirement_spec.md`; `test_case.md` → `07_uat_test_cases.md` | HD-001: compatibility baseline corrected from MySQL 5.7 to MySQL 8.0 |
| `tasks.md` | Primary development-plan narrative, planning only | `1d3af7a26cdd0571370bffe2c88d4537b49aafb5858ec86f1b7fcfe2f360ef01`; Git recovery point above | `05_development_tasks.md` | 4 Phases, 45 Tasks with acceptance criteria, verification commands, dependencies, file estimates and sizes, 4 Phase Gates, dependency graph, parallelism rules, shared hotspots, Phase test cycle table, requirement/Phase traceability, 10 risks, explicit exclusions and change control | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | `requirement.md`/`design_spec.md`/`test_case.md` references replaced with canonical filenames; MySQL 5.7 corrected | HD-001 propagated to §1.2 |
| `test_case.md` | Primary business UAT narrative; every case `NOT RUN` | `a63d23c22b3a39d09e4b6aba0f7c99ed26ba5eeae4481769c21d5dd41a9f36e9`; Git recovery point above | `07_uat_test_cases.md` | 9 actor roles, 40+ fixture definitions, entry/exit criteria, 11 risk priorities, evidence rules, 120 detailed UAT cases with evidence and status columns, AC coverage matrix, 4 UAT batches, defect severity table, residual risks, execution and sign-off tables | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | Source references replaced with canonical 0.2 filenames; a technical-test source row was added | Business acceptance remains outstanding (§12.4 sign-off table is still empty) |
| Design §11 and tasks §7 | Technical-test source narrative, not execution evidence | Included in the design and tasks hashes above | `06_technical_test_cases.md` | Unit, real-MySQL integration, API contract, provider/consumer contract, frontend, security, performance/capacity and backup/restore/reconciliation intent | `GENERATE` a standalone current technical-test specification | Traced to canonical requirement/design/task IDs | No case may be marked PASS in this mode |
| Requirement §19.1, design §14.1, tasks §8, UAT §6 and §8 | Editable legacy traceability summaries, not typed authority | Included in the four hashes above | `08_traceability.json` and generated `08_traceability_matrix.md` | Objective/capability, FR-group, BR/SEC/NFR, AC and Phase coverage tables | `VERIFY`, encode typed relations, then regenerate the matrix | Matrix is byte-derived from the ledger | 11 missing UAT links repaired; see `00_gap_analysis.md` `GAP-TR-001` |

## Source-to-destination content verification

Each legacy narrative was moved as one complete body into its canonical destination. Harness 2.0 formal definitions were appended after the preserved body; no legacy section, table, diagram, decision, assumption, risk or sign-off field was discarded.

A line-level comparison was run after generation. Every non-blank source line is present verbatim in its destination except the lines listed below, each of which is an explicitly approved edit:

| Legacy source range | Surviving destination | Intentional edits |
| --- | --- | --- |
| `requirement.md` entire file, §§0–19 (770 non-blank lines) | `01_requirement_spec.md`, preserved body plus §20 formal definitions | 5 lines: title suffix, version 0.1 Draft → 0.2 Approved Planning Baseline, document-status row, `tasks.md` → `05_development_tasks.md`, `design_spec.md` → `03_design_spec.md`. A UI/UX baseline row and a 0.2 version-history row were added. |
| `design_spec.md` entire file, §§0–14 (1,281 non-blank lines) | `03_design_spec.md`, preserved body plus §15 formal definitions | 7 lines: title suffix, requirement source, target stack MySQL 5.7 → 8.0, document-status row plus an added version row, FSD-012 rationale, §4.1 CHECK-constraint rule, §14.1 `test_case.md` reference |
| `tasks.md` entire file, §§0–11 (842 non-blank lines) | `05_development_tasks.md`, preserved body plus §12 formal definitions | 8 lines: title suffix, source basis, task-status row, Task List target reference, §1.2 MySQL 5.7 → 8.0, P0-T01 self-reference, §8 `test_case.md` reference, §10 requirement/design references |
| `test_case.md` entire file, §§0–12 (387 non-blank lines) | `07_uat_test_cases.md`, preserved body plus §13 formal definitions | 4 lines: title suffix, requirement, design and plan source references (a technical-test source row was added) |
| Design §11, tasks §7 | `06_technical_test_cases.md` 12 formal cases; the underlying detail stays in `03_design_spec.md` and `05_development_tasks.md` | New file; nothing removed |

Counts preserved: 107 FR + 12 SEC + 26 NFR = 145 requirements, 14 design entities, 4 Phases, 45 Tasks, 12 technical cases and 120 UAT cases. `OBJ-01`–`OBJ-09`, `KPI-01`–`KPI-10`, `FUL-CAP-01`–`FUL-CAP-05`, `BR-001`–`BR-036`, `AC-001`–`AC-056`, `DEC-001`–`DEC-010`, `GATE-001`–`GATE-007` and `FSD-001`–`FSD-012` remain narrative objectives, rules, acceptance criteria and decisions carried by the requirement, design and test entities; they are deliberately not separate traceability nodes.

## Verified deletions

`requirement.md`, `design_spec.md`, `tasks.md` and `test_case.md` are removed in the same documentation change that adds the canonical set, after the line comparison above confirmed no unintended loss. The exact pre-alignment bodies remain recoverable at commit `b6f03219259129de6735263a4d369de2b15a5f9f` with the hashes recorded in this table.

## Protected machine authorities and verification inputs

No OpenAPI document, JSON Schema, migration file, executable test or diagram source exists inside the selected module directory, so none was deleted. The ASCII architecture, state-machine, transaction, dependency and ER diagrams inside the legacy bodies were preserved in place inside their canonical destinations, as were the JSON and JavaScript contract examples in design §5 and §6.

Repository authorities used only as read-only verification inputs and left untouched: `server/src/modules/authorization/permissionCatalogue.js`, `server/src/services/idempotency/IdempotencyService.js`, `server/src/modules/item/ItemLookupService.js`, `server/src/modules/**`, `client/src/pages/**`, `client/config/**`, `package.json`, `client/package.json`, `server/package.json` and `.github/workflows/ci.yml`.

## Out-of-scope references observed but not edited

A repository-wide search for `fulfillment_shipping_management` outside the selected directory found three references:

| Reference | Effect after deletion | Disposition |
| --- | --- | --- |
| `docs/customer_management/00_module_manifest.json` `contracts.consumed[]` `customer-consumer-contract`, `source: docs/fulfillment_shipping_management/design_spec.md`, `sha256: 89ea6e33a4f1707fbc01a6cac73e408310f589f295284353964665b7665bee1a` | Becomes a dangling path; the pinned hash no longer resolves, so a future Customer gate cannot verify the contract. The correct replacement is `03_design_spec.md` with sha256 `7c0101e85f9651b8588fe3b09508cc7961238a69d9903c33d7a8f8bd8e2de4ec`. | `CLOSED` by PR #97 (merge commit `34563b6`). `docs/customer_management/**` is an `approval_required_path` in this module's manifest and belongs to another approved module baseline, and `validate_module_boundary.py` returned `MODE_WRITE_DENIED` when the fix was bundled into a `REVIEW_AND_ALIGN` change — document-only mode may write only inside the selected module directory. It was therefore delivered as a separate Customer-module-scoped pull request, mirroring PR #92. Tracked as `GAP-TR-002`. |
| `docs/inventory_management/00_module_manifest.json` line 48 (`docs/fulfillment_shipping_management/**` in `approval_required_paths`) | Directory-level rule; stays correct after the filenames change. | No action. |
| `docs/invoicing_accounts_receivable_management/00_artifact_inventory.md` line 24 | Names the legacy filenames inside another module's historical inventory record. | Left as written. An artifact inventory is a dated audit record of what was observed at that time, not a live link; rewriting it would falsify that record. |

`REVIEW_AND_ALIGN` write scope is limited to `docs/fulfillment_shipping_management`, so no other module directory was modified.

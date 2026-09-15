# Purchasing & Receiving Management Existing Artifact Inventory and Consolidation Dry Run

## Scope and recoverable baseline

- Module: `purchasing-receiving-management`
- Selected directory: `docs/purchasing_receiving_management`
- Mode: `REVIEW_AND_ALIGN`; no application source code is written in this run.
- Mode-entry recovery point: Git commit `a3040c96e1aa92902df964d44a1ad0b83f37f844`, observed as the freshest `origin/main` after `git fetch origin --prune`. The local `main` checkout was 4 commits behind at entry, so the worktree was created from `origin/main`, not from local `main`.
- Topic branch / worktree: `codex/purchasing-receiving-harness-v2-alignment` / `/Users/sam/Documents/workspace/erp-app-worktrees/purchasing-receiving-harness-v2-alignment`.
- Pre-alignment module state: all four legacy narratives are tracked and clean at the recovery point; `git ls-tree origin/main -- docs/purchasing_receiving_management` returns exactly those four files, so the recovery point is verified rather than assumed.
- Product source is verification evidence only in this mode. Reads were limited to `package.json`, `server/package.json`, `.github/workflows/ci.yml`, `server/src/modules/**`, `server/database/migrations/**`, `client/src/pages/**` and `server/test-support/testEnv.js`.

| Source | Type / authority | Source hash / recovery | Canonical destination | Unique content / assets | Planned action | Link check | Human decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `requirement.md` | Primary business-requirement narrative, 0.1 Draft | `f5db1cbf3b047b92e4272738f99fd0f6a27ed76aca98b55c62dc13a8f7523b2b`; Git recovery point above | `01_requirement_spec.md` | 8 objectives, 9 KPIs, 7 capabilities, 132 legacy FRs, 52 BRs, 16 SECs, 16 NFRs, 55 ACs, DEC-001–013, ASM-001–005, OPEN-001–006, go-live and data-migration requirements | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | `design_spec.md` references replaced with `03_design_spec.md` | HD-002 answered: OPEN-001–005 adopted as approved business rules; BR-038/BR-039/§18.3 rewritten accordingly |
| `design_spec.md` | Primary system-design narrative, 0.1 Draft | `b09f5726d4b119e1e7775157f42eb37fd9aa4542ea0299a99d4aae9703157c95`; Git recovery point above | `03_design_spec.md` | Architecture, transaction/lock/idempotency design, 15 table designs, API contracts, permission and threat model, UI/UX, 9 services, file change inventory, test design, config/ops, 5-phase rollout, requirement traceability | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | `requirement.md` references replaced with `01_requirement_spec.md` | HD-003 answered: compatibility baseline corrected from MySQL 5.7 to MySQL 8.0 |
| `tasks.md` | Primary development-plan narrative, planning only | `a279f1c436b6d080ac641c7a1e70a37de523c53cf4b7cb3143dcc975c6a0af08`; Git recovery point above | `05_development_tasks.md` | 5 phases, 44 tasks with acceptance conditions, verification commands, dependencies, file estimates, sizes, 5 checkpoints, phase-level traceability, 9 risks, pre-implementation confirmation points | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | `test_case.md` reference replaced with `07_uat_test_cases.md`; MySQL 5.7 corrected | HD-003 propagated; HD-004 approves the plan as a planning baseline only |
| `test_case.md` | Primary business UAT narrative; every case `NOT RUN` | `c70bc38601d83c75cf5154bc6e2443f686b705afac3f3a3bf650d2917235a20f`; Git recovery point above | `07_uat_test_cases.md` | 10 actor roles, 35 fixture definitions, entry/exit criteria, 9 risk priorities, evidence rules, 106 detailed UAT cases with evidence and status columns, AC coverage matrix | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | Source references replaced with canonical 0.2 filenames | Business acceptance remains outstanding |
| Design §10–§11 and tasks §1.2 | Technical-test source narrative, not execution evidence | Included in the design and tasks hashes above | `06_technical_test_cases.md` | Unit, integration, concurrency, failure-injection, contract, Vue, security, performance, backup/restore intent | `GENERATE` a standalone current technical-test specification | Traced to canonical requirement/design/task IDs | No case may be marked PASS in this mode |
| Requirement §19.1, design §14, tasks §7, UAT §6 | Editable legacy traceability summaries, not typed authority | Included in the four hashes above | `08_traceability.json` and generated `08_traceability_matrix.md` | Objective/capability, FR-group, BR/SEC/NFR, AC and decision coverage tables | `VERIFY`, encode typed relations, then regenerate the matrix | Matrix is byte-derived from the ledger | Two missing UAT links repaired; see `00_gap_analysis.md` GAP-TR-001 |

## Source-to-destination content verification

Each legacy narrative was moved as one complete body into its canonical destination. Harness 2.0 formal definitions were appended after the preserved body; no legacy section, table, diagram, decision, assumption, risk or sign-off field was discarded.

A line-level comparison was run after generation. Every non-blank source line is present verbatim in its destination except the lines listed below, each of which is an explicitly approved edit:

| Legacy source range | Surviving destination | Intentional edits |
| --- | --- | --- |
| `requirement.md` entire file, §§0–19 | `01_requirement_spec.md`, preserved body plus §20 formal definitions | 16 lines: title suffix, version 0.1→0.2 plus a document-status row, `design_spec.md`→`03_design_spec.md` (×2), §0.3 OPEN summary, BR-038, BR-039, and the §18.3 table rewritten from six open gates to five DECIDED plus one OPEN |
| `design_spec.md` entire file, §§0–15 | `03_design_spec.md`, preserved body plus §16 formal definitions | 7 lines: title suffix, version, requirement source, target stack MySQL 5.7→8.0, §4.1 CHECK-constraint rule, §15.1 DBA line, §15.3 change-control reference |
| `tasks.md` entire file, §§0–9 | `05_development_tasks.md`, preserved body plus §10 formal definitions | 6 lines: title suffix, source basis plus a document-status row, task-list convention reference, `test_case.md` reference, MySQL 5.7→8.0 (×2) |
| `test_case.md` entire file, §§0–9 | `07_uat_test_cases.md`, preserved body plus §10 formal definitions | 3 lines: title suffix, requirement and design source references (a technical-test source row was added) |
| Design §10–§11, tasks §1.2 | `06_technical_test_cases.md` 12 formal cases; the underlying detail stays in `03_design_spec.md` and `05_development_tasks.md` | New file; nothing removed |

Counts preserved: 132 FR + 16 SEC + 16 NFR = 164 requirements, 52 BRs, 55 ACs, 12 design entities, 5 phases, 44 tasks, 12 technical cases and 106 UAT cases. `BR-001`–`BR-052` and `AC-001`–`AC-055` remain narrative rules and acceptance criteria carried by the requirement and test entities; they are deliberately not separate traceability nodes.

## Verified deletions

`requirement.md`, `design_spec.md`, `tasks.md` and `test_case.md` are removed in the same documentation change that adds the canonical set, after the line comparison above confirmed no unintended loss. The exact pre-alignment bodies remain recoverable at commit `a3040c96e1aa92902df964d44a1ad0b83f37f844` with the hashes recorded in this table.

## Protected machine authorities and verification inputs

No OpenAPI document, JSON Schema, migration file, executable test or diagram source exists inside the selected module directory, so none was deleted. The ASCII ER and dependency diagrams inside the legacy bodies were preserved in place inside their canonical destinations.

Repository authorities used only as read-only verification inputs and left untouched: `server/src/modules/authorization/permissionCatalogue.js`, `server/src/services/idempotency/IdempotencyService.js`, `server/src/modules/item/ItemLookupService.js`, `server/src/modules/businessMaster/**`, `server/database/migrations/**`, `client/config/menu.js`, `client/src/framework/http/errorMessages.js`, `package.json`, `server/package.json` and `.github/workflows/ci.yml`.

## Out-of-scope references observed but not edited

A repository-wide search for `purchasing_receiving_management` outside the selected directory found six references. Four are directory-level `approval_required_paths` entries (`docs/inventory_management`, `docs/items_management`, `docs/business_master`, `docs/supplier_management`) that stay correct. Two point at deleted filenames:

| Reference | Effect after deletion | Disposition |
| --- | --- | --- |
| `docs/supplier_management/00_module_manifest.json` `contracts.consumed[]` `supplier-consumer-contract`, `source: docs/purchasing_receiving_management/design_spec.md`, `sha256: b09f5726d4b119e1e7775157f42eb37fd9aa4542ea0299a99d4aae9703157c95` | Becomes a dangling path; the pinned hash no longer resolves. The correct replacement is `03_design_spec.md` with hash `a29fb66d0e5ad10c638e5c556e40cf16c534cfce7c7283077a8f922a8fd0ee70`. | `ASSIGNED` to the Supplier module owner by the module owner's decision on 2026-09-14. `docs/supplier_management/**` is an `approval_required_path` in this module's manifest and belongs to an already-approved Supplier baseline, so this run records the required change and does not apply it. Tracked as `GAP-TR-002`. |
| `docs/invoicing_accounts_receivable_management/00_artifact_inventory.md` line 22 | Names the old filenames inside another module's historical inventory record. | Left as written. An artifact inventory is a dated audit record of what was observed at that time, not a live link; rewriting it would falsify that record. |

`REVIEW_AND_ALIGN` write scope is limited to `docs/purchasing_receiving_management`, so no other module directory was modified.

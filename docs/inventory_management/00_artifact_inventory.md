# Inventory Management Existing Artifact Inventory and Consolidation Dry Run

## Scope and recoverable baseline

- Module: `inventory-management`
- Selected directory: `docs/inventory_management`
- Mode-entry recovery point: Git commit `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7`, which was the refreshed `main` / `origin/main` at entry.
- First alignment delivery baseline: `46c1235dfd169e15da38e0de1b5ce1818dbabb0d`; first alignment branch `codex/inventory-management-docs-align` was merged by PR #85 and subsequently cleaned up.
- Refreshed default baseline for the approved decision alignment: `b948c92fecc31555bdc4043feea26f8c72ddf7a2`.
- Current topic branch: `codex/inventory-decision-alignment`.
- Pre-alignment module state: all four narrative inputs are tracked and clean at the recovery point.
- Product source is verification evidence only in `REVIEW_AND_ALIGN`; no product-code write is authorized.

| Source | Type / authority | Source hash / recovery | Canonical destination | Unique content / assets | Planned action | Link check | Human decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `requirement.md` | Primary business-requirement narrative; original Draft now superseded by approved planning baseline | `b97e38187a779403d63210e59a7ec4a8b8d8d9bb2206f96585d2e98c330fc08f`; Git recovery point above | `01_requirement_spec.md` | Complete scope, 125 legacy FRs, 45 BRs, 14 SECs, 14 NFRs, 50 ACs and original DEC-001–020; current canonical baseline adds DEC-021–026 | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | Replace active references with canonical names | Sam approved the current requirement/design planning baseline; explicit `IMPLEMENT` authorization remains deferred |
| `design_spec.md` | Primary system-design narrative; original Draft now superseded by approved planning baseline | `6bc44d5bbf0a1aa066ac3d6c6ffa61e8fc6ecf6fe8a4377f4c4db5ef669d498a`; Git recovery point above | `03_design_spec.md` | Architecture, data model, APIs, security, UI, operations, test design and delivery sequence | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | Replace active references with canonical names | Sam approved the current design baseline with MySQL 8.0; explicit `IMPLEMENT` authorization remains deferred |
| `tasks.md` | Primary development-plan narrative; original Draft now superseded by approved planning baseline | `76afe464a4382053e2ac6f44dff71a1cdf21bfe0dcdfd2da7a3e8fa4b52059e6`; Git recovery point above | `05_development_tasks.md` | Six Phase boundaries, detailed tasks, gates, dependencies, risks and rollout controls | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | Replace active references with canonical names | Sam approved the current P0→P5 plan; explicit `IMPLEMENT` authorization remains deferred |
| `test_case.md` | Primary business UAT narrative; all cases `NOT RUN` | `4c346f7203ef83ab257667ef09b886d2c9b8ea0c5c009174dca03f932a23496b`; Git recovery point above | `07_uat_test_cases.md` | Actors, fixtures, entry/exit rules, detailed UAT cases and sign-off fields | `MERGE_INTO_CANONICAL`, then `DELETE_AFTER_MERGE` | Replace active references with canonical names | Business acceptance remains outstanding |
| Existing design §§9–10 and task §5 | Technical-test source narrative, not execution evidence | Included in the two hashes above | `06_technical_test_cases.md` | Unit, integration, concurrency, security, performance, recovery and UI validation intent | `GENERATE` formal current test specification | Trace to canonical requirement/design/task IDs | No case may be marked PASS in this mode |
| Existing traceability summaries | Editable legacy summaries, not typed authority | Included in source hashes above | `08_traceability.json` and generated `08_traceability_matrix.md` | Legacy requirement/category coverage and Phase/UAT mappings | `VERIFY`, encode relations, then regenerate | Matrix must be byte-derived from ledger | Semantic approval remains separate |

## Source-to-destination content verification

Each legacy narrative is moved as one complete body into its canonical destination. Alignment metadata and formal Harness 2.0 definitions are added around that body; no legacy section, table, diagram, decision, risk, pending item or sign-off field is intentionally discarded. In-body edits are limited to link/name corrections from deleted legacy filenames plus the 2026-09-14 owner-approved disposition of `DEC-014`–`DEC-026`, MySQL 8.0 compatibility baseline and explicit deferral of `IMPLEMENT`.

| Legacy source range | Surviving destination |
| --- | --- |
| `requirement.md` entire file, §§0–19 | `01_requirement_spec.md`, preserved legacy body plus formal requirement definitions |
| `design_spec.md` entire file, §§0–14 | `03_design_spec.md`, preserved legacy body plus formal design definitions |
| `tasks.md` entire file, §§0–9 | `05_development_tasks.md`, preserved legacy body plus formal Phase/Task definitions |
| `test_case.md` entire file, §§0–9 | `07_uat_test_cases.md`, preserved legacy body plus formal UAT definitions |
| Design §§9–10, §13.4 and task §5 | `06_technical_test_cases.md` formal technical cases; original supporting detail remains in `03_design_spec.md` and `05_development_tasks.md` |

## Verified deletions

The four superseded narrative filenames were removed as part of the same documentation change after an initial byte comparison confirmed that every source line survived in its canonical destination, except for the documented title suffix and active filename-link corrections. Initial results: requirement `958/958` lines, design `1775/1775`, tasks `1494/1494`, and UAT `336/336`. The later approved decision/baseline edits are explicitly recorded above; the exact pre-decision bodies remain recoverable at Git commit `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7`.

An adjacent, out-of-scope inventory entry at `docs/invoicing_accounts_receivable_management/00_artifact_inventory.md` still names the former requirement/design paths. `REVIEW_AND_ALIGN` write scope is limited to `docs/inventory_management`, so this run records but does not edit that separate module.

## Protected machine authorities and verification inputs

No OpenAPI, JSON Schema, migration or diagram-source file exists inside the selected module directory. Repository authorities used for verification remain untouched, including `server/src/modules/authorization/permissionCatalogue.js`, `server/src/services/idempotency/IdempotencyService.js`, `server/src/modules/item/ItemLookupService.js`, `server/database/migrations/**`, package manifests and `.github/workflows/ci.yml`.

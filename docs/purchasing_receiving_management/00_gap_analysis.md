# Purchasing & Receiving Management Gap Analysis

## Scope and method

Mode `REVIEW_AND_ALIGN` against the four legacy narratives at commit `a3040c96e1aa92902df964d44a1ad0b83f37f844`, cross-checked against the observed repository (source tree, migrations, CI workflow, package manifests) and against the already-aligned Inventory, Supplier, Item, Customer and Business Master modules.

Gap classes follow the harness definitions:

- `DOCUMENTATION_GAP` — the behavior or decision exists but the documentation was missing, stale or inconsistent.
- `IMPLEMENTATION_GAP` — the aligned requirement or design is not satisfied by the observed implementation. In this mode these become planned Phases/Tasks; no application code is written.
- `UNKNOWN` — evidence is insufficient to classify.

## Baseline observation: nothing is implemented

At the observed baseline `server/src/modules/` contains `audit`, `authorization`, `businessMaster`, `item`, `role`, `user`. There is no `purchasing`, `receiving`, `supplier` or `inventory` module, no `server/src/handlers/purchasing` or `.../receiving`, no `client/src/pages/purchasing` or `.../receiving`, and no purchasing migration among the 27 files in `server/database/migrations/`. Every functional requirement in this module is therefore an `IMPLEMENTATION_GAP` by definition, and every Task in `05_development_tasks.md` remains `PENDING`. The gaps below are the ones that are *not* simply "not built yet".

## Documentation gaps closed by this alignment

| ID | Severity | Evidence | Impact | Action taken | Human decision |
| --- | --- | --- | --- | --- | --- |
| GAP-RQ-001 | HIGH | `requirement.md` §18.3 listed OPEN-001–006 as unconfirmed, while `design_spec.md` §0.2 already declared OPEN-001–005 closed with concrete business rules. BR-038 and BR-039 still carried the "pending" wording. | Two active documents disagreed about whether Blocked-supplier receiving, post-confirmation SKU status changes, money precision, numbering and printing were decided. An implementer reading only the requirement would treat five settled rules as open. | Design's resolutions adopted as the approved business baseline; §18.3 rewritten as five `DECIDED` rows plus `OPEN-006`; BR-038 and BR-039 rewritten to state the decided rules; §0.3 summary updated. | HD-002 — answered by the owner during this run. |
| GAP-DES-001 | HIGH | `design_spec.md` §0 target stack and §4.1 stated MySQL 5.7 and explicitly "does not rely on CHECK constraints"; `.github/workflows/ci.yml` runs `mysql:8.0`; `docs/inventory_management` records MySQL 8.0 as the approved compatibility baseline (its HD-003). `tasks.md` repeated 5.7 in two places. | Table design, constraint strategy, locking assumptions and the DBA review gate were written against a database version the project does not actually run. | Compatibility baseline corrected to MySQL 8.0 in the design header, §4.1 (CHECK constraints now available for single-row guards, cross-row rules stay in service), §15.1 DBA gate and both `tasks.md` occurrences. The correction is marked inline so the change is visible rather than silent. | HD-003 — answered by the owner during this run. |
| GAP-TR-001 | MEDIUM | The legacy UAT `Requirement／Risk` column abbreviates references. After expansion, `FR-SET-005` (now `FR-001`-series `FR-005`) and `FR-APPROVAL-012` (now `FR-047`) were referenced by no case, although SET-005, APP-001, APP-004, APP-003 and APP-005 clearly exercise them. | Two requirements would have shown zero UAT coverage in the generated matrix, understating real coverage. | Links added in `08_traceability.json` and recorded in `07_uat_test_cases.md` §10.2. No case step, expected result or evidence field was modified. | Not material; recorded. |
| GAP-DOC-001 | MEDIUM | The module had no `00_*` typed records, no requirement/design review, no standalone technical-test specification, no traceability ledger and no generated matrix — the only module besides `fulfillment_shipping_management` still on the four-file legacy layout. | Nothing bound approvals to a specification hash, no reviewer provenance existed, and the technical-test intent lived only inside design prose. | Added `00_module_manifest.json`, `00_project_profile.json`, `00_harness_state.json`, `08_traceability.json`, `02_requirement_review.md`, `04_design_review.md`, `06_technical_test_cases.md`, the generated `08_traceability_matrix.md` and `09_final_alignment_review.md`. | Not material; standard alignment. |

## Gaps recorded but deliberately not closed

| ID | Class | Severity | Evidence | Impact | Proposed action | Human decision |
| --- | --- | --- | --- | --- | --- | --- |
| GAP-TR-002 | DOCUMENTATION_GAP | MEDIUM | `docs/supplier_management/00_module_manifest.json` pins `contracts.consumed[].source = docs/purchasing_receiving_management/design_spec.md` with `sha256 b09f5726…`, which this change deletes. | The Supplier module's consumed-contract pointer becomes dangling, so a future Supplier gate cannot verify the contract hash. | Update that entry to `03_design_spec.md` with `sha256 a29fb66d0e5ad10c638e5c556e40cf16c534cfce7c7283077a8f922a8fd0ee70`. | `ASSIGNED`. The module owner decided on 2026-09-14 that the Supplier module owner applies this change; `docs/supplier_management/**` is an approval-required path belonging to another approved module baseline and was not edited here. Tracked for Supplier, not for Purchasing. |
| GAP-RQ-002 | UNKNOWN | HIGH for Go-Live only | `requirement.md` §16 and §18.3 `OPEN-006`: the first batch of open POs, the cutover date, legacy previously-received quantities and the Inventory Opening reconciliation owner are undefined. | Go-Live cannot be signed off; `TASK-044` and the OPS UAT cases cannot produce real evidence. | Keep `OPEN-006` open. `TASK-044` and Go-Live sign-off stay `BLOCKED` until business supplies the cutover data and names the reconciliation owner. | Deferred by agreement; does not block design or development. |
| GAP-DES-002 | DOCUMENTATION_GAP | MEDIUM | `design_spec.md` §15.2 requires the formal currency list and each currency's decimal places, with at least an HKD seed. Business Master landed a backend foundation in PR #89 but no purchasing-facing currency/payment-term read contract has been verified. | `DES-003` money rounding depends on per-currency decimal places; `TC-002` cannot be fully specified against real data until the catalogue is fixed. | Verify against Business Master during `PHASE-001` (`TASK-001`) and record the result as a contract test rather than an assumption. | Not material now; becomes material at `PHASE-001`. |
| GAP-ENV-001 | UNKNOWN | LOW | The local `mysql --version` reports `26.7.0`, while the approved server compatibility baseline and the CI service image are MySQL 8.0. | A local integration run does not prove behavior on the approved baseline. | `00_project_profile.json` probes only for the presence of a MySQL client; the authoritative 8.0 verification is the CI check `Test (server + client, MySQL integration)`. Local-only results must not be reported as baseline evidence. | Not material; recorded so it is not mistaken for a passing 8.0 verification. |

## Implementation gaps converted into planned work

These are the hard dependencies that make `PHASE-001` a real gate rather than a formality. None of them is a documentation problem; each is already an explicit Task.

| ID | Class | Evidence at baseline | Blocked scope | Planned work |
| --- | --- | --- | --- | --- |
| GAP-IMP-001 | IMPLEMENTATION_GAP | No `server/src/modules/supplier` exists. | `FR-019`, `FR-020`, `FR-035`, `FR-123`; all PO creation | `TASK-004` (`P0-T04`) in `PHASE-001`; hard blocker |
| GAP-IMP-002 | IMPLEMENTATION_GAP | No `server/src/modules/inventory` exists; no batch receipt or partial reversal contract. | `FR-091`–`FR-114`; all of `PHASE-004` and `PHASE-005` reversal work | `TASK-006`, `TASK-007`; hard blockers |
| GAP-IMP-003 | IMPLEMENTATION_GAP | `server/src/modules/item/ItemLookupService.js` exists but exposes no committed-receipt lookup. | `FR-023`, `FR-024`, `FR-080`, `FR-084`; post-confirmation SKU-change receiving (`GAP-RQ-001` OPEN-002 rule) | `TASK-005` |
| GAP-IMP-004 | IMPLEMENTATION_GAP | `server/src/modules/authorization/permissionCatalogue.js` does not contain the six purchasing/receiving permissions. | `SEC-002`–`SEC-009`; every authorization case | `TASK-003` |
| GAP-IMP-005 | IMPLEMENTATION_GAP | `server/src/services/idempotency/IdempotencyService.js` scopes high-strength routes by IP rather than authenticated user. | `FR-095`, `FR-096`, `NFR-007`; idempotency correctness for approval and receipt confirm | `TASK-002` |

## Result

All documentation gaps found in this run are closed except `GAP-TR-002`, which lies outside this module's write scope and has been assigned to the Supplier module owner, and `GAP-RQ-002` / `OPEN-006`, which is deliberately left open and blocks Go-Live only. No product code was changed, no test was executed, and no case was marked PASS.

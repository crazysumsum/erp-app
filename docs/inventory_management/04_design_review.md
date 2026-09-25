# Inventory Management Design Review

## Review result

`CHANGES_REQUESTED` for the 1.0 candidate until DESIGN `567a0cbe46596cad8cd763b4343ce2133b327c0f7bd565f071b38cf4b51954f7` and PLAN `124950a3fdcd8236ef5a519b47e4f8d779fda8da9696dcb40937d66389dfc2e8` receive Sam's independent approval. The semantic direction is approved by `HD-026`: main owns `0054_create_customer_export_jobs.js`, so Inventory shifts as one contiguous block from `0054`～`0063` to `0055`～`0064` without changing dependency order.

## Reviewer provenance

| Field | Value |
| --- | --- |
| Initial `review_method` | `SELF_REVIEW` by `/root`; retained as historical review `REV-001` |
| Independent `review_method` | `HUMAN` |
| `author` | Existing Inventory design authorship is not authenticated in repository metadata |
| `reviewer` | Sam, named by the user in the active Codex task |
| Historical 0.3 `reviewed_baseline` | `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273` |
| Independent review | 0.3 approved on 2026-09-14; final 0.4 hashes approved by Sam on 2026-09-23 |
| Final 0.4 design baseline | `f163be7810a83112d23a8a3d18c501f242dd623e52f00ef75d8fd05e2ddd6a41` |
| Approved 0.5 design baseline | `23bdae2d85dc2546e641c19ccf3cd604ef3a068fb43149ae10341f0e54c87eef` |
| Product implementation / tests | Not performed |

## Review dimensions

- Requirements and module boundary: Inventory owns Warehouse, Bin and inventory facts; Item, authorization and source documents are read-only dependencies.
- API/interface stability: the Draft defines consistent `/api/v1` command/query patterns, safe errors, boundary validation, idempotency and transaction-aware internal contracts. These are design intentions, not implemented contracts.
- Data integrity: immutable movements, operation identity, Stock Control serialization, fixed lock order, persistent Stocktake locks and fenced Opening address the primary quantity risks.
- Security: authorization freshness, explicit high-risk auth, ownership-safe child lookup, allowlisted projections and audit redaction are present; permissions are not yet in the observed catalogue.
- QA: negative, concurrency, replay, fault-injection, performance and recovery coverage is formalized in `06_technical_test_cases.md`; all cases remain `NOT_RUN`.

## Findings

| ID | Severity | Status | Type | Evidence | Impact / next action |
| --- | --- | --- | --- | --- | --- |
| DR-01 | HIGH | RESOLVED | Requirement ambiguity | `ERP Product Owner (Sam)` approved `DEC-014`–`DEC-019` through `HD-002` on 2026-09-14. | Canonical requirement/design/plan now record the confirmed semantics; this is not whole-design approval. |
| DR-02 | HIGH | RESOLVED | Compatibility ambiguity | `HD-003` selected MySQL 8.0, matching the observed GitHub CI service baseline. | Canonical requirement/design/plan and environment probe now use MySQL 8.0. |
| DR-03 | HIGH | ACCEPTED_PLANNED | Implementation gap | No Inventory product module, handlers, pages, migrations or tests are present. | Expected pre-implementation condition; execute only under a later explicit `IMPLEMENT` authorization and approved Phase plan. |
| DR-04 | HIGH | ACCEPTED_P0 | Security prerequisite | The design records a strong-auth idempotency actor-scope defect; current Inventory permissions also do not exist. | Sam approved keeping these as fail-closed P0 prerequisites with regression coverage before enabling writes. |
| DR-05 | HIGH | RESOLVED | Integration decisions | Serial, low-life override, Returns status, Adjustment reasons and cutover constraints were open. | Resolved by `HD-004` / `DEC-021`–`DEC-026` and propagated to requirements, design, plan and tests. |
| DR-06 | HIGH | RESOLVED | Review provenance | A separate human reviewer was missing. | Sam identified himself as the independent human reviewer and approved the resulting design/plan baseline. |
| DR-07 | HIGH | ACCEPTED_PLANNED | Browser acceptance | No Inventory UI or Playwright Inventory suite exists. | Expected before implementation; Playwright remains mandatory for later UI Phase verification and no PASS is claimed now. |
| DR-08 | HIGH | ACCEPTED_P0 | Compatibility baseline change | `HD-006` supersedes the MySQL 8.0 choice with exact MySQL Server 26.7.0; Sam approved the updated baseline while `.github/workflows/ci.yml` still declares `mysql:8.0`. | P0 must pin CI and local integration runtime to 26.7.0 and verify actual server version before migration work. |
| DR-09 | HIGH | RESOLVED | Migration dependency order | The prior allocation combined P0 operation requests with P1 movements and placed Audit after tables owned by later Phases. | `HD-007` splits operations (`0055`) from movements (`0059`) and places Audit at `0056`; the resulting DESIGN and PLAN are approved. |
| DR-10 | HIGH | RESOLVED | Consumed contract drift | TASK-004 implemented the planned transaction-aware Item lookup methods, but Inventory still pinned the pre-TASK-004 source hash. | `HD-008` adopts `transaction-v1` and binds the manifest to `ca31b00f…`; the resulting DESIGN and PLAN are approved. |
| DR-11 | HIGH | RESOLVED | Publication scope omission | `ItemLookupService.js` required scoped approval, while its planned focused test was outside the manifest boundary. | `HD-010` authorized exactly those two files; Sam approved the resulting 0.7 DESIGN and PLAN. |
| DR-12 | HIGH | RESOLVED_PENDING_APPROVAL | P0 shared-path omission | Reconciliation found ten existing P0 shared/framework changes; four matched existing approval-required rules and six were outside the manifest boundary. | `HD-011` authorizes exactly those ten paths; the candidate adds only the six missing exact entries. Fresh hash-bound approval remains required. |
| DR-13 | HIGH | RESOLVED_PENDING_APPROVAL | Global migration collision | Current local and `origin/main` contain Customer migration `0054_create_customer_export_jobs.js`, while the Inventory branch still uses `0054_seed_inventory_permissions.js`. | `HD-026` selected the minimal contiguous shift to `0055`～`0064`. Existing disposable-schema evidence remains historical under old filenames; implementation and TASK-012 stay blocked until exact candidate hashes are approved. |

## Decision

The 1.0 candidate has no unresolved semantic alternative after `HD-026`, but DR-13 remains `RESOLVED_PENDING_APPROVAL` until Sam approves the exact regenerated DESIGN and PLAN hashes. No migration rename or TASK-012 implementation is authorized by this document alone.

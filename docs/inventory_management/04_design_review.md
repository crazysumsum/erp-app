# Inventory Management Design Review

## Review result

`APPROVED` for the 0.7 Item contract publication scope. Boundary validation found that the already-planned focused test file was not named in `approval_required_paths`. The corrected manifest adds exactly that file; Sam approved DESIGN `474fc6e215cc86ce9be2866c17156e18ac3dc91ad320937af7a310a2a099e08b` and PLAN `12b274ba8529f70c058d9393d9fb83ccc57319641fc3ee756907d73cdc9031e4` on 2026-09-24, with exact two-file scoped approval.

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
| DR-11 | HIGH | RESOLVED_PENDING_APPROVAL | Publication scope omission | `ItemLookupService.js` required scoped approval, while its planned focused test was outside the manifest boundary. | `HD-010` authorizes exactly those two files; the candidate manifest adds only `server/test/itemLookupService.test.js` to `approval_required_paths`. Fresh hash-bound approval remains required. |

## Decision

The 0.7 DESIGN and PLAN have no open CRITICAL/HIGH finding and are approved. Publication scope is limited to the two named Item files; TASK-005 and migration execution remain excluded.

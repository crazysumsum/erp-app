# Purchasing & Receiving Management Design Review

## Review result

`APPROVED` as a planning baseline by human independent reviewer Sam on 2026-09-14. The `OPEN-001`–`OPEN-005` closures, the MySQL 8.0 compatibility baseline and the Phase 0→4 order are confirmed. This review does not authorize entry to `IMPLEMENT`, test execution, UAT, Go-Live or release.

## Reviewer provenance

| Field | Value |
| --- | --- |
| Initial `review_method` | `SELF_REVIEW` by the alignment agent; retained as historical review `REV-001` |
| Independent `review_method` | `HUMAN` |
| `author` | Legacy design authorship is not authenticated in repository metadata |
| `reviewer` | Sam (ERP Product Owner), identified in this session |
| `reviewed_baseline` | File `03_design_spec.md` sha256 `a29fb66d0e5ad10c638e5c556e40cf16c534cfce7c7283077a8f922a8fd0ee70`; binding harness composite design baseline `5db990ab6967fbfaf1813dbf17382802f1362c77fde2c9e51b57e6ac2cbbe9fd` |
| Independent review | Completed and approved on 2026-09-14 |
| Product implementation / tests | Not performed; no PASS claimed |

## Review dimensions

- **Module boundary.** Purchasing and Receiving own PO, approval, goods receipt, reversal, operation and audit data. Supplier, Item, Inventory, User and the currency/payment-term catalogue are read-only provider contracts. `Purchasing must never write inventory balances directly` is stated as a Never-do rule and is consistent with `docs/inventory_management`, which lists `purchasing-receiving` as a consumer of its domain contract.
- **Interface stability.** `/api/v1` GET-for-query / POST-for-command, static handler `api` declarations, AJV schemas with `additionalProperties:false`, projection allowlists and stable public error codes are specified consistently. These are design intentions, not implemented contracts.
- **Data integrity.** Transaction-safe monthly sequences, optimistic versioning on mutable drafts, append-only confirmed history, a fixed global lock order, dual-layer idempotency (HTTP plus permanent domain operation records) and all-or-nothing goods receipt confirm address the primary quantity risks. Base quantities stay positive integers; money uses scaled integers/BigInt with per-currency `ROUND_HALF_UP`.
- **Security.** Six non-inheriting permissions, password re-authentication for approval, device-password for settings and reversal, actor freshness re-checked at both route and transaction commit, owner-safe child lookup returning 404 for both mismatch and absence, and audit/log/CSV redaction are all specified. None of it exists in the observed catalogue yet.
- **QA.** Negative, concurrency, replay, fault-injection, contract, security, performance and restore coverage is formalized as `TC-001`–`TC-012`; all remain `NOT_RUN`.

## Findings

| ID | Severity | Status | Type | Evidence | Impact / next action |
| --- | --- | --- | --- | --- | --- |
| DR-01 | HIGH | RESOLVED | Compatibility ambiguity | Design targeted MySQL 5.7 and declared CHECK constraints unavailable; CI runs `mysql:8.0` and Inventory's approved baseline is 8.0. | `HD-003` selected MySQL 8.0. §0, §4.1, §15.1 and both `tasks.md` occurrences corrected. Single-row guards may now use CHECK; cross-row rules stay in service. See `GAP-DES-001`. |
| DR-02 | HIGH | RESOLVED | Requirement/design conflict | §0.2 closed `OPEN-001`–`OPEN-005` that the requirement still listed as open. | `HD-002` adopted the design resolutions; the requirement was updated to match, so design no longer silently outranks an approved requirement. |
| DR-03 | HIGH | ACCEPTED_PLANNED | Provider implementation gap | No `server/src/modules/supplier` or `.../inventory` exists; `ItemLookupService` has no committed-receipt lookup. | Expected pre-implementation condition. `TASK-004`, `TASK-006`, `TASK-007` are hard `PHASE-001` blockers; `TASK-005` follows. Design forbids stub tables and production fakes. See `GAP-IMP-001`–`003`. |
| DR-04 | HIGH | ACCEPTED_P0 | Security prerequisite | The six module permissions are absent from `permissionCatalogue.js`, and `IdempotencyService` scopes strong-auth routes by IP rather than authenticated user. | Kept as fail-closed P0 prerequisites with regression coverage (`TASK-002`, `TASK-003`) before any write path is enabled. |
| DR-05 | MEDIUM | ACCEPTED_PLANNED | Shared-resource contention | Migration numbering is a global sequence shared with Item, Business Master and future Supplier/Inventory work; the observed next number is `0028`. | The plan already forbids reserving fixed numbers and requires re-fetching the default branch at each Phase start. Recorded in the manifest as `shared_resources`. |
| DR-06 | MEDIUM | OPEN | Currency catalogue | §15.2 requires the formal currency list with per-currency decimal places; Business Master landed only a backend foundation in PR #89 and no purchasing-facing read contract is verified. | Verify during `TASK-001` and encode as a contract test rather than an assumption. See `GAP-DES-002`. |
| DR-07 | HIGH | RESOLVED | Review provenance | No separate reviewer existed for the legacy Draft. | Sam identified himself as the independent human reviewer and approved the resulting design and plan baseline. |
| DR-08 | HIGH | ACCEPTED_PLANNED | Browser acceptance | No purchasing/receiving UI and no Playwright suite exist. | Playwright browser verification remains mandatory for the UI Phases (`PHASE-002`–`PHASE-005`). No browser evidence is claimed now, and none was fabricated. |

## Decision

The aligned design and the Phase 0→4 plan are approved planning baselines with zero open CRITICAL findings and one open MEDIUM finding (`DR-06`) that is scheduled into `PHASE-001`. All implementation gaps remain unstarted Tasks, all tests remain `NOT_RUN`, and `IMPLEMENT` authorization has not been given.

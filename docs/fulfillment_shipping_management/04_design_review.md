# Fulfillment & Shipping Management Design Review

## Review result

`APPROVED` as a planning baseline by human independent reviewer Sam on 2026-09-14. The MySQL 8.0 compatibility baseline and the Phase P0 → P3 order are confirmed. This review does not authorize entry to `IMPLEMENT`, test execution, UAT, Go-Live or release.

## Reviewer provenance

| Field | Value |
| --- | --- |
| Initial `review_method` | `SELF_REVIEW` by the alignment agent; retained as historical review `REV-001` |
| Independent `review_method` | `HUMAN` |
| `author` | Legacy design authorship is not authenticated in repository metadata |
| `reviewer` | Sam (ERP Product Owner), identified in this session |
| `reviewed_baseline` | File `03_design_spec.md` sha256 `7c0101e85f9651b8588fe3b09508cc7961238a69d9903c33d7a8f8bd8e2de4ec`; binding harness composite design baseline `cba0d670c928af3443c6ce6794c955004ee6243a44f4b33bdd2bc3957947b758` |
| Independent review | Completed and approved on 2026-09-14 |
| Product implementation / tests | Not performed; no PASS claimed |

## Review dimensions

- **Module boundary.** Fulfillment owns Fulfillment, Shipment, Reversal, operation, audit, export and archive data. Sales, Inventory, Customer, Item and authorization are read-only or contract-mediated providers. `FSD-004` states Inventory is the single source of truth for balances, reservations, allocations and movements, and `§8.3` forbids reimplementing eligibility or FEFO/FIFO locally — consistent with `docs/inventory_management`, which lists Fulfillment among its consumers.
- **Interface stability.** `/api/v1` GET-for-query / POST-for-command, static handler `api` declarations, AJV strict schemas, decimal-string quantities, server-side projection allowlists and the 20-entry stable error catalogue in §5.6 are specified consistently. These are design intentions, not implemented contracts.
- **Data integrity.** The design closes all seven requirement gates: `active_shipment_id` plus a generated `effective_fulfillment_id` column for single-active-Shipment uniqueness (GATE-001); durable Phase A intent plus single-transaction Phase B with a fixed global lock order and three-layer idempotency (GATE-002); a dedicated Inventory reversal command that restores the original reservation while leaving the original allocation consumed (GATE-003); §3.6 SO recalculation including untabled `CLOSED` reopen (GATE-004); Sales-coordinated atomic archive with per-table count and row-hash verification (GATE-005); the 7.3-million-row capacity model (GATE-006); and Serial rejection at all three submit points (GATE-007).
- **Security.** Three non-inheriting permissions plus `inventory.fefo.override`, actor freshness re-read from the database at every write and job start, owner-safe child lookups returning 404 for both mismatch and absence, CSV formula and XSS handling, log redaction of address and contact payloads, and no HTTP entry point for the dedicated Inventory reversal command. None of it exists in the observed catalogue yet.
- **QA.** Unit, real-MySQL integration, API contract, provider/consumer contract, frontend, security, performance/capacity and backup/restore/reconciliation coverage is formalized as `TC-001`–`TC-012`; all remain `NOT_RUN`.

## Findings

| ID | Severity | Status | Type | Evidence | Impact / next action |
| --- | --- | --- | --- | --- | --- |
| DR-01 | HIGH | RESOLVED | Compatibility ambiguity | Design targeted MySQL 5.7, declared `CHECK` unreliable and cited 5.7 partition limits; CI runs `mysql:8.0` and the Inventory and Purchasing approved baselines are 8.0. `tasks.md` §1.2 repeated 5.7. | `HD-001` selected MySQL 8.0. The design header, FSD-012 rationale, §4.1 and `tasks.md` §1.2 were corrected inline. Single-row guards may now use `CHECK`; cross-row, cross-aggregate and state-machine rules stay in service + trigger + integration test. See `GAP-DES-001`. |
| DR-02 | HIGH | ACCEPTED_PLANNED | Provider implementation gap | No `server/src/modules/sales`, `.../inventory` or `.../customer` exists; `ItemLookupService` has no transaction-aware tracking-policy assert. | Expected pre-implementation condition. `TASK-004`, `TASK-005`, `TASK-006` are hard `PHASE-001` blockers. The plan forbids shadow tables, duplicated domain rules and production fakes. See `GAP-IMP-001`–`004`. |
| DR-03 | HIGH | ACCEPTED_P0 | Security prerequisite | `permissionCatalogue.js` contains none of the three Fulfillment permissions, and `inventory.fefo.override` does not exist. | Kept as fail-closed P0 prerequisites with convention-test coverage (`TASK-002`) before any write path is enabled. See `GAP-IMP-005`. |
| DR-04 | HIGH | OPEN | Browser acceptance tooling | Design §11.5 and §10.6 specify a full frontend and responsive/WCAG test layer, but the repository has no Playwright dependency, config or `client/e2e` directory; `client/package.json` provides only Vitest with jsdom. | `TC-010`'s browser assertions stay `BLOCKED` until a Playwright tool chain and a `client/e2e/fulfillment-shipping-management/**` suite exist. No browser evidence is claimed now, and none was fabricated. Becomes blocking at `PHASE-002`. See `GAP-TC-001`. |
| DR-05 | MEDIUM | ACCEPTED_PLANNED | Shared-resource contention | Migration numbering is a global sequence shared with Item, Business Master and every other planned module; the design deliberately hard-codes no numbers and §9.3 defines eight logical slices instead. | The plan already forbids reserving fixed numbers and requires re-fetching the default branch at each Phase start. Recorded in the manifest as `shared_resources`. |
| DR-06 | MEDIUM | ACCEPTED_PLANNED | Cross-module coordination | `FSD-009` makes the Sales Archive Job the only archive coordinator, and §6.5 requires a Downstream Matter registry that must fail closed when Returns/Invoicing land. | `TASK-041` and `TASK-042` depend on a Sales archive framework that does not exist yet; the registry must register `NO_PROVIDER_REQUIRED` explicitly rather than defaulting to false. |
| DR-07 | HIGH | RESOLVED | Review provenance | No separate reviewer existed for the legacy document; both sign-off tables were empty. | Sam identified himself as the independent human reviewer and approved the resulting design and plan baseline. Business acceptance remains separate and outstanding. |
| DR-08 | LOW | RESOLVED | Requirement coverage | `NFR-023` (provider contract versioning) has no business-observable UAT case. | Recorded as UAT `NOT_APPLICABLE` with reason and approval `HD-003`; `TC-010` keeps it mandatory and blocking at the technical layer. See `GAP-UAT-001`. |

## Decision

The aligned design and the Phase P0 → P3 plan are approved planning baselines with zero open CRITICAL findings and one open HIGH finding (`DR-04`, browser tooling) that must be closed before `PHASE-002` opens any UI route. All implementation gaps remain unstarted Tasks, all tests remain `NOT_RUN`, and `IMPLEMENT` authorization has not been given.

# Inventory Management Design Review

## Review result

`CHANGES_REQUESTED` — no critical structural contradiction was found. The accountable owner, `DEC-014`–`DEC-019` and MySQL 8.0 baseline are resolved, but other major design/authority inputs remain open. The design must not enter implementation merely because local traceability becomes structurally valid.

## Reviewer provenance

| Field | Value |
| --- | --- |
| `review_method` | `SELF_REVIEW` |
| `author` | Existing Inventory design authorship is not authenticated in repository metadata |
| `reviewer` | `/root` in the same active Codex context |
| `reviewed_baseline` | `5b229dbdc7e7870e3de1e28352906f17277806d04cd75a4ffc5d853c3b4f8007` |
| Independent review | Required by manifest; not observed |
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
| DR-03 | HIGH | OPEN | Implementation gap | No Inventory product module, handlers, pages, migrations or tests are present. | Execute only under a later approved `IMPLEMENT` mode and Phase plan. |
| DR-04 | HIGH | OPEN | Security prerequisite | The design records a strong-auth idempotency actor-scope defect; current Inventory permissions also do not exist. | Keep P0 fail-closed and require regression before enabling state-changing routes. |
| DR-05 | HIGH | OPEN | Integration decisions | Serial handling, low-life override, Returns status and Adjustment reason categories remain open. | Resolve before their declared Phase gates; do not guess in implementation. |
| DR-06 | HIGH | OPEN | Review provenance | No separate reviewer or human whole-design approval is observed. | Obtain an actual independent review and baseline-bound human disposition. |
| DR-07 | HIGH | OPEN | Browser acceptance | No Inventory UI or Playwright Inventory suite exists. | Implement and validate with Playwright in the authorized later stage; current UAT is specification-only. |

## Decision

The aligned design is suitable as a single review baseline, not as an approved implementation baseline. Five open HIGH findings remain visible in `00_gap_analysis.md` and `00_harness_state.json`.

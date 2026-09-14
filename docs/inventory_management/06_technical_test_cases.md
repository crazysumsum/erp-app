# Inventory Management Technical Test Specification

## Status and execution boundary

All cases are specification-only and `NOT_RUN`. `REVIEW_AND_ALIGN` authorizes no product implementation, test execution, Technical Acceptance or UAT sign-off. P0/P1 data-integrity and security cases must exist before execution, and actual results must bind to an immutable baseline.

## TC-001 — Authentication, authorization and boundary validation

### Preconditions and data
Authenticated role/device fixtures, stale-role cases and malicious boundary inputs in an isolated environment.

### Steps
Exercise 401/403, ID substitution, stale authorization, strict schemas, injection/XSS/CSV payloads and sensitive-data redaction.

### Expected result
Every unauthorized or invalid path fails closed with stable safe errors, no state change and sufficient non-sensitive audit evidence.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-002 — Warehouse and Bin master integrity

### Preconditions and data
Fresh and referenced Warehouse/Bin fixtures with concurrent writers.

### Steps
Test CRUD, uniqueness, ownership, versions, deactivate/reference guards and deactivate-versus-posting races through API and database assertions.

### Expected result
Master state and ownership remain consistent; exactly one valid concurrent transition wins and no inactive location receives new stock.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-003 — Stock, Lot, expiry and quantity invariants

### Preconditions and data
SKUs for none, batch, batch-expiry and serial policies; expiry boundaries and mixed Stock Status buckets.

### Steps
Verify schema constraints, Lot identity, Base-UOM integers, expiry/minimum-life rules, immutable movements and reconciliation invariants.

### Expected result
All bucket and Lot invariants hold; unsupported or inconsistent tracking input is rejected without partial persistence.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-004 — Atomic posting, idempotency and immutable audit

### Preconditions and data
Receipt/Issue operations with stable source events, fault injection and two database connections.

### Steps
Execute success, replay, conflicting payload, timeout/unknown result, duplicate race and failure at state/movement/audit/commit boundaries.

### Expected result
One source event creates at most one complete effect; conflicts are stable; all injected failures reconcile to zero partial effect.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-005 — Reservation, allocation, ATP and FEFO concurrency

### Preconditions and data
Competing reservation/allocation actors across eligible/ineligible Lots and Bins.

### Steps
Test ATP boundaries, duplicate requests, 20–100-way concurrency, FEFO/FIFO ordering, override authorization, release/reallocate and Issue consumption.

### Expected result
Reserved/allocated quantities never exceed eligible stock; ordering is deterministic and only authorized eligible overrides succeed.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-006 — Bin movement and cross-Warehouse transfer

### Preconditions and data
Multi-line same-Warehouse moves and cross-Warehouse Draft/In-Transit/Receive fixtures.

### Steps
Test whole-document transitions, reserved-stock protection, lock conflicts, duplicate dispatch/receive, invalid destinations and rollback of one invalid line.

### Expected result
Paired movements and In-Transit totals reconcile; partial dispatch/receive never occurs and retries do not duplicate effects.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-007 — Adjustment, status transfer and reversal

### Preconditions and data
Authorized/unauthorized adjustment actors and reversible/non-reversible movement fixtures.

### Steps
Test positive/negative adjustments, status transfers, reason categories, reservation protection, reversal links, stale versions and direct ledger tampering.

### Expected result
Only authorized new compensating movements occur; totals and reservations remain valid and immutable history cannot be changed.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-008 — Stocktake locking, counting and variance posting

### Preconditions and data
Two Stocktakes competing for Bins, restartable services and multi-line variances.

### Steps
Test persistent lock acquisition, every Bin mutation guard, save/version conflicts, Ready completeness, all-or-nothing Post, Cancel and owner-safe unlock.

### Expected result
At most one active owner exists per Bin; locks survive restart and no partial variance or foreign unlock is possible.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-009 — Opening precheck, fencing and Go-Live

### Preconditions and data
Valid/invalid 10,000-row Opening files, stale prechecks and competing fenced workers.

### Steps
Test streaming limits, formula/encoding/header errors, no-write precheck, authorization, lease takeover, failure recovery, idempotency and irreversible Go-Live.

### Expected result
Invalid/stale work creates no inventory; one fenced worker commits one complete Opening and LIVE permanently blocks new Opening commands.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-010 — Inquiry, exports, performance and recovery

### Preconditions and data
Two-million-movement/index-equivalent fixtures, export payloads, dependency faults and an isolated restore target.

### Steps
Verify pagination/order, CSV safety, p95 targets, timeout/retry states, structured logs/metrics, six reconciliation invariants and backup/restore consistency.

### Expected result
Queries and exports are correct and bounded, no sensitive data leaks, and recovery/reconciliation results meet the approved operational baseline.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

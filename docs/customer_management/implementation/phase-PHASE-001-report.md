# PHASE-001 — Developer Evidence Report

## Scope and status

- Candidate branch: `codex/customer-management-phase-001`.
- Candidate code commit: `e553dde`.
- DESIGN baseline: `89cc44fe192b81bf9f0c50782432db416aece8fe9c9358f0638efdfe63d648d5`.
- PLAN baseline: `96ed30c6c7a22fc53b9ca46b63f6426f039740225f2cd6bf2e188b6101d6c72e`.
- This is developer verification only. It is not Technical Acceptance, UAT, CI,
  PR review, merge approval or a release claim.

## Controlled capability

The Phase-001 backend capability is limited to permission-controlled Customer root,
party, identifier, credit and lookup APIs. Lifecycle activation, sensitive bank/file
operations, bulk import/export and real downstream-consumer wiring remain outside
this Phase and are unavailable. No Customer client page changed, so browser and
Playwright evidence is not applicable to this Phase.

## TASK-010 evidence

- `CustomerService.list` follows `DES-019`: count, stable ordered page IDs, then
  summary projection by those IDs. The result ordering is reconstructed from the
  ID page; it does not join Customer child collections. TC-028 unit tests cover
  the two-step shape and the 190-character legal-name prefix boundary.
- A fresh host-local MySQL schema migrated through `0036`; a complete rerun skipped
  every migration. The 100k TC-028 fixture seeded 100,000 Customers plus 10,000
  Addresses and 10,000 Contacts. Under 50 concurrent workers with five mixed
  operations each, p95 latency was 16.24ms (list), 5.12ms (exact lookup), 3.48ms
  (address lookup) and 5.45ms (contact lookup), each below the 2,000ms budget.
  EXPLAIN showed covering range scans for code and legal-name prefixes and indexed
  owner/status plus primary-key lookups for the shipping `EXISTS` filter.
- A separate fresh schema migrated through `0036`, reran as a no-op and passed all
  six real-MySQL/HTTP Customer integration tests: root API and idempotency,
  equality-key collation/concurrency, party ownership/default behavior,
  Identifier/Credit semantics and audit redaction, and lookup purpose/status/version
  contracts. Each isolated schema was dropped and its final absence query returned
  zero.
- Compatible rollback rehearsal: the pre-PHASE-001 application baseline `f7fd955`
  started against a schema expanded by the candidate migrations and returned HTTP
  200 from `GET /api/v1/health`. The temporary worktree and schema were removed.
- Final local server regression: 1,541 tests, 1,307 passed, 234 existing
  environment-gated skips, 0 failed. Repository lint, client production build and
  client tests (476 passed) succeeded. CI was not run, as directed by the Product
  Owner.

## Known gate result

The real-MySQL server coverage command now reaches 96.04% lines, 85.43% branches
and 93.70% functions, above the repository thresholds of 92%/83%/90%. It still
cannot pass as a command because one pre-existing Business Master HTTP assertion
expects Currency deactivation to proceed after the Customer table is installed.
Business Master deliberately fails closed with `IMPACT_CHECK_UNAVAILABLE` until that
consumer registers its real Currency/Payment Term impact checker. The Customer
design only requires the read contract in this Phase, so adding that cross-module
consumer-adoption capability exceeds TASK-010's approved scope. No threshold,
assertion or fail-closed behavior was weakened. This remains a merge/readiness
blocker pending Product Owner direction for HD-007.

## Review and next decision

Self-review of the TASK-010 diff found no remaining Critical or High issue within
the approved scope. The previous long-search branch lacked direct coverage and was
corrected before the candidate commit. The Phase cannot be marked complete or
PR-ready while HD-007 remains unresolved.

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

- HD-007 is approved by the Product Owner: TASK-010 now includes the minimal
  production `customer-business-master-impact-checker/v1`. It reads only the
  Customer-owned `customers` table, reports aggregate default references and a
  deterministic watermark, and is registered by Business Master. It neither writes
  Business Master records nor changes Business Master's fail-closed registry/token
  policy.

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

## Final gate result

The corrected full real-MySQL server coverage command passed after the HD-007
checker was registered: 96.13% lines, 85.42% branches and 94.05% functions, above
the repository thresholds of 92%/83%/90% and all 34 high-risk per-file floors. A
fresh schema migrated through `0036`, a complete rerun was a no-op, and the exact
synthetic schema was deleted with final absence confirmed. No threshold, assertion
or fail-closed behavior was weakened.

## Review and next decision

The HD-007 extension has focused and full real-MySQL verification. Final local
lint/build/test review remains required before TASK-010 developer completion can
be recorded; this report remains neither a CI, PR, merge nor release claim.

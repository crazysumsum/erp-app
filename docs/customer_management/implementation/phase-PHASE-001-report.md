# PHASE-001 — Developer Evidence Report

## Scope and status

- Candidate branch: `codex/customer-management-phase-001`.
- Candidate code commit: `4c258b104d0c6004828b9d27708756eecf7d944e`.
- Refreshed DESIGN baseline (approval pending):
  `29d41a152667965c1182207f86bc71d0e2ea12abce7256d319f1c99607020a58`.
- Refreshed PLAN baseline (approval pending):
  `154cb7c161948955e6502efec8c219157bd45fe5b20ff23402007c45403c3c41`.
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
- A fresh host-local MySQL schema migrated through `0046`; a complete rerun skipped
  every migration. The 100k TC-028 fixture seeded 100,000 Customers plus 10,000
  Addresses and 10,000 Contacts. Under 50 concurrent workers with five mixed
  operations each, p95 latency was 16.24ms (list), 5.12ms (exact lookup), 3.48ms
  (address lookup) and 5.45ms (contact lookup), each below the 2,000ms budget.
  EXPLAIN showed covering range scans for code and legal-name prefixes and indexed
  owner/status plus primary-key lookups for the shipping `EXISTS` filter.
- A separate fresh schema migrated through `0046`, reran as a no-op and passed all
  six real-MySQL/HTTP Customer integration tests: root API and idempotency,
  equality-key collation/concurrency, party ownership/default behavior,
  Identifier/Credit semantics and audit redaction, and lookup purpose/status/version
  contracts. Each isolated schema was dropped and its final absence query returned
  zero.
- Compatible rollback rehearsal: the pre-PHASE-001 application baseline `f7fd955`
  started against a schema expanded by the candidate migrations and returned HTTP
  200 from `GET /api/v1/health`. The temporary worktree and schema were removed.
- Final local verification: the full real-MySQL server coverage command passed;
  repository lint, client production build and all 566 client tests passed. CI is
  pending publication of the exact merge candidate.

## Latest-main recovery verification

- Integrated `origin/main` through `5125f32`, including Supplier bank migration
  `0037_create_supplier_bank_accounts.js`, then advanced the Customer migrations to
  `0038`–`0046` so every module retains a distinct ordered migration slot.
- A fresh isolated schema applied every migration through `0046`; a complete rerun
  skipped every migration. The complete server suite then passed serially with real
  MySQL and all 34 high-risk per-file coverage floors. The exact schema was dropped
  and the final absence query returned zero.
- One normal-parallel local run failed because independent integration files shared
  the same mutable schema. The affected migration and Item schema-snapshot suites
  both passed when isolated, and the accepted full database run used the existing
  serial integration profile. No product code or assertion was weakened.

## Final gate result

The final recovered real-MySQL server coverage command passed after the HD-007
checker was registered: 95.28% lines, 84.71% branches and 92.96% functions, above
the repository thresholds of 92%/83%/90% and all 34 high-risk per-file floors. A
fresh schema migrated through `0046`, a complete rerun was a no-op, and the exact
synthetic schema was deleted with final absence confirmed. No threshold, assertion
or fail-closed behavior was weakened.

## Review and next decision

The first independent review requested five required changes. Commit `b6e5f95`
closed the initial findings for normalized duplicate keys, root projections,
new-reference validation, stable uniqueness conflicts and trust-boundary validation.
Its re-review found three residual contract gaps. Commit `4c258b1` fixes them:
full-replacement updates now revalidate only changed references, list search includes
root phone/email while Phase-1 rejects undelivered bank/attachment missing filters,
detail embeds at most 100 children with purposes restricted to those rows, and the
three required paginated child GET routes are implemented.

The remediation-focused suite passed 20/20 and all Customer unit/contract tests
passed 87/87. Repository lint passed. A fresh isolated MySQL schema migrated through
`0046`, the complete rerun skipped every migration, and the Customer HTTP integration
test passed including all three paginated child routes; the schema was dropped and
final absence was confirmed. Full current-candidate coverage and independent
re-review remain pending after latest-main integration.

Developer verification is complete; publication remains blocked on the refreshed
DESIGN/PLAN and PHASE-001 recovery-scope approval, then exact-candidate CI and PR
review. This report is not Technical Acceptance, UAT, merge or release approval.

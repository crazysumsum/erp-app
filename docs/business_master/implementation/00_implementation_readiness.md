# Business Master Phase 1 Implementation Readiness

- Date: 2026-09-14
- Mode: `FULL_LIFECYCLE` / `IMPLEMENT`
- Phase: `PHASE-001`
- Branch: `codex/business-master-phase-1`
- Baseline: `46c1235dfd169e15da38e0de1b5ce1818dbabb0d`
- Design baseline: `7b8058e2286e037f65f46e98bedab2e3e68064e52fe1f783a8d97a5d96c2f565`
- Plan baseline: `6b612e19d29d6655f295f9c27e858bccf570dffdcb97915061df964c44ce2532`
- Decision: **READY FOR PHASE 1 CANDIDATE COMMIT**

## Scope and ownership checks

- `PHASE-001` / `TASK-001` through `TASK-009` are frozen at the exact approved baselines above.
- The shared migration sequence is free through `0026`; this phase owns new forward migration `0027`.
- Shared writes requiring the final scoped approval are limited to `server/database/migrations/**`,
  `server/src/modules/authorization/permissionCatalogue.js`, and production startup registration in `server/src/index.js`.
- Consumer modules remain read-only. Missing consumer schemas must be reported by an explicit readiness result;
  Business Master will not create consumer tables or treat an unknown checker as zero references.

## Runtime isolation

- Workspace: `/private/tmp/erp-business-master-phase-1`
- MySQL schema: `erp_business_master_phase1`
- Server port: `3101`
- Client port: `5201`
- Playwright profile: `/private/tmp/erp-business-master-phase1-playwright`
- Test data: synthetic only; production data and external effects are out of scope.

## Existing platform contracts reused

- Express handler discovery and `BaseRequestHandler` API metadata.
- `MySqlDatabaseService` transactions and parameterized query interface.
- `IdempotencyService` at the API dispatcher boundary.
- Fresh actor/permission revalidation from `directoryLookups.js`.
- Existing structured application errors and logger/correlation conventions.

## Risks and controls

- Catalog mutations, audit writes, and compare-and-swap updates must share one transaction.
- High-impact commands fail closed for missing, timed-out, errored, stale, or changed checker results.
- Pure ISO/rule/date behavior is implemented and tested before database orchestration.
- No new package is required; locked repository dependencies are used.
- `npm audit --audit-level=high` passes; three existing moderate Vitest development-tool advisories remain below the blocking threshold.
- A pre-existing Item concurrency CI test has previously produced a 500 instead of the expected 409. It is outside
  this phase's scope; recurrence will be triaged and reported without changing unrelated Item code.

## Verification gates

- Red-green-refactor evidence for pure rules, repositories/services, provider, handlers, and migration.
- Isolated MySQL integration, security, consumer-contract, performance, and recovery adapters.
- Root lint/client build/regression and all mandatory implementation CI checks.
- Independent code review on the exact current candidate before merge.

The exact Design/Plan/shared-path approvals and independent human Design review are recorded in harness state revision 12.
All five Phase 1 developer suites pass on the approved source fingerprint; candidate commit, PR review and CI remain separate gates.

## Reconciled platform contract

- The existing shared `IdempotencyService` returns `409 IDEMPOTENCY_CONFLICT` when a key is reused with a
  different payload and manages claim/completion outside the handler-owned catalog transaction. Changing the shared
  middleware would alter every existing API and is outside this module boundary. DES-007 and TC-004 are aligned in
  place to the observed platform contract rather than introducing a Business Master-only fork.

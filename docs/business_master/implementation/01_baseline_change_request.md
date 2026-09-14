# Business Master Phase 1 Baseline Change Request

- Date: 2026-09-14
- Scope: `PHASE-001`
- Decision required: exact replacement design and plan baseline approval

## Changes requiring baseline reconciliation

1. Align DES-007 and TC-004 to the existing shared framework contract: a reused key with a different payload returns
   `409 IDEMPOTENCY_CONFLICT`; the framework idempotency envelope is outside the handler-owned catalog transaction.
2. Correct the Node test suite arguments from directory paths to explicit `*.test.js` globs so Node 26 and the harness
   execute the intended suites.
3. Add the existing global permission-catalogue convention test to the module allowlist because migration `0027`
   introduces two permissions and must update that shared regression fixture.
4. Keep the three existing system-admin integration fixtures aligned with the canonical permission catalogue so a
   newly added permission does not turn otherwise valid test JWTs into intentionally stale tokens.
5. Align DES-002 and DES-012 to the minimal runtime artifacts actually required by FR-009/SEC-001: the reviewed ISO
   validation snapshot stores active codes plus provenance, and the consumer Payment Term projection excludes the
   admin-only description field.
6. Register an eager `businessMaster` service explicitly from the production `server/src/index.js` startup so schema,
   permissions, HKD and provider-contract readiness fail closed without coupling generic application-factory tests to
   module-owned tables, as required by FR-012 / DES-011.
7. Add explicit `SUCCESS` / `REJECTED` audit results and persist predictable high-risk command rejections in a
   separate transaction after the catalog transaction rolls back, satisfying FR-011 / TC-014 without storing tokens.
8. Make startup readiness execute the same full column/type/collation/index compatibility inspector as migration
   `0027`, closing the prior table-presence-only gap in FR-012.

## Scope impact

- No new product capability or consumer ownership is added.
- No shared idempotency middleware behavior is changed.
- Implementation remains bounded to the approved Business Master module, its migration/permission registration, and
  the explicitly allowlisted global permission convention test.

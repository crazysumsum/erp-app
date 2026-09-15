# Customer Management — IMPLEMENT Readiness

## Status

`CONDITIONAL` — the approved design and PLAN baselines are current, and TASK-001 can
proceed without DDL or shared-source changes. The executable PHASE-001 work remains
blocked until its shared-path approvals and isolated runtime resources are recorded.

## Mode-entry baseline

- User authorization: 2026-09-14 Codex task user: `進入IMPLEMENT階段`.
- Default branch observed: `origin/main` = `134c2722f92eae298da7ad1a1b01b6a75522550e`.
- Topic branch/worktree: `codex/customer-management-phase-001` at
  `/private/tmp/erp-customer-management-phase-001`.
- Approved design baseline:
  `484247af6f600529bc2cd4c57e1f5d5bc65d4d8f99b781643594d095cda759cd`.
- Approved PLAN baseline:
  `a3d723db8ca0438fd7b4fa4cfa1edd44ff73448736419f4ae85a2238f67f43d1`.

## TASK-001 readiness inventory

| Item | Observation | Disposition |
| --- | --- | --- |
| Physical migration sequence | Latest tracked migration on the entry baseline is `0026_create_item_import_rows.js`. No Customer number is reserved. | Allocate the next available number only immediately before the first Customer migration, after refreshing `origin/main` again. |
| Logical migration order | `DES-022` requires permissions/shared catalogs, Customer catalogs/root/audit, then party/credit. | Retained; TASK-001 introduces no DDL. |
| Authorization foundation | The repository has the permission catalogue, migration runner, request-policy framework and tests. | TASK-002 needs a current scoped human approval for `server/src/modules/authorization/permissionCatalogue.js` and a migration path before either file is changed. |
| Currency / Payment Term provider | Business Master documents the sole-owner contract, but this entry baseline has no `currencies` or `payment_terms` implementation/migration. | TASK-004 is BLOCKED on the provider being merged and its readiness/version being verified; Customer must not create shadow tables or a fallback provider. |
| Customer provider consumers | Sales, Fulfillment and AR are declared consumers, but no Customer lookup provider exists yet. | Defer consumer wiring to TASK-009/PHASE-004; do not fake a consumer provider. |
| Isolated runtime | `00_project_profile.json` has no environment authorization or concrete MySQL schema, file/import roots or web-port reservation. | No migration or developer integration/browser suite may run until those resources and authorization are recorded. |

## Scope and next safe action

TASK-001 is complete once this manifest and the IMPLEMENT state checkpoint are
validated. The next candidate is TASK-002 only after Sam records a scoped approval
for the permission-catalogue and migration paths, plus explicit authorization for an
isolated schema-migration execution. This record does not claim a migration run,
developer test result, Technical Acceptance, UAT, CI, PR or merge.

## TASK-003 scope decision

On 2026-09-14, ERP Product Owner Sam explicitly approved bringing the minimal
`customers` equality-key foundation forward into TASK-003. The foundation is limited
to the Customer identity display values, their canonical binary-collated equality
keys, a stable numeric identifier and timestamps needed to prove the constraints.
It deliberately excludes Customer APIs, lifecycle behavior, audit persistence,
shared-catalog foreign keys and Business Master integration; those remain owned by
their approved later tasks. TASK-005 will extend this additive table rather than
recreate it.

## TASK-003 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Focused normalization, migration-shape and migration-order tests: 15 passed.
- Fresh isolated MySQL schema `erp_customer_phase001_task003_20260914`: the
  provisional equality-key migration at `0028` applied; a full rerun skipped every
  migration. That schema was then dropped. After integrating the Business Master
  `0027` migration, the final sequence is `0028_seed_customer_permissions.js` then
  `0029_create_customer_equality_key_foundation.js` and requires fresh verification.
- Real MySQL tests proved both key columns are `utf8mb4_bin`, normalized duplicate
  inserts fail with `ER_DUP_ENTRY`, accent-distinct normalized keys coexist, and two
  concurrent same-key inserts produce exactly one winner.
- Full local server regression: 1,221 passed, 222 environment-gated existing
  integration tests skipped, 0 failed; lint passed.
- The isolated schema was verified empty of Customer test fixtures and dropped after
  the checks.

## TASK-004 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Focused classification-catalog migration tests and the Business Master v1
  provider-contract tests: 9 passed.
- Fresh isolated MySQL schema `erp_customer_phase001_task004_20260915`: complete
  framework and application migrations through
  `0030_create_customer_classification_catalogs.js` applied successfully; a full
  rerun skipped every migration.
- MySQL metadata verified the one Business Master-owned active `HKD` currency,
  `utf8mb4_bin` `code_key` columns and `(status,sort_order,name)` indexes on all
  three Customer-owned classification catalogs.
- The isolated schema was dropped after verification. No category, industry or
  territory seed data was invented.

## TASK-005 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Focused Customer root migration, audit log, projection and public-error tests:
  9 passed; lint passed for all TASK-005 files.
- Fresh isolated MySQL schema `erp_customer_phase001_task005_20260915`: complete
  migrations through `0032_create_customer_audit_logs.js` applied successfully;
  a full rerun skipped every migration.
- MySQL metadata verified Customer root binary normalized keys, active catalog
  foreign keys, root filter indexes, and the append-only audit table's JSON detail
  column plus customer/target investigative indexes.
- The isolated schema was dropped after verification; no Customer business data
  or audit fixture was retained.

## TASK-006 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added `0033_create_customer_operation_requests.js`: an actor-scoped durable
  Customer command outcome record with canonical payload hash, recovery lease,
  resource reference and terminal-result fields.  The migration shape test, service
  transaction test and handler contract test passed.
- All server tests passed in a loopback-capable local environment: 1,267 passed,
  229 environment-gated tests skipped, 0 failed.  The sandbox-only no-socket run
  was not used as release evidence.
- Fresh isolated schemas were migrated through `0033`; one full rerun skipped every
  migration. Metadata confirmed the actor/route/key unique constraint plus lease,
  resource and actor indexes. Both schemas were dropped after verification.
- A real isolated-MySQL HTTP flow created a Draft Customer, replayed the identical
  framework idempotency key, performed prefix list search and a CAS update, then
  read the actor-owned durable operation result. It passed with no fixture retained.
- Create and update revalidate newly assigned Currency and Payment Term values in
  the caller-owned transaction through the Business Master provider; activation,
  lifecycle and child aggregate APIs remain intentionally unavailable until their
  planned tasks.

## TASK-007 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added `0034_create_customer_party_tables.js` for Customer-owned Address, Contact
  and purpose mappings. Composite owner foreign keys prevent cross-Customer child
  references; generated default slots and unique indexes enforce at most one
  default per Customer and purpose. The migration rejects partial or incompatible
  adopted table/index shapes before issuing DDL.
- Added strict, idempotent create/update/deactivate HTTP contracts and
  `CustomerPartyService`. Mutations revalidate the actor, lock the Customer before
  child/mapping rows, scope child reads and CAS writes by both Customer and child
  ID, reject inactive updates/repeated deactivation, replace purposes atomically,
  bump the root version and write correlated allowlisted before/after audit data in
  the same transaction.
- Focused migration, service, handler-contract and audit tests: 13 passed. Static
  syntax checks for all changed production JavaScript and `git diff --check`
  passed. The server workspace declares no lint script.
- Full local server regression after the final response-schema correction: 1,506
  tests, 1,275 passed, 231 environment-gated tests skipped and 0 failed. CI was not
  run, as directed by the Product Owner. No frontend file changed, so browser and
  Playwright verification are not applicable to TASK-007.
- Fresh isolated MySQL verification applied all migrations through `0034`, accepted
  the resulting schema through its compatibility inspector and proved concurrent
  Address default switching, cross-owner safe-not-found behavior, default clearing,
  Contact multi-purpose/default replacement, preserved inactive mappings, exact
  root-version increments, HTTP response versions and request-correlated audit
  rows. A full migration rerun skipped every migration, and the final isolated
  schema deletion was confirmed.
- Code review covered correctness, readability, architecture, security and
  performance. Required findings for create response versioning, audit context and
  snapshots, repeated deactivation, Contact real-MySQL coverage and response-schema
  composition were corrected before the review verdict was `Approve`.

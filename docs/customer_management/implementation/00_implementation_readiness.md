# Customer Management — IMPLEMENT Readiness

## Status

`BLOCKED` — PHASE-001 implementation, remediation and final developer verification
are complete through integrated candidate `1b78eb769cb69ecf1407d489f44e811477ef68de`.
A non-semantic manifest schema
repair refreshed DESIGN to
`29d41a152667965c1182207f86bc71d0e2ea12abce7256d319f1c99607020a58` and PLAN to
`154cb7c161948955e6502efec8c219157bd45fe5b20ff23402007c45403c3c41`; Product
Owner baseline-bound approval is required after the pending independent re-review,
before publication and merge gates.

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
  current `main` migrations, the final sequence is `0038_seed_customer_permissions.js`
  then `0039_create_customer_equality_key_foundation.js`; the recovery verification
  below confirms that sequence.
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
  `0040_create_customer_classification_catalogs.js` applied successfully; a full
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
  migrations through `0042_create_customer_audit_logs.js` applied successfully;
  a full rerun skipped every migration.
- MySQL metadata verified Customer root binary normalized keys, active catalog
  foreign keys, root filter indexes, and the append-only audit table's JSON detail
  column plus customer/target investigative indexes.
- The isolated schema was dropped after verification; no Customer business data
  or audit fixture was retained.

## TASK-006 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added `0043_create_customer_operation_requests.js`: an actor-scoped durable
  Customer command outcome record with canonical payload hash, recovery lease,
  resource reference and terminal-result fields.  The migration shape test, service
  transaction test and handler contract test passed.
- All server tests passed in a loopback-capable local environment: 1,267 passed,
  229 environment-gated tests skipped, 0 failed.  The sandbox-only no-socket run
  was not used as release evidence.
- Fresh isolated schemas were migrated through `0043`; one full rerun skipped every
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

- Added `0044_create_customer_party_tables.js` for Customer-owned Address, Contact
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
- Fresh isolated MySQL verification applied all migrations through `0044`, accepted
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

## TASK-008 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added `0045_create_customer_identifiers.js` with Customer ownership, binary
  equality keys, lifecycle/version fields and a retained global uniqueness rule;
  deactivation therefore never releases an identifier for reuse. Added strict,
  idempotent create/update/deactivate contracts with owner-scoped reads, Customer
  locking, CAS writes and generic duplicate-conflict responses.
- Added `0046_create_customer_credit_profiles.js` and `CustomerCreditService` for
  exact `DECIMAL(19,4)` limit storage, Business Master-owned active Currency
  validation, explicit not-configured/zero/on-hold projections, first-write
  serialization, CAS updates and fresh-authenticated clearing. Raw identifier
  values, normalized keys, credit notes and password input are excluded from audit
  detail.
- Focused migration, service, handler-contract and audit suites passed 58 tests.
  The post-review migration-inspector regression subset passed 10 tests. Static
  response-schema regression coverage also prevents request-only normalization
  keywords from entering response contracts.
- Fresh isolated MySQL verification applied every migration through `0046`, then
  proved a complete rerun was a no-op. TC-021 through TC-025 passed against real
  MySQL and HTTP for identifier uniqueness/inactive-key retention, Credit
  null-versus-zero/on-hold behavior, create/update/clear concurrency control,
  inactive-Currency rejection, authorization and audit redaction. Both the main
  verification schema and the post-review schema were confirmed absent after trap
  cleanup.
- The real database checks exposed a Currency foreign-key collation mismatch and a
  request-only response-schema keyword; both were fixed and rerun from fresh
  schemas. Final review then required the adoption inspector itself to verify the
  `ascii_bin` Currency collation; that correction passed fresh-schema, no-op and
  TC-021 through TC-025 reruns.
- Final full local server regression on commit `116fc30` passed with exit status 0.
  `git diff --check` passed, and review found no remaining Critical or High issue.
  CI was not run, as directed by the Product Owner. No frontend file changed, so
  browser and Playwright verification are not applicable to TASK-008.

## TASK-009 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added the versioned `CustomerReferenceProviderRegistry` contract with required
  provider/version readiness, bounded calls and fail-closed `UNKNOWN` aggregation.
  Missing, incompatible, unavailable, malformed and empty mandatory-provider
  configurations can never be interpreted as safe to clear a reference guard.
- Added purpose-specific `CustomerLookupService` contracts. `new_sale` and
  `manual_invoice` are Active-only, existing-document/history purposes retain
  status-tolerant access, unknown purposes fail closed, and projections exclude
  notes and other non-contract fields. Address and Contact lookups are active,
  owner- and purpose-scoped; transaction assertions require a positive
  `expectedVersion`, lock the selected row and return the Customer version snapshot.
- Focused TC-018, TC-026 and TC-027 contract suites passed 14 tests. A fresh
  isolated MySQL schema `erp_customer_phase001_task009_20260915` migrated through
  `0046`, a complete rerun skipped every migration, and the real lookup contract
  test passed 1/1 for status handling, minimal projection, credit zero/on-hold,
  ownership, purpose and transaction-version checks. Trap cleanup completed and
  the final schema-absence query returned zero.
- Final full local server regression on commit `b9774e4` executed 1,538 tests:
  1,305 passed, 233 existing environment-gated tests skipped and 0 failed.
  Repository ESLint and `git diff --check` passed. CI was not run, as directed by
  the Product Owner. No frontend file changed, so browser and Playwright validation
  are not applicable to TASK-009.
- Self-review covered correctness, readability, architecture, security and
  performance. It corrected vacuous-clear behavior for an empty provider list,
  enforced transaction `expectedVersion`, preserved 190-character legal-name
  search independently of the 64-character code limit, and repaired five earlier
  Customer integration-fixture lint findings without weakening teardown safety.
  No Critical or High issue remains.

## TASK-011 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added named activation, code-correction, suspend, reactivate, archive, restore
  and qualified-Draft delete commands.  Their high-risk authentication, reason,
  version/CAS, first-activation, state-transition and atomic-audit rules are
  enforced in the Customer aggregate.
- Each high-risk lifecycle command now records a durable Customer operation with a
  canonical password-free payload.  Reusing a key with a different lifecycle or
  create-activation input fails as an idempotency conflict; a known terminal
  outcome is reconciled without repeating the write.
- Archive/delete run the bounded downstream reference check before acquiring a
  Customer row lock and fail closed for `REFERENCE` or `UNKNOWN`.  No downstream
  consumer provider is registered in this Customer-only scope, so these two
  destructive commands remain intentionally unavailable (`CUSTOMER_REFERENCE_CHECK_UNAVAILABLE`) until PHASE-004 consumer providers are delivered; no clear result is inferred.
- Focused lifecycle, operation, approval, root-service, settings and provider
  registry suites passed 31 tests. Repository ESLint, `git diff --check`,
  traceability validation and the Customer module-boundary check passed. The
  repository-wide server coverage gate remains blocked by pre-existing unrelated
  coverage debt and an out-of-scope Customer-catalog handler metadata failure;
  neither was changed by this task.

## TASK-014 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added the Customer approval queue, detail, eligible-approver lookup, approve,
  reject and reassign contracts. Decisions lock the Customer and request in a
  fixed order, reject stale critical snapshots, revalidate activation dependencies,
  and create both approval and Customer-status audit records atomically.
- Added durable idempotency for approve, reject and reassign, including replay of
  the original terminal outcome after later Customer lifecycle changes. Added the
  approved `customer-approvers` handler directory exception and Customer
  `block`/`unblock` lifecycle commands.
- Focused service, lifecycle, operation, handler-contract, handler-convention and
  startup-guard suites, plus repository ESLint, passed. `git diff --check`,
  traceability validation and the Customer module-boundary check also passed.
- Independent review by Jason reached `APPROVE` after the stale-snapshot,
  dual-audit, durable-operation and original-outcome replay findings were fixed.
  The full server suite remains blocked by sandbox loopback-listen restrictions and
  unrelated Customer-catalog handler metadata; neither is changed by this task.

## TASK-015 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added Customer root, approval, settings and catalog client services. Customer
  mutations preserve framework idempotency, accept a caller retry key without
  leaking it into strict request bodies, and sign only device-password routes.
  Reads accept an `AbortSignal`; root and approval queries preserve server filter,
  pagination and stable sort contracts.
- Corrected shared query serialization so array filters use repeated URL keys,
  preserving the server's typed `status` and `missing` arrays instead of turning
  them into invalid comma-delimited values.
- Focused client service and HttpClient regression tests passed 35/35. Repository
  ESLint, client production build, `git diff --check`, traceability validation and
  the Customer module-boundary check passed. The Vite build reported the existing
  >500 kB chunk advisory only.
- Independent review by Jason reached `APPROVE` after child-pagination, approval
  queue time-filter and caller-supplied idempotency-key findings were fixed. No UI
  component or route changed, so Playwright validation is not applicable to this
  service-only task.

## TASK-016 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added the Customer list, create and root-detail pages on the existing route,
  permission, shared table and Customer-service boundaries. The list keeps query,
  status, sorting and pagination state in the URL; the create flow allows Drafts
  and asks for an approver only after the server requires one.
- Edit state is guarded on navigation; a version conflict keeps the user draft
  visible and requires explicitly loading the latest server state before retrying.
- Focused page and route-metadata tests passed 32/32. Repository ESLint, client
  production build and `git diff --check` passed; the build reported only the
  existing >500 kB chunk advisory.
- Browser validation used Playwright against the actual Vite application with
  network-layer API contracts: URL-preserving list/detail navigation and visible
  Draft creation passed 2/2 with no page errors or console warnings. CI was not
  run, as directed by the Product Owner.
- Independent review by Jason reached `APPROVE` after command-response envelope
  handling and the server's `APPROVER_REQUIRED` activation code were corrected;
  unit and browser mocks now exercise those exact contracts.

## TASK-017 developer verification

This is developer evidence only, not Technical Acceptance, UAT, CI, PR review or a
merge claim.

- Added Customer Address, Contact, Identifier and Credit editors with multi-purpose
  defaults, inactive-row restrictions, reason/version handling, explicit conflict
  reload, focusable errors and keyboard-operable dialogs. Purpose/default labels
  remain visible without opening each editor.
- Added the authoritative Customer completeness endpoint and UI. Blocking issues
  use the current Business Master Currency status; child/default, identifier,
  payment-term and credit gaps remain explicitly non-blocking. Credit UI preserves
  null versus `0.0000` versus On Hold and states that Customer maintenance is not a
  transaction credit override.
- Corrected credit-note update semantics so an editor that cannot read private notes
  omits the field and the server preserves the stored value; an explicitly supplied
  note still replaces it. The general read projection continues to exclude private
  credit notes.
- Focused server tests passed 19/19 across completeness, credit, handler contracts,
  handler conventions and Customer detail/list regressions. Focused client service,
  page and component tests passed 18/18. Repository ESLint, client production build,
  `git diff --check`, traceability approval validation and the Customer module-boundary
  check passed. The build reported only the existing >500 kB chunk advisory.
- Playwright ran the actual Vite UI and passed 3/3 list/detail, Draft-create and
  keyboard Address-create flows with no relevant page, console or network failure.
  The new completeness SQL also executed successfully as a read-only query against
  local MySQL. CI was not run, as directed by the Product Owner.
- Independent review by Jason reached `APPROVE` after private-note preservation,
  visible default labels, the credit-override warning, authoritative completeness
  and actionable child/credit conflict recovery were corrected and independently
  revalidated.

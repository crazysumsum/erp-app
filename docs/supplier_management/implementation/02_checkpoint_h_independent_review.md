# Supplier Management — Phase 001 Checkpoint H Independent Review

## Decision

`CHANGES_REQUESTED`

| Severity | Open findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 5 |
| Low | 4 |

No Critical or High finding was raised. The reviewer found no security hole, data-loss path or broken safety control in PHASE-001, and stated that nothing found justifies a rollback. The decision is `CHANGES_REQUESTED` on the strength of five Medium defects, two of which are reproducible user-visible functional bugs.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer` (separate-agent instance, fresh context, read-only) |
| Author | Prior Supplier harness implementer (PHASE-001 TASK-001..TASK-024, commits `c3da62d`..`b47ad44`) |
| Method | `SEPARATE_AGENT` |
| Reviewed at | `2026-09-16T01:42:00Z` |
| Worktree | `/Users/sam/Documents/workspace/erp-app` |
| Base／HEAD | `b3e5aa90229762e9cfc18b5f9c042fbbfe6cf255` (merge commit of PR #104) |
| Design baseline | `dcb74d3c781236860d85b4dc15e2efce4ea33b58b0ed9739241d2d2c8cd61445` |
| Plan baseline | `d54764e4e3b4cad5d907d6f4d906566df157b4cd4907e0f4e06533cef8d8c6bd` |
| Source fingerprint | `d41997ac54f35c96aa57a11d2489583ce3eae8395e57043a40ca65097b1e5007` |
| Authorization | `HD-011`; user message on 2026-09-16 authorizing a separate independent agent review of `b3e5aa9` |

The reviewer did not author any of the reviewed code and did not read the implementer's own claims as evidence. Two of its most concrete findings (`DEF-001`, `DEF-002`) were independently re-verified against the source before being recorded here.

## Findings

### DEF-001 — MEDIUM — completeness warning can never be cleared

`server/src/modules/supplier/supplierValidation.js:66` pushes `BANK_ACCOUNT_MISSING` whenever `input.hasBankAccount` is falsy, but none of the three call sites (`SupplierAdminService.js:184`, `:624`, `:670`) ever supply that key. Bank accounts are not implemented in PHASE-001, so no user action can clear it.

**Failure scenario:** a supplier with an ordering address, an orders contact, an identifier and a payment term — everything PHASE-001 can express — still returns `warnings: [{field:"bankAccounts", code:"BANK_ACCOUNT_MISSING"}]` from `GET /api/v1/suppliers/:id` and `/completeness`. Every supplier in the system permanently displays an uncloseable completeness warning.

**Re-verified:** yes. Line 184 passes only `{ defaultPaymentTermId: row.default_payment_term_id }`.

### DEF-002 — MEDIUM — lifecycle replay detection matches non-lifecycle audit rows

`server/src/modules/supplier/SupplierAdminService.js:353-357` resolves "was this the same command replayed?" by reading the most recent audit row matching `action LIKE 'supplier.%'`. Every audit action the module writes begins with `supplier.` — confirmed by enumerating them: `supplier.address.*`, `supplier.contact.*`, `supplier.identifier.*`, `supplier.update`, `supplier.create`, `supplier.code.change` all match.

**Failure scenario:** supplier S is `active`. Admin suspends S (audit `supplier.suspend`). Admin adds a contact (audit `supplier.contact.create`). The browser retries the earlier suspend POST. `current.status === targetStatus`, so control enters the replay branch; the latest `supplier.%` row is `supplier.contact.create`, not `supplier.suspend`, so the request throws 409 `STATUS_TRANSITION_INVALID` for an operation that actually succeeded. Fails closed, but reports a wrong and misleading cause.

**Secondary:** the replay branch `return`s at `:357` before `assertExpectedVersion` at `:360`, so a client holding a stale `version` receives 200 instead of `VERSION_CONFLICT` when a different actor's identical command produced the current state.

**Re-verified:** yes, both the `LIKE` pattern and the early return.

### DEF-003 — MEDIUM — raw cross-module read bypasses the Business Master provider contract

`SupplierAdminService.js:657-659` reads Business Master's `currencies` table with raw SQL — the only raw cross-module table access in the module. Every other path goes through `BusinessMasterLookupProvider.assertSupplierDefaultsInTransaction`, which enforces the readiness gate and the `business-master-provider/v1` contract. The enabling cause is `supplierQueryHandlers.js:32` injecting `businessMaster: {}` to satisfy a truthiness check.

**Failure scenario:** with Business Master `NOT_READY`, every other Supplier endpoint returns 503 `BUSINESS_MASTER_NOT_READY`, but `/completeness` reads the raw table, sees `status != 'ACTIVE'` and returns a blocking `CURRENCY_NOT_ACTIVE` — telling the user their currency is invalid when the real cause is that Business Master is unavailable. This is a read, so it does not violate `forbidden_direct_writes`, but it bypasses the `business-master-currency-payment-term-provider` shared-resource contract. The `businessMaster: {}` stub is additionally a latent 500 for any future Business Master call added to a read path.

### DEF-004 — MEDIUM — reference guards default fail-open with no checkers registered

`SupplierAdminService.js:78-79` defaults `this.references` and `this.openFlows` to `new SupplierReferenceService()` with an empty checker list, and no production call site injects checkers — all four instantiations (`createSupplierHandler.js:28`, `supplierUpdateHandlers.js:29`, `supplierQueryHandlers.js:27`, `supplierLifecycleHandlers.js:39`) omit both. `describeReferences` therefore always returns `total: 0`, making three guards vacuous: the delete guard (`supplierStateMachine.js:28`), the Supplier Code change guard (`:301-304`) and the archive open-flow guard (`:386-391`).

**Not currently exploitable:** PHASE-001 ships no tables that constitute a reference, and design §498 only requires activation-request and Supplier-SKU checks, both later phases. Recorded as a fail-open default rather than a live bug. The risk is silence: when Purchasing lands, a forgotten checker registration leaves the guards permanently off with no error. `BusinessMasterImpactRegistry.js:35,40` already solves this correctly in the same codebase via `requiredCheckerIds` + `IMPACT_CHECK_UNAVAILABLE`.

### DEF-005 — MEDIUM — address normalization lacks the validation every sibling entity applies

`SupplierAddressService.js:9-36` applies no length validation and no control-character rejection, unlike `SupplierContactService.js:17-23`, `SupplierIdentifierService.js:23-28` and `supplierNormalization.js:4-18`, which all reject C0/C1 control characters and enforce lengths in the service layer. Addresses rely solely on the JSON schema in `supplierAddressHandlers.js:20-32`.

**Failure scenario:** `POST /api/v1/suppliers/:id/addresses/create` with `{"addressLine1":"Unit 5\r\nFake Co", ...}` is accepted and stored, while the identical payload in `supplier.notes` is rejected with `SUPPLIER_FIELD_INVALID`. The embedded CRLF flows into `getPurchaseDefaultsInTransaction`'s `orderingAddress` and into any later CSV export as a row break. Design §1256 states the CSV import worker reuses the same domain helpers, so an import path calling `SupplierAddressService.create` directly would bypass the only validation that exists.

### DEF-006 — LOW — identifier write statements do not check `affectedRows`

`SupplierIdentifierService.js:126-132, 171-174` carry `AND version = ?` but never check `affectedRows`, unlike `SupplierAdminService.js:247, 312, 399, 471`. Currently safe because `#identifierForUpdate` holds a `SELECT ... FOR UPDATE` row lock and pre-checks the version, so the guard silently does nothing today. Worth aligning for consistency.

### DEF-007 — LOW — purpose replacement resets creation provenance

`SupplierAddressService.js:140` calls `#replacePurposes` with `replace: true`, which `DELETE`s and re-`INSERT`s all purpose rows, resetting `created_at`/`created_by` on unchanged purpose assignments.

### DEF-008 — LOW — Business Master factory depends on unasserted initialization order (pre-existing, not Supplier-owned)

`businessMasterFactory.js:39` uses `services.get?.("supplierBusinessMasterImpactChecker")` and silently falls back to the generic `readinessChecker` when the lookup returns undefined. The reviewer traced this and confirmed **it works correctly today**: `createServiceContainer.js:22` awaits `container.initialize()` at `createApplication.js:426`, before `createHandlerRegistry` at `:503`. Degradation is also fail-closed — the fallback returns `status: "UNKNOWN"`, absent from `VALID_STATUSES`, which raises `IMPACT_CHECK_UNAVAILABLE`. Residual risk is that correct wiring depends on an implicit, unasserted ordering. Both branches are covered by `providerContract.test.js:122,146`.

### Noted, no change requested

- `suppliers.status` is `VARCHAR(30)` with no `CHECK`/`ENUM` (`0029_create_suppliers.js:91`), enforced in application code only. Deliberate, and compensated by the fail-closed classification check in `SupplierBusinessMasterImpactChecker.js:77-79`, which `supplierParty.integration.test.js` proves by inserting `status = 'future_status'` via raw SQL.
- `toMaskedBankResponse` (`supplierProjections.js:98`) is exported but unused in PHASE-001 — forward-looking scaffolding for an in-scope capability.

## What the review confirmed as correct

These items are recorded because they directly answer the risks the review was commissioned to probe.

- **The state machine fix is real and complete.** The previously reported Restore/Suspend misclassification is fixed by explicit per-command `allowedFrom` source-state sets (`SupplierAdminService.js:422-448`), checked at `:361` before `transitionSupplierStatus`. All eight commands verified. This matters because target-state-only validation is genuinely insufficient here: `archived → suspended` and `blocked → suspended` are both legal transitions (`supplierStateMachine.js:9-10`).
- **The two-connection concurrency proof is genuine, not faked.** Design §1249 forbids substituting a sequential test. `supplierManagement.integration.test.js:409-426` takes two independent pooled connections, holds `assertUsableInTransaction`'s `FOR UPDATE` on one, sets `innodb_lock_wait_timeout = 1` on the other and asserts errno 1205. `supplierParty.integration.test.js:227` races two independent `create` calls whose identifiers normalize to the same key and asserts exactly one rejects with `SUPPLIER_IDENTIFIER_TAKEN`.
- **`assertUsable` is correct as written.** The split between `assertUsable` (preflight) and `assertUsableInTransaction` (submit-time atomic revalidation) at `SupplierLookupService.js:112-123` matches design §968-969, and §1237 places the submit-time obligation on Purchasing. The initially suspected missing `FOR UPDATE` is not a defect.
- **The non-disclosing 409 is genuinely non-disclosing.** `taken()` (`SupplierIdentifierService.js:43-48`) returns only `identifierType` and `issuerCountryCode`, both caller-supplied — no owning supplier id, code or name, despite the unique index being global.
- **Primary address/contact slots use correct MySQL partial-unique emulation.** `primary_slot TINYINT GENERATED ALWAYS AS (IF(is_primary=1,1,NULL)) STORED` plus `UNIQUE KEY (supplier_id, purpose_code, primary_slot)` in migrations 0032/0033, with `#replacePurposes` demoting before inserting.
- **Audit logs survive supplier deletion.** Migration 0031 deliberately carries no FK on `supplier_id`, only `ON DELETE SET NULL` on the actor. A `CASCADE` there would have made `deleteSupplier` destroy the trail it relies on at `:463-469`.
- **Authorization is enforced server-side.** All 15 handlers declare `authorizationPolicies` matching the design auth table (§369-376, §820-833), including `jwt-device-password` on block/unblock/delete/code-change. Every service method additionally calls `assertActorFresh`, re-reading roles and permissions from the database. Client gating is cosmetic only.
- **SQL is uniformly parameterized.** The only interpolated fragments are generated placeholder lists, fixed condition strings and a whitelisted `supplierSortColumn` with safe fallback. LIKE terms escaped with explicit `ESCAPE '\\'`. Child queries consistently scoped `AND supplier_id = ?`, with cross-owner IDOR attempts covered by integration tests.
- **Module boundary is clean.** All 46 changed source paths check out against `allowed_write_paths` / `approval_required_paths` / `forbidden_paths`. Nothing written to `.env`, `secrets/**` or `docs/user_management/**`. No INSERT/UPDATE/DELETE found against any table in `forbidden_direct_writes`.

## Coverage gaps — this review is not complete

The reviewer stated these explicitly and they are reproduced here without softening.

- **No browser validation was performed.** The app was not started and no UI flow was driven with Playwright. Only the permission-gating lines of the 12 Vue files were read. The `DEF-001` symptom in `SupplierCompletenessBanner.vue` was reasoned about from the server response, not observed. Under the project UI testing standard this review is **incomplete on the frontend axis**, and a browser pass is required before the client side can be considered reviewed.
- Lint, builds and the two test suites were not re-run; their green status was taken as given.
- Only grepped portions of the 163KB design spec and requirement spec were read. The review worked from code outward to spec, not from the traceability matrix inward. **No traceability audit against `08_traceability.json` was performed**, and no verification that every `DES-0xx`/`SEC-0xx` id has a corresponding implementation.
- `05_development_tasks.md` §T24 and Checkpoint H acceptance criteria were **not** checked against the delivered state.
- Approximately 140 server tests and all 40 client tests were not reviewed; three test files were sampled.
- No `EXPLAIN` against a populated database and no load testing, so the `supplier-performance` suite's claims are unverified by this review.

## Gate consequence

`REV-006` is recorded as `CHANGES_REQUESTED`. The harness review gate requires an `APPROVED` review bound to the current design baseline, so:

- `Checkpoint H` is **not** satisfied.
- `TASK-024` cannot be closed.
- PHASE-002 work (`TASK-025` onward: Approval, Settings, Bank, Import) must not start, per the Checkpoint H gate.

`DEF-001` through `DEF-008` are all MEDIUM or LOW, so none of them trip the harness `BLOCKING_DEFECT` check, which fires only on unresolved CRITICAL/HIGH. The block is the review status itself, not defect severity.

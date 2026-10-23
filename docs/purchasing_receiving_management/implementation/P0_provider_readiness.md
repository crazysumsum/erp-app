# PHASE-001 / TASK-001 — Baseline and Provider Readiness

Acceptance record for `TASK-001` (`P0-T01`). No production code is changed by this task.

## Baseline

| Item | Observed value |
| --- | --- |
| Entry commit | `81a873fc` (`origin/main` at `TASK-001` scoring time) |
| Re-verified against | `94d52972` — `main` moved during `TASK-003` (PR #265, Supplier resilience, touching `SupplierProviderServices.js` and `supplierSchemaCheck.js`). Merged in and every gate re-run: provider focused tests still `140 pass / 0 fail`. |
| Branch / worktree | `claude/purchasing-p0-foundation` / `/Users/sam/Documents/workspace/erp-purchasing-p0` |
| Last migration | `0087_fix_supplier_sku_refs_sku_foreign_key.js` (85 files) |
| Next available migration number | `0088`, assigned at use time. Globally shared — re-check immediately before writing one. |
| Node / MySQL | local `node v26.6.0`; CI service `mysql:8.0` (approved baseline) |

## Provider gates

| Gate | Task | Verdict | Evidence |
| --- | --- | --- | --- |
| Framework: authenticated idempotency identity scope | `TASK-002` | **PASS — already satisfied** | `IdempotencyService.js:31` scopes every non-`public` `req.auth.type` by `claims.sub` (falling back to `jti`, then a claims hash); only anonymous requests fall back to IP. Guarded by `idempotencyService.test.js:188`, `:209` ("different users never share an idempotency scope"), `:226`, `:227` covering `jwt`, `jwt-password` and `jwt-device-password`. |
| Authorization: six purchasing/receiving permissions | `TASK-003` | **DONE** | Was absent from `permissionCatalogue.js`; closed by this Phase. Six entries added plus `0100_seed_purchasing_permissions.js` and `purchasingPermissionMigration.test.js`. |
| Supplier purchasing provider contracts | `TASK-004` | **PASS on surface; verification outstanding** | `SupplierLookupService.js`: `findById:108`, `assertUsable:136`, `assertUsableInTransaction:142`, `getPurchaseDefaults:149`, `getPurchaseDefaultsInTransaction:154`, `listForSku:195`; `PURPOSES = ["purchase", "history"]:7`. `recordSupply` in `SupplierRelationService.js`. |
| Item committed receipt lookup | `TASK-005` | **PASS on surface; verification outstanding** | `ItemLookupService.findManyForCommittedReceipt:141`. |
| Inventory purchase receipt **batch** contract | `TASK-006` | **BLOCKED — work to do** | Only a single-detail provider exists: `InventoryPostingService.postReceivingReceiptInTransaction:333` via `RECEIVING_RECEIPT` (purpose `PURCHASE_RECEIPT`, module `PURCHASING_RECEIVING`, documentType `GOODS_RECEIPT`, `:38`). `postPurchaseReceiptBatchInTransaction` does not exist, and design §2.4/§8.7 forbids per-detail single posting. |
| Inventory **partial** receipt reversal contract | `TASK-007` | **BLOCKED — work to do** | `inventoryReversalPosting.js:213` always reverses the full original quantity. No reversal-link table exists (`0060_create_inventory_movements.js` is the only movement migration). `reversePurchaseReceiptBatchInTransaction` does not exist. |
| Currency / Payment Term catalogue | — | **PASS** | `server/src/modules/businessMaster` exposes `Currency`, `CurrencyPrecision`, `CurrencyStatus`, `CurrencyUsableInTransaction`, `PaymentTerm`, `PaymentTermCode`. Per-currency decimal places still need a contract test — `GAP-DES-002`, folded into `TASK-004`'s verification rather than left as an assumption. |

Provider focused tests on this baseline: `140 pass / 0 fail / 0 skipped`. Full server suite after `TASK-003`: `3432 tests, 2561 pass, 0 fail, 871 skipped` with the CI bank-key env vars set; the 871 skips are the MySQL integration tests, which need `DB_INTEGRATION_TESTS=1` and a live MySQL 8.0 and are covered by the CI test job. `0100` is exercised against real MySQL only there — the local test uses a fake connection and proves the idempotency logic, not the DDL path.

```bash
node --test --import ./server/test-support/testEnv.js \
  server/test/supplierLookupService.test.js \
  server/test/itemLookupService.test.js \
  server/test/idempotencyService.test.js \
  server/test/idempotencyStore.test.js \
  server/test/inventoryProviderContracts.test.js
```

## Dangling permission reference

`receiving.operation` and `receiving.expiry.override` are **required** by code that already ships, but defined nowhere:

- `InventoryPostingService.js:41` — `RECEIVING_RECEIPT.requiredCallerPermission`
- `InventoryPostingService.js:55` — `OVERRIDE_PERMISSION`
- `handlers/inventory/inventorySchemas.js:252` — `permission: { const: "receiving.expiry.override" }`

No role can hold a permission that is not in the catalogue, so Inventory's receiving provider path is currently unreachable in production. The catalogue guard validates entries, not references to absent ones, which is why nothing fails today. `TASK-003` closes this.

## Gate conclusion

`GAP-IMP-003` (`TASK-005`), `GAP-IMP-004` partially and `GAP-IMP-005` (`TASK-002`) are resolved by other modules' work since the alignment baseline `a3040c9`. `GAP-IMP-001` (`TASK-004`) is resolved for the Supplier contracts.

`TASK-004` and `TASK-005` stay `IN_PROGRESS` rather than `DONE`: the contract surfaces exist and the Supplier and Item suites pass, but their remaining acceptance bullets (bank-field projection, `recordSupply` replay, committed-receipt warning codes) are asserted by those modules' own tests, not yet by a purchasing consumer contract test. `TASK-008` pins them.

`PHASE-001` is **not** complete. `TASK-001` and `TASK-003` are done; `TASK-006` and `TASK-007` are handed off (below), and `TASK-008` closes the Phase. No Purchasing capability, menu or route is exposed.

## HD-007 — Inventory contract ownership

**Answered: the Inventory module owner delivers `TASK-006` and `TASK-007`.** Both write under `server/src/modules/inventory/**`, which is in neither `allowed_write_paths` nor `approval_required_paths` here, and `TASK-006`'s acceptance requires locking Warehouse/Bin/Lot/Balance in Inventory's global lock order — an Inventory invariant that its owner is better placed to implement. Purchasing does not write those files.

What the Inventory owner needs to deliver, from design §2.4–2.6, §8.7–8.8:

| Contract | Requirement |
| --- | --- |
| `postPurchaseReceiptBatchInTransaction()` | One batch call for all details of a Goods Receipt. Claim every source operation before taking locks, then lock in Inventory's global order. Results map one-to-one with source details. Any failure on location, Lot, Status, Expiry or quantity rolls back every Movement, Balance and Inventory Audit row. Per-detail calls to the existing single posting path are not acceptable. |
| `reversePurchaseReceiptBatchInTransaction()` | Repeatable **partial** reversal of one original Movement, locking the original plus all its links and checking that the cumulative reversed quantity never exceeds the original. All-or-nothing across details. Existing generic full-reversal semantics must not change. |

Today `InventoryPostingService.postReceivingReceiptInTransaction:333` is single-detail only, and `inventoryReversalPosting.js:213` always reverses the full original quantity with no link table. Purchasing's side of the handoff is the consumer contract test in `TASK-008`, which is where these two contracts get pinned from this module.


## TASK-003 authorized write scope

`validate_module_boundary.py` reports `BLOCKED` with four issues for this change. All four are authorized, recorded as `APR-004`:

| Path | Classification | Why |
| --- | --- | --- |
| `server/src/modules/authorization/permissionCatalogue.js` | `approval_required_path` | The catalogue is the authority for permission names; adding the six entries is step one of the three-step process its docblock mandates. Owner approved. |
| `server/database/migrations/0100_seed_purchasing_permissions.js` | `approval_required_path` | Step two: the catalogue's idempotent database projection. Owner approved the migration directly. |
| `server/test/permissionCatalogueConventions.test.js` | outside module | Step three of that process is registering the new seed file in `PERMISSION_SEED_MIGRATIONS`. Without it, `every catalogue permission is seeded by exactly one migration` fails. Unavoidable and shared. |
| `server/test/purchasing/purchasingPermissionMigration.test.js` | now inside module | Originally written at `server/test/` root next to its siblings; moved under `server/test/purchasing/` to match this module's declared `test_paths`, following the `server/test/sales/` precedent. |

The manifest was deliberately **not** widened to cover the conventions test. Editing `contracts` or `scope` changes the design and plan composite digests, which would strand `APR-001`, `APR-002`, `APR-003` and `REV-002`. Recording the authorized exception costs one approval entry; re-pinning would cost three approvals and a re-review.

Migration number `0100`: `0088`–`0099` are already claimed by the in-flight `codex/fulfillment-p0-foundation` and `codex/sales-order-phase-4-archive` branches, which collide with each other on `0088` and `0091`–`0093`. The runner keys applied state by full filename and a permission seed is order-independent, so the gap is free.


## TASK-003 broke four integration tests, and why the local run could not see it

Adding six catalogue entries that no migration grants to system-admin turned four hand-maintained admin-claim sets stale. Every affected test failed with `PERMISSION_STALE`:

| File | Failing cases in CI |
| --- | --- |
| `server/test/integration/roleManagement.integration.test.js` | 5 |
| `server/test/integration/userManagement.integration.test.js` | 5 |
| `server/test/integration/passwordChange.integration.test.js` | 2 |
| `server/test/integration/migrations.integration.test.js` | 1 |

Each builds its admin claim set as "every catalogue permission except the ones migrations deliberately do not grant", as a literal prefix denylist:

```js
.filter((name) => !name.startsWith("customer.bank.") && !name.startsWith("inventory.") &&
  !name.startsWith("sales.") && name !== "fulfillment.operation");
```

`purchasing.` and `receiving.` were added to all four. The accretion of `customer.bank.`, `inventory.`, `sales.` and `fulfillment.operation` shows this has broken at least four previous modules' first PR the same way. A denylist derived from what the migrations actually grant would stop it recurring; that is four other modules' test files and was not changed here.

**The local run could not catch this.** `npm test --workspace server` without `DB_INTEGRATION_TESTS=1` and a live MySQL skips 872 tests, including all four of these files, and still exits 0. A green local run on this repo is not evidence about anything MySQL-backed.

Re-verified against a real isolated MySQL 26.7.0 (`--skip-log-bin`, needed because `0057_create_inventory_audit.js` creates triggers and the default binlog config refuses that without SUPER):

| Check | Result |
| --- | --- |
| `npm run migrate` from empty schema | all 86 migrations applied, including `0100` |
| Seeded rows | 6 permissions, correct UTF-8 descriptions, `role_permissions` grants = 0 |
| Re-run `migrate` | `0100` skipped, still exactly 6 rows |
| The four repaired files | 35 tests, 35 pass, 0 skipped |
| Negative control: fix reverted | RED — the fix is what makes them pass |

Three other local integration failures (`customerCatalogLocks`, `customerOperationalGuards`, `itemRecoveryAcceptance`) are **pre-existing**: they fail identically on unmodified `origin/main` against the same database. `salesImportCapacity` TC-042 passes alone on both `origin/main` and this branch; it failed only inside the full single-process suite run, which is contention, and is why CI shards the suite.

The CI version note in `GAP-ENV-001` is now wrong in one detail: CI's `mysql:8.0` service image reports `Version: '26.7.0'`, the same build as the local client. Local and CI are not on different major versions.

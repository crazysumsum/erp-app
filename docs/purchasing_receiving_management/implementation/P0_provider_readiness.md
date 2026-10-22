# PHASE-001 / TASK-001 — Baseline and Provider Readiness

Acceptance record for `TASK-001` (`P0-T01`). No production code is changed by this task.

## Baseline

| Item | Observed value |
| --- | --- |
| Entry commit | `81a873fc` (`origin/main` after `git fetch origin --prune`) |
| Branch / worktree | `claude/purchasing-p0-foundation` / `/Users/sam/Documents/workspace/erp-purchasing-p0` |
| Last migration | `0087_fix_supplier_sku_refs_sku_foreign_key.js` (85 files) |
| Next available migration number | `0088`, assigned at use time. Globally shared — re-check immediately before writing one. |
| Node / MySQL | local `node v26.6.0`; CI service `mysql:8.0` (approved baseline) |

## Provider gates

| Gate | Task | Verdict | Evidence |
| --- | --- | --- | --- |
| Framework: authenticated idempotency identity scope | `TASK-002` | **PASS — already satisfied** | `IdempotencyService.js:31` scopes every non-`public` `req.auth.type` by `claims.sub` (falling back to `jti`, then a claims hash); only anonymous requests fall back to IP. Guarded by `idempotencyService.test.js:188`, `:209` ("different users never share an idempotency scope"), `:226`, `:227` covering `jwt`, `jwt-password` and `jwt-device-password`. |
| Authorization: six purchasing/receiving permissions | `TASK-003` | **BLOCKED — work to do** | No `purchasing.*` or `receiving.*` entry exists in `permissionCatalogue.js`. See the dangling-reference note below. |
| Supplier purchasing provider contracts | `TASK-004` | **PASS on surface; verification outstanding** | `SupplierLookupService.js`: `findById:108`, `assertUsable:136`, `assertUsableInTransaction:142`, `getPurchaseDefaults:149`, `getPurchaseDefaultsInTransaction:154`, `listForSku:195`; `PURPOSES = ["purchase", "history"]:7`. `recordSupply` in `SupplierRelationService.js`. |
| Item committed receipt lookup | `TASK-005` | **PASS on surface; verification outstanding** | `ItemLookupService.findManyForCommittedReceipt:141`. |
| Inventory purchase receipt **batch** contract | `TASK-006` | **BLOCKED — work to do** | Only a single-detail provider exists: `InventoryPostingService.postReceivingReceiptInTransaction:333` via `RECEIVING_RECEIPT` (purpose `PURCHASE_RECEIPT`, module `PURCHASING_RECEIVING`, documentType `GOODS_RECEIPT`, `:38`). `postPurchaseReceiptBatchInTransaction` does not exist, and design §2.4/§8.7 forbids per-detail single posting. |
| Inventory **partial** receipt reversal contract | `TASK-007` | **BLOCKED — work to do** | `inventoryReversalPosting.js:213` always reverses the full original quantity. No reversal-link table exists (`0060_create_inventory_movements.js` is the only movement migration). `reversePurchaseReceiptBatchInTransaction` does not exist. |
| Currency / Payment Term catalogue | — | **PASS** | `server/src/modules/businessMaster` exposes `Currency`, `CurrencyPrecision`, `CurrencyStatus`, `CurrencyUsableInTransaction`, `PaymentTerm`, `PaymentTermCode`. Per-currency decimal places still need a contract test — `GAP-DES-002`, folded into `TASK-004`'s verification rather than left as an assumption. |

Provider focused tests on this baseline: `140 pass / 0 fail / 0 skipped`.

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

`PHASE-001` is **not** complete. Remaining work is `TASK-003`, `TASK-006`, `TASK-007`, then `TASK-008`. No Purchasing capability, menu or route is exposed.

`TASK-006` and `TASK-007` write under `server/src/modules/inventory/**`, which is in neither `allowed_write_paths` nor `approval_required_paths` in `00_module_manifest.json`. That is an open scope decision (`HD-007`), not something this task resolves.

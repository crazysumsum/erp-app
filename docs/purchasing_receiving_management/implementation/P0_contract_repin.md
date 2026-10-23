# Consumed Contract Pin Refresh and Approval Re-confirmation

Owner-authorized on 2026-10-22. Baseline `09281b0a`.

## Why this was needed

`00_module_manifest.json` pinned the sha256 of every consumed contract source as observed at the alignment baseline `a3040c9` (2026-09-14). Five of the seven sources changed in the following five weeks, so `validate_traceability.py` returned `BLOCKED` with five `CONTRACT_DRIFT` issues. The drift reproduced on unmodified `origin/main`, so it was not caused by any purchasing change.

Refreshing the pins changes the harness composite baselines, because the design digest covers `manifest.contracts` and the plan digest covers the whole manifest. That strands every record bound to the old digests — which is why this was not done silently.

## What changed

| Contract | Source | Pin | What actually changed |
| --- | --- | --- | --- |
| `item-lookup-service` | `server/src/modules/item/ItemLookupService.js` | `6aff6504…` → `a09d5baf…` | `findManyForCommittedReceipt` **landed** (+363 lines), returning allowlisted warnings `STATUS_NOT_ACTIVE`, `NOT_PURCHASABLE`, `NOT_INVENTORY_TRACKED`, `OUTSIDE_EFFECTIVE_RANGE`. This is `TASK-005`'s contract arriving, and it matches that task's acceptance criteria. Version moved from `…-PARTIAL` to `observed-main-09281b0a`. |
| `permission-catalogue` | `server/src/modules/authorization/permissionCatalogue.js` | `bc0828b5…` → `32db8366…` | Purchasing's own `TASK-003` added the six module permissions (PR #266). |
| `idempotency-service` | `server/src/services/idempotency/IdempotencyService.js` | `6f0f61e8…` → `b574dd69…` | +56/-17 lines, but `identityScope` is **unchanged**: every non-`public` `req.auth.type` still scopes by `claims.sub`, and `"different users never share an idempotency scope"` is still asserted. `TASK-002`'s contract holds. |
| `supplier-purchasing-contract` | `docs/supplier_management/03_design_spec.md` | `983f351f…` → `a9f64493…` | Adds `SupplierCoreProviderService` / `supplier-core-provider/v1` as the runtime adapter and a Business Master impact checker. Nothing purchasing consumes was weakened; the purchase-defaults and history semantics are unchanged. |
| `inventory-purchase-receipt-batch-and-partial-reversal` | `docs/inventory_management/03_design_spec.md` | `ffbffdf7…` → `2fb61cce…` | +218/-40 lines. See the caveat below. |

Unchanged and not re-pinned: `purchasing-receiving-document-contract` (this module's own design) and `currency-and-payment-terms-catalogue`.

## Caveat on the Inventory pin — HD-008

The refreshed hash attests to **what that document currently says**, not that it specifies the contract it is pinned for. It does not:

- `postPurchaseReceiptBatchInTransaction` and `reversePurchaseReceiptBatchInTransaction` appear **zero** times in `docs/inventory_management/03_design_spec.md`.
- What it does specify is a *single-detail* `RECEIVING` internal contract (§5.11): fixed `receiving.expiry.override` mapping, per-entry low-life evidence, pack-UOM conversion inside the transaction, Expired always rejected.

So purchasing's design is still the only document that specifies the batch posting and partial reversal. That is consistent with the implementation reality — both are absent from `server/src/modules/inventory/**` — and is tracked as [issue #267](https://github.com/crazysumsum/erp-app/issues/267). Recorded as `HD-008`; the entry's `version` is now `planning-only-NOT_SPECIFIED_BY_PROVIDER-issue-267` so the pin cannot be mistaken for provider agreement.

One compatible point worth noting: inventory design §474 defaults to rejecting any Expiry/Manufacture difference for an existing SKU/Lot, which agrees with purchasing `FR-VAL-006` and `BR-033`.

## Approval re-confirmation

| Record | Was bound to | Now bound to |
| --- | --- | --- |
| `APR-001` (scope/requirement) | design `5db990ab…` | plan `3fd127d1…` — see the `baseline_kind` note below |
| `APR-002` (design) | design `5db990ab…` | design `15e4423b…` |
| `APR-003` (plan) | plan `54e2b1cb…` | plan `3fd127d1…` |
| `APR-004` (TASK-003 write scope) | plan `54e2b1cb…` | plan `3fd127d1…` |
| `REV-002` (independent human review) | design `5db990ab…` | design `15e4423b…` |

`01_requirement_spec.md`, `03_design_spec.md` and `05_development_tasks.md` are **byte-identical** to the versions originally approved. Verified with `git diff --quiet bd97e1cc731ef6618e6c3d94cbaa69ccc42263d4 HEAD -- <file>` against `bd97e1c`, the commit that merged the approved alignment, for all three; `06_technical_test_cases.md` and `07_uat_test_cases.md` are likewise unchanged. Only manifest contract pins moved, so this is a pin refresh plus a re-confirmation, not a re-approval of changed specifications.

This follows the convention the Supplier module already records for the same situation: approving a pin refresh is explicitly not approving a semantic change to the provider's document.


## Two bookkeeping defects found while re-binding

Both were mine, and both would have made the re-confirmation look recorded while failing every gate.

**Future-dated approvals.** I first wrote `recorded_at: 2026-10-22T18:00:00+08:00` from a plausible-looking guess rather than the clock. The real time was `14:22+08:00`, so the stamps sat ~3.6 hours in the future, and `approval_valid` rejects any approval recorded more than five minutes ahead of now. `verify_gate.py` reported `APPROVAL_MISSING_STALE` for both DESIGN and PLAN. Re-stamped from `date`, not from a guess.

**`baseline_kind` on a SCOPE approval.** `approval_valid` computes `expected_kind = 'DESIGN' if kind == 'DESIGN' else 'PLAN'`, so any approval whose `kind` is not exactly `DESIGN` must carry `baseline_kind: "PLAN"` and the plan digest. `APR-001` is `kind: "SCOPE"` and had been bound to the design digest since the alignment, which means it could never have validated. Corrected to the plan digest; `APR-004` was already right.

After both fixes `verify_gate.py --gate PLAN_READY` blocks only on the two genuinely open human decisions, `HD-006` and `HD-008`.

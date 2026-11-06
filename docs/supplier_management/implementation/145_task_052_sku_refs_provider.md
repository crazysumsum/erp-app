# TASK-052: Supplier-SKU hints for PO Lines

**Decision:** HD-163 A (2026-11-06). **Consumer:** Purchasing HD-015 2C, accepted in its `H1_supplier_receiving_interfaces.md` at `1d206f9a`.

## What changed

- `SupplierLookupService.findSkuRefsInTransaction(connection, supplierId, skuIds)` returns a `Map` from `skuId` to `{ relationId, relationshipStatus, supplierItemCode, lastSuppliedAt }`. Keys and `relationId` are numbers.
- It is a plain read on the caller's connection, for at most 100 IDs. Duplicates are fine, and an empty list sends no query. `stopped` rows come back, and a SKU with no relation is simply absent.
- No readiness change: `supplierSchemaCheck` already refuses to start without a compatible `supplier_sku_refs`.
- `lastSuppliedAt` has no caller yet. It stays because Purchasing accepted that shape, the same as `relation` in `listForSku`.

## Why a plain read

The values are hints (Purchasing FR-PO-007). No code deletes these rows or changes their `supplier_id` or `sku_id`, so a returned `relationId` stays valid, and the plain read takes no gap locks on missing rows (REV-085 H2). The cost is that a relation committed a moment earlier may be missed on that save.

`fk_po_lines_supplier_sku_ref` covers one column, so the database cannot stop a line pointing at another Supplier's ref. Purchasing must take the ID from this read and never from the client.

## Also in this change

- 03 §6.8 follows the TL ruling `.worktrees/tech-lead-handoffs/h1-supplier-receiving-contract-20261106.md` (sha256 `3a6e4d4ce8aaf8dd7d212963cfc916aba51f70daa13a3b25c55c2765e1854956`): first supplied is the minimum and last the maximum, reversals never move them, a replay skips `verifySource`, a verifier refuses only by throwing, and Purchasing's dedicated instance injects it. No code change was needed.
- 03 §11.5 takes the REV-141 L1 rewording, so Purchasing re-pins once.
- Consumed Purchasing pin `366abb1f` -> `927ddc66` (`fbcbebeb`). The diff was read in full. It does not change Supplier behaviour: the composite FK needs `uq_supplier_addresses_owner`, which migration 0032 already has, and `recordSupply` is untouched. No acceptance run was repeated.

## Not in this change

The named-address read has no caller. The plain address read in `getPurchaseDefaultsInTransaction` may be stale under the caller's REPEATABLE READ view; this is not reproduced and not registered as a defect. Two-connection trials, formal runs and capacity are out of scope.

## Verification so far

| Check | Result |
|---|---|
| `supplierLookupService.test.js` with the new no-DB TC-137 case | 20 passed |
| `purchasingProviderContract.test.js`, `supplierProviderServices.test.js` | 11 passed |
| ESLint on the three changed code files | no findings |
| Real-MySQL TC-137 case | **not run** |

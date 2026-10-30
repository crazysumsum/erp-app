# Design Rebaseline, Pin Refresh and Approval Re-confirmation

Owner-authorized on 2026-10-30. Baseline `6d84ee45`. Supersedes `P0_contract_repin.md` (2026-10-22, baseline `09281b0a`).

Composite baselines moved `design 15e4423b088a → d6103ad183e2` and `plan 3fd127d19861 → 24a86ab4c677`.

## Why this was needed

Two things invalidated the 2026-10-22 baseline:

1. **The Inventory owner edited this module's own design spec.** Commits `1e9f8159` and `31324ff1` changed `03_design_spec.md` §2.4, §2.6, §3.5, §4.13, §8.7, §8.8 and §8.9 as part of delivering `inventory-purchase-provider` v1.0/v1.1. The provider contract's own §5 names this Purchasing-side alignment as part of the candidate, and its §6 states the candidate requires Sam's central approval before implementation. Until that approval, `03_design_spec.md` on main was not the text any approval covered — §4.13 said so in its own words ("採用仍須Sam批准").
2. **Three consumed contract sources drifted.** Unrelated modules changed them; the drift reproduces on unmodified `origin/main`.

Both the design-spec edits and the pin refresh move `manifest.contracts` and `specs.design`, which feed the composite digests. That stranded `APR-001` through `APR-004` and `REV-002`.

## APR-005 — Inventory-authored design changes

Each change was presented to the owner with its full diff and approved on 2026-10-30. They share one principle: replace *caller-asserted* guarantees with guarantees derived from *already-locked existing state*.

### 1. Reversal rows are inserted after the Inventory call

`§2.6` items 7 and 9, `§3.5` confirm step 3, `§8.8`.

| | Before | After |
| --- | --- | --- |
| New reversal rows | INSERTed before calling Inventory, to obtain a PK | Not INSERTed and no PK reserved before the call |
| ownerProof | The new reversal row | The original GR / Details locked at `§2.6` step 6 |
| `sourceLineId` | New Reversal Detail ID | Original GR Detail ID (`originalSourceLineId` likewise) |
| Distinguishing successive partial reversals | New Detail PK | The fixed per-reversal `event_id` |
| GR confirm lock order | GR → PO → PO Lines → GR children | PO → all PO Lines → GR → GR children |

The old shape required a row to exist before it could serve as proof, so the proof was a row that belonged to no already-locked set — self-certification. The new shape derives ownership from rows locked earlier in the same transaction, which a request body cannot fabricate.

### 2. Inventory keeps its unique constraint

`§4.13`.

`inventory_movements.reversal_of_movement_id` keeps `uq_inventory_movement_reversal`, and generic full-reversal semantics are untouched. Purchase partial reversal instead uses the append-only `inventory_purchase_reversal_links` table (Inventory-owned, migration `0101`): the new OUT Movement carries `reversal_of_movement_id = NULL`, and the cumulative cap is enforced by locking the original Movement and summing existing links in the same transaction.

This replaces the former requirement that Inventory drop the unique constraint. That requirement would have removed DB-level "one reversal per Movement" protection from every pre-existing generic reversal path, leaving only application-level enforcement. The new shape changes no existing schema. Verified in `0101`: three `RESTRICT` foreign keys, `UNIQUE(reversal_movement_id)`, `UNIQUE(operation_request_id)`, `CHECK(quantity > 0)`, `BEFORE UPDATE`/`BEFORE DELETE` triggers raising `SQLSTATE 45000`, re-runnable with full column/index/FK/check verification, no destructive `down`, no backfill.

**No purchasing schema change and no purchasing migration follow from this approval.**

### 3. The caller no longer declares its own permission

`§2.4`, `§8.7`.

The inline Inventory command example is gone; the ABI is now `inventory-purchase-provider/1.1` §2–3 by reference. Specifically:

- The `authorization: { purpose, requiredCallerPermission }` object is **removed**. A caller declaring which permission it requires is a caller choosing its own authorization bar. It is replaced by a server-issued opaque `context`, produced from the same request/transaction's locked rows and excluded from serialization and hashing.
- Each line carries a `commitment` block (locked `purchaseOrderId`, `purchaseOrderLineId`, `confirmedVersion`, tracking and UOM snapshots).
- `findOperationsBySource` semantics are fixed: a consistent snapshot in a fresh read-only transaction; `NOT_FOUND` does **not** prove non-commit and does **not** authorize a new event; `COMPLETED` requires full membership verification.

### 4. Reconciliation follows from the above

`§8.9`. Reversal reconciliation is now per-event against `(GOODS_RECEIPT_REVERSAL, original GR ID, reversal event_id, original GR Detail ID)` instead of against new Reversal Detail PKs. The old formula merged successive partial reversals of one Detail into a single row and could not detect a missing or duplicated one.

### Consequence for TASK-008

`TASK-008`'s consumer-contract evidence must assert against this shape, not the previous one: context issuance from locked rows rather than a correct `authorization` object, original-Detail `sourceLineId`s, post-call row insertion, and per-event reconciliation.

## REV-003 — review of the changed design

Recorded as `method: HUMAN`, author the Inventory module owner, reviewer Sam. `REV-002` is **not** re-pointed: it remains the record of the 2026-10-22 review of design `15e4423b`, which was a different text. This is the first review of `d6103ad1`.

## HD-008 — the consumed Inventory pin

**Answered: the pin resolves to a provider document that specifies both contracts.** No action needed beyond closing the decision.

`HD-008` asked whether the consumed pin should be repointed, because it then referenced `docs/inventory_management/03_design_spec.md`, where `postPurchaseReceiptBatchInTransaction` and `reversePurchaseReceiptBatchInTransaction` appeared zero times. The Inventory owner has since repointed the entry (`id` → `inventory-purchase-provider`, source → `docs/inventory_management/implementation/purchase-provider-contract-v1.md`), and that document specifies both methods with exact field-level ABI. The pin's hash is current and was not refreshed in this pass.

Both contracts are also now implemented and merged — PR #275 (`5c055d79`, ABI 1.0) and PR #278 (`bf0dde78`, ABI 1.1) — independently verified in this pass: `reversePurchaseReceiptBatchInTransaction` present in `InventoryPostingService.js`, `InventoryPurchaseService.js` and `inventoryPurchaseReversal.js`; `issuePurchaseReceiptContext` and `issuePurchaseReversalContext` in `InventoryPurchaseContext.js`; `findOperationsBySource` in `InventoryLookupService.js`; and `0101_create_inventory_purchase_reversal_links.js` hashing to the `dc2fa1b8…` claimed by the provider plan.

## Refreshed consumed pins

All three were verified by diff against the previously pinned content, not re-pinned on trust.

| Contract | Source | Pin | What actually changed | Touches what purchasing consumes? |
| --- | --- | --- | --- | --- |
| `item-lookup-service` | `server/src/modules/item/ItemLookupService.js` | `a09d5baf…` → `5ed3f26f…` | `b5afe3ca` added `getFulfillmentInventoryProfilesInTransaction` (+32 lines) for Fulfillment | **No.** Purchasing consumes `findManyForCommittedReceipt`, unchanged |
| `permission-catalogue` | `server/src/modules/authorization/permissionCatalogue.js` | `32db8366…` → `6f6e14b6…` | `9fd7d007` added `fulfillment.view` and `fulfillment.reverse` (+2 lines, plus one stray blank line) | **No.** This module's six `purchasing.`/`receiving.` entries are intact |
| `supplier-purchasing-contract` | `docs/supplier_management/03_design_spec.md` | `a9f64493…` → `e49ac37d…` | `6b971c71` added `sort_order` and `move` endpoints to supplier addresses/contacts (DEF-037, HD-136); `6d84ee45` relaxed the for-SKU lookup p95 from 2s to 3s (NFR-005, HD-157) | **No**, with one observation below |

Not refreshed because already current: `idempotency-service`, `inventory-purchase-provider`, `currency-and-payment-terms-catalogue`.

### Observation — supplier `listForSku` latency

`§2.4` consumes `SupplierLookupService.listForSku(skuId, …)`, and Supplier has just relaxed its for-SKU lookup target from p95 < 2s to p95 < 3s.

This is **not** a conflict with `NFR-001`. That requirement covers "exact PO/GR/SKU lookup and common lists", and the operative performance table at `§11.7` names its measured flows explicitly — exact PO/GR/SKU/barcode lookup, the first page of PO/GR/Outstanding lists, 100-line PO save/submit, 200-detail GR validation/confirm, and 50k-row CSV streaming. The supplier-for-SKU picker is none of them, and `TC-012` (the only test bound to `NFR-001`) is bound to `TASK-037`/`040`/`043`/`044` in PHASE-004/005.

What remains is a UX note, not a spec breach: the PO entry screen can now contain one control answering in 3s while the rest of that screen targets 2s. It needs no decision before `TASK-008`, and should be settled before PHASE-004 performance acceptance.

Two unrelated facts worth carrying forward:

- `sort_order` does not change which address `getPurchaseDefaults()` returns. The ordering address is selected through `supplier_address_purposes` purpose + primary slot (`UNIQUE(supplier_id,purpose_code,primary_slot)`), not by list position. `sort_order` governs display order only, and is not in the `ordering_address_snapshot` allowlist.
- `purchase_orders.ordering_address_id` is a `RESTRICT` FK to `supplier_addresses(id)`; adding a column to that table does not affect it.

## Gate state after this pass

`HD-006` (OPEN-006: which open POs migrate, cutover date, legacy previously-received quantities, and who owns Inventory Opening reconciliation and Go-Live sign-off) is still `OPEN` and `MAJOR`, so the module keeps `status: BLOCKED` and `PLAN_READY` keeps reporting it. It blocks Go-Live and `TASK-044`; it does not block `TASK-008`.

`state/baseline` keeps `worktree`, `code_commit` and `source_fingerprint` from the 2026-10-22 checkpoint. Those are not reconciled here: this pass ran in a throwaway worktree, and pinning them to a path that will not survive the session would be worse than leaving a visibly stale checkpoint. The gates exercised in this pass do not read them.

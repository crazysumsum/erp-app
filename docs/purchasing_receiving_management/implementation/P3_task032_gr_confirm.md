# TASK-032 Goods Receipt Confirm and Inventory posting (2026-11-19)

**Admission:** Sam's 2026-11-19 decision suspends per-case test admission until the end of 2026-11-26: an ordinary PR, green functional CI and one non-author review. The CI administrator's receipt rule applies unchanged.

## API (design §3.5, §5.3)

`POST /api/v1/goods-receipts/:id/confirm` takes jwt, and needs `purchasing.view` and `receiving.operation`, rechecked in the transaction. `Idempotency-Key` must equal `eventId`. The body is the same as the update body (§5.3 "Update／Confirm Draft body"). Confirm does a full replace of the Draft and confirms it in one transaction. The result is `{id, number, status: "CONFIRMED", version, warnings, replayed}`; GR and PO `version` each go up by 1.

The `:id` param stays a string on this route. Inventory's issuer requires `req.input.params.id` to equal `source.documentId` exactly (provider v1 §2).

## Transaction (§2.5, §2.6, §8.7)

1. Actor freshness, then the Purchasing event claim (`CONFIRM_GOODS_RECEIPT`). An event that is already committed replays its stored result, so Inventory is never called again with a new PO version.
2. The PO and all its lines are locked `FOR UPDATE` on first contact, never `FOR SHARE` followed by an upgrade. Two confirms on one PO serialize.
3. Then the GR, its lines and its details are locked `FOR UPDATE`, with the DRAFT status and the version checked.
4. Full replace validation: the same as the Draft, but every issue blocks (`LOT_REQUIRED`, `EXPIRY_REQUIRED`, `LOT_DATA_CONFLICT` and the rest).
5. Confirm rules:
   - The Supplier's current status, via `SupplierLookupService.assertUsableInTransaction` with purpose `history`.
   - The SKU's current facts, via `ItemLookupService.findManyForCommittedReceipt` in the same transaction, `FOR SHARE`.
   - `evaluateSkuCommitment`, `evaluateMinimumLife` (confirm date = `time.fileDate()`), and `calculateOverReceipt` against the locked outstanding, which is ordered − net − closed remaining.
6. Lines and details are written with their confirm facts. The header is written last, because 0120 and 0121 freeze the children once the parent's `confirmed_at` is set.
7. One `postPurchaseReceiptBatchInTransaction` call covers every detail. The result must contain exactly the same `sourceLineId`s in input order, with the same base quantities. Anything missing, extra or different is a contract breach: `PURCHASING_DEPENDENCY_UNAVAILABLE`, and everything rolls back.
8. Writes after posting:
   - movement and operation ids on each detail;
   - PO line gross, net, outstanding and over-received;
   - PO status: CONFIRMED moves to PARTIALLY_RECEIVED or FULLY_RECEIVED, and PARTIALLY_RECEIVED stays or moves to FULLY_RECEIVED;
   - status history `RECEIVE` when the PO status changes;
   - GR CONFIRMED;
   - Audit `goods_receipt.confirmed`;
   - the operation result.

When Inventory refuses an inactive warehouse or bin, it raises `WAREHOUSE_INVALID` or `BIN_INVALID`, which are mapped to the same public Purchasing code. A bin outside its warehouse is caught earlier by the Purchasing check, with the full field path.

## Contract reading (TL `2f500f44`, Claude-side TL; Codex TL not yet replied)

- **Proof:** `status: "CONFIRMED"` is issued for a PO that is locked in this transaction and is CONFIRMED or PARTIALLY_RECEIVED, and only for lines that belong to that PO and are not closed. This is Purchasing's reading of the Inventory contract. If the Inventory owner defines it differently, the Inventory owner's definition applies.
- **`confirmedVersion`:** `purchase_orders.version` read under the lock, before the increment. The command commitment and the proof use the same value.
- **`03` §5.3 example:** it shows `"id": 501` inside a detail. The implementation does not accept detail ids, because the save is a full replace. 030 and 031 must not send them.

## Temporary state until TASK-033

The minimal confirm handler ships here, because Inventory's one-time context can only be issued from the real confirm request. Operation lookup and timeout recovery are TASK-033. Until then, a commit with an unknown outcome can only be resolved by resending the same event, which returns the stored result.

## Known limits (accepted at 20 users)

- Inventory issues one context per request (`issuedRequests`). Never add an automatic retry around confirm inside `operations.run`; a second attempt would fail with `PERMISSION_STALE`. A Confirm with no lines is refused with `PURCHASING_INPUT_INVALID` (field `lines`) before any write.

- Confirm locks the Supplier row `FOR UPDATE` (via `assertUsableInTransaction`). A concurrent Supplier status change can deadlock with it; the operation runner maps that to 409 `CONCURRENT_OPERATION`, and the user retries.
- From the TASK-029 review (TL `f66e75a3`, non-Required): two new Drafts doing their first update at the same time can deadlock on a gap lock in `goods_receipt_lines` and `goods_receipt_details`. InnoDB rolls one back and it becomes 409 `CONCURRENT_OPERATION`, with no bad data. If this becomes common, these commands could move to READ COMMITTED. This is inferred from InnoDB behaviour; it was not tested with two connections.

## Tests

`server/test/integration/purchasingGoodsReceiptConfirm.integration.test.js` has 7 cases over real HTTP, JWT, MySQL and Inventory posting:

- **C1:** two-line confirm; a second GR completes the PO; over-receipt counted on the locked net.
- **C2:** replay and event conflict.
- **C3:** over-receipt reason.
- **C4:** inactive bin, inactive warehouse and bin–warehouse mismatch.
- **C5:** missing result line, extra result line, Audit failure and PO progress failure (a temporary trigger); each rolls back real Inventory writes.
- **C6:** Blocked Supplier.
- **C7:** lot required at confirm, no permission, stale version, already confirmed.

Three mutations of `GoodsReceiptPostingService` were run, and each one turned a case red: no result-count check, no location mapping, and outstanding ignoring net.

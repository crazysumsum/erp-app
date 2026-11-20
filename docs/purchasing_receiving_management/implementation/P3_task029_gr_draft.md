# TASK-029 Goods Receipt Draft create, update and cancel (2026-11-19)

**Admission:** Sam's 2026-11-19 decision suspends per-case test admission until the end of 2026-11-26: an ordinary PR, green functional CI and one non-author review. Relayed by PM `claude-erp-app-pm-01` (agentmsg `f3f4c3c8`). CI administrator rule: one merged receipt (agentmsg `e22106a2`, `a7db8098`).

## API (design §5.3)

| Route | Body | Result |
| --- | --- | --- |
| `POST /api/v1/goods-receipts/create` | `eventId`, `purchaseOrderId`, `businessReceiptDate`, optional `supplierDeliveryNote`, `notes` | 201, an empty DRAFT with a `GR-YYYYMM-NNNNNN` number |
| `POST /api/v1/goods-receipts/:id/update` | `eventId`, `version`, `businessReceiptDate`, optional note fields and `supplierExceptionReason`, `lines[]` | 200, a full replace of lines and details, `version + 1` |
| `POST /api/v1/goods-receipts/:id/cancel` | `eventId`, `version`, `reason` | 200, CANCELLED; the number and data are kept |

All three need `purchasing.view` and `receiving.operation`, rechecked in the transaction. Each line has `purchaseOrderLineId`, optional `overReceiptReason` and `skuExceptionReason`, and 1 to 200 details. A detail has `inputUomId`, `receivedQuantity`, `warehouseId`, `binId`, `stockStatus`, and optional `lotNumber`, `expiryDate`, `manufactureDate` and `expiryOverrideReason`. Detail ids are not accepted, because the save is a full replace.

The response carries `warnings`: at most one `DUPLICATE_DELIVERY_NOTE`, with the count of matches for the same Supplier, not cancelled, within 90 days, up to 5. It is a warning only.

## Rules

- **Create:** the PO must be CONFIRMED or PARTIALLY_RECEIVED, with at least one line that is still open (`has_outstanding = 1` and not closed); otherwise `PO_STATE_CONFLICT`.
- **Lock order (§2.6):** operation → sequence (create) → PO `FOR SHARE` → PO lines `FOR SHARE` → GR, lines and details `FOR UPDATE`. Saving or cancelling a Draft never changes PO progress, Inventory balances or movements (BR-027).
- **UOM:** `inputUomId` must be the PO line's base UOM (factor 1) or the purchase UOM's `item_uoms` id (the PO's factor snapshot); otherwise `GR_DETAIL_MISMATCH`.
- **Draft validation:** a save is refused only for `ReceivingPolicyService.DRAFT_BLOCKING_CODES` (quantity, conversion, input format and duplicate dimension), plus typed errors for a foreign or closed PO line (`PO_LINE_NOT_RECEIVABLE`), an unknown warehouse or bin, and a bin outside its warehouse (`WAREHOUSE_INVALID`, `BIN_INVALID`, `BIN_WAREHOUSE_MISMATCH`). The active status of the warehouse and bin is checked at Confirm by Inventory (TASK-032).
- **Reasons:** they may be blank at Draft; Confirm decides which are required. A reason that is present must be valid: §5.1 for the general reasons, and for `skuExceptionReason` and `expiryOverrideReason` the Inventory-bound rule of 5 to 500 UTF-8 bytes after trim, single line, well-formed (TL RULING `eb0f0f32` Q3).
- **Errors:** one public error per request (§5.1 envelope). A policy issue is reported as its code with the full field path, for example `lines.0.details.1.receivedQuantity`.

## Plan and design records made in this PR

- `03` §5.1 and §8.6 now carry the narrowed reason rule and the two-date minimum-life signature (TL `9f77aa4e` deadline: no later than this change).
- `05` moves the invalid-Bin criterion from TASK-028 to TASK-032, and records the Supplier reference checkers under TASK-040.

## Tests

`server/test/integration/purchasingGoodsReceiptDraft.integration.test.js` has 9 cases over real HTTP, JWT and MySQL. Locally all 9 passed, and all 12 Purchasing integration files passed (107 of 107, serial, private MySQL 26.7.0).

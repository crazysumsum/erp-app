# Supplier contracts for Purchasing

This is the Supplier-side contract that a Purchasing module consumes. The design (§6.8, §8.7) is the authority. This page records how TASK-040 implemented it and the decisions that settled what the design left open (HD-094, HD-095).

## Choosing a Supplier for a SKU

**In-process:** `supplierCoreProvider.listForSku(skuId, { q, page, pageSize, atMs })`, contract `supplier-core-provider/v1`.

**HTTP:** `GET /api/v1/supplier-lookups/for-sku/:skuId?q=&page=&pageSize=`

- **Permission:** for now `supplier.view`, with a fresh-actor check (HD-094 1A). Purchasing has no permission of its own yet. When it does, its handler authorizes with its own permission and calls the service directly. The service does no authorization.
- **SKU check:** the SKU must be purchasable now, using Item's `assertUsable(skuId, { purpose: "purchase" })`. Otherwise the call fails closed with Item's own errors (HD-094 3A):
  - `SKU_NOT_FOUND` (404);
  - `SKU_NOT_USABLE` (409).
- **Who is listed:** every Active Supplier. A Supplier with no relation to the SKU is listed too (BR-023). Suspended, blocked, draft, pending and archived Suppliers never appear, whatever their relation (BR-024).
- **Order:**
  1. An exact match of `q` to the Supplier Code, or to this SKU's Supplier Item Code.
  2. A `preferred` relation.
  3. A relation with a last-supplied time, newest first.
  4. Everyone else, by Supplier name and then ID.

  A `stopped` relation never ranks by being preferred or by its history. It sits with the Suppliers that have no relation (HD-094 2A).
- **Search:** `q` (up to 190 characters, no control characters, otherwise 400) uses the same text search as the Supplier list: code prefix, and name, display name, phone or email containing the text. It also matches when `q` equals this SKU's Supplier Item Code (HD-094 4A).
- **Paging:** `page` starts at 1. `pageSize` is 1 to 100, default 20. `total` counts Suppliers, so the join never inflates it.
  - A call makes several reads. A relation that changes during the call can make a page miss one Supplier, but a Supplier never appears twice in one response. The list is advisory (REV-087 L-3).
- **Each item:**
  - `supplierId`, `supplierCode`, `supplierName`, `displayName`, `defaultCurrencyCode`, `defaultPaymentTermId`, `status`, `version`, `usable`, `reasons`;
  - `rankReason`: `"exact_match"`, `"preferred"`, `"recently_supplied"` or `null`;
  - `relation`: `null`, or `{ relationId, relationshipStatus, supplierItemCode, lastSuppliedAt }`.

  The response carries no Bank data.

## Supplier–SKU relations UI support (TASK-039, HD-098)

These are Supplier's own APIs for the relation tab. Purchasing does not call them.

- `GET /api/v1/supplier-lookups/skus?q=&page=&pageSize=`:
  - **Permission:** `supplier.mgmt`, with a fresh-actor check.
  - **What it lists:** the SKUs that can be purchased now, through Item's `searchForPurchase` (Item §8.3.2): Item and SKU active, purchasable, within their effective dates, with at least one active UOM.
  - **Each SKU:** `skuId`, `skuCode`, `skuName`, `itemName`, and `uoms[]`. Each UOM has `skuUomId`, `uomCode`, `uomName`, `status`, `toBaseFactor`, `isBase` and `isDefaultPurchase`.
  - **Bad input:** control characters in `q` give 400.
- **Relation responses** (list, create, update) now include `purchaseUomCode`, `purchaseUomName` and `purchaseUomStatus`. They are all `null` when no purchase UOM is set.
- **Purchase UOM must be active.** Choosing a purchase UOM, on create or when changing it, needs that UOM to be active, otherwise 409 `SUPPLIER_SKU_UOM_INACTIVE`. A UOM that belongs to another SKU stays 400 `SUPPLIER_SKU_UOM_INVALID`. An update that keeps the current UOM is accepted even if that UOM has since been deactivated, because it is history.

## At submit time

A list result is only a suggestion. When Purchasing saves an order, it must check the Supplier again, inside its own transaction (BR-032):

- `assertUsableInTransaction(connection, supplierId, { purpose: "purchase", atMs })` locks the Supplier row and refuses a Supplier that is no longer Active with `SUPPLIER_NOT_USABLE`.
- `getPurchaseDefaultsInTransaction(connection, supplierId, { atMs })` returns the Supplier, Currency, Payment Term and ordering address. Purchasing keeps them as its own snapshot (AC-032).

A `preferred` mark never makes a Supplier usable.

## After a goods receipt

`SupplierRelationService.recordSupply(command)` (TASK-038) records supply history. See `implementation/62_task_041_carry_forward.md`, "TASK-038", for the command, the idempotency fence and the source verifier that Purchasing must supply.

# HD-019 — Lookups for the PO form

Built on 2026-11-04 from main `d434a857` as preparation for TASK-018. No schema change, manifest edit or new dependency; baselines unchanged (design `bedf5d1b`, plan `7cca891a`). Design §5.5, §7.3; FR-020, FR-026–029.

TASK-018 lists client files only, but the form needs Supplier, SKU, Currency, Payment Term, warehouse and Buyer choices and Supplier defaults. §5.5 designs `purchasing-lookups/suppliers` and `/skus`, and no task in 05 builds them. The existing routes need `supplier.view`, Supplier management or an Inventory view permission, so a buyer holding only `purchasing.mgmt` receives 403.

## HD-019

Sam answered on 2026-11-04: 「全部按建議」, which selected option A on all three points.

1. **Delivery (1A).** A preparatory backend PR delivers the lookups before TASK-018's client PR. 05 is not edited, so the plan baseline stays where it is; this file and the harness state hold the decision until the next design revision.
2. **Buyer candidates (2A).** Active users holding `purchasing.mgmt`, returned as `id` and label only. The form defaults to the actor. A Draft keeps its existing Buyer even if that person no longer qualifies; the service still checks only that the Buyer is Active.
3. **Supplier search without a SKU (3A).** The Supplier provider only searches by SKU, so this reads Supplier IDs directly, as HD-017 1A does, and `findManyByIds` with `purpose: "purchase"` decides eligibility and builds the projection. The read filters on `status = 'active'` only so that stopped Suppliers do not use up the row limit.

## Routes

All are `GET`, require `purchasing.mgmt` and re-read the actor's permissions from the database. Errors follow §5.7 with `PURCHASING_INPUT_INVALID` and a field.

| Path | Query | Returns |
| --- | --- | --- |
| `/api/v1/purchasing-lookups/suppliers` | `q`, `skuId` | Active Suppliers. With `skuId`, `listForSku` ranks them; relation affects order only. |
| `/api/v1/purchasing-lookups/suppliers/:id/defaults` | | Currency, Payment Term and primary ordering address from `getPurchaseDefaults`. |
| `/api/v1/purchasing-lookups/skus` | `q`, `barcode` | SKUs a new PO accepts, with active UOMs, Base UOM and tracking. |
| `/api/v1/purchasing-lookups/currencies` | | Active Currencies with decimal places. |
| `/api/v1/purchasing-lookups/payment-terms` | | Active Payment Terms. |
| `/api/v1/purchasing-lookups/warehouses` | `q` | Active warehouses, read directly as in HD-015 3A. |
| `/api/v1/purchasing-lookups/buyers` | `q` | The Buyer candidates above. |

`approvers` stays with TASK-023, which owns the approval flow.

## Choices within the design

- **Same eligibility as save.** `skus` applies the rule `PurchaseOrderService` uses, including `inventoryTracked` and the supported tracking policies, because `searchForPurchase` also returns SKUs that save would refuse. The tracking list is imported from the service, not copied.
- **No pagination.** Each list returns at most 100 rows with no count. The form asks the user to narrow the search, as Supplier's option lists do. Add paging if a real list outgrows this.
- **A SKU or Supplier that fails maps to Purchasing's codes.** `SKU_NOT_PURCHASABLE` and `SUPPLIER_NOT_PURCHASABLE`, as on save. An inactive default Currency or Payment Term keeps its Business Master code, so the form can tell the user to choose by hand.
- **Prefix search without a SKU, contains search with one.** `listForSku` uses Supplier's own search. Without a SKU this follows §8.9's prefix rule. The form does not send `skuId` yet, so users see one behaviour; the route keeps `skuId` because §5.5 specifies it.

## Deferred to the post-UAT handoff

`suppliers` without `q` orders by name; `buyers` joins roles to users on every keystroke of a debounced search. Neither has a capacity measurement. Owner: Purchasing, with the handoff items already recorded for TASK-016.

The CI owner also needs to add `server/src/handlers/purchasing-lookups/` to the capacity catalog `.github/scripts/sales-import-capacity.mjs` with the other new handler directories.

## CI admission

Sam approved on 2026-11-04: 「全部批准，我作為project owner 批準你幫我發digest」. The scope is 6 new functional integration cases in `server/test/integration/purchasingLookups.integration.test.js`, on every PR and main push in the existing server shards, in `.github/test-admissions/purchasing-hd019-lookups.json`. He also authorized publishing this receipt's digest once, as project owner.

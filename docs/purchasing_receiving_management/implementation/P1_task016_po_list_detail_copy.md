# TASK-016 — PO List, Detail and Copy API

Built on 2026-11-04 from main `87edf064`. No schema change, manifest edit or new dependency; baselines unchanged (design `bedf5d1b`, plan `7cca891a`). Design §5.1, §5.2, §5.6, §8.2, §8.9; FR-LIST-001～010, FR-PO-016, AC-048, AC-051; `TC-003`. The task text cites `FR-PO-021～024`, which do not exist; Copy's requirement is FR-PO-016. Recorded here rather than editing 05, so the baselines do not move.

| Route | Handler | Contract |
| --- | --- | --- |
| `GET /api/v1/purchase-orders` | `ListPurchaseOrdersHandler` (`listPurchaseOrders`) | jwt, `purchasing.view`, server pagination, allowlisted filters and sort, 200. |
| `GET /api/v1/purchase-orders/:id` | `GetPurchaseOrderHandler` (`getPurchaseOrder`) | jwt, `purchasing.view`, snapshot, line progress, `allowedActions`, `currentMasterDifferences`, 200. |
| `POST /api/v1/purchase-orders/:id/copy` | `CopyPurchaseOrderHandler` (`copyPurchaseOrder`) | jwt, `purchasing.mgmt`, idempotency enabled, body is `{eventId}` only, source ID from the path, 201. |

Reads live in `PurchasingInquiryService`, following Sales. Copy is `PurchaseOrderService.copy()`, because it shares the create path's claim, sequence, snapshot, audit and REJECTED handling.

## HD-017

Sam answered on 2026-11-04: 「全部按建議」, which selected option A on all four points.

1. **Name search (1A).** No provider covers this: Supplier has no name search, and Item's `searchForPurchase` returns only purchasable SKUs, so old POs with a stopped SKU would disappear. Purchasing reads `suppliers` and `item_skus`/`items` directly and takes IDs only, by prefix, at most 100 each. The manifest lists these as `read_only`, and HD-015 3A is the precedent. An exact code sorts first, so the cap cannot remove it. **Known limit:** the match uses current names, so a name from before a rename does not find old POs. More than 100 matches are truncated, as §8.9 accepts.
2. **Copy (2A).** Keep what is still valid and warn about the rest.
   - The whole copy is refused when the Supplier is not purchasable, the Currency is unusable, or no line remains.
   - `COPY_FIELD_CHANGED` with `field`: Payment Term, warehouse, an address that is no longer the primary ordering address, and past delivery dates are cleared; a disabled Buyer becomes the actor.
   - `COPY_LINE_DROPPED` with `lineNumber`, which is the source line number: the SKU or UOM is no longer purchasable, or the current factor cannot produce a whole Base quantity.
   - Order Date is always today. Unit prices are copied as they are.
3. **Detail sections (3A).** Approval, Goods Receipt and status history fields are not returned yet. TASK-022 and TASK-027 add them with their tables. Fixed empty arrays would present "not built" as "no data".
4. **`hasOutstanding` (4A).** True means `has_outstanding = 1` and status `CONFIRMED` or `PARTIALLY_RECEIVED`; false is everything else. Outstanding quantities on other statuses return `"0"`. A Draft's flag defaults to 1, but nothing is due on a document nobody has confirmed.

## Choices within the design

- **Fresh permissions on reads.** Reads call `assertActorFresh` inside the transaction, as Sales does. `allowedActions` comes from the permissions read there, not from the JWT, and lists only actions that have routes today: `edit` and `copy`.
- **Fixed query count.** A list page runs the actor check, up to three search reads, the count, the ID page, the summary, the grouped progress query and the inactive-master query. Nothing runs per PO or per line. A test asserts the count does not grow with PO or line volume.
- **`currentMasterDifferences` runs after the transaction.** The provider's `InTransaction` methods lock the Supplier row, which a GET must not do, and borrowing a second connection while holding one risks pool exhaustion. So the difference is read with the non-locking provider methods after commit. It holds only values that differ.
- **Query validation in the handler,** like Sales: the route declares `query: {}`, and a coercing validator produces §5.7's `PURCHASING_INPUT_INVALID` with the field name. The service then rejects impossible dates and reversed ranges.

## Defects found by the tests

- **Non-ASCII `q` returned 500.** `po_number` is `ascii_bin`, so comparing it with a Chinese search term raises `ER_CANNOT_CONVERT_STRING`. The comparison now runs only when `q` has the PO number shape.
- **`format: "date"` accepts `2026-02-30`.** The service now passes all four date filters through `localDate`.
- **A Supplier's inactive default term refused the whole copy.** `getPurchaseDefaultsInTransaction` also validates the Supplier's default Currency and Payment Term. Copy now treats that failure as "address unavailable", clears the address and warns.

## Verification

- `server/test/integration/purchasingInquiry.integration.test.js`: 8 cases on real MySQL, rolled back.
- `server/test/integration/purchasingPurchaseOrders.integration.test.js`: 4 new Copy cases.
- `server/test/purchasing/purchaseOrderHandlers.test.js`: 4 new contract cases, no database.
- `server/test/integration/purchasingPurchaseOrderApi.integration.test.js`: 2 new cases through the real application and HTTP, including the response schemas.
- Mutation sweep, 101 mutants over the service, schema and handler files. The first pass had 13 survivors, all real test gaps: 3 on outstanding and overdue conditions, 6 on individual `currentMasterDifferences` comparisons, and 4 on Copy's line conditions. Three further mutants were added for the Supplier code comparison and the exact-code ordering. After adding cases, all 16 of those are RED.

## Deferred to post-UAT capacity validation

No capacity case was added or run. Owner: Purchasing, with the CI owner for the capacity map.

- The default `updatedAt` sort has no usable index without a status filter: `idx_po_list` starts with `status`, so an unfiltered list filesorts every PO. Scale and threshold: requirement capacity with 20 concurrent users, list p95 under 2 seconds (design §1.1).
- A `q` search uses an OR across `po_number`, `supplier_reference`, `supplier_id` and an `EXISTS` on lines, and may scan the header table at the same scale. Any index this requires is a schema change that needs sign-off first.

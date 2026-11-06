# Supplier and Receiving interface handoff

Written on 2026-11-06 for the PM to forward to the Supplier owner. It is a read-only check of `origin/main` `97cb27f1` and this branch. Nothing here is implemented, and none of the recommendations are decisions yet.

**Sources not seen directly:** the PM reports that Supplier answered on #294, but the issue has no such reply as of this check (7 comments, the latest from 2026-11-05). The Supplier candidate below comes from the Supplier owner's handoff note of 2026-11-06. If the PM's copy differs, that copy wins and this section needs a second look.

## Part 1: consumer requirements for HD-015 2C

### `findSkuRefsInTransaction(connection, supplierId, skuIds)`

**Accepted, with one required addition: each row must carry `skuId`.** The candidate says "same shape as the `relation` in `listForSku`", but that shape has no `skuId`, and Purchasing has to match rows to lines.

| Item | Purchasing's requirement |
| --- | --- |
| Caller | `PurchaseOrderService` line validation, on save and on submit. It runs on the caller's `tx`, with no second connection. |
| Input | One Supplier, up to 100 SKU IDs in one call, because §8.2 forbids per-line queries. Duplicates must be tolerated. |
| Output | Existing refs only: `{ relationId, skuId, relationshipStatus, supplierItemCode }`. Other fields are fine if they are not bank data. A missing relation is simply absent and is not an error. |
| Status | Rows with `stopped` are returned, with their status. Purchasing decides what to do with them (see open item 2). |
| Eligibility | No check on Supplier or SKU eligibility here, and no failure for an inactive relation. FR-PO-007 says relations are hints only. |
| Consistency | A plain read is enough. The values are hints, and the `supplier_sku_ref_id` FK protects the link. This relies on refs never being deleted, as Supplier states. |

Purchasing's use: it writes `supplier_sku_ref_id` and `supplier_item_code_snapshot` on the PO Line. A NULL code becomes `''`.

### `getOrderingAddressInTransaction(connection, supplierId, addressId, { atMs })`

**The signature and locking are accepted, but the method has no caller yet.** Today's form only toggles the primary address, and `/purchasing-lookups/suppliers/:id/defaults` returns only that one (see open item 1).

| Item | Purchasing's requirement |
| --- | --- |
| Caller | `PurchaseOrderService` header validation, on save and on submit. Copy also uses it, in place of the comparison with the primary address. |
| Output | `null`, or at least `{ id, supplierId, addressLine1, addressLine2, addressLine3, city, stateRegion, postalCode, countryCode, phone }`. Those are the fields of Purchasing's snapshot allowlist. |
| Returns `null` when | The address belongs to another Supplier, is not active, or has no `ordering` purpose. It does not have to be primary. Purchasing turns `null` into its own error, or into a Copy warning. |
| Must not check | Default Currency or Payment Term. `getPurchaseDefaultsInTransaction` does, and an inactive default term once failed a whole Copy (TASK-016). |
| Supplier eligibility | Not part of this method. Purchasing already calls `assertUsableInTransaction` separately. A tolerated Supplier keeps its stored snapshot and never calls this. |
| Consistency | Root `FOR UPDATE`, then `LOCK IN SHARE MODE` on the address. `assertUsableInTransaction` already takes that root lock in the same transaction, so this adds no new lock order. The view opens at `assertActorFresh`, before the lock, so a plain read could return an old status. |

**Related, not reproduced by me:** the Supplier owner notes that the address read in `getPurchaseDefaultsInTransaction` is plain and may be stale under the same view. Purchasing uses that method on save and submit today, so Purchasing wants this checked.

### Open items for Part 1

1. **A list of ordering addresses (product scope).** FR-PO-003 is a Must and lets users override the address with a currently valid one. HD-015 2C narrowed this to the primary address for now. Offering a choice needs a list lookup and a form change, and no task covers them. Without it, the named-address read has no caller. Recommendation: Supplier delivers `findSkuRefsInTransaction` first, and the address read waits until someone decides to offer the choice.
2. **`stopped` relations (Purchasing).** Recommendation: leave the link NULL and the code empty, and never block the line.
3. **No Purchasing task owns the wiring.** `05_development_tasks.md` does not mention HD-015 2C or `supplier_sku_ref_id`. Using the new read needs a task or a plan change.
4. **Pins.** A new provider method moves Supplier's 03, and Purchasing's pin on it is already stale (#294). Purchasing refreshes the pin through its own process, once, after the Supplier change lands.

## Part 2: Receiving TASK-032, TASK-033 and TASK-040

None of this code exists yet: the GR tables arrive with TASK-027. `TASK-040` is the earliest task where the Supplier projection can be checked for real, through `TC-011`.

### Already decided

| Topic | Decision | Source |
| --- | --- | --- |
| Command `eventId` | A client UUID, equal to `Idempotency-Key`, reused on retry. | Purchasing §2.7 |
| Unknown commit | Look up by `eventId`; never retry with a new event. TASK-033 delivers the lookup. | Purchasing §2.5, §2.7 |
| Confirm event storage | `goods_receipts.confirm_event_id`, `CHAR(36)`, unique. | Purchasing §4.9 |
| Inventory receipt identity | `documentId` is the GR, `eventId` is the Confirm event, `sourceLineId` is the **GR detail**. | Inventory provider contract v1 |
| Inventory reversal identity | `documentId` is the original GR, `eventId` is this reversal's intent, and the line is the original GR detail. | Inventory contract, Purchasing §8.9 |
| Reversal behaviour | New OUT movements, with GR status `PARTIALLY_REVERSED` or `REVERSED`. A correct receipt needs a new GR. §3.7 does not mention Supplier. | Purchasing §3.7 |
| Who calls `recordSupply` | Purchasing, after commit, in TASK-040. A failure never rolls back the GR or shows it as failed. | Purchasing §2.4, TASK-040 |
| Who provides `verifySource` | Purchasing. Without it, `recordSupply` returns 503 and writes nothing. | Supplier TASK-038 record, `P0_consumer_contract_gate.md` |
| Supplier's event rules | `eventId` is stable from Purchasing. `(sourceType, sourceId, sourceLineId)` is unique. A replay writes nothing. Never sets preferred. Keeps first and last supplied as minimum and maximum. | Supplier §6.8 |
| Reconciliation | Backfills the soft projection only, and never changes PO or Inventory records. | Purchasing §12.5, TASK-040 |

### Still open

| # | Question | Why it is open | Recommendation | Owner |
| --- | --- | --- | --- | --- |
| 1 | Is Supplier's `sourceLineId` the GR line or the GR detail? | No document decides. Inventory's use of the detail does not settle it. | **GR line.** Supply is a fact per Supplier and SKU, and one line can have many physical details. | Purchasing, confirmed by Supplier |
| 2 | What is the per-line `eventId`? | `confirm_event_id` cannot be used directly: Supplier's `event_id` is unique, so a second line would conflict. | `<confirm_event_id>:<gr_line_id>`. It fits Supplier's 64 visible ASCII characters and needs no new column. | Purchasing |
| 3 | Which stored value feeds each field? | Not specified. A replay with any changed value gives `IDEMPOTENCY_CONFLICT`, so each must stay fixed after Confirm. | `sourceId` is the GR, `supplierId` is the GR's, `skuId` is the GR line's. `purchaseSkuUomId` and `supplierItemCode` come from the PO Line snapshot. This depends on the server refusing PO edits after a Confirmed GR: §7.4 states it for the UI, so TASK-026 must enforce it. `supplierItemCode` stays empty until Part 1 is wired. | Purchasing |
| 4 | Is `suppliedAt` `confirmed_at` or `business_receipt_date`? | Not specified. `confirmed_at` is a server fact in ms. The receipt date reflects when goods arrived, but may be back-dated and needs a time-zone rule. | `confirmed_at`. | Purchasing; tech lead if disputed |
| 5 | What should `verifySource` accept after a reversal? | Not specified. | Accept `CONFIRMED`, `PARTIALLY_REVERSED` and `REVERSED` with `confirmed_at` set, so a replay still works. Refuse `DRAFT` and `CANCELLED`. Check the line, GR, Supplier and SKU all match. | Purchasing |
| 6 | Does a full reversal undo `last_supplied_at`? | Neither design says, and Supplier has no undo contract. The value affects only ranking. | No change: keep the history, which matches the append-only events. Changing this would need a new Supplier contract. | Tech lead; Sam only if a change is wanted |
| 7 | Where is the verifier injected? | Production builds `SupplierRelationService` at `supplierSkuRelationHandlers.js:76` without one, which is correct for those routes. | Purchasing's post-commit service builds its own instance with `verifySource`. No Supplier code change. | Supplier to confirm |
| 8 | What may the verifier lock? | Not specified. It runs inside Supplier's transaction, after the Supplier root lock. Confirm takes Purchasing's locks first and then the Supplier root, so taking GR or PO locks here would invert the order. | Plain reads only. | Purchasing |
| 9 | How does reconciliation find missed lines? | Purchasing reading `supplier_supply_events` directly would cross the module boundary, and no read contract exists. | Decide in TASK-040. Replaying is safe because a replay writes nothing, but the scan needs a bound. | Purchasing with Supplier |

## Who needs to act

- **Supplier, through the PM:** add `skuId` to the refs output, confirm items 1 and 7, and check the stale-read note.
- **Purchasing, at TASK-032 and TASK-040:** record the answers to items 1 to 5, 8 and 9.
- **Tech lead:** item 6.
- **Sam, only if a choice of address is wanted in this release:** Part 1, open item 1.

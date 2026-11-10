# Supplier and Receiving interface handoff

Written on 2026-11-06 for the PM to forward to the Supplier owner. It is a read-only check of `origin/main` `97cb27f1` and this branch. Nothing here is implemented, and none of the recommendations are decisions yet.

**Sources not seen directly:** the PM reports that Supplier answered on #294, but the issue has no such reply as of this check (7 comments, the latest from 2026-11-05). The Supplier candidate below comes from the Supplier owner's handoff note of 2026-11-06. If the PM's copy differs, that copy wins and this section needs a second look.

## Part 1: consumer requirements for HD-015 2C

### `findSkuRefsInTransaction(connection, supplierId, skuIds)`

**Accepted in the version the PM relayed on 2026-11-06:** a `Map` from `skuId` to `{ relationId, relationshipStatus, supplierItemCode, lastSuppliedAt }`, as a plain read that keeps `stopped` rows. The map key meets the need for `skuId`, and `UNIQUE(supplier_id, sku_id)` means one row per SKU.

Three details Purchasing needs stated in the contract: map keys and `relationId` are numbers, an empty `skuIds` returns an empty map without a query, and duplicate IDs are tolerated.

| Item | Purchasing's requirement |
| --- | --- |
| Caller | `PurchaseOrderService` line validation, on save and on submit. It runs on the caller's `tx`, with no second connection. |
| Input | One Supplier, up to 100 SKU IDs in one call, because §8.2 forbids per-line queries. Duplicates must be tolerated. |
| Output | Existing refs only. A missing relation is simply absent and is not an error. |
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

### Decided by the tech lead on 2026-11-06

`/Users/sam/Documents/workspace/erp-app/.worktrees/tech-lead-handoffs/h1-supplier-receiving-contract-20261106.md`, SHA256 `3a6e4d4ce8aaf8dd7d212963cfc916aba51f70daa13a3b25c55c2765e1854956`. That file is the contract. This table only maps this handoff's earlier questions to it.

| Question | Decision |
| --- | --- |
| Supplier's `sourceLineId` | The GR line, as recommended here. |
| Per-line `eventId` | `<confirm_event_id>:<gr_line_id>`. Never a reversal event or a new UUID. |
| Field sources | The GR and its line, plus UOM and Supplier Item Code from the PO Line's immutable Confirm source. A NULL code compares as an empty string. Never rebuilt from the current relation. |
| `suppliedAt` | `confirmed_at`. |
| After a reversal | Accept `CONFIRMED`, `PARTIALLY_REVERSED` and `REVERSED`. **Stricter than recommended here:** status and `confirmed_at` are not enough. The verifier checks the GR, line, PO Line and PO owner chain, Supplier and SKU, received quantity above zero, the Confirm event and time, and the completed Confirm operation. Every command field must match. |
| `last_supplied_at` after a reversal | Never rolled back; first is the minimum and last the maximum. No undo contract. |
| Verifier injection | A Purchasing-owned service instance, with Supplier to confirm. |
| Verifier locks and failures | Plain reads on Supplier's connection, with no locks and no second connection. **Added:** it succeeds by returning and fails by throwing, because Supplier ignores the return value, so `false` or `null` would pass. |
| Replay | An identical existing event skips the verifier, so a replay does not re-check the GR. |
| Finding missed lines | Still open in detail: TASK-040 delivers a bounded backfill. |

**One correction for the owner list:** this handoff said TASK-026 must enforce the refusal of PO edits after a Confirmed GR, and the tech lead's file repeats that. TASK-026 is the UI task. The server rule belongs to **TASK-025**, whose criteria already refuse withdraw, cancel and commerce updates after receipt.

**One point for TASK-025 to get right:** §8.4 guards withdraw and cancel with `has_confirmed_receipt = 0` and "`NOT EXISTS` confirmed GR". A fully reversed GR has status `REVERSED`, so a check on status `CONFIRMED` alone would allow a withdrawal, make the PO editable again and break the immutable source the verifier relies on. The guard must count any GR that was ever confirmed, such as `confirmed_at IS NOT NULL`, and `has_confirmed_receipt` must stay 1 after a reversal.

## Who needs to act

- **Supplier, through the PM:** state the three details above, confirm GR-line granularity and verifier injection, align §6.8's first and last wording to minimum and maximum, and check the stale-read note.
- **Purchasing:** TASK-025 for the server rule above, TASK-027 for the schema and immutable Confirm source, TASK-032 and TASK-033 for Confirm and GR support in the operation service, TASK-040 for the verifier, the command and the bounded backfill.
- **Sam, only if a choice of address is wanted in this release:** Part 1, open item 1.

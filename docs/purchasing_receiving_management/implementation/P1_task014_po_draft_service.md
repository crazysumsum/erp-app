# TASK-014 — PO Draft Create/Update Domain Service

Built on 2026-11-03 from main `cb685ce3`. No schema and no manifest edit; baselines unchanged (design `08a08a3d`, plan `d1c00718`). Design §2.5–2.6, §3.1, §4.5–4.6, §5.2, §8.2; FR-PO-001～020, AC-003～010; `TC-003`.

| Unit | Contract |
| --- | --- |
| `PurchaseOrderService.create({claims, input, context})` / `update({claims, purchaseOrderId, input, context})` | One REPEATABLE READ transaction: `assertActorFresh()` plus `purchasing.mgmt` → event claim → sequence (create) or `purchase_orders … FOR UPDATE` then its lines by ID (update) → Supplier, Business Master, Warehouse, Buyer and Item reads → header, full line replace, Audit → operation complete. Returns `{id, number, status, version, warnings, replayed}`. `claims` are the JWT claims (`sub`, `roles`, `permissions`); `context` is `requestId`, `correlationId`, `ip`. |
| `draftProjection(input, {maxLines, update})` (`purchasingProjections.js`) | Pure validation of the editable projection. Snapshots, factor, Base quantity, amounts and status are not in the allowlist, so a client value is an unknown field. An omitted optional field means cleared: update replaces, it does not patch. Errors carry the field, including `lines.N.orderedQuantity`. |
| `PurchasingAuditService.recordRejected(tx, {...})` | REJECTED audit for a 4xx outcome with no business write, in its own short transaction (§4.15). Detail is `{code}` only. Action is `purchase_order.created`/`.updated`, or `purchasing.operation_conflict` for `PURCHASING_EVENT_CONFLICT` (§12.2). The actor label is read from `users`, because a `PERMISSION_STALE` actor has no fresh projection. |

New public codes (§5.7): `ZERO_PRICE_REASON_REQUIRED` 400, `PURCHASE_ORDER_NOT_FOUND` 404, `PO_STATE_CONFLICT`, `VERSION_CONFLICT` (details: `currentVersion` only), `SUPPLIER_NOT_PURCHASABLE`, `SKU_NOT_PURCHASABLE`, `WAREHOUSE_INVALID` 409.

## HD-015 — provider gaps and draft eligibility

Sam's decision, 2026-11-03: "全部按你的建議執行", accepting 1B, 2C, 3A and 4A as proposed in this session.

1. **B — eligibility on Draft save.** Anything newly chosen must be eligible now: the Supplier on create or when changed, a new line, and a line whose SKU or Purchase UOM changed. A Supplier or line left unchanged on update that has since become ineligible is saved with a warning (`SUPPLIER_NOT_PURCHASABLE`, or `SKU_NOT_PURCHASABLE` with `lineNumber`); TASK-017 submit revalidates strictly. Serial tracking is always refused because the line snapshot cannot hold it.
2. **C — Supplier provider gap.** Supplier exposes only the primary ordering address, so `orderingAddressId` accepts null or that address; `supplier_sku_ref_id` stays NULL and `supplier_item_code_snapshot` empty. A tolerated (now ineligible) Supplier keeps its stored address snapshot and cannot pick a new one. Open for the Supplier owner: a transactional read of a Supplier's address by ID and of `supplier_sku_refs`.
3. **A — Warehouse and Buyer.** Read in the transaction like Sales: `inventory_warehouses … LOCK IN SHARE MODE` with `status = 'ACTIVE'`, and `users … status = 'active' LOCK IN SHARE MODE`. The Buyer label is `display_name`, else `username`.
4. **A — Item reads, implemented without the extra connection.** The proposal was to read SKU/UOM before opening the transaction. The code instead builds `ItemLookupService` on the transaction connection (`new ItemLookupService({database: tx, …})`), the existing pattern in `inventoryFulfillmentAllocationPreparation.js`, `SalesInquiryService` and `SalesOrderLifecycleService`. It meets the proposal's goal, one connection and two fixed queries for any number of lines, and adds no race window between read and commit. These are plain reads from the transaction snapshot, not locking reads. TASK-017 must decide whether submit needs a locking Item read; that, not a new transactional method, is now its prerequisite.

## Choices within the design

- **Lines are deleted and re-inserted with their existing IDs.** `uq_po_lines_number` plus the 1–100 CHECK leaves no free line number to reorder through when a Draft has 100 lines. A kept line keeps its ID and `created_at`, and its `version` increments. Draft lines have no references; GR lines arrive later and only against confirmed POs.
- **Expected delivery dates are not earlier than the Order Date**, on lines (requirement §248) and on the header.
- **A non-zero price with a zero-price reason is refused** rather than silently dropping the reason.
- **The event hash covers the normalized draft plus the PO ID**, so `"1.5"` and `"1.50"` are the same request here. `purchasingPayloadHash()` itself is unchanged.
- **A replay returns the stored summary with `warnings: []` and `replayed: true`**; the warnings described the masters at the time and are not recomputed.
- **Supplier or SKU not found is reported as not purchasable**, the same as an inactive one. Business Master refusals (`CURRENCY_NOT_ACTIVE`, `PAYMENT_TERM_NOT_ACTIVE`) and `BUSINESS_MASTER_NOT_READY` pass through with their own public codes.
- **The address snapshot is the §4.5 whitelist** (three address lines, city, state/region, postal code, country, phone) and refuses more than 2048 bytes.
- **Only 4xx ApplicationErrors write a REJECTED audit.** 5xx and unexpected errors are failures, not rejections. If the REJECTED insert itself fails, the original error is still thrown and `purchasing.audit.rejected_not_persisted` is logged; the audit is never reported as persisted.

## Verification

- `server/test/purchasing/purchasingProjections.test.js`: 5 cases, no database.
- `server/test/integration/purchasingPurchaseOrders.integration.test.js`: 8 cases on MySQL with the real Supplier, Item and Business Master providers, sequence, operation and audit services. Seven run inside one outer transaction that is rolled back; the service's `withTransaction()` becomes a SAVEPOINT, rolled back on failure, so all-or-nothing stays observable. Together they cover snapshots and amounts (3 BOX × 24 = 72 EA; HALF_UP; total from rounded lines), Inventory unchanged, replay and conflict, full replace, stale version, foreign child ID, non-Draft, missing PO, every eligibility refusal, the HD-015 1B tolerance, audit-failure rollback and the REJECTED audit paths. The eighth commits, because only a real commit shows the PO row lock. Two updates with the same version queue behind a third connection's lock; the probe uses the CI fixture administrator to read `performance_schema`. Exactly one wins and the other receives `VERSION_CONFLICT` with `currentVersion: 2`. It uses HKD and no Payment Term (TC-001 requires none), deletes its POs and masters afterwards, and leaves its operation and audit rows plus one sequence row in a random month after 2100.
- Mutation sweep, 47 mutants: 45 RED. The first pass left four survivors: the update audit action (an assertion was added), the PO `FOR UPDATE` (the race case was added), and two that are equivalent while the PO row lock holds: the lines' `FOR UPDATE`, and the `AND version = ?` compare-and-set in the UPDATE. Every writer of a PO's lines locks the PO first (§2.6), so both stay as defence in depth.

## CI admission

Pending Sam's decision on the two new files.

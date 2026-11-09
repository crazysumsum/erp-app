# TASK-027 early sub-delivery: `goods_receipts` header (document proposal only)

**Status:** proposal for the PM and TL. It does not approve, write or run a migration, and it opens no public entry.

**Why:** TASK-025's withdraw and cancel need an authoritative "this PO never had a confirmed GR" fact. It must be read in the same transaction, under the PO root lock (§8.4, H1). Today that fact has no table to come from.

## Scope

- **In scope:** the **complete** design §4.9 `goods_receipts` header, as an early sub-delivery of TASK-027 (P3-T01). There is no reduced or temporary table.
  - All columns, as §4.9 lists them;
  - the owner FKs: `purchase_order_id` to PO with RESTRICT, and the composite `(purchase_order_id, supplier_id)` to `purchase_orders(id, supplier_id)`, which `uq_purchase_orders_id_supplier` already provides;
  - actor FKs with SET NULL;
  - the confirmation history: `confirmed_at`, `confirmed_by` and `confirm_event_id` UNIQUE;
  - `status` and `version`;
  - all UNIQUE keys and indexes: `gr_number`, `(document_year_month, sequence_no)`, `uq_gr_id_po`, `idx_gr_list`, `idx_gr_po`, `idx_gr_supplier`, `idx_gr_delivery_note` and `idx_gr_flags`.
  - The PO migrations' convention adds CHECKs: the 5 statuses, flags 0 or 1, `version >= 1`, and the `gr_number` format. These are **for the TL to decide**, because §4.9 does not list them.
- **Out of scope, staying in TASK-027:** `goods_receipt_lines` (§4.10) and `goods_receipt_details` (§4.11). TASK-027 cannot be marked DONE with only the header.
- **Lock order:** `idx_gr_po` serves the reader, `SELECT ... WHERE purchase_order_id = ? AND ...`, run after `purchase_orders ... FOR UPDATE`. This follows the PO-first lock order of §2.6.

## Points needing a decision before the source is written

1. **Ever-confirmed predicate.**
   - Option A: `confirmed_at IS NOT NULL`.
   - Option B: `status IN ('CONFIRMED', 'PARTIALLY_REVERSED', 'REVERSED')`.
   - Either way, §4.9 needs `confirmed_at` to be immutable once set, so that a full reversal keeps the fact. §4.9 does not say so. A BEFORE UPDATE trigger refusing to change a non-null `confirmed_at` would fit the existing trigger pattern (§4.x, 0116). **TL decision.**
2. **Migration number.** The next free number in the global sequence, rechecked at writing time. It is 0119 after `origin/main` `b28a7d88`. This is a shared resource.
3. **Explanation before writing.** Per CLAUDE.md §8, a schema change needs its explanation and Sam's sign-off before the migration is written.

## Order

1. The PO accepted baseline: TASK-024 backend, then client, then TASK-025, merged.
2. Source review of the header migration.
3. Functional verification of that migration, approved separately: clean and forward migrate, FKs, UNIQUE keys, CHECKs, and the trigger if chosen.
4. The real ever-confirmed reader, in the same transaction under the PO root lock, wired into production through `PurchaseOrderLifecycleService({ receiptFacts })`. It restores `cancel` and `withdrawConfirmation` in `allowedActions`.
5. TASK-025 success and refusal acceptance, the "after" column of ④.
6. TASK-026, then the Phase 2 checkpoint.

TASK-032's GR confirm sets the sticky `has_confirmed_receipt` in its own transaction, and a full reversal keeps it.

## ⑤ Verification for the header, once source is approved (not written or run)

- Integration test on a private MySQL:
  - a clean migration and a forward migration from 0118;
  - all columns, types and defaults read from `information_schema`;
  - every UNIQUE, index and FK name and its columns;
  - inserting a GR whose supplier does not match its PO fails (composite FK);
  - a second `confirm_event_id` fails;
  - deleting a PO that has a GR is RESTRICTed;
  - if the trigger is chosen, clearing `confirmed_at` fails.
- Plus the reader against real rows:
  - none;
  - a DRAFT;
  - a CANCELLED;
  - a CONFIRMED;
  - a REVERSED.
- About 6 cases, each with one PO and up to 2 GR headers. Concurrency 1. Admission needed.

## Traceability alignment (proposed edits, not applied)

- `05_development_tasks.md` P3-T01 says it depends on Checkpoint P2. `08_traceability.json` gives TASK-027 `depends_on: []`.
- **Proposal, edited in place:**
  - P3-T01 gets a sub-item "header early (TASK-027a scope inside TASK-027)", depending on the PO accepted baseline.
  - The rest of P3-T01 keeps the Checkpoint P2 dependency.
  - TASK-025 depends on that header sub-item.
  - In the JSON, TASK-027 depends on TASK-024, and TASK-025 keeps TASK-022 and TASK-023 and gains TASK-027.
- **Kept unchanged:** the IDs, the whole PHASE-004 gate and the UAT obligations.
- The edits go in one docs commit after the PM agrees, with both validators run then.

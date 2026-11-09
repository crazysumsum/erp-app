# TASK-027 early full-header milestone: `goods_receipts` (document proposal only)

**Status:** this is a document proposal. It does not approve a migration source or its execution, adds no public entry, and marks no task DONE.

The TL ruled on the technical points (relayed by the PM on 2026-11-09). This version replaces the earlier draft of this file.

## Why

TASK-025's withdraw and cancel need an authoritative "this PO never had a confirmed GR" fact. It must be read in the same transaction, under the PO root lock (§8.4, H1). Today that fact has no table to come from.

## Scope

**In scope:** the **complete** §4.9 `goods_receipts` header. There is no reduced or temporary table.
- All columns, types and defaults exactly as §4.9 lists them.
- `purchase_order_id` to `purchase_orders` with RESTRICT.
- The composite FK `(purchase_order_id, supplier_id)` to `purchase_orders(id, supplier_id)`, which `uq_purchase_orders_id_supplier` already provides.
- Actor FKs with SET NULL, keeping §4.9's nullability. No new non-null actor rule.
- The UNIQUE keys `gr_number`, `(document_year_month, sequence_no)`, `uq_gr_id_po` and `confirm_event_id`.
- The indexes `idx_gr_list`, `idx_gr_po`, `idx_gr_supplier`, `idx_gr_delivery_note` and `idx_gr_flags`.
- **§4.16 protection for `goods_receipts`**, which the design already requires. After CONFIRMED, these must not change:
  - the PO and Supplier;
  - the business date, delivery note and notes;
  - the confirmation result: `confirmed_at`, `confirmed_by`, `confirm_event_id` and `inventory_result_summary`.
  Only the reversal status and the quantity projection may change. A confirmed header cannot be deleted. That keeps the original event, result and history.
- **CHECKs, following the PO migrations' convention:**
  - `status` in the 5 §4.9 values;
  - flags 0 or 1;
  - `version >= 1`;
  - `gr_number` consistent with `document_year_month` and `sequence_no`;
  - conservation: `total_reversed_base_quantity <= total_received_base_quantity`.

  No new state is added.

**Out of scope, staying in TASK-027:**
- `goods_receipt_lines` (§4.10) and `goods_receipt_details` (§4.11);
- the rest of TASK-027;
- every PHASE-004 gate.

TASK-027 is not DONE with only the header.

## Ever-confirmed fact (TL ruling)

**Ever-confirmed** means the historical fact `confirmed_at IS NOT NULL`, with `confirm_event_id` and `status` consistent with it.

| GR status | `confirmed_at` | `confirm_event_id` | Counts as ever confirmed |
| --- | --- | --- | --- |
| CONFIRMED | not null | not null | yes |
| PARTIALLY_REVERSED | not null | not null | yes |
| REVERSED | not null | not null | yes |
| DRAFT | null | null | no |
| CANCELLED | null | null | no |

**The reader.** It runs after `purchase_orders ... FOR UPDATE`, in the same transaction, using `idx_gr_po`.
- It returns `true` when any row is ever-confirmed.
- It returns `false` only when there are no rows, or every row is consistently never-confirmed.
- Any contradiction, an unknown status, a read error or a missing reader is refused. The lifecycle service maps a non-boolean to `PURCHASING_DEPENDENCY_UNAVAILABLE`, and a thrown error propagates.
- `confirmed_by` becoming NULL through SET NULL is not missing evidence.

**TASK-032** sets the sticky `has_confirmed_receipt` in its own confirm transaction, and a full reversal keeps it.

## Dependencies, edited in place (proposal, not applied)

- Order: the accepted PO schema and backend (TASK-022 to TASK-024 backend) → the **TASK-027 early full-header milestone** → TASK-025 qualification.
- TASK-025 waits only for the header milestone and the wired reader, not for all of TASK-027 or PHASE-004. That avoids a cycle.
- The rest of TASK-027 keeps its Checkpoint P2 dependency, and the PHASE-004 gates and UAT obligations stay.
- IDs are unchanged.

**`05_development_tasks.md`:** P3-T01 gets a sub-item "早期完整 header（TASK-027 早期 milestone）", depending on the accepted PO baseline. P2-T04 (TASK-025) gets the qualification dependency "TASK-027 早期 header milestone 及 ever-confirmed reader".

**`08_traceability.json`:** TASK-025 `depends_on` becomes `["TASK-022", "TASK-023", "TASK-027"]`, with a note that only the early header milestone is needed. TASK-027 `depends_on` becomes `["TASK-024"]`.

Both validators run when the PM agrees and the edit is applied.

## Migration number and schema approval

**Number:** proposed only. It is fixed at the real baseline when the source is written. The global sequence is shared.

**Schema approval rule:** this comes from the user's global instructions, not the repo CLAUDE.md, which has no §8. The file is `/Users/sam/.claude/CLAUDE.md`, "## 8. Schema Changes Need Sign-off", which says:
> "Before creating or altering a table — new table, column, index, constraint, or a drop — explain the change in chat first." … "Only write and run the migration after getting explicit approval."

The repo's `00_module_manifest.json` also lists `server/database/migrations/**` under `approval_required_paths`. This proposal is that explanation; it is not the approval.

## ⑤ Header verification, after the source is approved (not written or run)

Integration tests on a private MySQL, run once with stop at the first failure, at concurrency 1. Data: 1 PO with 1 line plus up to 2 GR headers per case, except G6. No HTTP.

| # | Case | Data | Queries |
| --- | --- | --- | --- |
| G1 | Clean migration and forward from the then-current last migration: every column, type, nullability and default matches §4.9, read from `information_schema.COLUMNS` | none | 2 migrate runs, 1 select |
| G2 | Every UNIQUE, index and FK name and its columns, read from `STATISTICS` and `KEY_COLUMN_USAGE` | none | 2 selects |
| G3 | Composite FK: a supplier mismatch insert fails. RESTRICT: deleting a PO that has a GR fails. | 1 PO, 1 GR | 3 statements |
| G4 | UNIQUE and CHECK: a duplicate `confirm_event_id`, an inconsistent `gr_number`, a bad status, and reversed greater than received each fail | 1 PO, 2 GR | 5 statements |
| G5 | §4.16: after CONFIRMED, updating `confirmed_at`, `confirm_event_id`, PO, Supplier, date, note, notes or the result, or deleting the row, each fail. A reversal status or quantity update succeeds. | 1 PO, 1 GR | 10 statements |
| G6 | Reader: no GR gives false; DRAFT gives false; CANCELLED gives false; CONFIRMED gives true; REVERSED gives true; CONFIRMED with `confirmed_by` set NULL by a user delete gives true | 6 POs, at most 1 GR each | 6 reader calls plus 1 delete |

Admission is needed: about 6 new cases, at a cost not measured.

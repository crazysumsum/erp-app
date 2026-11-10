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
- **CHECKs.** They use the original enum, flags, version, number and conservation rules, and add no new state:
  - `chk_gr_status`: `status IN ('DRAFT','CONFIRMED','PARTIALLY_REVERSED','REVERSED','CANCELLED')`.
  - `chk_gr_flags`: `has_over_receipt IN (0,1) AND has_expiry_override IN (0,1) AND has_sku_exception IN (0,1) AND version >= 1`.
  - `chk_gr_number`: `gr_number = CONCAT('GR-', document_year_month, '-', LPAD(sequence_no, 6, '0'))`.
  - `chk_gr_quantity`: `total_reversed_base_quantity <= total_received_base_quantity`.
  - `chk_gr_confirmation`, the confirmation consistency:
    ```sql
    (status IN ('DRAFT','CANCELLED') AND confirmed_at IS NULL AND confirm_event_id IS NULL)
    OR (status IN ('CONFIRMED','PARTIALLY_REVERSED','REVERSED') AND confirmed_at IS NOT NULL AND confirm_event_id IS NOT NULL)
    ```
    `confirmed_by` is deliberately left out. Its FK is SET NULL, so deleting the user makes it NULL without losing the confirmation, and that is not missing evidence. No actor column becomes non-null.

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

`depends_on` only accepts task IDs, and TASK-027 sits in PHASE-004, which waits for PHASE-003, where TASK-025 lives. A note cannot break that cycle. So the early full header gets its own unused module task ID, **TASK-045**, placed in PHASE-003.
- **Kept unchanged:** every old ID, the rest of TASK-027 in PHASE-004, all PHASE-004 gates and the UAT obligations.
- No harness script changes, and TASK-027 is not marked DONE.

**`08_traceability.json`, exact proposed values:**
- New task:
  ```json
  { "id": "TASK-045", "phase_id": "PHASE-003", "requirement_ids": ["FR-052"], "design_ids": ["DES-005"], "depends_on": ["TASK-011", "TASK-022"], "technical_test_ids": ["TC-004", "TC-009"] }
  ```
  FR-052 is FR-LIFE-005: no withdraw or cancel once any confirmed receipt exists. TASK-011 is the accepted PO schema, and TASK-022 the approval and status-history schema.
- PHASE-003 `task_ids` gains `"TASK-045"`.
- TASK-025 `depends_on` changes from `["TASK-022", "TASK-023"]` to `["TASK-022", "TASK-023", "TASK-045"]`. TASK-025 does not wait for TASK-024's client, TASK-026, all of TASK-027, or PHASE-004.
- TASK-027 `depends_on` changes from `[]` to `["TASK-045"]`. The lines, details and everything else stay in TASK-027.

**`05_development_tasks.md`:** a new block in Phase 2 after P2-T05:

> "Task P2-T06（TASK-045）：TASK-027 早期完整 goods_receipts header"
>
> - Description: the complete §4.9 header with its §4.16 protection.
> - Dependencies: P1-T03 (TASK-011) and P2-T01 (TASK-022).
> - Acceptance: §4.9 and §4.16 hold, plus G1 to G6.

P2-T04 (TASK-025) adds "P2-T06（TASK-045）" to its dependencies. P3-T01 (TASK-027) states "header 已由 TASK-045 交付；本 task 交付 lines／details 及其餘".

**`00_harness_state.json`:** `tasks` would gain `"TASK-045": "PENDING"`. That is data only; the harness tool is not changed.

All of this is applied only when the PM agrees, followed by both validators.

## Migration number and schema approval

**Number:** proposed only. It is fixed at the real baseline when the source is written. The global sequence is shared.

**Schema approval rule:** this comes from the user's global instructions, not the repo CLAUDE.md, which has no §8. The file is `/Users/sam/.claude/CLAUDE.md`, "## 8. Schema Changes Need Sign-off", which says:
> "Before creating or altering a table — new table, column, index, constraint, or a drop — explain the change in chat first." … "Only write and run the migration after getting explicit approval."

The repo's `00_module_manifest.json` also lists `server/database/migrations/**` under `approval_required_paths`. This proposal is that explanation; it is not the approval.

## ⑤ Header verification, after the source is approved (not written or run)

**Common setup:**
- A private MySQL, with a fresh database per run.
- Clean means migrating an empty DB from 0001 to the header migration. Forward means migrating to the migration just before it, then applying only the header migration.
- Fixtures go in through the normal schema, with no constraint, trigger or FK disabled. Contradictory rows are therefore never created. The reader's contradiction branch is covered by a unit test with fake rows, not here.
- Every case starts with one supplier and one user (U, used as the actor), and POs inserted through the existing integration fixture helpers.
- **Cleanup:** drop the database, stop mysqld, delete the datadir, and confirm with `lsof` that the port is free.
- Concurrency 1, stop at the first failure, no HTTP.

**What G5 and G6 cover:**
- **G5** checks the §4.16 trigger, the immutable history.
- **G6** checks the ever-confirmed reader on legal rows.

| # | Case | Fixed rows | Statements |
| --- | --- | --- | --- |
| G1 | The clean and the forward migration each produce columns, types, nullability and defaults equal to §4.9, from `information_schema.COLUMNS` | 0 | 2 migrations, 2 selects |
| G2 | Every UNIQUE, index and FK name and its columns (`STATISTICS`, `KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS`), including RESTRICT and SET NULL | 0 | 3 selects |
| G3 | The composite FK refuses a GR whose supplier differs from its PO's; RESTRICT refuses deleting a PO that has a GR | 1 PO with 1 line, 1 DRAFT GR | 1 good insert, 1 bad insert, 1 delete |
| G4 | Each CHECK refuses its violation: a bad status; a flag of 2; `version` 0; a mismatched `gr_number`; reversed greater than received; CONFIRMED without `confirmed_at`; DRAFT with `confirm_event_id`. A duplicate `confirm_event_id` is refused. | 1 PO, 2 GR | 8 bad inserts, each an expected error |
| G5 | On a CONFIRMED GR, an update of each of these is refused: `purchase_order_id`, `supplier_id`, `business_receipt_date`, `supplier_delivery_note`, `notes`, `confirmed_at`, `confirm_event_id`, `inventory_result_summary`, and a DELETE. A status move to PARTIALLY_REVERSED with a quantity increase succeeds. | 1 PO, 1 CONFIRMED GR | 9 refused, 1 accepted |
| G6 | The reader under `SELECT ... FOR UPDATE` on the PO: no GR gives false; DRAFT false; CANCELLED false; CONFIRMED true; REVERSED true; CONFIRMED whose `confirmed_by` user was deleted (SET NULL) true | 6 POs, at most 1 GR each, 1 extra user | 6 reader calls, 1 user delete |

These are 6 new cases and need admission. The cost has not been measured.

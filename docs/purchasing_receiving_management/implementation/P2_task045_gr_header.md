# TASK-045 `goods_receipts` header migration source (approval package A1)

**Sam's decision, 2026-11-09:** "A、B、C1、C2、C4 全部批准，C3、C5 暫緩". A covers writing this source as A1 describes. Running it, and its functional verification (C5), are **deferred**.

**Where it lives:**
- `server/database/migrations/0119_create_goods_receipts.js`, on its own branch `claude/purchasing-task045`, stacked on `claude/purchasing-task025`. So C4's `npm run migrate` on the TASK-025 branch never applies it.
- The number 0119 is the next free one after `origin/main` `06caf911`. It is rechecked at the real baseline.

**Content, as A1 describes:**
- The complete §4.9 columns.
- The FKs:
  - `fk_gr_po`, RESTRICT;
  - `fk_gr_po_supplier`, composite, RESTRICT;
  - four actor FKs, SET NULL.
- The UNIQUE keys `uq_goods_receipts_number`, `uq_goods_receipts_sequence`, `uq_gr_id_po` and `uq_goods_receipts_confirm_event`.
- The 5 §4.9 indexes.
- The CHECKs `chk_gr_status`, `chk_gr_flags`, `chk_gr_number`, `chk_gr_month`, `chk_gr_sequence`, `chk_gr_quantity` and `chk_gr_confirmation`.
- The §4.16 triggers `trg_goods_receipts_update` and `trg_goods_receipts_delete`, created through the existing `ensureTriggers` helper.

**Left out deliberately:** the §4.9 note "上限64KiB" for `inventory_result_summary` is not a CHECK. A1 did not list it, so the confirm service enforces the limit.

**Not run:** no migration, test, build or validator. eslint could not load in this worktree, which has no `node_modules`, so there is **no lint evidence**.

**Not done yet:** the ever-confirmed reader and its wiring into `PurchaseOrderLifecycleService({ receiptFacts })` are not written. They need C5, or another approval, for their verification.

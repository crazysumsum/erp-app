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

## Immutable-facts completion (TL review relayed by the PM on 2026-11-09)

`GR_CONFIRMED_FACTS` now also freezes, once a header has been historically confirmed:
- `id`;
- `supplier_code_snapshot` and `supplier_name_snapshot`;
- `supplier_status_at_confirm` and `supplier_exception_reason`;
- `created_at`, `created_by` and `created_by_label`;
- `cancelled_at`, `cancelled_by` and `cancel_reason`.

**Kept as it was:**
- the original 12 facts;
- the `OLD.confirmed_at IS NOT NULL` test;
- the block on returning to DRAFT or CANCELLED;
- the DELETE trigger;
- the FK SET NULL exception, because FK actions do not fire triggers.

**Static cross-check**, by reading the source text only, without importing or running it: 33 columns, 23 frozen facts with no duplicates or unknown names, which leaves 10 mutable columns:
- `status`;
- `total_received_base_quantity` and `total_reversed_base_quantity`;
- `has_over_receipt`, `has_expiry_override` and `has_sku_exception`;
- `version`;
- `updated_at`, `updated_by` and `updated_by_label`.

No DDL, import, validator, lint, test or DB was run. The number 0119 is checked at the release baseline.

## Current partial-delivery proposal — 2026-11-10

The dated A1/Not run statements above describe the earlier source-only checkpoint. C5 subsequently completed its separately approved private once batch on 2026-11-10, 14:46:59–14:47:09 HKT: U1–U4 and G1–G6 PASS. Its recorded summary is PASS with unknown=[], cleanupDone=true, preserved=[] and totalMs=9623. This does not turn the old source approval into production deployment or routine-CI authorization.

Evidence: private candidate dc08c30b9a1de4080780bf5c02db47a58e48c54a; C5 source manifest 136b83a375bd50605a57a10602e14e8d35b1d4113912585f27520bdc01156749; evidence manifest 62b60a37ed1f4c9976415efe812c3f9d4096816e5de87bd7a8d61fb75a4cb6ab; summary e4612de9c2bc813a9ccd417d4ba0de86eb3223404df77e8b52b8480077505d27. Artifacts remain under `.worktrees/ci-pm-handoffs/purchasing-c5-task-20261110/`; this document references the evidence and does not claim to publish or rerun it.

The proposed next PR is only the existing 0119 header migration plus this status record and its reviewed CI-input receipt after an actual human decision. The migration blob is 597c6eb4dc1cb5ba2985e2e39025d215c7072563. The private reader is not shipped or wired by this slice. PO lifecycle retains its unavailable receiptFacts composition and inquiry retains its current hidden cancel/withdrawConfirmation actions.

TASK-045/P2-T06 remains incomplete: the formal reader, its same-transaction PO-root-locked composition, applicable functional acceptance and trusted history/deployment prerequisites remain TASK-045 work. They are not silently transferred to TASK-027/032. C5 proves fixture-local behavior, not deployed historical completeness, formal GR/Inventory/Supplier integration or UAT. Neither an empty goods_receipts table nor a future writer alone establishes complete history. The original plan and acceptance criteria remain unchanged; no P2 or downstream gate is declared passed.

The added migration is a computed external input to existing CI migration steps/tests even though this partial slice adds no test registrations. The exact 0119/helper/document versions, unchanged functional workload, publication trigger and cost limits must be included in a verified decision and trusted administrator receipt before push/CI. No new CI grant, push, merge or production execution is recorded here. Production application of 0119 remains separately subject to Sam's explicit approval; its number and target baseline must be checked at that boundary.

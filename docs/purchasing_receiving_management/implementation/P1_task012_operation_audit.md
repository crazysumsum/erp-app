# TASK-012 — Operation Requests, Audit and Initial Immutability

Built on 2026-11-02 from main `3036f761`, merged with `b15edbf7` before verification. Baselines unchanged (design `08a08a3d`, plan `d1c00718`): no manifest edit. `TC-006`, `TC-009`.

| Migration | Contents |
| --- | --- |
| `0114_create_purchasing_operation_requests.js` | `purchasing_operation_requests`, 16 columns, and its two triggers; exports `ensureTriggers` |
| `0115_create_purchasing_audit_logs.js` | `purchasing_audit_logs`, 16 columns, append-only triggers |
| `0116_add_purchasing_immutability_triggers.js` | Triggers on `purchase_orders`, `purchase_order_lines`, `purchasing_document_sequences` |

"Initial" protection covers the tables that exist. Triggers for `purchase_order_status_history`, `purchase_order_approvals`, `goods_receipts` and their children belong with those tables in later tasks.

`ensureTriggers` creates a trigger only when it is missing; an existing one must match its definition, ignoring whitespace and backticks, or the migration stops on drift instead of skipping. Rerunning needs no TRIGGER privilege, which matters on servers with binary logging: there only the migration account (root in CI) can create triggers. This pass ran MySQL with binary logging on and migrated as root, as CI does, and reran the three migrations as the application user.

## HD-014 — schema decisions

Sam approved the proposal on 2026-11-02 ("全部按你的建議執行"), including three additions to design §4.16:

1. **`purchasing_operation_requests` is immutable in identity and outcome**: no DELETE; command, source, event, hash, actor and creation time never change; the result is written once, from incomplete to complete, then frozen. §4.14 calls the table the permanent idempotency core kept for seven years; a changed hash or result would let a retry receive a tampered outcome. Fulfillment protects its operation table the same way.
2. **Lines cannot be added or removed once their PO leaves DRAFT.** §4.16 only forbids editing them; delete-and-reinsert would bypass that. A line also cannot be moved onto a non-DRAFT PO.
3. **Document sequences only move forward and are never deleted.** §4.3 requires committed numbers never be reused; until now only the service enforced it. The update rule is `>=`, not `>`, because §4.3's `INSERT … ON DUPLICATE KEY UPDATE document_type = VALUES(document_type)` performs an unchanged UPDATE on every allocation (mutant T9 confirms).

As §4.15–4.16 specify: audit rows are append-only; after DRAFT a PO's commercial fields (Supplier, Currency, Payment Term, dates, Warehouse, Buyer, reference, notes, amounts, snapshots, number) are frozen while status, progress flags, version, `updated_*` and lifecycle actor/time stay writable, and withdrawing back to DRAFT makes it editable again; a line's commercial fields freeze while posting, reversal and close projections stay writable.

Every column of `purchase_orders` (27 protected, 13 mutable) and `purchase_order_lines` (24, 11) is classified exactly once, asserted against the migrations' own column lists, and the fields §4.16 names are pinned as protected so a reclassification cannot slip through.

CHECKs: operation source type, lowercase RFC 9562 `event_id` (as TASK-010's validator), 64-hex `request_hash`, result present exactly when completed, `result_summary` ≤ 8192 bytes; audit outcome, target type, `detail` ≤ 8192 bytes. Code columns are `ascii_bin`. No column holds a password, token or bank datum.

**A service obligation for the confirm task (TASK-018/TASK-021)**: confirming a PO must write the line snapshots *before* switching the header out of DRAFT, because the line trigger freezes lines as soon as the header leaves DRAFT.

Deleting a user still nulls actor columns on frozen rows: MySQL does not fire triggers for foreign-key actions. This is asserted for operations, audit rows and confirmed POs, not assumed.

## APR-009 — scope

The three migrations (approval-required migration path) and `supplierMigrationAcceptance.integration.test.js` (already approval-required since TASK-011). No manifest change.

## Supplier MIG-006 again

`0116` creates triggers on `purchase_orders` without a `REFERENCES` clause, so TASK-011's dependency detection would have applied it before Supplier existed. Detection now also counts trigger `ON`, `ALTER TABLE`, `INSERT`/`UPDATE`/`DELETE`, `FROM`/`JOIN`, and a quoted string equal to a missing table name (`ensureTriggers(connection, "purchase_orders", …)`). It excludes exactly `0112`, `0113` and `0116`; `0114`/`0115` do not need Supplier and stay in the existing-deployment set.

`0116` is the first migration that depends on Supplier only through another module's table, so **the transitive exclusion TASK-011 could not exercise is exercised now**. Mutant T14 (string-literal detection removed) survived; a follow-up showed why: `0116`'s `FROM purchase_orders` also catches it. Each detection alone excludes `0116`; removing both fails MIG-006 with `ER_NO_SUCH_TABLE`. The string-literal path will matter on its own for a later trigger migration that has no `FROM`.

## Verification

Private MySQL 26.7.0, binary logging on, migrated as root.

- Forward migrate from main's schema; clean migrate of an empty database (108 migrations), rerun applies 0; the three migrations rerun as the application user.
- `purchasingOperationAudit.integration.test.js`: **8/8**, about 0.2 s. Every protected column of both PO tables is changed by a type-generated expression and must be stopped by the trigger, which runs before CHECK and FK checks. A run leaves no data behind. `purchasingMigrations.integration.test.js` still 7/7, on both databases.
- Supplier migration acceptance 5/5.
- **Mutation sweep 13/14 RED**, the survivor explained above: completed outcome not frozen; `request_hash` mutable; operation DELETE allowed; audit UPDATE allowed; `notes` or `supplier_reference` reclassified as mutable; lines addable after DRAFT; a line movable onto a confirmed PO; sequence equality rejected; sequence decrease allowed; PO freeze keyed on the new status; audit `detail` size unchecked; `event_id` case-insensitive.
- **Full routine suite with MySQL**, capacity excluded by CI's skip pattern, CI-equivalent settings: this branch 4,931 tests, 98 failures; unmodified `origin/main` `b15edbf7` on its own fresh database, 98 failures; **0 only on the branch**. 86 are `Fulfillment native tests require their owned disposable runtime`; 12 are the Inventory stocktake failure-audit cases from #311 (`Owned isolated schema or fresh CI database required`), which fail on the fresh main database too.
- Lint exit 0.

## CI admission

Sam approved the case list with the proposal on 2026-11-02: the eight cases in `server/test/integration/purchasingOperationAudit.integration.test.js`; a few rows each inside rolled-back transactions; no concurrency; one repetition; all pass. They run in the existing MySQL jobs on every PR and push to main; about 0.2 s locally; no new job, no capacity. Because the Supplier MIG-006 test's blob changed, TASK-011's receipt stops matching; one receipt again pins every Purchasing test input and supersedes it.

**Digest publication — owner exception, 2026-11-02.** Sam instructed: "我作為project owner 批準你幫我發digest" — a project-owner exception to `AGENTS.md`, for `purchasing-task012.json` only. The variable was read immediately before writing and appended to: the seven existing values were preserved and `3f540062022e627a2a727817fc6533abcab0ae7724b99000d6fa2f4215bd26ec` added, nothing else. The superseded `e40f1bbe…` and `40efa97a…` were left in place; withdrawing them is Sam's call.

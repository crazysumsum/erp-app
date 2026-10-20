# REV-100 — independent review of HD-113 A (migration 0087) and the TC-082/TC-093 carriers

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-tests-6` at `2dccb15c`, reviewed as `git diff 72e205ef..HEAD`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 1 at review time. One High, two Medium and seven Low.

## What the reviewer confirmed

- Three mutations of the migration each make the migration test fail.
- 0081's `inspectSupplierSkuRelationSchema` still accepts the table after 0087.
- The test's control shows that adding `(sku_id)` after the composite index is not enough, and the migration detects that case.
- The 250-foreign-key count in the handoff is correct.
- The HD-113 answer and APPROVAL-HD-113-SCOPE match the code that was reviewed.

## Disposition

The standing instruction is to fix every review finding as recommended. I re-ran each mechanism before changing anything.

| Finding | Disposition |
| --- | --- |
| H-1: step 1 dropped the foreign key and step 2 re-added it in a separate COPY rebuild. A lock-wait timeout between the two steps left the table with no SKU foreign key, so deleting a referenced SKU was accepted, and the rerun then refused because of orphans. The COPY rebuild also blocked writes for the whole copy. | Fixed. I verified on a copy table that the recommended approach works, including after `FLUSH TABLES`: one `ALGORITHM=INPLACE, LOCK=NONE` statement adds `(sku_id)` and drops and re-adds the composite index, and the foreign key stays in place throughout. Orphans are checked before and after, and the index serving the key is checked after. A `(sku_id)` index in the wrong position is dropped in a statement of its own first, because dropping and re-adding it in the same statement left the composite index first (seen in the test). That intermediate state is the 0081 definition, so a rerun completes it. The test checks the following: a fresh run issues one ALTER that never mentions `FOREIGN KEY`; a rerun issues none; after a lock timeout the foreign key is still there. The procedure differs from the wording approved in HD-113 A, so I raised it to the Product Owner as HD-114. |
| M-1: `down` ran three ALTERs; a timeout after `DROP INDEX` lost the foreign key, and every later `down` reported success. | Fixed. `down` is now one `DROP INDEX idx_supplier_sku_refs_sku, ALGORITHM=INPLACE, LOCK=NONE`; the foreign key falls back to the composite index, which is the 0081 behaviour. The test checks that the foreign key is present and is no longer enforced after `down`. |
| M-2: the handoff's procedure does not work for `item_skus`, because a plain `KEY (item_id)` always sorts after the UNIQUE `uq_item_skus_item_variant`. | Verified on a copy of `item_skus`: the orphan was still accepted after the 0087-style reorder, and adding `UNIQUE (item_id, id)` made it refused. Also verified the 0087 procedure on a copy of `item_media`, where it works. The handoff now gives a separate fix for each table. |
| L-1: `inspect` only looked at the two named indexes, so a UNIQUE index starting with `sku_id`, which always sorts first, would defeat the fix silently. | Fixed. The index serving the key is found as the first index whose first column is `sku_id`, and it must be `idx_supplier_sku_refs_sku` after the ALTER; otherwise the migration names the other index and fails. The test covers a UNIQUE index on `(sku_id, id)`. A missing foreign key is refused as an incompatible schema, and the test covers that too. |
| L-2: an orphan inserted between the check and the FK re-add gave a raw error naming a temporary table. | No longer possible: the foreign key is never re-added. An orphan written between the first check and the ALTER is caught by the second check, which fails the migration so the runner does not record it. |
| L-3: with `foreign_key_checks=0`, orphans could be written and later runs took the "already fixed" path. | Fixed. `up` refuses a session with `foreign_key_checks` other than 1. The orphan check runs on every call, including a rerun on a fixed table. The test writes an orphan with checks off and shows both refusals. |
| L-4: in TC-093, the second-key job ends precheck as `ready_with_errors`, so the confirm branch never ran, and the "never creates a Supplier twice" assertions could not fail. | Fixed. The test now asserts `ready_with_errors` and that both rows are `invalid` with `SUPPLIER_CODE_TAKEN`; the precheck is what prevents the duplicate. The title is corrected. The ledger observation that said "after both execute" is corrected by a new observation. |
| L-5: nothing showed the raced requests overlapped. | Fixed for the raced upload: at least one response must be `IDEMPOTENCY_IN_PROGRESS`. It passed 3 of 3 local runs. The same-SKU create race returns the same statuses whether or not the requests overlap, so it has no equivalent signal; that part is unchanged. |
| L-6: gaps in the migration test. | The half-done case no longer exists, because there is one ALTER on a fresh table. A run that stops between the separate `DROP INDEX` and the ALTER leaves the 0081 definition, which the first test starts from. The probe table's name is now fixed before `CREATE TABLE`, so it is always dropped. The dependency on CI having run 0087 on the real table is stated in the test's header. |
| L-7: `next_safe_action` was stale. | Updated in the ledger. |

The reviewer also noticed uncommitted changes appearing in the worktree during the review. They were mine: the HD-057 A similar-name report, written while the review ran. That work is reviewed separately.

## Verification after the fixes

- **Migration test (4 tests):** all pass on erp_t51 (MySQL 26.7.0).
- **Mutations:** six were applied, each with the file restored by `cp` afterwards. Every one failed the tests:
  - removing the serving-index check;
  - removing the separate drop of a misplaced index;
  - removing the `foreign_key_checks` guard;
  - removing the missing-foreign-key guard;
  - removing both orphan checks;
  - making `down` a no-op.
- **Not covered:** the second orphan check alone is not mutated separately. Exercising it needs an orphan written during the ALTER.
- **Concurrency acceptance file (TC-082, TC-093):** passes, 3 runs out of 3.

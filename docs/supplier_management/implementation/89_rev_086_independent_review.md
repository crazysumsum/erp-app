# REV-086 — independent re-review of TASK-038 (the round after REV-085)

- **Reviewer:** `agent-skills:security-auditor`, a separate agent independent of the author.
- **Baseline:** `2a2d1aa20240dfe4223177754ed6fab46eb0fb2f` (PR #201). The scope is the author's commits `93a800a..2a2d1aa` (HD-090).
- **Verdict:** **APPROVED.**
  - No Critical or High findings.
  - Every behavioural REV-085 finding is fixed: H1, H2, M1, L1, L3, L4, L5 A, L6, the Info items, and the `SUPPLIER_SUPPLY_INVALID` code.
  - Each probe fails on the code before the fixes, so the probes discriminate.
  - What remains is tests and docs.

## Findings

### M-1: the tests cover only part of the H1 and H2 fixes, and the docs say otherwise

All 17 tests stay green for each of these mutants:

- **H1, create:** the Item lookup moved back inside the transaction. The test that goes above the pool size only does update rebinds.
- **H1, `recordSupply`:** the same move. No test runs more projections than the pool has connections.
- **H2, duplicate-entry retry removed:**
  - The same event on different Suppliers then gives `SUPPLIER_SKU_RELATION_EXISTS` instead of `IDEMPOTENCY_CONFLICT`, and so does the same source line on different Suppliers.
  - The H2 test sends identical events to one Supplier only, where the Supplier lock serialises them.
- **L3, create:** reporting purchasability before `authorize` (L3 on update is covered).

The code is correct today: the reviewer's probes pass, and they fail on the code before the fixes. But a regression would pass CI.

**Recommendation:**

- Run more `create` calls and more `recordSupply` calls than the pool has connections.
- Race the same event, and the same source line, across different Suppliers.
- Check that a stale actor creating against a non-purchasable SKU gets `PERMISSION_STALE`.

### L-1: other surviving mutants

- **List ordering:** `ORDER BY r.id DESC` survives, because the preferred row is also the newest one.
- **Update `authorize` removed:** survives. The behaviour is right (`PERMISSION_STALE` over HTTP), but it is not tested.
- **Per-field `required` on the update body:** dropping any one field survives, and the schema is the only guard. Over HTTP, each missing field alone does give 400.
- **`eventId` of 65 characters:** survives, and would end as a 500 on the `VARCHAR(64)` column.
- **`SUPPLIER_SUPPLY_INVALID`:** tested for `sourceId` only.
- **Migration rerun:** the collation checks on `supplier_item_code_key` and `payload_hash`, and the type and nullability check, are not tested.
- **Empty code key:** a code key of "" instead of NULL survives; no test makes two relations without a code.
- **`recordSupply` version bump:** survives. The code predates this round.

### L-2: doc inaccuracies

- **Retry count:** "retried up to three times" is wrong. The code makes three attempts, which is two retries.
- **Mutation claims:**
  - "46/46 killed", and "REV-085's mutant kinds are covered": the reviewer's broader sweep left 23 of 69 alive.
  - About 6 to 8 of those are equivalent or near-equivalent; the rest are M-1 and L-1.
- **M2:** "concurrency above the pool size, concurrent projections" overstates what is tested.

## Info

- **Unlogged failures:** command validation errors, and Item lookup errors before the transaction, are not logged as `supplier.sku.supply_failed`. Each still leaves a goods receipt without a projection.
- **Error order:** `create` reports `SUPPLIER_SKU_NOT_PURCHASABLE` before the Supplier's existence and archived checks. This only affects which error comes first.

## What the reviewer verified

- **H1:**
  - No pool use inside any transaction: `assertActorFresh`, the audit and `verifySource` use the transaction's connection.
  - 40 mixed concurrent operations on a pool of 10 run with no errors. On the code before the fix, 39 of 40 failed.
- **H2:**
  - The locking SELECT is the first statement, so the snapshot opens after the lock.
  - A transaction holding the Supplier lock and then committing is seen by the waiting projection.
  - No writer skips the Supplier lock.
  - Cross-Supplier races on the global keys give one success, and the rest `IDEMPOTENCY_CONFLICT`.
  - 60 first projections: 0 deadlocks; before the fix, 42 of 60.
- **M1:** each of the 7 fields missing alone gives 400 over HTTP.
- **Update:** forged claims get `PERMISSION_STALE`, and a foreign relation gets 404 `SUPPLIER_SKU_RELATION_NOT_FOUND`.
- **L1, L4, L5 A and L6** behave as stated. A fresh migrate creates `ascii_bin`, and a rerun refuses wrong collations.
- **Tests:** the T38 files pass 17/17, and the supplier unit and integration files 598/598.

**Not checked:** the full suite and CI, a forced real deadlock, and a real Purchasing verifier.

## Environment and cleanup (reviewer)

- **Data:** only `erp_rev085` was used, and it was returned to its migrated, empty state. The scratch schema was dropped.
- **Files:** every edit was temporary and was restored; `git status` is clean.
- **Processes and MySQL:** no `pkill` was used, no process is left, and no MySQL session is blocked.
- **Elsewhere:** no `.env` file was read, and nothing was done in git or on GitHub.

## Author's follow-up

- **The findings** were taken to the Product Owner as HD-091. The answer: 'A' (fix the tests and docs before the merge, no further review, merge when CI passes).
- **M-1 tests:**
  - More creates and more projections than the pool has connections, on distinct Suppliers.
  - The same event and the same source line sent to four Suppliers: exactly one success, `IDEMPOTENCY_CONFLICT` for the rest, and no relation on the losers.
  - A stale actor creating against an inactive SKU gets `PERMISSION_STALE`.
- **L-1 tests:**
  - A stale actor on update.
  - Each update field removed on its own gives 400, and nothing changes.
  - The list order with the preferred row created first.
  - `SUPPLIER_SUPPLY_INVALID` for a 65-character event ID, `skuId`, `purchaseSkuUomId` and a control character in `supplierItemCode`.
  - Two code-less relations on one Supplier (both keys NULL).
  - The projection's version bump.
  - The rerun refusing a case-insensitive code key, a non-binary payload hash, a wider column and a changed nullability.
- **Info:** an invalid command and a failed Item lookup now also log `supplier.sku.supply_failed` (unit test).
- **L-2:** the retry count (three attempts, two retries), the mutation record and the M2 wording are corrected.
- **Mutation:** all 13 of REV-086's non-equivalent survivors are now killed. The author's full set is 59 of 59.
- **Not changed:** the error order in `create` (Info); it only affects which error comes first.

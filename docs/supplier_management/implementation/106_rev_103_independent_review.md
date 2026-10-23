# REV-103 — independent review of the MIG-003 race carriers and the PR #244 lock test

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-races` at `2e9068e8`, reviewed as `git diff origin/main..HEAD`
- **Verdict:** **APPROVED** with follow-ups.
- **Open Critical / High:** 0 / 0. Two Medium and five Low, plus nits.

## What the reviewer confirmed

- **Lock waits:** performance_schema shows that in every case the waiter waits on the intended unique index.
- **Simultaneous starts:** 100 per constraint; there was never more than one winner.
- **Mutations:** removing each unique key fails its case.
- **Ledger:** the PR #255 record matches `gh pr view 255`, the checks and the runs.
- **Helper extraction:** it does not change behaviour.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: the PR #244 test pinned only the provider's lock mode against a hand-written copy of the Business Master read. Removing `forUpdate` from `BusinessMasterAdminService` kept every test green. | Fixed. The test now drives the real `SupplierAdminService.createSupplier` and the real `BusinessMasterAdminService.changeCurrencyStatus` / `changePaymentTermStatus`. It uses the real impact registry and the real Supplier impact checker, which reads on its own connection as in production. The create is paused just before `INSERT INTO suppliers`, after it has validated the Currency or Payment Term but before the foreign-key check takes its own lock. The deactivation, started with a preview taken when no Supplier used the value, must wait on that row (performance_schema: `currencies` / `payment_terms` PRIMARY). Once the create commits, it must be refused with `IMPACT_CHANGED`, and the value stays ACTIVE. A first version paused the create just before commit. Removing the provider's shared lock then went unnoticed, because the foreign-key check locks the same row. Pausing before the INSERT fixed that. Controls: four mutants, each failing this test: `forUpdate: false` in each admin status change, and no lock in each provider read. The "two creates do not wait" clause is dropped; `customerCatalogLocks` already covers it. |
| M-2: "fails stably" held only for the forced order. On a simultaneous start the loser is sometimes rolled back as a deadlock. | The test now also runs 25 simultaneous starts per constraint. Each must have exactly one winner, and the loser must fail with `ER_DUP_ENTRY` or `ER_LOCK_DEADLOCK`. Typical tally: 0–2 deadlocks in 25. The map Note says so. The product consequence was checked over HTTP. Supplier create with a reused code gave 150 of 150 clean 201/409 pairs. A simultaneous identical identifier on two Suppliers returned 500 once in 150 rounds, and `SHOW ENGINE INNODB STATUS` showed the duplicate-key S lock plus insert-intention deadlock. This is recorded as DEF-031, with decision HD-115. |
| L-1: the helper file is loaded by `node --test`'s default glob. | Kept, as the reviewer allows. `server/test-support/` is outside this module's write scope, and `supplierHttpHarness.js` is the existing precedent. |
| L-2: `blocked` was decided by a 500 ms sleep. | Fixed. The waiter's lock wait is read from `performance_schema.data_lock_waits` and checked against the expected table and index. The result is recorded as a diagnostic, which is the evidence MIG-003 asks for. The file now takes about 1.5 s instead of 9 s. |
| L-3: there was no per-session lock timeout. | Fixed: `innodb_lock_wait_timeout = 5` on every race connection. |
| L-4: the map showed a template literal, and its Note overstated the HTTP coverage. | Fixed. Address and contact are two tests with literal titles, and the Note says what HTTP does and does not cover. |
| L-5: stale comments in `SupplierAdminService` described an X lock on currencies. | Fixed. The comments now say the lock is S since PR #244, and that the three-way cycle REV-023 measured under the X lock has not been re-measured, so the order is kept. |
| Nits | Numeric asserts use `assert.equal`. The Code case's holder is an archived Supplier, so BR-004 ("unique across statuses") is exercised. The Bank reactivate-versus-default race and the `_mig_` prefix are left as they are. |

## Verification after the fixes

- **Race file:** 7/7, three runs in a row, about 1.5 s each; no scratch database left.
- **Mutations:** 10 in total, each failing the intended test:
  - six unique keys replaced by plain indexes;
  - `forUpdate` removed from each of the two admin status changes;
  - the shared lock removed from each of the two provider reads.
- **Migration acceptance file:** 4/4 after the helper move, plus `supplierApproval`; 21 tests in all.

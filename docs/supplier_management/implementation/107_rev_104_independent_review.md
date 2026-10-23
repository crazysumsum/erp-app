# REV-104 — independent review of the DEF-031 fix (HD-115 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def031-deadlock-retry` at `32fdb656`, reviewed as `git diff claude/supplier-task-051-races..HEAD`
- **Verdict:** **APPROVED**, with one Medium for the Product Owner.
- **Open Critical / High:** 0 / 0. One Medium, four Low and nits.

## What the reviewer confirmed

- **Retrying the whole transaction is safe for every wrapped method.** Audit, approval invalidation and name grams roll back with the transaction. The duplicate-name lookup runs once, outside it. The dispatcher keeps one idempotency record per request.
- **The error check matches how errors are wrapped.** `MySqlDatabaseOperationError` carries the driver code in `error.cause.code`.
- **The retry starts clean.** `withTransaction` rolls back and releases the connection before the retry starts.
- **The retry cannot deadlock again** in the two-writer case. It queues behind the winner.
- **The test is deterministic and can fail.** With the retry turned off, all cases return 500.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: `changeSupplierCode` has the same deadlock and still returned 500 (the reviewer reproduced it 4/4 times, both change+change and create+change). | Fixed by the same rule as HD-115 A. It is the same defect, the same Supplier-local fix and no contract change, and the Product Owner is told in the PR. `codeApprovalInvalidated` is reset inside the retried closure. A fourth test case covers it. Control: removing the retry for this operation alone fails that case. |
| L-1: the `lock_deadlocks` counter is server-wide, so an unrelated deadlock could fail the control. | The control now requires three things: the counter rose; `SHOW ENGINE INNODB STATUS`'s latest deadlock is timestamped after the blocker started; and it lists the expected unique index on the expected table. The record dump cannot identify the value, because the lock is a gap lock on the next record. |
| L-2: the comment and the defect note said the winner "has committed" before the retry. | Reworded: the retry either sees the committed row or queues behind it. If the winner rolls back, the retry succeeds. |
| L-3: retried deadlocks left no trace. | Each retry logs `supplier.write.deadlock_retried` with the operation and request ID. The tests assert the log line for each operation. Control: dropping the log fails all four cases. |
| L-4: on failure, in-flight requests were left running while fixtures were removed. | `forcedDeadlock` awaits them in `finally`. |
| Nits | The test asserts `DB_ADMIN_USER` is set. The duplicated `DELETE`s and the pre-existing `let approvalInvalidated` placement are left alone. |

## Found while fixing

The new code-change case failed once in 15 runs. The two requests came from the same user. One request's `authorize` held that user's row inside its transaction, so the other queued on `users`, not on `suppliers`, and the deadlock was never set up. All four cases now send their two requests as two different users, which is also the realistic case. After that: 25 of 25 runs green.

## Verification after the fixes

- **Deadlock file:** 4/4, 25 consecutive runs, no failure.
- **Mutations:** five, each failing the intended case or cases:
  - the retry removed for each of the four operations;
  - the warn log removed.
- **Before the fix:** the reviewer and I both saw 500 on every run.
- **Full Supplier suite:** before these follow-ups, 691/691.

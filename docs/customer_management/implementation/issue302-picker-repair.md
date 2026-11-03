# Issue302 — normal import row picker repair

## Authority / scope

Sam directly approved on2026-11-03:「批准僅修正常下一行查詢，保留既有交易、lease、權限及失敗處理，沿用既有定向功能回歸；不新增常規案例。」
Base main6472fa9f914218198d9ff558d4c33fd1f1723284; dedicated branch
codex/customer-issue302-picker, worktree/private/tmp/erp-customer-issue302.
Only CustomerImportService normal picker changes; no claim/catch/lease/permission,
schema/API/config/CI/test-file changes. Existing DESIGN/PLAN not revised. Prior
state227 is the historical PR244 checkpoint, not this new runtime or publication.

## Reproduction and repair

Actual unmodified processNextRow under MySQL26.7 REPEATABLE READ, real0052/0053
schemas/FKs, two rows(row1applied,row2valid): current PRIMARY prefix scan picks2
but takes X RECORD locks on(1,1) and(1,2). Observer FOR UPDATE NOWAIT on1 rejects
ER_LOCK_NOWAIT. Each row has its own transaction: the next transaction re-locks
the completed prefix; this is not an uncommitted previous transaction.
Original source SHA256cc76b6049f6719332e8c43e0d93b599fe83f6de725fff00e67df8b6e20440e0d;
original raw result SHA256e5f1cab6394064d4dbd49bd185504ccfcba29e254eabd27ac975d71f8bafff0e
in/private/tmp/customer-302-functional.mdg9hT/result-2.json.

The repair discovers each pending status minimum with nonlocking reads of existing
idx_customer_import_row_status, chooses the global lowest row_number, then takes
a current full-PK FOR UPDATE lock on that single pending row. No candidate returns
null; candidate no longer pending throws existing ROW_STATE_CONFLICT before
rowNumber is set, preserving existing catch behavior rather than falsely completing
the job. Job lock/lease validation and actor/permission reads stay in original
order; the first consistent read remains after the job lock. No locking status
range lookup is added(empty-range next-key/supremum risk).

## Actual local functional verification

Fixed source SHA2568d026b10da37f81f7e0b9901cb864dac113f4656a1158845363b14ab2ca06909.
- Existing customerImportService + customerImportWorkerService:24PASS/0FAIL/0SKIP.
- Unchanged real TC060..063 customerImportExecution integration:1PASS/0FAIL/0SKIP;
  actual aggregate/children, commit-unknown reconciliation/no replay and safe result.
- Private two-row actual-product probe:only PRIMARY(1,2) X,REC_NOT_GAP; observer
  acquires completed row1 immediately with NOWAIT. Row2 applied,row1 unchanged.
- Private stale-candidate fence:existing conflict thrown,1transaction/0apply/0writes;
  no false null/exhaustion and no catch/failure-reconciliation entry.
- Private same-two-row checks:earlier warning wins over later valid; writer marks
  row1applied while holding job lock, following execution sees row2warning after
  acquiring the job lock. No status-order or pre-job-lock snapshot regression found.
- Scoped ESLint and git diff --check PASS. No frontend change/browser claim.

Owned MySQL loopback13372/private socket, synthetic fully migrated schema
erp_customer_302_regression. mysql2/dependencies reused read-only from existing
Fulfillment worktree node_modules; no dependency/lockfile edit. Private lock tests
use a native RR wrapper/injected permission/apply fixtures, not production executor
timeout/context or real authorization proof. Existing integration retains its
original permission fixture. Two-row assertions are functional, not load/timing
evidence; no new routine test registrations or workload increase.

Raw logs under/private/tmp/customer-302-fix.9t5B2Q; temporary host retention:
| Evidence | SHA256 |
| --- | --- |
| unit.log | 0ab6b10b8375a0b03486639d13bad09b8ad5497fe93bf002e0327441f0a9f523 |
| integration.log | b8bb969993f208617bb9de87c6f7365707a3ea5254b58686cb24d2287e918678 |
| lock-fixed.json | 49f502525a94aa5b35137e2541e3243e3aa1cc5a76576725a9a4e36c342c2e92 |
| fence.log | 29604fc099cba146783d4fe8d1bc9b1827b4bb33c9fc4644f293c88ce29ceb4d |
| edges-corrected.log | 1fb3dbf304eb0f60ece8787893042f21e55b7557092a581a9f134cfcf2c6f5c0 |

Original diagnosis fixture FK-collation failure and private edge script's unquoted
row_number syntax failure are preserved, corrected locally without product/test
policy changes. Neither was a performance/capacity failure or a relaxed assertion.

## Delivery boundary

Local functional repair, not formal acceptance/merge. Actual separate reviewer
`/root/customer_task011_review` APPROVE on the exact source8d026b10: no Critical/
Required findings; verified lock footprint, fence, status ordering and post-job-lock
snapshot plus existing functional results. This is not CI/merge approval.
Local commit status is reported after actual observation; no push/PR/CI batch
is authorized by this check. Full coverage/current admitted functional CI remain
unrun, not PASS. Project coordination must control a functional-only publication
before normal merge; no bypass, dispatch or new admission receipt is fabricated.
Keep branch/worktree while unpublished and unmerged. All nonfunctional validation
stays deferred until related feature UAT; preserve existing cases/scales/thresholds
and Customer ownership, and require main/related-change/external case grant later.
TASK030/Shipment and complete downstream acceptance remain separately BLOCKED.

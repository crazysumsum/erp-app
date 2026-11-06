# TASK-024 backend: failed run and smallest re-verification

Written on 2026-11-06 for the PM, for independent source review and one decision from Sam. Nothing here has been applied or run. Tests have not run since the failure below.

## The failed run

Code `3a21c6db`, private MySQL, started 14:21:53 HKT, cleaned up 14:22:10. `purchasingApprovalCommands`, `purchasingInquiry`, `purchasingLookups`: 23 cases, 21 passed, 2 failed, 0 skipped. The sweep did not run.

| Failed case | Expected | Actual | Design | Conclusion |
| --- | --- | --- | --- | --- |
| `詳情：待審批回完整快照…` (new case) | snapshot `totalAmount` `2.50` | `2.5000` | §2.8, HD-009: the API always returns the Currency's scale, "不是儲存用的 `376.5000`". §4.7 stores the snapshot. | **A real defect in this PR's code**, proposed fix below. `approvalSnapshot` stores raw amounts, and the new detail route returned them unformatted. |
| `詳情回交易快照…` (existing case) | Detail keys without `approval`, `approvalHistory`, `statusHistory` | Those 3 keys present | §5.6 requires approval history and status history. HD-017 3A said they would return once the tables exist. | The assertion is out of date. **To be confirmed by the reviewer.** |

**A correction:** the author first called both failures test problems, and changed the new case to expect `2.5000` in `3bc753d6`. That was wrong: it made the test match the defect. `42add33a` reverts it.

## Proposed patch

`P2_task024_proposed.patch`, on `42add33a` or later. It applies cleanly (`git apply --check`) and has not been run.

1. **`PurchasingInquiryService.js` (the fix):** `toApprovalSnapshot` formats `subtotalAmount`, `totalAmount` and each `lineAmount` with `storedAmount` when returning. Stored snapshots and their hash do not change, so TASK-022's hash and no migration are affected. `unitPrice` and quantities keep their stored scale, as the PO Lines do.
2. **`purchasingApprovalCommands.integration.test.js`:** the detail case also checks `lineAmount`.
3. **`purchasingInquiry.integration.test.js` (needs Sam's approval):** adds exactly `approval`, `approvalHistory` and `statusHistory` to the key list, and drops them from the message. The list stays an exact allowlist, so a bank or internal field would still fail, and nothing else in the case changes.

**Independent review (the tech lead, relayed by the PM on 2026-11-06):** no Critical, High or Medium findings on this patch. Formatting `subtotalAmount`, `totalAmount` and `lineAmount` in the response is correct, and stored snapshots, hash, `unitPrice` and quantities stay as they are. The exact allowlist addition matches the design. FR-APPROVAL-005 says the assigned approver can view, not that only they can, so `purchasing.view` keeps read access and only the assigned approver decides. No visibility assertion is added.

## Smallest re-verification

**Reuse:** the other 21 PASS results from 14:21. Since then, the only source change is `toApprovalSnapshot`, which runs only when a pending approval is read in detail. In these three files, only the failed `詳情：待審批` case does that. The full CI run still covers all of them before merge.

**Run on a private MySQL, once each, stopping at the first unexpected result:**

| Step | File | Selection |
| --- | --- | --- |
| 1 | `purchasingApprovalCommands.integration.test.js` | `^詳情：待審批` |
| 2 | `purchasingInquiry.integration.test.js` | `^詳情回交易快照` |
| 3 | 10 mutants, one case each, in `purchasingApprovalCommands` | A2, A3, A4 with `^待我審批`; A5, A6, A7 with `^詳情：待審批`; A8, A9, A10 with `^審批人選項`; A11 with `^設定：讀要` |

Each mutant counts as caught only if its named case fails. No extra baseline run: the 14:21 run passed `待我審批`, `審批人選項` and `設定`, and steps 1 and 2 cover the rest. A failure at 14:21 before the fix is also the red evidence for the snapshot format.

Not included: other cases, full coverage, capacity, CI, and any new case. The other 21 PASS results and A1 stand.

### Exact limits

Counted from the fixtures and case code, not measured. A mutant usually stops its case at the first failed assertion, so these are upper limits.

**Data each run creates**

| Case | Runs | Fixed setup | PO data per run | HTTP requests per run |
| --- | --- | --- | --- | --- |
| `詳情：待審批` | 4 (step 1, A5, A6, A7) | A | 1 PO, 1 line, 1 approval | 8 |
| `待我審批` | 3 (A2, A3, A4) | A | 2 POs, 2 lines, 2 approvals | 14 |
| `審批人選項` | 3 (A8, A9, A10) | A | none | 5 |
| `設定：讀要` | 1 (A11) | A | 1 PO, 1 line, 1 settings update | 11 |
| `詳情回交易快照` | 1 (step 2) | B | 3 POs, 4 lines | 0 (13 direct service calls) |

- **Setup A:** 5 users, 5 roles, 10 role permissions, 5 user roles, 1 device, 1 Supplier, 1 item, 1 UOM, 1 SKU, 1 SKU UOM. Over HTTP, on the application's pool.
- **Setup B:** 2 users, 2 roles, 3 role permissions, 2 user roles, 1 currency, 3 Suppliers, 1 item, 1 UOM, 3 SKUs, 3 SKU UOMs, 1 barcode. All in one transaction that rolls back.

**Totals for the batch**

| Item | Limit |
| --- | --- |
| Test process runs | 12, one at a time, each selecting one case |
| HTTP requests | 100 (32 + 42 + 15 + 11) |
| POs that remain until the instance is deleted | 11 (4 + 6 + 1); the 3 in setup B roll back |
| Approvals | 10 |
| Concurrency | 1. These 4 cases do not send requests in parallel |
| Database connections | At most 10 per process (`connectionLimit` in `config/database.js`), 3 for `purchasingInquiry`. The instance is capped at `--max-connections=16` |
| Rate limit | Unchanged, 20 requests per second per IP |

**Time limits**

| Stage | Limit | How it is enforced |
| --- | --- | --- |
| Initialize, start, users and migrate | 60 s from start | Shared absolute deadline. Each process keeps 3 s of its deadline for termination and reaping, and nothing spawns without that time |
| Batch | 120 s from the batch start, and never past 180 s from start | Shared absolute deadline; each case at most 30 s and each process at most 45 s |
| Clean-up | 30 s, ending by 210 s from start | Reaps process groups first, then shutdown, then a kill of this instance's verified PID. Deletion and the final status check run inside this limit. Unknown state or an overrun fails the batch |
| **Whole slot** | **210 s** | Checked at the end; success cannot be reported after it |
| Request and transaction limits | Pinned, unchanged | Request 30 s, acquire 5 s, query 10 s, transaction 20 s |

A limit being reached counts as a stop: clean up, report, and do not retry. Past runs suggest far less: on 2026-11-06 the 14:21 run took 17 s from start to clean-up with 23 cases.

**Other boundaries**

- **Bound at start:** the full commit that applies this patch and both tool hashes. The tools stop if any differs or the tree is dirty. Unchanged since `3a21c6db`: `PurchasingLookupService.js` `3cf96e9bf77b`, `PurchasingSettingsService.js` `42a4c343b5b1`, `purchasingSchemas.js` `ac92bcf4fd6e`.
- **Tools:** `run024.mjs` and `sweep024.mjs` in the session scratchpad, with the hashes given to the PM. The runtime batch is NOT_RUN. The author earlier ran syntax checks and the `--static` mode on an older version; the tech lead classed that as a scope deviation and not as verification. The current version has not been checked or run, and a tool fault in the batch counts as INVALID and stops it. `--static` would refuse A7 until the patch is applied.
- **Instance:** new and private, port 33619, socket `/private/tmp/m023/mysql.sock`, schema `erp_dev`. It starts only if no other `mysqld` is running and ports 3306 and 33619 are free. Every child gets a fixed environment, and the tools refuse a conflicting value or a `server/.env`. After migrating, they check the instance's port, socket, data directory and tables.
- **What counts as caught:** a mutant counts only if exactly its named case failed, as a test code failure, with the expected error on the expected test line, and the system log has no server error. The expected error is an `AssertionError`, except A11, which is a `TypeError` on `after.body.data.history[0]` only. Anything else counts as INVALID.
- **A7 and A11 origin:** a 500 alone proves nothing, so each must also show exactly one logged server error in the application's existing system log: `RESPONSE_VALIDATION_FAILED` for the expected handler, with a `required` detail on `/approval/snapshot` (A7) or `/history/<n>/requirePoApproval` (A11). No request, fixture or case is added. These expectations come from reading the code and have not been observed.
- **A7 mutant changed:** it now removes the `snapshot` field from the response, instead of setting the snapshot to null. A null made the service's `TypeError` reach the log only as a generic `DATABASE_TRANSACTION_FAILED`, because the log omits the cause, so its origin could not be proved. The rule it checks is the same: pending detail must return the snapshot.
- **Stops:** the first failed case, a mutant not caught, an INVALID result, a dirty tree or a passed deadline. All exit non-zero and report attempted and NOT_RUN items.
- **Clean-up:** process groups are reaped before a mutant is restored and before database clean-up. A group not proved gone is a failure needing manual reclaim, and the instance and directory stay. The data directory is deleted only after the instance's own processes are confirmed gone and port 33619 is free. Mutants are restored from the parent's bytes and their hash is checked.
- **Result:** a received signal, an overrun or an interrupted case can never report success. An interrupted case shows as ATTEMPTED, not NOT_RUN.
- **Report:** PID, socket, port, candidate, results and next step.

## After that

Merge main, recalculate the admission list and build the receipt with the patched files. Sam's approval of the digest and of merging on green CI stands, provided the list stays within the approved scope. The patched `purchasingInquiry` file is added to that scope if Sam approves it.

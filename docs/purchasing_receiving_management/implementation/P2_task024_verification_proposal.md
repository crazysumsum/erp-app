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

**For the reviewer:**
- Is the fix at the right layer? The alternative stores formatted amounts in the snapshot, which changes TASK-022's merged code, its hash input and its test (`9007199254740993.0000`).
- Should `approval` carry the whole snapshot for every `purchasing.view` user? The design says the assigned approver can see it (FR-APPROVAL-005) and §5.2 gives detail to `purchasing.view`. PO detail already shows the same prices to those users.

## Smallest re-verification

**Reuse:** the other 21 PASS results from 14:21. Since then, the only source change is `toApprovalSnapshot`, which runs only when a pending approval is read in detail. In these three files, only the failed `詳情：待審批` case does that. The full CI run still covers all of them before merge.

**Run on a private MySQL, once each, stopping at the first unexpected result:**

| Step | File | Selection |
| --- | --- | --- |
| 1 | `purchasingApprovalCommands.integration.test.js` | `^詳情：待審批` |
| 2 | `purchasingInquiry.integration.test.js` | `^詳情回交易快照` |
| 3 | 10 mutants, one case each, in `purchasingApprovalCommands` | A2, A3, A4 with `^待我審批`; A5, A6, A7 with `^詳情：待審批`; A8, A9, A10 with `^審批人選項`; A11 with `^設定：讀要` |

Each mutant counts as caught only if its named case fails. No extra baseline run: the 14:21 run passed `待我審批`, `審批人選項` and `設定`, and steps 1 and 2 cover the rest. A failure at 14:21 before the fix is also the red evidence for the snapshot format.

- **Versions:** the commit that applies this patch. Unchanged since `3a21c6db`: `PurchasingLookupService.js` `3cf96e9bf77b`, `PurchasingSettingsService.js` `42a4c343b5b1`, `purchasingSchemas.js` `ac92bcf4fd6e`.
- **Data:** the small fixtures each case creates, on a new private instance, port 33619, `/private/tmp/m023`.
- **Limit:** about 3 minutes, estimated: 20 s to start and migrate, about 3 s per run.
- **Clean-up:** stop the instance, delete the data directory, and report the PID, socket and port.
- **Not included:** other cases, full coverage, capacity, CI. No new case. The approved 11 mutants stay as they are; A1 already passed.

## After that

Merge main, recalculate the admission list and build the receipt with the patched files. Sam's approval of the digest and of merging on green CI stands, provided the list stays within the approved scope. The patched `purchasingInquiry` file is added to that scope if Sam approves it.

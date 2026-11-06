# TASK-024 preparatory backend

**Status: built, not verified on MySQL, not pushed.** Based on main after #347 (TASK-023).

## HD-022

TASK-024 lists only pages, but they need routes no task delivers. Sam chose A and a on 2026-11-06 ("TASK-024 選 A＋a，全部批准"):

- **A:** a preparatory backend PR delivers items 1 to 6, as HD-019 did. TASK-024's client PR then delivers the pages, the approver choice on submit and the menu entry.
- **a:** the approvers lookup returns one boolean, `requireApproval`. FR-SET-003 lets only `purchasing.settings` see the settings page, but §7.3 needs the form to know which submit to offer. This is a small, recorded exception, and it folds into FR-SET-003 at the requirement's next revision.

The approval covers the plan, not new routine CI cases. Those need their own proposal.

| # | Delivered | Notes |
| --- | --- | --- |
| 1 | `GET /api/v1/purchase-order-approvals/mine` | view and approval. Only the actor's pending approvals, oldest first. `page`, `pageSize`, `q`, `supplierId`. No snapshot, because one can reach 1MiB. |
| 2, 3 | `GET /api/v1/purchasing-lookups/approvers` | `purchasing.mgmt`. Active users holding `purchasing.approval`, without the actor, plus `requireApproval`. |
| 4 | PO detail | `approval` with the full snapshot while pending, `approvalHistory` without snapshots, `statusHistory`. |
| 5 | `allowedActions` | `approve` and `reject` for the assigned approver, never the requester. `withdraw` for the requester with `purchasing.mgmt`. Detail only: the list does not read approvals. |
| 6 | `GET /api/v1/purchasing-settings` | `history`: the latest 50 changes from Audit (FR-SET-007). |

No schema change. `idx_po_approvals_assignee` and `idx_purchasing_audit_action` already cover the new reads. The route lives in `handlers/purchase-orders/` rather than §9's `purchase-order-approvals/`, as HD-016 did for other Purchasing handlers.

## Verification plan

Sam, as project owner, approved on 2026-11-06: "全部批准，我作為project owner 批準你發digest，CI綠了就merge". Scope, as proposed in chat:
- 4 new routine CI cases: 3 in `purchasingApprovalCommands.integration.test.js`, 1 in `purchaseOrderApprovalHandlers.test.js`. Also the added history assertions in the settings case. No new job, no capacity workload, no timing threshold, every PR like other functional tests.
- The 11-mutant sweep below, on a private MySQL in a slot from the PM.
- Publishing this receipt's digest once, and merging once CI is green.

If the sweep requires test changes beyond this scope, they go back to Sam first.

1. **One run on a private MySQL:** `purchasingApprovalCommands`, `purchasingInquiry` and `purchasingLookups`. Stop at the first unexpected failure.
2. **Mutation sweep, if approved:** 11 mutants, in the scratchpad script `sweep024.mjs`, against targeted files only. One needs no database.

| Mutant | Rule it checks |
| --- | --- |
| A1 | My approvals requires the approval policy |
| A2, A3 | The list is limited to the actor and to pending |
| A4 | Oldest first |
| A5, A6 | Only the assigned approver sees approve and reject; only the requester sees withdraw |
| A7 | Pending detail returns the snapshot |
| A8, A9 | Approvers exclude the actor and read `purchasing.approval` |
| A10 | `requireApproval` follows the setting |
| A11 | Settings history excludes failures |

## Stopped run of 2026-11-06 14:21

Code `3a21c6db`, private MySQL. 23 cases: 21 passed, 2 failed, so the sweep did not run. Clean-up finished at 14:22:10. See `P2_task024_verification_proposal.md`.

## Approved batch

Sam approved on 2026-11-06, relayed by the PM: "批准完整修補及本機整批一次". It covers patch `032d52e1`, including the `purchasingInquiry` assertion change, the two failed cases once each, and A2 to A11 once each, with A7 changed from `snapshot: null` to removing `response.snapshot`. Tools: `run024` `a9978fa1`, `sweep024` `21c97d05`. One isolated MySQL preparation, existing migrations, batch and clean-up, within the limits in `P2_task024_verification_proposal.md`. No retry and no CI or push from this approval. The other 21 PASS results and A1 stand.

## Batch result

Run once on 2026-11-06, 17:24:37 to 17:25:10 HKT, 33 s, at code `8b281b96f76f637a5319d57bce051788888510ef`, with `run024` `a9978fa126a1fdddc93f629b39f1d27377c0c799edc1cff11d21435bf8defb12` and `sweep024` `21c97d05c2d46973e0cff30e2c7e4ba46c6ea4c86a2958833e57cbd52f725b71`. Exit 0, no retry.

```text
17:24:37 start
17:24:39 mysqld pid 51770 socket /private/tmp/m023/mysql.sock port 33619
17:24:41 migrated
17:24:44 C1 PASS
17:24:44 C2 PASS
17:24:46 A2 KILLED at line 235
17:24:49 A3 KILLED at line 241
17:24:51 A4 KILLED at line 227
17:24:54 A5 KILLED at line 253
17:24:56 A6 KILLED at line 254
17:24:59 A7 KILLED at line 250
17:25:01 A8 KILLED at line 281
17:25:04 A9 KILLED at line 281
17:25:06 A10 KILLED at line 286
17:25:09 A11 KILLED at line 212
17:25:10 cleanup done: own mysqld gone, socket gone, 33619 free, data directory deleted
STOP REASON: none
RESULT {"C1":"PASS","C2":"PASS","A2":"KILLED","A3":"KILLED","A4":"KILLED","A5":"KILLED","A6":"KILLED","A7":"KILLED","A8":"KILLED","A9":"KILLED","A10":"KILLED","A11":"KILLED"} attempted 12 not_run 0 tree_clean true cleanup_ok true elapsed_s 33
```

- **Sweep:** all 11 mutants killed, including A1 from 14:19 HKT.
- **Origin of A7 and A11 in the system log:** the only two server errors in that window, both `RESPONSE_VALIDATION_FAILED`: `getPurchaseOrder` at `/approval/snapshot`, `getPurchasingSettings` at `/history/1/requirePoApproval`.
- **Limits:** 63 request log entries against 100. PO and approval counts were not measured, and their static limits are 11 and 10.
- **Release:** checked at 17:25:22 HKT: PID 51770 gone, no `mysqld`, ports 3306 and 33619 free, `/private/tmp/m023` gone, tree clean.
- **Not proved:** this ran selected cases only. The other 21 PASS results come from `3a21c6db`, before the snapshot formatting. No full suite and no CI yet.

## Approvals for publishing

Sam's words, in this chat unless stated. Times are HKT on 2026-11-06.

| Time | Words | Applies to |
| --- | --- | --- |
| 14:05 | "TASK-024 選 A＋a，全部批准" | HD-022: this backend PR, then the client PR; `requireApproval` in the approvers lookup |
| 14:19 | "全部批准，我作為project owner 批準你發digest，CI綠了就merge" | The proposal then on the table: 4 new CI cases, the settings history assertions, the sweep, one digest for this receipt, merge on green CI |
| 17:20 (relayed by the PM, call_7553be3498ab45f5bdb21bd4a55b3f1f) | "批准完整修補及本機整批一次" | Patch `032d52e1`, including the `purchasingInquiry` assertion change, and one local batch. The PM's relay states zero CI and push |

The PM read Sam's wording in this chat with its context on 2026-11-06. The PM confirmed that the 14:19 publishing authorization stands, since a local batch without CI does not revoke it, and that the patch is approved. The trusted admission administrator independently checks the final receipt.

## Admission receipt draft

`.github/test-admissions/purchasing-task024-backend.json`, digest `9b21adb71a263d70520cd12b4909e92ad40505463335f2d1ed491eac648dd3b3`, not published. Built from `purchasing-task023.json`: the same 21 paths, with no file added or removed.

| Input | Old blob | New blob | Change | Approved by |
| --- | --- | --- | --- | --- |
| `purchasingApprovalCommands.integration.test.js` | `f226c6d44d60` | `3d9a10255c7c` | 3 new cases, 6 to 9. Added settings history assertions in an existing case. | 14:19, and the added `lineAmount` check in the new detail case at 17:20 |
| `purchaseOrderApprovalHandlers.test.js` | `803954df0fe0` | `c5c135626896` | 1 new case, 5 to 6. | 14:19 |
| `purchasingInquiry.integration.test.js` | `f9f268425d6a` | `7e117ccf9b80` | Existing key-list assertion: adds `approval`, `approvalHistory`, `statusHistory`. No new case. | 17:20 |
| The other 18 | Unchanged | Unchanged | Re-pin only, as in `purchasing-task023.json`. | Existing approvals |

No new job, workflow, fixture file or capacity case. No increase in data, concurrency or repetitions for existing cases.

**Beyond the approvals:** nothing found.

## Paused at Sam's request, 2026-11-06

Relayed by the PM. Wait for Sam to explicitly resume. No digest, push, PR, CI or merge until then, and earlier approvals not yet started do not start on their own.

Not on `origin`: this branch, this record and the receipt draft. In the session scratchpad only: `run024.mjs`, `sweep024.mjs`, `run024-final.log`, `run024-logs/`.

## Only next step on resume

The trusted admission administrator's check of this receipt.

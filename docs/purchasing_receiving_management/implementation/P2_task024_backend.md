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

## Only next step

A PM MySQL slot of about 8 minutes, for step 1 and the 10 database mutants.

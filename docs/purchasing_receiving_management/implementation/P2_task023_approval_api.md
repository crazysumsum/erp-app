# TASK-023 — Settings and approval command APIs

**Status: built and verified on a private MySQL. No mutation sweep, CI or PR yet.** See the handoff below.

Built on 2026-11-05 from main `d18a6951`. No schema change. Design §3.3, §5.2, §5.4, §6.2, §8.3; FR-SET, FR-APPROVAL, SEC-006～009, AC-012～017; `TC-004`, `TC-001`.

| Route | Auth and permission | Result |
| --- | --- | --- |
| `POST /api/v1/purchase-orders/:id/submit` | jwt, `purchasing.mgmt` | Off: `CONFIRMED`. On: needs `assignedApproverId`, gives `PENDING_APPROVAL`. |
| `POST /api/v1/purchase-orders/:id/approval/approve` | jwt-password, view and approval | Assigned approver only; `CONFIRMED`. |
| `POST /api/v1/purchase-orders/:id/approval/reject` | jwt-password, view and approval | Reason required; `DRAFT`. |
| `POST /api/v1/purchase-orders/:id/approval/withdraw` | jwt, `purchasing.mgmt` | Submitter only; `DRAFT`. |
| `GET /api/v1/purchasing-settings` | jwt, `purchasing.settings` | Current value and version. |
| `POST /api/v1/purchasing-settings/update` | jwt-device-password, `purchasing.settings` | Version, reason and replay protection. |

## HD-021

Sam chose option A on 2026-11-06: the settings update uses `jwt-device-password`, as design §3.3, §5.4 and §6.2 say. The setting can turn off PO approval, so changing it needs an approved device, a session and the password. The code and tests already do this. TASK-023's criteria in `05_development_tasks.md` still say `jwt-password` and are corrected at the plan's next revision, so the plan baseline is unchanged now.

## Choices within the design

- **Commands live in `PurchaseOrderService`,** because they share its event claim, strict revalidation and rejected-audit path. `PurchaseApprovalService` keeps the approval record rules.
- **Approve does not rewrite snapshots.** The PO is frozen while pending, so its snapshots stay the ones from submission. Supplier, SKU, UOM and Currency are still revalidated, and a failure rolls back and leaves the approval `PENDING`.
- **Lock order.** The shared lock helper takes PO then Lines, and approve takes the approval row after that, where §2.6 lists approval before Lines. Every command takes the PO row first, so they serialize there and cannot deadlock on this order.
- **Status history is now written** for create, copy, submit, confirm, approve, reject and withdraw.
- **Test cleanup.** History cannot be deleted and holds a FK to the PO, so tests that commit POs now leave them and their masters behind under random tags. Users and roles are still removed.

## Gaps for TASK-024

TASK-024 lists only pages, but its screens need routes no task delivers: `GET /api/v1/purchase-order-approvals/mine` (§5.2), `GET /api/v1/purchasing-lookups/approvers` (§5.5), and approval data in the detail response. `allowedActions` also lacks approve, reject and withdraw. Same kind of gap as HD-019.

## CI admission and sweep decision

Sam, as project owner, approved on 2026-11-06: "全部批准，我作為project owner 批準你發digest，CI綠了就merge". Scope, as proposed in chat:
- A mutation sweep of about 15 mutants on the approval commands, on a private MySQL in a slot from the PM. It runs 18: 6 handler mutants without a database and 12 service mutants.
- 11 new routine CI cases: 6 in `purchasingApprovalCommands.integration.test.js`, 5 in `purchaseOrderApprovalHandlers.test.js`. Also the changed assertion in `purchaseOrderHandlers.test.js` and the changed cleanups in two integration files. No workflow or job change, no timing threshold, every PR like other functional tests.
- Publishing this receipt's digest once, and merging once CI is green. If the sweep requires test changes, new cases go back to Sam first.

**Sweep so far (2026-11-06):** 13 of the planned 18 ran, all within the scope Sam approved. All 13 were killed, but one only by a unit test.
- 6 handler mutants, killed by the handler tests.
- 6 service mutants, killed by `purchasingApprovalCommands.integration.test.js`: approve skips revalidation, no history on decision, no history on submit, anyone can withdraw, self-approval, non-assigned approver.
- Pending PO can be saved: survived the integration file and was killed only by `purchaseOrderStateMachine.test.js`. The integration case's title says the PO is frozen, but no case tries to update a pending PO over HTTP.
- Not run, because Sam's approved scope does not name them: submit without an approver, approver sent with approval off, settings ignoring version, wrong audit action on a decision, decision operation not completed.

Sam approved both follow-ups on 2026-11-06 ("全部批准，兩項都做"): one added assertion in the existing case that updating a pending PO returns `409 PO_STATE_CONFLICT`, with no new case, and running the 5 remaining mutants. 

**Second batch (2026-11-06, private MySQL, code at `11f582fe`):** the baseline passed 6 of 6 with the new assertion, so updating a pending PO over HTTP returns `409 PO_STATE_CONFLICT`.
- Killed by the integration file: submit without an approver, approver sent with approval off, settings ignoring version, pending PO can be saved.
- **Decision operation never completed: survived.** The approve replay in the test still returned 200. With this mutant, a replay reaching the service would get `CONCURRENT_OPERATION`, so the replay appears to be answered by the HTTP idempotency layer. No case checks that a decision completes its row in `purchasing_operation_requests`.
- **Wrong audit action on a decision: not run.** The mutant's search string also matched the create path, so the sweep refused it. This was an error in the sweep script. The approve case asserts its audit action, but no case asserts the audit action for reject or withdraw.

Totals: 17 of 18 mutants ran, 16 killed, 1 survived, 1 not run.

Sam chose option A on 2026-11-06 ("選 A，全部批准"): added assertions in two existing cases, with no new case, that a decision completes its operation row and that reject and withdraw write the right audit action. One added mutant checks the reject and withdraw assertion, so the plan is now 19. The assertions are written and have not run yet.

## Handoff: resumed 2026-11-06

Sam resumed the work, relayed by the PM, who granted the first local MySQL slot of the day.

**Candidate:** local branch `claude/purchasing-task023-approval-api`, worktree `.worktrees/purchasing-task023-approval-api`, based on main `d18a6951`. Not pushed, no PR, no CI run.

**Verified without a database (2026-11-05):** `server/test/purchasing/*.test.js` (67 tests), three convention test files (8 cases), lint, boundary and traceability.

**Verified on a private MySQL (2026-11-06, code at `af1bc272`, 33619, fresh datadir, all migrations):** 28 of 28 passed, 0 skipped, in about 10 seconds, at concurrency 1.
- `purchasingApprovalCommands.integration.test.js`: 6 of 6, the first run of this file.
- `purchasingPurchaseOrderApi.integration.test.js`: 5 of 5.
- `purchasingPurchaseOrders.integration.test.js`: 17 of 17.
- None of the 28 case names match the capacity catalog pattern. The run left 5 approval rows (1 approved, 1 rejected, 3 withdrawn) and 27 status history rows.

**Not verified:**
- The new assertions and the 3 remaining mutants have not run.
- No full suite and no CI. The concurrency case ran once.

**Open dependencies:**
- PM: a MySQL slot of about 3 minutes, for one baseline and 3 mutants.

**Only next step:** the PM's MySQL slot, then run the baseline and the 3 mutants.

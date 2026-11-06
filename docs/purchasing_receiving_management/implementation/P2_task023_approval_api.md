# TASK-023 — Settings and approval command APIs

**Status: not verified on MySQL.** Local MySQL is waiting for the PM's notice. `purchasingApprovalCommands.integration.test.js` and the changed cleanups in the two existing integration files have not run.

Built on 2026-11-05 from main `d18a6951`. No schema change. Design §3.3, §5.2, §5.4, §6.2, §8.3; FR-SET, FR-APPROVAL, SEC-006～009, AC-012～017; `TC-004`, `TC-001`.

| Route | Auth and permission | Result |
| --- | --- | --- |
| `POST /api/v1/purchase-orders/:id/submit` | jwt, `purchasing.mgmt` | Off: `CONFIRMED`. On: needs `assignedApproverId`, gives `PENDING_APPROVAL`. |
| `POST /api/v1/purchase-orders/:id/approval/approve` | jwt-password, view and approval | Assigned approver only; `CONFIRMED`. |
| `POST /api/v1/purchase-orders/:id/approval/reject` | jwt-password, view and approval | Reason required; `DRAFT`. |
| `POST /api/v1/purchase-orders/:id/approval/withdraw` | jwt, `purchasing.mgmt` | Submitter only; `DRAFT`. |
| `GET /api/v1/purchasing-settings` | jwt, `purchasing.settings` | Current value and version. |
| `POST /api/v1/purchasing-settings/update` | jwt-device-password, `purchasing.settings` | Version, reason and replay protection. |

## Choices within the design

- **Commands live in `PurchaseOrderService`,** because they share its event claim, strict revalidation and rejected-audit path. `PurchaseApprovalService` keeps the approval record rules.
- **Approve does not rewrite snapshots.** The PO is frozen while pending, so its snapshots stay the ones from submission. Supplier, SKU, UOM and Currency are still revalidated, and a failure rolls back and leaves the approval `PENDING`.
- **Lock order.** The shared lock helper takes PO then Lines, and approve takes the approval row after that, where §2.6 lists approval before Lines. Every command takes the PO row first, so they serialize there and cannot deadlock on this order.
- **Status history is now written** for create, copy, submit, confirm, approve, reject and withdraw.
- **Test cleanup.** History cannot be deleted and holds a FK to the PO, so tests that commit POs now leave them and their masters behind under random tags. Users and roles are still removed.

## Gaps for TASK-024

TASK-024 lists only pages, but its screens need routes no task delivers: `GET /api/v1/purchase-order-approvals/mine` (§5.2), `GET /api/v1/purchasing-lookups/approvers` (§5.5), and approval data in the detail response. `allowedActions` also lacks approve, reject and withdraw. Same kind of gap as HD-019.

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
- A mutation sweep has not been done, so these cases have not been shown to fail when the code is wrong.
- No full suite and no CI. The concurrency case ran once.

**Open dependencies:**
- HD-021: `jwt-device-password` (recommended, in the code) or `jwt-password` for the settings update.
- A mutation sweep needs its own authorization and a PM MySQL slot.
- Sam: CI admission, after verification. The gate currently lists about 20 inputs, because changing pinned test files invalidated earlier receipts.

**Only next step:** get the HD-021 answer.

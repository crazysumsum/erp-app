# TASK-024 client (P2-T03)

**Status:** source candidate only. It is local, not pushed, and has no new tests. It is stacked on `claude/purchasing-task024-backend` (`968f480d`), so it cannot open a PR until that backend PR merges. HD-022 A: "TASK-024's client PR then delivers the pages, the approver choice on submit and the menu entry."

## Delivered

| Item | Where |
| --- | --- |
| 待我審批 `/purchasing/approvals`: view and approval, server pagination, `q` and supplier ID filters, oldest first, links to detail | `pages/purchasing/MyPurchaseOrderApprovalsPage.vue` |
| Fixed approval snapshot on the PO detail page, plus approve and reject with password re-entry | `components/purchasing/ApprovalSnapshotPanel.vue`, `PurchaseOrderDetailPage.vue` |
| Withdraw a pending approval (requester with `purchasing.mgmt`) | `PurchaseOrderDetailPage.vue` |
| 採購設定 `/purchasing/settings`: current value, change with reason, password and device signature, latest 50 changes | `pages/purchasing/PurchasingSettingsPage.vue` |
| Approver choice on submit when approval is on (§7.3) | `components/purchasing/PurchaseOrderForm.vue` |
| Submit message distinguishes 已提交審批 from 已提交並確認 | `PurchaseOrderEditPage.vue` |
| Service methods | `services/purchasing.js` |

Menu entries are declared in each page's `page.menu` under the existing `purchasingReceiving` group. `client/config/menu.js` and `errorMessages.js` are unchanged: all 21 server Purchasing error codes already have messages.

**Permissions:** on the detail page, approve and reject need `purchasing.approval`, and every other action needs `purchasing.mgmt` (§6.1: the permissions do not inherit from each other). The server still checks both.

**Out of scope:** approval history and status history on the detail page. P2-T05 (TASK-026) delivers those.

## Deviations from the design, for review

1. **The decision form is inline, not a `promptPassword()` dialog (§7.4).** The shared dialog cannot pre-fill a reason. That blocks P2-T03's criterion that the reason is kept after an error. It also caps the reason at 190 characters, while the server allows 500.
   - The panel keeps the reason and clears the password after every error.
   - The password never enters the command intent.
   - While a result is uncertain, only the same action can retry, with the same eventId.
2. **Approval withdraw uses `promptReason()`.** That makes the reason required, 5 to 190 characters. The server would accept no reason.
3. **If the approvers lookup fails, the submit dialog still allows submitting.** It shows a warning, and the server decides. On `PO_APPROVAL_REQUIRED` or `PO_APPROVER_INVALID`, the dialog reads the setting again. Supplier activation already uses this pattern.

## Local checks at this candidate (no database)

- `vite build`: exit 0.
- `eslint` on the changed files: exit 0.
- The six existing Purchasing client test files: 112 passed and 3 failed out of 115. All 3 failures are expected and come from existing tests that pin the old behaviour:
  - `purchasingNavigationErrors` "未完成嘅審批、收貨、設定頁未有入口": TASK-021 pinned "no approval or settings entry yet", and this task adds them.
  - `purchasingPurchaseOrderForm` submit case: its service mock has no `lookupApprovers`, so the dialog correctly shows "未能讀取審批設定" instead of "確認後可收貨".
  - `purchasingPurchaseOrderForm` rejected-submit case: a cascade of the case above. That case's open dialog stays in `document.body`, and this case clicks it.
- **Private check, reverted:** I added `lookupApprovers` to the mock, returning `requireApproval: false`, and the form file passed 29/29. Then I restored the file with `git checkout` and confirmed it was clean.

No browser validation yet. It needs the app, a MySQL slot and Playwright.

## Sam's decision

2026-11-09, in the Purchasing chat: "前端測試提案全部批准，TASK-025 可以開始".

**Approved scope:** items 1 to 7 below, exactly as proposed:
- 6 new cases and 2 changed existing cases;
- jsdom only;
- every PR, in the existing client unit job;
- no new job, no capacity workload, no timing threshold.

This does not cover:
- publishing the receipt's digest, which is for the trusted administrator;
- the Playwright browser pass, which needs a PM slot.

## Test proposal (approved 2026-11-09)

**Business risk:**
- An approver could act on data other than the snapshot.
- A non-assignee could see decision controls.
- A failed decision could lose the typed reason, or resend under a new eventId.
- A settings change could be sent without a device signature.

**Gap:** the existing tests cover none of these pages, and backend tests do not exercise the UI.

| # | File | Change |
| --- | --- | --- |
| 1 | new `client/test/pages/purchasing/purchasingApprovals.test.js` | My approvals: request parameters, rows, link to detail, empty state |
| 2 | same | Detail: the snapshot comes from `approval.snapshot`, not the live PO; buttons follow `allowedActions` plus permission; a mgmt-only user sees withdraw and no decision controls |
| 3 | same | Reject needs a reason; after an error the reason stays and the password clears; an uncertain result retries the same action with the same eventId, and the other action is disabled |
| 4 | same | Settings: sends `version`, `requirePoApproval`, `reason` and `password` through `updateSettings`; keeps the reason after an error; shows history |
| 5 | `purchasingPurchaseOrderForm.test.js` | Mock `lookupApprovers` (2 lines, which fixes the two existing failures), plus 1 new case: with approval on, an approver is required and `assignedApproverId` and `requestNote` are sent |
| 6 | `purchasingNavigationErrors.test.js` | Update the TASK-021 pin: two new menu pages and the new page list |
| 7 | `client/test/services/purchasing.test.js` | 1 new case: paths of the new methods; `updateSettings` is signed |

**Scale and trigger:**
- 6 new cases and 2 changed existing cases.
- jsdom only: no database, no concurrency, no data volume, no timing threshold.
- Runs in the existing client unit job on every PR, like the other Purchasing client tests.

**Cost:**
- Estimated under 2 seconds in total, from the current file's 29 cases running in about 0.55 seconds. This is an estimate, not measured for the new cases.
- No new job, and no effect on the critical path.

**Receipt:** a new receipt for the changed and new test files. Changing `purchasingPurchaseOrderForm.test.js` and `purchasingNavigationErrors.test.js` invalidates any receipt that pins them, so those receipts' other files need re-pinning.

**Alternative:** browser validation only, with no new routine cases. That leaves the snapshot, eventId and permission rules unguarded against regression, so I do not recommend it.

**Browser validation, separate from routine CI:** a Playwright pass of the real app on a private MySQL, needing a PM slot. It covers:
- approval on: submit with an approver, approve, and reject with a reason;
- withdraw;
- settings change from a registered device;
- console and network checks.

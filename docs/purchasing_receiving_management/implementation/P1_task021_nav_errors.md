# TASK-021 — PO menu entry and public error messages

Built on 2026-11-05 from main `52d2af5b`. No schema change, manifest edit or new dependency; baselines unchanged (design `bedf5d1b`, plan `7cca891a`). Design §5.7, §7.1, §9.1; FR-LIST, SEC-001～005, AC-048～049.

`client/config/menu.js` gains the `purchasingReceiving` group, and `PurchaseOrdersPage` is its only entry. The group appears only with `purchasing.view`. Approval, Receiving, Outstanding and Settings have no pages yet, so they have no entries. `errorMessages.js` has a Traditional Chinese message with a next step for every code in `PURCHASING_ERROR_STATUS`; a test reads that server table, so a code added later fails until it has a message.

## Differences from the design

- **Group order 350 and icon `shopping_cart`.** §7.1 gives order 300 and `local_shipping`, which are what the Suppliers group now uses. These values place the group after Suppliers with its own icon. To be folded into the design at its next revision.

## Shared messages changed

`HttpClient` prefers this table over the server's message, and the table is keyed by code across all modules. Two existing entries therefore gave Purchasing users the wrong instruction:

- `CONCURRENT_OPERATION` said 「同一庫存正在處理其他操作」, but Purchasing and Sales also raise it. It now says 「資料正被其他操作更新，請重新整理後再試」.
- `UOM_CONVERSION_INVALID` told users to contact an administrator about SKU data. Purchasing raises it when a quantity does not convert to a whole Base quantity, which the user can fix. It now says 「單位換算不正確，請檢查數量及單位；仍有問題請聯絡管理員核對」.

No test or page depends on the old wording.

## Harness record correction

`validate_module_boundary.py` stopped on `UNSAFE_PATH` for any approval-required path, because it treats every `scope` entry as a path and a colon is not allowed in one. Colons in the prose notes of SCOPE approvals were changed to semicolons. Nothing else in those records changed.

## Browser validation

5 private Playwright scenarios passed against the real API and MySQL in Chromium: a `purchasing.view` user sees the group with one entry, reaches the list and is sent to 403 on create; a user without it sees no group and is sent to 403 on the list; the 375px menu opens and reaches the list; a refused submit, a list validation error, a missing PO and a changed master conversion show the new messages. The real API returned `UOM_CONVERSION_INVALID` for a quantity of 1.5 on a factor of 1. No unexpected console errors.

## Tests

`client/test/pages/purchasing/purchasingNavigationErrors.test.js`, using the real discovered pages, `buildMenu`, `validatePages` and `HttpClient`. Mutation sweep of 12 mutants: all RED. The client suite is 1223 tests, passing; build and lint pass.

## APR-010 — shared files

Sam approved on 2026-11-05: 「全部批准，我作為project owner 批準你發digest，CI綠了就merge」, answering the proposal to add the `purchasingReceiving` group to `client/config/menu.js`, add the Purchasing messages to `client/src/framework/http/errorMessages.js`, and change the shared `CONCURRENT_OPERATION` and `UOM_CONVERSION_INVALID` wording as above.

## CI admission

The same decision covers 1 new client test file (8 case definitions running 10 times), the unchanged re-pin of the TASK-019 and TASK-020 cases and pins that the list page change invalidated, and a support pin for `menu.js`, on every PR and main push in the existing client job, in `.github/test-admissions/purchasing-task021.json`. He also authorized publishing this receipt's digest once, as project owner.

# TASK-019 — PO list and detail pages

Built on 2026-11-05 from main `d65051a3`. No schema change, manifest edit or new dependency; baselines unchanged (design `bedf5d1b`, plan `7cca891a`). Design §7.1, §7.2, §7.4, §7.9; FR-LIST-001～007, FR-LIST-009, FR-LIST-010, AC-048, AC-051; `TC-003`. The task text cites `FR-PO-021～024`, which do not exist (see TASK-016).

`PurchaseOrdersPage` is the list at `/purchasing/purchase-orders` and `PurchaseOrderDetailPage` is the detail at `/purchasing/purchase-orders/:id`, both requiring `purchasing.view`. `PurchaseOrderProgress` shows received against ordered with BigInt division, because Base quantities can exceed 2^53.

## Choices within the design

- **Supplier and Buyer filters use the Sales pattern:** pick from the current page or type a positive ID. The purchasing lookups require `purchasing.mgmt` (HD-019), and these pages only require `purchasing.view`. Supplier names are found through `q`.
- **Fewer list columns at 1440px.** With the 300px drawer open, separate Currency and Outstanding columns pushed Status and Updated At under the sticky actions column. Status now comes second, the total shows `HKD 35.00`, and Outstanding sits under the progress bar. All design fields are still shown.
- **Line Base quantities are stacked in one cell,** as in Sales, so they are visible at 1024px without horizontal scrolling.
- **Copy is on the detail page only.** The list offers View and, on a Draft, Edit. Copy asks first because it uses a PO number that is never reused. An unknown outcome keeps the same `eventId` and offers a retry. Warnings use `notifyWarning`, which stays until dismissed and survives moving to the new PO.
- **Submit stays in the form.** §7.3 puts the submit summary there, and TASK-024 adds Approver selection to it. The detail page links to edit.
- **The route ID is checked before calling the API.** vue-router decodes params, so `..%2Fusers` would otherwise reach another route.

## Waiting on later tasks

- **TASK-020:** the `/new` and `/:id/edit` pages. Until then the create and edit links have no page, and `/new` shows「找不到此採購單」.
- **TASK-021:** the menu entry, so users cannot reach these pages from the menu yet, and clearer public messages for list validation errors.
- **TASK-022, TASK-026, TASK-027:** approval, status history, Goods Receipt and Audit sections, the detail risk summary including overdue, and lifecycle actions. HD-017 3A keeps these out until their data exists, so "not built" does not read as "no data".
- **TASK-039:** CSV export.

## Known limits

- **Narrow screens.** Below 1024px the tables scroll inside their own frame, with the actions column pinned; §7.9 asks for cards or an accordion. The Sales list and detail pages work the same way, and this task's criteria cover 1024 and 1440px. The page itself does not scroll sideways at 375, 768, 1024 or 1440px.
- **At 1024px with the drawer open,** the list scrolls inside its frame. Status stays in view.

## Browser validation

14 private Playwright scenarios passed against the real API and MySQL, with a Chromium browser at 1440, 1024, 768 and 375px: layout and page-level overflow; Viewer and Mgmt actions, including a server 403 on a direct Viewer copy; search, filters, sort and page in the URL through refresh and back; invalid currency and reversed dates; risk text and progress; snapshot beside changed master data; notes as text; invalid, missing and failing IDs with retry; `aria-busy` and retry on the list; copy with cancel, keyboard, warnings and one new PO; a lost copy response retried with the same `eventId`, creating one PO. No unexpected console errors or failed requests. Overdue was covered by the page test only, because triggers block setting a past date after submit and the API refuses one on create.

## Tests

`client/test/pages/purchasing/purchasingPurchaseOrderPages.test.js`, mocked services, real `useCommandEvent`. Mutation sweep of 44 mutants: 3 survived the first pass; 2 became RED with added cases. The third, the `page > 0` guard, is equivalent because QTable already clamps the page.

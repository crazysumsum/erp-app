# TASK-020 — PO create, edit and print pages

Built on 2026-11-05 from main `64dc0904`. No schema change, manifest edit or new dependency; baselines unchanged (design `bedf5d1b`, plan `7cca891a`). Design §7.1, §7.3, §7.8, §7.9; FR-REPORT-006, FR-REPORT-007, AC-051; `TC-010`.

`PurchaseOrderCreatePage` and `PurchaseOrderEditPage` put the TASK-018 form on real routes. `PurchaseOrderPrintPage` is the browser A4 print. `usePurchaseOrder` holds the read logic that the detail, edit and print pages share, including the route ID check.

## Choices within the design

- **Create and edit require `purchasing.view` and `purchasing.mgmt`.** §7.1 lists only `mgmt`, but both pages read the PO through a `view` route, so a `mgmt`-only user would reach a page that cannot load. Sales does the same.
- **Saving keeps the form mounted.** The edit page re-reads without the skeleton, so focus stays where it was. If that read fails, the form is replaced by an error with retry, because the old version would only produce a conflict.
- **Create replaces its history entry,** so Back does not return to an empty form after saving.
- **Save warnings use `notifyWarning`,** which stays until dismissed and survives the move to the edit page.
- **Print statuses are decided by the page.** Confirmed, Partially Received, Fully Received and Closed print as formal documents; Draft prints with a watermark on every page; Pending Approval and Cancelled do not print. `allowedActions` has no `print` value, and the data is already readable with `purchasing.view`.
- **The PO number is in the repeating table header,** so every printed page identifies its PO.

## Defect found in the browser

With the drawer open at 1024px, the form scrolled sideways because the line editor chose its layout from the viewport, while only 724px of content was available. The grid now uses a container query on the content width, and the add button no longer has a fixed narrow column. TASK-018's validation did not test 1024px with the drawer open.

## Formal browser tests

TASK-018's record and receipt said formal e2e would come with this task. The approved plan does not ask for it, and Sales' browser specs are not in routine CI either. This task uses private browser validation, per Sam's decision below. A committed browser suite belongs to the TEST_AND_VERIFY stage, where `TC-010` also requires Edge and Safari.

## Waiting on later tasks

- **TASK-021:** the menu entry and a client message for `PO_MASTER_CHANGED`. Submit refusals show the server's public message until then.
- **TASK-024:** Approver selection.
- **TASK-033:** operation lookup by `eventId`.

## Browser validation

10 private Playwright scenarios passed against the real API and MySQL in Chromium. From the list at 1440, 1024, 768 and 375px: create, save, edit, submit and print, with no page-level sideways scrolling. Also dirty leave; version conflict and reload; a lost create response retried with the same `eventId`, creating one PO; save warnings and a refused submit; Viewer redirected to 403 on create and edit but able to print; non-Draft edit; invalid IDs making no API call.

Print output was generated as PDF and inspected. It is A4 (595×842pt). A 100-line PO fills 5 pages with the header repeated and no line cut. The Draft watermark appears on the pages checked. The app header and drawer are hidden. A Supplier renamed after confirmation does not change the printed snapshot. No unexpected console errors or failed requests.

## Tests

Two new files in `client/test/pages/purchasing/`, plus 2 new case definitions in the TASK-019 file. Services are mocked; the edit page uses the real form. Mutation sweep of 47 mutants: 1 survived, and it is RED after adding a case. The client suite is 1213 tests, passing; build and lint pass.

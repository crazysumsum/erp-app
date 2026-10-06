# TASK-024 / TASK-025 — Manual Draft editor and line entry

Status: implemented; actual browser developer regression8/8 PASS; independent R2 UI correction review approved.

Protected Create/Edit pages use the reusable SalesOrderForm, line editor and exact BigInt quantity/amount preview. Bounded current master selection, defaults, six/four-place validation, duplicate SKU/UOM focus,100-line ceiling, barcode lookup, zero-price warning and cross-currency price clearing follow the approved P1 behavior. Saved totals remain server facts. Stale errors retain user input and require explicit reload; uncertain outcomes keep one immutable event/payload and prevent editing until replay resolves. Form errors preserve indexed field context. The summary and Save remain sticky on mobile.

Actual dirty-navigation regression exposed cached dirty state after refusing navigation: both existing Quotation and new Order forms used a non-reactive pristine snapshot. Two added tests failed against that implementation; ref snapshots corrected both real callers. Related tests23 PASS. Browser now confirms dismissed departure followed by successful Save reaches persisted detail. Historical actual diagnostics (POST201 plus an incorrect second departure prompt) are retained privately.

Current focused client checks57 PASS, lint/build PASS; real eight-case Playwright suite8 PASS, no API mocks, no unexpected relevant console/network failures. Current browser sourcebb7b999852b9a2602160a15c09e06520d55fcc7ac4e804c9000ea816f55c0ab9, log task027-browser-r3.log. No formal Technical Acceptance or business UAT is claimed. Complete final review/whole-workspace/typed Phase checks before Task DONE/merge.

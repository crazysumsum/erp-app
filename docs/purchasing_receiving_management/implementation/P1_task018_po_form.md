# TASK-018 — PO client service and form

Built on 2026-11-04 on top of the HD-019 lookups. No schema change, manifest edit or new dependency; baselines unchanged (design `bedf5d1b`, plan `7cca891a`). Design §2.3, §7.3, §7.7, §7.9, §10.4, §11.5; AC-005–010; `TC-003`.

`client/src/services/purchasing.js` covers the PO routes and lookups. `useCommandEvent` keeps one command's payload and `eventId` while the outcome is unknown, and clears them once the outcome is known. `PurchaseOrderForm` and `PurchaseOrderLineEditor` have no page yet; TASK-020 adds it and passes `document` and `actor`.

## Choices within the design

- **One DOM for grid and cards.** CSS grid gives a single-column card below 1024px and one row at 1024px and above, so there is no second markup to keep in step and no page-level horizontal scroll.
- **Supplier defaults respect edits.** A Currency or Payment Term the user changed is not overwritten. A saved Draft's values count as chosen. The ordering address always follows the Supplier, because the service only accepts that Supplier's primary address.
- **Prices stay when the Currency changes.** Sales clears them because it suggests a price; a PO price is typed, so the form keeps it and warns that it is not converted.
- **An existing line's UOM is read-only.** Changing it means deleting the line and adding it again, because the detail response has no UOM list for that SKU.
- **Preview uses the server's algorithm.** Test cases run the same inputs through the client helper and the real server `moneyMath` and `quantityMath`.

## Waiting on later tasks

- **TASK-020:** the page, the real route, showing save `warnings`, and formal e2e.
- **TASK-021:** a client message for `PO_MASTER_CHANGED`; until then the form shows the server's public message.
- **TASK-024:** Approver selection when approval is on. The form always shows「確認後可收貨」until then.
- **TASK-033:** operation lookup by `eventId`. Until then an unknown outcome retries the same `eventId` and relies on server replay, and the pending intent lives in memory only, so a refresh loses it. `beforeunload` warns first.

## Browser validation

11 private Playwright scenarios passed against the real API and MySQL on a temporary uncommitted route, at 1440, 768 and 375px: create, save and submit; Supplier defaults; barcode; keyboard-only add, reorder and delete; preview against server totals, including half-up and JPY; a lost response retried with the same `eventId` creating one PO; version conflict with copy and reload; dirty leave and `beforeunload`; validation; failed option loads with retry. No unexpected console errors or failed requests.

`AppShell` opens its drawer on load below 1024px, and its backdrop covers the page until dismissed. This affects every page and is not part of this task.

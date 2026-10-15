# REV-095 — independent review of the HD-107 client (G4 list filters, G5 paged contacts and addresses)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-hd107-client`, reviewed as `git diff 98541154..2ec036ee -- client`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium, three Low, one Info.

The reviewer checked the client against the server contract and in a real browser. Their own Playwright probe ran eight scenarios against the Vite dev server, with the API mocked. They also ran six mutations, each restored afterwards.

They confirmed the following:

- Every parameter name and type matches `SUPPLIER_LIST_QUERY_SCHEMA`.
- Empty and `false` filters are not sent.
- Day bounds are Hong Kong time. The list test pins `TZ=UTC`, so a local-time mutation is caught.
- The newest response wins over a slower earlier one.
- "Load more" removes duplicates and stops at the total. A double click sends one request.
- The new controls are labelled and reachable by keyboard.

## Disposition

The Product Owner said to fix everything as recommended ('review 完 CI 過就 merge', under the standing 'review 完全部按建議修').

| Finding | Disposition |
| --- | --- |
| M-1: changing a filter on page 3 or later kept the page number, so the first rows of the new result were skipped | Fixed. `DataTable.reload({ firstPage: true })` is opt-in, and existing callers behave as before. The Supplier filter watch uses it. Tests: a DataTable test, a list test starting at `?page=3`, and a browser test. Negative controls: either half reverted fails. |
| M-2: without `business_master.view`, currency or payment term in the URL still narrowed the list and the export, with no control to see or clear them | Fixed. Both are read from the URL only with `business_master.view`. A list test covers a viewer opening `?currencyCode=USD&paymentTermId=3`. Negative control: the ungated version fails. |
| L-1: dates of the right shape that are not real days (`2026-13-01`, `2026-02-31`, `0000-01-01`) and `paymentTermId=3.5` reached the server | Fixed. A date must survive a round trip and fall on or after 1970-01-02, because 1970-01-01 in Hong Kong begins before epoch 0. The payment term must be a whole number. Tests cover each case and a real leap day. Negative controls: both checks reverted fail. |
| L-2: rows loaded with "載入更多" were lost on a tab switch | Fixed. Only the address and contact panels are kept alive (`keep-alive-include="addresses,contacts"`); the other panels remount as before. A reload, or a change of Supplier, still shows the skeleton and starts again. A browser test switches to 概覽 and back without a second request. Negative control: it fails without keep-alive. All 47 Supplier browser tests pass. |
| L-3: the reset in `useMoreChildRows` was untested, and a page in flight during a reset was still appended | Fixed with a generation counter. A test replaces the detail rows, then resolves a page that was in flight before the reset. Negative controls: removing the counter fails the test, and so does removing the reset. |
| I-1: master lists are capped at 100; an unknown `paymentTermId` shows its raw id; inactive masters have no marker; a reversed date range still sends the request; there is no "payment term not set" option | Not changed. Each is noted here as a known limit. |

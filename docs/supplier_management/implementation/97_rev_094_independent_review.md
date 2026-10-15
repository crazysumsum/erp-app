# REV-094 — independent review of HD-107 server side (PR #235)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline commit:** PR #235 head `86acdc08`, reviewed as `git diff e56ad1a9...86acdc08`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Three Medium, five Low.

The reviewer found no injection or parameter-order problem and confirmed the detail refactor preserves behaviour. Identifier search and the `missingBank` filter reveal nothing to `supplier.view` beyond what detail and the masked Bank list already show. The contact invariant holds on every write path today. Every number in the performance report matched the evidence files except those listed under M-3.

## Disposition

The Product Owner said to fix everything as recommended ('review 完全部按建議修').

| Finding | Disposition |
| --- | --- |
| M-1: a search made only of separators (`-`) became `%%` and matched every identifier, so 97,043 Suppliers on 100k | Fixed: the separator-free pattern is used only when it is not empty. TC-009 now proves that `-`, ` - ` and `--` do not return a Supplier with no dash anywhere. Negative control: with the old pattern, TC-009 fails. |
| M-2: TC-008, 009, 010 and 012 left clauses unasserted | Fixed in the tests. TC-008 seeds 125 rows and uses page sizes 1, 20 and 100. TC-010 adds a payment-term filter and a primary contact for another purpose: removing `purpose_code = 'orders'` from the filter now fails TC-010. TC-012 adds a backslash and Chinese text. |
| M-3: the report's `forSku.*` row understated the difference; two timings had no evidence | Fixed. `forSku.typical` is listed separately (72 against 24 ms) and the others as 12–34% higher. The 724→124 ms and 47→91 ms figures are marked as one-off hand timings, with the reviewer's own figures beside them. The code comment no longer quotes a number. |
| L-1: a huge `page` gave a MySQL error (500) on the list and the new child lists | Fixed: `page` is capped at 1,000,000, as the SKU picker already is. Tests send a 21-digit page and expect 400. |
| L-2: detail judged missing contact and address from its first 100 rows only | Fixed: when either page is full, detail asks the database, so it agrees with the filters. TC-048 puts the primary contact and the ordering address at row 105. Negative control: without this, TC-048 fails. |
| L-3: nothing in a real database checked the invariant the missing-contact filter relies on | Fixed: a test creates a primary orders contact through `SupplierContactService`, deactivates it through the service, and checks the filter. |
| L-4: export (`supplier.mgmt` only) could learn which Suppliers have a Bank account through `missingBank` | Fixed: export refuses `missingBank` without `supplier.view` (403 `SUPPLIER_EXPORT_FILTER_FORBIDDEN`). Other filters stay open. The BR-028 comment is corrected. Negative control: without the check, the test fails. |
| L-5: the HD-108 A comparison rests on one non-alternating pair at the 128 MiB pool | Stated in the report, with the size of the gap against the run-to-run spread. |
| Info: TC-048 checked only the error code for an unknown Supplier | The test now also checks status 404. |

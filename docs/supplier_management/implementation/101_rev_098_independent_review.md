# REV-098 — independent review of the audit and detail carriers

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-tests-5`, reviewed as `git diff 97c443f0..HEAD -- server client docs/supplier_management`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 1. One Medium, three Low, one Info and one nit.

## What the reviewer confirmed

- **TC-106 to TC-110:** these five meet the bar. TC-014 meets it once its Notes are extended.
- **Route coverage:** every registered Supplier POST route is exercised except `duplicates/check`, which only reads.
- **requestId:** it is really checked.
- **Harness cleanup:** it is ordered correctly. A test failing midway leaves nothing behind.
- **Under load:** the suite is stable under `taskpolicy -b` with coverage.
- **Hong Kong time test:** it can tell a wrong time zone apart.
- **The new alert:** it reaches the real system log through the production wiring. The reviewer showed this over real HTTP.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| F-1 (High): TC-103 failed about 1 run in 10, because Bank B's number equalled Bank A's whenever `Date.now()` ended in 7. | Fixed. Bank B now uses A's number with the last digit incremented, so the two always differ. |
| F-2 (Medium): TC-103 did not check target, Code or before/after, and its target check could never fail. | Fixed. Every row is now asserted against its expected `[target_type, target_id, target_label]`: the Supplier code for Supplier-level actions, the child's own label for children, the bank name for Bank, the SKU code for relations, `import-<id>` for imports. before/after is asserted for update, code change, Bank update and default (masked last four only) and reassign. This found a defect: `approval.reassign` wrote an empty target label. It now writes the Supplier code, like the other approval actions. Controls: each of the reviewer's mutations fails TC-103 (address audited as a Supplier, a wrong code label, swapped code before/after), and so does an empty reassign label. The map now notes that the IP check accepts any loopback form, that rows written while an import executes are not exercised, and that child updates record only purpose changes. |
| F-3 (Low): TC-014 checked the payment term only as null. | Fixed. Every seeded Supplier now has a real payment term, and the detail must return its id. Control: a projection that always returns null fails. The Note now says the client's not-purchasable hint is checked only for the suspended status. |
| F-4 (Low): TC-106 checked the alert only through a fake logger. | Fixed. It uses the app's own system logger and reads the event from the system log file. Control: dropping the log call fails it. |
| F-5 (Low): the list of actions was typed by hand. | Fixed. The test collects every `action:` string under `server/src/modules/supplier`. Each must be exercised, apart from two named exclusions (`import.expire`, `supplier_sku.supply`). |
| F-6 (Info): a valid update of long multi-byte notes fails with a 500. The `supplier.update` audit stores full before and after snapshots, which go over 8192 bytes, and plain values cannot be summarised. | Raised with the Product Owner as **HD-112**, together with a related finding: child updates record no before/after values. Not changed in this PR. |
| Nit: the alert call lacked `void`. | Fixed. |

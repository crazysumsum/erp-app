# REV-121 — independent review of the DEF-044 fix (HD-139 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def044-invalidation-notice` at `eab51ccc`, reviewed as `git diff origin/main..HEAD` (base `44d7f836`)
- **Verdict:** **APPROVED**
- **Open Critical / High / Medium:** 0 / 0 / 0. Two Low, three Info.

## What the reviewer confirmed

- **Write paths:** every UI write that can change an approval-significant field while the Supplier is Pending now warns first and reads the server flag afterwards. That covers the general update, the Code change, and identifier create, update and delete. Address, contact, bank and SKU panels correctly show no warning.
- **Wording:** the text matches UAT-014 exactly.
- **Negative control:** with main's components swapped in, exactly the 3 new positive tests fail.
- **Mutants:** 13 were run; 11 were killed.
- **Real backend:** UAT-014 passes. The reviewer's own scratch check of identifier edit passes.
- **Accessibility:** the warning banners render with `role="alert"`.
- **Ledger and register:** the claims match the code, apart from the wording that L-1 corrects.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| L-1: the identifier test's title says "edit and delete", but it ran create and delete. M1 (edit notice dropped) and M2 (edit warning hidden) survived. | The test now covers create, edit and delete, each with its warning and exact notice, and has been renamed to match. M1 and M2 now fail the test. |
| L-2: the invalidation notice was a green success toast that disappears after 5 s. | New `notifyWarning` in `framework/ui/notify.js`: a yellow notice with `timeout: 0` and a 關閉 action. `notifySaved` in `approvalInvalidation.js` uses it when `approvalInvalidated` is true. Pinned in `notify.test.js` and the page tests. In the browser the notice is still visible after 6 s and closes on 關閉. |
| I-1: a CSV import update row can invalidate a Pending request without any notice, which conflicts with 「Update row 不藉匯入修改…狀態」. | The reviewer's mechanism was checked against `applySupplierImportRow.js:57` and design §4.5 and the import section. Registered as **DEF-045** with decision **HD-140**. Not fixed here: it existed before this PR and needs a product decision. |
| I-2: `updateSupplier` and `changeSupplierCode` set the flag to true without using the return value of `invalidateForSignificantChange`. | Both now take the return value. A new unit test covers Pending with no open request for both paths. It fails on main's service, and a mutant that reverts only the Code path also fails it. |
| I-3: accessibility is acceptable. | No change. |

## Verification after the fixes

- **Client:** 114 files, 956 tests pass. Lint exits 0.
- **Server unit tests:** `supplierAdminService.test.js` passes 23 of 23.
- **Server integration:** the supplier integration files that touch update, Code change or invalidation pass 76 of 76 on the scratch MySQL, with `DB_INTEGRATION_TESTS=1` (0 skipped).
- **Real backend:** UAT PHASE-002 passes 9 of 9. A scratch identifier create-then-edit check also passes: warning shown, notice persistent and closable, badge 草稿. The scratch spec was deleted afterwards.

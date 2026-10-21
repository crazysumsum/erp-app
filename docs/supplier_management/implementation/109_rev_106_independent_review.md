# REV-106 — independent review of the HD-116 A defect dispositions

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-defects` at `db1b10fb`, reviewed as `git diff origin/main..HEAD`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium, five Low and nits.

## What the reviewer confirmed

- **The fixes:** DEF-003, 005, 006, 010 and 030 do what HD-116 A asked.
- **DEF-006:** mysql2's `FOUND_ROWS` makes `affectedRows` a matched-row count.
- **DEF-030:** the CLI's validation matches the server's on nine inputs.
- **Ledger:** APPROVAL-HD-116-RISK covers exactly the 12 deferred, handed-off and accepted defects, and the PR #260 record matches `gh pr view 260`.
- **DEF-016:** the three status writers are as described.
- **DEF-004:** the foreign-key delete rules are as described.
- **Real browser:** four scenarios passed against a real server, using Playwright with real login and device. The create page and the detail banner show the Bank warning, and it clears after an account is added. There were no unexpected console or network errors.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: the DEF-024 note was wrong. Two *different* Suppliers deadlock when each adds its first default account at the same moment. Both take a gap lock on the same empty range in `#activeRowsForUpdate`, then insert. This is the most common Bank write, and the original TC-077 observation. | Fixed in code as well as in the docs. Bank create, update, set-default and deactivate now retry once on `ER_LOCK_DEADLOCK`, through the DEF-031 helper with a warn log. `bank_operations.md` §6.3 and the register now say when the deadlock happens and how the system handles it. Test: two adjacent new Suppliers. Both transactions are held after locking their empty range, then released together. InnoDB's deadlock counter rises, both creates succeed, the retry is logged once, and each Supplier ends with one default account. This passed 5 of 5 runs. Control: without the retry, one create fails. |
| M-2: a refused address showed only 「地址資料不正確」. An existing address with a newline in its notes could not be saved even when another field was edited. | The message now names the field and the reason, for example 「備註不可包含換行或其他控制字元」, 「城市不可超過 100 個字元」. The UI already displays the server message. The register gives the SQL to count affected rows before release; it was checked on MySQL 26.7.0 against newline, C0 and C1 characters. Any clean-up of such rows is a data change that needs its own approval. |
| L-1: DEF-003's provider read does not check Business Master readiness. | Recorded in the register: the readiness gate on this read path is not part of the fix. |
| L-2: the register said the CSV path had no limit, but `checkCells` already refuses those values. The import also mapped `label` and `phone` to the wrong column if the service error were ever reached. | The register is corrected. The import's field map now maps `label` to `addressLabel` and `phone` to `addressPhone`. |
| L-3: no test covered "only an inactive bank account". The `status = 'active'` condition could be removed with every test still passing. | TC-046 now deactivates the only account and expects `BANK_ACCOUNT_MISSING` again from both completeness and detail. Control: removing the condition now fails TC-046. |
| L-4: the register implied the import worker's threshold has an effect. | Reworded. The worker is wired, but imports run without the similar-name check. |
| L-5: four of the six IN_PROGRESS defects still pointed at the old risk approval. | All six now have `risk_approval_id: null`. |
| Nits | Left as they are. The optional-chaining style in the handlers is harmless in production. The duplicate `containsControl` copies predate this change. |

## Verification after the fixes

- **Supplier suite:** 699/699. Lint exits 0.
- **Bank deadlock test:** 5/5 green; it fails when the retry is removed.
- **TC-046:** fails when the active-account condition is removed.
- **Address messages:** pinned by unit test.

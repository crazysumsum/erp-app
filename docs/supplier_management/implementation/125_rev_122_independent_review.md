# REV-122 — independent review of the DEF-045 fix (HD-140 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def045-import-pending` at `671b57af`, reviewed as `git diff origin/main..HEAD` (base `6ad60848`)
- **Verdict:** **APPROVED**
- **Open findings:** Critical 0, High 0, Medium 0. Two Low, five Info.

## What the reviewer confirmed

- **No change to UI updates.** `changedApprovalFields` is equivalent to the inline comparison it replaces. Mutant M9 (UI updates never invalidate) is killed.
- **Precheck predicts apply correctly.** Precheck's next values match what apply writes:
  - the same normalizers;
  - a blank cell keeps the current value on both sides;
  - currency is canonicalised through the catalog;
  - term ids are compared as strings;
  - no NULL mismatch, since `display_name` is NOT NULL.
  An exported file re-imported for a Pending Supplier passes.
- **No gap between precheck and execution.** Every `UPDATE suppliers` bumps `version`, including draft → `pending_approval`. Apply checks the expected version under `FOR UPDATE`, so a Supplier that changes after precheck fails its row with `VERSION_CONFLICT`.
- **No import cycle.**
- **Error fields are the CSV column names**, and the import page shows them.
- **Negative control:** with main's processor, both new tests fail.
- **Ledger:** the MERGE record for PR #284 is correct.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| L-1: dropping `display_name` from the lookup SELECT survived. The unit fake returns whole rows, and the integration row did not send a display name. | The integration seed and the U1 update row both carry `displayName: "One"`. M3 now fails the integration test (1 fail), and M2 (`supplier_name` dropped) still fails it. The reviewer's optional addition, re-sending the current payment term, is not done: this file has no payment-term fixture. Term ids are already compared as strings in the unit test. |
| L-2: the register overstated which SELECT mutants were killed. | Reworded. It now names both columns and says the `display_name` mutant survived until L-1 was fixed. |
| I-1: a comment, and the register, could be read as refusing only some columns. | Both now say the whole row is refused, and that a row changing no significant field still updates. |
| I-2: design §6.9 does not mention the rule or the new code. | Not changed in this PR. Editing `03_design_spec.md` moves the design baseline, which would strand the approval and review records bound to it and the design hash that Purchasing pins (see the DEF-037 change). The rule is recorded in HD-140, DEF-045 and this report. It should be added the next time the design is revised. |
| I-3: the result CSV shows the same message for each refused column, without naming the column. | The message now names the column (「修改 paymentTermCode 會令原申請失效…」); a unit assertion pins this. |
| I-4: the processor imports all of `SupplierAdminService` for one pure function. | No change. There is no cycle, and a separate module would add a file for a single function. |
| I-5: no browser run. | No client change, so no Playwright run. The integration test checks the row outcome (`skipped`, `SUPPLIER_IMPORT_PENDING_APPROVAL`). |

## Verification after the fixes

- `supplierImportPrecheck.test.js`, `supplierAdminService.test.js` and `supplierImport.integration.test.js`, with `DB_INTEGRATION_TESTS=1`: 79 of 79 pass, 0 skipped.
- Before these follow-ups, all Supplier server tests (92 files, unit and integration) passed 726 of 726, with 0 skipped.
- eslint exits 0.

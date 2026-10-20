# REV-101 — independent review of HD-057 A (similar-name exception list)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** commit `72add141` on branch `claude/supplier-task-051-tests-6`, reviewed as `git show 72add141`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium and six Low.

## What the reviewer confirmed

- **Same rules as UI create:** the script reuses the normaliser, `SupplierDuplicateCandidates.find`, the candidate cap and the 10-per-row limit.
- **Row numbers match the import:** template rows, blank rows, trimming, unguarding, BOM handling and header checks are the same.
- **In-file scores:** the in-file computation equals pairwise `bigramDiceScore`. A property test found 0 mismatches in 900 runs, including 916 pairs exactly at the threshold.
- **Output safety:** writing with `wx` refuses to overwrite, and every output cell is formula-guarded.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: UI create never reads `SUPPLIER_DUPLICATE_NAME_THRESHOLD` (every `SupplierAdminService` uses the class default 0.85), but the script read it, so the two could differ. | Fixed with the reviewer's second option. The script uses the same default checker as UI create and does not read the setting; it prints the threshold it used. The first option, wiring the setting into every construction site, would change UI behaviour for any non-default value. That is outside HD-057, so the gap is recorded as DEF-030 (LOW). A test pins that UI create's checker uses the class default; it will turn red when DEF-030 is fixed. |
| M-2: identical or near-identical names made the in-file part O(n²) in output and memory. 5,000 rows named "TBC" ran out of heap with no report. | Fixed. Rows with identical normalised names form a group, and each row points to the first row of its group, so the output is linear. Rows with different names list at most 10 pairs each, highest score first; the rest are counted in `fileMatchesNotListed`. Existing-Supplier lookups are cached per distinct name. The test runs 3,000 rows of "TBC", which gives 2,999 lines. It also runs 300 near-identical names, which stays within 10 lines per row, and a control shows that some row exceeds the cap. The run-time claim in the runbook now says it assumes few matches. |
| L-1: the documented `--input <file>` form was refused. | Fixed. Both `--name value` and `--name=value` are accepted, and the runbook uses the first form. A CLI test runs the documented form. |
| L-2: running through a symlink did nothing and exited 0. | Fixed. The entry guard compares the `realpath` of `argv[1]`. A CLI test runs through a symlink. |
| L-3: a malformed body printed cell content. | Fixed. The body is parsed with the import's own `CSV_OPTIONS`, now exported. A `CsvError` becomes `SUPPLIER_IMPORT_CSV_MALFORMED` without any cell content, and the test checks the message does not contain the cell. |
| L-4: in upsert files every update row matched itself, and a blank name ("keep the name") counted as invalid. | Fixed. `--mode create_only\|upsert` is now required. In upsert mode the row's own Supplier is resolved by `supplierId`, or by code when there is no ID, as the import does, and is excluded from its matches. A blank name on such a row is counted in `keptNames`. The test covers both modes, with a create-mode control. |
| L-5: "one indexed query per row" and "a read-only transaction" were inexact. | The runbook now says up to three queries per distinct name. It also says that each statement runs read-only with its own snapshot. |
| L-6: test gaps. | The read-only session is asserted: the first statement must be `SET SESSION TRANSACTION READ ONLY`, everything else must be a `SELECT`, and a write on that session is refused. Row numbers are compared with `precheckSupplierCsv` on a file with blank rows between data rows. There are new CLI tests for the documented form, a missing mode, and a symlink. The bound test is described under M-2. The threshold expectation now comes from the checker, not from the code under test. A test with a pair exactly at the threshold was not added: the reviewer's property test covered 916 such pairs, and the brute-force comparison in the first test uses the same `>=`. |

While running mutations on the fixes, one mutant (dropping the read-only statement) hung the test instead of failing it. The connection used to record statements was not closed when an assertion failed. The test now closes it in `finally`.

## Verification after the fixes

See the ledger observation for this review: the test file's results and the mutation sweep.

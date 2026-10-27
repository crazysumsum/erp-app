# REV-126 — independent review of the UAT PHASE-004 cases (HD-124 A, HD-144 B)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-uat-phase-004` at `60382be2`, reviewed as `git diff origin/main..HEAD` (base `d805913b`)
- **Verdict:** **CHANGES_REQUESTED**. 6 Required, 7 Optional, plus Nits, and three points for the Product Owner.

## What the reviewer confirmed

- **Runs and mutants:** the full UAT config gives 39 passed and 14 skipped. Eight product mutants were killed on their intended assertions:
  - invalid rows written;
  - Bank-header refusal removed;
  - confirm or create without idempotency;
  - formula guard removed;
  - export audit removed;
  - export control shown to VIEWER.
- **Sound as written:**
  - The Supplier steps before each `test.fixme` are the right ones.
  - The import-root lifecycle is per run, 0700, removed on every exit path, and checked against the Customer and Item roots.
  - The UAT-038 log check and the boolean-only plaintext comparisons hold.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: a failing UAT-043 wrote a full (fictional) account number into a junit-referenced trace. | Trace and failure screenshots are off for the whole spec. Playwright allows that only at file level, as in PHASE-003. |
| R2: UAT-037 checked totals, not each row's outcome. Swapping two rows' outcomes survived. | Each row's outcome is asserted from the `outcome` column. The swap mutant fails at that assertion. |
| R3: UAT-039's 409 allow was dead and hid a UI double-submit. | Removed. A mutant that confirms twice from the UI now fails on the problems list. |
| R4: UAT-046 could not see the UI wrongly showing Active, because it reloaded first. | The badge is asserted before and after the reload. A mutant that shows Active after a failed activation fails at the before-reload check. |
| R5: the export check looked at column names only. Ciphertext under a neutral name survived. | The header must equal the template v1 columns exactly (HD-067 2A). An extra-column mutant fails. |
| R6: the TC map said UAT-054 was the only intercepting case. | Corrected. |
| O1: nothing checked the import root, and the Bank masked list was not captured. | The refused file is an upsert of an existing Supplier. That Supplier's masked Bank list (BANK-READER) is shown empty, and the import root is scanned for the account. A mutant that stores the file before refusing it fails. |
| O2: only CLERK exported, and CLERK has no `supplier.bank.view`. | SYSTEM-ADMIN, which holds every Bank permission, also exports, with the same assertions. Both exports are checked in Audit. |
| O3: the export filter was not checked. | The file must hold exactly the filtered Supplier. |
| O4: per-row precheck reasons were not checked, and not all four steps had a screenshot. | Reasons for rows 3, 4, 5, 7 and 8 are asserted, and each of the four steps has a screenshot. |
| O5: the dependency failure was browser-only. | A real-backend leg is added: the Supplier's currency is made inactive in Business Master, the server refuses activation, and activation succeeds after the currency is restored. The browser 503 leg stays. |
| O6: inner timeouts sat inside the test timeout. | UAT-037 and UAT-039 run with 150 s. |
| O7: the VIEWER check ran before the page rendered, and any 403 passed. | It waits for the search box, then asserts exactly `403 Forbidden`, as UAT-040 does. |
| Nits | Fixed: the design reference now reads §6.9; an empty parent import directory is removed; UAT-036 also changes the payment term; the CSV-MIXED note cites HD-053 A and HD-054 A. The `.q-badge` and `.q-item` selectors stay, matching the existing helpers. |

## Verification after the fixes

- **Full UAT config:** 39 passed, 14 skipped, and no account-shaped string in the junit report.
- **The reviewer's survivors, re-run (each file restored and checked with `cmp`):**

  | Mutant | Result | Fails at |
  | --- | --- | --- |
  | B3: result outcomes swapped | killed | the per-row outcome assertion |
  | D: UI confirms twice | killed | the problems list |
  | F: extra export column | killed | "exactly the template columns" |
  | J: Active shown after a failed activation | killed | the badge check before the reload |
  | K: Bank file stored before refusal | killed | "no account number in the import root" |

- **Lint:** eslint exits 0.

## Points for the Product Owner (HD-145)

- **CSV-MIXED:** 07 §2's CSV-MIXED includes a Bank column, which HD-053 A and HD-054 A refuse at upload. UAT-038's evidence also says 「預檢錯誤」, but the refusal happens at upload.
- **UAT-043's actor:** 07 names VIEWER, but design §6.9 and SEC-002 restrict export to `supplier.mgmt`.
- **UAT-046's evidence:** the browser-intercepted 503 is accepted as UAT evidence, as it already is for UAT-054.

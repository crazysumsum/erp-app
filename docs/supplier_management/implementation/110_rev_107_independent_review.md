# REV-107 — independent review of the supplier-client-ui runner (HD-117 A, PR 1)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-client-ui` at `ebaccd56`, reviewed as `git diff origin/main..HEAD` (base `c2237293`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Three Medium, six Low, four Info.

## What the reviewer confirmed

- **Runner:** the exact profile command exits 0. The real `harness_runner.parse_results` reads 164 tests, all passed, none skipped, no duplicate names, no title with two IDs, and every required ID PASS. Exactly the 19 Supplier page and service files run.
- **TC-013 test:** six mutants of `DataTable` and the list page (error swallowed, no banner, dead retry, `aria-busy` never true, banner on an empty list, error not cleared) each turn it red.
- **Ledger:** the PR #261 record matches `gh pr view 261` and run 39543444313 (13/13 success); the MERGE fingerprint recomputes exactly; the six closed defects follow the earlier closures; APPROVAL-HD-117-SCOPE names exactly the profile's four `server/scripts/` paths.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: TC-013 marked COVERED, but the shared `DataTable` shows 「冇資料」 while loading and under the error banner; no-permission state and role projections untested. | TC-013 is PARTIAL with these gaps named. The `DataTable` behaviour is recorded as DEF-032 (shared framework code, outside the module): it needs its own decision, so no product change here. The suggested `not.toContain("冇資料")` assertions would fail until DEF-032 is fixed, so they are not added yet. |
| M-2: TC-123 COVERED, but closing the tab was never tested; removing both `beforeunload` listeners left the suite green. | `create.test` and `editor.test` now dispatch `beforeunload` on a clean and a dirty form. jsdom treats `returnValue = ""` on a plain `Event` as a cancel, which first let a mutant without `preventDefault()` pass; the probe now masks `returnValue`, so it measures `preventDefault()`, which is what browsers honour. Controls: removing `preventDefault()` or the dirty check from either page turns the test red. TC-123 stays PARTIAL for browser back and two real sessions. |
| M-3: a TC-124 title claimed the delete dialog without opening it; archive, delete and the wording were untested. | The title is trimmed. A new parameterised test opens the archive and delete dialogs and asserts the Code and name, the end state, the kept-history and Draft-only wording, the device rule (delete only), both fields, and a disabled confirm. Controls: dropping the device flag, the history wording, or archive's password turns it red. The gap text names keyboard, icon and suspend wording. |
| L-1: TC-121 tests check page metadata only. | TC-121 is PARTIAL: menu order and the 403 redirect (asserted only outside the suite) are named. |
| L-2: the markup-as-text test is AUTH-009, not UI-007. | Its TC-127 tag is removed; the TC-127 row no longer cites it. The static brand-hex check is named as a gap, not done. |
| L-3: clauses rested on untagged tests. | Three more `bank.test` tests carry TC-075 and the import draft-confirm test carries TC-126. |
| L-4: TC-015 and TC-029 gap text incomplete. | Both rows now name refresh, the no-sensitive-value clause, the "stay" choice and saving the new value. |
| L-5: `authorizationRefresh.test.js` has Supplier assertions outside the suite. | Left out on purpose (a framework routing test, mostly not Supplier's); the map says so and why. |
| L-6: older map rows contradicted the new section. | The TC-013, TC-015 and TC-029 rows under the server suite now say "moved to `supplier-client-ui`". |
| I-1: HD-117's answer text is the same as HD-116's. | `answer_ref` now says which message it answered. |
| I-2: `min_tests` is 11 while 168 tests run. | Named in the map; changing it re-baselines the profile and needs its own decision. |
| I-3, I-4: no other-axis issues; no real-browser run. | No product UI code changed in this PR. |

## After the follow-ups

Local, not CI: the suite runs 168 tests, all passed, every required ID PASS through the harness adapter; the whole client suite and lint pass. Not re-reviewed.

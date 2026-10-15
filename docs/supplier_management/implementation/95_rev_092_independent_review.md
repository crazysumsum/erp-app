# REV-092 — independent review of TASK-051 step 2a (PR #229)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline commit:** PR #229 head before the follow-ups, reviewed as `git diff 63fa5063...HEAD`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 3 at review time.

The reviewer confirmed the mechanics. 626 tests pass; the counts (66/89, 7/10, 15/15) match; no title has two IDs; every tag sits in its suite's file set; the #227 merge facts check out in git. It also found tags that make a case PASS when the carriers do not assert the case's Expected Result. It found as well that the bar used for untagged cases (real MySQL, real concurrency, not SQL text) had not been applied to several tagged ones.

## Disposition

The Product Owner said to fix everything as recommended ('review 完全部按建議修').

**The bar, applied to every case.** A carrier must assert the case's main Expected Result: the stated outcome, plus any real-database or concurrency condition that its Steps require. Smaller clauses a carrier does not assert are listed as notes in the map and accepted as partial.

| Finding | Disposition |
| --- | --- |
| H-1 TC-111: the carriers never call without a token | Untagged. A step 2b test will call every Supplier route anonymously. |
| H-2 TC-091: the carrier asserts `completed` with a skipped row; IMP-006 expects `completed_with_errors` | Untagged. The spec/code divergence is put to the Product Owner as a decision. |
| H-3 TC-113: refusal not asserted; one carrier tests a constructor | Untagged. |
| M-4 TC-108, M-5 TC-020, M-6 TC-027, M-7 TC-008, M-8 TC-046, M-9 TC-116, M-10 TC-118, M-11 TC-120 | Untagged. |
| Low TC-082, TC-045, TC-004 | Untagged under the same bar: concurrency or a real database is part of their Steps. |
| Low TC-039 `findManyByIds` carrier | Untagged; the case keeps its STATE-010 carrier. |
| TC-047 on the root-normalization test (noted under M-5) | Untagged: PARTY-008 concerns children. |
| Low TC-019, TC-054, TC-055, TC-058, TC-059, TC-016 | Kept. The main outcome is asserted; the missing clauses are listed as notes in the map. |
| Info: TC-089 missing from the table; the TC-105 title paraphrased | The table is now generated from the test titles themselves. |
| Info: #227 recorded as MERGE PASS although its CI later failed; placeholder time | Kept as MERGE PASS: the merge itself happened. A separate CI FAIL observation now records the failed run. The merge record carries the time it was written. |

**After the follow-ups:** supplier-bank-security has 15 of 15 required IDs, supplier-server-integration 57 of 89, and supplier-security 2 of 10. The 40 untagged cases are listed for step 2b.

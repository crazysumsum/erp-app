# REV-138: independent review of the HD-156 E record

- **Reviewer:** `agent-skills:code-reviewer`, a separate agent. I did not write this change.
- **Baseline:** PR #304, branch `claude/supplier-hd156-defer` at `c72acb52`, reviewed as `git diff origin/main..HEAD` against base `5bed215b`.
- **Method:** read-only.
- **Verdict:** **CHANGES_REQUESTED**. 0 critical, 0 high, 1 Medium, 3 Low, 2 nits and 1 optional item.

## What the reviewer confirmed

- **The PR #303 merge record matches `gh`:** 5bed215b at 07:53:43Z, head 31ab2a28, 13 of 13 checks, run 40830448716.
- **Ledger integrity, by a structural diff of origin/main against HEAD:**
  - The revision chain is 486 → 487 → 488.
  - Only the baseline commit and worktree, `runtime.resources`, `next_safe_action`, HD-156's status and answer, and one appended observation change.
  - The mode entry baseline is unchanged.
  - BLOCKED with resume VERIFYING still holds.
  - DEF-050 is OPEN, with no risk approval.
- **HD-156's answer** matches option E clause for clause, and nothing claims DEF-050 is risk-accepted.
- **No document** outside history still says HD-156 is OPEN. The validators pass.

## Disposition

| Finding | Disposition |
| --- | --- |
| **M1:** 04 and 06 added a branch that E does not contain, "a pass means no remedy" | 04 now reads "The options in HD-156 are:". If the production-like run passes, whether any remedy is still wanted goes back to the Product Owner. 06 now says the run "gives the numbers for choosing among HD-156 A–D". |
| L1: 07 still said the gate reports `HUMAN_DECISION_REQUIRED` | 07 now says the gate reported it from revision 484 to 487, and no longer does from 488. |
| L2: "until then" was unclear; the gate blocks on TC-085, not on DEF-050 itself | 06 now reads: "TC-085's TECHNICAL FAIL keeps Technical Acceptance blocked while DEF-050 is OPEN." |
| L3: `next_safe_action` dropped this PR's step and claimed Supplier work was done | Rewritten. It now leads with PR #304's review, CI and merge, and reads: "no further Supplier-side work until the production-like environment exists". The Supplier items in C are listed. |
| N1: a duplicate "(E)", and "must agree" | Both fixed: the duplicate removed, and the wording changed to "must agree to". |
| N2: "the HD-156 options" in 06 | Changed to "HD-156 A–D". |
| O1: the remedy choice belongs to the Product Owner | Added to the 06 C row's owner column. |
| Information: the TA gate also reports `EVIDENCE_COMMAND_ACTUAL`, `TEST_COUNTS` and `EVIDENCE_NOT_PASS` | Pre-existing and out of scope. No change. |

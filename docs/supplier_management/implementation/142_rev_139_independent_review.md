# REV-139: independent review of the HD-157 plan revision (design review on 22865f96)

- **Reviewer:** `agent-skills:code-reviewer`, a separate agent. I did not write this change.
- **Baseline:** PR #305, branch `claude/supplier-hd157-plan-revision` at `0e2267a7`, reviewed as `git diff origin/main..HEAD` against base `e64dfc74`.
- **Scope:** this is also the design review on design `22865f96` and plan `8b31fcdd`.
- **Verdict:** **CHANGES_REQUESTED**. open_critical 0, open_high 0; 4 Medium, 4 Low and 3 nits.
- **The baseline content is acceptable as written.** Every Medium fix is in a file outside the design and plan digests, so fixing them moves neither baseline.

## What the reviewer confirmed

- **The specs implement HD-157 and no more.**
  - NFR-005 is 3 s and NFR-001 is still 2 s. 03 §11.5, 05 T51, 06 §0, SKU-008 and OPS-001, and 07 §0, UAT-044 and UAT-046 all match.
  - TC-136, UAT-044 and UAT-045, the business UAT, the sign-offs and the release decisions are unchanged.
  - TC-006's waiver keeps the ordering loss as a release decision.
  - No for-SKU 2 s requirement remains outside history.
- **The runners:**
  - The waived parts are under `waived`, and TC-136 is still NOT_RUN.
  - Every suite meets its profile `min_tests` and required IDs.
  - The benchmark keeps NFR-001 at 2,000 ms.
  - No consumer of the old `notRun` key or check name is left.
- **The ledger:**
  - HD-157 quotes both messages verbatim, and HD-156 is appended to, not rewritten.
  - The two-step mode change follows the precedent.
  - Approvals went from 108 to 136, with every base approval unchanged. Both sets are kept, and the `-PIN` set's baselines equal the observed design and plan.
  - The developer observation matches the raw outputs.
- **The boundary:** OUTSIDE_MODULE is reported for exactly the five scripts, and they are covered by HD-117-SCOPE and HD-122-SCOPE (`-PIN`).

## Disposition

| Finding | Disposition |
| --- | --- |
| **M1:** TC-128, 130, 132 and 133 were marked COVERED, but their gap columns still list local gaps that HD-157 did not waive | All four are back to PARTIAL. Each gap now reads "production part waived by HD-157; remaining local gaps, not waived: …". The remaining gaps are: no ramp-up; `BUSINESS_MASTER_NOT_READY` and purchase submit not exercised; lookup metrics not implemented, and the other events listed; SKU relations not seeded. TC-134 and TC-135 stay COVERED. |
| **M2:** the residual risk was not where the release decision reads it, and the sign-off sheet contradicted HD-157 | **`release_evidence.md`:** a new known limitation names HD-157 and every check now unverified before production. The Operations and Security preconditions mark what HD-157 waived; whether to check the break-glass accounts before go-live is left to the Product Owner at release. **`operations.md`:** :8, :105 and §6 point to HD-157 and the release limitation. **Boundary page:** the intro now states the HD-157 exception to "does not reduce scope". |
| **M3:** issue #294 asks Purchasing for a stale hash and says the for-SKU lookup did not change | Needs the Product Owner's word, because a comment is an outward action. After merge: give the new target hash `e49ac37d`, and say §11.5's for-SKU p95 is now 3 s with no API change. |
| **M4:** 07's "current result" still describes the HD-156 E path | A dated note at the top says HD-156 E is superseded, the results are on the old plan baseline, and the next formal run will be added as the current result. |
| L1: the scope extras and the RISK re-record were recorded only in the answer's scope sentence | HD-157's answer_ref now says what was shown to the Product Owner before the answer. That was: the plan revision; "14 approvals to be re-recorded"; the 07 amendments, N3 and N6; the residual risk; and, earlier, the environment authorization. |
| L2: the developer observation is bound to the intermediate baselines | A new observation on plan `8b31fcdd` explains it. Since that run, only the verdict module and its unit test changed. The run's reports already show NFR-001 at 2,000 ms (verified), and the formal run after merge re-measures everything. |
| L3: the profile cites REV-130, not REV-131, and the "standing instruction" has no HD record | Noted in the TC map. The profile is a baseline file, so this is corrected at the next plan revision rather than moving the baseline now. |
| L4: only the for-SKU verdict checked its limit | NFR-001's 2,000 ms is now checked in `load.every_general_operation_within_limits` and `online.p95_under_2s_during_import`, with a breaking case for each (48 cases). A mutant without the checks goes red. |
| Nit: "`min_tests` 3" for the release suite | Corrected to 2. |
| Nit: the PR body listed UAT-044 as unchanged | The PR body now says it is "not waived". Its SKU-selection limit is 3 s. |
| Nit: the 06 wording about re-judging old numbers, and "Done:" | Reworded. The next formal run measures TC-085 again, and the formal-evidence row now says the old evidence is stale and the new run is open. |

## Follow-up verdict (same reviewer, HEAD `1227ae60`)

**APPROVED** for the design review on `22865f96` (plan `8b31fcdd`). open_critical 0, open_high 0.
- **Checked against `git diff 0e2267a7..HEAD`:** every disposition above, and no baseline file touched. Two separate L4 mutants each went red on their own case.
- **M3 does not block approval.** It is an outward action needing the Product Owner's word, and it is now in `next_safe_action`.
- **One nit fixed:** a double label in the TC-132 gap.

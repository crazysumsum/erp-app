# REV-120 — independent review of the UAT PHASE-002 cases (HD-124 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-uat-phase-002` at `6f7bd513`, reviewed as `git diff origin/main..HEAD` (base `44d7f836`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 2. Three Medium, four Low, two Info.

## What the reviewer confirmed

- **Runs:** the full UAT config gave 29 passed and 5 skipped. PHASE-002 alone gave 9 passed, so it does not depend on PHASE-001 running first.
- **Mutation sweep:** 14 of 21 product mutants were killed, each on its intended assertion.
- **Precondition shortcuts are acceptable environment setup:**
  - the approval policy set by SQL (read per transaction, no cache);
  - Pending requests created through the same endpoint the UI uses;
  - APPROVER-B disabled by SQL and restored in `finally`;
  - the `afterEach` reset, which also runs on failure paths.
- **Ledger and docs:** the ledger entry matches the PR #282 merge, and `07_uat_test_cases.md` correctly stays NOT_RUN.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| H-1: UAT-040's API refusal came from a wrong password, before any permission check. M13, which lets `supplier.view` update the settings, survived. | The call uses CLERK's real password and expects exactly `403 Forbidden`. The before/after database check is kept. M13 is red. |
| H-2: UAT-014 passed without the 「失效提示」 that its Required Evidence and design §7.4 ask for. The product shows no warning and no notice, and the client never reads the `approvalInvalidated` flag the server returns. | Recorded as **DEF-044**, decision **HD-139**. UAT-014 now expects a warning before the edit and a notice after the save, so it fails at that step until DEF-044 is fixed. It is not recorded as a pass. |
| M-1: UAT-011's "option not offered" checks ran before the list loaded, so they could not fail. M20 and M21 survived. | The positive option is awaited first, then the absences. M20 and M21 are red. |
| M-2: UAT-011 accepted any 400, so the self-approval rule was unproven. M06 survived. | Each refusal code is asserted: self gives `APPROVER_MUST_DIFFER`; VIEWER and a disabled user give `APPROVER_NOT_ELIGIBLE`. M06 is red. M05 (the list leaving out the requester) needs a requester who also holds `supplier.approval`, which the §2 roles do not include. It is recorded as a known limit in the TC map. |
| M-3: UAT-052 proved that the old approver could not decide only through disabled buttons. M10 survived. | A signed approve call by the old approver must return `409 APPROVAL_NOT_ASSIGNED`. M10 is red. |
| L-1: UAT-041 did not check the before and after values. M16 survived. | UAT-041 expects `requireActivationApproval：false → true` and UAT-015 expects `true → false`. M16 is red. |
| L-2: nothing proved that the queue holds only the assignee's own requests. M19 survived. | UAT-010 checks that the request is absent from APPROVER-B's own queue. UAT-052 checks that it leaves APPROVER-A's queue after the reassignment. M19 is red. |
| L-3: some assertions were weak, and not every driven page was watched. | UAT-052 asserts the 「已重新指派」 outcome. `watchProblems` is attached to every page that UAT-010, 013, 014, 015, 041 and 052 drive. |
| L-4: two comments were inaccurate. | Both corrected (spec header; `uatSupport.js` service-call comment). |
| I-1, I-2 | I-2: the TC map says the rejection reason appears only in the Audit tab. I-1 needs no change. |

## Verification after the fixes

- PHASE-002 on the real backend: 8 passed. UAT-014 failed at the DEF-044 warning step.
- After DEF-044 was fixed in PR #283, the branch was rebuilt on main `206484f4`. The full UAT config then gave 29 passed and 5 skipped (the PHASE-001 `test.fixme` cases); PHASE-002 passed 9 of 9.
- The reviewer's runner, rerun on M06, M10, M13, M16, M19, M20 and M21: all killed, each on its intended line. Files were restored and checked with `cmp`.
- eslint exit 0.

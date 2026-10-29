# REV-130 — independent review of the baseline refresh (HD-149 A) and the HD-150 A scope approval

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-baseline-refresh` at `65b89ff2`, reviewed as `git diff origin/main..HEAD` (base `c51ddbc8`), on design baseline `2390e6fc`
- **Verdict:** **APPROVED**. 0 open critical, 0 open high. 3 Optional, 6 Nits, five points for the Product Owner.

## What the reviewer confirmed

- **Pins.**
  - Old pins: the old values equal the files at `34207893` and `11e4b5b0`.
  - New pins: the new values equal the files on main.
  - Item: one commit since the pin. It adds DES-022 only; §8.3.2 and DES-021 are unchanged.
  - Purchasing: two commits since the pin. They change Inventory provider and reversal internals only; no changed line mentions Supplier.
- **Approvals.**
  - Exactly the 13 approvals that were APPROVED on the old baselines are re-recorded. The REVOKED one is left out.
  - Each copy matches its source field for field, apart from `id`, baseline, `recorded_at`, `code_commit` and `source_ref`. The source text is kept verbatim, and all 94 originals are kept.
  - The deferred defects are repointed to the new risk approval.
- **Stranded records.** Every record class a manifest change strands was checked:
  - Reviews: replaced by this review.
  - Run evidence, and the CI, PR and MERGE observations: not needed for the TEST_AND_VERIFY import, which checks PLAN_READY. Formal runs will produce new evidence.
- **07 amendments.** They match the TC map, HD-145 and HD-146. UAT-043's restriction is confirmed in design §6.9.
- **Profile suites.**
  - Every secret is redacted, and the side effects and stages are correct.
  - The reviewer ran both suites with the runner's filtered environment: `check` passed 8 checks, and `copy` passed 19, approval ON included. The `copy` refusals held, and no secret appeared in any output.
- **Harness tools.**
  - `validate_traceability`: STRUCTURE_PASS.
  - PLAN_READY: only REVIEW_NOT_SATISFIED, before this review was recorded.
  - Boundary: only the `server/scripts` line, which is by design under HD-034.
  - On main, from `6458d9d5`, the tool reports PR #293's three lines. The package.json line is cleared on the branch by HD-150.
- **APPROVAL-HD-150-SCOPE** covers exactly the two paths and records the deviation honestly.
- **Ledger.** It matches GitHub for PR #293 and issue #294.

## Disposition

| Finding | Disposition |
| --- | --- |
| O1: the TC map and the boundary page contradicted the amended 07 and the done pin refresh; the Purchasing row had no link to #294 | The TC map's two 07 notes are now in the past tense, citing HD-149 A and `12d52ff3`. The boundary page's deliverables row and pins row record what was done. The Purchasing row links #294. `testing/**` is outside the plan digest and the fingerprint. |
| O2: the deployment suites report TC-135 for only part of it | The TC map's TC-135 row now says what each suite covers, and that a formal run in `supplier-isolated-test` is a local rehearsal and partial evidence. The Technical Acceptance report will say the same. `required_case_ids` is kept, because changing the profile would move the plan baseline. |
| O3: the suites can point at real targets while the evidence says "isolated" | Recorded in `operations.md` §5, the TC map and the boundary page. Harness runs target only the isolated environment. Production-like runs follow the runbook, and their evidence goes in `release_evidence.md`. |
| N1: only the exact value `true` turned on first-deployment mode | Any value other than unset, empty, `true` or `false` now fails the run and writes a FAIL report. Checked with `yes` and `1` (FAIL) and `false` (8 checks, no approval-OFF check). |
| N2: the usage text and the URL error did not name the environment variables | Both now name them, and so does `operations.md` §5. |
| N3: 07 §0 document control is out of date | **Left for the next plan revision.** Editing 07 moves the plan baseline, which would strand the 14 approvals just re-recorded. This is noted in the TC map. |
| N4: `recorded_at` was earlier than the commit it binds to | Set to the real time of the ledger commit, `2026-10-28T10:33:55+08:00`. |
| N5: the HD-150 approval's wording "from this plan baseline on" | Now: "while plan baseline 598f012b holds". It also says the approval covers all of `server/package.json`, because that is the harness's granularity. |
| N6: UAT-046's currency step is attributed to HD-145 | **Left for the next plan revision,** for the same reason as N3. This is noted in the TC map. |

## Points for the Product Owner, and what happens to them

1. HD-150 covers all of `server/package.json` while plan baseline `598f012b` holds. This is stated in the approval.
2. What a formal run of the deployment suites proves: a local rehearsal and partial TC-135 evidence (O2, O3).
3. Facts expire on merge. Before the mode-change checkpoint, `validate_traceability` and PLAN_READY will be run again on the merged main.
4. `state.runtime` is stale. It will be reconciled before the formal runs.
5. HD-116's risk approval is re-recorded unchanged. No new risk acceptance was made; that stays a release decision.

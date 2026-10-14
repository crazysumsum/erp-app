# REV-091 — independent review of TASK-051 step 1 (PR #226)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline commit:** `03d706f0` (PR #226), reviewed as `git diff fcfb1721...03d706f0`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 2 at review time.

The reviewer confirmed that the three changed server suites, the baselines, the matrix and the map counts are correct. It reproduced the 626-test run with only the profile's env keys, and found no secret values in the committed evidence.

## Findings and disposition

The Product Owner said to fix everything as recommended ('review 完全部按建議修').

| # | Finding | Disposition |
| --- | --- | --- |
| H-1 | `supplier-phase-001-server` (a required DEVELOPER suite) lacks the admin, mysql-client and Customer bank-key env; the four operations suites lack the Customer keys. | Fixed. Phase-001-server gets all seven keys and their redaction. It also runs from `server` with `--test-concurrency=1`: from the repository root its integration files ran in parallel on one database and hung, which I found while verifying this fix. The four operations suites get the Customer keys. |
| H-2 | `APPROVAL-HD-097-DESIGN-REBIND` is a HUMAN approval written by the agent with no Product Owner decision behind it, and it widens HD-097's scope. | Fixed. The record is revoked (kept, decision REVOKED). Re-recording HD-097 for the module scope is put to the Product Owner as a decision. Until then the DESIGN gate is stranded, as it has been since HD-085. |
| M-3 | `APPROVAL-HD-103-PLAN` was bound to `c2013bc7`, which includes env additions (MySQL admin credentials, the Customer key rings) made after the Product Owner's '1A'. `answer_ref` mixed his words with agent annotation. | Fixed. The approval is revoked and superseded by APPROVAL-HD-103-PLAN-1A, bound to `7232d2ec`, the change he approved. Both intermediate baselines are named. The env additions and the review fixes are put to him as a decision. Until then the current plan baseline has no valid PLAN approval. |
| M-4 | The reason given for moving TC-101 was wrong: a partial server test exists. All six moved IDs have no runner yet. | Fixed in `testing/05_tc_test_map.md`. The move stays: TC-101's Expected Result is a load measurement. The map says the six IDs fail closed until step 2 adds their runners. |
| L-5 | `supplier-security` runs the same tests as `supplier-server-integration`, and the `min_tests` floors were far below the real counts. | Floors raised to 620, 620 and 135. The shared glob stays: the AUTH cases are carried by tests spread across many files. |
| L-6 | After the retag, TC-089 has no carrier in the server suite. | Noted in the map. |
| L-7 | The approvals' `recorded_at` (midnight) predates the decision. | Fixed for the new record, APPROVAL-HD-103-PLAN-1A, which carries the time it was written. The two revoked records keep their original values. |
| L-8 | `supplierBankRestore.integration` hangs instead of failing when the admin keys are missing. | Fixed. The assert now runs before the first connection opens. Without the keys, the old version was still running after 40 s; the fixed one fails in 0.2 s. With the keys, it passes. |
| Info | Redaction of a short admin password garbles evidence; the map named the wrong base; the BLOCKED run.json does not say it was killed. | The base is corrected. The other two are left as they are: the redaction fails closed, and the ledger records the kill. |

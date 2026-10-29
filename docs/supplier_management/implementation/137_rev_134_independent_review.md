# REV-134 — independent review of the DEF-048 formal re-test and closure

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** PR #299, branch `claude/supplier-technical-acceptance-2` at `6acea5ed`, reviewed as `git diff origin/main..HEAD` (base `f62651d8`)
- **Verdict:** **CHANGES_REQUESTED**. 0 open critical, 0 open high. 2 Required (small doc and ledger fixes), 3 Optional, 3 Nits.

## What the reviewer confirmed

- **Scope:** only the ledger, the two reports and the 16 evidence directories change. There is no code.
- **All 16 run.json files** match the report row for row:
  - every run id, commit, fingerprint and baseline;
  - every artifact's hash and size.
- **Real executions:** junit counts are 732, 142, 732 and 208; XML hashes differ between stages; client-ui timestamps fall inside each run window.
- **Performance at both stages:**
  - deadlock detection and printing both ON;
  - 0 deadlocks in both loads, with the counter flat;
  - TC-101's seven checks pass;
  - online error rate 0, with only 200 and 201 responses;
  - 10,000 of 10,000 applied, exactly once.
- **Gate at `151aedf8`:** a scratch clone confirmed that `verify_gate` reports only `TASK_INCOMPLETE` and the issues derived from NOT_RUN.
- **State transitions:** all are allowed by `state_tool`.
- **No secret** appears in the new evidence or reports.
- **No overclaim:** Technical Acceptance, UAT, business acceptance and release are all stated as not done.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: the DEF-048 heading still said "open" | It now reads "MEDIUM (closed 2026-10-28)". |
| R2: the closure had the targeted re-test but no impact regression and no CI reference (references/10-defect-remediation.md) | The ledger's `closure_evidence` now has three parts: the Supplier server suite at both stages, which holds the new integration test; `supplier-security` at both stages; and PR #298's CI run 40645193058 (13 of 13). The closure paragraph in the register and the report list the same three: targeted re-test, impact regression and CI. |
| O1: 314 is not in any evidence, and "only while the server suites ran" was inferred | The report says the 314 is a manual query, and that the counter stayed flat across every performance load, which the run evidence records. It cites REV-134's attribution from the mysqld error log, recorded as an observation because the log lives in the scratchpad: 27 deadlocks, all in `erp_t51` or `erp_t51_mig_*`, from `supplierDeadlockRetry` and `supplierConstraintRaces` fixtures, 11 and 16 per stage, none in `supplier_name_grams` or a performance schema. I re-counted the dumps: 54 transactions, which is 27 deadlocks, with 0 lines mentioning `supplier_name_grams` and 0 in a performance schema. |
| O2: the warnings check covers only the online server | The wording is now "the online server's kept warnings". The import worker is a separate process with no warnings file; the deadlock counter covers both. |
| O3: DEF-034's narrative was not updated | One dated line is added. The two re-test imports also applied 10,000 of 10,000. PR #298 removed the hypothesised route, but because the cause is unproven, DEF-034 stays OPEN. |
| N1: 71.8 s and 77.4 s are execute time | Both figures are now given: precheck plus execute 78.1 s and 83.7 s, and execute alone 71.8 s and 77.4 s. |
| N2: `observed_at` against the gate observation | The observation now says the gate was observed after the runs and before commit `6acea5ed`. |
| N3: the HD-153 confirmation was appended to `answer_ref` | Kept: the change is append-only. |

## Points for the Product Owner

1. **Closing DEF-048 is well founded.** With the fix removed, the developer control produced 7 and 19 deadlocks. With the fix, every run had 0, and the error log shows no name-gram deadlock in the whole session. One residual risk remains: an update against an update on adjacent ids can still deadlock (REV-132).
2. **DEF-034 cannot be closed on evidence.** Keeping it OPEN, or accepting or deferring it at release, is the Product Owner's decision.
3. **Technical Acceptance now depends only on TASK-051 groups B and C.** No further local run can unblock it.
4. **The environment authorization caveat still applies.** The written authorization names `erp_dev` on 3306, while the runs used the throwaway instance on 3450.

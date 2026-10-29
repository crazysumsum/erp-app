# Supplier Management — Technical Acceptance report (2026-10-28)

## Re-test after the DEF-048 fix (current result)

**Result: Technical Acceptance still NOT complete.** It is now blocked only by what was known before any run: TASK-051 is open, and the production parts are NOT_RUN by design. Every local check passes at both stages, and **DEF-048 is closed**. UAT was not executed. Business acceptance and release approval have not happened.

- **Baseline:**
  - Mode entry commit `f62651d8`, the PR #298 merge with the fix.
  - The runs were made at `151aedf8`, which adds ledger only.
  - Plan baseline `598f012b`, design baseline `2390e6fc`, both unchanged.
- **Environment:**
  - The same throwaway mysqld as before, with `innodb_deadlock_detect` and `innodb_print_all_deadlocks` both ON. The runner checks and records both.
  - Two mysqld instances belonging to other worktrees were running on the host; they are not this module's and were left alone. Load averages recorded by the performance runner: TECHNICAL 5.1→10.5, REGRESSION 3.4→11.0.
- **Runs:** the 8 required suites at TECHNICAL, then at REGRESSION (HD-151 A, HD-153 A), from 06:53Z to 07:28Z, each a real `run_check --execute`.

| Stage | Suite | Result | Tests | Time (UTC) | Evidence (`evidence/…/run.json`) | Cases not passed |
| --- | --- | --- | --- | --- | --- | --- |
| TECHNICAL | `supplier-server-integration` | PASS | 732/732 passed, 0 failed, 0 not run | 06:53:12–06:55:47 | `20261028T065312-10bcf7528c57` |  |
| TECHNICAL | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 06:55:48–06:56:00 | `20261028T065548-e971bb6be35e` |  |
| TECHNICAL | `supplier-security` | PASS | 732/732 passed, 0 failed, 0 not run | 06:56:01–06:58:33 | `20261028T065601-39b9b1210994` |  |
| TECHNICAL | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 06:58:33–06:58:39 | `20261028T065833-dbae862acb58` |  |
| TECHNICAL | `supplier-resilience` | BLOCKED | 3/5 passed, 0 failed, 2 not run | 06:58:40–06:59:10 | `20261028T065839-c56a598014fa` | TC-130 NOT_RUN, TC-132 NOT_RUN |
| TECHNICAL | `supplier-recovery` | BLOCKED | 1/2 passed, 0 failed, 1 not run | 06:59:11–06:59:16 | `20261028T065910-2b5416ec92f2` | TC-133 NOT_RUN |
| TECHNICAL | `supplier-release-operations` | BLOCKED | 2/5 passed, 0 failed, 3 not run | 06:59:17–06:59:23 | `20261028T065916-9f6661f1472f` | TC-134 NOT_RUN, TC-135 NOT_RUN, TC-136 NOT_RUN |
| TECHNICAL | `supplier-performance` | BLOCKED | 4/5 passed, 0 failed, 1 not run | 06:59:24–07:10:28 | `20261028T065924-ff2600591596` | TC-128 NOT_RUN |
| REGRESSION | `supplier-server-integration` | PASS | 732/732 passed, 0 failed, 0 not run | 07:10:29–07:13:00 | `20261028T071029-834b3ecdfd95` |  |
| REGRESSION | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 07:13:01–07:13:13 | `20261028T071301-8a0d51f33c24` |  |
| REGRESSION | `supplier-security` | PASS | 732/732 passed, 0 failed, 0 not run | 07:13:14–07:15:39 | `20261028T071313-13f3281c06c6` |  |
| REGRESSION | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 07:15:40–07:15:43 | `20261028T071539-3e85ac9f897a` |  |
| REGRESSION | `supplier-resilience` | BLOCKED | 3/5 passed, 0 failed, 2 not run | 07:15:44–07:16:15 | `20261028T071544-09ecbbce124f` | TC-130 NOT_RUN, TC-132 NOT_RUN |
| REGRESSION | `supplier-recovery` | BLOCKED | 1/2 passed, 0 failed, 1 not run | 07:16:15–07:16:20 | `20261028T071615-2f7ec49f38e6` | TC-133 NOT_RUN |
| REGRESSION | `supplier-release-operations` | BLOCKED | 2/5 passed, 0 failed, 3 not run | 07:16:21–07:16:27 | `20261028T071621-93cd1dd5d37e` | TC-134 NOT_RUN, TC-135 NOT_RUN, TC-136 NOT_RUN |
| REGRESSION | `supplier-performance` | BLOCKED | 4/5 passed, 0 failed, 1 not run | 07:16:28–07:27:46 | `20261028T071628-f0de8491fc9a` | TC-128 NOT_RUN |

**DEF-048 re-test (HD-153 A), at both stages:**
- **TC-101 passes:**
  - online error rate 0 during the import;
  - the import applied 10,000 of 10,000, inside the window: precheck plus execute 78.1 s and 83.7 s (execute alone 71.8 s and 77.4 s);
  - `db.no_deadlocks_during_import` is 0.
- **TC-128's `db.no_deadlocks_mixed_load` is 0.**
- **The online server's kept warnings** hold no `supplier.write.deadlock_retried`, only `supplier.import.disabled`. The import worker is a separate process and keeps no warnings file; the deadlock counter covers both.
- **Deadlocks elsewhere:** the instance-wide counter rose from 314 to 341 during the session.
  - The 314 is a manual query just before the runs; it is not in the run evidence.
  - Across every performance load the counter stayed flat (325→325 at TECHNICAL, 341→341 at REGRESSION), which the run evidence records.
  - REV-134 attributed the 27 from the mysqld error log, read-only; the log lives in the session scratchpad, so this is an observation, not evidence:
    - all 27 are in `erp_t51` or the migration-test schemas `erp_t51_mig_*`;
    - their fixtures are `supplierDeadlockRetry`'s and `supplierConstraintRaces'`, which provoke deadlocks on purpose;
    - per stage they come to 11 and 16, the two counter deltas;
    - none touch `supplier_name_grams`, and none are in a performance schema.
- **DEF-048 is CLOSED.** The closure evidence:
  - the targeted re-test: the two performance runs;
  - the impact regression: the Supplier server suite and `supplier-security` at both stages;
  - PR #298 and its CI (run 40645193058, 13 of 13).

**Gate at `151aedf8`** (state revision 470): `verify_gate --gate TECHNICAL_ACCEPTANCE` is BLOCKED on:
- `TASK_INCOMPLETE` TASK-051;
- the NOT_RUN production parts of TC-128, TC-130, TC-132, TC-133, TC-134, TC-135 and TC-136, at both stages.

There is nothing else. As before, committing this evidence moves HEAD, so the gate will add `COMMIT_CHANGED` and `EVIDENCE_COMMIT` at later commits (REV-131 R2).

**DEF-034** stays OPEN. Both re-test imports applied 10,000 of 10,000, and the link to DEF-048 remains unproven.

**DEF-049** (LOW, found after this report, 2026-10-29): each import row transaction locks every row the job has already applied. It adds about 11 s to a 10,000-row import, so TC-101's results above stand. The route is HD-154. See `04_defect_register.md`.

## First run (2026-10-28, `a98e50e7`) — kept as history

**Result: Technical Acceptance NOT complete.** `verify_gate --gate TECHNICAL_ACCEPTANCE` is BLOCKED. Run at `7bbf547d` with state revision 459, just after the runs, it reported the three reasons below. At later commits it reports more; see "Why the gate is BLOCKED". UAT was not executed, because Technical Acceptance does not permit it. The business UAT, sign-offs and the release decision are not affected by this report; none of them has happened.

- **Mode:** `TEST_AND_VERIFY` (HD-149 A), product code `REPORT_ONLY`.
  - The mode change used the checkpoint's external-import clause, which checks PLAN_READY rather than READY_FOR_TESTING. READY_FOR_TESTING would fail on `TASK_INCOMPLETE` TASK-051.
  - HD-149 A authorized entering TEST_AND_VERIFY with TASK-051 open (REV-131 O2).
- **Baseline:**
  - Mode entry commit: `a98e50e7`, the PR #295 merge.
  - The runs were made at `7bbf547d`, which adds the ledger only (`git diff a98e50e7 7bbf547d -- server client package.json package-lock.json` is empty).
  - Design baseline `2390e6fc`, plan baseline `598f012b`.
- **Environment (`supplier-isolated-test`):**
  - A throwaway mysqld 26.7.0 on 127.0.0.1:3450, with a scratch datadir and `--skip-log-bin`.
  - Node v26.6.0.
  - Synthetic data only; the runners create and drop their own `erp_t51_rh_*` schemas.
  - Before each performance run, the statement digest table was emptied, as `performance_report.md` requires.
  - **The host was not quiescent.** Another module's mysqld (the Sales capacity runtime, started 08:51 HKT) ran on the same machine. The load averages recorded by the performance runner:

    | Run | Start (1, 5, 15 min) | End (1, 5, 15 min) |
    | --- | --- | --- |
    | TECHNICAL | 3.1, 3.6, 3.8 | 8.4, 7.1, 5.9 |
    | REGRESSION | 4.1, 4.7, 5.1 | 11.9, 9.9, 8.0 |

  - **The environment's written authorization** (`00_project_profile.json`, `environment.authorization_ref`, 2026-09-15) names `erp_dev` on port 3306. These runs used the throwaway instance on 3450 instead. It is more isolated, but the text does not literally cover it. Changing the profile would move the plan baseline, so this is stated here instead (REV-131).
- **Runs:** every required technical suite at TECHNICAL, then again at REGRESSION (HD-151 A). Each run is a real execution through `run_check.py --execute`; no report was copied.

### Results

| Stage | Suite | Result | Tests | Time (UTC) | Evidence (`evidence/…/run.json`) | Cases not passed |
| --- | --- | --- | --- | --- | --- | --- |
| TECHNICAL | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 03:05:49–03:06:00 | `20261028T030549-e436dd8c8e0e` |  |
| TECHNICAL | `supplier-server-integration` | PASS | 730/730 passed, 0 failed, 0 not run | 03:06:19–03:08:46 | `20261028T030619-93214fa82680` |  |
| TECHNICAL | `supplier-security` | PASS | 730/730 passed, 0 failed, 0 not run | 03:08:47–03:11:06 | `20261028T030846-6e37409ee932` |  |
| TECHNICAL | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 03:11:07–03:11:13 | `20261028T031107-5a60930937d7` |  |
| TECHNICAL | `supplier-resilience` | BLOCKED | 3/5 passed, 0 failed, 2 not run | 03:11:13–03:11:43 | `20261028T031113-f62b26dcfead` | TC-130 NOT_RUN, TC-132 NOT_RUN |
| TECHNICAL | `supplier-recovery` | BLOCKED | 1/2 passed, 0 failed, 1 not run | 03:11:43–03:11:48 | `20261028T031143-82e03aedafcb` | TC-133 NOT_RUN |
| TECHNICAL | `supplier-release-operations` | BLOCKED | 2/5 passed, 0 failed, 3 not run | 03:11:49–03:11:54 | `20261028T031148-f1db966ec506` | TC-134 NOT_RUN, TC-135 NOT_RUN, TC-136 NOT_RUN |
| TECHNICAL | `supplier-performance` | BLOCKED | 4/5 passed, 0 failed, 1 not run | 03:11:55–03:23:01 | `20261028T031155-3985c6786392` | TC-128 NOT_RUN |
| REGRESSION | `supplier-server-integration` | PASS | 730/730 passed, 0 failed, 0 not run | 03:23:02–03:25:23 | `20261028T032301-7b6667f1694c` |  |
| REGRESSION | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 03:25:24–03:25:36 | `20261028T032524-7dca7b3aef27` |  |
| REGRESSION | `supplier-security` | PASS | 730/730 passed, 0 failed, 0 not run | 03:25:37–03:28:08 | `20261028T032537-ea993c5503a9` |  |
| REGRESSION | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 03:28:08–03:28:12 | `20261028T032808-13d6884a8eec` |  |
| REGRESSION | `supplier-resilience` | BLOCKED | 3/5 passed, 0 failed, 2 not run | 03:28:13–03:28:43 | `20261028T032813-509e90dc36cf` | TC-130 NOT_RUN, TC-132 NOT_RUN |
| REGRESSION | `supplier-recovery` | BLOCKED | 1/2 passed, 0 failed, 1 not run | 03:28:44–03:28:49 | `20261028T032844-d9c9a99ea4cd` | TC-133 NOT_RUN |
| REGRESSION | `supplier-release-operations` | BLOCKED | 2/5 passed, 0 failed, 3 not run | 03:28:50–03:28:57 | `20261028T032850-0bf8ad538455` | TC-134 NOT_RUN, TC-135 NOT_RUN, TC-136 NOT_RUN |
| REGRESSION | `supplier-performance` | **FAIL** | 3/5 passed, 1 failed, 1 not run | 03:28:58–03:40:37 | `20261028T032858-19847f4da7f2` | **TC-101 FAIL**, TC-128 NOT_RUN |

The resilience, recovery and release-operations result JSONs are byte-identical across the two stages, because they hold only case names and statuses. Their stdout reports differ: other restore schemas, backup bytes and timestamps.

How to read the BLOCKED rows: every local part passed. Each of those cases also has a production part that the runner reports NOT_RUN (HD-117 A, HD-119 A). The case therefore cannot pass, so the suite is BLOCKED and not PASS. Those parts are group C in `06_task051_completion_boundary.md`.

### Why the gate is BLOCKED

At `7bbf547d` (state revision 459):

1. **`TASK_INCOMPLETE` TASK-051.** Groups B and C are open by decision. This is not a test result.
2. **Production parts NOT_RUN, by design:** TC-128, TC-130, TC-132, TC-133, TC-134, TC-135 and TC-136. They need a production-like environment, Operations, and the release gate itself (TC-136).
3. **TC-101 FAIL at REGRESSION — DEF-048.** Two checks failed:
   - **Online Supplier create:** HTTP 500 for 6 of 291 requests during the 10,000-row import (2.06%, limit 1%).
   - **`import.inside_measured_window`:** the import ended about 3 seconds after the load window closed. It took 114.6 s, against 66.3 s at TECHNICAL, on the busier host.

   The import itself applied 10,000 of 10,000, and the TECHNICAL run 17 minutes earlier passed on the same code.

   The likely cause is a deadlock on `supplier_name_grams` that survives the single DEF-031 retry:
   - InnoDB captured it inside this run's import, in this run's schema. The section is kept in `def048_innodb_deadlock_2026-10-28.txt`.
   - The supremum lock comes from the gram replacement's `DELETE` on a brand-new Supplier id, under REPEATABLE READ.
   - The light transaction, the online create, was rolled back.

   No single 500 is tied to it yet, because the benchmark deletes its server logs. The link to DEF-034 is weak. See `04_defect_register.md`.

   REPORT_ONLY: no product change. HD-152 A: diagnose first.

At any later commit the gate reports more issues, besides these three:
- `COMMIT_CHANGED`: committing the evidence moved HEAD;
- `EVIDENCE_COMMIT` for all 16 runs, because each run's `code_commit` must equal HEAD;
- `HUMAN_DECISION_REQUIRED` while HD-152 was open.

The result: **these 16 runs can never satisfy the gate at a later commit.** The final Technical Acceptance needs fresh runs at the commit that is then frozen. That is the fixed point described in the harness: recording evidence in the repository moves the commit it is bound to (REV-131 R2).

The plan recorded an expectation before the runs: that running both stages would let the gate pass. That was wrong. Reasons 1 and 2 were known in advance, so they block the gate whichever way the runs come out. What HD-151 A bought is real evidence at both stages, and with it the intermittent DEF-048.

### What this establishes

- Server unit and integration, security and Bank security, and client UI: the formal contract (count, skips, not-run, required IDs) **passes at both stages** on the mode entry baseline.
- Resilience, recovery, release operations and performance: their local parts pass at both stages, except TC-101 at REGRESSION.
- **TC-085 and TC-129** (for-SKU at 100k under 50 users; the duplicate cap, plans and counts) pass at both stages.
- The deployment smoke suites (`supplier-deployment-check`, `supplier-deployment-copy`) were not run. They are not required, and a run here would be a local rehearsal only (REV-130 O2, O3).

### Not done

- **UAT execution** (`supplier-uat-browser`): not run, because Technical Acceptance does not permit it. A limited diagnostic UAT would need explicit authorization.
- **Business acceptance and release approval:** not given.

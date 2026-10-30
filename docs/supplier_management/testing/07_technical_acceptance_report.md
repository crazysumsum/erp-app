# Supplier Management — Technical Acceptance report (2026-10-28, re-tested 2026-10-29 and 2026-10-30)

## Formal run on the HD-157 baseline (2026-10-30, current result)

**Result: Technical Acceptance NOT complete.**
- **DEF-050 is closed.** TC-085 passed against NFR-005's 3 s at both stages. The for-SKU p95 was 1,737 ms at TECHNICAL and 1,818 ms at REGRESSION.
- **A new formal failure:** at REGRESSION, TC-101 failed `online.p95_under_2s_during_import`. During the import, `update` p95 was 2,286 ms and `list.missingFilter` 2,011 ms, against 2,000 ms.
  - The same code passed at TECHNICAL, at 820 ms and 1,443 ms.
  - Everything else in TC-101 passed at both stages. The import took 57.8 s and 63.5 s, every row was applied exactly once, and there were no deadlocks.
  - It is registered as **DEF-051**. Since PR #301, every formal run is close to the limit; see the register.
  - HD-158 was answered: a REPORT_ONLY diagnosis was started (A) and then stopped by the Product Owner before it measured anything. Then: "TC-101 改要求放寬至5秒就好了". The plan revision follows; DEF-051 closes when TC-101 passes against 5 s.
- **release-operations** is BLOCKED at both stages only by TC-136 (the release gate), which is NOT_RUN by design. TC-134 and TC-135 passed.
- **Otherwise the gate is blocked by what was known before:** TASK-051 group B is open.
- UAT was not executed. Business acceptance and release approval have not happened.

**Baseline:**
- The mode entry commit is `6d84ee45`, the PR #305 merge (HD-157).
- The runs were made at `309aa9eb`, which adds ledger only. Every run records `code_unchanged` and `spec_unchanged` as true.
- The plan baseline is `8b31fcdd` and the design baseline `22865f96`.

**Environment:**
- The same throwaway mysqld 3450 (MySQL 26.7.0). The runner script refused to start unless all five settings were as required, and they were: `innodb_deadlock_detect` ON, `innodb_print_all_deadlocks` ON, and the three 16,384 digest and SQL-text settings.
- Other agents' mysqld instances were running on the host and were left alone.
- Load averages recorded by the performance runner: 3.9→11.4 at TECHNICAL, 3.5→13.9 at REGRESSION. The runner's own load accounts for most of the rise in every run: the six earlier formal runs ended at 8.4–11.9 (3.1→8.4, 4.1→11.9, 5.1→10.5, 3.4→11.0, 3.3→9.4, 3.3→9.1). 13.9 is the highest end value of all eight runs, but these numbers do not show whether other load was present.

**Runs:** the 8 required suites at TECHNICAL, then at REGRESSION (HD-151 A suite set), from 03:24Z to 04:00Z, each a real `run_check --execute`.

| Stage | Suite | Result | Tests | Time (UTC) | Evidence (`evidence/…/run.json`) | Cases not passed |
| --- | --- | --- | --- | --- | --- | --- |
| TECHNICAL | `supplier-server-integration` | PASS | 735/735 passed, 0 failed, 0 not run | 03:24:21–03:26:55 | `20261030T032421-002040bd2fd9` |  |
| TECHNICAL | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 03:26:56–03:27:08 | `20261030T032656-34275715e091` |  |
| TECHNICAL | `supplier-security` | PASS | 735/735 passed, 0 failed, 0 not run | 03:27:09–03:29:36 | `20261030T032708-7195a5ce235a` |  |
| TECHNICAL | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 03:29:37–03:29:42 | `20261030T032937-1f94f5848892` |  |
| TECHNICAL | `supplier-resilience` | PASS | 3/3 passed, 0 failed, 0 not run | 03:29:43–03:30:12 | `20261030T032943-c484462380ea` |  |
| TECHNICAL | `supplier-recovery` | PASS | 1/1 passed, 0 failed, 0 not run | 03:30:13–03:30:18 | `20261030T033013-cf861b6a86a3` |  |
| TECHNICAL | `supplier-release-operations` | BLOCKED | 2/3 passed, 0 failed, 1 not run | 03:30:19–03:30:26 | `20261030T033019-f3eb920f33b4` | TC-136 NOT_RUN |
| TECHNICAL | `supplier-performance` | PASS | 4/4 passed, 0 failed, 0 not run | 03:30:27–03:41:52 | `20261030T033026-b856fe2963d2` |  |
| REGRESSION | `supplier-server-integration` | PASS | 735/735 passed, 0 failed, 0 not run | 03:41:53–03:44:28 | `20261030T034152-08fd4a1f2f00` |  |
| REGRESSION | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 03:44:30–03:44:42 | `20261030T034429-8f5306e957ed` |  |
| REGRESSION | `supplier-security` | PASS | 735/735 passed, 0 failed, 0 not run | 03:44:43–03:47:22 | `20261030T034443-a6489778b4f0` |  |
| REGRESSION | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 03:47:23–03:47:29 | `20261030T034723-8f82647fe185` |  |
| REGRESSION | `supplier-resilience` | PASS | 3/3 passed, 0 failed, 0 not run | 03:47:30–03:48:02 | `20261030T034729-dca35ef45afa` |  |
| REGRESSION | `supplier-recovery` | PASS | 1/1 passed, 0 failed, 0 not run | 03:48:03–03:48:10 | `20261030T034802-0c3c0f91d809` |  |
| REGRESSION | `supplier-release-operations` | BLOCKED | 2/3 passed, 0 failed, 1 not run | 03:48:11–03:48:18 | `20261030T034810-14d1ccd1c16d` | TC-136 NOT_RUN |
| REGRESSION | `supplier-performance` | FAIL | 3/4 passed, 1 failed, 0 not run | 03:48:19–03:59:55 | `20261030T034819-b8b65bdb3861` | TC-101 FAIL |

**Performance numbers** (from each run's `supplier-performance-details/`):

| | TECHNICAL | REGRESSION | Limit |
| --- | --- | --- | --- |
| TC-085 for-SKU p95, all operations | 1,737 ms | 1,818 ms | 3,000 ms |
| TC-101 precheck + execute | 57.8 s | 63.5 s | 600 s |
| TC-101 online during import, `update` p95 | 820 ms | **2,286 ms** | 2,000 ms |
| TC-101 online during import, `list.missingFilter` p95 | 1,443 ms | **2,011 ms** | 2,000 ms |
| TC-101 online during import, all operations p95 | 486 ms | 739 ms | — |
| Deadlocks (mixed load / during import) | 0 / 0 | 0 / 0 | 0 |

## Re-test after the DEF-049 fix (2026-10-29) — kept as history

> **2026-10-30, HD-157:** the HD-156 E path below (re-measure TC-085 in a production-like environment) is superseded. NFR-005 is now 3 s, and the C-group production parts are waived, with the local results standing.

**Result: Technical Acceptance NOT complete.**
- **DEF-049 is closed.**
- **A new formal failure:** TC-085 failed at TECHNICAL. The for-SKU name search p95 was 2,113 ms against a 2,000 ms limit.
  - It passed at REGRESSION, at 1,937 ms.
  - It is registered as **DEF-050**. A REPORT_ONLY diagnosis was done under HD-155 A.
  - HD-156 was answered E: re-measure TC-085 in the production-like environment, then choose the remedy. DEF-050 stays OPEN.
- **Otherwise the gate is blocked only by what was known before:** TASK-051 is open, and the production parts are NOT_RUN by design.
- UAT was not executed. Business acceptance and release approval have not happened.

**Baseline:**
- The mode entry commit is `4f101642`, the PR #301 merge with the fix.
- The runs were made at `558adc22`, which adds ledger only. Every run records `code_unchanged` and `spec_unchanged` as true.
- The plan baseline `598f012b` and the design baseline `2390e6fc` are unchanged.

**Environment:**
- The same throwaway mysqld. The runner script refused to start unless all five settings were as required, and they were:
  - `innodb_deadlock_detect` ON;
  - `innodb_print_all_deadlocks` ON;
  - the three 16,384 digest and SQL-text settings.
- Other modules' mysqld instances (Fulfillment, Sales) were running on the host and were left alone.
- Load averages recorded by the performance runner: 3.3→9.4 at TECHNICAL, 3.3→9.1 at REGRESSION.

**Runs:** the 8 required suites at TECHNICAL, then at REGRESSION, as for DEF-048 (HD-151 A, HD-154 A). They ran from 03:38Z to 04:13Z, each a real `run_check --execute`.
- A first attempt at 03:37Z was refused before any test ran, because the state's `code_commit` was not yet HEAD. Every one of its 16 calls returned `COMMIT_CHANGED` and wrote no evidence. The state was then bound to HEAD, as for DEF-048.

| Stage | Suite | Result | Tests | Time (UTC) | Evidence (`evidence/…/run.json`) | Cases not passed |
| --- | --- | --- | --- | --- | --- | --- |
| TECHNICAL | `supplier-server-integration` | PASS | 735/735 passed, 0 failed, 0 not run | 03:38:24–03:41:02 | `20261029T033823-87bd1a75ca35` |  |
| TECHNICAL | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 03:41:03–03:41:17 | `20261029T034103-e20171261f69` |  |
| TECHNICAL | `supplier-security` | PASS | 735/735 passed, 0 failed, 0 not run | 03:41:18–03:43:40 | `20261029T034118-6686b68cd58e` |  |
| TECHNICAL | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 03:43:41–03:43:47 | `20261029T034341-cc8de2b7e750` |  |
| TECHNICAL | `supplier-resilience` | BLOCKED | 3/5 passed, 0 failed, 2 not run | 03:43:48–03:44:17 | `20261029T034347-e6864cd3e14d` | TC-130 NOT_RUN, TC-132 NOT_RUN |
| TECHNICAL | `supplier-recovery` | BLOCKED | 1/2 passed, 0 failed, 1 not run | 03:44:18–03:44:23 | `20261029T034418-b2d35dd80b42` | TC-133 NOT_RUN |
| TECHNICAL | `supplier-release-operations` | BLOCKED | 2/5 passed, 0 failed, 3 not run | 03:44:24–03:44:30 | `20261029T034423-4f9adc884706` | TC-134 NOT_RUN, TC-135 NOT_RUN, TC-136 NOT_RUN |
| TECHNICAL | `supplier-performance` | **FAIL** | 3/5 passed, 1 failed, 1 not run | 03:44:31–03:56:01 | `20261029T034431-5afc891c6c57` | **TC-085 FAIL** (DEF-050), TC-128 NOT_RUN |
| REGRESSION | `supplier-server-integration` | PASS | 735/735 passed, 0 failed, 0 not run | 03:56:02–03:58:24 | `20261029T035602-932188e8081e` |  |
| REGRESSION | `supplier-bank-security` | PASS | 142/142 passed, 0 failed, 0 not run | 03:58:25–03:58:36 | `20261029T035825-cec5377c54b6` |  |
| REGRESSION | `supplier-security` | PASS | 735/735 passed, 0 failed, 0 not run | 03:58:37–04:01:00 | `20261029T035837-74e13e27361b` |  |
| REGRESSION | `supplier-client-ui` | PASS | 208/208 passed, 0 failed, 0 not run | 04:01:01–04:01:05 | `20261029T040101-c18ff7e10b89` |  |
| REGRESSION | `supplier-resilience` | BLOCKED | 3/5 passed, 0 failed, 2 not run | 04:01:06–04:01:36 | `20261029T040105-a05fb177b6e8` | TC-130 NOT_RUN, TC-132 NOT_RUN |
| REGRESSION | `supplier-recovery` | BLOCKED | 1/2 passed, 0 failed, 1 not run | 04:01:36–04:01:41 | `20261029T040136-8192fee4677f` | TC-133 NOT_RUN |
| REGRESSION | `supplier-release-operations` | BLOCKED | 2/5 passed, 0 failed, 3 not run | 04:01:42–04:01:48 | `20261029T040142-0d55c6f0c0f0` | TC-134 NOT_RUN, TC-135 NOT_RUN, TC-136 NOT_RUN |
| REGRESSION | `supplier-performance` | BLOCKED | 4/5 passed, 0 failed, 1 not run | 04:01:49–04:13:01 | `20261029T040149-baed2fb7b585` | TC-128 NOT_RUN |

**DEF-049 re-test (HD-154 A), at both stages:**
- **TC-101 passes.**
  - The online error rate was 0 during the import.
  - The import applied 10,000 of 10,000, with an empty `notApplied` list.
  - Execute took 53.9 s and 51.2 s. Precheck plus execute took 60.5 s and 57.7 s.
  - The import ended 58.3 s and 61.1 s before the load window closed. At the DEF-048 re-test, which ran at a different time and load, the margins were 40.7 s and 35.1 s.
- **Deadlocks:** `db.no_deadlocks_mixed_load` and `db.no_deadlocks_during_import` are 0 at both stages, and the counter stayed flat across every performance load.
- **Impact regression:** `supplier-server-integration` and `supplier-security` pass 735 of 735 at both stages. That includes the three DEF-049 integration tests.
- **DEF-049 is CLOSED.** The closure evidence is the targeted re-test (TC-101 at both stages), the impact regression above, and PR #301's CI run 40810936200 (13 of 13).

**TC-085 failed at TECHNICAL (DEF-050).** The for-SKU load ran with 50 users at 100k Suppliers.
- **The two stages:**
  - TECHNICAL: `forSku.nameSearch` p95 2,113 ms against the 2,000 ms limit, p50 1,648 ms.
  - REGRESSION: p95 1,937 ms, which passed.
  - Every other for-SKU operation passed at both stages. The error rate was 0.
- **History:** every formal run's name-search p95 was 1,861, 1,991, 1,891 and 1,830 ms, then 2,113 and 1,937 ms. So the case has always passed by under 10%.
- **Not caused by DEF-049:** the fix changed only the import's row pick, and TC-085's load runs no import.
- **The cause is a capacity limit, from the diagnosis under HD-155 A and as corrected after REV-137.**
  - **Where the time goes:**
    - 35% is the exact `COUNT(*) total` of a `q` search. This is its only full scan: unanchored `LIKE` over the roughly 80,000 active Suppliers.
    - 22% is the deep-`OFFSET` rest page without `q`, which MySQL sorts instead of reading the name index.
    - About 35% is the relation-driven head queries.
    - `q`-related statements total 60–62%.
  - **Saturation:** the pool of 10 is full from 25 users, at about 29 requests per second. At 50 users every operation queues.
  - **What does not help:** a pool of 20 reaches only 33/s, and a larger buffer pool changes nothing.
- The details are in `04_defect_register.md` (DEF-050) and `def050_diagnosis_2026-10-29/`. HD-156 answered E (defer to the production-like measurement).

**Gate at `558adc22`** (state revision 483): `verify_gate --gate TECHNICAL_ACCEPTANCE` is BLOCKED on:
- `TASK_INCOMPLETE` TASK-051;
- the NOT_RUN production parts of TC-128, TC-130, TC-132, TC-133, TC-134, TC-135 and TC-136, at both stages;
- **TC-085 at TECHNICAL** (DEF-050), which is new.

From state revision 484 to 487, while HD-156 was OPEN, the gate also reported `HUMAN_DECISION_REQUIRED` (REV-137 L2). From revision 488, after HD-156 was answered E, it no longer does (REV-138 L1). Committing this evidence moves HEAD, so at later commits the gate also reports `COMMIT_CHANGED` and `EVIDENCE_COMMIT` (REV-131 R2).

**DEF-034** stays OPEN. Both imports applied 10,000 of 10,000.

## Re-test after the DEF-048 fix (2026-10-28) — kept as history

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

**DEF-049** (LOW, found after this report, 2026-10-29): each import row transaction locks every row the job has already applied. It adds about 11 s to a 10,000-row import on a quiet host.
- TC-101's results above stand: the re-test imports ended 40.7 s and 35.1 s before the load window closed.
- It plausibly contributed to the first run's 2.9 s window miss (not proven), and it leaves TC-101's window check exposed on a slower host.
- The route is HD-154. See `04_defect_register.md`.

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

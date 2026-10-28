# Supplier Management — Technical Acceptance report (2026-10-28)

**Result: Technical Acceptance NOT complete.** `verify_gate --gate TECHNICAL_ACCEPTANCE` is BLOCKED for the three reasons below. UAT was not executed, because Technical Acceptance does not permit it. The business UAT, sign-offs and the release decision are not affected by this report; none of them has happened.

- **Mode:** `TEST_AND_VERIFY` (HD-149 A), product code `REPORT_ONLY`.
- **Baseline:**
  - Mode entry commit: `a98e50e7`, the PR #295 merge.
  - The runs were made at `7bbf547d`, which adds the ledger only (`git diff a98e50e7 7bbf547d -- server client package.json package-lock.json` is empty).
  - Design baseline `2390e6fc`, plan baseline `598f012b`.
- **Environment (`supplier-isolated-test`):**
  - A throwaway mysqld 26.7.0 on 127.0.0.1:3450, with a scratch datadir and `--skip-log-bin`.
  - Node v26.6.0.
  - Synthetic data only; the runners create and drop their own `erp_t51_rh_*` schemas.
  - Before each performance run, the statement digest table was emptied, as `performance_report.md` requires.
- **Runs:** every required technical suite at TECHNICAL, then again at REGRESSION (HD-151 A). Each run is a real execution through `run_check.py --execute`; no report was copied.

## Results

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

How to read the BLOCKED rows: every local part passed. Each of those cases also has a production part that the runner reports NOT_RUN (HD-117 A, HD-119 A). The case therefore cannot pass, so the suite is BLOCKED and not PASS. Those parts are group C in `06_task051_completion_boundary.md`.

## Why the gate is BLOCKED

1. **`TASK_INCOMPLETE` TASK-051.** Groups B and C are open by decision. This is not a test result.
2. **Production parts NOT_RUN, by design:** TC-128, TC-130, TC-132, TC-133, TC-134, TC-135 and TC-136. They need a production-like environment, Operations, and the release gate itself (TC-136).
3. **TC-101 FAIL at REGRESSION — DEF-048.**
   - While the 10,000-row import ran, online Supplier create answered HTTP 500 for 6 of 291 requests (2.06%, limit 1%). The import itself applied 10,000 of 10,000.
   - The TECHNICAL run 17 minutes earlier passed on the same code.
   - Evidence points to a deadlock on `supplier_name_grams` that survives the single DEF-031 retry. It is not proven, because the benchmark deletes its server logs.
   - The same mechanism is a possible cause of DEF-034. See `04_defect_register.md`.
   - REPORT_ONLY: no product change. The severity (MEDIUM, proposed) and the route are put to the Product Owner.

The plan recorded an expectation before the runs: that running both stages would let the gate pass. That was wrong. Reasons 1 and 2 were known in advance, so they block the gate whichever way the runs come out. What HD-151 A bought is real evidence at both stages, and with it the intermittent DEF-048.

## What this establishes

- Server unit and integration, security and Bank security, and client UI: the formal contract (count, skips, not-run, required IDs) **passes at both stages** on the mode entry baseline.
- Resilience, recovery, release operations and performance: their local parts pass at both stages, except TC-101 at REGRESSION.
- **TC-085 and TC-129** (for-SKU at 100k under 50 users; the duplicate cap, plans and counts) pass at both stages.
- The deployment smoke suites (`supplier-deployment-check`, `supplier-deployment-copy`) were not run. They are not required, and a run here would be a local rehearsal only (REV-130 O2, O3).

## Not done

- **UAT execution** (`supplier-uat-browser`): not run, because Technical Acceptance does not permit it. A limited diagnostic UAT would need explicit authorization.
- **Business acceptance and release approval:** not given.

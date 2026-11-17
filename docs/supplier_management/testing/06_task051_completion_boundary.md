# TASK-051 — completion boundary (2026-10-27)

TASK-051 (T51: deployment, smoke, regression and Release Gate) is **not complete**. Formal UAT is NOT_RUN, and the release is **not approved**. This page splits what remains into three groups. The split sets delivery boundaries; it does not reduce scope. Every case, data volume, performance threshold, coverage floor, CI check and independent review still applies. **Exception, HD-157 (2026-10-30):** the Product Owner reduced the scope. C-group production parts are waived (the local results stand), and NFR-005 (for-SKU) is 3 s. The residual risk is in `release_evidence.md`'s known limitations.

- **A — Supplier self-verification:** what the Supplier module can prove by itself. It is done for main `38f05ba6`, and can be delivered on its own.
- **B — downstream integration:** cases that need other modules' screens, documents or references. They are kept as written, with their assertions, and stay BLOCKED / NOT_RUN.
- **C — operations, harness and formal release acceptance:** production-like environments, named roles, the harness's formal stages, sign-offs and the release decision.

**Candidate:** main `38f05ba6`, the PR #291 merge.
- Its tree equals PR #291's head `a51a60b0`.
- Every run in A used that product code.
- The runs were made in a worktree at `db6298d3`, which adds ledger changes only.

**Evidence files:** the files A cites are in [`t51_evidence/`](t51_evidence/) and [`t51_rehearsal/`](t51_rehearsal/).
- The local paths in them are masked as `$WORKTREE` and `$SCRATCH`.
- Masking changes the bytes, so the committed server junit no longer hashes to the sha256 recorded at run time (`3ab29aa9…`).

## A. Supplier self-verification — done for `38f05ba6`

| What | Case IDs | Evidence on this candidate | Remaining |
| --- | --- | --- | --- |
| Server unit and integration (`supplier-server-integration`) | 89 required TC IDs | One run of the profile's argv, cwd and env, with `DB_INTEGRATION_TESTS=1` on MySQL 26.7.0, 2026-10-27 07:33:44–07:36:06Z, exit 0. 730 tests, 730 passed, 0 skipped, 0 not run (minimum 620); every required ID passed. Files: `supplier-server-integration.xml`, `three-suite-verdicts.json`. | none |
| Security (`supplier-security`) | TC-111…TC-120 | **The same run.** The argv is identical apart from the report file name, with the same cwd, env and data, so the same junit was judged against this suite's own rule: 730 of 730 (minimum 620); all 10 IDs passed. Not a separate execution. | none |
| Bank security (`supplier-bank-security`) | TC-062…TC-074, TC-076, TC-077 | **The same run,** limited to the `supplierBank*` files this suite's argv names: 142 of 142 (minimum 135); all 15 IDs passed. Not a separate execution: this suite's own argv was never run alone on this candidate. | none |
| Client UI (`supplier-client-ui`) | TC-013, 015, 029, 075, 121…127 | Profile argv: 208 of 208; all 11 IDs passed. Files: `supplier-client-ui.xml`, `cu.stdout`. | none |
| Resilience, local part | TC-130, 131, 132 (local) | Runner: all three local parts PASS. Files: `supplier-resilience.json`, `resilience.stdout`. | production parts → C |
| Recovery, local part | TC-133 (local) | Runner: full-module backup, isolated restore, table and file reconciliation, smoke, and fail-closed without the key ring all PASS. Files: `supplier-recovery.json`, `recovery.stdout`. | production drill → C |
| Release operations, local part | TC-134, 135 (local) | Runner: worker stop and takeover, fresh deployment, route and permission inventory, and separated-role smoke all PASS. Files: `supplier-release-operations.json`, `release-operations.stdout`. | production parts and TC-136 → C |
| Performance, local part | TC-085, 101, 128 (local), 129 | Runner, 100k Suppliers and 50 users. **Second run:** all four PASS. Mixed p95 239 ms; for-SKU worst case 1,480 ms; the 10,000-row import applied 10,000, with none not applied; no statement digests lost. Files: `supplier-performance.json`, `performance.stdout`. | production-like part → C |
| Performance, first run | same | **First run FAILED** on TC-085 and TC-129. The scratch instance's `performance_schema` digest table was full (10,000 of 10,000). Statements that went unattributed: 91,964 in the load phase, 32,662 in the for-SKU phase and 440,674 during the import, so the full-scan checks had nothing to judge. The table was truncated on that throwaway instance and the runner was run again. Kept as evidence, not discarded. TC-101 passed in both runs (10,000 of 10,000). Files: `supplier-performance-run1.json`, `performance-run1.stdout`. | none |
| Upgrade, backup/restore and rollback rehearsal (TC-006, design §14) | — | `t51_rehearsal/rehearsal-2026-10-27.log`, all checks passed. It covers four paths: pre-Supplier → current; older `72e205ef` → current, with backup and exact restore; the 0103 backfill compared row by row; and **rollback across 0103 to `e6398b70`**. That rollback refuses to start until the three manual statements in 0103's header are run; after them the old release starts and serves the rows, and rolling forward renumbers them. The script's controls were tightened after REV-128 (see that folder's README). | production rollback → C |
| UAT cases the Supplier can run (real backend) | 41 of 55: every UAT ID except those listed in B and C | **Two runs, together.** (1) The full UAT config at `67472ee6`: 41 passed, 14 skipped, every skip a `test.fixme` with a reason. (2) Then only `uat-cross-phase.spec.js` changed (REV-127 follow-ups), and that spec was re-run at `5ddfdb09`: 2 passed. Product code and every other spec are identical from `67472ee6` to `a51a60b0` (`git diff --stat 67472ee6 a51a60b0 -- server client` lists only that spec). Supplier steps of the B cases also run before their `test.fixme`. | none |
| Suite adapters and canonical IDs (T51 AC 2), developer part | every suite in `00_project_profile.json` | Each suite's junit or runner JSON above was judged by the harness's own `parse_results` and gate rule: count, skips, not-run, missing IDs. | formal `run_check` → C |
| CI on the candidate | required checks | PR #291 run 40465140671: 13 of 13 SUCCESS on `a51a60b0`. This PR's own head needs its own CI run. | this PR |
| Independent review | — | REV-113…REV-127 on the UAT and fix PRs. This page and the rehearsal change: REV-128, CHANGES_REQUESTED, every finding fixed (report 131). | this PR |

**Overlap rule used above.** One real execution satisfies several suites only when the source, command, cwd, env and data match.
- That holds for `supplier-security`, whose argv is identical, and for `supplier-bank-security`, which is a strict file subset of the same argv.
- Each suite was then judged by the harness's own `parse_results` and gate rule: count, skips, not-run and required IDs.
- `supplier-phase-001-server` is not equivalent, because its argv adds Business Master contract and migration files, so it is not claimed here. Those files run in CI's full server suite.

## B. Downstream integration dependencies — BLOCKED, not re-run

| Case IDs | What is missing | Supplier-side evidence | Owner | Unlocks when |
| --- | --- | --- | --- | --- |
| UAT-005; UAT-050 (referenced-identifier step) | A transaction that references the Supplier or identifier | The rest of UAT-050 passes | Purchasing / Receiving / AP owners | A reference checker provider is installed (HD-131 A) |
| UAT-016, UAT-024, UAT-029 (Buyer steps) | Purchasing's Supplier selector | Supplier steps pass (suspend; activate without term; activate without bank) | Purchasing owner | The Purchasing selector UI ships (HD-124 A) |
| UAT-032, UAT-033, UAT-034 | Buyer selector ranking and status refusal | 033: preferred relation added. 034: that Supplier suspended. 032: no Supplier step | Purchasing owner | Same as above |
| UAT-035 | A completed purchase creating a soft relation | none possible | Purchasing / Receiving owners | PO and receipt flow, with the supply-event call: Purchasing TASK-040 injects `verifySource` into its own `SupplierRelationService` instance; until then `recordSupply` answers 503 `SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE` |
| UAT-036 | Old PO keeps its Currency and Term snapshot | Defaults changed with a reason | Purchasing owner | PO snapshot exists |
| UAT-051 (open-matter and new-transaction steps) | Open matters and new transactions | Block steps pass | Purchasing / AP owners | Open-flow provider installed (HD-131 A) |
| UAT-053 (referenced Bank account) | A payment flow that references the account | Add, edit, default and deactivate pass | AP / payment owner | Payment references exist |
| Purchasing's pin of the Supplier design | Purchasing's manifest pinned `e49ac37d`, Supplier's 03 as of main `6d84ee45`, by 2026-11-06. TASK-052 (`findSkuRefsInTransaction`) merged in PR #350 (`2cf4d258`, 2026-11-10) and moved 03 | — | Purchasing owner | Purchasing re-pins once; no longer waiting on Supplier; raised as [#294](https://github.com/crazysumsum/erp-app/issues/294) |

These cases keep their original assertions. They are not re-run while the dependency is unchanged, and no fixture, skip or exception stands in for them.

## C. Operations, harness and formal release acceptance — open

| Item | Case IDs | Remaining | Owner | Unlocks when |
| --- | --- | --- | --- | --- |
| Representative volume and DR as UAT | UAT-044, UAT-045 (HD-144 B) | An operations representative at representative volume; a DR owner in an isolated restore with RTO ≤ 4 h and RPO ≤ 15 min | Operations, DR owner | Representative environment exists |
| Production-like performance | TC-128 (production part); TC-085 | Waived by HD-157 (2026-10-30): no production-like re-test; the local result stands. TC-085's limit is now 3 s (NFR-005). The next formal run on the HD-157 baseline measures it again, against 3 s; the DEF-049 re-test measured 2,113 and 1,937 ms. | — | Done (HD-157) |
| Production resilience | TC-130, TC-132 (production parts) | Waived by HD-157 (2026-10-30): no production-like re-test; the local result stands. | — | Done (HD-157) |
| Production restore drill | TC-133 (production part) | Waived by HD-157 (2026-10-30): no production-like re-test; the local result stands. The local restore measures seconds and RPO 0, which do not represent the production RTO ≤ 4 h and RPO ≤ 15 min. | — | Done (HD-157) |
| Production deployment | TC-134, TC-135 (production parts) | Waived by HD-157 (2026-10-30): no production-like re-test; the local result stands. | — | Done (HD-157) |
| Rollback across 0103 in production | TC-006 (production) | The production rehearsal is waived by HD-157; the local rehearsal stands. Still open: a rollback to a release before 0103 needs a maintenance window and the three statements in 0103's header (rehearsed locally in A). The order users set is lost. Rolling forward renumbers the rows in display order. The runbook must say so, and the loss must be accepted. | Operations (runbook), Product Owner (accept the loss) | `operations.md` written; release review |
| Production-like UI smoke (T51 Verification 3) | — | Waived by HD-157 (2026-10-30): no production-like re-test; the local result stands. The local UAT runs in A covered these flows on the developer stack. | — | Done (HD-157) |
| T51 deliverables (T51 AC 1, AC 3) | — | Drafts exist: `operations.md` (runbook, rollback boundary, Bank key dependency), `release_evidence.md` (sign-off sheet), and `smokeSupplierManagement.js` (HD-148 B: `check` read-only on the deployed environment, `copy` write smoke on a restored copy; rehearsed locally only). The profile has `supplier-deployment-check` and `supplier-deployment-copy` since HD-149 A (12d52ff3); a formal run of them in the isolated environment is a local rehearsal only. Remaining: Operations' review of the drafts. Running both smoke modes on a production-like environment is waived by HD-157; the local rehearsal stands. | Supplier (drafts); Operations (review and runs) | Before release sign-off |
| Harness formal evidence (T51 AC 2, formal part) | all suites | Formal `run_check` at TECHNICAL and REGRESSION ran on 2026-10-28 and 2026-10-29 (`07_technical_acceptance_report.md`). HD-157 moves the plan baseline, so that evidence is stale: a fresh formal run on the HD-157 baseline is open. Since then the HD-164 baselines (TASK-052, TC-137) and HD-165 (below) moved it again. The run needs the current plan approved and a local MySQL slot from the PM. `supplier-performance` waits until after UAT. | Supplier | HD-165 merged, plan approved, DB slot |
| Consumed-contract pins (HD-147 B) | — | Refreshed under HD-149 A (12d52ff3): Item added DES-022, a Receiving provider; Purchasing changed its Inventory reversal provider. Neither touches a contract Supplier consumes (REV-130). The approvals were re-recorded on the new baselines. | Supplier | Done on merge of the baseline refresh PR |
| Release gate | TC-136 | `verify_gate` over the candidate's CI and suite evidence, open P0/P1 cases and defects, and the Product Owner's GO | Product Owner, QA | All of the above |
| Business UAT | UAT-001…UAT-055 | Execution by the business roles; 07's Status stays NOT_RUN until then. Automation PASS is not business acceptance. | BA / Product Owner | Formal UAT window |
| Sign-offs and release approval (T51 AC 4) | — | BA/Product Owner, Technical Lead, QA, Security and Operations; a separate release approval | Those roles | After everything above |
| 07 amendments | UAT-037, 038, 043, 044, 046, 047, 055 | Done: HD-145 A and HD-146 A under HD-149 A; REV-130 N3 and N6, and UAT-044's 3 s for SKU selection, under HD-157 (2026-10-30). | — | Done |
| Deferred defects (risk-approved, HD-116) | DEF-004, 007, 008, 012, 013, 014, 015, 016, 017, 018, 019, 023 | Accept or close at release | Product Owner | Release review |

## HD-165 — capacity cases deferred from the formal functional suites (2026-11-10)

`supplier-server-integration` and `supplier-security` run every `test/supplier*.test.js` and `test/integration/supplier*.integration.test.js`. Seven cases in those files are listed in the CI capacity catalog (`.github/scripts/capacity-cases.mjs`). AGENTS.md defers capacity until after UAT. As written, a formal run would execute them.

The Product Owner chose option A on 2026-11-10 ('A，照建議改 profile'):
- Both suites now run through `npm test` in `server/`. That script adds `--test-skip-pattern` from `capacity-runner.mjs server-pattern`, the same exclusion CI uses.
- `max_skipped` stays 0 in both suites. Every other value is unchanged as well: 90 and 10 required IDs, `min_tests` 620, and the coverage floors. Node 26 leaves a test that matches `--test-skip-pattern` out of the report entirely. It is not counted as skipped, and the junit `tests` total drops. So the exclusion needs no skip allowance, and any skip in the run still fails it. HD-165 first set `max_skipped` to 7 on the wrong assumption that the seven would be reported as skipped. That value would have let seven other cases skip, so it was put back to 0 before merge.
- No case is deleted and no assertion changes. The seven cases run after UAT, on main, by explicit dispatch with a grant (`docs/ci-capacity-routing.md`). Owner: Supplier.

| Capacity ID | File | Case |
| --- | --- | --- |
| audit-16 | `integration/supplierDuplicateCandidates.integration.test.js` | TASK-050 (HD-084): the bounded search returns what comparing every Supplier would, among names full of common grams |
| audit-17 | `integration/supplierImport.integration.test.js` | TASK-043 (REV-064 H-2, IMP-003): a 10,000-row file finishes precheck against 2,000 Suppliers well inside the job timeout |
| audit-18 | `integration/supplierImport.integration.test.js` | TASK-045 (HD-048 3): each row, job lock included, finishes far inside DB_TRANSACTION_TIMEOUT_MS |
| audit-19 | `integration/supplierSimilarNameReport.integration.test.js` | HD-057 A: thousands of identical or near-identical names finish with bounded output |
| audit-20 | `integration/supplierSkuRelations.integration.test.js` | TASK-038 (REV-086 M-1): creates and first projections above the pool size all succeed |
| audit-27 | `supplierCsvSchema.test.js` | a file of 10 MB of commas is refused quickly at upload and at precheck (REV-066 M-1) |
| audit-28 | `supplierCsvSchema.test.js` | precheck lets the event loop run while it parses a large file (REV-067 L-1) |

Limits and how a formal run shows the exclusion:
- Mechanical. The harness rejects duplicate runner names. A TC/UAT ID may map to several cases, so each required ID is judged on its aggregate result, which takes the worst status of its cases and must be PASS. The run needs at least 620 executed tests, counting passed plus failed. Reported skipped, not-run and failed counts must all be 0 (`max_skipped: 0`). `npm test` itself fails closed: `capacity-runner.mjs server-pattern` validates the catalog, and the script refuses an empty pattern.
- By review, because the harness cannot check this mapping. Whoever reviews the run checks four things together; any one alone is not enough:
  - the run's junit reports `skipped 0`;
  - none of the seven names below appears as a testcase in the junit;
  - at the run's commit, the pattern that `node .github/scripts/capacity-runner.mjs server-pattern` prints contains each of the seven names. `npm test` does not echo the expanded pattern, so the run's own log cannot show it;
  - the catalog at the run's commit still lists exactly these seven entries for the two globs.
- The evidence does not prove that a case missing from the junit was excluded by the pattern and not lost some other way. The four checks together narrow this down; a full proof would need a per-test inventory, which the harness does not produce.
- If the catalog gains or loses a Supplier case, this table changes with it. `max_skipped` stays 0.
- T51 AC 2's "skip fails the Gate" stands with no exception. The seven are excluded, not skipped.
- Order, per the PM's direction relayed in the Supplier chat on 2026-11-10 (session 486c4c60-92de-4122-b0e0-a68866140aa1): capacity stays after the relevant UAT and is not run earlier because the formal flow lists `supplier-performance` first; unrun items keep their real state and are never marked PASS. So the functional part of Technical Acceptance (the formal TECHNICAL and REGRESSION run without capacity) comes first, then formal UAT. These seven cases and `supplier-performance` run after UAT, and Technical Acceptance and TC-136 are complete only after that.

## DEF-034 — OPEN (LOW)

- **What happened:** on 2026-10-22, one 10,000-row import under load applied 9,999 rows. The job's counts stayed consistent, so the row was reported as failed, not lost. Every row in the file was a valid create.
- **Not reproduced:** every run since applied 10,000 of 10,000. That covers the later 2026-10-22 runs and both 2026-10-27 runs; T50's earlier runs did the same.
- **Cause unknown:** the first runner version deleted the tools' reports, so the failed row's stored error was lost.
- **Capture measures now in place:**
  - the runner keeps the tools' full reports in `supplier-performance-details/` next to its own output;
  - before the import tool deletes its job and rows, it records up to 20 not-applied rows with their stored errors (`report.notApplied`, HD-122 A);
  - the runner copies them into its own evidence (`evidence.import.notApplied`). Both 2026-10-27 runs recorded an empty list.
- **Status:** later passes are not a root cause and do not close the risk. DEF-034 stays OPEN until a recurrence shows the reason, or the Product Owner accepts the risk at release.

## DEF-049 — CLOSED (LOW, 2026-10-29)

- **What happens:** the import's row pick reads and locks every row the job has already applied, so the cost is O(n²) over an import.
- **Effect:**
  - about 11 s extra on a 10,000-row import on a quiet host, or about 4.75 minutes at the 50,000-row ceiling of `import.maxRows` (an extrapolation);
  - TC-101's window check had 35–41 s of headroom at the re-test, but missed by 2.9 s in the first run on a busy host, where DEF-049 plausibly contributed (not proven);
  - no data or count effect; the extra locks stay inside the job's own serialised work.
- **Fix candidates:** a per-status forced-index `FOR UPDATE` was rejected, because it blocks the next job's staging (REV-135 M1). The candidate that measured best picks the row without locking, then locks it by primary key.
- **Status:** fixed under HD-154 A (Product Owner, 2026-10-29). The pick now uses a non-locking lookup and then a primary-key lock. Closed after the formal re-test at `4f101642`: TC-101 passed at both stages, the impact regression passed 735/735, and PR #301's CI passed. Details are in `04_defect_register.md`.

## DEF-050 — CLOSED (MEDIUM)

- **What happened:** TC-085 failed at TECHNICAL in the DEF-049 re-test. The for-SKU name search p95 was 2,113 ms against 2,000 ms. It passed at REGRESSION, at 1,937 ms. Every formal run has been within 10% of the limit.
- **Cause (HD-155 A diagnosis, corrected after REV-137):** this is a capacity limit. The pool of 10 is full from 25 users, at about 29 requests per second. Above that, every for-SKU operation queues.
  - The largest costs are the exact `COUNT(*) total` of a `q` search (35%, a full `LIKE` scan), the deep-`OFFSET` rest page without `q` (22%) and the head queries (about 35%).
  - A bigger pool or buffer pool does not help.
- **Status:** HD-156 answered E (Product Owner, 2026-10-29). DEF-050 stays OPEN, and TC-085 is re-measured in the production-like environment (row in C). The remedy is chosen among HD-156 A–D with those numbers, and the local FAIL goes to the release risk decision. TC-085's TECHNICAL FAIL keeps Technical Acceptance blocked while DEF-050 is OPEN.
- **Superseded by HD-157 (Product Owner, 2026-10-30):** there is no production-like re-measurement, and no remedy. NFR-005's limit is 3 s. DEF-050 closes once TC-085 passes against 3 s in the formal run on the HD-157 baseline. Details are in `04_defect_register.md`.
- **Closed (2026-10-30):** TC-085 passed against 3 s at both stages of the formal run on the HD-157 baseline (for-SKU p95 1,737 and 1,818 ms).

## DEF-051 — CLOSED (MEDIUM)

- **What happened:** TC-101 failed at REGRESSION in the formal run on the HD-157 baseline. During the import, `update` p95 was 2,286 ms and `list.missingFilter` 2,011 ms, against 2,000 ms. It passed at TECHNICAL, at 820 and 1,443 ms.
- **A step change:** since PR #301 (DEF-049 fix), `list.missingFilter` during import has been 1,443–2,011 ms in every formal run, against 392–580 ms before. The cause is not proven; the A/B diagnosis (HD-158 A) was stopped before it measured anything.
- **Status:** HD-158 answered (Product Owner, 2026-10-30): the during-import online p95 limit is 5 s, with no remedy. DEF-051 closes once TC-101 passes against 5 s in the formal run on the HD-158 baseline. Details are in `04_defect_register.md`.
- **Closed on the existing evidence** (agent's reading of HD-160; Product Owner, 2026-10-30: "3不用跑了…", declining the formal run on the HD-158 baseline): both formal runs on the HD-157 baseline had p95 under 5 s (worst 2,286 ms) with error rate 0, and the HD-158 developer run passed against 5 s.

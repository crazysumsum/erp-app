# TASK-051 — completion boundary (2026-10-27)

TASK-051 (T51: deployment, smoke, regression and Release Gate) is **not complete**. Formal UAT is NOT_RUN, and the release is **not approved**. This page splits what remains into three groups. The split sets delivery boundaries; it does not reduce scope. Every case, data volume, performance threshold, coverage floor, CI check and independent review still applies.

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
| UAT-035 | A completed purchase creating a soft relation | none possible | Purchasing / Receiving owners | PO and receipt flow, with the supply-event call |
| UAT-036 | Old PO keeps its Currency and Term snapshot | Defaults changed with a reason | Purchasing owner | PO snapshot exists |
| UAT-051 (open-matter and new-transaction steps) | Open matters and new transactions | Block steps pass | Purchasing / AP owners | Open-flow provider installed (HD-131 A) |
| UAT-053 (referenced Bank account) | A payment flow that references the account | Add, edit, default and deactivate pass | AP / payment owner | Payment references exist |
| Purchasing's pin of the Supplier design | Purchasing's manifest pins an older Supplier design hash | — | Purchasing owner | Purchasing refreshes its pin; raised as [#294](https://github.com/crazysumsum/erp-app/issues/294) |

These cases keep their original assertions. They are not re-run while the dependency is unchanged, and no fixture, skip or exception stands in for them.

## C. Operations, harness and formal release acceptance — open

| Item | Case IDs | Remaining | Owner | Unlocks when |
| --- | --- | --- | --- | --- |
| Representative volume and DR as UAT | UAT-044, UAT-045 (HD-144 B) | An operations representative at representative volume; a DR owner in an isolated restore with RTO ≤ 4 h and RPO ≤ 15 min | Operations, DR owner | Representative environment exists |
| Production-like performance | TC-128 (production part) | Production-like MySQL and hardware | Operations | Same |
| Production resilience | TC-130, TC-132 (production parts) | Network faults in the deployed topology; alert delivery to on-call | Operations | Deployed environment and log pipeline |
| Production restore drill | TC-133 (production part) | Backup schedule, binlog retention, isolated restore; RTO/RPO measured | Operations | Same |
| Production deployment | TC-134, TC-135 (production parts) | Worker rollback timeline; staged capability deployment per §14; break-glass accounts audited | Operations, Security | Same |
| Rollback across 0103 in production | TC-006 (production) | A rollback to a release before 0103 needs a maintenance window and the three statements in 0103's header (rehearsed locally in A). The order users set is lost. Rolling forward renumbers the rows in display order. The runbook must say so, and the loss must be accepted. | Operations (runbook), Product Owner (accept the loss) | `operations.md` written; release review |
| Production-like UI smoke (T51 Verification 3) | — | Playwright on a production-like deployment, with console and network checks. It must also cover every role, approval ON and OFF, Bank reveal, for-SKU, Import/Export, backup/restore, and the rollback rehearsal on that environment. The local UAT runs in A cover these flows on the developer stack only. | Supplier (script), Operations (environment) | Production-like environment exists |
| T51 deliverables (T51 AC 1, AC 3) | — | Drafts exist: `operations.md` (runbook, rollback boundary, Bank key dependency), `release_evidence.md` (sign-off sheet), and `smokeSupplierManagement.js` (HD-148 B: `check` read-only on the deployed environment, `copy` write smoke on a restored copy; rehearsed locally only). The profile has `supplier-deployment-check` and `supplier-deployment-copy` since HD-149 A (12d52ff3); a formal run of them in the isolated environment is a local rehearsal only. Remaining: Operations' review; both smoke modes run on a production-like environment, by the runbook (`npm run smoke:supplier`). | Supplier (drafts); Operations (review and runs) | Before release sign-off |
| Harness formal evidence (T51 AC 2, formal part) | all suites | `run_check` refuses formal stages in IMPLEMENT. It also refuses any stage while consumed-contract pins drift (`CONTRACT_DRIFT`). The runs in A are developer-stage evidence. | Supplier, Product Owner | Mode change to TEST_AND_VERIFY, with clean pins |
| Consumed-contract pins (HD-147 B) | — | Refreshed under HD-149 A (12d52ff3): Item added DES-022, a Receiving provider; Purchasing changed its Inventory reversal provider. Neither touches a contract Supplier consumes (REV-130). The approvals were re-recorded on the new baselines. | Supplier | Done on merge of the baseline refresh PR |
| Release gate | TC-136 | `verify_gate` over the candidate's CI and suite evidence, open P0/P1 cases and defects, and the Product Owner's GO | Product Owner, QA | All of the above |
| Business UAT | UAT-001…UAT-055 | Execution by the business roles; 07's Status stays NOT_RUN until then. Automation PASS is not business acceptance. | BA / Product Owner | Formal UAT window |
| Sign-offs and release approval (T51 AC 4) | — | BA/Product Owner, Technical Lead, QA, Security and Operations; a separate release approval | Those roles | After everything above |
| 07 amendments | UAT-037, 038, 043, 046, 047, 055 | HD-145 A and HD-146 A deviations recorded in the TC map | Product Owner, Supplier | Next plan revision |
| Deferred defects (risk-approved, HD-116) | DEF-004, 007, 008, 012, 013, 014, 015, 016, 017, 018, 019, 023 | Accept or close at release | Product Owner | Release review |

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

## DEF-050 — OPEN (MEDIUM)

- **What happened:** TC-085 failed at TECHNICAL in the DEF-049 re-test. The for-SKU name search p95 was 2,113 ms against 2,000 ms. It passed at REGRESSION, at 1,937 ms. Every formal run has been within 10% of the limit.
- **Cause (HD-155 A diagnosis):** every for-SKU search with `q` runs unanchored `LIKE` over the roughly 80,000 active Suppliers at least twice. MySQL on this host saturates at about 29 requests per second, so at 50 users the rest is queueing. A bigger pool or buffer pool does not help.
- **Status:** the remediation route is HD-156, for the Product Owner. DEF-050 blocks Technical Acceptance. Details are in `04_defect_register.md`.

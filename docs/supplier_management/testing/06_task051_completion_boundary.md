# TASK-051 — completion boundary (2026-10-27)

TASK-051 (T51: deployment, smoke, regression and Release Gate) is **not complete**. Formal UAT is NOT_RUN, and the release is **not approved**. This page splits what remains into three groups. The split sets delivery boundaries; it does not reduce scope. Every case, data volume, performance threshold, coverage floor, CI check and independent review still applies.

- **A — Supplier self-verification:** what the Supplier module can prove by itself. It is done for main `38f05ba6`, and can be delivered on its own.
- **B — downstream integration:** cases that need other modules' screens, documents or references. They are kept as written, with their assertions, and stay BLOCKED / NOT_RUN.
- **C — operations and formal release acceptance:** production-like environments, named roles, sign-offs and the release decision.

The candidate is main `38f05ba6`, the PR #291 merge. Its tree equals PR #291's head `a51a60b0`. Every run in A used that code. The branch head `db6298d3` adds ledger changes only.

## A. Supplier self-verification — done for `38f05ba6`

| What | Case IDs | Evidence on this candidate | Remaining |
| --- | --- | --- | --- |
| Server unit and integration (`supplier-server-integration`) | 89 required TC IDs | One run of the profile's argv, cwd and env, with `DB_INTEGRATION_TESTS=1` on MySQL 26.7.0: 2026-10-27 07:33:44–07:36:06Z; junit sha256 `3ab29aa9…`. Result: 730 tests, 730 passed, 0 skipped, 0 not run (minimum 620); every required ID passed. | none |
| Security (`supplier-security`) | TC-111…TC-120 | **The same run.** The argv is identical apart from the report file name, with the same cwd, env and data, so the same junit was judged against this suite's own rule: 730 of 730 (minimum 620); all 10 IDs passed. Not a separate execution. | none |
| Bank security (`supplier-bank-security`) | TC-062…TC-074, TC-076, TC-077 | **The same run,** limited to the `supplierBank*` files this suite's argv names: 142 of 142 (minimum 135); all 15 IDs passed. Not a separate execution. | none |
| Client UI (`supplier-client-ui`) | TC-013, 015, 029, 075, 121…127 | Profile argv: 208 of 208; all 11 IDs passed. | none |
| Resilience, local part | TC-130, 131, 132 (local) | Runner: all three local parts PASS. | production parts → C |
| Recovery, local part | TC-133 (local) | Runner: full-module backup, isolated restore, table and file reconciliation, smoke, and fail-closed without the key ring all PASS. | production drill → C |
| Release operations, local part | TC-134, 135 (local) | Runner: worker stop and takeover, fresh deployment, route and permission inventory, and separated-role smoke all PASS. | production parts and TC-136 → C |
| Performance, local part | TC-085, 101, 128 (local), 129 | Runner, 100k Suppliers and 50 users. **Second run:** all four PASS. Mixed p95 239 ms; for-SKU worst case 1,480 ms; the 10,000-row import applied 10,000, with none not applied; no statement digests lost. | production-like part → C |
| Performance, first run | same | **First run FAILED** on TC-085 and TC-129. The scratch instance's `performance_schema` digest table was full (10,000 of 10,000), so 32,662 and 91,964 statements went unattributed and the full-scan checks had nothing to judge. The table was truncated on that throwaway instance and the runner was run again. Kept as evidence, not discarded. TC-101 passed in both runs (10,000 of 10,000). | none |
| Upgrade, backup/restore, rollback rehearsal (TC-006, design §14) | — | `t51_rehearsal/rehearsal-2026-10-27.log`, all checks passed. It shows: pre-Supplier → current; previous `72e205ef` → current with backup and exact restore; rollback to previous on the upgraded database, including 0103's `sort_order`. The upgrade check was generalised for 0088–0103 and has its own control (see that folder's README). | none |
| UAT cases the Supplier can run (real backend) | 41 of 55: every UAT ID except those listed in B and C | Full UAT config on the PR #291 head (same tree): 41 passed, 14 skipped, the skips all `test.fixme` with a reason. Supplier steps of the B cases also run before their `test.fixme`. | none |
| CI on the candidate | required checks | PR #291 run 40465140671: 13 of 13 SUCCESS on `a51a60b0`. This PR's own head needs its own CI run. | this PR |
| Independent review | — | REV-113…REV-127 on the UAT and fix PRs. This page and the rehearsal change get their own review (REV-128). | this PR |

**Overlap rule used above.** One real execution satisfies several suites only when the source, command, cwd, env and data match. That holds for `supplier-security` (identical argv) and `supplier-bank-security` (a strict file subset of the same argv). Each suite was then judged by the harness's own `parse_results` and gate rule: count, skips, not-run and required IDs. `supplier-phase-001-server` is not equivalent, because its argv adds Business Master contract and migration files, so it is not claimed here. Those files run in CI's full server suite.

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
| Consumed-contract pins | The Item and Purchasing design specs changed after the manifest pinned them (`CONTRACT_DRIFT`). Supplier analysed both: Item added DES-022, a Receiving provider; Purchasing changed its Inventory reversal provider. Neither touches a contract Supplier consumes. | — | Supplier, with the Item and Purchasing owners | HD-147: refresh the pins, which strands baseline-bound records, so approvals must be re-affirmed |
| Purchasing's pin of the Supplier design | Purchasing's manifest pins an older Supplier design hash | — | Purchasing owner | Purchasing refreshes its pin |

These cases keep their original assertions. They are not re-run while the dependency is unchanged, and no fixture, skip or exception stands in for them.

## C. Operations and formal release acceptance — open

| Item | Case IDs | Remaining | Owner | Unlocks when |
| --- | --- | --- | --- | --- |
| Representative volume and DR as UAT | UAT-044, UAT-045 (HD-144 B) | An operations representative at representative volume; a DR owner in an isolated restore with RTO ≤ 4 h and RPO ≤ 15 min | Operations, DR owner | Representative environment exists |
| Production-like performance | TC-128 (production part) | Production-like MySQL and hardware | Operations | Same |
| Production resilience | TC-130, TC-132 (production parts) | Network faults in the deployed topology; alert delivery to on-call | Operations | Deployed environment and log pipeline |
| Production restore drill | TC-133 (production part) | Backup schedule, binlog retention, isolated restore; RTO/RPO measured | Operations | Same |
| Production deployment | TC-134, TC-135 (production parts) | Worker rollback timeline; staged capability deployment per §14; break-glass accounts audited | Operations, Security | Same |
| Release gate | TC-136 | `verify_gate` over the candidate's CI and suite evidence, open P0/P1 cases and defects, and the Product Owner's GO | Product Owner, QA | All of the above, plus the harness formal stages |
| Harness formal evidence | all suites | `run_check` refuses formal stages in IMPLEMENT, and refuses any stage while the pins drift (HD-147). The runs in A are developer-stage evidence. | Supplier, Product Owner | Mode change to TEST_AND_VERIFY, with clean pins |
| T51 deliverables not yet written | — | `operations.md` (runbook: rollback boundary and Bank key dependency, beyond `bank_operations.md` and the rehearsal README), `release_evidence.md`, and `smokeSupplierManagement.js` (five-capability production-like smoke) | Supplier (draft); Operations (review) | Before release sign-off |
| Business UAT | UAT-001…UAT-055 | Execution by the business roles; 07's Status stays NOT_RUN until then. Automation PASS is not business acceptance. | BA / Product Owner | Formal UAT window |
| Sign-offs and release approval | — | BA/Product Owner, Technical Lead, QA, Security and Operations (T51 AC 4); a separate release approval | Those roles | After everything above |
| 07 amendments | UAT-037, 038, 043, 046, 047, 055 | HD-145 A and HD-146 A deviations recorded in the TC map | Product Owner, Supplier | Next plan revision |
| Deferred defects (risk-approved, HD-116) | DEF-004, 007, 008, 012, 013, 014, 015, 016, 017, 018, 019, 023 | Accept or close at release | Product Owner | Release review |

## DEF-034 — OPEN (LOW)

- **What happened:** on 2026-10-22, one 10,000-row import under load applied 9,999 rows. The job's counts stayed consistent, so the row was reported as failed, not lost. Every row in the file was a valid create.
- **Not reproduced:** every run since applied 10,000 of 10,000. That covers the later 2026-10-22 runs and both 2026-10-27 runs; T50's earlier runs did the same.
- **Cause unknown:** the first runner version deleted the tools' reports, so the failed row's stored error was lost.
- **Capture measures now in place:**
  - the runner keeps the tools' reports;
  - while the import runs, it polls for failed rows and records their stored errors (`evidence.importFailedRows`);
  - the import tool writes up to 20 not-applied rows with their errors before deleting its job (HD-122 A).
- **Status:** later passes are not a root cause and do not close the risk. DEF-034 stays OPEN until a recurrence shows the reason, or the Product Owner accepts the risk at release.

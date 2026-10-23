# P0 Allocation transaction profiling — 2026-10-22

Historical diagnostic checkpoint. Subsequent approved optimization and current CI results are recorded in [report24](24_allocation_candidate_schema_optimization.md); original measurements and limitations below are retained.

## Scope and current conclusion

Actual Sam resumed **diagnostics only**:「先恢復做 Allocation 交易的分階段計時，找出最耗時的步驟及 SQL 次數，確認瓶頸後再決定怎樣優化。」No new optimization, product behavior, deadline, schema, CI or publication change was made. Existing receipt-batching WIP remains preserved and unapproved as a complete candidate. TASK-011/DEF-002 and the full P0 gates remain open.

The largest measured stage in both Allocate and Reallocate is **candidate selection**, not Allocation INSERT alone or receipt completion. In the current pre-Stocktake schema, each Reservation's candidate selection makes three SQL calls: a normal query referencing the absent `inventory_bin_locks` table fails with `ER_NO_SUCH_TABLE`; an information_schema query proves both Stocktake tables absent; the supported pre-feature query is retried successfully. Across 5,000 members this is 15,000 SQL calls, including 5,000 handled missing-table errors. This is existing intentional compatibility behavior, not an unhandled error or permission to remove the fail-closed partial-schema guard. The fallback is established in Inventory's implementation readiness documentation; current migrations do not install those future Stocktake tables.

Measured transaction-wide InnoDB row-lock wait count/time deltas are zero in all 12 profiled transactions. No single long SQL dominates these local runs. The main observed cost is many serial SQL calls and their accumulated execution, driver/framework and round-trip costs. This local result does not prove which stage consumed the historical CI deadline.

## Baselines and method

- Published baseline: `d5e8c33cea19b280bed116be8cfc1b1f7456b7cc`, source fingerprint `4461a1c86d8c504ba9d51b069f3696728d8d586002858eaf80d76bccd3963648`.
- Preserved WIP: same HEAD, source fingerprint `dff20777d6bad883f820d6aea357b5ffe0969f5abed3280313012d6f60099926`.
- DESIGN `eed2eb831ce50d0717992bcc25f04318dd652b16b7f662b3b5f81f9797b5a545`; PLAN `f3b9dacf3b513916e6f7f349e15c0fcc035be2bc2995761624e7adb7b6238b05` unchanged.
- Owned native MySQL 26.7.0, local Unix socket, Node v26.6.0; tests create and clean up their own UUID schema, with original data/permissions/source semantics. No shared or production database is used.
- Real existing `P0 legal5000-Reservation membership...` test, not a mock or full Sales end-to-end test: same SKU, 100 synthetic line identities, 50 Reservations of one unit per line, 50 stock buckets; then Allocate and old/new Reallocate. Fixture setup is outside measured transactions.
- Three alternating runs per variant, each retaining native `transactionTimeoutMs=20000`, test timeout 90000 and V8 experimental coverage. Both transaction actions are measured separately. No concurrency/load was introduced.
- Private import hook wraps existing functions in memory and instruments the existing executor methods. Published variant overlays actual `git show HEAD:<path>` bytes for the changed owner/test files; WIP variant loads preserved worktree bytes. All other source remains unchanged. Original/instrumented hashes are recorded per module in each JSON. No product files were changed to add probes.
- Phase time is exclusive wall time: nested lock/selection/audit/receipt-read time is removed from its parent's row. SQL elapsed time is measured around executor calls, **not pure MySQL server CPU/execution**. SQL counts are query/execute API calls including handled errors, excluding seeding, observer statements, SET/BEGIN/COMMIT and separate mysql2 statement-preparation commands.
- A separate observer connection reads per-thread performance_schema statement counters and global row-lock counters before/after each transaction; these reads do not use the instrumented transaction executor. Per-thread server time is a separate metric, not interchangeable with client SQL wait time.
- Diagnostics only: targeted discovery is one test per run, not the mandatory full suite. No test applicability, gate, skip allowance, threshold or CI job was changed.

## Published baseline results

Three-run medians below; each phase median is calculated independently, so rounded phase medians need not sum exactly to the whole-transaction median.

| Exclusive phase | Allocate time | Allocate SQL | Reallocate time | Reallocate SQL |
|---|---:|---:|---:|---:|
| Authorization and input validation | 0.040 s | 6 | 0.052 s | 6 |
| Scope identity/claim | 0.017 s | 3 | 0.013 s | 3 |
| Root/member/leg operation preclaims | 1.027 s | 10,001 | 1.559 s | 15,001 |
| Lock and current-state validation, excluding nested receipt read | 0.050 s | 21 | 0.099 s | 23 |
| FIFO/FEFO candidate selection | **2.842 s** | **15,000** | **2.854 s** | **15,000** |
| Allocation/Balance/Reservation writes, excluding selection/audit | 1.444 s | 15,000 | 2.273 s | 25,000 |
| Audit writes and serialization | 0.552 s | 5,000 | 1.077 s | 10,000 |
| Operation receipt completion | 1.017 s | 10,001 | 1.519 s | 15,001 |
| Receipt loading, identity/digest/snapshot verification | 0.102 s | 103 | 0.246 s | 256 |
| Transaction setup/commit/other including probe bookkeeping | 0.041 s | 0 | 0.061 s | 0 |
| **Whole transaction** | **7.149 s** | **55,135** | **9.784 s** | **80,290** |

Allocate range 7.081–7.186 s; Reallocate range 9.680–9.820 s. Candidate selection is approximately 40% of Allocate and 29% of Reallocate. Client SQL call elapsed time accounts for median 91.09% / 90.62% of transaction wall time. Server-side per-thread statement timer medians are approximately 2.728 s / 3.504 s; the difference includes transport, framework/driver, scheduling, decoding and profiling costs, so it must not all be labelled network time.

In the first published-baseline Allocate sample, candidate SQL breaks down as follows:

| Candidate query type | Calls | Client SQL time total |
|---|---:|---:|
| Query including absent Stocktake lock table, handled error | 5,000 | 0.685 s |
| Check both Stocktake tables absent | 5,000 | 0.913 s |
| Successful candidate query without future lock table | 5,000 | 1.060 s |

These sum to approximately 2.659 s waiting for SQL inside the 2.842 s selection phase. The 15,000 allocation-write calls are 5,000 Balance CAS updates + 5,000 Allocation inserts + 5,000 Reservation version CAS updates. Operation preclaims are one root + 5,000 members + 5,000 legs. The result is roughly eleven serial SQL calls per member before small fixed/paged overhead, rather than one INSERT per member.

## Existing WIP comparison, not a newly selected optimization

| Metric | Published implementation | Preserved receipt-batching WIP |
|---|---:|---:|
| Allocate whole-transaction median | 7.149 s | 6.682 s |
| Allocate SQL calls | 55,135 | 45,235 |
| Allocate receipt-completion median / SQL | 1.017 s / 10,001 | 0.447 s / 101 |
| Reallocate whole-transaction median | 9.784 s | 8.978 s |
| Reallocate SQL calls | 80,290 | 65,440 |
| Reallocate receipt-completion median / SQL | 1.519 s / 15,001 | 0.610 s / 151 |
| Combined Allocate + Reallocate SQL calls | 135,425 | 110,675 |

WIP ranges: Allocate 6.610–6.718 s; Reallocate 8.892–9.026 s. The batching change reduces receipt-completion work in the client, but candidate selection remains approximately 2.86 s and 15,000 SQL calls in each action. It is not evidence that the WIP passes full verification or current-candidate CI, nor proof that receipt completion was the primary bottleneck.

## CI interpretation and next decision

Historical exact-head CI [39711724388](https://github.com/crazysumsum/erp-app/actions/runs/39711724388) remains failed on `DATABASE_TRANSACTION_TIMEOUT` in this test. Its logs have no action/stage timing, so they do **not** establish whether Allocate or Reallocate was the first timed-out transaction. Earlier chat wording that identified Allocate definitively was too strong. This local serial diagnostic did not reproduce the CI timeout and does not establish the runner-specific slowdown factor. Both local variants pass the unchanged 20-second transaction budget in this diagnostic only.

As an arithmetic sensitivity example, 55,135 serial calls at a hypothetical average 0.4 ms already total 22.05 s; 80,290 calls at 0.25 ms total 20.07 s, before non-SQL work. These averages are illustrations, **not measured CI latencies**. The measured local client-call averages are about 0.11–0.12 ms. Runner CPU/coverage/driver/scheduling and statement execution can therefore materially affect the budget without any individual very slow SQL or lock wait; the precise CI attribution remains unobserved.

Recommended next investigation is whether the repeated pre-Stocktake compatibility check can be safely resolved once within an appropriately bounded transaction scope while retaining both-table absence proof, partial-schema rejection, current inventory reads and all lock/quantity/version guards. That would target the largest measured stage. Do not cache candidate availability blindly: every allocation changes available quantities. This report does not implement or approve an optimization design, remove the capacity case, increase a deadline, add future Stocktake tables, or lower any gate. Await Sam's direction before optimization or broader P0 work resumes.

## Evidence and validation

Private evidence: `evidence/allocation-profile-20261022/summary.json`, six per-run JSON/log pairs (`committed-3/4/5`, `wip-3/4/5`) and `profile.executed.mjs.txt`. Runner `/private/tmp/fulfillment-p0-profile-run.py`; summarizer `/private/tmp/fulfillment-p0-profile-summarize.py`. Summary records artifact hashes and source-before/source-after equality. All SQL count reconciliations, exclusive phase/transaction time reconciliation (within 1 ms), expected 5,000 handled candidate errors, zero lock-wait deltas and actual per-run test totals were asserted.

The six profiled targeted tests passed with zero failures/skips, completing twelve transactions. Bootstrap attempts are retained separately: `committed-1.log` failed before execution on a diagnostic-hook inherited-property matching bug; `committed-2.log` was blocked by sandbox socket `EPERM`. The hook was corrected and reviewed native socket execution authorized; neither bootstrap attempt is represented as product success.

Uninstrumented control results and final evidence checks are recorded below after observation. No new CI, full P0 regression, independent closure review, draft PR or merge was performed under this bounded diagnostic authorization.

### Uninstrumented controls

The same real capacity case was additionally run once per variant with V8 coverage but **without the stage/SQL profiling hook**. Published control ran in the existing detached source-equivalent regression worktree, with all five relevant Inventory source files byte-checked against d5; WIP control ran in the preserved worktree. The same owned MySQL socket and fresh per-test UUID schema were used. Both controls passed one test with zero failures/skips:

| Control | Allocate | Reallocate | Combined SQL |
|---|---:|---:|---:|
| Published source, no probes | 7.086 s | 9.562 s | 135,425 |
| WIP source, no probes | 6.457 s | 8.700 s | 110,675 |

Profile medians are approximately 0.9–3.5% above the corresponding single controls. This is an overhead/noise check, not a statistically isolated estimate or a reason to subtract a constant from phase results. It supports that profiling did not create the multi-second candidate-selection bottleneck. Eight targeted test executions passed in total (six profiled, two controls), with no mandatory full-suite/CI pass claimed. Control logs and copied runner/summarizer scripts are retained and hashed in the private summary.

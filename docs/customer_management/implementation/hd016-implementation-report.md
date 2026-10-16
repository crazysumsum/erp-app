# HD-016 implementation and developer verification

Sam explicitly approved PR244 DESIGN13a77ed2 / PLANb390c588 and the two shared
Business Master files; exact hashes are preserved in the reviewed proposal.
No canonical specification/contract scope or CI change is required by this repair.
Existing HD013/015 waivers remain; full downstream integration stays BLOCKED.

## Critical cases before executable test changes

| Case / priority | Risk / requirements | Preconditions and synthetic data | Steps / expected assertions / required evidence | Initial status |
| --- | --- | --- | --- | --- |
| FIX-081-LOCK / P0 | SEC least privilege / DES017 | Own migrated MySQL13369; new SELECT-only catalog account, owned Currency/Term | Actual repaired provider succeeds, write/exclusive-read denials remain; two shared readers; actual owner exclusive lock blocks reader; consumer-held locks block owner mutation; current read sees new committed inactive/version; timeout propagates; no implicit commit. Record assertions/stdout, clean owned rows/users. | NOT RUN |
| FIX-081-FLOW / P0 | Customer default/bank/credit/approval runtime grants | Existing operational guard fixture; synthetic user/approver/owned Customer and Term; catalog SELECT only | Add non-null HKD bank, default HKD/Term create/update, real credit write, approval submit/approve using the narrow runtime instead of admin. Exact grants and negative DML tests retained, no replacement provider. Record outcomes/audits. | NOT RUN |
| FIX-070-BATCH / P1 | Additive provider2.2 / precheck not authority | Existing Sales migration fixture and real Customer/credit DB | Batch missing/inactive/hold/immutable/safe fields and bounds; real precheck valid then Customer blocked or credit on_hold; actual intake confirmation rejects with zero SO/reservation/source-success. Record errors/counts; no whole downstream acceptance claim. | NOT RUN |

Unit RED: two new lock-mode/provider regression tests failed on unchanged product
source. Minimal two-file Business Master change then25 focused tests PASS0SKIP.
Customer provider runtime label changes2.1->2.2 for the already merged additive batch
method; actual consumers' expectations are updated, not a new Sales behavior.

All results below are developer verification, not formal UAT/business/release sign-off.

## Current observed results — candidate not merge-ready yet

- Unit red2FAIL on old source; fixed focused26PASS0SKIP. Mutating the new
  mutual-exclusion guard `&&` to `||` caused1FAIL, then restored26PASS. No mutation
  retained. Owner admin code is untouched; repository exact suffix tests cover
  unlocked/shared/exclusive and ambiguous/nonboolean pre-SQL refusal.
- Real migrated MySQL26.7 catalog/runtime batch10PASS0SKIP. Both tables retain
  SELECT-only grants and DML/exclusive-read1142 denial, two shared readers, actual
  consumer Customer lock -> catalog read, owner writer1205/no provider commit,
  stale snapshot vs new inactive/version, owner exclusive -> reader timeout.
- Operational guard enhanced with explicit successful approval under the same
  narrow runtime (not dependent on a race winner): active Customer plus exact
  approval/activation audits, credit HKD, defaults/Term and non-null HKD bank.
  Final complete operational file9PASS0SKIP (535.455375ms). No catalog write grants.
- Actual registered Sales import precheck -> Customer blocked/credit on_hold ->
  final confirmation:3PASS0SKIP, no Sales Order/reservation/source key, exact safe
  business errors. Unit batch100unique boundary, missing/null/frozen safe fields,
  invalid ID/time refusal and caller-only SQL covered.
- Client coverage112files/903tests PASS; unchanged floors, lines77.77%,
  branches69.07%, functions68.94%, statements74.52%. Build PASS with existing
  large-chunk warning. Lint PASS after new-test-only corrections. Dependency audit
  meets the configured high-severity gate but reports one low Quasar advisory;
  no dependency changes made in this Customer task.

The first full server coverage invocation is FAIL, not silently replaced by focused
results: two existing restore fixtures required a non-empty DB_ADMIN_PASSWORD
(owned runtime originally used empty-root setup), a Supplier SQL-order assertion
still expected the old exclusive suffix, and Sales TC-042 mixed import/foreground
load reported CONCURRENT_OPERATION. Correct owned fixture administrator configured;
Item restore recheck1PASS, Supplier restore/order rechecks PASS; Supplier assertion
now requires shared-lock SQL while preserving settings-before-Currency ordering.
No Supplier/Item product source changes or test threshold reductions.

The full invocation started before the final test-only deterministic approval and
Supplier assertion edits; no changed-product single-frozen-full-run PASS is claimed.
Uninstrumented unchanged TC-042 rerun on the repaired source is in progress with
owned-instance deadlock diagnostics enabled. This real regression remains a merge
blocker until causality and actual final-head checks are resolved; no blind rerun
or replacement of the load acceptance. Complete downstream acceptance remains blocked.

Initial test development failures are retained: new catalog fixture used lowercase
`active` instead of owner `ACTIVE`; obsolete bank assertion still required null;
missing helper import, incomplete/mismatched ephemeral runtime key-ring config;
deterministic proof initially widened an actor-wide race count (now correctly
scoped to its exact request resource_id). All scoped corrections were retested.

## Approval provenance and generic-validator limit

Actual Sam HD016 approval binds DESIGN13a77ed2/PLANb390c588 and shared scope.
APPROVAL-RISK-007 binds the unchanged accepted HD013/015 clauses to this exact PLAN.
Original approvals and ledger mappings are preserved, never silently rehashed.
The generic unique-ID applicability validator cannot follow that renewal and still
reports TC086/087/088 NA_APPROVAL_STALE. This is explicitly not STRUCTURE/approval
PASS; actual human source plus current RISK007 supplies reviewed baseline provenance.
The independent reviewer accepted this minimal historical-preservation approach.
No CI, product-failure, downstream or release waiver is implied.

## Isolated terminal result and final publication protocol

Unchanged TC-042 scenario on the repaired source completed1PASS0FAIL0SKIP:
10,000 orders/50,000 lines,50 foreground users/4,045 samples, p95=86.791291ms,
workload806271.523ms. All406 import/27 recovery/2 backorder ticks had0failures/
timeouts;14,048 orders/93,647 lines/mappings reconciled with0differences in every
category. This is actual developer regression, not Customer TASK-034/full downstream
or UAT sign-off. [Minimized measurements and provenance](hd016-isolated-load-results.json).

The first full coverage failure occurred while a separate112-file/903-test client
coverage run was also active. That capacity sample did not have its declared fixed
background workload and cannot certify capacity. Preserve its failure, do not assert
the CPU overlap is the proven sole cause of its transaction conflict. A clean isolated
PASS alone does not permit merge: repeat full server coverage without parallel local
CPU-heavy jobs, then require the exact published candidate's complete CI and actual
independent integration-review disposition. No threshold, skip policy or CI edits.

Fresh main089dd45b6ca5558511ae6396a88f732d5df43927 integrated without conflict at
26ed9a6e8b951cbd585cf74f0a2eb00031a3e337. Its Item receipt method is additive;
existing Sales-called Item methods and Customer canonical baselines remain unchanged.
Integrated executable/source fingerprint:
397e161701b2e6af7a3dd7be702d4d48c057f49c1d2d9aed6f62ecbf606c8510.
Complete CI-equivalent server coverage is now executing serially on this integrated
source with proper owned fixture credentials, existing SALES_CAPACITY_SEPARATE_STEP
policy and unchanged TC-042. The local log remains private until minimized results.

This is a pre-final-gates publication checkpoint, not a claim those pending gates
passed. Actual immutable final test/CI/review/merge/cleanup receipts are recorded in
[PR244 timeline](https://github.com/crazysumsum/erp-app/pull/244) against the final
published head, avoiding repeated documentation-only commits invalidating the very
CI identity they describe. A later receipt supersedes this pending checkpoint only
when the actual observation exists. No final success, defect closure or cleanup is
claimed in advance. Whole-module state stays BLOCKED for the unready downstreams.

## Serial full-run failure supersedes the pending checkpoint

On the integrated executable/source397e1617, the serial CI-equivalent server
coverage invocation completed exit1:3,441 tests,3,304PASS,1FAIL,136existingSKIP,
0cancelled,585928.640416ms. The only failure was unchanged Sales TC-042 mixed
load (34722.812459ms), CONCURRENT_OPERATION, before import READY. No other
CPU-heavy local test job overlapped this run. Therefore the earlier non-isolated
measurement classification does NOT dispose of the newly reproduced regression.
DEF-033001 remains HIGH/OPEN; the isolated successful scenario is not a substitute.
Coverage lines94.00%, branches86.40%, functions93.14%; all38 high-risk per-file
floors pass independently, but the full test command FAIL remains a merge blocker.
Existing skip policy, assertions, thresholds and CI are unchanged.

Owned MySQL native deadlock diagnostics identify a real cycle: a new Sales draft
holds the Warehouse shared FK lock and waits for an insert-intention lock on
`sales_order_lines.uq_sales_order_line_sku_uom` supremum; a confirmation holds
that line-index range and waits for the same Warehouse's exclusive Inventory lock.
Currency/Payment Term do not participate in this captured wait cycle. This does
not prove the new shared catalog concurrency is irrelevant to its exposure.

A private diagnostic reuses the existing TC-021 fixture/probe with100 distinct
SKU/UOM lines, a different Customer and a different Currency for the competing
draft. Twice it failed the existing observable invariant: the competing first-line
INSERT cannot complete while the confirmation holds its Sales-line locks.
The second invocation0PASS1FAIL0SKIP,5944.703583ms captured actual EXPLAIN:
`Index lookup ... using uq_sales_order_line_sku_uom (sales_order_id=15169)`, then
filter `line_no IN (1..100)` and sort `id`. This is not the intended full-unique
line-number point-lock plan. Existing one-line TC-021 passes but misses this case.
SalesOrderService and the mixed-load test are identical to latest main089dd45b;
no Sales product repair has been made or implicitly authorized by HD016.

Proposed next decision HD-017: extend only SalesOrderService.lockSalesOrderLines
and directly related Sales regression tests to enforce intended unique-record
locking for supported100-line orders. Preserve lock order, atomicity, error handling,
owner/provider boundaries, schema/grants, fixed capacity profile and every gate.
Then rerun the minimal reproducer, unchanged TC-042, full coverage and exact-head CI.
This touches a third module product file outside Sam's explicitly approved two
shared files, so implementation/merge must wait for that scope decision. No waiver
of this genuine failure is proposed; reverting to catalog exclusive reads would
restore the demonstrated SELECT-only Customer runtime denial and is not a solution.

Actual private evidence retained (no secret values):

| Evidence | SHA256 |
| --- | --- |
| server-coverage-final.log | 0fc84ddffc86b3507558de0dd33d5d1da90553e2e73402ca0ff6f87f9b87885c |
| sales-lock-probe.mjs | 99ddebef81b818ee283ba462d9697c514edbd515625097923d609dd846e947e8 |
| sales-lock-probe-explain.log | 60a81ab71df17d87422ce4336ac0b510a92fdfda338a568ceb5e3c90c2526289 |
| mysql.log at diagnosis before runtime cleanup | 15e9340492ff199a1266f6b5c25b73e4adf99d3f20639d0b606e7e5cc36dd492 |

Paths are under `/private/tmp/customer-hd016.qWNdul/`; the probe's command was
`node /private/tmp/customer-hd016.qWNdul/run.mjs node --test --test-concurrency=1 --import ./server/test-support/testEnv.js /private/tmp/customer-hd016.qWNdul/sales-lock-probe.mjs`
from this owned Customer worktree. Probe setup/teardown uses real registered
services and real MySQL, not mocked database locks. It is diagnostic evidence,
not an added approved Sales implementation/regression or downstream acceptance.

Independent reviewer `/root/customer_task011_review` returned CHANGES_REQUESTED
on source397e1617/PR83603: the serial failure is a valid HIGH blocker, and HD-017
is required before Sales product changes. No merge is permitted by the code-only
earlier approval. Before pausing for the consolidated scope decision, only the
owned schema and ephemeral administrator were dropped, owned MySQL13369 stopped
(shutdown02:13:06UTC; process sessions exit0/socket absent), and its exact stopped
datadir/private credential file removed. These were disposable synthetic test
resources, not recoverable business data; credential-free logs/probe remain.
Customer worktree/branch/DraftPR244 remain for resumption. Shared MySQL untouched.

## HD-017 human disposition

Sam: 「維持 PR 阻塞，另由 Sales 工作處理；不擴大目前範圍」。
Scope extension is declined; HD-017 is answered, not awaiting approval. Sales owns
the separate deadlock repair. Customer makes no Sales product/test changes, does
not waive DEF-033001, and keeps PR244 Draft/BLOCKED. No Sales task dispatch or
completion is claimed. After the separately delivered fix is available on verified
main, integrate and repeat affected regressions/full coverage/current-head CI and
independent review before considering merge. Full downstream acceptance remains
BLOCKED, and the existing DESIGN/PLAN baseline approvals remain unchanged.

## HD-018 — separately delivered Sales repair approved

Sales independently requalified the narrow fix (111affected regressions and original
TC0422cases PASS), but its fullP4 delivery is blocked atTASK057 by actual Fulfillment
contracts and previously prohibited partialmain merge. Customer recorded HD018 to
ask about that delivery boundary, not to implement a Sales fix itself.

Sam explicitly approved HD018: Sales should split only the deadlock fix and directly
related tests into an independent PR, pass normal CI/review and merge that repair
to main first; Customer then automatically integrates/revalidates and merges PR244
only after allits gates. No Customer repair-scope expansion; full downstream
acceptance stays BLOCKED. Actual notification to `sales_order_management` chat
01a0f0e2-2647-7dc2-a1d4-a7cefa29d0f6 succeeded, carrying Sam's exact decision,
the isolated minimal split/preserveexistingchanges boundary and allnormal gates.
Notification is not Sales acceptance, a new PR, defect closure or upstream merge.
The existing15minute Customer heartbeat was updated successfully with this decision
so it does not stop on staleHD018OPEN cache or ask for the same approval again.
Actual merged-main receipt remains required before Customer integration. Existing
Customer DESIGN13a77ed2/PLANb390c588 approval/history and all genuine failures remain.

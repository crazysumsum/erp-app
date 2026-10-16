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

# DEC-035 — Proposed shared connection-wait observation scope

Proposal status at issuance: DECISION_REQUIRED. No shared product patch or canonical baseline change is applied. Current P4 continuation/isolated synthetic SQL/commit/PR/main-merge authority remains; this decision concerns one additional shared framework source file and its baseline bindings.

## Context and exact proposal

Approved Sales monitoring needs actual DB pool wait. Existing database.operation.completed is pooled wait plus SQL time, emitted only at debug; it cannot supply a true acquisition observation. Current Sales scope does not include server/src/services/mysqldatabase/MySqlDatabaseService.js.

The exact unapplied patch5880f26ed60836cfd82444c1d1fccad0b6e2d4d4fd7bc8a589482aee19cbabf9 is private at phase4-private/p4-poolwait-proposal-r2/shared-poolwait-source.patch. Before SHA9d01e01f8087023546c586d5ce9840873e5fc2fba21a61a608e0ac46029a121f, afterfb31b7896ab65424ce577c0e76b1fb0c2cd44fffde6fa7646113018c3483d550. It adds per-executor fixed counters, in-flight caller count, thirteen histogram bins and a cloned readonly getConnectionWaitMetrics snapshot around the actual acquire boundary. Two monotonic clock reads plus fixed counter/bucket work per acquire; no per-query log, SQL, business/user labels, table or dependency. Original admission/timeout/abort/error/late connection release/transaction logic is retained. This is a shared runtime telemetry contribution, not a business state repair.

inFlight counts callers still waiting, not the driver's residual queue after a timeout/abort. Buckets are lifetime cumulative upper-bound ranges, not exact window P95; consumers must detect reset and state sample/window coverage. aboveThreshold refers to configured acquireTimeoutMs. These limits are part of the proposed contract, not substitutes for engine/query measurements.

## Concrete verification

Private overlay author41unitPASS0FAIL0SKIP, unchanged three original MySQL suites plus six observer cases; actual separate reviewer also41PASS and readonly apply-check0. Technical proofbb9f96ab8f3a34461516b4f7dc65d07e071bc1452adef77c4126068f89831a05. First author fixture incorrectly assumed default AbortSignal reason code; explicit synthetic reason now verifies original error identity/code without changing production behavior. Reviewer's initial missing testEnv bootstrap failure38PASS3FAIL remains separate from corrected41PASS.

Author actual three SELECT-only native cases on original verified owned UUID/socket/schema pass0FAIL0SKIP, raw228c824b2b176d01c95a188a7edaf0bf664a89d661bd18a5e19fb59d94639809: real queued admission, real acquire timeout preserving503/late capacity, and real abort preserving reason/late capacity. W shared source remained byte-identical. This is proposal verification, not installed-candidate/Phase evidence.

## Options, trade-offs and recommendation

Recommended: approve exact one-file shared scope and the readonly contract/bindings, then apply, connect the already owned instance collector and real bounded alert tests, run the original MySQL/Sales regression/currentCI/independent review and all original Gates. Cost is fixed small work per acquisition and a new readonly diagnostic method. No existing permission/schema/financial/transaction policy or threshold change is proposed.

Alternative: keep the shared boundary and wait for an equivalent formal framework provider; continue independent P4 work, but true pool-wait monitoring/TASK062/complete merge Gate remain incomplete. Do not substitute total SQL time or inferred driver queue length.

## Prospective binding and preserved authority

Proposed DESIGN: 10e658c43562f4d07aeeac9486bdc9ba46bb613e99f8813cf3997bde6b1d073d

Proposed PLAN: b52e2746d16e4440f6d7dd33b76de0ff444a8234cbd5b5a28183210958209b41

The exact private full package p4-poolwait-scope-package-r4.json includes manifest/trace and source hashes. It adds only the shared path to current source/allowed/approval-required lists, a consumed readonly framework contract, and new two existing UAT_NA binding references. Upon actual approval append new DESIGN/PLAN/SCOPE/UATNA records and preserve every original decision/hash/failure, current120 scope entries, entry baseline and original timed restore/RTO/RPO obligations. No claim Sam already reviewed these computed composites. No raw evidence/credentials exported.

This decision is required by the read software-engineering-harness/SKILL.md major-impact/public-contract control, references/08-implement.md prohibition on silently changing public interface/scope boundaries, and references/19-state-and-recovery.md requirement to obtain a new decision rather than overwrite an old approved hash. The existing P4 implementation/commit/PR/merge approval is not being asked again.

Engine ROWS_EXAMINED/lockwait, request/terminal P95, verified24h job history, stock-present FIFO evidence, seven full runbook dry-runs, capacity/restore and remaining fullPhase/currentCI/Gates are still required independently. No new waiver or partial Phase merge.

## Prospective R2 regression/discovery correction

R1 was not approved: independent canonical review52bd3626523888dc46b1ba4442e75cdfcb3f2fb00a41f94a26c9125254b2fddc found both new contract suites absent from required regression. R2 preserves R1 and adds those exact two existing suites to required regression plus REGRESSION stage. It preserves all original argv prefixes/min_tests/max_skipped/timeouts/case requirements and appends three original MySQL unit files and three explicit owned native entries. The new observer six unit cases sit in the existing phase4 glob; original queue/reconciliation native cases are explicitly discovered, not inferred from filenames. The prospective nine new installed-baseline critical cases are defined NOT RUN before generating portable automation. Existing declared CI socket lane and local owned UUID/socket are distinguished; no new CI execution/PASS is claimed. Approval still precedes any shared source/canonical manifest/profile adoption.

## Decision identity conservation

Use new DEC035: existing authoritative DEC030-HD008-HD009 and DEC031–034 are retained. Only the unissued private proposal label changes; canonical prospective D/P and source/test payload are byte-identical to R2 full-package technical closing8e8fefb72a8acd12a76dd5ea52e3f72c8b907738d71cee9be467153fde2c9aa3. R1/R2 artifacts remain historical. Actual human answer is still required.

R4 also corrects the unissued proposal required_before_application string to require actual direct Sam DEC035 approval; no earlier DEC030/HD approval can satisfy this new scope. R3 remains historical; canonical payload/source/D/P are unchanged.

## Actual human disposition — 2026-10-26

APPROVED by direct Sam response in this Sales conversation to request_user_input_async call_868e7e282add4309a90c94d6ca5cc5bb question0: 批准 DEC-035 單一共享觀測 scope（建議）. Exact immutable R4 aa2d85ffa888c7bbaf0ed0531c305bde695b171138da3041faacd176d58f7f29 adopted. CAS1373 records new append-only DESIGN/PLAN/SCOPE and existing-reason UATNA bindings; CAS1374 observes exact sharedfb31b789 and canonical new D/P application. Original decisions/hashes/proposal failures retained. Two owned test Promise executor braces subsequently corrected following actual installed lint failures, with product patch unchanged. Installed-candidate tests and collector integration recorded separately in report142. This actual approval removes the scope blocker; it grants no fullTask/Gate PASS or waiver of remaining work.

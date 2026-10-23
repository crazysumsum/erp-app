# Successful audit bounded-write optimization

## Authorization and baseline

Sam directly authorized successful audit writes in batches of at most 100, all records and safety checks retained, unchanged 20-second transaction limit, independent review, final-tail rollback verification, remeasurement and candidate CI. This is a bounded continuation after the earlier pause; broader TASK-011/DEF-003 closure, PR, merge and live activation are outside this continuation.

Baseline is commit `1cb2a7b37386f9d24b7c12d405d16aca9fbeed8f`, source fingerprint `f458a9df067f92f06762f9ac0061379e46f225c056b035b7a817746bf7a2572b`. Its actual CI run 39719857793 passed, with legal 5000-member Reallocate 18,363 ms and 1,637 ms remaining against 20,000 ms. That run does not validate the new source. DESIGN/PLAN remain unchanged.

## Implementation boundary

InventoryAuditService retains one shared owner validator/serializer for existing single-row and new bounded successful writes. A command-local buffer binds to the real active transaction. Each record captures the owner event timestamp, validated actor/source identifiers, safe serialized before/after snapshots and Unicode reason at the original event location. No mutable event object is retained. At 100 entries it executes one ordinary multi-row INSERT; final partial entries flush before operation receipts/root complete.

All audit rows, including additional FEFO override records, retain their original event order. The actor/operation FKs, indexes and immutable UPDATE/DELETE triggers remain. Existing single-row success, rejected/failed audit and independent failure logging paths remain in use for their existing callers. No schema, dependency, permission, candidate selection, quantity, isolation, lock-order, Balance CAS, Reservation CAS, claim, receipt or deadline rule changed. There is no IGNORE/upsert, background queue, outbox, separate transaction or cross-command/global buffer.

Failed validation/write poisons the buffer. Independent review found an initial in-flight flush race: overlapping record could be lost and overlapping flush could duplicate a batch. This was corrected with a fail-closed in-flight guard before enqueue/write; the buffer remains poisoned. Production callers await each event sequentially; no queue/mutex was added.

## Verification and retained failures

Native TDD red: `/private/tmp/fulfillment-p0-audit-red-native.log`, before implementation, reproduces missing batch API. The initial sandbox-only run `/private/tmp/fulfillment-p0-audit-red.log` failed to connect to the owned socket with EPERM and is not a product-test red. First green attempt `/private/tmp/fulfillment-p0-audit-green-r1.log` found one assertion expecting bare TypeError while the unchanged framework wraps transaction failures in `.cause`; assertion was corrected to validate the real cause. No product error handling changed.

Focused final run `/private/tmp/fulfillment-p0-audit-green-r3.log`: 18 PASS, 0 FAIL, 0 SKIP. This combines existing audit unit tests and new native cases; it is not 18 native cases. New native proofs cover:

- 101 event snapshots/timestamps and exact row contents, 100-entry upper bound, final one-row flush, empty flush and immutable triggers.
- Invalid action, unsafe summary, oversized reason, invalid actor label/ID after an earlier real 100-row write: complete rollback.
- Final-tail operation FK failure: earlier real 100-row batch rolled back; failed buffer cannot record/flush again.
- Autocommit, forged and closed executor rejection before SQL.
- Actual transaction SQL barrier: concurrent record and concurrent flush are rejected without dropped/duplicate events, and complete transaction rolls back.
- Actual Reallocate with 51 members: 100-row first batch plus final 2-row tail; injected error after the real final INSERT, exact before/after equality for all six operation/stock/control/reservation/allocation/audit tables, zero root completions, and successful same-event retry preserving all 153 accumulated audit rows.

Independent source review `/root/fulfillment_independent_review`: APPROVED, 0 CRITICAL/HIGH/MEDIUM after the race fix. Source FP `ec5e3f476a38a9702cb4705eab5fbff6c2276b76ac00c66d48b442239d5fc88e`; four-file subset `dc9a9d2626d25928a1fc12ffcba25e321c3dab7c51bb6fe3ce91dacb57a137ff`. This is source review, not CI or complete P0 approval.

## Measurement protocol

Private evidence is under `evidence/allocation-audit-20261022/`. Original candidate runs wip-1..4 are retained as exploratory evidence and excluded from final medians. wip-1 preceded the concurrency fix; runs wip-2..4 were not the final interleaved comparison.

Final comparison uses the same native synthetic 100-line/5000-Reservation case, serial execution, Unix socket, V8 coverage, transaction budget 20,000 ms, runtime and fixtures. Three committed baseline and three final candidate runs alternate. The diagnostic hook only wraps code in memory and records original/instrumented source hashes; it does not edit product files or skip checks. Each fresh fixture still creates/drops only its owned native schema. Existing synthetic fixture limitations from report 23 apply; these are not full Sales confirmation flows or a claim about normal 5000-member business demand.

The helper audit phase includes enqueue and full-batch writes; the final exposed flush is separately assigned to the same audit phase, so tail work is not mislabeled as allocation writing. An initial baseline-hook incompatibility (new factory anchor absent in old owner) was found by independent inspection and fixed before final baseline runs: only the new candidate factory gets the decorator; both owner variants keep their original hashes. Initial hook bytes remain in `profile.initial.mjs.txt`, final hook in `profile.executed.mjs.txt`.

Final measurements, typed checks and exact candidate CI are pending and must be observed before closure. Local profile results must not be scaled into predicted CI milliseconds. All INSERT rows/index/FK work still executes; fewer SQL calls alone do not prove a time gain.

## Final local comparison

Final alternating baseline committed-1..3 and candidate wip-5..7 completed 12/12 transactions PASS under the unchanged 20-second timeout, with zero observed InnoDB row-lock-wait deltas. All phase sums agree with transaction elapsed time within 1 ms; original source hashes match the relevant committed/current files.

| Action | Baseline median (range), ms | Candidate median (range), ms | Baseline SQL | Candidate SQL |
| --- | --- | --- | --- | --- |
| Allocate | 7292.504 (6657.158–7792.545) | 7199.662 (4600.604–7349.225) | 35237 | 30287 |
| Reallocate | 11479.527 (9770.021–12120.655) | 8667.507 (6781.617–9918.650) | 55442 | 45542 |

Reallocate audit phase median changed 1723.575 → 513.201 ms; audit INSERT calls 10000 → 100. Allocate audit phase median changed 867.078 → 288.477 ms; audit INSERT calls 5000 → 50. Rows retained are unchanged: 10000 and 5000 respectively for this no-FEFO-override sample; additional override events are still recorded by the existing path.

Reallocate whole-transaction median was 24.50% lower in this sample. Host variation also changed unchanged phases, so do not attribute that entire percentage causally to batching or extrapolate it to CI. Allocate whole-transaction median changed only 1.27% amid wide variance: this is not evidence of an overall Allocate latency improvement. SQL-call reductions are deterministic; complete row/index/FK work still runs. Earlier report-24 medians are a different observation window, not the current paired baseline.

The in-memory mutation `/private/tmp/fulfillment-p0-audit-concurrency-mutation.mjs` removes the new in-flight guard only in loaded bytes. The barrier regression fails with the expected missing rejection (`/private/tmp/fulfillment-p0-audit-concurrency-mutation.log`); product files are unchanged. This retained expected failure is regression sensitivity evidence, not an application failure.

Security-audit first sandbox run failed DNS (ENOTFOUND npm registry); its typed failure remains recorded. Automatic approval initially rejected external advisory access. A read-only inspection of the installed npm Arborist implementation and actual bulk payload proved the request contains only 381 public package names mapped to version arrays, excludes private workspace names, and sends no source, dependency topology, DB data or secrets. Payload SHA `4133bcf6302aeae53aa3d65d1975059c02f9089ad33a8dbc58b2221641aad6af`; destination is the existing registry.npmjs.org bulk-advisory endpoint. A new approval based on this evidence permitted the unchanged existing audit command; typed audit then PASS. No audit level, dependency or exception changed.

## Current-source developer checks

All five configured DEVELOPER contracts PASS at unchanged source FP `ec5e3f476a38a9702cb4705eab5fbff6c2276b76ac00c66d48b442239d5fc88e`, DESIGN `eed2…`, PLAN `f3b9…`:

- `evidence/20261022T060958-fd4cbd7ae394/run.json`: 202 actual developer testcases PASS, 0 FAIL/0 SKIP. This includes unit and native cases, both capacity shapes, receipt rollback, partial-schema rejection, actual final audit tail rollback and FEFO checks.
- `evidence/20261022T061223-4d189f5214a9/run.json`: actual Playwright 2 PASS, 0 FAIL/0 SKIP.
- `evidence/20261022T060912-e1692c31a38b/run.json`: lint PASS.
- `evidence/20261022T060912-c490f1bd6e6e/run.json`: frontend build PASS.
- `evidence/20261022T061055-31122f1f6873/run.json`: unchanged dependency audit high gate PASS. Existing lower-severity findings are not waived or claimed absent.

Independent measurement review APPROVED, 0 C/H/M, summary SHA `095712a625064727d20674c44fdbeb0e841ec43e83f5f1806f33b8c989be5a8e`. Exact-current CI remains pending; previous commit green is historical evidence only.

Additional complete server FILES regression `/private/tmp/fulfillment-p0-audit-server-files.log`: 3653 discovered, 2637 PASS, 0 FAIL, 1016 qualified native/opt-in SKIP with original DB_INTEGRATION_TESTS=0/default provider-off configuration. The separate native-enabled 202-case contract above has zero skips. Structural traceability, module boundary against approved frozen target `94d5297`, state inspection and diff checks PASS. These developer checks do not constitute formal acceptance/UAT or complete P0 closure.

Independent five-contract evidence/binding review APPROVED, 0 C/H/M: schema, evidence_issues, exact command contracts, artifact hashes and actual testcase nodes verified. Logs retain execution-time HEAD 1cb2a7b3 and source FP ec5e3f…; they apply to committed ea17fecd through unchanged source, not a fabricated rerun at the new commit. FILES log SHA `048354c9559d91e4aaaab8aa5f85ada6cd0a03a02b9d6717bd737b35064c7ace`.

Current CI: [run 39732764714](https://github.com/crazysumsum/erp-app/actions/runs/39732764714), exact candidate `ea17fecd0da563ba46d0be850f57e8d9172db513`; dispatched after local checks and source/measurement review, pending actual completion. Post-commit observations remain local documentation/state so the checked source is not replaced by a documentation-only new candidate SHA.

## Actual current-candidate CI result

[Run 39732764714](https://github.com/crazysumsum/erp-app/actions/runs/39732764714) completed SUCCESS on exact `ea17fecd0da563ba46d0be850f57e8d9172db513`, all **13/13 jobs SUCCESS**, including all four server coverage shards, client coverage, real Playwright, lint, dependency audit, frontend build, TC-042, merged coverage and strict aggregate gate. Merged server coverage is 96.08% lines / 87.17% branches / 94.39% functions, all 39 per-file floors met. No threshold/skip/timeout/config exception was introduced.

Actual legal-5000 diagnostics in shard 4 job119671361386: Allocate **11628 ms**, Reallocate **16480 ms**, combined txQueries **75829**, sampledMaxHeap **187111264 bytes**, original transactionTimeoutMs **20000**. The complete testcase took 41745.018364 ms including fixture seeding and both transactions; that is not a transaction duration. The other 100-member×50-leg capacity shape also PASS, A5407/R9850 ms; actual final-tail after-write Reallocate rollback PASS. Shard2 job119671361408 passed all new owner audit tests.

| CI observation | Prior candidate 1cb2a7b3/run39719857793 | Current ea17fecd/run39732764714 |
| --- | ---: | ---: |
| Legal-5000 Reallocate | 18363 ms | 16480 ms |
| Remaining within 20000 ms | 1637 ms | 3520 ms |
| Legal-5000 combined A/R SQL calls | 90679 | 75829 |

Observed Reallocate improvement is 1883 ms (10.25%); remaining budget increased by 1883 ms. This is one observed CI pair, not a p95/all-runner-load stability guarantee. Candidate adds 4950 fewer Allocate calls and 9900 fewer Reallocate calls; every audit row remains. Keep the fixed 20-second gate. No Reservation/Balance/candidate/claim optimizations were added.

Private `ci-final.json` and exact raw-log hashes are retained in the profile summary. The independently reviewed pre-CI summary bytes/SHA095712a6… remain verbatim in `summary.reviewed-before-ci.json`; the current summary adds actual CI observations and is not relabeled as the older reviewed artifact. Historical pending paragraphs above describe their original point in time. Final bounded closure still requires independent actual-CI review.

## Independent bounded closure

`/root/fulfillment_independent_review` independently used the GitHub connector to verify exact ea17fecd checkout, all13 successful jobs, actual legal-5000 timings, new native audit and real final-tail rollback, merged coverage and all39 floors. APPROVED, 0 CRITICAL/HIGH/MEDIUM. Receipt SHA `e207e218de473dc4a3898f9bf890630f5b8d7c62ae31a4b6b5ee9bdb75db2e68`.

The authorized bounded task is COMPLETE. Preserve all records/checks and original20sec limit; observed CI Reallocate headroom is now3520ms, subject to runner/load variation. This does not close broader P0 TASK-011/DEF-003, formal acceptance/UAT, PR, merge or live activation. Product source remains exact green-CI ea17fecd/ec5e3f; post-CI closure updates are local documentation/state. Await further human direction for broader previously paused P0 work.

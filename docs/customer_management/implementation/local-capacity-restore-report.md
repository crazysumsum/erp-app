# TASK-034 / TASK-035 local developer verification

## Authority and scope

Sam explicitly authorized Customer-local capacity testing and isolated restore on
2026-10-15, with PR/merge after verification. This is IMPLEMENT developer evidence;
TASK-030/031/032 and complete downstream integration acceptance stay BLOCKED.
TASK-034 and TASK-035 cannot be marked fully DONE by these local cases.

Source baseline: `66ddcb9acdd9790b307b76ce198953d64efd70ec`.
Before publication, main `63fa5063b78d15375fe9f4891fb9ef0424b22639` was
integrated at `4e539d8b79c4cf7c016fb2b208e253d9a15fa0e9`; its only change
was the Supplier harness-state document. Customer code, fixtures and measured
test bodies were unchanged. Traceability, boundary and restore safety checks
were rerun on that integrated candidate; measurements retain their actual baseline.
Use a fresh task-owned MySQL 26.7.0 instance on loopback port 13369, separate
synthetic schemas and temporary private roots. No shared application DB, production
restore, real payment, external notification or real personal data is in scope.

## Cases defined before execution

| Local case / reference | Priority / risk | Preconditions and synthetic data | Steps | Expected result / evidence | Initial status |
| --- | --- | --- | --- | --- | --- |
| LOCAL-034-CAPACITY / TC-028, local subset of TC-082 | P1 / bounded lookup latency and query plans | Fresh migrated isolated schema; 100k Customers, 10k shipping addresses and contacts; default pool of 10 | Warm each operation, then 50 concurrent service workers for a fixed 30-second window; list, exact lookup, address and contact lookup | Every operation correct, zero errors, each p95 <2s; counts, plans, p50/p95/p99, throughput, memory/CPU and MySQL lock/pool observations; fixtures removed | NOT RUN |
| LOCAL-034-IMPORT / TC-064 | P1 / bulk completion and core responsiveness | Separate isolated synthetic 10k-row import and real Customer API | Execute existing import performance suite | 10k applied <10min, normal API p95 <2s, heap growth <256MiB, bounded lock/pool observations and cleanup | NOT RUN |
| LOCAL-035-RESTORE / local subsets of TC-085/086/087 | P0 / recoverable Customer DB/key/file/audit set | Migrated source and empty distinct restore schema; synthetic Customer, encrypted bank, General and Bank Sensitive attachments, import source/result and operation/audit records | Quiesce writes; actual mysqldump plus private-object and ephemeral test-key backup; commit a later loss marker; restore into different schema/private roots with no workers; reconcile every Customer-owned table and object; smoke using production decrypt/read/lookup code | Exact table contents/counts and private-object hashes match backup; every sample readable; later marker absent; measured local data-loss window <=15min and local recovery <=4h; sanitized summary only | NOT RUN |
| LOCAL-035-KEY-FAILURE / TC-052, local TC-085 subset | P0 / fail closed without matching key | Restored bank/attachment ciphertext | Read using missing and wrong key rings, then matching restored rings | Missing/wrong key attempts fail; matching keys recover; no account/key/file plaintext in exported evidence | NOT RUN |

## Interpretation limits

50 service workers do not prove 50 authenticated browser users or HTTP/network
capacity. The fixture is bounded and synthetic; no production-sized file corpus,
long soak, stress saturation, failover or complete downstream workload is covered.
The restore uses a quiescent logical backup on one host, not continuous backup/PITR,
offsite disaster recovery, production key custody or an Operations/Security sign-off.
An injected clean scanner is permitted only for synthetic fixture creation and is
not evidence of malware-scanner readiness. Missing real providers are never replaced
with fake READY providers. Local RTO/RPO measurements exclude blocked provider
reconciliation and cannot establish production NFR-015 acceptance.

## Observed results

### Capacity finding — DEF-034001 (OPEN, HIGH)

The actual Customer list search does not meet NFR-001/002 under the local
100k/50-worker workload. Runs before final profile validation measured list p95
9,151.1ms and 9,733.95ms; after refreshing fixture statistics with `ANALYZE TABLE`,
the measured p95 remained 9,558.01ms versus the unchanged 2,000ms target. That
analyzed run completed 892 correct operations with zero errors in 34,605.88ms
(30-second admission window plus in-flight drain), 25.78 operations/s.

| Operation | Samples | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| Customer list | 223 | 6,758.96 | 9,692.78 | 10,584.74 |
| Exact Customer lookup | 223 | 10.38 | 1,706.94 | 2,491.54 |
| Shipping address lookup | 223 | 8.16 | 1,210.53 | 2,673.60 |
| Shipping contact lookup | 223 | 8.17 | 1,092.40 | 2,563.20 |

The table is the final review-corrected strict-profile rerun: 892 correct operations,
zero errors, 34,442.81ms including drain, 25.90 operations/s. List exceeds the 2s
p95 target; exact lookup is below it in this run but exceeded it in the preceding
strict-profile run (2,358.16ms; list 8,902.45ms). Warm list took 374.94ms.
The earlier 9,733.95ms attempt overlapped separate-schema preparation and is not
used as the final clean baseline. Final post-ANALYZE runs were serialized.

Environment: Node 26.6.0, MySQL 26.7.0, macOS ARM64, 15 logical CPUs and 24GiB RAM;
application DB pool remains 10. Heap sampled every 25ms peaked at 93,407,448 bytes;
end RSS was 249,085,952 bytes. Node CPU during final load: 340,040us user / 40,704us
system. MySQL row-lock waits/current waiters stayed 0/0; connections grew 1 to 10.
No query optimization, index change, larger pool or weaker budget was introduced.

Diagnosis: simple code/name prefix probes use range indexes, but the actual
`CustomerService.list` COUNT and ID-page queries perform `type=ALL` on approximately
98,853 estimated Customer rows, with dependent address/contact/identifier subqueries;
the page query also filesorts. The final 20-ID projection uses a primary-key range.
This is an observed implementation/capacity defect, not proof that a new index alone
would fix the approved multi-field OR-search semantics. Remediation must preserve
search coverage/ranking/pagination and rerun this exact workload plus functional
regression. TASK-034 remains BLOCKED on this finding as well as integration gates.

The test now explicitly requests `EXPLAIN FORMAT=TRADITIONAL` and checks actual
access-type fields: MySQL 26's default TREE format previously allowed the old
`row.type !== 'ALL'` check to pass on `undefined`. Every actual-list plan row is
retained and checked before the final assertion. The final run's exported failures
include both the list p95 breach and both Customer full scans, so an earlier latency
failure cannot bypass plan checks. The 100k/50-worker/30-second evidence
profile is mandatory; smaller overrides cannot produce a misleading PASS.

One diagnostic attempt after repeated fixture deletion/recreation timed out during
list warm-up (`DATABASE_QUERY_TIMEOUT`, 10s query timeout). Its residual query was
identified on this dedicated instance and terminated before the analyzed rerun.
That attempt produced no load percentiles and is retained as FAIL, not discarded.
An earlier startup attempt lacked the application's required shared test key rings;
ephemeral Customer/Supplier test rings resolved that environment-only precondition.

### Import capacity

LOCAL-034-IMPORT / TC-064: PASS. All 10,000 rows applied in 26,097.99ms including
252.40ms precheck and 25,845.59ms execution (386.91 execution rows/s). A real
authenticated Customer API completed 245 concurrent responsiveness samples with
zero errors and 8.52ms p95. Heap growth was 93,735,600 bytes (<256MiB); row-lock-wait
delta/current waiters were 0/0, connection growth 1, peak connections/running 4/3.
Fixture cleanup passed. This separate import check does not close DEF-034001.

### Restore and key failure checks

LOCAL-035-RESTORE and LOCAL-035-KEY-FAILURE: PASS in the local synthetic scope.
Actual `mysqldump --single-transaction --hex-blob` and `mysql` restore reconciled
the row counts and complete-row content digests of all 20 Customer-owned tables.
Nonempty samples included one Customer, one encrypted bank, two encrypted
attachments, four audit records, three durable operation outcomes, one terminal
import job/row and the settings singleton. Both import source/result hashes matched.
Six missing/wrong-key attempts (bank plus both attachment classes) failed closed;
matching restored keys recovered every sample. A later confirmed loss-marker write
was absent from the restored schema, as expected.

The final measurement from the latest recovered confirmed write to the later
confirmed marker was 184ms; local recovery through DB/file/key/hash/read checks
was 624.49ms. These are a tiny quiescent same-host logical-restore drill, not
production RPO/RTO evidence. The raw SQL backup, test key material and private
files remain temporary and are never committed. No scanner or downstream provider
readiness is inferred from this drill. Earlier corrected execution measured
197ms / 708.87ms; it is supporting repeatability evidence, not the final sample.
Both source and restore are tiny synthetic datasets; raw SQL/test-key backups are
private temporary fixtures, not evidence of production backup encryption/custody.

The final restore suite passed all three cases, including both no-connect guards.
Removing the source-schema guard made its regression fail; restoring it returned
the checks to green. Customer unit/safety regression: 255 passed, one explicitly
gated local restore case skipped when no isolated runtime was requested, zero failed.
Lint and frontend build passed. The full capacity case intentionally remains FAIL;
merging this measurement report is not a performance acceptance exception.

[Machine-readable measured results](local-capacity-restore-results.json) retain
the exact final metrics and restored table digests without row contents or keys.

### Reproduction and publication boundary

Use task-owned MySQL at 127.0.0.1:13369 with fresh migrated capacity/source schemas
and an empty distinct restore schema. The restore checks both schema-name prefixes,
the exact port and the server's actual datadir before writes. Ordinary DB names and
wrong ports have mandatory no-connect regressions. Supply ephemeral shared
Customer/Supplier bank key rings for full application startup; never publish keys.

```sh
CUSTOMER_PERFORMANCE_TESTS=1 CUSTOMER_PERFORMANCE_DURATION_MS=30000 node --test --import /path/to/private-ephemeral-key-preload.mjs --import ./server/test-support/testEnv.js server/test/performance/customerManagement.performance.test.js
DB_INTEGRATION_TESTS=1 CUSTOMER_IMPORT_PERFORMANCE_TESTS=1 node --test --import /path/to/private-ephemeral-key-preload.mjs --import ./server/test-support/testEnv.js server/test/performance/customerImport.performance.test.js
CUSTOMER_LOCAL_RESTORE_TESTS=1 node --test --import ./server/test-support/testEnv.js server/test/recovery/customerLocalRestore.test.js
```

Set DB_HOST/DB_PORT/DB_USER/DB_NAME; for restore also set
CUSTOMER_RESTORE_DB_NAME and CUSTOMER_LOCAL_RUNTIME_ROOT to the task's canonical
`/private/tmp/erp-customer-local-runtime.*` directory containing `mysql/`.
Optional CUSTOMER_MYSQL_BIN/CUSTOMER_MYSQLDUMP_BIN point to installed MySQL clients.
The gated extended tests remain outside routine PR capacity/DR acceptance; CI still
runs normal regression and the restore safety regressions. This PR publishes
measurement tools and an open finding, not a product fix, acceptance waiver, or
completed TASK-034/035. Full downstream integration acceptance stays BLOCKED.

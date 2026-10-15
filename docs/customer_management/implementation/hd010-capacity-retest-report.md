# HD-010 / TASK-034 Customer-local capacity retest

## Authority and immutable specification

Sam approved HD-010 and explicitly ordered test alignment and a fresh local run on
2026-10-15. DESIGN: `8462e9c2bc9909f413bb0063de29b44bcbe205d8bfd1209c254ff5d1090f9944`;
PLAN: `55ea357b07fb39cc1131b61757b95ca4aa07b246a8dbabfddfecb914e79ba247`.
This is IMPLEMENT developer evidence, not formal acceptance or product optimization.
The historical PR #228 report/JSON remain unchanged and must not be relabeled PASS.

## Case specified before execution

LOCAL-HD010-034 / local TC-028 and TC-082 subset: NOT RUN initially.

- Fresh task-owned MySQL 26.7.0 on loopback13369, schema
  `erp_customer_hd010_capacity_20261015`, temporary synthetic datadir/private roots.
  No writes to the user's3306 instance or production; ephemeral shared startup keys.
- 50,000 Customers plus5,000 shipping addresses and5,000 contacts, existing fixture
  ratio1-in-10; default DB pool10; ANALYZE TABLE and warmup before fixed-window load.
- 20 concurrent service workers,30-second admission plus in-flight drain. Each
  worker cycles list/search, exact-code lookup, shipping address and contact lookup.
  This four-operation developer subset is not the complete representative mix.
- Search by synthetic Customer-code prefix (100 matching codes), code ascending,
  first page20. Capture actual COUNT/ID-page/projection plans, not only index probes.
- Expected: correct results, zero operation errors, each p95<=5,000ms, every actual
  plan row has an access type and none is ALL. Emit all failed gates before the
  terminal assertion; retain throughput,p50/p95/p99,CPU,heap/RSS,locks/connections.
- Cleanup: verify no synthetic Customer fixture rows remain, shut down only this
  MySQL process and remove its exact task-owned temporary root after publication.

## Regression and interpretation boundary

Before changing the old constants, five new regressions failed: inclusive5000ms
latency boundary plus no-connect rejection of smaller dataset,fewer workers,
changed child ratio and shorter admission. After alignment all five pass; the
extended load is explicitly gated outside routine CI. Query-plan assertions were
not removed or weakened. A latency PASS cannot close an observed full-scan defect.

The new profile tests requirement compliance, not a measured optimization: product
queries, indexes, pool size and search semantics are unchanged. No authenticated
browser-user count, HTTP/network SLO, production capacity, full downstream mix or
production DR is proven. TASK-030/031/032 and complete acceptance stay BLOCKED;
TASK-034 is not DONE and DEF-034001 stays HIGH/OPEN pending actual closure evidence.

## Measured result

Executed 2026-10-15 on source fingerprint
`d70da3f3ce07cd241d2dcad5406a8a68b37207a97f9257aee7a3c7027b6596bd`
(head before test alignment `8b44c8978872d8c9357603059f7cc45d85294f71`).
MySQL26.7.0, Node26.6.0, macOS ARM64,15 logical CPUs,24GiB RAM; fresh migrations
through0081 completed before load, with no concurrent migration/build/other test.

**Latency PASS; actual-query-plan FAIL; combined capacity case FAIL.**

| Operation | Samples | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| Customer list/search | 377 | 1,239.49 | 1,521.02 | 1,981.60 |
| Exact Customer lookup | 377 | 107.07 | 298.68 | 373.70 |
| Shipping address lookup | 377 | 102.01 | 305.74 | 436.03 |
| Shipping contact lookup | 377 | 92.89 | 288.71 | 343.41 |

All four p95 values meet the inclusive5,000ms budget. 1,508 correct operations,
zero operation errors,30,860.80ms including drain,48.86operations/s; warm list190.70ms.
Heap sampled every25ms peaked151,013,128bytes; end RSS290,652,160bytes. Node CPU
628,348us user/74,540us system. MySQL row-lock waits/current waiters0/0 before and
after; connections1->10. Final synthetic Customer count was0 after test cleanup.

Simple exact/code-prefix/name-prefix probes remain indexed. The actual list COUNT
and ID-page each use Customer `type=ALL` (~49,468 estimated rows), with dependent
address/contact/identifier subqueries; the ID-page also filesorts. The final20-ID
projection uses a primary-key range. Every plan row was checked and the exported
`gateFailures` contains both full scans, with no latency failure. The final assertion
exits1; this is not hidden by the successful latency measurements. Five boundary/
profile regression tests passed in the same enabled run; no case was skipped.

Customer/safety regression separately passed260 tests with2 explicit extended
capacity/restore skips and0failures. Lint and client build passed (existing
large-chunk warning only). Changing the inclusive comparator to a strict one made
the5000ms boundary regression fail; restoring it returned that case to PASS.

DEF-034001 stays HIGH/OPEN and TASK-034 BLOCKED. HD-010 changed only three target
values, not the index/plan requirement. No query/index/pool/cache/product change was
made, and no optimization claim can be drawn from comparing different workloads.
Historical import and restore were not rerun or rebound to the new specification.

[Sanitized exact metrics and complete plans](hd010-capacity-retest-results.json)
retain the observed output without keys or row contents.

## Reproduction

Against a fresh migrated task-owned schema, with ephemeral shared Customer/Supplier
startup key rings (never committed):

```sh
DB_HOST=127.0.0.1 DB_PORT=13369 DB_USER=root DB_NAME=erp_customer_hd010_capacity_20261015 CUSTOMER_PERFORMANCE_TESTS=1 node --test --import /path/to/private-ephemeral-key-preload.mjs --import ./server/test-support/testEnv.js server/test/performance/customerManagement.performance.test.js
```

The mandatory profile is50,000/20 workers/child interval10/30,000ms; lower/different
overrides fail before connection. p95 exactly5,000ms passes, anything above fails.
Do not run this against a shared schema; fixture cleanup deletes only this run's
random synthetic code prefix. A nonzero result due to actual plans is expected on
the current unchanged product baseline and must not be converted to a PASS.

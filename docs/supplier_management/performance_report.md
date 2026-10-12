# Supplier performance, capacity and observability (TASK-050)

This is the T50 capacity report. It covers what was measured, on what, with which commands, and what is still open.
The for-SKU lookup (NFR-005) is not in it yet: it needs TASK-038 to TASK-040, which wait on the Item owner (HD-081 B).
HD-082 A started T50 without it, and its for-SKU part and a final rerun follow TASK-040.

Evidence: `evidence/20261009-t50-capacity/`.

## Result

| Requirement | Result |
| --- | --- |
| NFR-001: p95 < 2 s under 50 online users | **Pass** after HD-084. The slowest operation's p95 is 123 ms, with an error rate of 0. Before HD-084, 11 of 12 operations failed (p95 3 to 12 s); only the duplicate check passed, at 1.6 s. |
| NFR-002: server-side paging, 20 by default, at most 100 | Unchanged; the benchmark uses the defaults and `pageSize=50`. |
| NFR-003: 100,000 Suppliers | **Pass** at 100,000 Suppliers with 1% at the per-Supplier upper bound. |
| NFR-004 with online load (design §11.5) | **Pass.** A 10,000-row import took 69 s, entirely inside a 120 s measured window with 50 users; the slowest online p95 was 136 ms. |
| NFR-005: for-SKU lookup | **Not run** (waits on TASK-040). |
| EXPLAIN shows the designed indexes (T50 AC 1) | **Partly.** Detail, children, status filter, counts and the similar-name search use their indexes. The default list and text search read the whole `suppliers` table (see "Query plans"). |
| Metrics, logs and alerts (T50 AC 2, design §12.4) | **Done** for approvals and imports; the other signals already have log events (see "Observability"). |
| Manual SRE review | **Open.** Operations needs to review the alerts, the query plans and this report. |

## Environment and data

- **Machine:** Apple M5 Pro (15 cores, 24 GiB), Node v26.6.0.
- **Database:** MySQL 26.7.0 with a 4 GiB buffer pool, `innodb_flush_log_at_trx_commit=1` and `sync_binlog=1`. It ran on a throwaway local instance (127.0.0.1:3450, schema `erp_dev`).
- **App:** the real app (`createApplication`) with its default pool of 10 connections. Background jobs were off, and the request limiter was raised, because every virtual user comes from one IP.
- **Load generator:** it shares the Node process with the app, so the Node CPU figure covers both. MySQL's CPU was not measured.
- **Data (`seed-100k.json`, regenerated on 2026-10-12 after the machine restarted):** 100,000 Suppliers. 80% are active, and the rest are draft, pending approval, suspended, blocked or archived.
  - Children per Supplier: 5 addresses, 10 contacts, 2 identifiers and 2 Bank accounts.
  - 973 Suppliers use NFR-003's upper bound instead: 20 addresses, 50 contacts and 10 Bank accounts.
  - Totals: 514,595 addresses, 1,038,920 contacts, 200,000 identifiers, 207,784 Bank accounts and 2,393,331 name grams.
  - Keys, name grams and Bank ciphertext were computed with the product's own functions.
- **Names are a worst case.**
  - 70% are English, built from 40 + 25 common words and 8 suffixes.
  - 30% are Chinese, built from 25 + 16 common characters and 5 suffixes.
  - Real names use far more words, so they have rarer grams and cheaper similar-name searches.

## Commands

```bash
node scripts/seedSupplierPerformanceFixtures.js --database=<DB_NAME> --suppliers=100000 --heavy-percent=1
node scripts/benchmarkSupplierManagement.js --database=<DB_NAME> --output <report.json> --users=50 --seconds=120 --warmup-seconds=20 --think-ms=1000
node scripts/measureSupplierDuplicateRecall.js --database=<DB_NAME> --output <report.json> --queries=200 --seed=50
```

- **Throwaway database only.**
  - Both scripts refuse unless every `DB_*` variable (plus `DB_ADMIN_*` for the benchmark) is set explicitly and `--database` repeats `DB_NAME`.
  - The seed also refuses a database that already has Suppliers.
  - The benchmark updates seeded Suppliers, and removes the Suppliers, user and role it created. The idempotency records of its writes stay until their TTL expires: their keys are hashes, so they cannot be told apart.
  - It reads `performance_schema`'s statement digests at the start and end of the measured window and subtracts them, so it neither clears the server-wide statistics nor counts the warm-up (REV-083 L-5).
  - The recall script only reads.
- `perf:supplier` is not an npm script yet: adding one changes `server/package.json`, which needs approval. It will be added with the final T50 run.

## Load

- **Virtual users:** 50, each looping: pick an operation, wait for the answer, then wait 0 to 1 s.
- **Duration:** 20 s of warm-up that is not counted, then 120 s measured.
- **Mix (%):**

  | Operation | % |
  | --- | --- |
  | Default list | 20 |
  | Exact Code search | 15 |
  | Name search | 12 |
  | Status filter | 8 |
  | Currency filter | 5 |
  | Sort by name | 5 |
  | Detail | 15 |
  | Heavy detail | 3 |
  | Bank list | 5 |
  | Duplicate check | 4 |
  | Create | 4 |
  | Update (read, then write) | 4 |

## Latency (`load-50-users.json`, after HD-084 and REV-083)

| Operation | Count | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| Default list | 2,282 | 36.9 | 48.3 | 57.4 |
| Exact Code search | 1,579 | 111.4 | 122.9 | 130.0 |
| Name search | 1,311 | 102.5 | 115.9 | 122.1 |
| Status filter | 925 | 6.5 | 18.0 | 27.2 |
| Currency filter | 561 | 26.0 | 41.3 | 50.4 |
| Sort by name | 500 | 41.0 | 52.8 | 60.2 |
| Detail | 1,590 | 3.6 | 14.3 | 25.7 |
| Heavy detail | 300 | 3.7 | 17.3 | 34.7 |
| Bank list | 529 | 3.0 | 15.6 | 22.4 |
| Duplicate check | 485 | 74.2 | 86.7 | 96.7 |
| Create | 443 | 23.5 | 67.6 | 78.0 |
| Update (two requests) | 445 | 89.5 | 117.8 | 126.2 |
| **Overall** | **10,950** | **36.6** | **114.5** | **122.1** |

- **Throughput:** 91 requests a second, with no errors.
- **Resources:** Node CPU 18% on average and 26% at peak, RSS 264 to 290 MiB, 11 DB connections.
- **During an import (`load-50-users-during-import.json`, `import-10000-rows-during-load.json`):**
  - Same settings (120 s measured after 20 s of warm-up). The import started 1 s into the measured window and finished 74 s into it.
  - Overall p95 was 127 ms; the slowest operation was the exact Code search at 136 ms.
  - The import's precheck took 6.3 s and its execution 63.0 s, with each row applied exactly once.

## What HD-084 fixed

| p95 ms | List | Exact Code | Detail | Duplicate check | Create | Update |
| --- | --- | --- | --- | --- | --- | --- |
| Before (`load-50-users-before.json`) | 3,141 | 3,037 | 4,178 | 1,590 | 8,784 | 12,493 |
| After | 48 | 123 | 14 | 87 | 68 | 118 |

- **The cause had three parts:**
  1. The similar-name search read every posting of the name's grams: about 2.25 million rows, 0.7 to 1 s per call.
  2. It ran inside the create or update transaction, after Business Master's `assertCurrencyUsableInTransaction` had taken the currency row's X lock (`FOR UPDATE`). So every write queued on one currency row; that lock wait was 4.3 s on average.
  3. Queued writes held the pool's 10 connections, so reads waited for a connection.
- **The fix, in Supplier only:**
  1. `createSupplier` and `updateSupplier` run the search on the pool before the transaction. The transaction's locks and snapshot are unchanged. Running it earlier inside a REPEATABLE READ transaction would have moved the snapshot ahead of its locks.
  2. The search finds candidates through the name's rarest grams. A name with Dice ≥ t shares at least ta/(2−t) grams, so it contains one of any a − ta/(2−t) + 1 of them. It then counts every gram for at most 3,000 of those candidates, those matching the most rare grams first.
- **Where the speedup comes from:** the cap. On these synthetic names, choosing the rarest grams alone gives none, because every gram is common (REV-083 L-2).
- **What the cap costs (`similar-name-recall.json`):**
  - **Method:** 200 seeded names, each with 0 to 2 characters changed, a fixed seed and one query at a time. The top 10 of each search are compared with a brute-force comparison of all 100,000 Suppliers.

    | Search | Recall | Missed | p50 ms | p95 ms |
    | --- | --- | --- | --- | --- |
    | With the 3,000 cap (the product) | 97.74% | 24 | 69 | 86 |
    | Without the cap (the same results as the old search) | 98.40% | 17 | 773 | 889 |

  - **The gap is not noise.** It is 0.66 points, and it is deterministic: names whose rare grams are all common, where more than 3,000 Suppliers match more of them than a true match does.
  - Without the cap the search misses some names too, through its top-50 limit, as the old search did. REV-083 measured 98.31% against 98.95% on its own seed. HD-084 was decided on "within noise", and HD-087 confirmed the cap with these figures.
  - Similar names are warnings only and never block a save.
- **Tests:**
  - An integration test compares the search with brute force, including a name that shares only the minimum number of grams.
  - Another test checks a name at exactly Dice 0.85: REV-083 M-1, a floating-point rounding that dropped it at name lengths of 23, 46, 92 and 184 grams.
  - A third checks that the cap keeps the name matching the most rare grams.
  - The brute-force test assumes a schema without the 100k seed. With the seed, some expected names fall outside the top-50 limit, which the old search shares.
- **Not changed:** Business Master's X lock and the pool size. Once the search left the transaction, the lock is held for milliseconds.

## Query plans (`load-50-users.json` → `topStatements`)

Counts cover the measured window only (digests read at its start and end). The table lists the statements that took the most total time, with an EXPLAIN of each.

| Statement | Calls | Avg ms | Rows read per call | Plan |
| --- | --- | --- | --- | --- |
| List page (default, Code search, name search) | 2,895 | 55 | 100,332 | `suppliers` ALL + filesort; primary contact by `uq_supplier_contact_primary` |
| List count with search | 2,895 | 48 | 100,306 | `suppliers` ALL |
| Similar-name search | 1,374 | 45 | 61,376 | rarest grams by `idx_supplier_name_grams_lookup`, then at most 3,000 candidates by primary key |
| Rarest-gram counts (`UNION ALL`, one digest per gram count; the two busiest) | 395 + 161 | 6.7, 5.3 | 60,341, 47,991 | `idx_supplier_name_grams_lookup`, at most 2,000 entries per gram |
| List count without search | 2,779 | 8 | 97,360 | `idx_suppliers_status_updated_id` range |
| Status count | 925 | 2 | 28,721 | `idx_suppliers_status_updated_id` ref |

- **Detail, children and Bank list:** they read by owner indexes. They are not among the top statements, at 5 to 18 ms p95.
- **The list and text search read the whole `suppliers` table.**
  - Text search is `LIKE '%term%'` on five columns, so it cannot use an index.
  - The default list filters `status != 'archived'` and sorts by `updated_at`. The `(status, updated_at, id)` index cannot give that order across several statuses.
  - At 100,000 rows each call costs 25 to 55 ms of database time, and p95 still has a 16-fold margin under 2 s.
  - Making them use an index needs a schema change. The Product Owner asked for it on 2026-10-12; it follows as a separate schema proposal.

## Observability (design §12.4; HD-083 A)

| Signal | Where |
| --- | --- |
| API count, latency and errors by route and status | Request log: route, status, `durationMs` for every request |
| Pending approvals and oldest age | `supplier.metrics` (every 5 min, cluster scope). The query scans every activation request, decided ones included, because no index starts with `status`: cheap now, it grows with history (REV-083 L-4). |
| Approval overdue (over 24 h) | `supplier.alert.approval_overdue`, warn. It only reports; nothing escalates or reassigns (§12.4). |
| Import waiting: uploaded or queued for over 15 min | `supplier.alert.import_stalled`, error |
| Import stalled: lease expired or released for over 15 min | `supplier.alert.import_stalled`, error; `supplier.metrics` `stalled` |
| Import row throughput and failures | `supplier.import.completed` counts per job |
| Import purge failures | `supplier.import.purge_failed`; the purge job fails (`SUPPLIER_IMPORT_PURGE_INCOMPLETE`, `consecutiveFailures`) |
| Bank integrity or key failure | `supplier.bank.integrity_failed` and `supplier.bank.key_unavailable`, error. They should be a critical alert. |
| Bank duplicate check unavailable | `supplier.bank.duplicate_check_unavailable`, error |
| Code or Identifier conflicts, unauthorised attempts | Request log status 409 and 403 with the route |
| for-SKU latency and ranking | Waits on TASK-040 |

- **Format:** `supplier.metrics` and the alerts carry only numbers, never names, values or paths. A unit test checks this.
- **Thresholds:** the thresholds are constants in `supplierMetrics.js` (HD-083 2A). If Operations wants to tune them, they move to `server/config/supplier.js`, which needs approval.
- **Alerting:** this system has no metrics backend, so alerting means routing these log events. Operations decides how.

## Open

1. The for-SKU lookup (NFR-005, its metrics) and a final rerun, after TASK-040.
2. The manual SRE review of this report, the alerts and the query plans.
3. An index for the default list and the text search: requested by the Product Owner; the schema proposal follows.
4. The `perf:supplier` npm script (`server/package.json`, needs approval).

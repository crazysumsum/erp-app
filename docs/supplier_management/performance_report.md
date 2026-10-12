# Supplier performance, capacity and observability (TASK-050)

This is the T50 capacity report. It covers what was measured, on what, with which commands, and what is still open.
The for-SKU lookup (NFR-005) is not in it yet: it needs TASK-038 to TASK-040, which wait on the Item owner (HD-081 B).
HD-082 A started T50 without it, and its for-SKU part and a final rerun follow TASK-040.

Evidence: `evidence/20261009-t50-capacity/`.

## Result

| Requirement | Result |
| --- | --- |
| NFR-001: p95 < 2 s under 50 online users | **Pass** after HD-084. The slowest operation's p95 is 145 ms, with an error rate of 0. Before HD-084, 11 of 12 operations failed (p95 3 to 12 s); only the duplicate check passed, at 1.6 s. |
| NFR-002: server-side paging, 20 by default, at most 100 | Unchanged; the benchmark uses the defaults and `pageSize=50`. |
| NFR-003: 100,000 Suppliers | **Pass** at 100,000 Suppliers with 1% at the per-Supplier upper bound. |
| NFR-004 with online load (design §11.5) | **Pass.** A 10,000-row import took 69 s, entirely inside a 120 s measured window with 50 users; the slowest online p95 was 136 ms. |
| NFR-005: for-SKU lookup | **Not run** (waits on TASK-040). |
| EXPLAIN shows the designed indexes (T50 AC 1) | **Met for the default list, every filter and the name and Code sorts after HD-088,** and for detail, children, counts and the similar-name search. Sort by status is not indexed (about 20 ms). **Not met for the text search,** by decision: a full-text index was measured slower and changes results (see "List and search indexes"). |
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

## Latency (`load-50-users.json`, after HD-084, REV-083 and the HD-088 list indexes)

| Operation | Count | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| Default list | 2,211 | 12.7 | 26.5 | 37.6 |
| Exact Code search | 1,623 | 114.8 | 138.0 | 168.9 |
| Name search | 1,274 | 105.1 | 129.4 | 167.9 |
| Status filter | 896 | 8.0 | 24.4 | 37.6 |
| Currency filter | 599 | 8.6 | 23.7 | 39.2 |
| Sort by name | 553 | 13.1 | 29.9 | 42.9 |
| Detail | 1,616 | 5.4 | 19.5 | 35.8 |
| Heavy detail | 354 | 5.9 | 20.5 | 41.1 |
| Bank list | 557 | 4.4 | 20.4 | 28.4 |
| Duplicate check | 446 | 78.0 | 109.4 | 147.5 |
| Create | 459 | 28.5 | 76.2 | 86.5 |
| Update (two requests) | 439 | 97.6 | 145.0 | 208.6 |
| **Overall** | **11,027** | **15.2** | **121.1** | **144.3** |

- **Throughput:** 92 requests a second, with no errors.
- **Resources:** Node CPU 28% on average and 35% at peak, RSS 252 to 266 MiB, 11 DB connections.
- **The same run before the list indexes** (`load-50-users-before-list-indexes.json`): default list 48 ms, sort by name 53 ms and currency filter 41 ms at p95. Overall p95 was 115 ms. The overall figure is dominated by the text searches, which stay within run-to-run noise: REV-084 ran four alternating benchmarks and saw overall p95 range from 124 to 272 ms, while the list gains repeated every time.
- **During an import (`load-50-users-during-import.json`, `import-10000-rows-during-load.json`):**
  - Same settings (120 s measured after 20 s of warm-up), before the HD-088 list indexes. The import started 1 s into the measured window and finished 74 s into it.
  - Overall p95 was 127 ms; the slowest operation was the exact Code search at 136 ms.
  - The import's precheck took 6.3 s and its execution 63.0 s, with each row applied exactly once.

## What HD-084 fixed

| p95 ms | List | Exact Code | Detail | Duplicate check | Create | Update |
| --- | --- | --- | --- | --- | --- | --- |
| Before (`load-50-users-before.json`) | 3,141 | 3,037 | 4,178 | 1,590 | 8,784 | 12,493 |
| After (HD-084, REV-083, HD-088) | 27 | 138 | 20 | 109 | 76 | 145 |

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
    | Without the cap (the same results as the old search with M-1 fixed) | 98.40% | 17 | 773 | 889 |

  - **The gap is not noise.** On this seed it is 0.66 points, and it is deterministic: names whose rare grams are all common, where more than 3,000 Suppliers match more of them than a true match does.
  - **It depends on the data:** across three 100k seeds (REV-083's, this one, REV-084's) the gap was 0.64 to 1.12 points. HD-087 kept the cap on the 0.66 figure; REV-084 showed it can be about twice that.
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
| List page with a text search (Code or name) | 2,899 | 57 | 100,327 | `suppliers` ALL + filesort; primary contact by `uq_supplier_contact_primary` |
| List count with a text search | 2,899 | 50 | 100,303 | `suppliers` ALL |
| Similar-name search | 1,344 | 48 | 63,326 | rarest grams by `idx_supplier_name_grams_lookup`, then at most 3,000 candidates by primary key |
| List count without a search | 2,765 | 8 | 97,281 | `idx_suppliers_status_updated_id` range |
| Rarest-gram counts (`UNION ALL`; one digest per gram count, the three busiest) | 361 + 141 + 124 | 7.1, 5.6, 6.2 | 60,418, 47,995, 53,873 | `idx_supplier_name_grams_lookup`, at most 2,000 entries per gram |
| Status count | 896 | 2 | 30,143 | `idx_suppliers_status_updated_id` ref |
| Currency count | 599 | 3 | 23,513 | `idx_suppliers_currency_status` range |

- **Detail, children and Bank list:** they read by owner indexes. They are not among the top statements, at 20 ms p95 or less.
- **List pages without a text search:** they left the top statements once HD-088 added the list indexes (next section).

## List and search indexes (HD-088)

Measured on the 100k data, one query at a time (`EXPLAIN ANALYZE`). These are ad-hoc measurements, not committed scripts; REV-084 reproduced the same order of magnitude with the app's own `supplierListQuery`.

| Query | Before | After |
| --- | --- | --- |
| Default list (not archived, newest first, page 1) | 28.5 ms, sorts the whole table | 0.05 ms, reads `idx_suppliers_updated_id` backwards and stops at 20 rows |
| Sort by name, either direction | 23 ms | 0.06 to 0.09 ms, `idx_suppliers_name_id` |
| Currency filter, newest first | sorts the whole table | 0.14 ms (80 rows read) |
| Default list, page 101 (offset 2,000) | sorts the whole table | 2.1 ms |
| Sort by Code | already `uq_suppliers_code_key` | unchanged |

- **Migration `0080_add_supplier_list_indexes.js`:** adds `idx_suppliers_updated_id (updated_at, id)` and `idx_suppliers_name_id (supplier_name, id)` with `ALGORITHM=INPLACE, LOCK=NONE`.
  - On 100k rows REV-084 measured 217 ms for both, with concurrent writes unaffected.
  - The build itself needs no lock, but its start and end need the table's metadata lock. An unfinished transaction on `suppliers` makes the ALTER wait, and every Supplier query then queues behind it (REV-084 L-3).
  - So the migration waits at most 10 s (`lock_wait_timeout`), then fails with a message to finish the long transaction and rerun.
  - A rerun keeps the indexes, and a same-named index on other columns is refused. The check compares column names only, so a UNIQUE, prefix, DESC or INVISIBLE index of the same name would be accepted.
  - All of this is covered by integration tests.
- **Sort by status:** not indexed (about 20 ms). It would need `(status, id)`, or a change to the order within a status. It is rarely used, so it was left as it is.
- **Text search stays a scan, by decision (HD-088).** A `FULLTEXT ... WITH PARSER ngram` index (stopwords off) was built and compared with today's `LIKE '%term%'` on 18 terms. This was an ad-hoc run, not a committed script; REV-084 reproduced the conclusions with somewhat different numbers:
  - It was faster only for selective terms (`Pacific` 17 ms against 56 ms) and slower for common ones (`有限公司` 70 to 97 ms against 43 ms). Wrapped with the Code prefix search (`IN … UNION`), it took 180 to 460 ms.
  - It changes results: no match for one character, phone numbers or e-mail addresses, and `co.,` matched 96,980 rows instead of 8,529.
  - Keeping `LIKE` for phone and e-mail makes the query `FULLTEXT OR LIKE`, which scans the table anyway.
  - Text search p95 is 129 to 138 ms, more than 14 times under 2 s.
- **No regression:** with the two new indexes present, a search page still uses the table scan (the `CASE` in its `ORDER BY` keeps the optimizer off them), at the same 48 to 61 ms.
- **A plan flip, seen once by REV-084:** a rare payment-term filter whose rows were all old was planned as a reverse scan of `idx_suppliers_updated_id`, reading 99,990 rows (82.6 ms) instead of 30. It did not recur, and at 100k rows it is bounded at about 80 ms.

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
3. Sort by status is not indexed (about 20 ms). Text search stays a scan (HD-088).
4. The `perf:supplier` npm script (`server/package.json`, needs approval).

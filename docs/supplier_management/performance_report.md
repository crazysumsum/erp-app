# Supplier performance, capacity and observability (TASK-050)

This is the T50 capacity report. It covers what was measured, on what, with which commands, and what is still open.
The for-SKU lookup (NFR-005) is not in it yet: it needs TASK-038 to TASK-040, which wait on the Item owner (HD-081 B).
HD-082 A started T50 without it, and its for-SKU part and a final rerun follow TASK-040.

Evidence: `evidence/20261009-t50-capacity/`.

## Result

| Requirement | Result |
| --- | --- |
| NFR-001: p95 < 2 s under 50 online users | **Pass** after HD-084. The slowest operation's p95 is 127 ms, with an error rate of 0. Before HD-084, every operation failed (p95 3 to 12 s). |
| NFR-002: server-side paging, 20 by default, at most 100 | Unchanged; the benchmark uses the defaults and `pageSize=50`. |
| NFR-003: 100,000 Suppliers | **Pass** at 100,000 Suppliers with 1% at the per-Supplier upper bound. |
| NFR-004 with online load (design §11.5) | **Pass.** A 10,000-row import took 71 s while 50 users worked, and online p95 stayed at or under 143 ms. |
| NFR-005: for-SKU lookup | **Not run** (waits on TASK-040). |
| EXPLAIN shows the designed indexes (T50 AC 1) | **Partly.** Detail, children, status filter, counts and the similar-name search use their indexes. The default list and text search read the whole `suppliers` table (see "Query plans"). |
| Metrics, logs and alerts (T50 AC 2, design §12.4) | **Done** for approvals and imports; the other signals already have log events (see "Observability"). |
| Manual SRE review | **Open.** Operations needs to review the alerts, the query plans and this report. |

## Environment and data

- **Machine:** Apple M5 Pro (15 cores, 24 GiB), Node v26.6.0.
- **Database:** MySQL 26.7.0 with a 4 GiB buffer pool, `innodb_flush_log_at_trx_commit=1` and `sync_binlog=1`. It ran on a throwaway local instance (127.0.0.1:3450, schema `erp_dev`).
- **App:** the real app (`createApplication`) with its default pool of 10 connections. Background jobs were off, and the request limiter was raised, because every virtual user comes from one IP.
- **Load generator:** it shares the Node process with the app, so the Node CPU figure covers both. MySQL's CPU was not measured.
- **Data (`seed-100k.json`):** 100,000 Suppliers. 80% are active, and the rest are draft, pending approval, suspended, blocked or archived.
  - Children per Supplier: 5 addresses, 10 contacts, 2 identifiers and 2 Bank accounts.
  - 1,012 Suppliers use NFR-003's upper bound instead: 20 addresses, 50 contacts and 10 Bank accounts.
  - Totals: 515,180 addresses, 1,040,480 contacts, 200,000 identifiers, 208,096 Bank accounts and 2,390,701 name grams.
  - Keys, name grams and Bank ciphertext were computed with the product's own functions.
- **Names are a worst case.**
  - 70% are English, built from 40 + 25 common words and 8 suffixes.
  - 30% are Chinese, built from 25 + 16 common characters and 5 suffixes.
  - Real names use far more words, so they have rarer grams and cheaper similar-name searches.

## Commands

```bash
node scripts/seedSupplierPerformanceFixtures.js --database=<DB_NAME> --suppliers=100000 --heavy-percent=1
node scripts/benchmarkSupplierManagement.js --database=<DB_NAME> --output <report.json> --users=50 --seconds=120 --warmup-seconds=20 --think-ms=1000
```

- **Throwaway database only.**
  - Both scripts refuse unless every `DB_*` variable (plus `DB_ADMIN_*` for the benchmark) is set explicitly and `--database` repeats `DB_NAME`.
  - The seed also refuses a database that already has Suppliers.
  - The benchmark updates seeded Suppliers, and removes the Suppliers, user and role it created.
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

## Latency (`load-50-users.json`, after HD-084)

| Operation | Count | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| Default list | 2,236 | 38.7 | 49.8 | 61.4 |
| Exact Code search | 1,685 | 115.3 | 127.2 | 136.0 |
| Name search | 1,274 | 105.7 | 120.1 | 130.2 |
| Status filter | 872 | 7.5 | 20.2 | 29.0 |
| Currency filter | 530 | 26.5 | 43.6 | 56.1 |
| Sort by name | 570 | 44.0 | 57.9 | 66.8 |
| Detail | 1,609 | 5.5 | 17.5 | 26.6 |
| Heavy detail | 330 | 5.9 | 18.1 | 29.3 |
| Bank list | 535 | 4.4 | 17.5 | 26.7 |
| Duplicate check | 412 | 78.8 | 96.1 | 105.7 |
| Create | 400 | 30.8 | 78.8 | 85.2 |
| Update (two requests) | 440 | 100.1 | 127.2 | 143.3 |
| **Overall** | **10,893** | **39.2** | **119.5** | **127.8** |

- **Throughput:** 91 requests a second, with no errors.
- **Resources:** Node CPU 27% on average and 37% at peak, RSS 264 to 275 MiB, 11 DB connections.
- **During an import (`load-50-users-during-import.json`, `import-10000-rows-during-load.json`):**
  - Overall p95 was 133 ms; the slowest operation was update at 139 ms.
  - The import's precheck took 5.8 s and its execution 65.3 s, with each row applied exactly once.

## What HD-084 fixed

| p95 ms | List | Exact Code | Detail | Duplicate check | Create | Update |
| --- | --- | --- | --- | --- | --- | --- |
| Before (`load-50-users-before.json`) | 3,141 | 3,037 | 4,178 | 1,590 | 8,784 | 12,493 |
| After | 50 | 127 | 18 | 96 | 79 | 127 |

- **The cause had three parts:**
  1. The similar-name search read every posting of the name's grams: about 2.25 million rows, 0.7 to 1 s per call.
  2. It ran inside the create or update transaction, after Business Master's `assertCurrencyUsableInTransaction` had taken the currency row's X lock (`FOR UPDATE`). So every write queued on one currency row; that lock wait was 4.3 s on average.
  3. Queued writes held the pool's 10 connections, so reads waited for a connection.
- **The fix, in Supplier only:**
  1. `createSupplier` and `updateSupplier` run the search on the pool before the transaction. The transaction's locks and snapshot are unchanged. Running it earlier inside a REPEATABLE READ transaction would have moved the snapshot ahead of its locks.
  2. The search finds candidates through the name's rarest grams. A name with Dice ≥ t shares at least ta/(2−t) grams, so it contains one of any a − ta/(2−t) + 1 of them. It then counts every gram for at most 3,000 of those candidates, those matching the most rare grams first.
- **Known ceiling (recall):**
  - For a very generic name, a match can be missed when more than 3,000 Suppliers match more of its rare grams.
  - Against a brute-force comparison of all 100,000 Suppliers (200 perturbed names), recall was 98.9%. The old search's recall was 99.1%, within noise, because it also kept only its top 50.
  - Similar names are warnings only and never block a save.
  - An integration test compares the search with brute force, including a name that shares only the minimum number of grams.
- **Not changed:** Business Master's X lock and the pool size. Once the search left the transaction, the lock is held for milliseconds.

## Query plans (`load-50-users.json` → `topStatements`)

The benchmark empties `performance_schema`'s statement digest first. Afterwards it records the statements that took the most total time, with an EXPLAIN of each.

| Statement | Calls | Avg ms | Rows read per call | Plan |
| --- | --- | --- | --- | --- |
| List page (default, Code search, name search) | 3,448 | 56 | 100,274 | `suppliers` ALL + filesort; primary contact by `uq_supplier_contact_primary` |
| List count with search | 3,447 | 50 | 100,279 | `suppliers` ALL |
| Similar-name search | 1,482 | 54 | 73,010 | rarest grams by `idx_supplier_name_grams_lookup`, then at most 3,000 candidates by primary key |
| List count without search | 3,281 | 8 | 97,350 | `idx_suppliers_status_updated_id` range |
| Status count | 1,023 | 2 | 28,441 | `idx_suppliers_status_updated_id` ref |

- **Detail, children and Bank list:** they read by owner indexes. They are not among the top statements, at 5 to 18 ms p95.
- **The list and text search read the whole `suppliers` table.**
  - Text search is `LIKE '%term%'` on five columns, so it cannot use an index.
  - The default list filters `status != 'archived'` and sorts by `updated_at`. The `(status, updated_at, id)` index cannot give that order across several statuses.
  - At 100,000 rows each call costs 25 to 57 ms of database time, and p95 still has a 15-fold margin under 2 s.
  - Making them use an index needs a schema change, for example an `(updated_at, id)` index or a full-text index. That is a separate decision.

## Observability (design §12.4; HD-083 A)

| Signal | Where |
| --- | --- |
| API count, latency and errors by route and status | Request log: route, status, `durationMs` for every request |
| Pending approvals and oldest age | `supplier.metrics` (every 5 min, cluster scope) |
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
3. Whether the default list and text search should use an index (a schema decision). Today they meet p95 with a wide margin at 100,000 Suppliers.
4. The `perf:supplier` npm script (`server/package.json`, needs approval).

# Supplier performance, capacity and observability (TASK-050)

This is the T50 capacity report. It covers what was measured, on what, with which commands, and what is still open.
HD-082 A started T50 without the for-SKU lookup (NFR-005). Its for-SKU part and the final rerun were done on 2026-10-14, after TASK-040 and TASK-039; see "for-SKU lookup" below.

Evidence: `evidence/20261009-t50-capacity/`.

## Result

| Requirement | Result |
| --- | --- |
| NFR-001: p95 < 2 s under 50 online users | **Pass** after HD-084. The slowest operation's p95 is 145 ms, with an error rate of 0. The final rerun with the for-SKU lookup in the mix (2026-10-14, `evidence/20261014-t50-for-sku/load-50-users-with-for-sku.json`) gives 136 ms (`update`). Before HD-084, 11 of 12 operations failed (p95 3 to 12 s); only the duplicate check passed, at 1.6 s. |
| NFR-002: server-side paging, 20 by default, at most 100 | Unchanged; the benchmark uses the defaults and `pageSize=50`. |
| NFR-003: 100,000 Suppliers | **Pass** at 100,000 Suppliers with 1% at the per-Supplier upper bound. |
| NFR-004 with online load (design §11.5) | **Pass.** A 10,000-row import took 69 s, entirely inside a 120 s measured window with 50 users; the slowest online p95 was 136 ms. |
| NFR-005: for-SKU lookup | **Pass over HTTP at the production pool of 10** (2026-10-14, `evidence/20261014-t50-for-sku/`, REV-089).<br>• **Mixed load** (18 operations): the slowest for-SKU operation, a name search on a SKU with 20,000 relations, has p95 435 ms.<br>• **Worst case** (`--only=forSku`, 50 users doing nothing else, including deep pages past the hot SKU's head and the SKU with no relations): p95 1,488 ms overall and 1,678 ms for the slowest operation. Error rate 0.<br>• **Headroom:** across five worst-case runs on this machine the slowest operation's p95 was 1.5 to 2.0 s, and p99 went over 2 s in three of them.<br>• Before the head-join fix below, the worst case had p95 3,573 ms and failed. |
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
| for-SKU latency and ranking | Latency: the request log for `/api/v1/supplier-lookups/for-sku/:skuId`. Ranking: `supplier.for_sku.lookup`, one info line per lookup, with counts only: `ranked.exact_match`, `preferred`, `recently_supplied` and `none`, plus `returned`, `total` and `searched` (design §12.4). |

- **Format:** `supplier.metrics` and the alerts carry only numbers, never names, values or paths. A unit test checks this.
- **Thresholds:** the thresholds are constants in `supplierMetrics.js` (HD-083 2A). If Operations wants to tune them, they move to `server/config/supplier.js`, which needs approval.
- **Alerting:** this system has no metrics backend, so alerting means routing these log events. Operations decides how.

## for-SKU lookup (TASK-050 for-SKU part, 2026-10-14; REV-089)

### Data

A fresh 100k seed (`seed-100k.json`, 79,976 Active Suppliers), from the same script as before plus Supplier–SKU relations:

- **Who has relations.** 20% of Suppliers have relations: the 20,000 whose ID is a multiple of 5 (design §11.5). There are 120,000 relations over 1,001 SKUs.
- **`PERF-SKU-HOT`.** One relation from each of those 20,000 Suppliers: 1,974 preferred, 1,057 stopped and 16,969 alternative.
  - 10,496 of them belong to an Active Supplier and carry a ranking reason. That is the head, read on every call: 525 pages of 20.
- **`PERF-SKU-COLD`** has none.
- **The 1,000 `PERF-SKU-nnnn`** have about 100 relations each.
- **Status mix:** 10% preferred, 5% stopped, the rest alternative. About two thirds have a last-supplied time.
- **The hot SKU is a stress assumption:** one SKU supplied by every Supplier that has relations.
- **Correction (REV-089 L-1).** The first version of this section ran on a seed that gave relations to 40% of Suppliers and called it 20%. It also called a fresh seed "the same 100k seed".

### Commands

```
node scripts/seedSupplierPerformanceFixtures.js --database=<DB_NAME> --suppliers=100000
node scripts/benchmarkSupplierManagement.js --database=<DB_NAME> --output load-50-users-with-for-sku.json
node scripts/benchmarkSupplierManagement.js --database=<DB_NAME> --only=forSku --output load-50-users-for-sku-only.json
```

### Load

Six for-SKU operations are added to the mix:

| Operation | Weight |
| --- | --- |
| `forSku.typical`: a 100-relation SKU, no search | 3 |
| `forSku.cold`: the SKU with no relations, any page | 1 |
| `forSku.hot`: the hot SKU, page 1 | 2 |
| `forSku.codeExact`: the hot SKU, searching an exact Supplier Code | 2 |
| `forSku.nameSearch`: the hot SKU, searching a common name word | 2 |
| `forSku.deepPage`: the hot SKU, a page after the head | 1 |

- **`forSku.deepPage`** picks pages from just past the head to the last page (526 to 3,999, worked out from the data). These are the costliest no-search calls, because they walk the name index with a large offset.
  - The first version asked for pages 50 to 400, which the head always answered (REV-089 M-2).
- **Weights.** The 12 earlier operations keep their weights (100), so their ratios match the earlier runs. The total is 111.
- **App setup.** The app registers `supplierCoreProvider` as `src/index.js` does, and uses the configured pool of 10.
- **Request path.** Each request goes through HTTP, JWT, policy and the fresh-actor check.
- **Verdicts.** `nfr001` covers the 12 non-for-SKU operations and `nfr005` covers the for-SKU ones. Each is `null` when none of its operations ran, so a `--only=forSku` run makes no NFR-001 claim (REV-089 M-1).

### Results

| Run | Overall p95 | Slowest for-SKU p95 / p99 | Throughput | Errors |
| --- | --- | --- | --- | --- |
| Mixed (`load-50-users-with-for-sku.json`) | 157 ms | 435 / 498 ms (nameSearch) | 90/s | 0 |
| for-SKU only (`load-50-users-for-sku-only.json`) | 1,488 ms | 1,678 / 1,849 ms (nameSearch) | 33/s | 0 |
| for-SKU only, before the head-join fix (`…-before-straight-join.json`) | 3,573 ms | 3,914 ms | 16/s | 0 |

- **Mixed run.**
  - All 12 earlier operations stay under 136 ms p95 (the slowest is `update`), so NFR-001 passes.
  - The for-SKU operations stay under 435 ms p95, so NFR-005 passes. The cold SKU, mostly on deep pages, is 305 ms.
- **The worst case passes, but the headroom is thin and varies on this machine.**
  - Across five for-SKU-only runs, the slowest operation's p95 was 1.5 to 2.0 s:
    - 1,467 ms (author, old mix on the 40% seed);
    - 1,678 ms (author, this mix on this seed);
    - 1,809 and 1,907 ms (REV-089 on the 40% seed);
    - 1,966 ms (REV-089 round 2, this mix on a fresh 20% seed, with other work on the same MySQL instance).
  - p99 went over 2 s in three of them (up to 2,183 ms).
  - The runs used different seeds and mixes, as listed.
  - The machine's load average was about 3 to 12 during these runs. Production capacity planning should use the range, not one figure.
  - The text-search `COUNT(*)` is the next step if NFR-005 needs real margin (REV-089 round 2 N-1).
- **The "before" file.** It was produced by an earlier, uncommitted version of the benchmark (no `digestTable`, deep pages within the head) on the 40% seed. It shows the size of the head-join fix, not a like-for-like baseline.

### What the head-join fix changed

`load-50-users-for-sku-only-before-straight-join.json` → `topStatements` showed that the head query of `listForSku()`, which reads the Suppliers with a ranking reason, examined about 80,000 rows per call for the hot SKU.

The cause was join order:

- MySQL drove the join from all Active Suppliers (with the LIKE filter applied) and probed the head's derived table for each one.
- Its estimate for `sku_id` was also off: 58,000 rows estimated against 20,000 real.

`STRAIGHT_JOIN` from the head fixes the order. On an idle server (`head-join-plan.sql`, `EXPLAIN ANALYZE`):

| Hot-SKU head count | Before | After |
| --- | --- | --- |
| No search | 66.6 ms | 28.4 ms |
| Search | 90.6 ms | 27.3 ms |

REV-089 reproduced the direction of the change:

- no search: 103 → 33 ms;
- search: 109 → 32 ms;
- the pages were identical in 17 compared cases;
- no case got slower.

There is no schema change, and the ordering oracle test still passes.

### What remains costly

- **The text-search count.** `COUNT(*)` over Active Suppliers with the LIKE filters takes about 300 ms per call under the worst-case load and examines 80,000 rows. It is the same scan as the Supplier list search (HD-088: text search stays a scan). It is the next step if NFR-005 needs more margin.
- **The rest at a deep offset.** Deep pages walk `idx_suppliers_name_id` past the offset: about 190 ms idle for the hot SKU's last page.
- **The hot SKU's head without a search.** The plan scans the whole `supplier_sku_refs` table (120,000 rows) and keeps the hot SKU's ranked rows, so this cost grows with all relations, not with the SKU (REV-089 L-2).
  - Forcing `idx_supplier_sku_refs_sku_status_supplied` did not help (30.1 against 31.4 ms), because the primary-key joins to Suppliers dominate.
  - A typical SKU uses the index (0.17 ms).
  - Re-check this plan at production scale.
- **The Item Code pre-query** reads every relation of the SKU (37 ms per call under load for the hot SKU). A `(sku_id, supplier_item_code_key)` index would remove that (REV-087 I-5).

### Measurement notes

- **Digest table.** `performance_schema`'s digest table holds 10,000 statements. On the shared test instance it was full of earlier runs, so new statements were not attributed and the first runs reported no `topStatements`.
  - The benchmark now records `digestTable.lostDuringRun`, the rise in `Performance_schema_digest_lost` during the measured window, and adds a note when it is above 0 (REV-089 L-3).
  - The runs above lost none. They were taken after `TRUNCATE performance_schema.events_statements_summary_by_digest` on that throwaway instance.
- **`supplier.for_sku.lookup`** writes one line per lookup: about 290 bytes, so about 0.9 GB a day if 38 lookups per second were sustained. It carries no `requestId`. Design §12.3 names a `supplier.lookup.slow` event, which is not implemented. The SRE review should decide whether this stays per lookup or becomes a counter in `supplier.metrics` (REV-089 I-1).

## List search and filters added under HD-107 (TASK-051, 2026-10-15)

HD-107 added four things:
- identifier search in the Supplier list (FR-LIST-002);
- filters for a missing primary contact, a missing ordering address and a missing Bank account, plus a created-date range (FR-LIST-004, design 7.3);
- paged contact and address lists.

The benchmark gained three operations: `list.identifierSearch`, `list.missingFilter` and `list.createdRange`, with weights 3, 3 and 2. Evidence: `evidence/20261015-hd107-list/`, numbered in the order the runs were taken.

### Final result (4 GiB buffer pool, as in the T50 runs above; same 100k data; files 15–18)

| Run | Branch | `main` at the same time |
| --- | --- | --- |
| Mixed, 50 users (NFR-001, NFR-005) | **Pass.** Slowest p95 is 489 ms (`forSku.nameSearch`). `list.missingFilter` p95 367 ms, p99 550 ms. `list.identifierSearch` 229 ms. | Pass. Slowest p95 438 ms. |
| for-SKU only, worst case (NFR-005) | **Pass.** Slowest p95 1,801 ms (`forSku.nameSearch`), p99 1,967 ms. | Pass. 1,742 ms, p99 1,935 ms. |

**What it costs.** The list's text searches (name, Code, identifier) got slower: p95 220 ms against 122 ms on `main`. That is the identifier subquery: each search also scans the 200,000 identifier keys, because a `%value%` match cannot use an index. One COUNT, timed by hand once with `EXPLAIN ANALYZE` on an idle instance at the 128 MiB pool, went from 47 ms to 91 ms. It is not in the evidence files; the digest averages in files 15 and 16 give 49.5 and 87.8 ms.

Every other operation is slower too, because the heavier new operations hold the 10 pool connections longer and the rest queue behind them. At p95:

| Operation | Branch | `main` |
| --- | --- | --- |
| detail | 57 ms | 19 ms |
| update | 217 ms | 128 ms |
| list default | 43 ms | 25 ms |
| `forSku.typical` | 72 ms | 24 ms |
| other `forSku.*` | 12–34% higher | |

All of them stay far under 2 s. The for-SKU worst-case run above has no list operations in it, which is why it matches `main`.

### Two decisions taken on the way (HD-108)

1. **The for-SKU lookup does not search identifiers (HD-108 A).**
   - With the identifier subquery shared into the for-SKU search, its worst case failed: `forSku.nameSearch` p95 2,511 ms against 1,974 ms on `main` (files 07–08).
   - That comparison is one pair of runs at the 128 MiB pool (files 07 and 08), not alternating and not repeated at 4 GiB. The direction is clear, though: +537 ms against about ±80 ms between runs in the pairs below.
   - The lookup now runs the search it had before HD-107. Four alternating runs, two of each, under the same machine load gave 2,032 and 2,113 ms on `main` against 2,067 and 2,133 ms on the branch (files 11–14). That is noise, so the lookup is unchanged.
   - This departs from HD-094 4A, which said the for-SKU search covers the list's fields: identifiers are now the one exception.
2. **The missing-data filters stay as `NOT EXISTS` queries (HD-108 C1).**
   - When few Suppliers match, the query must check every one. Under a 128 MiB buffer pool their p95 was 1.6–1.8 s, with p99 over 2 s, across three runs (files 02–04).
   - With the 4 GiB pool they are 367 ms.
   - The missing-contact filter no longer joins `supplier_contacts`. The primary slot only ever belongs to an active contact: deactivating clears it, and an inactive contact cannot be updated. A real-database test deactivates through the service and checks the filter, so a change to that rule shows up there.
   - Measured once by hand with `EXPLAIN ANALYZE` (not in the evidence files): the COUNT went from 724 to 124 ms at the 128 MiB pool. REV-094 measured 241 to 129 ms at 4 GiB.
   - Denormalised flags on `suppliers` (HD-108 C2) were not built.

### Measurement notes

- **Buffer pool.** Files 01–14 were taken with a **128 MiB** buffer pool, because the throwaway instance was restarted without its setting. Every operation, `main` included, was slower there; the for-SKU worst case failed on `main` too (2.0–2.1 s). Those files are kept for the comparisons each one was taken for (same pool, alternating runs), not for absolute verdicts.
- **Machine load.** Other local MySQL instances were running, so the load average was 7 to 13 during the runs. The comparisons with `main` were taken back to back under the same load.
- **Control mix.** File 06 is a one-off mix without `list.missingFilter`, used to separate the two costs. Its script copy was deleted after the run.
- **Digest table.** No run lost digest entries (`digestTable.lostDuringRun` is 0 in every file).

## Open

1. ~~The for-SKU lookup (NFR-005, its metrics) and a final rerun, after TASK-040.~~ Done on 2026-10-14; see "for-SKU lookup".
2. The manual SRE review of this report, the alerts and the query plans. The checklist is in `implementation/93_task_050_sre_review.md`.
3. Sort by status is not indexed (about 20 ms). Text search stays a scan (HD-088). Identifier search adds a second scan, of the identifier keys, to every list text search (HD-107/HD-108).
4. ~~The `perf:supplier` npm script (`server/package.json`, needs approval).~~ Added under HD-101: `npm run perf:supplier --workspace server -- --database=<DB> --suppliers=100000 --concurrency=50`. It seeds an empty database, then runs the benchmark; `--concurrency` maps to `--users`.

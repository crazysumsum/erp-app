# TASK-018 Core Stock developer gate

Date: 2026-09-28
Authorization: `HD-041` / `APR-042`
Baseline: DESIGN `d3c934c71b3f369a98c3a884665c96c626fb8d4b5d115b1cde5309528c6c673a`; PLAN `a9fbd958ef6bdf11e480334af9d1a4fee7bfd8dc38596334267f9337d17d740d`

This is local IMPLEMENT-stage developer evidence for TASK-018. It does not claim formal `TC-003`, `TC-004` or `TC-010` acceptance, CI, independent code approval or business acceptance.

## Scope and threat model

Trust boundaries were HTTP params/query/body and authentication claims, database rows returned to projections, caller-owned transaction connections and the capacity fixture generator. Protected assets were current quantities, immutable Movement/source identity, actor permissions and response confidentiality.

The checks covered unauthenticated access, missing permission, disabled/stale actor, Warehouse/Bin owner substitution, unknown input fields, sensitive response fields, duplicate source races, lock timeout rollback, SQL parameterization, bounded pagination and indexed query shapes. No cache was introduced because stale Inventory data would be a correctness risk.

## Capacity and environment

The disposable MySQL 26.7.0 schema contained exactly 5 Warehouses, 1,000 Bins, 100,000 SKUs, 500,000 non-zero Stock buckets and 2,000,000 Movements before concurrency checks. Twenty workers each ran five rounds, producing 100 samples per query shape.

| Setting | Value |
| --- | --- |
| Node | 26.6.0 |
| MySQL | 26.7.0 |
| Logical CPUs | 15 |
| Memory | 25,769,803,776 bytes |
| `innodb_buffer_pool_size` | 134,217,728 bytes |
| `innodb_flush_log_at_trx_commit` | 1 |
| Isolation | `REPEATABLE-READ` |
| `max_connections` | 151 |
| Capacity schema size | 1,777.0 MiB |
| Seed duration | 48,253.1 ms |

The Movement fixture spans time at one-minute SKU intervals. The common Movement query uses Warehouse plus the most recent seven-day `postedFrom` range; it does not disguise a full-history scan as a selective time filter.

## Final latency result

All figures are milliseconds and are measured under the 20-worker mixed load.

| Scenario | Samples | p50 | p95 | p99 | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Exact SKU Code | 100 | 0.694 | 11.669 | 13.550 | PASS `< 2,000` |
| Exact Barcode | 100 | 0.597 | 1.459 | 1.956 | PASS `< 2,000` |
| Warehouse SKU stock summary | 100 | 0.656 | 1.530 | 2.347 | PASS `< 2,000` |
| Warehouse SKU bucket drill-down | 100 | 1.405 | 2.896 | 3.364 | PASS `< 2,000` |
| Recent Warehouse Movement filter | 100 | 6.231 | 8.088 | 9.438 | PASS `< 2,000` |

## Preserved EXPLAIN evidence

`EXPLAIN FORMAT=TRADITIONAL` was required because MySQL 26.7.0's default EXPLAIN returns the newer tree representation.

| Scenario | Large table | Access | Key | Estimated rows | Extra |
| --- | --- | --- | --- | ---: | --- |
| Exact SKU Code | `item_skus` | `const` | `uq_item_skus_code` | 1 | `Using index` |
| Exact Barcode | `item_sku_barcodes` | `const` | `uq_item_sku_barcodes_value` | 1 | — |
| Stock summary | `inventory_stock_balances` | `ref` | `idx_inventory_stock_sku` | 1 | — |
| Bucket drill-down | `inventory_stock_balances` | `ref` | `idx_inventory_stock_sku` | 1 | `Using index; Using filesort` |
| Movement filter | `inventory_movements` | `range` | `idx_inventory_movements_warehouse` | 79,162 | `Using where; Backward index scan; Using index` |

The bucket sort operates on the one-row Warehouse/SKU result for this fixture; it is not a filesort over the 500,000-row table. No new index was added.

## Concurrency and correctness

- Two independent pool connections competing on the same Receipt source and bucket completed as one effect plus one exact replay: one operation row and one Movement row.
- A real `innodb_lock_wait_timeout=1` on the post-Lot Balance lock returned stable `CONCURRENT_OPERATION`; the transaction left zero operation rows, zero Movement rows and no quantity change.
- The timeout run exposed an omitted `await` in `lockBalancesAfterLot`; the async MySQL error escaped the existing mapper. The focused regression failed before the one-token fix and passed afterward.
- Warehouse posting-first/deactivate-first ordering passed 1/1 against a second disposable TASK-018 schema. Posting-first leaves the Warehouse active with `WAREHOUSE_IN_USE`; deactivate-first exposes `INACTIVE` to the late poster and creates no Balance.
- Twenty-four Core endpoint definitions were enumerated. Each remained non-public, rejected missing credentials, missing permission and stale actors through the shared authentication/authorization boundary, used closed request schemas and exposed no password/token/secret/hash fields in response schemas. Existing owner-safe service checks plus Warehouse-bearing Bin routes prevent child-ID substitution.

## Measured changes and discarded attempts

| Attempt | Result | Decision |
| --- | --- | --- |
| Original Movement count always joined operation rows | Warehouse/all-history-like p95 3,168.6 ms | Bottleneck confirmed |
| Count omits operation join when no source filter exists | Same stress shape p95 2,307.8 ms, about 27% faster | Kept; source-filter counts still join and retain semantics |
| Initial time fixture placed all 2M rows inside 20 ms | `postedFrom` selected the complete history | Fixture rejected as non-representative |
| Seven-day Warehouse Movement range on distributed history | p95 8.088 ms | Final gate result |

## Cleanup

Schemas `erp_inventory_task018_20260928_1521`, `erp_inventory_task018_master_20260928` and `erp_inventory_task018_final_20260928` were dropped and confirmed absent. Both isolated runs on port 3318 were stopped and their listeners were absent. Exact runtime roots `/private/tmp/erp-inventory-task018-mysql-2670.J0LCkz` and `/private/tmp/erp-inventory-task018-final-mysql-2670.1u1Icz` were removed. No shared or production schema was accessed.

## P1 integration run against initial main snapshot (2026-09-29)

The P1-only TASK-013～TASK-018 candidate was separated from the continuing P2 branch at `00925ff355162927a1d2a03ed94c3e5291bc5daf`, then merged with `origin/main` `894cdc62f54dc3ea27efabfad8db5f14510fa953` without conflicts (`866eedfe14209491573685c512019c6f0169e1a5`). The approved DESIGN and PLAN hashes above were unchanged; no P2 code or migration is in this candidate.

- Full server coverage on a migrated, isolated MySQL 26.7.0 schema: 2,300 passed, 0 failed, 9 gated skips; global lines 93.97%, branches 83.18%, functions 91.53%, and all 34 high-risk per-file floors passed. The five separately guarded Inventory lock, master migration/race, stock migration and Receipt posting tests passed 5/5 on their own empty schemas.
- Full client coverage, repository lint, production client build, 11/11 Inventory Playwright cases and the CI-equivalent 39/39 business-master/Supplier Playwright cases passed. The browser runs reported no relevant unexpected console or network errors. The build retained the existing large-chunk warning.
- The dependency audit passed its existing high-severity gate; four moderate findings remain in the existing Vitest/Undici dependency tree. No dependency or CI threshold was changed for P1.
- The first full server run lacked the existing recovery tests' DB admin credentials; after configuring those only on the disposable instance, 2,304 tests passed but global branch coverage was 82.84%. Added P1 inquiry/projection boundary assertions, then reran the complete unchanged 83% gate to the passing result above. Neither failure was treated as a pass.

The current-candidate capacity rerun used exactly 100,000 SKUs, 500,000 Stock buckets and 2,000,000 Movements on MySQL 26.7.0; seed time was 42,773 ms. Twenty workers each completed five rounds. All five large-table EXPLAIN plans used the expected indexes. The p95 values in milliseconds were exact SKU 12.637, exact barcode 1.470, stock summary 1.597, bucket drill-down 3.697 and recent Warehouse Movement 9.689; all were below the approved 2,000 ms ceiling. Same-source competition left one operation and one Movement; injected lock timeout left no partial effect. The test passed 1/1.

A read-only post-run Receipt → Stock → Movement check resolved `same-source` to one Movement of quantity 1, one group leg and Warehouse/SKU On Hand 101 with Movement `balanceAfter` 101. The exact seven test-owned schemas were dropped and confirmed absent; the private port 3331 listener and socket were stopped; the exact temporary root `/private/tmp/erp-inventory-p1-mysql-2670.zWoOxJ` was removed. No shared or production database was accessed. These remain developer checks, not PR CI, Sam's independent review, formal Technical Acceptance or UAT.

## Refresh after main advanced (2026-09-29)

While the P1 gate ran, `main` advanced to `8009e899fa22249cf1752bfc20db5f4fcd276a3c` with Supplier-only changes. The P1 branch merged it without conflicts as `05f764c3a07729f4aa31dc835ced08349affb8d2`; no Inventory code, client or lockfile path changed in that main update. On a fresh private MySQL 26.7.0 instance, the full migration sequence through `0060` and complete server coverage passed again: 2,307 passed, 0 failed, 9 gated skips; lines 93.99%, branches 83.27%, functions 91.54%, with all 34 high-risk per-file floors met. The five separately guarded Inventory MySQL cases passed 5/5 again. Repository lint, production client build, module-boundary validation, traceability validation and `git diff --check` also passed after the merge. The unchanged client code retains the passing client coverage and Playwright evidence from the initial run.

The fresh 100,000-SKU／500,000-bucket／2,000,000-Movement run passed 1/1: seed 42,672 ms; 20 workers × five rounds; p95 in milliseconds was exact SKU 11.053, barcode 1.086, stock summary 1.621, bucket drill-down 2.808 and recent Warehouse Movement 8.353, all below 2,000. The expected large-table indexes were used; same-source replay left one operation and one Movement, and lock timeout left no partial effect. A separate read-only check again linked `same-source` Receipt to one Movement of quantity 1, one group leg and On Hand／`balanceAfter` 101. The second run's exact seven disposable schemas were dropped and confirmed absent; the private port 3331 listener and socket were stopped; the exact temporary root `/private/tmp/erp-inventory-p1-recheck-mysql-2670.Xc5GBC` was removed. No shared or production database was accessed. PR CI and Sam's independent code review remain required before merge.

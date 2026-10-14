# TASK-050 SRE review checklist

T50's Verification asks for a manual SRE review. The reviewer should be a person, not an agent, and should approve or reject each item below. The evidence for every item is already in the repository. Record the outcome in the table at the end; the author then writes it to the ledger.

## How to reproduce

```
npm run perf:supplier --workspace server -- --database=<throwaway DB> --suppliers=100000 --concurrency=50
npm run perf:supplier --workspace server -- --database=<throwaway DB> --concurrency=50 --only=forSku
```

- The script seeds only when the database has no Suppliers, then runs the 50-user benchmark.
- Use a throwaway, freshly migrated database. Every script refuses unless `--database` repeats `DB_NAME`.
- `erp_t50` on the author's test MySQL holds the seeded data and is kept until this review ends.

## Items

| # | Item | What to approve | Evidence |
| --- | --- | --- | --- |
| 1 | NFR-001: list, search, detail and writes | p95 < 2 s with 50 users at the production pool of 10. The slowest is 136 ms in the final mixed run. | `performance_report.md`, Result table; `evidence/20261014-t50-for-sku/load-50-users-with-for-sku.json` |
| 2 | NFR-005: for-SKU lookup | Passes. The mixed run's slowest is 435 ms. The worst case, for-SKU only, gives a slowest p95 of 1.5 to 2.0 s across five runs, with p99 over 2 s in three. **Decide whether this margin is acceptable** or whether the text-search count should be optimised first. | `performance_report.md`, "for-SKU lookup" section; `load-50-users-for-sku-only.json` |
| 3 | NFR-003 and NFR-004: capacity and import under load | 100,000 Suppliers with heavy children. A 10,000-row import while online stays inside the window. | `performance_report.md`; `evidence/20261009-t50-capacity/` |
| 4 | Query plans | The list, filters, sorts and detail use the designed indexes. The text search is a scan by decision (HD-088). The for-SKU head now drives from the relation (`STRAIGHT_JOIN`). Its no-search plan scans `supplier_sku_refs` and should be re-checked at production scale. | `performance_report.md`, "Query plans", "List and search indexes", "What remains costly" |
| 5 | Alerts and thresholds | `supplier.alert.approval_overdue` (warn, over 24 h) and `supplier.alert.import_stalled` (error, over 15 min). The Bank integrity and key failures should be routed as critical. The thresholds are constants; moving them to config needs approval. | `performance_report.md`, "Observability" |
| 6 | `supplier.metrics` | Every 5 minutes, cluster scope, numbers only. | same |
| 7 | `supplier.for_sku.lookup` log | One info line per lookup with ranking counts: about 290 bytes, so about 0.9 GB a day at a sustained 38 lookups per second. It carries no `requestId`. **Decide whether to keep it per lookup or replace it with a counter in `supplier.metrics`.** Design §12.3's `supplier.lookup.slow` is not implemented. | `performance_report.md`, "Measurement notes"; REV-089 I-1 |
| 8 | Routing | This system has no metrics backend, so alerting means routing these log events. **Name who receives which event.** | "Observability" |

## Outcome (filled in by the reviewer)

| # | Approved / changes needed | Notes |
| --- | --- | --- |
| 1 | Approved | Slowest p95 136 ms against 2 s. |
| 2 | Approved as a known limitation | The worst case (for-SKU only) reaches p95 1.5–2.0 s; the mixed run's slowest is 435 ms. Optimising the text-search count would change the design and is not done now. T51's release evidence lists this limitation and asks for a re-check after go-live. |
| 3 | Approved | |
| 4 | Approved | The no-search for-SKU plan is re-checked after go-live at production scale. |
| 5 | Approved | Thresholds stay constants; moving them to config needs separate approval. |
| 6 | Approved | |
| 7 | Approved: keep one log line per lookup | 0.9 GB a day assumes a sustained 38 lookups per second; real volume is expected to be lower (not measured). Replace it with a counter in `supplier.metrics` only if log cost becomes a problem. |
| 8 | Approved | Every event goes to Operations on-call. Bank integrity and key failures are critical and also go to Security. |

- **Reviewer:** the Product Owner, acting for SRE (not an independent SRE). The author's recommendations were accepted as a whole: '全部按建議'.
- **Date:** 2026-10-14

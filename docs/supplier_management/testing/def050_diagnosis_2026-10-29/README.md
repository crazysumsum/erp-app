# DEF-050 diagnosis files (2026-10-29)

All of these ran on the throwaway mysqld at 127.0.0.1:3450 (MySQL 26.7.0), on a scratch schema `erp_t51_mig_d50`. Each script migrates the schema, seeds it as the performance runner does (100k Suppliers, 1% heavy) and drops it at the end.

The scripts cannot be re-run as committed. They use `$SCRATCH/env-t51.sh` for credentials, and paths written as `$SCRATCH`, `$WORKTREE` and `$THROWAWAY_WORKTREE`; none of these is in the repository.

| Files | Experiment |
|---|---|
| `run.sh`, `out.txt`, `forsku-u*.json`, `typical-u50.json`, `namesearch-u50.json` | **E1:** `--only=forSku` at 1, 10, 25 and 50 users. **E2:** 50 users running only `forSku.typical`, then only `forSku.nameSearch`. |
| `run-pool20.sh`, `out-pool20.txt`, `pool20-forsku-u50.json` | **E3:** the application pool at 20 instead of 10, set by an uncommitted one-line change in a throwaway detached worktree that was then removed. |
| `run-bp1g.sh`, `out-bp.txt`, `bp*-forsku-u50.json` | **E4:** the buffer pool at 128 MiB, then at 1 GiB. The 1 GiB run was not warmed again after the resize; it still read 13,975 pages from disk, against 18,152 at 128 MiB. |
| `run-restplan.sh`, `out-restplan.txt` | **E5** (after REV-137): the rest page without `q`, as MySQL plans it today and with `FORCE INDEX (idx_suppliers_name_id)`, at offsets 0 to 69,000 on a quiet database. |

Known faults in the `out*.txt` summaries (REV-137), corrected in `04_defect_register.md` from the JSON reports:

- **The "LIKE statements" lines list the head COUNT and head SELECT as the second and third scans.** Those queries are driven by the hot SKU's relations, not by the active Suppliers. The only full scan a `q` request always makes is the `COUNT(*) total`.
- **"DB busy" divides the summed digest time by 70 s.** The benchmark's digests cover only the 60 s measured window, so the true values are about 17% higher: 0.1, 2.1, 8.9 and 10.1 connections in E1, and 19.9 with the pool of 20. The sum covers the 12 most expensive digests, which hold more than 99.9% of the time.

# REV-132 — independent review of the DEF-048 diagnosis (HD-152 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** the delta `35903133..c747097c` on `claude/supplier-technical-acceptance` (PR #296); REV-131 covered everything before it
- **Verdict:** **CHANGES_REQUESTED**. 0 open critical, 0 open high. 2 Required (both medium), 5 Optional, 4 Nits.

## What the reviewer confirmed

- **The facts.** The timings .986, .005 and .007; 17 retry warnings plus one failed request; `lock_deadlocks` from 256 to 274. All 18 deadlocks are on the `supplier_name_grams` PRIMARY supremum in the run's schema. The import applied 10,000 of 10,000, and TC-101 passed in that run.
- **The callers.** `replaceNameGrams` has exactly two callers: create (`SupplierAdminService.js:402`) and update (`:521`).
- **An isolated experiment**, on a copy of the real DDL in a throwaway schema, since dropped:
  - DELETE-then-INSERT for new ids deadlocks (1213), with the same lock picture.
  - Plain INSERTs do not deadlock, in either order.
  - A plain create against a rename does not deadlock.
  - Update against update on adjacent ids still deadlocks: the residual risk.
- **The attachments.** No secrets, and paths are masked. The committed files are byte-identical to the scratch originals apart from the masking.
- **The harness tools.** STRUCTURE_PASS, and boundary LOCAL_CHECKS_PASS.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: "while the import ran" was wrong for 3 of the 18 deadlocks | Checked against the import window in `perf-1.stdout` (04:00:35.847Z to 04:01:53.018Z): the first deadlock came 3.2 s before it and the last two 24–28 s after it. The block now says "in the load-during-import phase", and cites those 3 as InnoDB's direct proof that it happens without an import. `perf-1.stdout`, masked, is attached so the timing can be checked. |
| R2: the 11/7 split was wrong | Reclassified by connection: the import is thread 23736. That gives 12 import vs online and 6 online vs online (#1, #4, #5, #11, #17, #18); a script check reproduced the split. The block says why a lock-count threshold misclassifies: the import's per-row lock count grows across the run. |
| O1: strengthen "the 500 is a second deadlock" | Added: the failing INSERT at `supplierDuplicateCandidates.js:36` matches "insert intention waiting"; InnoDB #4 and #5 show the same thread losing, retrying with a new id and losing again; and why the handler line says `responseCode 200`. |
| O2: fix scope | HD-153 now names the single call site `createSupplierInTransaction` (`SupplierAdminService.js:402`), which covers online and import create. It says the update path keeps its DELETE and the retry, and that update vs update can still deadlock, rarely. `SupplierImportService` is removed from `affected_ids`. |
| O3: the import's lock growth | Recorded in DEF-048 and in HD-153 as an open observation, not proven, with the likely query and how to settle it. |
| O4: reproducibility | The benchmark change is attached as `benchmark-keep-logs.diff`. `run.sh` now records the `innodb_print_all_deadlocks` step, both counter reads and how `innodb-deadlocks.txt` was extracted. The block says this MySQL prints no per-deadlock header, timestamp or victim line. |
| O5: `status FAIL` next to "TC-101 passed" | The observation says that FAIL means the defect was reproduced. |
| Nits | Fixed: ids are not always adjacent (#5); `run.sh` reads the password from the env and drops an unused variable, and says it differs from the copy that ran; the 2 mixed-phase retries were at 03:53Z, before the print and the 256 reading. |

One correction of my own: a first redraft attributed the borderline retry (142 ms after the import) to deadlock "#16". The app-log lines do not map one-to-one onto deadlock numbers, so the number is removed.

## Points for the Product Owner (HD-153)

- Option A is sound in principle, and the isolated reproduction confirms it. It covers online and import create; update-path deadlocks stay possible but rare.
- The re-test must be able to fail. TC-101 passed once with the defect present, so HD-153 A's re-test also requires zero name-gram deadlocks across the load phases, with deadlock printing on.
- The import's lock growth is a separate open question that may bear on TC-101's window failure.

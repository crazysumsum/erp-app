# REV-135 — independent review of the DEF-049 diagnosis

- **Reviewer:** `agent-skills:code-reviewer`, a separate agent. I did not write this change.
- **Baseline:** PR #300, branch `claude/supplier-import-row-locks` at `2f67bf69`, reviewed as `git diff origin/main..HEAD` against base `ef5a61a4`.
- **Method:** read-only. No git or gh writes, no MySQL, no `.env`.
- **Verdict:** **CHANGES_REQUESTED**. 0 open critical, 0 open high. 2 Medium, 3 Low, and nits.

## What the reviewer confirmed

- **The query and its plan:** the query is at `SupplierImportService.js:652-658`, and the 0062 indexes are `PRIMARY (job_id, row_number)` and `(job_id, status, row_number)`.
  - `out.txt` shows the PRIMARY plan with k+1 lock growth. The plan switches only at the very end.
  - The locks beyond k+1 are page supremum locks. `out-v2.txt` now counts them: 10 at k = 1,000, and 99 at k = 9,000.
- **Numbers and arithmetic:** every number matches the raw files, apart from L1 and L2.
  - Per-row cost: (2.26 − 0.21) / 9,000 = 0.228 µs.
  - Summed over 10,000 rows: 11.39 s. Over 50,000 rows: 284.7 s, or 4.75 minutes.
- **Writers of `supplier_import_rows`:** every product writer takes the job lock first. The only locking reader is the pick at line 653. The only writer without a job lock is the benchmark cleanup.
- **The candidate fix:** it returns the same row as the current query.
- **PR #299's facts:** merge commit `ef5a61a4`, head `4a528c76`, merged at 08:04:32Z, 13 of 13 checks, run 40651747391.
- **The §8 text** is accurate against the recovery runner and the profile.

## Disposition

| Finding | Disposition |
| --- | --- |
| **M1: the candidate fix can lock another job's index entries** | **Reproduced before acting on it** (`run-v2.sh` part 2). When job 2 has no pending warning, `fx-warning` held a lock, and staging a row for job 3 timed out (`ER_LOCK_WAIT_TIMEOUT`, 2.0 s). The control inserted at once (0.0 s).<br>The candidate is now marked rejected. The register records the empty-status next-key lock. HD-154 names REV-135's alternative: pick the row without locking, then `FOR UPDATE` by primary key. Measured, it reads 3 entries, holds 1 lock at every k, and does not block staging.<br>The read-view timing and the line-675 fence are left for IMPLEMENT to confirm, and the IMPLEMENT test must stage a second job at the same time.<br>The claim that the extra locks stay inside the job is now qualified. Today's query also locks the next entry in its last picks (`other_job_locks=1` at k = 9,995 and 9,999). |
| **M2: the TC-101 window effect was understated** | Margins are now computed from each run's details with the verdict's own formula: 40.7 s (TECHNICAL re-test), 35.1 s (REGRESSION re-test) and −2.9 s (first REGRESSION, DEF-048 FAIL).<br>The register, the 06 boundary, the 07 report and HD-154 now say: DEF-049 plausibly contributed to the 2.9 s miss, not proven, and TC-101's window check may fail on a slower host. Options B and C carry that trade-off. |
| L1: "about 2k reads" was wrong | The read counter included the probe's own `data_locks` scan. `run-v2.sh` reads the counter first and finds k+1 reads. The register is corrected, and the README records the fault. |
| L2: the lock-memory figures came from a different print | Now cited from `innodb-deadlocks.txt:393`: 720 lock structs, a 90,232-byte heap, 10,618 row locks. Reworded to "consistent with", because that figure also counts `applyRow`'s locks. |
| L3: the evidence did not record its environment | `run-v2.sh` sets REPEATABLE READ, prints the version, port and isolation level (26.7.0, 3450, REPEATABLE-READ), and filters locks by `PS_CURRENT_THREAD_ID()`. The first-run files are kept unchanged as history, and their faults are listed in `def049_diagnosis_2026-10-29/README.md`. |
| Nit: "PRIMARY until k = 9,000" | Now reads "switches between k = 5,000 and 7,500". |
| Nit: script hygiene (copied header, unused `probe()`, undefined W, `picked=locks=1`) | Listed in the README. The scripts are not edited after the fact, because they produced the kept outputs. |
| Nit: `7f47f619` against `ef5a61a4` | The register says the two are code-identical, since the change was docs only. |
| Nit: §8 omits binlog retention | Added. |

## Points for the Product Owner

1. **DEF-049 is a cost problem, not a correctness problem.** It adds about 11 s per 10,000 rows on a quiet host. It also uses up some of TC-101's window headroom: 35–41 s remained at the re-test.
2. **The obvious fix was a trap.** A per-status forced-index `FOR UPDATE` blocks the next job's staging. If HD-154 chooses to fix, the design starts from the non-locking pick plus a primary-key lock, and the test covers a concurrent second job.

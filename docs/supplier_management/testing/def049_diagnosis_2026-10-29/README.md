# DEF-049 diagnosis files (2026-10-29)

All of these ran on the throwaway mysqld at 127.0.0.1:3450, MySQL 26.7.0, on a private scratch schema. That schema was `erp_t51_mig_lockdiag`, created and dropped by each script. `$SCRATCH` stands for the session scratchpad.

**Use the v2 files for locks, reads and blocking:**

| File | What it is |
|---|---|
| `run-v2.sh`, `out-v2.txt` | Corrected after REV-135 (M1, L1, L3). See below. |

`run-v2.sh` differs from the first run in these ways:
- Each probe sets REPEATABLE READ itself.
- It prints `@@version`, `@@port` and the default isolation level.
- It counts record locks for its own thread only (`PS_CURRENT_THREAD_ID()`).
- It reads `Handler_read_*` before the `data_locks` query, so `rows_read` is the probe's own reads.
- It has two jobs, so the index entry after a job's range belongs to another job.
- It adds REV-135's alternative (`alt`): it picks the row with non-locking lookups, then locks that row by its primary key.
- Part 2 holds each pick's locks for 5 s while another session stages a row for the next job id (`innodb_lock_wait_timeout` 2 s).

**First run, kept as history:**

| File | What it is |
|---|---|
| `run.sh`, `out.txt` | Plans and record locks per pick, one job. |
| `time.sh`, `time-out.txt` | Time per pick, 200 runs each. |
| `run2.sh`, `out2.txt` | The candidate with a forced index and one equality per status. `out2.txt` keeps the first 170 characters of each plan. |

Known faults in the first run (REV-135 L1, L3 and nits):
- `rows_read` includes the probe's own `data_locks` scan. For example, `force-ix k=0` shows 30,021 = 20,017 locks + about 10,004 index entries. The real index reads are about k+1 per pick.
- The scripts relied on the server's default isolation level, which was REPEATABLE READ (printed in `out-v2.txt`). They did not record the version or port.
- The lock count was filtered by schema, not by transaction. The schema was private to the script.
- With a single job, the scripts could not show locks on the next job's entries (REV-135 M1).
- `run2.sh` and `time.sh` reuse `run.sh`'s header. `time.sh` measures time and never calls `probe()`.
- The header's "W of them" is never defined: 10% of rows are `warning`, set by `n % 10`.
- When nothing is picked, the output shows `picked=locks=1`. That is a parsing artifact, not a value.

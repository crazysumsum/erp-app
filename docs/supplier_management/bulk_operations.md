# Supplier bulk import and export — operations

This page is for operators. It covers how the Supplier CSV import and the general export behave in production, the
settings, the background jobs, what to watch, and how to recover. Why each part is built the way it is lives in the
design (`03_design_spec.md` §6.9 and §12) and in the decisions in `00_harness_state.json`.

## What users can do

| Feature | Where | Permission |
| --- | --- | --- |
| Download the template v1 | `/suppliers/imports` | `supplier.mgmt` |
| Upload a CSV (create only, or create-or-update) | `/suppliers/imports` | `supplier.mgmt` |
| See their own jobs, prechecked rows, and results | `/suppliers/imports` | `supplier.mgmt`, uploader only |
| Confirm a job (draft or activate; an approver when approval is on) | the job dialog | `supplier.mgmt` plus password |
| Cancel a job before it runs | the job dialog | `supplier.mgmt`, uploader only |
| Download the per-row result CSV | the job dialog | `supplier.mgmt`, uploader only |
| Export Suppliers with the list's filters (template v1 columns) | `/suppliers` | `supplier.mgmt` plus password |

Bank columns are refused at upload, and Bank data is never exported. CSV cells that a spreadsheet would run as a formula
(starting with `= + - @`, the full-width forms, Tab, CR or LF) get a leading `'` on export. The import removes that
apostrophe again, so an exported file re-imports unchanged.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUPPLIER_IMPORT_ROOT` | unset | Absolute path of the import file root. While unset, import is not deployed and uploads answer 503. |
| `SUPPLIER_IMPORT_MAX_FILE_BYTES` | 10,485,760 | Largest accepted upload. |
| `SUPPLIER_IMPORT_MAX_ROWS` | 10,000 | Most data rows in one file. |
| `SUPPLIER_IMPORT_FILE_RETENTION_DAYS` | 365 | Days after completion before an executed job's files are deleted. |
| `SUPPLIER_IMPORT_UNCONFIRMED_RETENTION_DAYS` | 30 | Days after upload before a job nobody confirmed expires. |

The import root must meet these conditions, which are checked at start-up:

- It is owned by the service user, with mode 0700.
- Every ancestor directory is owned by root or the service user, and none is group- or world-writable unless it has the
  sticky bit.
- It does not overlap any other module's file directory.

**Use one root per environment.** The retention job deletes files that this database's jobs do not name. Two
environments sharing a root, or an app pointed at the wrong schema, would delete each other's files.

## Background jobs

| Job | Interval | Scope | What it does |
| --- | --- | --- | --- |
| `supplier.import.precheck` | 5 s | instance | Claims an uploaded job and checks every row. The lease is 3 minutes, and a job whose precheck fails three times is abandoned. |
| `supplier.import.execute` | 5 s | instance | Claims a confirmed job and writes rows one at a time, each in its own transaction. The lease is 11 minutes, renewed on every row. A run stops after 10 minutes and releases its lease, so the next poll continues straight away; it releases the lease whenever it stops, including on an error. |
| `supplier.import.purge` | daily | cluster | Applies retention: the files of executed jobs past `FILE_RETENTION_DAYS`, jobs never confirmed past `UNCONFIRMED_RETENTION_DAYS`, and unreferenced files older than a day. |

Each job can be switched off or retuned in `server/config/scheduler.js` under `jobs`. With the precheck switched off,
uploads stay `uploaded` until it is switched back on.

## Capacity (TASK-049)

Measured on 2026-10-09 (regenerated after REV-081):

- **Environment:** an Apple M5 Pro (15 cores, 24 GiB) running Node v26.6.0 and MySQL 26.7.0, with
  `innodb_flush_log_at_trx_commit=1` and `sync_binlog=1`.
- **Worker:** a separate process built with the same `createApplication`, with the real scheduler and import worker. Only `supplier.import.precheck` and `supplier.import.execute` are enabled (plus `tokenRevocation.refresh`, which configuration requires); no other module's background jobs run.
- **Data:** each row is a Supplier with one Address, one Contact and one Identifier.
- **Evidence:** `evidence/20261008-t49-capacity/`.

| Run | Precheck | Execution | Total (NFR-004 ≤ 10 min) | Worker peak RSS | Result |
| --- | --- | --- | --- | --- | --- |
| 10,000 rows | 5.6 s | 52.4 s | 58 s | 226 MiB | 10,000 applied, each exactly once |
| 10,000 rows, worker SIGKILLed after 5,001 rows | 6.9 s | 61.0 s | 68 s | 250 MiB | a second worker took over; 10,000 applied, no duplicates |

- **Per row:** about 3–7 ms. It rises slowly with the row number, because finding the next row gets slightly slower
  as rows are applied.
- **Crash run:** the 11-minute lease of a killed worker was simulated as expired, so it measures the work and not the wait.
- **Downloads:** the 10,000-row result download took 45 ms (489 KB), and a 10,000-row export 60 ms (1.5 MB).
- **Export memory:** an export of 10,000 Suppliers with every field at its maximum length is about 69 MB and briefly needs
  about 530 MB of memory (REV-075 L-4). For that reason at most two exports run at once per process; a third answers
  429 `SUPPLIER_EXPORT_BUSY`. The limit covers building the file. Sending it to the client happens after the slot is freed:
  the file and a copy of it (about 140 MB in the worst case) stay in memory until a slow client has read them, bounded only
  by the request limiter (REV-078 L-3).
- **What the benchmark numbers mean (REV-078 I-4):**
  - "Precheck" includes the worker's start-up and its first 5-second poll, so it is an upper bound.
  - The DB connection figure counts every connection of the database user on the server.
  - The download and export memory figures are before/after differences, not peaks.
  - "Rows applied at kill" is a lower bound.
  - The durability settings (`innodb_flush_log_at_trx_commit`, `sync_binlog`, `log_bin`) are recorded in each report.
- **Running the benchmark safely:** run it only against a throwaway database, from a throwaway checkout or worktree.
  - Command: `node scripts/benchmarkSupplierImport.js --database=<DB_NAME> --rows=10000 --output <file> [--crash]`.
  - It refuses unless `DB_HOST`, `DB_PORT`, `DB_USER` and `DB_NAME` are set (`DB_PASSWORD` may be empty) and
    `--database` repeats `DB_NAME`. It also refuses if any other import job is pending, because its worker is a real
    worker that would process it.
  - After the run it reports `ok: false` and lists any other Supplier import job changed while it ran. The start-up
    check cannot see a job that someone uploads during the run. Its worker runs only the Supplier import jobs, so other
    modules' jobs are never touched (REV-080 L-C).
  - It removes the Suppliers, job, user and role it created, also when it fails or is interrupted with Ctrl-C or
    SIGTERM. An interrupted run stops its worker, cleans up, and writes a report marked `interrupted`; a second Ctrl-C
    is ignored while it does so (REV-080 L-D, REV-081 I-1). SIGKILL of the benchmark itself leaves its data and
    temporary directory behind, but its worker notices the lost parent and shuts down (REV-081 I-2). The job it leaves
    is still pending, so the next run refuses until that job is removed by hand (REV-082).
  - The report records the database name, host, port and socket. With `DB_SOCKET_PATH` set, the host and port are
    not used. It refuses to start if `--output` cannot be written.
  - Its own logs and its worker's go to its temporary directory, which is removed at the end.
- **Fixed during T49** (HD-075):
  - The import no longer runs the similar-name search on every row. HD-052 limits the import to identical-name warnings,
    and the search's cost grew with the number of Suppliers.
  - A worker that stops between rows now releases its lease.

  Before these fixes, the same 10,000 rows did not finish in 20 minutes.

## What to watch

- **Job health:** `fr_job_stats` and the `scheduler.job.failed` log.
  - `supplier.import.purge` reports a failure, with the message `SUPPLIER_IMPORT_PURGE_INCOMPLETE: N file(s) left
    behind`, whenever any file could not be deleted. A purge run cut off by its timeout is recorded as timed out. Alert
    on its `consecutiveFailures`.
  - `supplier.import.execute` stops cooperatively at its 10-minute limit, and the scheduler records such a run as
    succeeded. Watch the `supplier.import.paused` log instead. Its `reason` is `timeout` for the 10-minute limit and
    `shutdown` when the process is stopping, for example during a deploy.
- **Log events:**
  - `supplier.import.purge_failed`: a file the purge refused or could not delete. The entry carries IDs and an errno only.
  - `supplier.import.source_cleanup_failed`: a source that could not be deleted at cancel or after a failed precheck. The
    next purge removes it.
  - `supplier.import.precheck_abandoned`, `supplier.import.count_mismatch`, `supplier.import.authorization_revoked` and
    `supplier.import.not_confirmed`: a job stopped and needs a look.
  - `supplier.import.purged`: a summary of every retention run.
- **Queues:** jobs sitting in `queued` or `uploaded` for more than a few minutes mean a worker is not running.

## Recovery

- **A worker process dies mid-job.** Rows already written stay written. Another instance, or the restarted process,
  continues from the next row once the 11-minute lease expires. Nothing is applied twice; the T45 tests and the T49
  SIGKILL run check this.
- **A worker stops** (shutdown, timeout, or an error such as a lock-wait timeout). It releases the lease, and the job
  continues at the next poll. A process that dies without running its cleanup leaves the lease to expire. So does a
  shutdown whose draining overruns `shutdownTimeoutMs`, because the database may close before the release runs
  (REV-080 I-I).
- **The same error keeps recurring before a row is picked.** Execution has no attempt cap: the job is retried every
  5 seconds (REV-079 I-D). The run is recorded as failed each time, so `consecutiveFailures` on `supplier.import.execute`
  shows it.
- **A job failed.** Its summary, rows and result stay readable. Fix the cause and upload the rows again. Rows marked
  "可重新匯入" (busy) can simply be imported again.
- **Files left after a failed delete.** Fix the permissions. The next daily purge removes them, and its job stats return
  to succeeded.

## Retention and privacy

- Job summaries, rows and audit are kept for at least seven years.
- Source files are deleted:
  - 365 days after an executed job completes;
  - at once when a precheck fails or a user cancels;
  - after 30 days for a job nobody confirmed. That job is cancelled as `SUPPLIER_IMPORT_EXPIRED`, with a system audit.
- When a job is cancelled or expires, its rows' CSV content (`normalized_payload`) is cleared. Their outcomes and error
  codes stay.
- Logs and audit never carry CSV values, file paths or Bank data. The T49 end-to-end test scans for them.

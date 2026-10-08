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
| `supplier.import.execute` | 5 s | instance | Claims a confirmed job and writes rows one at a time, each in its own transaction. The lease is 11 minutes, renewed on every row. A run stops after 10 minutes and releases its lease, so the next poll continues straight away. |
| `supplier.import.purge` | daily | cluster | Applies retention: the files of executed jobs past `FILE_RETENTION_DAYS`, jobs never confirmed past `UNCONFIRMED_RETENTION_DAYS`, and unreferenced files older than a day. |

Each job can be switched off or retuned in `server/config/scheduler.js` under `jobs`. With the precheck switched off,
uploads stay `uploaded` until it is switched back on.

## Capacity (TASK-049)

Measured on 2026-10-08:

- **Environment:** an Apple M5 Pro (15 cores, 24 GiB) running Node v26.6.0 and MySQL 26.7.0, with
  `innodb_flush_log_at_trx_commit=1` and `sync_binlog=1`.
- **Worker:** the real API process (`node src/index.js`) with the default scheduler.
- **Data:** each row is a Supplier with one Address, one Contact and one Identifier.
- **Evidence:** `evidence/20261008-t49-capacity/`.

| Run | Precheck | Execution | Total (NFR-004 ≤ 10 min) | Worker peak RSS | Result |
| --- | --- | --- | --- | --- | --- |
| 10,000 rows | 5.8 s | 51.1 s | 57 s | 225 MiB | 10,000 applied, each exactly once |
| 10,000 rows, worker SIGKILLed after 5,003 rows | 5.6 s | 58.5 s | 64 s | 226 MiB | a second worker took over; 10,000 applied, no duplicates |

- **Per row:** about 3–6 ms. It rises slowly with the row number, because finding the next row gets slightly slower
  as rows are applied.
- **Crash run:** the 11-minute lease of a killed worker was simulated as expired, so it measures the work and not the wait.
- **Downloads:** the 10,000-row result download took 32 ms (479 KB), and a 10,000-row export 48 ms (1.5 MB).
- **Export memory:** an export of 10,000 Suppliers with every field at its maximum length is about 69 MB and briefly needs
  about 530 MB of memory (REV-075 L-4). For that reason at most two exports run at once per process; a third answers
  429 `SUPPLIER_EXPORT_BUSY`.
- **Fixed during T49** (HD-075):
  - The import no longer runs the similar-name search on every row. HD-052 limits the import to identical-name warnings,
    and the search's cost grew with the number of Suppliers.
  - A worker that stops between rows now releases its lease.

  Before these fixes, the same 10,000 rows did not finish in 20 minutes.

## What to watch

- **Job health:** `fr_job_stats` and the `scheduler.job.failed` log.
  - `supplier.import.purge` reports a failure, with the message `SUPPLIER_IMPORT_PURGE_INCOMPLETE: N file(s) left
    behind`, whenever any file could not be deleted.
  - A run cut off by its timeout is recorded as timed out.
  - Alert on its `consecutiveFailures`.
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
- **A worker stops cleanly** (shutdown or timeout). It releases the lease, and the job continues at the next poll.
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

# TASK-041 — carry-forward obligations

T41 delivers config, names and helpers that nothing consumes yet. REV-059 M-1 pointed out that the
promises behind them were written nowhere the later tasks will read. They are written here instead of
in `05_development_tasks.md`, because editing that file moves the PLAN baseline and strands every
record bound to it. Each item names the task that must discharge it and where it came from.

| Task | Obligation | Source |
| --- | --- | --- |
| T42 | Require `import.root` when the import services register; today it is optional so import-less deployments boot | HD-039 (B) |
| T42 | Create the root and `source`/`result` as mode 0700, owned by the service user; refuse a root writable by group or other (for example `/tmp`) | REV-059 L-7, L-6 |
| T42 | At storage start, `realpath` and `lstat` each configured root (Customer import and attachment, Item media and import — HD-040); refuse when two share `dev`+`ino` or one real path contains another. The startup check compares strings only, so case-insensitive filesystems and symlinked parents pass it | REV-059 L-5 |
| T42 | The precheck and worker services declare `static jobs` with `SUPPLIER_IMPORT_JOB_NAMES.precheck` and `.worker`, and a test deep-equals them. The scheduler silently ignores an override for a job name nothing registers | REV-059 M-1 |
| T42 | Every stored file name comes from `newSupplierImportStoredName()` and every path from `supplierImportFilePath()` | REV-059 M-1 |
| T43 | Reassess DEF-023 before CSV import accepts account-like columns: request-log redaction is a field-name blacklist, and a 5xx captures the full body | HD-036 §3, DEF-023 |
| T43 | The CSV `split` test is a tripwire, not proof: it misses `split(",", n)`, a separator held in a variable, `split("\r")` and `fromCharCode(44)`. T43's review must confirm every CSV read and write goes through `csv-parse` / `csv-stringify` | REV-060 L-11 |
| T44 / T45 | A result or source download takes the stored name from the job row, never from the request | REV-059 I-6 |
| T44 / T45 | Before serving a stored file, `lstat` it and refuse `nlink > 1`: a hard link planted in the root would serve content from outside it | REV-059 I-6, REV-060 I-12 |
| T48 | The purge service declares `SUPPLIER_IMPORT_JOB_NAMES.purge` | REV-059 M-1 |
| T48 | Immediately before each `unlink`: `lstat` the kind directory and require the same `dev`+`ino` as at listing; `lstat` the file and require `isFile()` and the same `dev`, and `nlink === 1`; unlink the bare stored name joined to that verified directory. A failed delete is logged and retried next run (design §12.4) | REV-059 L-6 |

## Mutation record for TASK-041

Round 1 (commit 805423e), against `supplierImportConfig`, `supplierConfig` and `configuration` tests —
all killed: relative root accepted; root not normalised; overlap check not called; prefix match instead
of containment; one direction only; symlinked files listed; `stat` instead of `lstat`; any stored name;
any kind; a naive split added; two job names colliding.

Round 2 (after REV-059) — all killed: the `dev` check removed (now testable through an injected
`lstat`); the three attachment roots ignored; the `$` anchor removed; the listing root not resolved;
a filesystem root accepted; `split(",")` planted in `handlers/supplier-approvals`; the same planted in a
not-yet-created `handlers/supplier-imports`; `split(/,/)` and `split("\n")` planted in
`modules/supplier`. Round 1 was re-run after the test changes and stayed all-killed.

## Status after TASK-042

| Obligation | Status |
| --- | --- |
| 0700 root and kind directories, owned by the service user; group/other-writable root refused | **Done** — `prepareSupplierImportRoot`, run by `SupplierImportWorkerService.initialize` |
| `realpath` + `dev`/`ino` overlap check against Customer and Item roots | **Done** — same function; `fs.promises.realpath` restores on-disk case, so a case variant on a case-insensitive filesystem is caught |
| Worker `static jobs` use `SUPPLIER_IMPORT_JOB_NAMES.worker`, pinned by a test | **Done** |
| Stored names only via `newSupplierImportStoredName` / `supplierImportFilePath` | **Not yet exercised** — T42 writes no files; carried to T43 (upload) |
| Precheck job uses `SUPPLIER_IMPORT_JOB_NAMES.precheck` | **Moved to T43** — precheck is T43's job; T42 has nothing to schedule for it |
| Root required when import services register (HD-039 B) | **Moved to T43/T44 by HD-046 (a)** — required when the upload API registers, which is when import is actually deployed. The T42 worker registers everywhere and does nothing without a root; with no upload there are no jobs |

New obligations T42 creates:

| Task | Obligation |
| --- | --- |
| T43 / T44 | Refuse startup without `import.root` once the upload API registers (HD-046 a) |
| T45 | Wire the real `applyRow` into `SupplierImportWorkerService` (it claims nothing until then), writing Supplier and audit on the given connection and returning the Supplier ID |
| T45 | `applyRow` must call **connection-taking** domain helpers extracted from `SupplierAdminService` and the other write services. Their public methods each open `database.withTransaction` on a second pooled connection, which commits the Supplier before the marker — the two-phase path design §8.8 forbids (REV-061 M-3, verified E4b). The connection handed to `applyRow` admits only `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `REPLACE` and `WITH` (after leading comments; any `/*!` and `INTO OUTFILE`/`DUMPFILE` refused), on both `query` and `execute` — an allowlist since REV-062 M-4 showed a blacklist is bypassed by comments, `CALL`, `PREPARE` and `SET @@autocommit`. It cannot see a second connection, so it does not make a public service method safe |
| T45 | The whole row, job lock included, must finish inside `DB_TRANSACTION_TIMEOUT_MS` (20 s by default) |
| T45 | Ship an integration test with the **real** `applyRow` that injects a failure after the Supplier write and asserts no Supplier, audit or name-gram row survives |
| T45 | Domain errors thrown from `applyRow` must set an explicit Chinese `publicMessage`: `ApplicationError` defaults it to the internal message, and the row stores `publicCode` / `publicMessage` for domain codes (REV-061 I-4). Decide whether transient errors (lock wait, deadlock, transaction timeout) should retry instead of failing the row (I-3) |
| T43 / T46 | Check `total_count = applied + failed + skipped` at finalize; T42 rebuilds applied/failed/skipped from rows but T43 writes `total_count` (REV-061 I-13) |
| T45 | Re-check at execution that the confirming user is still active and holds `supplier.mgmt`, as Customer import does; T42 does not |

## REV-061 notes kept for later

- **L-2, accepted.** Under REPEATABLE READ the claim reads and locks every queued or running candidate before sorting, so concurrent claimers get one job per burst and the rest return `null`; the next 5 s tick takes the next job. Nothing is lost. A `(status, confirmed_at, id)` index would let `LIMIT 1` stop early, but that is a schema change and needs its own approval.
- **L-5.** T42's `migrations.integration.test.js` Verification item covers 0006–0028 only. Convergence and fail-closed coverage for 0061/0062 is in `test/integration/supplierImportExecution.integration.test.js`, which is what met that item.
- **I-7.** `server/config/supplier.js:14` still says the root becomes required at T42; HD-046 moved that to T43/T44. The file is approval-required, so the comment is corrected with HD-047's change.
- **I-14.** The integration test's `quiesce()` cancels or fails every open job in the schema it runs on; do not run it against a schema where someone is checking a worker by hand.

## Mutation record for TASK-042

All killed, against `supplierImportService`, `supplierImportWorkerService` and the
`supplierImportExecution` integration test on real MySQL: claiming a running job whose lease is live;
newest job first; invalid rows not skipped; rows out of order; lease not checked; the applied marker
committed in a separate transaction; an `applyRow` that returns no ID accepted; the thrown message stored
as the row error; finalize with rows pending; finalize ignoring failures; a terminal state reopened; the
worker ignoring abort; the worker running without `applyRow`; the root not prepared; a loose root
accepted; the realpath overlap skipped; the rows CHECK not inspected; a CASCADE row FK accepted; the job
column types not inspected. Four of these first survived and each got a test.

After REV-061, 40 mutants, all killed: the 19 above, ten of REV-061's survivors (no `SKIP LOCKED`; no lease check on the
failure path; no renewal after an applied row; no renewal after a failed row; kind-directory `dev`, owner, and `chmod`
checks; root `chmod`; the `dev`/`ino` same-directory check; the rows trigger check — the first revision of this record
said "eleven", which REV-062 L-8 caught; its count of 39 was itself wrong, as REV-063 I-24 showed, because the
remediation list below has eleven entries) and eleven for the remediation (a
generic code passed through to the row; no failure log; `applyRow` given the raw connection; a leaseless running job
left stuck; an unconfirmed job claimed; the root's parent unchecked; `auto_increment`, extra UNIQUE, charset and CHECK
contracts on jobs; an extra CHECK on rows). The pending guard on the failure path (REV-061 M4) is left as REV-061 found
it: the rollback returns the row to pending before that UPDATE runs, and the CHECK backstops the applied case.

After REV-062, 56 mutants, all killed, on the tree with main merged in: the 39 above plus the allowlist admitting `SET` or
`CALL`; an executable comment allowed; `INTO OUTFILE` allowed; leading comments not stripped; `execute` unguarded (it
first survived — `COMMIT` runs as a prepared statement on MySQL, so a real-MySQL `execute("COMMIT")` case was added);
`SERVICE_UNAVAILABLE` passed through; `causeName` dropped from the log; the not-confirmed path unlogged; each half of
the confirmer check; the worker not passing its logger; the ancestor owner check; only the parent checked; ancestors
judged by string instead of realpath; a NOT ENFORCED rows CHECK accepted.

## REV-062 notes kept for later

- **I-17.** A queued job whose confirmer was deleted (`confirmed_by` is `ON DELETE SET NULL`) is failed with
  `SUPPLIER_IMPORT_NOT_CONFIRMED` and now logged as `supplier.import.not_confirmed`. A **running** job whose confirmer is
  deleted is still resumed by T42; T45's re-check of the confirmer (HD-048) must fail it.
- **I-18.** The failure log is written only when the row is actually marked `failed`; when the lease is lost the row
  stays pending for the new owner and no "row failed" line is written.
- **I-19.** Session `SET`s (`sql_mode`, `transaction_isolation`, `NAMES`, `foreign_key_checks`, `autocommit`) can no
  longer reach the pooled connection through `applyRow`: `SET` is outside the allowlist.
- **M4 (REV-061), left as found.** The pending guard on the failure UPDATE is backstopped by the rollback and the CHECK;
  REV-062 agreed.

After REV-063, 63 mutants, all killed: the 56 above plus the allowlist unanchored; the failure log written before the
lease check; the ancestor check ignoring group-write; the guard refusal and the missing-ID failure logged without a
code; `INTO/**/OUTFILE` accepted; root preparation keeping the configured path; the worker ignoring the real path it is
given back. The last one first survived and got a test that configures the root through a symlink.

## REV-063 notes kept for later

- **For operators (I-27).** Every ancestor of the real import root must be owned by the service user or root and must
  not be group- or other-writable unless it has the sticky bit. A Kubernetes `fsGroup` volume (typically 2775) and an
  NFS export mapped to `nobody` (uid 65534) are therefore refused at startup; mount the root so that its ancestors meet
  that rule. The refusal names the ancestor.
- **T45 (I-23).** The allowlist still lets a `SELECT` leave state on the pooled connection: `GET_LOCK` named locks, user
  variables, and a transaction isolation set inside a stored function. Nothing uses these today; T45's `applyRow` must
  not either.
- **I-25, accepted.** The guard also refuses `--\r\n`-style comments, a parenthesised `(SELECT …)` and a string literal
  containing `/*!`. None occurs in the codebase; a T45 helper that needs one can be rewritten.
- **I-26, accepted.** Both log lines are written before `COMMIT`, so a failed commit leaves one line per attempt that
  describes a state that was rolled back. `withTransaction` does not retry, so nothing is duplicated.

## Status after TASK-043

| Obligation | Status |
| --- | --- |
| HD-042: reassess DEF-023 before CSV import accepts account-like columns | **Done, DEF-023 stays accepted — first version of this row was wrong, see "REV-064 remediation" below.** The CSV path does not widen it: (1) the request log records a multipart body as `[FILE_TRANSFER]` whatever the status, 5xx included — now pinned by `requestLogger.test.js`; (2) a Bank column fails the whole file before any row is stored, and the message names the column by position, not by its text; (3) row errors are fixed strings and never carry a cell value; (4) the integration test scans rows, jobs, audit and both log directories for an IBAN sent under an `IBAN` column and finds none. What remains of DEF-023 is unchanged: the blacklist still guards JSON routes only by field name. |
| HD-042: every CSV read and write goes through `csv-parse` / `csv-stringify` | **Done.** Reads: `SupplierImportProcessor.js` only (`csv-parse`). Writes: `supplierCsvSchema.js` only (`csv-stringify/sync`). No `split` in `modules/supplier`, `services/supplierImport` or `handlers/supplier-imports`. |
| HD-047 (1): startup without `import.root` | **Superseded by HD-050 (a).** Startup is not refused; the worker logs `supplier.import.disabled` and upload answers 503 `SUPPLIER_IMPORT_UNAVAILABLE`. The comment in `server/config/supplier.js` now says so (approved in HD-050). |
| HD-047 (2): precheck job name | **Done.** `SupplierImportWorkerService.jobs` declares `SUPPLIER_IMPORT_JOB_NAMES.precheck`; the test deep-equals both names. |
| HD-047 (3): stored names only from the helpers | **Done for upload and precheck.** `writeSupplierImportSource` takes its name from `newSupplierImportStoredName()` and its path from `supplierImportFilePath()`; `readSupplierImportSource` also goes through `supplierImportFilePath()`. |
| HD-049: finalize checks `total_count = applied + failed + skipped` | **Done for T43's half.** Precheck sets `total_count` from the rows; `finalizeExecution` fails the job with `SUPPLIER_IMPORT_COUNT_MISMATCH` and logs `supplier.import.count_mismatch` when the rows no longer add up. T46 still owns the result file's counts. |

New obligations T43 creates:

| Task | Obligation |
| --- | --- |
| T45 | Precheck is a snapshot. Re-check at execution everything it checked: Code and Identifier still free, the target not archived, `expected_supplier_version`, currency and payment term still active. |
| T45 | An update row that changes `defaultCurrencyCode` needs a reason in `SupplierAdminService`; the CSV has no reason column, so `applyRow` must supply one (for example the import job ID). |
| T45 | The Address and Contact in the payload are the output of the exported `normalizeAddress` / `normalizeContact`; apply them through the same services' connection-taking helpers (HD-048). |
| T44 / T45 / T46 | A stored file is read the way `readSupplierImportSource` does it: `O_NOFOLLOW`, `fstat` regular file with `nlink === 1`, and the recorded SHA-256 (HD-043). |
| T46 | The result CSV is written with `SUPPLIER_CSV_STRINGIFY_OPTIONS`: with CRLF records, csv-stringify quotes a cell only when it holds `\r\n`, so a bare `\n` or `\r` would split the row. Formula-risk cells are guarded there too (design §6.9). |
| T48 | Upload writes the source before it inserts the job, so a crash between the two leaves a stored file no job references. The purge deletes such files once they are older than a day (HD-044, added by HD-050). |

T43 notes:

- **Row numbers** count data rows only (1 = the first row after the header, template description and example rows and blank rows not counted), the same convention as Customer import.
- **The upload size limit** in the route is read from `config/supplier.js` when the handler module loads; the service checks the normalised `maxFileBytes` again and answers 413.
- **Name warnings** (HD-052 A, after REV-064 H-2): precheck warns only on a name identical after normalisation (NFKC, case, spaces) to another row or to an existing Supplier, with one query per 500-row batch. Fuzzy similarity (`SupplierDuplicateCandidates`, 0.85) stays in the UI create/update path; a merely similar name is not flagged in CSV import. The first version looked up fuzzy candidates per row, which never finished a 10,000-row file against a few thousand Suppliers.

## Mutation record for TASK-043

58 mutants against the T43 code, all killed on 05d8122 (unit files, the two import integration files on real MySQL,
and `requestLogger.test.js`). Each mutant was applied to a committed tree and restored from the saved bytes.

- **Processor (30):** Bank header not special; unknown, missing or duplicate header allowed; template or blank rows not
  skipped; row and byte limits off by one; UTF-8 not fatal; parse errors rethrown; child columns allowed on update; a blank
  root cell clearing on update; the ID/Code cross-check removed; `create_only` accepting a taken Code or a `supplierId`;
  archived Suppliers allowed; in-file Code, target, Identifier and name duplicates ignored; the database Identifier check
  removed; similar-name lookup matching the row's own Supplier or run on invalid rows; issues unbounded; control characters
  allowed; payment-term spaces not collapsed; currency not upper-cased; create's required fields unchecked; the address
  normalised over already-bad cells; an unknown `supplierId` not reported.
- **Service (14):** the claim keeping partial rows, ignoring a live lease or waiting on a locked job (no `SKIP LOCKED`);
  append or complete without the lease check; a failed precheck keeping its rows; invalid rows not making
  `ready_with_errors`; the upload leaving its file after a failed insert, skipping the actor check, its size limit off by
  one, running without a root; finalize ignoring `total_count` (HD-049); either audit action dropped.
- **Files (4):** the source written 0644; the read following symlinks, accepting hard links, or skipping the SHA-256.
- **Worker (5):** completing the job on any error; no `supplier.import.disabled` warning; the configured instead of the
  real root; shutdown not honoured between batches; the precheck job under another name.
- **Handler, template, request log (5):** the upload buffer kept; the configured root used; the template without the
  Bank notice; bare LF/CR cells not quoted; a 5xx multipart body captured by the request log.

Four first survived and each got a test: the similar-name lookup on invalid rows (the test's invalid row had no name),
a stale owner appending rows, rows left behind by a precheck that fails after its first batch, and bare LF/CR quoting.
The last is equivalent for our own reader — csv-parse detects the CRLF delimiter and keeps a bare `\n` inside the cell — so
the test pins the written bytes instead: readers that end a line at `\n` (spreadsheets) would split the row.


## REV-064 remediation (HD-052, HD-053)

REV-064 (`67_rev_064_independent_review.md`) found two Highs with one cause — precheck had no terminal state for an error it
did not expect and no bound on attempts — and a Medium. What changed:

| Finding | Change |
| --- | --- |
| H-1: a stray quote threw csv-parse's `INVALID_OPENING_QUOTE`, whose message holds the cell text, to the scheduler, which logged it; the job retried forever | Every `CsvError` fails the file as `SUPPLIER_IMPORT_CSV_MALFORMED`. The worker rethrows only a code, never a message built from the file. A job reclaimed after `MAX_PRECHECK_ATTEMPTS` (3) attempts is failed with `SUPPLIER_IMPORT_PRECHECK_FAILED` (counted from `version`, which only the claim increments while `validating`; no schema change). |
| H-2: the per-row fuzzy name lookup made a 10,000-row file restart forever | HD-052 (A): exact-name warnings, one query per batch. A 10,000-row file against 2,000 Suppliers now prechecks in about 0.3 s on the test MySQL (the reviewer measured about 5 minutes before); pinned by an acceptance test with a 60 s bound. |
| M-1: a file failed for a Bank column stayed on disk in plaintext for 365 days | HD-053 (A): the header is read at upload and a Bank column is refused with 400 before anything is stored; every job whose precheck fails gets `files_purged_at` and its source is deleted at once. |
| L-1 | A failed cleanup after a failed upload or precheck is logged as `supplier.import.source_cleanup_failed` (stored name and error code only). |
| L-2 | Tests for a directory or an oversized file at the stored name, lease renewal on append, abort between batches, and the catalogue's second page. |
| L-3 | The mutation harness runs serially and checks an unmutated baseline first. |
| I-5 | The source is opened with `O_NONBLOCK`. |
| I-1 | Bucket counts above corrected (Service 14, Handler/template/request log 5; total 58 unchanged). |

**Correction to the DEF-023 row above.** It said nothing on the CSV path widens DEF-023 and that the integration test finds an
IBAN in no log. That held for the request log and for a Bank *column*, but REV-064 H-1 showed the system log received cell
text through the scheduler's `scheduler.job.failed` line. After the fix the worker hands the scheduler a code only, and an
integration test sends an IBAN in `notes` behind a stray quote and finds it in no log and, once the job fails, in no stored file.

New or changed obligations:

| Task | Obligation |
| --- | --- |
| T48 | A stored file is unreferenced unless a job names it **and** that job's `files_purged_at` is NULL. Failed prechecks set `files_purged_at` before deleting their source, so a delete that failed (logged) is collected by the same rule (HD-053, extends HD-044). |
| T44 | REV-064 I-3: with a root configured but the precheck job disabled in `scheduler.jobs`, uploads are accepted and stay `uploaded`. Decide with the job API whether upload should also answer 503 then. |
| T45 | REV-064 I-4: an update row may target a `pending_approval` Supplier; applying approval-significant fields must invalidate the pending request exactly as `updateSupplier` does (covered by HD-048 (2), named here). |
| — | REV-064 I-2: design §6.11 lists `CURRENCY_INVALID/INACTIVE` and `PAYMENT_TERM_INVALID/INACTIVE`; the API and precheck use Business Master's `CURRENCY_NOT_ACTIVE` / `PAYMENT_TERM_NOT_ACTIVE`. The design table is stale; not edited here (it moves the DESIGN baseline). |
| — | REV-064 I-6 (route size limit read from `config/supplier.js` at load, service limit from the normalised config) and I-7 (no per-user upload quota) are recorded, not changed. |

**Mutation after REV-064** (on 7826846, harness serial with an unmutated baseline first; the baseline passed): 74 mutants,
72 killed. The 58 above (three patterns re-pointed at the changed code), REV-064's L-2 survivors that are not equivalent
(no lease renewal on append, no abort check between batches, the catalogue's first page only, `SUPPLIER_IMPORT_FILE_TOO_LARGE`
not a source error), and the remediation: only `CSV_`-prefixed parse errors mapped; the worker rethrowing the original error;
precheck attempts unbounded or off by one; the cleanup failure not logged; an existing identical name ignored; an update
flagged against itself; no name query; a Bank-column file stored at upload; the upload header check not trimming; a failed
or abandoned precheck keeping its source; `files_purged_at` not set.

Two survive and are equivalent: `readSupplierImportSource` without `isFile()` (a directory has `nlink >= 2`, so the
`nlink === 1` check refuses it first) and without the read-side size check (the processor refuses the same size with the
same code; the read-side check only saves reading it into memory). REV-064's other equivalent survivors (write without
`O_NOFOLLOW` or `O_EXCL` with a 256-bit random name, `max_record_size` within the 10 MB limit, `ciphertext` dropped from
the Bank regex while every unknown header is refused anyway) are accepted for the same reason.

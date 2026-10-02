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
| H-2: the per-row fuzzy name lookup made a 10,000-row file restart forever | HD-052 (A): exact-name warnings, one query per batch. A 10,000-row file against 2,000 Suppliers now prechecks in about 0.3 s on the test MySQL (the reviewer measured about 5 minutes before). The acceptance test with a 60 s bound did not pin this at first — its Suppliers had no name grams, so the old per-row lookup stayed fast (REV-065 L-1); see "REV-065 remediation". |
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


## REV-065 remediation (HD-054, HD-055, HD-056)

REV-065 (`68_rev_065_independent_review.md`) closed REV-064's H-1 and H-2 and approved with conditions:

| Finding | Change |
| --- | --- |
| M-1: the upload header check parsed without `skip_empty_lines`, so a Bank-column file with a leading blank line (CRLF, LF or BOM+CRLF) was stored until precheck deleted it | HD-054 (A): upload and precheck share one decoder and one set of parser options (`CSV_OPTIONS`), and the upload refuses with 400 **any** header problem — Bank, unknown, missing or duplicate column, a non-UTF-8 file, a header that does not parse, a file with no header. Every stored file therefore has a valid v1 header. A test feeds the same bytes to both and requires the same accept/refuse verdict (and `BANK_COLUMN_FORBIDDEN` at both for the Bank cases); the codes may differ only where csv-parse reaches a later row's column-count error first. |
| L-1: the 10,000-row test could not catch the per-row lookup coming back | The seeded Suppliers now get their real name grams (`hashNameBigrams`); a unit test requires the same number of queries for a 1-row and a 500-row batch (at most 3). A mutant that reintroduces the per-row fuzzy lookup is killed. |
| L-2: nothing tested that an abandoned job's rows are deleted | The abandon test appends a row on each crashed attempt and requires none after abandonment. |
| L-3: HD-052 departs from BR-009, BR-026 and §16.2 | HD-055 (A): confirmed as a recorded deviation for the CSV channel (HD-052 now names them). §16.2's similar-name exception list for legacy data goes to go-live preparation under TASK-051 (HD-057). |
| I-4 | Identifiers are looked up by the full unique key `(identifier_type, issuer_country_code, identifier_value_key)`: EXPLAIN on 20,000 rows changes from a covering index scan of 20,000 rows to a range seek. |
| I-5 | HD-056 (A): PR #169, lockfile only (brace-expansion and fast-uri patch releases). |

Corrections to the text above:

- **Equivalent `isFile()` mutant (REV-065 I-1).** A directory is refused by `nlink === 1` (it has `nlink >= 2`), but a FIFO has `nlink` 1; with `O_NONBLOCK` and no writer it reads as 0 bytes and fails the SHA-256 check. The outcome is the same `SUPPLIER_IMPORT_SOURCE_UNAVAILABLE`; the SHA check, not `nlink`, is what covers a FIFO.
- **Mutation arithmetic (REV-065 I-2).** "74 mutants" = the 58 of the first record with three of them re-pointed at the changed code (only `CSV_`-prefixed parse errors, an update flagged against itself, an existing identical name ignored), plus 4 L-2 mutants and 12 other remediation mutants. `mut43.py`'s label "name lookup per row instead of per batch" described a mutant that removes the name query; the doc's wording ("no name query") is the right one.

New obligations:

| Task | Obligation |
| --- | --- |
| T44 | REV-065 I-3: the precheck attempt bound counts every takeover — shutdown, scheduler timeout, a Business Master or DB outage — so an outage longer than about 3 × 180 s fails pending uploads with `SUPPLIER_IMPORT_PRECHECK_FAILED` and deletes their sources; the job API text and operator notes must say so. The count is `version - 1` while `validating`; any T44 writer that bumps `version` on an `uploaded` or `validating` job (retry, cancel) shifts it — use a dedicated attempts column (schema change, needs approval) if that becomes necessary. |
| T51 | HD-057: the go-live legacy-data preparation produces the similar-name exception list of requirement §16.2. |

**Mutation after REV-065** (on d4595a2 plus the header-trim test; serial harness, baseline passed): 81 mutants, 79 killed.
New since the REV-064 round: the upload storing a file with a bad header; header names not trimmed (first survived — a
test now uploads and prechecks a template whose column names have spaces around them); the upload parser keeping leading
blank lines (REV-065 M-1); the upload checking only Bank columns; the upload storing a non-UTF-8 file, an unparseable
header or a blank file; the per-row fuzzy lookup reintroduced (REV-064 H-2, now killed by the 10,000-row test with name
grams); an abandoned job keeping its rows (REV-065 L-2). Survivors: the same two equivalent read-side mutants as before.

## REV-066 remediation

REV-066 (`69_rev_066_independent_review.md`) closed REV-065's M-1 (170,072 differential inputs, no file the upload stores
whose header precheck refuses) and approved with one condition:

| Finding | Change |
| --- | --- |
| M-1: the upload header check had no cost bound — `max_record_size` counts field content only, so 10 MB of commas became about ten million empty fields and blocked the event loop for about 1.2 s per request | The shared `CSV_OPTIONS` cap each record at 256 fields (above the template's 30, so a Bank column still gets its own code) through a `cast` that throws a `CsvError`, mapped to `SUPPLIER_IMPORT_CSV_MALFORMED` at both upload and precheck. The same file is now refused in a few milliseconds; a test requires under 100 ms at upload and under 500 ms at precheck. |
| I-2: nothing tested that identifiers are looked up by type and country as well as value | A unit test with two rows sharing a value under different types, against a fake that answers only the tuples it is asked for. |

Recorded, not changed:

- **I-1.** The index seek of the identifier query (REV-065 I-4) is correct but no test pins the plan; a revert is equivalent in outcome.
- **I-3.** The upload/precheck parity test is a fixed case list; the reviewer's differential fuzzer found no divergence. Upload and precheck share `CSV_OPTIONS`, `decodeUtf8` and `headerNames`, which is what keeps them identical.
- **I-4.** Of the nine items listed under "Mutation after REV-065", two ("a file with a bad header stored", "header names not trimmed") are REV-064-round mutants re-pointed at the new code; the count of 81 is right.
- **I-6.** The header check runs before the actor-freshness check inside the upload transaction. A user whose `supplier.mgmt` was revoked but whose token still claims it gets header answers (fixed messages) instead of `PERMISSION_STALE`, and a valid-header file is written and then removed when `authorize` fails. Since HD-054 such a file cannot hold a Bank column; left as is.

**Mutation after REV-066** (on aa416df; serial harness, baseline passed): 84 mutants, 82 killed — the 81 above plus no field
cap, a field cap below the template width, and identifiers keyed by value only. Survivors: the same two equivalent
read-side mutants.

## REV-067 remediation

REV-067 (`70_rev_067_independent_review.md`) closed REV-066's M-1 (upload finishes every 10 MB shape tried in 110 ms or less;
comma and quoted-empty floods in about 2 ms) and approved with one condition:

| Finding | Change |
| --- | --- |
| L-1: the field-cap `cast` builds an info object per field, so precheck parsed about 2.5–3 times slower, and it parsed the whole file in one synchronous slice on the API process's event loop — 10 MB of blank rows after a valid header blocked it for about 0.75–1.0 s | Precheck feeds the parser in 64 KiB slices (`SUPPLIER_CSV_PARSE_SLICE`, never splitting a surrogate pair) and yields with `setImmediate` every 1,000 records, skipped blank rows included. A test requires the longest event-loop gap during that file to stay under 200 ms; tests put an emoji's surrogate pair and a CRLF across a slice boundary and require the row intact. |
| I-1: the precheck half of the 10 MB test did not discriminate | A header of 257 fields is `SUPPLIER_IMPORT_CSV_MALFORMED` at both upload and precheck; without the cap precheck would read it and report an unknown column. |
| I-2: the identifier test pinned type but not country | A second pair with the same type and value in two countries. |
| I-3 | The cap comment says a header wider than 256 fields reports `MALFORMED` even with a Bank column (still refused, never stored). |
| I-4 | origin/main 8bc4a4c (sales-order docs only) merged into the branch. |

**Mutation harness note (REV-067 I-5).** `mut43.py` sources `scratchpad/env43.sh`, which sets `DB_NAME=erp_dev`; the
author's runs therefore used `erp_dev` on the throwaway MySQL at 3443 on purpose (that instance exists only for this task).
A reviewer re-running the script must point `ENV` at a copy with their own schema; exporting `DB_NAME` first has no effect.

**Mutation after REV-067** (on 5350f16; serial harness, baseline passed): 89 mutants, 87 killed — the 84 above plus the
precheck parser without the field cap, the identifier key dropping the country, parsing in one slice, never yielding to
the event loop, and a slice splitting a surrogate pair. Survivors: the same two equivalent read-side mutants.


## REV-068 (approved)

REV-068 (`71_rev_068_independent_review.md`) approved 369b989 with no conditions: REV-067's L-1 is closed (10 MB of blank
rows after a valid header: longest event-loop gap on the real worker path 1,424 ms before, 18–25 ms after), slicing is
value-preserving (0 divergences over 100,000 fuzzed inputs at 9 slice sizes, while the same fuzzer finds thousands with the
surrogate guard removed), and the mutation counts reproduce (89, 87 killed, #63 and #64 equivalent). Its Info items:

- **I-1, recorded, not changed.** The yield counts records, not bytes. Files with very wide rows (about 20 KB each) still
  parse up to the first 500-row flush without a macrotask boundary: about 0.13–0.20 s at the default 10 MB, 0.3–0.38 s at
  the configurable 100 MB ceiling — the same as before REV-067's fix, not a regression. The reviewer verified an optional
  fix (also yield after every 1 MiB of parser progress: 32–45 ms); left for a later change if the stall matters.
- **I-2.** A CSV error in the middle of a file now surfaces after earlier slices' batches were checked and appended; the
  failing `completePrecheck` deletes them in the same transaction that marks the job failed, so the end state is unchanged.
  The processor's header comment now says so. **T44 obligation:** the row-read endpoint must never serve rows of a
  `validating` job.
- **I-3.** The 200 ms gap assertion pins the order of magnitude (about 12× headroom normally, 2× under heavy CPU load), not
  the slice size or yield constants.
- **I-4.** origin/main d6397e0 (inventory reservations, migration 0063, permission catalogue, lockfile) merged into the
  branch before merge.
- **I-5.** Wording in this doc corrected ("finishes", not "refuses").

## Status after TASK-044

T44 adds `GET /api/v1/supplier-imports`, `GET /api/v1/supplier-imports/:id` and `POST /api/v1/supplier-imports/:id/cancel`
(`handlers/supplier-imports/jobHandlers.js`, `SupplierImportService.list/get/cancel`) and the client service
`client/src/services/supplierImport.js`. The open points were decided in HD-058 (1A 2A 3A 4A 5B).

| Obligation | Status |
| --- | --- |
| REV-068 I-2: never serve rows of a `validating` job | **Done.** `get` answers no rows while the job is `uploaded` or `validating`; the integration test writes a batch into a validating job and sees none served. |
| REV-064 I-3: uploads while the precheck job is disabled | **Decided, HD-058 5B.** Upload stays open; the job waits in `uploaded` and can be cancelled. The upload route description says so. |
| REV-065 I-3: the precheck attempt bound must be stated | **Done.** The upload and detail route descriptions state the three-attempt bound and that a long outage fails the job. Cancel cannot touch a `validating` job (HD-058 2A) and is terminal, so it never shifts the `version - 1` attempt count. |
| HD-043, T44 part: stored name from the job row; refuse `nlink > 1` before serving | **Moved to T46 by HD-058 4A.** T44 serves no file. Cancel deletes the source by the stored name it reads from the locked job row. |
| HD-047 (3), T44 part: stored names only from the helpers | **Done.** Cancel removes the source through `removeSupplierImportFile` → `supplierImportFilePath`. |
| T44 criterion "a purged file answers 410" | **Moved to T46 by HD-058 4A.** The job summary carries `filesPurged`; the 410 belongs to the download endpoint. |

New obligations T44 creates:

| Task | Obligation |
| --- | --- |
| T45 | HD-058 1A covers list, get and cancel. Confirm must take a position too: a non-uploader cannot read the job (404), so the simplest consistent rule is that only the uploader confirms. Raise it with the confirm design if T45 wants otherwise. |
| T45 | Confirm reads the job `WHERE id = ? AND created_by = ?` like cancel, so a foreign or missing job is the same 404. |
| T46 | The result download answers 410 when `files_purged_at` is set, takes the stored name from the job row, reads the file the way `readSupplierImportSource` does (`O_NOFOLLOW`, regular file, `nlink === 1`, recorded SHA-256), and applies the uploader-only 404. |
| T46 | Handlers register in file-name order and Express 5 cannot constrain `:id`. `jobHandlers.js` sorts after `importTemplateUploadHandlers.js` so `GET /:id` does not swallow `GET /template`. Any new static `GET /api/v1/supplier-imports/<word>` must sit in a file that sorts before `jobHandlers.js`. The integration test's template download catches a break. |
| T48 | A cancelled job has `files_purged_at` set and its source is deleted at once; a delete that failed (logged as `supplier.import.source_cleanup_failed`) leaves a file whose job has `files_purged_at` set, which HD-044 already treats as unreferenced. |
| Operations | HD-058 1A: a job whose uploader's user is deleted (`created_by` becomes NULL) is visible to no one through the API. It stays in the database with its audit; a `ready` job of that kind waits for T48's purge. |

## Mutation record for TASK-044

39 mutants against the T44 code, all killed (unit files and the two import integration files on real MySQL, run serially,
each mutant applied to a committed tree and restored from the saved bytes):

- **Service (33):** list, get or cancel reaching another user's job; the fresh-actor check dropped from each; list ignoring
  the status filter or the offset, or sorting oldest first; get serving rows while prechecking (twice: the guard, and
  `validating` dropped from the hidden set), ignoring the row-status filter or the offset; the page size unbounded or the
  offset overflow unchecked; cancel in any state, `validating` cancellable, `queued` not; cancel ignoring the version, not
  setting `files_purged_at` or `completed_at`, not bumping the version, keeping the source, not reporting a missing root,
  not logging a failed delete, not auditing, or losing the before-state; the summary's `filesPurged` inverted and
  `confirmedAt`, `completedAt` or `appliedCount` wrong; the row's `matchSupplierId` or `appliedSupplierId` dropped.
- **Handlers and schemas (6):** cancel getting no root; list dropping the query; cancel not idempotent; the page size
  1,000; the job schema open; an execution error without `field` rejected by the row schema.

Four first survived and each got a test: the status filter and the list offset (the test user's two jobs were both
cancelled and only page 1 was read), `appliedCount` (the unit fixture had equal applied and valid counts), and the
field-less execution error (that mutant was first run against the unit files only; it dies on the integration test that
serves a failed row).

## REV-069 remediation (HD-059)

REV-069 (`72_rev_069_independent_review.md`) requested changes on f43196f; the Product Owner chose every recommendation (HD-059).

- **M-1, fixed.** The cancel's `UPDATE` now carries the status it read under the lock (`WHERE id = ? AND status = ?`) and
  answers 409 `SUPPLIER_IMPORT_NOT_CANCELLABLE` unless exactly one row changed. A regression test holds the job in another
  transaction, moves it uploaded→validating and queued→running, and requires the cancel to wait and then refuse, with the
  source kept. The lock and the guard are each enough on their own for safety: removing either alone passes every test
  (mutants #42 and #43). #42 is equivalent for safety only — in the stale-snapshot window it can change which 409 code comes
  back (`SUPPLIER_IMPORT_NOT_CANCELLABLE` instead of `VERSION_CONFLICT` for ready→queued, REV-070 I-1). Removing the lock and
  the guard (#40), or the lock and the `affectedRows` check (#41), is killed.
- **L-1, fixed.** Cancel first reads ownership without a lock and answers 404 for a foreign or missing job before it takes
  `FOR UPDATE`, so a stranger neither waits on nor locks someone else's job. The locking read is by ID only, since ownership
  is only ever cleared (the uploader's user deleted), never reassigned. A test cancels a foreign job while it is locked and requires 404 in under a second (#44 killed).
- **L-2, accepted (HD-059 3A).** HD-058 1A is a guarantee of the job API only. The Supplier audit API shows the import
  lifecycle (uploader username, IP, status changes, precheck counts — never CSV content, stored names or paths) to its
  readers on purpose, like every other Supplier action. The IMP-015 test title now says "the job API tells no one else".
- **L-3, fixed.** A test whose transaction fails after the cancel's work requires the job to stay `uploaded` and its source
  to remain (#45 killed).
- **I-1.** The client comment now says each call sends a new key, so a second press gets 409 rather than a second cancel.
- **I-2 to I-4** recorded, no change.

The mutation list is now 45: the 39 above with three patterns updated for the new code, plus the six REV-069 mutants.
43 killed; #42 and #43 survive as described.

REV-070 (`73_rev_070_independent_review.md`) approved a2d577e with Info findings only. I-1 to I-3 were wording, corrected
above and in the service comment; I-4 (an indeterminate commit leaves the source without a cleanup log) is covered by HD-044's
retry obligation for T48.

## Status after TASK-045

T45 adds `POST /api/v1/supplier-imports/:id/confirm` (`jwt-password`, route idempotency) and the real row writer
(`modules/supplier/import/applySupplierImportRow.js`), wired into `SupplierImportWorkerService` by default. The open points
were decided in HD-060 (1A 2A 3A 4A 5A).

| Obligation | Status |
| --- | --- |
| HD-048 (1): wire the real `applyRow` | **Done.** `createSupplierImportApplier` is the worker's default; a unit test pins it. |
| HD-048 (2), REV-061 M-3: connection-taking helpers, never the public methods | **Done (HD-060 2A).** `SupplierAdminService.createSupplierInTransaction` / `updateSupplierInTransaction` and `createInTransaction` on the Address, Contact and Identifier services. The public methods now call the same helpers inside their own transaction (505 Supplier tests unchanged and green). A mutant that hands `applyRow` the pool instead of the row's connection is killed by the SIGKILL-before-commit test. |
| HD-048 (3): a row, job lock included, inside `DB_TRANSACTION_TIMEOUT_MS` | **Measured.** 300 rows with address, contact and identifier: about 6 ms a row, slowest 11 ms, against 20,000 ms. Pinned loosely (< 2 s). |
| HD-048 (4): real `applyRow`, failure after the Supplier write | **Done.** No Supplier, contact, identifier, name gram or audit row survives. |
| REV-061 I-4: domain errors carry a Chinese `publicMessage` | **Holds.** Every refusal the helpers raise is a Supplier domain error with a Chinese message; generic failures still store the fixed pair. |
| REV-061 I-3: retry transient errors? | **Decided, HD-060 4A.** Deadlock, lock-wait, transaction or query timeout fail the row as `SUPPLIER_IMPORT_ROW_BUSY` (driver or wrapped cause); the user re-imports the row. |
| Re-check the confirmer before each row | **Done (HD-060 5A).** Inactive, or without `supplier.mgmt`: pending rows fail with `SUPPLIER_IMPORT_AUTHORIZATION_REVOKED`, applied rows stay, the job fails with counts rebuilt from rows. This also covers a confirmer whose user was deleted (`confirmed_by` NULL). |
| Re-check at execution everything precheck checked | **Done.** Code taken since, Identifier taken since, target archived, expected version moved, currency retired: each fails its row with its domain code; other rows apply. |
| Currency change needs a reason | **Done.** `CSV 匯入 #<job>`, visible in the `supplier.update` audit. |
| Address and Contact through the same services | **Done.** The stored payload is re-normalised by the same `normalizeAddress` / `normalizeContact` inside the helpers. |
| REV-064 I-4: update of a `pending_approval` Supplier | **Done.** A significant change invalidates the request and returns the Supplier to draft; any other change keeps the request and syncs its version. |
| T45: who confirms (T44 carry-forward) | **Decided, HD-060 1A.** Only the uploader; others 404 like cancel. |
| REV-063 I-23: state left on the pooled connection by a `SELECT` | **Holds.** The helpers use no named locks, user variables or stored functions. |
| HD-043, T45 part: stored names and `nlink` when serving | **Not applicable.** T45 serves no file; the rule stays with T46's download endpoint. |

Behaviour worth knowing:

- **Activation** follows the snapshot taken at confirm (AC-013): a job confirmed with approval on opens requests even if
  approval is switched off before it runs, and the other way round. Only create rows are activated; update rows never change
  the status (design §6.9).
- **The approval request** of an imported Supplier is opened after its children are written, so its snapshot already lists
  the identifier. An approver who lost eligibility after confirm fails every activating create row (HD-060 3A, BR-012).
- **Audit order** for an imported create row is the children's audits, `approval.submit`, then `supplier.create`: the public
  create path already records `supplier.create` last, and the helper keeps that order.

New obligations T45 creates:

| Task | Obligation |
| --- | --- |
| T46 | The confirm step must send the password and, for activate with approval on, an approver chosen from the eligible list; refresh must not resend confirm (the client creates a new key per call, so a second press answers 409). |
| T46 | Show `SUPPLIER_IMPORT_ROW_BUSY` rows as retryable and `SUPPLIER_IMPORT_AUTHORIZATION_REVOKED` as a job-level stop. |
| T49 | Execution throughput at 10,000 rows is not measured here (about 6 ms a row in the 300-row test). |

## Mutation record for TASK-045

33 mutants against the T45 code, all killed (unit files and both import integration files on real MySQL, serial, each
mutant applied to a committed tree and restored from the saved bytes):

- **Confirm (9):** reaching another user's job; any state; ignoring the version; never requiring approval; skipping the
  approver's eligibility; accepting an approver when none is needed; not snapshotting the policy value or version; not
  auditing.
- **Execution (9):** no confirmer re-check; its permission or active check dropped; revocation leaving pending rows or losing
  the applied count; `SUPPLIER_IMPORT_ROW_BUSY` never set, ignoring wrapped causes, or missing deadlock; `applyRow` writing
  on a second connection.
- **Row writer (11):** activation mode ignored; live policy instead of the snapshot; approver dropped; address, contact or
  identifier skipped; children written after the approval request; the request summary without identifiers; blank update
  cells cleared; the current instead of the expected version; no currency-change reason.
- **Helpers, worker, route (4):** the identifier unique error not mapped inside the row; no default writer; confirm without
  the password; confirm not idempotent.

Two first survived: a deactivated confirmer (only a lost permission was tested; a test now deactivates the account) and the
default-writer mutant, which was itself wrong (`null ?? x` is `x`) and was rewritten.

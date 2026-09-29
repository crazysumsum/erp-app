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
| T45 | `applyRow` must call **connection-taking** domain helpers extracted from `SupplierAdminService` and the other write services. Their public methods each open `database.withTransaction` on a second pooled connection, which commits the Supplier before the marker — the two-phase path design §8.8 forbids (REV-061 M-3, verified E4b). The connection handed to `applyRow` already refuses `COMMIT`, `ROLLBACK`, `START TRANSACTION`, `SAVEPOINT`, `SET SESSION`, DDL and `LOCK`; it cannot see a second connection |
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

After REV-061, 40 mutants, all killed: the 19 above, REV-061's eleven survivors (no `SKIP LOCKED`; no lease check on the
failure path; no renewal after an applied row; no renewal after a failed row; kind-directory `dev`, owner, and `chmod`
checks; root `chmod`; the `dev`/`ino` same-directory check; the rows trigger check) and ten for the remediation (a
generic code passed through to the row; no failure log; `applyRow` given the raw connection; a leaseless running job
left stuck; an unconfirmed job claimed; the root's parent unchecked; `auto_increment`, extra UNIQUE, charset and CHECK
contracts on jobs; an extra CHECK on rows). The pending guard on the failure path (REV-061 M4) is left as REV-061 found
it: the rollback returns the row to pending before that UPDATE runs, and the CHECK backstops the applied case.

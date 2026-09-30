# REV-064: TASK-043 CSV template, upload and background precheck (PR #167), independent review

Reviewer: an independent agent (REV-064, security-auditor persona). I did not write this code, and I did not write any earlier review of it.

- **Merge candidate:** 8b3ada89292536496562e682781cce514fdf31eb on `claude/supplier-task-043`. `gh pr view 167` reports it as the head, `MERGEABLE`.
- **Base:** origin/main 0f20c00. I checked with `git ls-remote`, and main has not moved.
- **Scope:** the whole diff 0f20c00..8b3ada8 (22 files). That covers code, tests, the carry-forward doc, DEF-023 and ledger revision 257.
- **Where I worked:**
  - A detached worktree at `/private/tmp/erp-rev-064`, with `node_modules` symlinked from t43. The t43 worktree has no `server/` or `client/` node_modules of its own.
  - A private schema, `rev064`, on the throwaway MySQL at 127.0.0.1:3443 (26.7.0). I migrated it as admin and did not touch `erp_dev`.
  - Scratch files are under `/private/tmp/r64`: the mutation script `mut64.py` and its log, the probes under `probe/`, and the test logs.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The text below is the reviewer's, unchanged apart from this note.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 1 |
| Low | 3 |
| Info | 7 |

Disposition: **CHANGES REQUIRED.**

- **H-1** lets a cell value, a Bank value included, reach the system log. It also leaves the job retrying forever. One stray `"` in an unquoted cell is enough.
- **H-2** means a file of the designed maximum size never finishes precheck once the Supplier table has about 2,000 rows. The job retries from row 1 forever and puts a heavy query load on the database the whole time.
- Both come from the same gap. The precheck has no terminal state for an error it did not anticipate, and no bound on attempts.
- **M-1** can be fixed in this PR or decided and carried forward. The Lows and Infos can be carried.

**What held.**

- The file handling is sound. Stored names are made by the server, the file is written `O_EXCL|O_NOFOLLOW` and `0600`, and it is read with `O_NOFOLLOW`, `nlink === 1` and a SHA-256 check. Everything runs under the prepared real root.
- The request log never captures a multipart body, 5xx included.
- Precheck writes nothing to Supplier tables.
- Upsert matching and the child-column rule follow §6.9.
- The author's 58 mutants were all killed on my tree, run serially.

### What I ran

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm test --workspace server --` the six unit files named in the brief | 53/53 pass |
| `node --test --test-concurrency=1` on both import integration files, against `rev064` | 21/21 pass |
| Each integration file alone | 8/8 and 13/13 |
| All eight files in one default (parallel) `npm test` run, as the brief lists them | 70/74. The 4 failures are cross-file interference between the two integration files; see L-3. CI uses `--test-concurrency=1` and is green, apart from the known Dependency audit failure. |
| The author's `mut43.py`, pointed at my tree with `DB_NAME=rev064` and made serial, plus an identity "baseline" mutant and 18 mutants of my own | Baseline passes. All 58 of the author's mutants are killed. 7 of my 18 are killed and 11 survive (§3). |
| The author's harness as written: parallel, run twice with no mutant | Run 1 **fails** (`ER_LOCK_DEADLOCK` in `createFromUpload` INSERT). Run 2 passes (L-3). |
| Probes on real MySQL, real files, the real scheduler and real log files | See each finding |

## 1. Findings

### H-1 (High): a stray quote in a cell throws a csv-parse error that the precheck does not catch; its message, cell text included, goes to the system log, and the job loops forever

**Location:**

- `server/src/modules/supplier/import/SupplierImportProcessor.js:354`
- `server/src/services/supplierImport/SupplierImportWorkerService.js:109-113`
- The error reaches `server/src/services/scheduler/SchedulerService.js:436-445`.

**Mechanism.**

- The processor maps parse errors to `SUPPLIER_IMPORT_CSV_MALFORMED` only when `error.code` starts with `CSV_`. The installed csv-parse throws one error whose code has no such prefix: `INVALID_OPENING_QUOTE`. I checked this by grepping `node_modules/csv-parse/lib` for every error code.
- That error is raised when a quote appears inside an unquoted field (`12" monitor`, `iban X "HSBC"`), or after a space before an opening quote (`x, "y"`). Both are common in hand-edited CSVs.
- Its message embeds the field text read so far: `value is "…"`.
- The error is rethrown to the worker. `SOURCE_ERRORS` does not know the code, so the worker logs only name and code, then rethrows the original error.
- The scheduler then logs `error.message` in `scheduler.job.failed` and keeps it in `stats.lastError`. `JobStatsFlushJob` persists `stats.lastError` to `fr_job_stats.last_error`.

**Verified.**

- **Unit probe** (`/private/tmp/r64/probe/quote.mjs`, `quote2.mjs`). `precheckSupplierCsv` does not return a `jobLevelError`. It throws:

  ```text
  INVALID_OPENING_QUOTE | Invalid Opening Quote: a quote is found on field 9 at line 2, value is "acct 123-456-789 "
  ```

  The same happens for a header `acct"GB29…"` (field 1, line 1) and for a data cell `x, "y"`.
- **End to end with the real scheduler.** I booted the application against `rev064` with the precheck job enabled and interval 1 s. I uploaded through `createFromUpload` a v1 file whose `notes` cell is `iban <IBAN> "x"`. The system log file then contained:

  ```text
  {"event":"scheduler.job.failed",…,"error":{"name":"Error","message":"Invalid Opening Quote: a quote is found on field 9 at line 2, value is \"iban <IBAN> \""}}
  ```

  (The IBAN test value is replaced by `<IBAN>` in this copy.)
- **The loop.** The job stayed `validating`, with no `last_error_code`. I expired the lease with `UPDATE … lease_until = 1`. The next run reclaimed it (version 2→3), failed the same way, and wrote the same log line a second time. Nothing ever moves the job to `failed`, so this repeats every 180 s forever.
- **Not observed.** I did not catch the value in `fr_job_stats`: the next idle run resets `lastError` to null within one interval. Persistence there is a race, not something I saw.
- **Untested.** No existing test covers this case. The CSV tests use only an unterminated quote (`CSV_QUOTE_NOT_CLOSED`) and a short row. IMP-003 lists "malformed quote" as a required case.

**Impact.**

- AC-034, IMP-014, BR-028 and design §12.3 (which bans account numbers, IBANs and CSV row payload from logs) are broken for any Bank value that sits in a cell before a stray quote, in any column, notes included. The system log is kept 30 days.
- The job never reaches a terminal state, so the user never gets an answer. It also re-logs the value every lease period.
- The DEF-023 reassessment in this PR is wrong as written. It says (1) "nothing on this path" widens the request-log risk, and (2) the integration test "finds an IBAN … in no … log". The second is true only for the `IBAN`-header case. The system log is a channel the reassessment did not cover.

**Recommended fix.**

1. **Map every parser failure.** In the processor, map any error thrown while iterating the csv-parse stream to `SUPPLIER_IMPORT_CSV_MALFORMED`: check `error instanceof CsvError` from `csv-parse`, or catch everything the parser loop throws apart from the `onRows` or DB errors you rethrow on purpose. Never propagate the parser's message.
2. **Never rethrow a message built from user input.** In `runPrecheck`, rethrow a fresh error that carries only the code, for example `throw Object.assign(new Error("Supplier import precheck interrupted"), { code })`. The scheduler would then log nothing derived from the file, whatever the processor does in future.
3. **Bound the attempts.** Add an attempt counter, or reuse `version` against the claim count. After N takeovers the job becomes `failed`, with `SUPPLIER_IMPORT_PRECHECK_FAILED`. This also bounds H-2.
4. **Test it.** Add a test with `a,b"c` in the header and in a data cell. The job should become `failed` with `SUPPLIER_IMPORT_CSV_MALFORMED`, and a log scan through the scheduler path should find nothing.
5. **Correct the DEF-023 text.**

### H-2 (High): with about 2,000 existing Suppliers, a 10,000-row file never finishes precheck; the job restarts from row 1 forever and runs heavy queries the whole time

**Location:**

- `SupplierImportProcessor.js:282`: the similar-name lookup, one `SupplierDuplicateCandidates.find` per error-free row.
- `SupplierImportWorkerService.js:42`: the job timeout, `PRECHECK_LEASE_MS - 30_000` = 150 s for the whole run.
- `SupplierImportService.js:215`: `claimForPrecheck` deletes partial rows on takeover.

**Mechanism.**

- For each row, `find` runs an exact-name query plus a `supplier_name_grams … WHERE gram_hash IN (…) GROUP BY s.id` over every Supplier that shares a bigram with the name. Common words like "Limited", "Trading" and "Company" make that most of the table. The cost per row therefore grows linearly with the number of Suppliers.
- The scheduler aborts `runPrecheck` after 150 s. The processor sees the abort at the next batch boundary and throws.
- The job keeps its lease for 180 s. It is then reclaimed, and `claimForPrecheck` deletes the rows written so far, so the next attempt starts from row 1 and hits the same wall.
- Precheck has no resume point and no attempt bound.

**Verified with real MySQL** (`/private/tmp/r64/probe/rev064Perf.integration.test.js`). I seeded Suppliers named `Supplier <i> Trading Company Limited`, with their real name grams from `hashNameBigrams`, then called `precheckSupplierCsv` against the real database service on 500 new rows:

| Existing Suppliers | 500 rows took | Per row | Projected 10,000 rows |
| --- | --- | --- | --- |
| 2,000 | 15.6 s | 31 ms | 312 s |
| 20,000 | 153 s | 306 ms | 3,060 s |

At 20,000 Suppliers, a single 500-row batch takes longer than the 150 s job timeout.

**End to end with the real scheduler and default timings.** I used 2,000 Suppliers and one 10,000-row upload, sampled every 15 s:

- **0 to 165 s:** rows 0 → 5,000 are written.
- **About 150 s:** the scheduler logs `scheduler.job.failed … "Job \"supplier.import.precheck\" exceeded 150000ms"`, and the worker logs `supplier.import.precheck_interrupted`.
- **165 to 330 s:** the job sits at `validating` with 5,000 rows while the lease runs down.
- **345 s:** the job is reclaimed (version 2→3) with 0 rows, and it climbs again (2,500 rows at 420 s).

Nothing in the code ends this cycle.

**Impact.**

- IMP-003 names 10,000 rows as the accepted boundary, but a file that size never gets a result once the Supplier base is modest.
- An upload from any `supplier.mgmt` user, or an ordinary large file, keeps one instance's precheck busy and the database loaded indefinitely. At 20,000 Suppliers that is about 1,000 GROUP BY queries per 150 s window.
- Nothing tells the user or operator that the job is stuck, apart from recurring error logs.

**Recommended fix.** Any of these closes the loop. The first two are small.

- **Make precheck resumable.** Do not delete rows on takeover. Resume after `MAX(row_number)`, because rows are appended per batch in the lease-checked transaction. Alternatively, check the abort before each row rather than per batch, so progress is never lost.
- **Bound attempts** (H-1 fix 3), so the job ends as `failed` with a clear code.
- **Cut the per-row cost:**
  - Exact name-key matches can be batched into one `IN` query per batch.
  - Run the gram query only for rows that pass, and cap it with `LIMIT` inside a derived table.
  - Or treat similar names as a batch-level lookup.
  - Or drop fuzzy similarity from precheck and keep it for T45 or the UI. The design only requires a warning.
- **Add an acceptance test** at 10,000 rows against a seeded Supplier table of realistic size, asserting the job reaches `ready` or `ready_with_errors` within the lease.

### M-1 (Medium): a file rejected for a Bank column stays on disk in plaintext for 365 days

**Location:** `SupplierImportService.completePrecheck` (`SupplierImportService.js:254`), and `writeSupplierImportSource` called from `createFromUpload` (`:165`).

**Mechanism.**

- Upload stores the whole file before any header check.
- When precheck fails the file with `SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN`, it sets `completed_at` but does not remove the source file or set `files_purged_at`.
- Under design §12.5 the file is purged 365 days after completion, and only once T48 exists.

**Verified.** I uploaded a v1 file with an extra `IBAN` column and ran `runPrecheck` against real MySQL and a real root. The result was:

```text
{"status":"failed","code":"SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN","completedAt":true,"filesPurgedAt":null,"fileExists":true,"fileHoldsIban":true,"retentionDays":365}
```

**Impact.**

- IMP-014's pass condition lists "DB/files/log/audit scans". The file store is a channel the Bank value does reach. The integration test scans only rows, jobs, audit and logs.
- Everywhere else, Bank data at rest is encrypted with managed keys. Here a plaintext IBAN sits in a `0600` file for a year, and it also goes into any filesystem backup.
- HD-050's approved defaults cover "no rows written", not the retained source.

**Recommended fix.**

- **Preferred:** delete the source file, and set `files_purged_at`, in the same completion path whenever the job-level error is the Bank-column one. Better still, check the header row synchronously at upload with csv-parse, reading the first record only, and refuse with 400 before anything is written.
- **Otherwise:** record it as a decision for the Product Owner, then pin the chosen behaviour with a test that scans the root.

### L-1 (Low): if cleanup after a failed upload cannot delete the file, the file stays with no log and no job

**Location:** `SupplierImportService.js:186`, where `removeSupplierImportFile(...).catch(() => {})`.

**Verified** (`/private/tmp/r64/probe/unlink.mjs`). I used the real `SupplierImportService` and the real file helpers. An injected `authorize` makes `source/` read-only, then refuses the actor. The upload was rejected, one file was left in `source/`, and the logger received **0** calls.

**Impact.**

- An orphan that may contain PII or Bank data is left with no trace. Design §12.5 says a failed delete "記error並下次retry" (logs an error and retries on the next run).
- T48's purge of unreferenced files (HD-044) will eventually collect it, but nothing tells an operator it exists.

**Fix:** log `supplier.import.source_cleanup_failed` with the stored name and error code, never the content, and keep rethrowing the original error.

### L-2 (Low): eleven guards survive mutation; four protect a terminal state or the lease

My mutants, with the test files each guard would need:

| # | Mutant | Status | What is unguarded |
| --- | --- | --- | --- |
| 60 | `readSupplierImportSource` drops `!info.isFile()` | survives | A directory at the stored name reaches `readFile`, gets `EISDIR`, and is rethrown. That is the H-1 loop again. |
| 61 | Read-side `info.size > maxBytes` removed | survives | No test has a stored file larger than the current limit. |
| 71 | `SUPPLIER_IMPORT_FILE_TOO_LARGE` removed from `SOURCE_ERRORS` | survives | Same gap: an oversize source would loop instead of failing the job. |
| 64 | `appendPrecheckRows` no longer extends `lease_until` | survives | A precheck longer than one lease would lose the job to a second worker mid-run. |
| 72 | `signal.throwIfAborted()` between batches removed | survives | Abort handling is untested. |
| 65 | `completePrecheck` accepts rows in unexpected statuses | survives | Defensive check, untested. |
| 70 | `#catalog()` reads only the first page | survives | No test has more than 100 active currencies or payment terms. ISO 4217 has about 180, so over 100 active is realistic. |
| 62, 63 | Write without `O_NOFOLLOW` / without `O_EXCL` | survive | Equivalent in practice: the name is 256 random bits. |
| 66 | `max_record_size` removed | survives | Bounded anyway by the 10 MB limit. |
| 75 | `ciphertext` removed from the Bank regex | survives | Still rejected, as `HEADER_UNKNOWN`. |

**Fix:** add tests for 60, 61/71, 64, 72 and 70. The current code is correct on each; only the tests are missing.

### L-3 (Low): the author's mutation harness runs both integration files in parallel, and its baseline fails 1 run in 2, so a "KILLED" verdict there could be spurious

**Location:** `mut43.py`, where `cmd` runs `node --test` without `--test-concurrency`, on `UNIT + INT`.

**Verified.**

- **Unmutated, author's command.** I ran the author's exact command twice with no mutant, against `rev064`. Run 1 failed with `ER_LOCK_DEADLOCK` on the `INSERT INTO supplier_import_jobs` in `createFromUpload`. Run 2 passed.
- **Unmutated, brief's command.** The brief's combined `npm test` of all eight files failed 4 tests:
  - `supplierImport.integration` claims jobs made by `supplierImportExecution.integration` ("unexpected job 5 was waiting").
  - Each file's `before()` also rewrites the other file's `uploaded` and `validating` jobs.
  - There is a 20 s lock timeout against the execution file's migration test.
- **Serial.** With `--test-concurrency=1`, the baseline passes and all 58 mutants are killed. So the claim in the doc **does hold**; the method as recorded could not have shown it.

**Fix:**

- Make the harness serial, and have it run an unmutated baseline first. A harness whose baseline can fail cannot tell a kill from noise.
- Either give each integration file its own job-state isolation, or state in the T43 Verification that the two files run serially, as CI does.

### Info

- **I-1:** the mutation record's bucket counts are mislabelled.
  - "Service (15)" lists 14 mutants and "Handler, template, request log (4)" lists 5.
  - The total of 58 is right, and matches `mut43.py`.
- **I-2:** the error codes in the design and the code differ.
  - Design §6.11 names `CURRENCY_INVALID`/`CURRENCY_INACTIVE` and `PAYMENT_TERM_INVALID`/`PAYMENT_TERM_INACTIVE`.
  - The precheck uses `CURRENCY_NOT_ACTIVE` and `PAYMENT_TERM_NOT_ACTIVE`, which are the codes `BusinessMasterProvider` actually throws. So BR-026 parity with the API holds; the design table is stale.
- **I-3:** uploads are accepted even when no precheck will run.
  - If the root is configured but the scheduler, or the precheck job, is disabled, uploads are still accepted and jobs stay `uploaded` forever.
  - HD-050 made the upload depend on the root only. Consider answering 503 when the precheck job is not scheduled.
- **I-4:** the T45 obligations list does not mention pending approvals.
  - `updateSupplier` invalidates a pending approval when an approval-significant field changes, and an import update row can target a `pending_approval` Supplier.
  - HD-048 (2), "connection-taking domain helpers", covers this implicitly. It is worth naming next to the currency-reason obligation.
- **I-5:** `readSupplierImportSource` opens without `O_NONBLOCK` and checks `isFile()` only after `open`.
  - A FIFO planted at a stored name would block a libuv thread indefinitely.
  - Planting one needs write access to the root, so this is outside the threat model. `O_NONBLOCK` on the read open would close it at no cost.
- **I-6:** the route size limit and the service limit come from different config sources.
  - The route limit is read from `config/supplier.js` at module load, which is documented in the T43 notes.
  - A limit overridden through the configuration source, as tests do, changes the service's 413 but not multer's.
- **I-7:** there is no per-user quota or upload rate limit.
  - Any `supplier.mgmt` holder can store 10 MB files without bound, retained 365 days.
  - The general request limiter applies, and the users are trusted, so this is noted, not a finding.

## 2. Status of the brief's focus items

| Focus item | Result |
| --- | --- |
| 1. File safety | **Holds**, except M-1 and L-1. The orphan window (write, then insert) is real. The T48 obligation in HD-044 to purge unreferenced files older than a day is adequate, provided L-1 is logged so an operator can see it. |
| 2. Bank data | Header detection plus rejection of every unknown header means **a Bank column can never enter a row**. Error messages give the column by position only, and row errors are fixed strings. **Broken by H-1** (system log) and **M-1** (file store). |
| 3. DEF-023 | **Confirmed for the request log.** `isFileUpload` runs before `shouldCaptureBody`, so a 5xx cannot capture a multipart body; the test and the "5xx upload body captured" mutant both show it. `upload.accepted` logs sizes and MIME only. **Other path logging request content:** yes, the scheduler (H-1). |
| 4. Zero writes and parity | **Holds.** The processor has no write SQL. The duplicate finder only reads. The integration test compares 9 Supplier tables plus business audit before and after. Normalizers are the API's own, and Code, Identifier and archived checks match the API (I-2). Upsert: ID first with a Code cross-check, Code-only match, unknown ID, archived, child columns → `IMPORT_CHILD_UPDATE_UNSUPPORTED`, and blank = no change are all present and tested. |
| 5. Leases | **Holds.** `SKIP LOCKED`, lease-expiry takeover, deletion of partial rows, stale-owner append and complete, and `validating→validating` used only by the claim are all tested, and the mutants are killed. Gaps: renewal is untested (L-2 #64), and takeover plus deletion is what turns H-2 into a loop. |
| 6. Robustness | Memory is bounded: 10 MB buffer, UTF-16 string, `max_record_size` 64 KiB, 1,000-row insert cap, 500-row batches (about 5 MB per insert, well under `max_allowed_packet`). **Per-row DB cost is H-2.** |
| 7. Idempotency and auth | **Holds.** The fingerprint includes the multer `contentHash`; the same key with another file is refused (HTTP test). `supplier.mgmt` policy and `assertActorFresh` are both in the transaction. The upload answers 503 when the worker service or root is absent (unit test and mutants). |
| 8. HD-042, HD-047, HD-049 | **Holds.** Only csv-parse and csv-stringify are used, with no `split`. The job name comes from `SUPPLIER_IMPORT_JOB_NAMES.precheck`. Stored names come only from the helpers. The HD-049 check in `finalizeExecution` has a test and log, and the T42 fixtures now set `total_count` without weakening any assertion. |
| 9. Test quality | The IMP-014 log scan **does discriminate**: my negative control, a worker line that logs the decoded source, turned TC-099 red. It covers only the direct `runPrecheck` path, not the scheduler's error log. For mutation, see §3 and L-2/L-3. |
| 10. Docs and ledger r257 | The HD-050 record matches the implementation. HD-044 and HD-047 are reworded accurately. The DEF-023 paragraph and the carry-forward "(3) row errors never carry a cell value … (4) finds none" need correcting for H-1. HD-042, HD-047 and HD-049 are still `OPEN` in the ledger, consistent with closing them at merge. |

## 3. Mutants

- **Author's set (58), serial, on 8b3ada8:** 58 killed. The identity baseline passes.
- **Mine (18):**
  - Killed (7):
    - cell length off by one
    - Supplier Code put in the update payload
    - create without a null payment term
    - Bank regex without `accountnumber`
    - Bank regex without `iban`
    - the upload `catch` removed
    - the finalize mismatch disabled
  - Survived (11): see L-2.
- **Negative control:** a worker log line that writes the decoded source made TC-099 fail ("the system and request logs never contain it").

## 4. What held

- **Stored files.** Names come from `newSupplierImportStoredName()` (64 hex) and `supplierImportFilePath()`. The integration test asserts mode `0600` and the path inside `<preparedRoot>/source`. A symlink, hard link, altered file or missing file fails the job with `SUPPLIER_IMPORT_SOURCE_UNAVAILABLE`.
- **Upload failures.** A refused actor leaves neither a job nor a file.
- **The response** carries no stored name, hash, lease or path.
- **The template** is csv-stringify, BOM plus CRLF, with bare CR or LF cells quoted. It carries the Bank notice. The template round-trips as an empty file, and with one row added it yields exactly that row.
- **Bounded row issues.** There are at most 20 issues per row, and messages are fixed strings or template column names.
- **Audit.** `import.upload` and `import.precheck` audit rows carry no file content. The precheck row is attributed to the uploader.
- **Upload buffer.** The handler zeroes the upload buffer in `finally`.
- **Precheck completion.** Counts are rebuilt from rows, and a job-level failure deletes partial rows in the same lease-checked transaction.

## 5. What I could not verify

- **`fr_job_stats`.** I did not observe the H-1 message in `fr_job_stats.last_error`. The next successful run clears `lastError` within one interval, so persistence depends on the flush timing.
- **H-2 on production data.** The timing uses synthetic names that share common words. Real names will differ, but the per-row cost is still linear in the number of matching Suppliers.

## Restoration

- The mutation script restored every file from saved bytes; `git status` was clean before removal.
- My probe test files were deleted from the worktree. Copies of the perf probe and unit probes are in `/private/tmp/r64/probe`.
- The temporary log and root directories under `os.tmpdir()` (`r64-*`, `r64l-*`, `r64r-*`, `r64u-*`) were deleted. Some held the IBAN test value.
- Schema `rev064` was dropped, and the grant I gave `erp_user` on it was revoked. The worktree `/private/tmp/erp-rev-064` was removed.

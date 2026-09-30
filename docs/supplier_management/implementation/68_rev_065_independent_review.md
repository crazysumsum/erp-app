# REV-065: TASK-043 remediation after REV-064 (PR #167), independent review

Reviewer: REV-065, an independent agent using the security-auditor persona. I did not write this code. I did not write REV-064 or any earlier review.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The text below is the reviewer's, unchanged apart from this note.

- **Merge candidate:** 6b5437cde5aa4fe455e05b1b6d1e5e6ec36228ab on `claude/supplier-task-043`. `gh pr view 167` shows it as the head, OPEN and MERGEABLE. `git ls-remote` shows the same head.
- **Base:** origin/main bea7b5f4c61b3993405d892b36a90ac0aa9e6bce. Main had not moved when I checked.
- **Commits reviewed:** 7382b8c, 3661284, 7826846, 671c64f, and the merge 6b5437c. I also re-checked the whole PR against bea7b5f wherever the remediation touches it.
- **Where I worked:**
  - A detached worktree at `/private/tmp/erp-rev-065`, with `node_modules` symlinked to t43's.
  - A private schema `rev065` on 127.0.0.1:3443, migrated as admin with `scripts/migrate.js`. I never touched `erp_dev`.
  - Scratch files and probes under `/private/tmp/r65`. A probe test file sat in the worktree only while the probes ran, then I moved it out.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Info | 5 |

**Disposition: APPROVED WITH CONDITIONS.** Both Highs from REV-064 are closed in the code:
- H-1: no message built from file content, a SQL value or a cell reaches the scheduler, the system log, `fr_job_stats`, the job row, audit or the response.
- H-2: precheck does a constant number of indexed batch queries. 10,000 rows against 20,000 Suppliers took 314 ms.

Two conditions:
- **M-1 (new) must be fixed before merge.** HD-053 (A) says a Bank-column file is refused "before anything is stored". A leading blank line gets such a file past the upload check, and its IBAN is written to disk in plaintext. The fix is one parser option plus a test.
- **L-1 to L-3 may be fixed or carried in the ledger.** L-1 matters most. The acceptance test the docs say "pins" H-2 does not catch H-2 coming back.

Separately, CI cannot be green today, and T43 is not the cause (see I-5).

### What I ran

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| Six unit files (`supplierCsvSchema`, `supplierImportPrecheck`, `supplierImportService`, `supplierImportUploadHandlers`, `supplierImportWorkerService`, `requestLogger`) | 60/60 pass |
| Both import integration files, `--test-concurrency=1`, against `rev065` | 25/25 pass |
| Full server suite, `node --test --test-concurrency=1`, Bank keys set, `rev065` | 2,378 pass, 0 fail, 9 skipped (out of 2,387). I ran it twice. The first run partly overlapped my mutant runs, so I reran it with nothing else running; both runs gave the same result. |
| Author's `mut43.py`, pointed at my tree with `DB_NAME=rev065`, serial, baseline first | Baseline PASS. **72 of 74 killed.** The survivors are #63 (`isFile()` removed from the read) and #64 (read-side size check removed). This matches the doc. |
| 11 mutants of my own (§3) | 8 killed, 3 survived |
| Probes P1 to P5 on real MySQL and the real filesystem, using the integration harness | See the findings |
| `gh pr checks 167` | Only Dependency audit fails. It also fails on main bea7b5f (I-5). |

## 1. Findings

### M-1 (Medium): a Bank-column file with a leading blank line gets past the upload check and is stored in plaintext; HD-053 (A)'s "before anything is stored" does not hold

**Location:**
- `server/src/modules/supplier/import/SupplierImportProcessor.js:78`. `uploadHeaderError` parses with `{ bom: true, to: 1, max_record_size: 65_536 }`.
- `SupplierImportProcessor.js:347`. Precheck parses with `{ bom: true, skip_empty_lines: true, max_record_size: 65_536 }`.
- `server/src/modules/supplier/SupplierImportService.js:170-171`. Upload calls the header check.

**Mechanism (verified).** The two parsers read a different first record:
- The upload check has no `skip_empty_lines`. For a file that starts with `\r\n`, `\n` or BOM+`\r\n`, it reads an empty record as the header, finds no Bank column and returns null.
- Upload then writes the file.
- Precheck skips the empty line, reads the real header and fails the job with `SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN`.

Unit probe results (upload check vs precheck on the same bytes):

| File starts with | Upload check | Precheck |
| --- | --- | --- |
| Plain header | refused | refused |
| BOM, then header | refused | refused |
| Quoted or multi-line `"Bank\r\nAccount"` header | refused | refused |
| ` IBAN ` with spaces | refused | refused |
| Full-width `ＩＢＡＮ` | refused | refused |
| CR-only line ends | refused | refused |
| **Leading CRLF, leading LF, BOM then CRLF** | **accepted and stored** | `BANK_COLUMN_FORBIDDEN` |
| Whitespace-only first line, stray quote in the header, Latin-1 byte | accepted and stored (by design, per the code comment) | `CSV_MALFORMED` or `CSV_NOT_UTF8` |

End to end on real MySQL and a real root (probe P1), with `"\r\n"` followed by a template-plus-`IBAN` CSV:
- `createFromUpload` returned `status=uploaded`, which is a 201 over HTTP.
- The stored source file contained the test IBAN.
- `runPrecheck` then produced `failed` / `SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN`, set `files_purged_at`, and deleted the file.

**Impact:**
- An IBAN sits in plaintext (mode 0600) under the import root until the next precheck. Normally that is a few seconds.
- It stays much longer in two cases. REV-064 I-3, now carried to T44: with a root configured but the precheck job disabled, the job stays `uploaded` and `files_purged_at` stays NULL, so the file is kept until T48's retention. Or the unlink fails (logged; T48 collects it).
- Several statements are now wrong for this input:
  - the DEF-023 correction (`04_defect_register.md:13`, "Since HD-053 a Bank column is refused at upload, so the file is never stored");
  - the carry-forward M-1 row;
  - the title of the IMP-014 test.
- Exploiting it needs a `supplier.mgmt` user, and the impact is bounded, hence Medium. It still breaks a control the Product Owner chose explicitly in HD-053.

**Recommended fix:**
1. Put one parser-options constant in the processor and use it in both places. At minimum, add `skip_empty_lines: true` to line 78.
2. Better, **fail closed at upload.** Run the same `headerError` on the same first record, and refuse with 400 on:
   - any header problem (unknown, missing, duplicate or Bank);
   - a non-UTF-8 file;
   - a header that fails to parse.

   Every such file fails precheck anyway, with the same decoder and parser, so nothing legitimate is lost. After this change the only files ever stored have a valid v1 header, which cannot contain a Bank column.
3. Add unit and integration cases for a leading CRLF, a leading LF and BOM+CRLF, asserting that `rootHolds` is false.
4. Correct the DEF-023 line and the carry-forward row.

### L-1 (Low): the 10,000-row acceptance test does not catch H-2 coming back

**Location:** `server/test/integration/supplierImport.integration.test.js:471-493`. It is cited in `62_task_041_carry_forward.md:189` as "pinned by an acceptance test with a 60 s bound".

**Mechanism (verified by mutation):**
- The test seeds 2,000 Suppliers with a raw `INSERT` and gives them **no `supplier_name_grams` rows**. Real Suppliers always have them.
- The cost behind H-2 was the per-row gram join.
- My mutants R1 and R1c put the old per-row `SupplierDuplicateCandidates.find` back into `flush`. The test **survived**: it took 2.8 s against a 60 s bound (241 ms unmutated).
- Probe P5 used the same test shape, but with the 2,000 Suppliers' real grams from `hashNameBigrams`:
  - unmutated: 1,000 rows took 36 ms;
  - with R1: 1,000 rows took **36,056 ms**, about 36 ms per row. That is about 360 s for 10,000 rows, beyond the 150 s job timeout. This is REV-064's H-2 again.
- The unit fake (`supplierImportPrecheck.test.js:17-29`) does kill a verbatim reintroduction (R1b), but only by accident: it throws on the unexpected gram query. The unit test asserts only that there is one `supplier_name_key IN` statement. It does not assert that the number of statements stays the same as rows are added.

**Impact:** H-2 can come back with the suite green. This is a test that cannot fail.

**Recommended fix:**
- Seed the acceptance test's Suppliers with their grams, using `replaceSupplierNameGrams` or `hashNameBigrams`.
- Add a unit assertion that the total statement count per batch does not grow with row count. For example, 1 row and 500 rows in one batch should both give at most 3 SELECTs.
- Qualify the "pinned" sentence in the doc.

### L-2 (Low): nothing tests that an abandoned job's rows are deleted

**Location:** `SupplierImportService.js:221`. The mutant is R2.

**Mechanism:**
- If the `DELETE FROM supplier_import_rows` on the abandoned path is removed, every test still passes. The abandon test at `supplierImport.integration.test.js:436-454` never appends a row before the fourth claim.
- The code itself is correct. In probe P3 I appended a row on each of three attempts; the fourth claim failed the job and left 0 rows. Version went 2, 3, 4, then 5.

**Impact:** a regression would silently keep normalized payloads (names, contacts, emails, phones) on a failed job that has no result to download.

**Recommended fix:** in that test, append a row on each crashed attempt and assert zero rows after abandonment.

### L-3 (Low): HD-052 (A) departs from BR-009 / BR-026 / requirement §16.2, and no requirement is named as affected

**Location:** ledger `HD-052`, whose `affected_ids` are only `TASK-043` and `HD-050`. Requirements in `01_requirement_spec.md`:
- **BR-009** (line 534): the system must prompt for identical **or highly similar** names;
- **BR-026** (line 551): CSV, UI and API apply the same validation rules;
- **§16.2** (line 808): for legacy import, names that are similar but not clearly the same entity must go to an exception list.

T43 traces BR-026 and depends on T07 (duplicate candidates).

**Mechanism:** the Product Owner chose (A) knowing fuzzy matching stays in the UI. But the decision record does not name the requirements it departs from. The CSV channel now warns only on identical names. The unit test at `supplierImportPrecheck.test.js:182` asserts that "Acme Trading Limited" against "acme trading" is not flagged.

**Impact:** a gap in traceability and baseline honesty, not a security issue. §16.2's exception list for similar names now has no owner.

**Recommended fix:** do one of these:
- have the Product Owner confirm HD-052 with BR-009, BR-026 and §16.2 in `affected_ids`, and record the deviation in `08_traceability`; or
- carry a follow-up that produces the similar-name exception list out of band, for example an offline report or the T46 result.

### Info

- **I-1:** the stated reason for the `isFile()` equivalence is incomplete.
  - The doc says "a directory has `nlink >= 2`". That does not cover a FIFO. I verified a FIFO has `nlink` 1 and `isFile()` false.
  - The mutant is still equivalent in outcome. With `O_NONBLOCK` and no writer, `readFile` returns 0 bytes, the SHA-256 check fails, and the result is the same `SUPPLIER_IMPORT_SOURCE_UNAVAILABLE`.
  - It is the SHA check that covers a FIFO, not the `nlink` check. Planting one needs write access to the 0700 root.
  - The size-check survivor is equivalent as the doc says.
- **I-2:** the mutation arithmetic reconciles only one way.
  - 58 + 4 (L-2) + 13 (remediation) + 2 (equivalent) = 77, not 74.
  - It reaches 74 only if three of the 13 remediation mutants are the "re-pointed" members of the 58: only-CSV_, update-against-itself, and identical-name-ignored.
  - The earlier "similar-name lookup run on invalid rows" mutant no longer exists.
  - `mut43.py` #24 is labelled "name lookup per row instead of per batch", but it mutates to "no name query" (`&& false`). The doc's wording is the correct one.
- **I-3:** the attempt bound counts every takeover, not only faults.
  - Shutdown (`SUPPLIER_IMPORT_STOPPING`), a scheduler timeout, and a Business Master or DB outage all count.
  - An outage longer than about 3 × 180 s fails every pending upload with `SUPPLIER_IMPORT_PRECHECK_FAILED` and deletes its source, so users must re-upload. That is acceptable under HD-053, but worth putting in operator notes and the T44 job API text.
  - `version` is also the public optimistic-concurrency field. Any future writer that bumps `version` on an `uploaded` or `validating` job (a T44 retry or cancel, say) would shift the count. Carry this to T44, or move to a dedicated attempts column later.
- **I-4:** the identifier lookup in `loadBatchLookups` (`SupplierImportProcessor.js:133-135`) is a full index scan.
  - `WHERE identifier_value_key IN (?)` has no index that leads with that column.
  - EXPLAIN ANALYZE shows `Covering index scan on supplier_identifiers using uq_supplier_identifier_value … rows=20000`, 2.3 ms per batch at 20,000 identifiers.
  - It runs once per batch, not per row, so it is harmless at design scale. It is still the only HD-052 query that is not an index seek.
  - Querying by the full tuple `(identifier_type, issuer_country_code, identifier_value_key) IN ((?,?,?),…)` would use the unique index.
- **I-5:** CI cannot be green, and it is not T43's doing.
  - Dependency audit fails on the PR head and on main bea7b5f (run 36665262526).
  - The cause is a new **high** advisory: brace-expansion, GHSA-q2hr-2g5m-vwhr / qhr7-859c-m2p7 / 6j4f-fj2g-mc7p, in the dev toolchain (eslint/minimatch, editorconfig). There is also a moderate fast-uri advisory, GHSA-hrr3-gc8f-f4qj.
  - HD-051 authorised only the undici lockfile PR, so this needs a new decision.
  - The ledger's `next_safe_action` ("PR #168 must merge before #167 can be green") is stale.

## 2. Status of REV-064 findings

| REV-064 | Status | Basis |
| --- | --- | --- |
| H-1 | **Closed** | See "The H-1 paths I checked" below the table. |
| H-2 | **Closed in code; the test does not catch a regression (L-1)** | P4: 10,000 upsert rows (2,000 updates, 1,000 identical names, 500 taken identifiers) against 20,000 Suppliers with grams and 20,000 identifiers finished in 314 ms, `ready_with_errors`, with the expected 1,000 `NAME_EXISTS` warnings, 500 `IDENTIFIER_TAKEN` errors and 2,000 updates. EXPLAIN ANALYZE: the supplier query is a sort-deduplicate union of range scans on PRIMARY and `uq_suppliers_code_key`; the name query is a covering range scan on `idx_suppliers_name_key`; the identifier query is I-4. The attempt bound is sound (below). |
| M-1 | **Partly closed** | Every precheck failure deletes its source and sets `files_purged_at`: the `jobLevelError` path, source errors, and abandonment (mutants 71-73 and my R3 killed). A failed delete is logged with the code only (P2: `EACCES`, stored name, no content; the file stays; `files_purged_at` is set, so T48's rule collects it). A `ready` or `ready_with_errors` job keeps its source (my R4/R5 killed). The upload refusal can be bypassed (new M-1). |
| L-1 | Closed | `supplier.import.source_cleanup_failed` is logged on both the upload path and the precheck path. P2 confirmed the fields. |
| L-2 | Closed | Tests added. Mutants 65-68 killed. |
| L-3 | Closed | The harness runs serially with a baseline first. The baseline passed on my run. |
| I-1 | Closed | Bucket counts corrected. The new arithmetic ambiguity is I-2 above. |
| I-2, I-6, I-7 | Recorded, not changed | Carried as the doc states. |
| I-3 | Carried to T44 | It now compounds M-1. |
| I-4 | Carried to T45 | — |
| I-5 | Closed | `O_NONBLOCK`. A FIFO at the stored name is refused without hanging (verified). |

**The H-1 paths I checked:**
- **Parse errors.** Every `CsvError` becomes `CSV_MALFORMED`.
- **Other errors inside precheck.** The worker rethrows only a fixed message plus `code`/`publicCode`. Mutants 10 and 59 are killed.
- **DB errors.** `MySqlDatabaseExecutor.run` and `withTransaction` wrap every mysql2 error in a fixed message, with the original only in `cause`. The scheduler logs and stores (`describeError`) only `name: message`. That covers `claimForPrecheck`, `appendPrecheckRows` and `completePrecheck`, which sit outside the worker's try, and their errors are `ApplicationError`s with fixed messages or wrapped errors.
- **Read errors.** Node fs messages carry only the path and are rethrown code-only.
- **Business Master and catalogue errors.** They sit inside the try.
- **Row errors.** Normalizers never interpolate values. `new URL` failures are converted.
- **Upload path.** `uploadHeaderError` swallows `TextDecoder` and csv-parse/sync errors (my R8 killed). Error responses carry only the column index.
- **Job fields.** `error_summary` and `last_error_code` are fixed strings.
- **Probe.** P2 scanned the logs after a stray-quote IBAN and found nothing.

**Attempt bound (focus 2).** Traced and exercised:
- Upload sets `version=1`. Each claim adds 1, append leaves it alone, and complete adds 1 but leaves `validating`, so the claim that sees `version-1 >= 3` abandons after exactly three attempts.
- A crash before the claim commits rolls back and is not counted. A crash after it commits is counted.
- SKIP LOCKED means a second claimer skips the job and does not count.
- On a lease takeover, the slow original owner's append and complete fail with `LEASE_LOST`, so it neither writes nor deletes.
- Off-by-one in both directions is killed (mutant 61 and my R7). Lease clearing (R9), audit (R6) and the purge mark (R3) are killed.
- Abandonment ordering: the failed state and `files_purged_at` commit before the worker unlinks, so a crash in between leaves a file that T48's rule collects. A worker that ignored `abandoned` is killed (R10).
- No other code reads a failed job's source.

## 3. Mutants (mine, serial, against `rev065`)

| # | Mutant | Result |
| --- | --- | --- |
| R1 | Per-row fuzzy lookup put back, wrapped in try/catch | **Survived** (acceptance test 2.8 s) |
| R1b | The same, verbatim, unit files only | Killed, only because the fake throws on the gram query |
| R1c | The same, verbatim, integration files only | **Survived** |
| R2 | Abandoned job keeps its rows | **Survived** (L-2) |
| R3 | Abandoned job not marked purged | Killed |
| R4 | A `ready_with_errors` job loses its source | Killed |
| R5 | Every prechecked job loses its source | Killed |
| R6 | Abandonment audit dropped | Killed |
| R7 | Bound on `version` instead of `version - 1` | Killed |
| R8 | Upload header parse errors rethrown | Killed |
| R9 | Abandoned job keeps its lease | Killed |
| R10 | Worker ignores the `abandoned` flag | Killed |

## 4. What held

Earlier REV-064 guarantees still hold:
- **File safety:** server-made names, `O_EXCL|O_NOFOLLOW` 0600 on write, and `O_NOFOLLOW|O_NONBLOCK`, `nlink === 1` and SHA-256 on read.
- **Request log:** records `[FILE_TRANSFER]` on a 5xx (mutant 74 killed).
- **Supplier tables:** precheck writes nothing to them (IMP-004).
- **Idempotency and auth:** unchanged.

T42 is unaffected:
- The execution path and HD-049's finalize check are covered, with mutant 43 killed.
- The state transitions and lease handling are unchanged.
- The full suite is green.

The ledger:
- Revision 258 records REV-064 as CHANGES_REQUESTED with 2 open Highs, plus HD-051, HD-052 and HD-053 with the Product Owner's answers.
- The carry-forward obligations are recorded correctly: T48's `files_purged_at` rule, T44 for I-3, and T45 for I-4.
- The DEF-023 correction is right about the system log. It is wrong about "never stored" (M-1).

## 5. What I could not verify

- I did not measure the scheduler's own `fr_job_stats` row end to end: the integration harness disables the import jobs. The unit mutant covers the rethrown message, and the scheduler stores only `name: message`.
- I did not test at 100,000 Suppliers. The query plans are index seeks except I-4.
- I did not run Playwright, because T43 has no UI.

## Clean-up

- Dropped schema `rev065` and revoked `erp_user`'s grant on it. `SHOW GRANTS` now lists only `erp_dev`.
- Removed the worktree `/private/tmp/erp-rev-065` with `git worktree remove --force` and pruned.
- Deleted `/private/tmp/r65` with its probes, mutation copies, FIFO and outputs, some of which held the test IBAN.
- Each mutant was restored from saved bytes. The worktree was clean before removal.
- t43, its `node_modules` and `erp_dev` were not touched. I made no commits, pushes or PR comments.
- All background processes I started have exited.
- There are four `supplier-import-{logs,root}-*` directories in `$TMPDIR` dated 09:39–09:41. They predate this review, so I left them.

# REV-068: TASK-043 REV-067 remediation (PR #167), independent review

Reviewer: REV-068, an independent agent using the security-auditor persona. I did not write this code, REV-064 to REV-067, or any earlier review.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The text below is the reviewer's, unchanged apart from this note.

- **Merge candidate:** 369b9893ae421da22e5bc9b37215cc957ead067f on `claude/supplier-task-043`.
  - `gh pr view 167`: OPEN, MERGEABLE, CLEAN, and this is the head. `git ls-remote` shows the same head.
  - `gh pr checks 167`: all five checks pass (Playwright, Build frontend, Dependency audit, Lint, Test with MySQL).
- **Base:** 8bc4a4c, merged into the branch at 5350f16 (its parents are 1231110 and 8bc4a4c). **origin/main has moved again, to d6397e0** (PR #171; see I-4).
- **Commits reviewed:**
  - 1231110: slices, yields and tests.
  - 5350f16: merge of main.
  - 369b989: doc 62, doc 70 and ledger revision 261.
- **Where I worked:**
  - A detached worktree at `/private/tmp/erp-rev-068`, with `node_modules` symlinked to t43's.
  - A private schema `rev068`, migrated as admin. I never touched `erp_dev`.
  - Scratch files in `/private/tmp/r68`.
  - My env file was a copy of `env43.sh` with `DB_NAME=rev068`, and `mut43.py` was copied with `ROOT` and `ENV` repointed.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 5 |

**Disposition: APPROVED.**

REV-067 L-1 is closed:
- On the real worker path (app in-process, real MySQL, real file, SHA-256 and INSERTs), the longest event-loop gap for a valid header followed by 10 MB of blank rows fell from **1,424 ms to 18 to 25 ms**.
- Slicing is correct. There were 0 divergences between one-chunk and sliced parsing over 100,000 fuzzed inputs at 9 slice sizes, plus 40 directed cases at the real size. The fuzzer is not blind: removing the surrogate guard gave 2,817 divergences in 2,000 inputs.
- The mutation counts in doc 62 reproduce exactly.

There are no conditions. The residuals below are Info:
- The yield counts records, not bytes, so wide-row files still stall about 0.13 to 0.20 s at 10 MB. That is unchanged from before this fix, not a regression.
- Main must be merged again before merge, per the user's rule.

### What I ran

| Command | Result |
| --- | --- |
| `npx eslint .` | exit 0 |
| The six import unit files, serial | **61/61** pass (REV-067's 58 plus 3 new tests) |
| Both import integration files, serial, `rev068` | **25/25** pass. The 10,000-row precheck against 2,000 Suppliers took 307 ms. |
| Full server suite, `--test-concurrency=1`, Bank keys set, `rev068` | **2,395 tests: 2,386 pass, 0 fail, 9 skipped.** That is REV-067's 2,392 plus 3. |
| Author's `mut43.py` (copied, repointed), serial, baseline first | Baseline PASS. **89 mutants, 87 killed.** Survivors: #63 (`isFile()` removed) and #64 (read-side size check removed), the same two equivalent mutants. #84 to #88 (REV-067 I-1, I-2 and the three L-1 mutants) are all KILLED. **This matches doc 62.** |
| 14 mutants of my own (§3), same harness | 10 killed, 4 survived: 3 equivalent, 1 tolerated |
| Differential fuzzer (§2), 4 seeds × 25,000 inputs × slice sizes 1, 2, 3, 4, 5, 7, 8, 13, 64 | 0 divergences, 0 parity breaks |
| Directed boundary cases at 65,536 (40), and field-cap cases at 8 slice sizes (256) | 0 differences |
| Stall probes (§4): 10 shapes direct with a fake DB, 4 shapes through the real worker path, and 100 MB runs, new code against b05af92 | See §4 |

## 1. Findings

### I-1 (Info): the yield trigger counts records, not bytes, so wide-row files still parse up to ~10 MB between yields

**Location:** `server/src/modules/supplier/import/SupplierImportProcessor.js`:
- `:81`: `YIELD_EVERY_RECORDS = 1_000`
- `:421-422`: the record counter and yield
- about `:434`: the batch flush at 500 rows

**Mechanism (verified by measurement):**
- The only macrotask boundary inside the parse is the `setImmediate` every 1,000 records. The generator, `pipe` and `for await` all resume on microtasks, which REV-067 had already shown.
- The first flush (and with a real DB, its I/O) comes after 500 rows.
- So when rows are about 20 KB, every row up to the first flush (all 10 MB) is parsed with no yield at all.

Longest gap, direct call with a fake DB, 10 MB:

| Shape | b05af92 | 369b989 |
| --- | --- | --- |
| 30 cells × 690 chars per row | 175 ms | 179 ms |
| Same, CJK | 192 ms | 188 ms |
| Same, with control characters | 144 ms | 150 ms |
| One 65,000-char quoted field per row | 136 ms | 136 ms |

On the real worker path:

| Shape | b05af92 | 369b989 |
| --- | --- | --- |
| Wide rows | 187 ms | 182 to 198 ms |
| Long quoted field | 133 ms | 120 to 147 ms |

At the configurable ceiling (`maxFileBytes` up to 104,857,600) with real DB lookups:
- Wide rows: **305 ms**.
- Long quoted field: **381 ms**.
- Blank rows stay at 26 ms, though the job takes 7.6 s in total.

**Impact:**
- Availability only. The attacker must be authenticated, and it is one job per 5 s tick.
- At the default 10 MB the worst reachable stall is now about 0.2 s, against about 1.4 s before the fix. Wide rows were never covered by L-1 and are not worse than before.
- The 200 ms test covers only the blank-row shape. Wide rows sit at about 180 to 198 ms on this machine, which is close to that line.

**Fix (optional, verified in a scratch copy):**
- Also yield when the parser has advanced more than 1 MiB since the last yield:
  ```js
  if (records % YIELD_EVERY_RECORDS === 0 || parser.info.bytes - yieldedAt > 1_048_576) { yieldedAt = parser.info.bytes; await new Promise(setImmediate); }
  ```
- Result at 10 MB: wide rows 39 ms, long quoted field 32 ms, blank rows 17 ms, legit file 45 ms.
- Result at 100 MB (long quoted field, real DB): 63 ms.
- What remains is `checkRow` over one batch of 500 rows, which runs on microtasks. Or record the residual in doc 62 with these numbers.

### I-2 (Info): a mid-file CSV error now surfaces after earlier rows were checked, looked up and written

**Location:** `SupplierImportProcessor.js:399` (sliced feed) and `:420-436` (loop and flush). The header comment at `:20` says file-level problems fail the job with "一列都唔寫" (not one row written).

**Mechanism (verified):**
- Before, the whole file was one chunk. A `CsvError` anywhere destroyed the parser in the same `_transform` call, and `for await` threw before yielding any buffered record.
- Now, records from earlier slices are consumed first.
- Test file: 9,000 valid rows, then an `a,b` row, then 1,000 more rows:
  - b05af92: 0 rows handed to `onRows`, 0 lookup queries.
  - 369b989: **8,500 rows handed to `onRows`, 34 lookup queries**, then `MALFORMED`.

**Impact:**
- `completePrecheck` deletes the rows in the same transaction that marks the job failed (`SupplierImportService.js:303`), so the end state is unchanged.
- There is no row-read API in T43. The Bank refusal is header-level and still happens before any row.
- The extra work is bounded by `maxRows`. The same path already existed for end-of-file errors (an unterminated quote: 8,500 rows on both old and new code) and for `TOO_MANY_ROWS`. This is not a new class of exposure.

**Fix:**
- No code change needed. Reword the comment to "leaves no rows", or note it in doc 62.
- T44's row-read endpoint must keep gating on job status. It must never serve `validating` rows.

### I-3 (Info): the 200 ms gap assertion pins the order of magnitude, not the constants

**Location:** `server/test/supplierCsvSchema.test.js`, about lines 194-207 (gap test) and 209-230 (boundary test).

**Verified:**
- **R1 (slice 1 MiB) is KILLED, but only incidentally.** The boundary test's `maxBytes: 1_000_000` returns `FILE_TOO_LARGE` once the boundary moves past 1 MB. With R1 applied, the gap test itself passes (88 ms measured).
- **R4 (yield every 10,000 records) survives**, with a 49 ms gap.
- R2 (16 MiB), R3 (100,000 records), R10 to R14 are killed by the gap test.
- **Robustness:**
  - Normally the gap is 15 to 17 ms.
  - Under 2× CPU oversubscription (30 busy loops on 15 cores) it is **68 to 94 ms**, so the headroom is about 2× at worst.
  - Without the fix it is about 825 ms, or about 2 s under load.
  - The assertion is neither flaky nor unable to fail.

**Fix:** none required. If the constants matter, compute the boundary test's `maxBytes` from `SUPPLIER_CSV_PARSE_SLICE` so a slice-size change fails for the right reason.

### I-4 (Info): main has moved again

- origin/main is now d6397e0 (PR #171, 49 commits from 8bc4a4c).
  - It touches `server/src` (13 inventory files and `authorization/permissionCatalogue.js`).
  - It adds migration `0063_create_inventory_reservations.js`, which has no number collision; main already has 0061 and 0062.
  - It also changes `package-lock.json` and `client/package.json`.
- There is no file overlap with this PR, and `git merge-tree` is clean.
- Revision 261's `next_safe_action` and `default_commit` name 8bc4a4c.
- Per the user's rule, merge main into the branch and let CI rerun before merging. The migration and permission-catalogue changes mean a clean text merge is not enough on its own.

### I-5 (Info): doc wording

- Doc 62 says "upload **refuses** every 10 MB shape tried in 110 ms or less". REV-067 said upload **finishes** in 110 ms or less; many of those shapes are accepted. Immaterial.
- Doc 62's L-1 row is accurate for the shape it names, but says nothing about wide rows (I-1).
- The harness note says the author's runs used `erp_dev` "on purpose (that instance exists only for this task)". I cannot verify that. The note is otherwise correct: exporting `DB_NAME` has no effect, and `ENV` must point at a copy.

## 2. Slicing correctness (focus 1)

**Surrogates:**
- A fatal `TextDecoder` throws on encoded lone high (ED A0 80) and low (ED B0 80) surrogates and on CESU pairs. So `text` is always well-formed UTF-16: every high surrogate is followed by a low one.
- The guard at `:88` extends a slice ending on a high surrogate by one code unit. So no slice can end on a high surrogate or start on a low one.
- The fuzzer counted **0** such slices across 900,000 slicings.
- **Negative control:** with the guard removed (`void last`), the same fuzzer found 2,817 divergences and 57,334 split surrogates in 2,000 inputs.

**BOM:**
- The decoder strips one leading BOM (`ignoreBOM` is false), and csv-parse's `bom` check runs only while `bomSkipped` is false, on the first buffer.
- With size-1 slices, csv-parse holds bytes in `previousBuf` until it has 3, so a second BOM is still recognised.
- One-chunk and sliced parsing agree on BOM, BOM-BOM and a run of 65,536 BOMs.

**Line ends:**
- csv-parse's `__needMoreData` holds back 2 bytes until the record delimiter is discovered, then `recordDelimiterMaxLength`, plus quote/escape lookahead while quoting.
- Directed cases matched: a header padded with spaces so its first CR falls at 65,534 to 65,537 (discovery at the boundary, CRLF and CR-only), CRLF blank lines across the boundary, and a 5,000-row CR-only file.

**Quotes:**
- `""` escapes and a closing quote followed by CRLF placed at offsets −3 to +2 around 65,536 gave the same results.
- Size-1 to size-13 slices put every quote and escape on a boundary somewhere in the fuzz corpus.

**`max_record_size` and the field-cap `cast`:**
- Quoted fields of 65,530 to 65,540 units in ASCII, `é` and emoji straddling the boundary gave identical records or identical `CSV_MAX_RECORD_SIZE`.
- Rows of 255, 256, 257 and 300 fields (plain or quoted with emoji, with or without BOM and leading blank lines) at 8 slice sizes gave the same results. 257 and more is `CSV_TOO_MANY_FIELDS` in every case, so `cast`'s `index` is per record across slices.

**Parity (REV-065 property):**
- Among about 23,700 fuzz inputs that upload accepted, the first record precheck's `for await` sees always equals `parseSync(..., { to: 1 })[0]` whenever precheck gets that far. Otherwise precheck reports `MALFORMED` from a later row, the documented safe direction.
- For about 13,900 inputs where upload said `BANK_COLUMN_FORBIDDEN`, precheck saw the same header (so `BANK`) or `MALFORMED`. None was accepted.
- Directed: a 31-field Bank header over 31-field rows gives `BANK_COLUMN_FORBIDDEN` at precheck. Over 30-field rows it gives `MALFORMED`, because the column-count error lands in the header's slice. Both refuse, and this was already the case before.

## 3. Mutants (mine, serial, against `rev068`, baseline passed)

| # | Mutant | Result |
| --- | --- | --- |
| R1 | Slice 1 MiB | Killed, incidentally (I-3) |
| R2 | Slice 16 MiB (one slice) | Killed |
| R3 | Yield every 100,000 records | Killed |
| R4 | Yield every 10,000 records | **Survived**, tolerated (49 ms gap) |
| R5 | Guard reads `charCodeAt(end)` | Killed |
| R6 | Guard range includes low surrogates | Survived, equivalent (a well-formed slice never ends on a low surrogate that needs extending, and extending by one is harmless) |
| R7 | Guard checks low instead of high | Killed |
| R8 | Cut before the high surrogate (`end -= 1`) | Survived, equivalent (also never splits) |
| R9 | `end < text.length` guard dropped | Survived, equivalent (well-formed text never ends on a high surrogate) |
| R10 | Skipped rows not counted toward the yield | Killed |
| R11 | Yields once only | Killed |
| R12 | `await Promise.resolve()` instead of `setImmediate` | Killed |
| R13 | `process.nextTick` instead of `setImmediate` | Killed |
| R14 | Slice 8 MiB | Killed |

## 4. Stall, cost and concurrency (focus 2 and 3)

**Direct call, fake DB, 10,485,760 bytes (longest gap of a 1 ms interval):**

| Shape (all pass upload) | b05af92 | 369b989 |
| --- | --- | --- |
| Blank 30-field rows (CRLF) | 825 ms | **15 to 17 ms** (total 811 to 877 ms) |
| Blank rows, CR only | 839 ms | **16 ms** |
| Minimal rows, stops at `TOO_MANY_ROWS` | | 13 ms |
| 10,000 rows, each invalid (control characters) | | 37 ms |
| 256-field rows after a valid header | | 3 ms (`MALFORMED` at the first row) |
| Wide rows and long quoted fields | 136 to 192 ms | 136 to 188 ms (I-1) |

**Real worker path.** This was a scratch copy of the integration file, since deleted. The app ran in-process, so the gap is the API server's own event loop. It called `runPrecheck` for real (claim, `readSupplierImportSource` with SHA-256, catalog, `appendPrecheckRows`, `completePrecheck`) against 2,000 seeded Suppliers:

| Shape | b05af92 | 369b989 |
| --- | --- | --- |
| 10,000 valid rows with address, contact and identifier | 79 ms | 23 to 26 ms |
| 10 MB blank rows | **1,424 ms** | **18 to 25 ms** |
| 10 MB wide rows | 187 ms | 182 to 198 ms |
| 10 MB long quoted field | 133 ms | 120 to 147 ms |

**Other synchronous slices:**
- The fatal UTF-8 decode of 10 MB takes 0.8 ms (ASCII) to 3.0 ms (CJK or emoji), and 9.4 ms at 100 MB.
- SHA-256 takes 3.1 to 3.3 ms for 10 MB and 31 ms for 100 MB.
- Nothing else on the path is a long synchronous slice.

**New costs:**
- No measurable generator overhead: blank-row totals are 811 to 877 ms against 825 ms before.
- RSS growth fell from 223 to 237 MB to 139 to 184 MB.
- Backpressure holds. Each 64 KiB string is larger than the Transform's writable high-water mark, so the source pauses after each write. `Readable.from` reads ahead at most its object high-water mark.

**Early return and cleanup** (a counting copy of `textSlices`, checked 300 ms after return):

| Case | Slices pulled | Later |
| --- | --- | --- |
| Bank header | 2 of 158 | none |
| Unknown header | 2 of 158 | none |
| Malformed second row | 3 of 153 | none |
| `TOO_MANY_ROWS` | 2 of 11 | none |

`return` inside `for await` destroys the parser. `pipe` unpipes the source, and the suspended generator is never resumed. No work continues in the background.

**Concurrency:**
- `SchedulerService` keeps a job name in `running` until `job.run()` settles, and it does not race the run against the timeout. So no second in-process precheck can start during a yield.
- Across processes, `claimForPrecheck` uses `FOR UPDATE SKIP LOCKED` and only reclaims after `lease_until`. The lease is 180 s against a 150 s timeout.
- The longest precheck I measured is 7.6 s (100 MB of blank rows, no flushes and so no lease renewal), far inside the lease.
- `appendPrecheckRows` and `completePrecheck` both `assertLease`.
- T43 has no request path that mutates a `validating` job; upload creates a new job. The yields therefore interleave only unrelated requests.

**Abort:**
- `signal` is still checked only at flush. An abort during a blank-row file runs to the end: 808 ms for 10 MB, then `CSV_EMPTY`, which is the correct result.
- This is the same as before, and well inside `scheduler.stop`'s 5 s.
- With valid rows, abort throws at the next flush, as before.

## 5. Status of REV-067 findings

| REV-067 | Status | Basis |
| --- | --- | --- |
| L-1 | **Closed** | Blank rows: 1,424 to 18–25 ms (worker path) and 825 to 15–17 ms (direct). Minimal rows: 13 ms. The residual wide-row stall is separate and not worse (I-1). |
| I-1 | **Closed** | The 257-field test gives `MALFORMED` at both upload and precheck. Mutant #84 (precheck without the cap) is KILLED. |
| I-2 | **Closed** | A same-type, same-value pair in HK and SG. Mutant #85 (key drops country) is KILLED. |
| I-3 | **Closed** | The comment at `:74` now says a header over 256 fields reports `MALFORMED` even with a Bank column. |
| I-4 | Done for 8bc4a4c (5350f16) | **Main moved again** to d6397e0 (I-4 above) |
| I-5 | Closed | The harness note was added to doc 62 (see I-5 above for the part I cannot verify) |

## 6. What held

- **Slicing is value-preserving** for every input class in focus 1 (§2), and the fuzzer discriminates.
- **Upload/precheck parity and the Bank refusal** are preserved. No file with a Bank header can be accepted by precheck.
- **The stall is bounded** at about 0.2 s or less for every 10 MB shape that passes upload, and at about 25 ms or less for the record-heavy shapes L-1 named.
- **No leaked work** after an early return or an error.
- **No new concurrency hazard** from yielding.
- **The new tests discriminate:**
  - #86 to #88 are killed.
  - R2, R3 and R10 to R14 are killed.
  - The 200 ms threshold has 12× headroom normally and about 2× under 2× CPU oversubscription.
- **No regressions:** lint, 61/61 unit, 25/25 integration, and the full suite (2,386 pass, 0 fail) all pass.
- **Ledger revision 261 is consistent:**
  - REV-067 is recorded as `CHANGES_REQUESTED` for "APPROVED WITH CONDITIONS", the same convention as REV-065 and REV-066.
  - `reviewed_baseline` is the same design hash (e4083319…).
  - `default_commit` is 8bc4a4c, and `next_safe_action` was accurate when written; it is now stale only because of I-4.
  - Doc 62's mutation counts (89, 87 killed, #63 and #64 equivalent) reproduce exactly.

## 7. What I could not verify

- **HTTP latency during precheck.** I tried to measure it with an out-of-process pinger against `/api/v1/health`. In this harness `/health` settles at about 490 ms per request even when idle (idle sequence: 34, 7, 480, 494, 497, 493 ms). The cause is unrelated to precheck and was not determined. So I relied on the in-process event-loop gap, which is the server's own loop because the app runs in the test process.
- Whether the author's mutation runs against `erp_dev` were harmless, as doc 62 states.
- Doc 70's fidelity to REV-067's original hand-back.
- Playwright: T43 has no UI.

## Clean-up

- Revoked `erp_user`'s grant on `rev068` and dropped the schema. `SHOW GRANTS` lists only `USAGE` and `erp_dev`.
- The worktree was clean before removal:
  - The mutation harness restored every mutant by rewriting the original bytes.
  - My temporary R1 re-run and variant swaps also restored the original bytes.
  - The scratch integration file `zz_r68_gap.integration.test.js` was deleted.
  - `git status` was empty.
- Removed `/private/tmp/erp-rev-068` with `git worktree remove --force` and pruned. t43's `node_modules` is intact.
- Deleted `/private/tmp/r68`: probes, fuzzer, patched processor copies, harness copies, env copy and outputs.
- No `supplier-import-*` directories are in `$TMPDIR`. The mutation processes and pinger children have exited.
- **Deviation:** I stopped the 30 CPU busy loops I started for the load test with `pkill -f` on their exact command line, not by PID. `pgrep` afterwards showed none left.
- t43 and `erp_dev` were not touched. I made no commits, pushes or PR comments.

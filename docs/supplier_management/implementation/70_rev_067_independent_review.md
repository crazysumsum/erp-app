# REV-067: TASK-043 REV-066 remediation (PR #167), independent review

Reviewer: REV-067, an independent agent using the security-auditor persona. I did not write this code, REV-064, REV-065, REV-066 or any earlier review.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The text below is the reviewer's, unchanged apart from this note.

- **Merge candidate:** b05af92421dc16423f119a7a016de42ea02ea125 on `claude/supplier-task-043`.
  - `gh pr view 167`: OPEN, MERGEABLE, and this is the head. `git ls-remote` shows the same head.
  - `gh pr checks 167`: all five checks pass (Playwright, Build frontend, Dependency audit, Lint, Test with MySQL).
- **Base:** dd36250. **origin/main has moved to 8bc4a4c** (PR #170). The five new commits touch only `docs/sales_order_management/` (10 files), so nothing overlaps with this PR. The user's merge rule still applies: merge main into the branch and let CI rerun before merging.
- **Commits reviewed:**
  - aa416df: the field cap and the two tests.
  - b05af92: doc 62, doc 69 and ledger revision 260.
- **Where I worked:**
  - A detached worktree at `/private/tmp/erp-rev-067`, with `node_modules` symlinked to t43's.
  - A private schema `rev067`, migrated as admin. I never touched `erp_dev`.
  - Scratch files in `/private/tmp/r67`.
  - My env file was a copy of `env43.sh` with `DB_NAME=rev067`. **The author's `mut43.py` sources `env43.sh`, which exports `DB_NAME=erp_dev`**, so exporting `DB_NAME` before running the script has no effect. I pointed `ENV` at my copy instead. Anyone rerunning the harness needs to do the same.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Info | 5 |

**Disposition: APPROVED WITH CONDITIONS.**

REV-066 M-1 is closed. Upload now finishes in 110 ms or less for every 10 MB shape I built. The comma floods and quoted-empty floods that took 1.2 to 1.7 s now take about 2 ms at both upload and precheck.

**One condition, L-1:** before merge, either fix it or record it explicitly as carried to T44 with Product Owner acceptance.
- The `cast` makes csv-parse build an info object for every field, which makes every precheck parse about 2.5 to 3 times slower.
- Precheck runs on the API process's event loop (in-process scheduler) and parses the whole file in one synchronous slice.
- So the worst event-loop stall a file that passes upload can cause went **up**, from about 0.37 to 0.45 s to about 0.84 to 1.0 s.
- Doc 62 says the refusal is now fast. That is true only for the flood shape.

### What I ran

| Command | Result |
| --- | --- |
| `npx eslint .` | exit 0 |
| The six import unit files (`supplierCsvSchema`, `supplierImportConfig`, `supplierImportPrecheck`, `supplierImportService`, `supplierImportUploadHandlers`, `supplierImportWorkerService`), serial | 58/58 pass |
| Both import integration files, serial, `rev067` | 25/25 pass (the 10,000-row precheck took 353 ms) |
| Full server suite, `--test-concurrency=1`, Bank keys set, `rev067` | **2,392 tests: 2,383 pass, 0 fail, 9 skipped.** That is REV-066's 2,390 plus the two new tests. |
| Author's `mut43.py` (copied, `ROOT` and `ENV` repointed), serial, baseline first | Baseline PASS. **84 mutants, 82 killed.** Survivors: #63 (`isFile()` removed) and #64 (read-side size check removed), the same two equivalent mutants. **This matches the doc.** |
| 9 mutants of my own (§3), same harness | 5 killed, 4 survived |
| Cost probe, 21 shapes at 10 MB, new code against 7fd45cc, with the maximum gap of a 1 ms interval timer as event-loop stall | §4 |
| Differential fuzzer, 4 seeds × 25,000 inputs, plus 8 directed cases | 0 divergences (§2) |

## 1. Findings

### L-1 (Low): the field-cap `cast` makes every precheck parse about 2.5 to 3 times slower; the worst reachable event-loop stall rose to about 1 s per job

**Location:**
- `server/src/modules/supplier/import/SupplierImportProcessor.js:76-82`: the `CSV_OPTIONS.cast` function.
- `SupplierImportProcessor.js:382`: `Readable.from([text]).pipe(parse(CSV_OPTIONS))`.
- `SupplierImportProcessor.js:399-411`: the record loop.

**Mechanism (verified by reading the code and by measurement):**
- **Per-field cost.** In csv-parse 7.0.2, a function `cast` sets `options.cast = true`. After that, `__onField` calls `__cast` for every field.
  - `__cast` calls `__infoField()`, which spreads `__infoRecord()`, which spreads `__infoDataSet()`, which spreads `this.info`.
  - So each field allocates several fresh objects. Before aa416df, `cast` was undefined and none of this ran.
- **One synchronous slice.** `Readable.from([text])` hands the parser a single 10 MB chunk, and csv-parse's `_transform` parses a whole chunk synchronously. The entire file is therefore parsed, and all its records pushed, before the loop sees the header.
- **Where it runs.** The precheck runs in `SupplierImportWorkerService`, registered with the in-process `SchedulerService` (`setTimeout`, one job per 5 s tick). That is the API process's event loop.
- **Blank rows are free.** Blank rows (`,,,,`) are skipped without counting toward `maxRows`, so a header followed by 10 MB of blank rows is parsed in full.

**Measured** with `precheckSupplierCsv` called directly (fake DB), 10 MB inputs whose header passes upload, stall measured with a 1 ms interval timer:

| Shape | 7fd45cc (no cap) | b05af92 (cap) |
| --- | --- | --- |
| Valid header, then 10 MB of commas | 365 to 450 ms stall, up to +679 MB RSS | **2 ms** |
| Valid header, then 10 MB of `"",` | 216 to 250 ms | **2 ms** |
| Valid header, then 10 MB of blank 30-field rows | 333 to 369 ms | **813 to 1,001 ms** |
| Valid header, then 10 MB of minimal 30-field rows (stops at `TOO_MANY_ROWS`) | 265 to 306 ms | **745 to 842 ms** |
| Legitimate 2.6 MB file of 10,000 rows | 364 ms | 384 ms (mostly row checks) |

- Before: the worst stall a file that passes upload could cause was about 0.45 s.
- After: it is about 1.0 s.
- One `supplier.mgmt` user uploading one such file every 5 s (far under the 20 requests/s limiter) causes about 1 s API stalls every 5 s for all users.

**Impact:**
- Availability only. The attacker must be authenticated, and the cost is bounded by `maxFileBytes` and by one job per tick. Nothing is exposed.
- The stall predates aa416df at about 40% of its current size. aa416df multiplied it.

**Fix (verified in a scratch copy):**
- Feed the parser in 64 KiB slices: `Readable.from(slices(text))`.
- In the `for await` loop, `await new Promise(setImmediate)` every 1,000 records, counting skipped rows too.

Result with the cap kept:

| Shape | Stall with the fix |
| --- | --- |
| Blank rows | 23 ms (total 893 ms) |
| Minimal rows | 16 ms |
| Legitimate file | 39 ms |
| Flood | 2 ms |

- Header-refused bodies stop after the first slice (the 256-field-rows case went from 731 ms to 13 ms).
- Slicing alone does not help: for-await resumes on microtasks, so without the `setImmediate` the blank-row case still stalled 891 ms.
- If you adopt this, add a differential test that one-chunk and sliced feeds give identical records, since CRLF can be split across a slice boundary.
- Alternatively, carry it to T44 as an obligation with the numbers above.

### Info

- **I-1: the precheck half of the new 10 MB test does not discriminate.**
  - My mutant R1 removes the cap from the precheck parser only (`parse({ ...CSV_OPTIONS, cast: undefined })`), and it **survives**.
  - The uncapped precheck of the same input still returns `MALFORMED`, from the column-count check, in about 374 ms. That is under the 500 ms threshold, but it costs **+532 MB RSS**.
  - `supplierCsvSchema.test.js:173-183` therefore pins the cap at upload only.
  - Fix: add a deterministic case. A header of 257 fields gives `MALFORMED` at both upload and precheck; without the cap, precheck gives `HEADER_UNKNOWN` or `DUPLICATE`. Or tighten the precheck timing to around 50 ms.
- **I-2: the REV-066 I-2 test pins type but not country.**
  - My R8 keys `identifierKeys` by `type + key`, dropping country, and it **survives**.
  - I verified the mechanism with a params-honouring fake. Rows `(tax, HK, SAME1)` (taken) and `(tax, SG, SAME1)` in one batch come out `invalid: IDENTIFIER_TAKEN` + `valid` on the real code and `valid` + `valid` under R8: the HK tuple is overwritten and never queried.
  - The test's title says "another type or country", but only type is exercised. My R9 (drop type) is KILLED, and so is the author's #101 (value only).
  - Add a second pair: same type and value, different country. The current code is correct, and T45 would still hit the unique key.
- **I-3: a Bank column inside a header of 257 or more fields is reported as `MALFORMED`, not `BANK_COLUMN_FORBIDDEN`.**
  - Verified at both upload and precheck, with IBAN first or last.
  - The file is still refused and never stored, and upload and precheck agree. With 31 to 256 fields the code is `BANK_COLUMN_FORBIDDEN` at both.
  - The comment at `:73` ("上限要高過範本欄數，Bank 欄先會照樣報自己嘅錯誤碼") holds only up to 256 fields. Worth one clause in the comment or in doc 62. No action otherwise.
- **I-4: main has moved** from dd36250 to 8bc4a4c. The change is docs only (`docs/sales_order_management/`), with no overlap. Merge main into the branch before merging, per the user's rule.
- **I-5: doc wording.**
  - Doc 62 says "about 1.2 s per request". REV-066 measured 1.26 to 1.34 s (1.5 s end to end). Immaterial.
  - The doc 62 claims "a test requires under 100 ms at upload and under 500 ms at precheck" and "82 killed of 84" are accurate.
  - The mutation-harness caveat above (`env43.sh` sets `DB_NAME=erp_dev`) is not mentioned anywhere. If the author ran the harness as written, the integration mutants ran against `erp_dev`. Note it next to the harness description.

## 2. Status of REV-066 findings

| REV-066 | Status | Basis |
| --- | --- | --- |
| M-1 | **Closed** | See "How I verified M-1" below the table. L-1 is a new, separate cost. |
| I-2 | **Partly closed** | The type dimension is pinned (#101 and R9 killed). Country is not (R8 survives; see I-2 above). |
| I-1, I-3, I-4, I-6 | Recorded in doc 62 as not changed | Accurate |
| I-5 | Closed | `next_safe_action` in revision 260 no longer says #169 must merge. #168 and #169 are MERGED (verified with `gh`). |

**How I verified M-1.** 10 MB at upload, new code against old:

| Input | Old | New |
| --- | --- | --- |
| Commas | 1,293 ms | **2.0 ms** |
| `"",` | 1,225 ms | 2.1 ms |
| Mixed quotes and delimiters | 60 ms | 2 ms |
| BOM then commas | 1,349 ms | 2 ms |
| 255-field rows | | 1.7 ms |
| 256-field rows | | 1.8 ms |
| 257-field rows | | 1.7 ms |
| A 65,530-character quoted field | | 6 ms |
| A 65,540-character quoted field | | 6 ms |
| Repeated BOMs | | 22 ms |
| Spaces | | 14 ms |
| `a\n` rows | | 2.4 ms |
| LF only | | **101 ms** |
| CRLF only | | 53 ms |
| CR only | | 97 ms |

- The worst upload shape left is 10 MB of line ends, about 100 ms. It is linear with a small constant and predates this PR (REV-066 measured 67 ms).
- The fatal UTF-8 decode and `sync.js`'s `Buffer.from` copy are a few milliseconds each.
- Nothing else on the request thread scales with input size.

**Cap semantics (focus 2 and 3):**
- **Values unchanged.** A function `cast` takes precedence over `__isFloat`, so values stay strings. Old against new options: 79,931 identical outputs, and every other input was refused with `CSV_TOO_MANY_FIELDS` only because it had more than 256 fields.
- **Index.** A spy `cast` confirmed that `index` is the zero-based position in the record in every case, including after BOMs and skipped blank lines. It was checked for every field across 100,000 fuzz inputs with 0 mismatches; the header row is included.
- **Sync and streaming agree.** The first record from `parseSync({ to: 1 })` equals the streaming first record in all cases, errors included, and neither parser changes anything else.
- **Error type.** The cast's error is returned unwrapped by `__cast` and re-thrown by `sync.js` or passed to the stream callback. It is `instanceof CsvError` at both catch sites (`:111`, `:421`), because the ESM entry points share `lib/api/CsvError.js`. Mutant R2 (a plain `Error`) is KILLED.
- **No data in messages.** The message is fixed, and both sites return the fixed `MALFORMED` pair, so no csv-parse message reaches a response or log.

**Parity (REV-065 property):**
- 0 inputs where upload accepted and precheck refused at header level.
- 0 inputs where upload refused and precheck accepted.
- Every upload `BANK` result was refused at precheck: 3,120 with `BANK` at both, and the rest with `MALFORMED` on a later row, which is the documented safe direction.

Directed cases:

| Case | Result |
| --- | --- |
| Template + IBAN (31 fields) | `BANK` at both |
| 256 fields with IBAN | `BANK` at both |
| 257 fields with IBAN | `MALFORMED` at both |
| Valid header + a row of 256 or 257 fields | Accepted at upload, `MALFORMED` at precheck |

## 3. Mutants (mine, serial, against `rev067`, baseline passed)

| # | Mutant | Result |
| --- | --- | --- |
| R1 | Precheck parser without the cap | **Survived** (I-1) |
| R2 | Cap throws a plain `Error` | Killed |
| R3 | `index > MAX_FIELDS` (257 allowed) | Survived, equivalent in effect |
| R4 | `MAX_FIELDS = 100_000` | Survived. Still bounded; the test tolerates a loose cap. |
| R5 | `MAX_FIELDS = 31` | Killed (the 32-column Bank test) |
| R6 | `MAX_FIELDS = 30` (template width) | Killed |
| R7 | `cast` returns `value.trim()` | Survived, nearly equivalent: cells are trimmed later, and only `isTemplateRow` sees raw `values[0]` |
| R8 | Identifier key drops country | **Survived** (I-2) |
| R9 | Identifier key drops type | Killed |

## 4. What held

- **Upload cost is bounded** for every shape in focus 1. See the table in §2.
- **The streaming flood is refused.** A valid header followed by a flood row is refused in about 2 ms with no RSS growth (it was 0.37 to 0.45 s and up to 679 MB).
- **Upload/precheck parity and the Bank refusal** are preserved (§2). No file with a Bank header can be stored.
- **The identifier-key test is correct as far as it goes.** Its fake honours the `(type, country, key)` tuples it is asked for, and it kills the value-only mutant (#101).
- **No regressions:** lint, the six unit files, both integration files and the full suite pass.
- **Ledger revision 260 is consistent with the earlier entries.**
  - REV-066 is `CHANGES_REQUESTED`, `open_high` is 0, and `reviewed_baseline` is the design hash that REV-064 and REV-065 also use.
  - `next_safe_action` is accurate.
  - Doc 69 matches the reviewer text, as far as I can judge without the original hand-back.
- **The mutation counts in the doc are reproduced exactly:** 84 mutants, 82 killed, with #63 and #64 surviving.

## 5. What I could not verify

- The L-1 stall inside a running server over HTTP. I measured `precheckSupplierCsv` in isolation with a fake DB. The parse stall does not depend on the DB. The worker's `readSupplierImportSource` adds a SHA-256 over the file first.
- Whether the author's own mutation run hit `erp_dev` (I-5). I can only see that the script as written would.
- Doc 69's fidelity to REV-066's original hand-back.
- Playwright: T43 has no UI.

## Clean-up

- Revoked `erp_user`'s grant on `rev067` and dropped the schema. `SHOW GRANTS` lists only `erp_dev`.
- Removed the worktree `/private/tmp/erp-rev-067` with `git worktree remove --force` and pruned. It was clean first: every mutant was restored by the harness, and my scratch copies (`_old_`, `_chunked_`, `_yield_`, `_r1_`, `_r8_`) were deleted before the test runs and again before removal.
- Deleted `/private/tmp/r67`: probes, fuzzer, the harness copy, env copy and outputs.
- No `supplier-import-*` directories are in `$TMPDIR`. The mutation process has exited. My background waits and monitors have ended.
- t43, its `node_modules`, and `erp_dev` were not touched. I made no commits, pushes or PR comments.

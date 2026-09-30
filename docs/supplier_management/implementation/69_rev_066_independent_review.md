# REV-066: TASK-043 remediation after REV-065 (PR #167), independent review

Reviewer: REV-066, an independent agent using the security-auditor persona. I did not write this code, REV-064, REV-065 or any earlier review.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The text below is the reviewer's, unchanged apart from this note.

- **Merge candidate:** 7fd45cc8d67ffd7840ca43ff4748a0dfed0e8f43 on `claude/supplier-task-043`. `gh pr view 167` shows it as the head, OPEN and MERGEABLE, and `git ls-remote` shows the same head. `gh pr checks 167` shows all five checks green: Playwright, Build frontend, Dependency audit, Lint, and Test (server + client, MySQL).
- **Base:** origin/main dd36250819b80cb679c688bc8a893e694119f66a. Main had not moved when I checked.
- **Commits reviewed:** 88c9550, d4595a2, b33aa09, and the merge 7fd45cc (lockfile only). I also re-checked the whole PR against dd36250 wherever the remediation touches it: the upload path, the processor, the service, the tests, the docs and the ledger.
- **Where I worked:**
  - A detached worktree at `/private/tmp/erp-rev-066`, with `node_modules` symlinked to t43's.
  - A private schema `rev066` on 127.0.0.1:3443, migrated as admin with `scripts/migrate.js`. I never touched `erp_dev`.
  - Scratch files and probes under `/private/tmp/r66`. A probe integration file sat in the worktree only while the probes ran; I moved it out before the mutation runs.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |
| Info | 6 |

**Disposition: APPROVED WITH CONDITIONS.**

REV-065 M-1 is closed. No byte sequence I could build gets past the upload check with a header that precheck refuses, or with a Bank column in the header that precheck reads. That holds over 170,072 differential inputs plus directed cases, with 0 divergences in the unsafe direction and 0 legitimate files refused.

**One condition: M-1 (new) must be fixed before merge, or the Product Owner must decide to carry it.** The upload header check is not bounded in cost:
- A 10 MB file of commas makes `uploadHeaderError` build a first record of about 10.4 million empty fields.
- That blocks the API event loop for about 1.3 s per request.
- The flaw has existed since 6b5437c (REV-064's upload check parsed the same way). d4595a2 did not introduce it.
- HD-054 now makes this function the gate that every upload passes through, and the brief asked whether it is bounded. It is not.

### What I ran

| Command | Result |
| --- | --- |
| `npx eslint .` | exit 0 |
| Full server suite, `node --test --test-concurrency=1`, Bank keys set, `DB_NAME=rev066` | 2,390 tests: 2,381 pass, 0 fail, 9 skipped |
| Author's `mut43.py`, copied, `ROOT` set to my worktree, `DB_NAME=rev066` exported after `env43.sh`, serial, baseline first | Baseline PASS. **79 of 81 killed.** The survivors are #63 (`isFile()` removed) and #64 (read-side size check removed), the same two equivalent mutants as before. This matches the doc. |
| 9 mutants of my own (§3), same harness | 6 killed, 3 survived. None of the survivors weakens a security property today. |
| Differential fuzzer: `uploadHeaderError` against `precheckSupplierCsv`, with the header each one reads, on the same bytes | 170,072 inputs from 4 seeds plus 18 directed cases: **0 bad** (details under REV-065 M-1 below) |
| Probes P1 to P3 on real MySQL and a real import root, using the integration harness | See the findings and §4 |

## 1. Findings

### M-1 (Medium): the upload header check has no cost bound; a file of commas blocks the API event loop for about 1.3 s per request

**Location:**
- `server/src/modules/supplier/import/SupplierImportProcessor.js:72` defines `CSV_OPTIONS`.
- `SupplierImportProcessor.js:99` calls `parseSync(text, { ...CSV_OPTIONS, to: 1 })`.
- `SupplierImportProcessor.js:105` runs `headerNames` and `headerError` over every field.
- `server/src/modules/supplier/SupplierImportService.js:170` calls the check synchronously in the request.

**Mechanism (verified by reading csv-parse 7.0.2 and by measurement):**
- `to: 1` stops after the first record delimiter. It does not help when the first record is the whole file.
- `max_record_size` compares `record_length + field.length` against 65,536. `record_length` adds up field *content* only (`lib/api/index.js:417`, `:730`). Delimiters and empty or quoted-empty fields add 0, so the limit never trips.
- The upload therefore:
  - decodes 10 MB;
  - copies it to a Buffer (`sync.js` runs `Buffer.from` on the whole string);
  - pushes about 10.4 million `""` fields into one array;
  - maps them through `trim`, then checks them for duplicates.

  All of this is synchronous, on the request thread.

Measured on `uploadHeaderError` directly, with warm runs:

| Input (10 MB) | Time | Result | RSS |
| --- | --- | --- | --- |
| `,` repeated | 1,313 to 1,342 ms | `HEADER_DUPLICATE` | +250 to 500 MB |
| `"",` repeated | 1,264 to 1,292 ms | `HEADER_DUPLICATE` | |
| 10 MB of `\n` | 67 ms | `CSV_EMPTY` | |
| A valid file of 10 MB | 3 ms | accepted | |

The 6b5437c-style check gives the same result on the comma input: 1,330 ms. So the flaw predates this remediation.

End to end over HTTP (probe P1):
- A `supplier.mgmt` user sent three parallel uploads of 10,400,000 commas. Each got a 400 with `SUPPLIER_IMPORT_HEADER_DUPLICATE`, and the three took 4.6 s together.
- `monitorEventLoopDelay` max was **1,536 ms**.
- A concurrent `GET /api/v1/supplier-imports/template` peaked at **1,496 ms**; its median was 14 ms.
- A control upload of a valid file showed 0 ms delay.

**Impact:**
- Availability of the whole API process, for every user.
- The limiter allows 20 requests per second per IP. There is no per-user upload quota (REV-064 I-7, carried).
- About one 10 MB request per second from one account keeps the event loop mostly blocked.
- Exploiting it needs an authenticated `supplier.mgmt` user, and nothing is exposed, hence Medium.
- Precheck's streaming parse of a valid header followed by a comma-flood row took 370 ms and 403 MB RSS in isolation. I did not observe a long event-loop stall on that path, and I did not investigate it further.

**Recommended fix:** cap the field count inside the parser, in the shared options, so that upload and precheck stay identical. A `cast` that throws a `CsvError` is enough:

```js
const MAX_FIELDS = 256; // keep it above the template's column count, so a Bank column still gets its own code
const CSV_OPTIONS = Object.freeze({ bom: true, skip_empty_lines: true, max_record_size: 65_536,
  cast: (value, { index }) => { if (index >= MAX_FIELDS) throw new CsvError("CSV_TOO_MANY_FIELDS", "too many fields", {}); return value; } });
```

- I verified the mechanism in a scratch script against csv-parse 7.0.2. The same 10 MB comma input fails with `CSV_TOO_MANY_FIELDS` in **3.7 ms** at upload and in about 1 ms in the streaming parser.
- The error is `instanceof CsvError`, so both callers already map it to `SUPPLIER_IMPORT_CSV_MALFORMED`.
- Add a unit test that a 10 MB comma file is refused well under 100 ms.
- The cap has to exceed the template's column count. Otherwise a file with the template plus a Bank column would report `MALFORMED` instead of `BANK_COLUMN_FORBIDDEN`, which the existing parity test would catch.
- An alternative is to parse only a bounded prefix for the header and refuse if no complete record fits. It diverges from precheck only in the fail-closed direction, but the `cast` cap is smaller and also bounds precheck rows.

### Info

- **I-1: I-4's index seek is correct but not pinned.**
  - My mutant R3 reverts to `identifier_value_key IN (?)`, and every test still passes. That is expected, since the outcome is the same and only the plan differs.
  - Verified on 20,000 identifiers (P3):
    - 3, 500 and 1,000 tuples give `Covering index range scan on supplier_identifiers using uq_supplier_identifier_value`, with rows equal to the tuple count;
    - every tuple is found;
    - mysql2 formats the nested array as `(('tax','HK','…'),…)`;
    - quote-injection values (`x') OR 1=1 -- `, `\' OR '1'='1`) are escaped and match nothing.
  - Leaving this unpinned is acceptable. Note it if performance tests are added.
- **I-2: the identifier dedup key is not tested.**
  - My mutant R2 keys `identifierKeys` by value only. Two rows in one batch with the same value but a different type or country would then query only one tuple, so a taken identifier could be missed at precheck.
  - It survives. The unit fake returns `identifiers` whatever the params, and the integration tests use one type.
  - The current code is correct, and T45 would still hit the unique key at execution.
  - A two-type case in `supplierImportPrecheck.test.js`, with a fake that honours params, would pin it.
- **I-3: the parity test is a fixed case list.**
  - My mutant R7 makes the upload trim ASCII spaces only, and it survives. It diverges only in the fail-closed direction: a tab or NBSP around a name is refused at upload but accepted at precheck.
  - Upload and precheck share `headerNames`, so this cannot happen in the current code.
  - A small property test over generated prefixes, BOMs, quotes and line ends would guard the invariant better than ten hand-picked cases. My fuzzer was about 100 lines.
- **I-4: the mutation record's wording.**
  - The count "81 mutants, 79 killed" is right: 74 + 7 new.
  - But "New since the REV-064 round" lists nine items. Two of them, "upload stores a file with a bad header" and "header names not trimmed", are the REV-064 round's "Bank-column file stored at upload" and "upload header check not trimming", re-pointed at the new code.
  - This is the same reconciliation issue as REV-065 I-2.
  - Separately, doc 62's claim that "a mutant that reintroduces the per-row fuzzy lookup is killed" holds: #76 was KILLED in my run.
- **I-5: `next_safe_action` in revision 259 is stale.** It says "PR #169 (HD-056) must merge before #167's Dependency audit can pass". #169 is merged (dd36250), merged into the branch (7fd45cc), and the audit is green. Refresh it at the next ledger write.
- **I-6: the header check runs before the actor-freshness check** (`authorize` inside the transaction, `SupplierImportService.js:170-176`).
  - This ordering predates the remediation.
  - A user whose JWT still claims `supplier.mgmt` after the database revoked it:
    - gets header-validation answers (fixed messages, column index only) instead of `PERMISSION_STALE`;
    - with a valid-header file, has that file written and then deleted when `authorize` fails.
  - Since HD-054 such a file cannot hold a Bank column. No exposure.

## 2. Status of REV-065 findings

| REV-065 | Status | Basis |
| --- | --- | --- |
| M-1 | **Closed** | See "How I verified M-1" below the table. |
| L-1 | **Closed** | The 10,000-row test now seeds real grams via `hashNameBigrams`. Mutant #76 (the per-row `SupplierDuplicateCandidates.find` put back) is KILLED. The new unit test counts every statement per batch: 1 row and 500 rows must give the same count, at most 3. The fake records a statement before it can throw, so the count is meaningful. My R4 (a cheap per-row exact-name query) is KILLED by it. |
| L-2 | **Closed** | The abandon test appends a row on each crashed attempt and asserts `rows(...) == []`. Author's #77 and my R9 (`DELETE` aimed at the wrong job) are KILLED. |
| L-3 | **Closed (decision)** | HD-055 (A) is recorded. HD-052's `affected_ids` now include BR-009, BR-026, §16.2 and TASK-051, and its `answer_ref` names the deviation. HD-057 is OPEN (MINOR) against TASK-051 for §16.2's similar-name exception list. |
| I-1 | Closed | The doc now says the SHA check, not `nlink`, covers a FIFO. |
| I-2 | Closed, with a residue in wording (I-4 above) | |
| I-3 | Carried to T44 | Doc 62 has the new obligations table: attempt counting on `version`, and outage behaviour. |
| I-4 | Closed in code | Verified range seek; not pinned (I-1 above). |
| I-5 | Closed | HD-056 (A) and PR #169 merged. The Dependency audit is green on 7fd45cc. |

**How I verified M-1:**
- Upload and precheck share `CSV_OPTIONS`, `decodeUtf8` and `headerNames`.
- The upload check applies `headerError` in full and refuses non-UTF-8, `CsvError`, and no-record input.
- Differential fuzzer. Random prefixes of BOM, CR, LF, CRLF, `\r\r\n`, `\n\r`, spaces, tabs, NUL, 0xFF, a truncated 0xC3, U+2028, NBSP, U+3000, ZWSP, `#`, `"` and `""`. Header variants: an IBAN column, a quoted multi-line `"Bank\r\nAccount"`, all fields quoted, padded names, embedded newlines in quoted names, a BOM inside the first name, ZWSP or NBSP around names, and reversed column order. Rows that are short, have stray quotes or contain NUL. Findings:
  - **0 cases** where the upload accepted and precheck refused at header level (Bank, unknown, missing, duplicate, not UTF-8, no header).
  - **0 cases** where the first record from the streaming parser differed from `parseSync({ to: 1 })`'s.
  - **0 accepted files** whose streaming header was not a template header.
  - **0 cases** where the upload refused something precheck would accept.
  - The only code differences are the documented ones: upload says `BANK`, `DUPLICATE` or `UNKNOWN` where precheck first hits a later row's column-count error (`MALFORMED`).
- Directed cases:
  - UTF-16LE or BE with a BOM gives `NOT_UTF8` at both. Over HTTP, the framework's MIME sniff refuses it first with 415.
  - UTF-16LE without a BOM is refused at both.
  - Double BOM plus Bank gives `BANK` at both.
  - CR-only line ends are refused at both.
  - A NUL in a header name gives `UNKNOWN` at both.
  - A valid header followed by a malformed row is accepted at upload and `MALFORMED` at precheck: stored, then purged, with no Bank header.
  - A valid BOM file with an invalid UTF-8 byte 5 MB later gives `NOT_UTF8` at both, because the fatal decoder scans the whole file.
  - Headers of 65,535, 65,536 and 65,537 characters behave the same at both.
  - 100,000 leading CRLFs plus Bank gives `BANK` at both.
- `to: 1` stops at the first record delimiter. The whole-file costs are the fatal decode and a Buffer copy; the field-count case is M-1.
- Mutation: #70 to #75 KILLED; my R5 (whole-file parse), R6 (shared options without `skip_empty_lines`) and R8 (check after write) KILLED.
- HTTP probe P2: a leading-CRLF template-plus-IBAN file returns 400; no request or system log, response or stored source holds the IBAN.

## 3. Mutants (mine, serial, against `rev066`, baseline passed)

| # | Mutant | Result |
| --- | --- | --- |
| R1 | Identifier tuple built as (country, type, key) | Killed |
| R2 | Identifier dedup key ignores type and country | **Survived** (I-2) |
| R3 | Identifier lookup by value key only (I-4 reverted) | **Survived**, equivalent in outcome (I-1) |
| R4 | A per-row exact-name query added to `flush` | Killed (the query-count unit test) |
| R5 | Upload parses the whole file (no `to: 1`) | Killed |
| R6 | Shared `CSV_OPTIONS` lose `skip_empty_lines` | Killed |
| R7 | Upload trims ASCII spaces only | **Survived**, fail-closed direction only (I-3) |
| R8 | Upload check moved after the file is written | Killed |
| R9 | Abandoned-job row `DELETE` aimed at another job | Killed |

## 4. What held

**Upload API contract (focus 2):**
- A 400 is not cached by idempotency. `IdempotencyService` calls `fail()` for thrown errors, and `cacheableStatusCodes` is `[200, 201, 202, 204]`.
- P2 confirmed it:
  - the same key and the same bad file give 400 twice, with two request IDs, so the second was re-executed rather than replayed;
  - the same key with a corrected file then gives 201.
- The handler still zero-fills the buffer in `finally`.
- The existing HTTP test still gets 201, replay, 409-class errors, 403 and a MIME refusal.
- The unit tests were adjusted only to use a valid header where they had used arbitrary bytes.
- Design §6.11 lists no `SUPPLIER_IMPORT_*` codes. That predates this PR (REV-064 I-2 carried the stale table), so it is not new.

**H-1 (no file, SQL or cell text reaches the scheduler, logs, job stats, audit or responses):**
- The new upload error path returns only fixed messages, or messages with a column index or template name.
- It rethrows only non-`CsvError`s. None occurred in 170,000 fuzz inputs.
- P2 found no IBAN in the logs or responses, for a stray quote, UTF-16, or a leading-CRLF Bank file.
- The worker and scheduler paths are unchanged since REV-065, and mutants #10, #59 and #81 are killed.

**H-2 and scale (P3):**
- 10,000 upsert rows against 20,000 Suppliers, each with real name grams and an identifier, took **320 ms** and ended `ready_with_errors`.
- The row counts were exactly as expected:

  | Rows | Operation | Result |
  | --- | --- | --- |
  | 2,000 | update | valid |
  | 1,000 | create | `NAME_EXISTS` warning |
  | 500 | create | `IDENTIFIER_TAKEN` error |
  | 6,500 | create | valid |

- The Supplier tables were unchanged (IMP-004).

**Other guarantees, confirmed by the author's harness (79/81) plus the full suite:**
- attempt bound: #59 to #61, R9;
- failed-precheck purge: #78 to #80;
- file safety: 0600, `O_EXCL|O_NOFOLLOW`, `nlink`, SHA; #50 to #55;
- request log `[FILE_TRANSFER]` on a 5xx: #81;
- zero writes to Supplier tables;
- lease and claim rules: #32 to #36;
- T42 execution and HD-049's finalize check: #41 killed; the execution integration file passes.

**Docs and ledger (revision 259):**
- REV-065 is recorded as `CHANGES_REQUESTED` with 0 open Highs. The ledger's review enum is only APPROVED or CHANGES_REQUESTED, and M-1 was a must-fix, so that is consistent.
- HD-054, HD-055 and HD-056 are ANSWERED ("全部 A"). HD-057 is OPEN against TASK-051. HD-052's affected IDs are updated.
- The T44 and T51 obligations are in doc 62, the same place as earlier carry-forwards.
- DEF-023's corrected text ("since HD-054 … a Bank-column file is never stored") is true according to the fuzzing above.
- The M-1 and I-4 rows in doc 62 are accurate. Doc 62's "every stored file has a valid v1 header" is also true. Note that valid includes names that trim to template names: a quoted `"supplierId\r\n"` passes at both ends.

## 5. What I could not verify

- The precheck-side cost of a comma-flood data row in the running scheduler. I measured the processor in isolation only: 370 ms and 403 MB, with no long loop stall seen.
- The `reviewed_baseline` hash of the REV-065 entry. I did not recompute the PLAN baseline.
- Playwright: T43 has no UI.
- The ledger's REV-066 entry: it does not exist yet, which is correct.

## Clean-up

- Revoked `erp_user`'s grant on `rev066` and dropped the schema. `SHOW GRANTS` now lists only `erp_dev`.
- Removed the worktree `/private/tmp/erp-rev-066` with `git worktree remove --force` and pruned. It was clean before removal: every mutant was restored from saved bytes, and the probe file was moved out.
- Deleted `/private/tmp/r66`, which held the fuzzer, probes, mutation copies and outputs, some with the test IBAN.
- No `supplier-import-*` directories remain in `$TMPDIR`.
- Stopped the one process I left running, a `tail` for the monitor, by PID. The harness and test runs had all exited.
- t43, its `node_modules` and `erp_dev` were not touched. I made no commits, pushes or PR comments.

# REV-060: TASK-041 remediation after REV-059 (PR #162), independent review

Reviewer: an independent agent (REV-060). I did not write this code, and I did not write REV-059.

- **Merge candidate:** 00532a5016773a6929ee427b9476c3f2b5722453 on `claude/supplier-task-041`. `gh pr view 162` reports this as the head.
- **Base:** origin/main 894cdc6. I checked `git ls-remote` during the review, and main had not moved.
- **Remediation reviewed:** 843ac57..00532a5. That is a220f8f (the code fix), 57a442d (ledger revision 248), 298f8aa (HD-040) and 00532a5 (revision 249). I also re-checked the whole PR, 894cdc6..00532a5.
- **Where I worked:** a detached worktree at `/private/tmp/erp-rev-060`, with `node_modules` symlinked from the main checkout.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 7 |

Disposition: **APPROVED**.

**Both Mediums are closed.**

- **M-1.** The job-name test now claims only what it proves. The deferred obligations are written down, precisely enough to act on.
- **M-2.** The CSV guard now reads every manifest `source_paths` directory, including `.vue` files and directories that do not exist yet. I planted files to check this; a plant in `.vue` and one in a not-yet-created `supplier-imports` both turn the guard red.

**REV-059's surviving mutants are now killed.**

- M01 (the `dev` check) is killed through the injected `lstat`.
- M04 (all three attachment roots ignored) and M07 (the `$` anchor) are killed.
- M09 (entropy) still survives, as accepted.

**HD-040 is implemented soundly.**

- Item directories are compared after the same lexical normalisation, because `path.relative` resolves both sides.
- The real entrypoint refuses a Supplier root that overlaps Item's default relative directories, and accepts a sibling root under `server/storage`.

**Ledger and CI.**

- Revisions 248 and 249 replay byte-for-byte through `state_tool.py checkpoint`, 248 with its `--mode-change-ref`.
- Without that ref, the tool refuses revision 248 (negative control).
- CI is green on the head.

**The three Lows are residuals and can be follow-ups. None is a runtime risk in T41, because nothing consumes these helpers yet.**

- **L-10.** The only durable pointer to the carry-forward doc is `next_safe_action`, and that field is overwritten at every checkpoint.
- **L-11.** The guard regex still misses `split(",", n)`, `split(sep)` and `split("\r")`. It also does not scan `client/src/services/supplier*.js`.
- **L-12.** The `tempRoot` attachment root is still not pinned on its own.

### What I ran, and on what

- **T41 set.** `node --test --import ./test-support/testEnv.js test/supplierImportConfig.test.js test/configuration.test.js test/supplierConfig.test.js` gives **20/20**. REV-059 counted 19; the new HD-040 test is the 20th.
- **Full `npm test` in `server/`**, with integration tests off: 2256 tests, **1917 pass, 0 fail, 339 skipped**. This matches the author's claim.
- **Lint and audit.** `npm run lint` exits 0. `npm audit --audit-level=high` exits 0.
- **CI.** `gh pr checks 162`: all five jobs pass. `gh run view 36516152838` gives `headSha` 00532a5, event `pull_request`, conclusion `success`. That run includes the MySQL-integration job, which took 6m14s.
- **`state_tool.py inspect docs/supplier_management --repo-root . --json`** returns `BLOCKED`. The only issues are `WORKTREE_CHANGED` (it is my worktree), `COMMIT_CHANGED` and `SOURCE_CHANGED` (see I-14).
- **`validate_module_boundary.py docs/supplier_management --repo-root . --base 894cdc6 --json`** returns `LOCAL_CHECKS_PASS`.
- **Ledger replay.** I restored revision 247 (from 843ac57) and fed revision 248 through `state_tool.py checkpoint --expected-revision 247`. The next-file was the committed 248, with `revision` set to 247 and MODE-CHANGE-248 removed; the `--mode-change-ref` was the committed `source_ref`.
  - Result: `RECORDED 248`, and the output **equals the committed revision 248**.
  - Revision 249 replayed the same way, with no ref: `RECORDED 249`, equal to the committed 249.
  - **Negative control:** revision 248 without `--mode-change-ref` gives `BLOCKED` (`STATE_ERROR`: mode entry baseline cannot be rewritten).
  - The ledger file was restored and checked by SHA-256.
- **The real entrypoint.** I ran `node src/index.js` against a throwaway mysqld I started myself: `/usr/local/mysql/bin/mysqld`, scratch datadir `/private/tmp/rev060-mysql`, port 39258, `log_bin_trust_function_creators=1`, and every migration applied with `scripts/migrate.js`. The app listened on `APP_PORT=39259`. `S` below is the server directory.

  | `SUPPLIER_IMPORT_ROOT` / Item env | Result |
  | --- | --- |
  | unset | `API listening` |
  | `/private/tmp/rev060-sup` | `API listening`; no directory created |
  | `/` | `CONFIGURATION_INVALID … must not be a filesystem root` |
  | `//` | same refusal |
  | `/tmp/..` | same refusal |
  | `S/storage` (contains Item's default `storage/items` and `storage/imports`) | refused: `… or an Item media or import directory` |
  | `S` itself | refused (same message) |
  | `S/storage/items/sup` (inside the default relative media dir) | refused |
  | `S/storage/supplier-imports` (a sibling) | `API listening` |
  | root `/private/tmp/rev060-sup` with `ITEM_MEDIA_DIRECTORY=/private/tmp/rev060-sup/source` | refused |
  | root `/private/tmp/rev060-sup` with `ITEM_IMPORT_DIRECTORY=/private/tmp/zz/../rev060-sup/` | refused. Item keeps an absolute path unresolved, but `path.relative` normalises it |

- **Mutation sweep.** I ran 32 source mutants against the T41 set, with byte-exact restore and a SHA-256 check after each one. See §3.
- **CSV-guard probes.**
  - I ran 13 planted files against `supplierImportConfig.test.js`; see §3.
  - I ran the regex offline against 38 samples.
  - I tried three manifest edits: a typo, dropping five handler globs, and dropping the client globs. The manifest was restored afterwards.
- **Scripts.** They are in the scratchpad under `rev060/`: `mut.py`, `plant.py`, `regex.mjs` and `boot.sh`.

### Restoration

- I committed nothing, pushed nothing and commented on nothing. I did not touch `/Users/sam/Documents/workspace/erp-app` or `…/erp-app-worktrees/task-041`.
- Every mutated or edited file (sources, manifest, ledger) was restored from saved bytes. Its SHA-256 was checked after each run. Planted files and planted directories were deleted after each run.
- `git status` in the worktree was clean before removal, apart from the ignored `node_modules` symlink and `server/logs/`.
- **Processes.** I stopped only my own mysqld, by PID 58613. Each booted `node src/index.js` was killed by its own PID in `boot.sh`, or exited on its own after refusing to start. I used no `pkill`. Nothing was listening on 39258 or 39259 afterwards.
- **Scratch data.** `/private/tmp/rev060-mysql` was deleted.
- **Worktree.** The worktree was removed with `git worktree remove --force`; `--force` was needed only because of the ignored files. Afterwards the main checkout's `node_modules` was intact (347 entries).

---

## 1. REV-059 findings: status

| ID | Status | Evidence |
| --- | --- | --- |
| M-1 | **Closed**, with a residual (L-10) | The test is renamed to "three distinct, valid job names" and no longer drives `normalizeSchedulerConfig`. M18 is still killed. `62_task_041_carry_forward.md` names each obligation, its task and its source; every M-1 item is present, with a testable wording. The reasoning for not editing `05` is correct: `harness_core.py:307` hashes `manifest`, `traceability` and `specs`, and `specs.plan` is `05_development_tasks.md`. |
| M-2 | **Closed** for everything REV-059 asked, with residuals (L-11, I-8, I-9) | Plants in a `.vue` file and in a not-yet-created `handlers/supplier-imports` both turn the guard red. `split(/,/)` and `split("\n")` are caught. The scan reads 57 files. |
| L-1 | **Partly closed** (L-12) | M04 (all three) is killed, and so are M04g (generalRoot only) and M04b (bankSensitiveRoot only). **M04t (tempRoot only) survives.** |
| L-2 | Closed | M07 is killed by the "traversal after the name" case. |
| L-3 | Closed | M01 is killed by the injected `lstat`. N10 (the injected `lstat` ignored for the kind directory) is also killed, so the fake really reaches the check. |
| L-4 | Closed | N08 (listing root not resolved) is killed by the `linked-root/` and `linked-root/.` cases. The same line in `supplierImportFilePath` has no effect (I-10). |
| L-5 | Carried to T42 | Carry-forward row 3 covers `realpath` plus `dev`/`ino` over every root, including Item's. |
| L-6 | Carried to T48 and T42 | Carry-forward rows 2 and 9. The wording matches REV-059's recommendation. |
| L-7 | `/` closed; world-writable roots carried to T42 | N05 and N06 are killed. The entrypoint refuses `/`, `//` and `/tmp/..`. |
| L-8 | Closed | `default_commit` and `mode_entry_commit` are 894cdc6, and `worktree` is `task-041`. The change was made through a mode-change ref, which the replay confirms. See I-14 for the two fields it left behind. |
| L-9 | Closed | `next_safe_action` carries DEF-023, DEF-024, TC-133/OPS-006 and HD-036 §2. DEF-023 is also a T43 row in the carry-forward doc. |
| I-1 | Resolved by HD-040 | N01, N02 and N03 are killed, and the entrypoint refuses overlaps. |
| I-2 | Accepted | M09 still survives. |
| I-3 | Unchanged | Info only. |
| I-4 | Unchanged | M05 is still an equivalent mutant. The helper is still duplicated. |
| I-5 | Addressed as far as it can be | `answer_ref` now spells out B(1) and C, labelled "Added at revision 248 after REV-059 I-5". This is still the author's account of the chat, not the Product Owner's words. |
| I-6 | Stored-name half carried (T44/T45 row); **hard-link half not carried** | See I-12. |
| I-7 | Unchanged | Pre-existing. |

## 2. New findings

### L-10 (Low): the carry-forward doc is reachable only through fields that get overwritten

**Where:**

- `docs/supplier_management/00_harness_state.json:4936` (`next_safe_action`);
- `server/src/services/supplierImport/supplierImportFiles.js:47` and `server/test/supplierImportConfig.test.js:147` (comments);
- `docs/supplier_management/implementation/62_task_041_carry_forward.md`.

**The doc is an adequate carrier.** Every row names a task, an obligation that can be checked, and a source. But nothing durable points a T42 or T48 implementer at it:

- It is not in `05`, and that is deliberate and correct.
- It is not in `08_traceability.json`, which is also covered by the plan hash.
- It is not in a ledger record. `tasks` is a list of IDs, with no per-task fields.

It is referenced only by:

- `next_safe_action`, which every checkpoint replaces. L-9 was exactly this field losing DEF-023 one revision after it was written.
- Two code comments, one of them in a test file.

**Failure scenario.** TASK-041 merges. The next checkpoint rewrites `next_safe_action` for T42. T42's implementer reads §T42 in `05`, which says nothing about the root requirement or `SUPPLIER_IMPORT_JOB_NAMES`. They write `SupplierImportWorkerService` with `static jobs` declaring its own string. The T41 test ("three distinct, valid job names") stays green. HD-039 (B)'s "T42 will require the root" goes undischarged.

**Mitigation, inferred:** T42 will almost certainly open `supplierImportFiles.js`, and the comment at :47 points to the doc. But that comment is about L-6/T48, not the T42 rows.

**Verified by:**

- `grep -rn 62_task_041_carry_forward docs server` finds exactly three hits: the ledger's `next_safe_action` and the two comments.
- Reading `state_tool.py:28-85`: `next_safe_action` is unconstrained.
- Reading `harness_core.py:301-308`: the plan hash.

**Recommendation** (cheap, and needs no PLAN edit): record the obligations as persistent ledger records that checkpoints must preserve. For example, add one `defects` or `observations` entry per receiving task, with `status: OPEN` and `source_ids: ["TASK-042", "docs/supplier_management/implementation/62_task_041_carry_forward.md"]`. The existing DEF-023 already uses this pattern. `state_tool.py` refuses to drop prior `defects` IDs, so the pointer cannot silently disappear. Alternatively, fold the rows into `05` at the next PLAN revision, which will happen anyway.

### L-11 (Low): the CSV guard misses common spellings, and one in-scope client path is not scanned

**Where:** `server/test/supplierImportConfig.test.js:167` (the regex) and `:178` (it scans only `scope.source_paths`).

**Failure scenarios.** Each was planted as a one-line file in `server/src/handlers/supplier-imports/`, a directory that does not exist yet, and run against `supplierImportConfig.test.js`. The guard **passes** with each of these:

| Planted | Guard |
| --- | --- |
| `line.split(",", 100)` (limit argument: the regex requires `\s*\)` right after the separator) | passes |
| `line.split(/,/, 5)` | passes |
| `const SEP = ","; line.split(SEP)` | passes |
| `text.split("\r")` (old-Mac line endings; the regex covers `\n` and `\r\n` only) | passes |
| `line.split(", ")` | passes |
| `line.split(String.fromCharCode(44))` | passes |
| `client/src/services/supplierImportZz.js` with `line.split(",")` | passes. `client/src/services/supplier*.js` is in `allowed_write_paths` but not in `source_paths` |

For contrast, these **fail the guard as intended**: `split(",")` in a new `supplier-imports` directory, in a `.vue` file, and in a template literal `` split(`,`) ``.

The offline regex check (`regex.mjs`) also shows these spellings are missed:

- `.split (",")`, with a space before the parenthesis;
- `["split"](",")`;
- `split(/\x2c/)` and `split(/\u002c/)`;
- `split(new RegExp(","))`;
- `split(/[/,]/)`, where a `/` inside a character class stops the regex-literal branch.

`split(os.EOL)` is missed too.

**Impact.** A lexical guard cannot be complete, and the realistic evasions (`split(",", n)` and `split(SEP)`) are exactly what a hand-rolled parser tends to write. What would actually enforce criterion 1 is a positive check once CSV code exists: T43 and T47 import `csv-parse` / `csv-stringify`, and a test drives a quoted-comma, quoted-newline fixture through the real handler.

**Recommendation:**

- Widen the separator match to allow a trailing `, <limit>`: `(?:\s*,\s*[^)]*)?\s*\)`.
- Add `\r`.
- Add `client/src/services/supplier*.js` to the scan.
- Carry "a quoted-comma / quoted-newline fixture through the real handler" to T43 and T47 in the carry-forward doc.

### L-12 (Low): the `tempRoot` attachment root is still not pinned on its own (L-1 residual)

**Where:** `server/test/supplierImportConfig.test.js:67` and `server/src/framework/configuration/applicationConfiguration.js:262`.

The attachment cases are:

- `/srv/att/general/supplier`, which only generalRoot catches;
- `/srv/att/bank`, which only bankSensitiveRoot catches;
- `/srv/att`, which all three catch.

No case is caught by `tempRoot` alone.

**Verified by:** mutant M04t, which deletes `customer?.attachment?.tempRoot` from `others`, **survives** the T41 set (20/20 pass). The M04g and M04b variants are killed.

**Failure scenario:** a refactor drops `tempRoot`. CI stays green, and `SUPPLIER_IMPORT_ROOT=/srv/att/temp/supplier` then boots. Customer's temp-file cleanup and the Supplier purge would share that directory.

**Fix:** add `"/srv/att/temp/supplier"` to the loop at :67.

### Info

- **I-8: the CSV guard has false positives.** Each of these planted files turns the guard **red**:
  - `String(req.query.status ?? "").split(",")` in `handlers/suppliers/`. Comma-separated filters are a common pattern; `normalizeSecurityConfig.js:87,102` and `passwordHash.js:44` use `.split(",")` for non-CSV lists.
  - `address.split("\n")` in a Supplier `.vue` file, which is ordinary multi-line display.
  - A comment that says "never use `line.split(",")`".

  None exists today; `grep` finds no `split(` in any Supplier path. But the test will block legitimate code, and its message ("CSV is parsed … never by splitting on commas") will not tell the author why. If this becomes a problem, an allow-comment or an ignore for comments would do; a positive check (see L-11) would be the better fix.
- **I-9: skipping missing directories hides a `source_paths` typo, and the floor weakens as the module grows.**
  - **Verified:** I renamed `supplier-imports/**` to `supplier-import/**` in the manifest and planted `split(",")` in `supplier-imports/`. The guard **passes**.
  - `allowed_write_paths` is a separate list, so the boundary validator would not notice either.
  - **The floor.** Today the scan reads 57 files against a floor of more than 50. Dropping five handler globs (8 files → 49) or the client globs (→ 43) does turn the guard red, so the floor currently discriminates. But it is an absolute number: once the module passes about 100 files, losing a whole server glob will no longer trip it.
  - **A sturdier check:** assert that every glob either exists or is one of an explicit, named list of not-yet-created directories (`supplier-imports`, `supplier-exports`).
- **I-10: `root = path.resolve(root)` in `supplierImportFilePath` (`supplierImportFiles.js:30`) has no effect.** The function never calls `lstat`, and `path.join` already normalises. Mutant N09 (line deleted) survives and is equivalent. The comment above it ("`root/` … 會令 lstat 跟住 symlink 走") describes the fix that matters, which is at `:52`, not this line. This is harmless; the line could be removed, or the comment corrected.
- **I-11: the injectable `lstat` is part of the exported API** (`supplierImportFiles.js:50`). A future caller that passes `{ lstat: stat }` would silently turn off both symlink refusals.
  - No production code calls `listSupplierImportFiles` today, and no caller can reach it from a request.
  - The fake in the test is faithful for what it tests. `Object.create(realStats)` keeps `isDirectory()` via the prototype and changes only `dev`, and only for `<root>/source`. N10 and M01 are killed, and N11 (the root through the real `lstat`) is equivalent in production.
  - T48 could keep the seam but make it clearly test-only, for example by naming it `{ lstatForTest }`.
- **I-12: the hard-link half of REV-059 I-6 is not carried.** The T44/T45 row covers "stored name from the job row" but not REV-059's observation that listing returns hard links, which let a read path serve content from outside the root. T44/T45 (read) and T48 (purge) should require `nlink === 1` or open with `O_NOFOLLOW` and `fstat` `dev`/`ino`. Add this to carry-forward row 7.
- **I-13: the overlap refusal does not name the directory that collides.** The message at `applicationConfiguration.js:271` is accurate, but it covers six possible directories (verified at boot). An operator who hits it has to compare six environment variables by hand, including Item's defaults, which are relative to the server directory. Naming the first matching key (for example, `ITEM_MEDIA_DIRECTORY`) would help. The one realistic "surprising" refusal I found is a Supplier root that is an ancestor of the server directory (`S` or `S/storage`). That refusal is correct under HD-039 (C), but it is exactly where a named key would save time.
- **I-14: the ledger baseline still records `code_commit` 761c0bd and the old `source_fingerprint`** (`00_harness_state.json:14-15`), while `mode_entry_commit` is now the newer 894cdc6. This is not wrong under the tool, because `checkpoint` never refreshes these fields. But `inspect` will report `COMMIT_CHANGED`/`SOURCE_CHANGED` for any worktree, and the baseline now describes a code commit older than its own mode entry. Refresh both at the next checkpoint, or record why they are left alone.

### HD-040: soundness notes (no finding)

- **Normalisation.** Item keeps an absolute path unresolved (`normalizeItemConfig.js:59-61,87-89`), and resolves a relative path against the server root. `path.relative` calls `path.resolve` on both arguments, so `..` segments, trailing slashes and relative defaults all compare correctly. I verified this at boot (the table above).
- **The message** matches the refusal, and N04 (old message) is killed by the new test.
- **False refusals.** A realistic root such as `.env.example`'s `/var/lib/erp/supplier-imports`, or a sibling `S/storage/supplier-imports`, boots. Refusals happen only for roots that contain the server's `storage` tree or sit inside Item's directories. These are overlaps under HD-039 (C)'s "contain or sit inside" rule, so they are correct by that decision.
- **Scope.** `applicationConfiguration.js` now reads `item` from the normalized config. That file is within APPROVAL-HD-039-SCOPE, and HD-040's answer authorises the extra reads. The boundary validator passes.

## 3. Mutants and plants

The source mutants were run against `supplierImportConfig.test.js`, `configuration.test.js` and `supplierConfig.test.js` (20/20 baseline). Each was applied as an exact single-occurrence replacement, and the file was restored and checked by SHA-256.

| # | Mutant | Result |
| --- | --- | --- |
| M01 | drop the `dev` check | KILLED |
| M02 | overlap: drop root-contains-other | KILLED |
| M03 | overlap: drop other-contains-root | KILLED |
| M04 | drop all three attachment roots | KILLED |
| M04g | drop generalRoot only | KILLED |
| M04b | drop bankSensitiveRoot only | KILLED |
| M04t | drop tempRoot only | **SURVIVED** (L-12) |
| M05 | drop `relative === ""` | survived, equivalent (I-4) |
| M06 | overlap call removed | KILLED |
| M07 | `STORED_NAME` without `$` | KILLED |
| M09 | 16-bit entropy padded to 64 hex | survived (accepted, I-2) |
| M18 | purge name = precheck name | KILLED |
| N01 | drop Item `mediaDirectory` | KILLED |
| N02 | drop Item `importDirectory` | KILLED |
| N03 | `item` not passed to the check | KILLED |
| N04 | old message (no Item wording) | KILLED |
| N05 | filesystem-root check removed | KILLED |
| N06 | filesystem-root check without `path.resolve` | KILLED (by `//`) |
| N07 | filesystem-root check as literal `=== "/"` | survived, equivalent on POSIX |
| N08 | listing root not resolved | KILLED |
| N09 | `supplierImportFilePath` resolve removed | survived, equivalent (I-10) |
| N10 | injected `lstat` ignored for the kind directory | KILLED |
| N11 | injected `lstat` ignored for the root | survived, equivalent in production (I-11) |
| N12 | default `lstat` → `stat` | KILLED |
| N13 | `dev` compare made vacuous | KILLED |
| A01 | relative root accepted | KILLED |
| A02 | root not normalised | KILLED |
| A03 | prefix match instead of containment | KILLED |
| A04 | listing `isFile()` filter off | KILLED |
| A05 | listing name filter off | KILLED |
| A06 | path builder kind check off | KILLED |
| A07 | `lstat` import swapped for `stat` | KILLED |

That is 32 mutants: 25 killed, 5 equivalent or accepted (M05, M09, N07, N09, N11), and 1 real survivor (M04t). The author's Round 1 and Round 2 lists and the two HD-040 mutants, as described in the carry-forward doc, are covered by M01, M04, M07, N01, N02, N05, N08, A01–A07, M02, M03, M06 and M18. All are killed, so the author's mutation record reproduces.

The CSV-guard plants (§2 L-11, I-8 and I-9) were run against `supplierImportConfig.test.js`:

| Plant | Guard |
| --- | --- |
| P01 `.vue` with `split(",")` | fails (correct) |
| P02 new `supplier-imports/` with `split(",")` | fails (correct) |
| P09 `` split(`,`) `` | fails (correct) |
| P03 `split(",", 100)` | passes (L-11) |
| P04 `split(SEP)` | passes (L-11) |
| P05 `split("\r")` | passes (L-11) |
| P06 `split(String.fromCharCode(44))` | passes (L-11) |
| P07 `client/src/services/supplier*.js` | passes (L-11) |
| P08 `split(", ")` | passes (L-11) |
| P10 `split(/,/, 5)` | passes (L-11) |
| FP1 query filter `split(",")` in `handlers/suppliers` | fails (false positive, I-8) |
| FP2 `split("\n")` in a Supplier `.vue` | fails (false positive, I-8) |
| FP3 comment containing `split(",")` | fails (false positive, I-8) |
| T1 manifest typo `supplier-import/**` plus plant | passes (I-9) |
| T2 drop 5 handler globs (49 files) | fails (floor works) |
| T3 drop client globs (43 files) | fails (floor works) |

## 4. What held

- **Criterion 1.** The lockfile half is unchanged from REV-059, where L1 and L2 were killed. The split guard now covers every manifest source directory, `.vue` files, directories not yet created, and both the string and regex forms (with the gaps in L-11).
- **Criterion 2.**
  - The root is optional, must be absolute, is resolved, and must not be a filesystem root (`/`, `//`, `/..`, `/tmp/..` are all refused, by test and at boot).
  - Names are 64-hex and anchored at both ends. A traversal before or after the name is refused.
- **Criterion 3, the filesystem half.**
  - A symlinked root is refused in all three spellings: `x`, `x/` and `x/.`.
  - A symlinked kind directory is refused.
  - A kind directory on a different `dev` is refused, now by an automated test.
  - Symlinked files, subdirectories and non-hex names are not listed.
- **Criterion 3, the scheduler half.** This is honestly reduced to "three distinct, valid names". The binding to the services is carried to T42 and T48.
- **HD-039 (C) and HD-040.** Overlaps with Customer import, general, bank and Item media/import are refused in both directions. tempRoot is refused too; I verified that by reasoning from the `/srv/att` case, but it is not pinned (L-12).
- **Ledger honesty against git.**
  - Revision 248 (57a442d) comes after the code fix (a220f8f), so "remediated on the branch" was true when it was written. One wording issue: 248 says "L-1..L-4 remediated", and L-1 is only partly remediated (L-12).
  - REV-059 is recorded as CHANGES_REQUESTED, with 0 critical and 0 high.
  - HD-040 was OPEN at 248 (BLOCKED, resume IMPLEMENTING) and ANSWERED at 249 (IMPLEMENTING).
  - "Two mutants killed" is confirmed by N01 and N02.
  - The baseline correction goes through MODE-CHANGE-248, and the replay confirms it was tool-shaped.
- **Regressions.** The full suite, lint, audit, CI on the head, and the real entrypoint booting with and without a root (with MySQL) are all green.

## 5. What I could not verify

- **The Product Owner's words.** I cannot verify HD-040's "a", or the wording of the HD-039 recommendations added under I-5. They exist only in the chat.
- **Order of events.** The HD-040 code commit (298f8aa, 11:12:27) comes 24 seconds before the ledger records the answer (00532a5, 11:12:51). The ledger said BLOCKED on HD-040 at revision 248. That the answer came before the code is plausible, but I inferred it; git cannot show it.
- **Windows and other platforms.** I did not run Windows paths or UNC roots. That `path.parse(...).root` refuses `C:\` and `\\server\share\` on win32 is inferred from Node's documentation, not run. Linux and case-insensitive overlap cases are still carried (L-5) and were not run.
- **Integration tests.** I did not run the 339 integration tests locally. CI ran them green on 00532a5.
- **ItemMediaCleanupJob.** I did not run it deleting Supplier files under an overlap. The refusal makes that path unreachable at startup; the danger itself is still inferred, as in REV-059 I-1.

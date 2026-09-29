# REV-059 — TASK-041 import config, controlled root and file naming (PR #162), independent review

Reviewer: an independent agent (REV-059). I did not write this code. The merge candidate is
843ac5788e06ebe9fb44bb3cfc6bb839e44915c0 on `claude/supplier-task-041`, and the base is origin/main 894cdc6.
I re-fetched origin/main during the review and it had not moved. I reviewed 805423e (code) and 843ac57
(ledger revision 247). I worked in a detached worktree at `/private/tmp/erp-rev-059`, with `node_modules`
symlinked from the main checkout. Git ignores the symlink.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 9 |
| Info | 7 |

Disposition: **CHANGES_REQUESTED**.

The code does what it claims, and I verified the parts that matter by running them:

- The listing never follows a symlink.
- The `dev` check works. I tested it against a real second filesystem, which the author could not do.
- The overlap check refuses every lexical overlap in both directions.
- The real entrypoint boots against MySQL both with and without `SUPPLIER_IMPORT_ROOT`.

The two Mediums are about acceptance, not about the code being wrong:

- **M-1.** Two of the three acceptance criteria are delivered only as names and helpers that nothing consumes yet. The deferred obligations are not written into T42 or T48.
- **M-2.** The CSV `split` guard does not look in the directories where the CSV handlers will be written.

Both fixes are cheap. Three of the Lows (L-1, L-2, L-4) are one-line test or code changes and fit in the same round.

### What I ran, and on what

- **T41 set.** `node --test --import ./test-support/testEnv.js test/supplierImportConfig.test.js test/configuration.test.js test/supplierConfig.test.js` gives **19/19**. The task's literal command, `npm test --workspace server -- test/supplierImportConfig.test.js test/configuration.test.js`, gives **15/15**. The author's "19/19" is the three-file set, so the numbers agree.
- **Full `npm test` in `server/`**, with integration tests off: 2255 tests, **1916 pass, 0 fail, 339 skipped**. This matches the author exactly.
- **Lint and audit.** `npm run lint` exits 0. `npm audit --audit-level=high` exits 0; it reports 4 moderate issues (vitest and undici), which are pre-existing because this PR does not touch the lockfile.
- **CI.** `gh pr checks 162` shows all five jobs passing on head 843ac57, including the job that runs MySQL integration.
- **The real entrypoint.** I booted `node src/index.js` against a throwaway mysqld (scratch datadir, port 39158, migrations applied with `scripts/migrate.js`) on `APP_PORT=39159`:
  - `SUPPLIER_IMPORT_ROOT=` (empty): `API listening on http://127.0.0.1:39159`.
  - `SUPPLIER_IMPORT_ROOT=/private/tmp/rev059-sup`: `API listening`. No directory is created, which is right for T41.
  - `SUPPLIER_IMPORT_ROOT=var/sup`: `CONFIGURATION_INVALID … "import.root" must be an absolute path`.
  - `SUPPLIER_IMPORT_ROOT=/srv/erp/ci/sub` with `CUSTOMER_IMPORT_ROOT=/srv/erp/ci`: `CONFIGURATION_INVALID … must not contain, or sit inside, a Customer import or attachment root`.
- **`state_tool.py inspect docs/supplier_management --repo-root . --json`** returns `BLOCKED`. The only issues are `WORKTREE_CHANGED`, `COMMIT_CHANGED` and `SOURCE_CHANGED`, as expected.
- **`validate_module_boundary.py`** returns `LOCAL_CHECKS_PASS` with `--base 894cdc6`, and also with `--base 761c0bd`, which is the ledger's recorded `default_commit`.
  - **Negative control:** I removed APPROVAL-HD-039-SCOPE from the ledger and kept everything else. The result is `BLOCKED`, with `SCOPE_APPROVAL_REQUIRED` for `server/config/supplier.js` and for `applicationConfiguration.js`. So the approval is what makes the check pass.
  - `server/.env.example` is not flagged even without HD-039, because the standing approval APPROVAL-HD-030-SCOPE-REBIND-2 also covers it.
- **The `dev` check on a real second filesystem.** I ran `hdiutil create -fs HFS+` and then `hdiutil attach -mountpoint <root>/source`:
  - Unmodified code: `source REJECTED: Supplier import directory must be on the root's filesystem`, and `result listed 1`.
  - Mutant M01 (check removed): `source listed 1`.

  So the check does discriminate. The image was detached and deleted afterwards.
- **Mutation sweep.** I ran 18 source mutants and 2 lockfile mutants; the results are in §3.
- **Probes.** Six scripts in the scratchpad under `rev059/` (`probe1.mjs`–`probe5.mjs` and `devprobe.mjs`). They cover overlap edge cases, the normalizer, filesystem edge cases, TOCTOU, trailing-slash roots and `.env.example`.

### Restoration

- I committed nothing, pushed nothing and commented on nothing.
- **Source files and `package-lock.json`.** Every mutant was applied as an exact single-occurrence replacement. Each file was restored by rewriting the saved bytes and checked by SHA-256 after every mutant. `git status` was clean afterwards, apart from the ignored `node_modules` symlink and `server/logs/`.
- **Planted CSV-guard files.** These were new files, deleted after each run. The `supplier-imports` directory I created for this was removed.
- **Processes.** I stopped only my own processes, each by PID: mysqld 54608, and the two booted servers 54682 and 54691. I used no `pkill`. The scratch datadir `/private/tmp/rev059-mysql` was deleted, and afterwards nothing was listening on 39158 or 39159.
- **Worktree.** The worktree is removed after this report is written.

---

## 1. Findings

### M-1 (Medium): acceptance criteria 2 and 3 exist only as reservations, and the deferred obligations are not recorded where T42 and T48 will read them

**Where:** `server/src/services/supplierImport/supplierImportFiles.js:17-25`, `server/test/supplierImportConfig.test.js:97-106`, `server/config/supplier.js:14`, and `docs/supplier_management/05_development_tasks.md` §T42 and §T48.

- **Nothing consumes the new exports.** Production code never reads `SUPPLIER_IMPORT_JOB_NAMES` or `newSupplierImportStoredName`. I checked with `grep -rn` over `server/src` and `server/test`.
- **The job-name test mostly tests the framework.** It calls `normalizeSchedulerConfig({ jobs: { [purge]: { enabled: false } } })` and checks that the other two names are `undefined`. That holds for any three strings, because the scheduler keys overrides by name.
  - The only T41-specific property is that the three names are distinct. Mutant M18 (purge renamed to the precheck name) is killed by `new Set(names).size === 3`, and nothing else in the test adds to that.
  - **Failure scenario.** In T42, `SupplierImportWorkerService.static jobs` declares `"supplier.import.run"` instead of `SUPPLIER_IMPORT_JOB_NAMES.worker`. This test stays green.
  - The scheduler also accepts an override for a job that does not exist without saying anything. `normalizeSchedulerConfig.js:101-114` keys overrides by any valid name, and `normalizeJobDefinition.js:59` looks them up only for registered jobs. So an operator's `"supplier.import.execute": { enabled: false }` quietly does nothing.
- **The same applies to criterion 2.** The rule that "source/result filename is generated by the server" is true only in the sense that a generator exists. No write path uses it yet.
- **HD-039 (B)'s deferral is not in T42's criteria.** The ledger says the root is required "when T42 registers the import services". That obligation exists only in HD-039's `answer_ref` and in a code comment at `config/supplier.js:14`.
  - T42's acceptance criteria (`05_development_tasks.md`, §T42) do not mention the root requirement.
  - They also do not require the worker's `static jobs` to use `SUPPLIER_IMPORT_JOB_NAMES`.
  - T48's criteria cover symlinks and escaping the root, but do not tie its purge job name to the constant.

  Once T41 is DONE, nothing forces any of this to happen.

**Verified by:** grep; reading the scheduler normalizer; the M18 result; and reading T42 and T48.

**Recommendation:** before T41 is marked DONE, write the carry-forward down:

- Either add it to the T42 and T48 criteria with the Product Owner's sign-off, or record it in the ledger as an open obligation on TASK-042 and TASK-048. It has three parts:
  - the root is required when the services register;
  - `static jobs` names deep-equal `Object.values(SUPPLIER_IMPORT_JOB_NAMES)`;
  - stored names come from `newSupplierImportStoredName` and `supplierImportFilePath`.
- Rename the test to say what it proves ("three distinct, valid job names") rather than "the scheduler controls each one separately".

### M-2 (Medium): the CSV `split` guard is blind where CSV code will live

**Where:** `server/test/supplierImportConfig.test.js:120-130`.

The scan covers only `server/src/modules/supplier`, `server/src/services/supplierImport` and `server/src/handlers/suppliers`. The manifest's `scope.source_paths` also lists:

- `server/src/handlers/supplier-imports/**` and `supplier-exports/**`. These are exactly where the T43+ import and export handlers will go.
- `supplier-approvals/**`, `supplier-approvers/**`, `supplier-settings/**`, `supplier-lookups/**` and `supplier-audit/**`.
- `client/src/pages/suppliers/**` and `client/src/components/suppliers/**`, which contain `.vue` files. The scan only reads `.js`.

The pattern also recognises only the literal `.split(",")` form.

**Failure scenario.** T43 adds `server/src/handlers/supplier-imports/uploadSupplierImport.js` containing `line.split(",")`. Criterion 1's guard stays green.

**Verified by:** planting a one-line file and running the test each time:

| Planted file | Result |
| --- | --- |
| `modules/supplier/zzPlant.js` with `split(",")` | fail (guard works here) |
| `handlers/supplier-approvals/zzPlant.js` with `split(",")` | **pass** |
| `handlers/supplier-imports/zzPlant.js` (new dir) with `split(",")` | **pass** |
| `modules/supplier/zzRegex.js` with `split(/,/)` | **pass** |
| `modules/supplier/zzNl.js` with `split("\n")` (breaks quoted newlines) | **pass** |

**Recommendation:**

- Scan every server `source_paths` glob from `00_module_manifest.json`, and skip directories that do not exist yet, because `readdirSync` throws ENOENT on them.
- Include `.vue` if client paths are in scope.
- Widen the pattern to `split(/,/)` and a regex literal that contains a comma. Optionally, forbid `split` on `"\n"` or `/\r?\n/` in import and export code.
- The lockfile half of this test does hold (L1/L2 in §3).

### L-1 (Low): three of the four roots in HD-039 (C) are not pinned

**Where:** `applicationConfiguration.js:260-261` and `supplierImportConfig.test.js:35-50`.

The test only ever sets `customer.import.root`. Mutant M04, which removes all three attachment roots from `others`, **survives**.

The behaviour itself is correct. `probe2.mjs` sets real attachment roots (generalRoot, bankSensitiveRoot, tempRoot, clamd scanner, bank keys from `env37d.sh`):

- `inside generalRoot` is refused;
- `contains bankSensitiveRoot` is refused;
- `equals tempRoot` is refused;
- `disjoint` is accepted.

**Failure scenario:** a refactor drops the attachment roots, and CI stays green.

**Fix:** add one attachment case to the test.

### L-2 (Low): the `$` anchor on stored names is not pinned

**Where:** `supplierImportFiles.js:14` and `supplierImportConfig.test.js:58-66`.

The traversal case only puts `../` in front of the name. Mutant M07 (`/^[0-9a-f]{64}/u`, with no `$`) **survives**. Under that mutant, `supplierImportFilePath(root, "source", hex + "/../../x")` would join to a path outside the kind directory.

With the anchor in place, the current code refuses this; I checked it in `probe3.mjs`.

**Fix:** add a traversal case that puts the escape after the name.

### L-3 (Low): the `dev` check has no automated test

**Where:** `supplierImportFiles.js:50`.

Mutant M01 (check removed) survives the suite. I verified by hand that the check discriminates: see the hdiutil run above.

A portable unit test is not possible as written, because `lstat` is imported directly. On Linux CI, mounting needs root.

**Fix:** either let the function take `lstat` as an injectable parameter so a fake can return a different `dev`, or add a macOS-only test that uses `hdiutil`. At minimum, record the manual verification.

### L-4 (Low): a trailing slash defeats the symlinked-root guard

**Where:** `supplierImportFiles.js:44-46`.

`realDirectory(root)` calls `lstat(root)` on the path exactly as the caller passes it. POSIX resolves a symlink when the path ends in `/` or `/.`. From `probe4.mjs`, where `linked-root` is a symlink to a directory outside:

```
"/linked-root"   -> rejected: Supplier import path is not a regular directory
"/linked-root/"  -> listed 1 file(s) from outside
"/linked-root/." -> listed 1 file(s) from outside
```

The kind directory is not affected, because `path.join` normalises it. A configured root is not affected either, because the normalizer's `path.resolve` strips the slash. But the function is exported and it claims to reject a symlinked root.

**Fix:** set `root = path.resolve(root)` at the top of `listSupplierImportFiles`, and in `supplierImportFilePath`.

### L-5 (Low): the overlap check compares strings only

**Where:** `applicationConfiguration.js:257-272`.

From `probe1.mjs`, these real overlaps are **accepted**:

- `/srv/ERP/Customer-Imports` against `/srv/erp/customer-imports`. On macOS's default case-insensitive APFS, that is the same directory.
- `/tmp/erp/customer-imports` against `/private/tmp/erp/customer-imports`.
- By extension: any symlinked parent (for example `/var/lib/erp` → `/data/erp`) and bind mounts. The Linux cases are inferred, not run.

The stakes are real. Customer import uses the same layout, `<root>/{source,result}/<64-hex>` (`CustomerImportStorage.js:10-16,42`). So `listSupplierImportFiles` on an overlapped root returns Customer files as if they were Supplier's. A scan-based T48 purge would delete them.

Customer's own internal overlap check (`normalizeCustomerConfig.js:70-73`) is equally lexical, so this matches existing practice.

**Recommendation for T42:** when storage initialises, `realpath` and `lstat` each configured root. Refuse if any two share `dev`+`ino`, or if one real path contains the other.

### L-6 (Low): listing then deleting is a TOCTOU gap, and the API invites the unsafe purge

**Where:** `supplierImportFiles.js:56-58` and `:27-32`.

The listing returns absolute `path`s. `supplierImportFilePath` builds paths without checking the filesystem. A purge that calls `unlink(entry.path)` resolves the kind directory again at delete time.

`probe3.mjs` demonstrated this:

1. List `root/source`.
2. Rename `source` away, symlink `source` to an outside directory, and place a file there with the listed name.
3. Unlink the listed path.

**Result:** the file outside the root was deleted.

Two notes on what this takes:

- The attacker needs write access to the root.
- The deletion runs with the *app's* permissions in the target directory. The Customer import `source/` is a natural target, because its names have the same format.

**Recommendation for T48:** immediately before each `unlink`:

- `lstat` the kind directory and require it to be the same `dev`+`ino` as at listing time;
- `lstat` the file and require `isFile()` and the same `dev`;
- unlink only a bare stored name joined to that verified directory.

In T42, make the root and its kind directories mode 0700 and owned by the service user, as `CustomerImportStorage.#ensureRoot` does.

### L-7 (Low): dangerous roots are accepted

**Where:** `normalizeSupplierConfig.js:96-101`.

- `SUPPLIER_IMPORT_ROOT=/` is accepted when no Customer root is configured (`probe1.mjs`). With a Customer root set, it is refused only because `/` contains everything.
- A world-writable root such as `/tmp` is also accepted. Any local user can then create `/tmp/source` as a real directory they own. That passes `lstat`, `isDirectory()` and the `dev` check.

**Recommendation:**

- Refuse `/` at normalisation.
- In T42's storage initialisation, require the root to be owned by the process uid and not writable by group or other (as Customer's `chmod 0o700` path effectively does).

### L-8 (Low): the ledger's baseline was not updated on the IMPLEMENT entry

**Where:** `00_harness_state.json` `baseline`.

Revision 247 enters IMPLEMENT from base 894cdc6, but three values still point at the TEST_AND_VERIFY entry:

- `default_commit` is 761c0bd;
- `mode_entry_commit` is 761c0bd;
- `worktree` is `…/def-close`.

`references/15-git-worktree-branch-lifecycle.md:135` says to record these values with what they actually mean.

This matters because, in IMPLEMENT, `harness_checks.py:300` uses `default_commit` as the boundary base. The gate's boundary diff therefore covers PRs #159–#161 as well as this PR. I verified that it still passes against 894cdc6.

**Fix:** set `default_commit` and `mode_entry_commit` to 894cdc6 at the next checkpoint.

### L-9 (Low): the DEF-023 reminder was dropped just as SUP-CAP-05 begins

**Where:** `00_harness_state.json` `next_safe_action`.

Revision 246's `next_safe_action` said DEF-023 was "accepted; reassess before SUP-CAP-05 CSV import". The defect register (`testing/04_defect_register.md`) flags it specifically for SUP-CAP-05, because CSV import will accept account numbers under column names the log redaction list has never seen.

Revision 247 starts SUP-CAP-05 and replaces `next_safe_action` without that pointer. It also drops the DEF-024, TC-133/HD-036 carry-overs. DEF-023 is still `OPEN` in `defects`, but no reassessment is recorded, and nothing now tells the next task to do one.

**Fix:** put the DEF-023 reassessment back in `next_safe_action`, or better, in T42/T43 criteria.

### Info

- **I-1 (for the Product Owner): other modules' file roots are outside the overlap check.** Item's `mediaDirectory`, Item's `importDirectory` and logging's `directory` are not checked.
  - `probe1.mjs`: `ITEM_MEDIA_DIRECTORY=/srv/erp/supplier/source` alongside `SUPPLIER_IMPORT_ROOT=/srv/erp/supplier` is **accepted**, and so is `ITEM_IMPORT_DIRECTORY` equal to the Supplier root.
  - By reading `ItemMediaCleanupJob.js:71-106` (inferred, not run): it deletes *any* unreferenced regular file older than `mediaOrphanGraceMs` (default 1 day) at the top level of `mediaDirectory`. That would delete Supplier sources.
  - Item import files are `<uuid>.csv` (`ItemImportService.js:378`) and do not match Supplier's name format. Logging deletes by its own prefix.
  - **Question for the Product Owner:** extend HD-039 (C) to Item `mediaDirectory` and `importDirectory`? Doing so touches `applicationConfiguration.js` again.
- **I-2: name entropy is not pinned.** Mutant M09 (`randomBytes(2)` padded to 64 hex) survives. 256 bits from `randomBytes(32)` is right. Pinning it would need a statistical test, so leave it.
- **I-3: normalizer edge cases.**
  - Accepted: an array `["/srv/arr"]` (coerced by `String`), an embedded newline, and a 5000-character path. These fail only at the first filesystem call.
  - Refused: `~/imports`, `C:\imports` and numbers.
  - Surrounding whitespace is trimmed.
  - A NUL byte cannot arrive through an environment variable.

  None of this is reachable from `.env` except the newline, via dotenv quoting.
- **I-4: duplicate helper and a redundant term.** `checkSupplierImportRoot`'s `inside` duplicates `normalizeCustomerConfig.js:70-73`; one exported helper would do. The `relative === ""` term is redundant: M05 is an equivalent mutant, because `""` already passes the other three conditions.
- **I-5: HD-039's answer is not fully auditable from the ledger.** The answer reads "B，C按你的建議". The recommendation it refers to is not in the ledger's question text. So the recorded reading "B option (1)" is plausible, but it cannot be checked from the ledger alone.
- **I-6: hard links are listed, and stored names must never come from a client.**
  - Hard links are listed as regular files; `probe3.mjs` read the outside content through the listed path. Unlinking one only removes the link. A future read path could serve the outside content, but that needs write access to the root.
  - `supplierImportFilePath` accepts any well-formed name. Result-download handlers (T44/T45) must take the stored name from the job row, never from the request, or any job's file in the directory becomes readable.
- **I-7: `.env.example` still fails validation, as it did before.** Loaded as-is, it fails on Customer attachment keys and `JWT_SECRET`, identically with and without the new line (`probe5.mjs`). The new `SUPPLIER_IMPORT_ROOT` does not overlap the example attachment roots.

## 2. What held

- **Criterion 1 (dependencies).**
  - `csv-parse` ^7.0.2 and `csv-stringify` ^6.8.3 were already declared in `server/package.json` and locked once, with integrity. This PR does not touch either file, and the ledger says so honestly.
  - The lockfile half of the guard discriminates: L1 (a second nested `csv-parse`) and L2 (integrity removed) are both killed.
- **Criterion 2 (config).**
  - `maxFileBytes`, `maxRows` and `fileRetentionDays` are bounded and pinned (pre-existing).
  - The root is optional (HD-039 B), must be absolute when given, is trimmed and `path.resolve`d (M10 and M11 killed), and is `null` when unset. Booting confirms both states.
  - Names are 64 lowercase hex characters from `randomBytes(32)`.
  - `supplierImportFilePath` refuses unknown kinds, relative roots, leading traversal and non-hex names (M08, M16 and M17 killed).
- **Criterion 3, the filesystem half.**
  - **Entries skipped by the listing:** symlinks to files, symlinks to directories, subdirectories, non-hex names, a FIFO and uppercase-hex names.
  - **Directories refused:** a symlinked root, a symlinked kind directory, a kind of `../outside`, and a kind directory on another filesystem (verified with hdiutil).
  - **Directory not yet created:** a missing kind directory gives `[]`.
  - **Mutants killed:** M12–M15 and M17.
  - **Trailing slashes:** the root's trailing slash is normalised in the config path.
  - **Root of `/`:** `/` gives `/source/<name>`, which is not an escape.
- **HD-039 (C).**
  - Both directions are refused (M02 and M03 killed), as are equality, trailing slashes on both sides, and `..` segments.
  - A shared prefix (`customer-imports-2`) is accepted.
  - A null Customer import root or null attachment is skipped safely.
  - All three attachment roots are refused correctly (see L-1).
  - The real entrypoint refuses with `CONFIGURATION_INVALID`.
- **HD-039 (A) scope.** The three approval-required files touched are exactly the three in APPROVAL-HD-039-SCOPE. `applicationConfiguration.js` only reads Customer config. The `.env.example` change is one line with no secret. `config/scheduler.js`, `server/package.json` and `package-lock.json` are unchanged, as HD-039's answer says.
- **MODE-CHANGE-247's direct write.**
  - The justification is accurate: `state_tool.py:12-23`, `TRANSITIONS['VERIFYING'] = {'VERIFIED','BLOCKED','NOT_READY'}`. `mode_change_ref` adds `READY_FOR_TESTING` only for TEST_AND_VERIFY (`:49`), and `PLANNED` only from BOOTSTRAPPED (`:50`). There is no legitimate path to IMPLEMENTING that avoids faking UAT or acceptance gates.
  - The write also respects what `checkpoint` would have enforced: revision goes up by exactly 1 (246→247); the diff to approvals, pending_decisions, external_actions and evidence_files only adds; and the MODE_CHANGE record has the same shape the tool appends (`:77-79`). `inspect` reports only baseline drift.
- **Regressions.** The full server suite, lint, audit, CI and boot results are as listed above.

## 3. Mutants

There were 18 source mutants, each run against `supplierImportConfig.test.js`, `configuration.test.js` and `supplierConfig.test.js` (19/19 baseline). There were also 2 lockfile mutants, run against the CSV test. All were restored byte-for-byte and checked by SHA-256.

| # | Mutant | Result |
| --- | --- | --- |
| M01 | drop the `dev` check | **SURVIVED** (L-3; verified by hand with hdiutil) |
| M02 | overlap: drop root-contains-Customer | KILLED |
| M03 | overlap: drop Customer-contains-root | KILLED |
| M04 | overlap: ignore the three attachment roots | **SURVIVED** (L-1) |
| M05 | overlap: drop `relative === ""` | SURVIVED, equivalent (I-4) |
| M06 | overlap: call removed | KILLED |
| M07 | `STORED_NAME` without `$` | **SURVIVED** (L-2) |
| M08 | `STORED_NAME` without `^` | KILLED |
| M09 | 16-bit entropy padded to 64 hex | SURVIVED (I-2) |
| M10 | normalizer: no `path.resolve` | KILLED |
| M11 | normalizer: no absolute check | KILLED |
| M12 | listing: drop `isFile()` | KILLED |
| M13 | `realDirectory`: `lstat` → `stat` | KILLED |
| M14 | listing: swallow all errors | KILLED |
| M15 | root never checked | KILLED |
| M16 | path builder: kind check off | KILLED |
| M17 | listing: name filter off | KILLED |
| M18 | purge name = precheck name | KILLED |
| L1 | lockfile: second nested `csv-parse` | KILLED |
| L2 | lockfile: `csv-stringify` integrity removed | KILLED |

Of the 20 mutants, 15 were killed, 1 is equivalent, and 4 survived: M01, M04, M07 and M09. I could not reproduce the author's "11 mutants killed", because the ledger records no list or evidence file for them.

## 4. What I could not verify

- **The author's 11 mutants.** They are not recorded anywhere I could find.
- **Linux behaviour.** I did not run a case-sensitive filesystem, bind mounts or a symlinked `/var/lib` parent. The L-5 Linux cases are inferred.
- **ItemMediaCleanupJob.** Its deletion of Supplier files under a misconfigured `mediaDirectory` (I-1) is inferred from the code; I did not run it.
- **Integration tests.** I did not run the 339 integration tests locally. CI ran them green on 843ac57.
- **HD-039's wording.** I cannot verify the Product Owner's words or the recommendation they refer to (I-5).

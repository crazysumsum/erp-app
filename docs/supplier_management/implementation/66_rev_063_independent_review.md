# REV-063: TASK-042 remediation after REV-062 (PR #165), independent review

Reviewer: an independent agent (REV-063, security-auditor persona). I did not write this code, and I did not write REV-061, REV-062 or any earlier review of it.

- **Merge candidate:** ebf3e4103677c7bfe576781c134cfa8e7cc1c692 on `claude/supplier-task-042`. `gh pr view 165` reports it as the head, `MERGEABLE`.
- **Base:** origin/main e36f0de. I checked with `git ls-remote` after CI finished, and main had not moved.
- **Commits reviewed:**
  - 58714c9 (code and tests)
  - 1c1fc6e (merge of e36f0de)
  - 1061d58 (the `execute` test)
  - ebf3e41 (docs, ledger revision 254)

  I also re-checked the whole PR against e36f0de.
- **Where I worked:**
  - A detached worktree at `/private/tmp/erp-rev-063`, with `node_modules` symlinked.
  - A private schema, `rev063`, on the author's MySQL at 127.0.0.1:3442 (26.7.0). I migrated it as admin with `scripts/migrate.js` and did not touch `erp_dev`.
  - Scratch files under `/private/tmp/r63`.
  - Probe copies are in the scratchpad under `rev063/`.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 6 |

Disposition: **APPROVED**. The three Lows can be fixed before merge or carried into the carry-forward and the ledger. None of them blocks merge.

**What closed.**

- **M-4 is closed.** The guard is now a real allowlist on both `query` and `execute`.
  - Every bypass REV-062 found is refused and rolls back, whether it relied on comments, `/*!`, `CALL`, `PREPARE`, `ANALYZE`, `SET @@autocommit` or `SET foreign_key_checks`.
  - I tried a further 31 forms on real MySQL. None of them commits the Supplier ahead of its marker.
  - MySQL itself forbids `COMMIT`, `SET autocommit`, dynamic SQL and DDL inside a stored function (errors 1422, 1445 and 1336). A function call from `SELECT` therefore cannot reopen the atomicity hole.
- **The Supplier SQL passes.** I ran 126 statements from `server/src/modules/supplier` and `supplierImport`, and 0 were refused.
- **L-7, L-8 and I-16 to I-19** are closed as stated. The exceptions are the residue below.
- **Mutation.** The author's 56 mutants re-ran on my tree, and all 56 were killed. REV-062's 17 survivors map onto the new code as 22 mutants, and 17 of those are killed.
- **CI** is green on this exact tree.

**What remains (all Low).**

- **L-9. The residue of L-6.** A guard refusal and a coding-bug `TypeError` still log the same `causeName: "TypeError"`, even though the new code comment says `causeName` tells them apart.
- **L-10. The residue of L-7.** The ancestor walk judges the realpath, but the worker keeps and uses the configured path. A symlink component that sits in a world-writable directory is accepted, and can be swapped later.
- **L-11. Survivors among my 16 new mutants.** Three that matter survive:
  - the allowlist losing its `^` anchor;
  - the I-18 "log only when marked" order;
  - the group-write half of the ancestor check.

### What I ran

- **T42 set on real MySQL (`rev063`).** `supplierImportService`, `supplierImportWorkerService`, `supplierImportExecution.integration` and `serviceContainer` gave **34/34**, including the 12 `TASK-042:` integration tests.
- **CI.** `gh pr checks 165` shows all 5 jobs pass on ebf3e41 (run 36538816541, `pull_request`).
  - The tested ref was `pull/165/merge` ae4ff4a, whose parents are e36f0de and ebf3e41.
  - Its tree, 71c9596, is **identical** to ebf3e41's tree, so CI tested exactly this candidate.
  - The MySQL job log shows `tests 2339, pass 2330, fail 0, skipped 9`, with all 12 `TASK-042:` tests and the three new unit tests passing on Linux.
  - I did not run the full suite locally. For the full suite I relied on this CI run on the identical tree.
- **Lint.** `eslint` on the 9 JavaScript files the PR changes against e36f0de exits 0.
- **Boundary check.** `validate_module_boundary.py docs/supplier_management --repo-root . --base e36f0de --json` returns `LOCAL_CHECKS_PASS` with no issues.
- **State tool.** `state_tool.py inspect docs/supplier_management --repo-root . --json` returns `BLOCKED` at revision 254.
  - The only issues are `WORKTREE_CHANGED`, `COMMIT_CHANGED` and `SOURCE_CHANGED`. That is the expected in-progress state, the same as REV-061 I-15 and REV-062.
  - REV-062's record is present: `SEPARATE_AGENT`, `CHANGES_REQUESTED`, 0/0, with `source_ref` pointing at `65_rev_062_independent_review.md`.
  - The committed report is byte-identical to the one REV-062 delivered.
- **The merge of main (1c1fc6e) is a pure automatic merge.**
  - `git merge-tree --write-tree 58714c9 e36f0de` gives tree 332638a, which is 1c1fc6e's tree.
  - Main's side (742d58e..e36f0de, 52 files) touches only Inventory paths plus `server/src/modules/item/ItemLookupService.js` and its test. It changes nothing in Supplier and no shared config.
  - The migrations run 0057–0060 (Inventory), then 0061–0062 (this PR), so there is no collision.
- **Reviewer probes.** I wrote `rev063Probes.integration.test.js` and ran it through `createApplication` on `rev063`:
  - G: a 31-statement allowlist matrix, with sentinel rows and the per-connection session state read by an admin connection through `performance_schema`;
  - L6: log payloads by error kind;
  - W: the registered worker writing to the real system log.
- **Other scripts.**
  - `r63_l7.mjs` and `r63_l7swap.mjs`: the ancestor walk on real macOS paths.
  - `r63_sqlscan.mjs`: every literal SQL statement in `server/src` run through `assertRowStatement`.
- **Mutation.**
  - The author's `mut42c.py`, pointed at my tree: **56/56 killed**.
  - My `mut063.py`: REV-062's survivors mapped onto the allowlist, plus 16 of my own. 38 in total: 22 killed, 16 survived, of which 7 are equivalent or conservative and 3 matter (L-11).
  - Each mutated file was restored from its saved bytes and checked by SHA-256 after every run. After both sweeps, `shasum -a 256 -c` over all five files returned OK, and `git diff --quiet HEAD` passed.
- **Real entrypoint.** I ran `node src/index.js` three ways, with `DB_NAME=rev063` and a random port:
  - **No root:** it listens, registers `job.supplierImportWorker` and `supplier.import.execute`, and exits 0 on SIGTERM.
  - **A root under a 0755 parent in `/private/tmp`:** it listens, creates `imports`, `source` and `result` at 0700, and exits 0 on SIGTERM.
  - **A root under a 0777 non-sticky grandparent:** it fails with `application.startup_failed`, "ancestor /private/tmp/r63/grand must not be replaceable by other users", and exits 1.

---

## 1. Status of REV-062's findings

| ID | Status | Evidence |
| --- | --- | --- |
| M-4 | **Closed** | **Probe G, on real MySQL.** Each statement ran after a sentinel insert, and then the row was forced to fail. **No statement committed the sentinel.**<br><br>Refused by the guard:<br>• `COMMIT`, ` COMMIT`, `/* unterminated COMMIT`, `/* /* */ COMMIT`, `--x\nCOMMIT`, `--\nCOMMIT` and `# only a comment`;<br>• `SELECT … INTO OUTFILE`.<br><br>Passed by the guard, then rejected by MySQL:<br>• `WITH x AS (SELECT 1) COMMIT`, ` SELECT 1`, `ſELECT 1` (a Unicode case-fold of `s`) and `SELECT 1; COMMIT` all fail with `ER_PARSE_ERROR`.<br><br>Passed by the guard and ran normally:<br>• `SeLeCt 1`, `SELECT 1 # trailing`, `FOR UPDATE NOWAIT`, `FOR UPDATE SKIP LOCKED`, `SLEEP(0)`, and `LOAD_FILE` (which returned NULL without the FILE privilege).<br><br>**The author's tests.** The unit table and the real-MySQL `query`/`execute` loop pin REV-062's rows.<br><br>**N11 (`execute` unguarded) is killed only by the real-MySQL `execute("COMMIT")` case.** This confirms the author's claim that `COMMIT` runs as a prepared statement.<br><br>**`multipleStatements`.** It appears nowhere in `server/`; `config/database.js` does not set it, and mysql2 defaults it to false. `SELECT 1; COMMIT` fails to parse.<br><br>**Residue:** I-22 and I-23. |
| L-6 | **Partly closed. Residue is L-9.** | `causeName` separates a `TypeError` from a plain `Error`, and SQL errors carry `causeCode`. But a guard refusal, a coding-bug `TypeError` and "applyRow returned 0" all log `causeName: "TypeError", causeCode: null` (probe L6). That is exactly the case REV-062 named. |
| L-7 | **Closed for REV-062's cases. Residue is L-10.** | These cases are refused, both in unit tests (macOS here, Linux in CI) and at the real entrypoint:<br>• a symlinked parent that points at a 0777 directory;<br>• a 0777 grandparent;<br>• a parent owned by another uid (an injected `lstat`).<br><br>These are accepted:<br>• `/private/tmp` (1777, root);<br>• `/tmp` → `/private/tmp`;<br>• `os.tmpdir()`, which is `/private/var/folders/gk/…/T`.<br><br>**Intermediate directories.** `mkdir` runs *before* `realpath`, but a recursive `mkdir` creates every intermediate at 0700 under umask 000, 022 and 077 (`r63_l7.mjs`), so nothing is created wider than the check allows. |
| L-8 | **Closed for REV-062's survivors** | Status of REV-062's 17 survivors, as mapped onto the new code:<br>• N20, N14, N18 (both halves), N23, N24, N29, N30 and N38 are killed.<br>• N3–N10 become "the allowlist admits keyword X": ROLLBACK, START, BEGIN, SAVEPOINT, SET, CREATE and LOCK are killed. RELEASE, DROP, TRUNCATE, ALTER and UNLOCK survive, because the table pins a representative of each class but not each keyword. That matters little for an allowlist (see L-11).<br>• N11 is killed. |
| I-16 | **Closed** | Main e36f0de is merged as a pure automatic merge, and CI is green on a tree identical to the candidate. Main has not moved since. |
| I-17 | **Closed** | **Probe W:**<br>• A queued job whose confirmer was deleted produced exactly one real system-log line: `supplier.import.not_confirmed` with context `{"jobId":65}`.<br>• The claim returned `null`, and the job is `failed`, so it is not claimed again. The event is therefore logged exactly once.<br><br>The resumed-running case is recorded in the carry-forward for T45. |
| I-18 | **Closed in code, but not pinned (L-11)** | The log now sits after `assertLease` and behind `affectedRows === 1`. A mutant that moves it back before `assertLease` survives. |
| I-19 | **Closed for `SET`** | `SET` is refused (probe G, and the author's unit table). Session state can still be reached without `SET` (I-23). |

## 2. New findings

### L-9 (Low): a guard refusal is still indistinguishable in the log from a coding bug, and the code comment says otherwise

**Where:**

- `server/src/modules/supplier/SupplierImportService.js:108`: the guard throws a plain `TypeError`;
- `:203`: "applyRow must return the Supplier ID" is also a plain `TypeError`;
- `:239`: the comment "causeName 分得出 TypeError 同守衛拒絕（L-6）" ("causeName tells a TypeError apart from a guard refusal");
- `:240-244`: the log call.

**Failure scenario.** In T45 the guard fires because a helper issues an unexpected statement: the `rowConnection` refusal REV-061 M-3 asked for. The system log line is identical to the one produced by a `null.x()` bug in the helper or by an `applyRow` that returns 0. The operator still cannot tell a transaction-safety violation from an ordinary bug, which is the exact complaint of REV-062 L-6.

**Verified by running (probe L6, through the real service on `rev063`).** The four cases logged:

| Case | Logged context |
| --- | --- |
| a `TypeError` from a coding bug | `{"name":"MySqlDatabaseOperationError","code":"DATABASE_TRANSACTION_FAILED","causeCode":null,"causeName":"TypeError","publicCode":"INTERNAL_SERVER_ERROR"}` |
| a guard refusal (`COMMIT`) | identical, `causeName: "TypeError"` |
| `applyRow` returned 0 | identical, `causeName: "TypeError"` |
| a plain `Error` | `causeName: "Error"` |

The author's test at `supplierImportExecution.integration.test.js:415` asserts only that a `TypeError` is `"TypeError"`. It never compares that against a guard refusal.

**Recommendation.** Give the service's own refusals a code. `causeCode` is already logged.

```js
throw Object.assign(new TypeError("applyRow may only run …"), { code: "SUPPLIER_IMPORT_STATEMENT_REFUSED" });
// and at :203
throw Object.assign(new TypeError("applyRow must return …"), { code: "SUPPLIER_IMPORT_ROW_ID_INVALID" });
```

Add one case to the existing log test: an `applyRow` that runs `COMMIT`, with `causeCode` expected to be `SUPPLIER_IMPORT_STATEMENT_REFUSED`. Or, at minimum, correct the comment at `:239`.

### L-10 (Low): the realpath's ancestors are checked, but the worker keeps using the configured path, whose symlink components are not

**Where:**

- `server/src/services/supplierImport/supplierImportFiles.js:87-94` walks `dirname(realpath(root))`;
- `:95`, `:99` and `:101-107` then `lstat`, `chmod` and `mkdir` through the unresolved `root`;
- `:127` returns `real`;
- `server/src/services/supplierImport/SupplierImportWorkerService.js:35` and `:47` discard the return value and keep `this.root` as the configured string.

**Failure scenario.** `SUPPLIER_IMPORT_ROOT=/srv/shared/link/imports`, where:

- `/srv/shared` is 0777 and not sticky;
- `link` points at a safe directory, `/var/lib/erp`.

Startup accepts this, because every ancestor of `/var/lib/erp/imports` is sound. Later, any local user can rename `link` and point it at a directory they own, since the directory that holds the link is world-writable. From then on, every path built from the configured root follows the new link:

- `supplierImportFilePath(this.root, …)`, which T43's upload and T46's result will use;
- `listSupplierImportFiles`, whose `lstat(root)` does not guard intermediate components.

Uploaded Supplier CSVs would then land in, and be listed from, an attacker's directory. This is the L-4 attack again, one component to the side.

There are also startup windows: `chmod` and `mkdir` go through `root` after the check.

It is Low because:

- T42 writes no files;
- it needs a root configured through a symlink that sits in a world-writable, non-sticky directory.

`/tmp` → `/private/tmp` on macOS is safe, because that link lives in `/` (root, 0755).

**Verified by running (`r63_l7.mjs`, `r63_l7swap.mjs`, macOS APFS, single user).**

- `prepareSupplierImportRoot(".../open/link/imports")`, with `open` at 0777 and `link` pointing at `safe` (0755), was **accepted** and returned `.../safe/imports`.
- I then replaced `link` with a symlink to `.../attacker`:
  - `supplierImportFilePath(configuredRoot, "source", …)` resolved to `.../attacker/imports/source`;
  - `listSupplierImportFiles(configuredRoot, "source")` listed the file I had planted there.
- That a *different* user could replace the link is inferred from POSIX rename rules in a 0777 non-sticky directory. I ran as one user.

**Recommendation.** Use the realpath everywhere after resolving it.

- In the worker: `this.root = await prepareSupplierImportRoot(this.root, […])`.
- In `prepareSupplierImportRoot`: compute `real` once, right after `mkdir`, and use it for the walk, the `lstat`, the `chmod` and the kind `mkdir`s.
- Pin it with the scenario above, which should be refused or else return and use the target path.
- Add to the carry-forward that T43, T46 and T48 must build paths from the prepared root, never from config.

### L-11 (Low): three of my new mutants survive on guarantees this remediation claims

**Where:**

- the tests in `server/test/supplierImportService.test.js:52-66`;
- `supplierImportExecution.integration.test.js:378-391`, the lease-lost test, which has no logger;
- `server/test/supplierImportWorkerService.test.js:135-151`.

| Mutant | Change | Result | Why it matters |
| --- | --- | --- | --- |
| A4 | `ROW_STATEMENT` loses its `^` anchor | **survived** | The allowlist becomes "contains a DML word anywhere". `COMMIT -- select`, `CREATE TABLE t AS SELECT 1` and `PREPARE s FROM 'SELECT 1'` would then pass. None of the refused cases in the unit table contains a DML word, so nothing notices. REV-062's N12 was the same mutation on the old regex, and it was killed then only through false positives. |
| A11 | the failure log moved back before `assertLease`, as it was before I-18 | **survived** | The lease-lost test builds `service()` with no logger, so "no 'row failed' line when the lease is lost" (I-18, carry-forward `:98`) is not pinned. |
| A15 | the ancestor check tests only other-write (`0o002`), not group-write | **survived** | Every ancestor test uses 0777. A 0775 or 0770 group-writable ancestor is refused today (I checked it with the probe), but nothing pins that. |

**Equivalent or conservative survivors, listed for completeness:**

- **A7, "`--x`" stripped as a comment.** A statement cannot start with `--x`, so the result is still refused or fails to parse.
- **A8, "`#`" comments not stripped.** This errs toward refusal.
- **A10, the log without `affectedRows === 1`.** With the lease held, only the owner writes rows, so this is unreachable.
- **A12, the `not_confirmed` payload.** No payload test exists. The payload is `{jobId}` today, and the fields the mutant adds (`confirmed_by`, which is NULL there, and `confirmed_at`) are not sensitive.
- **A16, the walk stopping below `/`.**
- **A1, A2, N7, N9b–d and N10b: the allowlist gaining USE, HANDLER, RELEASE, DROP, TRUNCATE, ALTER or UNLOCK.** Adding a keyword to an allowlist is a deliberate edit a reviewer would see. But `USE` in particular would leak the default schema onto a pooled connection, so one of these belongs in the refused list.
- **A5 and A6, DUMPFILE and `INTO\nOUTFILE` untested.** These are subsumed by I-22.

Killed: N3–N6, N8, N9a, N10a, N11, N14, N18, N18b, N20, N23, N24, N29, N30, N38, A3, A9, A13 and A14.

**Recommendation.**

1. Add `"COMMIT -- select"` and `"CREATE TABLE t AS SELECT 1"` to the refused list. This kills A4.
2. Add `"USE erp_dev"` and `"DROP TABLE t"` to the refused list. This kills A1 and N9b.
3. Pass a logger into the old worker's `service()` in the lease-lost test, and assert that it recorded nothing. This kills A11.
4. Add one `chmod 0o775` ancestor case, owned by the test user, next to the 0777 cases. This kills A15.

### Info

- **I-22. `INTO OUTFILE` split by a comment passes the guard.**
  - **The claim.** The carry-forward (`62_task_041_carry_forward.md:52`) and the code comment (`SupplierImportService.js:96-97`) say `INTO OUTFILE`/`DUMPFILE` is refused.
  - **The gap.** The check at `:107` is `/\binto\s+(?:outfile|dumpfile)\b/` on the raw text, so `SELECT 1 INTO/**/OUTFILE '/tmp/x'` and `SELECT 1 INTO -- c\nOUTFILE …` pass the guard.
  - **Verified by running.** MySQL parsed both as `INTO OUTFILE` and refused them only because `erp_user` lacks FILE (`ER_SPECIFIC_ACCESS_DENIED_ERROR`, probe G). `@@secure_file_priv` is NULL on this server.
  - **Impact.** The real control is the FILE privilege and `secure_file_priv`, and neither atomicity nor session state is at stake, so the impact here is nil.
  - **Recommendation.** Run the OUTFILE test against the text with all comments replaced by a space, or reword both places to say that the FILE privilege is the control.
- **I-23. Allowed statements can still leave session state on the pooled connection.**
  - **Verified by running** (probe G, admin reads of `performance_schema` for the same connection after the row transaction rolled back and the connection returned to the pool):
    - `SELECT GET_LOCK('r63q', 0)`, the same through `execute`, and `INSERT … SELECT r63_f8()`, where the function calls `GET_LOCK`, **left three user-level locks held** by pooled connection 3464 after the rows returned (`IS_USED_LOCK` returned 3464 for each).
    - `SELECT 7 INTO @r63v` and `UPDATE … SET v = (@r63u := 5)` left user variables set.
    - `SELECT r63_f7()`, a stored function doing `SET @@session.transaction_isolation = 'READ-UNCOMMITTED'`, left that connection at **READ-UNCOMMITTED**.
    - A stored function that set `foreign_key_checks` or `sql_mode` did *not* persist.
  - **Why this is Info.**
    - `grep` finds no `GET_LOCK`, no user variables in SQL, and no stored routines in `server/src` or the migrations.
    - `withTransaction` sets the isolation level for every transaction.
    - Non-transactional pool reads on that connection would be dirty, but that needs a stored function nobody has written.
    - `config/database.js:71-73` already documents that locks and variables follow a released connection.
  - **Recommendation.** Add a clause to HD-048 (2): `applyRow` must not take named locks, assign user variables or call stored routines.
- **I-24. The carry-forward's corrected count is off by one in the other direction.**
  - **The record.** Carry-forward `:77-80` now says "39 mutants … ten for the remediation". The remediation list it gives has **11** items, and the author's `mut42c.py` has 11 such entries: generic code, no log, raw connection, leaseless, unconfirmed, parent unchecked, four jobs contracts, and the rows extra CHECK.
  - **The correct totals.** The pre-REV-062 total was 19 + 10 + 11 = **40**, so the original "40" was right. REV-062's L-8 miscounted the remediation list. The "56" is correct: 40 + 16 R62 mutants, and I counted all 56 entries and re-ran them.
  - **Recommendation.** Change "39" to "40" and "ten for the remediation" to "eleven", and credit REV-062 with a mistake of its own.
- **I-25. False positives.**
  - The guard refuses some statements MySQL would accept:
    - `--\r\nSELECT 1` (MySQL accepts a `--` followed by a control character);
    - a parenthesised `(SELECT 1)`;
    - any statement whose string literal contains `/*!`.
  - None of these occurs in the current code. `r63_sqlscan.mjs` ran all 126 literal Supplier statements (74 `SELECT`, 34 `UPDATE`, 10 `INSERT`, 5 `DELETE`, and 3 that start with `${SUPPLIER_SELECT}`), plus `assertActorFresh`'s SQL, and none was refused. The only statement refused across the whole `server/src` scan is the framework's own `SET TRANSACTION ISOLATION LEVEL`, which never reaches `applyRow`.
  - No Supplier code passes a non-string SQL argument, which the executor rejects anyway.
  - `SET` and `CALL` are not needed by any current domain helper.
- **I-26. Both log lines are written inside the transaction, before COMMIT.**
  - If the COMMIT of the marking transaction fails, `supplier.import.failed` has already been logged while the row stays pending, and the retry logs again. The same applies to `not_confirmed`.
  - `withTransaction` never retries on its own, so there is exactly one line per attempt, and a duplicate needs a failed COMMIT.
  - This is acceptable. A reader should know that "row failed" means marked-if-committed.
  - The payloads are low-sensitivity: `jobId`, `rowNumber`, error class names and codes, with no message text (probe W, real log).
- **I-27. Deployment layouts that the ancestor rule now refuses.** The refusals are correct, but operators should be told about them.
  - **Verified by running (`r63_l7.mjs`):**
    - a 2775 setgid, group-writable parent, which is the shape Kubernetes `fsGroup` gives a volume root;
    - an ancestor owned by uid 65534 (injected), which is the shape of NFS `root_squash`.
  - **Inferred, not run:**
    - Debian's `2775 root:staff` `/usr/local` and `/var/local`;
    - a volume that macOS mounts with "ignore ownership" (uid 99).

  These layouts are fine:

  - root-owned 0755 `/srv` and `/var/lib`;
  - `/tmp` at 1777. On Linux this is verified by CI, where the root-prep test passed under `/tmp`.
  - `/home/runner/work`, which is inferred to pass: `/home` is root 0755 and `/home/runner` is owned by the runner.

  **Recommendation.** Add one sentence to HD-046 or the T43 runbook: "the root and every ancestor must be neither group- nor other-writable (unless sticky), and owned by root or the service user".

## 3. Mutants

**The author's list (`mut42c.py`), re-run on this tree.** All 56 were killed:

- the 16 R62 mutants;
- the 19 original ones;
- REV-061's 10;
- the 11 for the REV-061 remediation.

**Mine (`mut063.py`):**

| ID | Mutation | Result |
| --- | --- | --- |
| N3 / N4 / N5 / N6 | allowlist + ROLLBACK / START / BEGIN / SAVEPOINT | killed |
| N7 | allowlist + RELEASE | survived (keyword not pinned) |
| N8 | allowlist + SET | killed |
| N9a / N9b / N9c / N9d | allowlist + CREATE / DROP / TRUNCATE / ALTER | killed / survived / survived / survived |
| N10a / N10b | allowlist + LOCK / UNLOCK | killed / survived |
| N11 | `execute` unguarded | killed (real-MySQL `execute("COMMIT")` only) |
| N14 | `SERVICE_UNAVAILABLE` not generic | killed |
| N18 / N18b | log drops `name`/`code` / `publicCode` | killed / killed |
| N20 | worker does not pass its logger | killed |
| N23 / N24 | NOT_CONFIRMED checks one half | killed / killed |
| N29 | ancestor owner ignored | killed |
| N30 | root not allowed as ancestor owner | killed |
| N38 | rows `enforced` ignored | killed |
| A1 / A2 | allowlist + USE / HANDLER | survived / survived |
| A3 | allowlist + DO | killed |
| **A4** | allowlist without `^` | **survived** (L-11) |
| A5 / A6 | DUMPFILE allowed / `INTO\s+` → `INTO ` | survived / survived (I-22) |
| A7 | `--x` stripped as a comment | survived (equivalent) |
| A8 | `#` comments not stripped | survived (conservative) |
| A9 | `/* */` comments not stripped | killed |
| A10 | failure log without `affectedRows === 1` | survived (unreachable while the lease is held) |
| **A11** | failure log before `assertLease` | **survived** (L-11) |
| A12 | `not_confirmed` payload widened | survived (not sensitive) |
| A13 | `causeName` from `error.name` | killed |
| A14 | ancestor sticky exemption dropped | killed |
| **A15** | ancestor group-write ignored | **survived** (L-11) |
| A16 | walk stops below `/` | survived (`/` is root 0755 on every real host) |

## 4. What held

- **Atomicity against every spelling I could find.** Nothing that passes the allowlist commits, whether by comment, case, Unicode whitespace, a stacked statement, a CTE prefix or a stored function. `COMMIT` inside a stored function is refused by MySQL at `CREATE` time (1422), and so are `SET autocommit` (1445), dynamic SQL (1336) and DDL (1422).
- **Non-string SQL is rejected by the guard itself:** `undefined`, `""` and `{ sql }`.
- **The author's tests discriminate.**
  - The real-MySQL loop is the only thing that kills `execute` unguarded.
  - The injected-`lstat` owner case kills N29.
  - The worker wiring test kills N20.
  - The NOT ENFORCED CHECK case kills N38.
  - The admin trigger probe left no `sirp_`/`sijp_` triggers or probe tables in `rev063`. The only triggers in the schema are Inventory's four migration triggers.
- **I-17 and the M-1 logs, end to end.** The registered worker's service wrote `supplier.import.not_confirmed` and `supplier.import.failed` to the real system log. Each appeared once and carried no message text.
- **The real entrypoint.**
  - With no root, it boots and registers the worker.
  - With a normal root, it boots and creates 0700 directories.
  - With a bad grandparent, it refuses to start and exits 1.
- **The merge and CI.** The merge is clean and automatic, main has not moved, and CI is green on a tree identical to the candidate, with 2330 pass and 0 fail.
- **The ledger.**
  - REV-062 is recorded as `SEPARATE_AGENT`, `CHANGES_REQUESTED`, 0/0, with the committed report as its `source_ref`.
  - HD-048 (2) now says the allowlist cannot see a second connection and does not make a public service method safe. That is correct.
  - `default_commit` is e36f0de.
  - `next_safe_action` names REV-063, green CI and the Product Owner.

## 5. What I could not verify

- **The full suite locally.** I relied on CI run 36538816541, whose tested tree is byte-identical to ebf3e41's. I did not reproduce the author's local "2329 pass, TC-059 fails" figure. CI reported 2330 pass and 0 fail.
- **Linux paths beyond `/tmp`.** Of `/home/runner/work`, Debian's 2775 `/usr/local`, Kubernetes `fsGroup` volumes and NFS `root_squash`, only the `/tmp` case ran on Linux, in CI. The rest are inferred, or simulated with a 2775 directory or an injected uid on macOS.
- **A second user swapping the link in L-10.** I performed the swap as the same user. That another user could do it follows from POSIX rename rules in a 0777 non-sticky directory; I inferred this.
- **How long leaked named locks or isolation settings (I-23) survive in production.** mysql2 idle eviction was not measured.
- **MySQL versions other than 26.7.0.**

## Restoration

- **Repository.** I committed, pushed and commented on nothing. I did not touch `/Users/sam/Documents/workspace/erp-app`'s working tree, `…/erp-app-worktrees/task-042` or `erp_dev`.
- **Worktree.** The probe file was moved to the scratchpad (`rev063/`) before cleanup. `git diff --quiet HEAD` passed, and only the ignored `node_modules` symlink and `server/logs/` remained.
- **Database.** I dropped `rev063`, including my sentinel tables and four stored functions, and revoked the `rev063.*` grant I had given `erp_user`. I did not stop the author's mysqld.
- **Processes.** Every app I booted exited, either on SIGTERM to its own PID or by refusing to start. I used no `pkill`.

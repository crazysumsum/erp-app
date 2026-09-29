# REV-062: TASK-042 remediation after REV-061 (PR #165), independent review

Reviewer: an independent agent (REV-062). I did not write this code, and I did not write REV-061 or any earlier review of it.

- **Merge candidate:** e41c2536144a25b841d376e660be5172dee6410d on `claude/supplier-task-042`. `gh pr view 165` reports this as the head, `MERGEABLE`, `CLEAN`.
- **Base named in the brief:** 742d58e. **origin/main has since moved to e36f0de** (PR #164 merged at 15:17:17 +08:00, after this PR's CI ran). See I-16.
- **Commits reviewed:** a0d3f80 and dcb64fe (code and tests), and e41c253 (docs, ledger revision 253). I also re-checked the whole PR from 742d58e.
- **Where I worked:**
  - A detached worktree at `/private/tmp/erp-rev-062`, with `node_modules` symlinked.
  - A second detached worktree at `/private/tmp/erp-rev-062m`. It holds the trial merge of the head into e36f0de. I made that tree with `git merge-tree --write-tree` and `read-tree`; no commit was created.
  - Two private schemas, `rev062` and `rev062m`, on the author's MySQL at 127.0.0.1:3442 (26.7.0). I migrated both as admin with `scripts/migrate.js`, and did not touch `erp_dev`.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Info | 6 |

Disposition: **CHANGES_REQUESTED**.

**What closed.** Most of REV-061 closed, and I ran each item.

- **M-1.** Generic codes now store the fixed Chinese pair. The real worker writes exactly one `supplier.import.failed` line per failed attempt to the system log, with no message text.
- **M-2.** 10 of REV-061's 11 survivors are now killed. M4 remains, and the author has accepted it and said why.
- **M-3.** The documentation half is done.
- **L-1** is closed.
- **L-3** is closed.
- **L-4** is closed for the case REV-061 named.
- The full suite on the trial merge with the current main shows 2327 pass. The only failure is TC-059, which is a pre-existing Customer race and passes when run alone.

**Why I am requesting changes.**

- **M-4.** The new `rowConnection` guard, the optional half of M-3, is described in the carry-forward, the code comment and a test name as refusing `COMMIT`, `SET SESSION` and similar statements. In practice it only refuses the plain leading-keyword spellings.
  - Nine other forms I ran commit the Supplier ahead of its marker. The row is then marked `failed` while the Supplier persists, which is exactly the §8.8 two-phase path M-3 was about.
  - Two more forms pass the guard and poison the connection pool. After one of them, 40 of 40 later transactions in the process failed. After the other, an unrelated user `DELETE` skipped its `ON DELETE SET NULL` and left an orphan reference.
  - The fix is small: turn the guard into an allowlist, or reword the claims so they match what the guard does.
- **I-16.** Separately from the code, main has moved since CI ran. Under the project's merge rule, main must be merged into the branch and CI must pass again before this PR is merged.

### What I ran

- **T42 set on real MySQL (`rev062`).** `supplierImportService`, `supplierImportWorkerService`, `supplierImportExecution.integration` and `serviceContainer` gave **32/32**. That includes the author's 12 `TASK-042:` integration tests.
- **The trigger probe cleans up after itself.** After the run, `information_schema.triggers` held no `sirp_`/`sijp_` probe triggers, and no probe tables were left.
- **CI.** `gh pr checks 165`: all 5 jobs pass on e41c253 (run 36535317872).
  - The MySQL job log lists all 12 `TASK-042:` tests, with `tests 2277, pass 2270, fail 0, skipped 7`.
  - That run tested `pull/165/merge` 2476e28, which is the head merged with **742d58e**, not the current main.
- **Full server suite on the trial merge with e36f0de (`rev062m`).** `tests 2337, pass 2327, fail 1, skipped 9`.
  - The one failure is TC-059, an `ER_LOCK_DEADLOCK` on `customer_import_jobs`.
  - Rerun alone, `customerImportPrecheck.integration.test.js` passes 1/1. It races with `customerImportExecution`, and neither file is touched by this PR.
- **Configuration tests.** All nine `*config*` test files give 99/99.
- **Lint.** `eslint` on every file the PR changed is clean.
- **`state_tool.py inspect docs/supplier_management --repo-root . --json`** returns `BLOCKED`, revision 253. The only issues are `WORKTREE_CHANGED`, `COMMIT_CHANGED` and `SOURCE_CHANGED`, which is the expected in-progress state (REV-061 I-15).
- **`validate_module_boundary.py … --base 742d58e --json`** returns `LOCAL_CHECKS_PASS`.
  - Against `--base origin/main` it returns `BLOCKED`, listing only Inventory files.
  - That is main's own change seen in reverse through a two-dot diff, because the branch is behind main. It is not a scope problem in this PR, and it clears once main is merged in.
- **Reviewer probes.** I wrote `rev062Probes.integration.test.js`, which runs through `createApplication` on `rev062`. It covers:
  - G: the guard bypass matrix;
  - G2: false positives;
  - G3 and G9: session leaks;
  - M1: log payloads and stored errors;
  - C: a deleted confirmer;
  - W: the real worker writing to the real system log.

  I also wrote `l4.mjs` (root parent checks) and a schema script (L-1 edge cases). Copies are in the scratchpad under `rev062/`.
- **Mutation sweep.** `mut062.py` ran 50 mutants: REV-061's 11 survivors plus 39 of my own against the new code.
  - Each mutated file was restored from saved bytes and checked by SHA-256 after every run.
  - After the sweep, `shasum -c` on all five files showed OK.
  - Every mutant changed its file; there was no `NO CHANGE` and no `PATTERN COUNT`.
- **Real entrypoint.** I ran `node src/index.js` three ways:
  - with no root: it listens, registers `job.supplierImportWorker` and `supplier.import.execute`, and exits 0 on SIGTERM;
  - with a root under a 0755 parent: it listens, creates `imports`, `source` and `result` at 0700, and exits 0;
  - with a root under a 0777 non-sticky parent: `application.startup_failed`, "parent directory must not be replaceable", exit 1.

---

## 1. Status of REV-061's findings

| ID | Status | Evidence |
| --- | --- | --- |
| M-1 | **Closed**, with a diagnostic gap (L-6) | **Probe M1:**<br>• A `TypeError`, a guard refusal and `ApplicationError(msg)` each store `SUPPLIER_IMPORT_ROW_FAILED` / 匯入資料列處理失敗.<br>• Each attempt produces exactly one log entry.<br>• When the lease is lost on the failure path, the service logs once, throws `SUPPLIER_IMPORT_LEASE_LOST`, and the row stays `valid`.<br><br>**Probe W:** the registered worker's service wrote one `supplier.import.failed` line to the real system log file, and "secret" does not appear in it.<br><br>**Mutants:** N13, N16, N17 and N19 are killed. N14, N18 and N20 survive (L-7). |
| M-2 | **Closed** for REV-061's survivors | M1, M2, M3, M7, M8, M9, M10, M11, M13 and M14 are all killed. M4 still survives. The author has accepted it and recorded the CHECK backstop, and I agree it is benign. |
| M-3 | **Documentation closed. Guard overstated (new M-4).** | HD-048 (1)–(7) and the T45 rows now name the second-connection trap, the 20 s bound and the real-applyRow test. The guard's gaps are described under M-4. |
| L-1 | **Closed** | **Schema script:**<br>• `error_summary` under `utf8mb4_unicode_ci`, `utf8mb4_bin` or `utf8mb4_general_ci` passes the column check.<br>• `utf8mb3` or `latin1` is refused.<br>• `extra` reads `"auto_increment"`, and a column comment containing `auto_increment` does not fool the check.<br>• An extra NOT ENFORCED CHECK on jobs is refused.<br>• A sole NOT ENFORCED CHECK on rows is refused.<br>• An extra non-unique index is still accepted, which is by design; REV-061 asked about UNIQUE only.<br><br>**Mutants:** N32–N37 and N39 are killed. N38 survives (L-7). |
| L-2 | Accepted | Recorded in the carry-forward. |
| L-3 | **Closed** | • A `running` job with a NULL lease is resumable (N21 is killed).<br>• A queued job without a confirmer is failed (N22, N25 and N26 are killed).<br>• The `queued → failed` transition is legal under `IMPORT_JOB_TRANSITIONS`.<br><br>Observations are in I-17. |
| L-4 | **Closed for the named case.** Incomplete (new L-7 below). | A 0777 non-sticky immediate parent is refused, both in the unit test and at the real entrypoint. A 1777 root-owned parent (`/private/tmp`) is accepted. |
| L-5 | Carried | Recorded in the carry-forward. |
| I-2 | Closed | `quiesce()` now uses only `queued → cancelled` and `running → failed`. |
| I-3, I-4, I-7, I-13 | Carried | They are in HD-048 (5), HD-048 (7), HD-047 (1) and HD-049. **I-4 is still live.** Probe M1 stored `{"code":"SUPPLIER_CODE_TAKEN","message":"secret CSV in message"}` for an `ApplicationError` with a domain code and no `publicMessage`. That is the documented T45 obligation. |
| I-8 | Closed | HD-047 is reworded and reads correctly. |
| I-14 | Recorded | Recorded in the carry-forward. |

## 2. New findings

### M-4 (Medium): the `rowConnection` guard refuses only plain spellings, while the carry-forward and a test name say applyRow cannot commit

**Where:**

- `server/src/modules/supplier/SupplierImportService.js:90-105`, with the regex at `:96`;
- `docs/supplier_management/implementation/62_task_041_carry_forward.md:52` ("already refuses `COMMIT`, `ROLLBACK`, `START TRANSACTION`, `SAVEPOINT`, `SET SESSION`, DDL and `LOCK`");
- `server/test/integration/supplierImportExecution.integration.test.js:403` ("applyRow cannot commit the Supplier ahead of its marker").

**The mechanism.** The guard tests the raw SQL text with `/^\s*(commit|…)\b/iu`. That misses three things:

- comments that come before the keyword;
- keywords split by a comment;
- the many MySQL statements that commit implicitly without being named in the list.

The carry-forward presents the guard to the T45 implementer as enforcement.

**Verified by running (probe G).** On real MySQL, `applyRow` inserted a sentinel row, ran the statement, then threw. Every row ended up `failed`. Result per statement:

| Statement | Guard | Sentinel after rollback |
| --- | --- | --- |
| `COMMIT`, `START\nTRANSACTION` | refused | rolled back |
| `/* x */ COMMIT` | passed | **committed** |
| `-- x\nCOMMIT` | passed | **committed** |
| `# x\nCOMMIT` | passed | **committed** |
| `/*!COMMIT*/` | passed | **committed** |
| `START /* x */ TRANSACTION` | passed | **committed** |
| `ANALYZE TABLE …` | passed | **committed** |
| `OPTIMIZE TABLE …` | passed | **committed** |
| `CHECK TABLE …` | passed | **committed** |
| `CALL p()` where `p` does `COMMIT` | passed | **committed** |
| `PREPARE s FROM 'COMMIT'` then `EXECUTE s` | passed | **committed** |
| `FLUSH TABLES` | passed; MySQL then denied it | **committed** (the implicit commit happens before the privilege check) |
| `XA START` | passed; `ER_XAER_OUTSIDE` | rolled back |
| `SELECT 1; COMMIT` | passed; `ER_PARSE_ERROR` (`multipleStatements` is off) | rolled back |
| `{ sql: "COMMIT" }` | passed; the executor then rejected the non-string | rolled back |
| `SET @@autocommit = 1`, `SET @@session.autocommit = 1`, `SET LOCAL autocommit = 1` | passed | rolled back (no commit under `START TRANSACTION`) |

**Session state leaks onto the pooled connection. These statements also pass the guard (probes G3 and G9):**

- **`SET @@autocommit = 0`.** The connection went back to the pool with autocommit off.
  - Afterwards, **40 of 40** sequential `h.db.withTransaction` calls failed with "Transaction characteristics can't be changed while a transaction is in progress".
  - 40 pool `UPDATE`s returned success, and a read on the same connection saw `v = 40`. The admin client saw `v = 0`, so those writes were never committed. They were lost when the process shut down.
  - Later probe tests in the same process, and the test's own `after()` cleanup, failed the same way.
- **`SET foreign_key_checks = 0`.** The same pooled connection later reported `@@foreign_key_checks = 0`.
  - In the next test, `DELETE FROM users WHERE id = 9` ran on that connection. It skipped `fk_supplier_import_confirmed_by … ON DELETE SET NULL`.
  - Jobs 46 and 47 were left with `confirmed_by = 9`, pointing at a user who no longer exists. I confirmed this with the admin client.
  - Rerun in a clean process, the same DELETE set `confirmed_by` to NULL, as it should.
- **`SET sql_mode = ''`** also persists on the connection.

**No false positives (probe G2).** The guard passed all of these:

- `SELECT … AS release_date, … AS commit_hash … FOR UPDATE`;
- `… LOCK IN SHARE MODE`;
- `WITH … begin_at`;
- a leading `/* */` before a SELECT;
- `SET @r62 = 1`;
- `REPLACE`, `UPDATE` and `DELETE`.

The executor exposes only `query` and `execute`. Those are also the only two methods any Supplier or Customer domain code calls on a connection (grep: 160 `query`, 146 `execute`), so T45 loses nothing.

**Why this is Medium, not Low.** None of these forms is likely in honest T45 code. But REV-061 M-3 was Medium because the atomicity guarantee rested on T45 with nothing enforcing it. The remediation now says something enforces it, and that is not true for the forms above. A T45 author who reads the carry-forward row has good reason to trust the guard. The damage from the two leaks reaches beyond the import itself: it hits unrelated transactions and the foreign-key integrity of the `users` table.

**Recommendation.** Either option is a small change.

1. **Make the guard an allowlist.** It should match what domain helpers actually issue. Strip leading comments (`/* … */`, `-- …`, `# …`), refuse any SQL containing `/*!`, then require:

   ```js
   /^(select|insert|update|delete|replace|with)\b/iu
   ```

   Pin it with a table-driven test over the rows above. That test also kills N3–N11 (L-7).
2. **Or keep the denylist and describe it honestly.** Reword `:52` of the carry-forward and the code comment to say it is a tripwire for the plain spellings only, and that it does not stop comment-prefixed forms, implicit-commit statements, `CALL`, `PREPARE`/`EXECUTE`, or `SET @@…` and session variables. Rename the test at `:403`. Add to HD-048 that T45's `applyRow` must not issue any `SET`.

### L-6 (Low): the failure log does not say which kind of error failed the row

**Where:** `SupplierImportService.js:209-212`.

**The mechanism.** Every error that is not an `ApplicationError` reaches the catch already wrapped by `withTransaction`. So `name` is always `MySqlDatabaseOperationError`, and `code` is always `DATABASE_TRANSACTION_FAILED`.

**Verified by running.**

- **Probe M1.** A `TypeError` in `applyRow`, a guard refusal, and a plain `Error("slow")` all logged the same thing:

  ```json
  {"name":"MySqlDatabaseOperationError","code":"DATABASE_TRANSACTION_FAILED","causeCode":null,"publicCode":"INTERNAL_SERVER_ERROR"}
  ```

- **Probe W.** The real system log line has the same shape.
- SQL errors are distinguishable, because `causeCode` carries `ER_NO_SUCH_TABLE` and similar codes.

In T45, a coding bug and a guard refusal would therefore look identical in the log. REV-061 M-1's complaint that the operator has nothing to go on still applies to every failure that is not SQL.

**Recommendation.** Add `causeName: error?.cause?.name ?? null`. Optionally add the first stack frame of the cause, `cause.stack.split("\n")[1]`, which carries no message text. Assert on it in the existing test at `:383`.

### L-7 (Low): the root's parent check looks at the immediate parent's `lstat` only

**Where:** `server/src/services/supplierImport/supplierImportFiles.js:83-90`.

**Verified by running (`l4.mjs` on macOS APFS).**

- **A symlinked parent is judged by the link, not by its target.** The root was `…/s/link/imports`, where `link` is a symlink to a 0777 non-sticky directory.
  - It was **accepted**, because `lstat(link)` reports mode 0755 and my uid.
  - `mkdir` followed the link and created `imports` inside the 0777 directory. The returned realpath is `…/s/open/imports`, whose real parent is exactly the L-4 case.
  - On Linux, a symlink's `lstat` mode is always 0777, so the same layout would instead be refused with a misleading message. I inferred this; I did not run on Linux.
- **A writable ancestor above the parent is accepted.** `…/g/shared/mine/imports`, where `shared` is 0777 non-sticky and `mine` is 0755 and mine, was **accepted**.
  - Any user who can write to `shared` can rename `mine` and put their own directory or symlink in its place.
  - This is the attack L-4 describes, moved one level up. It is inferred from POSIX rename semantics; I could not run it as a second user.
- **The rules themselves work as intended.**
  - A root-owned 0775 parent is refused, and a parent owned by another user is refused (both injected).
  - A root-owned 0755 parent is accepted.
  - `/private/tmp` (1777, root) is accepted.
  - `/tmp`, which on macOS is a root-owned 0755 symlink, is accepted.
- **Order does not matter for safety.** `mkdir` runs before the check, so a refused root is still created. The real-entrypoint refusal left `badparent/imports` at 0700. That is harmless, because startup fails.

**Recommendation.** Take `realpath(root)` first. Then walk every ancestor of the realpath up to `/` with `stat`, applying the same rule to each one: not group- or other-writable unless sticky, and owned by root or the service user. OpenSSH's `safe_path` works this way.

### L-8 (Low): the remediation's own surface is only partly pinned; 17 of my 39 new mutants survive

**Where:** the test files touched in a0d3f80 and dcb64fe. The carry-forward's "Mutation record" is at `:77`.

**Survivors, all verified by the sweep:**

| Mutant | Change | What it means |
| --- | --- | --- |
| **N20** | The worker no longer passes its logger to the service | The production half of M-1 is unpinned. Probe W shows the wiring works today, but nothing would catch its removal, and REV-061's M-1 defect would silently return. |
| N3–N10 | Each alternative removed from the guard regex: `rollback`, `start transaction`, `begin`, `savepoint`, `release`, `set session/global/autocommit`, DDL, `lock/unlock` | Only `COMMIT` is tested. |
| N11 | `execute` passed through unguarded | The test uses `query` only. |
| N14 | `SERVICE_UNAVAILABLE` treated as a domain code | The row would store "Service unavailable". |
| N18 | `name`, `code` and `publicCode` dropped from the log | The log payload is not pinned. |
| N23, N24 | NOT_CONFIRMED checks only one of `confirmed_by` or `confirmed_at` | The test sets both to NULL. |
| N29, N30 | Parent owner check removed, or root ownership no longer allowed | Not tested. |
| N38 | The rows CHECK `enforced` test removed | A sole NOT ENFORCED CHECK would then be accepted; my schema script shows the unmutated code refuses it. |

Killed (22): N1, N2, N12, N13, N15, N16, N17, N19, N21, N22, N25–N28, N31–N37, N39.

**The author's "40 mutants, all killed" is accurate for the author's own set**, and I re-ran the overlapping ones. Two inaccuracies:

- The text says "REV-061's eleven survivors" but lists ten. M4 is excluded, as the next sentence says, so the total is 39.
- The claim that the remediation is pinned does not extend to the guard, the worker wiring or the parent owner check.

**Recommendation.**

1. A unit test that constructs `SupplierImportWorkerService` and asserts `importService.logger === logger`. This kills N20.
2. A table-driven guard test (see M-4). This kills N3–N11.
3. One `SERVICE_UNAVAILABLE` case, such as `DATABASE_POOL_QUEUE_FULL` wrapped. This kills N14.
4. A `deepEqual` on the log context. This kills N18.
5. Two seeded jobs, each missing only one of the two fields. This kills N23 and N24.
6. An injected-`lstat` parent owned by uid+1. This kills N29. For N30, a parent reported as uid 0.
7. One `ALTER CHECK … NOT ENFORCED` case in the migration test. This kills N38.

### Info

- **I-16. main has moved past the CI run. This is a merge gate, not a code defect.**
  - CI ran at 07:12:55Z on `pull/165/merge` 2476e28, which is the head plus 742d58e.
  - origin/main became e36f0de, PR #164 with 52 files and +6644 lines of Inventory work, at 07:17:17Z.
  - `git merge-tree` merges cleanly. Main's migrations still end at 0060, so there is no numbering collision.
  - My full suite on the trial merge gives 2327 pass. The only failure is the known TC-059 race.
  - Per the project's merge rule: merge main into the branch, wait for green CI on the new head, and then merge.
- **I-17. The NOT_CONFIRMED path is legal but silent, and not recorded (probe C, clean process).**
  - After deleting the confirming user, the queued job became `failed / SUPPLIER_IMPORT_NOT_CONFIRMED`, the claim returned `null`, and the service made **no log call**.
  - A `running` job whose confirmer was deleted was resumed (`{"resumed":true}`, `confirmed_by: null`).
  - `grep` finds no `DELETE FROM users` in `server/src`, so this happens only after a manual deletion. It is not in the carry-forward or in any HD.
  - Recommendation: log `supplier.import.not_confirmed` with the `jobId`, and add one line to HD-048 (6). The T45 confirmer re-check should also cover resumed jobs.
- **I-18. The failure log fires once per attempt, including when the lease is lost.** In that case it reads "row failed", but the row stays `valid` and the new owner retries it (probe M1). This is acceptable. A reader of the log should know that the line does not mean the row is terminal.
- **I-19. `SET @@session.transaction_isolation`, `SET NAMES` and similar session writes pass the guard and persist**, like `sql_mode` in M-4. `withTransaction` sets the isolation level for each transaction, so transactions are unaffected. Non-transactional reads on that connection are. This extends REV-061 I-11 and is closed by the allowlist in M-4.
- **I-20. CI compatibility of the trigger probe.**
  - It uses `DB_ADMIN_*`, falling back to root/root on GitHub Actions. That matches `ci.yml` (`MYSQL_ROOT_PASSWORD: root`) and `supplierBankRestore`'s convention.
  - It fails rather than skipping when admin is not available.
  - The trigger is dropped together with its probe table in `t.after`.
  - The SKIP LOCKED test passes in about 2 ms against a 3 s bound, and its timer is `unref`'d.
  - Across the 50 sweep runs, it appeared among the reported failures only under M1, where it waited the full 3 s.
  - The harness records only the first two failures of each run, so this is weak evidence against flakiness, not proof of its absence.
- **I-21. `quiesce()` still changes every open job in the schema (REV-061 I-14, now documented).** My probe runs left rows in `rev062`, because the M-4 leak broke `after()`. I dropped the schema.

## 3. Mutants

All ran against the three T42 test files on `rev062`, with a byte-exact restore and a SHA-256 check after each run.

| ID | Mutation | Result |
| --- | --- | --- |
| M1 | claim `FOR UPDATE SKIP LOCKED` → `FOR UPDATE` | killed |
| M2 | drop `assertLease` on the failure path | killed |
| M3 | drop lease renewal after an applied row | killed |
| M4 | drop the pending guard on the failure UPDATE | survived (accepted; CHECK backstop) |
| M7 | drop kind-directory `dev` check | killed |
| M8 | `sameDirectory = false` | killed |
| M9 | drop `chmod(root)` | killed |
| M10 | drop `chmod(kind)` | killed |
| M11 | drop kind-directory uid check | killed |
| M13 | drop the rows trigger check | killed |
| M14 | drop lease renewal after a failed row | killed |
| N1 | raw connection to `applyRow` | killed |
| N2 | regex without `commit` | killed |
| N3–N10 | regex without each other alternative | **survived** (8) |
| N11 | `execute` unguarded | **survived** |
| N12 | regex without `^` | killed (false positives on existing SQL) |
| N13 | `INTERNAL_SERVER_ERROR` not generic | killed |
| N14 | `SERVICE_UNAVAILABLE` not generic | **survived** |
| N15 | domain code replaced by the fixed pair | killed |
| N16 | no failure log | killed |
| N17 | log includes the message | killed |
| N18 | log drops `name`, `code` and `publicCode` | **survived** |
| N19 | log twice | killed |
| N20 | worker does not pass its logger | **survived** |
| N21 | `lease_until IS NULL` dropped | killed |
| N22 | NOT_CONFIRMED block removed | killed |
| N23 | NOT_CONFIRMED checks `confirmed_at` only | **survived** |
| N24 | NOT_CONFIRMED checks `confirmed_by` only | **survived** |
| N25 | NOT_CONFIRMED returns a claim | killed |
| N26 | NOT_CONFIRMED leaves the job queued | killed |
| N27 | parent sticky bit ignored | killed |
| N28 | parent mode ignored | killed |
| N29 | parent owner ignored | **survived** |
| N30 | root not allowed as parent owner | **survived** |
| N31 | parent check `lstat`s the root itself | killed |
| N32 | jobs `auto_increment` ignored | killed |
| N33 | jobs charset ignored | killed |
| N34 | jobs extra UNIQUE allowed | killed |
| N35 | jobs CHECKs allowed | killed |
| N36 | rows extra UNIQUE allowed | killed |
| N37 | rows `checks.length !== 1` → `< 1` | killed |
| N38 | rows `enforced` ignored | **survived** |
| N39 | rows compares any CHECK instead of exactly one | killed |

## 4. What held

- **Atomicity for plain misuse.** `COMMIT`, `START TRANSACTION` and the rest of the plainly spelled list are refused. The row rolls back with its Supplier, and the row is marked `failed`, not left stuck (probe G, and the author's test).
- **The executor boundary.** A non-string SQL argument is rejected before it reaches mysql2, and `multipleStatements` is off, so stacked statements fail to parse.
- **M-1 storage.** No internal message is stored for any error that is not a domain error, and the log carries no message text. The one exception is the carried I-4 case.
- **L-1** is robust to utf8mb4 collation names, reads `extra` correctly, and refuses NOT ENFORCED CHECKs. Moving the CHECK inspection earlier only changes which error a doubly broken table reports first.
- **L-3.** A leaseless running job is resumed, and an unconfirmed queued job is failed through a legal transition.
- **The real entrypoint** boots with and without a root, and refuses a root under an insecure parent with exit 1.
- **The ledger.** REV-061 is recorded as `SEPARATE_AGENT`, `CHANGES_REQUESTED`, 0 critical and 0 high, with `source_ref` pointing at the committed report. HD-047 and HD-049 are precise and actionable. HD-048 is actionable, except for its reliance on the guard (M-4).
- **CI** is green on the head. The trial merge with the current main passes the full suite, apart from the known TC-059 race.

## 5. What I could not verify

- **Linux behaviour of the L-7 parent check.** The symlink's `lstat` mode and a real second-user rename are inferred from POSIX semantics. I ran only on macOS as a single user.
- **CI on the current main.** I did not push, so the merged tree is verified locally only.
- **MySQL versions other than 26.7.0.**
- **How long a poisoned pooled connection lives in production** (M-4, `autocommit = 0`). In my process it persisted for the rest of the run. I did not measure mysql2's idle eviction.
- **Whether `SET foreign_key_checks = 0` could come from any existing domain helper.** A grep finds no such statement in `server/src/modules`. The M-4 leak therefore needs new T45 code; I inferred this from the grep.

## Restoration

- I committed, pushed and commented on nothing. I did not touch `/Users/sam/Documents/workspace/erp-app`'s working tree, `…/erp-app-worktrees/task-042` or `erp_dev`.
- The probe file was deleted before the worktree was removed. Copies are in the scratchpad under `rev062/`.
- **Database.** I dropped `rev062` and `rev062m`, including my sentinel tables and procedure, and revoked the matching grants. I did not stop the author's mysqld.
- **Processes.** Every app I booted exited, either on SIGTERM to its own PID or by refusing to start. I used no `pkill`.
- `/private/tmp/r62` was removed.

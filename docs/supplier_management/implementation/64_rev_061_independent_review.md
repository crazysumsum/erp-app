# REV-061: TASK-042 import persistence, worker and per-row transaction contract (PR #165), independent review

Reviewer: an independent agent (REV-061). I did not write this code, and I did not write any earlier review of it.

- **Merge candidate:** 405830ac628b2f822562a62822113115ef97a5e7 on `claude/supplier-task-042`. `gh pr view 165` reports this as the head (`MERGEABLE`).
- **Base:** origin/main 742d58e. I re-fetched during the review, and main had not moved.
- **Commits reviewed:** f441e72 (migrations), ea88eaa (service, worker, root), 47d5881 and 0027c24 (tests), 405830a (docs, ledger revision 252).
- **Where I worked:** a detached worktree at `/private/tmp/erp-rev-061`, with `node_modules` symlinked from the main checkout. For the database I used a private schema, `rev061`, on the author's MySQL (127.0.0.1:3442, version 26.7.0, the same version CI pins). I migrated it as admin with `scripts/migrate.js`. I did not touch `erp_dev`.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 5 |
| Info | 15 |

Disposition: **CHANGES_REQUESTED**.

**The core of T42 is sound. I ran it and it held.**

- The success path is one transaction. Row selection, lease check and marker all happen under the job's `FOR UPDATE` lock and an owner check. Because of that lock, there is only ever one writer, even with clock skew.
- In 24 concurrent claims, no job was claimed twice. A job whose row transaction is still running is skipped, not waited on (1 ms).
- If the lease is lost between the failed row transaction and the marking transaction, the row stays pending. The next owner redoes it. That is the correct outcome, because nothing was committed.
- The migrations converge through `migrate.js` in every partial state I tried, and fail closed on a missing CHECK.
- Driven through the real scheduler, the lifecycle behaved correctly end to end. Details are in §4.

**Why I am requesting changes.** None of the three Mediums corrupts data in T42 as merged; the worker cannot claim anything until T45. But each one leaves a guarantee this task claims to have established either unpinned or untrue.

- **M-1.** Every row failure that is not a domain error is recorded as the English `INTERNAL_SERVER_ERROR` / "Internal server error". The real cause is never logged anywhere. The Supplier-specific fallback in `rowError` cannot be reached.
- **M-2.** 11 of the 13 non-equivalent mutants I ran survive the T42 suite. They include the lease re-assertion on the failure path, the lease renewal, `SKIP LOCKED`, and four of the root-hardening checks that the carry-forward marks **Done**.
- **M-3.** Atomicity depends entirely on how T45's `applyRow` behaves, and nothing enforces it. I showed that an `applyRow` which COMMITs, or which writes through `database.withTransaction`, leaves a Supplier committed while its row is marked `failed`. Every existing Supplier write service opens its own transaction in exactly that way. HD-048 does not warn about this.

M-1 and M-2 are small code and test changes. M-3 needs only a change to the carry-forward and the ledger (HD-048), plus an optional cheap guard.

### What I ran, and on what

- **T42 set on real MySQL.** `node --test --import ./test-support/testEnv.js test/supplierImportService.test.js test/supplierImportWorkerService.test.js test/integration/supplierImportExecution.integration.test.js test/serviceContainer.test.js` gives **26/26**, including the author's 6 integration tests.
- **`migrations.integration.test.js`** gives 14/14, but it does not touch 0061 or 0062 (L-5).
- **CI.** `gh pr checks 165`: all 5 jobs pass on 405830a. The MySQL job log shows all six `TASK-042:` integration tests, and `tests 2271, pass 2264, fail 0, skipped 7`. I did not run the full `npm test` locally; I relied on CI for it.
- **`state_tool.py inspect docs/supplier_management --repo-root . --json`** returns `BLOCKED`, revision 252. The only issues are `WORKTREE_CHANGED` (it is my worktree), `COMMIT_CHANGED` and `SOURCE_CHANGED`. This is the expected in-progress state, the same as REV-060 I-14.
- **`validate_module_boundary.py docs/supplier_management --repo-root . --base 742d58e --json`** returns `LOCAL_CHECKS_PASS`.
- **Reviewer probes.** I wrote three scratch integration files, run on real MySQL through `createApplication`. Copies are in the scratchpad under `rev061/`.
  - `rev061Probes`: E1–E10, covering concurrency, lease, atomicity, error recording and lock footprint.
  - `rev061Lifecycle`: two app instances and the real scheduler.
  - `rev061Schema`: blind spots in the schema inspection.
- **Mutation sweep.** I ran 15 mutants with `mut061.py`. Each mutated file was restored from saved bytes and checked by SHA-256 after every run. See §3.
- **Real entrypoint.** I ran `node src/index.js` via `r61boot.sh`, with a random `APP_PORT` and `DB_NAME=rev061`. Each run was stopped with SIGTERM to its own PID, or exited on its own.
- **Migration convergence.** I ran `scripts/migrate.js` as admin from these starting states:
  - a fresh schema;
  - the rows table dropped and its ledger row removed;
  - both tables present but both ledger rows removed;
  - a plain rerun;
  - a rows table without the CHECK.
- **PR #164 numbering.** I fetched `pull/164/head` into a temporary ref, diffed it against main, and then deleted the ref.

### Restoration

- I committed, pushed and commented on nothing. The only change I made in `/Users/sam/Documents/workspace/erp-app` was a temporary ref, `refs/remotes/rev061/pr164`, which I deleted right after use. Its `git status` is clean. I did not touch `…/erp-app-worktrees/task-042` or `erp_dev`.
- The probe test files were deleted before I removed the worktree. `git diff --quiet HEAD` passed, and only the ignored `node_modules` symlink and `server/logs/` remained. I removed the worktree with `git worktree remove --force`, which was needed only because of the ignored files. The main checkout's `node_modules` still has 347 entries.
- **Database.** I dropped the `rev061` schema and revoked the `rev061.*` grant I had given `erp_user`. `SHOW GRANTS` is back to `USAGE` plus `erp_dev.*`. I did not stop the author's mysqld.
- **Processes.** Every app I booted exited, either on SIGTERM to its own PID or by refusing to start. I used no `pkill`. Afterwards no process referenced the worktree, and nothing was listening on the probe ports.
- **Scratch data.** `/private/tmp/r61` and `/private/tmp/r61case` were deleted.

---

## 1. Findings

### M-1 (Medium): row failures are recorded as "Internal server error", and the cause is discarded

**Where:**

- `server/src/modules/supplier/SupplierImportService.js:77-81` (`rowError`) and `:168-188` (the catch path);
- `server/src/services/mysqldatabase/MySqlDatabaseService.js:548-556` (`withTransaction` wraps every non-`ApplicationError`);
- `:18-29` (`MySqlDatabaseOperationError`: `publicCode` `INTERNAL_SERVER_ERROR`, `publicMessage` `"Internal server error"`).

**The mechanism.** `rowError` reads `error.publicCode ?? "SUPPLIER_IMPORT_ROW_FAILED"`. But the error that reaches the catch has already been through `withTransaction`. Anything that is not an `ApplicationError` has been rewrapped as a `MySqlDatabaseOperationError`, which is an `ApplicationError` with `publicCode: "INTERNAL_SERVER_ERROR"`. That covers a SQL error, a `TypeError` in `applyRow`, the service's own `TypeError("applyRow must return the Supplier ID it wrote")`, and a lock-wait timeout. So the Supplier-specific fallback never applies. The comment's promise of "only a code and one fixed message" is not what gets stored.

Nothing logs the real error:

- the catch path does not log;
- the worker logs only `supplier.import.claimed` and `supplier.import.completed`;
- `withTransaction` logs only rollback, destroy and indeterminate-commit failures.

**Concrete failure.** In T45 a bug in `applyRow`, or a missing column, fails every row. The result is a job that is `completed_with_errors`, where every row reads `{"code":"INTERNAL_SERVER_ERROR","message":"Internal server error"}`. That English text lands in a Chinese result file (T46). The operator has no log line, no SQL code and no stack to go on.

**Verified by running:**

- **E8.** A real `SupplierImportWorkerService` with a spy logger drove two rows. One failed on `SELECT * FROM no_such_table_r61` and one on a `TypeError`. Both rows stored `INTERNAL_SERVER_ERROR` / "Internal server error". The logger received only the two `info` calls.
- **E9.** A lock-wait timeout (ER_LOCK_WAIT_TIMEOUT) inside `applyRow` stored the same pair.
- **Existing coverage.** The integration test covers only a domain `ApplicationError` with an explicit `publicMessage`. The `returnId: false` case asserts `status` only, not `errors`.

**Recommendation.**

1. In the catch path, before marking the row, log once at `error` (or `warn`) with `jobId`, `rowNumber`, `error.code`, `error.cause?.code`, `error.name`, and no message text from the CSV.
2. Store a public code only when it is a domain code. Map the framework's generic codes to the fixed Supplier pair, as Customer's `safeRowError` does with its fixed message:

   ```js
   const GENERIC = new Set(["INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE"]);
   function rowError(error) {
     const code = error?.publicCode;
     return GENERIC.has(code) || !code
       ? [{ code: "SUPPLIER_IMPORT_ROW_FAILED", message: "匯入資料列處理失敗" }]
       : [{ code: String(code), message: String(error.publicMessage) }];
   }
   ```

3. Add a test: an `applyRow` that throws a `TypeError` and one that runs bad SQL. Expect `SUPPLIER_IMPORT_ROW_FAILED` and exactly one error-level log entry.

### M-2 (Medium): the lease and root-hardening guards are not pinned; 11 of 13 non-equivalent mutants survive

**Where:**

- `SupplierImportService.js:103` (`SKIP LOCKED`), `:162-165` and `:182-185` (lease renewal), `:173-175` (lease re-assertion on the failure path), `:179` (pending guard on the failure path);
- `supplierImportFiles.js:87`, `:92`, `:95` and `:109`;
- `0062_create_supplier_import_rows.js:134`.

**The survivors.** Details are in §3.

| Mutant | What it removes | Result |
| --- | --- | --- |
| M1 | `SKIP LOCKED` | survived |
| M2 | lease re-assertion on the failure path | survived |
| M3 | lease renewal after an applied row | survived |
| M14 | lease renewal after a failed row | survived |
| M4 | pending guard on the failure path | survived (the CHECK backstops the applied case) |
| M7 | kind-directory `dev` check | survived |
| M8 | `dev`/`ino` same-directory check | survived |
| M9 | `chmod` of an existing root | survived |
| M10 | `chmod` of an existing kind directory | survived |
| M11 | kind-directory owner check | survived |
| M13 | trigger check in 0062 | survived |

Of the rest, M12 and M15 were killed. M5 and M6 are equivalent (I-2).

**Why these matter.**

- **M2 is the guard the review brief asks about.** I ran my E5 probe against M2 as a discriminating control. With the re-assertion in place, a worker whose lease expired mid-failure leaves the row `valid`, and the new owner applies it. With M2, the old worker marks the row `failed` although it no longer owns the job, so the row is never retried.
- **M3 and M14.** Without renewal, a job that runs longer than the 660 s `LEASE_MS` is taken over in the middle of the run.
- **M8 and M9 back obligations the carry-forward marks "Done".** M8 is the `dev`/`ino` half of "realpath + dev/ino". M9 is the 0700 guarantee for a root that already exists (I checked that a pre-existing 0750 root is tightened to 0700). The author's mutation record lists "the realpath overlap skipped" as killed. That is true of the realpath half only.

**Recommendation.** Add pinned tests for each of these; none needs new infrastructure.

- Add E5 as an integration test. `applyRow` advances the clock past the lease and then throws. Expect `SUPPLIER_IMPORT_LEASE_LOST`, the row still `valid`, and a new owner that applies it.
- Assert `lease_until` after an applied row and after a failed row.
- Add a claim made while another transaction holds the job's `FOR UPDATE` lock. Expect `null` within a short bound, which kills M1.
- Add a pre-existing 0750 root with a 0770 `source`. Expect 0700 on both.
- Add a `source` that belongs to another uid, using the injected `uid`, and a kind directory reported on another device (inject `lstat` the way `listSupplierImportFiles` already allows).
- Add the `dev`/`ino` case with an injected `lstat`.
- Add a rows probe table carrying a trigger. Expect a refusal.

### M-3 (Medium): atomicity rests entirely on T45's `applyRow`, and HD-048 does not name the trap

**Where:**

- `SupplierImportService.js:149` (the `applyRow` call);
- `server/src/modules/supplier/SupplierAdminService.js:171`, `:285`, `:403`, `:478`, `:612` and `:852`, and every write in `SupplierAddressService`, `SupplierContactService`, `SupplierBankService` and `SupplierApprovalService` (each opens its own `this.database.withTransaction`);
- `docs/supplier_management/00_harness_state.json` HD-048;
- `62_task_041_carry_forward.md`, "Status after TASK-042".

**The mechanism.** `withTransaction` hands `applyRow` a `MySqlDatabaseExecutor`. That executor forwards any SQL, including `COMMIT`, and `database.withTransaction` always takes a new pooled connection; it never joins the ambient transaction. Design §8.8 requires the worker to use "the same domain helper as the API" (使用API相同domain helper). Every existing Supplier write helper opens its own transaction. Calling one of them from `applyRow` is therefore exactly the forbidden "commit Supplier first, mark applied later" two-phase success path.

**Verified by running:**

- **E4.** `applyRow` writes a Supplier, runs `COMMIT` on the connection it was given, then throws. The Supplier **survives**, and the row is `failed`.
- **E4b.** `applyRow` writes the Supplier through `h.db.withTransaction`, then throws. The Supplier **survives**, and the row is `failed`.
- In both cases the job would report the row as failed while an unmarked Supplier exists. A retry by the user then creates a duplicate.
- **Isolation.** `SET TRANSACTION ISOLATION LEVEL` inside the transaction fails with 1568, so the row fails safely. `SET SESSION TRANSACTION …` succeeds and persists on the pooled connection after `COMMIT` (verified in the `mysql` client; see I-11).

The author's integration test proves atomicity with a hand-written `applyRow` that uses the connection correctly. That is a double which matches the contract, not the real layer.

**Recommendation.**

1. **Required (documentation only).** Extend HD-048 and the T45 row in the carry-forward. `applyRow` must:
   - call connection-taking domain helpers, extracted from `SupplierAdminService` and the other services, whose public methods open their own transactions and must not be called from `applyRow`;
   - issue no `COMMIT`, `ROLLBACK`, `START TRANSACTION`, `SAVEPOINT`, DDL or `SET SESSION`;
   - finish within `DB_TRANSACTION_TIMEOUT_MS` (20 s by default), because the whole row, job lock included, lives inside `withTransaction`.

   T45 must also ship an integration test with the **real** `applyRow`. It should inject a failure after the Supplier write (the `stealRow` pattern) and assert that no Supplier, audit or name-gram row survives.

2. **Optional (small T42 code).** Hand `applyRow` a narrow executor that refuses those statements before delegating:

   ```js
   const FORBIDDEN = /^\s*(commit|rollback|start\s+transaction|begin|savepoint|release|set\s+(session|global|autocommit)|create|alter|drop|truncate|rename|lock|unlock)\b/iu;
   ```

### L-1 (Low): schema inspection accepts tables that §5.14 says must fail closed

**Where:**

- `0061_create_supplier_import_jobs.js:66-129`: `id` `extra` is not read; extra indexes, CHECKs and `error_summary`'s charset are not inspected;
- `0062_create_supplier_import_rows.js:106-127`: `some()` over the CHECKs, and extra indexes allowed.

**Verified by running.** On my own `rev061.supplier_import_jobs`, I made four changes, confirmed each with `SHOW CREATE TABLE`, and then ran `inspectSupplierImportJobSchema` and `up()`:

- removed `AUTO_INCREMENT` from `id`;
- added `UNIQUE KEY (status)`, which allows one job per status;
- made `error_summary` latin1;
- added `CHECK (status <> 'cancelled')`.

Both calls returned `true` and "converged". On rows probe tables, an extra `UNIQUE(job_id,status)` and an extra `CHECK (status <> 'skipped')` were both **accepted**.

§5.14 requires the unique/index contract (unique/index契約) to be checked. The precedents (0029, 0037) have the same gap, so this is consistent with the module, but it is not what §5.14 asks for.

**Recommendation.**

- Read `extra` and require `auto_increment` on `jobs.id`.
- Refuse any UNIQUE index that is not in `INDEXES`.
- Pin `error_summary`'s charset to `utf8mb4`.
- For rows, require the CHECK set to be exactly `{APPLIED_CHECK}`; for jobs, require it to be empty.

### L-2 (Low): the claim locks every queued or running candidate, so concurrent claimers get `null`

**Where:** `SupplierImportService.js:100-105`.

**Verified by running.**

- **E1.** With 4 queued jobs, 8 concurrent `claimForExecution` calls claimed **exactly 1 job per burst**, three bursts in a row. The other 7 returned `null`. There were no errors and no double claims.
- **E10.** `EXPLAIN` shows an index range scan on `idx_supplier_import_status`, then a filesort by `confirmed_at`, then `LIMIT 1`. While one claim transaction is open, a second-queued job that it did *not* claim is locked (`FOR UPDATE NOWAIT` gives `ER_LOCK_NOWAIT`). A concurrent claim returns `null`.
- Under REPEATABLE READ, every candidate is read and locked before the sort, so `SKIP LOCKED` buys non-blocking but not distribution.

This is liveness only: the next 5 s tick claims the next job. The scan also briefly blocks the next row transaction of a job that is between rows.

**Recommendation.** Accept this, and say so in the design notes. Alternatively, query `status='queued'` through an index that already gives `(status, confirmed_at, id)` order, so `LIMIT 1` stops at the first unlocked row. That index is a schema change and would need a new approval.

### L-3 (Low): the claim predicate trusts invariants the schema does not enforce

**Where:** `SupplierImportService.js:102-103`.

**Verified by running.**

- **E7.** A queued job with `confirmed_at NULL` is claimed **before** an older confirmed job, because NULL sorts first.
- **E6.** A `running` job with `lease_until NULL` is **never** claimable, even after the clock moves 10^10 ms, so it is stuck for good. No T42 path writes that state, but nothing prevents one. T44 and T45 will add status writes.

**Recommendation.** A code-only fix:

- Change the predicate to `(status = 'running' AND (lease_until IS NULL OR lease_until < ?))`.
- Refuse, or fail, a queued job without `confirmed_at` or `confirmed_by`. T45 needs `confirmed_by` for the authorisation re-check anyway.

### L-4 (Low): the root's parent directory is not checked

**Where:** `supplierImportFiles.js:80-87`.

**Verified by running.** `prepareSupplierImportRoot("/private/tmp/r61/shared/imports")`, under a 0777 non-sticky parent, is **accepted**. Any local user with write access to the parent can rename `imports` within the same parent and put a symlink or their own directory in its place after startup. T43 and T46 would then write CSVs there. HD-044's re-check before unlink covers the purge, but not the writes.

**Recommendation.** `lstat(path.dirname(root))`. Refuse it if it is group- or other-writable without the sticky bit, or if it is owned by someone other than root or the service user.

### L-5 (Low): T42's `migrations.integration.test.js` verification passes without touching 0061 or 0062

**Where:** `05_development_tasks.md`, the T42 Verification section; `server/test/integration/migrations.integration.test.js`, which covers 0006–0028 only.

**Verified by running.** It gives 14/14, none of which touch the new tables. The real convergence and fail-closed coverage for the new migrations is in `supplierImportExecution.integration.test.js`.

**Recommendation.** Record in the carry-forward, or in the ledger evidence, that this verification item was met by that file. Alternatively, add one case to `migrations.integration.test.js`.

### Info

- **I-1.** `stopping` has no effect in the real app. `performShutdown` stops the scheduler, which aborts the job signal, *before* it calls `services.shutdown()` (`createApplication.js:302-317`). The worker stops because of the abort. I confirmed this in the lifecycle probe. The unit test calls `shutdown()` directly, which the real app never does first. The flag is harmless as defence in depth.
- **I-2.** Both `assertJobTransition` calls can never fail. The claim's `WHERE` and `finalize`'s `assertLease` already guarantee a legal move, so M5 and M6 are equivalent mutants. The test's `quiesce()` performs `running → cancelled`, which the state machine forbids.
- **I-3.** Transient errors mark rows permanently `failed`. That includes a lock-wait timeout (E9), a deadlock, and `DATABASE_TRANSACTION_TIMEOUT` (`SERVICE_UNAVAILABLE`). This follows §5.13 and matches Customer. Whether to retry transient errors is a product question for T45 or T46.
- **I-4.** `rowError` drops `publicDetails`, so T45 loses field-level detail for the result file. `ApplicationError` also defaults `publicMessage` to `message`, so an `ApplicationError` built without an explicit `publicMessage` would store its internal message.
- **I-5.** Windows is inferred, not run. `process.getuid` is undefined there, so the owner check is skipped. Windows directory modes normally report 0o666 bits, so the 0o022 check would refuse every root. CI and deployment are Linux-only.
- **I-6.** Other roots that return ENOENT are skipped (`supplierImportFiles.js:106`). A root created later through a symlinked component is never compared. This is inferred; the config-level string check still applies.
- **I-7.** `server/config/supplier.js:14` still says the root becomes required at T42, which HD-046 (a) has superseded. The file is approval-required, so this is best carried with HD-047.
- **I-8.** HD-047's wording is garbled: "before TASK-043, TASK-044 is DONE, confirm it refuse…".
- **I-9.** There is no numbering collision. PR #164 (`codex/inventory-p1-integration`, e46e607) adds no migrations compared with main, whose last migration is 0060. If #164 later adds one, whichever PR merges second must renumber.
- **I-10.** The CREATE TABLE statements have no ENGINE or CHARSET clause. That matches every Supplier migration. `error_summary` inherits the database default (`utf8mb4_0900_ai_ci` here), and L-1 would not notice a latin1 default. JSON columns are unaffected.
- **I-11.** An `applyRow` that runs `SET SESSION TRANSACTION ISOLATION …` leaks that level to the pooled connection for later non-transactional queries. `withTransaction` sets the per-transaction level each time, so transactions are unaffected.
- **I-12.** The job row stays locked `FOR UPDATE` for the whole row transaction. That is bounded by `transactionTimeoutMs` (20 s), and the connection is destroyed on timeout. T44 operations that lock the job will wait up to that long.
- **I-13.** `finalize` rebuilds `applied`, `failed` and `skipped`, but not `total`, `valid`, `warning` or `invalid`. It also does not check the §8.8 invariant `total = applied + failed + skipped` against `total_count`. T43 writes `total_count`, so this should be carried to T43 or T46.
- **I-14.** The integration test's `quiesce()` cancels **every** queued or running job in the schema it runs against. That is harmless in CI, where only this file uses the tables. It is not harmless if someone runs a manual lifecycle check on `erp_dev` at the same time.
- **I-15.** `state_tool inspect` returns `BLOCKED` with WORKTREE, COMMIT and SOURCE changed. This is expected while the task is in progress.

## 2. HD-045, HD-046 and the carry-forward: soundness (not re-litigated)

- **HD-045 is implemented as approved.**
  - The columns are the §5.13 set only. `idempotency_key`, `operation_id` and `*_storage_status` are absent.
  - The CHECK is `((status='applied') = (applied_supplier_id IS NOT NULL))`. The database enforces it in both directions; the author's test does this, and I re-ran it.
  - `rows.job_id` is `ON DELETE RESTRICT`.
  - The migration files are byte-identical between f441e72 (the approval's `code_commit`) and HEAD.
  - `APPROVAL-HD-045-SCOPE` covers exactly the two migration files, plus the module id.
- **HD-046 (a) is implemented as approved.**
  - With no root, the worker registers and does nothing. The real entrypoint logged `supplier.import.execute` registered and exited 0 on SIGTERM.
  - With a valid root, `source` and `result` are created 0700.
  - With a group- or other-writable root, the app refuses to start: `application.startup_failed`, exit 1. Failing closed on a bad root that has been set is consistent with (a).
- **Carry-forward precision.** M-3 (HD-048) and I-8 (HD-047) need rewording. HD-041's rows are partly unpinned (M-2).

## 3. Mutants

All ran against the three T42 test files on real MySQL, with byte-exact restore and a SHA-256 check after each run. The harness can kill mutants: M12 and M15 were killed.

| ID | Mutation | Result |
| --- | --- | --- |
| M1 | claim `FOR UPDATE SKIP LOCKED` → `FOR UPDATE` | survived |
| M2 | drop `assertLease` on the failure path | survived (E5 discriminates, see M-2) |
| M3 | drop lease renewal after an applied row | survived |
| M4 | drop `AND status IN ('valid','warning')` from the failure UPDATE | survived (CHECK backstop) |
| M5 | drop claim `assertJobTransition` | survived (equivalent) |
| M6 | drop finalize `assertJobTransition` | survived (equivalent) |
| M7 | drop kind-directory `dev` check | survived |
| M8 | `sameDirectory = false` | survived |
| M9 | drop `chmod(root)` | survived |
| M10 | drop `chmod(kind directory)` | survived |
| M11 | drop kind-directory `uid` check | survived |
| M12 | worker ignores `stopping` | **killed** |
| M13 | drop the trigger check in 0062 | survived |
| M14 | drop lease renewal after a failed row | survived |
| M15 | skip the `invalid → skipped` update | **killed** |

## 4. What held

- **One-transaction success path, under the real `withTransaction`.** I re-ran the author's tests. A failure after the write rolls back both the Supplier and its audit; a marker that cannot be written rolls back the Supplier; an `applyRow` that returns no id is a failure.
- **No double claim** across 24 concurrent claims (E1).
- **An in-flight row transaction makes its job unclaimable, even with an expired lease** (E2: `null` in 1 ms). After it commits, the new owner claims the job, and the old owner's next row gets `SUPPLIER_IMPORT_LEASE_LOST`.
- **Clock skew cannot cause a double apply.** Every row write runs under the job's `FOR UPDATE` lock with an owner check, and the marker is guarded on status. Skew can only cause an early takeover. This is inferred from E2 and the code.
- **A lost lease between the two transactions leaves the row pending, and the next owner applies it** (E5). This is stricter than Customer, whose failure path does not re-check the lease.
- **Lock order** is always job then rows, and claims use `SKIP LOCKED`, so there is no deadlock cycle. No errors appeared in any concurrent probe. This is inferred, backed by E1 and E10.
- **Lifecycle through the real scheduler, with two app instances on real MySQL:**
  1. Instance 1 claimed the job on a tick.
  2. On `app.shutdown()` it finished the row in flight and stopped between rows (466 ms), with the lease kept (`aaavvv`).
  3. Instance 2 did not claim the job while the lease was live (6 s).
  4. After the lease was forced to expire, instance 2 resumed and completed the job: `aaaaaa`, `applied_count` 6, 6 Suppliers, no duplicates.
- **Migrations.** `migrate.js` converges from a fresh schema, from a missing rows table, from missing ledger rows, and on a plain rerun. It fails closed on a rows table without the CHECK, then converges once the CHECK is restored. The quoted `row_number` works throughout.
- **CHECK normalisation** matches what MySQL 26.7.0 stores, `((\`status\` = _utf8mb4\'applied\') = (\`applied_supplier_id\` is not null))`. CI pins the same version. Any other rendering fails closed.
- **The realpath case claim is true on this macOS APFS.** `fs.promises.realpath("/…/CUSTOMER")` returns `/…/Customer`. (`fs.realpathSync` does not restore case; the code uses the promise version.)
- **Other root checks.** A pre-existing 0750 root with a 0770 `source` is tightened to 0700 and 0700. Roots must be absolute, so the cwd plays no part.
- **Registration everywhere is cheap.** An inert `runExecution` returns before it touches the database.
- **Boundary and CI.** The boundary check gives `LOCAL_CHECKS_PASS`; CI is green on the head, and the MySQL job ran the new integration tests.

## 5. What I could not verify

- MySQL versions other than 26.7.0, in particular the CHECK rendering on 8.0 or 8.4. Local and CI are both 26.7.0.
- Windows behaviour of `prepareSupplierImportRoot` (I-5, inferred).
- The indeterminate-COMMIT path. I did not induce it. By code reading, the failure transaction waits on the job lock, and the status guard plus the CHECK prevent overwriting an applied row.
- Linux bind mounts, the only case where the `dev`/`ino` comparison adds anything over realpath.
- A server-side zombie transaction after `withTransaction` destroys a connection that is stuck in a lock wait. I infer it holds its locks until `innodb_lock_wait_timeout` (50 s) and then rolls back.
- Whether the Product Owner's chat approval of HD-045 came before the migration commit (f441e72 at 14:11). The ledger records the approval at 14:42, bound to f441e72.
- The full local `npm test`, including TC-059. I relied on CI, which shows 2264 pass and 0 fail.

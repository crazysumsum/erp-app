# REV-078: TASK-049 (PR #192), independent review

Reviewer: REV-078, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> text below is the reviewer's, apart from this note and light formatting. The "Author's follow-up" section at the end is the
> author's.

- **Commit:** `48c2fd0e19b54f6f7854448d31ec2189114ce992` (PR #192), base `main` `5257858`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev078`, clean at the end.
- **Database:** its own schema, `erp_rev078`, on MySQL 3449.

## Verdict: CHANGES_REQUESTED

The product code is sound. The HD-075 lease release cannot cause double processing, `findDuplicates: false` removes
nothing the import relied on, and the export gate counts correctly. The benchmark script and two statements in the operator
guide need to change. There is 1 Medium finding, 4 Low and 7 Info.

## Findings

- **M-1: the benchmark has no guard against a database that is not throwaway, and its worker takes over other jobs**
  (reproduced).
  - The script starts a full `node src/index.js` with every scheduler job enabled. It does not check the target database,
    and `config/database.js` falls back to `erp_dev` when `DB_NAME` is unset.
  - In a test, an unrelated `uploaded` job ended `failed / SUPPLIER_IMPORT_SOURCE_UNAVAILABLE` with `files_purged_at` set
    and an `import.precheck` audit, while the report still said `ok: true`.
  - Inferred: the child loads `server/.env` through dotenv and the parent does not, so with a partial `DB_*` environment the
    two could target different databases.
  - Suggestions: require an explicit throwaway `DB_NAME`; refuse to run when other non-terminal jobs exist; pass `DB_*`
    explicitly to the child.
- **L-1: cleanup runs only on success** (reproduced). A failed run left an active `bm49-` user holding `supplier.mgmt`
  (password hash `x`), its job and audits. A failed crash run could also leave up to 10,000 `BM49-` Suppliers (inferred).
  Suggestion: move cleanup into `finally`.
- **L-2: two statements in the docs are wrong.**
  - "A run cut off by its timeout is recorded as timed out" is false for `supplier.import.execute`: it stops cooperatively
    and is recorded as `succeeded` with `timeouts 0` (reproduced with a probe).
  - "Only a dead process waits for the lease" does not hold either: the release is not in `finally`, so a thrown
    `DATABASE_QUERY_TIMEOUT` or `LEASE_LOST` keeps the lease for 11 minutes (inferred from code).
  - Suggestions: fix both sentences; optionally release in `finally`, which is safe, and log a separate event for a run cut
    off by its timeout.
- **L-3: the export gate frees its slot before the response is sent** (inferred). The CSV string and its `Buffer` copy
  (about 140 MB for the 69 MB worst case) live until a slow client has read them. Bounded by the request limiter, it needs
  `supplier.mgmt` plus a password, and it was not measured. Suggestion: hold the slot until the response finishes, or
  document that the gate bounds only the build peak.
- **L-4: the end-to-end test covers only approval on with activation.** Draft and approval off are covered by other tests
  in the same file, so the carry-forward's "AC 1 … Pass" should cite those tests too.

## Info

- **I-1:** a mutant that drops `status = 'running'` from the release SQL survived. It is harmless in practice but
  untested.
- **I-2:** `finalizeExecution`'s doc comment now sits above `releaseExecutionLease`.
- **I-3:** `releaseExecutionLease` skips the input checks its sibling methods do.
- **I-4:** what the benchmark metrics mean.
  - "Precheck" is mostly worker boot plus the first poll, so it is an upper bound.
  - `dbConnectionsPeak` counts the whole server's `DB_USER` connections.
  - The download and export memory figures are end-state differences, not peaks.
  - `appliedRowsAtKill` is a lower bound.
  - The evidence does not record `innodb_flush_log_at_trx_commit` or `sync_binlog`.
- **I-5:** the `BANK_VALUE` part of the leak scan means something only together with earlier tests in the file. The marker
  and path scans do discriminate.
- **I-6:** capacity was measured on an almost empty Supplier master. T50 covers 100,000 Suppliers.
- **I-7:** no client code changed. The client shows the server's 429 message (read from the code).

## Verified correct

- **The lease compare-and-set is sound** (reproduced). Probes covered abort mid-row and an external release mid-row, and
  every row was applied exactly once. Even a misplaced release cannot cause double processing.
- **A graceful SIGTERM leaves `lease_until = NULL`,** and a second worker resumes at once, exactly once.
- **`findDuplicates: false` is safe:** the search only reads, its result was discarded, precheck still warns on identical
  names, and the UI still runs it.
- **The export gate:**
  - the check and the increment happen together after authorization;
  - over real HTTP a third export gets 429 `SUPPLIER_EXPORT_BUSY` with nothing leaked and no audit;
  - a wrong password is still 403;
  - a freed slot works.
- **On success, the benchmark cleans up** its prefix, user, role, job and temp directory.

## Suites and runs (`erp_rev078`, serial)

| Run | Result |
| --- | --- |
| Unit tests: export, import service, worker | 31/31 |
| Execution integration | 15/15 |
| Import integration | 42/42 |
| `npm run test:coverage` | 2,830 tests: 2,816 pass, 0 fail, 14 skipped; floors met |
| Benchmark, 2,000 rows | ok; 3.3 ms per row; exactly once |
| Benchmark, 2,000 rows `--crash` | ok; SIGKILL at 1,014 rows; exactly once |
| SIGTERM variant | ok; lease NULL; exactly once |

Mutants: of four, three were killed and the release SQL without `status = 'running'` survived (I-1).

Environment: a `LOCK TABLES` probe in the reviewer's own schema briefly made its own requests time out; the locks were
released and the probe users removed. No processes were killed, no temp directories remain, and only `erp_rev078` was
used.

## Author's follow-up

- The M-1 mechanism holds: the benchmark worker is a full app process with the default scheduler.
- The reviewer reported being denied permission to read the main repository's `server/.env`. The author did not read it on
  the reviewer's behalf. The fix passes `DB_*` to the child explicitly, which makes that question moot.
- The findings were taken to the Product Owner (HD-076), whose answer was '全部按建議'.

| Finding | Follow-up |
| --- | --- |
| M-1 | **Fixed.** The benchmark refuses to run unless all five `DB_*` variables are set, and refuses if any other import job is pending in the database. It passes `DB_*` to its worker explicitly, so `.env` cannot fill them in. Negative controls: a run without `DB_NAME` is refused; a run with a foreign `uploaded` job is refused and that job is untouched. |
| L-1 | **Fixed.** Cleanup moved to `finally`, scoped to what the run created (prefix, job, user, role), and runs after the workers stop. Negative control: a forced precheck failure left no user, role, job or Supplier. |
| L-2 | **Fixed.** The worker releases its lease in `finally` on any stop, including an error, and logs `supplier.import.paused` with `reason: timeout` or `shutdown`. The operator guide now says the execute job's timeout is recorded as succeeded and points to that log. Unit tests cover the release on error and the pause reasons. |
| L-3 | **Documented** in `bulk_operations.md`: the gate bounds the build peak; the response copy lives until the client has read it. |
| L-4 | **Reworded** in the carry-forward: AC 1 is met across the import integration tests (T45 for draft and approval off). |
| I-1 | **Tested.** A `queued` job with a leftover lease is not released. |
| I-2 | **Fixed.** The doc comment is back on `finalizeExecution`. |
| I-3 | **Fixed.** `releaseExecutionLease` validates its input like its siblings. |
| I-4 | **Fixed.** Reports record the MySQL durability settings, the guide explains what each number means, and the 10,000-row evidence was regenerated. |
| I-5, I-6, I-7 | No change. |

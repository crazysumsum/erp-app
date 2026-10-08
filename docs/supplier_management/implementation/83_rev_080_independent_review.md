# REV-080: TASK-049 (PR #192), independent re-review after REV-079

Reviewer: REV-080, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> text below is the reviewer's, apart from this note and light formatting. The "Author's follow-up" section at the end is the
> author's.

- **Commit:** `2afba993edb5f00c419fdd1d4307b951c974f600` (PR #192), base `main` `5257858`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev080`, clean at the end.
- **Database:** its own schema, `erp_rev080`, on MySQL 3449.

## Verdict: CHANGES_REQUESTED (small)

The product code is approvable. Two new Low findings concern the benchmark script and its documentation only.

## REV-079 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| L-A | **Fixed** | A SIGTERM to the worker logged `reason: "shutdown"`, released the lease, and the takeover applied every row exactly once (reproduced). `stopped` is set synchronously before the abort and cannot go stale. The timeout path was checked by reading the code and the unit test. |
| L-B | **Fixed for `supplier_import_jobs`** | A foreign Supplier job inserted mid-run gave `ok: false`, was listed, and exited 1. A pending one is refused. Every `--database` variant (wrong, missing, valueless, different case) is refused. No clock-skew false negative was found. The scope gap is L-C. |
| I-A | **Claim correct** | `normalizeLoggingConfig.js:98-100` resolves against the server root; no environment variable is read. |
| I-B | **Mostly fixed** | The release catch, the pending guard and `--database` are now killed by tests. The cleanup and the after-run check have none (m9, m10). |
| I-C, I-D, I-E | **Fixed or documented** | — |

## New findings

- **L-C (Low, reproduced): the guards cover only Supplier import jobs, but the benchmark's worker runs every module's jobs.**
  - The child is a full `node src/index.js`. It runs `itemImport.validate`/`execute` (always on), the Customer import
    worker when it is configured, Sales recovery jobs, and the rest.
  - A foreign `item_import_jobs` row in `uploaded` was set to `invalid`, and the report said `ok: true`, exit 0.
  - Fix: extend both queries to the other import tables, or at least correct the docs.
- **L-D (Low, reproduced): interrupting the benchmark leaves a live worker and skips cleanup.**
  - The script has no signal handler. `kill <benchmark PID>` left an orphaned worker on port 3490 that kept polling the
    database. There was no report, and the Suppliers, job, user, role and temp directory were all left behind.
  - Fix: handle SIGINT and SIGTERM so that the same cleanup runs, or document manual cleanup.

## Info

- **I-G:** the after-run check and the cleanup share one `try`, so a failed check skips the cleanup.
- **I-H:** the evidence JSONs record commands without `--database`. The numbers stay valid: since the evidence was
  generated, only the 7-line reason change touched `server/src`.
- **I-I (inferred):** if draining exceeds `shutdownTimeoutMs`, the database closes before the `finally` release, and the
  lease then waits 11 minutes. The guide slightly overstates this.

## Verified correct

- **The lease release in `finally`:** the original error is kept, the release is scoped to its own running lease, and the
  SIGTERM run applied every row exactly once.
- **The shutdown order:** the scheduler stops before services shut down.
- **`findDuplicates: false`** is passed only by the import applier and cannot be set from a request.
- **The export gate** is unchanged.
- **The docs** match the code for `--database`, the empty password, `reason` and the log location.

## Suites and runs (`erp_rev080`, serial)

| Run | Result |
| --- | --- |
| Targeted tests | 94/94 |
| `npm run test:coverage` | 2,836 tests: 2,822 pass, 0 fail, 14 skipped; floors met |
| `npm run lint` | clean |
| Benchmark, 2,000 rows | ok; 3.6 ms per row; exactly once; durability 1/1/1; cleaned up |
| Benchmark, 2,000 rows `--crash` | ok; SIGKILL at 1,007 rows; exactly once |
| SIGTERM variant | `reason: shutdown`; lease NULL; exactly once |
| `DB_NAME` and `--database` negatives | all refused |
| Foreign Supplier job: pending, then mid-run | refused; then `ok: false` |
| Foreign Item import job | touched, `ok: true` (L-C) |
| SIGTERM to the benchmark parent | orphaned worker, no cleanup (L-D) |

Mutants: of 11, 8 were killed. m9 (the after-run check off) and m10 (the cleanup keeps the user) survived, and so did m11
(the pending guard ignores `uploaded`, because the test seeds only `queued`).

Environment:

- Only `erp_rev080` was used.
- The L-D orphan was stopped by its PID, and the residue of the reviewer's own probes was removed by hand.
- A migrate log was briefly written outside the worktree and deleted at once.
- No `pkill` and no load generators were used.

## Author's follow-up

- The L-C mechanism holds: the child is a plain `node src/index.js`, so every discovered service's jobs run, and
  `config/scheduler.js` reads no environment variable that could switch them.
- The scheduler does accept per-name `enabled: false` overrides through `createApplication`, which is how the integration
  tests already run it.
- The findings were taken to the Product Owner (HD-078), whose answer was '全部按建議'.

| Finding | Follow-up |
| --- | --- |
| L-C | **Fixed at the root.** The worker is now this same script with `--worker`. It builds `createApplication` with every discovered scheduler job disabled except `supplier.import.precheck`, `supplier.import.execute` and `tokenRevocation.refresh`, which configuration validation requires. Reproduced: a foreign `item_import_jobs` row in `uploaded` stayed untouched (`updated_at` unchanged) through a 2,000-row run. |
| L-D | **Fixed.** SIGINT and SIGTERM run the same `finish()`: stop the worker, check, clean up, write the report with `interrupted`, then exit 130 or 143. Reproduced: a SIGTERM to the benchmark mid-run cleaned up 334 Suppliers and the job, user and role, left no worker running and no temp directory, and wrote `ok: false, interrupted: SIGTERM`. |
| I-A (REV-079) | **Resolved for the benchmark.** The worker runs through `createApplication`, so its logs go to the temp directory, and no `server/logs` is written. |
| I-G | **Fixed.** The check and the cleanup have separate `try` blocks. |
| I-B | **Tested.** The pending-guard integration test covers both `uploaded` and `queued`. The after-run check and the cleanup remain covered by the manual controls above. |
| I-H | **Fixed.** Both 10,000-row reports were regenerated with the final script (the command includes `--database`). Normal run 60 s; SIGKILL run 66 s, exactly once. |
| I-I | **Documented** in `bulk_operations.md`. |

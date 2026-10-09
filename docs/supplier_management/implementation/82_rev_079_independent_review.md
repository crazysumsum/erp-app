# REV-079: TASK-049 (PR #192), independent re-review after REV-078

Reviewer: REV-079, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> text below is the reviewer's, apart from this note and light formatting. The "Author's follow-up" section at the end is the
> author's.

- **Commit:** `07bc3cc0d6f4f7335f0f521ce85b939d7380caf6` (PR #192), base `main` `5257858`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev079`, clean at the end.
- **Database:** its own schema, `erp_rev079`, on MySQL 3449.

## Verdict: CHANGES_REQUESTED (small)

The product code is sound: releasing the lease in `finally` cannot hand a job to two workers, and the export gate and
`findDuplicates: false` hold. Two REV-078 follow-ups do not do what the follow-up table says.

## REV-078 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| M-1 | **Partly fixed** | An unset or empty `DB_NAME` is refused, and so is a foreign pending job, which stays unchanged (reproduced). Still open: L-B. |
| L-1 | **Fixed** | A forced failure cleaned up its job, user and role, with nothing left (reproduced). Cleanup touches only its own prefix and IDs. |
| L-2 | **Partly fixed** | The lease part is fixed: after SIGTERM the lease is NULL, the job resumes at once, and every row is applied exactly once (reproduced). The pause reason is wrong on shutdown (L-A). |
| L-3, L-4, I-1, I-2, I-3, I-4 | **Fixed** | REV-078's surviving mutant is now killed. The evidence was regenerated with durability 1/1/1, and the docs match the JSON. |

## New findings

- **L-A (Low, reproduced twice): a graceful shutdown is logged as `reason: "timeout"`.**
  - `createApplication` calls `scheduler.stop()`, which sets `stopped` and aborts every job in flight. Only then is the
    worker's `shutdown()` called, so on a real shutdown the signal is always aborted.
  - The unit test models shutdown in an order that never happens in production.
  - Operators told to watch `reason` would see every deploy as a timeout.
  - Fix: `reason: this.scheduler?.stopped || this.stopping ? "shutdown" : "timeout"`, plus a test that uses the real order.
- **L-B (Low, reproduced): the M-1 guard checks only once, at the start.**
  - A foreign job uploaded about 2 s after the worker started was failed and purged (`SUPPLIER_IMPORT_SOURCE_UNAVAILABLE`),
    and the report still said `ok: true`.
  - Inferred: an explicit `DB_NAME=erp_dev` passes the guard.
  - Fix: after the run, flag any other job changed since the start (`ok:false`). Optionally require a `--database=<name>`
    confirmation, or at least document that the guard covers only the start.

## Info

- **I-A:** the `LOG_DIRECTORY` passed to the child is read by nothing, so child logs land in the running checkout's
  `server/logs/` (reproduced).
- **I-B:** no automated test covers the pending-job guard (m6), the cleanup (m7), or the release's `.catch`, which keeps the
  original error (m2).
- **I-C:** passing `DB_*` to the child explicitly is redundant, because dotenv does not override variables that are
  already set. The comment overstates it.
- **I-D:** an error before a row is picked is now retried after 5 s rather than 11 minutes, and there is no attempt cap
  for execution. No realistic persistent trigger was found.
- **I-E:** an empty `DB_PASSWORD` is refused.
- **I-F:** CI run 37720447168 on this head failed Sales `salesCapacity` TC-032 (P95 4807 ms against 3000 ms). That module
  is unrelated, and the test passed locally and on 48c2fd0. It looks like a timing flake (inferred).

## Verified correct

- **The lease release in `finally`:**
  - Lease owners are per-process UUIDs, and the scheduler's `running` map prevents overlapping runs.
  - After `LEASE_LOST`, the update matches nothing. After finalize or revoke, it is a no-op.
  - A throw right after the claim still releases the lease.
  - The release error is caught without hiding the original error.
  - The logs carry IDs, the reason, counts and codes only.
- **The export gate and `findDuplicates`:** both still hold.
- **The pending-status list** equals the non-terminal states.
- **The cleanup** is scoped to the run's prefix and IDs, after its workers are awaited.

## Suites and runs (`erp_rev079`, serial)

| Run | Result |
| --- | --- |
| Targeted unit and integration tests | 91/91 |
| `npm run test:coverage` | 2,833 tests: 2,819 pass, 0 fail, 14 skipped; floors met |
| Benchmark, 2,000 rows | ok; 3.2–3.3 ms per row; exactly once; durability 1/1/1 |
| Benchmark, 2,000 rows `--crash` | ok; SIGKILL at 1,004 rows; exactly once; cleaned up |
| SIGTERM variant, 2 runs | lease NULL; resumed; exactly once; reason `timeout` (L-A) |
| Negative cases: no or empty `DB_NAME`, a foreign pending job, a forced failure | refused, refused, cleaned up |
| Foreign job during the run | failed and purged; report `ok` (L-B) |

Mutants: m1 (REV-078's) and m4/m5 were killed. m2, m3 (the correct L-A fix, compatible with the tests), m6 and m7
survived; m8 is equivalent.

Environment:

- Only `erp_rev079` was used, and no processes were killed by pattern.
- The reviewer removed its own `server/logs`, `coverage` and `storage` from the review worktree.
- `npx eslint` downloaded eslint 10 into the global npx cache. This is outside the repository, and nothing in the
  worktree changed.

## Author's follow-up

- The L-A mechanism was checked: `SchedulerService.stop()` sets `stopped` and then aborts in-flight jobs before services
  shut down.
- The CI failure was confirmed as Sales TC-032.
- The findings were taken to the Product Owner (HD-077), whose answer was '全部按建議'.

| Finding | Follow-up |
| --- | --- |
| L-A | **Fixed.** The reason is `shutdown` when `scheduler.stopped` or the worker's own `stopping` flag is set, and `timeout` otherwise. A unit test uses the real order (scheduler stopped, then the signal aborted). |
| L-B | **Fixed.** `--database` must repeat `DB_NAME`. After the run, any other job changed since the start is listed as `foreignJobsTouched`, and the run reports `ok: false`. Reproduced: a foreign job inserted mid-run was failed by the worker, and the report said `ok: false` and listed it. The guide says to run only against a throwaway database, from a throwaway checkout. |
| I-A | **Not as suggested.** The log directory is resolved against the server root (`normalizeLoggingConfig.js`), not the working directory, and nothing reads `LOG_DIRECTORY`. Running the worker in a temp directory was tried and made no difference, so it was reverted. Redirecting the logs would need a change to `server/config/logging.js`, an approval-required path. Documented instead, and raised with the Product Owner. |
| I-B | **Tested.** An integration test checks that the benchmark refuses while another job is pending and leaves that job untouched; a unit test checks the `--database` mismatch; unit tests check that a failing release neither replaces the original error nor fails a completed run. The cleanup is still covered only by the manual negative control (it needs a real worker). |
| I-C | **Fixed.** The comment no longer claims the explicit `DB_*` is needed; the explicit copy was removed. |
| I-D | **Documented** in `bulk_operations.md`. |
| I-E | **Fixed.** An empty `DB_PASSWORD` is accepted. |
| I-F | CI re-runs on the new head. |

# REV-081: TASK-049 (PR #192), independent re-review after REV-080

Reviewer: REV-081, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> text below is the reviewer's, apart from this note and light formatting. The "Author's follow-up" section at the end is the
> author's.

- **Commit:** `3b0ea454d57aa7dc4870c74477f02e14062fdbd4` (PR #192), base `main` `5257858`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev081`, clean at the end.
- **Database:** its own schema, `erp_rev081`.

## Verdict: CHANGES_REQUESTED (small)

The product code is approvable: every product mutant was killed except p7, a test gap. Two new Low findings concern the
benchmark tooling and its test.

## REV-080 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| L-C | **Fixed** | A foreign Item job stayed untouched, and a `CHECKSUM TABLE` of all 87 tables was identical before and after a 2,000-row run. The worker's scheduler reported `jobCount: 3`. Job discovery is complete, and the extra modules that `src/index.js` loads are not loaded at all (reproduced, plus code read). |
| L-D | **Partly fixed** | SIGTERM or SIGINT in precheck, execution, set-up or just after completion all cleaned up (reproduced). Not fixed: the crash-restart race (N-1), a double signal (I-1), and SIGKILL (I-2). |
| I-G | **Fixed** (code read) | Untested (m14 survives). |
| I-B | **Not effective under CI** | See N-2. |
| I-H, I-I, REV-079 I-A | **Fixed or resolved** | — |

**Is the supplier-only worker faithful?** Yes. It is the same worker service and scheduler, with the same intervals,
timeouts and pool. The earlier full-process evidence gave 54.6 s of execution; the supplier-only worker gave 54.5 s.

## New findings

- **N-1 (Low, reproduced): after a signal, the main flow keeps running alongside `finish()`.**
  - A SIGTERM at the moment worker-a died in `--crash` mode left worker-b orphaned. It recreated its import root and
    later failed the next benchmark run's job (`SUPPLIER_IMPORT_SOURCE_UNAVAILABLE`).
  - A SIGTERM just after completion gave `ok: true` together with `interrupted`. Signals during verification recorded
    false `exactlyOnce: false` results, because the cleanup was deleting the data at the same time.
  - Fix: refuse to spawn workers once `finish()` has started, and never set `ok` after an interruption.
- **N-2 (Low, reproduced): the pending-guard test passes with the guard broken in a full-file run.**
  - A `ready` job left by the TASK-042 claim test stays pending, so the guard refuses because of that job.
  - The assertion accepts any count, so m11, m11b and m11c all survive. m11 is killed only when the test runs alone.
  - Fix: move leftover pending jobs to a terminal state, and assert `1 other import job`.

## Info

- **I-1:** a second signal falls back to the default action (`process.once`) and skips the cleanup (reproduced).
- **I-2:** SIGKILL of the parent leaves a live worker that finishes the import and breaks later runs (reproduced).
  Better: make the worker exit when its parent goes away.
- **I-3:**
  - The carry-forward's NFR-004 cell still says "the real API as worker".
  - The evidence's and the script's worker string omit `tokenRevocation.refresh`.
- **I-4:** `DB_SOCKET_PATH` silently overrides `DB_HOST` and `DB_PORT` (reproduced).
- **I-5:** an unwritable `--output` loses the report after a full run, and leaves the temp directory behind (reproduced).
- **I-6:** the export gate's order (authorization before the gate, so a refused caller gets 403 and not 429) is not
  pinned by a test (p7 survives).
- **I-7:** the evidence does not record the database host or port.
- **Untested:** the after-run check (m9), the cleanup (m10), the supplier-only job set (m12), the signal handlers (m13)
  and the split `try` (m14) are covered only by manual controls.

## Suites and runs (`erp_rev081`, serial)

| Run | Result |
| --- | --- |
| Targeted tests | 94/94 |
| `npm run test:coverage` | 2,836 tests: 2,822 pass, 0 fail, 14 skipped; floors met |
| `npm run lint` | clean |
| Benchmark, 2,000 rows / `--crash` | ok, exactly once; SIGKILL at 1,009 rows |
| Foreign Item job, with the 87-table checksum | untouched, identical |
| Foreign Supplier job, mid-run / `validating` pending | `ok: false`, exit 1 / refused |
| Signal runs | as listed above |

Mutants, full test files as CI runs them:

- **Benchmark:** 8 mutants (m9–m14, m11b, m11c), and all survived. m11 is killed only in isolation.
- **Product:** of p1–p12, all were killed except p7.

Environment:

- Two orphaned workers came from the reviewer's own runs, from the N-1 race and from the SIGKILL probe. Both were
  stopped by their PIDs, and the leftover data was removed by hand.
- The final state is clean.
- No `pkill`, and no other schemas or ports were used.

## Author's follow-up

- **N-2 also corrects an earlier claim.** The author's mutation harness ran the integration files with
  `--test-name-pattern='HD-075|TASK-049'`, which leaves out the TASK-042 test that leaves a `ready` job behind. So the
  recorded "m11 killed" and "19 mutants, all killed" held only for that narrower run, not for the full file as CI runs it.
- The findings were taken to the Product Owner, who answered '全部按建議' and chose a last review limited to this round's
  changes (HD-079).
- **N-1, I-2:** the worker is spawned with an IPC channel and shuts down on `disconnect`, so it ends with its parent
  however the parent dies. `startWorker` refuses once the run is interrupted. `waitFor`, the crash loop, the
  verification and the final `ok` stop at an interruption, so an interrupted run never reports `ok: true` or a
  verification.
- **I-1:** `process.on`, ignoring repeat signals.
- **N-2:** the test moves other tests' pending jobs to `cancelled` and expects exactly `1 other import job`. The harness
  now runs full files. The corrected record is in `62_task_041_carry_forward.md`.
- **I-3:** the carry-forward cell and the worker string are corrected, and the evidence is regenerated.
- **I-4, I-7:** the report records the database name, host, port and socket. The operator guide says the host and port
  are unused when `DB_SOCKET_PATH` is set.
- **I-5:** the script opens `--output` for appending before it does anything else.
- **I-6:** a unit test refuses a caller with a full gate and expects 403.
- The manual controls and the 22 mutants are in `62_task_041_carry_forward.md`. All of them were run against full files.

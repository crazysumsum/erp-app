# REV-082 — independent re-review of TASK-049 (HD-079 changes)

- **Reviewer:** `agent-skills:security-auditor`, a separate agent, independent of the author.
- **Baseline:** `a8f2390889014243d2368a1e1bde88b16ada1d60` (PR #192). The scope is the diff `3b0ea45..a8f2390`, the
  changes made for REV-081 (HD-079 a: a last review limited to this round).
- **Environment:** a detached worktree, its own schema `erp_rev081` on a throwaway MySQL.
- **Verdict:** **APPROVED.** Nothing blocks the merge.

## Findings

- **Low: a likely cause of the TASK-044 flake.** It is a test defect, not a product defect.
  - The app allows 20 requests per second per IP (`config/requestLimiter.js`).
  - In `supplierImport.integration.test.js`, the `api()` helper waits and retries on a 429, but `httpUpload()` does not.
  - The "withdrawn permission" test (line 731) never checks the upload's status. When earlier tests have used up the
    budget, the upload gets a 429. The test then asks for `/supplier-imports/undefined`, and `api()` waits about 1 s for
    `Retry-After`. That matches the author's symptom: no job, and 1,030 ms instead of about 26 ms.
  - Reproduced by adding 25 concurrent GETs before the upload: the test failed the same way, in 2,581 ms.
  - Fix: retry on 429 in `httpUpload`, or assert `created.status === 201` as other tests in the file do.

## Info

1. Repeat signals are now ignored, so a hung worker shutdown can be ended only by SIGKILL. The app's 30 s shutdown
   timeout bounds this, so it is acceptable.
2. The REV-081 follow-up says an interrupted run never reports a verification. A signal during the result download or
   export still leaves the `verification`, which is valid because it was computed before the signal. Only the wording is
   too strong.
3. A signal during `createFromUpload` could, in theory, leak a job committed after the cleanup. Nine probes did not
   reproduce it.
4. A SIGKILLed benchmark leaves a job pending, and the guard then blocks the next run until someone removes it. The docs
   say data is left behind, but not that it blocks the next run.
5. The pending-guard test checks only `uploaded` and `queued`. A mutant that drops `ready` survives. That was already
   the case before this round, but the test comment claims every state.
6. The `--output` start check has no automated test (a removal mutant survives). The author says it is checked by hand.
7. The N-2 cancel hides no real problem. But the `quiesce()` comment "只有呢個檔案用呢兩張表" is out of date, and the
   cancel is safe only because CI runs test files one at a time.

## Verified as fixed

| Claim | Result |
| --- | --- |
| Normal and `--crash` runs with IPC | `ok: true`, exactly once, exit 0; nothing left behind |
| I-2: SIGKILL of the benchmark | Its worker exited within about 1 s and released its lease (`paused`, `reason: shutdown`) |
| I-1: two SIGINTs, to the PID and to the process group | One report, `interrupted: SIGINT`, everything removed |
| N-1: SIGTERM as worker-a died (3 runs) | `ok: false`, `interrupted`, no verification, no orphan |
| I-5: missing directory, a directory, a read-only file | Each refused at once (ENOENT, EISDIR, EACCES); nothing created |
| I-4, I-7 | The report has the database name, host, port and socket |
| N-2: mutants against the full file | `uploaded`, `queued` and "tolerates one" all killed |
| I-6: the gate block moved above `authorize` | Killed by the new assertion |
| The two changed test files in full | 21 of 21 pass |
| Evidence against the docs | All numbers match |

**Not checked:** the author's 22-mutant sweep, the full suite, CI, and which commit produced the evidence. The JSON has
the new fields, so it came from the fixed script.

## Environment and cleanup

- The reviewer used only its worktree and schema, read no `.env`, and used no `pkill` or `killall`.
- The data and temporary directories left by its SIGKILL probes were removed by hand.
- The final state is clean, and no process is left.

## Author's follow-up

- The flake mechanism was checked in the code: the limiter allows 20 per second, `api()` retries on 429, and
  `httpUpload()` does not.
- The findings were taken to the Product Owner (HD-080).

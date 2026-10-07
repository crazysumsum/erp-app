# REV-077: TASK-048 (PR #189), independent re-review after REV-076

Reviewer: REV-077, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> reviewer wrote in Cantonese; this is the author's English rendering of it, with light formatting. The "Author's
> follow-up" section at the end is the author's.

- **Commit:** `1e1ad49e8b9e050e3c38c5256458cb4e50f5d36c` (PR #189), base `main` `8ac45e9`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev077`, clean at the end.
- **Database:** its own schema, `erp_rev077`, on MySQL 3448.

## Verdict: APPROVED

REV-076's M-1 and L-1 are fixed, and I-3 and I-5 are implemented as HD-072 decided. There are no new Medium or higher
findings: two Low and three Info, none blocking.

## REV-076 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| M-1 | **Fixed** (reproduced) | Using the repository's scheduler harness with the real job: a hard-linked job file gives `failures 1, consecutiveFailures 1, lastOutcome "failed"`, and the logged error has no root path. Runs with only too-new orphans, only races, or nothing to do stay `succeeded`. |
| L-1 | **Fixed** (reproduced) | REV-076's R, O, A, B, Q, C and D were re-run at HEAD; all seven are killed. |
| I-1, I-2, I-4 | Documented | In the carry-forward. |
| I-3 | **Fixed** | `failed` is terminal, and every precheck failure sets `files_purged_at`, so nothing is purged early. The new integration case covers it, and mutants C, D and M8 are killed. |
| I-5 | **Fixed** (reproduced) | After expiry, `get()` returns `normalizedPayload: {}` with row numbers, status and errors intact. No reader breaks: the API schema allows any object, the client never reads the field, an expired job's result download is already 409, and execution only reads valid rows of running jobs. |

The author's own two fixes:

- **The `IN (?)` trap:** fixed. `purgeCandidates` goes through `database.query`, which expands arrays on the client side.
  No other new SQL passes an array.
- **The reordered checks:** safe (reproduced). The orphan listing only yields regular files. Without `notNewerThanMs`, new
  symlinks, hard links and directories still throw `SUPPLIER_IMPORT_PURGE_UNSAFE`. Restoring the old order is caught.

## New findings

- **L-1 (new): a timed-out run is recorded as `succeeded`** (reproduced).
  - With the first query held while a fake clock passed 700 s (the timeout is 600 s), the run returned normally.
  - Result: `runs 1, failures 0, timeouts 0, lastOutcome "succeeded"`. No due job was processed and no orphan sweep ran.
  - If every run times out, for example on a large backlog, a slow filesystem or lock waits, the orphan sweep never runs
    and the stats still say success. `ItemMediaCleanupJob` has the same pattern, so this is Low.
  - Suggestion: call `signal?.throwIfAborted()` after logging the summary, plus a test.
- **L-2 (new): mutant M7 survived.** Moving the payload clear above the status guard in `expireUnconfirmed` passes the
  tests, because the `confirmedMeanwhile` and `validating` jobs have no rows.
  - The code is correct: the reviewer reproduced the queued case and a real `FOR UPDATE` race.
  - Suggestion: give those two jobs rows and assert their payload is unchanged.

## Info

- **I-a:** `SUPPLIER_IMPORT_PURGE_INCOMPLETE` itself reaches neither `fr_job_stats` nor the `scheduler.job.failed` log,
  which keep only name and message. Alerting works through the message and `consecutiveFailures`, but "a code and a count
  only" is slightly misleading. Putting the code in the message would make it searchable.
- **I-b:** an orphan with a future mtime stays `too_new` for ever, silently. Only the service user, or a large clock step
  back, can cause one.
- **I-c:** a job the user cancelled keeps `normalized_payload`, while an expired one has it cleared. I-5's reasoning
  applies to both, but HD-072 only decided the expired case.

## Suites

| Suite | Result |
| --- | --- |
| `npm ci`, migrate | OK |
| The four focused files | 27/27 |
| Server `test:coverage` (serial, real MySQL) | 2,697 tests: 2,683 pass, 0 fail, 14 skipped; floors met |
| Probes P1–P4 | as above |

Mutants: of 18, 17 were killed and M7 survived (L-2). There was no environment incident: only `erp_rev077` was used, nothing
was killed, and the worktree is clean.

## Author's follow-up

Taken to the Product Owner (HD-073).

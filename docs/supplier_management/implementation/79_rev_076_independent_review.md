# REV-076: TASK-048 (PR #189), independent review

Reviewer: REV-076, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> reviewer wrote in Chinese; this is the author's English rendering of it, with light formatting. The "Author's follow-up"
> section at the end is the author's.

- **Commit:** `ea3ab091c1a9be77957bbaaee5ca73427f0c8c61` (PR #189), base `main` `8ac45e9`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev076`, detached and clean at the end.
- **Database:** its own schema, `erp_rev076`, on MySQL 3448.

## Verdict: CHANGES_REQUESTED

The deletion logic is sound. There is no exploitable Critical or High finding: the only TOCTOU left is the window that
Node's lack of `unlinkat` leaves, and only the service user can reach it. The verdict rests on one Medium finding and one
Low.

## Findings

- **M-1: the purge counts never reach the scheduler stats** (reproduced). `SchedulerService.js:411` is
  `await job.run(controller.signal)` and drops the return value.
  - With the repository's scheduler harness, a job that returned `{ retained: 3, failed: 3 }` was recorded as
    `runs 1, failures 0, lastOutcome "succeeded"`.
  - The job's docstring, the carry-forward ("which the scheduler records in its job stats") and HD-071's recorded defaults
    all claim otherwise.
  - Failure scenario: every delete fails each day (EACCES, a hard link). The scheduler and `fr_job_stats` still say
    success, so no alert based on job stats fires, and personal-data files outlive their retention unnoticed.
  - Fix options: (a) throw a code-only `SUPPLIER_IMPORT_PURGE_INCOMPLETE` after logging when `failed > 0`, so the run is
    recorded as failed and `consecutiveFailures` grows (preferred); or (b) correct the docs and ask whether the log alone
    meets §12.4.
- **L-1: seven mutants of the reviewer's own survived.**
  - **R:** expiry excluding only `queued`. Nothing tests the race with a precheck claim (`validating`); under the mutant
    that race throws and stops the whole run.
  - **O:** `supplierImportDirectory` returning null on any error. This fails open silently: jobs are marked purged and the
    files stay, with no log. Nothing tests a kind directory that is already a symlink when the run starts.
  - **A:** the directory's own `dev` check removed.
  - **B / Q:** the abort checks before the orphan sweep and between jobs removed.
  - **C / D:** `confirmed_at IS NOT NULL` dropped for failed jobs. Close to equivalent; see I-3.

## Info

- **I-1:** the residual TOCTOU, reproduced with an injected `lstat`. Swapping `<root>/source` for a symlink between the
  checks and the `unlink` deletes a same-named 64-hex file outside the root. This needs write access to the 0700 root,
  which `prepareSupplierImportRoot` restricts to the service user. It is the design limit of REV-059 L-6, because Node has
  no `unlinkat`. Suggestion: document it.
- **I-2:** a root with mode 000 makes the whole run fail with `EACCES … lstat '<root>/source'`, and that path reaches the
  system log and `fr_job_stats.last_error`. It is a config path, not personal data. Per-file failures log IDs and codes only.
- **I-3:** a `queued` job with `confirmed_at` NULL that execution fails as `SUPPLIER_IMPORT_NOT_CONFIRMED` keeps
  `files_purged_at` NULL. It is never a candidate and never an orphan, so its source is never purged (reproduced). Normal
  flows always set `confirmed_at`.
- **I-4:** the orphan sweep trusts the database (inferred). Two environments sharing one root, or an app pointed at the
  wrong or an empty schema, would delete every file older than a day.
- **I-5:** the HD-071 privacy rationale is only partly met. An expired job's source is deleted, but its prechecked
  `supplier_import_rows.normalized_payload` stays for seven years under §12.5.
- **I-6:** `purgeCandidates` scans the primary key with a filter. That is acceptable daily at thousands of rows, and the
  50×200 bound is correct.
- **I-7:** each instance's daily schedule runs once. All writes are CAS with `FOR UPDATE`, and `ENOENT` is idempotent.
- **I-8:** an expired job reads as `cancelled`, `SUPPLIER_IMPORT_EXPIRED`, with `filesPurged` true.
  - Confirm and cancel both answer 409.
  - The result download answers 409 `SUPPLIER_IMPORT_RESULT_NOT_READY` ("尚未執行完成"), which is slightly misleading for
    an expired job.

## Verified correct

- **Pre-unlink checks:** the directory identity, the file type, the filesystem, `nlink` and the stored-name regex.
  - A kind directory that is already a symlink at the start refuses the whole run before any database change.
- **State-machine races:** a precheck claim leaves the job alone. Confirm or cancel is serialised against expiry by
  `FOR UPDATE`, and marking a job purged is a compare-and-set.
- **Upload against the orphan sweep:** the one-day mtime rule protects a new upload, and stored names are never reused.
- **Cut-offs:** checked; config `"0"` is refused at start-up.
- **Audit:** `import.expire` is written by `system` with a null actor and holds status and outcome only.

## Suites

| Suite | Result |
| --- | --- |
| `npm ci`, migrate | OK |
| The four focused files | 25/25 |
| Server `test:coverage` (serial, real MySQL) | 2,695 tests: 2,681 pass, 0 fail, 14 skipped; floors met |
| The reviewer's own probes X1–X6 | as described above |

Of the reviewer's 12 mutants, 5 were killed and 7 survived (L-1). There was no environment incident: only `erp_rev076`
was used, no API was started, and the worktree is clean.

## Author's follow-up

- The M-1 mechanism was checked: `SchedulerService.js:411` does discard the return value. The author had copied the
  "counts via scheduler stats" claim from Item's cleanup job.
- The findings were taken to the Product Owner (HD-072). The answer was '全部按建議', and the follow-up is below.

| Finding | Follow-up |
| --- | --- |
| M-1 | **Fixed (a).** After logging the summary, a run that leaves any file behind throws `SUPPLIER_IMPORT_PURGE_INCOMPLETE`, with a code-only message and the counts attached. The scheduler records the run as failed. The docstring, the carry-forward and the HD-072 note correct the earlier claim. |
| L-1 | **Tests added.** The precheck-claim race in expiry (R); a kind directory that is a symlink, a file, or on another filesystem stops the run (O, A); an abort midway skips the next job and the orphan sweep (Q, B). C and D are covered under I-3. |
| I-1 | Documented as the residual risk in the carry-forward. |
| I-2 | Documented; no change. |
| I-3 | **Fixed.** Every `failed` job without `files_purged_at` is due 365 days after completion. The `confirmed_at` condition is gone, and an integration test covers a job failed as not confirmed. |
| I-4 | **Documented** for operators: one root per environment. No code change. |
| I-5 | **Fixed (A).** Expiry also clears the job's rows' `normalized_payload` to `{}`; row numbers, outcomes and error codes stay. |
| I-6, I-7, I-8 | No change. |

While making the fixes, the author found and fixed two defects of their own:

- `markExecutedFilesPurged` passed an array to `IN (?)` through `connection.execute`, which a prepared statement does not
  expand. The integration test caught it: every mark became a "race". The status list is now written out.
- An unsafe file that was also new was counted as two failures. The file-age check now runs before the safety checks; a new
  file is left alone either way.

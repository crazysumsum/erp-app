# REV-069: TASK-044 (PR #175), independent review

Reviewer: REV-069, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The text below is the reviewer's, apart from this note and light formatting.

- **Commit:** f43196f67c73350719caefafe616aa9c3e3e3853 (PR #175, branch `claude/supplier-task-044`, base main 29893c3).
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev069`, detached. At the end it is clean and HEAD is still f43196f.
- **Method:**
  - Read the diff against HD-058, the T44 criteria, design §5.13, §6.1, §6.9 and §8.8, and the REV-068 I-2 and REV-065 I-3 obligations.
  - Ran the unit, client and integration suites, the integration suites serially on MySQL `erp_rev069`.
  - Ran 7 HTTP and SQL probes against the real app, from a temporary test file that reused the integration harness; the file was deleted afterwards.
  - Ran 5 hand-applied mutants and 1 file-rename mutant, each restored afterwards.

## Verdict: CHANGES_REQUESTED

One Medium finding is open: M-1, a verification gap on the only concurrency control in cancel. The shipped code behaves correctly, but removing that control passes all 39 tests, and the reviewer reproduced that this turns a running import into a "cancelled" one. The other findings are Low or Info.

## Findings

### M-1 (Medium): The row lock in cancel is the only race guard, and no test detects its removal

- **Location:**
  - `server/src/modules/supplier/SupplierImportService.js:288`: `... WHERE id = ? AND created_by = ? FOR UPDATE`.
  - `:298`: the `UPDATE ... SET status = 'cancelled' ... WHERE id = ?`, which has no status guard.
- **Evidence:**
  1. **The shipped code behaves correctly.**
     - Setup: a raw connection begins a transaction, locks the job `FOR UPDATE` and moves it to `validating` (or from `queued` to `running`) without committing, then the owner sends `POST /cancel`.
     - PROBE-C: `settledBeforeCommit false waited 809 ms -> 409 SUPPLIER_IMPORT_NOT_CANCELLABLE | db status validating | source exists true`.
     - PROBE-G: `-> 409 SUPPLIER_IMPORT_NOT_CANCELLABLE | db status running`.
  2. **Mutant M1 survives.** With ` FOR UPDATE` removed from line 288, the unit file and both import integration files (run serially) give `pass 39 fail 0`.
  3. **The same mutant corrupts state under the probes.**
     - PROBE-C: `-> 200 | db status cancelled | source exists false`. A job the precheck worker has claimed is cancelled, and its source is deleted while the worker would be reading it.
     - PROBE-G: `-> 200 | db status cancelled`. A `running` job, which is writing Supplier rows, is relabelled `cancelled` mid-execution.
- **Impact:**
  - None today.
  - The risk is a regression. The lock is the only control: the UPDATE has no `AND status IN (...)` guard. A natural refactor would break HD-058 2A without turning the suite red, for example a plain ownership read added to remove L-1's timing oracle, or T45 reusing this read.
  - The mutation record does not cover the concurrency axis.
- **Fix:**
  1. Add PROBE-C as a regression test, and optionally PROBE-G.
  2. As defence in depth, change the UPDATE to `WHERE id = ? AND status = ?` (passing `job.status`) and assert `affectedRows === 1`.
  3. Re-run M1 and require it to go red.

### L-1 (Low): Lock wait leaks existence

- **Location:** `SupplierImportService.js:287-289`.
- **Cause:** under REPEATABLE READ, InnoDB locks the primary-key record before it evaluates `created_by`. So another user's cancel waits on a job that is locked, while a missing id answers at once.
- **Evidence (PROBE-D),** with user A's job held `FOR UPDATE` for about 1.5 s:
  - `foreign cancel 404 SUPPLIER_IMPORT_NOT_FOUND 1514 ms`
  - `missing cancel 404 SUPPLIER_IMPORT_NOT_FOUND 7 ms`
  - `foreign GET 404 3 ms`
- **Impact:**
  - User B can tell from latency that job X exists and is being processed right now.
  - B's attempt also briefly locks A's job, so a SKIP LOCKED claim skips it for one tick.
  - Practical value is low: job IDs are AUTO_INCREMENT, so B can already infer that jobs exist from gaps between B's own job IDs.
- **Fix:** first read ownership without a lock and answer 404 if the job is not the caller's; only then take `FOR UPDATE`. Do this only together with M-1's test and status guard. Otherwise accept and document.

### L-2 (Low; Product Owner awareness): The Supplier audit API shows every user's import jobs

- **Location:** `server/src/modules/supplier/SupplierAuditLogService.js:78-107` has no projection or ownership filter for `target_type = 'import'`. T44 adds `import.cancel`.
- **Evidence (PROBE-F),** for a user with only `supplier.view`:
  - `GET /api/v1/supplier-imports/:id` → 403.
  - `GET /api/v1/supplier-audit/logs?targetType=import&target=import-<id>` → 200, with the `import.cancel` and `import.upload` entries.
  - Those entries reveal the uploader's username, the client IP and the job's lifecycle. Precheck audits also carry the counts.
- **Impact:**
  - Metadata only: no CSV content, stored name or path.
  - The T44 test title "anyone else cannot tell it exists" and the wording of HD-058 1A overstate the guarantee.
- **Fix:** either record that HD-058 1A covers the job API only and that auditors see the import lifecycle on purpose (and reword the test title), or raise a Product Owner decision on filtering `import.*` audit entries.

### L-3 (Low): "Delete after commit" (HD-058 3A) is not pinned

- **Location:** `SupplierImportService.js:309-318`.
- **Evidence:** mutant M5, which deletes the source inside the transaction, survives (`pass 39 fail 0`).
- **Impact:** if the commit then failed, the job would stay `uploaded` with no source, and precheck would later fail it with SOURCE_UNAVAILABLE.
- **Fix (optional test):** use a `withTransaction` that runs the callback and then throws, and assert the source still exists.

### I-1 (Info): The client cancel comment overstates idempotency

- **Location:** `client/src/services/supplierImport.js:19-21`.
- **Detail:** without a caller-supplied key, `HttpClient` makes a new UUID per call and has no retry, so a user-level retry gets 409 rather than a replay. This is harmless; the version check prevents a second effect.
- **Fix:** reword the comment, or accept `{ idempotencyKey }` like `customer.js` and `inventory.js`.

### I-2 (Info): The id parameter is coerced

- `01`, `1.0`, `+1`, `1e0`, `0x1` and `%20<id>` are coerced to the integer.
- `9007199254740992` and `-1` answer 400.
- This is harmless and consistent with request coercion elsewhere.

### I-3 (Info): Detail reads the job and its rows without a shared snapshot

- The summary and the rows can disagree during later transitions; this is cosmetic.
- REV-068 I-2 still holds, because no transition leads back to `validating`.

### I-4 (Info): A failed source cleanup logs the stored name

- The name is server-generated, the log follows T43's upload pattern, and the name never appears in a response.

## Verified as correct (with evidence)

- **Suites:**
  - `supplierImportHandlers.test.js`: 9/9.
  - `supplierImport.integration.test.js`, run serially: 17/17.
  - Client `supplierImport.test.js`: 3/3.
  - ESLint on the changed files: exit 0.
  - `handlerConventions` and `handlerRegistry` tests pass.
- **Ownership and IDOR (PROBE-E):**
  - A foreign job and a missing job give byte-identical 404 bodies, apart from requestId and timestamp, also with filters and paging.
  - Another user's list is empty.
  - `supplier.view` alone gets 403 on all three routes.
  - `PERMISSION_STALE` applies immediately.
- **Idempotency scope (PROBE-A/B):**
  - User B reusing A's key gets 404, not a replay: the scope is `jwt:sub`.
  - The same user reusing a key on another job gets `409 IDEMPOTENCY_CONFLICT`, because the params are part of the fingerprint.
- **Races, on the shipped code (PROBE-C/G):**
  - Cancel against an in-flight claim waits, then answers 409, and the source is kept.
  - The claim side skips a locked job.
- **Rows:**
  - Rows are hidden while the job is `uploaded` or `validating`.
  - REV-065 I-3 is unaffected: cancel only moves `uploaded` to the terminal `cancelled`, so it never shifts the `version - 1` attempt count.
- **Mutation claims spot-checked:** M2 (get without `created_by`), M3 and M4 are killed.
- **Route order:**
  - Renaming `jobHandlers.js` to `aJobHandlers.js` makes `GET /template` answer 400 in two tests, and restoring the name restores it.
  - The registry sorts module URLs, so the order does not depend on the filesystem.
- **Schemas:**
  - Real precheck rows and field-less execution errors both validate.
  - A precheck-failed job's detail returns `filesPurged: true` and `rows: []`.
  - Output validation also runs in production.
  - No path, stored name or SHA appears in any response.
- **Paging:**
  - `page=1000000&pageSize=100` answers in 3 ms on both list and detail.
  - OFFSET work is bounded to the caller's own jobs or one job's rows, both on indexes.
  - Out-of-range parameters and unknown keys answer 400.
- **Audit:** exactly one `import.cancel` row across a replay, with the uploader as actor and `{before, after}` detail.
- **HD-058:**
  - 1A holds for the job API (see L-2).
  - 2A, 3A and 4A hold.
  - 5B is covered by the upload description.

## Author's verification of M-1 (after the review)

The author added the regression test `TASK-044 (REV-069 M-1): cancel waits for a claim that holds the job, then refuses the job it moved on`. In it, one transaction holds the job `FOR UPDATE` and moves it uploaded→validating or queued→running, and cancel must still be pending when that transaction commits; cancel must then answer 409 and the source must remain.

- **Shipped code:** the test passes.
- **With ` FOR UPDATE` removed:** the test fails with `uploaded -> validating: actual undefined, expected SUPPLIER_IMPORT_NOT_CANCELLABLE`. The cancel's own UPDATE waits for the row lock, then overwrites the claimed job with `cancelled`, which reproduces the reviewer's mechanism.
- **A first draft of the test was wrong.** It read its "settled" flag after awaiting the cancel, so the flag was always set. It now records the flag inside the transaction, before the commit.

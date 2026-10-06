# REV-070: TASK-044 REV-069 remediation (PR #175), independent review

Reviewer: REV-070, an independent agent using the security-auditor persona. I did not write this code or REV-069.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The text below is the reviewer's, apart from this note and light formatting.

- **Commit:** a2d577ef6f8d715773d98969e4c0a5bb10f2d2e1 on `claude/supplier-task-044`; base main 29893c3.
- **Diffs reviewed:** the remediation, `f43196f..a2d577e`, and the whole of T44, `29893c3..a2d577e`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev069`, detached. It ends at a2d577e with a clean status, and the temporary probe file is deleted.
- **Database:** MySQL on 127.0.0.1:3444, schema `erp_rev070`.
- **Method:**
  - Read REV-069, HD-058 and HD-059, the carry-forward section, the cancel, get and list code, `assertActorFresh`, `MySqlDatabaseService.withTransaction`, and the foreign keys in migration 0061.
  - Ran the suites.
  - Ran 6 probes against the real app and real MySQL, over HTTP and at service level, reading `performance_schema.data_locks` through an admin connection.
  - Ran 12 mutants with my own runner, which restores each file byte for byte.

## Verdict: APPROVED

There is no open Critical, High or Medium finding. Each REV-069 item is either fixed or accepted as HD-059 decided, and every fix is pinned by a test that discriminates. The findings below are Info only.

## Findings

### I-1: Mutant #42 is equivalent for safety, not "equivalent by design"

- **Probe P3.** A concurrent transition commits after the cancel's snapshot is taken but before the cancel reads the job.
  - For `ready → queued`, the shipped code answers `409 VERSION_CONFLICT`, while #42 (no `FOR UPDATE`) answers `409 SUPPLIER_IMPORT_NOT_CANCELLABLE`.
  - For the other transitions, both answer the same.
- **Impact:** the job is never cancelled wrongly. Only the 409 code differs, and only inside a microsecond window. `ready → queued` arrives with T45.
- **Fix:** reword the carry-forward. No code change.

### I-2: The carry-forward misdescribes #41

#41 keeps the status guard and removes the lock and the `affectedRows` check. Both #40 and #41 are killed by the M-1 regression test. The fix is a wording change.

### I-3: "Ownership never changes" is only approximately true

- `created_by` is `ON DELETE SET NULL`, so ownership can be cleared but never moved to another user.
- No code in `server/src` updates `created_by` or deletes job rows, so the locking read by ID alone cannot act on another user's job.
- The comment could say "only cleared, never reassigned".

### I-4: An indeterminate commit leaves the source without a cleanup log (pre-existing)

- If a COMMIT whose outcome is indeterminate did in fact commit, the job is `cancelled` with `files_purged_at` set, but the source remains.
- `withTransaction` logs `database.transaction.indeterminate` in that case.
- This is covered by HD-044's T48 obligation to retry failed deletes. The L-3 test correctly models a definite failure.

## Verified as correct

### REPEATABLE READ sequence (P3)

A transition committed straight after the non-locking ownership read is still seen by the `FOR UPDATE` read:

| Transition | Answer | Job afterwards | Source | Cancel audits |
| --- | --- | --- | --- | --- |
| uploaded → validating | `NOT_CANCELLABLE` | validating | kept | 0 |
| queued → running | `NOT_CANCELLABLE` | running | kept | 0 |
| ready → queued | `VERSION_CONFLICT` | queued | kept | 0 |

### No path cancels a wrong job

- **P4, a claim in flight, over HTTP:** the cancel is still pending when the claim commits (about 810 ms), then answers 409. The status is unchanged, the source is kept and no audit row is written.
- **P2, a stranger's cancel:** `data_locks` shows no lock at any point, and the answer is `NOT_FOUND`. The owner's own cancel shows an `X,REC_NOT_GAP` lock, which proves the probe can see one.
- **R1:** removing the `if (!owned)` check lets a stranger cancel the owner's job. The IMP-015 and L-1 tests kill it.

### The second defence is real

| Mutant | What it removes | P3/P4 outcome |
| --- | --- | --- |
| #42 | the lock | still refused |
| #40 | the lock and the status guard | `200, cancelled, source deleted, audit 1` (the original defect) |
| #41 | the lock and the `affectedRows` check | `OK, status unchanged, source deleted, audit 1` |

#41 shows the `affectedRows` check is necessary, not decorative.

### L-1 is closed for cancel and get (P1, P6)

- With the job held `FOR UPDATE`, P1 timed the stranger's requests:

  | Request | Answer | Time |
  | --- | --- | --- |
  | foreign cancel | 404 | 6 ms |
  | missing cancel | 404 | 5 ms |
  | foreign get | 404 | 3 ms |
  | missing get | 404 | 2 ms |

- The owner's cancel still waits for the lock.
- P6 took 400 interleaved samples of each case at service level; the latencies cannot be told apart (p50 0.470 ms both).

### Each new test discriminates (my runner)

| Mutant | Result | Killed by |
| --- | --- | --- |
| #40 | killed | M-1 test |
| #41 | killed | M-1 test |
| #42 | survives, expected | — |
| #43 | survives, expected | — |
| #43b (= the f43196f code) | survives, expected | — |
| #44 | killed | L-1 test |
| #45 | killed | L-3 test and the 3A cleanup test |
| R4 (delete before commit, error swallowed) | killed | L-3 test only |
| R1 | killed | IMP-015 and L-1 tests |
| R2 (ownership read `FOR UPDATE`) | killed | L-1 test |
| R3 (ownership read `FOR SHARE`) | killed | L-1 test |

### The L-3 test models a definite failed commit

The whole cancel callback runs and then `withTransaction` throws, so the work rolls back. The test asserts the job is still `uploaded` and the source still exists. R4 dies only on this test.

### Audit, idempotency and response shapes are unchanged (P5)

- The cancel answers 200 with the same 20 summary keys.
- A replay with the same key is byte-identical; a new key answers 409.
- Exactly one `import.cancel` row is written, with detail `{before:{status:"uploaded"}, after:{status:"cancelled"}}`.
- Refusals write no audit row.

### Suites

- Server import suites, run serially: 69/69. The integration file passes 20/20, including the three new tests.
- Client `supplierImport.test.js`: 3/3.
- `handlerConventions` and `handlerRegistry`: 3/3.
- ESLint on the changed files: exit 0.

## Commands run

- `git diff` over both ranges, and reading of the documents listed under Method.
- From `server/`, with `env_rev070.sh` sourced:
  - `node --test --test-concurrency=1 --test-timeout=120000 --import ./test-support/testEnv.js` over the four unit files and the two import integration files.
  - The probes, from a temporary copy of the integration file run with `--test-name-pattern "REV-070"`. The copy was deleted afterwards; the probe source is kept at `scratchpad/rev070/probes.js`.
  - `python3 scratchpad/rev070/mut.py`, which reported `restored True`.
- `npx eslint <changed files>` and `npx vitest run test/services/supplierImport.test.js`.
- Final state: `git status --short` is empty and HEAD is a2d577e.

## Author's follow-up

I-1, I-2 and I-3 were wording only. The carry-forward and the service comment were corrected after this approval; no behaviour changed.

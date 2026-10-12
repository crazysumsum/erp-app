# REV-083 — independent review of TASK-050 (PR #197)

- **Reviewer:** `agent-skills:security-auditor`, a separate agent independent of the author.
- **Baseline:** `7f339893585e7744213ae91fd598d7c980878b32` on base `0feb9d7`.
- **Environment:** a detached worktree and its own schema `erp_rev083` on a throwaway MySQL.
- **Verdict:** **CHANGES_REQUESTED.**
  - The speedup is real, and moving the search out of the transaction is sound.
  - But the claim that "no qualifying candidate is lost unless the cap truncates" is false at four in-range name lengths.

## Findings

### M-1 (Medium): floating-point error in `minCommon`

- **Where:** `supplierDuplicateCandidates.js`.
- **Cause:** `Math.ceil(0.85·a/1.15)` comes out one too high when 17a/23 is a whole number.
  - 0.85·23/1.15 = 17.000000000000004, so `ceil` gives 18.
  - The lengths in range (names are at most 190 characters) are a = 23, 46, 92 and 184.
- **Effect:**
  - `HAVING` drops a candidate with Dice exactly 0.85, which the old search returned.
  - The prefix also shrinks by one gram.
- **Reproduced on MySQL:**
  - `abcdefghijklmnopqrstuvwx` (23 grams) against `abcdefghijklmnopqr` (17 grams): the PR returns nothing, while base and the epsilon-fixed version return the match.
  - The same strings at a = 22 (Dice 0.842) are correctly not returned.
- **Fix:** compute in integers, and add the 23/17 pair as a regression test.

### L-1: the candidate cap and its ranking are untested

- The new test seeds 1,204 names, below the cap of 3,000. The mutants "rank by fewest rare-gram hits" and "cap 50" both survive.
- The test also holds only on a near-empty schema.
  - On a schema with the 100k seed, one query finds 7 of the 10 expected names. The old search misses the same ones, through its own top-50 limit.

### L-2: the recall claim has no committed evidence, and "within noise" is wrong

Reproduction at 100k (200 perturbed seeded names, top 10 against brute force):

| Search | Recall | p50 ms | p95 ms |
| --- | --- | --- | --- |
| PR | 98.31% (21 of 1,243 missed) | 75 | 98 |
| Old | 98.95% (13 missed) | 704 | 839 |
| PR without the cap | 98.95%, the same as old | 809 | 964 |

- The whole recall gap comes from the cap, and it is deterministic, not noise. The cap is also where the whole speedup comes from.
- The report should say both, and commit the recall script and its output.

### L-3: report wording

- "Every operation failed" is wrong: 11 of 12 failed; the duplicate check passed at 1,590 ms.
- **The run during the import:**
  - The slowest operation was the exact Code search at 142.8 ms, not update.
  - It was a 90 s run with 5 s of warm-up, which the report does not say.
- **The query-plan table:**
  - It leaves out the rarest-gram `UNION ALL` statement: about 60k index rows and 7 ms per call.
  - Its call counts include the warm-up.

### L-4: metrics

- **Two surviving mutants:**
  - `uploaded` dropped from the waiting set.
  - `stalledMs` ignored.
- **Wrong comment:** the approvals query scans the whole `idx_supplier_activation_approver` index, so every request ever made, not only pending ones.

### L-5: benchmark side effects

- It leaves `fr_idempotency_keys` rows behind.
- `TRUNCATE performance_schema…summary_by_digest` clears the whole server's digest statistics.
- The `--database` check is a confirmation only. The seed's empty-table check is the real guard.

### I-1: the search now runs before `assertActorFresh`

- Nothing leaks, because the results are discarded when authorization fails.
- A stale but valid token costs about 75 to 190 ms of database time before it is rejected. Requests that fail later also pay for the search.

### Also

- The mutant that removes the Dice filter survives.
  - The filter predates this PR. The test's top-10 lists are already full of qualifying names, so they cannot show a non-qualifying one.

## What the reviewer verified

- **The search outside the transaction:** the lock order, snapshot and import path are unchanged, and responses, errors, audit and approval flows are unaffected.
- **The search:**
  - The pigeonhole math is right, apart from M-1.
  - Without the cap, the result equals the old search exactly.
  - Edge cases hold: a = 0, a = 1, t = 1, CJK names and the exact-name path.
  - There is no SQL injection: the `LIMIT` values are constants.
- **Metrics:** the SQL is valid, the index is used, the log contexts carry numbers only, and the job runs at cluster scope.
- **Evidence:** every per-operation figure matches the evidence files.
- **Tests and mutation:**
  - The listed test files pass (38/38), and so do the supplier integration tests on a clean schema (25/25).
  - Of 30 mutants, 18 were killed. Of the survivors:
    - Seven change only the cost, or nothing observable.
    - Five are real gaps: L-1, L-4, and the Dice filter.

**Not checked:** the full suite, a 120 s rerun of the benchmark, the run during the import, and MySQL CPU.

## Environment and cleanup (reviewer)

- **Data:** only `erp_rev083` was used, and it was returned to baseline.
- **Files:** every mutant was restored; `git status` is clean.
- **Processes:** nothing was left running, and no `pkill` was used.
- **Elsewhere:** no `.env` file was read, and nothing was done in git or on GitHub.

## Author's follow-up

- **M-1 verified:** across a = 1..400, `Math.ceil(0.85a/1.15)` differs from the exact integer result at a = 23, 46, 92, 184, 299, 345 and 368.
- **A correction to what HD-084 was decided on.** The Product Owner was told that the recall difference was within noise. The reviewer shows it is deterministic and caused by the cap: 98.31% against 98.95%. The cap is also the whole source of the speedup.
- Taken to the Product Owner as HD-087.

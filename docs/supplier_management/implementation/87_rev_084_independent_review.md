# REV-084 — independent re-review of TASK-050 (the round after REV-083)

- **Reviewer:** `agent-skills:security-auditor`, a separate agent, independent of the author.
- **Baseline:** `de030eb7b74e8cd0d70c98adc65273c73ac2514c` (PR #197). The scope is the author's commits `910b008..54be3ec` (HD-087, HD-088) merged with main.
- **Environment:** its own schema `erp_rev083` on a throwaway MySQL.
- **Verdict:** **APPROVED.** Nothing Critical, High or Medium; five Low findings.

## Findings

### L-1: the cap-ranking test proves neither the cap nor the ranking

- **What survives:** two mutants.
  - Ranking by `supplier_id` alone survives, because the target was seeded first and so has the lowest id.
  - Binding the constant cap instead of `this.candidateCap` also survives.
- **The mutation record overstates it:** the line "cap tiny is tested through the ranking test" is not true.
- **Fix:** seed the target last, and add a case where `candidateCap: 1` drops a second qualifying name.

### L-2: a failed start-of-window digest read crashes the benchmark before its cleanup

- **Cause:** the promise is not awaited until about 120 s later.
  - An unhandled rejection ends the process, so the `finally` block never runs.
  - The benchmark's user, role and Suppliers stay behind, and no report is written.
- **Reproduced:** with the same pattern, the process exits with code 1 and the cleanup never runs.
- **Fix:** attach a handler to the promise at once.

### L-3: migration 0080 is online only when no transaction is open on `suppliers`

- **What holds:** on 100k rows, the build took 217 ms, and concurrent DML ran fine (slowest 29.7 ms).
- **What does not:**
  - With an idle open transaction on `suppliers`, the ALTER waited for the metadata lock.
  - A plain SELECT queued behind it for 4,007 ms.
  - `lock_wait_timeout` is one year on that server.
- **Fix:** set a short session `lock_wait_timeout` and fail, or document the precondition, and qualify the comment.

### L-4: the list-index test hangs instead of failing when the migration throws

- **Cause:** the connection is closed by an after-hook that is registered after the `up()` calls. If `up()` throws, the hook is never registered, and the open connection keeps the file from exiting.
- **Evidence:** two mutants hung, 300 s and about 285 s, until the reviewer killed them.

### L-5: the recall cost of the cap depends on the seed

- **Reviewer's own seed:** with the cap 97.36%, without it 98.48%, a gap of 1.12 points. Two runs gave identical counts.
- **Across three seeds** (REV-083's, the author's, the reviewer's), the gap is 0.64 to 1.12 points.
- **Fix:** the report should give that range. The Product Owner confirmed the cap on 0.66 points.

## Info

- **Run-to-run noise:**
  - **Runs:** four benchmark runs, alternating with the list indexes visible and invisible.
  - **The list improvement is consistent:**
    - Default list p95: 26 to 32 ms with the indexes, 52 to 206 ms without.
    - Sort by name: 24 to 31 ms against 58 to 195 ms.
    - Currency filter: 20 to 27 ms against 42 to 110 ms.
  - **Everything else is within noise:** overall p95 ranged from 124 to 272 ms. The report should say "within run-to-run noise".
- **A plan flip, seen once:**
  - A rare payment-term filter whose rows are all old was once planned as a reverse scan of `idx_suppliers_updated_id`, reading 99,990 rows in 82.6 ms.
  - It did not recur. It is bounded at about 80 ms at 100k rows.
- **Wording:**
  - "Met for every sort and filter" overlooks sort by status.
  - "The same results as the old search" is true only of the old search with M-1 fixed.
- **The migration's compatibility check:** it compares column names only. A UNIQUE, prefix, DESC or INVISIBLE index with the same name would be accepted.
- **`threshold` is not validated** (no caller passes it).
- **Digest diff:**
  - **It is correct:** the similar-name digest count equals duplicates + creates + updates exactly (1,344).
  - **`maxMs`** is the maximum since the server's last digest reset, not only within the warm-up.
  - **The digest table:** if `performance_schema_digests_size` fills up, new statements are lost silently. None are lost today.
- **The FULLTEXT and list-index EXPLAIN timings** come from ad-hoc runs that were not committed. The reviewer reproduced their conclusions; the numbers differ in detail.
- **FULLTEXT residue:** dropping the last FULLTEXT index leaves InnoDB `fts_*` tables. This is harmless.

## What the reviewer verified

- **M-1:** the fixed formula equals the brute-force minimum in all 165,200 cases (401 thresholds, a = 1..400), never too high or too low. The old formula was too high in 381 of them.
- **The cap parameter:** it is bound as a numeric literal and validated.
- **The HD-088 indexes:**
  - They are used by the default list, deep pages, the currency and payment-term filters, `includeArchived`, `updatedFrom`, and the name sort in both directions.
  - Status filters keep their existing index.
  - Text-search pages do not change (still a full scan with filesort).
  - The migration is idempotent and refuses a same-named index on other columns.
- **No conflicting 0080 on main.**
- **The benchmark:**
  - It no longer touches other schemas' digests.
  - It cleaned up after every run; the only leftover is `fr_idempotency_keys`, as documented.
- **The recall script:** it only reads, and is reproducible.
- **The report:** every figure matches the evidence JSON.
- **Tests:** 35/35 pass, and the integration files pass again on a clean schema (6/6).
- **Mutation:** 19 mutants.
  - Killed by an assertion: 10.
  - Killed only by a hang: 2 (L-4).
  - Real gaps: 2 (L-1).
  - Policy, equivalent or cost-only: 5.

## Environment and cleanup (reviewer)

- **Data:** only `erp_rev083` was used, and it was returned to its migrated, empty state. The FULLTEXT residue was removed with a COPY rebuild.
- **Files:** every mutant was restored, and `git status` is clean.
- **Processes:** two of the reviewer's own hung test processes were stopped by PID. No `pkill` was used, and nothing is left running.
- **Elsewhere:** no `.env` file was read, and nothing was done in git or on GitHub.

## Author's follow-up

- **After this review:** CI on `de030eb` failed in `supplierCoreMigrations.integration.test.js`, which asserts the full index list of `suppliers`.
  - The test was updated for the two 0080 indexes in `1a9b1e3`.
  - The author's own CI-style full run had been done before HD-088 and was not repeated after it.
- **The findings** were taken to the Product Owner as HD-089. The answer: 'A，唔使再 review，CI 過就 merge'.
- **Fixes:**
  - **L-1:** the target is seeded last, and `candidateCap: 1` must drop a second qualifying name. "Rank by id" and "constant cap" are now killed.
  - **L-2:** the start-of-window digest read gets a handler at once, so a failure reaches the `catch` and the cleanup still runs.
  - **L-3:** the migration sets `lock_wait_timeout` (10 s by default), restores the previous value, and turns a timeout into a message telling the operator to finish the long transaction and rerun.
    - A test holds an open transaction, and checks that the migration gives up after 1 s and that a rerun then succeeds.
    - The mutant without the lock wait fails in 10 s.
  - **L-4:** the connections are closed in `finally`. The "no skip" mutant fails instead of hanging.
  - **L-5 and Info:** the report gives the 0.64 to 1.12-point range and says "within run-to-run noise". It also notes the sort-by-status exception, "the old search with M-1 fixed", the ad-hoc status of the FULLTEXT and EXPLAIN measurements, the plan flip, and that the migration's check compares names only.
- **Not changed:**
  - `threshold` validation: no caller passes a threshold.
  - The `performance_schema` digest-table capacity: none are lost today.

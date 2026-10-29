# REV-136: independent review of the DEF-049 fix (HD-154 A)

- **Reviewer:** `agent-skills:code-reviewer`, a separate agent. I did not write this change.
- **Baseline:** PR #301, branch `claude/supplier-def049-row-pick` at `e162c60d`, reviewed as `git diff origin/main..HEAD` against base `8c31c94a`.
- **Verdict:** **CHANGES_REQUESTED**. 0 open critical, 0 open high. 1 Medium, 2 Low, and nits.

## What the reviewer confirmed

- **The fix picks the same row as the old query.**
  - The lower of the two per-status minimums is the minimum over `IN (...)`.
  - When nothing is pending, the pick returns null before the actor check (REV-071 L-1 holds).
  - When the fence throws with `rowNumber === null`, the error is rethrown. The worker's `finally` releases the lease, and the next tick retries.
- **The read view opens after the job lock.**
  - `withTransaction` sends a plain `START TRANSACTION` (`MySqlDatabaseService.js:507-510`, mysql2 `beginTransaction`), and nothing reads without a lock before the job `FOR UPDATE`.
  - Every product writer of `supplier_import_rows` locks the job first. The only foreign key is `job_id` RESTRICT, and the boot check rejects triggers.
- **The forced index is safe.**
  - `idx_supplier_import_row_status` is created by 0062 and checked by name at boot (`supplierSchemaCheck.js:35`).
  - Only speed depends on the plan, never correctness.
  - The locking statement is a full-primary-key equality, so it takes one record lock.
- **The tests discriminate.** The reviewer reproduced 9 against 59 on the old query, and 58 against 59 plus the timeout on the rejected candidate. The probe does not depend on the plan, and cleanup works.
- **The ledger and the fingerprints check out.**
  - PR #300's facts: 8c31c94a, 01:38:55Z, head 28e26efa, 13/13, run 40797826220.
  - Fingerprints were recomputed: 418abf… is unchanged, and 107fb439… is correct.
  - Performance run 2 matches the record, and the scratch mysqld now carries the 16,384 settings.

## Disposition

| Finding | Disposition |
| --- | --- |
| **M1:** no test checks the outer `ORDER BY row_number` across the two branches. A mutant without it passed all 91 import tests. | **Reproduced, then fixed.** The first DEF-049 test now applies 49 rows, so the next row (50) is a warning ahead of pending valid rows. It must pick 50 and then 51. The mutant is now red (51 against 50). The register no longer says the test "covers the warning row". It states what the test covers. |
| **L1:** neither the read-view claim nor the fence had a test | **Added the suggested test.** A side transaction holds the job lock and marks row 1 applied. `processNextRow` waits on the job lock; the test polls `information_schema.PROCESSLIST` until it is visible, with no fixed sleep. Then the side transaction commits, and the pick must be row 2. The mutant with a non-locking read before the job lock is red with `SUPPLIER_IMPORT_ROW_STATE_CONFLICT`, so the test also exercises the fence. |
| **L2:** the ledger said "only on null plans"; the p95 value and the cold buffer pool were unsupported; the times were vague | **Ledger:** the observation now says TC-085 also failed `for_sku.p95_under_2s`. **Register:** "over the 2 s limit (value not retained)", the cold cache marked as an inference with the 128 MiB pool noted, and exact times (02:29Z, about 02:41–02:53Z, 03:09–03:11Z). |
| Nit: `sideConnection()` ignored `DB_SOCKET_PATH` and the config defaults | It now builds from `config/database.js` (host, port, user, password, database, socketPath). |
| Nit: a variable named `warning` held row 52 | Renamed to `second`; it now holds row 51. |
| Nit: the fence had no comment | One line added: it should not happen, and it throws rather than ending the job with rows still pending. |
| Nit: the writer line numbers predate the fix | The register notes they are as at `ef5a61a4`, and that the fix moved the later lines down. |
| Nit: `FORCE INDEX` against optimizer hints | Kept, because the codebase already uses `FORCE INDEX` (Sales, Fulfillment). Noted for a future MySQL upgrade. |
| Outside the module: Customer import uses the same pick | Already measured in this session and reported to the Product Owner. Customer is not this module's code, so no change was made here. |

## After the fixes

- `supplierImportExecution.integration.test.js` passes 19 of 19.
- Four mutants were run, each backed up first, restored afterwards and checked with `cmp`. Each is red on the test it targets:

| Mutant | Result |
|---|---|
| Old query | 10 against 59 |
| Rejected candidate | 58 against 59, plus the staging timeout |
| No outer `ORDER BY` | 51 against 50 |
| A read before the job lock | Fence conflict |

- The Supplier server suite passes 735 of 735.
- Lint failed once on the new wait loop (`no-promise-executor-return`). After a change to how the loop is written, with the same meaning, lint exits 0 and the file passes 19 of 19.

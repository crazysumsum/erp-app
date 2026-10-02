# REV-071: TASK-045 (PR #177), independent review

Reviewer: REV-071, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back, because the harness does not let a review subagent write report
> files. The text below is the reviewer's, apart from this note and light formatting.
>
> One correction: the report says the environment file did not set `DB_NAME`. It does: `env_rev071.sh` exports
> `DB_NAME=erp_rev071` on its first line. The reviewer exported the same value again, so nothing changes.

- **Commit:** `1138dc50cadce650a89e3d563c3157aad973d6b3` (PR #177), reviewed as `git diff 9594646..1138dc5`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev071`, detached. It was clean at the start and is clean at the end.
- **Database:** MySQL 26.7.0 on port 3445, schema `erp_rev071`.
- **Method:**
  - Read every changed file against the T45 acceptance criteria, design §2.5, §2.6, §4.4, §4.5, §5.13, §6.1, §6.9, §8.1 and §8.8, HD-048, HD-060 and the carry-forward.
  - Ran the unit files, both import integration files and the Supplier regression set, serially.
  - Ran 10 mutants of my own.
  - Ran a scratch harness against real MySQL. It covers four things:
    - a poisoned second connection;
    - concurrent pending creates;
    - real lock waits and timeouts;
    - revocation after the last row, and a deleted approver.
  - Read `performance_schema.data_locks` and EXPLAIN output.

## Verdict: APPROVED

There are no Critical, High or Medium findings. Three Low findings and four Info items remain open, and none of them affects data integrity or authorization.

## Findings

### L-1: A fully applied job is reported `failed` when the confirmer loses access before the final call

- **Location:** `SupplierImportService.processNextRow`. The confirmer re-check and `#failRevoked` run before the next row is selected, and before the `if (!row) return null` check.
- **Evidence (harness `revoked-after-last`):** row 1 is applied, then the permission is revoked, then the worker makes its final call.

  ```
  final call: {"rowNumber":null,"status":"revoked","appliedSupplierId":null}
  job: {"status":"failed","applied_count":1,"failed_count":0,"last_error_code":"SUPPLIER_IMPORT_AUTHORIZATION_REVOKED"}
  ```

  The same happens when a job resumes after a crash between the last row's commit and finalize.
- **Impact:** No data is wrong, but the job reports the wrong result.
- **Fix:**
  - Select the next pending row first.
  - If there is none, return `null` so the job finalizes.
  - Re-check the confirmer only when a row exists.
  - Add a test.

### L-2: A real lock wait longer than the timeout budget does not produce `SUPPLIER_IMPORT_ROW_BUSY`

- **Location:** the catch branch of `processNextRow`. The fail-marking transaction first takes `SELECT … FOR UPDATE` on the job.
- **Evidence (harness `lockwait`):** another session holds `SELECT code FROM currencies WHERE code='HKD' FOR UPDATE`.

  | Setting | Lock held | Result |
  | --- | --- | --- |
  | `DB_QUERY_TIMEOUT_MS=1500` | 6 s | Row `failed` with `SUPPLIER_IMPORT_ROW_BUSY` after 5,522 ms. This case works. |
  | `DB_TRANSACTION_TIMEOUT_MS=1500` | 6 s | `processNextRow` threw `DATABASE_TRANSACTION_TIMEOUT` after 3,009 ms; the row stays `valid`. |
  | Default timeouts | 40 s | `processNextRow` threw `DATABASE_QUERY_TIMEOUT` after 39,516 ms; the row stays `valid`. |

- **Mechanism:** after the row transaction's connection is destroyed, its server-side transaction is still waiting on the lock, and it still holds the job's X lock. The fail-marking transaction blocks on that lock until its own query timeout.
- **Impact:** Integrity is safe: there is no Supplier and no marker, and the row is retried after the 660 s lease, which is arguably better. But HD-060 4A and the carry-forward line ("transaction or query timeout fail the row as BUSY") do not hold for long waits. The 4A test throws only synthetic errors, so it cannot detect this.
- **Fix, either:**
  - **(a)** correct the wording: a long wait leaves the row pending, and it resumes after the lease; or
  - **(b)** mark the row with `NOWAIT` or `SKIP LOCKED` on the job.

  In either case, add a real lock-hold test with short timeouts.

### L-3: The T43 cleanup "delete by ID" still full-scans

- **Location:** `supplierImport.integration.test.js`, the cleanup of the 10,000-row test.
- **Evidence:** `like*.sql`, run with 2,000 seeded rows and 6 unrelated rows.

  | Statement | EXPLAIN | Unrelated rows locked |
  | --- | --- | --- |
  | `LIKE` delete | `type ALL` | 6 |
  | `id IN (<2000 ids>)` | `type ALL`, `key NULL` | 6 |
  | `id IN (<500 ids>)` | `type range`, `key PRIMARY` | 0 |

- **Impact:** This affects tests only. The parallel deadlock can still happen, and the carry-forward claims a fix it does not deliver.
- **Fix:** delete in primary-key chunks of at most 500, and correct the carry-forward.

### I-1: The in-transaction `SUPPLIER_CODE_TAKEN` mapping has no test

- **Evidence:** a mutant that removes the mapping survives the import, admin and supplier-management suites.
- **Why it matters:** the race is reachable when the competing create uses a different currency, because only same-currency creates serialize on the currency lock. Without the mapping, the row would record the generic `SUPPLIER_IMPORT_ROW_FAILED`.
- **Fix:** add a test that injects the race.

### I-2: A deleted approver gives `APPROVER_REQUIRED`, not `APPROVER_NOT_ELIGIBLE`

- **Cause:** `fk_supplier_import_approver` is `ON DELETE SET NULL`, and the applier maps `null` to `undefined`.
- **Impact:** No Supplier is created, so HD-060 3A holds, but the message is misleading. The case cannot be reached through the app, which never deletes users.

### I-3: Approval off at confirm and on at execution activates Suppliers directly

This is the snapshot rule the Product Owner accepted (AC-013, HD-060). T46 should state it in the confirm UI.

### I-4: Imported Supplier audits carry `requestId: ""`

`supplier.create` and the child audits do not name the import job. The suggestion is to set `requestId` to `import-<jobId>`.

## Verified as correct

**Baseline runs.**

| Suite | Result |
| --- | --- |
| Unit files | 37/37 |
| Both import integration files | 47/47 (the slowest of the 300 timed rows took 14 ms) |
| Supplier regression set | 440/440 |
| Client | 4/4 |

**1. The refactor preserves public behaviour.**
- Normalization runs in the same order, before the transaction.
- Error codes are the same, and the outer duplicate mapping is kept.
- The lock order is unchanged: settings S, then currencies X, then the inserts.
- The only addition on the approval path is a non-locking identifier SELECT, which returns `[]`, so the summary is identical.
- Invalidation and version sync are moved verbatim.
- Address, Contact and Identifier `create` behave as before.

**2. No helper uses a second connection.** The `poison` harness gives every service a database Proxy that throws on any access. It then runs the real applier for a create with address, contact and identifier (approval on, activate), followed by an update of that pending Supplier. The result is `POISON OK`. Mutant `pool-not-connection` is killed, including by the SIGKILL test. The SIGKILL points are placed correctly: "before" dies inside the row transaction, "after" dies after COMMIT.

**3. Authorization.**
- Confirm reads ownership without a lock.
- The route uses `jwt-password` and idempotency; the password never reaches the service.
- The approver is checked at confirm, and again at execution through `openRequest`.
- The confirmer is re-checked for active status and `supplier.mgmt` before each row (both mutants killed).
- The import cannot exceed UI rights: update rows never change status or Code, and archived Suppliers are refused.
- The audit actor is the confirmer.

**4. Snapshot and locks.**
- Execution uses the snapshot (mutant `live-policy` killed).
- Confirm locks the job, then reads settings FOR SHARE (mutant `no-share-lock` killed). There is no lock cycle.
- Concurrent imported creates serialize on the name-grams tail gap lock. The identifier gap-lock deadlock hypothesis does not reproduce, which matches the carry-forward.

**5. Data integrity.**
- Blank cells keep their values; the columns are NOT NULL DEFAULT '', so there is no NULL-versus-empty drift.
- The currency-change reason is passed.
- Children are written before the approval request.
- The expected version and everything precheck checked are re-checked at execution.

**6. Error exposure.**
- Row errors hold only public codes and messages, or the fixed generic pair.
- Busy detection walks wrapped causes.
- Revoked counts are rebuilt from rows.

**7. Test quality.** Nine of my ten mutants were killed; the survivor is I-1. The deadlock mechanism in the carry-forward (the LIKE delete full-scans) is confirmed, but its fix is not (L-3).

## Commands run

From `server/`, with `env_rev071.sh` sourced:
- the unit files;
- both import integration files, serially;
- the Supplier regression set;
- the client `supplierImport` test (vitest);
- `scratchpad/rev071/mutate.py` with 10 mutants;
- `scratchpad/rev071/harness.mjs` with `poison`, `deadlock`, `deadlock-noid`, `approver-deleted`, `revoked-after-last` and `lockwait` (three timeout settings);
- `like.sql`, `like2.sql` and `like3.sql` for the EXPLAIN and `data_locks` evidence.

Cleanup: the leftover Suppliers, jobs, users and roles from interrupted mutant and harness runs were deleted. In the end state the tables are empty apart from HKD, and the worktree is clean at `1138dc5`.

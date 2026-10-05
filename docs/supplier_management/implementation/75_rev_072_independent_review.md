# REV-072: TASK-045 REV-071 remediation (PR #177), independent review

Reviewer: REV-072, an independent agent using the security-auditor persona. It did not write this code or REV-071.

> Saved by the author from the reviewer's hand-back, because the harness does not let a review subagent write report
> files. The text below is the reviewer's, apart from this note and light formatting. The "Author's follow-up" section at the
> end is the author's.

- **Commit:** `7608699`. The remediation was reviewed as `git diff 1138dc5..7608699`; the whole of T45 was re-checked as `git diff 9594646..7608699`.
- **Database:** MySQL 26.7.0, schema `erp_rev072`. Server settings: `innodb_lock_wait_timeout=50`, REPEATABLE-READ, `eq_range_index_dive_limit=200`.
- **Method:**
  - Read REV-071, HD-060 and HD-061, the carry-forward, and every changed file.
  - Ran the unit, integration and client suites.
  - Ran 5 mutants.
  - Ran 3 temporary lock-timing probes.
  - Polled `performance_schema.data_lock_waits` while the L-2 test ran.
  - Probed L-3 with the real data shape, and added a temporary EXPLAIN to the real cleanup.

## Verdict: APPROVED

There is no Critical, High or Medium finding. The two Low findings and the Info finding are about tests or documentation only.

## Findings

### L-1: The L-3 cleanup still full-scans `suppliers` from the second chunk on

The real test, instrumented with an EXPLAIN before each chunk:

```
chunk 1: range/PRIMARY rows~500 table=2000
chunk 2: ALL/null rows~1463 table=1500
chunk 3: ALL/null rows~963 table=1000
chunk 4: ALL/null rows~463 table=500
```

- **Probe:** `l3.mjs` reproduced this with 2,000 Suppliers and their real name grams. Chunks 2 to 4 X-lock all 6 unrelated Supplier rows.
- **Cause:** once a chunk is about a third of the table, a full scan wins. Each chunk shrinks the table, so only the first chunk is safe.
- **Impact:** tests only. The parallel deadlock can still occur, and the carry-forward claims a fix it does not deliver.
- **Fix:** `DELETE /*+ INDEX(suppliers PRIMARY) */ …`. In `l3hint.mjs` all 4 chunks plan as `range/PRIMARY` and lock 0 unrelated rows. Then correct the doc, and optionally pin the plan in the test.

### L-2: The corrected 4A wording is still inaccurate at both ends

Three temporary probes used the same real-lock pattern as the L-2 test:

| Probe | Child environment | Lock hold | Outcome |
| --- | --- | --- | --- |
| W1 | `DB_TRANSACTION_TIMEOUT_MS=1500` | 2,301 ms | `failed SUPPLIER_IMPORT_ROW_BUSY`, which contradicts "longer than the budget leaves it valid" |
| W2 | `DB_QUERY_TIMEOUT_MS=1000`, `DB_TRANSACTION_TIMEOUT_MS=4000` | 2,001 ms | BUSY through `DATABASE_QUERY_TIMEOUT` |
| W3 | `DB_TRANSACTION_TIMEOUT_MS=1500` | 4,501 ms | `DATABASE_TRANSACTION_TIMEOUT`, and the row stays `valid` |

- **Where the boundary really is:** the fail-marking transaction waits on the job lock that the orphaned row transaction still holds. The boundary is therefore the row transaction's budget plus one fail-marking wait, about 20–30 s with the defaults.
- **Which timeout fires:** the server's lock-wait timeout is 50 s, so it never reports `ER_LOCK_WAIT_TIMEOUT` within the budget. A lock wait reaches BUSY through `DATABASE_QUERY_TIMEOUT`.
- **Impact:** documentation only. Both outcomes are safe.

### I-1: The race test's generated currency can collide with real ISO codes

The generator `C` plus two hex letters can produce `CAD` or `CDF`. CI is unaffected.

## Verified as correct

**L-1 remediation (confirmer re-checked after the row SELECT)**
- The lock order is job X, then row X, then consistent reads of the user and permissions. There is no new lock order.
- No row can be applied by a revoked confirmer.
- The revoked path still fails pending rows and rebuilds the counts.
- The mutant that moves the check back before the row SELECT is killed by the new test.

**L-2 test**
- It exercises the real path. `data_lock_waits` showed the child's row transaction waiting on HKD, held by the parent, and the fail-marking transaction waiting on the job, held by the orphan.
- The mutant without the parent's lock is killed.
- It passed 5 of 5 repeated runs.
- The child process exits cleanly; no transactions are left open.

**I-1 test**
- The competing Code is committed on another connection between the check and the INSERT.
- The mutant without the in-transaction mapping is killed.

**I-2 and I-4**
- The NULL-approver check fires only for an activating job under an approval snapshot; its mutant is killed.
- `import-<jobId>` fits in `varchar(64)` and reaches every audit. No consumer parses it. Its mutant is killed.

**L-3:** the `supplier_name_grams` chunk deletes are `range/PRIMARY` in every chunk.

**Regression runs**

| Suite | Passed |
| --- | --- |
| Both import integration files | 51/51 |
| Unit files | 58/58 |
| All Supplier tests | 528/528 |
| Client | 4/4 |

## Commands run

All suites ran serially against `erp_rev072`:
- the five mutants;
- `l3.mjs` and `l3hint.mjs`;
- the 10,000-row test with a temporary EXPLAIN, then restored;
- the L-2 test six times, one run with a `data_lock_waits` polling loop;
- the temporary W1, W2 and W3 probes, then restored.

**Cleanup:** one leaked Supplier from a mutant run was deleted. The schema ends empty apart from HKD, and the worktree is clean at `7608699`.

## Author's follow-up

All three findings are test or wording only, and each is within HD-061's decisions (fix the cleanup; correct the 4A wording). They were closed without a new decision:

- **L-1.** The cleanup deletes in chunks of 500 with `/*+ INDEX(suppliers PRIMARY) */`, and before each chunk the test asserts that the EXPLAIN plan is `range`/`PRIMARY`.
  - Checked first with `EXPLAIN FORMAT=TRADITIONAL` on 2,000 rows:
    - without the hint: `range/PRIMARY`, `ALL/NULL`, `ALL/NULL`, `ALL/NULL`;
    - with the hint: `range/PRIMARY` in all four chunks.
  - With the hint removed, the 10,000-row test fails with `actual ['ALL', null], expected ['range', 'PRIMARY']`.
- **L-2.** The carry-forward row now gives the measured boundary: the transaction budget plus one fail-marking wait, about 30 s with the defaults. It also notes that BUSY comes through the client-side timeouts, not `ER_LOCK_WAIT_TIMEOUT`.
- **I-1.** The tests' throw-away currencies are now random codes outside ISO 4217 and absent from the database. This also covers the two other generated codes, which could produce `QAR` or `RUB`.

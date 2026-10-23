# REV-102 — independent review of the MIG-001/002/004/005 carriers

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-mig` at `ea064945`, reviewed as `git diff origin/main..HEAD`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Five Medium and six Low, plus nits.

## What the reviewer confirmed

- **Fault proxy:** all 15 Supplier migrations write only through `query`/`execute` on the connection they are given. The fault proxy therefore sees every write.
- **Crash model:** closing the connection models a crash correctly. The DML is autocommit and the DDL is atomic.
- **Snapshot:** it does detect a migration that does not converge. The reviewer's 0032 mutation turned TC-002 red.
- **Runtime:** about 23 s. The file runs in CI's shards, and parallel files are safe.
- **Ledger commit:** the PR #251 record matches `gh pr view 251`.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: TC-005 could not tell a server that listened and then died from one that never started. The health probe ran after the process had exited. | Fixed. Each failure case now asserts that stdout never contained "API listening on", and the probe after exit is removed. Control: printing that line at startup in `src/index.js` fails TC-005 (and TC-001). |
| M-2: TC-001 only checked that the impact checker had a `check` function. | Fixed. TC-001 calls `check` for HKD and for Payment Term 1 on the migrated database and expects `READY`, zero counts and a matching watermark. Control: the reviewer's `suppliers_missing_table` mutation fails TC-001. |
| M-3: when a convergence check failed, its scratch database was left behind. | Fixed. The clean-up hook opens its own admin connection to drop the database, and the convergence loop drops it in `finally`. Checked: after four failing mutation runs, no `erp_t51_mig_*` database was left. |
| M-4: "rerun all" and "no data loss" were not exercised. | Fixed. TC-001 now runs the runner a second time and checks that every file is skipped and the ledger, including `applied_at`, is unchanged. Control: a runner that never sees a migration as applied fails TC-001. TC-002 now builds a fully migrated database, adds business rows (a Supplier, a primary address purpose, an identifier, approval turned on) and reruns all 15 Supplier migrations. They must change no row, run no DDL, and leave the schema and data identical. Control: a 0036 seed that resets approval on rerun fails TC-002 and TC-004. |
| M-5: the map showed no Notes for clauses that are not asserted. | Fixed. The Notes now cover them: TC-001 (schema checked as the table list and FKs, not a full design diff; startup self-check means the eager provider plus `/health`; the startup log is not inspected), TC-002 (what "half-applied" means and where the other parts are covered), TC-004 (the startup log) and TC-005. TC-004 now asserts its precondition: an active HKD from Business Master exists before the first Supplier migration runs. |
| L-1: a failed shutdown assertion in `finally` hid the start failure. | Fixed. The stop code is recorded in `finally` and asserted after it. |
| L-2: child processes could pick up a developer's `server/.env`. | Fixed. The runner and server get explicit `DB_HOST`, `DB_PORT`, user, password, name, an empty `DB_SOCKET_PATH`, `DB_SSL_ENABLED=false` and `APP_HOST=127.0.0.1`. Every case asserts that `DB_ADMIN_USER` is set. |
| L-3: spawned servers write to the real `server/logs`. | Kept. The directory is gitignored and `config/logging.js` has no environment override; changing that is outside this module. |
| L-4: raw limit values were not checked for leaks, and there was no control for an unconfigured Bank. | Raw values are now distinctive strings ("0.3141", "50017", "tenbytes", "relimportroot") and each must be absent from the output. The messages are matched with the "Supplier config" prefix. The reviewer assumed an unconfigured Bank should still start. That premise is wrong once the Bank table is deployed. Running it shows startup fails, and design §1700 requires exactly that: once the Bank capability is deployed, both key rings are an unconditional startup requirement. So "no Bank keys for either owner" is now an eleventh failure case rather than a passing control. |
| L-5: the half-applied count overstated the coverage. | The diagnostic now reports 31 stopped runs, 16 of them after at least one write. |
| L-6: DEF-029's closure evidence did not say REV-100 was CHANGES_REQUESTED and not re-reviewed. | Fixed in the ledger. |
| Nits | The rerun recorder is now asserted. On a rerun a migration may only issue DML that changes 0 rows. 0036's guarded `INSERT … WHERE NOT EXISTS` is such a statement, so "writes nothing" was too strict. The crash comment is corrected. The trivial assertion is removed. The trigger snapshot now includes the table, timing and event. |

## Verification after the fixes

- **Tests:** 4/4 on erp_t51 (MySQL 26.7.0), about 25 s.
- **New mutations:** four, each with the file restored by `cp`. Every one failed the intended test:
  - printing "listening" before startup;
  - the impact checker querying a missing table;
  - a 0036 seed that resets approval on rerun;
  - a runner that never marks a migration as applied.
- **Earlier sweep:** six mutations of migration idempotency, seeds and config leaks also failed. One further mutation, which only removed 0030's `IF NOT EXISTS`, was equivalent: 0030 checks the table first. Removing both the check and `IF NOT EXISTS` fails TC-002.
- **Leftovers:** no scratch database was left after any run.

# REV-110 — independent review of the resilience runner and the DEF-033 fix (HD-117 A PR 3, HD-121 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-resilience` at `937e88b8`, reviewed as `git diff origin/main..HEAD` (base `81a873fc`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Three Medium, six Low, six Info.

## What the reviewer confirmed

- **Runner and test:** the runner passes (TC-130/131/132 PASS, two NOT_RUN). `supplierStartupSelfCheck.integration` passes, and its own mutant (settings check disabled) turns it red.
- **Legitimate schemas:** erp_t51, a fresh migration and the recovery runner's restored copy all pass the check.
- **Other modules:** only Supplier code paths load `SupplierProviderServices`, so Customer, Sales and Item tests on partial schemas are unaffected. A refusal happens before any job starts. Startup cost: 48 information_schema queries, 12–20 ms.
- **Cleanup:** failures injected mid-run clean up fully, and erp_t51 is byte-identical after a resilience run.
- **Ledger:** the PR #264 record matches `gh pr view 264` and run 39578133908; the MERGE fingerprint recomputes.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: the connection-reset check could not fail; killing idle pooled connections is absorbed silently. | The runner now holds `LOCK TABLES suppliers WRITE`, waits for the app's thread to block on the metadata lock, and kills that thread (errors no longer swallowed). It requires a 5xx with an error code and no account number, answered within 3 s of the kill, the thread gone from the processlist, and recovery. Control: replacing `KILL` with `DO` now fails the check (the request then fails only at the timeout, about 10 s later, instead of 1 ms). The NOT_RUN reason now says only network-layer faults need the deployed environment. |
| M-2: the self-check did not cover 0080 or 0087. | `supplierSchemaCheck` now checks the 0080 list indexes and that 0087's `(sku_id)` index is the first `sku_id` index, so it serves the foreign key. The checks are written in the module, because migration files need approval to change. The startup cases drop each index and restore it (0087 through its own `up()`). Control: making these checks a no-op fails both cases. |
| M-3: OPS-005 gaps understated. | TC-132 asserts `supplier.bank.key_unavailable` is error level. The map lists what is not asserted: lookup metrics (`supplier.lookup.slow` is not implemented), import lease-recovery and purge-failure events, Bank reveal and change counts, duplicate-conflict counts. |
| L-1: docs said every inspector checks type, NULL and collation. | Reworded: every inspector requires the full column set; contacts and settings compare column names only. |
| L-2: a missing column is reported against its table, and the message had a doubled "Incompatible:" prefix. | The message now reads "Does not match its migration: …". The register says a missing column is reported against its table. |
| L-3: the lock check was weak; `SET SESSION innodb_lock_wait_timeout` had no effect; a fixed sleep. | The line is removed. The check requires a 5xx after at least the configured transaction timeout minus 1 s, and waits until no app thread is busy before reading the row. |
| L-4: "business_master_not_ready" was an inactive-currency rejection. | Renamed `currency_inactive`; the map says the `BUSINESS_MASTER_NOT_READY` path and purchase submit are not exercised. |
| L-5: an interrupted run left its schema and temp directory. | SIGINT and SIGTERM run the same cleanup and exit 130. Checked by sending SIGTERM at 12 s: nothing left. |
| L-6: the harness `supplier` override was unused. | Removed; the harness is back to main's version. |
| I-3: database errors inside an inspector were reported as incompatible. | Only contract errors ("Incompatible existing Supplier …") are collected; anything else is rethrown. |
| I-4: DEF-033 `source_ids` named the wrong service. | `SupplierSchemaCheckService` added. |
| I-1, I-2, I-5, I-6 | No change: startup cost negligible; other modules unaffected; the erp_t51 change came from the reviewer's run of the merged recovery runner; in-process startup checking is accepted. |

## After the follow-ups

Local, not CI: the resilience runner passes every local check (TC-131 9 checks, TC-130 14, TC-132 7); eight mutants each fail the intended check; the startup self-check, provider services, harness-based Supplier and Business Master HTTP integration tests pass 42/42; lint exit 0. Not re-reviewed.

# TASK-037 — Environment Verification

Recorded at the time the executed cases below were run. Everything here was observed, not assumed.

| | Observed |
| --- | --- |
| Source baseline | `9b2d0d3e0b2e0da284a0bfb99da861705279993f` (`main`); harnesses added on `claude/supplier-task-037` |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `db5296785c7f74a5925e8f0f4e7edecb3ef4fa48f26fdcd33ffe4d7e0b95e087` |
| Node | v26.6.0 |
| MySQL | 26.7.0, a throwaway instance on `127.0.0.1:3437`, datadir under the session scratchpad, migrated through `0054_create_customer_export_jobs` |
| Why a throwaway instance | the developer's own MySQL is on 3306; an acceptance run must not write to it, and `TC-077` creates and drops a schema |
| Integration gate | `DB_INTEGRATION_TESTS=1` |
| Key rings | the CI test rings from `.github/workflows/ci.yml` — `SUPPLIER_BANK_*` and `CUSTOMER_BANK_*`, identical as `checkSharedBankKeyRings` requires |
| `mysqldump` / `mysql` | `/usr/local/mysql/bin`, 26.7.0 |
| Playwright CLI | 1.63.0 present; not exercised by the cases below (neither is a browser case) |
| Clock / timezone | host clock, no freeze; no case below depends on wall-clock time |
| Test data | every case generates its own `randomUUID`-derived supplier and account; no shared fixture |

## Deviations, stated rather than glossed

1. **`TC-077`'s restore target is a fresh schema on the same instance**, not a separate host. It
   answers "does a backup decrypt with, and only with, its key ring"; it does not cover OS-level or
   off-box restore. The full module-wide drill is `OPS-006` / `TC-133`, which is out of this task's
   agreed scope and still has no harness.
2. **`--set-gtid-purged=OFF`** is passed to `mysqldump`, because a dump carrying
   `SET @@GLOBAL.GTID_PURGED` cannot be loaded back into the same server (`ERROR 3546`). Schema and
   rows are unaffected.
3. **`TC-074` runs its HTTP flows with `bodyCapture: "full"`**, which is *looser* than the shipped
   default of `"none"`. A clean scan under the looser setting is the stronger result.
4. `TC-016` (`itemRecoveryAcceptance.integration.test.js`) fails on this setup for want of
   `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`. It fails identically on unmodified code and is unrelated to
   this task.

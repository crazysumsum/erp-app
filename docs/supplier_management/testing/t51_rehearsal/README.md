# T51 rehearsal: upgrade paths, backup/restore, rollback and the similar-name list

- **Date:** 2026-10-21
- **Environment:** local, on a throwaway MySQL 26.7.0. This is not CI and not a production-like environment.
- **Script:** [`rehearsal.sh`](rehearsal.sh), with the helper [`read_through.mjs`](read_through.mjs).
  - It needs four checkouts, an output directory, and the throwaway instance's socket, port and credentials, all from environment variables. The script's header lists them.
  - It refuses to run against any server whose port is not the throwaway one.
  - It only creates and drops `erp_t51_rh_*` databases.
  - It exits non-zero on the first failed check.
- **Output:** [`rehearsal.log`](rehearsal.log). The scratch path is shown as `$SCRATCH`.

This record covers the parts of MIG-006 (TC-006) and design §14 that an automated test in CI cannot do: running older releases with their own runners, taking a real backup, and rolling a server back. The CI carrier for TC-006 is in `supplierMigrationAcceptance.integration.test.js`. It builds the non-Supplier schema with an in-test runner, then checks that adding Supplier changes no existing table or row.

## Releases used

| Name | Commit | Why |
| --- | --- | --- |
| pre-Supplier | `b3e5aa90^1` (`e4aed631`) | main just before Supplier's first migration (0028). Its 0001–0027 are byte-identical to today's. |
| previous (called "older" from 2026-10-27) | `72e205ef` | main at PR #249, the last release before migration 0087. Upgrading it exercises exactly one Supplier migration. |
| current | main at `3c0c3370`, plus this branch (no runtime change) | |
| pre-0103 (added 2026-10-27) | `e6398b70` | main at PR #280, the last release before migration 0103. It has the startup schema check (DEF-033). |

## What was done and what happened

How each comparison works:

- Each one uses a fingerprint of every base table: its data (`CHECKSUM TABLE`, one table per query, where a NULL checksum fails), AUTO_INCREMENT, columns, indexes, foreign keys, triggers, routines, views and events.
- A control proves the comparison can fail: one changed row in the restored database must be detected, and it is.

### A. Adding Supplier to a deployment that has none (real runners, real order)

1. The pre-Supplier release's runner builds an empty database: 30 ledger files. Core data is then added: a user, a user-audit row and an Item.
2. The current runner applies the remaining 58 files in main's own interleaved order (0028–0087, every module).
3. **Every object that existed before is unchanged.** That covers all 29 pre-existing tables: their data with time columns, counters, columns, indexes, keys and triggers. Every pre-existing permission and grant row also still exists unchanged. The upgrade only added objects (2,099 fingerprint lines across all modules, 15 of them Supplier tables) and the 6 Supplier permissions.
4. The current server starts on the result: health 200, then stopped with its port closed.

### B. From the previous release, with Supplier data

| Step | Result |
| --- | --- |
| Previous release's runner on an empty database, then business data: 2 Suppliers (one with a Chinese name), an identifier, an Item, a SKU and a Supplier–SKU relation | An orphan Supplier–SKU relation is still **accepted** on this release (DEF-029, control) |
| Previous release reads the rows over its own HTTP stack (a real user and device) | Supplier list 200 with RH-001 listed, detail 200 (`香港貿易有限公司`), SKU relations 200 (1 row) |
| `mysqldump --single-transaction --routines --triggers --events`, then restore into a second database | **94 tables**. Data, counters, columns, indexes, keys, triggers, routines, views and events are all equal. The changed-row control is detected |
| Upgrade with the current runner | Only `0087` is applied. The whole fingerprint diff is: the migration ledger's data, plus the new `idx_supplier_sku_refs_sku` index. The orphan relation is now **refused** (`ER_NO_REFERENCED_ROW_2`) |
| Current server on the upgraded schema | Starts, health 200, stops with its port closed; reads the rows over HTTP (list, detail, SKU relations) |
| **Server rolled back** to the previous release on the upgraded schema | Starts, health 200, stops with its port closed; **reads the same rows over HTTP**: list, detail and SKU relations, all 200 |

### C. Similar-name exception list (HD-057 A)

Run on a 4-row legacy file against the step-B database:

- **Match with an existing Supplier:** 1 exact match, `香港貿易有限公司`, score 1.0000.
- **Pair within the file:** 1, Contoso Trading vs Contoso Trading Ltd, score 0.8750.
- **Not listed:** "Northwind Paper Co" vs the existing "Northwind Paper Company" scores below the 0.85 threshold.

## Rollback boundaries, against design §14.3

These statements are from 2026-10-21 and hold for 0087 only. **Migration 0103 changes them; see the rerun below.** It
adds a column that the pre-0103 release's startup check rejects, so a plain server rollback across 0103 fails, the
database is no longer forward-only for that step, and 0103 added routes and client screens (move up and down).

- **Server:** the previous release starts on the schema the current release migrated, and reads Supplier data through it.
  - 0087 is backward compatible: it adds one index and reorders another, and the previous code does not inspect it at startup.
  - After the rollback, the SKU foreign key is enforced. The previous release checks the SKU before inserting a relation, so it only meets the foreign key in a race, and then the insert is refused rather than writing an orphan.
  - A server rollback also reverts non-Supplier code that changed in the meantime. This includes Business Master reading currencies with a shared lock (PR #244) and a Sales index hint. No Supplier response depends on either.
- **Client:** nothing that defines the Supplier API contract changed between `72e205ef` and main. `git diff --name-only 72e205ef HEAD` shows no file under `server/src/handlers`, `server/src/framework` (middleware) or `client/src`.
  - The only Supplier server changes are: the deadlock retry (DEF-031), which returns the existing 409 codes; three symbols that are now exported (`CSV_OPTIONS`, `isTemplateRow`, `uniqueBigrams`); corrected comments; and the new offline similar-name script.
  - So the previous client talks to the current server with the same contract, and the other way round. No old client was run in a browser.
- **Database:** forward-only, as §14.3 requires; nothing is dropped or downgraded. Going back to before an upgrade means restoring the backup, and step B shows the backup restores exactly.
- **Migration files:** each of the 15 Supplier migrations has exactly one commit on main's first-parent history, so none was edited after it merged. Checked with `git log --first-parent origin/main -- <file>`.

## Rerun on 2026-10-27 (main `38f05ba6`), corrected after REV-128

Migration 0103 (DEF-037, supplier party `sort_order`) and other modules' 0088–0102 landed after the first run, so upgrade
and rollback were rehearsed again. The log is [`rehearsal-2026-10-27.log`](rehearsal-2026-10-27.log). All checks passed.

- **A:** the pre-Supplier release upgraded to current; every pre-existing table, permission and grant is unchanged.
- **B (older release `72e205ef`):** the business data now also has two addresses and a contact.
  - Backed up and restored exactly.
  - After the upgrade, 0103 numbered the existing rows in display order (addresses 1, 2; contact 1). Every other column of those rows is unchanged, compared row by row against the before-image.
  - No other business data changed.
  - The current release served the rows, addresses and contacts included. So did `72e205ef` started on the upgraded schema. `72e205ef` has no startup schema check, which is why it starts; **it is not the release before 0103**.
- **C (pre-0103 release `e6398b70`), new:**
  - Started on the 0103 schema, it **refuses to start** (`Supplier startup self-check failed`): its 0032/0033 inspectors reject the extra column.
  - The three statements in 0103's header were then run, taken from the file itself: drop `sort_order` from both tables, and delete 0103's ledger row.
  - After that: both tables' columns and indexes equal the pre-upgrade fingerprint; 0103 is out of the ledger; every row is kept. `e6398b70` starts and serves the rows over HTTP.
  - Rolling forward with the current release applies 0103 again and renumbers the rows in display order. **An order users set before the rollback is lost.** That is what 0103's header says; accepting it is a release decision.
- **D:** the similar-name list matched.

What REV-128 changed in the script:
- **Previous claim withdrawn.** The first version of this section said the "previous release" rolled back across 0103 with no manual step. It had used `72e205ef`, not the release before 0103, and seeded no address or contact rows.
- **Counters are now read live.** `information_schema` serves AUTO_INCREMENT from a cache that lives a day (`information_schema_stats_expiry`), so a moved counter went unseen. The script now sets it to 0 for the session.
  - On the same instance: a table whose counter moved from NULL to 2 still read NULL from the cache and 2 with the setting.
  - The upgrade now shows `auto permissions 30 → 38`. That is accepted only because it goes up; a decrease is reported.
  - A control adds and removes a Supplier in the restore, and must see the counter, and only the counter, change.
- **Narrower exceptions.**
  - The `supplier_sku_refs` index exception names 0087's two indexes.
  - The `sort_order` exception covers an added column only.
  - The two party tables' data is exempt only because it is compared column by column without `sort_order`.
  - Controls feed five invented changes, and each must be reported: a new column, another index, a removed `sort_order`, a moved Supplier counter, and a permission counter that went down.
- **Permission rows compared byte for byte.** The columns' collation ignores case, so the earlier comparison could not see a case-only change. A control changes one permission name's case inside a rolled-back transaction, and the comparison must count it.

The first two runs on 2026-10-27, before the generalised check, failed: one on the stale 0087-only expectation, one on the BSD awk bug. Their logs were not kept. The control found the BSD awk bug: awk drops a multi-line `-v` value without any error, so every table looked new. The table list is now read from a file.

## Not covered here

- A production-like host, real secrets, and the real backup tooling and retention.
- Driving the old client against the new server in a browser; only the API contract was compared.
- The full release smoke in §14.4, for example Bank reveal and approval ON. That belongs to TEST_AND_VERIFY and the UAT runs.
- An upgrade under live traffic.
- Rolling back across 0103 in production: the order users set is lost, and the documented statements need a maintenance window. This is part of the operations runbook (TASK-051, group C).
- **What the fingerprint does not compare:**
  - Table options: engine, charset, row format and partitioning.
  - CHECK constraints, column comments and generated-column expressions.
  - Which columns a foreign key maps: only its name, referenced table and rules are compared.
  - Index prefix lengths (`sub_part`).
  - Users and privileges.
  - `CHECKSUM TABLE` is a 32-bit checksum per table, not a cryptographic hash.

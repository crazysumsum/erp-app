# T51 rehearsal: upgrade paths, backup/restore, rollback and the similar-name list

- **Date:** 2026-10-21
- **Environment:** local, on a throwaway MySQL 26.7.0. This is not CI and not a production-like environment.
- **Script:** [`rehearsal.sh`](rehearsal.sh), with the helper [`read_through.mjs`](read_through.mjs).
  - It needs three checkouts, an output directory, and the throwaway instance's socket, port and credentials, all from environment variables. The script's header lists them.
  - It refuses to run against any server whose port is not the throwaway one.
  - It only creates and drops `erp_t51_rh_*` databases.
  - It exits non-zero on the first failed check.
- **Output:** [`rehearsal.log`](rehearsal.log). The scratch path is shown as `$SCRATCH`.

This record covers the parts of MIG-006 (TC-006) and design §14 that an automated test in CI cannot do: running older releases with their own runners, taking a real backup, and rolling a server back. The CI carrier for TC-006 is in `supplierMigrationAcceptance.integration.test.js`. It builds the non-Supplier schema with an in-test runner, then checks that adding Supplier changes no existing table or row.

## Releases used

| Name | Commit | Why |
| --- | --- | --- |
| pre-Supplier | `b3e5aa90^1` (`e4aed631`) | main just before Supplier's first migration (0028). Its 0001–0027 are byte-identical to today's. |
| previous | `72e205ef` | main at PR #249, the last release before migration 0087. Upgrading it exercises exactly one Supplier migration. |
| current | main at `3c0c3370`, plus this branch (no runtime change) | |

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

- **Server:** the previous release starts on the schema the current release migrated, and reads Supplier data through it.
  - 0087 is backward compatible: it adds one index and reorders another, and the previous code does not inspect it at startup.
  - After the rollback, the SKU foreign key is enforced. The previous release checks the SKU before inserting a relation, so it only meets the foreign key in a race, and then the insert is refused rather than writing an orphan.
  - A server rollback also reverts non-Supplier code that changed in the meantime. This includes Business Master reading currencies with a shared lock (PR #244) and a Sales index hint. No Supplier response depends on either.
- **Client:** nothing that defines the Supplier API contract changed between `72e205ef` and main. `git diff --name-only 72e205ef HEAD` shows no file under `server/src/handlers`, `server/src/framework` (middleware) or `client/src`.
  - The only Supplier server changes are: the deadlock retry (DEF-031), which returns the existing 409 codes; three symbols that are now exported (`CSV_OPTIONS`, `isTemplateRow`, `uniqueBigrams`); corrected comments; and the new offline similar-name script.
  - So the previous client talks to the current server with the same contract, and the other way round. No old client was run in a browser.
- **Database:** forward-only, as §14.3 requires; nothing is dropped or downgraded. Going back to before an upgrade means restoring the backup, and step B shows the backup restores exactly.
- **Migration files:** each of the 15 Supplier migrations has exactly one commit on main's first-parent history, so none was edited after it merged. Checked with `git log --first-parent origin/main -- <file>`.

## Not covered here

- A production-like host, real secrets, and the real backup tooling and retention.
- Driving the old client against the new server in a browser; only the API contract was compared.
- The full release smoke in §14.4, for example Bank reveal and approval ON. That belongs to TEST_AND_VERIFY and the UAT runs.
- An upgrade under live traffic.

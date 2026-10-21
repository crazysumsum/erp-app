# T51 rehearsal: upgrade, backup/restore, rollback and the similar-name list

- **Date:** 2026-10-21
- **Environment:** local, on a throwaway MySQL 26.7.0. This is not CI and not a production-like environment.
- **Releases:** the previous release is `72e205ef` (main at PR #249, before migration 0087). The current release is main at `3c0c3370` (PR #258), plus this branch, which changes no runtime code.
- **Script:** [`rehearsal.sh`](rehearsal.sh). Run it with `SCRATCH`, `OLD_WORKTREE` and `NEW_WORKTREE` set. It creates and drops its own databases.
- **Output:** [`rehearsal.log`](rehearsal.log).

This record covers the parts of MIG-006 (TC-006) and design §14 that an automated test in CI cannot do: running an older release, and taking a real backup. The CI carrier for TC-006, in `supplierMigrationAcceptance.integration.test.js`, covers adding Supplier to a deployment that has none.

## What was done and what happened

| Step | Result |
| --- | --- |
| 1. Previous release, its own runner, on an empty database | 87 migrations applied (latest 0086) |
| 2. Business data under the previous release: 2 Suppliers (one with a Chinese name), an identifier, an Item, a SKU and a Supplier–SKU relation | Inserted. On this release an orphan Supplier–SKU relation is still **accepted** (DEF-029 as it was) |
| 3. Backup with `mysqldump --single-transaction`, then restore into a second database | Dump and restore exit 0. All 50 tables have equal `CHECKSUM TABLE` in source and restore |
| 4. Upgrade with the current runner | Only `0087` is applied. The only table whose checksum changed is `fr_schema_migrations`, so business data is untouched. The orphan relation is now **refused** (`ER_NO_REFERENCED_ROW_2`, `fk_supplier_sku_refs_sku`) |
| 5. Server on the upgraded schema: current release, then rolled back to the previous release | Both start, print "API listening", and `/api/v1/health` returns 200 |
| 6. Similar-name exception list (HD-057 A), current release, on a 4-row legacy file | 1 exact match with an existing Supplier (`香港貿易有限公司`, score 1.0000). 1 in-file pair: Contoso Trading vs Contoso Trading Ltd, 0.8750. "Northwind Paper Co" vs the existing "Northwind Paper Company" is below the 0.85 threshold, so it is not listed |

## Rollback boundaries, against design §14.3

- **Server:** the previous release runs on the schema the current release migrated. 0087 is backward compatible: it only adds an index and reorders one, and the previous code does not inspect it at startup.
- **Client:** nothing that defines the Supplier API contract changed between `72e205ef` and main. `git diff --name-only 72e205ef HEAD` shows:
  - no file under `server/src/handlers` and no file under `client/src`;
  - only these Supplier server changes:
    - the deadlock retry (DEF-031);
    - two helpers that are now exported;
    - corrected comments;
    - the new offline similar-name script.

  None of these changes a request or a response. The previous client therefore talks to the current server with the same contract, and the other way round. No old client was run in a browser.
- **Database:** forward-only, as §14.3 requires. Nothing is dropped or downgraded. Going back to before an upgrade means restoring the backup, and step 3 shows the backup restores exactly.
- **Migration files:** each of the 15 Supplier migrations has exactly one commit on main's first-parent history. None was edited after it merged. Checked with `git log --first-parent origin/main -- <file>`.

## Not covered here

- A production-like host, real secrets, and the real backup tooling and retention.
- Driving the old client against the new server in a browser; only the API contract was compared.
- The release smoke in §14.4 as a whole, for example Bank reveal and approval ON. Those belong to the TEST_AND_VERIFY stage and the UAT runs.
- A rehearsal that keeps live traffic running during the upgrade.

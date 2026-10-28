# Supplier Management — operations runbook

- **Scope:** deploying, rolling back, backing up and restoring the Supplier module (SUP-CAP-01…05).
- **Readers:** the operators who deploy the ERP and own its database and secrets.
- **Basis:** design §14 (deployment and rollback), T51.
- **Status:** a **draft for Operations' review**.
  - Every step marked *rehearsed* was run locally on a throwaway MySQL 26.7.0, with the evidence named.
  - Nothing here has been run on a production-like environment. Those runs are TASK-051 group C, in `testing/06_task051_completion_boundary.md`.

Two detailed runbooks stay where they are and are not repeated here:
- [`bank_operations.md`](bank_operations.md): key rings, rotation, backup and restore of Bank data.
- [`bulk_operations.md`](bulk_operations.md): import and export, its jobs, capacity, and the similar-name list.

## 1. Deployment order (design §14.1)

| Step | What to do | How to check it | Evidence |
| --- | --- | --- | --- |
| 1. Back up, and prove the restore | `mysqldump --single-transaction --hex-blob --routines --triggers --events <db>`. Add `--set-gtid-purged=OFF` only when restoring into the same instance. Restore as an admin account, because the triggers need it (`bank_operations.md` §8). Back up the Bank key rings separately in the secret store. | Restore into a scratch database. Compare every table's data, counters, columns, indexes, keys, triggers, routines, views and events. | *Rehearsed:* `testing/t51_rehearsal/` (exact restore, 94 tables) and the recovery runner (TC-133, local part) |
| 2. Business Master first | Currency and Payment Term are owned by Business Master. Their owner deploys and checks the catalogues. Supplier only reads them. | At least one active currency. | TC-135 local |
| 3. Migrations | From `server/`, with the `DB_*` variables set: `node scripts/migrate.js`. It applies every module's pending files in order. Running it again is a no-op. | The last line is `Migrations complete.` The ledger `fr_schema_migrations` holds every file. | *Rehearsed:* pre-Supplier → current, and older release → current (`t51_rehearsal/`); TC-135 local |
| 4. Server config and start | Provide the four `SUPPLIER_BANK_*` variables and the identical `CUSTOMER_BANK_*` ones (`bank_operations.md` §1). Optionally, provide the `SUPPLIER_IMPORT_*` settings (`bulk_operations.md`). Then start the server. | The startup self-check refuses to listen on a wrong schema, a missing permission, a missing settings row or a bad key ring (§3). `GET /api/v1/health` returns 200. The log must have `supplier.bank.key_check_completed`. | TC-131 local; rehearsal |
| 5. Client | Deploy the client build. | The Supplier menu shows only for Supplier roles. | TC-121 (`supplier-client-ui`) |
| 6. Roles | Assign the daily roles: general, approval, Bank and settings. Only approved break-glass accounts may hold `system-admin`, and their use is monitored. | A role and permission inventory. | TC-135 local: route and permission inventory. The production part is NOT_RUN. |
| 7. Smoke | The §14.1 step 7 flows and the §14.4 checks (§5 below). | All pass. | TC-135 local, separated roles. On a deployed environment: NOT_RUN |
| 8. Open the import worker and the menu last | The `supplier.import.*` jobs in `server/config/scheduler.js` (`jobs`; `enabled`) and the users' menu. | Upload a small file, precheck it, and confirm it. | TC-134 local |

Approval stays **OFF** after deployment: the settings migration creates it OFF. Only a business decision turns it on, and it applies to new submissions only (§14.2).

## 2. Rollback

| Layer | What is safe | What is not |
| --- | --- | --- |
| Client | Rolling back the client. It deletes no Supplier data. | — |
| Import worker | Stop claiming first: set `enabled: false` on `supplier.import.precheck` and `supplier.import.execute`, then restart. Let running leases finish, or expire after 11 minutes. Rows already applied stay applied (*rehearsed*, TC-134 local). | Killing a worker mid-row and starting an older one before the lease expires. |
| Server, across 0087 or other additive changes | Starting the previous release on the newer schema. *Rehearsed:* `72e205ef` started on the upgraded schema and served the rows. | — |
| **Server, across 0103** (`supplier_addresses` and `supplier_contacts` gain `sort_order`) | **No plain rollback.** A release before 0103 (rehearsed with `e6398b70`) **refuses to start**: `Supplier startup self-check failed`. Its own inspectors reject the extra column. | See §2.1 |
| Database | Forward fixes only (§14.3). Going back to before an upgrade means restoring the step 1 backup, and losing everything written since. | Dropping tables, or removing a Bank key to "turn off" Bank (§14.3, `bank_operations.md` §9). |
| Approval setting | Turning it OFF stops new submissions entering approval. | It is not a technical rollback. Pending requests are not handled automatically. |

### 2.1 Rolling back across 0103

Design §14.3 says applied migrations are not reversed. 0103's own header documents the one exception, and HD-136 approved the migration together with that note (REV-118 L-1). If the server must go back to a release before 0103, and a forward fix is not possible:

1. Stop the current server and its import worker (see the table above).
2. Back up the database (step 1).
3. Run, as one maintenance step:
   ```sql
   ALTER TABLE supplier_addresses DROP COLUMN sort_order;
   ALTER TABLE supplier_contacts DROP COLUMN sort_order;
   DELETE FROM fr_schema_migrations WHERE name = 'migrations/0103_add_supplier_party_sort_order.js';
   ```
4. Start the older release. Check the health check and a Supplier detail with addresses and contacts.

**Consequences.** Every address and contact row is kept, but **the order users set is lost**. Rolling forward later applies 0103 again, which renumbers the rows in their default display order (status, then id or name).

*Rehearsed:* `t51_rehearsal/rehearsal-2026-10-27.log`, step C. After step 3, both tables matched their pre-0103 shape, the old release served the rows, and rolling forward renumbered them.

**Not yet decided:** accepting this loss at release is the Product Owner's call (TASK-051 group C).

## 3. When the server refuses to start

| Log line | Meaning | What to do |
| --- | --- | --- |
| `Supplier startup self-check failed. …`, naming a table, index or row | The schema does not match this release: a migration is missing, or the release is older than the schema (§2) | Run `node scripts/migrate.js`, or restore. The check writes nothing. |
| `supplier: Supplier config must provide both …`, or the Customer key-ring lines | A Bank key ring is missing, or differs between Supplier and Customer | `bank_operations.md` §2 |
| No `supplier.bank.key_check_completed` in the log | The key check did not run | Treat it as a failure, not a pass (`bank_operations.md` §2) |

## 4. Bank key dependency

- The database backup holds no key material, and the key ring holds no data. **Neither restores Bank data without the other.** Store them apart, with separate access.
- Supplier and Customer share one key ring. Removing a key affects both tables (`bank_operations.md` §5).
- A missing key fails closed. Reveal returns `503 BANK_KEY_UNAVAILABLE`. A wrong key value returns a generic 500 and logs `supplier.bank.integrity_failed`; investigate that, do not retry it.
- Bank permissions are granted only after the keys are provisioned and the security smoke passes (§14.2).

## 5. Smoke and data checks (design §14.1 step 7, §14.4)

The flows: Draft create, direct activation, an approval ON flow, suspend, block, the masked Bank list, reveal, the purchase lookup, and Audit.

The data checks:
- the migration count and schema;
- six `supplier.*` permissions, and no unknown extra one;
- `supplier_settings.id = 1`, with approval OFF;
- an active currency;
- no Bank fixture plaintext in the database;
- an Audit entry for every action;
- Suspended and Blocked Suppliers gone from the purchase lookup.

*Rehearsed locally,* with separated roles, on a fresh schema: TC-135 in `scripts/runSupplierReleaseAcceptance.js`. That runner creates its users directly in its own scratch database, so it cannot run against a deployed environment.

**The smoke for a deployed environment (`smokeSupplierManagement.js`) is not written yet.** It needs real accounts and devices per role, and it writes Suppliers and a reveal into the target environment. How it does that is open with the Product Owner.

## 6. Not covered by this draft

- Any run on a production-like environment: deployment timeline, staged capability rollout, break-glass audit, restore drill (RTO ≤ 4 h, RPO ≤ 15 min), alert delivery. These are TASK-051 group C.
- Process-manager specifics (systemd, containers): the ERP has no deployment manifests in this repository.

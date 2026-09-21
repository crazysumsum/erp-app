import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mysql from "mysql2/promise";

import {
  ITEM_RECOVERY_TABLES,
  parseItemRecoveryContext,
  verifyItemRecovery
} from "../../src/modules/item/itemRecoveryAcceptance.js";

const skip = process.env.DB_INTEGRATION_TESTS === "1"
  ? false
  : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite";

function iso(ms) {
  return new Date(ms).toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("TC-016 adapter verifies a separately restored schema through a read-only transaction", { skip }, async (t) => {
  const sourceSchema = process.env.DB_NAME;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const recoverySchema = `item_recovery_it_${suffix}`;
  const recoveryReader = `item_recovery_${suffix}`;
  const recoveryPassword = randomUUID().replaceAll("-", "");
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const adminOptions = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_ADMIN_USER ?? (githubActions ? "root" : undefined),
    password: process.env.DB_ADMIN_PASSWORD ?? (githubActions ? "root" : undefined)
  };
  assert.ok(adminOptions.user, "DB_ADMIN_USER is required for recovery integration setup");
  assert.ok(adminOptions.password, "DB_ADMIN_PASSWORD is required for recovery integration setup");
  const admin = await mysql.createConnection({ ...adminOptions, database: sourceSchema });
  const root = await mkdtemp(path.join(os.tmpdir(), "item-recovery-integration-"));
  t.after(async () => {
    await admin.query(`DROP DATABASE IF EXISTS \`${recoverySchema}\``).catch(() => {});
    await admin.query(`DROP USER IF EXISTS '${recoveryReader}'@'%'`).catch(() => {});
    await admin.end().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  await admin.query(`CREATE DATABASE \`${recoverySchema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.query(`CREATE TABLE \`${recoverySchema}\`.users LIKE \`${sourceSchema}\`.users`);
  for (const table of ITEM_RECOVERY_TABLES) {
    await admin.query(`CREATE TABLE \`${recoverySchema}\`.\`${table}\` LIKE \`${sourceSchema}\`.\`${table}\``);
  }
  await admin.query(`CREATE USER '${recoveryReader}'@'%' IDENTIFIED BY '${recoveryPassword}'`);
  await admin.query(`GRANT SELECT ON \`${recoverySchema}\`.* TO '${recoveryReader}'@'%'`);

  const now = Date.now();
  await admin.query(
    `INSERT INTO \`${recoverySchema}\`.items (id, name, product_type, status, created_at, updated_at)
     VALUES (41, 'Recovery Item', 'standard', 'active', ?, ?)`,
    [now, now]
  );
  await admin.query(
    `INSERT INTO \`${recoverySchema}\`.item_skus
       (id, item_id, sku_code, sku_name, tracking_policy, status, created_at, updated_at)
     VALUES (42, 41, 'RECOVERY-SKU', 'Recovery SKU', 'none', 'active', ?, ?)`,
    [now, now]
  );
  await admin.query(
    `INSERT INTO \`${recoverySchema}\`.item_audit_logs
       (id, occurred_at, actor_username, action, target_type, target_id, target_label)
     VALUES (43, ?, 'recovery-operator', 'item.update', 'item', 41, 'Recovery Item')`,
    [now]
  );
  await admin.query(
    `INSERT INTO \`${recoverySchema}\`.item_media
       (id, item_id, media_kind, stored_name, original_name, mime_type, byte_size, sha256, created_at)
     VALUES (44, 41, 'image', 'photo.png', 'photo.png', 'image/png', 3, ?, ?)`,
    [sha256("img"), now]
  );
  await admin.query(
    `INSERT INTO \`${recoverySchema}\`.item_import_jobs
       (id, file_stored_name, file_sha256, template_version, mode, status, created_at, updated_at)
     VALUES (45, 'source.csv', ?, '1', 'create_only', 'completed', ?, ?)`,
    [sha256("csv"), now, now]
  );

  const tableCounts = {};
  for (const table of ITEM_RECOVERY_TABLES) {
    const [[row]] = await admin.query(`SELECT COUNT(*) AS total FROM \`${recoverySchema}\`.\`${table}\``);
    tableCounts[table] = Number(row.total);
  }

  const mediaRoot = path.join(root, "media");
  const importRoot = path.join(root, "imports");
  await mkdir(mediaRoot, { recursive: true });
  await mkdir(importRoot, { recursive: true });
  await writeFile(path.join(mediaRoot, "photo.png"), "img");
  await writeFile(path.join(importRoot, "source.csv"), "csv");

  const recoveryPoint = {
    id: `rp-${recoverySchema}`,
    databaseBackupId: `db-${recoverySchema}`,
    mediaSnapshotId: `media-${recoverySchema}`,
    importSnapshotId: `import-${recoverySchema}`,
    backupCreatedAt: iso(now - 40 * 60_000),
    latestCommittedAt: iso(now - 35 * 60_000),
    restoreStartedAt: iso(now - 31 * 60_000),
    restoreCompletedAt: iso(now - 60_000)
  };
  const manifest = {
    schemaVersion: 1,
    environmentClass: "staging-like",
    environmentId: "local-item-recovery-integration",
    recoveryPoint,
    database: {
      schema: recoverySchema,
      tableCounts,
      smokeSku: { skuCode: "RECOVERY-SKU", itemId: 41, skuId: 42 },
      smokeAudit: { id: 43, action: "item.update", targetType: "item", targetId: 41 }
    },
    files: [
      { area: "media", recordId: 44, path: "photo.png", bytes: 3, sha256: sha256("img") },
      { area: "import", recordId: 45, fileKind: "source", path: "source.csv", bytes: 3, sha256: sha256("csv") }
    ]
  };
  const trustPolicy = {
    schemaVersion: 1,
    status: "APPROVED",
    attestationMode: "INDEPENDENT",
    environmentId: "local-item-recovery-integration",
    schemaPrefix: "item_recovery_it_",
    attestationPublicKeyPem: "integration-test-only"
  };
  const env = {
    ...process.env,
    DB_NAME: recoverySchema,
    ITEM_RECOVERY_CONFIRM: "VERIFY_RESTORED_COPY",
    ITEM_RECOVERY_ENVIRONMENT_CLASS: "staging-like",
    ITEM_RECOVERY_ENVIRONMENT_ID: trustPolicy.environmentId,
    ITEM_RECOVERY_POINT_ID: recoveryPoint.id,
    ITEM_RECOVERY_BACKUP_ID: recoveryPoint.databaseBackupId,
    ITEM_RECOVERY_MEDIA_SNAPSHOT_ID: recoveryPoint.mediaSnapshotId,
    ITEM_RECOVERY_IMPORT_SNAPSHOT_ID: recoveryPoint.importSnapshotId,
    ITEM_RECOVERY_MEDIA_ROOT: mediaRoot,
    ITEM_RECOVERY_IMPORT_ROOT: importRoot
  };
  const context = parseItemRecoveryContext({ env, manifest, trustPolicy, nowMs: now });
  const recovered = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: recoveryReader,
    password: recoveryPassword,
    database: recoverySchema
  });
  t.after(() => recovered.end().catch(() => {}));
  await recovered.query("SET SESSION TRANSACTION READ ONLY");
  await recovered.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  assert.equal((await verifyItemRecovery({ database: recovered, context })).passed, true);
  await recovered.rollback();

  const mismatchedContext = { ...context, tableCounts: { ...context.tableCounts, item_skus: 0 } };
  await recovered.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  const mismatch = await verifyItemRecovery({ database: recovered, context: mismatchedContext });
  await recovered.rollback();
  assert.equal(mismatch.passed, false);
  assert.equal(mismatch.checks.find(({ id }) => id === "table-count:item_skus").status, "FAIL");
});

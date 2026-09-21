import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ITEM_RECOVERY_TABLES,
  parseItemRecoveryContext,
  verifyItemRecoveryAttestation,
  verifyItemRecovery
} from "../src/modules/item/itemRecoveryAcceptance.js";

const tableCounts = Object.fromEntries(ITEM_RECOVERY_TABLES.map((table) => [table, 0]));

function validInput() {
  const recoveryPoint = {
    id: "rp-item-20260915-001",
    databaseBackupId: "mysql-backup-001",
    mediaSnapshotId: "media-snapshot-001",
    importSnapshotId: "import-snapshot-001",
    backupCreatedAt: "2026-09-15T01:00:00Z",
    latestCommittedAt: "2026-09-15T01:10:00Z",
    restoreStartedAt: "2026-09-15T01:30:00Z",
    restoreCompletedAt: "2026-09-15T02:00:00Z"
  };
  return {
    trustPolicy: {
      schemaVersion: 1,
      status: "APPROVED",
      environmentId: "item-recovery-staging",
      schemaPrefix: "erp_item_restore_",
      attestationPublicKeyPem: "test-only-placeholder"
    },
    env: {
      DB_NAME: "erp_item_restore_20260915",
      ITEM_RECOVERY_CONFIRM: "VERIFY_RESTORED_COPY",
      ITEM_RECOVERY_ENVIRONMENT_CLASS: "staging-like",
      ITEM_RECOVERY_ENVIRONMENT_ID: "item-recovery-staging",
      ITEM_RECOVERY_POINT_ID: recoveryPoint.id,
      ITEM_RECOVERY_BACKUP_ID: recoveryPoint.databaseBackupId,
      ITEM_RECOVERY_MEDIA_SNAPSHOT_ID: recoveryPoint.mediaSnapshotId,
      ITEM_RECOVERY_IMPORT_SNAPSHOT_ID: recoveryPoint.importSnapshotId,
      ITEM_RECOVERY_MEDIA_ROOT: "/restore/media",
      ITEM_RECOVERY_IMPORT_ROOT: "/restore/imports"
    },
    manifest: {
      schemaVersion: 1,
      environmentClass: "staging-like",
      environmentId: "item-recovery-staging",
      recoveryPoint,
      database: {
        schema: "erp_item_restore_20260915",
        tableCounts,
        smokeSku: { skuCode: "RECOVERY-SKU", itemId: 41, skuId: 42 },
        smokeAudit: { id: 43, action: "item.update", targetType: "item", targetId: 41 }
      },
      files: [
        { area: "media", recordId: 44, path: "photo.png", bytes: 3, sha256: "a".repeat(64) },
        { area: "import", recordId: 45, fileKind: "source", path: "source.csv", bytes: 3, sha256: "b".repeat(64) }
      ]
    }
  };
}

test("recovery context fails closed for the ordinary local development schema", () => {
  const input = validInput();
  input.env.DB_NAME = "erp_dev";
  input.manifest.database.schema = "erp_dev";

  assert.throws(
    () => parseItemRecoveryContext({ ...input, nowMs: Date.parse("2026-09-15T02:05:00Z") }),
    /refuses protected or ordinary development schema/i
  );
});

test("recovery context requires an approved environment identity and restored-schema prefix", () => {
  const input = validInput();
  input.trustPolicy.status = "UNPROVISIONED";
  assert.throws(
    () => parseItemRecoveryContext({ ...input, nowMs: Date.parse("2026-09-15T02:05:00Z") }),
    /trust policy is not approved/i
  );

  const wrongPrefix = validInput();
  wrongPrefix.env.DB_NAME = "customer_live";
  wrongPrefix.manifest.database.schema = "customer_live";
  assert.throws(
    () => parseItemRecoveryContext({ ...wrongPrefix, nowMs: Date.parse("2026-09-15T02:05:00Z") }),
    /approved restored-schema prefix/i
  );
});

test("recovery manifest requires a valid Ed25519 signature from the approved trust key", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifestBytes = Buffer.from('{"schemaVersion":1}');
  const signatureBase64 = sign(null, manifestBytes, privateKey).toString("base64");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

  assert.equal(verifyItemRecoveryAttestation({ manifestBytes, signatureBase64, publicKeyPem }), true);
  assert.throws(
    () => verifyItemRecoveryAttestation({
      manifestBytes: Buffer.from('{"schemaVersion":2}'),
      signatureBase64,
      publicKeyPem
    }),
    /signature is invalid/i
  );
});

test("recovery context requires explicit staging identity and matching external backup identifiers", () => {
  const input = validInput();
  input.env.ITEM_RECOVERY_BACKUP_ID = "different-backup";

  assert.throws(
    () => parseItemRecoveryContext({ ...input, nowMs: Date.parse("2026-09-15T02:05:00Z") }),
    /ITEM_RECOVERY_BACKUP_ID does not match/i
  );
});

test("recovery context rejects unsafe or unlinked restored file evidence", () => {
  const unsafePath = validInput();
  unsafePath.manifest.files[0].path = "../photo.png";
  assert.throws(
    () => parseItemRecoveryContext({ ...unsafePath, nowMs: Date.parse("2026-09-15T02:05:00Z") }),
    /safe stored filename/i
  );

  const missingRecord = validInput();
  delete missingRecord.manifest.files[1].recordId;
  assert.throws(
    () => parseItemRecoveryContext({ ...missingRecord, nowMs: Date.parse("2026-09-15T02:05:00Z") }),
    /recordId must be a positive safe integer/i
  );
});

test("recovery context retains the restore-duration RTO when verification occurs later", () => {
  const context = parseItemRecoveryContext({
    ...validInput(),
    nowMs: Date.parse("2026-09-16T02:05:00Z")
  });

  assert.deepEqual(context.metrics, {
    observedRtoMs: 30 * 60 * 1000,
    observedRpoMs: 10 * 60 * 1000,
    rtoObjectiveMs: 4 * 60 * 60 * 1000,
    rpoObjectiveMs: 15 * 60 * 1000,
    rtoPassed: true,
    rpoPassed: true
  });
  assert.equal(context.databaseSchema, "erp_item_restore_20260915");
  assert.equal(context.files.length, 2);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function recoveredDatabase({ countOverrides = {}, integrityViolations = 0, mediaStoredName = "photo.png" } = {}) {
  return {
    async query(sql, params = []) {
      const countMatch = sql.match(/^SELECT COUNT\(\*\) AS total FROM `([^`]+)`$/);
      if (countMatch) {
        return [[{ total: countOverrides[countMatch[1]] ?? tableCounts[countMatch[1]] }]];
      }
      if (sql.includes("AS violations")) return [[{ violations: integrityViolations }]];
      if (sql.includes("WHERE s.sku_code = ?")) {
        assert.deepEqual(params, ["RECOVERY-SKU"]);
        return [[{
          id: 42,
          sku_code: "RECOVERY-SKU",
          sku_status: "active",
          purchasable: 1,
          sellable: 1,
          inventory_tracked: 1,
          tracking_policy: "none",
          shelf_life_days: null,
          min_receipt_life_days: null,
          min_sale_life_days: null,
          effective_from: null,
          effective_to: null,
          item_id: 41,
          item_name: "Recovery Item",
          product_type: "standard",
          item_status: "active"
        }]];
      }
      if (sql.includes("FROM item_sku_uoms su")) return [[]];
      if (sql.includes("FROM item_audit_logs")) {
        assert.deepEqual(params, [43]);
        return [[{ id: 43, action: "item.update", target_type: "item", target_id: 41 }]];
      }
      if (sql.includes("FROM item_media WHERE id = ?")) {
        assert.deepEqual(params, [44]);
        return [[{ stored_name: mediaStoredName, byte_size: 3, sha256: sha256("img") }]];
      }
      if (sql.includes("FROM item_import_jobs WHERE id = ?")) {
        assert.deepEqual(params, [45]);
        return [[{ file_stored_name: "source.csv", result_stored_name: null, file_sha256: sha256("csv") }]];
      }
      throw new Error(`Unexpected recovery query: ${sql}`);
    }
  };
}

async function recoveredFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "item-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mediaRoot = path.join(root, "media");
  const importRoot = path.join(root, "imports");
  await mkdir(mediaRoot, { recursive: true });
  await mkdir(importRoot, { recursive: true });
  await writeFile(path.join(mediaRoot, "photo.png"), "img");
  await writeFile(path.join(importRoot, "source.csv"), "csv");

  const input = validInput();
  input.env.ITEM_RECOVERY_MEDIA_ROOT = mediaRoot;
  input.env.ITEM_RECOVERY_IMPORT_ROOT = importRoot;
  input.manifest.files = [
    { area: "media", recordId: 44, path: "photo.png", bytes: 3, sha256: sha256("img") },
    { area: "import", recordId: 45, fileKind: "source", path: "source.csv", bytes: 3, sha256: sha256("csv") }
  ];
  return parseItemRecoveryContext({ ...input, nowMs: Date.parse("2026-09-15T02:05:00Z") });
}

test("recovery verifier reconciles database, lookup, audit and restored files without writes", async (t) => {
  const context = await recoveredFixture(t);
  const result = await verifyItemRecovery({ database: recoveredDatabase(), context });

  assert.equal(result.passed, true);
  assert.equal(result.checks.every((check) => check.status === "PASS"), true);
  assert.equal(result.metrics.rtoPassed, true);
  assert.equal(result.metrics.rpoPassed, true);
});

test("recovery verifier fails when a restored table count or file digest differs", async (t) => {
  const context = await recoveredFixture(t);
  context.files[0].sha256 = "0".repeat(64);
  const result = await verifyItemRecovery({
    database: recoveredDatabase({ countOverrides: { item_skus: 1 } }),
    context
  });

  assert.equal(result.passed, false);
  assert.deepEqual(
    result.checks.filter((check) => check.status === "FAIL").map((check) => check.id),
    ["table-count:item_skus", "file:media:photo.png"]
  );
});

test("recovery verifier fails closed on DB-to-volume linkage and recovery objective misses", async (t) => {
  const context = await recoveredFixture(t);
  context.metrics.rtoPassed = false;
  context.metrics.rpoPassed = false;
  const result = await verifyItemRecovery({
    database: recoveredDatabase({ mediaStoredName: "different.png" }),
    context
  });

  assert.equal(result.passed, false);
  assert.deepEqual(
    result.checks.filter((check) => check.status === "FAIL").map((check) => check.id),
    ["file:media:photo.png", "objective:rto", "objective:rpo"]
  );
});

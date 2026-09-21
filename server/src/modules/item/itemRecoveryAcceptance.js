import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";

import { ItemLookupService } from "./ItemLookupService.js";

export const ITEM_RECOVERY_TABLES = Object.freeze([
  "item_categories",
  "item_brands",
  "item_uoms",
  "items",
  "item_skus",
  "item_sku_uoms",
  "item_sku_barcodes",
  "item_attribute_definitions",
  "item_attribute_options",
  "item_category_attributes",
  "item_attribute_values",
  "item_sku_attribute_values",
  "item_media",
  "item_audit_logs",
  "item_import_jobs",
  "item_import_rows"
]);

const RTO_OBJECTIVE_MS = 4 * 60 * 60 * 1000;
const RPO_OBJECTIVE_MS = 15 * 60 * 1000;
const PROTECTED_SCHEMAS = new Set([
  "erp_dev",
  "erp_prod",
  "information_schema",
  "mysql",
  "performance_schema",
  "production",
  "sys"
]);

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function timestamp(value, name) {
  const parsed = Date.parse(requiredString(value, name));
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be an ISO-8601 timestamp`);
  return parsed;
}

function matchingId(env, manifest, envName, manifestName) {
  const actual = requiredString(env[envName], envName);
  const expected = requiredString(manifest, manifestName);
  if (actual !== expected) throw new TypeError(`${envName} does not match recovery manifest`);
  return actual;
}

function validatedFile(file, index) {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new TypeError(`files[${index}] must be an object`);
  }
  if (!new Set(["media", "import"]).has(file.area)) {
    throw new TypeError(`files[${index}].area must be media or import`);
  }
  const relativePath = requiredString(file.path, `files[${index}].path`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,189}$/.test(relativePath) || relativePath.includes("..")) {
    throw new TypeError(`files[${index}].path must be a safe stored filename`);
  }
  const recordId = positiveId(file.recordId, `files[${index}].recordId`);
  let fileKind;
  if (file.area === "import") {
    if (!new Set(["source", "result"]).has(file.fileKind)) {
      throw new TypeError(`files[${index}].fileKind must be source or result for import evidence`);
    }
    fileKind = file.fileKind;
  } else if (file.fileKind !== undefined) {
    throw new TypeError(`files[${index}].fileKind is only valid for import evidence`);
  }
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
    throw new TypeError(`files[${index}].bytes must be a non-negative safe integer`);
  }
  if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) {
    throw new TypeError(`files[${index}].sha256 must be lowercase SHA-256`);
  }
  return { area: file.area, recordId, fileKind, path: relativePath, bytes: file.bytes, sha256: file.sha256 };
}

function positiveId(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function validatedSmokeSku(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("database.smokeSku is required");
  return {
    skuCode: requiredString(value.skuCode, "database.smokeSku.skuCode"),
    itemId: positiveId(value.itemId, "database.smokeSku.itemId"),
    skuId: positiveId(value.skuId, "database.smokeSku.skuId")
  };
}

function validatedSmokeAudit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("database.smokeAudit is required");
  return {
    id: positiveId(value.id, "database.smokeAudit.id"),
    action: requiredString(value.action, "database.smokeAudit.action"),
    targetType: requiredString(value.targetType, "database.smokeAudit.targetType"),
    targetId: positiveId(value.targetId, "database.smokeAudit.targetId")
  };
}

function approvedTrustPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.status !== "APPROVED") {
    throw new TypeError("recovery trust policy is not approved");
  }
  if (value.schemaVersion !== 1) throw new TypeError("recovery trust policy schemaVersion must be 1");
  const environmentId = requiredString(value.environmentId, "recovery trust policy environmentId");
  const schemaPrefix = requiredString(value.schemaPrefix, "recovery trust policy schemaPrefix");
  if (!["INDEPENDENT", "OWNER_WAIVER"].includes(value.attestationMode)) {
    throw new TypeError("recovery trust policy attestationMode must be INDEPENDENT or OWNER_WAIVER");
  }
  const waiverApprovalId = value.attestationMode === "OWNER_WAIVER"
    ? requiredString(value.waiverApprovalId, "recovery trust policy waiverApprovalId")
    : undefined;
  if (waiverApprovalId && !/^APR-[0-9]+$/.test(waiverApprovalId)) {
    throw new TypeError("recovery trust policy waiverApprovalId must be an APR identifier");
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{2,63}_$/.test(schemaPrefix)) {
    throw new TypeError("recovery trust policy schemaPrefix must be a safe, non-empty prefix ending in underscore");
  }
  return {
    environmentId,
    schemaPrefix,
    attestationMode: value.attestationMode,
    waiverApprovalId,
    attestationPublicKeyPem: requiredString(value.attestationPublicKeyPem, "recovery trust policy attestationPublicKeyPem")
  };
}

export function itemRecoveryTestResult({ passed, trustPolicy } = {}) {
  if (!passed) return { status: "FAIL", disposition: "FAIL" };
  const trust = approvedTrustPolicy(trustPolicy);
  return trust.attestationMode === "OWNER_WAIVER"
    ? { status: "NOT_RUN", disposition: "PASS_WITH_OWNER_WAIVER", approvalId: trust.waiverApprovalId }
    : { status: "PASS", disposition: "PASS" };
}

export function verifyItemRecoveryAttestation({ manifestBytes, signatureBase64, publicKeyPem } = {}) {
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length === 0) throw new TypeError("recovery manifest bytes are required");
  const signatureText = requiredString(signatureBase64, "recovery attestation signature");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)) throw new TypeError("recovery attestation signature must be base64");
  try {
    const publicKey = createPublicKey(requiredString(publicKeyPem, "recovery attestation public key"));
    if (publicKey.asymmetricKeyType !== "ed25519") throw new TypeError("recovery attestation key must be Ed25519");
    const signature = Buffer.from(signatureText, "base64");
    if (signature.length !== 64 || !verify(null, manifestBytes, publicKey, signature)) {
      throw new TypeError("recovery attestation signature is invalid");
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("recovery attestation")) throw error;
    throw new TypeError("recovery attestation public key is invalid", { cause: error });
  }
  return true;
}

export function parseItemRecoveryContext({ env, manifest, trustPolicy, nowMs = Date.now() } = {}) {
  if (!env || !manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("environment and recovery manifest are required");
  }
  if (env.ITEM_RECOVERY_CONFIRM !== "VERIFY_RESTORED_COPY") {
    throw new TypeError("ITEM_RECOVERY_CONFIRM=VERIFY_RESTORED_COPY is required");
  }
  if (env.ITEM_RECOVERY_ENVIRONMENT_CLASS !== "staging-like" || manifest.environmentClass !== "staging-like") {
    throw new TypeError("a staging-like recovery environment is required");
  }
  if (manifest.schemaVersion !== 1) throw new TypeError("recovery manifest schemaVersion must be 1");
  const trust = approvedTrustPolicy(trustPolicy);
  if (env.ITEM_RECOVERY_ENVIRONMENT_ID !== trust.environmentId || manifest.environmentId !== trust.environmentId) {
    throw new TypeError("recovery environment identity does not match the approved trust policy");
  }

  const databaseSchema = requiredString(env.DB_NAME, "DB_NAME");
  if (!/^[A-Za-z0-9_]+$/.test(databaseSchema)) throw new TypeError("DB_NAME is not a safe MySQL schema identifier");
  if (PROTECTED_SCHEMAS.has(databaseSchema.toLowerCase())) {
    throw new TypeError("recovery verification refuses protected or ordinary development schema");
  }
  if (!databaseSchema.startsWith(trust.schemaPrefix) || databaseSchema === trust.schemaPrefix) {
    throw new TypeError("DB_NAME does not use the approved restored-schema prefix");
  }
  if (manifest.database?.schema !== databaseSchema) throw new TypeError("DB_NAME does not match manifest database.schema");

  const recoveryPoint = manifest.recoveryPoint;
  if (!recoveryPoint || typeof recoveryPoint !== "object" || Array.isArray(recoveryPoint)) {
    throw new TypeError("manifest.recoveryPoint is required");
  }
  matchingId(env, recoveryPoint.id, "ITEM_RECOVERY_POINT_ID", "recoveryPoint.id");
  matchingId(env, recoveryPoint.databaseBackupId, "ITEM_RECOVERY_BACKUP_ID", "recoveryPoint.databaseBackupId");
  matchingId(env, recoveryPoint.mediaSnapshotId, "ITEM_RECOVERY_MEDIA_SNAPSHOT_ID", "recoveryPoint.mediaSnapshotId");
  matchingId(env, recoveryPoint.importSnapshotId, "ITEM_RECOVERY_IMPORT_SNAPSHOT_ID", "recoveryPoint.importSnapshotId");

  const backupCreatedAt = timestamp(recoveryPoint.backupCreatedAt, "recoveryPoint.backupCreatedAt");
  const latestCommittedAt = timestamp(recoveryPoint.latestCommittedAt, "recoveryPoint.latestCommittedAt");
  const restoreStartedAt = timestamp(recoveryPoint.restoreStartedAt, "recoveryPoint.restoreStartedAt");
  const restoreCompletedAt = timestamp(recoveryPoint.restoreCompletedAt, "recoveryPoint.restoreCompletedAt");
  if (!(backupCreatedAt <= latestCommittedAt && latestCommittedAt <= restoreStartedAt && restoreStartedAt <= restoreCompletedAt)) {
    throw new TypeError("recovery timestamps are not in a valid backup/commit/restore order");
  }
  if (restoreCompletedAt > nowMs + 5 * 60 * 1000) throw new TypeError("restore completion timestamp is in the future");

  const counts = manifest.database?.tableCounts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) throw new TypeError("database.tableCounts is required");
  const countKeys = Object.keys(counts).sort();
  if (JSON.stringify(countKeys) !== JSON.stringify([...ITEM_RECOVERY_TABLES].sort())) {
    throw new TypeError("database.tableCounts must contain exactly the Item recovery tables");
  }
  for (const table of ITEM_RECOVERY_TABLES) {
    if (!Number.isSafeInteger(counts[table]) || counts[table] < 0) {
      throw new TypeError(`database.tableCounts.${table} must be a non-negative safe integer`);
    }
  }

  const mediaRoot = requiredString(env.ITEM_RECOVERY_MEDIA_ROOT, "ITEM_RECOVERY_MEDIA_ROOT");
  const importRoot = requiredString(env.ITEM_RECOVERY_IMPORT_ROOT, "ITEM_RECOVERY_IMPORT_ROOT");
  if (!path.isAbsolute(mediaRoot) || !path.isAbsolute(importRoot)) throw new TypeError("restored file roots must be absolute paths");
  const files = Array.isArray(manifest.files) ? manifest.files.map(validatedFile) : [];
  if (!files.some((file) => file.area === "media") || !files.some((file) => file.area === "import")) {
    throw new TypeError("recovery manifest must include media and import file evidence");
  }
  const fileReferences = files.map((file) => `${file.area}:${file.recordId}:${file.fileKind ?? "media"}`);
  if (new Set(fileReferences).size !== fileReferences.length) {
    throw new TypeError("recovery manifest file evidence must not repeat a database reference");
  }

  return {
    databaseSchema,
    mediaRoot,
    importRoot,
    tableCounts: { ...counts },
    smokeSku: validatedSmokeSku(manifest.database.smokeSku),
    smokeAudit: validatedSmokeAudit(manifest.database.smokeAudit),
    files,
    recoveryPoint: { ...recoveryPoint },
    metrics: {
      observedRtoMs: restoreCompletedAt - restoreStartedAt,
      observedRpoMs: latestCommittedAt - backupCreatedAt,
      rtoObjectiveMs: RTO_OBJECTIVE_MS,
      rpoObjectiveMs: RPO_OBJECTIVE_MS,
      rtoPassed: restoreCompletedAt - restoreStartedAt <= RTO_OBJECTIVE_MS,
      rpoPassed: latestCommittedAt - backupCreatedAt <= RPO_OBJECTIVE_MS
    }
  };
}

const INTEGRITY_QUERY = `
  SELECT (
    (SELECT COUNT(*) FROM item_skus s LEFT JOIN items i ON i.id = s.item_id WHERE i.id IS NULL) +
    (SELECT COUNT(*) FROM item_sku_uoms su LEFT JOIN item_skus s ON s.id = su.sku_id LEFT JOIN item_uoms u ON u.id = su.uom_id WHERE s.id IS NULL OR u.id IS NULL) +
    (SELECT COUNT(*) FROM item_sku_barcodes b LEFT JOIN item_sku_uoms su ON su.id = b.sku_uom_id AND su.sku_id = b.sku_id WHERE su.id IS NULL) +
    (SELECT COUNT(*) FROM item_attribute_options o LEFT JOIN item_attribute_definitions a ON a.id = o.attribute_id WHERE a.id IS NULL) +
    (SELECT COUNT(*) FROM item_category_attributes ca LEFT JOIN item_categories c ON c.id = ca.category_id LEFT JOIN item_attribute_definitions a ON a.id = ca.attribute_id WHERE c.id IS NULL OR a.id IS NULL) +
    (SELECT COUNT(*) FROM item_attribute_values av LEFT JOIN items i ON i.id = av.item_id LEFT JOIN item_attribute_definitions a ON a.id = av.attribute_id LEFT JOIN item_attribute_options o ON o.id = av.option_id WHERE i.id IS NULL OR a.id IS NULL OR (av.option_id IS NOT NULL AND (o.id IS NULL OR o.attribute_id <> av.attribute_id))) +
    (SELECT COUNT(*) FROM item_sku_attribute_values sv LEFT JOIN item_skus s ON s.id = sv.sku_id LEFT JOIN item_attribute_definitions a ON a.id = sv.attribute_id LEFT JOIN item_attribute_options o ON o.id = sv.option_id WHERE s.id IS NULL OR a.id IS NULL OR (sv.option_id IS NOT NULL AND (o.id IS NULL OR o.attribute_id <> sv.attribute_id))) +
    (SELECT COUNT(*) FROM item_media m LEFT JOIN items i ON i.id = m.item_id LEFT JOIN item_skus s ON s.id = m.sku_id AND s.item_id = m.item_id WHERE i.id IS NULL OR (m.sku_id IS NOT NULL AND s.id IS NULL)) +
    (SELECT COUNT(*) FROM item_import_rows r LEFT JOIN item_import_jobs j ON j.id = r.job_id WHERE j.id IS NULL)
  ) AS violations`;

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyRestoredFile(file, context, database) {
  if (file.area === "media") {
    const [[metadata]] = await database.query(
      "SELECT stored_name, byte_size, sha256 FROM item_media WHERE id = ?",
      [file.recordId]
    );
    if (!metadata || metadata.stored_name !== file.path || Number(metadata.byte_size) !== file.bytes || metadata.sha256 !== file.sha256) {
      throw new Error("restored media metadata differs from manifest");
    }
  } else {
    const [[metadata]] = await database.query(
      "SELECT file_stored_name, result_stored_name, file_sha256 FROM item_import_jobs WHERE id = ?",
      [file.recordId]
    );
    const storedName = file.fileKind === "source" ? metadata?.file_stored_name : metadata?.result_stored_name;
    if (!metadata || storedName !== file.path || (file.fileKind === "source" && metadata.file_sha256 !== file.sha256)) {
      throw new Error("restored import metadata differs from manifest");
    }
  }

  const root = file.area === "media" ? context.mediaRoot : context.importRoot;
  const rootRealPath = await realpath(root);
  const candidate = path.resolve(root, file.path);
  const candidateRealPath = await realpath(candidate);
  const prefix = `${rootRealPath}${path.sep}`;
  if (!candidateRealPath.startsWith(prefix)) throw new Error("restored file resolves outside its declared root");
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("restored path is not a regular file");
  if (stat.size !== file.bytes) throw new Error("restored file size differs from manifest");
  if (await sha256File(candidate) !== file.sha256) throw new Error("restored file digest differs from manifest");
}

export async function verifyItemRecovery({ database, context } = {}) {
  if (!database || !context) throw new TypeError("database and parsed recovery context are required");
  const checks = [];
  const check = async (id, verify) => {
    try {
      const passed = await verify();
      checks.push({ id, status: passed ? "PASS" : "FAIL" });
    } catch (error) {
      checks.push({ id, status: "FAIL", error: error instanceof Error ? error.message : "verification failed" });
    }
  };

  for (const table of ITEM_RECOVERY_TABLES) {
    await check(`table-count:${table}`, async () => {
      const [[row]] = await database.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
      return Number(row.total) === context.tableCounts[table];
    });
  }

  await check("relational-integrity", async () => {
    const [[row]] = await database.query(INTEGRITY_QUERY);
    return Number(row.violations) === 0;
  });

  await check("smoke:sku-lookup", async () => {
    const lookup = new ItemLookupService({
      database,
      logger: { error: async () => {} },
      time: { nowMs: () => Date.now() }
    });
    const sku = await lookup.findByCode(context.smokeSku.skuCode, { includeInactive: true });
    return sku?.skuId === context.smokeSku.skuId && sku.itemId === context.smokeSku.itemId;
  });

  await check("smoke:audit-linkage", async () => {
    const [[audit]] = await database.query(
      "SELECT id, action, target_type, target_id FROM item_audit_logs WHERE id = ?",
      [context.smokeAudit.id]
    );
    return Number(audit?.id) === context.smokeAudit.id &&
      audit.action === context.smokeAudit.action &&
      audit.target_type === context.smokeAudit.targetType &&
      Number(audit.target_id) === context.smokeAudit.targetId;
  });

  for (const file of context.files) {
    await check(`file:${file.area}:${file.path}`, async () => {
      await verifyRestoredFile(file, context, database);
      return true;
    });
  }

  checks.push({ id: "objective:rto", status: context.metrics.rtoPassed ? "PASS" : "FAIL" });
  checks.push({ id: "objective:rpo", status: context.metrics.rpoPassed ? "PASS" : "FAIL" });
  return {
    passed: checks.every(({ status }) => status === "PASS"),
    checks,
    metrics: { ...context.metrics }
  };
}

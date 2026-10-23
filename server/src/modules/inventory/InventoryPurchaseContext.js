import { createHash } from "node:crypto";
import { cloneData, deepFreeze } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { AuthenticationError } from "../../framework/auth/AuthenticationError.js";
import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { DEVICE_HEADERS, deviceSignatureError, deviceStatusError } from "../../services/deviceBinding/deviceSignatureRequest.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { assertPermissionsCurrent, permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { inventoryOperationHash } from "./InventoryOperationService.js";
import { normalizePurchaseReceipt, normalizePurchaseReversal } from "./inventoryPurchaseValidation.js";

const contexts = new WeakMap(), issuedRequests = new WeakSet();
const ROUTE = "/api/v1/goods-receipts/:id/confirm";
const REVERSAL_ROUTE = "/api/v1/goods-receipts/:id/reversals/create";
const SNAPSHOT_FIELDS = ["purchaseOrderId", "purchaseOrderLineId", "confirmedVersion", "skuId", "inventoryTrackedSnapshot",
  "trackingPolicySnapshot", "baseUomIdSnapshot", "baseUomCodeSnapshot", "minimumReceiptLifeDaysSnapshot"];

export function assertPurchaseTransaction(database, tx) {
  const current = database?.context?.get();
  if (!current || current.databaseTransaction !== tx || getActiveTransactionIsolation(tx) !== "REPEATABLE READ") {
    throw permissionStaleError();
  }
  return current;
}

function intent(command) {
  return inventoryOperationHash({ commandType: "PURCHASE_RECEIPT_BATCH", payload: normalizePurchaseReceipt(command) });
}

function assertTime(record) {
  record.signal?.throwIfAborted();
  const now = record.time.nowMs();
  if (record.kind === "reversal" && (!Number.isSafeInteger(record.signedRequestAt) ||
      Math.abs(now - record.signedRequestAt) > record.signatureMaxSkewSeconds * 1000)) throw deviceSignatureError("timestamp_stale");
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(record.claims.exp) ||
      now >= (record.claims.exp + record.clockToleranceSeconds) * 1000) {
    throw new AuthenticationError("JWT_INVALID", "JWT expired before purchase Inventory submission");
  }
  if (!Number.isSafeInteger(record.claims.auth_time) ||
      Math.floor(now / 1000) - record.claims.auth_time > record.sessionMaxAgeSeconds) {
    throw new AuthenticationError("SESSION_EXPIRED", "Absolute session lifetime exceeded");
  }
}

function assertBinding(record) {
  const current = assertPurchaseTransaction(record.database, record.tx);
  if (current !== record.requestContext || current.auth !== record.auth || current.apiRoute !== record.apiRoute ||
      record.req.context !== current || record.req.auth !== record.auth || record.req.apiRoute !== record.apiRoute ||
      record.req.method !== "POST" || record.apiRoute.path !== (record.kind === "reversal" ? REVERSAL_ROUTE : ROUTE) ||
      record.apiRoute.authType !== (record.kind === "reversal" ? "jwt-device-password" : "jwt") ||
      record.auth.type !== record.apiRoute.authType || record.req.input?.params?.id !== record.documentId ||
      Object.keys(record.req.input.params).length !== 1) throw permissionStaleError();
  assertTime(record);
}

async function checkCurrent(record, { locking = false } = {}) {
  assertBinding(record);
  const tx = record.tx, lock = locking ? " FOR SHARE" : "";
  const [users] = await tx.query(`SELECT id, username, status FROM users WHERE id = ?${lock}`, [record.actorId]);
  if (users[0]?.status !== "active") throw permissionStaleError();
  const [roles] = await tx.query(`SELECT ur.role_id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? ORDER BY ur.role_id${lock}`, [record.actorId]);
  const permissionNames = [];
  for (const roleId of [...new Set(roles.map(row => Number(row.role_id)))].sort((a, b) => a - b)) {
    const [permissions] = await tx.query(`SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? ORDER BY rp.permission_id${lock}`, [roleId]);
    permissionNames.push(...permissions.map(row => row.name));
  }
  const roleNames = [...new Set(roles.map(row => row.name))], permissions = [...new Set(permissionNames)];
  assertPermissionsCurrent({ claimedRoles: record.claims.roles, claimedPermissions: record.claims.permissions,
    currentRoles: roleNames, currentPermissions: permissions });
  if (!["purchasing.view", record.kind === "reversal" ? "inventory.adjust" : "receiving.operation"].every(value => permissions.includes(value))) throw permissionStaleError();
  if (record.kind === "reversal") {
    const [devices] = await tx.query(`SELECT id, user_id, device_id, public_key, status FROM user_devices
      WHERE user_id = ? AND device_id = ?${lock}`, [record.actorId, record.claims.did]);
    const binding = devices[0];
    if (!binding || binding.status !== "approved") throw deviceStatusError(binding?.status ?? "revoked");
    if (Number(binding.id) !== record.bindingId || Number(binding.user_id) !== record.actorId ||
        binding.device_id !== record.claims.did || deviceKeyHash(binding.public_key) !== record.keyHash) throw deviceMismatch();
  }
  const [versions] = await tx.query(`SELECT version FROM fr_token_versions WHERE subject = ?${lock}`, [record.claims.sub]);
  const version = Number(versions[0]?.version ?? 0);
  if (!Number.isSafeInteger(version) || version < 0 || !Number.isSafeInteger(record.claims.ver) || record.claims.ver < version) {
    throw new AuthenticationError("JWT_INVALID", "JWT revoked before purchase Inventory submission");
  }
  assertBinding(record);
  return { id: record.actorId, username: users[0].username, roles: roleNames, permissions };
}

export function issuePurchaseReceiptContext(req, tx, command, confirmedLines, options) {
  const normalized = normalizePurchaseReceipt(command), current = assertPurchaseTransaction(options?.database, tx);
  if (!req || issuedRequests.has(req) || req.context !== current || req.auth !== current.auth || req.apiRoute !== current.apiRoute ||
      req.auth?.type !== "jwt" || req.method !== "POST" || req.apiRoute?.path !== ROUTE || req.apiRoute.authType !== "jwt" ||
      req.input?.params?.id !== normalized.source.documentId || Object.keys(req.input.params).length !== 1 ||
      String(req.auth.claims?.sub) !== String(normalized.actor.userId) ||
      !Array.isArray(req.auth.claims?.roles) || !Array.isArray(req.auth.claims?.permissions)) throw permissionStaleError();
  assertPermissionsCurrent({ claimedRoles: normalized.actor.claimedRoles, claimedPermissions: normalized.actor.claimedPermissions,
    currentRoles: req.auth.claims.roles, currentPermissions: req.auth.claims.permissions });
  if (!Array.isArray(confirmedLines) || confirmedLines.length !== normalized.lines.length ||
      new Set(confirmedLines.map(row => row.sourceLineId)).size !== confirmedLines.length) throw permissionStaleError();
  for (const line of normalized.lines) {
    const proof = confirmedLines.find(row => row.sourceLineId === line.sourceLineId);
    if (!proof || proof.status !== "CONFIRMED" || SNAPSHOT_FIELDS.some(key => proof[key] !== line.commitment[key])) {
      throw permissionStaleError();
    }
  }
  if (typeof options?.time?.nowMs !== "function" || !Number.isSafeInteger(options.sessionMaxAgeSeconds) ||
      options.sessionMaxAgeSeconds <= 0 || !Number.isSafeInteger(options.clockToleranceSeconds) || options.clockToleranceSeconds < 0) {
    throw new TypeError("Purchase context requires existing authentication time limits");
  }
  const record = { tx, req, database: options.database, time: options.time,
    sessionMaxAgeSeconds: options.sessionMaxAgeSeconds, clockToleranceSeconds: options.clockToleranceSeconds,
    requestContext: current, auth: req.auth, apiRoute: req.apiRoute, actorId: normalized.actor.userId,
    documentId: normalized.source.documentId, signal: req.requestTimeout?.signal ?? current.signal,
    claims: deepFreeze(cloneData(req.auth.claims, "Purchase authenticated claims")), intent: intent(command) };
  assertBinding(record);
  const capsule = Object.freeze({}); contexts.set(capsule, record); issuedRequests.add(req);
  return capsule;
}

export function consumePurchaseReceiptContext(tx, capsule, command, database) {
  const record = contexts.get(capsule);
  if (!record || record.kind === "reversal" || record.tx !== tx || record.database !== database || record.intent !== intent(command)) throw permissionStaleError();
  assertBinding(record);
  contexts.delete(capsule);
  return Object.freeze({ check: options => checkCurrent(record, options), assertTime: () => assertBinding(record) });
}

function deviceMismatch() {
  return new ApplicationError("Request device does not match the trusted binding", {
    code: "DEVICE_MISMATCH", statusCode: 403, publicCode: "DEVICE_MISMATCH",
    publicMessage: "This token was issued to a different device"
  });
}

function deviceKeyHash(key) {
  if (!Buffer.isBuffer(key) || key.length === 0) throw deviceMismatch();
  return createHash("sha256").update(key).digest("hex");
}

function strictProjection(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw permissionStaleError();
}

function ownerStatus(command, proof) {
  strictProjection(proof, ["goodsReceiptId", "status", "details"]);
  if (proof.goodsReceiptId !== command.goodsReceiptId || !["CONFIRMED", "PARTIALLY_REVERSED", "REVERSED"].includes(proof.status) ||
      !Array.isArray(proof.details) || proof.details.length !== command.lines.length) throw permissionStaleError();
  const seen = new Set();
  for (const detail of proof.details) {
    strictProjection(detail, ["sourceLineId", "goodsReceiptId", "originalMovementId"]);
    const line = command.lines.find(row => row.sourceLineId === detail.sourceLineId);
    if (!line || seen.has(detail.sourceLineId) || detail.goodsReceiptId !== command.goodsReceiptId ||
        detail.originalMovementId !== line.originalMovementId) throw permissionStaleError();
    seen.add(detail.sourceLineId);
  }
  return proof.status;
}

function reversalIntent(command) {
  return inventoryOperationHash({ commandType: "PURCHASE_REVERSE_BATCH", payload: normalizePurchaseReversal(command) });
}

export function issuePurchaseReversalContext(req, tx, command, options) {
  const normalized = normalizePurchaseReversal(command), current = assertPurchaseTransaction(options?.database, tx);
  const auth = req?.auth, claims = auth?.claims, binding = auth?.deviceBinding;
  if (!req || issuedRequests.has(req) || req.context !== current || auth !== current.auth || req.apiRoute !== current.apiRoute ||
      auth?.type !== "jwt-device-password" || req.method !== "POST" || req.apiRoute?.path !== REVERSAL_ROUTE ||
      req.apiRoute.authType !== "jwt-device-password" || req.input?.params?.id !== normalized.goodsReceiptId ||
      Object.keys(req.input.params).length !== 1 || String(claims?.sub) !== String(normalized.actor.userId) ||
      !Array.isArray(claims.roles) || !Array.isArray(claims.permissions)) throw permissionStaleError();
  assertPermissionsCurrent({ claimedRoles: normalized.actor.claimedRoles, claimedPermissions: normalized.actor.claimedPermissions,
    currentRoles: claims.roles, currentPermissions: claims.permissions });
  if (!binding || binding.status !== "approved" || Number(binding.user_id) !== normalized.actor.userId ||
      !Number.isSafeInteger(Number(binding.id)) || Number(binding.id) < 1 ||
      typeof claims.did !== "string" || !/^[0-9a-f]{64}$/u.test(claims.did) || binding.device_id !== claims.did) throw deviceMismatch();
  if (typeof options.time?.nowMs !== "function" || ![options.sessionMaxAgeSeconds, options.signatureMaxSkewSeconds]
    .every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(options.clockToleranceSeconds) || options.clockToleranceSeconds < 0) {
    throw new TypeError("Purchase reversal requires existing authentication time limits");
  }
  const record = { kind: "reversal", tx, req, database: options.database, time: options.time,
    sessionMaxAgeSeconds: options.sessionMaxAgeSeconds, clockToleranceSeconds: options.clockToleranceSeconds,
    signatureMaxSkewSeconds: options.signatureMaxSkewSeconds, signedRequestAt: Number(req.get(DEVICE_HEADERS.timestamp)),
    bindingId: Number(binding.id), keyHash: deviceKeyHash(binding.public_key), ownerStatus: ownerStatus(normalized, options.ownerProof),
    requestContext: current, auth, apiRoute: req.apiRoute, actorId: normalized.actor.userId, documentId: normalized.goodsReceiptId,
    signal: req.requestTimeout?.signal ?? current.signal, claims: deepFreeze(cloneData(claims, "Purchase reversal claims")),
    intent: reversalIntent(command) };
  assertBinding(record);
  const capsule = Object.freeze({}); contexts.set(capsule, record); issuedRequests.add(req); return capsule;
}

export function consumePurchaseReversalContext(tx, capsule, command, database) {
  const record = contexts.get(capsule);
  if (!record || record.kind !== "reversal" || record.tx !== tx || record.database !== database ||
      record.intent !== reversalIntent(command)) throw permissionStaleError();
  assertBinding(record); contexts.delete(capsule);
  return Object.freeze({ ownerStatus: record.ownerStatus, check: options => checkCurrent(record, options),
    assertTime: () => assertBinding(record), audit: Object.freeze({ deviceId: record.claims.did, signedRequestAt: record.signedRequestAt }) });
}

// Consumer must call in a fresh independent read-only RR transaction, never its business transaction.
export async function authorizePurchaseLookup(tx, options) {
  const current = assertPurchaseTransaction(options.database, tx), auth = current.auth;
  const actorId = Number(auth?.claims?.sub);
  if (auth?.type !== "jwt" || !current.apiRoute?.authType?.startsWith("jwt") ||
      !Number.isSafeInteger(actorId) || actorId < 1 || !Array.isArray(auth.claims.roles) || !Array.isArray(auth.claims.permissions)) {
    throw permissionStaleError();
  }
  if (typeof options.time?.nowMs !== "function" || !Number.isSafeInteger(options.sessionMaxAgeSeconds) ||
      options.sessionMaxAgeSeconds <= 0 || !Number.isSafeInteger(options.clockToleranceSeconds) || options.clockToleranceSeconds < 0) {
    throw new TypeError("Purchase lookup requires existing authentication time limits");
  }
  const record = { time: options.time, signal: current.signal, claims: deepFreeze(cloneData(auth.claims, "Purchase lookup claims")),
    sessionMaxAgeSeconds: options.sessionMaxAgeSeconds, clockToleranceSeconds: options.clockToleranceSeconds };
  const check = () => {
    if (assertPurchaseTransaction(options.database, tx) !== current || current.auth !== auth) throw permissionStaleError();
    assertTime(record);
  };
  check();
  const actor = await assertActorFresh({ query: (sql, params) => tx.query(`${sql} FOR SHARE`, params) },
    { actorId, claimedRoles: record.claims.roles, claimedPermissions: record.claims.permissions });
  if (!actor.username || !actor.permissions.includes("purchasing.view")) throw permissionStaleError();
  const [versions] = await tx.query("SELECT version FROM fr_token_versions WHERE subject = ? FOR SHARE", [record.claims.sub]);
  const version = Number(versions[0]?.version ?? 0);
  if (!Number.isSafeInteger(version) || version < 0 || !Number.isSafeInteger(record.claims.ver) || record.claims.ver < version) {
    throw new AuthenticationError("JWT_INVALID", "JWT revoked before purchase lookup");
  }
  check();
  return check;
}

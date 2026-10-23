import { cloneData, deepFreeze } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { AuthenticationError } from "../../framework/auth/AuthenticationError.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { assertPermissionsCurrent, permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { inventoryOperationHash } from "./InventoryOperationService.js";
import { normalizePurchaseReceipt } from "./inventoryPurchaseValidation.js";

const contexts = new WeakMap(), issuedRequests = new WeakSet();
const ROUTE = "/api/v1/goods-receipts/:id/confirm";
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
      record.req.method !== "POST" || record.apiRoute.path !== ROUTE || record.apiRoute.authType !== "jwt" ||
      record.auth.type !== "jwt" || record.req.input?.params?.id !== record.documentId) throw permissionStaleError();
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
  if (!["purchasing.view", "receiving.operation"].every(value => permissions.includes(value))) throw permissionStaleError();
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
  if (!record || record.tx !== tx || record.database !== database || record.intent !== intent(command)) throw permissionStaleError();
  assertBinding(record);
  contexts.delete(capsule);
  return Object.freeze({ check: options => checkCurrent(record, options), assertTime: () => assertBinding(record) });
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

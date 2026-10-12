import { createHash } from "node:crypto";

import { cloneData, deepFreeze } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { AuthenticationError } from "../../framework/auth/AuthenticationError.js";
import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { DEVICE_HEADERS, deviceSignatureError, deviceStatusError } from "../../services/deviceBinding/deviceSignatureRequest.js";
import { assertPermissionsCurrent, permissionStaleError } from "../authorization/adminGuard.js";
import { inventoryOperationHash } from "./InventoryOperationService.js";

const contexts = new WeakMap();
const issuedRequests = new WeakSet();
const ROUTES = Object.freeze({
  "adjustment.post": "/api/v1/inventory/adjustments",
  "status_transfer.post": "/api/v1/inventory/status-transfers",
  "movement.reverse": "/api/v1/inventory/movements/:id/reverse"
});

function intent(command) {
  const action = command?.authorization?.purpose;
  if (!ROUTES[action] || command.authorization.requiredCallerPermission !== "inventory.adjust") {
    throw permissionStaleError();
  }
  const commandType = action === "adjustment.post" ? "ADJUSTMENT_POST"
    : action === "status_transfer.post" ? "STATUS_TRANSFER_POST" : "MOVEMENT_REVERSE";
  return inventoryOperationHash({ commandType,
    payload: { action, actor: command.actor, source: command.source, payload: command.payload, correlationId: command.correlationId } });
}

function keyHash(value) {
  if (!Buffer.isBuffer(value) || value.length === 0) throw mismatch();
  return createHash("sha256").update(value).digest("hex");
}

function mismatch() {
  return new ApplicationError("Request device does not match the trusted binding", {
    code: "DEVICE_MISMATCH", statusCode: 403, publicCode: "DEVICE_MISMATCH",
    publicMessage: "This token was issued to a different device"
  });
}

function assertTime(record) {
  record.signal?.throwIfAborted();
  const now = record.time.nowMs();
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(record.signedRequestAt) ||
      Math.abs(now - record.signedRequestAt) > record.signatureMaxSkewSeconds * 1000) {
    throw deviceSignatureError("timestamp_stale");
  }
  if (!Number.isSafeInteger(record.claims.exp) || now >= (record.claims.exp + record.clockToleranceSeconds) * 1000) {
    throw new AuthenticationError("JWT_INVALID", "JWT expired before Inventory submission");
  }
  if (!Number.isSafeInteger(record.claims.auth_time) ||
      Math.floor(now / 1000) - record.claims.auth_time > record.sessionMaxAgeSeconds) {
    throw new AuthenticationError("SESSION_EXPIRED", "Absolute session lifetime exceeded");
  }
}

function recordFor(context, command) {
  const record = contexts.get(context);
  if (!record || record.intent !== intent(command)) throw permissionStaleError();
  return record;
}

async function checkCurrent(tx, record, { locking = false } = {}) {
  assertTime(record);
  const lock = locking ? " FOR SHARE" : "";
  const [users] = await tx.query(`SELECT id, username, status FROM users WHERE id = ?${lock}`, [record.actorId]);
  if (users[0]?.status !== "active") throw permissionStaleError();
  const [roles] = await tx.query(`SELECT ur.role_id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? ORDER BY ur.role_id${lock}`, [record.actorId]);
  const permissions = [];
  for (const roleId of [...new Set(roles.map(row => Number(row.role_id)))].sort((a, b) => a - b)) {
    const [rows] = await tx.query(`SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? ORDER BY rp.permission_id${lock}`, [roleId]);
    permissions.push(...rows.map(row => row.name));
  }
  const roleNames = [...new Set(roles.map(row => row.name))];
  const permissionNames = [...new Set(permissions)];
  assertPermissionsCurrent({ claimedRoles: record.claims.roles, claimedPermissions: record.claims.permissions,
    currentRoles: roleNames, currentPermissions: permissionNames });
  if (!["inventory.view", "inventory.adjust"].every(value => permissionNames.includes(value))) throw permissionStaleError();
  const [devices] = await tx.query(`SELECT id, user_id, device_id, public_key, status FROM user_devices
    WHERE user_id = ? AND device_id = ?${lock}`, [record.actorId, record.claims.did]);
  const binding = devices[0];
  if (!binding || binding.status !== "approved") throw deviceStatusError(binding?.status ?? "revoked");
  if (Number(binding.id) !== record.bindingId || Number(binding.user_id) !== record.actorId ||
      binding.device_id !== record.claims.did || keyHash(binding.public_key) !== record.keyHash) throw mismatch();
  const [versions] = await tx.query(`SELECT version FROM fr_token_versions WHERE subject = ?${lock}`, [record.claims.sub]);
  const version = Number(versions[0]?.version ?? 0);
  if (!Number.isSafeInteger(record.claims.ver) || record.claims.ver < 0 ||
      !Number.isSafeInteger(version) || version < 0 || record.claims.ver < version) {
    throw new AuthenticationError("JWT_INVALID", "JWT revoked before Inventory submission");
  }
  assertTime(record);
  return { id: record.actorId, username: users[0].username, roles: roleNames, permissions: permissionNames };
}

export function issueInventoryHighRiskContext(req, command, options) {
  const action = command?.authorization?.purpose;
  const auth = req?.auth;
  const actorId = Number(auth?.claims?.sub);
  if (!req || issuedRequests.has(req) || auth?.type !== "jwt-device-password" || req.method !== "POST" ||
      req.apiRoute?.authType !== "jwt-device-password" || !ROUTES[action] || req.apiRoute.path !== ROUTES[action] ||
      !Number.isSafeInteger(actorId) || actorId <= 0 || actorId !== command.actor.userId ||
      !Array.isArray(auth.claims.roles) || !Array.isArray(auth.claims.permissions)) throw permissionStaleError();
  if (action === "movement.reverse") {
    const params = req.input?.params;
    if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length !== 1 ||
        typeof params.id !== "string" || !/^[1-9][0-9]*$/u.test(params.id) ||
        !Number.isSafeInteger(command.payload.movementId) || command.payload.movementId <= 0 ||
        params.id !== String(command.payload.movementId)) throw permissionStaleError();
  }
  assertPermissionsCurrent({ claimedRoles: command.actor.claimedRoles, claimedPermissions: command.actor.claimedPermissions,
    currentRoles: auth.claims.roles, currentPermissions: auth.claims.permissions });
  const binding = auth.deviceBinding;
  if (!binding || binding.status !== "approved" || Number(binding.user_id) !== actorId ||
      !/^[0-9a-f]{64}$/u.test(auth.claims.did) || binding.device_id !== auth.claims.did) throw mismatch();
  if (!options?.time || typeof options.time.nowMs !== "function" ||
      ![options.signatureMaxSkewSeconds, options.sessionMaxAgeSeconds].every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(options.clockToleranceSeconds) || options.clockToleranceSeconds < 0) {
    throw new TypeError("Inventory high-risk context requires existing authentication time limits");
  }
  const record = { ...options, claims: deepFreeze(cloneData(auth.claims, "Inventory authenticated claims")), actorId,
    bindingId: Number(binding.id), keyHash: keyHash(binding.public_key), signal: req.requestTimeout?.signal,
    signedRequestAt: Number(req.get(DEVICE_HEADERS.timestamp)), intent: intent(command) };
  assertTime(record);
  const context = Object.freeze({});
  contexts.set(context, record);
  issuedRequests.add(req);
  return context;
}

export async function checkInventoryHighRiskContext(tx, context, command, options) {
  return checkCurrent(tx, recordFor(context, command), options);
}

export function consumeInventoryHighRiskContext(context, command) {
  const record = recordFor(context, command);
  contexts.delete(context);
  return Object.freeze({ check: (tx, options) => checkCurrent(tx, record, options), assertTime: () => assertTime(record),
    audit: Object.freeze({ deviceId: record.claims.did, signedRequestAt: record.signedRequestAt }) });
}

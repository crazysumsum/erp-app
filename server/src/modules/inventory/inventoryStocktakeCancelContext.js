import { cloneData, deepFreeze } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { AuthenticationError } from "../../framework/auth/AuthenticationError.js";
import { assertPermissionsCurrent, permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { inventoryOperationHash } from "./InventoryOperationService.js";

const contexts = new WeakMap(), issuedRequests = new WeakSet();
function intent(command) {
  if (command?.authorization?.purpose !== "stocktake.cancel" || command.authorization.requiredCallerPermission !== "inventory.operation") throw permissionStaleError();
  return inventoryOperationHash({ commandType: "STOCKTAKE_CANCEL", payload: { action: "stocktake.cancel", actor: command.actor,
    source: { ...command.source, lineId: command.source.lineId ?? "" }, payload: { ...command.payload,
      reason: typeof command.payload.reason === "string" ? command.payload.reason.trim() : command.payload.reason }, correlationId: command.correlationId } });
}
function assertTime(record) {
  record.signal?.throwIfAborted();
  const now = record.time.nowMs();
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(record.claims.exp) || now >= (record.claims.exp + record.clockToleranceSeconds) * 1000) {
    throw new AuthenticationError("JWT_INVALID", "JWT expired before Stocktake cancellation");
  }
  if (!Number.isSafeInteger(record.claims.auth_time) || Math.floor(now / 1000) - record.claims.auth_time > record.sessionMaxAgeSeconds) {
    throw new AuthenticationError("SESSION_EXPIRED", "Absolute session lifetime exceeded");
  }
}
async function checkCurrent(tx, record, { locking = false } = {}) {
  assertTime(record);
  const reader = locking ? { query: (sql, params) => tx.query(sql + " FOR SHARE", params) } : tx;
  const actor = await assertActorFresh(reader, { actorId: record.actorId, claimedRoles: record.claims.roles, claimedPermissions: record.claims.permissions });
  if (!["inventory.view", "inventory.operation"].every(value => actor.permissions.includes(value))) throw permissionStaleError();
  const [versions] = await reader.query("SELECT version FROM fr_token_versions WHERE subject = ?", [record.claims.sub]);
  const version = Number(versions[0]?.version ?? 0);
  if (!Number.isSafeInteger(record.claims.ver) || record.claims.ver < 0 || !Number.isSafeInteger(version) || version < 0 || record.claims.ver < version) {
    throw new AuthenticationError("JWT_INVALID", "JWT revoked before Stocktake cancellation");
  }
  assertTime(record);
  return actor;
}
export function issueInventoryStocktakeCancelContext(req, command, options) {
  const auth = req?.auth, actorId = Number(auth?.claims?.sub), params = req?.input?.params;
  if (!req || issuedRequests.has(req) || auth?.type !== "jwt-password" || req.method !== "POST" ||
      req.apiRoute?.authType !== "jwt-password" || req.apiRoute.path !== "/api/v1/inventory/stocktakes/:id/cancel" ||
      !Number.isSafeInteger(actorId) || actorId <= 0 || actorId !== command?.actor?.userId ||
      !Array.isArray(auth.claims.roles) || !Array.isArray(auth.claims.permissions) ||
      !params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length !== 1 ||
      typeof params.id !== "string" || !/^[1-9][0-9]*$/u.test(params.id) ||
      !Number.isSafeInteger(command.payload.stocktakeId) || command.payload.stocktakeId <= 0 || params.id !== String(command.payload.stocktakeId)) throw permissionStaleError();
  assertPermissionsCurrent({ claimedRoles: command.actor.claimedRoles, claimedPermissions: command.actor.claimedPermissions,
    currentRoles: auth.claims.roles, currentPermissions: auth.claims.permissions });
  if (!options?.time || typeof options.time.nowMs !== "function" || !Number.isSafeInteger(options.sessionMaxAgeSeconds) || options.sessionMaxAgeSeconds <= 0 ||
      !Number.isSafeInteger(options.clockToleranceSeconds) || options.clockToleranceSeconds < 0) throw new TypeError("Stocktake cancellation requires existing authentication time limits");
  const record = { time: options.time, sessionMaxAgeSeconds: options.sessionMaxAgeSeconds, clockToleranceSeconds: options.clockToleranceSeconds,
    claims: deepFreeze(cloneData(auth.claims, "Stocktake authenticated claims")), actorId, signal: req.requestTimeout?.signal, intent: intent(command) };
  assertTime(record);
  const context = Object.freeze({}); contexts.set(context, record); issuedRequests.add(req); return context;
}
export async function checkInventoryStocktakeCancelContext(tx, context, command, options) {
  const record = contexts.get(context);
  if (!record || record.intent !== intent(command)) throw permissionStaleError();
  return checkCurrent(tx, record, options);
}
export function consumeInventoryStocktakeCancelContext(context, command) {
  const record = contexts.get(context);
  if (!record || record.intent !== intent(command)) throw permissionStaleError();
  contexts.delete(context);
  return Object.freeze({ check: (tx, options) => checkCurrent(tx, record, options), assertTime: () => assertTime(record) });
}

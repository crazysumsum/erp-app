import { AuthenticationError } from "../../framework/auth/AuthenticationError.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { assertPermissionsCurrent, permissionStaleError } from "../authorization/adminGuard.js";
import { INVENTORY_STOCK_STATUSES } from "./inventoryConstants.js";
import { inventoryOperationHash } from "./InventoryOperationService.js";

const contexts = new WeakMap(), issued = new WeakSet();
const kinds = new Set(["customer", "supplier"]);
const eventId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function exact(value, fields) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) throw permissionStaleError();
}

function id(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value) ||
      !Number.isSafeInteger(Number(value))) throw permissionStaleError();
  return value;
}

function returnIntent(command, kind) {
  exact(command, ["actor", "source", "lines"]);
  exact(command.actor, ["userId", "claimedRoles", "claimedPermissions"]);
  exact(command.source, ["documentId", "eventId"]);
  const { actor, source, lines } = command;
  id(source.documentId);
  if (typeof source.eventId !== "string" || !eventId.test(source.eventId) ||
      !Number.isSafeInteger(actor.userId) || actor.userId < 1 ||
      !Array.isArray(actor.claimedRoles) || !Array.isArray(actor.claimedPermissions) ||
      !Array.isArray(lines) || lines.length < 1 || lines.length > 100 ||
      new Set(lines.map(line => line?.sourceLineId)).size !== lines.length) throw permissionStaleError();
  const fields = ["sourceLineId", "originalMovementId", "baseQuantity", "binId"];
  for (const line of lines) {
    exact(line, kind === "supplier" ? [...fields, "stockStatus"] : fields);
    for (const field of fields) id(line[field]);
    if (kind === "supplier" && !INVENTORY_STOCK_STATUSES.includes(line.stockStatus)) throw permissionStaleError();
  }
  return inventoryOperationHash({ commandType: kind === "customer" ? "RETURN_CUSTOMER_POST" : "RETURN_SUPPLIER_POST", payload: command });
}

function copyFacts(command, input) {
  if (!Array.isArray(input) || input.length !== command.lines.length) throw permissionStaleError();
  const movementByLine = new Map(command.lines.map(line => [line.sourceLineId, line.originalMovementId]));
  const facts = new Map();
  for (const fact of input) {
    exact(fact, ["sourceLineId", "originalMovementId", "warehouseId", "skuId", "lotId"]);
    if (facts.has(fact.sourceLineId) || movementByLine.get(fact.sourceLineId) !== fact.originalMovementId) throw permissionStaleError();
    id(fact.warehouseId); id(fact.skuId);
    if (fact.lotId !== null) id(fact.lotId);
    facts.set(fact.sourceLineId, Object.freeze({ ...fact }));
  }
  return facts;
}

function assertBinding(record) {
  const { req, tx, requestContext, auth, route, time, claims, signal, documentId } = record;
  const current = record.database.context.get();
  if (!current || current !== requestContext || current.databaseTransaction !== tx ||
      getActiveTransactionIsolation(tx) !== "REPEATABLE READ" || current.auth !== auth ||
      current.apiRoute !== route || req.auth !== auth || req.context !== current ||
      req.apiRoute !== route || req.method !== "POST" || route.path !== `/api/v1/${record.kind}-returns/:id/post` ||
      route.authType !== "jwt" || auth.type !== "jwt" || req.input?.params?.id !== documentId ||
      Object.keys(req.input.params).length !== 1) throw permissionStaleError();
  signal?.throwIfAborted();
  const now = time.nowMs();
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(claims.exp) ||
      now >= (claims.exp + record.clockToleranceSeconds) * 1000) {
    throw new AuthenticationError("JWT_INVALID", "JWT expired before return Inventory submission");
  }
  if (!Number.isSafeInteger(claims.auth_time) ||
      Math.floor(now / 1000) - claims.auth_time > record.sessionMaxAgeSeconds) {
    throw new AuthenticationError("SESSION_EXPIRED", "Absolute session lifetime exceeded");
  }
}

async function checkCurrent(record, { locking = false } = {}) {
  assertBinding(record);
  const { tx, actorId, claims, kind } = record;
  const lock = locking ? " FOR SHARE" : "";
  const [[user]] = await tx.query(`SELECT username, status FROM users WHERE id=?${lock}`, [actorId]);
  if (!user || user.status !== "active") throw permissionStaleError();
  const [roles] = await tx.query(`SELECT ur.role_id, r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=? ORDER BY ur.role_id${lock}`, [actorId]);
  const currentRoles = [...new Set(roles.map(role => role.name))], permissions = new Set();
  for (const { role_id } of roles) {
    const [names] = await tx.query(`SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
      WHERE rp.role_id=? ORDER BY rp.permission_id${lock}`, [role_id]);
    for (const { name } of names) permissions.add(name);
  }
  const currentPermissions = [...permissions];
  assertPermissionsCurrent({ claimedRoles: claims.roles, claimedPermissions: claims.permissions, currentRoles, currentPermissions });
  if (!permissions.has(`returns.${kind}.mgmt`)) throw permissionStaleError();
  const [[version]] = await tx.query(`SELECT version FROM fr_token_versions WHERE subject=?${lock}`, [claims.sub]);
  const currentVersion = Number(version?.version ?? 0);
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0 ||
      !Number.isSafeInteger(claims.ver) || claims.ver < currentVersion) {
    throw new AuthenticationError("JWT_INVALID", "JWT revoked before return Inventory submission");
  }
  assertBinding(record);
  return { id: actorId, username: user.username };
}

export function issueInventoryReturnContext(req, tx, command, lockedFacts, options) {
  const { kind, database, time, sessionMaxAgeSeconds, clockToleranceSeconds } = options ?? {};
  const requestContext = database?.context?.get(), auth = req?.auth;
  if (!req || issued.has(req) || !kinds.has(kind) || !Array.isArray(auth?.claims?.roles) ||
      !Array.isArray(auth?.claims?.permissions) || typeof time?.nowMs !== "function" ||
      !Number.isSafeInteger(sessionMaxAgeSeconds) || sessionMaxAgeSeconds <= 0 ||
      !Number.isSafeInteger(clockToleranceSeconds) || clockToleranceSeconds < 0) throw permissionStaleError();
  const intent = returnIntent(command, kind), { actor, source } = command;
  if (auth.claims.sub !== String(actor.userId) || !auth.claims.permissions.includes(`returns.${kind}.mgmt`)) throw permissionStaleError();
  assertPermissionsCurrent({ claimedRoles: actor.claimedRoles, claimedPermissions: actor.claimedPermissions,
    currentRoles: auth.claims.roles, currentPermissions: auth.claims.permissions });
  const record = { tx, req, requestContext, auth, route: req.apiRoute, kind, database, time,
    documentId: source.documentId, actorId: actor.userId, claims: structuredClone(auth.claims),
    sessionMaxAgeSeconds, clockToleranceSeconds, intent, facts: copyFacts(command, lockedFacts),
    signal: req.requestTimeout?.signal ?? requestContext?.signal };
  assertBinding(record);
  const capsule = Object.freeze({});
  contexts.set(capsule, record);
  issued.add(req);
  return capsule;
}

export function consumeInventoryReturnContext(tx, capsule, command, { kind, database }) {
  const record = contexts.get(capsule);
  if (!record || record.tx !== tx || record.kind !== kind || record.database !== database ||
      record.intent !== returnIntent(command, kind)) throw permissionStaleError();
  assertBinding(record);
  contexts.delete(capsule);
  return Object.freeze({
    check: options => checkCurrent(record, options),
    assertTime: () => assertBinding(record),
    factFor: sourceLineId => record.facts.get(sourceLineId)
  });
}

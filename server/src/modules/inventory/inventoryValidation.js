import {
  inventoryStringHasInvalidCharacters,
  isInventorySensitiveKey
} from "./inventorySafeJson.js";

const COMMAND_FIELDS = new Set(["actor", "authorization", "source", "correlationId", "payload"]);
const ACTOR_FIELDS = new Set(["userId", "serviceName", "claimedRoles", "claimedPermissions"]);
const AUTHORIZATION_FIELDS = new Set(["purpose", "requiredCallerPermission"]);
const SOURCE_FIELDS = new Set(["module", "documentType", "documentId", "lineId", "eventId"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactFields(value, fields, label) {
  object(value, label);
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new TypeError(`${label} has unknown field ${key}`);
  }
}

function string(value, label, maxBytes, { empty = false, ascii = false } = {}) {
  if (typeof value !== "string" || (!empty && value.length === 0) ||
      Buffer.byteLength(value, "utf8") > maxBytes || inventoryStringHasInvalidCharacters(value, ascii)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((entry) => string(entry, `${label} entry`, 100, { ascii: true }));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} contains duplicates`);
  return result;
}

function userId(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid actor userId");
  return value;
}

function jsonValue(value, path, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`${path} contains a non-finite number`);
  }
  if (!value || typeof value !== "object") throw new TypeError(`${path} must contain JSON values only`);
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain cycles`);
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => jsonValue(entry, `${path}[${index}]`, ancestors));
  } else {
    object(value, path);
    result = Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (isInventorySensitiveKey(key)) throw new TypeError(`${path} contains sensitive field ${key}`);
      return [key, jsonValue(entry, `${path}.${key}`, ancestors)];
    }));
  }
  ancestors.delete(value);
  return result;
}

export function assertInventoryTransaction(transaction) {
  if (!transaction || typeof transaction.query !== "function" || typeof transaction.execute !== "function") {
    throw new TypeError("Inventory command requires a caller-owned transaction executor with query() and execute()");
  }
  return transaction;
}

export function validateInventoryCommandContext(transaction, command, expectedAuthorization) {
  assertInventoryTransaction(transaction);
  exactFields(command, COMMAND_FIELDS, "Inventory command");
  exactFields(command.actor, ACTOR_FIELDS, "Inventory command actor");
  exactFields(command.authorization, AUTHORIZATION_FIELDS, "Inventory command authorization");
  exactFields(command.source, SOURCE_FIELDS, "Inventory command source");
  exactFields(expectedAuthorization, AUTHORIZATION_FIELDS, "Expected Inventory authorization");

  const authorization = {
    purpose: string(command.authorization.purpose, "authorization purpose", 100, { ascii: true }),
    requiredCallerPermission: string(
      command.authorization.requiredCallerPermission,
      "authorization requiredCallerPermission",
      100,
      { ascii: true }
    )
  };
  const expected = {
    purpose: string(expectedAuthorization.purpose, "expected authorization purpose", 100, { ascii: true }),
    requiredCallerPermission: string(
      expectedAuthorization.requiredCallerPermission,
      "expected authorization requiredCallerPermission",
      100,
      { ascii: true }
    )
  };
  if (authorization.purpose !== expected.purpose ||
      authorization.requiredCallerPermission !== expected.requiredCallerPermission) {
    throw new TypeError("Inventory command authorization contract mismatch");
  }

  const actor = {
    userId: userId(command.actor.userId),
    serviceName: string(command.actor.serviceName, "actor serviceName", 190, { empty: true }),
    claimedRoles: stringArray(command.actor.claimedRoles, "actor claimedRoles"),
    claimedPermissions: stringArray(command.actor.claimedPermissions, "actor claimedPermissions")
  };
  if (actor.userId === null && actor.serviceName.length === 0) {
    throw new TypeError("Inventory command actor requires userId or serviceName");
  }
  if (!actor.claimedPermissions.includes(expected.requiredCallerPermission)) {
    throw new TypeError("Inventory command actor lacks the required caller permission");
  }

  return {
    actor,
    authorization,
    source: {
      module: string(command.source.module, "source module", 40, { ascii: true }),
      documentType: string(command.source.documentType, "source documentType", 50, { ascii: true }),
      documentId: string(command.source.documentId, "source documentId", 100),
      lineId: string(
        Object.hasOwn(command.source, "lineId") ? command.source.lineId : "",
        "source lineId",
        100,
        { empty: true }
      ),
      eventId: string(command.source.eventId, "source eventId", 100)
    },
    correlationId: string(command.correlationId, "correlationId", 64, { empty: true, ascii: true }),
    payload: jsonValue(object(command.payload, "Inventory command payload"), "Inventory command payload")
  };
}

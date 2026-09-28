import {
  inventoryStringHasInvalidCharacters,
  isInventorySensitiveKey
} from "./inventorySafeJson.js";
import { INVENTORY_STOCK_STATUSES } from "./inventoryConstants.js";
import { inventoryError } from "./inventoryErrors.js";

const COMMAND_FIELDS = new Set(["actor", "authorization", "source", "correlationId", "payload"]);
const ACTOR_FIELDS = new Set(["userId", "serviceName", "claimedRoles", "claimedPermissions"]);
const AUTHORIZATION_FIELDS = new Set(["purpose", "requiredCallerPermission"]);
const SOURCE_FIELDS = new Set(["module", "documentType", "documentId", "lineId", "eventId"]);
const LOT_FIELDS = new Set(["trackingPolicy", "lotNumber", "expiryDate", "manufactureDate"]);
const TRACKING_POLICIES = new Set(["none", "batch", "batch_expiry", "serial"]);
const STOCK_STATUSES = new Set(INVENTORY_STOCK_STATUSES);

function quantityError(field) {
  return inventoryError("INVENTORY_QUANTITY_INVALID", { field });
}

function inventoryNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw quantityError(field);
  return value;
}

function dateOnly(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return milliseconds;
}

function optionalDateOnly(value, field) {
  if (value === undefined || value === null || value === "") return null;
  dateOnly(value, field);
  return value;
}

function lotNumber(value) {
  if (typeof value !== "string") throw inventoryError("LOT_REQUIRED");
  const normalized = value.trim();
  if (!normalized) throw inventoryError("LOT_REQUIRED");
  if ([...normalized].length > 100 || /[\p{Cc}]/u.test(normalized)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lotNumber" });
  }
  return normalized;
}

export function inventoryPositiveInteger(value, field = "quantity") {
  if (!Number.isSafeInteger(value) || value <= 0) throw quantityError(field);
  return value;
}

export function toBaseQuantity(quantity, factor) {
  const normalizedQuantity = inventoryPositiveInteger(quantity, "quantity");
  const normalizedFactor = inventoryPositiveInteger(factor, "factor");
  if (normalizedFactor > 1_000_000 || normalizedQuantity > Math.floor(Number.MAX_SAFE_INTEGER / normalizedFactor)) {
    throw quantityError("quantity");
  }
  return normalizedQuantity * normalizedFactor;
}

export function calculateInventoryAvailability({ eligibleOnHand, reserved }) {
  const eligible = inventoryNonNegativeInteger(eligibleOnHand, "eligibleOnHand");
  const outstanding = inventoryNonNegativeInteger(reserved, "reserved");
  const rawAtp = eligible - outstanding;
  return {
    eligibleOnHand: eligible,
    reserved: outstanding,
    rawAtp,
    atp: Math.max(rawAtp, 0),
    uncoveredReserved: Math.max(-rawAtp, 0)
  };
}

export function isInventoryLotExpired(expiryDate, currentLocalDate) {
  const current = dateOnly(currentLocalDate, "currentLocalDate");
  return expiryDate === null ? false : dateOnly(expiryDate, "expiryDate") < current;
}

export function meetsMinimumRemainingLife(expiryDate, currentLocalDate, minimumRemainingDays) {
  const current = dateOnly(currentLocalDate, "currentLocalDate");
  if (!Number.isSafeInteger(minimumRemainingDays) || minimumRemainingDays < 0) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "minimumRemainingDays" });
  }
  if (expiryDate === null) return true;
  if (minimumRemainingDays > Math.floor((Number.MAX_SAFE_INTEGER - current) / 86_400_000)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "minimumRemainingDays" });
  }
  const minimumExpiry = current + minimumRemainingDays * 86_400_000;
  return dateOnly(expiryDate, "expiryDate") >= minimumExpiry;
}

export function validateInventoryLotInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lot" });
  }
  for (const field of Object.keys(input)) {
    if (!LOT_FIELDS.has(field)) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  const trackingPolicy = input.trackingPolicy;
  if (!TRACKING_POLICIES.has(trackingPolicy)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "trackingPolicy" });
  }
  if (trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");

  const hasLotData = [input.lotNumber, input.expiryDate, input.manufactureDate]
    .some((value) => value !== undefined && value !== null && value !== "");
  if (trackingPolicy === "none") {
    if (hasLotData) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lot" });
    return { trackingPolicy, lotNumber: null, normalizedLotNumber: null, expiryDate: null, manufactureDate: null };
  }

  const normalizedLotNumber = lotNumber(input.lotNumber);
  const expiryDate = optionalDateOnly(input.expiryDate, "expiryDate");
  const manufactureDate = optionalDateOnly(input.manufactureDate, "manufactureDate");
  if (trackingPolicy === "batch_expiry" && expiryDate === null) throw inventoryError("EXPIRY_REQUIRED");
  if (expiryDate !== null && manufactureDate !== null && manufactureDate > expiryDate) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "manufactureDate" });
  }
  return {
    trackingPolicy,
    lotNumber: normalizedLotNumber,
    normalizedLotNumber,
    expiryDate,
    manufactureDate
  };
}

export function assertInventoryLotConsistency(existingLot, proposedLot) {
  for (const field of ["expiryDate", "manufactureDate"]) {
    const existing = optionalDateOnly(existingLot?.[field], field);
    const proposed = optionalDateOnly(proposedLot?.[field], field);
    if (existing !== proposed) throw inventoryError("LOT_DATA_CONFLICT", { field });
  }
  return {
    expiryDate: existingLot.expiryDate ?? null,
    manufactureDate: existingLot.manufactureDate ?? null
  };
}

export function validateInventoryStockStatus(status) {
  if (!STOCK_STATUSES.has(status)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "stockStatus" });
  return status;
}

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

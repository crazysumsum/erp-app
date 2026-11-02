const TABLES = Object.freeze([
  "fulfillments", "fulfillment_lines", "fulfillment_line_reservation_claims", "fulfillment_allocations",
  "fulfillment_status_history", "shipments", "shipment_lines", "shipment_issue_details",
  "shipment_status_history", "shipment_reversals", "shipment_reversal_details", "fulfillment_audit_logs"
]);
const PREPARE_KEYS = ["orderId", "archiveBatchId", "cutoffMs"];
const MANIFEST_KEYS = ["version", ...PREPARE_KEYS, "tableCounts", "hashSummary"];
const COMMAND_KEYS = [...PREPARE_KEYS, "archivedAtMs", "expectedManifest"];

function invalid() { throw new TypeError("Invalid Fulfillment Archive contract"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
  }
}
function identity(value) {
  if (typeof value !== "string" || value.length > 16 || !/^[1-9][0-9]*$/u.test(value)
    || BigInt(value) > 9007199254740991n) invalid();
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) invalid();
}
function scope(value) {
  identity(value.orderId);
  identity(value.archiveBatchId);
  epoch(value.cutoffMs);
}

// Shape validation grants no transaction authority and proves no persisted Archive effect.
export function validateFulfillmentArchivePrepare(value) {
  exactKeys(value, PREPARE_KEYS);
  scope(value);
  return value;
}
export function validateFulfillmentArchiveManifest(value) {
  exactKeys(value, MANIFEST_KEYS);
  if (value.version !== "1") invalid();
  scope(value);
  exactKeys(value.tableCounts, TABLES);
  exactKeys(value.hashSummary, TABLES);
  for (const table of TABLES) {
    if (!Number.isSafeInteger(value.tableCounts[table]) || value.tableCounts[table] < 0) invalid();
    if (typeof value.hashSummary[table] !== "string" || !/^[0-9a-f]{64}$/u.test(value.hashSummary[table])) invalid();
  }
  return value;
}
export function validateFulfillmentArchiveCommand(value) {
  exactKeys(value, COMMAND_KEYS);
  scope(value);
  epoch(value.archivedAtMs);
  if (value.archivedAtMs < value.cutoffMs) invalid();
  validateFulfillmentArchiveManifest(value.expectedManifest);
  for (const key of PREPARE_KEYS) if (value[key] !== value.expectedManifest[key]) invalid();
  return value;
}

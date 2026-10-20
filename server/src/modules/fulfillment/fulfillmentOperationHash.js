import { createHash } from "node:crypto";
import { FULFILLMENT_OPERATION_TYPES } from "./fulfillmentConstants.js";

const IDS = new Set(["fulfillmentId", "shipmentId", "reversalId", "salesOrderId", "salesOrderLineId",
  "fulfillmentLineId", "claimId", "inventoryReservationId", "inventoryAllocationId", "inventoryBalanceId",
  "inventoryOperationId", "originalInventoryOperationId", "shipmentIssueId", "originalMovementId",
  "warehouseId", "skuId", "customerId", "shippingAddressId", "shippingContactId", "balanceId", "allocationId", "reservationId"]);
const QUANTITIES = new Set(["baseQuantity", "plannedBaseQuantity", "pickedBaseQuantity", "shortBaseQuantity",
  "allocatedBaseQuantity", "releasedBaseQuantity", "shippedBaseQuantity", "reversedBaseQuantity", "quantity"]);

function canonical(value, key, ancestors) {
  if (key === "shippingContactId" && value === null) return null;
  if (IDS.has(key) || QUANTITIES.has(key)) {
    if (typeof value === "number" && Number.isSafeInteger(value)) value = String(value);
    if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw new TypeError("Invalid Fulfillment decimal intent");
    const integer = BigInt(value);
    if (integer > BigInt(Number.MAX_SAFE_INTEGER) || (IDS.has(key) && integer === 0n)) throw new TypeError("Invalid Fulfillment decimal intent");
    return integer.toString();
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || ancestors.has(value) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("Fulfillment intent must contain JSON values only");
  ancestors.add(value);
  const result = Array.isArray(value)
    ? Array.from(value, entry => canonical(entry, "", ancestors))
    : Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name], name, ancestors)]));
  ancestors.delete(value);
  return result;
}

export function fulfillmentOperationHash({ operationType, target, payload }) {
  if (!FULFILLMENT_OPERATION_TYPES.includes(operationType)) throw new TypeError("Unknown Fulfillment operation type");
  const intent = canonical({ operationType, target, payload }, "", new Set());
  return createHash("sha256").update(JSON.stringify(intent), "utf8").digest("hex");
}

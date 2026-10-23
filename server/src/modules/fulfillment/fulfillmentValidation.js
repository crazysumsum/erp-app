import { fulfillmentError } from "./fulfillmentErrors.js";

export function fulfillmentInteger(value, { positive = true } = {}) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw fulfillmentError("FULFILLMENT_QUANTITY_INVALID");
  }
  const integer = BigInt(value);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER) || (positive && integer === 0n)) {
    throw fulfillmentError("FULFILLMENT_QUANTITY_INVALID");
  }
  return integer;
}

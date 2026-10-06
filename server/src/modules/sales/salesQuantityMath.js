import { formatSalesDecimal, parseSalesDecimal } from "./salesMoneyMath.js";
import { salesError } from "./salesErrors.js";

export function quantityUnits(value) {
  const units = parseSalesDecimal(value, 6, 14, "SALES_QUANTITY_INVALID");
  if (units === 0n) throw salesError("SALES_QUANTITY_INVALID");
  return units;
}

export function normalizeQuantity(value) { return formatSalesDecimal(quantityUnits(value), 6); }

export function orderedBaseQuantity(quantity, toBaseFactor) {
  if (!Number.isInteger(toBaseFactor) || toBaseFactor < 1 || toBaseFactor > 1000000) throw salesError("SALES_UOM_CONVERSION_INVALID");
  const base = quantityUnits(quantity) * BigInt(toBaseFactor);
  if (base % 1000000n !== 0n || base / 1000000n > BigInt(Number.MAX_SAFE_INTEGER)) throw salesError("SALES_UOM_CONVERSION_INVALID");
  return Number(base / 1000000n);
}

export function assertBaseQuantity(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw salesError("SALES_QUANTITY_INVALID");
  return BigInt(value);
}

export function assertQuantityConservation(projection) {
  const ordered = assertBaseQuantity(projection.orderedBaseQuantity);
  const parts = [projection.fulfilledBaseQuantity, projection.reservedOutstandingBaseQuantity,
    projection.backorderedBaseQuantity, projection.cancelledBaseQuantity].map(assertBaseQuantity);
  if (ordered !== parts.reduce((total, value) => total + value, 0n)) throw salesError("SALES_QUANTITY_INVALID");
  return true;
}

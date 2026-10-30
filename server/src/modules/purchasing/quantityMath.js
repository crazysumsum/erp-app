import { MAX_TO_BASE_FACTOR, QUANTITY_INTEGER_DIGITS, QUANTITY_SCALE } from "./purchasingConstants.js";
import { purchasingError } from "./purchasingErrors.js";

// 只為擋住超長字串去到 BigInt；數值上限另外按整數位數驗。
const MAX_INPUT_LENGTH = 64;

/**
 * Decimal string → 縮放整數，全程唔經 Number。容許 leading zeros；拒絕正負號、指數、空白、
 * 只有小數點一邊，同埋超過 scale 嘅小數（唔會偷偷 round）。
 */
export function parseScaledDecimal(value, scale, integerDigits, code) {
  if (typeof value !== "string" || value.length > MAX_INPUT_LENGTH || !/^\d+(?:\.\d+)?$/u.test(value)) {
    throw purchasingError(code);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) throw purchasingError(code);
  const units = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
  if (units >= 10n ** BigInt(integerDigits + scale)) throw purchasingError(code);
  return units;
}

export function formatScaledDecimal(units, scale) {
  const digits = units.toString().padStart(scale + 1, "0");
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}

/** Ordered／Received Quantity：正數、最多 6 位小數（BR-010）。 */
export function parseQuantity(value) {
  const units = parseScaledDecimal(value, QUANTITY_SCALE, QUANTITY_INTEGER_DIGITS, "PURCHASING_QUANTITY_INVALID");
  if (units === 0n) throw purchasingError("PURCHASING_QUANTITY_INVALID");
  return units;
}

export function normalizeQuantity(value) {
  return formatScaledDecimal(parseQuantity(value), QUANTITY_SCALE);
}

/** quantity × toBaseFactor 一定要精確係正整數 Base，而且唔超上限（BR-009、BR-010）。 */
export function toBaseQuantity(quantity, toBaseFactor, { maxBaseQuantity = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(maxBaseQuantity) || maxBaseQuantity < 1) {
    throw new TypeError("maxBaseQuantity must be a positive safe integer");
  }
  const units = parseQuantity(quantity);
  if (!Number.isSafeInteger(toBaseFactor) || toBaseFactor < 1 || toBaseFactor > MAX_TO_BASE_FACTOR) {
    throw purchasingError("UOM_CONVERSION_INVALID");
  }
  const scaled = units * BigInt(toBaseFactor);
  const one = 10n ** BigInt(QUANTITY_SCALE);
  if (scaled % one !== 0n) throw purchasingError("UOM_CONVERSION_INVALID");
  const base = scaled / one;
  if (base > BigInt(maxBaseQuantity)) throw purchasingError("PURCHASING_QUANTITY_INVALID");
  return Number(base);
}

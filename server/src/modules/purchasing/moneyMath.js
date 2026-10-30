import {
  AMOUNT_INTEGER_DIGITS, MAX_CURRENCY_DECIMAL_PLACES, QUANTITY_SCALE, UNIT_PRICE_INTEGER_DIGITS, UNIT_PRICE_SCALE
} from "./purchasingConstants.js";
import { purchasingError } from "./purchasingErrors.js";
import { formatScaledDecimal, parseQuantity, parseScaledDecimal } from "./quantityMath.js";

// Currency 小數位嚟自已驗證嘅 Business Master 快照（TASK-008 釘住 0～4）；超出即係資料錯誤，唔係用戶輸入。
function currencyPlaces(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CURRENCY_DECIMAL_PLACES) {
    throw new TypeError("Currency decimal places must be an integer from 0 to 4");
  }
  return value;
}

// DECIMAL(25,4) 容得落嘅整數位數；以 Currency scale 嘅縮放整數表示。
const amountLimit = (places) => 10n ** BigInt(AMOUNT_INTEGER_DIGITS + places);

function parseUnitPrice(value) {
  return parseScaledDecimal(value, UNIT_PRICE_SCALE, UNIT_PRICE_INTEGER_DIGITS, "UNIT_PRICE_INVALID");
}

/** Unit Price：非負、最多 4 位小數。零價要原因係 validation 嘅事（BR-011），唔喺呢度。 */
export function normalizeUnitPrice(value) {
  return formatScaledDecimal(parseUnitPrice(value), UNIT_PRICE_SCALE);
}

/** API、CSV 同 print 共用嘅唯一金額 formatter：固定 Currency scale（§2.8）。 */
export function formatAmount(units, currencyDecimalPlaces) {
  const places = currencyPlaces(currencyDecimalPlaces);
  if (typeof units !== "bigint" || units < 0n) throw new TypeError("Amount must be a non-negative BigInt");
  return formatScaledDecimal(units, places);
}

/** roundHalfUp(orderedQuantity × unitPrice, Currency 小數位)；兩個因子都非負，HALF_UP 即係加一半再截斷。 */
export function lineAmount(orderedQuantity, unitPrice, currencyDecimalPlaces) {
  const places = currencyPlaces(currencyDecimalPlaces);
  const product = parseQuantity(orderedQuantity) * parseUnitPrice(unitPrice);
  const divisor = 10n ** BigInt(QUANTITY_SCALE + UNIT_PRICE_SCALE - places);
  const units = (product + divisor / 2n) / divisor;
  // §5.7 冇金額溢位專用碼；數量同單價各自合法，所以唔報佢哋任何一個欄位。
  if (units >= amountLimit(places)) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "lineAmount" });
  return formatAmount(units, places);
}

/** PO Total = 已 round Line Amount 之和，唔係加總後先 round（§2.8）。只收 lineAmount 嘅輸出。 */
export function documentTotal(lineAmounts, currencyDecimalPlaces) {
  const places = currencyPlaces(currencyDecimalPlaces);
  if (!Array.isArray(lineAmounts)) throw new TypeError("Line amounts must be an array");
  const fixedScale = places ? new RegExp(`^\\d+\\.\\d{${places}}$`, "u") : /^\d+$/u;
  let total = 0n;
  for (const amount of lineAmounts) {
    if (typeof amount !== "string" || !fixedScale.test(amount)) {
      throw new TypeError("Line amount must be a fixed-scale amount string");
    }
    total += BigInt(amount.replace(".", ""));
  }
  if (total >= amountLimit(places)) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "totalAmount" });
  return formatAmount(total, places);
}

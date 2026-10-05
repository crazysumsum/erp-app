import { salesError } from "./salesErrors.js";

// Scaled integers are shared by the two actual decimal domains; values never pass through Number.
export function parseSalesDecimal(value, scale, integerDigits, code) {
  if (typeof value !== "string" || value.trim() !== value || !new RegExp(`^\\d{1,${integerDigits}}(?:\\.\\d{1,${scale}})?$`, "u").test(value)) throw salesError(code);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
}

export function formatSalesDecimal(value, scale) {
  const digits = value.toString().padStart(scale + 1, "0");
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}

function moneyValue(value) { return parseSalesDecimal(value, 4, 15, "SALES_PRICE_INVALID"); }
function boundedMoney(value) {
  if (value < 0n || value >= 10n ** 19n) throw salesError("SALES_PRICE_INVALID");
  return formatSalesDecimal(value, 4);
}

export function normalizeMoney(value) { return boundedMoney(moneyValue(value)); }

export function lineAmount(quantity, unitSellingPrice) {
  const units = parseSalesDecimal(quantity, 6, 14, "SALES_QUANTITY_INVALID");
  if (units === 0n) throw salesError("SALES_QUANTITY_INVALID");
  return boundedMoney((units * moneyValue(unitSellingPrice) + 500000n) / 1000000n);
}

export function documentTotal(amounts) {
  return boundedMoney(amounts.reduce((total, amount) => total + moneyValue(amount), 0n));
}

export function displayMoney(value, decimalPlaces) {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4) throw salesError("SALES_PRICE_INVALID");
  const divisor = 10n ** BigInt(4 - decimalPlaces);
  return formatSalesDecimal((moneyValue(value) + divisor / 2n) / divisor, decimalPlaces);
}

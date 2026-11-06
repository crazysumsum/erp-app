// 同 server 嘅 moneyMath／quantityMath 一樣嘅算法，全程唔經 Number；只係預覽，保存後以 server 值為準（§7.3）。
export const validQuantity = (value) => typeof value === "string" && /^\d{1,14}(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
export const validPrice = (value) => typeof value === "string" && /^\d{1,15}(?:\.\d{1,4})?$/.test(value);
export const isZeroPrice = (value) => validPrice(value) && !/[1-9]/.test(value);

function scaled(value, scale) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
}
function format(units, places) {
  const digits = units.toString().padStart(places + 1, "0");
  return places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
}

/** roundHalfUp(數量 × 單價, Currency 小數位)；輸入未完整就回 null。 */
export function previewLineAmount(quantity, price, places) {
  if (!validQuantity(quantity) || !validPrice(price) || !Number.isInteger(places)) return null;
  const divisor = 10n ** BigInt(10 - places);
  return format((scaled(quantity, 6) * scaled(price, 4) + divisor / 2n) / divisor, places);
}

/** Total＝已 round Line Amount 之和（§2.8）；有一行未完整就回 null，唔顯示一個睇落完整嘅數。 */
export function previewTotal(amounts, places) {
  if (!amounts.length || amounts.includes(null)) return null;
  return format(amounts.reduce((sum, amount) => sum + BigInt(amount.replace(".", "")), 0n), places);
}

/** 數量 × factor 一定要係整數 Base；唔係就回 null（server 會回 UOM_CONVERSION_INVALID）。 */
export function previewBaseQuantity(quantity, factor) {
  if (!validQuantity(quantity)) return null;
  const units = scaled(quantity, 6) * BigInt(factor);
  return units % 1000000n === 0n ? (units / 1000000n).toString() : null;
}

const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, fields) => plain(value) && Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const projectedNumbers = new WeakMap();

export function stocktakeConflict(error, projectedError) {
  if (error?.status !== 409 || error.code !== "STOCKTAKE_STATE_CONFLICT") return null;
  let number = projectedNumbers.get(error);
  if (!number) {
    if (!exact(error.details, ["stocktakeConflict"])) return null;
    const reference = error.details.stocktakeConflict;
    if (!exact(reference, ["kind", "number"]) || reference.kind !== "SCOPE_OVERLAP" ||
      typeof reference.number !== "string" || reference.number.length > 19 ||
      !/^ST-[1-9][0-9]*$/u.test(reference.number) || !Number.isSafeInteger(Number(reference.number.slice(3)))) return null;
    number = reference.number;
  }
  projectedNumbers.set(projectedError, number);
  return `所選庫位已屬於另一張未完成盤點（其中一張：${number}）。請到盤點管理查詢；由具權限人員處理原單或改選範圍，再重新準備。未自動重送。`;
}

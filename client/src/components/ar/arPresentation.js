export const invoiceStatusLabels = Object.freeze({ DRAFT: "草稿", CONFIRMED: "已確認", VOID: "已作廢", CANCELLED: "已取消" });
export const statusColors = Object.freeze({ DRAFT: "grey", CONFIRMED: "primary", VOID: "negative", CANCELLED: "negative" });
export const receiptStatusLabels = Object.freeze({ DRAFT: "草稿", CONFIRMED: "已確認", CANCELLED: "已取消", VOID: "已作廢" });
export const paymentMethodLabels = Object.freeze({ BANK_TRANSFER: "銀行轉帳", CHEQUE: "支票", CASH: "現金", OTHER: "其他" });
export const allocationStatusLabels = Object.freeze({ ACTIVE: "有效", UNAPPLIED: "已解除" });

/**
 * Server 金額固定 4 位小數字串。按幣別小數位顯示，但只去走全零嘅尾數：
 * lineAmount 可以有真 4 位小數，唔可以四捨五入改咗佢（契約：行金額照 server 顯示）。
 */
export function money(value, decimalPlaces) {
  const [whole, fraction = ""] = String(value).split(".");
  const keep = fraction.slice(0, decimalPlaces), rest = fraction.slice(decimalPlaces);
  const shown = /^0*$/u.test(rest) ? keep : fraction;
  return shown ? `${whole}.${shown}` : whole;
}

/** quantity 係基本單位，unitPrice 係每銷售單位；整除先顯示銷售單位，否則顯示基本單位並註明單價單位。唔自己乘。 */
export function quantityText({ quantity, toBaseFactor, baseUomCode, salesUomCode, unitPrice }) {
  if (/^\d+$/u.test(quantity) && BigInt(toBaseFactor) > 0n && BigInt(quantity) % BigInt(toBaseFactor) === 0n) {
    return `${BigInt(quantity) / BigInt(toBaseFactor)} ${salesUomCode} × ${unitPrice}`;
  }
  return `${quantity} ${baseUomCode}（單價 ${unitPrice} 為每 ${salesUomCode}）`;
}

/** 香港今日（YYYY-MM-DD）：業務日期唔可以喺未來，預設值要用業務時區。 */
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(now);
}

export function timestamp(value) {
  return value ? new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

/** 金額輸入：只收該幣別小數位內嘅非負十進制字串（契約：唔可以送 number，"10.005" 會被拒）。 */
export function amountInputValid(value, decimalPlaces) {
  const pattern = decimalPlaces > 0 ? new RegExp(`^(0|[1-9]\\d{0,13})(\\.\\d{1,${decimalPlaces}})?$`, "u") : /^(0|[1-9]\d{0,13})$/u;
  return pattern.test(value) && /[1-9]/u.test(value);
}

/** 金額字串 ↔ 萬分之一嘅 BigInt：核銷要加減比較，唔可以用浮點。 */
export function toUnits(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0").slice(0, 4));
}
export function fromUnits(units, decimalPlaces) {
  const text = `${units / 10000n}.${String(units % 10000n).padStart(4, "0")}`;
  return money(text, decimalPlaces);
}

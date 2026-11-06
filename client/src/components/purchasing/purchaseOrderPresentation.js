export const statusLabels = Object.freeze({ DRAFT: "草稿", PENDING_APPROVAL: "待審批", CONFIRMED: "已確認", PARTIALLY_RECEIVED: "部分收貨", FULLY_RECEIVED: "已全部收貨", CLOSED: "已結案", CANCELLED: "已取消" });
export const statusColors = Object.freeze({ DRAFT: "grey", PENDING_APPROVAL: "warning", CONFIRMED: "primary", PARTIALLY_RECEIVED: "primary", FULLY_RECEIVED: "positive", CLOSED: "positive", CANCELLED: "negative" });
export const riskLabels = Object.freeze({
  OVERDUE: { icon: "schedule", label: "逾期" }, OVER_RECEIVED: { icon: "warning", label: "超收" },
  ZERO_PRICE: { icon: "money_off", label: "零價" }, INACTIVE_MASTER: { icon: "report", label: "主資料非 Active" }
});
const copyFieldLabels = Object.freeze({ paymentTermId: "付款條款", defaultReceivingWarehouseId: "預設收貨倉", orderingAddressId: "訂購地址", expectedDeliveryDate: "預計交貨日", buyerId: "採購員" });

/** §7.8：正式版本只限呢幾個狀態；Draft 只可以印水印版；其他唔准印。 */
export function printKind(status) {
  if (status === "DRAFT") return "draft";
  return ["CONFIRMED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED"].includes(status) ? "formal" : null;
}
export function addressText(address) {
  return address ? [address.addressLine1, address.addressLine2, address.addressLine3, address.city, address.stateRegion, address.postalCode, address.countryCode].filter(Boolean).join(", ") : "未設定";
}
export function warningText({ code, field, lineNumber }) {
  if (code === "SUPPLIER_NOT_PURCHASABLE") return "供應商目前不可採購；提交前請更換或恢復供應商。";
  if (code === "SKU_NOT_PURCHASABLE") return `第 ${lineNumber} 行的貨品目前不可採購；提交前請修正。`;
  if (code === "COPY_LINE_DROPPED") return `來源第 ${lineNumber} 行已不可採購，未有複製。`;
  return `${lineNumber ? `第 ${lineNumber} 行` : ""}${copyFieldLabels[field] ?? field}已不適用，已清除或改用目前值。`;
}
export function timestamp(value) {
  return new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

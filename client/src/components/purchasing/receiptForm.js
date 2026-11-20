// 收貨表單同 API body 之間嘅轉換（設計 §5.3：完整 replace，detail 唔帶 id）。
let next = 0;
const key = () => { next += 1; return `detail-${Date.now()}-${next}`; };

export function newDetail(poLine, warehouseId = null) {
  return { key: key(), inputUomId: poLine.purchaseUomId, receivedQuantity: "", warehouseId, binId: null, lotNumber: "",
    expiryDate: null, manufactureDate: null, stockStatus: "AVAILABLE", expiryOverrideReason: "" };
}

export function newLine(poLine, warehouseId = null) {
  return { purchaseOrderLineId: poLine.id, overReceiptReason: "", skuExceptionReason: "", details: [newDetail(poLine, warehouseId)] };
}

/** GR detail（GET）→ 表單。 */
export function toForm(document) {
  return {
    businessReceiptDate: document.businessReceiptDate, supplierDeliveryNote: document.supplierDeliveryNote ?? "", notes: document.notes ?? "",
    supplierExceptionReason: document.supplierExceptionReason ?? "",
    lines: (document.lines ?? []).map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, overReceiptReason: line.overReceiptReason ?? "",
      skuExceptionReason: line.skuExceptionReason ?? "", details: line.details.map((detail) => ({ key: key(), inputUomId: detail.inputUomId,
        receivedQuantity: detail.receivedQuantity, warehouseId: detail.warehouseId, binId: detail.binId, lotNumber: detail.lotNumber ?? "",
        expiryDate: detail.expiryDate, manufactureDate: detail.manufactureDate, stockStatus: detail.stockStatus, expiryOverrideReason: detail.expiryOverrideReason ?? "" })) }))
  };
}

const optional = (value) => (value === "" || value === null || value === undefined ? undefined : value);
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

/** 表單 → update／confirm body（唔含 eventId；由 command owner 加）。空字串嘅選填欄位唔送。 */
export function toPayload(form, version) {
  return compact({
    version, businessReceiptDate: form.businessReceiptDate, supplierDeliveryNote: optional(form.supplierDeliveryNote), notes: optional(form.notes),
    supplierExceptionReason: optional(form.supplierExceptionReason),
    lines: form.lines.map((line) => compact({ purchaseOrderLineId: line.purchaseOrderLineId, overReceiptReason: optional(line.overReceiptReason),
      skuExceptionReason: optional(line.skuExceptionReason),
      details: line.details.map((detail) => compact({ inputUomId: detail.inputUomId, receivedQuantity: String(detail.receivedQuantity ?? "").trim(),
        warehouseId: detail.warehouseId, binId: detail.binId, lotNumber: optional(detail.lotNumber), expiryDate: optional(detail.expiryDate),
        manufactureDate: optional(detail.manufactureDate), stockStatus: detail.stockStatus, expiryOverrideReason: optional(detail.expiryOverrideReason) })) }))
  });
}

/** Purchasing 嘅 `details.field`（例如 lines.0.details.1.binId）轉做 FormPanel 嘅欄位錯誤格式（同 PurchaseOrderForm 一樣）。 */
export function withFieldDetails(error) {
  if (Array.isArray(error?.details) || !error?.details?.field) return error;
  return Object.assign(error, { details: [{ location: "body", path: `/${error.details.field.replaceAll(".", "/")}`, message: error.message }] });
}

import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { normalizeUnitPrice } from "./moneyMath.js";
import { purchasingError } from "./purchasingErrors.js";
import {
  eventId, lineNote, localDate, notes, onlyFields, positiveId, reason, reference, requireItems
} from "./purchasingValidation.js";
import { normalizeQuantity } from "./quantityMath.js";

const HEADER = ["eventId", "supplierId", "orderingAddressId", "currencyCode", "paymentTermId", "orderDate", "expectedDeliveryDate",
  "defaultReceivingWarehouseId", "buyerId", "supplierReference", "notes", "lines"];
const LINE = ["skuId", "purchaseSkuUomId", "orderedQuantity", "unitPrice", "zeroPriceReason", "expectedDeliveryDate", "lineNote"];
const ZERO_PRICE = "0.0000";

const optionalId = (value, field) => value === undefined || value === null ? null : positiveId(value, field);

/** 交期唔可以早過 Order Date（需求 §248）；YYYY-MM-DD 可以直接比字串。 */
function deliveryDate(value, orderDate, field) {
  if (value === undefined || value === null) return null;
  if (localDate(value, field) < orderDate) throw purchasingError("PURCHASING_INPUT_INVALID", { field });
  return value;
}

/** 數量／單價嘅錯誤碼本身冇欄位；多 Line 時要話俾 UI 知係邊一行。 */
function atField(field, normalize) {
  try { return normalize(); }
  catch (error) {
    if (error instanceof ApplicationError && !error.publicDetails?.field) throw purchasingError(error.code, { field });
    throw error;
  }
}

function line(value, index, orderDate, update) {
  const field = (name) => `lines.${index}.${name}`;
  const input = onlyFields(value, update ? ["id", ...LINE] : LINE, `lines.${index}`);
  const unitPrice = atField(field("unitPrice"), () => normalizeUnitPrice(input.unitPrice));
  let zeroPriceReason = "";
  if (unitPrice === ZERO_PRICE) {
    if (input.zeroPriceReason === undefined || input.zeroPriceReason === "") throw purchasingError("ZERO_PRICE_REASON_REQUIRED", { field: field("zeroPriceReason") });
    zeroPriceReason = reason(input.zeroPriceReason, field("zeroPriceReason"));
  } else if (input.zeroPriceReason !== undefined && input.zeroPriceReason !== "") {
    throw purchasingError("PURCHASING_INPUT_INVALID", { field: field("zeroPriceReason") });
  }
  return {
    id: optionalId(input.id, field("id")),
    skuId: positiveId(input.skuId, field("skuId")),
    purchaseSkuUomId: positiveId(input.purchaseSkuUomId, field("purchaseSkuUomId")),
    orderedQuantity: atField(field("orderedQuantity"), () => normalizeQuantity(input.orderedQuantity)),
    unitPrice,
    zeroPriceReason,
    expectedDeliveryDate: deliveryDate(input.expectedDeliveryDate, orderDate, field("expectedDeliveryDate")),
    lineNote: lineNote(input.lineNote, field("lineNote"))
  };
}

/**
 * PO Draft 完整 editable projection（設計 §3.1、§5.2）。純驗證、唔讀 DB：快照、factor、Base quantity、金額同 status
 * 唔喺 allowlist，所以 client 送嚟一定被拒絕。選填欄位省略即係清空——Update 係成份取代，唔係 patch。
 * Line `id` 只喺 Update 出現；佢係咪屬於呢張 PO 要等鎖咗 PO 先驗。
 */
export function draftProjection(value, { maxLines, update }) {
  const input = onlyFields(value, update ? ["version", ...HEADER] : HEADER, "body");
  const orderDate = localDate(input.orderDate, "orderDate");
  if (typeof input.currencyCode !== "string" || !/^[A-Z]{3}$/u.test(input.currencyCode)) {
    throw purchasingError("PURCHASING_INPUT_INVALID", { field: "currencyCode" });
  }
  const lines = requireItems(input.lines, maxLines, "lines").map((entry, index) => line(entry, index, orderDate, update));
  const seen = new Set();
  lines.forEach(({ id }, index) => {
    if (id !== null && seen.has(id)) throw purchasingError("PURCHASING_INPUT_INVALID", { field: `lines.${index}.id` });
    seen.add(id);
  });
  return {
    eventId: eventId(input.eventId),
    ...(update ? { version: positiveId(input.version, "version") } : {}),
    supplierId: positiveId(input.supplierId, "supplierId"),
    orderingAddressId: optionalId(input.orderingAddressId, "orderingAddressId"),
    currencyCode: input.currencyCode,
    paymentTermId: optionalId(input.paymentTermId, "paymentTermId"),
    orderDate,
    expectedDeliveryDate: deliveryDate(input.expectedDeliveryDate, orderDate, "expectedDeliveryDate"),
    defaultReceivingWarehouseId: optionalId(input.defaultReceivingWarehouseId, "defaultReceivingWarehouseId"),
    buyerId: positiveId(input.buyerId, "buyerId"),
    supplierReference: reference(input.supplierReference, "supplierReference"),
    notes: notes(input.notes, "notes"),
    lines
  };
}

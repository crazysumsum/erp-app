import { MAX_DOCUMENT_LINES } from "./salesConstants.js";
import { normalizeMoney } from "./salesMoneyMath.js";
import { normalizeQuantity, quantityUnits } from "./salesQuantityMath.js";
import { formatSalesDecimal } from "./salesMoneyMath.js";
import { salesError } from "./salesErrors.js";

function fields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw salesError("SALES_INPUT_INVALID");
}
function id(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw salesError("SALES_INPUT_INVALID", { field });
  return value;
}
function text(value, maximum, field) {
  if (typeof value !== "string" || [...value].length > maximum || [...value].some((character) => { const code = character.codePointAt(0); return code === 127 || code < 32 && ![9, 10, 13].includes(code); })) throw salesError("SALES_INPUT_INVALID", { field });
  return value;
}
export function salesReason(value) {
  if (typeof value !== "string") throw salesError("SALES_INPUT_INVALID", { field: "reason" });
  const reason = text(value.trim(), 500, "reason");
  if ([...reason].length < 5) throw salesError("SALES_INPUT_INVALID", { field: "reason" });
  return reason;
}

export function salesDate(value, field = "date") {
  const milliseconds = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? Date.parse(`${value}T00:00:00.000Z`) : NaN;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) throw salesError("SALES_DATE_INVALID", { field });
  return value;
}

export function mergeSalesLines(lines, { update = false } = {}) {
  if (!Array.isArray(lines) || !lines.length) throw salesError("SALES_INPUT_INVALID", { field: "lines" });
  const merged = new Map();
  const lineIds = new Set();
  for (const line of lines) {
    fields(line, ["skuId", "skuUomId", "quantity", "unitSellingPrice", "lineNote", ...(update ? ["id"] : [])]);
    id(line.skuId, "skuId"); id(line.skuUomId, "skuUomId");
    if (line.id !== undefined) {
      id(line.id, "id");
      if (lineIds.has(line.id)) throw salesError("SALES_INPUT_INVALID", { field: "id" });
      lineIds.add(line.id);
    }
    const normalized = { ...line, quantity: normalizeQuantity(line.quantity), unitSellingPrice: normalizeMoney(line.unitSellingPrice),
      lineNote: text(line.lineNote ?? "", 500, "lineNote") };
    const key = `${line.skuId}:${line.skuUomId}`;
    const previous = merged.get(key);
    if (previous) {
      if (previous.unitSellingPrice !== normalized.unitSellingPrice || previous.lineNote !== normalized.lineNote) throw salesError("SALES_LINE_MERGE_CONFLICT");
      previous.quantity = normalizeQuantity(formatSalesDecimal(quantityUnits(previous.quantity) + quantityUnits(normalized.quantity), 6));
    } else merged.set(key, normalized);
  }
  if (merged.size > MAX_DOCUMENT_LINES) throw salesError("SALES_INPUT_INVALID", { field: "lines" });
  return [...merged.values()];
}

export function validateSalesDocument(input, { kind = "order", update = false } = {}) {
  if (!["order", "quotation"].includes(kind)) throw new TypeError("Unknown Sales document kind");
  const quotation = kind === "quotation";
  fields(input, ["eventId", "customerId", "currencyCode", "paymentTermId", "notes", "lines", ...(update ? ["version"] : []),
    ...(quotation ? ["quotationDate", "validUntil", "externalReference"] : ["fulfillmentWarehouseId", "orderDate", "requestedDeliveryDate", "customerPoReference"])]);
  if (typeof input.eventId !== "string" || input.eventId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.eventId)) throw salesError("SALES_INPUT_INVALID", { field: "eventId" });
  id(input.customerId, "customerId");
  if (update) id(input.version, "version");
  if (input.paymentTermId !== undefined && input.paymentTermId !== null) id(input.paymentTermId, "paymentTermId");
  if (typeof input.currencyCode !== "string" || input.currencyCode.length !== 3 || !/^[A-Z]{3}$/u.test(input.currencyCode)) throw salesError("SALES_INPUT_INVALID", { field: "currencyCode" });
  const document = { ...input, notes: text(input.notes ?? "", 2000, "notes"), lines: mergeSalesLines(input.lines, { update }) };
  const dateField = quotation ? "quotationDate" : "orderDate";
  const laterField = quotation ? "validUntil" : "requestedDeliveryDate";
  salesDate(input[dateField], dateField);
  if (quotation || input[laterField] !== undefined && input[laterField] !== null) {
    if (salesDate(input[laterField], laterField) < input[dateField]) throw salesError("SALES_DATE_INVALID", { field: laterField });
  }
  if (!quotation) id(input.fulfillmentWarehouseId, "fulfillmentWarehouseId");
  const reference = quotation ? "externalReference" : "customerPoReference";
  document[reference] = text(input[reference] ?? "", 190, reference);
  return { document, warnings: document.lines.flatMap((line, index) => line.unitSellingPrice === "0.0000"
    ? [{ code: "ZERO_PRICE", field: `lines[${index}].unitSellingPrice` }] : []) };
}

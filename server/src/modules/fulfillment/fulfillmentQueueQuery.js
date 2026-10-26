import { createHash } from "node:crypto";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";

const filters = ["q", "customerId", "warehouseId", "salesOrderStatus", "hasBackorder", "hasActiveWork", "requestedDateFrom", "requestedDateTo"];
const fields = [...filters, "sortBy", "descending", "page", "pageSize", "cursor"];
const invalid = () => { throw fulfillmentError("FULFILLMENT_INPUT_INVALID"); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
function date(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/u.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function position(value) {
  if (!exact(value, ["requestedDeliveryDate", "orderDate", "salesOrderNumber", "id"])) invalid();
  if (value.requestedDeliveryDate !== null) date(value.requestedDeliveryDate);
  date(value.orderDate);
  if (typeof value.salesOrderNumber !== "string" || !value.salesOrderNumber || value.salesOrderNumber.length > 190 || typeof value.id !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value.id) || BigInt(value.id) > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return { requestedDeliveryDate: value.requestedDeliveryDate, orderDate: value.orderDate, salesOrderNumber: value.salesOrderNumber, id: value.id };
}
function binding(query) {
  const selected = Object.fromEntries([...filters, "sortBy", "descending", "pageSize"].filter(key => query[key] !== undefined).map(key => [key, query[key]]));
  return createHash("sha256").update(JSON.stringify(selected)).digest("hex");
}
// Cursor is a bounded seek position, never authorization or an SQL fragment.
export function normalizeFulfillmentQueueQuery(input = {}) {
  if (!object(input) || Object.keys(input).some(key => !fields.includes(key))) invalid();
  const query = { ...input, page: input.page === undefined ? 1 : input.page, pageSize: input.pageSize === undefined ? 20 : input.pageSize, sortBy: input.sortBy === undefined ? "requestedDeliveryDate" : input.sortBy, descending: input.descending === undefined ? false : input.descending };
  if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100 || !["requestedDeliveryDate", "orderDate", "salesOrderNumber"].includes(query.sortBy) || typeof query.descending !== "boolean") invalid();
  for (const key of ["customerId", "warehouseId"]) if (query[key] !== undefined && (!Number.isSafeInteger(query[key]) || query[key] < 1)) invalid();
  for (const key of ["hasBackorder", "hasActiveWork"]) if (query[key] !== undefined && typeof query[key] !== "boolean") invalid();
  if (query.salesOrderStatus !== undefined && !["CONFIRMED", "PARTIALLY_FULFILLED"].includes(query.salesOrderStatus)) invalid();
  if (query.q !== undefined) {
    if (typeof query.q !== "string" || query.q.length > 190) invalid();
    query.q = query.q.trim();
    if (!query.q) delete query.q;
  }
  for (const key of ["requestedDateFrom", "requestedDateTo"]) if (query[key] !== undefined) date(query[key]);
  if (query.requestedDateFrom && query.requestedDateTo && query.requestedDateFrom > query.requestedDateTo) invalid();
  query.after = null;
  if (query.cursor !== undefined) {
    if (query.page === 1 || typeof query.cursor !== "string" || query.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(query.cursor)) invalid();
    let decoded;
    try {
      const bytes = Buffer.from(query.cursor, "base64url");
      if (bytes.toString("base64url") !== query.cursor) invalid();
      decoded = JSON.parse(bytes.toString("utf8"));
    } catch { invalid(); }
    if (!exact(decoded, ["version", "binding", "page", "after"]) || decoded.version !== 1 || decoded.binding !== binding(query) || decoded.page !== query.page) invalid();
    query.after = position(decoded.after);
  } else if (query.page !== 1) invalid();
  return query;
}
export function encodeFulfillmentQueueCursor(query, last) {
  if (!Number.isSafeInteger(query.page + 1)) invalid();
  return Buffer.from(JSON.stringify({ version: 1, binding: binding(query), page: query.page + 1, after: position(last) })).toString("base64url");
}
export function projectFulfillmentQueueLine(row) {
  for (const key of ["id", "sales_order_id", "sku_id"]) fulfillmentInteger(row[key]);
  if (!Number.isSafeInteger(row.line_no) || row.line_no < 1 || row.line_no > 100) throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
  const outstanding = fulfillmentInteger(row.inventory_outstanding, { positive: false });
  const sales = fulfillmentInteger(row.reserved_outstanding_base_quantity, { positive: false });
  const claimed = fulfillmentInteger(row.active_claimed, { positive: false });
  const ordered = fulfillmentInteger(row.ordered_base_quantity, { positive: false });
  const fulfilled = fulfillmentInteger(row.fulfilled_base_quantity, { positive: false });
  const backordered = fulfillmentInteger(row.backordered_base_quantity, { positive: false });
  if (sales !== outstanding || claimed > outstanding) throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
  return { id: row.id, salesOrderId: row.sales_order_id, lineNo: row.line_no, skuId: row.sku_id, skuCode: row.sku_code_snapshot, skuName: row.sku_name_snapshot,
    orderedBaseQuantity: ordered.toString(), reservedOutstandingBaseQuantity: outstanding.toString(), activeClaimedBaseQuantity: claimed.toString(), fulfillableBaseQuantity: (outstanding - claimed).toString(), backorderedBaseQuantity: backordered.toString(), fulfilledBaseQuantity: fulfilled.toString() };
}

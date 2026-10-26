import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { fulfillmentError } from "../../modules/fulfillment/fulfillmentErrors.js";
import { normalizeFulfillmentQueueQuery } from "../../modules/fulfillment/fulfillmentQueueQuery.js";
const id = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const stringId = { type: "string", pattern: "^[1-9][0-9]{0,15}$" };
const text = { type: "string" }, boolean = { type: "boolean" }, quantity = { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 18 };
const date = { type: "string", format: "date" };
const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const FULFILLMENT_QUEUE_EMPTY = object({});
const querySchema = { type: "object", additionalProperties: false, properties: {
  q: { type: "string", maxLength: 190 }, customerId: id, warehouseId: id,
  salesOrderStatus: { enum: ["CONFIRMED", "PARTIALLY_FULFILLED"] }, hasBackorder: boolean, hasActiveWork: boolean,
  requestedDateFrom: date, requestedDateTo: date, sortBy: { enum: ["requestedDeliveryDate", "orderDate", "salesOrderNumber"] }, descending: boolean,
  page: id, pageSize: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string", maxLength: 2048, pattern: "^[A-Za-z0-9_-]+$" }
} };
const validateQuery = new RequestValidator({ config: { enabled: true, allErrors: true, coerceTypes: true, useDefaults: false, removeAdditional: false, maxErrors: 20, includeErrorDetailsInResponse: false } }).compile({ query: querySchema }, "Fulfillment Queue");
export function fulfillmentQueueRequest(req) {
  const request = { query: structuredClone(req.input.query) };
  try { validateQuery(request); }
  catch (error) { if (error.code === "REQUEST_VALIDATION_FAILED") throw fulfillmentError("FULFILLMENT_INPUT_INVALID"); throw error; }
  // Validate semantic/cursor rules here, but pass only the original public query to the service.
  normalizeFulfillmentQueueQuery(request.input.query);
  return request.input.query;
}
const line = object({ id: stringId, salesOrderId: stringId, lineNo: { ...id, maximum: 100 }, skuId: stringId, skuCode: text, skuName: text,
  orderedBaseQuantity: quantity, reservedOutstandingBaseQuantity: quantity, activeClaimedBaseQuantity: quantity, fulfillableBaseQuantity: quantity, backorderedBaseQuantity: quantity, fulfilledBaseQuantity: quantity });
const header = object({ id: stringId, salesOrderNumber: text, salesOrderStatus: { enum: ["CONFIRMED", "PARTIALLY_FULFILLED"] }, version: { ...id, maximum: 4294967295 },
  customerId: stringId, customerCode: text, customerName: text, warehouseId: stringId, warehouseCode: text, warehouseName: text,
  orderDate: date, requestedDeliveryDate: { type: ["string", "null"], format: "date" }, updatedAt: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  hasBackorder: boolean, hasActiveWork: boolean, lines: { type: "array", minItems: 1, maxItems: 100, items: line } });
export const FULFILLMENT_QUEUE_RESPONSE = object({ items: { type: "array", maxItems: 100, items: header }, page: id, pageSize: { type: "integer", minimum: 1, maximum: 100 }, hasMore: boolean, nextCursor: { type: ["string", "null"], maxLength: 2048 } });

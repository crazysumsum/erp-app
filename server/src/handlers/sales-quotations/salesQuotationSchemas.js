import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { salesError } from "../../modules/sales/salesErrors.js";

export const EMPTY = { type: "object", properties: {}, additionalProperties: false };
const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
export const QUOTATION_ID_PARAMS = { type: "object", required: ["id"], properties: { id: ID }, additionalProperties: false };
const EVENT = { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" };
const QUANTITY = { type: "string", pattern: "^\\d{1,14}(?:\\.\\d{1,6})?$" }, MONEY = { type: "string", pattern: "^\\d{1,15}(?:\\.\\d{1,4})?$" };
const line = update => ({ type: "object", required: ["skuId", "skuUomId", "quantity", "unitSellingPrice"], additionalProperties: false,
  properties: { skuId: ID, skuUomId: ID, quantity: QUANTITY, unitSellingPrice: MONEY, lineNote: { type: "string", maxLength: 500 }, ...(update ? { id: ID } : {}) } });
const input = update => ({ type: "object", required: ["eventId", "customerId", "currencyCode", "quotationDate", "validUntil", "lines", ...(update ? ["version"] : [])],
  additionalProperties: false, properties: { eventId: EVENT, customerId: ID, currencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
    paymentTermId: { type: ["integer", "null"], minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, quotationDate: { type: "string", format: "date" },
    validUntil: { type: "string", format: "date" }, externalReference: { type: "string", maxLength: 190 }, notes: { type: "string", maxLength: 2000 },
    lines: { type: "array", minItems: 1, items: line(update) }, ...(update ? { version: ID } : {}) } });
export const QUOTATION_CREATE_INPUT = input(false), QUOTATION_UPDATE_INPUT = input(true);
// Framework coercion is appropriate for query IDs; financial body values must retain their original types.
const validator = new RequestValidator({ config: { enabled: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false,
  maxErrors: 20, includeErrorDetailsInResponse: false } });
const validateCreate = validator.compile({ body: QUOTATION_CREATE_INPUT }, "Sales Quotation create body");
const validateUpdate = validator.compile({ body: QUOTATION_UPDATE_INPUT }, "Sales Quotation update body");
export function validateQuotationInput(body, update = false) {
  try { (update ? validateUpdate : validateCreate)({ body }); }
  catch (error) { if (error.code === "REQUEST_VALIDATION_FAILED") throw salesError("SALES_INPUT_INVALID"); throw error; }
  return body;
}
const RESULT = { type: "object", required: ["id", "number", "status", "version"], additionalProperties: false,
  properties: { id: ID, number: { type: "string", pattern: "^QT-\\d{6}-\\d{6}$" }, status: { type: "string", enum: ["DRAFT", "ISSUED", "EXPIRED", "CANCELLED", "CONVERTED"] }, version: ID } };
const detailLine = { type: "object", additionalProperties: false, required: ["id", "lineNo", "skuId", "skuUomId", "quantity", "unitSellingPrice", "lineAmount"],
  properties: { id: ID, lineNo: ID, skuId: ID, skuUomId: ID, itemName: { type: "string" }, skuCode: { type: "string" }, skuName: { type: "string" },
    uomCode: { type: "string" }, uomName: { type: "string" }, toBaseFactor: ID, quantity: QUANTITY, baseQuantity: ID, unitSellingPrice: MONEY,
    priceSource: { type: "string", enum: ["SUGGESTED", "MANUAL"] }, lineAmount: MONEY, lineNote: { type: "string" } } };
export const QUOTATION_DETAIL = { type: "object", additionalProperties: false, required: ["id", "number", "status", "version", "lines", "totalAmount"],
  properties: { ...RESULT.properties, customerId: ID, customerCode: { type: "string" }, customerName: { type: "string" }, currencyCode: { type: "string" },
    paymentTermId: { type: ["integer", "null"] }, paymentTermCode: { type: "string" }, paymentTermName: { type: "string" },
    quotationDate: { type: "string", format: "date" }, validUntil: { type: "string", format: "date" }, externalReference: { type: "string" }, notes: { type: "string" },
    lineCount: ID, totalAmount: MONEY, createdAt: { type: "integer" }, updatedAt: { type: "integer" }, lines: { type: "array", maxItems: 100, items: detailLine } } };
export const QUOTATION_COMMAND_RESPONSE = { type: "object", required: ["quotation", "operation", "warnings"], additionalProperties: false,
  properties: { quotation: QUOTATION_DETAIL, operation: RESULT, warnings: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["code", "field"], properties: { code: { type: "string" }, field: { type: "string" } } } } } };
export const SALES_WRITE_POLICY = { name: "hasPermission", options: { permissions: ["sales.view", "sales.mgmt"] } };
export function quotationActorClaims(req) {
  return { actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions };
}
export function quotationCommandRequest(req, update = false) {
  return { claims: quotationActorClaims(req),
    input: validateQuotationInput(req.input.body, update), trace: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ipAddress: req.ip ?? "" } };
}

const { eventId: _event, quotationDate: _date, validUntil: _until, externalReference: _reference, ...orderProperties } = QUOTATION_CREATE_INPUT.properties;
export const CONVERSION_ORDER_INPUT = { type: "object", additionalProperties: false, required: ["customerId", "currencyCode", "fulfillmentWarehouseId", "orderDate", "lines"],
  properties: { ...orderProperties, fulfillmentWarehouseId: ID, orderDate: { type: "string", format: "date" },
    requestedDeliveryDate: { type: ["string", "null"], format: "date" }, customerPoReference: { type: "string", maxLength: 190 } } };
export const QUOTATION_ISSUE_INPUT = { type: "object", additionalProperties: false, required: ["eventId", "version"], properties: { eventId: EVENT, version: ID } };
export const QUOTATION_CANCEL_INPUT = { ...QUOTATION_ISSUE_INPUT, required: ["eventId", "version", "reason"],
  properties: { ...QUOTATION_ISSUE_INPUT.properties, reason: { type: "string", minLength: 5, maxLength: 500 } } };
export const QUOTATION_CONVERT_INPUT = { ...QUOTATION_ISSUE_INPUT, required: ["eventId", "version", "order"],
  properties: { ...QUOTATION_ISSUE_INPUT.properties, order: CONVERSION_ORDER_INPUT } };
const lifecycleValidators = Object.fromEntries(Object.entries({ ISSUE: QUOTATION_ISSUE_INPUT, CANCEL: QUOTATION_CANCEL_INPUT, CONVERT: QUOTATION_CONVERT_INPUT })
  .map(([event, body]) => [event, validator.compile({ body }, `Sales Quotation ${event} body`)]));
export function quotationLifecycleRequest(req, event) {
  try { lifecycleValidators[event]({ body: req.input.body }); }
  catch (error) { if (error.code === "REQUEST_VALIDATION_FAILED") throw salesError("SALES_INPUT_INVALID"); throw error; }
  return { claims: quotationActorClaims(req), id: Number(req.input.params.id), input: req.input.body,
    trace: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ipAddress: req.ip ?? "" } };
}
const ORDER_RESULT = { ...RESULT, properties: { ...RESULT.properties, number: { type: "string", pattern: "^SO-\\d{6}-\\d{6}$" }, status: { const: "DRAFT" } } };
const differenceFields = { skuId: ID, skuUomId: ID, fromLineNo: ID, toLineNo: ID, beforeQuantity: QUANTITY, afterQuantity: QUANTITY, beforePrice: MONEY, afterPrice: MONEY };
const differenceGroup = fields => ({ type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: fields,
  properties: Object.fromEntries(fields.map(field => [field, differenceFields[field]])) } });
export const QUOTATION_DIFFERENCE = { type: "object", additionalProperties: false, required: ["added", "removed", "quantityChanged", "priceChanged"], properties: {
  added: differenceGroup(["skuId", "skuUomId", "toLineNo", "afterQuantity", "afterPrice"]), removed: differenceGroup(["skuId", "skuUomId", "fromLineNo", "beforeQuantity", "beforePrice"]),
  quantityChanged: differenceGroup(["skuId", "skuUomId", "fromLineNo", "toLineNo", "beforeQuantity", "afterQuantity"]), priceChanged: differenceGroup(["skuId", "skuUomId", "fromLineNo", "toLineNo", "beforePrice", "afterPrice"]) } };
export const QUOTATION_CONVERT_RESPONSE = { type: "object", additionalProperties: false, required: ["quotation", "salesOrder", "differenceSummary", "operation", "warnings"],
  properties: { ...QUOTATION_COMMAND_RESPONSE.properties, salesOrder: ORDER_RESULT, operation: ORDER_RESULT, differenceSummary: QUOTATION_DIFFERENCE } };

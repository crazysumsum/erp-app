import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { salesError } from "../../modules/sales/salesErrors.js";
export { EMPTY, quotationActorClaims as salesActorClaims } from "../sales-quotations/salesQuotationSchemas.js";
const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, STRING = { type: "string" };
const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const pagination = { page: ID, pageSize: { type: "integer", enum: [10, 20, 50, 100] }, q: { type: "string", maxLength: 190 } };
export const SALES_LOOKUP_QUERY = Object.fromEntries(["customers", "skus", "warehouses", "channels"].map(kind => [kind,
  { type: "object", additionalProperties: false, properties: { ...pagination, ...(kind === "skus" ? {
    barcode: { type: "string", maxLength: 190 }, currencyCode: { type: "string", pattern: "^[A-Z]{3}$" } } : {}) } }]));
const validator = new RequestValidator({ config: { enabled: true, allErrors: true, coerceTypes: true, useDefaults: false, removeAdditional: false,
  maxErrors: 20, includeErrorDetailsInResponse: false } });
const validators = Object.fromEntries(Object.entries(SALES_LOOKUP_QUERY).map(([kind, query]) => [kind, validator.compile({ query }, `Sales ${kind} lookup`)]));
export function salesLookupQuery(req, kind) {
  const request = { query: structuredClone(req.input.query) };
  try { validators[kind](request); }
  catch (error) { if (error.code === "REQUEST_VALIDATION_FAILED") throw salesError("SALES_INPUT_INVALID"); throw error; }
  return request.input.query;
}
const nullableId = { type: ["integer", "null"], minimum: 1 }, nullableString = { type: ["string", "null"] };
const credit = object({ configured: { type: "boolean" }, creditLimit: nullableString, currencyCode: nullableString, status: STRING, policyVersion: nullableId });
const customer = object({ customerId: ID, customerCode: STRING, legalName: STRING, displayName: STRING, defaultCurrencyCode: nullableString,
  defaultPaymentTermId: nullableId, status: { const: "active" }, version: ID, credit });
const uom = object({ skuUomId: ID, uomId: ID, uomCode: STRING, uomName: STRING, toBaseFactor: { ...ID, maximum: 1000000 }, isDefaultSale: { type: "boolean" }, isBase: { type: "boolean" } });
const sku = object({ skuId: ID, skuCode: STRING, skuName: STRING, itemId: ID, itemName: STRING, skuVersion: ID, itemVersion: ID,
  suggestedPrice: { anyOf: [{ type: "null" }, object({ amount: STRING, currency: STRING, taxBasis: STRING })] }, priceCurrencyMatches: { type: "boolean" },
  uoms: { type: "array", minItems: 1, items: uom } });
export const SALES_LOOKUP_RESPONSE = Object.fromEntries(Object.entries({ customers: customer, skus: sku, warehouses: object({ id: ID, code: STRING, name: STRING }),
  channels: object({ code: STRING, name: STRING }) }).map(([kind, item]) => [kind, object({ items: { type: "array", maxItems: 100, items: item },
  total: { type: "integer", minimum: 0 }, page: ID, pageSize: pagination.pageSize })]));

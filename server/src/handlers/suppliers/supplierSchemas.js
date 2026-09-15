import { SUPPLIER_STATUSES } from "../../modules/supplier/supplierConstants.js";

export const EMPTY_SUPPLIER_SCHEMA = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
export const SUPPLIER_MGMT_POLICY = Object.freeze([Object.freeze({ name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["supplier.mgmt"]) }) })]);
export const SUPPLIER_VIEW_POLICY = Object.freeze([Object.freeze({ name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["supplier.view"]) }) })]);

export const SUPPLIER_CREATE_SCHEMA = Object.freeze({
  type: "object",
  required: ["supplierCode", "supplierName", "defaultCurrencyCode"],
  additionalProperties: false,
  properties: {
    supplierCode: { type: "string", minLength: 1, maxLength: 64 },
    supplierName: { type: "string", minLength: 1, maxLength: 190 },
    displayName: { type: "string", maxLength: 190, default: "" },
    defaultCurrencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
    defaultCurrencyVersion: { type: "integer", minimum: 1 },
    defaultPaymentTermId: { type: ["integer", "null"], minimum: 1 },
    defaultPaymentTermVersion: { type: "integer", minimum: 1 },
    website: { type: "string", maxLength: 500, default: "" },
    generalPhone: { type: "string", maxLength: 50, default: "" },
    generalEmail: { type: "string", maxLength: 254, default: "" },
    notes: { type: "string", maxLength: 2000, default: "" },
    activate: { type: "boolean", default: false }
  }
});

const WARNING = Object.freeze({
  type: "object", additionalProperties: false, required: ["field", "code", "message"],
  properties: { field: { type: "string" }, code: { type: "string" }, message: { type: "string" } }
});
const DUPLICATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["supplierId", "supplierCode", "supplierName", "score", "exact", "warningOnly"],
  properties: {
    supplierId: { type: "integer" }, supplierCode: { type: "string" }, supplierName: { type: "string" },
    score: { type: "number" }, exact: { type: "boolean" }, warningOnly: { const: true }
  }
});
export const SUPPLIER_DETAIL_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "supplierCode", "supplierName", "displayName", "defaultCurrencyCode", "defaultPaymentTermId", "status", "version", "updatedAt", "website", "generalPhone", "generalEmail", "notes", "createdAt", "addresses", "contacts", "identifiers", "bankAccounts", "warnings", "duplicateCandidates"],
  properties: {
    id: { type: "integer" }, supplierCode: { type: "string" }, supplierName: { type: "string" }, displayName: { type: "string" },
    defaultCurrencyCode: { type: "string" }, defaultPaymentTermId: { type: ["integer", "null"] }, status: { type: "string", enum: [...SUPPLIER_STATUSES] },
    version: { type: "integer" }, updatedAt: { type: "integer" }, website: { type: "string" }, generalPhone: { type: "string" },
    generalEmail: { type: "string" }, notes: { type: "string" }, createdAt: { type: "integer" },
    addresses: { type: "array" }, contacts: { type: "array" }, identifiers: { type: "array" }, bankAccounts: { type: "array" },
    warnings: { type: "array", items: WARNING }, duplicateCandidates: { type: "array", items: DUPLICATE }
  }
});

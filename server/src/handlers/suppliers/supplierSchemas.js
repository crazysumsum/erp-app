import { SUPPLIER_STATUSES } from "../../modules/supplier/supplierConstants.js";

export const EMPTY_SUPPLIER_SCHEMA = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
export const SUPPLIER_MGMT_POLICY = Object.freeze([Object.freeze({ name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["supplier.mgmt"]) }) })]);
export const SUPPLIER_VIEW_POLICY = Object.freeze([Object.freeze({ name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["supplier.view"]) }) })]);

export const SUPPLIER_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});

export const SUPPLIER_LIST_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    q: { type: "string", maxLength: 190, default: "" },
    status: { type: "string", enum: [...SUPPLIER_STATUSES] },
    currencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
    paymentTermId: { type: "integer", minimum: 1 },
    updatedFrom: { type: "integer", minimum: 0 },
    updatedTo: { type: "integer", minimum: 0 },
    includeArchived: { type: "boolean", default: false },
    sortBy: { type: "string", enum: ["supplierCode", "supplierName", "status", "updatedAt"], default: "updatedAt" },
    descending: { type: "boolean", default: true }
  }
});

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
    activate: { type: "boolean", default: false },
    // 設定開啟時 activate 會開一個審批申請，所以 create 亦要收得到審批人同備註。
    // 之前冇呢兩個欄位，additionalProperties: false 會 400，令 policy ON 之下
    // 根本冇可能 create-with-activate。
    approverUserId: { type: "integer", minimum: 1 },
    requestNote: { type: "string", maxLength: 500 }
  }
});

export const SUPPLIER_UPDATE_SCHEMA = Object.freeze({
  type: "object",
  required: ["supplierName", "displayName", "defaultCurrencyCode", "defaultPaymentTermId", "website", "generalPhone", "generalEmail", "notes", "version"],
  additionalProperties: false,
  properties: {
    supplierName: { type: "string", minLength: 1, maxLength: 190 },
    displayName: { type: "string", maxLength: 190 },
    defaultCurrencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
    defaultCurrencyVersion: { type: "integer", minimum: 1 },
    defaultPaymentTermId: { type: ["integer", "null"], minimum: 1 },
    defaultPaymentTermVersion: { type: "integer", minimum: 1 },
    website: { type: "string", maxLength: 500 },
    generalPhone: { type: "string", maxLength: 50 },
    generalEmail: { type: "string", maxLength: 254 },
    notes: { type: "string", maxLength: 2000 },
    reason: { type: "string", maxLength: 500 },
    version: { type: "integer", minimum: 1 }
  }
});

export const SUPPLIER_CODE_CHANGE_SCHEMA = Object.freeze({
  type: "object",
  required: ["supplierCode", "reason", "password", "version"],
  additionalProperties: false,
  properties: {
    supplierCode: { type: "string", minLength: 1, maxLength: 64 },
    reason: { type: "string", minLength: 5, maxLength: 500 },
    password: { type: "string", minLength: 1, maxLength: 1024 },
    version: { type: "integer", minimum: 1 }
  }
});

export const SUPPLIER_ACTIVATE_SCHEMA = Object.freeze({
  type: "object",
  required: ["version"],
  additionalProperties: false,
  properties: {
    version: { type: "integer", minimum: 1 },
    approverUserId: { type: "integer", minimum: 1 },
    requestNote: { type: "string", maxLength: 500 }
  }
});

export const SUPPLIER_LIFECYCLE_SCHEMA = Object.freeze({
  type: "object",
  required: ["reason", "password", "version"],
  additionalProperties: false,
  properties: {
    reason: { type: "string", minLength: 5, maxLength: 500 },
    password: { type: "string", minLength: 1, maxLength: 1024 },
    version: { type: "integer", minimum: 1 }
  }
});

export const SUPPLIER_DELETE_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "integer", minimum: 1 } }
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
export const SUPPLIER_SUMMARY_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "supplierCode", "supplierName", "displayName", "defaultCurrencyCode", "defaultPaymentTermId", "primaryContactName", "status", "version", "updatedAt"],
  properties: {
    id: { type: "integer", minimum: 1 }, supplierCode: { type: "string" }, supplierName: { type: "string" },
    displayName: { type: "string" }, defaultCurrencyCode: { type: "string" }, defaultPaymentTermId: { type: ["integer", "null"] },
    primaryContactName: { type: "string" },
    status: { type: "string", enum: [...SUPPLIER_STATUSES] }, version: { type: "integer", minimum: 1 }, updatedAt: { type: "integer", minimum: 0 }
  }
});
export const SUPPLIER_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["items", "total", "page", "pageSize"],
  properties: {
    items: { type: "array", items: SUPPLIER_SUMMARY_SCHEMA }, total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }
  }
});
export const SUPPLIER_DETAIL_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "supplierCode", "supplierName", "displayName", "defaultCurrencyCode", "defaultPaymentTermId", "status", "version", "updatedAt", "website", "generalPhone", "generalEmail", "notes", "createdAt", "addresses", "contacts", "identifiers", "bankAccounts", "warnings"],
  properties: {
    id: { type: "integer" }, supplierCode: { type: "string" }, supplierName: { type: "string" }, displayName: { type: "string" },
    defaultCurrencyCode: { type: "string" }, defaultPaymentTermId: { type: ["integer", "null"] }, primaryContactName: { type: "string" },
    status: { type: "string", enum: [...SUPPLIER_STATUSES] },
    version: { type: "integer" }, updatedAt: { type: "integer" }, website: { type: "string" }, generalPhone: { type: "string" },
    generalEmail: { type: "string" }, notes: { type: "string" }, createdAt: { type: "integer" },
    addresses: { type: "array" }, contacts: { type: "array" }, identifiers: { type: "array" }, bankAccounts: { type: "array" },
    warnings: { type: "array", items: WARNING }, duplicateCandidates: { type: "array", items: DUPLICATE },
    // 設計 4.5 要求關鍵資料變更令原申請失效之後回 approvalInvalidated: true。
    approvalInvalidated: { type: "boolean" }
  }
});

export const SUPPLIER_DUPLICATE_CHECK_SCHEMA = Object.freeze({
  type: "object",
  required: ["supplierCode", "supplierName"],
  additionalProperties: false,
  properties: {
    supplierCode: { type: "string", minLength: 1, maxLength: 64 },
    supplierName: { type: "string", minLength: 1, maxLength: 190 }
  }
});

const CODE_CONFLICT = Object.freeze({
  type: ["object", "null"],
  required: ["supplierId", "supplierCode", "supplierName"],
  additionalProperties: false,
  properties: { supplierId: { type: "integer" }, supplierCode: { type: "string" }, supplierName: { type: "string" } }
});

export const SUPPLIER_DUPLICATE_RESPONSE_SCHEMA = Object.freeze({
  type: "object", required: ["codeConflict", "duplicateCandidates"], additionalProperties: false,
  properties: { codeConflict: CODE_CONFLICT, duplicateCandidates: { type: "array", maxItems: 10, items: DUPLICATE } }
});

export const SUPPLIER_COMPLETENESS_SCHEMA = Object.freeze({
  type: "object", required: ["supplierId", "issues", "warnings"], additionalProperties: false,
  properties: {
    supplierId: { type: "integer", minimum: 1 },
    issues: { type: "array", items: WARNING },
    warnings: { type: "array", items: WARNING }
  }
});

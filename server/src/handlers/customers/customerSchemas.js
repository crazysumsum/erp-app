export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

export const CUSTOMER_ID_PARAMS = Object.freeze({
  type: "object", required: ["id"], additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});

export const OPERATION_ID_PARAMS = Object.freeze({
  type: "object", required: ["operationId"], additionalProperties: false,
  properties: { operationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } }
});

const NULLABLE_ID = Object.freeze({ type: ["integer", "null"], minimum: 1 });
const NULLABLE_CURRENCY = Object.freeze({ type: ["string", "null"], pattern: "^[A-Z]{3}$" });
const TEXT = (maxLength) => Object.freeze({ type: "string", trim: true, maxLength });

export const CUSTOMER_ROOT_INPUT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["customerCode", "legalName"],
  properties: {
    customerCode: TEXT(64), legalName: TEXT(190), tradingName: TEXT(190),
    defaultCurrencyCode: NULLABLE_CURRENCY, defaultPaymentTermId: NULLABLE_ID,
    accountManagerUserId: NULLABLE_ID, categoryId: NULLABLE_ID, industryId: NULLABLE_ID,
    territoryId: NULLABLE_ID, website: TEXT(500), generalPhone: TEXT(50),
    generalEmail: TEXT(254), notes: TEXT(2000)
  }
});

export const CUSTOMER_UPDATE_INPUT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["legalName", "tradingName", "defaultCurrencyCode", "defaultPaymentTermId", "accountManagerUserId", "categoryId", "industryId", "territoryId", "website", "generalPhone", "generalEmail", "notes", "version", "reason"],
  properties: {
    legalName: TEXT(190), tradingName: TEXT(190), defaultCurrencyCode: NULLABLE_CURRENCY,
    defaultPaymentTermId: NULLABLE_ID, accountManagerUserId: NULLABLE_ID, categoryId: NULLABLE_ID,
    industryId: NULLABLE_ID, territoryId: NULLABLE_ID, website: TEXT(500), generalPhone: TEXT(50),
    generalEmail: TEXT(254), notes: TEXT(2000), version: { type: "integer", minimum: 1 },
    reason: { type: "string", trim: true, minLength: 5, maxLength: 500 }
  }
});

export const CUSTOMER_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    q: TEXT(190), page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", enum: [10, 20, 50, 100], default: 20 },
    sortBy: { type: "string", enum: ["code", "legalName", "status", "updatedAt"], default: "updatedAt" },
    descending: { type: "boolean", default: true }, status: { type: "string", enum: ["draft", "pending", "active", "suspended", "blocked", "archived"] }
  }
});

export const CUSTOMER_SUMMARY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "code", "legalName", "displayName", "generalPhone", "generalEmail", "defaultCurrencyCode", "defaultPaymentTermId", "accountManagerUserId", "categoryId", "industryId", "territoryId", "status", "version", "updatedAt"],
  properties: {
    id: { type: "integer", minimum: 1 }, code: { type: "string" }, legalName: { type: "string" },
    displayName: { type: "string" }, generalPhone: { type: "string" }, generalEmail: { type: "string" },
    defaultCurrencyCode: NULLABLE_CURRENCY, defaultPaymentTermId: NULLABLE_ID, accountManagerUserId: NULLABLE_ID,
    categoryId: NULLABLE_ID, industryId: NULLABLE_ID, territoryId: NULLABLE_ID,
    status: { type: "string" }, version: { type: "integer", minimum: 1 }, updatedAt: { type: "integer", minimum: 0 }
  }
});

export const CUSTOMER_DETAIL = Object.freeze({
  type: "object", additionalProperties: false,
  required: [...CUSTOMER_SUMMARY.required, "tradingName", "website", "notes", "everActivatedAt", "createdAt", "createdBy", "updatedBy"],
  properties: {
    ...CUSTOMER_SUMMARY.properties, tradingName: { type: "string" }, website: { type: "string" }, notes: { type: "string" },
    everActivatedAt: { type: ["integer", "null"], minimum: 0 }, createdAt: { type: "integer", minimum: 0 },
    createdBy: NULLABLE_ID, updatedBy: NULLABLE_ID
  }
});

export const OPERATION = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["operationId", "status", "resourceType", "resourceId", "resultVersion", "errorCode"],
  properties: {
    operationId: { type: "string" }, status: { type: "string", enum: ["processing", "succeeded", "failed", "unknown"] },
    resourceType: { type: ["string", "null"] }, resourceId: NULLABLE_ID,
    resultVersion: { type: ["integer", "null"], minimum: 1 }, errorCode: { type: ["string", "null"] }
  }
});

export const CUSTOMER_COMMAND_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["customer", "operation"],
  properties: { customer: { anyOf: [CUSTOMER_DETAIL, { type: "null" }] }, operation: OPERATION }
});

export const CUSTOMER_LIST_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
  properties: { items: { type: "array", items: CUSTOMER_SUMMARY }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 } }
});

export const DUPLICATE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["code", "legalName", "tradingName"],
  properties: { code: { type: "array", items: CUSTOMER_SUMMARY }, legalName: { type: "array", items: CUSTOMER_SUMMARY }, tradingName: { type: "array", items: CUSTOMER_SUMMARY } }
});

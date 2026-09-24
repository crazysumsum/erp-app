import { CUSTOMER_LIST_QUERY } from "../customers/customerSchemas.js";

const { page: _page, pageSize: _pageSize, ...FILTER_PROPERTIES } = CUSTOMER_LIST_QUERY.properties;
export const CUSTOMER_EXPORT_EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
export const CUSTOMER_EXPORT_ID_PARAMS = Object.freeze({
  type: "object", required: ["id"], additionalProperties: false,
  properties: { id: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }
});
export const CUSTOMER_EXPORT_CREATE_BODY = Object.freeze({
  type: "object", required: ["password", "filters"], additionalProperties: false,
  properties: {
    password: { type: "string", minLength: 1, maxLength: 1024 },
    filters: { type: "object", additionalProperties: false, properties: FILTER_PROPERTIES }
  }
});
export const CUSTOMER_EXPORT_JOB = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "filters", "status", "resultStorageStatus", "totalCount", "expiresAt", "lastErrorCode", "errorSummary", "createdBy", "createdAt", "updatedAt", "completedAt", "version"],
  properties: {
    id: { type: "integer", minimum: 1 }, filters: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["processing", "completed", "failed"] },
    resultStorageStatus: { type: "string", enum: ["processing", "active", "storage_error", "purged"] },
    totalCount: { type: "integer", minimum: 0 }, expiresAt: { type: ["integer", "null"], minimum: 0 },
    lastErrorCode: { type: "string" }, errorSummary: { type: "string" },
    createdBy: { type: ["integer", "null"], minimum: 1 }, createdAt: { type: "integer", minimum: 0 },
    updatedAt: { type: "integer", minimum: 0 }, completedAt: { type: ["integer", "null"], minimum: 0 },
    version: { type: "integer", minimum: 1 }
  }
});

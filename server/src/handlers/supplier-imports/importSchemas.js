import { IMPORT_JOB_STATUSES, IMPORT_ROW_STATUSES } from "../../modules/supplier/SupplierImportService.js";

export const SUPPLIER_IMPORT_EMPTY_SCHEMA = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

export const SUPPLIER_IMPORT_UPLOAD_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["mode"],
  additionalProperties: false,
  properties: { mode: { type: "string", enum: ["create_only", "upsert"] } }
});

export const SUPPLIER_IMPORT_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }
});

const PAGE = Object.freeze({ type: "integer", minimum: 1, maximum: 1_000_000, default: 1 });
const PAGE_SIZE = Object.freeze({ type: "integer", minimum: 1, maximum: 100, default: 20 });

export const SUPPLIER_IMPORT_LIST_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: { page: PAGE, pageSize: PAGE_SIZE, status: { type: "string", enum: [...IMPORT_JOB_STATUSES] } }
});

export const SUPPLIER_IMPORT_GET_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: { page: PAGE, pageSize: PAGE_SIZE, rowStatus: { type: "string", enum: [...IMPORT_ROW_STATUSES] } }
});

export const SUPPLIER_IMPORT_CANCEL_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["version"],
  additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 } }
});

const COUNT = Object.freeze({ type: "integer", minimum: 0 });
const NULLABLE_ID = Object.freeze({ type: ["integer", "null"], minimum: 1 });
const NULLABLE_EPOCH = Object.freeze({ type: ["integer", "null"], minimum: 0 });

/** 對外 job 摘要：冇檔名、SHA-256、lease 或路徑（IMP-003）。 */
export const SUPPLIER_IMPORT_JOB_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "templateVersion", "mode", "activationMode", "status", "totalCount", "validCount", "warningCount",
    "invalidCount", "appliedCount", "failedCount", "skippedCount", "lastErrorCode", "errorSummary", "filesPurged",
    "createdAt", "updatedAt", "confirmedAt", "completedAt", "version"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    templateVersion: { type: "string" },
    mode: { type: "string", enum: ["create_only", "upsert"] },
    activationMode: { type: ["string", "null"], enum: ["draft", "activate", null] },
    status: { type: "string", enum: [...IMPORT_JOB_STATUSES] },
    totalCount: COUNT,
    validCount: COUNT,
    warningCount: COUNT,
    invalidCount: COUNT,
    appliedCount: COUNT,
    failedCount: COUNT,
    skippedCount: COUNT,
    lastErrorCode: { type: "string" },
    errorSummary: { type: "string" },
    filesPurged: { type: "boolean" },
    createdAt: { type: "integer" },
    updatedAt: { type: "integer" },
    confirmedAt: NULLABLE_EPOCH,
    completedAt: NULLABLE_EPOCH,
    version: { type: "integer", minimum: 1 }
  }
});

// 執行失敗嘅錯誤（T45 rowError）冇 field，只有 code 同 message。
const ISSUE = Object.freeze({
  type: "object",
  required: ["code", "message"],
  additionalProperties: false,
  properties: { field: { type: "string" }, code: { type: "string" }, message: { type: "string" } }
});

export const SUPPLIER_IMPORT_ROW_SCHEMA = Object.freeze({
  type: "object",
  required: ["rowNumber", "operation", "status", "matchSupplierId", "appliedSupplierId", "normalizedPayload", "errors", "warnings"],
  additionalProperties: false,
  properties: {
    rowNumber: { type: "integer", minimum: 1 },
    operation: { type: "string", enum: ["create", "update"] },
    status: { type: "string", enum: [...IMPORT_ROW_STATUSES] },
    matchSupplierId: NULLABLE_ID,
    appliedSupplierId: NULLABLE_ID,
    normalizedPayload: { type: "object", additionalProperties: true },
    errors: { type: "array", items: ISSUE },
    warnings: { type: "array", items: ISSUE }
  }
});

export const SUPPLIER_IMPORT_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: SUPPLIER_IMPORT_JOB_SCHEMA },
    total: COUNT,
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 }
  }
});

export const SUPPLIER_IMPORT_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["job", "rows", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    job: SUPPLIER_IMPORT_JOB_SCHEMA,
    rows: { type: "array", items: SUPPLIER_IMPORT_ROW_SCHEMA },
    total: COUNT,
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 }
  }
});

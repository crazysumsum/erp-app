/**
 * Item 匯入端點共用的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.9。
 */
import { IMPORT_JOB_MODES, IMPORT_JOB_STATUSES, IMPORT_ROW_STATUSES } from "../../modules/item/itemConstants.js";

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export const ITEM_MGMT_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["item.mgmt"]) })
  })
]);

/** 路徑上的 Import Job id。字串是因為 Express 的 req.params 一律是字串。 */
export const IMPORT_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

export const REASON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 5,
  maxLength: 190
});

export const VERSION_SCHEMA = Object.freeze({
  type: "integer",
  minimum: 1
});

export const PASSWORD_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 1024
});

// Multipart 中間件把非檔案欄位一律當成字串放進 req.body（見
// src/framework/upload/uploadMiddleware.js），`mode` 因此用字串 enum，唔係
// 特殊型別——本身就係字串值，唔似 item-media 嗰邊 isPrimary／sortOrder 咁
// 要做布林／數字轉換。
export const ITEM_IMPORT_UPLOAD_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["mode"],
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: [...IMPORT_JOB_MODES] }
  }
});

export const ITEM_IMPORT_LIST_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    status: { type: "string", enum: [...IMPORT_JOB_STATUSES] }
  }
});

export const ITEM_IMPORT_GET_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    rowStatus: { type: "string", enum: [...IMPORT_ROW_STATUSES] }
  }
});

export const ITEM_IMPORT_CONFIRM_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["reason", "version", "password"],
  additionalProperties: false,
  properties: {
    reason: REASON_SCHEMA,
    version: VERSION_SCHEMA,
    password: PASSWORD_SCHEMA
  }
});

export const IMPORT_JOB_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "fileStoredName",
    "resultStoredName",
    "fileSha256",
    "templateVersion",
    "mode",
    "status",
    "totalCount",
    "successCount",
    "failureCount",
    "skippedCount",
    "warningCount",
    "errorSummary",
    "createdBy",
    "confirmedBy",
    "createdAt",
    "updatedAt",
    "confirmedAt",
    "completedAt",
    "filesPurgedAt",
    "version"
  ],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    fileStoredName: { type: "string" },
    resultStoredName: { type: ["string", "null"] },
    fileSha256: { type: "string" },
    templateVersion: { type: "string" },
    mode: { type: "string", enum: [...IMPORT_JOB_MODES] },
    status: { type: "string", enum: [...IMPORT_JOB_STATUSES] },
    totalCount: { type: "integer" },
    successCount: { type: "integer" },
    failureCount: { type: "integer" },
    skippedCount: { type: "integer" },
    warningCount: { type: "integer" },
    errorSummary: { type: ["string", "null"] },
    createdBy: { type: ["integer", "null"] },
    confirmedBy: { type: ["integer", "null"] },
    createdAt: { type: "integer" },
    updatedAt: { type: "integer" },
    confirmedAt: { type: ["integer", "null"] },
    completedAt: { type: ["integer", "null"] },
    filesPurgedAt: { type: ["integer", "null"] },
    version: { type: "integer", minimum: 1 }
  }
});

export const IMPORT_ROW_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "jobId",
    "rowNumber",
    "operation",
    "matchSkuId",
    "expectedSkuVersion",
    "normalizedPayload",
    "status",
    "errors",
    "warnings",
    "createdAt",
    "updatedAt"
  ],
  additionalProperties: false,
  properties: {
    jobId: { type: "integer" },
    rowNumber: { type: "integer" },
    operation: { type: "string", enum: ["create", "update", "skip"] },
    matchSkuId: { type: ["integer", "null"] },
    expectedSkuVersion: { type: ["integer", "null"] },
    // 唔同 operation 嘅欄位形狀唔同（create 有 categoryId／brandId／
    // baseUomId，update 冇），呢個回應層特意唔收窄做單一固定 schema——真正
    // 嘅欄位白名單／型別已經喺寫入 DB 之前由 ItemImportProcessor.js 驗證過，
    // 呢度只係原樣帶出去俾前端顯示。
    normalizedPayload: { type: "object" },
    status: { type: "string", enum: [...IMPORT_ROW_STATUSES] },
    errors: { type: "array", items: { type: "object" } },
    warnings: { type: "array", items: { type: "object" } },
    createdAt: { type: "integer" },
    updatedAt: { type: "integer" }
  }
});

export const IMPORT_JOB_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: IMPORT_JOB_SUMMARY_SCHEMA },
    total: { type: "integer" },
    page: { type: "integer" },
    pageSize: { type: "integer" }
  }
});

export const IMPORT_JOB_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["job", "rows"],
  additionalProperties: false,
  properties: {
    job: IMPORT_JOB_SUMMARY_SCHEMA,
    rows: Object.freeze({
      type: "object",
      required: ["items", "total", "page", "pageSize"],
      additionalProperties: false,
      properties: {
        items: { type: "array", items: IMPORT_ROW_SUMMARY_SCHEMA },
        total: { type: "integer" },
        page: { type: "integer" },
        pageSize: { type: "integer" }
      }
    })
  }
});

import { IMPORT_JOB_STATUSES } from "../../modules/supplier/SupplierImportService.js";

export const SUPPLIER_IMPORT_EMPTY_SCHEMA = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

export const SUPPLIER_IMPORT_UPLOAD_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["mode"],
  additionalProperties: false,
  properties: { mode: { type: "string", enum: ["create_only", "upsert"] } }
});

/** 對外 job 摘要：冇檔名、SHA-256、lease 或路徑（IMP-003）。T44 會加欄位。 */
export const SUPPLIER_IMPORT_JOB_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "templateVersion", "mode", "status", "totalCount", "validCount", "warningCount", "invalidCount",
    "lastErrorCode", "errorSummary", "createdAt", "updatedAt", "version"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    templateVersion: { type: "string" },
    mode: { type: "string", enum: ["create_only", "upsert"] },
    status: { type: "string", enum: [...IMPORT_JOB_STATUSES] },
    totalCount: { type: "integer", minimum: 0 },
    validCount: { type: "integer", minimum: 0 },
    warningCount: { type: "integer", minimum: 0 },
    invalidCount: { type: "integer", minimum: 0 },
    lastErrorCode: { type: "string" },
    errorSummary: { type: "string" },
    createdAt: { type: "integer" },
    updatedAt: { type: "integer" },
    version: { type: "integer", minimum: 1 }
  }
});

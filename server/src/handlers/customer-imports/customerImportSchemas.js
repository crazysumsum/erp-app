function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value); Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

export const CUSTOMER_IMPORT_EMPTY = deepFreeze({ type: "object", properties: {}, additionalProperties: false });
export const CUSTOMER_IMPORT_ID_PARAMS = deepFreeze({
  type: "object", required: ["id"], additionalProperties: false,
  properties: { id: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }
});
export const CUSTOMER_IMPORT_UPLOAD_BODY = deepFreeze({
  type: "object", required: ["mode"], additionalProperties: false,
  properties: { mode: { type: "string", enum: ["create_only", "upsert"] } }
});
export const CUSTOMER_IMPORT_CONFIRM_BODY = deepFreeze({
  type: "object", required: ["version", "activationMode"], additionalProperties: false,
  properties: {
    version: { type: "integer", minimum: 1 }, activationMode: { type: "string", enum: ["draft", "activate"] },
    approverUserId: { type: ["integer", "null"], minimum: 1 }
  }
});
export const CUSTOMER_IMPORT_CANCEL_BODY = deepFreeze({
  type: "object", required: ["version"], additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 } }
});
const JOB_STATUS = { type: "string", enum: ["uploaded", "validating", "ready", "ready_with_errors", "queued", "running", "completed", "completed_with_errors", "failed", "cancelled"] };
const ROW_STATUS = { type: "string", enum: ["valid", "warning", "invalid", "applied", "failed", "skipped"] };
export const CUSTOMER_IMPORT_LIST_QUERY = deepFreeze({
  type: "object", additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }, status: JOB_STATUS
  }
});
export const CUSTOMER_IMPORT_GET_QUERY = deepFreeze({
  type: "object", additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }, rowStatus: ROW_STATUS
  }
});

const NULLABLE_ID = { type: ["integer", "null"], minimum: 1 };
const NULLABLE_EPOCH = { type: ["integer", "null"], minimum: 0 };
export const CUSTOMER_IMPORT_JOB = deepFreeze({
  type: "object", additionalProperties: false,
  required: ["id", "templateVersion", "mode", "activationMode", "sourceStorageStatus", "resultStorageStatus", "status", "totalCount", "validCount", "warningCount", "invalidCount", "successCount", "failedCount", "skippedCount", "lastErrorCode", "errorSummary", "createdBy", "confirmedBy", "createdAt", "updatedAt", "confirmedAt", "completedAt", "version"],
  properties: {
    id: { type: "integer", minimum: 1 }, templateVersion: { const: "v1" }, mode: { type: "string", enum: ["create_only", "upsert"] },
    activationMode: { type: "string", enum: ["draft", "activate"] },
    sourceStorageStatus: { type: "string", enum: ["processing", "active", "storage_error", "purged"] },
    resultStorageStatus: { type: ["string", "null"], enum: ["processing", "active", "storage_error", "purged", null] }, status: JOB_STATUS,
    totalCount: { type: "integer", minimum: 0 }, validCount: { type: "integer", minimum: 0 }, warningCount: { type: "integer", minimum: 0 },
    invalidCount: { type: "integer", minimum: 0 }, successCount: { type: "integer", minimum: 0 }, failedCount: { type: "integer", minimum: 0 },
    skippedCount: { type: "integer", minimum: 0 }, lastErrorCode: { type: "string" }, errorSummary: { type: "string" },
    createdBy: NULLABLE_ID, confirmedBy: NULLABLE_ID, createdAt: { type: "integer", minimum: 0 }, updatedAt: { type: "integer", minimum: 0 },
    confirmedAt: NULLABLE_EPOCH, completedAt: NULLABLE_EPOCH, version: { type: "integer", minimum: 1 }
  }
});
const ISSUE = deepFreeze({
  type: "object", additionalProperties: false, required: ["field", "code", "message"],
  properties: { field: { type: "string" }, code: { type: "string" }, message: { type: "string" } }
});
export const CUSTOMER_IMPORT_ROW = deepFreeze({
  type: "object", additionalProperties: false,
  required: ["rowNumber", "operation", "matchCustomerId", "expectedCustomerVersion", "normalizedPayload", "status", "appliedCustomerId", "errors", "warnings", "startedAt", "completedAt", "version"],
  properties: {
    rowNumber: { type: "integer", minimum: 1 }, operation: { type: "string", enum: ["create", "update"] },
    matchCustomerId: NULLABLE_ID, expectedCustomerVersion: NULLABLE_ID,
    normalizedPayload: { type: "object", additionalProperties: true }, status: ROW_STATUS, appliedCustomerId: NULLABLE_ID,
    errors: { type: "array", items: ISSUE }, warnings: { type: "array", items: ISSUE },
    startedAt: NULLABLE_EPOCH, completedAt: NULLABLE_EPOCH, version: { type: "integer", minimum: 1 }
  }
});
export const CUSTOMER_IMPORT_LIST_RESPONSE = deepFreeze({
  type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
  properties: {
    items: { type: "array", items: CUSTOMER_IMPORT_JOB }, total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 }
  }
});
export const CUSTOMER_IMPORT_DETAIL_RESPONSE = deepFreeze({
  type: "object", additionalProperties: false, required: ["job", "rows", "total", "page", "pageSize"],
  properties: {
    job: CUSTOMER_IMPORT_JOB, rows: { type: "array", items: CUSTOMER_IMPORT_ROW }, total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 }
  }
});

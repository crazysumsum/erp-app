import { SUPPLIER_STATUSES } from "../../modules/supplier/supplierConstants.js";
import { APPROVAL_REQUEST_STATUSES, APPROVAL_QUEUE_SCOPES } from "../../modules/supplier/SupplierApprovalService.js";

export const EMPTY_APPROVAL_SCHEMA = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

/**
 * 設計 6.4：呢個期冇獨立嘅 approval.admin，所以 queue、detail 同三個決定全部要求
 * 同一對 permission。`match` 保持預設（all）：兩個都要有，唔係其中一個。
 */
export const SUPPLIER_APPROVAL_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["supplier.view", "supplier.approval"]) })
})]);

export const APPROVAL_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});

export const APPROVAL_QUEUE_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    scope: { type: "string", enum: [...APPROVAL_QUEUE_SCOPES], default: "mine" },
    status: { type: "string", enum: [...APPROVAL_REQUEST_STATUSES], default: "pending" },
    requesterId: { type: "integer", minimum: 1 },
    requestedFrom: { type: "integer", minimum: 0 },
    requestedTo: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
  }
});

/**
 * 設計 6.4／SEC-009：approval route 上面嘅 User 投影只得三個欄位。呢個 schema 係
 * queue、detail 同 approver lookup 共用嘅同一個定義，所以三邊唔會各自漂移。
 */
const APPROVAL_USER_SCHEMA = Object.freeze({
  type: ["object", "null"],
  additionalProperties: false,
  required: ["id", "username", "displayName"],
  properties: {
    id: { type: "integer", minimum: 1 },
    username: { type: "string" },
    displayName: { type: "string" }
  }
});

const APPROVAL_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id", "supplierId", "supplierCode", "supplierName", "supplierStatus", "status", "requester", "assignedApprover", "requestNote", "requestedAt", "decidedAt", "version"],
  properties: {
    id: { type: "integer", minimum: 1 },
    supplierId: { type: "integer", minimum: 1 },
    supplierCode: { type: "string" },
    supplierName: { type: "string" },
    supplierStatus: { type: "string", enum: [...SUPPLIER_STATUSES] },
    status: { type: "string", enum: [...APPROVAL_REQUEST_STATUSES] },
    requester: APPROVAL_USER_SCHEMA,
    assignedApprover: APPROVAL_USER_SCHEMA,
    requestNote: { type: "string" },
    requestedAt: { type: "integer", minimum: 0 },
    decidedAt: { type: ["integer", "null"], minimum: 0 },
    version: { type: "integer", minimum: 1 }
  }
});

export const APPROVAL_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["items", "total", "page", "pageSize"],
  properties: {
    items: { type: "array", items: APPROVAL_SUMMARY_SCHEMA },
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 }
  }
});

// 提交時嘅 snapshot 同現況都用呢個形狀，審批人先至可以逐項對。識別資料已經遮罩，
// 完整銀行帳號從來唔喺 snapshot 入面（SupplierApprovalService.buildApprovalSummary）。
const APPROVAL_SNAPSHOT_SCHEMA = Object.freeze({
  type: ["object", "null"],
  additionalProperties: false,
  required: ["supplierCode", "supplierName", "displayName", "defaultCurrencyCode", "defaultPaymentTermId", "identifierCount", "identifiersTruncated", "identifiers"],
  properties: {
    supplierCode: { type: "string" },
    supplierName: { type: "string" },
    displayName: { type: "string" },
    defaultCurrencyCode: { type: "string" },
    defaultPaymentTermId: { type: ["integer", "null"] },
    identifierCount: { type: "integer", minimum: 0 },
    identifiersTruncated: { type: "boolean" },
    identifiers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["identifierType", "issuerCountryCode", "identifierValueMasked"],
        properties: {
          identifierType: { type: "string" },
          issuerCountryCode: { type: "string" },
          identifierValueMasked: { type: "string" }
        }
      }
    }
  }
});

export const APPROVAL_DETAIL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id", "supplierId", "supplierCode", "supplierName", "supplierStatus", "status", "requester", "assignedApprover", "decidedBy", "requestNote", "decisionReason", "requestedAt", "decidedAt", "version", "supplierVersion", "currentSupplierVersion", "stale", "submitted", "current", "changedFields"],
  properties: {
    id: { type: "integer", minimum: 1 },
    supplierId: { type: "integer", minimum: 1 },
    supplierCode: { type: "string" },
    supplierName: { type: "string" },
    supplierStatus: { type: "string", enum: [...SUPPLIER_STATUSES] },
    status: { type: "string", enum: [...APPROVAL_REQUEST_STATUSES] },
    requester: APPROVAL_USER_SCHEMA,
    assignedApprover: APPROVAL_USER_SCHEMA,
    decidedBy: APPROVAL_USER_SCHEMA,
    requestNote: { type: "string" },
    decisionReason: { type: "string" },
    requestedAt: { type: "integer", minimum: 0 },
    decidedAt: { type: ["integer", "null"], minimum: 0 },
    version: { type: "integer", minimum: 1 },
    supplierVersion: { type: "integer", minimum: 1 },
    currentSupplierVersion: { type: "integer", minimum: 1 },
    // AC-012：提交之後 Supplier 改過就唔可以批舊申請，UI 要睇得出。
    stale: { type: "boolean" },
    submitted: APPROVAL_SNAPSHOT_SCHEMA,
    current: APPROVAL_SNAPSHOT_SCHEMA,
    changedFields: { type: "array", items: { type: "string" } }
  }
});

const DECISION_BODY = Object.freeze({
  password: { type: "string", minLength: 1, maxLength: 1024 },
  version: { type: "integer", minimum: 1 }
});

export const APPROVAL_APPROVE_SCHEMA = Object.freeze({
  type: "object",
  required: ["password", "version"],
  additionalProperties: false,
  properties: { ...DECISION_BODY, reason: { type: "string", maxLength: 500 } }
});

export const APPROVAL_REJECT_SCHEMA = Object.freeze({
  type: "object",
  required: ["reason", "password", "version"],
  additionalProperties: false,
  properties: { ...DECISION_BODY, reason: { type: "string", minLength: 5, maxLength: 500 } }
});

export const APPROVAL_REASSIGN_SCHEMA = Object.freeze({
  type: "object",
  required: ["approverUserId", "reason", "password", "version"],
  additionalProperties: false,
  properties: { ...DECISION_BODY, approverUserId: { type: "integer", minimum: 1 }, reason: { type: "string", minLength: 5, maxLength: 500 } }
});

export const APPROVAL_DECISION_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id", "status", "supplierId", "supplierStatus", "version", "replayed"],
  properties: {
    id: { type: "integer", minimum: 1 },
    status: { type: "string", enum: [...APPROVAL_REQUEST_STATUSES] },
    supplierId: { type: "integer", minimum: 1 },
    supplierStatus: { type: "string", enum: [...SUPPLIER_STATUSES] },
    version: { type: "integer", minimum: 1 },
    replayed: { type: "boolean" }
  }
});

export const APPROVAL_REASSIGN_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id", "assignedApproverId", "version", "replayed"],
  properties: {
    id: { type: "integer", minimum: 1 },
    assignedApproverId: { type: "integer", minimum: 1 },
    version: { type: "integer", minimum: 1 },
    replayed: { type: "boolean" }
  }
});

export const APPROVER_LOOKUP_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    q: { type: "string", maxLength: 190, default: "" },
    excludeUserId: { type: "integer", minimum: 1 }
  }
});

export const APPROVER_LOOKUP_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "username", "displayName"],
        properties: {
          id: { type: "integer", minimum: 1 },
          username: { type: "string" },
          displayName: { type: "string" }
        }
      }
    }
  }
});

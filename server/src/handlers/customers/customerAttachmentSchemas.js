function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value); Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner, seen);
  return value;
}

export const CUSTOMER_ATTACHMENT_EMPTY = deepFreeze({ type: "object", properties: {}, additionalProperties: false });
export const CUSTOMER_ATTACHMENT_PARENT_PARAMS = deepFreeze({
  type: "object", required: ["id"], additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});
export const CUSTOMER_ATTACHMENT_PARAMS = deepFreeze({
  type: "object", required: ["id", "attachmentId"], additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    attachmentId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

const REASON = { type: "string", minLength: 5, maxLength: 500 };
const PASSWORD = { type: "string", minLength: 1, maxLength: 1024 };
const METADATA = {
  displayName: { type: "string", minLength: 1, maxLength: 190 },
  documentType: { type: "string", enum: ["business_certificate", "credit_application", "contract", "bank_proof", "other"] },
  sensitivity: { type: "string", enum: ["general", "bank_sensitive"] },
  notes: { type: "string", maxLength: 500 },
  sortOrder: { anyOf: [{ type: "integer", minimum: 0 }, { type: "string", pattern: "^(?:0|[1-9][0-9]{0,9})$" }] },
  reason: REASON
};

export const CUSTOMER_ATTACHMENT_UPLOAD = deepFreeze({
  type: "object", required: ["displayName", "documentType", "sensitivity", "reason"], additionalProperties: false,
  properties: { ...METADATA, sessionToken: { type: "string", minLength: 1, maxLength: 5000 } }
});
export const CUSTOMER_ATTACHMENT_UPLOAD_SESSION = deepFreeze({
  type: "object", required: ["displayName", "documentType", "sensitivity", "originalFilename", "mimeType", "contentSha256", "reason", "password"], additionalProperties: false,
  properties: {
    ...METADATA,
    originalFilename: { type: "string", minLength: 1, maxLength: 255 },
    mimeType: { type: "string", enum: ["application/pdf", "image/png", "image/jpeg", "image/webp"] },
    contentSha256: { type: "string", pattern: "^[0-9a-f]{64}$" }, password: PASSWORD
  }
});
export const CUSTOMER_ATTACHMENT_UPDATE = deepFreeze({
  type: "object", required: ["displayName", "documentType", "sortOrder", "version", "reason"], additionalProperties: false,
  properties: {
    displayName: METADATA.displayName, documentType: METADATA.documentType, notes: METADATA.notes,
    sortOrder: { type: "integer", minimum: 0 }, version: { type: "integer", minimum: 1 }, reason: REASON
  }
});
export const CUSTOMER_ATTACHMENT_VERSIONED = deepFreeze({
  type: "object", required: ["version", "reason"], additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 }, reason: REASON }
});
export const CUSTOMER_ATTACHMENT_DELETE = deepFreeze({
  type: "object", required: ["version", "reason", "password"], additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 }, reason: REASON, password: PASSWORD }
});
export const CUSTOMER_ATTACHMENT_DOWNLOAD_SESSION = deepFreeze({
  type: "object", required: ["mode", "reason", "password"], additionalProperties: false,
  properties: { mode: { type: "string", enum: ["preview", "download"] }, reason: REASON, password: PASSWORD }
});

export const CUSTOMER_ATTACHMENT_RESPONSE = deepFreeze({
  type: "object", required: ["id", "customerId", "displayName", "documentType", "sensitivity", "originalFilename", "mimeType", "extension", "sizeBytes", "storageClass", "scanStatus", "status", "sortOrder", "notes", "version", "updatedAt"], additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 }, customerId: { type: "integer", minimum: 1 },
    displayName: { type: "string" }, documentType: { type: "string" }, sensitivity: { type: "string", enum: ["general", "bank_sensitive"] },
    originalFilename: { type: "string" }, mimeType: { type: "string" }, extension: { type: "string" }, sizeBytes: { type: "integer", minimum: 0 },
    storageClass: { type: "string" }, scanStatus: { type: "string" }, status: { type: "string" }, sortOrder: { type: "integer", minimum: 0 },
    notes: { type: "string" }, version: { type: "integer", minimum: 1 }, updatedAt: { type: "integer", minimum: 0 }
  }
});
export const CUSTOMER_ATTACHMENT_LIST_RESPONSE = deepFreeze({
  type: "object", required: ["items", "restrictedCount"], additionalProperties: false,
  properties: { items: { type: "array", items: CUSTOMER_ATTACHMENT_RESPONSE }, restrictedCount: { type: "integer", minimum: 0 } }
});
export const CUSTOMER_ATTACHMENT_SESSION_RESPONSE = deepFreeze({
  type: "object", required: ["token", "expiresAt"], additionalProperties: false,
  properties: { token: { type: "string" }, expiresAt: { type: "integer", minimum: 0 } }
});
export const CUSTOMER_ATTACHMENT_DELETE_RESPONSE = deepFreeze({
  type: "object", required: ["deleted"], additionalProperties: false, properties: { deleted: { type: "boolean", const: true } }
});

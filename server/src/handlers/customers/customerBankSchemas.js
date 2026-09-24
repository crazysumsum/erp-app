function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner, seen);
  return value;
}

export const CUSTOMER_BANK_EMPTY = deepFreeze({ type: "object", properties: {}, additionalProperties: false });

export const CUSTOMER_BANK_PARENT_PARAMS = deepFreeze({
  type: "object", required: ["id"], additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});

export const CUSTOMER_BANK_PARAMS = deepFreeze({
  type: "object", required: ["id", "bankId"], additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    bankId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

const REASON = { type: "string", minLength: 5, maxLength: 500 };
const PASSWORD = { type: "string", minLength: 1, maxLength: 1024 };
const DETAILS = {
  accountHolderName: { type: "string", minLength: 1, maxLength: 190 },
  bankName: { type: "string", minLength: 1, maxLength: 190 },
  bankCountryCode: { type: "string", pattern: "^[A-Za-z]{2}$" },
  bankCode: { type: "string", maxLength: 50 },
  branchCode: { type: "string", maxLength: 50 },
  swiftBic: { type: "string", pattern: "^[A-Za-z0-9]{8}(?:[A-Za-z0-9]{3})?$" },
  accountCurrencyCode: { type: "string", pattern: "^[A-Za-z]{3}$" },
  purposeCode: { type: "string", enum: ["general", "collection_match", "refund"] }
};
const CONFIRMATION = {
  confirmCrossCustomerDuplicate: { type: "boolean" },
  warningToken: { type: "string", minLength: 1, maxLength: 2048 }
};

export const CUSTOMER_BANK_CREATE = deepFreeze({
  type: "object",
  required: ["accountHolderName", "bankName", "accountNumber", "reason", "password"],
  additionalProperties: false,
  properties: {
    ...DETAILS,
    accountNumber: { type: "string", minLength: 1, maxLength: 2048 },
    isDefault: { type: "boolean", default: false },
    reason: REASON,
    password: PASSWORD,
    ...CONFIRMATION
  }
});

export const CUSTOMER_BANK_UPDATE = deepFreeze({
  type: "object",
  required: ["accountHolderName", "bankName", "purposeCode", "version", "reason", "password"],
  additionalProperties: false,
  properties: {
    ...DETAILS,
    accountNumber: { type: "string", minLength: 1, maxLength: 2048 },
    version: { type: "integer", minimum: 1 },
    reason: REASON,
    password: PASSWORD,
    ...CONFIRMATION
  }
});

export const CUSTOMER_BANK_VERSIONED = deepFreeze({
  type: "object", required: ["version", "reason", "password"], additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 }, reason: REASON, password: PASSWORD }
});

export const CUSTOMER_BANK_REVEAL = deepFreeze({
  type: "object", required: ["reason", "password"], additionalProperties: false,
  properties: { reason: REASON, password: PASSWORD }
});

export const CUSTOMER_BANK_RESPONSE = deepFreeze({
  type: "object",
  required: ["id", "customerId", "accountHolderName", "bankName", "purposeCode", "maskedAccountNumber", "isDefault", "status", "version", "updatedAt"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    customerId: { type: "integer", minimum: 1 },
    accountHolderName: { type: "string" },
    bankName: { type: "string" },
    bankCountryCode: { type: ["string", "null"] },
    bankCode: { type: "string" },
    branchCode: { type: "string" },
    swiftBic: { type: "string" },
    accountCurrencyCode: { type: ["string", "null"] },
    purposeCode: { type: "string", enum: ["general", "collection_match", "refund"] },
    maskedAccountNumber: { type: "string" },
    isDefault: { type: "boolean" },
    status: { type: "string", enum: ["active", "inactive"] },
    version: { type: "integer", minimum: 1 },
    updatedAt: { type: "integer", minimum: 0 }
  }
});

export const CUSTOMER_BANK_LIST_RESPONSE = deepFreeze({
  type: "object", required: ["items"], additionalProperties: false,
  properties: { items: { type: "array", items: CUSTOMER_BANK_RESPONSE } }
});

export const CUSTOMER_BANK_REVEAL_RESPONSE = deepFreeze({
  type: "object", required: ["id", "accountNumber", "revealedAt", "expiresInSeconds"], additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 }, accountNumber: { type: "string" },
    revealedAt: { type: "integer", minimum: 0 }, expiresInSeconds: { type: "integer", const: 30 }
  }
});

export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

const POSITIVE_SAFE_INTEGER = Object.freeze({ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const NONNEGATIVE_SAFE_INTEGER = Object.freeze({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

export const CUSTOMER_ID_PARAMS = Object.freeze({
  type: "object", required: ["id"], additionalProperties: false,
  properties: { id: POSITIVE_SAFE_INTEGER }
});

export const CUSTOMER_ADDRESS_PARAMS = Object.freeze({ type: "object", required: ["customerId", "addressId"], additionalProperties: false, properties: { customerId: POSITIVE_SAFE_INTEGER, addressId: POSITIVE_SAFE_INTEGER } });
export const CUSTOMER_CONTACT_PARAMS = Object.freeze({ type: "object", required: ["customerId", "contactId"], additionalProperties: false, properties: { customerId: POSITIVE_SAFE_INTEGER, contactId: POSITIVE_SAFE_INTEGER } });
export const CUSTOMER_IDENTIFIER_PARAMS = Object.freeze({ type: "object", required: ["customerId", "identifierId"], additionalProperties: false, properties: { customerId: POSITIVE_SAFE_INTEGER, identifierId: POSITIVE_SAFE_INTEGER } });
export const CUSTOMER_PARENT_PARAMS = Object.freeze({ type: "object", required: ["customerId"], additionalProperties: false, properties: { customerId: POSITIVE_SAFE_INTEGER } });

export const OPERATION_ID_PARAMS = Object.freeze({
  type: "object", required: ["operationId"], additionalProperties: false,
  properties: { operationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } }
});

const NULLABLE_ID = Object.freeze({ type: ["integer", "null"], minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const NULLABLE_CURRENCY = Object.freeze({ type: ["string", "null"], pattern: "^[A-Z]{3}$" });
const TEXT = (maxLength) => Object.freeze({ type: "string", trim: true, maxLength });
const EMAIL = Object.freeze({ type: "string", trim: true, maxLength: 254, anyOf: [{ type: "string", maxLength: 0 }, { type: "string", format: "email" }] });

export const CUSTOMER_ROOT_INPUT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["customerCode", "legalName"],
  properties: {
    customerCode: TEXT(64), legalName: TEXT(190), tradingName: TEXT(190),
    defaultCurrencyCode: NULLABLE_CURRENCY, defaultPaymentTermId: NULLABLE_ID,
    accountManagerUserId: NULLABLE_ID, categoryId: NULLABLE_ID, industryId: NULLABLE_ID,
    territoryId: NULLABLE_ID, website: { ...TEXT(500), pattern: "^(?:$|https?://)" }, generalPhone: TEXT(50),
    generalEmail: EMAIL, notes: TEXT(2000), activate: { type: "boolean" },
    approverUserId: POSITIVE_SAFE_INTEGER, requestNote: { type: "string", trim: true, maxLength: 500 }
  }
});

export const CUSTOMER_UPDATE_INPUT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["legalName", "tradingName", "defaultCurrencyCode", "defaultPaymentTermId", "accountManagerUserId", "categoryId", "industryId", "territoryId", "website", "generalPhone", "generalEmail", "notes", "version", "reason"],
  properties: {
    legalName: TEXT(190), tradingName: TEXT(190), defaultCurrencyCode: NULLABLE_CURRENCY,
    defaultPaymentTermId: NULLABLE_ID, accountManagerUserId: NULLABLE_ID, categoryId: NULLABLE_ID,
    industryId: NULLABLE_ID, territoryId: NULLABLE_ID, website: { ...TEXT(500), pattern: "^(?:$|https?://)" }, generalPhone: TEXT(50),
    generalEmail: EMAIL, notes: TEXT(2000), version: POSITIVE_SAFE_INTEGER,
    reason: { type: "string", trim: true, minLength: 5, maxLength: 500 }
  }
});

export const CUSTOMER_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    q: TEXT(190), page: { ...POSITIVE_SAFE_INTEGER, default: 1 },
    pageSize: { type: "integer", enum: [10, 20, 50, 100], default: 20 },
    sortBy: { type: "string", enum: ["code", "legalName", "accountManager", "status", "updatedAt"], default: "updatedAt" },
    sortDirection: { type: "string", enum: ["asc", "desc"], default: "desc" },
    status: { anyOf: [
      { type: "string", enum: ["draft", "pending_approval", "active", "suspended", "blocked", "archived"] },
      { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: ["draft", "pending_approval", "active", "suspended", "blocked", "archived"] } }
    ] },
    currencyCode: { type: "string", pattern: "^[A-Z]{3}$" }, paymentTermId: POSITIVE_SAFE_INTEGER,
    accountManagerUserId: POSITIVE_SAFE_INTEGER, categoryId: POSITIVE_SAFE_INTEGER,
    industryId: POSITIVE_SAFE_INTEGER, territoryId: POSITIVE_SAFE_INTEGER,
    creditStatus: { type: "string", enum: ["normal", "on_hold"] },
    missing: { type: "array", uniqueItems: true, items: { type: "string", enum: ["shippingDefault", "billingDefault", "contactDefault", "paymentTerm", "credit"] } },
    createdFrom: NONNEGATIVE_SAFE_INTEGER, createdTo: NONNEGATIVE_SAFE_INTEGER,
    updatedFrom: NONNEGATIVE_SAFE_INTEGER, updatedTo: NONNEGATIVE_SAFE_INTEGER,
    includeArchived: { type: "boolean", default: false }
  }
});

export const CUSTOMER_CHILD_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    page: { ...POSITIVE_SAFE_INTEGER, default: 1 },
    pageSize: { type: "integer", enum: [10, 20, 50, 100], default: 20 }
  }
});

const PURPOSE = Object.freeze({ type: "object", required: ["code", "isDefault"], additionalProperties: false, properties: { code: { type: "string", maxLength: 30 }, isDefault: { type: "boolean" } } });
export const ADDRESS_CREATE = Object.freeze({ type: "object", required: ["label", "addressLine1", "purposes"], additionalProperties: false, properties: { label: TEXT(100), recipientCompanyDepartment: TEXT(190), addressLine1: TEXT(190), addressLine2: TEXT(190), addressLine3: TEXT(190), city: TEXT(100), stateRegion: TEXT(100), postalCode: TEXT(100), countryCode: { type: ["string", "null"], pattern: "^[A-Z]{2}$" }, phone: TEXT(50), notes: TEXT(500), sortOrder: { type: "integer", minimum: 0 }, purposes: { type: "array", items: PURPOSE, maxItems: 6 } } });
export const CONTACT_CREATE = Object.freeze({ type: "object", required: ["name", "purposes"], additionalProperties: false, properties: { name: TEXT(190), jobTitle: TEXT(100), department: TEXT(100), email: TEXT(254), phone: TEXT(50), mobile: TEXT(50), preferredLanguage: TEXT(20), notes: TEXT(500), sortOrder: { type: "integer", minimum: 0 }, purposes: { type: "array", items: PURPOSE, maxItems: 6 } } });
export const PARTY_CREATED = Object.freeze({ type: "object", required: ["id", "customerId", "status", "version", "purposes"], additionalProperties: false, properties: { id: { type: "integer", minimum: 1 }, customerId: { type: "integer", minimum: 1 }, status: { const: "active" }, version: { type: "integer", minimum: 1 }, purposes: { type: "array", items: PURPOSE } } });
export const ADDRESS_UPDATE = Object.freeze({ ...ADDRESS_CREATE, required: [...ADDRESS_CREATE.required, "version", "reason"], properties: { ...ADDRESS_CREATE.properties, version: { type: "integer", minimum: 1 }, reason: { type: "string", trim: true, minLength: 5, maxLength: 500 } } });
export const CONTACT_UPDATE = Object.freeze({ ...CONTACT_CREATE, required: [...CONTACT_CREATE.required, "version", "reason"], properties: { ...CONTACT_CREATE.properties, version: { type: "integer", minimum: 1 }, reason: { type: "string", trim: true, minLength: 5, maxLength: 500 } } });
export const PARTY_UPDATED = PARTY_CREATED;
export const DEACTIVATE_PARTY = Object.freeze({ type: "object", required: ["version", "reason"], additionalProperties: false, properties: { version: { type: "integer", minimum: 1 }, reason: { type: "string", trim: true, minLength: 5, maxLength: 500 } } });
export const PARTY_DEACTIVATED = Object.freeze({ type: "object", required: ["id", "customerId", "status", "version"], additionalProperties: false, properties: { id: { type: "integer", minimum: 1 }, customerId: { type: "integer", minimum: 1 }, status: { const: "inactive" }, version: { type: "integer", minimum: 1 } } });

const IDENTIFIER_FIELDS = Object.freeze({
  identifierType: { type: "string", enum: ["company_registration", "business_registration", "tax", "other"] },
  issuerCountryCode: { type: "string", pattern: "^[A-Z]{2}$" },
  identifierValue: { type: "string", trim: true, minLength: 1, maxLength: 190 },
  validFrom: { type: ["integer", "null"], minimum: 0 },
  expiresAt: { type: ["integer", "null"], minimum: 0 },
  notes: TEXT(500)
});
export const IDENTIFIER_CREATE = Object.freeze({ type: "object", required: ["identifierType", "issuerCountryCode", "identifierValue"], additionalProperties: false, properties: IDENTIFIER_FIELDS });
export const IDENTIFIER_UPDATE = Object.freeze({ type: "object", required: ["identifierType", "issuerCountryCode", "identifierValue", "version", "reason"], additionalProperties: false, properties: { ...IDENTIFIER_FIELDS, version: { type: "integer", minimum: 1 }, reason: { type: "string", trim: true, minLength: 5, maxLength: 500 } } });
export const IDENTIFIER_RESPONSE = Object.freeze({ type: "object", required: ["id", "customerId", ...Object.keys(IDENTIFIER_FIELDS), "status", "version"], additionalProperties: false, properties: { id: { type: "integer", minimum: 1 }, customerId: { type: "integer", minimum: 1 }, identifierType: IDENTIFIER_FIELDS.identifierType, issuerCountryCode: IDENTIFIER_FIELDS.issuerCountryCode, identifierValue: { type: "string", minLength: 1, maxLength: 190 }, validFrom: IDENTIFIER_FIELDS.validFrom, expiresAt: IDENTIFIER_FIELDS.expiresAt, notes: { type: "string", maxLength: 500 }, status: { type: "string", enum: ["active", "inactive"] }, version: { type: "integer", minimum: 1 } } });

const CREDIT_LIMIT = Object.freeze({ type: ["string", "null"], pattern: "^(?:0|[1-9][0-9]{0,14})\\.[0-9]{4}$" });
const CREDIT_CURRENCY = Object.freeze({ type: ["string", "null"], pattern: "^[A-Z]{3}$" });
export const CREDIT_POLICY_RESPONSE = Object.freeze({ type: "object", required: ["configured", "creditLimit", "currencyCode", "status", "policyVersion"], additionalProperties: false, properties: { configured: { type: "boolean" }, creditLimit: CREDIT_LIMIT, currencyCode: CREDIT_CURRENCY, status: { type: "string", enum: ["not_configured", "normal", "on_hold"] }, policyVersion: { type: ["integer", "null"], minimum: 1 } } });
export const CREDIT_POLICY_SAVE = Object.freeze({ type: "object", required: ["creditLimit", "creditCurrencyCode", "creditStatus", "creditNotes", "reason", "version"], additionalProperties: false, properties: { creditLimit: CREDIT_LIMIT, creditCurrencyCode: CREDIT_CURRENCY, creditStatus: { type: "string", enum: ["normal", "on_hold"] }, creditNotes: TEXT(1000), reason: { type: "string", trim: true, minLength: 5, maxLength: 500 }, version: { type: ["integer", "null"], minimum: 1 } } });
export const CREDIT_POLICY_CLEAR = Object.freeze({ type: "object", required: ["reason", "version", "password"], additionalProperties: false, properties: { reason: { type: "string", trim: true, minLength: 5, maxLength: 500 }, version: { type: "integer", minimum: 1 }, password: { type: "string", minLength: 1, maxLength: 1024 } } });

export const CUSTOMER_SUMMARY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "code", "legalName", "displayName", "generalPhone", "generalEmail", "defaultCurrencyCode", "defaultPaymentTermId", "accountManagerUserId", "categoryId", "industryId", "territoryId", "creditStatus", "status", "version", "updatedAt"],
  properties: {
    id: { type: "integer", minimum: 1 }, code: { type: "string" }, legalName: { type: "string" },
    displayName: { type: "string" }, generalPhone: { type: "string" }, generalEmail: { type: "string" },
    defaultCurrencyCode: NULLABLE_CURRENCY, defaultPaymentTermId: NULLABLE_ID, accountManagerUserId: NULLABLE_ID,
    categoryId: NULLABLE_ID, industryId: NULLABLE_ID, territoryId: NULLABLE_ID,
    creditStatus: { type: "string", enum: ["not_configured", "normal", "on_hold"] },
    status: { type: "string" }, version: { type: "integer", minimum: 1 }, updatedAt: { type: "integer", minimum: 0 }
  }
});

export const DETAIL_ADDRESS = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "customerId", "label", "recipientCompanyDepartment", "addressLine1", "addressLine2", "addressLine3", "city", "stateRegion", "postalCode", "countryCode", "phone", "notes", "sortOrder", "status", "version", "purposes"],
  properties: {
    id: POSITIVE_SAFE_INTEGER, customerId: POSITIVE_SAFE_INTEGER, label: { type: "string" },
    recipientCompanyDepartment: { type: "string" }, addressLine1: { type: "string" }, addressLine2: { type: "string" },
    addressLine3: { type: "string" }, city: { type: "string" }, stateRegion: { type: "string" },
    postalCode: { type: "string" }, countryCode: { type: ["string", "null"], pattern: "^[A-Z]{2}$" },
    phone: { type: "string" }, notes: { type: "string" }, sortOrder: { type: "integer", minimum: 0 },
    status: { type: "string", enum: ["active", "inactive"] }, version: POSITIVE_SAFE_INTEGER,
    purposes: { type: "array", items: PURPOSE }
  }
});

export const DETAIL_CONTACT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "customerId", "name", "jobTitle", "department", "email", "phone", "mobile", "preferredLanguage", "notes", "sortOrder", "status", "version", "purposes"],
  properties: {
    id: POSITIVE_SAFE_INTEGER, customerId: POSITIVE_SAFE_INTEGER, name: { type: "string" }, jobTitle: { type: "string" },
    department: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, mobile: { type: "string" },
    preferredLanguage: { type: "string" }, notes: { type: "string" }, sortOrder: { type: "integer", minimum: 0 },
    status: { type: "string", enum: ["active", "inactive"] }, version: POSITIVE_SAFE_INTEGER,
    purposes: { type: "array", items: PURPOSE }
  }
});

export const CUSTOMER_DETAIL = Object.freeze({
  type: "object", additionalProperties: false,
  required: [...CUSTOMER_SUMMARY.required, "tradingName", "website", "notes", "everActivatedAt", "createdAt", "createdBy", "updatedBy", "addresses", "contacts", "identifiers", "credit"],
  properties: {
    ...CUSTOMER_SUMMARY.properties, tradingName: { type: "string" }, website: { type: "string" }, notes: { type: "string" },
    everActivatedAt: { type: ["integer", "null"], minimum: 0 }, createdAt: { type: "integer", minimum: 0 },
    createdBy: NULLABLE_ID, updatedBy: NULLABLE_ID,
    addresses: { type: "array", items: DETAIL_ADDRESS }, contacts: { type: "array", items: DETAIL_CONTACT },
    identifiers: { type: "array", items: IDENTIFIER_RESPONSE }, credit: CREDIT_POLICY_RESPONSE
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

export const CUSTOMER_APPROVAL_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "customerId", "customerStatus", "status", "version"],
  properties: {
    id: POSITIVE_SAFE_INTEGER, customerId: POSITIVE_SAFE_INTEGER,
    customerStatus: { type: "string", enum: ["draft", "pending_approval"] },
    status: { type: "string", enum: ["pending", "withdrawn"] }, version: POSITIVE_SAFE_INTEGER
  }
});

export const CUSTOMER_APPROVAL_SUBMIT = Object.freeze({
  type: "object", additionalProperties: false, required: ["approverUserId", "requestNote"],
  properties: { approverUserId: POSITIVE_SAFE_INTEGER, requestNote: { type: "string", trim: true, maxLength: 500 } }
});

export const CUSTOMER_APPROVAL_WITHDRAW = Object.freeze({
  type: "object", additionalProperties: false, required: ["approvalRequestId", "version"],
  properties: { approvalRequestId: POSITIVE_SAFE_INTEGER, version: POSITIVE_SAFE_INTEGER }
});

const APPROVAL_USER = Object.freeze({ type: ["object", "null"], additionalProperties: false, required: ["id", "username", "displayName"], properties: { id: POSITIVE_SAFE_INTEGER, username: { type: "string" }, displayName: { type: "string" } } });
const APPROVAL_STATUS = Object.freeze({ type: "string", enum: ["pending", "approved", "rejected", "withdrawn", "invalidated"] });
export const CUSTOMER_APPROVAL_ID_PARAMS = Object.freeze({ type: "object", required: ["id"], additionalProperties: false, properties: { id: POSITIVE_SAFE_INTEGER } });
export const CUSTOMER_APPROVAL_QUEUE_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: { scope: { type: "string", enum: ["mine", "all", "unassigned"], default: "mine" }, status: { ...APPROVAL_STATUS, default: "pending" }, requesterId: POSITIVE_SAFE_INTEGER, requestedFrom: NONNEGATIVE_SAFE_INTEGER, requestedTo: NONNEGATIVE_SAFE_INTEGER, page: { ...POSITIVE_SAFE_INTEGER, default: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 } }
});
const APPROVAL_SUMMARY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "customerId", "customerCode", "legalName", "customerStatus", "status", "requester", "assignedApprover", "requestNote", "requestedAt", "decidedAt", "version"],
  properties: { id: POSITIVE_SAFE_INTEGER, customerId: POSITIVE_SAFE_INTEGER, customerCode: { type: "string" }, legalName: { type: "string" }, customerStatus: { type: "string", enum: ["draft", "pending_approval", "active", "suspended", "blocked", "archived"] }, status: APPROVAL_STATUS, requester: APPROVAL_USER, assignedApprover: APPROVAL_USER, requestNote: { type: "string" }, requestedAt: NONNEGATIVE_SAFE_INTEGER, decidedAt: { type: ["integer", "null"], minimum: 0 }, version: POSITIVE_SAFE_INTEGER }
});
export const CUSTOMER_APPROVAL_LIST_RESPONSE = Object.freeze({ type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"], properties: { items: { type: "array", items: APPROVAL_SUMMARY }, total: { type: "integer", minimum: 0 }, page: POSITIVE_SAFE_INTEGER, pageSize: POSITIVE_SAFE_INTEGER } });
export const CUSTOMER_APPROVAL_DETAIL = Object.freeze({
  type: "object", additionalProperties: false,
  required: [...APPROVAL_SUMMARY.required, "decidedBy", "decisionReason", "customerVersion", "currentCustomerVersion", "stale", "submitted", "current", "changedFields"],
  properties: { ...APPROVAL_SUMMARY.properties, decidedBy: APPROVAL_USER, decisionReason: { type: "string" }, customerVersion: POSITIVE_SAFE_INTEGER, currentCustomerVersion: POSITIVE_SAFE_INTEGER, stale: { type: "boolean" }, submitted: { type: "object" }, current: { type: "object" }, changedFields: { type: "array", items: { type: "string" } } }
});
const APPROVAL_DECISION_FIELDS = Object.freeze({ password: { type: "string", minLength: 1, maxLength: 1024 }, version: POSITIVE_SAFE_INTEGER });
export const CUSTOMER_APPROVAL_APPROVE = Object.freeze({ type: "object", additionalProperties: false, required: ["password", "version"], properties: { ...APPROVAL_DECISION_FIELDS, reason: { type: "string", trim: true, maxLength: 500 } } });
export const CUSTOMER_APPROVAL_REJECT = Object.freeze({ type: "object", additionalProperties: false, required: ["password", "version", "reason"], properties: { ...APPROVAL_DECISION_FIELDS, reason: { type: "string", trim: true, minLength: 5, maxLength: 500 } } });
export const CUSTOMER_APPROVAL_REASSIGN = Object.freeze({ type: "object", additionalProperties: false, required: ["password", "version", "approverUserId", "reason"], properties: { ...APPROVAL_DECISION_FIELDS, approverUserId: POSITIVE_SAFE_INTEGER, reason: { type: "string", trim: true, minLength: 5, maxLength: 500 } } });
export const CUSTOMER_APPROVAL_DECISION_RESPONSE = Object.freeze({ type: "object", additionalProperties: false, required: ["id", "customerId", "customerStatus", "status", "version", "replayed"], properties: { id: POSITIVE_SAFE_INTEGER, customerId: POSITIVE_SAFE_INTEGER, customerStatus: { type: "string", enum: ["draft", "active", "pending_approval"] }, status: APPROVAL_STATUS, version: POSITIVE_SAFE_INTEGER, replayed: { type: "boolean" } } });
export const CUSTOMER_APPROVAL_REASSIGN_RESPONSE = Object.freeze({ type: "object", additionalProperties: false, required: ["id", "assignedApproverId", "version", "replayed"], properties: { id: POSITIVE_SAFE_INTEGER, assignedApproverId: POSITIVE_SAFE_INTEGER, version: POSITIVE_SAFE_INTEGER, replayed: { type: "boolean" } } });
export const CUSTOMER_APPROVER_QUERY = Object.freeze({ type: "object", additionalProperties: false, properties: { q: TEXT(190), excludeUserId: POSITIVE_SAFE_INTEGER } });
export const CUSTOMER_APPROVER_RESPONSE = Object.freeze({ type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "username", "displayName"], properties: { id: POSITIVE_SAFE_INTEGER, username: { type: "string" }, displayName: { type: "string" } } } } } });

const REASON = Object.freeze({ type: "string", trim: true, minLength: 5, maxLength: 500 });
const PASSWORD = Object.freeze({ type: "string", minLength: 1, maxLength: 1024 });

export const CUSTOMER_ACTIVATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["version"],
  properties: { version: POSITIVE_SAFE_INTEGER, approverUserId: POSITIVE_SAFE_INTEGER, requestNote: { type: "string", trim: true, maxLength: 500 } }
});

export const CUSTOMER_LIFECYCLE = Object.freeze({
  type: "object", additionalProperties: false, required: ["version", "reason", "password"],
  properties: { version: POSITIVE_SAFE_INTEGER, reason: REASON, password: PASSWORD }
});

export const CUSTOMER_CODE_CHANGE = Object.freeze({
  type: "object", additionalProperties: false, required: ["customerCode", "version", "reason", "password"],
  properties: { customerCode: TEXT(64), version: POSITIVE_SAFE_INTEGER, reason: REASON, password: PASSWORD }
});

export const CUSTOMER_DELETE = CUSTOMER_LIFECYCLE;

export const CUSTOMER_DELETE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["id"], properties: { id: POSITIVE_SAFE_INTEGER }
});

export const CUSTOMER_ACTIVATION_RESPONSE = Object.freeze({ anyOf: [CUSTOMER_DETAIL, CUSTOMER_APPROVAL_RESPONSE] });

export const CUSTOMER_LIST_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
  properties: { items: { type: "array", items: CUSTOMER_SUMMARY }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 } }
});

const childListResponse = (item) => Object.freeze({
  type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
  properties: { items: { type: "array", items: item }, total: { type: "integer", minimum: 0 }, page: POSITIVE_SAFE_INTEGER, pageSize: POSITIVE_SAFE_INTEGER }
});

export const CUSTOMER_ADDRESS_LIST_RESPONSE = childListResponse(DETAIL_ADDRESS);
export const CUSTOMER_CONTACT_LIST_RESPONSE = childListResponse(DETAIL_CONTACT);
export const CUSTOMER_IDENTIFIER_LIST_RESPONSE = childListResponse(IDENTIFIER_RESPONSE);

export const DUPLICATE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["code", "legalName", "tradingName"],
  properties: { code: { type: "array", items: CUSTOMER_SUMMARY }, legalName: { type: "array", items: CUSTOMER_SUMMARY }, tradingName: { type: "array", items: CUSTOMER_SUMMARY } }
});

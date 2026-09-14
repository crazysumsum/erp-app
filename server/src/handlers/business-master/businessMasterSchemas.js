export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
export const VIEW_POLICY = Object.freeze([{ name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["business_master.view"]) }) }]);
export const MGMT_POLICY = Object.freeze([{ name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["business_master.mgmt"]) }) }]);

export const VERSION = Object.freeze({ type: "integer", minimum: 1 });
export const REASON = Object.freeze({ type: "string", trim: true, minLength: 5, maxLength: 190 });
export const TOKEN = Object.freeze({ type: "string", minLength: 10, maxLength: 32768 });
export const CURRENCY_CODE = Object.freeze({ type: "string", pattern: "^[A-Z]{3}$" });
export const CURRENCY_CODE_INPUT = Object.freeze({ type: "string", trim: true, pattern: "^[A-Z]{3}$" });
export const TERM_ID_PARAMS = Object.freeze({ type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } } });
export const CURRENCY_PARAMS = Object.freeze({ type: "object", required: ["code"], additionalProperties: false, properties: { code: CURRENCY_CODE } });

export const LIST_QUERY = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    q: { type: "string", maxLength: 100 },
    status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
    page: { type: "string", pattern: "^[1-9][0-9]*$" },
    pageSize: { type: "string", enum: ["10", "20", "50", "100"] },
    sort: { type: "string", enum: ["code", "name", "status", "updatedAt"] },
    descending: { type: "string", enum: ["true", "false"] }
  }
});

export const CURRENCY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["code", "name", "decimalPlaces", "status", "version", "createdAt", "updatedAt"],
  properties: { code: CURRENCY_CODE, name: { type: "string", minLength: 1, maxLength: 100 }, decimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, version: VERSION, createdAt: { type: "integer", minimum: 0 }, updatedAt: { type: "integer", minimum: 0 } }
});

export const PAYMENT_TERM = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "code", "name", "description", "calculationType", "dueDays", "status", "version", "createdAt", "updatedAt"],
  properties: { id: { type: "integer", minimum: 1 }, code: { type: "string", minLength: 1, maxLength: 50 }, name: { type: "string", minLength: 1, maxLength: 100 }, description: { type: "string", maxLength: 500 }, calculationType: { type: "string", enum: ["IMMEDIATE", "NET_DAYS", "END_OF_MONTH", "MANUAL"] }, dueDays: { type: ["integer", "null"], minimum: 0, maximum: 3650 }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, version: VERSION, createdAt: { type: "integer", minimum: 0 }, updatedAt: { type: "integer", minimum: 0 } }
});

export const CURRENCY_LIST = Object.freeze({ type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"], properties: { items: { type: "array", items: CURRENCY }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 } } });
export const PAYMENT_TERM_LIST = Object.freeze({ type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"], properties: { items: { type: "array", items: PAYMENT_TERM }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 } } });

const IMPACT_RESULT = Object.freeze({ type: "object", additionalProperties: false, required: ["checkerId", "status", "activeDefaultCount", "openUseCount", "historicalCount", "watermark"], properties: { checkerId: { type: "string" }, status: { type: "string", enum: ["READY", "NOT_INSTALLED"] }, activeDefaultCount: { type: "integer", minimum: 0 }, openUseCount: { type: "integer", minimum: 0 }, historicalCount: { type: "integer", minimum: 0 }, watermark: { type: "string" } } });
const STATUS_CHANGE = Object.freeze({ type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["INACTIVE"] } } });
const PRECISION_CHANGE = Object.freeze({ type: "object", additionalProperties: false, required: ["decimalPlaces"], properties: { decimalPlaces: { type: "integer", minimum: 0, maximum: 4 } } });
const RULE_CHANGE = Object.freeze({ type: "object", additionalProperties: false, required: ["calculationType", "dueDays"], properties: { calculationType: { type: "string", enum: ["IMMEDIATE", "NET_DAYS", "END_OF_MONTH", "MANUAL"] }, dueDays: { type: ["integer", "null"], minimum: 0, maximum: 3650 } } });
const PROPOSED_CHANGE = Object.freeze({ oneOf: [STATUS_CHANGE, PRECISION_CHANGE, RULE_CHANGE] });
export const IMPACT_RESPONSE = Object.freeze({ type: "object", additionalProperties: false, required: ["actorId", "entityType", "entityKey", "version", "operation", "proposedChange", "issuedAt", "results", "expiresAt", "impactToken"], properties: { actorId: { type: "integer" }, entityType: { type: "string", enum: ["CURRENCY", "PAYMENT_TERM"] }, entityKey: { type: "string" }, version: VERSION, operation: { type: "string", enum: ["DEACTIVATE", "CHANGE_PRECISION", "CHANGE_RULE"] }, proposedChange: PROPOSED_CHANGE, issuedAt: { type: "integer" }, expiresAt: { type: "integer" }, results: { type: "array", items: IMPACT_RESULT }, impactToken: TOKEN } });

const AUDIT_SNAPSHOT = Object.freeze({ anyOf: [CURRENCY, PAYMENT_TERM, { type: "null" }] });
const AUDIT_IMPACT = Object.freeze({ anyOf: [{ type: "object", additionalProperties: false, required: ["results", "issuedAt"], properties: { results: { type: "array", items: IMPACT_RESULT }, issuedAt: { type: "integer" } } }, { type: "null" }] });
const AUDIT_ENTRY = Object.freeze({ type: "object", additionalProperties: false, required: ["id", "entityType", "entityKey", "action", "result", "before", "after", "impact", "reason", "actorUserId", "correlationId", "createdAt"], properties: { id: { type: "integer", minimum: 1 }, entityType: { type: "string", enum: ["CURRENCY", "PAYMENT_TERM"] }, entityKey: { type: "string" }, action: { type: "string", enum: ["CREATE", "UPDATE", "ACTIVATE", "DEACTIVATE", "CHANGE_PRECISION", "CHANGE_RULE"] }, result: { type: "string", enum: ["SUCCESS", "REJECTED"] }, before: AUDIT_SNAPSHOT, after: AUDIT_SNAPSHOT, impact: AUDIT_IMPACT, reason: { type: "string", maxLength: 190 }, actorUserId: { type: ["integer", "null"], minimum: 1 }, correlationId: { type: "string", maxLength: 64 }, createdAt: { type: "integer", minimum: 0 } } });
export const AUDIT_LIST = Object.freeze({ type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"], properties: { items: { type: "array", items: AUDIT_ENTRY }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 } } });

export function listInput(query = {}) {
  return { q: query.q, status: query.status, page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 20), sort: query.sort, descending: query.descending === "true" };
}

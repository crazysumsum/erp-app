import { normalizeMoney } from "./salesMoneyMath.js";
import { salesEventId, salesReason } from "./salesValidation.js";

const DOCUMENT = ["version", "lineCount", "totalAmount", "currencyCode"];
const TRANSITION = ["fromStatus", "toStatus", "version"];
const CONVERSION = ["quotationId", "salesOrderId", "addedCount", "removedCount", "quantityChangedCount", "priceChangedCount", "differenceHash"];
const BUILDERS = Object.freeze({ "sales_quotation.created": DOCUMENT, "sales_quotation.updated": DOCUMENT,
  "sales_order.created": DOCUMENT, "sales_order.updated": DOCUMENT, "sales_quotation.issued": TRANSITION,
  "sales_quotation.expired": TRANSITION, "sales_quotation.cancelled": TRANSITION, "sales_quotation.converted": CONVERSION });
const STATUSES = ["DRAFT", "ISSUED", "EXPIRED", "CANCELLED", "CONVERTED"];
function bounded(value, maximum, { ascii = false, empty = false } = {}) {
  if (typeof value !== "string" || !empty && !value || [...value].length > maximum ||
      (ascii ? /[^\x20-\x7e]/u.test(value) : [...value].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 127))) throw new TypeError("Invalid Sales audit label");
  return value;
}
function positive(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid Sales audit identifier");
  return value;
}
function detailsFor(action, details) {
  const fields = BUILDERS[action];
  if (!fields || !details || Object.keys(details).sort().join(",") !== [...fields].sort().join(",")) throw new TypeError("Invalid Sales audit details");
  for (const [key, value] of Object.entries(details)) {
    if (key === "totalAmount") { if (typeof value !== "string" || normalizeMoney(value) !== value) throw new TypeError("Invalid Sales audit amount"); }
    else if (key === "currencyCode") { if (typeof value !== "string" || !/^[A-Z]{3}$/u.test(value)) throw new TypeError("Invalid Sales audit currency"); }
    else if (key === "differenceHash") { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError("Invalid Sales audit hash"); }
    else if (key === "fromStatus" || key === "toStatus") { if (!STATUSES.includes(value)) throw new TypeError("Invalid Sales audit status"); }
    else if (key.endsWith("Count")) { if (!Number.isSafeInteger(value) || value < (key === "lineCount" ? 1 : 0) || value > 100) throw new TypeError("Invalid Sales audit count"); }
    else positive(value);
  }
  return JSON.stringify(Object.fromEntries(fields.map(field => [field, details[field]])));
}

export class SalesAuditService {
  async record(connection, { actor, action, targetId, targetNumber, eventId, details, nowMs, reason = "", requestId = "", correlationId = "", ipAddress = "" }) {
    const summary = detailsFor(action, details);
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("Invalid Sales audit timestamp");
    await connection.execute(`INSERT INTO sales_audit_logs
      (occurred_at, actor_user_id, actor_label, action, target_type, target_id, target_number, outcome, reason, details,
        event_id, request_id, correlation_id, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?, ?)`,
    [nowMs, actor.id === null ? null : positive(actor.id), bounded(actor.username, 190), action, action.startsWith("sales_quotation.") ? "QUOTATION" : "ORDER",
      positive(targetId), bounded(targetNumber, 30, { ascii: true }), reason === "" ? "" : salesReason(reason), summary, salesEventId(eventId),
      bounded(requestId, 64, { ascii: true, empty: true }), bounded(correlationId, 64, { ascii: true, empty: true }), bounded(ipAddress, 45, { ascii: true, empty: true })]);
  }
}

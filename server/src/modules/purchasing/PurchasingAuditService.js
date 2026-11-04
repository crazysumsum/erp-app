import { reason as validReason } from "./purchasingValidation.js";

const DOCUMENT = ["version", "lineCount", "totalAmount", "currencyCode"];
// 每個 action 固定 target type 同 detail 欄位（設計 §12.2）；其餘 §12.2 action 由用到嘅 Task 加 builder。
const ACTIONS = Object.freeze({
  "purchase_order.created": { target: "PO", fields: DOCUMENT },
  "purchase_order.updated": { target: "PO", fields: DOCUMENT },
  "purchase_order.copied": { target: "PO", fields: [...DOCUMENT, "sourcePurchaseOrderId"] },
  "purchase_order.confirmed": { target: "PO", fields: [...DOCUMENT, "policyVersion"] }
});
// 冇業務寫入嘅拒絕結果（§4.15）：同名 action 加 outcome REJECTED；同 event 唔同內容另用 operation_conflict（§12.2）。
const REJECTABLE = new Set([...Object.keys(ACTIONS), "purchasing.operation_conflict"]);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const AMOUNT = /^(0|[1-9][0-9]{0,20})(\.[0-9]{1,4})?$/u; // DECIMAL(25,4)
const CURRENCY_CODE = /^[A-Z]{3}$/u;

function positive(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid Purchasing audit identifier");
  return value;
}
function bounded(value, maximum, { ascii = false, empty = false } = {}) {
  if (typeof value !== "string" || !empty && !value || [...value].length > maximum ||
      (ascii ? /[^\x20-\x7e]/u.test(value) : [...value].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 127))) throw new TypeError("Invalid Purchasing audit label");
  return value;
}
function detailFor(fields, detail) {
  if (!detail || Object.keys(detail).sort().join(",") !== [...fields].sort().join(",")) throw new TypeError("Invalid Purchasing audit detail");
  for (const [key, value] of Object.entries(detail)) {
    if (key === "totalAmount") { if (typeof value !== "string" || !AMOUNT.test(value)) throw new TypeError("Invalid Purchasing audit amount"); }
    else if (key === "currencyCode") { if (typeof value !== "string" || !CURRENCY_CODE.test(value)) throw new TypeError("Invalid Purchasing audit currency"); }
    else if (key === "lineCount") { if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new TypeError("Invalid Purchasing audit count"); }
    else positive(value);
  }
  return JSON.stringify(Object.fromEntries(fields.map(field => [field, detail[field]])));
}

/**
 * 成功命令嘅必要 Audit（設計 §2.5 第 7 步、§4.15）：同業務寫入同一個 transaction，INSERT 失敗就成單 rollback。
 * Detail 只有 allowlist 欄位，唔存 request body；大小上限跟 `purchasing.auditDetailMaxBytes`。
 */
export class PurchasingAuditService {
  constructor({ auditDetailMaxBytes }) { this.auditDetailMaxBytes = positive(auditDetailMaxBytes); }

  async record(connection, { actor, action, targetId, targetLabel, detail, nowMs, reason = "", requestId = "", correlationId = "", ip = "" }) {
    if (!Object.hasOwn(ACTIONS, action)) throw new TypeError("Unsupported Purchasing audit action");
    const { target, fields } = ACTIONS[action], json = detailFor(fields, detail);
    if (Buffer.byteLength(json, "utf8") > this.auditDetailMaxBytes) throw new TypeError("Purchasing audit detail too large");
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("Invalid Purchasing audit timestamp");
    await connection.execute(`INSERT INTO purchasing_audit_logs
      (occurred_at, actor_user_id, actor_label, action, outcome, target_type, target_id, purchase_order_id, target_label, reason, detail,
        request_id, correlation_id, ip) VALUES (?, ?, ?, ?, 'SUCCEEDED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nowMs, positive(actor?.id), bounded(actor.username, 190), action, target, positive(targetId), target === "PO" ? targetId : null,
      bounded(targetLabel, 190, { ascii: true }), reason === "" ? "" : validReason(reason), json,
      bounded(requestId, 64, { ascii: true, empty: true }), bounded(correlationId, 64, { ascii: true, empty: true }), bounded(ip, 45, { ascii: true, empty: true })]);
  }

  /**
   * 拒絕結果用 caller 開嘅獨立短 transaction 寫（§4.15），因為業務 transaction 已經 rollback。Actor label 喺 DB 讀，
   * 因為 PERMISSION_STALE 嗰陣未必攞到 fresh actor；user 唔存在就寫唔到，caller 要記 security log，唔可以當已持久化。
   */
  async recordRejected(connection, { actorId, action, targetId = null, code, nowMs, requestId = "", correlationId = "", ip = "" }) {
    if (!REJECTABLE.has(action) || typeof code !== "string" || !ERROR_CODE.test(code)) throw new TypeError("Unsupported Purchasing rejected audit");
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("Invalid Purchasing audit timestamp");
    const target = targetId === null ? null : positive(targetId);
    const [row] = await connection.execute(`INSERT INTO purchasing_audit_logs
      (occurred_at, actor_user_id, actor_label, action, outcome, target_type, target_id, purchase_order_id, detail, request_id, correlation_id, ip)
      SELECT ?, id, username, ?, 'REJECTED', 'PO', ?, ?, ?, ?, ?, ? FROM users WHERE id = ?`,
    [nowMs, action, target, target, JSON.stringify({ code }), bounded(requestId, 64, { ascii: true, empty: true }),
      bounded(correlationId, 64, { ascii: true, empty: true }), bounded(ip, 45, { ascii: true, empty: true }), positive(actorId)]);
    if (Number(row.affectedRows) !== 1) throw new TypeError("Purchasing rejected audit actor not found");
  }
}

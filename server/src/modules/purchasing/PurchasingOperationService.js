import { createHash } from "node:crypto";
import { purchasingError } from "./purchasingErrors.js";
import { eventId as validEventId } from "./purchasingValidation.js";

// Server allowlist：command → source document type。之後嘅 Task 用到先加（設計 §4.14）。
const COMMANDS = Object.freeze({
  CREATE_PURCHASE_ORDER: "PURCHASE_ORDER",
  UPDATE_PURCHASE_ORDER: "PURCHASE_ORDER",
  COPY_PURCHASE_ORDER: "PURCHASE_ORDER",
  SUBMIT_PURCHASE_ORDER: "PURCHASE_ORDER",
  APPROVE_PURCHASE_ORDER: "PURCHASE_ORDER",
  REJECT_PURCHASE_ORDER: "PURCHASE_ORDER",
  WITHDRAW_APPROVAL_PURCHASE_ORDER: "PURCHASE_ORDER",
  UPDATE_PURCHASING_SETTINGS: "SETTING"
});
const PO_STATUSES = ["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED", "CANCELLED"];

function identifier(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid Purchasing operation identifier");
  return value;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid Purchasing operation timestamp");
  return value;
}
function trace(value = "") {
  if (typeof value !== "string" || !/^[\x20-\x7e]{0,64}$/u.test(value)) throw new TypeError("Invalid Purchasing operation trace");
  return value;
}
function sourceKey(value = "") {
  if (typeof value !== "string" || !/^[0-9]{0,20}$/u.test(value)) throw new TypeError("Invalid Purchasing operation source");
  return value;
}
function actorLabel(actor) {
  const label = actor?.username;
  if (typeof label !== "string" || !label || [...label].length > 190 ||
      [...label].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)) throw new TypeError("Invalid Purchasing actor label");
  return label;
}

/**
 * Canonical JSON：key 排序、只收 safe integer／string／boolean／null／array／plain object。
 * `password` 喺任何一層都唔入 hash（設計 §2.7）；decimal 用字串，所以 "1.50" 同 "1.5" 係兩個 payload。
 */
export function purchasingPayloadHash(commandType, payload) {
  const seen = new Set();
  const canonical = (value) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (!value || typeof value !== "object" || seen.has(value) ||
        !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("Invalid Purchasing operation payload");
    seen.add(value);
    const result = Array.isArray(value)
      ? Array.from({ length: value.length }, (_, index) => {
        if (!Object.hasOwn(value, index)) throw new TypeError("Invalid Purchasing operation payload");
        return canonical(value[index]);
      })
      : Object.fromEntries(Object.keys(value).filter(key => key !== "password").sort().map(key => [key, canonical(value[key])]));
    seen.delete(value);
    return result;
  };
  return createHash("sha256").update(JSON.stringify({ commandType, payload: canonical(payload) }), "utf8").digest("hex");
}

function safeResult(value) {
  const result = typeof value === "string" ? JSON.parse(value) : value;
  if (result && Object.keys(result).sort().join(",") === "requirePoApproval,version" && typeof result.requirePoApproval === "boolean") {
    return { requirePoApproval: result.requirePoApproval, version: identifier(result.version) };
  }
  if (!result || Object.keys(result).sort().join(",") !== "id,number,status,version" ||
      typeof result.number !== "string" || !/^PO-\d{6}-\d{6}$/u.test(result.number) || !PO_STATUSES.includes(result.status)) throw new TypeError("Invalid Purchasing operation result");
  identifier(result.id); identifier(result.version);
  return { id: result.id, number: result.number, status: result.status, version: result.version };
}

/**
 * Domain event claim／complete（設計 §2.5 第 2、8 步；§2.7；§4.14）。Claim 同業務效果同一個 transaction，
 * 所以冇永久 IN_PROGRESS：同 event 嘅第二個請求會喺 unique key 度等第一個 commit／rollback。
 * Caller 喺 claim 之前驗咗 actor 同權限；replay 唔再驗會變嘅主檔。
 */
export class PurchasingOperationService {
  async claim(connection, { commandType, sourceDocumentId = "", sourceLineId = "", eventId, payload, actor, nowMs, requestId = "", correlationId = "" }) {
    if (!Object.hasOwn(COMMANDS, commandType)) throw new TypeError("Unsupported Purchasing command");
    const sourceType = COMMANDS[commandType], hash = purchasingPayloadHash(commandType, payload);
    const actorId = identifier(actor?.id), label = actorLabel(actor);
    const key = [sourceType, sourceKey(sourceDocumentId), sourceKey(sourceLineId), validEventId(eventId)];
    try {
      const [row] = await connection.execute(`INSERT INTO purchasing_operation_requests
        (command_type, source_document_type, source_document_id, source_line_id, event_id, request_hash,
          actor_user_id, actor_label, request_id, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [commandType, ...key, hash, actorId, label, trace(requestId), trace(correlationId), timestamp(nowMs)]);
      return { operationId: identifier(Number(row.insertId)), replay: null };
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) !== "ER_DUP_ENTRY") throw error;
      const [[row]] = await connection.query(`SELECT id, command_type, request_hash, actor_user_id, result_summary, completed_at
        FROM purchasing_operation_requests WHERE source_document_type = ? AND source_document_id = ? AND source_line_id = ? AND event_id = ?
        FOR UPDATE`, key);
      // 另一個 actor 用同一個 eventId 都當衝突，唔會將人哋嘅結果 replay 出去。
      if (!row || row.request_hash !== hash || row.command_type !== commandType || Number(row.actor_user_id) !== actorId) throw purchasingError("PURCHASING_EVENT_CONFLICT");
      // 只有同一個 transaction 重複 claim 先會見到未完成嘅 row。
      if (row.completed_at === null) throw purchasingError("CONCURRENT_OPERATION");
      return { operationId: identifier(Number(row.id)), replay: safeResult(row.result_summary) };
    }
  }

  async complete(connection, { operationId, result, nowMs }) {
    const summary = safeResult(result);
    const [resultType, resultId] = summary.id ? ["PO", String(summary.id)] : ["SETTING", "1"];
    const [row] = await connection.execute(`UPDATE purchasing_operation_requests SET result_type = ?, result_id = ?, result_summary = ?,
      completed_at = ? WHERE id = ? AND completed_at IS NULL`, [resultType, resultId, JSON.stringify(summary), timestamp(nowMs), identifier(operationId)]);
    if (Number(row.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");
  }

  /** 用既有 `withTransaction()`（REPEATABLE READ），只將 DB 層錯誤譯成 §5.7 嘅公開錯誤碼。 */
  async run(database, work, options) {
    try { return await database.withTransaction(work, options); }
    catch (error) {
      if (error.code === "DATABASE_TRANSACTION_INDETERMINATE") throw purchasingError("TRANSACTION_OUTCOME_UNKNOWN");
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.cause?.code ?? error.code)) throw purchasingError("CONCURRENT_OPERATION");
      throw error;
    }
  }
}

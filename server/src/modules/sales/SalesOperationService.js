import { salesPayloadHash } from "./salesCanonicalHash.js";
import { salesError, SALES_ERROR_STATUS } from "./salesErrors.js";
import { salesEventId } from "./salesValidation.js";

const TARGETS = Object.freeze({ CREATE_QUOTATION: "QUOTATION", UPDATE_QUOTATION: "QUOTATION", ISSUE_QUOTATION: "QUOTATION",
  CANCEL_QUOTATION: "QUOTATION", CONVERT_QUOTATION: "QUOTATION", CREATE_ORDER: "SALES_ORDER", UPDATE_ORDER: "SALES_ORDER", WITHDRAW_ORDER: "SALES_ORDER", CANCEL_ORDER: "SALES_ORDER", CLOSE_REMAINING_ORDER: "SALES_ORDER", CONFIRM_IMPORT: "IMPORT_JOB", CANCEL_IMPORT: "IMPORT_JOB" });
const STATUSES = ["DRAFT", "ISSUED", "EXPIRED", "CANCELLED", "CONVERTED", "CONFIRMED", "CLOSED"];
function identifier(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid Sales operation identifier");
  return value;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid Sales operation timestamp");
  return value;
}
function trace(value = "") {
  if (typeof value !== "string" || !/^[\x20-\x7e]{0,64}$/u.test(value)) throw new TypeError("Invalid Sales operation trace");
  return value;
}
function safeResult(value) {
  const result = typeof value === "string" ? JSON.parse(value) : value;
  if (!result || Object.keys(result).sort().join(",") !== "id,number,status,version" ||
      typeof result.number !== "string" || !/^(SO|QT|SI)-\d{6}-\d{6}$/u.test(result.number) ||
      !(result.number.startsWith("SI-") ? ["QUEUED","CANCELLED"] : STATUSES).includes(result.status)) throw new TypeError("Invalid Sales operation result");
  identifier(result.id); identifier(result.version);
  return { id: result.id, number: result.number, status: result.status, version: result.version };
}

export class SalesOperationService {
  async claimConfirmation(connection, { eventId, targetId, payload, actor, nowMs, leaseOwner, leaseMs, requestId, correlationId }) {
    salesEventId(eventId); salesEventId(leaseOwner); identifier(targetId); identifier(actor.id); timestamp(nowMs);
    if (!payload || Object.keys(payload).join(",") !== "version" || !Number.isSafeInteger(payload.version) || payload.version < 1 ||
        !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 2147483647 || typeof actor.username !== "string" ||
        !actor.username || [...actor.username].length > 190 || /[\p{Cc}]/u.test(actor.username)) throw new TypeError("Invalid confirmation intent");
    const hash = salesPayloadHash(payload);
    try {
      const [row] = await connection.execute(`INSERT INTO sales_operation_requests
        (event_id,command_type,target_type,target_id,request_hash,recovery_payload,status,actor_user_id,actor_label,
          request_id,correlation_id,lease_owner,lease_until,created_at,updated_at)
        VALUES (?,'CONFIRM_ORDER','SALES_ORDER',?,?,?,'IN_PROGRESS',?,?,?,?,?,
          CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)+?,?,?)`,
      [eventId,targetId,hash,JSON.stringify(payload),actor.id,actor.username,trace(requestId),trace(correlationId),leaseOwner,leaseMs,nowMs,nowMs]);
      return { operationId: identifier(Number(row.insertId)), eventId, status: "IN_PROGRESS", leaseOwner, replay: null };
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) !== "ER_DUP_ENTRY") throw error;
      const [[row]] = await connection.query(`SELECT id,command_type,target_type,target_id,request_hash,actor_user_id,
        status,result_summary,error_code,recovery_payload,lease_owner,lease_until FROM sales_operation_requests WHERE event_id=? FOR UPDATE`, [eventId]);
      if (!row || row.request_hash !== hash || Number(row.actor_user_id) !== actor.id || row.command_type !== "CONFIRM_ORDER" ||
          row.target_type !== "SALES_ORDER" || Number(row.target_id) !== targetId) throw salesError("SALES_EVENT_CONFLICT");
      if (row.status === "FAILED") throw salesError(Object.hasOwn(SALES_ERROR_STATUS, row.error_code) ? row.error_code : "SALES_DEPENDENCY_UNAVAILABLE");
      if (row.status === "SUCCEEDED") return { operationId: identifier(Number(row.id)), eventId, status: "SUCCEEDED", leaseOwner: null, replay: safeResult(row.result_summary) };
      if (row.status !== "IN_PROGRESS") throw salesError("CONCURRENT_OPERATION");
      const stored = typeof row.recovery_payload === "string" ? JSON.parse(row.recovery_payload) : row.recovery_payload;
      if (salesPayloadHash(stored) !== hash) throw salesError("SALES_EVENT_CONFLICT");
      salesEventId(row.lease_owner);
      if (!Number.isSafeInteger(Number(row.lease_until)) || Number(row.lease_until) < 0) throw salesError("CONCURRENT_OPERATION");
      return { operationId: identifier(Number(row.id)), eventId, status: "IN_PROGRESS", leaseOwner: row.lease_owner, replay: null };
    }
  }

  // Callers verify fresh actor/aggregate access before claim or lookup; completed replay never revalidates mutable masters.
  async claim(connection, { eventId, commandType, targetId = null, payload, actor, nowMs, requestId, correlationId }) {
    salesEventId(eventId);
    if (!Object.hasOwn(TARGETS, commandType)) throw new TypeError("Unsupported Sales command");
    const targetType = TARGETS[commandType], hash = salesPayloadHash(payload);
    const actorId = identifier(actor.id);
    if (typeof actor.username !== "string" || !actor.username || [...actor.username].length > 190 ||
        [...actor.username].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)) throw new TypeError("Invalid Sales actor label");
    if (targetId !== null) identifier(targetId);
    timestamp(nowMs); requestId = trace(requestId); correlationId = trace(correlationId);
    try {
      const [row] = await connection.execute(`INSERT INTO sales_operation_requests
        (event_id, command_type, target_type, target_id, request_hash, status, actor_user_id, actor_label,
          request_id, correlation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?)`,
      [eventId, commandType, targetType, targetId, hash, actorId, actor.username, requestId, correlationId, nowMs, nowMs]);
      return { operationId: identifier(Number(row.insertId)), replay: null };
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) !== "ER_DUP_ENTRY") throw error;
      const [[row]] = await connection.query(`SELECT id, command_type, target_type, target_id, request_hash, actor_user_id,
        status, result_summary, error_code FROM sales_operation_requests WHERE event_id = ? FOR UPDATE`, [eventId]);
      if (!row || row.request_hash !== hash || Number(row.actor_user_id) !== actorId || row.command_type !== commandType ||
          row.target_type !== targetType || (row.target_id === null ? null : Number(row.target_id)) !== targetId) throw salesError("SALES_EVENT_CONFLICT");
      if (row.status === "FAILED" && Object.hasOwn(SALES_ERROR_STATUS, row.error_code)) throw salesError(row.error_code);
      if (row.status !== "SUCCEEDED") throw salesError("CONCURRENT_OPERATION");
      return { operationId: identifier(Number(row.id)), replay: safeResult(row.result_summary) };
    }
  }

  async succeed(connection, { operationId, result, nowMs }) {
    const summary = safeResult(result), resultType = summary.number.startsWith("QT-") ? "QUOTATION" : summary.number.startsWith("SI-") ? "IMPORT_JOB" : "SALES_ORDER";
    const [row] = await connection.execute(`UPDATE sales_operation_requests SET status = 'SUCCEEDED', result_type = ?, result_id = ?,
      result_summary = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'IN_PROGRESS'`,
    [resultType, summary.id, JSON.stringify(summary), timestamp(nowMs), nowMs, identifier(operationId)]);
    if (Number(row.affectedRows) !== 1) throw salesError("CONCURRENT_OPERATION");
  }

  async getForActor(connection, { eventId, actor }) {
    const [[row]] = await connection.query(`SELECT status, result_summary, error_code FROM sales_operation_requests
      WHERE event_id = ? AND actor_user_id = ? AND target_type IN ('SALES_ORDER','QUOTATION')`, [salesEventId(eventId), identifier(actor.id)]);
    if (!row) return null;
    return { status: row.status, result: row.status === "SUCCEEDED" ? safeResult(row.result_summary) : null,
      ...(row.status === "FAILED" ? { errorCode: Object.hasOwn(SALES_ERROR_STATUS, row.error_code) ? row.error_code : "SALES_DEPENDENCY_UNAVAILABLE" } : {}) };
  }

  async run(database, work, options) {
    try { return await database.withTransaction(work, options); }
    catch (error) {
      if (error.code === "DATABASE_TRANSACTION_INDETERMINATE") throw salesError("TRANSACTION_OUTCOME_UNKNOWN");
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.cause?.code ?? error.code)) throw salesError("CONCURRENT_OPERATION");
      throw error;
    }
  }
}

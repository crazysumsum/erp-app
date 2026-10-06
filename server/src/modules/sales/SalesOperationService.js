import { salesPayloadHash } from "./salesCanonicalHash.js";
import { salesError, SALES_ERROR_STATUS } from "./salesErrors.js";
import { salesEventId } from "./salesValidation.js";

const TARGETS = Object.freeze({ CREATE_QUOTATION: "QUOTATION", UPDATE_QUOTATION: "QUOTATION", ISSUE_QUOTATION: "QUOTATION",
  CANCEL_QUOTATION: "QUOTATION", CONVERT_QUOTATION: "QUOTATION", CREATE_ORDER: "SALES_ORDER", UPDATE_ORDER: "SALES_ORDER" });
const STATUSES = ["DRAFT", "ISSUED", "EXPIRED", "CANCELLED", "CONVERTED"];
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
      typeof result.number !== "string" || !/^(SO|QT)-\d{6}-\d{6}$/u.test(result.number) || !STATUSES.includes(result.status)) throw new TypeError("Invalid Sales operation result");
  identifier(result.id); identifier(result.version);
  return { id: result.id, number: result.number, status: result.status, version: result.version };
}

export class SalesOperationService {
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
    const summary = safeResult(result), resultType = summary.number.startsWith("QT-") ? "QUOTATION" : "SALES_ORDER";
    const [row] = await connection.execute(`UPDATE sales_operation_requests SET status = 'SUCCEEDED', result_type = ?, result_id = ?,
      result_summary = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'IN_PROGRESS'`,
    [resultType, summary.id, JSON.stringify(summary), timestamp(nowMs), nowMs, identifier(operationId)]);
    if (Number(row.affectedRows) !== 1) throw salesError("CONCURRENT_OPERATION");
  }

  async getForActor(connection, { eventId, actor }) {
    const [[row]] = await connection.query(`SELECT status, result_summary, error_code FROM sales_operation_requests
      WHERE event_id = ? AND actor_user_id = ?`, [salesEventId(eventId), identifier(actor.id)]);
    if (!row) return null;
    return { status: row.status, result: row.status === "SUCCEEDED" ? safeResult(row.result_summary) : null,
      ...(row.status === "FAILED" ? { errorCode: Object.hasOwn(SALES_ERROR_STATUS, row.error_code) ? row.error_code : "SALES_DEPENDENCY_UNAVAILABLE" } : {}) };
  }

  async run(database, work) {
    try { return await database.withTransaction(work); }
    catch (error) {
      if (error.code === "DATABASE_TRANSACTION_INDETERMINATE") throw salesError("TRANSACTION_OUTCOME_UNKNOWN");
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.cause?.code ?? error.code)) throw salesError("CONCURRENT_OPERATION");
      throw error;
    }
  }
}

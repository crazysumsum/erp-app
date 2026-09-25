import { createHash } from "node:crypto";

import { INVENTORY_COMMAND_TYPES } from "./inventoryConstants.js";
import { inventoryError } from "./inventoryErrors.js";
import {
  inventoryStringHasInvalidCharacters,
  isInventorySensitiveKey,
  parseInventorySummary,
  serializeInventorySummary
} from "./inventorySafeJson.js";

const COMMAND_TYPES = new Set(INVENTORY_COMMAND_TYPES);
const RESULT_SUMMARY_FIELDS = new Set([
  "id", "status", "version", "quantity", "rowCount", "movementGroupId",
  "reservationId", "allocationId", "transferId", "stocktakeId", "openingJobId"
]);

function assertExecutor(executor, method = "execute") {
  if (!executor || typeof executor[method] !== "function") {
    throw new TypeError(`Inventory operation requires an executor with ${method}()`);
  }
}

function boundedString(value, field, max, { empty = false, ascii = false } = {}) {
  if (typeof value !== "string" || (!empty && value.length === 0) ||
      Buffer.byteLength(value, "utf8") > max || inventoryStringHasInvalidCharacters(value, ascii)) {
    throw new TypeError(`Invalid Inventory operation ${field}`);
  }
  return value;
}

function positiveId(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if ((typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
      (typeof value === "string" && /^[1-9][0-9]*$/u.test(value))) return value;
  throw new TypeError(`Invalid Inventory operation ${field}`);
}

function timestamp(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid Inventory operation ${field}`);
  return value;
}

function sourceTuple(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Inventory operation source is required");
  }
  return {
    module: boundedString(source.module, "source module", 40, { ascii: true }),
    documentType: boundedString(source.documentType, "source document type", 50, { ascii: true }),
    documentId: boundedString(source.documentId, "source document id", 100),
    lineId: boundedString(source.lineId ?? "", "source line id", 100, { empty: true }),
    eventId: boundedString(source.eventId, "source event id", 100)
  };
}

function canonicalizeForHash(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError("Inventory operation payload contains a non-finite number");
  }
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (!value || typeof value !== "object" ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError("Inventory operation payload must contain JSON values only");
  }
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
    isInventorySensitiveKey(key) ? [] : [[key, canonicalizeForHash(value[key])]]
  )));
}

function commandType(value) {
  if (!COMMAND_TYPES.has(value)) throw new TypeError(`Unsupported Inventory command type: ${value}`);
  return value;
}

export function inventoryOperationHash({ commandType: requestedCommandType, payload }) {
  const canonical = canonicalizeForHash({ commandType: commandType(requestedCommandType), payload });
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function resultFromRow(row) {
  return {
    resultType: row.result_type ?? null,
    resultId: row.result_id ?? null,
    resultSummary: parseInventorySummary(row.result_summary, RESULT_SUMMARY_FIELDS, "Inventory result summary"),
    completedAt: Number(row.completed_at)
  };
}

export class InventoryOperationService {
  async claim(connection, input) {
    assertExecutor(connection);
    const type = commandType(input.commandType);
    const source = sourceTuple(input.source);
    const hash = inventoryOperationHash({ commandType: type, payload: input.payload });
    const actorUserId = positiveId(input.actorUserId, "actor user id", { nullable: true });
    const actorLabel = boundedString(input.actorLabel, "actor label", 190);
    const requestId = boundedString(input.requestId ?? "", "request id", 64, { empty: true, ascii: true });
    const correlationId = boundedString(input.correlationId ?? "", "correlation id", 64, { empty: true, ascii: true });
    const createdAt = timestamp(input.createdAt, "created at");

    try {
      const [result] = await connection.execute(
        `INSERT INTO inventory_operation_requests
           (command_type, source_module, source_document_type, source_document_id,
            source_line_id, source_event_id, request_hash, actor_user_id, actor_label,
            request_id, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type, source.module, source.documentType, source.documentId, source.lineId,
          source.eventId, hash, actorUserId, actorLabel, requestId, correlationId, createdAt
        ]
      );
      return { operationId: Number(result.insertId), replay: null };
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) !== "ER_DUP_ENTRY") throw error;
      const [rows] = await connection.query(
        `SELECT id, request_hash, result_type, result_id, result_summary, completed_at
           FROM inventory_operation_requests
          WHERE source_module = ? AND source_document_type = ? AND source_document_id = ?
            AND source_line_id = ? AND source_event_id = ?
          FOR UPDATE`,
        [source.module, source.documentType, source.documentId, source.lineId, source.eventId]
      );
      const row = rows[0];
      if (!row) throw error;
      if (String(row.request_hash) !== hash) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
      if (row.completed_at === null || row.completed_at === undefined) {
        throw inventoryError("CONCURRENT_OPERATION");
      }
      return { operationId: Number(row.id), replay: resultFromRow(row) };
    }
  }

  async complete(connection, { operationId, resultType, resultId, resultSummary = null, completedAt }) {
    assertExecutor(connection);
    const id = positiveId(operationId, "operation id");
    const type = boundedString(resultType, "result type", 40, { ascii: true });
    const resultIdentifier = boundedString(resultId, "result id", 100);
    const summary = serializeInventorySummary(resultSummary, RESULT_SUMMARY_FIELDS, "Inventory result summary");
    const [result] = await connection.execute(
      `UPDATE inventory_operation_requests
          SET result_type = ?, result_id = ?, result_summary = ?, completed_at = ?
        WHERE id = ? AND completed_at IS NULL`,
      [type, resultIdentifier, summary, timestamp(completedAt, "completed at"), id]
    );
    if (Number(result.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
  }

  async findBySource(executor, { source: requestedSource }) {
    assertExecutor(executor, "query");
    const source = sourceTuple(requestedSource);
    const [rows] = await executor.query(
      `SELECT id, result_type, result_id, result_summary, completed_at
         FROM inventory_operation_requests
        WHERE source_module = ? AND source_document_type = ? AND source_document_id = ?
          AND source_line_id = ? AND source_event_id = ?`,
      [source.module, source.documentType, source.documentId, source.lineId, source.eventId]
    );
    const row = rows[0];
    if (!row || row.completed_at === null || row.completed_at === undefined) return null;
    return { operationId: Number(row.id), ...resultFromRow(row) };
  }
}

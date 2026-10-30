import { createHash } from "node:crypto";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

import { INVENTORY_COMMAND_TYPES } from "./inventoryConstants.js";
import { FULFILLMENT_INVENTORY_SUMMARY_FIELDS } from "./inventoryFulfillmentConstants.js";
import { inventoryError } from "./inventoryErrors.js";
import {
  inventoryStringHasInvalidCharacters,
  isInventorySensitiveKey,
  parseInventorySummary,
  serializeInventorySummary
} from "./inventorySafeJson.js";

const COMMAND_TYPES = new Set(INVENTORY_COMMAND_TYPES);
const RESULT_SUMMARY_FIELDS = new Set([
  ...FULFILLMENT_INVENTORY_SUMMARY_FIELDS,
  "id", "status", "version", "quantity", "rowCount", "movementGroupId",
  "movementId", "operationId", "balanceId", "balanceVersion", "skuId", "skuCode", "skuName",
  "warehouseId", "warehouseCode", "binId", "binCode", "lotId", "lotNumber", "expiryDate",
  "stockStatus", "inputQuantity", "inputUomId", "inputUomCode", "baseQuantity", "baseUomId",
  "baseUomCode", "onHandQuantity", "allocatedQuantity", "postedAt", "reservationId",
  "allocationId", "transferId", "stocktakeId", "openingJobId", "purpose",
  "minimumRemainingDays", "originalQuantity", "consumedQuantity", "releasedQuantity",
  "outstandingQuantity", "eligibleOnHand", "reserved", "rawAtp", "atp", "uncoveredReserved",
  "allocationSnapshot", "sourceLineId", "rootOperationId", "rootRequestHash", "expectedOrderVersion",
  "orderedBaseQuantity", "reservedBaseQuantity", "uncoveredBaseQuantity", "membershipDigest",
  "expectedVersion", "releaseQuantity", "lineCount", "trackingPolicy"
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

function completion({ operationId, resultType, resultId, resultSummary = null, completedAt }) {
  return {
    id: positiveId(operationId, "operation id"),
    type: boundedString(resultType, "result type", 40, { ascii: true }),
    resultIdentifier: boundedString(resultId, "result id", 100),
    summary: serializeInventorySummary(resultSummary, RESULT_SUMMARY_FIELDS, "Inventory result summary"),
    at: timestamp(completedAt, "completed at")
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

  // New Reallocate children only. The caller must roll back the whole transaction on failure.
  async claimReallocationChildren(connection, inputs) {
    assertExecutor(connection);
    assertExecutor(connection, "query");
    const active = () => getActiveTransactionIsolation(connection) === "READ COMMITTED";
    if (!active()) throw new TypeError("Reallocation child claims require an active READ COMMITTED transaction");
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) throw new TypeError("Child claim batch must contain 1..100 entries");
    const rows = inputs.map(input => {
      const type = commandType(input.commandType), source = sourceTuple(input.source);
      const hash = inventoryOperationHash({ commandType: type, payload: input.payload });
      const values = [type, source.module, source.documentType, source.documentId, source.lineId, source.eventId, hash,
        positiveId(input.actorUserId, "actor user id", { nullable: true }), boundedString(input.actorLabel, "actor label", 190),
        boundedString(input.requestId ?? "", "request id", 64, { empty: true, ascii: true }),
        boundedString(input.correlationId ?? "", "correlation id", 64, { empty: true, ascii: true }), timestamp(input.createdAt, "created at")];
      if (source.module !== "FULFILLMENT" || !source.lineId ||
          !(type === "ALLOCATION_REALLOCATE" && source.documentType === "PICK" || type === "FULFILLMENT_BATCH_LEG" && source.documentType === "PICK_LEG")) throw new TypeError("Invalid Reallocation child source");
      return { type, source, hash, values };
    });
    const source = rows[0].source;
    if (rows.some(row => ["module", "documentType", "documentId", "eventId"].some(key => row.source[key] !== source[key])) ||
        new Set(rows.map(row => row.source.lineId)).size !== rows.length) throw new TypeError("Child sources must be unique within one scope");
    const read = async () => {
      const [found] = await connection.query(`SELECT id, command_type, source_module, source_document_type, source_document_id,
        source_line_id, source_event_id, request_hash, result_type, result_id, result_summary, completed_at
        FROM inventory_operation_requests WHERE source_module=? AND source_document_type=? AND source_document_id=?
        AND source_event_id=? AND source_line_id IN (${rows.map(() => "?").join(",")}) ORDER BY id`,
      [source.module, source.documentType, source.documentId, source.eventId, ...rows.map(row => row.source.lineId)]);
      const mapped = new Map(), ids = new Set(), expected = new Set(rows.map(row => row.source.lineId));
      for (const row of found) {
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id < 1 || ids.has(id) || mapped.has(row.source_line_id) || !expected.has(row.source_line_id) ||
            row.source_module !== source.module || row.source_document_type !== source.documentType ||
            row.source_document_id !== source.documentId || row.source_event_id !== source.eventId) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        ids.add(id); mapped.set(row.source_line_id, row);
      }
      return mapped;
    };
    let inserted;
    try {
      [inserted] = await connection.execute(`INSERT INTO inventory_operation_requests
        (command_type,source_module,source_document_type,source_document_id,source_line_id,source_event_id,request_hash,
         actor_user_id,actor_label,request_id,correlation_id,created_at) VALUES ${rows.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
      rows.flatMap(row => row.values));
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) !== "ER_DUP_ENTRY" || !active()) throw error;
      for (const input of rows) {
        // Match legacy first-conflict order without waiting on unrelated later children.
        const [found] = await connection.query(`SELECT id, request_hash, result_type, result_id, result_summary, completed_at
          FROM inventory_operation_requests WHERE source_module=? AND source_document_type=? AND source_document_id=?
          AND source_line_id=? AND source_event_id=? FOR UPDATE`,
        [input.source.module, input.source.documentType, input.source.documentId, input.source.lineId, input.source.eventId]);
        const row = found[0];
        if (!row) continue;
        if (String(row.request_hash) !== input.hash) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        if (row.completed_at === null || row.completed_at === undefined) throw inventoryError("CONCURRENT_OPERATION");
        resultFromRow(row); // Preserve the legacy completed-receipt validation before rejecting child replay.
        throw inventoryError("INVENTORY_SOURCE_CONFLICT");
      }
      throw error;
    }
    if (Number(inserted.affectedRows) !== rows.length) throw inventoryError("CONCURRENT_OPERATION");
    if (!active()) throw inventoryError("CONCURRENT_OPERATION");
    const found = await read();
    if (found.size !== rows.length) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    return rows.map(input => {
      const row = found.get(input.source.lineId);
      if (!row || row.command_type !== input.type || row.request_hash !== input.hash ||
          ["result_type", "result_id", "result_summary", "completed_at"].some(key => row[key] !== null)) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
      return { operationId: Number(row.id), replay: null };
    });
  }

  async complete(connection, { operationId, resultType, resultId, resultSummary = null, completedAt }) {
    assertExecutor(connection);
    const { id, type, resultIdentifier, summary, at } = completion({ operationId, resultType, resultId, resultSummary, completedAt });
    const [result] = await connection.execute(
      `UPDATE inventory_operation_requests
          SET result_type = ?, result_id = ?, result_summary = ?, completed_at = ?
        WHERE id = ? AND completed_at IS NULL`,
      [type, resultIdentifier, summary, at, id]
    );
    if (Number(result.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
  }

  // Internal bounded write: callers retain the same transaction and must roll it back on any failed CAS.
  async completeBatch(connection, inputs) {
    assertExecutor(connection);
    if (getActiveTransactionIsolation(connection) === null) throw new TypeError("Inventory completion batch requires an actual active transaction");
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 100) throw new TypeError("Inventory completion batch must contain 1..100 entries");
    const rows = inputs.map(completion);
    if (new Set(rows.map(row => String(row.id))).size !== rows.length) throw new TypeError("Inventory completion IDs must be unique");
    const fields = [["result_type", "type"], ["result_id", "resultIdentifier"], ["result_summary", "summary"], ["completed_at", "at"]];
    const params = [];
    const assignments = fields.map(([column, field]) => {
      const cases = rows.map(row => { params.push(row.id, row[field]); return "WHEN ? THEN ?"; }).join(" ");
      const expression = `CASE id ${cases} END`;
      return `${column} = ${column === "result_summary" ? `CAST(${expression} AS JSON)` : expression}`;
    });
    params.push(...rows.map(row => row.id));
    const [result] = await connection.execute(`UPDATE inventory_operation_requests SET ${assignments.join(", ")}
      WHERE id IN (${rows.map(() => "?").join(", ")}) AND completed_at IS NULL ORDER BY id`, params);
    if (Number(result.affectedRows) !== rows.length) throw inventoryError("CONCURRENT_OPERATION");
  }

  async stageSalesBatchMember(connection, { operationId, resultSummary }) {
    assertExecutor(connection);
    const summary = serializeInventorySummary(resultSummary, RESULT_SUMMARY_FIELDS, "Inventory result summary");
    const [result] = await connection.execute(
      `UPDATE inventory_operation_requests SET result_summary = ?
        WHERE id = ? AND command_type = 'SALES_LINE_RELEASE' AND completed_at IS NULL AND result_summary IS NULL`,
      [summary, positiveId(operationId, "operation id")]
    );
    if (Number(result.affectedRows) !== 1) throw inventoryError("CONCURRENT_OPERATION");
  }

  async listSalesBatchMembers(connection, { source: requestedSource, afterId = 0 }) {
    assertExecutor(connection, "query");
    const source = sourceTuple(requestedSource);
    if (source.module !== "SALES" || source.documentType !== "SALES_ORDER" ||
        !Number.isSafeInteger(afterId) || afterId < 0) throw new TypeError("Invalid Sales batch member query");
    const [rows] = await connection.query(
      `SELECT id, command_type, source_line_id, request_hash, result_type, result_id, result_summary, completed_at
         FROM inventory_operation_requests
        WHERE source_module = ? AND source_document_type = ? AND source_document_id = ?
          AND source_event_id = ? AND source_line_id <> '' AND id > ?
        ORDER BY id LIMIT 100 FOR SHARE`,
      [source.module, source.documentType, source.documentId, source.eventId, afterId]
    );
    return rows.map(row => ({ operationId: Number(row.id), commandType: row.command_type,
      sourceLineId: row.source_line_id, requestHash: row.request_hash,
      ...resultFromRow(row), completedAt: row.completed_at === null ? null : Number(row.completed_at) }));
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

import { reportInternalFailure } from "../../framework/diagnostics/reportInternalFailure.js";
import { INVENTORY_AUDIT_ACTIONS } from "./inventoryConstants.js";
import {
  inventoryStringHasInvalidCharacters,
  serializeInventorySummary
} from "./inventorySafeJson.js";

const ACTIONS = new Set(INVENTORY_AUDIT_ACTIONS);
const SUMMARY_FIELDS = new Set([
  "id", "code", "name", "status", "version", "quantity", "warehouseId", "binId",
  "skuId", "lotId", "stockStatus", "movementGroupId", "reservationId", "allocationId",
  "transferId", "stocktakeId", "openingJobId", "rowCount", "bucketCount", "locked",
  "fromStatus", "toStatus"
]);

function boundedString(value, field, max, { empty = false, ascii = false } = {}) {
  if (typeof value !== "string" || (!empty && value.length === 0) ||
      Buffer.byteLength(value, "utf8") > max || inventoryStringHasInvalidCharacters(value, ascii)) {
    throw new TypeError(`Invalid Inventory audit ${field}`);
  }
  return value;
}

function positiveId(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if ((typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
      (typeof value === "string" && /^[1-9][0-9]*$/u.test(value))) return value;
  throw new TypeError(`Invalid Inventory audit ${field}`);
}

function safeCode(value, fallback) {
  return typeof value === "string" && /^[A-Z0-9_]{1,80}$/u.test(value) ? value : fallback;
}

export class InventoryAuditService {
  constructor({ database, logger, time } = {}) {
    if (!database || typeof database.withTransaction !== "function" ||
        !logger || typeof logger.error !== "function" || !time || typeof time.nowMs !== "function") {
      throw new TypeError("InventoryAuditService requires database, logger and time");
    }
    this.database = database;
    this.logger = logger;
    this.time = time;
  }

  recordSucceeded(connection, input) {
    return this.#record(connection, input, "SUCCEEDED");
  }

  recordRejected(input) {
    return this.#recordIndependent(input, "REJECTED");
  }

  recordFailed(input) {
    return this.#recordIndependent(input, "FAILED");
  }

  async #record(connection, input, outcome) {
    if (!connection || typeof connection.execute !== "function") {
      throw new TypeError("Inventory audit requires a caller-owned transaction connection");
    }
    if (!ACTIONS.has(input.action)) throw new TypeError(`Unsupported Inventory audit action ${input.action}`);

    const succeeded = outcome === "SUCCEEDED";
    await connection.execute(
      `INSERT INTO inventory_audit_logs
         (occurred_at, actor_user_id, actor_label, action, target_type, target_id,
          target_label, outcome, reason_category, reason_text, before_summary,
          after_summary, operation_request_id, request_id, correlation_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.time.nowMs(),
        positiveId(input.actorUserId, "actor user id", { nullable: true }),
        boundedString(input.actorLabel, "actor label", 190),
        input.action,
        boundedString(input.targetType, "target type", 40, { ascii: true }),
        positiveId(input.targetId, "target id", { nullable: true }),
        boundedString(input.targetLabel, "target label", 190),
        outcome,
        boundedString(input.reasonCategory ?? "", "reason category", 40, { empty: true, ascii: true }),
        boundedString(input.reasonText ?? "", "reason text", 500, { empty: true }),
        serializeInventorySummary(input.beforeSummary, SUMMARY_FIELDS, "Inventory audit summary"),
        succeeded
          ? serializeInventorySummary(input.afterSummary, SUMMARY_FIELDS, "Inventory audit summary")
          : null,
        succeeded ? positiveId(input.operationRequestId, "operation request id", { nullable: true }) : null,
        boundedString(input.requestId ?? "", "request id", 64, { empty: true, ascii: true }),
        boundedString(input.correlationId ?? "", "correlation id", 64, { empty: true, ascii: true }),
        boundedString(input.ip ?? "", "ip", 45, { empty: true, ascii: true })
      ]
    );
  }

  async #recordIndependent(input, outcome) {
    try {
      await this.database.withTransaction((connection) => this.#record(connection, input, outcome));
      return true;
    } catch (error) {
      const context = {
        action: ACTIONS.has(input.action) ? input.action : "unknown",
        targetType: typeof input.targetType === "string" && /^[\x20-\x7e]{1,40}$/u.test(input.targetType)
          ? input.targetType
          : "unknown",
        targetId: (Number.isSafeInteger(input.targetId) && input.targetId > 0) ? input.targetId : null,
        actorUserId: (Number.isSafeInteger(input.actorUserId) && input.actorUserId > 0) ? input.actorUserId : null,
        requestId: typeof input.requestId === "string" && /^[\x20-\x7e]{0,64}$/u.test(input.requestId)
          ? input.requestId
          : "",
        correlationId: typeof input.correlationId === "string" && /^[\x20-\x7e]{0,64}$/u.test(input.correlationId)
          ? input.correlationId
          : "",
        outcome,
        errorCode: safeCode(input.errorCode, "INVENTORY_AUDIT_WRITE_FAILED"),
        databaseErrorCode: safeCode(error?.cause?.code ?? error?.code, "UNKNOWN")
      };
      try {
        await this.logger.error(
          "inventory.audit.write_failed",
          "Inventory rejection or failure audit could not be persisted",
          context
        );
      } catch (loggingError) {
        reportInternalFailure("inventory.audit.fallback_failed", loggingError, context);
      }
      return false;
    }
  }
}

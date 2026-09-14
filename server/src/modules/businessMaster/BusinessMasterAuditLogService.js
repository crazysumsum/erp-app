const CURRENCY_FIELDS = ["code", "name", "decimalPlaces", "status", "version", "createdAt", "updatedAt"];
const PAYMENT_TERM_FIELDS = ["id", "code", "name", "description", "calculationType", "dueDays", "status", "version", "createdAt", "updatedAt"];

function allowlistedSnapshot(entityType, value) {
  if (value === null || value === undefined) return null;
  const fields = entityType === "CURRENCY" ? CURRENCY_FIELDS : PAYMENT_TERM_FIELDS;
  return Object.fromEntries(fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]));
}

function json(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export class BusinessMasterAuditLogService {
  async record(connection, input) {
    if (!connection || typeof connection.execute !== "function") throw new TypeError("A transaction connection is required");
    if (!/^[a-f0-9]{64}$/.test(input.idempotencyKeyHash ?? "") && input.idempotencyKeyHash !== null) {
      throw new TypeError("idempotencyKeyHash must be a SHA-256 hex digest or null");
    }
    await connection.execute(
      `INSERT INTO business_master_audit_logs
         (entity_type, entity_key, action, result, before_json, after_json, impact_json, reason,
          actor_user_id, correlation_id, idempotency_key_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.entityType,
        String(input.entityKey),
        input.action,
        input.result ?? "SUCCESS",
        json(allowlistedSnapshot(input.entityType, input.before)),
        json(allowlistedSnapshot(input.entityType, input.after)),
        json(input.impact),
        String(input.reason ?? ""),
        input.actorUserId == null ? null : Number(input.actorUserId),
        String(input.correlationId ?? ""),
        input.idempotencyKeyHash ?? null,
        Number(input.createdAt)
      ]
    );
  }
}

import { assertActorFresh } from "../authorization/directoryLookups.js";

const MAX_DETAIL_BYTES = 8192;
const DETAIL_KEYS = new Set(["before", "after", "changes", "warnings", "count", "sample", "truncated", "metadata", "outcome"]);
const SENSITIVE_KEYS = new Set([
  "accountnumber", "iban", "bankaccountnumber", "accountnumberciphertext",
  "accountciphertext", "accountiv", "accountauthtag", "accountblindindex",
  "encryptionkeyid", "blindindexkeyid", "bankencryptionkey", "banklookupkey"
]);
const ACTION_PREFIXES = ["supplier.", "address.", "contact.", "identifier.", "bank.", "approval.", "setting.", "supplier_sku.", "import."];

function escapeLike(value) {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function assertNoSensitiveFields(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) throw new TypeError(`Supplier audit detail contains sensitive field ${key}`);
    assertNoSensitiveFields(nested);
  }
}

function boundedDetail(detail) {
  if (detail === null || detail === undefined) return null;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new TypeError("Supplier audit detail must be an object");
  }
  for (const key of Object.keys(detail)) {
    if (!DETAIL_KEYS.has(key)) throw new TypeError(`Unsupported Supplier audit detail key ${key}`);
  }
  assertNoSensitiveFields(detail);
  let serialized = JSON.stringify(detail);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_DETAIL_BYTES) return serialized;
  const summarized = Object.fromEntries(Object.entries(detail).map(([key, value]) => [
    key,
    Array.isArray(value) ? { count: value.length, sample: value.slice(0, 3), truncated: true } : value
  ]));
  serialized = JSON.stringify(summarized);
  if (Buffer.byteLength(serialized, "utf8") > MAX_DETAIL_BYTES) {
    throw new TypeError("Supplier audit detail exceeds 8192 bytes after bounded summarization");
  }
  return serialized;
}

export class SupplierAuditLogService {
  constructor({ database, logger, time, authorize = assertActorFresh } = {}) {
    if (!database || !logger || !time || typeof authorize !== "function") {
      throw new TypeError("SupplierAuditLogService requires database, logger, time and authorize");
    }
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.authorize = authorize;
  }

  async record(connection, input) {
    if (!connection || typeof connection.execute !== "function") {
      throw new TypeError("Supplier audit requires a caller-owned transaction connection");
    }
    if (!ACTION_PREFIXES.some((prefix) => String(input.action).startsWith(prefix))) {
      throw new TypeError(`Unsupported Supplier audit action ${input.action}`);
    }
    const detail = boundedDetail(input.detail);
    await connection.execute(
      `INSERT INTO supplier_audit_logs
        (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
         supplier_id, target_label, reason, detail, request_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.time.nowMs(), input.actorUserId ?? null, String(input.actorUsername ?? ""), String(input.action),
        String(input.targetType), input.targetId ?? null, input.supplierId ?? null, String(input.targetLabel ?? ""),
        String(input.reason ?? ""), detail, String(input.requestId ?? ""), String(input.ip ?? "")
      ]
    );
  }

  async list({ actorId, claimedRoles, claimedPermissions, page = 1, pageSize = 20, from, to, actor = "", target = "", action, targetType, supplierId }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const conditions = [];
    const params = [];
    if (from !== undefined) { conditions.push("occurred_at >= ?"); params.push(from); }
    if (to !== undefined) { conditions.push("occurred_at <= ?"); params.push(to); }
    if (String(actor).trim()) { conditions.push("actor_username LIKE ?"); params.push(`%${escapeLike(String(actor).trim())}%`); }
    if (String(target).trim()) { conditions.push("target_label LIKE ?"); params.push(`%${escapeLike(String(target).trim())}%`); }
    if (action) { conditions.push("action = ?"); params.push(action); }
    if (targetType) { conditions.push("target_type = ?"); params.push(targetType); }
    if (supplierId !== undefined) { conditions.push("supplier_id = ?"); params.push(supplierId); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [totals] = await this.database.query(`SELECT COUNT(*) AS total FROM supplier_audit_logs ${where}`, params);
    const [rows] = await this.database.query(
      `SELECT id, occurred_at, actor_user_id, actor_username, action, target_type,
              target_id, supplier_id, target_label, reason, detail, request_id, ip
         FROM supplier_audit_logs ${where}
        ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    return { items: rows.map((row) => ({
      id: Number(row.id), occurredAt: Number(row.occurred_at),
      actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
      actorUsername: row.actor_username, action: row.action, targetType: row.target_type,
      targetId: row.target_id === null ? null : Number(row.target_id),
      supplierId: row.supplier_id === null ? null : Number(row.supplier_id),
      targetLabel: row.target_label, reason: row.reason, detail: row.detail ?? null,
      requestId: row.request_id, ip: row.ip
    })), total: Number(totals[0].total), page, pageSize };
  }
}

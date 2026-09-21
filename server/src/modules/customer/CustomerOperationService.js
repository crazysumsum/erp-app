import { createHash, randomUUID } from "node:crypto";

import { customerIdempotencyConflict } from "./customerErrors.js";

const ROUTES = new Set(["customer.create", "customer.update"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function payloadHash(payload) {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest();
}

function equalHash(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
}

function operation(row) {
  return {
    operationId: row.id,
    status: row.status,
    resourceType: row.resource_type || null,
    resourceId: row.resource_id === null ? null : Number(row.resource_id),
    resultVersion: row.result_version === null ? null : Number(row.result_version),
    errorCode: row.error_code || null
  };
}

export class CustomerOperationService {
  async begin(connection, { actorId, routeKey, idempotencyKey, payload, nowMs }) {
    if (!ROUTES.has(routeKey)) throw new TypeError(`Unsupported Customer operation route: ${routeKey}`);
    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 128) {
      throw new TypeError("Customer operation requires an idempotency key of at most 128 characters");
    }
    const hash = payloadHash(payload);
    try {
      const id = randomUUID();
      await connection.execute(
        `INSERT INTO customer_operation_requests
           (id, actor_user_id, route_key, idempotency_key, payload_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)`,
        [id, actorId, routeKey, idempotencyKey.trim(), hash, nowMs, nowMs]
      );
      return { operationId: id, replay: null };
    } catch (error) {
      if ((error?.cause?.code || error?.code) !== "ER_DUP_ENTRY") throw error;
      const [rows] = await connection.query(
        `SELECT id, payload_hash, status, resource_type, resource_id, result_version, error_code
           FROM customer_operation_requests
          WHERE actor_user_id = ? AND route_key = ? AND idempotency_key = ? FOR UPDATE`,
        [actorId, routeKey, idempotencyKey.trim()]
      );
      const row = rows[0];
      if (!row || !equalHash(row.payload_hash, hash)) throw customerIdempotencyConflict();
      return { operationId: row.id, replay: operation(row) };
    }
  }

  async succeed(connection, { operationId, resourceType, resourceId, resultVersion, nowMs }) {
    await connection.execute(
      `UPDATE customer_operation_requests
          SET status = 'succeeded', resource_type = ?, resource_id = ?, result_version = ?,
              updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'processing'`,
      [resourceType, resourceId, resultVersion, nowMs, nowMs, operationId]
    );
  }

  async getForActor(connection, { actorId, operationId }) {
    const [rows] = await connection.query(
      `SELECT id, status, resource_type, resource_id, result_version, error_code
         FROM customer_operation_requests WHERE id = ? AND actor_user_id = ?`,
      [operationId, actorId]
    );
    return rows[0] ? operation(rows[0]) : null;
  }
}

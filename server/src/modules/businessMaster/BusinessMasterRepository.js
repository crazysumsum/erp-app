import { businessMasterConflict } from "./businessMasterErrors.js";

const CURRENCY_SORTS = Object.freeze({ code: "code", name: "name", status: "status", updatedAt: "updated_at" });
const PAYMENT_TERM_SORTS = Object.freeze({ code: "code_key", name: "name", status: "status", updatedAt: "updated_at" });

function currency(row) {
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    decimalPlaces: Number(row.decimal_places),
    status: row.status,
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function paymentTerm(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    ...(row.code_key === undefined ? {} : { codeKey: row.code_key }),
    name: row.name,
    description: row.description,
    calculationType: row.calculation_type,
    dueDays: row.due_days === null ? null : Number(row.due_days),
    status: row.status,
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function paging(input) {
  const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1;
  const pageSize = [10, 20, 50, 100].includes(input.pageSize) ? input.pageSize : 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function likePrefix(value, { uppercase = false } = {}) {
  let normalized = String(value).normalize("NFKC").trim();
  if (uppercase) normalized = normalized.toUpperCase();
  return `${normalized.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
}

function duplicate(error, code, message) {
  if (error?.code === "ER_DUP_ENTRY" || error?.cause?.code === "ER_DUP_ENTRY") {
    throw businessMasterConflict(code, message);
  }
  throw error;
}

export class BusinessMasterRepository {
  async listCurrencies(connection, input = {}) {
    const { page, pageSize, offset } = paging(input);
    const conditions = [];
    const params = [];
    if (input.q) {
      conditions.push("(code LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')");
      params.push(likePrefix(input.q), likePrefix(input.q));
    }
    if (input.status) { conditions.push("status = ?"); params.push(input.status); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sort = CURRENCY_SORTS[input.sort] ?? "code";
    const direction = input.descending ? "DESC" : "ASC";
    const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM currencies ${where}`, params);
    const [rows] = await connection.query(
      `SELECT code, name, decimal_places, status, version, created_at, updated_at
         FROM currencies ${where}
        ORDER BY ${sort} ${direction}, code ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return { items: rows.map(currency), total: Number(countRows[0].total), page, pageSize };
  }

  async getCurrency(connection, code, { forUpdate = false } = {}) {
    const [rows] = await connection.query(
      `SELECT code, name, decimal_places, status, version, created_at, updated_at
         FROM currencies WHERE code = ?${forUpdate ? " FOR UPDATE" : ""}`,
      [code]
    );
    return currency(rows[0]);
  }

  async createCurrency(connection, input) {
    try {
      await connection.execute(
        `INSERT INTO currencies
           (code, name, decimal_places, status, version, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?)`,
        [input.code, input.name, input.decimalPlaces, input.nowMs, input.actorId, input.nowMs, input.actorId]
      );
      return this.getCurrency(connection, input.code);
    } catch (error) {
      duplicate(error, "CURRENCY_CODE_TAKEN", "貨幣代碼已存在");
    }
  }

  async updateCurrency(connection, input) {
    const columns = [];
    const params = [];
    if (input.changes.name !== undefined) { columns.push("name = ?"); params.push(input.changes.name); }
    if (input.changes.status !== undefined) { columns.push("status = ?"); params.push(input.changes.status); }
    if (input.changes.decimalPlaces !== undefined) { columns.push("decimal_places = ?"); params.push(input.changes.decimalPlaces); }
    if (columns.length === 0) return this.getCurrency(connection, input.code);
    const [result] = await connection.execute(
      `UPDATE currencies SET ${columns.join(", ")}, version = version + 1, updated_at = ?, updated_by = ?
        WHERE code = ? AND version = ?`,
      [...params, input.nowMs, input.actorId, input.code, input.version]
    );
    return result.affectedRows === 1 ? this.getCurrency(connection, input.code) : null;
  }

  async listPaymentTerms(connection, input = {}) {
    const { page, pageSize, offset } = paging(input);
    const conditions = [];
    const params = [];
    if (input.q) {
      conditions.push("(code_key LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')");
      params.push(likePrefix(input.q, { uppercase: true }), likePrefix(input.q));
    }
    if (input.status) { conditions.push("status = ?"); params.push(input.status); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sort = PAYMENT_TERM_SORTS[input.sort] ?? "code_key";
    const direction = input.descending ? "DESC" : "ASC";
    const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM payment_terms ${where}`, params);
    const [rows] = await connection.query(
      `SELECT id, code, name, description, calculation_type, due_days, status, version, created_at, updated_at
         FROM payment_terms ${where}
        ORDER BY ${sort} ${direction}, id ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return { items: rows.map(paymentTerm), total: Number(countRows[0].total), page, pageSize };
  }

  async getPaymentTerm(connection, id, { forUpdate = false } = {}) {
    const [rows] = await connection.query(
      `SELECT id, code, code_key, name, description, calculation_type, due_days, status, version, created_at, updated_at
         FROM payment_terms WHERE id = ?${forUpdate ? " FOR UPDATE" : ""}`,
      [id]
    );
    return paymentTerm(rows[0]);
  }

  async createPaymentTerm(connection, input) {
    try {
      const [result] = await connection.execute(
        `INSERT INTO payment_terms
           (code, code_key, name, description, calculation_type, due_days, status, version,
            created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?)`,
        [input.code, input.codeKey, input.name, input.description, input.calculationType, input.dueDays, input.nowMs, input.actorId, input.nowMs, input.actorId]
      );
      return this.getPaymentTerm(connection, Number(result.insertId));
    } catch (error) {
      duplicate(error, "PAYMENT_TERM_CODE_TAKEN", "付款條款代碼已存在");
    }
  }

  async updatePaymentTerm(connection, input) {
    const mappings = { name: "name", description: "description", status: "status", calculationType: "calculation_type", dueDays: "due_days" };
    const columns = [];
    const params = [];
    for (const [field, column] of Object.entries(mappings)) {
      if (input.changes[field] !== undefined) { columns.push(`${column} = ?`); params.push(input.changes[field]); }
    }
    if (columns.length === 0) return this.getPaymentTerm(connection, input.id);
    const [result] = await connection.execute(
      `UPDATE payment_terms SET ${columns.join(", ")}, version = version + 1, updated_at = ?, updated_by = ?
        WHERE id = ? AND version = ?`,
      [...params, input.nowMs, input.actorId, input.id, input.version]
    );
    return result.affectedRows === 1 ? this.getPaymentTerm(connection, input.id) : null;
  }

  async listAudit(connection, input = {}) {
    const { page, pageSize, offset } = paging(input);
    const conditions = [];
    const params = [];
    const filters = { entityType: "entity_type", entityKey: "entity_key", action: "action", actorUserId: "actor_user_id" };
    for (const [field, column] of Object.entries(filters)) {
      if (input[field] !== undefined && input[field] !== "") { conditions.push(`${column} = ?`); params.push(input[field]); }
    }
    if (input.from !== undefined) { conditions.push("created_at >= ?"); params.push(input.from); }
    if (input.to !== undefined) { conditions.push("created_at <= ?"); params.push(input.to); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM business_master_audit_logs ${where}`, params);
    const [rows] = await connection.query(
      `SELECT id, entity_type, entity_key, action, result, before_json, after_json, impact_json,
              reason, actor_user_id, correlation_id, created_at
         FROM business_master_audit_logs ${where}
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return { items: rows.map((row) => ({ id: Number(row.id), entityType: row.entity_type, entityKey: row.entity_key, action: row.action, result: row.result, before: row.before_json, after: row.after_json, impact: row.impact_json, reason: row.reason, actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id), correlationId: row.correlation_id, createdAt: Number(row.created_at) })), total: Number(countRows[0].total), page, pageSize };
  }
}

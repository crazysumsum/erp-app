import { assertActorFresh } from "../authorization/directoryLookups.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import {
  customerCatalogForbidden,
  customerCatalogInvalid,
  customerCatalogNotFound,
  customerCatalogStatusInvalid,
  customerCatalogTaken,
  versionConflict
} from "./customerErrors.js";

const CATALOGS = Object.freeze({
  categories: "customer_categories",
  industries: "customer_industries",
  territories: "customer_territories"
});

function tableFor(catalog) {
  const table = CATALOGS[catalog];
  if (!table) throw customerCatalogInvalid();
  return table;
}

function boundedText(value, field, maxLength, { optional = false } = {}) {
  if (typeof value !== "string") throw customerCatalogInvalid({ field });
  const text = value.trim();
  if ((!optional && !text) || [...text].length > maxLength || /[\p{Cc}]/u.test(text)) {
    throw customerCatalogInvalid({ field });
  }
  return text;
}

function catalogInput(input) {
  const code = boundedText(input.code, "code", 50);
  const codeKey = code.normalize("NFKC").toLowerCase();
  if ([...codeKey].length > 50) throw customerCatalogInvalid({ field: "code" });
  const sortOrder = Number(input.sortOrder);
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000000) {
    throw customerCatalogInvalid({ field: "sortOrder" });
  }
  return {
    code,
    codeKey,
    name: boundedText(input.name, "name", 100),
    description: boundedText(input.description ?? "", "description", 500, { optional: true }),
    sortOrder
  };
}

function requireReason(value) {
  return boundedText(value, "reason", 500);
}

function projection(row) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    sortOrder: Number(row.sort_order),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function duplicate(error) {
  return (error?.cause?.code || error?.code) === "ER_DUP_ENTRY";
}

function requireId(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw customerCatalogInvalid({ field: "id" });
  return Number(value);
}

export class CustomerCatalogService {
  constructor({ database, time, authorize = assertActorFresh, audit = new CustomerAuditLogService() } = {}) {
    if (!database || !time) throw new TypeError("CustomerCatalogService requires database and time");
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.audit = audit;
  }

  async list(catalog, { actorId, claimedRoles, claimedPermissions, includeInactive = false } = {}) {
    const table = tableFor(catalog);
    const actor = await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    if (includeInactive && !actor.permissions.includes("customer.settings")) throw customerCatalogForbidden();
    const [rows] = await this.database.query(
      `SELECT id, code, name, description, status, sort_order, version, created_at, updated_at
         FROM ${table}${includeInactive ? "" : " WHERE status = 'active'"}
        ORDER BY sort_order ASC, name ASC, id ASC`
    );
    return { items: rows.map(projection) };
  }

  async create(catalog, input) {
    const table = tableFor(catalog);
    const value = catalogInput(input);
    const reason = requireReason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const nowMs = this.time.nowMs();
      let id;
      try {
        const [result] = await connection.execute(
          `INSERT INTO ${table}
             (code, code_key, name, description, status, sort_order, version, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, 'active', ?, 1, ?, ?, ?, ?)`,
          [value.code, value.codeKey, value.name, value.description, value.sortOrder, nowMs, input.actorId, nowMs, input.actorId]
        );
        id = Number(result.insertId);
      } catch (error) {
        if (duplicate(error)) throw customerCatalogTaken();
        throw error;
      }
      const created = { id, ...value, status: "active", version: 1, createdAt: nowMs, updatedAt: nowMs };
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: input.actorId, actorUsername: actor.username,
        action: "catalog.create", targetType: "catalog", targetId: id, customerId: null,
        targetLabel: value.code, reason, detail: { after: created }, requestId: input.requestId, ip: input.ip
      });
      return created;
    });
  }

  async update(catalog, input) {
    const table = tableFor(catalog);
    const id = requireId(input.id);
    const value = catalogInput(input);
    const reason = requireReason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const [[before]] = await connection.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
      if (!before) throw customerCatalogNotFound();
      if (Number(before.version) !== Number(input.version)) throw versionConflict(before.version);
      const nowMs = this.time.nowMs();
      let result;
      try {
        [result] = await connection.execute(
          `UPDATE ${table}
              SET code = ?, code_key = ?, name = ?, description = ?, sort_order = ?, version = version + 1,
                  updated_at = ?, updated_by = ?
            WHERE id = ? AND version = ?`,
          [value.code, value.codeKey, value.name, value.description, value.sortOrder, nowMs, input.actorId, id, input.version]
        );
      } catch (error) {
        if (duplicate(error)) throw customerCatalogTaken();
        throw error;
      }
      if (result.affectedRows !== 1) throw versionConflict(before.version);
      const after = { id, ...value, status: before.status, version: Number(input.version) + 1, createdAt: Number(before.created_at), updatedAt: nowMs };
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: input.actorId, actorUsername: actor.username,
        action: "catalog.update", targetType: "catalog", targetId: id, customerId: null,
        targetLabel: value.code, reason, detail: { before: projection(before), after }, requestId: input.requestId, ip: input.ip
      });
      return after;
    });
  }

  async deactivate(catalog, input) {
    const table = tableFor(catalog);
    const id = requireId(input.id);
    const reason = requireReason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const [[before]] = await connection.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
      if (!before) throw customerCatalogNotFound();
      if (before.status !== "active") throw customerCatalogStatusInvalid();
      if (Number(before.version) !== Number(input.version)) throw versionConflict(before.version);
      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `UPDATE ${table} SET status = 'inactive', version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [nowMs, input.actorId, id, input.version]
      );
      if (result.affectedRows !== 1) throw versionConflict(before.version);
      const after = { ...projection(before), status: "inactive", version: Number(input.version) + 1, updatedAt: nowMs };
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: input.actorId, actorUsername: actor.username,
        action: "catalog.deactivate", targetType: "catalog", targetId: id, customerId: null,
        targetLabel: before.code, reason, detail: { before: projection(before), after }, requestId: input.requestId, ip: input.ip
      });
      return after;
    });
  }
}

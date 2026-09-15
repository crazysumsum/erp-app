import { assertActorFresh } from "../authorization/directoryLookups.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { customerNotFound, customerPartyInactive, customerPartyNotFound, versionConflict } from "./customerErrors.js";

const CONFIG = Object.freeze({
  address: { table: "customer_addresses", mapping: "customer_address_purposes", id: "address_id", purposes: new Set(["registered", "office", "billing", "shipping", "returns", "other"]), required: ["label", "addressLine1"], fields: { label: "label", recipientCompanyDepartment: "recipient_company_department", addressLine1: "address_line1", addressLine2: "address_line2", addressLine3: "address_line3", city: "city", stateRegion: "state_region", postalCode: "postal_code", countryCode: "country_code", phone: "phone", notes: "notes", sortOrder: "sort_order" } },
  contact: { table: "customer_contacts", mapping: "customer_contact_purposes", id: "contact_id", purposes: new Set(["general", "ordering", "shipping", "billing_ar", "returns", "other"]), required: ["name"], fields: { name: "name", jobTitle: "job_title", department: "department", email: "email", phone: "phone", mobile: "mobile", preferredLanguage: "preferred_language", notes: "notes", sortOrder: "sort_order" } }
});

const FIELD_LIMITS = Object.freeze({
  address: Object.freeze({ label: 100, recipientCompanyDepartment: 190, addressLine1: 190, addressLine2: 190, addressLine3: 190, city: 100, stateRegion: 100, postalCode: 100, phone: 50, notes: 500 }),
  contact: Object.freeze({ name: 190, jobTitle: 100, department: 100, email: 254, phone: 50, mobile: 50, preferredLanguage: 20, notes: 500 })
});

function text(value, field, max = 500) {
  const result = String(value ?? "").trim();
  if ([...result].length > max || /[\p{Cc}]/u.test(result)) throw new TypeError(`${field} is invalid`);
  return result;
}

function normalized(type, input) {
  const config = CONFIG[type];
  if (!config) throw new TypeError("Unsupported Customer party type");
  const values = Object.fromEntries(Object.entries(config.fields).map(([field]) => [field, field === "sortOrder" ? Number(input[field] ?? 0) : field === "countryCode" ? (input[field] ?? null) : text(input[field], field, FIELD_LIMITS[type][field])]));
  for (const field of config.required) if (!values[field]) throw new TypeError(`${field} is required`);
  if (!Number.isSafeInteger(values.sortOrder) || values.sortOrder < 0) throw new TypeError("sortOrder is invalid");
  if (type === "address" && values.countryCode !== null && (typeof values.countryCode !== "string" || !/^[A-Z]{2}$/.test(values.countryCode))) throw new TypeError("countryCode is invalid");
  if (type === "contact" && values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) throw new TypeError("email is invalid");
  if (type === "contact" && values.preferredLanguage && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(values.preferredLanguage)) throw new TypeError("preferredLanguage is invalid");
  const seen = new Set();
  const purposes = (input.purposes ?? []).map(({ code, isDefault }) => ({ code: String(code), isDefault: Boolean(isDefault) }));
  for (const purpose of purposes) {
    if (!config.purposes.has(purpose.code) || seen.has(purpose.code)) throw new TypeError("Customer party purpose is invalid or duplicated");
    seen.add(purpose.code);
  }
  return { values, purposes };
}

function auditSnapshot(config, row, purposes) {
  const snapshot = {
    id: Number(row.id),
    status: row.status ?? "active",
    version: Number(row.version ?? 1),
    purposes
  };
  for (const [field, column] of Object.entries(config.fields)) {
    const value = Object.hasOwn(row, field) ? row[field] : row[column];
    if (value !== undefined) snapshot[field] = field === "sortOrder" ? Number(value) : value;
  }
  return snapshot;
}

export class CustomerPartyService {
  constructor({ database, time, actorVerifier = assertActorFresh, audit = new CustomerAuditLogService() } = {}) {
    if (!database || !time) throw new TypeError("CustomerPartyService requires database and time");
    this.database = database; this.time = time; this.actorVerifier = actorVerifier; this.audit = audit;
  }

  async create({ type, customerId, actorId, claimedRoles, claimedPermissions, requestId = "", ip = "", ...input }) {
    const config = CONFIG[type]; const party = normalized(type, input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.actorVerifier(connection, { actorId, claimedRoles, claimedPermissions });
      const [[customer]] = await connection.query("SELECT id, customer_code FROM customers WHERE id = ? FOR UPDATE", [customerId]);
      if (!customer) throw customerNotFound(customerId);
      const nowMs = this.time.nowMs();
      const columns = Object.values(config.fields);
      const [result] = await connection.execute(
        `INSERT INTO ${config.table} (customer_id, ${columns.join(", ")}, created_at, updated_at, created_by, updated_by)
         VALUES (?, ${columns.map(() => "?").join(", ")}, ?, ?, ?, ?)`,
        [customerId, ...Object.keys(config.fields).map((field) => party.values[field]), nowMs, nowMs, actorId, actorId]
      );
      const partyId = Number(result.insertId);
      await this.#replacePurposes(connection, config, { customerId, partyId, purposes: party.purposes, nowMs, actorId });
      await this.#finish(connection, { type, customer, customerId, partyId, actorId, actor, nowMs, action: "create", after: auditSnapshot(config, { id: partyId, ...party.values }, party.purposes), requestId, ip });
      return { id: partyId, customerId: Number(customerId), status: "active", version: 1, purposes: party.purposes };
    });
  }

  async update({ type, customerId, partyId, actorId, claimedRoles, claimedPermissions, version, reason = "", requestId = "", ip = "", ...input }) {
    const config = CONFIG[type]; const party = normalized(type, input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.actorVerifier(connection, { actorId, claimedRoles, claimedPermissions });
      const [[customer]] = await connection.query("SELECT id, customer_code FROM customers WHERE id = ? FOR UPDATE", [customerId]);
      if (!customer) throw customerNotFound(customerId);
      const [[before]] = await connection.query(`SELECT * FROM ${config.table} WHERE id = ? AND customer_id = ? FOR UPDATE`, [partyId, customerId]);
      if (!before) throw customerPartyNotFound(type, partyId);
      if (before.status !== "active") throw customerPartyInactive();
      const beforePurposes = await this.#readPurposes(connection, config, { customerId, partyId });
      const nowMs = this.time.nowMs(); const columns = Object.values(config.fields);
      const [result] = await connection.execute(`UPDATE ${config.table} SET ${columns.map((column) => `${column} = ?`).join(", ")}, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND customer_id = ? AND version = ?`, [...Object.keys(config.fields).map((field) => party.values[field]), nowMs, actorId, partyId, customerId, version]);
      if (result.affectedRows !== 1) throw versionConflict(before.version);
      await this.#replacePurposes(connection, config, { customerId, partyId, purposes: party.purposes, nowMs, actorId, replace: true });
      await this.#finish(connection, { type, customer, customerId, partyId, actorId, actor, nowMs, action: "update", reason, before: auditSnapshot(config, before, beforePurposes), after: auditSnapshot(config, { id: partyId, ...party.values, version: Number(version) + 1 }, party.purposes), requestId, ip });
      return { id: Number(partyId), customerId: Number(customerId), status: "active", version: Number(version) + 1, purposes: party.purposes };
    });
  }

  async deactivate({ type, customerId, partyId, actorId, claimedRoles, claimedPermissions, version, reason, requestId = "", ip = "" }) {
    const config = CONFIG[type];
    return this.database.withTransaction(async (connection) => {
      const actor = await this.actorVerifier(connection, { actorId, claimedRoles, claimedPermissions });
      const [[customer]] = await connection.query("SELECT id, customer_code FROM customers WHERE id = ? FOR UPDATE", [customerId]);
      if (!customer) throw customerNotFound(customerId);
      const [[before]] = await connection.query(`SELECT * FROM ${config.table} WHERE id = ? AND customer_id = ? FOR UPDATE`, [partyId, customerId]);
      if (!before) throw customerPartyNotFound(type, partyId);
      if (before.status !== "active") throw customerPartyInactive();
      const beforePurposes = await this.#readPurposes(connection, config, { customerId, partyId });
      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(`UPDATE ${config.table} SET status = 'inactive', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND customer_id = ? AND version = ?`, [nowMs, actorId, partyId, customerId, version]);
      if (result.affectedRows !== 1) throw versionConflict(before.version);
      await connection.execute(`UPDATE ${config.mapping} SET is_default = 0, updated_at = ?, updated_by = ? WHERE ${config.id} = ? AND customer_id = ?`, [nowMs, actorId, partyId, customerId]);
      await this.#finish(connection, { type, customer, customerId, partyId, actorId, actor, nowMs, action: "deactivate", reason, before: auditSnapshot(config, before, beforePurposes), after: auditSnapshot(config, { ...before, status: "inactive", version: Number(version) + 1 }, beforePurposes.map((purpose) => ({ ...purpose, isDefault: false }))), requestId, ip });
      return { id: Number(partyId), customerId: Number(customerId), status: "inactive", version: Number(version) + 1 };
    });
  }

  async #readPurposes(connection, config, { customerId, partyId }) {
    const [rows] = await connection.query(`SELECT purpose_code, is_default FROM ${config.mapping} WHERE ${config.id} = ? AND customer_id = ? ORDER BY purpose_code FOR UPDATE`, [partyId, customerId]);
    return rows.map((row) => ({ code: row.purpose_code, isDefault: Boolean(row.is_default) }));
  }

  async #replacePurposes(connection, config, { customerId, partyId, purposes, nowMs, actorId, replace = false }) {
    if (purposes.length) await connection.query(`SELECT ${config.id} FROM ${config.mapping} WHERE customer_id = ? AND purpose_code IN (${purposes.map(() => "?").join(",")}) FOR UPDATE`, [customerId, ...purposes.map((item) => item.code)]);
    for (const purpose of purposes.filter((item) => item.isDefault)) {
      await connection.execute(`UPDATE ${config.mapping} SET is_default = 0, updated_at = ?, updated_by = ? WHERE customer_id = ? AND purpose_code = ?`, [nowMs, actorId, customerId, purpose.code]);
    }
    if (replace) await connection.execute(`DELETE FROM ${config.mapping} WHERE ${config.id} = ? AND customer_id = ?`, [partyId, customerId]);
    for (const purpose of purposes) {
      await connection.execute(
        `INSERT INTO ${config.mapping} (${config.id}, customer_id, purpose_code, is_default, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [partyId, customerId, purpose.code, purpose.isDefault ? 1 : 0, nowMs, nowMs, actorId, actorId]
      );
    }
  }

  async #finish(connection, { type, customer, customerId, partyId, actorId, actor, nowMs, action, reason = "", before, after, requestId = "", ip = "" }) {
    await connection.execute("UPDATE customers SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?", [nowMs, actorId, customerId]);
    await this.audit.record(connection, { occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: `customer.${type}.${action}`, targetType: type, targetId: partyId, customerId, targetLabel: customer.customer_code, reason, detail: { before, after }, requestId, ip });
  }
}

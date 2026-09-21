import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierChildNotFound, supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { normalizeContactEmail } from "./supplierNormalization.js";
import { toContactResponse } from "./supplierProjections.js";

export const SUPPLIER_CONTACT_PURPOSES = Object.freeze(["general", "orders", "sales", "accounts_payable", "returns", "emergency"]);
const PURPOSE_SET = new Set(SUPPLIER_CONTACT_PURPOSES);

function containsControl(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function text(value, { field, maxLength, required = false }) {
  const normalized = String(value ?? "").trim();
  if ((required && !normalized) || Array.from(normalized).length > maxLength || containsControl(normalized)) {
    throw invalidSupplierInput("SUPPLIER_CONTACT_INVALID", "聯絡人資料不正確", { field });
  }
  return normalized;
}

function phone(value, field) {
  const normalized = text(value, { field, maxLength: 50 });
  if (normalized && (!/[0-9]/u.test(normalized) || !/^[0-9+().\- xX#]+$/u.test(normalized))) {
    throw invalidSupplierInput("PHONE_INVALID", "電話格式不正確", { field });
  }
  return normalized;
}

function normalizeContact(input) {
  const purposes = input.purposes ?? [];
  if (!Array.isArray(purposes) || new Set(purposes.map((purpose) => purpose.purposeCode)).size !== purposes.length) {
    throw invalidSupplierInput("SUPPLIER_CONTACT_PURPOSE_INVALID", "聯絡人用途不可重複");
  }
  for (const purpose of purposes) {
    if (!PURPOSE_SET.has(purpose.purposeCode)) {
      throw invalidSupplierInput("SUPPLIER_CONTACT_PURPOSE_INVALID", "聯絡人用途不正確");
    }
  }
  return {
    name: text(input.name, { field: "name", maxLength: 190, required: true }),
    jobTitle: text(input.jobTitle, { field: "jobTitle", maxLength: 100 }),
    department: text(input.department, { field: "department", maxLength: 100 }),
    email: normalizeContactEmail(input.email).value,
    phone: phone(input.phone, "phone"),
    mobile: phone(input.mobile, "mobile"),
    preferredLanguage: text(input.preferredLanguage, { field: "preferredLanguage", maxLength: 20 }),
    notes: text(input.notes, { field: "notes", maxLength: 500 }),
    purposes: purposes.map((purpose) => ({ purposeCode: purpose.purposeCode, isPrimary: Boolean(purpose.isPrimary) }))
  };
}

export class SupplierContactService {
  constructor({ database, logger, time, authorize = assertActorFresh, audit } = {}) {
    if (!database || !logger || !time) throw new TypeError("SupplierContactService requires database, logger and time");
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
  }

  async #supplierForUpdate(connection, supplierId) {
    const [[supplier]] = await connection.query("SELECT id, supplier_code FROM suppliers WHERE id = ? FOR UPDATE", [supplierId]);
    if (!supplier) throw supplierNotFound(supplierId);
    return supplier;
  }

  async #contactForUpdate(connection, supplierId, contactId) {
    const [[contact]] = await connection.query(
      "SELECT * FROM supplier_contacts WHERE id = ? AND supplier_id = ? FOR UPDATE",
      [contactId, supplierId]
    );
    if (!contact) throw supplierChildNotFound("contact");
    return contact;
  }

  async #replacePurposes(connection, { supplierId, contactId, purposes, actorId, nowMs, replace }) {
    for (const purpose of purposes.filter((item) => item.isPrimary)) {
      await connection.execute(
        `UPDATE supplier_contact_purposes
            SET is_primary = 0, updated_at = ?, updated_by = ?
          WHERE supplier_id = ? AND purpose_code = ? AND contact_id != ? AND is_primary = 1`,
        [nowMs, actorId, supplierId, purpose.purposeCode, contactId]
      );
    }
    if (replace) {
      await connection.execute("DELETE FROM supplier_contact_purposes WHERE contact_id = ? AND supplier_id = ?", [contactId, supplierId]);
    }
    for (const purpose of purposes) {
      await connection.execute(
        `INSERT INTO supplier_contact_purposes
          (contact_id, supplier_id, purpose_code, is_primary, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [contactId, supplierId, purpose.purposeCode, purpose.isPrimary ? 1 : 0, nowMs, nowMs, actorId, actorId]
      );
    }
  }

  async #project(connection, supplierId, contactId) {
    const [[row]] = await connection.query(
      "SELECT c.* FROM supplier_contacts c WHERE c.id = ? AND c.supplier_id = ?",
      [contactId, supplierId]
    );
    const [purposes] = await connection.query(
      "SELECT purpose_code, is_primary FROM supplier_contact_purposes WHERE contact_id = ? AND supplier_id = ? ORDER BY purpose_code",
      [contactId, supplierId]
    );
    return toContactResponse(row, purposes);
  }

  async create(input) {
    const contact = normalizeContact(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      await this.#supplierForUpdate(connection, input.supplierId);
      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `INSERT INTO supplier_contacts
          (supplier_id, name, job_title, department, email, phone, mobile, preferred_language, notes,
           status, version, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
        [input.supplierId, contact.name, contact.jobTitle, contact.department, contact.email, contact.phone,
          contact.mobile, contact.preferredLanguage, contact.notes, nowMs, nowMs, input.actorId, input.actorId]
      );
      const contactId = Number(result.insertId);
      await this.#replacePurposes(connection, { supplierId: input.supplierId, contactId, purposes: contact.purposes, actorId: input.actorId, nowMs, replace: false });
      const projected = await this.#project(connection, input.supplierId, contactId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.contact.create",
        targetType: "contact", targetId: contactId, supplierId: input.supplierId, targetLabel: contact.name,
        detail: { after: { purposes: contact.purposes } }, requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  async update(input) {
    const contact = normalizeContact(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      await this.#supplierForUpdate(connection, input.supplierId);
      const current = await this.#contactForUpdate(connection, input.supplierId, input.contactId);
      if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "聯絡人已被其他人修改，請重新載入");
      if (current.status !== "active") throw supplierConflict("SUPPLIER_CONTACT_INACTIVE", "已停用聯絡人不可修改");
      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE supplier_contacts SET name = ?, job_title = ?, department = ?, email = ?, phone = ?, mobile = ?,
          preferred_language = ?, notes = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND supplier_id = ? AND version = ?`,
        [contact.name, contact.jobTitle, contact.department, contact.email, contact.phone, contact.mobile,
          contact.preferredLanguage, contact.notes, nowMs, input.actorId, input.contactId, input.supplierId, input.version]
      );
      await this.#replacePurposes(connection, { supplierId: input.supplierId, contactId: input.contactId, purposes: contact.purposes, actorId: input.actorId, nowMs, replace: true });
      const projected = await this.#project(connection, input.supplierId, input.contactId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.contact.update",
        targetType: "contact", targetId: input.contactId, supplierId: input.supplierId, targetLabel: contact.name,
        detail: { changes: { purposes: contact.purposes } }, requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  async deactivate(input) {
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      await this.#supplierForUpdate(connection, input.supplierId);
      const current = await this.#contactForUpdate(connection, input.supplierId, input.contactId);
      if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "聯絡人已被其他人修改，請重新載入");
      if (current.status !== "active") throw supplierConflict("SUPPLIER_CONTACT_INACTIVE", "聯絡人已停用");
      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE supplier_contacts SET status = 'inactive', version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND supplier_id = ? AND version = ?`,
        [nowMs, input.actorId, input.contactId, input.supplierId, input.version]
      );
      await connection.execute(
        "UPDATE supplier_contact_purposes SET is_primary = 0, updated_at = ?, updated_by = ? WHERE contact_id = ? AND supplier_id = ?",
        [nowMs, input.actorId, input.contactId, input.supplierId]
      );
      const projected = await this.#project(connection, input.supplierId, input.contactId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.contact.deactivate",
        targetType: "contact", targetId: input.contactId, supplierId: input.supplierId, targetLabel: current.name,
        detail: { before: { status: current.status }, after: { status: "inactive" } }, requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }
}

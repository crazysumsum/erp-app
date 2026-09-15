import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { SupplierDuplicateCandidates, replaceSupplierNameGrams } from "./supplierDuplicateCandidates.js";
import { supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { normalizeContactEmail, normalizeSupplierCode, normalizeSupplierName, normalizeSupplierUrl } from "./supplierNormalization.js";
import { toAddressResponse, toContactResponse, toIdentifierResponse, toSupplierDetailResponse, toSupplierSummaryResponse } from "./supplierProjections.js";
import { assertKnownSupplierFields, assertSupplierActivatable, supplierCompletenessWarnings } from "./supplierValidation.js";

function duplicateEntry(error) {
  return (error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY";
}

const SUPPLIER_SORT_COLUMNS = Object.freeze({
  supplierCode: "s.supplier_code_key",
  supplierName: "s.supplier_name",
  status: "s.status",
  updatedAt: "s.updated_at"
});

function supplierSortColumn(sortBy) {
  return SUPPLIER_SORT_COLUMNS[sortBy] ?? SUPPLIER_SORT_COLUMNS.updatedAt;
}

function escapeLikeTerm(value) {
  return value.replace(/[\\%_]/gu, "\\$&");
}

export class SupplierAdminService {
  constructor({
    database,
    logger,
    time,
    businessMaster,
    authorize = assertActorFresh,
    duplicates,
    replaceNameGrams = replaceSupplierNameGrams,
    audit,
    approvalRequired = async () => false
  } = {}) {
    if (!database || !logger || !time || !businessMaster) {
      throw new TypeError("SupplierAdminService requires database, logger, time and businessMaster");
    }
    this.database = database;
    this.businessMaster = businessMaster;
    this.authorize = authorize;
    this.duplicates = duplicates ?? new SupplierDuplicateCandidates();
    this.replaceNameGrams = replaceNameGrams;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
    this.approvalRequired = approvalRequired;
    this.time = time;
  }

  async createSupplier(input) {
    const writable = {
      supplierCode: input.supplierCode,
      supplierName: input.supplierName,
      displayName: input.displayName,
      defaultCurrencyCode: input.defaultCurrencyCode,
      defaultCurrencyVersion: input.defaultCurrencyVersion,
      defaultPaymentTermId: input.defaultPaymentTermId,
      defaultPaymentTermVersion: input.defaultPaymentTermVersion,
      website: input.website,
      generalPhone: input.generalPhone,
      generalEmail: input.generalEmail,
      notes: input.notes,
      activate: input.activate
    };
    assertKnownSupplierFields(Object.fromEntries(Object.entries(writable).filter(([, value]) => value !== undefined)));
    const code = normalizeSupplierCode(input.supplierCode);
    const name = normalizeSupplierName(input.supplierName);
    const website = normalizeSupplierUrl(input.website);
    const email = normalizeContactEmail(input.generalEmail);
    let duplicateCandidates = [];

    let supplierId;
    try {
      supplierId = await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, {
          actorId: input.actorId,
          claimedRoles: input.claimedRoles,
          claimedPermissions: input.claimedPermissions
        });
        const defaults = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
          currencyCode: input.defaultCurrencyCode,
          currencyVersion: input.defaultCurrencyVersion,
          paymentTermId: input.defaultPaymentTermId ?? null,
          paymentTermVersion: input.defaultPaymentTermVersion,
          purpose: "new_assignment"
        });
        const [[existing]] = await connection.query(
          "SELECT id FROM suppliers WHERE supplier_code_key = ? LIMIT 1",
          [code.key]
        );
        if (existing) {
          throw supplierConflict("SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用", { supplierCode: code.value });
        }
        duplicateCandidates = await this.duplicates.find(connection, { nameKey: name.key });
        const activationRequested = Boolean(input.activate);
        if (activationRequested && await this.approvalRequired(connection)) {
          throw supplierConflict("SUPPLIER_APPROVAL_NOT_READY", "供應商審批功能尚未部署完成");
        }
        if (activationRequested) {
          assertSupplierActivatable({
            supplierCode: code.value,
            supplierName: name.value,
            status: "draft",
            defaultCurrency: defaults.currency
          });
        }
        const status = activationRequested ? "active" : "draft";
        const nowMs = this.time.nowMs();
        const [result] = await connection.execute(
          `INSERT INTO suppliers
            (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name,
             default_currency_code, default_payment_term_id, website, general_phone, general_email,
             notes, status, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            code.value, code.key, name.value, name.key, String(input.displayName ?? "").trim(),
            defaults.currency.code, defaults.paymentTerm?.id ?? null, website,
            String(input.generalPhone ?? "").trim(), email.value, String(input.notes ?? "").trim(),
            status, nowMs, nowMs, input.actorId, input.actorId
          ]
        );
        const id = Number(result.insertId);
        await this.replaceNameGrams(connection, id, name.key);
        await this.audit.record(connection, {
          actorUserId: input.actorId,
          actorUsername: actor.username,
          action: "supplier.create",
          targetType: "supplier",
          targetId: id,
          supplierId: id,
          targetLabel: code.value,
          detail: { after: { status, currencyCode: defaults.currency.code, paymentTermId: defaults.paymentTerm?.id ?? null } },
          requestId: input.requestId,
          ip: input.ip
        });
        return id;
      });
    } catch (error) {
      if (duplicateEntry(error)) {
        throw supplierConflict("SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用", { supplierCode: code.value });
      }
      throw error;
    }

    const [[row]] = await this.database.query("SELECT * FROM suppliers WHERE id = ?", [supplierId]);
    if (!row) throw supplierNotFound(supplierId);
    const warnings = supplierCompletenessWarnings({ defaultPaymentTermId: row.default_payment_term_id });
    return { ...toSupplierDetailResponse(row, { warnings }), duplicateCandidates };
  }

  async listSuppliers({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    q = "",
    status,
    currencyCode,
    paymentTermId,
    updatedFrom,
    updatedTo,
    includeArchived = false,
    sortBy = "updatedAt",
    descending = true
  }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const conditions = [];
    const params = [];
    if (status) {
      conditions.push("s.status = ?");
      params.push(status);
    } else if (!includeArchived) {
      conditions.push("s.status != 'archived'");
    }
    if (currencyCode) {
      conditions.push("s.default_currency_code = ?");
      params.push(currencyCode);
    }
    if (paymentTermId !== undefined) {
      if (paymentTermId === null) conditions.push("s.default_payment_term_id IS NULL");
      else {
        conditions.push("s.default_payment_term_id = ?");
        params.push(paymentTermId);
      }
    }
    if (updatedFrom !== undefined) {
      conditions.push("s.updated_at >= ?");
      params.push(updatedFrom);
    }
    if (updatedTo !== undefined) {
      conditions.push("s.updated_at <= ?");
      params.push(updatedTo);
    }

    const search = String(q ?? "").normalize("NFKC").trim();
    let exactCodeKey = null;
    if (search) {
      const escaped = escapeLikeTerm(search);
      exactCodeKey = search.toLowerCase();
      conditions.push(`(
        s.supplier_code_key LIKE ? ESCAPE '\\\\'
        OR s.supplier_name LIKE ? ESCAPE '\\\\'
        OR s.display_name LIKE ? ESCAPE '\\\\'
        OR s.general_phone LIKE ? ESCAPE '\\\\'
        OR s.general_email LIKE ? ESCAPE '\\\\'
      )`);
      params.push(`${escaped.toLowerCase()}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const direction = descending ? "DESC" : "ASC";
    const stableSort = `${supplierSortColumn(sortBy)} ${direction}, s.id ${direction}`;
    const exactOrder = exactCodeKey ? "CASE WHEN s.supplier_code_key = ? THEN 0 ELSE 1 END, " : "";
    const offset = (page - 1) * pageSize;
    const [countRows] = await this.database.query(`SELECT COUNT(*) AS total FROM suppliers s ${where}`, params);
    const listParams = exactCodeKey ? [...params, exactCodeKey, pageSize, offset] : [...params, pageSize, offset];
    const [rows] = await this.database.query(
      `SELECT s.id, s.supplier_code, s.supplier_name, s.display_name,
              s.default_currency_code, s.default_payment_term_id, s.status, s.version, s.updated_at,
              (SELECT c.name
                 FROM supplier_contact_purposes cp
                 JOIN supplier_contacts c ON c.id = cp.contact_id AND c.supplier_id = cp.supplier_id
                WHERE cp.supplier_id = s.id AND cp.purpose_code = 'orders' AND cp.primary_slot = 1
                  AND c.status = 'active'
                LIMIT 1) AS primary_contact_name
         FROM suppliers s ${where}
        ORDER BY ${exactOrder}${stableSort}
        LIMIT ? OFFSET ?`,
      listParams
    );
    return { items: rows.map(toSupplierSummaryResponse), total: Number(countRows[0].total), page, pageSize };
  }

  async getSupplier({ actorId, claimedRoles, claimedPermissions, id }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[row]] = await this.database.query("SELECT * FROM suppliers WHERE id = ?", [id]);
    if (!row) throw supplierNotFound(id);
    const [addressRows] = await this.database.query(
      "SELECT * FROM supplier_addresses WHERE supplier_id = ? ORDER BY status, id LIMIT 100",
      [id]
    );
    let purposeRows = [];
    if (addressRows.length > 0) {
      [purposeRows] = await this.database.query(
        "SELECT address_id, purpose_code, is_primary FROM supplier_address_purposes WHERE supplier_id = ? ORDER BY address_id, purpose_code",
        [id]
      );
    }
    const purposesByAddress = new Map();
    for (const purpose of purposeRows) {
      const addressId = Number(purpose.address_id);
      if (!purposesByAddress.has(addressId)) purposesByAddress.set(addressId, []);
      purposesByAddress.get(addressId).push(purpose);
    }
    const addresses = addressRows.map((address) => toAddressResponse(address, purposesByAddress.get(Number(address.id)) ?? []));
    const hasOrderingAddress = addresses.some((address) => address.status === "active" && address.purposes.some((purpose) => purpose.purposeCode === "ordering"));
    const [contactRows] = await this.database.query(
      "SELECT * FROM supplier_contacts WHERE supplier_id = ? ORDER BY status, name, id LIMIT 100",
      [id]
    );
    let contactPurposeRows = [];
    if (contactRows.length > 0) {
      [contactPurposeRows] = await this.database.query(
        "SELECT contact_id, purpose_code, is_primary FROM supplier_contact_purposes WHERE supplier_id = ? ORDER BY contact_id, purpose_code",
        [id]
      );
    }
    const purposesByContact = new Map();
    for (const purpose of contactPurposeRows) {
      const contactId = Number(purpose.contact_id);
      if (!purposesByContact.has(contactId)) purposesByContact.set(contactId, []);
      purposesByContact.get(contactId).push(purpose);
    }
    const contacts = contactRows.map((contact) => toContactResponse(contact, purposesByContact.get(Number(contact.id)) ?? []));
    const hasOrdersContact = contacts.some((contact) => contact.status === "active" && contact.purposes.some((purpose) => purpose.purposeCode === "orders" && purpose.isPrimary));
    const [identifierRows] = await this.database.query(
      "SELECT * FROM supplier_identifiers WHERE supplier_id = ? ORDER BY identifier_type, issuer_country_code, id LIMIT 100",
      [id]
    );
    const identifiers = identifierRows.map(toIdentifierResponse);
    return toSupplierDetailResponse(row, {
      addresses,
      contacts,
      identifiers,
      warnings: supplierCompletenessWarnings({
        defaultPaymentTermId: row.default_payment_term_id,
        hasOrderingAddress,
        hasOrdersContact,
        hasIdentifier: identifiers.length > 0
      })
    });
  }

  async getSupplierCompleteness({ actorId, claimedRoles, claimedPermissions, id }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[row]] = await this.database.query("SELECT * FROM suppliers WHERE id = ?", [id]);
    if (!row) throw supplierNotFound(id);
    const [[orderingAddress]] = await this.database.query(
      `SELECT 1 AS present
         FROM supplier_addresses a
         JOIN supplier_address_purposes p ON p.address_id = a.id AND p.supplier_id = a.supplier_id
        WHERE a.supplier_id = ? AND a.status = 'active' AND p.purpose_code = 'ordering'
        LIMIT 1`,
      [id]
    );
    const [[ordersContact]] = await this.database.query(
      `SELECT 1 AS present
         FROM supplier_contacts c
         JOIN supplier_contact_purposes p ON p.contact_id = c.id AND p.supplier_id = c.supplier_id
        WHERE c.supplier_id = ? AND c.status = 'active' AND p.purpose_code = 'orders' AND p.is_primary = 1
        LIMIT 1`,
      [id]
    );
    const [[identifier]] = await this.database.query(
      "SELECT 1 AS present FROM supplier_identifiers WHERE supplier_id = ? LIMIT 1",
      [id]
    );
    return {
      supplierId: Number(row.id),
      issues: [],
      warnings: supplierCompletenessWarnings({
        defaultPaymentTermId: row.default_payment_term_id,
        hasOrderingAddress: Boolean(orderingAddress),
        hasOrdersContact: Boolean(ordersContact),
        hasIdentifier: Boolean(identifier)
      })
    };
  }

  async findSupplierDuplicateCandidates({ actorId, claimedRoles, claimedPermissions, supplierCode, supplierName }) {
    const code = normalizeSupplierCode(supplierCode);
    const name = normalizeSupplierName(supplierName);
    return this.database.withTransaction(async (connection) => {
      await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const [[existing]] = await connection.query(
        "SELECT id, supplier_code, supplier_name FROM suppliers WHERE supplier_code_key = ? LIMIT 1",
        [code.key]
      );
      const duplicateCandidates = await this.duplicates.find(connection, { nameKey: name.key });
      return {
        codeConflict: existing ? {
          supplierId: Number(existing.id),
          supplierCode: existing.supplier_code,
          supplierName: existing.supplier_name
        } : null,
        duplicateCandidates
      };
    });
  }
}

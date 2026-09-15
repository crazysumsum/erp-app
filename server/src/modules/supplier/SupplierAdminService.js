import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { SupplierDuplicateCandidates, replaceSupplierNameGrams } from "./supplierDuplicateCandidates.js";
import { supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { normalizeContactEmail, normalizeSupplierCode, normalizeSupplierName, normalizeSupplierUrl } from "./supplierNormalization.js";
import { toSupplierDetailResponse } from "./supplierProjections.js";
import { assertKnownSupplierFields, assertSupplierActivatable, supplierCompletenessWarnings } from "./supplierValidation.js";

function duplicateEntry(error) {
  return (error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY";
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
}

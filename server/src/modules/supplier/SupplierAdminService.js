import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { SupplierDuplicateCandidates, replaceSupplierNameGrams } from "./supplierDuplicateCandidates.js";
import { SupplierReferenceService } from "./SupplierReferenceService.js";
import { invalidSupplierInput, supplierConflict, supplierNotFound } from "./supplierErrors.js";
import {
  normalizeContactEmail,
  normalizeSupplierCode,
  normalizeSupplierName,
  normalizeSupplierOptionalText,
  normalizeSupplierUrl
} from "./supplierNormalization.js";
import { toAddressResponse, toContactResponse, toIdentifierResponse, toSupplierDetailResponse, toSupplierSummaryResponse } from "./supplierProjections.js";
import { assertSupplierDeletable, transitionSupplierStatus } from "./supplierStateMachine.js";
import {
  assertKnownSupplierFields,
  assertSupplierActivatable,
  supplierActivatabilityIssues,
  supplierCompletenessWarnings
} from "./supplierValidation.js";

function duplicateEntry(error) {
  return (error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY";
}

function referencedRow(error) {
  return ["ER_ROW_IS_REFERENCED", "ER_ROW_IS_REFERENCED_2"].includes(error?.cause?.code ?? error?.code);
}

function deepFreeze(value) {
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === "object") deepFreeze(entry);
  }
  return Object.freeze(value);
}

// One definition per status transition. #changeStatus takes a key of this map, not
// a descriptor, so a transition added in a later phase cannot reach the transition
// path without also entering the replay filter derived below.
export const LIFECYCLE_COMMANDS = deepFreeze({
  activate: { targetStatus: "active", allowedFrom: ["draft"], action: "supplier.activate", activationCheck: true, approvalCheck: true },
  suspend: { targetStatus: "suspended", allowedFrom: ["active"], action: "supplier.suspend" },
  reactivate: { targetStatus: "active", allowedFrom: ["suspended"], action: "supplier.reactivate", activationCheck: true },
  block: { targetStatus: "blocked", allowedFrom: ["active", "suspended"], action: "supplier.block" },
  unblock: { targetStatus: "suspended", allowedFrom: ["blocked"], action: "supplier.unblock" },
  archive: { targetStatus: "archived", allowedFrom: ["draft", "active", "suspended"], action: "supplier.archive", openFlowCheck: true },
  restore: { targetStatus: "suspended", allowedFrom: ["archived"], action: "supplier.restore" }
});

// Replay detection must look only at status transitions. Every audit action this
// module writes begins with "supplier.", so a broader match lets an unrelated
// child-record write shadow the real transition.
const LIFECYCLE_ACTIONS = Object.freeze(Object.values(LIFECYCLE_COMMANDS).map((command) => command.action));

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

function requireReason(value, message = "這項修改必須填寫原因") {
  const reason = String(value ?? "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw invalidSupplierInput("SUPPLIER_REASON_REQUIRED", message, { field: "reason" });
  }
  return reason;
}

function assertExpectedVersion(current, expected) {
  if (Number(current.version) !== Number(expected)) {
    throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
  }
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
    references,
    openFlows,
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
    this.references = references ?? new SupplierReferenceService();
    this.openFlows = openFlows ?? new SupplierReferenceService();
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
    const displayName = normalizeSupplierOptionalText(input.displayName, { field: "displayName", maxLength: 190 });
    const website = normalizeSupplierUrl(input.website);
    const email = normalizeContactEmail(input.generalEmail);
    const generalPhone = normalizeSupplierOptionalText(input.generalPhone, { field: "generalPhone", maxLength: 50 });
    const notes = normalizeSupplierOptionalText(input.notes, { field: "notes", maxLength: 2000 });
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
            code.value, code.key, name.value, name.key, displayName,
            defaults.currency.code, defaults.paymentTerm?.id ?? null, website,
            generalPhone, email.value, notes,
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

  async updateSupplier(input) {
    if (Object.hasOwn(input, "supplierCode")) {
      throw supplierConflict("SUPPLIER_CODE_CHANGE_REQUIRED", "Supplier Code 只能透過受控修正功能修改");
    }
    const name = normalizeSupplierName(input.supplierName);
    const displayName = normalizeSupplierOptionalText(input.displayName, { field: "displayName", maxLength: 190 });
    const website = normalizeSupplierUrl(input.website);
    const email = normalizeContactEmail(input.generalEmail);
    const generalPhone = normalizeSupplierOptionalText(input.generalPhone, { field: "generalPhone", maxLength: 50 });
    const notes = normalizeSupplierOptionalText(input.notes, { field: "notes", maxLength: 2000 });
    let duplicateCandidates = [];

    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
      if (!current) throw supplierNotFound(input.id);
      assertExpectedVersion(current, input.version);
      if (current.status === "archived") {
        throw supplierConflict("SUPPLIER_UPDATE_NOT_ALLOWED", "已封存供應商不可修改一般資料", { status: current.status });
      }

      const defaults = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
        currencyCode: input.defaultCurrencyCode,
        currencyVersion: input.defaultCurrencyVersion,
        paymentTermId: input.defaultPaymentTermId ?? null,
        paymentTermVersion: input.defaultPaymentTermVersion,
        purpose: "new_assignment"
      });
      const currencyChanged = current.default_currency_code !== defaults.currency.code;
      const reason = currencyChanged ? requireReason(input.reason, "修改預設幣別必須填寫原因") : String(input.reason ?? "").trim();
      duplicateCandidates = (await this.duplicates.find(connection, { nameKey: name.key }))
        .filter((candidate) => Number(candidate.supplierId) !== Number(input.id));
      const nowMs = this.time.nowMs();
      const next = {
        supplierName: name.value,
        displayName,
        defaultCurrencyCode: defaults.currency.code,
        defaultPaymentTermId: defaults.paymentTerm?.id ?? null,
        website,
        generalPhone,
        generalEmail: email.value,
        notes
      };
      const [result] = await connection.execute(
        `UPDATE suppliers
            SET supplier_name = ?, supplier_name_key = ?, display_name = ?, default_currency_code = ?,
                default_payment_term_id = ?, website = ?, general_phone = ?, general_email = ?, notes = ?,
                version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [
          next.supplierName, name.key, next.displayName, next.defaultCurrencyCode,
          next.defaultPaymentTermId, next.website, next.generalPhone, next.generalEmail, next.notes,
          nowMs, input.actorId, input.id, input.version
        ]
      );
      if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
      if (current.supplier_name_key !== name.key) await this.replaceNameGrams(connection, input.id, name.key);
      await this.audit.record(connection, {
        actorUserId: input.actorId,
        actorUsername: actor.username,
        action: "supplier.update",
        targetType: "supplier",
        targetId: input.id,
        supplierId: input.id,
        targetLabel: current.supplier_code,
        reason,
        detail: {
          before: {
            supplierName: current.supplier_name,
            displayName: current.display_name,
            defaultCurrencyCode: current.default_currency_code,
            defaultPaymentTermId: current.default_payment_term_id,
            website: current.website,
            generalPhone: current.general_phone,
            generalEmail: current.general_email,
            notes: current.notes
          },
          after: next
        },
        requestId: input.requestId,
        ip: input.ip
      });
    });

    const detail = await this.getSupplier({
      actorId: input.actorId,
      claimedRoles: input.claimedRoles,
      claimedPermissions: input.claimedPermissions,
      id: input.id
    });
    return { ...detail, duplicateCandidates };
  }

  async changeSupplierCode(input) {
    const code = normalizeSupplierCode(input.supplierCode);
    const reason = requireReason(input.reason, "修正 Supplier Code 必須填寫原因");
    try {
      await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, {
          actorId: input.actorId,
          claimedRoles: input.claimedRoles,
          claimedPermissions: input.claimedPermissions
        });
        const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
        if (!current) throw supplierNotFound(input.id);
        assertExpectedVersion(current, input.version);
        if (current.status === "archived") {
          throw supplierConflict("SUPPLIER_UPDATE_NOT_ALLOWED", "已封存供應商不可修正 Supplier Code", { status: current.status });
        }
        const referenceSummary = await this.references.describeReferences(connection, input.id);
        if (referenceSummary.total !== 0) {
          throw supplierConflict("SUPPLIER_REFERENCED", "供應商已有引用，不可修改 Supplier Code", referenceSummary);
        }
        const nowMs = this.time.nowMs();
        const [result] = await connection.execute(
          `UPDATE suppliers
              SET supplier_code = ?, supplier_code_key = ?, version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND version = ?`,
          [code.value, code.key, nowMs, input.actorId, input.id, input.version]
        );
        if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
        await this.audit.record(connection, {
          actorUserId: input.actorId,
          actorUsername: actor.username,
          action: "supplier.code.change",
          targetType: "supplier",
          targetId: input.id,
          supplierId: input.id,
          targetLabel: code.value,
          reason,
          detail: { before: { supplierCode: current.supplier_code }, after: { supplierCode: code.value } },
          requestId: input.requestId,
          ip: input.ip
        });
      });
    } catch (error) {
      if (duplicateEntry(error)) {
        throw supplierConflict("SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用", { supplierCode: code.value });
      }
      throw error;
    }

    return this.getSupplier({
      actorId: input.actorId,
      claimedRoles: input.claimedRoles,
      claimedPermissions: input.claimedPermissions,
      id: input.id
    });
  }

  async #changeStatus(input, commandName) {
    const command = LIFECYCLE_COMMANDS[commandName];
    if (!command) throw new TypeError(`Unknown supplier lifecycle command: ${commandName}`);
    const { targetStatus, allowedFrom, action, activationCheck = false, approvalCheck = false, openFlowCheck = false } = command;
    const reason = action === "supplier.activate" ? "" : requireReason(input.reason);
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      // Design 2.6 fixes the lock order as settings -> suppliers -> requests ->
      // child -> audit. The policy read takes a settings lock, so it belongs before
      // the row lock below even though the answer is not needed until further down.
      const approvalIsRequired = approvalCheck ? await this.approvalRequired(connection) : false;
      const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
      if (!current) throw supplierNotFound(input.id);
      if (current.status === targetStatus) {
        const [[latestTransition]] = await connection.query(
          `SELECT action FROM supplier_audit_logs WHERE supplier_id = ? AND action IN (${LIFECYCLE_ACTIONS.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT 1`,
          [input.id, ...LIFECYCLE_ACTIONS]
        );
        if (latestTransition?.action === action) return;
        throw supplierConflict("STATUS_TRANSITION_INVALID", "目前供應商狀態不允許這項操作", { from: current.status, to: targetStatus });
      }
      assertExpectedVersion(current, input.version);
      if (!allowedFrom.includes(current.status)) {
        throw supplierConflict("STATUS_TRANSITION_INVALID", "目前供應商狀態不允許這項操作", { from: current.status, to: targetStatus });
      }
      transitionSupplierStatus(current.status, targetStatus);

      if (approvalCheck) {
        if (approvalIsRequired) throw supplierConflict("SUPPLIER_APPROVAL_NOT_READY", "供應商審批功能尚未部署完成");
        if (input.approverUserId !== undefined && input.approverUserId !== null) {
          throw invalidSupplierInput("APPROVER_NOT_REQUIRED", "目前設定不需要指定審批人", { field: "approverUserId" });
        }
      }
      if (activationCheck) {
        const defaults = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
          currencyCode: current.default_currency_code,
          paymentTermId: current.default_payment_term_id,
          purpose: "new_assignment"
        });
        assertSupplierActivatable({
          supplierCode: current.supplier_code,
          supplierName: current.supplier_name,
          status: current.status,
          defaultCurrency: defaults.currency
        });
      }
      if (openFlowCheck) {
        const blockers = await this.openFlows.describeReferences(connection, input.id);
        if (blockers.total !== 0) {
          throw supplierConflict("SUPPLIER_OPEN_FLOWS", "供應商仍有未完成流程，不可封存", blockers);
        }
      }

      const [result] = await connection.execute(
        `UPDATE suppliers
            SET status = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [targetStatus, this.time.nowMs(), input.actorId, input.id, input.version]
      );
      if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
      await this.audit.record(connection, {
        actorUserId: input.actorId,
        actorUsername: actor.username,
        action,
        targetType: "supplier",
        targetId: input.id,
        supplierId: input.id,
        targetLabel: current.supplier_code,
        reason,
        detail: { before: { status: current.status }, after: { status: targetStatus } },
        requestId: input.requestId,
        ip: input.ip
      });
    });
    return this.getSupplier({
      actorId: input.actorId,
      claimedRoles: input.claimedRoles,
      claimedPermissions: input.claimedPermissions,
      id: input.id
    });
  }

  activateSupplier(input) {
    return this.#changeStatus(input, "activate");
  }

  suspendSupplier(input) {
    return this.#changeStatus(input, "suspend");
  }

  reactivateSupplier(input) {
    return this.#changeStatus(input, "reactivate");
  }

  blockSupplier(input) {
    return this.#changeStatus(input, "block");
  }

  unblockSupplier(input) {
    return this.#changeStatus(input, "unblock");
  }

  archiveSupplier(input) {
    return this.#changeStatus(input, "archive");
  }

  restoreSupplier(input) {
    return this.#changeStatus(input, "restore");
  }

  async deleteSupplier(input) {
    const reason = requireReason(input.reason);
    try {
      await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, {
          actorId: input.actorId,
          claimedRoles: input.claimedRoles,
          claimedPermissions: input.claimedPermissions
        });
        const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
        if (!current) throw supplierNotFound(input.id);
        assertExpectedVersion(current, input.version);
        const referenceSummary = await this.references.describeReferences(connection, input.id);
        assertSupplierDeletable(current.status, referenceSummary);
        const [[activeHistory]] = await connection.query(
          "SELECT 1 AS present FROM supplier_audit_logs WHERE supplier_id = ? AND action IN ('supplier.activate', 'approval.approve') LIMIT 1",
          [input.id]
        );
        if (activeHistory) {
          throw supplierConflict("SUPPLIER_DELETE_NOT_ALLOWED", "曾經啟用的供應商不可永久刪除");
        }
        const [result] = await connection.execute("DELETE FROM suppliers WHERE id = ? AND version = ?", [input.id, input.version]);
        if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
        await this.audit.record(connection, {
          actorUserId: input.actorId,
          actorUsername: actor.username,
          action: "supplier.delete",
          targetType: "supplier",
          targetId: input.id,
          supplierId: input.id,
          targetLabel: current.supplier_code,
          reason,
          detail: { before: { status: current.status }, after: { deleted: true } },
          requestId: input.requestId,
          ip: input.ip
        });
      });
    } catch (error) {
      // this.references only reports the child tables whose checkers a caller
      // actually registered, so a RESTRICT foreign key the checker set does not
      // cover still reaches the DELETE. Report it as the same domain conflict
      // instead of letting the driver error surface as a 500.
      if (referencedRow(error)) {
        throw supplierConflict("SUPPLIER_REFERENCED", "供應商已有引用，不可永久刪除");
      }
      throw error;
    }
    return { id: input.id };
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
    const [[currency]] = await this.database.query(
      "SELECT code, status FROM currencies WHERE code = ? LIMIT 1",
      [row.default_currency_code]
    );
    const issues = supplierActivatabilityIssues({
      supplierCode: row.supplier_code,
      supplierName: row.supplier_name,
      status: row.status,
      defaultCurrency: currency
    }).filter((issue) => row.status !== "active" || issue.code !== "STATUS_NOT_ACTIVATABLE");
    return {
      supplierId: Number(row.id),
      issues,
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

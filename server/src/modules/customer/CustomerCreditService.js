import { assertActorFresh } from "../authorization/directoryLookups.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerApprovalService } from "./CustomerApprovalService.js";
import { creditPolicyInvalid, customerNotFound, versionConflict } from "./customerErrors.js";

const MONEY_PATTERN = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{4}$/;

function text(value, maxLength) {
  if (typeof value !== "string") throw creditPolicyInvalid();
  const result = value.trim();
  if ([...result].length > maxLength || /[\p{Cc}]/u.test(result)) throw creditPolicyInvalid();
  return result;
}

function reasonText(value) {
  const result = text(value, 500);
  if ([...result].length < 5) throw creditPolicyInvalid();
  return result;
}

function creditInput(input) {
  const creditLimit = input.creditLimit === null ? null : input.creditLimit;
  if (creditLimit !== null && (typeof creditLimit !== "string" || !MONEY_PATTERN.test(creditLimit))) throw creditPolicyInvalid();
  const currencyCode = input.creditCurrencyCode === null ? null : input.creditCurrencyCode;
  if (currencyCode !== null && (typeof currencyCode !== "string" || !/^[A-Z]{3}$/.test(currencyCode))) throw creditPolicyInvalid();
  if (creditLimit !== null && currencyCode === null) throw creditPolicyInvalid();
  if (input.creditStatus !== "normal" && input.creditStatus !== "on_hold") throw creditPolicyInvalid();
  return {
    creditLimit,
    currencyCode,
    creditStatus: input.creditStatus,
    creditNotes: Object.hasOwn(input, "creditNotes") ? text(input.creditNotes, 1000) : undefined,
    reason: reasonText(input.reason)
  };
}

function projection(row) {
  if (!row) return { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null };
  return {
    configured: true,
    creditLimit: row.credit_limit === null ? null : String(row.credit_limit),
    currencyCode: row.credit_currency_code,
    status: row.credit_status,
    policyVersion: Number(row.version)
  };
}

function auditSnapshot(row) {
  const value = projection(row);
  return { configured: value.configured, creditLimit: value.creditLimit, currencyCode: value.currencyCode, creditStatus: value.status, policyVersion: value.policyVersion };
}

export class CustomerCreditService {
  constructor({ database, time, actorVerifier = assertActorFresh, audit = new CustomerAuditLogService(), businessMaster, approvals } = {}) {
    if (!database || !time) throw new TypeError("CustomerCreditService requires database and time");
    this.database = database;
    this.time = time;
    this.actorVerifier = actorVerifier;
    this.audit = audit;
    this.businessMaster = businessMaster ?? new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
    this.approvals = approvals ?? new CustomerApprovalService({ database, time, audit });
  }

  async get({ customerId, actorId, claimedRoles, claimedPermissions }) {
    await this.actorVerifier(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[customer]] = await this.database.query("SELECT id FROM customers WHERE id = ?", [customerId]);
    if (!customer) throw customerNotFound(customerId);
    const [[row]] = await this.database.query("SELECT customer_id, credit_limit, credit_currency_code, credit_status, version FROM customer_credit_profiles WHERE customer_id = ?", [customerId]);
    return projection(row);
  }

  async save({ customerId, actorId, claimedRoles, claimedPermissions, version, requestId = "", ip = "", ...input }) {
    const value = creditInput(input);
    if (version !== null && (!Number.isSafeInteger(version) || version < 1)) throw creditPolicyInvalid();
    return this.database.withTransaction(async (connection) => {
      const actor = await this.actorVerifier(connection, { actorId, claimedRoles, claimedPermissions });
      const [[customer]] = await connection.query("SELECT id, customer_code, status FROM customers WHERE id = ? FOR UPDATE", [customerId]);
      if (!customer) throw customerNotFound(customerId);
      const [[before]] = await connection.query("SELECT * FROM customer_credit_profiles WHERE customer_id = ? FOR UPDATE", [customerId]);
      if ((version === null && before) || (version !== null && !before)) throw versionConflict(before?.version ?? 0);
      if (before && Number(before.version) !== version) throw versionConflict(before.version);
      if (value.creditLimit !== null) {
        try {
          await this.businessMaster.assertCurrencyUsableInTransaction(connection, { code: value.currencyCode, purpose: "new_assignment" });
        } catch (error) {
          if (error?.code === "CURRENCY_NOT_ACTIVE") throw creditPolicyInvalid();
          throw error;
        }
      }
      const nowMs = this.time.nowMs();
      let after;
      if (!before) {
        await connection.execute(
          `INSERT INTO customer_credit_profiles
             (customer_id, credit_limit, credit_currency_code, credit_status, credit_notes, last_change_reason,
              created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [customerId, value.creditLimit, value.currencyCode, value.creditStatus, value.creditNotes ?? "", value.reason, nowMs, nowMs, actorId, actorId]
        );
        after = { customer_id: customerId, credit_limit: value.creditLimit, credit_currency_code: value.currencyCode, credit_status: value.creditStatus, credit_notes: value.creditNotes ?? "", version: 1 };
      } else {
        const creditNotes = value.creditNotes ?? before.credit_notes;
        const [result] = await connection.execute(
          `UPDATE customer_credit_profiles SET credit_limit = ?, credit_currency_code = ?, credit_status = ?,
             credit_notes = ?, last_change_reason = ?, version = version + 1, updated_at = ?, updated_by = ?
           WHERE customer_id = ? AND version = ?`,
          [value.creditLimit, value.currencyCode, value.creditStatus, creditNotes, value.reason, nowMs, actorId, customerId, version]
        );
        if (result.affectedRows !== 1) throw versionConflict(before.version);
        after = { ...before, credit_limit: value.creditLimit, credit_currency_code: value.currencyCode, credit_status: value.creditStatus, credit_notes: creditNotes, version: Number(version) + 1 };
      }
      if ((before?.credit_status ?? "not_configured") !== value.creditStatus) {
        await this.approvals.invalidateForCriticalChange(connection, { customer, actorId, actorUsername: actor.username, reason: value.reason, requestId, ip });
      }
      await this.#finish(connection, { customer, customerId, actorId, actor, nowMs, action: before ? "update" : "create", reason: value.reason, before: before ? auditSnapshot(before) : undefined, after: auditSnapshot(after), requestId, ip });
      return projection(after);
    });
  }

  async clear({ customerId, actorId, claimedRoles, claimedPermissions, version, reason, requestId = "", ip = "" }) {
    const safeReason = reasonText(reason);
    if (!Number.isSafeInteger(version) || version < 1) throw creditPolicyInvalid();
    return this.database.withTransaction(async (connection) => {
      const actor = await this.actorVerifier(connection, { actorId, claimedRoles, claimedPermissions });
      const [[customer]] = await connection.query("SELECT id, customer_code, status FROM customers WHERE id = ? FOR UPDATE", [customerId]);
      if (!customer) throw customerNotFound(customerId);
      const [[before]] = await connection.query("SELECT * FROM customer_credit_profiles WHERE customer_id = ? FOR UPDATE", [customerId]);
      if (!before) throw versionConflict(0);
      const nowMs = this.time.nowMs();
      const [result] = await connection.execute("DELETE FROM customer_credit_profiles WHERE customer_id = ? AND version = ?", [customerId, version]);
      if (result.affectedRows !== 1) throw versionConflict(before.version);
      await this.approvals.invalidateForCriticalChange(connection, { customer, actorId, actorUsername: actor.username, reason: safeReason, requestId, ip });
      await this.#finish(connection, { customer, customerId, actorId, actor, nowMs, action: "clear", reason: safeReason, before: auditSnapshot(before), after: auditSnapshot(null), requestId, ip });
      return projection(null);
    });
  }

  async #finish(connection, { customer, customerId, actorId, actor, nowMs, action, reason, before, after, requestId, ip }) {
    await connection.execute("UPDATE customers SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?", [nowMs, actorId, customerId]);
    await this.audit.record(connection, { occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: `customer.credit.${action}`, targetType: "credit", targetId: customerId, customerId, targetLabel: customer.customer_code, reason, detail: { before, after }, requestId, ip });
  }
}

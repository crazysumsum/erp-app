import { createHash } from "node:crypto";

import { assertActorFresh, loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import {
  customerApprovalConflict,
  customerApprovalInvalid,
  customerApprovalRequestNotFound,
  customerNotFound,
  versionConflict
} from "./customerErrors.js";

const PENDING = "pending";

function sameUser(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && Number(left) === Number(right);
}

function note(value) {
  const result = String(value ?? "").trim();
  if ([...result].length > 500 || /[\p{Cc}]/u.test(result)) {
    throw customerApprovalInvalid("APPROVAL_NOTE_INVALID", "審批說明格式不正確", { field: "requestNote" });
  }
  return result;
}

function hash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest();
}

function snapshot(customer, identifiers, credit) {
  return {
    customerCodeKey: String(customer.customer_code_key),
    legalNameKey: String(customer.legal_name_key),
    defaultCurrencyCode: customer.default_currency_code === null ? null : String(customer.default_currency_code),
    identifiers: identifiers.map((row) => [String(row.identifier_type), String(row.issuer_country_code), String(row.identifier_value_key)]).sort(),
    creditStatus: credit?.credit_status ?? "not_configured"
  };
}

function summary(customer, identifiers, credit) {
  return {
    customerCode: String(customer.customer_code),
    legalName: String(customer.legal_name),
    defaultCurrencyCode: customer.default_currency_code === null ? null : String(customer.default_currency_code),
    identifierCount: identifiers.length,
    creditStatus: String(credit?.credit_status ?? "not_configured")
  };
}

export class CustomerApprovalService {
  constructor({ database, time, authorize = assertActorFresh, loadPermissions = loadPermissionNamesForUser, audit = new CustomerAuditLogService() } = {}) {
    if (!database || !time) throw new TypeError("CustomerApprovalService requires database and time");
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.loadPermissions = loadPermissions;
    this.audit = audit;
  }

  async submit(input) {
    const requestNote = note(input.requestNote);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const [[setting]] = await connection.query("SELECT require_activation_approval, version FROM customer_settings WHERE id = 1 FOR SHARE");
      if (!setting || Number(setting.require_activation_approval) !== 1) {
        throw customerApprovalConflict("APPROVAL_REQUIRED", "目前設定不需要啟用審批");
      }
      const [[customer]] = await connection.query("SELECT * FROM customers WHERE id = ? FOR UPDATE", [input.customerId]);
      if (!customer) throw customerNotFound(input.customerId);
      if (customer.status !== "draft") {
        throw customerApprovalConflict("CUSTOMER_NOT_DRAFT", "只有草稿客戶可提交審批", { status: customer.status });
      }
      const approver = await this.#eligibleApprover(connection, input.approverUserId, input.actorId);
      const [identifiers] = await connection.query(
        "SELECT identifier_type, issuer_country_code, identifier_value_key FROM customer_identifiers WHERE customer_id = ? AND status = 'active' ORDER BY identifier_type, issuer_country_code, identifier_value_key FOR UPDATE",
        [input.customerId]
      );
      const [[credit]] = await connection.query(
        "SELECT credit_status FROM customer_credit_profiles WHERE customer_id = ? FOR UPDATE",
        [input.customerId]
      );
      const critical = snapshot(customer, identifiers, credit);
      const nowMs = this.time.nowMs();
      let created;
      try {
        [created] = await connection.execute(
          `INSERT INTO customer_activation_requests
            (customer_id, requested_by, assigned_approver_id, customer_version, critical_snapshot_hash, summary,
             approval_setting_value, approval_setting_version, status, request_note, requested_at)
           VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), 1, ?, 'pending', ?, ?)`,
          [input.customerId, input.actorId, approver.id, Number(customer.version) + 1, hash(critical),
            JSON.stringify(summary(customer, identifiers, credit)), Number(setting.version), requestNote, nowMs]
        );
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          throw customerApprovalConflict("APPROVAL_REQUEST_OPEN", "客戶已有待處理的審批申請");
        }
        throw error;
      }
      const [updated] = await connection.execute(
        "UPDATE customers SET status = 'pending_approval', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?",
        [nowMs, input.actorId, input.customerId, customer.version]
      );
      if (updated.affectedRows !== 1) throw versionConflict(customer.version);
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: input.actorId, actorUsername: actor.username, action: "approval.submit",
        targetType: "approval", targetId: Number(created.insertId), customerId: input.customerId,
        targetLabel: customer.customer_code, reason: requestNote,
        detail: { after: { status: PENDING, assignedApproverId: approver.id, customerVersion: Number(customer.version) + 1 } },
        requestId: input.requestId, ip: input.ip
      });
      return { id: Number(created.insertId), customerId: Number(input.customerId), customerStatus: "pending_approval", status: PENDING, version: 1 };
    });
  }

  async withdraw(input) {
    if (!Number.isSafeInteger(input.approvalRequestId) || input.approvalRequestId < 1) {
      throw customerApprovalInvalid("APPROVAL_REQUEST_ID_INVALID", "審批申請編號不正確", { field: "requestId" });
    }
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const [[probe]] = await connection.query("SELECT customer_id FROM customer_activation_requests WHERE id = ?", [input.approvalRequestId]);
      if (!probe || Number(probe.customer_id) !== Number(input.customerId)) throw customerNotFound(input.customerId);
      const [[customer]] = await connection.query("SELECT * FROM customers WHERE id = ? FOR UPDATE", [input.customerId]);
      if (!customer) throw customerNotFound(input.customerId);
      const [[request]] = await connection.query("SELECT * FROM customer_activation_requests WHERE id = ? FOR UPDATE", [input.approvalRequestId]);
      if (!request) throw customerApprovalRequestNotFound(input.approvalRequestId);
      if (!sameUser(request.requested_by, input.actorId)) {
        throw customerApprovalConflict("APPROVAL_NOT_REQUESTER", "只有提交人可以撤回審批申請");
      }
      if (request.status === "withdrawn") {
        return { id: Number(request.id), customerId: Number(customer.id), customerStatus: customer.status, status: request.status, version: Number(request.version) };
      }
      if (request.status !== PENDING || customer.status !== "pending_approval") {
        throw customerApprovalConflict("APPROVAL_REQUEST_NOT_OPEN", "這個審批申請已經結案", { status: request.status });
      }
      if (Number(request.version) !== Number(input.version)) throw versionConflict(request.version);
      const nowMs = this.time.nowMs();
      const [updatedRequest] = await connection.execute(
        "UPDATE customer_activation_requests SET status = 'withdrawn', decided_at = ?, decided_by = ?, version = version + 1 WHERE id = ? AND status = 'pending' AND version = ?",
        [nowMs, input.actorId, request.id, input.version]
      );
      if (updatedRequest.affectedRows !== 1) throw versionConflict(request.version);
      const [updatedCustomer] = await connection.execute(
        "UPDATE customers SET status = 'draft', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?",
        [nowMs, input.actorId, customer.id, customer.version]
      );
      if (updatedCustomer.affectedRows !== 1) throw versionConflict(customer.version);
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: input.actorId, actorUsername: actor.username, action: "approval.withdraw",
        targetType: "approval", targetId: Number(request.id), customerId: Number(customer.id), targetLabel: customer.customer_code,
        detail: { before: { status: PENDING }, after: { status: "withdrawn" } }, requestId: input.requestId, ip: input.ip
      });
      return { id: Number(request.id), customerId: Number(customer.id), customerStatus: "draft", status: "withdrawn", version: Number(request.version) + 1 };
    });
  }

  async invalidateForCriticalChange(connection, { customer, actorId, actorUsername, reason = "關鍵資料變更", requestId = "", ip = "" }) {
    if (customer.status !== "pending_approval") return false;
    const [[request]] = await connection.query(
      "SELECT * FROM customer_activation_requests WHERE customer_id = ? AND status = 'pending' FOR UPDATE",
      [customer.id]
    );
    if (!request) return false;
    const nowMs = this.time.nowMs();
    await connection.execute(
      "UPDATE customer_activation_requests SET status = 'invalidated', decided_at = ?, decided_by = ?, decision_reason = ?, version = version + 1 WHERE id = ? AND status = 'pending'",
      [nowMs, actorId, String(reason).trim().slice(0, 500), request.id]
    );
    await connection.execute(
      "UPDATE customers SET status = 'draft', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'pending_approval'",
      [nowMs, actorId, customer.id]
    );
    await this.audit.record(connection, {
      occurredAt: nowMs, actorUserId: actorId, actorUsername, action: "approval.invalidate", targetType: "approval",
      targetId: Number(request.id), customerId: Number(customer.id), targetLabel: customer.customer_code,
      reason: String(reason).trim().slice(0, 500), detail: { before: { status: PENDING }, after: { status: "invalidated" } }, requestId, ip
    });
    return true;
  }

  async #eligibleApprover(connection, approverUserId, requesterId) {
    if (!Number.isSafeInteger(approverUserId) || approverUserId < 1) {
      throw customerApprovalInvalid("APPROVER_REQUIRED", "必須指定審批人", { field: "approverUserId" });
    }
    if (sameUser(approverUserId, requesterId)) {
      throw customerApprovalInvalid("APPROVER_MUST_DIFFER", "審批人不可以是提交人", { field: "approverUserId" });
    }
    const [[approver]] = await connection.query("SELECT id, username FROM users WHERE id = ? AND status = 'active'", [approverUserId]);
    if (!approver || !(await this.loadPermissions(connection, approverUserId)).includes("customer.approval")) {
      throw customerApprovalInvalid("APPROVER_NOT_ELIGIBLE", "指定的審批人不是有效審批人", { field: "approverUserId" });
    }
    return { id: Number(approver.id), username: approver.username };
  }
}

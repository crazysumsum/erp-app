import { createHash } from "node:crypto";

import { assertActorFresh, loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerOperationService } from "./CustomerOperationService.js";
import {
  customerApprovalConflict,
  customerApprovalInvalid,
  customerApprovalRequestNotFound,
  customerNotFound,
  versionConflict
} from "./customerErrors.js";

const PENDING = "pending";
export const CUSTOMER_APPROVAL_REQUEST_STATUSES = Object.freeze(["pending", "approved", "rejected", "withdrawn", "invalidated"]);
export const CUSTOMER_APPROVAL_QUEUE_SCOPES = Object.freeze(["mine", "all", "unassigned"]);

function approvalUser(id, username, displayName) {
  return id === null || id === undefined ? null : { id: Number(id), username: String(username ?? ""), displayName: String(displayName ?? "") };
}

function approvalSummary(row) {
  return {
    id: Number(row.id), customerId: Number(row.customer_id), customerCode: String(row.customer_code), legalName: String(row.legal_name),
    customerStatus: String(row.customer_status), status: String(row.status),
    requester: approvalUser(row.requested_by, row.requester_username, row.requester_display_name),
    assignedApprover: approvalUser(row.assigned_approver_id, row.approver_username, row.approver_display_name),
    requestNote: String(row.request_note ?? ""), requestedAt: Number(row.requested_at),
    decidedAt: row.decided_at === null ? null : Number(row.decided_at), version: Number(row.version)
  };
}

function parsedSummary(value) {
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value ?? "{}")); } catch { return {}; }
}

function sameHash(left, right) {
  const leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(left ?? []);
  const rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(right ?? []);
  return leftBuffer.equals(rightBuffer);
}

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
  constructor({ database, time, authorize = assertActorFresh, loadPermissions = loadPermissionNamesForUser, audit = new CustomerAuditLogService(), businessMaster, operations = new CustomerOperationService() } = {}) {
    if (!database || !time) throw new TypeError("CustomerApprovalService requires database and time");
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.loadPermissions = loadPermissions;
    this.audit = audit;
    this.businessMaster = businessMaster ?? new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
    this.operations = operations;
  }

  async submit(input) {
    return this.database.withTransaction(async (connection) => {
      return this.submitInTransaction(connection, input);
    });
  }

  async submitInTransaction(connection, input, { actor: suppliedActor, setting: suppliedSetting, customer: suppliedCustomer } = {}) {
    const requestNote = note(input.requestNote);
    const actor = suppliedActor ?? await this.authorize(connection, input);
    const setting = suppliedSetting ?? (await connection.query("SELECT require_activation_approval, version FROM customer_settings WHERE id = 1 FOR SHARE"))[0][0];
    if (!setting || Number(setting.require_activation_approval) !== 1) {
      throw customerApprovalConflict("APPROVAL_REQUIRED", "目前設定不需要啟用審批");
    }
    const customer = suppliedCustomer ?? (await connection.query("SELECT * FROM customers WHERE id = ? FOR UPDATE", [input.customerId]))[0][0];
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

  async listRequests({ actorId, claimedRoles, claimedPermissions, scope = "mine", status = PENDING, requesterId, requestedFrom, requestedTo, page = 1, pageSize = 20 } = {}) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    if (!CUSTOMER_APPROVAL_QUEUE_SCOPES.includes(scope) || !CUSTOMER_APPROVAL_REQUEST_STATUSES.includes(status)) {
      throw customerApprovalInvalid("APPROVAL_QUEUE_FILTER_INVALID", "審批佇列篩選條件不正確");
    }
    const conditions = ["r.status = ?"];
    const params = [status];
    if (scope === "mine") { conditions.push("r.assigned_approver_id = ?"); params.push(actorId); }
    if (scope === "unassigned") conditions.push("r.assigned_approver_id IS NULL");
    if (requesterId !== undefined) { conditions.push("r.requested_by = ?"); params.push(requesterId); }
    if (requestedFrom !== undefined) { conditions.push("r.requested_at >= ?"); params.push(requestedFrom); }
    if (requestedTo !== undefined) { conditions.push("r.requested_at <= ?"); params.push(requestedTo); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const [count] = await this.database.query(`SELECT COUNT(*) AS total FROM customer_activation_requests r ${where}`, params);
    const [rows] = await this.database.query(
      `SELECT r.*, c.customer_code, c.legal_name, c.status AS customer_status,
              requester.username AS requester_username, requester.display_name AS requester_display_name,
              approver.username AS approver_username, approver.display_name AS approver_display_name
         FROM customer_activation_requests r JOIN customers c ON c.id = r.customer_id
         LEFT JOIN users requester ON requester.id = r.requested_by LEFT JOIN users approver ON approver.id = r.assigned_approver_id
         ${where} ORDER BY r.requested_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...params, safePageSize, (safePage - 1) * safePageSize]
    );
    return { items: rows.map(approvalSummary), total: Number(count[0]?.total ?? 0), page: safePage, pageSize: safePageSize };
  }

  async getRequest({ actorId, claimedRoles, claimedPermissions, id } = {}) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[row]] = await this.database.query(
      `SELECT r.*, c.customer_code, c.legal_name, c.default_currency_code, c.status AS customer_status, c.version AS current_customer_version,
              requester.username AS requester_username, requester.display_name AS requester_display_name,
              approver.username AS approver_username, approver.display_name AS approver_display_name,
              decider.username AS decider_username, decider.display_name AS decider_display_name
         FROM customer_activation_requests r JOIN customers c ON c.id = r.customer_id
         LEFT JOIN users requester ON requester.id = r.requested_by LEFT JOIN users approver ON approver.id = r.assigned_approver_id
         LEFT JOIN users decider ON decider.id = r.decided_by WHERE r.id = ?`, [id]
    );
    if (!row) throw customerApprovalRequestNotFound(id);
    const submitted = parsedSummary(row.summary);
    const [[identifierCount]] = await this.database.query("SELECT COUNT(*) AS total FROM customer_identifiers WHERE customer_id = ? AND status = 'active'", [row.customer_id]);
    const [[credit]] = await this.database.query("SELECT credit_status FROM customer_credit_profiles WHERE customer_id = ?", [row.customer_id]);
    const current = {
      customerCode: String(row.customer_code), legalName: String(row.legal_name),
      defaultCurrencyCode: row.default_currency_code === null ? null : String(row.default_currency_code),
      identifierCount: Number(identifierCount?.total ?? 0), creditStatus: String(credit?.credit_status ?? "not_configured")
    };
    const changedFields = Object.keys(current).filter((field) => submitted[field] !== undefined && submitted[field] !== current[field]);
    return {
      ...approvalSummary(row), decidedBy: approvalUser(row.decided_by, row.decider_username, row.decider_display_name),
      decisionReason: String(row.decision_reason ?? ""), customerVersion: Number(row.customer_version),
      currentCustomerVersion: Number(row.current_customer_version), stale: Number(row.customer_version) !== Number(row.current_customer_version),
      submitted, current, changedFields
    };
  }

  async listEligibleApprovers({ actorId, claimedRoles, claimedPermissions, q = "", excludeUserId } = {}) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const conditions = ["u.status = 'active'", "p.name = 'customer.approval'"];
    const params = [];
    if (excludeUserId !== undefined) { conditions.push("u.id <> ?"); params.push(excludeUserId); }
    const search = String(q).normalize("NFKC").trim();
    if (search) { conditions.push("(u.username LIKE ? ESCAPE '!' OR u.display_name LIKE ? ESCAPE '!')"); const term = `%${search.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`; params.push(term, term); }
    const [rows] = await this.database.query(
      `SELECT DISTINCT u.id, u.username, u.display_name FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
       WHERE ${conditions.join(" AND ")} ORDER BY u.display_name, u.username, u.id LIMIT 100`, params
    );
    return { items: rows.map((row) => approvalUser(row.id, row.username, row.display_name)) };
  }

  approve(input) { return this.#decide(input, { status: "approved", customerStatus: "active", action: "approval.approve", routeKey: "customer.approval.approve", requiresReason: false }); }
  reject(input) { return this.#decide(input, { status: "rejected", customerStatus: "draft", action: "approval.reject", routeKey: "customer.approval.reject", requiresReason: true }); }

  async #decide(input, command) {
    const decisionReason = command.requiresReason ? this.#reason(input.reason) : String(input.reason ?? "").trim();
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const nowMs = this.time.nowMs();
      const started = await this.operations.begin(connection, {
        actorId: input.actorId, routeKey: command.routeKey, idempotencyKey: input.idempotencyKey,
        payload: { id: Number(input.id), version: Number(input.version), reason: decisionReason }, nowMs
      });
      if (started.replay) return this.#replayedDecision(connection, started.replay, input.id);
      const [[probe]] = await connection.query("SELECT customer_id FROM customer_activation_requests WHERE id = ?", [input.id]);
      if (!probe) throw customerApprovalRequestNotFound(input.id);
      const [[customer]] = await connection.query("SELECT * FROM customers WHERE id = ? FOR UPDATE", [probe.customer_id]);
      if (!customer) throw customerNotFound(probe.customer_id);
      const [[request]] = await connection.query("SELECT * FROM customer_activation_requests WHERE id = ? FOR UPDATE", [input.id]);
      if (!request) throw customerApprovalRequestNotFound(input.id);
      this.#assertAssignedApprover(request, actor, input.actorId);
      if (request.status === command.status) {
        await this.operations.succeed(connection, { operationId: started.operationId, resourceType: "customer_activation_request_decision", resourceId: Number(request.id), resultVersion: Number(request.version), nowMs });
        return { id: Number(request.id), customerId: Number(customer.id), customerStatus: customer.status, status: request.status, version: Number(request.version), replayed: true };
      }
      if (request.status !== PENDING || customer.status !== "pending_approval") throw customerApprovalConflict("APPROVAL_REQUEST_NOT_OPEN", "這個審批申請已經結案", { status: request.status });
      if (Number(request.version) !== Number(input.version)) throw versionConflict(request.version);
      if (command.status === "approved") {
        await this.#assertRequestCriticalHash(connection, request, customer);
        await this.#assertActivatable(connection, customer);
      }
      const [requestUpdated] = await connection.execute("UPDATE customer_activation_requests SET status = ?, decision_reason = ?, decided_at = ?, decided_by = ?, version = version + 1 WHERE id = ? AND status = 'pending' AND version = ?", [command.status, decisionReason, nowMs, input.actorId, request.id, input.version]);
      if (requestUpdated.affectedRows !== 1) throw versionConflict(request.version);
      const [customerUpdated] = await connection.execute("UPDATE customers SET status = ?, ever_activated_at = CASE WHEN ? = 'active' THEN COALESCE(ever_activated_at, ?) ELSE ever_activated_at END, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?", [command.customerStatus, command.customerStatus, nowMs, nowMs, input.actorId, customer.id, customer.version]);
      if (customerUpdated.affectedRows !== 1) throw versionConflict(customer.version);
      await this.audit.record(connection, { occurredAt: nowMs, actorUserId: input.actorId, actorUsername: actor.username, action: command.action, targetType: "approval", targetId: Number(request.id), customerId: Number(customer.id), targetLabel: customer.customer_code, reason: decisionReason, detail: { before: { status: request.status }, after: { status: command.status } }, requestId: input.requestId, ip: input.ip });
      await this.#recordCustomerStatusAudit(connection, { nowMs, actor, actorId: input.actorId, customer, status: command.customerStatus, requestId: input.requestId, ip: input.ip, reason: decisionReason });
      await this.operations.succeed(connection, { operationId: started.operationId, resourceType: "customer_activation_request_decision", resourceId: Number(request.id), resultVersion: Number(request.version) + 1, nowMs });
      return { id: Number(request.id), customerId: Number(customer.id), customerStatus: command.customerStatus, status: command.status, version: Number(request.version) + 1, replayed: false };
    });
  }

  async reassign(input) {
    const reason = this.#reason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      if (!actor.permissions?.includes("customer.approval")) throw customerApprovalConflict("APPROVAL_PERMISSION_LOST", "你目前沒有審批權限");
      const nowMs = this.time.nowMs();
      const started = await this.operations.begin(connection, {
        actorId: input.actorId, routeKey: "customer.approval.reassign", idempotencyKey: input.idempotencyKey,
        payload: { id: Number(input.id), version: Number(input.version), approverUserId: Number(input.approverUserId), reason }, nowMs
      });
      if (started.replay) return this.#replayedReassign(started.replay, input.id);
      const [[probe]] = await connection.query("SELECT customer_id FROM customer_activation_requests WHERE id = ?", [input.id]);
      if (!probe) throw customerApprovalRequestNotFound(input.id);
      const [[customer]] = await connection.query("SELECT * FROM customers WHERE id = ? FOR UPDATE", [probe.customer_id]);
      if (!customer) throw customerNotFound(probe.customer_id);
      const [[request]] = await connection.query("SELECT * FROM customer_activation_requests WHERE id = ? FOR UPDATE", [input.id]);
      if (!request) throw customerApprovalRequestNotFound(input.id);
      if (request.status !== PENDING || customer.status !== "pending_approval") throw customerApprovalConflict("APPROVAL_REQUEST_NOT_OPEN", "這個審批申請已經結案", { status: request.status });
      if (Number(request.version) !== Number(input.version)) throw versionConflict(request.version);
      const approver = await this.#eligibleApprover(connection, input.approverUserId, request.requested_by);
      if (sameUser(approver.id, request.assigned_approver_id)) {
        await this.operations.succeed(connection, { operationId: started.operationId, resourceType: "customer_activation_request_assignment", resourceId: approver.id, resultVersion: Number(request.version), nowMs });
        return { id: Number(request.id), assignedApproverId: approver.id, version: Number(request.version), replayed: true };
      }
      const [updated] = await connection.execute("UPDATE customer_activation_requests SET assigned_approver_id = ?, version = version + 1 WHERE id = ? AND status = 'pending' AND version = ?", [approver.id, request.id, input.version]);
      if (updated.affectedRows !== 1) throw versionConflict(request.version);
      await this.audit.record(connection, { occurredAt: nowMs, actorUserId: input.actorId, actorUsername: actor.username, action: "approval.reassign", targetType: "approval", targetId: Number(request.id), customerId: Number(customer.id), targetLabel: customer.customer_code, reason, detail: { before: { assignedApproverId: Number(request.assigned_approver_id) }, after: { assignedApproverId: approver.id } }, requestId: input.requestId, ip: input.ip });
      await this.operations.succeed(connection, { operationId: started.operationId, resourceType: "customer_activation_request_assignment", resourceId: approver.id, resultVersion: Number(request.version) + 1, nowMs });
      return { id: Number(request.id), assignedApproverId: approver.id, version: Number(request.version) + 1, replayed: false };
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

  #assertAssignedApprover(request, actor, actorId) {
    if (!sameUser(request.assigned_approver_id, actorId)) throw customerApprovalConflict("APPROVAL_NOT_ASSIGNED", "只有被指定的審批人可以處理這個申請");
    if (sameUser(request.requested_by, actorId)) throw customerApprovalConflict("APPROVER_MUST_DIFFER", "審批人不可以是提交人");
    if (!actor.permissions?.includes("customer.approval")) throw customerApprovalConflict("APPROVAL_PERMISSION_LOST", "你目前沒有審批權限");
  }

  async #assertRequestCriticalHash(connection, request, customer) {
    const [identifiers] = await connection.query(
      "SELECT identifier_type, issuer_country_code, identifier_value_key FROM customer_identifiers WHERE customer_id = ? AND status = 'active' ORDER BY identifier_type, issuer_country_code, identifier_value_key FOR UPDATE",
      [customer.id]
    );
    const [[credit]] = await connection.query("SELECT credit_status FROM customer_credit_profiles WHERE customer_id = ? FOR UPDATE", [customer.id]);
    if (!sameHash(request.critical_snapshot_hash, hash(snapshot(customer, identifiers, credit)))) {
      throw customerApprovalConflict("APPROVAL_REQUEST_STALE", "客戶關鍵資料在提交後已變更，請重新提交審批");
    }
  }

  async #recordCustomerStatusAudit(connection, { nowMs, actor, actorId, customer, status, requestId, ip, reason }) {
    await this.audit.record(connection, {
      occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username,
      action: status === "active" ? "customer.activate" : "customer.status", targetType: "customer",
      targetId: Number(customer.id), customerId: Number(customer.id), targetLabel: customer.customer_code, reason,
      detail: { before: { status: customer.status, everActivatedAt: customer.ever_activated_at, version: Number(customer.version) }, after: { status, everActivatedAt: status === "active" ? nowMs : customer.ever_activated_at, version: Number(customer.version) + 1 } },
      requestId, ip
    });
  }

  async #replayedDecision(connection, operation, requestId) {
    if (operation.status !== "succeeded" || operation.resourceType !== "customer_activation_request_decision" || !operation.resourceId) {
      throw customerApprovalConflict("CUSTOMER_OPERATION_PENDING", "客戶操作尚未完成，請以原 Idempotency-Key 或操作狀態查詢確認結果");
    }
    if (Number(operation.resourceId) !== Number(requestId)) throw customerApprovalConflict("CUSTOMER_OPERATION_UNKNOWN", "客戶操作結果無法確認");
    const [[request]] = await connection.query("SELECT customer_id, status, version FROM customer_activation_requests WHERE id = ?", [requestId]);
    if (!request) throw customerApprovalConflict("CUSTOMER_OPERATION_UNKNOWN", "客戶操作結果無法確認");
    const [[customer]] = await connection.query("SELECT id FROM customers WHERE id = ?", [request.customer_id]);
    if (!customer) throw customerApprovalConflict("CUSTOMER_OPERATION_UNKNOWN", "客戶操作結果無法確認");
    const customerStatus = request.status === "approved" ? "active" : request.status === "rejected" ? "draft" : null;
    if (!customerStatus) throw customerApprovalConflict("CUSTOMER_OPERATION_UNKNOWN", "客戶操作結果無法確認");
    return { id: Number(requestId), customerId: Number(customer.id), customerStatus, status: request.status, version: Number(request.version), replayed: true };
  }

  #replayedReassign(operation, requestId) {
    if (operation.status !== "succeeded" || operation.resourceType !== "customer_activation_request_assignment" || !operation.resourceId || operation.resultVersion === null) {
      throw customerApprovalConflict("CUSTOMER_OPERATION_PENDING", "客戶操作尚未完成，請以原 Idempotency-Key 或操作狀態查詢確認結果");
    }
    return { id: Number(requestId), assignedApproverId: Number(operation.resourceId), version: Number(operation.resultVersion), replayed: true };
  }

  async #assertActivatable(connection, customer) {
    if (!String(customer.customer_code ?? "").trim() || !String(customer.legal_name ?? "").trim() || !customer.default_currency_code) {
      throw customerApprovalConflict("CUSTOMER_ACTIVATION_INCOMPLETE", "啟用客戶需要客戶代碼、法定名稱及有效預設幣別");
    }
    await this.businessMaster.assertCurrencyUsableInTransaction(connection, { code: customer.default_currency_code, purpose: "new_assignment" });
  }

  #reason(value) {
    const result = String(value ?? "").trim();
    if (result.length < 5 || result.length > 500 || /[\p{Cc}]/u.test(result)) throw customerApprovalInvalid("APPROVAL_REASON_REQUIRED", "這項操作必須填寫原因", { field: "reason" });
    return result;
  }
}

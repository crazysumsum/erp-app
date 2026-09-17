import { assertActorFresh, loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierConflict, supplierNotFound } from "./supplierErrors.js";

/**
 * 啟用審批 domain。設計說明見 docs/supplier_management/03_design_spec.md §4.4、§4.5。
 *
 * 呢個 service 唔擁有 HTTP 層（T29 先做）。佢分兩組操作：
 *   - `openRequest` 同 `invalidateOpenRequest` 由 SupplierAdminService 喺佢自己嘅
 *     交易入面叫，因為提交同失效必須同 Supplier 狀態改動 atomically 一齊發生。
 *   - approve／reject／withdraw／reassign 各自擁有一個交易。
 *
 * 鎖序跟設計 §2.6：settings → suppliers → requests → child → audit。
 */

// 設計 §4.5：呢啲欄位一改，原申請就唔可以再批。Address／Contact／Notes／Bank
// 唔喺內，因為佢哋唔係最低啟用條件，而且 Bank 有獨立權限。
export const APPROVAL_SIGNIFICANT_COLUMNS = Object.freeze([
  "supplier_code",
  "supplier_name",
  "display_name",
  "default_currency_code",
  "default_payment_term_id"
]);

const OPEN_STATUS = "pending";

const DECISIONS = Object.freeze({
  approve: { status: "approved", supplierStatus: "active", action: "approval.approve", requiresReason: false },
  reject: { status: "rejected", supplierStatus: "draft", action: "approval.reject", requiresReason: true },
  withdraw: { status: "withdrawn", supplierStatus: "draft", action: "approval.withdraw", requiresReason: true }
});

function requireReason(value, message = "這項操作必須填寫原因") {
  const reason = String(value ?? "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw invalidSupplierInput("SUPPLIER_REASON_REQUIRED", message, { field: "reason" });
  }
  return reason;
}

/**
 * 設計 §4.5：summary 只包含最低啟用資料同遮罩後嘅 identifier，**唔包含**完整銀行
 * 帳號。呢度用白名單而唔係黑名單：新欄位預設唔會入 snapshot，要明確加先有。
 */
export function buildApprovalSummary(supplierRow, identifierRows = []) {
  return {
    supplierCode: String(supplierRow.supplier_code ?? ""),
    supplierName: String(supplierRow.supplier_name ?? ""),
    displayName: String(supplierRow.display_name ?? ""),
    defaultCurrencyCode: String(supplierRow.default_currency_code ?? ""),
    defaultPaymentTermId: supplierRow.default_payment_term_id === null || supplierRow.default_payment_term_id === undefined
      ? null
      : Number(supplierRow.default_payment_term_id),
    identifiers: identifierRows.map((row) => ({
      identifierType: String(row.identifier_type ?? ""),
      issuerCountryCode: String(row.issuer_country_code ?? ""),
      // 遮罩：審批人要知有冇同係邊類，唔需要完整號碼。
      identifierValueMasked: maskIdentifier(String(row.identifier_value ?? ""))
    }))
  };
}

function maskIdentifier(value) {
  const characters = Array.from(value);
  if (characters.length <= 4) return "*".repeat(characters.length);
  return `${"*".repeat(characters.length - 4)}${characters.slice(-4).join("")}`;
}

export class SupplierApprovalService {
  constructor({ database, logger, time, authorize = assertActorFresh, audit, loadPermissions = loadPermissionNamesForUser } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("SupplierApprovalService requires database, logger and time");
    }
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.authorize = authorize;
    this.loadPermissions = loadPermissions;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
  }

  /**
   * BR-012／AC-008／AC-009：審批人必須係另一位 active 使用者，而且**而家**仍然有
   * supplier.approval。提交時 claim 咗乜唔算數 —— 呢度讀返資料庫。
   */
  async assertEligibleApprover(connection, { approverUserId, requesterId }) {
    if (approverUserId === undefined || approverUserId === null) {
      throw invalidSupplierInput("APPROVER_REQUIRED", "目前設定需要指定審批人", { field: "approverUserId" });
    }
    if (Number(approverUserId) === Number(requesterId)) {
      throw invalidSupplierInput("APPROVER_MUST_DIFFER", "審批人不可以是提交人", { field: "approverUserId" });
    }
    const [[approver]] = await connection.query(
      "SELECT id, username FROM users WHERE id = ? AND status = 'active'",
      [approverUserId]
    );
    if (!approver) {
      throw invalidSupplierInput("APPROVER_NOT_ELIGIBLE", "指定的審批人不是有效使用者", { field: "approverUserId" });
    }
    const permissions = await this.loadPermissions(connection, approverUserId);
    if (!permissions.includes("supplier.approval")) {
      throw invalidSupplierInput("APPROVER_NOT_ELIGIBLE", "指定的審批人沒有審批權限", { field: "approverUserId" });
    }
    return { id: Number(approver.id), username: approver.username };
  }

  /**
   * 由 SupplierAdminService 喺提交嗰個交易入面叫。Supplier 狀態改動由 caller 做，
   * 因為佢已經揸住個 row lock；呢度只負責 request 同佢嘅 audit。
   */
  async openRequest(connection, input) {
    const approver = await this.assertEligibleApprover(connection, {
      approverUserId: input.approverUserId,
      requesterId: input.actorId
    });
    const nowMs = this.time.nowMs();
    const [result] = await connection.execute(
      `INSERT INTO supplier_activation_requests
        (supplier_id, requested_by, assigned_approver_id, supplier_version, summary, status, request_note, requested_at)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
      [input.supplierId, input.actorId, approver.id, input.supplierVersion,
       JSON.stringify(input.summary), OPEN_STATUS, String(input.requestNote ?? ""), nowMs]
    );
    await this.audit.record(connection, {
      actorUserId: input.actorId,
      actorUsername: input.actorUsername,
      action: "approval.submit",
      targetType: "approval",
      targetId: result.insertId,
      supplierId: input.supplierId,
      targetLabel: input.summary.supplierCode,
      reason: String(input.requestNote ?? ""),
      detail: { after: { assignedApproverId: approver.id, supplierVersion: input.supplierVersion } },
      requestId: input.requestId,
      ip: input.ip
    });
    return { id: Number(result.insertId), assignedApproverId: approver.id, status: OPEN_STATUS };
  }

  /**
   * 設計 §4.5：Pending 期間改動任何 approval-significant 欄位，原申請即時失效，
   * Supplier 回 draft。由 SupplierAdminService 喺同一個交易入面叫。
   */
  async invalidateOpenRequest(connection, input) {
    const [[open]] = await connection.query(
      "SELECT id, supplier_id FROM supplier_activation_requests WHERE supplier_id = ? AND status = ? FOR UPDATE",
      [input.supplierId, OPEN_STATUS]
    );
    if (!open) return null;
    await connection.execute(
      "UPDATE supplier_activation_requests SET status = 'invalidated', decided_at = ?, decision_reason = ?, version = version + 1 WHERE id = ? AND status = ?",
      [this.time.nowMs(), String(input.reason ?? "關鍵資料變更"), open.id, OPEN_STATUS]
    );
    await this.audit.record(connection, {
      actorUserId: input.actorId,
      actorUsername: input.actorUsername,
      action: "approval.invalidate",
      targetType: "approval",
      targetId: Number(open.id),
      supplierId: input.supplierId,
      targetLabel: String(input.supplierCode ?? ""),
      reason: String(input.reason ?? "關鍵資料變更"),
      detail: { before: { status: OPEN_STATUS }, after: { status: "invalidated" }, changes: input.changedFields ?? [] },
      requestId: input.requestId,
      ip: input.ip
    });
    return { id: Number(open.id), status: "invalidated" };
  }

  approveRequest(input) { return this.#decide(input, "approve"); }
  rejectRequest(input) { return this.#decide(input, "reject"); }
  withdrawRequest(input) { return this.#decide(input, "withdraw"); }

  async #decide(input, commandName) {
    const command = DECISIONS[commandName];
    if (!command) throw new TypeError(`Unknown supplier approval command: ${commandName}`);
    const reason = command.requiresReason ? requireReason(input.reason) : String(input.reason ?? "").trim();

    let outcome = null;
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      // 鎖序：supplier 先，然後 request。
      const [[request]] = await connection.query(
        "SELECT * FROM supplier_activation_requests WHERE id = ? FOR UPDATE",
        [input.id]
      );
      if (!request) throw supplierNotFound(input.id);
      const [[supplier]] = await connection.query(
        "SELECT * FROM suppliers WHERE id = ? FOR UPDATE",
        [request.supplier_id]
      );
      if (!supplier) throw supplierNotFound(request.supplier_id);

      // FR-APPROVAL-007：重送一個已經去到相同終態嘅決定，回現況，唔再 transition
      // 亦唔再寫 audit。相反或過時嘅轉換仍然係 conflict。
      if (request.status === command.status) {
        outcome = this.#project(request, supplier, { replayed: true });
        return;
      }
      if (request.status !== OPEN_STATUS) {
        throw supplierConflict("APPROVAL_REQUEST_NOT_OPEN", "這個審批申請已經結案", { status: request.status });
      }
      if (Number(request.version) !== Number(input.version)) {
        throw supplierConflict("VERSION_CONFLICT", "審批申請已被其他人修改，請重新載入");
      }
      this.#assertActorMayDecide(command, { request, actor, actorId: input.actorId });
      await this.#assertRequestStillCurrent(connection, { request, supplier, command });

      const nowMs = this.time.nowMs();
      const [updated] = await connection.execute(
        `UPDATE supplier_activation_requests
            SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ?, version = version + 1
          WHERE id = ? AND status = ? AND version = ?`,
        [command.status, nowMs, input.actorId, reason, request.id, OPEN_STATUS, input.version]
      );
      if (updated.affectedRows === 0) {
        throw supplierConflict("VERSION_CONFLICT", "審批申請已被其他人修改，請重新載入");
      }
      const [supplierUpdated] = await connection.execute(
        "UPDATE suppliers SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?",
        [command.supplierStatus, nowMs, input.actorId, supplier.id, supplier.version]
      );
      if (supplierUpdated.affectedRows === 0) {
        throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
      }
      await this.audit.record(connection, {
        actorUserId: input.actorId,
        actorUsername: actor.username,
        action: command.action,
        targetType: "approval",
        targetId: Number(request.id),
        supplierId: Number(supplier.id),
        targetLabel: supplier.supplier_code,
        reason,
        detail: {
          before: { requestStatus: request.status, supplierStatus: supplier.status },
          after: { requestStatus: command.status, supplierStatus: command.supplierStatus }
        },
        requestId: input.requestId,
        ip: input.ip
      });
      outcome = {
        id: Number(request.id),
        status: command.status,
        supplierId: Number(supplier.id),
        supplierStatus: command.supplierStatus,
        version: Number(input.version) + 1,
        replayed: false
      };
    });
    return outcome;
  }

  #assertActorMayDecide(command, { request, actor, actorId }) {
    if (command.status === "withdrawn") {
      // FR-APPROVAL-005：只有提交人可以撤回。
      if (Number(request.requested_by) !== Number(actorId)) {
        throw supplierConflict("APPROVAL_NOT_REQUESTER", "只有提交人可以撤回申請");
      }
      return;
    }
    if (Number(request.assigned_approver_id) !== Number(actorId)) {
      throw supplierConflict("APPROVAL_NOT_ASSIGNED", "只有被指定的審批人可以處理這個申請");
    }
    if (Number(request.requested_by) === Number(actorId)) {
      throw supplierConflict("APPROVER_MUST_DIFFER", "審批人不可以是提交人");
    }
    // 設計 §4.5：actor 而家仍然要有權限，唔係提交嗰陣有就算。
    if (!actor.permissions?.includes("supplier.approval")) {
      throw supplierConflict("APPROVAL_PERMISSION_LOST", "你目前沒有審批權限");
    }
  }

  async #assertRequestStillCurrent(connection, { request, supplier, command }) {
    if (command.status !== "approved") return;
    // AC-012：Supplier 喺提交之後改過就唔可以批舊申請。
    if (Number(supplier.version) !== Number(request.supplier_version)) {
      throw supplierConflict("APPROVAL_REQUEST_STALE", "供應商資料在提交後已變更，請重新提交審批", {
        submittedVersion: Number(request.supplier_version),
        currentVersion: Number(supplier.version)
      });
    }
    if (supplier.status !== "pending_approval") {
      throw supplierConflict("STATUS_TRANSITION_INVALID", "目前供應商狀態不允許這項操作", {
        from: supplier.status, to: command.supplierStatus
      });
    }
  }

  /**
   * FR-APPROVAL-005／AC：重新指派唔係一個決定，佢唔改 Supplier 狀態。
   */
  async reassignRequest(input) {
    const reason = requireReason(input.reason, "重新指派必須填寫原因");
    let outcome = null;
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      const [[request]] = await connection.query(
        "SELECT * FROM supplier_activation_requests WHERE id = ? FOR UPDATE",
        [input.id]
      );
      if (!request) throw supplierNotFound(input.id);
      if (request.status !== OPEN_STATUS) {
        throw supplierConflict("APPROVAL_REQUEST_NOT_OPEN", "這個審批申請已經結案", { status: request.status });
      }
      if (Number(request.version) !== Number(input.version)) {
        throw supplierConflict("VERSION_CONFLICT", "審批申請已被其他人修改，請重新載入");
      }
      const approver = await this.assertEligibleApprover(connection, {
        approverUserId: input.approverUserId,
        requesterId: request.requested_by
      });
      if (Number(approver.id) === Number(request.assigned_approver_id)) {
        outcome = { id: Number(request.id), assignedApproverId: approver.id, version: Number(request.version), replayed: true };
        return;
      }
      const [updated] = await connection.execute(
        "UPDATE supplier_activation_requests SET assigned_approver_id = ?, version = version + 1 WHERE id = ? AND status = ? AND version = ?",
        [approver.id, request.id, OPEN_STATUS, input.version]
      );
      if (updated.affectedRows === 0) {
        throw supplierConflict("VERSION_CONFLICT", "審批申請已被其他人修改，請重新載入");
      }
      await this.audit.record(connection, {
        actorUserId: input.actorId,
        actorUsername: actor.username,
        action: "approval.reassign",
        targetType: "approval",
        targetId: Number(request.id),
        supplierId: Number(request.supplier_id),
        targetLabel: "",
        reason,
        detail: {
          before: { assignedApproverId: Number(request.assigned_approver_id) },
          after: { assignedApproverId: approver.id }
        },
        requestId: input.requestId,
        ip: input.ip
      });
      outcome = { id: Number(request.id), assignedApproverId: approver.id, version: Number(input.version) + 1, replayed: false };
    });
    return outcome;
  }

  #project(request, supplier, { replayed }) {
    return {
      id: Number(request.id),
      status: request.status,
      supplierId: Number(supplier.id),
      supplierStatus: supplier.status,
      version: Number(request.version),
      replayed
    };
  }
}

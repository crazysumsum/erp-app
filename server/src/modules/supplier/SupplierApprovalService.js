import { assertActorFresh, loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierConflict, supplierNotActivatable, supplierNotFound } from "./supplierErrors.js";
import { supplierActivatabilityIssues } from "./supplierValidation.js";

/**
 * 啟用審批 domain。設計說明見 docs/supplier_management/03_design_spec.md §4.4、§4.5。
 *
 * 呢個 service 唔擁有 HTTP 層（T29 先做）。佢分兩組操作：
 *   - `openRequest`、`invalidateForSignificantChange` 同 `syncOpenRequestSupplierVersion`
 *     由 SupplierAdminService 同 SupplierIdentifierService 喺佢哋自己嘅交易入面叫，
 *     因為提交同失效必須同 Supplier 狀態改動 atomically 一齊發生。
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
  // FR-APPROVAL-005 只講建檔人可以喺決定前撤回，冇要求原因，所以唔喺度加一個
  // spec 冇要求嘅限制。撤回一樣會留低稽核。
  withdraw: { status: "withdrawn", supplierStatus: "draft", action: "approval.withdraw", requiresReason: false }
});

// Number(null) 係 0，所以直接 Number(a) === Number(b) 會將兩個 null 當成同一個人。
// requested_by 係 SET NULL 嘅 FK，所以呢個情況真係出得到。
function sameUser(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return Number(left) === Number(right);
}

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
// 一個 Supplier 冇上限咁多 identifier，而 summary 係 JSON NOT NULL 一次過寫入。
// 有界係設計 4.5 明文要求；呢度截頂並且講明截咗。
const MAX_SUMMARY_IDENTIFIERS = 50;

export function buildApprovalSummary(supplierRow, identifierRows = []) {
  const bounded = identifierRows.slice(0, MAX_SUMMARY_IDENTIFIERS);
  return {
    supplierCode: String(supplierRow.supplier_code ?? ""),
    supplierName: String(supplierRow.supplier_name ?? ""),
    displayName: String(supplierRow.display_name ?? ""),
    defaultCurrencyCode: String(supplierRow.default_currency_code ?? ""),
    defaultPaymentTermId: supplierRow.default_payment_term_id === null || supplierRow.default_payment_term_id === undefined
      ? null
      : Number(supplierRow.default_payment_term_id),
    identifierCount: identifierRows.length,
    identifiersTruncated: identifierRows.length > MAX_SUMMARY_IDENTIFIERS,
    identifiers: bounded.map((row) => ({
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
  constructor({ database, logger, time, authorize = assertActorFresh, audit, loadPermissions = loadPermissionNamesForUser, businessMaster } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("SupplierApprovalService requires database, logger and time");
    }
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.authorize = authorize;
    this.loadPermissions = loadPermissions;
    this.businessMaster = businessMaster;
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
    if (sameUser(approverUserId, requesterId)) {
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
    const reason = String(input.reason ?? "").trim() || "關鍵資料變更";
    await connection.execute(
      "UPDATE supplier_activation_requests SET status = 'invalidated', decided_at = ?, decision_reason = ?, version = version + 1 WHERE id = ? AND status = ?",
      [this.time.nowMs(), reason, open.id, OPEN_STATUS]
    );
    await this.audit.record(connection, {
      actorUserId: input.actorId,
      actorUsername: input.actorUsername,
      action: "approval.invalidate",
      targetType: "approval",
      targetId: Number(open.id),
      supplierId: input.supplierId,
      targetLabel: String(input.supplierCode ?? ""),
      reason,
      detail: { before: { status: OPEN_STATUS }, after: { status: "invalidated" }, changes: input.changedFields ?? [] },
      requestId: input.requestId,
      ip: input.ip
    });
    return { id: Number(open.id), status: "invalidated" };
  }

  /**
   * 設計 4.5 嘅完整規則：關鍵資料改動 -> 原申請失效 **而且** Supplier 回 draft，
   * 兩個寫入喺同一個交易入面。
   *
   * 呢個規則之前喺兩個 service 入面覆製咗三次，而且已經漂移咗：identifier 嗰份會
   * bump version／updated_at／updated_by，另外兩份唔會。H-A 就係第四份唔見咗。
   * 而家呢度係唯一擁有者，call site 只負責講邊啲欄位變咗。
   *
   * 由 caller 喺佢自己嘅交易入面叫，佢已經揸住 suppliers 嘅鎖。
   */
  async invalidateForSignificantChange(connection, input) {
    const invalidated = await this.invalidateOpenRequest(connection, input);
    if (!invalidated) return false;
    // version／updated_at／updated_by 一定要動：客戶端揸住 version N 要睇得出個
    // Supplier 喺佢腳下郁咗，而狀態改動要有 actor。
    await connection.execute(
      "UPDATE suppliers SET status = 'draft', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'pending_approval'",
      [this.time.nowMs(), input.actorId ?? null, input.supplierId]
    );
    return true;
  }

  /**
   * 設計 4.5：Address／Contact／Notes／Bank 嘅改動唔影響 activation approval。但
   * updateSupplier 一律會 bump suppliers.version，而 #assertRequestStillCurrent 係
   * 用 version 判斷有冇變過 —— 所以唔同步嘅話，改個電話都會令個申請**永遠**批唔到。
   * 由 caller 喺同一個交易入面叫，佢已經揸住 suppliers 嘅鎖。
   */
  async syncOpenRequestSupplierVersion(connection, { supplierId, supplierVersion }) {
    const [result] = await connection.execute(
      "UPDATE supplier_activation_requests SET supplier_version = ? WHERE supplier_id = ? AND status = ?",
      [supplierVersion, supplierId, OPEN_STATUS]
    );
    return result.affectedRows > 0;
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
      // 設計 2.6：settings -> suppliers -> requests -> child -> audit。呢度需要 request
      // 嘅 supplier_id 先鎖得到 Supplier，所以用一個唔上鎖嘅 probe 攞 id，然後先鎖
      // suppliers，再鎖 request。倒轉嚟做會同 updateSupplier（佢係 suppliers 先）
      // 喺同一對 row 上面砌成一個循環，實測會出 ER_LOCK_DEADLOCK。
      const [[probe]] = await connection.query(
        "SELECT supplier_id FROM supplier_activation_requests WHERE id = ?",
        [input.id]
      );
      if (!probe) throw supplierNotFound(input.id);
      const [[supplier]] = await connection.query(
        "SELECT * FROM suppliers WHERE id = ? FOR UPDATE",
        [probe.supplier_id]
      );
      if (!supplier) throw supplierNotFound(probe.supplier_id);
      const [[request]] = await connection.query(
        "SELECT * FROM supplier_activation_requests WHERE id = ? FOR UPDATE",
        [input.id]
      );
      if (!request) throw supplierNotFound(input.id);

      // FR-APPROVAL-007：重送一個已經去到相同終態嘅決定，回現況，唔再 transition
      // 亦唔再寫 audit。相反或過時嘅轉換仍然係 conflict。
      this.#assertActorMayDecide(command, { request, actor, actorId: input.actorId });
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
      if (!sameUser(request.requested_by, actorId)) {
        throw supplierConflict("APPROVAL_NOT_REQUESTER", "只有提交人可以撤回申請");
      }
      return;
    }
    if (!sameUser(request.assigned_approver_id, actorId)) {
      throw supplierConflict("APPROVAL_NOT_ASSIGNED", "只有被指定的審批人可以處理這個申請");
    }
    if (sameUser(request.requested_by, actorId)) {
      throw supplierConflict("APPROVER_MUST_DIFFER", "審批人不可以是提交人");
    }
    // 設計 §4.5：actor 而家仍然要有權限，唔係提交嗰陣有就算。
    if (!actor.permissions?.includes("supplier.approval")) {
      throw supplierConflict("APPROVAL_PERMISSION_LOST", "你目前沒有審批權限");
    }
  }

  async #assertRequestStillCurrent(connection, { request, supplier, command }) {
    // 呢個檢查對三個決定都要做。今日冇任何 LIFECYCLE_COMMANDS 容許由
    // pending_approval 出去，所以 reject／withdraw 理論上撞唔到；但個安全性唔應該
    // 淨係靠嗰個可達性論證 —— 將來加一條 allowedFrom: ["pending_approval"] 嘅指令，
    // 就會變成由 active 靜靜哋退回 draft。
    if (supplier.status !== "pending_approval") {
      throw supplierConflict("STATUS_TRANSITION_INVALID", "目前供應商狀態不允許這項操作", {
        from: supplier.status, to: command.supplierStatus
      });
    }
    if (command.status !== "approved") return;
    // 設計 4.5：批准時 Supplier 仍然要可以啟用。一個未改過嘅 Supplier，如果佢嘅預設
    // 幣別喺提交同批准之間被 Business Master 停用，唔可以就咁變 Active。
    if (!this.businessMaster) {
      // 設計 4.5 要求批准時重新確認 Supplier 仍然可以啟用。呢個依賴冇接上就唔可以
      // 靜靜哋跳過檢查 —— 咁樣一個忘記接線嘅 composition root 會令規則消失。
      throw new TypeError("SupplierApprovalService requires businessMaster to approve a request");
    }
    const defaults = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
      currencyCode: supplier.default_currency_code,
      paymentTermId: supplier.default_payment_term_id,
      purpose: "new_assignment"
    });
    // status 喺上面已經驗過一定係 pending_approval。SUPPLIER_ACTIVATABLE_STATUSES
    // 刻意唔包 pending_approval，令 activateSupplier 跳唔過審批，所以呢度只取資料
    // 層面嘅問題，唔重複用一個對呢條路唔啱嘅 status 規則。
    const issues = supplierActivatabilityIssues({
      supplierCode: supplier.supplier_code,
      supplierName: supplier.supplier_name,
      status: supplier.status,
      defaultCurrency: defaults.currency
    }).filter((issue) => issue.field !== "status");
    if (issues.length > 0) throw supplierNotActivatable(issues);
    // AC-012：Supplier 喺提交之後改過就唔可以批舊申請。
    if (Number(supplier.version) !== Number(request.supplier_version)) {
      throw supplierConflict("APPROVAL_REQUEST_STALE", "供應商資料在提交後已變更，請重新提交審批", {
        submittedVersion: Number(request.supplier_version),
        currentVersion: Number(supplier.version)
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
      // 設計 6.4：任一目前具 approval permission 者都可以重新指派。之前呢度完全冇
      // 驗過 actor —— assertActorFresh 只係比對 claim 同現況，佢唔執行任何 permission。
      if (!actor.permissions?.includes("supplier.approval")) {
        throw supplierConflict("APPROVAL_PERMISSION_LOST", "你目前沒有審批權限");
      }
      const approver = await this.assertEligibleApprover(connection, {
        approverUserId: input.approverUserId,
        requesterId: request.requested_by
      });
      if (sameUser(approver.id, request.assigned_approver_id)) {
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

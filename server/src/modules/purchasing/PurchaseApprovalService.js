import { purchasingPayloadHash } from "./PurchasingOperationService.js";
import { purchasingError } from "./purchasingErrors.js";
import { positiveId, reason as validReason, shortNote } from "./purchasingValidation.js";

const SNAPSHOT_HASH = "PO_APPROVAL_SNAPSHOT";
const json = (value) => typeof value === "string" ? JSON.parse(value) : value;
const dateOf = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${column}`;

/** 審批人睇到嘅提交內容（FR-APPROVAL-005）。全部由已保存快照嚟；數量金額用字串，唔經 Number。 */
export function approvalSnapshot(po, lines) {
  const paymentTerm = json(po.payment_term_snapshot) ?? null;
  return {
    number: po.po_number, supplier: { id: Number(po.supplier_id), code: po.supplier_code_snapshot, name: po.supplier_name_snapshot },
    orderingAddress: json(po.ordering_address_snapshot) ?? null, currency: { code: po.currency_code, name: po.currency_name_snapshot, decimalPlaces: Number(po.currency_decimal_places_snapshot) },
    paymentTerm, orderDate: po.order_date, expectedDeliveryDate: po.expected_delivery_date, defaultWarehouseCode: po.default_warehouse_code_snapshot,
    buyerLabel: po.buyer_label, supplierReference: po.supplier_reference, notes: po.notes, subtotalAmount: String(po.subtotal_amount), totalAmount: String(po.total_amount),
    warnings: [...(lines.some((line) => !/[1-9]/u.test(String(line.unit_price))) ? ["ZERO_PRICE"] : []), ...(paymentTerm ? [] : ["NO_PAYMENT_TERM"])],
    lines: lines.map((line) => ({ lineNumber: Number(line.line_number), skuId: Number(line.sku_id), skuCode: line.sku_code_snapshot, skuName: line.sku_name_snapshot,
      purchaseUomCode: line.purchase_uom_code_snapshot, orderedQuantity: String(line.ordered_quantity), baseUomCode: line.base_uom_code_snapshot,
      orderedBaseQuantity: String(line.ordered_base_quantity), unitPrice: String(line.unit_price), lineAmount: String(line.line_amount), zeroPriceReason: line.zero_price_reason,
      expectedDeliveryDate: line.expected_delivery_date, lineNote: line.line_note }))
  };
}

export const approvalSnapshotHash = (snapshot) => purchasingPayloadHash(SNAPSHOT_HASH, snapshot);

/**
 * 審批記錄（設計 §3.3、§4.7、§8.3；TASK-022）。全部喺 caller 嘅 transaction 入面做：caller 已驗 actor、claim event、鎖 PO 同 Lines，
 * 亦負責改 PO 狀態、重驗 Supplier／SKU、Audit 同 status history；命令同 route 由 TASK-023 接上。
 * 失效時 approval 保留 PENDING 並回可行動錯誤，提交人可以撤回再提交（§8.3）。
 */
export class PurchaseApprovalService {
  /** Policy ON。`version` 係 PO 轉去 PENDING_APPROVAL 之後嘅版本；審批人一定要係另一名 Active 兼有 purchasing.approval 嘅用戶。 */
  async requestInTransaction(tx, { purchaseOrderId, version, settingsVersion, actor, approverId, note = "", nowMs }) {
    positiveId(approverId, "approverId");
    if (approverId === actor.id) throw purchasingError("PO_APPROVER_INVALID", { field: "approverId" });
    const approver = await this.#withPermission(tx, approverId, "purchasing.approval");
    if (!approver) throw purchasingError("PO_APPROVER_INVALID", { field: "approverId" });
    const snapshot = await this.#currentSnapshot(tx, purchaseOrderId);
    const [row] = await tx.query("INSERT INTO purchase_order_approvals SET ?", [{ purchase_order_id: purchaseOrderId, purchase_order_version: version, settings_version: settingsVersion,
      requested_by: actor.id, assigned_approver_id: approverId, requested_by_label: actor.username, approver_label: approver.label, approval_snapshot: JSON.stringify(snapshot),
      snapshot_hash: approvalSnapshotHash(snapshot), request_note: shortNote(note, "note"), requested_at: nowMs }]);
    return { id: Number(row.insertId), approverId, approverLabel: approver.label };
  }

  /** 只有指定審批人可以批，提交人自己唔得；版本、快照同兩名用戶都要仲有效（FR-APPROVAL-007）。Supplier／SKU 由 caller 嘅確認路徑重驗。 */
  async approveInTransaction(tx, { purchaseOrderId, version, actor, reason = "", nowMs }) {
    const approval = await this.#assigned(tx, purchaseOrderId, version, actor);
    if (!await this.#withPermission(tx, Number(approval.assigned_approver_id), "purchasing.approval") || !await this.#withPermission(tx, Number(approval.requested_by), "purchasing.mgmt")) {
      throw purchasingError("PO_APPROVER_INVALID");
    }
    return this.#decide(tx, approval, "APPROVED", actor, reason === "" ? "" : validReason(reason), nowMs);
  }

  /** 拒絕一定要有原因（FR-APPROVAL-006）。 */
  async rejectInTransaction(tx, { purchaseOrderId, version, actor, reason, nowMs }) {
    const decisionReason = validReason(reason);
    return this.#decide(tx, await this.#assigned(tx, purchaseOrderId, version, actor), "REJECTED", actor, decisionReason, nowMs);
  }

  /** 只有提交人可以撤回（§5.2）；審批人被停用都可以撤回再提交（FR-APPROVAL-010）。 */
  async withdrawInTransaction(tx, { purchaseOrderId, actor, reason = "", nowMs }) {
    const approval = await this.#pending(tx, purchaseOrderId);
    if (Number(approval.requested_by) !== actor.id) throw purchasingError("APPROVAL_ASSIGNEE_MISMATCH");
    return this.#decide(tx, approval, "WITHDRAWN", actor, reason === "" ? "" : validReason(reason), nowMs);
  }

  /** 取消 Pending PO 時（§8.4）：唔可以留低仲批得嘅申請。 */
  async invalidateInTransaction(tx, { purchaseOrderId, actor, reason, nowMs }) {
    return this.#decide(tx, await this.#pending(tx, purchaseOrderId), "INVALIDATED", actor, validReason(reason), nowMs);
  }

  async #pending(tx, purchaseOrderId) {
    const [[approval]] = await tx.query(`SELECT id, purchase_order_version, requested_by, assigned_approver_id, snapshot_hash, version
      FROM purchase_order_approvals WHERE purchase_order_id = ? AND pending_slot = 1 FOR UPDATE`, [purchaseOrderId]);
    if (!approval) throw purchasingError("PO_STATE_CONFLICT");
    return approval;
  }

  async #assigned(tx, purchaseOrderId, version, actor) {
    const approval = await this.#pending(tx, purchaseOrderId);
    if (Number(approval.requested_by) === actor.id) throw purchasingError("SELF_APPROVAL_DENIED");
    if (Number(approval.assigned_approver_id) !== actor.id) throw purchasingError("APPROVAL_ASSIGNEE_MISMATCH");
    if (Number(approval.purchase_order_version) !== version) throw purchasingError("VERSION_CONFLICT", { currentVersion: Number(approval.purchase_order_version) });
    // PO 喺 Pending 期間凍結；唔一致即係快照同 PO 已經分開，唔可以照批。
    if (approvalSnapshotHash(await this.#currentSnapshot(tx, purchaseOrderId)) !== approval.snapshot_hash) throw purchasingError("PO_STATE_CONFLICT");
    return approval;
  }

  async #decide(tx, approval, status, actor, reason, nowMs) {
    const [row] = await tx.query("UPDATE purchase_order_approvals SET status = ?, decision_reason = ?, decided_at = ?, decided_by = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'PENDING'",
      [status, reason, nowMs, actor.id, approval.id, approval.version]);
    if (Number(row.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");
    return { id: Number(approval.id), status };
  }

  async #withPermission(tx, userId, permission) {
    const [[user]] = await tx.query(`SELECT COALESCE(NULLIF(u.display_name, ''), u.username) AS label FROM users u WHERE u.id = ? AND u.status = 'active'
      AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = u.id AND p.name = ?) LOCK IN SHARE MODE`, [userId, permission]);
    return user ?? null;
  }

  async #currentSnapshot(tx, purchaseOrderId) {
    const [[po]] = await tx.query(`SELECT po_number, supplier_id, supplier_code_snapshot, supplier_name_snapshot, ordering_address_snapshot, currency_code, currency_name_snapshot,
      currency_decimal_places_snapshot, payment_term_snapshot, ${dateOf("order_date")}, ${dateOf("expected_delivery_date")}, default_warehouse_code_snapshot, buyer_label, supplier_reference,
      notes, subtotal_amount, total_amount FROM purchase_orders WHERE id = ?`, [purchaseOrderId]);
    if (!po) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
    const [lines] = await tx.query(`SELECT line_number, sku_id, sku_code_snapshot, sku_name_snapshot, purchase_uom_code_snapshot, ordered_quantity, base_uom_code_snapshot, ordered_base_quantity,
      unit_price, line_amount, zero_price_reason, ${dateOf("expected_delivery_date")}, line_note FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number`, [purchaseOrderId]);
    return approvalSnapshot(po, lines);
  }
}

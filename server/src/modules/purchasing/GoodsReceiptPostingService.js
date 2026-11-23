import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { issuePurchaseReceiptContext } from "../inventory/InventoryPurchaseContext.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { SupplierLookupService } from "../supplier/SupplierLookupService.js";
import { nextPurchaseOrderStatus } from "./purchaseOrderStateMachine.js";
import { appendStatusHistory } from "./purchaseOrderStatusHistory.js";
import { purchasingError } from "./purchasingErrors.js";
import { calculateOverReceipt, evaluateMinimumLife, evaluateSkuCommitment, evaluateSupplierException } from "./ReceivingPolicyService.js";

const LOCATION_CODES = ["WAREHOUSE_INVALID", "BIN_INVALID", "BIN_WAREHOUSE_MISMATCH"];
const EXPIRY_OVERRIDE = "receiving.expiry.override";
const breach = () => purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");
const fail = (issue, prefix) => { throw purchasingError(issue.code, { field: prefix ? `${prefix}.${issue.path}` : issue.path }); };
const correlation = (value) => (typeof value === "string" && /^[\x20-\x7e]{0,64}$/u.test(value) ? value : "");

/**
 * GR Confirm 嘅 policy 同 Inventory 過帳（設計 §3.5、§8.7；TASK-032）。由 GoodsReceiptService 喺同一個 transaction、
 * 已經 FOR UPDATE 鎖咗 PO、PO Lines、GR、children 之後調用；呢度唔開 transaction、唔 commit。
 */
export class GoodsReceiptPostingService {
  constructor({ database, logger, time, inventory, auth }) {
    if (!database || !logger || !time || !inventory || !auth) throw new TypeError("GoodsReceiptPostingService requires all of its dependencies");
    Object.assign(this, { database, logger, time, inventory, auth });
  }

  /**
   * §3.5 第 4～7 步：讀目前 Supplier／SKU，驗 Supplier 例外、SKU 承諾、Tracking、效期同超收（按已鎖 PO progress）。
   * 一次一個錯誤，field 係完整路徑；回傳要寫入 line／detail 嘅 confirm facts。
   */
  async evaluate(tx, { gr, rows, request, permissions, nowMs }) {
    // ponytail: assertUsableInTransaction 用 FOR UPDATE 鎖 Supplier row；同 Supplier 管理並發時最壞係 deadlock→409 重試。
    const supplier = await new SupplierLookupService({ database: this.database, logger: this.logger, time: this.time })
      .assertUsableInTransaction(tx, Number(gr.supplier_id), { purpose: "history" });
    const flat = rows.flatMap(({ details }) => details);
    const supplierRule = evaluateSupplierException({ currentStatus: supplier.status, details: flat, reason: request.supplierExceptionReason });
    for (const issue of supplierRule.issues) {
      const match = /^details\[(\d+)\]\.(.+)$/u.exec(issue.path);
      if (match) fail({ ...issue, path: `${flat[Number(match[1])].path}.${match[2]}` });
      fail(issue);
    }

    const skus = await this.#currentSkus(tx, rows.map(({ poLine }) => Number(poLine.sku_id)), nowMs);
    const confirmDate = this.time.fileDate(this.time.at(nowMs));
    const canOverride = permissions.includes(EXPIRY_OVERRIDE);
    const lines = [], details = new Map();
    for (const [index, { line, poLine, details: lineDetails }] of rows.entries()) {
      const prefix = `lines.${index}`, current = skus.get(Number(poLine.sku_id));
      const sku = evaluateSkuCommitment({ currentSku: current, reason: line.skuExceptionReason, poSnapshot: {
        skuId: Number(poLine.sku_id), trackingPolicySnapshot: poLine.tracking_policy_snapshot, baseUomIdSnapshot: Number(poLine.base_uom_id),
        baseUomCodeSnapshot: poLine.base_uom_code_snapshot, purchaseSkuUomIdSnapshot: Number(poLine.purchase_sku_uom_id),
        uomToBaseFactorSnapshot: Number(poLine.uom_to_base_factor_snapshot) } });
      if (sku.issues.length) fail(sku.issues[0], prefix);
      for (const detail of lineDetails) {
        const life = evaluateMinimumLife({ businessReceiptDate: request.businessReceiptDate, confirmDate, expiryDate: detail.tracking.expiryDate,
          snapshotDays: poLine.minimum_receipt_life_days_snapshot === null ? null : Number(poLine.minimum_receipt_life_days_snapshot),
          currentDays: current.minimumReceiptLifeDays ?? null, canOverride, reason: detail.expiryOverrideReason });
        if (life.issues.length) fail(life.issues[0], detail.path);
        details.set(detail.path, { evidence: life.evidence, minimum_life_days_applied: life.minimumLifeDaysApplied,
          actual_remaining_life_days: life.actualRemainingLifeDays, expiry_override_reason: life.expiryOverrideReason });
      }
      const received = lineDetails.reduce((sum, detail) => sum + detail.quantity.receivedBaseQuantity, 0);
      const net = Number(poLine.net_received_base_quantity);
      const outstandingBefore = Math.max(0, Number(poLine.ordered_base_quantity) - net - Number(poLine.closed_remaining_base_quantity));
      const over = calculateOverReceipt({ outstandingBefore, receivedBaseQuantity: received, reason: line.overReceiptReason });
      if (over.issues.length) fail(over.issues[0], prefix);
      lines.push({ received, skuExceptionReason: sku.skuExceptionReason, row: {
        po_outstanding_before_base_quantity: outstandingBefore, over_received_base_quantity: over.overReceivedBaseQuantity,
        over_receipt_reason: over.overReceiptReason, item_status_at_confirm: current.itemStatus, sku_status_at_confirm: current.skuStatus,
        purchasable_at_confirm: current.purchasable ? 1 : 0, inventory_tracked_at_confirm: current.inventoryTracked ? 1 : 0,
        current_tracking_policy: current.trackingPolicy, sku_warning_codes: JSON.stringify(sku.warningCodes),
        sku_exception_reason: sku.skuExceptionReason, po_net_received_after_base_quantity: net + received } });
    }
    return { supplier: supplierRule, lines, details };
  }

  /**
   * §3.5 第 8～9 步：一次 Inventory batch；結果集合要同 details 完全一樣，否則 rollback。之後寫 movement IDs、PO progress、
   * PO status（同 history）、GR CONFIRMED。0120／0121 喺 parent confirmed_at 有值之後凍結 children，所以 header 最後先寫。
   */
  async post(tx, { req, gr, po, poLines, rows, detailIds, confirm, actor, request, version, nowMs, correlationId }) {
    const command = { actor: { userId: actor.id, serviceName: "", claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions },
      correlationId: correlation(correlationId), source: { documentId: String(gr.id), eventId: request.eventId }, lines: [] };
    for (const [index, { poLine, details }] of rows.entries()) {
      for (const detail of details) {
        const facts = confirm.details.get(detail.path);
        command.lines.push({ sourceLineId: String(detailIds.get(detail.path)), skuId: Number(poLine.sku_id),
          baseQuantity: detail.quantity.receivedBaseQuantity, warehouseId: detail.warehouseId, binId: detail.binId,
          lotNumber: detail.tracking.lotNumber === "" ? null : detail.tracking.lotNumber, expiryDate: detail.tracking.expiryDate,
          manufactureDate: detail.tracking.manufactureDate, stockStatus: detail.stockStatus, minimumLifeEvidence: facts.evidence,
          commitment: { purchaseOrderId: Number(po.id), purchaseOrderLineId: Number(poLine.id), confirmedVersion: Number(po.version),
            skuId: Number(poLine.sku_id), inventoryTrackedSnapshot: Number(poLine.inventory_tracked_snapshot) === 1,
            trackingPolicySnapshot: poLine.tracking_policy_snapshot, baseUomIdSnapshot: Number(poLine.base_uom_id),
            baseUomCodeSnapshot: poLine.base_uom_code_snapshot,
            minimumReceiptLifeDaysSnapshot: poLine.minimum_receipt_life_days_snapshot === null ? null : Number(poLine.minimum_receipt_life_days_snapshot),
            skuExceptionReason: confirm.lines[index].skuExceptionReason || null } });
      }
    }
    // Proof：PO 喺同一 transaction FOR UPDATE 鎖住而且係 CONFIRMED／PARTIALLY_RECEIVED（caller 已驗），即係已確認承諾。
    const confirmedLines = command.lines.map(({ sourceLineId, commitment: { skuExceptionReason: _reason, ...snapshot } }) =>
      ({ sourceLineId, status: "CONFIRMED", ...snapshot }));
    command.context = issuePurchaseReceiptContext(req, tx, command, confirmedLines, { database: this.database, time: this.time, ...this.auth });
    let result;
    try {
      result = await this.inventory.postPurchaseReceiptBatchInTransaction(tx, command);
    } catch (error) {
      if (error instanceof ApplicationError && LOCATION_CODES.includes(error.code)) throw purchasingError(error.code);
      throw error;
    }
    if (result?.status !== "POSTED" || !Number.isSafeInteger(result.operationId) || !Array.isArray(result.lines)
      || result.lines.length !== command.lines.length
      || result.lines.some((line, index) => line?.sourceLineId !== command.lines[index].sourceLineId
        || line.baseQuantity !== command.lines[index].baseQuantity || !Number.isSafeInteger(line.movementId) || !Number.isSafeInteger(line.operationId))) {
      throw breach();
    }

    for (const line of result.lines) {
      await tx.query(`UPDATE goods_receipt_details SET inventory_operation_request_id = ?, inventory_movement_id = ?, inventory_movement_group_id = ?,
        confirmed_at = ?, updated_at = ? WHERE id = ?`, [line.operationId, line.movementId, line.movementGroupId, nowMs, nowMs, Number(line.sourceLineId)]);
    }
    const received = new Map(rows.map(({ poLine }, index) => [Number(poLine.id), confirm.lines[index].received]));
    let outstanding = false;
    for (const poLine of poLines) {
      const ordered = Number(poLine.ordered_base_quantity), closed = Number(poLine.closed_remaining_base_quantity);
      const add = received.get(Number(poLine.id)) ?? 0, net = Number(poLine.net_received_base_quantity) + add;
      const hasOutstanding = poLine.closed_at === null && net + closed < ordered;
      outstanding ||= hasOutstanding;
      if (!add) continue;
      const gross = Number(poLine.gross_received_base_quantity) + add;
      if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(net)) throw breach();
      await tx.query(`UPDATE purchase_order_lines SET gross_received_base_quantity = ?, net_received_base_quantity = ?, has_outstanding = ?,
        is_over_received = ?, version = version + 1, updated_at = ? WHERE id = ?`, [gross, net, hasOutstanding ? 1 : 0, net > ordered ? 1 : 0, nowMs, Number(poLine.id)]);
    }
    const status = po.status === "PARTIALLY_RECEIVED" && outstanding ? po.status
      : nextPurchaseOrderStatus(po.status, outstanding ? "RECEIVE_PARTIAL" : "RECEIVE_ALL");
    const poVersion = Number(po.version) + 1;
    const [updatedPo] = await tx.query(`UPDATE purchase_orders SET status = ?, has_outstanding = ?, has_confirmed_receipt = 1, version = ?,
      updated_at = ?, updated_by = ?, updated_by_label = ? WHERE id = ? AND version = ?`,
    [status, outstanding ? 1 : 0, poVersion, nowMs, actor.id, actor.username, Number(po.id), Number(po.version)]);
    if (Number(updatedPo.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");
    if (status !== po.status) {
      await appendStatusHistory(tx, { purchaseOrderId: Number(po.id), fromStatus: po.status, toStatus: status, action: "RECEIVE",
        version: poVersion, eventId: request.eventId, actor, nowMs });
    }

    const flags = { over: confirm.lines.some(({ row }) => row.over_received_base_quantity > 0),
      expiry: [...confirm.details.values()].some(({ evidence }) => evidence !== null),
      sku: confirm.lines.some(({ skuExceptionReason }) => skuExceptionReason !== "") };
    const [updated] = await tx.query(`UPDATE goods_receipts SET status = 'CONFIRMED', supplier_status_at_confirm = ?, supplier_exception_reason = ?,
      has_over_receipt = ?, has_expiry_override = ?, has_sku_exception = ?, confirmed_at = ?, confirmed_by = ?, confirm_event_id = ?,
      inventory_result_summary = ?, updated_at = ?, updated_by = ?, updated_by_label = ? WHERE id = ? AND version = ? AND status = 'DRAFT'`,
    [confirm.supplier.supplierStatusAtConfirm, confirm.supplier.supplierExceptionReason, flags.over ? 1 : 0, flags.expiry ? 1 : 0, flags.sku ? 1 : 0,
      nowMs, actor.id, request.eventId, JSON.stringify({ operationId: result.operationId, lineCount: result.lines.length }),
      nowMs, actor.id, actor.username, Number(gr.id), version]);
    if (Number(updated.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");
    return { operationId: result.operationId, purchaseOrderStatus: status };
  }

  async #currentSkus(tx, skuIds, nowMs) {
    const lookup = new ItemLookupService({ database: { query: (sql, params) => tx.query(`${sql} FOR SHARE`, params) }, logger: this.logger, time: this.time });
    const ids = [...new Set(skuIds)].sort((a, b) => a - b), skus = new Map();
    for (let offset = 0; offset < ids.length; offset += 100) {
      for (const [id, sku] of await lookup.findManyForCommittedReceipt(ids.slice(offset, offset + 100), { atMs: nowMs })) skus.set(id, sku);
    }
    return skus;
  }
}

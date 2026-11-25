import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { purchasingError } from "./purchasingErrors.js";
import { eventId, onlyFields, positiveId, reason, requireItems } from "./purchasingValidation.js";
import { appendStatusHistory } from "./purchaseOrderStatusHistory.js";
import { planReceiptReversal } from "./receiptReversalProgress.js";

const action = "goods_receipt.reversed";
const unavailable = () => purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");
const invalid = field => purchasingError("PURCHASING_INPUT_INVALID", { field });

async function authorize(tx, claims) {
  const actor = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
  if (!["purchasing.view", "inventory.adjust"].every(permission => actor.permissions.includes(permission))) throw permissionStaleError();
  return actor;
}

function normalize(input) {
  const body = onlyFields(input, ["eventId", "version", "reason", "details"], "body");
  const details = Array.from(requireItems(body.details, 200, "details"), (item, index) => {
    const path = `details.${index}`;
    const detail = onlyFields(item, ["goodsReceiptDetailId", "baseQuantity"], path);
    return {
      goodsReceiptDetailId: positiveId(detail.goodsReceiptDetailId, `${path}.goodsReceiptDetailId`),
      baseQuantity: positiveId(detail.baseQuantity, `${path}.baseQuantity`)
    };
  });
  if (new Set(details.map(item => item.goodsReceiptDetailId)).size !== details.length) throw invalid("details");
  const reasonText = reason(body.reason);
  // The Inventory reversal port accepts a single line of at most 500 UTF-8 bytes.
  if (Buffer.byteLength(reasonText, "utf8") > 500 || /[\t\r\n]/u.test(reasonText)) throw invalid("reason");
  return { eventId: eventId(body.eventId), version: positiveId(body.version, "version"), reason: reasonText,
    details: details.sort((left, right) => left.goodsReceiptDetailId - right.goodsReceiptDetailId) };
}

async function lockReceipt(tx, id, expectedVersion) {
  const [[owner]] = await tx.query("SELECT purchase_order_id FROM goods_receipts WHERE id = ?", [id]);
  if (!owner) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
  const orderId = Number(owner.purchase_order_id);
  const [[order]] = await tx.query("SELECT id, status, version FROM purchase_orders WHERE id = ? FOR UPDATE", [orderId]);
  if (!order || !["CONFIRMED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED"].includes(order.status)) throw purchasingError("PO_STATE_CONFLICT");
  const [purchaseLines] = await tx.query(`SELECT id, sku_id, ordered_base_quantity, net_received_base_quantity, reversed_base_quantity,
    closed_remaining_base_quantity, closed_at FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id FOR UPDATE`, [orderId]);
  const [[receipt]] = await tx.query(`SELECT id, gr_number, status, version, purchase_order_id,
    total_received_base_quantity, total_reversed_base_quantity FROM goods_receipts WHERE id = ? FOR UPDATE`, [id]);
  if (!receipt || Number(receipt.purchase_order_id) !== orderId) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
  const version = Number(receipt.version);
  if (expectedVersion !== undefined && version !== expectedVersion) throw purchasingError("VERSION_CONFLICT", { currentVersion: version });
  if (!["CONFIRMED", "PARTIALLY_REVERSED"].includes(receipt.status)) throw purchasingError("GR_STATE_CONFLICT");
  const [receiptLines] = await tx.query(`SELECT id, purchase_order_line_id, sku_id
    FROM goods_receipt_lines WHERE goods_receipt_id = ? ORDER BY id FOR UPDATE`, [id]);
  const [details] = await tx.query(`SELECT id, goods_receipt_id, purchase_order_id, goods_receipt_line_id, purchase_order_line_id,
    sku_id, inventory_movement_id, received_base_quantity, reversed_base_quantity
    FROM goods_receipt_details WHERE goods_receipt_id = ? ORDER BY id FOR UPDATE`, [id]);
  return { order, receipt, purchaseLines, receiptLines, details };
}

function assertInventoryResult(command, result) {
  const validId = id => Number.isSafeInteger(id) && id > 0;
  if (result?.status !== "POSTED" || !validId(result.operationId) || !Array.isArray(result.lines) ||
      result.lines.length !== command.lines.length || command.lines.some((line, index) => {
        const outcome = result.lines[index];
        return outcome?.sourceLineId !== line.sourceLineId || outcome.originalMovementId !== line.originalMovementId ||
          outcome.baseQuantity !== line.baseQuantity || !validId(outcome.operationId) || !validId(outcome.movementId);
      }) || new Set(result.lines.map(line => line.operationId)).size !== result.lines.length ||
      new Set(result.lines.map(line => line.movementId)).size !== result.lines.length) throw unavailable();
}

/** Dependencies run in the caller's active REPEATABLE READ transaction. */
export class ReceiptReversalService {
  constructor({ database, logger, time, operations, audit, hasActiveInvoice, readReturnedQuantities, postInventory }) {
    if ([hasActiveInvoice, readReturnedQuantities, postInventory].some(provider => typeof provider !== "function")) {
      throw new TypeError("Receipt reversal requires the AP, Returns and Inventory providers");
    }
    Object.assign(this, { database, logger, time, operations, audit, hasActiveInvoice, readReturnedQuantities, postInventory });
  }

  async #verifiedReturns(tx, goodsReceiptId, goodsReceiptDetailIds) {
    const occupied = await this.hasActiveInvoice(tx, { goodsReceiptId });
    if (typeof occupied !== "boolean") throw unavailable();
    if (occupied) throw purchasingError("GR_REVERSAL_INVOICED");
    const result = await this.readReturnedQuantities(tx, { goodsReceiptId, goodsReceiptDetailIds });
    if (!(result instanceof Map) || result.size !== goodsReceiptDetailIds.length || goodsReceiptDetailIds.some(id =>
      typeof result.get(id) !== "string" || !/^(0|[1-9][0-9]*)$/u.test(result.get(id)))) throw unavailable();
    return result;
  }

  async preview({ id, claims }) {
    positiveId(id, "id");
    return this.operations.run(this.database, async tx => {
      await authorize(tx, claims);
      const { receipt, details } = await lockReceipt(tx, id);
      if (!details.length) throw unavailable();
      const returned = await this.#verifiedReturns(tx, String(id), details.map(detail => String(detail.id)));
      return {
        version: Number(receipt.version),
        details: details.map(detail => {
          const remaining = BigInt(detail.received_base_quantity) - BigInt(detail.reversed_base_quantity) - BigInt(returned.get(String(detail.id)));
          if (remaining < 0n) throw unavailable();
          return { id: Number(detail.id), remainingBaseQuantity: String(remaining) };
        })
      };
    });
  }

  async create({ id, claims, input, req, context = {} }) {
    try {
      positiveId(id, "id");
      const request = normalize(input);
      return await this.operations.run(this.database, async tx => {
        const nowMs = this.time.nowMs();
        const actor = await authorize(tx, claims);
        const { operationId, replay } = await this.operations.claim(tx, {
          commandType: "REVERSE_GOODS_RECEIPT", sourceDocumentId: String(id), eventId: request.eventId,
          payload: request, actor, nowMs, requestId: context.requestId, correlationId: context.correlationId
        });
        if (replay) return { ...replay, replayed: true };

        const locked = await lockReceipt(tx, id, request.version);
        const ownedDetailIds = new Set(locked.details.map(detail => Number(detail.id)));
        if (request.details.some(detail => !ownedDetailIds.has(detail.goodsReceiptDetailId))) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
        const goodsReceiptId = String(id);
        const returned = await this.#verifiedReturns(tx, goodsReceiptId, request.details.map(detail => String(detail.goodsReceiptDetailId)));
        const plan = planReceiptReversal(locked, request.details, returned);
        const [[last]] = await tx.query(`SELECT reversal_sequence FROM goods_receipt_reversals WHERE goods_receipt_id = ?
          ORDER BY reversal_sequence DESC LIMIT 1 FOR SHARE`, [id]);
        const sequence = Number(last?.reversal_sequence ?? 0) + 1;
        if (sequence > 65_535) throw purchasingError("GR_STATE_CONFLICT");
        const orderId = Number(locked.order.id);
        // In RR, the PO lock does not refresh a previously established snapshot.
        const [[latestHistory]] = await tx.query(`SELECT sequence_no FROM purchase_order_status_history WHERE purchase_order_id = ?
          ORDER BY sequence_no DESC LIMIT 1 FOR SHARE`, [orderId]);

        const command = {
          actor: { userId: actor.id, serviceName: "", claimedRoles: claims.roles, claimedPermissions: claims.permissions },
          correlationId: context.correlationId ?? "", source: { documentId: goodsReceiptId, eventId: request.eventId },
          goodsReceiptId, reasonText: request.reason,
          lines: plan.details.map(detail => ({ sourceLineId: String(detail.id), originalSourceLineId: String(detail.id),
            originalMovementId: detail.originalMovementId, baseQuantity: detail.baseQuantity }))
        };
        const ownerProof = { goodsReceiptId, status: locked.receipt.status,
          details: command.lines.map(({ sourceLineId, originalMovementId }) => ({ sourceLineId, goodsReceiptId, originalMovementId })) };
        const result = await this.postInventory(tx, req, command, ownerProof);
        assertInventoryResult(command, result);
        const number = `${locked.receipt.gr_number}-R${String(sequence).padStart(2, "0")}`;
        const version = request.version + 1;
        const [row] = await tx.query("INSERT INTO goods_receipt_reversals SET ?", [{
          goods_receipt_id: id, reversal_sequence: sequence, reversal_reference: number, event_id: request.eventId, reason: request.reason,
          total_reversed_base_quantity: plan.quantity, inventory_result_summary: JSON.stringify({ operationId: result.operationId, lineCount: result.lines.length }),
          confirmed_at: nowMs, confirmed_by: actor.id, confirmed_by_label: actor.username, request_id: context.requestId ?? "", correlation_id: context.correlationId ?? ""
        }]);
        const reversalId = Number(row.insertId);
        await tx.query(`INSERT INTO goods_receipt_reversal_details (reversal_id, goods_receipt_id, goods_receipt_detail_id, purchase_order_line_id,
          sku_id, reversed_base_quantity, original_inventory_movement_id, reversal_inventory_movement_id, reversal_inventory_operation_id, created_at) VALUES ?`,
        [plan.details.map((detail, index) => [reversalId, id, detail.id, detail.poLineId, detail.skuId, detail.baseQuantity, detail.originalMovementId,
          result.lines[index].movementId, result.lines[index].operationId, nowMs])]);
        for (const detail of plan.details) {
          await tx.query("UPDATE goods_receipt_details SET reversed_base_quantity = ?, updated_at = ? WHERE id = ?", [detail.reversed, nowMs, detail.id]);
        }
        for (const line of plan.purchaseLines) {
          await tx.query(`UPDATE purchase_order_lines SET reversed_base_quantity = ?, net_received_base_quantity = ?, has_outstanding = ?,
            is_over_received = ?, version = version + 1, updated_at = ? WHERE id = ?`, [line.reversed, line.net, line.outstanding, line.over, nowMs, line.id]);
        }
        await tx.query(`UPDATE goods_receipts SET status = ?, total_reversed_base_quantity = ?, version = ?, updated_at = ?, updated_by = ?, updated_by_label = ?
          WHERE id = ?`, [plan.receiptStatus, plan.totalReversed, version, nowMs, actor.id, actor.username, id]);
        const orderVersion = Number(locked.order.version) + 1;
        await tx.query(`UPDATE purchase_orders SET status = ?, has_outstanding = ?, version = ?, updated_at = ?, updated_by = ?, updated_by_label = ?
          WHERE id = ?`, [plan.orderStatus, plan.hasOutstanding, orderVersion, nowMs, actor.id, actor.username, orderId]);
        await appendStatusHistory(tx, { purchaseOrderId: orderId, fromStatus: locked.order.status, toStatus: plan.orderStatus, action: "REVERSE",
          reason: request.reason, version: orderVersion, eventId: request.eventId, actor, nowMs, sequenceNo: Number(latestHistory?.sequence_no ?? 0) + 1 });
        const summary = { id: reversalId, number, status: "POSTED", version };
        await this.audit.record(tx, { ...context, actor, action, targetId: id, targetLabel: number, nowMs, reason: request.reason,
          detail: { version, reversalId } });
        await this.operations.complete(tx, { operationId, result: summary, nowMs });
        return { ...summary, replayed: false };
      });
    } catch (failure) {
      const cause = failure?.cause ?? failure;
      const error = cause?.code === "ER_DUP_ENTRY" && cause.sqlMessage?.includes("uq_gr_reversal_event")
        ? purchasingError("PURCHASING_EVENT_CONFLICT") : failure;
      if (error instanceof ApplicationError && error.statusCode >= 400 && error.statusCode < 500) {
        try {
          await this.database.withTransaction(tx => this.audit.recordRejected(tx, { ...context, actorId: Number(claims?.sub),
            action, targetId: Number.isSafeInteger(id) && id > 0 ? id : null, code: error.code, nowMs: this.time.nowMs() }));
        } catch (auditError) {
          await this.logger.error("purchasing.audit.rejected_not_persisted", "Rejected receipt reversal could not be audited",
            { code: error.code, auditErrorCode: auditError?.code ?? auditError?.name, requestId: context.requestId ?? null });
        }
      }
      throw error;
    }
  }
}

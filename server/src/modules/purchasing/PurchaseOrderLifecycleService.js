import { purchasingError } from "./purchasingErrors.js";
import { appendStatusHistory } from "./purchaseOrderStatusHistory.js";
import { nextPurchaseOrderStatus } from "./purchaseOrderStateMachine.js";

const nonNegative = (value) => value > 0n ? value : 0n;

/** §3.2 每行推導；Base quantity 係整數，用 BigInt 唔會失精度。 */
export function lineOutstanding({ ordered, net, closedRemaining }) {
  return nonNegative(BigInt(ordered) - BigInt(net) - BigInt(closedRemaining));
}

/**
 * §3.2：全部 Line outstanding = 0 時，有任何 closedRemaining 就 CLOSED，否則 FULLY_RECEIVED；未齊就睇有冇收過或者關過。
 * ponytail: 只覆蓋 Close Remaining 要用嘅推導；Reversal 遇人工 CLOSED 唔重開（§8.4）由 Confirm／Reversal 嘅 Task 喺呼叫方處理。
 */
export function derivedStatus(lines) {
  if (lines.every((line) => lineOutstanding(line) === 0n)) return lines.some((line) => BigInt(line.closedRemaining) > 0n) ? "CLOSED" : "FULLY_RECEIVED";
  return lines.some((line) => BigInt(line.net) > 0n || BigInt(line.closedRemaining) > 0n) ? "PARTIALLY_RECEIVED" : "CONFIRMED";
}

/** Status history 嘅 action 跟 0118 嘅 CHECK；撤回確認同撤回審批都係 WITHDRAW，由 from_status 分。 */
const KINDS = Object.freeze({
  WITHDRAW_CONFIRMATION: { transition: "WITHDRAW_CONFIRMATION", history: "WITHDRAW", audit: "purchase_order.confirmation_withdrawn" },
  CANCEL: { transition: "CANCEL", history: "CANCEL", audit: "purchase_order.cancelled" },
  CLOSE_REMAINING: { transition: "CLOSE_REMAINING", history: "CLOSE", audit: "purchase_order.remaining_closed" }
});
export const LIFECYCLE_KINDS = Object.keys(KINDS);

/**
 * §8.4：Confirmed 撤回、取消同 Close Remaining。鎖 PO 再按 ID 鎖 Lines（§2.6），version CAS，同一 transaction 寫 status history 同 Audit。
 * Caller（PurchaseOrderService）負責 actor freshness、operation claim 同 complete。
 */
export class PurchaseOrderLifecycleService {
  constructor({ approvals }) {
    if (!approvals) throw new TypeError("PurchaseOrderLifecycleService requires approvals");
    this.approvals = approvals;
  }

  async runInTransaction(tx, { kind, purchaseOrderId: id, request, actor, nowMs }) {
    const [[po]] = await tx.query("SELECT id, po_number, status, version, has_confirmed_receipt FROM purchase_orders WHERE id = ? FOR UPDATE", [id]);
    if (!po) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
    const next = nextPurchaseOrderStatus(po.status, KINDS[kind].transition);
    if (Number(po.version) !== request.version) throw purchasingError("VERSION_CONFLICT", { currentVersion: Number(po.version) });
    // FR-LIFE-005：有過 Confirmed Receipt 就唔准撤回或者取消；Reversal 後 has_confirmed_receipt 仍然係 1（H1）。
    // ponytail: GR 表未有（TASK-027），暫時只靠呢個 flag；§8.4 嘅 NOT EXISTS confirmed GR 要喺 GR 表落地後加返。
    if (kind !== "CLOSE_REMAINING" && Number(po.has_confirmed_receipt) === 1) throw purchasingError("PO_STATE_CONFLICT");

    const version = request.version + 1, reason = request.reason;
    let status = next, detail = { version };
    const changes = { version, updated_at: nowMs, updated_by: actor.id, updated_by_label: actor.username };
    if (kind === "WITHDRAW_CONFIRMATION") Object.assign(changes, { status, confirmed_at: null, confirmed_by: null });
    if (kind === "CANCEL") {
      // §8.4：唔可以留低仲可以批准嘅申請。
      if (po.status === "PENDING_APPROVAL") await this.approvals.invalidateInTransaction(tx, { purchaseOrderId: id, actor, reason, nowMs });
      Object.assign(changes, { status, has_outstanding: 0, cancelled_at: nowMs, cancelled_by: actor.id });
    }
    if (kind === "CLOSE_REMAINING") {
      const closed = await this.#closeLines(tx, id, request.lineIds, reason, actor, nowMs);
      status = derivedStatus(closed.lines);
      detail = { version, lineCount: closed.changed.length };
      Object.assign(changes, { status, ...(status === "CLOSED" ? { has_outstanding: 0, closed_at: nowMs, closed_by: actor.id } : {}) });
    }
    await tx.query("UPDATE purchase_orders SET ? WHERE id = ?", [changes, id]);
    // §8.4：數量變但狀態冇變只寫 Audit，唔造 status event。
    if (status !== po.status) {
      await appendStatusHistory(tx, { purchaseOrderId: id, fromStatus: po.status, toStatus: status, action: KINDS[kind].history, reason, version, eventId: request.eventId, actor, nowMs });
    }
    return { summary: { id, number: po.po_number, status, version }, audit: { action: KINDS[kind].audit, reason, detail } };
  }

  /** 每行關閉當刻嘅 max(ordered - net, 0)；client 唔可以送數量。揀咗冇 outstanding 嘅 Line 就拒絕，唔靜靜 no-op。 */
  async #closeLines(tx, id, lineIds, reason, actor, nowMs) {
    const [rows] = await tx.query(`SELECT id, ordered_base_quantity, net_received_base_quantity, closed_remaining_base_quantity
      FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id FOR UPDATE`, [id]);
    const lines = rows.map((row) => ({ id: Number(row.id), ordered: String(row.ordered_base_quantity),
      net: String(row.net_received_base_quantity), closedRemaining: String(row.closed_remaining_base_quantity) }));
    const byId = new Map(lines.map((line) => [line.id, line]));
    let targets;
    if (lineIds === undefined) targets = lines.filter((line) => lineOutstanding(line) > 0n);
    else {
      targets = lineIds.map((lineId, index) => {
        const line = byId.get(lineId);
        if (!line) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
        if (lineOutstanding(line) === 0n) throw purchasingError("PO_STATE_CONFLICT", { field: `lineIds.${index}` });
        return line;
      });
    }
    if (!targets.length) throw purchasingError("PO_STATE_CONFLICT");
    const changed = [];
    for (const line of targets) {
      line.closedRemaining = String(nonNegative(BigInt(line.ordered) - BigInt(line.net)));
      await tx.query(`UPDATE purchase_order_lines SET closed_remaining_base_quantity = ?, has_outstanding = 0, close_reason = ?, closed_at = ?, closed_by = ?,
        version = version + 1, updated_at = ? WHERE id = ?`, [line.closedRemaining, reason, nowMs, actor.id, nowMs, line.id]);
      changed.push(line.id);
    }
    return { lines, changed };
  }
}

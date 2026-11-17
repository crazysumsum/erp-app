import { purchasingError } from "./purchasingErrors.js";

const CONFIRMED = new Set(["CONFIRMED", "PARTIALLY_REVERSED", "REVERSED"]);
const OPEN = new Set(["DRAFT", "CANCELLED"]);
const unavailable = (extra) => Object.assign(purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE"), extra);

/**
 * §8.4 嘅權威事實（TASK-045）：呢張 PO 有冇任何曾經 Confirmed 嘅 GR，完全 Reversal 之後仍然算（H1）。
 * Caller 已經喺同一 transaction 用 FOR UPDATE 鎖住 PO root；呢度用 FOR SHARE 讀成個 rowset（idx_gr_po），
 * 喺 RR 之下亦擋住同一 PO 喺 commit 前新增 GR。TASK-032 Confirm 要跟同一鎖序：PO 先、GR 後。
 * 回答之前先驗晒每一行，同 0119 嘅 chk_gr_confirmation 一致；任何矛盾、未知狀態或者讀取錯誤都係依賴不可用，冇 null 分支。
 * 0119 未跑嘅環境，查詢會因為冇 goods_receipts 而失敗，所以照舊 503。
 */
export class GoodsReceiptFacts {
  async everConfirmed(tx, purchaseOrderId) {
    let rows;
    try {
      [rows] = await tx.query(
        "SELECT id, status, confirmed_at, confirm_event_id FROM goods_receipts WHERE purchase_order_id = ? FOR SHARE", [purchaseOrderId]);
    } catch (cause) { throw unavailable({ cause }); }
    if (!Array.isArray(rows)) throw unavailable({ cause: new Error("rowset is not an array") });
    for (const row of rows) {
      const timed = row.confirmed_at !== null, evented = row.confirm_event_id !== null;
      const valid = CONFIRMED.has(row.status) ? timed && evented : OPEN.has(row.status) ? !timed && !evented : false;
      if (!valid) throw unavailable({ goodsReceiptId: Number(row.id) });
    }
    return rows.some((row) => CONFIRMED.has(row.status));
  }
}

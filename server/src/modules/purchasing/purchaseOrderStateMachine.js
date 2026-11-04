import { purchasingError } from "./purchasingErrors.js";

// 設計 §3.2 同 §5.2（Cancel）。冇列出嘅轉換一律唔准；CLOSED、CANCELLED、FULLY_RECEIVED 暫時冇出路，Reversal 重算由 TASK-025 之後嘅 Task 加。
const TRANSITIONS = Object.freeze({
  DRAFT: { SAVE: "DRAFT", CONFIRM: "CONFIRMED", SUBMIT_FOR_APPROVAL: "PENDING_APPROVAL", CANCEL: "CANCELLED" },
  PENDING_APPROVAL: { APPROVE: "CONFIRMED", REJECT: "DRAFT", WITHDRAW_APPROVAL: "DRAFT", CANCEL: "CANCELLED" },
  CONFIRMED: { WITHDRAW_CONFIRMATION: "DRAFT", CANCEL: "CANCELLED", RECEIVE_PARTIAL: "PARTIALLY_RECEIVED", RECEIVE_ALL: "FULLY_RECEIVED" },
  PARTIALLY_RECEIVED: { RECEIVE_ALL: "FULLY_RECEIVED", CLOSE_REMAINING: "CLOSED" }
});

/** 回下一個狀態；呢個狀態唔准呢個動作就 PO_STATE_CONFLICT。 */
export function nextPurchaseOrderStatus(status, action) {
  const next = Object.hasOwn(TRANSITIONS, status) && Object.hasOwn(TRANSITIONS[status], action) ? TRANSITIONS[status][action] : null;
  if (!next) throw purchasingError("PO_STATE_CONFLICT");
  return next;
}

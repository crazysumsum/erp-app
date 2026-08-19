import { Dialog } from "quasar";

/**
 * 統一確認對話框嘅文案風格。底層用 Quasar 嘅 Dialog plugin（main.js 已經
 * 註冊）。`persistent: true`：一定要用戶明確揀確認或者取消，撳 ESC／點擊
 * 背景唔算數——刪除呢類操作唔應該俾人手滑就關咗個對話框當做冇事發生。
 */
export function confirm({ title = "確認", message, okLabel = "確認", cancelLabel = "取消" }) {
  return new Promise((resolve) => {
    Dialog.create({
      title,
      message,
      persistent: true,
      cancel: { label: cancelLabel, flat: true },
      ok: { label: okLabel, color: "negative", unelevated: true }
    })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false));
  });
}

/**
 * 刪除操作嘅專用文案——item 41 明確要求「統一刪除確認...嘅文案風格」，
 * 呢個係最常用嗰種 confirm()，起一個專用 helper 等頁面唔使逐個自己砌
 * 訊息。
 */
export function confirmDelete(subject) {
  return confirm({
    title: "刪除確認",
    message: `確定要刪除「${subject}」？呢個操作唔可以復原。`,
    okLabel: "刪除"
  });
}

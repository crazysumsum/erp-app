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

/**
 * 要求輸入密碼再確認高風險操作，回傳輸入嘅密碼；用戶取消就回 null。
 *
 * 用嚟配合後端 `jwt-password` 呢個 authType——單一個對話框同時做埋確認同
 * 收密碼，唔使先彈一個 confirm() 再彈一個輸入框：兩步變一步，用戶少click
 * 一次，我哋亦少一個「用戶喺兩個對話框之間改咗主意」嘅狀態要處理。
 */
export function promptPassword({ title = "請確認密碼", message, okLabel = "確認" }) {
  return new Promise((resolve) => {
    Dialog.create({
      title,
      message,
      prompt: {
        model: "",
        type: "password",
        isValid: (value) => value.length > 0
      },
      persistent: true,
      cancel: { label: "取消", flat: true },
      ok: { label: okLabel, color: "negative", unelevated: true }
    })
      .onOk((password) => resolve(password))
      .onCancel(() => resolve(null));
  });
}

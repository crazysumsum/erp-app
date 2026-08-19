import { Notify } from "quasar";

/**
 * 統一操作提示嘅文案風格：成功綠色、失敗紅色，都浮喺頂部。底層用 Quasar
 * 嘅 Notify plugin（main.js 已經註冊）。
 */
export function notifySuccess(message = "操作成功") {
  Notify.create({ type: "positive", message, position: "top" });
}

export function notifyError(message = "操作失敗") {
  Notify.create({ type: "negative", message, position: "top" });
}

/**
 * Category／Brand／UOM 三個 catalog 頁面共用嘅狀態顯示對照表——三份完全一樣
 * 嘅 inline object 抽出嚟，避免以後改一個狀態顏色要記得同步改三個檔案。
 */
export const STATUS_LABEL = Object.freeze({ active: "啟用", inactive: "已停用", archived: "已封存" });
export const STATUS_COLOUR = Object.freeze({ active: "positive", inactive: "grey", archived: "warning" });

// 收貨單狀態文字及顏色（徽章一律連文字，§1.2）。
export const receiptStatusLabels = Object.freeze({ DRAFT: "草稿", CONFIRMED: "已確認", PARTIALLY_REVERSED: "部分沖銷", REVERSED: "已沖銷", CANCELLED: "已取消" });
export const receiptStatusColors = Object.freeze({ DRAFT: "grey", CONFIRMED: "positive", PARTIALLY_REVERSED: "warning", REVERSED: "negative", CANCELLED: "negative" });

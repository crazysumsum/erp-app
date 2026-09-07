/**
 * Item／SKU editor 共用嘅顯示文字對照表。合法值本身跟後端
 * server/src/modules/item/itemConstants.js 一致（TRACKING_POLICIES、
 * BARCODE_TYPES），呢度淨係加返中文標籤俾 UI 用。
 */
export const TRACKING_POLICY_LABEL = Object.freeze({
  none: "不追蹤",
  batch: "追蹤批號",
  batch_expiry: "追蹤批號及效期",
  serial: "追蹤序號"
});

export const BARCODE_TYPE_LABEL = Object.freeze({
  gtin8: "GTIN-8",
  upca: "UPC-A",
  ean13: "EAN-13",
  gtin14: "GTIN-14",
  internal: "內部條碼"
});

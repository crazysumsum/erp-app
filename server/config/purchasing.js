const purchasingConfig = {
  maxPurchaseOrderLines: Number(process.env.PURCHASING_MAX_PURCHASE_ORDER_LINES ?? 100),
  maxGoodsReceiptDetails: Number(process.env.PURCHASING_MAX_GOODS_RECEIPT_DETAILS ?? 200),
  maxQuantity: Number(process.env.PURCHASING_MAX_QUANTITY ?? Number.MAX_SAFE_INTEGER),
  duplicateDeliveryNoteLookbackDays: Number(process.env.PURCHASING_DUPLICATE_DELIVERY_NOTE_LOOKBACK_DAYS ?? 90),
  exportMaxRows: Number(process.env.PURCHASING_EXPORT_MAX_ROWS ?? 50000),
  exportTimeoutMs: Number(process.env.PURCHASING_EXPORT_TIMEOUT_MS ?? 120000),
  approvalSnapshotMaxBytes: Number(process.env.PURCHASING_APPROVAL_SNAPSHOT_MAX_BYTES ?? 65536),
  auditDetailMaxBytes: Number(process.env.PURCHASING_AUDIT_DETAIL_MAX_BYTES ?? 8192),
  transactionTimeoutMs: Number(process.env.PURCHASING_TRANSACTION_TIMEOUT_MS ?? 30000)
};

export default purchasingConfig;

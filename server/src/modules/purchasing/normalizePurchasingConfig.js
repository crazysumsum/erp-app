// [default, maximum]。上限係已測容量或者欄位／JSON 大小限制，config 只可以收緊（設計 §12.1）。
// 數量／單價精度同 6 位 PO／GR 編號綁死 DB 欄位，喺 purchasingConstants.js，唔係 config。
const SETTINGS = Object.freeze({
  maxPurchaseOrderLines: [100, 100],
  maxGoodsReceiptDetails: [200, 200],
  maxQuantity: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  duplicateDeliveryNoteLookbackDays: [90, 366],
  exportMaxRows: [50000, 50000],
  exportTimeoutMs: [120000, 120000],
  approvalSnapshotMaxBytes: [65536, 65536],
  auditDetailMaxBytes: [8192, 8192],
  transactionTimeoutMs: [30000, 2147483647]
});

export function normalizePurchasingConfig(source = {}, { requestTimeoutMs } = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new TypeError("Purchasing config requires the actual HTTP request timeout");
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Purchasing config must be an object");
  }
  for (const name of Object.keys(source)) {
    if (!Object.hasOwn(SETTINGS, name)) throw new Error(`Purchasing config contains unsupported setting "${name}"`);
  }

  const config = {};
  for (const [name, [fallback, maximum]] of Object.entries(SETTINGS)) {
    const value = source[name] === undefined ? fallback : source[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`Purchasing config "${name}" must be an integer from 1 to ${maximum}`);
    }
    config[name] = value;
  }
  // 交易唔可以比開佢嘅 HTTP request 活得耐：client 已經 timeout 而交易仍然 commit，就只剩 TRANSACTION_OUTCOME_UNKNOWN。
  if (config.transactionTimeoutMs > requestTimeoutMs) {
    throw new Error('Purchasing config "transactionTimeoutMs" must not exceed the application request timeout');
  }
  return Object.freeze(config);
}

// [default, maximum]。上限係已測容量或者欄位／JSON 大小限制，config 只可以收緊（設計 §12.1）。
// 數量／單價精度同 6 位 PO／GR 編號綁死 DB 欄位，喺 purchasingConstants.js，唔係 config。
// 冇自己嘅 transactionTimeoutMs（HD-011）：HTTP 路徑嘅交易用 database.transactionTimeoutMs，佢已經有
// 「acquire＋transaction < requestTimeoutMs」嘅跨區塊檢查；§12.1 嘅 30000 會令交易喺 route 504 之後先 commit。
const SETTINGS = Object.freeze({
  maxPurchaseOrderLines: [100, 100],
  maxGoodsReceiptDetails: [200, 200],
  maxQuantity: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  duplicateDeliveryNoteLookbackDays: [90, 366],
  exportMaxRows: [50000, 50000],
  exportTimeoutMs: [120000, 120000],
  approvalSnapshotMaxBytes: [65536, 65536],
  auditDetailMaxBytes: [8192, 8192]
});

export function normalizePurchasingConfig(source = {}) {
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
  return Object.freeze(config);
}

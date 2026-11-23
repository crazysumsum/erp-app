import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/** 設計 §5.7 嘅穩定公開錯誤碼；之後嘅 Task 用到先加，唔預先填晒成張表。 */
export const PURCHASING_ERROR_STATUS = Object.freeze({
  PURCHASING_INPUT_INVALID: 400,
  PURCHASING_QUANTITY_INVALID: 400,
  UOM_CONVERSION_INVALID: 400,
  UNIT_PRICE_INVALID: 400,
  ZERO_PRICE_REASON_REQUIRED: 400,
  PURCHASE_ORDER_NOT_FOUND: 404,
  GOODS_RECEIPT_NOT_FOUND: 404,
  PURCHASING_OPERATION_NOT_FOUND: 404,
  SELF_APPROVAL_DENIED: 403,
  APPROVAL_ASSIGNEE_MISMATCH: 403,
  PO_STATE_CONFLICT: 409,
  PO_APPROVAL_REQUIRED: 409,
  PO_APPROVER_INVALID: 409,
  PO_MASTER_CHANGED: 409,
  VERSION_CONFLICT: 409,
  SUPPLIER_NOT_PURCHASABLE: 409,
  SKU_NOT_PURCHASABLE: 409,
  WAREHOUSE_INVALID: 409,
  BIN_INVALID: 409,
  BIN_WAREHOUSE_MISMATCH: 409,
  GR_STATE_CONFLICT: 409,
  PO_LINE_NOT_RECEIVABLE: 409,
  GR_DETAIL_MISMATCH: 409,
  DUPLICATE_RECEIPT_DIMENSION: 409,
  SUPPLIER_EXCEPTION_REASON_REQUIRED: 409,
  BLOCKED_SUPPLIER_QUARANTINE_REQUIRED: 409,
  SKU_COMMITMENT_REASON_REQUIRED: 409,
  OVER_RECEIPT_REASON_REQUIRED: 409,
  LOT_REQUIRED: 409,
  EXPIRY_REQUIRED: 409,
  LOT_DATA_CONFLICT: 409,
  LOT_EXPIRED: 409,
  MINIMUM_RECEIPT_LIFE_FAILED: 409,
  EXPIRY_OVERRIDE_DENIED: 403,
  DOCUMENT_SEQUENCE_EXHAUSTED: 409,
  PURCHASING_EVENT_CONFLICT: 409,
  CONCURRENT_OPERATION: 409,
  TRANSACTION_OUTCOME_UNKNOWN: 500,
  PURCHASING_DEPENDENCY_UNAVAILABLE: 503
});

const MESSAGES = Object.freeze({
  ZERO_PRICE_REASON_REQUIRED: "單價為零時必須填寫原因",
  PURCHASE_ORDER_NOT_FOUND: "找不到這張採購單",
  PO_STATE_CONFLICT: "採購單目前的狀態不允許這個操作，請重新整理",
  VERSION_CONFLICT: "採購單已被其他人修改，請重新載入後再保存",
  PO_APPROVAL_REQUIRED: "採購單需要審批，目前未能直接確認",
  PO_APPROVER_INVALID: "指定審批人或提交人已不可用，請撤回後重新提交",
  SELF_APPROVAL_DENIED: "不能批准自己提交的採購單",
  APPROVAL_ASSIGNEE_MISMATCH: "只有指定的人員可以處理這個審批",
  PO_MASTER_CHANGED: "主檔的換算或小數位已改變，請重新保存草稿，確認新數字後再提交",
  PURCHASING_DEPENDENCY_UNAVAILABLE: "採購資料暫時不可用，請稍後再試",
  SUPPLIER_NOT_PURCHASABLE: "供應商目前不可用於新採購",
  SKU_NOT_PURCHASABLE: "貨品目前不可用於新採購",
  WAREHOUSE_INVALID: "收貨倉庫目前不可用",
  GOODS_RECEIPT_NOT_FOUND: "找不到這張收貨單",
  PURCHASING_OPERATION_NOT_FOUND: "找不到這個操作的結果；如剛送出，請稍後再查",
  BIN_INVALID: "庫位目前不可使用",
  BIN_WAREHOUSE_MISMATCH: "庫位不屬於指定倉庫",
  GR_STATE_CONFLICT: "收貨單目前的狀態不允許這個操作，請重新整理",
  PO_LINE_NOT_RECEIVABLE: "採購單行不屬於這張採購單或已關閉，不能收貨",
  GR_DETAIL_MISMATCH: "收貨明細的貨品或單位與採購單行不符",
  DUPLICATE_RECEIPT_DIMENSION: "同一採購單行在同一倉庫、庫位、批次及狀態只可有一行明細",
  SUPPLIER_EXCEPTION_REASON_REQUIRED: "供應商目前不是啟用狀態，確認收貨前必須填寫原因",
  BLOCKED_SUPPLIER_QUARANTINE_REQUIRED: "供應商已封鎖，所有收貨明細必須設為隔離",
  SKU_COMMITMENT_REASON_REQUIRED: "貨品資料在採購單確認後已改變，確認收貨前必須填寫原因",
  OVER_RECEIPT_REASON_REQUIRED: "收貨數量超過未收數量，必須填寫超收原因",
  LOT_REQUIRED: "這個貨品必須填寫批號",
  EXPIRY_REQUIRED: "這個貨品必須填寫到期日",
  LOT_DATA_CONFLICT: "批號的生產日期與到期日互相矛盾",
  LOT_EXPIRED: "批次已過期，不能收貨",
  MINIMUM_RECEIPT_LIFE_FAILED: "剩餘效期低於最低收貨效期，需要有權限的人員填寫原因",
  EXPIRY_OVERRIDE_DENIED: "你沒有權限放行低效期收貨",
  DOCUMENT_SEQUENCE_EXHAUSTED: "本月文件編號已用盡，請聯絡系統管理員",
  PURCHASING_EVENT_CONFLICT: "同一操作編號已用於不同內容，請重新整理後再試",
  CONCURRENT_OPERATION: "資料正被其他操作更新，請重新整理後再試",
  TRANSACTION_OUTCOME_UNKNOWN: "未能確認操作結果，請先查詢操作狀態，不要更換操作編號重送"
});

/** `currentVersion` 只用喺 VERSION_CONFLICT（§5.1：只回 currentVersion，唔回其他內容）。 */
export function purchasingError(code, { field, currentVersion } = {}) {
  if (!Object.hasOwn(PURCHASING_ERROR_STATUS, code)) throw new TypeError(`Unknown Purchasing error code: ${code}`);
  return new ApplicationError(code, {
    code,
    statusCode: PURCHASING_ERROR_STATUS[code],
    publicMessage: MESSAGES[code] ?? "採購資料不正確，請檢查輸入",
    publicDetails: field ? { field } : currentVersion ? { currentVersion } : undefined
  });
}

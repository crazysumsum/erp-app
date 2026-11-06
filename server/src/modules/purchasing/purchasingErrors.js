import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/** 設計 §5.7 嘅穩定公開錯誤碼；之後嘅 Task 用到先加，唔預先填晒成張表。 */
export const PURCHASING_ERROR_STATUS = Object.freeze({
  PURCHASING_INPUT_INVALID: 400,
  PURCHASING_QUANTITY_INVALID: 400,
  UOM_CONVERSION_INVALID: 400,
  UNIT_PRICE_INVALID: 400,
  ZERO_PRICE_REASON_REQUIRED: 400,
  PURCHASE_ORDER_NOT_FOUND: 404,
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

import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/** 設計 §5.7 嘅穩定公開錯誤碼；之後嘅 Task 用到先加，唔預先填晒成張表。 */
export const PURCHASING_ERROR_STATUS = Object.freeze({
  PURCHASING_INPUT_INVALID: 400,
  PURCHASING_QUANTITY_INVALID: 400,
  UOM_CONVERSION_INVALID: 400,
  UNIT_PRICE_INVALID: 400,
  DOCUMENT_SEQUENCE_EXHAUSTED: 409,
  PURCHASING_EVENT_CONFLICT: 409,
  CONCURRENT_OPERATION: 409,
  TRANSACTION_OUTCOME_UNKNOWN: 500
});

const MESSAGES = Object.freeze({
  DOCUMENT_SEQUENCE_EXHAUSTED: "本月文件編號已用盡，請聯絡系統管理員",
  PURCHASING_EVENT_CONFLICT: "同一操作編號已用於不同內容，請重新整理後再試",
  CONCURRENT_OPERATION: "資料正被其他操作更新，請重新整理後再試",
  TRANSACTION_OUTCOME_UNKNOWN: "未能確認操作結果，請先查詢操作狀態，不要更換操作編號重送"
});

export function purchasingError(code, { field } = {}) {
  if (!Object.hasOwn(PURCHASING_ERROR_STATUS, code)) throw new TypeError(`Unknown Purchasing error code: ${code}`);
  return new ApplicationError(code, {
    code,
    statusCode: PURCHASING_ERROR_STATUS[code],
    publicMessage: MESSAGES[code] ?? "採購資料不正確，請檢查輸入",
    publicDetails: field ? { field } : undefined
  });
}

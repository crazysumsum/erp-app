import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/** AR 的穩定公開錯誤碼；用到才加。 */
export const AR_ERROR_STATUS = Object.freeze({
  AR_INPUT_INVALID: 400,
  AR_RECEIPT_NOT_FOUND: 404,
  AR_INVOICE_NOT_FOUND: 404,
  AR_ALLOCATION_NOT_FOUND: 404,
  AR_CUSTOMER_NOT_FOUND: 409,
  AR_STATE_CONFLICT: 409,
  AR_PARTY_MISMATCH: 409,
  AR_ALLOCATION_EXCEEDS_OUTSTANDING: 409,
  AR_ALLOCATION_EXCEEDS_AVAILABLE: 409,
  AR_RECEIPT_HAS_ALLOCATIONS: 409,
  AR_EVENT_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  CONCURRENT_OPERATION: 409,
  DOCUMENT_SEQUENCE_EXHAUSTED: 409,
  TRANSACTION_OUTCOME_UNKNOWN: 500
});

const MESSAGES = Object.freeze({
  AR_RECEIPT_NOT_FOUND: "找不到這筆收款",
  AR_INVOICE_NOT_FOUND: "找不到這張發票",
  AR_ALLOCATION_NOT_FOUND: "找不到這筆核銷",
  AR_CUSTOMER_NOT_FOUND: "找不到這個客戶",
  AR_STATE_CONFLICT: "單據目前的狀態不允許這個操作，請重新整理",
  AR_PARTY_MISMATCH: "收款與發票必須是同一客戶及同一幣別",
  AR_ALLOCATION_EXCEEDS_OUTSTANDING: "核銷金額超過發票的未收額",
  AR_ALLOCATION_EXCEEDS_AVAILABLE: "核銷金額超過收款的可核銷額",
  AR_RECEIPT_HAS_ALLOCATIONS: "收款仍有核銷，請先解除核銷再作廢",
  AR_EVENT_CONFLICT: "同一操作編號已用於不同內容，請重新整理後再試",
  VERSION_CONFLICT: "單據已被其他人修改，請重新載入後再操作",
  CONCURRENT_OPERATION: "資料正被其他操作更新，請重新整理後再試",
  DOCUMENT_SEQUENCE_EXHAUSTED: "本年度文件編號已用盡，請聯絡系統管理員",
  TRANSACTION_OUTCOME_UNKNOWN: "未能確認操作結果，請用同一操作編號重送，不要更換操作編號"
});

/** 錯誤只帶欄位路徑或目前版本，不帶用戶送來的值。 */
export function arError(code, { field, currentVersion } = {}) {
  if (!Object.hasOwn(AR_ERROR_STATUS, code)) throw new TypeError(`Unknown AR error code: ${code}`);
  return new ApplicationError(code, {
    code,
    statusCode: AR_ERROR_STATUS[code],
    publicMessage: MESSAGES[code] ?? "應收資料不正確，請檢查輸入",
    publicDetails: field ? { field } : currentVersion ? { currentVersion } : undefined
  });
}

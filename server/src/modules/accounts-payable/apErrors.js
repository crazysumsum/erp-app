import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/** AP 的穩定公開錯誤碼；用到才加。 */
export const AP_ERROR_STATUS = Object.freeze({
  AP_INPUT_INVALID: 400,
  AP_PAYMENT_NOT_FOUND: 404,
  AP_INVOICE_NOT_FOUND: 404,
  AP_ALLOCATION_NOT_FOUND: 404,
  AP_SUPPLIER_NOT_FOUND: 409,
  AP_STATE_CONFLICT: 409,
  AP_PARTY_MISMATCH: 409,
  AP_ALLOCATION_EXCEEDS_OUTSTANDING: 409,
  AP_ALLOCATION_EXCEEDS_AVAILABLE: 409,
  AP_PAYMENT_HAS_ALLOCATIONS: 409,
  AP_INVOICE_HAS_ALLOCATIONS: 409,
  AP_DUPLICATE_SUPPLIER_INVOICE: 409,
  AP_RECEIPT_ALREADY_INVOICED: 409,
  AP_DUE_DATE_REQUIRED: 409,
  AP_INVOICE_TOTAL_MISMATCH: 409,
  AP_PRICE_OVERRIDE_FORBIDDEN: 403,
  AP_DATE_IN_FUTURE: 409,
  AP_EVENT_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  CONCURRENT_OPERATION: 409,
  DOCUMENT_SEQUENCE_EXHAUSTED: 409,
  TRANSACTION_OUTCOME_UNKNOWN: 500
});

const MESSAGES = Object.freeze({
  AP_PAYMENT_NOT_FOUND: "找不到這筆付款",
  AP_INVOICE_NOT_FOUND: "找不到這張發票",
  AP_ALLOCATION_NOT_FOUND: "找不到這筆核銷",
  AP_SUPPLIER_NOT_FOUND: "找不到這個供應商",
  AP_STATE_CONFLICT: "單據目前的狀態不允許這個操作，請重新整理",
  AP_PARTY_MISMATCH: "付款與發票必須是同一供應商及同一幣別",
  AP_ALLOCATION_EXCEEDS_OUTSTANDING: "核銷金額超過發票的未付額",
  AP_ALLOCATION_EXCEEDS_AVAILABLE: "核銷金額超過付款的可核銷額",
  AP_PAYMENT_HAS_ALLOCATIONS: "付款仍有核銷，請先解除核銷再作廢",
  AP_INVOICE_HAS_ALLOCATIONS: "發票仍有核銷，請先解除核銷再作廢",
  AP_DUPLICATE_SUPPLIER_INVOICE: "同一供應商已有使用此號碼的有效應付發票",
  AP_RECEIPT_ALREADY_INVOICED: "所選收貨已在另一張有效的應付發票上",
  AP_DUE_DATE_REQUIRED: "所選來源沒有共同而可計算的付款條款，請輸入到期日",
  AP_INVOICE_TOTAL_MISMATCH: "請輸入供應商發票總額並核對系統計算的總額",
  AP_PRICE_OVERRIDE_FORBIDDEN: "你沒有調整收貨行金額的權限",
  AP_DATE_IN_FUTURE: "業務日期不可在未來",
  AP_EVENT_CONFLICT: "同一操作編號已用於不同內容，請重新整理後再試",
  VERSION_CONFLICT: "單據已被其他人修改，請重新載入後再操作",
  CONCURRENT_OPERATION: "資料正被其他操作更新，請重新整理後再試",
  DOCUMENT_SEQUENCE_EXHAUSTED: "本年度文件編號已用盡，請聯絡系統管理員",
  TRANSACTION_OUTCOME_UNKNOWN: "未能確認操作結果，請用同一操作編號重送，不要更換操作編號"
});

/** 錯誤只帶欄位路徑或目前版本，不帶用戶送來的值。 */
export function apError(code, { field, currentVersion } = {}) {
  if (!Object.hasOwn(AP_ERROR_STATUS, code)) throw new TypeError(`Unknown AP error code: ${code}`);
  return new ApplicationError(code, {
    code,
    statusCode: AP_ERROR_STATUS[code],
    publicMessage: MESSAGES[code] ?? "應付資料不正確，請檢查輸入",
    publicDetails: field ? { field } : currentVersion ? { currentVersion } : undefined
  });
}

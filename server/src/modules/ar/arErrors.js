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
  AR_INVOICE_HAS_ALLOCATIONS: 409,
  AR_OPENING_REFERENCE_EXISTS: 409,
  AR_SHIPMENT_ALREADY_INVOICED: 409,
  AR_DUE_DATE_REQUIRED: 409,
  AR_BILLING_ADDRESS_REQUIRED: 409,
  AR_INVOICE_NOT_PRINTABLE: 409,
  AR_INVOICE_PRINT_SNAPSHOT_MISSING: 409,
  AR_INVOICE_PRINT_SOURCE_MISSING: 409,
  AR_INVOICE_PRINT_COMPANY_NAME_MISSING: 409,
  AR_INVOICE_PRINT_PAYMENT_MISSING: 409,
  AR_DATE_IN_FUTURE: 409,
  AR_INVOICE_BEFORE_SHIPMENT_DATE: 409,
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
  AR_INVOICE_HAS_ALLOCATIONS: "發票仍有核銷，請先解除核銷再作廢",
  AR_OPENING_REFERENCE_EXISTS: "這個舊發票號碼已有一張有效的期初發票",
  AR_SHIPMENT_ALREADY_INVOICED: "所選出貨已在另一張未作廢的發票上",
  AR_DUE_DATE_REQUIRED: "所選出貨沒有可計算到期日的付款條款，請輸入到期日",
  AR_BILLING_ADDRESS_REQUIRED: "請先在客戶資料設定預設帳單地址，再確認這張發票",
  AR_INVOICE_NOT_PRINTABLE: "目前狀態不允許列印此發票",
  AR_INVOICE_PRINT_SNAPSHOT_MISSING: "這張發票確認時尚未保存帳單地址，因此無法列印",
  AR_INVOICE_PRINT_SOURCE_MISSING: "找不到發票的來源單號，請聯絡系統管理員",
  AR_INVOICE_PRINT_COMPANY_NAME_MISSING: "發票的公司名稱尚未設定，請聯絡系統管理員",
  AR_INVOICE_PRINT_PAYMENT_MISSING: "發票的付款資料尚未設定，請聯絡系統管理員",
  AR_DATE_IN_FUTURE: "業務日期不可在未來",
  AR_INVOICE_BEFORE_SHIPMENT_DATE: "發票日期不得早於所選出貨的最晚出貨日",
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

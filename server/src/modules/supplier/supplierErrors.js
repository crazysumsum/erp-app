import { ApplicationError } from "../../framework/errors/ApplicationError.js";

function supplierError(message, { code, statusCode = 400, publicMessage, details } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode,
    publicCode: code,
    publicMessage,
    details,
    publicDetails: details
  });
}

export function invalidSupplierInput(code, publicMessage, details) {
  return supplierError(publicMessage, { code, publicMessage, details });
}

export function supplierNotActivatable(issues) {
  return supplierError("Supplier does not meet activation requirements", {
    code: "SUPPLIER_NOT_ACTIVATABLE",
    statusCode: 422,
    publicMessage: "供應商尚未符合啟用條件",
    details: { issues }
  });
}

/** 403：冇資格，唔係撞到衝突。409 會叫人「重新載入再試」，而嗰個建議永遠唔會成功。 */
export function supplierForbidden(code, publicMessage, details) {
  return supplierError(publicMessage, { code, statusCode: 403, publicMessage, details });
}

export function supplierConflict(code, publicMessage, details) {
  return supplierError(publicMessage, { code, statusCode: 409, publicMessage, details });
}

/**
 * 解密失敗有兩種，設計 §8.3 同 §6 錯誤表俾佢哋兩個唔同答案：
 *
 * - **條 key 唔喺 ring 入面** → 503 `BANK_KEY_UNAVAILABLE`。係運維問題（輪替漏咗一步，或者
 *   有人提早剷咗 key），補返條 key 就好；公開訊息唔可以帶 key ID。
 * - **密文驗證唔過**（竄改、搬錯行、IV／tag 壞咗）→ 500，通用訊息。係資料完整性問題，要查；
 *   唔可以話俾 caller 聽係咩原因。
 *
 * 之前兩者收埋做同一個 422 `BANK_ACCOUNT_UNREADABLE`。嗰個改動係修 REV-035 時做嘅，冇任何
 * 決定紀錄，而設計本身已經用唔同 status 分開咗兩者。TASK-037 驗收 BANK-007 時 FAIL（DEF-026）。
 */
export function supplierBankKeyUnavailable(publicMessage = "這個銀行帳戶目前無法讀取，請聯絡系統管理員") {
  return supplierError("Supplier bank account key is not in the configured ring", {
    code: "BANK_KEY_UNAVAILABLE",
    statusCode: 503,
    publicMessage
  });
}

export function supplierBankIntegrityFailure() {
  return new ApplicationError("Supplier bank account failed its integrity check", {
    code: "BANK_ACCOUNT_INTEGRITY_FAILED",
    statusCode: 500,
    publicCode: "INTERNAL_SERVER_ERROR",
    publicMessage: "Internal server error"
  });
}

export function supplierNotFound(id) {
  return supplierError(`Supplier ${id} was not found`, {
    code: "SUPPLIER_NOT_FOUND",
    statusCode: 404,
    publicMessage: "找不到這個供應商"
  });
}

/**
 * 一個搵唔到嘅審批申請唔係一個搵唔到嘅供應商。Public code 刻意同 supplierNotFound
 * 一樣：兩者對 client 嚟講都係「你要嘅嘢唔喺度」，而加一個新 code 會擴張 6.4 冇
 * 列過嘅 error contract。分別只喺人睇到嗰句。
 */
export function supplierApprovalRequestNotFound(id) {
  return supplierError(`Supplier approval request ${id} was not found`, {
    code: "SUPPLIER_NOT_FOUND",
    statusCode: 404,
    publicMessage: "找不到這個審批申請"
  });
}

export function supplierChildNotFound(childType) {
  const labels = { address: "地址", contact: "聯絡人", identifier: "識別資料", bank: "銀行帳戶" };
  return supplierError(`Supplier ${childType} was not found for this owner`, {
    code: `SUPPLIER_${childType.toUpperCase()}_NOT_FOUND`,
    statusCode: 404,
    publicMessage: `找不到這項供應商${labels[childType] ?? "子資料"}`
  });
}

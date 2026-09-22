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
 * 422：行本身讀唔到 —— 密文驗證唔過，或者佢用嘅 key 唔喺 ring 入面。
 *
 * 呢個唔可以係一個匿名 500。一個 500 淨係話「server 壞咗」，而呢兩件事嘅處理方法
 * 完全唔同：驗證唔過代表資料被人改過，要查；key 唔喺 ring 代表輪替做漏咗一步，要
 * 補返條 key。兩者都唔係 caller 修得到，但佢哋要喺日誌入面分得出。
 */
export function supplierBankUnreadable(publicMessage) {
  return supplierError("Supplier bank account could not be read", {
    code: "BANK_ACCOUNT_UNREADABLE",
    statusCode: 422,
    publicMessage
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

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

export function supplierConflict(code, publicMessage, details) {
  return supplierError(publicMessage, { code, statusCode: 409, publicMessage, details });
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
  const labels = { address: "地址", contact: "聯絡人", identifier: "識別資料" };
  return supplierError(`Supplier ${childType} was not found for this owner`, {
    code: `SUPPLIER_${childType.toUpperCase()}_NOT_FOUND`,
    statusCode: 404,
    publicMessage: `找不到這項供應商${labels[childType] ?? "子資料"}`
  });
}

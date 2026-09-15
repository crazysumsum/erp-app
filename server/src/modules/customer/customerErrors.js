import { ApplicationError } from "../../framework/errors/ApplicationError.js";

function customerError(message, { code, statusCode, publicMessage, publicDetails } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode,
    publicCode: code,
    publicMessage,
    publicDetails
  });
}

export function customerNotFound(id) {
  return customerError(`Customer ${id} was not found`, {
    code: "CUSTOMER_NOT_FOUND",
    statusCode: 404,
    publicMessage: "找不到指定的客戶"
  });
}

export function customerCodeTaken() {
  return customerError("Customer code uniqueness conflict", {
    code: "CUSTOMER_CODE_TAKEN",
    statusCode: 409,
    publicMessage: "客戶代碼已被使用"
  });
}

export function versionConflict(currentVersion) {
  return customerError("Customer version conflict", {
    code: "VERSION_CONFLICT",
    statusCode: 409,
    publicMessage: "資料已被修改，請重新載入後再試",
    publicDetails: { currentVersion: Number(currentVersion) }
  });
}

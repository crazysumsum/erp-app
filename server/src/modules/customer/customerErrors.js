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

export function customerLegalNameTaken() {
  return customerError("Customer legal-name uniqueness conflict", {
    code: "CUSTOMER_LEGAL_NAME_TAKEN",
    statusCode: 409,
    publicMessage: "客戶法定名稱已被使用"
  });
}

export function customerIdempotencyConflict() {
  return customerError("Customer operation idempotency key was reused with a different payload", {
    code: "IDEMPOTENCY_CONFLICT",
    statusCode: 409,
    publicMessage: "此冪等鍵已用於不同的請求內容"
  });
}

export function customerPartyNotFound(type, id) {
  return customerError(`Customer ${type} ${id} was not found for this owner`, {
    code: "CUSTOMER_PARTY_NOT_FOUND",
    statusCode: 404,
    publicMessage: "找不到指定的客戶資料"
  });
}

export function customerPartyInactive() {
  return customerError("Inactive Customer party records require an explicit reactivate command", {
    code: "CUSTOMER_PARTY_INACTIVE",
    statusCode: 409,
    publicMessage: "已停用的資料不能直接修改"
  });
}

export function identifierTaken() {
  return customerError("Customer identifier uniqueness conflict", {
    code: "IDENTIFIER_TAKEN",
    statusCode: 409,
    publicMessage: "此識別資料已被使用"
  });
}

export function creditPolicyInvalid() {
  return customerError("Customer credit policy is invalid", {
    code: "CREDIT_POLICY_INVALID",
    statusCode: 400,
    publicMessage: "信用政策資料無效"
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

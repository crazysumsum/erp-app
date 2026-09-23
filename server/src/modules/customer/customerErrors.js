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

export function customerReferenceNotUsable(field) {
  return customerError(`Customer reference is missing or inactive: ${field}`, {
    code: "CUSTOMER_REFERENCE_NOT_USABLE",
    statusCode: 400,
    publicMessage: "指定的客戶參考資料不存在或未啟用",
    publicDetails: { field }
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

export function customerLookupPurposeInvalid(purpose) {
  return customerError(`Unsupported Customer lookup purpose: ${String(purpose)}`, {
    code: "CUSTOMER_LOOKUP_PURPOSE_INVALID",
    statusCode: 400,
    publicMessage: "不支援的客戶查詢用途"
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

export function customerSettingsMissing() {
  return customerError("Customer settings singleton is missing", {
    code: "CUSTOMER_SETTINGS_MISSING",
    statusCode: 409,
    publicMessage: "客戶設定尚未初始化"
  });
}

export function customerSettingInvalid(code, publicMessage, publicDetails) {
  return customerError("Customer settings input is invalid", {
    code,
    statusCode: 400,
    publicMessage,
    publicDetails
  });
}

export function customerCatalogInvalid(publicDetails) {
  return customerError("Customer catalog input is invalid", { code: "CUSTOMER_CATALOG_INVALID", statusCode: 400, publicMessage: "客戶分類目錄資料無效", publicDetails });
}

export function customerCatalogForbidden() {
  return customerError("Customer catalog inactive values require settings permission", { code: "CUSTOMER_CATALOG_FORBIDDEN", statusCode: 403, publicMessage: "沒有查看停用分類的權限" });
}

export function customerCatalogNotFound() {
  return customerError("Customer catalog entry was not found", { code: "CUSTOMER_CATALOG_NOT_FOUND", statusCode: 404, publicMessage: "找不到指定的客戶分類" });
}

export function customerCatalogTaken() {
  return customerError("Customer catalog code uniqueness conflict", { code: "CUSTOMER_CATALOG_CODE_TAKEN", statusCode: 409, publicMessage: "客戶分類代碼已被使用" });
}

export function customerCatalogStatusInvalid() {
  return customerError("Customer catalog status transition is invalid", { code: "CUSTOMER_CATALOG_STATUS_INVALID", statusCode: 409, publicMessage: "客戶分類目前不能停用" });
}

export function customerApprovalInvalid(code, publicMessage, publicDetails) {
  return customerError("Customer approval input is invalid", { code, statusCode: 400, publicMessage, publicDetails });
}

export function customerApprovalConflict(code, publicMessage, publicDetails) {
  return customerError("Customer approval state conflict", { code, statusCode: 409, publicMessage, publicDetails });
}

export function customerApprovalRequestNotFound(id) {
  return customerError(`Customer approval request ${id} was not found`, {
    code: "CUSTOMER_APPROVAL_REQUEST_NOT_FOUND", statusCode: 404, publicMessage: "找不到指定的客戶審批申請"
  });
}

export function customerLifecycleInvalid(code, publicMessage, publicDetails) {
  return customerError("Customer lifecycle input is invalid", { code, statusCode: 400, publicMessage, publicDetails });
}

export function customerLifecycleConflict(code, publicMessage, publicDetails) {
  return customerError("Customer lifecycle state conflict", { code, statusCode: 409, publicMessage, publicDetails });
}

export function customerBankError(code, statusCode, publicMessage, publicDetails) {
  return customerError("Customer bank operation failed", { code, statusCode, publicMessage, publicDetails });
}

export function customerAttachmentError(code, statusCode, publicMessage, publicDetails) {
  return customerError("Customer attachment operation failed", { code, statusCode, publicMessage, publicDetails });
}

export function customerImportError(code, statusCode, publicMessage, publicDetails) {
  return customerError("Customer import operation failed", { code, statusCode, publicMessage, publicDetails });
}

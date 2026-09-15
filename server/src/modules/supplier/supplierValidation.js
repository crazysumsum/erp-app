import { SUPPLIER_ACTIVATABLE_STATUSES } from "./supplierConstants.js";
import { invalidSupplierInput, supplierNotActivatable } from "./supplierErrors.js";

const WRITABLE_FIELDS = new Set([
  "supplierCode",
  "supplierName",
  "displayName",
  "defaultCurrencyCode",
  "defaultCurrencyVersion",
  "defaultPaymentTermId",
  "defaultPaymentTermVersion",
  "website",
  "generalPhone",
  "generalEmail",
  "notes",
  "activate"
]);

export function assertKnownSupplierFields(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidSupplierInput("SUPPLIER_INPUT_INVALID", "供應商資料格式不正確");
  }
  const unknownFields = Object.keys(input).filter((field) => !WRITABLE_FIELDS.has(field)).sort();
  if (unknownFields.length > 0) {
    throw invalidSupplierInput("SUPPLIER_INPUT_INVALID", "供應商資料包含不支援的欄位", { unknownFields });
  }
  return input;
}

export function assertSupplierActivatable({ supplierCode, supplierName, status, defaultCurrency }) {
  const issues = [];
  if (typeof supplierCode !== "string" || !supplierCode.trim()) {
    issues.push({ field: "supplierCode", code: "SUPPLIER_CODE_REQUIRED", message: "必須填寫 Supplier Code" });
  }
  if (typeof supplierName !== "string" || !supplierName.trim()) {
    issues.push({ field: "supplierName", code: "SUPPLIER_NAME_REQUIRED", message: "必須填寫供應商名稱" });
  }
  if (!defaultCurrency || String(defaultCurrency.status).toLowerCase() !== "active") {
    issues.push({ field: "defaultCurrencyCode", code: "CURRENCY_NOT_ACTIVE", message: "必須選擇有效貨幣" });
  }
  if (!SUPPLIER_ACTIVATABLE_STATUSES.includes(status)) {
    issues.push({ field: "status", code: "STATUS_NOT_ACTIVATABLE", message: "目前狀態不可啟用" });
  }
  if (issues.length > 0) throw supplierNotActivatable(issues);
}

export function supplierCompletenessWarnings(input) {
  const warnings = [];
  if (!input.defaultPaymentTermId) {
    warnings.push({ field: "defaultPaymentTermId", code: "PAYMENT_TERM_MISSING", message: "尚未設定預設付款條款" });
  }
  if (!input.hasOrderingAddress) {
    warnings.push({ field: "addresses", code: "ORDERING_ADDRESS_MISSING", message: "尚未設定採購用途地址" });
  }
  if (!input.hasOrdersContact) {
    warnings.push({ field: "contacts", code: "ORDERS_CONTACT_MISSING", message: "尚未設定訂單用途主要聯絡人" });
  }
  if (!input.hasIdentifier) {
    warnings.push({ field: "identifiers", code: "IDENTIFIER_MISSING", message: "尚未設定供應商識別資料" });
  }
  if (!input.hasBankAccount) {
    warnings.push({ field: "bankAccounts", code: "BANK_ACCOUNT_MISSING", message: "尚未設定銀行帳戶" });
  }
  return warnings;
}

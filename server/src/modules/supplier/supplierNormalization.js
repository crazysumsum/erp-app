import { SUPPLIER_IDENTIFIER_TYPES } from "./supplierConstants.js";
import { invalidSupplierInput } from "./supplierErrors.js";

function containsControl(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function requiredText(value, { field, maxLength, code, publicMessage }) {
  if (typeof value !== "string") throw invalidSupplierInput(code, publicMessage, { field });
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > maxLength || containsControl(trimmed)) {
    throw invalidSupplierInput(code, publicMessage, { field });
  }
  return trimmed;
}

export function normalizeSupplierCode(value) {
  const display = requiredText(value, {
    field: "supplierCode",
    maxLength: 64,
    code: "SUPPLIER_CODE_INVALID",
    publicMessage: "Supplier Code 不可空白、過長或包含控制字元"
  });
  return { value: display, key: display.normalize("NFKC").toLowerCase() };
}

export function normalizeSupplierName(value) {
  const display = requiredText(value, {
    field: "supplierName",
    maxLength: 190,
    code: "SUPPLIER_NAME_INVALID",
    publicMessage: "供應商名稱不可空白、過長或包含控制字元"
  });
  return {
    value: display,
    key: display.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ")
  };
}

export function normalizeIdentifier({ type, issuerCountryCode, value }) {
  const normalizedType = String(type ?? "").trim().toLowerCase();
  if (!SUPPLIER_IDENTIFIER_TYPES.includes(normalizedType)) {
    throw invalidSupplierInput("IDENTIFIER_INVALID", "供應商識別類型不正確", { field: "identifierType" });
  }
  const country = String(issuerCountryCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw invalidSupplierInput("IDENTIFIER_INVALID", "發證國家或地區代碼不正確", { field: "issuerCountryCode" });
  }
  const display = requiredText(value, {
    field: "identifierValue",
    maxLength: 190,
    code: "IDENTIFIER_INVALID",
    publicMessage: "供應商識別值不正確"
  });
  const normalized = display.normalize("NFKC").trim().toUpperCase();
  const key = normalizedType === "other" ? normalized : normalized.replace(/[\s-]+/gu, "");
  return { type: normalizedType, issuerCountryCode: country, value: display, key };
}

export function normalizeContactEmail(value) {
  if (value === null || value === undefined || String(value).trim() === "") return { value: "", key: "" };
  const display = requiredText(String(value), {
    field: "email",
    maxLength: 254,
    code: "EMAIL_INVALID",
    publicMessage: "Email 格式不正確"
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(display)) {
    throw invalidSupplierInput("EMAIL_INVALID", "Email 格式不正確", { field: "email" });
  }
  return { value: display, key: display.toLowerCase() };
}

export function normalizeSupplierUrl(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const display = requiredText(String(value), {
    field: "website",
    maxLength: 500,
    code: "WEBSITE_INVALID",
    publicMessage: "網站網址格式不正確"
  });
  let parsed;
  try {
    parsed = new URL(display);
  } catch {
    throw invalidSupplierInput("WEBSITE_INVALID", "網站網址格式不正確", { field: "website" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidSupplierInput("WEBSITE_INVALID", "網站網址只支援 HTTP 或 HTTPS", { field: "website" });
  }
  return display;
}

export function normalizeSupplierOptionalText(value, { field, maxLength }) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return requiredText(String(value), {
    field,
    maxLength,
    code: "SUPPLIER_FIELD_INVALID",
    publicMessage: "供應商資料不可過長或包含控制字元"
  });
}

/**
 * LIKE 嘅 metacharacter escape。搜尋一個真係含有 `%` 或 `_` 嘅名（例如 "A_B 有限公司"）
 * 唔應該變成萬用字元。呼叫端要配 `ESCAPE '\\\\'`。
 *
 * 由 SupplierAdminService 同 SupplierApprovalService 共用：兩份一模一樣嘅 escape
 * 只會各自漂移。
 */
export function escapeLikeTerm(value) {
  return String(value).replace(/[\\%_]/gu, "\\$&");
}

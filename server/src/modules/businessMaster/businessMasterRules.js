import { invalidBusinessMasterInput } from "./businessMasterErrors.js";
import { ISO_4217_LEGAL_TENDER_CODES } from "./iso4217Snapshot.js";

const PAYMENT_TERM_TYPES = new Set(["IMMEDIATE", "NET_DAYS", "END_OF_MONTH", "MANUAL"]);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function requiredTrimmedText(value, { field, maxLength, code }) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw invalidBusinessMasterInput(code, `${field} 格式不正確`, { field, maxLength });
  }
  return normalized;
}

function optionalTrimmedText(value, { field, maxLength, code }) {
  if (typeof value !== "string") {
    throw invalidBusinessMasterInput(code, `${field} 格式不正確`, { field, maxLength });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw invalidBusinessMasterInput(code, `${field} 不可超過 ${maxLength} 字元`, { field, maxLength });
  }
  return normalized;
}

export function assertCurrencyInput({ code, name, decimalPlaces }) {
  const normalizedCode = typeof code === "string" ? code.trim() : "";
  if (!/^[A-Z]{3}$/.test(normalizedCode) || !ISO_4217_LEGAL_TENDER_CODES.has(normalizedCode)) {
    throw invalidBusinessMasterInput("CURRENCY_CODE_INVALID", "貨幣代碼必須是有效的 ISO 4217 法定貨幣", { field: "code" });
  }
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4) {
    throw invalidBusinessMasterInput("CURRENCY_PRECISION_INVALID", "貨幣小數位必須是 0 至 4 的整數", { field: "decimalPlaces" });
  }
  return {
    code: normalizedCode,
    name: requiredTrimmedText(name, { field: "name", maxLength: 100, code: "CURRENCY_NAME_INVALID" }),
    decimalPlaces
  };
}

export function normalizePaymentTermCode(value) {
  const code = typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase()
    : "";
  if (!code || code.length > 50 || /[\p{Cc}\p{Cf}]/u.test(code)) {
    throw invalidBusinessMasterInput("PAYMENT_TERM_CODE_INVALID", "付款條款代碼格式不正確", { field: "code" });
  }
  return { code, codeKey: code };
}

export function assertPaymentTermRule({ calculationType, dueDays }) {
  if (!PAYMENT_TERM_TYPES.has(calculationType)) {
    throw invalidBusinessMasterInput("PAYMENT_TERM_RULE_INVALID", "付款條款計算規則不正確", { field: "calculationType" });
  }
  if (calculationType === "NET_DAYS") {
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 3650) {
      throw invalidBusinessMasterInput("PAYMENT_TERM_RULE_INVALID", "NET_DAYS 必須提供 0 至 3650 的整數天數", { field: "dueDays" });
    }
  } else if (dueDays !== null) {
    throw invalidBusinessMasterInput("PAYMENT_TERM_RULE_INVALID", "只有 NET_DAYS 可以提供 dueDays", { field: "dueDays" });
  }
  return { calculationType, dueDays };
}

function parseCalendarDate(baseDate) {
  const match = DATE_PATTERN.exec(baseDate);
  if (!match) {
    throw invalidBusinessMasterInput("BASE_DATE_INVALID", "基準日期格式不正確", { field: "baseDate" });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalidBusinessMasterInput("BASE_DATE_INVALID", "基準日期不存在", { field: "baseDate" });
  }
  return date;
}

function formatCalendarDate(date) {
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999 || Number.isNaN(date.getTime())) {
    throw invalidBusinessMasterInput("BASE_DATE_INVALID", "計算後日期超出支援範圍", { field: "baseDate" });
  }
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function calculateDueDate(rule, baseDate) {
  const normalizedRule = assertPaymentTermRule(rule);
  const date = parseCalendarDate(baseDate);
  if (normalizedRule.calculationType === "MANUAL") {
    return { dueDate: null, manual: true };
  }
  if (normalizedRule.calculationType === "NET_DAYS") {
    date.setUTCDate(date.getUTCDate() + normalizedRule.dueDays);
  } else if (normalizedRule.calculationType === "END_OF_MONTH") {
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
  }
  return { dueDate: formatCalendarDate(date), manual: false };
}

export function normalizePaymentTermInput({ code, name, description = "", calculationType, dueDays }) {
  return {
    ...normalizePaymentTermCode(code),
    ...normalizePaymentTermMutableInput({ name, description }),
    ...assertPaymentTermRule({ calculationType, dueDays })
  };
}

export function normalizePaymentTermMutableInput({ name, description = "" }) {
  return {
    name: requiredTrimmedText(name, { field: "name", maxLength: 100, code: "PAYMENT_TERM_NAME_INVALID" }),
    description: optionalTrimmedText(description, { field: "description", maxLength: 500, code: "PAYMENT_TERM_DESCRIPTION_INVALID" })
  };
}

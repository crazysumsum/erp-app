import { purchasingError } from "./purchasingErrors.js";

// 錯誤只帶欄位名，永遠唔帶用戶送嚟嘅值（SEC-014）。
const invalid = (field) => purchasingError("PURCHASING_INPUT_INVALID", { field });

// RFC 9562 形狀、只限小寫：Inventory provider 只收小寫（provider 契約 §2）。
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function positiveId(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(field);
  return value;
}

/** 唔正規化大寫：Idempotency-Key 一定要同 eventId 逐字相同。 */
export function eventId(value) {
  if (typeof value !== "string" || !EVENT_ID.test(value)) throw invalid("eventId");
  return value;
}

/** YYYY-MM-DD 而且係真實日子（2026-02-29 唔得）。 */
export function localDate(value, field) {
  const milliseconds = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? Date.parse(`${value}T00:00:00.000Z`) : Number.NaN;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) throw invalid(field);
  return value;
}

// 按 code point 計長度。多行欄位容許 \t \n \r；其餘 control character 同 lone surrogate 會喺 CSV、列印同
// utf8mb4 出事（SEC-013）。
function text(value, { minimum = 0, maximum, multiline, field }) {
  if (typeof value !== "string" || !value.isWellFormed()) throw invalid(field);
  const characters = [...value];
  if (characters.length < minimum || characters.length > maximum) throw invalid(field);
  for (const character of characters) {
    const code = character.codePointAt(0);
    const whitespace = multiline && (code === 9 || code === 10 || code === 13);
    if ((code < 32 && !whitespace) || code === 127) throw invalid(field);
  }
  return value;
}

/** §5.1：trim 後 5～500 字。 */
export function reason(value, field = "reason") {
  if (typeof value !== "string") throw invalid(field);
  return text(value.trim(), { minimum: 5, maximum: 500, multiline: true, field });
}

export function notes(value = "", field = "notes") {
  return text(value, { maximum: 2000, multiline: true, field });
}

/** Supplier reference 等單行欄位，最多 190 字。 */
export function reference(value = "", field = "reference") {
  return text(value, { maximum: 190, multiline: false, field });
}

/** Allowlist：未列明嘅欄位一律拒絕，所以 client 計嘅 total、快照、status 永遠入唔到嚟（§1.6）。 */
export function onlyFields(value, allowed, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw invalid(field);
  }
  return value;
}

/** 最少一項（BR-007）；上限嚟自已正規化嘅 config。 */
export function requireItems(value, maximum, field) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError("Item cap must be a positive safe integer");
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw invalid(field);
  return value;
}

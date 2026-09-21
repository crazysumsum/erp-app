const CONTROL_CHARACTER_PATTERN = /[\p{Cc}]/u;

export class CustomerNormalizationError extends TypeError {
  constructor(field, message) {
    super(message);
    this.name = "CustomerNormalizationError";
    this.code = "CUSTOMER_NORMALIZATION_INVALID";
    this.field = field;
  }
}

function invalid(field, message) {
  return new CustomerNormalizationError(field, message);
}

function codePointLength(value) {
  return [...value].length;
}

function trimmedText(value, field) {
  if (typeof value !== "string") {
    throw invalid(field, `${field} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw invalid(field, `${field} must not be blank`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    throw invalid(field, `${field} must not contain control characters`);
  }

  return trimmed;
}

function assertLength(value, maxLength, field) {
  if (codePointLength(value) > maxLength) {
    throw invalid(field, `${field} must not exceed ${maxLength} characters`);
  }
}

function normalizedNameKey(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Customer identity normalization is deliberately centralized: UI, CSV and future
 * APIs pass these same display/key pairs to the domain service, while MySQL only
 * enforces equality over the binary key columns.
 */
export function normalizeCustomerCode(value) {
  const displayValue = trimmedText(value, "customerCode");
  const key = displayValue.normalize("NFKC").toLowerCase();
  assertLength(displayValue, 64, "customerCode");
  assertLength(key, 64, "customerCode");
  return { value: displayValue, key };
}

export function normalizeLegalName(value) {
  const displayValue = trimmedText(value, "legalName");
  const key = normalizedNameKey(displayValue);
  assertLength(displayValue, 190, "legalName");
  assertLength(key, 190, "legalName");
  return { value: displayValue, key };
}

export function normalizeTradingName(value) {
  if (typeof value !== "string") {
    throw invalid("tradingName", "tradingName must be a string");
  }

  const displayValue = value.trim();
  if (!displayValue) {
    return { value: "", key: null };
  }
  if (CONTROL_CHARACTER_PATTERN.test(displayValue)) {
    throw invalid("tradingName", "tradingName must not contain control characters");
  }

  const key = normalizedNameKey(displayValue);
  assertLength(displayValue, 190, "tradingName");
  assertLength(key, 190, "tradingName");
  return { value: displayValue, key };
}

/**
 * Identifier type rules are data owned by TASK-008. Until a type explicitly
 * authorizes a separator, this helper only collapses whitespace and never guesses
 * a national format.
 */
export function normalizeIdentifierValue(value, { removableSeparators = [] } = {}) {
  const displayValue = trimmedText(value, "identifierValue");
  let key = displayValue.normalize("NFKC").toUpperCase();

  if (!Array.isArray(removableSeparators) || removableSeparators.some((separator) => !separator)) {
    throw new TypeError("removableSeparators must be an array of non-empty strings");
  }

  for (const separator of removableSeparators) {
    if (typeof separator !== "string") {
      throw new TypeError("removableSeparators must be an array of non-empty strings");
    }
    key = key.split(separator).join("");
  }
  if (removableSeparators.length === 0) {
    key = key.replace(/\s+/gu, " ");
  }

  assertLength(displayValue, 190, "identifierValue");
  assertLength(key, 190, "identifierValue");
  return { value: displayValue, key };
}

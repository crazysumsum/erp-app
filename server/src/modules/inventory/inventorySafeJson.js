const MAX_SUMMARY_BYTES = 8192;

export function inventoryStringHasInvalidCharacters(value, ascii = false) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127 || (ascii && code > 126);
  });
}

export function isInventorySensitiveKey(key) {
  const normalized = String(key).replaceAll(/[_-]/gu, "").toLowerCase();
  return normalized.endsWith("password") ||
    normalized.endsWith("token") ||
    normalized === "authorization" ||
    normalized.endsWith("proof");
}

export function serializeInventorySummary(value, allowedFields, label) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!allowedFields.has(key) || isInventorySensitiveKey(key)) {
      throw new TypeError(`Unsupported ${label} field ${key}`);
    }
    if (fieldValue !== null && typeof fieldValue !== "string" && typeof fieldValue !== "boolean" &&
        !(typeof fieldValue === "number" && Number.isFinite(fieldValue))) {
      throw new TypeError(`${label} field ${key} must be scalar`);
    }
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SUMMARY_BYTES) {
    throw new TypeError(`${label} exceeds ${MAX_SUMMARY_BYTES} bytes`);
  }
  return serialized;
}

export function parseInventorySummary(value, allowedFields, label) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  serializeInventorySummary(parsed, allowedFields, label);
  return parsed;
}

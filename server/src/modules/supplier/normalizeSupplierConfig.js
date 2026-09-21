import {
  revealSecret,
  secretValue
} from "../../framework/configuration/SecretValue.js";

const MAX_FILE_BYTES = 104_857_600;
const MAX_IMPORT_ROWS = 50_000;
const MAX_RETENTION_DAYS = 3_650;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,50}$/;

function positiveInteger(value, name, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > maximum) {
    throw new Error(`Supplier config "${name}" must be a positive integer not exceeding ${maximum}`);
  }
  return number;
}

function hasKeyMaterial(group) {
  return Boolean(
    String(group?.activeKeyId ?? "").trim() ||
      String(group?.keyRing ?? "").trim()
  );
}

function parseKeyRing(value, name) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      throw new Error(`Supplier config "${name}.keyRing" must be a valid JSON object`);
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`Supplier config "${name}.keyRing" must be a valid JSON object`);
  }

  const entries = Object.entries(source);
  if (entries.length === 0) {
    throw new Error(`Supplier config "${name}.keyRing" must contain at least one key`);
  }

  const normalized = {};
  for (const [rawId, rawValue] of entries) {
    const id = String(rawId).trim();
    if (!KEY_ID_PATTERN.test(id)) {
      throw new Error(`Supplier config "${name}.keyRing" contains an invalid key ID`);
    }
    const encoded = revealSecret(rawValue).trim();
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== encoded) {
      throw new Error(`Supplier config "${name}.keyRing.${id}" must decode to exactly 32 bytes`);
    }
    normalized[id] = secretValue(encoded, `Supplier ${name} key ${id}`);
  }
  return Object.freeze(normalized);
}

function normalizeKeyGroup(group, name) {
  const activeKeyId = String(group?.activeKeyId ?? "").trim();
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new Error(`Supplier config "${name}.activeKeyId" is required and invalid`);
  }
  const keyRing = parseKeyRing(group?.keyRing, name);
  if (!Object.hasOwn(keyRing, activeKeyId)) {
    throw new Error(`Supplier config "${name}.activeKeyId" must exist in its keyRing`);
  }
  return Object.freeze({ activeKeyId, keyRing });
}

export function normalizeSupplierConfig(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Supplier config must be an object");
  }

  const hasEncryption = hasKeyMaterial(source.bankEncryption);
  const hasLookup = hasKeyMaterial(source.bankLookup);
  if (hasEncryption !== hasLookup) {
    throw new Error("Supplier config must provide both bankEncryption and bankLookup key rings");
  }

  const duplicateNameThreshold = Number(source.duplicateNameThreshold ?? 0.85);
  if (!Number.isFinite(duplicateNameThreshold) || duplicateNameThreshold < 0.5 || duplicateNameThreshold > 1) {
    throw new Error('Supplier config "duplicateNameThreshold" must be between 0.5 and 1');
  }

  const importSource = source.import ?? {};
  if (!importSource || typeof importSource !== "object" || Array.isArray(importSource)) {
    throw new TypeError('Supplier config "import" must be an object');
  }
  const importConfig = Object.freeze({
    maxFileBytes: positiveInteger(importSource.maxFileBytes ?? 10_485_760, "import.maxFileBytes", MAX_FILE_BYTES),
    maxRows: positiveInteger(importSource.maxRows ?? 10_000, "import.maxRows", MAX_IMPORT_ROWS),
    fileRetentionDays: positiveInteger(importSource.fileRetentionDays ?? 365, "import.fileRetentionDays", MAX_RETENTION_DAYS)
  });

  return Object.freeze({
    bankEncryption: hasEncryption ? normalizeKeyGroup(source.bankEncryption, "bankEncryption") : null,
    bankLookup: hasLookup ? normalizeKeyGroup(source.bankLookup, "bankLookup") : null,
    duplicateNameThreshold,
    import: importConfig
  });
}

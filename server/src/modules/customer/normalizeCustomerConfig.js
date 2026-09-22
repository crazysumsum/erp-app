import { revealSecret, secretValue } from "../../framework/configuration/SecretValue.js";

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function hasMaterial(group) {
  return Boolean(String(group?.activeKeyId ?? "").trim() || String(group?.keyRing ?? "").trim());
}

function parseKeyRing(value, name) {
  let source = value;
  if (typeof source === "string") {
    const rawIds = [...source.matchAll(/"([A-Za-z0-9._-]+)"\s*:/gu)].map((match) => match[1]);
    try {
      source = JSON.parse(source);
    } catch {
      throw new Error(`Customer config "${name}.keyRing" must be a valid JSON object`);
    }
    if (rawIds.length !== Object.keys(source ?? {}).length || new Set(rawIds).size !== rawIds.length) {
      throw new Error(`Customer config "${name}.keyRing" contains an invalid or duplicate key ID`);
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`Customer config "${name}.keyRing" must be a valid JSON object`);
  }
  const entries = Object.entries(source);
  if (entries.length === 0) {
    throw new Error(`Customer config "${name}.keyRing" must contain at least one key`);
  }
  const normalized = {};
  for (const [rawId, rawValue] of entries) {
    const id = String(rawId).trim();
    if (!KEY_ID_PATTERN.test(id) || Object.hasOwn(normalized, id)) {
      throw new Error(`Customer config "${name}.keyRing" contains an invalid or duplicate key ID`);
    }
    const encoded = revealSecret(rawValue).trim();
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== encoded) {
      throw new Error(`Customer config "${name}.keyRing.${id}" must decode to exactly 32 bytes`);
    }
    normalized[id] = secretValue(encoded, `Customer ${name} key ${id}`);
  }
  return Object.freeze(normalized);
}

function normalizeGroup(group, name) {
  const activeKeyId = String(group?.activeKeyId ?? "").trim();
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new Error(`Customer config "${name}.activeKeyId" is required and invalid`);
  }
  const keyRing = parseKeyRing(group?.keyRing, name);
  if (!Object.hasOwn(keyRing, activeKeyId)) {
    throw new Error(`Customer config "${name}.activeKeyId" must exist in its keyRing`);
  }
  return Object.freeze({ activeKeyId, keyRing });
}

export function normalizeCustomerConfig(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Customer config must be an object");
  }
  const encryption = hasMaterial(source.bankEncryption);
  const lookup = hasMaterial(source.bankLookup);
  if (encryption !== lookup) {
    throw new Error("Customer config must provide both bankEncryption and bankLookup key rings");
  }
  const bankEncryption = encryption ? normalizeGroup(source.bankEncryption, "bankEncryption") : null;
  const bankLookup = lookup ? normalizeGroup(source.bankLookup, "bankLookup") : null;
  if (bankEncryption && bankLookup) {
    const encryptionMaterial = new Set(
      Object.values(bankEncryption.keyRing).map((value) => revealSecret(value))
    );
    if (Object.values(bankLookup.keyRing).some((value) => encryptionMaterial.has(revealSecret(value)))) {
      throw new Error("Customer bank encryption and lookup must use independent key material");
    }
  }
  return Object.freeze({ bankEncryption, bankLookup });
}

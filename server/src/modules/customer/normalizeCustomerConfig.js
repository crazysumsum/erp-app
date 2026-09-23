import { revealSecret, secretValue } from "../../framework/configuration/SecretValue.js";
import path from "node:path";

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

function hasAttachmentMaterial(source) {
  return Boolean(source && [source.generalRoot, source.bankSensitiveRoot, source.tempRoot,
    source.maxFileBytes, source.orphanGraceMs, source.malwareScanner?.mode,
    source.malwareScanner?.host, source.malwareScanner?.port, source.malwareScanner?.timeoutMs]
    .some((value) => String(value ?? "").trim()));
}

function positiveInteger(value, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) throw new Error(`Customer config "${name}" must be a positive integer at most ${maximum}`);
  return number;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function normalizeAttachment(source, bankEncryption) {
  if (!hasAttachmentMaterial(source)) return null;
  const roots = ["generalRoot", "bankSensitiveRoot", "tempRoot"].map((name) => {
    const root = String(source?.[name] ?? "").trim();
    if (!root || !path.isAbsolute(root)) throw new Error(`Customer config "attachment.${name}" must be an absolute path`);
    return path.resolve(root);
  });
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (inside(roots[left], roots[right]) || inside(roots[right], roots[left])) {
        throw new Error("Customer attachment roots must be distinct and non-overlapping");
      }
    }
  }
  if (!bankEncryption) throw new Error("Customer attachment capability requires the Customer encryption key ring");
  const scanner = source?.malwareScanner;
  if (String(scanner?.mode ?? "").trim() !== "clamd" || !String(scanner?.host ?? "").trim()) {
    throw new Error("Customer attachment capability requires a clamd malware scanner");
  }
  const timeoutMs = positiveInteger(scanner.timeoutMs, "attachment.malwareScanner.timeoutMs", 15000);
  const orphanGraceMs = positiveInteger(source.orphanGraceMs, "attachment.orphanGraceMs", 24 * 60 * 60 * 1000);
  if (orphanGraceMs <= timeoutMs) {
    throw new Error("Customer config \"attachment.orphanGraceMs\" must exceed the malware scanner timeout");
  }
  return Object.freeze({
    generalRoot: roots[0], bankSensitiveRoot: roots[1], tempRoot: roots[2],
    maxFileBytes: positiveInteger(source.maxFileBytes, "attachment.maxFileBytes", 20 * 1024 * 1024, 20 * 1024 * 1024),
    orphanGraceMs,
    allowedMimeTypes: Object.freeze(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
    malwareScanner: Object.freeze({
      mode: "clamd", host: String(scanner.host).trim(),
      port: positiveInteger(scanner.port, "attachment.malwareScanner.port", 3310, 65535),
      timeoutMs
    })
  });
}

function normalizeImport(source) {
  if (!source || !Object.values(source).some((value) => String(value ?? "").trim())) return null;
  const root = String(source.root ?? "").trim();
  if (!root || !path.isAbsolute(root)) throw new Error('Customer config "import.root" must be an absolute path');
  return Object.freeze({
    root: path.resolve(root),
    maxFileBytes: positiveInteger(source.maxFileBytes, "import.maxFileBytes", 20 * 1024 * 1024, 20 * 1024 * 1024),
    maxRows: positiveInteger(source.maxRows, "import.maxRows", 10_000, 10_000),
    rowBatchSize: positiveInteger(source.rowBatchSize, "import.rowBatchSize", 100, 1000),
    resultRetentionDays: positiveInteger(source.resultRetentionDays, "import.resultRetentionDays", 365, 3650)
  });
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
  const attachment = normalizeAttachment(source.attachment, bankEncryption);
  const customerImport = normalizeImport(source.import);
  if (attachment && customerImport) {
    for (const root of [attachment.generalRoot, attachment.bankSensitiveRoot, attachment.tempRoot]) {
      if (inside(root, customerImport.root) || inside(customerImport.root, root)) {
        throw new Error("Customer import and attachment roots must be distinct and non-overlapping");
      }
    }
  }
  return Object.freeze({ bankEncryption, bankLookup, attachment, import: customerImport });
}

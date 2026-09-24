import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { inspect } from "node:util";

const FULLWIDTH_ASCII = /[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/gu;
const FORMATTING = /[\s\p{Cf}\p{Pd}\u2212._/,\u00b7\u2027:]+/gu;
const INVALID = /[^0-9A-Z]/u;

export function normalizeCustomerBankAccount(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(FULLWIDTH_ASCII, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[a-z]/gu, (char) => char.toUpperCase())
    .replace(FORMATTING, "");
}

function account(value) {
  const normalized = normalizeCustomerBankAccount(value);
  if (!normalized || normalized.length > 512 || INVALID.test(normalized)) {
    throw new TypeError("Customer bank account number is empty, too long or contains unsupported characters");
  }
  return normalized;
}

function key(secret) {
  const value = Buffer.from(secret.reveal(), "base64");
  if (value.length !== 32) throw new TypeError("Customer bank crypto requires 32-byte keys");
  return value;
}

function framed(parts) {
  return Buffer.concat(parts.flatMap((part) => {
    const value = Buffer.from(String(part ?? ""), "utf16le");
    return [Buffer.from(`${value.length}:`, "ascii"), value, Buffer.from("|", "ascii")];
  }));
}

function aad(customerId, cryptoContext) {
  if (!customerId || !cryptoContext) throw new TypeError("Customer bank crypto requires owner and context");
  return framed(["erp-bank", "v1", "customer", customerId, cryptoContext]);
}

function blindMessage({ countryCode = "", bankCode = "", branchCode = "", accountNumber }) {
  return framed([
    String(countryCode).trim().toUpperCase(),
    String(bankCode).trim().toUpperCase(),
    String(branchCode).trim().toUpperCase(),
    account(accountNumber)
  ]);
}

export function maskCustomerBankAccount({ lastFour, accountLength }) {
  const length = Number(accountLength);
  return length <= 4 ? "•".repeat(Math.max(0, length)) : `${"•".repeat(Math.min(8, length - 4))}${lastFour}`;
}

export class CustomerBankCrypto {
  #encryption;
  #lookup;

  constructor({ encryption, lookup } = {}) {
    if (!encryption?.activeKeyId || !encryption?.keyRing || !lookup?.activeKeyId || !lookup?.keyRing) {
      throw new TypeError("CustomerBankCrypto requires encryption and lookup key rings");
    }
    if (!Object.hasOwn(encryption.keyRing, encryption.activeKeyId) ||
        !Object.hasOwn(lookup.keyRing, lookup.activeKeyId)) {
      throw new TypeError("CustomerBankCrypto active keys must exist in their key rings");
    }
    const encryptionKeys = Object.values(encryption.keyRing).map(key);
    const lookupKeys = Object.values(lookup.keyRing).map(key);
    if (lookupKeys.some((lookupKey) => encryptionKeys.some((encryptionKey) => encryptionKey.equals(lookupKey)))) {
      throw new TypeError("Customer bank encryption and lookup require independent key material");
    }
    this.#encryption = encryption;
    this.#lookup = lookup;
    Object.freeze(this);
  }

  newCryptoContext() { return randomUUID(); }

  get activeEncryptionKeyId() { return this.#encryption.activeKeyId; }

  get activeLookupKeyId() { return this.#lookup.activeKeyId; }

  encrypt({ customerId, cryptoContext, accountNumber }) {
    return this.encryptWithKeyId({
      customerId, cryptoContext, accountNumber, encryptionKeyId: this.#encryption.activeKeyId
    });
  }

  encryptWithKeyId({ customerId, cryptoContext, accountNumber, encryptionKeyId }) {
    const normalized = account(accountNumber);
    const secret = this.#encryption.keyRing[String(encryptionKeyId ?? "")];
    if (!secret) throw new Error("Customer bank account encryption key is unavailable");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
    cipher.setAAD(aad(customerId, cryptoContext));
    const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
    return {
      ciphertext,
      iv,
      authTag: cipher.getAuthTag(),
      encryptionKeyId,
      lastFour: normalized.length > 4 ? normalized.slice(-4) : "",
      accountLength: normalized.length
    };
  }

  decrypt({ customerId, cryptoContext, ciphertext, iv, authTag, encryptionKeyId }) {
    const secret = this.#encryption.keyRing[String(encryptionKeyId ?? "")];
    if (!secret) throw new Error("Customer bank account encryption key is unavailable");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv));
      decipher.setAAD(aad(customerId, cryptoContext));
      decipher.setAuthTag(Buffer.from(authTag));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Customer bank account failed authentication");
    }
  }

  blindIndex(input) {
    const keyId = this.#lookup.activeKeyId;
    return { index: this.#index(input, keyId), keyId };
  }

  candidateBlindIndexes(input) {
    const keyIds = Object.keys(this.#lookup.keyRing);
    if (keyIds.length === 0) throw new TypeError("Customer bank lookup key ring is empty");
    return keyIds.map((keyId) => ({ index: this.#index(input, keyId), keyId }));
  }

  issueConfirmationToken({ actorId, customerId, input, expiresAt }) {
    const keyId = this.#lookup.activeKeyId;
    const payload = Buffer.from(JSON.stringify({
      actorId: String(actorId),
      customerId: String(customerId),
      expiresAt: Number(expiresAt),
      scope: this.#index(input, keyId).toString("base64url"),
      keyId
    }), "utf8").toString("base64url");
    const signature = createHmac("sha256", key(this.#lookup.keyRing[keyId]))
      .update(framed(["customer-bank-confirm", payload]))
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  verifyConfirmationToken(token, { actorId, customerId, input, nowMs }) {
    try {
      const [payload, signature, extra] = String(token ?? "").split(".");
      if (!payload || !signature || extra !== undefined) return false;
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      const secret = this.#lookup.keyRing[parsed.keyId];
      if (!secret || parsed.actorId !== String(actorId) || parsed.customerId !== String(customerId) ||
          !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt < Number(nowMs)) return false;
      const expectedScope = this.#index(input, parsed.keyId).toString("base64url");
      if (parsed.scope !== expectedScope) return false;
      const expected = createHmac("sha256", key(secret))
        .update(framed(["customer-bank-confirm", payload]))
        .digest();
      const supplied = Buffer.from(signature, "base64url");
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    } catch {
      return false;
    }
  }

  #index(input, keyId) {
    return createHmac("sha256", key(this.#lookup.keyRing[keyId])).update(blindMessage(input)).digest();
  }

  static sameIndex(left, right) {
    return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
  }

  toJSON() { return "[REDACTED CustomerBankCrypto]"; }

  [inspect.custom]() { return this.toJSON(); }
}

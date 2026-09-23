import { createHash, createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";

import { revealSecret } from "../../framework/configuration/SecretValue.js";
import { customerAttachmentError } from "./customerErrors.js";

function canonical(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function denied() {
  return customerAttachmentError("CUSTOMER_ATTACHMENT_SESSION_INVALID", 403, "附件存取授權已失效，請重新驗證");
}

export class CustomerAttachmentAccessToken {
  constructor({ encryption, time, ttlMs = 60_000 } = {}) {
    const active = encryption?.keyRing?.[encryption?.activeKeyId];
    if (!active || !time?.nowMs) throw new TypeError("CustomerAttachmentAccessToken requires encryption and time");
    this.key = Buffer.from(hkdfSync("sha256", Buffer.from(revealSecret(active), "base64"), Buffer.alloc(0), "customer-attachment-access:v1", 32));
    this.time = time;
    this.ttlMs = ttlMs;
  }

  issue(claims) {
    const expiresAt = this.time.nowMs() + this.ttlMs;
    const payload = Buffer.from(canonical({ ...claims, exp: expiresAt, nonce: randomUUID() }), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.key).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, expiresAt };
  }

  verify(token, expected) {
    const [payload, supplied, extra] = String(token ?? "").split(".");
    if (!payload || !supplied || extra || payload.length > 4096 || supplied.length > 100) throw denied();
    const actual = createHmac("sha256", this.key).update(payload).digest();
    const signature = Buffer.from(supplied, "base64url");
    if (signature.length !== actual.length || !timingSafeEqual(signature, actual)) throw denied();
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
    catch { throw denied(); }
    if (!Number.isSafeInteger(claims.exp) || claims.exp < this.time.nowMs() ||
        Object.entries(expected).some(([key, value]) => String(claims[key]) !== String(value))) throw denied();
    return claims;
  }
}

export function customerAttachmentUploadBinding(input) {
  return createHash("sha256")
    .update("customer-attachment-upload-binding:v1\0")
    .update(canonical({
      contentSha256: String(input.contentSha256 ?? "").toLowerCase(),
      displayName: String(input.displayName ?? "").trim(),
      documentType: String(input.documentType ?? "").trim(),
      mimeType: String(input.mimeType ?? "").toLowerCase().trim(),
      notes: String(input.notes ?? "").trim(),
      originalFilename: String(input.originalFilename ?? "").trim(),
      reason: String(input.reason ?? "").trim(),
      sortOrder: Number(input.sortOrder ?? 0),
      sensitivity: String(input.sensitivity ?? "").trim()
    }))
    .digest("hex");
}

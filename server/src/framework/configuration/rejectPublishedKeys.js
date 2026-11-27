import { createHash } from "node:crypto";

const publishedFingerprints = new Set([
  // JWT literals (CI, test fixtures, deployment examples and historical configuration).
  "388b752bf4007c1c753110042a7100e265ec74cbaaee164163cac2a21204c4c2", // historical server/config/jwt.js
  "4b97187eb87995be55038f5a27ed761de5a390331032c9a97a14b13f4f624264", // Supplier T51 rehearsal
  "5b1ce73454b2db043ffc66f1f211d2245c6f8548ff4083f3ac4b71e690c16392", // JwtService fixture (derived test value)
  "5f12f0e42f0564c9072ef92a3678930de69f6e3f8cd1d5eb93f55293e4134ce9", // CI workflow
  "9e3da1715da618f14085eee2e6a1aab5460390afc7066c907567f158fbbb2b92", // historical server/.env.example
  "f8d78e8c0fb4e5b79920aa683d719364b3e7be1290be0a668e0ad1f315c6a506", // server test environment and JWT fixtures
  "1fd4c27ad9a74bb80ed552a1ff12550c2e474d1f3d2f6e2e3fb4d6c37ea9743d", // historical Supplier T51 rehearsal
  // Decoded bytes of published bank encryption and lookup keys.
  "2af5e0495b7f11b9d90bc327ba78af9b9712dbbf0ab698d54b9128d037034c31",
  "6228cc72b2276c8b8780a15833f0e26d60109d83138edfeb28ef618b8d471b1a",
]);

const bankRingVariables = [
  "SUPPLIER_BANK_ENCRYPTION_KEYS", "SUPPLIER_BANK_LOOKUP_KEYS",
  "CUSTOMER_BANK_ENCRYPTION_KEYS", "CUSTOMER_BANK_LOOKUP_KEYS"
];

function isPublished(value) {
  return publishedFingerprints.has(createHash("sha256").update(value).digest("hex"));
}

function rejectUnsafeKey(variable, value, size) {
  if (!value?.trim()) return;
  const text = value.trim();
  const decoded = Buffer.from(text, "base64");
  const isBankEncoding = decoded.length === 32 && decoded.toString("base64") === text;
  const unsafeBankBytes = isBankEncoding && (isPublished(decoded) || decoded.every(byte => byte === decoded[0]));
  if (isPublished(text) || /^(.)\1+$/su.test(text) || unsafeBankBytes) {
    throw new Error(`${variable} contains a published or repeated-byte key. Generate fresh key material with openssl rand -base64 ${size}.`);
  }
}

// Called only by the production server entry point, before any services are constructed.
export function rejectPublishedKeys(env) {
  rejectUnsafeKey("JWT_SECRET", env.JWT_SECRET, 48);
  for (const variable of bankRingVariables) {
    if (!env[variable]) continue;
    let ring;
    try {
      ring = JSON.parse(env[variable]);
    } catch {
      // The normal configuration validator reports malformed key rings.
      continue;
    }
    for (const value of Object.values(ring ?? {})) {
      if (typeof value !== "string") {
        throw new Error(`${variable} must contain base64 strings. Generate fresh key material with openssl rand -base64 32.`);
      }
      rejectUnsafeKey(variable, value, 32);
    }
  }
}

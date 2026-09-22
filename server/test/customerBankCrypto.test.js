import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";

import { normalizeCustomerConfig } from "../src/modules/customer/normalizeCustomerConfig.js";
import {
  CustomerBankCrypto,
  maskCustomerBankAccount,
  normalizeCustomerBankAccount
} from "../src/modules/customer/CustomerBankCrypto.js";

const ACCOUNT = "GB29NWBK60161331926819";

function buildCrypto({ lookupIds = ["lookup-1"], lookupActive = "lookup-1" } = {}) {
  const encryptionRing = { "enc-1": randomBytes(32).toString("base64") };
  const lookupRing = Object.fromEntries(lookupIds.map((id) => [id, randomBytes(32).toString("base64")]));
  const config = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: encryptionRing },
    bankLookup: { activeKeyId: lookupActive, keyRing: lookupRing }
  });
  return new CustomerBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

test("Customer bank crypto round-trips with random IV and owner/context-bound AAD", () => {
  const crypto = buildCrypto();
  const cryptoContext = crypto.newCryptoContext();
  const first = crypto.encrypt({ customerId: 7, cryptoContext, accountNumber: ACCOUNT });
  const second = crypto.encrypt({ customerId: 7, cryptoContext, accountNumber: ACCOUNT });

  assert.equal(crypto.decrypt({ customerId: 7, cryptoContext, ...first }), ACCOUNT);
  assert.equal(first.encryptionKeyId, "enc-1");
  assert.equal(first.iv.length, 12);
  assert.equal(first.authTag.length, 16);
  assert.ok(!first.iv.equals(second.iv));
  assert.ok(!first.ciphertext.includes(Buffer.from(ACCOUNT)));
  assert.throws(() => crypto.decrypt({ customerId: 8, cryptoContext, ...first }), /failed authentication/);
  assert.throws(() => crypto.decrypt({ customerId: 7, cryptoContext: crypto.newCryptoContext(), ...first }), /failed authentication/);
});

test("Customer bank AAD framing is injective for every JavaScript string", () => {
  const crypto = buildCrypto();
  const sealed = crypto.encrypt({ customerId: "\ud800", cryptoContext: "context", accountNumber: ACCOUNT });
  assert.throws(
    () => crypto.decrypt({ customerId: "\udc00", cryptoContext: "context", ...sealed }),
    /failed authentication/
  );
});

test("Customer bank blind indexes normalize formatting and cover every lookup key", () => {
  const crypto = buildCrypto({ lookupIds: ["lookup-1", "lookup-2"], lookupActive: "lookup-2" });
  const input = { countryCode: "gb", bankCode: "nwbk", branchCode: "", accountNumber: "gb29 nwbk-6016 1331 9268 19" };
  const candidates = crypto.candidateBlindIndexes(input);

  assert.deepEqual(candidates.map(({ keyId }) => keyId).sort(), ["lookup-1", "lookup-2"]);
  assert.ok(CustomerBankCrypto.sameIndex(
    crypto.blindIndex(input).index,
    candidates.find(({ keyId }) => keyId === "lookup-2").index
  ));
  assert.equal(normalizeCustomerBankAccount("１２３４-ａｂｃｄ"), "1234ABCD");
  assert.throws(() => crypto.blindIndex({ ...input, accountNumber: "12②345" }), /unsupported/);
});

test("Customer bank crypto rejects unusable direct key rings and redacts inspection", () => {
  const bad = { reveal: () => "" };
  assert.throws(
    () => new CustomerBankCrypto({
      encryption: { activeKeyId: "enc", keyRing: { enc: bad } },
      lookup: { activeKeyId: "lookup", keyRing: { lookup: bad } }
    }),
    /32-byte keys/
  );
  const reused = randomBytes(32).toString("base64");
  const secret = { reveal: () => reused };
  assert.throws(
    () => new CustomerBankCrypto({
      encryption: { activeKeyId: "enc", keyRing: { enc: secret } },
      lookup: { activeKeyId: "lookup", keyRing: { lookup: secret } }
    }),
    /independent key material/
  );

  const crypto = buildCrypto();
  assert.equal(JSON.stringify(crypto), '"[REDACTED CustomerBankCrypto]"');
  assert.equal(inspect(crypto), "[REDACTED CustomerBankCrypto]");
});

test("Customer bank masking never reveals a complete short account", () => {
  assert.equal(maskCustomerBankAccount({ lastFour: "1234", accountLength: 4 }), "••••");
  assert.equal(maskCustomerBankAccount({ lastFour: "5678", accountLength: 10 }), "••••••5678");
});

test("Customer cross-owner confirmation tokens bind actor, target, normalized scope and expiry", () => {
  const crypto = buildCrypto({ lookupIds: ["lookup-1", "lookup-2"], lookupActive: "lookup-2" });
  const input = { countryCode: "hk", bankCode: "001", branchCode: "002", accountNumber: "1234-5678" };
  const token = crypto.issueConfirmationToken({ actorId: 3, customerId: 7, input, expiresAt: 10_000 });

  assert.equal(crypto.verifyConfirmationToken(token, { actorId: 3, customerId: 7, input, nowMs: 9_999 }), true);
  assert.equal(crypto.verifyConfirmationToken(token, { actorId: 4, customerId: 7, input, nowMs: 9_999 }), false);
  assert.equal(crypto.verifyConfirmationToken(token, { actorId: 3, customerId: 8, input, nowMs: 9_999 }), false);
  assert.equal(crypto.verifyConfirmationToken(token, { actorId: 3, customerId: 7, input: { ...input, branchCode: "003" }, nowMs: 9_999 }), false);
  assert.equal(crypto.verifyConfirmationToken(token, { actorId: 3, customerId: 7, input, nowMs: 10_001 }), false);
  assert.equal(JSON.stringify(token).includes("12345678"), false);
});

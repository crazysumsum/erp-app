import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { inspect } from "node:util";

import { normalizeSupplierConfig } from "../src/modules/supplier/normalizeSupplierConfig.js";
import {
  SupplierBankCrypto,
  maskBankAccount,
  normalizeBankAccountNumber
} from "../src/modules/supplier/SupplierBankCrypto.js";

/**
 * 呢個檔案唔會出現真 key。每次跑都即場產生 —— 一條 commit 咗入 repo 嘅測試 key，
 * 就算註明「僅供測試」，都係一條可以貼去別處用嘅 32 bytes。
 */
const ACCOUNT = "1234567890123";

function ring(ids) {
  return Object.fromEntries(ids.map((id) => [id, randomBytes(32).toString("base64")]));
}

function cryptoWith({ encryptionIds = ["enc-1"], encryptionActive = "enc-1",
                      lookupIds = ["look-1"], lookupActive = "look-1" } = {}) {
  // 刻意行真嘅 normalizeSupplierConfig 而唔係自己砌一個 { activeKeyId, keyRing }：
  // 佢就係生產環境嗰條路，包括 base64 解碼、32 bytes 檢查同 SecretValue 包裝。
  const config = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: encryptionActive, keyRing: JSON.stringify(ring(encryptionIds)) },
    bankLookup: { activeKeyId: lookupActive, keyRing: JSON.stringify(ring(lookupIds)) }
  });
  return new SupplierBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

test("a round trip returns the account, and records the key ID that produced it", () => {
  const crypto = cryptoWith();
  const context = crypto.newCryptoContext();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT });

  assert.equal(sealed.encryptionKeyId, "enc-1");
  assert.equal(sealed.iv.length, 12, "96-bit IV");
  assert.equal(sealed.authTag.length, 16, "128-bit tag");
  assert.equal(sealed.accountLength, ACCOUNT.length);
  assert.equal(sealed.lastFour, "0123");
  assert.ok(!sealed.ciphertext.includes(Buffer.from(ACCOUNT, "utf8")), "the ciphertext must not contain the account");

  assert.equal(crypto.decryptAccountNumber({ supplierId: 7, cryptoContext: context, ...sealed }), ACCOUNT);
});

test("every row gets its own IV, so the same account never encrypts to the same bytes", () => {
  // GCM 重用 IV 唔係「弱少少」，係直接洩漏明文異或值同 authentication key。
  const crypto = cryptoWith();
  const context = crypto.newCryptoContext();
  const first = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT });
  const second = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT });

  assert.ok(!first.iv.equals(second.iv), "a repeated IV under one key breaks GCM outright");
  assert.ok(!first.ciphertext.equals(second.ciphertext));
  assert.notEqual(crypto.newCryptoContext(), crypto.newCryptoContext());
});

test("moving a row to another Supplier makes it undecryptable", () => {
  // AAD 綁 supplierId 就係為咗呢個：攞到資料庫寫入權但攞唔到 key 嘅人，唔可以將
  // A 公司嘅帳號移花接木做 B 公司嘅。
  const crypto = cryptoWith();
  const context = crypto.newCryptoContext();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT });

  assert.throws(
    () => crypto.decryptAccountNumber({ supplierId: 8, cryptoContext: context, ...sealed }),
    /failed authentication/
  );
});

test("swapping the crypto context of two rows under one Supplier also fails", () => {
  const crypto = cryptoWith();
  const mine = crypto.newCryptoContext();
  const theirs = crypto.newCryptoContext();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: mine, accountNumber: ACCOUNT });

  assert.throws(
    () => crypto.decryptAccountNumber({ supplierId: 7, cryptoContext: theirs, ...sealed }),
    /failed authentication/
  );
});

test("the AAD cannot be forged by shifting the boundary between its two parts", () => {
  // 第一版呢個測試用 supplierId 1 / ctx "2x" 對 12 / "x"，而佢**過唔到**變異測試：
  // 有個 `|ctx:` 分隔符號喺中間，所以嗰兩對根本唔會撞。真正嘅碰撞要值本身含住個
  // 分隔符號 —— sup "1|ctx:2" + ctx "3" 同 sup "1" + ctx "2|ctx:3" 喺冇長度前綴嘅
  // 寫法之下，兩邊都係 `sup:1|ctx:2|ctx:3`。
  //
  // 呢兩個輸入今日到唔到：supplierId 係數字，crypto_context 係 server 出嘅 UUID。
  // 所以呢條測試證嘅係個格式本身冇歧義，唔係一條而家行得通嘅攻擊路徑。留住佢係
  // 因為長度前綴真係喺碼入面，而一段冇人測過嘅防禦遲早會俾人「簡化」走。
  const crypto = cryptoWith();
  const sealed = crypto.encryptAccountNumber({
    supplierId: "1|ctx:2", cryptoContext: "3", accountNumber: ACCOUNT
  });
  assert.throws(
    () => crypto.decryptAccountNumber({ supplierId: "1", cryptoContext: "2|ctx:3", ...sealed }),
    /failed authentication/
  );
});

test("tampering with the ciphertext or the tag fails verification", () => {
  const crypto = cryptoWith();
  const context = crypto.newCryptoContext();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT });

  for (const field of ["ciphertext", "authTag", "iv"]) {
    const broken = { ...sealed, [field]: Buffer.from(sealed[field]) };
    broken[field][0] ^= 0x01;
    assert.throws(
      () => crypto.decryptAccountNumber({ supplierId: 7, cryptoContext: context, ...broken }),
      /failed authentication/,
      `a flipped bit in ${field} must not decrypt`
    );
  }
});

test("a row whose key is no longer in the ring is refused, and the error is not an oracle", () => {
  const crypto = cryptoWith();
  const context = crypto.newCryptoContext();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT });

  let thrown = null;
  try {
    crypto.decryptAccountNumber({ supplierId: 7, cryptoContext: context, ...sealed, encryptionKeyId: "gone" });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "an unknown key ID must not be treated as decryptable");
  assert.match(thrown.message, /encryption key is not in the configured ring/);
  // 個訊息唔可以帶住帳號、密文或者 key material —— 錯誤 context 好多時會落日誌。
  assert.ok(!thrown.message.includes(ACCOUNT), "an error must never carry the account");
  assert.ok(!thrown.message.includes(sealed.ciphertext.toString("base64")));
  assert.ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(thrown.message), "no base64 blob may appear in the message");
});

test("rotation: a row encrypted under the old key still decrypts after the active key moves", () => {
  // 輪替要逐行推進、可中斷、可續跑，所以解密要跟**行**記住嘅 key ID，唔係跟
  // active key。呢度用同一套 key material 起兩個 crypto，只係 active 唔同。
  const keys = ring(["enc-1", "enc-2"]);
  const lookup = ring(["look-1"]);
  const build = (active) => {
    const config = normalizeSupplierConfig({
      bankEncryption: { activeKeyId: active, keyRing: JSON.stringify(keys) },
      bankLookup: { activeKeyId: "look-1", keyRing: JSON.stringify(lookup) }
    });
    return new SupplierBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
  };

  const before = build("enc-1");
  const context = before.newCryptoContext();
  const sealed = before.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT });
  assert.equal(sealed.encryptionKeyId, "enc-1");

  const after = build("enc-2");
  assert.equal(after.activeEncryptionKeyId, "enc-2");
  assert.equal(after.decryptAccountNumber({ supplierId: 7, cryptoContext: context, ...sealed }), ACCOUNT,
    "the recorded key ID, not the active one, decides how a row decrypts");
  assert.equal(
    after.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: ACCOUNT }).encryptionKeyId,
    "enc-2",
    "new writes must use the active key only"
  );
});

test("the blind index is keyed, not a plain digest of the account", () => {
  // 帳號嘅可能空間細到可以直接窮舉，所以一個冇 key 嘅 digest 等於明文。呢個係
  // 負面對照：真係計一次 SHA-256 出嚟比，確認個 index 唔係佢。
  const crypto = cryptoWith();
  const { index, keyId } = crypto.blindIndex(ACCOUNT);
  assert.equal(keyId, "look-1");
  assert.equal(index.length, 32);

  const plain = createHash("sha256").update(ACCOUNT, "utf8").digest();
  assert.ok(!index.equals(plain), "a plain SHA-256 of the account is not an acceptable blind index");

  // 另一個實例有另一組 key，所以同一個帳號一定計出唔同嘅 index。
  assert.ok(!cryptoWith().blindIndex(ACCOUNT).index.equals(index), "the index must depend on the key");
});

test("duplicate checking covers the whole lookup ring, not just the active key", () => {
  // 淨係用 active key 查重，換個 key ID 就變成一條繞過重覆檢查嘅路。
  const crypto = cryptoWith({ lookupIds: ["look-1", "look-2", "look-3"], lookupActive: "look-2" });
  const candidates = crypto.candidateBlindIndexes(ACCOUNT);

  assert.deepEqual(candidates.map((candidate) => candidate.keyId).sort(), ["look-1", "look-2", "look-3"]);
  assert.equal(new Set(candidates.map((candidate) => candidate.index.toString("hex"))).size, 3,
    "each key must produce its own index, or the ring would not be doing anything");

  const active = crypto.blindIndex(ACCOUNT);
  assert.equal(active.keyId, "look-2", "a write uses the active key only");
  const match = candidates.find((candidate) => candidate.keyId === "look-2");
  assert.ok(SupplierBankCrypto.sameIndex(match.index, active.index));
});

test("formatting differences in the same account collide, so a duplicate cannot hide behind a space", () => {
  const crypto = cryptoWith();
  const spaced = crypto.blindIndex("1234 5678 9012 3");
  const plain = crypto.blindIndex("1234567890123");
  assert.ok(SupplierBankCrypto.sameIndex(spaced.index, plain.index));

  assert.equal(normalizeBankAccountNumber("１２３４-５６７８"), "12345678", "NFKC and separators");
  assert.equal(normalizeBankAccountNumber("  12 34 5678  "), "12345678");

  // 而一個真係唔同嘅帳號唔可以撞。少咗呢句，一個永遠回同一個常數嘅實作都會過。
  assert.ok(!SupplierBankCrypto.sameIndex(plain.index, crypto.blindIndex("1234567890124").index));
});

test("an empty account is refused by both paths rather than indexed as nothing", () => {
  const crypto = cryptoWith();
  const context = crypto.newCryptoContext();
  for (const value of ["", "   ", "- -"]) {
    assert.throws(() => crypto.blindIndex(value), TypeError);
    assert.throws(
      () => crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: context, accountNumber: value }),
      TypeError
    );
  }
});

test("encryption refuses to proceed without both halves of its AAD", () => {
  const crypto = cryptoWith();
  assert.throws(() => crypto.encryptAccountNumber({ supplierId: 7, accountNumber: ACCOUNT }), TypeError);
  assert.throws(
    () => crypto.encryptAccountNumber({ cryptoContext: crypto.newCryptoContext(), accountNumber: ACCOUNT }),
    TypeError
  );
});

test("a crypto cannot be built from half a configuration", () => {
  // 設計 5.8：寫入同時要產生密文同 blind index，所以只有一半 key 嘅系統應該喺起
  // 嗰陣就死，唔係喺第一個 Bank 寫入先死。
  const config = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: JSON.stringify(ring(["enc-1"])) },
    bankLookup: { activeKeyId: "look-1", keyRing: JSON.stringify(ring(["look-1"])) }
  });
  assert.throws(() => new SupplierBankCrypto({ encryption: config.bankEncryption }), TypeError);
  assert.throws(() => new SupplierBankCrypto({ lookup: config.bankLookup }), TypeError);
  assert.throws(() => new SupplierBankCrypto(), TypeError);
});

test("masking never reveals a short account, and never needs the ciphertext", () => {
  // 一個四位嘅帳號，佢個「尾四位」就係成個帳號。
  assert.equal(maskBankAccount({ lastFour: "", accountLength: 4 }), "****");
  assert.equal(maskBankAccount({ lastFour: "", accountLength: 1 }), "*");
  assert.equal(maskBankAccount({ lastFour: "0123", accountLength: 13 }), "*********0123");
  assert.equal(maskBankAccount({ lastFour: "", accountLength: 0 }), "");

  // 即使有人錯手將一個短帳號嘅全值放咗入 lastFour，遮罩都唔可以原樣吐返出嚟。
  assert.equal(maskBankAccount({ lastFour: "1234", accountLength: 4 }), "****");
});

test("the crypto redacts itself, so logging one cannot leak a key", () => {
  // 一個 console.log(service) 或者一個將整個 service 寫落 error context 嘅 logger,
  // 唔應該係洩漏 key 嘅路。
  const crypto = cryptoWith();
  assert.equal(JSON.stringify(crypto), '"[REDACTED SupplierBankCrypto]"');
  const shown = inspect(crypto, { depth: 10 });
  assert.match(shown, /REDACTED/);
  assert.ok(!shown.includes("enc-1") && !shown.includes("look-1"), "not even the key IDs' ring should print");
  assert.ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(shown), "no base64 key material may appear");
});

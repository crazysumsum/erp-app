import { createDecipheriv, createCipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { inspect } from "node:util";

/**
 * Bank 帳號嘅加密同查重。設計說明見 docs/supplier_management/03_design_spec.md §5.8。
 *
 * 呢個檔案只用 Node 標準 primitive（AES-256-GCM、HMAC-SHA-256），冇自行設計任何
 * 演算法。唯一自訂嘅嘢係 AAD 同 blind-index message 嘅格式字串，而佢哋刻意寫到
 * 冇歧義（見下面各自嘅註解）。
 *
 * 兩組 key ring 係分開嘅，唔係同一條 key 用兩次：
 *
 *   - encryption ring 加密／解密帳號本身。
 *   - lookup ring 計 blind index，用嚟查重。
 *
 * 分開係因為佢哋輪替嘅代價唔同。換 encryption key 要重新加密每一行；換 lookup key
 * 要重算每一行嘅 index。兩者共用一條 key 就會令任何一邊嘅輪替都變成兩邊一齊做。
 *
 * 每一行都記住自己用邊個 key ID 加密同計 index，所以輪替可以逐行推進、可以中斷、
 * 可以續跑 —— 冇一個「全部行完先生效」嘅時刻。
 */

// 設計 5.8：帳號加密之前要正規化，否則「1234 5678」同「12345678」會計出兩個唔同
// 嘅 blind index，即係同一個帳號輸入兩次都查唔到重。NFKC 收窄全形數字等變體；
// 空白同常見分隔符號一律移除，因為佢哋喺帳號入面係排版，唔係資料。
const SEPARATORS = /[\s\u00a0\u2000-\u200b\u2060\ufeff-]+/gu;

export function normalizeBankAccountNumber(value) {
  const text = String(value ?? "").normalize("NFKC").replace(SEPARATORS, "");
  return text;
}

/**
 * 設計 5.8：短帳號唔可以用「尾四位」嚟遮 —— 一個四位嘅帳號，佢個尾四位就係成個
 * 帳號。所以長度 <= 4 全部星號，而 projection 亦都唔可以就咁輸出 last_four。
 *
 * 呢個函式**唔會**接觸密文或者 key：佢只係用已經存低嘅長度同尾碼砌一個顯示值，
 * 所以 masked list 唔使解密任何嘢。
 */
export function maskBankAccount({ lastFour, accountLength }) {
  const length = Number(accountLength);
  if (!Number.isInteger(length) || length <= 0) return "";
  if (length <= 4) return "*".repeat(length);
  const suffix = String(lastFour ?? "");
  return `${"*".repeat(length - suffix.length)}${suffix}`;
}

/**
 * AAD 綁住 supplierId 同 crypto_context 兩樣。
 *
 * 綁 supplierId：一行密文搬去另一個 Supplier 之下就解唔開 —— 一個攞到資料庫寫入
 * 權但攞唔到 key 嘅人，唔可以將 A 公司嘅帳號移花接木做 B 公司嘅。
 * 綁 crypto_context：同一個 Supplier 之內，兩行之間亦都唔可以對調密文。
 *
 * 格式用長度前綴而唔係單純夾個分隔符號：`supplier:1|ctx:2x` 同 `supplier:1|ctx:2` 加
 * 一個 `x` 喺第二段，喺純分隔符號嘅寫法入面係同一串 bytes。crypto_context 係
 * server 產生嘅 UUID 所以今日撞唔到，但個格式唔應該靠嗰個巧合。
 */
function additionalData({ supplierId, cryptoContext }) {
  const supplier = String(supplierId ?? "");
  const context = String(cryptoContext ?? "");
  if (!supplier || !context) {
    throw new TypeError("Supplier bank crypto requires both supplierId and cryptoContext for its AAD");
  }
  return Buffer.from(`sup:${supplier.length}:${supplier}|ctx:${context.length}:${context}`, "utf8");
}

function keyBuffer(secret) {
  // normalizeSupplierConfig 已經驗過每條 key 都 decode 到啱啱 32 bytes，所以呢度
  // 唔重複驗長度；佢驗唔到嘅嘢呢度亦都驗唔到。
  return Buffer.from(secret.reveal(), "base64");
}

const REDACTED = "[REDACTED SupplierBankCrypto]";

export class SupplierBankCrypto {
  #encryption;
  #lookup;

  /**
   * `encryption` 同 `lookup` 係 normalizeSupplierConfig 出嚟嗰兩組
   * `{ activeKeyId, keyRing }`。兩組都係必需：設計 5.8 要求寫入同時產生密文同
   * blind index，所以只有一半 key 嘅系統唔應該起得成一個 crypto，佢應該喺啟動時
   * 就死 —— normalizeSupplierConfig 已經喺只有一邊嘅時候拋錯。
   */
  constructor({ encryption, lookup } = {}) {
    if (!encryption?.activeKeyId || !encryption?.keyRing || !lookup?.activeKeyId || !lookup?.keyRing) {
      throw new TypeError("SupplierBankCrypto requires both the bankEncryption and bankLookup key rings");
    }
    this.#encryption = encryption;
    this.#lookup = lookup;
    Object.freeze(this);
  }

  /** 每行一個，加密之前由 server 產生，之後唔再改。 */
  newCryptoContext() {
    return randomUUID();
  }

  get activeEncryptionKeyId() {
    return this.#encryption.activeKeyId;
  }

  get activeLookupKeyId() {
    return this.#lookup.activeKeyId;
  }

  /**
   * 加密一個帳號。IV 每次隨機 96-bit —— GCM 喺同一條 key 之下重用 IV 會直接洩漏
   * 明文異或值同埋 authentication key，所以呢度唔可以用 counter 或者由資料衍生。
   */
  encryptAccountNumber({ supplierId, cryptoContext, accountNumber }) {
    const normalized = normalizeBankAccountNumber(accountNumber);
    if (!normalized) {
      throw new TypeError("Supplier bank crypto cannot encrypt an empty account number");
    }
    const keyId = this.#encryption.activeKeyId;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBuffer(this.#encryption.keyRing[keyId]), iv);
    cipher.setAAD(additionalData({ supplierId, cryptoContext }));
    const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
    return {
      ciphertext,
      iv,
      authTag: cipher.getAuthTag(),
      encryptionKeyId: keyId,
      lastFour: normalized.length > 4 ? normalized.slice(-4) : "",
      accountLength: normalized.length
    };
  }

  /**
   * 解密。`encryptionKeyId` 由行本身嚟，唔係由 active key 嚟 —— 輪替途中兩者唔同，
   * 而用 active key 去解一行舊密文只會得到一個 auth 失敗。
   *
   * 錯誤訊息刻意唔帶任何輸入：一個講出「邊一段 tag 唔啱」嘅訊息就係一個 oracle。
   */
  decryptAccountNumber({ supplierId, cryptoContext, ciphertext, iv, authTag, encryptionKeyId }) {
    const secret = this.#encryption.keyRing[String(encryptionKeyId ?? "")];
    if (!secret) {
      throw new Error("Supplier bank account cannot be decrypted: its encryption key is not in the configured ring");
    }
    const decipher = createDecipheriv("aes-256-gcm", keyBuffer(secret), Buffer.from(iv));
    decipher.setAAD(additionalData({ supplierId, cryptoContext }));
    decipher.setAuthTag(Buffer.from(authTag));
    try {
      return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString("utf8");
    } catch {
      // GCM 嘅 final() 喺 tag 對唔上嗰陣拋錯。原錯誤唔會向上傳：佢帶住 OpenSSL 嘅
      // 內部細節，而呢度只需要講一件事 —— 呢行嘢驗證唔過。
      throw new Error("Supplier bank account failed authentication: the row, its context or its ciphertext was altered");
    }
  }

  /**
   * 寫入用嘅 blind index：只用 active lookup key，並且回埋個 key ID 俾行記住。
   *
   * 用 HMAC 而唔係一般 SHA-256：帳號嘅可能空間細到可以直接窮舉，所以一個冇 key
   * 嘅 digest 等於明文。設計 5.8 明文要求「一般 SHA-256 不處理帳號」。
   */
  blindIndex(accountNumber) {
    const keyId = this.#lookup.activeKeyId;
    return { index: this.#index(accountNumber, keyId), keyId };
  }

  /**
   * 查重用：ring 入面每條 key 各計一個 index。
   *
   * 淨係用 active key 查重係會漏嘅 —— 輪替途中，同一個帳號喺舊 key 之下計出嚟嘅
   * index 同新 key 嘅唔同，所以「換咗 key ID」就會變成一條繞過重覆檢查嘅路。設計
   * 5.8 就係為咗堵住呢個而要求用晒成個 ring 查。
   */
  candidateBlindIndexes(accountNumber) {
    return Object.keys(this.#lookup.keyRing).map((keyId) => ({
      index: this.#index(accountNumber, keyId),
      keyId
    }));
  }

  /** 兩個 index 比較用常數時間，唔用 Buffer.equals 以外嘅短路比較。 */
  static sameIndex(left, right) {
    const a = Buffer.from(left ?? []);
    const b = Buffer.from(right ?? []);
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  }

  #index(accountNumber, keyId) {
    const normalized = normalizeBankAccountNumber(accountNumber);
    if (!normalized) {
      throw new TypeError("Supplier bank crypto cannot index an empty account number");
    }
    return createHmac("sha256", keyBuffer(this.#lookup.keyRing[keyId])).update(normalized, "utf8").digest();
  }

  // 兩組 ring 喺 private field 入面，所以 JSON.stringify 本來就攞唔到。呢兩個係
  // 為咗 util.inspect 同字串化：一個 console.log(crypto) 或者一個把 service 整個
  // 寫落 error context 嘅 logger，都唔應該係洩漏 key 嘅路。
  [inspect.custom]() {
    return REDACTED;
  }

  toJSON() {
    return REDACTED;
  }
}

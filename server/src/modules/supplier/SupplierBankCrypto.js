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

/**
 * 設計 5.8：帳號加密之前要正規化，否則「1234 5678」同「12345678」會計出兩個唔同嘅
 * blind index，即係同一個帳號輸入兩次都查唔到重。
 *
 * 用**白名單**（只保留 [0-9A-Z]），唔用「移除分隔符號」嘅黑名單。REV-033 H-1 就係
 * 黑名單嘅代價：原本嗰個字元類只覆蓋空白同 ASCII 連字號，reviewer 試十六個字元，
 * 十個繞得過 —— 包括 `.` `/` `_` `,`、三種 Unicode 連字號變體，同埋兩個**隱形**
 * 字元（U+00AD 軟連字號、U+200E LRM）。最後嗰兩個最麻煩：兩行帳號喺畫面上、喺遮罩
 * 之後都一模一樣，但 blind index 唔同，所以 UNIQUE 唔會擋，而 operator 見到同一個
 * 帳號出現兩次而冇任何解釋。一個黑名單下次一樣會漏。
 *
 * 白名單成立係因為帳號本身就係字母數字：IBAN 明文定義成 [0-9A-Z]，而本地帳號號碼
 * 係純數字。任何其他字元喺一個打入嚟嘅帳號入面都係排版。轉大寫係因為 IBAN 嘅字母
 * 部分唔分大小寫 —— `gb29` 同 `GB29` 係同一個帳號。
 *
 * Product Owner 2026-09-21 揀咗呢個做法（HD-028）。改呢條規則唔係改一個函式：正規化
 * 之後嘅字串就係被加密、被 HMAC、被攞去計 last_four 同 account_length 嗰個，所以有咗
 * 行之後再改，就要成張表解密、重新加密、重算 index。
 */
const ACCOUNT_DISALLOWED = /[^0-9A-Z]/gu;

// 上限由欄位闊度嚟，唔係由一個對帳號格式嘅猜測嚟。GCM 係串流模式，密文長度等於
// 明文 byte 數，而正規化之後全部係 ASCII，所以 512 個字元啱啱好填滿
// VARBINARY(512)。REV-033 M-6：喺 STRICT_TRANS_TABLES 之下超長會 ER_DATA_TOO_LONG
// fail closed，但喺非嚴格 sql_mode 之下會靜靜哋截短，而一行截短咗嘅密文永遠驗證
// 唔到。業務層面嘅長度規則（IBAN 最長 34）屬於 domain service，唔喺呢度。
const MAX_ACCOUNT_LENGTH = 512;

export function normalizeBankAccountNumber(value) {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(ACCOUNT_DISALLOWED, "");
}

function requireAccount(value, what) {
  const normalized = normalizeBankAccountNumber(value);
  if (!normalized) {
    throw new TypeError(`Supplier bank crypto cannot ${what} an empty account number`);
  }
  if (normalized.length > MAX_ACCOUNT_LENGTH) {
    throw new TypeError(`Supplier bank crypto cannot ${what} an account number longer than ${MAX_ACCOUNT_LENGTH} characters`);
  }
  return normalized;
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
  // REV-033 L-1／REV-034 L-1：一行 last_four 長過 account_length 嘅資料唔應該令一個
  // 讀路徑爆 RangeError —— 但「fail safe」對一個遮罩函式嚟講係遮**多啲**，唔係遮少
  // 啲。第一版用 Math.max 加 slice，結果 {lastFour:"123456", accountLength:5} 會回
  // 五個字元零粒星，即係一行壞資料反而漏得更多。呢種情況全部遮。
  if (suffix.length >= length) return "*".repeat(length);
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
  // 兩件事令呢個編碼 injective。
  //
  // 一：長度前綴數 byte，唔數 String.length，所以邊界移唔到。
  // 二：用 **UTF-16LE** 而唔係 UTF-8 編碼兩個身分。UTF-8 唔係 lossless —— 佢將每個
  //     孤兒代理碼位 map 成同一串 EF BF BD，所以 `"\uD800"` 同 `"\uDC00"` 編碼之後
  //     完全一樣，兩個唔同身分砌得出同一個 AAD，而長度前綴救唔到（兩邊都係 3 bytes）。
  //     REV-033 M-1 實測到跨身分解密成功。UTF-16LE 對任何 JS 字串都係一對一。
  //
  // 呢兩個輸入今日到唔到（supplierId 係 BIGINT，crypto_context 係 server 出嘅 UUID），
  // 但一個 AAD 編碼應該本身 injective，唔應該靠 call site 嘅巧合。
  const supplierBytes = Buffer.from(supplier, "utf16le");
  const contextBytes = Buffer.from(context, "utf16le");
  return Buffer.concat([
    Buffer.from(`sup:${supplierBytes.length}:`, "utf8"), supplierBytes,
    Buffer.from(`|ctx:${contextBytes.length}:`, "utf8"), contextBytes
  ]);
}

const KEY_BYTES = 32;

function keyBuffer(secret) {
  const key = Buffer.from(secret.reveal(), "base64");
  // REV-033 M-2：之前呢度靠 normalizeSupplierConfig 驗過長度。嗰句對**設定**嗰條路
  // 啱，但 constructor 收任何 { activeKeyId, keyRing } 形狀而唔重新驗證。而兩條路
  // 嘅失敗方向唔同：createCipheriv 幫 AES-256 擋住短 key，createHmac 乜長度都收，
  // 包括零 —— 即係加密 fail closed 而 blind index fail open。實測過一條 0-byte key
  // 計得出 index。呢度係兩條路唯一嘅交匯點，所以驗證放喺呢度。
  if (key.length !== KEY_BYTES) {
    throw new TypeError(`Supplier bank crypto requires a ${KEY_BYTES}-byte key`);
  }
  return key;
}

const INDEX_BYTES = 32;
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
    const normalized = requireAccount(accountNumber, "encrypt");
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
    // REV-033 M-3：呢三句本來喺 try 外面，所以一個截短咗嘅 tag 或者一個 NULL IV 會
    // 用原始 TypeError（ERR_CRYPTO_INVALID_AUTH_TAG／ERR_INVALID_ARG_TYPE）穿出去，
    // 即係失敗類別分得出，而一個 raw TypeError 過咗安全邊界之後上游會 render 成
    // 帶 stack 嘅 500。統一喺同一句訊息死。
    try {
      const decipher = createDecipheriv("aes-256-gcm", keyBuffer(secret), Buffer.from(iv));
      decipher.setAAD(additionalData({ supplierId, cryptoContext }));
      decipher.setAuthTag(Buffer.from(authTag));
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
    const keyIds = Object.keys(this.#lookup.keyRing);
    // REV-033 L-2：一個空清單會令查重揾唔到任何 candidate，即係每個寫入睇落都唔
    // 重覆。一個重覆控制嘅失敗方向唔可以係 open。
    if (keyIds.length === 0) {
      throw new TypeError("Supplier bank crypto cannot check for duplicates with an empty lookup ring");
    }
    return keyIds.map((keyId) => ({ index: this.#index(accountNumber, keyId), keyId }));
  }

  /** 兩個 index 比較用常數時間，唔用 Buffer.equals 以外嘅短路比較。 */
  static sameIndex(left, right) {
    // REV-033 L-3：只收 Buffer。Buffer.from 會靜靜哋收字串，所以之前
    // sameIndex("abc", Buffer.from("abc")) 係 true —— 一個比較函式唔應該自己決定
    // 兩種唔同型別嘅嘢算唔算同一樣嘢。長度固定 32，所以長度檢查唔洩漏任何嘢。
    if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right)) return false;
    if (left.length !== INDEX_BYTES || right.length !== INDEX_BYTES) return false;
    return timingSafeEqual(left, right);
  }

  #index(accountNumber, keyId) {
    const normalized = requireAccount(accountNumber, "index");
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

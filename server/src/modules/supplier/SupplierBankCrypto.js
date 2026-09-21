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
 * 分兩步，而兩步嘅**失敗方向唔同**（DEF-021／HD-029）：
 *
 *   1. 排版字元剝走。設計 §6.6 個 create 範例就係 `"123-456789-001"`，所以呢步
 *      唔係方便，係必須。
 *   2. 剝完之後仲有任何非 [0-9A-Z] 嘅嘢，**拒絕**，唔改寫。
 *
 * ## 點解唔用 NFKC（REV-035 H-2）
 *
 * 第一版喺分類之前行 `NFKC`，而嗰個係一個洞：NFKC 係**相容性**折疊，佢會將一大堆
 * 內容字元變成純 [0-9A-Z]，於是佢哋喺第二步望落好似冇問題咁過咗。實測 U+0080 到
 * U+1FFFF 有 **1225 個碼位**係咁：
 *
 *     "12²345"   -> "122345"     多咗一個數字
 *     "1②345"    -> "12345"      圈住嘅 2 變成普通 2
 *     "ᴮ12345"   -> "B12345"     同 "B12345" 撞成同一個帳號
 *     "Ⓑ12345"   -> "B12345"     同上
 *     "ß…"       -> "SS…"        仲要變長
 *
 * 即係話 REV-034 M-2 嗰個「三個唔同輸入存成同一個帳號」根本冇收到 —— 佢只係由
 * `Å`／`Ä` 呢批搬咗去 `ᴮ`／`Ⓑ` 呢批。而 HD-029 揀嗰個做法嘅**全部理由**就係「列唔到
 * 嘅字元會大聲拒絕」，NFKC 令嗰 1225 個 fail open，正正係相反。
 *
 * 所以而家：`NFC`（只做標準組合，唔做相容性折疊），再**明確**折疊全形 ASCII 嗰三
 * 段，其餘一律去到第二步。全形數字同字母係同一個字元嘅另一個闊度，折疊佢哋係
 * 「同一個帳號」；上標、圈字、連字係**第二個字元**，唔係另一個闊度。
 *
 * 全域掃描（U+0080–U+1FFFF）之後淨低兩個會被折疊嘅碼位，兩個都係**標準等價**，
 * 即係 Unicode 定義佢哋同目標字元本來就係同一個字元 —— 呢個正正係要嘅，兩種寫法
 * 唔應該變成兩個帳號。記低係為咗下一個 reviewer 唔使再推一次：
 *   - U+0387 GREEK ANO TELEIA 標準等價於 U+00B7 MIDDLE DOT（分隔符號，剝走）
 *   - U+212A KELVIN SIGN 標準等價於 U+004B `K`（內容，保留）
 *
 * 一併更正一個記錄錯誤：第一版嘅註解、實作報告同 HD-029 嘅問題描述都用咗 `½ → 12`
 * 做例子。嗰個例子**唔成立** —— `½` 喺 NFKC 之下變 `1⁄2`，而 U+2044 FRACTION SLASH
 * 係 Sm，唔喺排版集合入面，所以佢一直都係被拒絕嗰邊。真正會漏嘅係上面嗰批。
 */

// 全形 ASCII：數字、大寫、細寫。減 0xFEE0 就係佢哋對應嘅 ASCII。
const FULLWIDTH_ASCII = /[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/gu;

// 空白、Unicode 格式／隱形字元（Cf：U+00AD 軟連字號、U+200E LRM、U+FEFF BOM）、
// Unicode 連字號（Pd，包括全形 U+FF0D）、以及印刷帳號上常見嘅分隔符號。
// U+2212 MINUS SIGN 係 Sm 唔係 Pd，所以要明寫。
const FORMATTING = /[\s\p{Cf}\p{Pd}\u2212._/,\u00b7\u2027:]+/gu;
const DISALLOWED = /[^0-9A-Z]/u;
const MAX_ACCOUNT_LENGTH = 512;

/** 第一步：折疊闊度、剝走排版。呢個函式**唔會**拒絕任何嘢 —— 驗證喺下面。 */
export function normalizeBankAccountNumber(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(FULLWIDTH_ASCII, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    // 轉大寫**只限 ASCII a-z**。`String.prototype.toUpperCase` 唔係一對一：`ß` 會變
    // 做 `SS`，即係一個內容字元自己漂白成兩個合法字元，然後過埋第二步 —— 同 NFKC
    // 嗰個洞一模一樣，只係經另一條路。全域掃描落去，呢個係 NFKC 修好之後淨低嘅唯一
    // 一個。IBAN 嘅字母部分唔分大小寫，而嗰啲字母本來就係 ASCII。
    .replace(/[a-z]/gu, (char) => char.toUpperCase())
    .replace(FORMATTING, "");
}

export const BANK_ACCOUNT_EMPTY = "EMPTY";
export const BANK_ACCOUNT_UNREPRESENTABLE = "UNREPRESENTABLE";
export const BANK_ACCOUNT_TOO_LONG = "TOO_LONG";

/**
 * 第二步：分類。回一個 reason 或者 null，唔拋錯 —— 因為**邊個層拋咩錯**係重要嘅。
 *
 * REV-035 H-1：第一版喺呢度直接拋 `TypeError`，而佢係喺 `withTransaction` 入面拋，
 * 所以真嘅 database wrapper 會將佢重新包成 `DATABASE_TRANSACTION_FAILED` —— 使用者
 * 收到一個 500。而 HD-029 揀呢個做法嘅理由係「用戶見到、改得到」，一個 500 兩樣都
 * 唔係。所以而家由 service 喺開交易之前叫呢個函式，自己拋一個 400。
 *
 * `requireAccount` 保留拋 TypeError：佢擋嘅係「有人繞過 service 直接叫 crypto」，
 * 嗰個係程式錯誤，唔係使用者輸入。
 */
export function bankAccountRejection(value) {
  const normalized = normalizeBankAccountNumber(value);
  if (!normalized) return BANK_ACCOUNT_EMPTY;
  if (DISALLOWED.test(normalized)) return BANK_ACCOUNT_UNREPRESENTABLE;
  if (normalized.length > MAX_ACCOUNT_LENGTH) return BANK_ACCOUNT_TOO_LONG;
  return null;
}

/**
 * 上限由欄位闊度嚟，唔係由一個對帳號格式嘅猜測嚟。GCM 係串流模式，密文長度等於明文
 * byte 數，而正規化之後全部係 ASCII，所以 512 個字元啱啱好填滿 VARBINARY(512)。
 * 喺非嚴格 sql_mode 之下超長會靜靜哋截短，而一行截短咗嘅密文永遠驗證唔到。
 */
function requireAccount(value, what) {
  const rejection = bankAccountRejection(value);
  if (rejection) {
    // 訊息刻意唔帶輸入 —— 設計 §6.6：validation error 同 ApplicationError.details
    // 都唔可以包含 accountNumber。
    throw new TypeError(`Supplier bank crypto cannot ${what} this account number (${rejection})`);
  }
  return normalizeBankAccountNumber(value);
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

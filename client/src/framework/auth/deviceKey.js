import authConfig from "@config/auth.js";

/**
 * 設備金鑰：識別「這台機器」嘅私鑰，同埋用佢簽請求。
 * 設計說明見 docs/device-binding-auth.md。
 *
 * 整個方案嘅安全性繫於一件事：**私鑰係 non-extractable**。
 *
 *   crypto.subtle.generateKey(..., false, ...)  ← 第二個參數
 *
 * 咁樣產出嘅 CryptoKey，JS 只可以攞去簽名，永遠讀唔到金鑰內容本身。所以就算
 * 中咗 XSS，攻擊者都只可以喺受害者部機、有 foothold 嗰段時間內就地簽名，
 * 帶唔走條匙。如果改成 extractable + 存 JWK 落 localStorage，攻擊者一次就可以
 * 攞走條匙，之後喺自己部機永久冒充呢台設備——成套綁定即刻等於零。
 *
 * 存 IndexedDB 而唔係 localStorage：localStorage 淨係食字串，存 CryptoKey 一定
 * 要先 export（就要 extractable）。IndexedDB 嘅 structured clone 可以直接存
 * CryptoKey 物件本身。
 *
 * ⚠️ IndexedDB 唔係持久儲存。用戶清瀏覽器資料、Safari ITP 七日無互動後清除、
 * 無痕視窗、公司政策清理——條匙一冇，device id 就變，等於一台全新未綁定嘅設備，
 * 要重新審批。開機會叫 ensurePersistentStorage() 降低機會率，但保證唔到。
 */

const STORE = "keys";
const RECORD = "device";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(authConfig.deviceKeyDbName, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadKeyPair() {
  const db = await openDatabase();

  try {
    return (await transact(db, "readonly", (store) => store.get(RECORD))) ?? null;
  } finally {
    db.close();
  }
}

async function createKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: authConfig.deviceKeyCurve },
    // extractable: false —— 見檔案頂部。呢個 false 係成個方案嘅地基，
    // 改成 true 會令 XSS 由「要維持 foothold」變成「攞完就走」。
    false,
    ["sign", "verify"]
  );
  const db = await openDatabase();

  try {
    await transact(db, "readwrite", (store) => store.put(keyPair, RECORD));
  } finally {
    db.close();
  }

  return keyPair;
}

/**
 * 攞現有嘅金鑰，冇就產一把新嘅。
 *
 * 併發呼叫會共用同一個 promise：登入頁如果同時觸發兩次，兩次各自產一把匙就會
 * 有一把即刻變成孤兒，而用戶睇到嘅 device id 會係邊一把要睇邊個 put 後寫——
 * 之後佢申請綁定嗰個 id 同真正簽名嗰把匙可以係唔同嘅兩樣嘢。
 */
let pending = null;

/**
 * 叫瀏覽器唔好清呢個 origin 嘅儲存空間。
 *
 * 設備私鑰住喺 IndexedDB，而 IndexedDB 預設係「best-effort」——瀏覽器喺磁碟壓力
 * 下、或者 Safari ITP 七日無互動之後可以清走佢。條匙一冇，device id 就變咗，
 * 等於一台全新未綁定嘅設備：用戶登入唔到，要重新走一次審批。呢個係可用性缺口，
 * 唔係安全缺口，但佢會落喺管理員身上（多一單審批）同用戶身上（登入唔到）。
 *
 * persist() 唔保證得到——Chrome 睇 engagement heuristics，Firefox 可能問用戶。
 * 所以每次開機都試一次而唔係淨係喺產生金鑰嗰陣試：第一次俾人拒絕之後，用戶
 * 用得多咗、engagement 上嚟，下次就可能批。已經 persisted 就即刻返，唔會重覆問。
 *
 * 全程唔會 throw：呢個係盡力而為嘅優化，唔應該有任何一條路令佢阻到開機。
 * 舊瀏覽器、非安全 context 都冇 navigator.storage，直接當做唔支援。
 */
export async function ensurePersistentStorage() {
  const storage = globalThis.navigator?.storage;

  if (typeof storage?.persist !== "function" || typeof storage?.persisted !== "function") {
    return false;
  }

  try {
    return (await storage.persisted()) || (await storage.persist());
  } catch {
    return false;
  }
}

export function ensureDeviceKey() {
  pending ??= (async () => {
    try {
      return (await loadKeyPair()) ?? (await createKeyPair());
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/** 匯出公鑰嘅 SPKI DER。公鑰唔受 extractable 影響（規格規定恆為可匯出）。 */
export async function exportPublicKey(keyPair) {
  return new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
}

/** device id：公鑰 SPKI DER 嘅 SHA-256（hex）。同後端 deviceIdFor() 一致。 */
export async function deviceIdFor(publicKeySpki) {
  const digest = await crypto.subtle.digest("SHA-256", publicKeySpki);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes) {
  let binary = "";

  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64url(text) {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * 組出待簽嘅字串。**必須同後端 DeviceBindingService.signingInput() 逐字元一樣**，
 * 否則每一份簽章都會驗唔過，而錯誤訊息淨係會話「簽章無效」，唔會話兩邊格式唔同。
 *
 * 鍵照字典序排——靠 JS 物件實字嘅字串鍵維持插入順序，照字母寫落去就係照字母
 * 輸出。兩邊各有一條測試釘住同一個 golden 字串，任何一邊漂移都會即刻紅。
 *
 * method / path / bodyHash 都要入去：少咗佢哋，簽章淨係證明「呢台設備某個時候
 * 簽過嘢」，唔證明「呢個請求嚟自呢台設備」，攻擊者可以將簽章搬去第二個請求。
 */
export function buildSigningInput({
  accessTokenHash,
  bodyHash,
  deviceId,
  method,
  nonce,
  path,
  timestamp
}) {
  return JSON.stringify({
    // 呢份簽章綁死喺邊一枚 access token 上。即係 RFC 9449（DPoP）嘅 `ath`：
    // 少咗佢，簽章淨係證明「呢台設備簽咗一個往呢個路徑嘅請求」，唔證明佢簽嘅
    // 係**配呢一枚 token** 嗰個。冇 token 嘅請求（登入）係空字串，同 bodyHash
    // 一樣嘅慣例。鍵順序照字典序，所以佢排喺最前。
    accessTokenHash: String(accessTokenHash ?? ""),
    bodyHash: String(bodyHash ?? ""),
    deviceId: String(deviceId ?? ""),
    method: String(method ?? "").toUpperCase(),
    nonce: String(nonce ?? ""),
    path: String(path ?? ""),
    timestamp: Number(timestamp)
  });
}

/**
 * 簽一個請求，回傳要掛上去嘅 X-Device-* headers。
 */
export async function signRequest({
  method,
  path,
  body,
  token,
  includePublicKey = false
}) {
  const keyPair = await ensureDeviceKey();
  const publicKeySpki = await exportPublicKey(keyPair);
  const deviceId = await deviceIdFor(publicKeySpki);
  const nonce = crypto.randomUUID();
  const timestamp = Date.now();
  // body 未定義時係空字串，同後端 bodyHash() 對 undefined／零長度嘅處理一致。
  const bodyHash = body === undefined ? "" : await sha256Base64url(body);
  // 雜湊個 token 而唔係將佢本身放入簽章輸入：簽章輸入會出現喺日誌同錯誤路徑，
  // 而 token 係憑證。RFC 9449 嘅 `ath` 都係咁做。
  const accessTokenHash = token ? await sha256Base64url(token) : "";

  const signingInput = buildSigningInput({
    accessTokenHash,
    bodyHash,
    deviceId,
    method,
    nonce,
    path,
    timestamp
  });

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: authConfig.deviceKeyHash },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );

  const headers = {
    "X-Device-Id": deviceId,
    "X-Device-Timestamp": String(timestamp),
    "X-Device-Nonce": nonce,
    // Web Crypto 出嘅係 IEEE P1363（r||s 直接接埋，P-256 為 64 bytes）。後端
    // 驗簽要指明 dsaEncoding: "ieee-p1363"，否則 Node 會當佢係 DER 而全部判錯。
    "X-Device-Signature": base64url(signature)
  };

  // 公鑰淨係喺首次綁定申請先帶。已經有綁定嘅請求，後端一律用資料庫入面嗰把，
  // 帶上去都會被忽略——唔係咁嘅話，任何人都可以用自己嘅匙簽名再附上自己嘅公鑰。
  if (includePublicKey) {
    headers["X-Device-Public-Key"] = base64url(publicKeySpki);
  }

  return headers;
}

/** 目前呢台機嘅 device id，畀等待審批頁顯示用。 */
export async function currentDeviceId() {
  return deviceIdFor(await exportPublicKey(await ensureDeviceKey()));
}

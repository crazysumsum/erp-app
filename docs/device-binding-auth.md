# 設備綁定認證與 JWT 續期設計

目標：**讓使用者在長時間使用系統的過程中不會被意外登出**，同時把「憑證外洩之後從別的機器登入」這條路堵死。

兩件事合在一起做的理由：JWT 續期需要一個「證明這還是同一個人」的憑證。如果那個憑證就是 JWT 自己，被偷走的 JWT 就能自己無限續期下去；改用設備私鑰簽名之後，偷到 JWT 也續不了期。設備綁定因此不只是額外的安全功能，它是續期機制能夠成立的前提。

## 已確認的決定

| 決定 | 選擇 | 主要影響 |
| --- | --- | --- |
| 一個使用者可綁幾台設備 | **無限**，但每一台都要逐台審批 | 換電腦、加筆電都要走審批，沒有數量上的阻力 |
| 審批 pending 期間 | **不能使用系統** | 綁定是硬性門檻，不是事後補登記 |
| 絕對 session 上限 | **8 小時**（`JWT_SESSION_MAX_AGE`），另有真實活動閒置逾時 | 每天至少要重新輸入一次密碼；見〈絕對 session 上限〉 |
| JWT 有效期 | **15 分鐘** | |
| JWT 過期後 | **強制登出**，不做 401 續期重放 | 少一整類 bug（重放、Idempotency-Key、迴圈防護），代價是續期必須夠可靠 |
| 私鑰儲存 | IndexedDB 的 non-extractable `CryptoKey` | XSS 只能在受害者瀏覽器上就地簽名，帶不走金鑰 |
| 簽章演算法 | **ECDSA P-256**（非 RSA） | 產鑰近乎瞬間（RSA-2048 在弱機器上是可見的 UI 停頓），簽章 64 bytes vs 256 bytes |
| Device ID | **公鑰的 SHA-256 thumbprint**，非前端隨機數 | ID 自證：持有對應私鑰才能用這個 ID，不可能偽造或碰撞；也不必另外存一份、不會與金鑰失去同步 |
| 審批權限 | 新增 permission **`device.approve`** | 綁 permission 而非 role，人事調整不必改程式碼 |
| 通知 | **暫不做**（email / 站內通知） | 審批者需要自己去看佇列 |
| 綁定記錄保留 | 三條規則，見 §5.4 | pending 一個月、approved 未使用 14 天、已使用過的一個月 |
| 審批角色 | 種一個 **`system-admin`** 角色持有 `device.approve` | 系統第一個帳號自動成為 system admin |
| 資料表命名 | 使用者相關一律 `user_` 前綴 | 與既有的 `users` / `user_roles` 一致 |

---

## 一、資料模型

兩張新表都用 `user_` 前綴，與既有的 `users`、`user_roles` 同一族。沒有 `fr_` 前綴：審批流程、誰有權審批、組織要不要管制設備，這些是業務政策而不是框架機制。框架自己的 `fr_token_versions` 刻意用 `subject VARCHAR(190)` 且不設外鍵以保持通用，這兩張表反過來，直接對 `users` 設外鍵。

### 1.1 `user_devices`（新表，需簽核）

```sql
CREATE TABLE user_devices (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  -- 公鑰的 SHA-256 thumbprint（hex）。不是前端自選的隨機數：自選 ID 多一個
  -- 可偽造的輸入卻換不到任何好處，而 thumbprint 只有持有私鑰的人用得了。
  device_id     CHAR(64)        NOT NULL,
  -- SPKI DER 格式的公鑰。目前用 ECDSA P-256，約 91 bytes。宣告 512 是給日後
  -- 換演算法的餘裕（RSA-2048 的 SPKI 約 294 bytes，塞不進 255）——VARBINARY
  -- 是變長型別，宣告得寬不會多佔任何儲存空間。
  public_key    VARBINARY(512)  NOT NULL,
  -- 使用者自填的裝置名稱，例如「Sam 的辦公室桌機」。審批者要靠它做判斷——
  -- 一組 thumbprint 加一串公鑰對人類毫無意義，沒有這欄審批只會變成無腦按核准。
  label         VARCHAR(190)    NOT NULL DEFAULT '',
  -- pending | approved | rejected | revoked
  status        VARCHAR(20)     NOT NULL DEFAULT 'pending',
  requested_at  BIGINT UNSIGNED NOT NULL,
  -- 申請當下的 IP 與 UA，同樣是給審批者看的判斷依據。
  requested_ip  VARCHAR(45)     NOT NULL DEFAULT '',
  requested_ua  VARCHAR(255)    NOT NULL DEFAULT '',
  reviewed_at   BIGINT UNSIGNED NULL,
  reviewed_by   BIGINT UNSIGNED NULL,
  review_note   VARCHAR(190)    NOT NULL DEFAULT '',
  -- 最後一次成功用這台設備登入或續期的時間。續期每 15 分鐘更新一次，所以
  -- 使用中的設備永遠不會變舊。NULL 代表從未成功使用過（還在 pending、被拒，
  -- 或核准了但使用者再也沒回來）。清理工作照 status 分三條規則處理這一欄與
  -- requested_at、reviewed_at 的關係，見 §5.4。
  last_used_at  BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  -- 同一把金鑰可以被不同使用者各自申請（共用電腦的正常情況），所以唯一性是
  -- (user_id, device_id) 而不是 device_id。
  UNIQUE KEY uq_user_devices_user_device (user_id, device_id),
  -- 審批佇列的查詢：撈出所有 pending 並照申請時間排序。
  KEY idx_user_devices_status (status, requested_at),
  -- 使用者的設備清單，以及清理工作第三條規則的掃描。
  KEY idx_user_devices_last_used (last_used_at),
  CONSTRAINT fk_user_devices_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  -- 審批者離職被刪除時保留這筆綁定記錄，只是不知道是誰批的，所以 SET NULL
  -- 而不是 CASCADE——CASCADE 會連帶刪掉一堆有效的設備綁定。
  CONSTRAINT fk_user_devices_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
);
```

時間一律 `BIGINT UNSIGNED` epoch 毫秒，與 `0003_add_auth_tables.js` 及 `time` service 的 `nowMs()` 一致。

**對既有資料的影響**：純新增，不動任何既有表，沒有鎖表風險。但**上線當下所有使用者都沒有已審批的設備**，見 §5.1。

### 1.2 `user_device_nonces`（新表，需簽核）

防簽章重放。客戶端每次簽名帶一個 UUID，伺服器 INSERT，主鍵衝突就是重放。

```sql
CREATE TABLE user_device_nonces (
  nonce      CHAR(36)        NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (nonce),
  KEY idx_user_device_nonces_expires (expires_at)
);
```

這張表其實不含任何使用者資料，`user_device_` 前綴純粹是為了讓設備認證的兩張表在 schema 裡排在一起、一眼看得出是同一個功能的。

表的大小有界：只保留簽章時效窗（預設 5 分鐘）內的列，由清理 job 刪除，比照 `IdempotencyPurgeJob` 的模式。

> **這是唯一可以砍的一張表。** 砍掉之後只靠 timestamp 時效窗防護，代價是：任何能取得一次完整簽名請求的人（反向代理的 body/header 日誌、TLS 攔截）可以在時效窗內重放它換到一個 JWT。XSS 情境下有沒有這張表都一樣——攻擊者可以就地簽新的。要縮範圍的話這裡可以先不做，但要知道放棄的是什麼。

### 1.3 種入 `system-admin` 角色與 `device.approve` 權限

`device.approve` 套現有的 `hasPermission` 授權策略與 `v-can` 指令，不需要任何新機制。

migration 一併種入三樣東西，**全部以名稱為準、有就跳過**：角色 `system-admin`、權限 `device.approve`、以及兩者之間的 `role_permissions` 關聯。

`system-admin` 種入時**只給 `device.approve` 這一個權限**，不預先塞其他的。日後要什麼再逐項加——一個上線第一天就握有所有權限的角色，之後沒有人敢動它。

**角色名用 slug `system-admin`，不是帶空格的 `system admin`。** 這一欄的值會直接進 JWT 的 `roles` claim，也是 `hasRole` 策略與前端 `page.requires.roles` 的比對字串——那些位置都是機器讀的識別碼，慣例與 `device.approve` 一致。給人看的字串放 `description`（`System Admin`），`roles` 表本來就有這一欄。

> **為什麼不指定 id、也不去碰 `role_id = 1`。**
>
> `0003_add_auth_tables.js` 只建表不種資料，所以 `roles` 沒有任何種子；現有環境裡的角色全部是 `scripts/createUser.js` 在 `--role` 時順手建出來的，id 1 是什麼完全取決於誰先跑過那支腳本。**實測 `erp_dev`：`role_id = 1` 是 `admin`。**
>
> 以 id 當錨點去「改名」，在那些環境裡等於靜默改掉一個正在使用中的角色名，而角色名會出現在 JWT claims、`hasRole` 策略與前端頁面 metadata 裡——那些地方不會報錯，只會安靜地開始比對失敗。
>
> 改以名稱為準之後這個問題整個消失，也不需要任何守衛或人工介入：乾淨的資料庫裡 `system-admin` 自然拿到 id 1；既有環境裡它拿到下一個可用的 id，原本的 `admin` 完全不動。
>
> 種入用「先查再寫」而不是 `INSERT IGNORE`：後者會把所有錯誤一起降級成警告，包含型別不符、欄位缺失這些真正該中止 migration 的問題。這裡只跑一次，多一次 `SELECT` 沒有成本。

**系統第一個使用者自動成為 system admin**：改 `scripts/createUser.js`——建立帳號時若 `users` 表是空的，無論有沒有給 `--role`，一律額外授予 `system-admin`，並在輸出裡明講。這樣 bootstrap 是自洽的：第一個帳號建出來就有 `device.approve`，可以審批後續所有人的設備。

（但他自己的設備仍然需要 §5.1 的 break-glass 腳本核准——帳號存在不等於設備已綁定，這是兩個獨立的 bootstrap 步驟。）

---

## 二、設備簽章規格

簽章資訊走 header 而不是 body：handler 的 requestSchema 都是 `additionalProperties: false`，塞進 body 會讓每一支要簽名的端點都得改 schema；走 header 則同一套規格可以直接套用到日後任何端點。

| Header | 內容 |
| --- | --- |
| `X-Device-Id` | 公鑰 thumbprint（hex） |
| `X-Device-Timestamp` | epoch 毫秒 |
| `X-Device-Nonce` | UUID v4 |
| `X-Device-Signature` | ECDSA P-256 / SHA-256 簽章，base64url |
| `X-Device-Public-Key` | SPKI DER 的 base64url。**只在首次綁定申請時攜帶** |

簽章覆蓋的內容（canonical JSON，鍵照字典序）：

```json
{
  "bodyHash": "<請求 body 原始 bytes 的 SHA-256，base64url；無 body 時為空字串>",
  "deviceId": "<thumbprint>",
  "method": "POST",
  "nonce": "<uuid>",
  "path": "/api/v1/user/login",
  "timestamp": 1755600000000
}
```

`method` / `path` / `bodyHash` 都要進去：少了它們，簽章只證明「這台設備某個時候簽過東西」，不證明「**這個**請求來自這台設備」，攻擊者可以把簽章搬到另一個請求上。

伺服器端驗證順序：

1. `|timestamp - now| <= signatureMaxSkewSeconds` → 否則 `DEVICE_SIGNATURE_STALE`（雙向的窗：只擋「太舊」的話，攻擊者送一個遠在未來的 timestamp 就能讓同一份簽章的可用時間無限延長）
2. 重建 canonical JSON，用公鑰驗簽 → 失敗 `DEVICE_SIGNATURE_INVALID`
3. `INSERT INTO user_device_nonces` → 主鍵衝突即重放 → `DEVICE_SIGNATURE_REPLAY`
4. 公鑰來源：**首次申請**用請求自帶的 `X-Device-Public-Key`（這是持有證明——證明申請者確實握有所宣稱公鑰的私鑰），**其後**一律用資料庫裡 approved 那筆，請求自帶的公鑰直接忽略

**nonce 刻意排在簽章之後**：消耗 nonce 是一次資料庫寫入，放在前面的話任何人都能用一堆沒有簽章的垃圾請求往那張表灌資料；放在後面，只有已經證明自己握有私鑰的請求才碰得到資料庫。ECDSA 驗簽只花幾十微秒，先做不虧。

**驗簽必須指定 `dsaEncoding: "ieee-p1363"`**：Web Crypto 的 ECDSA 簽章是 r||s 直接接起來（P-256 為 64 bytes），而 Node 對 EC 預設吃 DER。不指定的話，**每一份由瀏覽器產生的合法簽章都會被判成無效**，而錯誤訊息不會提到格式。這是這個介面最容易踩的一顆雷。

**對外的錯誤只有三種**，內部的失敗原因一律只進日誌：

| 對外 code | HTTP | 何時 |
| --- | --- | --- |
| `DEVICE_SIGNATURE_REQUIRED` | 400 | 完全沒帶簽章 header |
| `DEVICE_SIGNATURE_STALE` | 400 | 時鐘偏差超出容忍 |
| `DEVICE_SIGNATURE_INVALID` | 400 | 其他全部：簽章不符、公鑰不合法、nonce 重放、device id 與公鑰不符 |

時鐘偏差刻意獨立出來，因為它是唯一一個**使用者自己修得好**的原因，而攻擊者從「你的時間差太多」學不到任何東西；收斂掉它只會換來一通查不出原因的客服電話。其餘全部收斂，因為「簽章不符」與「nonce 用過了」的差別會告訴攻擊者他離成功還差多遠。

**body 的雜湊必須用原始 bytes。** `express.json()` 解析完就把 stream 消耗掉了，所以框架在 `express.json({ verify })` 裡把原始 Buffer 留在 `req.rawBody`。不能改用 `JSON.stringify(req.body)` 重算——鍵順序、空白、Unicode escape 都可能與客戶端送出的那份不同，那樣簽章會時好時壞，是最難查的一種。記憶體成本有界：`jsonBodyLimit`（預設 100kb）就是上限。

**待簽字串的格式由兩邊各一條 golden 測試釘住**（`server/test/deviceBinding.test.js` 與 `client/test/framework/auth/deviceKey.test.js`）。兩邊漂移的症狀是「每一次登入都說簽章無效」，而錯誤訊息不會提到格式——所以改那個字串時兩條測試一定要一起改。

⚠️ CORS 要放行這些 header：`server/config/security.js` 的 `cors.allowedHeaders` 目前是 `["Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key"]`，要加上五個 `X-Device-*`。漏了的話瀏覽器會在 preflight 就擋下，而且只會說「被 CORS 拒絕」。

---

## 三、流程

### 3.1 首次登入與綁定申請

前端在需要簽名時才產金鑰（IndexedDB 沒有就產一把）：

```js
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  false,                                  // ← extractable: false，整個方案的安全性繫於此
  ["sign", "verify"]
);
// keyPair.privateKey 直接存進 IndexedDB（structured clone 支援 CryptoKey）。
// JS 從此只能用它簽名，永遠讀不到金鑰內容。
// 公鑰不受 extractable 影響（規格規定非對稱金鑰的公鑰恆為可匯出），
// 所以照樣能匯出來送給後端、算 thumbprint。
```

登入 body 多一個選填的 `deviceLabel`，成為審批佇列裡給人看的裝置名稱。前端由 User-Agent 撮要出來（例如「Chrome on Mac」）而不是叫使用者自己填——第一次登入時他還沒進到系統，沒有地方可以問。選填是因為審批者本來就還有完整的 UA 與 IP 可看，不該因為少一個標籤就擋下整個登入。

登入請求一律攜帶設備簽章 header。後端處理順序**不可調換**：

1. **先驗帳號密碼**（沿用 `UserService.authenticate()`，含現有的鎖定與 IP 節流）
   - 失敗 → 照舊回 `401 LOGIN_FAILED`，一個字都不提設備
   - 這個順序是強制的：若先處理設備，任何人都能對任意帳號灌爆審批佇列，而且回應會洩漏帳號存不存在
2. 驗設備簽章（第二節）
3. 查 `user_devices` 的 `(user_id, device_id)`：

| 狀態 | 回應 |
| --- | --- |
| 不存在 | 建立 `pending` 列（記 IP / UA / label）→ `403 DEVICE_PENDING_APPROVAL` |
| `pending` | 不重複建立 → `403 DEVICE_PENDING_APPROVAL` |
| `rejected` | `403 DEVICE_REJECTED` |
| `revoked` | `403 DEVICE_REVOKED` |
| `approved` | 簽發 JWT，更新 `last_used_at` |

三個 403 要用不同的 code，前端才能給出不同的畫面。全部混成同一句「登入失敗」的話，使用者會以為是密碼打錯而一直重試，然後撞上登入節流。

### 3.2 審批

- `GET /api/v1/device/bindings/pending` — 審批佇列，需 `device.approve`
- `POST /api/v1/device/bindings/:id/approve` — 需 `device.approve`，`authType: "jwt-password"`
- `POST /api/v1/device/bindings/:id/reject` — 需 `device.approve`，`authType: "jwt-password"`
- `POST /api/v1/device/bindings/:id/revoke` — 需 `device.approve`，`authType: "jwt-password"`
- `GET /api/v1/device/bindings` — 使用者看自己的設備清單，authenticated 即可

核准、拒絕、撤銷這三個動作要求密碼再確認（見 `JwtPasswordAuthStrategy`）：核准
會讓一台設備拿到長期存取權，撤銷會結束一個使用者所有 session，兩者都
值得要求審批者當場再證明一次「現在仍然是我」，而不是只憑一個可能已經開著很
久的 session。密碼從 request body 的 `password` 欄位讀，前端一個對話框同時
收確認與密碼（`promptPassword()`）。

⚠️ `PASSWORD_INVALID` 用 403，不是 401——前端把任何 401 都當成 JWT 本身失效、
全域登出（見 `HttpClient.js` 的 `onUnauthorized`）。密碼打錯一次不該把審批者
的整個 session 弄丟，這點在接上真正的前端流程之後才靠瀏覽器測試抓到，不是一
開始設計 `jwt-password` 時就想到的。

暫不做通知，審批者需要主動查看佇列。

### 3.3 已綁定設備登入

同 3.1，第 3 步直接命中 `approved`。JWT 的 payload 多一個 claim：

```
did: "<device_id>"
```

JWT 有效期 **15 分鐘**（`JWT_EXPIRES_IN` 由 `2h` 改為 `15m`）。有了自動續期之後，2h 這個值原本在「安全」與「多久踢人一次」之間的妥協就消失了，縮短純賺：被偷 JWT 的存活時間、撤銷生效延遲、權限變更生效時間一起縮短。

登入回應新增 `expiresInSeconds`（數字）。現有的 `expiresIn: "2h"` 是字串，前端沒辦法拿它算續期時間；`loginHandler.js` 的 responseSchema 要一起改。

### 3.4 背景續期

`POST /api/v1/user/token/refresh`，`authType: "jwt-device"`。

`jwt-device` 是一個獨立的 authStrategy（`JwtDeviceAuthStrategy`，繼承 `JwtAuthStrategy`），不是 handler 裡的手動檢查——這是為了讓「JWT + 設備簽章」這個保證成為身份層的一部分，可以直接套用在未來其他要求設備綁定的高風險端點上，不需要每支 handler 各自重寫一次。它在進 handler 之前做完：

1. 沿用 `JwtAuthStrategy`：簽章驗證、撤銷檢查、快照熔斷的 503。**過期的 JWT 在這裡就被擋成 401**，正好對應「過期即強制登出、不給寬限」的決定
2. 驗設備簽章（第二節）
3. `claims.did === X-Device-Id` → 否則 `403 DEVICE_MISMATCH`。這是「只接受相同 device id 發出的申請」那條規則
4. `user_devices` 目前仍是 `approved` → 否則 `403 DEVICE_REVOKED` / `DEVICE_REJECTED` / `DEVICE_PENDING_APPROVAL`

通過後，strategy 把 `claims` 與查到的那筆 `deviceBinding` 一併交給 handler，handler 不再重查一次。

handler 自己還做兩件事：

1. **`users.status === 'active'` → 否則 `401 USER_INACTIVE`**。少了這個檢查，HR 把離職員工設成 `disabled` 之後，`UserService.authenticate()` 只擋得住**新登入**，那個人已經開著的 session 會一直續期到絕對上限為止——最長 8 小時。加上之後縮到 15 分鐘內，而且不需要任何人額外記得做第二件事
2. **`claims.ver === currentVersion(subject)` → 否則 `401 TOKEN_VERSION_STALE`**。這是續期與撤銷之間的競態修法，見〈安全性分析〉「登入／續期與撤銷之間的競態」一節——它是簽發新 token 這個動作本身的業務規則，不是身份問題，所以留在 handler，不在 strategy 裡

通過後：

- 從資料庫重讀 `tokenRevocation.currentVersion(subject)`（不能讀快照，理由同 `currentVersion()` 的註解）
- **從資料庫重讀 roles / permissions**（與 status 同一次查詢）。權限寫在 claims，現在改權限要等 token 過期；續期是天然的更新點，這是白賺的——權限變更 15 分鐘內生效
- 簽新 JWT，更新 `last_used_at`
- 回 `{ token, tokenType, expiresIn, expiresInSeconds, sessionExpiresInSeconds, user }`——最後那個是這條 session 距離絕對上限的**剩餘**秒數，見〈絕對 session 上限〉的〈提早提醒〉

舊 JWT 不作廢，自己過期即可。沒有輪替，因此不需要重用偵測，也沒有多分頁輪替競態。

### 3.5 前端 session watchdog

三個前景事件加一個背景 tick，共用同一個判斷函式：

```js
// 收到 token 當下就把絕對 deadline 算好。不用 JWT 的 exp 去比本地時鐘——
// 使用者的時鐘不可信（framework 本來就在意時鐘偏移，見 maxClockSkewSeconds），
// 而這個算法只依賴「收到之後過了多久」，睡眠期間 wall clock 照常前進。
function setSession(token, expiresInSeconds) {
  setToken(token);
  localStorage.setItem("erp.token.deadline", String(Date.now() + expiresInSeconds * 1000));
}

function checkSession() {
  const remaining = Number(localStorage.getItem("erp.token.deadline") || 0) - Date.now();

  if (remaining <= 0) {
    forceLogout();                        // 已過期 → 直接登出，一個請求都不用發
    return;
  }
  if (remaining < REFRESH_THRESHOLD_MS) {
    void tryRefresh();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkSession();
});
// bfcache：使用者按瀏覽器上一頁回來，頁面連同 timer 都是凍結後解凍的，
// focus 不一定觸發。這個最容易漏。
window.addEventListener("pageshow", (event) => { if (event.persisted) checkSession(); });
window.addEventListener("online", checkSession);
setInterval(checkSession, REFRESH_TICK_MS);
```

**檢查一定要在本地做，不能打 API。** 如果是打 `/me` 然後「失敗就登出」，一次後端抖動就會把所有人踢出去——正好是 `jwtAuthStrategy.js` 特地用 503 而非 401 要避免的事。撤銷（強制下線、改密碼、設備被撤銷、帳號停用）不靠這個檢查：續期請求本身就是伺服器端驗證，中間有漏也會由下一個 API 請求的 401 經 `main.js` 現有的 `onUnauthorized` 接住。`HttpClient` 只在 401 呼叫它、503 不呼叫，這個行為現在就是對的。

### 3.6 續期前檢查真實使用者活動

續期是由分頁裡的 tick 觸發的，而 tick 只看**分頁活著**，不看**使用者在不在**。少了這個檢查，session 能撐多久其實取決於機器會不會睡：

| 情境 | 沒有活動檢查的結果 |
| --- | --- |
| 筆電闔上、睡眠 | timer 停 → 15 分鐘後 session 死 |
| 桌機整晚不關、ERP 分頁開著 | tick 每 60 秒照跑 → **session 永遠不死** |

辦公室桌機開著整晚、ERP 分頁一直掛著，在 ERP 環境裡非常常見；那代表凌晨兩點走到那台機器前面的人會發現它是登入狀態。加上活動檢查之後，逾時由「使用者有沒有在用」決定，而不是由電源設定決定。

```js
// 最後一次真實互動。pointerdown / keydown / scroll 涵蓋滑鼠、觸控、鍵盤。
// 刻意不聽 mousemove：游標只是掃過畫面、甚至某些硬體自己抖動都會觸發，
// 那不構成「有人在用」。
let lastActivityAt = Date.now();
for (const type of ["pointerdown", "keydown", "scroll"]) {
  window.addEventListener(type, () => { lastActivityAt = Date.now(); }, { passive: true });
}

async function tryRefresh() {
  if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
    return;                               // 閒置 → 不續期，讓 token 自然過期
  }

  // Web Locks 跨分頁互斥，取代 random delay：後者只降低碰撞機率，
  // 而且「檢查是否即將到期再決定要不要更新」本身是 read-then-write 競態。
  await navigator.locks.request("jwt-refresh", async () => {
    if (!isExpiringSoon()) return;        // 進了鎖再檢查一次，別的分頁可能已經換好
    try {
      const { token, expiresInSeconds } = await requestNewJwt();
      setSession(token, expiresInSeconds);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        forceLogout();                    // 明確拒絕（已撤銷、設備失效、帳號停用）→ 該登出
        return;
      }
      // 網路錯誤 / 逾時 / 503：不動 token，等下一次 tick 重試
    }
  });
}
```

`lastActivityAt` **刻意只存在於各自的分頁裡**，不跨分頁同步：只要有任何一個分頁裡有人在操作，那個分頁就會續期，而 token 是共用的，其他閒置分頁自然跟著受惠。要同步反而複雜且沒有好處。

沒有 Web Locks 的瀏覽器退回一個 process 內的旗標：擋不到跨分頁，但擋得到同一個分頁重入。這比完全不擋好，而且那條路上的重複續期只會多打一次 API，不會登出任何人——真正的重放偵測在後端的 nonce 表。

**參數**：

- `REFRESH_TICK_MS` 60 秒、`REFRESH_THRESHOLD_MS` 5 分鐘。閾值必須遠大於 tick 間隔——反過來（例如 10 分鐘檢查一次、剩 1 分鐘才續）會在第一個週期就漏掉，因為到期時間落在「檢查後 1 分鐘到 10 分鐘」之間時兩次檢查都不會觸發。這組參數也給一次短暫斷網 5 次左右的重試機會
- `IDLE_TIMEOUT_MS` 30 分鐘。**這是「多久不續期」的門檻，不是「多久後登出」**——停止續期那一刻手上還有一個沒用完的 JWT，而停止續期只會發生在某個 tick 上，不會剛好卡在第 30 分鐘。

  **實際登出 = `IDLE_TIMEOUT_MS` + 5 到 15 分鐘**（下界是 JWT 壽命減續期週期，上界是整個 JWT 壽命）。設 30 分鐘的話，真正被登出會落在最後一次操作後的 35–45 分鐘。

  另外要知道「活動」只認**這個應用的分頁裡**的操作。使用者把 ERP 開著、轉去 Excel 或郵件做四十分鐘，對這個機制來說是純閒置，回來就得重登。ERP 的使用者很常這樣交替，所以這個值不能只照「離開座位多久」來想。

  真正防「有人走到沒鎖的電腦前」的控制是**作業系統的螢幕鎖定**；這裡的閒置逾時是它後面的第二道。公司政策已經強制短時間鎖屏的話，這個值可以放寬到 60 分鐘而不會多出多少風險。

因為沒有 401 續期重放這條兜底路徑，**續期失敗必須可重試**是硬性要求，不是優化。

另加一條到期前警告：續期連續失敗且剩餘不到 2 分鐘時顯示 banner「連線階段即將結束，請儲存目前的工作」。這是唯一能救「分頁一直在前景、後端卻連不上」那個情境的東西——那時 `visibilitychange` 幫不上忙，因為使用者根本沒離開過。

---

## 四、安全性分析

**擋得住**

- 密碼被釣魚或外洩之後，攻擊者從自己的機器登入 —— 沒有已審批的設備金鑰，過不了第 2 步
- 憑證填充（credential stuffing）
- 離職員工用私人電腦存取 —— 撤銷設備即可，不必等改密碼
- 偷到的 JWT 拿去別的機器續期 —— 續期要設備簽章；JWT 本身 15 分鐘後自然死亡
- 無人看管但沒關機的辦公室電腦 —— 由 §3.6 的活動檢查處理

**擋不住（要講清楚，否則會誤以為安全性比實際高）**

- **受害者瀏覽器上的 XSS**。私鑰是 non-extractable，攻擊者帶不走，但**可以在頁面上就地呼叫它簽名**。差別在於攻擊者必須維持 foothold，而不是拿了金鑰回家慢慢用——這是實質差別，但不是免疫。`client/config/auth.js` 列的那四項補償措施（CSP、禁 `v-html` 的 lint、短 token、依賴稽核）依然全部必要
- 受害者機器上的惡意軟體 —— 可以注入頁面，等同 XSS
- 使用者自願把已審批的機器借給別人
- 審批者不看內容就按核准 —— 所以 `label` / `requested_ip` / `requested_ua` 三欄是必要的，不是裝飾

### 絕對 session 上限

一條 session 從登入那一刻起最多活 **8 小時**（`JWT_SESSION_MAX_AGE`），不管中間背景續期過幾次。到期就必須重新輸入帳號密碼。

這是唯一一個**不需要任何人介入、session 也一定會結束**的機制。其餘每一條路都要嘛依賴使用者的行為，要嘛依賴有人記得去按下某個按鈕：

| 該結束 session 的情況 | 由什麼負責 | 延遲 |
| --- | --- | --- |
| **什麼都沒發生，就是該重新驗一次身份** | **絕對上限** | **≤ 8 小時** |
| 使用者離開座位 | §3.6 活動檢查 | 30–45 分鐘 |
| 帳號被停用（離職） | §3.4 的 `users.status` 檢查 | ≤ 15 分鐘 |
| 強制下線、改密碼 | 既有的 `tokenRevocation.revoke()` | ≤ 15 分鐘 |
| 設備遺失、被偷、不再信任 | **手動撤銷設備**（§5.3） | ≤ 15 分鐘 |
| 設備長期未用 | §5.4 清理工作 | 一個月 |

只有倒數第二列真的需要人介入，而「設備遺失」在絕對上限之外沒有別的自動兜底——所以撤銷路徑仍然必須實際可用，見 §5.3。

#### 怎麼實作的

起算點是 JWT 裡的 `auth_time` claim（OIDC 用的就是這個名字與語意：使用者實際完成認證的時刻）：

- **登入**是唯一會把它設成「現在」的地方——那是唯一一個真的有人輸入了密碼的時刻。
- **續期**原封不動把它抄到新 token 上。這一行就是整個機制的全部意義：改成「現在」的話，每次背景續期都會把上限往後推，session 就永遠不會到期，而症狀是「沒有人被登出」，不會有任何錯誤浮現。
- **`JwtService.issue()` 強制要求 `authTime`**，跟 `subject`、`version` 同一條規則：這三個是讓一個 token 殺得死的全部依據，少了任何一個，token 就對相對應的那條路免疫。簽不出來遠比簽出一個永遠不會到期的 token 好。
- **`JwtService.verify()` 擋掉沒有 `auth_time` 的 token**，跟擋掉沒有 `sub` 的是同一條規則——手工造的 token 正是會省掉這個欄位的那一種。

檢查本身在 `JwtAuthStrategy`，跟撤銷檢查放在一起（兩者都是「token 本身合法，但已經不該再用」），但**排在撤銷檢查之前**：它是三道檢查裡唯一不依賴任何外部狀態的一道，純粹兩個數字相減。排在後面的話，撤銷服務故障期間一個九小時前的 token 會拿到 503（「稍後再試」）而不是 401（「請重新登入」），而那是個會誤導人的答案——它永遠不會再變成有效的。

因為檢查在 `JwtAuthStrategy`，`jwt`、`jwt-device`、`jwt-password` 三個 authType 全部涵蓋（後兩者都繼承它），續期端點也不例外。所以上限是**準確的 8 小時**，不是「8 小時再加上最後一個 token 剩餘的壽命」。

⚠️ **部署當下所有既存 token 一起失效**：它們沒有 `auth_time`，`verify()` 會擋下來。這與當初把撤銷從時間切線換成版本號時是同一種相容性斷點，代價一樣——所有人重新登入一次。

#### 提早提醒

登入與續期的回應都帶一個 `sessionExpiresInSeconds`：**這條 session 還剩多久**，不是 token 還剩多久。兩者刻意分開，因為性質相反——`expiresInSeconds` 每次續期都回到滿值，`sessionExpiresInSeconds` 只會一路遞減。續期那邊回滿值的話，前端會在每次續期後都以為還有一整個上限，提醒就永遠不會出現，而這個欄位存在的唯一理由就是那個提醒。

前端把它換算成一個本地的絕對時刻存起來（`erp.session.deadline`，與 token 的 deadline **分開存**——合成一個的話續期就會把上限一併推掉，正是後端花力氣防住的事），然後 watchdog 多做兩件事：

- **剩不到 10 分鐘就提醒一次**（`sessionWarningThresholdMs`），訊息裡帶實際分鐘數與「屆時需要重新登入」。閾值比 token 那個警告（2 分鐘）長很多，因為性質不同：token 警告是異常狀況（續期一直失敗），多半自己會好；這個是必然會發生、而且無法補救的事，10 分鐘是留給人把手上那張單填完存檔的時間。
- **夠鐘就自己登出**，不等後端回 401。等 401 的話，一個坐在位子上什麼都沒按的人會對著一個看起來仍然登入、但每一個動作都會失敗的畫面。

提醒只發一次。旗標記的是「已經為哪一個 deadline 提醒過」而不是一個 boolean——boolean 要在重新登入時記得清掉，忘了清第二條 session 就不會再提醒；用 deadline 本身當標記，新 session 換一個新值就自動重新武裝，不需要有人記得。

它也刻意**不受閒置閘門管**：閒置的人一樣會被登出，而他回來時看到提醒，好過什麼都沒看到就發現自己已經登出了。

### 登入／續期與撤銷之間的競態

登入與續期都要「讀取版本號」與「檢查設備狀態」兩個獨立步驟，兩者之間隔著別的
await（`findActiveById`、簽章驗證、nonce 寫入）。如果一次撤銷剛好落在這個窗口裡，
版本號讀到的會是撤銷**之後**的值，而設備狀態讀到的是撤銷**之前**的值——用這組
不一致的快照簽出的 token，會蓋著當下最新的版本號，從此對這次撤銷免疫，等於讓
剛撤銷的 session 復活。

修法不是加鎖或包 transaction，是讓兩個讀取的先後關係本身就保證安全：

- **續期**：版本號讀出來之後，多比一次 `claims.ver === currentVersion`，不等就
  401（`TOKEN_VERSION_STALE`）。任何會推高版本號的事件——登出、改密碼、這次
  請求所屬裝置被撤銷——只要發生在 token 簽發之後，都會讓這個等式失敗。比較就
  在讀到版本號的下一行，中間沒有 await，不會再開新的競態窗口。
- **登入**：沒有舊 token 可比，所以改成**先讀版本號、才檢查設備狀態**（順序見
  `loginHandler.js`）。撤銷發生在讀完版本號之後：設備檢查若追上撤銷，直接讀到
  `revoked` 擋下登入；若沒追上，登入照常簽發，但用的是撤銷前讀到的舊版本號——
  這個 token 一簽出來就已經追不上撤銷，不是逃過撤銷的那一種。兩種結果都安全，
  差別只在「擋在門口」還是「放行但已經過期」。

`server/test/authHandlers.test.js` 用 deferred promise 把交錯點釘死在
`findActiveById` / `verifyRequest` 這幾個真實的 await 點上，逼出三種交錯：
refresh vs 登出、refresh vs 裝置撤銷、login vs 裝置撤銷（含撤銷追上與追不上兩種
結果），不依賴 `setTimeout` 猜時間差。

---

## 五、營運與復原

### 5.1 上線的雞生蛋問題（部署前必須先解決）

上線當下**所有人都沒有已審批的設備，包含審批者自己**。審批者登不進去 → 沒有人能審批任何東西 → 全公司鎖死。

解法：`scripts/approveDevice.js`，在伺服器上直接對資料庫操作，把指定的 pending 綁定改成 approved（**要一併寫入 `reviewed_at`**，見 §5.4）。這支腳本同時是永久的 break-glass 路徑，日後全員被鎖在外面時也靠它。

上線程序：

1. 跑 migration —— 種入 `system-admin` 角色與 `device.approve` 權限（§1.3）
2. `node scripts/createUser.js <帳號>` —— 這是系統第一個使用者，自動取得 `system-admin`。密碼在提示字元輸入（不回顯），或由 stdin 餵進來：`<secrets-manager> | node scripts/createUser.js <帳號>`。**不接受把密碼寫在 command line**——那會留在 shell history 與 `ps` 的輸出裡
3. 該使用者在瀏覽器登入一次 —— 密碼會過，但設備還沒綁定，得到 `403 DEVICE_PENDING_APPROVAL`，同時在 `user_devices` 留下一筆 pending
4. `node scripts/approveDevice.js <id>` —— 核准他自己的設備
5. 他現在登得進去，且有 `device.approve`，之後所有人的設備都走正常審批流程

第 2 步和第 4 步是**兩個獨立的 bootstrap 步驟**：帳號存在不等於設備已綁定。

### 5.2 金鑰遺失

IndexedDB **不是持久儲存**。使用者清瀏覽器資料、Safari ITP 在 7 天無互動後清除、無痕視窗、公司政策清理——金鑰一沒，device_id 跟著變，使用者變成一台全新的未綁定設備，要重跑審批。

- 開機時呼叫 `ensurePersistentStorage()`（包住 `navigator.storage.persist()`）降低被清除的機率。**保證不了**：Chrome 依 engagement heuristics 決定、Firefox 可能問使用者、舊瀏覽器與非安全 context 根本沒有這個 API。所以每次開機都試一次而不是只在產生金鑰時試——第一次被拒之後，使用者用久了 engagement 上來，下次就可能批。已經 persisted 就直接返回，不重覆問
- 這會是**最大宗的客服來源**，審批流程必須夠輕（例如主管在系統內兩次點擊就能批），否則會塞住

### 5.3 撤銷設備

撤銷做兩件寫入：`tokenRevocation.revoke(subject, "device_revoked")` 推高版本號，以及把 `status` 改成 `revoked`。

**順序是承重的：先推版本號，再改狀態。** 兩者跨兩張表、沒有共用交易，所以一定會有一個先後，而反過來的話那個順序是會壞事的——改完狀態、推版本號失敗，會留下一台狀態顯示 `revoked`、手上 token 卻仍然有效到自己過期為止的設備；而重試會因為狀態已經不是 `approved` 而回 409，**永遠不會補做那次 token 撤銷**。也就是說那次失敗是永久性的少撤銷，而畫面上看起來是成功的。

照現在的順序，每一種失敗都落在安全的一邊，重試一定補得回來：

| 哪一步失敗 | 結果 | 重試 |
| --- | --- | --- |
| 推版本號 | 什麼都沒改，綁定仍是 `approved` | 完整重做 |
| 改狀態 | token 已撤銷（**多**撤，安全的方向），綁定仍是 `approved` | 完整重做 |
| 改狀態回 0 列（另一人同時做完） | 回 409，而最終狀態正確：已 `revoked` 且 token 已撤銷 | 不需要 |

代價是先查一次狀態：不查的話，對一台早就 `revoked` 的設備再按一次撤銷，會在什麼都不該發生的情況下把那個使用者從所有設備登出。查完到推版本號之間仍有一個極窄的窗，並行撤銷會讓版本號多推一次——那只是多一次登出，不是少一次撤銷。

⚠️ 版本號是**每個使用者一個**而不是每台設備一個，所以這會讓該使用者**在所有設備上一起登出**。這是可以接受的：其他設備都是已審批的，重新登入一次即可、不需要再審批。換來的是不必等最多 15 分鐘讓 JWT 自然過期。

⚠️ **撤銷不是全域瞬時的。** 處理這個請求的實例會馬上更新自己的快照，其他實例要等下一次刷新才看得到，上界是 `tokenRevocation.maxStalenessSeconds`（目前 60 秒，啟動時會與實際刷新間隔交叉檢查，見 `TokenRevocationService`）。所以多實例部署下，撤銷之後最多還有 `maxStalenessSeconds` 的時間，被撤銷的 token 在別的實例上仍然過得了關。

要把這個窗壓到零，得加一條跨實例的失效通知（pub/sub），或者讓撤銷檢查直接查資料庫而不是查快照——後者會把每個帶 token 的請求都變成一次資料庫查詢，那正是版本號快照這個設計要避免的事。兩者都不在目前的範圍內；現在的取捨是「有上界、上界明碼寫出來、啟動時驗證」。

不想影響其他設備的話，可以只改 status 不 revoke，代價是那台被撤銷的設備還能再用最多 15 分鐘。

因為這是唯一沒有自動兜底的路徑，它必須：**有 UI（不能只有 SQL）**、**夠快**（遺失電腦是分鐘級的事，不能是開單等處理）、**進離職 checklist**、**`last_used_at` 看得到**（唯一能讓人發現「這台三個月前就該撤銷了」的線索）。

### 5.4 綁定記錄的清理

由 `deviceBinding.purgeStaleDevices` job 每日執行，三條規則：

| # | 條件 | 保留期 | 針對的情況 |
| --- | --- | --- | --- |
| 1 | `status = 'pending'`，看 `requested_at` | 1 個月 | 申請了但沒人理，或使用者早就換機器了 |
| 2 | `status = 'approved'` 且 `last_used_at IS NULL`，看 `reviewed_at` | 14 天 | 核准了卻從來沒用過——通常是使用者中途清掉了瀏覽器資料，金鑰已經不存在 |
| 3 | `last_used_at IS NOT NULL`，看 `last_used_at` | 1 個月 | 用過但已經停用的設備，不分狀態 |

```sql
DELETE FROM user_devices
WHERE (status = 'pending'
         AND requested_at   <= :oneMonthAgo)
   OR (status = 'approved' AND last_used_at IS NULL
         AND reviewed_at    <= :fourteenDaysAgo)
   OR (last_used_at IS NOT NULL
         AND last_used_at   <= :oneMonthAgo);
```

`last_used_at` 在每次登入與每次續期（約 15 分鐘一次）都會更新，所以**使用中的設備永遠碰不到規則 3**。

規則 2 的 14 天是刻意比規則 1 短的：核准過的設備佔著一個「已信任」的位置，而它從沒被用過通常代表金鑰那一端已經不在了，留著只是讓審批者的設備清單變髒。

**三條規則刻意留下的縫**（這些列永久保留）：

- `rejected` 且從未使用過 —— 這是被拒絕設備的**正常狀態**。留著代表**拒絕的決定不會被時間沖掉**：同一把金鑰再來申請時，審批者看得到它前科。上一版「不分狀態一律一個月」會把這個訊號刪掉，新規則順手修掉了
- `revoked` 且從未使用過 —— 邊界情況（核准後沒用過就被撤銷），無害

**已決定：`revoked` 且用過的設備不特別保留**，照規則 3 在一個月後刪除。已知後果：一台被撤銷的電腦，一個月後可以用同一把金鑰以「全新未知設備」的身分重新申請，審批者看不到它曾經被撤銷過。

這個取捨可以接受，因為重新申請仍然需要正確的密碼、仍然需要人審批——被撤銷的設備要回到線上，得同時過這兩關。失去的只是審批者手上的一個歷史線索。日後若想改回保留，在規則 3 加一句 `AND status <> 'revoked'` 即可。

清理不需要額外索引：這張表的大小是「使用者數 × 每人設備數」，日排一次全表掃描完全可以接受；三條 OR 分支跨不同欄位，MySQL 本來也用不上索引。

**實作注意**：核准的路徑（含 §5.1 的 break-glass 腳本）**必須寫入 `reviewed_at`**。漏了的話那筆列會同時逃過規則 2（`reviewed_at IS NULL`）和規則 3（`last_used_at IS NULL`），變成永遠清不掉的孤兒。

`user_device_nonces` 由另一支 job `deviceBinding.purgeNonces` 高頻清理，只保留簽章時效窗內的列。

---

## 六、對現有程式碼的改動

| 檔案 | 改動 |
| --- | --- |
| `server/config/jwt.js` | `JWT_EXPIRES_IN` 預設 `2h` → `15m` |
| `server/config/security.js` | `cors.allowedHeaders` 加五個 `X-Device-*` |
| `server/config/deviceBinding.js` | **新增**：`signatureMaxSkewSeconds`、`nonceRetentionSeconds`、`staleDeviceRetentionDays`、演算法參數 |
| `server/database/migrations/0004_*.js` | **新增**：`user_devices`、`user_device_nonces`、`device.approve` permission、`system-admin` role（含 role_id 1 的守衛） |
| `server/scripts/createUser.js` | `users` 表為空時，自動授予第一個帳號 `system-admin`；密碼改由 stdin 讀，不再收 command line 參數 |
| `server/src/services/deviceBinding/` | **新增**：`DeviceBindingService`（驗簽、查狀態、審批）+ 兩支清理 job |
| `server/src/handlers/user/loginHandler.js` | 加設備驗證與三種 403；responseSchema 加 `expiresInSeconds` 與 `sessionExpiresInSeconds` |
| `server/src/handlers/user/refreshTokenHandler.js` | **新增**（`authType: "jwt-device"`，只管換不換發，不再自己驗設備） |
| `server/src/services/auth/jwtDeviceAuthStrategy.js` | **新增**：JWT + 設備簽章的 authStrategy，繼承 `JwtAuthStrategy` |
| `server/src/framework/authorization/authorizationPolicyRegistry.js` | `authenticated` / `hasRole` / `hasPermission` 改判「有沒有 claims」，不再寫死判斷 `auth.type === "jwt"` |
| `server/src/handlers/device/` | **新增**：審批佇列與 approve / reject / revoke |
| `server/src/modules/user/UserService.js` | 加一支「重讀 status + roles + permissions」給續期用 |
| `server/scripts/approveDevice.js` | **新增**：break-glass |
| `client/src/framework/auth/deviceKey.js` | **新增**：金鑰產生、IndexedDB 存取、thumbprint、簽名 |
| `client/src/framework/auth/tokenStorage.js` | 加 deadline 的讀寫 |
| `client/src/framework/http/HttpClient.js` | 需要簽名的請求掛上 `X-Device-*` header |
| `client/src/main.js` | session watchdog（四個觸發點 + 活動追蹤 + Web Locks 續期） |
| `client/src/pages/device/` | **新增**：pending 等待頁、我的設備、審批佇列頁 |
| `client/config/auth.js` | 加 tick / 續期閾值 / 閒置逾時 / 警告門檻參數 |

`fr_token_versions`、`TokenRevocationService`、`JwtAuthStrategy` 本身**完全不動**——撤銷仍然是唯一那一套機制，`JwtDeviceAuthStrategy` 是繼承它、疊加設備簽章檢查，不是重寫一份。

---

## 七、實作狀態

四個階段都已經落地。

| 階段 | 內容 | 主要位置 |
| --- | --- | --- |
| 1 ✅ | 兩張表的 migration、角色權限種子、`DeviceBindingService`、break-glass 腳本 | `database/migrations/0004_*.js`、`src/services/deviceBinding/`、`scripts/approveDevice.js` |
| 2 ✅ | 登入要求設備簽章、三種 403、`expiresInSeconds`、前端金鑰與等待審批頁 | `src/handlers/user/loginHandler.js`、`client/src/framework/auth/deviceKey.js` |
| 3 ✅ | 續期端點（含 `users.status` 檢查）、前端 watchdog、活動閘門、Web Locks | `src/handlers/user/refreshTokenHandler.js`、`client/src/framework/auth/sessionWatchdog.js` |
| 4 ✅ | 審批佇列與我的設備、approve / reject / revoke | `src/handlers/device/`、`client/src/pages/device/` |

⚠️ **部署順序**：階段 2 一上線，所有沒有已審批設備的使用者都會登不進去。階段 1 的 migration 與 break-glass 腳本必須先上線並確認可用。完整程序見 §5.1。

### 測試涵蓋到哪裡

- **簽章格式的跨端契約**由前後端各一條 golden 測試釘住（§2 末段）
- **真資料庫的整合測試**走完整條路：待審批 → 核准 → 登入 → 續期 → 換設備被拒 → 登出後既不能用也不能續期 → 審批者用 HTTP 清佇列 → 重覆核准回 409 → 沒有 `device.approve` 的人拿不到佇列
- **每檔覆蓋率門檻**涵蓋 `loginHandler`、`refreshTokenHandler` 與 `DeviceBindingService`。三者壞掉都沒有症狀：畫面上什麼都不會變，只是本來該結束的 session 一直活著

驗證要用 CI 的指令（`DB_INTEGRATION_TESTS=1 npm run test:coverage`）。`npm test` 不含覆蓋率門檻，而整合測試預設是 skip 的——本機綠燈不代表 CI 會綠。

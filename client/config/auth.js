/**
 * 認證相關設定。
 *
 * Token 存在 localStorage，代價是任何一次 XSS 都等於憑證外洩。補償措施有四項，
 * 都不是選配的：正式建置的 CSP（config/csp.js）、禁用 v-html 的 lint 規則、
 * 後端的短 token 效期加即時撤銷、依賴稽核。見專案 README。
 *
 * 設備私鑰是另一回事：它存在 IndexedDB 且是 non-extractable，XSS 帶不走
 * （見 src/framework/auth/deviceKey.js）。所以「被偷的 token 可以自己無限續期」
 * 這條路是斷的——續期要求設備簽名。
 */
const authConfig = {
  // localStorage 的鍵名。整個應用只有 token 儲存層會讀寫它。
  tokenStorageKey: "erp.token",

  // token 到期時刻（epoch 毫秒）的鍵名。
  //
  // 存絕對時刻而不是存 JWT 自己的 exp 去比本地時鐘：使用者的時鐘不可信，而這個
  // 值是用「收到當下的 Date.now() + 伺服器給的秒數」算出來的，只依賴「收到之後
  // 過了多久」。睡眠期間 wall clock 照常前進，所以闔上筆電再打開也算得對。
  tokenDeadlineKey: "erp.token.deadline",

  // 絕對 session 上限的到期時刻（epoch 毫秒）的鍵名。
  //
  // 同 tokenDeadlineKey 分開存，因為兩者是兩件事：token 的到期時刻每次背景續期
  // 都會往後跳，session 的到期時刻不會動。合成一個的話，續期就會把上限一併推
  // 掉，而那正是後端花力氣防住的事（見 JWT_SESSION_MAX_AGE）。
  sessionDeadlineKey: "erp.session.deadline",

  // 未登入時要轉去的路徑。
  loginPath: "/login",

  // 設備還在等待審批時要轉去的路徑。
  devicePendingPath: "/device/pending",

  // 登入成功後預設落在哪一頁（沒有記到原本要去的路徑時）。
  homePath: "/",

  // 設備金鑰存在哪個 IndexedDB。
  deviceKeyDbName: "erp.device",

  // 設備金鑰的曲線與雜湊。必須與 server/config/deviceBinding.js 一致，否則
  // 後端會把每一份合法簽章都判成公鑰不符。
  deviceKeyCurve: "P-256",
  deviceKeyHash: "SHA-256",

  // session watchdog 每隔多久檢查一次。
  refreshTickMs: 60_000,

  // 剩多少時間就去換新 token。
  //
  // **必須遠大於 refreshTickMs。** 反過來的話會在第一個週期就漏掉：例如 10 分鐘
  // 檢查一次、剩 1 分鐘才續，到期時間落在「檢查後 1 分鐘到 10 分鐘」之間時，
  // 兩次檢查都不會觸發，token 就這樣死了。5 分鐘配 60 秒的 tick 也順帶給一次
  // 短暫斷網 5 次左右的重試機會——續期沒有 401 兜底，所以可重試是硬性要求。
  refreshThresholdMs: 5 * 60_000,

  // 多久沒有真實使用者操作就停止續期。
  //
  // 這是「多久不續期」的門檻，不是「多久後登出」：停止續期那一刻手上還有一個
  // 沒用完的 token。實際登出 = 這個值 + 5 到 15 分鐘（下界是 token 壽命減續期
  // 週期，上界是整個 token 壽命），所以 30 分鐘對應到最後一次操作後的 35–45
  // 分鐘。
  //
  // 注意「活動」只認這個應用分頁裡的操作：使用者開著 ERP 轉去 Excel 做四十
  // 分鐘，對這個機制來說是純閒置。真正防「有人走到沒鎖的電腦前」的是作業系統
  // 的螢幕鎖定，這裡是它後面的第二道。
  idleTimeoutMs: 30 * 60_000,

  // 續期一直失敗、又剩不到這麼多時間，就提醒使用者存檔。
  expiryWarningThresholdMs: 2 * 60_000,

  // 絕對 session 上限剩不到這麼多時間，就提醒使用者存檔並準備重新登入。
  //
  // 比 expiryWarningThresholdMs 長很多，因為兩者的性質不同：那個是異常狀況
  // （續期一直失敗），多半自己會好；這個是必然會發生的事，每個使用者每天都會
  // 撞到一次，而且撞到之後沒有任何補救——只能重新登入。10 分鐘是留給人把手上
  // 那張單填完、存檔的時間。
  //
  // 必須遠大於 refreshTickMs（60 秒），否則會在兩次 check() 之間整段跳過。
  sessionWarningThresholdMs: 10 * 60_000
};

export default authConfig;

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
  deviceKeyHash: "SHA-256"
};

export default authConfig;

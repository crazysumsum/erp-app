/**
 * 設備綁定認證的設定。設計說明見 docs/device-binding-auth.md。
 *
 * 登入與續期都要求請求帶著設備私鑰的簽章。簽章覆蓋 method、path、body 雜湊、
 * timestamp 與 nonce——少了前三者，簽章只證明「這台設備某個時候簽過東西」，
 * 不證明「這個請求來自這台設備」，攻擊者可以把簽章搬到另一個請求上。
 *
 * 此文件只保存配置資料，不應加入 function 或執行任何初始化邏輯。
 */
const deviceBindingConfig = {
  // 簽章的 timestamp 與伺服器時間容許相差多少秒。這是一個雙向的窗：
  // |timestamp - now| <= 這個值。
  //
  // 設得太小，使用者機器上幾十秒的時鐘偏差就會讓他完全登不進去，而錯誤訊息
  // 只會說簽章過期；設得太大，一份被側錄的簽名請求可重放的時間就跟著變長。
  signatureMaxSkewSeconds: 60,

  // nonce 記錄保留多久（秒），到期由 deviceBinding.purgeNonces 刪除。
  //
  // 必須 >= signatureMaxSkewSeconds：一個 timestamp 為 T 的簽章在 T + skew
  // 之前都還會被接受，nonce 若比那個時點早刪掉，同一份請求在剩下的窗裡重放
  // 就會成功——防重放等於漏了一個尾巴，而且完全沒有症狀。啟動時交叉檢查。
  nonceRetentionSeconds: 300,

  // 已核准但從未使用過的設備保留多久（天）。
  //
  // 比 staleDeviceRetentionDays 短是刻意的：核准過的設備佔著一個「已信任」的
  // 位置，而它從沒被用過通常代表金鑰那一端已經不在了（使用者清掉了瀏覽器
  // 資料），留著只會讓審批者的設備清單變髒。
  unusedApprovedRetentionDays: 14,

  // 其餘設備記錄的保留期（天）：pending 看 requested_at，用過的看 last_used_at。
  //
  // last_used_at 在每次登入與每次續期（約 15 分鐘一次）都會更新，所以使用中的
  // 設備永遠碰不到這個期限。
  staleDeviceRetentionDays: 30,

  // 簽章演算法。驗證時只接受這一組，防止演算法降級攻擊。
  //
  // 用 ECDSA P-256 而不是 RSA：Web Crypto 產 RSA-2048 金鑰在弱機器上是可見的
  // UI 停頓，而 P-256 近乎瞬間；簽章也從 256 bytes 降到 64 bytes。
  namedCurve: "P-256",
  hashAlgorithm: "sha256"
};

export default deviceBindingConfig;

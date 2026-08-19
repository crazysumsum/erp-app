/**
 * 認證相關設定。
 *
 * Token 存在 localStorage，代價是任何一次 XSS 都等於憑證外洩。補償措施有四項，
 * 都不是選配的：正式建置的 CSP（config/csp.js）、禁用 v-html 的 lint 規則、
 * 後端的短 token 效期加即時撤銷、依賴稽核。見專案 README。
 */
const authConfig = {
  // localStorage 的鍵名。整個應用只有 token 儲存層會讀寫它（Phase 3）。
  tokenStorageKey: "erp.token",

  // 未登入時要轉去的路徑。
  loginPath: "/login",

  // 登入成功後預設落在哪一頁（沒有記到原本要去的路徑時）。
  homePath: "/"
};

export default authConfig;

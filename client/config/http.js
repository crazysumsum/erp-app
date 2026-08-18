/**
 * HTTP 客戶端設定。對應 server/config/api.js 與 request.js。
 */
const httpConfig = {
  // 後端 API 的位址。CSP 的 connect-src 讀的是同一個環境變數（見 config/csp.js）
  // ——兩邊不一致的話請求會被 CSP 擋下，而瀏覽器只會說「被 CSP 拒絕」。
  baseUrl: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",

  // 單一請求的逾時（毫秒）。設得比後端的 REQUEST_TIMEOUT_MS（預設 30 秒）短一點，
  // 這樣逾時會由前端主動中止，使用者拿到的是一句明確的訊息，而不是一個吊死的
  // 載入指示器。
  timeoutMs: 25000,

  // 攜帶 JWT 的 header 名稱與 scheme。必須與 server/config/jwt.js 一致。
  authHeaderName: "Authorization",
  authScheme: "Bearer"
};

export default httpConfig;

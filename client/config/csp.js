/**
 * 正式建置產物的 Content Security Policy。
 *
 * 這是 localStorage 存 token 這個選擇下最重要的補償措施：token 讀得到就代表任何
 * 一次 XSS 都等於憑證外洩，而 CSP 是唯一能在「注入成功」與「腳本真的跑起來」
 * 之間擋一道的東西。
 *
 * 它必須落在**送出 HTML 的那一邊**——dev 時的 Vite server、正式部署時的靜態
 * 主機。後端 API 也有一組 helmet 的預設 CSP，但那組只套用在 API 的 JSON 回應
 * 上，保護不到這個頁面。
 *
 * 各項的理由：
 *
 *   default-src 'self'      沒有明確列出的資源類型一律只准同源。
 *   script-src 'self'       這是真正在防的那一條：沒有 'unsafe-inline'，注入的
 *                           <script> 與 onerror= 都不會執行。Vite 建置出來的是
 *                           外部 module 檔案，不需要 inline。
 *   style-src 加 'unsafe-inline'
 *                           Quasar 與 Vue 都會寫 inline style（元件的 :style
 *                           綁定、動態主題色）。CSS 注入的危害遠低於腳本執行，
 *                           這是這份政策裡唯一的妥協。
 *   img-src 加 data:        Quasar 的圖示與內嵌小圖用 data: URI。
 *   font-src 加 data:       @quasar/extras 的字型會被 Vite 內嵌成 data: URI。
 *   connect-src             XHR/fetch 的目的地：同源，加上後端 API。API 不同源
 *                           時要把它加進來，否則所有請求會被 CSP 擋下。
 *   object-src 'none'       <object>／<embed> 沒有任何用途，關掉。
 *   base-uri 'self'         擋 <base> 注入改寫所有相對路徑的手法。
 *   form-action 'self'      表單只能送回自己這裡。
 *
 * frame-ancestors（防點擊劫持）只在 header 版本裡。瀏覽器**明確忽略** meta 元素
 * 送來的這一條，還會為此在 console 留一筆錯誤——放進 meta 不只沒有保護，還會
 * 讓每次載入都噴一個看起來像壞掉的訊息。要它就得由主機送 header，見下面的
 * `contentSecurityPolicyHeader`。
 */

// API 的來源由呼叫端傳進來，不在這裡讀環境變數：Vite **不會**把 .env 載進
// process.env（那是 import.meta.env 的事，而那個只存在於瀏覽器端的程式碼裡），
// 所以在這裡讀 process.env 只會永遠拿到 fallback 值。那個錯誤是靜默的——CSP
// 會指向錯的 API 來源，而症狀只是「請求被 CSP 擋下」，不會有任何東西說是哪個
// 設定不對。vite.config.js 用 Vite 的 loadEnv() 取值後傳進來。
function directivesFor(apiOrigin) {
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", apiOrigin],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"]
  };
}

// 只有 header 送得出去的部分。
const headerOnlyDirectives = {
  "frame-ancestors": ["'none'"]
};

function serialize(source) {
  return Object.entries(source)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

/** 寫進 index.html 的 <meta http-equiv>。由 vite.config.js 在正式建置時注入。 */
export function contentSecurityPolicy(apiOrigin) {
  return serialize(directivesFor(apiOrigin));
}

/**
 * 完整版，給送出 HTML 的主機當 `Content-Security-Policy` header 用。
 *
 * 兩者可以並存：瀏覽器會同時套用，取交集。能設 header 就設，這樣才拿得到
 * frame-ancestors；設不了（很多靜態主機不讓改 header）也還有 meta 版本兜底。
 */
export function contentSecurityPolicyHeader(apiOrigin) {
  return serialize({ ...directivesFor(apiOrigin), ...headerOnlyDirectives });
}

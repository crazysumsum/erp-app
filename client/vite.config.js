import { fileURLToPath } from "node:url";
import { quasar } from "@quasar/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";
import { contentSecurityPolicy } from "./config/csp.js";

export default defineConfig(({ command, mode }) => {
  // 用 loadEnv 而不是 process.env：Vite 只把 .env 載進 import.meta.env（瀏覽器端），
  // process.env 在這裡讀不到 .env 的值。見 config/csp.js 的說明。
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_");
  const apiOrigin = env.VITE_API_BASE_URL || "http://localhost:3000";

  return {
    plugins: [
      vue(),
      quasar(),
      // CSP 只注入正式建置的產物。dev server 的 HMR 需要 inline script 與 eval，
      // 套用正式版的 CSP 會讓開發完全動不了；而 dev server 只監聽本機，不是要防的
      // 東西。見 config/csp.js。
      injectContentSecurityPolicy(command === "build", apiOrigin)
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        // config/ 與 src/ 平行擺放，對應後端 server/config/ 與 server/src/ 的分法，
        // 所以它需要自己的 alias——從 src 深處寫 ../../../config 只會在搬檔案時斷掉。
        "@config": fileURLToPath(new URL("./config", import.meta.url))
      }
    },
    server: {
      port: 5173
    }
  };
});

/**
 * 把 CSP 以 <meta http-equiv> 寫進 index.html。
 *
 * 用 meta 而不是 HTTP header，是因為前端會被丟到某個靜態主機上，而我們不能假設
 * 那台主機讓人設 header——meta 版本跟著 HTML 走，換哪個主機都在。真的能設
 * header 的話，header 更好（meta 版本管不了 frame-ancestors 與 report-uri），
 * 兩者可以並存，見 config/csp.js。
 */
function injectContentSecurityPolicy(enabled, apiOrigin) {
  return {
    name: "erp-inject-csp",
    transformIndexHtml(html) {
      if (!enabled) {
        return html;
      }

      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(apiOrigin)}" />`
      );
    }
  };
}

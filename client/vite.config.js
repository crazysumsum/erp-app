import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quasar } from "@quasar/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite";
import { contentSecurityPolicy } from "./config/csp.js";

/**
 * 找出真正裝著依賴的那個 node_modules。
 *
 * npm workspaces 把依賴提升到 repo 根目錄。平時那個根目錄就在專案裡面，Vite 預設
 * 的 fs 白名單（workspace root）本來就蓋得住；但在 git worktree 裡面，那個根目錄
 * 在 worktree 外面，於是 dev server 會拒絕提供 node_modules 底下的檔案——實際症狀
 * 是 Quasar 的字型回 403，而任何斷言「console 沒有錯誤」的瀏覽器測試都會因此變紅。
 *
 * 不能用「往上找第一個 node_modules」：npm 會在 client/ 底下也放一個
 * node_modules，往上找會停在那裡，而那裡沒有 quasar。所以改用 module resolution
 * 問 Node 依賴實際在哪，再取路徑裡第一段 node_modules。
 */
function dependencyRoot() {
  const resolved = createRequire(import.meta.url).resolve("vue");
  const marker = `${path.sep}node_modules${path.sep}`;
  const index = resolved.indexOf(marker);
  return index === -1 ? null : resolved.slice(0, index + marker.length - 1);
}

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
      port: 5173,
      // 指定 allow 會蓋掉 Vite 的預設值，所以要把 workspace root 一起列回去，否則
      // 連 src/ 都會被擋。這只影響 dev server 讀檔的範圍，跟 build 產物無關。
      fs: { allow: [searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url))), dependencyRoot()].filter(Boolean) }
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

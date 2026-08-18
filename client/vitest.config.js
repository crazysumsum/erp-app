import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { quasar } from "@quasar/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// 用 Node 自己的解析器找 Quasar 的檔案位置，不寫死相對路徑：npm workspaces 會把
// 依賴提升到根目錄的 node_modules，寫死 ./node_modules/... 在這裡根本不存在。
const require = createRequire(import.meta.url);

/**
 * 測試設定與 vite.config.js 分開：那一份帶著 CSP 注入，而那個 plugin 在測試裡
 * 沒有意義（它改的是 index.html）。
 *
 * Quasar plugin 則必須留著：Quasar 的元件是靠它做自動 import 轉換的，少了它
 * `app.use(Quasar)` 仍然會成功，但 <q-card> 之類的標籤永遠不會被解析成元件——
 * 而測試看到的只是「找不到這個 class」，不會有任何錯誤指向設定。
 *
 * alias 必須跟 vite.config.js 一致，否則測試裡的 `@/` 與 `@config/` 會解析不到
 * ——而那個錯誤看起來會像「模組不存在」，不像設定不同步。
 */
export default defineConfig({
  plugins: [vue(), quasar()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@config": fileURLToPath(new URL("./config", import.meta.url)),
      // Quasar 的 package exports 裡，`node` 這個 condition 指向 SSR 建置。
      // Vitest 跑在 Node 上，所以不指定的話一定會中那一個——而它預期有 SSR
      // context，在 jsdom 裡安裝 plugin 只會丟一句 "Cannot convert undefined or
      // null to object"，完全看不出是解析到了錯的檔案。這裡明確指向瀏覽器版本，
      // 也就是 dev 與正式建置實際跑的那一份。
      quasar: require.resolve("quasar/dist/quasar.client.js")
    }
  },
  test: {
    // 元件測試需要 DOM。
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.js"],
    server: {
      deps: {
        // 不 inline 的話，Vitest 會照 Node 的 export condition 解析到 Quasar 的
        // SSR 建置（quasar.server.prod.js）——那一份預期有 SSR context，在
        // jsdom 裡安裝 plugin 會直接丟 "Cannot convert undefined or null to
        // object"，而錯誤訊息完全看不出是解析到錯的檔案。
        inline: ["quasar"]
      }
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // 目前只有一個驗證用元件，門檻等 Phase 2 的 HttpClient 落地——那才是
      // 前端第一段值得釘住覆蓋率的邏輯——再設。先設一個數字只會逼著為了
      // 湊數而寫測試。
      include: ["src/**/*.js", "src/**/*.vue"]
    }
  }
});

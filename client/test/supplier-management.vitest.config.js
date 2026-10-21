import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.js";

// supplier-client-ui suite（00_project_profile.json）：同主設定一樣嘅 plugin 同 alias，
// 只係淨跑 Supplier 嘅前端測試。唔用 mergeConfig：佢會將兩邊嘅 include 陣列併埋，
// 結果照跑晒全部測試。root 固定喺 client/，唔靠 npm 喺邊度起步。
export default defineConfig({
  ...baseConfig,
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    ...baseConfig.test,
    include: ["test/pages/suppliers/**/*.test.js", "test/services/supplier*.test.js"]
  }
});

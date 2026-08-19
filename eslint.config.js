import js from "@eslint/js";
import globals from "globals";
import vue from "eslint-plugin-vue";

// 這個框架大量使用 duck typing（例如 typeof x.require === "function"），沒有型別
// 檢查護航，所以 lint 的重點放在能真正擋下缺陷的規則：未使用的變數、意外的
// 全域變數、被丟掉的 Promise 等，而不是排版偏好。
const correctness = {
  "no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrors: "none"
    }
  ],
  "no-undef": "error",
  "no-console": "off",
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": "error",
  "no-return-await": "error",
  // 對 `req.auth = await strategies.authenticate(...)` 這類寫法會誤報。req 與 res
  // 是逐請求物件，不會被其他請求共用，這裡不存在該規則設想的競態。
  "require-atomic-updates": "off",
  "no-promise-executor-return": "error",
  "no-unmodified-loop-condition": "error",
  "no-constant-binary-expression": "error",
  "no-self-compare": "error",
  "no-template-curly-in-string": "error",
  "no-unsafe-optional-chaining": "error"
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "server/logs/**"
    ]
  },
  js.configs.recommended,
  {
    files: ["server/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: correctness
  },
  {
    files: ["client/**/*.js", "client/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser }
    },
    rules: correctness
  },
  // .vue 檔案先前完全沒有被 lint 到：上面的 glob 只 match .js/.mjs，所以整個
  // 元件層——也就是前端絕大部分的程式碼——一條規則都沒有套用過。
  //
  // 用 essential 而不是 recommended：後者大半是排版規則（屬性要不要換行、單行
  // 元素要不要斷行），與這份設定開頭講的原則相反——lint 要擋的是缺陷，不是
  // 排版偏好。essential 收的是真的會出事的那一類：重複的 key、v-for 少了 key、
  // 用了不存在的元件語法。
  ...vue.configs["flat/essential"],
  {
    files: ["client/**/*.vue"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser }
    },
    rules: {
      ...correctness,
      // v-html 是 Vue 裡唯一一個預設會繞過跳脫的出口，而 token 存在 localStorage
      // 的前提下，一次 XSS 就等於憑證外洩。要用的地方必須明確 disable 並在
      // review 說明為什麼那段內容是可信的。
      "vue/no-v-html": "error"
    }
  },
  {
    files: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node }
    }
  }
];

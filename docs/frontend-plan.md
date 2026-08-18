# 前端框架建構計劃

目標：前端同後端一樣，把公共功能一次做好，之後開發業務頁面只需要**新增一個檔案**，唔使重複處理認證、版面、菜單、錯誤處理、表格分頁呢啲嘢。

已確認嘅三個決定：

| 決定 | 選擇 | 主要影響 |
| --- | --- | --- |
| 認證 API | 先建後端 `login` / `logout` / `me` | Phase 0 為阻塞項，前端一開始就接真 API |
| UI 元件庫 | **Quasar** | Phase 5、Phase 6 工作量大幅減少（見下文） |
| Token 儲存 | **localStorage** | 後端零框架改動；冇 CSRF 問題；前端需要防 XSS |

---

## 一、現況與缺口

- ~~**後端只有一支 API**：`src/handlers/` 只有 `healthHandler.js`。冇 login / logout / me，冇 `users`、`roles` 資料表。~~ → **Phase 0 已完成**：`login` / `logout` / `me` 三支 handler、`users` / `roles` / `permissions` 資料表、`UserService` 同建立帳號腳本都已落地。
- **後端認證機制已齊備**：`JwtService.issue()` 可簽發、`tokenRevocation` 支援撤銷、授權策略已註冊 `allowAll` / `authenticated` / `hasRole` / `hasPermission`。前端只需對接。
- **後端已經支援 header token**：`JwtAuthStrategy.authenticate()` 讀 `Authorization: Bearer <token>`，CORS 亦已允許 `Authorization` header 同 `http://localhost:5173` —— **localStorage 方案唔需要改任何後端框架程式碼**，只需要新增 handler。
- **前端係零基礎**：單一個 `App.vue`，冇 router、冇 store、冇測試，而且 **ESLint 完全冇覆蓋 `.vue` 檔案**（`eslint.config.js` 只 match `client/**/*.js`）。

---

## 二、設計原則：前端點樣對應後端

| 後端概念 | 前端對應 | 說明 |
| --- | --- | --- |
| Handler（`static api`） | **Page**（`export const page`） | 一個檔案 = 一條路由 + 一個菜單項 + 一組權限 |
| `handlers/` 自動發現 | `pages/**/*.vue` 經 Vite `import.meta.glob` 發現 | 加檔案即生效，唔使改 router |
| Service（`static service`） | **Service**（同名 metadata） | 可重用業務邏輯，注入到頁面 |
| `authorizationPolicies: hasPermission` | `page.requires.permissions` | 用同一組 claim 名，前後端一致 |
| 啟動時驗證設定，錯就拒絕啟動 | boot 時驗證 metadata，錯就出 fatal 畫面 | 唔容許帶住壞設定跑 |
| 統一 response 信封 | HttpClient 統一拆信封 | 頁面只見到 `data` |
| `ApplicationError` → 標準錯誤格式 | `ApiError` → 統一提示 | 頁面唔使逐個 try/catch |

**刻意唔對應嘅地方**（照搬會變包袱）：

- 前端 Service **只有 singleton**，冇 `request` / `transient` 生命週期、冇關機順序 —— 瀏覽器冇 request 生命週期呢回事。
- **冇 Job / scheduler 對應物** —— 前端唔應該有背景排程。
- 自動發現係**編譯期**（Vite glob）而唔係執行期掃目錄，行為上一樣係「加檔案就得」，但錯誤喺 build / boot 時就會出。

---

## 三、localStorage 方案：好處同要補嘅防護

選 localStorage 之後，「請求自動加上 JWT header」就係字面意思 —— HttpClient 由 storage 讀 token，自動加 `Authorization: Bearer <token>`。

**帶嚟嘅簡化：**

1. **後端零框架改動**。`JwtAuthStrategy` 已經讀 header、CORS 已經配置好、唔使裝 `cookie-parser`。Phase 0 只係新增 handler，符合框架原本「加檔案，唔改框架」嘅設計。
2. **冇 CSRF 問題**。Token 要 JS 主動讀出嚟加 header，唔會被瀏覽器自動附上，所以唔需要 double-submit token、CSRF 中介層呢套機制。
3. **唔需要同源部署**。唔使 Vite dev proxy，唔使煩 `SameSite=None` + HTTPS，前端日後可以獨立部署到另一個網域或 CDN。
4. **除錯容易**，而且日後手機 App、第三方整合可以用同一套 header 認證。

**要補嘅防護（因為 token 俾 JS 讀得到，XSS 就等於 token 外洩）：**

5. **Content Security Policy**：CSP 要落喺**送出 HTML 嗰一邊**——即係 dev 時嘅 Vite server、正式部署時嘅靜態主機——唔係後端 API。API 回嘅係 JSON，佢自己嘅 CSP 保護唔到前端頁面。（後端經 helmet 已經有一組嚴格嘅預設 CSP，`default-src 'self'`、`object-src 'none'`、`script-src 'self'`，唔需要再加。）呢項屬於 Phase 1。
6. **前端唔用 `v-html`**：Vue 預設會 escape，`v-html` 係主要嘅自開後門途徑。列入 lint 規則同 code review 檢查點。
7. **短 token 效期 + 撤銷**：維持現有 `JWT_EXPIRES_IN=2h`，並用已有嘅 `tokenRevocation` 支援即時踢人。
8. **依賴稽核**：`npm audit --audit-level=high` 已經喺 `npm run verify` 關卡入面，前端依賴一齊納入。

---

## 四、Quasar 帶嚟嘅簡化

Quasar 唔只係元件庫，佢自帶版面系統同大量後台元件，所以原本要自己砌嘅嘢大幅減少：

- **版面外殼**：`QLayout` + `QDrawer`（左菜單）+ `QPageContainer`（右內容）+ `QToolbar` 直接提供固定版面，我哋只需要配置同接上菜單資料。
- **表格**：`QTable` 內建分頁、排序、篩選、載入狀態，支援 server-side 模式，只需要把佢嘅參數同後端 query schema 對接。
- **表單**：`QForm` + `QInput` / `QSelect` / `QDate` 內建 `:rules` 驗證同錯誤顯示。
- **對話框 / 提示**：Quasar `Dialog`、`Notify`、`Loading` plugin 直接可用。

所以 Phase 5、Phase 6 由「實作元件」變成「**寫薄封裝**」—— 封裝仍然需要，目的係令頁面唔使重複寫 fetch、分頁參數、錯誤映射呢啲接線邏輯，但每個封裝細好多。

**整合方式**：用 `@quasar/vite-plugin`，保留現有 Vite + npm workspace 結構。（另一條路係 Quasar CLI，會用佢自己嘅腳手架同 dev server 取代現有 client 工具鏈，好處係日後轉 SSR / 手機 App 較方便；對一個後台 ERP 而言暫時唔值得換走已經行得好嘅設定。）

---

## 五、目標：加一頁要做啲咩

計劃完成之後，新增一個業務頁面 = **新增一個檔案**：

```vue
<script>
export const page = {
  name: "orderList",
  path: "/orders",
  title: "訂單管理",
  menu: { group: "sales", order: 10, icon: "receipt" },
  requires: { permissions: ["order.read"] }
};
</script>

<script setup>
import { useService } from "@/framework";
const orderApi = useService("order");
</script>

<template>
  <DataTable :fetch="orderApi.list" :columns="columns" />
</template>
```

自動得到：路由、左側菜單項（權限唔夠自動隱藏）、麵包屑、分頁標題、JWT header、錯誤處理、載入狀態、分頁。

---

## 六、分階段計劃

### Phase 0 — 後端認證 API（阻塞項）

1. **資料表 migration**：`users`（帳號、密碼雜湊、狀態）、`roles`、`permissions` 及關聯表。密碼用 **scrypt**（`node:crypto` 內建）雜湊，**唔可以存明文**。原本寫 argon2／bcrypt，改用 scrypt 係因為嗰兩個都要 node-gyp 原生編譯，而呢個專案預設擋安裝腳本；scrypt 同樣係記憶體困難嘅 KDF，參數存喺雜湊字串入面所以日後可以調高。
2. **`LoginHandler`**（`POST /api/v1/auth/login`，`authType: "public"`）：驗證帳密 → 由 `tokenRevocation.currentVersion()` 攞 version → `jwt.issue()` → response body 回傳 token 同 user 資料。**帳號鎖定**：連續 5 次失敗鎖 15 分鐘（自動到期）。原本寫「用已有嘅 `requestLimiter`」，但佢係全域 per-IP token bucket，做唔到 per-route 或 per-account 限制，所以改為喺 `users` 表記失敗次數。
3. **`LogoutHandler`**（`POST /api/v1/auth/logout`）：撤銷當前 token（bump version），令 token 即時失效而唔使等 2 小時過期。
4. **`MeHandler`**（`GET /api/v1/auth/me`）：回傳當前 user、roles、permissions，作為前端 session 嘅唯一真實來源。
5. **建立首個帳號嘅腳本**：`npm run create-user -- <username> <password> --role admin`。登入 API 需要一個已存在嘅帳號，而建立帳號嘅 API 需要一個已登入嘅人——呢支腳本就係打破呢個循環嗰一步。

   驗證：curl 登入攞到 token；用 token 叫 `/me` 回傳正確 roles / permissions；登出之後同一個 token 即時被拒；連續 5 次密碼錯會鎖定帳號。

   > **已完成**（見 `server/src/handlers/`、`server/src/services/user/`）。原本列喺呢個 phase 嘅「配置 CSP」已經移去 Phase 1：CSP 要落喺送出 HTML 嗰一邊先有用，而後端 API 經 helmet 已經有嚴格嘅預設 CSP。

### Phase 1 — 前端地基：依賴與工具鏈

6. **裝依賴**：`vue-router`、`pinia`、`quasar`、`@quasar/vite-plugin`、`@quasar/extras`（圖示字型）。
7. **設定 Vite**：加 Quasar plugin、`@/` path alias。
8. **註冊 Quasar plugins**：`Notify`、`Dialog`、`Loading`。
9. **配置前端 CSP**：dev 用 Vite `server.headers` 落 CSP，正式部署由靜態主機／reverse proxy 落同一組。限制 `script-src` 至 `'self'`——呢個係 localStorage 方案下對 XSS 最有效嘅一道防線，而且**只有喺送出 HTML 嗰一邊先有作用**。要留意 Vite dev 會用 inline script 同 eval，dev 同 prod 嘅 CSP 需要分開設。
10. **補 ESLint 覆蓋 `.vue`**：加 `eslint-plugin-vue`，喺 `eslint.config.js` 加 `client/**/*.vue` glob 同對應 parser；同時加規則禁止 `v-html`（XSS 防線）。
11. **加前端測試**：`vitest` + `@vue/test-utils` + `jsdom`，client workspace 加 `test` script。
12. **接入 CI 關卡**：root `npm run verify` 由只跑 server 改成前後端都跑 lint 同測試。
13. **建立 `client/config/`**（對應 `server/config/`）：`app.js`（標題、分頁大小）、`http.js`（baseURL、逾時）、`auth.js`（token storage key、登入路徑、逾時行為）、`menu.js`（菜單群組定義）。

    驗證：`npm run lint` 捉到 `.vue` 內嘅錯誤同 `v-html` 使用；`npm run verify` 前後端都跑；Quasar 元件喺頁面正常顯示。

### Phase 2 — HTTP 層

14. **`framework/http/HttpClient.js`**：包住 `fetch`，統一 baseURL、逾時（`AbortController`）、JSON 序列化。
15. **自動注入 JWT header**：每個請求自動由 storage 讀 token 並加 `Authorization: Bearer <token>`，header 名同 scheme 同後端 `config/jwt.js` 對齊。
16. **自動拆信封**：成功時 `{success, data, meta}` → 直接回 `data`；失敗時 `{success:false, error}` → `throw new ApiError(code, message, details, requestId)`。
17. **統一 HTTP 狀態處理**：401 清 session + 轉登入頁（記住原本路徑）；403 顯示無權限；429 讀 `Retry-After` 提示；5xx 顯示 `requestId` 方便查後端 log。
18. **Idempotency 支援**：呼叫時加 `{ idempotent: true }` 自動帶 `Idempotency-Key`（`crypto.randomUUID()`），對應後端 idempotency 機制。
19. **請求取消**：頁面卸載自動 abort 未完成請求，避免 race 同已卸載元件更新狀態。

    驗證：單元測試覆蓋信封拆解、錯誤映射、401 轉向、逾時、header 注入。

### Phase 3 — 認證與授權

20. **Token 儲存層**：集中喺一個模組讀寫 localStorage（日後要改儲存方式只改呢一個檔）。
21. **`stores/session.js`（Pinia）**：保存 token、user、roles、permissions；提供 `login()`、`logout()`、`restore()`。
22. **開機還原 session**：App 啟動時如果 storage 有 token 就叫一次 `/me` 確認仲有效 —— 有效即已登入，401 即清除 storage 當未登入。避免用過期 token 進入系統再逐個請求失敗。
23. **登入頁 `pages/login.vue`**：標記 `page.public = true`，唔套用 AppShell 版面。
24. **登出**：叫後端 `/logout` 撤銷 token，再清 storage 同轉登入頁。
25. **路由守衛**：未登入 → 轉登入頁；已登入但權限唔夠 → 403 頁；登入後跳返原本目標路徑。
26. **`can()` / `v-can`**：對應後端 `hasRole` / `hasPermission` 嘅比對邏輯（支援 `match: "all" | "any"`），用嚟控制頁內按鈕顯示。

    驗證：測試守衛三種情境；無權限用戶直接打 URL 見到 403 而唔係頁面；重新整頁保持登入；登出後 token 即時失效（後端拒絕）。

### Phase 4 — 自動發現 + 路由 + 菜單

27. **`framework/discovery/pages.js`**：`import.meta.glob("@/pages/**/*.vue", { eager: true })` 收集所有 `export const page`。
28. **啟動驗證**（對應後端「設定錯就唔啟動」）：檢查 `name` / `path` 全域唯一、必填欄位齊、`menu.group` 喺 `config/menu.js` 有定義、`requires` 格式正確；任何一項唔過就顯示 fatal 畫面並**指名邊個檔案錯**。
29. **路由生成**：由 metadata 生成 vue-router routes，全部包喺 AppShell 之下（`public` 頁除外），加 404 頁。
30. **菜單生成**：按 `menu.group` + `menu.order` 組樹，經權限過濾；**冇 `menu` 欄位嘅頁面有路由但唔上菜單**（詳情頁、編輯頁用）。
31. **`framework/discovery/services.js`**：同樣機制發現 `src/services/**/*.js`，`useService(name)` 取用，缺依賴喺 boot 時報錯而唔係執行期。

    驗證：新增一個測試頁面檔案，唔改任何其他檔案，路由同菜單自動出現；故意寫重複 `name` 會 boot 失敗並指名檔案。

### Phase 5 — 版面外殼（用 Quasar）

32. **`AppShell.vue`**：`QLayout` + `QDrawer`（左菜單，可收合）+ `QPageContainer`（右內容）+ `QHeader`。
33. **`Sidebar.vue`**：用 `QList` / `QExpansionItem` 渲染菜單樹，當前路由高亮，群組可摺疊。
34. **`Topbar.vue`**：當前用戶、登出按鈕，按需要加通知。
35. **`PageHeader.vue`**：由頁面 metadata 自動出標題同麵包屑，右側留 slot 俾頁面放操作按鈕。
36. **錯誤邊界**：`onErrorCaptured` 攔截頁面例外，顯示錯誤區塊而唔係白畫面。
37. **響應式**：窄畫面 `QDrawer` 自動變抽屜式（Quasar 內建行為，只需配置）。

    驗證：瀏覽器實測切換頁面、收合菜單；用唔同權限嘅帳號登入見到唔同菜單。

### Phase 6 — 業務開發套件（薄封裝 Quasar）

38. **`DataTable.vue`**：封裝 `QTable` 嘅 server-side 模式，把佢嘅 `request` 事件同分頁 / 排序 / 篩選參數，接上 HttpClient 同後端 query schema，統一載入 / 空 / 錯誤狀態。
39. **`FormPanel.vue`**：封裝 `QForm`，重點係**把後端回傳嘅 `error.details`（schema 驗證錯誤）自動對應返去各個欄位顯示** —— 呢個係 Quasar 冇提供、而每個頁面都會用到嘅接線。
40. **`useCrud()` composable**：一個 resource 嘅 list / create / update / delete 樣板，令新增一個 CRUD 頁面約 20 行。
41. **`confirm()` / `notify()` 薄封裝**：統一刪除確認同操作提示嘅文案風格，底層用 Quasar `Dialog` / `Notify`。

    驗證：用呢套砌一個真實 CRUD 頁面，同手寫版本比較行數同重複程式碼。

### Phase 7 — 範例與文件

42. **落地一個真實業務頁**：建議「用戶管理」，啱好用到 Phase 0 建嘅 `users` / `roles` 表，可以完整驗證整條鏈路。
43. **寫 `client_framework_readme.md`**：對應後端框架文件，重點係「點樣加一個頁面 / 加一個 Service」同 metadata 欄位說明。
44. **更新 `README.md`**：補前端架構同開發流程。

    驗證：照住文件由零加一個新頁面，唔使問人。

---

## 七、目錄結構

```
client/
  config/                  # 對應 server/config/
    app.js                 # 標題、分頁大小
    http.js                # baseURL、逾時
    auth.js                # token storage key、登入路徑、逾時行為
    menu.js                # 菜單群組定義（順序、標籤、圖示）
  src/
    framework/             # 對應 server/src/framework/ —— 業務開發唔會改呢度
      discovery/           # 頁面／Service 自動發現 + 啟動驗證
      http/                # HttpClient、ApiError、信封拆解
      auth/                # token 儲存、session store、路由守衛
      authorization/       # can()、v-can、權限比對
      layout/              # AppShell、Sidebar、Topbar、PageHeader
      routing/             # 由頁面 metadata 生成 router
      services/            # BaseService + 極簡容器
      ui/                  # DataTable、FormPanel、confirm、notify
      errors/              # 錯誤邊界、fatal 畫面
    pages/                 # ★ 業務開發只加呢度
    services/              # ★ 同可重用業務邏輯
    main.js
```

---

## 八、風險與注意事項

- **XSS 係呢個方案嘅主要風險**，因為 token 俾 JS 讀得到。緩解措施必須真係做：CSP（Phase 0）、禁 `v-html` 嘅 lint 規則（Phase 1）、依賴稽核（已喺 `verify` 關卡）、短效期 + 撤銷（已有）。呢啲唔係選配項。
- **Phase 0 係阻塞項**，但風險比 cookie 方案低好多 —— 唔使改動任何現有框架程式碼，只係新增 handler 同 migration。
- **密碼雜湊唔可以做錯**：用 argon2 或 bcrypt，唔好自己砌。
- **Quasar 有自己嘅樣式系統**，同現有 `styles.css` 可能有衝突，Phase 1 要決定係全面採用 Quasar 樣式定係保留部分自訂樣式。
- **日後如果要提高安全等級**（處理敏感財務數據、開放外部用戶存取），可以改返 httpOnly cookie。因為 token 存取集中喺 Phase 3 嘅儲存層同 Phase 2 嘅 HttpClient，前端改動範圍可控；主要成本喺後端（cookie 解析、`JwtAuthStrategy` 改造、CSRF 機制、同源部署）。

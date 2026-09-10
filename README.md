# erp-app

> **說明**：本專案是從 [node_simple_crud_backend](https://github.com/crazysumsum/node_simple_crud_backend) 複製出來的獨立新專案，與原專案沒有 fork 關聯，可自由修改、獨立演進。

本專案的後端框架（Handler / Job / Service 架構、安裝與啟動、開發指引等）沿用自 node_simple_crud_backend，詳見：

- [框架說明文件（中文）](framework_readme.md)
- [Framework documentation (English)](framework_readme.en.md)

## 專案內容

（TODO：補充 erp-app 本身的專案簡介、業務範圍與進度）

目前已完成的業務模組：

- **商品管理（Item Management）**：見下方「商品管理模組」一節，以及 [需求文件](docs/items_management/requirement.md)、[設計文件](docs/items_management/design_spec.md)、[任務清單](docs/items_management/tasks.md)。

## 商品管理模組（Item Management）

Item／SKU 主資料、Category／Brand／UOM／Attribute catalog、CSV 批次匯入匯出、媒體附件。設計細節見 [design_spec.md](docs/items_management/design_spec.md)，這裡只記運維會用到的事：資料庫遷移、部署設定、持久化 volume、背景 worker、固定價格口徑、備份還原與 rollback 策略、release smoke steps。

### Migration

跟 Step 3 用同一個指令，`npm run migrate` 已經涵蓋 Item Management 的所有資料表（`database/migrations/0013_*` 到 `0026_*`：`item_categories`、`item_brands`、`item_uoms`、`items`、`item_skus`、`item_sku_uoms`、`item_sku_barcodes`、`item_attributes` 系列、`item_media`、`item_audit_logs`、`item_import_jobs`、`item_import_rows`）。每支 migration 都是 `CREATE TABLE IF NOT EXISTS`，重跑是安全的、可以跟主要 framework migration 一起執行，不需要分開跑。

### 設定（`server/config/item.js`）

只放會隨部署環境變動的數字與路徑；狀態機、追蹤政策、條碼種類等已確認的 domain constants 定義在 `server/src/modules/item/itemConstants.js`，**不吃環境變數**（見下面「固定價格口徑」）。

| 環境變數 | 預設值 | 用途 |
| --- | --- | --- |
| `ITEM_CATEGORY_MAX_DEPTH` | `8` | Category tree 最大層數 |
| `ITEM_MEDIA_DIRECTORY` | `storage/items` | Item／SKU 媒體受控儲存根目錄（見下面「持久化 volume」） |
| `ITEM_IMAGE_MAX_BYTES` | `5242880`（5MB） | 單張圖片上限 |
| `ITEM_ATTACHMENT_MAX_BYTES` | `10485760`（10MB） | 單個附件上限 |
| `ITEM_MEDIA_ORPHAN_GRACE_MS` | `86400000`（1 天） | Media metadata 已刪、實體檔案還保留多久才會被清理 job 動 |
| `ITEM_IMPORT_DIRECTORY` | `storage/imports` | CSV 匯入來源／結果檔受控儲存根目錄（見下面「持久化 volume」） |
| `ITEM_IMPORT_MAX_ROWS` | `10000` | 單一匯入 Job 允許的最大資料列數 |
| `ITEM_IMPORT_BATCH_SIZE` | `200` | 匯入執行階段每個 transaction batch 的列數 |
| `ITEM_IMPORT_TRANSACTION_TIMEOUT_MS` | `120000` | 匯入執行 transaction 最長時間 |

### 持久化 volume

`ITEM_MEDIA_DIRECTORY`（媒體）與 `ITEM_IMPORT_DIRECTORY`（CSV）是兩個獨立的受控目錄，部署時都必須掛到持久化儲存（不能是容器的臨時檔案系統）——重啟／重新部署遺失這兩個目錄，會令 DB 裡的 `item_media`／`item_import_jobs` 記錄指向不存在的檔案。兩者刻意分開（不合併成一個目錄），因為保留規則不同：media 沒有到期日，import 檔 1 年後由 retention job 清（見下面 worker 一節）。

### 背景 Worker

Item Management 的排程工作跟框架其餘 job 一樣由 `server/config/scheduler.js` 統一開關，各自用獨立的 job 名稱（不共用 lock key）：

| Job 名稱 | Scope | 預設週期 | 做什麼 |
| --- | --- | --- | --- |
| `itemMedia.cleanupOrphans` | cluster | 每日 | 掃 `ITEM_MEDIA_DIRECTORY`，清走 DB 已經沒有引用、超過 `ITEM_MEDIA_ORPHAN_GRACE_MS` 的檔案 |
| `itemImport.validate` | instance | 每 5 秒輪詢一次 | Claim 一個 `uploaded` 匯入 Job，做 preflight 驗證 |
| `itemImport.execute` | instance | 每 5 秒輪詢一次 | Claim 一個 `queued` 匯入 Job，套用到 Item／SKU |
| `itemImport.fileCleanup` | cluster | 每日 | 掃已終結（`invalid`／`completed`／`failed`／`cancelled`）、滿 1 年保留期的匯入 Job，刪走 `ITEM_IMPORT_DIRECTORY` 底下的原始檔／結果檔，Job summary／audit 不受影響（見 DEC-023） |

`itemMedia.cleanupOrphans` 同 `itemImport.fileCleanup` 是 `cluster` scope——因為持久化 volume 是所有實例共用的儲存，只需要一個實例真正執行清理；`itemImport.validate`／`execute` 是 `instance` scope，靠 `item_import_jobs` 自己的 `lease_owner`／`lease_until` compare-and-set 互斥，多個實例可以各自並行處理不同的 Job。

### 固定價格口徑

建議零售價（`suggestedRetailPrice`）固定用公司基礎幣別 **HKD**、稅務口徑固定 `tax_not_applicable`，定義在 `server/src/modules/item/itemConstants.js`，**不接受環境變數或 API request 覆寫**。這是已確認的業務決策（design_spec DEC-016、BR-025），不是部署設定——要換幣別或稅務口徑必須先改 requirement 文件再改程式碼，不能用環境變數繞過。

### 備份與還原

Item／SKU／Catalog／稽核（`item_audit_logs`）／匯入 metadata（`item_import_jobs`／`item_import_rows`）全部是一般 MySQL 資料表，納入既有的 MySQL backup／restore／災難復原演練即可，不需要另外一套機制。`ITEM_MEDIA_DIRECTORY`／`ITEM_IMPORT_DIRECTORY` 兩個持久化 volume 必須以**同一個 recovery point** 跟資料庫一起備份——還原資料庫但沒有同步還原媒體檔案，會出現指向不存在檔案的孤兒記錄。

### Forward-only rollback

`server/database/migrations/` 底下沒有 `down()`：每支 migration 都是 `CREATE TABLE IF NOT EXISTS`，只新增、不動既有表。這代表 schema 變更**沒有自動 rollback**——一旦某個版本的 migration 在 production 套用過，回退程式碼版本並不會撤銷 schema 變更。出錯時的做法是往前修（寫一支新 migration 修正問題），不是往後退版本；這也是為什麼 Checkpoint L 要求「Migration 在 staging 由現行版本升級及重跑均成功」而不是「驗證 rollback」。

### 業務 catalog 首版樣本

以下係開發階段建立嘅**示範性範例資料**，唔係正式業務資料，僅供本機開發／smoke test 用嚟驗證 Category／UOM／Attribute／internal Barcode 呢幾類 catalog 資料嘅建立同使用流程——**正式環境嘅首版 catalog 內容需要業務正式核准，唔可以直接沿用呢份範例**：

| 類型 | 範例值 |
| --- | --- |
| Category（3 級） | 食品 › 飲品 › 樽裝飲品 |
| Brand | 示範品牌 A |
| UOM | `EA`（件，base）、`BOX`（箱，to_base_factor=24） |
| Attribute | 容量（decimal）、口味（single_option：原味／檸檬味） |
| Internal Barcode | `INT-DEMO-000001` |

用 `npm run create-user` 建立管理員帳號後，透過前端「商品管理 → Category／Brand／UOM／Attribute」頁面手動建立即可；沒有另外的 seed script（catalog 資料量小、由使用者手動維護，寫一個一次性 seed script 換不到什麼）。

### Release smoke steps

手動走一次完整生命週期，確認 UI 同 API 都正常：

1. 建立一個 Draft Item（含至少一個 SKU）。
2. 轉做 Active。
3. 用 SKU Code／條碼／名稱搜尋，確認查得到。
4. 更新一個欄位，確認新值可查見、稽核記錄有前後值。
5. 停用（Inactive）再復原（Active），確認狀態轉換同稽核都正確。
6. 查看稽核紀錄（Audit）。
7. 上傳一張圖片／附件（Media），確認顯示同下載正常。
8. 匯出 SKU（CSV），匯入一個小 CSV（Import），確認結果正確。

## 程式碼放哪裡

後端的 `server/src/` 底下分三種角色，界線由**目錄**維持，而不是靠命名習慣或口頭約定：

| 目錄 | 放什麼 | 誰負責建立 |
| --- | --- | --- |
| `framework/` | 框架本身。開發業務功能時不會改這裡。 | — |
| `services/` | **公用技術服務**：資料庫、日誌、排程、限流、認證策略、檔案型別。跟業務無關，換一個專案照樣適用。 | 框架自動發現並注入 |
| `modules/` | **業務模組**：只在這個 ERP 有意義的邏輯，例如 `modules/user/`（帳密驗證、角色權限）。 | Handler 直接 `import` 再自己建 |
| `handlers/` | 一支 API 一個檔案，**按 URL 前綴分子目錄**（見下）。 | 框架自動發現並註冊路由 |

判準只有一句：**這段程式碼換一個專案還適不適用？**適用就是 `services/`，不適用就是 `modules/`。

### Handler 的子目錄就是 URL 前綴

`handlers/` 底下的子目錄名稱對應 API 路徑的前綴，放在最上層的 handler 則沒有前綴：

| 檔案 | URL |
| --- | --- |
| `handlers/user/loginHandler.js` | `/api/v1/user/login` |
| `handlers/user/meHandler.js` | `/api/v1/user/me` |
| `handlers/healthHandler.js` | `/api/v1/health` |

框架本身**不強制**這件事——它照目錄遞迴發現 handler，路徑則完全由 `static api.path` 決定，兩者之間沒有任何連結。所以這個約定由 `test/handlerConventions.test.js` 守著：路徑跟目錄對不上，測試會直接指名是哪一支 handler。沒有這個測試的話，約定會慢慢漂移，最後目錄結構跟 URL 結構各說各話，而不會有任何東西出聲。

### 前端的目錄

`client/` 底下 `config/` 與 `src/` 平行擺放，對應後端 `server/config/` 與 `server/src/` 的分法：

| 目錄 | 放什麼 |
| --- | --- |
| `config/` | 設定資料，不放邏輯：`app.js`（標題、分頁大小）、`http.js`（API 位址、逾時）、`auth.js`（token 儲存鍵、登入路徑）、`menu.js`（菜單群組）、`csp.js`（正式建置的 CSP） |
| `src/` | 應用程式碼。`@/` 指向這裡，`@config/` 指向 `config/` |
| `test/` | Vitest 測試 |

## 前端安全：CSP

Token 存在 localStorage，代價是任何一次 XSS 都等於憑證外洩。CSP 是唯一能在「注入成功」與「腳本真的跑起來」之間擋一道的東西，所以它不是選配的。

政策定義在 `client/config/csp.js`，**只注入正式建置的產物**——dev server 的 HMR 需要 inline script 與 eval，套用正式版 CSP 會讓開發完全動不了，而 dev server 只監聽本機。

部署時有兩層，建議都做：

1. **`<meta>`（已自動處理）**：`npm run build` 會把政策寫進 `dist/index.html`。換哪個靜態主機都在。
2. **HTTP header（要主機配合）**：把 `contentSecurityPolicyHeader(apiOrigin)` 產生的字串設成 `Content-Security-Policy` header。這一層才拿得到 `frame-ancestors`（防點擊劫持）——瀏覽器**明確忽略** meta 送來的這一條。

API 位址改了要一起改：CSP 的 `connect-src` 與前端讀的 `VITE_API_BASE_URL` 是同一個值，兩邊不一致的話請求會被 CSP 擋下，而瀏覽器只會說「被 CSP 拒絕」，不會說是哪個設定不對。

另一道防線是 lint：`vue/no-v-html` 設為 error，因為 `v-html` 是 Vue 裡唯一預設繞過跳脫的出口。

### 為什麼業務模組不走自動發現

`services/` 的自動發現機制附帶一整套生命週期管理——啟動順序、關機順序、依賴圖驗證、eager／lazy。那些是技術服務需要的（資料庫要比用它的人先開、後關），業務邏輯不需要。讓業務模組也走同一套，只會把它綁進框架的生命週期，換來的好處是零。

所以業務模組就是普通的 class，依賴以建構參數傳入：

```js
// server/src/handlers/loginHandler.js
import { UserService } from "../modules/user/UserService.js";

constructor(services = {}) {
  super(services);
  this.userService = new UserService({
    database: services.require("mysqldatabase"),   // 技術服務仍然從 container 拿
    logger: services.require("logging").logger,
    time: services.require("time")
  });
}
```

附帶的好處是測試不需要先架一個 service container，直接給替身就可以。

## 安裝與啟動

### 需求

- Node.js 26+
- npm 10+
- MySQL 5.7+

### Step 1：安裝依賴

```bash
npm install
```

這是一個 npm workspaces 專案，`npm install` 會一次安裝 `client/` 與 `server/` 兩個 workspace 的依賴。

### Step 2：建立環境變數檔

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

`server/.env` 至少要確認／填入：

- `JWT_SECRET`：**必填，沒有預設值**，用以下指令產生一組：

  ```bash
  openssl rand -base64 48
  ```

- 其餘欄位（`DB_HOST`、`DB_USER`……）如果照 Step 3 用 `init.sql` 建立本機資料庫，保留預設值即可。

### Step 3：準備 MySQL

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < server/database/init.sql
cd server && npm run migrate
```

第一行用 root/管理員帳號建立資料庫（`erp_dev`）與應用程式帳號（`erp_user`），只需要執行一次；第二行套用框架與業務的資料表，`git pull` 之後重新執行是安全的（已套用的檔案會被跳過）。

### Step 4：建立第一個帳號

```bash
cd server && npm run create-user -- admin "選一個強密碼" --name "System Admin" --role admin
```

登入 API 需要一個已存在的帳號，而建立帳號的 API 需要一個已登入的人——這支腳本就是打破這個循環的那一步。密碼以 scrypt 雜湊儲存，不會寫進資料庫明文。

### Step 5：啟動開發伺服器

```bash
npm run dev
```

同時啟動 API 伺服器（`http://localhost:3000`）與 Vue 前端（`http://localhost:5173`）。也可以用 `npm run dev:server` / `npm run dev:client` 分開啟動。

啟動後可呼叫 `http://localhost:3000/api/v1/health` 驗證安裝成功，應回傳 `database: connected`。

更詳細的步驟說明與疑難排解（MySQL 補充），見 [框架說明文件](framework_readme.md#二安裝與啟動)。

## 程式碼品質關卡

```bash
npm run verify
```

依序跑三道關卡，**前後端都涵蓋**：ESLint（含 `.vue`）、測試加覆蓋率（server 用 `node --test`，client 用 Vitest）、依賴安全稽核。

單獨跑某一部分：

```bash
npm test --workspace client
npm run test:watch --workspace client
```

client 目前只有一個煙霧測試，覆蓋率沒有設門檻——第一段值得釘住的前端邏輯是 Phase 2 的 HttpClient，那時再設。先設一個數字只會逼著為了湊數而寫測試。

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) 四個 job 並行跑，互相沒有依賴：依賴掃描、lint、前端建置、以及帶 MySQL service 的測試。

**CI 不是強制關卡。** 這個 repo 目前是私有的免費方案，GitHub 分支保護要求 Pro 或轉 public，兩者都還沒做，所以檢查紅了照樣 merge 得到——`main` 完全靠自律守住。Merge 前務必看 `gh pr checks` 或 PR 頁面的檢查結果，不要假設「開了 PR 就有人幫忙擋」。

### 為什麼要真的接 MySQL

`test` job 起一個 MySQL service，跑 `npm run migrate` 建表，再連真資料庫跑測試——這是刻意的，不是排場。`server/test/` 底下所有單元測試都用假 pool（`test-support/fakeMySqlPool.js`），比對的是「SQL 字串有沒有包含 `FROM roles r`」這類片段；表名、欄名、join 條件打錯字，假 pool 照樣通過。`server/database/migrations/0003_add_auth_tables.js` 那個會 `DROP TABLE users` 的守衛邏輯，在這之前也從來沒有真的執行過一次。

[test/integration/authFlow.integration.test.js](server/test/integration/authFlow.integration.test.js) 補這個缺口：起一個真的 `application`、打真 HTTP 請求，讓 `UserService` 的 join、`tokenRevocation` 的版本號比對、JWT 簽發驗證全部真的跑一次。

**本機預設不跑**：這組測試靠 `DB_INTEGRATION_TESTS=1` 開關，沒設就 `skip`（在測試報告裡看得到，不是靜默通過），這樣沒裝 MySQL 的環境 `npm test` 照樣能跑。本機要跑就跟 Step 3、Step 4 一樣先準備好 MySQL 與 migration，再：

```bash
DB_INTEGRATION_TESTS=1 npm test --workspace server
```

CI 的 `test` job 一定會設這個變數——那裡的 MySQL 是特地起的，連不上就該讓 build 紅，不該被當成「這個環境沒有資料庫」而悄悄跳過。

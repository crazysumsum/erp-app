# erp-app

> **說明**：本專案是從 [node_simple_crud_backend](https://github.com/crazysumsum/node_simple_crud_backend) 複製出來的獨立新專案，與原專案沒有 fork 關聯，可自由修改、獨立演進。

本專案的後端框架（Handler / Job / Service 架構、安裝與啟動、開發指引等）沿用自 node_simple_crud_backend，詳見：

- [框架說明文件（中文）](framework_readme.md)
- [Framework documentation (English)](framework_readme.en.md)

## 專案內容

（TODO：補充 erp-app 本身的專案簡介、業務範圍與進度）

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

更詳細的步驟說明、疑難排解（MySQL 補充）、程式碼品質檢查（`npm run verify`）等，見 [框架說明文件](framework_readme.md#二安裝與啟動)。

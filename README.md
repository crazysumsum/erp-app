# erp-app

> **說明**：本專案是從 [node_simple_crud_backend](https://github.com/crazysumsum/node_simple_crud_backend) 複製出來的獨立新專案，與原專案沒有 fork 關聯，可自由修改、獨立演進。

本專案的後端框架（Handler / Job / Service 架構、安裝與啟動、開發指引等）沿用自 node_simple_crud_backend，詳見：

- [框架說明文件（中文）](framework_readme.md)
- [Framework documentation (English)](framework_readme.en.md)

## 專案內容

（TODO：補充 erp-app 本身的專案簡介、業務範圍與進度）

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

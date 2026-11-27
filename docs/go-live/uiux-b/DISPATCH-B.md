# UI/UX 方案 B 派工（Sam 2026-11-27「照建議 B」）

來源：本目錄 `REPORT.md`（版本 b97b38a6，高 2／中 32／低 24）。編號照報告。

## 上線前範圍

- H1 中文角色名：已由 #422 合併。
- H2 商品啟用原因：item-01，在合併隊列中。
- `.env.example` 補 `CUSTOMER_IMPORT_ROOT`（customer-01，已派）及 `AR_INVOICE_COMPANY_NAME`（apar-01）。
- 八類：
  1. X-3 分頁中文化，以及角色頁「1–0 of 0」。
  2. M-U1 粵語改書面語。
  3. X-1 金額、數量格式。
  4. X-8 英文欄名、狀態改中文。
  5. X-11 顯示單號，不顯示內部 ID。
  6. X-10 數字 ID 篩選改為名稱或代碼搜尋。
  7. M-P1 貨幣欄顯示 undefined。
  8. M-P3 審批原因字數提示錯誤。

不在範圍，留待上線後：空狀態用字（X-4）、按鈕用字（X-5）、對話框按鈕次序（X-6）、成功提示及跳轉（X-7）、工程化說明（X-9）、匯入頁統一（X-12，`.env.example` 除外）、用語細節（X-13）、狀態色（X-14）、草稿規則（X-15）、表格寬度（X-16），以及其餘中、低項。

## 共用規則

- 只改前端顯示。
- 不改表結構。
- 不改 API 契約。若 X-10 需要新的查詢 API，先交 TL 裁定。
- 既有測試只可更新斷言文字，不刪、不跳過、不放寬。
- 每人一個 PR，內含自己模組的所有項目。
- 每個 PR 都要：
  - 根目錄 `npm run lint`；
  - client build；
  - 兩時區受影響 client 測試；
  - **真瀏覽器 Playwright 驗證受影響頁面**，並附截圖；
  - 非作者 TL 窄核；
  - ci-01 回執登記；
  - 由 PM 開 PR。
- 合併時間：新功能隊列（應收貸項、應付貸項、退款、銷售退貨連結、瀏覽器 CI、F-09）完成之後。分支現在就可以開始做。
- 共用基礎（第一階段）先合併，各模組 PR 隨後逐個合併。

## 第一階段：sharedfeatures-01（共用基礎）

- X-3：全域 Quasar 中文語系，統一分頁元件；修正角色頁總數顯示為「1–0 of 0」。
- M-U1：裝置待審、403、改密碼、用戶、角色及共用空表元件改為書面語。
- X-1：共用格式函式。
  - 金額按幣別小數位加千位號；HKD 為 2 位。
  - 數量去掉尾零。
  - 共用元件套用這兩個函式。
- X-8 詞彙表：今天先交草稿（中英對照，涵蓋報告 X-8 所列詞），TL 與 PM 審核後發給各模組。
- X-10：共用的名稱／代碼自動完成選擇器，只用現有的查詢 API；缺 API 的，列清單交 TL。

## 第二階段：各模組套用（可先做不依賴共用基礎的項目）

| Agent | 項目 |
|---|---|
| purchasing-01 | M-P1、M-P3（現在就可以做）；M-P2 英文欄名；採購頁套用 X-1；X-10 採購單篩選（供應商、採購員） |
| sales-01 | M-S1（套用 X-1）；M-S2 英文及工程用語；X-10 銷售訂單篩選（客戶、倉庫）。排在銷售退貨連結之後 |
| fulfillment-01 | M-F1（分配時顯示庫位、批號，不顯示「庫存 6」）；揀貨不顯示分配 ID；M-F5 用語；X-10 履約及出貨篩選 |
| inventory-01 | M-I2、M-I3 英文欄名及狀態；M-I4 調撥用語，以及「Bin #1」改顯示庫位代碼（單號規則不改）；M-I5 預留來源顯示單號；X-10 庫存篩選 |
| apar-01 | M-AR1、M-AP2（X-10）；M-AR2 出貨單號；`.env.example` 加 `AR_INVOICE_COMPANY_NAME` |
| item-01 | X-8 商品頁欄名（SKU Code、Base 單位、RRP 等）。在 H2 之後做 |
| supplier-01 | X-8 供應商頁欄名（Supplier Code、Request ID、Business Master 等） |

完成後，UI/UX 檢查員會按報告重驗這八類。

## 上線後遺留（需新增 API，上線前不做）

- 庫存篩選（TL 65ffc42a）：Lot 歷史搜尋、操作者、來源單據。inventory-01 會逐欄列出缺哪個 API、需要什麼權限。
- X-10 匯總（TL 5554f9e6）：上線前只做權限相容的倉庫，以及倉庫內的庫位。其餘照舊用精確 ID 篩選，不放寬權限。
- 上線後要補的 API：
  1. 客戶及倉庫的唯讀代碼和名稱查詢，給 sales.view 或 fulfillment.view 使用。
  2. 供應商及採購員的歷史選項，給 purchasing.view 使用。
  3. 庫存（inventory-01 890df7fe）的 SKU 代碼和名稱，含停用項目；Lot 歷史，含零餘額；操作者名稱，不需要 user.mgmt；以及跨模組來源單號。
- 是否把第 1 項提前到上線前做，待 Sam 決定。
- 採購的供應商及採購員歷史選項（TL 248e83b2）：需要開放給 purchasing.view 使用的 choices API，回傳代碼和名稱，並包含非 active 的記錄。
- M-F1 批號（TL 09f39ec2）：preview 會鎖 Sales、allocation 及 Inventory balance，所以不自動呼叫。上線前首屏只顯示庫位。上線後在推薦 DTO 加 lotNumber。
- AR/AP 出貨單及銷售單搜尋（Codex TL f0d844e2）：部分比對，以及沒有履約權限時取得出貨單號，都需要新 API。上線前沿用完整編號搜尋。

## Sam 11-27「照建議做客戶倉庫」：上線前新增兩個唯讀查詢 API

依 TL 7d3d4455 草案：

- 回傳 `{ id, code, name, status }`。
- 每頁最多 50 筆。
- 用 q 按名稱或代碼做部分比對。
- 預設包含停用和封存的記錄。
- 不改表結構，不放寬權限。

| 端點 | 權限（任一） | 實作 |
|---|---|---|
| `GET /api/v1/customer-lookups/references` | customer.view、sales.view、fulfillment.view | customer-01 |
| `GET /api/v1/inventory-lookups/warehouses` | inventory.view、sales.view、fulfillment.view | inventory-01 |

- 前端：sharedfeatures-01 的共用選擇器接上這兩個來源；sales-01 套用到銷售訂單頁，fulfillment-01 套用到履約及出貨頁。
- 加路由之前，ci-01 先確認 API 註冊日誌離 256 KB 上限還有多少。
- 採購的供應商及採購員歷史，仍然留到上線後。

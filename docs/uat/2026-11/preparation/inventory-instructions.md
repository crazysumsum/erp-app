# Inventory 首期 UAT 資料包

適用 2026-11-26 UAT。以新 UAT 環境的空白庫位及尚未使用的 `UAT-*` SKU 操作。先建立主資料，後做失敗預檢及有效檔入帳。

## 建立主資料

1. 在商品主資料建立或重用啟用中的 `EA`、`BOX`。建立三級分類「UAT 測試 → UAT 商品 → UAT 庫存樣本」及品牌「UAT 樣本品牌」。末端分類與品牌名稱要分別唯一，匯入以名稱定位。
2. 在商品「匯入／匯出」選新增模式上傳 `01-item-import.csv`，確認 6 筆預檢有效後執行匯入。既有 CSV 建立 Draft Item／SKU、EA 及建議售價。
3. 確認匯入完成後，在 SKU 詳情補齊下表。A1／A2 保留 EA 為 Base、係數 1，清除 EA 的預設採購／銷售，新增 BOX、係數 24 並設為預設採購及銷售。B1／B2 的保存期限為 180 日，B1 最短到貨可用天數為 30 日。依商品頁的啟用流程將六組商品及 SKU 啟用，確認皆可採購、可銷售及追蹤庫存。
4. 在倉庫管理建立啟用的 `UAT-MAIN`、`UAT-SECOND`。各建 `UAT-PICK`，主倉另建 `UAT-HOLD`。逐一核對代碼和倉庫歸屬。

| SKU | 批次追蹤 | 單位 | 建議售價 |
| --- | --- | --- | ---: |
| UAT-A1 | 無 | EA／BOX ×24 | 100.00 |
| UAT-A2 | 無 | EA／BOX ×24 | 144.00 |
| UAT-B1 | 批號＋效期 | EA | 35.00 |
| UAT-B2 | 批號＋效期 | EA | 42.00 |
| UAT-C1 | 無 | EA | 12.50 |
| UAT-C2 | 無 | EA | 8.75 |

商品 CSV 的建議售價依 Item 契約填四位小數。銷售情境另在訂單指定真實交易單價與銷售單位。

## 匯入及對帳

1. 先上傳 `03-opening-invalid.csv`。第 2 列應顯示 B1 缺批號，第 3／4 列應顯示重複位置。預期 INVALID、無可入帳列，結存及異動皆不增加。
2. 上傳 `02-opening-valid.csv`。預期 8 筆 READY，第 10 列數量為零而略過。以已核准裝置和密碼，核對匯入編號、預檢版本與原因後確認。預期 COMPLETED。
3. 重整或以匯入編號查閱結果。在結存及異動頁核對以下分布，8 個正數 Bucket 合計 552 EA，共 8 筆 OPENING 入庫異動。B2 無期初庫存。C2 一筆隔離庫存不應進入可用量。

| 倉庫／庫位 | 預期結存 |
| --- | --- |
| UAT-MAIN／UAT-PICK | A1 144 EA、A2 96 EA、B1 EARLY 36 EA（2027-01-15）、B1 LATE 60 EA（2027-03-15）、C1 80 EA，均 AVAILABLE |
| UAT-MAIN／UAT-HOLD | C2 24 EA，QUARANTINED |
| UAT-SECOND／UAT-PICK | A1 72 EA、C1 40 EA，均 AVAILABLE |

## 閉環驗收切點

- **採購到入庫**：先用零結存 B2 買入 24 EA，收貨批號 `UAT-B2-R1`、到期日 2027-02-28。確認入庫後核對正好增加 24 EA 及單據對應的 RECEIPT。驗證低效期放行另用 B1，2026-11-26 的收貨可用到期日 2026-12-10，剩餘 14 日低於 30 日門檻。放行需具備既有權限及原因。實際 UAT 若改期，先按收貨業務日期重算到期日。
- **報價到出貨**：A1 用主倉，訂單 3 BOX × 100.00，基礎數量 72 EA。確認後核對預留 72 EA。揀貨與出貨分成 25／25／22 EA，核對分配與扣減，結存應依序由 144 變 119／94／72 EA。開票時核對銷售單位快照 BOX 與換算係數 24，分批金額依核准規則驗收。
- **批效驗收**：B1 可另開 12 EA 的揀貨情境，較早到期的 `UAT-B1-EARLY` 應優先於 `UAT-B1-LATE`。在採購新增 B1 批號之前驗證，避免變更測試候選順序。

## 已查證的 main 功能證據

核對基線 `df2f202469ce492f6d98e57eef10bbbeae6e52cd`。

| 行為 | 已有真 MySQL 功能整合案例 |
| --- | --- |
| 採購入庫增加結存 | `server/test/integration/inventoryPurchaseReceipt.integration.test.js` 的 A01，Inventory provider 原子將 0 改為 3 並記 RECEIPT。主線草稿 API 尚待 Purchasing TASK-032 Confirm 接入，採購瀏覽器閉環仍須驗。 |
| 訂單預留 | `server/test/integration/salesConfirmation.integration.test.js` 的 TC-021，真 Phase B 核對預留及 Backorder 對應量。 |
| 揀貨分配 | `server/test/integration/fulfillmentInventoryAllocation.integration.test.js` 的原生分配、部分釋放及重新分配，核對版本及持久結存。 |
| 出貨扣減 | `server/test/integration/fulfillmentInventoryStock.integration.test.js` 的原生批次 Issue／Restore，並有 `server/test/integration/fulfillmentSalesInventoryJoint.integration.test.js` 核對已分配存貨、Shipment 和 Sales Reservation 的共同交易。 |

資料包已用實際 Item 匯入解析與 SKU 啟用規則，以及 Opening 預檢，搭配合成主資料執行核對。UAT 環境載入及瀏覽器閉環待環境與對應功能就緒後執行。效能與容量驗證排在 UAT 後。

# Sales Order Management 業務需求書（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
|---|---|
| 文件名稱 | Sales Order Management 業務需求書 |
| 文件版本 | 0.1 |
| 文件狀態 | Draft — 待業務確認 |
| 建立日期 | 2026-09-08 |
| 目標系統 | 中小企批發及零售消耗品 ERP |
| 主要對象 | 業務負責人、銷售人員、營運人員、產品負責人、系統設計及 QA 團隊 |
| 前置模組 | User Management、Customer Management、Items Management、Inventory Management |
| 下游模組 | Fulfillment & Delivery、Invoicing、Accounts Receivable、Returns Management |

### 0.1 文件目的

本文件定義 Sales Order Management（下稱「銷售訂單管理」）第一階段的業務需求，作為後續系統設計、開發任務拆分及用戶驗收測試的唯一業務基線。

本模組面向每日約 10,000 張銷售訂單的中小企業。設計原則是簡單、實用、可追溯及能長期穩定運作，不在第一階段引入大型企業才需要的複雜定價、審批、跨倉調度或工作流引擎。

### 0.2 已確認的核心方向

1. 銷售訂單有三種來源：人工輸入、CSV 批量上傳、以及日後逐一實作的電商平台接口。
2. 第一階段需要建立可延伸的渠道接入邊界，但不實作任何指定電商平台的專屬對接模組。
3. 有效的 CSV 或渠道訂單應自動確認；單一訂單資料錯誤時，該訂單進入 Import Exception，不建立部分訂單，其他有效訂單可繼續處理。
4. 銷售訂單確認後立即向 Inventory Management 建立庫存 Reservation。
5. 庫存不足不阻止整張訂單確認；可保留數量建立 Reservation，未能保留的數量成為 Backorder。
6. 每張銷售訂單只使用一個 Fulfillment Warehouse；跨倉履約不屬於本模組第一階段。
7. 第一階段只維護最終 Unit Selling Price，可由 SKU 建議售價帶入後由銷售人員修改；不處理價格表、客戶價、促銷、折扣及銷售稅。
8. 本模組包括輕量級 Sales Quotation；報價單不保留庫存，一張報價單只可成功轉換為一張銷售訂單。
9. 報價單轉單時可按實際需要新增或刪除商品、修改數量及最終單價，並保存來源關係及差異摘要。
10. 已完成或已取消、沒有未完成下游事項且最後更新超過 24 個月的銷售訂單，每月自動歸檔。
11. 未完成及仍有 Backorder 的訂單不得自動歸檔；歸檔資料至少保存 7 年，並可查詢及匯出。
12. 歸檔不得改變業務結果，也不得以直接刪除正式業務資料代替歸檔。

### 0.3 版本紀錄

| 版本 | 日期 | 說明 |
|---|---|---|
| 0.1 | 2026-09-08 | 初版，記錄已確認需求、能力邊界、驗收準則及待確認假設 |

---

## 1. 業務背景、目標與成功指標

### 1.1 業務背景

公司以批發客戶為主，同時會從部分銷售渠道接收較大量訂單。人工批發訂單數量較少，可由銷售人員逐張建立；大型電商平台可在日後透過專屬 Adapter 自動導入；沒有接口的舊式渠道則以指定格式 CSV 批量開單。

每日約 10,000 張訂單代表系統不能只考慮日常建立及查詢，亦必須控制長期在線資料量。若全部歷史訂單永久保留在主要交易資料區，訂單列表、客戶查詢、報表及日常維護會隨年期增長而變慢。因此本模組必須同時具備清晰的活躍資料窗口、定時歸檔及歸檔查詢能力。

### 1.2 業務目標

- 以一套一致流程接收人工、CSV 及渠道訂單，避免不同來源各自建立不一致的訂單規則。
- 讓銷售人員快速建立批發訂單，並清楚看到客戶、商品、價格、庫存保留及缺貨狀態。
- 在訂單確認時形成可追溯的商業快照，避免後續客戶或 SKU 主檔變更改寫歷史訂單。
- 立即連接庫存 Reservation，讓可售庫存不被重複承諾，並透明呈現 Backorder。
- 提供輕量報價至訂單流程，不加入複雜報價審批及多版本談判機制。
- 保證同一渠道訂單不會因重送或重複上傳而重複開單。
- 以每月歸檔維持日常交易區的可控資料量，並保留法規、稽核及客戶查詢所需歷史。

### 1.3 成功指標

| 編號 | 指標 | 成功標準 |
|---|---|---|
| KPI-01 | 日常訂單容量 | 系統可持續處理每日約 10,000 張銷售訂單，不因資料年期增長而持續惡化 |
| KPI-02 | 訂單唯一性 | 已成功建立的外部渠道訂單重複率為 0 |
| KPI-03 | 訂單完整性 | 每張訂單的表頭、明細、價格及數量以整張訂單為單位成功或失敗，不留下部分訂單 |
| KPI-04 | 庫存承諾一致性 | 已確認訂單的 Reserved、Backorder、Fulfilled、Released 及 Cancelled 數量可完整對數 |
| KPI-05 | 自動化接單 | 有效 CSV 或渠道訂單無需逐張人工確認即可進入已確認狀態並嘗試保留庫存 |
| KPI-06 | 例外可處理 | 操作人員可從匯入結果定位到失敗訂單、欄位及原因，修正後重新提交 |
| KPI-07 | 日常查詢效能 | 活躍訂單的常用列表及精確查詢在正常負載下達到第 13 節的效能要求 |
| KPI-08 | 歷史可追溯 | 符合條件的訂單按月歸檔，歸檔後仍能按訂單號、客戶及日期查詢和匯出 |
| KPI-09 | 審計完整 | 建立、確認、改單、取消、轉單、匯入、保留及歸檔等重要動作均有操作者及時間紀錄 |

---

## 2. 範圍與 Capability Map

### 2.1 第一階段範圍內

- Sales Quotation 建立、編輯、發出、取消、過期及一次性轉單。
- 人工建立、編輯、確認及查詢銷售訂單。
- 由 SKU 建議售價帶入最終單價，並允許具權限銷售人員修改。
- CSV 模板、預檢、批量建立、自動確認、結果摘要、例外處理及重複防護。
- 通用渠道接入契約、來源識別、冪等控制及處理結果；不包括指定平台 Adapter。
- 單一履約倉庫、訂單確認時的 Reservation、Backorder 及正式釋放。
- 銷售訂單取消、部分履約後關閉剩餘數量及必要的狀態同步。
- 活躍訂單、未完成訂單、Backorder、匯入批次、例外及操作歷史查詢。
- CSV 匯出、審計追蹤、每月歸檔、歸檔查詢及至少 7 年保留。

### 2.2 第一階段範圍外

- 指定電商平台的 API、Webhook、認證、對帳或平台專屬欄位映射。
- 多倉拆單、跨倉調撥、由系統自動選倉或重新分配倉庫。
- Lot、Expiry Date、Bin 分配、揀貨、包裝、出庫及發貨。
- 下單時選擇送貨地址；送貨地址由 Fulfillment & Delivery 在發貨時選擇並預設客戶默認地址。
- 價格表、客戶專屬價格、數量階梯價、促銷、折扣、優惠券及銷售稅。
- 銷售訂單審批、信用額度審批、主管改價審批及毛利審批。
- 發票、收款、應收帳、會計入帳、退貨及退款。
- 複雜報價審批、多版本談判、電子簽署及報價接受入口。
- 採購補貨、自動採購建議或 Backorder 的跨模組供應承諾。
- 商業智能資料倉庫及高階銷售分析。
- 永久刪除正式銷售訂單。

### 2.3 Capability Map

| Capability ID | 能力 | 單一責任 | 主要依賴 |
|---|---|---|---|
| SO-CAP-01 | Sales Order Core | 人工建單、最終價格、商業快照、狀態及版本控制 | Customer、Item、Currency |
| SO-CAP-02 | Sales Quotation | 建立及發出報價，並一次性轉換為可審閱的銷售訂單 | SO-CAP-01 |
| SO-CAP-03 | Batch and Channel Intake | CSV、渠道接入契約、驗證、例外及去重 | SO-CAP-01 |
| SO-CAP-04 | Inventory Commitment | 單倉 Reservation、Backorder 及 Reservation Release | SO-CAP-01、Inventory |
| SO-CAP-05 | Inquiry and Traceability | 列表、未完成查詢、匯出、狀態歷史及 Audit | SO-CAP-01 至 SO-CAP-04 |
| SO-CAP-06 | Archive and Retention | 每月歸檔、歸檔查詢、匯出及 7 年保留 | SO-CAP-01、SO-CAP-05 |

建議實作次序：`SO-CAP-01 → SO-CAP-02／SO-CAP-03／SO-CAP-04 → SO-CAP-05 → SO-CAP-06`。

Fulfillment & Delivery 是本模組的下游系統邊界，不在本 Capability Map 內實作。

### 2.4 依賴門檻

在進入系統設計前，以下上游能力必須已存在或有正式接口契約：

- Customer：Active 狀態、Customer ID、公司名稱、默認幣別、可選 Payment Term 及信用狀態。
- Item：Active、Sellable、銷售 UOM、UOM 轉換、建議售價及生效日期。
- Inventory：Warehouse、Available-to-Promise 查詢、Reservation 建立、消耗及釋放接口。
- User：用戶、角色、權限及 Audit Actor。
- Currency 及 Payment Term：有效主檔查詢。

---

## 3. 名詞與定義

| 名詞 | 定義 |
|---|---|
| Sales Quotation | 向客戶提供的非庫存承諾報價文件；不建立 Reservation |
| Sales Order / SO | 公司已接受並準備履約的客戶訂單 |
| Draft | 尚未形成庫存承諾、可由使用者修改的訂單狀態 |
| Confirming | 系統正在確認訂單及建立庫存承諾的短暫狀態；使用者不可重複修改或確認 |
| Confirmed | 已通過商業驗證並完成 Reservation／Backorder 判定的訂單狀態 |
| Fulfillment Warehouse | 該張 SO 所有明細用作保留及履約的唯一倉庫 |
| Unit Selling Price | 該訂單明細最終成交單價，是第一階段唯一銷售價格 |
| Suggested Retail Price | SKU 主檔提供的建議售價，只作預設，不限制最終售價 |
| Reservation | Inventory Management 對指定 SKU、Warehouse 及數量建立的正式庫存保留 |
| Backorder | 已確認但當下未能建立 Reservation、仍待供應的訂單數量 |
| Source Type | `MANUAL`、`CSV`、`CHANNEL` 或 `QUOTATION` |
| Channel | 外部銷售來源的邏輯識別，例如某一電商平台或舊式批量渠道 |
| External Order ID | 渠道內可唯一識別訂單的原始訂單編號 |
| Source Order Key | CSV 內用於把多個明細列組成一張訂單的來源訂單識別 |
| Import Batch | 一次 CSV 上傳及處理工作的整體紀錄 |
| Import Exception | 一張來源訂單因資料錯誤未能建立而形成的可追蹤例外 |
| Business Snapshot | 訂單確認時保存的客戶、SKU、UOM、價格及相關顯示資料，不隨主檔更新而改寫 |
| Active Store | 日常高頻查詢及交易使用的活躍訂單資料區 |
| Archive Store | 保存符合條件歷史訂單、支援較低頻查詢及匯出的歸檔資料區 |
| Open Downstream Matter | 尚未完成的 Reservation、Backorder、Fulfillment、Invoice、Return 或其他已接入下游事項 |

---

## 4. 業務角色與權限

### 4.1 權限代碼

為保持中小企操作簡單，第一階段只設三個業務權限：

| 權限 | 可執行能力 |
|---|---|
| `sales.view` | 查看報價、活躍訂單、歸檔訂單、匯入結果及狀態歷史；匯出可見資料 |
| `sales.mgmt` | 包含查看權限；建立及維護報價、人工訂單、確認訂單、取消未履約訂單、關閉剩餘數量 |
| `sales.import` | 包含查看權限；下載 CSV 模板、上傳、預檢、確認匯入及重試失敗來源訂單 |

排程歸檔由系統服務身份執行。排程監察、技術重跑及資料修復屬系統運維責任，不建立一般銷售用戶的歸檔修改權限。

### 4.2 典型角色

| 角色 | 建議權限 | 說明 |
|---|---|---|
| Sales Viewer | `sales.view` | 查詢訂單、報價及歷史資料 |
| Sales Operator | `sales.view`、`sales.mgmt` | 人工報價及建單、確認及處理訂單 |
| Sales Import Operator | `sales.view`、`sales.import` | 處理批量訂單及匯入例外 |
| Sales Supervisor | 三項權限 | 可同時處理人工及批量訂單；第一階段沒有額外審批能力 |
| System Operations | 系統既有運維權限 | 監察渠道、背景工作及歸檔，不因此自動取得業務資料權限 |

### 4.3 權限原則

- 前端頁面、後端 API 及匯出功能必須分別驗證權限，不得只隱藏按鈕。
- 系統管理員不因身份而自動獲得銷售業務資料權限。
- 使用者只可處理其公司範圍內資料；本 ERP 第一階段只有單一公司。
- 每個建立、確認、取消、關閉、轉單、匯入及匯出動作須保存實際 Actor。
- 渠道以受控服務身份呼叫，不得冒充一般用戶。

---

## 5. 核心業務原則

1. 每張 SO 必須有唯一、不可重用的系統 SO Number。
2. 每張 SO 只屬於一個 Customer、一種 Currency 及一個 Fulfillment Warehouse。
3. SO 不保存或要求送貨地址；地址在下游發貨時選擇。
4. 每張訂單最少一個有效明細，每個明細對應一個 SKU 及銷售 UOM。
5. SKU 必須在建立或確認時符合銷售資格；確認時必須重新驗證最新主檔狀態。
6. Suggested Retail Price 只作預設；Unit Selling Price 才是訂單正式價格。
7. 第一階段不計算折扣及銷售稅，訂單金額等於各行 `Quantity × Unit Selling Price` 的總和。
8. Draft 不保留庫存；Confirmed 必須形成 Reservation 或 Backorder 結果。
9. 庫存不足不得阻止整張訂單確認，也不得產生負庫存。
10. Sales Order 只記錄庫存承諾結果，不得直接修改庫存結餘、Lot 或 Bin。
11. 已確認訂單必須保留商業快照；主檔後續變更不得改寫歷史。
12. 已進入 Fulfillment 的已履約部分不可由銷售訂單直接取消或改寫。
13. 報價單不建立 Reservation；成功轉單後不得再次轉單。
14. 報價轉單的實際 SO 可與報價不同，但差異必須可追溯。
15. CSV 及渠道訂單以整張來源訂單為原子單位，任何一行失敗都不得建立部分 SO。
16. 同一 Channel 與 External Order ID 的成功訂單只能建立一次。
17. 來源重送必須回傳或顯示既有處理結果，不得建立重複訂單。
18. 正式 SO 不得硬刪除；錯誤訂單使用取消或關閉流程。
19. Open、Backorder 或有下游未完成事項的訂單不得歸檔。
20. 歸檔後的資料內容、金額、狀態、來源及 Audit 意義必須與歸檔前一致。

---

## 6. 概念資料模型

本節定義業務資料及關係，不指定實體資料庫表、欄位型別或索引；詳細 Database Table Design 見 `03_design_spec.md`。

### 6.1 Sales Quotation Header

至少包含：

- Quotation Number、Status、Quotation Date、Valid Until。
- Customer ID 及客戶名稱快照。
- Currency、可選 Payment Term。
- 報價總額、備註、外部參考。
- Converted SO ID、Converted At；未轉單時為空。
- Created By／At、Updated By／At、Issued By／At、Cancelled By／At。

### 6.2 Sales Quotation Line

至少包含：

- Quotation Line Number、SKU ID／Code／Name 快照。
- Sales UOM、UOM Conversion Factor 快照。
- Quantity、Unit Selling Price、Line Amount。
- 行備註、建立及修改時間。

### 6.3 Sales Order Header

至少包含：

- SO Number、Status、Version。
- Source Type、Channel Code、External Order ID、Import Batch ID、Source Quotation ID。
- Customer ID 及客戶名稱快照。
- Currency、Payment Term 快照。
- Fulfillment Warehouse ID／Code／Name 快照。
- Order Date、Requested Delivery Date、Customer PO／Reference、備註。
- Ordered Amount、Confirmed At、最後業務更新時間。
- Created By／At、Updated By／At、Confirmed By／At、Cancelled／Closed By／At。
- Archive Status、Archived At、Archive Batch ID。

SO 不包含銀行帳戶資料及送貨地址。

### 6.4 Sales Order Line

至少包含：

- SO Line Number、SKU ID／Code／Name 快照。
- Sales UOM 及 UOM Conversion Factor 快照。
- Ordered Quantity、Unit Selling Price、Line Amount。
- Reserved Quantity、Backorder Quantity、Fulfilled Quantity、Released Quantity、Cancelled Quantity 的可查詢結果。
- Inventory Reservation Reference、行備註及最後狀態更新時間。

### 6.5 Quotation Conversion Summary

至少包含：

- Source Quotation ID、Target SO ID、轉換時間及 Actor。
- 新增 SKU、刪除 SKU、數量差異及 Unit Selling Price 差異摘要。
- 差異摘要只作 Audit 及查詢，不形成額外審批流程。

### 6.6 Import Batch

至少包含：

- Batch ID、Source Type、Channel Code、原始檔名、檔案雜湊、模板版本。
- Uploaded By／At、Processing Started／Completed At、Batch Status。
- 來源訂單數、成功數、失敗數、重複數及警告數。
- 結果檔案參考及處理追蹤 ID。

### 6.7 Import Order and Exception

至少包含：

- Batch ID、Source Order Key、Channel Code、External Order ID。
- 行號範圍、處理狀態、已建立 SO ID。
- Error Code、欄位、易理解的錯誤訊息、原始值摘要。
- First Seen At、Last Attempt At、Attempt Count。

### 6.8 Status History and Audit Event

至少包含：

- Entity Type、Entity ID、Event Type、Before／After 摘要。
- Source、Actor、Occurred At、Reason、Correlation ID。
- Audit 不得保存明文密碼、Token、完整支付資料或無必要的個人敏感資料。

### 6.9 Archive Batch and Manifest

至少包含：

- Archive Batch ID、資格截止日期、開始／完成時間、狀態。
- 候選數、成功數、跳過數、失敗數、重試次數。
- 活躍來源與歸檔目的地的筆數／校驗結果。
- 每張訂單的 Archive Location、Archived At 及可驗證參考。

### 6.10 關係摘要

- 一張 Quotation 有一至多個 Quotation Lines。
- 一張 Quotation 最多關聯一張成功轉換的 SO。
- 一張 SO 有一至多個 SO Lines。
- 一張 SO 可有零或多個 Inventory Reservation References。
- 一個 Import Batch 可包含多張來源訂單；一張成功來源訂單關聯一張 SO。
- 一張 SO 有多個 Status／Audit Events，但只有一個目前狀態。
- 一張符合資格的 SO 只可由一個成功 Archive Batch 歸檔一次。

---

## 7. 狀態與核心流程

### 7.1 Sales Quotation 狀態

| 狀態 | 意義 | 可執行動作 |
|---|---|---|
| `DRAFT` | 尚未正式發出的報價 | 編輯、發出、取消 |
| `ISSUED` | 已向客戶發出且仍有效 | 查看、列印／匯出、轉單、取消 |
| `EXPIRED` | 已超過 Valid Until | 查看；如需繼續須複製成新報價 |
| `CONVERTED` | 已成功轉換為 SO | 查看來源及目標 SO，不可再次轉換 |
| `CANCELLED` | 已取消 | 查看，不可編輯或轉單 |

### 7.2 Sales Order 狀態

| 狀態 | 意義 | 可執行動作 |
|---|---|---|
| `DRAFT` | 未確認，不保留庫存 | 編輯、確認、取消 |
| `CONFIRMING` | 系統正在驗證並建立 Reservation／Backorder 結果 | 等待完成；發生技術問題時由系統以同一事件安全續跑 |
| `CONFIRMED` | 已確認，存在 Reservation、Backorder 或兩者 | 查看、進入 Fulfillment、在未履約前撤回重編、取消 |
| `PARTIALLY_FULFILLED` | 至少一部分已由下游履約，尚有未完成數量 | 查看、繼續履約、關閉剩餘數量 |
| `COMPLETED` | 全部有效訂購數量已完成履約 | 查看、下游後續處理、符合條件後歸檔 |
| `CLOSED` | 部分履約後由用戶結束剩餘未履約數量 | 查看、符合條件後歸檔 |
| `CANCELLED` | 在沒有已履約數量時取消整張訂單 | 查看、符合條件後歸檔 |

Backorder 是行級數量狀態，不另設與 Header 狀態互相衝突的 `BACKORDER` Header 狀態。列表可使用「Has Backorder」篩選。

### 7.3 人工銷售訂單流程

1. 銷售人員建立 Draft。
2. 選擇 Active Customer，系統帶入幣別及可選 Payment Term。
3. 選擇單一 Fulfillment Warehouse。
4. 加入有效、可銷售 SKU，系統帶入銷售 UOM 及建議售價。
5. 銷售人員確認數量及最終 Unit Selling Price。
6. 系統計算行金額及訂單總額，執行表頭與明細驗證。
7. 使用者確認訂單；系統重新驗證 Customer、SKU、Warehouse 及關鍵版本。
8. 系統形成訂單快照，向 Inventory 建立可用數量的 Reservation，其餘記為 Backorder。
9. 訂單進入 `CONFIRMED`，並顯示每行 Reserved 及 Backorder 結果。

### 7.4 報價轉單流程

1. 銷售人員建立及發出 Quotation；不建立 Reservation。
2. 在報價有效且未轉單時選擇「轉為 Sales Order」。
3. 系統建立一張來源為 `QUOTATION` 的 Draft SO。
4. 使用者可新增／刪除商品及修改數量、倉庫、日期和 Unit Selling Price。
5. 使用者保存及審閱 Draft，再執行一般 SO 確認流程。
6. 成功建立 Draft SO 後，Quotation 即標記 `CONVERTED`，保存一對一關係及差異摘要。
7. 只有 SO 正式確認時才建立 Reservation；僅轉成 Draft 不保留庫存。

### 7.5 CSV 批量開單流程

1. 操作人員下載當前版本模板及填寫指引。
2. 上傳 CSV，系統先檢查檔案、欄位及整批基本格式。
3. 系統按 Source Order Key 分組；同一訂單的表頭欄位必須一致。
4. 系統逐張來源訂單預檢，顯示可處理、失敗及重複數量。
5. 操作人員確認處理；系統以背景工作逐張建立並自動確認有效 SO。
6. 每張成功 SO 自動執行 Reservation／Backorder 判定。
7. 失敗訂單形成 Import Exception，不留下 Draft 或部分明細。
8. 完成後顯示摘要並提供結果 CSV；修正的失敗訂單可重新提交。

### 7.6 渠道訂單流程

1. 已授權 Adapter 將平台資料轉成標準 Sales Order Intake Contract。
2. 系統先以 Channel Code ＋ External Order ID 判斷是否已處理。
3. 重複請求回傳既有處理結果；有效新訂單自動建立及確認。
4. 驗證失敗時建立 Import Exception 並回傳可識別錯誤，不建立部分 SO。
5. 成功後保存來源資料參考、SO Number、Reservation／Backorder 結果及 Correlation ID。

### 7.7 取消及關閉流程

- `DRAFT` 可直接取消，因沒有 Reservation，毋須庫存釋放。
- `CONFIRMED` 且未有任何 Fulfilled Quantity 時，可整張取消；系統必須先正式釋放未消耗 Reservation，再完成取消。
- `PARTIALLY_FULFILLED` 不可整張取消；使用者可「關閉剩餘數量」，釋放未消耗 Reservation 並取消未履約 Backorder，訂單變為 `CLOSED`。
- 任何庫存釋放失敗時，不得把訂單顯示為已成功取消或關閉；應保留可重試的明確例外。

### 7.8 每月歸檔流程

1. 系統按設定的每月離峰時間產生 Archive Batch。
2. 候選 SO 必須為 `COMPLETED`、`CLOSED` 或 `CANCELLED`，最後業務更新時間超過 24 個月。
3. 系統再次檢查沒有未完成 Reservation、Backorder 及已接入的下游事項。
4. 合資格訂單連同明細、來源關係及必要 Audit 資料寫入 Archive Store。
5. 完成筆數及完整性校驗後，才從 Active Store 移除對應交易資料。
6. 單筆失敗不得令已驗證成功的批次全部回滾；工作須可安全續跑且不得重複歸檔。
7. 歸檔訂單仍可從 Archive Search 查詢及匯出，但不可修改。

---

## 8. 功能需求

### 8.1 Sales Quotation

| ID | 需求 |
|---|---|
| FR-QUOTE-001 | 具 `sales.mgmt` 的使用者可建立 Quotation Draft。 |
| FR-QUOTE-002 | Quotation 必須選擇 Active Customer，並帶入 Customer 的默認 Currency 及可選 Payment Term。 |
| FR-QUOTE-003 | Quotation 必須有 Quotation Date 及 Valid Until，且 Valid Until 不得早於 Quotation Date。 |
| FR-QUOTE-004 | 每張 Quotation 必須至少一個明細，且每行 Quantity 大於 0、Unit Selling Price 不得為負數。 |
| FR-QUOTE-005 | 系統只允許選擇當時 Active、Sellable 且在有效期內的 SKU。 |
| FR-QUOTE-006 | SKU 建議售價只在其 Price Currency 與 Quotation Currency 相同時作預設；否則使用者須輸入 Unit Selling Price。使用者可直接修改最終價格，系統不計算額外折扣或稅。 |
| FR-QUOTE-007 | 系統必須即時計算 Line Amount 及 Quotation Total，並按 Currency 規則顯示及四捨五入。 |
| FR-QUOTE-008 | Quotation 可保存客戶參考、備註及行備註，但不得要求送貨地址。 |
| FR-QUOTE-009 | `DRAFT` 可編輯、發出或取消；發出時必須重新驗證 Customer、SKU、數量、價格及日期。 |
| FR-QUOTE-010 | `ISSUED` 報價可產生適合列印或下載的客戶版本；格式細節留待 UI／文件設計。 |
| FR-QUOTE-011 | 到達 Valid Until 後，尚未轉單或取消的報價應顯示為 `EXPIRED`，不可直接轉單。 |
| FR-QUOTE-012 | 只有 `ISSUED`、未過期及未轉單的 Quotation 可轉為 SO。 |
| FR-QUOTE-013 | 一張 Quotation 只可成功產生一張 SO；重複操作須返回既有 SO，不得建立第二張。 |
| FR-QUOTE-014 | 轉換後的 SO 初始為 `DRAFT`，允許新增／刪除 SKU、修改數量、Unit Selling Price、倉庫及日期。 |
| FR-QUOTE-015 | 系統須保存 Quotation 與 SO 的雙向連結，以及新增、刪除、數量及價格差異摘要。 |
| FR-QUOTE-016 | 建立、修改、發出、取消、過期及轉單均須留下狀態歷史及 Audit。 |
| FR-QUOTE-017 | Quotation 在任何狀態均不得建立或佔用 Inventory Reservation。 |

### 8.2 銷售訂單列表、詳情及人工建立

| ID | 需求 |
|---|---|
| FR-SO-001 | 具 `sales.view` 的使用者可查看其權限範圍內的 Sales Order 列表及詳情。 |
| FR-SO-002 | 列表至少顯示 SO Number、Customer、Source、Order Date、Warehouse、Status、Total、Reserved／Backorder 摘要及最後更新時間。 |
| FR-SO-003 | 列表可按 SO Number、Customer ID／Name、Customer PO、日期、狀態、來源、渠道、倉庫及 Has Backorder 篩選。 |
| FR-SO-004 | 精確 SO Number 或 External Order ID 查詢應優先直接定位，不要求掃描全部歷史資料。 |
| FR-SO-005 | 具 `sales.mgmt` 的使用者可建立來源為 `MANUAL` 的 Draft SO。 |
| FR-SO-006 | 系統應在首次保存 Draft 時分配唯一 SO Number；號碼一經分配不可更改或重用。 |
| FR-SO-007 | SO 必須選擇一個 Active Customer；非 Active Customer 不可建立或確認新訂單。 |
| FR-SO-008 | 系統帶入 Customer 默認 Currency；第一階段不支援一張 SO 多幣別。 |
| FR-SO-009 | Customer Payment Term 如有設定可帶入並保存快照；沒有設定不阻止建單。 |
| FR-SO-010 | SO 必須選擇一個 Active Fulfillment Warehouse，所有明細使用相同倉庫。 |
| FR-SO-011 | SO 不得要求或保存 Shipping Address；發貨地址由下游 Fulfillment 選擇。 |
| FR-SO-012 | 使用者可輸入 Order Date、可選 Requested Delivery Date、Customer PO／Reference 及備註。 |
| FR-SO-013 | Requested Delivery Date 如有輸入，不得早於 Order Date；特殊補錄需求留待後續版本。 |
| FR-SO-014 | 每張 SO 必須至少一個明細；第一階段每張最多 100 個有效明細。 |
| FR-SO-015 | 使用者可按 SKU Code、Name 或 Barcode 搜尋及加入 Active、Sellable、有效期內的 SKU。 |
| FR-SO-016 | 同一 SKU 及 Sales UOM 在同一 SO 原則上應合併為一行，避免重複承諾難以理解。 |
| FR-SO-017 | 每行 Quantity 必須大於 0，並符合 SKU Sales UOM 的精度規則。 |
| FR-SO-018 | SKU 建議售價的 Price Currency 與 SO Currency 相同時，系統可帶入該價格；幣別不同時不得暗中換算，使用者須輸入最終 Unit Selling Price。 |
| FR-SO-019 | Unit Selling Price 必須大於或等於 0；零售價須接受但在確認前顯示明確警告。 |
| FR-SO-020 | 系統按 `Quantity × Unit Selling Price` 計算 Line Amount 及 Order Total。 |
| FR-SO-021 | 第一階段不顯示或保存折扣、稅碼、稅率及稅額。 |
| FR-SO-022 | Draft 可新增、刪除及修改明細；所有修改須採用版本控制，避免覆蓋其他使用者的新修改。 |
| FR-SO-023 | 若版本已被他人更新，保存或確認須拒絕並提示重新載入，不得靜默覆蓋。 |
| FR-SO-024 | 訂單詳情須同時顯示目前主檔參考及確認時快照；兩者不同時不得改寫歷史值。 |

### 8.3 訂單確認、Reservation 及 Backorder

| ID | 需求 |
|---|---|
| FR-CONF-001 | 只有完整且有效的 `DRAFT` SO 可確認。 |
| FR-CONF-002 | 確認時必須重新驗證 Customer 仍為 Active、Warehouse 有效、SKU 仍符合銷售條件及 UOM 仍有效。 |
| FR-CONF-003 | 若 Customer 在頁面開啟後變為非 Active，確認必須拒絕並顯示原因。 |
| FR-CONF-004 | Customer Credit Status 為 `ON_HOLD` 時，第一階段拒絕確認；`NOT_CONFIGURED` 或 `NORMAL` 可繼續。 |
| FR-CONF-005 | 在 Accounts Receivable 尚未提供實時 Exposure 前，Credit Limit 只作提示，不實作不可靠的硬額度攔截。 |
| FR-CONF-006 | 系統必須在確認時保存 Customer、SKU、UOM、Currency、Payment Term、Warehouse 及價格的 Business Snapshot。 |
| FR-CONF-007 | 確認必須具冪等性；重複點擊或重送同一確認請求不得建立重複 Reservation。 |
| FR-CONF-008 | 系統按 SO Line 及 Fulfillment Warehouse 查詢可承諾庫存，建立可用數量的正式 Reservation。 |
| FR-CONF-009 | 若可承諾數量小於 Ordered Quantity，未能保留的差額成為 Backorder，SO 仍可確認。 |
| FR-CONF-010 | 若沒有可承諾數量，整行可全部成為 Backorder，SO 仍可確認。 |
| FR-CONF-011 | Inventory 不得自動負庫存；Sales 不得直接更新 Inventory Balance、Lot 或 Bin。 |
| FR-CONF-012 | 每行須顯示 Ordered、Reserved 及 Backorder Quantity，且 `Ordered = Reserved + Backorder` 於初次確認後成立。 |
| FR-CONF-013 | 多行訂單中個別 SKU 缺貨不得阻止其他行建立可用 Reservation。 |
| FR-CONF-014 | 確認開始後 SO 進入短暫的 `CONFIRMING`。若 Inventory 完全不可用或最終承諾結果未明，SO 不得假裝確認成功，也不得接受另一個確認；系統須以原事件安全查詢或續跑。 |
| FR-CONF-015 | 技術恢復流程不得建立重複 SO 或重複 Reservation，最終結果須可由 Correlation ID 對數。 |
| FR-CONF-016 | 確認成功後，SO 進入 `CONFIRMED` 並記錄 Confirmed By／At。 |
| FR-CONF-017 | 已確認訂單的 Backorder 可在庫存補充後由明確的重試／分配動作轉為 Reservation；第一階段不要求複雜分配優先級。 |
| FR-CONF-018 | Backorder 補配不得超過當前未履約 Backorder，也不得改變原始 Ordered Quantity。 |
| FR-CONF-019 | Reservation 的建立、補配、消耗及釋放須引用 SO Number、Line Number 及穩定的業務事件 ID。 |
| FR-CONF-020 | Inventory 回傳的 Reservation 狀態為庫存承諾真相；SO 保存可查詢投影及 Reference，不得形成第二套可獨立修改的庫存賬。 |

### 8.4 已確認訂單的變更、取消及關閉

| ID | 需求 |
|---|---|
| FR-LIFE-001 | 未有任何 Fulfilled Quantity 的 `CONFIRMED` SO 可撤回為 Draft，以便更正商業資料。 |
| FR-LIFE-002 | 撤回前必須成功釋放所有未消耗 Reservation；釋放失敗時不得進入 Draft。 |
| FR-LIFE-003 | 撤回後原有 Reservation／Backorder 結果失效；再次確認時按最新資料重新建立。 |
| FR-LIFE-004 | 已有任何 Fulfilled Quantity 後，Customer、Currency、Warehouse、已履約 SKU、已履約數量及歷史價格快照不可直接修改。 |
| FR-LIFE-005 | `DRAFT` 可取消且不需庫存操作。 |
| FR-LIFE-006 | `CONFIRMED` 且 Fulfilled Quantity 全為 0 時，可整張取消；必須輸入取消原因。 |
| FR-LIFE-007 | 確認訂單取消前，系統必須釋放所有未消耗 Reservation 並取消全部 Backorder。 |
| FR-LIFE-008 | 已部分履約的訂單不可整張取消，只可關閉剩餘數量。 |
| FR-LIFE-009 | 關閉剩餘數量必須輸入原因，釋放未消耗 Reservation 並取消未履約 Backorder。 |
| FR-LIFE-010 | 關閉後保留已 Fulfilled Quantity、歷史快照及下游參考，Status 為 `CLOSED`。 |
| FR-LIFE-011 | 當全部有效 Ordered Quantity 已履約後，SO 進入 `COMPLETED`。 |
| FR-LIFE-012 | 取消、撤回及關閉須使用冪等業務事件，重試不得重複釋放庫存。 |
| FR-LIFE-013 | 任何跨模組操作部分失敗時，使用者須看到目前實際狀態及可恢復指引，不得顯示虛假成功。 |
| FR-LIFE-014 | 狀態變更、原因、Actor、時間及關聯庫存事件均須寫入 Audit。 |

### 8.5 CSV 批量訂單

| ID | 需求 |
|---|---|
| FR-CSV-001 | 具 `sales.import` 的使用者可下載當前 CSV 模板、欄位說明及有效範例。 |
| FR-CSV-002 | 模板必須有版本；系統須識別檔案版本並拒絕不支援版本。 |
| FR-CSV-003 | 每個 CSV 行代表一個訂單明細，以 Source Order Key 把多行組成一張來源訂單。 |
| FR-CSV-004 | 同一 Source Order Key 的 Customer、Currency、Warehouse、Order Date、Channel Code 及 External Order ID 等表頭欄位必須一致。 |
| FR-CSV-005 | CSV 必填資料至少包括 Source Order Key、Channel Code、External Order ID、Customer ID、Warehouse Code、Order Date、SKU Code、Quantity 及 Unit Selling Price。 |
| FR-CSV-006 | 系統須檢查編碼、分隔符、欄位、日期、數值、空值、長度、枚舉及惡意公式內容。 |
| FR-CSV-007 | 預檢不得建立 SO 或 Reservation；須按來源訂單顯示 Valid、Invalid、Duplicate 及 Warning 結果。 |
| FR-CSV-008 | 操作人員確認後才正式處理；有效訂單自動建立及確認，不需逐張人工操作。 |
| FR-CSV-009 | 一張來源訂單任何表頭或明細失敗時，整張訂單失敗，不得留下部分 SO、部分明細或 Reservation。 |
| FR-CSV-010 | 同一批次內其他有效來源訂單可繼續處理，不因單一失敗全部中止。 |
| FR-CSV-011 | 成功訂單須執行與人工 SO 相同的 Customer、SKU、價格、Reservation 及 Backorder 規則。 |
| FR-CSV-012 | `Channel Code + External Order ID` 對成功訂單必須唯一；同一檔案重傳或跨批次重傳不得重複開單。 |
| FR-CSV-013 | 檔案雜湊可用於提示完整檔案重傳，但不得取代訂單級唯一性判斷。 |
| FR-CSV-014 | 先前失敗且未建立 SO 的 External Order ID 可在修正後重新提交；成功後即受唯一性約束。 |
| FR-CSV-015 | 每次上傳最多支援 10,000 張來源訂單；超過上限須在建立背景工作前拒絕並提示拆檔。 |
| FR-CSV-016 | 大型檔案以背景工作處理，頁面須顯示排隊、處理中、完成、部分成功或失敗狀態。 |
| FR-CSV-017 | 完成後須提供包含 Source Order Key、External Order ID、結果、SO Number、錯誤代碼及錯誤訊息的結果 CSV。 |
| FR-CSV-018 | 匯出內容須防止 spreadsheet formula injection，並使用 UTF-8 及已公布格式。 |
| FR-CSV-019 | 同一 Batch 的確認操作具冪等性；重複點擊不得啟動多個正式處理工作。 |
| FR-CSV-020 | 系統須保留 Batch、每張來源訂單結果、Actor、時間及 Correlation ID，供查詢及 Audit。 |

### 8.6 渠道接入邊界

| ID | 需求 |
|---|---|
| FR-CH-001 | 第一階段須定義穩定的 Sales Order Intake Contract，供日後每個平台 Adapter 對接。 |
| FR-CH-002 | 平台專屬欄位轉換、簽名及認證由 Adapter 負責；Sales Order Core 只接收標準契約。 |
| FR-CH-003 | 標準契約至少包含 Channel Code、External Order ID、Customer、Warehouse、Order Date、Currency 及一至多個訂單明細。 |
| FR-CH-004 | 每個請求必須有 Request ID／Idempotency Key 及可端到端追蹤的 Correlation ID。 |
| FR-CH-005 | 有效渠道訂單自動建立及確認，並執行相同 Reservation／Backorder 規則。 |
| FR-CH-006 | 驗證失敗的渠道訂單形成 Import Exception；不得建立部分 SO。 |
| FR-CH-007 | 重送已成功的 Channel Code ＋ External Order ID 時，系統返回既有 SO 及結果，不再建立訂單。 |
| FR-CH-008 | 相同 External Order ID 在不同 Channel 可視為不同來源訂單。 |
| FR-CH-009 | 渠道接入須返回 Accepted、Duplicate、Validation Failed 或 Technical Retry 等可機器識別結果。 |
| FR-CH-010 | 可重試的技術失敗與不可重試的業務驗證錯誤必須清楚區分。 |
| FR-CH-011 | 渠道訂單須保存來源參考，但不得在 SO 中保存平台密碼、Token 或完整認證 Payload。 |
| FR-CH-012 | 未來新增 Adapter 不應要求修改 SO 核心業務規則；平台差異由 Adapter 映射處理。 |
| FR-CH-013 | 第一階段不要求向平台回傳發貨、取消或退款狀態，只保留可擴展的訂單結果邊界。 |

### 8.7 查詢、匯出及 Audit

| ID | 需求 |
|---|---|
| FR-INQ-001 | 系統須提供 My Recent Orders、All Active Orders、Outstanding Orders、Has Backorder 及 Finalized Orders 常用視圖。 |
| FR-INQ-002 | Outstanding Orders 包括仍有未 Fulfilled、未 Released 或 Backorder 數量的非最終訂單。 |
| FR-INQ-003 | 詳情頁須顯示來源、客戶及商品快照、金額、Reservation／Backorder、狀態歷史及下游參考。 |
| FR-INQ-004 | 使用者可從 Quotation 前往轉換後 SO，也可從 SO 返回來源 Quotation。 |
| FR-INQ-005 | 使用者可從 CSV／Channel SO 前往來源 Batch 或 Import Result。 |
| FR-INQ-006 | 列表匯出須套用與畫面相同的權限及篩選，不得繞過資料範圍。 |
| FR-INQ-007 | 小型匯出可即時下載；大型匯出須使用背景工作並提供狀態及有限期下載。 |
| FR-INQ-008 | 匯出至少包括 SO Number、來源、客戶、日期、倉庫、狀態、金額及數量摘要。 |
| FR-INQ-009 | Audit 須記錄建立、修改、確認、撤回、取消、關閉、轉單、匯入、重試、Reservation 及歸檔事件。 |
| FR-INQ-010 | 具查看權限的使用者可看業務狀態歷史；只有獲授權運維人員可看技術錯誤詳情。 |
| FR-INQ-011 | 使用者不得修改 Audit Event 或已確認的歷史快照。 |
| FR-INQ-012 | 查詢結果須明確標示資料來自 Active 或 Archive，避免使用者誤以為歷史資料遺失。 |

### 8.8 歸檔及保留

| ID | 需求 |
|---|---|
| FR-ARC-001 | 系統須每月於可設定的離峰時段執行銷售訂單歸檔。 |
| FR-ARC-002 | 只有 `COMPLETED`、`CLOSED` 或 `CANCELLED` SO 才可成為歸檔候選。 |
| FR-ARC-003 | 候選 SO 的最後業務更新時間必須早於執行日 24 個月。 |
| FR-ARC-004 | 仍有 Reservation、Backorder、未完成 Fulfillment 或其他已接入下游事項的 SO 不得歸檔。 |
| FR-ARC-005 | 歸檔資格須在真正搬移前再次檢查，避免候選產生後狀態已改變。 |
| FR-ARC-006 | SO Header、Lines、來源連結、Quotation Conversion 摘要、必要狀態歷史及 Audit 關聯須一併歸檔。 |
| FR-ARC-007 | 系統須先寫入 Archive Store 並完成筆數及完整性校驗，才可從 Active Store 移除。 |
| FR-ARC-008 | 歸檔不得重新計算金額、數量、狀態或快照，也不得改變訂單業務結果。 |
| FR-ARC-009 | Archive Batch 須分批處理、可安全重跑及可從中斷點繼續，避免長時間鎖定日常交易。 |
| FR-ARC-010 | 同一 SO 不得重複歸檔；重跑已完成批次不得產生重複資料。 |
| FR-ARC-011 | 單筆失敗須記錄原因並留待重試；不得因少量失敗使已校驗成功資料回到不一致狀態。 |
| FR-ARC-012 | 歸檔 SO 至少保存 7 年；正式銷毀政策不屬第一階段，期間不得自動刪除。 |
| FR-ARC-013 | 使用者可按 SO Number、Customer、External Order ID、Order Date、Status 及 Channel 查詢 Archive。 |
| FR-ARC-014 | Archive 結果為唯讀，可查看詳情、Audit 摘要及匯出，不可修改、取消或重新確認。 |
| FR-ARC-015 | Active Search 找不到資料時，可提供明確入口搜尋 Archive，但不得在每個常用列表自動掃描整個 Archive。 |
| FR-ARC-016 | 大範圍 Archive 匯出須使用背景工作，並記錄發起人、條件、筆數及下載時間。 |
| FR-ARC-017 | 每次 Archive Batch 須產生候選、成功、跳過、失敗、耗時及校驗報告，供運維監察。 |
| FR-ARC-018 | 歸檔工作失敗不得阻止新訂單、訂單查詢、確認或 Fulfillment 的正常運作。 |
| FR-ARC-019 | 活躍及歸檔資料的備份、復原及完整性驗證須納入營運程序。 |
| FR-ARC-020 | 未來下游模組接入後，Open Downstream Matter 判定須按正式契約擴充，不能只依 Header Status。 |

---

## 9. 業務規則

### 9.1 訂單與價格規則

| ID | 規則 |
|---|---|
| BR-001 | SO Number 及 Quotation Number 全系統唯一，不可由使用者修改或重用。 |
| BR-002 | 一張 SO 只可有一個 Customer、Currency 及 Fulfillment Warehouse。 |
| BR-003 | 每張 Quotation／SO 最少 1 行、最多 100 個有效明細。 |
| BR-004 | Quantity 必須大於 0；是否允許小數依 SKU 的 UOM 精度。 |
| BR-005 | Unit Selling Price 不得為負；零價格允許但確認時警告。 |
| BR-006 | 第一階段 `Line Amount = Quantity × Unit Selling Price`，`Order Total = 所有 Line Amount 總和`。 |
| BR-007 | Currency 精度及四捨五入須在整個 UI、API、CSV 及匯出一致。 |
| BR-008 | Suggested Retail Price 只在其 Price Currency 與文件 Currency 相同時於新增行預設；不同幣別不自動匯率換算。其後主檔價格更新不得改寫既有 Draft 或 Confirmed 行。 |
| BR-009 | 第一階段不建立 Discount、Tax 或 Promotion 的隱藏計算。 |
| BR-010 | 相同 SKU 及 UOM 在同一訂單應合併；不同 UOM 可視為不同明細。 |

### 9.2 主檔資格及快照規則

| ID | 規則 |
|---|---|
| BR-011 | Customer 必須為 Active 才可建立或確認新 Quotation／SO。 |
| BR-012 | SKU 必須為 Active、Sellable 且在銷售有效期內；Discontinued 但仍 Sellable 的 SKU 可按 Item 規則銷售現有庫存。 |
| BR-013 | Warehouse 必須為 Active 並可供履約。 |
| BR-014 | 確認時重新驗證的結果優先於頁面載入時結果。 |
| BR-015 | Confirmed Snapshot 至少包括 Customer 顯示名稱、SKU Code／Name、UOM／轉換率、Currency、Payment Term、Warehouse 及 Unit Selling Price。 |
| BR-016 | 歷史快照不可因上游主檔重命名、停用或修改而被覆蓋。 |
| BR-017 | Customer 銀行帳戶不得帶入、顯示或保存於 Quotation／SO。 |
| BR-018 | Shipping Address 不在 SO 建立或確認時選擇。 |

### 9.3 Reservation 及數量守恆規則

| ID | 規則 |
|---|---|
| BR-019 | Draft 及 Quotation 的 Reserved Quantity 必須為 0。 |
| BR-020 | 初次確認後，每行 `Ordered Quantity = Reserved Quantity + Backorder Quantity`。 |
| BR-021 | 生命週期內，原始承諾數量須可由 Fulfilled、Outstanding Reserved、Backorder、Released 及 Cancelled 結果完整解釋。 |
| BR-022 | Reservation 不得超過該行當前未履約及未取消數量。 |
| BR-023 | Backorder 補配後，相同數量須從 Backorder 減少並增加 Reservation，不改變 Ordered Quantity。 |
| BR-024 | Sales 只透過 Inventory 正式接口建立、消耗或釋放 Reservation。 |
| BR-025 | Lot／Bin 只在 Fulfillment 分配；SO 及 Reservation 不指定 Lot／Bin。 |
| BR-026 | 取消或關閉只有在未消耗 Reservation 成功釋放後才算完成。 |
| BR-027 | 任何重試須使用相同穩定 Event ID，避免重複 Reservation 或 Release。 |

### 9.4 來源及去重規則

| ID | 規則 |
|---|---|
| BR-028 | 人工訂單的 Source Type 為 `MANUAL`；報價轉單為 `QUOTATION`；CSV 及渠道分別為 `CSV`、`CHANNEL`。 |
| BR-029 | CSV 及 CHANNEL 成功訂單必須有 Channel Code 及 External Order ID。 |
| BR-030 | `Channel Code + External Order ID` 是成功來源訂單的唯一業務鍵。 |
| BR-031 | 重複來源不建立新 SO，並返回原有 SO Number 及原處理結果。 |
| BR-032 | 驗證失敗且未建立 SO 的來源識別可修正後重試。 |
| BR-033 | 一張來源訂單內任何行失敗，整張來源訂單失敗；不同來源訂單互不影響。 |
| BR-034 | 渠道專屬值須由 Adapter 轉為標準 Customer、Warehouse、SKU、UOM 及 Currency 識別。 |
| BR-035 | 未識別映射不得猜測或自動替代，必須進入 Import Exception。 |

### 9.5 報價轉單規則

| ID | 規則 |
|---|---|
| BR-036 | 只有有效的 `ISSUED` Quotation 可轉單。 |
| BR-037 | 成功轉單後 Quotation 永久記錄 Target SO，不可再次轉單。 |
| BR-038 | 轉換建立 Draft SO，不直接形成庫存承諾。 |
| BR-039 | SO 可與 Quotation 不同，但新增／刪除 SKU、數量及價格差異必須保存。 |
| BR-040 | 取消轉換畫面且未成功保存 SO 時，不得把 Quotation 標記為 Converted。 |

### 9.6 歸檔規則

| ID | 規則 |
|---|---|
| BR-041 | 24 個月以最後業務更新時間計算，不以建立日期單獨判斷。 |
| BR-042 | 技術性讀取、報表或登入查詢不得更新最後業務更新時間。 |
| BR-043 | Backorder 大於 0 的 SO 永遠不是歸檔候選。 |
| BR-044 | 有未完成下游事項的 SO 即使 Header 為最終狀態亦不得歸檔。 |
| BR-045 | 歸檔資料至少保存 7 年；如法規或公司政策要求更長，以較長者為準。 |
| BR-046 | Active 移除前必須驗證 Archive 已完整、可讀及可按唯一鍵找回。 |
| BR-047 | 歸檔資料唯讀，任何更正須透過正式調整流程處理，不覆寫 Archive 原值。 |
| BR-048 | 歸檔批次本身須可審計，不得靜默略過失敗訂單。 |

---

## 10. 頁面及 UX 業務要求

所有頁面及互動須遵循 `docs/frontend-design.md`，並保持鍵盤操作、可讀錯誤提示、響應式畫面及基本 WCAG 可及性。

### 10.1 頁面清單

| 頁面 | 主要使用者 | 主要功能 |
|---|---|---|
| Sales Order List | Viewer／Operator | 常用視圖、篩選、排序、分頁、匯出、進入詳情 |
| Create／Edit Sales Order | Sales Operator | 人工 Draft、明細、價格、倉庫、保存及確認 |
| Sales Order Detail | Viewer／Operator | 快照、數量、Reservation／Backorder、歷史、取消／關閉 |
| Quotation List | Viewer／Operator | 搜尋、狀態、有效期及轉單結果 |
| Create／Edit Quotation | Sales Operator | 客戶、商品、價格、有效期、發出及轉單 |
| CSV Import | Import Operator | 模板下載、上傳、預檢、確認及進度 |
| Import Batch Detail | Viewer／Import Operator | 結果摘要、錯誤、SO 連結、結果下載及重試 |
| Import Exception List | Viewer／Import Operator | 按渠道、批次、錯誤及日期查詢例外 |
| Archive Search | Viewer | 歷史 SO 搜尋、唯讀詳情及背景匯出 |

### 10.2 操作體驗

- 人工建單應以單一主流程完成，不強迫使用者經過多個 Wizard。
- 新增明細支援 SKU Code、名稱及 Barcode 快速搜尋；已加入行可用鍵盤快速修改數量及價格。
- Customer、Warehouse、SKU 無效時，在選擇及確認時均提供清楚原因。
- 訂單頁須把 Ordered、Reserved、Backorder、Fulfilled 以一致欄位展示，不只使用顏色表示。
- Backorder 不以一般錯誤彈窗阻止成功確認；應在確認結果及訂單詳情醒目顯示。
- 零價格、Customer Credit On Hold、資料版本衝突及撤回會釋放庫存等風險，須在操作前顯示具體提示。
- 長列表使用伺服器端搜尋、分頁及排序，不把全部訂單載入瀏覽器。
- 匯入及大型匯出在背景執行，使用者可離開頁面後再查看結果。
- 每個錯誤訊息應說明「哪張來源訂單、哪個欄位、出了甚麼問題、如何修正」。
- Active 與 Archive 查詢入口清晰分開，但詳情頁保持一致閱讀方式。
- 所有日期時間按使用者時區顯示，Audit 同時保存標準時間。

---

## 11. 權限、安全及資料保護

### 11.1 授權

- 所有查詢、明細、狀態動作、匯入及匯出 API 必須進行伺服器端權限檢查。
- 直接修改 URL、SO ID、Batch ID 或 Archive ID 不得繞過授權。
- 渠道服務身份只可呼叫獲授權的 Intake 能力，不可使用一般管理頁面 API。
- 背景工作須保存原始業務 Actor 及實際 System Actor，不能全部記成系統使用者。

### 11.2 輸入安全

- UI、API、CSV 及 Adapter 輸入均視為不可信資料，須作長度、型別、枚舉及業務驗證。
- CSV 上傳須限制檔案類型及大小，拒絕不支援編碼、惡意內容及超出批次上限的檔案。
- 所有文字在顯示及匯出時須防止 XSS 及 spreadsheet formula injection。
- 錯誤回應不得暴露 SQL、Stack Trace、密鑰、Token 或內部儲存路徑。

### 11.3 敏感資料及 Audit

- SO 只保存履約及審計所需最低限度客戶資料，不複製銀行帳戶資料。
- 外部平台認證資料須由安全的整合設定管理，不保存於訂單或 Import Exception。
- Audit 資料不可由一般業務使用者修改或刪除。
- 匯出須記錄 Actor、時間、篩選條件、資料範圍及結果筆數。

---

## 12. 模組整合需求

| 模組 | Sales Order 使用的能力 | 邊界責任 |
|---|---|---|
| Customer Management | Customer 狀態、名稱、Currency、Payment Term、Credit Status | Customer 是主檔真相；SO 只保存確認快照 |
| Items Management | SKU 狀態、Sellable、有效期、Sales UOM、轉換、建議售價 | Item 是商品真相；SO 不自行維護 SKU |
| Inventory Management | ATP、Reservation、Release、Consumption 結果 | Inventory 是庫存及 Reservation 真相；SO 不直接寫庫存 |
| Fulfillment & Delivery | 已確認訂單、未履約數量、Reservation 參考 | 下游選 Lot／Bin、Shipping Address、揀貨及發貨 |
| User Management | Actor、角色及權限 | User 是身份及權限真相 |
| Currency／Payment Term | 有效主檔及顯示規則 | SO 保存確認快照，不自行建立主檔 |
| Accounts Receivable | 未來提供 Exposure、Overdue 及信用判定 | 第一階段未接入前 Credit Limit 只提示；不假裝實時控制 |
| Invoicing／Returns | 未來提供未完成下游事項及訂單引用 | 接入前不在本模組實作發票及退貨 |
| Channel Adapter | 平台資料映射、認證、重試及標準化 | Core 只接收標準 Intake Contract |

渠道所提供的最終消費者或送貨地址資料不保存於 SO Core。指定平台開發時，須另行確認由 Adapter 直接交付 Fulfillment Instruction，還是映射至 Customer Address；在該決策完成前不得丟棄來源平台所需的履約資料。

### 12.1 Inventory 整合特別約束

現有 Inventory Reservation 的原子契約不得由 Sales 改成隱式部分成功。Sales 可先按可承諾數量決定本次正式 Reservation Request 數量，未請求部分形成 Backorder；Inventory 對每個正式 Request 仍應是全數成功或失敗。高併發下的重新計算、重試及一致性方案必須在 `03_design_spec.md` 明確定義並以整合測試驗證。

### 12.2 下游未完成事項

在 Fulfillment、Invoicing、Returns 等模組逐步接入時，各模組須提供穩定的「是否仍有未完成事項」查詢或事件契約。歸檔不得以缺少資料等同「沒有未完成事項」。

---

## 13. 非功能需求

### 13.1 容量與效能

| ID | 要求 |
|---|---|
| NFR-PERF-001 | 容量基線為每日約 10,000 張 SO；24 個月約等於 730 萬張 Active SO Header，並須按獲確認的真實行數分佈建立容量資料。 |
| NFR-PERF-002 | 在正常業務負載下，活躍訂單常用列表及精確查詢 P95 回應時間不超過 2 秒。 |
| NFR-PERF-003 | 單張不超過 100 行的 Draft 保存及確認，除外部依賴故障外，P95 不超過 3 秒。 |
| NFR-PERF-004 | 10,000 張訂單的有效 CSV 批次在標準容量測試環境中應於 30 分鐘內完成；實際基準環境須在設計階段記錄。 |
| NFR-PERF-005 | 系統須支援至少 50 名互動使用者同時查詢／建單，以及背景 CSV、渠道及歸檔工作。 |
| NFR-PERF-006 | Archive 精確訂單號查詢 P95 不超過 3 秒；一般受限日期範圍查詢 P95 不超過 5 秒。 |
| NFR-PERF-007 | 當 Active Store 達到完整 24 個月容量後，常用查詢仍須符合上述指標，不可依賴清空測試資料才能達標。 |
| NFR-PERF-008 | 大型匯出不得同步載入全部結果至應用程式記憶體或阻塞日常交易。 |

### 13.2 可用性與一致性

- 所有建立、確認、轉單、匯入、取消、釋放及歸檔動作須具冪等設計。
- 系統須避免「SO 顯示成功但 Reservation 不存在」及「SO 失敗但 Reservation 已佔用」的無法恢復狀態。
- 跨模組短暫失敗須可重試並有 Correlation ID；永久失敗須進入可見例外。
- 日常建單及查詢不得依賴 Archive Job 成功才可使用。
- Archive Job、Import Job 或 Export Job 重啟後可安全繼續。

### 13.3 歸檔運作

- 歸檔按月、離峰、分批執行，不使用單一長交易鎖定大量活躍訂單。
- 每批開始及結束均有容量、耗時、錯誤及完整性指標。
- 歸檔失敗須告警；未成功校驗的訂單保留於 Active Store。
- Archive Store 必須有備份、復原演練及可讀性檢查。
- 資料至少保存 7 年，最終銷毀須另立法規及管理政策後才可啟用。

### 13.4 可觀測性

- 指標至少包括每分鐘接單數、成功／失敗／重複數、確認耗時、Reservation 失敗、Backorder 比率、CSV Queue Depth、Archive 候選／成功／失敗數。
- Log 必須包含 Request ID、Correlation ID、SO Number／Source Key 的安全識別及錯誤代碼。
- 不在 Log 記錄完整 CSV、Token、客戶銀行資料或無必要敏感資料。
- 連續積壓、重試異常、重複衝突或歸檔失敗須有運維告警。

### 13.5 可維護性與延伸性

- 新增平台只新增 Adapter 及映射，不複製或分叉 SO 核心規則。
- 標準 Intake Contract 必須版本化並保持向後相容，破壞性改動須有遷移計劃。
- CSV 模板版本與 Intake Contract 版本可獨立演進，但最終映射至相同核心命令。
- 系統設計須清楚分開 Active Query、Archive Query、業務命令及外部 Adapter 邊界。

### 13.6 UI、可及性與相容性

- 遵循 `docs/frontend-design.md` 的共用版面、表單、表格、提示及響應式規則。
- 重要狀態不能只依賴顏色；表單錯誤須可由鍵盤及輔助技術定位。
- 支援專案正式支援的桌面瀏覽器；詳細 Browser Matrix 由 `03_design_spec.md` 及測試計劃定義。

---

## 14. 例外及錯誤處理

| 場景 | 預期處理 |
|---|---|
| Customer／SKU／Warehouse 失效 | 阻止發出報價或確認 SO，指出實際失效項目 |
| 資料版本衝突 | 拒絕覆寫，要求重新載入並保留使用者可理解提示 |
| 庫存不足 | SO 可確認，可用量 Reservation，其餘 Backorder |
| Inventory 完全不可用 | 不顯示確認成功；保留 Draft 或受控恢復狀態並提供追蹤編號 |
| Reservation 建立結果不確定 | 使用相同 Idempotency／Event ID 查詢或重試，不建立第二份 Reservation |
| 取消時 Release 失敗 | 保持未取消狀態，顯示失敗並允許安全重試 |
| Quotation 重複轉單 | 返回既有 Target SO，不建立第二張 |
| CSV 結構錯誤 | 整個檔案預檢失敗，不建立任何 Batch 訂單 |
| CSV 單一來源訂單錯誤 | 該來源訂單形成 Exception；其他有效訂單繼續 |
| 成功來源訂單重送 | 標記 Duplicate 並返回既有 SO |
| 背景工作中斷 | 從已記錄進度續跑；已成功訂單不重複建立 |
| 歸檔期間訂單變為不合資格 | 跳過並記錄原因，不從 Active 移除 |
| Archive 寫入或校驗失敗 | 保留 Active 原資料，Batch 記錄失敗並告警 |
| Archive 暫時不可用 | Active 功能繼續；Archive Search 顯示服務暫不可用而非零結果 |
| 大型匯出失敗 | 顯示 Job 失敗及可重試資訊，不產生不完整下載 |

錯誤訊息須同時有穩定 Error Code 供 API／支援使用，以及清楚的業務描述供使用者修正。

---

## 15. 用戶驗收準則

### 15.1 報價

1. 使用者可為 Active Customer 建立含有效 SKU 的 Draft Quotation，修改最終單價並正確計算總額。
2. 非 Active Customer、不可銷售 SKU、負價格或零／負數量不可發出。
3. 發出的 Quotation 可列印／下載，但 Inventory 沒有新增 Reservation。
4. 有效 Quotation 可轉成一張 Draft SO，使用者可新增／刪除商品及修改數量、價格與倉庫。
5. 系統顯示 Quotation 與 SO 的雙向連結及差異摘要。
6. 同一 Quotation 第二次轉單只返回原 SO，不產生第二張。
7. 過期或取消 Quotation 不可轉單。

### 15.2 人工訂單及價格

8. 具權限使用者可建立單一 Customer、Currency、Warehouse 的人工 Draft SO。
9. 系統帶入 Customer 默認值；只有文件與建議售價幣別相同時才帶入 SKU 建議售價，使用者可修改 Unit Selling Price。
10. SO 畫面沒有 Shipping Address、Discount 或 Tax 必填欄位。
11. 訂單總額等於有效明細 Quantity 乘 Unit Selling Price 的加總。
12. 同時編輯時，舊版本使用者不可覆蓋新版本內容。
13. Customer 或 SKU 在頁面開啟後被停用，確認會被拒絕。
14. 確認後更改 Customer 名稱或 SKU 名稱，不會改寫 SO 快照。

### 15.3 Reservation、Backorder 及生命週期

15. 庫存足夠時，確認 SO 後全部 Ordered Quantity 建立 Reservation，Backorder 為 0。
16. 部分庫存時，SO 仍確認成功，可用數量 Reserved，差額 Backorder。
17. 完全缺貨時，SO 仍確認成功，該行全部 Backorder，Inventory 不出現負數。
18. 多行訂單一行缺貨時，其他行仍可建立 Reservation。
19. 重複確認請求只產生一組有效 Reservation。
20. Backorder 補配後，Reserved 增加、Backorder 等量減少，Ordered 不變。
21. 未履約 Confirmed SO 撤回 Draft 前會釋放 Reservation；釋放失敗時不會錯誤顯示已撤回。
22. 未履約 Confirmed SO 可輸入原因取消，Reservation 被釋放且 Backorder 被取消。
23. 已部分履約 SO 不可整張取消，可關閉剩餘數量而保留已履約歷史。
24. 完全履約後 SO 變為 Completed，數量守恆可對數。

### 15.4 CSV 批量訂單

25. 使用者可下載有版本的 CSV 模板及範例。
26. 同一 Source Order Key 的多個 CSV 行會組成一張 SO。
27. 預檢不建立 SO 或 Reservation，並顯示 Valid、Invalid、Duplicate 及 Warning 數量。
28. 確認處理後，有效來源訂單自動建立、確認並形成 Reservation／Backorder。
29. 一張來源訂單中一行錯誤時，整張來源訂單不建立，但同批其他有效訂單成功。
30. 重新上傳同一成功 External Order ID 不會建立重複 SO。
31. 先前失敗且沒有 SO 的來源訂單修正後可成功重試。
32. 10,000 張來源訂單可作為單一背景批次接受及處理，超過上限會在處理前提示拆檔。
33. 使用者可下載逐張結果，並從成功結果前往 SO、從失敗結果看到欄位及原因。

### 15.5 渠道接入

34. 標準 Intake Contract 能以同一核心規則建立及自動確認渠道訂單。
35. 已成功的 Channel Code ＋ External Order ID 重送時返回原 SO。
36. 同一 External Order ID 在兩個不同 Channel 可分別建立。
37. 驗證失敗不留下部分 SO，並返回機器可識別 Error Code 及 Correlation ID。
38. 新增測試 Adapter 不需修改人工建單、Reservation 或狀態核心規則。

### 15.6 查詢、權限及 Audit

39. Viewer 可查詢但不可建立、確認、取消或匯入訂單。
40. Sales Operator 可處理人工訂單及報價，但沒有 `sales.import` 時不可正式上傳處理 CSV。
41. 修改 URL 或直接呼叫 API 不能繞過權限。
42. 建立、確認、撤回、取消、關閉、轉單、匯入及歸檔均可查到 Actor、時間及狀態變化。
43. 匯出只包含使用者有權查看且符合篩選的資料，公式型文字不會在 spreadsheet 中執行。

### 15.7 容量及歸檔

44. 以每日 10,000 張及 24 個月 Active 資料量進行容量測試時，日常查詢符合 NFR。
45. 月度工作只選擇最終狀態、最後更新超過 24 個月且沒有未完成下游事項的 SO。
46. Open、Has Backorder 或仍有 Reservation 的 SO 即使超過 24 個月也不會歸檔。
47. 歸檔完成後，SO 不再出現在 Active List，但可用相同 SO Number 從 Archive Search 找到。
48. Archive 詳情的金額、數量、快照、來源及最終狀態與歸檔前一致。
49. Archive 資料可查詢及匯出，但不可修改。
50. Archive Batch 中斷後可續跑，不重複歸檔已完成 SO。
51. Archive 校驗失敗的 SO 仍完整保留於 Active Store，並有可追蹤錯誤。
52. Archive 暫時不可用不會阻止新 SO 建立、確認及 Active Search。
53. 系統保留 Archive 至少 7 年，第一階段沒有自動永久刪除功能。

---

## 16. 初始資料、設定及上線準備

### 16.1 必須準備的業務設定

- SO Number 及 Quotation Number 編號規則。
- 可用 Fulfillment Warehouse 清單。
- Currency 精度及四捨五入規則。
- CSV 模板版本、欄位字典、示例及最大檔案大小。
- 初始 Channel Code 清單；即使沒有 API Adapter，CSV 亦須使用受控渠道代碼。
- 每月 Archive 執行日期、離峰時段、告警接收人及保留政策。
- 權限至角色的分配。

### 16.2 上線前資料檢查

- Active Customer、SKU、Sales UOM、Warehouse、Currency 及 Payment Term 已通過資料品質檢查。
- SKU 可銷售狀態、UOM Conversion 及建議售價可由 Sales 正確讀取。
- Inventory ATP、Reservation 及 Release 契約完成整合測試。
- Channel Code 與外部 Customer／Warehouse／SKU 映射責任已明確。
- 若遷移舊銷售訂單，須分清 Active、Archive 及僅供查詢資料，並做筆數及金額校驗。

### 16.3 上線及回復

- 上線前完成每日 10,000 張、24 個月資料基線及 50 名互動使用者的容量驗證。
- CSV、渠道及 Archive 工作須有停止接收、停止排程及安全續跑方案。
- 回復版本不得遺失已分配 SO Number、已建立 Reservation 或已成功接收的外部訂單鍵。
- 上線後重點監察接單成功率、重複率、Reservation 失敗、Backorder、Queue Depth 及查詢延遲。

---

## 17. 建議交付階段

本節只定義能力成果，實際工程任務由 `05_development_tasks.md` 拆分。

### Phase 0 — 契約及容量基線

目標成果：確認 Customer、Item、Inventory、Fulfillment 邊界、SO 狀態及數量守恆；建立 10,000 張／日與 24 個月資料容量測試基線。

獨立驗證：接口契約審閱、狀態轉換測試、容量資料模型驗證。

### Phase 1 — 人工 SO 及輕量 Quotation

目標成果：銷售人員可建立、發出及轉換 Quotation，並建立及確認人工 SO；形成完整商業快照。

獨立驗證：由報價至 Draft SO、人工建單、價格、主檔驗證、版本衝突及權限 UAT。

### Phase 2 — Reservation、Backorder 及訂單生命週期

目標成果：確認時完成單倉 Reservation／Backorder，支援補配、撤回、取消、部分履約後關閉及數量對數。

獨立驗證：庫存足夠、部分不足、完全缺貨、重試、釋放失敗及下游狀態整合測試。

### Phase 3 — CSV 及渠道接入框架

目標成果：完成版本化 CSV 批量開單、例外、去重、背景處理及通用 Adapter Contract。

獨立驗證：10,000 張批次、部分訂單失敗、重傳去重、恢復、輸入安全及測試 Adapter。

### Phase 4 — 查詢、Audit、歸檔及發布門檻

目標成果：完成活躍／歸檔查詢、匯出、Audit、每月安全歸檔、監察及 7 年保留基礎。

獨立驗證：24 個月容量、查詢效能、歸檔資格、校驗、中斷續跑、Archive 查詢及回復演練。

---

## 18. 已確認決策、假設及待確認事項

### 18.1 已確認決策

| 編號 | 決策 |
|---|---|
| DEC-001 | 三種訂單來源為人工、未來平台 Adapter 及 CSV 批量上傳。 |
| DEC-002 | 有效 CSV／渠道訂單自動確認；無效訂單進入 Import Exception。 |
| DEC-003 | 訂單確認立即建立 Reservation；不足數量形成 Backorder，不阻止整張訂單。 |
| DEC-004 | 每張 SO 只使用一個 Fulfillment Warehouse。 |
| DEC-005 | 第一階段只有最終 Unit Selling Price；建議售價可帶入並由銷售人員修改。 |
| DEC-006 | 不處理 Price List、客戶價、Promotion、Discount 及 Sales Tax。 |
| DEC-007 | Sales Quotation 屬本模組；可按需要修改內容後轉為實際 SO。 |
| DEC-008 | Quotation 不保留庫存，一張只可成功轉一張 SO，並保存差異摘要。 |
| DEC-009 | 最終且無下游未完成事項、最後更新超過 24 個月的 SO 每月歸檔。 |
| DEC-010 | Open／Backorder 不自動歸檔；Archive 至少保存 7 年並可查詢匯出。 |
| DEC-011 | 第一階段不包括指定平台整合、Lot／Bin、揀貨、發貨、發票、收款、退貨及跨倉履約。 |
| DEC-012 | Capability Map 及實作依賴次序已確認。 |

### 18.2 為保持簡單而採用、需在設計門檻再次確認的假設

| 編號 | 假設 | 影響 |
|---|---|---|
| ASM-001 | Quotation 轉換先建立 Draft SO，由使用者審閱後再確認及保留庫存。 | 避免報價轉換立即承諾錯誤倉庫或數量。 |
| ASM-002 | 第一階段沒有 SO 審批；具 `sales.mgmt` 權限者可直接確認。 | 權限配置是主要控制。 |
| ASM-003 | 未履約 Confirmed SO 可先釋放 Reservation 後撤回 Draft；已有履約則不可直接改商業內容。 | 提供必要更正能力且保持履約歷史。 |
| ASM-004 | Customer Credit Status `ON_HOLD` 阻止確認；AR Exposure 未接入前 Credit Limit 只提示。 | 避免用過時或不完整數據作硬額度判斷。 |
| ASM-005 | Quotation／SO 每張最多 100 行；CSV 每批最多 10,000 張來源訂單。 | 提供第一階段可測量容量邊界。 |
| ASM-006 | 相同 SKU 及 UOM 在同一訂單合併為一行。 | 簡化 Reservation、履約及數量對數。 |
| ASM-007 | 零 Unit Selling Price 可用但顯示警告，不另設贈品模型。 | 支援樣品或贈送而不加入促銷引擎。 |
| ASM-008 | 歸檔後資料唯讀；歷史更正由未來正式調整流程處理。 | 保持 Archive 完整及可審計。 |
| ASM-009 | 不在 Sales Order Core 保存渠道送貨地址；指定平台接入時由 Adapter 與 Fulfillment 契約處理。 | 保持已確認的「發貨時才選地址」邊界，同時避免日後平台履約資料遺失。 |

### 18.3 必須在 `03_design_spec.md` 前關閉的規格門檻

| Gate | 待確認內容 | 負責方 |
|---|---|---|
| GATE-01 | SO／Quotation Number 格式、時區及每日序號容量 | Product／Engineering |
| GATE-02 | CSV 欄位字典、最大檔案大小、Customer／SKU／Warehouse 映射方式 | Business／Engineering |
| GATE-03 | 標準 Channel Intake Contract、認證方式、同步／非同步接受語義，以及渠道送貨資料交付 Fulfillment 的方式 | Engineering／Security |
| GATE-04 | 高併發 ATP 與 Inventory 全量 Reservation 契約下，Sales 部分保留及重試的一致性設計 | Sales／Inventory Engineering |
| GATE-05 | Customer Credit On Hold 與 Credit Limit 在 AR 尚未交付時的最終處理 | Business／Finance |
| GATE-06 | 50 名併發、每日及尖峰流量、10,000 張批次、24 個月約 730 萬張 Header、真實訂單行數分佈及效能測試環境規格 | Engineering／QA |
| GATE-07 | 每月歸檔日、離峰窗口、Archive Store、備份／復原及告警門檻 | Operations／Engineering |
| GATE-08 | 7 年保留起算點及是否有法律要求超過 7 年 | Business／Compliance |
| GATE-09 | Fulfillment、Invoice、Return 接入後的 Open Downstream Matter 契約 | 各下游模組 Owner |

未關閉上述 Gate 前，可進行需求澄清及原型設計，但不得把未確認假設寫成不可逆的技術實作。

---

## 19. 需求追溯與完成定義

### 19.1 Capability 至需求追溯

| Capability | 主要功能需求 | 主要驗收準則 |
|---|---|---|
| SO-CAP-01 | FR-SO-001 至 FR-SO-024、FR-LIFE-001 至 FR-LIFE-014 | AC 8 至 14、21 至 24 |
| SO-CAP-02 | FR-QUOTE-001 至 FR-QUOTE-017 | AC 1 至 7 |
| SO-CAP-03 | FR-CSV-001 至 FR-CSV-020、FR-CH-001 至 FR-CH-013 | AC 25 至 38 |
| SO-CAP-04 | FR-CONF-001 至 FR-CONF-020 | AC 15 至 24 |
| SO-CAP-05 | FR-INQ-001 至 FR-INQ-012 | AC 39 至 43 |
| SO-CAP-06 | FR-ARC-001 至 FR-ARC-020 | AC 44 至 53 |

### 19.2 業務需求完成定義

本文件可視為完成並可進入系統設計，須符合：

- 業務 Owner 確認第 0.2、2、5、7、8、9、13 及 15 節。
- 第 18.2 節假設獲確認或明確修改。
- 第 18.3 節涉及架構、數據及跨模組契約的 Gate 有 Owner 及處理結論。
- 所有第一階段範圍均有功能需求及可測試驗收準則。
- 範圍外項目沒有被系統設計以隱藏功能方式提前加入。
- `03_design_spec.md` 可由每個 Capability 獨立導出前端、API、資料庫、整合、權限及 Unit／Integration Test 設計。

### 19.3 後續文件

需求獲確認後，依序產出：

1. `docs/sales_order_management/03_design_spec.md`：包括詳細前後端架構、API、Database Table Design、狀態與一致性、歸檔技術設計及測試策略。
2. `docs/sales_order_management/05_development_tasks.md`：按可獨立交付及測試的 Phase／Task 拆分。
3. `docs/sales_order_management/07_uat_test_cases.md`：以業務流程分類的 UAT 及系統驗收案例。

## 20. Harness 2.0 正式需求定義

### 20.1 對齊來源與保留內容

本節保留 Harness 對齊層的基線、映射與門檻敘述；以上章節為本模組的正式敘述正文，章節編號與既有跨文件引用維持不變。

以上正文保留對齊前來源的完整語意，只正規化了已失效的文件路徑；對齊前來源的 SHA-256 為 `6dbdec0883cd6be197b217b7425004dfb809a22eee3ba1c974cfa799f0012756`，其內容由 Git 歷史保存為恢復點。

## 1. Normative Baseline

The complete legacy business wording is embedded in section 8 of this file, with only obsolete self-reference paths normalized to canonical filenames. This aligned document provides canonical Harness IDs, provenance and measurable cross-cutting requirements. Each canonical functional ID maps one-to-one by position; it does not summarize away the original actor, rule, exception or acceptance semantics.

## 2. Outcome, Scope and Provenance

- Outcome: safely capture quotations and Sales Orders from manual, CSV and future Channel sources; confirm against Inventory without duplicate commitment; preserve traceable inquiry and archive history.
- In scope: legacy requirement sections 2.1 and 8.1–8.8.
- Out of scope: legacy section 2.2 and design section 0.4.
- `EXISTING`: all legacy functional requirements, performance targets and security/control prose.
- `ENHANCED`: canonical aliases and explicit separation of NFR/SEC requirements.
- `NEW — USER APPROVED 2026-09-10`: `NFR-014` and `NFR-015` only.

## 3. Canonical Functional Requirement Map

| Canonical IDs | Existing IDs | Normative source | Origin |
| --- | --- | --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017 | FR-QUOTE-001–017 | embedded legacy body §8.1 | EXISTING |
| FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041 | FR-SO-001–024 | §8.2 | EXISTING |
| FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061 | FR-CONF-001–020 | §8.3 | EXISTING |
| FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075 | FR-LIFE-001–014 | §8.4 | EXISTING |
| FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095 | FR-CSV-001–020 | §8.5 | EXISTING |
| FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108 | FR-CH-001–013 | §8.6 | EXISTING |
| FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120 | FR-INQ-001–012 | §8.7 | EXISTING |
| FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140 | FR-ARC-001–020 | §8.8 | EXISTING |

Example: `FR-001 = FR-QUOTE-001`, `FR-018 = FR-SO-001`, `FR-042 = FR-CONF-001`, and `FR-140 = FR-ARC-020`. Every original priority, validation, failure behavior, business rule and acceptance criterion is inherited.

## 4. Non-Functional Requirements

| ID | Requirement / measurable acceptance | Existing source | Provenance |
| --- | --- | --- | --- |
| NFR-001 | Approximately 10,000 SO/day and 24 months/7.3 million Active headers; capacity dataset must model approved line distribution. | NFR-PERF-001 | EXISTING |
| NFR-002 | Normal Active common-list and exact lookup p95 <= 2 seconds. | NFR-PERF-002 | EXISTING |
| NFR-003 | Draft save/confirm up to 100 lines p95 <= 3 seconds excluding dependency failure. | NFR-PERF-003 | EXISTING |
| NFR-004 | Valid 10,000-order CSV batch completes within 30 minutes in a recorded standard environment. | NFR-PERF-004 | EXISTING |
| NFR-005 | At least 50 concurrent interactive users plus CSV/Channel/Archive background work. | NFR-PERF-005 | EXISTING |
| NFR-006 | Archive exact lookup p95 <= 3 seconds; bounded date-range lookup p95 <= 5 seconds. | NFR-PERF-006 | EXISTING |
| NFR-007 | Active query targets remain valid at the full 24-month dataset, not only on empty/small data. | NFR-PERF-007 | EXISTING |
| NFR-008 | Large exports/imports/archives use bounded streaming/background work and do not load entire results into application memory. | NFR-PERF-008, §13.3 | EXISTING |
| NFR-009 | Create/confirm/convert/import/cancel/release/archive operations are idempotent and converge after retry or unknown outcome without duplicate effects. | §13.2 | ENHANCED |
| NFR-010 | Import, export, backorder and archive jobs safely resume after restart; an Archive outage must not block Active Sales operations. | §13.2–13.3 | ENHANCED |
| NFR-011 | Metrics/logs/alerts expose throughput, latency, duplicates, queue age, reservation/backorder and archive failure using bounded non-sensitive labels. | §13.4 | ENHANCED |
| NFR-012 | Intake contracts/templates are versioned and backward-compatible; platform adapters do not fork Sales core rules. | §13.5 | ENHANCED |
| NFR-013 | UI follows shared design, keyboard operation and non-colour-only state; supported viewports are 375/768/1024/1440 px and target WCAG 2.1 AA. | §13.6; design §6.8 | ENHANCED |
| NFR-014 | Production Recovery Time Objective is <= 4 hours, demonstrated by a timed isolated recovery exercise. | User decision | NEW — USER APPROVED 2026-09-10 |
| NFR-015 | Production Recovery Point Objective is <= 15 minutes, demonstrated from backup/log evidence and restored-data reconciliation. | User decision | NEW — USER APPROVED 2026-09-10 |
| NFR-016 | Active and Archive data, source keys and operations are backed up/restorable; Archive is retained at least seven years and has no automatic purge in Phase 1. | §13.3, FR-ARC-012/019 | EXISTING / ENHANCED |

## 5. Security Requirements

| ID | Requirement | Source / Provenance |
| --- | --- | --- |
| SEC-001 | Every Sales query and command enforces server-side authentication and explicit permission. | §11.1 EXISTING |
| SEC-002 | Parent/child ownership and data-scope checks prevent IDOR; unauthorized and absent targets do not leak existence. | §11.1 EXISTING |
| SEC-003 | Channel/service identities use least-privilege purpose allowlists and cannot call management APIs. | §11.1 EXISTING |
| SEC-004 | Background work records initiating business actor and actual system actor. | §11.1 EXISTING |
| SEC-005 | UI/API/CSV/Adapter data is untrusted and receives type, length, enum and business validation. | §11.2 EXISTING |
| SEC-006 | Uploads enforce file/row/order/encoding/type/size limits and safe temporary-file handling. | §11.2; design §5.7–5.8 ENHANCED |
| SEC-007 | UI, logs and spreadsheet output prevent XSS and formula injection while preserving safe Unicode. | §11.2 EXISTING |
| SEC-008 | Public errors never expose SQL, stack traces, credentials, tokens, private paths or raw sensitive payloads. | §11.2 EXISTING |
| SEC-009 | Sales data is minimized: no bank data, platform secrets or unnecessary address data is stored in the SO aggregate. | §11.3 EXISTING |
| SEC-010 | Platform credentials are held by an approved secure integration configuration, not orders/exceptions. | §11.3 EXISTING |
| SEC-011 | Audit, confirmed snapshots and Archive records are immutable to ordinary business users. | §11.3, FR-INQ-011, FR-ARC-014 ENHANCED |
| SEC-012 | Exports enforce the initiating user's scope/filters, owner-safe download and audit metadata. | §11.3, FR-INQ-006–008 ENHANCED |
| SEC-013 | Every write/worker continuation revalidates the actor/service identity inside the command transaction. | design §8.2 ENHANCED |
| SEC-014 | Private downloads use safe filenames, `no-store/private`, `nosniff`, expiry and authorization at download time. | design §5.1 ENHANCED |
| SEC-015 | Idempotency/event keys bind to canonical payload hashes; same key/different payload conflicts without side effect. | design §2.7/5.1 ENHANCED |

## 6. Assumptions, Open Issues and Decisions

| ID | Type | Statement | Status / impact |
| --- | --- | --- | --- |
| ASM-001–009 | ASSUMPTION | Legacy assumptions in requirement §18.2 remain preserved. | Must be rechecked at affected Phase entry; not silently promoted beyond stated scope. |
| OI-001 | DECISION REQUIRED | Production RTO/RPO. | RESOLVED: NFR-014/NFR-015 approved 2026-09-10. |
| OI-002 | OPEN ISSUE | Actual mean/p95 order lines and peak orders/minute. | Blocks performance sign-off, not document alignment. |
| OI-003 | OPEN ISSUE | Approved Customer/Inventory/Fulfillment provider versions and owners. | Blocks affected implementation Phases. |
| OI-004 | OPEN ISSUE | First platform transport auth and address-to-Fulfillment contract. | Blocks platform Adapter go-live only. |
| OI-005 | OPEN ISSUE | Compliance confirmation of retention start and any period longer than seven years. | No purge is allowed until resolved. |

## 7. Requirement Gate

The requirement package is **CONDITIONAL — READY FOR DESIGN/PLANNING, NOT IMPLEMENTATION**. Business scope and acceptance are sufficient for alignment. Provider readiness, current workload distribution and platform/retention decisions remain explicit gates; they are not invented here.


---

### 20.2 正式定義

以下每個實體的 `Statement`／`Decision`／`Goal` 保留原文，`Acceptance criteria` 與 `Failure behavior` 陳述本模組共通的可驗證條件，不新增任何未經確認的業務規則、門檻或流程。

## FR-001 — 具 `sales.mgmt` 的使用者可建立 Quotation Draft

### Statement

具 `sales.mgmt` 的使用者可建立 Quotation Draft。 （Legacy identity：`FR-QUOTE-001`。）

### Acceptance criteria

`FR-QUOTE-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-002 — Quotation 必須選擇 Active Customer，並帶入 Customer 的默認 Currency 及可選 Payment Term

### Statement

Quotation 必須選擇 Active Customer，並帶入 Customer 的默認 Currency 及可選 Payment Term。 （Legacy identity：`FR-QUOTE-002`。）

### Acceptance criteria

`FR-QUOTE-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-003 — Quotation 必須有 Quotation Date 及 Valid Until，且 Valid Until 不得早於 Quotation Date

### Statement

Quotation 必須有 Quotation Date 及 Valid Until，且 Valid Until 不得早於 Quotation Date。 （Legacy identity：`FR-QUOTE-003`。）

### Acceptance criteria

`FR-QUOTE-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-004 — 每張 Quotation 必須至少一個明細，且每行 Quantity 大於 0、Unit Selling Price 不得為負數

### Statement

每張 Quotation 必須至少一個明細，且每行 Quantity 大於 0、Unit Selling Price 不得為負數。 （Legacy identity：`FR-QUOTE-004`。）

### Acceptance criteria

`FR-QUOTE-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-005 — 系統只允許選擇當時 Active、Sellable 且在有效期內的 SKU

### Statement

系統只允許選擇當時 Active、Sellable 且在有效期內的 SKU。 （Legacy identity：`FR-QUOTE-005`。）

### Acceptance criteria

`FR-QUOTE-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-006 — SKU 建議售價只在其 Price Currency 與 Quotation Currency 相同時作預設；否則使用者須輸入 Unit Selling Price。使用者可直接修改最終價格，系統不計算額外折扣或稅

### Statement

SKU 建議售價只在其 Price Currency 與 Quotation Currency 相同時作預設；否則使用者須輸入 Unit Selling Price。使用者可直接修改最終價格，系統不計算額外折扣或稅。 （Legacy identity：`FR-QUOTE-006`。）

### Acceptance criteria

`FR-QUOTE-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-007 — 系統必須即時計算 Line Amount 及 Quotation Total，並按 Currency 規則顯示及四捨五入

### Statement

系統必須即時計算 Line Amount 及 Quotation Total，並按 Currency 規則顯示及四捨五入。 （Legacy identity：`FR-QUOTE-007`。）

### Acceptance criteria

`FR-QUOTE-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-008 — Quotation 可保存客戶參考、備註及行備註，但不得要求送貨地址

### Statement

Quotation 可保存客戶參考、備註及行備註，但不得要求送貨地址。 （Legacy identity：`FR-QUOTE-008`。）

### Acceptance criteria

`FR-QUOTE-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-009 — `DRAFT` 可編輯、發出或取消；發出時必須重新驗證 Customer、SKU、數量、價格及日期

### Statement

`DRAFT` 可編輯、發出或取消；發出時必須重新驗證 Customer、SKU、數量、價格及日期。 （Legacy identity：`FR-QUOTE-009`。）

### Acceptance criteria

`FR-QUOTE-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-010 — `ISSUED` 報價可產生適合列印或下載的客戶版本；格式細節留待 UI／文件設計

### Statement

`ISSUED` 報價可產生適合列印或下載的客戶版本；格式細節留待 UI／文件設計。 （Legacy identity：`FR-QUOTE-010`。）

### Acceptance criteria

`FR-QUOTE-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-011 — 到達 Valid Until 後，尚未轉單或取消的報價應顯示為 `EXPIRED`，不可直接轉單

### Statement

到達 Valid Until 後，尚未轉單或取消的報價應顯示為 `EXPIRED`，不可直接轉單。 （Legacy identity：`FR-QUOTE-011`。）

### Acceptance criteria

`FR-QUOTE-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-012 — 只有 `ISSUED`、未過期及未轉單的 Quotation 可轉為 SO

### Statement

只有 `ISSUED`、未過期及未轉單的 Quotation 可轉為 SO。 （Legacy identity：`FR-QUOTE-012`。）

### Acceptance criteria

`FR-QUOTE-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-013 — 一張 Quotation 只可成功產生一張 SO；重複操作須返回既有 SO，不得建立第二張

### Statement

一張 Quotation 只可成功產生一張 SO；重複操作須返回既有 SO，不得建立第二張。 （Legacy identity：`FR-QUOTE-013`。）

### Acceptance criteria

`FR-QUOTE-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-014 — 轉換後的 SO 初始為 `DRAFT`，允許新增／刪除 SKU、修改數量、Unit Selling Price、倉庫及日期

### Statement

轉換後的 SO 初始為 `DRAFT`，允許新增／刪除 SKU、修改數量、Unit Selling Price、倉庫及日期。 （Legacy identity：`FR-QUOTE-014`。）

### Acceptance criteria

`FR-QUOTE-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-015 — 系統須保存 Quotation 與 SO 的雙向連結，以及新增、刪除、數量及價格差異摘要

### Statement

系統須保存 Quotation 與 SO 的雙向連結，以及新增、刪除、數量及價格差異摘要。 （Legacy identity：`FR-QUOTE-015`。）

### Acceptance criteria

`FR-QUOTE-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-016 — 建立、修改、發出、取消、過期及轉單均須留下狀態歷史及 Audit

### Statement

建立、修改、發出、取消、過期及轉單均須留下狀態歷史及 Audit。 （Legacy identity：`FR-QUOTE-016`。）

### Acceptance criteria

`FR-QUOTE-016` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-017 — Quotation 在任何狀態均不得建立或佔用 Inventory Reservation

### Statement

Quotation 在任何狀態均不得建立或佔用 Inventory Reservation。 （Legacy identity：`FR-QUOTE-017`。）

### Acceptance criteria

`FR-QUOTE-017` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-018 — 具 `sales.view` 的使用者可查看其權限範圍內的 Sales Order 列表及詳情

### Statement

具 `sales.view` 的使用者可查看其權限範圍內的 Sales Order 列表及詳情。 （Legacy identity：`FR-SO-001`。）

### Acceptance criteria

`FR-SO-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-019 — 列表至少顯示 SO Number、Customer、Source、Order Date、Warehouse、Status、Total、Reserved／Backorder 摘要及最後更新時間

### Statement

列表至少顯示 SO Number、Customer、Source、Order Date、Warehouse、Status、Total、Reserved／Backorder 摘要及最後更新時間。 （Legacy identity：`FR-SO-002`。）

### Acceptance criteria

`FR-SO-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-020 — 列表可按 SO Number、Customer ID／Name、Customer PO、日期、狀態、來源、渠道、倉庫及 Has Backorder 篩選

### Statement

列表可按 SO Number、Customer ID／Name、Customer PO、日期、狀態、來源、渠道、倉庫及 Has Backorder 篩選。 （Legacy identity：`FR-SO-003`。）

### Acceptance criteria

`FR-SO-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-021 — 精確 SO Number 或 External Order ID 查詢應優先直接定位，不要求掃描全部歷史資料

### Statement

精確 SO Number 或 External Order ID 查詢應優先直接定位，不要求掃描全部歷史資料。 （Legacy identity：`FR-SO-004`。）

### Acceptance criteria

`FR-SO-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-022 — 具 `sales.mgmt` 的使用者可建立來源為 `MANUAL` 的 Draft SO

### Statement

具 `sales.mgmt` 的使用者可建立來源為 `MANUAL` 的 Draft SO。 （Legacy identity：`FR-SO-005`。）

### Acceptance criteria

`FR-SO-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-023 — 系統應在首次保存 Draft 時分配唯一 SO Number；號碼一經分配不可更改或重用

### Statement

系統應在首次保存 Draft 時分配唯一 SO Number；號碼一經分配不可更改或重用。 （Legacy identity：`FR-SO-006`。）

### Acceptance criteria

`FR-SO-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-024 — SO 必須選擇一個 Active Customer；非 Active Customer 不可建立或確認新訂單

### Statement

SO 必須選擇一個 Active Customer；非 Active Customer 不可建立或確認新訂單。 （Legacy identity：`FR-SO-007`。）

### Acceptance criteria

`FR-SO-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-025 — 系統帶入 Customer 默認 Currency；第一階段不支援一張 SO 多幣別

### Statement

系統帶入 Customer 默認 Currency；第一階段不支援一張 SO 多幣別。 （Legacy identity：`FR-SO-008`。）

### Acceptance criteria

`FR-SO-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-026 — Customer Payment Term 如有設定可帶入並保存快照；沒有設定不阻止建單

### Statement

Customer Payment Term 如有設定可帶入並保存快照；沒有設定不阻止建單。 （Legacy identity：`FR-SO-009`。）

### Acceptance criteria

`FR-SO-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-027 — SO 必須選擇一個 Active Fulfillment Warehouse，所有明細使用相同倉庫

### Statement

SO 必須選擇一個 Active Fulfillment Warehouse，所有明細使用相同倉庫。 （Legacy identity：`FR-SO-010`。）

### Acceptance criteria

`FR-SO-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-028 — SO 不得要求或保存 Shipping Address；發貨地址由下游 Fulfillment 選擇

### Statement

SO 不得要求或保存 Shipping Address；發貨地址由下游 Fulfillment 選擇。 （Legacy identity：`FR-SO-011`。）

### Acceptance criteria

`FR-SO-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-029 — 使用者可輸入 Order Date、可選 Requested Delivery Date、Customer PO／Reference 及備註

### Statement

使用者可輸入 Order Date、可選 Requested Delivery Date、Customer PO／Reference 及備註。 （Legacy identity：`FR-SO-012`。）

### Acceptance criteria

`FR-SO-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-030 — Requested Delivery Date 如有輸入，不得早於 Order Date；特殊補錄需求留待後續版本

### Statement

Requested Delivery Date 如有輸入，不得早於 Order Date；特殊補錄需求留待後續版本。 （Legacy identity：`FR-SO-013`。）

### Acceptance criteria

`FR-SO-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-031 — 每張 SO 必須至少一個明細；第一階段每張最多 100 個有效明細

### Statement

每張 SO 必須至少一個明細；第一階段每張最多 100 個有效明細。 （Legacy identity：`FR-SO-014`。）

### Acceptance criteria

`FR-SO-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-032 — 使用者可按 SKU Code、Name 或 Barcode 搜尋及加入 Active、Sellable、有效期內的 SKU

### Statement

使用者可按 SKU Code、Name 或 Barcode 搜尋及加入 Active、Sellable、有效期內的 SKU。 （Legacy identity：`FR-SO-015`。）

### Acceptance criteria

`FR-SO-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-033 — 同一 SKU 及 Sales UOM 在同一 SO 原則上應合併為一行，避免重複承諾難以理解

### Statement

同一 SKU 及 Sales UOM 在同一 SO 原則上應合併為一行，避免重複承諾難以理解。 （Legacy identity：`FR-SO-016`。）

### Acceptance criteria

`FR-SO-016` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-034 — 每行 Quantity 必須大於 0，並符合 SKU Sales UOM 的精度規則

### Statement

每行 Quantity 必須大於 0，並符合 SKU Sales UOM 的精度規則。 （Legacy identity：`FR-SO-017`。）

### Acceptance criteria

`FR-SO-017` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-035 — SKU 建議售價的 Price Currency 與 SO Currency 相同時，系統可帶入該價格；幣別不同時不得暗中換算，使用者須輸入最終 Unit Selling Price

### Statement

SKU 建議售價的 Price Currency 與 SO Currency 相同時，系統可帶入該價格；幣別不同時不得暗中換算，使用者須輸入最終 Unit Selling Price。 （Legacy identity：`FR-SO-018`。）

### Acceptance criteria

`FR-SO-018` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-036 — Unit Selling Price 必須大於或等於 0；零售價須接受但在確認前顯示明確警告

### Statement

Unit Selling Price 必須大於或等於 0；零售價須接受但在確認前顯示明確警告。 （Legacy identity：`FR-SO-019`。）

### Acceptance criteria

`FR-SO-019` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-037 — 系統按 `Quantity × Unit Selling Price` 計算 Line Amount 及 Order Total

### Statement

系統按 `Quantity × Unit Selling Price` 計算 Line Amount 及 Order Total。 （Legacy identity：`FR-SO-020`。）

### Acceptance criteria

`FR-SO-020` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-038 — 第一階段不顯示或保存折扣、稅碼、稅率及稅額

### Statement

第一階段不顯示或保存折扣、稅碼、稅率及稅額。 （Legacy identity：`FR-SO-021`。）

### Acceptance criteria

`FR-SO-021` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-039 — Draft 可新增、刪除及修改明細；所有修改須採用版本控制，避免覆蓋其他使用者的新修改

### Statement

Draft 可新增、刪除及修改明細；所有修改須採用版本控制，避免覆蓋其他使用者的新修改。 （Legacy identity：`FR-SO-022`。）

### Acceptance criteria

`FR-SO-022` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-040 — 若版本已被他人更新，保存或確認須拒絕並提示重新載入，不得靜默覆蓋

### Statement

若版本已被他人更新，保存或確認須拒絕並提示重新載入，不得靜默覆蓋。 （Legacy identity：`FR-SO-023`。）

### Acceptance criteria

`FR-SO-023` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-041 — 訂單詳情須同時顯示目前主檔參考及確認時快照；兩者不同時不得改寫歷史值

### Statement

訂單詳情須同時顯示目前主檔參考及確認時快照；兩者不同時不得改寫歷史值。 （Legacy identity：`FR-SO-024`。）

### Acceptance criteria

`FR-SO-024` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-042 — 只有完整且有效的 `DRAFT` SO 可確認

### Statement

只有完整且有效的 `DRAFT` SO 可確認。 （Legacy identity：`FR-CONF-001`。）

### Acceptance criteria

`FR-CONF-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-043 — 確認時必須重新驗證 Customer 仍為 Active、Warehouse 有效、SKU 仍符合銷售條件及 UOM 仍有效

### Statement

確認時必須重新驗證 Customer 仍為 Active、Warehouse 有效、SKU 仍符合銷售條件及 UOM 仍有效。 （Legacy identity：`FR-CONF-002`。）

### Acceptance criteria

`FR-CONF-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-044 — 若 Customer 在頁面開啟後變為非 Active，確認必須拒絕並顯示原因

### Statement

若 Customer 在頁面開啟後變為非 Active，確認必須拒絕並顯示原因。 （Legacy identity：`FR-CONF-003`。）

### Acceptance criteria

`FR-CONF-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-045 — Customer Credit Status 為 `ON_HOLD` 時，第一階段拒絕確認；`NOT_CONFIGURED` 或 `NORMAL` 可繼續

### Statement

Customer Credit Status 為 `ON_HOLD` 時，第一階段拒絕確認；`NOT_CONFIGURED` 或 `NORMAL` 可繼續。 （Legacy identity：`FR-CONF-004`。）

### Acceptance criteria

`FR-CONF-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-046 — 在 Accounts Receivable 尚未提供實時 Exposure 前，Credit Limit 只作提示，不實作不可靠的硬額度攔截

### Statement

在 Accounts Receivable 尚未提供實時 Exposure 前，Credit Limit 只作提示，不實作不可靠的硬額度攔截。 （Legacy identity：`FR-CONF-005`。）

### Acceptance criteria

`FR-CONF-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-047 — 系統必須在確認時保存 Customer、SKU、UOM、Currency、Payment Term、Warehouse 及價格的 Business Snapshot

### Statement

系統必須在確認時保存 Customer、SKU、UOM、Currency、Payment Term、Warehouse 及價格的 Business Snapshot。 （Legacy identity：`FR-CONF-006`。）

### Acceptance criteria

`FR-CONF-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-048 — 確認必須具冪等性；重複點擊或重送同一確認請求不得建立重複 Reservation

### Statement

確認必須具冪等性；重複點擊或重送同一確認請求不得建立重複 Reservation。 （Legacy identity：`FR-CONF-007`。）

### Acceptance criteria

`FR-CONF-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-049 — 系統按 SO Line 及 Fulfillment Warehouse 查詢可承諾庫存，建立可用數量的正式 Reservation

### Statement

系統按 SO Line 及 Fulfillment Warehouse 查詢可承諾庫存，建立可用數量的正式 Reservation。 （Legacy identity：`FR-CONF-008`。）

### Acceptance criteria

`FR-CONF-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-050 — 若可承諾數量小於 Ordered Quantity，未能保留的差額成為 Backorder，SO 仍可確認

### Statement

若可承諾數量小於 Ordered Quantity，未能保留的差額成為 Backorder，SO 仍可確認。 （Legacy identity：`FR-CONF-009`。）

### Acceptance criteria

`FR-CONF-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-051 — 若沒有可承諾數量，整行可全部成為 Backorder，SO 仍可確認

### Statement

若沒有可承諾數量，整行可全部成為 Backorder，SO 仍可確認。 （Legacy identity：`FR-CONF-010`。）

### Acceptance criteria

`FR-CONF-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-052 — Inventory 不得自動負庫存；Sales 不得直接更新 Inventory Balance、Lot 或 Bin

### Statement

Inventory 不得自動負庫存；Sales 不得直接更新 Inventory Balance、Lot 或 Bin。 （Legacy identity：`FR-CONF-011`。）

### Acceptance criteria

`FR-CONF-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-053 — 每行須顯示 Ordered、Reserved 及 Backorder Quantity，且 `Ordered = Reserved + Backorder` 於初次確認後成立

### Statement

每行須顯示 Ordered、Reserved 及 Backorder Quantity，且 `Ordered = Reserved + Backorder` 於初次確認後成立。 （Legacy identity：`FR-CONF-012`。）

### Acceptance criteria

`FR-CONF-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-054 — 多行訂單中個別 SKU 缺貨不得阻止其他行建立可用 Reservation

### Statement

多行訂單中個別 SKU 缺貨不得阻止其他行建立可用 Reservation。 （Legacy identity：`FR-CONF-013`。）

### Acceptance criteria

`FR-CONF-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-055 — 確認開始後 SO 進入短暫的 `CONFIRMING`。若 Inventory 完全不可用或最終承諾結果未明，SO 不得假裝確認成功，也不得接受另一個確認；系統須以原事件安全查詢或續跑

### Statement

確認開始後 SO 進入短暫的 `CONFIRMING`。若 Inventory 完全不可用或最終承諾結果未明，SO 不得假裝確認成功，也不得接受另一個確認；系統須以原事件安全查詢或續跑。 （Legacy identity：`FR-CONF-014`。）

### Acceptance criteria

`FR-CONF-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-056 — 技術恢復流程不得建立重複 SO 或重複 Reservation，最終結果須可由 Correlation ID 對數

### Statement

技術恢復流程不得建立重複 SO 或重複 Reservation，最終結果須可由 Correlation ID 對數。 （Legacy identity：`FR-CONF-015`。）

### Acceptance criteria

`FR-CONF-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-057 — 確認成功後，SO 進入 `CONFIRMED` 並記錄 Confirmed By／At

### Statement

確認成功後，SO 進入 `CONFIRMED` 並記錄 Confirmed By／At。 （Legacy identity：`FR-CONF-016`。）

### Acceptance criteria

`FR-CONF-016` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-058 — 已確認訂單的 Backorder 可在庫存補充後由明確的重試／分配動作轉為 Reservation；第一階段不要求複雜分配優先級

### Statement

已確認訂單的 Backorder 可在庫存補充後由明確的重試／分配動作轉為 Reservation；第一階段不要求複雜分配優先級。 （Legacy identity：`FR-CONF-017`。）

### Acceptance criteria

`FR-CONF-017` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-059 — Backorder 補配不得超過當前未履約 Backorder，也不得改變原始 Ordered Quantity

### Statement

Backorder 補配不得超過當前未履約 Backorder，也不得改變原始 Ordered Quantity。 （Legacy identity：`FR-CONF-018`。）

### Acceptance criteria

`FR-CONF-018` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-060 — Reservation 的建立、補配、消耗及釋放須引用 SO Number、Line Number 及穩定的業務事件 ID

### Statement

Reservation 的建立、補配、消耗及釋放須引用 SO Number、Line Number 及穩定的業務事件 ID。 （Legacy identity：`FR-CONF-019`。）

### Acceptance criteria

`FR-CONF-019` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-061 — Inventory 回傳的 Reservation 狀態為庫存承諾真相；SO 保存可查詢投影及 Reference，不得形成第二套可獨立修改的庫存賬

### Statement

Inventory 回傳的 Reservation 狀態為庫存承諾真相；SO 保存可查詢投影及 Reference，不得形成第二套可獨立修改的庫存賬。 （Legacy identity：`FR-CONF-020`。）

### Acceptance criteria

`FR-CONF-020` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-062 — 未有任何 Fulfilled Quantity 的 `CONFIRMED` SO 可撤回為 Draft，以便更正商業資料

### Statement

未有任何 Fulfilled Quantity 的 `CONFIRMED` SO 可撤回為 Draft，以便更正商業資料。 （Legacy identity：`FR-LIFE-001`。）

### Acceptance criteria

`FR-LIFE-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-063 — 撤回前必須成功釋放所有未消耗 Reservation；釋放失敗時不得進入 Draft

### Statement

撤回前必須成功釋放所有未消耗 Reservation；釋放失敗時不得進入 Draft。 （Legacy identity：`FR-LIFE-002`。）

### Acceptance criteria

`FR-LIFE-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-064 — 撤回後原有 Reservation／Backorder 結果失效；再次確認時按最新資料重新建立

### Statement

撤回後原有 Reservation／Backorder 結果失效；再次確認時按最新資料重新建立。 （Legacy identity：`FR-LIFE-003`。）

### Acceptance criteria

`FR-LIFE-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-065 — 已有任何 Fulfilled Quantity 後，Customer、Currency、Warehouse、已履約 SKU、已履約數量及歷史價格快照不可直接修改

### Statement

已有任何 Fulfilled Quantity 後，Customer、Currency、Warehouse、已履約 SKU、已履約數量及歷史價格快照不可直接修改。 （Legacy identity：`FR-LIFE-004`。）

### Acceptance criteria

`FR-LIFE-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-066 — `DRAFT` 可取消且不需庫存操作

### Statement

`DRAFT` 可取消且不需庫存操作。 （Legacy identity：`FR-LIFE-005`。）

### Acceptance criteria

`FR-LIFE-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-067 — `CONFIRMED` 且 Fulfilled Quantity 全為 0 時，可整張取消；必須輸入取消原因

### Statement

`CONFIRMED` 且 Fulfilled Quantity 全為 0 時，可整張取消；必須輸入取消原因。 （Legacy identity：`FR-LIFE-006`。）

### Acceptance criteria

`FR-LIFE-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-068 — 確認訂單取消前，系統必須釋放所有未消耗 Reservation 並取消全部 Backorder

### Statement

確認訂單取消前，系統必須釋放所有未消耗 Reservation 並取消全部 Backorder。 （Legacy identity：`FR-LIFE-007`。）

### Acceptance criteria

`FR-LIFE-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-069 — 已部分履約的訂單不可整張取消，只可關閉剩餘數量

### Statement

已部分履約的訂單不可整張取消，只可關閉剩餘數量。 （Legacy identity：`FR-LIFE-008`。）

### Acceptance criteria

`FR-LIFE-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-070 — 關閉剩餘數量必須輸入原因，釋放未消耗 Reservation 並取消未履約 Backorder

### Statement

關閉剩餘數量必須輸入原因，釋放未消耗 Reservation 並取消未履約 Backorder。 （Legacy identity：`FR-LIFE-009`。）

### Acceptance criteria

`FR-LIFE-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-071 — 關閉後保留已 Fulfilled Quantity、歷史快照及下游參考，Status 為 `CLOSED`

### Statement

關閉後保留已 Fulfilled Quantity、歷史快照及下游參考，Status 為 `CLOSED`。 （Legacy identity：`FR-LIFE-010`。）

### Acceptance criteria

`FR-LIFE-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-072 — 當全部有效 Ordered Quantity 已履約後，SO 進入 `COMPLETED`

### Statement

當全部有效 Ordered Quantity 已履約後，SO 進入 `COMPLETED`。 （Legacy identity：`FR-LIFE-011`。）

### Acceptance criteria

`FR-LIFE-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-073 — 取消、撤回及關閉須使用冪等業務事件，重試不得重複釋放庫存

### Statement

取消、撤回及關閉須使用冪等業務事件，重試不得重複釋放庫存。 （Legacy identity：`FR-LIFE-012`。）

### Acceptance criteria

`FR-LIFE-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-074 — 任何跨模組操作部分失敗時，使用者須看到目前實際狀態及可恢復指引，不得顯示虛假成功

### Statement

任何跨模組操作部分失敗時，使用者須看到目前實際狀態及可恢復指引，不得顯示虛假成功。 （Legacy identity：`FR-LIFE-013`。）

### Acceptance criteria

`FR-LIFE-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-075 — 狀態變更、原因、Actor、時間及關聯庫存事件均須寫入 Audit

### Statement

狀態變更、原因、Actor、時間及關聯庫存事件均須寫入 Audit。 （Legacy identity：`FR-LIFE-014`。）

### Acceptance criteria

`FR-LIFE-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-076 — 具 `sales.import` 的使用者可下載當前 CSV 模板、欄位說明及有效範例

### Statement

具 `sales.import` 的使用者可下載當前 CSV 模板、欄位說明及有效範例。 （Legacy identity：`FR-CSV-001`。）

### Acceptance criteria

`FR-CSV-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-077 — 模板必須有版本；系統須識別檔案版本並拒絕不支援版本

### Statement

模板必須有版本；系統須識別檔案版本並拒絕不支援版本。 （Legacy identity：`FR-CSV-002`。）

### Acceptance criteria

`FR-CSV-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-078 — 每個 CSV 行代表一個訂單明細，以 Source Order Key 把多行組成一張來源訂單

### Statement

每個 CSV 行代表一個訂單明細，以 Source Order Key 把多行組成一張來源訂單。 （Legacy identity：`FR-CSV-003`。）

### Acceptance criteria

`FR-CSV-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-079 — 同一 Source Order Key 的 Customer、Currency、Warehouse、Order Date、Channel Code 及 External Order ID 等表頭欄位必須一致

### Statement

同一 Source Order Key 的 Customer、Currency、Warehouse、Order Date、Channel Code 及 External Order ID 等表頭欄位必須一致。 （Legacy identity：`FR-CSV-004`。）

### Acceptance criteria

`FR-CSV-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-080 — CSV 必填資料至少包括 Source Order Key、Channel Code、External Order ID、Customer ID、Warehouse Code、Order Date、SKU Code、Quantity 及 Unit Selling Price

### Statement

CSV 必填資料至少包括 Source Order Key、Channel Code、External Order ID、Customer ID、Warehouse Code、Order Date、SKU Code、Quantity 及 Unit Selling Price。 （Legacy identity：`FR-CSV-005`。）

### Acceptance criteria

`FR-CSV-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-081 — 系統須檢查編碼、分隔符、欄位、日期、數值、空值、長度、枚舉及惡意公式內容

### Statement

系統須檢查編碼、分隔符、欄位、日期、數值、空值、長度、枚舉及惡意公式內容。 （Legacy identity：`FR-CSV-006`。）

### Acceptance criteria

`FR-CSV-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-082 — 預檢不得建立 SO 或 Reservation；須按來源訂單顯示 Valid、Invalid、Duplicate 及 Warning 結果

### Statement

預檢不得建立 SO 或 Reservation；須按來源訂單顯示 Valid、Invalid、Duplicate 及 Warning 結果。 （Legacy identity：`FR-CSV-007`。）

### Acceptance criteria

`FR-CSV-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-083 — 操作人員確認後才正式處理；有效訂單自動建立及確認，不需逐張人工操作

### Statement

操作人員確認後才正式處理；有效訂單自動建立及確認，不需逐張人工操作。 （Legacy identity：`FR-CSV-008`。）

### Acceptance criteria

`FR-CSV-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-084 — 一張來源訂單任何表頭或明細失敗時，整張訂單失敗，不得留下部分 SO、部分明細或 Reservation

### Statement

一張來源訂單任何表頭或明細失敗時，整張訂單失敗，不得留下部分 SO、部分明細或 Reservation。 （Legacy identity：`FR-CSV-009`。）

### Acceptance criteria

`FR-CSV-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-085 — 同一批次內其他有效來源訂單可繼續處理，不因單一失敗全部中止

### Statement

同一批次內其他有效來源訂單可繼續處理，不因單一失敗全部中止。 （Legacy identity：`FR-CSV-010`。）

### Acceptance criteria

`FR-CSV-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-086 — 成功訂單須執行與人工 SO 相同的 Customer、SKU、價格、Reservation 及 Backorder 規則

### Statement

成功訂單須執行與人工 SO 相同的 Customer、SKU、價格、Reservation 及 Backorder 規則。 （Legacy identity：`FR-CSV-011`。）

### Acceptance criteria

`FR-CSV-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-087 — `Channel Code + External Order ID` 對成功訂單必須唯一；同一檔案重傳或跨批次重傳不得重複開單

### Statement

`Channel Code + External Order ID` 對成功訂單必須唯一；同一檔案重傳或跨批次重傳不得重複開單。 （Legacy identity：`FR-CSV-012`。）

### Acceptance criteria

`FR-CSV-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-088 — 檔案雜湊可用於提示完整檔案重傳，但不得取代訂單級唯一性判斷

### Statement

檔案雜湊可用於提示完整檔案重傳，但不得取代訂單級唯一性判斷。 （Legacy identity：`FR-CSV-013`。）

### Acceptance criteria

`FR-CSV-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-089 — 先前失敗且未建立 SO 的 External Order ID 可在修正後重新提交；成功後即受唯一性約束

### Statement

先前失敗且未建立 SO 的 External Order ID 可在修正後重新提交；成功後即受唯一性約束。 （Legacy identity：`FR-CSV-014`。）

### Acceptance criteria

`FR-CSV-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-090 — 每次上傳最多支援 10,000 張來源訂單；超過上限須在建立背景工作前拒絕並提示拆檔

### Statement

每次上傳最多支援 10,000 張來源訂單；超過上限須在建立背景工作前拒絕並提示拆檔。 （Legacy identity：`FR-CSV-015`。）

### Acceptance criteria

`FR-CSV-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-091 — 大型檔案以背景工作處理，頁面須顯示排隊、處理中、完成、部分成功或失敗狀態

### Statement

大型檔案以背景工作處理，頁面須顯示排隊、處理中、完成、部分成功或失敗狀態。 （Legacy identity：`FR-CSV-016`。）

### Acceptance criteria

`FR-CSV-016` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-092 — 完成後須提供包含 Source Order Key、External Order ID、結果、SO Number、錯誤代碼及錯誤訊息的結果 CSV

### Statement

完成後須提供包含 Source Order Key、External Order ID、結果、SO Number、錯誤代碼及錯誤訊息的結果 CSV。 （Legacy identity：`FR-CSV-017`。）

### Acceptance criteria

`FR-CSV-017` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-093 — 匯出內容須防止 spreadsheet formula injection，並使用 UTF-8 及已公布格式

### Statement

匯出內容須防止 spreadsheet formula injection，並使用 UTF-8 及已公布格式。 （Legacy identity：`FR-CSV-018`。）

### Acceptance criteria

`FR-CSV-018` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-094 — 同一 Batch 的確認操作具冪等性；重複點擊不得啟動多個正式處理工作

### Statement

同一 Batch 的確認操作具冪等性；重複點擊不得啟動多個正式處理工作。 （Legacy identity：`FR-CSV-019`。）

### Acceptance criteria

`FR-CSV-019` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-095 — 系統須保留 Batch、每張來源訂單結果、Actor、時間及 Correlation ID，供查詢及 Audit

### Statement

系統須保留 Batch、每張來源訂單結果、Actor、時間及 Correlation ID，供查詢及 Audit。 （Legacy identity：`FR-CSV-020`。）

### Acceptance criteria

`FR-CSV-020` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-096 — 第一階段須定義穩定的 Sales Order Intake Contract，供日後每個平台 Adapter 對接

### Statement

第一階段須定義穩定的 Sales Order Intake Contract，供日後每個平台 Adapter 對接。 （Legacy identity：`FR-CH-001`。）

### Acceptance criteria

`FR-CH-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-097 — 平台專屬欄位轉換、簽名及認證由 Adapter 負責；Sales Order Core 只接收標準契約

### Statement

平台專屬欄位轉換、簽名及認證由 Adapter 負責；Sales Order Core 只接收標準契約。 （Legacy identity：`FR-CH-002`。）

### Acceptance criteria

`FR-CH-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-098 — 標準契約至少包含 Channel Code、External Order ID、Customer、Warehouse、Order Date、Currency 及一至多個訂單明細

### Statement

標準契約至少包含 Channel Code、External Order ID、Customer、Warehouse、Order Date、Currency 及一至多個訂單明細。 （Legacy identity：`FR-CH-003`。）

### Acceptance criteria

`FR-CH-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-099 — 每個請求必須有 Request ID／Idempotency Key 及可端到端追蹤的 Correlation ID

### Statement

每個請求必須有 Request ID／Idempotency Key 及可端到端追蹤的 Correlation ID。 （Legacy identity：`FR-CH-004`。）

### Acceptance criteria

`FR-CH-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-100 — 有效渠道訂單自動建立及確認，並執行相同 Reservation／Backorder 規則

### Statement

有效渠道訂單自動建立及確認，並執行相同 Reservation／Backorder 規則。 （Legacy identity：`FR-CH-005`。）

### Acceptance criteria

`FR-CH-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-101 — 驗證失敗的渠道訂單形成 Import Exception；不得建立部分 SO

### Statement

驗證失敗的渠道訂單形成 Import Exception；不得建立部分 SO。 （Legacy identity：`FR-CH-006`。）

### Acceptance criteria

`FR-CH-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-102 — 重送已成功的 Channel Code ＋ External Order ID 時，系統返回既有 SO 及結果，不再建立訂單

### Statement

重送已成功的 Channel Code ＋ External Order ID 時，系統返回既有 SO 及結果，不再建立訂單。 （Legacy identity：`FR-CH-007`。）

### Acceptance criteria

`FR-CH-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-103 — 相同 External Order ID 在不同 Channel 可視為不同來源訂單

### Statement

相同 External Order ID 在不同 Channel 可視為不同來源訂單。 （Legacy identity：`FR-CH-008`。）

### Acceptance criteria

`FR-CH-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-104 — 渠道接入須返回 Accepted、Duplicate、Validation Failed 或 Technical Retry 等可機器識別結果

### Statement

渠道接入須返回 Accepted、Duplicate、Validation Failed 或 Technical Retry 等可機器識別結果。 （Legacy identity：`FR-CH-009`。）

### Acceptance criteria

`FR-CH-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-105 — 可重試的技術失敗與不可重試的業務驗證錯誤必須清楚區分

### Statement

可重試的技術失敗與不可重試的業務驗證錯誤必須清楚區分。 （Legacy identity：`FR-CH-010`。）

### Acceptance criteria

`FR-CH-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-106 — 渠道訂單須保存來源參考，但不得在 SO 中保存平台密碼、Token 或完整認證 Payload

### Statement

渠道訂單須保存來源參考，但不得在 SO 中保存平台密碼、Token 或完整認證 Payload。 （Legacy identity：`FR-CH-011`。）

### Acceptance criteria

`FR-CH-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-107 — 未來新增 Adapter 不應要求修改 SO 核心業務規則；平台差異由 Adapter 映射處理

### Statement

未來新增 Adapter 不應要求修改 SO 核心業務規則；平台差異由 Adapter 映射處理。 （Legacy identity：`FR-CH-012`。）

### Acceptance criteria

`FR-CH-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-108 — 第一階段不要求向平台回傳發貨、取消或退款狀態，只保留可擴展的訂單結果邊界

### Statement

第一階段不要求向平台回傳發貨、取消或退款狀態，只保留可擴展的訂單結果邊界。 （Legacy identity：`FR-CH-013`。）

### Acceptance criteria

`FR-CH-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-109 — 系統須提供 My Recent Orders、All Active Orders、Outstanding Orders、Has Backorder 及 Finalized Orders 常用視圖

### Statement

系統須提供 My Recent Orders、All Active Orders、Outstanding Orders、Has Backorder 及 Finalized Orders 常用視圖。 （Legacy identity：`FR-INQ-001`。）

### Acceptance criteria

`FR-INQ-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-110 — Outstanding Orders 包括仍有未 Fulfilled、未 Released 或 Backorder 數量的非最終訂單

### Statement

Outstanding Orders 包括仍有未 Fulfilled、未 Released 或 Backorder 數量的非最終訂單。 （Legacy identity：`FR-INQ-002`。）

### Acceptance criteria

`FR-INQ-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-111 — 詳情頁須顯示來源、客戶及商品快照、金額、Reservation／Backorder、狀態歷史及下游參考

### Statement

詳情頁須顯示來源、客戶及商品快照、金額、Reservation／Backorder、狀態歷史及下游參考。 （Legacy identity：`FR-INQ-003`。）

### Acceptance criteria

`FR-INQ-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-112 — 使用者可從 Quotation 前往轉換後 SO，也可從 SO 返回來源 Quotation

### Statement

使用者可從 Quotation 前往轉換後 SO，也可從 SO 返回來源 Quotation。 （Legacy identity：`FR-INQ-004`。）

### Acceptance criteria

`FR-INQ-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-113 — 使用者可從 CSV／Channel SO 前往來源 Batch 或 Import Result

### Statement

使用者可從 CSV／Channel SO 前往來源 Batch 或 Import Result。 （Legacy identity：`FR-INQ-005`。）

### Acceptance criteria

`FR-INQ-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-114 — 列表匯出須套用與畫面相同的權限及篩選，不得繞過資料範圍

### Statement

列表匯出須套用與畫面相同的權限及篩選，不得繞過資料範圍。 （Legacy identity：`FR-INQ-006`。）

### Acceptance criteria

`FR-INQ-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-115 — 小型匯出可即時下載；大型匯出須使用背景工作並提供狀態及有限期下載

### Statement

小型匯出可即時下載；大型匯出須使用背景工作並提供狀態及有限期下載。 （Legacy identity：`FR-INQ-007`。）

### Acceptance criteria

`FR-INQ-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-116 — 匯出至少包括 SO Number、來源、客戶、日期、倉庫、狀態、金額及數量摘要

### Statement

匯出至少包括 SO Number、來源、客戶、日期、倉庫、狀態、金額及數量摘要。 （Legacy identity：`FR-INQ-008`。）

### Acceptance criteria

`FR-INQ-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-117 — Audit 須記錄建立、修改、確認、撤回、取消、關閉、轉單、匯入、重試、Reservation 及歸檔事件

### Statement

Audit 須記錄建立、修改、確認、撤回、取消、關閉、轉單、匯入、重試、Reservation 及歸檔事件。 （Legacy identity：`FR-INQ-009`。）

### Acceptance criteria

`FR-INQ-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-118 — 具查看權限的使用者可看業務狀態歷史；只有獲授權運維人員可看技術錯誤詳情

### Statement

具查看權限的使用者可看業務狀態歷史；只有獲授權運維人員可看技術錯誤詳情。 （Legacy identity：`FR-INQ-010`。）

### Acceptance criteria

`FR-INQ-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-119 — 使用者不得修改 Audit Event 或已確認的歷史快照

### Statement

使用者不得修改 Audit Event 或已確認的歷史快照。 （Legacy identity：`FR-INQ-011`。）

### Acceptance criteria

`FR-INQ-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-120 — 查詢結果須明確標示資料來自 Active 或 Archive，避免使用者誤以為歷史資料遺失

### Statement

查詢結果須明確標示資料來自 Active 或 Archive，避免使用者誤以為歷史資料遺失。 （Legacy identity：`FR-INQ-012`。）

### Acceptance criteria

`FR-INQ-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-121 — 系統須每月於可設定的離峰時段執行銷售訂單歸檔

### Statement

系統須每月於可設定的離峰時段執行銷售訂單歸檔。 （Legacy identity：`FR-ARC-001`。）

### Acceptance criteria

`FR-ARC-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-122 — 只有 `COMPLETED`、`CLOSED` 或 `CANCELLED` SO 才可成為歸檔候選

### Statement

只有 `COMPLETED`、`CLOSED` 或 `CANCELLED` SO 才可成為歸檔候選。 （Legacy identity：`FR-ARC-002`。）

### Acceptance criteria

`FR-ARC-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-123 — 候選 SO 的最後業務更新時間必須早於執行日 24 個月

### Statement

候選 SO 的最後業務更新時間必須早於執行日 24 個月。 （Legacy identity：`FR-ARC-003`。）

### Acceptance criteria

`FR-ARC-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-124 — 仍有 Reservation、Backorder、未完成 Fulfillment 或其他已接入下游事項的 SO 不得歸檔

### Statement

仍有 Reservation、Backorder、未完成 Fulfillment 或其他已接入下游事項的 SO 不得歸檔。 （Legacy identity：`FR-ARC-004`。）

### Acceptance criteria

`FR-ARC-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-125 — 歸檔資格須在真正搬移前再次檢查，避免候選產生後狀態已改變

### Statement

歸檔資格須在真正搬移前再次檢查，避免候選產生後狀態已改變。 （Legacy identity：`FR-ARC-005`。）

### Acceptance criteria

`FR-ARC-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-126 — SO Header、Lines、來源連結、Quotation Conversion 摘要、必要狀態歷史及 Audit 關聯須一併歸檔

### Statement

SO Header、Lines、來源連結、Quotation Conversion 摘要、必要狀態歷史及 Audit 關聯須一併歸檔。 （Legacy identity：`FR-ARC-006`。）

### Acceptance criteria

`FR-ARC-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-127 — 系統須先寫入 Archive Store 並完成筆數及完整性校驗，才可從 Active Store 移除

### Statement

系統須先寫入 Archive Store 並完成筆數及完整性校驗，才可從 Active Store 移除。 （Legacy identity：`FR-ARC-007`。）

### Acceptance criteria

`FR-ARC-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-128 — 歸檔不得重新計算金額、數量、狀態或快照，也不得改變訂單業務結果

### Statement

歸檔不得重新計算金額、數量、狀態或快照，也不得改變訂單業務結果。 （Legacy identity：`FR-ARC-008`。）

### Acceptance criteria

`FR-ARC-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-129 — Archive Batch 須分批處理、可安全重跑及可從中斷點繼續，避免長時間鎖定日常交易

### Statement

Archive Batch 須分批處理、可安全重跑及可從中斷點繼續，避免長時間鎖定日常交易。 （Legacy identity：`FR-ARC-009`。）

### Acceptance criteria

`FR-ARC-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-130 — 同一 SO 不得重複歸檔；重跑已完成批次不得產生重複資料

### Statement

同一 SO 不得重複歸檔；重跑已完成批次不得產生重複資料。 （Legacy identity：`FR-ARC-010`。）

### Acceptance criteria

`FR-ARC-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-131 — 單筆失敗須記錄原因並留待重試；不得因少量失敗使已校驗成功資料回到不一致狀態

### Statement

單筆失敗須記錄原因並留待重試；不得因少量失敗使已校驗成功資料回到不一致狀態。 （Legacy identity：`FR-ARC-011`。）

### Acceptance criteria

`FR-ARC-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-132 — 歸檔 SO 至少保存 7 年；正式銷毀政策不屬第一階段，期間不得自動刪除

### Statement

歸檔 SO 至少保存 7 年；正式銷毀政策不屬第一階段，期間不得自動刪除。 （Legacy identity：`FR-ARC-012`。）

### Acceptance criteria

`FR-ARC-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-133 — 使用者可按 SO Number、Customer、External Order ID、Order Date、Status 及 Channel 查詢 Archive

### Statement

使用者可按 SO Number、Customer、External Order ID、Order Date、Status 及 Channel 查詢 Archive。 （Legacy identity：`FR-ARC-013`。）

### Acceptance criteria

`FR-ARC-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-134 — Archive 結果為唯讀，可查看詳情、Audit 摘要及匯出，不可修改、取消或重新確認

### Statement

Archive 結果為唯讀，可查看詳情、Audit 摘要及匯出，不可修改、取消或重新確認。 （Legacy identity：`FR-ARC-014`。）

### Acceptance criteria

`FR-ARC-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-135 — Active Search 找不到資料時，可提供明確入口搜尋 Archive，但不得在每個常用列表自動掃描整個 Archive

### Statement

Active Search 找不到資料時，可提供明確入口搜尋 Archive，但不得在每個常用列表自動掃描整個 Archive。 （Legacy identity：`FR-ARC-015`。）

### Acceptance criteria

`FR-ARC-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-136 — 大範圍 Archive 匯出須使用背景工作，並記錄發起人、條件、筆數及下載時間

### Statement

大範圍 Archive 匯出須使用背景工作，並記錄發起人、條件、筆數及下載時間。 （Legacy identity：`FR-ARC-016`。）

### Acceptance criteria

`FR-ARC-016` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-137 — 每次 Archive Batch 須產生候選、成功、跳過、失敗、耗時及校驗報告，供運維監察

### Statement

每次 Archive Batch 須產生候選、成功、跳過、失敗、耗時及校驗報告，供運維監察。 （Legacy identity：`FR-ARC-017`。）

### Acceptance criteria

`FR-ARC-017` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-138 — 歸檔工作失敗不得阻止新訂單、訂單查詢、確認或 Fulfillment 的正常運作

### Statement

歸檔工作失敗不得阻止新訂單、訂單查詢、確認或 Fulfillment 的正常運作。 （Legacy identity：`FR-ARC-018`。）

### Acceptance criteria

`FR-ARC-018` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-139 — 活躍及歸檔資料的備份、復原及完整性驗證須納入營運程序

### Statement

活躍及歸檔資料的備份、復原及完整性驗證須納入營運程序。 （Legacy identity：`FR-ARC-019`。）

### Acceptance criteria

`FR-ARC-019` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## FR-140 — 未來下游模組接入後，Open Downstream Matter 判定須按正式契約擴充，不能只依 Header Status

### Statement

未來下游模組接入後，Open Downstream Matter 判定須按正式契約擴充，不能只依 Header Status。 （Legacy identity：`FR-ARC-020`。）

### Acceptance criteria

`FR-ARC-020` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-001 — Approximately 10,000 SO/day and 24 months/7.3 million Active headers; capacity dataset must model approved line distribution.

### Statement

Approximately 10,000 SO/day and 24 months/7.3 million Active headers; capacity dataset must model approved line distribution. （來源／Provenance：NFR-PERF-001 | EXISTING。）

### Acceptance criteria

`NFR-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-002 — Normal Active common-list and exact lookup p95 <= 2 seconds.

### Statement

Normal Active common-list and exact lookup p95 <= 2 seconds. （來源／Provenance：NFR-PERF-002 | EXISTING。）

### Acceptance criteria

`NFR-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-003 — Draft save/confirm up to 100 lines p95 <= 3 seconds excluding dependency failure.

### Statement

Draft save/confirm up to 100 lines p95 <= 3 seconds excluding dependency failure. （來源／Provenance：NFR-PERF-003 | EXISTING。）

### Acceptance criteria

`NFR-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-004 — Valid 10,000-order CSV batch completes within 30 minutes in a recorded standard environment.

### Statement

Valid 10,000-order CSV batch completes within 30 minutes in a recorded standard environment. （來源／Provenance：NFR-PERF-004 | EXISTING。）

### Acceptance criteria

`NFR-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-005 — At least 50 concurrent interactive users plus CSV/Channel/Archive background work.

### Statement

At least 50 concurrent interactive users plus CSV/Channel/Archive background work. （來源／Provenance：NFR-PERF-005 | EXISTING。）

### Acceptance criteria

`NFR-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-006 — Archive exact lookup p95 <= 3 seconds; bounded date-range lookup p95 <= 5 seconds.

### Statement

Archive exact lookup p95 <= 3 seconds; bounded date-range lookup p95 <= 5 seconds. （來源／Provenance：NFR-PERF-006 | EXISTING。）

### Acceptance criteria

`NFR-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-007 — Active query targets remain valid at the full 24-month dataset, not only on empty/small data.

### Statement

Active query targets remain valid at the full 24-month dataset, not only on empty/small data. （來源／Provenance：NFR-PERF-007 | EXISTING。）

### Acceptance criteria

`NFR-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-008 — Large exports/imports/archives use bounded streaming/background work and do not load entire results into application memory.

### Statement

Large exports/imports/archives use bounded streaming/background work and do not load entire results into application memory. （來源／Provenance：NFR-PERF-008, §13.3 | EXISTING。）

### Acceptance criteria

`NFR-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-009 — Create/confirm/convert/import/cancel/release/archive operations are idempotent and converge after retry or unknown outcome without duplicate effects.

### Statement

Create/confirm/convert/import/cancel/release/archive operations are idempotent and converge after retry or unknown outcome without duplicate effects. （來源／Provenance：§13.2 | ENHANCED。）

### Acceptance criteria

`NFR-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-010 — Import, export, backorder and archive jobs safely resume after restart; an Archive outage must not block Active Sales operations.

### Statement

Import, export, backorder and archive jobs safely resume after restart; an Archive outage must not block Active Sales operations. （來源／Provenance：§13.2–13.3 | ENHANCED。）

### Acceptance criteria

`NFR-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-011 — Metrics/logs/alerts expose throughput, latency, duplicates, queue age, reservation/backorder and archive failure using bounded non-sensitive labels.

### Statement

Metrics/logs/alerts expose throughput, latency, duplicates, queue age, reservation/backorder and archive failure using bounded non-sensitive labels. （來源／Provenance：§13.4 | ENHANCED。）

### Acceptance criteria

`NFR-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-012 — Intake contracts/templates are versioned and backward-compatible; platform adapters do not fork Sales core rules.

### Statement

Intake contracts/templates are versioned and backward-compatible; platform adapters do not fork Sales core rules. （來源／Provenance：§13.5 | ENHANCED。）

### Acceptance criteria

`NFR-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-013 — UI follows shared design, keyboard operation and non-colour-only state; supported viewports are 375/768/1024/1440 px and target WCAG 2.1 AA.

### Statement

UI follows shared design, keyboard operation and non-colour-only state; supported viewports are 375/768/1024/1440 px and target WCAG 2.1 AA. （來源／Provenance：§13.6; design §6.8 | ENHANCED。）

### Acceptance criteria

`NFR-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-014 — Production Recovery Time Objective is <= 4 hours, demonstrated by a timed isolated recovery exercise.

### Statement

Production Recovery Time Objective is <= 4 hours, demonstrated by a timed isolated recovery exercise. （來源／Provenance：User decision | NEW — USER APPROVED 2026-09-10。）

### Acceptance criteria

`NFR-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-015 — Production Recovery Point Objective is <= 15 minutes, demonstrated from backup/log evidence and restored-data reconciliation.

### Statement

Production Recovery Point Objective is <= 15 minutes, demonstrated from backup/log evidence and restored-data reconciliation. （來源／Provenance：User decision | NEW — USER APPROVED 2026-09-10。）

### Acceptance criteria

`NFR-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## NFR-016 — Active and Archive data, source keys and operations are backed up/restorable; Archive is retained at least seven years and has no automatic purge in Phase 1.

### Statement

Active and Archive data, source keys and operations are backed up/restorable; Archive is retained at least seven years and has no automatic purge in Phase 1. （來源／Provenance：§13.3, FR-ARC-012/019 | EXISTING / ENHANCED。）

### Acceptance criteria

`NFR-016` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-001 — Every Sales query and command enforces server-side authentication and explicit permission.

### Statement

Every Sales query and command enforces server-side authentication and explicit permission. （來源／Provenance：§11.1 EXISTING。）

### Acceptance criteria

`SEC-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-002 — Parent/child ownership and data-scope checks prevent IDOR; unauthorized and absent targets do not leak existence.

### Statement

Parent/child ownership and data-scope checks prevent IDOR; unauthorized and absent targets do not leak existence. （來源／Provenance：§11.1 EXISTING。）

### Acceptance criteria

`SEC-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-003 — Channel/service identities use least-privilege purpose allowlists and cannot call management APIs.

### Statement

Channel/service identities use least-privilege purpose allowlists and cannot call management APIs. （來源／Provenance：§11.1 EXISTING。）

### Acceptance criteria

`SEC-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-004 — Background work records initiating business actor and actual system actor.

### Statement

Background work records initiating business actor and actual system actor. （來源／Provenance：§11.1 EXISTING。）

### Acceptance criteria

`SEC-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-005 — UI/API/CSV/Adapter data is untrusted and receives type, length, enum and business validation.

### Statement

UI/API/CSV/Adapter data is untrusted and receives type, length, enum and business validation. （來源／Provenance：§11.2 EXISTING。）

### Acceptance criteria

`SEC-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-006 — Uploads enforce file/row/order/encoding/type/size limits and safe temporary-file handling.

### Statement

Uploads enforce file/row/order/encoding/type/size limits and safe temporary-file handling. （來源／Provenance：§11.2; design §5.7–5.8 ENHANCED。）

### Acceptance criteria

`SEC-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-007 — UI, logs and spreadsheet output prevent XSS and formula injection while preserving safe Unicode.

### Statement

UI, logs and spreadsheet output prevent XSS and formula injection while preserving safe Unicode. （來源／Provenance：§11.2 EXISTING。）

### Acceptance criteria

`SEC-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-008 — Public errors never expose SQL, stack traces, credentials, tokens, private paths or raw sensitive payloads.

### Statement

Public errors never expose SQL, stack traces, credentials, tokens, private paths or raw sensitive payloads. （來源／Provenance：§11.2 EXISTING。）

### Acceptance criteria

`SEC-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-009 — Sales data is minimized: no bank data, platform secrets or unnecessary address data is stored in the SO aggregate.

### Statement

Sales data is minimized: no bank data, platform secrets or unnecessary address data is stored in the SO aggregate. （來源／Provenance：§11.3 EXISTING。）

### Acceptance criteria

`SEC-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-010 — Platform credentials are held by an approved secure integration configuration, not orders/exceptions.

### Statement

Platform credentials are held by an approved secure integration configuration, not orders/exceptions. （來源／Provenance：§11.3 EXISTING。）

### Acceptance criteria

`SEC-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-011 — Audit, confirmed snapshots and Archive records are immutable to ordinary business users.

### Statement

Audit, confirmed snapshots and Archive records are immutable to ordinary business users. （來源／Provenance：§11.3, FR-INQ-011, FR-ARC-014 ENHANCED。）

### Acceptance criteria

`SEC-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-012 — Exports enforce the initiating user's scope/filters, owner-safe download and audit metadata.

### Statement

Exports enforce the initiating user's scope/filters, owner-safe download and audit metadata. （來源／Provenance：§11.3, FR-INQ-006–008 ENHANCED。）

### Acceptance criteria

`SEC-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-013 — Every write/worker continuation revalidates the actor/service identity inside the command transaction.

### Statement

Every write/worker continuation revalidates the actor/service identity inside the command transaction. （來源／Provenance：design §8.2 ENHANCED。）

### Acceptance criteria

`SEC-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-014 — Private downloads use safe filenames, `no-store/private`, `nosniff`, expiry and authorization at download time.

### Statement

Private downloads use safe filenames, `no-store/private`, `nosniff`, expiry and authorization at download time. （來源／Provenance：design §5.1 ENHANCED。）

### Acceptance criteria

`SEC-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

## SEC-015 — Idempotency/event keys bind to canonical payload hashes; same key/different payload conflicts without side effect.

### Statement

Idempotency/event keys bind to canonical payload hashes; same key/different payload conflicts without side effect. （來源／Provenance：design §2.7/5.1 ENHANCED。）

### Acceptance criteria

`SEC-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior

非法、未授權、過時、衝突或不完整的輸入不得產生部分 Quotation、部分 Sales Order、部分 Reservation、部分 Backorder、部分 Intake 或部分 Archive 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含 Token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或內部路徑。

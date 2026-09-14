# Fulfillment & Shipping Management 業務需求書（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Fulfillment & Shipping Management 業務需求書 |
| 文件版本 | 0.2 Approved Planning Baseline |
| 文件日期 | 2026-09-09 |
| 文件狀態 | ERP Product Owner（Sam）已於 2026-09-14 批准本需求／設計／Phase 計劃基線；尚未授權進入 IMPLEMENT，業務驗收簽核（§19.2）仍未完成 |
| 適用系統 | ERP App |
| 適用組織 | 單一公司；中小企業 |
| 營運規模 | 5 個以內倉庫；承接每日約 10,000 張 Sales Order 的履約量級 |
| 主要範圍 | 待履約清單、Fulfillment 工作單、Bin／Lot 分配、揀貨、短揀、Shipment、出庫、Shipment Reversal、查詢及稽核 |
| UI／UX基準 | `docs/frontend-design.md` |

### 0.1 文件目的

本文件定義 ERP Fulfillment & Shipping Management（履約及出貨管理）模組第一階段應滿足的業務需求，作為業務確認、系統設計、開發、測試、驗收、上線及後續變更控制的共同基準。

本文件描述系統須支援的業務能力、流程、規則、權限及可驗收結果，不指定資料庫表、API 路徑、程式架構或前端元件。技術設計須在本文件簽核後另行產出；如技術設計與本文件衝突，須先修訂並重新確認需求。

### 0.2 業務背景

本 ERP 主要服務化妝品、零食、健康食品及飲品等消耗品的批發業務。Sales Order 確認後已按 SKU 及單一 Fulfillment Warehouse 建立 Inventory Reservation 或 Backorder，但尚未指定實際從哪一個 Bin、哪一個 Lot 揀貨，也未形成正式出庫及 Shipment。

若缺少獨立履約流程，倉務人員只能依靠紙張或直接修改庫存，容易出現揀錯批次、忽略效期、重複出貨、短揀後訂單差額消失、地址錯誤，以及 SO、Shipment 與 Inventory 數量無法對賬等問題。

本模組負責把已確認且已有 Reservation 的 SO 數量轉成可執行的揀貨工作，按 Inventory 提供的合資格 Bin／Lot 建立 Allocation，在確認出貨時才正式 Issue 庫存並更新 SO Fulfilled Quantity。Inventory Management 仍是 On Hand、Reservation、Allocation 及 Movement 的唯一事實來源。

### 0.3 已確認的核心方向

1. Confirmed SO 自動出現在待履約清單，由倉務人員手動建立本次 Fulfillment／Pick List。
2. 一張 SO 可分多次履約及出貨；每張 Fulfillment 及 Shipment 只屬於一張 SO，不支援多張 SO 合併 Shipment。
3. Fulfillment 可選擇一個或多個有未消耗 Reservation 的 SO Lines 及部分數量；純 Backorder 不可揀貨。
4. 揀貨時才把 Reservation 分配至具體 Warehouse／Bin／Lot；有效期商品預設 FEFO，沒有有效期則預設 FIFO。
5. 倉務人員可改選其他合資格 Bin／Lot；偏離 FIFO 須輸入原因，偏離 FEFO 另須 `inventory.fefo.override`，兩者均須 Audit。
6. 短揀可輸入原因完成；未揀數量釋放本次 Allocation 並返回待履約，不自動取消、出貨或修改帳面庫存。
7. 不設獨立且強制的 Packing Confirm；揀貨完成後即可建立 Shipment。
8. Shipment 從 Customer Management 選擇有效 Shipping Address，預選默認地址並在出貨時保存快照；不允許臨時地址。
9. 包裹數量、承運商、Tracking Number、重量及備註均為選填。
10. 只有確認出貨才正式 Inventory Issue，扣減原 Warehouse／Bin／Lot／Status 的 On Hand、耗用 Reservation 並更新 SO Fulfilled Quantity。
11. 錯誤出貨可由具專門權限者輸入原因作整張 Shipment Reversal，按原位置及狀態回補庫存。
12. Shipment Reversal 是操作錯誤更正，不代表 Customer Return；實際退貨及退款屬後續模組。

### 0.4 版本紀錄

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 0.1 Draft | 2026-09-09 | 根據訪談建立面向中小企業、以單 SO 分批履約、精確 Bin／Lot 揀貨、出庫及整張沖銷為核心的需求。 |
| 0.2 Approved Planning Baseline | 2026-09-14 | Harness 2.0 對齊：內容原文保留，新增 §20 正式需求定義（`FR-001`～`FR-107`、`NFR-001`～`NFR-026`、`SEC-001`～`SEC-012`）及 typed traceability；未改變任何業務規則或驗收準則。 |

---

## 1. 業務目標與成功指標

### 1.1 業務目標

| 編號 | 目標 |
| --- | --- |
| OBJ-01 | 讓倉務人員從待履約 SO 快速建立清楚、可執行的 Pick List。 |
| OBJ-02 | 確保揀貨及出庫準確記錄至 Warehouse／Bin／SKU／Lot／Stock Status。 |
| OBJ-03 | 優先使用較早到期或較早入庫的合資格庫存，降低過期及庫存老化。 |
| OBJ-04 | 支援單一 SO 分批履約、短揀及 Backorder 補貨後繼續履約。 |
| OBJ-05 | 出貨時使用正確、有效且已保存的 Customer Shipping Address，並保留交易快照。 |
| OBJ-06 | 保證 Fulfillment、Shipment、SO 及 Inventory 的數量與狀態可完整對賬。 |
| OBJ-07 | 以冪等及原子操作避免重複 Allocation、重複出庫、部分成功及虛假成功。 |
| OBJ-08 | 提供簡單、受控及可追溯的 Shipment Reversal。 |
| OBJ-09 | 在每日約 10,000 張訂單及長期歷史資料下維持日常操作效率。 |

### 1.2 建議成功指標

| 編號 | 指標 | 建議目標 |
| --- | --- | --- |
| KPI-01 | Shipment 無法追溯至 SO、Fulfillment、Allocation 及 Inventory Movement 的次數 | 0 |
| KPI-02 | 同一事件重送造成重複 Allocation、Issue、SO Fulfilled 更新或 Reversal 的次數 | 0 |
| KPI-03 | 揀貨或出貨後出現負 On Hand、負 Reservation 或超過 SO 可履約量的次數 | 0 |
| KPI-04 | SO、Fulfillment、Shipment 與 Inventory 數量可對賬率 | 100% |
| KPI-05 | Expired、效期不足、Quarantined、Damaged 或錯 Warehouse 庫存被正常出貨的次數 | 0 |
| KPI-06 | 偏離 FEFO 時沒有權限，或任何偏離沒有原因及 Audit 的次數 | 0 |
| KPI-07 | Shipment 使用有效 Shipping Address 並保存正確快照的比例 | 100% |
| KPI-08 | 待履約清單、精確單號及常用查詢 | 95% 請求在 2 秒內完成 |
| KPI-09 | 最多 100 行 Shipment 的確認或 Reversal | 95% 請求在 3 秒內完成，或清楚進入可追蹤處理狀態 |
| KPI-10 | 未授權使用者確認出貨或作 Shipment Reversal 的次數 | 0 |

正式量測環境、資料分佈及口徑須由 Sales、Warehouse、Inventory、QA 及技術團隊共同記錄。

---

## 2. 範圍與 Capability Map

### 2.1 第一階段範圍內

- 待履約 SO 查詢及篩選。
- 從單一 Confirmed／Partially Fulfilled SO 手動建立 Fulfillment 工作單及 Pick List。
- 選擇 SO Lines 及本次處理數量；同一 SO 可建立多次 Fulfillment。
- 按 Inventory 合資格庫存建立 Warehouse／Bin／Lot Allocation。
- FEFO／FIFO 建議、受控例外、實際揀貨及短揀。
- Pick List 畫面及 A4 browser print。
- 由 PICKED Fulfillment 建立單一 Shipment。
- 選擇有效 Shipping Address、預選默認值及保存地址／選用聯絡人快照。
- 選填包裹數量、承運商、Tracking Number、重量及備註。
- Shipment 確認、Inventory Issue、Reservation Consume 及 SO Fulfilled 更新。
- 未出貨工作取消及已確認 Shipment 的整張 Reversal。
- Fulfillment、Shipment、Reversal、未完成工作、出貨歷史、Audit 及 CSV 匯出。
- Delivery Note／Packing List 的 browser print。
- 與父 SO 協調歸檔、至少 7 年保留、Archive 查詢及備份還原。

### 2.2 第一階段不包含

- 多張 SO 合併成一個 Fulfillment、Pick List、Shipment 或 Delivery。
- 跨 Warehouse 拆單、自動選倉、倉間調撥或重新分配。
- Wave／Batch／Zone Picking、路線優化、任務派工、工作量平衡或倉庫地圖。
- 強制 Packing Confirm、箱內 SKU 明細、Cartonization、棧板、SSCC 或容積計算。
- Carrier API、運費、電子面單、追蹤同步、車隊、司機、路線或 Proof of Delivery。
- 臨時／自由文字 Shipping Address。
- Substitute SKU、Bundle／Kit、Serial Number、Catch Weight 或非 Base UOM 出庫。
- Pick 時直接作 Inventory Adjustment、Status Transfer、Bin Move 或 Stocktake 差異。
- Customer Return、換貨、退款、重新寄送、拒收、索賠及逆向物流。
- Sales Invoice、Accounts Receivable、收入、COGS、成本及會計分錄。
- 部分 Shipment Reversal；本期只支援整張沖銷。
- 對已歸檔或已有未來下游不可逆處理的 Shipment 作一般線上 Reversal。

### 2.3 Capability Map

| Capability ID | 能力 | 單一責任 | 主要依賴 |
| --- | --- | --- | --- |
| FUL-CAP-01 | Fulfillment Queue | 顯示 SO 可履約數量並建立單 SO 工作單。 | Sales Order、Inventory Reservation |
| FUL-CAP-02 | Allocation and Picking | 依 Bin／Lot、FEFO／FIFO 分配及記錄揀貨／短揀。 | FUL-CAP-01、Inventory |
| FUL-CAP-03 | Shipment | 選擇地址、保存快照及確認出貨。 | FUL-CAP-02、Customer、Inventory |
| FUL-CAP-04 | Shipment Reversal | 回復錯誤 Shipment 的庫存及 SO 履約結果。 | FUL-CAP-03、Inventory、Sales Order |
| FUL-CAP-05 | Inquiry and Traceability | 查詢、列印、匯出、Audit、歸檔及對賬。 | FUL-CAP-01～04 |

建議實作次序：`FUL-CAP-01 → FUL-CAP-02 → FUL-CAP-03 → FUL-CAP-04 → FUL-CAP-05`。

所有能力屬於同一 Fulfillment domain 及同一端到端流程，不建立互相重複的揀貨、出貨或庫存計算服務。

### 2.4 上下游依賴及進入門檻

| 模組 | 本模組依賴／提供的邊界 |
| --- | --- |
| User Management | 提供 Active User、角色、權限及 Audit Actor；提交時重新驗證。 |
| Sales Order Management | 提供 SO、Line、Customer、Warehouse、Ordered、Reserved、Backorder、Fulfilled、狀態及快照；接受 Fulfilled／Reversed 結果。 |
| Customer Management | 提供目標 Customer 的 Active Shipping Address、默認地址及可選 Shipping Contact。 |
| Item Management | 提供 SKU ID、Code／Name、Barcode、Base UOM、Tracking Policy 及 Minimum Sale Life。 |
| Inventory Management | 提供 Reservation、合資格 Bin／Lot、FEFO／FIFO、Allocation、Issue、Release 及 Reversal 的唯一數量事實。 |
| Returns／Invoicing | 第一階段未接入；未來須提供不可逆下游事項判斷以限制 Reversal／Archive。 |

開始技術設計前，Sales Order 與 Inventory 的 Reservation、Allocation、Issue、Release、Reversal、冪等及錯誤語意須有正式契約；Customer Shipping Address 選擇及快照契約須可用。未有 Serial 流程時，本模組不得接受 Active Serial SKU。

---

## 3. 名詞與定義

| 名詞 | 定義 |
| --- | --- |
| Fulfillment | 為一張 SO 的部分或全部可履約數量建立的倉庫工作單；第一階段同時作 Pick List。 |
| Fulfillment Queue | 顯示已確認 SO 中仍有可用 Reservation、可建立新工作單的清單。 |
| Fulfillable Quantity | SO Line 當前有效 Reservation 中未被其他工作／Allocation 佔用且未出貨的數量。 |
| Pick List | 顯示本次應從哪些 Bin／Lot 揀取哪些 SKU 及數量的作業文件。 |
| Allocation | Inventory 把 Reservation 指定至具體 Lot／Bin；不扣 On Hand。 |
| Picked Quantity | 倉務人員確認已實際取出的數量；在出貨前仍未正式 Issue。 |
| Short Pick | 實際揀貨量小於計劃量；差額釋放本次 Allocation，返回未分配 Reservation。 |
| FEFO | First Expired, First Out；優先使用最早到期且符合 Minimum Sale Life 的 Lot。 |
| FIFO | First In, First Out；沒有 Expiry Date 時優先使用最早入庫的合資格庫存。 |
| Shipment | 一張 SO 的一次實際出貨；由一張已完成揀貨的 Fulfillment 產生。 |
| Shipping Address Snapshot | 出貨確認時保存的地址識別及文字，不因 Customer 主檔修改而改變。 |
| Delivery Note | 隨貨提供予客戶的 Shipment／商品數量文件；不等同 Sales Invoice。 |
| Shipment Confirmation | 貨物實際離開控制後，Issue 庫存及更新 SO Fulfilled 的動作。 |
| Shipment Reversal | 更正錯誤出貨的整張反向操作；不代表客戶退貨。 |
| Active／Archive Store | 日常操作資料區／與父 SO 協調的歷史唯讀資料區。 |

---

## 4. 業務角色、權限與責任

### 4.1 權限代碼

第一階段只新增三個 Fulfillment 業務權限：

| 權限 | 可執行能力 |
| --- | --- |
| `fulfillment.view` | 查看 Queue、Fulfillment、Shipment、Reversal、歷史、Audit 及匯出可見資料。 |
| `fulfillment.operation` | 須同時具 `fulfillment.view`；建立、分配、揀貨、短揀、取消未出貨工作、建立及確認 Shipment。 |
| `fulfillment.reverse` | 須同時具 `fulfillment.view`；輸入原因整張 Reversal 已確認 Shipment。 |

偏離 FEFO 另須 `inventory.fefo.override`；偏離 FIFO 只需 `fulfillment.operation`，但兩者均須輸入原因。任何例外都不允許使用不合資格庫存。

### 4.2 典型角色

| 角色 | 建議權限 | 主要責任 |
| --- | --- | --- |
| Fulfillment Viewer | `fulfillment.view` | 查看工作、Shipment、歷史及文件。 |
| Warehouse Operator | `fulfillment.view`＋`fulfillment.operation` | 建立工作、分配、揀貨、短揀及確認出貨。 |
| FEFO Exception Operator | Warehouse Operator＋`inventory.fefo.override` | 在有合理原因時偏離 FEFO；一般 FIFO 改選不需此權限。 |
| Fulfillment Supervisor | `fulfillment.view`＋`fulfillment.operation`＋`fulfillment.reverse` | 一般作業及 Shipment Reversal。 |
| System Operations | 系統既有運維權限 | 監察故障及歸檔；不自動取得業務資料或 Reversal。 |

### 4.3 權限原則

- 前端、後端、列印及匯出須分別授權，不得只隱藏按鈕。
- `fulfillment.operation`、`fulfillment.reverse` 及 `inventory.fefo.override` 互不包含。
- System Administrator 不因角色名稱自動取得出貨或 Reversal 能力。
- 下游角色只取得正式 Inventory Allocation／Issue 所需能力，不因此進入 Inventory 管理頁。
- 建立、分配、揀貨、短揀、取消、出貨、重試、Reversal、列印及匯出均保存 Actor。
- 已載入頁面的使用者在提交時被停用或撤權，後端須拒絕。

---

## 5. 核心業務原則

1. Fulfillment 及 Shipment Number 全系統唯一，不可修改或重用。
2. 每張 Fulfillment／Shipment 只屬於一張 SO，沿用其 Customer 及 Warehouse。
3. 一張 SO 可有多張 Fulfillment／Shipment；同一數量不得被兩張有效工作處理。
4. 只有有效 Reservation 可建立 Fulfillment；純 Backorder 須先補配。
5. Allocation 指定 Bin／Lot 但不扣 On Hand；只有出貨確認才 Issue。
6. Inventory 是庫存資格及數量的唯一事實來源。
7. 有 Expiry Date 預設 FEFO，沒有則 FIFO；穩定排序由 Inventory 提供。
8. 偏離 FIFO 須有原因及 Audit；偏離 FEFO 另須專門權限；任何偏離仍只可選合資格庫存。
9. Expired、效期不足、Quarantined、Damaged、Inactive Bin、錯 Warehouse、Counting 中或不足的庫存不可出貨。
10. 短揀不等於庫存差異、SO 取消或 Backorder；差額回待履約，差異走 Inventory 流程。
11. 出貨確認前不更新 SO Fulfilled，也不扣 Inventory On Hand。
12. Inventory Issue、Reservation Consume、Shipment／Fulfillment 狀態及 SO Fulfilled 必須收斂為一致結果。
13. 地址只可從該 Customer 的有效 Shipping Address 選擇；沒有有效地址不得出貨。
14. 地址及選用聯絡人在出貨時保存快照，主檔變更不得回寫。
15. SHIPPED Shipment 不可修改或刪除；錯誤以整張 Reversal 更正。
16. Reversal 不可代替 Customer Return。
17. 重送、逾時恢復及背景重試使用穩定 Event ID，不得產生重複效果。
18. 簡單優先；不加入 WMS 波次、承運商整合、複雜包裝或配送優化。

---

## 6. 概念資料模型

### 6.1 關係概覽

```text
Sales Order 1 ──< Fulfillment 1 ──< Shipment
                    │                  │
                    ├──< Fulfillment Line
                    │       └──< Pick Allocation >── Inventory Allocation
                    └──< Fulfillment Status History

Shipment 1 ── 0..1 Shipment Reversal
Shipment ──< Shipment Line ──< Shipment Issue Reference
Shipment ── Shipping Address / Contact Snapshot
Business Document ──< Audit Event
```

一張 Fulfillment 在其生命周期可留下多張已取消 Shipment 記錄，但同一時間最多一張非 `CANCELLED` Shipment；只有一張 Shipment 可成功出貨。

### 6.2 Fulfillment Header

- Fulfillment ID／Number、Source SO ID／Number、Customer 及 Warehouse reference／snapshot。
- Status、version、建立／開始揀貨／完成揀貨／取消的 Actor、Time 及 Reason。
- Planned、Allocated、Picked、Short、Shipped 及 Reversed 摘要。
- Stable Event／Correlation ID 及最後業務更新時間。

### 6.3 Fulfillment Line

- Fulfillment、SO Line、Line Number 及 SKU／UOM snapshot。
- SO Ordered、Reserved、Backorder、Fulfilled 的建立時參考值。
- Planned、Allocated、Picked、Short、Shipped 及 Reversed Quantity。
- 一張 SO Line 可分多次 Fulfillment；累計不得超過 Fulfillable Quantity。

### 6.4 Pick Allocation

- Fulfillment Line、Inventory Reservation／Allocation Reference。
- Warehouse、Bin、SKU、Lot／Expiry、Stock Status 及 Base UOM。
- Suggested Rank／Strategy、Planned／Picked Quantity。
- 例外標記、系統建議與實選摘要、Override Actor／Reason／Time。
- Inventory 是正式 Allocation 真相；本模組只保存不可獨立修改的投影及連結。

### 6.5 Shipment Header

- Shipment ID／Number、Fulfillment、SO、Customer。
- Shipping Address ID／Version／Snapshot；選填 Contact ID／Snapshot。
- Status、Shipment Date／Confirmed At／By。
- 選填 Carrier、Tracking Number、Package Count、Total Weight、Weight UOM、Notes。
- Inventory Issue Event／Correlation ID、Reversal Reference 及最後業務更新時間。

### 6.6 Shipment Line 及 Issue Reference

- Shipment、Fulfillment Line、SO Line、SKU／UOM snapshot 及 Shipped Quantity。
- 每個 Issue 的 Warehouse、Bin、Lot／Expiry、Status、Base Quantity、Reservation／Allocation／Movement Reference。
- 多個 Bin／Lot 可組成同一 Shipment Line，總數等於 Shipped Quantity。

### 6.7 Shipment Reversal

- Reversal ID／Number、原 Shipment、Reason、Actor、Time、Event／Correlation ID 及結果。
- 原 Issue 每個 Warehouse／Bin／Lot／Status／Quantity 與反向 Movement Reference。
- Reversal 前後 SO Fulfilled、Reservation 及 Shipment 狀態摘要。
- 一張 Shipment 最多一個成功 Reversal；失敗嘗試不可偽裝成功。

### 6.8 Status History、Audit 及 Archive

- 狀態轉換保存 from、to、actor、time、reason、event 及 outcome。
- Audit 不保存 Customer 銀行資料、平台 Token、密碼或不必要完整 payload。
- Active／Archive 保留 Header、Lines、Allocation／Issue references、快照、History、Reversal 及 Audit。

---

## 7. 狀態與核心流程

### 7.1 Fulfillment 狀態

| 狀態 | 說明 | 允許主要操作 |
| --- | --- | --- |
| `DRAFT` | 已由 SO 建立，尚未鎖定揀貨分配。 | 修改數量、建立 Allocation、取消 |
| `PICKING` | 已建立 Allocation，正在揀貨。 | 列印、記錄揀貨、短揀、重新分配、取消 |
| `PICKED` | 實際揀貨已確認。 | 建立 Shipment；未有 Shipment 時取消 |
| `SHIPPED` | Shipment 已確認，庫存已 Issue。 | 查看、列印、依權限 Reversal |
| `CANCELLED` | 未出貨工作已取消，Allocation 已釋放。 | 查看 |
| `REVERSED` | 所屬 Shipment 已成功 Reversal。 | 查看 |

正常路徑為 `DRAFT → PICKING → PICKED → SHIPPED`。未出貨狀態可依規則轉 `CANCELLED`；`SHIPPED → REVERSED` 只由成功 Reversal 觸發。

### 7.2 Shipment 狀態

| 狀態 | 說明 | 允許主要操作 |
| --- | --- | --- |
| `DRAFT` | 已由 PICKED Fulfillment 建立。 | 修改物流資料、列印預覽、取消、確認 |
| `SHIPPING` | 確認已開始，最終跨模組結果未確定。 | 查原事件進度；不可修改或再次確認 |
| `SHIPPED` | Issue、Reservation Consume 及 SO Fulfilled 已成功。 | 查看、列印、依權限 Reversal |
| `CANCELLED` | 未出貨 Shipment 已取消。 | 查看；Fulfillment 返回 PICKED |
| `REVERSING` | Reversal 已開始，結果未確定。 | 查原事件；不可再次提交 |
| `REVERSED` | 整張 Shipment 已成功回復。 | 查看 |

`SHIPPING`／`REVERSING` 是可恢復狀態，不代表成功；畫面須顯示目前事實、Correlation ID 及安全下一步。

### 7.3 正常履約及出貨流程

1. 有未分配 Reservation 的 Confirmed／Partially Fulfilled SO 出現在 Queue。
2. 倉務人員選一張 SO、Lines 及本次 Quantity 建立 DRAFT Fulfillment。
3. 系統取得合資格 Bin／Lot 及 FEFO／FIFO 建議，建立 Allocation 後進入 PICKING。
4. 倉務人員依 Pick List 輸入實際數量；不足時填 Short Pick Reason。
5. 系統確認已揀數量並釋放短揀差額 Allocation；Fulfillment 進入 PICKED。
6. 使用者建立 DRAFT Shipment、選有效 Shipping Address 並視需要輸入物流資料。
7. 貨物實際離開控制時確認 Shipment。
8. 系統重新驗證 SO、地址、Allocation、Bin、Lot、Expiry、Status、Reservation、Quantity、version 及權限。
9. 系統以單一可恢復結果完成 Inventory Issue／Reservation Consume、Shipment／Fulfillment SHIPPED 及 SO Fulfilled 更新。
10. SO 尚有數量時保留未完成狀態；全部完成時由 Sales 規則轉 COMPLETED。

### 7.4 短揀流程

1. 實際 Picked 可小於 Planned，但不可為負或超過 Allocation。
2. 每個短揀行必須輸入原因。
3. 已揀數量保留供本次 Shipment；差額釋放 Allocation、保持 Reservation，返回 Queue。
4. 系統不因此直接修改 On Hand、建立 Adjustment、取消 SO 或改成 Backorder。
5. 現場與帳面不符時另走 Inventory Adjustment／Stocktake。

### 7.5 Shipment Reversal 流程

1. 具 `fulfillment.reverse` 者在 SHIPPED Shipment 輸入原因，並確認貨物仍在公司控制及已放回原 Bin／Lot 後提交整張 Reversal。
2. 系統重驗 Shipment 未沖銷、父 SO 未歸檔、原 Issue 可反向，且無已接入不可逆下游事項。
3. Inventory 按原 Warehouse／Bin／Lot／Expiry／Status／Quantity 執行 Reversal。
4. 成功時回補 On Hand、撤銷 Reservation Consume 並恢復 Reservation；原 Allocation 不自動重開。
5. Shipment／Fulfillment 轉 REVERSED，SO Fulfilled 減少，恢復數量重新可履約。
6. 任一步失敗不得部分回補或先改狀態；顯示事實、Correlation ID 及重試方法。
7. 客戶實際退貨不得使用 Reversal。

### 7.6 取消流程

- DRAFT Fulfillment 可取消，沒有 Inventory 數量效果。
- PICKING 取消須有原因並先成功釋放所有 Allocation。
- PICKED 在沒有有效 Shipment 時可取消並釋放 Allocation。
- DRAFT Shipment 可取消；Fulfillment 返回 PICKED，已揀資料及 Allocation 保留。
- SHIPPED 不可取消，只可依 Reversal 規則處理。
- 所有取消具冪等性，重送不得重複釋放。

---

## 8. 功能需求

優先級採 MoSCoW：`Must` 是第一階段必要；`Should` 有明確價值但不阻擋最小流程；不以 `Could` 預先加入未確認功能。

### 8.1 Fulfillment Queue 及工作單

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-QUEUE-001 | Must | `fulfillment.view` 可查看有未分配有效 Reservation 的 Confirmed／Partially Fulfilled SO。 |
| FR-QUEUE-002 | Must | Queue 顯示 SO Number、Customer、Warehouse、Order／Requested Delivery Date、Status、Reserved／Backorder／Fulfilled／Fulfillable 摘要及更新時間。 |
| FR-QUEUE-003 | Must | 可按 SO Number、Customer、Warehouse、Requested Delivery Date、SO Status、Has Backorder 及進行中工作篩選。 |
| FR-QUEUE-004 | Must | 只接受 Fulfillable Quantity 大於 0；純 Backorder、Cancelled、Closed、Completed 或 CONFIRMING SO 不可建立工作。 |
| FR-QUEUE-005 | Must | `fulfillment.operation` 可從一張 SO 選 Lines 及本次正數 Quantity 建立 DRAFT Fulfillment。 |
| FR-QUEUE-006 | Must | Quantity 不得超過當前未分配 Reservation；提交重驗 version 及並發佔用。 |
| FR-QUEUE-007 | Must | 一張 Fulfillment 只引用一張 SO 及其 Warehouse，不可加入其他 SO／Customer／Warehouse Line。 |
| FR-QUEUE-008 | Must | 首次成功保存分配唯一不可重用 Fulfillment Number。 |
| FR-QUEUE-009 | Must | 相同建立事件重送不得產生第二張 Fulfillment 或重複佔量。 |
| FR-QUEUE-010 | Must | SO 狀態、Reservation 或 Fulfillable Quantity 改變時拒絕過時提交並要求重新載入。 |
| FR-QUEUE-011 | Should | SO Detail 與 Fulfillment／Queue 可雙向前往。 |
| FR-QUEUE-012 | Must | 建立工作不得改變 SO Ordered／Fulfilled／Backorder 或 Inventory On Hand。 |

### 8.2 Allocation、FEFO／FIFO 及 Pick List

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-PICK-001 | Must | DRAFT Fulfillment 可取得 Inventory 合資格 Bin／Lot 候選及建議量。 |
| FR-PICK-002 | Must | 有 Expiry 候選按最早合資格 Expiry、Lot、First Receipt、Bin 排序；無 Expiry 按 First Receipt、Lot、Bin 排序。 |
| FR-PICK-003 | Must | 一行可分配至同 Warehouse 多個 Bin／Lot，總量不超 Planned 或 Reservation。 |
| FR-PICK-004 | Must | Expired、效期不足、Quarantined、Damaged、Inactive、Counting、錯 Warehouse 或不足庫存不可分配。 |
| FR-PICK-005 | Must | 偏離 FIFO 時 `fulfillment.operation` 使用者須填原因；偏離 FEFO 時另須 `inventory.fefo.override`；所選庫存仍須合資格。 |
| FR-PICK-006 | Must | 所有 Allocation 成功後才轉 PICKING；任一失敗不得保留部分結果。 |
| FR-PICK-007 | Must | Allocation 不扣 On Hand，不改 SO Fulfilled。 |
| FR-PICK-008 | Must | Pick List 顯示 Fulfillment／SO、Customer、Warehouse、SKU、Planned、Bin、Lot、Expiry、順序及 notes。 |
| FR-PICK-009 | Must | Pick List 按 Bin、Lot、SKU 穩定排序並提供 A4 browser print。 |
| FR-PICK-010 | Must | 主檔變更不得改寫已完成揀貨及出貨快照。 |
| FR-PICK-011 | Must | 確認揀貨前可重新分配；安全釋放舊 Allocation 後才建立新 Allocation。 |
| FR-PICK-012 | Must | 重新分配及例外保存原建議、實選、Actor、Reason、Time 及 Inventory Reference。 |

### 8.3 揀貨確認及短揀

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-PICKCONF-001 | Must | PICKING 可按 Allocation 輸入 Base UOM 實際 Picked Quantity；可為 0，不可為負或超過 Allocated。 |
| FR-PICKCONF-002 | Must | 至少一行 Picked > 0 才可完成揀貨；全數為 0 應取消工作。 |
| FR-PICKCONF-003 | Must | Picked < Allocated 時該行必須輸入 Short Pick Reason。 |
| FR-PICKCONF-004 | Must | 短揀差額釋放本次 Allocation，保留未消耗 Reservation 並返回 Fulfillable Quantity。 |
| FR-PICKCONF-005 | Must | 確認揀貨不得扣 On Hand、耗用 Reservation、增加 SO Fulfilled 或建立 Shipment。 |
| FR-PICKCONF-006 | Must | 全部 Picked／Short 及 Release 成功後才轉 PICKED；任一失敗全部不生效。 |
| FR-PICKCONF-007 | Must | PICKED 後結果不可直接修改；未有 Shipment 時取消並重建。 |
| FR-PICKCONF-008 | Must | 確認具冪等性；重複或逾時重試不得重複 Release 或累加 Picked。 |
| FR-PICKCONF-009 | Must | 保存 Picker、Picked At、逐行結果、Short Reason、Event ID 及 Correlation ID。 |
| FR-PICKCONF-010 | Should | 可由短揀結果返回 SO／Queue 查看差額。 |

### 8.4 Shipment Draft 及地址

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-SHIP-001 | Must | `fulfillment.operation` 可由 PICKED Fulfillment 建立 DRAFT Shipment。 |
| FR-SHIP-002 | Must | 一張 Fulfillment 最多一張非 CANCELLED Shipment；重複建立返回既有記錄。 |
| FR-SHIP-003 | Must | Shipment 只含該 Fulfillment 的 Picked Quantity、原 SO、Customer 及 Warehouse。 |
| FR-SHIP-004 | Must | 查詢該 Customer 的 Active Shipping Address；有默認值時預選，可改選其他有效地址。 |
| FR-SHIP-005 | Must | 不提供自由文字地址；沒有有效地址可保留揀貨，但不可確認出貨，並提供 Customer 維護入口。 |
| FR-SHIP-006 | Must | 可選有效 Shipping Contact並預選默認值；Contact 不是出貨必填。 |
| FR-SHIP-007 | Must | 提交時重驗 Address／Contact 所有權、Active 及用途；不得靜默改選。 |
| FR-SHIP-008 | Must | Carrier、Tracking Number、Package Count、Total Weight、Weight UOM、Notes 選填。 |
| FR-SHIP-009 | Must | Package Count 如輸入須為正整數；Weight 如輸入須 > 0 且有 Weight UOM。 |
| FR-SHIP-010 | Must | 缺少選填物流資料不得阻止出貨。 |
| FR-SHIP-011 | Must | 首次成功保存分配唯一不可重用 Shipment Number。 |
| FR-SHIP-012 | Must | Draft 可改地址、Contact 及物流資料，不可改 SKU、Bin、Lot 或 Picked Quantity。 |

### 8.5 Shipment 確認及 Inventory Issue

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-CONF-001 | Must | 只有完整、有效的 DRAFT Shipment 可確認；所屬 Fulfillment 必須仍為 PICKED。 |
| FR-CONF-002 | Must | 確認時重驗父 SO 未取消／關閉／歸檔、Customer 關係、Warehouse、Address、Contact（如有）、SKU 及權限。 |
| FR-CONF-003 | Must | 確認時重驗每個 Allocation、Reservation、Bin、Lot、Expiry、Stock Status、Quantity 及 version。 |
| FR-CONF-004 | Must | Address 在頁面載入後被停用、移除 Shipping 用途、改屬其他 Customer 或版本改變時，須拒絕並要求重新選擇。 |
| FR-CONF-005 | Must | Allocation 在頁面載入後失效時，不得靜默改選另一 Bin／Lot；須拒絕並返回重新分配流程。 |
| FR-CONF-006 | Must | 確認開始後 Shipment 進入 SHIPPING；結果未明時不得顯示 SHIPPED、接受修改或另一個確認。 |
| FR-CONF-007 | Must | 確認使用穩定 Event／Idempotency ID；重複點擊或重送不得重複 Issue、Consume Reservation 或增加 SO Fulfilled。 |
| FR-CONF-008 | Must | 一次確認須以可恢復一致結果完成 Inventory Issue、Reservation Consume、Shipment SHIPPED、Fulfillment SHIPPED 及 SO Fulfilled 更新。 |
| FR-CONF-009 | Must | 任一 Shipment Line／Allocation 失敗時不得留下部分 Shipment、部分 Inventory Issue 或部分 SO Fulfilled。 |
| FR-CONF-010 | Must | Issue 只可扣減原 Allocation 指定的 Warehouse／Bin／Lot／Status，不可由 Fulfillment 自行改寫 Inventory Balance。 |
| FR-CONF-011 | Must | Shipped Quantity 須等於 Fulfillment Picked Quantity，亦須等於其全部成功 Issue 明細之和。 |
| FR-CONF-012 | Must | 成功時保存 Address／Contact／Customer／SKU／UOM／Warehouse／Bin／Lot／Expiry／Status 快照及 Confirmed By／At。 |
| FR-CONF-013 | Must | 成功後父 SO 的 Fulfilled Quantity 按相同數量增加；不得改變 Ordered Quantity，未完成量仍可完整解釋。 |
| FR-CONF-014 | Must | SO 全部有效數量已 Fulfilled 時，由 Sales Order 規則轉為 COMPLETED；部分完成保持 Partially Fulfilled。 |
| FR-CONF-015 | Must | Inventory 暫時不可用或 commit 結果不明時保留 SHIPPING 及 Correlation ID，由原事件查詢或續跑，不建立第二份結果。 |
| FR-CONF-016 | Must | 永久業務驗證失敗時 Shipment 回到可修正的 DRAFT 或明確失敗結果；不得保留任何 Inventory／SO 成功效果。 |

### 8.6 取消及 Shipment Reversal

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-LIFE-001 | Must | DRAFT Fulfillment 可取消；PICKING／PICKED 取消必須輸入原因。 |
| FR-LIFE-002 | Must | PICKING／PICKED 如已有實際揀貨，使用者須先確認貨物已放回原 Bin／Lot 並輸入原因；成功釋放所有未消耗 Allocation 後才可顯示 CANCELLED。 |
| FR-LIFE-003 | Must | 有非 CANCELLED Shipment 的 Fulfillment 不可取消；須先處理 DRAFT Shipment。 |
| FR-LIFE-004 | Must | DRAFT Shipment 可取消，沒有 Inventory Issue 或 SO Fulfilled 效果；Fulfillment 返回 PICKED。 |
| FR-LIFE-005 | Must | SHIPPED Shipment 不可修改、刪除或一般取消。 |
| FR-REV-001 | Must | 只有具 `fulfillment.reverse` 的使用者可對 SHIPPED Shipment 建立整張 Reversal，且 Reason 必填。 |
| FR-REV-002 | Must | 第一階段不接受部分行或部分數量 Reversal；需要更正時整張沖銷後重新履約。 |
| FR-REV-003 | Must | Reversal 前須確認貨物仍在公司控制並已放回原 Bin／Lot，並重驗 Shipment 未沖銷、父 SO／資料未歸檔、原 Issue 可反向及沒有已接入不可逆下游事項。 |
| FR-REV-004 | Must | Reversal 進入 REVERSING；結果未明時不得顯示 REVERSED 或接受第二個 Reversal。 |
| FR-REV-005 | Must | 成功 Reversal 須按原 Warehouse／Bin／Lot／Expiry／Status／Quantity 反向 Inventory Issue，不能讓使用者選另一位置。 |
| FR-REV-006 | Must | 成功時恢復原消耗 Reservation、減少 SO Fulfilled、Shipment／Fulfillment 轉 REVERSED；原 Allocation 不自動重開。 |
| FR-REV-007 | Must | Reversal 後恢復數量回到 Fulfillment Queue，須建立新 Fulfillment 才可再次出貨。 |
| FR-REV-008 | Must | Inventory 回補、Reservation 恢復、SO 更新及狀態變化任一失敗時全部不得部分生效。 |
| FR-REV-009 | Must | Reversal 具冪等性；同一事件重送返回既有結果，不重複回補或重複減少 SO Fulfilled。 |
| FR-REV-010 | Must | 同一 Event ID 配不同 Shipment、Reason 或 payload 時須拒絕衝突。 |
| FR-REV-011 | Must | Reversal 保存原 Shipment、Reason、Actor、Time、Event／Correlation、反向 Movement 及前後數量。 |
| FR-REV-012 | Must | 畫面須明確說明 Reversal 只更正錯誤操作；實際 Customer Return 不可由此處理。 |

### 8.7 查詢、文件、匯出及 Audit

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-INQ-001 | Must | 提供 My Recent Work、Fulfillment Queue、Active Fulfillments、Shipments、Exceptions 及 Finalized 常用視圖。 |
| FR-INQ-002 | Must | Fulfillment 可按 Number、SO、Customer、Warehouse、Status、建立／揀貨日期及 Has Short Pick 篩選。 |
| FR-INQ-003 | Must | Shipment 可按 Number、SO、Customer、Warehouse、Status、Shipment Date、Carrier 及 Tracking Number 篩選。 |
| FR-INQ-004 | Must | 精確 Fulfillment／Shipment／SO／Tracking Number 查詢須直接定位，無須掃描全部歷史。 |
| FR-INQ-005 | Must | Fulfillment 詳情顯示 SO、Lines、Planned／Allocated／Picked／Short／Shipped、Bin／Lot、History 及允許操作。 |
| FR-INQ-006 | Must | Shipment 詳情顯示 SO、Fulfillment、地址／Contact 快照、物流資料、Shipped／Reversed、Issue References、History 及允許操作。 |
| FR-INQ-007 | Must | 可由 SO、Fulfillment、Shipment、Inventory Movement 及 Reversal 互相追溯；無權頁面須安全拒絕。 |
| FR-DOC-001 | Must | PICKING Fulfillment 可產生 A4 browser print Pick List；資料須與當前 Allocation 一致。 |
| FR-DOC-002 | Must | SHIPPED Shipment 可產生 A4 browser print Delivery Note／Packing List，至少顯示 Shipment、SO、Customer、Address Snapshot、SKU、Quantity 及選填物流資料。 |
| FR-DOC-003 | Must | Delivery Note／Packing List 不顯示 Unit Selling Price、Tax、成本、Customer 銀行資料或內部技術錯誤。 |
| FR-DOC-004 | Must | REVERSED Shipment 文件及詳情須清楚加上 REVERSED，不可作有效出貨文件使用。 |
| FR-EXPORT-001 | Must | 列表匯出套用相同權限及篩選，只輸出使用者可見資料。 |
| FR-EXPORT-002 | Must | 匯出至少包括單號、SO、Customer、Warehouse、Status、日期、SKU／數量摘要、Short Pick、Carrier 及 Tracking。 |
| FR-EXPORT-003 | Must | 大型匯出使用背景工作並提供狀態及有限期下載，不得阻塞日常交易。 |
| FR-EXPORT-004 | Must | 匯出採 UTF-8 及已公布格式；公式型文字須防 spreadsheet formula injection。 |
| FR-AUDIT-001 | Must | 建立、修改、分配、重新分配、偏離建議、揀貨、短揀、取消、出貨、重試、Reversal、列印、匯出及歸檔均須 Audit。 |
| FR-AUDIT-002 | Must | 業務 History 對 `fulfillment.view` 可見；安全技術細節只供獲授權運維人員。 |
| FR-AUDIT-003 | Must | Audit、已確認快照及已過帳 Issue／Reversal Reference 不可由一般使用者修改或刪除。 |

### 8.8 歸檔及保留

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-ARC-001 | Must | Fulfillment／Shipment 不另設獨立業務歸檔年期；與父 SO 使用相同 24 個月及至少 7 年保留政策。 |
| FR-ARC-002 | Must | 只有父 SO 符合歸檔條件，且所有相關 Fulfillment／Shipment 已為 CANCELLED、SHIPPED 或 REVERSED 等最終狀態，才可一併歸檔。 |
| FR-ARC-003 | Must | PICKING、PICKED、SHIPPING、REVERSING、未完成 Allocation 或結果不明事件均阻止父 SO 歸檔。 |
| FR-ARC-004 | Must | Fulfillment／Shipment Headers、Lines、Allocation／Issue references、Address／Contact snapshots、History、Reversal 及必要 Audit 須一併歸檔。 |
| FR-ARC-005 | Must | 先完成 Archive 寫入及完整性校驗，才可從 Active 移除；不得留下父 SO 已歸檔但 Shipment 遺失或反之。 |
| FR-ARC-006 | Must | Archive 資料唯讀，不可修改、取消、出貨或 Reversal；更正須走另行批准的正式流程。 |
| FR-ARC-007 | Must | 可按 Fulfillment／Shipment／SO Number、Customer、Tracking、Warehouse、Status 及最多 366 日範圍查詢 Archive。 |
| FR-ARC-008 | Must | 歸檔後各單號及來源連結須路由至唯一 Active 或 Archive 記錄，不得重複或假裝遺失。 |
| FR-ARC-009 | Must | 歸檔中斷或重跑不得重複資料；校驗失敗時 Active 原資料完整保留並有錯誤。 |
| FR-ARC-010 | Must | Archive 暫時不可用不得阻止 Queue、揀貨、出貨及 Active 查詢；Archive 頁顯示不可用而非零結果。 |

---

## 9. 業務規則

### 9.1 文件及數量規則

| 編號 | 規則 |
| --- | --- |
| BR-001 | Fulfillment Number、Shipment Number 及 Reversal Number 全系統唯一且不可重用。 |
| BR-002 | 一張 Fulfillment／Shipment 只屬於一張 SO、一個 Customer 及一個 Warehouse。 |
| BR-003 | 一張 Fulfillment 最少一個有效 Line，最多沿用父 SO 的 100 個 Lines。 |
| BR-004 | 第一階段所有計劃、分配、出貨及沖銷數量以 SKU Base UOM 正整數處理；單個 Allocation 的實際 Picked 可為 0，但整張完成揀貨至少一行大於 0。 |
| BR-005 | Planned ≤ 建立時 Fulfillable；Allocated ≤ Planned；Picked ≤ Allocated；Shipped = Picked；Reversed 為 0 或整張 Shipped。 |
| BR-006 | 同一 SO Line 的所有有效 Fulfillment Planned Quantity 不得重疊或超過當前有效 Reservation。 |
| BR-007 | Fulfillment 不處理 Backorder；Backorder 先按 Sales／Inventory 規則轉成 Reservation。 |
| BR-008 | 短揀只釋放 Allocation，不釋放原 Reservation。 |
| BR-009 | Allocation 不改 On Hand；Issue 才同時減 On Hand 及消耗 Reservation。 |
| BR-010 | Reversal 回補原 On Hand bucket、恢復 Reservation 並減少 SO Fulfilled，不改 SO Ordered。 |
| BR-011 | 任一時點的 SO、Reservation、Allocation、Fulfillment、Shipment 及 Reversal 數量須可完整解釋。 |

### 9.2 主檔、Bin／Lot 及地址規則

| 編號 | 規則 |
| --- | --- |
| BR-012 | 永久關聯使用不可重用 ID；Code、Name、Barcode、Address Text 或 Tracking Number 不作永久外鍵。 |
| BR-013 | Fulfillment 沿用父 SO Warehouse，不可改選其他 Warehouse。 |
| BR-014 | 有 Expiry Date 按 FEFO，無 Expiry Date 按 FIFO；相同順序使用穩定 Lot／Bin tie-breaker。 |
| BR-015 | 偏離 FIFO 須原因；偏離 FEFO 另須 `inventory.fefo.override`；不合資格庫存在任何權限下仍不可分配或出貨。 |
| BR-016 | 同一 SKU／Lot 可從多個 Bin 分配；不得假設一個 Lot 只有一個位置。 |
| BR-017 | Shipping Address 必須屬於父 SO Customer、Active 且具 Shipping 用途。 |
| BR-018 | 如有有效默認 Shipping Address 預選，但可選其他有效地址。 |
| BR-019 | 沒有地址不阻止揀貨，但阻止出貨確認；不建立臨時地址。 |
| BR-020 | 地址／Contact 在出貨提交時重驗並保存快照；主檔日後變更不回寫。 |
| BR-021 | Shipment 不讀取或保存 Customer 銀行帳戶。 |

### 9.3 狀態、並發及冪等規則

| 編號 | 規則 |
| --- | --- |
| BR-022 | 只有第 7 節列出的狀態轉換有效；前端不可自報任意狀態。 |
| BR-023 | 同一 Fulfillment 同時只可有一個狀態變更；過時 version 必須拒絕。 |
| BR-024 | SHIPPING／REVERSING 的新意圖不可用另一 Event ID 繞過；先查原事件結果。 |
| BR-025 | 相同 Event ID＋相同意圖返回原結果；相同 ID＋不同 payload 返回衝突。 |
| BR-026 | 跨模組操作不得以「先成功改本地狀態、稍後希望補庫存」方式製造假成功。 |
| BR-027 | Fulfillment、Sales 及 Inventory 任一資料在提交前改變時，以提交點 fresh validation 為準。 |
| BR-028 | 已出貨文件不直接更新；更正使用 Reversal 並保留原值。 |
| BR-029 | DRAFT Shipment 取消不取消 PICKED Fulfillment；可重新建立另一張 Shipment。 |
| BR-030 | Reversal 後不能重新使用原 Shipment 或 Allocation，須建立新 Fulfillment／Shipment。 |

### 9.4 文件、歸檔及保留規則

| 編號 | 規則 |
| --- | --- |
| BR-031 | Pick List 是內部作業文件；Delivery Note／Packing List 是出貨文件，兩者不是 Invoice。 |
| BR-032 | REVERSED 文件在畫面、列印及匯出均清楚標示，不可隱藏狀態。 |
| BR-033 | 技術性讀取、列印及匯出不得改變最後業務更新時間或歸檔資格。 |
| BR-034 | Fulfillment／Shipment 與父 SO 作 aggregate-level 歸檔，不能獨立造成跨區不一致。 |
| BR-035 | Archive 至少保留 7 年；第一階段沒有一般使用者永久刪除功能。 |
| BR-036 | Active 及 Archive 查詢分開，不在每個日常列表自動 union 全部歷史。 |

---

## 10. 頁面與使用者體驗

### 10.1 頁面清單

| 頁面 | 主要用途 | 權限 |
| --- | --- | --- |
| Fulfillment Queue | 找出可履約 SO、選 Lines／Quantity 建立工作。 | `fulfillment.view`；建立須 `fulfillment.operation` |
| Fulfillment List／Detail | 查詢狀態、Allocation、Picked／Short、History 及操作。 | `fulfillment.view` |
| Pick Allocation／Confirmation | 建議與選擇 Bin／Lot、列印、確認揀貨／短揀。 | `fulfillment.operation`；只有偏離 FEFO 另須 `inventory.fefo.override` |
| Shipment Create／Detail | 選地址、物流資料、確認出貨及文件。 | 查看須 `fulfillment.view`；寫入須 `fulfillment.operation` |
| Shipment Reversal | 顯示完整影響並提交整張沖銷。 | `fulfillment.reverse` |
| Fulfillment／Shipment Archive | 唯讀查詢及匯出歷史。 | `fulfillment.view` |

### 10.2 Queue 及揀貨體驗

- Queue 預設按 Requested Delivery Date、SO Date、SO Number 穩定排序；不實作自動優先級引擎。
- Warehouse filter 明確且保持於 URL，倉務人員不會誤看另一 Warehouse 工作。
- 建立工作時顯示 Ordered、Reserved、Backorder、Fulfilled、Already Planned 及本次可選 Quantity。
- Allocation 畫面預設帶入建議 Bin／Lot，顯示 Expiry、剩餘日數、可分配量及順序。
- 偏離建議時清楚比較建議與實選並要求原因；偏離 FEFO 時另行驗證例外權限。
- Pick List 以 Bin／Lot 為主要視覺線索；長 SKU／Lot／Bin 安全截斷並可查看完整文字。
- Short Pick 錯誤精確定位至 Line／Allocation，並顯示差額將返回待履約。

### 10.3 Shipment 體驗

- 地址選項顯示 Address Name、收件公司／部門、主要地址行、城市及地區，不只顯示 ID。
- 沒有有效地址時顯示清楚阻擋及 Customer Management 入口，不提供自由文字替代。
- 確認出貨前顯示 SO、Customer、Address、Warehouse、SKU、Bin／Lot、Quantity 及不可逆庫存影響摘要。
- Carrier、Tracking、Package、Weight 沒有值時不顯示錯誤；有值時即時驗證格式及配對欄位。
- 確認或 Reversal 逾時時顯示 Processing／Unknown Outcome、Correlation ID 及「查詢原結果」動作，不鼓勵建立新操作。
- SHIPPED／REVERSED 狀態不能只用顏色表示。

### 10.4 響應式、可及性及共用設計

- UI／UX 必須按照 `docs/frontend-design.md` 實現。
- 支援專案正式瀏覽器及 375、768、1024、1440 px 主要 viewport。
- 核心表單、table filters、dialog、地址選擇、揀貨及出貨可用鍵盤完成。
- Focus 可見，label、help、錯誤及狀態可由輔助技術辨識；錯誤後 focus 移至摘要或第一個錯誤欄位。
- Loading、empty、error、success、conflict 及 dependency unavailable 均有清楚狀態及下一步。

---

## 11. 權限、安全及資料保護

| 編號 | 要求 |
| --- | --- |
| SEC-001 | 所有頁面及 API 預設拒絕未登入使用者。 |
| SEC-002 | `fulfillment.view` 只允許查閱及獲准匯出，不可建立、揀貨、出貨或 Reversal。 |
| SEC-003 | `fulfillment.operation` 不包含 Reversal 或 FEFO 例外；偏離 FIFO 可由具該權限的使用者在填寫原因後執行。 |
| SEC-004 | `fulfillment.reverse` 不包含一般操作；組合能力須明確授權。 |
| SEC-005 | 後端防止水平及垂直越權；替換 SO、Fulfillment、Line、Shipment、Address、Allocation、Movement 或 Reversal ID 不得跨 aggregate／Customer／Warehouse。 |
| SEC-006 | 提交時重驗使用者 Active 狀態及權限；撤權後的舊頁面不得成功。 |
| SEC-007 | 所有文字、sort、filter、identifier 及數值經 allowlist／schema 驗證及 parameterized access。 |
| SEC-008 | Notes、Reason、Carrier、Tracking、Address／Contact text 及 CSV 視為不可信資料，不得執行 script、HTML 或 spreadsheet formula。 |
| SEC-009 | 一般錯誤不洩漏 SQL、stack、內部路徑、其他 Customer／Warehouse 資料或記錄存在性。 |
| SEC-010 | Log／Audit 不保存密碼、Token、Customer 銀行資料或不必要地址完整 payload；地址快照只保存履約必要內容。 |
| SEC-011 | 列印及下載使用 no-store／private 等效保護、安全 filename 及內容類型。 |
| SEC-012 | Reversal、FEFO／FIFO 例外、取消、出貨及大量匯出須記錄 Actor、Reason／Filter、Time、Correlation 及 Result。 |

---

## 12. 模組整合需求

### 12.1 Sales Order Management

- 只接受 Confirmed／Partially Fulfilled 且有有效 Reservation 的 SO 數量。
- Queue 讀取 Sales 正式 Ordered、Reserved、Backorder、Fulfilled、Cancelled／Released 投影，不另行推算另一套真相。
- 建立／取消 Fulfillment、確認 Shipment 及 Reversal 均使用穩定 source／event reference。
- Shipment 成功後才增加 SO Fulfilled；Reversal 成功後才減少。
- 已有 PICKING／PICKED／SHIPPING／REVERSING 工作屬 Open Downstream Matter，須阻止 Sales 不安全撤回、取消、關閉或歸檔。
- Sales Order 狀態改變或 Reservation 被釋放時，未開始工作可拒絕／取消；已進行工作須由明確恢復流程處理，不可靜默刪除。

### 12.2 Inventory Management

- Inventory 提供按 Reservation 的合資格 Bin／Lot 候選、FEFO／FIFO 排序及 Allocation。
- Fulfillment 不可直接更新 Balance、Reservation、Lot、Bin、Status 或 Movement。
- Allocation 建立、Release、Issue 及 Reversal 皆須整批、冪等及附 Source Document／Line／Event／Correlation。
- Issue 提交時 Inventory 重驗 Allocation、Lot、Expiry、Minimum Sale Life、Bin、Status、Stocktake lock、Quantity 及 Reservation version。
- Shipment Reversal 使用原 Issue reference，按原 bucket 反向；不能由使用者指定替代位置。
- Inventory 的成功結果是庫存事實；本模組投影須可對賬但不可獨立修改。

### 12.3 Customer Management

- Shipment 以父 SO Customer ID 查詢 Active、Shipping-purpose Address，預選唯一有效默認值。
- 可選其他有效 Shipping Address，不可輸入未保存地址。
- 可選 Active Shipping Contact；沒有 Contact 不阻止出貨。
- 提交時重驗 Address／Contact 所有權、狀態、用途及 version；不符合時拒絕且不自動替代。
- 成功出貨保存 Address／Contact snapshot；主檔日後修改、停用或刪除限制不得破壞歷史。

### 12.4 Item Management

- 顯示正式 SKU ID、Code、Name、Barcode、Base UOM、Tracking Policy 及 Minimum Sale Life。
- 已開始履約後 SKU Code／Name 變更不得回寫 Pick／Shipment snapshot。
- Expiry／Lot 必填性及合資格判斷以 Inventory 與 Item 正式規則為準。
- 第一階段不支援 Serial；Active Serial SKU 必須在建立 Fulfillment 時拒絕並清楚說明。

### 12.5 未來 Invoicing／Returns

- Delivery Note 不建立 Invoice、AR、收入、成本或會計分錄。
- 未來 Invoicing 應引用 SHIPPED Shipment／Lines，不可把 PICKED 當已出貨。
- 未來 Returns 以原 Shipment／Line 作來源，但實際退回要重新檢查 SKU、Lot、Expiry、Bin 及 Stock Status。
- 接入後須提供不可逆 downstream matter 判斷，避免已開票、退貨或退款的 Shipment 被一般 Reversal。

---

## 13. 非功能需求

### 13.1 容量與效能

| 編號 | 要求 |
| --- | --- |
| NFR-PERF-001 | 容量基線承接每日約 10,000 張 SO；24 個月最少以 730 萬張 Fulfillment 及 730 萬張 Shipment 驗證，並另以真實分批出貨比例建立較高容量場景。 |
| NFR-PERF-002 | 在正常業務負載及完整 Active 容量下，Queue、Active List 及精確單號查詢 P95 不超過 2 秒。 |
| NFR-PERF-003 | 最多 100 行的 Allocation、Pick Confirm、Shipment Confirm 及 Reversal，在依賴正常時 P95 不超過 3 秒；若採背景處理須在 3 秒內返回可追蹤狀態。 |
| NFR-PERF-004 | 系統須支援至少 50 名互動使用者同時查詢、建立工作、揀貨及確認出貨，並與 Sales Import、Backorder、Export 及 Archive 工作共存。 |
| NFR-PERF-005 | Archive 精確 Fulfillment／Shipment／SO／Tracking 查詢 P95 不超過 3 秒；Customer＋最多 366 日查詢 P95 不超過 5 秒。 |
| NFR-PERF-006 | 大型匯出及歸檔使用 bounded background processing，不把全部結果載入記憶體或長時間鎖定日常交易。 |
| NFR-PERF-007 | Pick List 及 Delivery Note／Packing List 的 100 行 browser print 預覽在正常負載下 P95 不超過 3 秒。 |

上述數量是容量驗證基線，不是限制中小企不可建立更多記錄。技術設計須記錄實際 SO 分批率、平均／P95 Lines、Lot／Bin 分散度及資料保留後的測試分佈。

### 13.2 一致性、冪等及恢復

- Allocation、Release、Pick Confirm、Shipment Confirm、Reversal 及取消均須具冪等性。
- 不得出現 Shipment 顯示 SHIPPED 但 Inventory 未 Issue，或 Inventory 已 Issue 而 SO Fulfilled 未更新且無法恢復的狀態。
- 結果不明時保留可恢復狀態、原 Event／Correlation、lease／重試資訊；不能以新事件盲目重做。
- 跨模組永久驗證失敗不得留下部分結果；暫時技術失敗須可安全續跑。
- Fulfillment 與 Inventory 定期 reconciliation 須能找出數量、狀態、source reference 或重複事件差異。

### 13.3 可用性及營運

- Archive、Export、列印或非必要查詢故障不得阻止 Queue、揀貨及確認出貨。
- Customer 或 Inventory 暫時不可用時不得使用過時資料假裝成功；顯示依賴不可用及 Correlation ID。
- 背景工作重啟後可安全續跑；已完成工作不重複。
- Active／Archive、SO／Shipment／Inventory 的備份、還原及完整性驗證納入營運演練。
- 使用者可分辨業務驗證錯誤、版本衝突、暫時依賴故障及結果不明，並取得具體下一步。

### 13.4 可觀測性

- 指標至少包括 Queue Depth、建立／揀貨／出貨數量、Short Pick Rate、FEFO／FIFO 例外、確認耗時、Issue／Reversal 失敗、SHIPPING／REVERSING 積壓及 Archive 成功／失敗。
- Log 使用安全的 Request、Correlation、Event、SO、Fulfillment、Shipment 及 Movement 識別。
- 不在 Log 記錄完整地址 payload、銀行資料、Token、密碼或無必要個人資料。
- 持續積壓、重試異常、重複事件衝突、reconciliation 差異及歸檔失敗須有運維告警。

### 13.5 可維護性及相容性

- Fulfillment 不複製 Inventory 的資格、FEFO／FIFO 或結餘算法；透過正式契約取得結果。
- Sales、Customer、Item、Inventory 契約版本化；破壞性改動須有遷移及兼容計劃。
- 日期／時間按 APP_TIME_ZONE 顯示；交換格式不得有時區歧義。
- 數量使用精確數值，不以浮點近似；第一階段只接受 Base UOM 整數。
- 使用專案正式支援的桌面瀏覽器，並遵循 `docs/frontend-design.md`。

---

## 14. 例外及錯誤處理

| 場景 | 預期處理 |
| --- | --- |
| SO 沒有可用 Reservation | 不顯示為可建立工作，或提交時拒絕並顯示最新 Reserved／Backorder。 |
| 同一數量已被另一 Fulfillment 佔用 | 拒絕過時提交，要求重新載入；不產生部分工作。 |
| Inventory 沒有足夠合資格 Bin／Lot | 不建立部分 Allocation；顯示缺少數量及不合資格原因。 |
| 偏離 FIFO 缺原因，或偏離 FEFO 缺權限／原因 | 拒絕；不保存例外 Allocation。 |
| 選擇 Expired／低效期／Quarantined／Damaged 庫存 | 永遠拒絕；例外權限不能繞過資格。 |
| Bin 正在 Stocktake Counting | Allocation／Issue 拒絕並顯示處理方式；不可靜默改 Bin。 |
| 實際揀貨少於計劃 | 要求 Short Pick Reason，釋放差額 Allocation 並返回待履約。 |
| 全部實際揀貨為 0 | 不可完成 PICKED；提示取消工作並處理現場差異。 |
| Customer 沒有有效 Shipping Address | 可保留 PICKED，但阻止出貨並連往 Customer Management。 |
| 已選地址被停用或修改 | 確認拒絕並要求重新選擇，不使用過時快照或自動替代。 |
| Allocation 在出貨前失效 | Shipment 不得成功；提示重新分配，不自動改選 Lot／Bin。 |
| Inventory Issue 暫時失敗或結果不明 | 保留 SHIPPING，顯示 Correlation ID，以原事件查詢／續跑。 |
| Shipment Confirm 重送 | 返回原結果，不重複扣貨或更新 SO。 |
| 未出貨取消時 Allocation Release 失敗 | 保持原狀態，顯示失敗並允許原事件安全重試。 |
| Reversal 時貨物未回到公司控制 | 阻止 Reversal；如屬客戶退貨，提示使用 Returns 流程。 |
| 原 Bin 已停用、正在盤點或不能接受回補 | Reversal 不得改存另一位置或部分成功；提示先由 Inventory 負責人解除阻擋，或使用正式例外流程。 |
| Reversal 中任一反向動作失敗 | 保留 SHIPPED／REVERSING 的真實可恢復狀態，不顯示部分成功。 |
| 已 Reversed Shipment 再次沖銷 | 返回既有 Reversal，不重複回補。 |
| 父 SO 已歸檔或有不可逆下游事項 | 拒絕一般 Reversal，提示正式例外流程。 |
| Archive 暫時不可用 | Active 操作繼續；Archive 頁顯示不可用而不是 0 筆。 |

所有錯誤須同時具有穩定 Error Code 及可理解的繁體中文業務訊息；不可把 stack trace 或通用「操作失敗」當作唯一回應。

---

## 15. 用戶驗收準則

### 15.1 Queue 及 Fulfillment 建立

| ID | 驗收準則 |
| --- | --- |
| AC-001 | Given Confirmed SO 有未分配 Reservation，When 倉務人員開啟 Queue，Then 可看到正確 Customer、Warehouse、日期及 Fulfillable Quantity。 |
| AC-002 | Given SO 只有 Backorder 而沒有 Reservation，When 查看 Queue，Then 不可為該數量建立 Fulfillment。 |
| AC-003 | Given 一張 SO 有多個 Lines，When 選部分 Lines／Quantity 建立 Fulfillment，Then 只建立一張屬於該 SO／Warehouse 的 DRAFT 工作。 |
| AC-004 | Given 可履約量為 5，When 嘗試建立 Quantity 6，Then 被拒絕且不佔用任何數量。 |
| AC-005 | Given 兩名使用者同時選相同可履約量，When 提交，Then 最多一人成功，另一人收到可理解的版本衝突。 |
| AC-006 | Given 相同建立事件被重送，When 再次處理，Then 返回原 Fulfillment，不建立第二張工作。 |
| AC-007 | Given 已建立 Fulfillment，When 查詢父 SO，Then Ordered、Fulfilled、Backorder 及 Inventory On Hand 均未被建立動作改變。 |

### 15.2 Allocation、FEFO／FIFO 及揀貨

| ID | 驗收準則 |
| --- | --- |
| AC-008 | Given 三個合資格 Expiry Lots，When 一般使用者分配，Then 最早到期 Lot 先被建議。 |
| AC-009 | Given 沒有 Expiry 的多批庫存，When 分配，Then 最早入庫的合資格庫存先被建議。 |
| AC-010 | Given 同一 Lot 分散多個 Bins，When 一個 Bin 不足，Then 可由多個 Bins 組成完整 Allocation。 |
| AC-011 | Given Expired、效期不足、Quarantined、Damaged、Inactive、Counting 或錯 Warehouse 庫存，When 分配，Then 全部被拒絕。 |
| AC-012 | Given 一般操作員改選非 FEFO Lot，When 提交，Then 即使填原因亦因沒有例外權限被拒絕。 |
| AC-013 | Given 操作員偏離 FIFO 並填原因，或有 FEFO 例外權限者偏離 FEFO 並填原因，When 提交，Then 成功且 Audit 保存建議與實選。 |
| AC-014 | Given 有例外權限者選不合資格庫存，When 提交，Then 仍被拒絕。 |
| AC-015 | Given 任一行 Allocation 失敗，When 建立多行分配，Then 全部不生效且 Fulfillment 不進 PICKING。 |
| AC-016 | Given 成功 Allocation，When 查看 Inventory，Then On Hand 及 SO Fulfilled 不變。 |
| AC-017 | Given PICKING Fulfillment，When 列印 Pick List，Then SO、SKU、Bin、Lot、Expiry、Quantity 及順序與 Allocation 一致。 |
| AC-018 | Given 實際 Picked 等於 Allocated，When 確認，Then Fulfillment 進 PICKED，Inventory On Hand 仍不變。 |
| AC-019 | Given 實際 Picked 小於 Allocated，When 未填原因提交，Then 被拒絕；填原因後差額回到 Queue。 |
| AC-020 | Given 實際 Picked 全部為 0，When 完成揀貨，Then 被拒絕並提示取消工作。 |
| AC-021 | Given Pick Confirm 被重送，When 再處理，Then Picked 不累加、Allocation 不重複釋放。 |

### 15.3 Shipment、地址及出貨

| ID | 驗收準則 |
| --- | --- |
| AC-022 | Given PICKED Fulfillment，When 建立 Shipment，Then 只帶入該工作、SO、Customer、Warehouse 及 Picked Quantity。 |
| AC-023 | Given 同一 Fulfillment 已有 DRAFT Shipment，When 再次建立，Then 返回原 Shipment，不建立第二張有效 Shipment。 |
| AC-024 | Given Customer 有默認及其他有效 Shipping Address，When 建立 Shipment，Then 預選默認並允許改選其他有效地址。 |
| AC-025 | Given Customer 沒有有效 Shipping Address，When 確認出貨，Then 被拒絕並提示先維護地址。 |
| AC-026 | Given 使用者嘗試輸入未保存地址，When 提交，Then 被拒絕且不建立臨時地址。 |
| AC-027 | Given 已選 Address 被停用、改屬其他 Customer 或改變版本，When 確認，Then 被拒絕且不自動替代。 |
| AC-028 | Given Customer 有默認 Shipping Contact，When 建立 Shipment，Then 可預選；沒有 Contact 仍可確認。 |
| AC-029 | Given Carrier、Tracking、Package、Weight 全為空，When 其他資料有效並確認，Then 不因選填資料缺失被拒絕。 |
| AC-030 | Given Package 或 Weight 輸入無效值，When 保存，Then 精確指出欄位且不影響既有 Picked 資料。 |
| AC-031 | Given Shipment 尚為 DRAFT，When 查看 SO／Inventory，Then Fulfilled 及 On Hand 尚未改變。 |
| AC-032 | Given 有效 Shipment 及 Allocation，When 確認，Then 原 Bin／Lot On Hand 扣減、Reservation 耗用、SO Fulfilled 增加且各數量一致。 |
| AC-033 | Given 多個 Lines／Bins／Lots，When 其中一個 Issue 驗證失敗，Then 沒有任何 Line 被部分出貨。 |
| AC-034 | Given Shipment 確認被雙擊或重送，When 處理，Then 只產生一組 Issue 及一次 SO Fulfilled 增量。 |
| AC-035 | Given Inventory 結果不明，When 使用者重新整理或再次操作，Then 看到 SHIPPING／Correlation 並以原事件恢復，不出現虛假成功。 |
| AC-036 | Given Shipment 成功後 Customer／SKU／Address 改名或停用，When 查看歷史，Then 仍顯示出貨時快照。 |
| AC-037 | Given SO 尚有未履約量，When 一張 Shipment 完成，Then SO 保持部分履約並可再建立下一次 Fulfillment。 |
| AC-038 | Given SO 全部有效數量已出貨，When 最後 Shipment 成功，Then SO 依 Sales 規則變為 COMPLETED。 |

### 15.4 取消及 Reversal

| ID | 驗收準則 |
| --- | --- |
| AC-039 | Given PICKING／PICKED Fulfillment 尚未出貨，When 輸入原因取消並確認貨物已放回原 Bin／Lot，Then Allocation 成功釋放後才變 CANCELLED。 |
| AC-040 | Given Allocation Release 失敗，When 取消 Fulfillment，Then 狀態不變且顯示可恢復指引。 |
| AC-041 | Given DRAFT Shipment，When 取消，Then Inventory／SO 不變且 Fulfillment 返回 PICKED。 |
| AC-042 | Given SHIPPED Shipment，When 一般操作員嘗試修改／取消／Reversal，Then 全部被拒絕。 |
| AC-043 | Given 具 Reversal 權限者確認貨物仍在公司控制並輸入原因，When 整張 Reversal，Then 原 bucket 回補、Reservation 恢復、SO Fulfilled 減少且狀態一致。 |
| AC-044 | Given 使用者嘗試部分 Reversal，When 提交，Then 被拒絕並提示整張沖銷後重新履約。 |
| AC-045 | Given Reversal 任一步失敗，When 查詢結果，Then 不存在部分回補或虛假 REVERSED。 |
| AC-046 | Given 相同 Reversal 事件重送，When 再處理，Then 返回原結果而不重複回補。 |
| AC-047 | Given 貨物已交付後由客戶退回，When 使用者嘗試 Shipment Reversal，Then 被阻止並提示 Returns 流程。 |

### 15.5 查詢、安全、效能及歸檔

| ID | 驗收準則 |
| --- | --- |
| AC-048 | Given Viewer，When 查詢、列印及匯出，Then 可讀授權資料但不可建立、揀貨、出貨或 Reversal。 |
| AC-049 | Given 使用者替換 SO／Fulfillment／Shipment／Address／Allocation ID，When 讀取或提交，Then 不可越權或跨 aggregate。 |
| AC-050 | Given 含公式字首或 HTML 的安全測試文字，When 顯示及匯出，Then 不執行 script／formula 且不洩漏敏感資料。 |
| AC-051 | Given 24 個月 Active 容量及正常負載，When 查詢 Queue／單號及完成 100 行出貨，Then 符合第 13.1 節 P95 目標且結果正確。 |
| AC-052 | Given 父 SO 及所有下游記錄已符合歸檔條件，When 月度歸檔，Then SO、Fulfillment、Shipment、快照、Reversal 及 Audit 一併完整移入 Archive。 |
| AC-053 | Given 存在 PICKING／PICKED／SHIPPING／REVERSING 或未完成 Allocation，When 評估父 SO 歸檔，Then 被跳過並記錄原因。 |
| AC-054 | Given 歸檔中斷或校驗失敗，When 安全重跑，Then 已成功資料不重複、失敗資料留 Active 且可追蹤。 |
| AC-055 | Given Archive 暫時不可用，When 使用者建工作、出貨及查 Active，Then 日常操作繼續；Archive 顯示不可用而非零結果。 |
| AC-056 | Given 完整備份，When 在隔離環境還原，Then SO、Fulfillment、Shipment、Inventory references、Archive 及 Audit 可完整對賬。 |

---

## 16. 初始資料、設定及上線準備

### 16.1 必須準備的業務設定

- Fulfillment、Shipment 及 Reversal Number 規則。
- Active Fulfillment Warehouses、Bins、Lot／Expiry、Stock Status 及 Inventory Reservation 測試資料。
- Customer Shipping Address／Contact 用途、狀態及默認值。
- APP_TIME_ZONE、Base UOM 及 Minimum Sale Life 規則。
- 權限至角色的正式分配。
- Pick List、Delivery Note／Packing List 公司名稱、標題及基本列印資料。
- Active／Archive 年期及排程沿用 Sales Order 設定，不另加重複參數。

Carrier Name 第一階段使用選填文字，不建立 Carrier Master；如未來需要 API、服務級別或地址標籤，再以獨立需求擴充。

### 16.2 上線前資料及契約檢查

- Sales Ordered／Reserved／Backorder／Fulfilled 初始數量可對賬。
- Inventory Reservation、Allocation、Release、Issue、Reversal 及 source query 契約通過整合測試。
- Customer 的 Shipping Address／Contact 資料已檢查用途、Active 及默認衝突。
- Item 的 Tracking Policy、Minimum Sale Life 及 Base UOM 資料有效；Active Serial SKU 已阻止進入本流程。
- 對同一 SO 已存在的未完成手工出貨或舊系統工作建立明確遷移／結案清單，不能重複履約。

### 16.3 上線及回復

- 上線前完成每日約 10,000 張 SO、24 個月 Active、50 名互動使用者及分批出貨比例的容量驗證。
- 完成一張多 Bin／Lot、短揀、地址變更、重送、Issue 結果不明及 Reversal 的端到端演練。
- 回復版本不得遺失已分配 Fulfillment／Shipment Number、Allocation、Issue、Reservation Consume 或 Event outcome。
- 上線後重點監察 Queue Depth、Short Pick、例外選批、Issue／Reversal 失敗、結果不明積壓及 reconciliation 差異。

---

## 17. 建議交付階段

本節只定義可獨立驗收的能力成果；實際工程任務由 `05_development_tasks.md` 拆分。

### Phase 0 — 契約、狀態及容量基線

目標成果：確認 Sales、Customer、Item、Inventory 邊界，鎖定狀態、數量守恆、冪等及每日 10,000 張容量基線。

獨立驗證：Provider／consumer contract、狀態轉換、真 MySQL 一致性、失敗恢復及容量資料模型。

### Phase 1 — Queue、Fulfillment 及 Picking

目標成果：倉務人員可從一張 SO 建立工作，依 FEFO／FIFO 分配至 Bin／Lot，列印 Pick List，完成正常／短揀。

獨立驗證：權限、並發佔用、多 Bin／Lot、例外選批、短揀、取消及 Inventory Allocation 對賬。

### Phase 2 — Shipment 及正式出庫

目標成果：由 PICKED 工作選有效地址建立 Shipment，確認後原子 Issue 並更新 SO Fulfilled。

獨立驗證：地址狀態、選填物流資料、多行出庫、重送、逾時／未知結果、Delivery Note 及 SO／Inventory 對賬。

### Phase 3 — Reversal、查詢及發布門檻

目標成果：完成整張 Reversal、Active／Archive 查詢、匯出、Audit、歸檔、還原及發布證據。

獨立驗證：錯誤出貨回復、權限、部分失敗防護、24 個月容量、歸檔中斷、Archive unavailable 及 restore rehearsal。

---

## 18. 已確認決策、設計門檻及變更控制

### 18.1 已確認決策

| 編號 | 決策 |
| --- | --- |
| DEC-001 | Confirmed SO 自動進 Queue，但由倉務人員手動建立本次 Fulfillment／Pick List。 |
| DEC-002 | 一張 SO 可分多次出貨；每張 Shipment 只屬一張 SO，不合併多張 SO。 |
| DEC-003 | 短揀需原因；差額回待履約，不自動取消或改庫存。 |
| DEC-004 | 有 Expiry 依 FEFO，無 Expiry 依 FIFO；合資格例外需權限及原因。 |
| DEC-005 | 不強制獨立 Packing Confirm；物流欄位選填。 |
| DEC-006 | 出貨時從 Customer 有效 Shipping Address 選擇，預選默認並保存快照，不准臨時地址。 |
| DEC-007 | 確認出貨才扣 On Hand、耗用 Reservation 及更新 SO Fulfilled。 |
| DEC-008 | 錯誤確認出貨提供具權限、原因及 Audit 的整張 Shipment Reversal。 |
| DEC-009 | Customer Return 與 Shipment Reversal 分開。 |
| DEC-010 | 中小企簡單實用優先，不加入大型 WMS、Carrier API 或路線功能。 |

### 18.2 技術設計必須關閉的門檻

| 編號 | 門檻 | 完成條件 |
| --- | --- | --- |
| GATE-001 | 一個 Fulfillment 工作單對一張有效 Shipment 的唯一性 | Database、API 及 UI 對 DRAFT／CANCELLED／SHIPPED 的規則一致，並支援取消 Draft 後重建。 |
| GATE-002 | Shipment Confirm 跨模組一致性 | 明確定義 transaction／operation state、unknown outcome recovery、lock order 及 reconciliation。 |
| GATE-003 | Shipment Reversal 的 Inventory 語意 | Inventory 契約確認按原 bucket 回補、Reservation 恢復、Allocation 不重開及冪等結果。 |
| GATE-004 | SO 狀態回退 | 定義 Reversal 後 COMPLETED／Partially Fulfilled SO 如何按正式數量重新計算，不改歷史。 |
| GATE-005 | Archive aggregate 邊界 | Sales 與 Fulfillment 同批或可證明一致的協調方式、routing、hash／count 校驗及失敗恢復。 |
| GATE-006 | 容量資料分佈 | 記錄真實／目標分批出貨率、Lines、Bin／Lot 分散度及 Active／Archive row counts。 |
| GATE-007 | Serial SKU 防護 | 在 Item／Inventory 未支援 Serial 前，資料及提交點均能阻止 Serial SKU。 |

### 18.3 後續需求變更

以下任何新增均視為範圍變更，須先更新需求、影響分析及驗收準則：

- 多 SO 合併 Shipment、跨倉履約或自動選倉。
- Wave／Batch／Zone Picking、手提掃描設備或路線優化。
- 強制 Packing、箱內明細、棧板、電子面單或 Carrier API。
- 臨時地址、司機、車隊、Proof of Delivery 或客戶簽收。
- 部分 Shipment Reversal、Customer Return、換貨、退款或重新寄送。
- Serial Number、Catch Weight、Bundle／Kit 或會計成本處理。

---

## 19. 需求追溯及簽核

### 19.1 追溯摘要

| 業務目標 | 功能需求 | 主要驗收準則 |
| --- | --- | --- |
| Queue 及分批履約 | FR-QUEUE-001～012 | AC-001～007 |
| Bin／Lot、FEFO／FIFO 及揀貨 | FR-PICK-001～012、FR-PICKCONF-001～010 | AC-008～021 |
| 地址、Shipment 及 Inventory Issue | FR-SHIP-001～012、FR-CONF-001～016 | AC-022～038 |
| 取消及 Shipment Reversal | FR-LIFE-001～005、FR-REV-001～012 | AC-039～047 |
| 查詢、文件、匯出及 Audit | FR-INQ／DOC／EXPORT／AUDIT | AC-048～050 |
| 容量、恢復、歸檔及保留 | FR-ARC-001～010、NFR-PERF-001～007 | AC-051～056 |

### 19.2 業務簽核

| 簽核角色 | 姓名 | 決定 | 日期 | 備註 |
| --- | --- | --- | --- | --- |
| Sales Process Owner | — | — | — | — |
| Warehouse／Fulfillment Owner | — | — | — | — |
| Inventory Owner | — | — | — | — |
| Customer Data Owner | — | — | — | — |
| Product Owner | — | — | — | — |

本文件簽核後，方可產出 `03_design_spec.md`。技術設計不得把未確認的 WMS、Carrier、Return、Invoicing 或 Accounting 能力放入第一階段。

---

## 20. Harness 2.0 正式需求定義

本節是本模組需求實體的正式定義來源。§1～§19 的敘述內容保持原文；正式定義以穩定的 `(module_id, local_id)` 身分重述同一條需求，令 `08_traceability.json` 可以引用。舊 ID 不再是追溯圖的節點，但保留在每條定義內以便對照歷史文件及 PR。

`OBJ-01`～`OBJ-09`、`KPI-01`～`KPI-10`、`FUL-CAP-01`～`FUL-CAP-05`、`BR-001`～`BR-036`、`AC-001`～`AC-056`、`DEC-001`～`DEC-010` 及 `GATE-001`～`GATE-007` 維持為敘述性目標、規則、驗收準則與決策，由下列需求及對應測試案例承載，不另設為追溯節點。


### 20.1 需求 ID 對照

§8 的 107 條功能需求按文件次序對應 `FR-001`～`FR-107`；§11 的 12 條安全需求 ID 不變；§13.1 的 7 條效能需求對應 `NFR-001`～`NFR-007`，§13.2～§13.5 原本沒有編號的 19 條非功能陳述按文件次序對應 `NFR-008`～`NFR-026`，逐條保持原文，不合併也不改寫。


| Harness ID | Legacy ID | 優先級 |
| --- | --- | --- |
| FR-001 | FR-QUEUE-001 | Must |
| FR-002 | FR-QUEUE-002 | Must |
| FR-003 | FR-QUEUE-003 | Must |
| FR-004 | FR-QUEUE-004 | Must |
| FR-005 | FR-QUEUE-005 | Must |
| FR-006 | FR-QUEUE-006 | Must |
| FR-007 | FR-QUEUE-007 | Must |
| FR-008 | FR-QUEUE-008 | Must |
| FR-009 | FR-QUEUE-009 | Must |
| FR-010 | FR-QUEUE-010 | Must |
| FR-011 | FR-QUEUE-011 | Should |
| FR-012 | FR-QUEUE-012 | Must |
| FR-013 | FR-PICK-001 | Must |
| FR-014 | FR-PICK-002 | Must |
| FR-015 | FR-PICK-003 | Must |
| FR-016 | FR-PICK-004 | Must |
| FR-017 | FR-PICK-005 | Must |
| FR-018 | FR-PICK-006 | Must |
| FR-019 | FR-PICK-007 | Must |
| FR-020 | FR-PICK-008 | Must |
| FR-021 | FR-PICK-009 | Must |
| FR-022 | FR-PICK-010 | Must |
| FR-023 | FR-PICK-011 | Must |
| FR-024 | FR-PICK-012 | Must |
| FR-025 | FR-PICKCONF-001 | Must |
| FR-026 | FR-PICKCONF-002 | Must |
| FR-027 | FR-PICKCONF-003 | Must |
| FR-028 | FR-PICKCONF-004 | Must |
| FR-029 | FR-PICKCONF-005 | Must |
| FR-030 | FR-PICKCONF-006 | Must |
| FR-031 | FR-PICKCONF-007 | Must |
| FR-032 | FR-PICKCONF-008 | Must |
| FR-033 | FR-PICKCONF-009 | Must |
| FR-034 | FR-PICKCONF-010 | Should |
| FR-035 | FR-SHIP-001 | Must |
| FR-036 | FR-SHIP-002 | Must |
| FR-037 | FR-SHIP-003 | Must |
| FR-038 | FR-SHIP-004 | Must |
| FR-039 | FR-SHIP-005 | Must |
| FR-040 | FR-SHIP-006 | Must |
| FR-041 | FR-SHIP-007 | Must |
| FR-042 | FR-SHIP-008 | Must |
| FR-043 | FR-SHIP-009 | Must |
| FR-044 | FR-SHIP-010 | Must |
| FR-045 | FR-SHIP-011 | Must |
| FR-046 | FR-SHIP-012 | Must |
| FR-047 | FR-CONF-001 | Must |
| FR-048 | FR-CONF-002 | Must |
| FR-049 | FR-CONF-003 | Must |
| FR-050 | FR-CONF-004 | Must |
| FR-051 | FR-CONF-005 | Must |
| FR-052 | FR-CONF-006 | Must |
| FR-053 | FR-CONF-007 | Must |
| FR-054 | FR-CONF-008 | Must |
| FR-055 | FR-CONF-009 | Must |
| FR-056 | FR-CONF-010 | Must |
| FR-057 | FR-CONF-011 | Must |
| FR-058 | FR-CONF-012 | Must |
| FR-059 | FR-CONF-013 | Must |
| FR-060 | FR-CONF-014 | Must |
| FR-061 | FR-CONF-015 | Must |
| FR-062 | FR-CONF-016 | Must |
| FR-063 | FR-LIFE-001 | Must |
| FR-064 | FR-LIFE-002 | Must |
| FR-065 | FR-LIFE-003 | Must |
| FR-066 | FR-LIFE-004 | Must |
| FR-067 | FR-LIFE-005 | Must |
| FR-068 | FR-REV-001 | Must |
| FR-069 | FR-REV-002 | Must |
| FR-070 | FR-REV-003 | Must |
| FR-071 | FR-REV-004 | Must |
| FR-072 | FR-REV-005 | Must |
| FR-073 | FR-REV-006 | Must |
| FR-074 | FR-REV-007 | Must |
| FR-075 | FR-REV-008 | Must |
| FR-076 | FR-REV-009 | Must |
| FR-077 | FR-REV-010 | Must |
| FR-078 | FR-REV-011 | Must |
| FR-079 | FR-REV-012 | Must |
| FR-080 | FR-INQ-001 | Must |
| FR-081 | FR-INQ-002 | Must |
| FR-082 | FR-INQ-003 | Must |
| FR-083 | FR-INQ-004 | Must |
| FR-084 | FR-INQ-005 | Must |
| FR-085 | FR-INQ-006 | Must |
| FR-086 | FR-INQ-007 | Must |
| FR-087 | FR-DOC-001 | Must |
| FR-088 | FR-DOC-002 | Must |
| FR-089 | FR-DOC-003 | Must |
| FR-090 | FR-DOC-004 | Must |
| FR-091 | FR-EXPORT-001 | Must |
| FR-092 | FR-EXPORT-002 | Must |
| FR-093 | FR-EXPORT-003 | Must |
| FR-094 | FR-EXPORT-004 | Must |
| FR-095 | FR-AUDIT-001 | Must |
| FR-096 | FR-AUDIT-002 | Must |
| FR-097 | FR-AUDIT-003 | Must |
| FR-098 | FR-ARC-001 | Must |
| FR-099 | FR-ARC-002 | Must |
| FR-100 | FR-ARC-003 | Must |
| FR-101 | FR-ARC-004 | Must |
| FR-102 | FR-ARC-005 | Must |
| FR-103 | FR-ARC-006 | Must |
| FR-104 | FR-ARC-007 | Must |
| FR-105 | FR-ARC-008 | Must |
| FR-106 | FR-ARC-009 | Must |
| FR-107 | FR-ARC-010 | Must |
| NFR-001 | NFR-PERF-001 | Must |
| NFR-002 | NFR-PERF-002 | Must |
| NFR-003 | NFR-PERF-003 | Must |
| NFR-004 | NFR-PERF-004 | Must |
| NFR-005 | NFR-PERF-005 | Must |
| NFR-006 | NFR-PERF-006 | Must |
| NFR-007 | NFR-PERF-007 | Must |
| NFR-008 | §13.2 第1項（13.2 一致性、冪等及恢復） | Must |
| NFR-009 | §13.2 第2項（13.2 一致性、冪等及恢復） | Must |
| NFR-010 | §13.2 第3項（13.2 一致性、冪等及恢復） | Must |
| NFR-011 | §13.2 第4項（13.2 一致性、冪等及恢復） | Must |
| NFR-012 | §13.2 第5項（13.2 一致性、冪等及恢復） | Must |
| NFR-013 | §13.3 第1項（13.3 可用性及營運） | Must |
| NFR-014 | §13.3 第2項（13.3 可用性及營運） | Must |
| NFR-015 | §13.3 第3項（13.3 可用性及營運） | Must |
| NFR-016 | §13.3 第4項（13.3 可用性及營運） | Must |
| NFR-017 | §13.3 第5項（13.3 可用性及營運） | Must |
| NFR-018 | §13.4 第1項（13.4 可觀測性） | Must |
| NFR-019 | §13.4 第2項（13.4 可觀測性） | Must |
| NFR-020 | §13.4 第3項（13.4 可觀測性） | Must |
| NFR-021 | §13.4 第4項（13.4 可觀測性） | Must |
| NFR-022 | §13.5 第1項（13.5 可維護性及相容性） | Must |
| NFR-023 | §13.5 第2項（13.5 可維護性及相容性） | Must |
| NFR-024 | §13.5 第3項（13.5 可維護性及相容性） | Must |
| NFR-025 | §13.5 第4項（13.5 可維護性及相容性） | Must |
| NFR-026 | §13.5 第5項（13.5 可維護性及相容性） | Must |
| SEC-001 | SEC-001 | Must |
| SEC-002 | SEC-002 | Must |
| SEC-003 | SEC-003 | Must |
| SEC-004 | SEC-004 | Must |
| SEC-005 | SEC-005 | Must |
| SEC-006 | SEC-006 | Must |
| SEC-007 | SEC-007 | Must |
| SEC-008 | SEC-008 | Must |
| SEC-009 | SEC-009 | Must |
| SEC-010 | SEC-010 | Must |
| SEC-011 | SEC-011 | Must |
| SEC-012 | SEC-012 | Must |

### 20.2 正式定義

以下每個實體的 `Statement` 保留需求原文，`Acceptance criteria` 與 `Failure behavior` 陳述本模組共通的可驗證條件，不新增任何未經確認的業務規則、門檻或流程。


## FR-001 — `fulfillment.view` 可查看有未分配有效 Reservation 的 Confirmed／Partially Fulfilled SO

### Statement
`fulfillment.view` 可查看有未分配有效 Reservation 的 Confirmed／Partially Fulfilled SO。 （Legacy identity：`FR-QUEUE-001`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-002 — Queue 顯示 SO Number、Customer、Warehouse、Order／Requested Delivery Date、Status、Reserved／Backorder／Fulfilled／Fulfillable 摘要及更新時間

### Statement
Queue 顯示 SO Number、Customer、Warehouse、Order／Requested Delivery Date、Status、Reserved／Backorder／Fulfilled／Fulfillable 摘要及更新時間。 （Legacy identity：`FR-QUEUE-002`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-003 — 可按 SO Number、Customer、Warehouse、Requested Delivery Date、SO Status、Has Backorder 及進行中工作篩選

### Statement
可按 SO Number、Customer、Warehouse、Requested Delivery Date、SO Status、Has Backorder 及進行中工作篩選。 （Legacy identity：`FR-QUEUE-003`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-004 — 只接受 Fulfillable Quantity 大於 0；純 Backorder、Cancelled、Closed、Completed 或 CONFIRMING SO 不可建立工作

### Statement
只接受 Fulfillable Quantity 大於 0；純 Backorder、Cancelled、Closed、Completed 或 CONFIRMING SO 不可建立工作。 （Legacy identity：`FR-QUEUE-004`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-005 — `fulfillment.operation` 可從一張 SO 選 Lines 及本次正數 Quantity 建立 DRAFT Fulfillment

### Statement
`fulfillment.operation` 可從一張 SO 選 Lines 及本次正數 Quantity 建立 DRAFT Fulfillment。 （Legacy identity：`FR-QUEUE-005`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-006 — Quantity 不得超過當前未分配 Reservation；提交重驗 version 及並發佔用

### Statement
Quantity 不得超過當前未分配 Reservation；提交重驗 version 及並發佔用。 （Legacy identity：`FR-QUEUE-006`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-007 — 一張 Fulfillment 只引用一張 SO 及其 Warehouse，不可加入其他 SO／Customer／Warehouse Line

### Statement
一張 Fulfillment 只引用一張 SO 及其 Warehouse，不可加入其他 SO／Customer／Warehouse Line。 （Legacy identity：`FR-QUEUE-007`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-008 — 首次成功保存分配唯一不可重用 Fulfillment Number

### Statement
首次成功保存分配唯一不可重用 Fulfillment Number。 （Legacy identity：`FR-QUEUE-008`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-009 — 相同建立事件重送不得產生第二張 Fulfillment 或重複佔量

### Statement
相同建立事件重送不得產生第二張 Fulfillment 或重複佔量。 （Legacy identity：`FR-QUEUE-009`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-010 — SO 狀態、Reservation 或 Fulfillable Quantity 改變時拒絕過時提交並要求重新載入

### Statement
SO 狀態、Reservation 或 Fulfillable Quantity 改變時拒絕過時提交並要求重新載入。 （Legacy identity：`FR-QUEUE-010`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-011 — SO Detail 與 Fulfillment／Queue 可雙向前往

### Statement
SO Detail 與 Fulfillment／Queue 可雙向前往。 （Legacy identity：`FR-QUEUE-011`；優先級：`Should`。）

### Acceptance criteria
`FR-QUEUE-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-012 — 建立工作不得改變 SO Ordered／Fulfilled／Backorder 或 Inventory On Hand

### Statement
建立工作不得改變 SO Ordered／Fulfilled／Backorder 或 Inventory On Hand。 （Legacy identity：`FR-QUEUE-012`；優先級：`Must`。）

### Acceptance criteria
`FR-QUEUE-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-013 — DRAFT Fulfillment 可取得 Inventory 合資格 Bin／Lot 候選及建議量

### Statement
DRAFT Fulfillment 可取得 Inventory 合資格 Bin／Lot 候選及建議量。 （Legacy identity：`FR-PICK-001`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-014 — 有 Expiry 候選按最早合資格 Expiry、Lot、First Receipt、Bin 排序；無 Expiry 按 First Receipt、Lot、Bin 排序

### Statement
有 Expiry 候選按最早合資格 Expiry、Lot、First Receipt、Bin 排序；無 Expiry 按 First Receipt、Lot、Bin 排序。 （Legacy identity：`FR-PICK-002`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-015 — 一行可分配至同 Warehouse 多個 Bin／Lot，總量不超 Planned 或 Reservation

### Statement
一行可分配至同 Warehouse 多個 Bin／Lot，總量不超 Planned 或 Reservation。 （Legacy identity：`FR-PICK-003`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-016 — Expired、效期不足、Quarantined、Damaged、Inactive、Counting、錯 Warehouse 或不足庫存不可分配

### Statement
Expired、效期不足、Quarantined、Damaged、Inactive、Counting、錯 Warehouse 或不足庫存不可分配。 （Legacy identity：`FR-PICK-004`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-017 — 偏離 FIFO 時 `fulfillment.operation` 使用者須填原因；偏離 FEFO 時另須 `inventory.fefo.override`；所選庫存仍須合資格

### Statement
偏離 FIFO 時 `fulfillment.operation` 使用者須填原因；偏離 FEFO 時另須 `inventory.fefo.override`；所選庫存仍須合資格。 （Legacy identity：`FR-PICK-005`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-018 — 所有 Allocation 成功後才轉 PICKING；任一失敗不得保留部分結果

### Statement
所有 Allocation 成功後才轉 PICKING；任一失敗不得保留部分結果。 （Legacy identity：`FR-PICK-006`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-019 — Allocation 不扣 On Hand，不改 SO Fulfilled

### Statement
Allocation 不扣 On Hand，不改 SO Fulfilled。 （Legacy identity：`FR-PICK-007`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-020 — Pick List 顯示 Fulfillment／SO、Customer、Warehouse、SKU、Planned、Bin、Lot、Expiry、順序及 notes

### Statement
Pick List 顯示 Fulfillment／SO、Customer、Warehouse、SKU、Planned、Bin、Lot、Expiry、順序及 notes。 （Legacy identity：`FR-PICK-008`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-021 — Pick List 按 Bin、Lot、SKU 穩定排序並提供 A4 browser print

### Statement
Pick List 按 Bin、Lot、SKU 穩定排序並提供 A4 browser print。 （Legacy identity：`FR-PICK-009`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-022 — 主檔變更不得改寫已完成揀貨及出貨快照

### Statement
主檔變更不得改寫已完成揀貨及出貨快照。 （Legacy identity：`FR-PICK-010`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-023 — 確認揀貨前可重新分配；安全釋放舊 Allocation 後才建立新 Allocation

### Statement
確認揀貨前可重新分配；安全釋放舊 Allocation 後才建立新 Allocation。 （Legacy identity：`FR-PICK-011`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-024 — 重新分配及例外保存原建議、實選、Actor、Reason、Time 及 Inventory Reference

### Statement
重新分配及例外保存原建議、實選、Actor、Reason、Time 及 Inventory Reference。 （Legacy identity：`FR-PICK-012`；優先級：`Must`。）

### Acceptance criteria
`FR-PICK-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-025 — PICKING 可按 Allocation 輸入 Base UOM 實際 Picked Quantity；可為 0，不可為負或超過 Allocated

### Statement
PICKING 可按 Allocation 輸入 Base UOM 實際 Picked Quantity；可為 0，不可為負或超過 Allocated。 （Legacy identity：`FR-PICKCONF-001`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-026 — 至少一行 Picked > 0 才可完成揀貨；全數為 0 應取消工作

### Statement
至少一行 Picked > 0 才可完成揀貨；全數為 0 應取消工作。 （Legacy identity：`FR-PICKCONF-002`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-027 — Picked < Allocated 時該行必須輸入 Short Pick Reason

### Statement
Picked < Allocated 時該行必須輸入 Short Pick Reason。 （Legacy identity：`FR-PICKCONF-003`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-028 — 短揀差額釋放本次 Allocation，保留未消耗 Reservation 並返回 Fulfillable Quantity

### Statement
短揀差額釋放本次 Allocation，保留未消耗 Reservation 並返回 Fulfillable Quantity。 （Legacy identity：`FR-PICKCONF-004`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-029 — 確認揀貨不得扣 On Hand、耗用 Reservation、增加 SO Fulfilled 或建立 Shipment

### Statement
確認揀貨不得扣 On Hand、耗用 Reservation、增加 SO Fulfilled 或建立 Shipment。 （Legacy identity：`FR-PICKCONF-005`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-030 — 全部 Picked／Short 及 Release 成功後才轉 PICKED；任一失敗全部不生效

### Statement
全部 Picked／Short 及 Release 成功後才轉 PICKED；任一失敗全部不生效。 （Legacy identity：`FR-PICKCONF-006`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-031 — PICKED 後結果不可直接修改；未有 Shipment 時取消並重建

### Statement
PICKED 後結果不可直接修改；未有 Shipment 時取消並重建。 （Legacy identity：`FR-PICKCONF-007`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-032 — 確認具冪等性；重複或逾時重試不得重複 Release 或累加 Picked

### Statement
確認具冪等性；重複或逾時重試不得重複 Release 或累加 Picked。 （Legacy identity：`FR-PICKCONF-008`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-033 — 保存 Picker、Picked At、逐行結果、Short Reason、Event ID 及 Correlation ID

### Statement
保存 Picker、Picked At、逐行結果、Short Reason、Event ID 及 Correlation ID。 （Legacy identity：`FR-PICKCONF-009`；優先級：`Must`。）

### Acceptance criteria
`FR-PICKCONF-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-034 — 可由短揀結果返回 SO／Queue 查看差額

### Statement
可由短揀結果返回 SO／Queue 查看差額。 （Legacy identity：`FR-PICKCONF-010`；優先級：`Should`。）

### Acceptance criteria
`FR-PICKCONF-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-035 — `fulfillment.operation` 可由 PICKED Fulfillment 建立 DRAFT Shipment

### Statement
`fulfillment.operation` 可由 PICKED Fulfillment 建立 DRAFT Shipment。 （Legacy identity：`FR-SHIP-001`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-036 — 一張 Fulfillment 最多一張非 CANCELLED Shipment；重複建立返回既有記錄

### Statement
一張 Fulfillment 最多一張非 CANCELLED Shipment；重複建立返回既有記錄。 （Legacy identity：`FR-SHIP-002`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-037 — Shipment 只含該 Fulfillment 的 Picked Quantity、原 SO、Customer 及 Warehouse

### Statement
Shipment 只含該 Fulfillment 的 Picked Quantity、原 SO、Customer 及 Warehouse。 （Legacy identity：`FR-SHIP-003`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-038 — 查詢該 Customer 的 Active Shipping Address；有默認值時預選，可改選其他有效地址

### Statement
查詢該 Customer 的 Active Shipping Address；有默認值時預選，可改選其他有效地址。 （Legacy identity：`FR-SHIP-004`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-039 — 不提供自由文字地址；沒有有效地址可保留揀貨，但不可確認出貨，並提供 Customer 維護入口

### Statement
不提供自由文字地址；沒有有效地址可保留揀貨，但不可確認出貨，並提供 Customer 維護入口。 （Legacy identity：`FR-SHIP-005`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-040 — 可選有效 Shipping Contact並預選默認值；Contact 不是出貨必填

### Statement
可選有效 Shipping Contact並預選默認值；Contact 不是出貨必填。 （Legacy identity：`FR-SHIP-006`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-041 — 提交時重驗 Address／Contact 所有權、Active 及用途；不得靜默改選

### Statement
提交時重驗 Address／Contact 所有權、Active 及用途；不得靜默改選。 （Legacy identity：`FR-SHIP-007`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-042 — Carrier、Tracking Number、Package Count、Total Weight、Weight UOM、Notes 選填

### Statement
Carrier、Tracking Number、Package Count、Total Weight、Weight UOM、Notes 選填。 （Legacy identity：`FR-SHIP-008`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-043 — Package Count 如輸入須為正整數；Weight 如輸入須 > 0 且有 Weight UOM

### Statement
Package Count 如輸入須為正整數；Weight 如輸入須 > 0 且有 Weight UOM。 （Legacy identity：`FR-SHIP-009`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-044 — 缺少選填物流資料不得阻止出貨

### Statement
缺少選填物流資料不得阻止出貨。 （Legacy identity：`FR-SHIP-010`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-045 — 首次成功保存分配唯一不可重用 Shipment Number

### Statement
首次成功保存分配唯一不可重用 Shipment Number。 （Legacy identity：`FR-SHIP-011`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-046 — Draft 可改地址、Contact 及物流資料，不可改 SKU、Bin、Lot 或 Picked Quantity

### Statement
Draft 可改地址、Contact 及物流資料，不可改 SKU、Bin、Lot 或 Picked Quantity。 （Legacy identity：`FR-SHIP-012`；優先級：`Must`。）

### Acceptance criteria
`FR-SHIP-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-047 — 只有完整、有效的 DRAFT Shipment 可確認；所屬 Fulfillment 必須仍為 PICKED

### Statement
只有完整、有效的 DRAFT Shipment 可確認；所屬 Fulfillment 必須仍為 PICKED。 （Legacy identity：`FR-CONF-001`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-048 — 確認時重驗父 SO 未取消／關閉／歸檔、Customer 關係、Warehouse、Address、Contact（如有）、SKU 及權限

### Statement
確認時重驗父 SO 未取消／關閉／歸檔、Customer 關係、Warehouse、Address、Contact（如有）、SKU 及權限。 （Legacy identity：`FR-CONF-002`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-049 — 確認時重驗每個 Allocation、Reservation、Bin、Lot、Expiry、Stock Status、Quantity 及 version

### Statement
確認時重驗每個 Allocation、Reservation、Bin、Lot、Expiry、Stock Status、Quantity 及 version。 （Legacy identity：`FR-CONF-003`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-050 — Address 在頁面載入後被停用、移除 Shipping 用途、改屬其他 Customer 或版本改變時，須拒絕並要求重新選擇

### Statement
Address 在頁面載入後被停用、移除 Shipping 用途、改屬其他 Customer 或版本改變時，須拒絕並要求重新選擇。 （Legacy identity：`FR-CONF-004`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-051 — Allocation 在頁面載入後失效時，不得靜默改選另一 Bin／Lot；須拒絕並返回重新分配流程

### Statement
Allocation 在頁面載入後失效時，不得靜默改選另一 Bin／Lot；須拒絕並返回重新分配流程。 （Legacy identity：`FR-CONF-005`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-052 — 確認開始後 Shipment 進入 SHIPPING；結果未明時不得顯示 SHIPPED、接受修改或另一個確認

### Statement
確認開始後 Shipment 進入 SHIPPING；結果未明時不得顯示 SHIPPED、接受修改或另一個確認。 （Legacy identity：`FR-CONF-006`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-053 — 確認使用穩定 Event／Idempotency ID；重複點擊或重送不得重複 Issue、Consume Reservation 或增加 SO Fulfilled

### Statement
確認使用穩定 Event／Idempotency ID；重複點擊或重送不得重複 Issue、Consume Reservation 或增加 SO Fulfilled。 （Legacy identity：`FR-CONF-007`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-054 — 一次確認須以可恢復一致結果完成 Inventory Issue、Reservation Consume、Shipment SHIPPED、Fulfillment SHIPPED 及 SO Fulfilled 更新

### Statement
一次確認須以可恢復一致結果完成 Inventory Issue、Reservation Consume、Shipment SHIPPED、Fulfillment SHIPPED 及 SO Fulfilled 更新。 （Legacy identity：`FR-CONF-008`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-055 — 任一 Shipment Line／Allocation 失敗時不得留下部分 Shipment、部分 Inventory Issue 或部分 SO Fulfilled

### Statement
任一 Shipment Line／Allocation 失敗時不得留下部分 Shipment、部分 Inventory Issue 或部分 SO Fulfilled。 （Legacy identity：`FR-CONF-009`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-056 — Issue 只可扣減原 Allocation 指定的 Warehouse／Bin／Lot／Status，不可由 Fulfillment 自行改寫 Inventory Balance

### Statement
Issue 只可扣減原 Allocation 指定的 Warehouse／Bin／Lot／Status，不可由 Fulfillment 自行改寫 Inventory Balance。 （Legacy identity：`FR-CONF-010`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-057 — Shipped Quantity 須等於 Fulfillment Picked Quantity，亦須等於其全部成功 Issue 明細之和

### Statement
Shipped Quantity 須等於 Fulfillment Picked Quantity，亦須等於其全部成功 Issue 明細之和。 （Legacy identity：`FR-CONF-011`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-058 — 成功時保存 Address／Contact／Customer／SKU／UOM／Warehouse／Bin／Lot／Expiry／Status 快照及 Confirmed By／At

### Statement
成功時保存 Address／Contact／Customer／SKU／UOM／Warehouse／Bin／Lot／Expiry／Status 快照及 Confirmed By／At。 （Legacy identity：`FR-CONF-012`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-059 — 成功後父 SO 的 Fulfilled Quantity 按相同數量增加；不得改變 Ordered Quantity，未完成量仍可完整解釋

### Statement
成功後父 SO 的 Fulfilled Quantity 按相同數量增加；不得改變 Ordered Quantity，未完成量仍可完整解釋。 （Legacy identity：`FR-CONF-013`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-013` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-060 — SO 全部有效數量已 Fulfilled 時，由 Sales Order 規則轉為 COMPLETED；部分完成保持 Partially Fulfilled

### Statement
SO 全部有效數量已 Fulfilled 時，由 Sales Order 規則轉為 COMPLETED；部分完成保持 Partially Fulfilled。 （Legacy identity：`FR-CONF-014`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-014` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-061 — Inventory 暫時不可用或 commit 結果不明時保留 SHIPPING 及 Correlation ID，由原事件查詢或續跑，不建立第二份結果

### Statement
Inventory 暫時不可用或 commit 結果不明時保留 SHIPPING 及 Correlation ID，由原事件查詢或續跑，不建立第二份結果。 （Legacy identity：`FR-CONF-015`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-015` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-062 — 永久業務驗證失敗時 Shipment 回到可修正的 DRAFT 或明確失敗結果；不得保留任何 Inventory／SO 成功效果

### Statement
永久業務驗證失敗時 Shipment 回到可修正的 DRAFT 或明確失敗結果；不得保留任何 Inventory／SO 成功效果。 （Legacy identity：`FR-CONF-016`；優先級：`Must`。）

### Acceptance criteria
`FR-CONF-016` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-063 — DRAFT Fulfillment 可取消；PICKING／PICKED 取消必須輸入原因

### Statement
DRAFT Fulfillment 可取消；PICKING／PICKED 取消必須輸入原因。 （Legacy identity：`FR-LIFE-001`；優先級：`Must`。）

### Acceptance criteria
`FR-LIFE-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-064 — PICKING／PICKED 如已有實際揀貨，使用者須先確認貨物已放回原 Bin／Lot 並輸入原因；成功釋放所有未消耗 Allocation 後才可顯示 CANCELLED

### Statement
PICKING／PICKED 如已有實際揀貨，使用者須先確認貨物已放回原 Bin／Lot 並輸入原因；成功釋放所有未消耗 Allocation 後才可顯示 CANCELLED。 （Legacy identity：`FR-LIFE-002`；優先級：`Must`。）

### Acceptance criteria
`FR-LIFE-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-065 — 有非 CANCELLED Shipment 的 Fulfillment 不可取消；須先處理 DRAFT Shipment

### Statement
有非 CANCELLED Shipment 的 Fulfillment 不可取消；須先處理 DRAFT Shipment。 （Legacy identity：`FR-LIFE-003`；優先級：`Must`。）

### Acceptance criteria
`FR-LIFE-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-066 — DRAFT Shipment 可取消，沒有 Inventory Issue 或 SO Fulfilled 效果；Fulfillment 返回 PICKED

### Statement
DRAFT Shipment 可取消，沒有 Inventory Issue 或 SO Fulfilled 效果；Fulfillment 返回 PICKED。 （Legacy identity：`FR-LIFE-004`；優先級：`Must`。）

### Acceptance criteria
`FR-LIFE-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-067 — SHIPPED Shipment 不可修改、刪除或一般取消

### Statement
SHIPPED Shipment 不可修改、刪除或一般取消。 （Legacy identity：`FR-LIFE-005`；優先級：`Must`。）

### Acceptance criteria
`FR-LIFE-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-068 — 只有具 `fulfillment.reverse` 的使用者可對 SHIPPED Shipment 建立整張 Reversal，且 Reason 必填

### Statement
只有具 `fulfillment.reverse` 的使用者可對 SHIPPED Shipment 建立整張 Reversal，且 Reason 必填。 （Legacy identity：`FR-REV-001`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-069 — 第一階段不接受部分行或部分數量 Reversal；需要更正時整張沖銷後重新履約

### Statement
第一階段不接受部分行或部分數量 Reversal；需要更正時整張沖銷後重新履約。 （Legacy identity：`FR-REV-002`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-070 — Reversal 前須確認貨物仍在公司控制並已放回原 Bin／Lot，並重驗 Shipment 未沖銷、父 SO／資料未歸檔、原 Issue 可反向及沒有已接入不可逆下游事項

### Statement
Reversal 前須確認貨物仍在公司控制並已放回原 Bin／Lot，並重驗 Shipment 未沖銷、父 SO／資料未歸檔、原 Issue 可反向及沒有已接入不可逆下游事項。 （Legacy identity：`FR-REV-003`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-071 — Reversal 進入 REVERSING；結果未明時不得顯示 REVERSED 或接受第二個 Reversal

### Statement
Reversal 進入 REVERSING；結果未明時不得顯示 REVERSED 或接受第二個 Reversal。 （Legacy identity：`FR-REV-004`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-072 — 成功 Reversal 須按原 Warehouse／Bin／Lot／Expiry／Status／Quantity 反向 Inventory Issue，不能讓使用者選另一位置

### Statement
成功 Reversal 須按原 Warehouse／Bin／Lot／Expiry／Status／Quantity 反向 Inventory Issue，不能讓使用者選另一位置。 （Legacy identity：`FR-REV-005`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-073 — 成功時恢復原消耗 Reservation、減少 SO Fulfilled、Shipment／Fulfillment 轉 REVERSED；原 Allocation 不自動重開

### Statement
成功時恢復原消耗 Reservation、減少 SO Fulfilled、Shipment／Fulfillment 轉 REVERSED；原 Allocation 不自動重開。 （Legacy identity：`FR-REV-006`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-074 — Reversal 後恢復數量回到 Fulfillment Queue，須建立新 Fulfillment 才可再次出貨

### Statement
Reversal 後恢復數量回到 Fulfillment Queue，須建立新 Fulfillment 才可再次出貨。 （Legacy identity：`FR-REV-007`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-075 — Inventory 回補、Reservation 恢復、SO 更新及狀態變化任一失敗時全部不得部分生效

### Statement
Inventory 回補、Reservation 恢復、SO 更新及狀態變化任一失敗時全部不得部分生效。 （Legacy identity：`FR-REV-008`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-076 — Reversal 具冪等性；同一事件重送返回既有結果，不重複回補或重複減少 SO Fulfilled

### Statement
Reversal 具冪等性；同一事件重送返回既有結果，不重複回補或重複減少 SO Fulfilled。 （Legacy identity：`FR-REV-009`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-077 — 同一 Event ID 配不同 Shipment、Reason 或 payload 時須拒絕衝突

### Statement
同一 Event ID 配不同 Shipment、Reason 或 payload 時須拒絕衝突。 （Legacy identity：`FR-REV-010`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-078 — Reversal 保存原 Shipment、Reason、Actor、Time、Event／Correlation、反向 Movement 及前後數量

### Statement
Reversal 保存原 Shipment、Reason、Actor、Time、Event／Correlation、反向 Movement 及前後數量。 （Legacy identity：`FR-REV-011`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-079 — 畫面須明確說明 Reversal 只更正錯誤操作；實際 Customer Return 不可由此處理

### Statement
畫面須明確說明 Reversal 只更正錯誤操作；實際 Customer Return 不可由此處理。 （Legacy identity：`FR-REV-012`；優先級：`Must`。）

### Acceptance criteria
`FR-REV-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-080 — 提供 My Recent Work、Fulfillment Queue、Active Fulfillments、Shipments、Exceptions 及 Finalized 常用視圖

### Statement
提供 My Recent Work、Fulfillment Queue、Active Fulfillments、Shipments、Exceptions 及 Finalized 常用視圖。 （Legacy identity：`FR-INQ-001`；優先級：`Must`。）

### Acceptance criteria
`FR-INQ-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-081 — Fulfillment 可按 Number、SO、Customer、Warehouse、Status、建立／揀貨日期及 Has Short Pick 篩選

### Statement
Fulfillment 可按 Number、SO、Customer、Warehouse、Status、建立／揀貨日期及 Has Short Pick 篩選。 （Legacy identity：`FR-INQ-002`；優先級：`Must`。）

### Acceptance criteria
`FR-INQ-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-082 — Shipment 可按 Number、SO、Customer、Warehouse、Status、Shipment Date、Carrier 及 Tracking Number 篩選

### Statement
Shipment 可按 Number、SO、Customer、Warehouse、Status、Shipment Date、Carrier 及 Tracking Number 篩選。 （Legacy identity：`FR-INQ-003`；優先級：`Must`。）

### Acceptance criteria
`FR-INQ-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-083 — 精確 Fulfillment／Shipment／SO／Tracking Number 查詢須直接定位，無須掃描全部歷史

### Statement
精確 Fulfillment／Shipment／SO／Tracking Number 查詢須直接定位，無須掃描全部歷史。 （Legacy identity：`FR-INQ-004`；優先級：`Must`。）

### Acceptance criteria
`FR-INQ-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-084 — Fulfillment 詳情顯示 SO、Lines、Planned／Allocated／Picked／Short／Shipped、Bin／Lot、History 及允許操作

### Statement
Fulfillment 詳情顯示 SO、Lines、Planned／Allocated／Picked／Short／Shipped、Bin／Lot、History 及允許操作。 （Legacy identity：`FR-INQ-005`；優先級：`Must`。）

### Acceptance criteria
`FR-INQ-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-085 — Shipment 詳情顯示 SO、Fulfillment、地址／Contact 快照、物流資料、Shipped／Reversed、Issue References、History 及允許操作

### Statement
Shipment 詳情顯示 SO、Fulfillment、地址／Contact 快照、物流資料、Shipped／Reversed、Issue References、History 及允許操作。 （Legacy identity：`FR-INQ-006`；優先級：`Must`。）

### Acceptance criteria
`FR-INQ-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-086 — 可由 SO、Fulfillment、Shipment、Inventory Movement 及 Reversal 互相追溯；無權頁面須安全拒絕

### Statement
可由 SO、Fulfillment、Shipment、Inventory Movement 及 Reversal 互相追溯；無權頁面須安全拒絕。 （Legacy identity：`FR-INQ-007`；優先級：`Must`。）

### Acceptance criteria
`FR-INQ-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-087 — PICKING Fulfillment 可產生 A4 browser print Pick List；資料須與當前 Allocation 一致

### Statement
PICKING Fulfillment 可產生 A4 browser print Pick List；資料須與當前 Allocation 一致。 （Legacy identity：`FR-DOC-001`；優先級：`Must`。）

### Acceptance criteria
`FR-DOC-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-088 — SHIPPED Shipment 可產生 A4 browser print Delivery Note／Packing List，至少顯示 Shipment、SO、Customer、Address Snapshot、SKU、Quantity 及選填物流資料

### Statement
SHIPPED Shipment 可產生 A4 browser print Delivery Note／Packing List，至少顯示 Shipment、SO、Customer、Address Snapshot、SKU、Quantity 及選填物流資料。 （Legacy identity：`FR-DOC-002`；優先級：`Must`。）

### Acceptance criteria
`FR-DOC-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-089 — Delivery Note／Packing List 不顯示 Unit Selling Price、Tax、成本、Customer 銀行資料或內部技術錯誤

### Statement
Delivery Note／Packing List 不顯示 Unit Selling Price、Tax、成本、Customer 銀行資料或內部技術錯誤。 （Legacy identity：`FR-DOC-003`；優先級：`Must`。）

### Acceptance criteria
`FR-DOC-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-090 — REVERSED Shipment 文件及詳情須清楚加上 REVERSED，不可作有效出貨文件使用

### Statement
REVERSED Shipment 文件及詳情須清楚加上 REVERSED，不可作有效出貨文件使用。 （Legacy identity：`FR-DOC-004`；優先級：`Must`。）

### Acceptance criteria
`FR-DOC-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-091 — 列表匯出套用相同權限及篩選，只輸出使用者可見資料

### Statement
列表匯出套用相同權限及篩選，只輸出使用者可見資料。 （Legacy identity：`FR-EXPORT-001`；優先級：`Must`。）

### Acceptance criteria
`FR-EXPORT-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-092 — 匯出至少包括單號、SO、Customer、Warehouse、Status、日期、SKU／數量摘要、Short Pick、Carrier 及 Tracking

### Statement
匯出至少包括單號、SO、Customer、Warehouse、Status、日期、SKU／數量摘要、Short Pick、Carrier 及 Tracking。 （Legacy identity：`FR-EXPORT-002`；優先級：`Must`。）

### Acceptance criteria
`FR-EXPORT-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-093 — 大型匯出使用背景工作並提供狀態及有限期下載，不得阻塞日常交易

### Statement
大型匯出使用背景工作並提供狀態及有限期下載，不得阻塞日常交易。 （Legacy identity：`FR-EXPORT-003`；優先級：`Must`。）

### Acceptance criteria
`FR-EXPORT-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-094 — 匯出採 UTF-8 及已公布格式；公式型文字須防 spreadsheet formula injection

### Statement
匯出採 UTF-8 及已公布格式；公式型文字須防 spreadsheet formula injection。 （Legacy identity：`FR-EXPORT-004`；優先級：`Must`。）

### Acceptance criteria
`FR-EXPORT-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-095 — 建立、修改、分配、重新分配、偏離建議、揀貨、短揀、取消、出貨、重試、Reversal、列印、匯出及歸檔均須 Audit

### Statement
建立、修改、分配、重新分配、偏離建議、揀貨、短揀、取消、出貨、重試、Reversal、列印、匯出及歸檔均須 Audit。 （Legacy identity：`FR-AUDIT-001`；優先級：`Must`。）

### Acceptance criteria
`FR-AUDIT-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-096 — 業務 History 對 `fulfillment.view` 可見；安全技術細節只供獲授權運維人員

### Statement
業務 History 對 `fulfillment.view` 可見；安全技術細節只供獲授權運維人員。 （Legacy identity：`FR-AUDIT-002`；優先級：`Must`。）

### Acceptance criteria
`FR-AUDIT-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-097 — Audit、已確認快照及已過帳 Issue／Reversal Reference 不可由一般使用者修改或刪除

### Statement
Audit、已確認快照及已過帳 Issue／Reversal Reference 不可由一般使用者修改或刪除。 （Legacy identity：`FR-AUDIT-003`；優先級：`Must`。）

### Acceptance criteria
`FR-AUDIT-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-098 — Fulfillment／Shipment 不另設獨立業務歸檔年期；與父 SO 使用相同 24 個月及至少 7 年保留政策

### Statement
Fulfillment／Shipment 不另設獨立業務歸檔年期；與父 SO 使用相同 24 個月及至少 7 年保留政策。 （Legacy identity：`FR-ARC-001`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-099 — 只有父 SO 符合歸檔條件，且所有相關 Fulfillment／Shipment 已為 CANCELLED、SHIPPED 或 REVERSED 等最終狀態，才可一併歸檔

### Statement
只有父 SO 符合歸檔條件，且所有相關 Fulfillment／Shipment 已為 CANCELLED、SHIPPED 或 REVERSED 等最終狀態，才可一併歸檔。 （Legacy identity：`FR-ARC-002`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-100 — PICKING、PICKED、SHIPPING、REVERSING、未完成 Allocation 或結果不明事件均阻止父 SO 歸檔

### Statement
PICKING、PICKED、SHIPPING、REVERSING、未完成 Allocation 或結果不明事件均阻止父 SO 歸檔。 （Legacy identity：`FR-ARC-003`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-101 — Fulfillment／Shipment Headers、Lines、Allocation／Issue references、Address／Contact snapshots、History、Reversal 及必要 Audit 須一併歸檔

### Statement
Fulfillment／Shipment Headers、Lines、Allocation／Issue references、Address／Contact snapshots、History、Reversal 及必要 Audit 須一併歸檔。 （Legacy identity：`FR-ARC-004`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-102 — 先完成 Archive 寫入及完整性校驗，才可從 Active 移除；不得留下父 SO 已歸檔但 Shipment 遺失或反之

### Statement
先完成 Archive 寫入及完整性校驗，才可從 Active 移除；不得留下父 SO 已歸檔但 Shipment 遺失或反之。 （Legacy identity：`FR-ARC-005`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-103 — Archive 資料唯讀，不可修改、取消、出貨或 Reversal；更正須走另行批准的正式流程

### Statement
Archive 資料唯讀，不可修改、取消、出貨或 Reversal；更正須走另行批准的正式流程。 （Legacy identity：`FR-ARC-006`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-104 — 可按 Fulfillment／Shipment／SO Number、Customer、Tracking、Warehouse、Status 及最多 366 日範圍查詢 Archive

### Statement
可按 Fulfillment／Shipment／SO Number、Customer、Tracking、Warehouse、Status 及最多 366 日範圍查詢 Archive。 （Legacy identity：`FR-ARC-007`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-105 — 歸檔後各單號及來源連結須路由至唯一 Active 或 Archive 記錄，不得重複或假裝遺失

### Statement
歸檔後各單號及來源連結須路由至唯一 Active 或 Archive 記錄，不得重複或假裝遺失。 （Legacy identity：`FR-ARC-008`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-106 — 歸檔中斷或重跑不得重複資料；校驗失敗時 Active 原資料完整保留並有錯誤

### Statement
歸檔中斷或重跑不得重複資料；校驗失敗時 Active 原資料完整保留並有錯誤。 （Legacy identity：`FR-ARC-009`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## FR-107 — Archive 暫時不可用不得阻止 Queue、揀貨、出貨及 Active 查詢；Archive 頁顯示不可用而非零結果

### Statement
Archive 暫時不可用不得阻止 Queue、揀貨、出貨及 Active 查詢；Archive 頁顯示不可用而非零結果。 （Legacy identity：`FR-ARC-010`；優先級：`Must`。）

### Acceptance criteria
`FR-ARC-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
非法、未授權、過時、衝突或不完整的輸入不得產生部分 Fulfillment、部分 Allocation、部分 Pick、部分 Shipment、部分 Inventory Issue 或部分 Sales Fulfilled 效果；呼叫方取得穩定且可行動的業務結果及下一步，必要的 Audit 證據保留且不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

## NFR-001 — 容量基線承接每日約 10,000 張 SO；24 個月最少以 730 萬張 Fulfillment 及 730 萬張 Shipment 驗證，並另以真實分批出貨比例建立較高容量場景

### Statement
容量基線承接每日約 10,000 張 SO；24 個月最少以 730 萬張 Fulfillment 及 730 萬張 Shipment 驗證，並另以真實分批出貨比例建立較高容量場景。 （Legacy identity：`NFR-PERF-001`；來源：需求書 §13.1；優先級：`Must`。）

### Acceptance criteria
`NFR-PERF-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-002 — 在正常業務負載及完整 Active 容量下，Queue、Active List 及精確單號查詢 P95 不超過 2 秒

### Statement
在正常業務負載及完整 Active 容量下，Queue、Active List 及精確單號查詢 P95 不超過 2 秒。 （Legacy identity：`NFR-PERF-002`；來源：需求書 §13.1；優先級：`Must`。）

### Acceptance criteria
`NFR-PERF-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-003 — 最多 100 行的 Allocation、Pick Confirm、Shipment Confirm 及 Reversal，在依賴正常時 P95 不超過 3 秒；若採背景處理須在 3 秒內返回可追蹤狀態

### Statement
最多 100 行的 Allocation、Pick Confirm、Shipment Confirm 及 Reversal，在依賴正常時 P95 不超過 3 秒；若採背景處理須在 3 秒內返回可追蹤狀態。 （Legacy identity：`NFR-PERF-003`；來源：需求書 §13.1；優先級：`Must`。）

### Acceptance criteria
`NFR-PERF-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-004 — 系統須支援至少 50 名互動使用者同時查詢、建立工作、揀貨及確認出貨，並與 Sales Import、Backorder、Export 及 Archive 工作共存

### Statement
系統須支援至少 50 名互動使用者同時查詢、建立工作、揀貨及確認出貨，並與 Sales Import、Backorder、Export 及 Archive 工作共存。 （Legacy identity：`NFR-PERF-004`；來源：需求書 §13.1；優先級：`Must`。）

### Acceptance criteria
`NFR-PERF-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-005 — Archive 精確 Fulfillment／Shipment／SO／Tracking 查詢 P95 不超過 3 秒；Customer＋最多 366 日查詢 P95 不超過 5 秒

### Statement
Archive 精確 Fulfillment／Shipment／SO／Tracking 查詢 P95 不超過 3 秒；Customer＋最多 366 日查詢 P95 不超過 5 秒。 （Legacy identity：`NFR-PERF-005`；來源：需求書 §13.1；優先級：`Must`。）

### Acceptance criteria
`NFR-PERF-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-006 — 大型匯出及歸檔使用 bounded background processing，不把全部結果載入記憶體或長時間鎖定日常交易

### Statement
大型匯出及歸檔使用 bounded background processing，不把全部結果載入記憶體或長時間鎖定日常交易。 （Legacy identity：`NFR-PERF-006`；來源：需求書 §13.1；優先級：`Must`。）

### Acceptance criteria
`NFR-PERF-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-007 — Pick List 及 Delivery Note／Packing List 的 100 行 browser print 預覽在正常負載下 P95 不超過 3 秒

### Statement
Pick List 及 Delivery Note／Packing List 的 100 行 browser print 預覽在正常負載下 P95 不超過 3 秒。 （Legacy identity：`NFR-PERF-007`；來源：需求書 §13.1；優先級：`Must`。）

### Acceptance criteria
`NFR-PERF-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-008 — Allocation、Release、Pick Confirm、Shipment Confirm、Reversal 及取消均須具冪等性

### Statement
Allocation、Release、Pick Confirm、Shipment Confirm、Reversal 及取消均須具冪等性。 （Legacy identity：`§13.2 第1項（13.2 一致性、冪等及恢復）`；來源：需求書 §13.2；優先級：`Must`。）

### Acceptance criteria
`§13.2 第1項（13.2 一致性、冪等及恢復）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-009 — 不得出現 Shipment 顯示 SHIPPED 但 Inventory 未 Issue，或 Inventory 已 Issue 而 SO Fulfilled 未更新且無法恢復的狀態

### Statement
不得出現 Shipment 顯示 SHIPPED 但 Inventory 未 Issue，或 Inventory 已 Issue 而 SO Fulfilled 未更新且無法恢復的狀態。 （Legacy identity：`§13.2 第2項（13.2 一致性、冪等及恢復）`；來源：需求書 §13.2；優先級：`Must`。）

### Acceptance criteria
`§13.2 第2項（13.2 一致性、冪等及恢復）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-010 — 結果不明時保留可恢復狀態、原 Event／Correlation、lease／重試資訊；不能以新事件盲目重做

### Statement
結果不明時保留可恢復狀態、原 Event／Correlation、lease／重試資訊；不能以新事件盲目重做。 （Legacy identity：`§13.2 第3項（13.2 一致性、冪等及恢復）`；來源：需求書 §13.2；優先級：`Must`。）

### Acceptance criteria
`§13.2 第3項（13.2 一致性、冪等及恢復）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-011 — 跨模組永久驗證失敗不得留下部分結果；暫時技術失敗須可安全續跑

### Statement
跨模組永久驗證失敗不得留下部分結果；暫時技術失敗須可安全續跑。 （Legacy identity：`§13.2 第4項（13.2 一致性、冪等及恢復）`；來源：需求書 §13.2；優先級：`Must`。）

### Acceptance criteria
`§13.2 第4項（13.2 一致性、冪等及恢復）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-012 — Fulfillment 與 Inventory 定期 reconciliation 須能找出數量、狀態、source reference 或重複事件差異

### Statement
Fulfillment 與 Inventory 定期 reconciliation 須能找出數量、狀態、source reference 或重複事件差異。 （Legacy identity：`§13.2 第5項（13.2 一致性、冪等及恢復）`；來源：需求書 §13.2；優先級：`Must`。）

### Acceptance criteria
`§13.2 第5項（13.2 一致性、冪等及恢復）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-013 — Archive、Export、列印或非必要查詢故障不得阻止 Queue、揀貨及確認出貨

### Statement
Archive、Export、列印或非必要查詢故障不得阻止 Queue、揀貨及確認出貨。 （Legacy identity：`§13.3 第1項（13.3 可用性及營運）`；來源：需求書 §13.3；優先級：`Must`。）

### Acceptance criteria
`§13.3 第1項（13.3 可用性及營運）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-014 — Customer 或 Inventory 暫時不可用時不得使用過時資料假裝成功；顯示依賴不可用及 Correlation ID

### Statement
Customer 或 Inventory 暫時不可用時不得使用過時資料假裝成功；顯示依賴不可用及 Correlation ID。 （Legacy identity：`§13.3 第2項（13.3 可用性及營運）`；來源：需求書 §13.3；優先級：`Must`。）

### Acceptance criteria
`§13.3 第2項（13.3 可用性及營運）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-015 — 背景工作重啟後可安全續跑；已完成工作不重複

### Statement
背景工作重啟後可安全續跑；已完成工作不重複。 （Legacy identity：`§13.3 第3項（13.3 可用性及營運）`；來源：需求書 §13.3；優先級：`Must`。）

### Acceptance criteria
`§13.3 第3項（13.3 可用性及營運）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-016 — Active／Archive、SO／Shipment／Inventory 的備份、還原及完整性驗證納入營運演練

### Statement
Active／Archive、SO／Shipment／Inventory 的備份、還原及完整性驗證納入營運演練。 （Legacy identity：`§13.3 第4項（13.3 可用性及營運）`；來源：需求書 §13.3；優先級：`Must`。）

### Acceptance criteria
`§13.3 第4項（13.3 可用性及營運）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-017 — 使用者可分辨業務驗證錯誤、版本衝突、暫時依賴故障及結果不明，並取得具體下一步

### Statement
使用者可分辨業務驗證錯誤、版本衝突、暫時依賴故障及結果不明，並取得具體下一步。 （Legacy identity：`§13.3 第5項（13.3 可用性及營運）`；來源：需求書 §13.3；優先級：`Must`。）

### Acceptance criteria
`§13.3 第5項（13.3 可用性及營運）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-018 — 指標至少包括 Queue Depth、建立／揀貨／出貨數量、Short Pick Rate、FEFO／FIFO 例外、確認耗時、Issue／Reversal 失敗、SHIPPING／REVERSING 積壓及 Archive 成功／失敗

### Statement
指標至少包括 Queue Depth、建立／揀貨／出貨數量、Short Pick Rate、FEFO／FIFO 例外、確認耗時、Issue／Reversal 失敗、SHIPPING／REVERSING 積壓及 Archive 成功／失敗。 （Legacy identity：`§13.4 第1項（13.4 可觀測性）`；來源：需求書 §13.4；優先級：`Must`。）

### Acceptance criteria
`§13.4 第1項（13.4 可觀測性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-019 — Log 使用安全的 Request、Correlation、Event、SO、Fulfillment、Shipment 及 Movement 識別

### Statement
Log 使用安全的 Request、Correlation、Event、SO、Fulfillment、Shipment 及 Movement 識別。 （Legacy identity：`§13.4 第2項（13.4 可觀測性）`；來源：需求書 §13.4；優先級：`Must`。）

### Acceptance criteria
`§13.4 第2項（13.4 可觀測性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-020 — 不在 Log 記錄完整地址 payload、銀行資料、Token、密碼或無必要個人資料

### Statement
不在 Log 記錄完整地址 payload、銀行資料、Token、密碼或無必要個人資料。 （Legacy identity：`§13.4 第3項（13.4 可觀測性）`；來源：需求書 §13.4；優先級：`Must`。）

### Acceptance criteria
`§13.4 第3項（13.4 可觀測性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-021 — 持續積壓、重試異常、重複事件衝突、reconciliation 差異及歸檔失敗須有運維告警

### Statement
持續積壓、重試異常、重複事件衝突、reconciliation 差異及歸檔失敗須有運維告警。 （Legacy identity：`§13.4 第4項（13.4 可觀測性）`；來源：需求書 §13.4；優先級：`Must`。）

### Acceptance criteria
`§13.4 第4項（13.4 可觀測性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-022 — Fulfillment 不複製 Inventory 的資格、FEFO／FIFO 或結餘算法；透過正式契約取得結果

### Statement
Fulfillment 不複製 Inventory 的資格、FEFO／FIFO 或結餘算法；透過正式契約取得結果。 （Legacy identity：`§13.5 第1項（13.5 可維護性及相容性）`；來源：需求書 §13.5；優先級：`Must`。）

### Acceptance criteria
`§13.5 第1項（13.5 可維護性及相容性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-023 — Sales、Customer、Item、Inventory 契約版本化；破壞性改動須有遷移及兼容計劃

### Statement
Sales、Customer、Item、Inventory 契約版本化；破壞性改動須有遷移及兼容計劃。 （Legacy identity：`§13.5 第2項（13.5 可維護性及相容性）`；來源：需求書 §13.5；優先級：`Must`。）

### Acceptance criteria
`§13.5 第2項（13.5 可維護性及相容性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-024 — 日期／時間按 APP_TIME_ZONE 顯示；交換格式不得有時區歧義

### Statement
日期／時間按 APP_TIME_ZONE 顯示；交換格式不得有時區歧義。 （Legacy identity：`§13.5 第3項（13.5 可維護性及相容性）`；來源：需求書 §13.5；優先級：`Must`。）

### Acceptance criteria
`§13.5 第3項（13.5 可維護性及相容性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-025 — 數量使用精確數值，不以浮點近似；第一階段只接受 Base UOM 整數

### Statement
數量使用精確數值，不以浮點近似；第一階段只接受 Base UOM 整數。 （Legacy identity：`§13.5 第4項（13.5 可維護性及相容性）`；來源：需求書 §13.5；優先級：`Must`。）

### Acceptance criteria
`§13.5 第4項（13.5 可維護性及相容性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## NFR-026 — 使用專案正式支援的桌面瀏覽器，並遵循 `docs/frontend-design.md`

### Statement
使用專案正式支援的桌面瀏覽器，並遵循 `docs/frontend-design.md`。 （Legacy identity：`§13.5 第5項（13.5 可維護性及相容性）`；來源：需求書 §13.5；優先級：`Must`。）

### Acceptance criteria
`§13.5 第5項（13.5 可維護性及相容性）` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
未達已批准門檻、量測基線不符、依賴故障未被隔離或恢復路徑不可用時，相關 Gate 記為 BLOCKED／NOT_READY，不得以縮小資料集、關閉檢查或忽略差異當作通過；降級行為須可被使用者及營運人員辨識並有具體下一步。

## SEC-001 — 所有頁面及 API 預設拒絕未登入使用者

### Statement
所有頁面及 API 預設拒絕未登入使用者。 （Legacy identity：`SEC-001`；優先級：`Must`。）

### Acceptance criteria
`SEC-001` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-002 — `fulfillment.view` 只允許查閱及獲准匯出，不可建立、揀貨、出貨或 Reversal

### Statement
`fulfillment.view` 只允許查閱及獲准匯出，不可建立、揀貨、出貨或 Reversal。 （Legacy identity：`SEC-002`；優先級：`Must`。）

### Acceptance criteria
`SEC-002` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-003 — `fulfillment.operation` 不包含 Reversal 或 FEFO 例外；偏離 FIFO 可由具該權限的使用者在填寫原因後執行

### Statement
`fulfillment.operation` 不包含 Reversal 或 FEFO 例外；偏離 FIFO 可由具該權限的使用者在填寫原因後執行。 （Legacy identity：`SEC-003`；優先級：`Must`。）

### Acceptance criteria
`SEC-003` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-004 — `fulfillment.reverse` 不包含一般操作；組合能力須明確授權

### Statement
`fulfillment.reverse` 不包含一般操作；組合能力須明確授權。 （Legacy identity：`SEC-004`；優先級：`Must`。）

### Acceptance criteria
`SEC-004` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-005 — 後端防止水平及垂直越權；替換 SO、Fulfillment、Line、Shipment、Address、Allocation、Movement 或 Reversal ID 不得跨 aggregate／Customer／Warehouse

### Statement
後端防止水平及垂直越權；替換 SO、Fulfillment、Line、Shipment、Address、Allocation、Movement 或 Reversal ID 不得跨 aggregate／Customer／Warehouse。 （Legacy identity：`SEC-005`；優先級：`Must`。）

### Acceptance criteria
`SEC-005` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-006 — 提交時重驗使用者 Active 狀態及權限；撤權後的舊頁面不得成功

### Statement
提交時重驗使用者 Active 狀態及權限；撤權後的舊頁面不得成功。 （Legacy identity：`SEC-006`；優先級：`Must`。）

### Acceptance criteria
`SEC-006` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-007 — 所有文字、sort、filter、identifier 及數值經 allowlist／schema 驗證及 parameterized access

### Statement
所有文字、sort、filter、identifier 及數值經 allowlist／schema 驗證及 parameterized access。 （Legacy identity：`SEC-007`；優先級：`Must`。）

### Acceptance criteria
`SEC-007` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-008 — Notes、Reason、Carrier、Tracking、Address／Contact text 及 CSV 視為不可信資料，不得執行 script、HTML 或 spreadsheet formula

### Statement
Notes、Reason、Carrier、Tracking、Address／Contact text 及 CSV 視為不可信資料，不得執行 script、HTML 或 spreadsheet formula。 （Legacy identity：`SEC-008`；優先級：`Must`。）

### Acceptance criteria
`SEC-008` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-009 — 一般錯誤不洩漏 SQL、stack、內部路徑、其他 Customer／Warehouse 資料或記錄存在性

### Statement
一般錯誤不洩漏 SQL、stack、內部路徑、其他 Customer／Warehouse 資料或記錄存在性。 （Legacy identity：`SEC-009`；優先級：`Must`。）

### Acceptance criteria
`SEC-009` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-010 — Log／Audit 不保存密碼、Token、Customer 銀行資料或不必要地址完整 payload；地址快照只保存履約必要內容

### Statement
Log／Audit 不保存密碼、Token、Customer 銀行資料或不必要地址完整 payload；地址快照只保存履約必要內容。 （Legacy identity：`SEC-010`；優先級：`Must`。）

### Acceptance criteria
`SEC-010` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-011 — 列印及下載使用 no-store／private 等效保護、安全 filename 及內容類型

### Statement
列印及下載使用 no-store／private 等效保護、安全 filename 及內容類型。 （Legacy identity：`SEC-011`；優先級：`Must`。）

### Acceptance criteria
`SEC-011` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

## SEC-012 — Reversal、FEFO／FIFO 例外、取消、出貨及大量匯出須記錄 Actor、Reason／Filter、Time、Correlation 及 Result

### Statement
Reversal、FEFO／FIFO 例外、取消、出貨及大量匯出須記錄 Actor、Reason／Filter、Time、Correlation 及 Result。 （Legacy identity：`SEC-012`；優先級：`Must`。）

### Acceptance criteria
`SEC-012` 所述的可觀察結果在已批准基線上成立，並由每一條對應的 mandatory 技術測試及 UAT 案例驗證通過。缺少測試、零發現案例、被 skip 的案例或過時證據一律視為未通過。

### Failure behavior
授權或驗證失敗一律 fail closed，回 401／403／404 或等效安全拒絕，零業務變更；錯誤不洩漏記錄存在性、其他 Customer／Warehouse 資料、Customer 銀行資料、Token、SQL、stack 或內部路徑。

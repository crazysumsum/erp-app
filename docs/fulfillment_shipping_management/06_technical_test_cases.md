# Fulfillment & Shipping Management Technical Test Specification

## Status and execution boundary

所有案例均為規格，狀態一律 `NOT_RUN`。`REVIEW_AND_ALIGN` 不授權任何產品實作、測試執行、Technical Acceptance 或 UAT 簽核。本規格由 `03_design_spec.md` §11（測試設計）及 `05_development_tasks.md` §7（Phase 完整測試週期）整理而成，作為 `08_traceability.json` 的 `TC` 節點；§11 與 §7 的逐項測試清單仍是細節來源。實際執行必須綁定不可變基線，並在 `TEST_AND_VERIFY` 模式下進行。

所有案例的 suite 為 `fulfillment-technical`，在專案的隔離測試環境及專用測試 MySQL 8.0 執行。`TC-010` 的瀏覽器層驗證目前沒有可用的 Playwright 工具鏈，該缺口記錄於 `00_gap_analysis.md` `GAP-TC-001`，必須在 `PHASE-002` 開放前解決，不得以程式碼檢視或 jsdom 結果偽裝瀏覽器證據。


## 案例索引

| TC | 名稱 | 主要設計來源 |
| --- | --- | --- |
| TC-001 | Authentication、授權、最小權限與 IDOR | DES-011（§7）、DES-010（§5）；設計 §11.6 |
| TC-002 | 狀態機、數量守恆與 canonical payload hash 純規則 | DES-008（§3.1、§3.3）、DES-002（§3.4）、DES-007（§2.9）；設計 §11.1 |
| TC-003 | Queue 投影、Reservation Claim 競爭與 overclaim 防護 | DES-002（§2.3、§3.4、§8.1～§8.2）、DES-009（§4.3～§4.5）；設計 §11.2 |
| TC-004 | Allocation、FEFO／FIFO 序列與例外控制 | DES-003（§2.4、§3.5、§8.3）、DES-001（§6.2）；設計 §11.1～§11.2、§11.4 |
| TC-005 | Pick Confirm、Short Pick、Reallocation 與取消釋放 | DES-003（§2.4、§8.4）、DES-002（§8.2）、DES-008（§3.1）；設計 §11.2 |
| TC-006 | Shipment Draft、唯一有效 Shipment 與地址／Contact 重驗 | DES-004（§2.5、§3.7、§8.5）、DES-001（§6.3）、DES-009（§4.8～§4.9）；設計 §11.2～§11.4 |
| TC-007 | Shipment Confirm 兩階段原子性、冪等與 commit-unknown 恢復 | DES-005（§2.6、§8.6）、DES-007（§2.8～§2.9）、DES-001（§6.1～§6.4）；設計 §11.2 |
| TC-008 | Shipment Reversal 不變量、原 bucket 回補與 SO 重開 | DES-006（§2.7、§3.2、§3.6、§8.7）、DES-001（§6.2、§6.5）；設計 §11.2 |
| TC-009 | Migration、約束、trigger 與不可變保護 | DES-009（§4、§9.3）、DES-008（§3.3）；設計 §11.2 |
| TC-010 | API 契約、Provider／Consumer 契約與前端行為 | DES-010（§5）、DES-013（§9.4、§10）、DES-001（§6）；設計 §11.3～§11.5 |
| TC-011 | 查詢、列印投影、Export、Audit 與 Archive 一致性 | DES-012（§4.15～§4.17、§5.5、§6.5、§8.9～§8.10）、DES-011（§7.4）；設計 §11.2、§11.8 |
| TC-012 | 效能、容量、備份還原與 Reconciliation | DES-014（§11.7～§11.8、§12）、DES-009（§4 indexes）、DES-012（§8.11）；設計 §11.7～§11.8、§12 |

## Formal definitions

## TC-001 — Authentication、授權、最小權限與 IDOR

### Preconditions and data
九個 UAT 角色對應的測試帳戶（只讀、無權限、System Administrator、已撤權、FEFO 例外、Reversal 專責），兩個 Customer 與兩個 Warehouse 的完整 SO → Fulfillment → Shipment → Movement 樹，以及惡意邊界輸入，全部在隔離測試環境的測試 MySQL 8.0。

### Steps
驗證未登入拒絕、權限不因角色名稱取得、三項 Fulfillment 權限與 `inventory.fefo.override` 互不包含、提交點 actor freshness 重驗、替換 SO／Line／Claim／Allocation／Shipment／Address／Movement／Archive ID 的水平與垂直越權、strict schema 拒絕未知欄位、注入／XSS／CSV 公式 payload，以及專用 Inventory Reversal command 沒有 HTTP 入口。

### Expected result
所有未授權或非法路徑 fail closed 並回穩定安全錯誤，沒有任何 Fulfillment、Claim、Allocation、Shipment、Inventory 或 Sales 狀態變更；not found 與 not visible 對外統一 404；Audit 保留足夠調查證據但不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-002 — 狀態機、數量守恆與 canonical payload hash 純規則

### Preconditions and data
不讀 DB 的純函式測試夾具：全部合法與非法 Fulfillment／Shipment／Reversal 轉換、各狀態應有的數量組合、邊界值（0、上限、非整數、負數）及固定 key 排序的 canonical payload 樣本。

### Steps
逐一驗證 §3.1～§3.4 的狀態轉換表、`planned = picked + short`、`allocated = picked + released`、`shipped ∈ (0, picked)`、`reversed ∈ (0, shipped)`、Claim 的 `original = active + released + consumed` 與 `reversed <= consumed`，以及 canonical hash 的 key 排序、decimal normalization 及 UTF-8 bytes 穩定性。

### Expected result
每個狀態轉換、數量不變量及 hash 分支至少一正一反全部符合規格；Base UOM 數量一律正整數且不出現 binary float 誤差；同內容不同欄位順序的 payload 得到相同 hash，內容不同必得到不同 hash。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-003 — Queue 投影、Reservation Claim 競爭與 overclaim 防護

### Preconditions and data
真 MySQL 測試庫、兩條以上真資料庫連線、CONFIRMED 與 PARTIALLY_FULFILLED SO、純 Backorder SO、混合 Reserved／Backorder SO，以及同一 Reservation 上的兩個並發建立者。

### Steps
驗證 Queue 只顯示 fulfillable > 0 的 SO、`fulfillable = reservation outstanding - active claim sum`、穩定排序與 keyset 分頁；以真 barrier 令兩名使用者同時建立工作；重送相同 create event；在頁面載入後改變 SO version 或 Reservation 再提交；建立後核對 SO 與 Inventory 數量。

### Expected result
同一 Reservation 的 active claim 總和永不超過 Inventory outstanding，最多一名競爭者成功，另一人取得可理解的 quantity／version 衝突；重送返回原 Fulfillment 且不重複佔量；建立動作不改變 SO Ordered／Fulfilled／Backorder 或 Inventory On Hand；任何負值 fulfillable 視為 critical 失敗而非 0。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-004 — Allocation、FEFO／FIFO 序列與例外控制

### Preconditions and data
同一 SKU 的三個合資格 Expiry Lot（分佈於多個 Bin）、兩批無 Expiry 庫存、混合 Expiry 與無 Expiry 的候選集合，以及 Expired、低於 Minimum Sale Life、Quarantined、Damaged、Inactive Bin、Counting Bin、錯 Warehouse 及數量不足的資料組；具與不具 `inventory.fefo.override` 的 actor。

### Steps
驗證候選排序（有 Expiry 先 FEFO，其後無 Expiry 按 FIFO，含穩定 Lot／Bin tie-break）、一行跨多個 Bin／Lot 的完整 Allocation、整批全有或全無、FIFO 偏離的原因必填、FEFO 偏離的專門權限、候選在提交前失效，以及 Inventory 回傳 line set 與 request 完全相等的契約驗證。

### Expected result
不合資格庫存在任何權限下均被拒絕；缺原因或缺權限時不保存任何例外 Allocation；任一行不足時整批 rollback 且 Fulfillment 留在 DRAFT；成功 Allocation 後 On Hand、Reservation consumed 及 SO Fulfilled 不變；偏離時 Audit 同時保存系統建議、實選、strategy、rank、actor、reason 及 Inventory reference。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-005 — Pick Confirm、Short Pick、Reallocation 與取消釋放

### Preconditions and data
PICKING 狀態且具多筆 Allocation 的 Fulfillment、可控制的並發提交者、穩定 event ID 與同 ID 異 payload 版本，以及會在提交前失效的重新分配候選。

### Steps
驗證實際 picked 等於／小於／等於 0 的組合、短揀原因必填、全 0 拒絕、遺漏 Allocation ID 視為 input invalid、重送與異 payload 衝突、PICKED 後不可直接修改、原子 Reallocation（同 transaction 先 release 後 create）中途失敗，以及 DRAFT／PICKING／PICKED 取消時的 Allocation release 與 Claim 轉換。

### Expected result
短揀差額釋放本次 Allocation 並令 Claim active 減少、released 增加，原 Reservation outstanding 不被釋放且 On Hand 不變，差額即時回到 Queue；重送不累加 picked 或重複 release；Reallocation 失敗時舊 Allocation 完整保留，沒有空窗或部分新 Allocation；取消 release 失敗時狀態不變並可由原 event 安全重試。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-006 — Shipment Draft、唯一有效 Shipment 與地址／Contact 重驗

### Preconditions and data
PICKED 與非 PICKED 各狀態的 Fulfillment、具默認及其他 Active Shipping Address 的 Customer、沒有有效地址的 Customer、另一 Customer 的地址、已停用或已移除 shipping 用途的地址，以及具已知 version 的 Shipping Contact。

### Steps
驗證只可由 PICKED 建立 Shipment、generated column 與 unique index 在並發下保證最多一張非 CANCELLED Shipment、取消 Draft 後可重建、Draft 只保存 child IDs 與 versions、Draft 可改地址／Contact／物流欄位但不可改 Lines 或 quantity、選填欄位的配對驗證，以及 Customer provider 的 `assertAddressUsableInTransaction()` 契約。

### Expected result
跨 Customer 或非 shipping 用途地址一律拒絕且不自動替代；沒有有效地址時可停在 PICKED 但不可確認出貨；重複 create 事件 replay 原結果，不建立第二張有效 Shipment；DRAFT 階段 SO Fulfilled 與 Inventory On Hand 不變；地址文字快照在 Confirm 成功前不保存。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-007 — Shipment Confirm 兩階段原子性、冪等與 commit-unknown 恢復

### Preconditions and data
最多 100 行、跨多個 Bin／Lot 的合法 DRAFT Shipment，穩定 event ID 及同 ID 同／異 payload 版本，可在 Inventory、Sales、快照保存及 COMMIT 各邊界注入失敗的測試替身，可控制的 worker 重啟與回應遺失，以及與 Confirm 並發的 Cancel／Reallocate／Inventory adjustment。

### Steps
執行成功確認、雙擊與重送、異 payload 衝突、逾時後以原 event 安全重試、Phase A 後 process crash 再由 Recovery Job 以原 event 完成，以及在各邊界注入永久業務失敗與暫時技術失敗。

### Expected result
一個 source event 最多產生一次完整效果；Issue line 集合與全部 picked Allocation 集合完全相等；永久業務失敗令 Shipment 回 DRAFT 且零 Inventory／Sales 效果；技術不明保留 SHIPPING 並可由原 event 查回唯一結果，不出現顯示 SHIPPED 而 Inventory 未 Issue 的假成功；成功時 On Hand、Reservation consumed、SO Fulfilled 與 Shipment／Fulfillment 狀態在同一 commit 內一致。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-008 — Shipment Reversal 不變量、原 bucket 回補與 SO 重開

### Preconditions and data
已確認 Shipment 及其全部 Issue details 與 Inventory Movement、原 Bin 已停用或正在 Counting 的情境、已被反向的 Movement、COMPLETED 與未歸檔 CLOSED 的父 SO、已註冊與未註冊的 Downstream Matter provider，以及具與不具 `fulfillment.reverse` 的 actor。

### Steps
驗證整張 Reversal 成功路徑、部分沖銷請求被拒、原 bucket 不可用時整批 rollback、Downstream Matter 為 OPEN 或 UNKNOWN 時阻擋、Sales 依 §3.6 重算與 CLOSED 重開、重送與異 payload，以及每個原 Issue 最多一個 reversal movement 的唯一性約束。

### Expected result
成功時按原 Warehouse／Bin／Lot／Expiry／Status／Quantity 回補、原 Reservation `consumed` 減少且 `outstanding` 增加、原 Allocation 保持 CONSUMED 不重開、SO Fulfilled 減少而 Ordered 與 Cancelled 不變；任一步失敗時不存在部分回補或虛假 REVERSED；重送返回既有結果不重複回補；恢復數量須以新 Fulfillment 才可再次出貨。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-009 — Migration、約束、trigger 與不可變保護

### Preconditions and data
專用測試 MySQL 8.0 資料庫、空 schema 與已有資料的 schema、最新 pre-feature schema，以及對 History、Issue details、Reversal details 與 Archive tables 嘗試 UPDATE／DELETE 的語句。

### Steps
在真資料庫依 §9.3 的八個切片 forward migrate、重跑及 upgrade；驗證 FK、UNIQUE、NOT NULL、generated column、index、circular composite FK 的建立次序、數量與狀態 trigger、append-only 保護、`reversal_movement_id` 只可 NULL→value，以及 7 年保留設計與 rollback 影響。

### Expected result
所有 migration 可在 MySQL 8.0 順序執行且可重跑；不可變歷史無法由一般路徑改寫；約束在應用層失效時仍構成第二層防護；跨模組 FK 在依賴 table 未存在時明確 BLOCKED 而非以無 FK 的 service guard 通過。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-010 — API 契約、Provider／Consumer 契約與前端行為

### Preconditions and data
全部 route 的授權、schema 與分頁夾具；Sales、Inventory、Customer、Item 四個 provider 的真實實作或明確 BLOCKED 記錄；具 375／768／1024／1440 px 的前端測試環境；以及會回缺 line、重複、數量錯誤、owner 錯誤或未知欄位的 provider 替身。

### Steps
驗證每個 route 的 auth、permission、strict schema、response schema、分頁與穩定錯誤；state-changing endpoint 真正遵守 `Idempotency-Key`；IN_PROGRESS 回 202＋status URL；literal route 不被 `/:id` 攔截；print／download header、安全 filename 與 owner check；provider projection 欄位、狀態、version 與 confirm／reverse result 完全匹配；以及 route permission、URL state、衝突保留輸入、processing banner 不建立新 event、鍵盤可達性、heading 結構、`aria-busy` 與文字狀態 badge。

### Expected result
契約語意與雙方設計一致，provider 能力未落地時契約測試明確 BLOCKED 而非 PASS；provider 回傳異常時 fail closed 並發出 critical 訊號；前端 `allowedActions` 不取代 route authorization；瀏覽器層行為以實際瀏覽器自動化驗證，工具未具備時記為 BLOCKED，不得以程式碼檢視或 jsdom 結果偽裝瀏覽器證據。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-011 — 查詢、列印投影、Export、Audit 與 Archive 一致性

### Preconditions and data
跨 Phase 的 Fulfillment／Shipment／Reversal 資料、TEXT-RISK 文字、已停用的 Customer／SKU／Address、符合與不符合歸檔條件的父 SO、可中斷的 Archive Job，以及 Archive 暫時不可用的情境。

### Steps
驗證常用視圖與 filter 語意、精確單號定位、雙向追溯、A4 Pick List 與 Delivery Note 投影使用快照且 REVERSED 明確標示、CSV 欄位穩定性與公式注入防護、owner-safe 背景 Export 與有限期下載、Audit 不可由一般使用者修改、Archive aggregate 原子搬移與逐 table count／hash 校驗、中斷重跑、same hash recovery 與 hash 衝突，以及 Archive 不可用時 Active 操作不受阻。

### Expected result
Web、CSV、列印與整合四個輸出面得到同一組 server 正本數值；主檔後續變更不改寫歷史文件；父 SO 與全部 Fulfillment／Shipment 只會同處 Active 或 Archive；校驗失敗時 Active 原資料完整保留並有明確錯誤，不以 `INSERT IGNORE` 掩蓋；CSV 與 Audit 不含地址完整 payload、銀行資料、Token、SQL、stack 或內部路徑。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

## TC-012 — 效能、容量、備份還原與 Reconciliation

### Preconditions and data
730 萬 Active Fulfillments 及 730 萬 Active Shipments，平均 5 Lines／P95 30／最大 100、每 Line 平均 2 Allocation／P95 6 的混合 Expiry／Lot／Bin 分佈，25% SO 分 2～4 次出貨的較高 header 場景，50 名互動使用者與 Sales Import、Backorder、Export、Archive 並行，以及一份完整備份。

### Steps
量測 Queue、Active list 與精確單號查詢、100 行 Allocate／Pick／Confirm／Reverse、Archive 精確查詢與 Customer＋366 日範圍查詢、100 行列印預覽；在隔離環境 restore 後由 SO → Fulfillment → Allocation → Issue／Reversal Movement 雙向追溯，並執行唯讀 reconciliation 命令。

### Expected result
Queue／Active list／精確查詢 P95 ≤ 2 秒，100 行寫操作 P95 ≤ 3 秒或 3 秒內回可追蹤的 202，Archive 精確 ≤ 3 秒、Customer＋366 日 ≤ 5 秒、列印預覽 ≤ 3 秒，且結果正確；還原後 Active／Archive manifest 逐 table count 與 hash 一致；任何 reconciliation 差異只報告不自動修復，且不得以縮小資料集或直接改資料掩蓋。

### Acceptance criteria
Mandatory：`true`；blocking：`true`；applicability：`APPLICABLE`；suite：`fulfillment-technical`。
每一條對應案例必須在當前已批准基線上被實際觀察為 PASS；零發現案例、被 skip 的案例、缺失證據或基線改變一律記為 `BLOCKED`／`NOT_READY`，不得記為 PASS。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 Fulfillment、Claim、Allocation、Shipment、Issue、Reversal、Operation、Export job、Audit 與 Archive 記錄，以及測試 Lot、Bin 結餘與 Reservation）；
保留已脫敏的報告，不得接觸共用或正式資料，亦不得為了讓 Gate 轉綠而刪除失敗證據。

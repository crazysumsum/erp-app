# Fulfillment & Shipping Management 用戶驗收測試案例（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/fulfillment_shipping_management/01_requirement_spec.md` 0.2 Approved Planning Baseline |
| 設計來源 | `docs/fulfillment_shipping_management/03_design_spec.md` 0.2 Approved Planning Baseline |
| 開發計劃 | `docs/fulfillment_shipping_management/05_development_tasks.md` |
| 技術測試來源 | `docs/fulfillment_shipping_management/06_technical_test_cases.md` |
| UI／UX基準 | `docs/frontend-design.md` |
| 文件日期 | 2026-09-09 |
| 測試類型 | User Acceptance Testing（UAT）測試設計 |
| 測試狀態 | 尚未執行；所有案例初始狀態均為`NOT RUN` |
| 目標環境 | 待執行前填寫；須為隔離UAT環境及測試專用資料庫 |
| Build／Commit | 待執行前填寫 |

> 本文件從倉務、出貨、主管、查詢及營運使用者角度驗證Fulfillment & Shipping是否可接受，不代表系統已通過測試。本輪只產出案例，不執行任何測試。

---

## 1. 驗收目標與範圍

驗證中小企業在最多約5個倉庫、每日約10,000張Sales Orders及24個月Active資料的情境下，可由已確認SO的有效Reservation建立Fulfillment，準確分配至具體Bin／Lot、完成正常或短揀、選擇Customer Shipping Address並正式出貨；錯誤出貨可受控整張沖銷。任何失敗、重送、逾時、並發或歸檔中斷均不得造成重複、部分、錯誤位置或無法解釋的Inventory／Sales結果。

### 1.1 範圍內

- Fulfillment Queue、DRAFT工作、Reservation Claim、Allocation、Reallocation、Pick List、Pick Confirm及Short Pick。
- Shipment Draft、Shipping Address／Contact、選填物流資料、Shipment Confirm、Inventory Issue及Sales Fulfilled更新。
- Fulfillment／Shipment取消、整張Shipment Reversal及SO狀態回復。
- Active／Archive查詢、跨SO／Inventory追溯、A4文件、背景Export、Audit及Reconciliation的使用者可見結果。
- 權限、撤權、IDOR、輸入安全、版本衝突、重送、結果不明、依賴故障、響應式、鍵盤及無障礙。
- 每次數量操作前後，以SO、Fulfillment、Shipment、Inventory、Movement、History及Audit業務頁核對數量、位置、狀態及來源。

### 1.2 範圍外與前置證據

- 不以直接SQL、修改資料庫、直接取得DB lock、檢查程式碼或直接呼叫internal service作為UAT步驟。
- Unit、API contract、migration、FK／unique／trigger、固定lock order、真並發barrier、transaction故障注入、完整容量壓測及immutable protection由開發／系統測試負責；開始對應Phase UAT前須提供通過證據。
- 多SO Shipment、跨倉履約、自動選倉、Wave／Zone Picking、Carrier API、強制Packing、POD及路線功能不在本期。
- Customer Return、部分Shipment Reversal、換貨、退款、Invoice、AR、Payment、Tax、成本及會計分錄不在本期。
- Serial、Catch Weight、Bundle／Kit及臨時地址不在本期；Serial SKU須被本流程拒絕，而不是由UAT驗收Serial作業。
- Archive永久purge、第二個Database、Search Engine、Queue Broker及Data Lake不在本期。

---

## 2. 驗收角色與測試資料基線

### 2.1 使用者角色

| 代號 | 角色／權限 |
| --- | --- |
| U-VIEW | Active user；只有`fulfillment.view` |
| U-OP | Active user；`fulfillment.view＋fulfillment.operation` |
| U-FEFO | Active user；U-OP權限另加`inventory.fefo.override` |
| U-REV | Active user；`fulfillment.view＋fulfillment.reverse`，沒有`fulfillment.operation` |
| U-SUP | Active user；`fulfillment.view＋fulfillment.operation＋fulfillment.reverse` |
| U-OPS | 獲授權營運人員；可查看安全的operation／job／archive／reconciliation技術摘要，不可修改業務歷史 |
| U-SYS | 只有System Administrator角色，沒有明確Fulfillment permission |
| U-NONE | Active user；沒有Fulfillment permission |
| U-STALE | 已登入並載入頁面，其後被停用或撤除目標permission |

三項Fulfillment權限互不包含；`inventory.fefo.override`亦不包含任何Fulfillment權限。所有案例只使用測試帳戶。

### 2.2 主資料、庫存及交易資料

| 代號 | 測試資料 |
| --- | --- |
| CUST-A | Active wholesale Customer；有一個默認及一個其他Active Shipping Address、兩個Active Shipping Contacts |
| CUST-NOADDR | Active Customer；沒有有效Shipping Address |
| CUST-B | 另一Active Customer；用於ownership／IDOR測試 |
| ADDR-DEF／ALT | CUST-A的默認／其他Active Shipping Address，具已知version |
| ADDR-INACTIVE | CUST-A的Inactive或已移除shipping用途地址 |
| ADDR-B | CUST-B的Shipping Address |
| CONTACT-DEF／ALT | CUST-A的默認／其他Active Shipping Contact，具已知version |
| WH-A／WH-B | Active Fulfillment Warehouses；各有多個Active Bins |
| BIN-A1／A2 | WH-A下Active Bins；可存相同SKU／Lot |
| BIN-INACTIVE／COUNTING | WH-A下Inactive／正在Stocktake Counting的Bins |
| SKU-NONE | Active、inventory tracked、Tracking `none`、Base UOM EA |
| SKU-BATCH | Active、inventory tracked、Tracking `batch`、Base UOM EA |
| SKU-EXP | Active、inventory tracked、Tracking `batch_expiry`、具Minimum Sale Life |
| SKU-SERIAL | Active、inventory tracked、Tracking `serial`；本期不支援 |
| SKU-NOTRACK | Active但非inventory tracked SKU |
| LOT-EARLY／MID／LATE | 同SKU三個合資格Expiry Lots，按到期日由早至晚並分布於多個Bins |
| LOT-NOEXP-OLD／NEW | 無Expiry、First Receipt時間由早至晚的兩批庫存 |
| LOT-EXPIRED／LOW | 已過期／未過期但低於Minimum Sale Life的Lots |
| STOCK-BAD | Quarantined、Damaged、Inactive Bin、Counting Bin、錯Warehouse及不足數量的資料組 |
| SO-FULL | CONFIRMED；多Lines均有足夠Reservation，含已知line／mapping versions |
| SO-PARTIAL | PARTIALLY_FULFILLED；仍有Reservation及可再次履約數量 |
| SO-BACKORDER | 只有Backorder、沒有Reservation |
| SO-MIXED | 同時有Reserved及Backorder lines |
| SO-COMPLETED／CLOSED／CANCELLED | 各終態SO；用於禁止操作及Reversal重開 |
| FUL-DRAFT／PICKING／PICKED／SHIPPED／CANCELLED／REVERSED | 各狀態Fulfillment；有已知version、Claims及Allocation資料 |
| SHIP-DRAFT／SHIPPING／SHIPPED／REVERSED／CANCELLED | 各狀態Shipment；有已知version、event及Issue references |
| EVT-A／EVT-B | 穩定Event／Idempotency ID；另備同ID同內容及同ID異內容版本 |
| TEXT-RISK | 以`=`、`+`、`-`、`@`、TAB／CR開頭，另含HTML／script、Unicode、控制字元及超長文字 |
| REASON | 合法業務原因，例如`UAT fulfillment operation verification` |
| ARC-ELIGIBLE | 父SO及全部Fulfillment／Shipment已final、最後業務更新超過24個月且無open matter |
| ARC-OPEN | 含PICKING／PICKED／SHIPPING／REVERSING、active Claim、outstanding Allocation或IN_PROGRESS operation |

每次執行使用唯一run prefix。涉及數量的案例須先記錄SO Ordered／Reserved／Backorder／Fulfilled／Cancelled、Inventory Reservation outstanding／consumed、On Hand、Allocation及Fulfillment Planned／Picked／Shipped的初始值。不得使用真實地址、電話、電郵、銀行資料、Token或商業敏感資料。

---

## 3. UAT進入及完成準則

### 3.1 進入準則

- 對應Phase已部署至隔離UAT環境，build／commit、APP_TIME_ZONE、支援瀏覽器、資料日期及版本已記錄。
- 對應unit、API、provider contract、integration、migration、security及system tests已通過，沒有阻擋UAT的S1／S2缺陷。
- Sales、Inventory、Customer及Item正式Provider contracts可用；不得以stub或直接資料庫更新代替。
- 測試人員可分別登入上述角色，並可查看SO、Queue、Fulfillment、Shipment、Inventory、Movement、Archive、Export及Audit業務頁。
- 技術團隊已準備受控的逾時、依賴不可用、worker中斷、Archive unavailable及restore演練方式，不要求UAT人員直接操作資料庫。
- P3效能驗收前，已建立730萬Active Fulfillments及Shipments、真實lines／allocations／分批出貨比例及50-user標準負載。

### 3.2 完成準則

- 當次Phase所有P0及P1案例已執行，沒有未批准的`BLOCKED`或`NOT APPLICABLE`。
- 所有P0案例通過；沒有未關閉S1／S2缺陷，P1缺陷已有Product Owner接受的處理決定。
- Requirement第15節AC-001～056均有PASS證據或Product Owner書面批准的例外。
- SO、Reservation、Claim、Allocation、Fulfillment、Shipment、Movement、Reversal及Archive可由業務頁完整對賬，沒有重複、負數、部分成功假象或無法解釋的差異。
- Warehouse／Fulfillment、Sales、Inventory、Customer、IT Operations及Product Owner完成對應Phase與最終release簽核。

---

## 4. 風險優先級

| 風險 | Likelihood | Impact | Priority | 核心案例 |
| --- | ---: | ---: | --- | --- |
| 未授權查詢、揀貨、出貨或Reversal | 4 | 5 | P0 | AUTH-001～008、REV-001 |
| 同一Reservation被多張Fulfillment超額佔用 | 4 | 5 | P0 | QUEUE-005～008、ALLOC-010 |
| FEFO／FIFO錯誤或不合資格庫存被分配 | 4 | 5 | P0 | ALLOC-001～009 |
| 短揀、取消或Reallocation留下部分／錯誤Allocation | 4 | 5 | P0 | ALLOC-010～013、PICK-003～010、LIFE-001～004 |
| Confirm重送、逾時或跨模組失敗造成重複／部分Issue | 5 | 5 | P0 | CONF-001～010 |
| 地址／Contact或Allocation過時仍被出貨 | 4 | 5 | P0 | SHIP-004～008、CONF-004～006 |
| Reversal回錯bucket、重複回補或SO狀態錯誤 | 4 | 5 | P0 | REV-001～010 |
| Active／Archive分裂、遺漏或重複 | 3 | 5 | P0 | ARC-001～009 |
| 匯出、列印或Log洩漏地址／敏感資料或執行公式／script | 3 | 5 | P0 | AUTH-008、INQ-005～011 |
| 730萬Active資料及背景Job令日常作業長時間變慢 | 4 | 4 | P1 | OPS-001～007 |
| 故障後沒有可理解狀態或無法恢復／對賬 | 4 | 5 | P0 | CONF-008～010、REV-008～010、OPS-005～008 |

---

## 5. 證據與狀態規則

- 每個案例須保存build、環境、actor、執行時間、初始狀態及執行後狀態；有SO／Fulfillment／Shipment／Movement／Event／Correlation／Export Job ID時一併保存。
- `Required Evidence`只使用使用者或獲授權業務管理員可觀察證據：畫面截圖／錄影、業務訊息、SO／Fulfillment／Shipment／Inventory／Movement／Archive／Audit頁、A4預覽、CSV及前後查詢結果。
- 數量案例須同時顯示SO Line progress、Inventory Reservation／Allocation／On Hand、Fulfillment／Shipment及Movement來源，不只保存成功通知。
- 遇到逾時或結果不明，不以新event直接重做；先按原Correlation／Event查詢，再用原event安全恢復。
- `Actual Evidence`在實際執行前保持`—`。狀態只可為`NOT RUN`、`PASS`、`FAIL`、`BLOCKED`或`NOT APPLICABLE`；沒有執行證據不得標PASS。
- FAIL須建立Defect ID並記錄實際／預期、重現步驟、環境及證據；BLOCKED須記錄阻擋原因、owner及解除條件。
- P0案例失敗、出現越權、重複／負數／部分數量、錯誤bucket、Active／Archive遺失或無法恢復的unknown outcome時，立即停止相關Phase。

---

## 6. 需求與Phase追溯總覽

| 業務流程 | Requirement／Acceptance Criteria | 開發Phase | Test Case IDs | 初始結果 |
| --- | --- | --- | --- | --- |
| 權限與安全 | SEC-001～012、AC-048～050 | P0～P3 | AUTH-001～008、INQ-009～012 | NOT RUN |
| Queue及建立工作 | FR-QUEUE-001～012、AC-001～007 | P1 | QUEUE-001～010 | NOT RUN |
| Allocation及FEFO／FIFO | FR-PICK-001～012、AC-008～017 | P1 | ALLOC-001～013、PICK-001 | NOT RUN |
| Pick Confirm、Short Pick及取消 | FR-PICKCONF-001～010、FR-LIFE-001～003、AC-018～021、039～040 | P1 | PICK-001～010、LIFE-001～004 | NOT RUN |
| Shipment Draft及地址 | FR-SHIP-001～012、FR-LIFE-004～005、AC-022～031、041～042 | P2 | SHIP-001～012、LIFE-005～008 | NOT RUN |
| Shipment Confirm及正式出庫 | FR-CONF-001～016、AC-032～038 | P2 | CONF-001～014 | NOT RUN |
| Shipment Reversal | FR-REV-001～012、AC-043～047 | P3 | REV-001～012 | NOT RUN |
| 查詢、文件、匯出及Audit | FR-INQ、FR-DOC、FR-EXPORT、FR-AUDIT、AC-048～050 | P1～P3 | INQ-001～012 | NOT RUN |
| 歸檔及保留 | FR-ARC-001～010、AC-052～056 | P3 | ARC-001～011、OPS-008 | NOT RUN |
| 效能、可用性、恢復及UI／UX | NFR-PERF-001～007、Requirement §§13.2～13.5、AC-051、055～056 | P0～P3 | OPS-001～010 | NOT RUN |
| 跨流程不變量 | BR-001～036、GATE-001～007 | P0～P3 | 所有業務流程案例 | NOT RUN |

---

## 7. 詳細用戶驗收測試案例

### 7.1 權限、導航與安全（AUTH）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | 各Phase | 未登入 | SEC-001；未登入存取 | 已登出 | 所有Fulfillment／Shipment／Archive URL | 直接開啟各頁 | 導向登入或顯示未登入；沒有任何業務資料可見 | URL、登入導向及畫面 | — | NOT RUN |
| AUTH-002 | P0 | 各Phase | U-NONE／U-SYS | SEC-001～003；權限不隨角色名稱取得 | 兩角色沒有Fulfillment permission | Sidebar及各頁URL | 登入後檢查menu，再直接開各URL | Menu不顯示；直接URL拒絕；System Administrator不自動取得能力 | 角色設定、menu及拒絕畫面 | — | NOT RUN |
| AUTH-003 | P0 | P1～P3 | U-VIEW | SEC-001～004、AC-048；只讀邊界 | 已有各狀態資料 | Queue、Fulfillment、Shipment、Archive、Export | 查詢、列印、匯出，再嘗試建立、分配、揀貨、取消、出貨及Reversal | 查詢／列印／本人匯出成功；所有write不可用且直接提交仍拒絕；資料不變 | 權限、成功查詢、拒絕及前後狀態 | — | NOT RUN |
| AUTH-004 | P0 | P1～P3 | U-OP／U-REV／U-FEFO／U-SUP | SEC-002～005；最小權限 | 四個獨立角色 | 各角色專屬及非專屬操作 | 分別嘗試一般作業、FEFO偏離、Shipment Reversal及查看資料 | 每人只可完成明確獲授權能力；`operation`、`reverse`及FEFO override互不包含 | 角色矩陣、可用actions及拒絕畫面 | — | NOT RUN |
| AUTH-005 | P0 | 各Phase | U-STALE | SEC-004、AC-048；提交點重驗 | 已載入可提交頁 | Create、Allocate、Pick、Confirm、Reverse | 管理員撤權或停用後，由原頁提交 | 清楚拒絕並提示重新登入／聯絡管理員；沒有Claim、Allocation、Issue、Reversal或成功Audit效果 | 撤權時間、錯誤及前後業務頁 | — | NOT RUN |
| AUTH-006 | P0 | P1～P3 | U-OP／U-VIEW | SEC-005、AC-049；水平IDOR | 有CUST-A／CUST-B及WH-A／WH-B資料 | 替換SO、Fulfillment、Line、Claim、Allocation、Shipment、Address、Movement ID | 以瀏覽器可操作方式替換URL或表單ID並讀取／提交 | 跨Customer／Warehouse／aggregate資料不可讀寫；外部訊息不透露目標是否存在；資料不變 | URL／輸入、拒絕及前後詳情 | — | NOT RUN |
| AUTH-007 | P0 | P1～P3 | U-VIEW／U-OPS | SEC-006～012；敏感資料及技術細節 | 有地址、Contact及技術失敗事件 | 正常詳情、Audit、operation錯誤 | 兩角色分別查看列表、詳情、History、Audit及失敗結果 | U-VIEW只見業務狀態；U-OPS只見安全技術摘要；均不見銀行、Token、SQL、stack、完整地址payload或內部路徑 | 兩角色畫面及安全錯誤 | — | NOT RUN |
| AUTH-008 | P0 | P1～P3 | U-OP／U-VIEW | SEC-006～012、AC-050；XSS／CSV輸入 | 可在notes、reason、carrier、tracking保存測試文字 | TEXT-RISK | 輸入後在列表、詳情、列印及CSV查看／安全開啟 | 畫面與列印只顯示文字不執行script；CSV公式不執行；Unicode可讀且敏感資料不外洩 | 輸入、各輸出畫面及CSV | — | NOT RUN |

### 7.2 Fulfillment Queue及建立工作（QUEUE）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QUEUE-001 | P1 | P1 | U-VIEW | FR-QUEUE-001～003、AC-001；Queue正確性 | SO-FULL有未分配Reservation | SO-FULL | 開Queue，以SO／Customer／Warehouse搜尋 | 顯示正確SO、Customer、Warehouse、日期、狀態、Reserved／Backorder／Fulfilled／Fulfillable及更新時間 | Queue條件、結果及SO詳情 | — | NOT RUN |
| QUEUE-002 | P0 | P1 | U-OP | FR-QUEUE-004、AC-002；純Backorder不可履約 | SO-BACKORDER沒有Reservation | SO-BACKORDER | 搜尋並嘗試建立工作 | Queue不提供可建數量；直接提交亦拒絕並顯示最新Reserved／Backorder | Queue、拒絕及SO數量 | — | NOT RUN |
| QUEUE-003 | P1 | P1 | U-VIEW | FR-QUEUE-001～004；混合可履約量 | SO-MIXED一行Reserved、一行純Backorder | SO-MIXED | 開Queue並展開lines | 只可選有未分配Reservation的數量；Backorder清楚顯示但不可被本次工作claim | Queue line摘要及選擇控制 | — | NOT RUN |
| QUEUE-004 | P1 | P1 | U-OP | FR-QUEUE-005／007、AC-003；部分Lines建立 | SO-FULL有3 lines及足夠Reservation | 選line 1全部、line 2部分 | 建立Fulfillment並開詳情 | 只建立一張屬該SO／Customer／Warehouse的DRAFT；只含所選lines／quantities及唯一number | 建立表單、成功訊息及詳情 | — | NOT RUN |
| QUEUE-005 | P0 | P1 | U-OP | FR-QUEUE-006、AC-004；超額拒絕 | 可履約量5 | 輸入6 | 提交建立 | 精確指出數量已超出；不建立工作、不佔用任何Reservation，Queue仍顯示5 | 錯誤、Queue及SO／Inventory前後 | — | NOT RUN |
| QUEUE-006 | P0 | P1 | 兩名U-OP | FR-QUEUE-006／010、AC-005；並發overclaim | 同一Reservation可履約量5 | A／B各建立5 | 兩人同時開頁並提交 | 最多一人成功；另一人收到可理解的quantity/version conflict並可reload；總Planned不超5 | 兩個結果、兩張頁面及最終Queue／詳情 | — | NOT RUN |
| QUEUE-007 | P0 | P1 | U-OP | FR-QUEUE-009、AC-006；重送 | EVT-A首次建立成功 | 同event同內容 | 雙擊或在逾時後以原event重試 | 返回原Fulfillment／number；不建立第二張工作或重複Claim | 兩次結果、Fulfillment搜尋及Queue | — | NOT RUN |
| QUEUE-008 | P0 | P1 | U-OP | BR-025；event衝突 | EVT-A已用於quantity5 | 同event改quantity4或另一SO | 再次提交 | 明確衝突；原Fulfillment不被修改，沒有新工作或新Claim | 衝突訊息、原詳情及搜尋結果 | — | NOT RUN |
| QUEUE-009 | P0 | P1 | U-OP | FR-QUEUE-010；載入後資料改變 | 使用者已載入SO-FULL | 另一流程先改Reservation／SO version | 在舊頁提交 | 過時提交被拒絕並要求reload；不建立部分Fulfillment或錯誤Claim | 舊頁、錯誤及刷新後Queue | — | NOT RUN |
| QUEUE-010 | P0 | P1 | U-OP | FR-QUEUE-012、AC-007；建立無庫存效果 | 已記錄SO／Inventory初值 | 成功建立DRAFT | 建立後查看SO及Inventory | Ordered、Fulfilled、Backorder、On Hand及Reservation outstanding均未因建立動作改變；只多DRAFT工作／Claim | 建立前後SO、Inventory及Fulfillment | — | NOT RUN |

### 7.3 Allocation、FEFO／FIFO及Reallocation（ALLOC）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ALLOC-001 | P0 | P1 | U-OP | FR-PICK-001～002、AC-008；FEFO正確性 | FUL-DRAFT含SKU-EXP | LOT-EARLY／MID／LATE均合資格 | 開Allocation候選並使用建議 | LOT-EARLY最先且rank／expiry／Bin清楚；建議量不超Planned／Reservation | 候選順序、所選結果及Inventory Lot頁 | — | NOT RUN |
| ALLOC-002 | P0 | P1 | U-OP | FR-PICK-002、AC-009；FIFO正確性 | FUL-DRAFT含無Expiry SKU | LOT-NOEXP-OLD／NEW | 開候選並使用建議 | 最早First Receipt的合資格庫存排先；顯示穩定Lot／Bin次序 | 候選順序及Inventory receipt資料 | — | NOT RUN |
| ALLOC-003 | P0 | P1 | U-OP | FR-PICK-002；mixed Expiry排序 | 同SKU同時有Expiry及無Expiry候選 | LOT-EARLY／MID及LOT-NOEXP-OLD | 開候選 | 所有合資格Expiry候選先按FEFO，其後無Expiry才按FIFO；不因Bin code打亂策略 | 完整候選清單及排序欄 | — | NOT RUN |
| ALLOC-004 | P1 | P1 | U-OP | BR-014；穩定tie-break | 多筆候選有相同Expiry或First Receipt | 相同日期、不同Lot／Bin | 重複開頁、刷新及分頁 | 每次順序一致，Lot／Bin tie-break可預期；沒有候選遺漏或重複 | 多次候選截圖／錄影 | — | NOT RUN |
| ALLOC-005 | P1 | P1 | U-OP | FR-PICK-003、AC-010；多Bin／Lot | 單一Bin不足但多Bin合計足夠 | SKU-BATCH同Lot在BIN-A1／A2 | 接受多筆候選並提交 | 一行由多個Bin／Lot組成完整Allocation，總量等於Planned且均屬WH-A | Allocation詳情、quantity summary及Inventory頁 | — | NOT RUN |
| ALLOC-006 | P0 | P1 | U-OP／U-FEFO | FR-PICK-004、AC-011／014；不合資格永遠拒絕 | 有各類不合資格stock | LOT-EXPIRED／LOW、STOCK-BAD、WH-B庫存 | 逐類選擇或竄改候選後提交 | Expired、低效期、Quarantined、Damaged、Inactive、Counting、錯Warehouse及不足庫存全部拒絕；有override亦不可繞過 | 各次錯誤、Allocation及Inventory前後 | — | NOT RUN |
| ALLOC-007 | P1 | P1 | U-OP | FR-PICK-005、AC-013；FIFO偏離 | 無Expiry候選且舊批合資格 | 改選LOT-NOEXP-NEW，先空原因再填REASON | 分別提交 | 無原因拒絕；填原因後一般U-OP可成功，Audit保存推薦舊批、實選新批、actor、reason及time | 兩次結果、Allocation及Audit | — | NOT RUN |
| ALLOC-008 | P0 | P1 | U-OP | FR-PICK-005、AC-012；FEFO越權 | 最早與較晚Expiry均合資格 | 改選LOT-LATE並填REASON | 提交 | 因缺`inventory.fefo.override`拒絕；不保存任何例外Allocation或Audit成功效果 | 權限、錯誤及前後Allocation | — | NOT RUN |
| ALLOC-009 | P0 | P1 | U-FEFO | FR-PICK-005／012、AC-013；受權FEFO偏離 | 最早與較晚Expiry均合資格 | 改選LOT-LATE；REASON | 提交 | 成功；Audit／History同時保存推薦與實選、strategy、rank、permission、reason及Inventory reference | Allocation、History及Audit | — | NOT RUN |
| ALLOC-010 | P0 | P1 | U-OP | FR-PICK-006、AC-015；多行原子性 | FUL-DRAFT有3 lines，其中一行不足 | 兩行足夠、一行不足 | 提交整批Allocation | 顯示不足line及缺量；任何line均未留下Allocation，Fulfillment仍DRAFT | 錯誤、三行詳情及Inventory前後 | — | NOT RUN |
| ALLOC-011 | P0 | P1 | U-OP | FR-PICK-007、AC-016；Allocation不出庫 | 所有lines成功Allocation | FUL-DRAFT | 提交後查看Inventory及SO | Fulfillment轉PICKING；On Hand、Reservation consumed及SO Fulfilled不變，只有Inventory Allocation／本地projection建立 | 前後SO、Inventory及Fulfillment | — | NOT RUN |
| ALLOC-012 | P1 | P1 | U-OP／U-FEFO | FR-PICK-011～012；成功Reallocation | PICKING且尚未Pick Confirm | 由BIN-A1改到合資格BIN-A2，適用時填原因 | 重新取得候選並提交 | 舊Allocation完整release、新Allocation完整建立；總量不變，History／Audit可見前後及原因 | 前後Allocation、History、Inventory頁 | — | NOT RUN |
| ALLOC-013 | P0 | P1 | U-OP | FR-PICK-011、BR-023～027；Reallocation失敗／競爭 | PICKING且舊Allocation有效 | 新候選在提交前失效，或與取消同時發生 | 提交Reallocation | 整筆失敗；舊Allocation完整保留或只有一個競爭操作成功，無空窗、部分新Allocation或數量失衡 | 錯誤、最終Allocation、History及Inventory | — | NOT RUN |

### 7.4 Pick List、Pick Confirm及Short Pick（PICK）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PICK-001 | P1 | P1 | U-VIEW | FR-PICK-008～010、AC-017；Pick List一致 | FUL-PICKING有多Bin／Lot Allocation | 100行內代表性資料 | 開啟A4 Pick List預覽並列印 | Fulfillment／SO／Customer／Warehouse／SKU／Planned／Bin／Lot／Expiry／sequence／notes與Allocation一致，按Bin／Lot／SKU穩定排序 | 詳情、預覽及列印樣本 | — | NOT RUN |
| PICK-002 | P0 | P1 | U-OP | FR-PICKCONF-001／005～006、AC-018；完整揀貨 | FUL-PICKING所有貨已按Allocation找到 | actual picked＝allocated | 輸入並確認 | 全部成功後Fulfillment轉PICKED，逐行Picked正確；On Hand、Reservation consumed及SO Fulfilled仍不變 | Pick表單、詳情、SO及Inventory前後 | — | NOT RUN |
| PICK-003 | P0 | P1 | U-OP | FR-PICKCONF-003、AC-019；Short原因必填 | 一筆實揀少於Allocated | allocated 10、picked 7、空原因 | 提交 | 精確指出Short Pick Reason必填；狀態及所有Allocation／Picked數量不變 | 錯誤及前後詳情 | — | NOT RUN |
| PICK-004 | P0 | P1 | U-OP | FR-PICKCONF-003～006、AC-019；Short成功 | 同PICK-003 | picked 7、REASON | 填原因再提交並查看Queue | Fulfillment轉PICKED；Picked 7、Short 3；差額Allocation release並回Queue，原Reservation outstanding不被釋放，On Hand不變 | Fulfillment、Queue、Inventory Reservation／Allocation及History | — | NOT RUN |
| PICK-005 | P1 | P1 | U-OP | FR-PICKCONF-001～002；個別0有效 | 多個Allocations且其他筆picked>0 | 一筆0、其他筆正數 | 提交 | 允許該Allocation picked=0並按Short規則處理；整張因至少一筆正數可完成 | 表單、quantity summary及詳情 | — | NOT RUN |
| PICK-006 | P0 | P1 | U-OP | FR-PICKCONF-002、AC-020；全0拒絕 | FUL-PICKING | 全部picked=0及原因 | 提交 | 不可進PICKED；提示取消工作及處理現場差異，不自動取消或改庫存 | 錯誤、狀態及Inventory前後 | — | NOT RUN |
| PICK-007 | P0 | P1 | U-OP | FR-PICKCONF-001；數量／集合完整 | FUL-PICKING有多筆Allocation | 負數、超額、小數、遺漏一筆ID | 分別提交 | 每次均精確拒絕；遺漏不當0，任何Picked／release／state均不部分保存 | 各錯誤及前後詳情 | — | NOT RUN |
| PICK-008 | P0 | P1 | U-OP | FR-PICKCONF-008～009、AC-021；冪等 | EVT-A首次Pick成功 | 同event同內容及同event異內容 | 分別重送 | 同內容返回原結果且不累加Picked／重複release；異內容明確衝突且原結果不變 | 多次結果、History、Allocation及Queue | — | NOT RUN |
| PICK-009 | P0 | P1 | 兩名U-OP | BR-023／027；版本／並發 | 兩人載入同一FUL-PICKING version | A full pick、B short pick | A先提交，B以舊頁提交 | A成功；B收到version/state conflict且不覆蓋A；最終只有一組Pick及History | 兩個頁面、衝突及最終詳情 | — | NOT RUN |
| PICK-010 | P0 | P1 | U-OP | FR-PICKCONF-007；PICKED不可直接修改 | FUL-PICKED尚無Shipment | 原Picked quantities及reason | 返回表單嘗試修改數量／原因 | 開啟修改入口或直接提交均被拒絕；提示按取消並重建正式流程，歷史不變 | UI actions、拒絕及前後詳情 | — | NOT RUN |

### 7.5 Shipment Draft及Shipping Address（SHIP）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SHIP-001 | P1 | P2 | U-OP | FR-SHIP-001／003、AC-022；由PICKED建Shipment | FUL-PICKED屬SO-FULL／CUST-A／WH-A | 已揀多lines／bins／lots | 建立Shipment並開詳情 | 建立DRAFT及唯一Shipment Number，只帶入該Fulfillment／SO／Customer／Warehouse與完整Picked quantities | 建立頁、成功訊息及詳情 | — | NOT RUN |
| SHIP-002 | P0 | P2 | U-OP | FR-SHIP-001；錯誤狀態 | Fulfillment分別為DRAFT、PICKING、CANCELLED、SHIPPED、REVERSED | 各狀態工作 | 嘗試建立Shipment | 全部拒絕且說明狀態；沒有Shipment或其他業務效果 | 各次錯誤及搜尋結果 | — | NOT RUN |
| SHIP-003 | P0 | P2 | 兩名U-OP | FR-SHIP-002、AC-023、GATE-001；唯一有效Shipment | FUL-PICKED尚無Shipment | A／B同時建立；另以原event重送 | 同時提交及重試 | 最多一張非CANCELLED Shipment；same intent返回既有記錄，其他事件顯示已有Shipment，不分配可用第二張 | 兩個結果、Fulfillment及Shipment搜尋 | — | NOT RUN |
| SHIP-004 | P1 | P2 | U-OP | FR-SHIP-004、AC-024；默認地址 | CUST-A有ADDR-DEF／ALT | FUL-PICKED | 建立Shipment | 預選ADDR-DEF並顯示屬CUST-A的Active shipping地址；可改選ADDR-ALT | 地址選項及Shipment Draft | — | NOT RUN |
| SHIP-005 | P0 | P2 | U-OP | FR-SHIP-004／007、AC-024／027；跨客戶地址 | CUST-A Shipment及CUST-B地址 | ADDR-B | 嘗試透過可操作方式替換地址ID並保存／確認 | 地址不在選項；提交拒絕且不透露CUST-B資料，不靜默改回default | 地址列表、拒絕及Draft前後 | — | NOT RUN |
| SHIP-006 | P0 | P2 | U-OP | FR-SHIP-005、AC-025；沒有有效地址 | FUL-PICKED屬CUST-NOADDR | 無地址 | 開Shipment流程並嘗試Confirm | PICKED工作可保留；不能確認出貨，清楚提示先維護Customer Shipping Address並提供入口 | Shipment頁、錯誤及Customer入口 | — | NOT RUN |
| SHIP-007 | P0 | P2 | U-OP | FR-SHIP-005、AC-026；禁止臨時地址 | CUST-A有正式地址 | 自由文字地址／改寫address text | 嘗試輸入或竄改提交 | UI沒有自由地址欄；直接提交未知地址欄位被拒絕，不建立臨時地址或快照 | 表單、錯誤及Customer地址頁 | — | NOT RUN |
| SHIP-008 | P0 | P2 | U-OP | FR-SHIP-007、AC-027；地址／Contact過時 | Draft已選ADDR-DEF／CONTACT-DEF | 管理員停用、改用途、改owner或改version | 不刷新頁面直接Confirm | 每種變更均被拒絕並要求重新選擇；不自動替代、不Issue、不改SO | 舊頁、錯誤、主檔變更及業務前後 | — | NOT RUN |
| SHIP-009 | P2 | P2 | U-OP | FR-SHIP-006、AC-028；Contact選填 | CUST-A有default contact；另有Customer無contact | CONTACT-DEF／ALT／空 | 建Shipment、改選及清空Contact | 有default時預選且可改；無Contact或清空仍可保存／確認，選用時只接受有效shipping contact | 三種表單及結果 | — | NOT RUN |
| SHIP-010 | P1 | P2 | U-OP | FR-SHIP-008～010、AC-029；物流欄位選填 | 其他資料有效 | carrier／tracking／package／weight全空 | 保存並Confirm | 不因全部選填欄位為空而拒絕；成功文件不虛構物流資料 | 表單、Shipment結果及文件 | — | NOT RUN |
| SHIP-011 | P1 | P2 | U-OP | FR-SHIP-009、AC-030；欄位邊界 | SHIP-DRAFT | package 0／負／小數；weight 0／負／無UOM；合法1及正weight | 分別保存 | 無效值有精確field error且不改Picked資料；合法邊界成功 | 各輸入、錯誤及Draft詳情 | — | NOT RUN |
| SHIP-012 | P0 | P2 | U-OP | FR-SHIP-012、FR-LIFE-004、AC-031／041；Draft修改／取消 | SHIP-DRAFT且已記錄SO／Inventory初值 | 改ADDR-ALT、物流資料後取消 | 修改、查看History，再取消 | 只允許Draft欄位改動；取消後Shipment=CANCELLED、Fulfillment=PICKED且可重建；SO Fulfilled／On Hand／Reservation不變 | 修改／取消前後詳情、SO及Inventory | — | NOT RUN |

### 7.6 Shipment Confirm及正式出庫（CONF）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CONF-001 | P0 | P2 | U-OP | FR-CONF-001～003、AC-032；單行正式出庫 | 有效SHIP-DRAFT及一筆Allocation | SKU-NONE、BIN-A1、qty 5 | 記錄前值後確認 | Shipment／Fulfillment轉SHIPPED；原BIN-A1 On Hand減5、Reservation consumed加5／outstanding減5、SO Fulfilled加5且Movement來源可追 | Confirm結果、SO、Inventory、Movement及詳情 | — | NOT RUN |
| CONF-002 | P0 | P2 | U-OP | FR-CONF-008～013、AC-032；多Bin／Lot數量守恆 | 有效SHIP-DRAFT含多lines／allocations | SKU-BATCH／EXP跨BIN-A1／A2及Lots | 確認後逐行對賬 | 每行Shipped＝Picked＝成功Issues總和；只扣原Allocation buckets，Claims consumed及Sales／Inventory數量全部一致 | 前後quantity表、Movement、Issues及SO | — | NOT RUN |
| CONF-003 | P0 | P2 | U-OP | FR-CONF-009、AC-033；多行原子失敗 | 3-line Shipment，第三行可由QA受控令Issue驗證失敗 | 前兩行有效、第三行失效 | 確認 | 沒有任何line部分Issue；Shipment／Fulfillment不顯示SHIPPED，SO及所有On Hand／Reservation保持前值 | 錯誤、三行Movement搜尋及前後數量 | — | NOT RUN |
| CONF-004 | P0 | P2 | U-OP | FR-CONF-004、AC-027；地址提交重驗 | SHIP-DRAFT已載入 | ADDR-DEF在提交前停用／改owner／改version | 確認 | 拒絕並要求重選；不用過時snapshot或default替代，沒有Inventory／Sales效果 | 地址變更、錯誤及前後數量 | — | NOT RUN |
| CONF-005 | P0 | P2 | U-OP | FR-CONF-003／005；Allocation提交重驗 | SHIP-DRAFT已載入 | 原Allocation／Bin／Lot／version在提交前失效 | 確認 | 拒絕並導向重新分配；不自動改選其他Bin／Lot，不產生部分Issue或SO增量 | 錯誤、Allocation及Inventory／SO前後 | — | NOT RUN |
| CONF-006 | P0 | P2 | U-OP | FR-CONF-002～003、GATE-007；Item／Bin資格重驗 | Draft含可被改狀態資料 | SKU轉Serial／Archived／non-tracked，Bin轉Counting／Inactive，Lot失效 | 逐種變更後確認 | 每種均fail closed並給可行動訊息；不出貨、不換bucket、不留下部分結果 | 主檔變更、錯誤及前後業務頁 | — | NOT RUN |
| CONF-007 | P0 | P2 | U-OP | FR-CONF-007、AC-034；雙擊／重送 | 有效SHIP-DRAFT及EVT-A | 快速雙擊、同event同內容重送 | 提交並等待兩個結果 | 只產生一組Issues、一次Reservation consume及一次SO Fulfilled增量；兩次均路由原結果 | 兩個回應、Movement count、SO及Shipment | — | NOT RUN |
| CONF-008 | P0 | P2 | U-OP | BR-025；event／idempotency衝突 | EVT-A已有確認意圖 | 同event改Shipment、version、address或payload | 再次提交 | 明確衝突；不修改原Shipment／operation，不產生額外Issues | 衝突訊息、原結果及Movement搜尋 | — | NOT RUN |
| CONF-009 | P0 | P2 | U-OP | FR-CONF-006／015、AC-035；逾時／結果不明 | QA可受控令commit結果不明 | SHIP-DRAFT、EVT-A | Confirm至逾時，再刷新／重新登入 | 顯示SHIPPING、Correlation及查詢中狀態，不顯示虛假SHIPPED／FAILED，不允許修改、取消或新event confirm | 逾時及刷新畫面、Correlation、禁用actions | — | NOT RUN |
| CONF-010 | P0 | P2 | U-OP／U-OPS | FR-CONF-015、AC-035；原event恢復 | CONF-009後依賴恢復或worker重啟 | 原EVT-A | 依畫面指引查詢並等待Recovery | 最終收斂為唯一成功或可證明失敗；成功只一組效果，失敗無效果；不要求使用者建立新event | 處理中及最終畫面、SO／Inventory／Movement | — | NOT RUN |
| CONF-011 | P0 | P2 | U-OP | FR-CONF-016；永久業務失敗 | Draft可由受控方式觸發明確business rejection | Address不可用或Allocation不足 | 確認並查看結果 | Shipment回可修正DRAFT並顯示具體下一步；Operation為失敗結果，沒有Inventory／Sales成功效果 | 錯誤、Draft、operation及前後數量 | — | NOT RUN |
| CONF-012 | P1 | P2 | U-VIEW | FR-CONF-012、AC-036；歷史快照 | Shipment已SHIPPED | 後續修改Customer／Address／SKU／Warehouse／Lot顯示名稱或停用 | 開Shipment及Delivery Note | 仍顯示確認時Customer、Address／Contact、SKU／UOM、Warehouse／Bin／Lot／Expiry／Status快照及actor/time | 修改前後主檔、Shipment及文件 | — | NOT RUN |
| CONF-013 | P0 | P2 | U-OP | FR-CONF-013～014、AC-037；部分履約 | SO仍有其他Reserved未出貨量 | 本次只出部分lines／quantities | 確認後查看SO及Queue | SO為PARTIALLY_FULFILLED；本次量只增加一次，剩餘Reservation可再次由Queue建立新Fulfillment | Shipment、SO quantities/status及Queue | — | NOT RUN |
| CONF-014 | P0 | P2 | U-OP | FR-CONF-013～014、AC-038；全部履約 | 本次為SO最後未履約有效量 | 最後Shipment | 確認後查看SO | 全部有效量Fulfilled，SO依Sales規則轉COMPLETED；Ordered／Cancelled不被改寫，Queue不再提供已完成量 | 最後Shipment、SO數量／狀態及Queue | — | NOT RUN |

### 7.7 取消、狀態及並發生命週期（LIFE）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIFE-001 | P1 | P1 | U-OP | FR-LIFE-001；DRAFT取消 | FUL-DRAFT有active Claims、無Allocation／Shipment | 一般取消 | 取消並刷新Queue | Fulfillment=CANCELLED，Claims release；Reservation outstanding／On Hand／SO quantities不變，可履約量回Queue | 取消前後Fulfillment、Queue、SO及Inventory | — | NOT RUN |
| LIFE-002 | P0 | P1 | U-OP | FR-LIFE-001～002、AC-039；PICKING取消 | FUL-PICKING尚未實際揀貨 | 空原因及REASON | 先空原因提交，再填原因取消 | 空原因拒絕；合法原因後所有未耗用Allocation release才轉CANCELLED，數量回Queue | 兩次結果、Allocation、Queue及History | — | NOT RUN |
| LIFE-003 | P0 | P1 | U-OP | FR-LIFE-002、AC-039；PICKED現場放回 | FUL-PICKED無Shipment | REASON；goods returned false／true | 分別取消 | 未確認放回原Bin／Lot時拒絕；確認後release成功才CANCELLED，不改On Hand或SO Fulfilled | 確認框、結果、Inventory及Fulfillment | — | NOT RUN |
| LIFE-004 | P0 | P1 | U-OP | AC-040；取消Release失敗 | QA可受控令Inventory release失敗 | FUL-PICKING／PICKED、原event | 取消至失敗，再按指引以原event重試 | 失敗時狀態及Allocations保持原值並顯示Correlation／恢復指引；恢復後只release一次 | 失敗／恢復畫面、Allocation及Queue | — | NOT RUN |
| LIFE-005 | P0 | P2 | U-OP | FR-LIFE-003；Shipment阻擋Fulfillment取消 | Fulfillment有DRAFT或SHIPPING／SHIPPED Shipment | 各狀態Shipment | 嘗試取消Fulfillment | 全部拒絕並提示先處理可取消的DRAFT Shipment；SHIPPING／SHIPPED不得以Fulfillment取消繞過 | 錯誤、Shipment及Fulfillment狀態 | — | NOT RUN |
| LIFE-006 | P1 | P2 | U-OP | FR-LIFE-004、GATE-001；Draft Shipment取消重建 | SHIP-DRAFT屬FUL-PICKED | 取消後以新event建立 | 取消Shipment，再由同Fulfillment建立新Shipment | 舊Shipment=CANCELLED且歷史保留；Fulfillment=PICKED；新Shipment獲新number且為唯一active Shipment | 兩張Shipment及Fulfillment詳情 | — | NOT RUN |
| LIFE-007 | P0 | P2～P3 | U-OP／U-REV | FR-LIFE-005、BR-028；終態不可改 | SHIP-SHIPPED／REVERSED／CANCELLED | 修改地址、物流、quantity、一般cancel或confirm | 嘗試各操作 | 所有不合法操作拒絕；SHIPPED只能走具權限Reversal，REVERSED／CANCELLED歷史不可改寫 | 可用actions、拒絕及前後詳情 | — | NOT RUN |
| LIFE-008 | P0 | P1～P2 | 兩名U-OP | BR-023～027；競爭狀態操作 | 同一version的PICKING／PICKED／DRAFT Shipment | reallocate對cancel、pick對cancel、confirm對cancel | 兩人近同時提交 | 只有符合最新狀態／version的一個操作成功；另一個清楚衝突，最終狀態及數量可完整解釋 | 兩個結果、History、SO及Inventory最終值 | — | NOT RUN |

### 7.8 Shipment Reversal（REV）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REV-001 | P0 | P3 | U-OP／U-VIEW／U-REV | FR-REV-001、AC-042；最小Reversal權限 | SHIP-SHIPPED | 三個角色 | 分別開詳情並嘗試Reversal | U-OP／U-VIEW沒有入口且直接提交拒絕；U-REV可見Reversal入口但不取得一般operation能力 | 角色、actions及拒絕／可用畫面 | — | NOT RUN |
| REV-002 | P0 | P3 | U-REV | FR-REV-001／003、AC-043；完整確認資料 | SHIP-SHIPPED且貨仍在公司控制 | 空／短／超長reason；兩個checkbox組合；合法REASON | 分別提交 | 原因須5～500字且兩項確認均true；無效輸入不改狀態，合法才開始REVERSING | 各表單結果及Shipment狀態 | — | NOT RUN |
| REV-003 | P0 | P3 | U-REV | FR-REV-005～006、AC-043；整張原bucket回補 | SHIPPED含多lines／bins／lots且原位置可用 | 原Issues及REASON | 記錄前值後整張Reversal | Shipment／Fulfillment／Reversal=REVERSED；每筆原bucket回補、Reservation恢復、SO Fulfilled等量減少；原Allocation仍Consumed | 前後SO、Inventory、Movement、Allocation及Reversal | — | NOT RUN |
| REV-004 | P0 | P3 | U-REV | GATE-004；COMPLETED／CLOSED SO重開 | Shipment屬SO-COMPLETED或符合條件的SO-CLOSED | 含既有Cancelled quantity | 整張Reversal並查看SO | Cancelled保持不變；恢復Reserved後按剩餘Fulfilled重算為PARTIALLY_FULFILLED或CONFIRMED，歷史不改寫 | SO前後quantity／status、History及Reversal | — | NOT RUN |
| REV-005 | P0 | P3 | U-REV | FR-REV-002、AC-044；禁止部分沖銷 | SHIP-SHIPPED有多lines | 選單行／部分quantity或竄改payload | 嘗試提交 | UI沒有部分選項；多餘line／quantity被拒絕，沒有任何回補；提示整張沖銷後重新履約 | UI、錯誤及前後Movement／SO | — | NOT RUN |
| REV-006 | P0 | P3 | U-REV | FR-REV-003／012、AC-047；Customer Return區分 | 貨已交付客戶、不在公司控制 | goods control=false或return原因 | 嘗試Reversal | 阻止並明確說明Reversal只更正錯誤操作，Customer Return須走未來Returns流程；不回補庫存 | 提示、Shipment及Inventory前後 | — | NOT RUN |
| REV-007 | P0 | P3 | U-REV | FR-REV-003／005；原bucket不可用 | 原Bin已Inactive／Counting或不能接收原Lot／Status | 各阻擋情境 | 提交Reversal | 全部拒絕或保持可恢復真實狀態；不可改選另一Bin、不可部分回補，提示Inventory owner解除阻擋 | 各錯誤、原bucket狀態及Movement搜尋 | — | NOT RUN |
| REV-008 | P0 | P3 | U-REV | FR-REV-003；Archive／downstream阻擋 | 父SO已Archive或required downstream matter為OPEN／UNKNOWN | 三種情境 | 嘗試Reversal | 全部fail closed並提示正式例外／依賴處理；不建立成功Reversal或Inventory／Sales效果 | 錯誤、Shipment／Archive及前後數量 | — | NOT RUN |
| REV-009 | P0 | P3 | U-REV | FR-REV-008、AC-045；跨模組原子失敗 | QA可受控令其中一筆回補或Sales更新失敗 | 多line SHIP-SHIPPED | Reversal至失敗並查詢 | 不存在部分Movement／Reservation restore／SO decrement或虛假REVERSED；顯示SHIPPED或REVERSING真實可恢復狀態 | 失敗畫面、所有bucket、SO及Reversal詳情 | — | NOT RUN |
| REV-010 | P0 | P3 | U-REV／U-OPS | FR-REV-004／009、AC-046；重送／unknown恢復 | EVT-A首次成功或停在REVERSING | 同event同內容、worker重啟 | 重送並依Correlation等待恢復 | 返回同一Reversal／number；最多一組反向Movements及SO decrement，最終由原event收斂 | 多次結果、Movement count、SO及operation | — | NOT RUN |
| REV-011 | P0 | P3 | U-REV | FR-REV-010；event衝突／並發 | EVT-A已有意圖 | 同event改Shipment／reason；兩人不同event同時Reverse | 分別提交 | 同event異payload明確衝突；同Shipment並發最多一人成功，另一人回既有／處理中結果，不重複回補 | 兩個結果、Reversal搜尋及Movement count | — | NOT RUN |
| REV-012 | P0 | P3 | U-VIEW／U-OP | FR-REV-006～007／011；沖銷後追溯與再履約 | REV-003成功 | 原Shipment、Allocation、Queue及文件 | 查看全部連結，再嘗試重用原Allocation／Shipment並從Queue新建 | 原資料唯讀且文件標示REVERSED；原Allocation不重開／不可重用，恢復Reservation回Queue，須建立新Fulfillment／Shipment | Shipment、文件、Allocation、Queue、History及Audit | — | NOT RUN |

### 7.9 查詢、文件、匯出及Audit追溯（INQ）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INQ-001 | P1 | P1～P3 | U-VIEW | FR-INQ-001；常用視圖 | 有本人近期、Active、Exception及Finalized資料 | 多狀態Fulfillment／Shipment | 開My Recent Work、Queue、Active、Shipments、Exceptions、Finalized | 每個視圖只含符合定義資料；狀態與數量摘要正確且不混入Archive | 各視圖及樣本詳情 | — | NOT RUN |
| INQ-002 | P1 | P1～P3 | U-VIEW | FR-INQ-002～004；Filter／exact查詢 | Active有相似number／Customer／tracking資料 | number、SO、Customer、WH、status、date、short、carrier、tracking | 分別及組合搜尋 | Exact key定位唯一記錄；一般filters準確、穩定分頁，URL刷新／返回後條件保留 | 搜尋條件、URL、結果及詳情 | — | NOT RUN |
| INQ-003 | P0 | P1～P3 | U-VIEW | FR-INQ-005～006；詳情數量事實 | 有DRAFT、PICKING、PICKED、SHIPPED、REVERSED資料 | 各狀態樣本 | 逐張開Fulfillment／Shipment詳情 | 顯示SO、Planned／Allocated／Picked／Short／Shipped、Bin／Lot、地址／Contact快照、Issues、History及正確allowed actions | 各狀態詳情及來源頁 | — | NOT RUN |
| INQ-004 | P0 | P1～P3 | U-VIEW | FR-INQ-007；雙向追溯 | 有已出貨及沖銷資料 | SO、Fulfillment、Shipment、Movement、Reversal IDs | 由每個來源逐步前往其他單據並返回 | 每個連結只到同一aggregate及正確line／movement；無權目標安全拒絕，不跳至相似number | 完整導航錄影／截圖 | — | NOT RUN |
| INQ-005 | P1 | P1 | U-VIEW | FR-DOC-001；Pick List內容 | FUL-PICKING有多Bin／Lot | 代表性及100行資料 | 預覽／列印Pick List並與詳情比對 | 內容、順序及quantity與當前Allocation一致；A4可讀且不顯示price、cost、bank或技術錯誤 | 詳情、預覽及列印樣本 | — | NOT RUN |
| INQ-006 | P0 | P2～P3 | U-VIEW | FR-DOC-002～004；Delivery文件真實性 | SHIPPED及REVERSED各一張 | 含／不含物流資料 | 預覽／列印Delivery Note／Packing List | SHIPPED顯示確認時snapshot及選填物流；REVERSED有顯眼文字／watermark；均不顯示price、tax、cost、bank或internal error | 兩種狀態詳情及文件 | — | NOT RUN |
| INQ-007 | P0 | P3 | U-VIEW | FR-EXPORT-001～002；Filter／權限一致 | 列表有權限範圍內外資料 | 當前Customer／WH／status/date filters | 套用filters後建立匯出並下載 | CSV只含當前可見範圍與filters，欄位及counts與列表／詳情一致，不包含完整地址或銀行資料 | 畫面計數、CSV計數及樣本對照 | — | NOT RUN |
| INQ-008 | P0 | P3 | 兩名U-VIEW | FR-EXPORT-003；Job owner隔離 | A建立大匯出Job | A／B帳戶、running/completed Job | B嘗試查看／下載，A追蹤至完成 | 只有A可見／下載；B統一拒絕；Job背景執行且前台仍可操作，完成後提供安全下載 | 兩角色頁面、Job狀態及下載 | — | NOT RUN |
| INQ-009 | P2 | P3 | U-VIEW | FR-EXPORT-003；過期／失敗Job | 已完成及可受控失敗Job | 期限內、過期及failed結果 | 分別下載／查看 | 期限內成功；過期清楚顯示不可下載；failed有可行動訊息，不返回partial file或server path | 三種Job及下載結果 | — | NOT RUN |
| INQ-010 | P0 | P3 | U-VIEW | FR-EXPORT-004、AC-050；CSV安全 | 可匯出TEXT-RISK | notes、reason、carrier、tracking | 匯出並在受控試算表安全開啟 | UTF-8／Unicode可讀；公式字首被中和，欄位正確escape，沒有script／formula執行或CRLF破壞row | 原畫面、CSV raw／開啟結果 | — | NOT RUN |
| INQ-011 | P0 | P1～P3 | U-VIEW／U-OPS | FR-AUDIT-001～003；Audit完整／不可改 | 已完成create、allocate、override、pick、cancel、confirm、retry、reverse、print、export、archive | 各action sample | 從History／Audit查看並嘗試修改 | 每個動作有actor、time、action、outcome及safe reference；Viewer不見安全技術細節；任何UI均不能修改／刪除正式歷史 | History／Audit samples及無write actions | — | NOT RUN |
| INQ-012 | P0 | P1～P3 | U-VIEW | BR-033；讀取無業務副作用 | 記錄可歸檔單據的last business update／資格 | 重複list、detail、print、export | 執行後再查看Archive eligibility | 技術讀取、列印及匯出不改最後業務更新時間、狀態、數量或歸檔資格 | 操作前後詳情及候選結果 | — | NOT RUN |

### 7.10 歸檔、保留及查回（ARC）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ARC-001 | P0 | P3 | U-OPS | FR-ARC-001～003、AC-052；合資格判斷 | 可執行受控月度Archive | ARC-ELIGIBLE及未滿24個月資料 | 執行並查看候選／結果 | 只有父SO符合24個月且全部下游final／無open matter者搬移；較新資料保留Active | Batch摘要、兩組Active／Archive結果 | — | NOT RUN |
| ARC-002 | P0 | P3 | U-OPS | FR-ARC-003、AC-053；Open matter阻擋 | 各類open matter樣本 | PICKING、PICKED、SHIPPING、REVERSING、active Claim、outstanding Allocation、IN_PROGRESS operation | 執行資格評估 | 每類均Skip並顯示穩定原因；SO與全部Fulfillment資料保留Active | 候選／Skip報告及Active詳情 | — | NOT RUN |
| ARC-003 | P0 | P3 | U-OPS／U-VIEW | FR-ARC-004～005、AC-052；aggregate完整搬移 | ARC-ELIGIBLE含多Fulfillment、Shipment、Reversal、Audit | 已知單據及quantity摘要 | 歸檔前保存業務頁，歸檔後由Archive查看 | SO、Fulfillments、Shipments、lines、Claims、Allocations、Issues、snapshots、History、Reversal及必要Audit一併可讀，數量／狀態不改 | 搬移前後業務對照及Batch結果 | — | NOT RUN |
| ARC-004 | P0 | P3 | U-OPS | FR-ARC-005／009、AC-054；校驗失敗 | QA可受控令單一aggregate校驗失敗 | ARC-ELIGIBLE | 執行Archive | 該aggregate完整保留Active，沒有半份Archive；Batch顯示失敗、Correlation及可重試指引 | Active／Archive搜尋及Batch error | — | NOT RUN |
| ARC-005 | P0 | P3 | U-OPS | FR-ARC-009、AC-054；中斷及重跑 | Batch含多個aggregate | 在部分完成後受控停止worker | 重啟／按runbook續跑 | 已成功資料不重複，未完成資料可安全處理；不同hash conflict不被忽略，counts清楚 | 兩次Batch結果及Active／Archive搜尋 | — | NOT RUN |
| ARC-006 | P0 | P3 | U-VIEW | FR-ARC-007～008；唯一routing | 已有相似Active與Archive records | Fulfillment／Shipment／SO／Tracking exact keys | 由Active搜尋提示前往Archive，再在Archive搜尋 | 每個key只路由唯一Active或Archive記錄；不重複、不假404、不自動全歷史union | Active提示、Archive結果及詳情 | — | NOT RUN |
| ARC-007 | P0 | P3 | U-VIEW／U-OP／U-REV | FR-ARC-006；Archive唯讀 | 單據已歸檔 | Archive detail | 嘗試update、cancel、confirm、reverse或重開 | 頁面沒有write actions；直接提交仍拒絕，歷史及snapshot不變 | 詳情、拒絕及前後結果 | — | NOT RUN |
| ARC-008 | P1 | P3 | U-VIEW | FR-ARC-007；bounded Archive搜尋 | Archive有大量資料 | 空條件、367日、366日、exact number、Customer＋日期 | 分別搜尋 | 空條件／367日要求收窄；366日或exact key可查；結果與filters一致且分頁穩定 | 各次搜尋條件及結果 | — | NOT RUN |
| ARC-009 | P0 | P3 | U-VIEW／U-OP | FR-ARC-010、AC-055；Archive unavailable隔離 | QA令Archive store暫不可用 | Queue、Create、Pick、Confirm、Active list、Archive list | 同時執行 | Active日常操作及查詢繼續；Archive清楚顯示暫不可用與Correlation，不顯示0筆或影響出貨 | Active各流程及Archive錯誤 | — | NOT RUN |
| ARC-010 | P1 | P3 | U-VIEW | FR-ARC-001；至少7年保留 | 有7年內最早Archive測試資料 | Archive detail及可用actions | 查詢並檢查操作 | 資料仍可讀及追溯；沒有自動purge、永久刪除或使用者銷毀入口 | Archive詳情、設定及actions | — | NOT RUN |
| ARC-011 | P0 | P3 | U-OPS／U-VIEW | AC-056；Archive restore後可查 | 已完成包含Active／Archive的測試備份 | 代表性SO／Fulfillment／Shipment／Reversal | 在隔離restore環境逐筆查詢及導航 | 每筆Active／Archive routing唯一，snapshots／quantities／issues／reversals／Audit完整；任何差異有報告而非假成功 | Restore環境、抽樣表、畫面及對賬結果 | — | NOT RUN |

### 7.11 效能、可用性、恢復及UI／UX（OPS）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | P1 | P1～P3 | U-VIEW | NFR-PERF-001～002、AC-051；Active查詢效能 | 730萬Active Fulfillments及Shipments、正常負載 | Queue、常用filters、exact numbers | 按批准腳本重複操作 | Queue、Active lists及exact lookup P95≤2秒且結果正確，不靠清空資料或省略filters | 使用者錄影、效能報告及環境基線 | — | NOT RUN |
| OPS-002 | P1 | P1～P3 | U-OP／U-REV | NFR-PERF-003、AC-051；100行操作 | 正常依賴及負載 | 1／100-line Allocate、Pick、Confirm、Reverse | 執行各操作 | P95≤3秒；如背景處理則3秒內回可追蹤狀態，最終數量唯一且正確 | 操作結果、percentile報告及對賬 | — | NOT RUN |
| OPS-003 | P1 | P1～P3 | 50名混合角色 | NFR-PERF-004；並發營運 | 標準容量，Sales Import／Backorder／Export／Archive並行 | Queue、create、pick、confirm、lookup workload | 同時執行代表性流程 | 至少50名使用者可操作；無pool starvation、長時間凍結、deadlock外洩或數量錯亂 | Workload、頁面、錯誤率及資源報告 | — | NOT RUN |
| OPS-004 | P1 | P1～P2 | U-VIEW | NFR-PERF-007；100行列印 | 100-line PICKING及SHIPPED文件 | Pick List、Delivery Note | 開預覽並切換列印 | P95≤3秒；內容完整可讀、分頁合理，前台不凍結 | 預覽錄影、效能及PDF／列印樣本 | — | NOT RUN |
| OPS-005 | P0 | P1～P3 | U-OP | Requirement §13.2～13.3；依賴故障 | QA可受控令Sales／Customer／Item／Inventory慢、失敗或不可用 | Create、Allocate、Confirm、Reverse | 分別提交並於依賴恢復後按指引處理 | 不用過時資料假成功；顯示依賴／業務／version／unknown的不同訊息及Correlation；恢復後不重複效果 | 各錯誤、恢復步驟及最終業務頁 | — | NOT RUN |
| OPS-006 | P1 | P2～P3 | U-OPS／U-OP | Requirement §13.3；Job中斷與互不拖累 | Recovery、Export、Reconciliation、Archive可受控停止 | 各一Job及正常Active操作 | 中斷／重啟Job，同時操作Queue／Pick／Confirm | 已完成工作不重複，未完成可續跑；單一非必要Job故障不阻止日常出貨／Active查詢 | Job前後、Active操作及最終結果 | — | NOT RUN |
| OPS-007 | P0 | P3 | U-OPS | Requirement §13.2／13.4；Reconciliation可行動 | 可受控建立只讀差異樣本 | quantity、state、source、duplicate event、routing mismatch | 執行對賬並查看報告 | 報告指出安全IDs／codes／counts及Correlation，不自動改資料；差異產生metric／alert並可按runbook跟進 | 對賬報告、alert及業務頁 | — | NOT RUN |
| OPS-008 | P0 | P3 | U-OPS／U-VIEW | AC-056；完整備份還原 | Active、Archive、operations及Inventory references已備份 | 代表性全流程資料 | 在隔離環境restore並由UI／報告抽樣對賬 | SO→Fulfillment→Allocation→Shipment→Movement／Reversal及Archive可雙向追溯；counts／status／quantities／hash一致 | Restore資訊、抽樣矩陣及對賬報告 | — | NOT RUN |
| OPS-009 | P1 | P1～P3 | 各業務角色 | Requirement §10、Design §10.6；Responsive | 支援桌面瀏覽器 | 375／768／1024／1440px | 完成Queue、Allocation、Pick、Shipment、Reversal、Archive核心流程 | 關鍵資料／actions無不可用遮擋；table/card、loading、empty、error及success清楚，繁中一致 | 各viewport截圖／錄影 | — | NOT RUN |
| OPS-010 | P1 | P1～P3 | 各業務角色 | Design §10.6；Keyboard／WCAG／時區 | 支援瀏覽器及screen reader | 關鍵流程、validation errors、跨日資料 | 只用鍵盤完成；觸發錯誤；查看跨日狀態 | Focus可見且順序合理，labels/errors可讀出並定位，dialog可控，狀態不只靠顏色；日期按APP_TIME_ZONE一致 | 鍵盤錄影、accessibility evidence及日期畫面 | — | NOT RUN |

---

## 8. Acceptance Criteria逐項覆蓋矩陣

| AC | Test Case IDs | AC | Test Case IDs |
| --- | --- | --- | --- |
| AC-001 | QUEUE-001 | AC-029 | SHIP-010 |
| AC-002 | QUEUE-002 | AC-030 | SHIP-011 |
| AC-003 | QUEUE-004 | AC-031 | SHIP-012 |
| AC-004 | QUEUE-005 | AC-032 | CONF-001～002 |
| AC-005 | QUEUE-006 | AC-033 | CONF-003 |
| AC-006 | QUEUE-007 | AC-034 | CONF-007～008 |
| AC-007 | QUEUE-010 | AC-035 | CONF-009～010 |
| AC-008 | ALLOC-001 | AC-036 | CONF-012 |
| AC-009 | ALLOC-002 | AC-037 | CONF-013 |
| AC-010 | ALLOC-005 | AC-038 | CONF-014 |
| AC-011 | ALLOC-006 | AC-039 | LIFE-002～003 |
| AC-012 | ALLOC-008 | AC-040 | LIFE-004 |
| AC-013 | ALLOC-007／009 | AC-041 | SHIP-012、LIFE-006 |
| AC-014 | ALLOC-006 | AC-042 | LIFE-007、REV-001 |
| AC-015 | ALLOC-010 | AC-043 | REV-002～004 |
| AC-016 | ALLOC-011 | AC-044 | REV-005 |
| AC-017 | PICK-001 | AC-045 | REV-009 |
| AC-018 | PICK-002 | AC-046 | REV-010 |
| AC-019 | PICK-003～004 | AC-047 | REV-006 |
| AC-020 | PICK-006 | AC-048 | AUTH-003～005 |
| AC-021 | PICK-008 | AC-049 | AUTH-006 |
| AC-022 | SHIP-001 | AC-050 | AUTH-008、INQ-010 |
| AC-023 | SHIP-003 | AC-051 | OPS-001～004 |
| AC-024 | SHIP-004 | AC-052 | ARC-001／003 |
| AC-025 | SHIP-006 | AC-053 | ARC-002 |
| AC-026 | SHIP-007 | AC-054 | ARC-004～005 |
| AC-027 | SHIP-008、CONF-004 | AC-055 | ARC-009、OPS-006 |
| AC-028 | SHIP-009 | AC-056 | ARC-011、OPS-008 |

存在Test Case ID只代表已設計覆蓋，不代表已通過。AC只有在對應案例已實際執行、Required Evidence完整且結果為PASS時才算完成；任何BLOCKED、NOT RUN或FAIL須在Phase報告及最終簽核中明確呈現。

---

## 9. Phase驗收批次與獨立結果

| UAT批次 | 對應PR Phase | 明確目標結果 | 執行案例 | 必要前置證據 |
| --- | --- | --- | --- | --- |
| UAT-0 Foundation Readiness | Phase P0 | 確認權限、Provider、Migration、狀態／數量、operation及lock proof可支持UAT；不驗收尚未開放的業務功能 | 進入準則檢查；AUTH-001～002 smoke | P0 provider contract、migration、Claim race、mixed Expiry、Serial及lock-order報告 |
| UAT-1 Queue & Picking | Phase P1 | 倉務人員可由Queue建立不超額工作，依FEFO／FIFO完成Allocation、Pick／Short、取消及Pick List，不改On Hand／SO Fulfilled | AUTH-001～008、QUEUE-001～010、ALLOC-001～013、PICK-001～010、LIFE-001～004、INQ-001～005／011～012、OPS-009～010 | P1 API／MySQL／concurrency／security／frontend及Inventory reconciliation證據 |
| UAT-2 Shipment & Atomic Issue | Phase P2 | 可選有效地址建立Shipment，Confirm後Inventory／Sales／Fulfillment原子一致；逾時及重送可由原event恢復 | AUTH-003～008、SHIP-001～012、CONF-001～014、LIFE-005～008、INQ-002～006／011～012、OPS-002／004～006／009～010 | Address／Item／Inventory contracts、100行atomic confirm、failure injection、Recovery及P95報告 |
| UAT-3 Reversal & Release | Phase P3 | 整張Reversal、Active／Archive查詢、Export、Audit、Archive、Reconciliation、容量及restore均可接受 | AUTH-001～008、REV-001～012、INQ-001～012、ARC-001～011、OPS-001～010，並重跑受影響P0核心案例 | Reversal原子性、730萬容量、50-user、安全、archive hash/count、backup/restore及reconciliation報告 |

每個Phase可獨立形成UAT測試報告及PR驗收決定。後一Phase不得以「前一Phase已通過」代替本次回歸；所有受變更影響的P0核心案例須重跑。UAT-0未證明Provider真實可用時，UAT-1～3保持BLOCKED，不以stub結果簽核。

---

## 10. 缺陷嚴重度與停止條件

| Severity | 定義 | 例子 |
| --- | --- | --- |
| S1 Critical | 資料不可恢復、越權、重複／負數／部分Inventory或Sales效果、錯誤歸檔或核心流程大範圍不可用 | 未授權Confirm；同Reservation被超額Claim；Shipment顯示SHIPPED但無Issue；Reversal重複回補；SO與Fulfillment分處Active／Archive |
| S2 High | 核心流程不能完成或狀態／數量／位置／冪等結果錯誤，且沒有可接受workaround | FEFO選錯Lot；短揀未回Queue；地址過時仍出貨；Archive中斷留下半份aggregate |
| S3 Medium | 次要功能錯誤但核心流程有安全workaround | 非主要filter錯誤、個別Audit缺少次要顯示欄、背景下載提示不清 |
| S4 Low | 不影響業務正確性的文字、對齊或輕微體驗問題 | 非關鍵文案、間距或列印外觀問題 |

遇到以下任一情況立即停止相關Phase並通知Product、Warehouse、Sales、Inventory、QA及Operations owner：未授權資料／操作、重複或部分Issue／Reversal、負數或無法解釋數量、錯誤Warehouse／Bin／Lot、unknown outcome無法恢復、Active／Archive遺失／重複、敏感資料洩漏，或測試環境疑似指向非測試資料。

---

## 11. 已知未測範圍與殘餘風險

- 本文件尚未執行，全部120項案例均為`NOT RUN`；目前release建議只能是`INSUFFICIENT EVIDENCE`。
- UAT不直接證明DB transaction、FK／trigger、lock order、commit-unknown、immutable records或730萬資料建置正確；須依賴獨立系統測試證據。
- Sales、Inventory及Customer正式Provider尚未落地或未通過contract tests時，所有依賴案例保持BLOCKED。
- Returns／Invoicing未上線時只驗證系統明確阻止Customer Return誤用Reversal，以及Downstream Matter設定符合已批准版本。
- 容量及restore結果受UAT環境代表性影響；環境、資料分佈、資源、負載及執行窗口必須連同結果保存。

---

## 12. 執行記錄與簽核

### 12.1 執行摘要

| Metric | Result |
| --- | --- |
| Build／Commit | — |
| Environment | — |
| Planned | 120 |
| Executed | 0 |
| Passed | 0 |
| Failed | 0 |
| Blocked | 0 |
| Not Run | 120 |
| S1 Open | — |
| S2 Open | — |
| Recommendation | INSUFFICIENT EVIDENCE |

### 12.2 Phase結果

| UAT批次 | Build／Commit | Environment | Test Window | Planned | Executed | PASS | FAIL | BLOCKED | NOT RUN | Recommendation |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| UAT-0 | — | — | — | — | 0 | 0 | 0 | 0 | — | INSUFFICIENT EVIDENCE |
| UAT-1 | — | — | — | — | 0 | 0 | 0 | 0 | — | INSUFFICIENT EVIDENCE |
| UAT-2 | — | — | — | — | 0 | 0 | 0 | 0 | — | INSUFFICIENT EVIDENCE |
| UAT-3 | — | — | — | — | 0 | 0 | 0 | 0 | — | INSUFFICIENT EVIDENCE |

`BLOCKED`表示因依賴、環境或前置證據不足而未能執行，不得與`FAIL`或`NOT RUN`混淆。

### 12.3 缺陷及例外

| Defect ID | Severity | Test Case ID | Environment／Build | Actual Result | Expected Result | Evidence | Owner／Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — |

### 12.4 簽核

| 簽核角色 | 姓名 | 決定 | 日期 | 備註／已接受風險 |
| --- | --- | --- | --- | --- |
| Warehouse／Fulfillment Owner | — | — | — | — |
| Sales Process Owner | — | — | — | — |
| Inventory Owner | — | — | — | — |
| Customer Data Owner | — | — | — | — |
| IT Operations | — | — | — | — |
| QA Lead | — | — | — | — |
| Product Owner | — | — | — | — |

簽核決定只可使用`GO`、`GO WITH KNOWN RISK`、`NO-GO`或`INSUFFICIENT EVIDENCE`。在全部P0／P1案例完成、S1／S2處理、56項AC覆蓋及殘餘風險獲owner接受前，不得把本文件視為通過證明。

---

## 13. Harness 2.0 正式 UAT 定義

本節把 §7 的 120 條業務驗收案例整理成穩定的 `UAT` 實體，作為 `08_traceability.json` 的 UAT 節點。§7 的表格仍然是案例細節、`Required Evidence`、`Actual Evidence` 及 `Status` 欄位的來源，執行結果只在該表回填。`mandatory`、`blocking`、`applicability`、`execution_surface`、`automation_suitability`、`suite_id` 及需求／技術就緒連結由 `08_traceability.json` 擁有，本節不重複這些可編輯值。

全部 120 條案例的 `execution_surface` 為 `UI_BROWSER`、`automation_suitability` 為 `MANUAL_REQUIRED`、`suite_id` 為 `null`：§1.2 明確規定 UAT 不得以直接 SQL、修改資料庫、取得 DB lock、檢查程式碼或直接呼叫 internal service 作為步驟，案例是由業務使用者在隔離 UAT 環境以可觀察業務頁完成的人工驗收。瀏覽器層的自動化驗證屬技術測試責任，由 `06_technical_test_cases.md` `TC-010` 承載；本專案目前未安裝 Playwright，該缺口記錄於 `00_gap_analysis.md` `GAP-TC-001`。自動化 PASS 從不等同業務驗收。


### 13.1 UAT ID 對照

| Harness ID | Legacy ID | 分組 | 優先級 | Phase |
| --- | --- | --- | --- | --- |
| UAT-001 | AUTH-001 | 權限、導航與安全 | P0 | 各Phase |
| UAT-002 | AUTH-002 | 權限、導航與安全 | P0 | 各Phase |
| UAT-003 | AUTH-003 | 權限、導航與安全 | P0 | P1～P3 |
| UAT-004 | AUTH-004 | 權限、導航與安全 | P0 | P1～P3 |
| UAT-005 | AUTH-005 | 權限、導航與安全 | P0 | 各Phase |
| UAT-006 | AUTH-006 | 權限、導航與安全 | P0 | P1～P3 |
| UAT-007 | AUTH-007 | 權限、導航與安全 | P0 | P1～P3 |
| UAT-008 | AUTH-008 | 權限、導航與安全 | P0 | P1～P3 |
| UAT-009 | QUEUE-001 | Fulfillment Queue及建立工作 | P1 | P1 |
| UAT-010 | QUEUE-002 | Fulfillment Queue及建立工作 | P0 | P1 |
| UAT-011 | QUEUE-003 | Fulfillment Queue及建立工作 | P1 | P1 |
| UAT-012 | QUEUE-004 | Fulfillment Queue及建立工作 | P1 | P1 |
| UAT-013 | QUEUE-005 | Fulfillment Queue及建立工作 | P0 | P1 |
| UAT-014 | QUEUE-006 | Fulfillment Queue及建立工作 | P0 | P1 |
| UAT-015 | QUEUE-007 | Fulfillment Queue及建立工作 | P0 | P1 |
| UAT-016 | QUEUE-008 | Fulfillment Queue及建立工作 | P0 | P1 |
| UAT-017 | QUEUE-009 | Fulfillment Queue及建立工作 | P0 | P1 |
| UAT-018 | QUEUE-010 | Fulfillment Queue及建立工作 | P0 | P1 |
| UAT-019 | ALLOC-001 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-020 | ALLOC-002 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-021 | ALLOC-003 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-022 | ALLOC-004 | Allocation、FEFO／FIFO及Reallocation | P1 | P1 |
| UAT-023 | ALLOC-005 | Allocation、FEFO／FIFO及Reallocation | P1 | P1 |
| UAT-024 | ALLOC-006 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-025 | ALLOC-007 | Allocation、FEFO／FIFO及Reallocation | P1 | P1 |
| UAT-026 | ALLOC-008 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-027 | ALLOC-009 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-028 | ALLOC-010 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-029 | ALLOC-011 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-030 | ALLOC-012 | Allocation、FEFO／FIFO及Reallocation | P1 | P1 |
| UAT-031 | ALLOC-013 | Allocation、FEFO／FIFO及Reallocation | P0 | P1 |
| UAT-032 | PICK-001 | Pick List、Pick Confirm及Short Pick | P1 | P1 |
| UAT-033 | PICK-002 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-034 | PICK-003 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-035 | PICK-004 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-036 | PICK-005 | Pick List、Pick Confirm及Short Pick | P1 | P1 |
| UAT-037 | PICK-006 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-038 | PICK-007 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-039 | PICK-008 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-040 | PICK-009 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-041 | PICK-010 | Pick List、Pick Confirm及Short Pick | P0 | P1 |
| UAT-042 | SHIP-001 | Shipment Draft及Shipping Address | P1 | P2 |
| UAT-043 | SHIP-002 | Shipment Draft及Shipping Address | P0 | P2 |
| UAT-044 | SHIP-003 | Shipment Draft及Shipping Address | P0 | P2 |
| UAT-045 | SHIP-004 | Shipment Draft及Shipping Address | P1 | P2 |
| UAT-046 | SHIP-005 | Shipment Draft及Shipping Address | P0 | P2 |
| UAT-047 | SHIP-006 | Shipment Draft及Shipping Address | P0 | P2 |
| UAT-048 | SHIP-007 | Shipment Draft及Shipping Address | P0 | P2 |
| UAT-049 | SHIP-008 | Shipment Draft及Shipping Address | P0 | P2 |
| UAT-050 | SHIP-009 | Shipment Draft及Shipping Address | P2 | P2 |
| UAT-051 | SHIP-010 | Shipment Draft及Shipping Address | P1 | P2 |
| UAT-052 | SHIP-011 | Shipment Draft及Shipping Address | P1 | P2 |
| UAT-053 | SHIP-012 | Shipment Draft及Shipping Address | P0 | P2 |
| UAT-054 | CONF-001 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-055 | CONF-002 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-056 | CONF-003 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-057 | CONF-004 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-058 | CONF-005 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-059 | CONF-006 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-060 | CONF-007 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-061 | CONF-008 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-062 | CONF-009 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-063 | CONF-010 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-064 | CONF-011 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-065 | CONF-012 | Shipment Confirm及正式出庫 | P1 | P2 |
| UAT-066 | CONF-013 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-067 | CONF-014 | Shipment Confirm及正式出庫 | P0 | P2 |
| UAT-068 | LIFE-001 | 取消、狀態及並發生命週期 | P1 | P1 |
| UAT-069 | LIFE-002 | 取消、狀態及並發生命週期 | P0 | P1 |
| UAT-070 | LIFE-003 | 取消、狀態及並發生命週期 | P0 | P1 |
| UAT-071 | LIFE-004 | 取消、狀態及並發生命週期 | P0 | P1 |
| UAT-072 | LIFE-005 | 取消、狀態及並發生命週期 | P0 | P2 |
| UAT-073 | LIFE-006 | 取消、狀態及並發生命週期 | P1 | P2 |
| UAT-074 | LIFE-007 | 取消、狀態及並發生命週期 | P0 | P2～P3 |
| UAT-075 | LIFE-008 | 取消、狀態及並發生命週期 | P0 | P1～P2 |
| UAT-076 | REV-001 | Shipment Reversal | P0 | P3 |
| UAT-077 | REV-002 | Shipment Reversal | P0 | P3 |
| UAT-078 | REV-003 | Shipment Reversal | P0 | P3 |
| UAT-079 | REV-004 | Shipment Reversal | P0 | P3 |
| UAT-080 | REV-005 | Shipment Reversal | P0 | P3 |
| UAT-081 | REV-006 | Shipment Reversal | P0 | P3 |
| UAT-082 | REV-007 | Shipment Reversal | P0 | P3 |
| UAT-083 | REV-008 | Shipment Reversal | P0 | P3 |
| UAT-084 | REV-009 | Shipment Reversal | P0 | P3 |
| UAT-085 | REV-010 | Shipment Reversal | P0 | P3 |
| UAT-086 | REV-011 | Shipment Reversal | P0 | P3 |
| UAT-087 | REV-012 | Shipment Reversal | P0 | P3 |
| UAT-088 | INQ-001 | 查詢、文件、匯出及Audit追溯 | P1 | P1～P3 |
| UAT-089 | INQ-002 | 查詢、文件、匯出及Audit追溯 | P1 | P1～P3 |
| UAT-090 | INQ-003 | 查詢、文件、匯出及Audit追溯 | P0 | P1～P3 |
| UAT-091 | INQ-004 | 查詢、文件、匯出及Audit追溯 | P0 | P1～P3 |
| UAT-092 | INQ-005 | 查詢、文件、匯出及Audit追溯 | P1 | P1 |
| UAT-093 | INQ-006 | 查詢、文件、匯出及Audit追溯 | P0 | P2～P3 |
| UAT-094 | INQ-007 | 查詢、文件、匯出及Audit追溯 | P0 | P3 |
| UAT-095 | INQ-008 | 查詢、文件、匯出及Audit追溯 | P0 | P3 |
| UAT-096 | INQ-009 | 查詢、文件、匯出及Audit追溯 | P2 | P3 |
| UAT-097 | INQ-010 | 查詢、文件、匯出及Audit追溯 | P0 | P3 |
| UAT-098 | INQ-011 | 查詢、文件、匯出及Audit追溯 | P0 | P1～P3 |
| UAT-099 | INQ-012 | 查詢、文件、匯出及Audit追溯 | P0 | P1～P3 |
| UAT-100 | ARC-001 | 歸檔、保留及查回 | P0 | P3 |
| UAT-101 | ARC-002 | 歸檔、保留及查回 | P0 | P3 |
| UAT-102 | ARC-003 | 歸檔、保留及查回 | P0 | P3 |
| UAT-103 | ARC-004 | 歸檔、保留及查回 | P0 | P3 |
| UAT-104 | ARC-005 | 歸檔、保留及查回 | P0 | P3 |
| UAT-105 | ARC-006 | 歸檔、保留及查回 | P0 | P3 |
| UAT-106 | ARC-007 | 歸檔、保留及查回 | P0 | P3 |
| UAT-107 | ARC-008 | 歸檔、保留及查回 | P1 | P3 |
| UAT-108 | ARC-009 | 歸檔、保留及查回 | P0 | P3 |
| UAT-109 | ARC-010 | 歸檔、保留及查回 | P1 | P3 |
| UAT-110 | ARC-011 | 歸檔、保留及查回 | P0 | P3 |
| UAT-111 | OPS-001 | 效能、可用性、恢復及UI／UX | P1 | P1～P3 |
| UAT-112 | OPS-002 | 效能、可用性、恢復及UI／UX | P1 | P1～P3 |
| UAT-113 | OPS-003 | 效能、可用性、恢復及UI／UX | P1 | P1～P3 |
| UAT-114 | OPS-004 | 效能、可用性、恢復及UI／UX | P1 | P1～P2 |
| UAT-115 | OPS-005 | 效能、可用性、恢復及UI／UX | P0 | P1～P3 |
| UAT-116 | OPS-006 | 效能、可用性、恢復及UI／UX | P1 | P2～P3 |
| UAT-117 | OPS-007 | 效能、可用性、恢復及UI／UX | P0 | P3 |
| UAT-118 | OPS-008 | 效能、可用性、恢復及UI／UX | P0 | P3 |
| UAT-119 | OPS-009 | 效能、可用性、恢復及UI／UX | P1 | P1～P3 |
| UAT-120 | OPS-010 | 效能、可用性、恢復及UI／UX | P1 | P1～P3 |

### 13.2 正式定義


## UAT-001 — 未登入存取（AUTH-001）

### Business objective and actor
角色：未登入。業務目標／風險：SEC-001；未登入存取。執行批次：各Phase；案例優先級：P0。（Legacy identity：`AUTH-001`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：已登出。測試資料：所有Fulfillment／Shipment／Archive URL（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
直接開啟各頁

### Expected business result
導向登入或顯示未登入；沒有任何業務資料可見

### Acceptance criteria
必要證據：URL、登入導向及畫面。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-002 — 權限不隨角色名稱取得（AUTH-002）

### Business objective and actor
角色：U-NONE／U-SYS。業務目標／風險：SEC-001～003；權限不隨角色名稱取得。執行批次：各Phase；案例優先級：P0。（Legacy identity：`AUTH-002`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：兩角色沒有Fulfillment permission。測試資料：Sidebar及各頁URL（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
登入後檢查menu，再直接開各URL

### Expected business result
Menu不顯示；直接URL拒絕；System Administrator不自動取得能力

### Acceptance criteria
必要證據：角色設定、menu及拒絕畫面。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-003 — 只讀邊界（AUTH-003）

### Business objective and actor
角色：U-VIEW。業務目標／風險：SEC-001～004、AC-048；只讀邊界。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`AUTH-003`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：已有各狀態資料。測試資料：Queue、Fulfillment、Shipment、Archive、Export（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
查詢、列印、匯出，再嘗試建立、分配、揀貨、取消、出貨及Reversal

### Expected business result
查詢／列印／本人匯出成功；所有write不可用且直接提交仍拒絕；資料不變

### Acceptance criteria
必要證據：權限、成功查詢、拒絕及前後狀態。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-004 — 最小權限（AUTH-004）

### Business objective and actor
角色：U-OP／U-REV／U-FEFO／U-SUP。業務目標／風險：SEC-002～005；最小權限。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`AUTH-004`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：四個獨立角色。測試資料：各角色專屬及非專屬操作（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別嘗試一般作業、FEFO偏離、Shipment Reversal及查看資料

### Expected business result
每人只可完成明確獲授權能力；`operation`、`reverse`及FEFO override互不包含

### Acceptance criteria
必要證據：角色矩陣、可用actions及拒絕畫面。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-005 — 提交點重驗（AUTH-005）

### Business objective and actor
角色：U-STALE。業務目標／風險：SEC-004、AC-048；提交點重驗。執行批次：各Phase；案例優先級：P0。（Legacy identity：`AUTH-005`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：已載入可提交頁。測試資料：Create、Allocate、Pick、Confirm、Reverse（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
管理員撤權或停用後，由原頁提交

### Expected business result
清楚拒絕並提示重新登入／聯絡管理員；沒有Claim、Allocation、Issue、Reversal或成功Audit效果

### Acceptance criteria
必要證據：撤權時間、錯誤及前後業務頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-006 — 水平IDOR（AUTH-006）

### Business objective and actor
角色：U-OP／U-VIEW。業務目標／風險：SEC-005、AC-049；水平IDOR。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`AUTH-006`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：有CUST-A／CUST-B及WH-A／WH-B資料。測試資料：替換SO、Fulfillment、Line、Claim、Allocation、Shipment、Address、Movement ID（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
以瀏覽器可操作方式替換URL或表單ID並讀取／提交

### Expected business result
跨Customer／Warehouse／aggregate資料不可讀寫；外部訊息不透露目標是否存在；資料不變

### Acceptance criteria
必要證據：URL／輸入、拒絕及前後詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-007 — 敏感資料及技術細節（AUTH-007）

### Business objective and actor
角色：U-VIEW／U-OPS。業務目標／風險：SEC-006～012；敏感資料及技術細節。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`AUTH-007`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：有地址、Contact及技術失敗事件。測試資料：正常詳情、Audit、operation錯誤（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
兩角色分別查看列表、詳情、History、Audit及失敗結果

### Expected business result
U-VIEW只見業務狀態；U-OPS只見安全技術摘要；均不見銀行、Token、SQL、stack、完整地址payload或內部路徑

### Acceptance criteria
必要證據：兩角色畫面及安全錯誤。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-008 — XSS／CSV輸入（AUTH-008）

### Business objective and actor
角色：U-OP／U-VIEW。業務目標／風險：SEC-006～012、AC-050；XSS／CSV輸入。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`AUTH-008`，詳見 §7 權限、導航與安全。）

### Preconditions and data
前置條件：可在notes、reason、carrier、tracking保存測試文字。測試資料：TEXT-RISK（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
輸入後在列表、詳情、列印及CSV查看／安全開啟

### Expected business result
畫面與列印只顯示文字不執行script；CSV公式不執行；Unicode可讀且敏感資料不外洩

### Acceptance criteria
必要證據：輸入、各輸出畫面及CSV。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-009 — Queue正確性（QUEUE-001）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-QUEUE-001～003、AC-001；Queue正確性。執行批次：P1；案例優先級：P1。（Legacy identity：`QUEUE-001`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：SO-FULL有未分配Reservation。測試資料：SO-FULL（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開Queue，以SO／Customer／Warehouse搜尋

### Expected business result
顯示正確SO、Customer、Warehouse、日期、狀態、Reserved／Backorder／Fulfilled／Fulfillable及更新時間

### Acceptance criteria
必要證據：Queue條件、結果及SO詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-010 — 純Backorder不可履約（QUEUE-002）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-QUEUE-004、AC-002；純Backorder不可履約。執行批次：P1；案例優先級：P0。（Legacy identity：`QUEUE-002`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：SO-BACKORDER沒有Reservation。測試資料：SO-BACKORDER（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
搜尋並嘗試建立工作

### Expected business result
Queue不提供可建數量；直接提交亦拒絕並顯示最新Reserved／Backorder

### Acceptance criteria
必要證據：Queue、拒絕及SO數量。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-011 — 混合可履約量（QUEUE-003）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-QUEUE-001～004；混合可履約量。執行批次：P1；案例優先級：P1。（Legacy identity：`QUEUE-003`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：SO-MIXED一行Reserved、一行純Backorder。測試資料：SO-MIXED（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開Queue並展開lines

### Expected business result
只可選有未分配Reservation的數量；Backorder清楚顯示但不可被本次工作claim

### Acceptance criteria
必要證據：Queue line摘要及選擇控制。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-012 — 部分Lines建立（QUEUE-004）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-QUEUE-005／007、AC-003；部分Lines建立。執行批次：P1；案例優先級：P1。（Legacy identity：`QUEUE-004`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：SO-FULL有3 lines及足夠Reservation。測試資料：選line 1全部、line 2部分（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
建立Fulfillment並開詳情

### Expected business result
只建立一張屬該SO／Customer／Warehouse的DRAFT；只含所選lines／quantities及唯一number

### Acceptance criteria
必要證據：建立表單、成功訊息及詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-013 — 超額拒絕（QUEUE-005）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-QUEUE-006、AC-004；超額拒絕。執行批次：P1；案例優先級：P0。（Legacy identity：`QUEUE-005`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：可履約量5。測試資料：輸入6（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交建立

### Expected business result
精確指出數量已超出；不建立工作、不佔用任何Reservation，Queue仍顯示5

### Acceptance criteria
必要證據：錯誤、Queue及SO／Inventory前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-014 — 並發overclaim（QUEUE-006）

### Business objective and actor
角色：兩名U-OP。業務目標／風險：FR-QUEUE-006／010、AC-005；並發overclaim。執行批次：P1；案例優先級：P0。（Legacy identity：`QUEUE-006`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：同一Reservation可履約量5。測試資料：A／B各建立5（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
兩人同時開頁並提交

### Expected business result
最多一人成功；另一人收到可理解的quantity/version conflict並可reload；總Planned不超5

### Acceptance criteria
必要證據：兩個結果、兩張頁面及最終Queue／詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-015 — 重送（QUEUE-007）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-QUEUE-009、AC-006；重送。執行批次：P1；案例優先級：P0。（Legacy identity：`QUEUE-007`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：EVT-A首次建立成功。測試資料：同event同內容（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
雙擊或在逾時後以原event重試

### Expected business result
返回原Fulfillment／number；不建立第二張工作或重複Claim

### Acceptance criteria
必要證據：兩次結果、Fulfillment搜尋及Queue。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-016 — event衝突（QUEUE-008）

### Business objective and actor
角色：U-OP。業務目標／風險：BR-025；event衝突。執行批次：P1；案例優先級：P0。（Legacy identity：`QUEUE-008`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：EVT-A已用於quantity5。測試資料：同event改quantity4或另一SO（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
再次提交

### Expected business result
明確衝突；原Fulfillment不被修改，沒有新工作或新Claim

### Acceptance criteria
必要證據：衝突訊息、原詳情及搜尋結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-017 — 載入後資料改變（QUEUE-009）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-QUEUE-010；載入後資料改變。執行批次：P1；案例優先級：P0。（Legacy identity：`QUEUE-009`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：使用者已載入SO-FULL。測試資料：另一流程先改Reservation／SO version（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
在舊頁提交

### Expected business result
過時提交被拒絕並要求reload；不建立部分Fulfillment或錯誤Claim

### Acceptance criteria
必要證據：舊頁、錯誤及刷新後Queue。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-018 — 建立無庫存效果（QUEUE-010）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-QUEUE-012、AC-007；建立無庫存效果。執行批次：P1；案例優先級：P0。（Legacy identity：`QUEUE-010`，詳見 §7 Fulfillment Queue及建立工作。）

### Preconditions and data
前置條件：已記錄SO／Inventory初值。測試資料：成功建立DRAFT（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
建立後查看SO及Inventory

### Expected business result
Ordered、Fulfilled、Backorder、On Hand及Reservation outstanding均未因建立動作改變；只多DRAFT工作／Claim

### Acceptance criteria
必要證據：建立前後SO、Inventory及Fulfillment。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-019 — FEFO正確性（ALLOC-001）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-001～002、AC-008；FEFO正確性。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-001`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：FUL-DRAFT含SKU-EXP。測試資料：LOT-EARLY／MID／LATE均合資格（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開Allocation候選並使用建議

### Expected business result
LOT-EARLY最先且rank／expiry／Bin清楚；建議量不超Planned／Reservation

### Acceptance criteria
必要證據：候選順序、所選結果及Inventory Lot頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-020 — FIFO正確性（ALLOC-002）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-002、AC-009；FIFO正確性。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-002`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：FUL-DRAFT含無Expiry SKU。測試資料：LOT-NOEXP-OLD／NEW（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開候選並使用建議

### Expected business result
最早First Receipt的合資格庫存排先；顯示穩定Lot／Bin次序

### Acceptance criteria
必要證據：候選順序及Inventory receipt資料。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-021 — mixed Expiry排序（ALLOC-003）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-002；mixed Expiry排序。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-003`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：同SKU同時有Expiry及無Expiry候選。測試資料：LOT-EARLY／MID及LOT-NOEXP-OLD（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開候選

### Expected business result
所有合資格Expiry候選先按FEFO，其後無Expiry才按FIFO；不因Bin code打亂策略

### Acceptance criteria
必要證據：完整候選清單及排序欄。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-022 — 穩定tie-break（ALLOC-004）

### Business objective and actor
角色：U-OP。業務目標／風險：BR-014；穩定tie-break。執行批次：P1；案例優先級：P1。（Legacy identity：`ALLOC-004`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：多筆候選有相同Expiry或First Receipt。測試資料：相同日期、不同Lot／Bin（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
重複開頁、刷新及分頁

### Expected business result
每次順序一致，Lot／Bin tie-break可預期；沒有候選遺漏或重複

### Acceptance criteria
必要證據：多次候選截圖／錄影。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-023 — 多Bin／Lot（ALLOC-005）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-003、AC-010；多Bin／Lot。執行批次：P1；案例優先級：P1。（Legacy identity：`ALLOC-005`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：單一Bin不足但多Bin合計足夠。測試資料：SKU-BATCH同Lot在BIN-A1／A2（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
接受多筆候選並提交

### Expected business result
一行由多個Bin／Lot組成完整Allocation，總量等於Planned且均屬WH-A

### Acceptance criteria
必要證據：Allocation詳情、quantity summary及Inventory頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-024 — 不合資格永遠拒絕（ALLOC-006）

### Business objective and actor
角色：U-OP／U-FEFO。業務目標／風險：FR-PICK-004、AC-011／014；不合資格永遠拒絕。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-006`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：有各類不合資格stock。測試資料：LOT-EXPIRED／LOW、STOCK-BAD、WH-B庫存（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
逐類選擇或竄改候選後提交

### Expected business result
Expired、低效期、Quarantined、Damaged、Inactive、Counting、錯Warehouse及不足庫存全部拒絕；有override亦不可繞過

### Acceptance criteria
必要證據：各次錯誤、Allocation及Inventory前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-025 — FIFO偏離（ALLOC-007）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-005、AC-013；FIFO偏離。執行批次：P1；案例優先級：P1。（Legacy identity：`ALLOC-007`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：無Expiry候選且舊批合資格。測試資料：改選LOT-NOEXP-NEW，先空原因再填REASON（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別提交

### Expected business result
無原因拒絕；填原因後一般U-OP可成功，Audit保存推薦舊批、實選新批、actor、reason及time

### Acceptance criteria
必要證據：兩次結果、Allocation及Audit。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-026 — FEFO越權（ALLOC-008）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-005、AC-012；FEFO越權。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-008`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：最早與較晚Expiry均合資格。測試資料：改選LOT-LATE並填REASON（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交

### Expected business result
因缺`inventory.fefo.override`拒絕；不保存任何例外Allocation或Audit成功效果

### Acceptance criteria
必要證據：權限、錯誤及前後Allocation。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-027 — 受權FEFO偏離（ALLOC-009）

### Business objective and actor
角色：U-FEFO。業務目標／風險：FR-PICK-005／012、AC-013；受權FEFO偏離。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-009`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：最早與較晚Expiry均合資格。測試資料：改選LOT-LATE；REASON（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交

### Expected business result
成功；Audit／History同時保存推薦與實選、strategy、rank、permission、reason及Inventory reference

### Acceptance criteria
必要證據：Allocation、History及Audit。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-028 — 多行原子性（ALLOC-010）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-006、AC-015；多行原子性。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-010`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：FUL-DRAFT有3 lines，其中一行不足。測試資料：兩行足夠、一行不足（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交整批Allocation

### Expected business result
顯示不足line及缺量；任何line均未留下Allocation，Fulfillment仍DRAFT

### Acceptance criteria
必要證據：錯誤、三行詳情及Inventory前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-029 — Allocation不出庫（ALLOC-011）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-007、AC-016；Allocation不出庫。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-011`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：所有lines成功Allocation。測試資料：FUL-DRAFT（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交後查看Inventory及SO

### Expected business result
Fulfillment轉PICKING；On Hand、Reservation consumed及SO Fulfilled不變，只有Inventory Allocation／本地projection建立

### Acceptance criteria
必要證據：前後SO、Inventory及Fulfillment。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-030 — 成功Reallocation（ALLOC-012）

### Business objective and actor
角色：U-OP／U-FEFO。業務目標／風險：FR-PICK-011～012；成功Reallocation。執行批次：P1；案例優先級：P1。（Legacy identity：`ALLOC-012`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：PICKING且尚未Pick Confirm。測試資料：由BIN-A1改到合資格BIN-A2，適用時填原因（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
重新取得候選並提交

### Expected business result
舊Allocation完整release、新Allocation完整建立；總量不變，History／Audit可見前後及原因

### Acceptance criteria
必要證據：前後Allocation、History、Inventory頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-031 — Reallocation失敗／競爭（ALLOC-013）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICK-011、BR-023～027；Reallocation失敗／競爭。執行批次：P1；案例優先級：P0。（Legacy identity：`ALLOC-013`，詳見 §7 Allocation、FEFO／FIFO及Reallocation。）

### Preconditions and data
前置條件：PICKING且舊Allocation有效。測試資料：新候選在提交前失效，或與取消同時發生（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交Reallocation

### Expected business result
整筆失敗；舊Allocation完整保留或只有一個競爭操作成功，無空窗、部分新Allocation或數量失衡

### Acceptance criteria
必要證據：錯誤、最終Allocation、History及Inventory。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-032 — Pick List一致（PICK-001）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-PICK-008～010、AC-017；Pick List一致。執行批次：P1；案例優先級：P1。（Legacy identity：`PICK-001`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：FUL-PICKING有多Bin／Lot Allocation。測試資料：100行內代表性資料（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開啟A4 Pick List預覽並列印

### Expected business result
Fulfillment／SO／Customer／Warehouse／SKU／Planned／Bin／Lot／Expiry／sequence／notes與Allocation一致，按Bin／Lot／SKU穩定排序

### Acceptance criteria
必要證據：詳情、預覽及列印樣本。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-033 — 完整揀貨（PICK-002）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-001／005～006、AC-018；完整揀貨。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-002`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：FUL-PICKING所有貨已按Allocation找到。測試資料：actual picked＝allocated（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
輸入並確認

### Expected business result
全部成功後Fulfillment轉PICKED，逐行Picked正確；On Hand、Reservation consumed及SO Fulfilled仍不變

### Acceptance criteria
必要證據：Pick表單、詳情、SO及Inventory前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-034 — Short原因必填（PICK-003）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-003、AC-019；Short原因必填。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-003`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：一筆實揀少於Allocated。測試資料：allocated 10、picked 7、空原因（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交

### Expected business result
精確指出Short Pick Reason必填；狀態及所有Allocation／Picked數量不變

### Acceptance criteria
必要證據：錯誤及前後詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-035 — Short成功（PICK-004）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-003～006、AC-019；Short成功。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-004`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：同PICK-003。測試資料：picked 7、REASON（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
填原因再提交並查看Queue

### Expected business result
Fulfillment轉PICKED；Picked 7、Short 3；差額Allocation release並回Queue，原Reservation outstanding不被釋放，On Hand不變

### Acceptance criteria
必要證據：Fulfillment、Queue、Inventory Reservation／Allocation及History。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-036 — 個別0有效（PICK-005）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-001～002；個別0有效。執行批次：P1；案例優先級：P1。（Legacy identity：`PICK-005`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：多個Allocations且其他筆picked>0。測試資料：一筆0、其他筆正數（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交

### Expected business result
允許該Allocation picked=0並按Short規則處理；整張因至少一筆正數可完成

### Acceptance criteria
必要證據：表單、quantity summary及詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-037 — 全0拒絕（PICK-006）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-002、AC-020；全0拒絕。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-006`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：FUL-PICKING。測試資料：全部picked=0及原因（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交

### Expected business result
不可進PICKED；提示取消工作及處理現場差異，不自動取消或改庫存

### Acceptance criteria
必要證據：錯誤、狀態及Inventory前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-038 — 數量／集合完整（PICK-007）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-001；數量／集合完整。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-007`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：FUL-PICKING有多筆Allocation。測試資料：負數、超額、小數、遺漏一筆ID（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別提交

### Expected business result
每次均精確拒絕；遺漏不當0，任何Picked／release／state均不部分保存

### Acceptance criteria
必要證據：各錯誤及前後詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-039 — 冪等（PICK-008）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-008～009、AC-021；冪等。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-008`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：EVT-A首次Pick成功。測試資料：同event同內容及同event異內容（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別重送

### Expected business result
同內容返回原結果且不累加Picked／重複release；異內容明確衝突且原結果不變

### Acceptance criteria
必要證據：多次結果、History、Allocation及Queue。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-040 — 版本／並發（PICK-009）

### Business objective and actor
角色：兩名U-OP。業務目標／風險：BR-023／027；版本／並發。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-009`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：兩人載入同一FUL-PICKING version。測試資料：A full pick、B short pick（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
A先提交，B以舊頁提交

### Expected business result
A成功；B收到version/state conflict且不覆蓋A；最終只有一組Pick及History

### Acceptance criteria
必要證據：兩個頁面、衝突及最終詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-041 — PICKED不可直接修改（PICK-010）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-PICKCONF-007；PICKED不可直接修改。執行批次：P1；案例優先級：P0。（Legacy identity：`PICK-010`，詳見 §7 Pick List、Pick Confirm及Short Pick。）

### Preconditions and data
前置條件：FUL-PICKED尚無Shipment。測試資料：原Picked quantities及reason（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
返回表單嘗試修改數量／原因

### Expected business result
開啟修改入口或直接提交均被拒絕；提示按取消並重建正式流程，歷史不變

### Acceptance criteria
必要證據：UI actions、拒絕及前後詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-042 — 由PICKED建Shipment（SHIP-001）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-001／003、AC-022；由PICKED建Shipment。執行批次：P2；案例優先級：P1。（Legacy identity：`SHIP-001`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：FUL-PICKED屬SO-FULL／CUST-A／WH-A。測試資料：已揀多lines／bins／lots（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
建立Shipment並開詳情

### Expected business result
建立DRAFT及唯一Shipment Number，只帶入該Fulfillment／SO／Customer／Warehouse與完整Picked quantities

### Acceptance criteria
必要證據：建立頁、成功訊息及詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-043 — 錯誤狀態（SHIP-002）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-001；錯誤狀態。執行批次：P2；案例優先級：P0。（Legacy identity：`SHIP-002`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：Fulfillment分別為DRAFT、PICKING、CANCELLED、SHIPPED、REVERSED。測試資料：各狀態工作（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試建立Shipment

### Expected business result
全部拒絕且說明狀態；沒有Shipment或其他業務效果

### Acceptance criteria
必要證據：各次錯誤及搜尋結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-044 — 唯一有效Shipment（SHIP-003）

### Business objective and actor
角色：兩名U-OP。業務目標／風險：FR-SHIP-002、AC-023、GATE-001；唯一有效Shipment。執行批次：P2；案例優先級：P0。（Legacy identity：`SHIP-003`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：FUL-PICKED尚無Shipment。測試資料：A／B同時建立；另以原event重送（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
同時提交及重試

### Expected business result
最多一張非CANCELLED Shipment；same intent返回既有記錄，其他事件顯示已有Shipment，不分配可用第二張

### Acceptance criteria
必要證據：兩個結果、Fulfillment及Shipment搜尋。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-045 — 默認地址（SHIP-004）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-004、AC-024；默認地址。執行批次：P2；案例優先級：P1。（Legacy identity：`SHIP-004`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：CUST-A有ADDR-DEF／ALT。測試資料：FUL-PICKED（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
建立Shipment

### Expected business result
預選ADDR-DEF並顯示屬CUST-A的Active shipping地址；可改選ADDR-ALT

### Acceptance criteria
必要證據：地址選項及Shipment Draft。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-046 — 跨客戶地址（SHIP-005）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-004／007、AC-024／027；跨客戶地址。執行批次：P2；案例優先級：P0。（Legacy identity：`SHIP-005`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：CUST-A Shipment及CUST-B地址。測試資料：ADDR-B（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試透過可操作方式替換地址ID並保存／確認

### Expected business result
地址不在選項；提交拒絕且不透露CUST-B資料，不靜默改回default

### Acceptance criteria
必要證據：地址列表、拒絕及Draft前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-047 — 沒有有效地址（SHIP-006）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-005、AC-025；沒有有效地址。執行批次：P2；案例優先級：P0。（Legacy identity：`SHIP-006`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：FUL-PICKED屬CUST-NOADDR。測試資料：無地址（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開Shipment流程並嘗試Confirm

### Expected business result
PICKED工作可保留；不能確認出貨，清楚提示先維護Customer Shipping Address並提供入口

### Acceptance criteria
必要證據：Shipment頁、錯誤及Customer入口。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-048 — 禁止臨時地址（SHIP-007）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-005、AC-026；禁止臨時地址。執行批次：P2；案例優先級：P0。（Legacy identity：`SHIP-007`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：CUST-A有正式地址。測試資料：自由文字地址／改寫address text（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試輸入或竄改提交

### Expected business result
UI沒有自由地址欄；直接提交未知地址欄位被拒絕，不建立臨時地址或快照

### Acceptance criteria
必要證據：表單、錯誤及Customer地址頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-049 — 地址／Contact過時（SHIP-008）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-007、AC-027；地址／Contact過時。執行批次：P2；案例優先級：P0。（Legacy identity：`SHIP-008`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：Draft已選ADDR-DEF／CONTACT-DEF。測試資料：管理員停用、改用途、改owner或改version（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
不刷新頁面直接Confirm

### Expected business result
每種變更均被拒絕並要求重新選擇；不自動替代、不Issue、不改SO

### Acceptance criteria
必要證據：舊頁、錯誤、主檔變更及業務前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-050 — Contact選填（SHIP-009）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-006、AC-028；Contact選填。執行批次：P2；案例優先級：P2。（Legacy identity：`SHIP-009`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：CUST-A有default contact；另有Customer無contact。測試資料：CONTACT-DEF／ALT／空（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
建Shipment、改選及清空Contact

### Expected business result
有default時預選且可改；無Contact或清空仍可保存／確認，選用時只接受有效shipping contact

### Acceptance criteria
必要證據：三種表單及結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-051 — 物流欄位選填（SHIP-010）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-008～010、AC-029；物流欄位選填。執行批次：P2；案例優先級：P1。（Legacy identity：`SHIP-010`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：其他資料有效。測試資料：carrier／tracking／package／weight全空（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
保存並Confirm

### Expected business result
不因全部選填欄位為空而拒絕；成功文件不虛構物流資料

### Acceptance criteria
必要證據：表單、Shipment結果及文件。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-052 — 欄位邊界（SHIP-011）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-009、AC-030；欄位邊界。執行批次：P2；案例優先級：P1。（Legacy identity：`SHIP-011`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：SHIP-DRAFT。測試資料：package 0／負／小數；weight 0／負／無UOM；合法1及正weight（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別保存

### Expected business result
無效值有精確field error且不改Picked資料；合法邊界成功

### Acceptance criteria
必要證據：各輸入、錯誤及Draft詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-053 — Draft修改／取消（SHIP-012）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-SHIP-012、FR-LIFE-004、AC-031／041；Draft修改／取消。執行批次：P2；案例優先級：P0。（Legacy identity：`SHIP-012`，詳見 §7 Shipment Draft及Shipping Address。）

### Preconditions and data
前置條件：SHIP-DRAFT且已記錄SO／Inventory初值。測試資料：改ADDR-ALT、物流資料後取消（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
修改、查看History，再取消

### Expected business result
只允許Draft欄位改動；取消後Shipment=CANCELLED、Fulfillment=PICKED且可重建；SO Fulfilled／On Hand／Reservation不變

### Acceptance criteria
必要證據：修改／取消前後詳情、SO及Inventory。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-054 — 單行正式出庫（CONF-001）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-001～003、AC-032；單行正式出庫。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-001`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：有效SHIP-DRAFT及一筆Allocation。測試資料：SKU-NONE、BIN-A1、qty 5（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
記錄前值後確認

### Expected business result
Shipment／Fulfillment轉SHIPPED；原BIN-A1 On Hand減5、Reservation consumed加5／outstanding減5、SO Fulfilled加5且Movement來源可追

### Acceptance criteria
必要證據：Confirm結果、SO、Inventory、Movement及詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-055 — 多Bin／Lot數量守恆（CONF-002）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-008～013、AC-032；多Bin／Lot數量守恆。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-002`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：有效SHIP-DRAFT含多lines／allocations。測試資料：SKU-BATCH／EXP跨BIN-A1／A2及Lots（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
確認後逐行對賬

### Expected business result
每行Shipped＝Picked＝成功Issues總和；只扣原Allocation buckets，Claims consumed及Sales／Inventory數量全部一致

### Acceptance criteria
必要證據：前後quantity表、Movement、Issues及SO。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-056 — 多行原子失敗（CONF-003）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-009、AC-033；多行原子失敗。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-003`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：3-line Shipment，第三行可由QA受控令Issue驗證失敗。測試資料：前兩行有效、第三行失效（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
確認

### Expected business result
沒有任何line部分Issue；Shipment／Fulfillment不顯示SHIPPED，SO及所有On Hand／Reservation保持前值

### Acceptance criteria
必要證據：錯誤、三行Movement搜尋及前後數量。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-057 — 地址提交重驗（CONF-004）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-004、AC-027；地址提交重驗。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-004`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：SHIP-DRAFT已載入。測試資料：ADDR-DEF在提交前停用／改owner／改version（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
確認

### Expected business result
拒絕並要求重選；不用過時snapshot或default替代，沒有Inventory／Sales效果

### Acceptance criteria
必要證據：地址變更、錯誤及前後數量。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-058 — Allocation提交重驗（CONF-005）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-003／005；Allocation提交重驗。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-005`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：SHIP-DRAFT已載入。測試資料：原Allocation／Bin／Lot／version在提交前失效（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
確認

### Expected business result
拒絕並導向重新分配；不自動改選其他Bin／Lot，不產生部分Issue或SO增量

### Acceptance criteria
必要證據：錯誤、Allocation及Inventory／SO前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-059 — Item／Bin資格重驗（CONF-006）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-002～003、GATE-007；Item／Bin資格重驗。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-006`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：Draft含可被改狀態資料。測試資料：SKU轉Serial／Archived／non-tracked，Bin轉Counting／Inactive，Lot失效（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
逐種變更後確認

### Expected business result
每種均fail closed並給可行動訊息；不出貨、不換bucket、不留下部分結果

### Acceptance criteria
必要證據：主檔變更、錯誤及前後業務頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-060 — 雙擊／重送（CONF-007）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-007、AC-034；雙擊／重送。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-007`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：有效SHIP-DRAFT及EVT-A。測試資料：快速雙擊、同event同內容重送（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交並等待兩個結果

### Expected business result
只產生一組Issues、一次Reservation consume及一次SO Fulfilled增量；兩次均路由原結果

### Acceptance criteria
必要證據：兩個回應、Movement count、SO及Shipment。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-061 — event／idempotency衝突（CONF-008）

### Business objective and actor
角色：U-OP。業務目標／風險：BR-025；event／idempotency衝突。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-008`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：EVT-A已有確認意圖。測試資料：同event改Shipment、version、address或payload（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
再次提交

### Expected business result
明確衝突；不修改原Shipment／operation，不產生額外Issues

### Acceptance criteria
必要證據：衝突訊息、原結果及Movement搜尋。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-062 — 逾時／結果不明（CONF-009）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-006／015、AC-035；逾時／結果不明。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-009`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：QA可受控令commit結果不明。測試資料：SHIP-DRAFT、EVT-A（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
Confirm至逾時，再刷新／重新登入

### Expected business result
顯示SHIPPING、Correlation及查詢中狀態，不顯示虛假SHIPPED／FAILED，不允許修改、取消或新event confirm

### Acceptance criteria
必要證據：逾時及刷新畫面、Correlation、禁用actions。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-063 — 原event恢復（CONF-010）

### Business objective and actor
角色：U-OP／U-OPS。業務目標／風險：FR-CONF-015、AC-035；原event恢復。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-010`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：CONF-009後依賴恢復或worker重啟。測試資料：原EVT-A（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
依畫面指引查詢並等待Recovery

### Expected business result
最終收斂為唯一成功或可證明失敗；成功只一組效果，失敗無效果；不要求使用者建立新event

### Acceptance criteria
必要證據：處理中及最終畫面、SO／Inventory／Movement。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-064 — 永久業務失敗（CONF-011）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-016；永久業務失敗。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-011`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：Draft可由受控方式觸發明確business rejection。測試資料：Address不可用或Allocation不足（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
確認並查看結果

### Expected business result
Shipment回可修正DRAFT並顯示具體下一步；Operation為失敗結果，沒有Inventory／Sales成功效果

### Acceptance criteria
必要證據：錯誤、Draft、operation及前後數量。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-065 — 歷史快照（CONF-012）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-CONF-012、AC-036；歷史快照。執行批次：P2；案例優先級：P1。（Legacy identity：`CONF-012`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：Shipment已SHIPPED。測試資料：後續修改Customer／Address／SKU／Warehouse／Lot顯示名稱或停用（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開Shipment及Delivery Note

### Expected business result
仍顯示確認時Customer、Address／Contact、SKU／UOM、Warehouse／Bin／Lot／Expiry／Status快照及actor/time

### Acceptance criteria
必要證據：修改前後主檔、Shipment及文件。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-066 — 部分履約（CONF-013）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-013～014、AC-037；部分履約。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-013`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：SO仍有其他Reserved未出貨量。測試資料：本次只出部分lines／quantities（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
確認後查看SO及Queue

### Expected business result
SO為PARTIALLY_FULFILLED；本次量只增加一次，剩餘Reservation可再次由Queue建立新Fulfillment

### Acceptance criteria
必要證據：Shipment、SO quantities/status及Queue。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-067 — 全部履約（CONF-014）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-CONF-013～014、AC-038；全部履約。執行批次：P2；案例優先級：P0。（Legacy identity：`CONF-014`，詳見 §7 Shipment Confirm及正式出庫。）

### Preconditions and data
前置條件：本次為SO最後未履約有效量。測試資料：最後Shipment（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
確認後查看SO

### Expected business result
全部有效量Fulfilled，SO依Sales規則轉COMPLETED；Ordered／Cancelled不被改寫，Queue不再提供已完成量

### Acceptance criteria
必要證據：最後Shipment、SO數量／狀態及Queue。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-068 — DRAFT取消（LIFE-001）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-LIFE-001；DRAFT取消。執行批次：P1；案例優先級：P1。（Legacy identity：`LIFE-001`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：FUL-DRAFT有active Claims、無Allocation／Shipment。測試資料：一般取消（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
取消並刷新Queue

### Expected business result
Fulfillment=CANCELLED，Claims release；Reservation outstanding／On Hand／SO quantities不變，可履約量回Queue

### Acceptance criteria
必要證據：取消前後Fulfillment、Queue、SO及Inventory。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-069 — PICKING取消（LIFE-002）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-LIFE-001～002、AC-039；PICKING取消。執行批次：P1；案例優先級：P0。（Legacy identity：`LIFE-002`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：FUL-PICKING尚未實際揀貨。測試資料：空原因及REASON（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
先空原因提交，再填原因取消

### Expected business result
空原因拒絕；合法原因後所有未耗用Allocation release才轉CANCELLED，數量回Queue

### Acceptance criteria
必要證據：兩次結果、Allocation、Queue及History。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-070 — PICKED現場放回（LIFE-003）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-LIFE-002、AC-039；PICKED現場放回。執行批次：P1；案例優先級：P0。（Legacy identity：`LIFE-003`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：FUL-PICKED無Shipment。測試資料：REASON；goods returned false／true（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別取消

### Expected business result
未確認放回原Bin／Lot時拒絕；確認後release成功才CANCELLED，不改On Hand或SO Fulfilled

### Acceptance criteria
必要證據：確認框、結果、Inventory及Fulfillment。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-071 — 取消Release失敗（LIFE-004）

### Business objective and actor
角色：U-OP。業務目標／風險：AC-040；取消Release失敗。執行批次：P1；案例優先級：P0。（Legacy identity：`LIFE-004`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：QA可受控令Inventory release失敗。測試資料：FUL-PICKING／PICKED、原event（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
取消至失敗，再按指引以原event重試

### Expected business result
失敗時狀態及Allocations保持原值並顯示Correlation／恢復指引；恢復後只release一次

### Acceptance criteria
必要證據：失敗／恢復畫面、Allocation及Queue。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-072 — Shipment阻擋Fulfillment取消（LIFE-005）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-LIFE-003；Shipment阻擋Fulfillment取消。執行批次：P2；案例優先級：P0。（Legacy identity：`LIFE-005`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：Fulfillment有DRAFT或SHIPPING／SHIPPED Shipment。測試資料：各狀態Shipment（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試取消Fulfillment

### Expected business result
全部拒絕並提示先處理可取消的DRAFT Shipment；SHIPPING／SHIPPED不得以Fulfillment取消繞過

### Acceptance criteria
必要證據：錯誤、Shipment及Fulfillment狀態。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-073 — Draft Shipment取消重建（LIFE-006）

### Business objective and actor
角色：U-OP。業務目標／風險：FR-LIFE-004、GATE-001；Draft Shipment取消重建。執行批次：P2；案例優先級：P1。（Legacy identity：`LIFE-006`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：SHIP-DRAFT屬FUL-PICKED。測試資料：取消後以新event建立（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
取消Shipment，再由同Fulfillment建立新Shipment

### Expected business result
舊Shipment=CANCELLED且歷史保留；Fulfillment=PICKED；新Shipment獲新number且為唯一active Shipment

### Acceptance criteria
必要證據：兩張Shipment及Fulfillment詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-074 — 終態不可改（LIFE-007）

### Business objective and actor
角色：U-OP／U-REV。業務目標／風險：FR-LIFE-005、BR-028；終態不可改。執行批次：P2～P3；案例優先級：P0。（Legacy identity：`LIFE-007`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：SHIP-SHIPPED／REVERSED／CANCELLED。測試資料：修改地址、物流、quantity、一般cancel或confirm（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試各操作

### Expected business result
所有不合法操作拒絕；SHIPPED只能走具權限Reversal，REVERSED／CANCELLED歷史不可改寫

### Acceptance criteria
必要證據：可用actions、拒絕及前後詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-075 — 競爭狀態操作（LIFE-008）

### Business objective and actor
角色：兩名U-OP。業務目標／風險：BR-023～027；競爭狀態操作。執行批次：P1～P2；案例優先級：P0。（Legacy identity：`LIFE-008`，詳見 §7 取消、狀態及並發生命週期。）

### Preconditions and data
前置條件：同一version的PICKING／PICKED／DRAFT Shipment。測試資料：reallocate對cancel、pick對cancel、confirm對cancel（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
兩人近同時提交

### Expected business result
只有符合最新狀態／version的一個操作成功；另一個清楚衝突，最終狀態及數量可完整解釋

### Acceptance criteria
必要證據：兩個結果、History、SO及Inventory最終值。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-076 — 最小Reversal權限（REV-001）

### Business objective and actor
角色：U-OP／U-VIEW／U-REV。業務目標／風險：FR-REV-001、AC-042；最小Reversal權限。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-001`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：SHIP-SHIPPED。測試資料：三個角色（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別開詳情並嘗試Reversal

### Expected business result
U-OP／U-VIEW沒有入口且直接提交拒絕；U-REV可見Reversal入口但不取得一般operation能力

### Acceptance criteria
必要證據：角色、actions及拒絕／可用畫面。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-077 — 完整確認資料（REV-002）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-001／003、AC-043；完整確認資料。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-002`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：SHIP-SHIPPED且貨仍在公司控制。測試資料：空／短／超長reason；兩個checkbox組合；合法REASON（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別提交

### Expected business result
原因須5～500字且兩項確認均true；無效輸入不改狀態，合法才開始REVERSING

### Acceptance criteria
必要證據：各表單結果及Shipment狀態。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-078 — 整張原bucket回補（REV-003）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-005～006、AC-043；整張原bucket回補。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-003`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：SHIPPED含多lines／bins／lots且原位置可用。測試資料：原Issues及REASON（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
記錄前值後整張Reversal

### Expected business result
Shipment／Fulfillment／Reversal=REVERSED；每筆原bucket回補、Reservation恢復、SO Fulfilled等量減少；原Allocation仍Consumed

### Acceptance criteria
必要證據：前後SO、Inventory、Movement、Allocation及Reversal。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-079 — COMPLETED／CLOSED SO重開（REV-004）

### Business objective and actor
角色：U-REV。業務目標／風險：GATE-004；COMPLETED／CLOSED SO重開。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-004`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：Shipment屬SO-COMPLETED或符合條件的SO-CLOSED。測試資料：含既有Cancelled quantity（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
整張Reversal並查看SO

### Expected business result
Cancelled保持不變；恢復Reserved後按剩餘Fulfilled重算為PARTIALLY_FULFILLED或CONFIRMED，歷史不改寫

### Acceptance criteria
必要證據：SO前後quantity／status、History及Reversal。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-080 — 禁止部分沖銷（REV-005）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-002、AC-044；禁止部分沖銷。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-005`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：SHIP-SHIPPED有多lines。測試資料：選單行／部分quantity或竄改payload（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試提交

### Expected business result
UI沒有部分選項；多餘line／quantity被拒絕，沒有任何回補；提示整張沖銷後重新履約

### Acceptance criteria
必要證據：UI、錯誤及前後Movement／SO。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-081 — Customer Return區分（REV-006）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-003／012、AC-047；Customer Return區分。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-006`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：貨已交付客戶、不在公司控制。測試資料：goods control=false或return原因（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試Reversal

### Expected business result
阻止並明確說明Reversal只更正錯誤操作，Customer Return須走未來Returns流程；不回補庫存

### Acceptance criteria
必要證據：提示、Shipment及Inventory前後。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-082 — 原bucket不可用（REV-007）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-003／005；原bucket不可用。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-007`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：原Bin已Inactive／Counting或不能接收原Lot／Status。測試資料：各阻擋情境（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
提交Reversal

### Expected business result
全部拒絕或保持可恢復真實狀態；不可改選另一Bin、不可部分回補，提示Inventory owner解除阻擋

### Acceptance criteria
必要證據：各錯誤、原bucket狀態及Movement搜尋。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-083 — Archive／downstream阻擋（REV-008）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-003；Archive／downstream阻擋。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-008`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：父SO已Archive或required downstream matter為OPEN／UNKNOWN。測試資料：三種情境（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試Reversal

### Expected business result
全部fail closed並提示正式例外／依賴處理；不建立成功Reversal或Inventory／Sales效果

### Acceptance criteria
必要證據：錯誤、Shipment／Archive及前後數量。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-084 — 跨模組原子失敗（REV-009）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-008、AC-045；跨模組原子失敗。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-009`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：QA可受控令其中一筆回補或Sales更新失敗。測試資料：多line SHIP-SHIPPED（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
Reversal至失敗並查詢

### Expected business result
不存在部分Movement／Reservation restore／SO decrement或虛假REVERSED；顯示SHIPPED或REVERSING真實可恢復狀態

### Acceptance criteria
必要證據：失敗畫面、所有bucket、SO及Reversal詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-085 — 重送／unknown恢復（REV-010）

### Business objective and actor
角色：U-REV／U-OPS。業務目標／風險：FR-REV-004／009、AC-046；重送／unknown恢復。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-010`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：EVT-A首次成功或停在REVERSING。測試資料：同event同內容、worker重啟（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
重送並依Correlation等待恢復

### Expected business result
返回同一Reversal／number；最多一組反向Movements及SO decrement，最終由原event收斂

### Acceptance criteria
必要證據：多次結果、Movement count、SO及operation。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-086 — event衝突／並發（REV-011）

### Business objective and actor
角色：U-REV。業務目標／風險：FR-REV-010；event衝突／並發。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-011`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：EVT-A已有意圖。測試資料：同event改Shipment／reason；兩人不同event同時Reverse（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別提交

### Expected business result
同event異payload明確衝突；同Shipment並發最多一人成功，另一人回既有／處理中結果，不重複回補

### Acceptance criteria
必要證據：兩個結果、Reversal搜尋及Movement count。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-087 — 沖銷後追溯與再履約（REV-012）

### Business objective and actor
角色：U-VIEW／U-OP。業務目標／風險：FR-REV-006～007／011；沖銷後追溯與再履約。執行批次：P3；案例優先級：P0。（Legacy identity：`REV-012`，詳見 §7 Shipment Reversal。）

### Preconditions and data
前置條件：REV-003成功。測試資料：原Shipment、Allocation、Queue及文件（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
查看全部連結，再嘗試重用原Allocation／Shipment並從Queue新建

### Expected business result
原資料唯讀且文件標示REVERSED；原Allocation不重開／不可重用，恢復Reservation回Queue，須建立新Fulfillment／Shipment

### Acceptance criteria
必要證據：Shipment、文件、Allocation、Queue、History及Audit。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-088 — 常用視圖（INQ-001）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-INQ-001；常用視圖。執行批次：P1～P3；案例優先級：P1。（Legacy identity：`INQ-001`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：有本人近期、Active、Exception及Finalized資料。測試資料：多狀態Fulfillment／Shipment（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開My Recent Work、Queue、Active、Shipments、Exceptions、Finalized

### Expected business result
每個視圖只含符合定義資料；狀態與數量摘要正確且不混入Archive

### Acceptance criteria
必要證據：各視圖及樣本詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-089 — Filter／exact查詢（INQ-002）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-INQ-002～004；Filter／exact查詢。執行批次：P1～P3；案例優先級：P1。（Legacy identity：`INQ-002`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：Active有相似number／Customer／tracking資料。測試資料：number、SO、Customer、WH、status、date、short、carrier、tracking（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別及組合搜尋

### Expected business result
Exact key定位唯一記錄；一般filters準確、穩定分頁，URL刷新／返回後條件保留

### Acceptance criteria
必要證據：搜尋條件、URL、結果及詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-090 — 詳情數量事實（INQ-003）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-INQ-005～006；詳情數量事實。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`INQ-003`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：有DRAFT、PICKING、PICKED、SHIPPED、REVERSED資料。測試資料：各狀態樣本（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
逐張開Fulfillment／Shipment詳情

### Expected business result
顯示SO、Planned／Allocated／Picked／Short／Shipped、Bin／Lot、地址／Contact快照、Issues、History及正確allowed actions

### Acceptance criteria
必要證據：各狀態詳情及來源頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-091 — 雙向追溯（INQ-004）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-INQ-007；雙向追溯。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`INQ-004`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：有已出貨及沖銷資料。測試資料：SO、Fulfillment、Shipment、Movement、Reversal IDs（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
由每個來源逐步前往其他單據並返回

### Expected business result
每個連結只到同一aggregate及正確line／movement；無權目標安全拒絕，不跳至相似number

### Acceptance criteria
必要證據：完整導航錄影／截圖。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-092 — Pick List內容（INQ-005）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-DOC-001；Pick List內容。執行批次：P1；案例優先級：P1。（Legacy identity：`INQ-005`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：FUL-PICKING有多Bin／Lot。測試資料：代表性及100行資料（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
預覽／列印Pick List並與詳情比對

### Expected business result
內容、順序及quantity與當前Allocation一致；A4可讀且不顯示price、cost、bank或技術錯誤

### Acceptance criteria
必要證據：詳情、預覽及列印樣本。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-093 — Delivery文件真實性（INQ-006）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-DOC-002～004；Delivery文件真實性。執行批次：P2～P3；案例優先級：P0。（Legacy identity：`INQ-006`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：SHIPPED及REVERSED各一張。測試資料：含／不含物流資料（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
預覽／列印Delivery Note／Packing List

### Expected business result
SHIPPED顯示確認時snapshot及選填物流；REVERSED有顯眼文字／watermark；均不顯示price、tax、cost、bank或internal error

### Acceptance criteria
必要證據：兩種狀態詳情及文件。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-094 — Filter／權限一致（INQ-007）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-EXPORT-001～002；Filter／權限一致。執行批次：P3；案例優先級：P0。（Legacy identity：`INQ-007`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：列表有權限範圍內外資料。測試資料：當前Customer／WH／status/date filters（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
套用filters後建立匯出並下載

### Expected business result
CSV只含當前可見範圍與filters，欄位及counts與列表／詳情一致，不包含完整地址或銀行資料

### Acceptance criteria
必要證據：畫面計數、CSV計數及樣本對照。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-095 — Job owner隔離（INQ-008）

### Business objective and actor
角色：兩名U-VIEW。業務目標／風險：FR-EXPORT-003；Job owner隔離。執行批次：P3；案例優先級：P0。（Legacy identity：`INQ-008`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：A建立大匯出Job。測試資料：A／B帳戶、running/completed Job（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
B嘗試查看／下載，A追蹤至完成

### Expected business result
只有A可見／下載；B統一拒絕；Job背景執行且前台仍可操作，完成後提供安全下載

### Acceptance criteria
必要證據：兩角色頁面、Job狀態及下載。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-096 — 過期／失敗Job（INQ-009）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-EXPORT-003；過期／失敗Job。執行批次：P3；案例優先級：P2。（Legacy identity：`INQ-009`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：已完成及可受控失敗Job。測試資料：期限內、過期及failed結果（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別下載／查看

### Expected business result
期限內成功；過期清楚顯示不可下載；failed有可行動訊息，不返回partial file或server path

### Acceptance criteria
必要證據：三種Job及下載結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-097 — CSV安全（INQ-010）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-EXPORT-004、AC-050；CSV安全。執行批次：P3；案例優先級：P0。（Legacy identity：`INQ-010`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：可匯出TEXT-RISK。測試資料：notes、reason、carrier、tracking（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
匯出並在受控試算表安全開啟

### Expected business result
UTF-8／Unicode可讀；公式字首被中和，欄位正確escape，沒有script／formula執行或CRLF破壞row

### Acceptance criteria
必要證據：原畫面、CSV raw／開啟結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-098 — Audit完整／不可改（INQ-011）

### Business objective and actor
角色：U-VIEW／U-OPS。業務目標／風險：FR-AUDIT-001～003；Audit完整／不可改。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`INQ-011`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：已完成create、allocate、override、pick、cancel、confirm、retry、reverse、print、export、archive。測試資料：各action sample（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
從History／Audit查看並嘗試修改

### Expected business result
每個動作有actor、time、action、outcome及safe reference；Viewer不見安全技術細節；任何UI均不能修改／刪除正式歷史

### Acceptance criteria
必要證據：History／Audit samples及無write actions。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-099 — 讀取無業務副作用（INQ-012）

### Business objective and actor
角色：U-VIEW。業務目標／風險：BR-033；讀取無業務副作用。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`INQ-012`，詳見 §7 查詢、文件、匯出及Audit追溯。）

### Preconditions and data
前置條件：記錄可歸檔單據的last business update／資格。測試資料：重複list、detail、print、export（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
執行後再查看Archive eligibility

### Expected business result
技術讀取、列印及匯出不改最後業務更新時間、狀態、數量或歸檔資格

### Acceptance criteria
必要證據：操作前後詳情及候選結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-100 — 合資格判斷（ARC-001）

### Business objective and actor
角色：U-OPS。業務目標／風險：FR-ARC-001～003、AC-052；合資格判斷。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-001`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：可執行受控月度Archive。測試資料：ARC-ELIGIBLE及未滿24個月資料（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
執行並查看候選／結果

### Expected business result
只有父SO符合24個月且全部下游final／無open matter者搬移；較新資料保留Active

### Acceptance criteria
必要證據：Batch摘要、兩組Active／Archive結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-101 — Open matter阻擋（ARC-002）

### Business objective and actor
角色：U-OPS。業務目標／風險：FR-ARC-003、AC-053；Open matter阻擋。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-002`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：各類open matter樣本。測試資料：PICKING、PICKED、SHIPPING、REVERSING、active Claim、outstanding Allocation、IN_PROGRESS operation（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
執行資格評估

### Expected business result
每類均Skip並顯示穩定原因；SO與全部Fulfillment資料保留Active

### Acceptance criteria
必要證據：候選／Skip報告及Active詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-102 — aggregate完整搬移（ARC-003）

### Business objective and actor
角色：U-OPS／U-VIEW。業務目標／風險：FR-ARC-004～005、AC-052；aggregate完整搬移。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-003`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：ARC-ELIGIBLE含多Fulfillment、Shipment、Reversal、Audit。測試資料：已知單據及quantity摘要（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
歸檔前保存業務頁，歸檔後由Archive查看

### Expected business result
SO、Fulfillments、Shipments、lines、Claims、Allocations、Issues、snapshots、History、Reversal及必要Audit一併可讀，數量／狀態不改

### Acceptance criteria
必要證據：搬移前後業務對照及Batch結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-103 — 校驗失敗（ARC-004）

### Business objective and actor
角色：U-OPS。業務目標／風險：FR-ARC-005／009、AC-054；校驗失敗。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-004`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：QA可受控令單一aggregate校驗失敗。測試資料：ARC-ELIGIBLE（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
執行Archive

### Expected business result
該aggregate完整保留Active，沒有半份Archive；Batch顯示失敗、Correlation及可重試指引

### Acceptance criteria
必要證據：Active／Archive搜尋及Batch error。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-104 — 中斷及重跑（ARC-005）

### Business objective and actor
角色：U-OPS。業務目標／風險：FR-ARC-009、AC-054；中斷及重跑。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-005`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：Batch含多個aggregate。測試資料：在部分完成後受控停止worker（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
重啟／按runbook續跑

### Expected business result
已成功資料不重複，未完成資料可安全處理；不同hash conflict不被忽略，counts清楚

### Acceptance criteria
必要證據：兩次Batch結果及Active／Archive搜尋。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-105 — 唯一routing（ARC-006）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-ARC-007～008；唯一routing。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-006`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：已有相似Active與Archive records。測試資料：Fulfillment／Shipment／SO／Tracking exact keys（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
由Active搜尋提示前往Archive，再在Archive搜尋

### Expected business result
每個key只路由唯一Active或Archive記錄；不重複、不假404、不自動全歷史union

### Acceptance criteria
必要證據：Active提示、Archive結果及詳情。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-106 — Archive唯讀（ARC-007）

### Business objective and actor
角色：U-VIEW／U-OP／U-REV。業務目標／風險：FR-ARC-006；Archive唯讀。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-007`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：單據已歸檔。測試資料：Archive detail（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
嘗試update、cancel、confirm、reverse或重開

### Expected business result
頁面沒有write actions；直接提交仍拒絕，歷史及snapshot不變

### Acceptance criteria
必要證據：詳情、拒絕及前後結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-107 — bounded Archive搜尋（ARC-008）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-ARC-007；bounded Archive搜尋。執行批次：P3；案例優先級：P1。（Legacy identity：`ARC-008`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：Archive有大量資料。測試資料：空條件、367日、366日、exact number、Customer＋日期（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別搜尋

### Expected business result
空條件／367日要求收窄；366日或exact key可查；結果與filters一致且分頁穩定

### Acceptance criteria
必要證據：各次搜尋條件及結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-108 — Archive unavailable隔離（ARC-009）

### Business objective and actor
角色：U-VIEW／U-OP。業務目標／風險：FR-ARC-010、AC-055；Archive unavailable隔離。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-009`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：QA令Archive store暫不可用。測試資料：Queue、Create、Pick、Confirm、Active list、Archive list（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
同時執行

### Expected business result
Active日常操作及查詢繼續；Archive清楚顯示暫不可用與Correlation，不顯示0筆或影響出貨

### Acceptance criteria
必要證據：Active各流程及Archive錯誤。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-109 — 至少7年保留（ARC-010）

### Business objective and actor
角色：U-VIEW。業務目標／風險：FR-ARC-001；至少7年保留。執行批次：P3；案例優先級：P1。（Legacy identity：`ARC-010`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：有7年內最早Archive測試資料。測試資料：Archive detail及可用actions（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
查詢並檢查操作

### Expected business result
資料仍可讀及追溯；沒有自動purge、永久刪除或使用者銷毀入口

### Acceptance criteria
必要證據：Archive詳情、設定及actions。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-110 — Archive restore後可查（ARC-011）

### Business objective and actor
角色：U-OPS／U-VIEW。業務目標／風險：AC-056；Archive restore後可查。執行批次：P3；案例優先級：P0。（Legacy identity：`ARC-011`，詳見 §7 歸檔、保留及查回。）

### Preconditions and data
前置條件：已完成包含Active／Archive的測試備份。測試資料：代表性SO／Fulfillment／Shipment／Reversal（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
在隔離restore環境逐筆查詢及導航

### Expected business result
每筆Active／Archive routing唯一，snapshots／quantities／issues／reversals／Audit完整；任何差異有報告而非假成功

### Acceptance criteria
必要證據：Restore環境、抽樣表、畫面及對賬結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-111 — Active查詢效能（OPS-001）

### Business objective and actor
角色：U-VIEW。業務目標／風險：NFR-PERF-001～002、AC-051；Active查詢效能。執行批次：P1～P3；案例優先級：P1。（Legacy identity：`OPS-001`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：730萬Active Fulfillments及Shipments、正常負載。測試資料：Queue、常用filters、exact numbers（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
按批准腳本重複操作

### Expected business result
Queue、Active lists及exact lookup P95≤2秒且結果正確，不靠清空資料或省略filters

### Acceptance criteria
必要證據：使用者錄影、效能報告及環境基線。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-112 — 100行操作（OPS-002）

### Business objective and actor
角色：U-OP／U-REV。業務目標／風險：NFR-PERF-003、AC-051；100行操作。執行批次：P1～P3；案例優先級：P1。（Legacy identity：`OPS-002`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：正常依賴及負載。測試資料：1／100-line Allocate、Pick、Confirm、Reverse（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
執行各操作

### Expected business result
P95≤3秒；如背景處理則3秒內回可追蹤狀態，最終數量唯一且正確

### Acceptance criteria
必要證據：操作結果、percentile報告及對賬。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-113 — 並發營運（OPS-003）

### Business objective and actor
角色：50名混合角色。業務目標／風險：NFR-PERF-004；並發營運。執行批次：P1～P3；案例優先級：P1。（Legacy identity：`OPS-003`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：標準容量，Sales Import／Backorder／Export／Archive並行。測試資料：Queue、create、pick、confirm、lookup workload（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
同時執行代表性流程

### Expected business result
至少50名使用者可操作；無pool starvation、長時間凍結、deadlock外洩或數量錯亂

### Acceptance criteria
必要證據：Workload、頁面、錯誤率及資源報告。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-114 — 100行列印（OPS-004）

### Business objective and actor
角色：U-VIEW。業務目標／風險：NFR-PERF-007；100行列印。執行批次：P1～P2；案例優先級：P1。（Legacy identity：`OPS-004`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：100-line PICKING及SHIPPED文件。測試資料：Pick List、Delivery Note（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
開預覽並切換列印

### Expected business result
P95≤3秒；內容完整可讀、分頁合理，前台不凍結

### Acceptance criteria
必要證據：預覽錄影、效能及PDF／列印樣本。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-115 — 依賴故障（OPS-005）

### Business objective and actor
角色：U-OP。業務目標／風險：Requirement §13.2～13.3；依賴故障。執行批次：P1～P3；案例優先級：P0。（Legacy identity：`OPS-005`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：QA可受控令Sales／Customer／Item／Inventory慢、失敗或不可用。測試資料：Create、Allocate、Confirm、Reverse（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
分別提交並於依賴恢復後按指引處理

### Expected business result
不用過時資料假成功；顯示依賴／業務／version／unknown的不同訊息及Correlation；恢復後不重複效果

### Acceptance criteria
必要證據：各錯誤、恢復步驟及最終業務頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-116 — Job中斷與互不拖累（OPS-006）

### Business objective and actor
角色：U-OPS／U-OP。業務目標／風險：Requirement §13.3；Job中斷與互不拖累。執行批次：P2～P3；案例優先級：P1。（Legacy identity：`OPS-006`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：Recovery、Export、Reconciliation、Archive可受控停止。測試資料：各一Job及正常Active操作（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
中斷／重啟Job，同時操作Queue／Pick／Confirm

### Expected business result
已完成工作不重複，未完成可續跑；單一非必要Job故障不阻止日常出貨／Active查詢

### Acceptance criteria
必要證據：Job前後、Active操作及最終結果。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-117 — Reconciliation可行動（OPS-007）

### Business objective and actor
角色：U-OPS。業務目標／風險：Requirement §13.2／13.4；Reconciliation可行動。執行批次：P3；案例優先級：P0。（Legacy identity：`OPS-007`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：可受控建立只讀差異樣本。測試資料：quantity、state、source、duplicate event、routing mismatch（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
執行對賬並查看報告

### Expected business result
報告指出安全IDs／codes／counts及Correlation，不自動改資料；差異產生metric／alert並可按runbook跟進

### Acceptance criteria
必要證據：對賬報告、alert及業務頁。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-118 — 完整備份還原（OPS-008）

### Business objective and actor
角色：U-OPS／U-VIEW。業務目標／風險：AC-056；完整備份還原。執行批次：P3；案例優先級：P0。（Legacy identity：`OPS-008`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：Active、Archive、operations及Inventory references已備份。測試資料：代表性全流程資料（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
在隔離環境restore並由UI／報告抽樣對賬

### Expected business result
SO→Fulfillment→Allocation→Shipment→Movement／Reversal及Archive可雙向追溯；counts／status／quantities／hash一致

### Acceptance criteria
必要證據：Restore資訊、抽樣矩陣及對賬報告。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-119 — Responsive（OPS-009）

### Business objective and actor
角色：各業務角色。業務目標／風險：Requirement §10、Design §10.6；Responsive。執行批次：P1～P3；案例優先級：P1。（Legacy identity：`OPS-009`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：支援桌面瀏覽器。測試資料：375／768／1024／1440px（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
完成Queue、Allocation、Pick、Shipment、Reversal、Archive核心流程

### Expected business result
關鍵資料／actions無不可用遮擋；table/card、loading、empty、error及success清楚，繁中一致

### Acceptance criteria
必要證據：各viewport截圖／錄影。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

## UAT-120 — Keyboard／WCAG／時區（OPS-010）

### Business objective and actor
角色：各業務角色。業務目標／風險：Design §10.6；Keyboard／WCAG／時區。執行批次：P1～P3；案例優先級：P1。（Legacy identity：`OPS-010`，詳見 §7 效能、可用性、恢復及UI／UX。）

### Preconditions and data
前置條件：支援瀏覽器及screen reader。測試資料：關鍵流程、validation errors、跨日資料（定義見 §2.2）。環境須為 §3.1 進入準則所述的隔離 UAT 環境及測試專用資料庫，並已記錄 build／commit、APP_TIME_ZONE、瀏覽器及資料版本。

### Steps
只用鍵盤完成；觸發錯誤；查看跨日狀態

### Expected business result
Focus可見且順序合理，labels/errors可讀出並定位，dialog可控，狀態不只靠顏色；日期按APP_TIME_ZONE一致

### Acceptance criteria
必要證據：鍵盤錄影、accessibility evidence及日期畫面。依 §5 規則，只使用使用者或獲授權業務管理員可觀察的證據；沒有執行證據不得標 PASS，狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。本案例目前狀態為 `NOT RUN`；自動化或技術測試通過不等同本案例的業務驗收。

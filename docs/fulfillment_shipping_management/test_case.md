# Fulfillment & Shipping Management 用戶驗收測試案例

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/fulfillment_shipping_management/requirement.md` |
| 設計來源 | `docs/fulfillment_shipping_management/design_spec.md` |
| 開發計劃 | `docs/fulfillment_shipping_management/tasks.md` |
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

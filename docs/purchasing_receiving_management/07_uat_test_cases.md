# Purchasing & Receiving Management 用戶驗收測試案例（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/purchasing_receiving_management/01_requirement_spec.md` 0.2 Approved Planning Baseline |
| 設計來源 | `docs/purchasing_receiving_management/03_design_spec.md` 0.2 Approved Planning Baseline |
| 技術測試來源 | `docs/purchasing_receiving_management/06_technical_test_cases.md` |
| UI／UX基準 | `docs/frontend-design.md` |
| 文件日期 | 2026-09-08 |
| 測試類型 | User Acceptance Testing（UAT）測試設計 |
| 測試狀態 | 尚未執行；所有案例初始狀態均為 `NOT RUN` |
| 目標環境 | 待執行前填寫；須為隔離UAT環境及測試專用資料庫 |
| Build／Commit | 待執行前填寫 |

> 本文件從採購、審批、收貨、庫存更正、設定及只讀查詢使用者角度驗證功能是否可接受，不代表系統已通過測試。本輪只產出案例，不執行任何測試。

---

## 1. 驗收目標與範圍

驗證中小企業可由Purchase Order開始，以簡單、可追溯及職責分離的流程完成採購、審批、分批收貨、超收、精確SKU／Lot／Warehouse／Bin入庫及正式Receipt Reversal；任何失敗、重送、逾時、版本衝突或並發操作均不得造成重複PO、重複入庫、部分狀態或無法解釋的PO／GR／Inventory差異。

### 1.1 範圍內

- Purchasing Settings、PO、Approval、PO Lifecycle、Goods Receipt、Receipt Reversal及相關查詢頁面。
- Supplier、Item、User、Currency、Payment Term及Inventory正式整合後的使用者可觀察結果。
- 正常、替代、負面、邊界、權限、重新認證、版本、重送、逾時、並發及恢復情境。
- PO金額／UOM、GR數量／Tracking／Lot／Expiry／Status／Warehouse／Bin及跨模組來源追溯。
- PO／GR列表、Outstanding、CSV、A4 browser print、Audit、responsive、鍵盤操作及無障礙。
- 使用者可觀察的效能體感、備份還原後業務對賬及Go-Live rehearsal。

### 1.2 範圍外與前置證據

- 不以直接SQL、取得DB lock、修改資料庫、檢查程式碼或呼叫內部Provider方法作為UAT步驟。
- Unit、API contract、migration、FK／trigger、lock order、failure injection、真並發barrier、coverage及完整壓測由開發／系統測試負責；開始相關Phase UAT前須提供通過證據。
- 不驗收Purchase Requisition、RFQ／Quotation、Supplier Contract、Supplier Return、Supplier Invoice、AP、付款、會計分錄、Tax、Discount、Freight、Landed Cost或匯率換算。
- 不驗收多層／按金額審批、代理審批、外部通知、EDI、Supplier Portal、無PO收貨、Serial Tracking、server-side PDF或自訂報表設計器。
- 不以Receipt Reversal模擬物理退貨給Supplier；物理退貨屬未來獨立流程。

---

## 2. 驗收角色與測試資料基線

### 2.1 使用者角色

| 代號 | 角色／權限 |
| --- | --- |
| U-VIEW | Active user；只有 `purchasing.view` |
| U-BUY | Active user；`purchasing.view＋purchasing.mgmt` |
| U-APP | Active user；`purchasing.view＋purchasing.approval`；不是PO提交人 |
| U-REC | Active user；`purchasing.view＋receiving.operation` |
| U-EXP | Active user；`purchasing.view＋receiving.operation＋receiving.expiry.override` |
| U-ADJ | Active user；`purchasing.view＋inventory.adjust` |
| U-SET | Active user；`purchasing.view＋purchasing.settings` |
| U-SYS | 只有System Administrator角色，沒有明確Purchasing／Receiving權限 |
| U-NONE | Active user；沒有本模組任何權限 |
| U-STALE | 已登入及載入頁面，其後被停用或撤除目標permission的使用者 |

各權限互不繼承。Approval使用password重新認證；Settings及Receipt Reversal使用device-password重新認證。只使用測試帳戶及測試裝置。

### 2.2 主資料與交易資料

| 代號 | 測試資料 |
| --- | --- |
| SUP-A | Active Supplier；有Default HKD、Payment Term及Ordering Address |
| SUP-NOREL | Active Supplier；與目標SKU沒有供貨關係或歷史 |
| SUP-PREF | Active且有preferred／歷史供貨標記，只作搜尋排序 |
| SUP-SUSP／SUP-ARCH | PO確認後變成Suspended／Archived的Supplier |
| SUP-BLOCK | PO確認後變成Blocked的Supplier |
| SKU-NONE | 可採購、inventory tracked、Base UOM `EA`、Tracking `none` |
| SKU-BATCH | 可採購、Tracking `batch`，Expiry選填 |
| SKU-EXP | 可採購、Tracking `batch_expiry`，具Minimum Receipt Life |
| SKU-SERIAL | Active、Tracking `serial`，本期不支援 |
| SKU-DISC／INACTIVE／ARCH | 不可用於新PO的Discontinued／Inactive／Archived SKU |
| SKU-CHANGED | PO確認後改變生命周期、purchasable、inventoryTracked或Tracking的SKU |
| UOM-EA／BOX24 | Base EA及有效Pack UOM；1 BOX＝24 EA |
| UOM-BAD | 已停用、屬於另一SKU或換算後不能得到整數Base Quantity的UOM |
| CUR-HKD／CUR-JPY | 已配置Currency；分別使用2位及0位小數作金額驗證 |
| PT-30 | 有效30日Payment Term |
| W-A／W-B | Active Warehouses；各自有Active Bins |
| BIN-A1／A2 | W-A的Active Bins；可存同一Lot |
| BIN-B1 | W-B的Active Bin |
| BIN-INACTIVE | W-A的Inactive Bin |
| BIN-COUNT | 正在Stocktake Counting的Bin |
| LOT-VALID | 未過期且符合Minimum Receipt Life的Lot |
| LOT-LOW | 未過期但低於Minimum Receipt Life的Lot |
| LOT-EXPIRED | 在APP_TIME_ZONE業務收貨日已過期的Lot |
| LOT-CONFLICT | Inventory已有相同SKU／Lot但Expiry或Manufacture Date不同 |
| PO-DRAFT／PENDING／CONFIRMED | 各狀態且具已知version的PO |
| PO-PARTIAL／FULL／CLOSED／CANCELLED | 已部分收貨、全收、人工關閉及取消的PO |
| GR-DRAFT／GR-CONFIRMED | 含多lines／details及已知version的GR |
| EVT-A／EVT-B | 唯一event／idempotency ID；另備同ID同內容及同ID異內容版本 |
| REASON | 合法5～500字原因，例如 `UAT purchasing exception verification` |
| TEXT-RISK | 公式字首、HTML／script文字、控制字元、超長notes／reason及Unicode資料 |

所有資料使用唯一run prefix。每項數量案例須先記錄PO Ordered／Net／Outstanding／Over、GR Detail及Inventory SKU／Warehouse／Bin／Lot／Status初始值，不使用真實Supplier銀行資料、密碼、token或商業敏感資料。

---

## 3. UAT進入及完成準則

### 3.1 進入準則

- 對應Phase已部署至隔離UAT環境，build／commit、APP_TIME_ZONE、瀏覽器及測試日期已記錄。
- Phase 0 Provider／Framework Gate及對應unit、API、integration、migration、security與system tests已通過，沒有阻擋UAT的S1／S2缺陷。
- Supplier、Item、Currency、Payment Term、User、Warehouse、Bin、Lot、Inventory Receipt／Reversal及來源查詢契約可用。
- 測試人員可分別登入上述角色，並可查看PO、GR、Inventory Movement、Supplier供貨紀錄及Audit頁。
- 審批設定預設值、測試資料版本、初始數量、故障／逾時模擬方式及UAT證據位置已記錄。

### 3.2 完成準則

- 當次Phase所有P0及P1案例已執行，沒有未批准的 `BLOCKED` 或 `NOT APPLICABLE`。
- 所有P0案例通過；沒有未關閉S1／S2缺陷，P1缺陷已有Product Owner接受的處理決定。
- 55項Acceptance Criteria均有PASS證據或Product Owner書面批准的例外。
- PO、GR、Inventory Movement／Balance、Reversal及Audit可由業務頁完整對賬，沒有重複、部分、負數或無法解釋的差異。
- 採購、收貨、庫存及Product Owner完成對應Phase與最終release簽核。

---

## 4. 風險優先級

| 風險 | Likelihood | Impact | Priority | 核心案例 |
| --- | ---: | ---: | --- | --- |
| 未授權設定、審批、收貨或沖銷破壞職責分離 | 4 | 5 | P0 | AUTH-001～006、SET-002～004、APP-002～003、REV-001 |
| PO金額、UOM或交易快照錯誤 | 3 | 5 | P0 | PO-004～010、PO-017、REPORT-007～008 |
| GR收錯SKU、Lot、Warehouse、Bin或Status | 4 | 5 | P0 | GR-003／005～008、REC-001～006、POST-001～002 |
| 重送、逾時、並發或部分失敗造成重複／部分入庫 | 4 | 5 | P0 | PO-013、APP-009、POST-001～009、OPS-004 |
| Supplier／SKU狀態改變令在途收貨被錯拒或不安全放行 | 4 | 4 | P0 | PO-010、REC-009～011、POST-007 |
| 超收或Close Remaining錯改Ordered／Inventory | 3 | 5 | P0 | LIFE-004～005、REC-007～008、POST-001 |
| Reversal超量、部分完成或令PO狀態錯誤 | 4 | 5 | P0 | REV-001～008 |
| 查詢、CSV、列印及Audit與正式交易結果不一致 | 3 | 4 | P1 | REPORT-001～012、OPS-006 |
| UAT環境恢復後PO／GR／Inventory無法對賬 | 2 | 5 | P1 | OPS-005、OPS-008 |

---

## 5. 證據與狀態規則

- 每個案例須保存build、環境、actor、執行時間、初始狀態及執行後狀態；有PO／GR／event／request ID時一併保存。
- `Required Evidence`只使用使用者或業務管理員可觀察證據：畫面截圖／錄影、成功或錯誤訊息、PO／GR／Inventory／Supplier／Audit頁、A4列印預覽、CSV及前後查詢結果。
- 涉及數量變化時，證據須同時顯示PO Line progress、GR Detail、Inventory SKU／Warehouse／Bin／Lot／Status及Movement來源，不只保存成功通知。
- 逾時後不得立即以新event重做；先按GR／Request ID查結果，再以原event安全重試。
- `Actual Evidence`在實際執行前保持 `—`。狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`；沒有實際執行證據不得標PASS。
- FAIL須建立Defect ID並記錄實際／預期結果、重現步驟、環境與證據；BLOCKED須記錄阻擋原因及解除條件。

---

## 6. 需求與Phase追溯總覽

| 業務流程 | Requirement／AC | 開發Phase | Test Case IDs | 初始結果 |
| --- | --- | --- | --- | --- |
| 權限與Purchasing Settings | FR-SET-001～007、SEC-001～016、AC-001～002、AC-048～050 | P0～P2 | AUTH-001～006、SET-001～006 | NOT RUN |
| PO建立、修改、複製與確認 | FR-LIST-001～010、FR-PO-001～018、AC-003～011 | P1 | PO-001～017 | NOT RUN |
| PO審批與生命週期 | FR-APPROVAL-001～012、FR-LIFE-001～012、AC-012～020 | P2 | APP-001～009、LIFE-001～006 | NOT RUN |
| GR Draft及現場收貨錄入 | FR-GR-001～015、AC-021～026、AC-035 | P3 | GR-001～013 | NOT RUN |
| 收貨驗證與Inventory過帳 | FR-VAL-001～016、FR-POST-001～014、AC-027～043 | P3 | REC-001～012、POST-001～009 | NOT RUN |
| Receipt Reversal | FR-REV-001～010、AC-043～047 | P4 | REV-001～008 | NOT RUN |
| 查詢、列印、CSV與Audit追溯 | FR-REPORT-001～010、FR-AUDIT-001～008、AC-048／051～053 | P1～P4 | REPORT-001～012 | NOT RUN |
| 業務連續性、效能體感及驗收簽核 | NFR-001～016、AC-040／050／054～055 | P1～P4 | OPS-001～008 | NOT RUN |
| 跨流程業務規則 | BR-001～052 | P1～P4 | 所有業務流程案例 | NOT RUN |

---

## 7. 詳細用戶驗收測試案例

### 7.1 權限與Purchasing Settings（AUTH／SET）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | 各Phase | 未登入 | SEC-001；未登入存取 | 已登出 | 所有Purchasing／Receiving URL | 直接開啟PO、Approval、GR、Outstanding及Settings頁 | 導向登入或顯示未登入；沒有PO、GR或主資料內容可見 | URL、登入導向及畫面 | — | NOT RUN |
| AUTH-002 | P0 | 各Phase | U-NONE／U-SYS | SEC-002～009；權限不繼承 | 兩角色均未獲本模組permission | Sidebar及所有頁面URL | 登入後檢查menu，再直接開各URL | Menu不顯示；直接URL拒絕；System Administrator不因角色名稱取得能力 | 角色設定、menu及拒絕畫面 | — | NOT RUN |
| AUTH-003 | P0 | P1～P4 | U-VIEW | SEC-002、AC-048；只讀 | 已有PO／GR資料 | 查詢、export及所有write actions | 查看／匯出後嘗試create、update、submit、approve、confirm、close及reversal | 查詢／匯出成功；寫入按鈕不可用，直接提交仍拒絕；資料不變 | 權限、成功查詢、拒絕及前後狀態 | — | NOT RUN |
| AUTH-004 | P0 | P2～P4 | U-BUY／U-APP／U-REC／U-EXP／U-ADJ／U-SET | SEC-003～008；最小權限 | 六個獨立帳戶 | 各角色專屬與非專屬操作 | 逐角色嘗試PO管理、Approval、GR、expiry override、Reversal及Settings | 每人只可完成明確獲授權能力；任一permission不暗含另一項 | 角色矩陣、可用actions及拒絕畫面 | — | NOT RUN |
| AUTH-005 | P0 | 各Phase | U-STALE | SEC-012、AC-050；提交點重驗 | 已載入可提交畫面 | PO submit、approve、GR confirm、Close、Reversal | 管理員撤權或停用後，由原頁提交 | 提交被清楚拒絕；PO／GR／Inventory／Audit沒有成功效果；提示重新登入或聯絡管理員 | 撤權時間、錯誤及前後業務頁 | — | NOT RUN |
| AUTH-006 | P0 | P1～P4 | 對應角色 | SEC-010／013～015；ID替換與資料洩漏 | 有兩張不同owner tree的PO／GR／details | 替換URL／表單中的PO Line、Approval、GR Detail、Bin或Movement ID及TEXT-RISK | 以瀏覽器可操作方式替換ID或輸入惡意文字並提交 | 不可讀寫不屬於目標aggregate的資料；錯誤不洩漏存在性、銀行、SQL、stack、token或內部路徑；資料不變 | URL／輸入、錯誤、前後詳情 | — | NOT RUN |
| SET-001 | P1 | P1 | U-SET | FR-SET-001～002／007、AC-001；預設值 | 尚未修改setting | 初始環境 | 開啟Purchasing Settings及history | 只有「PO需要審批」；預設OFF；顯示目前值、最後修改資訊及初始化歷史 | Settings及history畫面 | — | NOT RUN |
| SET-002 | P0 | P2 | U-VIEW／U-BUY／U-SYS | FR-SET-003、SEC-007、AC-002 | Setting為OFF | ON | 從UI及直接提交嘗試修改 | 沒有設定入口；直接提交亦拒絕；值與history不變 | 角色、拒絕、設定前後 | — | NOT RUN |
| SET-003 | P0 | P2 | U-SET | FR-SET-003、SEC-011／016 | 有已註冊測試裝置 | ON、正確device-password、REASON | 修改setting並重新開頁 | 修改成功、version更新；Audit／history有actor、before／after、reason、time及result | 認證對話、設定前後、Audit | — | NOT RUN |
| SET-004 | P0 | P2 | U-SET | SEC-011；高風險認證 | Setting為OFF | 缺原因、錯密碼、過期challenge、另一裝置signature | 分別嘗試改ON | 全部拒絕；不降級為一般JWT；setting、version及成功Audit不變 | 各次錯誤、設定前後 | — | NOT RUN |
| SET-005 | P0 | P2 | U-SET／U-BUY | FR-SET-006、FR-APPROVAL-001 | 已有Pending、Confirmed及新Draft PO | OFF→ON及ON→OFF | 改setting後查看舊PO，再提交新Draft | 舊Pending／Confirmed不被自動批准、拒絕或改寫；只有變更後新提交按新值分流 | setting history、三張PO狀態 | — | NOT RUN |
| SET-006 | P1 | P2 | U-SET | FR-SET-001／007、SEC-013 | Setting已修改數次 | URL refresh、back／forward、TEXT-RISK reason | 查history、刷新及輸入非法原因 | 歷史順序及值正確；URL不含認證；非法文字安全顯示／拒絕；沒有未批准的額外參數 | URL、history及錯誤畫面 | — | NOT RUN |

### 7.2 PO建立、修改、複製與確認（PO）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PO-001 | P0 | P1 | U-BUY | FR-PO-002／007、AC-003；供貨關係非白名單 | SUP-NOREL及SKU-NONE均Active | 1 EA、HKD | 搜尋SUP-NOREL並建立Draft | Supplier可搜尋及選擇；沒有關係不阻擋合法建單；不會自動標preferred | Supplier搜尋、Draft及提示 | — | NOT RUN |
| PO-002 | P1 | P1 | U-BUY | FR-LIST-008、AC-004；Supplier排序與資格 | SUP-PREF Active、另一preferred Suspended、SUP-NOREL Active | SKU-NONE | 由SKU搜尋Supplier | Active且有歷史者可排前；Suspended不可選；其他Active仍可見且可選 | 搜尋次序及選擇結果 | — | NOT RUN |
| PO-003 | P1 | P1 | U-BUY | FR-PO-003、AC-005；defaults可覆寫 | SUP-A具defaults | 改Currency／Payment Term／Address | 選Supplier、覆寫defaults、refresh lookup後保存並確認 | Defaults首次帶入；使用者修改不被refresh覆蓋；Confirmed保存覆寫後快照 | 表單前後、PO詳情快照 | — | NOT RUN |
| PO-004 | P0 | P1 | U-BUY | FR-PO-001／004～005、AC-006；完整建單 | Approval OFF；無同run PO | SUP-A、SKU-NONE＋SKU-BATCH | 建立兩Line Draft並保存 | 唯一PO Number、同一Supplier／Currency、兩Lines及Total正確；Inventory無Balance／Movement變化 | 建立結果、PO詳情、Inventory前後 | — | NOT RUN |
| PO-005 | P0 | P1 | U-BUY | FR-PO-008～009、AC-007；UOM整數換算 | BOX24有效 | 3 BOX | 建立PO並查看line preview及詳情 | 顯示3 BOX＝72 EA；Ordered Base為72正整數；確認後factor快照不變 | 表單、line詳情及快照 | — | NOT RUN |
| PO-006 | P0 | P1 | U-BUY | FR-PO-008～009；數量／UOM負面及邊界 | SKU-NONE及UOM-BAD | 0、負數、超scale、不能整除、超上限、另一SKU UOM | 逐項保存或確認 | 每項field-level拒絕；整張Draft無部分lines／錯誤Total；合法最小／上限內值可保存 | 輸入、錯誤及PO前後 | — | NOT RUN |
| PO-007 | P0 | P1 | U-BUY | FR-PO-010、AC-008；Unit Price | 有效Draft | 負價、零價空原因、零價REASON、4／5 decimals | 逐項保存及提交 | 負價、零價無原因及超4位拒絕；零價有原因可繼續並在確認／審批明示 | 表單錯誤、風險摘要、PO詳情 | — | NOT RUN |
| PO-008 | P0 | P1 | U-BUY／U-VIEW | FR-PO-011、AC-009；金額精度 | CUR-HKD及CUR-JPY | HALF_UP邊界、多Lines、大值 | 建立PO，比較preview、保存、詳情及列印 | 每Line按Currency scale HALF_UP後加總；server值為正本；沒有Tax、Discount、Freight或Landed Cost | 輸入、line／total、列印對照 | — | NOT RUN |
| PO-009 | P0 | P1 | U-BUY | FR-PO-004～005／017；結構完整性 | 空Draft及合法Draft | 零Lines、混Supplier／Currency、notes冒充SKU／price | 保存及提交 | 必須至少一個有效Line；一PO只一Supplier／Currency；自由文字不能代替結構欄位 | 輸入、錯誤、PO前後 | — | NOT RUN |
| PO-010 | P0 | P1 | U-BUY | FR-PO-006／018；提交時重驗 | Draft建立時master有效 | Supplier／SKU／UOM／Currency／Payment Term其後停用，另用SKU-SERIAL | 逐項提交Draft | 按提交時事實拒絕並指出可行動原因；Draft保留、無Confirmed快照或Inventory效果 | master時間線、錯誤、PO狀態 | — | NOT RUN |
| PO-011 | P0 | P1 | U-BUY | FR-PO-012／014；完整replace原子保存 | 三Line Draft | 新增、修改、排序、刪除；其中一Line非法 | 先合法保存，再帶一項非法保存 | 合法整張更新且順序正確；非法時所有header／lines／total／version保持上次成功值 | 前後PO、錯誤、version | — | NOT RUN |
| PO-012 | P0 | P1 | 兩名U-BUY | FR-PO-013、AC-010；版本衝突 | 兩瀏覽器載入同version | A／B修改不同lines | A先保存，B以舊頁保存 | A成功；B收到version conflict且不覆蓋A；B輸入可保留／複製後reload | 兩頁、衝突及最終PO | — | NOT RUN |
| PO-013 | P0 | P1 | U-BUY | FR-PO-015；安全重送 | 可重送create／update intent | EVT-A同內容、EVT-A異內容、EVT-B | Double-click、刷新重送及改payload重送 | 同event同內容只有一張PO／一次更新；異內容衝突；新event仍受業務唯一／version規則 | 回應、PO列表、lines及Audit | — | NOT RUN |
| PO-014 | P1 | P1 | U-BUY | FR-PO-016；Copy重驗 | 有Confirmed及歷史PO | master仍有效及其後失效兩組 | Copy PO並保存新Codes／資料 | 建立新編號Draft；不複製approval／receipt／status；全部master重新驗證，失效者清楚拒絕 | Source／copy詳情及錯誤 | — | NOT RUN |
| PO-015 | P1 | P1 | U-VIEW | FR-LIST-001～004／007／009～010 | 超過120張各狀態PO及長文字 | q、status、supplier、buyer、currency、dates、outstanding、sort | 組合搜尋、跨頁、refresh、back／forward | 預設最近更新、分頁穩定無漏重；URL還原非敏感filters；欄位完整，長文字可查看且不阻礙操作 | URL、多頁結果及詳情 | — | NOT RUN |
| PO-016 | P1 | P1 | U-VIEW | FR-LIST-005～006；PO詳情進度 | 一張多Lines且不同收貨進度PO | ordered／gross／reversed／net／outstanding／over／closed | 開詳情及各sections | Header、Lines、Approval、GR、Inventory及Audit入口可見；每Line數量分欄且公式一致 | PO詳情及來源連結 | — | NOT RUN |
| PO-017 | P0 | P1 | U-BUY | FR-SET-004、FR-APPROVAL-001、AC-011 | Approval OFF；完整Draft | SUP-A＋兩SKU | Submit並重開詳情 | 直接Confirmed並保存交易快照／Audit；顯示可收貨；Inventory完全不變 | Submit結果、PO狀態／快照／Audit、Inventory前後 | — | NOT RUN |

### 7.3 PO審批與生命週期（APP／LIFE）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| APP-001 | P0 | P2 | U-BUY | FR-APPROVAL-001～002、AC-012 | Approval ON；完整Draft | U-APP | Submit並選U-APP | PO進Pending Approval；保存不可變snapshot及version；不進Inventory | Submit結果、PO／approval詳情 | — | NOT RUN |
| APP-002 | P0 | P2 | 同時具BUY＋APP的提交人 | FR-APPROVAL-003、AC-013；自我批准 | Approval ON | 選自己作approver | Submit／Approve | 系統拒絕自我指定或自我批准；PO保持Draft／Pending原狀且無成功Audit | 選擇、錯誤及PO狀態 | — | NOT RUN |
| APP-003 | P0 | P2 | 非指定U-APP | FR-APPROVAL-006、AC-014；assigned only | Pending assigned給另一人 | PO ID／Approval ID | 從列表、直接URL及提交嘗試Approve／Reject | 看不到非本人待辦或不可操作；直接提交拒絕；申請仍Pending | 工作清單、拒絕及approval狀態 | — | NOT RUN |
| APP-004 | P0 | P2 | 指定U-APP | FR-APPROVAL-005～008、AC-015 | 兩張合法Pending | password、REASON | 一張Approve；另一張Reject | Approve後直接Confirmed；Reject必填原因並回Draft；兩者history／Audit完整 | 認證、兩張PO狀態及Audit | — | NOT RUN |
| APP-005 | P1 | P2 | 指定U-APP | FR-APPROVAL-004～005；snapshot內容 | Pending含零價及風險提示 | Supplier、lines、UOM、price、total、currency、term、dates | 查看待辦與approval詳情 | 顯示提交時完整不可變snapshot、零價及風險；不以目前Draft／master值冒充 | Snapshot及目前資料對照 | — | NOT RUN |
| APP-006 | P0 | P2 | 指定U-APP | FR-APPROVAL-007、AC-016；批准重驗 | Pending建立後條件改變 | PO version、Supplier／SKU／UOM／Currency、submitter／approver權限各失效 | 逐項Approve | 每種均拒絕過時或失效申請，不確認PO；要求撤回／重新提交 | 改變時間線、錯誤、PO／approval | — | NOT RUN |
| APP-007 | P0 | P2 | U-BUY | FR-APPROVAL-009、AC-017；撤回 | Pending尚未決定 | EVT-A | Withdraw後由舊approval頁再Approve | PO回Draft且history保留；舊approval不可批准；可修訂後新提交 | Withdraw、舊批准拒絕、新history | — | NOT RUN |
| APP-008 | P0 | P2 | U-BUY／U-APP | FR-APPROVAL-010；審批人不可用 | Pending後指定人被停用／撤權 | 新U-APP | 嘗試舊批准；提交人撤回再指定新人 | 不自動批准；舊操作拒絕；撤回後可建立新approval給新人 | user狀態、兩次approval history | — | NOT RUN |
| APP-009 | P0 | P2 | U-BUY／U-APP | FR-APPROVAL-011；重送／競爭 | Pending及可重送event | 同event同／異payload；Approve與Withdraw近同時 | Double-click及兩瀏覽器提交 | 每個intent最多一個效果；異payload衝突；最終狀態合法且只有對應一次Audit | 兩邊結果、PO／approval／Audit | — | NOT RUN |
| LIFE-001 | P0 | P2 | U-BUY | FR-LIFE-002～003、AC-018；零收貨撤回 | Confirmed且從未收貨 | REASON | Withdraw Confirmation、修改並重新提交 | 回Draft且舊確認history保留；重新重驗並建立新history；Inventory不變 | PO history、修改結果、Inventory | — | NOT RUN |
| LIFE-002 | P0 | P2／P3 | U-BUY | FR-LIFE-005、AC-019；有收貨不可改寫 | PO已有Confirmed GR | edit／withdraw／cancel | 從UI及直接提交逐一嘗試 | 全部拒絕；商業資料、GR及Inventory歷史不變；只顯示合法下一步 | Actions、錯誤及前後來源 | — | NOT RUN |
| LIFE-003 | P0 | P2 | U-BUY | FR-LIFE-004／010；Cancel狀態 | Draft、Pending、零收貨Confirmed、Partial、Full、Closed | REASON | 逐狀態Cancel | 前三種按合法流程取消；Partial／Full／Closed拒絕；取消後不可收貨或重開 | 各PO狀態及history | — | NOT RUN |
| LIFE-004 | P0 | P2／P3 | U-BUY | FR-LIFE-006～009、AC-020；Close Remaining | PO收8／訂10，另有多Lines | selected lines及all、REASON | Close一Line，再Close其餘 | 未收量被正式關閉但不入庫；已收量不變；全部滿足／關閉後PO為Closed | PO progress前後、Inventory不變、Audit | — | NOT RUN |
| LIFE-005 | P0 | P2／P3 | U-BUY／U-VIEW | FR-LIFE-006～011；狀態推導 | 0、partial、exact、over及closed進度 | 多張GR／Lines | 依序確認收貨及查看PO | 0為Confirmed；不足為Partially Received；全部達標為Fully Received；over不改Ordered；有Closed Remaining時依規則Closed | 每步PO／GR／Inventory進度 | — | NOT RUN |
| LIFE-006 | P0 | P2／P3 | 兩名U-BUY／U-REC | FR-LIFE-012；版本／狀態競爭 | 同一PO／version | Close、cancel、GR confirm | 兩瀏覽器盡量同時提交 | 只有符合提交時狀態者成功；另一方衝突並reload；沒有收貨後仍取消或未收量被錯關兩種效果並存 | 兩邊結果及最終PO／Inventory | — | NOT RUN |

### 7.4 GR Draft及現場收貨錄入（GR）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GR-001 | P0 | P3 | U-REC | FR-LIFE-001、FR-GR-001、AC-021 | 各狀態PO | Draft、Pending、Confirmed、Partial、Full、Closed、Cancelled | 逐張嘗試建立GR | 只有仍可收貨的Confirmed／Partially Received可建立；其他拒絕且零Inventory效果 | PO狀態、建立結果、Inventory前後 | — | NOT RUN |
| GR-002 | P1 | P3 | U-REC | FR-GR-002～004、AC-022 | Confirmed PO有三Lines | 只選第二Line | 建立GR Draft | Supplier固定且不可換；只建立選中Line；其他Lines Outstanding保留 | GR Draft及PO progress | — | NOT RUN |
| GR-003 | P0 | P3 | U-REC | FR-GR-005、AC-023；精確位置 | 一PO Line可收 | 2 Lots×2 Warehouses／Bins | 建立四個Receipt Details並保存 | 四個實際位置／Lot分開保存，UOM／Status清楚；Draft不入庫 | GR details及Inventory前後 | — | NOT RUN |
| GR-004 | P0 | P3 | U-REC | FR-GR-010～011、AC-024；Draft無庫存效果 | 新GR Draft | 有效details | Save、離頁、重開、修改，再Cancel另一Draft | 輸入可恢復及修改；Cancel保留號碼／history；PO Received及Inventory始終不變 | Save／reload／cancel、PO／Inventory前後 | — | NOT RUN |
| GR-005 | P0 | P3 | U-REC | FR-VAL-002、AC-025；不可代收SKU | GR對應SKU-NONE | 替換成另一SKU／PO Line ID | 保存及Confirm | 整張拒絕；不建立替代detail、Movement或PO進度；錯誤不洩漏其他PO資料 | 輸入、錯誤、GR／Inventory前後 | — | NOT RUN |
| GR-006 | P0 | P3 | U-REC | FR-GR-007～008、AC-026；Warehouse／Bin | W-A／W-B及Inactive Bin | W-A配BIN-B1、BIN-INACTIVE、合法W-B／BIN-B1 | 選Warehouse、觀察Bins、替換及保存 | 只列該Warehouse Active Bins；換Warehouse清舊Bin；非法owner／Inactive拒絕；合法其他Warehouse可用 | Bin選項、錯誤及保存結果 | — | NOT RUN |
| GR-007 | P1 | P3 | U-REC | FR-GR-006；SKU／barcode定位 | PO有多Lines及相似barcode結果 | exact SKU、唯一barcode、0 matches、many matches | 搜尋／掃描並新增detail | exact／唯一定位正確PO Line；0或多結果要求人工處理，不靜默選第一個或加入非PO SKU | 搜尋輸入及選擇結果 | — | NOT RUN |
| GR-008 | P1 | P3 | U-REC | FR-GR-008；Default Warehouse只作預設 | PO有default W-A | 改為W-B／BIN-B1 | 建立Draft、覆寫後refresh lookup | W-A首次帶入；合法覆寫保存且不被refresh蓋回；Confirm摘要顯示實際W-B位置 | 表單前後及摘要 | — | NOT RUN |
| GR-009 | P1 | P3 | U-REC | FR-GR-009、AC-035；Delivery Note提示 | 同Supplier近期已有DN-001 | 空白、同DN、不同Supplier同DN | 保存Draft | 空白可保存；同Supplier重複顯示最多5個相關GR連結但可確認不是重複繼續；不同Supplier不誤阻擋 | Warning、連結及保存結果 | — | NOT RUN |
| GR-010 | P0 | P3 | 兩名U-REC | FR-GR-012；GR版本衝突 | 兩頁載入同Draft version | A／B修改不同details | A先Save，B用舊頁Save | A成功；B衝突且不覆蓋A；B輸入保留／可複製後reload | 兩頁、version及最終GR | — | NOT RUN |
| GR-011 | P0 | P3 | U-REC | FR-GR-014；重複dimension | GR同PO Line | 完全相同Line／Warehouse／Bin／Lot／Status兩details | Save | 要求合併或修正；不留下重複details；不同Lot／Bin／Status仍可合法分拆 | 輸入、錯誤及GR details | — | NOT RUN |
| GR-012 | P0 | P3 | U-REC | FR-GR-013；Draft原子保存 | 已有合法多detail Draft | 修改多details且其中一項非法 | Save並重開 | 整張拒絕；所有details、header、version保持上次成功值；無Inventory效果 | 錯誤、GR前後、Inventory | — | NOT RUN |
| GR-013 | P1 | P3 | U-REC | FR-GR-015、UX §10；現場可用性 | 多Lines／details及風險 | 375／768／1024／1440px、鍵盤 | 搜尋PO、掃碼、分拆、換Bin、保存及查看risk summary | 總Base、位置分布、超收／效期風險清楚；窄屏cards可操作、無頁面級橫向捲動；focus及labels正確 | 四寬度截圖及鍵盤錄影 | — | NOT RUN |

### 7.5 收貨驗證與Inventory過帳（REC／POST）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REC-001 | P0 | P3 | U-REC | FR-VAL-001／003～004、AC-027；Tracking／UOM | PO含SKU-NONE／BATCH／EXP | 各合法UOM、Lot／Expiry組合及缺欄 | 逐detail保存／Confirm | none不需Lot；batch需Lot；batch_expiry需Lot＋Expiry；Pack換成整數Base；非法組合整張拒絕 | 輸入、field errors及Inventory前後 | — | NOT RUN |
| REC-002 | P0 | P3 | U-REC | FR-VAL-005、AC-028；Serial不支援 | Draft／PO含SKU-SERIAL | 合法其他欄位 | Submit PO或Confirm GR | 明確拒絕且不降級為none／batch；PO不確認或GR保持Draft；無Movement | 錯誤、PO／GR及Inventory | — | NOT RUN |
| REC-003 | P0 | P3 | U-REC | FR-VAL-006、AC-029；Lot一致性 | LOT-CONFLICT已存在 | 相同SKU／Lot不同Expiry或Manufacture Date至另一Bin／Warehouse | Confirm | 整張拒絕並指出Lot資料衝突；既有Lot不改，無新Bucket／Movement | 錯誤、兩位置Lot及Inventory | — | NOT RUN |
| REC-004 | P0 | P3 | U-EXP | FR-VAL-007／010、AC-030；Expired不可override | 可控制業務收貨日 | LOT-EXPIRED及Expiry早於Receipt Date | 以一般及override角色Confirm | 全部拒絕；override不繞Expired；GR保持Draft且Inventory不變 | 日期、錯誤及前後Inventory | — | NOT RUN |
| REC-005 | P0 | P3 | U-REC／U-EXP | FR-VAL-008～010、AC-031；Minimum Life | SKU-EXP／LOT-LOW | 無權限、缺原因、合法override＋REASON | 逐一Confirm | 顯示門檻／剩餘日數；前兩種拒絕；只有有權、未Expired、其他規則合法及有原因時成功 | 三次結果、GR、Movement／Audit | — | NOT RUN |
| REC-006 | P0 | P3 | U-REC | FR-VAL-011～012、AC-032；Stock Status | 同一GR三details | Available、Quarantined、Damaged、非法第四值 | Confirm合法組合，再測非法值 | 成功時三個對應Inventory buckets正確增加；非法值拒絕；Status不由Inventory猜測 | GR details、三Buckets及Movement | — | NOT RUN |
| REC-007 | P0 | P3 | U-REC | FR-VAL-015、AC-033；Short Receipt | PO Outstanding 10 | 收8 | Confirm | Net Received增加8、Outstanding剩2、PO Partially Received；不要求原因、不自動Close | PO前後、GR及Inventory | — | NOT RUN |
| REC-008 | P0 | P3 | U-REC | FR-VAL-013～014、AC-034；Over-receipt | PO Outstanding 10 | 收12；空白／過長／REASON | 逐項Confirm | 缺合法原因拒絕；有原因成功；Ordered仍10、Net 12、Outstanding 0、Over 2並可查actor／reason | 風險摘要、結果、PO／Audit | — | NOT RUN |
| REC-009 | P0 | P3 | U-REC | FR-VAL-016、BR-038；Supplier後續狀態 | PO確認後SUP-SUSP／SUP-ARCH | 合法GR＋REASON | Confirm | 可在警告及原因下完成既有承諾；不改PO快照或Supplier status；其他安全規則仍適用 | Warning／reason、GR／Supplier／Inventory | — | NOT RUN |
| REC-010 | P0 | P3 | U-REC | BR-038；Blocked Supplier隔離 | PO確認後SUP-BLOCK | Available、Damaged、Quarantined＋REASON | 逐項Confirm | 只有Quarantined且合法原因可成功；其他Status被固定／拒絕；Inventory進隔離bucket | UI限制、錯誤／成功、Bucket／Audit | — | NOT RUN |
| REC-011 | P0 | P3 | U-REC | FR-VAL-016、BR-039；SKU既有承諾 | PO確認後SKU-CHANGED | 缺原因及REASON | Confirm | 顯示目前差異；存在且屬既有PO時有原因可按正式contract收貨；缺原因拒絕；Expired／位置等仍不能繞過 | Warning、兩次結果、快照／目前值 | — | NOT RUN |
| REC-012 | P1 | P3 | U-REC | FR-POST-001；確認摘要 | 多SKU／Lot／Bin／Status、over及expiry override | 合法多detail GR | 開Confirm對話但先不提交 | 摘要逐項列PO、Supplier、SKU、Lot、位置、Status、Base數量及所有例外；不顯示銀行資料 | Confirm摘要截圖 | — | NOT RUN |
| POST-001 | P0 | P3 | U-REC／U-VIEW | FR-POST-002～004、AC-036；原子成功 | 合法多detail GR | 多Line、多Lot、多Bin、多Status | Confirm後由GR、PO及Inventory逐層查看 | GR Confirmed；PO progress／Status、每個Balance／Movement及必要Audit一次完成且雙向可追 | Confirm、GR／PO／Inventory／Audit | — | NOT RUN |
| POST-002 | P0 | P3 | U-REC | FR-POST-002／008、AC-037；任一detail失效 | GR載入後BIN-INACTIVE或另一detail不合格 | 多detail | Confirm | 整張保持Draft；所有details零Inventory效果；PO progress不變；錯誤指出可修正項 | 錯誤、GR／PO／所有Buckets前後 | — | NOT RUN |
| POST-003 | P0 | P3 | U-REC | FR-POST-005、AC-038；Confirm冪等 | 一張GR可重送 | EVT-A同內容 | Double-click、refresh及網路重試 | 回原結果或等效已完成；GR只確認一次，每個bucket只增加一次，Audit／Movement無重複 | 多次結果、Movement／Balance／Audit | — | NOT RUN |
| POST-004 | P0 | P3 | U-REC | FR-POST-006、AC-039；event衝突 | EVT-A已成功或處理中 | 同event改數量、Lot、Bin或Status | 逐種提交 | 回衝突；不接受第二payload、不再過帳或改原結果 | 衝突訊息、GR及Inventory | — | NOT RUN |
| POST-005 | P0 | P3 | U-REC | FR-POST-009、AC-040；回應遺失 | 可模擬Confirm後timeout | GR-DRAFT＋EVT-A | Submit後逾時，按畫面用GR／Request ID查結果，再以原event重試 | 可判定Confirmed或未完成；已完成不重複入庫；未完成才可用原event安全重試 | Timeout、operation查詢、重試及Inventory | — | NOT RUN |
| POST-006 | P0 | P3 | 兩名U-REC | FR-POST-011、AC-041；同PO並發收貨 | PO Outstanding 10 | 兩GR各收6，準備相應over原因 | 兩瀏覽器盡量同時Confirm | 兩筆合法實收準確累計為12；提交次序決定超收判定；沒有lost update或重複progress | 兩邊結果、PO 12／over2、兩組Movement | — | NOT RUN |
| POST-007 | P0 | P3 | U-REC／U-BUY | FR-POST-010、AC-042；過時畫面 | GR頁載入後PO狀態／version改變 | Cancel、Close、Withdraw或另一更新 | 先改PO，再Confirm舊GR | 整張拒絕並要求reload；不以舊頁入庫；GR保持Draft、PO／Inventory保持最新合法狀態 | 時間線、錯誤及前後詳情 | — | NOT RUN |
| POST-008 | P0 | P3 | U-REC | FR-POST-013；Inventory依賴不可用 | UAT隔離環境有批准的dependency outage開關 | 合法GR | 由正常頁Confirm；恢復依賴後重試 | 不可用時fail closed且GR Draft／PO／Inventory無部分效果；恢復後可用原則合法完成 | Outage編號、錯誤、前後GR／PO／Inventory | — | NOT RUN |
| POST-009 | P0 | P3 | U-REC／U-VIEW | FR-POST-007／012／014、AC-043；確認後不可變 | GR已Confirmed | edit、cancel、delete、價格／成本檢查 | 嘗試修改並查看GR／Inventory來源 | edit／cancel／delete全拒絕並指向Reversal；畫面重讀server facts；Inventory來源只有數量／位置，不把PO價格作成本依據 | Actions／拒絕、GR／Movement詳情 | — | NOT RUN |

### 7.6 Receipt Reversal（REV）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REV-001 | P0 | P4 | U-REC／U-BUY／U-VIEW | FR-REV-001、SEC-008；權限及認證 | Confirmed GR | Reversal action／直接URL | 嘗試Reversal | 一般角色無action且直接提交拒絕；GR／PO／Inventory不變；只有U-ADJ配合device-password可繼續 | 權限、拒絕及前後狀態 | — | NOT RUN |
| REV-002 | P0 | P4 | U-ADJ | FR-REV-002／004～005、AC-044；部分反向 | Detail收10且有足夠合資格On Hand | 反向4＋REASON | 選detail、確認影響並提交 | 建立新反向Movement；原GR／Movement不改；可反向餘6；PO Net減4、Outstanding增加4 | Reversal、原／新Movement、PO／Inventory前後 | — | NOT RUN |
| REV-003 | P0 | P4 | U-ADJ | FR-REV-002；多次／多detail上限 | 多details及已部分反向 | 再部分至剛好全反、0、負、超餘量 | 逐項Reversal | 合法多次累計不超原量並可全反；0／負／超量拒絕；餘量與歷史清楚 | 各結果、reversal history及Balance | — | NOT RUN |
| REV-004 | P0 | P4 | U-ADJ | FR-REV-003、AC-045；Inventory當下阻擋 | 分別有不足On Hand、Reservation／Allocation、BIN-COUNT、位置失效 | 單／多details | 逐項提交Reversal | 每種整次拒絕；GR、PO、Balance及Movement全部不變；錯誤可行動 | 錯誤、阻擋資料及前後狀態 | — | NOT RUN |
| REV-005 | P0 | P4 | U-ADJ | FR-REV-007；跨detail全有或全無 | 兩details，一項可反一項被阻擋 | 各反2 | 一次提交 | 整個Reversal拒絕；可反的一項也不扣；沒有部分PO progress或Audit成功效果 | 兩details／Buckets、PO及Movement前後 | — | NOT RUN |
| REV-006 | P0 | P4 | U-ADJ | FR-REV-008、AC-046；冪等／衝突 | 可重送Reversal | EVT-A同內容、EVT-A改數量 | Double-click／refresh重送，再改payload | 同內容只反向一次；異內容衝突；PO／Inventory只反映一次合法效果 | 多次結果、Reversal／Movement／PO | — | NOT RUN |
| REV-007 | P0 | P4 | U-ADJ／U-VIEW | FR-REV-005～006、AC-047；PO狀態重算 | Fully Received及人工Closed各一張 | 部分反向 | 分別Reversal並查看PO | Fully Received重新出現Outstanding後回Confirmed／Partially Received；人工Closed保持Closed並顯示差異warning | 兩張PO前後、warning及Inventory | — | NOT RUN |
| REV-008 | P1 | P4 | U-ADJ／U-REC | FR-REV-009～010；正確更正流程 | 一張錯收GR | Reversal後建立新GR；物理退貨情境 | 按UI指引操作 | 錯收以Reversal＋新GR更正；原歷史完整；系統不把Reversal標為Supplier Return或提供未批准退貨流程 | 流程頁、來源鏈及狀態 | — | NOT RUN |

### 7.7 查詢、列印、CSV與Audit追溯（REPORT）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REPORT-001 | P1 | P1～P4 | U-VIEW | FR-LIST-001～004／009；PO列表 | 大量各狀態PO | PO／Supplier／SKU／reference、status、buyer、currency、dates、outstanding | 組合filter、sort、翻頁、refresh／back | 結果、total及順序穩定；URL可還原且無敏感內容；顯示Total、progress、status及更新時間 | URL、network及多頁畫面 | — | NOT RUN |
| REPORT-002 | P1 | P4 | U-VIEW | FR-REPORT-001～002；GR列表／詳情 | 多Supplier／SKU／Warehouse及risk GR | GR／PO、status、date、warehouse、over、expiry、SKU exception | 查詢並開詳情 | Filters準確；詳情含Delivery Note、所有details、Inventory、Reversal、actor及時間 | List／detail及來源頁 | — | NOT RUN |
| REPORT-003 | P1 | P4 | U-VIEW | FR-REPORT-003；Outstanding | Partial、overdue、Full、Closed、Cancelled PO | Supplier、SKU、buyer、delivery／overdue | 查詢Outstanding | 只回真正未完成承諾；Full／Closed／Cancelled不誤列；數量與PO詳情一致 | Outstanding及PO對照 | — | NOT RUN |
| REPORT-004 | P1 | P4 | U-VIEW | FR-REPORT-004、AC-052；CSV與畫面一致 | 已套用PO／GR filters | Currency、Purchase／Base UOM、times | 匯出PO、Outstanding及GR CSV | CSV只含filter結果、穩定欄位及一致數量／時間；畫面與CSV總數／語意相符 | URL、CSV hash／內容及畫面 | — | NOT RUN |
| REPORT-005 | P0 | P4 | U-VIEW | FR-REPORT-005、SEC-013～015；CSV安全 | TEXT-RISK及Supplier含測試銀行資料 | `= + - @`開頭及敏感欄位 | 匯出並安全開啟CSV | 公式字首neutralize；無password、token、銀行、SQL、stack、內部path或未授權欄位 | CSV redacted sample及內容檢查 | — | NOT RUN |
| REPORT-006 | P1 | P1 | U-VIEW | FR-REPORT-006；A4 browser print | Draft及100-Line Confirmed PO | 長Supplier／SKU／notes | 開print preview並測A4分頁 | Draft有水印；正式版資料完整；header重現、行不異常切斷；不建立server PDF artifact | Print preview各頁及下載行為 | — | NOT RUN |
| REPORT-007 | P0 | P1～P4 | U-VIEW | FR-REPORT-007、AC-051；交易快照 | Confirmed PO／GR後修改master | Supplier name／address、SKU name、UOM、Payment Term | 修改master後重開PO／GR／print | 歷史仍顯示確認時快照，另區分目前master；金額／數量／UOM不被回寫 | 修改前後master、PO／GR／print | — | NOT RUN |
| REPORT-008 | P1 | P4 | U-VIEW | FR-REPORT-008～010；Supplier供貨soft relation | Confirmed Receipt成功 | SUP-A＋SKU-NONE | 從Supplier開近期PO／GR／供貨紀錄 | 可連至正式來源；最近供貨日期更新且不自動preferred；不顯示績效分數、成本趨勢、應付或付款 | Supplier及來源頁 | — | NOT RUN |
| REPORT-009 | P0 | P1～P4 | U-VIEW／各操作角色 | FR-AUDIT-001～002／005／008；操作稽核 | 已執行settings、PO、approval、close、GR、over、override、reversal | actor、action、object、reason、date、outcome | 依各條件搜尋Audit並開詳情 | 每種重要操作可查actor、before／after摘要、reason、time、request／source及outcome；失敗／衝突亦可調查 | Audit filters及各action詳情 | — | NOT RUN |
| REPORT-010 | P0 | P3～P4 | U-VIEW | FR-AUDIT-003、AC-053；端到端追溯 | 完整PO→Approval→多GR→Reversal | 任一來源入口 | 由Supplier、SKU、PO、GR、Movement及Audit逐一往返 | 每個入口均能追到同一正式來源鏈、actor及reason；ID與數量一致，無斷鏈或錯鏈 | 全部來源頁及ID對照 | — | NOT RUN |
| REPORT-011 | P0 | P1～P4 | 對應角色 | FR-AUDIT-004；成功與Audit一致 | 技術團隊提供一個已批准的Audit不可用UAT情境 | PO action或GR Confirm | 由正常頁提交並查看業務結果 | 需要交易式Audit的操作不得無聲成功；畫面顯示失敗／未知，業務資料及Inventory沒有半套效果 | 情境編號、錯誤及前後業務頁 | — | NOT RUN |
| REPORT-012 | P1 | P1～P4 | U-VIEW | FR-AUDIT-006～007；保留／不可改寫 | 已完成PO、Approval、GR、Movement、Reversal及Audit | 一般edit／delete入口 | 從UI及可用操作嘗試改寫歷史 | 沒有一般修改／刪除能力；actor停用後歷史仍可讀；保留政策及來源不斷裂 | Actions、歷史及actor顯示 | — | NOT RUN |

### 7.8 業務連續性、效能體感及驗收簽核（OPS）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | P1 | P1～P4 | U-VIEW／U-BUY／U-REC | NFR-001～005、AC-054；常用效能 | 規格容量資料已由技術團隊準備 | 100k SKUs、10k Suppliers、50k POs、100k GRs | 執行精確PO／GR／SKU／barcode及常用列表操作 | 正常20使用者負載下p95少於2秒，結果完整；畫面有明確loading且不凍結 | 測試時間、畫面錄影及系統效能報告引用 | — | NOT RUN |
| OPS-002 | P1 | P1／P3／P4 | U-BUY／U-REC／U-VIEW | NFR-003～005；最大業務單據 | 系統測試容量證據已通過 | 100-Line PO、200-Detail GR、50k CSV | Save／submit PO、validate／confirm GR及export | PO在3秒目標、GR在5秒目標內有明確進度；CSV在120秒cap內完成或清楚拒絕超限，不默默漏資料 | 操作錄影、單據及效能報告 | — | NOT RUN |
| OPS-003 | P1 | 各Phase | 各業務角色 | NFR-013～015；瀏覽器／responsive／a11y | Chrome、Edge、Safari支援版本 | 375／768／1024／1440px、鍵盤 | 完成PO建立、Approval、GR分拆／Confirm、Close及Reversal | 核心流程可用鍵盤完成；focus／labels／alerts／status文字正確；窄屏無不可操作橫向捲動；console無error | 瀏覽器版本、四寬度截圖及錄影 | — | NOT RUN |
| OPS-004 | P0 | P1～P4 | U-BUY／U-APP／U-REC／U-ADJ | NFR-006～011；double-click／session／恢復 | 可模擬slow network、session expiry及response loss | Create、Approve、Confirm、Reversal events | 快速雙擊、refresh、session過期後submit及timeout後查詢 | 不產生重複效果；過期session清楚要求登入且保留安全草稿；未知結果先查詢再重試 | 操作時間線、結果及來源數量 | — | NOT RUN |
| OPS-005 | P0 | P3～P4 | U-VIEW | NFR-006～010；跨模組對賬 | 完成partial、over及reversal流程 | 一張代表性PO | 由PO、GR、Inventory及Audit人工加總 | Ordered、gross、reversed、net、outstanding、over、closed及各Inventory Movements完全對上；差異為0 | 對賬工作表及全部來源頁 | — | NOT RUN |
| OPS-006 | P1 | P4 | U-VIEW／U-NONE | NFR-012、SEC-014～015；資料隔離 | 有不同角色可見資料 | export、URL、Audit、error及long text | 跨頁搜尋、分享URL、匯出及觸發安全錯誤 | 所有顯示使用一致時區／格式；URL與下載無認證／銀行／內部資料；長文字安全截斷可查看 | URL、CSV、畫面及錯誤 | — | NOT RUN |
| OPS-007 | P1 | P4 | 業務owners | Requirement §16.3；Go-Live rehearsal | 正式角色／master／setting初值已準備 | none、batch、batch_expiry、partial、over、Blocked、expiry override、reversal | 依正式SOP完成代表性端到端流程 | 每項結果與本文件案例一致；Approval預設OFF經owner確認；Receiving capability只在Provider及Inventory ready後開放 | Rehearsal記錄、角色／設定及簽核 | — | NOT RUN |
| OPS-008 | P1 | P4 | 業務owners／U-VIEW | NFR-016、AC-055；備份還原後業務驗證 | 技術團隊在隔離環境完成指定backup／restore | 含Approval、多GR、over、Blocked、Archived SKU及Reversal的PO | 登入restore環境，由頁面重做REPORT-010及OPS-005對賬 | PO、Approval、GR、line progress、Movement、Reversal及Audit全部可查且100%對賬；任何差異記錄為defect，不直接手改 | Restore build、來源頁、對賬及簽核 | — | NOT RUN |

---

## 8. Acceptance Criteria覆蓋矩陣

| Acceptance Criteria | 主要Test Case IDs | 初始結果 |
| --- | --- | --- |
| AC-001～002 | SET-001～004 | NOT RUN |
| AC-003～005 | PO-001～003 | NOT RUN |
| AC-006～011 | PO-004～013、PO-017 | NOT RUN |
| AC-012～017 | APP-001～009 | NOT RUN |
| AC-018～020 | LIFE-001～006 | NOT RUN |
| AC-021～026 | GR-001～006 | NOT RUN |
| AC-027～032 | REC-001～006 | NOT RUN |
| AC-033～035 | REC-007～008、GR-009 | NOT RUN |
| AC-036～043 | POST-001～009 | NOT RUN |
| AC-044～047 | REV-002～007 | NOT RUN |
| AC-048～050 | AUTH-003～005、REV-001 | NOT RUN |
| AC-051～053 | REPORT-004、REPORT-007～010 | NOT RUN |
| AC-054～055 | OPS-001～002、OPS-008 | NOT RUN |

---

## 9. Phase執行建議

| Phase | 執行案例 | Phase UAT目標 |
| --- | --- | --- |
| Phase 0 | AUTH-001～006中可執行部分；其餘以Provider／Framework system-test證據作進入門檻 | 證明身份、permission及Provider前置已ready，但不提前開放業務入口 |
| Phase 1 | SET-001、PO-001～017、REPORT-001／006～007、OPS-001～004相關部分 | 可建立、直接確認、查詢及列印PO，Inventory完全不變 |
| Phase 2 | SET-002～006、APP-001～009、LIFE-001～006及相關Audit | 審批與PO生命周期符合職責分離且不改寫歷史 |
| Phase 3 | GR-001～013、REC-001～012、POST-001～009、OPS-005 | 實收到具體SKU／Lot／Bin，GR、PO及Inventory全有或全無一致 |
| Phase 4 | REV-001～008、REPORT-002～005／008～012、OPS-001～008完整回歸 | 更正、報表、追溯、恢復及上線證據完整 |

每個Phase完成後應產出獨立execution report，記錄Planned、Executed、PASS、FAIL、BLOCKED、NOT RUN、Defects及`GO / GO WITH KNOWN RISK / NO-GO / INSUFFICIENT EVIDENCE`建議。不得因案例存在便視為已覆蓋；只有實際執行並保存Required Evidence才可判定PASS。

---

## 10. Harness 2.0 正式 UAT 定義

本節把 §7 的 106 條案例整理成穩定的 `UAT` 實體，作為 `08_traceability.json` 的 UAT 節點。§7 的表格仍是步驟、測試資料及證據欄位的來源，並保留 `Actual Evidence` 與 `Status` 供實際執行時填寫；本節只補上穩定身分、需求接地、技術測試前置及 mandatory／applicability 標記。


### 10.1 UAT ID 對照

| Harness ID | Legacy ID | Priority | Phase |
| --- | --- | --- | --- |
| UAT-001 | AUTH-001 | P0 | 各Phase |
| UAT-002 | AUTH-002 | P0 | 各Phase |
| UAT-003 | AUTH-003 | P0 | P1～P4 |
| UAT-004 | AUTH-004 | P0 | P2～P4 |
| UAT-005 | AUTH-005 | P0 | 各Phase |
| UAT-006 | AUTH-006 | P0 | P1～P4 |
| UAT-007 | SET-001 | P1 | P1 |
| UAT-008 | SET-002 | P0 | P2 |
| UAT-009 | SET-003 | P0 | P2 |
| UAT-010 | SET-004 | P0 | P2 |
| UAT-011 | SET-005 | P0 | P2 |
| UAT-012 | SET-006 | P1 | P2 |
| UAT-013 | PO-001 | P0 | P1 |
| UAT-014 | PO-002 | P1 | P1 |
| UAT-015 | PO-003 | P1 | P1 |
| UAT-016 | PO-004 | P0 | P1 |
| UAT-017 | PO-005 | P0 | P1 |
| UAT-018 | PO-006 | P0 | P1 |
| UAT-019 | PO-007 | P0 | P1 |
| UAT-020 | PO-008 | P0 | P1 |
| UAT-021 | PO-009 | P0 | P1 |
| UAT-022 | PO-010 | P0 | P1 |
| UAT-023 | PO-011 | P0 | P1 |
| UAT-024 | PO-012 | P0 | P1 |
| UAT-025 | PO-013 | P0 | P1 |
| UAT-026 | PO-014 | P1 | P1 |
| UAT-027 | PO-015 | P1 | P1 |
| UAT-028 | PO-016 | P1 | P1 |
| UAT-029 | PO-017 | P0 | P1 |
| UAT-030 | APP-001 | P0 | P2 |
| UAT-031 | APP-002 | P0 | P2 |
| UAT-032 | APP-003 | P0 | P2 |
| UAT-033 | APP-004 | P0 | P2 |
| UAT-034 | APP-005 | P1 | P2 |
| UAT-035 | APP-006 | P0 | P2 |
| UAT-036 | APP-007 | P0 | P2 |
| UAT-037 | APP-008 | P0 | P2 |
| UAT-038 | APP-009 | P0 | P2 |
| UAT-039 | LIFE-001 | P0 | P2 |
| UAT-040 | LIFE-002 | P0 | P2／P3 |
| UAT-041 | LIFE-003 | P0 | P2 |
| UAT-042 | LIFE-004 | P0 | P2／P3 |
| UAT-043 | LIFE-005 | P0 | P2／P3 |
| UAT-044 | LIFE-006 | P0 | P2／P3 |
| UAT-045 | GR-001 | P0 | P3 |
| UAT-046 | GR-002 | P1 | P3 |
| UAT-047 | GR-003 | P0 | P3 |
| UAT-048 | GR-004 | P0 | P3 |
| UAT-049 | GR-005 | P0 | P3 |
| UAT-050 | GR-006 | P0 | P3 |
| UAT-051 | GR-007 | P1 | P3 |
| UAT-052 | GR-008 | P1 | P3 |
| UAT-053 | GR-009 | P1 | P3 |
| UAT-054 | GR-010 | P0 | P3 |
| UAT-055 | GR-011 | P0 | P3 |
| UAT-056 | GR-012 | P0 | P3 |
| UAT-057 | GR-013 | P1 | P3 |
| UAT-058 | REC-001 | P0 | P3 |
| UAT-059 | REC-002 | P0 | P3 |
| UAT-060 | REC-003 | P0 | P3 |
| UAT-061 | REC-004 | P0 | P3 |
| UAT-062 | REC-005 | P0 | P3 |
| UAT-063 | REC-006 | P0 | P3 |
| UAT-064 | REC-007 | P0 | P3 |
| UAT-065 | REC-008 | P0 | P3 |
| UAT-066 | REC-009 | P0 | P3 |
| UAT-067 | REC-010 | P0 | P3 |
| UAT-068 | REC-011 | P0 | P3 |
| UAT-069 | REC-012 | P1 | P3 |
| UAT-070 | POST-001 | P0 | P3 |
| UAT-071 | POST-002 | P0 | P3 |
| UAT-072 | POST-003 | P0 | P3 |
| UAT-073 | POST-004 | P0 | P3 |
| UAT-074 | POST-005 | P0 | P3 |
| UAT-075 | POST-006 | P0 | P3 |
| UAT-076 | POST-007 | P0 | P3 |
| UAT-077 | POST-008 | P0 | P3 |
| UAT-078 | POST-009 | P0 | P3 |
| UAT-079 | REV-001 | P0 | P4 |
| UAT-080 | REV-002 | P0 | P4 |
| UAT-081 | REV-003 | P0 | P4 |
| UAT-082 | REV-004 | P0 | P4 |
| UAT-083 | REV-005 | P0 | P4 |
| UAT-084 | REV-006 | P0 | P4 |
| UAT-085 | REV-007 | P0 | P4 |
| UAT-086 | REV-008 | P1 | P4 |
| UAT-087 | REPORT-001 | P1 | P1～P4 |
| UAT-088 | REPORT-002 | P1 | P4 |
| UAT-089 | REPORT-003 | P1 | P4 |
| UAT-090 | REPORT-004 | P1 | P4 |
| UAT-091 | REPORT-005 | P0 | P4 |
| UAT-092 | REPORT-006 | P1 | P1 |
| UAT-093 | REPORT-007 | P0 | P1～P4 |
| UAT-094 | REPORT-008 | P1 | P4 |
| UAT-095 | REPORT-009 | P0 | P1～P4 |
| UAT-096 | REPORT-010 | P0 | P3～P4 |
| UAT-097 | REPORT-011 | P0 | P1～P4 |
| UAT-098 | REPORT-012 | P1 | P1～P4 |
| UAT-099 | OPS-001 | P1 | P1～P4 |
| UAT-100 | OPS-002 | P1 | P1／P3／P4 |
| UAT-101 | OPS-003 | P1 | 各Phase |
| UAT-102 | OPS-004 | P0 | P1～P4 |
| UAT-103 | OPS-005 | P0 | P3～P4 |
| UAT-104 | OPS-006 | P1 | P4 |
| UAT-105 | OPS-007 | P1 | P4 |
| UAT-106 | OPS-008 | P1 | P4 |

### 10.2 對齊時補回的追溯連結

原 §6／§7 的 `Requirement／Risk` 欄以摘要方式引用需求，令 `FR-SET-005`（現 `FR-005`）及 `FR-APPROVAL-012`（現 `FR-047`）沒有任何案例明文引用。對齊時按案例實際驗證內容補回：`FR-005` 連至 UAT-013（SET-005）、UAT-030（APP-001）及 UAT-033（APP-004）；`FR-047` 連至 UAT-032（APP-003）及 UAT-034（APP-005）。案例步驟與期望結果未被修改。


### 10.3 Mandatory 與 blocking 的對應

§3.2 的完成準則要求 P0 及 P1 案例全部執行，P0 全部通過，而 P1 缺陷須有 Product Owner 接受的處理決定。Harness 的 typed ledger 沒有「必須執行但可接受缺陷」這個中間狀態，且明確規定 mandatory 必須 blocking，因此 106 條案例一律記為 `mandatory: true`、`blocking: true`。P1 的彈性以既有機制表達：執行時由 Product Owner 在 `applicability` 上記錄具名 `approval_id`，而不是把案例預先降級為非必要。P0／P1 的原始優先級保留在每條定義及 §7 表格內。


## Formal definitions

## UAT-001 — AUTH-001：導向登入或顯示未登入；沒有PO、GR或主資料內容可見

### Business objective and actor
角色：未登入。業務風險與需求接地：SEC-001；未登入存取。(Legacy identity: `AUTH-001`; priority: `P0`; 開發 Phase: `各Phase`.)

### Preconditions and data
前置條件：已登出 測試資料：所有Purchasing／Receiving URL

### Steps
直接開啟PO、Approval、GR、Outstanding及Settings頁

### Expected business result
導向登入或顯示未登入；沒有PO、GR或主資料內容可見

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：URL、登入導向及畫面。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-002 — AUTH-002：Menu不顯示；直接URL拒絕；System Administrator不因角色名稱取得能力

### Business objective and actor
角色：U-NONE／U-SYS。業務風險與需求接地：SEC-002～009；權限不繼承。(Legacy identity: `AUTH-002`; priority: `P0`; 開發 Phase: `各Phase`.)

### Preconditions and data
前置條件：兩角色均未獲本模組permission 測試資料：Sidebar及所有頁面URL

### Steps
登入後檢查menu，再直接開各URL

### Expected business result
Menu不顯示；直接URL拒絕；System Administrator不因角色名稱取得能力

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：角色設定、menu及拒絕畫面。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-003 — AUTH-003：查詢／匯出成功；寫入按鈕不可用，直接提交仍拒絕；資料不變

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：SEC-002、AC-048；只讀。(Legacy identity: `AUTH-003`; priority: `P0`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：已有PO／GR資料 測試資料：查詢、export及所有write actions

### Steps
查看／匯出後嘗試create、update、submit、approve、confirm、close及reversal

### Expected business result
查詢／匯出成功；寫入按鈕不可用，直接提交仍拒絕；資料不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：權限、成功查詢、拒絕及前後狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-004 — AUTH-004：每人只可完成明確獲授權能力；任一permission不暗含另一項

### Business objective and actor
角色：U-BUY／U-APP／U-REC／U-EXP／U-ADJ／U-SET。業務風險與需求接地：SEC-003～008；最小權限。(Legacy identity: `AUTH-004`; priority: `P0`; 開發 Phase: `P2～P4`.)

### Preconditions and data
前置條件：六個獨立帳戶 測試資料：各角色專屬與非專屬操作

### Steps
逐角色嘗試PO管理、Approval、GR、expiry override、Reversal及Settings

### Expected business result
每人只可完成明確獲授權能力；任一permission不暗含另一項

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：角色矩陣、可用actions及拒絕畫面。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-005 — AUTH-005：提交被清楚拒絕；PO／GR／Inventory／Audit沒有成功效果；提示重新登入或聯絡管理員

### Business objective and actor
角色：U-STALE。業務風險與需求接地：SEC-012、AC-050；提交點重驗。(Legacy identity: `AUTH-005`; priority: `P0`; 開發 Phase: `各Phase`.)

### Preconditions and data
前置條件：已載入可提交畫面 測試資料：PO submit、approve、GR confirm、Close、Reversal

### Steps
管理員撤權或停用後，由原頁提交

### Expected business result
提交被清楚拒絕；PO／GR／Inventory／Audit沒有成功效果；提示重新登入或聯絡管理員

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：撤權時間、錯誤及前後業務頁。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-006 — AUTH-006：不可讀寫不屬於目標aggregate的資料；錯誤不洩漏存在性、銀行、SQL、stack、token或內部路徑；資料不變

### Business objective and actor
角色：對應角色。業務風險與需求接地：SEC-010／013～015；ID替換與資料洩漏。(Legacy identity: `AUTH-006`; priority: `P0`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：有兩張不同owner tree的PO／GR／details 測試資料：替換URL／表單中的PO Line、Approval、GR Detail、Bin或Movement ID及TEXT-RISK

### Steps
以瀏覽器可操作方式替換ID或輸入惡意文字並提交

### Expected business result
不可讀寫不屬於目標aggregate的資料；錯誤不洩漏存在性、銀行、SQL、stack、token或內部路徑；資料不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：URL／輸入、錯誤、前後詳情。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-007 — SET-001：只有「PO需要審批」；預設OFF；顯示目前值、最後修改資訊及初始化歷史

### Business objective and actor
角色：U-SET。業務風險與需求接地：FR-SET-001～002／007、AC-001；預設值。(Legacy identity: `SET-001`; priority: `P1`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：尚未修改setting 測試資料：初始環境

### Steps
開啟Purchasing Settings及history

### Expected business result
只有「PO需要審批」；預設OFF；顯示目前值、最後修改資訊及初始化歷史

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Settings及history畫面。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-008 — SET-002：沒有設定入口；直接提交亦拒絕；值與history不變

### Business objective and actor
角色：U-VIEW／U-BUY／U-SYS。業務風險與需求接地：FR-SET-003、SEC-007、AC-002。(Legacy identity: `SET-002`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Setting為OFF 測試資料：ON

### Steps
從UI及直接提交嘗試修改

### Expected business result
沒有設定入口；直接提交亦拒絕；值與history不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：角色、拒絕、設定前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-009 — SET-003：修改成功、version更新；Audit／history有actor、before／after、reason、time及…

### Business objective and actor
角色：U-SET。業務風險與需求接地：FR-SET-003、SEC-011／016。(Legacy identity: `SET-003`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：有已註冊測試裝置 測試資料：ON、正確device-password、REASON

### Steps
修改setting並重新開頁

### Expected business result
修改成功、version更新；Audit／history有actor、before／after、reason、time及result

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：認證對話、設定前後、Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-010 — SET-004：全部拒絕；不降級為一般JWT；setting、version及成功Audit不變

### Business objective and actor
角色：U-SET。業務風險與需求接地：SEC-011；高風險認證。(Legacy identity: `SET-004`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Setting為OFF 測試資料：缺原因、錯密碼、過期challenge、另一裝置signature

### Steps
分別嘗試改ON

### Expected business result
全部拒絕；不降級為一般JWT；setting、version及成功Audit不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：各次錯誤、設定前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-011 — SET-005：舊Pending／Confirmed不被自動批准、拒絕或改寫；只有變更後新提交按新值分流

### Business objective and actor
角色：U-SET／U-BUY。業務風險與需求接地：FR-SET-006、FR-APPROVAL-001。(Legacy identity: `SET-005`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：已有Pending、Confirmed及新Draft PO 測試資料：OFF→ON及ON→OFF

### Steps
改setting後查看舊PO，再提交新Draft

### Expected business result
舊Pending／Confirmed不被自動批准、拒絕或改寫；只有變更後新提交按新值分流

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：setting history、三張PO狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-012 — SET-006：歷史順序及值正確；URL不含認證；非法文字安全顯示／拒絕；沒有未批准的額外參數

### Business objective and actor
角色：U-SET。業務風險與需求接地：FR-SET-001／007、SEC-013。(Legacy identity: `SET-006`; priority: `P1`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Setting已修改數次 測試資料：URL refresh、back／forward、TEXT-RISK reason

### Steps
查history、刷新及輸入非法原因

### Expected business result
歷史順序及值正確；URL不含認證；非法文字安全顯示／拒絕；沒有未批准的額外參數

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：URL、history及錯誤畫面。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-013 — PO-001：Supplier可搜尋及選擇；沒有關係不阻擋合法建單；不會自動標preferred

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-002／007、AC-003；供貨關係非白名單。(Legacy identity: `PO-001`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：SUP-NOREL及SKU-NONE均Active 測試資料：1 EA、HKD

### Steps
搜尋SUP-NOREL並建立Draft

### Expected business result
Supplier可搜尋及選擇；沒有關係不阻擋合法建單；不會自動標preferred

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Supplier搜尋、Draft及提示。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-014 — PO-002：Active且有歷史者可排前；Suspended不可選；其他Active仍可見且可選

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-LIST-008、AC-004；Supplier排序與資格。(Legacy identity: `PO-002`; priority: `P1`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：SUP-PREF Active、另一preferred Suspended、SUP-NOREL Active 測試資料：SKU-NONE

### Steps
由SKU搜尋Supplier

### Expected business result
Active且有歷史者可排前；Suspended不可選；其他Active仍可見且可選

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：搜尋次序及選擇結果。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-015 — PO-003：Defaults首次帶入；使用者修改不被refresh覆蓋；Confirmed保存覆寫後快照

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-003、AC-005；defaults可覆寫。(Legacy identity: `PO-003`; priority: `P1`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：SUP-A具defaults 測試資料：改Currency／Payment Term／Address

### Steps
選Supplier、覆寫defaults、refresh lookup後保存並確認

### Expected business result
Defaults首次帶入；使用者修改不被refresh覆蓋；Confirmed保存覆寫後快照

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：表單前後、PO詳情快照。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-016 — PO-004：唯一PO Number、同一Supplier／Currency、兩Lines及Total正確；Inventory無Bal…

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-001／004～005、AC-006；完整建單。(Legacy identity: `PO-004`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：Approval OFF；無同run PO 測試資料：SUP-A、SKU-NONE＋SKU-BATCH

### Steps
建立兩Line Draft並保存

### Expected business result
唯一PO Number、同一Supplier／Currency、兩Lines及Total正確；Inventory無Balance／Movement變化

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：建立結果、PO詳情、Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-017 — PO-005：顯示3 BOX＝72 EA；Ordered Base為72正整數；確認後factor快照不變

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-008～009、AC-007；UOM整數換算。(Legacy identity: `PO-005`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：BOX24有效 測試資料：3 BOX

### Steps
建立PO並查看line preview及詳情

### Expected business result
顯示3 BOX＝72 EA；Ordered Base為72正整數；確認後factor快照不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：表單、line詳情及快照。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-018 — PO-006：每項field-level拒絕；整張Draft無部分lines／錯誤Total；合法最小／上限內值可保存

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-008～009；數量／UOM負面及邊界。(Legacy identity: `PO-006`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：SKU-NONE及UOM-BAD 測試資料：0、負數、超scale、不能整除、超上限、另一SKU UOM

### Steps
逐項保存或確認

### Expected business result
每項field-level拒絕；整張Draft無部分lines／錯誤Total；合法最小／上限內值可保存

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：輸入、錯誤及PO前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-019 — PO-007：負價、零價無原因及超4位拒絕；零價有原因可繼續並在確認／審批明示

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-010、AC-008；Unit Price。(Legacy identity: `PO-007`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：有效Draft 測試資料：負價、零價空原因、零價REASON、4／5 decimals

### Steps
逐項保存及提交

### Expected business result
負價、零價無原因及超4位拒絕；零價有原因可繼續並在確認／審批明示

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：表單錯誤、風險摘要、PO詳情。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-020 — PO-008：每Line按Currency scale HALF_UP後加總；server值為正本；沒有Tax、Discount、Fr…

### Business objective and actor
角色：U-BUY／U-VIEW。業務風險與需求接地：FR-PO-011、AC-009；金額精度。(Legacy identity: `PO-008`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：CUR-HKD及CUR-JPY 測試資料：HALF_UP邊界、多Lines、大值

### Steps
建立PO，比較preview、保存、詳情及列印

### Expected business result
每Line按Currency scale HALF_UP後加總；server值為正本；沒有Tax、Discount、Freight或Landed Cost

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：輸入、line／total、列印對照。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-021 — PO-009：必須至少一個有效Line；一PO只一Supplier／Currency；自由文字不能代替結構欄位

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-004～005／017；結構完整性。(Legacy identity: `PO-009`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：空Draft及合法Draft 測試資料：零Lines、混Supplier／Currency、notes冒充SKU／price

### Steps
保存及提交

### Expected business result
必須至少一個有效Line；一PO只一Supplier／Currency；自由文字不能代替結構欄位

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：輸入、錯誤、PO前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-022 — PO-010：按提交時事實拒絕並指出可行動原因；Draft保留、無Confirmed快照或Inventory效果

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-006／018；提交時重驗。(Legacy identity: `PO-010`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：Draft建立時master有效 測試資料：Supplier／SKU／UOM／Currency／Payment Term其後停用，另用SKU-SERIAL

### Steps
逐項提交Draft

### Expected business result
按提交時事實拒絕並指出可行動原因；Draft保留、無Confirmed快照或Inventory效果

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：master時間線、錯誤、PO狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-023 — PO-011：合法整張更新且順序正確；非法時所有header／lines／total／version保持上次成功值

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-012／014；完整replace原子保存。(Legacy identity: `PO-011`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：三Line Draft 測試資料：新增、修改、排序、刪除；其中一Line非法

### Steps
先合法保存，再帶一項非法保存

### Expected business result
合法整張更新且順序正確；非法時所有header／lines／total／version保持上次成功值

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：前後PO、錯誤、version。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-024 — PO-012：A成功；B收到version conflict且不覆蓋A；B輸入可保留／複製後reload

### Business objective and actor
角色：兩名U-BUY。業務風險與需求接地：FR-PO-013、AC-010；版本衝突。(Legacy identity: `PO-012`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：兩瀏覽器載入同version 測試資料：A／B修改不同lines

### Steps
A先保存，B以舊頁保存

### Expected business result
A成功；B收到version conflict且不覆蓋A；B輸入可保留／複製後reload

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：兩頁、衝突及最終PO。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-025 — PO-013：同event同內容只有一張PO／一次更新；異內容衝突；新event仍受業務唯一／version規則

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-015；安全重送。(Legacy identity: `PO-013`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：可重送create／update intent 測試資料：EVT-A同內容、EVT-A異內容、EVT-B

### Steps
Double-click、刷新重送及改payload重送

### Expected business result
同event同內容只有一張PO／一次更新；異內容衝突；新event仍受業務唯一／version規則

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：回應、PO列表、lines及Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-026 — PO-014：建立新編號Draft；不複製approval／receipt／status；全部master重新驗證，失效者清楚拒絕

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-PO-016；Copy重驗。(Legacy identity: `PO-014`; priority: `P1`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：有Confirmed及歷史PO 測試資料：master仍有效及其後失效兩組

### Steps
Copy PO並保存新Codes／資料

### Expected business result
建立新編號Draft；不複製approval／receipt／status；全部master重新驗證，失效者清楚拒絕

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Source／copy詳情及錯誤。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-027 — PO-015：預設最近更新、分頁穩定無漏重；URL還原非敏感filters；欄位完整，長文字可查看且不阻礙操作

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-LIST-001～004／007／009～010。(Legacy identity: `PO-015`; priority: `P1`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：超過120張各狀態PO及長文字 測試資料：q、status、supplier、buyer、currency、dates、outstanding、sort

### Steps
組合搜尋、跨頁、refresh、back／forward

### Expected business result
預設最近更新、分頁穩定無漏重；URL還原非敏感filters；欄位完整，長文字可查看且不阻礙操作

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：URL、多頁結果及詳情。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-028 — PO-016：Header、Lines、Approval、GR、Inventory及Audit入口可見；每Line數量分欄且公式一致

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-LIST-005～006；PO詳情進度。(Legacy identity: `PO-016`; priority: `P1`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：一張多Lines且不同收貨進度PO 測試資料：ordered／gross／reversed／net／outstanding／over／closed

### Steps
開詳情及各sections

### Expected business result
Header、Lines、Approval、GR、Inventory及Audit入口可見；每Line數量分欄且公式一致

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：PO詳情及來源連結。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-029 — PO-017：直接Confirmed並保存交易快照／Audit；顯示可收貨；Inventory完全不變

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-SET-004、FR-APPROVAL-001、AC-011。(Legacy identity: `PO-017`; priority: `P0`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：Approval OFF；完整Draft 測試資料：SUP-A＋兩SKU

### Steps
Submit並重開詳情

### Expected business result
直接Confirmed並保存交易快照／Audit；顯示可收貨；Inventory完全不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Submit結果、PO狀態／快照／Audit、Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-030 — APP-001：PO進Pending Approval；保存不可變snapshot及version；不進Inventory

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-APPROVAL-001～002、AC-012。(Legacy identity: `APP-001`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Approval ON；完整Draft 測試資料：U-APP

### Steps
Submit並選U-APP

### Expected business result
PO進Pending Approval；保存不可變snapshot及version；不進Inventory

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Submit結果、PO／approval詳情。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-031 — APP-002：系統拒絕自我指定或自我批准；PO保持Draft／Pending原狀且無成功Audit

### Business objective and actor
角色：同時具BUY＋APP的提交人。業務風險與需求接地：FR-APPROVAL-003、AC-013；自我批准。(Legacy identity: `APP-002`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Approval ON 測試資料：選自己作approver

### Steps
Submit／Approve

### Expected business result
系統拒絕自我指定或自我批准；PO保持Draft／Pending原狀且無成功Audit

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：選擇、錯誤及PO狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-032 — APP-003：看不到非本人待辦或不可操作；直接提交拒絕；申請仍Pending

### Business objective and actor
角色：非指定U-APP。業務風險與需求接地：FR-APPROVAL-006、AC-014；assigned only。(Legacy identity: `APP-003`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Pending assigned給另一人 測試資料：PO ID／Approval ID

### Steps
從列表、直接URL及提交嘗試Approve／Reject

### Expected business result
看不到非本人待辦或不可操作；直接提交拒絕；申請仍Pending

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：工作清單、拒絕及approval狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-033 — APP-004：Approve後直接Confirmed；Reject必填原因並回Draft；兩者history／Audit完整

### Business objective and actor
角色：指定U-APP。業務風險與需求接地：FR-APPROVAL-005～008、AC-015。(Legacy identity: `APP-004`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：兩張合法Pending 測試資料：password、REASON

### Steps
一張Approve；另一張Reject

### Expected business result
Approve後直接Confirmed；Reject必填原因並回Draft；兩者history／Audit完整

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：認證、兩張PO狀態及Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-034 — APP-005：顯示提交時完整不可變snapshot、零價及風險；不以目前Draft／master值冒充

### Business objective and actor
角色：指定U-APP。業務風險與需求接地：FR-APPROVAL-004～005；snapshot內容。(Legacy identity: `APP-005`; priority: `P1`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Pending含零價及風險提示 測試資料：Supplier、lines、UOM、price、total、currency、term、dates

### Steps
查看待辦與approval詳情

### Expected business result
顯示提交時完整不可變snapshot、零價及風險；不以目前Draft／master值冒充

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Snapshot及目前資料對照。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-035 — APP-006：每種均拒絕過時或失效申請，不確認PO；要求撤回／重新提交

### Business objective and actor
角色：指定U-APP。業務風險與需求接地：FR-APPROVAL-007、AC-016；批准重驗。(Legacy identity: `APP-006`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Pending建立後條件改變 測試資料：PO version、Supplier／SKU／UOM／Currency、submitter／approver權限各失效

### Steps
逐項Approve

### Expected business result
每種均拒絕過時或失效申請，不確認PO；要求撤回／重新提交

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：改變時間線、錯誤、PO／approval。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-036 — APP-007：PO回Draft且history保留；舊approval不可批准；可修訂後新提交

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-APPROVAL-009、AC-017；撤回。(Legacy identity: `APP-007`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Pending尚未決定 測試資料：EVT-A

### Steps
Withdraw後由舊approval頁再Approve

### Expected business result
PO回Draft且history保留；舊approval不可批准；可修訂後新提交

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Withdraw、舊批准拒絕、新history。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-037 — APP-008：不自動批准；舊操作拒絕；撤回後可建立新approval給新人

### Business objective and actor
角色：U-BUY／U-APP。業務風險與需求接地：FR-APPROVAL-010；審批人不可用。(Legacy identity: `APP-008`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Pending後指定人被停用／撤權 測試資料：新U-APP

### Steps
嘗試舊批准；提交人撤回再指定新人

### Expected business result
不自動批准；舊操作拒絕；撤回後可建立新approval給新人

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：user狀態、兩次approval history。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-038 — APP-009：每個intent最多一個效果；異payload衝突；最終狀態合法且只有對應一次Audit

### Business objective and actor
角色：U-BUY／U-APP。業務風險與需求接地：FR-APPROVAL-011；重送／競爭。(Legacy identity: `APP-009`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Pending及可重送event 測試資料：同event同／異payload；Approve與Withdraw近同時

### Steps
Double-click及兩瀏覽器提交

### Expected business result
每個intent最多一個效果；異payload衝突；最終狀態合法且只有對應一次Audit

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：兩邊結果、PO／approval／Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-039 — LIFE-001：回Draft且舊確認history保留；重新重驗並建立新history；Inventory不變

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-LIFE-002～003、AC-018；零收貨撤回。(Legacy identity: `LIFE-001`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Confirmed且從未收貨 測試資料：REASON

### Steps
Withdraw Confirmation、修改並重新提交

### Expected business result
回Draft且舊確認history保留；重新重驗並建立新history；Inventory不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：PO history、修改結果、Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-040 — LIFE-002：全部拒絕；商業資料、GR及Inventory歷史不變；只顯示合法下一步

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-LIFE-005、AC-019；有收貨不可改寫。(Legacy identity: `LIFE-002`; priority: `P0`; 開發 Phase: `P2／P3`.)

### Preconditions and data
前置條件：PO已有Confirmed GR 測試資料：edit／withdraw／cancel

### Steps
從UI及直接提交逐一嘗試

### Expected business result
全部拒絕；商業資料、GR及Inventory歷史不變；只顯示合法下一步

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Actions、錯誤及前後來源。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-041 — LIFE-003：前三種按合法流程取消；Partial／Full／Closed拒絕；取消後不可收貨或重開

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-LIFE-004／010；Cancel狀態。(Legacy identity: `LIFE-003`; priority: `P0`; 開發 Phase: `P2`.)

### Preconditions and data
前置條件：Draft、Pending、零收貨Confirmed、Partial、Full、Closed 測試資料：REASON

### Steps
逐狀態Cancel

### Expected business result
前三種按合法流程取消；Partial／Full／Closed拒絕；取消後不可收貨或重開

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：各PO狀態及history。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-042 — LIFE-004：未收量被正式關閉但不入庫；已收量不變；全部滿足／關閉後PO為Closed

### Business objective and actor
角色：U-BUY。業務風險與需求接地：FR-LIFE-006～009、AC-020；Close Remaining。(Legacy identity: `LIFE-004`; priority: `P0`; 開發 Phase: `P2／P3`.)

### Preconditions and data
前置條件：PO收8／訂10，另有多Lines 測試資料：selected lines及all、REASON

### Steps
Close一Line，再Close其餘

### Expected business result
未收量被正式關閉但不入庫；已收量不變；全部滿足／關閉後PO為Closed

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：PO progress前後、Inventory不變、Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-043 — LIFE-005：0為Confirmed；不足為Partially Received；全部達標為Fully Received；over不改…

### Business objective and actor
角色：U-BUY／U-VIEW。業務風險與需求接地：FR-LIFE-006～011；狀態推導。(Legacy identity: `LIFE-005`; priority: `P0`; 開發 Phase: `P2／P3`.)

### Preconditions and data
前置條件：0、partial、exact、over及closed進度 測試資料：多張GR／Lines

### Steps
依序確認收貨及查看PO

### Expected business result
0為Confirmed；不足為Partially Received；全部達標為Fully Received；over不改Ordered；有Closed Remaining時依規則Closed

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：每步PO／GR／Inventory進度。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-044 — LIFE-006：只有符合提交時狀態者成功；另一方衝突並reload；沒有收貨後仍取消或未收量被錯關兩種效果並存

### Business objective and actor
角色：兩名U-BUY／U-REC。業務風險與需求接地：FR-LIFE-012；版本／狀態競爭。(Legacy identity: `LIFE-006`; priority: `P0`; 開發 Phase: `P2／P3`.)

### Preconditions and data
前置條件：同一PO／version 測試資料：Close、cancel、GR confirm

### Steps
兩瀏覽器盡量同時提交

### Expected business result
只有符合提交時狀態者成功；另一方衝突並reload；沒有收貨後仍取消或未收量被錯關兩種效果並存

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：兩邊結果及最終PO／Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-045 — GR-001：只有仍可收貨的Confirmed／Partially Received可建立；其他拒絕且零Inventory效果

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-LIFE-001、FR-GR-001、AC-021。(Legacy identity: `GR-001`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：各狀態PO 測試資料：Draft、Pending、Confirmed、Partial、Full、Closed、Cancelled

### Steps
逐張嘗試建立GR

### Expected business result
只有仍可收貨的Confirmed／Partially Received可建立；其他拒絕且零Inventory效果

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：PO狀態、建立結果、Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-046 — GR-002：Supplier固定且不可換；只建立選中Line；其他Lines Outstanding保留

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-002～004、AC-022。(Legacy identity: `GR-002`; priority: `P1`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：Confirmed PO有三Lines 測試資料：只選第二Line

### Steps
建立GR Draft

### Expected business result
Supplier固定且不可換；只建立選中Line；其他Lines Outstanding保留

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：GR Draft及PO progress。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-047 — GR-003：四個實際位置／Lot分開保存，UOM／Status清楚；Draft不入庫

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-005、AC-023；精確位置。(Legacy identity: `GR-003`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：一PO Line可收 測試資料：2 Lots×2 Warehouses／Bins

### Steps
建立四個Receipt Details並保存

### Expected business result
四個實際位置／Lot分開保存，UOM／Status清楚；Draft不入庫

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：GR details及Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-048 — GR-004：輸入可恢復及修改；Cancel保留號碼／history；PO Received及Inventory始終不變

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-010～011、AC-024；Draft無庫存效果。(Legacy identity: `GR-004`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：新GR Draft 測試資料：有效details

### Steps
Save、離頁、重開、修改，再Cancel另一Draft

### Expected business result
輸入可恢復及修改；Cancel保留號碼／history；PO Received及Inventory始終不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Save／reload／cancel、PO／Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-049 — GR-005：整張拒絕；不建立替代detail、Movement或PO進度；錯誤不洩漏其他PO資料

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-002、AC-025；不可代收SKU。(Legacy identity: `GR-005`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：GR對應SKU-NONE 測試資料：替換成另一SKU／PO Line ID

### Steps
保存及Confirm

### Expected business result
整張拒絕；不建立替代detail、Movement或PO進度；錯誤不洩漏其他PO資料

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：輸入、錯誤、GR／Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-050 — GR-006：只列該Warehouse Active Bins；換Warehouse清舊Bin；非法owner／Inactive拒絕；…

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-007～008、AC-026；Warehouse／Bin。(Legacy identity: `GR-006`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：W-A／W-B及Inactive Bin 測試資料：W-A配BIN-B1、BIN-INACTIVE、合法W-B／BIN-B1

### Steps
選Warehouse、觀察Bins、替換及保存

### Expected business result
只列該Warehouse Active Bins；換Warehouse清舊Bin；非法owner／Inactive拒絕；合法其他Warehouse可用

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Bin選項、錯誤及保存結果。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-051 — GR-007：exact／唯一定位正確PO Line；0或多結果要求人工處理，不靜默選第一個或加入非PO SKU

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-006；SKU／barcode定位。(Legacy identity: `GR-007`; priority: `P1`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO有多Lines及相似barcode結果 測試資料：exact SKU、唯一barcode、0 matches、many matches

### Steps
搜尋／掃描並新增detail

### Expected business result
exact／唯一定位正確PO Line；0或多結果要求人工處理，不靜默選第一個或加入非PO SKU

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：搜尋輸入及選擇結果。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-052 — GR-008：W-A首次帶入；合法覆寫保存且不被refresh蓋回；Confirm摘要顯示實際W-B位置

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-008；Default Warehouse只作預設。(Legacy identity: `GR-008`; priority: `P1`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO有default W-A 測試資料：改為W-B／BIN-B1

### Steps
建立Draft、覆寫後refresh lookup

### Expected business result
W-A首次帶入；合法覆寫保存且不被refresh蓋回；Confirm摘要顯示實際W-B位置

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：表單前後及摘要。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-053 — GR-009：空白可保存；同Supplier重複顯示最多5個相關GR連結但可確認不是重複繼續；不同Supplier不誤阻擋

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-009、AC-035；Delivery Note提示。(Legacy identity: `GR-009`; priority: `P1`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：同Supplier近期已有DN-001 測試資料：空白、同DN、不同Supplier同DN

### Steps
保存Draft

### Expected business result
空白可保存；同Supplier重複顯示最多5個相關GR連結但可確認不是重複繼續；不同Supplier不誤阻擋

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Warning、連結及保存結果。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-054 — GR-010：A成功；B衝突且不覆蓋A；B輸入保留／可複製後reload

### Business objective and actor
角色：兩名U-REC。業務風險與需求接地：FR-GR-012；GR版本衝突。(Legacy identity: `GR-010`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：兩頁載入同Draft version 測試資料：A／B修改不同details

### Steps
A先Save，B用舊頁Save

### Expected business result
A成功；B衝突且不覆蓋A；B輸入保留／可複製後reload

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：兩頁、version及最終GR。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-055 — GR-011：要求合併或修正；不留下重複details；不同Lot／Bin／Status仍可合法分拆

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-014；重複dimension。(Legacy identity: `GR-011`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：GR同PO Line 測試資料：完全相同Line／Warehouse／Bin／Lot／Status兩details

### Steps
Save

### Expected business result
要求合併或修正；不留下重複details；不同Lot／Bin／Status仍可合法分拆

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：輸入、錯誤及GR details。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-056 — GR-012：整張拒絕；所有details、header、version保持上次成功值；無Inventory效果

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-013；Draft原子保存。(Legacy identity: `GR-012`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：已有合法多detail Draft 測試資料：修改多details且其中一項非法

### Steps
Save並重開

### Expected business result
整張拒絕；所有details、header、version保持上次成功值；無Inventory效果

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：錯誤、GR前後、Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-057 — GR-013：總Base、位置分布、超收／效期風險清楚；窄屏cards可操作、無頁面級橫向捲動；focus及labels正確

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-GR-015、UX §10；現場可用性。(Legacy identity: `GR-013`; priority: `P1`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：多Lines／details及風險 測試資料：375／768／1024／1440px、鍵盤

### Steps
搜尋PO、掃碼、分拆、換Bin、保存及查看risk summary

### Expected business result
總Base、位置分布、超收／效期風險清楚；窄屏cards可操作、無頁面級橫向捲動；focus及labels正確

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：四寬度截圖及鍵盤錄影。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-058 — REC-001：none不需Lot；batch需Lot；batch_expiry需Lot＋Expiry；Pack換成整數Base；非法組…

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-001／003～004、AC-027；Tracking／UOM。(Legacy identity: `REC-001`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO含SKU-NONE／BATCH／EXP 測試資料：各合法UOM、Lot／Expiry組合及缺欄

### Steps
逐detail保存／Confirm

### Expected business result
none不需Lot；batch需Lot；batch_expiry需Lot＋Expiry；Pack換成整數Base；非法組合整張拒絕

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：輸入、field errors及Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-059 — REC-002：明確拒絕且不降級為none／batch；PO不確認或GR保持Draft；無Movement

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-005、AC-028；Serial不支援。(Legacy identity: `REC-002`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：Draft／PO含SKU-SERIAL 測試資料：合法其他欄位

### Steps
Submit PO或Confirm GR

### Expected business result
明確拒絕且不降級為none／batch；PO不確認或GR保持Draft；無Movement

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：錯誤、PO／GR及Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-060 — REC-003：整張拒絕並指出Lot資料衝突；既有Lot不改，無新Bucket／Movement

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-006、AC-029；Lot一致性。(Legacy identity: `REC-003`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：LOT-CONFLICT已存在 測試資料：相同SKU／Lot不同Expiry或Manufacture Date至另一Bin／Warehouse

### Steps
Confirm

### Expected business result
整張拒絕並指出Lot資料衝突；既有Lot不改，無新Bucket／Movement

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：錯誤、兩位置Lot及Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-061 — REC-004：全部拒絕；override不繞Expired；GR保持Draft且Inventory不變

### Business objective and actor
角色：U-EXP。業務風險與需求接地：FR-VAL-007／010、AC-030；Expired不可override。(Legacy identity: `REC-004`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：可控制業務收貨日 測試資料：LOT-EXPIRED及Expiry早於Receipt Date

### Steps
以一般及override角色Confirm

### Expected business result
全部拒絕；override不繞Expired；GR保持Draft且Inventory不變

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：日期、錯誤及前後Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-062 — REC-005：顯示門檻／剩餘日數；前兩種拒絕；只有有權、未Expired、其他規則合法及有原因時成功

### Business objective and actor
角色：U-REC／U-EXP。業務風險與需求接地：FR-VAL-008～010、AC-031；Minimum Life。(Legacy identity: `REC-005`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：SKU-EXP／LOT-LOW 測試資料：無權限、缺原因、合法override＋REASON

### Steps
逐一Confirm

### Expected business result
顯示門檻／剩餘日數；前兩種拒絕；只有有權、未Expired、其他規則合法及有原因時成功

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：三次結果、GR、Movement／Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-063 — REC-006：成功時三個對應Inventory buckets正確增加；非法值拒絕；Status不由Inventory猜測

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-011～012、AC-032；Stock Status。(Legacy identity: `REC-006`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：同一GR三details 測試資料：Available、Quarantined、Damaged、非法第四值

### Steps
Confirm合法組合，再測非法值

### Expected business result
成功時三個對應Inventory buckets正確增加；非法值拒絕；Status不由Inventory猜測

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：GR details、三Buckets及Movement。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-064 — REC-007：Net Received增加8、Outstanding剩2、PO Partially Received；不要求原因、不自…

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-015、AC-033；Short Receipt。(Legacy identity: `REC-007`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO Outstanding 10 測試資料：收8

### Steps
Confirm

### Expected business result
Net Received增加8、Outstanding剩2、PO Partially Received；不要求原因、不自動Close

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：PO前後、GR及Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-065 — REC-008：缺合法原因拒絕；有原因成功；Ordered仍10、Net 12、Outstanding 0、Over 2並可查actor…

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-013～014、AC-034；Over-receipt。(Legacy identity: `REC-008`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO Outstanding 10 測試資料：收12；空白／過長／REASON

### Steps
逐項Confirm

### Expected business result
缺合法原因拒絕；有原因成功；Ordered仍10、Net 12、Outstanding 0、Over 2並可查actor／reason

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：風險摘要、結果、PO／Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-066 — REC-009：可在警告及原因下完成既有承諾；不改PO快照或Supplier status；其他安全規則仍適用

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-016、BR-038；Supplier後續狀態。(Legacy identity: `REC-009`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO確認後SUP-SUSP／SUP-ARCH 測試資料：合法GR＋REASON

### Steps
Confirm

### Expected business result
可在警告及原因下完成既有承諾；不改PO快照或Supplier status；其他安全規則仍適用

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Warning／reason、GR／Supplier／Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-067 — REC-010：只有Quarantined且合法原因可成功；其他Status被固定／拒絕；Inventory進隔離bucket

### Business objective and actor
角色：U-REC。業務風險與需求接地：BR-038；Blocked Supplier隔離。(Legacy identity: `REC-010`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO確認後SUP-BLOCK 測試資料：Available、Damaged、Quarantined＋REASON

### Steps
逐項Confirm

### Expected business result
只有Quarantined且合法原因可成功；其他Status被固定／拒絕；Inventory進隔離bucket

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：UI限制、錯誤／成功、Bucket／Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-068 — REC-011：顯示目前差異；存在且屬既有PO時有原因可按正式contract收貨；缺原因拒絕；Expired／位置等仍不能繞過

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-VAL-016、BR-039；SKU既有承諾。(Legacy identity: `REC-011`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO確認後SKU-CHANGED 測試資料：缺原因及REASON

### Steps
Confirm

### Expected business result
顯示目前差異；存在且屬既有PO時有原因可按正式contract收貨；缺原因拒絕；Expired／位置等仍不能繞過

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Warning、兩次結果、快照／目前值。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-069 — REC-012：摘要逐項列PO、Supplier、SKU、Lot、位置、Status、Base數量及所有例外；不顯示銀行資料

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-POST-001；確認摘要。(Legacy identity: `REC-012`; priority: `P1`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：多SKU／Lot／Bin／Status、over及expiry override 測試資料：合法多detail GR

### Steps
開Confirm對話但先不提交

### Expected business result
摘要逐項列PO、Supplier、SKU、Lot、位置、Status、Base數量及所有例外；不顯示銀行資料

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Confirm摘要截圖。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-070 — POST-001：GR Confirmed；PO progress／Status、每個Balance／Movement及必要Audit一次…

### Business objective and actor
角色：U-REC／U-VIEW。業務風險與需求接地：FR-POST-002～004、AC-036；原子成功。(Legacy identity: `POST-001`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：合法多detail GR 測試資料：多Line、多Lot、多Bin、多Status

### Steps
Confirm後由GR、PO及Inventory逐層查看

### Expected business result
GR Confirmed；PO progress／Status、每個Balance／Movement及必要Audit一次完成且雙向可追

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Confirm、GR／PO／Inventory／Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-071 — POST-002：整張保持Draft；所有details零Inventory效果；PO progress不變；錯誤指出可修正項

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-POST-002／008、AC-037；任一detail失效。(Legacy identity: `POST-002`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：GR載入後BIN-INACTIVE或另一detail不合格 測試資料：多detail

### Steps
Confirm

### Expected business result
整張保持Draft；所有details零Inventory效果；PO progress不變；錯誤指出可修正項

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：錯誤、GR／PO／所有Buckets前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-072 — POST-003：回原結果或等效已完成；GR只確認一次，每個bucket只增加一次，Audit／Movement無重複

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-POST-005、AC-038；Confirm冪等。(Legacy identity: `POST-003`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：一張GR可重送 測試資料：EVT-A同內容

### Steps
Double-click、refresh及網路重試

### Expected business result
回原結果或等效已完成；GR只確認一次，每個bucket只增加一次，Audit／Movement無重複

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：多次結果、Movement／Balance／Audit。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-073 — POST-004：回衝突；不接受第二payload、不再過帳或改原結果

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-POST-006、AC-039；event衝突。(Legacy identity: `POST-004`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：EVT-A已成功或處理中 測試資料：同event改數量、Lot、Bin或Status

### Steps
逐種提交

### Expected business result
回衝突；不接受第二payload、不再過帳或改原結果

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：衝突訊息、GR及Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-074 — POST-005：可判定Confirmed或未完成；已完成不重複入庫；未完成才可用原event安全重試

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-POST-009、AC-040；回應遺失。(Legacy identity: `POST-005`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：可模擬Confirm後timeout 測試資料：GR-DRAFT＋EVT-A

### Steps
Submit後逾時，按畫面用GR／Request ID查結果，再以原event重試

### Expected business result
可判定Confirmed或未完成；已完成不重複入庫；未完成才可用原event安全重試

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Timeout、operation查詢、重試及Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-075 — POST-006：兩筆合法實收準確累計為12；提交次序決定超收判定；沒有lost update或重複progress

### Business objective and actor
角色：兩名U-REC。業務風險與需求接地：FR-POST-011、AC-041；同PO並發收貨。(Legacy identity: `POST-006`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：PO Outstanding 10 測試資料：兩GR各收6，準備相應over原因

### Steps
兩瀏覽器盡量同時Confirm

### Expected business result
兩筆合法實收準確累計為12；提交次序決定超收判定；沒有lost update或重複progress

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：兩邊結果、PO 12／over2、兩組Movement。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-076 — POST-007：整張拒絕並要求reload；不以舊頁入庫；GR保持Draft、PO／Inventory保持最新合法狀態

### Business objective and actor
角色：U-REC／U-BUY。業務風險與需求接地：FR-POST-010、AC-042；過時畫面。(Legacy identity: `POST-007`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：GR頁載入後PO狀態／version改變 測試資料：Cancel、Close、Withdraw或另一更新

### Steps
先改PO，再Confirm舊GR

### Expected business result
整張拒絕並要求reload；不以舊頁入庫；GR保持Draft、PO／Inventory保持最新合法狀態

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：時間線、錯誤及前後詳情。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-077 — POST-008：不可用時fail closed且GR Draft／PO／Inventory無部分效果；恢復後可用原則合法完成

### Business objective and actor
角色：U-REC。業務風險與需求接地：FR-POST-013；Inventory依賴不可用。(Legacy identity: `POST-008`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：UAT隔離環境有批准的dependency outage開關 測試資料：合法GR

### Steps
由正常頁Confirm；恢復依賴後重試

### Expected business result
不可用時fail closed且GR Draft／PO／Inventory無部分效果；恢復後可用原則合法完成

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Outage編號、錯誤、前後GR／PO／Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-078 — POST-009：edit／cancel／delete全拒絕並指向Reversal；畫面重讀server facts；Inventory來…

### Business objective and actor
角色：U-REC／U-VIEW。業務風險與需求接地：FR-POST-007／012／014、AC-043；確認後不可變。(Legacy identity: `POST-009`; priority: `P0`; 開發 Phase: `P3`.)

### Preconditions and data
前置條件：GR已Confirmed 測試資料：edit、cancel、delete、價格／成本檢查

### Steps
嘗試修改並查看GR／Inventory來源

### Expected business result
edit／cancel／delete全拒絕並指向Reversal；畫面重讀server facts；Inventory來源只有數量／位置，不把PO價格作成本依據

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Actions／拒絕、GR／Movement詳情。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-079 — REV-001：一般角色無action且直接提交拒絕；GR／PO／Inventory不變；只有U-ADJ配合device-passwor…

### Business objective and actor
角色：U-REC／U-BUY／U-VIEW。業務風險與需求接地：FR-REV-001、SEC-008；權限及認證。(Legacy identity: `REV-001`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：Confirmed GR 測試資料：Reversal action／直接URL

### Steps
嘗試Reversal

### Expected business result
一般角色無action且直接提交拒絕；GR／PO／Inventory不變；只有U-ADJ配合device-password可繼續

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：權限、拒絕及前後狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-080 — REV-002：建立新反向Movement；原GR／Movement不改；可反向餘6；PO Net減4、Outstanding增加4

### Business objective and actor
角色：U-ADJ。業務風險與需求接地：FR-REV-002／004～005、AC-044；部分反向。(Legacy identity: `REV-002`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：Detail收10且有足夠合資格On Hand 測試資料：反向4＋REASON

### Steps
選detail、確認影響並提交

### Expected business result
建立新反向Movement；原GR／Movement不改；可反向餘6；PO Net減4、Outstanding增加4

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Reversal、原／新Movement、PO／Inventory前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-081 — REV-003：合法多次累計不超原量並可全反；0／負／超量拒絕；餘量與歷史清楚

### Business objective and actor
角色：U-ADJ。業務風險與需求接地：FR-REV-002；多次／多detail上限。(Legacy identity: `REV-003`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：多details及已部分反向 測試資料：再部分至剛好全反、0、負、超餘量

### Steps
逐項Reversal

### Expected business result
合法多次累計不超原量並可全反；0／負／超量拒絕；餘量與歷史清楚

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：各結果、reversal history及Balance。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-082 — REV-004：每種整次拒絕；GR、PO、Balance及Movement全部不變；錯誤可行動

### Business objective and actor
角色：U-ADJ。業務風險與需求接地：FR-REV-003、AC-045；Inventory當下阻擋。(Legacy identity: `REV-004`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：分別有不足On Hand、Reservation／Allocation、BIN-COUNT、位置失效 測試資料：單／多details

### Steps
逐項提交Reversal

### Expected business result
每種整次拒絕；GR、PO、Balance及Movement全部不變；錯誤可行動

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：錯誤、阻擋資料及前後狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-083 — REV-005：整個Reversal拒絕；可反的一項也不扣；沒有部分PO progress或Audit成功效果

### Business objective and actor
角色：U-ADJ。業務風險與需求接地：FR-REV-007；跨detail全有或全無。(Legacy identity: `REV-005`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：兩details，一項可反一項被阻擋 測試資料：各反2

### Steps
一次提交

### Expected business result
整個Reversal拒絕；可反的一項也不扣；沒有部分PO progress或Audit成功效果

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：兩details／Buckets、PO及Movement前後。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-084 — REV-006：同內容只反向一次；異內容衝突；PO／Inventory只反映一次合法效果

### Business objective and actor
角色：U-ADJ。業務風險與需求接地：FR-REV-008、AC-046；冪等／衝突。(Legacy identity: `REV-006`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：可重送Reversal 測試資料：EVT-A同內容、EVT-A改數量

### Steps
Double-click／refresh重送，再改payload

### Expected business result
同內容只反向一次；異內容衝突；PO／Inventory只反映一次合法效果

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：多次結果、Reversal／Movement／PO。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-085 — REV-007：Fully Received重新出現Outstanding後回Confirmed／Partially Received；…

### Business objective and actor
角色：U-ADJ／U-VIEW。業務風險與需求接地：FR-REV-005～006、AC-047；PO狀態重算。(Legacy identity: `REV-007`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：Fully Received及人工Closed各一張 測試資料：部分反向

### Steps
分別Reversal並查看PO

### Expected business result
Fully Received重新出現Outstanding後回Confirmed／Partially Received；人工Closed保持Closed並顯示差異warning

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：兩張PO前後、warning及Inventory。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-086 — REV-008：錯收以Reversal＋新GR更正；原歷史完整；系統不把Reversal標為Supplier Return或提供未批准退…

### Business objective and actor
角色：U-ADJ／U-REC。業務風險與需求接地：FR-REV-009～010；正確更正流程。(Legacy identity: `REV-008`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：一張錯收GR 測試資料：Reversal後建立新GR；物理退貨情境

### Steps
按UI指引操作

### Expected business result
錯收以Reversal＋新GR更正；原歷史完整；系統不把Reversal標為Supplier Return或提供未批准退貨流程

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：流程頁、來源鏈及狀態。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-087 — REPORT-001：結果、total及順序穩定；URL可還原且無敏感內容；顯示Total、progress、status及更新時間

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-LIST-001～004／009；PO列表。(Legacy identity: `REPORT-001`; priority: `P1`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：大量各狀態PO 測試資料：PO／Supplier／SKU／reference、status、buyer、currency、dates、outstanding

### Steps
組合filter、sort、翻頁、refresh／back

### Expected business result
結果、total及順序穩定；URL可還原且無敏感內容；顯示Total、progress、status及更新時間

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：URL、network及多頁畫面。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-088 — REPORT-002：Filters準確；詳情含Delivery Note、所有details、Inventory、Reversal、acto…

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-REPORT-001～002；GR列表／詳情。(Legacy identity: `REPORT-002`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：多Supplier／SKU／Warehouse及risk GR 測試資料：GR／PO、status、date、warehouse、over、expiry、SKU exception

### Steps
查詢並開詳情

### Expected business result
Filters準確；詳情含Delivery Note、所有details、Inventory、Reversal、actor及時間

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：List／detail及來源頁。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-089 — REPORT-003：只回真正未完成承諾；Full／Closed／Cancelled不誤列；數量與PO詳情一致

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-REPORT-003；Outstanding。(Legacy identity: `REPORT-003`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：Partial、overdue、Full、Closed、Cancelled PO 測試資料：Supplier、SKU、buyer、delivery／overdue

### Steps
查詢Outstanding

### Expected business result
只回真正未完成承諾；Full／Closed／Cancelled不誤列；數量與PO詳情一致

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Outstanding及PO對照。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-090 — REPORT-004：CSV只含filter結果、穩定欄位及一致數量／時間；畫面與CSV總數／語意相符

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-REPORT-004、AC-052；CSV與畫面一致。(Legacy identity: `REPORT-004`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：已套用PO／GR filters 測試資料：Currency、Purchase／Base UOM、times

### Steps
匯出PO、Outstanding及GR CSV

### Expected business result
CSV只含filter結果、穩定欄位及一致數量／時間；畫面與CSV總數／語意相符

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：URL、CSV hash／內容及畫面。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-091 — REPORT-005：公式字首neutralize；無password、token、銀行、SQL、stack、內部path或未授權欄位

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-REPORT-005、SEC-013～015；CSV安全。(Legacy identity: `REPORT-005`; priority: `P0`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：TEXT-RISK及Supplier含測試銀行資料 測試資料：`= + - @`開頭及敏感欄位

### Steps
匯出並安全開啟CSV

### Expected business result
公式字首neutralize；無password、token、銀行、SQL、stack、內部path或未授權欄位

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：CSV redacted sample及內容檢查。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-092 — REPORT-006：Draft有水印；正式版資料完整；header重現、行不異常切斷；不建立server PDF artifact

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-REPORT-006；A4 browser print。(Legacy identity: `REPORT-006`; priority: `P1`; 開發 Phase: `P1`.)

### Preconditions and data
前置條件：Draft及100-Line Confirmed PO 測試資料：長Supplier／SKU／notes

### Steps
開print preview並測A4分頁

### Expected business result
Draft有水印；正式版資料完整；header重現、行不異常切斷；不建立server PDF artifact

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Print preview各頁及下載行為。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-093 — REPORT-007：歷史仍顯示確認時快照，另區分目前master；金額／數量／UOM不被回寫

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-REPORT-007、AC-051；交易快照。(Legacy identity: `REPORT-007`; priority: `P0`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：Confirmed PO／GR後修改master 測試資料：Supplier name／address、SKU name、UOM、Payment Term

### Steps
修改master後重開PO／GR／print

### Expected business result
歷史仍顯示確認時快照，另區分目前master；金額／數量／UOM不被回寫

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：修改前後master、PO／GR／print。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-094 — REPORT-008：可連至正式來源；最近供貨日期更新且不自動preferred；不顯示績效分數、成本趨勢、應付或付款

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-REPORT-008～010；Supplier供貨soft relation。(Legacy identity: `REPORT-008`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：Confirmed Receipt成功 測試資料：SUP-A＋SKU-NONE

### Steps
從Supplier開近期PO／GR／供貨紀錄

### Expected business result
可連至正式來源；最近供貨日期更新且不自動preferred；不顯示績效分數、成本趨勢、應付或付款

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Supplier及來源頁。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-095 — REPORT-009：每種重要操作可查actor、before／after摘要、reason、time、request／source及outc…

### Business objective and actor
角色：U-VIEW／各操作角色。業務風險與需求接地：FR-AUDIT-001～002／005／008；操作稽核。(Legacy identity: `REPORT-009`; priority: `P0`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：已執行settings、PO、approval、close、GR、over、override、reversal 測試資料：actor、action、object、reason、date、outcome

### Steps
依各條件搜尋Audit並開詳情

### Expected business result
每種重要操作可查actor、before／after摘要、reason、time、request／source及outcome；失敗／衝突亦可調查

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Audit filters及各action詳情。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-096 — REPORT-010：每個入口均能追到同一正式來源鏈、actor及reason；ID與數量一致，無斷鏈或錯鏈

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-AUDIT-003、AC-053；端到端追溯。(Legacy identity: `REPORT-010`; priority: `P0`; 開發 Phase: `P3～P4`.)

### Preconditions and data
前置條件：完整PO→Approval→多GR→Reversal 測試資料：任一來源入口

### Steps
由Supplier、SKU、PO、GR、Movement及Audit逐一往返

### Expected business result
每個入口均能追到同一正式來源鏈、actor及reason；ID與數量一致，無斷鏈或錯鏈

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：全部來源頁及ID對照。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-097 — REPORT-011：需要交易式Audit的操作不得無聲成功；畫面顯示失敗／未知，業務資料及Inventory沒有半套效果

### Business objective and actor
角色：對應角色。業務風險與需求接地：FR-AUDIT-004；成功與Audit一致。(Legacy identity: `REPORT-011`; priority: `P0`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：技術團隊提供一個已批准的Audit不可用UAT情境 測試資料：PO action或GR Confirm

### Steps
由正常頁提交並查看業務結果

### Expected business result
需要交易式Audit的操作不得無聲成功；畫面顯示失敗／未知，業務資料及Inventory沒有半套效果

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：情境編號、錯誤及前後業務頁。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-098 — REPORT-012：沒有一般修改／刪除能力；actor停用後歷史仍可讀；保留政策及來源不斷裂

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：FR-AUDIT-006～007；保留／不可改寫。(Legacy identity: `REPORT-012`; priority: `P1`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：已完成PO、Approval、GR、Movement、Reversal及Audit 測試資料：一般edit／delete入口

### Steps
從UI及可用操作嘗試改寫歷史

### Expected business result
沒有一般修改／刪除能力；actor停用後歷史仍可讀；保留政策及來源不斷裂

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Actions、歷史及actor顯示。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-099 — OPS-001：正常20使用者負載下p95少於2秒，結果完整；畫面有明確loading且不凍結

### Business objective and actor
角色：U-VIEW／U-BUY／U-REC。業務風險與需求接地：NFR-001～005、AC-054；常用效能。(Legacy identity: `OPS-001`; priority: `P1`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：規格容量資料已由技術團隊準備 測試資料：100k SKUs、10k Suppliers、50k POs、100k GRs

### Steps
執行精確PO／GR／SKU／barcode及常用列表操作

### Expected business result
正常20使用者負載下p95少於2秒，結果完整；畫面有明確loading且不凍結

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：測試時間、畫面錄影及系統效能報告引用。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-100 — OPS-002：PO在3秒目標、GR在5秒目標內有明確進度；CSV在120秒cap內完成或清楚拒絕超限，不默默漏資料

### Business objective and actor
角色：U-BUY／U-REC／U-VIEW。業務風險與需求接地：NFR-003～005；最大業務單據。(Legacy identity: `OPS-002`; priority: `P1`; 開發 Phase: `P1／P3／P4`.)

### Preconditions and data
前置條件：系統測試容量證據已通過 測試資料：100-Line PO、200-Detail GR、50k CSV

### Steps
Save／submit PO、validate／confirm GR及export

### Expected business result
PO在3秒目標、GR在5秒目標內有明確進度；CSV在120秒cap內完成或清楚拒絕超限，不默默漏資料

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：操作錄影、單據及效能報告。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-101 — OPS-003：核心流程可用鍵盤完成；focus／labels／alerts／status文字正確；窄屏無不可操作橫向捲動；consol…

### Business objective and actor
角色：各業務角色。業務風險與需求接地：NFR-013～015；瀏覽器／responsive／a11y。(Legacy identity: `OPS-003`; priority: `P1`; 開發 Phase: `各Phase`.)

### Preconditions and data
前置條件：Chrome、Edge、Safari支援版本 測試資料：375／768／1024／1440px、鍵盤

### Steps
完成PO建立、Approval、GR分拆／Confirm、Close及Reversal

### Expected business result
核心流程可用鍵盤完成；focus／labels／alerts／status文字正確；窄屏無不可操作橫向捲動；console無error

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：瀏覽器版本、四寬度截圖及錄影。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-102 — OPS-004：不產生重複效果；過期session清楚要求登入且保留安全草稿；未知結果先查詢再重試

### Business objective and actor
角色：U-BUY／U-APP／U-REC／U-ADJ。業務風險與需求接地：NFR-006～011；double-click／session／恢復。(Legacy identity: `OPS-004`; priority: `P0`; 開發 Phase: `P1～P4`.)

### Preconditions and data
前置條件：可模擬slow network、session expiry及response loss 測試資料：Create、Approve、Confirm、Reversal events

### Steps
快速雙擊、refresh、session過期後submit及timeout後查詢

### Expected business result
不產生重複效果；過期session清楚要求登入且保留安全草稿；未知結果先查詢再重試

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：操作時間線、結果及來源數量。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-103 — OPS-005：Ordered、gross、reversed、net、outstanding、over、closed及各Inventor…

### Business objective and actor
角色：U-VIEW。業務風險與需求接地：NFR-006～010；跨模組對賬。(Legacy identity: `OPS-005`; priority: `P0`; 開發 Phase: `P3～P4`.)

### Preconditions and data
前置條件：完成partial、over及reversal流程 測試資料：一張代表性PO

### Steps
由PO、GR、Inventory及Audit人工加總

### Expected business result
Ordered、gross、reversed、net、outstanding、over、closed及各Inventory Movements完全對上；差異為0

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：對賬工作表及全部來源頁。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-104 — OPS-006：所有顯示使用一致時區／格式；URL與下載無認證／銀行／內部資料；長文字安全截斷可查看

### Business objective and actor
角色：U-VIEW／U-NONE。業務風險與需求接地：NFR-012、SEC-014～015；資料隔離。(Legacy identity: `OPS-006`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：有不同角色可見資料 測試資料：export、URL、Audit、error及long text

### Steps
跨頁搜尋、分享URL、匯出及觸發安全錯誤

### Expected business result
所有顯示使用一致時區／格式；URL與下載無認證／銀行／內部資料；長文字安全截斷可查看

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：URL、CSV、畫面及錯誤。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-105 — OPS-007：每項結果與本文件案例一致；Approval預設OFF經owner確認；Receiving capability只在Pro…

### Business objective and actor
角色：業務owners。業務風險與需求接地：Requirement §16.3；Go-Live rehearsal。(Legacy identity: `OPS-007`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：正式角色／master／setting初值已準備 測試資料：none、batch、batch_expiry、partial、over、Blocked、expiry override、reversal

### Steps
依正式SOP完成代表性端到端流程

### Expected business result
每項結果與本文件案例一致；Approval預設OFF經owner確認；Receiving capability只在Provider及Inventory ready後開放

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Rehearsal記錄、角色／設定及簽核。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

## UAT-106 — OPS-008：PO、Approval、GR、line progress、Movement、Reversal及Audit全部可查且100…

### Business objective and actor
角色：業務owners／U-VIEW。業務風險與需求接地：NFR-016、AC-055；備份還原後業務驗證。(Legacy identity: `OPS-008`; priority: `P1`; 開發 Phase: `P4`.)

### Preconditions and data
前置條件：技術團隊在隔離環境完成指定backup／restore 測試資料：含Approval、多GR、over、Blocked、Archived SKU及Reversal的PO

### Steps
登入restore環境，由頁面重做REPORT-010及OPS-005對賬

### Expected business result
PO、Approval、GR、line progress、Movement、Reversal及Audit全部可查且100%對賬；任何差異記錄為defect，不直接手改

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; execution_surface: `UI_BROWSER`; automation_suitability: `MANUAL_REQUIRED`。
必要證據：Restore build、來源頁、對賬及簽核。沒有實際執行證據不得標 PASS；狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`。

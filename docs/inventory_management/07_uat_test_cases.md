# Inventory Management 用戶驗收測試案例（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/inventory_management/01_requirement_spec.md` 0.4 Approved Planning Baseline |
| 設計來源 | `docs/inventory_management/03_design_spec.md` 0.4 Approved Planning Baseline |
| UI／UX基準 | `docs/frontend-design.md` |
| 文件日期 | 2026-09-23 |
| 測試類型 | User Acceptance Testing（UAT）測試設計 |
| 測試狀態 | 0.4設計／計畫已批准；所有案例均未執行且保持 `NOT RUN` |
| 目標環境 | 待執行前填寫；須為隔離測試環境及測試專用資料庫 |
| Build／Commit | 待執行前填寫 |

> 本文件從倉務、庫存管理及下游業務使用者角度驗證功能是否可接受，不代表系統已通過測試。本輪只產出案例，不執行任何測試。

## 1. 驗收目標與範圍

驗證中小企在最多約5個倉庫的營運情境下，可以簡單而準確地知道每個SKU／Lot位於哪個Warehouse及Bin，並以受控流程完成收貨、預留、分配、出庫、移動、調撥、調整、盤點、開帳、查詢及追溯；任何失敗、重送、並發或逾時均不得造成使用者可見的重複、部分或負數庫存結果。

### 1.1 範圍內

- Inventory頁面、正式下游業務流程及使用者可觀察結果。
- Warehouse／Bin、Stock／Lot、Movement、Reservation／Allocation、Transfer、Adjustment／Status、Stocktake及Opening完整業務流程。
- 正常、負面、邊界、權限、重新認證、重送、版本衝突、鎖定、逾時及可恢復情境。
- 查詢、匯出、來源連結、Audit呈現、響應式、鍵盤操作及無障礙。
- 每次數量操作前後，以畫面、匯出及Movement／Audit頁確認數量、狀態、位置及來源。

### 1.2 範圍外與前置證據

- 不以直接SQL、修改資料庫、直接取得DB lock、檢查程式碼或內部table作為UAT步驟。
- Unit、API contract、integration、migration、transaction故障注入、真並發barrier、容量壓測、備份／還原及immutable trigger由開發／系統測試執行；開始相關Phase UAT前須提供通過證據。
- Purchasing、Sales、Receiving、Fulfillment、Returns及Accounting自身的完整單據規則不屬本模組；只驗收其與Inventory交界及最終庫存效果。
- 成本、估值、毛利、會計分錄、補貨建議、序號追蹤、部分Transfer收發、複雜盤點輪次及自訂報表不在本期範圍。

## 2. 驗收角色與測試資料基線

### 2.1 使用者角色

| 代號 | 角色／權限 |
| --- | --- |
| U-VIEW | Active user；只有 `inventory.view` |
| U-OP | Active user；`inventory.view＋inventory.operation` |
| U-MGMT | Active user；`inventory.view＋inventory.mgmt` |
| U-ADJ | Active user；`inventory.view＋inventory.adjust` |
| U-FEFO | Active user；相關operation權限＋`inventory.fefo.override` |
| U-DOWN | 只有Sales／Receiving／Fulfillment等下游流程權限，沒有Inventory頁面權限 |
| U-SYS | 只有System Administrator角色，沒有獲明確指派Inventory權限 |
| U-NONE | Active user；沒有Inventory或相關下游權限 |
| U-STALE | 登入及載入頁面後被撤權或停用的使用者 |

五項Inventory權限互不繼承。涉及密碼或device-password的案例只使用測試帳戶及測試裝置。

### 2.2 業務測試資料

| 代號 | 測試資料 |
| --- | --- |
| W-A／W-B | Active Warehouses `WH-HK-A`／`WH-HK-B` |
| W-C | Inactive Warehouse |
| BIN-A1／A2 | W-A下Active Bins；兩者可存同一Lot |
| BIN-B1／B2 | W-B下Active Bins；其中可與W-A使用相同Bin Code |
| BIN-INACTIVE | W-A下Inactive Bin |
| SKU-NONE | Inventory tracked、Base UOM `EA`、Tracking `none` |
| SKU-BATCH | Inventory tracked、Tracking `batch`、Expiry選填 |
| SKU-EXP | Inventory tracked、Tracking `batch_expiry`，具Minimum Receipt／Sale Life |
| SKU-SERIAL | Inventory tracked、Tracking `serial`，本期不支援 |
| SKU-NOTRACK | 非inventory tracked SKU |
| SKU-DISC | Discontinued但仍Sellable、且有合資格現貨的SKU |
| PACK-24 | SKU有效Pack UOM，1 BOX＝24 EA |
| LOT-EARLY／MID／LATE | 同SKU三個合資格Lot，按到期日由早至晚，分布於多個Bins |
| LOT-TODAY | Expiry Date等於APP_TIME_ZONE當日 |
| LOT-EXPIRED | 已過期Lot |
| LOT-LOW | 未過期但低於Minimum Sale Life的Lot |
| STOCK-A | W-A中包含Available、Quarantined、Damaged、Reserved及Allocated的已知數量 |
| REASON | 合法測試原因，例如 `UAT inventory variance verification` |
| SRC-A／SRC-B | 唯一正式Source Document／Line／Event ID；另備同ID同內容及同ID異內容版本 |
| CSV-VALID | 合法Opening CSV，涵蓋none／batch／batch_expiry及三種Stock Status |
| CSV-INVALID | 含錯欄、重複dimension、公式、無效SKU／Bin／Lot及非法數量的Opening CSV |

每個案例須使用唯一run prefix，並在前置條件指定清楚的初始數量。不得使用真實客戶、供應商、密碼或商業敏感資料。

## 3. UAT進入及完成準則

### 3.1 進入準則

- 對應Phase的程式已部署至隔離UAT環境，版本已記錄。
- 對應Unit、API、integration、migration、security及system test已通過，沒有阻擋UAT的S1／S2缺陷。
- Item lookup及相關下游測試入口可用；Warehouse、Bin、SKU、Lot、權限及數量基線已由測試資料準備程序建立。
- 測試人員可分別使用上述角色，並可查看Inventory頁、下游來源頁、Movement、Audit及CSV結果。
- APP_TIME_ZONE、今日日期、瀏覽器、螢幕寬度及任何故障／逾時模擬方式已記錄。

### 3.2 完成準則

- 當次Phase的P0、P1案例全部執行；沒有未批准的 `BLOCKED` 或 `NOT APPLICABLE`。
- 所有P0案例通過；沒有未關閉S1／S2缺陷，P1缺陷已有業務接受的處理決定。
- 50條Acceptance Criteria均已有PASS證據或經Product Owner書面批准的例外。
- 數量、位置、來源及Movement可對賬；沒有重複過帳、負數、半張單或無法解釋的差異。
- Warehouse／Inventory業務負責人及Product Owner完成簽核。

## 4. 風險優先級

| 風險 | Likelihood | Impact | Priority | 核心案例 |
| --- | ---: | ---: | --- | --- |
| SKU／Lot放錯Warehouse或Bin，導致實物無法定位 | 4 | 5 | P0 | STOCK-003～005、MOVE-001～010、COUNT-001～013 |
| 並發、重送或逾時造成重複／部分／負數庫存 | 4 | 5 | P0 | POST-008～012、RES-003／012、MOVE-007／010／013、ADJ-007～009 |
| 過期、低效期、隔離或損壞貨品被正常銷售 | 4 | 5 | P0 | STOCK-007～010、RES-006～011、ADJ-004～006 |
| 權限、撤權或重新認證失效造成未授權操作 | 4 | 5 | P0 | AUTH-001～008、ADJ-001、OPEN-006／011 |
| Stocktake鎖失效或只過帳部分差異 | 4 | 5 | P0 | COUNT-002～004、COUNT-009～013 |
| Transfer狀態或目的Bin錯誤，貨品在途／到貨數量失真 | 4 | 5 | P0 | MOVE-004～013 |
| Opening錯誤檔案或重送污染正式初始庫存 | 3 | 5 | P0 | OPEN-001～012 |
| 查詢／匯出語意不一致或缺乏來源追溯 | 3 | 4 | P1 | REPORT-001～010 |

## 5. 證據與狀態規則

- 每個案例須保存build、環境、actor、時間、初始狀態及執行後狀態；有request／source ID時一併保存。
- `Required Evidence`只使用業務可觀察證據：畫面截圖／錄影、成功或錯誤訊息、來源單據、Movement／Audit頁、下載CSV及前後查詢結果。
- 涉及數量變化時，證據須同時顯示相關SKU、Warehouse、Bin、Lot、Status、操作前後數量及來源，不只保存成功通知。
- 逾時後不得立刻以新ID重做；先用Source／Request ID查結果，再以同一ID安全重試。
- `Actual Evidence`在實際執行前保持 `—`。狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`；沒有執行證據不得標PASS。

## 6. 需求與Phase追溯總覽

| 業務流程 | Requirement／AC | 開發Phase | Test Case IDs | 初始結果 |
| --- | --- | --- | --- | --- |
| 權限、導航與提交點重驗 | SEC-001～014、AC-006／035／047／048 | P0及各Phase | AUTH-001～008 | NOT RUN |
| Warehouse／Bin主資料 | FR-MASTER-001～010、AC-001～003 | P1 | MASTER-001～010 | NOT RUN |
| 庫存、Lot、效期及Movement查詢 | FR-STOCK-001～010、FR-LOT-001～010、AC-004／005／007～012 | P1 | STOCK-001～012 | NOT RUN |
| Receipt／Issue及安全重送 | FR-POST-001～012、AC-013～018 | P1／P2／P3 | POST-001～013 | NOT RUN |
| Reservation／Allocation／FEFO | FR-RES-001～010、FR-ALLOC-001～010、AC-019～027 | P2 | RES-001～013 | NOT RUN |
| Bin Move及跨倉Transfer | FR-MOVE-001～007、FR-TRANSFER-001～012、AC-022／028～034 | P3 | MOVE-001～013 | NOT RUN |
| Adjustment／Status／Reversal | FR-ADJUST-001～010、AC-018／035～039 | P3 | ADJ-001～009 | NOT RUN |
| Stocktake | FR-COUNT-001～012、AC-040～043 | P4 | COUNT-001～013 | NOT RUN |
| Opening及Go-Live | FR-OPEN-001～007、AC-044～046 | P5 | OPEN-001～012 | NOT RUN |
| 報表、Audit、UX及營運復原 | FR-REPORT-001～008、FR-AUDIT-001～007、AC-049／050 | P5 | REPORT-001～010 | NOT RUN |
| 跨流程業務不變量 | BR-001～045 | P1～P5 | MASTER-001～010、STOCK-001～012、POST-001～013、RES-001～013、MOVE-001～013、ADJ-001～009、COUNT-001～013、OPEN-001～012 | NOT RUN |
| 效能、一致性、可靠性及相容性 | NFR-001～014 | P1～P5 | POST-008～013、RES-003／012、MOVE-006／009／010／013、ADJ-008／009、COUNT-002～004／007／009／012、OPEN-005／008／009、REPORT-001～010 | NOT RUN |
| 系統設計與頁面行為 | design_spec §1～7及§12 | P0～P5 | AUTH-001～008及所有業務流程案例 | NOT RUN |

## 7. 詳細用戶驗收測試案例

### 7.1 權限、導航與提交點重驗（AUTH）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | P0 | 未登入 | SEC-001；未登入存取 | 已登出 | Inventory各頁URL | 直接開啟各Inventory頁 | 跳至登入或顯示未登入；沒有Inventory資料或操作可見 | URL、畫面、登入導向 | — | NOT RUN |
| AUTH-002 | P0 | P0 | U-NONE／U-SYS | SEC-002～006；權限互不繼承 | 兩角色均未獲Inventory permission | Inventory sidebar及各頁URL | 登入後檢查選單，再直接開URL | 選單不顯示；頁面403；System Administrator不會自動取得Inventory權限 | 角色設定、sidebar及403畫面 | — | NOT RUN |
| AUTH-003 | P0 | P0 | U-VIEW | SEC-002、AC-006；只讀 | 有可查詢資料 | Stock、Warehouse、Transfer、Stocktake | 查詢／匯出，再嘗試新增、修改或過帳 | 查詢及匯出成功；寫入按鈕不可用；直接提交仍被拒絕；數量與狀態不變 | 權限、查詢／匯出、拒絕及前後畫面 | — | NOT RUN |
| AUTH-004 | P0 | P0 | U-OP／U-MGMT／U-ADJ／U-FEFO | SEC-003～006；最小權限 | 四個獨立帳戶 | 各權限專屬操作 | 分別嘗試operation、master、adjust、FEFO override及其他非授權操作 | 每人只可完成獲授權能力；任一permission不隱含另一項 | 角色矩陣、可用按鈕、成功／拒絕畫面 | — | NOT RUN |
| AUTH-005 | P0 | P0／P2 | U-DOWN | SEC-007、AC-047；下游最小能力 | 已授權Sales／Receiving／Fulfillment流程 | 正式來源單據 | 從下游完成Reservation／Receipt／Issue，再開Inventory管理URL | 正式流程可取得需要的庫存效果；仍不可進Inventory管理頁或執行其他操作 | 來源頁、Inventory結果、403畫面 | — | NOT RUN |
| AUTH-006 | P0 | 各Phase | U-STALE | SEC-013、AC-048；提交重驗 | 使用者已載入可提交畫面 | Adjustment或FEFO例外草稿 | 管理員撤權／停用使用者後，原使用者提交 | 被清楚拒絕；沒有數量、Movement或成功Audit效果；提示重新登入或聯絡管理員 | 撤權時間、提交錯誤、前後庫存／Movement | — | NOT RUN |
| AUTH-007 | P0 | P1／P3／P4／P5 | 對應角色 | SEC-005／010；重新認證 | 高風險操作資料已備妥 | 正確、錯誤、過期及另一裝置challenge | 對停用／刪除、Adjustment、Reversal、Stocktake Post、Opening Confirm、Go-Live逐一確認 | 只有符合該操作、actor、device及有效時間的認證可用一次；錯誤／過期／跨操作重放被拒絕 | 認證對話、成功／拒絕及前後狀態 | — | NOT RUN |
| AUTH-008 | P0 | 各Phase | U-OP／U-ADJ | SEC-008～011；ID替換與輸入安全 | 有不同Warehouse／Reservation／Transfer／Stocktake資料 | 竄改URL或表單ID、HTML字串、超長reason | 以瀏覽器可操作方式替換ID或輸入惡意內容並提交 | 跨所有權／越權資料不可讀寫；輸出只顯示安全文字；錯誤不含SQL、stack、token或內部路徑；資料不變 | URL／輸入、錯誤畫面、前後資料 | — | NOT RUN |

### 7.2 Warehouse與Bin主資料（MASTER）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MASTER-001 | P1 | P1 | U-MGMT | FR-MASTER-001／010；新增查詢 | 無同code Warehouse | 新Warehouse code／name | 新增後以code、name、status搜尋並開詳情 | Warehouse建立為Active；資料正確；預設列表只顯示Active並可篩選 | 表單、成功訊息、列表及詳情 | — | NOT RUN |
| MASTER-002 | P0 | P1 | U-MGMT | FR-MASTER-002；全公司硬唯一 | 已有Active／Inactive／Archived Warehouse | 同code大小寫及前後空白變體 | 分別新增或修改成重複code | 全部被field-level錯誤阻擋；歷史code繼續占用；原資料不變 | 輸入、錯誤、列表／詳情 | — | NOT RUN |
| MASTER-003 | P1 | P1 | U-MGMT | FR-MASTER-003／004、AC-001；Bin唯一範圍 | W-A、W-B Active | 相同Bin code及同倉重複變體 | W-A、W-B各建同code；再於W-A重複建立 | 不同Warehouse均成功；同Warehouse經trim／不分大小寫後重複被拒絕 | 兩倉Bin列表、重複錯誤 | — | NOT RUN |
| MASTER-004 | P0 | P1 | U-MGMT | FR-MASTER-005；位置所有權 | W-A／W-B及其Bins | W-A搭配BIN-B1 | 在Warehouse已選W-A時檢查Bin選項；嘗試以改URL／表單送入BIN-B1 | 只顯示W-A Active Bins；跨倉Bin被拒絕且不建立庫存或主資料關聯 | Bin選項、拒絕畫面、前後資料 | — | NOT RUN |
| MASTER-005 | P0 | P1 | U-MGMT | FR-MASTER-006、AC-002；Warehouse停用guard | W-A分別有On Hand、Reservation／Allocation、未完成Transfer、Active Stocktake | 四種阻擋資料 | 查看停用預檢並逐一提交停用 | 每種情境均拒絕，顯示安全且可行動的阻擋類型／數量；提交時重驗 | 預檢、確認框、阻擋訊息、Warehouse狀態 | — | NOT RUN |
| MASTER-006 | P0 | P1 | U-MGMT | FR-MASTER-007、AC-002；Bin停用guard | BIN-A1分別有On Hand、Allocation、未完成Transfer、Active Stocktake | 四種阻擋資料 | 嘗試停用BIN-A1 | 每種情境均拒絕並指出下一步；Bin仍Active | 阻擋訊息及Bin狀態 | — | NOT RUN |
| MASTER-007 | P1 | P1 | U-MGMT | FR-MASTER-006／007；成功停用恢復 | W-C／BIN-INACTIVE無任何阻擋 | Password及reason | 停用無使用資料，再恢復Warehouse或Bin | 正確密碼後成功並留痕；恢復Warehouse不會自動恢復其Inactive Bins | 確認、狀態前後、Audit畫面 | — | NOT RUN |
| MASTER-008 | P0 | P1 | U-MGMT | FR-MASTER-008、AC-003；永久刪除 | 一組從未使用且無子資料；一組有Movement歷史且現量0 | Device-password及reason | 對兩組執行永久刪除 | 未使用者可刪除；有歷史者拒絕但可停用；歷史Movement仍可查 | 刪除／拒絕、列表、Movement | — | NOT RUN |
| MASTER-009 | P0 | P1 | 兩名U-MGMT | FR-MASTER-009；版本衝突 | 同一Warehouse version=N | A／B各修改不同欄 | 同時開頁；A先儲存；B以舊頁儲存 | A成功；B收到版本衝突且不覆蓋A；B可刷新再決定重提 | 兩個頁面、衝突訊息、最終詳情 | — | NOT RUN |
| MASTER-010 | P1 | P1 | U-VIEW／U-MGMT | UX §10、design §7.3 | 多Warehouse／Bin及長code/name | 375／768／1024／1440px、鍵盤 | 搜尋、切換Warehouse、開Bin詳情、完成新增／確認對話 | Desktop主從清楚；mobile先選Warehouse再進Bin；無不可操作橫向溢出；焦點及完整文字可用 | 四寬度截圖、鍵盤錄影 | — | NOT RUN |

### 7.3 庫存、Lot、效期與Movement查詢（STOCK）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STOCK-001 | P1 | P1 | U-VIEW | FR-STOCK-001；搜尋優先序 | 多SKU及barcode/name相似資料 | 完整SKU code、Barcode、部分name、找不到、多結果 | 逐項搜尋或掃描 | 精確code／barcode結果優先且唯一；partial name合理排序；找不到／多結果不會靜默選擇 | 搜尋字串及結果畫面 | — | NOT RUN |
| STOCK-002 | P0 | P1／P2 | U-VIEW | FR-STOCK-002／005；數量語意 | STOCK-A已知結餘及Reservation／In Transit | SKU-EXP | 開庫存總覽，完成一個已授權Movement／Reservation後刷新 | Total、Available、Reserved、ATP、Quarantined、Damaged、In Transit分欄正確且立即反映已提交結果 | 操作前後總覽及來源結果 | — | NOT RUN |
| STOCK-003 | P0 | P1 | U-VIEW | FR-STOCK-003、AC-004；同Lot多Bin | LOT-EARLY分布BIN-A1／A2 | 已知每Bin數量 | 由SKU展開至Warehouse、Bin、Lot、Status | 每個位置均顯示；分項總和等於SKU總數；不把同Lot合併成單一位置 | 展開畫面及人工加總 | — | NOT RUN |
| STOCK-004 | P0 | P1 | U-VIEW | FR-STOCK-003、AC-005；同Bin多SKU／Lot | BIN-A1存多SKU／Lots／Statuses | 已知bucket集合 | 由Warehouse／Bin查全部內容並跨頁 | 所有bucket按穩定順序及分頁出現，沒有重複／遺漏；總數正確 | Bin結果各頁及對照清單 | — | NOT RUN |
| STOCK-005 | P0 | P1 | U-VIEW | FR-MASTER-005、BR-003／004；精確位置 | 所有非零On Hand資料已知 | 各SKU／Lot | 逐層檢查所有On Hand明細 | 每個On Hand均有正式Warehouse及同倉Active／歷史Bin；沒有無位置或自由文字位置 | 庫存明細與位置詳情 | — | NOT RUN |
| STOCK-006 | P1 | P1 | U-VIEW | FR-STOCK-004、BR-005／006；UOM | SKU-NONE及PACK-24 | 1 BOX＝24 EA | 查庫存及Pack換算展示 | 保存／主數量以EA正整數呈現；Pack只作清楚標示的換算，不出現小數Base UOM | 數量欄及換算提示 | — | NOT RUN |
| STOCK-007 | P0 | P1 | U-VIEW | FR-STOCK-006、AC-011；狀態語意 | 同SKU有三種Stock Status | Available／Quarantined／Damaged | 查總覽及明細 | Total包含三種；正常ATP只含合資格Available；每種以文字＋圖示區分，不只靠顏色 | 總覽、明細、狀態label | — | NOT RUN |
| STOCK-008 | P0 | P1 | U-VIEW | FR-LOT-006、BR-013、AC-009；最後可用日 | 可控制APP_TIME_ZONE日期 | LOT-TODAY | 當日及次日查Lot與ATP／候選狀態 | 到期日當日仍非Expired；APP_TIME_ZONE次日開始清楚標Expired並退出正常ATP | 日期設定、兩日畫面 | — | NOT RUN |
| STOCK-009 | P0 | P1／P2 | U-VIEW | FR-LOT-006／008、AC-010；不合資格提示 | LOT-EXPIRED、LOT-LOW | 正常銷售用途 | 在Expiry及Stock頁查詢，再於來源流程嘗試使用 | 可查到數量但明確顯示Expired／低效期及不可用原因；不計入該用途ATP | 查詢、候選／拒絕畫面 | — | NOT RUN |
| STOCK-010 | P0 | P1 | U-OP | FR-LOT-009、AC-012；serial拒絕 | SKU-SERIAL Active | 合法位置及數量 | 從正式Receiving流程嘗試Receipt | 明確顯示本期不支援serial；不降級為none／batch；查詢及Movement無新增 | 來源錯誤、前後庫存／Movement | — | NOT RUN |
| STOCK-011 | P1 | P1 | U-VIEW | FR-STOCK-007；Movement追溯 | Bucket已有多種Movement | Source、operation group | 從Bucket查看近期Movement，開來源，再返回SKU／Lot／Bin | 數量方向、類型、時間、操作者／系統身份、來源及關聯位置清楚；雙向連結可用或有穩定來源文字／ID | Bucket、Movement、來源頁 | — | NOT RUN |
| STOCK-012 | P1 | P1 | U-VIEW | FR-STOCK-008／010、NFR-002；篩選分頁 | 超過120個Stock buckets／Movements | status、no stock、zero ATP、expired、within days、sort | 組合篩選、翻頁、刷新及瀏覽器前後 | 預設20、最多100；結果及排序穩定；URL可還原非敏感filters；no stock／zero ATP語意正確 | URL及多頁結果 | — | NOT RUN |

### 7.4 Receipt、Issue與安全重送（POST）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST-001 | P0 | P1 | U-DOWN | FR-POST-001～003、AC-013；none Receipt | 正式Receiving單據；SKU-NONE | 10 EA至W-A／BIN-A1，SRC-A | 在Receiving確認收貨，再開Inventory查詢 | 來源完成；指定Bucket增加10；產生單一Receipt Movement、來源連結及成功Audit；不能在Inventory自行建採購單 | 來源頁、前後Bucket、Movement、Audit | — | NOT RUN |
| POST-002 | P0 | P1 | U-DOWN | FR-LOT-002～004、AC-007；Tracking欄位 | 正式Receiving單據 | SKU-BATCH及SKU-EXP | 收SKU-BATCH有Lot無Expiry；收SKU-EXP有Lot及Expiry；再分別省略必填欄 | 合法組合成功；batch缺Lot、batch_expiry缺Lot或Expiry均field-level拒絕且零庫存效果 | 各輸入、成功／錯誤、前後查詢 | — | NOT RUN |
| POST-003 | P0 | P1 | U-DOWN | FR-LOT-005、AC-008；Lot一致性 | SKU-EXP／同Lot已於W-A入庫 | 相同Lot不同Expiry或Manufacture Date至W-B | 提交Receipt | 被拒絕並指出Lot資料衝突；W-B無新Bucket；既有Lot未被改寫 | 錯誤、兩倉Lot／庫存、Movement | — | NOT RUN |
| POST-004 | P1 | P1 | U-DOWN | FR-POST-002、BR-005／006；Pack換算 | PACK-24有效 | 2 BOX，目的BIN-A1 | 在Receiving輸入Pack並確認換算後收貨 | 提交前顯示48 EA；成功後只增加48 EA；來源與Movement保留清楚UOM／數量語意 | 換算確認、前後數量、Movement | — | NOT RUN |
| POST-005 | P0 | P1 | Receiving一般／例外角色 | FR-LOT-007；Minimum Receipt Life | SKU-EXP及LOT-LOW低於收貨門檻，另備Expired Lot | 無例外、缺原因、`receiving.expiry.override`＋逐筆完整evidence | 逐一確認Receipt | 一般／缺原因／evidence不完整均拒絕；只有專門權限、原因及完整證據有效時成功；Expired永遠拒絕；Inventory重新驗證門檻並可追溯例外 | 各次結果、庫存、Movement／Audit | — | NOT RUN |
| POST-006 | P1 | P1 | U-DOWN | FR-POST-005；收貨品質狀態 | Customer Return及一般Receiving來源 | Customer Return、Available Receipt、Damaged Receipt | 完成三筆正式Receipt，再對退貨完成品質檢查及Status Transfer | Customer Return固定先進Quarantined；一般來源進指定Bucket；退貨只有品質檢查後才可轉Available或Damaged；Total及ATP語意正確 | 來源選擇、Bucket明細、Status Transfer、Movement | — | NOT RUN |
| POST-007 | P0 | P1 | U-DOWN | FR-POST-009；提交重驗 | 畫面載入後資料改變 | SKU停用／非追蹤、Warehouse／Bin停用、跨倉Bin、SKU-SERIAL | 載入Receiving後改變基礎資料，再提交 | 每種均依提交時事實拒絕，顯示可理解原因；零Balance／Movement成功效果 | 狀態時間線、錯誤、前後查詢 | — | NOT RUN |
| POST-008 | P0 | P1 | U-DOWN | FR-POST-007、AC-014；Receipt冪等 | 一筆Receipt已成功 | SRC-A同event及完全相同內容 | 重按確認／刷新重送／模擬網路重試 | 回原成功或等效已處理結果；On Hand只增加一次；只有一組業務效果 | 兩次回應、前後Bucket、Movement／來源 | — | NOT RUN |
| POST-009 | P0 | P1 | U-DOWN | FR-POST-008、AC-015；來源衝突 | SRC-A已成功 | 相同event但改SKU、數量、位置或Lot | 逐種重新提交 | 均顯示來源／冪等衝突；不接受新版亦不重做舊版；數量無新增 | 衝突訊息、Bucket／Movement | — | NOT RUN |
| POST-010 | P0 | P2 | U-DOWN | FR-POST-004／006、AC-017；Issue全有或全無 | 有有效Reservation及Allocation | 指定兩個Allocation，其中一行不足／過期／變Quarantined | 從Fulfillment確認整筆Issue | 整筆拒絕；所有行On Hand、Reservation、Allocation不變；不自動改選Lot或部分出貨 | 出貨錯誤、各行前後數量／狀態 | — | NOT RUN |
| POST-011 | P0 | P2 | U-DOWN | FR-POST-004；Issue正常效果 | 有10 Reserved／Allocated | Issue 6 EA | 確認發貨，查看Inventory及來源 | 指定Lot／Bin扣6；Reservation Consumed加6、Outstanding減6；Movement、來源及Audit完整 | 發貨、Reservation、Bucket、Movement／Audit | — | NOT RUN |
| POST-012 | P0 | P1／P2 | U-DOWN | NFR-009；回應遺失與安全恢復 | 可模擬提交後逾時 | SRC-A Receipt或Issue | 提交後得到逾時；依畫面指引以Source／Request ID查結果，再用同ID重試 | 能判定未完成或已完成；已完成只顯示同一結果且不重複數量；未完成可安全重試 | 逾時、查詢結果、重試、前後數量 | — | NOT RUN |
| POST-013 | P0 | P1／P2 | U-DOWN | AC-016、NFR-006；失敗時完整回滾 | 技術團隊已在UAT隔離環境啟用批准的單次DB／Audit故障情境；UAT人員不直接操作DB | 一筆多行Receipt或Issue及SRC-B | 由正常下游頁提交；看到失敗後查來源、所有相關Buckets、Reservation及Movement／Audit頁 | 來源明確顯示失敗；所有行Balance、Movement、Reservation及成功Audit效果均不出現；關閉故障後可以新合法請求成功 | 技術故障情境編號、錯誤畫面、所有前後業務查詢、system test證據 | — | NOT RUN |

### 7.5 Reservation、Allocation與FEFO（RES）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RES-001 | P0 | P2 | U-DOWN | FR-RES-001、BR-016；Warehouse級預留 | W-A有ATP 20 | Reservation 10，SKU-EXP／W-A | 從Sales建立Reservation並開詳情 | 成功預留10；只指定SKU／Warehouse及來源，不要求Lot／Bin；Original 10、Outstanding 10 | Sales結果、Reservation詳情、Stock摘要 | — | NOT RUN |
| RES-002 | P0 | P2 | U-DOWN | FR-RES-002、AC-020；全有或全無 | ATP 5 | 請求6 | 建立Reservation | 整筆拒絕並顯示ATP不足；不建立5的部分Reservation；Reserved仍不變 | 錯誤、Reservation列表、Stock摘要 | — | NOT RUN |
| RES-003 | P0 | P2 | 兩個U-DOWN | FR-RES-009、AC-019；並發競爭 | ATP恰為10 | 兩個來源同時各預留7 | 兩個瀏覽器盡量同時提交並刷新結果 | 最多一個成功；另一個得到清楚不足／衝突；最終Reserved不超過10且無負ATP | 兩邊結果、最終Stock／Reservation | — | NOT RUN |
| RES-004 | P0 | P2 | U-DOWN | FR-RES-003；Reservation冪等／衝突 | 可重送來源事件 | SRC-A同內容／異數量 | 同event重送，再用同event改數量 | 同內容只一筆Reservation；異內容衝突且不改原預留 | 兩次結果、Reservation詳情、Stock | — | NOT RUN |
| RES-005 | P0 | P2 | U-DOWN | FR-RES-004～006、AC-021；耗用／釋放／取消 | Reservation 10 | Issue 6、Release 4；另有部分耗用後Cancel | 依正式來源完成Issue及Release／Cancel | 10＝Consumed 6＋Released 4＋Outstanding 0；Cancel只釋放未耗用量，不復活已耗用量；沒有來源事件不會自行消失 | 來源事件、Reservation數量歷程、Stock | — | NOT RUN |
| RES-006 | P0 | P2 | U-DOWN | FR-RES-008、AC-010／011；ATP資格 | 同SKU有Available、Quarantined、Damaged、Expired、Low-life | 正常銷售用途 | 查ATP並嘗試預留超過合資格Available的數量 | ATP排除四類不合資格庫存；請求被全數拒絕，不以Total On Hand誤導 | Stock摘要、錯誤、Reservation列表 | — | NOT RUN |
| RES-007 | P0 | P2 | U-OP | FR-ALLOC-001／008；跨多Bucket分配 | Reservation 12；同Lot跨BIN-A1／A2及另一Lot | 5＋4＋3 | 取得候選並建立多行Allocation | 總Allocation 12不超過Outstanding；可跨Lot／Bin；Allocation後On Hand不變而Allocated／可用量正確 | 候選、Allocation詳情、前後Stock | — | NOT RUN |
| RES-008 | P0 | P2 | U-OP | FR-ALLOC-002／003、AC-023；FEFO／FIFO建議 | LOT-EARLY／MID／LATE及無Expiry批次 | 需求量跨多Lot | 開Allocation drawer查看建議並採用 | 有Expiry按最早到期、Lot、Bin穩定排序；無Expiry批次按First Receipt Date；顯示剩餘天數及可分配量 | 候選順序、已建立Allocation | — | NOT RUN |
| RES-009 | P0 | P2 | U-OP | FR-ALLOC-004、AC-024；一般人偏離FEFO | 最早Lot仍足夠 | 選較晚LOT-LATE | 提交Allocation | 被拒絕並指出應選Lot；不保存Allocation；On Hand／Reservation不變 | 選擇、拒絕、Allocation／Stock | — | NOT RUN |
| RES-010 | P0 | P2 | U-FEFO | FR-ALLOC-004／010、AC-025；合法例外 | 較晚Lot仍符合所有資格 | LOT-LATE＋REASON | 查看建議差異，填原因並提交 | 成功；Audit可見建議Lot、實選Lot、Expiry、數量、actor、reason及來源 | 候選、確認、Allocation、Audit | — | NOT RUN |
| RES-011 | P0 | P2 | U-FEFO | SEC-006、AC-026；例外不可繞資格 | 有Expired、Low-life、Quarantined、Damaged、Inactive Bin及外倉Lot | 各不合資格候選 | 逐一嘗試override分配 | 全部拒絕並顯示具體不可用原因；沒有例外Allocation | 拒絕畫面及Allocation列表 | — | NOT RUN |
| RES-012 | P0 | P2 | 兩名U-OP | FR-ALLOC-007／009、AC-027；stale候選 | A已載入候選；B改變bucket或Lot狀態 | B先耗用／轉狀態／停用Bin | A提交Allocation或Issue | 409／衝突；保留A輸入但要求重新載入候選；不自動改選；Issue零扣貨 | A／B時間線、衝突、前後Stock | — | NOT RUN |
| RES-013 | P1 | P2 | U-OP | FR-ALLOC-006／007；釋放與重新分配 | 已有未Issue Allocation | 從LOT-EARLY改至LOT-MID | 釋放、重新分配，再查Movement | Reservation及Allocation更新且On Hand不變；無Issue Movement；重複操作不造成超配 | 前後詳情、Stock、Movement | — | NOT RUN |

### 7.6 Bin Move與跨倉Transfer（MOVE）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MOVE-001 | P0 | P3 | U-OP | FR-MOVE-001／003、AC-028；Bin Move | BIN-A1有LOT-EARLY 10 EA | 移4至BIN-A2 | 提交Bin Move並查看兩Bin與Movement | 來源6、目的4、W-A及Total On Hand不變；產生同operation ID的Out／In Movement | 確認、兩Bin前後、成對Movement | — | NOT RUN |
| MOVE-002 | P0 | P3 | U-OP | FR-MOVE-002／004、AC-029；維度不變 | W-A／W-B及多狀態bucket | 同Bin、跨倉、改SKU／Lot／Expiry／Status | 逐一嘗試Bin Move | 同Bin及跨倉被拒絕並提示正確流程；不可藉Move改其他維度；數量不變 | 輸入、錯誤、前後Bucket | — | NOT RUN |
| MOVE-003 | P0 | P3 | U-OP | FR-MOVE-005～007、AC-022；保障與鎖 | 來源有Reservation；另有Counting Bin | 可移不破壞保障／會破壞保障／數量0、小數、過量 | 逐一提交Move | 合法同倉Move成功且Reserved不變；破壞保障、非法數量、過量或Counting Bin全數拒絕且不部分移動 | 各結果、Reservation、兩Bin、Movement | — | NOT RUN |
| MOVE-004 | P1 | P3 | U-OP | FR-TRANSFER-001／002、AC-030；Draft | W-A、W-B Active | 多行SKU／Lot／source Bin／qty | 建立Draft、修改完整lines、取消另一Draft | Draft建立／修改／取消均不改On Hand、Reserved或In Transit；取消狀態與原因清楚 | Draft歷程及前後Stock | — | NOT RUN |
| MOVE-005 | P0 | P3 | U-OP | FR-TRANSFER-003～005、AC-031；Dispatch | 合法多行Draft | W-A→W-B | 查看整張警告並Dispatch | 提交時重驗；所有行一次成功；來源各Bin扣減、In Transit等量增加、目的仍0；狀態變In Transit | 確認頁、Transfer、來源／目的Stock、Movement | — | NOT RUN |
| MOVE-006 | P0 | P3 | U-OP | FR-TRANSFER-004／005；Dispatch全有或全無 | 多行Draft，其中一行不足／被預留／Bin被鎖 | 3個有效行＋1個失效行 | Dispatch | 整張拒絕並標示失效行及下一步；所有來源、In Transit、目的均不變 | 錯誤、每行前後Stock、Transfer狀態 | — | NOT RUN |
| MOVE-007 | P0 | P3 | U-OP | FR-TRANSFER-006；In Transit不可用 | 已Dispatch Transfer | In Transit各行 | 嘗試修改／取消Transfer；在Reservation／Allocation／Issue中搜尋在途量 | 修改／取消按鈕不可用且直接提交被拒絕；在途量不計ATP且不可被預留／分配／出庫 | Transfer、按鈕／錯誤、Stock／候選 | — | NOT RUN |
| MOVE-008 | P0 | P3 | U-OP | FR-TRANSFER-007／008、AC-032；完整Receive | In Transit Transfer | 每行選W-B Active Bin | 逐行選目的Bin並Receive | 全部In Transit清零；目的Bins增加原SKU／Lot／Expiry／Status；來源歷史不變；狀態Received | Receive頁、Transfer、三方數量、Movement | — | NOT RUN |
| MOVE-009 | P0 | P3 | U-OP | FR-TRANSFER-007；目的Bin所有權 | In Transit W-A→W-B | 漏選、重複行、BIN-A1、BIN-INACTIVE | 逐種提交Receive | 每行必須恰一次指定W-B Active Bin；非法選擇全張拒絕；In Transit保持完整 | 輸入／錯誤、Transfer及Stock | — | NOT RUN |
| MOVE-010 | P0 | P3 | U-OP | FR-TRANSFER-008、AC-034；不支援部分收貨 | In Transit含多行 | 只選部分行或改小數量 | Receive | 明確拒絕部分Receive；不清除任何In Transit、不增加目的庫存；提示完整收貨後以差異流程處理 | 錯誤、In Transit及目的前後 | — | NOT RUN |
| MOVE-011 | P1 | P3 | U-OP | FR-TRANSFER-009；隔離收貨 | In Transit Transfer | 一行保持原Status；一行選Quarantined＋原因 | Receive整張 | 合法成功；指定行進Quarantined且有原因；其他行保持Dispatch狀態；ATP正確 | Receive選擇、目的Bucket、Audit | — | NOT RUN |
| MOVE-012 | P1 | P3 | U-OP／U-ADJ | FR-TRANSFER-010；短少／損壞處理 | 實收有短少或損壞 | 完整Receive後的Adjustment／Status Transfer | 先完整Receive，再依授權差異流程更正 | Dispatch／Receive歷史不被修改；差異以新關聯Movement處理；Transfer及最終庫存可對賬 | Transfer歷史、差異操作、Movement | — | NOT RUN |
| MOVE-013 | P0 | P3 | U-OP | FR-TRANSFER-011／012、AC-033；冪等與狀態 | 可重送Dispatch及Receive | 同event同內容／異內容 | 各階段重按、逾時後查詢及重送，再改payload重送 | 同內容只一次數量效果；異內容衝突；Draft／In Transit／Received／Cancelled及操作者／時間正確 | 每次結果、Transfer歷程、三方數量 | — | NOT RUN |

### 7.7 Adjustment、Status Transfer與Reversal（ADJ）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADJ-001 | P0 | P3 | U-OP／U-ADJ | FR-ADJUST-001、AC-035；權限 | 同一bucket可調整 | 合法Adjustment／Status／Reversal | U-OP及U-ADJ分別提交 | U-OP全部拒絕且零變更；U-ADJ仍須完成對應重新認證及原因才可提交 | 角色、拒絕／確認、前後Stock | — | NOT RUN |
| ADJ-002 | P1 | P3 | U-ADJ | FR-ADJUST-002／004；正Adjustment | Active SKU／Bin | 七項批准的reason category、文字；另測未知category及`OTHER`缺詳細說明 | 由Adjustment頁逐一提交 | 固定allowlist及有詳細說明的`OTHER`可進入高風險確認；未知category或`OTHER`說明不足被拒絕；成功操作建立Adjustment Movement／Audit且不可代替正常Receipt | 確認、拒絕、前後Bucket、Movement／Audit | — | NOT RUN |
| ADJ-003 | P0 | P3 | U-ADJ | FR-ADJUST-003、AC-036；負數保障 | Bucket有5 EA | 減5、減6、0、負輸入、小數 | 逐一提交負Adjustment | 減5可至0；其餘拒絕；不得負數或部分扣除；Reservation保障亦重新驗證 | 各結果、前後Bucket、Movement | — | NOT RUN |
| ADJ-004 | P0 | P3 | U-ADJ | FR-ADJUST-005、AC-037；Status Transfer | Available 10 | 4轉Quarantined | 提交並查三種狀態 | Available 6、Quarantined 4、Total仍10；Warehouse／Bin／SKU／Lot不變；成對Movement及原因完整 | 確認、狀態前後、Movement | — | NOT RUN |
| ADJ-005 | P0 | P3 | U-ADJ | FR-ADJUST-006、AC-038；Reservation保障 | Available 10且Reserved 10 | 轉4至Damaged | 提交Status Transfer | 被拒絕並提示先釋放／重新安排Reservation；所有Bucket及Reserved不變 | 錯誤、Stock／Reservation前後 | — | NOT RUN |
| ADJ-006 | P0 | P3 | U-ADJ | FR-ADJUST-007；恢復與Expired | Quarantined／Damaged及LOT-EXPIRED | 轉回Available＋REASON | 分別提交並查ATP | 合法狀態轉換成功且需原因；Expired Lot即使Status為Available仍顯示Expired且不進正常ATP | Status結果、Expiry／ATP、Audit | — | NOT RUN |
| ADJ-007 | P0 | P3 | U-ADJ | FR-ADJUST-008、AC-018；不可改歷史與Reversal | 已過帳Receipt／Issue／可反向Movement | 修改／刪除／Reversal | 嘗試編輯或刪除，再合法反向 | 原Movement不可修改／刪除；Reversal建立相反新Movement並互相連結；當下規則仍須通過 | 被拒絕操作、原／反向Movement、Stock | — | NOT RUN |
| ADJ-008 | P0 | P3 | U-ADJ | FR-ADJUST-008／009；不可反向情境 | Movement已反向或目前餘量不足／受Reservation保障 | 同一Reversal event | 反向兩次或在會破壞規則時反向 | 明確拒絕已反向／不允許類型／當下不變量；原歷史及數量不變；同event重送不重複 | 拒絕、Movement鏈、前後Stock | — | NOT RUN |
| ADJ-009 | P0 | P3 | 兩名U-ADJ | BR-007／038、AC-039；版本衝突 | 同Bucket version=N | A／B各減相同存貨 | 兩個頁面同時載入；A先提交；B後提交 | 只有一個成功；另一個顯示版本／並發衝突並要求刷新；不出現負數或無聲覆蓋 | 兩邊結果、最終Bucket、Movement | — | NOT RUN |

### 7.8 Stocktake盤點（COUNT）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| COUNT-001 | P1 | P4 | U-OP | FR-COUNT-001；建立Draft | W-A有多個Active Bins | BIN-A1／A2 | 以wizard選Warehouse及Bins建立、修改Draft | Draft成功且不鎖Bin、不改庫存；scope只可含同一Warehouse Active Bins | Wizard、Draft詳情、Stock狀態 | — | NOT RUN |
| COUNT-002 | P0 | P4 | 兩名U-OP | FR-COUNT-001、BR-033；唯一Active scope | A已為BIN-A1建立未完成Stocktake | B另建包含BIN-A1的Stocktake | B提交，或兩人近乎同時開始 | 最多一個未完成Stocktake可擁有該Bin；另一個被拒絕並顯示可見Stocktake number | 兩邊結果、Stocktake列表 | — | NOT RUN |
| COUNT-003 | P0 | P4 | U-OP | FR-COUNT-002；Start快照與鎖 | Draft含BIN-A1／A2 | 已知所有bucket | 確認Start警告並開始Counting；刷新／重新登入後查看 | 保存開始時帳面快照；頁面持續顯示兩Bins被哪個Stocktake鎖定、時間及進度；重新載入後仍存在 | Start確認、Counting頁、刷新後畫面 | — | NOT RUN |
| COUNT-004 | P0 | P4 | 各操作角色 | FR-COUNT-003、AC-040；鎖覆蓋 | BIN-A1處於Counting | Receipt、Issue、Bin Move、Transfer、Adjustment、Status、Reversal | 從每個正式入口嘗試改BIN-A1 On Hand | 全部被拒絕，顯示Stocktake number及下一步；BIN-A1數量、Movement不變；不影響未鎖BIN-B1 | 各入口錯誤、兩Bin前後、Movement | — | NOT RUN |
| COUNT-005 | P1 | P4 | U-OP | FR-COUNT-004；錄入語意 | Counting lines | 0、未輸入、未發現、正整數；負數／小數 | 逐行輸入、保存、刷新 | 0與空白清楚不同；未發現為明確動作；合法值保留；負數／小數field-level拒絕；進度正確 | 輸入、錯誤、刷新後line／進度 | — | NOT RUN |
| COUNT-006 | P1 | P4 | U-OP | FR-COUNT-005／006；帳外bucket | Counting時發現快照沒有的貨 | 合法SKU／Lot／Status；重複dimension；無效資料 | 掃描／搜尋並加入帳外bucket | 合法新增以snapshot 0出現且只一行；重複或不合SKU／Lot／Bin規則被拒絕 | 搜尋／新增、line列表、錯誤 | — | NOT RUN |
| COUNT-007 | P0 | P4 | 兩名U-OP | FR-COUNT-011；並發點算 | 同一line version=N | A輸入8、B輸入9 | 兩人同時載入；A保存後B保存 | A成功；B收到版本衝突且不能覆蓋；B刷新看到8並再決定 | 兩邊畫面、衝突及最終line | — | NOT RUN |
| COUNT-008 | P0 | P4 | U-OP | FR-COUNT-007；Ready完整性 | 有未完成lines | 部分counted、部分blank／not found | 嘗試Ready，再完成全部並重提 | 未完成時拒絕並可定位；全部完成後成功進READY；顯示總行、未完成、盤盈、盤虧、零差異；一般操作員不能再改 | Review摘要、拒絕／成功、edit狀態 | — | NOT RUN |
| COUNT-009 | P0 | P4 | U-ADJ | FR-COUNT-008、AC-041；Posting全有或全無 | READY含多個差異；其中一行在提交時失效 | 合法device-password及REASON | 提交Post | 整次拒絕；所有差異均不生效、無部分Movement；Bins繼續鎖定；畫面不誤報完成並給下一步 | Post錯誤、各Bucket、Movement、lock提示 | — | NOT RUN |
| COUNT-010 | P0 | P4 | U-ADJ | FR-COUNT-008／009、AC-042；成功Posting | READY全部有效 | 多盤盈／盤虧／零差異lines | 重新認證並Post，查看結果 | 所有差異一次成功；每行帳面、實數、差異及Movement清楚且不可改；Audit完整；所有owner Bins解鎖 | Post、結果／CSV、Movement／Audit、可操作Bin | — | NOT RUN |
| COUNT-011 | P0 | P4 | U-OP | FR-COUNT-010、AC-043；取消 | COUNTING／READY Stocktake | Password＋REASON | 取消後對Bin做合法Move或Receipt | 狀態Cancelled；沒有差異Movement或數量變化；所有該Stocktake Bins可靠解鎖並可再操作 | 取消、Movement、前後Stock、後續成功操作 | — | NOT RUN |
| COUNT-012 | P0 | P4 | U-OP／U-ADJ | FR-COUNT-011；重送及逾時 | 可重送Start／save／Post | 同request同內容／異內容 | 重按、逾時查詢後重試 | 不重複快照、line或variance Movement；異內容或舊version衝突；唯一最終狀態可查 | 每次結果、Stocktake歷程、Movement | — | NOT RUN |
| COUNT-013 | P1 | P4 | U-VIEW | FR-COUNT-012；差異摘要及CSV | Draft／Counting／Ready／Posted資料 | status、warehouse、date、variance filters | 查詢列表、詳情、進度、差異及下載CSV | 畫面與CSV的scope、snapshot、actual、variance、Movement IDs一致；無盲盤多輪／隊伍分派等範圍外功能 | 畫面、CSV及人工對照 | — | NOT RUN |

### 7.9 Opening Balance與Go-Live（OPEN）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPEN-001 | P1 | P5 | U-MGMT | FR-OPEN-001；模板 | PRE_GO_LIVE | Opening template | 下載模板並查看欄位說明 | UTF-8模板只含Warehouse、Bin、SKU、Lot、Expiry、Stock Status、Base Quantity；不含Pack、Reserved、成本或自訂欄 | 下載檔及欄位清單 | — | NOT RUN |
| OPEN-002 | P0 | P5 | U-MGMT | FR-OPEN-002；Precheck不入帳 | PRE_GO_LIVE且初始庫存已記錄 | CSV-VALID | Upload並等待Precheck READY，不按Confirm | 顯示row／quantity摘要及短file hash；Precheck期間／完成後Stock、Lot、Movement均無業務變化 | Upload狀態、摘要、前後查詢／Movement | — | NOT RUN |
| OPEN-003 | P0 | P5 | U-MGMT | FR-OPEN-002／003／005、AC-044；錯誤定位 | PRE_GO_LIVE | CSV-INVALID各類錯誤 | 分別Upload：未知／重複header、額外欄、公式、encoding、重複dimension、無效位置／SKU／Lot／qty | Job不可Confirm；以row、field及繁中安全訊息定位；任何一個錯誤均令整份零庫存效果；不直接輸出未過濾原始CSV | 每類錯誤、job狀態、前後Stock | — | NOT RUN |
| OPEN-004 | P0 | P5 | U-MGMT | FR-OPEN-002／003；Tracking與所有權 | PRE_GO_LIVE | none帶多餘Lot、batch缺Lot、batch_expiry缺Expiry、serial、跨倉／Inactive Bin、矛盾Lot | Upload及Precheck | 每種依同一Inventory規則被row／field阻擋；整份不可確認且無部分建立Lot／Stock | 錯誤結果、Stock／Lot前後 | — | NOT RUN |
| OPEN-005 | P1 | P5 | U-MGMT | NFR-004；10k列上限與進度 | 系統測試容量證據已通過 | 10,000及10,001 data rows | Upload並觀察進度／完成時間 | 10,000列於目標10分鐘內完成Precheck＋後續Posting處理時間；10,001明確拒絕；UI不中斷且可離頁再回看 | 時間線、job進度／結果 | — | NOT RUN |
| OPEN-006 | P0 | P5 | U-MGMT／U-ADJ | FR-OPEN-004、SEC-004／010；Confirm授權 | READY job | 無權、錯密碼、錯裝置、缺reason、合法U-MGMT | 逐一Confirm | 只有U-MGMT以有效device-password及reason可進POSTING；adjust不隱含mgmt；其他均零庫存效果 | 各確認／拒絕、job及Stock | — | NOT RUN |
| OPEN-007 | P0 | P5 | U-MGMT | FR-OPEN-004、AC-045；成功開帳 | READY且precheck仍有效 | CSV-VALID | Confirm並等待完成，再對賬 | 所有rows一次成功；Opening Movements、來源、Audit及各Bucket數量一致；沒有部分成功 | Job result、Stock／Movement／Audit、對賬表 | — | NOT RUN |
| OPEN-008 | P0 | P5 | U-MGMT | OPENING_PRECHECK_STALE；提交重驗 | READY後SKU／Bin／Lot規則或Inventory control版本改變 | 原CSV-VALID | Confirm舊Precheck | 不硬用舊結果；Job回READY或明確stale狀態並要求重新Precheck；零Opening數量效果 | 狀態時間線、錯誤、前後Stock | — | NOT RUN |
| OPEN-009 | P0 | P5 | U-MGMT | NFR-009；worker逾時／重啟 | 可模擬畫面逾時或worker重啟 | READY job／同Confirm request | Confirm後遇逾時；離頁再回job，以同ID查詢／重試 | 可安全判定最終狀態；已完成不重複Movement；未完成可恢復或顯示可行動錯誤；沒有半份Opening | 逾時、job歷程、重試、對賬 | — | NOT RUN |
| OPEN-010 | P1 | P5 | U-MGMT | Opening cancel | UPLOADED／READY／FAILED job | Password＋REASON | 取消可取消狀態；對VALIDATING／POSTING／COMPLETED嘗試取消 | 合法狀態變Cancelled且不入帳；處理中／已完成不可取消或改寫結果 | 各job狀態、取消／拒絕、Stock | — | NOT RUN |
| OPEN-011 | P0 | P5 | U-MGMT | FR-OPEN-006、AC-046；Go-Live不可逆 | Data Freeze後舊系統無新異動；Warehouse／Operations Lead已對賬；DB帳號已分離且backup／restore rehearsal通過 | Sam的Device-password＋REASON | 由Sam確認Go-Live，再刷新、重新登入及嘗試Upload／Confirm | 只有完整gate及Sam簽核才進LIVE；狀態永久LIVE，upload／confirm入口隱藏且直接嘗試亦拒絕；提示後續用Adjustment／Stocktake；沒有返回PRE_GO_LIVE操作 | Data Freeze、對賬、DB／rehearsal證據、Sam簽核、LIVE頁、拒絕結果 | — | NOT RUN |
| OPEN-012 | P1 | P5 | U-MGMT／U-VIEW | FR-OPEN-007；結果保留與最小資料 | 有成功／失敗／已清理檔案job | job result、row errors、Audit | 查job、結果、Movement、Audit；於result file過期後再開 | 操作者、hash、reason、結果、來源及Movement可追；不保存／顯示整份原CSV、密碼或token；檔案清理後job／audit仍可查並明確說明 | Job／result／Audit及過期畫面 | — | NOT RUN |

### 7.10 報表、Audit、UX與營運復原（REPORT）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REPORT-001 | P0 | P5 | U-VIEW | FR-REPORT-001；Stock匯出 | 已知多Warehouse／Bin／Lot／Status庫存 | 組合filters及多頁結果 | 在Stock畫面設定filter後匯出 | CSV與畫面使用同一filters、Base UOM、時間／狀態語意；全結果無漏重；總數可對賬 | filter URL、畫面、CSV及對賬 | — | NOT RUN |
| REPORT-002 | P1 | P5 | U-VIEW | FR-REPORT-002～005；營運清單 | 有各類Movement、Reservation、Allocation、In Transit、Expiry資料 | date／type／source／location／days等filters | 分別查Movement、Active Reservation、Transfer及Expiry並匯出 | 每張清單可定位來源及關鍵數量；In Transit收發可對賬；Expiry按狀態分開；畫面與CSV一致 | 各清單、來源、CSV | — | NOT RUN |
| REPORT-003 | P0 | P5 | U-VIEW | FR-REPORT-006／007、SEC-009／014；CSV安全 | 欄位含以`=`,`+`,`-`,`@`開頭的合法顯示文字 | 所有五種export | 匯出並以試算表安全開啟 | 可疑內容不執行公式；檔案不含成本、銀行／付款、token、內部path、未授權資料或未定義預測 | 原畫面、CSV文字及開啟結果 | — | NOT RUN |
| REPORT-004 | P0 | P5 | U-VIEW | FR-AUDIT-001～003；端到端追溯 | 各類成功業務操作各一筆 | Warehouse、Bin、Reservation、Allocation、Movement、Transfer、Adjustment、Stocktake、Opening、FEFO | 從業務物件開Audit／Movement／來源，再反向返回 | actor、action、object、before／after摘要、reason、time、request／correlation、source及outcome可追；每個數量變化雙向可定位 | 每類畫面及trace worksheet | — | NOT RUN |
| REPORT-005 | P0 | P5 | U-VIEW | FR-AUDIT-004／007；失敗與拒絕可調查 | 已執行越權、版本、冪等、鎖及規則拒絕 | 對應request IDs | 由授權Audit／營運查詢查看失敗記錄 | 可辨識失敗／拒絕類型、actor、時間及correlation；沒有虛假成功庫存效果；不洩漏敏感payload／未授權詳情 | 原錯誤與Audit／營運查詢 | — | NOT RUN |
| REPORT-006 | P0 | P5 | U-VIEW | BR-041、NFR-012；歷史快照 | 已完成Movement後修改SKU code／name、Lot顯示或Bin name並停用master | 修改前後值 | 查舊Movement、來源及當前master | 舊交易歷史顯示快照不被回寫；仍可連到當前物件並分清歷史／現況；停用／不能刪除不破壞至少7年seeded歷史 | 修改前後、舊Movement／來源 | — | NOT RUN |
| REPORT-007 | P1 | P5 | U-VIEW／U-OP | UX §10、design §7.8；可用性／無障礙 | 核心頁面及長SKU／Lot／Bin資料 | 375／768／1024／1440px、鍵盤、screen reader smoke | 完成filter、detail、Transfer receive、count及高風險confirm | 無不可操作溢出；heading／label／aria、焦點、error summary及dialog focus正確；icon有名稱；狀態不只靠色；長字安全顯示 | 四寬度截圖、鍵盤／輔助技術記錄 | — | NOT RUN |
| REPORT-008 | P1 | P5 | U-VIEW | NFR-001／002／005、AC-049；使用者效能 | 系統測試容量基線及20 user p95證據已通過 | 精確SKU／barcode、常用Stock、FEFO候選 | 在UAT環境按既定腳本重複常用操作並記畫面完成時間 | 常用結果一般於2秒目標內可用且正確；列表server pagination；loading清楚且頁面可操作；正式p95以系統測試報告簽核 | UAT時間樣本、system performance report | — | NOT RUN |
| REPORT-009 | P0 | P5 | U-VIEW／操作角色 | NFR-009／011；依賴與重試體驗 | 可模擬非必要下游／必要Item或DB依賴暫時不可用 | 查詢及一筆寫入 | 下游不可用時查Inventory；必要依賴不可用時提交；恢復後按指引重試 | 非必要Supplier／Customer等故障不令正常查詢失敗；必要依賴故障明確fail closed且零變更；loading、dependency unavailable、retry狀態可區分 | 故障時間線、畫面、前後數量 | — | NOT RUN |
| REPORT-010 | P0 | P5 | Product Owner／Warehouse Lead | NFR-010、AC-050；復原與最終對賬 | 技術團隊已在隔離環境完成backup／restore並提供報告 | 恢復後的Balance、Movement、Reservation、Transfer、Stocktake、Audit摘要 | 按抽樣清單在恢復環境查詢並與復原報告／來源單據對賬 | 抽樣數量、位置、狀態、Movement及來源一致；沒有孤兒、重複或遺失；技術AC-050證據與業務查詢相符 | 技術復原報告、UAT抽樣／簽核 | — | NOT RUN |

## 8. Phase驗收批次

| UAT批次 | 執行範圍 | 主要完成結果 | 前置系統測試證據 |
| --- | --- | --- | --- |
| P0 Foundation | AUTH-001～008中已可執行部分 | 權限、認證、錯誤及跨模組入口契約可供後續Phase驗收 | Migration、permission、公開錯誤、transaction及audit基線 |
| P1 Core Stock | MASTER-001～010、STOCK-001～012、POST-001～009／012／013（Receipt） | Warehouse／Bin、Lot及Receipt形成可查、可追、位置準確的核心庫存 | 真MySQL migration／integration、Receipt原子性、查詢容量 |
| P2 Reservation & Allocation | POST-010～013（Issue）、RES-001～013 | 從預留、FEFO分配至Issue的銷售庫存流程完整 | 並發Reservation、FEFO規則、Issue transaction |
| P3 Warehouse Operations | MOVE-001～013、ADJ-001～009 | Bin Move、Transfer、Adjustment、Status及Reversal可控運作 | 多行原子性、冪等、版本及鎖整合 |
| P4 Stocktake | COUNT-001～013 | 盤點鎖、錄入、整次過帳及取消可被倉務接受 | Persistent lock、restart、all-or-none posting |
| P5 Opening & Release | OPEN-001～012、REPORT-001～010及完整回歸 | 可安全開帳／Go-Live，報表、稽核、效能及復原證據齊全 | Worker、10k容量、CSV security、backup／restore、full regression |

每個Phase只在其功能已部署且前置證據通過後執行；不適用於當期尚未交付的案例保持 `NOT RUN`，不得為了通過Phase而改成PASS。

## 9. 缺陷嚴重程度與簽核

| Severity | 定義 |
| --- | --- |
| S1 Critical | 庫存遺失／重複／負數／半套過帳、重大越權、Go-Live或Stocktake不可恢復，且沒有安全workaround。 |
| S2 High | 核心業務流程不能完成、位置／Lot／ATP／狀態錯誤、審計不可追或高風險控制失效。 |
| S3 Medium | 有安全workaround的非核心功能錯誤、報表局部不一致、明顯UX／無障礙問題。 |
| S4 Low | 不影響業務結果的文字、排列或輕微視覺問題。 |

每個Fail須記錄Defect ID、重現步驟、build、actor、source／request ID、預期／實際、畫面證據及數量影響。重新測試通過後才可更新案例狀態；修正不得直接覆寫原Evidence。

### 9.1 最終簽核欄

| 角色 | 姓名 | 決定 | 日期 | 備註 |
| --- | --- | --- | --- | --- |
| Product Owner | 待填 | 待簽核 | — | — |
| Warehouse／Inventory Lead | 待填 | 待簽核 | — | — |
| QA Lead | 待填 | 待簽核 | — | — |
| Engineering Lead | 待填 | 待簽核 | — | — |

<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal UAT Definitions

All cases remain `NOT_RUN`. Because no Inventory Playwright suite currently exists, the ledger records `MANUAL_REQUIRED`; this is a blocker for future UI automation, not permission to bypass the repository Playwright standard once the UI exists.

| Canonical ID | Legacy ID | Priority |
| --- | --- | --- |
| UAT-001 | AUTH-001 | P0 |
| UAT-002 | AUTH-002 | P0 |
| UAT-003 | AUTH-003 | P0 |
| UAT-004 | AUTH-004 | P0 |
| UAT-005 | AUTH-005 | P0 |
| UAT-006 | AUTH-006 | P0 |
| UAT-007 | AUTH-007 | P0 |
| UAT-008 | AUTH-008 | P0 |
| UAT-009 | MASTER-001 | P1 |
| UAT-010 | MASTER-002 | P0 |
| UAT-011 | MASTER-003 | P1 |
| UAT-012 | MASTER-004 | P0 |
| UAT-013 | MASTER-005 | P0 |
| UAT-014 | MASTER-006 | P0 |
| UAT-015 | MASTER-007 | P1 |
| UAT-016 | MASTER-008 | P0 |
| UAT-017 | MASTER-009 | P0 |
| UAT-018 | MASTER-010 | P1 |
| UAT-019 | STOCK-001 | P1 |
| UAT-020 | STOCK-002 | P0 |
| UAT-021 | STOCK-003 | P0 |
| UAT-022 | STOCK-004 | P0 |
| UAT-023 | STOCK-005 | P0 |
| UAT-024 | STOCK-006 | P1 |
| UAT-025 | STOCK-007 | P0 |
| UAT-026 | STOCK-008 | P0 |
| UAT-027 | STOCK-009 | P0 |
| UAT-028 | STOCK-010 | P0 |
| UAT-029 | STOCK-011 | P1 |
| UAT-030 | STOCK-012 | P1 |
| UAT-031 | POST-001 | P0 |
| UAT-032 | POST-002 | P0 |
| UAT-033 | POST-003 | P0 |
| UAT-034 | POST-004 | P1 |
| UAT-035 | POST-005 | P0 |
| UAT-036 | POST-006 | P1 |
| UAT-037 | POST-007 | P0 |
| UAT-038 | POST-008 | P0 |
| UAT-039 | POST-009 | P0 |
| UAT-040 | POST-010 | P0 |
| UAT-041 | POST-011 | P0 |
| UAT-042 | POST-012 | P0 |
| UAT-043 | POST-013 | P0 |
| UAT-044 | RES-001 | P0 |
| UAT-045 | RES-002 | P0 |
| UAT-046 | RES-003 | P0 |
| UAT-047 | RES-004 | P0 |
| UAT-048 | RES-005 | P0 |
| UAT-049 | RES-006 | P0 |
| UAT-050 | RES-007 | P0 |
| UAT-051 | RES-008 | P0 |
| UAT-052 | RES-009 | P0 |
| UAT-053 | RES-010 | P0 |
| UAT-054 | RES-011 | P0 |
| UAT-055 | RES-012 | P0 |
| UAT-056 | RES-013 | P1 |
| UAT-057 | MOVE-001 | P0 |
| UAT-058 | MOVE-002 | P0 |
| UAT-059 | MOVE-003 | P0 |
| UAT-060 | MOVE-004 | P1 |
| UAT-061 | MOVE-005 | P0 |
| UAT-062 | MOVE-006 | P0 |
| UAT-063 | MOVE-007 | P0 |
| UAT-064 | MOVE-008 | P0 |
| UAT-065 | MOVE-009 | P0 |
| UAT-066 | MOVE-010 | P0 |
| UAT-067 | MOVE-011 | P1 |
| UAT-068 | MOVE-012 | P1 |
| UAT-069 | MOVE-013 | P0 |
| UAT-070 | ADJ-001 | P0 |
| UAT-071 | ADJ-002 | P1 |
| UAT-072 | ADJ-003 | P0 |
| UAT-073 | ADJ-004 | P0 |
| UAT-074 | ADJ-005 | P0 |
| UAT-075 | ADJ-006 | P0 |
| UAT-076 | ADJ-007 | P0 |
| UAT-077 | ADJ-008 | P0 |
| UAT-078 | ADJ-009 | P0 |
| UAT-079 | COUNT-001 | P1 |
| UAT-080 | COUNT-002 | P0 |
| UAT-081 | COUNT-003 | P0 |
| UAT-082 | COUNT-004 | P0 |
| UAT-083 | COUNT-005 | P1 |
| UAT-084 | COUNT-006 | P1 |
| UAT-085 | COUNT-007 | P0 |
| UAT-086 | COUNT-008 | P0 |
| UAT-087 | COUNT-009 | P0 |
| UAT-088 | COUNT-010 | P0 |
| UAT-089 | COUNT-011 | P0 |
| UAT-090 | COUNT-012 | P0 |
| UAT-091 | COUNT-013 | P1 |
| UAT-092 | OPEN-001 | P1 |
| UAT-093 | OPEN-002 | P0 |
| UAT-094 | OPEN-003 | P0 |
| UAT-095 | OPEN-004 | P0 |
| UAT-096 | OPEN-005 | P1 |
| UAT-097 | OPEN-006 | P0 |
| UAT-098 | OPEN-007 | P0 |
| UAT-099 | OPEN-008 | P0 |
| UAT-100 | OPEN-009 | P0 |
| UAT-101 | OPEN-010 | P1 |
| UAT-102 | OPEN-011 | P0 |
| UAT-103 | OPEN-012 | P1 |
| UAT-104 | REPORT-001 | P0 |
| UAT-105 | REPORT-002 | P1 |
| UAT-106 | REPORT-003 | P0 |
| UAT-107 | REPORT-004 | P0 |
| UAT-108 | REPORT-005 | P0 |
| UAT-109 | REPORT-006 | P0 |
| UAT-110 | REPORT-007 | P1 |
| UAT-111 | REPORT-008 | P1 |
| UAT-112 | REPORT-009 | P0 |
| UAT-113 | REPORT-010 | P0 |

## UAT-001 — AUTH-001 — SEC-001；未登入存取

### Business objective and actor
Actor: 未登入. Validate the business outcome of legacy case `AUTH-001` at priority `P0`.

### Preconditions and data
Preconditions: 已登出 Test data: Inventory各頁URL

### Steps
直接開啟各Inventory頁

### Expected business result
跳至登入或顯示未登入；沒有Inventory資料或操作可見

### Acceptance criteria
Required evidence: URL、畫面、登入導向 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-002 — AUTH-002 — SEC-002～006；權限互不繼承

### Business objective and actor
Actor: U-NONE／U-SYS. Validate the business outcome of legacy case `AUTH-002` at priority `P0`.

### Preconditions and data
Preconditions: 兩角色均未獲Inventory permission Test data: Inventory sidebar及各頁URL

### Steps
登入後檢查選單，再直接開URL

### Expected business result
選單不顯示；頁面403；System Administrator不會自動取得Inventory權限

### Acceptance criteria
Required evidence: 角色設定、sidebar及403畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-003 — AUTH-003 — SEC-002、AC-006；只讀

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `AUTH-003` at priority `P0`.

### Preconditions and data
Preconditions: 有可查詢資料 Test data: Stock、Warehouse、Transfer、Stocktake

### Steps
查詢／匯出，再嘗試新增、修改或過帳

### Expected business result
查詢及匯出成功；寫入按鈕不可用；直接提交仍被拒絕；數量與狀態不變

### Acceptance criteria
Required evidence: 權限、查詢／匯出、拒絕及前後畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-004 — AUTH-004 — SEC-003～006；最小權限

### Business objective and actor
Actor: U-OP／U-MGMT／U-ADJ／U-FEFO. Validate the business outcome of legacy case `AUTH-004` at priority `P0`.

### Preconditions and data
Preconditions: 四個獨立帳戶 Test data: 各權限專屬操作

### Steps
分別嘗試operation、master、adjust、FEFO override及其他非授權操作

### Expected business result
每人只可完成獲授權能力；任一permission不隱含另一項

### Acceptance criteria
Required evidence: 角色矩陣、可用按鈕、成功／拒絕畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-005 — AUTH-005 — SEC-007、AC-047；下游最小能力

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `AUTH-005` at priority `P0`.

### Preconditions and data
Preconditions: 已授權Sales／Receiving／Fulfillment流程 Test data: 正式來源單據

### Steps
從下游完成Reservation／Receipt／Issue，再開Inventory管理URL

### Expected business result
正式流程可取得需要的庫存效果；仍不可進Inventory管理頁或執行其他操作

### Acceptance criteria
Required evidence: 來源頁、Inventory結果、403畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-006 — AUTH-006 — SEC-013、AC-048；提交重驗

### Business objective and actor
Actor: U-STALE. Validate the business outcome of legacy case `AUTH-006` at priority `P0`.

### Preconditions and data
Preconditions: 使用者已載入可提交畫面 Test data: Adjustment或FEFO例外草稿

### Steps
管理員撤權／停用使用者後，原使用者提交

### Expected business result
被清楚拒絕；沒有數量、Movement或成功Audit效果；提示重新登入或聯絡管理員

### Acceptance criteria
Required evidence: 撤權時間、提交錯誤、前後庫存／Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-007 — AUTH-007 — SEC-005／010；重新認證

### Business objective and actor
Actor: 對應角色. Validate the business outcome of legacy case `AUTH-007` at priority `P0`.

### Preconditions and data
Preconditions: 高風險操作資料已備妥 Test data: 正確、錯誤、過期及另一裝置challenge

### Steps
對停用／刪除、Adjustment、Reversal、Stocktake Post、Opening Confirm、Go-Live逐一確認

### Expected business result
只有符合該操作、actor、device及有效時間的認證可用一次；錯誤／過期／跨操作重放被拒絕

### Acceptance criteria
Required evidence: 認證對話、成功／拒絕及前後狀態 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-008 — AUTH-008 — SEC-008～011；ID替換與輸入安全

### Business objective and actor
Actor: U-OP／U-ADJ. Validate the business outcome of legacy case `AUTH-008` at priority `P0`.

### Preconditions and data
Preconditions: 有不同Warehouse／Reservation／Transfer／Stocktake資料 Test data: 竄改URL或表單ID、HTML字串、超長reason

### Steps
以瀏覽器可操作方式替換ID或輸入惡意內容並提交

### Expected business result
跨所有權／越權資料不可讀寫；輸出只顯示安全文字；錯誤不含SQL、stack、token或內部路徑；資料不變

### Acceptance criteria
Required evidence: URL／輸入、錯誤畫面、前後資料 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-009 — MASTER-001 — FR-MASTER-001／010；新增查詢

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-001` at priority `P1`.

### Preconditions and data
Preconditions: 無同code Warehouse Test data: 新Warehouse code／name

### Steps
新增後以code、name、status搜尋並開詳情

### Expected business result
Warehouse建立為Active；資料正確；預設列表只顯示Active並可篩選

### Acceptance criteria
Required evidence: 表單、成功訊息、列表及詳情 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-010 — MASTER-002 — FR-MASTER-002；全公司硬唯一

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-002` at priority `P0`.

### Preconditions and data
Preconditions: 已有Active／Inactive／Archived Warehouse Test data: 同code大小寫及前後空白變體

### Steps
分別新增或修改成重複code

### Expected business result
全部被field-level錯誤阻擋；歷史code繼續占用；原資料不變

### Acceptance criteria
Required evidence: 輸入、錯誤、列表／詳情 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-011 — MASTER-003 — FR-MASTER-003／004、AC-001；Bin唯一範圍

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-003` at priority `P1`.

### Preconditions and data
Preconditions: W-A、W-B Active Test data: 相同Bin code及同倉重複變體

### Steps
W-A、W-B各建同code；再於W-A重複建立

### Expected business result
不同Warehouse均成功；同Warehouse經trim／不分大小寫後重複被拒絕

### Acceptance criteria
Required evidence: 兩倉Bin列表、重複錯誤 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-012 — MASTER-004 — FR-MASTER-005；位置所有權

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-004` at priority `P0`.

### Preconditions and data
Preconditions: W-A／W-B及其Bins Test data: W-A搭配BIN-B1

### Steps
在Warehouse已選W-A時檢查Bin選項；嘗試以改URL／表單送入BIN-B1

### Expected business result
只顯示W-A Active Bins；跨倉Bin被拒絕且不建立庫存或主資料關聯

### Acceptance criteria
Required evidence: Bin選項、拒絕畫面、前後資料 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-013 — MASTER-005 — FR-MASTER-006、AC-002；Warehouse停用guard

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-005` at priority `P0`.

### Preconditions and data
Preconditions: W-A分別有On Hand、Reservation／Allocation、未完成Transfer、Active Stocktake Test data: 四種阻擋資料

### Steps
查看停用預檢並逐一提交停用

### Expected business result
每種情境均拒絕，顯示安全且可行動的阻擋類型／數量；提交時重驗

### Acceptance criteria
Required evidence: 預檢、確認框、阻擋訊息、Warehouse狀態 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-014 — MASTER-006 — FR-MASTER-007、AC-002；Bin停用guard

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-006` at priority `P0`.

### Preconditions and data
Preconditions: BIN-A1分別有On Hand、Allocation、未完成Transfer、Active Stocktake Test data: 四種阻擋資料

### Steps
嘗試停用BIN-A1

### Expected business result
每種情境均拒絕並指出下一步；Bin仍Active

### Acceptance criteria
Required evidence: 阻擋訊息及Bin狀態 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-015 — MASTER-007 — FR-MASTER-006／007；成功停用恢復

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-007` at priority `P1`.

### Preconditions and data
Preconditions: W-C／BIN-INACTIVE無任何阻擋 Test data: Password及reason

### Steps
停用無使用資料，再恢復Warehouse或Bin

### Expected business result
正確密碼後成功並留痕；恢復Warehouse不會自動恢復其Inactive Bins

### Acceptance criteria
Required evidence: 確認、狀態前後、Audit畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-016 — MASTER-008 — FR-MASTER-008、AC-003；永久刪除

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `MASTER-008` at priority `P0`.

### Preconditions and data
Preconditions: 一組從未使用且無子資料；一組有Movement歷史且現量0 Test data: Device-password及reason

### Steps
對兩組執行永久刪除

### Expected business result
未使用者可刪除；有歷史者拒絕但可停用；歷史Movement仍可查

### Acceptance criteria
Required evidence: 刪除／拒絕、列表、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-017 — MASTER-009 — FR-MASTER-009；版本衝突

### Business objective and actor
Actor: 兩名U-MGMT. Validate the business outcome of legacy case `MASTER-009` at priority `P0`.

### Preconditions and data
Preconditions: 同一Warehouse version=N Test data: A／B各修改不同欄

### Steps
同時開頁；A先儲存；B以舊頁儲存

### Expected business result
A成功；B收到版本衝突且不覆蓋A；B可刷新再決定重提

### Acceptance criteria
Required evidence: 兩個頁面、衝突訊息、最終詳情 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-018 — MASTER-010 — UX §10、design §7.3

### Business objective and actor
Actor: U-VIEW／U-MGMT. Validate the business outcome of legacy case `MASTER-010` at priority `P1`.

### Preconditions and data
Preconditions: 多Warehouse／Bin及長code/name Test data: 375／768／1024／1440px、鍵盤

### Steps
搜尋、切換Warehouse、開Bin詳情、完成新增／確認對話

### Expected business result
Desktop主從清楚；mobile先選Warehouse再進Bin；無不可操作橫向溢出；焦點及完整文字可用

### Acceptance criteria
Required evidence: 四寬度截圖、鍵盤錄影 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-019 — STOCK-001 — FR-STOCK-001；搜尋優先序

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-001` at priority `P1`.

### Preconditions and data
Preconditions: 多SKU及barcode/name相似資料 Test data: 完整SKU code、Barcode、部分name、找不到、多結果

### Steps
逐項搜尋或掃描

### Expected business result
精確code／barcode結果優先且唯一；partial name合理排序；找不到／多結果不會靜默選擇

### Acceptance criteria
Required evidence: 搜尋字串及結果畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-020 — STOCK-002 — FR-STOCK-002／005；數量語意

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-002` at priority `P0`.

### Preconditions and data
Preconditions: STOCK-A已知結餘及Reservation／In Transit Test data: SKU-EXP

### Steps
開庫存總覽，完成一個已授權Movement／Reservation後刷新

### Expected business result
Total、Available、Reserved、ATP、Quarantined、Damaged、In Transit分欄正確且立即反映已提交結果

### Acceptance criteria
Required evidence: 操作前後總覽及來源結果 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-021 — STOCK-003 — FR-STOCK-003、AC-004；同Lot多Bin

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-003` at priority `P0`.

### Preconditions and data
Preconditions: LOT-EARLY分布BIN-A1／A2 Test data: 已知每Bin數量

### Steps
由SKU展開至Warehouse、Bin、Lot、Status

### Expected business result
每個位置均顯示；分項總和等於SKU總數；不把同Lot合併成單一位置

### Acceptance criteria
Required evidence: 展開畫面及人工加總 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-022 — STOCK-004 — FR-STOCK-003、AC-005；同Bin多SKU／Lot

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-004` at priority `P0`.

### Preconditions and data
Preconditions: BIN-A1存多SKU／Lots／Statuses Test data: 已知bucket集合

### Steps
由Warehouse／Bin查全部內容並跨頁

### Expected business result
所有bucket按穩定順序及分頁出現，沒有重複／遺漏；總數正確

### Acceptance criteria
Required evidence: Bin結果各頁及對照清單 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-023 — STOCK-005 — FR-MASTER-005、BR-003／004；精確位置

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-005` at priority `P0`.

### Preconditions and data
Preconditions: 所有非零On Hand資料已知 Test data: 各SKU／Lot

### Steps
逐層檢查所有On Hand明細

### Expected business result
每個On Hand均有正式Warehouse及同倉Active／歷史Bin；沒有無位置或自由文字位置

### Acceptance criteria
Required evidence: 庫存明細與位置詳情 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-024 — STOCK-006 — FR-STOCK-004、BR-005／006；UOM

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-006` at priority `P1`.

### Preconditions and data
Preconditions: SKU-NONE及PACK-24 Test data: 1 BOX＝24 EA

### Steps
查庫存及Pack換算展示

### Expected business result
保存／主數量以EA正整數呈現；Pack只作清楚標示的換算，不出現小數Base UOM

### Acceptance criteria
Required evidence: 數量欄及換算提示 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-025 — STOCK-007 — FR-STOCK-006、AC-011；狀態語意

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-007` at priority `P0`.

### Preconditions and data
Preconditions: 同SKU有三種Stock Status Test data: Available／Quarantined／Damaged

### Steps
查總覽及明細

### Expected business result
Total包含三種；正常ATP只含合資格Available；每種以文字＋圖示區分，不只靠顏色

### Acceptance criteria
Required evidence: 總覽、明細、狀態label Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-026 — STOCK-008 — FR-LOT-006、BR-013、AC-009；最後可用日

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-008` at priority `P0`.

### Preconditions and data
Preconditions: 可控制APP_TIME_ZONE日期 Test data: LOT-TODAY

### Steps
當日及次日查Lot與ATP／候選狀態

### Expected business result
到期日當日仍非Expired；APP_TIME_ZONE次日開始清楚標Expired並退出正常ATP

### Acceptance criteria
Required evidence: 日期設定、兩日畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-027 — STOCK-009 — FR-LOT-006／008、AC-010；不合資格提示

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-009` at priority `P0`.

### Preconditions and data
Preconditions: LOT-EXPIRED、LOT-LOW Test data: 正常銷售用途

### Steps
在Expiry及Stock頁查詢，再於來源流程嘗試使用

### Expected business result
可查到數量但明確顯示Expired／低效期及不可用原因；不計入該用途ATP

### Acceptance criteria
Required evidence: 查詢、候選／拒絕畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-028 — STOCK-010 — FR-LOT-009、AC-012；serial拒絕

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `STOCK-010` at priority `P0`.

### Preconditions and data
Preconditions: SKU-SERIAL Active Test data: 合法位置及數量

### Steps
從正式Receiving流程嘗試Receipt

### Expected business result
明確顯示本期不支援serial；不降級為none／batch；查詢及Movement無新增

### Acceptance criteria
Required evidence: 來源錯誤、前後庫存／Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-029 — STOCK-011 — FR-STOCK-007；Movement追溯

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-011` at priority `P1`.

### Preconditions and data
Preconditions: Bucket已有多種Movement Test data: Source、operation group

### Steps
從Bucket查看近期Movement，開來源，再返回SKU／Lot／Bin

### Expected business result
數量方向、類型、時間、操作者／系統身份、來源及關聯位置清楚；雙向連結可用或有穩定來源文字／ID

### Acceptance criteria
Required evidence: Bucket、Movement、來源頁 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-030 — STOCK-012 — FR-STOCK-008／010、NFR-002；篩選分頁

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `STOCK-012` at priority `P1`.

### Preconditions and data
Preconditions: 超過120個Stock buckets／Movements Test data: status、no stock、zero ATP、expired、within days、sort

### Steps
組合篩選、翻頁、刷新及瀏覽器前後

### Expected business result
預設20、最多100；結果及排序穩定；URL可還原非敏感filters；no stock／zero ATP語意正確

### Acceptance criteria
Required evidence: URL及多頁結果 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-031 — POST-001 — FR-POST-001～003、AC-013；none Receipt

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-001` at priority `P0`.

### Preconditions and data
Preconditions: 正式Receiving單據；SKU-NONE Test data: 10 EA至W-A／BIN-A1，SRC-A

### Steps
在Receiving確認收貨，再開Inventory查詢

### Expected business result
來源完成；指定Bucket增加10；產生單一Receipt Movement、來源連結及成功Audit；不能在Inventory自行建採購單

### Acceptance criteria
Required evidence: 來源頁、前後Bucket、Movement、Audit Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-032 — POST-002 — FR-LOT-002～004、AC-007；Tracking欄位

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-002` at priority `P0`.

### Preconditions and data
Preconditions: 正式Receiving單據 Test data: SKU-BATCH及SKU-EXP

### Steps
收SKU-BATCH有Lot無Expiry；收SKU-EXP有Lot及Expiry；再分別省略必填欄

### Expected business result
合法組合成功；batch缺Lot、batch_expiry缺Lot或Expiry均field-level拒絕且零庫存效果

### Acceptance criteria
Required evidence: 各輸入、成功／錯誤、前後查詢 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-033 — POST-003 — FR-LOT-005、AC-008；Lot一致性

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-003` at priority `P0`.

### Preconditions and data
Preconditions: SKU-EXP／同Lot已於W-A入庫 Test data: 相同Lot不同Expiry或Manufacture Date至W-B

### Steps
提交Receipt

### Expected business result
被拒絕並指出Lot資料衝突；W-B無新Bucket；既有Lot未被改寫

### Acceptance criteria
Required evidence: 錯誤、兩倉Lot／庫存、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-034 — POST-004 — FR-POST-002、BR-005／006；Pack換算

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-004` at priority `P1`.

### Preconditions and data
Preconditions: PACK-24有效 Test data: 2 BOX，目的BIN-A1

### Steps
在Receiving輸入Pack並確認換算後收貨

### Expected business result
提交前顯示48 EA；成功後只增加48 EA；來源與Movement保留清楚UOM／數量語意

### Acceptance criteria
Required evidence: 換算確認、前後數量、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-035 — POST-005 — FR-LOT-007；Minimum Receipt Life

### Business objective and actor
Actor: Receiving一般／例外角色. Validate the business outcome of legacy case `POST-005` at priority `P0`.

### Preconditions and data
Preconditions: SKU-EXP及LOT-LOW低於收貨門檻，另備Expired Lot Test data: 無例外、缺原因、`receiving.expiry.override`＋逐筆完整evidence

### Steps
逐一確認Receipt

### Expected business result
一般／缺原因／evidence不完整均拒絕；只有專門權限、原因及完整證據有效時成功；Expired永遠拒絕；Inventory重新驗證門檻並可追溯例外

### Acceptance criteria
Required evidence: 各次結果、庫存、Movement／Audit Status remains `NOT_RUN`; mandatory and blocking. Automation PASS never substitutes for human acceptance.

## UAT-036 — POST-006 — FR-POST-005；收貨品質狀態

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-006` at priority `P1`.

### Preconditions and data
Preconditions: Customer Return及一般Receiving來源 Test data: Customer Return、Available Receipt、Damaged Receipt

### Steps
完成三筆正式Receipt，再對退貨完成品質檢查及Status Transfer

### Expected business result
Customer Return固定先進Quarantined；一般來源進指定Bucket；退貨只有品質檢查後才可轉Available或Damaged；Total及ATP語意正確

### Acceptance criteria
Required evidence: 來源選擇、Bucket明細、Status Transfer、Movement Status remains `NOT_RUN`; mandatory and blocking. Automation PASS never substitutes for human acceptance.

## UAT-037 — POST-007 — FR-POST-009；提交重驗

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-007` at priority `P0`.

### Preconditions and data
Preconditions: 畫面載入後資料改變 Test data: SKU停用／非追蹤、Warehouse／Bin停用、跨倉Bin、SKU-SERIAL

### Steps
載入Receiving後改變基礎資料，再提交

### Expected business result
每種均依提交時事實拒絕，顯示可理解原因；零Balance／Movement成功效果

### Acceptance criteria
Required evidence: 狀態時間線、錯誤、前後查詢 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-038 — POST-008 — FR-POST-007、AC-014；Receipt冪等

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-008` at priority `P0`.

### Preconditions and data
Preconditions: 一筆Receipt已成功 Test data: SRC-A同event及完全相同內容

### Steps
重按確認／刷新重送／模擬網路重試

### Expected business result
回原成功或等效已處理結果；On Hand只增加一次；只有一組業務效果

### Acceptance criteria
Required evidence: 兩次回應、前後Bucket、Movement／來源 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-039 — POST-009 — FR-POST-008、AC-015；來源衝突

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-009` at priority `P0`.

### Preconditions and data
Preconditions: SRC-A已成功 Test data: 相同event但改SKU、數量、位置或Lot

### Steps
逐種重新提交

### Expected business result
均顯示來源／冪等衝突；不接受新版亦不重做舊版；數量無新增

### Acceptance criteria
Required evidence: 衝突訊息、Bucket／Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-040 — POST-010 — FR-POST-004／006、AC-017；Issue全有或全無

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-010` at priority `P0`.

### Preconditions and data
Preconditions: 有有效Reservation及Allocation Test data: 指定兩個Allocation，其中一行不足／過期／變Quarantined

### Steps
從Fulfillment確認整筆Issue

### Expected business result
整筆拒絕；所有行On Hand、Reservation、Allocation不變；不自動改選Lot或部分出貨

### Acceptance criteria
Required evidence: 出貨錯誤、各行前後數量／狀態 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-041 — POST-011 — FR-POST-004；Issue正常效果

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-011` at priority `P0`.

### Preconditions and data
Preconditions: 有10 Reserved／Allocated Test data: Issue 6 EA

### Steps
確認發貨，查看Inventory及來源

### Expected business result
指定Lot／Bin扣6；Reservation Consumed加6、Outstanding減6；Movement、來源及Audit完整

### Acceptance criteria
Required evidence: 發貨、Reservation、Bucket、Movement／Audit Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-042 — POST-012 — NFR-009；回應遺失與安全恢復

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-012` at priority `P0`.

### Preconditions and data
Preconditions: 可模擬提交後逾時 Test data: SRC-A Receipt或Issue

### Steps
提交後得到逾時；依畫面指引以Source／Request ID查結果，再用同ID重試

### Expected business result
能判定未完成或已完成；已完成只顯示同一結果且不重複數量；未完成可安全重試

### Acceptance criteria
Required evidence: 逾時、查詢結果、重試、前後數量 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-043 — POST-013 — AC-016、NFR-006；失敗時完整回滾

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `POST-013` at priority `P0`.

### Preconditions and data
Preconditions: 技術團隊已在UAT隔離環境啟用批准的單次DB／Audit故障情境；UAT人員不直接操作DB Test data: 一筆多行Receipt或Issue及SRC-B

### Steps
由正常下游頁提交；看到失敗後查來源、所有相關Buckets、Reservation及Movement／Audit頁

### Expected business result
來源明確顯示失敗；所有行Balance、Movement、Reservation及成功Audit效果均不出現；關閉故障後可以新合法請求成功

### Acceptance criteria
Required evidence: 技術故障情境編號、錯誤畫面、所有前後業務查詢、system test證據 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-044 — RES-001 — FR-RES-001、BR-016；Warehouse級預留

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `RES-001` at priority `P0`.

### Preconditions and data
Preconditions: W-A有ATP 20 Test data: Reservation 10，SKU-EXP／W-A

### Steps
從Sales建立Reservation並開詳情

### Expected business result
成功預留10；只指定SKU／Warehouse及來源，不要求Lot／Bin；Original 10、Outstanding 10

### Acceptance criteria
Required evidence: Sales結果、Reservation詳情、Stock摘要 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-045 — RES-002 — FR-RES-002、AC-020；全有或全無

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `RES-002` at priority `P0`.

### Preconditions and data
Preconditions: ATP 5 Test data: 請求6

### Steps
建立Reservation

### Expected business result
整筆拒絕並顯示ATP不足；不建立5的部分Reservation；Reserved仍不變

### Acceptance criteria
Required evidence: 錯誤、Reservation列表、Stock摘要 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-046 — RES-003 — FR-RES-009、AC-019；並發競爭

### Business objective and actor
Actor: 兩個U-DOWN. Validate the business outcome of legacy case `RES-003` at priority `P0`.

### Preconditions and data
Preconditions: ATP恰為10 Test data: 兩個來源同時各預留7

### Steps
兩個瀏覽器盡量同時提交並刷新結果

### Expected business result
最多一個成功；另一個得到清楚不足／衝突；最終Reserved不超過10且無負ATP

### Acceptance criteria
Required evidence: 兩邊結果、最終Stock／Reservation Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-047 — RES-004 — FR-RES-003；Reservation冪等／衝突

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `RES-004` at priority `P0`.

### Preconditions and data
Preconditions: 可重送來源事件 Test data: SRC-A同內容／異數量

### Steps
同event重送，再用同event改數量

### Expected business result
同內容只一筆Reservation；異內容衝突且不改原預留

### Acceptance criteria
Required evidence: 兩次結果、Reservation詳情、Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-048 — RES-005 — FR-RES-004～006、AC-021；耗用／釋放／取消

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `RES-005` at priority `P0`.

### Preconditions and data
Preconditions: Reservation 10 Test data: Issue 6、Release 4；另有部分耗用後Cancel

### Steps
依正式來源完成Issue及Release／Cancel

### Expected business result
10＝Consumed 6＋Released 4＋Outstanding 0；Cancel只釋放未耗用量，不復活已耗用量；沒有來源事件不會自行消失

### Acceptance criteria
Required evidence: 來源事件、Reservation數量歷程、Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-049 — RES-006 — FR-RES-008、AC-010／011；ATP資格

### Business objective and actor
Actor: U-DOWN. Validate the business outcome of legacy case `RES-006` at priority `P0`.

### Preconditions and data
Preconditions: 同SKU有Available、Quarantined、Damaged、Expired、Low-life Test data: 正常銷售用途

### Steps
查ATP並嘗試預留超過合資格Available的數量

### Expected business result
ATP排除四類不合資格庫存；請求被全數拒絕，不以Total On Hand誤導

### Acceptance criteria
Required evidence: Stock摘要、錯誤、Reservation列表 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-050 — RES-007 — FR-ALLOC-001／008；跨多Bucket分配

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `RES-007` at priority `P0`.

### Preconditions and data
Preconditions: Reservation 12；同Lot跨BIN-A1／A2及另一Lot Test data: 5＋4＋3

### Steps
取得候選並建立多行Allocation

### Expected business result
總Allocation 12不超過Outstanding；可跨Lot／Bin；Allocation後On Hand不變而Allocated／可用量正確

### Acceptance criteria
Required evidence: 候選、Allocation詳情、前後Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-051 — RES-008 — FR-ALLOC-002／003、AC-023；FEFO／FIFO建議

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `RES-008` at priority `P0`.

### Preconditions and data
Preconditions: LOT-EARLY／MID／LATE及無Expiry批次 Test data: 需求量跨多Lot

### Steps
開Allocation drawer查看建議並採用

### Expected business result
有Expiry按最早到期、Lot、Bin穩定排序；無Expiry批次按First Receipt Date；顯示剩餘天數及可分配量

### Acceptance criteria
Required evidence: 候選順序、已建立Allocation Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-052 — RES-009 — FR-ALLOC-004、AC-024；一般人偏離FEFO

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `RES-009` at priority `P0`.

### Preconditions and data
Preconditions: 最早Lot仍足夠 Test data: 選較晚LOT-LATE

### Steps
提交Allocation

### Expected business result
被拒絕並指出應選Lot；不保存Allocation；On Hand／Reservation不變

### Acceptance criteria
Required evidence: 選擇、拒絕、Allocation／Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-053 — RES-010 — FR-ALLOC-004／010、AC-025；合法例外

### Business objective and actor
Actor: U-FEFO. Validate the business outcome of legacy case `RES-010` at priority `P0`.

### Preconditions and data
Preconditions: 較晚Lot仍符合所有資格 Test data: LOT-LATE＋REASON

### Steps
查看建議差異，填原因並提交

### Expected business result
成功；Audit可見建議Lot、實選Lot、Expiry、數量、actor、reason及來源

### Acceptance criteria
Required evidence: 候選、確認、Allocation、Audit Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-054 — RES-011 — SEC-006、AC-026；例外不可繞資格

### Business objective and actor
Actor: U-FEFO. Validate the business outcome of legacy case `RES-011` at priority `P0`.

### Preconditions and data
Preconditions: 有Expired、Low-life、Quarantined、Damaged、Inactive Bin及外倉Lot Test data: 各不合資格候選

### Steps
逐一嘗試override分配

### Expected business result
全部拒絕並顯示具體不可用原因；沒有例外Allocation

### Acceptance criteria
Required evidence: 拒絕畫面及Allocation列表 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-055 — RES-012 — FR-ALLOC-007／009、AC-027；stale候選

### Business objective and actor
Actor: 兩名U-OP. Validate the business outcome of legacy case `RES-012` at priority `P0`.

### Preconditions and data
Preconditions: A已載入候選；B改變bucket或Lot狀態 Test data: B先耗用／轉狀態／停用Bin

### Steps
A提交Allocation或Issue

### Expected business result
409／衝突；保留A輸入但要求重新載入候選；不自動改選；Issue零扣貨

### Acceptance criteria
Required evidence: A／B時間線、衝突、前後Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-056 — RES-013 — FR-ALLOC-006／007；釋放與重新分配

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `RES-013` at priority `P1`.

### Preconditions and data
Preconditions: 已有未Issue Allocation Test data: 從LOT-EARLY改至LOT-MID

### Steps
釋放、重新分配，再查Movement

### Expected business result
Reservation及Allocation更新且On Hand不變；無Issue Movement；重複操作不造成超配

### Acceptance criteria
Required evidence: 前後詳情、Stock、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-057 — MOVE-001 — FR-MOVE-001／003、AC-028；Bin Move

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-001` at priority `P0`.

### Preconditions and data
Preconditions: BIN-A1有LOT-EARLY 10 EA Test data: 移4至BIN-A2

### Steps
提交Bin Move並查看兩Bin與Movement

### Expected business result
來源6、目的4、W-A及Total On Hand不變；產生同operation ID的Out／In Movement

### Acceptance criteria
Required evidence: 確認、兩Bin前後、成對Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-058 — MOVE-002 — FR-MOVE-002／004、AC-029；維度不變

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-002` at priority `P0`.

### Preconditions and data
Preconditions: W-A／W-B及多狀態bucket Test data: 同Bin、跨倉、改SKU／Lot／Expiry／Status

### Steps
逐一嘗試Bin Move

### Expected business result
同Bin及跨倉被拒絕並提示正確流程；不可藉Move改其他維度；數量不變

### Acceptance criteria
Required evidence: 輸入、錯誤、前後Bucket Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-059 — MOVE-003 — FR-MOVE-005～007、AC-022；保障與鎖

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-003` at priority `P0`.

### Preconditions and data
Preconditions: 來源有Reservation；另有Counting Bin Test data: 可移不破壞保障／會破壞保障／數量0、小數、過量

### Steps
逐一提交Move

### Expected business result
合法同倉Move成功且Reserved不變；破壞保障、非法數量、過量或Counting Bin全數拒絕且不部分移動

### Acceptance criteria
Required evidence: 各結果、Reservation、兩Bin、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-060 — MOVE-004 — FR-TRANSFER-001／002、AC-030；Draft

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-004` at priority `P1`.

### Preconditions and data
Preconditions: W-A、W-B Active Test data: 多行SKU／Lot／source Bin／qty

### Steps
建立Draft、修改完整lines、取消另一Draft

### Expected business result
Draft建立／修改／取消均不改On Hand、Reserved或In Transit；取消狀態與原因清楚

### Acceptance criteria
Required evidence: Draft歷程及前後Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-061 — MOVE-005 — FR-TRANSFER-003～005、AC-031；Dispatch

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-005` at priority `P0`.

### Preconditions and data
Preconditions: 合法多行Draft Test data: W-A→W-B

### Steps
查看整張警告並Dispatch

### Expected business result
提交時重驗；所有行一次成功；來源各Bin扣減、In Transit等量增加、目的仍0；狀態變In Transit

### Acceptance criteria
Required evidence: 確認頁、Transfer、來源／目的Stock、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-062 — MOVE-006 — FR-TRANSFER-004／005；Dispatch全有或全無

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-006` at priority `P0`.

### Preconditions and data
Preconditions: 多行Draft，其中一行不足／被預留／Bin被鎖 Test data: 3個有效行＋1個失效行

### Steps
Dispatch

### Expected business result
整張拒絕並標示失效行及下一步；所有來源、In Transit、目的均不變

### Acceptance criteria
Required evidence: 錯誤、每行前後Stock、Transfer狀態 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-063 — MOVE-007 — FR-TRANSFER-006；In Transit不可用

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-007` at priority `P0`.

### Preconditions and data
Preconditions: 已Dispatch Transfer Test data: In Transit各行

### Steps
嘗試修改／取消Transfer；在Reservation／Allocation／Issue中搜尋在途量

### Expected business result
修改／取消按鈕不可用且直接提交被拒絕；在途量不計ATP且不可被預留／分配／出庫

### Acceptance criteria
Required evidence: Transfer、按鈕／錯誤、Stock／候選 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-064 — MOVE-008 — FR-TRANSFER-007／008、AC-032；完整Receive

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-008` at priority `P0`.

### Preconditions and data
Preconditions: In Transit Transfer Test data: 每行選W-B Active Bin

### Steps
逐行選目的Bin並Receive

### Expected business result
全部In Transit清零；目的Bins增加原SKU／Lot／Expiry／Status；來源歷史不變；狀態Received

### Acceptance criteria
Required evidence: Receive頁、Transfer、三方數量、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-065 — MOVE-009 — FR-TRANSFER-007；目的Bin所有權

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-009` at priority `P0`.

### Preconditions and data
Preconditions: In Transit W-A→W-B Test data: 漏選、重複行、BIN-A1、BIN-INACTIVE

### Steps
逐種提交Receive

### Expected business result
每行必須恰一次指定W-B Active Bin；非法選擇全張拒絕；In Transit保持完整

### Acceptance criteria
Required evidence: 輸入／錯誤、Transfer及Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-066 — MOVE-010 — FR-TRANSFER-008、AC-034；不支援部分收貨

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-010` at priority `P0`.

### Preconditions and data
Preconditions: In Transit含多行 Test data: 只選部分行或改小數量

### Steps
Receive

### Expected business result
明確拒絕部分Receive；不清除任何In Transit、不增加目的庫存；提示完整收貨後以差異流程處理

### Acceptance criteria
Required evidence: 錯誤、In Transit及目的前後 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-067 — MOVE-011 — FR-TRANSFER-009；隔離收貨

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-011` at priority `P1`.

### Preconditions and data
Preconditions: In Transit Transfer Test data: 一行保持原Status；一行選Quarantined＋原因

### Steps
Receive整張

### Expected business result
合法成功；指定行進Quarantined且有原因；其他行保持Dispatch狀態；ATP正確

### Acceptance criteria
Required evidence: Receive選擇、目的Bucket、Audit Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-068 — MOVE-012 — FR-TRANSFER-010；短少／損壞處理

### Business objective and actor
Actor: U-OP／U-ADJ. Validate the business outcome of legacy case `MOVE-012` at priority `P1`.

### Preconditions and data
Preconditions: 實收有短少或損壞 Test data: 完整Receive後的Adjustment／Status Transfer

### Steps
先完整Receive，再依授權差異流程更正

### Expected business result
Dispatch／Receive歷史不被修改；差異以新關聯Movement處理；Transfer及最終庫存可對賬

### Acceptance criteria
Required evidence: Transfer歷史、差異操作、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-069 — MOVE-013 — FR-TRANSFER-011／012、AC-033；冪等與狀態

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `MOVE-013` at priority `P0`.

### Preconditions and data
Preconditions: 可重送Dispatch及Receive Test data: 同event同內容／異內容

### Steps
各階段重按、逾時後查詢及重送，再改payload重送

### Expected business result
同內容只一次數量效果；異內容衝突；Draft／In Transit／Received／Cancelled及操作者／時間正確

### Acceptance criteria
Required evidence: 每次結果、Transfer歷程、三方數量 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-070 — ADJ-001 — FR-ADJUST-001、AC-035；權限

### Business objective and actor
Actor: U-OP／U-ADJ. Validate the business outcome of legacy case `ADJ-001` at priority `P0`.

### Preconditions and data
Preconditions: 同一bucket可調整 Test data: 合法Adjustment／Status／Reversal

### Steps
U-OP及U-ADJ分別提交

### Expected business result
U-OP全部拒絕且零變更；U-ADJ仍須完成對應重新認證及原因才可提交

### Acceptance criteria
Required evidence: 角色、拒絕／確認、前後Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-071 — ADJ-002 — FR-ADJUST-002／004；正Adjustment

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `ADJ-002` at priority `P1`.

### Preconditions and data
Preconditions: Active SKU／Bin Test data: 七項批准的reason category、文字；另測未知category及`OTHER`缺詳細說明

### Steps
由Adjustment頁逐一提交

### Expected business result
固定allowlist及有詳細說明的`OTHER`可進入高風險確認；未知category或`OTHER`說明不足被拒絕；成功操作建立Adjustment Movement／Audit且不可代替正常Receipt

### Acceptance criteria
Required evidence: 確認、拒絕、前後Bucket、Movement／Audit Status remains `NOT_RUN`; mandatory and blocking. Automation PASS never substitutes for human acceptance.

## UAT-072 — ADJ-003 — FR-ADJUST-003、AC-036；負數保障

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `ADJ-003` at priority `P0`.

### Preconditions and data
Preconditions: Bucket有5 EA Test data: 減5、減6、0、負輸入、小數

### Steps
逐一提交負Adjustment

### Expected business result
減5可至0；其餘拒絕；不得負數或部分扣除；Reservation保障亦重新驗證

### Acceptance criteria
Required evidence: 各結果、前後Bucket、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-073 — ADJ-004 — FR-ADJUST-005、AC-037；Status Transfer

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `ADJ-004` at priority `P0`.

### Preconditions and data
Preconditions: Available 10 Test data: 4轉Quarantined

### Steps
提交並查三種狀態

### Expected business result
Available 6、Quarantined 4、Total仍10；Warehouse／Bin／SKU／Lot不變；成對Movement及原因完整

### Acceptance criteria
Required evidence: 確認、狀態前後、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-074 — ADJ-005 — FR-ADJUST-006、AC-038；Reservation保障

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `ADJ-005` at priority `P0`.

### Preconditions and data
Preconditions: Available 10且Reserved 10 Test data: 轉4至Damaged

### Steps
提交Status Transfer

### Expected business result
被拒絕並提示先釋放／重新安排Reservation；所有Bucket及Reserved不變

### Acceptance criteria
Required evidence: 錯誤、Stock／Reservation前後 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-075 — ADJ-006 — FR-ADJUST-007；恢復與Expired

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `ADJ-006` at priority `P0`.

### Preconditions and data
Preconditions: Quarantined／Damaged及LOT-EXPIRED Test data: 轉回Available＋REASON

### Steps
分別提交並查ATP

### Expected business result
合法狀態轉換成功且需原因；Expired Lot即使Status為Available仍顯示Expired且不進正常ATP

### Acceptance criteria
Required evidence: Status結果、Expiry／ATP、Audit Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-076 — ADJ-007 — FR-ADJUST-008、AC-018；不可改歷史與Reversal

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `ADJ-007` at priority `P0`.

### Preconditions and data
Preconditions: 已過帳Receipt／Issue／可反向Movement Test data: 修改／刪除／Reversal

### Steps
嘗試編輯或刪除，再合法反向

### Expected business result
原Movement不可修改／刪除；Reversal建立相反新Movement並互相連結；當下規則仍須通過

### Acceptance criteria
Required evidence: 被拒絕操作、原／反向Movement、Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-077 — ADJ-008 — FR-ADJUST-008／009；不可反向情境

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `ADJ-008` at priority `P0`.

### Preconditions and data
Preconditions: Movement已反向或目前餘量不足／受Reservation保障 Test data: 同一Reversal event

### Steps
反向兩次或在會破壞規則時反向

### Expected business result
明確拒絕已反向／不允許類型／當下不變量；原歷史及數量不變；同event重送不重複

### Acceptance criteria
Required evidence: 拒絕、Movement鏈、前後Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-078 — ADJ-009 — BR-007／038、AC-039；版本衝突

### Business objective and actor
Actor: 兩名U-ADJ. Validate the business outcome of legacy case `ADJ-009` at priority `P0`.

### Preconditions and data
Preconditions: 同Bucket version=N Test data: A／B各減相同存貨

### Steps
兩個頁面同時載入；A先提交；B後提交

### Expected business result
只有一個成功；另一個顯示版本／並發衝突並要求刷新；不出現負數或無聲覆蓋

### Acceptance criteria
Required evidence: 兩邊結果、最終Bucket、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-079 — COUNT-001 — FR-COUNT-001；建立Draft

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `COUNT-001` at priority `P1`.

### Preconditions and data
Preconditions: W-A有多個Active Bins Test data: BIN-A1／A2

### Steps
以wizard選Warehouse及Bins建立、修改Draft

### Expected business result
Draft成功且不鎖Bin、不改庫存；scope只可含同一Warehouse Active Bins

### Acceptance criteria
Required evidence: Wizard、Draft詳情、Stock狀態 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-080 — COUNT-002 — FR-COUNT-001、BR-033；唯一Active scope

### Business objective and actor
Actor: 兩名U-OP. Validate the business outcome of legacy case `COUNT-002` at priority `P0`.

### Preconditions and data
Preconditions: A已為BIN-A1建立未完成Stocktake Test data: B另建包含BIN-A1的Stocktake

### Steps
B提交，或兩人近乎同時開始

### Expected business result
最多一個未完成Stocktake可擁有該Bin；另一個被拒絕並顯示可見Stocktake number

### Acceptance criteria
Required evidence: 兩邊結果、Stocktake列表 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-081 — COUNT-003 — FR-COUNT-002；Start快照與鎖

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `COUNT-003` at priority `P0`.

### Preconditions and data
Preconditions: Draft含BIN-A1／A2 Test data: 已知所有bucket

### Steps
確認Start警告並開始Counting；刷新／重新登入後查看

### Expected business result
保存開始時帳面快照；頁面持續顯示兩Bins被哪個Stocktake鎖定、時間及進度；重新載入後仍存在

### Acceptance criteria
Required evidence: Start確認、Counting頁、刷新後畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-082 — COUNT-004 — FR-COUNT-003、AC-040；鎖覆蓋

### Business objective and actor
Actor: 各操作角色. Validate the business outcome of legacy case `COUNT-004` at priority `P0`.

### Preconditions and data
Preconditions: BIN-A1處於Counting Test data: Receipt、Issue、Bin Move、Transfer、Adjustment、Status、Reversal

### Steps
從每個正式入口嘗試改BIN-A1 On Hand

### Expected business result
全部被拒絕，顯示Stocktake number及下一步；BIN-A1數量、Movement不變；不影響未鎖BIN-B1

### Acceptance criteria
Required evidence: 各入口錯誤、兩Bin前後、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-083 — COUNT-005 — FR-COUNT-004；錄入語意

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `COUNT-005` at priority `P1`.

### Preconditions and data
Preconditions: Counting lines Test data: 0、未輸入、未發現、正整數；負數／小數

### Steps
逐行輸入、保存、刷新

### Expected business result
0與空白清楚不同；未發現為明確動作；合法值保留；負數／小數field-level拒絕；進度正確

### Acceptance criteria
Required evidence: 輸入、錯誤、刷新後line／進度 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-084 — COUNT-006 — FR-COUNT-005／006；帳外bucket

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `COUNT-006` at priority `P1`.

### Preconditions and data
Preconditions: Counting時發現快照沒有的貨 Test data: 合法SKU／Lot／Status；重複dimension；無效資料

### Steps
掃描／搜尋並加入帳外bucket

### Expected business result
合法新增以snapshot 0出現且只一行；重複或不合SKU／Lot／Bin規則被拒絕

### Acceptance criteria
Required evidence: 搜尋／新增、line列表、錯誤 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-085 — COUNT-007 — FR-COUNT-011；並發點算

### Business objective and actor
Actor: 兩名U-OP. Validate the business outcome of legacy case `COUNT-007` at priority `P0`.

### Preconditions and data
Preconditions: 同一line version=N Test data: A輸入8、B輸入9

### Steps
兩人同時載入；A保存後B保存

### Expected business result
A成功；B收到版本衝突且不能覆蓋；B刷新看到8並再決定

### Acceptance criteria
Required evidence: 兩邊畫面、衝突及最終line Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-086 — COUNT-008 — FR-COUNT-007；Ready完整性

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `COUNT-008` at priority `P0`.

### Preconditions and data
Preconditions: 有未完成lines Test data: 部分counted、部分blank／not found

### Steps
嘗試Ready，再完成全部並重提

### Expected business result
未完成時拒絕並可定位；全部完成後成功進READY；顯示總行、未完成、盤盈、盤虧、零差異；一般操作員不能再改

### Acceptance criteria
Required evidence: Review摘要、拒絕／成功、edit狀態 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-087 — COUNT-009 — FR-COUNT-008、AC-041；Posting全有或全無

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `COUNT-009` at priority `P0`.

### Preconditions and data
Preconditions: READY含多個差異；其中一行在提交時失效 Test data: 合法device-password及REASON

### Steps
提交Post

### Expected business result
整次拒絕；所有差異均不生效、無部分Movement；Bins繼續鎖定；畫面不誤報完成並給下一步

### Acceptance criteria
Required evidence: Post錯誤、各Bucket、Movement、lock提示 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-088 — COUNT-010 — FR-COUNT-008／009、AC-042；成功Posting

### Business objective and actor
Actor: U-ADJ. Validate the business outcome of legacy case `COUNT-010` at priority `P0`.

### Preconditions and data
Preconditions: READY全部有效 Test data: 多盤盈／盤虧／零差異lines

### Steps
重新認證並Post，查看結果

### Expected business result
所有差異一次成功；每行帳面、實數、差異及Movement清楚且不可改；Audit完整；所有owner Bins解鎖

### Acceptance criteria
Required evidence: Post、結果／CSV、Movement／Audit、可操作Bin Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-089 — COUNT-011 — FR-COUNT-010、AC-043；取消

### Business objective and actor
Actor: U-OP. Validate the business outcome of legacy case `COUNT-011` at priority `P0`.

### Preconditions and data
Preconditions: COUNTING／READY Stocktake Test data: Password＋REASON

### Steps
取消後對Bin做合法Move或Receipt

### Expected business result
狀態Cancelled；沒有差異Movement或數量變化；所有該Stocktake Bins可靠解鎖並可再操作

### Acceptance criteria
Required evidence: 取消、Movement、前後Stock、後續成功操作 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-090 — COUNT-012 — FR-COUNT-011；重送及逾時

### Business objective and actor
Actor: U-OP／U-ADJ. Validate the business outcome of legacy case `COUNT-012` at priority `P0`.

### Preconditions and data
Preconditions: 可重送Start／save／Post Test data: 同request同內容／異內容

### Steps
重按、逾時查詢後重試

### Expected business result
不重複快照、line或variance Movement；異內容或舊version衝突；唯一最終狀態可查

### Acceptance criteria
Required evidence: 每次結果、Stocktake歷程、Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-091 — COUNT-013 — FR-COUNT-012；差異摘要及CSV

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `COUNT-013` at priority `P1`.

### Preconditions and data
Preconditions: Draft／Counting／Ready／Posted資料 Test data: status、warehouse、date、variance filters

### Steps
查詢列表、詳情、進度、差異及下載CSV

### Expected business result
畫面與CSV的scope、snapshot、actual、variance、Movement IDs一致；無盲盤多輪／隊伍分派等範圍外功能

### Acceptance criteria
Required evidence: 畫面、CSV及人工對照 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-092 — OPEN-001 — FR-OPEN-001；模板

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-001` at priority `P1`.

### Preconditions and data
Preconditions: PRE_GO_LIVE Test data: Opening template

### Steps
下載模板並查看欄位說明

### Expected business result
UTF-8模板只含Warehouse、Bin、SKU、Lot、Expiry、Stock Status、Base Quantity；不含Pack、Reserved、成本或自訂欄

### Acceptance criteria
Required evidence: 下載檔及欄位清單 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-093 — OPEN-002 — FR-OPEN-002；Precheck不入帳

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-002` at priority `P0`.

### Preconditions and data
Preconditions: PRE_GO_LIVE且初始庫存已記錄 Test data: CSV-VALID

### Steps
Upload並等待Precheck READY，不按Confirm

### Expected business result
顯示row／quantity摘要及短file hash；Precheck期間／完成後Stock、Lot、Movement均無業務變化

### Acceptance criteria
Required evidence: Upload狀態、摘要、前後查詢／Movement Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-094 — OPEN-003 — FR-OPEN-002／003／005、AC-044；錯誤定位

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-003` at priority `P0`.

### Preconditions and data
Preconditions: PRE_GO_LIVE Test data: CSV-INVALID各類錯誤

### Steps
分別Upload：未知／重複header、額外欄、公式、encoding、重複dimension、無效位置／SKU／Lot／qty

### Expected business result
Job不可Confirm；以row、field及繁中安全訊息定位；任何一個錯誤均令整份零庫存效果；不直接輸出未過濾原始CSV

### Acceptance criteria
Required evidence: 每類錯誤、job狀態、前後Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-095 — OPEN-004 — FR-OPEN-002／003；Tracking與所有權

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-004` at priority `P0`.

### Preconditions and data
Preconditions: PRE_GO_LIVE Test data: none帶多餘Lot、batch缺Lot、batch_expiry缺Expiry、serial、跨倉／Inactive Bin、矛盾Lot

### Steps
Upload及Precheck

### Expected business result
每種依同一Inventory規則被row／field阻擋；整份不可確認且無部分建立Lot／Stock

### Acceptance criteria
Required evidence: 錯誤結果、Stock／Lot前後 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-096 — OPEN-005 — NFR-004；10k列上限與進度

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-005` at priority `P1`.

### Preconditions and data
Preconditions: 系統測試容量證據已通過 Test data: 10,000及10,001 data rows

### Steps
Upload並觀察進度／完成時間

### Expected business result
10,000列於目標10分鐘內完成Precheck＋後續Posting處理時間；10,001明確拒絕；UI不中斷且可離頁再回看

### Acceptance criteria
Required evidence: 時間線、job進度／結果 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-097 — OPEN-006 — FR-OPEN-004、SEC-004／010；Confirm授權

### Business objective and actor
Actor: U-MGMT／U-ADJ. Validate the business outcome of legacy case `OPEN-006` at priority `P0`.

### Preconditions and data
Preconditions: READY job Test data: 無權、錯密碼、錯裝置、缺reason、合法U-MGMT

### Steps
逐一Confirm

### Expected business result
只有U-MGMT以有效device-password及reason可進POSTING；adjust不隱含mgmt；其他均零庫存效果

### Acceptance criteria
Required evidence: 各確認／拒絕、job及Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-098 — OPEN-007 — FR-OPEN-004、AC-045；成功開帳

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-007` at priority `P0`.

### Preconditions and data
Preconditions: READY且precheck仍有效 Test data: CSV-VALID

### Steps
Confirm並等待完成，再對賬

### Expected business result
所有rows一次成功；Opening Movements、來源、Audit及各Bucket數量一致；沒有部分成功

### Acceptance criteria
Required evidence: Job result、Stock／Movement／Audit、對賬表 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-099 — OPEN-008 — OPENINGPRECHECKSTALE；提交重驗

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-008` at priority `P0`.

### Preconditions and data
Preconditions: READY後SKU／Bin／Lot規則或Inventory control版本改變 Test data: 原CSV-VALID

### Steps
Confirm舊Precheck

### Expected business result
不硬用舊結果；Job回READY或明確stale狀態並要求重新Precheck；零Opening數量效果

### Acceptance criteria
Required evidence: 狀態時間線、錯誤、前後Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-100 — OPEN-009 — NFR-009；worker逾時／重啟

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-009` at priority `P0`.

### Preconditions and data
Preconditions: 可模擬畫面逾時或worker重啟 Test data: READY job／同Confirm request

### Steps
Confirm後遇逾時；離頁再回job，以同ID查詢／重試

### Expected business result
可安全判定最終狀態；已完成不重複Movement；未完成可恢復或顯示可行動錯誤；沒有半份Opening

### Acceptance criteria
Required evidence: 逾時、job歷程、重試、對賬 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-101 — OPEN-010 — Opening cancel

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-010` at priority `P1`.

### Preconditions and data
Preconditions: UPLOADED／READY／FAILED job Test data: Password＋REASON

### Steps
取消可取消狀態；對VALIDATING／POSTING／COMPLETED嘗試取消

### Expected business result
合法狀態變Cancelled且不入帳；處理中／已完成不可取消或改寫結果

### Acceptance criteria
Required evidence: 各job狀態、取消／拒絕、Stock Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-102 — OPEN-011 — FR-OPEN-006、AC-046；Go-Live不可逆

### Business objective and actor
Actor: U-MGMT. Validate the business outcome of legacy case `OPEN-011` at priority `P0`.

### Preconditions and data
Preconditions: Data Freeze後舊系統無新異動；Warehouse／Operations Lead已對賬；DB帳號已分離且backup／restore rehearsal通過 Test data: Sam的Device-password＋REASON

### Steps
由Sam確認Go-Live，再刷新、重新登入及嘗試Upload／Confirm

### Expected business result
只有完整gate及Sam簽核才進LIVE；狀態永久LIVE，upload／confirm入口隱藏且直接嘗試亦拒絕；提示後續用Adjustment／Stocktake；沒有返回PRE_GO_LIVE操作

### Acceptance criteria
Required evidence: Data Freeze、對賬、DB／rehearsal證據、Sam簽核、LIVE頁、拒絕結果 Status remains `NOT_RUN`; mandatory and blocking. Automation PASS never substitutes for human acceptance.

## UAT-103 — OPEN-012 — FR-OPEN-007；結果保留與最小資料

### Business objective and actor
Actor: U-MGMT／U-VIEW. Validate the business outcome of legacy case `OPEN-012` at priority `P1`.

### Preconditions and data
Preconditions: 有成功／失敗／已清理檔案job Test data: job result、row errors、Audit

### Steps
查job、結果、Movement、Audit；於result file過期後再開

### Expected business result
操作者、hash、reason、結果、來源及Movement可追；不保存／顯示整份原CSV、密碼或token；檔案清理後job／audit仍可查並明確說明

### Acceptance criteria
Required evidence: Job／result／Audit及過期畫面 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-104 — REPORT-001 — FR-REPORT-001；Stock匯出

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `REPORT-001` at priority `P0`.

### Preconditions and data
Preconditions: 已知多Warehouse／Bin／Lot／Status庫存 Test data: 組合filters及多頁結果

### Steps
在Stock畫面設定filter後匯出

### Expected business result
CSV與畫面使用同一filters、Base UOM、時間／狀態語意；全結果無漏重；總數可對賬

### Acceptance criteria
Required evidence: filter URL、畫面、CSV及對賬 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-105 — REPORT-002 — FR-REPORT-002～005；營運清單

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `REPORT-002` at priority `P1`.

### Preconditions and data
Preconditions: 有各類Movement、Reservation、Allocation、In Transit、Expiry資料 Test data: date／type／source／location／days等filters

### Steps
分別查Movement、Active Reservation、Transfer及Expiry並匯出

### Expected business result
每張清單可定位來源及關鍵數量；In Transit收發可對賬；Expiry按狀態分開；畫面與CSV一致

### Acceptance criteria
Required evidence: 各清單、來源、CSV Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-106 — REPORT-003 — FR-REPORT-006／007、SEC-009／014；CSV安全

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `REPORT-003` at priority `P0`.

### Preconditions and data
Preconditions: 欄位含以`=`,`+`,`-`,`@`開頭的合法顯示文字 Test data: 所有五種export

### Steps
匯出並以試算表安全開啟

### Expected business result
可疑內容不執行公式；檔案不含成本、銀行／付款、token、內部path、未授權資料或未定義預測

### Acceptance criteria
Required evidence: 原畫面、CSV文字及開啟結果 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-107 — REPORT-004 — FR-AUDIT-001～003；端到端追溯

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `REPORT-004` at priority `P0`.

### Preconditions and data
Preconditions: 各類成功業務操作各一筆 Test data: Warehouse、Bin、Reservation、Allocation、Movement、Transfer、Adjustment、Stocktake、Opening、FEFO

### Steps
從業務物件開Audit／Movement／來源，再反向返回

### Expected business result
actor、action、object、before／after摘要、reason、time、request／correlation、source及outcome可追；每個數量變化雙向可定位

### Acceptance criteria
Required evidence: 每類畫面及trace worksheet Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-108 — REPORT-005 — FR-AUDIT-004／007；失敗與拒絕可調查

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `REPORT-005` at priority `P0`.

### Preconditions and data
Preconditions: 已執行越權、版本、冪等、鎖及規則拒絕 Test data: 對應request IDs

### Steps
由授權Audit／營運查詢查看失敗記錄

### Expected business result
可辨識失敗／拒絕類型、actor、時間及correlation；沒有虛假成功庫存效果；不洩漏敏感payload／未授權詳情

### Acceptance criteria
Required evidence: 原錯誤與Audit／營運查詢 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-109 — REPORT-006 — BR-041、NFR-012；歷史快照

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `REPORT-006` at priority `P0`.

### Preconditions and data
Preconditions: 已完成Movement後修改SKU code／name、Lot顯示或Bin name並停用master Test data: 修改前後值

### Steps
查舊Movement、來源及當前master

### Expected business result
舊交易歷史顯示快照不被回寫；仍可連到當前物件並分清歷史／現況；停用／不能刪除不破壞至少7年seeded歷史

### Acceptance criteria
Required evidence: 修改前後、舊Movement／來源 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-110 — REPORT-007 — UX §10、design §7.8；可用性／無障礙

### Business objective and actor
Actor: U-VIEW／U-OP. Validate the business outcome of legacy case `REPORT-007` at priority `P1`.

### Preconditions and data
Preconditions: 核心頁面及長SKU／Lot／Bin資料 Test data: 375／768／1024／1440px、鍵盤、screen reader smoke

### Steps
完成filter、detail、Transfer receive、count及高風險confirm

### Expected business result
無不可操作溢出；heading／label／aria、焦點、error summary及dialog focus正確；icon有名稱；狀態不只靠色；長字安全顯示

### Acceptance criteria
Required evidence: 四寬度截圖、鍵盤／輔助技術記錄 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-111 — REPORT-008 — NFR-001／002／005、AC-049；使用者效能

### Business objective and actor
Actor: U-VIEW. Validate the business outcome of legacy case `REPORT-008` at priority `P1`.

### Preconditions and data
Preconditions: 系統測試容量基線及20 user p95證據已通過 Test data: 精確SKU／barcode、常用Stock、FEFO候選

### Steps
在UAT環境按既定腳本重複常用操作並記畫面完成時間

### Expected business result
常用結果一般於2秒目標內可用且正確；列表server pagination；loading清楚且頁面可操作；正式p95以系統測試報告簽核

### Acceptance criteria
Required evidence: UAT時間樣本、system performance report Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-112 — REPORT-009 — NFR-009／011；依賴與重試體驗

### Business objective and actor
Actor: U-VIEW／操作角色. Validate the business outcome of legacy case `REPORT-009` at priority `P0`.

### Preconditions and data
Preconditions: 可模擬非必要下游／必要Item或DB依賴暫時不可用 Test data: 查詢及一筆寫入

### Steps
下游不可用時查Inventory；必要依賴不可用時提交；恢復後按指引重試

### Expected business result
非必要Supplier／Customer等故障不令正常查詢失敗；必要依賴故障明確fail closed且零變更；loading、dependency unavailable、retry狀態可區分

### Acceptance criteria
Required evidence: 故障時間線、畫面、前後數量 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

## UAT-113 — REPORT-010 — NFR-010、AC-050；復原與最終對賬

### Business objective and actor
Actor: Product Owner／Warehouse Lead. Validate the business outcome of legacy case `REPORT-010` at priority `P0`.

### Preconditions and data
Preconditions: 技術團隊已在隔離環境完成backup／restore並提供報告 Test data: 恢復後的Balance、Movement、Reservation、Transfer、Stocktake、Audit摘要

### Steps
按抽樣清單在恢復環境查詢並與復原報告／來源單據對賬

### Expected business result
抽樣數量、位置、狀態、Movement及來源一致；沒有孤兒、重複或遺失；技術AC-050證據與業務查詢相符

### Acceptance criteria
Required evidence: 技術復原報告、UAT抽樣／簽核 Status remains `NOT_RUN`; mandatory and blocking. A baseline-bound business decision is required, and automation PASS never substitutes for human acceptance.

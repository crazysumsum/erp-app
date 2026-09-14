# Purchasing & Receiving Management Technical Test Specification

## Status and execution boundary

所有案例均為規格，狀態一律 `NOT_RUN`。`REVIEW_AND_ALIGN` 不授權任何產品實作、測試執行、Technical Acceptance 或 UAT 簽核。本規格由 `03_design_spec.md` §10～§11 的測試設計整理而成，作為 `08_traceability.json` 的 `TC` 節點；§10～§11 的逐項測試清單仍是細節來源。實際執行必須綁定不可變基線，並在 `TEST_AND_VERIFY` 模式下進行。

所有案例的 suite 為 `purchasing-technical`，在專案的隔離測試環境及專用測試 MySQL 8.0 執行；零發現案例、被 skip 的案例、缺失證據或基線改變一律視為 `BLOCKED`／`NOT_READY`，不得記為 PASS。


## 案例索引

| TC | 名稱 | 主要設計來源 |
| --- | --- | --- |
| TC-001 | Authentication、授權與職責分離 | DES-006（§5）、DES-007（§6） |
| TC-002 | 金額、UOM與數量純算法 | DES-003（§2.8） |
| TC-003 | PO Draft、編號、版本與快照完整性 | DES-004（§3）、DES-005（§4）、DES-006（§5）、DES-009（§8） |
| TC-004 | 審批流程與PO生命週期狀態機 | DES-004（§3）、DES-005（§4）、DES-006（§5）、DES-009（§8） |
| TC-005 | GR Draft與收貨驗證政策 | DES-004（§3）、DES-005（§4）、DES-006（§5）、DES-008（§7）、DES-009（§8） |
| TC-006 | 原子GR確認、Inventory過帳與冪等 | DES-001（§1、§2.1～§2.4）、DES-002（§2.5～§2.7）、DES-004（§3）、DES-006（§5）、DES-009（§8） |
| TC-007 | 真並發、失敗注入與恢復 | DES-002（§2.5～§2.7）、DES-004（§3）、DES-009（§8）、DES-011（§10～§11） |
| TC-008 | Receipt Reversal不變量 | DES-005（§4）、DES-006（§5）、DES-009（§8） |
| TC-009 | Migration、約束、trigger與保留 | DES-005（§4）、DES-012（§12～§13） |
| TC-010 | 查詢、CSV、列印projection與Audit一致性 | DES-006（§5）、DES-008（§7）、DES-009（§8） |
| TC-011 | Provider／Consumer契約測試 | DES-001（§1、§2.1～§2.4）、DES-006（§5）、DES-011（§10～§11） |
| TC-012 | 效能、容量、備份還原與對賬 | DES-005（§4）、DES-009（§8）、DES-011（§10～§11）、DES-012（§12～§13） |

## Formal definitions

## TC-001 — Authentication、授權與職責分離

### Preconditions and data
十個角色帳戶（含只讀、越權、已撤權及System Administrator）、兩棵不同owner的PO／GR樹、惡意邊界輸入及高強度重新認證裝置，全部在隔離測試環境。

### Steps
驗證未登入拒絕、permission不繼承、指定審批人以外不可批准、自我批准拒絕、提交點actor freshness重驗、ID替換與跨owner存取、strict schema、注入／XSS／CSV公式payload及敏感資料脫敏。

### Expected result
所有未授權或非法路徑fail closed並回穩定安全錯誤，沒有任何PO／GR／Inventory狀態變更，Audit保留足夠但不含敏感資料的調查證據。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-002 — 金額、UOM與數量純算法

### Preconditions and data
HKD（2位小數）與JPY（0位小數）currency、1 BOX＝24 EA等有效Pack UOM、換算後非整數的UOM、零單價、負單價及接近系統上限的數量。

### Steps
以純函式驗證UOM換算、Base Quantity正整數與上限、Unit Price 4位小數界限、Line Amount ROUND_HALF_UP、PO Total為已round Line Amount之和，以及decimal string進出與整數縮放計算。

### Expected result
所有算式結果與規格一致且不出現binary float誤差；任何非整數Base Quantity、負價或超上限輸入在計算層即被拒絕。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-003 — PO Draft、編號、版本與快照完整性

### Preconditions and data
Active／Suspended／Archived Supplier、可採購與不可採購SKU、有效與失效UOM、Currency／Payment Term目錄，以及兩個並發寫入者。

### Steps
驗證月度序號transaction安全與不可重用、Draft整張原子保存、lines新增／修改／排序／刪除、optimistic version衝突、複製PO重新驗證、確認時快照寫入，以及列表搜尋／filter／分頁與URL還原。

### Expected result
PO Number全公司唯一且取消後不重用；版本衝突拒絕無聲覆蓋；確認後快照固定，後續主資料變更不回寫歷史。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-004 — 審批流程與PO生命週期狀態機

### Preconditions and data
審批參數ON／OFF兩組基線、提交人與指定審批人帳戶、審批期間被撤權或停用的審批人，以及已收貨與未收貨的Confirmed PO。

### Steps
驗證參數決定直接Confirmed或Pending Approval、Approval snapshot不可變、自我批准與非指定人批准拒絕、拒絕／撤回回到Draft、Confirmed撤回與取消的前置條件、Close Remaining逐line關閉及狀態一致推導。

### Expected result
狀態只能沿合法轉換前進；設定變更不改寫已提交PO；已有Confirmed Receipt的PO無法撤回、取消或改寫商業資料。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-005 — GR Draft與收貨驗證政策

### Preconditions and data
Tracking為none／batch／batch_expiry／serial的SKU、LOT-VALID／LOW／EXPIRED／CONFLICT、W-A／W-B與其Active／Inactive Bin、三種Stock Status及具／不具效期例外權限的收貨人。

### Steps
驗證Draft只可由Confirmed／Partially Received PO建立、一個PO Line拆多details、同dimension重複details拒絕、UOM與Tracking必填規則、Lot／Expiry一致性、Expired拒絕、Minimum Receipt Life阻擋與合法例外、位置ownership及超收原因必填。

### Expected result
所有非法組合在Draft保存或確認前被拒絕且不留部分更新；Serial SKU fail closed不降級；效期例外無法繞過Expired、位置、Tracking或權限規則。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-006 — 原子GR確認、Inventory過帳與冪等

### Preconditions and data
最多200 details的合法GR Draft、穩定source event ID、同ID同payload與同ID異payload版本，以及可注入失敗的Inventory batch contract。

### Steps
執行成功確認、重送、異payload衝突、逾時後以原ID安全重試，以及在state／movement／audit／commit各邊界注入失敗。

### Expected result
一個source event最多產生一次完整效果；任何注入失敗都收斂為GR保持Draft、PO progress不變且Inventory零變化；價格與Total不會傳入Inventory作數量或成本依據。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-007 — 真並發、失敗注入與恢復

### Preconditions and data
兩條以上真資料庫連線、共用同一PO Line的兩張GR、同時進行的審批／撤回／Close／Reversal，以及可控制的worker重啟與回應遺失。

### Steps
以真barrier驗證lost update、重複入庫、重複line progress、鎖順序deadlock、回應遺失後的結果查詢，以及重啟後的domain operation恢復。

### Expected result
並發操作只有一個合法贏家且無無聲覆蓋；超收判定依提交次序成立並各自要求原因；恢復後可由PO／GR／Request ID查明唯一結果。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-008 — Receipt Reversal不變量

### Preconditions and data
已確認GR及其Inventory Movement、部分已被反向的details、被Reservation或Allocation占用的庫存、正在Stocktake Counting的Bin，以及具／不具`inventory.adjust`的actor。

### Steps
驗證部分與全部反向、超過未反向數量拒絕、Inventory當下規則重驗、原GR與Movement不可變、PO Net Received與狀態重算，以及重送與異payload衝突。

### Expected result
任一detail不可反向時整次拒絕且零部分效果；Fully Received PO反向後回到Confirmed／Partially Received，已人工Closed的PO不自動重開。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-009 — Migration、約束、trigger與保留

### Preconditions and data
專用測試MySQL 8.0資料庫、空schema及已有資料的schema、不可變歷史表與嘗試UPDATE／DELETE的語句。

### Steps
在真資料庫forward migrate全部purchasing切片，驗證FK、UNIQUE、NOT NULL、generated column、index、trigger不可變保護、7年保留設計及rollback影響。

### Expected result
所有migration可在MySQL 8.0順序執行；不可變歷史無法由一般路徑改寫；約束在應用層失效時仍構成第二層防護。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-010 — 查詢、CSV、列印projection與Audit一致性

### Preconditions and data
跨Phase的PO／GR／Outstanding資料、TEXT-RISK文字、已停用的Supplier／SKU／Currency，以及支援版本的Chrome、Edge及Safari。

### Steps
驗證列表與filter語意、Outstanding計算、CSV欄位穩定性與公式注入防護、A4列印使用確認時快照、Audit查詢，以及Web／CSV／列印／整合的數量、金額、狀態與時間語意一致。

### Expected result
四個輸出面得到同一組server正本數值；CSV與Audit不含密碼、token、SQL、stack、內部路徑或Supplier銀行資料；主資料後續變更不改寫歷史文件。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-011 — Provider／Consumer契約測試

### Preconditions and data
Supplier purchasing contract、Item committed receipt lookup、Inventory purchase receipt batch與partial reversal contract的真實提供者實作或明確BLOCKED記錄。

### Steps
以consumer-driven contract test驗證各provider的輸入輸出語意、狀態變化後的既有承諾處理、批量查詢避免N+1，以及provider不可用時的fail closed行為。

### Expected result
契約語意與雙方設計一致；任何provider能力未落地時契約測試明確BLOCKED而非PASS；provider不可用時寫入fail closed且不使用過期資料猜測。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

## TC-012 — 效能、容量、備份還原與對賬

### Preconditions and data
100,000 SKUs、10,000 Suppliers、50,000 POs（每張最多100 lines）、100,000 GRs（每張最多200 details）的合成容量基線，20名並行使用者，以及一份完整備份。

### Steps
量測精確查找與常用列表p95、100 lines PO確認與200 details GR確認的互動時間、lookup的N+1行為，並在隔離環境restore後執行只讀對賬命令。

### Expected result
常用查詢p95少於2秒且結果正確；還原後PO、Approval、GR、line progress、Inventory Movement與Audit可完整對賬，差異不得以直接修改掩蓋。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `purchasing-technical`。
每一條對應案例必須在當前已批准基線上被觀察為 PASS；零發現、skip 或過時證據阻擋 Gate。

### Cleanup
只移除本案例自己建立的合成資料及 runtime 資源（測試 schema 內的 PO／GR／Reversal／Audit 記錄、測試 Lot 與 Bin 結餘）；
保留已脫敏的報告，不得接觸共用或正式資料。

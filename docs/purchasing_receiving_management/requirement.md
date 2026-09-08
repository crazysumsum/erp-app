# Purchasing & Receiving Management 業務需求書

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 模組 | Purchasing & Receiving Management |
| 文件類型 | Business Requirement Document（BRD） |
| 版本 | 0.1 Draft |
| 日期 | 2026-09-08 |
| 目標用戶 | 中小型批發企業的採購、審批、收貨及庫存管理人員 |
| 主要範圍 | Purchase Order、可配置審批、分批／超額收貨、Inventory入庫及業務追溯 |
| UI／UX基準 | `docs/frontend-design.md` |

### 0.1 文件目的

本文件定義 Purchasing & Receiving Management 的業務目標、能力邊界、角色權限、資料概念、狀態、流程、功能需求、業務規則、整合要求、非功能要求及驗收準則，作為後續系統設計、開發任務、測試案例及驗收的共同依據。

本文件以業務需求為主，不指定資料庫表、API路徑或程式碼架構；這些內容由後續 `design_spec.md` 定義，但不得降低本文件的業務規則及驗收準則。

### 0.2 業務背景

本ERP主要服務化妝品、零食、健康食品及飲品等零售消耗品的批發業務。Supplier、Item／SKU及Inventory已分別形成主資料與庫存規格，但仍需要一個正式的採購及收貨流程，把「向誰採購、買甚麼、以甚麼價格採購、實際收到甚麼、貨品放在哪個Warehouse／Bin」連接起來。

Purchasing負責記錄對供應商的正式採購意圖及商業條件；Receiving負責記錄實際到貨，確認SKU、數量、Lot、Expiry Date、Warehouse、Bin及Stock Status，並在確認後原子地過帳至Inventory。兩者必須共享穩定來源、數量及狀態語意，避免無PO收貨、重複入庫、超收無原因、修改已收歷史或庫存與採購單據不一致。

### 0.3 已確認業務意圖

- 採購直接由Purchase Order開始，不包括Purchase Requisition、RFQ或報價比較。
- PO審批使用模組參數控制，預設不需要審批；開啟後須由另一名具權限者批准，禁止自建自批。
- 一張PO可分多次收貨；每次只按實收資料增加Inventory，未收數量保留至後續收貨或人工關閉。
- 允許超額收貨，不設百分比容差或額外審批，但收貨人必須輸入原因並留下完整追溯。
- PO必須記錄幣別及每行採購單價，並計算行金額及總額；本期不處理稅項。
- 所有供應商收貨必須引用有效PO，不提供無PO收貨。
- 未有任何收貨的已確認PO可撤回後修改；開始收貨後不可改寫已收歷史，只能繼續收貨或關閉未收部分。
- 一個PO Line可拆成多個收貨明細，分別指定Lot、Expiry Date、Warehouse、Bin及Stock Status。
- Goods Receipt先保存為Draft；確認後整張原子過帳Inventory，且不得直接修改或刪除。

為避免未確認細節被當成既定決策，本文件在§18.2明列系統編號、單PO收貨、零單價、交期／預設Warehouse及Receipt Reversal五項簡化假設；§18.3另列Supplier／SKU狀態變化、金額精度、編號、列印及上線資料等尚待確認Gate。

### 0.4 文件版本紀錄

| 版本 | 日期 | 說明 |
| --- | --- | --- |
| 0.1 Draft | 2026-09-08 | 根據已確認訪談建立PO、審批、收貨、超收、Inventory整合及追溯需求。 |

---

## 1. 業務目標與成功指標

### 1.1 業務目標

| 編號 | 業務目標 |
| --- | --- |
| OBJ-01 | 建立單一、可追溯的Purchase Order來源，取代非正式訊息或試算表採購記錄。 |
| OBJ-02 | 確保只有有效Supplier及可採購SKU可加入新PO，並保存交易時主資料快照。 |
| OBJ-03 | 以簡單可配置方式控制PO是否需要另一人審批，不強迫小企業使用複雜流程。 |
| OBJ-04 | 支援符合日常營運的分批、短收及超額收貨，而不犧牲原因與數量追溯。 |
| OBJ-05 | 在收貨確認時準確記錄每個SKU／Lot實際存放的Warehouse及Bin。 |
| OBJ-06 | 保證PO、Goods Receipt、Inventory Movement及Audit之間可雙向追溯且數量一致。 |
| OBJ-07 | 防止重複確認、部分過帳、無聲覆蓋或網路重試造成重複庫存。 |
| OBJ-08 | 保持本期簡單實用，不引入與核心採購收貨無直接關係的財務或供應鏈功能。 |

### 1.2 建議成功指標

| 編號 | 指標 | 目標 |
| --- | --- | ---: |
| KPI-01 | 已確認Goods Receipt具有有效PO來源 | 100% |
| KPI-02 | 已確認收貨明細具有準確Warehouse及Bin | 100% |
| KPI-03 | PO／Receipt／Inventory數量可對賬率 | 100% |
| KPI-04 | 超額收貨具有原因、操作者及時間 | 100% |
| KPI-05 | 需要審批的PO自我批准事件 | 0 |
| KPI-06 | 相同收貨確認重送造成重複入庫事件 | 0 |
| KPI-07 | 已確認Goods Receipt被直接修改或刪除事件 | 0 |
| KPI-08 | 一般PO及收貨列表查詢p95 | 少於2秒 |
| KPI-09 | 收貨確認後Inventory結果於畫面可追溯 | 100% |

指標是上線驗收及營運監控目標，不應為達標而刪除失敗、衝突、撤回或超收歷史。

---

## 2. 範圍與Capability Map

### 2.1 本期範圍

- Purchase Order列表、搜尋、查看、新增、修改、提交、批准、拒絕、撤回、取消及關閉。
- PO幣別、付款條件快照、SKU、Purchase UOM、訂購數量、採購單價、行金額及總額。
- PO審批參數及待審批工作清單。
- Goods Receipt列表、查看、建立Draft、修改Draft、取消Draft及確認收貨。
- 一張PO多次收貨，以及一個PO Line拆成多個Lot／Expiry／Warehouse／Bin／Status收貨明細。
- 正常、短收及超額收貨；超收原因及追溯。
- Item Tracking、UOM及Minimum Receipt Life規則。
- Goods Receipt確認與Inventory Receipt的原子整合、冪等、逾時查詢及Reversal追溯。
- PO／Receipt營運查詢、CSV匯出、列印／可下載採購單及Audit。
- 繁體中文、響應式及WCAG 2.1 AA使用體驗。

### 2.2 本期不包含

- Purchase Requisition、內部請購、RFQ、詢價、比價、招標及供應商報價管理。
- 合約、價格表、數量折扣、回贈、促銷採購或自動選擇最低價供應商。
- 複雜多層、按金額／部門／類別的PO審批矩陣或代理審批。
- 採購稅碼、稅率、稅額、進口稅、關稅或任何稅務申報。
- Accounts Payable、Supplier Invoice、三方匹配、付款、銀行付款檔、外幣結算或會計分錄。
- Inventory成本、估值、Landed Cost、運費分攤、毛利或成本重估。
- 自動補貨、需求預測、MRP、安全庫存建議或自動產生PO。
- Supplier Return、Customer Return、退款、Credit Note或供應商索賠。
- 無PO收貨、合併多張PO成一張Goods Receipt、EDI、供應商Portal或流動原生App。
- 序號追蹤、分批Goods Receipt確認、盲收、質檢工作流或多層收貨審批。
- PO／Receipt CSV批量匯入、自訂報表設計器、Dashboard或排程電郵。

### 2.3 Capability Map

| Capability ID | 名稱 | 責任 | 主要依賴 |
| --- | --- | --- | --- |
| PUR-CAP-01 | Purchase Order Master | PO header／lines、商業條件、版本、列表及詳情。 | Supplier、Item、Currency／Payment Terms、User |
| PUR-CAP-02 | PO Approval & Settings | 可配置審批、待辦、拒絕／撤回及職責分離。 | PUR-CAP-01、User／Authorization |
| PUR-CAP-03 | PO Lifecycle | 確認、修改邊界、取消、部分收貨、全收及人工關閉。 | PUR-CAP-01、PUR-CAP-02 |
| PUR-CAP-04 | Goods Receipt Draft | 依PO建立實收header／details及現場核對。 | PUR-CAP-03、Supplier、Item、Inventory master lookup |
| PUR-CAP-05 | Receiving Validation | UOM、Lot、Expiry、位置、Status、短收、超收及最低效期。 | PUR-CAP-04、Item、Inventory |
| PUR-CAP-06 | Inventory Posting | 整張收貨原子確認、冪等、Movement、Reversal及對賬。 | PUR-CAP-05、Inventory、Audit |
| PUR-CAP-07 | Inquiry & Reporting | 查詢、匯出、列印、來源連結及營運稽核。 | PUR-CAP-01～06 |

建議實作次序：`PUR-CAP-01 → PUR-CAP-02／03 → PUR-CAP-04／05 → PUR-CAP-06 → PUR-CAP-07`。Reporting及Audit不建立另一套可修改交易資料。

### 2.4 上下游依賴

| 系統／模組 | 關係 |
| --- | --- |
| User Management | 提供使用者、角色、權限、有效狀態、密碼再確認、device binding及操作者身份。 |
| Supplier Management | 提供Active Supplier、預設幣別、付款條件、訂購地址及Supplier－SKU軟性關係。 |
| Item Management | 提供SKU、採購資格、Base／Pack UOM、Tracking Policy、Shelf Life及Minimum Receipt Life。 |
| Inventory Management | 提供Warehouse／Bin、Lot規則、Stock Status及Receipt／Reversal過帳結果。 |
| Currency／Payment Terms | 提供有效幣別及付款條件目錄；本模組不維護匯率或結算。 |
| Accounts Payable | 未來可讀取PO／Receipt快照作Invoice matching；本期不建立應付或付款。 |
| Reporting／Audit | 只讀取正式PO、Receipt及來源關聯；不得改寫交易狀態或庫存。 |

---

## 3. 名詞定義

| 名詞 | 定義 |
| --- | --- |
| Purchase Order／PO | 對單一Supplier發出的正式採購單，包含SKU、數量、價格、幣別、交期及其他交易快照。 |
| PO Header | PO層級資料，例如Supplier、Currency、Payment Term、Order Date、Buyer及Status。 |
| PO Line | PO內一個SKU的訂購資料及數量／價格。 |
| Purchase UOM | PO交易使用的單位；必須可按Item有效換算轉成整數Base UOM。 |
| Base UOM Quantity | Inventory保存的最小庫存單位數量，必須為正整數。 |
| Outstanding Quantity | `max(Ordered Base Quantity - Net Confirmed Received Base Quantity, 0)`。 |
| Over-received Quantity | Net Confirmed Received超過Ordered的部分，不增加Ordered Quantity，但須記錄原因。 |
| Goods Receipt／GR | 引用一張PO的實際到貨單據；Draft不影響Inventory，Confirmed才過帳。 |
| Receipt Detail | 一個PO Line的一次實收分拆，包含數量、Lot、Expiry、Warehouse、Bin及Stock Status。 |
| Short Receipt | 當次實收少於可收或預期數量；不等同關閉未收部分。 |
| Close Remaining | 人工結束PO或PO Line的未收數量，不產生Inventory效果。 |
| Receipt Reversal | 對已確認收貨建立具關聯的新反向記錄；原Receipt及Inventory Movement不被修改。 |
| Source Reference | 連接PO、GR、Inventory Movement及Audit的穩定內部ID／事件ID。 |
| Approval Snapshot | PO提交時供審批人查看及批准的Supplier、lines、價格、總額、幣別及版本快照。 |

---

## 4. 角色、權限與責任

| 角色 | 主要責任 | 建議權限 |
| --- | --- | --- |
| 採購查閱者 | 查看PO、Goods Receipt、狀態、數量、金額及來源歷史。 | `purchasing.view` |
| 採購人員 | 建立及維護Draft PO、提交、撤回、取消及關閉剩餘數量。 | `purchasing.view`＋`purchasing.mgmt` |
| 採購審批人 | 批准或拒絕指定給自己的PO，不可自我批准。 | `purchasing.view`＋`purchasing.approval` |
| 收貨人員 | 依已確認PO建立／修改Goods Receipt Draft及確認收貨。 | `purchasing.view`＋`receiving.operation` |
| 效期例外人員 | 在剩餘效期不足時，以原因批准該次收貨例外。 | `receiving.operation`＋`receiving.expiry.override` |
| 庫存調整人員 | 在符合Inventory當下規則時執行Receipt Reversal或其他更正。 | `purchasing.view`＋`inventory.adjust` |
| 採購設定管理員 | 查看及修改PO審批參數。 | `purchasing.view`＋`purchasing.settings` |
| 系統管理員 | 配置角色權限及系統營運；不因角色名稱自動取得採購、審批、收貨或效期例外權限。 | 按職責明確指派 |

權限互不繼承。`purchasing.mgmt`不自動包含`purchasing.approval`、`receiving.operation`、`receiving.expiry.override`或`purchasing.settings`；前端隱藏按鈕不能取代後端授權。

---

## 5. 核心業務原則

1. **PO是唯一正常供應商收貨來源。** 不提供無PO收貨；Opening、Return及Adjustment使用其他正式流程。
2. **一張PO只屬一個Supplier及一種Currency。** 一張Goods Receipt只引用一張PO。
3. **交易以內部ID關聯。** PO／GR Number、Supplier／SKU Code只用於搜尋、顯示及外部交換。
4. **主資料只在提交時重驗。** 畫面曾經載入有效Supplier、SKU或Bin不代表稍後提交必定有效。
5. **交易快照不可回寫。** Supplier、SKU、UOM或付款預設日後變更，不改寫已確認PO或Receipt歷史。
6. **Draft不產生庫存。** 只有Confirmed Goods Receipt才增加Inventory。
7. **收貨記錄實際事實。** 一個PO Line可按不同Lot、Expiry、Warehouse、Bin及Status分拆。
8. **分批收貨不等於部分過帳。** 一張GR可以只收PO的一部分，但該張GR確認時必須整張全有或全無。
9. **允許超收但必須說明。** 超收不需要額外permission或容差百分比，但原因、數量、操作者、時間及來源必須可查。
10. **已確認歷史不可直接改寫。** 錯誤透過Receipt Reversal及新Receipt更正，不可edit／delete原記錄。
11. **審批保持簡單。** 只有一個布林參數；需要審批時一名不同使用者批准，不建立金額階梯或多層流程。
12. **價格與庫存分離。** PO保存採購價格及總額，但Inventory不接收價格作為數量或成本依據。
13. **數量以Base UOM對賬。** Purchase UOM只可使用有效整數換算，不得產生小數庫存。
14. **所有命令可安全重送。** 重試不能建立重複PO審批、GR或Inventory Movement。
15. **可追溯優先於刪除。** 有任何審批、收貨或下游引用的PO／GR不可永久刪除。

---

## 6. 資料概念模型

### 6.1 關係概覽

```text
Supplier 1 ──< Purchase Order 1 ──< PO Line
                         │                │
                         │                └── SKU／UOM／Price Snapshot
                         ├──< Approval Request
                         └──< Goods Receipt 1 ──< Receipt Detail
                                                     │
Warehouse 1 ──< Bin ─────────────────────────────────┤
SKU 1 ──< Lot／Expiry ───────────────────────────────┤
                                                     └── Inventory Movement／Audit
```

### 6.2 Purchase Order Header

| 欄位概念 | 必填 | 業務說明 |
| --- | --- | --- |
| PO ID | 是 | 系統內不可重用的穩定識別。 |
| PO Number | 是 | 系統產生、公司內唯一、可讀且一旦建立不可重用。 |
| Supplier | 是 | 建立時從Active Suppliers選擇；保存Supplier ID及必要快照。 |
| Supplier Snapshot | 是 | 至少保存Supplier Code、Name及選用訂購地址摘要。 |
| Currency | 是 | 預設Supplier Default Currency，可在Draft受控覆寫；確認後固定。 |
| Payment Term | 否 | 預設Supplier值，可在Draft覆寫；未填不阻擋PO但清楚提示。 |
| Order Date | 是 | 採購日期，遵守APP_TIME_ZONE。 |
| Expected Delivery Date | 否 | 整張PO預計到貨日；line可有不同日期時以line值優先。 |
| Default Receiving Warehouse | 否 | 收貨時的快速預設，不限制實際合法Warehouse。 |
| Buyer | 是 | 建立或負責採購的Active User。 |
| Supplier Reference | 否 | 供應商報價／確認號等外部文字，不作系統唯一識別。 |
| Status | 是 | Draft、Pending Approval、Confirmed、Partially Received、Fully Received、Closed或Cancelled。 |
| Subtotal／Total | 是 | 本期無稅及折扣，因此Total等於所有Line Amount總和。 |
| Version | 是 | 防止兩名使用者無聲覆蓋。 |
| Created／Updated／Confirmed Data | 是 | 操作者及時間。 |

### 6.3 Purchase Order Line

| 欄位概念 | 必填 | 業務說明 |
| --- | --- | --- |
| PO Line ID／Line Number | 是 | PO內穩定識別及顯示順序。 |
| SKU | 是 | 正式SKU ID及交易時Code／Name／Base UOM／Tracking快照。 |
| Supplier Item Reference | 否 | 從Supplier－SKU軟關係帶入，可在Draft修改顯示值。 |
| Purchase UOM | 是 | Base UOM或當下有效Pack UOM。 |
| UOM Factor | 是 | 確認時保存的正整數換算快照。 |
| Ordered Quantity | 是 | 以Purchase UOM輸入的正數量。 |
| Ordered Base Quantity | 是 | `Ordered Quantity × UOM Factor`，必須為正整數及不超系統上限。 |
| Unit Price | 是 | 以PO Currency表示；不得為負。零單價只在填寫原因後接受。 |
| Line Amount | 是 | Ordered Quantity乘Unit Price，依幣別金額規則計算。 |
| Expected Delivery Date | 否 | 覆寫header交期；不得早於Order Date，除非有合理歷史補錄規則。 |
| Line Note | 否 | 最小必要採購說明，不得用作結構化規則替代品。 |
| Received／Reversed／Net Received | 是 | 由Confirmed Receipt及Reversal推導，不可直接輸入。 |
| Outstanding／Over-received | 是 | 系統推導並分開顯示，不得以負Outstanding混合超收。 |
| Closed Remaining | 是 | 被人工關閉且不再收貨的數量及原因。 |

### 6.4 PO Approval Request

- 保存PO、提交版本、提交人、指定審批人、提交時間、決定、決定人、決定時間及原因。
- Approval Snapshot至少包含Supplier、PO lines、UOM、數量、單價、幣別、總額、付款條件及交期。
- 一張PO同時最多只有一個進行中Approval Request。
- 關鍵資料或版本改變後，舊申請不可繼續批准；須撤回或拒絕後重新提交。
- 已完成Approval歷史不可修改或刪除。

### 6.5 Goods Receipt Header

| 欄位概念 | 必填 | 業務說明 |
| --- | --- | --- |
| Receipt ID／GR Number | 是 | 系統內穩定ID及公司內唯一、不可重用的顯示編號。 |
| Purchase Order | 是 | 只可引用一張Confirmed或Partially Received PO。 |
| Supplier Snapshot | 是 | 從PO保存，不因Supplier日後修改而改寫。 |
| Receipt Date／Time | 是 | 實際確認收貨時間；Draft可填業務收貨日期。 |
| Supplier Delivery Note | 否 | 供應商送貨單號；用作搜尋及提示疑似重複，不作唯一冪等識別。 |
| Receiver | 是 | 建立／確認收貨的Active User。 |
| Status | 是 | Draft、Confirmed、Partially Reversed、Reversed或Cancelled。 |
| Notes | 否 | 整張收貨備註。 |
| Source／Request ID | 確認時是 | 連接Inventory過帳、重試及Audit。 |
| Version | 是 | 防止Draft或確認被過時畫面覆蓋。 |

### 6.6 Goods Receipt Detail

| 欄位概念 | 必填 | 業務說明 |
| --- | --- | --- |
| Receipt Detail ID／Line Number | 是 | 一張GR內穩定識別。 |
| PO Line | 是 | 必須屬於Receipt引用的PO。 |
| SKU／UOM Snapshot | 是 | 從PO Line帶入，不允許換成另一SKU。 |
| Received Quantity | 是 | 正數；可用Purchase UOM或Base UOM輸入並顯示換算。 |
| Received Base Quantity | 是 | 正整數，是PO及Inventory對賬基準。 |
| Warehouse／Bin | 是 | 實際存放位置；Bin必須屬於該Warehouse且提交時Active。 |
| Lot Number | 視Tracking | `none`不需要、`batch`必填、`batch_expiry`必填。 |
| Expiry Date | 視Tracking | `batch_expiry`必填；同SKU／Lot須與既有資料一致。 |
| Manufacture Date | 否 | 有值時須與Expiry及既有Lot一致。 |
| Stock Status | 是 | Available、Quarantined或Damaged，由收貨人明確選擇。 |
| Over-receipt Quantity／Reason | 視情況 | 超過PO Outstanding時自動計算；超收部分大於0時原因必填。 |
| Minimum Life Override | 視情況 | 剩餘效期不足時保存門檻、實際天數、權限及原因。 |
| Inventory Result | 確認後是 | Operation／Movement IDs及成功結果，用於雙向追溯。 |
| Reversed Quantity | 確認後推導 | 已被正式Reversal反向的Base Quantity。 |

### 6.7 金額、數量及快照

- PO只使用一種Currency；Line Price及Amount不得混用其他幣別。
- Unit Price需支援一般採購所需小數精度；實際精度及rounding由Currency規格及技術設計統一，不可使用浮點誤差計算。
- Unit Price不得為負；零單價代表贈品或免費樣品，必須填寫原因並稽核。
- 本期不計Discount、Tax、Freight、Landed Cost或匯率換算；Total等於Line Amount加總。
- Ordered、Received、Reversed、Outstanding及Over-received以Base UOM作對賬基準，同時保留原Purchase UOM及factor快照。
- SKU、Supplier、UOM、Currency、Payment Term及位置日後修改不得回寫已確認交易快照。

---

## 7. 狀態與核心流程

### 7.1 Purchase Order狀態

| 狀態 | 可修改商業資料 | 可提交審批 | 可收貨 | 終態 |
| --- | --- | --- | --- | --- |
| Draft | 是 | 是 | 否 | 否 |
| Pending Approval | 否；須先撤回 | 已在審批 | 否 | 否 |
| Confirmed | 否；未收貨時可撤回 | 不適用 | 是 | 否 |
| Partially Received | 否 | 不適用 | 是 | 否 |
| Fully Received | 否 | 不適用 | 否 | 是 |
| Closed | 否 | 不適用 | 否 | 是 |
| Cancelled | 否 | 不適用 | 否 | 是 |

### 7.2 PO狀態轉換

```text
Draft ── approval OFF / confirm ───────────────> Confirmed
Draft ── approval ON / submit ──> Pending Approval ── approve ──> Confirmed
                                     │     │
                                     │     └── reject ──> Draft
                                     └──────── withdraw ──> Draft

Confirmed（無收貨）── withdraw ──> Draft
Confirmed（無收貨）── cancel ────> Cancelled
Confirmed ── first partial receipt ──> Partially Received
Confirmed／Partially Received ── all ordered received ──> Fully Received
Partially Received ── close remaining ──> Closed
```

- Fully Received只代表Net Received已達每行Ordered Quantity；超收不把Ordered Quantity改大。
- 若部分line全收、部分line人工Close Remaining，PO最終為Closed而非Fully Received。
- Pending、Confirmed或Partially Received不可直接改回Draft，除已明確允許且沒有任何Confirmed Receipt的withdraw。
- 已有Confirmed Receipt的PO不可取消；必須完成其餘收貨或關閉剩餘量。

### 7.3 Goods Receipt狀態

| 狀態 | 可編輯 | 影響Inventory | 可取消／刪除 |
| --- | --- | --- | --- |
| Draft | 是 | 否 | 可取消；未引用Draft可按政策永久刪除 |
| Confirmed | 否 | 已過帳 | 不可取消／刪除；只可正式Reversal |
| Partially Reversed | 否 | 部分已反向 | 不可取消／刪除 |
| Reversed | 否 | 淨效果已全部反向 | 不可取消／刪除 |
| Cancelled | 否 | 否 | 歷史保留 |

### 7.4 標準業務流程

1. 採購人員從全部Active Suppliers中選擇Supplier；有SKU供貨紀錄或preferred標記者只作優先排序。
2. 建立Draft PO，輸入SKU、Purchase UOM、數量、價格、交期及交易快照。
3. 審批參數關閉時直接確認；開啟時選擇另一名審批人並提交。
4. PO成為Confirmed後，收貨人可從Outstanding lines建立Goods Receipt Draft。
5. 收貨人按實物分拆SKU／Lot／Expiry／Warehouse／Bin／Status，核對短收或超收原因。
6. 確認GR時重新驗證PO、Supplier／SKU用途、位置、Tracking、效期、權限及版本。
7. Receiving與Inventory Receipt在同一受控業務結果中完成；任一步失敗則整張GR不確認且庫存不變。
8. 系統更新PO Line Net Received／Outstanding／Over-received及PO狀態，並提供PO→GR→Inventory雙向追溯。
9. 未收數量可後續再收；確定不再收貨時由採購人員填原因Close Remaining。

---

## 8. 功能需求

### 8.1 Purchasing Settings

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-SET-001 | Must | 模組須提供獨立Purchasing Settings頁面，並預留日後增加經業務確認參數的空間。 |
| FR-SET-002 | Must | 本期只提供「Purchase Order需要審批」布林參數，預設為關閉。 |
| FR-SET-003 | Must | 只有`purchasing.settings`可查看及修改設定；修改須使用高風險重新認證並填寫原因。 |
| FR-SET-004 | Must | 參數關閉時，`purchasing.mgmt`可直接把完整Draft PO確認為Confirmed。 |
| FR-SET-005 | Must | 參數開啟時，Draft PO必須經另一名`purchasing.approval`使用者批准才可成為Confirmed。 |
| FR-SET-006 | Must | 設定變更只影響變更後新提交的PO；不得自動批准、拒絕或改寫已提交／已完成PO。 |
| FR-SET-007 | Must | 設定頁須顯示目前值、最後修改人／時間及變更歷史。 |

### 8.2 PO列表、搜尋與詳情

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-LIST-001 | Must | 系統須提供server-side分頁的PO列表，預設按最近更新時間排序。 |
| FR-LIST-002 | Must | 可按PO Number、Supplier Code／Name、SKU Code／Name及Supplier Reference搜尋。 |
| FR-LIST-003 | Must | 可按Status、Supplier、Buyer、Currency、Order Date、Expected Delivery Date及是否仍有Outstanding篩選。 |
| FR-LIST-004 | Must | 列表須顯示PO Number、Supplier、Order Date、Expected Delivery Date、Currency、Total、Received進度、Status及更新時間。 |
| FR-LIST-005 | Must | 使用者可從PO詳情查看header、lines、價格、數量、審批、Goods Receipts、Inventory結果及Audit摘要。 |
| FR-LIST-006 | Must | 每個PO Line須分開顯示Ordered、Net Received、Outstanding、Over-received及Closed Remaining Base Quantity。 |
| FR-LIST-007 | Must | Status及收貨風險須使用文字及icon label，不可只靠顏色。 |
| FR-LIST-008 | Should | 從指定SKU建立PO時，有供貨紀錄或preferred標記的Active Suppliers可排前，但其他Active Suppliers仍可搜尋及選擇。 |
| FR-LIST-009 | Must | 搜尋、filter、page及sort可由URL還原；URL不得包含密碼、token或審批認證內容。 |
| FR-LIST-010 | Must | 長PO、Supplier及SKU顯示須安全截斷並可查看完整值，不能令列表無法操作。 |

### 8.3 建立及修改Purchase Order

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-PO-001 | Must | `purchasing.mgmt`可建立Draft PO；PO Number由系統產生且公司內唯一。 |
| FR-PO-002 | Must | 新PO只可選擇提交時仍為Active的Supplier；沒有Supplier－SKU關係不得阻止選擇。 |
| FR-PO-003 | Must | 選擇Supplier後預設帶入Currency、Payment Term及訂購地址；使用者可在Draft覆寫為當時有效值。 |
| FR-PO-004 | Must | 一張PO只可使用一個Supplier及一種Currency。 |
| FR-PO-005 | Must | PO至少包含一個有效Line；每個Line必須指定可採購且適用本模組的SKU。 |
| FR-PO-006 | Must | Discontinued、Inactive或Archived而不可新採購的SKU不得加入或確認新PO；歷史PO仍保存快照。 |
| FR-PO-007 | Must | Supplier－SKU的Supplier Item Code、Purchase UOM、MOQ及Lead Time只作預設／提示，除非本文件另有明確規則，不構成白名單或硬性限制。 |
| FR-PO-008 | Must | Ordered Quantity須為正數；換算後Ordered Base Quantity必須為正整數且不超系統上限。 |
| FR-PO-009 | Must | Purchase UOM須為SKU Base UOM或當下有效Pack UOM，factor須為正整數。 |
| FR-PO-010 | Must | Unit Price必填且不得為負；零單價必須填寫原因並在確認／審批畫面清楚標示。 |
| FR-PO-011 | Must | 系統須計算每行Line Amount及PO Total；本期不得計算Tax、Discount、Freight或Landed Cost。 |
| FR-PO-012 | Must | 使用者可在Draft新增、修改、重新排序及刪除Lines；每次保存須原子地保存整張Draft。 |
| FR-PO-013 | Must | PO Header及Lines更新須使用版本控制；版本不一致時拒絕無聲覆蓋並要求重新載入。 |
| FR-PO-014 | Must | Draft保存或確認失敗時不得留下半張PO、重複Lines或錯誤Total。 |
| FR-PO-015 | Must | 同一建立或修改請求安全重送時不得建立重複PO或重複Lines；同一冪等識別不同內容須回衝突。 |
| FR-PO-016 | Should | 使用者可複製既有PO成為新Draft，但新PO須重新驗證Supplier、SKU、UOM、Currency及價格，且不得複製審批／收貨狀態。 |
| FR-PO-017 | Must | PO可保存非結構化line note及supplier reference，但不得以這些文字繞過SKU、UOM、數量、幣別或價格欄位。 |
| FR-PO-018 | Must | Supplier、SKU、UOM、Currency及Payment Term在確認或提交審批時須重驗，不只依賴Draft建立時狀態。 |

### 8.4 PO提交及審批

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-APPROVAL-001 | Must | 系統按PO提交當刻的審批參數決定直接Confirmed或建立Pending Approval。 |
| FR-APPROVAL-002 | Must | 需要審批時，提交人必須選擇另一名Active且具有`purchasing.approval`的使用者。 |
| FR-APPROVAL-003 | Must | 建立人／提交人即使同時有`purchasing.approval`亦不可批准自己的PO。 |
| FR-APPROVAL-004 | Must | Pending Approval須保存不可變Approval Snapshot及PO版本。 |
| FR-APPROVAL-005 | Must | 指定審批人可查看Supplier、lines、UOM、數量、價格、Total、Currency、Payment Term、交期、零價格及其他風險提示。 |
| FR-APPROVAL-006 | Must | 只有指定審批人可批准或拒絕該申請；拒絕必須填寫原因並令PO返回Draft。 |
| FR-APPROVAL-007 | Must | 批准須重新驗證PO版本、Supplier、SKU、UOM、Currency、提交人及審批人權限；任何條件失效均不得確認PO。 |
| FR-APPROVAL-008 | Must | 批准成功後PO直接成為Confirmed，不需要另一個發佈步驟。 |
| FR-APPROVAL-009 | Must | 提交人可在決定前撤回申請，PO返回Draft；撤回須留下歷史。 |
| FR-APPROVAL-010 | Must | 審批人被停用、撤權或不可用時不得自動批准；提交人可撤回後重新提交給另一名審批人。 |
| FR-APPROVAL-011 | Must | 同一提交／批准／拒絕／撤回請求重送不得產生重複狀態或Audit；同一ID不同內容須衝突。 |
| FR-APPROVAL-012 | Should | 提供「待我審批」列表及清楚待辦數量；本期不要求電郵、SMS或外部通知。 |

### 8.5 PO確認、撤回、取消及關閉

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-LIFE-001 | Must | Confirmed PO才可建立Goods Receipt Draft；Draft或Pending Approval不可收貨。 |
| FR-LIFE-002 | Must | Confirmed但從未有Confirmed Receipt的PO可由`purchasing.mgmt`填寫原因後撤回至Draft。 |
| FR-LIFE-003 | Must | 撤回後再次確認或審批須重新驗證及建立新狀態歷史；舊批准不自動復活。 |
| FR-LIFE-004 | Must | Draft、Pending Approval或從未收貨的Confirmed PO可按合法流程取消；取消須填寫原因。 |
| FR-LIFE-005 | Must | 已有任何Confirmed Receipt的PO不得取消或撤回至Draft。 |
| FR-LIFE-006 | Must | 第一張未完全滿足所有Lines的Confirmed Receipt令PO進入Partially Received。 |
| FR-LIFE-007 | Must | 所有Lines的Net Received均達Ordered Quantity時，PO自動進入Fully Received。 |
| FR-LIFE-008 | Must | Partially Received PO可由`purchasing.mgmt`填寫原因Close Remaining；已收歷史不變，未收量不產生Inventory效果。 |
| FR-LIFE-009 | Must | 可按line關閉未收數量；當所有lines均已全收或關閉時，若有任何Closed Remaining則PO為Closed。 |
| FR-LIFE-010 | Must | Fully Received、Closed及Cancelled為終態，日常介面不得重新開啟或改寫。 |
| FR-LIFE-011 | Must | PO Status、line progress及可用動作必須由Confirmed Receipt／Reversal及Close Remaining結果一致推導。 |
| FR-LIFE-012 | Must | 取消、撤回及Close Remaining均須使用當前版本，版本衝突時不得覆蓋較新收貨或狀態。 |

### 8.6 Goods Receipt Draft及現場錄入

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-GR-001 | Must | `receiving.operation`可從Confirmed或Partially Received PO建立Goods Receipt Draft。 |
| FR-GR-002 | Must | 一張Goods Receipt只可引用一張PO，Supplier由PO固定，不可在Receipt更換。 |
| FR-GR-003 | Must | Draft預設顯示所有可收PO Lines、Ordered、Net Received、Outstanding、UOM、Tracking及預計交期。 |
| FR-GR-004 | Must | 收貨人可只選擇本次實際到貨的部分PO Lines；未選Lines留待後續Receipt。 |
| FR-GR-005 | Must | 一個PO Line可建立多個Receipt Details，分別指定不同Lot、Expiry、Warehouse、Bin及Stock Status。 |
| FR-GR-006 | Must | 使用者可按SKU Code、Barcode或PO Line快速定位；找不到或多個不明確結果時不得靜默選擇。 |
| FR-GR-007 | Must | 選定Warehouse後只顯示其Active Bins；實際提交仍須重驗Bin ownership及狀態。 |
| FR-GR-008 | Must | Default Receiving Warehouse只作快速預設；收貨人可在有權限及有效資料下選擇其他Warehouse／Bin。 |
| FR-GR-009 | Must | Supplier Delivery Note為選填；重複值須提示同Supplier近期可能重複Receipt，但不單憑文字永久阻擋。 |
| FR-GR-010 | Must | Draft可保存及繼續修改，不影響PO Received數量或Inventory。 |
| FR-GR-011 | Must | Draft可取消；取消不產生Inventory Movement或改變PO收貨進度。 |
| FR-GR-012 | Must | Draft header／details須使用版本控制，兩名使用者以舊版本保存時不得無聲覆蓋。 |
| FR-GR-013 | Must | Draft保存須整張原子；任一detail驗證失敗不得留下部分更新。 |
| FR-GR-014 | Must | 一張GR內相同PO Line／Warehouse／Bin／Lot／Status的完全相同dimension不得出現重複details；須要求合併數量或修正輸入。 |
| FR-GR-015 | Should | Draft頁顯示本次總Base Quantity、每個Warehouse／Bin分布及超收／效期風險摘要。 |

### 8.7 收貨數量、Lot、效期及狀態驗證

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-VAL-001 | Must | Received Quantity須大於0，換算後Received Base Quantity須為正整數且不超系統上限。 |
| FR-VAL-002 | Must | Receipt只能使用PO Line保存的SKU；不可藉替換ID收另一SKU。 |
| FR-VAL-003 | Must | Receipt使用的UOM必須為PO／Item允許的Base或有效Pack UOM，並顯示換算後Base Quantity。 |
| FR-VAL-004 | Must | Tracking `none`不要求Lot／Expiry；`batch`要求Lot而Expiry選填；`batch_expiry`要求Lot及Expiry。 |
| FR-VAL-005 | Must | Tracking `serial`在本期須明確拒絕，不得降級為none或batch過帳。 |
| FR-VAL-006 | Must | 同一SKU／Lot的Expiry及Manufacture Date須與既有Inventory Lot一致，不因Warehouse／Bin不同而改變。 |
| FR-VAL-007 | Must | Expiry Date不得早於Receipt業務日期；Expired Lot不得正常Receipt。 |
| FR-VAL-008 | Must | SKU有Minimum Receipt Life時，系統須顯示門檻、實際剩餘日數及是否合格。 |
| FR-VAL-009 | Must | 低於Minimum Receipt Life時，一般收貨人被阻擋；持有`receiving.expiry.override`者填寫原因後方可確認。 |
| FR-VAL-010 | Must | 效期例外不允許收已Expired、Tracking資料矛盾、Inactive Bin或不適用SKU。 |
| FR-VAL-011 | Must | Stock Status只可選Available、Quarantined或Damaged，且須由收貨人明確決定。 |
| FR-VAL-012 | Must | 一張GR可同時包含不同Statuses；每個detail獨立保存狀態，不由Inventory猜測。 |
| FR-VAL-013 | Must | PO Outstanding不足不阻擋超收，但系統須明確計算本次Over-received Quantity並要求整張或每個受影響line的原因。 |
| FR-VAL-014 | Must | 超收原因須在確認前顯示於風險摘要；空白、過長或只有空格的原因不得接受。 |
| FR-VAL-015 | Must | 當次少收不自動關閉Outstanding，也不要求原因；關閉未收部分使用獨立Close Remaining流程。 |
| FR-VAL-016 | Must | PO、Supplier／SKU資格、UOM、Tracking、Lot、Expiry、Warehouse、Bin、Status、數量、超收原因、效期權限及使用者狀態均須在確認時重新驗證。 |

### 8.8 確認Goods Receipt及Inventory過帳

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-POST-001 | Must | 確認前須顯示PO、Supplier、每個SKU／Lot、位置、Status、數量、超收及效期例外摘要。 |
| FR-POST-002 | Must | 一張GR確認須全有或全無；任何detail或Inventory過帳失敗時，GR保持Draft且所有Inventory數量不變。 |
| FR-POST-003 | Must | 確認成功時須在同一受控交易結果更新GR、PO line progress、PO Status、Inventory Balance／Movement及必要Audit。 |
| FR-POST-004 | Must | 每個Receipt Detail須以正式Source Module、PO、GR、PO Line、Receipt Detail及Event ID呼叫Inventory Receipt。 |
| FR-POST-005 | Must | 相同確認請求／來源事件重送只可返回原結果或等效成功，不得重複增加Inventory。 |
| FR-POST-006 | Must | 相同來源識別搭配不同SKU、數量、Lot、位置或Status時須回衝突，不可採用新payload或再次過帳。 |
| FR-POST-007 | Must | 確認成功後GR不可編輯、取消或永久刪除，PO及Inventory頁可由來源連結返回GR。 |
| FR-POST-008 | Must | 確認失敗須向使用者顯示安全、可理解且可行動的錯誤；不得只令數量無聲不變。 |
| FR-POST-009 | Must | 網路逾時或回應遺失後，使用者可依GR／Request ID查明是否完成，再以相同ID安全重試。 |
| FR-POST-010 | Must | 確認時如PO被取消、關閉、撤回或版本已變，整張GR須拒絕且不得以舊畫面完成。 |
| FR-POST-011 | Must | 兩張GR同時收同一PO Line時，系統須正確累計Net Received及Over-received，不能lost update或產生重複line progress。 |
| FR-POST-012 | Must | Goods Receipt不傳遞Unit Price、PO Total、Tax或成本至Inventory作數量／成本依據；Inventory只保存必要來源及數量快照。 |
| FR-POST-013 | Must | Inventory依賴暫時不可用時，Receiving須fail closed；GR不得顯示Confirmed或部分更新PO。 |
| FR-POST-014 | Must | 確認完成後畫面須重新讀取server事實，顯示GR Number、Inventory結果、PO最新進度及可執行下一步。 |

### 8.9 Receipt Reversal及收貨更正

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-REV-001 | Must | 已確認GR錯誤不得直接修改或刪除；須由具`inventory.adjust`權限者建立關聯Receipt Reversal。 |
| FR-REV-002 | Must | Reversal須選擇一個或多個原Receipt Details、正整數反向數量及原因，不得超過尚未反向數量。 |
| FR-REV-003 | Must | Reversal必須再次通過Inventory當下On Hand、Reservation、Allocation、Lot、Bin、Status及Stocktake lock規則。 |
| FR-REV-004 | Must | Reversal成功須建立新反向Inventory Movement及Audit，原GR／Movement保持不可變。 |
| FR-REV-005 | Must | Reversal成功後須減少PO Line Net Received並重新計算Outstanding、Over-received及PO Status。 |
| FR-REV-006 | Must | 若Reversal令Fully Received PO再次出現Outstanding，PO回到Confirmed或Partially Received；若PO已人工Closed則保持Closed並顯示差異警告，不自動重開。 |
| FR-REV-007 | Must | 任一detail無法反向時，整個Reversal請求全數拒絕，不留下部分PO或Inventory效果。 |
| FR-REV-008 | Must | 相同Reversal重送不得重複扣減；同一事件ID不同內容須衝突。 |
| FR-REV-009 | Must | 物理退貨給Supplier不使用Receipt Reversal；Supplier Return屬未來獨立流程。 |
| FR-REV-010 | Must | Reversal後需要正確收貨時，使用者建立新的Goods Receipt；不得把原GR改成正確資料。 |

### 8.10 查詢、列印與匯出

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-REPORT-001 | Must | 系統須提供Goods Receipt列表，支援按GR Number、PO、Supplier、SKU、Status、Receipt Date、Warehouse及是否超收／效期例外篩選。 |
| FR-REPORT-002 | Must | GR詳情須顯示Supplier Delivery Note、所有Receipt Details、Inventory結果、Reversal、操作者及時間。 |
| FR-REPORT-003 | Must | 系統須提供PO Outstanding清單，按Supplier、SKU、Buyer、Expected Delivery Date及逾期狀態篩選。 |
| FR-REPORT-004 | Must | 系統須提供PO／GR CSV匯出，沿用畫面filters、穩定欄位、Currency、Purchase／Base UOM及統一時間格式。 |
| FR-REPORT-005 | Must | CSV須防止公式注入，並不得包含密碼、token、內部路徑、Supplier銀行資料或未授權資料。 |
| FR-REPORT-006 | Should | Confirmed PO提供適合列印或下載的採購單，清楚顯示Supplier、lines、UOM、數量、單價、總額、幣別、付款條件及交期。 |
| FR-REPORT-007 | Must | PO列印／下載使用確認時快照；Supplier或SKU日後修改不得改寫歷史文件。 |
| FR-REPORT-008 | Should | Supplier詳情可顯示近期PO／GR及SKU實際供貨紀錄連結，但Supplier Management不得重算採購結果。 |
| FR-REPORT-009 | Should | 完成Confirmed Receipt後可向Supplier Management更新最近供貨日期及軟性Supplier－SKU供貨紀錄，不自動設為preferred。 |
| FR-REPORT-010 | Must | 本期報表不計算Supplier績效分數、到貨準時率、採購成本趨勢或應付金額。 |

### 8.11 稽核與歷史

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-AUDIT-001 | Must | PO、Lines、Approval、Settings、Cancel、Withdraw、Close Remaining、GR、Over-receipt、Expiry Override及Reversal均須稽核。 |
| FR-AUDIT-002 | Must | Audit至少保存actor、action、object、before／after摘要、reason、time、request／correlation ID、source及outcome。 |
| FR-AUDIT-003 | Must | 每張Confirmed GR可追至PO、Receipt Details、Inventory Movements及Audit；亦可從Inventory來源反查PO／GR。 |
| FR-AUDIT-004 | Must | 成功業務寫入與必要Audit須保持一致；Audit失敗不得無聲完成審批、PO狀態或Inventory變更。 |
| FR-AUDIT-005 | Must | 失敗、拒絕、版本衝突、冪等衝突、越權、超收及效期例外須留下可調查但不洩漏敏感資料的記錄。 |
| FR-AUDIT-006 | Must | Audit及應用Log不得保存密碼、token、未過濾payload、SQL、stack或內部檔案路徑。 |
| FR-AUDIT-007 | Must | 已確認PO／GR、已完成Approval、Movement及Audit不得由一般使用者更新或刪除，並按公司政策至少保留7年。 |
| FR-AUDIT-008 | Should | 有權限使用者可按PO／GR Number、Supplier、actor、action、outcome及日期查詢歷史。 |

---

## 9. 業務規則

| 編號 | 業務規則 |
| --- | --- |
| BR-001 | 系統只服務單一公司；PO Number及GR Number以公司為唯一範圍。 |
| BR-002 | PO／GR以不可重用內部ID關聯；顯示Number、Code或Name不可作永久關聯。 |
| BR-003 | 一張PO只屬一個Supplier及一種Currency；一張GR只引用一張PO。 |
| BR-004 | 只有Active Supplier可加入或確認新PO；軟性Supplier－SKU關係不是白名單。 |
| BR-005 | preferred、alternative、stopped或歷史供貨只影響提示及排序，不可繞過Supplier／SKU狀態。 |
| BR-006 | Supplier沒有Payment Term、地址或銀行資料不阻止建立PO；缺項以提示處理。 |
| BR-007 | PO至少有一個有效Line，每個Line只包含一個SKU。 |
| BR-008 | 新PO只接受當下可採購SKU；Discontinued Sellable SKU可清售但不可新採購。 |
| BR-009 | Purchase UOM換算後Base Quantity必須為正整數；所有收貨及對賬以Base UOM為準。 |
| BR-010 | Ordered及Received Quantity不可為0、負數、小數Base UOM或超系統上限。 |
| BR-011 | Unit Price必填且不得為負；零價格必須填原因，但不改變Inventory數量規則。 |
| BR-012 | 本期PO金額不包括Tax、Discount、Freight、Landed Cost或匯率換算。 |
| BR-013 | PO確認時保存Supplier、SKU、UOM、Currency、Payment Term及價格快照；主資料後續修改不回寫歷史。 |
| BR-014 | 審批參數預設關閉；關閉時完整Draft可由採購人員直接Confirmed。 |
| BR-015 | 審批開啟時提交人與審批人必須不同，且審批人提交時及決定時均為Active並具權限。 |
| BR-016 | Approval以提交版本快照為準；關鍵資料改變後舊Approval失效。 |
| BR-017 | 批准直接令PO Confirmed；拒絕或撤回令PO返回Draft，不保留批准資格。 |
| BR-018 | Draft及Pending Approval不得建立或確認Goods Receipt。 |
| BR-019 | Confirmed但未有任何Confirmed Receipt的PO可撤回修改或取消。 |
| BR-020 | 已有Confirmed Receipt的PO不可撤回、取消或修改商業資料。 |
| BR-021 | Short Receipt只更新當次實收，Outstanding繼續保留，不自動Close。 |
| BR-022 | 超收不修改Ordered Quantity；Over-received獨立計算並要求原因。 |
| BR-023 | 任何具`receiving.operation`者可超收，不需額外超收permission，但不得省略原因或Audit。 |
| BR-024 | Close Remaining只結束未收承諾，不產生Inventory Movement或更改已收歷史。 |
| BR-025 | 一個PO Line可跨多次GR及多個Lot／Warehouse／Bin／Status收貨。 |
| BR-026 | 一張GR可只涵蓋部分PO Lines或Outstanding，但該GR確認時所有details必須全有或全無。 |
| BR-027 | Goods Receipt Draft不改PO Net Received、Inventory Balance或Movement。 |
| BR-028 | Confirmed Goods Receipt不可編輯、取消或刪除，只能由正式Reversal更正。 |
| BR-029 | Receipt Detail的SKU必須等於PO Line SKU；不得以別的SKU代收。 |
| BR-030 | 每個Confirmed Receipt Detail必須有Active Warehouse及屬於該Warehouse的Active Bin。 |
| BR-031 | Tracking none／batch／batch_expiry分別套用Item及Inventory的Lot／Expiry必填規則。 |
| BR-032 | Serial Tracking本期不受支援，PO確認或收貨時須fail closed。 |
| BR-033 | 同一SKU／Lot的Expiry及Manufacture Date在所有Warehouse／Bin保持一致。 |
| BR-034 | Expired Lot不可Receipt；低於Minimum Receipt Life只可由專門權限加原因例外。 |
| BR-035 | 效期例外不能繞過Expired、Tracking衝突、SKU資格、位置、數量或權限規則。 |
| BR-036 | Stock Status只有Available、Quarantined及Damaged，由Receiving明確提供。 |
| BR-037 | Supplier或SKU在PO確認後改變狀態不改寫既有PO；收貨提交仍按本文件及Provider contract重新驗證可否完成既有承諾。 |
| BR-038 | Supplier後續非Active時，既有Confirmed PO仍可查看。Suspended／Archived Supplier的在途到貨可在警告及原因下繼續收貨；Blocked Supplier的收貨安全預設為只可進Quarantined並填原因，最終處置列為上線前確認項。 |
| BR-039 | SKU後續不可新採購但既有Confirmed PO有未收貨時，Receiving須按Item purpose contract明確允許或拒絕，不得自行猜測或直接改PO。 |
| BR-040 | 每個狀態、數量、主資料、權限、版本及位置均以提交時事實為準。 |
| BR-041 | 相同來源／request重送只可產生一次業務效果；相同ID不同內容必須拒絕。 |
| BR-042 | 網路逾時後先按PO／GR／Request ID查結果，再決定是否使用同一ID重試。 |
| BR-043 | 並發建立、審批、撤回、收貨、關閉及Reversal不可採最後寫入者無聲覆蓋。 |
| BR-044 | PO Net Received等於所有Confirmed Receipt Base Quantity減成功Reversed Quantity。 |
| BR-045 | Outstanding不得為負；超過Ordered部分只顯示於Over-received。 |
| BR-046 | Reversal不代表Supplier Return；只更正錯誤收貨及相應Inventory效果。 |
| BR-047 | Reversal須按當下Inventory規則全有或全無，原GR及Movement保持不可變。 |
| BR-048 | UI、CSV、列印、整合及Audit使用相同Currency、UOM、數量、狀態及時間語意。 |
| BR-049 | 所有日期／時間遵守ERP統一政策及APP_TIME_ZONE；交換時間使用無歧義格式。 |
| BR-050 | Purchasing／Receiving不得直接改Inventory Balance，只能透過Inventory正式Receipt／Reversal能力。 |
| BR-051 | 本模組不得建立、保存或推導Supplier銀行帳戶、付款指示或會計分錄。 |
| BR-052 | PO／GR發生審批、收貨或下游引用後不得永久刪除；終止只使用狀態及不可變歷史。 |

---

## 10. 使用者體驗要求

### 10.1 導航與頁面

模組至少提供以下頁面，並遵守`docs/frontend-design.md`：

- Purchase Orders：列表、搜尋、filter、新增及進度。
- Purchase Order Detail／Editor：header、lines、價格、審批、收貨及Audit。
- Pending My Approval：指定給目前使用者的PO審批清單。
- Goods Receipts：列表、超收／效期例外及Inventory結果。
- Goods Receipt Draft／Detail：按PO錄入實收、分拆位置並確認。
- Outstanding Purchase Orders：逾期及未收數量清單。
- Purchasing Settings：PO審批參數及變更歷史。

所有頁面須使用既有`PageHeader`、`DataTable`、`FormPanel`、`EllipsisCell`、Notify及confirm helpers；不得另建不一致的UI framework或表單錯誤處理。

### 10.2 Purchase Order操作

- 建立PO採header＋lines清楚分區；mobile可逐步完成，不把寬表格強塞進窄畫面。
- Supplier搜尋顯示Active狀態、Default Currency、Payment Term及排序原因；沒有供貨紀錄的Active Supplier仍可搜尋。
- SKU搜尋支援Code、Name及Barcode；選中後顯示Base／Purchase UOM、factor、採購資格及Tracking摘要。
- 每行即時顯示Ordered Base Quantity、Unit Price、Line Amount及驗證錯誤。
- Total、Currency、零單價、無Payment Term、已過交期或其他風險在確認／審批前集中顯示。
- 離開未保存Draft前須提示；保存後從server重新取得Version及Total。
- Pending Approval頁清楚顯示提交人、指定審批人、提交時間及快照版本。
- 已收貨PO不顯示誤導的Edit／Cancel／Withdraw操作，只提供收貨、Close Remaining及歷史。

### 10.3 Goods Receipt操作

- 由PO建立GR時預載Outstanding lines，但不自動把所有Outstanding當成實收。
- 收貨人可掃描Barcode或搜尋SKU，系統須定位到該PO的合法Line；不在PO的SKU不得加入。
- Tracking欄位隨SKU policy顯示必填狀態，不能由使用者自由選是否提供Lot。
- Warehouse選定後只顯示該Warehouse的Active Bins；Default Warehouse只作起始值。
- 每個Receipt Detail顯示Purchase Quantity、Base Quantity、Lot、Expiry、Status及位置。
- 相同PO Line分拆成多details時，畫面顯示本次合計、歷史已收、Outstanding及Over-received。
- 超收必須以明確文字及數量提示，原因欄在確認前取得focus；不得只使用警告顏色。
- Minimum Receipt Life不足須顯示門檻、剩餘日數及申請例外的資格；無權限者只看到不可確認原因。
- 確認頁須逐項展示將增加Inventory的位置及數量，並明確說明整張全有或全無。
- 確認失敗保留安全的Draft輸入並要求重新載入失效資料；不得自動改Warehouse、Bin、Lot或Status。

### 10.4 狀態、錯誤與可恢復性

- Draft、Pending Approval、Confirmed、Partially Received、Fully Received、Closed及Cancelled須有繁中狀態文字。
- Loading、empty、forbidden、validation、version conflict、dependency unavailable、timeout及retry狀態須清楚區分。
- 版本衝突保留使用者可安全重用的輸入，但強制顯示最新server資料；不自動覆蓋。
- 網路逾時後顯示GR／Request ID查詢入口，避免使用者以新ID盲目重做。
- 阻擋訊息須提供下一步，例如撤回重提、選Active Bin、補Lot、輸入超收原因、申請效期例外或聯絡庫存調整人員。
- Confirmed Receipt、Reversal及PO Close須顯示操作者、時間、原因及來源連結。

### 10.5 可用性與無障礙

- 主要PO建立、審批、收貨、分拆、確認及Close流程可用鍵盤完成，不依賴drag-and-drop。
- 真正heading、form label、hint、錯誤摘要、focus order、dialog focus trap及返回焦點符合WCAG 2.1 AA。
- 所有icon-only按鈕有`aria-label`，loading table使用`aria-busy`，狀態不以顏色作唯一訊號。
- 在375／768／1024／1440px下驗證列表、PO lines、Receipt details及高風險確認；操作欄保持可見。
- 長Supplier、SKU、Lot、PO／GR Number安全截斷並可查看全文，不破壞表格。
- 使用者可見文字一律為繁體中文；專有名詞可保留英文但錯誤及下一步必須可理解。

---

## 11. 權限、安全與職責分離

| 編號 | 需求 |
| --- | --- |
| SEC-001 | 未登入使用者不可存取任何Purchasing／Receiving頁面或端點。 |
| SEC-002 | `purchasing.view`只允許查看及匯出PO／GR，不允許任何寫入。 |
| SEC-003 | `purchasing.mgmt`允許Draft PO CRUD、提交、撤回、取消及Close Remaining，不包含審批、收貨或設定。 |
| SEC-004 | `purchasing.approval`只允許處理指定審批；不得自我批准或批准未指定給自己的PO。 |
| SEC-005 | `receiving.operation`允許Goods Receipt Draft及Confirm，不包含PO商業資料修改、審批、效期例外或Inventory Adjustment。 |
| SEC-006 | `receiving.expiry.override`只允許低於Minimum Receipt Life但未Expired的合法Lot，不可繞過其他規則。 |
| SEC-007 | `purchasing.settings`允許設定修改，且不自動包含採購、審批或收貨能力。 |
| SEC-008 | Receipt Reversal須具`inventory.adjust`及規定的高風險重新認證；一般收貨人不能反向庫存。 |
| SEC-009 | System Administrator不因角色名稱自動取得上述任何permission。 |
| SEC-010 | 後端須阻止水平及垂直越權；替換PO、PO Line、Approval、GR、Receipt Detail、Supplier、SKU、Warehouse、Bin或Movement ID不得跨owner或權限。 |
| SEC-011 | 審批、設定及Receipt Reversal須使用符合User Management政策的password／device-password或等效高風險控制。 |
| SEC-012 | 使用者停用或權限撤銷後，批准、確認Receipt、效期例外、Close及Reversal提交點須重新驗證。 |
| SEC-013 | 所有code、number、quantity、price、date、搜尋、reason及自由文字須驗證；輸出防腳本，CSV防公式。 |
| SEC-014 | Password、token、完整request payload、SQL、stack及內部路徑不得出現在PO／GR、Audit、Log、URL或export。 |
| SEC-015 | 本模組不得向一般使用者顯示或保存Supplier完整銀行帳戶；Payment資料不屬本模組。 |
| SEC-016 | Bulk export、Approval、Settings、Over-receipt、Expiry Override、Receipt Confirm及Reversal須記錄操作者、條件、時間及結果。 |

---

## 12. 整合需求

### 12.1 共通整合原則

- 所有整合使用正式內部ID、Source Reference、Event／Idempotency ID及預期Version。
- 交易提交時重新驗證Provider當前狀態；畫面lookup及cache不能作最終授權或資格依據。
- Provider暫時不可用時fail closed，不使用過期、不完整或未授權資料猜測完成交易。
- PO及GR保存交易時必要快照，但Provider仍是當前主資料的唯一來源。
- 同一業務效果只能發生一次；逾時可按Source／Request ID查詢，不能要求呼叫方猜測。
- 批量查詢使用provider批量能力，避免逐Line N+1呼叫。

### 12.2 Supplier Management整合

- 新PO及提交／批准只可使用當下Active Supplier。
- Supplier lookup可把有目標SKU供貨紀錄或preferred標記者排前，但仍返回全部Active Suppliers。
- PO預設帶入Supplier Default Currency、Default Payment Term及訂購地址；確認時保存快照。
- Supplier銀行資料不是採購或收貨必填，Purchasing不得要求或複製完整帳號。
- Confirmed Receipt可回傳Supplier－SKU最近供貨時間及軟性關係；不得自動標為preferred或改Supplier狀態。
- Supplier日後修改或停用不改寫既有PO／GR快照；Blocked Supplier既有到貨按BR-038處理。

### 12.3 Item Management整合

- PO及Receiving使用正式SKU ID，並讀取SKU Code、Name、Base UOM、有效Pack UOM、purchase eligibility、Tracking Policy、Shelf Life及Minimum Receipt Life。
- 新PO不可選擇不允許採購的Inactive、Discontinued或Archived SKU。
- Purchase UOM factor在PO確認時保存快照；Item日後修改不改寫既有Ordered Quantity。
- 收貨時重新取得Tracking及效期規則；如規則與已確認PO衝突，須明確阻擋或按Item正式purpose contract處理。
- Active Serial Tracking SKU在本期不能進入可確認PO／Receipt，必須fail closed。
- 完成供貨後可更新Supplier－SKU軟性供貨紀錄，但不得在Item模組保存實際PO價格歷史。

### 12.4 Inventory Management整合

- Goods Receipt Confirm才呼叫Inventory Receipt；Draft、PO Confirm及Close Remaining不改Inventory。
- 每個Receipt Detail提供SKU、Base Quantity或可驗證UOM換算、Warehouse、Bin、Lot／Expiry、Stock Status及正式Source Event。
- Receiving負責提供Minimum Receipt Life例外permission、門檻證據及原因；Inventory須重新驗證。
- Receipt與GR／PO進度必須共用原子交易邊界或等效一致性保障；任一側失敗全部回滾。
- 相同Receipt事件重送不得重複入庫；同一事件不同payload須衝突。
- Inventory Movement保存PO／GR來源並可返回Receiving詳情；Receiving顯示Movement結果但不直接改Balance。
- Receipt Reversal透過Inventory正式Reversal能力，成功後同步更新PO Net Received；物理Supplier Return不使用Reversal。
- Counting中的Bin、Inactive位置、Lot衝突、Serial及其他Inventory拒絕必須完整傳回Receiving並保留Draft。

### 12.5 User、Currency及Payment Terms整合

- User Management提供Active actor、permissions、指定審批人及高風險認證；提交點重新驗證撤權／停用。
- Currency及Payment Term只可從有效目錄選擇；已確認歷史保留已停用值及顯示快照。
- 本期不取得匯率，不把不同Currency金額加總成公司幣別。
- Buyer、Submitter、Approver、Receiver及Reversal Actor以User ID關聯並保存顯示快照；使用者停用不破壞歷史。

### 12.6 未來Accounts Payable及Reporting

- AP日後可使用PO／GR的Supplier、Currency、Payment Term、Price、Quantity及Source Snapshot作Invoice matching。
- 本期不建立Supplier Invoice、應付金額、付款狀態或matching結果，也不預先推導「可付款」。
- Reporting只讀取正式PO／GR及Inventory結果，不可回寫PO Status、Received Quantity或Balance。
- 歷史指定時點報表使用不可變事件／快照，不以目前Supplier／SKU資料冒充過去值。

---

## 13. 非功能需求

### 13.1 效能與容量

| 編號 | 需求 |
| --- | --- |
| NFR-001 | 在最多20名同時在線Purchasing／Receiving使用者及正常混合負載下，精確PO／GR／SKU查找及常用列表p95應少於2秒。 |
| NFR-002 | PO、GR、Approval、Audit及所有可能增長的lines列表須server-side分頁，預設20、上限100。 |
| NFR-003 | 容量驗證建議以100,000 SKUs、10,000 Suppliers、每年50,000 POs、每PO 100 Lines、每年100,000 GRs及每GR 200 Details作基線，而不是硬性業務上限。 |
| NFR-004 | 一張100 Lines PO的建立／確認及一張200 Details GR的驗證／確認，在正常負載下須有可接受互動時間並提供明確進度。 |
| NFR-005 | Supplier／SKU／Warehouse lookup及PO Outstanding查詢不得因逐行N+1而隨lines線性失控。 |

### 13.2 一致性與可靠性

| 編號 | 需求 |
| --- | --- |
| NFR-006 | PO、Approval、GR、PO line progress、Inventory Movement及Audit不得出現半個業務操作。 |
| NFR-007 | 所有state-changing命令須支援安全重送；同一事件不同內容須明確衝突。 |
| NFR-008 | 並發審批、撤回、Close、Receipt及Reversal不得lost update、重複入庫或無聲覆蓋。 |
| NFR-009 | 系統須能在回應遺失、worker／server重啟或暫時依賴故障後查明操作是否完成並安全恢復。 |
| NFR-010 | PO Net Received、Outstanding、Over-received及Inventory Movement須具備可重複執行的只讀對賬能力；發現差異不得直接修改結果掩蓋。 |
| NFR-011 | Purchasing／Receiving資料須納入既有backup及restore；還原後PO／GR／Inventory／Audit來源可對賬。 |

### 13.3 安全、保留與相容性

| 編號 | 需求 |
| --- | --- |
| NFR-012 | PO／GR正常查詢不可因AP、Payment或其他非必要未來模組不可用而失敗；必要Supplier／Item／Inventory依賴不可用時寫入fail closed。 |
| NFR-013 | Confirmed PO、Approval、GR、Reversal及Audit至少保留7年；主資料停用或刪除不得破壞歷史。 |
| NFR-014 | Chrome、Edge及Safari目前支援版本須可完成核心PO、審批及收貨流程；響應式符合frontend design基準。 |
| NFR-015 | Currency、UOM、Quantity、Price、Status、Error及Time語意在Web、CSV、列印及整合介面一致。 |
| NFR-016 | 數量及金額計算不得使用造成可見浮點誤差的方式；Base UOM保持整數，Currency依正式精度規則round。 |

---

## 14. 錯誤與例外處理

| 情境 | 系統行為 |
| --- | --- |
| Supplier不存在或非Active | 新PO／提交／批准拒絕；既有PO仍可查，Receipt依BR-038明確處理。 |
| SKU不存在或不可新採購 | 拒絕加入／確認新PO，不留下部分Line。 |
| Serial Tracking SKU | 明確顯示本期不支援並拒絕，不降級處理。 |
| Currency／Payment Term／UOM失效 | 提交時拒絕並要求重新選擇；已確認歷史快照不變。 |
| Quantity為0、負數、小數Base UOM或超上限 | Field-level拒絕且不計算／過帳錯誤數量。 |
| Unit Price為負或零價缺原因 | 拒絕確認；零價有原因時清楚標示。 |
| PO沒有Lines或Total計算不一致 | 拒絕提交／批准，不建立部分Approval。 |
| 提交人選自己或無權使用者為Approver | 拒絕且PO保持Draft。 |
| Approver被撤權／停用或PO版本改變 | 批准拒絕，要求撤回／刷新及重新提交。 |
| Draft／Pending／Cancelled／Closed PO收貨 | 拒絕建立或確認GR，庫存不變。 |
| Receipt Detail不屬PO或SKU不符 | 整張GR拒絕，不接受替代SKU。 |
| Warehouse／Bin不存在、Inactive或ownership不符 | 整張GR拒絕，指出安全且可理解的位置錯誤。 |
| Lot／Expiry缺失、Expired或與既有Lot衝突 | 整張GR拒絕；不建立新Lot或Movement。 |
| Minimum Receipt Life不足 | 無例外權限／原因時拒絕；合法例外仍重驗其他規則。 |
| 超收缺原因 | 阻止確認並定位受影響PO Line及Over-received Quantity。 |
| Short Receipt | 允許確認，Outstanding保留；不自動Close。 |
| 任一GR Detail或Inventory過帳失敗 | 整張GR保持Draft，PO progress及所有Inventory數量不變。 |
| 相同事件重送 | 返回原結果或等效成功，不重複PO／Approval／Inventory效果。 |
| 相同事件ID不同內容 | 回衝突並保存可調查結果，不選擇其中一份。 |
| PO／GR版本過時 | 回版本衝突，保留安全輸入並要求載入最新資料。 |
| 回應在Commit後遺失 | 允許以PO／GR／Request ID查唯一結果後用相同ID安全重試。 |
| 已確認Receipt修改／刪除 | 拒絕並提供Receipt Reversal及新Receipt指引。 |
| Reversal將使Inventory不合法 | 整次拒絕；原GR、PO progress及Inventory不變。 |
| 依賴服務暫時不可用 | 寫入fail closed並顯示可重試；已完成查詢盡量保持可用。 |
| 未授權、actor停用或跨owner ID | 401／403／404或等效安全拒絕，零業務變更且不洩漏資料。 |

---

## 15. 驗收準則

### 15.1 Settings、PO建立及商業資料

| 編號 | 驗收準則 |
| --- | --- |
| AC-001 | Given審批參數尚未設定，When設定管理員查看Purchasing Settings，Then「PO需要審批」預設為關閉且有修改歷史。 |
| AC-002 | Given使用者沒有`purchasing.settings`，When直接嘗試修改參數，Then後端拒絕且值不變。 |
| AC-003 | Given目標SKU沒有Supplier－SKU關係但Supplier為Active，When採購人員建立PO，ThenSupplier仍可搜尋及選擇。 |
| AC-004 | Given一個preferred Supplier已Suspended而另一個無歷史Supplier為Active，When搜尋目標SKU供應商，ThenSuspended Supplier不可選，而Active Supplier仍可選。 |
| AC-005 | GivenActive Supplier具有Default Currency及Payment Term，When建立PO，Then系統帶入預設；在Draft覆寫後確認值保存為交易快照。 |
| AC-006 | Given採購人員建立包含兩個SKU的Draft PO，When輸入有效Purchase UOM、數量及價格並保存，ThenPO Number唯一、Lines及Total完整且Inventory不變。 |
| AC-007 | Given1 BOX＝24 EA，WhenPO訂購3 BOX，ThenOrdered Base Quantity顯示72 EA且不產生小數。 |
| AC-008 | GivenUnit Price為負、或為0但沒有原因，When提交PO，Then被拒絕；零價有原因時可繼續並清楚標示。 |
| AC-009 | GivenPO有多個Lines，When修改數量或價格，Then每行Amount及PO Total正確重算，且沒有Tax、Freight、Discount或Landed Cost。 |
| AC-010 | Given兩人載入同一Draft版本，When第一人保存後第二人再保存，Then第二人收到版本衝突且不覆蓋第一人的Lines或Total。 |

### 15.2 PO審批及生命週期

| 編號 | 驗收準則 |
| --- | --- |
| AC-011 | Given審批參數關閉且PO完整，When`purchasing.mgmt`確認，ThenPO直接成為Confirmed並記錄快照及Audit。 |
| AC-012 | Given審批參數開啟，When提交Draft，Then必須選擇另一名Active且具`purchasing.approval`的人，PO進Pending Approval。 |
| AC-013 | Given提交人同時具有approval權限，When選擇自己批准，Then系統拒絕且PO保持Draft。 |
| AC-014 | Given合法Pending Approval，When非指定Approver嘗試批准，Then被拒絕且申請保持Pending。 |
| AC-015 | Given合法Pending Approval，When指定Approver批准，ThenPO直接Confirmed；When填原因拒絕另一申請，Then該PO返回Draft。 |
| AC-016 | GivenPending期間PO版本、Supplier或SKU資格改變，WhenApprover批准，Then系統拒絕過時申請並要求重新提交。 |
| AC-017 | GivenPending申請尚未決定，When提交人撤回，ThenPO返回Draft且舊Approval不可再批准。 |
| AC-018 | GivenConfirmed PO從未收貨，When採購人員填原因撤回後修改，Then可重新提交；既有確認歷史仍可查。 |
| AC-019 | GivenConfirmed PO已有一張Confirmed GR，When嘗試撤回、取消或修改商業資料，Then全部被拒絕且已收歷史不變。 |
| AC-020 | GivenPartially Received PO仍有Outstanding，When採購人員填原因Close Remaining，ThenPO為Closed、未收量不入庫且已收量不變。 |

### 15.3 Goods Receipt Draft、分批及驗證

| 編號 | 驗收準則 |
| --- | --- |
| AC-021 | GivenPO仍為Draft、Pending、Closed或Cancelled，When收貨人嘗試建立GR，Then被拒絕且沒有Inventory效果。 |
| AC-022 | GivenConfirmed PO有三個Lines，When本次只選其中一行建立GR Draft，Then系統允許，其他Lines仍保留Outstanding。 |
| AC-023 | Given一個PO Line實際到兩個Lots並放在兩個Warehouses／Bins，When建立四個Receipt Details，Then每個位置及Lot可分開保存。 |
| AC-024 | GivenGR仍為Draft，When保存、離頁再返回或取消，Then輸入可恢復或取消，PO Received及Inventory均不變。 |
| AC-025 | GivenPO Line是SKU-A，When收貨人替換ID嘗試加入SKU-B，Then整張Draft／Confirm被拒絕且不建立替代庫存。 |
| AC-026 | GivenWarehouse A被選中，When使用者選擇Warehouse B的Bin或Inactive Bin，Then系統拒絕並指出位置錯誤。 |
| AC-027 | GivenTracking none／batch／batch_expiry SKUs，When分別收貨，ThenLot／Expiry必填規則與Item及Inventory一致。 |
| AC-028 | GivenSerial Tracking SKU，When嘗試確認PO或GR，Then明確拒絕且不降級為其他Tracking。 |
| AC-029 | Given同SKU／Lot已有Expiry，When新GR使用不同Expiry，Then整張確認拒絕且既有Lot不變。 |
| AC-030 | GivenExpiry Date已過期，When確認GR，Then拒絕；效期例外permission亦不可繞過。 |
| AC-031 | Given剩餘效期低於Minimum Receipt Life，When一般收貨人確認，Then拒絕；具專門權限者填原因後可在其他規則有效時成功。 |
| AC-032 | Given同一GR包含Available、Quarantined及Damaged details，When確認成功，ThenInventory分別增加正確Status buckets。 |
| AC-033 | GivenPO Outstanding為10而本次收8，When確認，ThenNet Received增加8、Outstanding剩2且系統不自動Close。 |
| AC-034 | GivenPO Outstanding為10而本次收12，When缺原因確認，Then被拒絕；填原因後成功並顯示Over-received 2而Ordered仍為10。 |
| AC-035 | GivenSupplier Delivery Note與近期同Supplier GR重複，When保存Draft，Then顯示疑似重複提示但不單憑該文字永久阻擋合法收貨。 |

### 15.4 GR確認、冪等、並發及Reversal

| 編號 | 驗收準則 |
| --- | --- |
| AC-036 | Given合法多detail GR Draft，When確認，ThenGR、PO progress、Inventory Movements及Audit一次完成且可雙向追溯。 |
| AC-037 | GivenGR有一個detail在提交時Bin停用，When確認，Then整張保持Draft、所有details零Inventory效果且PO progress不變。 |
| AC-038 | Given相同GR確認request被重送，When再次提交，Then返回原結果且每個Inventory bucket只增加一次。 |
| AC-039 | Given相同event ID但修改數量、Lot、Bin或Status，When提交，Then回衝突且不接受第二份效果。 |
| AC-040 | GivenGR提交後回應遺失，When使用者按GR／Request ID查詢並以同一ID重試，Then可查明唯一結果且不重複入庫。 |
| AC-041 | Given兩張GR同時收同一PO Line，When兩人提交，Then兩張合法實收均準確累計；如造成超收，各自依提交時結果要求原因且沒有lost update。 |
| AC-042 | GivenPO在GR畫面載入後被取消、關閉或版本更新，When確認舊GR，Then整張被拒絕且不以過時畫面入庫。 |
| AC-043 | GivenConfirmed GR，When一般使用者嘗試edit、cancel或delete，Then全部拒絕並提供Reversal指引。 |
| AC-044 | GivenConfirmed GR尚有足夠合資格庫存，When具`inventory.adjust`者反向部分Receipt Detail並填原因，Then建立反向Movement、原歷史不變、PO Net Received下降。 |
| AC-045 | GivenReversal將令Inventory為負、破壞Reservation或涉及Counting Bin，When提交，Then整次拒絕且GR、PO及Inventory全部不變。 |
| AC-046 | Given相同Reversal事件被重送，When再次提交，Then只反向一次；同ID不同數量回衝突。 |
| AC-047 | GivenFully Received PO的收貨被反向，When成功後仍有Outstanding，ThenPO回到Confirmed／Partially Received；已人工Closed的PO不自動重開。 |

### 15.5 權限、查詢、歷史及營運品質

| 編號 | 驗收準則 |
| --- | --- |
| AC-048 | Given使用者只有`purchasing.view`，When查詢／匯出後嘗試任何寫入，Then查詢成功而寫入全部拒絕且資料不變。 |
| AC-049 | Given採購人員沒有receiving或approval權限，When直接呼叫Confirm GR或Approve PO，Then後端拒絕且沒有部分狀態。 |
| AC-050 | Given使用者在畫面載入後被撤權／停用，When批准、確認GR、效期例外、Close或Reversal，Then提交點重新驗證並拒絕。 |
| AC-051 | GivenSupplier或SKU顯示名稱及UOM日後修改，When查看既有Confirmed PO／GR／列印文件，Then交易時快照不變且可分清目前主資料。 |
| AC-052 | GivenPO／GR畫面套用Supplier、Status、Date、SKU或Outstanding filters，When匯出CSV，ThenCSV與畫面語意一致且不含銀行、token、內部路徑或公式執行。 |
| AC-053 | Given完整PO→Approval→多次GR→Inventory流程，When從任一來源查看，Then可追至Supplier、SKU、PO、GR、Inventory Movement、actor、reason及Audit。 |
| AC-054 | Given100,000 SKUs及定義容量基線，When執行精確搜尋及常用列表，Thenp95少於2秒且結果正確。 |
| AC-055 | Given完整backup，When在隔離環境restore，ThenPO、Approval、GR、line progress、Inventory Movement及Audit來源均可對賬。 |

---

## 16. 資料建置與上線要求

### 16.1 初始設定及主資料

- 確認`purchase_order_approval_required`初始值為關閉，並由Product Owner簽核。
- 建立`purchasing.view`、`purchasing.mgmt`、`purchasing.approval`、`receiving.operation`、`receiving.expiry.override`及`purchasing.settings`權限。
- 指派採購、審批、收貨、設定及Inventory調整測試角色；不得以System Administrator自動取得權限。
- Supplier、Currency、Payment Term、SKU、UOM、Warehouse及Bin主資料須達可用狀態。
- Inventory Receipt／Reversal、Source／Request查詢及Audit契約須在Receiving Go-Live前通過整合驗證。

### 16.2 未完成採購資料導入

- 如上線時已有舊系統未完成PO，須使用受控、一次性的資料導入或人工建檔方案，不能使用無PO Opening Receipt。
- 導入至少包含PO Number、Supplier、Currency、Order Date、Lines、UOM、Ordered／Previously Received／Outstanding及原來源。
- 已在舊系統收貨的數量不得再次過帳Inventory；只導入需要繼續管理的採購承諾及快照。
- 導入前須預檢Supplier／SKU／UOM映射、重複PO Number、數量及金額；導入後按Supplier及SKU對賬。
- 本期不提供一般使用者PO CSV Import UI；上線導入屬受控migration工作。

### 16.3 Go-Live控制

- 先完成Supplier及Item可用性、Inventory Opening／Go-Live及Warehouse／Bin資料，再開放Goods Receipt Confirm。
- 上線前凍結舊系統未完成PO及在途收貨資料，指定切換時間及責任人。
- 以代表性none／batch／batch_expiry、partial、over-receipt、Quarantined及expiry override完成端到端rehearsal。
- 保存版本、migration、權限、設定、對賬、backup／restore、效能、security及UAT簽核證據。
- 若Inventory尚未Go-Live或Receipt contract不可用，可先開放PO Draft／Approval，但不得顯示可確認GR的入口。

---

## 17. 優先級與建議交付階段

### Phase 1：Purchase Order Foundation

- 權限、設定框架、PO Number、PO header／lines、Supplier／SKU lookup、UOM、價格、Total、列表、詳情及版本。
- 審批關閉下的Draft→Confirmed流程。
- 交付結果：可建立、確認、列印及追溯不影響Inventory的正式PO。

### Phase 2：Approval & Lifecycle

- 可配置審批、待我審批、批准／拒絕／撤回、Confirmed撤回、Cancel、Close Remaining及狀態歷史。
- 交付結果：PO可按已確認簡單審批模式安全控制，且開始收貨後不能改寫商業歷史。

### Phase 3：Goods Receiving & Inventory

- GR Draft、分拆details、Tracking、UOM、Warehouse／Bin、Status、partial／over-receipt、minimum life override及原子Inventory posting。
- 交付結果：每次實收到具體SKU／Lot／Bin，PO progress與Inventory一致。

### Phase 4：Correction, Reporting & Release

- Receipt Reversal、Supplier供貨紀錄、Outstanding／GR查詢、CSV、Audit、效能、backup／restore、對賬及完整UAT。
- 交付結果：錯誤可受控更正，所有採購、收貨及庫存結果可追溯並具上線證據。

每個Phase應是一個獨立PR及一次完整測試週期；不得把未完成下一Phase的入口提前暴露給一般使用者。

---

## 18. 決策紀錄與待確認事項

### 18.1 已確認決策

| 編號 | 決策 | 業務影響 |
| --- | --- | --- |
| DEC-001 | 採購由Purchase Order直接開始。 | 不建PR、RFQ或報價比較。 |
| DEC-002 | PO審批可配置且預設關閉。 | 小企業預設可直接確認，日後可啟用控制。 |
| DEC-003 | 審批開啟時禁止自建自批。 | 提交人須指定另一名具權限者。 |
| DEC-004 | PO支援分批收貨。 | 未收數量可留待後續GR或人工Close。 |
| DEC-005 | 允許超收並要求原因。 | 不設容差百分比或額外超收permission，但必須完整追溯。 |
| DEC-006 | PO保存Currency、Unit Price、Line Amount及Total。 | 提供商業記錄，但不形成Inventory成本或會計分錄。 |
| DEC-007 | 本期不適用Tax。 | PO不管理稅碼、稅率或稅額。 |
| DEC-008 | Supplier Receipt必須引用有效PO。 | 不提供無PO收貨。 |
| DEC-009 | 未收貨Confirmed PO可撤回修改；收貨後不可改寫。 | 已發生交易以歷史及Close Remaining處理。 |
| DEC-010 | 一個PO Line可拆至不同Lot、Expiry、Warehouse、Bin及Status。 | 收貨記錄反映實際位置及品質狀態。 |
| DEC-011 | Goods Receipt先Draft後整張Confirm。 | Draft不動庫存，Confirm全有或全無。 |
| DEC-012 | Confirmed Goods Receipt不可直接修改或刪除。 | 錯誤透過Reversal及新Receipt更正。 |
| DEC-013 | Purchasing及Receiving屬同一功能模組的兩個能力。 | 建置次序為Purchase Order→Goods Receipt→Inventory。 |

### 18.2 文件採用的簡化假設

| 編號 | 假設 | 處理方式 |
| --- | --- | --- |
| ASM-001 | PO Number及GR Number由系統產生。 | 後續設計確定顯示格式；ID及Number不可重用。 |
| ASM-002 | 一張GR只引用一張PO。 | 避免跨PO原子性及分攤複雜度；合併多PO收貨列為範圍外。 |
| ASM-003 | 零單價可用於贈品／免費樣品。 | 必須填原因並在Approval／Audit標示。 |
| ASM-004 | Expected Delivery Date及Default Receiving Warehouse提供營運預設。 | 交期可選填；實際收貨位置以GR為準。 |
| ASM-005 | Confirmed Receipt更正使用Inventory Reversal能力。 | 不把錯誤更正誤當Supplier Return。 |

### 18.3 待技術設計及上線前確認

| 編號 | 確認事項 | 阻擋範圍 |
| --- | --- | --- |
| OPEN-001 | Confirmed PO後Supplier變成Blocked時，是否正式採用「只允許Quarantined＋原因」安全預設，或完全拒收並走人工例外。 | Blocked Supplier Receiving設計及UAT |
| OPEN-002 | Item purpose contract對「PO確認後才Discontinued／Inactive」SKU的既有承諾收貨語意。 | Item／Receiving整合 |
| OPEN-003 | Currency金額精度及rounding規則，以及Unit Price最大位數。 | Database／API／UI／CSV一致性 |
| OPEN-004 | PO／GR Number顯示格式及每日／年度序列政策。 | 編號服務及migration |
| OPEN-005 | Purchase Order列印採browser print或正式PDF artifact及其保留方式。 | Reporting／文件產生 |
| OPEN-006 | 首批未完成PO、切換日期、舊系統Previously Received及Inventory Opening對賬責任人。 | Go-Live |

以上未確認項不得由實作者自行加入放寬規則。OPEN-001／002未決時相關提交須fail closed；其他項不阻擋業務需求簽核，但在相應設計／上線Gate前必須完成。

---

## 19. 需求追溯摘要與簽核

### 19.1 需求追溯摘要

| 業務目標／Capability | 主要需求 | 驗收準則 |
| --- | --- | --- |
| OBJ-01／PUR-CAP-01 | FR-LIST、FR-PO | AC-003～010、AC-051～053 |
| OBJ-02／PUR-CAP-01 | FR-PO、BR-004～013 | AC-003～009、AC-025／028 |
| OBJ-03／PUR-CAP-02 | FR-SET、FR-APPROVAL、SEC-003／004／007 | AC-001／002、AC-011～017 |
| OBJ-04／PUR-CAP-03～05 | FR-LIFE、FR-GR、FR-VAL | AC-018～035 |
| OBJ-05／PUR-CAP-04～06 | FR-GR、FR-VAL、FR-POST | AC-023／026～032、AC-036／037 |
| OBJ-06／PUR-CAP-06～07 | FR-POST、FR-REV、FR-AUDIT | AC-036～047、AC-051～055 |
| OBJ-07／PUR-CAP-01～06 | BR-040～047、NFR-006～011 | AC-010／016／037～047／050／055 |
| OBJ-08／PUR-CAP-07 | Scope §2.2、FR-REPORT | AC-052～054 |

### 19.2 文件簽核建議

需求進入`design_spec.md`前，建議由以下角色確認：

- Product Owner：確認本期範圍、審批、超收及明確Out of Scope。
- Purchasing Lead：確認PO fields、狀態、部分收貨及Close Remaining。
- Warehouse／Receiving Lead：確認實收分拆、位置、效期及超收操作。
- Inventory Owner：確認Receipt／Reversal、Source及對賬邊界。
- Engineering Lead：確認Provider dependencies及OPEN事項有清楚Gate。
- QA Lead：確認55條Acceptance Criteria可被實際驗證。

文件獲明確批准後才開始系統設計；本需求書建立本身不代表功能已實作或通過測試。

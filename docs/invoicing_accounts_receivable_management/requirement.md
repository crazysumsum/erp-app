# Invoicing & Accounts Receivable Management 業務需求書

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 模組 | Invoicing & Accounts Receivable Management |
| 文件類型 | Business Requirement Document（BRD） |
| 版本 | 0.2 Draft |
| 日期 | 2026-09-10 |
| 適用系統 | ERP App |
| 適用組織 | 單一公司 |
| 目標用戶 | 中小型批發企業的財務、應收、銷售查閱及營運管理人員 |
| 主要範圍 | 待開票、Invoice、Credit Note、Receipt、核銷、應收查詢、信用暴露、期初匯入、財務文件及歸檔 |
| UI／UX基準 | `docs/frontend-design.md` |

### 0.1 文件目的

本文件定義ERP Invoicing & Accounts Receivable Management（開票及應收帳款管理）模組的業務目標、能力邊界、角色權限、資料概念、狀態、流程、功能需求、業務規則、整合要求、非功能要求及驗收準則，作為後續系統設計、開發任務、測試案例、使用者驗收及上線控制的共同依據。

本文件描述「系統必須做到甚麼」及可觀察的業務結果，不指定資料庫表、API路徑、程式碼架構或Migration序號。後續`design_spec.md`須參考當時最新主分支與正式上下游契約，不得降低本文的業務規則及驗收準則。

### 0.2 業務背景

本ERP主要服務化妝品、零食、健康食品及飲品等零售消耗品的批發業務。Sales Order記錄銷售承諾，Fulfillment & Shipping記錄實際出貨，但企業仍需要一個正式、可追溯的財務流程，把「已出貨甚麼」轉成「應向客戶收取多少」，再記錄實際收款、核銷、貸項、未收及逾期餘額。

Sales Order預計支援人工、CSV及未來電商渠道，每日約10,000張訂單。若開票只能逐張人工處理、沒有來源防重、應收與付款散落在試算表，容易造成漏開、重複開票、錯配收款、信用額度失真、歷史報表變動及長期資料拖慢系統。因此本模組須同時支援單張與批量操作、正式單據不可覆寫、跨模組來源追溯、可靠的餘額計算，以及Active／Archive資料分流。

本期以中小企必需的核心能力為限，不建立總帳、稅務、銀行對賬、退款、催收或複雜審批系統。Invoicing & AR是獨立財務aggregate；它引用Sales及Fulfillment事實，但不回寫歷史商業或庫存結果。

### 0.3 已確認業務意圖

- 所有渠道的`SHIPPED` Shipment均進入待開票範圍；`PICKED`或`REVERSED` Shipment不可開票。
- 預設一張Shipment建立一張Invoice；財務可人工合併相容的多張Shipment。
- 合併可跨Sales Order及Warehouse，但所有Shipment必須屬於同一Customer、Currency及一致的開票條件。
- 一張Shipment須一次完整納入Invoice，不支援按Line或數量部分開票。
- 財務人工確認後Invoice才正式成立並形成AR；支援單張及批量確認。
- Shipment-based Invoice在Draft預設沿用SO價格；具獨立權限者可在確認前輸入原因後改價。
- Billing Address不是Invoice確認必填；Payment Term缺失時由財務明確輸入Due Date。
- 正式Invoice不可直接修改或刪除；以作廢或Credit Note更正。
- Credit Note按原Invoice Line處理，只改AR、不改Shipment或Inventory；超出當前未收額的有效貸項形成Customer Credit Balance。
- Receipt支援部分付款、一筆對多張Invoice、未核銷款及重新核銷；Receipt資料錯誤時整張沖銷。
- Invoice與Receipt只可按相同Currency核銷；不計算匯率或匯兌損益。
- AR提供Outstanding、Overdue、Aging、Customer Statement及Credit Exposure。
- Credit Limit超額只警告；Customer Credit Hold才阻止新的賒銷訂單。
- 模組提供受控Manual Invoice及期初應收CSV匯入，但不得藉此產生庫存或改寫Sales。
- 模組提供簡單AR關帳日，不建立完整會計期間或雙人審批。
- Invoice／AR獨立歸檔；未收Invoice不阻止來源SO／Fulfillment按既有政策歸檔。

### 0.4 文件版本紀錄

| 版本 | 日期 | 說明 |
| --- | --- | --- |
| 0.1 Draft | 2026-09-10 | 根據業務訪談建立Shipment-based／Manual Invoice、Credit Note、Receipt、核銷、AR查詢、信用暴露、期初匯入、設定及獨立歸檔需求。 |
| 0.2 Draft | 2026-09-10 | 確認災難復原目標RTO不超過4小時、RPO不超過15分鐘；財務記錄至少保留7年，Import source／result檔90日、Export result及可重建PDF檔7日。 |

---

## 1. 業務目標與成功指標

### 1.1 業務目標

| 編號 | 業務目標 |
| --- | --- |
| OBJ-01 | 把已確認出貨準確、完整且不重複地轉為正式Invoice及應收。 |
| OBJ-02 | 讓財務以單張或批量方式處理每日高單量開票，同時隔離個別錯誤。 |
| OBJ-03 | 建立Invoice、Credit Note、Receipt、核銷及餘額的單一可追溯來源。 |
| OBJ-04 | 支援部分付款、多單核銷、未核銷款及Customer Credit Balance等中小企日常情況。 |
| OBJ-05 | 提供未收、逾期、Aging及Customer Statement，協助財務追收及對賬。 |
| OBJ-06 | 向Customer及Sales提供可靠Credit Exposure，而不重複計算SO與Invoice。 |
| OBJ-07 | 以正式更正文件、關帳日、權限及Audit防止歷史被無聲改寫。 |
| OBJ-08 | 在24個月Active及至少7年保留量下維持日常查詢及批量工作的可用性。 |
| OBJ-09 | 與Sales、Fulfillment、Customer、Item及Archive建立清晰邊界，不引入總帳或稅務。 |

### 1.2 建議成功指標

| 編號 | 指標 | 目標 |
| --- | --- | ---: |
| KPI-01 | 已正式Invoice的Shipment具唯一且完整來源映射 | 100% |
| KPI-02 | 同一Shipment被重複開票事件 | 0 |
| KPI-03 | Invoice、Credit、Receipt及核銷餘額可對賬率 | 100% |
| KPI-04 | 正式Invoice／Credit Note／Receipt被直接覆寫或刪除事件 | 0 |
| KPI-05 | Credit Exposure與可核對來源一致率 | 100% |
| KPI-06 | 已逾期Invoice正確進入Aging分桶 | 100% |
| KPI-07 | 批量開票中合法文件因其他不合法文件而失敗 | 0 |
| KPI-08 | Active常用列表及精確單號查詢p95 | 2秒內 |
| KPI-09 | 未授權改價、Credit、Receipt沖銷、設定或期初匯入事件 | 0 |
| KPI-10 | 關鍵財務動作及來源鏈可追溯率 | 100% |

KPI數值是上線驗收及營運監察基線。不得以刪除失敗、作廢、沖銷或例外記錄來提高表面成功率。

---

## 2. 範圍與Capability Map

### 2.1 本期範圍

- 待開票Shipment Workbench、搜尋、篩選、分頁、選取、預覽及例外原因。
- 由一張或多張完整`SHIPPED` Shipment建立Invoice Draft。
- 受控Manual Invoice，支援自由描述Line及選填SKU參考。
- Invoice Draft查看、修改允許欄位、取消、單張確認及批量確認。
- Shipment來源價格覆寫權限、原因、原值／新值及差額追溯。
- Invoice、Credit Note及Receipt年度獨立流水號。
- A4 Invoice／Credit Note及PDF下載。
- 按原Invoice Line建立部分或全額Credit Note，以及Customer Credit Balance。
- Receipt Draft、確認、部分／多Invoice核銷、未核銷餘額、重新核銷及整張沖銷。
- 銀行轉帳、現金、支票及其他收款方式的必要憑證資料。
- Outstanding、Overdue、Aging、Customer Statement、Customer Account及跨單據追溯。
- 即時Credit Exposure及供Sales使用的信用摘要。
- 受控期初未收Invoice／Credit Balance CSV匯入。
- 公司開票資料、收款銀行帳戶、文件前綴及AR關帳日設定。
- 列表、詳情、Audit、CSV匯出、背景Job、Active／Archive查詢及恢復。
- 繁體中文、響應式、鍵盤操作及WCAG 2.1 AA使用體驗。

### 2.2 本期不包含

- Sales Tax、VAT／GST、稅碼、稅率、稅額、稅務申報或政府電子發票平台。
- General Ledger、Journal Entry、Revenue Recognition、Chart of Accounts或財務報表。
- 外幣收款、跨幣別核銷、匯率、匯兌損益或公司本幣重估。
- 銀行流水匯入、銀行對賬、自動配對、Payment Gateway或銀行API。
- 電商平台結算、支付渠道費用或各平台特有Adapter。
- Customer Return、換貨、退款、Chargeback或實際向客戶付款。
- Debit Note、獨立Bad Debt／Small Balance Write-off；本期以有原因的Credit Note處理。
- 分期付款計劃、直接扣款、付款承諾、自動催收、逾期利息或Collection Case Management。
- 自動Email發送、客戶Portal、線上付款連結或電子簽署。
- 客戶集團結算、跨Customer核銷、共享信用額度或多公司／多法人。
- 複雜多層、按金額或類型的審批矩陣。
- 自訂報表設計器、BI數據倉庫或預測性收款分析。

### 2.3 Capability Map

| Capability ID | 名稱 | 責任 | 主要依賴 |
| --- | --- | --- | --- |
| IAR-CAP-01 | Invoiceable Workbench | 找出可開票Shipment、claim、防重、合併預覽及例外。 | Sales、Fulfillment、Customer |
| IAR-CAP-02 | Invoice Lifecycle | Shipment-based／Manual Draft、確認、作廢、文件及快照。 | IAR-CAP-01、Customer、Item、Currency |
| IAR-CAP-03 | Credit Management | Invoice Line貸項、Credit Balance、應用、作廢及來源解鎖。 | IAR-CAP-02 |
| IAR-CAP-04 | Receipt & Allocation | 收款、未核銷款、部分／多單核銷、重配及沖銷。 | IAR-CAP-02、IAR-CAP-03、AR Settings |
| IAR-CAP-05 | AR Inquiry & Credit Exposure | Customer Account、Outstanding、Overdue、Aging、Statement及Exposure。 | IAR-CAP-02～04、Sales |
| IAR-CAP-06 | Opening Data & Settings | 期初CSV、公司抬頭、銀行、編號及關帳日。 | User、Currency、Customer |
| IAR-CAP-07 | Audit, Export & Archive | 歷史、背景匯出、Active／Archive路由、對賬及保留。 | IAR-CAP-01～06、Sales Archive |

建議後續實作次序：`IAR-CAP-06基礎設定 → IAR-CAP-01／02 → IAR-CAP-03／04 → IAR-CAP-05 → IAR-CAP-07`。Credit、Receipt及報表不得建立另一套可修改的Invoice真相。

### 2.4 上下游依賴

| 系統／模組 | 關係與責任邊界 |
| --- | --- |
| User Management | 提供使用者、角色、權限、操作者、重新認證及服務身份。系統管理員不因名稱自動取得財務權限。 |
| Customer Management | 提供Customer ID、Legal Name、有效Billing Address／Contact、Currency、Payment Term及Credit Policy；AR保存交易快照並計算可變餘額。 |
| Sales Order Management | 提供SO、Line、Customer、Currency、Payment Term及價格快照，以及未開票銷售承諾；AR提供Exposure及Invoice下游狀態。 |
| Fulfillment & Shipping | 提供`SHIPPED` Shipment／Line、出貨數量及來源映射；Invoicing提供是否已開票、已貸項及可否Reversal的下游狀態。 |
| Item Management | 提供SKU ID、Code、Name及UOM顯示資料；已確認Invoice使用快照，不因Item改名而改寫。 |
| Currency／Payment Terms | 提供有效幣別、顯示精度及付款條款計算規則；本模組不維護FX。 |
| Reporting／Audit | 只讀取正式財務記錄及來源關聯，不得改寫Invoice、Credit、Receipt或餘額。 |
| 未來Accounting | 可讀取正式財務事件建立分錄；本期不假設分錄已存在或以其結果決定AR。 |
| 未來Returns／Refund | Customer Return及實際退款使用獨立流程；不得把Shipment Reversal或Receipt Reversal當作退貨退款。 |

---

## 3. 名詞定義

| 名詞 | 定義 |
| --- | --- |
| Invoice | 向單一Customer發出的正式應收文件，可源自一至多張完整Shipment或受控Manual Invoice。 |
| Shipment-based Invoice | 以已出貨Shipment及SO商業快照建立的Invoice。 |
| Manual Invoice | 沒有Shipment來源的受控財務例外文件；不產生Sales、Fulfillment或Inventory效果。 |
| Invoiceable Shipment | 已`SHIPPED`、未`REVERSED`、尚未被其他有效Invoice完整claim，且沒有處理中開票操作的Shipment。 |
| Invoice Claim | 防止同一Shipment被兩個Draft／批次同時納入的可追溯占用關係。 |
| Invoice Line Source | Invoice Line對一條或多條Shipment Lines的數量及金額映射。 |
| Credit Note | 參照一張正式Invoice及其Lines，減少Customer應收的正式貸項文件。 |
| Customer Credit Balance | 已正式Credit Note超過原Invoice當前未收額後，可套用至同Customer、同Currency其他Invoice的餘額。 |
| Receipt | 公司實際收到客戶款項的正式記錄，不等同銀行對賬結果。 |
| Receipt Allocation | 把Receipt金額核銷至一張Invoice的關係，可在開放期間受控解除及重新分配。 |
| Unallocated Receipt | 已確認Receipt尚未核銷至Invoice的餘額，可保留為Customer-level款項。 |
| Outstanding Amount | 正式Invoice有效金額，扣除有效Credit及已核銷Receipt後仍須收取的金額。 |
| Overdue Amount | 截至指定As-of Date，Due Date已過且Outstanding Amount大於零的金額。 |
| Settlement Status | 由有效Credit及Receipt計算的OPEN、PARTIALLY_SETTLED或SETTLED狀態；與Invoice文件狀態分開。 |
| Credit Exposure | Customer未收Invoice及已確認未開票SO承諾，扣除可用Receipt與Credit Balance後的信用風險金額。 |
| Customer Statement | 指定Customer、Currency及As-of Date的期初、交易、核銷、餘額及Aging摘要。 |
| AR Close Date | 已完成應收結算的截至日期；該日及以前不得新增或回溯改變財務結果。 |
| Opening AR | 上線時從舊系統受控匯入的未收Invoice及Customer Credit Balance。 |
| Active Store | 日常交易及高頻查詢使用的財務資料區。 |
| Archive Store | 保存符合政策的歷史財務aggregate、支援較低頻唯讀查詢及匯出的資料區。 |
| Permanent Source Index | 在Active／Archive之間穩定解析SO、Shipment、Invoice、Credit及Receipt來源的不可重用索引。 |

---

## 4. 角色、權限與責任

| 角色 | 主要責任 | 建議權限 |
| --- | --- | --- |
| 財務查閱者 | 查看Invoice、Credit、Receipt、Customer Account、Aging、Statement及一般Audit。 | `ar.view` |
| 開票人員 | 建立／修改／取消Invoice Draft、執行單張及批量確認、列印及下載。 | `ar.view`＋`invoice.mgmt` |
| 發票改價人員 | 在Shipment-based Draft偏離SO價格並輸入原因。 | `ar.view`＋`invoice.mgmt`＋`invoice.price.override` |
| 貸項管理員 | 建立、確認及在合法條件下作廢Credit Note；管理Credit Balance應用。 | `ar.view`＋`ar.credit.mgmt` |
| 收款管理員 | 建立及確認Receipt、核銷、重新核銷及沖銷。 | `ar.view`＋`ar.receipt.mgmt` |
| 應收設定管理員 | 維護公司開票資料、收款銀行帳戶、文件前綴及AR關帳日。 | `ar.view`＋`ar.settings` |
| 期初資料匯入員 | 下載模板、上傳、預檢及確認Opening AR批次。 | `ar.view`＋`ar.opening.import` |
| 應收匯出人員 | 建立大型CSV匯出及下載自己有權查看的結果。 | `ar.view`＋`ar.export` |
| 銷售人員 | 在Sales查看Customer信用摘要及相關Invoice狀態，不維護財務單據。 | Sales權限及安全的AR projection |
| 系統營運人員 | 監察背景Job、卡住操作、對賬及Archive；不自動取得業務內容修改權。 | 固定營運權限／服務身份 |
| 系統管理員 | 配置角色與權限；不因角色名稱自動取得Invoice、Credit、Receipt、銀行或匯入權限。 | 按職責明確授予 |

權限互不自動繼承。`invoice.mgmt`不包含`invoice.price.override`、`ar.credit.mgmt`、`ar.receipt.mgmt`、`ar.settings`、`ar.opening.import`或`ar.export`。所有授權由後端執行；隱藏前端按鈕不能取代後端檢查。

本期不要求另一人審批。只要使用者具相應確認權限，可確認自己建立的Invoice、Credit Note或Receipt；不可因此省略原因、重新認證、版本、關帳日或Audit控制。

---

## 5. 核心業務原則

1. **出貨事實是正常開票來源。** 只有`SHIPPED`且未`REVERSED` Shipment可建立Shipment-based Invoice。
2. **一張Shipment只可有效開票一次。** Draft claim、批量操作、重送或並發不得造成重複Invoice。
3. **Shipment不可部分開票。** 被選中的Shipment須把全部尚未開票Lines及數量納入同一Invoice。
4. **Invoice可跨SO及Warehouse。** 合併只按Customer及開票條件，不按物流倉庫限制；來源映射不得遺失。
5. **Draft不形成應收。** Invoice只有在正式確認並取得不可重用號碼後才影響AR及Credit Exposure分類。
6. **文件狀態與結算狀態分開。** Invoice是否正式／作廢不可由是否已付款代替。
7. **價格差異必須明示。** Shipment-based Draft預設SO價格；偏離只限獨立權限、確認前及必填原因。
8. **正式文件不可覆寫。** 正式Invoice、Credit Note及Receipt不直接修改或刪除；使用作廢、貸項、重配或沖銷。
9. **貸項不改物流。** Credit Note只調整AR；不增加庫存、不Reverse Shipment、不修改SO。
10. **收款事實與核銷選擇分開。** Receipt可存在未核銷餘額；配對錯誤可重配，收款本身錯誤才整張沖銷。
11. **Customer及Currency不可跨越。** Invoice只屬一個Customer及一種Currency；Receipt、Credit只可核銷同Customer、同Currency資料。
12. **不用浮點推算金額。** 所有金額按Currency精度及統一四捨五入規則保存、顯示及匯出。
13. **快照保留歷史。** Customer、地址、聯絡、SKU、UOM、SO價格或公司資料日後修改，不改寫已正式文件。
14. **期初資料是受控例外。** Opening AR可沒有Shipment來源，但必須有來源批次、舊系統參考及完整Audit。
15. **關帳結果不可回溯漂移。** AR Close Date及以前不得新增或改變財務效果；更正使用目前開放日期。
16. **信用計算不可重複。** SO轉Invoice時只把Exposure由未開票承諾轉為正式AR，不得同時計兩次。
17. **既有債權可繼續處理。** Suspended或Credit Hold Customer仍可為既有Shipment開票、Credit及收款；新Manual Invoice要求Active Customer。
18. **歸檔生命週期獨立。** 未收Invoice不阻止來源SO歸檔；Active／Archive連結由永久索引解析。
19. **所有業務命令可安全重送。** 雙擊、逾時及重試不得重複確認、貸項、收款、核銷或匯入。
20. **讀取沒有業務副作用。** 查看、列印、PDF及匯出不得改變Settlement、最後業務更新或歸檔資格。

---

## 6. 資料概念模型

### 6.1 關係概覽

```text
Sales Order 1 ──< Shipment 1 ──< Shipment Line
                      │                 │
                      └── Invoice Claim ┴──< Invoice Line Source
                                                │
Customer 1 ──< Invoice 1 ──< Invoice Line ──────┘
                    │              │
                    │              └──< Credit Note Line
                    ├──< Credit Note
                    └──< Receipt Allocation >── Receipt

Customer + Currency ── Unallocated Receipt / Credit Balance
AR Settings ── Company Profile / Bank Accounts / Sequences / Close Date
Active Store ── Permanent Source Index ── Archive Store
```

### 6.2 Invoice Header

| 欄位概念 | 必填 | 業務說明 |
| --- | --- | --- |
| Invoice ID | 是 | 系統產生且不可重用的內部識別；不是可修改業務號碼。 |
| Invoice Number | 正式確認時 | 按年度及Invoice前綴產生；公司內唯一，作廢後仍保留。 |
| Invoice Type | 是 | `SHIPMENT`、`MANUAL`或`OPENING`；對客及內部畫面清楚標示。 |
| Customer | 是 | 單一Customer ID；保存Code及Legal／Display Name快照。 |
| Currency | 是 | 單一Currency；Shipment-based沿用SO快照，Manual／Opening明確選擇。 |
| Invoice Date | 是 | 不可在未來或已關帳期間；Shipment-based不得早於最晚來源Shipment Date。 |
| Payment Term Snapshot | 否 | Shipment-based沿用SO快照；未設定時保持空白，不猜測條款。 |
| Due Date | 是（正式確認時） | 有Payment Term按規則計算；沒有時由財務明確輸入。可在確認前有因覆寫。 |
| Billing Address Snapshot | 否 | 預選有效默認Billing Address；缺少仍可確認，不建立臨時主檔地址。 |
| Billing／AR Contact Snapshot | 否 | 預選有效用途聯絡人；缺少不阻止確認。 |
| Company Profile Snapshot | 正式確認時 | 保存當時公司抬頭、地址、聯絡及文件顯示資料。 |
| Receiving Bank Snapshot | 否 | 選用公司收款帳戶的對客必要資料；不包含客戶銀行資料。 |
| Customer Reference／PO摘要 | 否 | 從來源SO帶入或於Manual Draft填寫；不作唯一識別。 |
| Internal Note | 否 | 只供內部查看，不出現在對客文件；不得保存支付憑證秘密。 |
| Customer-facing Note | 否 | 出現在PDF前須防公式／腳本及不可執行內容。 |
| Subtotal／Total | 是 | 本期無Tax／Discount；Total等於有效Lines金額總和。 |
| Document Status | 是 | `DRAFT`、`ISSUED`或`VOID`。 |
| Settlement Status | 系統 | `OPEN`、`PARTIALLY_SETTLED`或`SETTLED`；由正式Credit及Receipt計算。 |
| Version | 是 | 防止兩名使用者或背景Job無聲覆蓋。 |
| Created／Updated／Issued／Voided | 系統 | 保存操作者、時間、原因、Correlation及原始／系統Actor。 |
| Archive Location | 系統 | Active或Archive唯一位置及歸檔批次。 |

### 6.3 Invoice Line及來源映射

| 欄位概念 | 必填 | 業務說明 |
| --- | --- | --- |
| Invoice Line ID／Line Number | 是 | Invoice內穩定識別及對客顯示順序。 |
| Description | 是 | Shipment-based預設SKU名稱快照；Manual可自由輸入安全文字。 |
| SKU | Shipment-based必填 | 保存SKU ID、Code、Name及UOM快照；Manual可選填參考SKU。 |
| UOM | Shipment-based必填 | 已出貨Base Quantity可被SO Sales UOM factor整除時沿用Sales UOM，否則以Base UOM顯示；保存兩者換算快照。 |
| Quantity | 是 | 大於0；Shipment-based等於完整來源已出貨Base Quantity的相等交易數量，不可刪減。 |
| Original Unit Price | Shipment-based必填 | 沿用SO Unit Selling Price；改用Base UOM顯示時按原UOM factor精確換算並保留原價快照。 |
| Invoice Unit Price | 是 | 預設Original；只可由改價權限在Draft有因變更，不得為負數。 |
| Line Amount | 是 | 按Quantity、Invoice Unit Price及Currency規則計算。 |
| Price Override | 條件必填 | 偏離時保存原價、新價、差額、原因、Actor及時間。 |
| Source Mapping | Shipment-based必填 | 保存每條Shipment Line、SO Line、數量及金額分配；合併顯示不能破壞映射。 |
| Credited Amount | 系統 | 從有效Credit Note Lines計算，不直接編輯。 |

同一Invoice內相同SKU、UOM及Invoice Unit Price可在對客PDF合併顯示；內部來源映射仍逐Shipment Line保存。不同價格不可為了縮短文件而平均或合併。

### 6.4 Credit Note及Credit Balance

Credit Note至少包含：Credit Note ID／Number、原Invoice、Customer、Currency、Credit Date、Reason Code、Reason、Document Status、Total、Version、建立／確認／作廢資料及Audit。

每條Credit Note Line必須引用原Invoice Line，保存貸項數量、單價／金額、原因及來源Shipment Line分配。貸項可處理價格讓減、少貨、壞帳、尾差或其他經批准原因，但不代表貨物已退回。

業務限制：

- Credit Note只可引用一張`ISSUED` Invoice，Customer及Currency不可修改。
- 累計有效Credit不得超過原Invoice及Line的可貸項金額。
- Credit先降低原Invoice Outstanding；超出當前Outstanding的部分形成Customer Credit Balance。
- Credit Balance只可應用至同Customer、同Currency的`ISSUED`且未結清Invoice。
- 已應用Credit可在開放期間解除及重新應用；所有變動保留歷史。
- 錯誤Credit Note如沒有未解除的應用，可在開放期間作廢並恢復相應餘額；不得直接改寫已確認內容。
- 若需Reverse合併Invoice中的個別Shipment，該Shipment所有來源映射金額必須先被有效Credit完全歸零。

### 6.5 Receipt及Allocation

Receipt至少包含：Receipt ID／Number、Customer、Currency、Receipt Date、Amount、Payment Method、公司收款帳戶、外部Reference、狀態、未核銷餘額、Version、確認／沖銷資料及Audit。

| Payment Method | 必要資料 |
| --- | --- |
| Bank Transfer | 有效公司收款銀行帳戶及銀行交易參考。 |
| Cash | 收款日期及金額；可選內部收據參考。 |
| Cheque | Cheque Number；公司收款帳戶可選。 |
| Other | 必填方式說明／原因及外部參考。 |

Receipt Allocation保存Receipt、Invoice、分配金額、分配／解除操作者、時間及原因。規則如下：

- Receipt Amount必須大於0；確認後才形成可核銷款項。
- 一張Receipt可部分核銷一張Invoice，亦可核銷同Customer及Currency的多張Invoice。
- Allocation不得超過Receipt可用餘額或Invoice Outstanding。
- 未分配金額保留為Unallocated Receipt，不強迫即時用完。
- 配對錯誤可在未關帳期間解除指定Allocation並重新分配；不改Receipt原始事實。
- Customer、Currency、Receipt Amount、Payment Method或付款憑證資料錯誤時，須解除全部Allocation後整張沖銷。
- Receipt Reversal以Reversal Date產生正式反向Allocation效果並恢復目前Invoice Outstanding，不刪除原Receipt或抹去Allocation在Reversal前的歷史效果。
- 本期不聲稱Receipt已完成銀行對賬，也不保存Payment Gateway憑證。

### 6.6 AR Settings及公司資料

本模組提供精簡設定，不等待未來Company Settings：

- 公司法定／顯示名稱、地址、電話、Email及Invoice／Credit Note頁尾資料。
- 每個Currency可有多個有效公司收款銀行帳戶及一個默認帳戶。
- 銀行帳戶包含銀行名稱、帳戶名稱、遮蔽／完整帳號、SWIFT／Bank Code等必要顯示資料及狀態。
- Invoice、Credit Note及Receipt各自的文件前綴；年度流水號由系統維護，不容許人工指定下一號。
- 單一AR Close Date；只可向前推進，重開或倒退不屬一般設定操作。
- Aging分桶固定為Current、1–30、31–60、61–90及90+日；第一版不提供任意分桶設計器。
- 修改公司資料、銀行、文件前綴或Close Date須輸入原因及Audit；高風險資料須重新認證。

### 6.7 Import、Job、Audit及Archive概念

| 概念 | 最低業務資料 |
| --- | --- |
| Opening Import Batch | Batch ID、Template Version、來源檔摘要、狀態、總數／有效／錯誤／成功數、Actor、時間及結果檔。 |
| Invoice Batch Job | Job ID、選取條件／明確Shipment集合、分組摘要、狀態、成功／失敗數、錯誤及重試資料。 |
| Export Job | Job ID、Owner、查詢條件、範圍、狀態、筆數、結果到期及下載Audit。 |
| Operation Outcome | Event／Idempotency Key、Payload摘要、業務結果、處理狀態、Correlation及安全重查結果。 |
| Audit Event | Aggregate、Action、Actor、時間、原因、前後摘要、Outcome及Correlation；不可由使用者修改。 |
| Archive Batch | Cutoff、候選、成功、跳過、失敗、count／hash校驗、位置及恢復證據。 |
| Permanent Source Index | SO、Shipment、Invoice、Credit、Receipt及Archive位置的唯一解析關係。 |

### 6.8 金額、日期及快照

- JSON、CSV及文件中的金額須使用精確十進制字串語意，不得以二進制浮點造成顯示與保存差異。
- 金額不得為負；反向效果由Credit Note、Void或Receipt Reversal表達，不以負Invoice／Receipt代替。
- 每個Currency的精度及四捨五入規則在Draft、確認、PDF、CSV、Statement及Exposure一致。
- Invoice Date、Due Date、Credit Date、Receipt Date、Close Date及As-of Date是業務日期；Audit時間保存標準時間並按使用者時區顯示。
- Void、Credit Void、Allocation解除及Receipt Reversal各自保存Effect Date；歷史As-of計算按事件在當時是否已生效，而不是只看目前狀態。
- 正式確認時保存Customer、Billing、Contact、Company、Bank、Currency、Payment Term、SKU、UOM、價格及來源文件必要快照。
- Snapshot只為還原歷史；不得被當作最新Customer／Item主資料供新交易選擇。

---

## 7. 狀態與核心流程

### 7.1 Invoice文件狀態

| 狀態 | 意義 | 主要允許操作 |
| --- | --- | --- |
| `DRAFT` | 尚未形成正式債權及正式號碼。 | 修改允許欄位、改價、重新分組、取消Draft、確認。 |
| `ISSUED` | 已正式確認及形成AR。 | 查看、列印、下載、收款核銷、Credit、符合條件時Void。 |
| `VOID` | 整張正式Invoice失效但歷史及號碼保留。 | 唯讀、列印作廢副本及追溯；不可恢復或再收款。 |

取消未確認Draft不等同Void；取消後釋放Shipment Claims且不取得正式Invoice Number。正式Invoice只可在沒有有效Receipt／Credit應用、未關帳及來源規則允許時整張Void。

### 7.2 Invoice結算狀態

| 狀態 | 計算結果 |
| --- | --- |
| `OPEN` | 尚未有有效Receipt／Credit降低Outstanding，且Outstanding大於0。 |
| `PARTIALLY_SETTLED` | 有效Receipt／Credit已降低部分金額，Outstanding仍大於0。 |
| `SETTLED` | Outstanding等於0。 |

Settlement Status由有效交易計算，不由使用者直接選擇。Void Invoice不參與Outstanding及Aging，畫面須顯示`VOID`而不是假裝`SETTLED`。

### 7.3 Credit Note狀態

```text
DRAFT ──> ISSUED ──> VOID
  └────────> CANCELLED（未正式確認，不取正式號碼）
```

正式Credit Note另有`UNAPPLIED`、`PARTIALLY_APPLIED`或`APPLIED`的應用摘要；它是餘額結果，不取代文件狀態。

### 7.4 Receipt狀態

```text
DRAFT ──> CONFIRMED ──> REVERSED
  └────────> CANCELLED（未正式確認，不取正式號碼）
```

Confirmed Receipt可為`UNALLOCATED`、`PARTIALLY_ALLOCATED`或`FULLY_ALLOCATED`；Allocation狀態不改變Receipt已收到款項的事實。

### 7.5 標準Shipment開票流程

1. 財務人員進入待開票Workbench，按Customer、Shipment Date、SO、Warehouse、Channel或Currency篩選。
2. 系統只顯示合資格Shipment及不能開票的可理解原因。
3. 使用者選擇一張Shipment快速建立Invoice，或選擇多張相容Shipment預覽合併。
4. 系統原子claim所選Shipment，按Customer／Currency／Billing／Payment Term／Invoice Date分組並建立Draft。
5. 系統帶入SO價格、來源、Payment Term、Billing／Contact默認值及公司收款資料。
6. 使用者補充Due Date、可選Billing資料、Notes及具權限的價格覆寫。
7. 確認時系統重新驗證權限、版本、關帳日、Shipment及Customer所有權、來源數量、價格及防重。
8. 確認成功後取得正式Invoice Number，在一個完整業務操作內形成AR、更新來源索引及Audit。
9. 使用者可查看、列印或下載PDF；查詢及列印不改變業務狀態。

### 7.6 批量開票流程

1. 使用者以明確篩選及選取建立批量工作，預覽分組數、Shipment數、金額及不相容原因。
2. 系統保存不可變的選取集合或可重現條件，避免背景執行時範圍暗中擴大。
3. 大型批次在背景逐Invoice Group處理；每組全有或全無，不同組互不回滾。
4. 每張成功Invoice取得唯一號碼；失敗組保留錯誤、來源及可安全重試狀態。
5. 批量確認再次驗證每張Draft；合法Invoice不因其他Draft失敗而被回滾。
6. 使用者可離開頁面再查看進度、結果、失敗原因及Invoice連結。

### 7.7 Credit Note及Shipment Reversal協作流程

1. 財務從正式Invoice建立Credit Note Draft並選擇原Invoice Lines。
2. 輸入貸項數量／金額、Reason Code及具體原因，預覽Invoice Outstanding及Credit Balance影響。
3. 確認時重驗原Invoice、可貸項金額、關帳日、權限、版本及並發Credit。
4. 確認成功後形成正式Credit Note並原子更新AR及Exposure。
5. 如Credit是為了更正錯誤Shipment，系統按來源映射判定該Shipment是否已完全財務歸零。
6. 只有相關來源行完全貸項、沒有處理中財務操作且其他Fulfillment條件成立時，才向Fulfillment回報可Reverse。
7. Credit Note不自動Reverse Shipment；Warehouse仍須執行獨立的Fulfillment Reversal。

### 7.8 Receipt及核銷流程

1. 財務選擇Customer及Currency，輸入Receipt Date、Amount、Payment Method及相應憑證。
2. 可在Draft選擇一至多張未結清Invoice及分配金額，或先保存未分配款。
3. 確認時重驗Customer、Currency、公司銀行、Invoice Outstanding、關帳日及版本。
4. 確認成功後形成正式Receipt，逐Allocation降低Invoice Outstanding；剩餘成為Unallocated Receipt。
5. 配對錯誤時可在開放期間解除及重新分配，不修改Receipt Amount或原始付款資料。
6. Receipt本身錯誤或退票時，以開放期間的Reversal Date整張沖銷；系統原子產生全部反向Allocation效果並恢復目前Invoice餘額。
7. 系統不把Receipt確認等同銀行對賬完成。

### 7.9 Opening AR匯入流程

1. 匯入員下載當前版本模板及欄位說明。
2. 上傳CSV後只進行預檢，不立即建立財務記錄。
3. 系統按來源Document Key組合Rows，驗證Customer、Currency、日期、金額、唯一性、公式注入及關帳邊界。
4. 預檢顯示Valid、Invalid、Duplicate及Warning；同一來源文件任何Line錯誤則整張失敗。
5. 使用者確認後，系統逐來源文件獨立建立`OPENING` Invoice或Credit Balance。
6. 合法來源可成功、錯誤來源保留結果；安全重送不得重複建立。
7. 每張期初記錄保存舊系統Reference、Batch及來源摘要，不建立Shipment／Inventory結果。

### 7.10 AR關帳流程

1. 設定管理員查看目標日期前的未完成Draft、處理中操作及對賬差異。
2. 存在會改變目標期間結果的未完成事項時阻止關帳並列出原因。
3. 使用者輸入原因、重新認證及確認後，把AR Close Date向前推進。
4. 關帳後，Invoice、Credit、Receipt、Allocation、Reversal及Opening資料不得使用Close Date或更早日期新增或回寫。
5. 歷史錯誤在目前開放日期以正式更正文件處理；本期不提供一般重開已關帳期間。

---

## 8. 功能需求

需求優先級定義：`Must`為第一版不可缺少；`Should`為仍屬本期且應在正式發布前完成，只有Product Owner書面接受的例外才可延後。本文件沒有以`Could`預先包裝未確認功能。

### 8.1 Invoicing & AR Settings

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-SET-001 | Must | 具`ar.settings`的使用者可查看及修改本模組設定；其他使用者只能取得交易所需的安全projection。 |
| FR-SET-002 | Must | 系統須維護公司開票抬頭、地址、一般聯絡資料及文件頁尾；正式文件保存當時快照。 |
| FR-SET-003 | Must | 系統須維護多個公司收款銀行帳戶、Currency、狀態及每種Currency最多一個默認帳戶。 |
| FR-SET-004 | Must | 完整銀行帳號只向獲授權流程及使用者顯示；一般列表、Audit、Log及錯誤只顯示遮蔽值。 |
| FR-SET-005 | Must | Invoice、Credit Note及Receipt各有受控前綴及年度獨立流水號；已發出的號碼不得修改或重用。 |
| FR-SET-006 | Must | 修改文件前綴只影響未來正式文件，不改寫已發出號碼或PDF快照。 |
| FR-SET-007 | Must | 系統須維護單一AR Close Date；向前推進須輸入原因、重新認證及記錄Audit。 |
| FR-SET-008 | Must | 關帳前須檢查會影響目標期間的處理中Invoice、Credit、Receipt、Allocation、Import及對賬差異，存在時阻止並列出原因。 |
| FR-SET-009 | Must | 第一版Aging分桶固定為Current、1–30、31–60、61–90及90+，不得由一般使用者建立矛盾分桶。 |
| FR-SET-010 | Should | 設定頁須顯示目前值、最後修改人／時間及變更歷史，不把完整銀行資料放入一般歷史projection。 |

### 8.2 待開票Workbench

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-WB-001 | Must | 具`invoice.mgmt`的使用者可查看所有渠道中已`SHIPPED`且仍可開票的Shipment。 |
| FR-WB-002 | Must | `PICKED`、`SHIPPING`、`REVERSED`、已完整開票或存在衝突Claim的Shipment不得顯示為可選。 |
| FR-WB-003 | Must | Workbench須支援按Shipment／SO Number、Customer、Shipment Date、Channel、Warehouse、Currency及開票狀態搜尋或篩選。 |
| FR-WB-004 | Must | 列表至少顯示Shipment、SO、Customer、日期、Warehouse、Currency、Lines、金額預覽及不能開票原因。 |
| FR-WB-005 | Must | 使用者可從一張Shipment快速建立Draft，或明確選擇多張Shipment建立合併預覽。 |
| FR-WB-006 | Must | 系統須檢查Customer、Currency、Billing Address選擇、Payment Term及Invoice Date相容性，不得靜默合併不同條件。 |
| FR-WB-007 | Must | 若選取資料可分成多個合法Invoice Group，預覽須列出每組及分組原因，使用者確認後才建立。 |
| FR-WB-008 | Must | 建立Draft時須原子claim全部選中Shipment；任一Shipment已被他人claim時整組不得留下部分Draft。 |
| FR-WB-009 | Must | Claim須有明確持有人、Draft／Job來源及可恢復狀態；取消Draft或確定失敗後安全釋放。 |
| FR-WB-010 | Must | 同一建立請求重送須返回原Draft／Job結果，不得建立第二組Claims或Invoice。 |
| FR-WB-011 | Should | 使用者可查看「我的Draft／最近批次」及因衝突被其他工作處理的安全提示。 |

### 8.3 Shipment-based Invoice Draft

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-INV-001 | Must | 一張Shipment-based Invoice須屬於一個Customer及一種Currency，可引用一至多張完整Shipment。 |
| FR-INV-002 | Must | 每張被選Shipment的所有尚未開票Lines及完整數量須納入；不得按Line或Quantity部分開票。 |
| FR-INV-003 | Must | Invoice Line須保留至SO Line及Shipment Line的數量／金額映射，即使PDF合併顯示亦不可丟失。 |
| FR-INV-004 | Must | 系統須帶入Customer、Currency、Payment Term、SKU、UOM、Unit Price、SO／Shipment及其他必要快照。 |
| FR-INV-005 | Must | Billing Address及Billing／AR Contact均為選填；有有效默認值時預選，缺少時仍可確認且不得猜測臨時資料。 |
| FR-INV-006 | Must | Payment Term有值時按其快照計算Due Date；沒有時保持「未設定」並要求使用者明確輸入Due Date。 |
| FR-INV-007 | Must | Due Date可在Draft有因覆寫；不得早於Invoice Date。 |
| FR-INV-008 | Must | Invoice Date預設當日，不得早於最晚來源Shipment Date、不得晚於當日或落在已關帳期間。 |
| FR-INV-009 | Must | Draft可修改Invoice Date、Due Date、Billing／Contact選擇、公司收款帳戶、Notes及其他不改變來源事實的欄位。 |
| FR-INV-010 | Must | Shipment-based Quantity、Customer、Currency、SKU、UOM及來源映射不可在Draft任意修改；需要變更時取消並重新選取來源。 |
| FR-INV-011 | Must | Unit Price預設SO快照；只有具`invoice.price.override`者可在Draft修改，且須保存原值、新值、差額及原因。 |
| FR-INV-012 | Must | Invoice Unit Price不得為負；零價格可以保存，但確認前須明確警告。 |
| FR-INV-013 | Must | 同SKU、同UOM及同Invoice Unit Price可在對客文件合併顯示；不同價格不得平均或合併。 |
| FR-INV-014 | Must | 取消Draft須釋放Claims且不形成AR、不取得正式Invoice Number；取消歷史仍可追溯。 |
| FR-INV-015 | Must | 多人修改同一Draft時須使用Version防止後提交者無聲覆蓋。 |
| FR-INV-016 | Must | Shipment Base Quantity可被SO Sales UOM factor整除時，Invoice沿用Sales UOM及原Unit Price；不可整除時使用Base UOM及等值原價，不得多收整個Pack。 |
| FR-INV-017 | Must | 同一SO Line分批Shipment的原始可開票金額須按已出貨Base Quantity一致分配；累計不得超過SO Line Amount，最後一批承接確定性四捨五入尾差。 |

### 8.4 Manual Invoice

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-MAN-001 | Must | 具`invoice.mgmt`者可為Active Customer建立明確標示為`MANUAL`的Invoice Draft。 |
| FR-MAN-002 | Must | Manual Invoice必須輸入建立原因及最少一個Line；不得假裝具有SO或Shipment來源。 |
| FR-MAN-003 | Must | Manual Line須有安全文字Description、正數Quantity、非負Unit Price及UOM顯示值。 |
| FR-MAN-004 | Must | Manual Line可選填SKU作參考；選填不產生Reservation、Shipment、Inventory Movement或SO結果。 |
| FR-MAN-005 | Must | Manual Invoice須明確選擇Currency；Customer Default Currency可作預設但不得暗中轉換其他幣別。 |
| FR-MAN-006 | Must | Manual Invoice遵守相同Due Date、Billing選填、Close Date、編號、確認、Credit、Receipt、Audit及Archive規則。 |
| FR-MAN-007 | Must | Suspended、Blocked或Archived Customer不可建立新Manual Invoice，但不阻止處理既有正式債權。 |

### 8.5 Invoice批量及正式確認

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-BATCH-001 | Must | 使用者可批量建立及批量確認Invoice；大型範圍使用背景Job，不以單一長時間HTTP操作處理。 |
| FR-BATCH-002 | Must | 建立前須預覽Invoice Group數、Shipment數、Customer、Currency、日期、金額及錯誤／警告。 |
| FR-BATCH-003 | Must | 批次須保存明確來源集合或可重現的有界條件，背景執行不得把後來新增Shipment暗中加入。 |
| FR-BATCH-004 | Must | 每個Invoice Group全有或全無；不同Group獨立成功或失敗，不得因一組錯誤回滾已成功組。 |
| FR-BATCH-005 | Must | Batch Job須顯示Queued、Processing、Partially Completed、Completed或Failed，以及成功、失敗、跳過及處理中數量。 |
| FR-BATCH-006 | Must | 每個失敗結果須指出Customer／Shipment、錯誤原因及可否重試；不得要求使用者從Log猜測。 |
| FR-BATCH-007 | Must | 單張及批量確認須重新驗證權限、Version、Close Date、Customer所有權、Shipment狀態、Claims、來源映射、價格及Due Date。 |
| FR-BATCH-008 | Must | 確認成功須原子形成`ISSUED` Invoice、正式號碼、AR結果、來源索引、狀態歷史及Audit。 |
| FR-BATCH-009 | Must | 確認重送、雙擊、逾時或結果不明時，可用原Request／Event查回唯一結果，不得再次開票。 |
| FR-BATCH-010 | Must | 技術失敗不得留下顯示`ISSUED`但沒有完整AR／來源映射，或有AR但Invoice仍為Draft的部分結果。 |
| FR-BATCH-011 | Must | 正式Invoice不可修改Header、Lines、價格、Customer、Currency、日期或來源；可修改的內部跟進備註須另有Audit且不改文件快照。 |
| FR-BATCH-012 | Must | 沒有有效Credit或Receipt關聯、位於開放期間且來源允許時，可整張Void正式Invoice；須原因、確認及Audit。 |
| FR-BATCH-013 | Must | Void保留Invoice Number、原快照、Lines、來源及PDF標記，並原子撤銷AR效果及釋放可再次開票的來源。 |

### 8.6 Credit Note及Customer Credit

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-CN-001 | Must | 具`ar.credit.mgmt`者可從`ISSUED` Invoice建立Credit Note Draft；一張Credit Note只引用一張Invoice。 |
| FR-CN-002 | Must | Credit Note須選擇Reason Code、輸入具體原因及最少一個原Invoice Line。 |
| FR-CN-003 | Must | 每條Credit須保存原Invoice Line、貸項Quantity、Unit Amount／Credit Amount及對來源Shipment Lines的分配。 |
| FR-CN-004 | Must | 累計有效Credit不得超過原Invoice Line及Invoice的可貸項總額；並發確認不得突破上限。 |
| FR-CN-005 | Must | Credit Date不得在未來、不得落入已關帳期間，且不得早於原Invoice Date。 |
| FR-CN-006 | Must | Credit確認須原子取得正式號碼、更新Invoice Outstanding／Settlement、Customer Credit Balance、Exposure、History及Audit。 |
| FR-CN-007 | Must | Credit先降低原Invoice Outstanding；多出的有效金額成為同Customer、同Currency的Credit Balance。 |
| FR-CN-008 | Must | Credit Balance可部分或全部套用至同Customer、同Currency其他未結清Invoice，不可跨Customer或Currency。 |
| FR-CN-009 | Must | Credit應用可在開放期間解除及重新套用；不得令任何Invoice Outstanding低於零。 |
| FR-CN-010 | Must | Credit Note不產生Inventory Movement、Shipment Reversal、SO數量變更或實際退款。 |
| FR-CN-011 | Must | 錯誤Credit Note在所有應用已解除、期間開放且沒有下游衝突時可Void；不得直接修改正式內容。 |
| FR-CN-012 | Must | 壞帳及尾差以受控Reason Code的Credit Note處理；本期不建立獨立Write-off交易。 |
| FR-CN-013 | Must | 局部Shipment Reversal前，系統須證明該Shipment所有Invoice來源金額已被有效Credit完全歸零。 |

### 8.7 Receipt、核銷、重新核銷及沖銷

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-REC-001 | Must | 具`ar.receipt.mgmt`者可建立Receipt Draft，選擇Customer、Currency、Receipt Date、Amount及Payment Method。 |
| FR-REC-002 | Must | Receipt Amount須大於0；日期不得在未來或已關帳期間。 |
| FR-REC-003 | Must | Bank Transfer須選有效同Currency公司銀行帳戶及輸入Transaction Reference；Cheque須輸入Cheque Number；Other須輸入方式說明。 |
| FR-REC-004 | Must | 一張Receipt只屬一個Customer及Currency，可在Draft或確認後核銷同Customer、同Currency多張Invoice。 |
| FR-REC-005 | Must | Receipt可部分核銷Invoice；未使用金額保留為Unallocated Receipt，不強制全數分配。 |
| FR-REC-006 | Must | Allocation不得超過Receipt可用餘額或Invoice Outstanding；並發核銷不得造成負數或超額。 |
| FR-REC-007 | Must | Receipt確認須原子建立正式號碼、可用餘額、Allocations、Invoice Settlement、Exposure、History及Audit。 |
| FR-REC-008 | Must | 已確認Receipt的Customer、Currency、Amount、Date、Payment Method及原始憑證不得直接修改。 |
| FR-REC-009 | Must | 配對錯誤可在開放期間解除一至多個Allocation並重新分配；須保存原因及完整前後歷史。 |
| FR-REC-010 | Must | Receipt資料錯誤或退票時須整張Reversal並原子產生全部反向Allocation效果；原Receipt、號碼及Reversal前歷史保留。 |
| FR-REC-011 | Must | Receipt Reversal須原子恢復Invoice Outstanding、Settlement、Unallocated餘額及Exposure，不得形成部分恢復。 |
| FR-REC-012 | Must | 重複確認、核銷、解除、重配或Reversal請求須返回原結果，不得重複影響餘額。 |
| FR-REC-013 | Must | Receipt只代表公司記錄已收款；頁面及匯出不得把它標示為已完成銀行對賬。 |
| FR-REC-014 | Should | Invoice核銷時可按Due Date由舊至新建議分配，但必須由使用者確認且不可跨Customer／Currency。 |

### 8.8 AR查詢、Aging及Customer Statement

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-AR-001 | Must | 使用者可查看Customer Account，分Currency顯示Opening、Invoices、Credits、Receipts、Allocations及Closing Balance。 |
| FR-AR-002 | Must | 可按Invoice／Credit／Receipt Number、Customer、日期、Due Date、狀態、Currency、SO或Shipment精確查詢。 |
| FR-AR-003 | Must | Outstanding清單須顯示原額、有效Credit、已核銷Receipt、Outstanding、Due Date及逾期日數。 |
| FR-AR-004 | Must | Overdue以使用者指定As-of Date及Due Date計算；當日到期不應被提早視為逾期。 |
| FR-AR-005 | Must | Aging須按Customer及Currency分開，顯示Current、1–30、31–60、61–90及90+分桶和總額。 |
| FR-AR-006 | Must | Customer Statement須支援指定Customer、Currency、From／To或As-of Date，顯示期初、期間活動及期末餘額。 |
| FR-AR-007 | Must | Statement須包括Invoice、Credit Note、Receipt、Allocation／解除及Reversal，且數字可回到單據詳情。 |
| FR-AR-008 | Must | Credit Balance及Unallocated Receipt須獨立顯示，不得隱藏在負Outstanding或混成一個不可解釋數字。 |
| FR-AR-009 | Must | Suspended、Blocked及來源已歸檔Customer／SO仍可查看及處理既有AR；新Manual交易限制另按狀態規則。 |
| FR-AR-010 | Must | Active查詢找不到精確單號時可提示到Archive搜尋；不得在每個日常列表自動掃描全部Archive。 |
| FR-AR-011 | Should | 提供常用視圖：My Recent Work、Open Invoices、Overdue、Unallocated Receipts、Available Credits及Exceptions。 |
| FR-AR-012 | Must | 查詢、Statement、PDF及匯出使用同一As-of Date與金額口徑，不能各自計算出不同餘額。 |
| FR-AR-013 | Must | As-of查詢按各交易及反向事件的Effect Date還原當時結果；後來Void／Reversal不得令已關帳歷史期間看似從未發生原交易。 |

### 8.9 Credit Exposure

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-EXP-001 | Must | 系統須按Customer及Credit Currency提供可解釋的Credit Exposure摘要。 |
| FR-EXP-002 | Must | Exposure包括有效未收Invoice及已確認但未正式開票的SO承諾，扣除可用Unallocated Receipt及Credit Balance。 |
| FR-EXP-003 | Must | SO／Shipment轉為正式Invoice時，金額只由未開票承諾分類轉為AR，不得同時計算兩次。 |
| FR-EXP-004 | Must | Draft／Void Invoice、Cancelled SO、已Credit／已核銷部分及Reversed Receipt須按其實際有效結果納入或排除。 |
| FR-EXP-005 | Must | Customer Credit Limit未設定、等於0、正常超額及Credit Hold須保持不同語意。 |
| FR-EXP-006 | Must | 超過Credit Limit時向Sales提供Warning及計算摘要；只有Customer Credit Hold阻止新的賒銷訂單。 |
| FR-EXP-007 | Must | AR依賴不可用或結果不確定時，Sales不得把Exposure假設為0；須清楚提示無法完成可靠信用判斷。 |
| FR-EXP-008 | Must | Suspended／Hold不阻止既有Shipment開票、Credit或收款；新交易限制由Customer／Sales契約執行。 |
| FR-EXP-009 | Should | Customer Account可展開Exposure組成，但一般Sales projection只返回完成信用判斷所需的最少資料。 |

### 8.10 Opening AR CSV匯入

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-OPEN-001 | Must | 具`ar.opening.import`者可下載具版本的CSV模板、欄位定義及安全範例。 |
| FR-OPEN-002 | Must | 模板須支援Opening Invoice Header／Lines及Customer Credit Balance，不支援Receipt、Shipment或Inventory Movement。 |
| FR-OPEN-003 | Must | 來源Document Key在舊系統來源範圍內唯一；安全重送相同內容返回原結果。 |
| FR-OPEN-004 | Must | 預檢須驗證模板版本、編碼、欄位、Customer、Currency、日期、金額、Line總和、唯一性及惡意公式內容。 |
| FR-OPEN-005 | Must | 預檢不得建立Invoice、Credit、AR餘額或占用正式文件號碼。 |
| FR-OPEN-006 | Must | 同一來源文件任何Row錯誤則整張文件Invalid；不同來源文件可部分成功。 |
| FR-OPEN-007 | Must | 使用者確認前須看到Valid、Invalid、Duplicate、Warning、文件數及各Currency金額摘要。 |
| FR-OPEN-008 | Must | 確認時逐來源文件全有或全無建立Opening資料、來源索引及Audit。 |
| FR-OPEN-009 | Must | Opening Invoice使用獨立類型及舊系統號碼參考，不偽造SO／Shipment來源；正式內部號碼仍不可重用。 |
| FR-OPEN-010 | Must | 已確認Opening資料不可由重新上傳覆寫；更正使用正式Void、Credit或Receipt流程。 |
| FR-OPEN-011 | Must | Import Job中斷可安全恢復，已成功來源不重複，失敗來源可修正後重試。 |
| FR-OPEN-012 | Must | 來源及結果檔須私有、限Owner／授權人下載、具保留期限，且Audit至少保留7年。 |

### 8.11 文件、匯出、Audit及歸檔

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-DOC-001 | Must | `ISSUED`及`VOID` Invoice、Credit Note可產生A4友善列印頁及可下載PDF；作廢狀態須明顯。 |
| FR-DOC-002 | Must | 對客文件至少顯示公司、Customer、可用Billing資料、文件號／日期、Due Date、Currency、Lines、總額、SO／Shipment參考及付款資料。 |
| FR-DOC-003 | Must | 缺少Billing Address時文件仍可產生，但不得顯示虛構地址；應保留Customer Legal Name及Code。 |
| FR-DOC-004 | Must | PDF使用正式快照，後續修改Customer、Item、Company或Bank資料不得改變原文件內容。 |
| FR-DOC-005 | Must | 列印、PDF及CSV中的文字須防公式、腳本、HTML及控制字元注入。 |
| FR-DOC-006 | Must | 系統不提供自動Email或電子發票提交；文件下載不應被標示為已寄送客戶。 |
| FR-EXPORT-001 | Must | 具`ar.export`者可匯出其有權查看的Invoice、Outstanding、Aging、Statement、Receipt及Credit資料。 |
| FR-EXPORT-002 | Must | 小型匯出可直接下載；大型匯出使用有界背景Job，顯示進度、結果、失敗及到期時間。 |
| FR-EXPORT-003 | Must | 匯出保存Owner、條件、As-of Date、筆數及下載Audit；不得包含未授權完整銀行資料。 |
| FR-EXPORT-004 | Must | 使用者只可下載自己建立或被授權共享的Export結果；更換Job／File ID不得越權。 |
| FR-AUDIT-001 | Must | 建立、修改Draft、Claim、改價、確認、Void、Credit、Receipt、核銷、解除、重配、Reversal、設定、關帳、匯入、列印、下載、匯出及歸檔均須Audit。 |
| FR-AUDIT-002 | Must | Audit至少記錄Actor、時間、Action、Outcome、原因、來源、安全前後摘要及Correlation；不得保存完整銀行帳號或支付秘密。 |
| FR-AUDIT-003 | Must | 正式History、Audit及來源映射不可由一般使用者修改或刪除。 |
| FR-ARC-001 | Must | Invoice／Credit／Receipt是獨立財務aggregate，不隨單一SO transaction搬移。 |
| FR-ARC-002 | Must | 未收Invoice不阻止來源SO／Fulfillment按既有24個月政策歸檔；永久來源索引須保持雙向可查。 |
| FR-ARC-003 | Must | 待開票Shipment、Invoice Claim、Draft或處理中確認／Credit／Shipment Reversal會阻止不安全的來源歸檔。 |
| FR-ARC-004 | Must | 財務aggregate只有在所有文件及操作處於可歸檔狀態、最後業務更新超過24個月且來源索引完整時才可搬移。 |
| FR-ARC-005 | Must | Invoice Header／Lines／Sources、Credits、Receipts、Allocations、History及必要Audit須按完整aggregate或可證明一致的邊界歸檔。 |
| FR-ARC-006 | Must | Archive寫入、count／hash校驗及routing成功後才可移除Active；中斷或重跑不得重複或遺失。 |
| FR-ARC-007 | Must | Active與Archive各單號、來源SO／Shipment及Customer連結須路由到唯一記錄；Archive只讀。 |
| FR-ARC-008 | Must | 未結清Invoice可長期保留在AR Active而不拖住來源Sales；其來源詳情可經永久索引查看Archive。 |
| FR-ARC-009 | Must | 正式財務資料、來源索引及Audit至少保留7年；本期不提供自動永久銷毀。 |
| FR-ARC-010 | Must | Archive Job、查詢或匯出失敗不得阻止新開票、收款或一般Active查詢。 |
| FR-ARC-011 | Must | 系統須提供Invoice來源、AR餘額、Credit／Receipt應用及Active／Archive routing的定期對賬結果及差異告警。 |

---

## 9. 業務規則

### 9.1 開票來源與合併

| 編號 | 規則 |
| --- | --- |
| BR-001 | Shipment-based Invoice的唯一正常來源是已`SHIPPED`且未`REVERSED` Shipment。 |
| BR-002 | 一張Shipment在任一時間最多屬於一個有效Invoice Claim，且最終只可被一張非Void Invoice完整開票。 |
| BR-003 | Shipment所有尚未開票Lines必須一起納入，不允許留下零碎待開票數量。 |
| BR-004 | 合併Invoice可跨SO及Warehouse，但不可跨Customer、Currency或不一致的Billing／Payment條件。 |
| BR-005 | 合併Invoice仍逐Shipment及SO保存來源，不能只保存顯示摘要。 |
| BR-006 | Invoice Claim不是正式財務結果；取消或確定失敗須釋放，處理中狀態不得被另一工作接管。 |
| BR-007 | Customer後續Suspended或Credit Hold不取消既有Shipment的開票權利；Archived Customer原則上不應有未完成事項，若存在須保留既有債權處理能力並告警。 |

### 9.2 日期、付款條件及價格

| 編號 | 規則 |
| --- | --- |
| BR-008 | Shipment-based Payment Term沿用SO確認快照，不因Customer主檔後續修改而改變。 |
| BR-009 | Payment Term空白保持空白；使用者明確輸入Due Date，不建立虛構的即期條款。 |
| BR-010 | Due Date不得早於Invoice Date；Invoice Date不得早於最晚來源Shipment Date。 |
| BR-011 | 業務日期不得在未來或已關帳期間；技術處理時間不取代業務日期。 |
| BR-012 | Shipment-based Original Unit Price來自SO快照；Invoice改價不回寫SO、Shipment或Item。 |
| BR-013 | 價格覆寫只可在Draft，由獨立權限執行並保存原因；正式確認後不可再改。 |
| BR-014 | 本期`Line Amount = Quantity × Invoice Unit Price`，`Invoice Total = Lines總和`，沒有隱藏Discount或Tax。 |
| BR-015 | Currency規則及四捨五入在所有操作、文件、匯出及報表一致；不得以顯示值重新推算正式餘額。 |

### 9.3 Invoice、Credit及Receipt守恆

| 編號 | 規則 |
| --- | --- |
| BR-016 | 有效Invoice Amount不得為負；零總額Shipment Invoice可確認但須警告，且不形成正數Outstanding。 |
| BR-017 | `Outstanding = max(Issued Invoice Total - Valid Credits Applied - Confirmed Receipt Allocations, 0)`。 |
| BR-018 | Settlement Status只能由Outstanding及有效交易推導，不可人工強制設為Paid。 |
| BR-019 | 累計有效Credit不得超過原Invoice Total；每Line亦不得超過其可貸項金額。 |
| BR-020 | Credit超出原Invoice當前Outstanding的部分成為Customer Credit Balance，不令Invoice變成負Outstanding。 |
| BR-021 | Receipt Allocated Amount加Unallocated Amount必須等於有效Receipt Amount。 |
| BR-022 | 一次核銷、解除或Reversal的全部相關餘額須全有或全無更新。 |
| BR-023 | Credit Balance及Unallocated Receipt不可跨Customer或Currency移動。 |
| BR-024 | Receipt Reversal從Reversal Date起抵銷其全部Allocation效果；更早As-of Date仍顯示當時有效，不得刪除原記錄假裝從未收款。 |
| BR-025 | Credit Note及Receipt可分別有自己的應用狀態，但不改變其正式文件狀態。 |

### 9.4 更正、關帳及跨模組狀態

| 編號 | 規則 |
| --- | --- |
| BR-026 | 未確認Draft可取消；正式文件只能用Void、Credit、解除／重配或Reversal更正。 |
| BR-027 | 整張Invoice Void前須沒有有效Credit、Receipt Allocation或處理中財務操作。 |
| BR-028 | 合併Invoice中的個別Shipment只有在其全部來源金額被有效Credit歸零後才可被Fulfillment Reversal。 |
| BR-029 | Credit完成財務歸零不自動執行Fulfillment Reversal；兩個權限及業務確認保持分離。 |
| BR-030 | 已歸檔SO／Fulfillment不可使用一般Shipment Reversal；後續財務更正仍可按AR規則處理。 |
| BR-031 | Close Date只可向前推進；本期沒有一般重開入口。 |
| BR-032 | 關帳後解除舊Allocation、Void舊文件或把新文件回填舊日期均須拒絕；更正日期使用目前開放期間。 |
| BR-033 | 讀取、列印、匯出、PDF或技術重查不得更新最後業務時間或改變關帳／歸檔資格。 |

### 9.5 Credit Exposure及信用控制

| 編號 | 規則 |
| --- | --- |
| BR-034 | Exposure按Customer及Credit Currency計算，不把不同Currency金額直接相加。 |
| BR-035 | 未開票SO承諾使用Sales提供的有效未開票金額；Draft、Cancelled或已完成轉換部分不得計入。 |
| BR-036 | 同一價值在SO承諾與Invoice AR之間只能存在於一個Exposure分類。 |
| BR-037 | Credit及Receipt只有正式有效且未被Reversal／Void的可用部分才降低Exposure。 |
| BR-038 | 未設定Credit Limit不同於Limit為0；Credit Hold不同於一般超額。 |
| BR-039 | Credit Limit超額返回Warning及組成；不得由AR自行取消或修改SO。 |
| BR-040 | Credit Hold是Customer主檔決策；AR提供資料但不直接改寫Customer狀態。 |

### 9.6 編號、快照、Archive及保留

| 編號 | 規則 |
| --- | --- |
| BR-041 | Invoice、Credit Note及Receipt各自使用`類型前綴＋年度＋流水號`，每年重置且完整號碼全公司唯一。 |
| BR-042 | 正式確認才取得號碼；已取得號碼即使Void／Reversed亦永久占用。 |
| BR-043 | 正式快照不得因Customer、Address、Contact、Item、Company、Bank、Currency或Payment Term修改而改寫。 |
| BR-044 | Customer銀行帳戶不是Invoice或Receipt必要來源，不自動帶入或顯示於對客文件。 |
| BR-045 | 財務aggregate可與來源SO處於不同Active／Archive位置，永久索引須解析唯一位置。 |
| BR-046 | 未收Invoice不阻止來源SO歸檔；待開票、Claim、Draft或處理中跨模組操作屬Open Downstream Matter。 |
| BR-047 | Active移除前須證明Archive完整、可讀及可按唯一鍵找回；失敗時原Active資料保持完整。 |
| BR-048 | 正式財務資料及Audit至少保留7年；如適用政策要求更長，以較長者為準。 |
| BR-049 | Shipment Base Quantity可被SO Sales UOM factor整除時使用原Sales UOM；不可整除時按Base UOM顯示及計價，不得向上取整成完整Pack。 |
| BR-050 | 分批Shipment的原始可開票金額按`SO Line Amount × 本次Shipped Base Quantity ÷ Ordered Base Quantity`確定性分配，最後一批承接四捨五入尾差，累計等於SO Line Amount。 |
| BR-051 | Price Override基於該Invoice實際顯示UOM及Quantity計算，原比例金額、覆寫金額及差額同時保留；差額不改寫SO原額。 |
| BR-052 | Void、Credit Void、Allocation解除及Receipt Reversal是具Effect Date的追加事件；As-of Date早於反向事件時仍顯示原交易當時有效。 |

---

## 10. 使用者體驗要求

### 10.1 導航與頁面

| 頁面 | 主要使用者 | 核心內容 |
| --- | --- | --- |
| Invoiceable Workbench | 開票人員 | 可開票Shipment、選取、合併預覽、Claim衝突及批量建立。 |
| Invoice List／Detail | 財務查閱者／開票人員 | Active常用視圖、Header、Lines、來源、Settlement、Credit／Receipt及History。 |
| Manual Invoice Create | 開票人員 | Customer、Currency、Due Date、自由描述Lines、原因及明確無物流提示。 |
| Invoice Batch Jobs | 開票人員 | 預覽、進度、成功／失敗、重試及Invoice連結。 |
| Credit Note List／Detail | 貸項管理員／查閱者 | 原Invoice Lines、原因、金額、Credit Balance及來源解鎖狀態。 |
| Receipt List／Detail | 收款管理員／查閱者 | Payment Method、憑證摘要、Allocations、未核銷額及Reversal。 |
| Allocation Workspace | 收款／貸項管理員 | 同Customer／Currency未結清Invoice、建議分配、解除及重配。 |
| Customer Account | 財務查閱者 | Outstanding、Overdue、Credits、Receipts、交易時間線及Exposure。 |
| Aging／Statement | 財務查閱者 | As-of Date、分桶、期間交易、PDF及CSV。 |
| Opening Import | 期初匯入員 | 模板、預檢、確認、進度及結果。 |
| AR Settings | 設定管理員 | 公司資料、銀行、前綴、Close Date及History。 |
| Archive Search | 財務查閱者 | 歷史單號、Customer、來源及唯讀詳情。 |

### 10.2 操作體驗

- UI／UX須遵循`docs/frontend-design.md`的共用頁頭、表格、表單、提示、確認、狀態及錯誤呈現原則。
- Workbench及列表使用server-side搜尋、排序及分頁，不把全量Shipment或Invoice載入瀏覽器。
- 合併預覽須在確認前顯示分組條件、每組來源、Lines、原價、改價、總額及不相容原因。
- 正式確認、Void、Credit、Receipt Reversal、Close Date及批量操作須清楚說明影響並避免誤觸。
- Document Status、Settlement Status、Job Status及Archive Location須分開顯示，不只依賴顏色。
- 處理中、逾時及結果不明時顯示可安全重查的Correlation／Operation Reference，不鼓勵使用者重複建立。
- 金額輸入及顯示須包括Currency；Unallocated Receipt、Credit Balance及Outstanding不得使用含糊的單一「Balance」標籤。
- Billing Address缺失以非阻擋提示表示；Payment Term缺失則要求明確Due Date，不以預設值掩蓋。
- 375px至1440px viewport可完成核心查詢、Draft、Credit、Receipt及核銷；大型表格提供可理解的窄版呈現。
- 支援鍵盤操作、可見焦點、合適標籤、錯誤摘要、狀態文字及WCAG 2.1 AA對比度。

### 10.3 文件及報表體驗

- A4 Invoice／Credit Note在列印與PDF中保持可讀，長文件有頁碼、重複Header及清楚總額。
- Shipment來源可在文件以SO／Shipment參考摘要顯示，內部詳情可展開完整映射。
- Customer Statement按Currency分開，不提供看似已換算的跨幣別總額。
- Export及PDF產生失敗提供可重試狀態，不把空檔案當作成功。
- Active與Archive入口清楚分開，但詳情頁使用一致的閱讀語言並清楚標示唯讀來源。

---

## 11. 權限、安全與職責分離

| 編號 | 需求 |
| --- | --- |
| SEC-001 | 所有列表、詳情、命令、PDF、匯出、Import、Job及Archive請求須在後端驗證身份與權限。 |
| SEC-002 | 更換Customer、Invoice、Shipment、Credit、Receipt、Allocation、Batch、Job或Archive ID不得造成水平或垂直越權。 |
| SEC-003 | `ar.view`只供查看，不可建立Draft、確認、改價、Credit、Receipt、設定、Import或匯出。 |
| SEC-004 | `invoice.price.override`必須配合`invoice.mgmt`，且每次改價須有原因、原值、新值及Actor。 |
| SEC-005 | Credit、Receipt、Settings、Opening Import及Export使用獨立權限，不因System Administrator或開票權限自動授予。 |
| SEC-006 | 正式確認、Void、Credit、Receipt Reversal、Close Date、銀行完整查看／修改及Opening確認須使用重新認證或等效高風險控制。 |
| SEC-007 | 公司銀行完整帳號在儲存、傳輸、備份、快取、臨時檔、Log、Audit及匯出中按敏感財務資料保護。 |
| SEC-008 | 一般Invoice／Receipt流程不得取得或顯示Customer完整銀行帳號；Customer Bank資料不是付款來源真相。 |
| SEC-009 | Notes、Descriptions、CSV、PDF及匯出須防SQL、CSV Formula、HTML／Script、路徑及控制字元注入。 |
| SEC-010 | 服務身份只可執行被授權的Batch、Exposure、Archive或Reconciliation契約，不可模擬一般財務人員任意操作。 |
| SEC-011 | Background Job須同時保存原始Business Actor及實際System Actor，不能把全部Audit記成System。 |
| SEC-012 | 權限在正式提交、背景執行及重試時重新驗證；使用者被撤權後不得靠舊頁面或舊Job取得新財務結果。 |
| SEC-013 | Download URL須短效、綁定Owner／授權及不可猜測；過期、撤權或跨人使用須拒絕。 |
| SEC-014 | Audit及Log只保存allowlisted安全摘要；不得記錄完整銀行帳號、CSV原檔內容、Token、Cookie或不必要個人資料。 |
| SEC-015 | 正式單據、來源映射、Allocation History、Audit及Archive資料不得由應用一般帳號直接update／delete。 |

---

## 12. 整合需求

### 12.1 共通整合原則

- 模組間使用不可重用內部ID及版本化契約；Invoice／SO／Shipment Number只供顯示、搜尋及外部參考。
- 讀取主資料可提供預設值，但正式提交須在同一業務操作中重新驗證所有權、狀態、版本及必要快照。
- 跨模組命令須有Domain Event／Idempotency Key及Correlation ID；結果不明時先查原操作，不以新事件重做。
- Provider不可用、回應不完整或語意不確定時須Fail Closed，不把Unknown當作「沒有下游事項」、「可開票」或Exposure為0。
- Snapshot與目前主資料清楚分開；歷史Invoice顯示確認時事實，新交易使用最新有效主資料。
- 跨模組查詢只返回用途所需欄位，不藉Invoicing lookup洩漏Customer銀行、內部信用備註或其他敏感資料。

### 12.2 Customer Management整合

- Shipment-based開票使用來源SO的Customer ID、Currency及Payment Term快照；Customer目前名稱、Billing Address及Contact只作可選預設及確認時快照。
- 有有效默認Billing Address／Billing Contact時預選；沒有時仍可確認Invoice，並把相應Snapshot保存為空，不猜測其他用途地址。
- Billing Address或Contact已選時，確認前重驗仍屬該Customer及具相應用途；失效時要求重新選擇或清除。
- Customer Default Payment Term為空時保持空，不自動視為某個條款；財務須明確輸入Due Date。
- Customer變為Suspended或Credit Hold不阻止既有Shipment開票、Credit、Receipt及核銷；新Manual Invoice只接受Active Customer。
- Customer主檔保存Credit Limit、Credit Currency及Credit Status；AR保存可變Exposure、Outstanding及Overdue結果，不把計算值回寫成主檔真相。
- 一般Invoice及Receipt不讀取Customer完整銀行資料；本模組只使用公司收款銀行帳戶。

### 12.3 Sales Order Management整合

- Sales提供SO／Line、Customer、Currency、Payment Term、UOM、Original Unit Price、Confirmed Amount及未開票銷售承諾的正式projection。
- Shipment-based Invoice改價只影響Invoice及AR，不修改SO Original／Confirmed Amount或歷史價格快照。
- AR向Sales提供版本化Credit Exposure結果，包括Exposure、Limit語意、Overdue摘要、Credit Status、Warning及計算時間。
- SO確認時，Credit Hold須拒絕；一般超額只顯示Warning。AR不可自行批准、取消或修改SO。
- Sales Archive的Invoicing Open Matter語意固定如下：
  - 待開票Shipment、有效Invoice Claim、Invoice Draft、確認／Void／Credit或Shipment解除中的處理中狀態為`OPEN`。
  - 已正式Invoice且沒有上述處理中事項時，從Sales歸檔角度為`CLOSED`，即使仍有Outstanding。
  - Provider不可用或來源不一致時為`UNKNOWN`並阻止該次Sales歸檔。
- 未收Invoice不隨SO一併歸檔；永久來源索引須容許Active Invoice查看已歸檔SO／Shipment摘要及唯讀詳情。

### 12.4 Fulfillment & Shipping整合

- Invoicing只接受正式`SHIPPED` Shipment／Lines、正數已出貨數量及穩定SO／Inventory來源參考；不可把`PICKED`視為已出貨。
- 建立及確認Invoice均重驗Shipment未`REVERSED`、未被其他有效Invoice claim／開票及來源Lines完整。
- Invoice Claim與正式來源映射須讓Fulfillment查看安全開票狀態，但不得令Warehouse角色取得Invoice價格或收款權限以外資料。
- Fulfillment Reversal判定固定如下：
  - 沒有Invoice Claim或有效Invoice來源時，可按Fulfillment自身規則評估。
  - 存在Draft、確認中或財務結果不明時回`OPEN／UNKNOWN`並阻止Reversal。
  - 正式Invoice來源金額未完全貸項時阻止Reversal。
  - 該Shipment全部來源映射已由有效Credit歸零且沒有處理中財務事項時，可繼續由Fulfillment執行獨立Reversal。
- Credit或Invoice Void不自動建立Inventory movement；Shipment Reversal也不自動Void／Credit其他正確Invoice Lines。
- Fulfillment及SO已歸檔後，不提供一般Shipment Reversal；財務仍可按開放期間規則處理Credit及收款。

### 12.5 Item、Currency及Payment Terms整合

- Shipment-based Lines使用SO／Shipment確認快照中的SKU、UOM及價格，不以目前Item主檔重新計價。
- Manual Invoice可查找SKU ID／Code／Name作參考，但不要求SKU仍可銷售，也不建立庫存效果；文件明確標示Manual來源。
- Item改名、停用、停產或封存不得改寫正式Invoice；來源快照仍可顯示。
- Currency目錄提供Code、精度及顯示規則；停用Currency不阻止處理既有同幣別債權，但不可用於新Manual Invoice。
- Payment Term目錄提供可確定的Due Date計算；條款後續改動不重算已正式Invoice。

### 12.6 User、Audit、Reporting及未來Accounting整合

- User Management提供當前Actor、權限、有效狀態及重新認證；背景工作同時保存Business Actor及System Actor。
- Audit／Reporting只讀取正式交易、結果及安全快照；不得直接修改餘額或把報表快取當交易真相。
- 未來Accounting可消費`Invoice Issued／Voided`、`Credit Issued／Voided`及`Receipt Confirmed／Reversed`等正式事件，但本期不建立、驗證或回滾會計分錄。
- Accounting未上線或暫時不可用不阻止本期AR；日後接入時須另行定義原子性、對賬及關帳責任。
- Customer Return、Refund及平台結算須透過未來正式契約接入，不可重用Manual Invoice、Credit或Receipt Reversal繞過其業務控制。

### 12.7 Archive及永久來源路由

- Invoice、Credit Note、Receipt各自是財務文件aggregate；跨SO Invoice及跨Invoice Receipt不強迫多個SO形成共同Archive group。
- 財務文件移入Archive前須保證所有跨文件及來源連結仍可經Permanent Source Index解析；不能因另一端仍在Active而斷鏈。
- Sales／Fulfillment及Invoicing可在不同時間歸檔，任何方向的詳情連結均須路由至唯一Active或Archive記錄。
- Archive routing不可用時應顯示服務暫不可用及Correlation，不返回假`404`、空Statement或零Exposure。
- 任何archive copy、校驗、routing或Active移除失敗均保留可恢復狀態；不得由人工直接刪除一邊「修復」。

---

## 13. 非功能需求

### 13.1 容量與效能

| 編號 | 要求 |
| --- | --- |
| NFR-PERF-001 | 容量基線承接每日約10,000張SO／Shipment；24個月最少以730萬張Shipment-based Invoice候選及相應Lines／Sources驗證，另包含Manual、Credit、Receipt及長期未收資料。 |
| NFR-PERF-002 | 完整Active容量及正常混合負載下，Workbench、Invoice／Receipt／Credit常用列表、Customer Account及精確單號查詢p95不超過2秒。 |
| NFR-PERF-003 | 單張不超過100個顯示Lines的Draft保存及確認，在依賴正常時p95不超過3秒；較大合併文件須採有界處理並在3秒內返回可追蹤狀態。 |
| NFR-PERF-004 | 10,000張有效Shipment的標準批量開票在基準環境30分鐘內完成；實際硬件、資料分佈及分組比例須由設計及測試記錄。 |
| NFR-PERF-005 | 系統須支援至少50名互動使用者同時查詢、建Draft、確認、Credit、Receipt及核銷，並與Batch、Export、Exposure及Archive Job共存。 |
| NFR-PERF-006 | A4 Invoice／Credit Note及最多100個顯示Lines的PDF／列印預覽p95不超過3秒。 |
| NFR-PERF-007 | Archive精確單號查詢p95不超過3秒；Customer＋最多366日受限查詢p95不超過5秒。 |
| NFR-PERF-008 | 大型Statement、Export、Import及Archive使用有界背景處理，不把全量結果載入記憶體或長時間鎖定日常交易。 |
| NFR-PERF-009 | 未收Invoice可超過24個月留在Active；索引及測試資料須包含此分佈，不可假設所有舊Invoice均可歸檔。 |

上述數量是容量驗證基線，不是業務資料上限。單張合併Invoice的Shipment／Source Mapping硬上限及超限拆分規則由`design_spec.md`按PDF可用性及交易時間明確定義，且不得低於正常100-Line文件能力。

### 13.2 一致性、冪等及恢復

- Claim、Draft建立、確認、Void、Credit、Receipt、Allocation、解除、重配、Reversal、Import及Archive均須具冪等性。
- 不得出現Invoice顯示`ISSUED`但沒有完整AR／Sources，或AR已增加但Invoice仍為Draft且無法恢復的狀態。
- Credit、Receipt及Allocation任何部分失敗須全部回滾或保留可由原Event收斂的結果不明狀態。
- 批次每個Invoice Group獨立原子；已完成Group不因Worker重啟而重複建立。
- 跨模組暫時失敗可安全重試；永久業務失敗回到可理解狀態並釋放不再需要的Claims。
- 定期Reconciliation須能找出Shipment重複／漏開票、來源金額不守恆、負餘額、Allocation差異、Exposure重複及Active／Archive路由衝突。

### 13.3 可用性與營運

- Archive、Export、PDF、Statement或非核心報表故障不得阻止新Invoice、Credit、Receipt或Active精確查詢。
- Customer、Sales或Fulfillment依賴不可用時不得使用過期資料假裝確認成功；Draft可保留並顯示依賴及Correlation。
- Background Job重啟後可安全續跑；卡住操作、Queue積壓及結果不明須可查及告警。
- Active／Archive、Permanent Source Index、私有檔案及正式財務資料納入備份、還原及完整性演練。
- 使用者可分辨業務驗證錯誤、權限錯誤、版本衝突、暫時依賴故障及結果不明，並取得具體下一步。
- `NFR-DR-001`：正式生產災難復原目標為RTO不超過4小時、RPO不超過15分鐘；須以隔離環境的定時Backup／Restore演練及完整性對賬證明。

### 13.4 安全、私隱及保留

- 傳輸及靜態資料使用專案批准的保護措施；銀行帳戶、下載檔及備份按敏感財務資料處理。
- 正式文件、Audit及來源索引至少保留7年；最終銷毀須另有法規、備份及管理政策後才可啟用。
- Import source／result檔保留90日；Export result及可由正式Snapshot重建的PDF檔保留7日。到期後安全刪除檔案，但結構化Batch／Audit／Snapshot仍按至少7年政策保存；Legal Hold或較長適用法規優先。
- 日誌、追蹤、Metrics及錯誤不得包含完整銀行帳號、CSV內容、Token、Cookie或非必要個人資料。
- 任何輸入、匯出及文件均須對SQL、CSV Formula、XSS、HTML、路徑穿越及不安全檔案內容採一致防護。

### 13.5 可觀測性

- 指標至少包括Invoiceable Queue Depth／Age、Claim衝突、Draft／Issue成功與失敗、Batch吞吐、改價率、Credit率、Receipt／Allocation失敗、Outstanding／Overdue、Exposure延遲及Archive結果。
- 監察卡住Issue／Credit／Receipt／Reversal、重複Event、Sequence衝突、負餘額防護、Reconciliation差異及Background Queue積壓。
- Log使用安全的Request、Correlation、Event、Customer、Invoice、Shipment、Receipt及Batch識別，不保存完整業務payload。
- 每次正式財務結果可由Correlation追查至來源、Actor、操作結果及後續更正。

### 13.6 可維護性、UI及相容性

- Sales、Fulfillment、Customer、Item及Currency契約須版本化；破壞性改動有兼容及遷移計劃。
- Invoicing不複製Shipment狀態或Sales未開票承諾算法；透過正式Provider取得並驗證。
- Active Query、Archive Query、業務命令、Background Job及文件Projection保持清晰邊界。
- 所有日期按`APP_TIME_ZONE`顯示，交換格式無時區歧義；Business Date與Audit timestamp不可混用。
- 遵循`docs/frontend-design.md`及專案支援瀏覽器；重要狀態不只依賴顏色，表單錯誤可由鍵盤及輔助技術定位。

---

## 14. 錯誤與例外處理

| 場景 | 預期處理 |
| --- | --- |
| Shipment不是`SHIPPED`或已`REVERSED` | 不可選取／確認，指出實際狀態，不建立Claim或Invoice。 |
| Shipment已被其他Draft／Invoice使用 | 原子拒絕衝突組，顯示安全持有狀態，不產生部分Draft。 |
| 合併條件不一致 | 在預覽分組或列出不相容欄位，不靜默改Currency／Term／Billing資料。 |
| Payment Term空白且Due Date未填 | 保留Draft並要求明確Due Date，不猜測即期。 |
| Billing Address失效 | 要求重新選擇或清除；清除後仍可按已確認選填規則繼續。 |
| 無改價權限或原因空白 | 拒絕價格覆寫，保留原SO價格。 |
| Invoice Version衝突 | 拒絕覆寫，要求重新載入並顯示最新Version。 |
| 正式確認結果不明 | 保留處理中／可恢復狀態，以原Event查回，不建立第二張Invoice。 |
| 批量中部分Group失敗 | 成功Group保留；失敗Group列出原因並可安全重試。 |
| Invoice已有Credit／Receipt仍嘗試Void | 拒絕並列出須先解除的下游關係。 |
| Credit超過Line／Invoice上限 | 整張Credit確認失敗，不留下部分貸項或負Outstanding。 |
| Credit／Receipt跨Customer或Currency | 拒絕核銷，不自動換匯或移轉Customer。 |
| Receipt分配超額 | 整次Allocation失敗，Receipt及Invoice原餘額不變。 |
| Receipt Reversal仍有Allocation | 系統在同一操作建立全部反向Allocation效果；任一失敗則不Reversal。 |
| 業務日期落入已關帳期間 | 拒絕並顯示Close Date及可用更正方式。 |
| Customer變為Suspended／Hold | 既有Shipment及AR可處理；新Manual Invoice拒絕。 |
| Customer／Currency主資料暫時不可用 | 不顯示正式成功；保留Draft或可恢復狀態及Correlation。 |
| Opening CSV結構錯誤 | 整檔預檢失敗，不建立任何Opening資料。 |
| Opening單一來源文件Row錯誤 | 該文件Invalid；其他有效文件可在確認後成功。 |
| 已成功Opening來源重送 | 返回Duplicate及原結果，不建立第二份餘額。 |
| PDF／Export Job失敗 | 顯示失敗及可重試資訊，不提供不完整或空白檔案。 |
| Archive寫入或校驗失敗 | 原Active資料完整保留，記錄差異、告警及可安全重試狀態。 |
| Archive暫時不可用 | Active功能繼續；Archive查詢顯示不可用，不返回假零結果。 |
| Exposure Provider不可用 | Sales收到Unknown及明確提示，不把Exposure視為0。 |

所有可見錯誤須具有穩定Error Code供介面與支援使用，以及清楚的繁體中文描述，說明出錯對象、原因、資料是否已成功及下一步。技術細節只向獲授權營運人員顯示。

---

## 15. 用戶驗收準則

### 15.1 Settings、編號及日期

| 編號 | Given／When／Then |
| --- | --- |
| AC-001 | Given使用者只有`ar.view`，When直接進入設定或提交修改，Then頁面不提供操作且後端拒絕，設定不變。 |
| AC-002 | Given公司開票資料已設定，When正式確認Invoice後再修改公司資料，Then舊Invoice／PDF保持原快照，新Invoice使用新資料。 |
| AC-003 | Given同Currency多個公司銀行帳戶，When設定默認及建立Invoice／Bank Transfer Receipt，Then只預選有效同Currency帳戶且正式文件保存快照。 |
| AC-004 | Given跨年度依次確認Invoice、Credit及Receipt，When查看號碼，Then三類各自按年排序、完整號碼唯一且Void／Reversed號碼不重用。 |
| AC-005 | GivenAR Close Date為某日，When嘗試在該日或之前確認Invoice、Credit、Receipt、Allocation或Opening，Then全部被拒絕且餘額不變。 |
| AC-006 | Given有影響目標期間的處理中操作，When推進Close Date，Then關帳被阻止並列出具體事項。 |
| AC-007 | GivenPayment Term存在，When建立Invoice，ThenDue Date按快照計算；Given沒有Term，Then使用者必須明確輸入Due Date而系統不建立虛構條款。 |

### 15.2 Workbench、Draft及批量開票

| 編號 | Given／When／Then |
| --- | --- |
| AC-008 | Given各渠道包含`PICKED`、`SHIPPED`及`REVERSED` Shipment，When查看Workbench，Then只有合資格`SHIPPED`資料可選並可看到排除原因。 |
| AC-009 | Given一張含多Lines的Shipment，When建立Invoice，Then全部尚未開票Lines及數量被納入，使用者不可只選部分。 |
| AC-010 | Given兩名使用者同時選取同一Shipment，When建立Draft，Then只有一方取得完整Claim，另一方不留下部分Invoice。 |
| AC-011 | Given同Customer／Currency但不同SO及Warehouse的相容Shipment，When合併預覽並確認，Then形成一張Invoice並保留全部SO／Shipment來源。 |
| AC-012 | GivenCustomer、Currency、Payment Term或Invoice Date不相容，When嘗試合併，Then系統分組或拒絕並顯示原因，不暗中改值。 |
| AC-013 | Given同SKU／UOM／價格來自多Shipment，When生成PDF，Then可合併顯示且內部仍能逐Shipment追溯；不同價格保持分行。 |
| AC-014 | Given使用者沒有`invoice.price.override`，When改Shipment來源價格，Then被拒絕；Given具權限及原因，Then保存原價、新價、差額及Actor。 |
| AC-015 | GivenInvoice Date早於最晚Shipment、晚於今日或在已關帳期，When確認，Then被拒絕且Draft及Claims保持可理解狀態。 |
| AC-016 | GivenDraft被取消，When回到Workbench，ThenClaims已釋放、沒有AR及正式號碼，取消歷史可查。 |
| AC-017 | Given同一建立或確認請求重送／雙擊，When處理完成，Then只返回一張Draft／正式Invoice及同一結果。 |
| AC-018 | Given10,000張合資格Shipment含一個不合法Group，When批量建立及確認，Then合法Groups獨立完成，錯誤Group可定位及重試。 |
| AC-019 | GivenBatch Worker中斷後重啟，When恢復原Job，Then已成功Invoice不重複、未完成Group繼續且結果總數守恆。 |
| AC-020 | Given100-Line Invoice及正常依賴，When保存及確認，Then於性能門檻內完成並生成完整來源、AR及Audit。 |

### 15.3 Manual Invoice、正式文件及Void

| 編號 | Given／When／Then |
| --- | --- |
| AC-021 | GivenActive Customer，When建立有原因及自由描述Lines的Manual Invoice，Then可確認並清楚標示Manual，且不產生SO、Shipment或Inventory結果。 |
| AC-022 | GivenManual Line選填SKU，When確認，ThenSKU只作參考；Item庫存、狀態及交易數量不變。 |
| AC-023 | GivenSuspended／Blocked Customer，When建立新Manual Invoice，Then被拒絕；既有Shipment Invoice、Credit及Receipt仍可處理。 |
| AC-024 | GivenBilling Address及Contact均空白，WhenInvoice其他資料完整，Then可正式確認及生成不含虛構地址的PDF。 |
| AC-025 | GivenInvoice確認成功，When嘗試直接修改Customer、日期、價格、Lines或來源，ThenUI無入口且後端拒絕，正式快照不變。 |
| AC-026 | Given沒有Credit／Receipt關聯的開放期Invoice，When有原因Void，ThenAR效果撤銷、來源可重新開票且原號碼／文件／Audit保留。 |
| AC-027 | GivenInvoice已有有效Credit或Receipt Allocation，When嘗試Void，Then被拒絕並指出未解除關係，任何餘額不變。 |
| AC-028 | GivenCustomer／Item／Company／Bank後續修改，When重新下載舊Invoice，Then內容與首次正式快照一致。 |

### 15.4 Credit Note及Shipment更正

| 編號 | Given／When／Then |
| --- | --- |
| AC-029 | Given正式Invoice多個Lines，When建立部分Line Credit並確認，Then只降低相應Outstanding及保存Reason／來源映射，不改庫存。 |
| AC-030 | GivenCredit累計將超過原Line或Invoice金額，When確認，Then整張失敗且沒有部分Credit或負Outstanding。 |
| AC-031 | Given已部分／全部付款Invoice，When確認合法Credit，Then先結清Outstanding，超額部分形成同Currency Customer Credit Balance。 |
| AC-032 | GivenCustomer Credit Balance，When套用另一張同Customer／Currency Invoice，Then可部分套用並準確更新兩邊餘額；跨Customer／Currency被拒絕。 |
| AC-033 | GivenCredit應用配對錯誤且期間開放，When解除及重配，Then正式Credit不變、應用歷史完整、Outstanding重新計算。 |
| AC-034 | Given錯誤Credit Note已解除所有應用，When有權者Void，Then原Invoice及Credit Balance正確恢復，原Credit號碼保留。 |
| AC-035 | Given合併Invoice只涉及一張錯誤Shipment，When未完全貸項便要求Reverse，Then被阻止；相關來源完全貸項後可進入Fulfillment自身Reversal評估。 |
| AC-036 | GivenCredit Note以壞帳或尾差Reason確認，When查看AR，ThenInvoice按貸項結清但系統不建立獨立Write-off或會計分錄。 |
| AC-037 | GivenCredit確認重送或並發兩張Credit，When處理，Then不突破可貸項上限且原Event可查回唯一結果。 |

### 15.5 Receipt、Allocation及Reversal

| 編號 | Given／When／Then |
| --- | --- |
| AC-038 | GivenBank Transfer／Cash／Cheque／Other，When建立Receipt，Then各方式按規則要求公司銀行、交易參考、Cheque Number或說明。 |
| AC-039 | Given一筆Receipt及同Customer／Currency多張Invoice，When部分核銷，Then每張Outstanding正確降低且剩餘顯示Unallocated。 |
| AC-040 | GivenReceipt與Invoice的Customer或Currency不同，When嘗試Allocation，Then被拒絕且不進行FX或自動轉戶。 |
| AC-041 | Given兩名使用者並發分配相同Receipt或Invoice餘額，When提交，Then成功總額不超過任一可用餘額且沒有負數。 |
| AC-042 | GivenReceipt配對錯Invoice，When在開放期間解除及重新核銷，ThenReceipt原始資料不變、兩張Invoice及歷史準確更新。 |
| AC-043 | GivenReceipt資料本身錯誤或Cheque退票，When以開放日期整張Reversal，Then從該日產生全部反向Allocation效果、目前Invoice餘額恢復且原Receipt保留。 |
| AC-044 | GivenReceipt Reversal中任一餘額更新失敗，When查看結果，Then不得出現部分恢復；原Event可安全重試／查回。 |
| AC-045 | GivenUnallocated Receipt，When使用者不立即分配，Then可保留及在日後同Customer／Currency核銷，不被系統自動猜配。 |
| AC-046 | GivenReceipt Date在未來或關帳期，When確認，Then被拒絕且不取得正式號碼或改變AR。 |
| AC-047 | Given已確認Receipt，When查看詳情或匯出，Then顯示未對賬語意，不宣稱已完成銀行對賬。 |

### 15.6 AR、Statement及Credit Exposure

| 編號 | Given／When／Then |
| --- | --- |
| AC-048 | GivenInvoice、Credit、Receipt及重新核銷交易，When查看Customer Account，ThenOpening、活動及Closing Balance逐Currency守恆且可連回單據。 |
| AC-049 | Given指定As-of Date，When查看Outstanding及Overdue，Then當日到期不提早逾期，過期天數及分桶正確。 |
| AC-050 | Given多Currency Customer，When查看Aging／Statement，Then各Currency分開顯示，不產生未定義的跨幣別總額。 |
| AC-051 | Given相同條件及As-of Date，When比較畫面、Statement PDF及CSV，Then交易、分桶及餘額口徑一致。 |
| AC-052 | GivenCredit Balance及Unallocated Receipt，When查看Customer Account，Then兩者獨立顯示，不以負Invoice隱藏。 |
| AC-053 | Given一筆已確認未開票SO承諾，When建立正式Invoice，ThenExposure總額只由未開票分類轉為AR，不重複增加。 |
| AC-054 | Given未收Invoice、可用Credit／Receipt及Credit Limit，WhenSales查詢信用，ThenExposure組成可解釋、超額只Warning、Credit Hold才阻止新賒銷。 |
| AC-055 | GivenAR Provider不可用，WhenSales執行信用判斷，Then收到Unknown及提示，不把Exposure當作0。 |
| AC-056 | Given來源SO已歸檔但Invoice仍未收，When財務查看或收款，ThenInvoice仍可正常處理並可經永久索引查看來源。 |

### 15.7 Opening、權限、Archive及營運品質

| 編號 | Given／When／Then |
| --- | --- |
| AC-057 | Given合法及非法Opening來源混合CSV，When預檢及確認，Then合法文件獨立成功、錯誤文件可定位、預檢本身不改AR。 |
| AC-058 | Given已成功來源Document Key重送，When再次匯入相同內容，Then標示Duplicate並返回原結果；不同內容衝突須拒絕。 |
| AC-059 | GivenOpening Worker中斷，When恢復，Then已成功文件不重複、失敗可重試、總數與結果檔一致。 |
| AC-060 | Given使用者缺少任一獨立權限，When直接呼叫改價、Credit、Receipt、Settings、Import、Export或Download，Then後端拒絕且無副作用。 |
| AC-061 | Given惡意CSV Formula、Script、HTML或控制字元，When匯入、顯示、PDF或匯出，Then內容不執行且安全拒絕或轉義。 |
| AC-062 | Given正式銀行資料，When一般使用者查看列表、Audit、Log或匯出，Then只見遮蔽／必要資料；未授權完整查看被拒絕並記錄。 |
| AC-063 | Given未收Invoice超過24個月，When來源SO符合歸檔，ThenSO／Fulfillment可歸檔而Invoice留Active且所有連結仍正確。 |
| AC-064 | Given財務aggregate符合歸檔條件，WhenArchive成功，Then文件、Lines、Sources、Applications、History及必要Audit完整可讀且Active只保留唯一routing。 |
| AC-065 | GivenArchive在copy、hash或routing時中斷，When安全重跑，Then原Active資料不遺失、成功資料不重複、差異可追蹤。 |
| AC-066 | Given730萬Active候選、50名使用者及背景Job，When執行標準混合負載，Then常用操作、批量吞吐及PDF符合NFR門檻。 |
| AC-067 | Given備份及還原演練，When恢復Active、Archive、永久索引及私有檔案，Then抽樣Invoice／Credit／Receipt／來源／餘額完整一致。 |
| AC-068 | Given任何建立、確認、更正、核銷、關帳、匯入、下載或歸檔，When查Audit，Then可見Actor、時間、原因、Outcome及Correlation且無完整銀行／Token洩漏。 |
| AC-069 | Given一個SO以1箱等於24件、分兩次各出貨12件，When分別開票，Then每張按12件等值金額計算、沒有向上收整箱，累計原始金額等於SO Line Amount。 |
| AC-070 | GivenReceipt已在上一開放期間核銷且在本期Reversal，When分別以Reversal前後As-of Date查看Statement，Then前期仍顯示當時收款效果，本期才顯示反向效果。 |

---

## 16. 資料建置與上線要求

### 16.1 初始設定及主資料

上線前至少完成：

- 公司Invoice抬頭、地址、聯絡資料及文件頁尾確認。
- 啟用Currency及Payment Terms目錄，並驗證Currency精度與SO快照一致。
- Invoice、Credit Note及Receipt前綴、起始年度及唯一性檢查。
- 每個實際收款Currency的公司銀行帳戶、默認值及完整資料權限。
- 初始AR Close Date、Aging分桶、業務時區及文件語言確認。
- Customer Legal Name、Default Currency、可選Payment Term及Billing資料品質報告。
- 財務角色、獨立權限、重新認證及服務身份配置。

### 16.2 Opening AR遷移

- 業務須先清理舊系統Customer、Currency、Document Number、Invoice Date、Due Date、Lines、Original Amount及Outstanding。
- Opening Invoice匯入的是截至切換日仍需追收的正式債權，不把已結清歷史全部倒入Active。
- Customer Credit Balance需有來源文件／理由及Currency；不能以負Invoice代替。
- 遷移須至少完成一次完整Dry Run、來源／結果總額核對、Duplicate重跑及失敗修正演練。
- Cutover後舊系統AR轉為唯讀；不得同時在兩個系統新增或核銷相同債權。
- 上線簽核須按Customer＋Currency核對舊系統Closing與ERP Opening，差異為零或有逐項批准說明。

### 16.3 Go-Live控制

- Sales及Fulfillment Provider契約、Shipment開票防重及Reversal guard須先通過整合驗證。
- AR與Sales Exposure雙計防護須以轉換前後相同總額證明。
- 文件號Sequence、關帳、正式單據不可修改、銀行遮蔽及權限矩陣須完成安全驗證。
- 批量開票、Opening Import、Archive、Backup／Restore及結果不明恢復須在production-like環境演練。
- 上線初期須監察Invoiceable Queue Age、Batch失敗、Claim卡住、Exposure差異、負餘額防護及Reconciliation結果。
- 發現重複開票、部分AR結果、負Outstanding或來源斷鏈時須停止相關寫入流程，保留證據並按Runbook處理，不直接改DB。

---

## 17. 優先級與建議交付階段

### Phase 1：AR Foundation & Settings

- 權限、公司開票資料、銀行帳戶、文件Sequence、Close Date、金額／日期規則、Audit及跨模組Provider readiness。
- 驗收結果：設定及契約可用，正式單據仍未向一般使用者開放。

### Phase 2：Invoiceable Workbench & Invoicing

- Workbench、Claims、Shipment-based／Manual Draft、單張／批量確認、Void、PDF及來源追溯。
- 驗收結果：已出貨資料可不重複地形成正式Invoice及AR。

### Phase 3：Credit, Receipt & Allocation

- Credit Note、Credit Balance、Receipt、部分／多單核銷、重新核銷、Reversal及Shipment解除契約。
- 驗收結果：應收可由貸項及收款準確結清，所有更正可追溯。

### Phase 4：Inquiry, Exposure, Opening & Archive

- Customer Account、Outstanding、Overdue、Aging、Statement、Exposure、Opening Import、Export、Archive、Reconciliation及Release Evidence。
- 驗收結果：高容量查詢、信用控制、上線遷移及長期資料治理可獨立驗收。

每個Phase在後續`tasks.md`應形成可獨立測試及PR的Checkpoint；不能為提早開UI而跳過前置數量守恆、Provider或真資料庫證據。

---

## 18. 決策紀錄、假設與設計門檻

### 18.1 已確認決策

| 編號 | 決策 |
| --- | --- |
| DEC-001 | 預設一Shipment一Invoice，允許人工合併相容Shipment。 |
| DEC-002 | 合併可跨SO及Warehouse；Shipment不可部分開票。 |
| DEC-003 | 財務人工確認後才形成正式Invoice及AR；同時支援批量確認。 |
| DEC-004 | Shipment-based Draft可由獨立權限有因改價，不回寫上游。 |
| DEC-005 | Billing Address非必填；Payment Term缺失時人工輸入Due Date。 |
| DEC-006 | 正式Invoice以Void及Credit Note更正，不直接修改。 |
| DEC-007 | Credit按原Invoice Line處理，超出Outstanding形成Customer Credit Balance。 |
| DEC-008 | Receipt支援部分、多單、未核銷及重新核銷；Receipt錯誤整張Reversal。 |
| DEC-009 | 只處理同Currency核銷，不處理FX。 |
| DEC-010 | 收款方式包括Bank Transfer、Cash、Cheque及Other，按方式驗證憑證資料。 |
| DEC-011 | 提供Aging、Customer Statement、CSV及PDF；不做自動催收。 |
| DEC-012 | 提供受控Opening AR CSV匯入及受控Manual Invoice。 |
| DEC-013 | 不設另一人財務審批；以獨立權限、原因、重新認證及Audit控制。 |
| DEC-014 | 提供單一AR Close Date，不建立完整Accounting Period。 |
| DEC-015 | Exposure同時計入未收AR及未開票SO承諾；超額Warning、Credit Hold硬阻擋。 |
| DEC-016 | 正式文件採年度獨立且不可重用的系統流水號。 |
| DEC-017 | 所有Sales渠道均進入開票範圍；平台結算Adapter後續另做。 |
| DEC-018 | Invoice／AR獨立歸檔，未收Invoice不阻止來源SO歸檔。 |
| DEC-019 | 合併Invoice的局部Shipment須先把相關來源行完全Credit，才可Reverse。 |
| DEC-020 | 第一版不適用Sales Tax、總帳、銀行對賬或退款。 |

### 18.2 文件採用的簡化假設

- 單一公司，不存在法人間Invoice、跨公司收款或Intercompany AR。
- Currency及Payment Terms沿用現有共用目錄；不在本模組複製主檔。
- Company Profile及收款銀行因尚無共用Company Settings，由本模組精簡維護。
- Invoice、Credit Note及Receipt正式確認時取號；Draft取消不占正式號碼。
- Aging採固定分桶；As-of Date按業務時區日界線計算。
- 未收Invoice可長期留Active；已符合資格的歷史財務資料按24個月政策移Archive且至少保留7年。
- Credit Note作壞帳／尾差AR更正不代表未來Accounting處理方式已決定。
- PDF／列印只代表文件已產生，不代表已Email、已送達或客戶已確認。

### 18.3 後續設計及上線門檻

| Gate | 必須確認的證據 |
| --- | --- |
| Provider Readiness | Sales未開票承諾、Fulfillment Shipment／Reversal、Customer purpose lookup及Currency規則的正式版本、Owner與測試。 |
| Quantity／Money Proof | Invoice Source、Credit、Receipt、Allocation及Exposure守恆的精確公式、並發及真MySQL證據。 |
| Consolidation Bounds | 單Invoice最大Shipment、顯示Lines及Source Mappings，超限拆分方式及100-Line／大文件PDF驗證。 |
| Sequence | 年度切換、並發取號、失敗／commit unknown、前綴修改及不可重用證據。 |
| Close Date | 關帳前Open Matter查詢、時區邊界、不可倒退及恢復Runbook。 |
| Security | 銀行加密／遮蔽、重新認證、Owner-safe files、IDOR及輸出注入測試。 |
| Capacity | 730萬Active候選、長期未收、10,000張Batch、50-user及背景Job共存的基準環境證據。 |
| Archive | 跨Active／Archive永久路由、獨立財務歸檔、count／hash、中斷重跑及backup restore。 |
| Legal／Retention | 正式Invoice、Credit、Receipt、Audit、銀行及檔案的至少7年／短期檔案保留期由業務及法務簽核。 |

以上Gate不重新打開已確認業務範圍；它們要求後續設計把數值、交易及營運證據寫清楚，不得用Stub、Production Fake或人工改DB繞過。

---

## 19. 需求追溯摘要與簽核

### 19.1 需求追溯摘要

| 業務能力／風險 | Requirement／Rule | Acceptance Criteria |
| --- | --- | --- |
| Settings、銀行、編號及關帳 | FR-SET-001～010、BR-011、BR-031～032、BR-041～044、SEC-004～008 | AC-001～007、AC-060、AC-062 |
| Workbench、Claim及防重 | FR-WB-001～011、BR-001～007 | AC-008～012、AC-016～019 |
| Shipment-based Invoice及改價 | FR-INV-001～017、BR-008～016、BR-049～051 | AC-009～017、AC-020、AC-024～025、AC-028、AC-069 |
| Manual Invoice | FR-MAN-001～007 | AC-021～023 |
| Batch、Issue及Void | FR-BATCH-001～013、BR-026～027 | AC-017～020、AC-025～027 |
| Credit及Shipment Reversal | FR-CN-001～013、BR-017～020、BR-023、BR-025、BR-028～030 | AC-029～037 |
| Receipt、Allocation及Reversal | FR-REC-001～014、BR-021～025 | AC-038～047 |
| AR、Aging及Statement | FR-AR-001～013、BR-017～025、BR-033、BR-052 | AC-048～052、AC-056、AC-070 |
| Credit Exposure及Sales控制 | FR-EXP-001～009、BR-034～040 | AC-053～055 |
| Opening AR | FR-OPEN-001～012 | AC-057～059、AC-061 |
| 文件、Export及Audit | FR-DOC-001～006、FR-EXPORT-001～004、FR-AUDIT-001～003、SEC-001～015 | AC-024、AC-028、AC-051、AC-060～062、AC-068 |
| Archive、容量及恢復 | FR-ARC-001～011、BR-045～048、NFR-PERF-001～009 | AC-056、AC-063～067 |

### 19.2 業務簽核建議

| 簽核角色 | 姓名 | 決定 | 日期 | 備註 |
| --- | --- | --- | --- | --- |
| Finance／AR Process Owner | — | — | — | — |
| Sales Process Owner | — | — | — | — |
| Fulfillment／Warehouse Owner | — | — | — | — |
| Customer Data Owner | — | — | — | — |
| Information Security Owner | — | — | — | — |
| Product Owner | — | — | — | — |

本文件簽核後，方可產出`design_spec.md`。技術設計不得把Tax、GL、Bank Reconciliation、Refund、Return、FX、Collection、Email或平台結算能力暗中加入第一版，也不得削弱Shipment防重、正式文件不可覆寫、同Currency核銷、關帳及來源追溯要求。

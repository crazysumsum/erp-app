# Inventory Management 業務需求書（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Inventory Management 業務需求書 |
| 文件版本 | 0.3 Approved Planning Baseline |
| 文件日期 | 2026-09-07 |
| 文件狀態 | Product Owner／獨立評審人Sam已批准目前需求、設計及P0～P5計畫基線；尚未授權進入IMPLEMENT |
| 適用系統 | ERP App |
| 適用組織 | 單一公司；中小企業 |
| 營運規模 | 5個以內倉庫；不設硬性系統上限 |
| 庫存最小定位維度 | Warehouse＋Bin＋SKU＋Lot＋Stock Status |
| 主要範圍 | 倉庫與庫位、批次與有效期、庫存結餘、預留與分配、收發異動、庫內移動、跨倉調撥、調整、盤點、開帳及稽核 |

### 0.1 文件目的

本文件定義 ERP Inventory Management（庫存管理）模組應滿足的業務需求，作為業務確認、系統設計、開發、測試、驗收、上線及後續變更控制的共同基準。

本文件描述「系統須支援什麼」以及相關業務規則，不指定資料庫表、API路徑、程式架構或畫面元件。技術設計須在本文件簽核後另行產出；如技術設計與本文件衝突，應先修訂並重新確認需求，不得由開發者自行改變業務語意。

### 0.2 需求背景

本 ERP 主要服務化妝品、零食、健康食品及飲品等零售消耗品的批發業務。這類商品通常需要知道每個 SKU 的實際存放位置、批次及到期日，否則容易出現以下問題：

- 系統顯示有貨，但倉務人員不知道貨品位於哪個 Bin。
- 同一批貨分散於多個 Bin 後，帳面數量與現場數量難以核對。
- 已預留貨品被其他訂單再次使用，造成超賣或發貨失敗。
- 過期、效期不足、隔離或損壞的貨品被錯誤分配及出庫。
- 庫內移動、跨倉調撥、調整及盤點只改結餘而沒有完整來源，無法追查差異。
- 不同模組各自計算庫存，導致採購、銷售、發貨及報表結果不一致。

Inventory Management 將成為所有實際庫存數量及位置的唯一事實來源。系統以 SKU 的 Base UOM 記錄數量，以 Warehouse 和 Bin 定位存貨，並在 SKU 要求批次／有效期管理時追蹤實際 Lot 及 Expiry Date。所有數量變化必須由可追溯的庫存異動產生，不允許直接改寫結餘。

### 0.3 已確認業務意圖

- 對象是管理5個以內倉庫的中小企業，流程須簡單、實用，避免大型WMS功能。
- 必須準確記錄具體 SKU／Lot 存放於哪個 Warehouse／Bin。
- 同一 SKU／Lot 可分散於多個 Bin；同一 Bin 可混放不同 SKU／Lot。
- 銷售確認後可按 SKU／Warehouse 預留；實際揀貨時才分配 Lot／Bin。
- 有效期商品預設依 FEFO 揀貨；偏離 FEFO 需要專門權限、原因及稽核，不需要另一人審批。
- 庫存只使用 `AVAILABLE`、`QUARANTINED`、`DAMAGED` 三種可人工控制狀態；過期由 Expiry Date 自動判斷。
- 嚴格禁止負庫存；庫存差異只能透過受權限控制、有原因及稽核的調整處理。
- 本期不做 Serial Number、成本核算、庫存估值、COGS或會計分錄。

### 0.4 版本紀錄

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 0.3 Approved Planning Baseline | 2026-09-14 | Sam完成獨立人工評審並批准設計／計畫；確認Serial、低效期Override、Returns、Adjustment、Data Freeze、Go-Live責任及DB帳號分離決策；明確暫不進入IMPLEMENT。 |
| 0.2 Draft | 2026-09-14 | Harness 2.0原位對齊；Product Owner批准DEC-014～019，技術基線另採MySQL 8.0。 |
| 0.1 Draft | 2026-09-07 | 根據訪談建立面向中小企業、以Warehouse／Bin／SKU／Lot為核心的精簡庫存需求。 |

---

## 1. 業務目標與成功指標

### 1.1 業務目標

| 編號 | 目標 |
| --- | --- |
| OBJ-01 | 建立單一、可靠且可稽核的庫存數量與位置資料來源。 |
| OBJ-02 | 讓使用者準確知道每個 SKU／Lot 位於哪個 Warehouse／Bin及其數量與狀態。 |
| OBJ-03 | 清楚區分 On Hand、Reserved、Available to Promise、In Transit、Quarantined及Damaged數量。 |
| OBJ-04 | 透過預留、提交時重驗及資料庫一致性控制，避免超賣與負庫存。 |
| OBJ-05 | 讓有效期商品按 FEFO 安全出庫，避免過期或效期不足商品進入正常銷售流程。 |
| OBJ-06 | 支援中小企業日常必需的收發、庫內移動、跨倉調撥、調整及盤點。 |
| OBJ-07 | 確保每次庫存變化都有來源、操作者、時間、原因及前後數量，可完整追溯。 |
| OBJ-08 | 為 Purchasing、Receiving、Sales、Fulfillment及Returns提供一致、冪等的庫存契約。 |

### 1.2 建議成功指標

| 編號 | 指標 | 建議目標 |
| --- | --- | --- |
| KPI-01 | 出現任何維度負 On Hand 或負 Available to Promise 的次數 | 0 |
| KPI-02 | 同一來源業務事件重送後造成重複入庫、出庫、預留或釋放的次數 | 0 |
| KPI-03 | 可追溯至合法庫存異動的結餘變化比例 | 100% |
| KPI-04 | 庫存異動成功後同時具備完整稽核及來源關聯的比例 | 100% |
| KPI-05 | 過期、Quarantined或Damaged庫存被正常銷售預留／分配／出庫的次數 | 0 |
| KPI-06 | 使用者可由SKU或條碼找到其Warehouse／Bin／Lot結餘的典型查詢時間 | 95%請求在2秒內完成 |
| KPI-07 | 已完成盤點範圍的帳面數與核准盤點結果一致率 | 100% |
| KPI-08 | 跨倉調撥的來源、在途及目的地數量可對賬率 | 100% |
| KPI-09 | 未獲授權使用者進行調整、狀態轉換或FEFO例外的次數 | 0 |

KPI為上線前驗收基線；正式量測方式、環境及報表口徑由業務、倉務、QA及技術團隊共同確認。

## 2. 範圍與能力邊界

### 2.1 本期範圍

- Warehouse及其Bin的建立、查詢、修改、停用及受控刪除。
- 以 Warehouse＋Bin＋SKU＋Lot＋Stock Status 記錄Base UOM整數結餘。
- 無批次、只追蹤批次、追蹤批次及有效期三種庫存處理方式。
- 依SKU查詢各Warehouse／Bin／Lot的On Hand、Reserved及可用數量。
- 外部Receiving／Fulfillment等模組確認後的入庫及出庫過帳。
- 銷售或其他來源按SKU／Warehouse預留、部分耗用、釋放及取消。
- 揀貨時按Lot／Bin分配，效期商品預設FEFO。
- 同一倉庫內Bin-to-Bin移動。
- 倉庫之間的Draft、Dispatch、In Transit及Receive調撥流程。
- `AVAILABLE`、`QUARANTINED`、`DAMAGED`之間的受控狀態轉換。
- 有原因及權限控制的正數／負數庫存調整；任何結果不得為負。
- 按Warehouse／Bin進行簡單盤點、暫停目標庫位異動、錄入實數及過帳差異。
- 上線前Opening Balance CSV預檢、確認及一次性導入。
- 庫存列表、批次／效期查詢、異動歷史、調撥、預留、盤點及CSV匯出。
- 完整稽核、冪等、並發控制、來源關聯及錯誤處理。

### 2.2 本期不包含

- 採購申請、詢價、採購單、供應商報價、收貨單及採購退貨單據本身。
- 報價、Sales Order、POS、Shipment、Delivery、Customer Return及換貨單據本身。
- Serial Number逐件追蹤；現有Item規格的`serial` Tracking Policy須另行修訂或在本期停用。
- 移動平均、FIFO或其他成本計算、標準成本、庫存估值、COGS、毛利及會計分錄。
- 補貨建議、安全庫存、自動採購、需求預測及MRP。
- 波次、揀貨路線、任務派工、包裝台、裝車、車隊或配送路線。
- 固定一個Bin只放一個SKU、容量／重量／體積限制及自動庫位推薦。
- 手提掃描器或自動化設備整合、RFID、機械人、自動輸送及倉庫平面圖。
- 生產、BOM、組裝、拆包、套裝、加工、轉換及委外製造。
- 寄售庫存、第三方所有權、客戶所有庫存、多公司、多法人及多租戶隔離。
- 自動電郵／短訊庫存告警；本期只提供可查詢及可匯出的零ATP／效期資料基礎。
- 直接在Inventory Management內建立沒有正式來源的採購、銷售、發貨或退貨交易。

### 2.3 業務能力分組

| Capability ID | 能力 | 責任 |
| --- | --- | --- |
| INV-CAP-01 | Warehouse and Bin | 維護少量倉庫及其具體庫位。 |
| INV-CAP-02 | Stock and Lot | 保存每個SKU／Lot／Bin／Status結餘與效期。 |
| INV-CAP-03 | Movement Ledger | 以不可任意改寫的異動記錄所有數量及狀態變化。 |
| INV-CAP-04 | Reservation and Allocation | 預留SKU／Warehouse數量，揀貨時分配合資格Lot／Bin。 |
| INV-CAP-05 | Move and Transfer | 支援庫內Bin移動及跨倉調撥。 |
| INV-CAP-06 | Adjustment and Stocktake | 受控處理差異、狀態轉換及實物盤點。 |
| INV-CAP-07 | Inquiry and Integration | 提供查詢、匯出、開帳、稽核及下游契約。 |

所有能力屬於同一Inventory domain，使用同一套結餘、異動及並發規則；不建立多個互相重複計算庫存的服務。

### 2.4 上下游依賴

| 系統／模組 | 關係 |
| --- | --- |
| User Management | 提供使用者、角色、權限、密碼再確認及稽核操作者身份。 |
| Item Management | 提供SKU ID、SKU Code、Barcode、Base UOM、Inventory Tracked、狀態、Lot／Expiry政策及最低收貨／銷售剩餘效期。 |
| Supplier Management | Inventory只保留來源Supplier ID快照／關聯需要；不複製供應商主資料或付款資料。 |
| Customer Management | Inventory通常不直接讀Customer主資料；Sales／Fulfillment保存其交易及地址快照。 |
| Purchasing／Receiving | 確認收貨後呼叫Inventory入庫，提供SKU、數量、Lot、Expiry、目的Bin及來源單據行。 |
| Sales／Fulfillment | 建立／釋放預留，揀貨時取得合資格Lot／Bin，確認發貨後過帳出庫。 |
| Returns | 退回貨品檢查後以明確Stock Status入庫；Return單據及退款不由Inventory建立。 |
| Reporting／Audit | 讀取受控庫存摘要及異動；不得另外維護一套可被直接修改的庫存結餘。 |

## 3. 名詞定義

| 名詞 | 定義 |
| --- | --- |
| Warehouse | 公司實際保存存貨的倉庫。系統按不超過5個倉庫的營運規模設計。 |
| Bin／Location | Warehouse內可識別的具體存放位置；Bin Code只需在所屬Warehouse內唯一。 |
| SKU | Inventory可記錄數量的最小商品單位，引用Item Management不可重用的SKU ID。 |
| Base UOM | SKU庫存的統一計量單位；所有庫存結餘及異動最終以Base UOM正整數表示。 |
| Lot／Batch | 同一SKU具有共同批次識別及效期資料的一批貨。Lot Number在同一SKU內唯一。 |
| Stock Status | 可人工控制的庫存用途狀態：Available、Quarantined或Damaged。 |
| On Hand | 已完成入庫、尚未完成出庫的實體數量，包含Available、Quarantined及Damaged。 |
| Reserved | 由有效業務來源暫時占用、尚未出庫或釋放的SKU／Warehouse數量。 |
| Available On Hand | Stock Status為Available且未過期的實體數量；實際銷售可用還須符合最低銷售剩餘效期。 |
| Available to Promise／ATP | 指定Warehouse內合資格Available On Hand減去有效Reserved後可供新預留的數量。 |
| Allocation | 將已預留數量指定至實際Lot及Bin的揀貨分配；不代表已完成出庫。 |
| In Transit | 跨倉調撥已由來源Warehouse Dispatch、但尚未由目的Warehouse Receive的數量；不屬任何Bin或Stock Status。 |
| FEFO | First Expired, First Out；優先分配最早到期且仍符合最低銷售剩餘效期的批次。 |
| Movement | 造成On Hand、Stock Status、Bin、Warehouse或In Transit數量變化的不可任意改寫業務記錄。 |
| Adjustment | 用於更正經確認差異的庫存增減或狀態轉換；不得代替正常收貨、出貨或調撥。 |
| Stocktake | 針對指定Warehouse／Bin核對帳面數量與實際數量並過帳差異的盤點流程。 |
| Source Reference | 觸發庫存操作的正式模組、單據、單據行及事件識別，用於冪等及追溯。 |

## 4. 角色、權限與責任

| 角色 | 主要責任 | 建議權限 |
| --- | --- | --- |
| 庫存查閱者 | 查看Warehouse、Bin、結餘、Lot、效期、預留、調撥、盤點結果及異動。 | `inventory.view` |
| 倉務操作員 | 執行來源明確的入庫、出庫、庫內移動、調撥收發、揀貨分配及盤點錄入。 | `inventory.view`＋`inventory.operation` |
| 庫存管理員 | 維護Warehouse／Bin、管理Opening Balance及監察庫存異常。 | `inventory.view`＋`inventory.mgmt` |
| 庫存調整人員 | 過帳庫存增減、狀態轉換、盤點差異及正式沖銷。 | `inventory.view`＋`inventory.adjust` |
| FEFO例外使用者 | 在有合理原因時選擇非最早到期但仍合資格的批次。 | 對應業務權限＋`inventory.fefo.override` |
| 下游業務角色 | 只在其採購、收貨、銷售、發貨或退貨流程使用所需Inventory能力。 | 由下游模組權限授權，不自動取得Inventory管理頁面權限 |
| 系統管理員 | 指派權限及處理系統營運；不應因角色名稱而自動取得調整或FEFO例外能力。 | 按職責明確指派 |

權限須由後端執行，不能只隱藏UI按鈕。`inventory.operation`、`inventory.mgmt`、`inventory.adjust`及`inventory.fefo.override`互不自動包含；角色可按實際工作組合權限。本期不建立Inventory雙人審批流程。

## 5. 核心業務原則

1. **Inventory是數量唯一事實來源。** 任何模組不得維護另一套可被獨立修改的On Hand、Reserved或In Transit。
2. **SKU是庫存最小商品單位。** 所有庫存記錄須引用正式SKU ID，不以SKU Code、Barcode或名稱作永久外鍵。
3. **位置必須準確。** 所有On Hand必須屬於一個Active Warehouse及其Active Bin，不接受只有Warehouse而沒有Bin的實體庫存。
4. **允許靈活混放。** 同一SKU／Lot可分散於多個Bin，同一Bin可保存多個SKU／Lot，不建立一對一限制。
5. **Base UOM為唯一結餘單位。** 外部Pack UOM須使用Item Management的有效整數換算後才可過帳。
6. **禁止負庫存。** 任何操作及並發結果均不可令On Hand、特定Stock Bucket或Warehouse ATP低於零。
7. **結餘不可直接修改。** 所有變化必須來自Movement、Reservation或Allocation，並與來源及稽核一致。
8. **預留與實貨分配分開。** 訂單先按SKU／Warehouse預留；揀貨時才選擇具體Lot／Bin，避免過早鎖死位置。
9. **只有合資格存貨可銷售。** 過期、效期不足、Quarantined及Damaged不得進入正常預留、分配或出庫。
10. **效期商品預設FEFO。** 非FEFO只在批次仍合資格、有專門權限及原因時允許，並完整稽核。
11. **調整不是正常交易捷徑。** 已知來源的收貨、發貨、退貨或調撥必須走相應流程，不能以Adjustment代替。
12. **歷史不可破壞。** 已過帳Movement不得修改或刪除；錯誤以帶來源關聯的反向Movement處理。
13. **跨倉調撥須有在途階段。** Dispatch後數量離開來源Bin，Receive前不得出現在目的Bin或被預留。
14. **盤點期間保護目標Bin。** 進入Counting後暫停該Bin的庫存異動，完成或取消後才解除。
15. **簡單優先。** 本期不加入大型WMS、自動補貨、成本核算或未確認的設定參數。

## 6. 資料概念模型

### 6.1 關係概覽

```text
Warehouse ──< Bin
                 │
SKU ──< Lot ─────┼──< Stock Balance >── Stock Status
                 │
                 ├──< Movement
                 ├──< Allocation >── Reservation
                 ├──< Transfer Line >── Transfer
                 └──< Stocktake Line >── Stocktake

Business Source ──< Reservation / Movement / Transfer
```

### 6.2 Warehouse

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Warehouse ID | 系統 | 不可重用的內部識別碼。 |
| Warehouse Code | 是 | 人工輸入；trim及不分英文字母大小寫後全公司唯一。 |
| Warehouse Name | 是 | 供畫面及單據顯示。 |
| Address／Description | 否 | 簡單文字資訊；不取代Supplier／Customer地址。 |
| Status | 是 | Active或Inactive。 |
| Created／Updated | 系統 | 保存時間、操作者及資料版本。 |

營運規模為5個以內倉庫，但系統不因建立第6個倉庫而硬性破壞資料；如未來長期超出支援規模，須重新評估效能、權限及流程。

### 6.3 Bin

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Bin ID | 系統 | 不可重用的內部識別碼。 |
| Warehouse | 是 | 每個Bin只屬於一個Warehouse。 |
| Bin Code | 是 | 人工輸入；trim及不分英文字母大小寫後在所屬Warehouse內唯一。 |
| Bin Name／Description | 否 | 例如貨架或區域說明，不影響唯一識別。 |
| Status | 是 | Active或Inactive。 |
| Created／Updated | 系統 | 保存時間、操作者及資料版本。 |

本期不建立Bin容量、固定SKU、Bin Type、座標、路線或自動推薦。Inactive Bin不可接受新庫存異動；有On Hand、Reservation Allocation、未完成Transfer或Active Stocktake時不可停用。

### 6.4 Lot／Batch

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Lot ID | 系統 | 不可重用的內部識別碼。 |
| SKU | 是 | Lot只屬於一個SKU。 |
| Lot Number | 依政策 | SKU為batch或batch_expiry時必填；trim後在同一SKU內唯一。 |
| Expiry Date | 依政策 | SKU為batch_expiry時必填；相同SKU／Lot全公司必須一致。 |
| Manufacture Date | 否 | 如輸入不得晚於Expiry Date。 |
| First Receipt Date | 系統 | 首次正式入庫日期，用於查詢及無效期時的操作建議。 |
| Status | 系統 | 是否Expired由Expiry Date及公司統一時區計算，不讓使用者手工修改。 |

SKU Tracking Policy為`none`時不要求Lot Number或Expiry Date；系統以非批次庫存處理。`serial`在本期不受支援，任何Inventory過帳不得靜默把Serial SKU當成非批次商品。

### 6.5 Stock Balance

每筆結餘表示一個 `Warehouse + Bin + SKU + Lot／No Lot + Stock Status` 組合。數量使用Base UOM非負整數。

| 數量 | 定義 |
| --- | --- |
| On Hand by Bucket | 該Warehouse／Bin／SKU／Lot／Status的實體數量。 |
| Total On Hand | 同一SKU在指定範圍所有Status的On Hand總和。 |
| Available On Hand | Status為Available且未過期的On Hand；不代表必然符合某項銷售最低效期。 |
| Reserved | 同一SKU／Warehouse所有Active Reservation尚未耗用的數量。 |
| ATP | 指定用途下合資格Available On Hand減去Reserved；不得低於0。 |
| In Transit | 已Dispatch而未Receive的跨倉調撥數量，獨立於Bin結餘。 |

### 6.6 Reservation and Allocation

Reservation至少保存來源模組、來源單據ID、來源行ID、SKU、Warehouse、預留數量、已耗用數量、已釋放數量、狀態及版本。系統不自動部分預留：請求數量全部可用才成功，否則完整拒絕，由來源模組決定是否改用其他倉庫或較小數量。

Allocation在揀貨時把Reservation的全部或部分未耗用數量指定至一個或多個合資格Lot／Bin。Allocation可釋放或重新分配；只有正式出庫Movement才扣減On Hand。

### 6.7 Movement

Movement至少保存：不可重用ID、Movement Type、Warehouse／Bin、SKU／Lot／Status、正負方向及數量、來源模組／單據／行／事件、原因、操作者、過帳時間、關聯Movement及過帳後數量摘要。

Movement Type至少包括：Opening、Receipt、Issue、Bin Move Out／In、Transfer Dispatch／Receive、Status Transfer Out／In、Adjustment Increase／Decrease、Stocktake Variance及Reversal。Reservation／Allocation可使用獨立記錄，不冒充On Hand Movement。

### 6.8 Transfer

Transfer保存來源Warehouse、目的Warehouse、狀態、建立／Dispatch／Receive操作者與時間，以及每行SKU、Lot、數量、來源Bin及收貨目的Bin。來源與目的Warehouse不可相同；同倉移動使用Bin Move。

### 6.9 Stocktake

Stocktake保存盤點範圍、狀態、帳面快照、實際點算、差異、操作者及時間。最小盤點範圍為一個或多個Bin；本期不建立複雜抽樣、盲盤多輪、盤點隊伍或雙人審批。

## 7. 狀態與核心流程

### 7.1 Warehouse／Bin狀態

```text
Active ──> Inactive ──> Active
  │
  └─> Delete（只限從未使用且沒有子資料／引用）
```

- Warehouse只有在所有Bin均無任何庫存，且沒有有效Reservation／Allocation、未完成調撥或盤點後才可停用。
- Bin只有在沒有On Hand、Allocation、未完成調撥或Active Stocktake時才可停用。
- 已有Movement歷史的Warehouse／Bin不得永久刪除，只能停用。

### 7.2 Stock Status

| 狀態 | 可計入On Hand | 可預留 | 可正常分配／出庫 | 說明 |
| --- | --- | --- | --- | --- |
| Available | 是 | 符合SKU及效期規則時可以 | 符合SKU及效期規則時可以 | 正常可用存貨。 |
| Quarantined | 是 | 否 | 否 | 待檢查或暫停使用。 |
| Damaged | 是 | 否 | 否 | 已確認損壞、待報廢或其他處理。 |

Stock Status轉換是數量移動，不是直接改一個欄位；必須同時產生來源扣減、目的增加、原因及稽核。Expired為系統判定的資格，不是第四個可手工切換狀態。

### 7.3 Reservation狀態

```text
Active ──> Partially Consumed ──> Consumed
   ├──────────────> Released
   └──────────────> Cancelled
```

- 建立Reservation時全量檢查ATP；不足時整個請求失敗。
- Reservation可部分Allocation及部分Issue；未使用餘額可由來源流程釋放。
- Inventory不自行猜測Sales Order是否逾期；自動釋放政策由正式來源模組提出，沒有來源事件不得自動刪除Reservation。

### 7.4 跨倉Transfer狀態

```text
Draft ──> In Transit ──> Received
  └─────> Cancelled
```

- Draft只代表計劃，不改任何庫存，可修改或取消。
- Dispatch須一次確認整張Transfer，原子扣減來源Bin並增加In Transit；本期不支援部分Dispatch。
- Receive須一次確認全部In Transit數量並指定每行目的Bin；本期不支援部分Receive。
- In Transit不可取消或直接修改。若運輸發生短少、損壞或錯誤，先按原數Receive至Quarantined，再由有權限人員以正式Adjustment／Status Transfer處理並關聯原Transfer。

### 7.5 Stocktake狀態

```text
Draft ──> Counting ──> Ready to Post ──> Posted
  │          │              │
  └──────────┴──────────────> Cancelled
```

- Draft定義Warehouse及Bin範圍，不鎖庫存。
- 進入Counting時保存帳面快照並鎖定目標Bin的庫存異動。
- Counting期間可逐項保存實數及新增現場發現但帳面為0的SKU／Lot。
- Ready to Post後不可再改點算數；Posting以差異Movement更新結餘並解除Bin鎖。
- Cancelled不產生數量變化並解除所有相關Bin鎖。

## 8. 功能需求

### 8.1 Warehouse與Bin維護

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-MASTER-001 | Must | 系統須提供Warehouse列表、詳情、新增、修改、停用及恢復功能。 |
| FR-MASTER-002 | Must | Warehouse Code在全公司經trim及不分英文字母大小寫後唯一；Archived／Inactive歷史亦繼續占用。 |
| FR-MASTER-003 | Must | 系統須提供每個Warehouse下的Bin列表、新增、修改、停用及恢復功能。 |
| FR-MASTER-004 | Must | Bin Code在所屬Warehouse內經trim及不分英文字母大小寫後唯一；不同Warehouse可使用相同Bin Code。 |
| FR-MASTER-005 | Must | 每個On Hand結餘必須指定一個屬於同一Warehouse的Active Bin。 |
| FR-MASTER-006 | Must | Warehouse停用前須確認其所有Bin沒有On Hand，且沒有有效Reservation／Allocation、未完成Transfer或Active Stocktake。 |
| FR-MASTER-007 | Must | Bin停用前須確認其沒有On Hand、有效Allocation、未完成Transfer或Active Stocktake。 |
| FR-MASTER-008 | Must | 已有Movement或其他歷史引用的Warehouse／Bin不得永久刪除；從未使用且無子資料者才可刪除。 |
| FR-MASTER-009 | Must | Warehouse／Bin更新須帶資料版本，版本不一致時拒絕無聲覆蓋。 |
| FR-MASTER-010 | Should | 列表可按Code、Name、Status搜尋及篩選，預設只顯示Active資料。 |

### 8.2 庫存查詢與結餘

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-STOCK-001 | Must | 使用者須可按SKU Code、Barcode、SKU Name、Warehouse、Bin、Lot、Expiry Date及Stock Status查詢庫存。 |
| FR-STOCK-002 | Must | 庫存摘要須清楚顯示Total On Hand、Available On Hand、Reserved、ATP、Quarantined、Damaged及In Transit，不得以一個「庫存量」混合不同語意。 |
| FR-STOCK-003 | Must | 使用者須可由SKU展開至Warehouse、Bin、Lot及Stock Status明細，也可由Warehouse／Bin查看其內所有SKU／Lot。 |
| FR-STOCK-004 | Must | 所有數量以SKU Base UOM顯示及保存；如同時顯示Pack UOM換算，須標明只是換算展示且不得產生小數Base UOM。 |
| FR-STOCK-005 | Must | 查詢須即時反映已過帳Movement及有效Reservation，不得依靠需要人手重整的快取才能得到正確數量。 |
| FR-STOCK-006 | Must | Expired、Quarantined及Damaged須有文字狀態及數量，不可只靠顏色區分。 |
| FR-STOCK-007 | Must | 使用者須可查看特定結餘Bucket的最近Movement及來源，並由Movement返回相關SKU／Lot／Bin。 |
| FR-STOCK-008 | Must | 列表採server-side分頁、穩定排序及明確篩選；不得一次載入全部Movement或Stock Bucket。 |
| FR-STOCK-009 | Must | 庫存查詢權限只允許查看，不得透過查詢、匯出或URL參數造成任何數量變化。 |
| FR-STOCK-010 | Should | 系統可提供無庫存、零ATP、即將到期及已過期的篩選結果；本期不自動產生補貨建議。 |

### 8.3 Lot與有效期

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-LOT-001 | Must | Inventory須在每次入庫及異動時讀取SKU當下有效的Tracking Policy，不得由使用者自由選擇是否提供Lot。 |
| FR-LOT-002 | Must | Tracking Policy為`none`時，不要求Lot Number或Expiry Date，並以非批次庫存處理。 |
| FR-LOT-003 | Must | Tracking Policy為`batch`時，Lot Number必填，Expiry Date選填。 |
| FR-LOT-004 | Must | Tracking Policy為`batch_expiry`時，Lot Number及Expiry Date均必填。 |
| FR-LOT-005 | Must | 同一SKU的Lot Number經trim後唯一；相同SKU／Lot的Expiry Date及Manufacture Date不得互相矛盾。 |
| FR-LOT-006 | Must | Expiry Date早於當日的Lot自當日開始不可預留、分配或正常出庫；判定使用系統統一時區。 |
| FR-LOT-007 | Must | 如SKU有Minimum Receipt Life，收貨不足效期但尚未過期時須由Receiving模組提供`receiving.expiry.override`、逐筆原因及門檻證據，Inventory才可過帳；已過期Lot永遠不可Override。 |
| FR-LOT-008 | Must | 如SKU有Minimum Sale Life，低於門檻的Lot不得被正常銷售分配或出庫。 |
| FR-LOT-009 | Must | `serial` Tracking Policy在本期須被明確拒絕並回傳可理解錯誤，不得降級為`none`或`batch`。 |
| FR-LOT-010 | Should | 使用者可按指定天數區間查看即將到期Lot，但本期不提供自動電郵或短訊提醒。 |

### 8.4 入庫與出庫過帳

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-POST-001 | Must | Inventory須接受已授權下游流程的Receipt／Issue過帳，並要求正式Source Reference；Inventory畫面不得自行建立採購、銷售或發貨單據。 |
| FR-POST-002 | Must | 每個過帳請求須提供SKU、Base UOM數量或可驗證的Pack UOM換算、Warehouse、Bin、Lot／Expiry（如適用）及來源事件ID。 |
| FR-POST-003 | Must | Receipt成功時在同一交易增加正確Stock Bucket並建立Movement及Audit；任何一步失敗須全部回滾。 |
| FR-POST-004 | Must | Issue成功時在同一交易扣減指定Allocation／Lot／Bin、耗用Reservation並建立Movement及Audit；任何一步失敗須全部回滾。 |
| FR-POST-005 | Must | Receipt只能進入來源指定的Available、Quarantined或Damaged狀態；Returns等模組不得讓Inventory猜測品質結果。 |
| FR-POST-006 | Must | Issue只可使用未過期、狀態為Available且符合來源用途效期規則的庫存。 |
| FR-POST-007 | Must | Source Module＋Source Document＋Source Line＋Event ID須形成冪等識別；相同事件重送不得重複過帳。 |
| FR-POST-008 | Must | 同一冪等識別搭配不同SKU、數量、位置或Lot資料時須拒絕並標示衝突，不得沿用舊結果或再次寫入。 |
| FR-POST-009 | Must | Item／SKU、Warehouse、Bin、Lot、Stock Status及權限須在提交時重新驗證，不得只依畫面載入時的狀態。 |
| FR-POST-010 | Must | 出庫、移動或調撥不足時完整拒絕，不得自動把可用多少就扣多少。 |
| FR-POST-011 | Must | 已過帳Receipt／Issue不可編輯或刪除；錯誤須透過授權Reversal及正確的新過帳處理。 |
| FR-POST-012 | Should | 使用者可由Inventory Movement連結回來源單據；來源模組未安裝時仍須保存穩定來源文字及ID。 |

### 8.5 預留、分配與FEFO

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-RES-001 | Must | 已授權來源可按SKU／Warehouse建立Reservation；建立時不強制指定Lot或Bin。 |
| FR-RES-002 | Must | Reservation請求數量須全部可由當下ATP滿足才成功；不足時整筆拒絕，不自動部分預留。 |
| FR-RES-003 | Must | 相同來源行及事件重送不得建立重複Reservation；不同內容使用相同事件ID須回衝突。 |
| FR-RES-004 | Must | Reservation須支援部分耗用及部分釋放，且任何時候 `original = consumed + released + outstanding`。 |
| FR-RES-005 | Must | Reservation取消或來源單據取消時須釋放所有未耗用數量；已耗用部分不得復活。 |
| FR-RES-006 | Must | Inventory不得在沒有正式來源事件時自行猜測或自動刪除Reservation。 |
| FR-RES-007 | Must | 建立、耗用、釋放及取消Reservation均須保存來源、時間、操作者／系統身份及稽核。 |
| FR-RES-008 | Must | Quarantined、Damaged、Expired或不符合用途最低效期的庫存不得計入該用途ATP。 |
| FR-RES-009 | Must | 所有並發Reservation須以一致性控制保證總Reserved不超過合資格Available On Hand。 |
| FR-RES-010 | Must | Reservation須有版本或等效並發控制，過時的釋放／耗用請求不得覆蓋較新狀態。 |
| FR-ALLOC-001 | Must | 揀貨時可把一個Reservation分配至一個或多個合資格Lot／Bin，總Allocation不得超過未耗用Reservation。 |
| FR-ALLOC-002 | Must | 有Expiry Date的SKU預設依最早Expiry Date、再依Lot及Bin穩定排序建議Allocation。 |
| FR-ALLOC-003 | Must | 無Expiry Date但有Lot的SKU可按First Receipt Date提供最舊批次優先建議，但不作成本計算。 |
| FR-ALLOC-004 | Must | 一般使用者偏離FEFO時須被阻擋；持有`inventory.fefo.override`者只有在所選Lot仍合資格且填寫原因後才可繼續。 |
| FR-ALLOC-005 | Must | Expired、效期不足、Quarantined、Damaged、Inactive Bin或不屬該Warehouse的庫存均不可Allocation。 |
| FR-ALLOC-006 | Must | Allocation不扣減On Hand；只有Issue過帳才扣減實貨並耗用Reservation。 |
| FR-ALLOC-007 | Must | Allocation可在Issue前釋放或重新分配；操作須重新驗證Lot／Bin餘量及Reservation版本。 |
| FR-ALLOC-008 | Must | 同一Lot在多個Bin時可分配多個明細；不得假設Lot只存在一個位置。 |
| FR-ALLOC-009 | Must | 分配後如Lot過期、Bin停用或庫存狀態改變，Issue提交時須拒絕並要求重新分配。 |
| FR-ALLOC-010 | Must | FEFO例外須稽核應選Lot、實選Lot、Expiry Date、數量、操作者、原因及來源單據。 |

### 8.6 庫內移動與跨倉調撥

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-MOVE-001 | Must | 使用者可把指定SKU／Lot／Stock Status數量從同一Warehouse的一個Bin原子移至另一個Active Bin。 |
| FR-MOVE-002 | Must | 來源及目的Bin不可相同，且必須屬於同一Warehouse；跨Warehouse必須使用Transfer。 |
| FR-MOVE-003 | Must | Bin Move須同時產生來源Out及目的In Movement，兩者以同一操作ID關聯，任一失敗全部回滾。 |
| FR-MOVE-004 | Must | 移動不得改變SKU、Lot、Expiry Date或Stock Status；狀態改變使用Status Transfer。 |
| FR-MOVE-005 | Must | 如移動將使來源Warehouse合資格庫存低於有效Reserved，操作須拒絕。 |
| FR-MOVE-006 | Must | Counting中的來源或目的Bin不可執行Bin Move。 |
| FR-MOVE-007 | Must | Bin Move須要求正整數數量、版本、操作者及可選原因，並完整稽核。 |
| FR-TRANSFER-001 | Must | 使用者可建立不同Active Warehouses之間的Draft Transfer，包含一個或多個SKU／Lot來源Bin及數量。 |
| FR-TRANSFER-002 | Must | Draft Transfer不改變On Hand、Reserved或In Transit，可在Dispatch前修改或取消。 |
| FR-TRANSFER-003 | Must | Dispatch須重新驗證來源Bin、SKU／Lot／Status、數量、Reservation保障及Stocktake鎖。 |
| FR-TRANSFER-004 | Must | Dispatch成功時原子扣減來源Bin並增加相同數量In Transit；任一行失敗則整張不過帳。 |
| FR-TRANSFER-005 | Must | 本期不支援部分Dispatch；使用者須在提交前修改Draft至實際可發數量。 |
| FR-TRANSFER-006 | Must | In Transit不可預留、分配、出庫、修改或取消。 |
| FR-TRANSFER-007 | Must | Receive須為每行指定屬於目的Warehouse的Active Bin，並保存原SKU／Lot／Expiry Date。 |
| FR-TRANSFER-008 | Must | Receive成功時原子清除整張Transfer的In Transit並增加目的Bin結餘；本期不支援部分Receive。 |
| FR-TRANSFER-009 | Must | 調撥收貨預設保持Dispatch時的Stock Status；如運輸結果需隔離，使用者可選擇Receive至Quarantined並記原因。 |
| FR-TRANSFER-010 | Must | Transfer短少、損壞或錯誤不以修改Dispatch歷史處理；須完成收貨後使用關聯Adjustment／Status Transfer更正。 |
| FR-TRANSFER-011 | Must | Dispatch及Receive須各自冪等，重送不得重複扣減來源、增加In Transit或增加目的地。 |
| FR-TRANSFER-012 | Must | Transfer須清楚顯示Draft、In Transit、Received或Cancelled及各階段操作者與時間。 |

### 8.7 庫存調整與狀態轉換

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-ADJUST-001 | Must | 只有`inventory.adjust`可過帳Adjustment、Status Transfer、Stocktake Variance及Reversal。 |
| FR-ADJUST-002 | Must | Adjustment須指定Warehouse、Bin、SKU、Lot／Expiry（如適用）、Stock Status、正數或負數方向、正整數數量及原因。 |
| FR-ADJUST-003 | Must | 負Adjustment須重新驗證實際Bucket數量、有效Reserved及並發版本，結果不得為負。 |
| FR-ADJUST-004 | Must | 正Adjustment須遵守SKU Tracking Policy、Lot一致性、Bin狀態及效期規則，不得成為繞過正常Receipt的默認做法。 |
| FR-ADJUST-005 | Must | Available、Quarantined及Damaged之間的狀態轉換須原子扣減來源Bucket並增加目的Bucket，總On Hand不變。 |
| FR-ADJUST-006 | Must | 把Available轉為Quarantined／Damaged時，如剩餘合資格數量不足以覆蓋Reserved，須先由來源流程釋放或重新安排Reservation。 |
| FR-ADJUST-007 | Must | 將Quarantined／Damaged恢復為Available須由`inventory.adjust`填寫原因；Expired Lot即使轉為Available仍不可正常銷售。 |
| FR-ADJUST-008 | Must | 已過帳Movement不可修改或刪除；Reversal須關聯原Movement、使用相反效果並再次通過所有當下規則。 |
| FR-ADJUST-009 | Must | 同一Adjustment／Reversal重送須冪等；同一事件ID不同內容須拒絕。 |
| FR-ADJUST-010 | Should | 系統可要求使用者從簡單Reason Category選擇差異原因並補充文字，但不建立多層審批或複雜工作流。 |

### 8.8 Stocktake盤點

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-COUNT-001 | Must | 使用者可建立指定Warehouse及一個或多個Bin的Draft Stocktake；同一Bin同時最多屬於一個未完成Stocktake。 |
| FR-COUNT-002 | Must | 開始Counting時須保存目標Bin所有SKU／Lot／Status的帳面快照並鎖定Bin庫存異動。 |
| FR-COUNT-003 | Must | Counting期間Receipt、Issue、Bin Move、Transfer、Adjustment及其他會改變目標Bin On Hand的操作須被拒絕。 |
| FR-COUNT-004 | Must | 使用者可逐行輸入非負整數實際數量、保存進度並看到尚未點算項目。 |
| FR-COUNT-005 | Must | 使用者可加入現場發現但帳面數量為0的SKU／Lot／Status，仍須通過SKU、Lot及Bin規則。 |
| FR-COUNT-006 | Must | 相同Bin／SKU／Lot／Status在一個Stocktake內只能有一個有效盤點結果。 |
| FR-COUNT-007 | Must | Ready to Post須要求所有盤點行完成或被明確標記為未發現；之後一般操作員不可再修改實數。 |
| FR-COUNT-008 | Must | Posting須由`inventory.adjust`一次性過帳全部差異；任一行失敗則全部差異不生效且Bin保持鎖定。 |
| FR-COUNT-009 | Must | Posted Stocktake的帳面值、實際值、差異及Movement關聯不可修改或刪除。 |
| FR-COUNT-010 | Must | Cancelled Stocktake不得產生數量變化，並須可靠解除其所有Bin鎖。 |
| FR-COUNT-011 | Must | Counting／Posting重送及兩人同時操作須以版本與冪等控制避免重複差異。 |
| FR-COUNT-012 | Should | 系統提供簡單盤點差異摘要及CSV下載；本期不提供盲盤多輪或盤點隊伍分派。 |

### 8.9 Opening Balance

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-OPEN-001 | Must | 上線前可下載Opening Balance CSV模板，欄位只包含Warehouse、Bin、SKU、Lot／Expiry、Stock Status及Base UOM數量。 |
| FR-OPEN-002 | Must | 導入須先Precheck，驗證Warehouse／Bin所有權、SKU政策、Lot一致性、正整數數量、重複列及資料版本，不可在Precheck寫入庫存。 |
| FR-OPEN-003 | Must | 有任何錯誤時整份Opening Balance不可確認，並須回傳可定位至row及field的錯誤。 |
| FR-OPEN-004 | Must | 確認導入須使用高風險重新認證、`inventory.mgmt`、原因及冪等識別，並以單一受控作業過帳Opening Movements。 |
| FR-OPEN-005 | Must | 相同Warehouse／Bin／SKU／Lot／Status重複列須在Precheck阻擋，不得自動相加掩蓋輸入錯誤。 |
| FR-OPEN-006 | Must | Inventory Go-Live後Opening Balance功能須關閉；後續差異只可走Adjustment／Stocktake。 |
| FR-OPEN-007 | Must | Opening Balance結果、錯誤、操作者、檔案雜湊、原因及Movement關聯須可稽核；不得在稽核保存整份CSV內容。 |

### 8.10 報表、匯出及稽核

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-REPORT-001 | Must | 系統須提供查詢當下的現行庫存摘要，按Warehouse、Bin、SKU、Lot、Expiry及Status篩選及匯出。 |
| FR-REPORT-002 | Must | 系統須提供Movement歷史，按日期、類型、來源、SKU、Warehouse、Bin、Lot及操作者查詢。 |
| FR-REPORT-003 | Must | 系統須提供Active Reservation及Allocation查詢，能定位來源單據及尚未耗用數量。 |
| FR-REPORT-004 | Must | 系統須提供In Transit Transfer查詢及來源／目的Warehouse對賬。 |
| FR-REPORT-005 | Must | 系統須提供Expired及指定天數內到期的Lot查詢，並分開顯示Available、Quarantined及Damaged數量。 |
| FR-REPORT-006 | Must | CSV匯出須沿用畫面篩選語意、穩定欄位、Base UOM及公司統一時間格式，並防止CSV公式注入。 |
| FR-REPORT-007 | Must | 報表及匯出不得包含成本、未授權資料、內部路徑、認證資訊或未定義的預測值。 |
| FR-REPORT-008 | Should | 本期只提供營運清單及匯出，不建立自訂報表設計器、圖表Dashboard或排程派送。 |
| FR-AUDIT-001 | Must | Warehouse、Bin、Reservation、Allocation、Movement、Transfer、Adjustment、Stocktake、Opening及FEFO例外均須有稽核。 |
| FR-AUDIT-002 | Must | 稽核須保存actor、action、object、before／after摘要、reason、time、request／correlation ID、source reference及outcome。 |
| FR-AUDIT-003 | Must | 每個數量變化須可由Stock Bucket追至Movement、來源事件及稽核，也可由來源事件反查其庫存效果。 |
| FR-AUDIT-004 | Must | 業務寫入與必要Audit須保持一致；Audit失敗時不得無聲完成庫存變化。 |
| FR-AUDIT-005 | Must | Audit及應用Log不得保存密碼、token、完整上載檔案內容或未經過濾的CSV。 |
| FR-AUDIT-006 | Must | 已過帳Movement及Audit不得由一般應用使用者更新或刪除，且須按公司稽核政策至少保留7年。 |
| FR-AUDIT-007 | Must | 失敗、拒絕、版本衝突、冪等衝突及越權操作須留下足以調查但不洩漏敏感資料的記錄。 |

## 9. 業務規則

| 編號 | 業務規則 |
| --- | --- |
| BR-001 | 系統只服務單一公司；Warehouse Code全公司唯一，Bin Code只需在所屬Warehouse內唯一。 |
| BR-002 | 5個倉庫是目標營運規模而非硬性資料庫上限；超出規模前須重新評估。 |
| BR-003 | 每個On Hand Bucket必須引用正式Warehouse、Bin及SKU ID；不得以Code或Name作永久關聯。 |
| BR-004 | 同一SKU／Lot可分散於多個Bin，同一Bin可存放不同SKU／Lot。 |
| BR-005 | 所有數量使用SKU Base UOM正整數；本期不支援小數庫存。 |
| BR-006 | Pack UOM只可按Item Management當下有效的正整數換算轉成Base UOM。 |
| BR-007 | On Hand、Bucket Quantity及ATP在任何提交或並發結果下均不可為負。 |
| BR-008 | Inventory Balance只可由Movement／Reservation更新，不提供直接修改結餘功能。 |
| BR-009 | Warehouse／Bin／SKU／Lot／Status是不同業務維度，不得以拼接自由文字代替正式關聯。 |
| BR-010 | Tracking Policy為none／batch／batch_expiry時分別套用相應Lot及Expiry必填規則。 |
| BR-011 | Serial Number本期不受支援；遇到serial policy須明確拒絕。 |
| BR-012 | 同一SKU／Lot的Expiry及Manufacture Date必須一致，不因存於不同Warehouse／Bin而改變。 |
| BR-013 | Expiry Date代表最後可使用日期；按APP_TIME_ZONE計算，只有系統日期晚於Expiry Date時才視為Expired，且全渠道須一致。 |
| BR-014 | Expired、Quarantined及Damaged不計入正常銷售ATP。 |
| BR-015 | Low-life Lot是否可用由交易用途及SKU Minimum Sale／Receipt Life決定，不應直接改成Damaged。 |
| BR-016 | Reservation按SKU／Warehouse保存；Allocation才指定Lot／Bin。 |
| BR-017 | Reservation採全有或全無，不自動部分成功。 |
| BR-018 | Outstanding Reservation總量不可超過指定用途的合資格庫存。 |
| BR-019 | Allocation不扣On Hand；Issue才扣On Hand並耗用Reservation。 |
| BR-020 | 有效期商品預設FEFO；所選非FEFO Lot仍須合資格，並要求專門權限及原因。 |
| BR-021 | Stock Status只有Available、Quarantined及Damaged；Expired由日期派生，不可手工切換。 |
| BR-022 | Status Transfer保持Warehouse、Bin、SKU、Lot不變，並以成對Movement保持Total On Hand不變。 |
| BR-023 | Bin Move保持Warehouse、SKU、Lot、Status不變，只改來源與目的Bin。 |
| BR-024 | Cross-Warehouse Transfer須經In Transit，不允許直接由一個Warehouse的Bin改成另一個Warehouse的Bin。 |
| BR-025 | Draft Transfer不影響庫存；Dispatch及Receive分別為不可任意修改的過帳點。 |
| BR-026 | 本期Transfer不支援部分Dispatch或部分Receive，避免短少及剩餘狀態歧義。 |
| BR-027 | In Transit不屬任何Bin，不能預留、分配或正常出庫。 |
| BR-028 | 已預留庫存不得因調整、調撥或狀態轉換而失去足夠合資格On Hand。 |
| BR-029 | Adjustment不得代替正常Receipt、Issue、Return或Transfer。 |
| BR-030 | Adjustment、Reversal、Status Transfer及Stocktake Variance需要`inventory.adjust`及原因，但不需要另一人審批。 |
| BR-031 | 已過帳Movement只能以關聯Reversal更正，不能修改或刪除原記錄。 |
| BR-032 | Stocktake按Bin鎖定；Counting期間所有會改變目標Bin On Hand的操作均須拒絕。 |
| BR-033 | 同一Bin同時最多有一個未完成Stocktake，避免重複鎖定及重複差異。 |
| BR-034 | Stocktake Posting採整次全有或全無，不允許只過帳部分差異。 |
| BR-035 | Opening Balance只可在正式Go-Live前使用，正式啟用後永久關閉。 |
| BR-036 | 所有建立、過帳、耗用、釋放、Dispatch、Receive及Posting命令須可安全重送。 |
| BR-037 | 同一冪等識別搭配不同內容須拒絕並留下可調查衝突，不得猜測採用新舊哪一份。 |
| BR-038 | 所有狀態、數量、位置、權限及SKU資格須在提交時重驗，不依賴過時畫面。 |
| BR-039 | Warehouse／Bin停用不得破壞歷史；仍有結餘或未完成流程時必須阻擋。 |
| BR-040 | SKU停用不改寫既有On Hand，但禁止不符合Item政策的新交易；Discontinued Sellable SKU仍可按Item及庫存規則清貨。 |
| BR-041 | SKU Code、名稱、Lot資料及位置後續修改不得回寫已完成交易及Movement的歷史顯示快照。 |
| BR-042 | Inventory不計算成本、估值、毛利或會計分錄，也不接收這些值作為可改結餘依據。 |
| BR-043 | UI、CSV及整合介面須使用相同的數量、Tracking、Expiry、權限、版本及冪等規則。 |
| BR-044 | 所有時間以ERP統一時間政策交換及保存，日期顯示遵守APP_TIME_ZONE。 |
| BR-045 | 任何下游模組不得繞過Inventory Movement直接改寫Stock Balance。 |

## 10. 使用者體驗要求

### 10.1 導航與頁面

本模組至少提供以下頁面；實際路由及元件由技術設計決定：

- Inventory Stock：按SKU／Warehouse／Bin／Lot／Status查詢結餘及到期資料。
- Warehouses：管理Warehouse及其Bins。
- Stock Movements：查詢每次庫存變化及來源。
- Reservations：查看Active／Partially Consumed Reservation及Allocation。
- Transfers：建立、Dispatch、Receive及查詢跨倉調撥。
- Adjustments：由有權限人員新增調整、狀態轉換或Reversal。
- Stocktakes：建立、點算、檢視差異、過帳或取消盤點。
- Opening Balance：只在Go-Live前顯示的預檢及確認入口。
- Expiry View：查看已過期及指定期間內到期的Lot。

所有頁面須遵守`docs/frontend-design.md`的共用PageHeader、DataTable、FormPanel、狀態文字、表單錯誤、確認對話框、響應式及無障礙規則。

### 10.2 日常操作效率

- SKU輸入支援掃描Barcode或搜尋SKU Code／Name；掃描結果必須唯一，找不到或多結果時不得靜默選擇。
- Warehouse選定後，只顯示所屬Active Bins；不可輸入其他Warehouse的Bin ID繞過畫面限制。
- Batch／Expiry欄位按SKU Tracking Policy即時顯示必填狀態及規則。
- 數量欄清楚顯示Base UOM；如輸入Pack UOM，提交前顯示換算後Base UOM並要求確認。
- 高風險操作須在確認畫面顯示SKU、Lot、來源／目的位置、狀態、數量及操作後結果。
- 列表篩選及分頁可由URL還原，但URL不得包含密碼、token或其他認證資料。
- 使用者提交後須立即看到成功、失敗或版本衝突，不能只靠列表數量悄悄變化。
- 網路逾時後須允許用Source／Request ID查明操作是否已完成，再決定是否重試。

### 10.3 FEFO、效期及狀態提示

- Allocation畫面預設把最早到期且合資格的Lot排在最前，顯示Expiry Date、剩餘天數、Bin及可分配量。
- Expired、低於Minimum Sale Life、Quarantined及Damaged使用清晰文字說明不可用原因。
- FEFO例外操作須顯示系統建議Lot與使用者選擇Lot的差異，只有具權限者可輸入原因後確認。
- 到期Lot可查詢及匯出，但本期不以Popup、Email或SMS建立複雜通知中心。

### 10.4 Stocktake及Transfer體驗

- Counting頁面清楚標示已鎖定的Warehouse／Bins、開始時間、完成比例及未點算行。
- 掃描或搜尋SKU後，畫面須列出該Bin適用的Lot／Status，避免輸入至錯誤Bucket。
- Transfer須分開顯示來源與目的Warehouse；Dispatch後不可繼續顯示成可編輯Draft。
- Receive時須逐行選擇目的Bin；不可沿用來源Bin ID或假設兩個Warehouse具有同一Bin。
- 所有差異、鎖定及阻擋訊息須提供下一步，例如釋放Reservation、取消Stocktake或選擇其他Lot。

### 10.5 可用性與無障礙

- 主要操作須可使用鍵盤完成，焦點順序、錯誤摘要、標籤及按鈕名稱可被輔助技術理解。
- 狀態及風險不可只以顏色表達；須同時有文字或icon label。
- 桌面及一般平板寬度下，核心查詢、調撥收貨及盤點錄入不得因橫向溢出而無法操作。
- 長SKU／Lot／Bin文字應安全截斷並可查看完整內容，不得破壞表格。
- Loading、empty、forbidden、conflict、dependency unavailable及retry狀態須清楚區分。

## 11. 權限、安全與職責分離

| 編號 | 需求 |
| --- | --- |
| SEC-001 | 未登入使用者不可存取任何Inventory頁面或端點。 |
| SEC-002 | `inventory.view`只允許查看Warehouse、Bin、結餘、Lot、Movement、Reservation、Transfer及Stocktake結果。 |
| SEC-003 | `inventory.operation`允許正常Receipt／Issue、Allocation、Bin Move、Transfer收發及Stocktake錄入，但不允許調整或主資料維護。 |
| SEC-004 | `inventory.mgmt`允許Warehouse／Bin維護、Opening Balance及管理查詢，不自動包含Adjustment或FEFO例外。 |
| SEC-005 | `inventory.adjust`允許Adjustment、Status Transfer、Reversal及Stocktake Variance Posting；每次須重新認證或使用等效高風險控制並填原因。 |
| SEC-006 | `inventory.fefo.override`只允許偏離FEFO，不允許選擇Expired、效期不足、Quarantined、Damaged或數量不足的Lot。 |
| SEC-007 | 下游角色只能在其已授權業務流程呼叫用途所需Inventory能力，不因此取得Inventory管理頁面或其他操作權限。 |
| SEC-008 | 後端須防止水平及垂直越權；替換Warehouse、Bin、SKU、Lot、Reservation、Transfer、Movement或Stocktake ID不得跨越所有權及權限。 |
| SEC-009 | 所有數量、日期、代碼、CSV、搜尋及自由文字須驗證；查詢防SQL注入，輸出防腳本及CSV公式執行。 |
| SEC-010 | 高風險驗證須綁定actor、device、action及有效時間，不可被另一操作或使用者重放。 |
| SEC-011 | 系統Log、Audit及錯誤不得包含密碼、token、完整CSV、SQL、stack或未經過濾的請求payload。 |
| SEC-012 | 批量匯出、Opening Balance、Adjustment、Reversal、Status Transfer、Stocktake Posting及FEFO例外須記錄操作者、條件、時間及結果。 |
| SEC-013 | 使用者停用或權限撤銷後，高風險提交及長流程下一個過帳點須重新驗證，不依賴過時token claim。 |
| SEC-014 | Inventory不保存Customer銀行、Supplier銀行、付款資料或其他與庫存數量無關的敏感資料。 |

## 12. 整合需求

### 12.1 共通整合原則

- 所有下游關聯使用不可重用的內部ID；Code／Barcode只用於搜尋及交換顯示。
- 每個寫入命令須有穩定Source Reference、Event／Idempotency ID及預期版本或等效並發控制。
- 同一來源事件的業務效果只能發生一次；timeout後可查詢結果，不要求呼叫方猜測。
- Inventory須在提交時重驗SKU、Warehouse、Bin、Lot、Expiry、Status、Quantity、Reservation及權限。
- 下游完成交易時保存自己需要的SKU、Lot、Expiry、位置或數量快照；主資料日後修改不回寫歷史。
- 大量查詢須使用批量contract，不允許報表或交易逐SKU呼叫造成N+1。
- 任何下游失效不得令Inventory改用未授權資料、跳過檢查或直接修改結餘。

### 12.2 Item Management整合

- Inventory只接受`inventoryTracked=true`且符合該用途狀態／日期規則的SKU。
- Inventory讀取SKU Base UOM、UOM Conversion、Tracking Policy、Shelf Life、Minimum Receipt Life及Minimum Sale Life。
- Item／SKU停用不刪除或移動既有庫存，但新Receipt／Reservation／Issue是否允許須依Item正式用途規則重驗。
- Discontinued且Sellable的SKU可清售合資格現貨，不可新採購；Inventory不得只看到Discontinued便刪除庫存。
- Item Management本期現有`serial`政策與本需求衝突；在Inventory實作前須更新Item requirement／design，或以功能開關／資料驗證確保不會出現Active Serial SKU。
- SKU已有Inventory Movement後，Item Management不得直接改變Base UOM或Tracking Policy。

### 12.3 Purchasing／Receiving整合

- Purchasing只建立採購意圖；Receiving確認實際SKU、數量、Lot、Expiry及目的Bin後才呼叫Inventory Receipt。
- Inventory不保存採購價或計算成本，只保存必要來源ID及數量／批次快照。
- Remaining Receipt Life不足但尚未過期時，Receiving須提供`receiving.expiry.override`、逐筆原因、操作者、SKU／Lot／Expiry、適用門檻、實際剩餘日數、Receipt／GR及request／operation證據；Inventory重新驗證後才可過帳。已過期Lot永遠不可Override。
- Receipt重送不得重複入庫；Purchase Order或Receipt修改不得回寫已過帳Movement。
- 採購退回由相應流程建立正式Issue來源，不可直接刪除Receipt或改Balance。

### 12.4 Sales／Fulfillment整合

- Sales確認需要保留貨量時按SKU／Warehouse建立Reservation，不在訂單階段強制指定Lot／Bin。
- Sales取消或減少數量時發送相應Release事件；Inventory不自行推測訂單狀態。
- Fulfillment揀貨時從Inventory取得合資格Lot／Bin及FEFO順序，並建立Allocation。
- 發貨確認時Issue須重新驗證Allocation、Lot、Bin、Expiry、Status及Reservation，然後原子扣減On Hand及耗用Reservation。
- Sales／Fulfillment不得自行維護或覆寫Inventory ATP；畫面載入後發生庫存變化時，以提交結果為準。

### 12.5 Returns整合

- Returns流程判定實際退回SKU、數量、Lot、Expiry、目的Bin及Stock Status後才過帳Receipt。
- Customer Return一律預設進`QUARANTINED`；完成授權品質檢查後，才可透過Status Transfer轉為`AVAILABLE`或`DAMAGED`，Inventory不得把退貨直接當成可售庫存。
- Supplier Return使用正式Issue並保存來源；不得以負Adjustment代替。
- 退貨退款、供應商貸項及會計處理由相應模組負責。

### 12.6 Reporting、Audit及User整合

- 報表只讀取Inventory提供的正式摘要／批量查詢，不建立可回寫結餘。
- User Management提供actor狀態、權限及高風險重新認證；提交點須能判定撤權及停用。
- Audit須可透過request／correlation／source ID串聯下游單據與Inventory效果。
- 如報表需要歷史指定時點庫存，須由Movement重建或由技術設計提供一致snapshot；不可使用目前Balance冒充歷史值。

## 13. 非功能需求

### 13.1 效能與容量

| 編號 | 需求 |
| --- | --- |
| NFR-001 | 在最多20名同時在線Inventory使用者及正常混合負載下，SKU／Barcode精確查找及常用庫存列表p95應少於2秒。 |
| NFR-002 | 所有可能大量增長的Stock、Lot、Movement、Reservation及Transfer列表須server-side分頁，單頁預設20、上限100。 |
| NFR-003 | 容量驗證建議以5個Warehouse、合計1,000個Bins、100,000個SKUs、500,000個非零Stock Buckets及2,000,000筆Movements作基線，而不是硬性業務限制。 |
| NFR-004 | 10,000列Opening Balance CSV的Precheck及過帳系統處理時間合計應在10分鐘內完成，不計使用者停留時間。 |
| NFR-005 | FEFO候選、ATP及指定SKU跨Warehouse／Bin／Lot查詢在容量基線下仍須符合2秒p95目標。 |

### 13.2 一致性與可靠性

| 編號 | 需求 |
| --- | --- |
| NFR-006 | Balance、Movement、Reservation、Allocation、Transfer、Stocktake及Audit須保持一致；不得有半個業務操作。 |
| NFR-007 | 並發預留、出庫、調撥、調整、狀態轉換及盤點不得以最後寫入者無聲覆蓋處理。 |
| NFR-008 | 所有外部寫入事件及高風險UI提交須冪等；重送不得產生重複數量效果。 |
| NFR-009 | 系統須能在回應遺失、worker重啟或暫時依賴故障後查明操作是否已完成並安全恢復。 |
| NFR-010 | Inventory資料須納入既有備份、還原及災難復原；還原後Balance、Movement及來源關聯須可對賬。 |

### 13.3 安全、保留及相容性

| 編號 | 需求 |
| --- | --- |
| NFR-011 | Inventory正常查詢不可因Supplier、Customer或非必要下游暫時不可用而失敗；寫入所需依賴不可用時須明確fail closed。 |
| NFR-012 | 已過帳Movement、Stocktake結果、Opening結果及相應Audit至少保留7年；刪除主資料不得破壞保留期內歷史。 |
| NFR-013 | 欄位、狀態、數量、錯誤代碼及時間語意須在Web UI、CSV及整合介面一致。 |
| NFR-014 | 日期、時間及數量須符合ERP統一語系及APP_TIME_ZONE；交換時間使用無歧義格式，Base UOM不得發生小數或浮點誤差。 |

## 14. 錯誤與例外處理

| 情境 | 系統行為 |
| --- | --- |
| SKU不存在、未追蹤庫存或不符合用途狀態 | 拒絕並指出SKU不可用，不建立任何庫存效果。 |
| Serial Tracking SKU | 回傳本期不支援的明確錯誤，不降級過帳。 |
| Warehouse／Bin不存在、Inactive或所有權不符 | 拒絕且不洩漏未授權位置資料。 |
| Lot／Expiry缺失或與既有Lot矛盾 | 拒絕並指出欄位及規則，不建立新Lot或Movement。 |
| 數量為0、負輸入、小數、超上限或UOM無法換算 | 拒絕並回傳field-level錯誤。 |
| 庫存不足或操作將令ATP／Bucket為負 | 完整拒絕，不自動部分處理。 |
| Reservation不足或版本過時 | 回409或等效衝突，要求重新載入最新數量。 |
| Allocation在提交前失效 | Issue拒絕並提示重新分配，不靜默改選其他Lot。 |
| Expired／Low-life／Quarantined／Damaged | 明確指出不可用原因；只有已定義例外才可繼續。 |
| 無FEFO例外權限或缺原因 | 拒絕且不保存例外Allocation。 |
| Counting Bin正在被操作 | 拒絕Movement並顯示Stocktake識別及處理方式。 |
| Transfer已Dispatch後再修改／取消 | 拒絕並顯示最新狀態；不得改寫已過帳歷史。 |
| 同一事件重送 | 回傳原結果或等效成功，不重複數量效果。 |
| 同一事件ID不同內容 | 回衝突並記錄調查資料，不選擇其中一份。 |
| DB／Audit在交易內失敗 | 整個業務操作回滾。 |
| 回應在Commit後遺失 | 呼叫方可用Request／Source ID查詢唯一結果後安全重試。 |
| CSV包含公式、未知欄、重複列或錯誤資料 | Precheck拒絕並提供row／field錯誤，不寫入庫存。 |
| 未授權或actor已停用 | 401／403或等效拒絕；業務資料零變更。 |

## 15. 驗收準則

### 15.1 Warehouse、Bin及查詢

| 編號 | 驗收準則 |
| --- | --- |
| AC-001 | Given兩個Warehouse，When建立相同Bin Code，Then兩者均可成功；When在同一Warehouse重複建立，Then被拒絕。 |
| AC-002 | GivenWarehouse或Bin仍有On Hand，When嘗試停用，Then系統拒絕並指出阻擋原因。 |
| AC-003 | GivenWarehouse／Bin已有Movement歷史且目前為0，When嘗試永久刪除，Then系統拒絕但允許停用。 |
| AC-004 | Given同一SKU／Lot分散於多個Bins，When查詢SKU，Then每個位置及總數準確，沒有假設單一位置。 |
| AC-005 | Given同一Bin有多個SKU／Lots，When查詢Bin，Then全部結餘按穩定分頁顯示且總數正確。 |
| AC-006 | Given使用者只有`inventory.view`，When查詢及匯出後再嘗試修改，Then查詢成功而所有寫入被拒絕且資料不變。 |

### 15.2 Lot、效期及庫存狀態

| 編號 | 驗收準則 |
| --- | --- |
| AC-007 | Givenbatch_expiry SKU，WhenReceipt缺Lot或Expiry，Then被拒絕且沒有Balance／Movement／Audit成功記錄。 |
| AC-008 | Given相同SKU／Lot已保存Expiry，When另一Warehouse以不同Expiry收貨，Then被拒絕。 |
| AC-009 | GivenExpiry Date等於今日，When按APP_TIME_ZONE查詢，Then仍按「最後可用日」處理；次日開始為Expired。 |
| AC-010 | GivenExpired Lot，When一般Sales建立Reservation、Allocation或Issue，Then全部被拒絕。 |
| AC-011 | GivenQuarantined或Damaged存貨，When查詢Total On Hand，Then數量包含於Total但不進入正常ATP。 |
| AC-012 | GivenSerial Policy SKU，When嘗試任何Inventory Receipt，Then系統明確拒絕而不以非批次庫存入帳。 |

### 15.3 Receipt、Issue及冪等

| 編號 | 驗收準則 |
| --- | --- |
| AC-013 | Given合法Receipt，When過帳，Then正確Bucket、Movement、來源及Audit在同一交易完成。 |
| AC-014 | Given相同Receipt事件被重送，When再次提交，Then回傳原結果且On Hand只增加一次。 |
| AC-015 | Given相同事件ID但數量不同，When提交，Then回衝突且兩個版本都不再新增效果。 |
| AC-016 | Given可注入Audit或DB失敗，WhenReceipt／Issue過帳，Then所有Balance、Movement、Reservation及Audit一併回滾。 |
| AC-017 | GivenIssue數量大於指定Allocation／Bucket，When提交，Then整筆拒絕且不部分扣貨。 |
| AC-018 | Given已過帳Issue有錯，When嘗試編輯或刪除，Then被拒絕；只有具權限Reversal可建立反向歷史。 |

### 15.4 Reservation、Allocation及FEFO

| 編號 | 驗收準則 |
| --- | --- |
| AC-019 | GivenATP為10，When兩個並發請求各預留7，Then最多一個成功且最終Reserved不超過10。 |
| AC-020 | GivenATP為5而請求6，When建立Reservation，Then整筆拒絕，不建立5的部分Reservation。 |
| AC-021 | GivenReservation為10，WhenIssue 6並Release 4，ThenConsumed、Released及Outstanding分別為6、4、0。 |
| AC-022 | GivenReservation尚未Allocation，When在同Warehouse的Bins間移動合資格存貨，Then可移動且Reserved保持不變。 |
| AC-023 | Given三個合資格Lots到期日不同，When一般使用者Allocation，Then最早到期Lot先被建議及選用。 |
| AC-024 | Given一般使用者選擇較晚到期Lot，When提交，Then被拒絕。 |
| AC-025 | Given具FEFO例外權限使用者選擇較晚但合資格Lot並填原因，When提交，Then成功且Audit保存建議與實際選擇。 |
| AC-026 | Given具FEFO例外權限仍選Expired或效期不足Lot，When提交，Then被拒絕；例外權限不能繞過資格。 |
| AC-027 | GivenAllocation後Lot過期或轉Quarantined，WhenIssue提交，Then重新驗證失敗並要求重新分配。 |

### 15.5 Bin Move與Transfer

| 編號 | 驗收準則 |
| --- | --- |
| AC-028 | Given來源Bin有同一Lot 10件，When移動4件到同Warehouse另一Bin，Then來源6、目的4、總On Hand不變且Movement成對。 |
| AC-029 | Given來源及目的Bin屬不同Warehouse，When使用Bin Move，Then被拒絕並提示使用Transfer。 |
| AC-030 | GivenDraft Transfer，When建立或取消，ThenOn Hand及In Transit均不變。 |
| AC-031 | Given合法Transfer，WhenDispatch，Then來源Bin扣減、In Transit增加且目的Bin仍為0。 |
| AC-032 | GivenIn Transit Transfer，WhenReceive至目的Active Bin，ThenIn Transit清零、目的Bin增加且來源歷史不變。 |
| AC-033 | GivenDispatch或Receive事件重送，When再次提交，Then來源、In Transit及目的數量均不重複變化。 |
| AC-034 | GivenTransfer只有部分貨到，When嘗試部分Receive，Then本期明確拒絕並提示按完整收貨後的差異流程處理。 |

### 15.6 Adjustment、Status及Stocktake

| 編號 | 驗收準則 |
| --- | --- |
| AC-035 | Given沒有`inventory.adjust`，When提交Adjustment、Reversal或Status Transfer，Then被拒絕且零資料變化。 |
| AC-036 | Given有5件而負Adjustment 6件，When提交，Then被拒絕且不出現負Bucket。 |
| AC-037 | GivenAvailable 10件，When轉4件至Quarantined，ThenAvailable為6、Quarantined為4、Total On Hand仍為10。 |
| AC-038 | GivenAvailable數量已被完整Reserved，When嘗試轉至Damaged，Then被拒絕並提示先處理Reservation。 |
| AC-039 | Given兩名使用者並發調整相同Bucket，When使用同一舊版本提交，Then只有一個成功，另一個收到衝突。 |
| AC-040 | GivenStocktake進入Counting，When對目標Bin執行Receipt、Issue、Move或Adjustment，Then全部被拒絕。 |
| AC-041 | GivenStocktake包含多個差異，When其中一行Posting失敗，Then全部差異不生效且Bin繼續鎖定。 |
| AC-042 | GivenStocktake成功Posting，When查詢結果，Then每行帳面、實數、差異、Movement及Audit完整且Bin已解鎖。 |
| AC-043 | GivenCounting Stocktake被取消，When再次操作Bin，Then沒有差異Movement且Bin可正常使用。 |

### 15.7 Opening、權限及整合

| 編號 | 驗收準則 |
| --- | --- |
| AC-044 | GivenOpening CSV有一列錯誤，WhenPrecheck，Then整份不可確認且所有庫存表零業務寫入。 |
| AC-045 | Given合法Opening CSV，When具權限使用者重新認證並確認，Then所有Opening Movements一次成功且可對賬。 |
| AC-046 | GivenInventory Go-Live已完成，When再嘗試Opening Balance，Then入口不可用且API拒絕。 |
| AC-047 | Given下游只持Sales／Fulfillment權限，When使用正式Reservation／Allocation流程，Then可取得最小必要能力但不可進Inventory管理功能。 |
| AC-048 | Given使用者權限在畫面載入後被撤銷，When提交Adjustment或FEFO例外，Then後端重新驗證並拒絕。 |
| AC-049 | Given100,000 SKUs及容量基線，When進行精確查找、常用庫存查詢及FEFO候選，Thenp95符合2秒目標且結果正確。 |
| AC-050 | Given完整備份，When在隔離環境還原，ThenBalance、Movement、Reservation、Transfer、Stocktake及Audit數量與來源均可對賬。 |

## 16. 資料建置與上線要求

### 16.1 初始資料

- 業務須提供Warehouse Code／Name、Bin Code及其所屬Warehouse清單。
- 所有將導入的SKU須先在Item Management建立並確認Base UOM、Tracking Policy及效期規則。
- Opening Balance須按實際Warehouse／Bin／SKU／Lot／Status整理，不能只提供SKU總數後由系統虛構位置。
- 初始Reservation及In Transit原則上不經Opening Balance導入；如切換時確有未完成交易，須另做具來源對賬的遷移方案。
- Opening數量只接受Base UOM非負整數；0數量列不建立Movement。

### 16.2 上線控制

- 先在隔離環境完成Opening Precheck、全量導入、結餘匯出及實物／舊系統對賬。
- Go-Live時間須明確；舊系統在切換點後停止產生新庫存異動，避免雙邊寫入。
- 正式確認Opening後關閉Opening功能，保留結果及檔案雜湊，後續差異走Adjustment／Stocktake。
- 上線前完成至少一個Warehouse的Receipt、Reservation、FEFO Allocation、Issue、Bin Move、Transfer及Stocktake端到端演練。
- 確認所有Active Inventory SKU都不是`serial` policy；有衝突時不得上線。
- 備份及還原演練須證明不只Balance可還原，Movement、Reservation及來源也一致。

## 17. 優先級與建議交付階段

### Phase 1：Inventory基礎

- Warehouse／Bin主資料及權限。
- Lot／Expiry及Stock Balance。
- 不可修改Movement ledger。
- Receipt／Issue posting、冪等及禁止負庫存。
- 基本庫存及Movement查詢。

### Phase 2：訂單及倉務運作

- Reservation、Release、Allocation及FEFO。
- Bin Move及跨倉Transfer。
- Stock Status及受控Adjustment／Reversal。
- Stocktake及差異Posting。

### Phase 3：上線與完整整合

- Opening Balance CSV及Go-Live lock。
- Expiry、Reservation、Transfer及Stocktake報表／匯出。
- Purchasing／Receiving、Sales／Fulfillment及Returns完整contract。
- 容量、並發、故障復原、備份還原及上線驗收。

每個Phase只表示交付順序；任何會寫入正式庫存的能力都必須先具備Movement、Audit、冪等及負庫存保護，不允許以暫時直接改Balance的方式提早上線。

## 18. 決策紀錄與待確認事項

### 18.1 決策紀錄及來源

`DEC-001～012`及`DEC-020`來自原需求訪談的明確確認；`DEC-013`沿用已核准的Item Management數量政策；`DEC-014～019`原為保持簡單與資料一致而提出的BA基線，已由Product Owner（Sam）於2026-09-14逐項批准。`DEC-021～026`來自同日的逐題解釋與人工確認。Sam其後以獨立人工評審人身分批准目前設計及P0～P5計畫基線，但明確暫不授權進入`IMPLEMENT`。

| 編號 | 決策 | 需求影響 |
| --- | --- | --- |
| DEC-001 | 對象為管理5個以內倉庫的中小企業。 | 流程及UI以簡單實用為主，不建立大型WMS能力。 |
| DEC-002 | 必須準確記錄SKU／Lot所在Bin。 | 所有On Hand必須有Warehouse及Bin。 |
| DEC-003 | 同一SKU／Lot可分散多Bin，同一Bin可混放多SKU／Lot。 | 使用多對多Stock Bucket，不設固定庫位限制。 |
| DEC-004 | Sales確認後需要預留庫存。 | 區分On Hand、Reserved及ATP。 |
| DEC-005 | Reservation按SKU／Warehouse，揀貨才選Lot／Bin。 | 預留與Allocation分開。 |
| DEC-006 | 有效期商品預設FEFO。 | Allocation依最早合資格Expiry排序。 |
| DEC-007 | 可以授權偏離FEFO並填原因，不需另一人審批。 | 建立`inventory.fefo.override`及完整Audit。 |
| DEC-008 | 只設Available、Quarantined及Damaged三種人工Stock Status。 | Expired由日期派生，不建立可手工修改狀態。 |
| DEC-009 | 嚴格禁止負庫存。 | 所有寫入及並發提交重驗Bucket及ATP。 |
| DEC-010 | 差異透過受權限控制、有原因的Adjustment處理。 | 不提供直接修改Balance。 |
| DEC-011 | 本期不做庫存成本及會計。 | 不計算平均成本、FIFO成本、估值、COGS或分錄。 |
| DEC-012 | 本期不做Serial Number。 | Serial SKU明確拒絕，並要求修訂Item規格或停用該policy。 |
| DEC-013 | 所有數量以Base UOM整數管理。 | 不支援小數庫存或重量拆零。 |
| DEC-014 | 同Warehouse使用原子Bin Move。 | 不經In Transit。 |
| DEC-015 | 跨Warehouse必須Dispatch及Receive。 | 中途數量保存為In Transit。 |
| DEC-016 | 本期Transfer不支援部分Dispatch／Receive。 | 以全張過帳降低流程與對賬複雜度。 |
| DEC-017 | 盤點按Bin鎖定。 | Counting期間阻擋目標Bin異動，Posting全有或全無。 |
| DEC-018 | Opening Balance只在Go-Live前使用。 | 上線後永久關閉並改用Adjustment／Stocktake。 |
| DEC-019 | 本期沒有Inventory雙人審批。 | 依權限、重新認證、原因及Audit控制高風險操作。 |
| DEC-020 | Inventory不自行建立上下游業務單據。 | 只接受正式來源並保存Source Reference。 |
| DEC-021 | 本期不實作Serial Tracking；所有Serial SKU過帳fail closed，存在Active inventory-tracked Serial SKU時禁止Go-Live。 | 不把Serial SKU降級為一般數量庫存；未來支援Serial須另行變更需求及設計。 |
| DEC-022 | Receiving低效期例外統一使用`receiving.expiry.override`；只適用於尚未過期的Lot，須有逐筆原因及完整Audit evidence。 | 同時要求一般收貨權限與專門Override權限；淘汰文件中的`receiving.override_shelf_life`別名。 |
| DEC-023 | Customer Return一律預設進`QUARANTINED`。 | 品質檢查後才可透過Status Transfer轉為`AVAILABLE`或`DAMAGED`。 |
| DEC-024 | Adjustment reason固定為`COUNT_GAIN, COUNT_LOSS, DAMAGE, EXPIRY, DATA_CORRECTION, TRANSFER_VARIANCE, OTHER`。 | `OTHER`必須附更詳細說明；分類不取代`inventory.adjust`、強認證及Audit。 |
| DEC-025 | Warehouse／Operations Lead負責舊系統對賬，Sam負責最終Go-Live簽核；切換採明確Data Freeze，凍結後舊系統不得再寫庫存。 | P5填寫實際凍結時間、Opening資料並完成對賬後，才可執行不可逆Go-Live。 |
| DEC-026 | Production application DB account與migration account分離，Go-Live前必須完成backup／restore rehearsal。 | App帳號維持最小日常DML權限，不得執行schema migration；migration帳號只在受控部署使用。 |

### 18.2 已確認實作與上線約束

- 本期不實作Serial Tracking；Inventory對Serial SKU過帳fail closed，Go-Live檢查須證明沒有Active inventory-tracked Serial SKU。
- 確認Expiry Date代表「最後可使用日期」，以APP_TIME_ZONE當日結束後才成為Expired；所有UI、CSV及API須一致。
- P5準備首批Warehouse／Bin代碼、Opening CSV及所需舊系統對照；不因此建立通用自訂欄位平台。
- P5填寫實際Data Freeze／Go-Live時間；Warehouse／Operations Lead負責舊系統對賬，Sam負責最終Go-Live簽核。
- Adjustment reason allowlist固定為`COUNT_GAIN, COUNT_LOSS, DAMAGE, EXPIRY, DATA_CORRECTION, TRANSFER_VARIANCE, OTHER`；`OTHER`必須有詳細說明。
- Customer Return預設`QUARANTINED`；Receiving低效期例外固定使用`receiving.expiry.override`及DEC-022的證據格式。
- Production application DB account與migration account分離，並在Go-Live前完成backup／restore rehearsal。
- 由技術設計確認容量基線的索引、查詢、鎖定、冪等保存及備份還原方案，不改變本文件語意。

## 19. 需求追溯摘要及簽核

### 19.1 需求追溯摘要

| 需求範圍 | 正式ID | 驗收覆蓋 |
| --- | --- | --- |
| 業務目標與指標 | OBJ-01～08、KPI-01～09 | AC-001～050及上線量測 |
| Warehouse／Bin | FR-MASTER-001～010、BR-001～004、BR-039 | AC-001～006 |
| Stock／Lot／Expiry | FR-STOCK-001～010、FR-LOT-001～010、BR-005～015 | AC-004～012、AC-049 |
| Receipt／Issue | FR-POST-001～012、BR-036～038、BR-040～045 | AC-013～018 |
| Reservation／Allocation／FEFO | FR-RES-001～010、FR-ALLOC-001～010、BR-016～020、BR-028 | AC-019～027 |
| Bin Move／Transfer | FR-MOVE-001～007、FR-TRANSFER-001～012、BR-023～027 | AC-028～034 |
| Adjustment／Status | FR-ADJUST-001～010、BR-021～022、BR-029～031 | AC-035～039 |
| Stocktake | FR-COUNT-001～012、BR-032～034 | AC-040～043 |
| Opening／Reporting／Audit | FR-OPEN-001～007、FR-REPORT-001～008、FR-AUDIT-001～007、BR-035 | AC-044～050 |
| Security與非功能 | SEC-001～014、NFR-001～014 | AC-006、AC-016、AC-019、AC-035、AC-039、AC-041、AC-047～050 |
| 決策紀錄 | DEC-001～020 | 各對應FR、BR及AC |

### 19.2 簽核建議

本需求書須由以下角色確認後才進入系統設計：

- Product Owner：確認本期只做核心Inventory，不擴展至採購、銷售、成本或大型WMS。
- 倉務負責人：確認Warehouse／Bin、Lot／Expiry、FEFO、Transfer及Stocktake流程可實際操作。
- 銷售／Fulfillment負責人：確認Reservation、Allocation、Issue及Minimum Sale Life語意。
- 採購／Receiving負責人：確認Receipt、Lot／Expiry及Minimum Receipt Life例外界線。
- Finance：確認本期不做成本核算、估值、COGS及會計分錄。
- Security／System Admin：確認五項Inventory權限、高風險重新認證及Audit要求。
- Technical Lead／QA：確認並發、冪等、禁止負庫存、可復原及驗收準則可實作與測試。

本文件簽核後，如要加入Serial Number、成本核算、部分Transfer收發、負庫存、自動補貨、Bin容量、波次揀貨、移動設備、寄售、多公司或雙人審批，均視為範圍變更，須先更新需求、影響分析及驗收準則。

<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Canonical Requirement Definitions

The legacy domain IDs and complete narrative above remain the semantic source. The aliases below provide stable module-local identities for typed traceability; they do not indicate approval or implementation.

## Canonical functional-requirement alias crosswalk

| Canonical ID | Legacy ID | Priority |
| --- | --- | --- |
| FR-001 | FR-MASTER-001 | Must |
| FR-002 | FR-MASTER-002 | Must |
| FR-003 | FR-MASTER-003 | Must |
| FR-004 | FR-MASTER-004 | Must |
| FR-005 | FR-MASTER-005 | Must |
| FR-006 | FR-MASTER-006 | Must |
| FR-007 | FR-MASTER-007 | Must |
| FR-008 | FR-MASTER-008 | Must |
| FR-009 | FR-MASTER-009 | Must |
| FR-010 | FR-MASTER-010 | Should |
| FR-011 | FR-STOCK-001 | Must |
| FR-012 | FR-STOCK-002 | Must |
| FR-013 | FR-STOCK-003 | Must |
| FR-014 | FR-STOCK-004 | Must |
| FR-015 | FR-STOCK-005 | Must |
| FR-016 | FR-STOCK-006 | Must |
| FR-017 | FR-STOCK-007 | Must |
| FR-018 | FR-STOCK-008 | Must |
| FR-019 | FR-STOCK-009 | Must |
| FR-020 | FR-STOCK-010 | Should |
| FR-021 | FR-LOT-001 | Must |
| FR-022 | FR-LOT-002 | Must |
| FR-023 | FR-LOT-003 | Must |
| FR-024 | FR-LOT-004 | Must |
| FR-025 | FR-LOT-005 | Must |
| FR-026 | FR-LOT-006 | Must |
| FR-027 | FR-LOT-007 | Must |
| FR-028 | FR-LOT-008 | Must |
| FR-029 | FR-LOT-009 | Must |
| FR-030 | FR-LOT-010 | Should |
| FR-031 | FR-POST-001 | Must |
| FR-032 | FR-POST-002 | Must |
| FR-033 | FR-POST-003 | Must |
| FR-034 | FR-POST-004 | Must |
| FR-035 | FR-POST-005 | Must |
| FR-036 | FR-POST-006 | Must |
| FR-037 | FR-POST-007 | Must |
| FR-038 | FR-POST-008 | Must |
| FR-039 | FR-POST-009 | Must |
| FR-040 | FR-POST-010 | Must |
| FR-041 | FR-POST-011 | Must |
| FR-042 | FR-POST-012 | Should |
| FR-043 | FR-RES-001 | Must |
| FR-044 | FR-RES-002 | Must |
| FR-045 | FR-RES-003 | Must |
| FR-046 | FR-RES-004 | Must |
| FR-047 | FR-RES-005 | Must |
| FR-048 | FR-RES-006 | Must |
| FR-049 | FR-RES-007 | Must |
| FR-050 | FR-RES-008 | Must |
| FR-051 | FR-RES-009 | Must |
| FR-052 | FR-RES-010 | Must |
| FR-053 | FR-ALLOC-001 | Must |
| FR-054 | FR-ALLOC-002 | Must |
| FR-055 | FR-ALLOC-003 | Must |
| FR-056 | FR-ALLOC-004 | Must |
| FR-057 | FR-ALLOC-005 | Must |
| FR-058 | FR-ALLOC-006 | Must |
| FR-059 | FR-ALLOC-007 | Must |
| FR-060 | FR-ALLOC-008 | Must |
| FR-061 | FR-ALLOC-009 | Must |
| FR-062 | FR-ALLOC-010 | Must |
| FR-063 | FR-MOVE-001 | Must |
| FR-064 | FR-MOVE-002 | Must |
| FR-065 | FR-MOVE-003 | Must |
| FR-066 | FR-MOVE-004 | Must |
| FR-067 | FR-MOVE-005 | Must |
| FR-068 | FR-MOVE-006 | Must |
| FR-069 | FR-MOVE-007 | Must |
| FR-070 | FR-TRANSFER-001 | Must |
| FR-071 | FR-TRANSFER-002 | Must |
| FR-072 | FR-TRANSFER-003 | Must |
| FR-073 | FR-TRANSFER-004 | Must |
| FR-074 | FR-TRANSFER-005 | Must |
| FR-075 | FR-TRANSFER-006 | Must |
| FR-076 | FR-TRANSFER-007 | Must |
| FR-077 | FR-TRANSFER-008 | Must |
| FR-078 | FR-TRANSFER-009 | Must |
| FR-079 | FR-TRANSFER-010 | Must |
| FR-080 | FR-TRANSFER-011 | Must |
| FR-081 | FR-TRANSFER-012 | Must |
| FR-082 | FR-ADJUST-001 | Must |
| FR-083 | FR-ADJUST-002 | Must |
| FR-084 | FR-ADJUST-003 | Must |
| FR-085 | FR-ADJUST-004 | Must |
| FR-086 | FR-ADJUST-005 | Must |
| FR-087 | FR-ADJUST-006 | Must |
| FR-088 | FR-ADJUST-007 | Must |
| FR-089 | FR-ADJUST-008 | Must |
| FR-090 | FR-ADJUST-009 | Must |
| FR-091 | FR-ADJUST-010 | Should |
| FR-092 | FR-COUNT-001 | Must |
| FR-093 | FR-COUNT-002 | Must |
| FR-094 | FR-COUNT-003 | Must |
| FR-095 | FR-COUNT-004 | Must |
| FR-096 | FR-COUNT-005 | Must |
| FR-097 | FR-COUNT-006 | Must |
| FR-098 | FR-COUNT-007 | Must |
| FR-099 | FR-COUNT-008 | Must |
| FR-100 | FR-COUNT-009 | Must |
| FR-101 | FR-COUNT-010 | Must |
| FR-102 | FR-COUNT-011 | Must |
| FR-103 | FR-COUNT-012 | Should |
| FR-104 | FR-OPEN-001 | Must |
| FR-105 | FR-OPEN-002 | Must |
| FR-106 | FR-OPEN-003 | Must |
| FR-107 | FR-OPEN-004 | Must |
| FR-108 | FR-OPEN-005 | Must |
| FR-109 | FR-OPEN-006 | Must |
| FR-110 | FR-OPEN-007 | Must |
| FR-111 | FR-REPORT-001 | Must |
| FR-112 | FR-REPORT-002 | Must |
| FR-113 | FR-REPORT-003 | Must |
| FR-114 | FR-REPORT-004 | Must |
| FR-115 | FR-REPORT-005 | Must |
| FR-116 | FR-REPORT-006 | Must |
| FR-117 | FR-REPORT-007 | Must |
| FR-118 | FR-REPORT-008 | Should |
| FR-119 | FR-AUDIT-001 | Must |
| FR-120 | FR-AUDIT-002 | Must |
| FR-121 | FR-AUDIT-003 | Must |
| FR-122 | FR-AUDIT-004 | Must |
| FR-123 | FR-AUDIT-005 | Must |
| FR-124 | FR-AUDIT-006 | Must |
| FR-125 | FR-AUDIT-007 | Must |

## Formal definitions

## FR-001 — 系統須提供Warehouse列表、詳情、新增、修改、停用及恢復功能

### Statement
系統須提供Warehouse列表、詳情、新增、修改、停用及恢復功能。 (Legacy identity: `FR-MASTER-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-002 — Warehouse Code在全公司經trim及不分英文字母大小寫後唯一；Archived／Inactive歷史亦繼續占用

### Statement
Warehouse Code在全公司經trim及不分英文字母大小寫後唯一；Archived／Inactive歷史亦繼續占用。 (Legacy identity: `FR-MASTER-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-003 — 系統須提供每個Warehouse下的Bin列表、新增、修改、停用及恢復功能

### Statement
系統須提供每個Warehouse下的Bin列表、新增、修改、停用及恢復功能。 (Legacy identity: `FR-MASTER-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-004 — Bin Code在所屬Warehouse內經trim及不分英文字母大小寫後唯一；不同Warehouse可使用相同Bin Code

### Statement
Bin Code在所屬Warehouse內經trim及不分英文字母大小寫後唯一；不同Warehouse可使用相同Bin Code。 (Legacy identity: `FR-MASTER-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-005 — 每個On Hand結餘必須指定一個屬於同一Warehouse的Active Bin

### Statement
每個On Hand結餘必須指定一個屬於同一Warehouse的Active Bin。 (Legacy identity: `FR-MASTER-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-006 — Warehouse停用前須確認其所有Bin沒有On Hand，且沒有有效Reservation／Allocation、未完成Transfer或…

### Statement
Warehouse停用前須確認其所有Bin沒有On Hand，且沒有有效Reservation／Allocation、未完成Transfer或Active Stocktake。 (Legacy identity: `FR-MASTER-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-007 — Bin停用前須確認其沒有On Hand、有效Allocation、未完成Transfer或Active Stocktake

### Statement
Bin停用前須確認其沒有On Hand、有效Allocation、未完成Transfer或Active Stocktake。 (Legacy identity: `FR-MASTER-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-008 — 已有Movement或其他歷史引用的Warehouse／Bin不得永久刪除；從未使用且無子資料者才可刪除

### Statement
已有Movement或其他歷史引用的Warehouse／Bin不得永久刪除；從未使用且無子資料者才可刪除。 (Legacy identity: `FR-MASTER-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-009 — Warehouse／Bin更新須帶資料版本，版本不一致時拒絕無聲覆蓋

### Statement
Warehouse／Bin更新須帶資料版本，版本不一致時拒絕無聲覆蓋。 (Legacy identity: `FR-MASTER-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-010 — 列表可按Code、Name、Status搜尋及篩選，預設只顯示Active資料

### Statement
列表可按Code、Name、Status搜尋及篩選，預設只顯示Active資料。 (Legacy identity: `FR-MASTER-010`; priority: `Should`.)

### Acceptance criteria
The observable outcome stated by `FR-MASTER-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-011 — 使用者須可按SKU Code、Barcode、SKU Name、Warehouse、Bin、Lot、Expiry Date及Stock Sta…

### Statement
使用者須可按SKU Code、Barcode、SKU Name、Warehouse、Bin、Lot、Expiry Date及Stock Status查詢庫存。 (Legacy identity: `FR-STOCK-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-012 — 庫存摘要須清楚顯示Total On Hand、Available On Hand、Reserved、ATP、Quarantined、Damag…

### Statement
庫存摘要須清楚顯示Total On Hand、Available On Hand、Reserved、ATP、Quarantined、Damaged及In Transit，不得以一個「庫存量」混合不同語意。 (Legacy identity: `FR-STOCK-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-013 — 使用者須可由SKU展開至Warehouse、Bin、Lot及Stock Status明細，也可由Warehouse／Bin查看其內所有SKU／…

### Statement
使用者須可由SKU展開至Warehouse、Bin、Lot及Stock Status明細，也可由Warehouse／Bin查看其內所有SKU／Lot。 (Legacy identity: `FR-STOCK-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-014 — 所有數量以SKU Base UOM顯示及保存；如同時顯示Pack UOM換算，須標明只是換算展示且不得產生小數Base UOM

### Statement
所有數量以SKU Base UOM顯示及保存；如同時顯示Pack UOM換算，須標明只是換算展示且不得產生小數Base UOM。 (Legacy identity: `FR-STOCK-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-015 — 查詢須即時反映已過帳Movement及有效Reservation，不得依靠需要人手重整的快取才能得到正確數量

### Statement
查詢須即時反映已過帳Movement及有效Reservation，不得依靠需要人手重整的快取才能得到正確數量。 (Legacy identity: `FR-STOCK-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-016 — Expired、Quarantined及Damaged須有文字狀態及數量，不可只靠顏色區分

### Statement
Expired、Quarantined及Damaged須有文字狀態及數量，不可只靠顏色區分。 (Legacy identity: `FR-STOCK-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-017 — 使用者須可查看特定結餘Bucket的最近Movement及來源，並由Movement返回相關SKU／Lot／Bin

### Statement
使用者須可查看特定結餘Bucket的最近Movement及來源，並由Movement返回相關SKU／Lot／Bin。 (Legacy identity: `FR-STOCK-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-018 — 列表採server-side分頁、穩定排序及明確篩選；不得一次載入全部Movement或Stock Bucket

### Statement
列表採server-side分頁、穩定排序及明確篩選；不得一次載入全部Movement或Stock Bucket。 (Legacy identity: `FR-STOCK-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-019 — 庫存查詢權限只允許查看，不得透過查詢、匯出或URL參數造成任何數量變化

### Statement
庫存查詢權限只允許查看，不得透過查詢、匯出或URL參數造成任何數量變化。 (Legacy identity: `FR-STOCK-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-020 — 系統可提供無庫存、零ATP、即將到期及已過期的篩選結果；本期不自動產生補貨建議

### Statement
系統可提供無庫存、零ATP、即將到期及已過期的篩選結果；本期不自動產生補貨建議。 (Legacy identity: `FR-STOCK-010`; priority: `Should`.)

### Acceptance criteria
The observable outcome stated by `FR-STOCK-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-021 — Inventory須在每次入庫及異動時讀取SKU當下有效的Tracking Policy，不得由使用者自由選擇是否提供Lot

### Statement
Inventory須在每次入庫及異動時讀取SKU當下有效的Tracking Policy，不得由使用者自由選擇是否提供Lot。 (Legacy identity: `FR-LOT-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-022 — Tracking Policy為none時，不要求Lot Number或Expiry Date，並以非批次庫存處理

### Statement
Tracking Policy為`none`時，不要求Lot Number或Expiry Date，並以非批次庫存處理。 (Legacy identity: `FR-LOT-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-023 — Tracking Policy為batch時，Lot Number必填，Expiry Date選填

### Statement
Tracking Policy為`batch`時，Lot Number必填，Expiry Date選填。 (Legacy identity: `FR-LOT-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-024 — Tracking Policy為batchexpiry時，Lot Number及Expiry Date均必填

### Statement
Tracking Policy為`batch_expiry`時，Lot Number及Expiry Date均必填。 (Legacy identity: `FR-LOT-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-025 — 同一SKU的Lot Number經trim後唯一；相同SKU／Lot的Expiry Date及Manufacture Date不得互相矛盾

### Statement
同一SKU的Lot Number經trim後唯一；相同SKU／Lot的Expiry Date及Manufacture Date不得互相矛盾。 (Legacy identity: `FR-LOT-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-026 — Expiry Date早於當日的Lot自當日開始不可預留、分配或正常出庫；判定使用系統統一時區

### Statement
Expiry Date早於當日的Lot自當日開始不可預留、分配或正常出庫；判定使用系統統一時區。 (Legacy identity: `FR-LOT-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-027 — 如SKU有Minimum Receipt Life，收貨不足效期時須由Receiving模組提供有效專門權限及原因，Inventory才可過帳

### Statement
如SKU有Minimum Receipt Life，收貨不足效期但尚未過期時須由Receiving模組提供`receiving.expiry.override`、逐筆原因及門檻證據，Inventory才可過帳；已過期Lot永遠不可Override。 (Legacy identity: `FR-LOT-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-028 — 如SKU有Minimum Sale Life，低於門檻的Lot不得被正常銷售分配或出庫

### Statement
如SKU有Minimum Sale Life，低於門檻的Lot不得被正常銷售分配或出庫。 (Legacy identity: `FR-LOT-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-029 — serial Tracking Policy在本期須被明確拒絕並回傳可理解錯誤，不得降級為none或batch

### Statement
`serial` Tracking Policy在本期須被明確拒絕並回傳可理解錯誤，不得降級為`none`或`batch`。 (Legacy identity: `FR-LOT-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-030 — 使用者可按指定天數區間查看即將到期Lot，但本期不提供自動電郵或短訊提醒

### Statement
使用者可按指定天數區間查看即將到期Lot，但本期不提供自動電郵或短訊提醒。 (Legacy identity: `FR-LOT-010`; priority: `Should`.)

### Acceptance criteria
The observable outcome stated by `FR-LOT-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-031 — Inventory須接受已授權下游流程的Receipt／Issue過帳，並要求正式Source Reference；Inventory畫面不得…

### Statement
Inventory須接受已授權下游流程的Receipt／Issue過帳，並要求正式Source Reference；Inventory畫面不得自行建立採購、銷售或發貨單據。 (Legacy identity: `FR-POST-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-032 — 每個過帳請求須提供SKU、Base UOM數量或可驗證的Pack UOM換算、Warehouse、Bin、Lot／Expiry（如適用）及來源…

### Statement
每個過帳請求須提供SKU、Base UOM數量或可驗證的Pack UOM換算、Warehouse、Bin、Lot／Expiry（如適用）及來源事件ID。 (Legacy identity: `FR-POST-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-033 — Receipt成功時在同一交易增加正確Stock Bucket並建立Movement及Audit；任何一步失敗須全部回滾

### Statement
Receipt成功時在同一交易增加正確Stock Bucket並建立Movement及Audit；任何一步失敗須全部回滾。 (Legacy identity: `FR-POST-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-034 — Issue成功時在同一交易扣減指定Allocation／Lot／Bin、耗用Reservation並建立Movement及Audit；任何一步…

### Statement
Issue成功時在同一交易扣減指定Allocation／Lot／Bin、耗用Reservation並建立Movement及Audit；任何一步失敗須全部回滾。 (Legacy identity: `FR-POST-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-035 — Receipt只能進入來源指定的Available、Quarantined或Damaged狀態；Returns等模組不得讓Inventory猜…

### Statement
Receipt只能進入來源指定的Available、Quarantined或Damaged狀態；Customer Return固定預設`QUARANTINED`，品質檢查後才可轉為`AVAILABLE`或`DAMAGED`。 (Legacy identity: `FR-POST-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-036 — Issue只可使用未過期、狀態為Available且符合來源用途效期規則的庫存

### Statement
Issue只可使用未過期、狀態為Available且符合來源用途效期規則的庫存。 (Legacy identity: `FR-POST-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-037 — Source Module＋Source Document＋Source Line＋Event ID須形成冪等識別；相同事件重送不得重複過帳

### Statement
Source Module＋Source Document＋Source Line＋Event ID須形成冪等識別；相同事件重送不得重複過帳。 (Legacy identity: `FR-POST-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-038 — 同一冪等識別搭配不同SKU、數量、位置或Lot資料時須拒絕並標示衝突，不得沿用舊結果或再次寫入

### Statement
同一冪等識別搭配不同SKU、數量、位置或Lot資料時須拒絕並標示衝突，不得沿用舊結果或再次寫入。 (Legacy identity: `FR-POST-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-039 — Item／SKU、Warehouse、Bin、Lot、Stock Status及權限須在提交時重新驗證，不得只依畫面載入時的狀態

### Statement
Item／SKU、Warehouse、Bin、Lot、Stock Status及權限須在提交時重新驗證，不得只依畫面載入時的狀態。 (Legacy identity: `FR-POST-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-040 — 出庫、移動或調撥不足時完整拒絕，不得自動把可用多少就扣多少

### Statement
出庫、移動或調撥不足時完整拒絕，不得自動把可用多少就扣多少。 (Legacy identity: `FR-POST-010`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-041 — 已過帳Receipt／Issue不可編輯或刪除；錯誤須透過授權Reversal及正確的新過帳處理

### Statement
已過帳Receipt／Issue不可編輯或刪除；錯誤須透過授權Reversal及正確的新過帳處理。 (Legacy identity: `FR-POST-011`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-011` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-042 — 使用者可由Inventory Movement連結回來源單據；來源模組未安裝時仍須保存穩定來源文字及ID

### Statement
使用者可由Inventory Movement連結回來源單據；來源模組未安裝時仍須保存穩定來源文字及ID。 (Legacy identity: `FR-POST-012`; priority: `Should`.)

### Acceptance criteria
The observable outcome stated by `FR-POST-012` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-043 — 已授權來源可按SKU／Warehouse建立Reservation；建立時不強制指定Lot或Bin

### Statement
已授權來源可按SKU／Warehouse建立Reservation；建立時不強制指定Lot或Bin。 (Legacy identity: `FR-RES-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-044 — Reservation請求數量須全部可由當下ATP滿足才成功；不足時整筆拒絕，不自動部分預留

### Statement
Reservation請求數量須全部可由當下ATP滿足才成功；不足時整筆拒絕，不自動部分預留。 (Legacy identity: `FR-RES-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-045 — 相同來源行及事件重送不得建立重複Reservation；不同內容使用相同事件ID須回衝突

### Statement
相同來源行及事件重送不得建立重複Reservation；不同內容使用相同事件ID須回衝突。 (Legacy identity: `FR-RES-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-046 — Reservation須支援部分耗用及部分釋放，且任何時候 original = consumed + released + outstand…

### Statement
Reservation須支援部分耗用及部分釋放，且任何時候 `original = consumed + released + outstanding`。 (Legacy identity: `FR-RES-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-047 — Reservation取消或來源單據取消時須釋放所有未耗用數量；已耗用部分不得復活

### Statement
Reservation取消或來源單據取消時須釋放所有未耗用數量；已耗用部分不得復活。 (Legacy identity: `FR-RES-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-048 — Inventory不得在沒有正式來源事件時自行猜測或自動刪除Reservation

### Statement
Inventory不得在沒有正式來源事件時自行猜測或自動刪除Reservation。 (Legacy identity: `FR-RES-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-049 — 建立、耗用、釋放及取消Reservation均須保存來源、時間、操作者／系統身份及稽核

### Statement
建立、耗用、釋放及取消Reservation均須保存來源、時間、操作者／系統身份及稽核。 (Legacy identity: `FR-RES-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-050 — Quarantined、Damaged、Expired或不符合用途最低效期的庫存不得計入該用途ATP

### Statement
Quarantined、Damaged、Expired或不符合用途最低效期的庫存不得計入該用途ATP。 (Legacy identity: `FR-RES-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-051 — 所有並發Reservation須以一致性控制保證總Reserved不超過合資格Available On Hand

### Statement
所有並發Reservation須以一致性控制保證總Reserved不超過合資格Available On Hand。 (Legacy identity: `FR-RES-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-052 — Reservation須有版本或等效並發控制，過時的釋放／耗用請求不得覆蓋較新狀態

### Statement
Reservation須有版本或等效並發控制，過時的釋放／耗用請求不得覆蓋較新狀態。 (Legacy identity: `FR-RES-010`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-RES-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-053 — 揀貨時可把一個Reservation分配至一個或多個合資格Lot／Bin，總Allocation不得超過未耗用Reservation

### Statement
揀貨時可把一個Reservation分配至一個或多個合資格Lot／Bin，總Allocation不得超過未耗用Reservation。 (Legacy identity: `FR-ALLOC-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-054 — 有Expiry Date的SKU預設依最早Expiry Date、再依Lot及Bin穩定排序建議Allocation

### Statement
有Expiry Date的SKU預設依最早Expiry Date、再依Lot及Bin穩定排序建議Allocation。 (Legacy identity: `FR-ALLOC-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-055 — 無Expiry Date但有Lot的SKU可按First Receipt Date提供最舊批次優先建議，但不作成本計算

### Statement
無Expiry Date但有Lot的SKU可按First Receipt Date提供最舊批次優先建議，但不作成本計算。 (Legacy identity: `FR-ALLOC-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-056 — 一般使用者偏離FEFO時須被阻擋；持有inventory.fefo.override者只有在所選Lot仍合資格且填寫原因後才可繼續

### Statement
一般使用者偏離FEFO時須被阻擋；持有`inventory.fefo.override`者只有在所選Lot仍合資格且填寫原因後才可繼續。 (Legacy identity: `FR-ALLOC-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-057 — Expired、效期不足、Quarantined、Damaged、Inactive Bin或不屬該Warehouse的庫存均不可Allocat…

### Statement
Expired、效期不足、Quarantined、Damaged、Inactive Bin或不屬該Warehouse的庫存均不可Allocation。 (Legacy identity: `FR-ALLOC-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-058 — Allocation不扣減On Hand；只有Issue過帳才扣減實貨並耗用Reservation

### Statement
Allocation不扣減On Hand；只有Issue過帳才扣減實貨並耗用Reservation。 (Legacy identity: `FR-ALLOC-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-059 — Allocation可在Issue前釋放或重新分配；操作須重新驗證Lot／Bin餘量及Reservation版本

### Statement
Allocation可在Issue前釋放或重新分配；操作須重新驗證Lot／Bin餘量及Reservation版本。 (Legacy identity: `FR-ALLOC-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-060 — 同一Lot在多個Bin時可分配多個明細；不得假設Lot只存在一個位置

### Statement
同一Lot在多個Bin時可分配多個明細；不得假設Lot只存在一個位置。 (Legacy identity: `FR-ALLOC-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-061 — 分配後如Lot過期、Bin停用或庫存狀態改變，Issue提交時須拒絕並要求重新分配

### Statement
分配後如Lot過期、Bin停用或庫存狀態改變，Issue提交時須拒絕並要求重新分配。 (Legacy identity: `FR-ALLOC-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-062 — FEFO例外須稽核應選Lot、實選Lot、Expiry Date、數量、操作者、原因及來源單據

### Statement
FEFO例外須稽核應選Lot、實選Lot、Expiry Date、數量、操作者、原因及來源單據。 (Legacy identity: `FR-ALLOC-010`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ALLOC-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-063 — 使用者可把指定SKU／Lot／Stock Status數量從同一Warehouse的一個Bin原子移至另一個Active Bin

### Statement
使用者可把指定SKU／Lot／Stock Status數量從同一Warehouse的一個Bin原子移至另一個Active Bin。 (Legacy identity: `FR-MOVE-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MOVE-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-064 — 來源及目的Bin不可相同，且必須屬於同一Warehouse；跨Warehouse必須使用Transfer

### Statement
來源及目的Bin不可相同，且必須屬於同一Warehouse；跨Warehouse必須使用Transfer。 (Legacy identity: `FR-MOVE-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MOVE-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-065 — Bin Move須同時產生來源Out及目的In Movement，兩者以同一操作ID關聯，任一失敗全部回滾

### Statement
Bin Move須同時產生來源Out及目的In Movement，兩者以同一操作ID關聯，任一失敗全部回滾。 (Legacy identity: `FR-MOVE-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MOVE-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-066 — 移動不得改變SKU、Lot、Expiry Date或Stock Status；狀態改變使用Status Transfer

### Statement
移動不得改變SKU、Lot、Expiry Date或Stock Status；狀態改變使用Status Transfer。 (Legacy identity: `FR-MOVE-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MOVE-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-067 — 如移動將使來源Warehouse合資格庫存低於有效Reserved，操作須拒絕

### Statement
如移動將使來源Warehouse合資格庫存低於有效Reserved，操作須拒絕。 (Legacy identity: `FR-MOVE-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MOVE-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-068 — Counting中的來源或目的Bin不可執行Bin Move

### Statement
Counting中的來源或目的Bin不可執行Bin Move。 (Legacy identity: `FR-MOVE-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MOVE-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-069 — Bin Move須要求正整數數量、版本、操作者及可選原因，並完整稽核

### Statement
Bin Move須要求正整數數量、版本、操作者及可選原因，並完整稽核。 (Legacy identity: `FR-MOVE-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-MOVE-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-070 — 使用者可建立不同Active Warehouses之間的Draft Transfer，包含一個或多個SKU／Lot來源Bin及數量

### Statement
使用者可建立不同Active Warehouses之間的Draft Transfer，包含一個或多個SKU／Lot來源Bin及數量。 (Legacy identity: `FR-TRANSFER-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-071 — Draft Transfer不改變On Hand、Reserved或In Transit，可在Dispatch前修改或取消

### Statement
Draft Transfer不改變On Hand、Reserved或In Transit，可在Dispatch前修改或取消。 (Legacy identity: `FR-TRANSFER-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-072 — Dispatch須重新驗證來源Bin、SKU／Lot／Status、數量、Reservation保障及Stocktake鎖

### Statement
Dispatch須重新驗證來源Bin、SKU／Lot／Status、數量、Reservation保障及Stocktake鎖。 (Legacy identity: `FR-TRANSFER-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-073 — Dispatch成功時原子扣減來源Bin並增加相同數量In Transit；任一行失敗則整張不過帳

### Statement
Dispatch成功時原子扣減來源Bin並增加相同數量In Transit；任一行失敗則整張不過帳。 (Legacy identity: `FR-TRANSFER-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-074 — 本期不支援部分Dispatch；使用者須在提交前修改Draft至實際可發數量

### Statement
本期不支援部分Dispatch；使用者須在提交前修改Draft至實際可發數量。 (Legacy identity: `FR-TRANSFER-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-075 — In Transit不可預留、分配、出庫、修改或取消

### Statement
In Transit不可預留、分配、出庫、修改或取消。 (Legacy identity: `FR-TRANSFER-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-076 — Receive須為每行指定屬於目的Warehouse的Active Bin，並保存原SKU／Lot／Expiry Date

### Statement
Receive須為每行指定屬於目的Warehouse的Active Bin，並保存原SKU／Lot／Expiry Date。 (Legacy identity: `FR-TRANSFER-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-077 — Receive成功時原子清除整張Transfer的In Transit並增加目的Bin結餘；本期不支援部分Receive

### Statement
Receive成功時原子清除整張Transfer的In Transit並增加目的Bin結餘；本期不支援部分Receive。 (Legacy identity: `FR-TRANSFER-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-078 — 調撥收貨預設保持Dispatch時的Stock Status；如運輸結果需隔離，使用者可選擇Receive至Quarantined並記原因

### Statement
調撥收貨預設保持Dispatch時的Stock Status；如運輸結果需隔離，使用者可選擇Receive至Quarantined並記原因。 (Legacy identity: `FR-TRANSFER-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-079 — Transfer短少、損壞或錯誤不以修改Dispatch歷史處理；須完成收貨後使用關聯Adjustment／Status Transfer更正

### Statement
Transfer短少、損壞或錯誤不以修改Dispatch歷史處理；須完成收貨後使用關聯Adjustment／Status Transfer更正。 (Legacy identity: `FR-TRANSFER-010`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-080 — Dispatch及Receive須各自冪等，重送不得重複扣減來源、增加In Transit或增加目的地

### Statement
Dispatch及Receive須各自冪等，重送不得重複扣減來源、增加In Transit或增加目的地。 (Legacy identity: `FR-TRANSFER-011`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-011` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-081 — Transfer須清楚顯示Draft、In Transit、Received或Cancelled及各階段操作者與時間

### Statement
Transfer須清楚顯示Draft、In Transit、Received或Cancelled及各階段操作者與時間。 (Legacy identity: `FR-TRANSFER-012`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-TRANSFER-012` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-082 — 只有inventory.adjust可過帳Adjustment、Status Transfer、Stocktake Variance及Reve…

### Statement
只有`inventory.adjust`可過帳Adjustment、Status Transfer、Stocktake Variance及Reversal。 (Legacy identity: `FR-ADJUST-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-083 — Adjustment須指定Warehouse、Bin、SKU、Lot／Expiry（如適用）、Stock Status、正數或負數方向、正整數…

### Statement
Adjustment須指定Warehouse、Bin、SKU、Lot／Expiry（如適用）、Stock Status、正數或負數方向、正整數數量及原因。 (Legacy identity: `FR-ADJUST-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-084 — 負Adjustment須重新驗證實際Bucket數量、有效Reserved及並發版本，結果不得為負

### Statement
負Adjustment須重新驗證實際Bucket數量、有效Reserved及並發版本，結果不得為負。 (Legacy identity: `FR-ADJUST-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-085 — 正Adjustment須遵守SKU Tracking Policy、Lot一致性、Bin狀態及效期規則，不得成為繞過正常Receipt的默認做法

### Statement
正Adjustment須遵守SKU Tracking Policy、Lot一致性、Bin狀態及效期規則，不得成為繞過正常Receipt的默認做法。 (Legacy identity: `FR-ADJUST-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-086 — Available、Quarantined及Damaged之間的狀態轉換須原子扣減來源Bucket並增加目的Bucket，總On Hand不變

### Statement
Available、Quarantined及Damaged之間的狀態轉換須原子扣減來源Bucket並增加目的Bucket，總On Hand不變。 (Legacy identity: `FR-ADJUST-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-087 — 把Available轉為Quarantined／Damaged時，如剩餘合資格數量不足以覆蓋Reserved，須先由來源流程釋放或重新安排Re…

### Statement
把Available轉為Quarantined／Damaged時，如剩餘合資格數量不足以覆蓋Reserved，須先由來源流程釋放或重新安排Reservation。 (Legacy identity: `FR-ADJUST-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-088 — 將Quarantined／Damaged恢復為Available須由inventory.adjust填寫原因；Expired Lot即使轉為A…

### Statement
將Quarantined／Damaged恢復為Available須由`inventory.adjust`填寫原因；Expired Lot即使轉為Available仍不可正常銷售。 (Legacy identity: `FR-ADJUST-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-089 — 已過帳Movement不可修改或刪除；Reversal須關聯原Movement、使用相反效果並再次通過所有當下規則

### Statement
已過帳Movement不可修改或刪除；Reversal須關聯原Movement、使用相反效果並再次通過所有當下規則。 (Legacy identity: `FR-ADJUST-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-090 — 同一Adjustment／Reversal重送須冪等；同一事件ID不同內容須拒絕

### Statement
同一Adjustment／Reversal重送須冪等；同一事件ID不同內容須拒絕。 (Legacy identity: `FR-ADJUST-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-091 — 系統可要求使用者從簡單Reason Category選擇差異原因並補充文字，但不建立多層審批或複雜工作流

### Statement
系統可要求使用者從簡單Reason Category選擇差異原因並補充文字，但不建立多層審批或複雜工作流。 (Legacy identity: `FR-ADJUST-010`; priority: `Should`.)

### Acceptance criteria
The observable outcome stated by `FR-ADJUST-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-092 — 使用者可建立指定Warehouse及一個或多個Bin的Draft Stocktake；同一Bin同時最多屬於一個未完成Stocktake

### Statement
使用者可建立指定Warehouse及一個或多個Bin的Draft Stocktake；同一Bin同時最多屬於一個未完成Stocktake。 (Legacy identity: `FR-COUNT-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-093 — 開始Counting時須保存目標Bin所有SKU／Lot／Status的帳面快照並鎖定Bin庫存異動

### Statement
開始Counting時須保存目標Bin所有SKU／Lot／Status的帳面快照並鎖定Bin庫存異動。 (Legacy identity: `FR-COUNT-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-094 — Counting期間Receipt、Issue、Bin Move、Transfer、Adjustment及其他會改變目標Bin On Hand…

### Statement
Counting期間Receipt、Issue、Bin Move、Transfer、Adjustment及其他會改變目標Bin On Hand的操作須被拒絕。 (Legacy identity: `FR-COUNT-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-095 — 使用者可逐行輸入非負整數實際數量、保存進度並看到尚未點算項目

### Statement
使用者可逐行輸入非負整數實際數量、保存進度並看到尚未點算項目。 (Legacy identity: `FR-COUNT-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-096 — 使用者可加入現場發現但帳面數量為0的SKU／Lot／Status，仍須通過SKU、Lot及Bin規則

### Statement
使用者可加入現場發現但帳面數量為0的SKU／Lot／Status，仍須通過SKU、Lot及Bin規則。 (Legacy identity: `FR-COUNT-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-097 — 相同Bin／SKU／Lot／Status在一個Stocktake內只能有一個有效盤點結果

### Statement
相同Bin／SKU／Lot／Status在一個Stocktake內只能有一個有效盤點結果。 (Legacy identity: `FR-COUNT-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-098 — Ready to Post須要求所有盤點行完成或被明確標記為未發現；之後一般操作員不可再修改實數

### Statement
Ready to Post須要求所有盤點行完成或被明確標記為未發現；之後一般操作員不可再修改實數。 (Legacy identity: `FR-COUNT-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-099 — Posting須由inventory.adjust一次性過帳全部差異；任一行失敗則全部差異不生效且Bin保持鎖定

### Statement
Posting須由`inventory.adjust`一次性過帳全部差異；任一行失敗則全部差異不生效且Bin保持鎖定。 (Legacy identity: `FR-COUNT-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-100 — Posted Stocktake的帳面值、實際值、差異及Movement關聯不可修改或刪除

### Statement
Posted Stocktake的帳面值、實際值、差異及Movement關聯不可修改或刪除。 (Legacy identity: `FR-COUNT-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-101 — Cancelled Stocktake不得產生數量變化，並須可靠解除其所有Bin鎖

### Statement
Cancelled Stocktake不得產生數量變化，並須可靠解除其所有Bin鎖。 (Legacy identity: `FR-COUNT-010`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-102 — Counting／Posting重送及兩人同時操作須以版本與冪等控制避免重複差異

### Statement
Counting／Posting重送及兩人同時操作須以版本與冪等控制避免重複差異。 (Legacy identity: `FR-COUNT-011`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-011` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-103 — 系統提供簡單盤點差異摘要及CSV下載；本期不提供盲盤多輪或盤點隊伍分派

### Statement
系統提供簡單盤點差異摘要及CSV下載；本期不提供盲盤多輪或盤點隊伍分派。 (Legacy identity: `FR-COUNT-012`; priority: `Should`.)

### Acceptance criteria
The observable outcome stated by `FR-COUNT-012` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-104 — 上線前可下載Opening Balance CSV模板，欄位只包含Warehouse、Bin、SKU、Lot／Expiry、Stock Sta…

### Statement
上線前可下載Opening Balance CSV模板，欄位只包含Warehouse、Bin、SKU、Lot／Expiry、Stock Status及Base UOM數量。 (Legacy identity: `FR-OPEN-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-OPEN-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-105 — 導入須先Precheck，驗證Warehouse／Bin所有權、SKU政策、Lot一致性、正整數數量、重複列及資料版本，不可在Precheck…

### Statement
導入須先Precheck，驗證Warehouse／Bin所有權、SKU政策、Lot一致性、正整數數量、重複列及資料版本，不可在Precheck寫入庫存。 (Legacy identity: `FR-OPEN-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-OPEN-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-106 — 有任何錯誤時整份Opening Balance不可確認，並須回傳可定位至row及field的錯誤

### Statement
有任何錯誤時整份Opening Balance不可確認，並須回傳可定位至row及field的錯誤。 (Legacy identity: `FR-OPEN-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-OPEN-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-107 — 確認導入須使用高風險重新認證、inventory.mgmt、原因及冪等識別，並以單一受控作業過帳Opening Movements

### Statement
確認導入須使用高風險重新認證、`inventory.mgmt`、原因及冪等識別，並以單一受控作業過帳Opening Movements。 (Legacy identity: `FR-OPEN-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-OPEN-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-108 — 相同Warehouse／Bin／SKU／Lot／Status重複列須在Precheck阻擋，不得自動相加掩蓋輸入錯誤

### Statement
相同Warehouse／Bin／SKU／Lot／Status重複列須在Precheck阻擋，不得自動相加掩蓋輸入錯誤。 (Legacy identity: `FR-OPEN-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-OPEN-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-109 — Inventory Go-Live後Opening Balance功能須關閉；後續差異只可走Adjustment／Stocktake

### Statement
Inventory Go-Live後Opening Balance功能須關閉；後續差異只可走Adjustment／Stocktake。 (Legacy identity: `FR-OPEN-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-OPEN-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-110 — Opening Balance結果、錯誤、操作者、檔案雜湊、原因及Movement關聯須可稽核；不得在稽核保存整份CSV內容

### Statement
Opening Balance結果、錯誤、操作者、檔案雜湊、原因及Movement關聯須可稽核；不得在稽核保存整份CSV內容。 (Legacy identity: `FR-OPEN-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-OPEN-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-111 — 系統須提供查詢當下的現行庫存摘要，按Warehouse、Bin、SKU、Lot、Expiry及Status篩選及匯出

### Statement
系統須提供查詢當下的現行庫存摘要，按Warehouse、Bin、SKU、Lot、Expiry及Status篩選及匯出。 (Legacy identity: `FR-REPORT-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-112 — 系統須提供Movement歷史，按日期、類型、來源、SKU、Warehouse、Bin、Lot及操作者查詢

### Statement
系統須提供Movement歷史，按日期、類型、來源、SKU、Warehouse、Bin、Lot及操作者查詢。 (Legacy identity: `FR-REPORT-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-113 — 系統須提供Active Reservation及Allocation查詢，能定位來源單據及尚未耗用數量

### Statement
系統須提供Active Reservation及Allocation查詢，能定位來源單據及尚未耗用數量。 (Legacy identity: `FR-REPORT-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-114 — 系統須提供In Transit Transfer查詢及來源／目的Warehouse對賬

### Statement
系統須提供In Transit Transfer查詢及來源／目的Warehouse對賬。 (Legacy identity: `FR-REPORT-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-115 — 系統須提供Expired及指定天數內到期的Lot查詢，並分開顯示Available、Quarantined及Damaged數量

### Statement
系統須提供Expired及指定天數內到期的Lot查詢，並分開顯示Available、Quarantined及Damaged數量。 (Legacy identity: `FR-REPORT-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-116 — CSV匯出須沿用畫面篩選語意、穩定欄位、Base UOM及公司統一時間格式，並防止CSV公式注入

### Statement
CSV匯出須沿用畫面篩選語意、穩定欄位、Base UOM及公司統一時間格式，並防止CSV公式注入。 (Legacy identity: `FR-REPORT-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-117 — 報表及匯出不得包含成本、未授權資料、內部路徑、認證資訊或未定義的預測值

### Statement
報表及匯出不得包含成本、未授權資料、內部路徑、認證資訊或未定義的預測值。 (Legacy identity: `FR-REPORT-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-118 — 本期只提供營運清單及匯出，不建立自訂報表設計器、圖表Dashboard或排程派送

### Statement
本期只提供營運清單及匯出，不建立自訂報表設計器、圖表Dashboard或排程派送。 (Legacy identity: `FR-REPORT-008`; priority: `Should`.)

### Acceptance criteria
The observable outcome stated by `FR-REPORT-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-119 — Warehouse、Bin、Reservation、Allocation、Movement、Transfer、Adjustment、Stock…

### Statement
Warehouse、Bin、Reservation、Allocation、Movement、Transfer、Adjustment、Stocktake、Opening及FEFO例外均須有稽核。 (Legacy identity: `FR-AUDIT-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-AUDIT-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-120 — 稽核須保存actor、action、object、before／after摘要、reason、time、request／correlation…

### Statement
稽核須保存actor、action、object、before／after摘要、reason、time、request／correlation ID、source reference及outcome。 (Legacy identity: `FR-AUDIT-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-AUDIT-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-121 — 每個數量變化須可由Stock Bucket追至Movement、來源事件及稽核，也可由來源事件反查其庫存效果

### Statement
每個數量變化須可由Stock Bucket追至Movement、來源事件及稽核，也可由來源事件反查其庫存效果。 (Legacy identity: `FR-AUDIT-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-AUDIT-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-122 — 業務寫入與必要Audit須保持一致；Audit失敗時不得無聲完成庫存變化

### Statement
業務寫入與必要Audit須保持一致；Audit失敗時不得無聲完成庫存變化。 (Legacy identity: `FR-AUDIT-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-AUDIT-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-123 — Audit及應用Log不得保存密碼、token、完整上載檔案內容或未經過濾的CSV

### Statement
Audit及應用Log不得保存密碼、token、完整上載檔案內容或未經過濾的CSV。 (Legacy identity: `FR-AUDIT-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-AUDIT-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-124 — 已過帳Movement及Audit不得由一般應用使用者更新或刪除，且須按公司稽核政策至少保留7年

### Statement
已過帳Movement及Audit不得由一般應用使用者更新或刪除，且須按公司稽核政策至少保留7年。 (Legacy identity: `FR-AUDIT-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-AUDIT-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## FR-125 — 失敗、拒絕、版本衝突、冪等衝突及越權操作須留下足以調查但不洩漏敏感資料的記錄

### Statement
失敗、拒絕、版本衝突、冪等衝突及越權操作須留下足以調查但不洩漏敏感資料的記錄。 (Legacy identity: `FR-AUDIT-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `FR-AUDIT-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-001 — 未登入使用者不可存取任何Inventory頁面或端點

### Statement
未登入使用者不可存取任何Inventory頁面或端點。 (Legacy identity: `SEC-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-002 — inventory.view只允許查看Warehouse、Bin、結餘、Lot、Movement、Reservation、Transfer及S…

### Statement
`inventory.view`只允許查看Warehouse、Bin、結餘、Lot、Movement、Reservation、Transfer及Stocktake結果。 (Legacy identity: `SEC-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-003 — inventory.operation允許正常Receipt／Issue、Allocation、Bin Move、Transfer收發及Sto…

### Statement
`inventory.operation`允許正常Receipt／Issue、Allocation、Bin Move、Transfer收發及Stocktake錄入，但不允許調整或主資料維護。 (Legacy identity: `SEC-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-004 — inventory.mgmt允許Warehouse／Bin維護、Opening Balance及管理查詢，不自動包含Adjustment或FE…

### Statement
`inventory.mgmt`允許Warehouse／Bin維護、Opening Balance及管理查詢，不自動包含Adjustment或FEFO例外。 (Legacy identity: `SEC-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-005 — inventory.adjust允許Adjustment、Status Transfer、Reversal及Stocktake Varianc…

### Statement
`inventory.adjust`允許Adjustment、Status Transfer、Reversal及Stocktake Variance Posting；每次須重新認證或使用等效高風險控制並填原因。 (Legacy identity: `SEC-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-006 — inventory.fefo.override只允許偏離FEFO，不允許選擇Expired、效期不足、Quarantined、Damaged或…

### Statement
`inventory.fefo.override`只允許偏離FEFO，不允許選擇Expired、效期不足、Quarantined、Damaged或數量不足的Lot。 (Legacy identity: `SEC-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-007 — 下游角色只能在其已授權業務流程呼叫用途所需Inventory能力，不因此取得Inventory管理頁面或其他操作權限

### Statement
下游角色只能在其已授權業務流程呼叫用途所需Inventory能力，不因此取得Inventory管理頁面或其他操作權限。 (Legacy identity: `SEC-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-008 — 後端須防止水平及垂直越權；替換Warehouse、Bin、SKU、Lot、Reservation、Transfer、Movement或Stoc…

### Statement
後端須防止水平及垂直越權；替換Warehouse、Bin、SKU、Lot、Reservation、Transfer、Movement或Stocktake ID不得跨越所有權及權限。 (Legacy identity: `SEC-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-009 — 所有數量、日期、代碼、CSV、搜尋及自由文字須驗證；查詢防SQL注入，輸出防腳本及CSV公式執行

### Statement
所有數量、日期、代碼、CSV、搜尋及自由文字須驗證；查詢防SQL注入，輸出防腳本及CSV公式執行。 (Legacy identity: `SEC-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-010 — 高風險驗證須綁定actor、device、action及有效時間，不可被另一操作或使用者重放

### Statement
高風險驗證須綁定actor、device、action及有效時間，不可被另一操作或使用者重放。 (Legacy identity: `SEC-010`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-011 — 系統Log、Audit及錯誤不得包含密碼、token、完整CSV、SQL、stack或未經過濾的請求payload

### Statement
系統Log、Audit及錯誤不得包含密碼、token、完整CSV、SQL、stack或未經過濾的請求payload。 (Legacy identity: `SEC-011`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-011` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-012 — 批量匯出、Opening Balance、Adjustment、Reversal、Status Transfer、Stocktake Post…

### Statement
批量匯出、Opening Balance、Adjustment、Reversal、Status Transfer、Stocktake Posting及FEFO例外須記錄操作者、條件、時間及結果。 (Legacy identity: `SEC-012`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-012` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-013 — 使用者停用或權限撤銷後，高風險提交及長流程下一個過帳點須重新驗證，不依賴過時token claim

### Statement
使用者停用或權限撤銷後，高風險提交及長流程下一個過帳點須重新驗證，不依賴過時token claim。 (Legacy identity: `SEC-013`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-013` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## SEC-014 — Inventory不保存Customer銀行、Supplier銀行、付款資料或其他與庫存數量無關的敏感資料

### Statement
Inventory不保存Customer銀行、Supplier銀行、付款資料或其他與庫存數量無關的敏感資料。 (Legacy identity: `SEC-014`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `SEC-014` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-001 — 在最多20名同時在線Inventory使用者及正常混合負載下，SKU／Barcode精確查找及常用庫存列表p95應少於2秒

### Statement
在最多20名同時在線Inventory使用者及正常混合負載下，SKU／Barcode精確查找及常用庫存列表p95應少於2秒。 (Legacy identity: `NFR-001`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-001` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-002 — 所有可能大量增長的Stock、Lot、Movement、Reservation及Transfer列表須server-side分頁，單頁預設20…

### Statement
所有可能大量增長的Stock、Lot、Movement、Reservation及Transfer列表須server-side分頁，單頁預設20、上限100。 (Legacy identity: `NFR-002`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-002` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-003 — 容量驗證建議以5個Warehouse、合計1,000個Bins、100,000個SKUs、500,000個非零Stock Buckets及2,…

### Statement
容量驗證建議以5個Warehouse、合計1,000個Bins、100,000個SKUs、500,000個非零Stock Buckets及2,000,000筆Movements作基線，而不是硬性業務限制。 (Legacy identity: `NFR-003`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-003` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-004 — 10,000列Opening Balance CSV的Precheck及過帳系統處理時間合計應在10分鐘內完成，不計使用者停留時間

### Statement
10,000列Opening Balance CSV的Precheck及過帳系統處理時間合計應在10分鐘內完成，不計使用者停留時間。 (Legacy identity: `NFR-004`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-004` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-005 — FEFO候選、ATP及指定SKU跨Warehouse／Bin／Lot查詢在容量基線下仍須符合2秒p95目標

### Statement
FEFO候選、ATP及指定SKU跨Warehouse／Bin／Lot查詢在容量基線下仍須符合2秒p95目標。 (Legacy identity: `NFR-005`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-005` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-006 — Balance、Movement、Reservation、Allocation、Transfer、Stocktake及Audit須保持一致；不…

### Statement
Balance、Movement、Reservation、Allocation、Transfer、Stocktake及Audit須保持一致；不得有半個業務操作。 (Legacy identity: `NFR-006`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-006` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-007 — 並發預留、出庫、調撥、調整、狀態轉換及盤點不得以最後寫入者無聲覆蓋處理

### Statement
並發預留、出庫、調撥、調整、狀態轉換及盤點不得以最後寫入者無聲覆蓋處理。 (Legacy identity: `NFR-007`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-007` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-008 — 所有外部寫入事件及高風險UI提交須冪等；重送不得產生重複數量效果

### Statement
所有外部寫入事件及高風險UI提交須冪等；重送不得產生重複數量效果。 (Legacy identity: `NFR-008`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-008` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-009 — 系統須能在回應遺失、worker重啟或暫時依賴故障後查明操作是否已完成並安全恢復

### Statement
系統須能在回應遺失、worker重啟或暫時依賴故障後查明操作是否已完成並安全恢復。 (Legacy identity: `NFR-009`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-009` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-010 — Inventory資料須納入既有備份、還原及災難復原；還原後Balance、Movement及來源關聯須可對賬

### Statement
Inventory資料須納入既有備份、還原及災難復原；還原後Balance、Movement及來源關聯須可對賬。 (Legacy identity: `NFR-010`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-010` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-011 — Inventory正常查詢不可因Supplier、Customer或非必要下游暫時不可用而失敗；寫入所需依賴不可用時須明確fail closed

### Statement
Inventory正常查詢不可因Supplier、Customer或非必要下游暫時不可用而失敗；寫入所需依賴不可用時須明確fail closed。 (Legacy identity: `NFR-011`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-011` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-012 — 已過帳Movement、Stocktake結果、Opening結果及相應Audit至少保留7年；刪除主資料不得破壞保留期內歷史

### Statement
已過帳Movement、Stocktake結果、Opening結果及相應Audit至少保留7年；刪除主資料不得破壞保留期內歷史。 (Legacy identity: `NFR-012`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-012` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-013 — 欄位、狀態、數量、錯誤代碼及時間語意須在Web UI、CSV及整合介面一致

### Statement
欄位、狀態、數量、錯誤代碼及時間語意須在Web UI、CSV及整合介面一致。 (Legacy identity: `NFR-013`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-013` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

## NFR-014 — 日期、時間及數量須符合ERP統一語系及APPTIMEZONE；交換時間使用無歧義格式，Base UOM不得發生小數或浮點誤差

### Statement
日期、時間及數量須符合ERP統一語系及APP_TIME_ZONE；交換時間使用無歧義格式，Base UOM不得發生小數或浮點誤差。 (Legacy identity: `NFR-014`; priority: `Must`.)

### Acceptance criteria
The observable outcome stated by `NFR-014` is met and is verified by every mandatory mapped technical and UAT case on the approved baseline.

### Failure behavior
Invalid, unauthorized, stale, conflicting or incomplete input must not create a partial inventory effect; the caller receives a stable, actionable result and required audit evidence is retained.

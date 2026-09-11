# Item Management Requirement Specification (Harness Aligned)

## Harness alignment record

| Item | Value |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Alignment date | 2026-09-11 |
| Baseline | `main` / `origin/main` at `6cb50f50c1aa4db37e0f32ce41073df331d6c034` |
| Legacy source | `requirement.md`, SHA-256 `ecf0dc0b4a76ea53c5596e4e4940b69bb5c6dbbae981303ec0f2f9950b1c2041` |
| Provenance | Existing business baseline, enhanced with canonical aliases and approved DR objectives |
| Product-code change | None |

The complete pre-alignment requirement body is retained below. Its domain IDs remain authoritative for business meaning. Numeric `FR-*` aliases make the package mechanically traceable without silently rewriting established IDs.

## Canonical functional-requirement aliases

| Canonical | Legacy | Canonical | Legacy |
| --- | --- | --- | --- |
| FR-001 | FR-LIST-001 | FR-033 | FR-DELETE-002 |
| FR-002 | FR-LIST-002 | FR-034 | FR-DELETE-003 |
| FR-003 | FR-LIST-003 | FR-035 | FR-DELETE-004 |
| FR-004 | FR-LIST-004 | FR-036 | FR-DELETE-005 |
| FR-005 | FR-LIST-005 | FR-037 | FR-DELETE-006 |
| FR-006 | FR-LIST-006 | FR-038 | FR-DELETE-007 |
| FR-007 | FR-LIST-007 | FR-039 | FR-UOM-001 |
| FR-008 | FR-LIST-008 | FR-040 | FR-UOM-002 |
| FR-009 | FR-LIST-009 | FR-041 | FR-UOM-003 |
| FR-010 | FR-LIST-010 | FR-042 | FR-UOM-004 |
| FR-011 | FR-VIEW-001 | FR-043 | FR-UOM-005 |
| FR-012 | FR-VIEW-002 | FR-044 | FR-PRICE-001 |
| FR-013 | FR-VIEW-003 | FR-045 | FR-PRICE-002 |
| FR-014 | FR-VIEW-004 | FR-046 | FR-PRICE-003 |
| FR-015 | FR-VIEW-005 | FR-047 | FR-PRICE-004 |
| FR-016 | FR-CREATE-001 | FR-048 | FR-PRICE-005 |
| FR-017 | FR-CREATE-002 | FR-049 | FR-PRICE-006 |
| FR-018 | FR-CREATE-003 | FR-050 | FR-IMPORT-001 |
| FR-019 | FR-CREATE-004 | FR-051 | FR-IMPORT-002 |
| FR-020 | FR-CREATE-005 | FR-052 | FR-IMPORT-003 |
| FR-021 | FR-CREATE-006 | FR-053 | FR-IMPORT-004 |
| FR-022 | FR-CREATE-007 | FR-054 | FR-IMPORT-005 |
| FR-023 | FR-CREATE-008 | FR-055 | FR-IMPORT-006 |
| FR-024 | FR-CREATE-009 | FR-056 | FR-IMPORT-007 |
| FR-025 | FR-EDIT-001 | FR-057 | FR-IMPORT-008 |
| FR-026 | FR-EDIT-002 | FR-058 | FR-IMPORT-009 |
| FR-027 | FR-EDIT-003 | FR-059 | FR-AUDIT-001 |
| FR-028 | FR-EDIT-004 | FR-060 | FR-AUDIT-002 |
| FR-029 | FR-EDIT-005 | FR-061 | FR-AUDIT-003 |
| FR-030 | FR-EDIT-006 | FR-062 | FR-AUDIT-004 |
| FR-031 | FR-EDIT-007 | FR-063 | FR-AUDIT-005 |
| FR-032 | FR-DELETE-001 | FR-064 | FR-AUDIT-006 |

## Canonical non-functional crosswalk and approved additions

The legacy body contains two different requirements both numbered `NFR-005`. The first (capacity/change volume) retains `NFR-005`; the second (business change and audit transaction consistency) maps to canonical `NFR-006`. Legacy `NFR-006` through `NFR-012` consequently map to canonical `NFR-007` through `NFR-013`.

| Canonical | Source / requirement |
| --- | --- |
| NFR-001 | Legacy NFR-001 |
| NFR-002 | Legacy NFR-002 |
| NFR-003 | Legacy NFR-003 |
| NFR-004 | Legacy NFR-004 |
| NFR-005 | First legacy NFR-005: capacity and daily change volume |
| NFR-006 | Second legacy NFR-005: atomic business change and audit |
| NFR-007 | Legacy NFR-006 |
| NFR-008 | Legacy NFR-007 |
| NFR-009 | Legacy NFR-008 |
| NFR-010 | Legacy NFR-009 |
| NFR-011 | Legacy NFR-010 |
| NFR-012 | Legacy NFR-011 |
| NFR-013 | Legacy NFR-012 |
| NFR-014 | Production recovery time objective: restore Item Management service within 4 hours (`RTO <= 4h`). Approved by user on 2026-09-11. |
| NFR-015 | Production recovery point objective: lose no more than 15 minutes of committed Item Management data (`RPO <= 15m`). Approved by user on 2026-09-11. |

Security requirements retain `SEC-001` through `SEC-009`. Business rules retain `BR-001` through `BR-032`, and acceptance criteria retain `AC-001` through `AC-037`.

## Alignment status

- Requirement gate: **CONDITIONAL**. Core intent is detailed and implementation already exists, but business, QA, operations and compliance sign-off remains outstanding.
- The new DR objectives are approved requirements, not execution evidence. Restore/failover proof remains `NOT_RUN` under this documentation-only review.
- Implementation discrepancies discovered by review are recorded in `00_gap_analysis.md` and `04_design_review.md`; they do not retroactively alter this requirement baseline.

---

# Preserved legacy body (verbatim)

# Item Management 業務需求書

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Item Management 業務需求書 |
| 文件版本 | 0.3 Draft |
| 文件日期 | 2026-09-04 |
| 文件狀態 | 核心需求已確認；待正式簽核與上線前置工作 |
| 適用系統 | ERP App |
| 主要範圍 | 零售消耗品商品主資料管理 |
| 最小業務識別單位 | SKU（Stock Keeping Unit） |

### 0.1 文件目的

本文件定義 ERP 的 Item Management（商品管理）模組應滿足的業務需求，作為業務確認、方案設計、開發、測試、上線驗收及後續變更控制的共同基準。

本文件描述「系統需要支援什麼」及相關業務規則，不直接指定資料庫表、API 路徑或畫面元件等技術實作。技術設計應在需求簽核後另行產出。

### 0.2 需求背景

本 ERP 主要服務化妝品、零食、健康食品、飲品等零售消耗品。這類商品通常具有以下特性：

- 同一商品可能依容量、口味、顏色、香味、包裝或規格形成多個 SKU。
- 一個 SKU 可能同時具有單件、盒、箱等採購或銷售包裝及不同條碼。
- 部分商品需要批次及有效期管理，並可能限制收貨或銷售時的剩餘效期。
- 商品主資料會被採購、庫存、銷售、POS、定價、促銷及報表等多個模組共同引用。
- 商品一旦發生交易便不應被物理刪除，否則會破壞歷史單據、庫存及稽核資料。

現階段系統尚未建立商品主資料。Item Management 將成為後續庫存及交易模組的基礎資料來源。

### 0.3 版本紀錄

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 0.2 Draft | 2026-09-03 | 建立完整業務範圍、功能需求、規則及驗收準則。 |
| 0.3 Draft | 2026-09-04 | 完成訪談並確認數量、價格、條碼、狀態、權限、追蹤、匯入、容量、保留期及範圍等核心決策。 |

---

## 1. 業務目標與成功指標

### 1.1 業務目標

| 編號 | 目標 |
| --- | --- |
| OBJ-01 | 建立單一、可靠且可稽核的商品主資料來源。 |
| OBJ-02 | 以 SKU 作為所有可採購、持有庫存及銷售商品的最小識別單位。 |
| OBJ-03 | 支援零售消耗品所需的多規格、多條碼、包裝換算、批次及有效期政策。 |
| OBJ-04 | 提供完整的新增、查詢、修改、停用／封存及受控刪除機制。 |
| OBJ-05 | 防止重複 SKU、重複條碼、無效單位換算及不完整商品流入交易流程。 |
| OBJ-06 | 讓採購、庫存、銷售及 POS 等下游模組能取得一致的 SKU 資訊與狀態。 |
| OBJ-07 | 支援批量建立及維護商品，降低大量建檔的人工作業成本。 |

### 1.2 建議成功指標

| 編號 | 指標 | 建議目標 |
| --- | --- | --- |
| KPI-01 | 啟用 SKU 必填資料完整率 | 100% |
| KPI-02 | 系統內重複有效 SKU Code | 0 |
| KPI-03 | 系統內重複有效條碼 | 0 |
| KPI-04 | 商品主資料變更可追溯率 | 100% |
| KPI-05 | 以 SKU Code、條碼或名稱搜尋的典型回應時間 | 95% 請求在 2 秒內完成 |
| KPI-06 | 合法商品批量匯入成功率 | 99.5% 以上；錯誤列必須可辨識及修正 |

KPI 數值需由業務負責人及技術團隊在上線前確認。

---

## 2. 範圍

### 2.1 本期範圍

- 商品（Item／Product）及其 SKU 的建立與維護。
- SKU Code、名稱、規格、狀態、分類、品牌及描述管理。
- SKU 基本庫存單位、採購／銷售包裝單位及單位換算。
- 一個 SKU 對應一個或多個條碼，並指定主要條碼。
- 商品分類階層、品牌及可配置商品屬性。
- 批次、序號及有效期的「追蹤政策」設定。
- 商品圖片及基本附件管理。
- 商品搜尋、篩選、排序、分頁、詳情及變更歷史。
- SKU 停用、商品封存、有限條件下永久刪除及還原。
- 商品複製及 CSV 批量匯入／匯出。
- `item.view` 只讀權限、`item.mgmt` 管理權限及完整稽核記錄。
- 向採購、庫存、銷售、POS 及報表模組提供商品主資料。

### 2.2 本期不包含

以下能力與 Item Management 有關，但應由相應模組負責；本模組只保存所需主資料或追蹤政策：

- 各倉庫的現存量、可用量、預留量及在途量計算。
- 實際批號、批次庫存、序號及每批到期日的收貨與異動。
- 採購訂單、收貨、供應商報價及採購成本歷史。
- 銷售訂單、POS 交易、促銷、會員價及價格生效排程。
- 庫存調整、調撥、盤點、報廢及補貨計算。
- 會計分錄、成本核算及毛利報表。
- 組合商品／套裝拆組、配方、生產或 BOM。
- 電商平台商品刊登、內容同步及渠道庫存同步。
- 標籤列印及 GS1 條碼申請服務。
- Supplier 主資料及供應商商品對照；待 Supplier／Purchasing 模組建立後再實作。

### 2.3 上下游依賴

| 系統／模組 | 關係 |
| --- | --- |
| 用戶、角色與權限 | 控制誰可查看或維護商品資料。 |
| 稽核 | 記錄商品及 SKU 的新增、修改、狀態變更、匯入與刪除。 |
| 採購 | 引用可採購 SKU、採購單位及收貨效期規則；供應商商品對照待 Supplier／Purchasing 模組提供主資料後整合。 |
| 庫存 | 引用 SKU、基本庫存單位、批次／序號／有效期追蹤政策。 |
| 銷售／POS | 引用可銷售 SKU、條碼、銷售單位及顯示名稱；目前不適用銷售稅。 |
| 定價／促銷 | 以 SKU 為價格及促銷適用的最小對象。 |
| 報表 | 依商品、SKU、分類、品牌及狀態彙總。 |

---

## 3. 名詞定義

| 名詞 | 定義 |
| --- | --- |
| Item／Product | 商品的共用資料容器，例如「品牌 A 維他命 C 軟糖」。可包含一個或多個 SKU。 |
| SKU | 可被獨立識別、採購、持有庫存或銷售的最小商品單位，例如「品牌 A 維他命 C 軟糖－橙味－60 粒」。 |
| SKU Code | ERP 內部唯一且建立後原則上不可修改的 SKU 識別碼。 |
| Variant／規格 | 區分同一商品下不同 SKU 的屬性組合，如顏色、容量、口味、香味。 |
| Base UOM | SKU 庫存數量的基準單位，所有庫存及換算最終以此單位表示。 |
| Pack UOM | 採購或銷售使用的包裝單位，如盒、箱；透過固定換算率轉為 Base UOM。 |
| Barcode／GTIN | 掃描識別碼。可對應 SKU 的特定包裝單位，但在系統內不可同時指向不同 SKU。 |
| Batch／Lot | 具有共同生產或收貨特徵的一批貨品。實際批號屬庫存交易資料。 |
| Shelf Life | 商品自生產起的標準保存期。它是主資料政策，不等同某批貨品的實際到期日。 |
| Active | SKU 已通過完整性檢查，可供獲授權的下游流程使用。 |
| Inactive | SKU 暫停用於新交易，但保留既有資料及歷史關聯。 |
| Discontinued | SKU 已停止經營，不接受新的採購，但可繼續銷售現有庫存；庫存清零後由使用者手動封存。 |
| Archived | 商品主檔不再日常使用，預設不出現在列表及交易選擇器，但歷史仍可查。 |

---

## 4. 角色與責任

| 角色 | 主要責任 | 典型權限 |
| --- | --- | --- |
| 商品管理員 | 建立及維護商品、SKU、分類、品牌、條碼及包裝設定；資料完整時可直接啟用。 | `item.view`＋`item.mgmt` |
| 採購人員 | 查閱商品、採購單位及效期要求。 | `item.view`；交易內查找另依採購權限 |
| 庫存人員 | 查閱庫存單位及追蹤政策；不可任意修改主資料。 | `item.view`；交易內查找另依庫存權限 |
| 銷售／POS 人員 | 以 SKU Code、條碼或名稱查找可銷售 SKU。 | 交易內查找 |
| 財務／管理層 | 查閱商品狀態及報表分類。 | 按需要授予 `item.view` |
| 系統管理員 | 配置角色權限、處理緊急資料修復及查看稽核資料。 | 預設 `item.view`＋`item.mgmt` |

新增 `item.view` 及 `item.mgmt`：前者只允許查看商品列表、詳情、附件及變更歷史；後者允許建立、修改、狀態操作、匯入及受控刪除，並必須同時包含 `item.view`。其他業務模組在其正常流程中查找可用 SKU，仍以該模組自身權限控制，不因沒有 Item 管理權限而無法選擇商品。

---

## 5. 核心業務原則

1. **SKU 是營運最小單位。** 所有採購、庫存、銷售、定價及報表交易必須引用 SKU，不可只引用 Item。
2. **Item 是 SKU 的共用資料容器。** 一個 Item 至少有一個 SKU；只有一個規格的商品仍須建立一個 SKU。
   - Standard Item 必須且只能有一個 SKU。
   - Variant Item 才可有多個 SKU，且規格組合不得重複。
   - 已有多個 SKU 或任何交易引用後，不可直接由 Variant 改為 Standard。
3. **識別與描述分離。** SKU Code 用於穩定識別，名稱及描述可隨業務需要修改。
4. **已引用資料不可破壞。** 已被任何交易、庫存、價格、供應商或稽核資料引用的 SKU 不可永久刪除。
5. **停用不等於刪除。** 停用阻止新交易，歷史單據仍顯示交易當時及目前可用的商品資訊。
6. **啟用前先完整。** 只有通過必填欄位、唯一性、單位換算及追蹤政策驗證的 SKU 才可啟用。
7. **批次資料與主資料分離。** SKU 定義是否需要批次／有效期管理，實際批號及到期日由庫存收貨產生。
8. **所有關鍵變更可追溯。** 稽核記錄應能回答誰、何時、從什麼值改為什麼值及變更原因。
9. **數量不拆零。** Base UOM 的庫存及交易數量使用整數；重量、容量及淨含量只作商品規格描述。Pack UOM 必須以正整數換算至 Base UOM。
10. **單一語言資料。** Item／SKU 只保存一組 UTF-8 名稱及描述，本期不維護翻譯版本。

---

## 6. 資料概念模型

### 6.1 關係概覽

```text
Category ──< Item >── Brand
              │
              ├──< Item Attribute Value
              ├──< Item Image / Attachment
              │
              └──< SKU
                    ├──< Variant Value
                    ├──< Barcode
                    └──< UOM Conversion
```

### 6.2 Item 主資料

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Item ID | 系統 | 系統內部不可重用識別碼。 |
| Item Code | 不適用 | 本期不設獨立 Item Code；Item 使用系統內部 ID，交易識別使用 SKU Code。 |
| Item Name | 是 | 主要顯示名稱；去除首尾空白後 1–190 字元。 |
| Short Name | 否 | POS 或窄版畫面的短名稱。 |
| Category | 是（啟用前） | 必須指向可用且非封存的最低可選分類。 |
| Brand | 否 | 可選無品牌／自有品牌。 |
| Description | 否 | 商品說明，不接受可執行 HTML。 |
| Product Type | 是 | `standard` 或 `variant`；Standard 恰好一個 SKU，Variant 才可有多個 SKU；組合／服務型商品不在本期。 |
| Country of Origin | 否 | 建議使用 ISO 國家代碼。 |
| Manufacturer | 否 | 生產商名稱或主檔參照。 |
| Default Tracking Policy | 是 | `none`、`batch`、`batch_expiry` 或 `serial`；只作新 SKU 預設，SKU 保存實際政策。 |
| Shelf Life Days | 條件必填 | Tracking Policy 為 `batch_expiry` 時必填且大於 0。 |
| Status | 是 | `draft`、`active`、`inactive`、`discontinued`、`archived`。 |
| Created／Updated | 系統 | 記錄時間及操作者。 |

### 6.3 SKU 主資料

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| SKU ID | 系統 | 系統內部不可重用識別碼。 |
| SKU Code | 是 | 全系統唯一、不分大小寫；建立後原則上不可修改。 |
| Parent Item | 是 | 每個 SKU 必須且只能屬於一個 Item。 |
| SKU Name | 是 | 可由 Item Name 加規格自動建議，但允許受控調整。 |
| Variant Combination | 條件必填 | Variant Item 下，同一 Item 內不可有重複規格組合。 |
| Base UOM | 是 | 啟用後若已有庫存或交易，不可直接修改。 |
| Default Purchase UOM | 否 | 必須是 Base UOM 或已有有效換算的 Pack UOM。 |
| Default Sales UOM | 否 | 必須是 Base UOM 或已有有效換算的 Pack UOM。 |
| Net Content | 否 | 數值加度量單位，例如 500 ml、60 粒；只作商品描述，不代表庫存換算。 |
| Weight／Dimensions | 否 | 用於物流及顯示；數值不可為負。 |
| Tracking Policy | 是 | 決定庫存模組是否要求批次、到期日或序號。 |
| Shelf Life Days | 條件必填 | 採有效期管理時必填。 |
| Minimum Receipt Life | 否 | 收貨時最少剩餘效期天數，不可大於 Shelf Life Days。 |
| Minimum Sale Life | 否 | 銷售／出庫時最少剩餘效期天數，不可大於 Shelf Life Days。 |
| Purchasable | 是 | 是否可出現在新採購單。 |
| Sellable | 是 | 是否可出現在新銷售／POS 交易。 |
| Inventory Tracked | 是 | 是否記錄庫存；本期以實體零售品為主，預設為是。 |
| Suggested Retail Price | 條件必填 | 建議零售價（RRP／MSRP）；Active 且 Sellable SKU 必須大於 0。它是商品主資料的參考價格，不取代正式售價。 |
| Suggested Price Currency | 系統 | 固定使用公司基礎幣別 HKD，不讓每個 SKU 選擇。 |
| Suggested Price Tax Basis | 系統 | 固定為 `tax_not_applicable`；目前不適用銷售稅。 |
| Status | 是 | `draft`、`active`、`inactive`、`discontinued`、`archived`。 |
| Effective From／To | 否 | 若使用，有效期外不得加入新交易。 |
| Created／Updated | 系統 | 記錄時間、操作者及資料版本。 |

### 6.4 分類 Category

- 支援至少三級階層，實際最大層數應可配置或設合理上限。
- 分類名稱在同一父分類下不可重複。
- 分類可排序、停用及封存。
- 有子分類或仍被 Item 引用的分類不可永久刪除。
- 停用分類不影響既有 Item，但不可再指派給新 Item。
- 可指定哪些自訂屬性適用於該分類及哪些是啟用必填。
- 移動分類時不得形成循環階層。

### 6.5 品牌 Brand

- 品牌名稱全系統不分大小寫唯一。
- 品牌可包含顯示名稱、描述、官方名稱及狀態。
- 被 Item 引用的品牌不可永久刪除，只能停用或合併；品牌合併屬後續範圍。

### 6.6 商品屬性與規格

屬性分為兩類：

- **描述屬性**：如成分、過敏原、適用膚質、營養標示、保存方式，不直接區分 SKU。
- **Variant 屬性**：如容量、顏色、口味、香味、包裝規格，其組合用於區分 SKU。

每個屬性應包含名稱、資料型別、可選值、單位、是否必填、是否可搜尋／篩選、是否為 Variant 屬性及適用分類。支援的基本資料型別至少包括文字、長文字、數字、布林、日期及單選清單。成分、過敏原、營養標示、適用膚質、保存方式及法規證號等本期均以分類自訂屬性處理，不建立固定欄位。

同一 Item 內兩個 SKU 不可具有完全相同的 Variant 組合。Variant 屬性被 Active SKU 使用後，不可直接改變資料型別或刪除已用選項。

### 6.7 單位與包裝換算

| 概念 | 要求 |
| --- | --- |
| Base UOM | 每個 SKU 恰好一個，例如 `piece`、`bottle`、`bag`。 |
| Pack UOM | 可有多個，例如 `box`、`carton`。 |
| Conversion | 每個 Pack UOM 必須以固定正整數表示等於多少 Base UOM，例如 1 carton = 24 bottle。 |
| Precision | Base UOM 的庫存及交易數量為整數；不支援重量或容量拆零銷售。 |
| Unique | 同一 SKU 同一 UOM 只能有一條有效換算。 |
| Change control | 已有交易的換算不可覆寫歷史語意；應新增有效版本或禁止修改並建立新包裝。 |

銷售及庫存異動數量必須是 Base UOM 整數，使用 Pack UOM 時必須符合其整數換算倍數。`500 ml`、`0.5 kg` 等值只可作淨含量或商品規格，不代表可按小數庫存數量交易。

### 6.8 條碼

- 每個 SKU 可有零個或多個條碼；條碼不是 Active／Sellable 的必要條件，無條碼商品可用 SKU Code 搜尋及交易。
- 條碼可對應 Base UOM 或一個 Pack UOM，例如單瓶及整箱各有條碼。
- 條碼值去除允許的格式字元後，在全系統唯一；已封存資料的條碼仍保留占用，除非經受控釋放。
- 支援常見 GTIN-8、GTIN-12／UPC-A、GTIN-13／EAN-13、GTIN-14 及內部條碼。
- 標準 GTIN 應驗證長度及檢查碼；內部條碼依企業規則驗證。
- 同一 SKU 同一包裝最多一個主要條碼，但可保留供應商或舊包裝條碼。
- 掃描條碼時必須直接定位唯一 SKU 及對應 UOM；無結果及多結果均不可靜默選擇。

### 6.9 圖片與附件

- 每個 Item 可上傳多張圖片並指定一張主要圖片。
- SKU 可選擇繼承 Item 圖片或使用 SKU 專屬圖片。
- 支援排序、替換、下載及刪除；刪除附件需留下稽核記錄。
- 檔案類型、大小、數量及防惡意檔案政策應沿用系統上傳框架並由技術設計確認。
- 附件可用於規格書、成分表、合規證明等，但不得保存支付或身份驗證秘密。

### 6.10 供應商商品對照（後續範圍）

本期不建立供應商商品對照。待 Supplier／Purchasing 模組具有正式 Supplier 主資料後，每個 SKU 可選擇保存：供應商、供應商商品代碼、供應商商品名稱、採購 UOM、最小訂購量及是否首選供應商。供應商價格及合約有效期仍不屬 Item Management。

屆時同一供應商下的供應商商品代碼不可同時指向多個有效 SKU，且供應商必須使用正式外鍵，不可先保存無法驗證的自由輸入 Supplier ID。

---

## 7. 狀態與生命週期

### 7.1 狀態定義

| 狀態 | 可編輯 | 可用於新採購 | 可用於新銷售 | 歷史可見 |
| --- | --- | --- | --- | --- |
| Draft | 是 | 否 | 否 | 是 |
| Active | 受控 | 依 Purchasable | 依 Sellable | 是 |
| Inactive | 是 | 否 | 否 | 是 |
| Discontinued | 受控 | 否 | 依 Sellable 清售現有庫存 | 是 |
| Archived | 否；先還原 | 否 | 否 | 是 |

### 7.2 允許的轉換

```text
Draft ──> Active ──> Inactive ──> Active
  │          │            │
  ├─> Delete │            └─> Archived
  │          ├─> Discontinued ──> Archived
  │          └─> Archived
  └────────────────────────> Archived
```

- Draft 只有在未被任何其他資料引用時才可永久刪除。
- Active 前必須通過完整性檢查。
- Item 只有在至少一個 SKU 可啟用時才可成為 Active。
- Item 被停用、停產或封存時，系統須在同一交易內實際同步修改其下受影響 SKU 的狀態；操作前須顯示影響並要求確認，任一 SKU 不可轉換時整項操作回滾。
- Item 從 Inactive 恢復為 Active 時須明確選擇至少一個合資格 SKU 啟用；Archived Item 只可先恢復為 Inactive，且不得自動恢復或啟用任何 SKU，避免意外開放已停產規格。
- Discontinued SKU 不可新採購；Sellable 時可繼續銷售現有庫存，庫存清零後由使用者手動封存，不自動封存。
- 有現存量、預留量、在途量或未完成交易的 SKU 不得封存，除非業務流程明確處理這些數量。

---

## 8. 功能需求

### 8.1 商品列表與查詢

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-LIST-001 | Must | 系統須提供 server-side 分頁的 Item／SKU 列表，預設不顯示 Archived。 |
| FR-LIST-002 | Must | 使用者可用完整或部分 SKU Code、條碼、Item Name、SKU Name 搜尋。 |
| FR-LIST-003 | Must | 搜尋應不區分英文字母大小寫，並忽略輸入首尾空白。 |
| FR-LIST-004 | Must | 可依狀態、分類、品牌、追蹤政策、Purchasable、Sellable、建立／更新日期篩選。 |
| FR-LIST-005 | Must | 可依 SKU Code、名稱、分類、品牌、狀態及更新時間排序。 |
| FR-LIST-006 | Must | 列表須顯示 SKU Code、主要條碼、名稱、規格、Base UOM、分類、品牌及狀態。 |
| FR-LIST-007 | Must | 使用者可切換 Item 彙總視圖與 SKU 平鋪視圖；交易查找預設使用 SKU 視圖。 |
| FR-LIST-008 | Should | 搜尋結果可匯出 CSV，並保留當前篩選條件及權限範圍。 |
| FR-LIST-009 | Should | 可儲存常用篩選或由 URL 保留查詢狀態。 |
| FR-LIST-010 | Must | 空結果、載入中、錯誤及無權限狀態必須清晰區分。 |

### 8.2 檢視詳情

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-VIEW-001 | Must | Item 詳情須顯示共用資料及其全部 SKU，包括非 Active SKU。 |
| FR-VIEW-002 | Must | SKU 詳情須顯示識別資料、規格、條碼、UOM 換算、追蹤政策、狀態及時間資訊。 |
| FR-VIEW-003 | Must | 有權限者可查看完整變更歷史，包括變更前後值、操作者、時間及原因。 |
| FR-VIEW-004 | Should | 如庫存模組存在，可顯示庫存摘要連結，但不可在本模組自行計算庫存。 |
| FR-VIEW-005 | Must | 已停用、停產或封存資料須有明顯狀態標示，避免被誤認為可交易。 |

### 8.3 新增 Item 與 SKU

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-CREATE-001 | Must | 商品管理員可建立 Draft Item，並在同一流程建立至少一個 SKU。 |
| FR-CREATE-002 | Must | 系統須支援單規格商品及多規格商品。 |
| FR-CREATE-003 | Must | SKU Code 由使用者人工輸入，系統不自動產生，亦不強制前綴、分段或字元組成格式。 |
| FR-CREATE-004 | Must | 儲存前須驗證 SKU Code、條碼及 Variant 組合唯一性。 |
| FR-CREATE-005 | Must | 建立多規格商品時，可由選定的 Variant 值產生組合草稿，使用者確認後才建立 SKU。 |
| FR-CREATE-006 | Must | 系統不得因其中一個 SKU 驗證失敗而留下未向使用者說明的部分資料。 |
| FR-CREATE-007 | Should | 使用者可從既有 Item 或 SKU 複製建立草稿；SKU Code、條碼及外部唯一代碼不得被複製。 |
| FR-CREATE-008 | Must | 新建資料預設為 Draft，不得在資料未完整時直接流入交易。 |
| FR-CREATE-009 | Must | 建檔人具有商品管理權限且資料通過完整性驗證時，可在同一工作流程直接啟用商品及 SKU，不需另一人覆核。 |

### 8.4 修改

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-EDIT-001 | Must | 有權限者可修改名稱、描述、分類、品牌、屬性、圖片及允許修改的 SKU 欄位。 |
| FR-EDIT-002 | Must | SKU Code 建立後不可由一般介面修改；如業務確需更正，應走具理由及高權限的受控流程。 |
| FR-EDIT-003 | Must | Active SKU 的 Base UOM、Tracking Policy 或關鍵換算若已被交易引用，不得直接修改。 |
| FR-EDIT-004 | Must | 系統須使用資料版本或等效機制避免兩人同時編輯時後儲存者無聲覆蓋前者。 |
| FR-EDIT-005 | Must | 儲存修改時重新執行唯一性、條件必填及跨欄位規則驗證。 |
| FR-EDIT-006 | Must | 關鍵變更須填寫原因，包括 SKU Code 特批修改、Base UOM、追蹤政策、停用、停產、封存及條碼釋放。 |
| FR-EDIT-007 | Should | 使用者離開有未儲存變更的表單前，系統應提示確認。 |

### 8.5 停用、停產、封存、刪除與還原

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-DELETE-001 | Must | 已發生引用的 SKU 不可永久刪除，只可 Inactive、Discontinued 或 Archived。 |
| FR-DELETE-002 | Must | 只有 Draft 且完全未被引用的 Item／SKU 可永久刪除。 |
| FR-DELETE-003 | Must | 刪除或狀態變更前須顯示受影響 SKU 數及阻擋原因。 |
| FR-DELETE-004 | Must | 停用 SKU 後，不得加入新的採購、銷售、價格或庫存交易；既有未完成單據如何處理須由下游模組明確提示。 |
| FR-DELETE-005 | Must | 封存資料預設不在日常列表和選擇器顯示，但可透過篩選查回。 |
| FR-DELETE-006 | Must | 還原封存資料時須再次驗證 SKU Code、條碼及依賴主檔是否仍有效。 |
| FR-DELETE-007 | Must | 永久刪除、停用、停產、封存及還原均須記錄原因及稽核事件。 |

### 8.6 條碼及 UOM 維護

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-UOM-001 | Must | 使用者可為每個 SKU 維護 Base UOM 及多個 Pack UOM 換算。 |
| FR-UOM-002 | Must | 系統須禁止零、負數、循環或同一 UOM 重複換算。 |
| FR-UOM-003 | Must | 每個條碼須綁定一個 SKU 及該 SKU 的有效 UOM。 |
| FR-UOM-004 | Must | 條碼掃描須回傳 SKU 及數量換算語意，例如掃描箱碼代表 24 個 Base UOM。 |
| FR-UOM-005 | Must | 刪除仍被條碼、供應商對照或交易使用的 UOM 換算時，系統須拒絕並列出依賴類型。 |

### 8.7 建議零售價

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-PRICE-001 | Must | 每個 SKU 均可保存自己的建議零售價；不可只在 Item 層保存一個價格。 |
| FR-PRICE-002 | Must | Active 且 Sellable 的 SKU 必須具有大於 0 的建議零售價及明確幣別。Draft 或不可銷售 SKU 可暫時留空。 |
| FR-PRICE-003 | Must | 建議零售價固定使用 HKD，稅務口徑固定為 `tax_not_applicable`；畫面、匯入及匯出須顯示該口徑。 |
| FR-PRICE-004 | Must | 修改建議零售價須記錄舊值、新值、幣別、操作者及時間；是否強制填寫原因待業務確認。 |
| FR-PRICE-005 | Must | 建議零售價只作參考或正式售價的預設來源；門店價、渠道價、會員價、促銷價及價格生效期間由定價模組管理。 |
| FR-PRICE-006 | Should | 建立多個 SKU 時，可從 Item 層輸入一個建議值批量帶入，但儲存後每個 SKU 的價格均可獨立維護。 |

### 8.8 批量匯入與匯出

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-IMPORT-001 | Must | 系統須提供帶欄位說明、版本號及範例的 CSV 匯入範本。 |
| FR-IMPORT-002 | Must | 匯入分為上傳、預檢、確認執行及結果下載四步；預檢不得寫入正式資料。 |
| FR-IMPORT-003 | Must | 預檢須逐列指出欄位、錯誤碼及可理解的修正訊息。 |
| FR-IMPORT-004 | Must | 匯入採全有全無；任何一列錯誤時整批不得寫入，使用者須修正後重新預檢及確認。 |
| FR-IMPORT-005 | Must | 匯入更新既有 SKU 時必須以穩定識別碼匹配，並明確區分新增、更新、略過及失敗。 |
| FR-IMPORT-006 | Must | 匯入任務須防止同一檔案或同一請求被重複提交而建立重複資料。 |
| FR-IMPORT-007 | Must | 匯入完成後提供總筆數、成功、失敗、略過及警告數，並可下載結果檔。 |
| FR-IMPORT-008 | Must | 匯入及匯出須套用相同權限與敏感欄位遮蔽規則。 |
| FR-IMPORT-009 | Should | 大型匯入可在背景執行，使用者可查看進度及完成通知。 |

### 8.9 稽核與歷史

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-AUDIT-001 | Must | 系統須記錄 Item、SKU、條碼、UOM 換算、屬性、狀態及附件的建立、修改及刪除事件。 |
| FR-AUDIT-002 | Must | 稽核資料至少包含事件時間、操作者、動作、對象 ID／Code、變更前後值、原因及 request ID。 |
| FR-AUDIT-003 | Must | 稽核記錄不得包含認證憑證、Token 或不必要的敏感資料。 |
| FR-AUDIT-004 | Must | 稽核寫入與業務修改須具有一致結果，不可資料已改但稽核遺失。 |
| FR-AUDIT-005 | Must | 一般商品管理員不可修改或刪除稽核歷史。 |
| FR-AUDIT-006 | Should | 可依 SKU Code、操作者、動作及時間範圍查詢變更歷史。 |

---

## 9. 業務規則

| 編號 | 規則 |
| --- | --- |
| BR-001 | 每個 Item 必須至少擁有一個 SKU；每個 SKU 必須且只能屬於一個 Item。Standard Item 恰好一個 SKU；只有 Variant Item 可有多個 SKU，且已有多個 SKU 或交易引用後不可直接改成 Standard。 |
| BR-002 | 所有交易只能引用 SKU ID，不可將名稱、條碼或 SKU Code 當作外鍵。 |
| BR-003 | SKU Code 去除首尾空白並以不分英文字母大小寫方式比較後，須在單一公司的商品目錄內全域唯一；唯一性包含 Draft、Inactive、Discontinued 及 Archived。 |
| BR-004 | SKU Code 由使用者人工輸入，不套用自動編碼、前綴、分段或字元組成規則；系統只執行非空白、欄位長度、安全字元處理及唯一性等基本驗證。 |
| BR-005 | 條碼全系統唯一；標準 GTIN 必須通過檢查碼驗證。 |
| BR-006 | Item Name 可重複，但相同品牌、名稱及規格的疑似重複資料應警告使用者。 |
| BR-007 | 同一 Item 內 SKU 的 Variant 組合不可重複。 |
| BR-008 | Active SKU 必須具有 SKU Code、SKU Name、Category、Base UOM、狀態及有效追蹤政策。 |
| BR-009 | Tracking Policy 為 `batch_expiry` 時，Shelf Life Days 必填且大於 0。 |
| BR-010 | Minimum Receipt Life 與 Minimum Sale Life 不可為負，亦不可大於 Shelf Life Days。 |
| BR-011 | 每個 Pack UOM 換算率必須為正整數，且能精確轉換為 Base UOM；本期所有庫存及交易數量均為 Base UOM 整數。 |
| BR-012 | 已有交易或庫存的 SKU 不可直接修改 SKU Code、Base UOM 或追蹤政策。 |
| BR-013 | Item 為 Inactive、Discontinued 或 Archived 時，其 SKU 不得用於不符合父狀態的新交易。 |
| BR-014 | SKU 為 Inactive 或 Archived 時，不得加入任何新業務單據。 |
| BR-015 | SKU 為 Discontinued 時不可建立新採購需求；Sellable 時可銷售現貨，售完後由使用者手動封存。 |
| BR-016 | 已引用 Item、SKU、分類、品牌、UOM 或條碼不可無條件永久刪除。 |
| BR-017 | 狀態變更、永久刪除及關鍵識別欄位特批修改必須填寫原因。 |
| BR-018 | 名稱、描述及自由文字欄位須去除首尾空白，並防止腳本或危險標記被執行。 |
| BR-019 | 交易建立時應保存必要的商品快照（如當時名稱、SKU Code、UOM），但仍以 SKU ID 保持關聯。 |
| BR-020 | 下游模組必須在提交交易時再次驗證 SKU 狀態，不可只依賴使用者開啟頁面時的查詢結果。 |
| BR-021 | 匯入、介面及整合 API 必須套用相同的唯一性和生命週期規則。 |
| BR-022 | Item 或 SKU 的更新須檢查資料版本，版本不一致時拒絕覆蓋並要求重新載入。 |
| BR-023 | 所有時間以系統統一時區顯示、以無時區歧義的格式保存；沿用現有 `APP_TIME_ZONE` 原則。 |
| BR-024 | 建議零售價屬 SKU 層資料；Item 層如提供價格，只能作建立 SKU 時的預設值。 |
| BR-025 | Active 且 Sellable SKU 的建議零售價必須大於 0；幣別固定為 HKD，稅務口徑固定為 `tax_not_applicable`。 |
| BR-026 | 交易成交價不可因建議零售價改變而回寫或改變歷史交易；歷史交易必須保留交易當時的實際單價。 |
| BR-027 | 系統只服務單一公司；Item、SKU Code、條碼、分類及品牌等主資料的唯一性範圍均為整個公司，不設公司／租戶隔離層。 |
| BR-028 | 具商品管理權限的建檔人可直接將完整商品啟用；不要求建檔與審核職責分離，但啟用行為必須保留稽核記錄。 |
| BR-029 | Item／SKU 只保存一組 UTF-8 名稱及描述，本期不保存多語言翻譯。 |
| BR-030 | Tracking Policy 的實際值保存在 SKU；Item 只提供新建 SKU 的預設，修改 Item 預設不得覆寫既有 SKU。 |
| BR-031 | Item／SKU 狀態只在全公司層級管理；門店、倉庫及渠道狀態由後續相應模組負責。 |
| BR-032 | Item 狀態變更須在同一交易實際同步更新受影響 SKU：停用時 Active SKU 轉 Inactive；停產時 Active／Inactive SKU 轉 Discontinued 並停止採購；封存時所有非 Archived SKU 轉 Archived。Item 恢復不得自動恢復 SKU。 |

---

## 10. 使用者體驗要求

### 10.1 導航與頁面

- 左側菜單新增「商品管理」群組或入口，至少包含商品／SKU、分類、品牌及匯入任務。
- 商品列表點選後進入 Item 詳情；SKU Code 或 SKU 行可直接進入 SKU 詳情。
- 新增及編輯流程可採分段表單：基本資料、規格／SKU、條碼與單位、追蹤政策、圖片附件、確認。
- 系統須清楚區分 Item 層與 SKU 層欄位，避免使用者把商品名稱誤當成 SKU。
- 必填欄位、格式錯誤、跨欄位錯誤應靠近欄位顯示；批量錯誤則提供可下載清單。
- 高影響操作須顯示影響範圍、要求原因並二次確認。
- 儲存成功後須顯示可識別對象，例如「SKU COS-001 已更新」。

### 10.2 搜尋與掃描

- 全域快速搜尋輸入 SKU Code 或條碼時，精確匹配結果應優先顯示。
- 條碼掃描輸入應能處理掃描器快速輸入及結尾 Enter，不要求滑鼠操作。
- 若條碼對應 Pack UOM，畫面須同時顯示包裝及換算數量。
- 查不到條碼時，不可自動建立商品；應引導有權限者進入建檔或條碼維護流程。

### 10.3 可用性與無障礙

- 所有核心 CRUD 功能須可用鍵盤操作。
- 狀態不可只用顏色表達，須同時顯示文字或圖示標籤。
- 表單錯誤須能被輔助技術識別，焦點應移至第一個錯誤或錯誤摘要。
- 危險操作的確認文案須說明結果，不使用含糊的「確定嗎」。

---

## 11. 權限、安全與職責分離

| 編號 | 需求 |
| --- | --- |
| SEC-001 | 未登入使用者不可存取任何商品管理端點或頁面。 |
| SEC-002 | `item.view` 允許查看商品列表、詳情、附件及稽核；只有同時具有 `item.mgmt` 的角色可建立、修改、停用、封存、刪除及匯入商品。 |
| SEC-003 | 下游業務角色可在其獲授權流程中搜尋可用 SKU，但不可藉此取得商品維護能力。 |
| SEC-004 | 前端隱藏或停用按鈕不能取代後端授權檢查。 |
| SEC-005 | 本期不保存成本或供應商條件；日後如納入敏感欄位，必須另行定義獨立查看及匯出權限。 |
| SEC-006 | 永久刪除、SKU Code 特批修改、條碼釋放及批量狀態更新應要求較高權限或再確認。 |
| SEC-007 | 商品資料輸入、CSV 及附件必須進行格式、內容及大小驗證，避免注入及惡意檔案。 |
| SEC-008 | 系統須防止水平越權；使用者不可透過更換 ID 操作無權限對象。 |
| SEC-009 | 大量匯出及敏感資料存取應留下稽核記錄。 |

本期不採「建檔與啟用分離」的雙人覆核。具商品管理權限的建檔人可直接啟用，但系統仍須執行完整性驗證、後端授權檢查及啟用稽核。

---

## 12. 整合需求

### 12.1 共通整合原則

- 下游系統以不可重用的 SKU ID 關聯，SKU Code 與條碼只用於搜尋及外部交換。
- 查詢結果須至少提供 SKU ID、SKU Code、顯示名稱、狀態、Item、分類、品牌、Base UOM 及相關 Pack UOM。
- 交易提交時重新驗證 SKU 是否可用、是否符合 Purchasable／Sellable 及生效日期。
- Item Management 應提供單筆及批量查詢能力；大量報表不可逐筆呼叫造成 N+1 查詢。
- 變更後的資料一致性時限須由技術設計定義。商品被停用後，下游新交易必須即時或在可接受的明確時限內拒絕。
- 外部重送建立／更新請求不得產生重複 SKU，應使用 idempotency 或等效控制。

### 12.2 採購整合

- 只可選擇 Active、Purchasable 且在有效期間內的 SKU。
- 採購 UOM 必須可換算至 Base UOM。
- 收貨時，若 SKU 要求批次或到期日，庫存模組必須強制收集相應資料。
- 若剩餘效期小於 Minimum Receipt Life，預設阻擋收貨；只有具備專門效期豁免權限的人員可在填寫原因後例外收貨，系統須完整記錄 SKU、批次、到期日、門檻、實際剩餘天數、操作者、原因及時間。實際權限及流程由 Receiving 模組實作。

### 12.3 庫存整合

- 所有庫存數量以 Base UOM 保存或可無損換算至 Base UOM。
- 庫存模組依 SKU Tracking Policy 決定是否要求 Lot、Expiry Date 或 Serial Number。
- Item Management 不得以計算欄位取代庫存台帳；它只接收及顯示庫存摘要。
- 變更狀態或封存前，須能查詢是否存在現存、預留、在途或未完成異動。

### 12.4 銷售／POS 整合

- 只可選擇 Active、Sellable 且在有效期間內的 SKU；Discontinued 且 Sellable 的 SKU 可清售現有庫存，但不可新採購。
- 條碼掃描須同時識別 SKU 與銷售 UOM。
- 定價模組回傳的有效門店／渠道／促銷價格優先於建議零售價；建議零售價不得無聲覆蓋已生效價格。
- 定價模組找不到有效價格時，POS 是否允許手動定價由定價／銷售需求另行定義。
- 若批次有銷售剩餘效期限制，出庫分配不可選擇低於 Minimum Sale Life 的批次。

---

## 13. 非功能需求

### 13.1 效能與容量

| 編號 | 需求 |
| --- | --- |
| NFR-001 | 在最多 50 名同時在線使用者的正常混合負載下，一般 SKU 列表、精確 SKU Code 或條碼查詢的 95% 應於 2 秒內回應。 |
| NFR-002 | 列表必須 server-side 分頁，單頁預設 20、上限 100，沿用現有系統慣例。 |
| NFR-003 | 預計三年內少於 20,000 SKU；系統設計及壓力測試仍以 100,000 SKU、每 SKU 10 個條碼及 10 個 UOM 換算為上限基準。 |
| NFR-004 | 10,000 列 CSV 的預檢與確認執行之系統處理時間合計應在 10 分鐘內完成，不計使用者停留及確認時間，且不得令其他線上查詢超出 NFR-001。 |
| NFR-005 | 系統須支援每日最多 1,000 次 Item／SKU／Catalog 資料變更，並完整保存相應稽核記錄。 |

### 13.2 可用性與一致性

| 編號 | 需求 |
| --- | --- |
| NFR-005 | 商品建立／修改與其稽核結果須保持交易一致性。 |
| NFR-006 | 同時編輯衝突不得以最後寫入者無聲覆蓋處理。 |
| NFR-007 | 重複提交建立、匯入或關鍵狀態動作不得產生重複或矛盾結果。 |
| NFR-008 | 商品主資料須納入既有資料庫備份、還原及災難復原程序。 |

### 13.3 相容性與可維護性

| 編號 | 需求 |
| --- | --- |
| NFR-009 | 欄位、狀態與錯誤代碼應在 Web UI、CSV 及整合介面保持一致。 |
| NFR-010 | 商品屬性應能按分類配置，避免每增加一種消耗品都必須修改固定資料結構。 |
| NFR-011 | 所有狀態及 UOM 語意須有中央定義，避免不同模組各自解讀。 |
| NFR-012 | 日期、時間及數字顯示須符合系統語系及時區設定。 |

### 13.4 隱私與保留

- 商品資料通常不屬個人資料，但稽核中的操作者資訊依現有用戶稽核政策處理。
- Item、SKU、Catalog 主資料及其稽核在封存後至少保留 7 年；匯入工作摘要及匯入稽核亦至少保留 7 年。
- CSV 匯入原始檔及結果檔由工作完成日起保留 1 年，期滿由排程安全刪除；刪檔不得刪除工作摘要或稽核。
- 上述期限是已確認的營運基線；正式上線前須由合規人員核對。若適用法規、財務、稅務或食品追溯要求較長，以較長期限為準。
- 永久刪除只適用於未被引用的 Draft；其他資料以封存取代刪除。
- 備份及災難復原沿用整個 ERP 的統一政策，不由 Item Management 建立獨立週期。

---

## 14. 錯誤與例外處理

| 情境 | 系統行為 |
| --- | --- |
| SKU Code 已存在 | 拒絕儲存，指出衝突 SKU；不得只回一般伺服器錯誤。 |
| 條碼已被其他 SKU 使用 | 拒絕儲存並顯示對應 SKU Code；無查看權限時只顯示必要資訊。 |
| Variant 組合重複 | 拒絕建立，標示重複組合。 |
| Item／SKU 已被另一使用者更新 | 拒絕覆蓋，提示重新載入並保留使用者尚可複製的輸入。 |
| 嘗試刪除已引用 SKU | 拒絕永久刪除，列出引用類型並提供停用／封存入口。 |
| UOM 換算無效 | 指出錯誤換算及原因，不可自動猜測修正。 |
| 有效期規則矛盾 | 阻擋啟用，指出 Shelf Life 與最少剩餘效期的關係。 |
| 批量匯入部分資料錯誤 | 預檢列出每列結果；未經確認不得寫入。 |
| 權限不足 | 回應無權限，不洩漏未獲授權的商品或稽核資料。 |
| Item 已停用但使用者畫面仍開著 | 下游提交時再次驗證並拒絕新交易。 |

技術設計應為上述情境定義穩定的錯誤代碼，供前端及整合方處理。

---

## 15. 驗收準則

### 15.1 核心 CRUD

| 編號 | 驗收準則 |
| --- | --- |
| AC-001 | Given 商品管理員輸入合法 Item 及至少一個 SKU，When 儲存，Then 系統建立 Draft Item／SKU，並可在詳情及稽核中查到。 |
| AC-002 | Given SKU Code 已存在於任一狀態，When 再次建立相同 Code（忽略大小寫），Then 系統拒絕且不建立部分資料。 |
| AC-003 | Given Item 有多個 Variant 屬性，When 產生並確認規格組合，Then 每個唯一組合形成一個獨立 SKU。 |
| AC-004 | Given Active SKU，When 修改允許欄位，Then 新值可查見、下游可取得，且稽核保留前後值。 |
| AC-005 | Given 已被交易引用的 SKU，When 要求永久刪除，Then 系統拒絕並提供停用／封存選項。 |
| AC-006 | Given 未被引用的 Draft SKU，When 有權限者填寫原因並永久刪除，Then SKU 不再可用且刪除事件可稽核。 |

### 15.2 查詢與狀態

| 編號 | 驗收準則 |
| --- | --- |
| AC-007 | Given 商品資料存在，When 以 SKU Code、主要／次要條碼或部分名稱搜尋，Then 正確 SKU 在結果中顯示。 |
| AC-008 | Given Archived SKU，When 使用預設列表，Then 不顯示；When 開啟 Archived 篩選，Then 可查到其歷史資料。 |
| AC-009 | Given SKU 欄位未符合啟用規則，When 嘗試轉為 Active，Then 系統拒絕並列出全部阻擋項。 |
| AC-010 | Given SKU 已 Inactive，When 下游建立新採購或銷售交易，Then 提交時被拒絕。 |
| AC-011 | Given Item 被停用，When 確認操作，Then 其下 SKU 停止進入新交易，而既有歷史仍可查。 |

### 15.3 條碼、UOM 與效期政策

| 編號 | 驗收準則 |
| --- | --- |
| AC-012 | Given 一箱等於 24 瓶且箱碼已設定，When 掃描箱碼，Then 系統回傳指定 SKU、`carton` UOM 及 24 Base UOM 的換算。 |
| AC-013 | Given 條碼已屬於 SKU A，When 嘗試將其加到 SKU B，Then 系統拒絕且兩個 SKU 均無錯誤變更。 |
| AC-014 | Given GTIN 檢查碼不合法，When 儲存，Then 系統指出條碼格式錯誤。 |
| AC-015 | Given Tracking Policy 為 `batch_expiry` 且 Shelf Life Days 空白，When 啟用，Then 系統拒絕。 |
| AC-016 | Given SKU 已有庫存交易，When 嘗試直接修改 Base UOM 或 Tracking Policy，Then 系統拒絕並說明原因。 |

### 15.4 匯入、權限與並發

| 編號 | 驗收準則 |
| --- | --- |
| AC-017 | Given CSV 同時有合法及錯誤列，When 執行預檢，Then 系統不寫入資料並提供逐列結果。 |
| AC-018 | Given 同一匯入確認被重送，When 系統收到重複請求，Then 不建立重複 SKU。 |
| AC-019 | Given 無商品管理權限的使用者，When 直接呼叫修改或刪除功能，Then 後端拒絕且無資料變更。 |
| AC-020 | Given 兩人讀取同一 SKU 版本，When 第一人儲存後第二人再儲存，Then 第二人收到版本衝突，不會覆蓋第一人的變更。 |
| AC-021 | Given 有權限使用者完成關鍵變更，When 查閱歷史，Then 能看到操作者、時間、原因、對象及前後值。 |
| AC-022 | Given Sellable SKU 沒有建議零售價或價格不大於 0，When 嘗試啟用，Then 系統拒絕並指出價格錯誤。 |
| AC-023 | Given 同一 Item 下不同容量的兩個 SKU，When 分別維護建議零售價，Then 系統保留兩個獨立價格，不互相覆蓋。 |
| AC-024 | Given SKU 的建議零售價已修改，When 查閱稽核歷史及既有銷售交易，Then 稽核顯示價格前後值，而歷史交易成交價保持不變。 |
| AC-025 | Given 商品管理員建立的商品及 SKU 已符合全部啟用條件，When 建檔人直接執行啟用，Then 系統不要求第二人審批，並記錄啟用稽核。 |
| AC-026 | Given 使用者輸入不符合固定編碼模式但非空白、長度合法且唯一的 SKU Code，When 儲存，Then 系統接受該 Code，不自行改寫或重新編碼。 |
| AC-027 | Given Standard Item 已有一個 SKU，When 使用者嘗試新增第二個 SKU，Then 系統拒絕且不留下部分資料。 |
| AC-028 | Given 使用者只有 `item.view`，When 查看列表、詳情、附件或稽核，Then 系統允許；When 呼叫任何寫入 API，Then 後端拒絕且無資料變更。 |
| AC-029 | Given 完整且 Sellable 的 SKU 沒有條碼，When 有權限者啟用，Then 系統允許並可使用 SKU Code 查找。 |
| AC-030 | Given SKU 已 Discontinued 且 Sellable 並仍有庫存，When 建立銷售交易，Then 可清售；When 建立新採購需求，Then 系統拒絕。 |
| AC-031 | Given CSV 任一列驗證失敗，When 使用者確認匯入，Then 整批不寫入任何 Item／SKU。 |
| AC-032 | Given 使用者輸入小數 Base UOM 數量或非整數 Pack 換算，When 儲存或提交交易，Then 系統拒絕並指出整數規則。 |
| AC-033 | Given SKU 有建議零售價，When 在畫面、匯入或匯出查看，Then 幣別顯示 HKD，稅務口徑顯示 `tax_not_applicable`。 |
| AC-034 | Given 收貨商品的剩餘效期低於 SKU 的 Minimum Receipt Life，When 一般使用者提交收貨，Then 系統拒絕；When 具備專門效期豁免權限的使用者填寫原因後提交，Then 系統允許並完整記錄豁免稽核。 |
| AC-035 | Given 100,000 SKU 基準資料、50 名同時在線使用者及代表每日 1,000 次變更的混合負載，When 執行已定義的效能測試，Then 線上查詢 p95 少於 2 秒，且 10,000 列 CSV 預檢與確認執行的系統處理時間合計不超過 10 分鐘。 |
| AC-036 | Given 已完成的匯入工作滿 1 年，When 檔案清理排程執行，Then 原始檔及結果檔被安全刪除並記錄清理結果，而匯入工作摘要及稽核仍可查閱並按至少 7 年期限保留。 |
| AC-037 | Given Item 下有不同狀態的 SKU，When 管理員停用、停產或封存 Item，Then 系統在同一交易按 BR-032 實際同步所有受影響 SKU 並記錄稽核；任一 SKU 失敗則全部回滾。When Item 被恢復，Then SKU 不會自動恢復或啟用。 |

---

## 16. 資料建置與上線需求

### 16.1 初始資料

上線前至少需確認及建置：

- UOM 目錄、Pack UOM 正整數換算及最大允許倍數。
- 商品分類樹。
- 品牌資料。
- 商品屬性及各分類適用規則。
- SKU 編碼政策。
- 條碼種類及內部條碼政策。
- Tracking Policy 與有效期規則。
- 基礎幣別 HKD 及 `tax_not_applicable` 價格口徑。
- 商品管理角色及權限。

### 16.2 舊資料導入

- 業務須提供來源欄位與目標欄位 mapping。
- 導入前先執行 SKU Code、條碼、名稱、分類、UOM 及狀態的資料清理。
- 無法唯一識別的重複資料不得由系統自動合併，須輸出例外清單供業務決定。
- 正式導入前至少完成一次模擬導入、筆數核對、抽樣核對及回滾演練。
- 導入結果須核對來源總數、成功、失敗、合併／略過及目標總數。

### 16.3 上線控制

- 上線前凍結商品主資料或定義增量補錄窗口。
- 完成備份及可驗證的還原方案。
- 先配置權限，再開放商品維護入口。
- 完成 Item 建立、SKU 搜尋、條碼掃描、停用及下游拒絕的端到端 smoke test。

---

## 17. 優先級與建議交付階段

### Phase 1：核心主資料（MVP）

- Item、SKU、分類、品牌的 CRUD。
- SKU Code、單規格／多規格、Base UOM、主要條碼。
- Draft／Active／Inactive／Archived 狀態與受控刪除。
- 搜尋、篩選、分頁、權限及稽核。
- 提供下游 Active SKU 查找契約。

### Phase 2：零售消耗品能力

- 多條碼及 Pack UOM 換算。
- 批次／有效期追蹤政策及最少剩餘效期。
- 自訂屬性、圖片及附件。
- Discontinued 清貨流程。

### Phase 3：大量維護及營運效率

- CSV 預檢、批量匯入／匯出、背景任務。
- 商品複製、批量狀態更新及資料完整度儀表板。
- 常用篩選及進階重複資料偵測。

交付階段可調整，但不可將唯一性、權限、狀態驗證及稽核從核心 CRUD 延後，否則會累積不可逆的錯誤主資料。

---

## 18. 已確認決策與上線前置工作

### 18.1 已確認決策

| 編號 | 決策 | 業務影響 |
| --- | --- | --- |
| DEC-001 | 系統只支援單一公司。 | 商品目錄及所有唯一代碼均以全公司為範圍，不建立公司／租戶隔離。 |
| DEC-002 | SKU Code 由使用者人工輸入，沒有指定編碼格式。 | 不提供自動編碼或格式規則；仍保留非空白、長度、安全處理及全域唯一性驗證。 |
| DEC-003 | 商品由建檔人直接啟用。 | 不建立雙人覆核流程；建檔人須有商品管理權限，系統須完成資料驗證及稽核。 |
| DEC-004 | 本期只保存一組 UTF-8 商品名稱及描述。 | 不建立多語言欄位或翻譯表。 |
| DEC-005 | 不支援按重量或容量拆零銷售。 | Base UOM 數量及 Pack UOM 換算均使用整數。 |
| DEC-006 | Item Management 不保存標準或參考成本。 | 成本由後續採購／庫存成本核算模組處理。 |
| DEC-007 | 條碼不是 SKU 啟用必要條件。 | 無條碼商品可使用 SKU Code；渠道可另設上架條件。 |
| DEC-008 | Discontinued SKU 可清售現有庫存但不可新採購。 | 售完後由使用者手動封存，不自動封存。 |
| DEC-009 | 新增 `item.view` 只讀權限。 | 查看與維護分權；下游交易查找仍使用各模組權限。 |
| DEC-010 | Tracking Policy 最終保存在 SKU。 | Item 只提供建立預設，不按分類強制或追溯覆寫。 |
| DEC-011 | 消耗品法規及描述資料使用分類自訂屬性。 | 本期不建立成分、過敏原、營養或法規證號固定欄位。 |
| DEC-012 | 本期不支援組合包、贈品、虛擬 SKU 或服務型 Item。 | 只管理獨立持有庫存的實體 SKU。 |
| DEC-013 | CSV 匯入採全有全無。 | 任一列錯誤時整批不寫入，須修正後重新預檢。 |
| DEC-014 | 三年內預計少於 20,000 SKU，以 100,000 SKU 作設計上限。 | 索引及壓力測試按較高上限驗證。 |
| DEC-015 | Item／SKU 狀態只在全公司層級管理。 | 門店、倉庫及渠道狀態由後續相應模組負責。 |
| DEC-016 | 建議零售價固定使用 HKD，稅務口徑為 `tax_not_applicable`。 | 本期不提供含稅／未稅選項或稅務分類。 |
| DEC-017 | Standard Item 恰好一個 SKU；Variant Item 才可多 SKU。 | 多 SKU／已引用 Item 不可直接改成 Standard。 |
| DEC-018 | 供應商商品對照延後。 | Supplier／Purchasing 主資料完成前不建立無外鍵的供應商對照。 |
| DEC-019 | 本期不設獨立 Item Code。 | Item 使用不可重用的系統內部 ID；交易及外部交換使用 SKU Code。 |
| DEC-020 | 單純修改 SKU 建議零售價不強制填寫原因。 | 系統仍須稽核修改前後值、操作者及時間；若同時修改其他關鍵欄位，則按該欄位規則要求原因。 |
| DEC-021 | 剩餘效期不足可由獲授權人員例外收貨。 | 預設阻擋；豁免須具備專門權限、填寫原因並留下完整稽核，由 Receiving 模組實作。 |
| DEC-022 | 採用已確認的效能及容量基線。 | 最多 50 名同時在線使用者、每日 1,000 次商品資料變更、線上查詢 p95 少於 2 秒，10,000 列 CSV 系統處理時間合計不超過 10 分鐘。 |
| DEC-023 | 採用商品及匯入資料保留基線。 | 主資料、工作摘要及稽核至少保留 7 年；匯入原始檔及結果檔保留 1 年；備份沿用 ERP 統一政策，正式上線前由合規核對。 |
| DEC-024 | Item 狀態實際同步至受影響的子 SKU。 | 停用、停產及封存在同一交易同步 SKU；任一失敗全部回滾；Item 恢復時不自動恢復或啟用 SKU。 |

### 18.2 上線前置工作

本輪訪談已完成核心商品模型確認，目前沒有未決的核心業務需求。正式上線前仍須由合規人員核對 DEC-023 的保留期限，並由業務提供首版 Category、UOM、Attribute 及內部 Barcode 規則樣本。

---

## 19. 需求追溯摘要

| 業務目標 | 主要需求 |
| --- | --- |
| OBJ-01 單一商品主檔 | FR-CREATE、FR-EDIT、FR-VIEW、BR-001～BR-003 |
| OBJ-02 SKU 最小單位 | 核心原則 1～2、BR-001～BR-002、整合需求 |
| OBJ-03 零售消耗品能力 | §6.6～§6.10、FR-UOM、AC-012～AC-016 |
| OBJ-04 完整 CRUD | FR-LIST、FR-VIEW、FR-CREATE、FR-EDIT、FR-DELETE |
| OBJ-05 資料品質 | BR-003～BR-012、錯誤處理、AC-002、AC-009、AC-013～AC-016 |
| OBJ-06 下游一致使用 | §12、BR-019～BR-020、AC-010 |
| OBJ-07 批量效率 | FR-IMPORT、§16、AC-017～AC-018 |

---

## 20. 簽核條件

本需求可進入詳細設計前，至少需要：

1. 業務負責人確認 §2 範圍與三個交付階段。
2. 核心設計採用 §18.1 已確認決策；若改變其中任何一項，須先做需求及設計影響分析。
3. 提供首版分類、UOM、商品屬性及內部條碼政策樣本；SKU Code 沒有固定格式。
4. 確認採購、庫存、銷售／POS 模組對 SKU 的必要欄位及狀態語意。
5. 完成 §18.2 所列非需求決策類的上線前置工作。
6. 由 BA、業務 Owner、開發及 QA 共同檢視需求編號、業務規則與驗收準則。

簽核後的新增或改動需求應保留版本、提出人、原因、影響範圍及批准結果，避免商品主資料與下游模組產生不一致定義。

# Supplier Management Aligned Requirement Specification

## Harness Control

| Field | Value |
| --- | --- |
| Mode | `REVIEW_AND_ALIGN` |
| Canonical path | `docs/supplier_management/01_requirement_spec.md` |
| Alignment baseline | `origin/main` at `ab13881`（initial recovery point：`6cb50f5`） |
| Alignment date | 2026-09-11 |
| Provenance | Existing business baseline plus explicitly approved decisions `HD-001` and `HD-002` |

This file is the single normative Supplier Management requirement baseline. Existing category IDs remain stable for business history; the following one-to-one aliases provide Harness-compatible functional IDs without changing priority or meaning.

| Canonical IDs | Existing IDs | Source family |
| --- | --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010 | FR-LIST-001～010 | §8.1 |
| FR-011, FR-012, FR-013, FR-014, FR-015 | FR-VIEW-001～005 | §8.2 |
| FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023 | FR-CREATE-001～008 | §8.3 |
| FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030 | FR-EDIT-001～007 | §8.4 |
| FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038 | FR-STATUS-001～008 | §8.5 |
| FR-039, FR-040, FR-041, FR-042, FR-043, FR-044 | FR-PARTY-001～006 | §8.6 |
| FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051 | FR-BANK-001～007 | §8.7 |
| FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058 | FR-APPROVAL-001～007 | §8.8 |
| FR-059, FR-060, FR-061, FR-062, FR-063, FR-064 | FR-SET-001～006 | §8.9 |
| FR-065, FR-066, FR-067, FR-068, FR-069, FR-070 | FR-SKU-001～006 | §8.10 |
| FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080 | FR-IMPORT-001～010 | §8.11 |
| FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087 | FR-AUDIT-001～007 | §8.12 |

`BR-001..BR-032`、`AC-001..AC-040`、`NFR-001..NFR-010`及`SEC-001..SEC-013` retain their original identifiers. `NFR-011` adopts the already-approved ERP-wide recovery objective. `SEC-014` records the system-admin decision approved on 2026-09-11.

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Supplier Management 業務需求書 |
| 文件版本 | 1.0 Aligned |
| 文件日期 | 2026-09-11 |
| 文件狀態 | Harness對標完成；尚未實作或驗收 |
| 適用系統 | ERP App |
| 適用組織 | 單一公司 |
| 主要範圍 | 供應商主資料、聯絡及付款預設、銀行資料、狀態、審批配置、匯入匯出及稽核 |

### 0.1 文件目的

本文件定義 ERP Supplier Management（供應商管理）模組應滿足的業務需求，作為業務確認、技術設計、開發、測試、驗收、上線及後續變更控制的共同基準。

本文件描述系統需要支援的業務能力、資料規則、權限、流程及驗收結果，不直接指定資料庫表、API 路徑、前端元件或程式架構。技術實作應在本文件簽核後另行設計。

### 0.2 需求背景

本 ERP 服務化妝品、零食、健康食品及飲品等零售消耗品業務。採購、收貨、退貨、應付帳款及付款等流程都需要引用一致、有效且可追溯的供應商主資料。若供應商資料分散或缺乏狀態控制，容易出現重複建檔、向已停止合作的供應商下單、付款資料被未授權查看或修改，以及歷史交易無法正確追溯等風險。

Supplier Management 將建立單一供應商主資料來源，同時保持採購彈性：採購人員可以從全部有效供應商中選擇，不必先建立強制的 Supplier－SKU 白名單；既有供貨紀錄及首選標記只用於搜尋與排序輔助。

### 0.3 版本紀錄

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 0.1 Draft | 2026-09-04 | 根據業務訪談建立供應商主資料、權限、審批配置、軟性 SKU 關聯、匯入匯出及生命週期需求。 |
| 1.0 Aligned | 2026-09-11 | 加入Harness追溯ID；確認system-admin最高權限；Currency／Payment Term改由共用Business Master擁有；採用ERP統一RTO／RPO。 |

---

## 1. 業務目標與成功指標

### 1.1 業務目標

| 編號 | 目標 |
| --- | --- |
| OBJ-01 | 建立單一、可靠且可稽核的供應商主資料來源。 |
| OBJ-02 | 讓採購、收貨、退貨、應付帳款及付款模組使用一致的 Supplier ID、名稱及狀態。 |
| OBJ-03 | 支援供應商完整的新增、查詢、修改、狀態控制、封存及受控刪除。 |
| OBJ-04 | 以最低必要欄位快速建立有效供應商，避免不必要的建檔阻力。 |
| OBJ-05 | 以可配置方式控制新供應商是否需要另一人審批，預設保持簡化流程。 |
| OBJ-06 | 保護銀行帳戶等敏感資料，將其查看及維護權限與一般供應商權限分離。 |
| OBJ-07 | 提供 Supplier－SKU 軟性供貨關係及歷史排序依據，不限制採購人員選擇新的有效供應商。 |
| OBJ-08 | 支援一般供應商資料批量導入、維護及匯出，降低資料轉移及大量建檔成本。 |

### 1.2 建議成功指標

| 編號 | 指標 | 建議目標 |
| --- | --- | --- |
| KPI-01 | 有效供應商最低必填資料完整率 | 100% |
| KPI-02 | 重複有效 Supplier Code | 0 |
| KPI-03 | 已填寫的供應商法定識別資料重複且未被識別 | 0 |
| KPI-04 | 供應商狀態、銀行資料及審批變更可追溯率 | 100% |
| KPI-05 | 以 Supplier Code 或名稱進行一般搜尋的回應時間 | 95% 請求在 2 秒內完成 |
| KPI-06 | 合法 CSV 資料列匯入成功率 | 99.5% 以上；錯誤列必須可辨識及修正 |
| KPI-07 | 未獲授權使用者取得完整銀行帳號的事件 | 0 |

KPI 數值屬建議基線，正式上線前須由業務負責人、資訊安全及技術團隊確認。

---

## 2. 範圍

### 2.1 本期範圍

- 供應商主資料的建立、查詢、修改、啟用、暫停、封鎖、封存、還原及有限條件下永久刪除。
- 人工輸入且全系統唯一的 Supplier Code。
- 供應商名稱、別名、識別資料、聯絡方式、地址及聯絡人管理。
- 預設交易幣別及預設付款條件管理。
- 多個選填銀行帳戶、預設帳戶、遮罩顯示及獨立銀行資料權限。
- 可配置的新供應商啟用審批流程；預設不需審批。
- Supplier Management 獨立參數設定功能及日後增加參數的擴充入口。
- Supplier－SKU 軟性供貨關係、首選／備選提示及既有供貨紀錄排序整合。
- 供應商列表、搜尋、篩選、排序、分頁、詳情及變更歷史。
- 一般供應商主資料的 CSV 批量匯入及匯出。
- 供應商資料、狀態、審批、設定及銀行資料操作的完整稽核。
- 供採購、收貨、退貨、應付帳款、付款及報表模組查詢供應商主資料與狀態。

### 2.2 本期不包含

- 採購申請、詢價、報價比較、採購訂單及採購合約交易。
- 收貨、驗收、退貨及品質檢查交易。
- 應付帳款、付款指示、銀行付款檔、匯率及外幣結算。
- 實際採購價、報價歷史、價格有效期及成本核算。
- 供應商績效評分，例如準時交貨率、品質合格率、退貨率或人工評級。
- 供應商合約、牌照、認證、資格文件、附件有效期及到期提醒。
- 強制 Supplier－SKU 白名單或未預設關聯便禁止採購的規則。
- 供應商入口網站、自助註冊、電子招標或外部供應商協作平台。
- 多公司、多法人或多租戶資料隔離。
- 銀行資料批量匯出、批量匯入及銀行資料變更的雙人審批；日後如需要須另行確認。

### 2.3 上下游依賴

| 系統／模組 | 關係 |
| --- | --- |
| 用戶、角色與權限 | 提供供應商查看、維護、審批、銀行資料及設定權限。 |
| Item Management | 提供正式 SKU ID、SKU Code、採購 UOM 及商品狀態。 |
| Purchasing | 從有效供應商中選擇供應商，形成供貨／採購紀錄並使用預設幣別及付款條件。 |
| Receiving／Returns | 依 Supplier ID 保留收貨、退貨及品質事件關聯。 |
| Accounts Payable／Payment | 使用供應商付款條件及獲授權的銀行資料；實際付款由財務模組控制。 |
| Currency／Finance Settings | 提供可用幣別及付款條件目錄；匯率不由本模組維護。 |
| 稽核 | 記錄主資料、狀態、審批、參數及敏感資料操作。 |
| 報表 | 依供應商、狀態、幣別及交易關係彙總。 |

---

## 3. 名詞定義

| 名詞 | 定義 |
| --- | --- |
| Supplier | 一個簽約或收款的法律實體。系統不強制區分公司或個人供應商。 |
| Supplier ID | 系統產生、不可重用的內部識別碼，供所有業務關聯使用。 |
| Supplier Code | 建檔人員人工輸入、全公司唯一的業務識別碼。 |
| Supplier Site／Address | 同一 Supplier 下的註冊、辦公、訂購、退貨或其他業務地址。 |
| Contact | Supplier 下的聯絡人，可依採購、銷售、財務或一般聯絡用途分類。 |
| Identifier | 商業登記號、公司註冊號、稅務識別號或其他由國家／地區簽發的識別資料。 |
| Active Supplier | 可被選入新的採購或其他獲授權交易的有效供應商。 |
| Suspended Supplier | 暫時停止新合作、可在填寫原因後恢復的供應商。 |
| Blocked Supplier | 因重大品質、合規或商業原因被封鎖，只能由較高權限解除。 |
| Archived Supplier | 不再日常使用、預設不在列表及新交易選擇器中顯示，但歷史仍可查。 |
| Soft Supplier－SKU Relationship | 供應商與 SKU 的非強制供貨關係，用於提示、排序和保存對照，不構成採購白名單。 |
| Supplier Approval | 當相關參數開啟時，由建檔人指定另一名具有審批權限的人員批准新供應商啟用。 |

---

## 4. 角色與責任

| 角色 | 主要責任 | 典型權限 |
| --- | --- | --- |
| 供應商資料查閱者 | 查看一般供應商列表、詳情及狀態。 | `supplier.view` |
| 供應商管理員 | 建立及維護一般主資料、聯絡人、地址、識別資料及一般狀態。 | `supplier.view`＋`supplier.mgmt` |
| 供應商審批人 | 審批新供應商啟用申請及解除封鎖。 | `supplier.view`＋`supplier.approval` |
| 銀行資料查閱者 | 在業務需要下查看完整銀行資料。 | `supplier.view`＋`supplier.bank.view` |
| 銀行資料管理員 | 新增、修改、設定預設及停用銀行帳戶。 | `supplier.view`＋`supplier.bank.view`＋`supplier.bank.mgmt` |
| 供應商設定管理員 | 維護 Supplier Management 參數。 | `supplier.view`＋`supplier.settings` |
| 採購人員 | 在採購流程內查找有效供應商及查看必要的供貨資訊。 | 採購模組權限；不因此取得供應商維護權限 |
| 財務人員 | 在應付／付款流程使用付款條件及經授權的銀行資料。 | 財務模組權限及相應銀行資料權限 |
| 系統管理員 | 系統最高權限及break-glass管理；可查看及維護完整銀行資料，但仍須重新認證、稽核及告警。 | 受保護的`system-admin`角色，自動取得全部Supplier權限 |

權限必須由後端執行，不可只依賴前端隱藏按鈕。`supplier.mgmt` 不自動包含 `supplier.approval`、`supplier.bank.view`、`supplier.bank.mgmt` 或 `supplier.settings`。

---

## 5. 核心業務原則

1. **Supplier 代表簽約／收款實體。** 法律名稱、付款對象或銀行帳戶所屬法律實體不同時，原則上應建立不同 Supplier；同一實體的多個辦公室、地址及聯絡人則放在同一 Supplier 下。
2. **不區分公司與個人流程。** 系統不建立強制 Supplier Type，避免沒有實際流程差異的資料分支。
3. **穩定識別。** 所有交易以 Supplier ID 關聯；Supplier Code 及名稱只用於搜尋、顯示及外部交換。
4. **最低資料即可啟用。** Supplier Code、供應商名稱及預設交易幣別完整時即可啟用；地址、聯絡人、付款條件、識別資料及銀行資料均可後補。
5. **審批由參數控制。** 新供應商啟用審批預設關閉；開啟後必須由建檔人指定另一名具有 `supplier.approval` 權限的人員批准。
6. **供應關係不作強制白名單。** 有效供應商即具備被採購選擇的資格；Supplier－SKU 關係只用於提示、排序及保存對照。
7. **敏感資料最小權限。** 完整銀行資料只向具獨立銀行權限的使用者及最高權限`system-admin`顯示或開放修改；`system-admin`不繞過重新認證、遮罩、稽核或告警。
8. **停用不破壞歷史。** 暫停、封鎖及封存只限制新的業務使用，既有交易和稽核仍須正常顯示。
9. **已引用資料不可永久刪除。** 只有從未被任何資料引用的 Draft Supplier 才可永久刪除。
10. **所有渠道規則一致。** UI、CSV 匯入及整合介面須使用相同的唯一性、狀態、權限及審批規則。
11. **關鍵操作可追溯。** 啟用、拒絕、狀態、銀行資料、設定及永久刪除均須留下不可由一般使用者修改的稽核記錄。

---

## 6. 資料概念模型

### 6.1 關係概覽

```text
Supplier
  ├──< Address / Site
  ├──< Contact
  ├──< Identifier
  ├──< Bank Account
  ├──< Approval Request
  ├──< Supplier-SKU Soft Relationship >── SKU
  └──< Audit History

Supplier Settings ── controls ──> Activation Approval Flow
Business Master Currency／Payment Term ── referenced by ──> Supplier
```

### 6.2 Supplier 主資料

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Supplier ID | 系統 | 不可重用的內部識別碼。 |
| Supplier Code | 是 | 人工輸入；全公司不分大小寫唯一；不強制格式。 |
| Supplier Name | 是 | 法律或主要業務名稱；去除首尾空白後 1–190 字元。 |
| Trading／Display Name | 否 | 日常顯示別名；不得取代 Supplier Name。 |
| Default Currency | 是 | 從系統啟用的幣別中選擇，可為 HKD 或外幣。 |
| Default Payment Term | 否 | 從有效付款條件目錄選擇；未填時採購流程應提示。 |
| Website | 否 | 有填寫時須驗證為可接受的 URL。 |
| General Phone／Email | 否 | 可作一般聯絡資料；不取代 Contact 明細。 |
| Notes | 否 | 一般內部備註，不得保存密碼、完整支付憑證或不必要的敏感資料。 |
| Status | 是 | `draft`、`pending_approval`、`active`、`suspended`、`blocked`、`archived`。 |
| Created／Updated | 系統 | 保存時間、操作者及資料版本。 |

系統應顯示資料完整度或缺項提示，例如沒有主要聯絡人、地址、付款條件或銀行資料，但不得把這些提示變成啟用阻擋條件。

### 6.3 地址與地點

- 一個 Supplier 可有多個地址。
- 地址可標記用途，例如註冊、辦公、訂購、退貨、付款通訊或其他。
- 每種用途可指定一個主要地址；同一地址可同時具有多個用途。
- 地址至少可保存名稱、地址行、城市、州／省、郵遞區號、國家／地區、電話及備註；各欄位按所選國家／地區作合理驗證。
- 地址均為選填；沒有地址不阻止供應商啟用。
- 已被交易快照引用的地址不可從歷史交易中消失；修改地址不得回寫既有單據的地址快照。
- 地址可停用；被引用的地址不可物理刪除，只可停止新用途。

### 6.4 聯絡人

- 一個 Supplier 可有多個聯絡人。
- 聯絡人可標記用途，例如一般、採購／訂單、銷售、財務／應付、退貨或緊急聯絡。
- 每種用途可指定一名主要聯絡人，但主要聯絡人不是供應商啟用必填。
- 聯絡人至少可保存姓名、職位／部門、電話、流動電話、Email、語言偏好、用途、狀態及備註。
- Email 或電話有填寫時須通過基本格式驗證；系統不得猜測或自動改寫實際聯絡值。
- 離職或不再使用的聯絡人應停用而非破壞歷史；聯絡人變更不回寫歷史單據。

### 6.5 法定及業務識別資料

- 可保存公司註冊號、商業登記號、稅務識別號及其他識別類型。
- 所有識別資料均為選填，不是啟用必要條件。
- 每筆識別資料須保存識別類型、簽發國家／地區、證號及可選備註。
- 有填寫時，`識別類型＋簽發國家／地區＋正規化證號` 必須在全公司唯一。
- Supplier Name 重複只產生疑似重複警告，不直接阻止建立。
- 識別資料的格式規則不應假設所有供應商都使用香港證號；可按識別類型及地區驗證。

### 6.6 預設幣別與付款條件

- 每個 Active Supplier 必須有一個有效的預設交易幣別。
- 預設幣別可為 HKD 或系統幣別目錄中已啟用的外幣。
- Supplier Management 只保存預設值；採購單能否覆寫、使用哪個匯率及如何結算由 Purchasing／Finance 決定。
- 預設付款條件為選填，可包括即付、貨到付款、月結 30／60／90 天或其他可配置條件。
- 付款條件被停用後不可再指派給新 Supplier，但既有 Supplier 及歷史交易仍可顯示原值；系統應提示管理員選擇替代值。
- 修改預設幣別或付款條件不得改變既有交易。

### 6.7 銀行帳戶

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Account Holder Name | 是（新增帳戶時） | 應與收款實體一致；不一致時顯示確認提示。 |
| Bank Name | 是（新增帳戶時） | 銀行顯示名稱。 |
| Bank Country／Region | 否 | 用於判斷本地或國際付款資料。 |
| Bank／Branch Code | 否 | 按所在地區需要保存。 |
| Account Number／IBAN | 是（新增帳戶時） | 敏感欄位；一般畫面及稽核摘要須遮罩。 |
| SWIFT／BIC | 否 | 有填寫時須執行基本格式驗證。 |
| Account Currency | 否 | 可標示帳戶主要收款幣別。 |
| Is Default | 是 | 一個 Supplier 同一時間最多一個有效預設帳戶；亦允許沒有預設帳戶。 |
| Status | 是 | `active` 或 `inactive`；被交易引用後不得永久刪除。 |

- 銀行資料整體為選填；沒有銀行帳戶不影響 Supplier 啟用或採購資格。
- 一個 Supplier 可有多個銀行帳戶並指定一個預設帳戶。
- 只有 `supplier.bank.view` 可查看完整帳戶資料；其他使用者只可看到必要的遮罩資料，例如銀行名稱及帳號末四位。
- 只有 `supplier.bank.mgmt` 可新增、修改、停用或更改預設帳戶，且管理權限必須同時具備查看權限。
- 系統須對相同 Supplier 的疑似重複帳戶作阻擋；相同帳戶出現在不同 Supplier 時須提出高風險警告，但不在無業務判斷下自動合併。
- 銀行帳戶被停用後不得用於新的付款指示；已存在付款或單據仍保存當時資料。
- 一般搜尋、一般 CSV 匯出、通知及日誌不得暴露完整帳號。
- 本期銀行資料修改不設雙人審批，但每次新增、修改、停用、查看完整值及匯出嘗試均須記錄稽核。日後可透過 Supplier Settings 增加獨立審批參數。

### 6.8 Supplier－SKU 軟性供貨關係

- 採購人員可從全部 Active Supplier 中選擇供應商，不要求目標 SKU 已預先建立供貨關係。
- 可人工標記 Supplier 對某 SKU 為 `preferred`、`alternative` 或 `stopped`；其中 `stopped` 只表示該供貨關係停止，不等同封鎖整個 Supplier。
- 採購或收貨交易完成後，可由 Purchasing 自動建立或更新供貨紀錄，不要求供應商管理員預先配置。
- 軟性關係可保存 Supplier Item Code、Supplier Item Name、採購 UOM、MOQ、一般交貨期及首選標記；實際價格及合約有效期不屬本模組。
- 搜尋供應商時，有該 SKU 供貨紀錄、最近交易或首選標記者可優先顯示，但不得隱藏其他 Active Supplier。
- 排序依據須向使用者清楚標示，避免把「排在前面」誤解為唯一允許選擇。
- 相同 Supplier Item Code 在同一 Supplier 下不得同時指向多個有效 SKU；發現疑似重複時須阻止儲存。
- SKU 或 Supplier 被停用、封鎖或封存後，軟性關係保留作歷史，但不可令無效對象重新進入新交易。

---

## 7. 狀態、生命週期與審批

### 7.1 狀態定義

| 狀態 | 可編輯 | 可用於新採購 | 可進行啟用審批 | 歷史可見 |
| --- | --- | --- | --- | --- |
| Draft | 是 | 否 | 是 | 是 |
| Pending Approval | 僅允許撤回或有限修正 | 否 | 審批中 | 是 |
| Active | 受控 | 是 | 不適用 | 是 |
| Suspended | 是 | 否 | 不適用 | 是 |
| Blocked | 高度受控 | 否 | 解除須審批權限 | 是 |
| Archived | 否；先還原 | 否 | 不適用 | 是 |

### 7.2 狀態轉換

```text
Draft ── approval OFF / direct activation ──> Active
Draft ── approval ON / submit ──> Pending Approval
Pending Approval ── approve ──> Active
Pending Approval ── reject / withdraw / invalidated ──> Draft

Active ── suspend ──> Suspended ── reactivate ──> Active
Active / Suspended ── block ──> Blocked
Blocked ── authorised release ──> Suspended

Draft ── unreferenced only ──> Delete
Draft / Active / Suspended ──> Archived
Archived ── restore ──> Suspended
```

- Draft Supplier 只有在從未被任何資料引用時才可永久刪除。
- Active 前只強制要求 Supplier Code、Supplier Name 及有效 Default Currency。
- `suspended` 用於暫時停止新合作，可由具 `supplier.mgmt` 權限者在填寫原因後恢復為 Active。
- `blocked` 用於重大品質、合規、詐騙或商業風險；封鎖及解除均須填寫原因，解除只允許 `supplier.approval`。
- 封鎖解除後先回到 Suspended，由管理員確認資料及合作條件後再轉 Active，避免自動恢復採購資格。
- Archived Supplier 還原後先進入 Suspended，不可直接 Active。
- 有未完成採購、收貨、退貨或付款流程時，封存操作須顯示影響並按下游規則阻擋或要求先完成處理。
- 所有狀態變更均不修改歷史交易的 Supplier 快照。

### 7.3 新供應商啟用審批參數

| 項目 | 規則 |
| --- | --- |
| 參數名稱 | 新供應商啟用需要審批 |
| 預設值 | 關閉 |
| 關閉時 | 具 `supplier.mgmt` 權限的建檔人可在資料完整後直接啟用。 |
| 開啟時 | 建檔人須提交申請並指定一名具 `supplier.approval` 權限的其他使用者。 |
| 生效範圍 | 單一公司全域。 |
| 稽核 | 記錄舊值、新值、操作者、時間及原因。 |

- 建檔人不可選擇自己作為審批人，即使同時具有 `supplier.approval`。
- 只有目前啟用且具有 `supplier.approval` 的使用者可被選擇。
- 審批人可批准或拒絕；拒絕必須填寫原因，Supplier 返回 Draft。
- 建檔人可在審批完成前撤回申請並返回 Draft。
- Pending Approval 期間若最低必填資料或其他關鍵資料被修改，原申請須失效並重新提交，避免批准過時內容。
- 審批人失去權限或不可用時，申請不得自動批准；建檔人可撤回後重新選擇審批人，或由有權限管理員重新指派。
- 參數變更不追溯改變已完成的審批結果；進行中的申請按提交時規則完成或撤回，不可被自動批准。

### 7.4 Supplier Settings 擴充原則

- Supplier Management 提供獨立的設定頁面，不把參數散落在供應商表單。
- 本期唯一已確認的流程參數為「新供應商啟用需要審批」。
- 設定結構應允許日後增加銀行變更審批、資料完整度門檻或其他經業務確認的參數，但不得預先啟用未確認規則。
- 每項參數須有名稱、說明、預設值、目前值、影響範圍及最後修改資訊。
- 修改前須顯示業務影響，修改後立即套用於新操作；不得無聲修改進行中或歷史流程。

---

## 8. 功能需求

### 8.1 列表、搜尋與篩選

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-LIST-001 | Must | 系統須提供 server-side 分頁的 Supplier 列表，預設不顯示 Archived。 |
| FR-LIST-002 | Must | 可用完整或部分 Supplier Code、Supplier Name、Display Name、識別號、電話及 Email 搜尋。 |
| FR-LIST-003 | Must | Supplier Code 及名稱搜尋不區分英文字母大小寫，並忽略首尾空白。 |
| FR-LIST-004 | Must | 可依狀態、預設幣別、付款條件、是否缺少主要聯絡人、建立／更新日期篩選。 |
| FR-LIST-005 | Must | 可依 Supplier Code、名稱、狀態及更新時間排序。 |
| FR-LIST-006 | Must | 列表顯示 Supplier Code、名稱、預設幣別、付款條件、主要聯絡方式、狀態及更新時間。 |
| FR-LIST-007 | Must | 沒有銀行查看權限時，列表不得顯示完整銀行帳號或可推導完整值的資料。 |
| FR-LIST-008 | Should | 可從指定 SKU 的採購流程進入 Supplier 查找，並把有供貨紀錄或首選標記者排前。 |
| FR-LIST-009 | Should | 可保存常用篩選或由 URL 保留查詢條件。 |
| FR-LIST-010 | Must | 空結果、載入中、系統錯誤及無權限狀態須清楚區分。 |

### 8.2 查看詳情

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-VIEW-001 | Must | Supplier 詳情須顯示一般主資料、狀態、地址、聯絡人、識別資料及付款預設。 |
| FR-VIEW-002 | Must | 銀行資料按權限顯示完整或遮罩內容。 |
| FR-VIEW-003 | Must | 有權限者可查看變更歷史，包括操作者、時間、動作、原因及適當遮罩的前後值。 |
| FR-VIEW-004 | Should | 下游模組存在時，可顯示採購、收貨、應付及 Supplier－SKU 關係摘要或連結，但不得在本模組重算交易結果。 |
| FR-VIEW-005 | Must | Draft、Pending、Suspended、Blocked 及 Archived 須有明顯狀態標示和不可採購提示。 |

### 8.3 新增及啟用 Supplier

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-CREATE-001 | Must | `supplier.mgmt` 使用者可建立 Draft Supplier。 |
| FR-CREATE-002 | Must | Supplier Code 由使用者人工輸入，不自動產生亦不強制指定格式。 |
| FR-CREATE-003 | Must | 儲存前驗證 Supplier Code 唯一性及已填寫識別資料唯一性。 |
| FR-CREATE-004 | Must | 發現相同或高度相似 Supplier Name 時顯示警告及可能重複記錄，但名稱本身不作唯一限制。 |
| FR-CREATE-005 | Must | 只有 Supplier Code、Supplier Name 及 Default Currency 為啟用最低必填資料。 |
| FR-CREATE-006 | Must | 審批參數關閉時，建檔人可直接啟用完整的 Draft Supplier。 |
| FR-CREATE-007 | Must | 審批參數開啟時，建檔人須指定合資格的另一名審批人並提交申請。 |
| FR-CREATE-008 | Must | 啟用成功或提交成功後須顯示 Supplier Code、狀態及下一步。 |

### 8.4 修改一般資料

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-EDIT-001 | Must | `supplier.mgmt` 可修改一般主資料、地址、聯絡人、識別資料、預設幣別及付款條件。 |
| FR-EDIT-002 | Must | Supplier Code 在未發生任何引用前可受控修正；發生引用後一般介面不得修改。 |
| FR-EDIT-003 | Must | 修改時重新執行唯一性、格式、狀態及跨欄位驗證。 |
| FR-EDIT-004 | Must | 使用資料版本或等效機制，防止兩人同時編輯時後儲存者無聲覆蓋前者。 |
| FR-EDIT-005 | Must | 關鍵識別資料、預設幣別、狀態及 Supplier Code 特批修正須記錄原因及前後值。 |
| FR-EDIT-006 | Should | 離開有未儲存變更的表單前提示使用者。 |
| FR-EDIT-007 | Must | 修改 Supplier 不得回寫既有交易的名稱、地址、幣別、付款條件或銀行快照。 |

### 8.5 暫停、封鎖、封存、刪除及還原

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-STATUS-001 | Must | Suspended、Blocked 及 Archived Supplier 不得加入新的採購或其他新交易。 |
| FR-STATUS-002 | Must | 暫停、封鎖、解除封鎖、封存及還原均須填寫原因並二次確認。 |
| FR-STATUS-003 | Must | 封鎖及解除封鎖須由具 `supplier.approval` 權限者執行。 |
| FR-STATUS-004 | Must | 封存前顯示未完成交易或其他阻擋項；不得留下未說明的流程中斷。 |
| FR-STATUS-005 | Must | 已被引用或曾經啟用的 Supplier 不可永久刪除。 |
| FR-STATUS-006 | Must | 只有未被任何資料引用的 Draft Supplier 可由有權限者永久刪除。 |
| FR-STATUS-007 | Must | Archived 預設不出現在日常列表或新交易選擇器，但可經篩選查回。 |
| FR-STATUS-008 | Must | 還原 Archived Supplier 時進入 Suspended，重新檢查後才可啟用。 |

### 8.6 地址、聯絡人及識別資料

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-PARTY-001 | Must | 可新增、修改、停用及排序多個地址和聯絡人。 |
| FR-PARTY-002 | Must | 每種地址或聯絡用途最多一個主要記錄。 |
| FR-PARTY-003 | Must | 設定新的主要記錄時，原主要記錄須在同一操作中取消主要標記。 |
| FR-PARTY-004 | Must | 已引用的地址、聯絡人及識別資料不可破壞歷史語意。 |
| FR-PARTY-005 | Must | 識別資料有值時按類型、國家／地區及證號檢查唯一。 |
| FR-PARTY-006 | Should | 顯示缺少主要聯絡資料的完整度提示，但不阻止 Supplier 啟用。 |

### 8.7 銀行資料

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-BANK-001 | Must | `supplier.bank.mgmt` 可新增、修改、停用及設定預設銀行帳戶。 |
| FR-BANK-002 | Must | `supplier.bank.view` 才可查看完整帳號；其他使用者只能查看遮罩值。 |
| FR-BANK-003 | Must | 同一 Supplier 最多一個有效預設銀行帳戶。 |
| FR-BANK-004 | Must | 銀行資料為選填，缺少銀行資料不得阻止供應商啟用。 |
| FR-BANK-005 | Must | 銀行帳戶被付款或其他資料引用後不可永久刪除，只可停用。 |
| FR-BANK-006 | Must | 新增、修改、停用、查看完整值及更改預設帳戶均須稽核。 |
| FR-BANK-007 | Must | 一般匯出、一般通知、應用日誌及錯誤訊息不得包含完整帳號。 |

### 8.8 啟用審批

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-APPROVAL-001 | Must | 系統按提交時的審批參數決定直接啟用或進入 Pending Approval。 |
| FR-APPROVAL-002 | Must | 需要審批時，建檔人必須選擇另一名有效且具有 `supplier.approval` 的使用者。 |
| FR-APPROVAL-003 | Must | 審批人可查看本次提交的最低必填資料及其他已填資料，但銀行完整值仍受銀行查看權限限制。 |
| FR-APPROVAL-004 | Must | 批准後 Supplier 進入 Active；拒絕後返回 Draft 並保存拒絕原因。 |
| FR-APPROVAL-005 | Must | 建檔人可在決定前撤回；關鍵資料變更使原申請失效並要求重提。 |
| FR-APPROVAL-006 | Must | 提交、撤回、批准、拒絕、重新指派及失效均須留下稽核及時間。 |
| FR-APPROVAL-007 | Must | 重複提交或重複批准請求不得造成多次狀態變更。 |

### 8.9 Supplier Settings

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-SET-001 | Must | 提供獨立 Supplier Settings 頁面。 |
| FR-SET-002 | Must | 只有 `supplier.settings` 可查看及修改設定；一般使用者不可透過直接呼叫繞過。 |
| FR-SET-003 | Must | 本期支援「新供應商啟用需要審批」布林參數，預設為關閉。 |
| FR-SET-004 | Must | 修改前顯示影響，修改時要求原因，修改後保存前後值及操作者。 |
| FR-SET-005 | Must | 設定變更不追溯改寫已完成或進行中的審批。 |
| FR-SET-006 | Should | 設定入口可容納日後新增參數，但未定義參數不得顯示或產生業務效果。 |

### 8.10 Supplier－SKU 關係與採購查找

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-SKU-001 | Must | 沒有 Supplier－SKU 關係時，採購人員仍可選擇任何 Active Supplier。 |
| FR-SKU-002 | Must | 有供貨紀錄或首選標記的 Supplier 可排前，但其他 Active Supplier 仍須可搜尋及選擇。 |
| FR-SKU-003 | Should | 可維護 Supplier Item Code、Supplier Item Name、採購 UOM、MOQ、交貨期及關係狀態。 |
| FR-SKU-004 | Should | Purchasing 可在交易完成後自動建立或更新供貨紀錄。 |
| FR-SKU-005 | Must | 軟性關係不得繞過 Supplier 或 SKU 自身的有效狀態。 |
| FR-SKU-006 | Must | 本模組不保存實際採購價、報價歷史或合約價格。 |

### 8.11 CSV 批量匯入及匯出

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-IMPORT-001 | Must | 提供含版本、欄位說明及範例的一般供應商 CSV 範本。 |
| FR-IMPORT-002 | Must | 匯入至少包含上傳、預檢、確認及結果下載步驟；預檢不得寫入正式資料。 |
| FR-IMPORT-003 | Must | 預檢逐列顯示新增、更新、警告或錯誤，並指出欄位與可理解原因。 |
| FR-IMPORT-004 | Must | 確認後以資料列為原子單位執行，合法列可成功、錯誤列失敗；不得留下單一 Supplier 的部分子資料。 |
| FR-IMPORT-005 | Must | 匯入結果提供總數、成功、失敗、略過及警告數，並可下載逐列結果。 |
| FR-IMPORT-006 | Must | 更新既有 Supplier 須以穩定 ID 或 Supplier Code 匹配，並套用相同唯一性及狀態規則。 |
| FR-IMPORT-007 | Must | 同一檔案或確認請求重送不得重複建立 Supplier。 |
| FR-IMPORT-008 | Must | 一般匯入及匯出不包含完整銀行資料。 |
| FR-IMPORT-009 | Must | 匯出須遵守當前篩選、使用者權限及敏感欄位遮罩。 |
| FR-IMPORT-010 | Should | 大型匯入在背景執行，使用者可查看進度及完成結果。 |

### 8.12 稽核與歷史

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-AUDIT-001 | Must | 記錄 Supplier、地址、聯絡人、識別資料、銀行帳戶、狀態、審批、設定及匯入事件。 |
| FR-AUDIT-002 | Must | 稽核至少包含時間、操作者、動作、對象 ID／Code、前後值、原因及 request ID。 |
| FR-AUDIT-003 | Must | 一般稽核不得保存完整銀行帳號、憑證、Token 或不必要個人資料。 |
| FR-AUDIT-004 | Must | 銀行資料稽核須標示哪些欄位被修改及遮罩後摘要，不在一般日誌複製敏感明文。 |
| FR-AUDIT-005 | Must | 業務資料修改與相應稽核須保持一致結果。 |
| FR-AUDIT-006 | Must | 一般使用者不可修改或刪除稽核歷史。 |
| FR-AUDIT-007 | Should | 可依 Supplier Code、操作者、動作及時間範圍查詢歷史。 |

---

## 9. 業務規則

| 編號 | 規則 |
| --- | --- |
| BR-001 | 系統只服務單一公司，Supplier Code 及識別資料唯一性均以全公司為範圍。 |
| BR-002 | 所有下游資料以 Supplier ID 關聯，不得以名稱或 Supplier Code 作永久外鍵。 |
| BR-003 | Supplier Code 人工輸入，不套用固定前綴或格式；去除首尾空白並忽略英文字母大小寫後須全域唯一。 |
| BR-004 | Supplier Code 的唯一性包含 Draft、Pending、Active、Suspended、Blocked 及 Archived。 |
| BR-005 | Supplier 發生任何引用後，一般介面不可修改 Supplier Code。 |
| BR-006 | Supplier 不強制區分公司或個人類型，兩者使用相同主資料及生命週期。 |
| BR-007 | Active Supplier 最低必填為 Supplier Code、Supplier Name 及有效 Default Currency。 |
| BR-008 | 地址、聯絡人、付款條件、識別資料及銀行資料均不屬啟用必要條件。 |
| BR-009 | Supplier Name 可重複，但系統須提示相同或高度相似的疑似重複資料。 |
| BR-010 | 識別資料有值時，類型、簽發國家／地區及正規化證號組合必須唯一。 |
| BR-011 | 審批參數預設關閉；關閉時具管理權限者可直接啟用。 |
| BR-012 | 審批參數開啟時，建檔人與審批人必須是不同的有效使用者，審批人須具有 `supplier.approval`。 |
| BR-013 | Pending Approval 的關鍵資料被修改後，原申請不得繼續批准。 |
| BR-014 | 只有 Active Supplier 可加入新的採購或其他新交易。 |
| BR-015 | Suspended、Blocked 及 Archived 不影響既有單據顯示及歷史查詢。 |
| BR-016 | Blocked 的封鎖及解除須填寫原因；解除後先進入 Suspended。 |
| BR-017 | Archived 還原後先進入 Suspended，不自動恢復採購資格。 |
| BR-018 | 只有從未被引用的 Draft Supplier 可永久刪除。 |
| BR-019 | Supplier 可有多個銀行帳戶，但同一時間最多一個有效預設帳戶。 |
| BR-020 | 未具銀行查看權限者不得透過列表、詳情、稽核、CSV、通知或錯誤訊息取得完整帳號。 |
| BR-021 | 銀行資料不是啟用或採購資格的必要條件。 |
| BR-022 | 一般 Supplier 管理權限不包含審批、銀行查看、銀行維護或設定權限。 |
| BR-023 | Supplier－SKU 關係為軟性關係，沒有關係記錄不得阻止選擇 Active Supplier。 |
| BR-024 | 首選或歷史供貨標記只影響顯示及排序，不可令無效 Supplier 或 SKU 變為可交易。 |
| BR-025 | 修改 Supplier 主資料、付款預設或銀行資料不得改寫既有交易快照。 |
| BR-026 | CSV 匯入、UI 及整合 API 必須套用相同驗證、權限及生命週期規則。 |
| BR-027 | 批量匯入採資料列級部分成功；每個 Supplier 及其該列子資料必須全有或全無。 |
| BR-028 | 一般 CSV 匯入及匯出不得包含完整銀行資料。 |
| BR-029 | 關鍵更新須檢查資料版本，版本不一致時拒絕無聲覆蓋。 |
| BR-030 | 所有時間以系統統一時區顯示及保存，沿用 ERP 的時間政策。 |
| BR-031 | 供應商名稱、地址及自由文字欄位須安全處理，不得執行腳本或危險標記。 |
| BR-032 | 新交易提交時須重新驗證 Supplier 狀態，不可只依賴畫面開啟時的查詢結果。 |

---

## 10. 使用者體驗要求

### 10.1 導航與頁面

- 左側菜單新增「供應商管理」入口，至少包含供應商列表、待我審批、匯入任務及供應商設定；入口按權限顯示。
- Supplier 詳情建議分為概覽、地址與聯絡人、付款設定、銀行資料、SKU 供貨關係及變更歷史。
- 沒有相應權限時，不顯示可推斷敏感資訊的銀行欄位、匯出入口或審批操作。
- Draft 頁面應持續顯示啟用最低條件及非阻擋的資料完整度提示。
- Pending Approval 須顯示提交人、指定審批人、提交時間及目前狀態。
- 高影響操作須顯示結果、要求原因並二次確認，不使用含糊的確認文案。
- 儲存或狀態操作完成後，須顯示可識別對象，例如「Supplier SUP-001 已暫停」。

### 10.2 搜尋與採購選擇

- 精確 Supplier Code 結果優先於名稱模糊匹配。
- 從 SKU 採購情境進入時，先顯示有供貨紀錄或首選標記的 Active Supplier，再顯示其餘 Active Supplier。
- 排序標籤須說明「首選」、「曾供貨」或「最近採購」，不得只以不透明分數排序。
- 使用者仍可搜尋並選擇未曾供應該 SKU 的其他 Active Supplier。
- Supplier 在使用者選擇後被停用時，交易提交必須明確拒絕並提示重新選擇。

### 10.3 可用性與無障礙

- 核心 CRUD、審批及搜尋須可使用鍵盤完成。
- 狀態不可只依顏色表達，須同時顯示文字或圖示標籤。
- 表單錯誤應靠近欄位顯示，並提供可由輔助技術識別的錯誤摘要。
- 完整銀行帳號的顯示應是有意識的操作，並提示該次查看會被記錄。
- 批量匯入錯誤須提供可下載、可定位原始列的結果。

---

## 11. 權限、安全與職責分離

| 編號 | 需求 |
| --- | --- |
| SEC-001 | 未登入使用者不可存取任何 Supplier Management 頁面或端點。 |
| SEC-002 | `supplier.view` 只允許查看一般供應商資料及適當遮罩的內容。 |
| SEC-003 | `supplier.mgmt` 允許一般資料 CRUD 及一般狀態操作，但不包含審批、銀行或設定能力。 |
| SEC-004 | `supplier.approval` 允許處理啟用審批、封鎖及解除封鎖；需要審批時不得自我批准。 |
| SEC-005 | `supplier.bank.view` 才可查看完整銀行資料；每次完整查看須記錄稽核。 |
| SEC-006 | `supplier.bank.mgmt` 允許銀行資料維護，並必須同時具備 `supplier.bank.view`。 |
| SEC-007 | `supplier.settings` 允許查看及修改 Supplier Settings，修改必須要求原因。 |
| SEC-008 | 採購及財務角色只能在其獲授權流程取得必要 Supplier 資料，不因此取得主資料維護能力。 |
| SEC-009 | 後端須阻止水平及垂直越權，前端隱藏不能取代授權。 |
| SEC-010 | 銀行資料在儲存、傳輸、備份、日誌、快取及匯出中須按敏感資料政策保護。 |
| SEC-011 | 一般稽核、錯誤追蹤及應用日誌不得保存完整銀行帳號。 |
| SEC-012 | 批量匯出及大量敏感資料存取必須記錄操作者、條件、時間及結果。 |
| SEC-013 | 永久刪除、封鎖、解除封鎖、銀行修改及設定修改須使用重新確認或等效高風險操作控制。 |
| SEC-014 | 受保護的`system-admin`是系統最高權限角色，自動取得全部Supplier權限，包括銀行查看及維護；敏感操作仍須使用相同重新認證、稽核、遮罩、禁止記錄明文及告警控制。 |

---

## 12. 整合需求

### 12.1 共通整合原則

- 下游系統使用 Supplier ID 關聯，並保存交易當時必要快照，例如 Supplier Code、名稱、地址、幣別及付款條件。
- 查詢結果按用途及權限只提供必要欄位；一般查找不得返回完整銀行資料。
- 新交易提交時重新驗證 Supplier 是否 Active。
- 供應商狀態變更後，下游新交易須立即或在明確且可接受的時限內拒絕。
- 整合建立及更新請求須具重送保護，避免建立重複 Supplier 或重複審批動作。

### 12.2 Item Management 整合

- Supplier－SKU 軟性關係必須引用正式 Supplier ID 及 SKU ID。
- SKU Code、Supplier Item Code 只作顯示、搜尋及外部交換，不取代 ID 關聯。
- SKU 停用或封存後保留歷史供貨關係，但不得在新採購中被選擇。
- Item Management 文件中延後的供應商對照能力，應以本文件的軟關聯及非白名單原則為準。

### 12.3 Purchasing 整合

- 建立新採購時可查找全部 Active Supplier。
- 目標 SKU 有歷史供貨或首選 Supplier 時，Purchasing 可優先排序，但不可因此排除其他 Active Supplier。
- 選擇 Supplier 後帶入 Default Currency 及 Default Payment Term；是否允許覆寫由 Purchasing 控制。
- 採購完成後可回傳供貨紀錄、最近交易時間及 Supplier－SKU 對照資料。
- 實際採購價、MOQ 是否強制、報價及交期承諾以採購交易為準。

### 12.4 Receiving／Returns 整合

- 收貨及退貨保留 Supplier ID 及交易時供應商快照。
- Supplier 後續被暫停、封鎖或封存不應阻止查詢或完成已存在的必要退貨／善後流程；具體例外由相應模組定義。
- 收貨和退貨資料可在日後作供應商績效來源，但本期不計算分數。

### 12.5 Accounts Payable／Payment 整合

- 應付流程使用交易當時的付款條件，不因 Supplier 預設修改而改變已入帳資料。
- Payment 只能向有權限使用者提供獲批准使用的有效銀行帳戶；Supplier Management 本身不發起付款。
- 銀行帳戶停用後不得用於新的付款指示，但既有付款歷史保留快照。
- 沒有銀行帳戶時，不影響 Supplier 啟用或採購；付款流程須自行提示缺少收款資料。

---

## 13. 非功能需求

### 13.1 效能與容量

| 編號 | 需求 |
| --- | --- |
| NFR-001 | 在最多 50 名同時在線使用者的正常混合負載下，一般列表及精確 Supplier Code 查詢的 p95 應少於 2 秒。 |
| NFR-002 | 列表使用 server-side 分頁，單頁預設 20、上限 100，沿用系統慣例。 |
| NFR-003 | 建議以 100,000 Supplier、每個 Supplier 20 個地址、50 個聯絡人及 10 個銀行帳戶作容量驗證上限。 |
| NFR-004 | 10,000 列一般 Supplier CSV 預檢及執行的系統處理時間合計應在 10 分鐘內完成，不計使用者停留時間。 |
| NFR-005 | Supplier－SKU 採購選擇器在 100,000 Supplier 基準下仍須符合一般搜尋 p95 目標。 |

上述容量為技術驗證基準而非預測實際數量，須在技術設計階段核對現有部署規模。

### 13.2 一致性與可靠性

| 編號 | 需求 |
| --- | --- |
| NFR-006 | Supplier 資料修改、狀態轉換、審批及稽核須保持一致結果。 |
| NFR-007 | 同時編輯衝突不得以最後寫入者無聲覆蓋處理。 |
| NFR-008 | 重複提交建立、匯入、審批及狀態請求不得造成重複或矛盾結果。 |
| NFR-009 | Supplier 主資料及設定須納入既有備份、還原及災難復原程序。 |
| NFR-010 | 下游查找不可因銀行資料服務或非必要摘要暫時不可用而暴露敏感資料或錯誤地開放無效 Supplier。 |
| NFR-011 | Supplier正式資料採用ERP統一災難復原目標：生產環境RTO不超過4小時、RPO不超過15分鐘，並以隔離還原及資料核對演練驗證。 |

### 13.3 隱私、安全與保留

- 銀行帳戶、部分識別資料及個人聯絡資料屬敏感資料，須遵循最小收集、最小顯示及最小權限原則。
- Supplier 主資料及其稽核在封存後至少保留 7 年；若財務、稅務或適用法規要求更長，以較長期限為準。
- CSV 原始檔及結果檔建議自工作完成日起保留 1 年，之後安全刪除；匯入摘要及稽核仍按至少 7 年保留。
- 永久刪除只適用於未被引用的 Draft Supplier；刪除時亦須清除未被引用的子資料並留下必要的刪除事件。
- 銀行帳號不得出現在分析追蹤參數、前端 URL、一般通知、應用日誌或未加密暫存檔。
- 備份及災難復原使用 ERP 統一政策，不建立未經確認的獨立週期。

### 13.4 相容性與可維護性

- 狀態、權限、錯誤代碼及欄位語意應在 Web UI、CSV 及整合介面保持一致。
- Supplier Settings 應可在不改變既有參數語意的情況下新增經批准的參數。
- 幣別、付款條件及國家／地區應引用系統共用目錄，避免不同模組各自維護。
- 日期、時間、數字及地址顯示須符合系統語系及時區設定。

---

## 14. 錯誤與例外處理

| 情境 | 系統行為 |
| --- | --- |
| Supplier Code 已存在 | 拒絕儲存，指出 Code 已使用；按權限提供可查看的衝突對象。 |
| Supplier Name 相同或高度相似 | 顯示疑似重複警告及候選資料，允許使用者確認後繼續。 |
| 識別資料重複 | 拒絕儲存並指出識別類型及地區，不洩漏不必要資料。 |
| Default Currency 已停用 | 阻止啟用或修改，提示選擇有效幣別。 |
| 審批人是建檔人或沒有權限 | 拒絕提交並要求重新選擇。 |
| Pending 資料在審批前被關鍵修改 | 原申請失效，不得批准舊版本；要求重新提交。 |
| 重複批准或申請已被他人處理 | 不重複改變狀態，回傳目前狀態及處理資訊。 |
| Supplier 在採購畫面開啟後被暫停／封鎖 | 提交交易時再次驗證並拒絕新交易。 |
| 無銀行查看權限要求完整帳號 | 拒絕並記錄未授權嘗試，不返回任何完整值。 |
| 嘗試刪除已引用 Supplier | 拒絕永久刪除，列出引用類型並提供狀態操作。 |
| 並發修改衝突 | 拒絕後提交者覆蓋，提示重新載入並保留可複製輸入。 |
| CSV 部分列錯誤 | 合法列按確認成功寫入，錯誤列不寫入並提供逐列結果。 |
| 匯入含銀行欄位 | 不接受敏感欄位並明確指出本期不支援，不能靜默忽略。 |

技術設計須為上述情境定義穩定錯誤代碼，供前端、CSV 結果及整合方處理。

---

## 15. 驗收準則

### 15.1 核心 CRUD 與唯一性

| 編號 | 驗收準則 |
| --- | --- |
| AC-001 | Given 具管理權限者輸入唯一 Supplier Code、名稱及有效幣別，When 儲存，Then 建立 Draft Supplier 並可在詳情和稽核中查到。 |
| AC-002 | Given 任一狀態已存在 `SUP-001`，When 建立 `sup-001`，Then 系統忽略大小寫後拒絕且不建立部分資料。 |
| AC-003 | Given 兩個 Supplier 名稱相同但 Code 不同，When 建立第二個，Then 系統顯示重複警告，但允許使用者確認合理原因後繼續。 |
| AC-004 | Given 已存在相同類型、地區及正規化證號，When 新增識別資料，Then 系統拒絕。 |
| AC-005 | Given Supplier 已被交易引用，When 嘗試修改 Supplier Code，Then 一般介面拒絕且既有 Code 不變。 |
| AC-006 | Given Supplier 尚未被引用，When 有權限者受控修正唯一 Code，Then 系統保存新值及完整稽核。 |

### 15.2 啟用與審批

| 編號 | 驗收準則 |
| --- | --- |
| AC-007 | Given 審批參數關閉且最低必填資料完整，When 建檔人啟用，Then Supplier 直接成為 Active 並記錄啟用事件。 |
| AC-008 | Given 審批參數開啟，When 建檔人提交，Then 必須選擇另一名具有 `supplier.approval` 的有效使用者，Supplier 進入 Pending Approval。 |
| AC-009 | Given 建檔人選擇自己或無審批權限者，When 提交，Then 系統拒絕且 Supplier 保持 Draft。 |
| AC-010 | Given 合法 Pending 申請，When 指定審批人批准，Then Supplier 成為 Active，並保存提交及批准資訊。 |
| AC-011 | Given 合法 Pending 申請，When 審批人填寫原因並拒絕，Then Supplier 返回 Draft，建檔人可看到原因。 |
| AC-012 | Given Pending Supplier 的名稱、Code 或幣別被修改，When 審批人嘗試批准原申請，Then 系統拒絕過時申請並要求重新提交。 |
| AC-013 | Given 審批參數由開啟改為關閉且已有 Pending 申請，When 設定保存，Then 進行中申請不會被自動批准。 |

### 15.3 狀態與刪除

| 編號 | 驗收準則 |
| --- | --- |
| AC-014 | Given Active Supplier，When 管理員填寫原因並暫停，Then Supplier 不再出現在新採購有效清單，但歷史仍可查。 |
| AC-015 | Given Blocked Supplier，When 沒有 `supplier.approval` 的使用者嘗試解除，Then 後端拒絕且狀態不變。 |
| AC-016 | Given 有審批權限者解除 Block，When 操作完成，Then Supplier 進入 Suspended 而非直接 Active。 |
| AC-017 | Given Archived Supplier，When 還原，Then Supplier 進入 Suspended，經再次確認後方可 Active。 |
| AC-018 | Given 從未被引用的 Draft Supplier，When 有權限者確認永久刪除，Then 資料被刪除並留下必要稽核事件。 |
| AC-019 | Given Supplier 曾啟用或已被引用，When 要求永久刪除，Then 系統拒絕並提供暫停、封鎖或封存選項。 |

### 15.4 地址、聯絡人、付款及銀行資料

| 編號 | 驗收準則 |
| --- | --- |
| AC-020 | Given Supplier 沒有地址、聯絡人、付款條件、識別資料及銀行資料，When 最低三項必填完整並啟用，Then 系統允許並只顯示完整度提示。 |
| AC-021 | Given 同一用途已有主要聯絡人，When 指定另一人為主要，Then 系統在同一操作取消原標記且只保留一名主要聯絡人。 |
| AC-022 | Given Default Payment Term 空白，When 啟用 Supplier，Then 系統允許；When 建立採購，Then 採購流程收到未設定提示。 |
| AC-023 | Given 使用者只有 `supplier.view`，When 查看銀行資料，Then 只能看到遮罩帳號；直接要求完整值亦被後端拒絕。 |
| AC-024 | Given 使用者具有 `supplier.bank.view`，When 主動查看完整帳號，Then 系統顯示完整值並記錄查看事件。 |
| AC-025 | Given 使用者沒有 `supplier.bank.mgmt`，When 嘗試新增或修改銀行資料，Then 後端拒絕且資料不變。 |
| AC-026 | Given Supplier 已有預設銀行帳戶，When 把另一帳戶設為預設，Then 原預設在同一操作取消且只剩一個有效預設。 |
| AC-027 | Given Supplier 沒有任何銀行帳戶，When 啟用或被加入採購，Then Supplier Management 不阻止操作。 |

### 15.5 Supplier－SKU 關係與整合

| 編號 | 驗收準則 |
| --- | --- |
| AC-028 | Given SKU 從未由 Supplier B 供應且 Supplier B 為 Active，When 採購人員搜尋，Then Supplier B 仍可被選擇。 |
| AC-029 | Given Supplier A 曾供應目標 SKU，When 開啟該 SKU 的供應商選擇器，Then Supplier A 優先顯示並標示排序原因。 |
| AC-030 | Given Supplier A 有首選關係但已 Suspended，When 建立新採購，Then Supplier A 不得因首選標記而成為可選。 |
| AC-031 | Given 採購向未有關係的 Active Supplier 完成交易，When Purchasing 回傳供貨紀錄，Then 系統可建立軟性 Supplier－SKU 關係且不更改 Supplier 狀態。 |
| AC-032 | Given Supplier 預設幣別或付款條件被修改，When 查閱既有採購單，Then 單據仍保留交易時的原值。 |

### 15.6 匯入、設定、權限及並發

| 編號 | 驗收準則 |
| --- | --- |
| AC-033 | Given CSV 同時包含合法及錯誤列，When 預檢並確認，Then 合法列按列完整寫入、錯誤列不寫入，結果可逐列下載。 |
| AC-034 | Given CSV 包含完整銀行帳號欄位，When 預檢，Then 系統明確拒絕該欄位，不把敏感資料寫入 Supplier 主檔。 |
| AC-035 | Given 同一匯入確認請求被重送，When 系統再次收到請求，Then 不建立重複 Supplier。 |
| AC-036 | Given 沒有 `supplier.settings` 的使用者，When 呼叫設定修改功能，Then 後端拒絕且參數不變。 |
| AC-037 | Given 設定管理員開啟啟用審批，When 保存，Then 新提交使用審批流程，設定前後值及原因可在稽核查到。 |
| AC-038 | Given 兩人讀取同一 Supplier 版本，When 第一人保存後第二人再保存，Then 第二人收到版本衝突且不覆蓋第一人的變更。 |
| AC-039 | Given 無一般管理權限者，When 直接呼叫 Supplier 寫入功能，Then 後端拒絕且無資料變更。 |
| AC-040 | Given 一般供應商 CSV 匯出，When 任意使用者下載，Then 檔案不包含完整銀行資料且匯出事件可稽核。 |

---

## 16. 資料建置與上線需求

### 16.1 初始設定

上線前至少須完成：

- 可用幣別清單及公司基礎幣別確認。
- 付款條件目錄及有效狀態確認。
- 地址用途、聯絡人用途及識別類型目錄確認。
- Supplier 狀態、狀態原因及角色權限配置。
- `新供應商啟用需要審批` 參數確認；未配置時必須使用預設關閉。
- 供應商一般資料及銀行資料權限分派與最小權限覆核。

### 16.2 舊資料導入

- 業務須提供來源與目標欄位 mapping，並明確指定 Supplier Code、名稱、幣別及狀態。
- 導入前先清理重複 Supplier Code、疑似重複名稱及重複識別資料。
- 名稱相似但無法確定是否同一法律實體時，不得由系統自動合併，須輸出例外清單供業務決定。
- 銀行資料不透過一般 CSV 導入；如需遷移，須另定安全、授權及核對方案。
- 正式導入前至少完成一次模擬導入、筆數核對、抽樣核對及回滾演練。
- 導入結果須核對來源總數、成功、失敗、略過、警告及目標總數。

### 16.3 上線控制

- 上線前凍結舊供應商主資料或定義增量補錄窗口。
- 完成備份及可驗證的還原方案。
- 先配置一般、審批、銀行及設定權限，再開放 Supplier Management。
- 完成建立、直接啟用、審批啟用、暫停、封鎖、銀行遮罩及採購拒絕的端到端 smoke test。
- 確認採購及財務模組在提交時會重新驗證 Supplier 狀態。

---

## 17. 優先級與建議交付階段

### Phase 1：核心 Supplier 主資料

- Supplier CRUD、人工 Code、名稱、幣別及付款條件。
- 多地址、多聯絡人及識別資料。
- Draft、Active、Suspended、Blocked、Archived 狀態與受控刪除。
- 搜尋、篩選、分頁、一般權限及稽核。
- 向下游提供 Active Supplier 查找能力。

### Phase 2：控制與敏感資料

- 獨立銀行查看／維護權限、遮罩、多帳戶及預設帳戶。
- Supplier Settings 及可配置啟用審批。
- Pending Approval、批准、拒絕、撤回及重新指派流程。
- 高風險操作及敏感資料存取稽核。

### Phase 3：營運效率及整合

- Supplier－SKU 軟性關係與採購歷史排序。
- 一般 Supplier CSV 預檢、部分成功匯入及匯出。
- 匯入工作、資料完整度篩選及下游摘要連結。

交付順序可以因依賴調整，但唯一性、狀態驗證、後端權限及稽核不可從相應功能中延後。

---

## 18. 已確認決策與待上線確認事項

### 18.1 已確認決策

| 編號 | 決策 | 業務影響 |
| --- | --- | --- |
| DEC-001 | Supplier－SKU 使用軟性關係，不作強制白名單。 | 採購可選任何 Active Supplier；歷史供貨及首選資料只作排序。 |
| DEC-002 | 新供應商啟用審批由 Supplier Settings 控制，預設關閉。 | 一般情況由建檔人直接啟用；開啟後須指定另一名審批人。 |
| DEC-003 | Supplier Settings 是模組內獨立功能，須保留日後增加參數的入口。 | 設定集中管理及稽核，但不預先實作未確認規則。 |
| DEC-004 | 一個 Supplier 代表一個簽約／收款法律實體。 | 同一實體可有多個地址及聯絡人；不同收款實體原則上分開建檔。 |
| DEC-005 | Supplier Code 人工輸入、沒有指定格式。 | 系統只執行基本安全、長度及全域唯一性驗證。 |
| DEC-006 | Supplier 發生交易後不可修改 Supplier Code。 | 保持下游單據及稽核識別穩定。 |
| DEC-007 | 銀行資料選填，可有多個帳戶及一個預設帳戶。 | 缺少銀行資料不阻止啟用或採購。 |
| DEC-008 | 銀行查看及維護使用獨立權限；受保護的`system-admin`作為系統最高權限自動取得這些權限。 | 一般Supplier管理員不自動取得完整銀行資料；system-admin仍須通過相同高強度認證、稽核及告警。 |
| DEC-009 | Supplier 需要預設交易幣別並支援外幣。 | 匯率及實際結算由 Purchasing／Finance 負責。 |
| DEC-010 | 預設付款條件選填。 | 未設定不阻止啟用，但採購流程應提示。 |
| DEC-011 | 狀態區分 Suspended 與 Blocked。 | 暫停可恢復；封鎖及解除需較高權限及原因。 |
| DEC-012 | 法定／稅務識別資料選填，有值時按類型、地區及證號唯一。 | 支援本地、海外及缺少標準證號的供應商。 |
| DEC-013 | Supplier Name 重複只作警告。 | 不會因合理同名而阻止建立，同時降低重複建檔風險。 |
| DEC-014 | 不區分公司及個人 Supplier Type。 | 所有供應商使用相同流程，避免不必要複雜度。 |
| DEC-015 | 啟用最低必填只有 Supplier Code、Supplier Name 及 Default Currency。 | 地址、聯絡、付款、識別及銀行資料可後補。 |
| DEC-016 | 採用六組獨立權限。 | 一般查看、管理、審批、銀行查看、銀行維護及設定可分開授權。 |
| DEC-017 | 本期不管理合約、牌照、認證及到期提醒。 | 不建立文件資格或自動停用流程。 |
| DEC-018 | 只有從未被引用的 Draft Supplier 可永久刪除。 | 其他 Supplier 以狀態及封存保留歷史。 |
| DEC-019 | 一般 Supplier 主資料支援 CSV 匯入及匯出。 | 銀行資料不包含在一般 CSV；匯入可按列部分成功。 |
| DEC-020 | 本期不提供供應商評分或績效管理。 | 日後待採購、收貨、退貨及品質資料成熟再設計。 |
| DEC-021 | Currency及Payment Term由共用Business Master foundation擁有；Supplier Management只讀取、驗證及引用。 | Supplier Settings不提供Currency／Payment Term新增、修改或停用，避免跨模組多重資料擁有者。 |

### 18.2 待技術設計及上線前確認

以下不改變已確認業務範圍，但須在設計或上線前定案：

- Supplier Code、名稱、地址、聯絡及備註欄位的實際最大長度與安全字元政策。
- 幣別、付款條件、地址用途、聯絡用途及識別類型的初始目錄值。
- 疑似重複名稱的比對方式及警告門檻。
- 銀行資料保護、金鑰管理、備份、遮罩及安全查看的技術方案。
- Supplier Code 在未引用前修正及永久刪除所需的具體高風險操作權限。
- 大型 CSV 工作門檻、檔案大小、最大列數及通知方式。
- 實際資料量、併發量及效能基準的最終驗收環境。
- 稽核、Supplier 主資料及 CSV 檔案保留期限的法務／合規核對。

---

## 19. 簽核建議

本文件建議由以下角色共同確認：

- 採購業務負責人：確認有效供應商、軟性 SKU 關係及採購選擇規則。
- 財務／應付帳款負責人：確認幣別、付款條件及銀行資料使用邊界。
- 資訊安全／系統管理負責人：確認敏感資料、權限拆分及稽核要求。
- Product Owner／業務負責人：確認範圍、優先級、審批預設及成功指標。
- 技術及 QA 負責人：確認需求可實作、可測試，並將所有 Must 項轉為設計與測試覆蓋。

本文件簽核後，任何新增的強制採購限制、銀行變更審批、資格文件、績效評分或多公司能力均應視為範圍變更，需更新需求、影響分析及驗收準則後再實作。


---

# Appendix A — Harness 2.0 Formal Requirement Definitions

本附錄只把上文既有需求轉成Harness可機械辨識的正式定義；Statement的legacy ID是一對一權威來源，沒有改變其業務語意。

## FR-001 — FR-LIST-001

### Statement

完整規範為上文表格中的`FR-LIST-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-002 — FR-LIST-002

### Statement

完整規範為上文表格中的`FR-LIST-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-003 — FR-LIST-003

### Statement

完整規範為上文表格中的`FR-LIST-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-004 — FR-LIST-004

### Statement

完整規範為上文表格中的`FR-LIST-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-005 — FR-LIST-005

### Statement

完整規範為上文表格中的`FR-LIST-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-006 — FR-LIST-006

### Statement

完整規範為上文表格中的`FR-LIST-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-007 — FR-LIST-007

### Statement

完整規範為上文表格中的`FR-LIST-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-008 — FR-LIST-008

### Statement

完整規範為上文表格中的`FR-LIST-008`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-009 — FR-LIST-009

### Statement

完整規範為上文表格中的`FR-LIST-009`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-010 — FR-LIST-010

### Statement

完整規範為上文表格中的`FR-LIST-010`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-011 — FR-VIEW-001

### Statement

完整規範為上文表格中的`FR-VIEW-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-012 — FR-VIEW-002

### Statement

完整規範為上文表格中的`FR-VIEW-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-013 — FR-VIEW-003

### Statement

完整規範為上文表格中的`FR-VIEW-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-014 — FR-VIEW-004

### Statement

完整規範為上文表格中的`FR-VIEW-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-015 — FR-VIEW-005

### Statement

完整規範為上文表格中的`FR-VIEW-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-016 — FR-CREATE-001

### Statement

完整規範為上文表格中的`FR-CREATE-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-017 — FR-CREATE-002

### Statement

完整規範為上文表格中的`FR-CREATE-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-018 — FR-CREATE-003

### Statement

完整規範為上文表格中的`FR-CREATE-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-019 — FR-CREATE-004

### Statement

完整規範為上文表格中的`FR-CREATE-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-020 — FR-CREATE-005

### Statement

完整規範為上文表格中的`FR-CREATE-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-021 — FR-CREATE-006

### Statement

完整規範為上文表格中的`FR-CREATE-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-022 — FR-CREATE-007

### Statement

完整規範為上文表格中的`FR-CREATE-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-023 — FR-CREATE-008

### Statement

完整規範為上文表格中的`FR-CREATE-008`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-024 — FR-EDIT-001

### Statement

完整規範為上文表格中的`FR-EDIT-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-025 — FR-EDIT-002

### Statement

完整規範為上文表格中的`FR-EDIT-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-026 — FR-EDIT-003

### Statement

完整規範為上文表格中的`FR-EDIT-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-027 — FR-EDIT-004

### Statement

完整規範為上文表格中的`FR-EDIT-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-028 — FR-EDIT-005

### Statement

完整規範為上文表格中的`FR-EDIT-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-029 — FR-EDIT-006

### Statement

完整規範為上文表格中的`FR-EDIT-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-030 — FR-EDIT-007

### Statement

完整規範為上文表格中的`FR-EDIT-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-031 — FR-STATUS-001

### Statement

完整規範為上文表格中的`FR-STATUS-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-032 — FR-STATUS-002

### Statement

完整規範為上文表格中的`FR-STATUS-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-033 — FR-STATUS-003

### Statement

完整規範為上文表格中的`FR-STATUS-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-034 — FR-STATUS-004

### Statement

完整規範為上文表格中的`FR-STATUS-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-035 — FR-STATUS-005

### Statement

完整規範為上文表格中的`FR-STATUS-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-036 — FR-STATUS-006

### Statement

完整規範為上文表格中的`FR-STATUS-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-037 — FR-STATUS-007

### Statement

完整規範為上文表格中的`FR-STATUS-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-038 — FR-STATUS-008

### Statement

完整規範為上文表格中的`FR-STATUS-008`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-039 — FR-PARTY-001

### Statement

完整規範為上文表格中的`FR-PARTY-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-040 — FR-PARTY-002

### Statement

完整規範為上文表格中的`FR-PARTY-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-041 — FR-PARTY-003

### Statement

完整規範為上文表格中的`FR-PARTY-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-042 — FR-PARTY-004

### Statement

完整規範為上文表格中的`FR-PARTY-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-043 — FR-PARTY-005

### Statement

完整規範為上文表格中的`FR-PARTY-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-044 — FR-PARTY-006

### Statement

完整規範為上文表格中的`FR-PARTY-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-045 — FR-BANK-001

### Statement

完整規範為上文表格中的`FR-BANK-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-046 — FR-BANK-002

### Statement

完整規範為上文表格中的`FR-BANK-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-047 — FR-BANK-003

### Statement

完整規範為上文表格中的`FR-BANK-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-048 — FR-BANK-004

### Statement

完整規範為上文表格中的`FR-BANK-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-049 — FR-BANK-005

### Statement

完整規範為上文表格中的`FR-BANK-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-050 — FR-BANK-006

### Statement

完整規範為上文表格中的`FR-BANK-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-051 — FR-BANK-007

### Statement

完整規範為上文表格中的`FR-BANK-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-052 — FR-APPROVAL-001

### Statement

完整規範為上文表格中的`FR-APPROVAL-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-053 — FR-APPROVAL-002

### Statement

完整規範為上文表格中的`FR-APPROVAL-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-054 — FR-APPROVAL-003

### Statement

完整規範為上文表格中的`FR-APPROVAL-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-055 — FR-APPROVAL-004

### Statement

完整規範為上文表格中的`FR-APPROVAL-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-056 — FR-APPROVAL-005

### Statement

完整規範為上文表格中的`FR-APPROVAL-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-057 — FR-APPROVAL-006

### Statement

完整規範為上文表格中的`FR-APPROVAL-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-058 — FR-APPROVAL-007

### Statement

完整規範為上文表格中的`FR-APPROVAL-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-059 — FR-SET-001

### Statement

完整規範為上文表格中的`FR-SET-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-060 — FR-SET-002

### Statement

完整規範為上文表格中的`FR-SET-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-061 — FR-SET-003

### Statement

完整規範為上文表格中的`FR-SET-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-062 — FR-SET-004

### Statement

完整規範為上文表格中的`FR-SET-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-063 — FR-SET-005

### Statement

完整規範為上文表格中的`FR-SET-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-064 — FR-SET-006

### Statement

完整規範為上文表格中的`FR-SET-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-065 — FR-SKU-001

### Statement

完整規範為上文表格中的`FR-SKU-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-066 — FR-SKU-002

### Statement

完整規範為上文表格中的`FR-SKU-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-067 — FR-SKU-003

### Statement

完整規範為上文表格中的`FR-SKU-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-068 — FR-SKU-004

### Statement

完整規範為上文表格中的`FR-SKU-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-069 — FR-SKU-005

### Statement

完整規範為上文表格中的`FR-SKU-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-070 — FR-SKU-006

### Statement

完整規範為上文表格中的`FR-SKU-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-071 — FR-IMPORT-001

### Statement

完整規範為上文表格中的`FR-IMPORT-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-072 — FR-IMPORT-002

### Statement

完整規範為上文表格中的`FR-IMPORT-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-073 — FR-IMPORT-003

### Statement

完整規範為上文表格中的`FR-IMPORT-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-074 — FR-IMPORT-004

### Statement

完整規範為上文表格中的`FR-IMPORT-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-075 — FR-IMPORT-005

### Statement

完整規範為上文表格中的`FR-IMPORT-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-076 — FR-IMPORT-006

### Statement

完整規範為上文表格中的`FR-IMPORT-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-077 — FR-IMPORT-007

### Statement

完整規範為上文表格中的`FR-IMPORT-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-078 — FR-IMPORT-008

### Statement

完整規範為上文表格中的`FR-IMPORT-008`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-079 — FR-IMPORT-009

### Statement

完整規範為上文表格中的`FR-IMPORT-009`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-080 — FR-IMPORT-010

### Statement

完整規範為上文表格中的`FR-IMPORT-010`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-081 — FR-AUDIT-001

### Statement

完整規範為上文表格中的`FR-AUDIT-001`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-082 — FR-AUDIT-002

### Statement

完整規範為上文表格中的`FR-AUDIT-002`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-083 — FR-AUDIT-003

### Statement

完整規範為上文表格中的`FR-AUDIT-003`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-084 — FR-AUDIT-004

### Statement

完整規範為上文表格中的`FR-AUDIT-004`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-085 — FR-AUDIT-005

### Statement

完整規範為上文表格中的`FR-AUDIT-005`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-086 — FR-AUDIT-006

### Statement

完整規範為上文表格中的`FR-AUDIT-006`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## FR-087 — FR-AUDIT-007

### Statement

完整規範為上文表格中的`FR-AUDIT-007`；本ID是其一對一canonical alias。

### Acceptance criteria

須滿足上文對應業務規則、AC-001～AC-040中適用條目，以及`07_uat_test_cases.md`的映射案例。

### Failure behavior

違反授權、唯一性、狀態、輸入或依賴條件時必須拒絕且不得留下部分業務資料；使用上文定義的穩定錯誤與稽核規則。

## NFR-001 — Existing non-functional requirement NFR-001

### Statement

完整且可量測的規範為上文`NFR-001`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-002 — Existing non-functional requirement NFR-002

### Statement

完整且可量測的規範為上文`NFR-002`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-003 — Existing non-functional requirement NFR-003

### Statement

完整且可量測的規範為上文`NFR-003`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-004 — Existing non-functional requirement NFR-004

### Statement

完整且可量測的規範為上文`NFR-004`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-005 — Existing non-functional requirement NFR-005

### Statement

完整且可量測的規範為上文`NFR-005`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-006 — Existing non-functional requirement NFR-006

### Statement

完整且可量測的規範為上文`NFR-006`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-007 — Existing non-functional requirement NFR-007

### Statement

完整且可量測的規範為上文`NFR-007`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-008 — Existing non-functional requirement NFR-008

### Statement

完整且可量測的規範為上文`NFR-008`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-009 — Existing non-functional requirement NFR-009

### Statement

完整且可量測的規範為上文`NFR-009`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-010 — Existing non-functional requirement NFR-010

### Statement

完整且可量測的規範為上文`NFR-010`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## NFR-011 — Existing non-functional requirement NFR-011

### Statement

完整且可量測的規範為上文`NFR-011`表格列及其相應小節。

### Acceptance criteria

由`06_technical_test_cases.md`對應mandatory case取得實測證據；有使用者可觀察影響時亦須完成UAT。

### Failure behavior

門檻未量測、未通過或證據與候選baseline不一致時，該Phase不得宣告完成或可發布。

## SEC-001 — Existing security requirement SEC-001

### Statement

完整安全規範為上文`SEC-001`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-002 — Existing security requirement SEC-002

### Statement

完整安全規範為上文`SEC-002`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-003 — Existing security requirement SEC-003

### Statement

完整安全規範為上文`SEC-003`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-004 — Existing security requirement SEC-004

### Statement

完整安全規範為上文`SEC-004`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-005 — Existing security requirement SEC-005

### Statement

完整安全規範為上文`SEC-005`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-006 — Existing security requirement SEC-006

### Statement

完整安全規範為上文`SEC-006`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-007 — Existing security requirement SEC-007

### Statement

完整安全規範為上文`SEC-007`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-008 — Existing security requirement SEC-008

### Statement

完整安全規範為上文`SEC-008`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-009 — Existing security requirement SEC-009

### Statement

完整安全規範為上文`SEC-009`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-010 — Existing security requirement SEC-010

### Statement

完整安全規範為上文`SEC-010`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-011 — Existing security requirement SEC-011

### Statement

完整安全規範為上文`SEC-011`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-012 — Existing security requirement SEC-012

### Statement

完整安全規範為上文`SEC-012`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-013 — Existing security requirement SEC-013

### Statement

完整安全規範為上文`SEC-013`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

## SEC-014 — Existing security requirement SEC-014

### Statement

完整安全規範為上文`SEC-014`表格列；任何角色名稱都不會隱式取消該控制。

### Acceptance criteria

對應權限、資料保護、audit、redaction及負面案例必須在Technical Test通過；使用者可觀察的授權結果須通過UAT。

### Failure behavior

安全控制缺失、依賴未知或敏感資料可能外洩時fail closed，停止受影響流程並保留低敏告警／調查證據。

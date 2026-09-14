# Customer Management Requirement Specification (Harness 2.0 Aligned)

## Harness alignment record

| Item | Value |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Recovery baseline | `origin/main` at `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7` |
| Legacy source | `requirement.md` merged verbatim below before deletion |
| Provenance | Existing Customer business baseline plus the already recorded RTO/RPO decision |
| Product-code change | None |

The canonical aliases and clarifications below preserve the former requirement source. The complete legacy body is retained verbatim in this file, so no second active requirement authority is required.

## 1. Normative Baseline

The complete aligned business requirement is the preserved legacy requirement body below. This entry provides canonical IDs, provenance, resolved clarifications and measurable gates for downstream design, planning and testing without rewriting the approved business intent.

If this entry and the source requirement appear inconsistent, the source requirement plus explicitly approved decisions govern; the discrepancy must be returned to requirement review rather than silently resolved in code.

## 2. Business Outcome and Scope

Customer Management is the single controlled source of company-customer identity, lifecycle, addresses, contacts, identifiers, commercial defaults, optional credit policy, bank accounts, attachments, approval settings, import/export and audit for a single-company wholesale ERP.

In scope and out of scope remain exactly those in the preserved legacy requirement body §2. In particular, this module does not own pricing, Sales Orders, Fulfillment, Returns, invoices, receivables, payments, refunds, exchange rates, customer groups, temporary shipping addresses, consumer CRM or multi-company isolation.

## 3. Canonical Functional Requirement Map

Each canonical ID maps one-to-one by position within its source family. Example: `FR-001 = FR-LIST-001`, `FR-011 = FR-VIEW-001`, and `FR-100 = FR-AUDIT-007`.

| Canonical IDs | Existing IDs | Source | Provenance |
| --- | --- | --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010 | FR-LIST-001～010 | the preserved legacy requirement body §8.1 | `EXISTING`; alias is `ENHANCED` |
| FR-011, FR-012, FR-013, FR-014, FR-015, FR-016 | FR-VIEW-001～006 | §8.2 | `EXISTING`; alias is `ENHANCED` |
| FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025 | FR-CREATE-001～009 | §8.3 | `EXISTING`; alias is `ENHANCED` |
| FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033 | FR-EDIT-001～008 | §8.4 | `EXISTING`; alias is `ENHANCED` |
| FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041 | FR-STATUS-001～008 | §8.5 | `EXISTING`; alias is `ENHANCED` |
| FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049 | FR-PARTY-001～008 | §8.6 | `EXISTING`; alias is `ENHANCED` |
| FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056 | FR-CREDIT-001～007 | §8.7 | `EXISTING`; alias is `ENHANCED` |
| FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063 | FR-BANK-001～007 | §8.8 | `EXISTING`; alias is `ENHANCED` |
| FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070 | FR-FILE-001～007 | §8.9 | `EXISTING`; alias is `ENHANCED` |
| FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077 | FR-APPROVAL-001～007 | §8.10 | `EXISTING`; alias is `ENHANCED` |
| FR-078, FR-079, FR-080, FR-081, FR-082, FR-083 | FR-SET-001～006 | §8.11 | `EXISTING`; alias is `ENHANCED` |
| FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093 | FR-IMPORT-001～010 | §8.12 | `EXISTING`; alias is `ENHANCED` |
| FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100 | FR-AUDIT-001～007 | §8.13 | `EXISTING`; alias is `ENHANCED` |

Priority, actor, validation, alternate behavior and acceptance meaning are inherited in full. A canonical alias never weakens a `Must` or turns a `Should` into out of scope.

## 4. Business Rules and Acceptance Criteria

- `BR-001..BR-042` and `AC-001..AC-052` remain normative without renumbering.
- `BR-025` means only creation/submission of a new sales or new credit-bearing transaction requires an Active Customer.
- `BR-026` means a later Suspended, Blocked or Archived status must not by itself prevent fulfillment of an already-confirmed order, invoicing of an already-shipped transaction, settlement/credit of an existing receivable, or a legitimate historical return. Each consumer must still validate its source document, ownership, current child record and its own permission.
- Customer master changes never rewrite confirmed transaction snapshots.

The preceding status clarification is `ENHANCED`: it consolidates existing intent from `BR-025`, `BR-026` and integration requirements and does not add a new business capability.

## 5. Security Requirements

`SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014` map one-to-one to the preserved legacy requirement body §11 and remain `EXISTING`.

They require backend authorization, no permission inheritance, non-self approval, sensitive-bank least privilege, owner-safe resource lookup, encryption and masking, fresh authorization for high-risk actions, injection/file protection and auditable bulk/sensitive access.

## 6. Non-Functional Requirements

| Canonical ID | Source / requirement | Measure | Provenance |
| --- | --- | --- | --- |
| NFR-001 | Existing NFR-001 | 50-user normal mixed load: standard list and exact code/name query p95 < 2 seconds. | `EXISTING` |
| NFR-002 | Existing NFR-002 | Server paging defaults to 20 and caps at 100. | `EXISTING` |
| NFR-003 | Existing NFR-003 | Validate 100,000 customers with stated child-cardinality baseline. | `EXISTING` |
| NFR-004 | Existing NFR-004 | 10,000-row CSV precheck plus execution < 10 minutes, excluding user wait. | `EXISTING` |
| NFR-005 | Existing NFR-005 | Address/contact lookup meets p95 target with zero cross-customer leakage. | `EXISTING` |
| NFR-006 | Existing NFR-006 | Domain data, children, status, settings and audit have consistent outcomes. | `EXISTING` |
| NFR-007 | Existing NFR-007 | Concurrent edit/default/approval never silently overwrites or violates invariants. | `EXISTING` |
| NFR-008 | Existing NFR-008 | Duplicate create/import/activation/approval/status requests do not duplicate effects. | `EXISTING` |
| NFR-009 | Existing NFR-009 | Master, settings, encrypted banks, files and audit are restorable as one coherent set. | `EXISTING` |
| NFR-010 | Existing NFR-010 | Non-essential dependency failure cannot expose data or relax eligibility. | `EXISTING` |
| NFR-011 | Existing NFR-011 | UI, CSV and interfaces use consistent fields, states, permissions and errors. | `EXISTING` |
| NFR-012 | Existing NFR-012 | Settings can add approved parameters without speculative behavior. | `EXISTING` |
| NFR-013 | Existing NFR-013 | Shared/central catalogs have a single owner and interpretation. | `EXISTING` |
| NFR-014 | Existing NFR-014 | Locale/time/amount/address presentation follows `APP_TIME_ZONE` and unambiguous exchange formats. | `EXISTING` |
| NFR-015 | New measurable DR requirement | Production `RTO <= 4 hours`, `RPO <= 15 minutes`; isolated restore must reconcile DB, key rings, general files, bank-sensitive files and audit before service is declared recovered. | `NEW — USER APPROVED 2026-09-10` |

## 7. Assumptions and Constraints

- `EXISTING`: single company, company customers, wholesale business and no row-level customer ownership isolation.
- `EXISTING`: MySQL 5.7, Node.js ES modules/Express handler conventions and Vue 3/Quasar frontend.
- `EXISTING`: account/customer identifiers are stable numeric IDs; display names, codes and bank values are never downstream foreign keys.
- `ENHANCED`: customer status eligibility is purpose-specific and unknown purposes fail closed.
- `ENHANCED`: destructive retention automation is disabled until Legal/Compliance confirms legal hold and any period longer than seven years.
- `ASSUMPTION`: exact deployment availability percentage is governed by the ERP platform SLO; this feature adds no separate active-active architecture.

## 8. Dependencies and Open Issues

| ID | Matter | Owner / deadline | Status |
| --- | --- | --- | --- |
| OI-001 | Customer production DR target: RTO<=4h, RPO<=15m. | Product Owner/Operations | `APPROVED 2026-09-10` |
| OI-002 | Confirm whether applicable law/contract requires retention longer than the seven-year baseline and define legal hold. | Legal/Compliance before purge release | `OPEN — NON-BLOCKING FOR CORE` |
| OI-003 | Confirm initial Currency, Payment Term, Category, Industry and Territory data. | Business/Finance before production activation | `OPEN — RELEASE DEPENDENCY` |
| OI-004 | Verify actual Sales, Fulfillment, Returns, AR and Payment provider contracts after their branches merge to main. | Module owners at Phase entry | `OPEN — IMPLEMENTATION DEPENDENCY` |
| OI-005 | Provision production key custody, malware scanner, private storage and backup ownership. | Security/Operations before sensitive capability release | `OPEN — RELEASE DEPENDENCY` |

## 9. Requirement Gate

Core business behavior is `READY_FOR_DESIGN_ALIGNMENT`. No unresolved issue changes Customer ownership, lifecycle, permissions, transaction semantics or the core acceptance criteria. OI-002..005 remain explicit Phase/release gates and must not be bypassed with production fakes.

---

# Preserved legacy requirement body (verbatim)

# Customer Management 業務需求書

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Customer Management 業務需求書 |
| 文件版本 | 0.2 Harness Aligned |
| 文件日期 | 2026-09-10 |
| 文件狀態 | Harness Review已對齊；核心業務意圖完整，待正式簽核及實作 |
| 適用系統 | ERP App |
| 適用組織 | 單一公司 |
| 主要業務模式 | 以公司客戶為主的批發業務 |
| 主要範圍 | 客戶主資料、地址、聯絡人、法定識別、交易預設、信用資料、銀行資料、附件、狀態、啟用審批、匯入匯出及稽核 |

### 0.1 文件目的

本文件定義 ERP Customer Management（客戶管理）模組應滿足的業務需求，作為業務確認、技術設計、開發、測試、驗收、上線及後續變更控制的共同基準。

本文件描述系統需要支援的業務能力、資料規則、權限、流程及可驗收結果，不直接指定資料庫表、API 路徑、前端元件或程式架構。技術實作應在本文件簽核後另行設計。

### 0.2 需求背景

本 ERP 主要服務化妝品、零食、健康食品及飲品等商品的批發業務。銷售報價、銷售訂單、發貨、退貨、開票、應收帳款、收款、退款及報表等流程均需要引用一致、有效且可追溯的公司客戶資料。

批發客戶通常有多個辦公、帳單及送貨地點，多名負責不同業務用途的聯絡人，並可能具備預設交易幣別、付款條件、選填信用政策及多個銀行帳戶。若這些資料分散於交易或由使用者臨時輸入，容易造成重複客戶、錯誤送貨、信用控制失效、敏感銀行資料外洩及歷史交易無法還原當時資料等風險。

Customer Management 將建立單一客戶主資料來源。銷售下單時只選擇 Customer；送貨地址在發貨時才從該客戶的有效地址中選擇，並預選默認送貨地址。所有下游交易以不可重用的 Customer ID 關聯，同時保存交易當時必要快照。

### 0.3 版本紀錄

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 0.1 Draft | 2026-09-07 | 根據業務訪談建立以批發公司客戶為核心的主資料、地址、聯絡、信用、銀行、附件、審批、匯入匯出、生命週期及下游整合需求。 |
| 0.2 Harness Aligned | 2026-09-10 | 納入Harness獨立評審結論、目的限定的下游狀態資格、可量測災難復原目標及正式追溯入口；不改變已確認業務範圍。 |

### 0.4 Harness對齊基線

- 本文件是Customer Management完整且正式的業務需求基線。
- [`01_requirement_spec.md`](01_requirement_spec.md)提供`FR-001`～`FR-100`標準別名、來源標記及跨文件追溯；別名不取代或削弱本文件原有`FR-*`家族、`BR-*`、`SEC-*`及`AC-*`語意。
- [`02_requirement_review.md`](02_requirement_review.md)記錄獨立需求評審與已處理差異；未經批准的建議不會自動成為業務需求。
- 如正式需求與其他下游文件不一致，以本文件及已批准決策為準，差異必須回到需求評審處理，不得由開發者自行選擇語意。

---

## 1. 業務目標與成功指標

### 1.1 業務目標

| 編號 | 目標 |
| --- | --- |
| OBJ-01 | 建立單一、可靠、可稽核的公司客戶主資料來源。 |
| OBJ-02 | 讓銷售、發貨、退貨、開票、應收、收款及退款模組使用一致的 Customer ID、名稱及狀態。 |
| OBJ-03 | 支援客戶完整的新增、查詢、修改、啟用、暫停、封鎖、封存、還原及受控刪除。 |
| OBJ-04 | 管理同一客戶的多個地址與多名聯絡人，並以默認值減少發貨及財務流程的選擇成本。 |
| OBJ-05 | 提供選填的交易預設及信用資料，但清楚區分「未設定」與實際值為零或停用。 |
| OBJ-06 | 以可配置方式控制新客戶是否需要另一人審批，預設保持簡化流程。 |
| OBJ-07 | 以獨立權限、遮蔽、加密及稽核保護客戶銀行帳戶與銀行證明附件。 |
| OBJ-08 | 支援一般客戶資料批量導入、逐列部分成功及匯出，降低舊資料遷移和大量建檔成本。 |
| OBJ-09 | 為後續銷售與應收模組提供狀態、地址、聯絡人、幣別、付款條件及信用政策契約，而不把交易計算放入主資料模組。 |

### 1.2 建議成功指標

| 編號 | 指標 | 建議目標 |
| --- | --- | --- |
| KPI-01 | Active Customer 最低必填資料完整率 | 100% |
| KPI-02 | 重複 Customer Code | 0 |
| KPI-03 | 正規化後重複公司名稱 | 0 |
| KPI-04 | 已填寫法定識別資料重複且未被阻擋 | 0 |
| KPI-05 | 客戶狀態、信用、銀行、附件、審批及設定變更可追溯率 | 100% |
| KPI-06 | 以 Customer Code 或公司名稱搜尋的回應時間 | 95% 請求在 2 秒內完成 |
| KPI-07 | 發貨時有效地址選擇及默認地址帶入準確率 | 100% |
| KPI-08 | 合法 CSV 資料列匯入成功率 | 99.5% 以上；錯誤列必須可定位及修正 |
| KPI-09 | 未獲授權使用者取得完整銀行帳號或敏感銀行附件的事件 | 0 |

KPI 數值屬建議基線，正式上線前須由銷售、發貨、財務、資訊安全及技術團隊共同確認量測口徑。

## 2. 範圍

### 2.1 本期範圍

- 公司客戶主資料的建立、查詢、修改、直接啟用或審批啟用、暫停、封鎖、封存、還原及有限條件下永久刪除。
- 人工輸入且全公司唯一的 Customer Code。
- 正規化後全公司唯一的公司法定名稱，以及選填的 Trading／Display Name。
- 多地址、多用途、有效狀態及每種用途一個默認地址；發貨時選擇有效送貨地址。
- 多聯絡人、多用途、每種用途多名聯絡人及一名默認聯絡人。
- 選填的公司註冊號、商業登記號、稅務識別號及其他法定／業務識別資料。
- 預設交易幣別、選填付款條件、主要 Account Manager、客戶分類、行業及地區。
- 選填信用額度、信用幣別及信用狀態；向 Sales／Accounts Receivable 提供控制資料。
- 多個選填銀行帳戶、預設帳戶、遮蔽顯示、受控完整查看及獨立銀行權限。
- 一般附件及敏感銀行證明附件的上傳、下載、分類、停用／刪除及稽核。
- 可配置的新客戶啟用審批流程；預設不需審批。
- Customer Management 獨立設定功能及日後增加經確認參數的入口。
- 列表、搜尋、篩選、排序、分頁、詳情、資料完整度及變更歷史。
- 一般客戶主資料的 CSV 批量匯入及匯出；採逐列部分成功。
- 供 Sales、Fulfillment、Returns、Invoicing、Accounts Receivable、Payment／Refund及報表模組查詢客戶資料與狀態。

### 2.2 本期不包含

- 銷售報價、銷售訂單、發貨、退貨、換貨、開票、應收、收款、退款或對賬交易本身。
- 客戶專屬售價、價目表、合約價、數量折扣、會員價、促銷或價格計算。
- 匯率維護、多幣別會計換算、總帳或收入確認。
- 信用暴露、應收餘額、逾期金額或可用額度的實時計算；由 Accounts Receivable／Sales 負責。
- 超額、逾期或信用暫停的交易豁免權限及批准流程；由相應交易模組定義。
- Customer Group、母公司—子公司、集團結算、共享信用額度或跨 Customer 合併帳單。
- 按 Account Manager、銷售團隊、地區或渠道實施資料列級隔離。
- 未先保存於 Customer 主檔的臨時／一次性送貨地址。
- 客戶入口網站、自助註冊、會員積分、忠誠計劃或個人消費者 CRM。
- OCR、自動文件辨識、電子簽署、合約審批、文件版本簽署及附件到期提醒。
- 客戶評分、銷售預測、流失分析或市場推廣活動管理。
- 銀行資料及敏感銀行附件的一般 CSV 匯入或匯出。
- 多公司、多法人或多租戶資料隔離。

### 2.3 上下游依賴

| 系統／模組 | 關係 |
| --- | --- |
| 用戶、角色與權限 | 提供 Customer 一般查看、維護、啟用審批、銀行查看、銀行維護及設定權限。 |
| Currency／Finance Settings | 提供啟用幣別及付款條件目錄；匯率及會計換算不由本模組維護。 |
| Sales／Order Management | 使用 Customer ID、狀態及交易預設；提交新訂單時重新驗證客戶及信用政策。 |
| Fulfillment／Delivery | 發貨時從有效送貨地址中選擇，預選默認地址並保存地址／聯絡快照。 |
| Returns | 使用 Customer ID 及原交易快照處理退貨，不因主檔後續變更而改寫歷史。 |
| Invoicing | 使用有效帳單地址及交易時付款條件／幣別快照。 |
| Accounts Receivable | 計算應收、逾期及信用暴露，使用本模組的選填信用政策。 |
| Payment／Refund／Reconciliation | 在獲授權情況下使用有效銀行帳戶；實際收退款及對賬不屬本模組。 |
| 稽核 | 記錄主資料、狀態、信用、銀行、附件、審批、設定及匯入匯出事件。 |
| 報表 | 依客戶、狀態、Account Manager、分類、行業、地區及交易關係彙總。 |

## 3. 名詞定義

| 名詞 | 定義 |
| --- | --- |
| Customer | 與本公司進行批發交易及結算的公司法律實體。不同法律或結算主體原則上建立不同 Customer。 |
| Customer ID | 系統產生、不可重用的內部識別碼，供所有業務關聯使用。 |
| Customer Code | 建檔人員人工輸入、全公司唯一的業務識別碼。 |
| Legal Name | 客戶公司的法定／主要公司名稱，正規化後全公司唯一。 |
| Trading／Display Name | 日常顯示名稱或商號；不取代 Legal Name，也不作法律實體識別。 |
| Customer Site／Address | 同一 Customer 下的註冊、辦公、帳單、送貨、退貨或其他地址。 |
| Contact | Customer 下的公司聯絡人，可同時屬於多個用途。 |
| Identifier | 公司註冊號、商業登記號、稅務識別號或其他由國家／地區簽發的識別資料。 |
| Account Manager | 負責維繫該客戶的主要內部業務人員；本期只作歸屬、搜尋及報表。 |
| Credit Policy | 選填的信用額度、幣別及信用狀態主資料；實際信用暴露由下游計算。 |
| Active Customer | 可被選入新的銷售或其他獲授權交易的有效客戶。 |
| Suspended Customer | 暫時停止新交易、可在填寫原因後恢復的客戶。 |
| Blocked Customer | 因重大信用、合規、欺詐或商業風險被封鎖，只能由指定權限解除。 |
| Archived Customer | 不再日常使用、預設不在列表及新交易選擇器顯示，但歷史仍可查。 |
| Customer Approval | 啟用審批參數開啟時，由建檔人指定另一名具有審批權限的人員批准新客戶啟用。 |
| Address Snapshot | 發貨、開票或其他交易確認時保存的地址文字及識別資料，不因主檔日後修改而改變。 |

## 4. 角色與責任

| 角色 | 主要責任 | 典型權限 |
| --- | --- | --- |
| 客戶資料查閱者 | 查看一般客戶列表、詳情、狀態、一般附件及變更歷史。 | customer.view |
| 客戶管理員 | 建立及維護一般主資料、地址、聯絡人、識別、商業預設、信用資料、一般附件及一般狀態。 | customer.view＋customer.mgmt |
| 客戶審批人 | 審批新客戶啟用申請及執行封鎖／解除封鎖。 | customer.view＋customer.approval |
| 銀行資料查閱者 | 在業務需要下主動查看完整銀行資料及敏感銀行附件。 | customer.view＋customer.bank.view |
| 銀行資料管理員 | 新增、修改、停用、設定默認銀行帳戶及管理敏感銀行附件。 | customer.view＋customer.bank.view＋customer.bank.mgmt |
| 客戶設定管理員 | 維護 Customer Management 參數。 | customer.view＋customer.settings |
| 銷售人員 | 在銷售流程查找有效 Customer 及取得必要預設資料。 | 銷售模組權限；不因此取得 Customer 維護能力 |
| 發貨人員 | 在發貨流程選擇有效送貨地址及聯絡人。 | 發貨模組權限；不因此取得 Customer 維護能力 |
| 財務／應收人員 | 使用付款條件、信用政策及經授權的銀行資料。 | 財務模組權限及相應銀行資料權限 |
| 系統管理員 | 配置角色權限及處理系統管理。 | 按職責明確授予；不得只因系統管理身份自動取得完整銀行資料 |

權限必須由後端執行，不可只依賴前端隱藏按鈕。customer.mgmt 不自動包含 customer.approval、customer.bank.view、customer.bank.mgmt 或 customer.settings。信用資料由一般 customer.mgmt 維護，不設獨立 Customer 信用管理權限。

## 5. 核心業務原則

1. Customer 代表批發交易及結算的公司法律實體；本期不管理個人零售會員。
2. 每個 Customer 獨立結算；不建立母子公司層級或共享信用額度。分店、倉庫及收貨點作為同一 Customer 下的地址。
3. 所有下游資料以 Customer ID 關聯；Code、名稱、地址文字或銀行帳號不得作永久外鍵。
4. Customer Code 由使用者人工輸入，不設固定格式；全公司不分大小寫唯一，所有狀態持續占用。
5. Legal Name 去除首尾空白並正規化後全公司唯一；發現重複時直接阻止建立或修改，不只顯示警告。
6. Active 最低必填為 Customer Code、Legal Name 及有效 Default Currency。地址、聯絡人、付款條件、信用、識別、銀行及附件均可後補。
7. 銷售下單只選 Customer；不在下單階段選送貨地址。發貨時必須從該 Customer 的有效送貨地址選擇，並預選默認值。
8. 不允許在發貨流程臨時輸入未建立的地址；新地址須先透過 Customer Management 受控維護。
9. 每個地址用途可有多筆有效地址但最多一個默認值；每個聯絡用途可有多名聯絡人但最多一名默認聯絡人。
10. 信用資料為選填；未設定信用政策不同於信用額度為 0。應收及逾期計算由下游負責。
11. 客戶專屬價格、折扣及促銷不在 Customer Management 保存或計算。
12. 審批由參數控制；預設關閉，開啟後建檔人須指定另一名具有 customer.approval 的人員。
13. 完整銀行資料及敏感銀行附件採最小權限、加密、遮蔽、主動查看及完整稽核。
14. 暫停、封鎖及封存限制新的業務使用，但不得破壞既有訂單、出貨、發票、收退款及稽核歷史。
15. 只有從未被任何資料引用的 Draft Customer 可永久刪除。
16. UI、CSV 及整合介面須套用相同的唯一性、狀態、版本、權限及審批規則。
17. 關鍵變更與業務寫入必須和稽核保持一致，不可資料已改但稽核遺失。

## 6. 資料概念模型

### 6.1 關係概覽

```text
Customer
  ├──< Address / Site
  ├──< Contact >── Contact Purpose
  ├──< Identifier
  ├──0..1 Credit Policy
  ├──< Bank Account
  ├──< Attachment
  ├──< Approval Request
  └──< Audit History

Customer Settings ── controls ──> Activation Approval Flow
Currency / Payment Terms / User Directory ── referenced by ──> Customer
```

### 6.2 Customer 主資料

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Customer ID | 系統 | 不可重用的內部識別碼；所有下游交易以此關聯。 |
| Customer Code | 是 | 人工輸入；全公司不分大小寫唯一；不強制前綴或分段格式。 |
| Legal Name | 是 | 公司法定／主要名稱；正規化後全公司唯一。 |
| Trading／Display Name | 否 | 日常顯示名稱；可重複，不得取代 Legal Name。 |
| Default Currency | 是（啟用時） | 從有效幣別目錄選擇；預設 HKD，也可為其他有效幣別。 |
| Default Payment Term | 否 | 從有效付款條件目錄選擇；未填不阻擋啟用。 |
| Account Manager | 否 | 從有效內部使用者目錄選擇；不作資料存取隔離。 |
| Customer Category | 否 | 供業務分類、搜尋及報表；使用受控目錄或明確定義值。 |
| Industry | 否 | 客戶所屬行業；供搜尋及報表。 |
| Territory／Region | 否 | 業務地區；不等同地址國家或資料權限。 |
| Website | 否 | 有值時驗證為可接受 URL。 |
| General Phone／Email | 否 | 一般聯絡資料；不取代 Contact 明細。 |
| Notes | 否 | 內部備註；不得保存密碼、完整支付憑證或不必要敏感資料。 |
| Status | 是 | Draft、Pending Approval、Active、Suspended、Blocked、Archived。 |
| Created／Updated | 系統 | 保存時間、操作者及資料版本。 |

系統應顯示完整度提示，例如缺少默認送貨地址、帳單地址、主要聯絡人、付款條件、信用資料、銀行帳戶或必要附件。除 Customer Code、Legal Name 及 Default Currency 外，這些提示不構成客戶啟用阻擋；實際發貨、開票、收退款或信用交易可由相應下游流程在使用時阻擋。

### 6.3 地址與地點

- 一個 Customer 可有多個地址，代表分店、倉庫、收貨點、帳單地點、註冊地址或辦公地點。
- 地址可同時具有註冊、辦公、帳單、送貨、退貨及其他用途；每個用途可有多筆有效地址。
- 每種用途最多一個有效默認地址；允許該用途暫時沒有默認值。
- 地址至少可保存地址名稱、收件公司／部門、地址行、城市、州／省、郵遞區號、國家／地區、電話、備註、用途、狀態及排序。
- 銷售下單階段不要求選送貨地址；發貨時必須選擇有效送貨地址，系統預選默認地址。
- 發貨時不可臨時輸入未保存地址；需要新地址時先由有權限者加入 Customer 主檔。
- 沒有有效送貨地址不阻擋 Customer 啟用或建立銷售草稿，但發貨確認必須被阻擋並提示先維護地址。
- 地址可停用；停用後不能用於新發貨或開票，但已確認交易保存地址快照並保持可查。
- 被交易引用的地址不可物理刪除；修改地址不得回寫既有交易快照。

### 6.4 聯絡人

- 一個 Customer 可有多個聯絡人；每名聯絡人可同時屬於多個用途。
- 用途至少包括一般、下單／採購、收貨、帳單／應收、退貨及其他。
- 每個用途可有多名有效聯絡人，但最多一名默認聯絡人；設定新默認值時，原默認值須在同一操作取消。
- 聯絡人可保存姓名、職位、部門、電話、流動電話、Email、語言偏好、用途、狀態、排序及備註。
- Email 或電話有值時須通過基本格式驗證；系統不得猜測或自動改寫實際聯絡值。
- 沒有聯絡人不阻擋 Customer 啟用；下游流程如需要聯絡人，須在使用時提示或阻擋。
- 離職或不再使用的聯絡人應停用；修改或停用不得改寫歷史交易的聯絡人快照。

### 6.5 法定及業務識別資料

- 可保存公司註冊號、商業登記號、稅務識別號及其他受控識別類型。
- 識別資料為選填，不是啟用必要條件。
- 每筆須保存識別類型、簽發國家／地區、證號、可選有效期及備註。
- 有值時，識別類型＋簽發國家／地區＋正規化證號必須在全公司唯一。
- 格式規則不可假設所有客戶均為香港公司；可按類型及地區驗證。
- 被交易、發票或合規記錄引用後不可破壞歷史；失效資料可停用並保留。

### 6.6 商業預設與業務分類

- 每個 Active Customer 必須有一個有效 Default Currency，預設選項為 HKD，但可設定系統幣別目錄中的其他有效幣別。
- Default Payment Term 為選填；未設定時 Sales／Invoicing 應收到「未設定」而非猜測一個值。
- Customer Management 只保存預設值；銷售交易能否覆寫、匯率及結算由下游模組決定。
- 修改幣別、付款條件、Account Manager、分類、行業或地區不改變既有交易快照。
- 本模組不保存價目表、客戶售價、折扣率、促銷資格或價格公式。

### 6.7 信用資料

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Credit Limit | 否 | 金額；未設定為 null，不得等同 0。設定後須大於或等於 0。 |
| Credit Currency | Credit Limit 有值時必填 | 從有效幣別目錄選擇；可與 Default Currency 相同或不同。 |
| Credit Status | 否 | Not Configured、Normal 或 On Hold；未建立信用政策時為 Not Configured。 |
| Credit Notes | 否 | 內部說明，不得保存完整付款憑證或不必要敏感資料。 |
| Updated／Reason | 系統／關鍵修改時 | 保存版本、操作者、時間及變更原因。 |

- 信用資料整體選填，缺少信用資料不阻止 Customer 啟用。
- 信用額度為 0 表示明確不提供信用，與未設定信用額度不同。
- customer.mgmt 可維護信用資料，不另設 Customer 信用管理權限或雙人審批。
- 修改信用額度、信用幣別或 Credit Status 必須填寫原因並完整稽核。
- Accounts Receivable 負責應收餘額、逾期、未開票出貨及信用暴露計算；Customer Management 不保存其可變結果。
- Sales 在交易提交時使用本模組政策與 AR 暴露重新判斷；超額、逾期或 On Hold 的豁免權限及流程由 Sales／AR 定義，customer.mgmt 不自動授予豁免能力。

### 6.8 銀行帳戶

| 欄位 | 必填 | 業務規則 |
| --- | --- | --- |
| Account Holder Name | 是（新增帳戶時） | 應與客戶實體一致；不一致時要求確認。 |
| Bank Name | 是（新增帳戶時） | 銀行顯示名稱。 |
| Bank Country／Region | 否 | 用於本地或國際收退款資料。 |
| Bank／Branch Code | 否 | 按所在地區需要保存。 |
| Account Number／IBAN | 是（新增帳戶時） | 高敏感欄位；一般畫面、稽核、通知及CSV須遮蔽或排除。 |
| SWIFT／BIC | 否 | 有值時執行基本格式驗證。 |
| Account Currency | 否 | 可標示帳戶主要幣別。 |
| Purpose | 否 | 例如收款來源識別、退款或一般。 |
| Is Default | 是 | 同一 Customer 同時間最多一個有效默認帳戶；允許沒有默認。 |
| Status | 是 | Active 或 Inactive；被引用後不得永久刪除。 |

- 銀行資料選填；沒有銀行帳戶不阻擋 Customer 啟用或銷售下單。
- 一個 Customer 可有多個銀行帳戶並指定一個有效默認帳戶。
- 只有 customer.bank.view 可主動查看完整帳戶資料；其他使用者只看到銀行名稱及遮蔽帳號等最低資料。
- 只有 customer.bank.mgmt 可新增、修改、停用或變更默認帳戶，並必須同時具備 customer.bank.view。
- 完整值查看、銀行新增／修改／停用、默認切換及未授權嘗試均須稽核。
- 相同 Customer 的重複帳戶須阻止；相同帳戶出現在不同 Customer 時顯示高風險警告，不自動合併。
- Inactive 帳戶不得供新的退款、收款匹配或其他交易選擇；既有歷史保存快照。
- 一般搜尋、一般 CSV、一般附件索引、通知、URL、日誌、錯誤及分析追蹤不得暴露完整帳號。

### 6.9 附件

- 一個 Customer 可有多個附件，至少分為 General 及 Bank Sensitive 兩個敏感級別。
- 一般附件可包括公司證明、信用申請表、一般合約及其他業務文件；Bank Sensitive 用於銀行證明等高敏感文件。
- 附件保存顯示名稱、文件類型、敏感級別、檔案大小、格式、上傳人、上傳時間、狀態及可選備註。
- 允許 PDF、PNG、JPEG 及 WebP；須驗證副檔名、MIME、內容簽章及大小，不允許 SVG 或可執行內容。
- customer.view 可查看一般附件；Bank Sensitive 只可由 customer.bank.view 下載或預覽。
- customer.mgmt 可維護一般附件；Bank Sensitive 只能由同時具有 customer.bank.view 及 customer.bank.mgmt 的人上傳、修改分類或停用。
- 附件為選填，不阻擋 Customer 啟用。
- 被交易或審批引用的附件不可破壞歷史；停用後不供新流程選擇，但歷史授權查閱仍保留。
- 本期不提供 OCR、電子簽署、文件版本工作流、到期提醒或自動狀態變更。

## 7. 狀態、生命週期與審批

### 7.1 狀態定義

| 狀態 | 可編輯 | 可用於新銷售 | 可進行啟用審批 | 歷史可見 |
| --- | --- | --- | --- | --- |
| Draft | 是 | 否 | 是 | 是 |
| Pending Approval | 僅撤回或有限修正 | 否 | 審批中 | 是 |
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

- Active 前強制要求唯一 Customer Code、唯一 Legal Name 及有效 Default Currency。
- Approval OFF 時，customer.mgmt 可直接啟用完整 Draft Customer。
- Approval ON 時，建檔人必須指定另一名有效且具有 customer.approval 的使用者。
- Suspended 用於暫停新交易，可由 customer.mgmt 填寫原因後恢復 Active。
- Blocked 用於重大信用、合規、欺詐或商業風險；封鎖及解除由 customer.approval 執行並要求原因。解除後先回 Suspended，不直接取得交易資格。
- Archived 還原後先進入 Suspended，須重新檢查唯一值、幣別及必要依賴後再啟用。
- 只有從未被引用的 Draft Customer 可永久刪除。
- 封存前顯示未完成訂單、發貨、退貨、發票、應收、收退款或其他阻擋項；是否允許封存由下游規則決定。
- 狀態變更不修改任何歷史交易快照。

### 7.3 新客戶啟用審批參數

| 項目 | 規則 |
| --- | --- |
| 參數名稱 | 新客戶啟用需要審批 |
| 預設值 | 關閉 |
| 關閉時 | customer.mgmt 可直接啟用完整 Draft Customer。 |
| 開啟時 | 建檔人選擇另一名有效 customer.approval 使用者；Customer 進入 Pending Approval。 |
| 審批結果 | 批准進入 Active；拒絕返回 Draft並要求原因。 |
| 進行中申請 | 建檔人可撤回；關鍵資料修改使原申請失效並要求重新提交。 |
| 稽核 | 保存設定快照、提交人、審批人、時間、決定、原因及前後值。 |

- 建檔人不可自我審批，即使同時具有 customer.approval。
- 審批人只可從目前有效且具有 customer.approval 的使用者中選擇。
- 審批人失去權限或被停用時不得自動批准；申請須撤回或由有權限管理員重新指派。
- 參數變更不追溯改變已完成結果；進行中申請按提交時規則完成、拒絕、撤回或失效。
- 審批人查看一般提交資料；完整銀行值及 Bank Sensitive 附件仍按銀行權限控制。

### 7.4 Customer Settings 擴充原則

- 提供獨立 Customer Settings 功能，不把參數散落於 Customer 表單。
- 本期唯一已確認的流程參數為「新客戶啟用需要審批」，預設關閉。
- 設定入口可日後加入經業務確認的參數，但不得預先顯示或啟用未確認規則。
- 每項設定須有名稱、說明、預設值、目前值、影響範圍及最後修改資訊。
- 修改前顯示影響，修改時要求原因及重新確認，修改後立即套用於新操作並記錄稽核。
- 設定變更不得無聲修改進行中或歷史流程。

---

## 8. 功能需求

### 8.1 列表、搜尋與篩選

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-LIST-001 | Must | 系統須提供 server-side 分頁的 Customer 列表，預設不顯示 Archived。 |
| FR-LIST-002 | Must | 可用完整或部分 Customer Code、Legal Name、Trading／Display Name、識別號、電話、Email 及地址搜尋。 |
| FR-LIST-003 | Must | Code及名稱搜尋不區分英文字母大小寫並忽略輸入首尾空白；精確 Code 結果優先。 |
| FR-LIST-004 | Must | 可依狀態、預設幣別、付款條件、Account Manager、分類、行業、地區、Credit Status及建立／更新日期篩選。 |
| FR-LIST-005 | Must | 可篩選缺少默認送貨地址、帳單地址、默認聯絡人、付款條件、信用資料、銀行帳戶或附件的 Customer。 |
| FR-LIST-006 | Must | 可依 Customer Code、Legal Name、狀態、Account Manager及更新時間排序。 |
| FR-LIST-007 | Must | 列表至少顯示 Code、Legal／Display Name、主要聯絡方式、默認幣別、付款條件、Account Manager、Credit Status、狀態及更新時間。 |
| FR-LIST-008 | Must | 未具銀行查看權限時不得在列表、搜尋建議或匯出顯示完整銀行帳號或可推導完整值的資料。 |
| FR-LIST-009 | Should | 可由 URL 保留搜尋、篩選、排序及分頁狀態；本期不要求跨裝置保存個人篩選。 |
| FR-LIST-010 | Must | 空結果、載入中、系統錯誤及無權限狀態須清楚區分。 |

### 8.2 查看詳情

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-VIEW-001 | Must | Customer 詳情須顯示一般主資料、狀態、地址、聯絡人、識別資料、交易預設、信用資料及業務分類。 |
| FR-VIEW-002 | Must | 銀行資料及敏感銀行附件須按權限顯示遮蔽摘要、完整內容或不可存取狀態。 |
| FR-VIEW-003 | Must | 一般附件須按狀態、類型及排序顯示；無權限內容不可只靠前端隱藏。 |
| FR-VIEW-004 | Must | 有權限者可查看變更歷史，包括操作者、時間、動作、原因及適當遮蔽的前後值。 |
| FR-VIEW-005 | Should | 下游模組存在時，可顯示訂單、發貨、退貨、發票、應收、收退款摘要或連結，但不得在本模組重算交易結果。 |
| FR-VIEW-006 | Must | Draft、Pending Approval、Suspended、Blocked及Archived須有明顯狀態標示及不可建立新交易的提示。 |

### 8.3 新增及啟用 Customer

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-CREATE-001 | Must | customer.mgmt 使用者可建立 Draft Customer。 |
| FR-CREATE-002 | Must | Customer Code 由使用者人工輸入，不自動產生亦不強制指定格式。 |
| FR-CREATE-003 | Must | 儲存前驗證 Customer Code、Legal Name及已填寫識別資料的全公司唯一性。 |
| FR-CREATE-004 | Must | Legal Name重複時直接阻止建立，不提供忽略警告後繼續的入口。 |
| FR-CREATE-005 | Should | Trading／Display Name相同或資料高度相似時可提示候選，但不得取代Legal Name硬性唯一規則。 |
| FR-CREATE-006 | Must | Active最低必填只包括Customer Code、Legal Name及有效Default Currency。 |
| FR-CREATE-007 | Must | 審批參數關閉時，建檔人可直接啟用完整Draft Customer。 |
| FR-CREATE-008 | Must | 審批參數開啟時，建檔人須指定合資格的另一名審批人並提交。 |
| FR-CREATE-009 | Must | 儲存、直接啟用或提交成功後須顯示Customer Code、目前狀態及下一步。 |

### 8.4 修改一般、商業及信用資料

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-EDIT-001 | Must | customer.mgmt 可修改一般主資料、地址、聯絡人、識別資料、幣別、付款條件、Account Manager、分類、行業、地區及信用資料。 |
| FR-EDIT-002 | Must | Customer Code不得由一般編輯介面修改；如需更正須使用有理由、密碼及已核准設備的特批流程。 |
| FR-EDIT-003 | Must | 修改Legal Name時重新檢查硬性唯一性；已有交易引用時必須填寫原因。 |
| FR-EDIT-004 | Must | 每次修改重新執行唯一性、格式、目錄有效性、狀態及跨欄位驗證。 |
| FR-EDIT-005 | Must | 使用資料版本或等效機制，防止兩人同時編輯時後儲存者無聲覆蓋前者。 |
| FR-EDIT-006 | Must | 修改幣別、付款條件、信用額度、信用幣別、信用狀態、法定識別及其他關鍵資料須記錄原因及前後值。 |
| FR-EDIT-007 | Should | 離開有未儲存變更的表單前提示使用者，版本衝突時保留可複製的輸入。 |
| FR-EDIT-008 | Must | 修改Customer不得回寫既有訂單、出貨、退貨、發票、應收、收退款的名稱、Code、地址、聯絡、幣別、付款條件、信用或銀行快照。 |

### 8.5 暫停、封鎖、封存、刪除及還原

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-STATUS-001 | Must | 只有Active Customer可進入新的銷售交易；Suspended、Blocked及Archived不得被選入新交易。 |
| FR-STATUS-002 | Must | 暫停、封鎖、解除封鎖、封存及還原均須填寫原因並二次確認。 |
| FR-STATUS-003 | Must | 封鎖及解除封鎖須由具有customer.approval的人員執行；解除後只進入Suspended。 |
| FR-STATUS-004 | Must | 封存前顯示未完成訂單、發貨、退貨、發票、應收、收退款或其他阻擋項，不得無聲中斷流程。 |
| FR-STATUS-005 | Must | 已被引用或曾經啟用的Customer不可永久刪除。 |
| FR-STATUS-006 | Must | 只有未被任何資料引用的Draft Customer可由有權限者永久刪除。 |
| FR-STATUS-007 | Must | Archived預設不出現在日常列表及新交易選擇器，但可經明確篩選查回。 |
| FR-STATUS-008 | Must | 還原Archived Customer時進入Suspended，重新檢查唯一值、幣別及依賴後方可啟用。 |

### 8.6 地址、聯絡人及識別資料

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-PARTY-001 | Must | 可新增、修改、停用、排序多個地址及為每個地址設定多個用途。 |
| FR-PARTY-002 | Must | 每種地址用途可有多個有效地址，但最多一個默認地址。 |
| FR-PARTY-003 | Must | 可新增、修改、停用、排序多名聯絡人，且每人可同時屬於多個用途。 |
| FR-PARTY-004 | Must | 每個聯絡用途可有多名有效聯絡人，但最多一名默認聯絡人。 |
| FR-PARTY-005 | Must | 設定新默認地址或聯絡人時，原默認記錄須在同一操作取消。 |
| FR-PARTY-006 | Must | 發貨時只可從該Customer的有效送貨地址選擇，並預選默認送貨地址；不得提交臨時自由文字地址。 |
| FR-PARTY-007 | Must | 已引用地址、聯絡人及識別資料不可破壞歷史語意；修改或停用不回寫交易快照。 |
| FR-PARTY-008 | Must | 識別資料有值時按類型、國家／地區及正規化證號檢查唯一。 |

### 8.7 信用資料

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-CREDIT-001 | Must | customer.mgmt 可新增、修改或清除選填的Credit Limit、Credit Currency、Credit Status及Credit Notes。 |
| FR-CREDIT-002 | Must | 未設定Credit Limit須以明確空值表示，不可被轉換或顯示為0。 |
| FR-CREDIT-003 | Must | Credit Limit為0須表示明確不提供信用；金額不得為負，設定金額時Credit Currency必填且有效。 |
| FR-CREDIT-004 | Must | 修改Credit Limit、Credit Currency或Credit Status時須填寫原因並保存前後值。 |
| FR-CREDIT-005 | Must | Customer Management只提供信用政策，不計算應收、逾期、未開票出貨、信用暴露或可用額度。 |
| FR-CREDIT-006 | Must | 下游提交信用交易時須取得最新信用政策並結合AR資料重新判斷，不可只依賴畫面載入時的結果。 |
| FR-CREDIT-007 | Must | customer.mgmt不等同信用超額／逾期豁免權限；豁免由Sales／AR定義並獨立稽核。 |

### 8.8 銀行資料

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-BANK-001 | Must | customer.bank.mgmt 可新增、修改、停用及設定默認銀行帳戶。 |
| FR-BANK-002 | Must | customer.bank.view才可主動查看完整帳號；其他使用者只可查看遮蔽值。 |
| FR-BANK-003 | Must | 同一Customer最多一個有效默認銀行帳戶，亦允許沒有默認帳戶。 |
| FR-BANK-004 | Must | 銀行資料為選填，缺少銀行資料不得阻止Customer啟用或銷售下單。 |
| FR-BANK-005 | Must | 銀行帳戶被收款、退款、對賬或其他資料引用後不可永久刪除，只可停用。 |
| FR-BANK-006 | Must | 新增、修改、停用、主動查看完整值及變更默認帳戶均須記錄安全稽核。 |
| FR-BANK-007 | Must | 一般匯入、匯出、通知、URL、分析追蹤、日誌及錯誤不得包含完整帳號。 |

### 8.9 附件

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-FILE-001 | Must | customer.mgmt 可上傳、修改顯示資料、排序及停用一般附件。 |
| FR-FILE-002 | Must | Bank Sensitive附件只可由customer.bank.view查看，並只可由同時具有customer.bank.view及customer.bank.mgmt的人維護。 |
| FR-FILE-003 | Must | 上傳只接受核准格式及大小，須驗證副檔名、MIME、內容簽章及檔案路徑安全。 |
| FR-FILE-004 | Must | 一般附件及敏感附件的每次上傳、查看、下載、修改、停用及刪除嘗試須按敏感度稽核。 |
| FR-FILE-005 | Must | 被交易、審批或稽核引用的附件不可物理刪除；只有屬於未被引用Draft Customer且附件本身亦未被引用時，方可受控永久刪除。 |
| FR-FILE-006 | Must | 附件選填且不影響Customer啟用；需要文件的下游流程在使用時自行阻擋。 |
| FR-FILE-007 | Should | 圖片可安全預覽，PDF以受控方式顯示或下載；不得在瀏覽器執行未知內容。 |

### 8.10 啟用審批

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-APPROVAL-001 | Must | 系統按提交時的Customer Settings決定直接啟用或進入Pending Approval。 |
| FR-APPROVAL-002 | Must | 需要審批時，建檔人必須選擇另一名有效且具有customer.approval的使用者。 |
| FR-APPROVAL-003 | Must | 審批人可查看提交時的一般資料快照，但完整銀行值及Bank Sensitive附件仍受銀行權限限制。 |
| FR-APPROVAL-004 | Must | 批准後Customer進入Active；拒絕後返回Draft並保存拒絕原因。 |
| FR-APPROVAL-005 | Must | 建檔人可在決定前撤回；Code、Legal Name、Default Currency或其他關鍵資料變更使原申請失效並要求重提。 |
| FR-APPROVAL-006 | Must | 提交、撤回、批准、拒絕、重新指派及失效均須保存操作者、時間、理由及稽核。 |
| FR-APPROVAL-007 | Must | 重複提交、批准、拒絕或並發決定不得造成多次或矛盾狀態變更。 |

### 8.11 Customer Settings

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-SET-001 | Must | 提供獨立Customer Settings頁面或功能。 |
| FR-SET-002 | Must | 只有customer.settings可查看及修改設定；一般查看、管理或審批權限不可繞過。 |
| FR-SET-003 | Must | 本期支援「新客戶啟用需要審批」布林參數，預設為關閉。 |
| FR-SET-004 | Must | 修改前顯示影響，修改時要求原因及重新確認，修改後保存前後值和操作者。 |
| FR-SET-005 | Must | 設定變更不追溯改寫已完成或進行中的審批。 |
| FR-SET-006 | Should | 設定入口可容納日後經批准的新參數，但未定義參數不得顯示或產生效果。 |

### 8.12 CSV批量匯入及匯出

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-IMPORT-001 | Must | 提供含版本、欄位說明及範例的一般Customer CSV範本。 |
| FR-IMPORT-002 | Must | 匯入至少包含上傳、預檢、確認執行及結果下載；預檢不得寫入正式資料。 |
| FR-IMPORT-003 | Must | 預檢逐列顯示新增、更新、警告或錯誤，並指出欄位、穩定錯誤碼及可理解原因。 |
| FR-IMPORT-004 | Must | 確認後採資料列級部分成功；每列Customer及其地址、聯絡人、識別及信用資料必須全有或全無。 |
| FR-IMPORT-005 | Must | 合法列可成功，錯誤列不得寫入；結果提供總數、成功、失敗、略過及警告數並可下載。 |
| FR-IMPORT-006 | Must | 更新既有Customer須以穩定Customer ID或Customer Code匹配，並套用相同唯一性、版本及生命週期規則。 |
| FR-IMPORT-007 | Must | 同一上傳或確認請求重送不得重複建立Customer、子資料或審批申請。 |
| FR-IMPORT-008 | Must | 一般匯入及匯出不得包含完整銀行資料、Bank Sensitive附件或檔案內容。 |
| FR-IMPORT-009 | Must | 匯出須遵守當前篩選、使用者權限、資料遮蔽及稽核要求。 |
| FR-IMPORT-010 | Should | 大型匯入在背景執行，使用者可查看進度、逐列結果及完成狀態。 |

### 8.13 稽核與歷史

| 編號 | 優先級 | 需求 |
| --- | --- | --- |
| FR-AUDIT-001 | Must | 記錄Customer、地址、聯絡人、識別、商業預設、信用、銀行、附件、狀態、審批、設定及匯入匯出事件。 |
| FR-AUDIT-002 | Must | 稽核至少包含時間、操作者、動作、對象ID／Code、前後值、原因及request ID。 |
| FR-AUDIT-003 | Must | 一般稽核不得保存完整銀行帳號、敏感附件內容、密碼、Token、設備私鑰或不必要個人資料。 |
| FR-AUDIT-004 | Must | 銀行及Bank Sensitive附件稽核只保存必要遮蔽摘要、欄位變更及存取事件，不複製敏感明文。 |
| FR-AUDIT-005 | Must | 業務資料修改與相應稽核須保持一致結果，不可出現資料成功但稽核遺失。 |
| FR-AUDIT-006 | Must | 一般使用者不可修改或刪除稽核歷史。 |
| FR-AUDIT-007 | Should | 可依Customer Code、操作者、動作、對象類型及時間範圍查詢歷史。 |

---

## 9. 業務規則

| 編號 | 規則 |
| --- | --- |
| BR-001 | 系統只服務單一公司；Customer Code、Legal Name及識別資料唯一性均以全公司為範圍。 |
| BR-002 | 每個Customer代表一個批發交易及結算的公司主體；本期不管理個人零售會員。 |
| BR-003 | 本期不建立Customer母子層級或共享信用；分店、倉庫及收貨點屬同一Customer的地址。 |
| BR-004 | 所有下游資料以Customer ID關聯，不得以Code、名稱、地址文字或銀行帳號作永久外鍵。 |
| BR-005 | Customer Code人工輸入，不套用固定格式；trim及忽略英文大小寫後在所有狀態全域唯一。 |
| BR-006 | Legal Name trim、Unicode正規化及不分英文字母大小寫比較後必須全域唯一，Archived亦持續占用。 |
| BR-007 | 識別資料有值時，類型、簽發國家／地區及正規化證號組合必須唯一。 |
| BR-008 | Active Customer最低必填為Customer Code、Legal Name及有效Default Currency。 |
| BR-009 | 地址、聯絡人、付款條件、信用、識別、銀行及附件均不是啟用必要條件。 |
| BR-010 | 每個地址用途可有多筆有效地址，但最多一個默認地址；設定新默認值必須原子取消舊值。 |
| BR-011 | 銷售下單只引用Customer；送貨地址在發貨時選擇，預選該Customer的有效默認送貨地址。 |
| BR-012 | 發貨不得使用未保存的臨時地址；沒有有效送貨地址時不得確認發貨。 |
| BR-013 | 每個聯絡用途可有多名有效聯絡人，但最多一名默認聯絡人；同一聯絡人可屬多個用途。 |
| BR-014 | Active Customer必須有有效Default Currency；HKD為預設選項但可選其他有效幣別。 |
| BR-015 | Default Payment Term為選填；未設定不阻擋啟用，且下游不可猜測一個值。 |
| BR-016 | Account Manager、分類、行業及地區只作歸屬、搜尋及報表，不限制其他獲授權使用者。 |
| BR-017 | 信用政策為選填；Credit Limit未設定、Credit Limit為0及Credit Status為On Hold是三種不同語意。 |
| BR-018 | Credit Limit不得為負；有值時Credit Currency必須存在且有效。 |
| BR-019 | 應收、逾期、未開票出貨、信用暴露及可用額度由AR／Sales計算，不回寫成Customer主檔事實。 |
| BR-020 | customer.mgmt可修改信用資料，但不自動取得超額、逾期或On Hold交易豁免能力。 |
| BR-021 | Customer Management不保存或計算客戶專屬價格、折扣、價目表、促銷或匯率。 |
| BR-022 | 啟用審批參數預設關閉；關閉時customer.mgmt可直接啟用完整Customer。 |
| BR-023 | 審批參數開啟時，建檔人與審批人必須不同，審批人須為有效customer.approval使用者。 |
| BR-024 | Pending Approval的Code、Legal Name、Default Currency或其他關鍵資料被修改後，原申請不得繼續批准。 |
| BR-025 | 只有Active Customer可建立新的銷售或新的信用交易；下游提交時必須重新驗證。人工新增Invoice亦視為新交易。 |
| BR-026 | Suspended、Blocked及Archived不應只因Customer狀態而阻止既有已確認訂單的履約、已出貨交易開票、既有應收的收款／貸項、合法歷史退貨及歷史查詢；下游仍須驗證來源單據、Customer／子資料ownership、子資料有效狀態及操作者權限。 |
| BR-027 | Blocked的封鎖及解除須由customer.approval執行並填原因；解除後先進入Suspended。 |
| BR-028 | Archived還原後先進入Suspended，不自動恢復新交易資格。 |
| BR-029 | 只有從未被任何資料引用的Draft Customer可永久刪除。 |
| BR-030 | Customer可有多個銀行帳戶，但同時間最多一個有效默認帳戶。 |
| BR-031 | 未具銀行查看權限者不得從列表、詳情、附件、稽核、CSV、通知、URL、日誌或錯誤取得完整帳號。 |
| BR-032 | Bank Sensitive附件沿用銀行資料權限；一般Customer權限不可查看或維護其內容。 |
| BR-033 | Customer Code只可透過理由、密碼及已核准設備的高強度特批流程修改，並保持唯一。 |
| BR-034 | 已被交易引用的Customer修改Legal Name必須填原因並保留完整前後值稽核。 |
| BR-035 | 主資料、地址、聯絡人、幣別、付款條件、信用或銀行資料不得回寫既有交易快照。 |
| BR-036 | UI、CSV匯入及整合API必須套用相同的唯一性、狀態、版本、權限及審批規則。 |
| BR-037 | CSV採資料列級部分成功；每列Customer aggregate必須全有或全無。 |
| BR-038 | Customer更新須檢查資料版本，版本不一致時拒絕無聲覆蓋。 |
| BR-039 | 所有時間以系統統一時區顯示及保存，沿用ERP既有時間政策。 |
| BR-040 | Legal Name、地址、聯絡、備註及CSV自由文字須安全處理，不得執行腳本或危險標記。 |
| BR-041 | 停用幣別、付款條件、地址、聯絡人、銀行或附件不可再指派或選入新流程，但歷史須保留。 |
| BR-042 | 使用者在畫面選擇Customer、地址、聯絡人或銀行帳戶後，下游提交時須重新驗證狀態及所有權。 |

## 10. 使用者體驗要求

### 10.1 導航與頁面

- 左側菜單新增「客戶管理」，至少包含Customer列表、待我審批、匯入任務及Customer Settings；入口按權限顯示。
- Customer詳情建議分為概覽、地址、聯絡人、識別資料、交易預設、信用、銀行、附件及變更歷史。
- Draft頁持續顯示Active最低條件及非阻擋的完整度提示。
- Pending Approval顯示提交人、指定審批人、提交時間、提交資料摘要及目前狀態。
- Suspended、Blocked及Archived以文字、圖示及語意色同時表示，不只依賴顏色。
- 高影響操作顯示Customer Code、公司名稱、業務影響，要求原因及明確二次確認。
- 成功訊息須包含可辨識對象，例如「Customer CUS-001已暫停」，不可只顯示「成功」。

### 10.2 地址及發貨選擇

- 銷售訂單Customer選擇畫面不得強迫使用者提前選送貨地址。
- 發貨畫面只列出所選Customer目前有效且具Shipping用途的地址。
- 有默認Shipping地址時自動預選，但使用者仍可改選其他有效Shipping地址。
- 沒有有效Shipping地址時顯示明確阻擋及前往Customer維護的入口，不提供自由文字替代欄位。
- 地址選項顯示地址名稱、收件公司／部門、主要地址行、城市及地區，避免只顯示無法辨識的內部ID。
- 地址在選擇後被停用或改屬其他Customer時，發貨提交必須拒絕並要求重新選擇。

### 10.3 聯絡人選擇

- 每個用途可顯示多名有效聯絡人，默認聯絡人優先並清楚標示。
- 下游使用者可改選同用途其他有效聯絡人，不得被默認值強制鎖定。
- 聯絡人不存在或沒有默認值時，應顯示「未設定」，不得顯示空白而令人誤判載入失敗。

### 10.4 銀行及附件體驗

- 完整銀行帳號及Bank Sensitive附件的查看必須由使用者主動觸發，並提示查看會被稽核。
- 一般畫面預設只顯示遮蔽帳號；短帳號不得因保留過多字元而近乎完整暴露。
- Reveal應在短時間後、離開頁面、session失效或元件卸載時清除，不寫入URL、本機儲存或一般狀態store。
- 一般附件與Bank Sensitive附件在列表中須有清楚分類；無權限者不能從檔名、縮圖或錯誤推測敏感內容。

### 10.5 可用性與無障礙

- 核心CRUD、審批、搜尋、地址選擇、聯絡人選擇及銀行主動查看須可使用鍵盤完成。
- 表單錯誤靠近欄位顯示，並提供可由輔助技術識別及聚焦的錯誤摘要。
- 狀態、信用狀態及敏感級別不得只靠顏色表達。
- 列表、詳情、匯入及附件須區分載入、空資料、無權限、失敗及已過期狀態。
- 批量匯入錯誤須可下載，並能定位原始列、欄位及修正原因。
- UI實作須遵循docs/frontend-design.md的色彩、版面、共用元件、文案、回應式及WCAG 2.1 AA要求。

## 11. 權限、安全與職責分離

| 編號 | 需求 |
| --- | --- |
| SEC-001 | 未登入使用者不可存取任何Customer Management頁面或端點。 |
| SEC-002 | customer.view只允許查看一般Customer資料、一般附件及適當遮蔽的銀行摘要。 |
| SEC-003 | customer.mgmt允許一般資料、信用、地址、聯絡、識別、一般附件CRUD及一般狀態操作，但不包含審批、銀行或設定能力。 |
| SEC-004 | customer.approval允許處理啟用審批、封鎖及解除封鎖；需要審批時不得自我批准。 |
| SEC-005 | customer.bank.view才可主動查看完整銀行資料及Bank Sensitive附件，每次查看或下載須稽核。 |
| SEC-006 | customer.bank.mgmt允許銀行資料及Bank Sensitive附件維護，並必須同時具備customer.bank.view。 |
| SEC-007 | customer.settings允許查看及修改Customer Settings，修改必須要求原因及重新確認。 |
| SEC-008 | 銷售、發貨及財務角色只能在其獲授權流程取得用途所需Customer資料，不因此取得主資料維護能力。 |
| SEC-009 | 後端須防止水平及垂直越權；更換Customer、地址、聯絡人、銀行、附件或審批ID不得跨越所有權。 |
| SEC-010 | 銀行帳號及Bank Sensitive附件在儲存、傳輸、備份、快取、臨時檔、日誌及匯出中須按高敏感資料政策保護。 |
| SEC-011 | 一般稽核、錯誤追蹤、通知及應用日誌不得保存完整銀行帳號、認證憑證或附件內容。 |
| SEC-012 | Customer Code特批修改、永久刪除、封鎖、解除封鎖、銀行維護、敏感附件維護及設定修改須使用重新認證或等效高風險控制。 |
| SEC-013 | CSV、文字、URL及附件須驗證格式、大小與內容；查詢須防SQL注入，輸出須防腳本執行及路徑穿越。 |
| SEC-014 | 批量匯出、大量資料存取、完整銀行查看及敏感附件下載須記錄操作者、條件、時間及結果。 |

## 12. 整合需求

### 12.1 共通整合原則

- 下游系統使用Customer ID關聯，並在交易確認時保存必要快照，例如Customer Code、Legal／Display Name、地址、聯絡人、幣別及付款條件。
- 查詢結果按用途及呼叫方權限只提供必要欄位；一般Customer lookup不得返回完整銀行資料、敏感附件或內部信用備註。
- 建立新交易及重要狀態提交時重新驗證Customer、子記錄所有權及有效狀態。
- 整合建立及更新請求須具重送保護，避免重複Customer、審批或交易引用。
- Customer主檔更改不得改寫已確認的下游交易快照。

### 12.2 Sales／Order Management整合

- 建立銷售訂單時搜尋及選擇Active Customer，訂單只需要Customer ID，不在此階段強制選Shipping Address。
- Customer選定後可帶入Default Currency及Default Payment Term；是否允許覆寫由Sales定義並保存交易快照。
- Customer Management不提供客戶價、折扣、價目表或促銷計算；Sales／Pricing另行處理。
- Sales提交時重新驗證Customer狀態，並在信用政策有設定時結合AR暴露執行信用控制。
- Customer在畫面載入後被暫停、封鎖或封存時，新訂單提交須拒絕並提示重新處理。

### 12.3 Fulfillment／Delivery整合

- 發貨前必須以Customer ID查詢有效Shipping Address，並預選默認地址。
- 使用者可選其他有效Shipping Address，但不可輸入未保存的臨時地址。
- 發貨提交時重新驗證地址仍屬該Customer、仍為Active且具Shipping用途。
- 確認發貨時保存地址及選用聯絡人快照；其後主檔變更不改寫出貨資料。
- 沒有有效Shipping Address時阻止發貨，但不反向停用Customer或取消已存在訂單。

### 12.4 Invoicing／Accounts Receivable整合

- 開票流程取得有效Billing Address及帳單／應收聯絡人，預選各用途默認記錄並保存快照。
- Default Payment Term及Default Currency修改不改變已建立訂單、發票或應收項目。
- AR計算應收、逾期、信用暴露及可用額度；Customer Management只提供最新選填信用政策。
- Credit Limit未設定、0及Credit Status On Hold必須以不同語意傳遞。
- 超額、逾期或On Hold的拒絕、豁免權限、原因及稽核由Sales／AR負責。

### 12.5 Payment／Refund／Reconciliation整合

- 收款匹配、退款或對賬只在具備相應流程與銀行權限時取得有效Customer Bank Account。
- 一般Customer查找不返回完整帳號；Finance流程按最小必要原則主動取得。
- Inactive銀行帳戶不得用於新的退款或匹配，但既有交易保留當時銀行快照。
- Customer沒有銀行資料不阻擋啟用或銷售；需要銀行資料的退款／對賬流程自行提示或阻擋。

### 12.6 Returns整合

- 退貨使用原交易Customer ID及快照；Customer後續Suspended、Blocked或Archived不應令合法歷史退貨無法處理。
- 如退貨需新退款銀行帳戶，必須先受控加入Customer主檔，不能在退貨流程臨時保存未受管銀行資料。
- Returns不得因讀取Customer主檔而覆寫原銷售或出貨快照。

### 12.7 User、Currency、Payment Terms及報表整合

- Account Manager引用有效內部User ID；使用者停用後歷史歸屬保留，Customer顯示需要重新指派提示。
- 幣別及付款條件引用共用有效目錄，不由Customer Management維護重複目錄。
- 報表可按Customer、狀態、Account Manager、分類、行業、地區、幣別及Credit Status彙總。
- 報表及一般匯出不得包含完整銀行資料、Bank Sensitive附件內容或不必要個人聯絡資料。

---

## 13. 非功能需求

### 13.1 效能與容量

| 編號 | 需求 |
| --- | --- |
| NFR-001 | 在最多50名同時在線使用者的正常混合負載下，一般列表、精確Customer Code及精確Legal Name查詢的p95應少於2秒。 |
| NFR-002 | 列表使用server-side分頁，單頁預設20、上限100，沿用ERP既有慣例。 |
| NFR-003 | 建議以100,000 Customer、每Customer 20個地址、50名聯絡人、10個識別資料、10個銀行帳戶及20個附件作容量驗證上限。 |
| NFR-004 | 10,000列一般Customer CSV的預檢及執行系統處理時間合計應在10分鐘內完成，不計使用者停留時間。 |
| NFR-005 | 發貨地址及聯絡人查找在容量基準下仍須符合一般查詢p95目標，且不得出現跨Customer資料。 |

上述容量是技術驗證基準，不是實際業務量預測；正式設計須核對部署規模、資料保留及索引策略。

### 13.2 一致性、可靠性與可用性

| 編號 | 需求 |
| --- | --- |
| NFR-006 | Customer、子資料、信用、銀行、附件、狀態、審批、設定及相應稽核須保持一致結果。 |
| NFR-007 | 同時編輯、默認地址／聯絡人／銀行切換及並發審批不得以最後寫入者無聲覆蓋處理。 |
| NFR-008 | 重複提交建立、匯入、啟用、審批及關鍵狀態請求不得產生重複或矛盾結果。 |
| NFR-009 | Customer主資料、設定、銀行密文、附件及稽核須納入既有備份、還原及災難復原程序。 |
| NFR-010 | 一般Customer查找不可因銀行、附件或非必要下游摘要暫時不可用而暴露敏感資料、開放無效Customer或錯誤改寫資料。 |

### 13.3 隱私、安全與保留

- 銀行帳戶及Bank Sensitive附件屬高敏感資料；法定識別與個人聯絡資料屬敏感資料，須遵循最小收集、最小顯示、最小權限及可追溯原則。
- Customer主資料、銀行metadata、附件metadata及稽核在封存後至少保留7年；若財務、稅務、合約或適用法規要求更長，以較長期限為準。
- 一般CSV原始檔及結果檔建議自工作完成日起保留1年後安全刪除；Job摘要及稽核仍按至少7年保留。
- 附件實體檔及資料庫metadata須以一致的復原點備份；不得只備份其中一方後聲稱可完整還原。
- 永久刪除只適用於未被引用的Draft Customer及符合條件的未引用子資料；必要刪除事件仍須保留。
- 銀行帳號、銀行文件內容、密碼、Token及設備私鑰不得出現在分析參數、URL、一般通知、應用日誌或未加密暫存檔。
- 實際保留期限及合法刪除流程須在上線前由法務／合規確認。

### 13.4 相容性與可維護性

| 編號 | 需求 |
| --- | --- |
| NFR-011 | 欄位、狀態、權限及錯誤代碼須在Web UI、CSV及整合介面保持一致。 |
| NFR-012 | Customer Settings可在不改變既有參數語意下加入經批准的新參數，但不得預先實作未確認規則。 |
| NFR-013 | 幣別、付款條件、國家／地區、用途及分類目錄應引用系統共用或集中定義，避免各模組自行解讀。 |
| NFR-014 | 日期、時間、數字、金額及地址顯示須符合系統語系及APP_TIME_ZONE設定；交換格式不得有時區或小數歧義。 |
| NFR-015 | 生產環境災難復原目標為RTO不超過4小時、RPO不超過15分鐘；宣告復原前須在隔離環境核對資料庫、金鑰環、一般附件、Bank Sensitive附件及稽核記錄為同一可用且一致的恢復集合。 |

## 14. 錯誤與例外處理

| 情境 | 系統行為 |
| --- | --- |
| Customer Code已存在 | 拒絕儲存並指出Code已使用；不得建立部分Customer或審批資料。 |
| Legal Name正規化後已存在 | 硬性拒絕，不提供忽略警告後繼續；按權限提供可辨識的衝突對象。 |
| 識別資料重複 | 拒絕並指出識別類型與地區，不洩漏不必要資料。 |
| Default Currency無效或已停用 | 阻止啟用或相關修改，提示選擇有效幣別。 |
| Credit Limit未設定 | 明確回傳未設定，不顯示為0或自動套用限制。 |
| Credit Limit為負或缺Credit Currency | 拒絕儲存並指出欄位及規則。 |
| 審批人是建檔人、已停用或沒有權限 | 拒絕提交並要求重新選擇。 |
| Pending資料在審批前被關鍵修改 | 原申請失效，不得批准過時版本；要求重新提交。 |
| 重複批准或申請已被他人處理 | 不重複改變狀態，回傳目前狀態及處理結果。 |
| Customer在銷售畫面開啟後被暫停／封鎖 | 新交易提交時重新驗證並拒絕。 |
| 發貨時沒有有效Shipping Address | 阻止確認發貨，提示先到Customer Management新增或啟用地址。 |
| 發貨地址被停用或不屬該Customer | 拒絕提交，不改選其他地址或使用過時值。 |
| 未授權使用者要求完整銀行資料或敏感附件 | 拒絕並記錄安全事件，不返回完整值、檔名線索或內容。 |
| 銀行帳戶重複 | 同一Customer硬性拒絕；跨Customer顯示高風險警告並要求有權限者確認。 |
| 附件格式、內容或大小不合格 | 拒絕並清理暫存檔，不留下metadata或孤兒檔。 |
| 嘗試刪除已引用Customer或子資料 | 拒絕永久刪除，列出引用類型並提供適用狀態操作。 |
| 並發修改衝突 | 拒絕後提交者，提示重新載入並保留可複製輸入。 |
| CSV部分列錯誤 | 合法列按確認成功寫入；錯誤列不寫入並提供逐列結果。 |
| CSV含銀行或敏感附件欄位 | 明確拒絕該欄位，不得靜默忽略或把敏感內容寫入一般資料。 |
| 下游非必要摘要不可用 | Customer核心查詢仍可用，顯示摘要暫不可用；不得放寬狀態或權限。 |

技術設計須為上述情境定義穩定的公開錯誤代碼，供UI、CSV結果及整合方處理；錯誤不得包含SQL、constraint原文、stack、檔案絕對路徑、完整銀行值或其他Customer敏感資料。

## 15. 驗收準則

### 15.1 核心CRUD與唯一性

| 編號 | 驗收準則 |
| --- | --- |
| AC-001 | Given customer.mgmt輸入唯一Customer Code、Legal Name及有效Default Currency，When儲存，Then建立Draft Customer並可在詳情及稽核查到。 |
| AC-002 | Given任一狀態已存在CUS-001，When建立cus-001，Then系統忽略大小寫後拒絕且不建立部分資料。 |
| AC-003 | Given已存在正規化後相同Legal Name，When以另一Code建立或修改，Then系統硬性拒絕且不能忽略後繼續。 |
| AC-004 | Given兩個Customer只有Trading Name相同而Legal Name不同，When建立，Then系統可提示但不因Trading Name阻止合法建立。 |
| AC-005 | Given已存在相同類型、地區及正規化證號，When新增識別資料，Then系統拒絕且原Customer不變。 |
| AC-006 | Given使用者輸入沒有固定模式但非空白、長度合法且唯一的Customer Code，When儲存，Then系統接受且不自行改寫。 |
| AC-007 | Given一般編輯頁，When使用者嘗試修改Customer Code，Then欄位不可編輯且後端亦拒絕偷渡欄位。 |
| AC-008 | Given高強度認證、合法理由及唯一新Code，When執行特批修改，Then保存新Code、版本及完整稽核，歷史交易快照不變。 |

### 15.2 啟用、審批、狀態與刪除

| 編號 | 驗收準則 |
| --- | --- |
| AC-009 | Given審批參數關閉且最低必填完整，When建檔人啟用，ThenCustomer直接Active並記錄啟用事件。 |
| AC-010 | Given審批參數開啟，When建檔人提交，Then須選另一名有效customer.approval使用者，Customer進入Pending Approval。 |
| AC-011 | Given建檔人選擇自己、已停用或無權限使用者，When提交，Then拒絕且Customer保持Draft。 |
| AC-012 | Given合法Pending申請，When指定審批人批准，ThenCustomer進入Active並保存提交及批准資料。 |
| AC-013 | Given合法Pending申請，When審批人填原因拒絕，ThenCustomer返回Draft且建檔人可看到原因。 |
| AC-014 | GivenPending Customer的Code、Legal Name或Default Currency被修改，When審批原申請，Then拒絕過時申請並要求重提。 |
| AC-015 | GivenActive Customer，Whencustomer.mgmt填原因暫停，Then新銷售不可再選，既有交易及歷史仍可查。 |
| AC-016 | GivenBlocked Customer，When沒有customer.approval者嘗試解除，Then後端拒絕且狀態不變。 |
| AC-017 | Givencustomer.approval解除Block，When操作完成，ThenCustomer進入Suspended而非直接Active。 |
| AC-018 | GivenArchived Customer，When還原，Then進入Suspended並重新驗證後方可Active。 |
| AC-019 | Given從未被引用的Draft Customer，When有權限者確認永久刪除，Then資料被刪除並保留必要刪除稽核。 |
| AC-020 | GivenCustomer曾啟用或已被引用，When要求永久刪除，Then系統拒絕並提供暫停、封鎖或封存選項。 |

### 15.3 地址、聯絡人及發貨

| 編號 | 驗收準則 |
| --- | --- |
| AC-021 | Given同一Customer有多個Shipping Address，When建立Sales Order，Then只選Customer而不強制選地址。 |
| AC-022 | GivenCustomer有一個默認及其他有效Shipping Address，When建立Shipment，Then系統預選默認地址並允許改選其他有效地址。 |
| AC-023 | GivenCustomer沒有有效Shipping Address，When確認發貨，Then系統拒絕並提示先維護地址。 |
| AC-024 | Given使用者在發貨畫面輸入未保存地址，When提交，Then系統拒絕且不建立臨時主檔或出貨資料。 |
| AC-025 | Given已選Shipping Address後該地址被停用，When提交Shipment，Then系統重新驗證並拒絕。 |
| AC-026 | Given同一地址用途已有默認地址，When指定另一地址為默認，Then在同一操作取消舊值且只剩一個默認。 |
| AC-027 | Given一個聯絡用途有多名聯絡人，When下游查詢，Then全部有效聯絡人可選，默認者優先且清楚標示。 |
| AC-028 | Given已確認Shipment或Invoice，When之後修改地址或聯絡人，Then歷史交易仍顯示當時快照。 |

### 15.4 商業預設與信用

| 編號 | 驗收準則 |
| --- | --- |
| AC-029 | GivenDefault Currency為HKD或其他有效幣別，When啟用Customer，Then系統接受並供新Sales交易帶入。 |
| AC-030 | GivenDefault Payment Term及信用資料均空白，When啟用Customer，Then允許並只顯示非阻擋完整度提示。 |
| AC-031 | GivenCredit Limit未設定，WhenSales／AR查詢，Then收到明確Not Configured而不是0。 |
| AC-032 | GivenCredit Limit為0且Credit Status為Normal，When查詢政策，Then回傳明確0額度語意並與未設定區分。 |
| AC-033 | Givencustomer.mgmt修改Credit Limit或Credit Status，When保存，Then要求原因並可在稽核查看前後值。 |
| AC-034 | GivenCustomer超額、逾期或On Hold，When持有customer.mgmt者嘗試以該權限豁免交易，Then下游拒絕；只有其專門交易權限才可按流程處理。 |
| AC-035 | GivenCustomer主檔或信用預設改變，When查看既有訂單、發票或應收，Then既有交易快照及實際金額保持不變。 |

### 15.5 銀行與附件

| 編號 | 驗收準則 |
| --- | --- |
| AC-036 | Given只有customer.view的使用者，When查看銀行資料，Then只見遮蔽帳號；直接要求完整值或Bank Sensitive附件亦被拒絕。 |
| AC-037 | Given具有customer.bank.view者主動查看完整帳號或敏感附件，When驗證通過，Then短時顯示／下載並記錄安全稽核。 |
| AC-038 | Given使用者沒有customer.bank.mgmt，When嘗試新增、修改或停用銀行資料，Then後端拒絕且資料不變。 |
| AC-039 | Given已有默認銀行帳戶，When把另一帳戶設為默認，Then原默認在同一操作取消且只保留一個有效默認。 |
| AC-040 | GivenCustomer沒有銀行帳戶，When啟用或建立Sales Order，ThenCustomer Management不阻擋操作。 |
| AC-041 | Given相同帳戶已存在於同一Customer，When再次新增，Then系統拒絕且不暴露完整帳號。 |
| AC-042 | Given合法一般附件及Bank Sensitive附件，When不同權限使用者查看，Then一般附件按customer.view開放，敏感附件只按銀行權限開放。 |
| AC-043 | Given附件副檔名、MIME、內容簽章或大小不符，When上傳，Then系統拒絕且不留下metadata、暫存或孤兒檔。 |

### 15.6 匯入、設定、權限及並發

| 編號 | 驗收準則 |
| --- | --- |
| AC-044 | GivenCSV同時包含合法及錯誤列，When預檢並確認，Then合法列按列完整寫入、錯誤列不寫入且結果可逐列下載。 |
| AC-045 | GivenCSV包含完整銀行帳號或敏感附件內容欄位，When預檢，Then明確拒絕，不寫入一般Customer資料。 |
| AC-046 | Given同一匯入確認請求被重送，When再次收到請求，Then不建立重複Customer、地址、聯絡人或審批。 |
| AC-047 | Given沒有customer.settings者，When呼叫設定修改，Then後端拒絕且參數不變。 |
| AC-048 | Given設定管理員開啟啟用審批，When保存，Then新提交使用審批流程，設定前後值及原因可稽核。 |
| AC-049 | Given審批設定改變時已有Pending申請，When保存，Then進行中申請不被自動批准或改寫。 |
| AC-050 | Given兩人讀取同一Customer版本，When第一人保存後第二人再保存，Then第二人收到版本衝突且不覆蓋第一人的資料。 |
| AC-051 | Given無customer.mgmt者，When直接呼叫Customer寫入功能，Then後端拒絕且無資料或稽核副作用。 |
| AC-052 | Given一般Customer CSV匯出，When有權限者下載，Then檔案符合篩選且不包含完整銀行資料、敏感附件或內部信用備註，匯出事件可稽核。 |

---

## 16. 資料建置與上線需求

### 16.1 初始設定

上線前至少須完成：

- 啟用幣別、公司基礎幣別及付款條件目錄確認；Customer預設幣別選項為HKD。
- 地址用途、聯絡人用途、識別類型、客戶分類、行業及地區目錄確認。
- Customer狀態、Credit Status、狀態原因及高風險操作原因規則確認。
- Account Manager可選使用者範圍及停用後重新指派流程確認。
- 新客戶啟用需要審批參數確認；未配置時必須使用預設關閉。
- customer.view、customer.mgmt、customer.approval、customer.bank.view、customer.bank.mgmt及customer.settings的角色分派和最小權限覆核。
- 一般附件與Bank Sensitive附件的類型、大小、儲存位置、備份及保留規則確認。
- 銀行資料加密、金鑰保管、輪替、遮蔽及短時查看方案完成安全審查。

### 16.2 舊資料導入

- 業務提供來源與目標欄位mapping，明確指定Customer Code、Legal Name、Default Currency及Status。
- 導入前清理重複Customer Code、正規化後重複Legal Name及重複法定識別資料；系統不得自動合併法律實體。
- 舊系統的分店、倉庫及收貨點按地址導入，不得未經確認拆成Customer hierarchy。
- 明確區分Credit Limit未設定與0；缺Credit Currency的額度資料不得自行猜測幣別。
- 地址及聯絡用途、默認值有衝突時輸出例外清單，由業務決定唯一默認記錄。
- 銀行資料及Bank Sensitive附件不透過一般CSV導入；如需遷移，另定安全、授權、加密、核對及回滾方案。
- 正式導入前至少完成一次模擬導入、來源／目標筆數核對、抽樣核對、敏感資料掃描及回滾演練。
- 導入結果核對來源總數、成功、失敗、略過、警告、目標總數及重複拒絕清單。

### 16.3 上線控制

- 上線前凍結舊Customer主資料或定義增量補錄窗口及責任人。
- 完成MySQL、銀行密文、一般附件及Bank Sensitive附件的一致備份與可驗證還原方案。
- 先配置一般、審批、銀行及設定權限，再開放Customer Management入口。
- 完成Draft建立、直接啟用、審批啟用、Legal Name硬性唯一、暫停、封鎖、銀行遮蔽、附件權限、Sales狀態拒絕及Fulfillment地址選擇的端到端smoke test。
- 確認Sales、Fulfillment、Invoicing及AR在提交時重新驗證Customer、地址、聯絡人及信用政策，而不是只使用畫面載入資料。
- 確認一般CSV、日誌、錯誤、通知、URL及監控中不存在完整銀行帳號或敏感附件內容。

## 17. 優先級與建議交付階段

### Phase 1：核心Customer主資料

- Customer CRUD、人工Code、Legal Name硬性唯一、Trading Name、Default Currency及選填Payment Term。
- 多地址、多聯絡人、多用途、默認值及識別資料。
- Account Manager、分類、行業、地區及選填信用政策。
- Draft、Active、Suspended、Blocked、Archived、受控Code修改及刪除。
- 列表、搜尋、篩選、分頁、一般權限、稽核及下游Active Customer lookup。
- Sales只選Customer及Fulfillment發貨時選有效地址的基本contract。

### Phase 2：控制、敏感資料及文件

- Customer Settings及可配置啟用審批。
- Pending Approval、批准、拒絕、撤回、重新指派及失效。
- 銀行加密、獨立查看／維護權限、多帳戶、默認帳戶及主動reveal。
- 一般附件及Bank Sensitive附件、檔案安全、授權及清理。
- 高風險操作及敏感資料存取稽核。

### Phase 3：大量維護及下游完整整合

- 一般Customer CSV預檢、逐列部分成功匯入、結果下載及匯出。
- 大型背景Job、重送防護、檔案保留及清理。
- Sales／Fulfillment／Invoicing／AR／Payment／Refund的完整contract及狀態重驗。
- 資料完整度篩選、下游摘要連結、容量、效能、備份還原及release gate。

交付順序可因依賴調整，但每一Phase的唯一性、狀態、版本、後端權限、敏感資料保護及稽核不可延後到後續Phase補做。

## 18. 已確認決策與待上線確認事項

### 18.1 已確認決策

| 編號 | 決策 | 業務影響 |
| --- | --- | --- |
| DEC-001 | ERP以公司客戶及批發業務為主。 | Customer模型以公司法律／結算主體設計，不建立個人會員流程。 |
| DEC-002 | 同一Customer可有多個地址、分店、倉庫及收貨點。 | 這些資料作Customer子地址，不建立獨立Customer hierarchy。 |
| DEC-003 | Sales下單不選送貨地址，Fulfillment發貨時才選。 | 訂單只引用Customer；發貨從有效Shipping Address選擇並保存快照。 |
| DEC-004 | Shipping Address有默認值供快速選擇。 | 發貨預選默認地址，但允許使用者改選其他有效地址。 |
| DEC-005 | 不允許在發貨時臨時輸入未保存地址。 | 新地址須先受控維護，避免未稽核地址進入出貨。 |
| DEC-006 | 新Customer啟用審批沿用Supplier的可配置模式。 | 預設關閉；開啟後建檔人指定另一名customer.approval使用者。 |
| DEC-007 | Customer Code人工輸入且無固定格式。 | 系統只做trim、安全、長度及全狀態全域唯一驗證。 |
| DEC-008 | 信用資料需要管理但不是必填。 | 未設定不同於0；缺信用資料不阻擋Customer啟用。 |
| DEC-009 | Customer生命週期沿用Draft、Pending、Active、Suspended、Blocked及Archived。 | 非Active不進新交易，歷史仍保留。 |
| DEC-010 | Legal Name重複時直接拒絕。 | 公司名稱正規化後作硬性全公司唯一，不採只警告後繼續。 |
| DEC-011 | 法定識別資料選填，有值時按類型、地區及正規化值唯一。 | 支援不同地區並降低重複法律實體。 |
| DEC-012 | 客戶專屬價格、折扣及促銷由後續模組處理。 | Customer Management不保存或計算定價資料。 |
| DEC-013 | 本期不支援母子公司或Customer Group。 | 每個Customer獨立結算及信用；不同法人分開建檔。 |
| DEC-014 | 信用資料由一般customer.mgmt維護。 | 不設獨立Customer信用管理權限或雙人審批。 |
| DEC-015 | Customer需要統一維護銀行帳戶。 | 收款、退款及對賬後續模組引用受控銀行資料。 |
| DEC-016 | 銀行資料沿用Supplier的獨立權限及遮蔽模式。 | 完整查看與維護分權，銀行資料選填且採高敏感保護。 |
| DEC-017 | Customer CSV採逐列部分成功。 | 合法列可寫入；每列Customer aggregate仍須全有或全無。 |
| DEC-018 | 銀行及敏感附件不進一般CSV。 | 敏感資料遷移須另定安全流程。 |
| DEC-019 | 每個聯絡用途可有多名聯絡人。 | 下游可選多名有效聯絡人，每用途仍可有一名默認值。 |
| DEC-020 | Customer可設定非HKD預設交易幣別。 | 預設HKD，其他有效幣別可選；匯率及會計換算不屬本模組。 |
| DEC-021 | 可選填主要Account Manager、分類、行業及地區。 | 支援搜尋與報表，但不實施銷售團隊資料隔離。 |
| DEC-022 | Customer Code更正使用高強度特批；Legal Name已有引用時修改須原因。 | 保持識別穩定並以交易快照保護歷史。 |
| DEC-023 | 本期需要一般及敏感附件。 | 支援公司證明、信用申請及銀行證明，但不做OCR、簽署或到期工作流。 |

### 18.2 待技術設計及上線前確認

以下不改變已確認核心業務意圖，但須在設計或上線前定案：

- Customer Code、Legal Name、Trading Name、地址、聯絡及備註欄位的實際最大長度與安全字元政策。
- Legal Name的Unicode、標點、空白及公司後綴正規化細節；規則須可預測，不能把不同法人錯誤合併。
- 幣別、付款條件、地址用途、聯絡用途、識別類型、Customer Category、Industry、Territory及Credit Status的初始目錄。
- 信用額度金額精度、Credit Currency與多幣別暴露換算的下游contract。
- Block、Archive及Delete的實際下游reference類型與未完成流程阻擋矩陣。
- 銀行加密、blind index、金鑰管理、備份、輪替、遮蔽及短時reveal的技術方案。
- 附件單檔大小、總容量、儲存、惡意檔掃描、預覽、孤兒檔清理及敏感附件備份方案。
- 大型CSV檔案大小、背景執行門檻、Job通知方式及結果檔保留清理設定。
- 100,000 Customer容量基準、50名並發及2秒p95的正式驗收環境與錯誤率門檻。
- Customer主資料、稽核、銀行及附件至少7年、CSV檔案建議1年的法務／合規核對。

## 19. 需求追溯摘要及簽核

### 19.1 追溯摘要

| 業務目標 | 主要需求範圍 | 驗收準則 |
| --- | --- | --- |
| 單一可靠Customer主檔 | FR-LIST、FR-VIEW、FR-CREATE、FR-EDIT | AC-001～AC-008、AC-050～AC-052 |
| 可控啟用及生命週期 | FR-APPROVAL、FR-SET、FR-STATUS | AC-009～AC-020、AC-047～AC-049 |
| 地址、聯絡與發貨準確 | FR-PARTY | AC-021～AC-028 |
| 選填商業預設及信用 | FR-CREDIT、FR-EDIT | AC-029～AC-035 |
| 銀行及附件保護 | FR-BANK、FR-FILE | AC-036～AC-043 |
| 批量維護及可追溯 | FR-IMPORT、FR-AUDIT | AC-044～AC-046、AC-052 |

### 19.2 簽核建議

本文件建議由以下角色共同確認：

- 銷售業務負責人：確認公司客戶、Sales只選Customer、交易預設及Customer狀態規則。
- 倉務／發貨負責人：確認發貨時地址選擇、默認值、禁止臨時地址及快照要求。
- 財務／應收負責人：確認付款條件、信用語意、銀行資料及收退款／對賬邊界。
- 資訊安全／系統管理負責人：確認銀行與敏感附件、權限拆分、高風險認證及稽核。
- Product Owner／業務負責人：確認範圍、審批預設、優先級、成功指標及明確排除項。
- 技術及QA負責人：確認需求可實作、可測試，並將所有Must項轉為設計與測試覆蓋。

本文件簽核後，任何新增的Customer hierarchy、共享信用、客戶定價、一次性送貨地址、銀行／信用雙人審批、資料列級銷售隔離、OCR、電子簽署或客戶自助入口均視為範圍變更，必須更新需求、影響分析及驗收準則後再實作。

<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal Requirement Definitions

## FR-001 — FR-LIST-001

### Statement

完整規範為上方保留原文中的 `FR-LIST-001`；`FR-001` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-002 — FR-LIST-002

### Statement

完整規範為上方保留原文中的 `FR-LIST-002`；`FR-002` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-003 — FR-LIST-003

### Statement

完整規範為上方保留原文中的 `FR-LIST-003`；`FR-003` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-004 — FR-LIST-004

### Statement

完整規範為上方保留原文中的 `FR-LIST-004`；`FR-004` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-005 — FR-LIST-005

### Statement

完整規範為上方保留原文中的 `FR-LIST-005`；`FR-005` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-006 — FR-LIST-006

### Statement

完整規範為上方保留原文中的 `FR-LIST-006`；`FR-006` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-007 — FR-LIST-007

### Statement

完整規範為上方保留原文中的 `FR-LIST-007`；`FR-007` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-008 — FR-LIST-008

### Statement

完整規範為上方保留原文中的 `FR-LIST-008`；`FR-008` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-009 — FR-LIST-009

### Statement

完整規範為上方保留原文中的 `FR-LIST-009`；`FR-009` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-010 — FR-LIST-010

### Statement

完整規範為上方保留原文中的 `FR-LIST-010`；`FR-010` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-011 — FR-VIEW-001

### Statement

完整規範為上方保留原文中的 `FR-VIEW-001`；`FR-011` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-012 — FR-VIEW-002

### Statement

完整規範為上方保留原文中的 `FR-VIEW-002`；`FR-012` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-013 — FR-VIEW-003

### Statement

完整規範為上方保留原文中的 `FR-VIEW-003`；`FR-013` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-014 — FR-VIEW-004

### Statement

完整規範為上方保留原文中的 `FR-VIEW-004`；`FR-014` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-015 — FR-VIEW-005

### Statement

完整規範為上方保留原文中的 `FR-VIEW-005`；`FR-015` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-016 — FR-VIEW-006

### Statement

完整規範為上方保留原文中的 `FR-VIEW-006`；`FR-016` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-017 — FR-CREATE-001

### Statement

完整規範為上方保留原文中的 `FR-CREATE-001`；`FR-017` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-018 — FR-CREATE-002

### Statement

完整規範為上方保留原文中的 `FR-CREATE-002`；`FR-018` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-019 — FR-CREATE-003

### Statement

完整規範為上方保留原文中的 `FR-CREATE-003`；`FR-019` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-020 — FR-CREATE-004

### Statement

完整規範為上方保留原文中的 `FR-CREATE-004`；`FR-020` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-021 — FR-CREATE-005

### Statement

完整規範為上方保留原文中的 `FR-CREATE-005`；`FR-021` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-022 — FR-CREATE-006

### Statement

完整規範為上方保留原文中的 `FR-CREATE-006`；`FR-022` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-023 — FR-CREATE-007

### Statement

完整規範為上方保留原文中的 `FR-CREATE-007`；`FR-023` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-024 — FR-CREATE-008

### Statement

完整規範為上方保留原文中的 `FR-CREATE-008`；`FR-024` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-025 — FR-CREATE-009

### Statement

完整規範為上方保留原文中的 `FR-CREATE-009`；`FR-025` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-026 — FR-EDIT-001

### Statement

完整規範為上方保留原文中的 `FR-EDIT-001`；`FR-026` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-027 — FR-EDIT-002

### Statement

完整規範為上方保留原文中的 `FR-EDIT-002`；`FR-027` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-028 — FR-EDIT-003

### Statement

完整規範為上方保留原文中的 `FR-EDIT-003`；`FR-028` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-029 — FR-EDIT-004

### Statement

完整規範為上方保留原文中的 `FR-EDIT-004`；`FR-029` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-030 — FR-EDIT-005

### Statement

完整規範為上方保留原文中的 `FR-EDIT-005`；`FR-030` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-031 — FR-EDIT-006

### Statement

完整規範為上方保留原文中的 `FR-EDIT-006`；`FR-031` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-032 — FR-EDIT-007

### Statement

完整規範為上方保留原文中的 `FR-EDIT-007`；`FR-032` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-033 — FR-EDIT-008

### Statement

完整規範為上方保留原文中的 `FR-EDIT-008`；`FR-033` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-034 — FR-STATUS-001

### Statement

完整規範為上方保留原文中的 `FR-STATUS-001`；`FR-034` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-035 — FR-STATUS-002

### Statement

完整規範為上方保留原文中的 `FR-STATUS-002`；`FR-035` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-036 — FR-STATUS-003

### Statement

完整規範為上方保留原文中的 `FR-STATUS-003`；`FR-036` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-037 — FR-STATUS-004

### Statement

完整規範為上方保留原文中的 `FR-STATUS-004`；`FR-037` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-038 — FR-STATUS-005

### Statement

完整規範為上方保留原文中的 `FR-STATUS-005`；`FR-038` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-039 — FR-STATUS-006

### Statement

完整規範為上方保留原文中的 `FR-STATUS-006`；`FR-039` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-040 — FR-STATUS-007

### Statement

完整規範為上方保留原文中的 `FR-STATUS-007`；`FR-040` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-041 — FR-STATUS-008

### Statement

完整規範為上方保留原文中的 `FR-STATUS-008`；`FR-041` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-042 — FR-PARTY-001

### Statement

完整規範為上方保留原文中的 `FR-PARTY-001`；`FR-042` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-043 — FR-PARTY-002

### Statement

完整規範為上方保留原文中的 `FR-PARTY-002`；`FR-043` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-044 — FR-PARTY-003

### Statement

完整規範為上方保留原文中的 `FR-PARTY-003`；`FR-044` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-045 — FR-PARTY-004

### Statement

完整規範為上方保留原文中的 `FR-PARTY-004`；`FR-045` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-046 — FR-PARTY-005

### Statement

完整規範為上方保留原文中的 `FR-PARTY-005`；`FR-046` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-047 — FR-PARTY-006

### Statement

完整規範為上方保留原文中的 `FR-PARTY-006`；`FR-047` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-048 — FR-PARTY-007

### Statement

完整規範為上方保留原文中的 `FR-PARTY-007`；`FR-048` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-049 — FR-PARTY-008

### Statement

完整規範為上方保留原文中的 `FR-PARTY-008`；`FR-049` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-050 — FR-CREDIT-001

### Statement

完整規範為上方保留原文中的 `FR-CREDIT-001`；`FR-050` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-051 — FR-CREDIT-002

### Statement

完整規範為上方保留原文中的 `FR-CREDIT-002`；`FR-051` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-052 — FR-CREDIT-003

### Statement

完整規範為上方保留原文中的 `FR-CREDIT-003`；`FR-052` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-053 — FR-CREDIT-004

### Statement

完整規範為上方保留原文中的 `FR-CREDIT-004`；`FR-053` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-054 — FR-CREDIT-005

### Statement

完整規範為上方保留原文中的 `FR-CREDIT-005`；`FR-054` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-055 — FR-CREDIT-006

### Statement

完整規範為上方保留原文中的 `FR-CREDIT-006`；`FR-055` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-056 — FR-CREDIT-007

### Statement

完整規範為上方保留原文中的 `FR-CREDIT-007`；`FR-056` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-057 — FR-BANK-001

### Statement

完整規範為上方保留原文中的 `FR-BANK-001`；`FR-057` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-058 — FR-BANK-002

### Statement

完整規範為上方保留原文中的 `FR-BANK-002`；`FR-058` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-059 — FR-BANK-003

### Statement

完整規範為上方保留原文中的 `FR-BANK-003`；`FR-059` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-060 — FR-BANK-004

### Statement

完整規範為上方保留原文中的 `FR-BANK-004`；`FR-060` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-061 — FR-BANK-005

### Statement

完整規範為上方保留原文中的 `FR-BANK-005`；`FR-061` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-062 — FR-BANK-006

### Statement

完整規範為上方保留原文中的 `FR-BANK-006`；`FR-062` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-063 — FR-BANK-007

### Statement

完整規範為上方保留原文中的 `FR-BANK-007`；`FR-063` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-064 — FR-FILE-001

### Statement

完整規範為上方保留原文中的 `FR-FILE-001`；`FR-064` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-065 — FR-FILE-002

### Statement

完整規範為上方保留原文中的 `FR-FILE-002`；`FR-065` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-066 — FR-FILE-003

### Statement

完整規範為上方保留原文中的 `FR-FILE-003`；`FR-066` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-067 — FR-FILE-004

### Statement

完整規範為上方保留原文中的 `FR-FILE-004`；`FR-067` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-068 — FR-FILE-005

### Statement

完整規範為上方保留原文中的 `FR-FILE-005`；`FR-068` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-069 — FR-FILE-006

### Statement

完整規範為上方保留原文中的 `FR-FILE-006`；`FR-069` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-070 — FR-FILE-007

### Statement

完整規範為上方保留原文中的 `FR-FILE-007`；`FR-070` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-071 — FR-APPROVAL-001

### Statement

完整規範為上方保留原文中的 `FR-APPROVAL-001`；`FR-071` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-072 — FR-APPROVAL-002

### Statement

完整規範為上方保留原文中的 `FR-APPROVAL-002`；`FR-072` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-073 — FR-APPROVAL-003

### Statement

完整規範為上方保留原文中的 `FR-APPROVAL-003`；`FR-073` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-074 — FR-APPROVAL-004

### Statement

完整規範為上方保留原文中的 `FR-APPROVAL-004`；`FR-074` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-075 — FR-APPROVAL-005

### Statement

完整規範為上方保留原文中的 `FR-APPROVAL-005`；`FR-075` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-076 — FR-APPROVAL-006

### Statement

完整規範為上方保留原文中的 `FR-APPROVAL-006`；`FR-076` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-077 — FR-APPROVAL-007

### Statement

完整規範為上方保留原文中的 `FR-APPROVAL-007`；`FR-077` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-078 — FR-SET-001

### Statement

完整規範為上方保留原文中的 `FR-SET-001`；`FR-078` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-079 — FR-SET-002

### Statement

完整規範為上方保留原文中的 `FR-SET-002`；`FR-079` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-080 — FR-SET-003

### Statement

完整規範為上方保留原文中的 `FR-SET-003`；`FR-080` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-081 — FR-SET-004

### Statement

完整規範為上方保留原文中的 `FR-SET-004`；`FR-081` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-082 — FR-SET-005

### Statement

完整規範為上方保留原文中的 `FR-SET-005`；`FR-082` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-083 — FR-SET-006

### Statement

完整規範為上方保留原文中的 `FR-SET-006`；`FR-083` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-084 — FR-IMPORT-001

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-001`；`FR-084` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-085 — FR-IMPORT-002

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-002`；`FR-085` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-086 — FR-IMPORT-003

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-003`；`FR-086` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-087 — FR-IMPORT-004

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-004`；`FR-087` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-088 — FR-IMPORT-005

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-005`；`FR-088` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-089 — FR-IMPORT-006

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-006`；`FR-089` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-090 — FR-IMPORT-007

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-007`；`FR-090` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-091 — FR-IMPORT-008

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-008`；`FR-091` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-092 — FR-IMPORT-009

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-009`；`FR-092` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-093 — FR-IMPORT-010

### Statement

完整規範為上方保留原文中的 `FR-IMPORT-010`；`FR-093` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-094 — FR-AUDIT-001

### Statement

完整規範為上方保留原文中的 `FR-AUDIT-001`；`FR-094` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-095 — FR-AUDIT-002

### Statement

完整規範為上方保留原文中的 `FR-AUDIT-002`；`FR-095` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-096 — FR-AUDIT-003

### Statement

完整規範為上方保留原文中的 `FR-AUDIT-003`；`FR-096` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-097 — FR-AUDIT-004

### Statement

完整規範為上方保留原文中的 `FR-AUDIT-004`；`FR-097` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-098 — FR-AUDIT-005

### Statement

完整規範為上方保留原文中的 `FR-AUDIT-005`；`FR-098` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-099 — FR-AUDIT-006

### Statement

完整規範為上方保留原文中的 `FR-AUDIT-006`；`FR-099` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## FR-100 — FR-AUDIT-007

### Statement

完整規範為上方保留原文中的 `FR-AUDIT-007`；`FR-100` 是一對一 canonical alias，不改變原 Priority、Actor、Rules 或資料語義。

### Acceptance criteria

須滿足保留原文中對應的 Given/When/Then 驗收條件、適用 BR/AC，以及 `07_uat_test_cases.md` 的 baseline-bound 業務結果。

### Failure behavior

違反授權、唯一性、狀態、輸入、並發或依賴條件時必須拒絕且不得留下部分業務資料；回應、稽核與重試遵循保留需求及設計規格。

## NFR-001 — Preserved non-functional requirement NFR-001

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-001`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-002 — Preserved non-functional requirement NFR-002

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-002`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-003 — Preserved non-functional requirement NFR-003

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-003`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-004 — Preserved non-functional requirement NFR-004

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-004`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-005 — Preserved non-functional requirement NFR-005

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-005`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-006 — Preserved non-functional requirement NFR-006

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-006`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-007 — Preserved non-functional requirement NFR-007

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-007`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-008 — Preserved non-functional requirement NFR-008

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-008`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-009 — Preserved non-functional requirement NFR-009

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-009`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-010 — Preserved non-functional requirement NFR-010

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-010`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-011 — Preserved non-functional requirement NFR-011

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-011`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-012 — Preserved non-functional requirement NFR-012

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-012`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-013 — Preserved non-functional requirement NFR-013

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-013`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-014 — Preserved non-functional requirement NFR-014

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-014`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## NFR-015 — Preserved non-functional requirement NFR-015

### Statement

完整規範、量測範圍與來源見上方 aligned summary 及保留原文的 `NFR-015`；其中 NFR-015 為已記錄的 RTO/RPO 決策。

### Acceptance criteria

依 `06_technical_test_cases.md` 的 mandatory technical case 取得相同 candidate、環境、資料量與門檻證據；可由使用者觀察的結果另由 UAT 驗收。

### Failure behavior

未達門檻、證據不足、環境不符或依賴降級時不得宣稱達標；按 fail-closed、降級與復原規則記錄 BLOCKED/FAIL。

## SEC-001 — Preserved security requirement SEC-001

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-001`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-002 — Preserved security requirement SEC-002

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-002`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-003 — Preserved security requirement SEC-003

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-003`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-004 — Preserved security requirement SEC-004

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-004`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-005 — Preserved security requirement SEC-005

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-005`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-006 — Preserved security requirement SEC-006

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-006`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-007 — Preserved security requirement SEC-007

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-007`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-008 — Preserved security requirement SEC-008

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-008`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-009 — Preserved security requirement SEC-009

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-009`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-010 — Preserved security requirement SEC-010

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-010`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-011 — Preserved security requirement SEC-011

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-011`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-012 — Preserved security requirement SEC-012

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-012`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-013 — Preserved security requirement SEC-013

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-013`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

## SEC-014 — Preserved security requirement SEC-014

### Statement

完整威脅、角色與控制範圍見上方 aligned summary 及保留原文的 `SEC-014`；Customer PII、銀行資料、附件、匯入及稽核皆在控制範圍內。

### Acceptance criteria

同時驗證允許及拒絕路徑、資源 ownership、fresh authorization、敏感資料遮罩/加密/日誌，以及對應 TC/UAT 的可觀察證據。

### Failure behavior

認證、授權、金鑰、掃描、儲存、provider 或稽核條件不明／失敗時必須 fail closed，不得洩漏存在性、明文或留下未稽核效果。

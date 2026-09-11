# Sales Order Management UAT Specification — Canonical Entry

## 1. UAT Contract

The complete 129-case legacy business/user catalogue is embedded in section 6 of this file, with only obsolete source-document paths normalized to canonical filenames. Every canonical alias below inherits its legacy case's Priority, Phase, Role, Requirement/Risk, Preconditions, Test Data, User Steps, Expected Result, Required Evidence, Actual Evidence and Status.

- All results are `NOT_RUN`; Actual Evidence is `—`.
- Technical prerequisites may be supplied by `06_technical_test_cases.md`, but automation evidence is not business-user acceptance.
- UAT execution requires an identified build/environment and an authorized business signer.
- Operational cases executed by QA/Ops remain executable UAT evidence only where a business-observable outcome exists; infrastructure-only acceptance remains technical.

## 2. Canonical Alias Map

| Canonical UAT aliases | Legacy cases | Business scope | Primary FR coverage |
| --- | --- | --- | --- |
| UAT-001, UAT-002, UAT-003, UAT-004, UAT-005, UAT-006, UAT-007 | AUTH-001–007 | login, least privilege, stale actor, IDOR, safe output | All business FR plus SEC-001–013 |
| UAT-008, UAT-009, UAT-010, UAT-011, UAT-012, UAT-013, UAT-014, UAT-015, UAT-016, UAT-017, UAT-018, UAT-019, UAT-020, UAT-021 | QUOTE-001–014 | quotation creation, issue, expiry, conversion, print | FR-001–017 |
| UAT-022, UAT-023, UAT-024, UAT-025, UAT-026, UAT-027, UAT-028, UAT-029, UAT-030, UAT-031, UAT-032, UAT-033, UAT-034, UAT-035, UAT-036, UAT-037 | DRAFT-001–016 | manual Draft, pricing, version conflict, snapshot | FR-018–041 |
| UAT-038, UAT-039, UAT-040, UAT-041, UAT-042, UAT-043, UAT-044, UAT-045, UAT-046, UAT-047, UAT-048, UAT-049, UAT-050 | CONF-001–013 | full/partial/zero reservation, replay, recovery | FR-042–061 |
| UAT-051, UAT-052, UAT-053, UAT-054, UAT-055, UAT-056, UAT-057, UAT-058, UAT-059, UAT-060, UAT-061, UAT-062, UAT-063, UAT-064 | LIFE-001–014 | FIFO allocation, withdraw, cancel, close, complete | FR-062–075 |
| UAT-065, UAT-066, UAT-067, UAT-068, UAT-069, UAT-070, UAT-071, UAT-072, UAT-073, UAT-074, UAT-075, UAT-076, UAT-077, UAT-078, UAT-079, UAT-080, UAT-081, UAT-082 | CSV-001–018 | template, precheck, isolation, dedupe, background result | FR-076–095 |
| UAT-083, UAT-084, UAT-085, UAT-086, UAT-087, UAT-088, UAT-089, UAT-090, UAT-091 | CH-001–009 | canonical Channel intake and exception recovery | FR-096–108 |
| UAT-092, UAT-093, UAT-094, UAT-095, UAT-096, UAT-097, UAT-098, UAT-099, UAT-100, UAT-101, UAT-102, UAT-103, UAT-104 | INQ-001–013 | active views, source links, exports, audit, injection | FR-109–120 plus inquiry aspects of FR-018–041 |
| UAT-105, UAT-106, UAT-107, UAT-108, UAT-109, UAT-110, UAT-111, UAT-112, UAT-113, UAT-114, UAT-115, UAT-116, UAT-117, UAT-118, UAT-119 | ARC-001–015 | eligibility, atomicity, routing, immutability, restore | FR-121–140 |
| UAT-120, UAT-121, UAT-122, UAT-123, UAT-124, UAT-125, UAT-126, UAT-127, UAT-128, UAT-129 | OPS-001–010 | user-visible performance, recovery, responsive/a11y, job isolation | NFR-001–013/016 and cross-cutting FR |

The mapping is positional inside each row: `UAT-001 = AUTH-001`, `UAT-008 = QUOTE-001`, `UAT-022 = DRAFT-001`, and `UAT-129 = OPS-010`.

## 3. Phase UAT Batches

| Phase | Canonical cases | Business checkpoint | Entry evidence | Result |
| --- | --- | --- | --- | --- |
| PHASE-001 | UAT-001–002 smoke only | safe foundation; no Sales capability sign-off | TC-001–010 | NOT_RUN |
| PHASE-002 | UAT-001–037, UAT-092–104 as applicable | quotation/manual Draft/inquiry usable without reservation | TC-011–020 | NOT_RUN |
| PHASE-003 | UAT-001–007, UAT-038–064 | confirmation/reservation/lifecycle truthful and recoverable | TC-021–033 | NOT_RUN |
| PHASE-004 | UAT-001–007, UAT-065–091 | CSV/Channel intake safe, unique and traceable | TC-034–043 | NOT_RUN |
| PHASE-005 | UAT-092–129 | inquiry/export/archive/operations meet business outcomes | TC-044–060 | NOT_RUN |

## 4. Non-UAT Requirements

- `NFR-014` RTO and `NFR-015` RPO are objectively verified by `TC-058`/`TC-059`; UAT applicability is `N/A — technical DR evidence`. A business owner may acknowledge the report but that is not the execution result.
- Low-level lock order, DB trigger, heap and migration behavior are Technical Acceptance only.
- No UAT case may be marked PASS without actual execution evidence and authorized business acceptance.

## 5. Mechanical Functional Coverage

Functional requirements covered: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140.


---

## 6. Embedded Legacy UAT Body

The content below preserves the full legacy source semantics; only obsolete document paths were normalized. The exact original source has SHA-256 a3750deeaf3b669de4eb9c91e3c57751e8603731413ef38f8b063846ace3418e and remains in the temporary recovery backup. Canonical aliases above preserve the distinction between planned execution and acceptance.

# Sales Order Management 用戶驗收測試案例

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/sales_order_management/01_requirement_spec.md`（embedded legacy 0.1 Draft） |
| 設計來源 | `docs/sales_order_management/03_system_design_spec.md`（embedded legacy 0.1 Draft） |
| UI／UX 基準 | `docs/frontend-design.md` |
| 文件日期 | 2026-09-09 |
| 測試類型 | User Acceptance Testing（UAT）測試設計 |
| 測試狀態 | 尚未執行；所有案例初始狀態均為 `NOT RUN` |
| 目標環境 | 待執行前填寫；須為隔離 UAT 環境及測試專用資料庫 |
| Build／Commit | 待執行前填寫 |

> 本文件從銷售、批量匯入、渠道營運、庫存協作、查詢及營運使用者角度驗證功能是否可接受，不代表系統已通過測試。本輪只產出案例，不執行任何測試。

---

## 1. 驗收目標與範圍

驗證中小企業可由報價、人工輸入、CSV 批量上傳及標準渠道接入建立銷售訂單，並以一致、可追溯及可恢復的方式完成確認、Inventory Reservation、Backorder、撤回、取消、履約及關閉。系統在每日約 10,000 張訂單及 24 個月 Active 資料容量下，仍須讓使用者快速查詢；歸檔不得改變歷史結果或阻塞日常銷售。

### 1.1 範圍內

- Quotation 建立、發出、列印／下載、過期、取消、轉為 Draft SO 及差異摘要。
- 人工 Draft SO 建立、編輯、價格、金額、版本控制及主檔重新驗證。
- SO 確認、Reservation、Backorder、補配、撤回、取消、關閉及完成。
- CSV 模板、上傳、預檢、背景處理、逐單結果、去重、重試及結果下載。
- 標準 Channel Intake 的業務結果；由獲批准的測試 Adapter／營運檢視頁驗證。
- Active／Outstanding／Archive 查詢、匯出、狀態歷史、Audit 及來源追溯。
- 使用者可觀察的權限、安全、響應式、無障礙、效能、失敗恢復、歸檔及備份還原結果。

### 1.2 範圍外與前置證據

- 不以直接 SQL、取得 DB lock、修改資料庫、檢查程式碼或呼叫內部 Service 方法作為 UAT 步驟。
- Unit、API contract、migration、FK／trigger、lock order、真並發 barrier、故障注入、記憶體分析及完整壓測由開發／系統測試負責；開始相關 Phase UAT 前須提供通過證據。
- 第一階段不驗收 Shipping Address、Tax、Discount、Promotion、Price List、Sales Approval、AR Exposure 硬額度、Allocation Priority、Lot／Bin 指定、發貨／退款回傳或平台專屬 Adapter。
- Channel 案例須有受控測試 Adapter 或業務可讀的 Intake 測試介面；若 Phase 3 未交付該介面，相關案例保持 `BLOCKED`，不可假定通過。
- 歸檔資料的正式永久銷毀不屬第一階段；只驗證至少七年保留及沒有自動刪除入口。

---

## 2. 驗收角色與測試資料基線

### 2.1 使用者角色

| 代號 | 角色／權限 |
| --- | --- |
| U-VIEW | Active user；只有 `sales.view` |
| U-SALES | Active user；`sales.view＋sales.mgmt` |
| U-IMPORT | Active user；`sales.view＋sales.import` |
| U-ALL | Active user；`sales.view＋sales.mgmt＋sales.import` |
| U-SYS | 只有 System Administrator 角色，沒有明確 Sales permission |
| U-NONE | Active user；沒有本模組任何 permission |
| U-STALE | 已登入並載入頁面，其後被停用或撤除目標 permission |
| U-OPS | 獲授權營運人員；可看安全的 Job／Archive Batch／技術錯誤摘要，不可修改業務歷史 |
| CH-SIM | 已註冊的測試 Adapter 身分；只用於標準 Channel Intake 驗收 |

三項 Sales permission 互不繼承。所有案例只使用測試帳戶、測試 Channel 及合成資料。

### 2.2 主資料與交易資料

| 代號 | 測試資料 |
| --- | --- |
| CUST-A | Active wholesale Customer；默認 HKD、PT-30、Credit NORMAL |
| CUST-NOPT | Active Customer；沒有 Payment Term、Credit NOT_CONFIGURED |
| CUST-HOLD | Active Customer；Credit ON_HOLD |
| CUST-LIMIT | Active Customer；Credit Limit 提示門檻低於測試 SO total，但沒有 AR Exposure |
| CUST-INACTIVE | Inactive Customer |
| SKU-A | Active、Sellable、有效期內；Sales UOM EA；HKD 建議售價 12.30 |
| SKU-BOX | Active、Sellable；Sales UOM BOX，精度 0；1 BOX＝24 EA |
| SKU-DEC | Active、Sellable；允許小數數量的 UOM |
| SKU-JPY | Active、Sellable；建議售價幣別 JPY，與 HKD 文件不同 |
| SKU-DISC | Discontinued 但仍 Sellable 且在有效期內 |
| SKU-BAD | Inactive、不可銷售、未到生效日或已過銷售有效期的資料組 |
| WH-A／WH-B | Active Fulfillment Warehouses |
| WH-INACTIVE | Inactive 或不可供 Fulfillment 的 Warehouse |
| ATP-FULL | WH-A／SKU-A 可承諾量大於測試訂購量 |
| ATP-PART | WH-A／SKU-A 可承諾量小於測試訂購量且大於 0 |
| ATP-ZERO | WH-A／SKU-A 可承諾量為 0 |
| Q-DRAFT／ISSUED／EXPIRED／CONVERTED／CANCELLED | 各狀態 Quotation；具已知 version 及行資料 |
| SO-DRAFT／CONFIRMING／CONFIRMED | 各狀態 SO；具已知 version、event 及庫存結果 |
| SO-PARTIAL／COMPLETED／CLOSED／CANCELLED | 各生命週期狀態 SO |
| CSV-VALID | v1、UTF-8；多張來源訂單及一張多行來源訂單 |
| CSV-MIXED | Valid、Invalid、Duplicate、Warning 來源訂單混合檔 |
| CSV-MAX | 50 MB 內、最多 100,000 rows、10,000 source orders、每單最多 100 lines |
| CSV-OVER | 超過檔案、row、source order 或每單 lines 任一上限的資料組 |
| CH-A／CH-B | 兩個受控 Channel Codes |
| EXT-001 | 可重送及跨 Channel 驗證的 External Order ID |
| EVT-A／EVT-B | 穩定 event／idempotency ID；另備同 ID 同內容及同 ID 異內容版本 |
| TEXT-RISK | `=`、`+`、`-`、`@`、TAB／CR、HTML／script、Unicode、控制字元及超長文字 |
| ARC-ELIGIBLE | 最終狀態、最後業務更新超過 24 個月、沒有未完成事項的 SO |
| ARC-INELIGIBLE | Open、Backorder、Reservation、CONFIRMING、未完成下游事項或未滿 24 個月的資料組 |
| REASON | 合法業務原因，例如 `UAT sales lifecycle verification` |

每次執行使用唯一 run prefix。涉及數量的案例須先記錄 SO Ordered／Reserved／Backorder／Fulfilled／Released／Cancelled 與 Inventory Reservation 的初始值；不得使用真實 Customer 銀行資料、平台 Token、密碼或生產 CSV。

---

## 3. UAT 進入及完成準則

### 3.1 進入準則

- 對應 Phase 已部署至隔離 UAT 環境，build／commit、APP_TIME_ZONE、瀏覽器、資料日期及版本已記錄。
- Phase 0 Upload、Provider、DB foundation gate，以及對應 unit、API、integration、migration、security 與 system tests 已通過；沒有阻擋 UAT 的 S1／S2 缺陷。
- Customer、Item、Warehouse、User、Currency、Payment Term、Inventory Reservation／Release／Allocation 及 Fulfillment 測試契約可用。
- 測試人員可分別登入上述角色，並查看 Quotation、SO、Import、Reservation、Backorder、Archive、Export 及 Audit 的業務頁。
- 技術團隊已準備受控逾時／服務不可用／背景工作中斷／還原演練方式，且不要求 UAT 人員直接改資料庫。
- Phase 3 Channel 驗收前，標準 Intake contract tests 已通過，並提供獲批准的 CH-SIM 測試入口及結果查詢。
- Phase 4 效能驗收前，已建立 730 萬 Active headers 的標準容量資料及已記錄的測試環境基線。

### 3.2 完成準則

- 當次 Phase 所有 P0 及 P1 案例已執行，沒有未批准的 `BLOCKED` 或 `NOT APPLICABLE`。
- 所有 P0 案例通過；沒有未關閉 S1／S2 缺陷，P1 缺陷已有 Product Owner 接受的處理決定。
- `01_requirement_spec.md` 第 15 節 53 項 Acceptance Criteria 均有 PASS 證據或 Product Owner 書面批准的例外。
- SO、Reservation、Backorder、Fulfillment、Import、Archive 與 Audit 可由業務頁完整對賬，沒有重複、負數、部分成功假象或無法解釋的差異。
- Sales、Warehouse／Inventory、Channel Operations、IT Operations 及 Product Owner 完成對應 Phase 與最終 release 簽核。

---

## 4. 風險優先級

| 風險 | Likelihood | Impact | Priority | 核心案例 |
| --- | ---: | ---: | --- | --- |
| 未授權建立、確認、匯入或查閱訂單 | 4 | 5 | P0 | AUTH-001～007 |
| 報價重複轉單或轉單差異無法追溯 | 3 | 5 | P0 | QUOTE-009～014 |
| 金額、UOM、幣別或快照錯誤 | 4 | 5 | P0 | DRAFT-004～012、CONF-012、INQ-006 |
| 確認重送、逾時或跨模組失敗造成重複／虛假 Reservation | 4 | 5 | P0 | CONF-005～011、OPS-003 |
| 缺貨阻塞整張訂單或造成負庫存 | 4 | 5 | P0 | CONF-006～009 |
| Backorder 補配違反 FIFO 或數量守恆 | 3 | 5 | P0 | LIFE-001～004 |
| 撤回、取消或關閉錯誤釋放庫存 | 4 | 5 | P0 | LIFE-005～013 |
| CSV／Channel 重送或單筆錯誤造成重複、部分 SO | 4 | 5 | P0 | CSV-006～016、CH-002～008 |
| Active／Archive 查詢、匯出或 Audit 與正式結果不一致 | 3 | 5 | P0 | INQ-001～012、ARC-006～012 |
| 歸檔遺漏資料、誤搬未完成訂單或阻塞日常操作 | 3 | 5 | P0 | ARC-001～014 |
| 大資料量令日常查詢或確認長時間變慢 | 4 | 4 | P1 | OPS-001～008 |

---

## 5. 證據與狀態規則

- 每個案例須保存 build、環境、actor、執行時間、初始狀態及執行後狀態；有 Quotation／SO／Batch／Request／Correlation／Event ID 時一併保存。
- `Required Evidence` 只使用使用者或獲授權業務管理員可觀察證據：畫面截圖／錄影、訊息、Quotation／SO／Import／Inventory／Archive／Audit 頁、CSV、列印預覽及前後查詢結果。
- 數量案例的證據須同時顯示 SO Line progress、Inventory Reservation／Release 及相關業務來源，不只保存成功通知。
- 遇到逾時或結果不明，不以新 event 直接重做；先按原 Correlation／Request ID 查詢，再以原 event 安全重試。
- `Actual Evidence` 在實際執行前保持 `—`。狀態只可為 `NOT RUN`、`PASS`、`FAIL`、`BLOCKED` 或 `NOT APPLICABLE`；沒有實際證據不得標記 PASS。
- FAIL 須建立 Defect ID，記錄實際／預期結果、重現步驟、環境與證據；BLOCKED 須記錄阻擋原因及解除條件。

---

## 6. 需求與 Phase 追溯總覽

| 業務流程 | Requirement／Acceptance Criteria | 開發 Phase | Test Case IDs | 初始結果 |
| --- | --- | --- | --- | --- |
| 權限與安全 | `sales.view`／`sales.mgmt`／`sales.import`、FR-INQ-006／010～011、AC-039～043 | P1～P4 | AUTH-001～007 | NOT RUN |
| 報價及轉單 | FR-QUOTE-001～017、BR-001／003～009／011～019／036～040、AC-001～007 | P1 | QUOTE-001～014 | NOT RUN |
| 人工 Draft SO | FR-SO-001～024、BR-001～018、AC-008～014 | P1 | DRAFT-001～016 | NOT RUN |
| 確認、Reservation 及 Backorder | FR-CONF-001～020、BR-019～027、AC-015～020 | P2 | CONF-001～013、LIFE-001～004 | NOT RUN |
| 撤回、取消、履約及關閉 | FR-LIFE-001～014、BR-021～027、AC-021～024 | P2 | LIFE-005～014 | NOT RUN |
| CSV 批量開單 | FR-CSV-001～020、BR-028～035、AC-025～033 | P3 | CSV-001～018 | NOT RUN |
| Channel Intake | FR-CH-001～013、BR-028～035、AC-034～038 | P3 | CH-001～009 | NOT RUN |
| 查詢、匯出、Audit 及來源追溯 | FR-INQ-001～012、AC-039～043 | P1～P4 | INQ-001～013 | NOT RUN |
| 月度歸檔及保留 | FR-ARC-001～020、BR-041～048、AC-045～053 | P4 | ARC-001～015 | NOT RUN |
| 效能、可用性、恢復及 UI／UX | NFR-PERF-001～008、`01_requirement_spec.md` 第 13.2～13.6 節、AC-044／050～053 | P1～P4 | OPS-001～010 | NOT RUN |

### 6.1 Acceptance Criteria 逐項追溯

| AC | Test Case IDs | AC | Test Case IDs |
| --- | --- | --- | --- |
| AC-001 | QUOTE-001／003～004 | AC-028 | CSV-007 |
| AC-002 | QUOTE-002 | AC-029 | CSV-008 |
| AC-003 | QUOTE-006～007 | AC-030 | CSV-009 |
| AC-004 | QUOTE-009 | AC-031 | CSV-010 |
| AC-005 | QUOTE-009 | AC-032 | CSV-011、OPS-004 |
| AC-006 | QUOTE-010 | AC-033 | CSV-016 |
| AC-007 | QUOTE-008／013 | AC-034 | CH-001～002 |
| AC-008 | DRAFT-001／003 | AC-035 | CH-004 |
| AC-009 | DRAFT-001／009／011 | AC-036 | CH-005 |
| AC-010 | DRAFT-005／009 | AC-037 | CH-003 |
| AC-011 | DRAFT-010 | AC-038 | CH-008 |
| AC-012 | DRAFT-012 | AC-039 | AUTH-003 |
| AC-013 | DRAFT-013、CONF-002～003 | AC-040 | AUTH-004 |
| AC-014 | DRAFT-015、CONF-001 | AC-041 | AUTH-006 |
| AC-015 | CONF-006 | AC-042 | LIFE-014、INQ-009 |
| AC-016 | CONF-007 | AC-043 | CSV-017、INQ-005／013 |
| AC-017 | CONF-008 | AC-044 | OPS-001 |
| AC-018 | CONF-009 | AC-045 | ARC-001～002 |
| AC-019 | CONF-005 | AC-046 | ARC-001 |
| AC-020 | LIFE-001～003 | AC-047 | ARC-007 |
| AC-021 | LIFE-005～006 | AC-048 | ARC-004 |
| AC-022 | LIFE-008 | AC-049 | ARC-008／010 |
| AC-023 | LIFE-009 | AC-050 | ARC-006 |
| AC-024 | LIFE-011 | AC-051 | ARC-005 |
| AC-025 | CSV-001 | AC-052 | ARC-012 |
| AC-026 | CSV-003 | AC-053 | ARC-014 |
| AC-027 | CSV-005～006 | — | — |

---

## 7. 詳細用戶驗收測試案例

### 7.1 權限與安全（AUTH）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | 各 Phase | 未登入 | 未登入資料洩漏 | 已登出 | 所有 Sales URL | 直接開啟 Quotation、SO、Import、Outstanding、Archive、Export 及 Audit URL | 導向登入或顯示未登入；沒有交易或主檔內容可見 | URL、登入導向及畫面 | — | NOT RUN |
| AUTH-002 | P0 | 各 Phase | U-NONE／U-SYS | permission 不繼承 | 兩者沒有 Sales permission | 所有頁面 URL | 登入後檢查 menu，再直接開各 URL | Menu 不顯示；直接 URL 拒絕；System Administrator 不因角色名稱取得 Sales 能力 | 角色設定、menu、拒絕畫面 | — | NOT RUN |
| AUTH-003 | P0 | P1～P4 | U-VIEW | AC-039；只讀邊界 | 已有各狀態資料 | 所有查詢及 write action | 查看／匯出後嘗試建立、修改、發出、轉單、確認、撤回、取消及匯入 | 授權範圍內查詢／匯出成功；所有寫入按鈕不可用，直接提交亦拒絕；資料不變 | 權限、查詢、拒絕及前後狀態 | — | NOT RUN |
| AUTH-004 | P0 | P1～P3 | U-SALES／U-IMPORT | AC-040；最小權限 | 兩個獨立帳戶 | 人工操作及 CSV | U-SALES 嘗試人工／報價及 CSV；U-IMPORT 嘗試 CSV 及人工修改 | U-SALES 可管理人工 SO／Quotation 但不可 upload／confirm import；U-IMPORT 可處理 CSV 但不可修改人工交易 | 角色、可用 actions、拒絕畫面 | — | NOT RUN |
| AUTH-005 | P0 | 各 Phase | U-STALE | 提交點重新授權 | 已載入可提交畫面 | Issue、convert、confirm、import confirm、cancel | 管理員撤權或停用後，由原頁提交 | 提交被清楚拒絕；Quotation／SO／Batch／Reservation 不產生成功效果 | 撤權時間、錯誤、前後業務頁 | — | NOT RUN |
| AUTH-006 | P0 | P1～P4 | 各授權角色 | AC-041；IDOR／aggregate ownership | 有多張 Quotation、SO、Import child、Export、Archive | 替換 URL 或表單中的 parent／child ID | 以瀏覽器可操作方式替換 ID 並查看或提交 | 不可讀寫不屬於目標 aggregate／資料範圍的記錄；不洩漏其存在性 | URL、拒絕、資料未變 | — | NOT RUN |
| AUTH-007 | P1 | P1～P4 | 各授權角色／U-OPS | 敏感資料與錯誤安全 | 可觸發驗證及技術錯誤 | TEXT-RISK、銀行資料關鍵字、Token 樣本 | 輸入不可信文字、查看 SO／Audit／Import error／operational error | 文字不執行；一般使用者看業務錯誤，只有 U-OPS 看安全技術摘要；畫面／下載／Audit 不含銀行帳戶、Token、SQL、stack 或內部路徑 | 輸入、畫面、下載、Audit | — | NOT RUN |

### 7.2 報價建立、發出及轉單（QUOTE）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QUOTE-001 | P1 | P1 | U-SALES | FR-QUOTE-001～004、AC-001 | 主資料可用 | CUST-A、SKU-A、有效日期 | 建立 Draft，加入行、客戶參考及備註後保存 | 分配唯一不可改 Quotation Number；默認 Currency／PT 帶入；Draft 保存成功且至少一行 | Draft 詳情、number、欄位 | — | NOT RUN |
| QUOTE-002 | P0 | P1 | U-SALES | FR-QUOTE-003～005、AC-002 | 建立 Draft | 無行、零／負數量、負價格、Valid Until 早於 Quotation Date、CUST-INACTIVE、SKU-BAD | 分別保存／發出 | 不合法資料不可發出；指出實際欄位及原因，不留下 Issued 狀態 | 各錯誤、狀態及詳情 | — | NOT RUN |
| QUOTE-003 | P1 | P1 | U-SALES | FR-QUOTE-005～008、BR-007～010 | HKD Quotation | SKU-A、SKU-JPY、SKU-DISC | 逐項加入、修改價格及備註 | SKU-A 預填 HKD 價；SKU-JPY 不換算且要求輸價；SKU-DISC 可按 Sellable 規則選；可改最終價格；無 Tax／Discount／Shipping Address | 行資料、金額及畫面欄位 | — | NOT RUN |
| QUOTE-004 | P0 | P1 | U-SALES | FR-QUOTE-007、BR-006～007 | Currency 精度已配置 | HKD／JPY、邊界小數 | 修改數量及單價 | 每行及總額即時計算，顯示／保存／列印的精度與四捨五入一致 | 編輯、詳情及列印金額 | — | NOT RUN |
| QUOTE-005 | P0 | P1 | U-SALES | FR-QUOTE-009、BR-014 | Draft 已載入 | 其後停用 Customer／SKU | 從已開頁面發出 | 發出時重新驗證並拒絕；提示失效項目，狀態仍 Draft | 主檔變更、錯誤、狀態 | — | NOT RUN |
| QUOTE-006 | P1 | P1 | U-SALES／U-VIEW | FR-QUOTE-009～010、AC-003 | 有效 Draft | Q-DRAFT | 發出後以兩角色查看及列印／下載 | 狀態 Issued；客戶版本可讀、金額一致、無內部技術資料；Viewer 不可修改 | Issued 詳情及客戶版本 | — | NOT RUN |
| QUOTE-007 | P0 | P1 | U-SALES | FR-QUOTE-017、BR-019、AC-003 | 記錄庫存初始值 | Draft、Issued、Cancelled、Expired Quotation | 建立、發出、取消及等候過期後查 Inventory | 任一 Quotation 狀態都不建立／佔用 Reservation，ATP 不因報價改變 | Quotation 狀態與 Inventory 前後 | — | NOT RUN |
| QUOTE-008 | P1 | P1 | U-SALES | FR-QUOTE-011～012、AC-007 | 到期邊界可控 | Q-EXPIRED／Q-CANCELLED／Q-DRAFT | 嘗試轉單 | 非有效 Issued 報價不可轉；顯示清楚原因且沒有 SO | 錯誤、Quotation 及 SO 搜尋 | — | NOT RUN |
| QUOTE-009 | P0 | P1 | U-SALES | FR-QUOTE-012～015、AC-004～005 | 有效 Issued | Q-ISSUED | 轉單，新增／刪除行、改數量／價／Warehouse／日期並保存 | 只建立一張 Draft SO；尚無 Reservation；雙向連結及新增、刪除、數量、價格差異摘要正確 | Quotation、SO、差異摘要、Inventory | — | NOT RUN |
| QUOTE-010 | P0 | P1 | U-SALES | FR-QUOTE-013、AC-006 | 已成功轉單 | Q-CONVERTED、原 event | 再按轉單或重送同一操作 | 返回既有 Target SO；不建立第二張 SO 或 Conversion | 兩次結果、SO 搜尋、連結 | — | NOT RUN |
| QUOTE-011 | P0 | P1 | U-SALES | BR-040 | 有效 Issued | Q-ISSUED | 進入轉換畫面後取消／離開，不保存 | Quotation 仍 Issued、沒有 Target SO／差異摘要／Reservation | 前後 Quotation、SO 搜尋 | — | NOT RUN |
| QUOTE-012 | P1 | P1 | U-SALES | FR-QUOTE-009／016 | Draft 及 Issued | REASON | 取消 Draft；再對 Issued 執行允許的取消流程 | 狀態按規則變為 Cancelled；原因、actor、時間及狀態歷史可查，不可再轉單 | 詳情、history、Audit | — | NOT RUN |
| QUOTE-013 | P1 | P1 | U-SALES | FR-QUOTE-011／016 | Valid Until 到期邊界 | APP_TIME_ZONE 前後一分鐘 | 到期前後重新整理及搜尋 | 到期判定依業務時區一致；到期後顯示 Expired、不可轉單，History／Audit 可追溯 | 系統時區、畫面、Audit | — | NOT RUN |
| QUOTE-014 | P0 | P1 | U-SALES | 版本及重複提交 | 兩個 browser session 開同一 Draft | Q-DRAFT 同一 version | A 修改保存；B 再發出或保存；快速雙擊 Issue | B 被要求重新載入，不覆蓋 A；雙擊只產生一次狀態轉換及 Audit | 兩 session、最終詳情、Audit | — | NOT RUN |

### 7.3 人工 Draft Sales Order（DRAFT）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DRAFT-001 | P1 | P1 | U-SALES | FR-SO-005～012、AC-008 | 主資料可用 | CUST-A、WH-A、SKU-A | 建立 MANUAL Draft 並首次保存 | 唯一 SO Number 只分配一次；Customer、HKD、PT-30、Warehouse、日期、reference 及 notes 正確 | Draft 詳情及 number | — | NOT RUN |
| DRAFT-002 | P0 | P1 | U-SALES | FR-SO-006、BR-001 | 已保存 Draft | 原 SO Number | 多次修改、取消，再建立新 Draft | 原 number 不變、不重用；新 SO 取得另一唯一 number | 前後詳情及搜尋 | — | NOT RUN |
| DRAFT-003 | P0 | P1 | U-SALES | FR-SO-007～010、BR-002／011／013 | 建單頁 | CUST-INACTIVE、WH-INACTIVE、跨 Customer／Currency／Warehouse | 分別建立或修改 | 每張只接受一個 Active Customer、Currency、Warehouse；無效主檔拒絕且不部分保存 | 各錯誤及 Draft 詳情 | — | NOT RUN |
| DRAFT-004 | P1 | P1 | U-SALES | FR-SO-009、AC-008 | Customer 可用 | CUST-NOPT | 建立並保存 | 沒有 Payment Term 不阻止建單；snapshot 明確為未設定 | Draft 詳情 | — | NOT RUN |
| DRAFT-005 | P1 | P1 | U-SALES | FR-SO-011～013、AC-010 | 建單頁 | Requested Delivery Date 邊界 | 檢查欄位；輸入早於／等於／晚於 Order Date | 沒有 Shipping Address／Tax／Discount 欄位；早於 Order Date 拒絕，其餘接受 | 畫面及驗證結果 | — | NOT RUN |
| DRAFT-006 | P0 | P1 | U-SALES | FR-SO-014～017、BR-003～004 | Draft 可編輯 | 0、負數、小數、100／101 lines | 嘗試保存各邊界 | 至少 1、最多 100 有效行；quantity >0 且符合 UOM 精度；錯誤指出行號 | 各輸入、錯誤、行數 | — | NOT RUN |
| DRAFT-007 | P1 | P1 | U-SALES | FR-SO-015、BR-012 | Item 主資料齊備 | SKU code／name／barcode、SKU-DISC、SKU-BAD | 以三種鍵搜尋並加入 | 三種搜尋可定位合資格 SKU；Sellable discontinued 可選；SKU-BAD 不可選或被拒絕 | 搜尋及行結果 | — | NOT RUN |
| DRAFT-008 | P1 | P1 | U-SALES | FR-SO-016、BR-010 | Draft 有 SKU-A EA | 同價同 note、不同價／note、不同 UOM | 重複加入 | 同 SKU＋UOM 且價／note相同合併；不同價／note要求使用者解決；不同 UOM 可獨立行 | 行合併／提示結果 | — | NOT RUN |
| DRAFT-009 | P0 | P1 | U-SALES | FR-SO-018～021、AC-009～011 | HKD SO | SKU-A、SKU-JPY、零／負價格 | 加入並修改價格 | 同幣別預填；異幣不換算且須輸價；負價格拒絕；零價格可保存；無 Tax／Discount／Promotion 隱藏金額 | 行、total、畫面欄位 | — | NOT RUN |
| DRAFT-010 | P0 | P1 | U-SALES | FR-SO-020、BR-006～008 | Draft 有多行 | HKD／JPY 精度及邊界小數 | 修改 quantity／price，保存後重開 | Line Amount 與 Total 計算正確；UI、保存後詳情與匯出精度一致 | 手工期望值、畫面、重開結果 | — | NOT RUN |
| DRAFT-011 | P0 | P1 | U-SALES | BR-008；價格快照 | Draft 已有 SKU-A | 其後修改建議售價 | 重開 Draft、新增同 SKU 到另一張 Draft | 已有行價格不被改寫；新加入行採用新建議價，仍可手動修改 | 主檔、兩張 Draft | — | NOT RUN |
| DRAFT-012 | P0 | P1 | U-SALES | FR-SO-022～023、AC-012 | 兩 session 開同一 version | SO-DRAFT | A 修改保存；B 修改後保存或確認 | B 被拒絕並提示重新載入；A 的修改保留，無靜默覆蓋／Reservation | 兩 session、version、最終詳情 | — | NOT RUN |
| DRAFT-013 | P0 | P1 | U-SALES | AC-013、BR-014 | Draft 頁已載入 | 其後停用 Customer／SKU／WH／UOM | 直接確認 | Fresh validation 拒絕並指出每個失效項目；SO 仍 Draft，沒有 Reservation | 主檔、錯誤、SO／Inventory | — | NOT RUN |
| DRAFT-014 | P1 | P1 | U-SALES／U-VIEW | FR-SO-001～004 | 有多來源／狀態資料 | number、Customer、PO、date、source、channel、WH、backorder | 組合篩選及開詳情 | 列表欄位完整；filters 可組合、可清除、結果正確且分頁不重複／遺漏 | filters、列表、詳情 | — | NOT RUN |
| DRAFT-015 | P1 | P1 | U-SALES | FR-SO-024、AC-014 | SO 已確認 | 其後更名 CUST-A／SKU-A、改 PT／WH 顯示名 | 開詳情比較 current reference 與 confirmed snapshot | 清楚顯示目前參考與確認快照；歷史名稱／UOM／價格／條款不被覆寫 | 主檔變更、SO 詳情 | — | NOT RUN |
| DRAFT-016 | P1 | P1 | U-SALES | Draft 無庫存承諾 | 記錄 ATP／Reservation 初值 | 建立、修改、複製資料輸入及取消 Draft | 完成所有 Draft 操作 | Draft 期間 Reserved 為 0，Inventory ATP 不因 Draft 改變；取消無 Release 動作 | SO、Inventory 前後、Audit | — | NOT RUN |

### 7.4 確認、Reservation 及 Backorder（CONF）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CONF-001 | P0 | P2 | U-SALES | FR-CONF-001～006 | 完整有效 Draft | CUST-A、WH-A、SKU-A | 確認 | 成功進入 Confirmed；保存 Customer／SKU／UOM／Currency／PT／WH／價格 snapshot 及 Confirmed By／At | SO 詳情、history、snapshot | — | NOT RUN |
| CONF-002 | P0 | P2 | U-SALES | FR-CONF-001～003 | 不完整／非 Draft 或主檔失效 | 各無效狀態 | 分別確認 | 只有完整有效 Draft 可確認；失敗不建立 Reservation，狀態不假成功 | 錯誤、SO、Inventory | — | NOT RUN |
| CONF-003 | P0 | P2 | U-SALES | FR-CONF-004、AC-013 | Draft 完整 | CUST-HOLD | 確認 | 明確因 ON_HOLD 拒絕；SO 保持 Draft、沒有 Reservation | Customer credit、錯誤、SO／Inventory | — | NOT RUN |
| CONF-004 | P1 | P2 | U-SALES | FR-CONF-004～005 | Draft 完整 | CUST-NOPT、CUST-LIMIT | 分別確認 | NOT_CONFIGURED 可繼續；Credit Limit 只顯示 advisory，不作不可靠硬攔截；結果可追溯 | 提示、最終 SO、Audit | — | NOT RUN |
| CONF-005 | P0 | P2 | U-SALES | FR-CONF-007／019 | ATP 足夠 | SO-DRAFT、EVT-A | 快速雙擊 Confirm，再以原 event 重送 | 只有一次有效確認、一次 Reservation 組及一致 history；重送返回同一結果 | 操作錄影、SO、Reservation、Audit | — | NOT RUN |
| CONF-006 | P0 | P2 | U-SALES | FR-CONF-008／012、AC-015 | 記錄 ATP | ATP-FULL | 確認 quantity 10 | SO Confirmed；Reserved 10、Backorder 0；Ordered＝Reserved＋Backorder；Inventory 無負數 | SO line、Inventory Reservation／balance | — | NOT RUN |
| CONF-007 | P0 | P2 | U-SALES | FR-CONF-009／012、AC-016 | 記錄 ATP | ordered 10、ATP 4 | 確認 | SO 仍 Confirmed；Reserved 4、Backorder 6；數量等式成立 | SO line、Reservation、Backorder | — | NOT RUN |
| CONF-008 | P0 | P2 | U-SALES | FR-CONF-010～012、AC-017 | 記錄 ATP | ordered 10、ATP 0 | 確認 | SO 仍 Confirmed；Reserved 0、Backorder 10；Inventory 不負庫存 | SO line、Inventory balance | — | NOT RUN |
| CONF-009 | P0 | P2 | U-SALES | FR-CONF-013、AC-018 | 多行 Draft | 一行 full、一行 partial、一行 zero | 確認 | 各行獨立按 ATP Reservation／Backorder；缺貨行不阻止其他行；整張 Confirmed | 三行結果及 Inventory | — | NOT RUN |
| CONF-010 | P0 | P2 | U-SALES | FR-CONF-014～015；結果不明 | 可受控暫停 Inventory | SO-DRAFT、EVT-A | 確認至 CONFIRMING；重新整理、重按確認、按 correlation 查詢並依指引續跑 | 不顯示虛假成功；另一確認被阻止；原 event 最終收斂至單一結果，無重複 Reservation | CONFIRMING 畫面、tracking、最終對賬 | — | NOT RUN |
| CONF-011 | P0 | P2 | U-SALES | 跨模組永久／暫時失敗 | QA 啟用受控失敗 | validation failure、technical retry | 分別確認並依頁面指引操作 | 永久業務錯誤回 Draft 並可修正；暫時／未知結果保留受控狀態與 Correlation ID；兩者不混淆、不留部分 Reservation | 錯誤碼、SO、Inventory、Audit | — | NOT RUN |
| CONF-012 | P0 | P2 | U-SALES | FR-SO-019、BR-005 | 零價格 Draft | unit price 0 | 確認，先取消警告，再重新確認接受 | 確認前有明確零價格警告；取消不改狀態；接受後可確認且 total 正確 | 警告、兩次結果、SO | — | NOT RUN |
| CONF-013 | P0 | P2 | U-SALES／Inventory user | FR-CONF-019～020 | 已確認多行 SO | SO number／line／event | 從 SO 開 Reservation 來源，再從 Inventory 回到 SO | 每筆 Reservation 可追至 SO Number、Line、Event；Sales 顯示與 Inventory 真相一致，不能在 Sales 手動改庫存數 | 雙向來源頁及數量 | — | NOT RUN |

### 7.5 Backorder、撤回、取消、履約及關閉（LIFE）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIFE-001 | P0 | P2 | U-SALES／Inventory user | FR-CONF-017～018、AC-020 | 多張較早／較晚 Backorder | 同 WH＋SKU，補貨少於總 backorder | 補貨後執行明確重試／分配 | 依 Confirmed At、SO ID、Line No 的 FIFO 分配；較晚訂單不可插隊；結果可由頁面解釋 | 前後 queue、SO lines、Reservations | — | NOT RUN |
| LIFE-002 | P0 | P2 | U-SALES | BR-023、AC-020 | Backorder 6 | 可分配 4 | 執行補配 | Ordered 不變；Backorder 減 4、Reserved 增 4；不超過未履約 Backorder | 前後 SO／Inventory | — | NOT RUN |
| LIFE-003 | P0 | P2 | U-SALES | 補配冪等與上限 | Backorder 尚餘 2 | 同 event 重送、可用 10 | 重複補配 | 最多補配 2；同 event 不重複，Ordered 不變且數量守恆 | 操作、前後數量、Audit | — | NOT RUN |
| LIFE-004 | P1 | P2 | U-SALES | 不同 Warehouse 隔離 | WH-A／WH-B 同 SKU 各有 queue | 只向 WH-A 補貨 | 執行分配 | 只影響 WH-A queue；WH-B 的 Reservation／Backorder 不變 | 兩 Warehouse 前後結果 | — | NOT RUN |
| LIFE-005 | P0 | P2 | U-SALES | FR-LIFE-001～003、AC-021 | Confirmed、Fulfilled 0 | 有 Reservation＋Backorder | 撤回為 Draft | 全部未消耗 Reservation 成功釋放、Backorder 失效後才變 Draft；再次確認按最新資料重建 | SO／Inventory 前後、history | — | NOT RUN |
| LIFE-006 | P0 | P2 | U-SALES | FR-LIFE-002／013 | QA 令 Release 暫時失敗 | SO-CONFIRMED | 撤回 | 不顯示成功，SO 不進 Draft；顯示真實狀態、Correlation ID 及安全重試指引 | 錯誤、SO、Reservation | — | NOT RUN |
| LIFE-007 | P1 | P2 | U-SALES | FR-LIFE-005 | Draft | SO-DRAFT、REASON | 取消 | 直接變 Cancelled；不呼叫庫存釋放；number、內容及 history 保留 | SO、Inventory、Audit | — | NOT RUN |
| LIFE-008 | P0 | P2 | U-SALES | FR-LIFE-006～007、AC-022 | Confirmed、Fulfilled 0 | Reservation＋Backorder、REASON | 不輸原因嘗試取消，再輸入原因取消 | 無原因拒絕；有效操作釋放 Reservation、取消 Backorder 後才變 Cancelled | 兩次結果、SO／Inventory／Audit | — | NOT RUN |
| LIFE-009 | P0 | P2 | U-SALES | FR-LIFE-008～010、AC-023 | 已部分履約 | SO-PARTIAL | 嘗試整張取消；再 Close Remaining 且不輸／輸原因 | 整張取消拒絕；原因必填；成功後釋放未消耗 Reservation、取消 Backorder、保留 fulfilled／snapshot／downstream reference，狀態 Closed | SO、Fulfillment、Inventory、Audit | — | NOT RUN |
| LIFE-010 | P0 | P2 | U-SALES | FR-LIFE-004 | 已部分履約 | Customer／Currency／WH／已履約行 | 嘗試修改受保護欄位及歷史價格 | 全部拒絕；已履約資料及 snapshot 不變 | 編輯限制、詳情、Audit | — | NOT RUN |
| LIFE-011 | P1 | P2 | U-SALES | FR-LIFE-011、AC-024 | Confirmed／Partially Fulfilled | 分批履約至全數 | 完成最後一筆履約並重開 SO | 全部有效 ordered 已履約後狀態 Completed；各數量可完整對賬 | Fulfillment、SO lines、history | — | NOT RUN |
| LIFE-012 | P0 | P2 | U-SALES | FR-LIFE-012 | 可取消／撤回／關閉 SO | EVT-A 同內容重送 | 對每種 lifecycle action 快速雙擊及重試 | 每種只產生一次狀態改變與一次有效 Release／Cancel Backorder；回傳既有結果 | 操作錄影、SO／Inventory／Audit | — | NOT RUN |
| LIFE-013 | P0 | P2 | U-SALES | 同 ID 異內容衝突 | 已完成 EVT-A | EVT-A 配不同 action／reason | 重送 | 系統拒絕衝突，不以舊成功掩蓋新意圖；資料不變 | 錯誤、最終狀態、Audit | — | NOT RUN |
| LIFE-014 | P1 | P2 | U-SALES／U-VIEW | FR-LIFE-014、AC-042 | 已完成各生命週期動作 | SO IDs、events、reasons | 查看狀態歷史及 Audit | 建立、確認、補配、撤回、取消、關閉、完成均有 actor、time、from／to、reason、event／correlation；Viewer 不可修改 | History／Audit 畫面 | — | NOT RUN |

### 7.6 CSV 批量訂單（CSV）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CSV-001 | P1 | P3 | U-IMPORT | FR-CSV-001～002、AC-025 | Import page 可用 | Current v1 | 下載模板、欄位說明及範例 | 檔案為目前支援版本、UTF-8、欄位與說明一致；頁面顯示大小／筆數／訂單上限 | 頁面及下載檔 | — | NOT RUN |
| CSV-002 | P0 | P3 | U-IMPORT | FR-CSV-002／006 | 尚未建立正式 job | 不支援版本、缺／重複 header、非 UTF-8、NUL、錯 delimiter、損壞 grammar | 分別上傳 | 在預檢前或預檢中清楚拒絕；不建立 SO／Reservation；錯誤可供使用者修正 | 上傳結果、SO／Inventory 搜尋 | — | NOT RUN |
| CSV-003 | P0 | P3 | U-IMPORT | FR-CSV-003～005、AC-026 | 模板有效 | 同 Source Order Key 三行 | 上傳並完成預檢 | 三行組成一張來源訂單；header 資料只取一致值，line count／內容正確 | Precheck order detail | — | NOT RUN |
| CSV-004 | P0 | P3 | U-IMPORT | FR-CSV-004／009 | 同 key 多行 | Customer／Currency／WH／date／channel／external ID 不一致 | 預檢 | 整張來源訂單 Invalid；指出不一致欄位及行；不建立部分 SO | Invalid detail、SO 搜尋 | — | NOT RUN |
| CSV-005 | P1 | P3 | U-IMPORT | FR-CSV-005～007、AC-027 | CSV-MIXED | 空值、無效日期／enum、超長、零／負 quantity、負／零 price、TEXT-RISK | 上傳預檢並查看摘要 | 按來源訂單顯示 Valid／Invalid／Duplicate／Warning；零價格為 Warning；錯誤含安全 field／row／code/message | 摘要及 errors | — | NOT RUN |
| CSV-006 | P0 | P3 | U-IMPORT | FR-CSV-007、AC-027 | 記錄 SO／Inventory 初值 | CSV-VALID | 只完成上傳與預檢，不確認處理 | Precheck 可重開查看，但沒有任何 SO、External success key 或 Reservation | Batch、SO／Inventory 前後 | — | NOT RUN |
| CSV-007 | P0 | P3 | U-IMPORT | FR-CSV-008／011、AC-028 | Precheck valid | ATP full／partial／zero source orders | 確認正式處理並等候完成 | 有效來源訂單自動建立及確認，套用人工 SO 相同 Customer、price、snapshot、Reservation／Backorder 規則 | Batch result、三張 SO、Inventory | — | NOT RUN |
| CSV-008 | P0 | P3 | U-IMPORT | FR-CSV-009～010、AC-029 | CSV-MIXED | 一張多行訂單其中一行 invalid；另有 valid order | 確認處理 | Invalid 來源整張不建立、不留 lines／Reservation；其他 valid source order 成功 | 逐單結果、SO／Inventory 搜尋 | — | NOT RUN |
| CSV-009 | P0 | P3 | U-IMPORT | FR-CSV-012～013、AC-030 | EXT-001 已成功 | 同檔重傳、不同檔相同 key、相同檔 hash但不同未成功 key | 上傳及正式處理 | 成功 key 均標 Duplicate 並返回原 SO；file hash 只提示，不取代逐單判斷 | 兩 Batch、原 SO、duplicate result | — | NOT RUN |
| CSV-010 | P0 | P3 | U-IMPORT | FR-CSV-014、AC-031 | EXT-001 先前因業務驗證失敗且無 SO | 修正後相同 external ID | 重新上傳及確認 | 可成功建立一次；成功後再重傳受唯一性保護 | 前後 Batch、SO、External result | — | NOT RUN |
| CSV-011 | P0 | P3 | U-IMPORT | FR-CSV-015、AC-032 | 可產生邊界檔 | 10,000／10,001 source orders，100／101 lines per order | 分別上傳 | 10,000 與每單 100 行可接受為背景 job；超上限在正式處理前拒絕並提示拆檔，不留部分訂單 | Upload／precheck 結果、job list | — | NOT RUN |
| CSV-012 | P0 | P3 | U-IMPORT | 檔案與 row 上限 | 私有測試檔 | 50 MB 邊界、超過 50 MB、100,000／100,001 rows | 分別上傳 | 邊界值可按規格接受；超限清楚拒絕且不建立可正式確認 job／SO；頁面仍可正常使用 | 檔案 metadata、結果、job list | — | NOT RUN |
| CSV-013 | P1 | P3 | U-IMPORT | FR-CSV-016 | 大型有效 batch | CSV-MAX | 正式確認後離開頁面再返回 | 顯示 Queued／Processing／Completed 或 Partial Success／Failed；進度可刷新，離頁不取消 job | 不同時間的 job 畫面 | — | NOT RUN |
| CSV-014 | P0 | P3 | U-IMPORT | FR-CSV-019；批次冪等 | Precheck 完成 | 同 Batch | 快速雙擊 Confirm，重新整理後再按 | 只啟動一個正式 processing job；已完成來源不重複建立／確認 | 操作錄影、job、SO count | — | NOT RUN |
| CSV-015 | P0 | P3 | U-IMPORT／U-OPS | 背景中斷恢復 | 正在處理 mixed batch | 受控 worker restart | 在處理中由 QA 觸發重啟，使用者重開 job | Job 由已記錄進度續跑或安全重試；已成功 SO 不重複；最終逐單結果可對賬 | 重啟前後 job、SO、Audit | — | NOT RUN |
| CSV-016 | P1 | P3 | U-IMPORT | FR-CSV-017／020、AC-033 | Batch 完成 | Mixed results | 查看逐單結果及下載 Result CSV | 每張有 key、external ID、status、SO number 或 error code／field／message；成功可前往 SO；actor、time、correlation 可查 | 畫面、Result CSV、SO link | — | NOT RUN |
| CSV-017 | P0 | P3 | U-IMPORT | FR-CSV-018、AC-043 | Batch 含 TEXT-RISK | 公式字首、TAB／CR、Unicode | 下載 Result CSV，以 spreadsheet 安全開啟 | UTF-8 文字完整；公式型 cell 不執行；欄位按公布格式且不含敏感 payload | 原值、下載檔、安全開啟畫面 | — | NOT RUN |
| CSV-018 | P1 | P3 | U-IMPORT | 檔案保留 | 已完成及超過 90 日測試 job | 原始檔／result | 在保留期內及到期後下載 | 期限內按權限可取；到期後清楚顯示已清理而非零 byte／錯檔；結構化結果及 Audit 仍可查 | 兩日期結果及 Audit | — | NOT RUN |

### 7.7 標準 Channel Intake（CH）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CH-001 | P1 | P3 | CH-SIM／U-OPS | FR-CH-001～004、AC-034 | 獲批准測試 Adapter 可用 | 完整 canonical order、request／correlation IDs | 從 Adapter 提交並在營運結果頁追蹤 | 標準欄位被接受；request／idempotency／correlation 可端到端查詢，不暴露平台認證 | Adapter receipt、營運結果、Audit | — | NOT RUN |
| CH-002 | P0 | P3 | CH-SIM／U-SALES | FR-CH-005、AC-034 | ATP full／partial／zero | CH-A valid orders | 提交並從結果前往 SO | 每張自動建立及確認，執行與人工／CSV 相同 snapshot、Reservation／Backorder 規則 | Intake result、SO、Inventory | — | NOT RUN |
| CH-003 | P0 | P3 | CH-SIM／U-OPS | FR-CH-006／009～010、AC-037 | 可提交無效資料 | 缺 Customer mapping、無效 SKU、技術暫時失敗 | 分別提交並查看結果 | Business validation 形成 Exception 且無部分 SO；technical retry 與不可重試錯誤清楚區分，均有穩定 code／correlation | 結果、Exception、SO 搜尋 | — | NOT RUN |
| CH-004 | P0 | P3 | CH-SIM | FR-CH-007、AC-035 | CH-A＋EXT-001 已成功 | 同 source key 重送 | 以相同及不同 transport request 重送 | 均返回 Duplicate／既有 SO；不建立第二張 SO／Reservation | 兩次 receipt、SO／Inventory | — | NOT RUN |
| CH-005 | P0 | P3 | CH-SIM | FR-CH-008、AC-036 | CH-A＋EXT-001 已成功 | CH-B＋EXT-001 | 提交 | 可建立另一張獨立 SO；每個 Channel 內仍各自唯一 | 兩 Channel 結果及 SO | — | NOT RUN |
| CH-006 | P0 | P3 | CH-SIM | transport 冪等衝突 | EVT-A 已處理 | 同 idempotency key 同內容／異內容 | 分別重送 | 同內容返回原結果；異內容明確衝突且不建立／修改 SO | receipts、SO count、Audit | — | NOT RUN |
| CH-007 | P1 | P3 | U-SALES／U-OPS | FR-CH-011／013 | 渠道 SO 已建立 | CH-A order | 查看 SO、來源、Audit 及可用 actions | 保存安全來源參考但不含密碼、Token 或完整認證 payload；第一階段沒有發貨／取消／退款回傳 action | SO、source、Audit 畫面 | — | NOT RUN |
| CH-008 | P0 | P3 | CH-SIM／U-OPS | FR-CH-012、AC-038 | 兩個測試 Adapter 都映射 canonical contract | 相同商業內容、不同平台欄位 | 分別提交 | 兩者進入相同核心規則與結果語意；不因 Adapter 改變人工 SO、Reservation 或狀態行為 | 兩 Adapter mapping result、SO 比較 | — | NOT RUN |
| CH-009 | P1 | P3 | U-OPS／U-SALES | Import Exception 恢復 | 未識別 mapping exception | 補妥 mapping 後原 source | 由營運頁查看原因，修正外部 mapping 後按批准流程重送 | 系統不猜測替代值；修正後只建立一次；原 exception、重試及成功 SO 可追溯 | Exception、重試、SO、Audit | — | NOT RUN |

### 7.8 查詢、匯出、Audit 及來源追溯（INQ）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INQ-001 | P1 | P4 | U-VIEW | FR-INQ-001～002 | 有多狀態資料 | recent／active／outstanding／backorder／finalized | 開啟各常用視圖 | 每個視圖只含正確狀態；Outstanding 含未 fulfilled／released 或 backorder 的非最終訂單 | 各視圖及樣本詳情 | — | NOT RUN |
| INQ-002 | P0 | P4 | U-VIEW | FR-SO-003～004 | Active 與 Archive 有相似資料 | exact SO、exact external ID、Customer、PO、date、status、source、channel、WH | 分別及組合查詢 | 精確鍵定位唯一結果；一般 filters 準確；Active 結果不混入 Archive | 搜尋條件、結果及 source 標記 | — | NOT RUN |
| INQ-003 | P1 | P4 | U-VIEW | FR-INQ-003 | 各來源 Confirmed SO | MANUAL／QUOTATION／CSV／CHANNEL | 開啟詳情 | 顯示來源、Customer／Item snapshot、total、Reservation／Backorder、status history、downstream reference 及 Active／Archive 標記 | 四張詳情 | — | NOT RUN |
| INQ-004 | P1 | P4 | U-VIEW | FR-INQ-004～005 | 已轉單及 imported SO | Quotation、CSV Batch、Channel result | 由來源前往 SO，再由 SO 返回來源 | 連結雙向正確，不跳到其他 aggregate；無權來源時安全拒絕 | 瀏覽路徑錄影／截圖 | — | NOT RUN |
| INQ-005 | P0 | P4 | U-VIEW | FR-INQ-006、AC-043 | 帳戶有受限資料範圍及 filters | Customer／date／status filter | 套用 filter 後匯出 | 匯出只含當前可見權限與 filter 的完整資料，不含範圍外或未篩資料 | 畫面計數、CSV 計數及樣本 | — | NOT RUN |
| INQ-006 | P0 | P4 | U-VIEW | FR-INQ-008、BR-007 | 不同 Currency／來源資料 | HKD／JPY，多狀態 | 匯出並與詳情對數 | 至少含 number、source、Customer、date、WH、status、amount、quantity summary；金額精度與正式詳情一致 | 詳情及 CSV 對照 | — | NOT RUN |
| INQ-007 | P1 | P4 | U-VIEW | FR-INQ-007 | 小型及大型結果集 | 有限篩選／大量篩選 | 分別匯出 | 小型可即時；大型建立背景 Job，顯示狀態並於完成後提供有限期下載；不凍結頁面 | 兩種匯出流程 | — | NOT RUN |
| INQ-008 | P0 | P4 | U-VIEW | Export owner／expiry | U-VIEW A／B | A 建立的 job、過期 job | B 嘗試開／下載；A 在期限內及到期後下載 | B 被拒絕；A 期限內成功，到期後清楚顯示過期；不返回他人資料或不完整檔 | 角色、job、下載結果 | — | NOT RUN |
| INQ-009 | P0 | P4 | U-VIEW | FR-INQ-009、AC-042 | 各業務動作已完成 | Quotation／SO／Import／Reservation／Archive events | 從詳情查看 history／Audit | 建立、修改、確認、撤回、取消、關閉、轉單、匯入、重試、Reservation、Archive 均有 actor、time、action、outcome 及安全 reference | Audit samples | — | NOT RUN |
| INQ-010 | P0 | P4 | U-VIEW／U-OPS | FR-INQ-010 | 有技術失敗事件 | 同一 correlation | 兩角色查看 | U-VIEW 只見可理解業務狀態；U-OPS 可見安全技術摘要；均不見秘密或完整 payload | 兩角色畫面 | — | NOT RUN |
| INQ-011 | P0 | P4 | U-SALES／U-OPS | FR-INQ-011 | 已確認 snapshot／Audit | 既有 SO | 嘗試從所有 UI 修改 | 沒有修改 action；任何可提交嘗試均拒絕，歷史內容與 hash 對賬不變 | UI、拒絕、前後資料 | — | NOT RUN |
| INQ-012 | P1 | P4 | U-VIEW | FR-INQ-012 | Active／Archive 各有訂單 | 精確及一般搜尋 | 搜尋、開詳情及匯出 | 每筆明確標示 Active 或 Archive；使用者不會把 Archive unavailable 誤認為零結果 | 列表、詳情、下載標記 | — | NOT RUN |
| INQ-013 | P0 | P4 | U-VIEW | CSV formula／XSS | 資料含 TEXT-RISK | notes、Customer PO、external ID | 在列表／詳情查看並匯出後安全開啟 | 畫面只顯示文字不執行 HTML／script；CSV 公式不執行且 Unicode 可讀 | 畫面及安全開啟的 CSV | — | NOT RUN |

### 7.9 月度歸檔、保留及查回（ARC）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ARC-001 | P0 | P4 | U-OPS | FR-ARC-001～005、AC-045～046 | 可執行受控月度 job | ARC-ELIGIBLE／ARC-INELIGIBLE | 執行離峰歸檔並查看候選／跳過原因 | 只選最終狀態、最後業務更新超過 24 個月且無 Reservation／Backorder／CONFIRMING／open downstream matter 的 SO | Batch report、兩組訂單位置 | — | NOT RUN |
| ARC-002 | P0 | P4 | U-OPS | BR-041～044 | 建立日期舊但業務更新新；查詢行為可控 | cutoff 前後邊界 | 查詢、報表後執行歸檔 | 以最後業務更新判斷；單純讀取／登入／報表不刷新該日期；邊界結果依業務時區一致 | 前後詳情、候選報告 | — | NOT RUN |
| ARC-003 | P0 | P4 | U-OPS | FR-ARC-005 | 候選掃描後可改資格 | 候選 SO 新增 open matter／Reservation | 在搬移前由受控流程改變，再繼續 job | 真正搬移前重新驗證並 Skip；Active 原資料完整，報告有原因 | Batch report、Active 詳情 | — | NOT RUN |
| ARC-004 | P0 | P4 | U-OPS／U-VIEW | FR-ARC-006～008 | ARC-ELIGIBLE 含來源／history／audit | 已知 counts、amounts、snapshots | 歸檔前保存業務頁，歸檔後從 Archive 查看 | Header、lines、來源、conversion、必要 history／audit 一併可讀；金額、數量、狀態、snapshot 不重算／不改變 | 搬移前後業務對照 | — | NOT RUN |
| ARC-005 | P0 | P4 | U-OPS | FR-ARC-007／011 | 可受控造成寫入／校驗失敗 | 單筆 Archive failure | 執行 job | 未校驗成功的 SO 保留 Active；不出現半份 Archive；Batch 記錄失敗並可安全重試 | Active／Archive 搜尋、Batch error | — | NOT RUN |
| ARC-006 | P0 | P4 | U-OPS | FR-ARC-009～011 | 部分完成 Batch | 受控中斷／outcome unknown | 重啟 job 或依營運指引續跑 | 從中斷點安全繼續；已完成 SO 不重複，未完成可處理；hash conflict 不被忽略 | 兩次 Batch report、Archive 結果 | — | NOT RUN |
| ARC-007 | P0 | P4 | U-VIEW | FR-ARC-013／015、AC-047 | SO 已歸檔 | number、external ID、Customer、date≤366d、status、channel | 從 Active exact 搜尋，再用提示前往 Archive；使用各條件查詢 | Active 不再列出；有明確 Archive 入口；Archive 找到唯一正確記錄，不自動掃全歷史 | Active hint、Archive results | — | NOT RUN |
| ARC-008 | P0 | P4 | U-VIEW | FR-ARC-014、BR-047 | 已歸檔 SO | Archive detail | 嘗試修改、確認、取消、撤回或重開 | Archive 固定唯讀，只可查看／匯出；沒有 write actions，直接提交亦拒絕 | 詳情、拒絕、資料不變 | — | NOT RUN |
| ARC-009 | P1 | P4 | U-VIEW | Archive 搜尋界線 | Archive 有大量資料 | 空條件、367 日、366 日、exact ID | 分別搜尋 | 空條件及過大 date range 被要求收窄；366 日或 exact key 可查；提示清楚 | 四次搜尋結果 | — | NOT RUN |
| ARC-010 | P0 | P4 | U-VIEW | FR-ARC-016 | 大範圍 Archive 結果 | Customer＋366 日 | 匯出、查看 job、完成後下載 | 使用背景 job；保存發起人、條件、筆數及下載時間；內容只讀且與 filter 一致 | Job、CSV、Audit | — | NOT RUN |
| ARC-011 | P1 | P4 | U-OPS | FR-ARC-017、BR-048 | Batch 有 success／skip／fail | 測試 batch | 查看 Batch report | 顯示 candidate、success、skip、fail、elapsed、validation；每個 fail／skip 可安全追查，不靜默遺漏 | Batch report | — | NOT RUN |
| ARC-012 | P0 | P4 | U-SALES／U-VIEW | FR-ARC-018 | QA 令 Archive store 暫時不可用 | 新 Draft、Active 查詢／確認、Archive 查詢 | 同時執行 | 新建／Active list／確認／Fulfillment 正常；Archive 清楚顯示暫不可用而非 0 筆 | 三種 Active 操作及 Archive error | — | NOT RUN |
| ARC-013 | P0 | P4 | U-OPS | FR-ARC-019 | 已完成 Active＋Archive 備份 | 代表性 MANUAL／QUOTE／CSV／CHANNEL、external keys | 在隔離環境還原後由 UI 查詢與對賬 | Active／Archive／source routing／operation／Audit 均可讀；每個 external key 只路由一張 SO；counts／amounts 一致 | Restore 環境、對賬表及畫面 | — | NOT RUN |
| ARC-014 | P1 | P4 | U-OPS | FR-ARC-012、AC-053 | 最早 Archive 測試資料 | 7 年內資料 | 查看設定、job actions 及資料 | 資料仍可查；沒有自動 purge、永久刪除或使用者銷毀 action | Archive 詳情、設定／actions | — | NOT RUN |
| ARC-015 | P1 | P4 | U-VIEW | Quotation／External routing | 已歸檔 quotation-derived、CSV、Channel SO | 來源 Quotation／Batch／external ID | 由來源連結或 exact lookup 查 SO | 正確路由至 Archive 並標示已歸檔；不返回 404 假裝遺失，也不建立副本 | 三種來源路徑 | — | NOT RUN |

### 7.10 效能、可用性、恢復及 UI／UX（OPS）

| ID | Priority | Phase | Role | Requirement／Risk | Preconditions | Test Data | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | P1 | P4 | U-VIEW | NFR-PERF-001～002／007、AC-044 | 730 萬 Active headers、真實 line 分佈、正常業務負載 | common filters、exact SO／external ID | 執行已批准操作腳本並像日常使用者瀏覽 | Active 常用列表及精確查詢 P95 ≤2 秒；結果正確，不依賴清空資料 | 使用者錄影、測量報告、環境基線 | — | NOT RUN |
| OPS-002 | P1 | P2 | U-SALES | NFR-PERF-003 | 正常負載及 50 concurrent user profile | 1／100-line Draft，full／partial ATP | 保存及確認 | 除外部依賴故障外 P95 ≤3 秒；畫面可回應且結果唯一、正確 | 操作結果及效能報告 | — | NOT RUN |
| OPS-003 | P0 | P2 | U-SALES | 可用性及 unknown outcome | 受控 timeout／connection drop | Confirm、withdraw、cancel events | 提交至結果不明，重新登入後依 correlation 查詢及原 event 重試 | 使用者可辨識 Processing／Failed／Succeeded；不顯示假成功、不新建第二份 Reservation／Release，最終可對賬 | 逾時畫面、恢復步驟、最終業務頁 | — | NOT RUN |
| OPS-004 | P1 | P3 | U-IMPORT | NFR-PERF-004 | 標準容量環境 | 10,000 orders／約 50,000 lines、≤50 MB | 上傳、預檢、確認並記錄完成時間 | end-to-end ≤30 分鐘；進度可查；結果完整；前台查詢／建單仍可使用 | Batch timestamps、result counts、同時前台操作 | — | NOT RUN |
| OPS-005 | P1 | P4 | U-VIEW | NFR-PERF-006 | Archive 標準容量 | exact number、Customer＋366 日 | 重複查詢 | exact P95 ≤3 秒；受限日期查詢 P95 ≤5 秒；結果正確 | 使用者操作及效能報告 | — | NOT RUN |
| OPS-006 | P1 | P4 | U-VIEW | NFR-PERF-005／008 | 50 interactive users＋Import／Backorder／Archive／Export jobs | common workflow mix | 執行代表性日常操作 | 查詢、建單及確認沒有 pool starvation／長時間凍結；大型 export 為背景 job；各 job 不令交易結果錯亂 | workload、畫面、效能／錯誤摘要 | — | NOT RUN |
| OPS-007 | P1 | P1～P4 | 各業務角色 | UI／UX、responsive | 支援瀏覽器 | 375／768／1024／1440 px | 完成 create、table filter、detail、import、archive 核心流程 | 遵循 frontend-design；無水平遮擋關鍵 action、可辨識 loading／empty／error／success；繁體中文一致 | 各 viewport 截圖 | — | NOT RUN |
| OPS-008 | P1 | P1～P4 | 各業務角色 | WCAG AA／鍵盤 | 支援瀏覽器與 screen reader | 關鍵流程及驗證錯誤 | 只用鍵盤完成；觸發 errors；檢視狀態 | Focus 可見且順序合理；label／error 可被讀出及定位；狀態不只靠顏色；dialog 可控制 | 錄影、accessibility evidence | — | NOT RUN |
| OPS-009 | P1 | P4 | U-OPS／U-VIEW | 備份還原與 reconciliation | 完整測試備份 | Active＋Archive＋External keys＋operations | 在隔離環境還原，按抽樣清單逐筆查詢 | Counts、amounts、status、snapshot、source route、Reservation reference 與 Audit 一致；差異有明確報告，不把缺失當成功 | 還原資訊、抽樣表、reconciliation report | — | NOT RUN |
| OPS-010 | P1 | P3～P4 | U-OPS／U-SALES | Job 故障互不拖累 | Import／Export／Backorder／Archive jobs 可受控失敗 | 每類各一 job | 令一類 job 失敗，同時建單、確認及查詢其他 job | 失敗 job 顯示可追蹤錯誤／重試資訊；其他日常流程繼續；恢復後不重複結果 | 各 job 及日常操作前後 | — | NOT RUN |

---

## 8. Phase 驗收批次與獨立結果

| UAT 批次 | 對應 PR Phase | 明確目標結果 | 執行案例 | 必要前置證據 |
| --- | --- | --- | --- | --- |
| UAT-0 Foundation Readiness | Phase 0 | 證明 UAT 環境具安全、bounded 的 CSV upload、Provider 契約及資料基礎；沒有可操作 Sales 功能的業務簽核 | 只執行進入準則檢查；AUTH-001～002 可作 smoke | Phase 0 unit／contract／MySQL／50 MB disk-stream memory-bound 報告 |
| UAT-1 Quotation & Draft | Phase 1 | 業務可完成報價、轉 Draft SO、人工 Draft、列表與基本 Audit，不產生庫存承諾 | AUTH-001～007、QUOTE-001～014、DRAFT-001～016、INQ-003～004／009／013、OPS-007～008 | Phase 1 API／frontend／migration／security 測試 |
| UAT-2 Commitment & Lifecycle | Phase 2 | 確認、Reservation、Backorder、FIFO 補配及生命周期在重送／失敗下仍數量守恆 | AUTH-003～006、CONF-001～013、LIFE-001～014、OPS-002～003 | Inventory consumer contract、真並發、failure recovery、Confirm P95 證據 |
| UAT-3 CSV & Channel Intake | Phase 3 | 批量及標準 Channel 流程可部分成功、去重、恢復並追溯至唯一 SO | AUTH-003～007、CSV-001～018、CH-001～009、OPS-004／010 | CSV streaming、contract、security、10k batch、worker restart 測試 |
| UAT-4 Inquiry, Archive & Release | Phase 4 | Active／Archive 可快速分開查詢，歸檔完整可恢復且不阻塞日常交易 | INQ-001～013、ARC-001～015、OPS-001／005～010 | 730 萬 Active 容量、Archive migration／concurrency、backup／restore 報告 |

每個 Phase 可獨立形成 UAT 測試報告及 PR 驗收決定。後一 Phase 不得用「前一 Phase 應該已通過」代替該次 regression；與本次變更相關的 P0 核心流程須重跑。

---

## 9. 缺陷嚴重度與停止條件

| Severity | 定義 | 例子 |
| --- | --- | --- |
| S1 Critical | 資料不可恢復、越權、重複／錯誤庫存承諾、錯誤歸檔或大範圍不可用 | 未授權確認；SO 成功但無 Reservation；重送建立兩張 SO；Active 與 Archive 同時遺失 |
| S2 High | 核心流程不能完成或金額／狀態／數量／去重結果錯誤，且無可接受 workaround | 報價不能轉單；缺貨令整單失敗；CSV 一行錯誤留下部分 SO；取消未釋放 Reservation |
| S3 Medium | 次要功能錯誤但核心流程有安全 workaround | 非主要 filter 錯誤、個別 Audit 顯示缺欄、背景下載提示不清 |
| S4 Low | 不影響業務正確性的文字、對齊或輕微體驗問題 | 標籤措辭、非關鍵 spacing |

遇到以下任一情況立即停止受影響流程並通知 Product Owner、Engineering 及 QA Lead：未授權資料存取、SO／Reservation／Backorder 無法對賬、重複正式 SO、負庫存、資料不可恢復、Archive 誤刪 Active、或測試行為可能影響非測試資料。

---

## 10. 執行記錄與簽核

### 10.1 執行摘要

| Phase | Build／Commit | Environment | 執行日期 | Total | PASS | FAIL | BLOCKED | NOT RUN | 執行人 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| UAT-0 | — | — | — | — | — | — | — | — | — |
| UAT-1 | — | — | — | — | — | — | — | — | — |
| UAT-2 | — | — | — | — | — | — | — | — | — |
| UAT-3 | — | — | — | — | — | — | — | — | — |
| UAT-4 | — | — | — | — | — | — | — | — | — |

### 10.2 缺陷及例外

| Defect／Exception ID | Test Case | Severity | 摘要 | Owner | 狀態／決定 | 證據 |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |

### 10.3 簽核

| 簽核角色 | 姓名 | 決定（Accept／Reject／Accept with Conditions） | 條件／備註 | 日期 |
| --- | --- | --- | --- | --- |
| Sales Process Owner | — | — | — | — |
| Inventory／Warehouse Owner | — | — | — | — |
| Channel Operations Owner | — | — | — | — |
| IT Operations | — | — | — | — |
| QA Lead | — | — | — | — |
| Product Owner | — | — | — | — |

最終簽核只能根據已執行案例、實際證據、缺陷狀態及批准例外作出；本文件目前所有案例均為 `NOT RUN`。

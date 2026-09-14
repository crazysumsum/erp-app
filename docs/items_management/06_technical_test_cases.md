# Item Management Technical Test Specification (Harness Aligned)

## Harness alignment record

| Item | Value |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Legacy source | `test_case.md`, SHA-256 `6404877088ee5d723337424b57b9e69b0ba5016092c99ac8694bfeaa42137d9f` |
| Formal independent execution | `NOT_RUN` |
| Existing evidence | Developer Round 1 evidence retained in the legacy body; not reclassified as independent acceptance |

The existing catalogue already contains detailed P0/P1 cases with preconditions, data, steps, expected results and evidence requirements. The canonical `TC-*` suites below map those cases to the Harness hierarchy and add explicit cases for alignment gaps and the user-approved DR objectives.

## Canonical Technical Acceptance suites

| ID | Type / priority | Requirements and design | Tasks | Preconditions / trigger | Expected acceptance result | Cleanup / evidence | Automation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | Migration/DB / P0 | NFR-007, NFR-008, NFR-009, NFR-010; SEC-002, SEC-008; DES-007, DES-019 | TASK-001, TASK-002, TASK-004, TASK-008, TASK-009, TASK-027, TASK-044 | Fresh and upgrade MySQL; execute legacy MIG-001–MIG-008 | Ordered/idempotent migrations, constraints and permission seeds are correct; upgrade rerun is safe | disposable DB, schema/ledger/log evidence | YES | PLANNED |
| TC-002 | API/DB/UI / P1 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015; NFR-002, NFR-003, NFR-004; DES-012, DES-014, DES-015 | TASK-012, TASK-013, TASK-017, TASK-037, TASK-039 | 100k-SKU fixture and authorized/unauthorized actors; legacy LIST-001–LIST-010 | Stable search/filter/page/detail/audit behavior; full projections; correct empty/error/403 states | fixture teardown; response, SQL, screenshot, console/network evidence | PARTIAL | PLANNED |
| TC-003 | API/transaction / P0 | FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024; SEC-001, SEC-006, SEC-008; NFR-006; DES-003, DES-004, DES-008 | TASK-014, TASK-015, TASK-023, TASK-024, TASK-037, TASK-038 | Standard/Variant fixtures; duplicate/race/failure injection; legacy CREATE-001–CREATE-014 | Atomic, idempotent, authorized creation with valid variants and no orphan/audit gap | transaction/DB/audit diff and UI evidence; remove fixtures | PARTIAL | PLANNED |
| TC-004 | API/concurrency / P0 | FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031; SEC-001, SEC-006, SEC-008; NFR-006; DES-003, DES-008, DES-020 | TASK-016, TASK-017, TASK-043 | stale versions, cross-owned children, referenced/unreferenced SKU; legacy EDIT-001–EDIT-009 | Optimistic locking, strong auth, full validation, reference guards and audit atomicity hold | DB/audit snapshots and race logs; reset fixtures | PARTIAL | PLANNED |
| TC-005 | Lifecycle/DB / P0 | FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038; SEC-001, SEC-006, SEC-008; DES-003, DES-009, DES-020 | TASK-018, TASK-019, TASK-020, TASK-040, TASK-043 | all statuses, child mixes, references and races; legacy LIFE-001–LIFE-013 | Legal transitions are atomic; destructive actions preserve references/history and stable public errors | DB/audit/reference evidence and cleanup | PARTIAL | PLANNED |
| TC-006 | Validation/DB/integration / P0 | FR-039, FR-040, FR-041, FR-042, FR-043; SEC-008; DES-005, DES-010 | TASK-009, TASK-010, TASK-021 | UOM/barcode boundaries, duplicate and concurrency fixtures; legacy UOM-001–UOM-012 | Integer conversion, ownership, primary/default rules, GTIN normalization and lookup are correct | SQL/API/lookup evidence; remove fixtures | YES | PLANNED |
| TC-007 | Domain/API / P0 | FR-044, FR-045, FR-046, FR-047, FR-048, FR-049; SEC-007, SEC-008; DES-004, DES-006, DES-009 | TASK-005, TASK-006, TASK-010, TASK-023, TASK-024 | price/tracking/catalog/attribute boundaries; legacy PRICE/TRACK/CAT cases | HKD precision, tracking invariants, typed attributes and Catalog guards behave consistently | request/DB/audit evidence; reset Catalog fixtures | YES | PLANNED |
| TC-008 | File/security/integration / P0 | FR-011, FR-012, FR-015; SEC-001, SEC-007, SEC-008, SEC-009; NFR-011; DES-011 | TASK-025, TASK-026 | valid/invalid files, traversal/symlink, auth and failure injection; legacy MEDIA-001–MEDIA-012 | allowlist/signature/size/path/ownership/primary/cleanup controls hold without orphan state | redacted file inventory/hash, API/DB/audit; purge test files | PARTIAL | PLANNED |
| TC-009 | Batch/file/transaction / P0 | FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058; SEC-001, SEC-006, SEC-007, SEC-008, SEC-009; NFR-005, NFR-006, NFR-011; DES-013 | TASK-027, TASK-028, TASK-029, TASK-030, TASK-031, TASK-032, TASK-033, TASK-034, TASK-041 | mixed/duplicate/10k CSV, retry/lease/failure fixtures; legacy IMP-001–IMP-017 | preflight is non-mutating; execution is all-or-nothing/idempotent; exports are safe; files retain/purge correctly | file hashes, job/row/item/SKU/audit DB evidence; purge fixtures | PARTIAL | PLANNED |
| TC-010 | Security/audit / P0 | FR-059, FR-060, FR-061, FR-062, FR-063, FR-064; SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009; NFR-006; DES-002, DES-012 | TASK-002, TASK-011, TASK-020, TASK-039, TASK-041 | actor revocation, role matrix, IDOR/input/audit failure; legacy AUD-001–AUD-006 and AUTH-001–AUTH-010 | every critical change is authorized and transactionally auditable; logs redact secrets and audit is immutable/queryable | auth matrix, request/DB/audit/log evidence; revoke fixtures | PARTIAL | PLANNED |
| TC-011 | Browser/accessibility / P1 | FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-015, FR-016, FR-017, FR-018, FR-022, FR-025; SEC-009; NFR-012, NFR-013; DES-015 | TASK-013, TASK-015, TASK-017, TASK-019, TASK-024, TASK-026, TASK-030, TASK-037, TASK-038, TASK-039 | running application and role fixtures; legacy UI-001–UI-008 | happy/negative flows, dirty-state handling, keyboard/focus, refresh/navigation and error states work with no relevant console/network failures | Playwright screenshots/trace; remove fixtures | PARTIAL | PLANNED |
| TC-012 | Performance/observability / P1 | NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-011, NFR-013; SEC-007, SEC-009; DES-017 | TASK-035, TASK-044 | representative 100k-SKU/10k-row workload; legacy OPS-001–OPS-006/OPS-009 | p95/error/resource thresholds and alerts/log correlation meet defined limits | performance report, metrics/log evidence, fixture cleanup | PARTIAL | PLANNED |
| TC-013 | API/DB regression / P0 | FR-011, FR-012, FR-015, FR-018, FR-025; SEC-008; DES-004, DES-014 | TASK-037 | persist item_attribute_values and item_sku_attribute_values, then read detail/API/UI | typed values and canonical variant combination are returned; no empty-array placeholder or cross-owner disclosure | response/schema/SQL/Playwright evidence; cleanup | YES | PLANNED |
| TC-014 | API/DB negative / P0 | FR-034, FR-035, FR-037, FR-038; SEC-008; DES-009 | TASK-040 | referenced and unreferenced Brand/UOM with expected versions | referenced delete returns `CATALOG_IN_USE` and no audit/data mutation; unreferenced delete succeeds with audit | true-MySQL response/DB/audit diff; cleanup | YES | PLANNED |
| TC-015 | Batch/transaction/audit / P0 | FR-050, FR-052, FR-053, FR-055, FR-059, FR-060, FR-061, FR-062; NFR-006; SEC-007, SEC-008; DES-012, DES-013 | TASK-041 | create/update import, reason, injected row/audit/commit failures and retry | each aggregate change uses the same validation and has per-item audit in the same transaction; failure leaves neither change nor audit | job/item/SKU/audit before/after and transaction logs; cleanup | YES | PLANNED |
| TC-016 | Backup/restore/DR / P0 | NFR-010, NFR-011, NFR-014, NFR-015; SEC-008, SEC-009; DES-018, DES-019 | TASK-036, TASK-044 | approved staging-like environment, backups, media/import storage and timestamped writes | restore returns usable service in <=4h and no more than 15 minutes of committed data is lost; integrity/reconciliation passes | timed runbook, backup IDs, RPO calculation, smoke/reconciliation; securely remove exercise data | PARTIAL | PLANNED |

All canonical requirement IDs are covered above or by the retained detailed catalogue: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064; NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-014, NFR-015; SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009.

## Evidence interpretation

- The legacy Round 1 record is developer self-test/CI evidence for an earlier commit. It remains valuable provenance but is not an observed result of this independent review.
- Current implementation findings are classified as static-review findings until the corresponding `TC-*` is executed.
- Formal Technical Acceptance, including true-browser and DR execution, requires a later `TEST_AND_VERIFY` authorization.

---

# Preserved legacy body (verbatim)

# Items Management 測試案例

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | docs/items_management/requirement.md 0.3 Draft |
| 設計來源 | docs/items_management/design_spec.md 0.2 Draft |
| 文件日期 | 2026-09-04 |
| 測試階段 | 測試設計，尚未執行 |
| 初始狀態 | 所有案例均為 NOT RUN |
| 目標環境 | 待執行前確認；Migration、constraint、transaction、concurrency、worker、效能、檔案清理及復原案例必須使用隔離的真實 MySQL／檔案儲存測試環境 |
| Build / Commit | 待執行前記錄 |

> 本文件只定義測試案例，不代表功能已通過驗證。本輪不執行任何測試。永久刪除、Migration、故障注入、檔案清理、備份還原及大批量案例只可在隔離測試環境使用虛構資料執行。

### 0.1 規格可追溯性註記

- requirement.md 重複使用 NFR-005：本文件以 NFR-005(A) 表示「每日最多 1,000 次 Item／SKU／Catalog 變更並完整稽核」，以 NFR-005(B) 表示「商品建立／修改與稽核交易一致」。這兩個 QA 別名不改變原需求內容；正式簽核前應由 BA 將其中一項重新編號並同步 requirement、design、tasks 與本文件。
- main 版 design_spec.md 預留 Item Migration 0009～0025，但目前主分支已存在 0009_add_user_email.js。案例 MIG-001～MIG-003 要求實作前按主分支下一個可用序號重新編排，並驗證沒有覆蓋、跳過或修改既有 Migration；舊預留序號不可直接作為部署通過證據。

## 1. 測試目標與範圍

驗證 Items Management 的 Item／SKU aggregate、Catalog、Variant、UOM、Barcode、價格、追蹤政策、狀態、Media、CSV 匯入／匯出、Audit、權限、下游 Lookup、效能及營運復原符合需求與設計，且所有寫入在重送、並發、驗證失敗、DB／檔案失敗及 worker 重啟後仍保持一致。

### 1.1 範圍內

- Standard／Variant Item 與 SKU 的建立、查詢、修改、複製、狀態及受控刪除。
- Category、Brand、UOM、Attribute Definition／Option／Category Rule。
- SKU UOM、Barcode、RRP、Tracking Policy、Shelf-life policy、Media。
- Import／Export、Audit、authorization、idempotency、optimistic lock、DB constraints。
- ItemLookupService 的 purchase／sale／inventory 契約，以及收貨效期豁免所需輸出 contract。
- Web UI、API、MySQL、檔案儲存、scheduler、效能、備份／還原及部署 smoke。

### 1.2 範圍外

- 真正庫存結餘、採購、銷售、定價、促銷、稅務及收貨交易流程；本模組只驗證 Lookup／snapshot／policy contract。
- 供應商主檔及 Item–Supplier relation；設計明確延後至 Supplier schema 可用時建立。
- 多公司／多租戶、門店／倉庫／渠道級商品狀態、多語言翻譯及小數庫存。
- 深度滲透測試；本文件涵蓋功能性授權、IDOR、輸入注入、附件與資料外洩回歸。

## 2. 系統模型與風險優先級

主要路徑為「Vue／API client → auth policy與schema → Item service → MySQL transaction＋append-only audit」，另有「下游 Handler → ItemLookupService」、「multipart → ItemMediaService → 受控儲存」及「CSV → preflight → job／rows → lease worker → 單一商品交易」三條高風險邊界。

| 風險 | Likelihood | Impact | Priority | 核心案例 |
| --- | ---: | ---: | --- | --- |
| SKU Code、Barcode、Variant、Base/default slot只在應用層唯一，競態造成重複主資料 | 4 | 5 | P0 | MIG-004～MIG-008、CREATE-006～CREATE-010、UOM-003～UOM-008 |
| Item狀態同步SKU失敗或部分提交，令交易資格與主資料不一致 | 4 | 5 | P0 | LIFE-001～LIFE-013 |
| 寫入成功但audit遺失，或重送／並發產生重複、矛盾結果 | 4 | 5 | P0 | CREATE-011～CREATE-014、EDIT-005～EDIT-009、AUD-001～AUD-006 |
| 匯入任一壞列仍留下部分Item／SKU，或worker接管後重複執行 | 4 | 5 | P0 | IMP-004～IMP-015 |
| 權限組合、stale claim、IDOR或錯誤authType造成越權 | 4 | 5 | P0 | AUTH-001～AUTH-010、MEDIA-009～MEDIA-012 |
| Base UOM／tracking／條碼被錯誤更改，使既有交易及換算語意失真 | 3 | 5 | P0 | UOM-001～UOM-012、EDIT-006、TRACK-001～TRACK-005 |
| 100k SKU、50使用者、10k CSV下查詢或匯入超時並拖慢線上服務 | 3 | 4 | P1 | OPS-001～OPS-005 |
| Media path、偽造內容或清理工作造成惡意檔案／越界讀寫／資料不一致 | 3 | 5 | P0 | MEDIA-001～MEDIA-012 |

## 3. 測試資料基線

| 代號 | 測試資料 |
| --- | --- |
| U-VIEW | Active user，只持有 item.view |
| U-MGMT | Active user，同時持有 item.view＋item.mgmt |
| U-MGMT-ONLY | Active user，只持有 item.mgmt，用於驗證完整 Item Management API 讀寫權限 |
| U-DOWN-P／U-DOWN-S／U-DOWN-I | 分別只持有採購、銷售、庫存流程權限的下游 user |
| U-RECV-O | 只在 Receiving contract fixture 中持有 receiving.override_shelf_life |
| U-NONE／U-DISABLED | 無 Item 權限的 Active user／已停用 user |
| DEV-OK／DEV-BAD | 已核准／未核准或已撤銷設備；高強度簽章測試使用 |
| CAT-LEAF／CAT-PARENT／CAT-INACTIVE | Active leaf、Active non-leaf、Inactive Category |
| BRAND-A／UOM-EA／UOM-BOX | Active Brand；Base EA；Pack BOX=24 EA |
| ATTR-FLAVOUR／ATTR-SIZE | Active single_option variant attributes，配置於 CAT-LEAF |
| I-STD-DRAFT | Standard Draft Item，恰一個 Draft SKU |
| I-VAR-ACTIVE | Variant Active Item，兩個 Active SKU，版本已知 |
| I-MIXED | 含 Draft／Active／Inactive／Discontinued SKU 的 Item |
| SKU-A | Active、purchasable、sellable、inventoryTracked、RRP=128.0000 HKD、Base EA |
| SKU-B | 同 Item 的另一唯一 variant，RRP=98.0000 HKD |
| SKU-DISC | Discontinued、purchasable=false、sellable=true，仍有模擬庫存 |
| SKU-REF／SKU-NOREF | 已有下游 FK／snapshot 引用的 SKU；完全未引用 Draft SKU |
| BC-EA／BC-BOX | 合法 EAN-13 單件碼；合法箱碼綁 UOM-BOX |
| CSV-MIXED | UTF-8 RFC 4180 CSV，含 valid create、valid update、warning、invalid、skip 及 duplicate rows |
| IDEM-A／IDEM-B | 不同 idempotency keys；另準備同 key 同／異 payload |
| REASON | 5～190 字元，例如 QA item lifecycle verification |
| PERF | 100,000 SKU、每SKU 10 Barcode及10 UOM、50 concurrent users、10,000-row CSV |

所有資料使用唯一 run prefix。每個 P0／P1 案例執行前須保存 build、commit、環境、actor、request ID、fixture version 及初始 DB／file inventory。

## 4. 證據與狀態規則

- API／UI案例至少保存 request、response、network或畫面證據；所有寫入另保存相關 aggregate、version及audit前後快照。
- Transaction、constraint、collation、generated column、FK、locking、Migration、worker lease與效能案例必須提供真 MySQL／實際執行證據；mock或code inspection不能判定 PASS。
- Media／CSV證據不得包含JWT、password、device private key、任意檔案絕對路徑或完整業務檔內容；用hash、大小、redacted sample及受控inventory證明。
- 狀態只可由 NOT RUN 改為 PASS、FAIL、BLOCKED 或 NOT APPLICABLE；Actual Evidence 在實際執行前保持「—」。
- 每個 FAIL 必須記 defect ID、可重現輸入、實際／預期結果、環境與證據位置；BLOCKED 必須列出具體阻擋及解除條件。

## 5. 需求／風險追蹤總覽

| Requirement / Risk | Priority | Test Case IDs | Latest Result | Defect IDs | Coverage Note |
| --- | --- | --- | --- | --- | --- |
| RQ-01 Migration、permission、schema與DB約束 | P0 | MIG-001～MIG-008 | NOT RUN | — | 真MySQL、序號衝突、重跑、collation、FK及generated slots |
| RQ-02 列表、搜尋、詳情與projection | P1 | LIST-001～LIST-010 | NOT RUN | — | 分頁、exact ranking、filter、sort、URL、狀態及敏感欄位 |
| RQ-03 建立、Variant、完整性、唯一性與冪等 | P0 | CREATE-001～CREATE-014 | NOT RUN | — | Standard／Variant、直接啟用、rollback、copy及duplicate warning |
| RQ-04 修改、版本、關鍵欄位與交易快照 | P0 | EDIT-001～EDIT-009 | NOT RUN | — | optimistic lock、child ownership、受控Code及reference guard |
| RQ-05 Lifecycle、刪除與父子同步 | P0 | LIFE-001～LIFE-013 | NOT RUN | — | 全狀態、最後Active SKU、下游資格、atomic cascade及restore |
| RQ-06 UOM、Barcode與Lookup | P0 | UOM-001～UOM-012 | NOT RUN | — | 整數換算、GTIN、scanner、unique、purpose matrix及snapshot |
| RQ-07 Price、Tracking、Attribute與Catalog | P0 | PRICE-001～PRICE-006、TRACK-001～TRACK-005、CAT-001～CAT-008 | NOT RUN | — | 固定口徑、歷史價、效期、typed attributes及catalog guards |
| RQ-08 Media與附件 | P0 | MEDIA-001～MEDIA-012 | NOT RUN | — | allowlist、MIME/signature、path、primary、cleanup及授權 |
| RQ-09 CSV Import／Export | P0 | IMP-001～IMP-017 | NOT RUN | — | RFC4180、預檢零寫入、全批原子、stable ID、lease及retention |
| RQ-10 Audit、Auth與Security | P0 | AUD-001～AUD-006、AUTH-001～AUTH-010 | NOT RUN | — | transactional audit、不可修改、authType、fresh actor、IDOR及注入 |
| RQ-11 UI／UX與無障礙 | P1 | UI-001～UI-008 | NOT RUN | — | route/menu、editor、dirty、keyboard、error focus及時區 |
| RQ-12 效能、可觀測性、備份與部署 | P1 | OPS-001～OPS-009 | NOT RUN | — | SLA、容量、alerts、DR、forward-only rollback及smoke |

## 6. 詳細測試案例

### 6.1 Migration、Schema、Permission及DB約束

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MIG-001 | P0 | 設計§5.15；Migration序號不可衝突 | Migration/Repo | 以最新main建立隔離DB與worktree | 已存在0009_add_user_email；Item migration草案 | 列出既有ledger與檔名；按下一個可用連續序號配置Item migrations；執行runner | 不覆蓋或修改既有0009；Item migrations以唯一字典序完整執行；ledger與實際檔名一致 | git diff、migration list、ledger、runner輸出 | — | NOT RUN |
| MIG-002 | P0 | NFR-008、NFR-009；全新DB可部署 | Migration/DB | 空白隔離MySQL；media/import roots可寫 | 全部Item migrations與config | migrate後啟動server | permissions、16張設計表、欄位、索引、FK、generated columns及config均可用；health正常 | runner output、schema dump/hash、startup log | — | NOT RUN |
| MIG-003 | P1 | NFR-007；Migration重跑與半套用收斂 | Migration/DB | 完成DB及各DDL/DML半套用fixtures | 每支Item migration | 完整重跑；對半套用情境再跑 | 已完成者no-op；半套用安全收斂；seed/link/row數不重複；既有migration內容不變 | 兩次輸出、ledger、schema/data diff | — | NOT RUN |
| MIG-004 | P0 | BR-003、BR-005、BR-007、BR-027；全公司唯一性 | DB/Concurrency | 真MySQL、兩connection | 大小寫SKU Code、normalized Barcode、相同variant signature | barrier同步insert各衝突資料 | 每組只一筆成功；另一筆由唯一約束穩定拒絕；所有狀態都占用Code/Barcode | constraint metadata、errors、final SQL | — | NOT RUN |
| MIG-005 | P0 | BR-001、BR-011；Base/default slots | DB/Concurrency | 真MySQL；同SKU已有Base | 兩Base、兩default purchase、兩default sale、重複UOM | 單次及並發插入衝突列 | generated unique slots最多各一列；重複SKU/UOM拒絕；Base factor=1仍由service保證 | DDL、constraint errors、final SQL | — | NOT RUN |
| MIG-006 | P0 | FR-UOM-003、SEC-008；composite ownership FK | DB/Security | SKU A/B及各自UOM；Item A/B及SKU | A Barcode綁B UOM；A media綁B Item/SKU | 直接DB及API提交cross-owner references | composite FK／service均拒絕；兩aggregate不變；無越權存在性洩漏 | FK metadata/errors、API、DB diff | — | NOT RUN |
| MIG-007 | P1 | SEC-002；permission seed與catalogue一致 | Migration/Auth | 空DB；system-admin存在 | item.view、item.mgmt | migrate、重跑、啟動catalogue guard並查角色 | 兩permission恰一份且system-admin持有；catalogue與seed一致；沒有permission inheritance | SQL、startup log、convention test | — | NOT RUN |
| MIG-008 | P1 | FR-AUDIT-005、NFR-008；歷史FK與刪除規則 | DB/Recovery | 完整schema與actor/item fixtures | actor刪除、target刪除、catalog引用 | 檢查FK；刪actor／嘗試刪被引用catalog；保留audit | actor FK SET NULL且username snapshot保留；audit target無FK；共享catalog RESTRICT；從屬只按設計CASCADE | schema、SQL前後、audit row | — | NOT RUN |

### 6.2 列表、搜尋、詳情與Projection

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-001 | P1 | FR-LIST-001、NFR-002、AC-008；server分頁 | API/DB | U-VIEW；125 SKU含Archived | page/pageSize缺省、1、20、100、0、101 | GET /skus與/items並翻頁、切includeArchived | 預設20、最大100；非法400；total為filter後值；預設排除Archived，顯式篩選可查 | responses、count SQL、query trace | — | NOT RUN |
| LIST-002 | P0 | FR-LIST-002、FR-LIST-003、AC-007；多欄搜尋 | API/DB | U-VIEW；各欄唯一fixtures | 完整/部分Code、主次Barcode、Item/SKU Name、case及外圍空白 | 對每種輸入搜尋SKU及Item | 全部指定欄可命中；忽略英文case與trim；Item結果不因多barcode/UOM重複，total正確 | requests/responses、fixture及SQL | — | NOT RUN |
| LIST-003 | P1 | 設計§8.8；exact ranking與LIKE escape | API/Security | Code/name互相包含；有%、_、\\資料 | exact code/barcode、prefix、contains、惡意wildcard | 執行搜尋並比較順序 | exact code/barcode最前，其次prefix再contains；特殊符號按字面處理；查詢參數化 | response order、SQL trace/EXPLAIN | — | NOT RUN |
| LIST-004 | P1 | FR-LIST-004；組合篩選 | API/DB | 跨status/category/brand/tracking/flags/date fixtures | 各單一及組合filters | SKU/Item list逐一查詢 | 只回交集；建立/更新時間邊界及含Archived語意正確；total不膨脹 | requests/responses、對照SQL | — | NOT RUN |
| LIST-005 | P1 | FR-LIST-005；穩定排序 | API/DB | 多筆同排序值 | Code、name、category、brand、status、updatedAt，正/倒序 | 各排序跨頁查詢 | allowlist欄位排序正確；同值以穩定tie-break；翻頁不漏不重；非法sort 400 | responses、expected order、SQL | — | NOT RUN |
| LIST-006 | P1 | FR-LIST-006～007；SKU預設視圖 | API/UI | U-VIEW | SKU Code、主Barcode、variant、Base UOM、RRP及狀態 | 開/items、切Item/SKU view | 預設SKU平鋪；欄位完整；Item彙總不重複；view/page/filter寫入URL | screenshot、URL、network response | — | NOT RUN |
| LIST-007 | P1 | FR-LIST-008～009、SEC-009；export及查詢狀態 | API/UI | U-MGMT；設定filter/sort/q | filtered fixtures | refresh/back/share URL；匯出當前結果 | 查詢狀態可還原；CSV只含權限範圍與filter結果；寫item.export audit；不輸出內部欄位 | URL、CSV hash/content、audit | — | NOT RUN |
| LIST-008 | P1 | FR-LIST-010；empty/loading/error/403 | UI | 可控制API狀態；U-VIEW/U-NONE | empty、slow、500、403 | 逐一開列表與重試 | 四種狀態清楚區分；錯誤可重試；403不呈現成空資料；不殘留前次結果 | screenshots、network、DOM | — | NOT RUN |
| LIST-009 | P1 | FR-VIEW-001、FR-VIEW-002、FR-VIEW-005 | API/UI | U-VIEW；I-MIXED | 全SKU、attributes、media、times、各狀態 | 開Item與各SKU詳情 | Item回全部狀態SKU；SKU回識別、variant、UOM、barcode、tracking、price、media及version；狀態明顯 | responses、screenshots、DB對照 | — | NOT RUN |
| LIST-010 | P1 | FR-VIEW-003、FR-VIEW-004；audit與庫存邊界 | API/UI/Integration | U-VIEW；有audit及模擬inventory link | before/after/reason；有/無inventory module | 開history及inventory摘要入口 | 有權限可查完整audit；inventory只顯示摘要/連結、不自行計算；模組不存在時安全隱藏 | response、UI、integration trace | — | NOT RUN |

### 6.3 建立、Variant、完整性、唯一性與冪等

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CREATE-001 | P1 | FR-CREATE-001、FR-CREATE-008、AC-001 | API/DB | U-MGMT；有效catalog | Standard Item＋一個合法SKU | POST /items/create，activate=false | 原子建立Draft Item與Draft SKU，version=1；詳情及audit可查；沒有交易資格 | request/response、Item/SKU/audit SQL | — | NOT RUN |
| CREATE-002 | P0 | BR-001、FR-CREATE-002、AC-027 | API/Transaction | U-MGMT；I-STD-DRAFT | 第二個SKU；零SKU payload；多SKU轉Standard | createSku／createItem／updateItem | 零SKU建立拒絕；Standard第二SKU及多SKU轉Standard均409；無部分row/audit | responses、transaction log、DB diff | — | NOT RUN |
| CREATE-003 | P1 | FR-CREATE-002、FR-CREATE-005、AC-003 | UI/API/DB | Variant attributes已配置 | flavour 2值×size 3值；取消/確認部分組合 | 產生matrix、刪除未選組合後確認 | UI只建確認的每個唯一組合；每SKU有完整values與可讀名稱；Item為Variant | screenshots、request、SKU/value SQL | — | NOT RUN |
| CREATE-004 | P0 | BR-007；Variant signature穩定 | Unit/DB | ATTR fixtures | 屬性順序互換、Unicode等價、typed value差異、duplicate attribute | 計算signature並建立SKU | 相同canonical組合得相同SHA-256；不同型別/值不同；重複/非variant拒絕；DB只容一組合 | unit output、canonical samples、constraint | — | NOT RUN |
| CREATE-005 | P0 | FR-CREATE-003、BR-004、AC-026 | Validation/API | U-MGMT | 任意可列印Code、含空格/符號；空白、control、190/191字 | 建立SKU並讀回 | 合法非固定格式原樣保存（只trim）；不uppercase/重編碼；空白/control/超長回SKU_CODE_INVALID | responses、DB值、audit | — | NOT RUN |
| CREATE-006 | P0 | FR-CREATE-004、BR-003、AC-002 | API/DB/Concurrency | 各狀態已有SKU-X | sku-x、外圍空白、同/異case；兩connection | 建立及並發建立 | Draft/Inactive/Discontinued/Archived均占用；只一筆成功；衝突SKU_CODE_TAKEN且整個aggregate rollback | responses、constraint、Item/SKU/audit SQL | — | NOT RUN |
| CREATE-007 | P0 | FR-CREATE-004、BR-005、AC-013、AC-014 | API/DB | 已有BC-EA | 合法GTIN8/UPC-A/EAN13/GTIN14、錯位數/檢查碼、空格/連字號等價碼 | 建立／更新兩SKU | 合法碼保存display並以normalized唯一；錯碼GTIN_INVALID；等價碼BARCODE_TAKEN；兩SKU無錯誤部分變更 | responses、barcode SQL、transaction diff | — | NOT RUN |
| CREATE-008 | P0 | FR-CREATE-006；aggregate全有全無 | Failure/Transaction | 可在第2 SKU、UOM、Barcode、attribute、audit、commit注入失敗 | Variant Item＋3 SKU | 各失敗點建立後查所有表，再修復重試 | 任一失敗時Item、全部children及audit全rollback；無孤兒；修復後可安全重試 | errors、transaction log、全表快照 | — | NOT RUN |
| CREATE-009 | P0 | BR-008、BR-009、BR-010、AC-009、AC-015、AC-022、AC-029 | Validation/API | U-MGMT；Draft SKU | 缺category/base/name/variant/price；batch_expiry缺shelf life；無barcode | activate並比較issues | 一次回全部activatability issues；無barcode不阻擋；修正全部後才可Active | 422 details、DB/audit前後、成功response | — | NOT RUN |
| CREATE-010 | P0 | FR-CREATE-009、BR-028、AC-025 | API/DB/Auth | U-MGMT；完整Item/SKU | activate=true、activationReason | 建立並直接啟用 | 同交易Item與至少一SKU Active；不建立approval；啟用audit含actor/reason/requestId | response、Item/SKU/audit SQL | — | NOT RUN |
| CREATE-011 | P0 | NFR-007；Create冪等 | API/DB | U-MGMT | IDEM-A同payload、同key異payload、IDEM-B | 連續及並發POST create | 同key同payload只建一組且回一致結果；同key異payload拒絕；不同key受unique規則保護 | responses、idempotency/aggregate/audit SQL | — | NOT RUN |
| CREATE-012 | P1 | FR-CREATE-007；Copy安全 | API/DB | U-MGMT；I-VAR-ACTIVE | 每個新SKU Code；原barcode及外部唯一碼 | POST /items/:id/copy，重送 | 新Item/SKUs均Draft；共用可複製欄位正確；Code由body提供；Barcode不複製；idempotent | request/response、source/target SQL、audit | — | NOT RUN |
| CREATE-013 | P1 | BR-006；疑似重複只警告 | API/UI | 已有同brand/name/category/variant Item | normalized name候選及合法新Code | duplicates/check後確認create | 最多10個deterministic候選；warning不合併、不阻擋合法建立；Item Name可重複 | responses、UI、created rows | — | NOT RUN |
| CREATE-014 | P1 | FR-PRICE-006、BR-024；Item價格只作預設 | UI/API/DB | 建立3 SKU | Item預設128；其中SKU覆寫98 | wizard帶入後保存、再改一SKU | 初次帶入可用；DB只在每個SKU保存獨立amount；改一個不影響其他SKU或Item | UI/request、SKU price SQL | — | NOT RUN |

### 6.4 修改、版本、關鍵欄位與交易快照

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EDIT-001 | P1 | FR-EDIT-001、AC-004 | API/DB | U-MGMT；I-VAR-ACTIVE | names、description、category、brand、attributes、SKU mutable fields | update Item/SKU並用detail/lookup讀取 | 合法新值可見且下游projection更新；version+1；audit before/after完整 | requests/responses、DB/audit、lookup | — | NOT RUN |
| EDIT-002 | P0 | FR-EDIT-004、BR-022、AC-020、NFR-006 | Concurrency/API | 兩session讀同version | 不同SKU更新 | A先保存，B以舊version保存；再barrier同步 | 只一個成功；另一個409 VERSION_CONFLICT；無自動重送或欄位混合；audit只屬成功者 | responses、lock log、DB/audit | — | NOT RUN |
| EDIT-003 | P0 | FR-EDIT-005、BR-021；更新重新驗證 | API/Transaction | Active aggregate | duplicate Code/barcode/variant、失效catalog、price=0、invalid dates | 逐項update完整集合 | UI/API/import相同規則及code；任一錯誤整組不變；version/audit不增 | responses、DB/audit diff | — | NOT RUN |
| EDIT-004 | P0 | 設計§6.9；child ownership | API/Security | SKU A/B各有UOM/barcode/value | A route帶B child IDs | 更新A完整集合 | 400 SKU_CHILD_MISMATCH；不可將B child當新增；A/B及audit均不變 | request/response、兩aggregate SQL | — | NOT RUN |
| EDIT-005 | P0 | FR-EDIT-002、FR-EDIT-006、SEC-006 | API/Auth/DB | U-MGMT；DEV-OK/BAD | 普通update含skuCode；專用code/change含reason/password/signature | 逐入口修改Code | 一般入口拒絕/不接受欄位；只有jwt-device-password專用入口成功；reason必填、version+1、audit完整 | auth matrix、responses、DB/audit | — | NOT RUN |
| EDIT-006 | P0 | FR-EDIT-003、BR-012、AC-016 | Integration/DB | SKU-REF有交易/庫存；SKU-NOREF無引用 | Base UOM、factor、tracking policy | 兩fixture分別更新 | referenced者回UOM_CHANGE_BLOCKED/TRACKING_POLICY_CHANGE_BLOCKED並列依賴；未引用且reason合法才可改 | responses、reference queries、DB/audit | — | NOT RUN |
| EDIT-007 | P1 | BR-030；Item default不追溯 | API/DB | Item已有none與batch SKU | defaultTrackingPolicy=batch_expiry、defaultShelfLife=540 | 更新Item default後建立新SKU | 既有SKU完全不變；新SKU取得預設但仍可覆寫；audit只記Item default | before/after SQL、response/audit | — | NOT RUN |
| EDIT-008 | P1 | BR-019、BR-026；交易snapshot不可回寫 | Integration/DB | SKU已有purchase/sale snapshot | 改name、Code特批、UOM顯示、RRP | 完成修改後讀歷史交易 | master/lookup顯示新值；歷史保留當時SKU ID、Code、name、UOM與實際成交價 | master/snapshot SQL、API | — | NOT RUN |
| EDIT-009 | P0 | NFR-005(B)、FR-AUDIT-004；修改與audit原子性 | Failure/Transaction | 可注入child、audit、commit失敗 | Item/SKU aggregate update | 各步驟失敗後查DB並重試 | 每次失敗業務資料、children、version及audit全rollback；無成功但缺audit；修復後可重試 | error、transaction log、全表diff | — | NOT RUN |

### 6.5 Lifecycle、刪除與父子同步

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIFE-001 | P0 | BR-032、AC-011、AC-037；Item停用 | API/Transaction | I-MIXED且Item Active | REASON、version | POST item/deactivate | Item Inactive；所有Active SKU同交易轉Inactive，其餘合法狀態保持；新交易lookup拒絕；歷史可查 | response、Item/SKU/audit SQL、lookup | — | NOT RUN |
| LIFE-002 | P0 | BR-032、AC-037；Item停產 | API/Transaction | Active/Inactive/Draft SKU混合 | password、REASON | POST discontinue | Item Discontinued；Active/Inactive SKU轉Discontinued且purchasable=false；Draft保持Draft但不可啟用；任一失敗全rollback | response、transaction、DB/audit | — | NOT RUN |
| LIFE-003 | P0 | BR-032、AC-037；Item封存 | API/Transaction | 可封存混合SKU；另有一組blocking reference | password、REASON | archive兩組 | 無引用者Item及所有非Archived SKU同交易Archived；有阻擋者全無變更並列引用 | responses、reference/transaction、DB/audit | — | NOT RUN |
| LIFE-004 | P0 | FR-DELETE-006、BR-032、AC-037；Restore | API/DB | Archived Item/SKUs；另製造Code/barcode/catalog衝突 | password、REASON | restore Item，修復衝突後再restore SKU | Item只回Inactive；SKU不自動restore/activate；逐SKU重新驗證唯一性及catalog後回Inactive | responses、DB/audit、conflict evidence | — | NOT RUN |
| LIFE-005 | P0 | 設計§4.2；最後Active SKU防護 | API/Concurrency | Active Item恰一Active SKU；另有兩Active SKU | deactivate單筆；同步停用兩個 | 單次及barrier提交 | 不可令Active Item零Active SKU，回LAST_ACTIVE_SKU；應改停Item或同時啟用替代SKU | responses、locks、final DB/audit | — | NOT RUN |
| LIFE-006 | P0 | FR-DELETE-004、BR-013、BR-014、BR-015、BR-031、AC-010、AC-030 | Lookup/Integration | Active/Inactive/Discontinued/Archived Item/SKU矩陣 | purpose purchase/sale/inventory | 查找後於下游提交時再驗證 | Inactive/Archived不能新單；Discontinued禁止purchase但sellable可清貨；父狀態限制生效且只屬全公司層；提交時重驗 | lookup/submit matrix、DB | — | NOT RUN |
| LIFE-007 | P0 | FR-DELETE-001、BR-016、AC-005 | API/DB | SKU-REF | password、REASON | delete及archive嘗試 | 永久刪除拒絕SKU_REFERENCED並提供可用狀態選項；archive依reference policy處理；歷史不破壞 | responses、reference SQL、UI prompt | — | NOT RUN |
| LIFE-008 | P0 | FR-DELETE-002、AC-006 | API/DB | SKU-NOREF；Item另有SKU | password、REASON | delete Draft SKU | SKU及純children永久刪除；Item仍至少一SKU；audit target snapshot保留且事件可查 | response、before/after SQL、audit | — | NOT RUN |
| LIFE-009 | P0 | BR-001；不可留下零SKU Item | API/DB | Draft Item只一SKU | 刪最後SKU；刪整個未引用Draft Item | 逐一呼叫delete | 單刪SKU拒絕；刪Item可原子刪aggregate並保存delete audit；失敗無部分資料 | responses、DB/audit | — | NOT RUN |
| LIFE-010 | P1 | FR-DELETE-003、FR-DELETE-007、BR-017 | UI/API | I-MIXED及各阻擋fixture | deactivate/discontinue/archive/delete/restore | 開confirm並提交空白/4/5/190/191字reason | UI列target、SKU數、後果與阻擋；API要求合法reason；所有成功動作有audit | screenshots、responses、audit | — | NOT RUN |
| LIFE-011 | P1 | FR-DELETE-005、FR-VIEW-005 | UI/API | Archived Item/SKU | default及includeArchived filter | 列表、selector、detail查詢 | 日常列表/selector不顯示；顯式filter可查歷史且有Archived標示；不可用於新交易 | UI/API/lookup evidence | — | NOT RUN |
| LIFE-012 | P0 | NFR-007；狀態重送與並發 | Concurrency/DB | 同version Active Item | 重複deactivate；deactivate vs discontinue/archive | 連續與barrier提交 | 只一條合法狀態序列；其餘409或一致冪等結果；沒有重複/矛盾audit與deadlock殘留 | responses、lock log、DB/audit | — | NOT RUN |
| LIFE-013 | P0 | NFR-005(B)、BR-032；cascade故障rollback | Failure/Transaction | 可在第N個SKU或audit注入失敗 | 10個混合SKU | 執行各Item狀態動作 | 任一child/audit失敗令Item、全部SKU、flags、version及audit全rollback | errors、transaction log、全表diff | — | NOT RUN |

### 6.6 UOM、Barcode與下游Lookup

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UOM-001 | P1 | FR-UOM-001；Base與Pack維護 | API/DB/UI | U-MGMT；Draft SKU | EA base、BOX=24、CASE=96；default flags | 更新完整UOM集合並讀回 | 恰一Base且factor=1；最多一default purchase/sale；各Pack正確保存、排序及顯示 | request/response、UOM SQL、UI | — | NOT RUN |
| UOM-002 | P0 | FR-UOM-002、BR-011、AC-032 | Validation/API | U-MGMT | factor 0、負、小數、1、1000000、1000001；重複/循環語意 | create/update並提交模擬交易數量 | 只接受1～1,000,000整數；Base必為1；重複/循環拒絕UOM_CONVERSION_INVALID；Base交易數量小數拒絕 | responses、DB diff、validation output | — | NOT RUN |
| UOM-003 | P0 | 設計§5.8；default/base並發 | Concurrency/DB | 同SKU兩Pack；兩connection | 同步設兩Base/default | barrier提交 | DB/service始終最多一Base/default；Active SKU恰一Base；失敗方不留下部分集合 | responses、constraint/lock、final SQL | — | NOT RUN |
| UOM-004 | P0 | FR-UOM-003、SEC-008 | API/DB | SKU A/B及UOM | Barcode綁自身UOM、不存在UOM、別SKU UOM | 保存Barcode集合 | 只接受目標SKU有效UOM；cross-owner回SKU_CHILD_MISMATCH/validation error且兩SKU不變 | responses、FK、DB diff | — | NOT RUN |
| UOM-005 | P0 | FR-UOM-004、AC-012 | Lookup/UI | SKU-A有BOX=24與BC-BOX | BC-BOX、scanner input | 輸入箱碼並按Enter | scanner只在Enter查找；回唯一SKU、BOX及toBaseFactor=24；不自動建檔 | UI/network、lookup response、DB | — | NOT RUN |
| UOM-006 | P0 | BR-005、AC-013、AC-014 | Unit/API/DB | 各GTIN fixture | valid/invalid GTIN、internal Unicode、control、190/191字 | normalize/validate並跨SKU保存 | GTIN check digit與長度正確；internal只接受合法可列印值；normalized全域唯一；display值不被改寫 | unit output、responses、barcode SQL | — | NOT RUN |
| UOM-007 | P0 | SEC-006、FR-EDIT-006；Barcode release | API/Auth/DB | Barcode屬SKU-A；DEV-OK/BAD | reason/password/device signature、stale version | 普通delete與專用release逐組呼叫 | 一般集合更新不可偷渡釋放受保護碼；只有jwt-device-password成功；原值/SKU/reason保存在audit | auth responses、DB/audit | — | NOT RUN |
| UOM-008 | P0 | FR-UOM-005、BR-016 | Integration/DB | UOM row被Barcode、Supplier fixture或transaction引用 | 刪除UOM conversion | 分別移除各依賴後重試 | 有任一依賴即拒絕並列依賴類型；完全無引用才可刪；不破壞歷史換算 | responses、reference SQL、audit | — | NOT RUN |
| UOM-009 | P0 | BR-002、BR-020、SEC-003 | Integration/Contract | U-DOWN-P/S/I；多狀態SKU | findById/code/barcode、findMany、purpose與atMs | 由各下游Handler授權後呼叫Lookup | 下游不用item.view即可獲用途最小projection，但無管理能力；所有關聯仍以SKU ID；提交時再驗證 | auth/lookup traces、projection scan | — | NOT RUN |
| UOM-010 | P0 | BR-013～015；purpose矩陣 | Integration | 完整Item/SKU status、flag、date矩陣 | purchase/sale/inventory；effective邊界 | 執行find/assertUsable | purchase需雙Active+purchasable；sale依設計允許Discontinued清貨；inventory需tracked且非Archived；日期邊界正確 | fixture matrix、results | — | NOT RUN |
| UOM-011 | P1 | BR-019；Lookup及Barcode語意 | Integration | SKU含多UOM/Barcode及shelf policy | by barcode與findManyByIds(100) | 查找並建立模擬snapshot | projection含SKU ID、顯示Code/name、UOM/factor及三個效期欄；snapshot使用ID關聯；批量無N+1 | response、query count、snapshot SQL | — | NOT RUN |
| UOM-012 | P0 | 設計§7.6；重複Barcode事故 | Failure/Observability | 以受控方式繞過constraint製造兩命中fixture | 同normalized barcode | scanner/Lookup查詢 | 系統記error/metric並拒絕選擇，不任取第一筆；一般使用者看安全錯誤且無主資料變更 | response、structured log/metric、DB | — | NOT RUN |

### 6.7 Price、Tracking Policy、Attribute及Catalog

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRICE-001 | P0 | FR-PRICE-001、FR-PRICE-002、BR-024、BR-025、AC-022、AC-023 | API/DB | 同Item兩SKU | null、0、負、0.0001、128.0000、超precision/range | Draft/Active、sellable true/false逐組保存/啟用 | 價格逐SKU獨立；Active+Sellable只接受>0；Draft/不可售可空；decimal以string精確保存 | responses、SKU SQL、validation | — | NOT RUN |
| PRICE-002 | P0 | FR-PRICE-003、AC-033 | API/UI/CSV | SKU有RRP | request企圖傳currency/taxBasis；detail/import/export | 經各入口讀寫 | request不接受覆寫；所有輸出固定amount string、HKD、tax_not_applicable且一致 | schemas、responses、UI/CSV | — | NOT RUN |
| PRICE-003 | P0 | FR-PRICE-004、AC-024 | API/Audit | SKU-A；已存在sale snapshot | RRP 128→138；純價格無reason | update後讀audit與歷史交易 | 純RRP可無reason；audit含舊/新amount、HKD、tax basis、actor/time；歷史成交價不變 | response、audit/snapshot SQL | — | NOT RUN |
| PRICE-004 | P1 | FR-PRICE-005、BR-026 | Integration | 定價/銷售stub可用 | RRP與門店/促銷成交價不同 | 建單並修改RRP | RRP只作參考/default；不覆蓋正式計價；已建交易的實際單價永不回寫 | integration trace、snapshot DB | — | NOT RUN |
| PRICE-005 | P1 | FR-PRICE-006；批量預設後獨立維護 | UI/API | Variant wizard | Item default 128；SKU-B改98 | 建立後分別update | 每SKU保存自己的值；改一筆不級聯；Item表不保存正式price欄 | requests、schema/SQL、UI | — | NOT RUN |
| PRICE-006 | P0 | 金額精度與projection | Unit/API | decimal boundary fixtures | 4/5 decimals、19位precision、科學記號、number而非string | create/update/read | 僅契約允許的decimal string通過；不發生JS浮點誤差；response不回number | unit/schema output、responses | — | NOT RUN |
| TRACK-001 | P0 | BR-008～010、AC-015 | Validation/API | Draft SKU | none/batch/batch_expiry/serial；shelf null/0/1 | activate | 所有policy白名單；batch_expiry需正整數shelf；其他policy按schema處理非適用欄 | response issues、DB/audit | — | NOT RUN |
| TRACK-002 | P0 | BR-010；最低效期邊界 | Validation | batch_expiry shelf=540 | receipt/sale=-1,0,540,541,null | create/update/activate | 0～540或null按契約接受；負值或>shelf拒絕且指出正確path | validation output、responses | — | NOT RUN |
| TRACK-003 | P0 | AC-034；收貨效期豁免contract | Integration/Contract | Lookup提供三效期欄；Receiving stub | 剩餘天數低/等/高於門檻；U-RECV-O/一般user；空白/合法reason | 提交收貨fixture | 低於門檻一般人拒絕；等/高通過；只專門permission+非空reason可override並由Receiving完整audit；item.mgmt不等於豁免 | contract responses、permission/audit fixture | — | NOT RUN |
| TRACK-004 | P0 | FR-EDIT-003、FR-EDIT-006；Tracking關鍵變更 | API/DB | 有/無庫存交易SKU | policy none→batch、batch→expiry；reason邊界 | update | 已引用一律阻擋；未引用須reason且完整重驗；失敗無version/audit變動 | responses、reference SQL、DB/audit | — | NOT RUN |
| TRACK-005 | P1 | BR-030、NFR-011；中央語意 | Unit/Contract | server/client/CSV constants可檢查 | statuses、tracking、UOM、HKD/tax basis | 比較各schema、projection、template及Lookup | 同一中央常數/契約語意；不出現不同拼法或client自行定義衝突 | contract tests、source mapping | — | NOT RUN |
| CAT-001 | P1 | NFR-010；Category可配置屬性 | API/DB/UI | U-MGMT；多category/attribute | required/order rules、expectedAttributeIds | assignAttributes、stale compare-and-set | mapping原子覆蓋；按分類顯示/驗證；stale拒絕；新增消耗品類不需改items固定schema | responses、mapping SQL、UI | — | NOT RUN |
| CAT-002 | P0 | 設計§5.3；Category tree完整性 | API/DB | 8層tree | root/同parent同名、不同parent同名、move self/descendant、深度8/9 | create/move並發與單次 | root及同parent不分case唯一；不同parent可同名；cycle與第9層拒絕；tree無斷裂 | responses、tree SQL、constraint | — | NOT RUN |
| CAT-003 | P0 | BR-008；Active需Active leaf Category | API/DB | CAT-LEAF/PARENT/INACTIVE | Draft/Active Item | 指派後activate | Draft可暫缺；Active只接受Active leaf；non-leaf/inactive/archived明確拒絕 | response issues、DB/audit | — | NOT RUN |
| CAT-004 | P1 | Catalog unique/version/status | API/DB | U-MGMT | Brand name、UOM code、Attribute code/options大小寫duplicate；stale version | create/update/status | unique與version規則穩定；Attribute code建立後不可改；所有成功寫audit | responses、constraints、DB/audit | — | NOT RUN |
| CAT-005 | P0 | BR-016、FR-UOM-005；Catalog in-use guard | API/DB | 各catalog被Item/SKU/attribute引用 | delete/archive/deactivate | 逐資源操作 | 永久刪除被FK/guard拒絕並列依賴；狀態變更不令既有Active SKU失去必要依賴 | responses、reference SQL、audit | — | NOT RUN |
| CAT-006 | P0 | Attribute typed value規則 | Unit/API | text/long_text/decimal/boolean/date/single_option definitions | 零/多value欄、錯option、錯category、非variant作SKU value | create/update | 每值恰一typed column；錯型別/option/category回ATTRIBUTE_VALUE_INVALID；不保存任意JSON | unit response、value SQL | — | NOT RUN |
| CAT-007 | P0 | Variant definition破壞性修改 | API/DB | Active SKU使用attribute/options | 改dataType/isVariant、刪option、deactivate | update/delete | 會破壞既有variant signature/activation者拒絕；資料及signature不變；可安全的display修改可行 | responses、reference SQL、DB/audit | — | NOT RUN |
| CAT-008 | P1 | BR-018、BR-029；文字及單語系 | Validation/UI | U-MGMT | 中英文UTF-8、首尾空白、HTML/script、超長；translation欄 | create/update/render | trim後保存單一UTF-8值；未知translation欄拒絕；標記只作文字不執行；長度錯不截斷 | responses、DB值、DOM/security headers | — | NOT RUN |

### 6.8 Media與附件

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MEDIA-001 | P1 | FR-EDIT-001、FR-AUDIT-001；合法上傳 | API/File/DB | U-MGMT；可寫受控root | PNG/JPEG/WebP≤5MB、PDF≤10MB | Item/SKU各upload一檔 | server生成stored name；metadata/sha256/ownership正確；version/audit更新；圖片可預覽、PDF attachment | response、file hash/inventory、DB/audit | — | NOT RUN |
| MEDIA-002 | P0 | SEC-007；型別/大小/signature驗證 | API/Security | U-MGMT | SVG、zip、exe、polyglot、偽extension/MIME、5/10MB邊界與超1 byte | 逐檔上傳 | 只接受allowlist且signature/MIME/extension一致；超限拒絕；無metadata/孤兒檔 | responses、filesystem/DB diff、logs | — | NOT RUN |
| MEDIA-003 | P0 | SEC-007～008；path與ownership | API/Security | Item A/B及media | ../filename、absolute path、symlink；A route帶B target | upload/download/update/delete | 使用者path不影響存放；root外與symlink拒絕；cross-owner 404/拒絕且不洩漏存在性 | responses、resolved-path proof、DB/file diff | — | NOT RUN |
| MEDIA-004 | P1 | 設計§6.6；multipart string parsing | Handler/API | U-MGMT | isPrimary=true/false/1/yes/任意字串；sort/version合法非法 | multipart upload | 只接受明確契約字串並正確轉型；含糊boolean、非法integer/version 400；不產生檔案 | handler tests、responses、inventory | — | NOT RUN |
| MEDIA-005 | P0 | Primary image原子性 | Concurrency/DB | 同scope已有primary及兩candidate | 同時set兩primary | barrier update | 最終scope恰一primary；舊值正確清除；generated key防雙primary；audit與最終值一致 | responses、constraint/lock、DB/audit | — | NOT RUN |
| MEDIA-006 | P0 | DB／檔案雙資源失敗一致性 | Failure/Integration | 可注入DB insert/commit、file move、unlink失敗 | 合法image | upload/delete各失敗點 | upload失敗不留孤兒或metadata；delete先commit DB/audit再unlink；unlink失敗有結構化告警供cleanup重試 | errors、transaction/file inventory、logs | — | NOT RUN |
| MEDIA-007 | P0 | Download response安全 | API/Security | U-VIEW；合法image/PDF | originalName含CRLF/Unicode；Content-Type | GET download | image受控inline、PDF一律attachment；filename安全編碼；nosniff；不回stored path；內容hash一致 | headers、hash、response scan | — | NOT RUN |
| MEDIA-008 | P1 | Media metadata update | API/DB | U-MGMT；既有media | display name、sort、primary；企圖改path/hash/MIME | POST update | 只允許三類mutable欄；內部欄拒絕；version/ownership/audit正確 | responses、DB/audit diff | — | NOT RUN |
| MEDIA-009 | P0 | SEC-001～002；Media授權 | API/Auth | U-VIEW/U-MGMT/U-MGMT-ONLY/U-NONE | download/upload/update/delete | 權限矩陣呼叫 | view可download；mgmt 或 mgmt-only可完整讀寫；delete需jwt-password；拒絕無副作用 | responses、auth metadata、DB/file diff | — | NOT RUN |
| MEDIA-010 | P1 | Media cleanup grace | Job/File | referenced、recent orphan、old orphan | root外檔、symlink、grace前後 | 執行cleanup及重跑 | referenced/recent/root外/symlink保留；只刪過grace的root內orphan；重跑冪等；失敗有log | inventory、job logs/metrics | — | NOT RUN |
| MEDIA-011 | P0 | FR-AUDIT-004；Media audit原子性 | Failure/Transaction | 注入audit失敗 | upload/update/delete | 各操作 | metadata寫入與audit一致；audit失敗不回成功；delete不先刪實體檔造成不可恢復 | response、transaction、DB/file/audit | — | NOT RUN |
| MEDIA-012 | P0 | SEC-005；不得外洩未定義敏感欄 | API/Export | media與SKU fixtures | stored path/hash、未來cost/supplier欄 | 掃list/detail/download/export/audit/log | 白名單projection不含stored path、內部hash、cost或supplier terms；log不含檔案內容 | response/CSV/log scans | — | NOT RUN |

### 6.9 CSV Import與Export

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IMP-001 | P1 | FR-IMPORT-001；versioned template | API/File/UI | U-MGMT | Template v1 | 下載並檢查headers、encoding、欄位說明、範例 | UTF-8 CSV含明確版本、required/optional、create/upsert/stable ID、HKD/tax口徑及範例 | response headers、file hash/content、UI | — | NOT RUN |
| IMP-002 | P1 | NFR-009；RFC4180與跨介面一致 | File/Contract | parser可用 | BOM、quoted comma/newline/quote、CRLF/LF、Unicode、前導零 | upload/preflight/result後再parse | 欄位不錯位、不損失；Code前導零保留；欄位/status/error code與UI/API一致 | parsed values、contract diff、result file | — | NOT RUN |
| IMP-003 | P0 | SEC-007；Upload邊界與path安全 | API/Security | U-MGMT；受控import root | empty、非CSV、壞UTF-8、malformed、10000/10001 rows、偽MIME、../name、symlink | 逐檔upload | 只接受合法CSV且server命名；超列/壞格式拒絕；不離開root、不跟symlink；無孤兒job/file | responses、filesystem/DB inventory、logs | — | NOT RUN |
| IMP-004 | P0 | FR-IMPORT-002、AC-017；Preflight零正式寫入 | API/DB | U-MGMT；CSV-MIXED | upload job | 執行preflight前後比較所有商品及audit表 | 只寫Job/Rows/結果；Item/SKU/catalog/UOM/barcode/media/audit完全不變 | response、全表前後SQL、job/row SQL | — | NOT RUN |
| IMP-005 | P1 | FR-IMPORT-003；逐列可修正錯誤 | API/UI | invalid/warning rows | field/type/unique/lifecycle/cross-field errors | 查job detail及result CSV | 每列含row、operation、field、stable code、可理解message；arrays/字數有界；summary一致 | response、UI、CSV、fixture matrix | — | NOT RUN |
| IMP-006 | P0 | FR-IMPORT-004、AC-031；任一錯全批不寫 | API/DB | invalid job；另有ready job | 一壞列＋多合法列 | 對invalid job confirm；修正重傳/preflight/confirm | invalid不可confirm或執行；整批0商品寫入；全部valid的新job才可queued/applied | responses、Item/SKU/audit counts、job state | — | NOT RUN |
| IMP-007 | P0 | FR-IMPORT-005；Stable ID upsert | API/DB | 既有SKU id/version | 正確ID+Code、錯ID、Code不符、只用Code、deleted ID | upsert preflight/execute | update必須stable SKU ID+expected version；Code只交叉檢查；不可藉匯入改Code或匹配到新對象 | row errors、responses、SKU/audit SQL | — | NOT RUN |
| IMP-008 | P0 | FR-IMPORT-004、NFR-005(B)；執行全批原子 | Failure/Transaction | ready 100-row job；可在任意row/audit/commit注入失敗 | create+update混合 | 各失敗點confirm/worker後查DB | 全批商品transaction rollback；Job另短交易failed；無applied半批、孤兒或錯誤success audit | worker/transaction logs、全表diff、job rows | — | NOT RUN |
| IMP-009 | P0 | 執行前重新驗證競態 | Concurrency/DB | preflight ready後修改catalog/SKU version或占用unique | stale version、barcode/variant race | confirm並執行 | worker重新讀catalog、unique及versions；任一競態令全批rollback並回穩定錯誤 | responses、lock/SQL、job/result | — | NOT RUN |
| IMP-010 | P0 | FR-IMPORT-006、AC-018、NFR-007；Idempotency | API/DB/Concurrency | upload/ready job | 同key同/異payload、相同file不同key、雙擊confirm | 連續與barrier提交 | route重送不重複Job/SKU/audit；同key異payload拒絕；合法刻意重跑仍受business unique規則 | responses、idempotency/job/SKU/audit SQL | — | NOT RUN |
| IMP-011 | P0 | Job state machine與cancel | API/DB | 各uploaded/validating/invalid/ready/queued/running/terminal job | confirm/cancel/reconfirm | 對每state執行動作 | confirm只ready；cancel只uploaded/ready/queued；非法轉換IMPORT_STATE_CONFLICT；version CAS生效 | matrix responses、job SQL/audit | — | NOT RUN |
| IMP-012 | P0 | Lease、重啟與單owner | Worker/Concurrency | queued/running job；兩worker | lease有效/過期、crash、abort signal | 同時claim；owner crash後接管 | 同job同時一owner；有效lease不搶；過期安全接管；已commit資料不重做；最終統計一致 | worker logs、lease/job/row SQL | — | NOT RUN |
| IMP-013 | P1 | FR-IMPORT-007、FR-IMPORT-009；進度與結果 | API/UI | small/large completed/failed jobs | totals、success/failure/skip/warning | poll、完成通知、下載result | 狀態單調且統計等於rows；通知不含CSV資料；result可parse；失敗原因安全可理解 | UI/network、job/row SQL、CSV | — | NOT RUN |
| IMP-014 | P0 | FR-IMPORT-008、SEC-002、SEC-009 | Auth/Security | U-MGMT/U-VIEW/U-NONE | template/upload/list/detail/confirm/result/export | 權限矩陣呼叫 | 全部import/export只item.mgmt；confirm用jwt-password；拒絕無副作用；export有audit且不含內部/敏感欄 | responses、auth metadata、CSV/audit scan | — | NOT RUN |
| IMP-015 | P0 | FR-IMPORT-004；10k不可逐列transaction | Integration/DB | ready 10,000-row job | 全valid rows | 執行並監看connections/transactions | 單一商品transaction、bounded parsing/batch；不是10k獨立commit；完成後counts/audit正確 | DB trace、worker metrics、row/job SQL | — | NOT RUN |
| IMP-016 | P0 | AC-036；一周年檔案保留 | Job/File/DB | terminal job滿/未滿1年、non-terminal、已清理 | source/result files、UTC邊界、unlink failure | 執行cleanup、重跑、下載/查detail | 只刪到期terminal受控檔並CAS標記；summary/audit保留≥7年；result 410但detail 200；重跑冪等、失敗可續 | clock fixture、inventory、job/audit SQL、logs | — | NOT RUN |
| IMP-017 | P1 | FR-LIST-008、SEC-005；一般SKU Export | API/File | U-MGMT；filter與Archived設定 | SKU/UOM/barcode/RRP資料 | GET export並以parser讀回 | 只匯出filter/permission範圍；HKD/tax固定；無stored path、hash、cost、supplier terms；item.export audit一筆 | request、CSV content/hash、audit | — | NOT RUN |

### 6.10 Audit、Authentication、Authorization及Security

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | P0 | FR-AUDIT-001、FR-AUDIT-002、AC-021 | API/DB | U-MGMT；各target fixtures | Item/SKU/barcode/UOM/attribute/status/media create/update/delete | 每類執行成功操作後查audit | 每個事件含time、actor snapshot、action、target ID/Code、bounded before/after、reason、requestId；action與設計catalogue一致 | requests、audit rows、DB對照 | — | NOT RUN |
| AUD-002 | P0 | FR-AUDIT-003、SEC-005 | Security/Data | 使用唯一marker | password/JWT/device key/file content/CSV row/cost/supplier term | 執行成功與失敗流程後掃audit/log/error | 禁止值搜尋為0；import只記job/hash/mode/stats；errors不含SQL/stack/path | redacted scan commands/counts、sample rows | — | NOT RUN |
| AUD-003 | P0 | FR-AUDIT-004、NFR-005(B) | Failure/Transaction | 可令audit insert失敗 | 每類業務write | 注入失敗並查aggregate/audit | 業務修改與audit全有或全無；沒有資料已改但audit遺失；公開回應不誤報成功 | response、transaction log、DB diff | — | NOT RUN |
| AUD-004 | P0 | FR-AUDIT-005 | API/DB/Security | U-MGMT/U-VIEW | PUT/POST/DELETE猜測audit endpoints；直接DB應用帳號 | 嘗試修改/刪除audit | 無update/delete API；一般應用權限不可改歷史；讀取不改row；備份可恢復 | route list、responses、DB grants/hash | — | NOT RUN |
| AUD-005 | P1 | FR-AUDIT-006 | API/UI | 大量不同actor/action/target/time audit | page/filter邊界 | 依SKU Code、actor、action、type、from/to查詢 | filter交集與total正確；固定occurred_at DESC,id DESC；pageSize≤100；無任意sort | response、UI、SQL | — | NOT RUN |
| AUD-006 | P1 | NFR-005(A)；每日變更audit完整 | Performance/DB | 1,000次混合Item/SKU/Catalog write workload | create/update/status比率 | 執行一日代表負載並對帳 | 每個成功state change均有對應audit；失敗沒有success audit；count/target/requestId可完整對帳 | workload、reconciliation SQL/report | — | NOT RUN |
| AUTH-001 | P0 | SEC-001 | API/UI | 未登入/session過期 | 所有route family樣本 | 直接URL與API呼叫 | API 401；頁面導登入/403依既有慣例；不回任何商品資料、不產生副作用 | responses、routes、DB/file diff | — | NOT RUN |
| AUTH-002 | P0 | SEC-002、AC-019、AC-028 | API/UI | U-VIEW | list/detail/media/audit及全部write family | 權限矩陣呼叫 | 所有指定read成功；所有create/update/status/delete/import write 403且無資料變更 | matrix responses、DB/audit/file diff | — | NOT RUN |
| AUTH-003 | P0 | SEC-002、DEC-025；管理者完整 API 權限 | API/UI | U-MGMT-ONLY | 所有read/write樣本 | 呼叫及直接URL | Item、SKU、Catalog、Media、Audit 的 GET/detail 頁與 write 均成功；無 Item 權限者仍拒絕 | responses、route guard、policy metadata | — | NOT RUN |
| AUTH-004 | P0 | SEC-003 | Integration/Security | U-DOWN-P/S/I | Lookup及管理API | 從獲授權下游流程查SKU，再直接呼叫管理端點 | Lookup只回用途最小projection；管理API/頁拒絕；不可改主資料或查audit/media | responses、projection scan、DB | — | NOT RUN |
| AUTH-005 | P0 | SEC-004 | API/Security | UI隱藏按鈕；U-NONE/U-VIEW | 手工HTTP write | 直接呼叫所有write route classes | 後端逐支驗證permission/authType；全部拒絕且無副作用 | route inventory、responses、DB/audit | — | NOT RUN |
| AUTH-006 | P0 | SEC-006；高風險認證矩陣 | API/Auth | U-MGMT；DEV-OK/BAD | delete/status/code-change/barcode-release/import-confirm/bulk | 缺/錯password、device、signature、reason及合法組合 | delete/discontinue/archive/restore/import confirm/bulk需jwt-password；code/release需jwt-device-password；合法才進service | handler metadata、auth responses/logs | — | NOT RUN |
| AUTH-007 | P0 | 設計§3.2；fresh actor | API/Auth/DB | 登入後撤權/停用user | stale JWT | 每個公開Item service讀/寫樣本 | assertActorFresh先執行；回PERMISSION_STALE/拒絕；無DB/file/audit副作用 | responses、query order trace、DB diff | — | NOT RUN |
| AUTH-008 | P0 | SEC-008；IDOR與aggregate ownership | API/Security | Item/SKU/media/barcode/category A/B | 更換path/body child ID | read/update/delete/release/download | 不可跨aggregate操作；不可藉錯誤判斷無權限target存在；兩邊資料不變 | responses、DB/file/audit diff | — | NOT RUN |
| AUTH-009 | P0 | SEC-007、BR-018；Injection與schema | API/UI/File | U-MGMT/U-VIEW | HTML/script、SQL、LIKE%、control、unknown fields、oversized arrays | 對query/body/CSV/name/description提交 | additionalProperties false；sort whitelist/parameterized SQL；文字不執行；超限拒絕；DB完整 | responses、SQL trace、DOM/CSP、DB | — | NOT RUN |
| AUTH-010 | P0 | Response allowlist與安全錯誤 | API/Security | 可觸發not found/duplicate/DB/file errors | internal columns、constraint、stack/path marker | 掃所有response/log | mapper只回白名單；公開code穩定；不含SQL、constraint原文、stack、absolute path或他人資料 | automated payload scan、responses/logs | — | NOT RUN |

### 6.11 UI／UX與無障礙

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-001 | P1 | 設計§7.1～7.2；menu/route權限 | UI/Router | 各角色 | 11頁route、static/dynamic order | menu與直接URL逐頁訪問 | items menu order唯一；page metadata正確；static categories/audit不被/:id誤接；無權限導/403 | route tests、screenshots | — | NOT RUN |
| UI-002 | P1 | FR-LIST-007、FR-LIST-009 | UI | U-VIEW；多頁結果 | view/q/filter/sort/page | 操作、refresh、back/forward、分享URL | 預設SKU view；全部query state可還原；不建立未定義saved-filter資料 | URL、screenshots、network | — | NOT RUN |
| UI-003 | P1 | FR-CREATE-005、FR-CREATE-009 | UI | U-MGMT；Variant fixture | wizard、duplicate warning、Draft/直接Active | 逐步輸入、返回、提交invalid/valid | variant matrix可確認；兩種保存動作清楚；失敗保留輸入並聚焦全部issues；不出現approval步驟 | screenshots、DOM/network | — | NOT RUN |
| UI-004 | P1 | FR-EDIT-002、FR-EDIT-007 | UI | 開啟既有SKU editor | dirty fields、Code change action | route leave/browser unload、取消/離開；開Code action | dirty時均提示；取消留在頁面且草稿保留；成功保存才清dirty；Code readonly且專用dialog | screenshots、browser events | — | NOT RUN |
| UI-005 | P1 | FR-DELETE-003、FR-VIEW-005 | UI | 各狀態與阻擋fixture | row actions/high-risk dialogs | 開row menu與confirm | 只顯示狀態合法動作；文字+icon標狀態；dialog列target/SKU數/阻擋/後果/reason/password | screenshots、DOM | — | NOT RUN |
| UI-006 | P1 | 設計§7.4；Version conflict UX | UI/API | 兩editor同一SKU | 不同草稿 | A保存後B保存 | B不自動重送；提示重新載入，保留草稿供比較/複製；不聲稱保存成功 | screenshot、network、final DB | — | NOT RUN |
| UI-007 | P1 | 可鍵盤操作及error accessibility | UI/A11y | keyboard/screen-reader tooling | CRUD、tabs、row actions、dialogs、scanner、invalid form | 不用mouse完成；提交錯誤 | focus順序/visible focus合理；labels/descriptions可讀；錯誤時focus摘要或首欄；狀態不只靠顏色 | keyboard recording、a11y scan、DOM | — | NOT RUN |
| UI-008 | P1 | BR-023、NFR-012 | UI/CSV | 固定epoch及APP_TIME_ZONE/locale矩陣 | DST/日界、decimal/date | 切locale/timezone顯示並匯出 | UI依formatter顯示；CSV用ISO8601+offset；API epoch無歧義；數字格式顯示不改傳輸精度 | screenshots、CSV/API values、unit tests | — | NOT RUN |

### 6.12 效能、可觀測性、備份與部署

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | P1 | NFR-001、NFR-003、AC-035 | Performance | PERF dataset；production-like MySQL/app | 50-user mixed list/exact code/barcode | warm-up後穩定負載 | 三類查詢p95<2s；error rate達release門檻；資源無失控；結果正確 | workload/config、p50/p95/p99、error/resource graphs | — | NOT RUN |
| OPS-002 | P1 | NFR-003；上限資料與query plan | Performance/DB | 100k SKU、1m Barcode、1m UOM | exact、prefix、filters、Item EXISTS、findMany100 | EXPLAIN ANALYZE/等效及負載 | exact不full scan；列表只取摘要；total不膨脹；findMany固定少量query且無N+1 | plans、query counts、latency | — | NOT RUN |
| OPS-003 | P1 | NFR-004、AC-035 | Performance/Worker | 10k CSV＋50 online users | preflight+execution及lookup混合 | 同時執行並計時 | CSV系統處理合計≤10分鐘；線上lookup仍p95<2s；pool queue/deadlock/retry/error受控 | timing、APM/DB metrics、result counts | — | NOT RUN |
| OPS-004 | P1 | NFR-005(A) | Capacity/DB | 代表每日1,000 writes資料集 | Item/SKU/Catalog mix | 執行負載、重啟後對帳 | 所有成功變更和audit一一對應；無容量錯誤/漏event；列表/lookup SLA不顯著退化 | workload、reconciliation、metrics | — | NOT RUN |
| OPS-005 | P1 | 設計§12.3；metrics/alerts | Observability | metrics/log backend可用 | latency/error/constraint/import queue/media failure | 逐一觸發 | 指標按類型可分；queue age、lease recovery、duplicate conflicts、media failure可告警；log只含allowlist context | dashboards、alert events、redacted logs | — | NOT RUN |
| OPS-006 | P0 | NFR-008；DB＋Media備份還原 | Recovery | 有Item/Catalog/Audit/Import/Media fixture | 一致性備份及隔離restore | restore後啟動、查詢、下載、audit/lookup smoke | DB與media在相同recovery point可還原；links/hash一致；缺media可偵測而不誤報完整成功 | backup manifest、restore logs、hash/query report | — | NOT RUN |
| OPS-007 | P1 | AC-036；保留政策 | Operations | 7年metadata/audit、1年import file時鐘fixture | 未到/到期/較長法規期限 | 跑retention並查歷史 | 主資料/audit/job summary不早於7年刪除；import files只按1年規則；較長期限優先；無自動purge主資料 | job log、DB/file inventory、policy config | — | NOT RUN |
| OPS-008 | P0 | 設計§14；Forward-only rollback | Deployment | staging備份；已套Item migrations | 新server失敗、回舊server/client | 演練deploy/rollback | 不DROP新表、不改已套migration；舊版可啟動且新資料保留；修正版可forward deploy | runbook log、schema/data diff、health | — | NOT RUN |
| OPS-009 | P0 | Phase release smoke | Deployment/E2E | 每Phase build與隔離環境 | permissions/catalog/Draft/direct Active/search/deactivate/audit；Phase3 queue | 按部署順序執行smoke | 每Phase gate全部成功才放行；permission/catalogue一致；HKD/tax固定；Phase3 jobs註冊且queue age正常 | deploy log、smoke report、screenshots/SQL | — | NOT RUN |

## 7. 執行分層與建議順序

### 7.1 自動化層級

| Layer | 主要案例 | 執行位置 | 通過證據 |
| --- | --- | --- | --- |
| Pure unit | SKU/price/tracking/UOM validation、GTIN、variant signature、config、state transition | 每次CI | 測試輸出、coverage floor、固定boundary vectors |
| Service unit | aggregate transaction、rollback、audit、version、catalog、lookup、media、import state machine | 每次CI | 具狀態fake／dependency assertions；不可拿來代替真DB結論 |
| Handler/client unit | path、method、authType、permission、schema、mapper、URL/body、multipart parsing | 每次CI | route inventory、schema negative cases、projection scan |
| MySQL integration | migrations、collation、generated slots、FK、unique、locking、rollback、HTTP＋DB | PR及release | 真MySQL輸出、SQL snapshot、transaction／concurrency evidence |
| File/worker integration | media upload/download/cleanup、CSV parser、lease、retention | PR及release | 受控file inventory、hash、job/row state、worker log |
| Vue component/E2E | role routes、wizard、editor、scanner、dialogs、a11y、URL state | PR及release | screenshot、DOM/network、browser console |
| Performance/Recovery | 100k/1m dataset、50 users、10k CSV、1k writes、backup/restore | Release gate | workload、APM、DB plans、reconciliation、restore report |

### 7.2 執行順序

1. 鎖定 build、commit、migration編號、需求版本與隔離環境；先解決 §9 的規格／資料前置問題。
2. 執行 pure unit、service、handler及client tests；任何P0規則失敗即停止向下游環境推進。
3. 對真MySQL執行 MIG、CREATE、EDIT、LIFE、UOM、PRICE、TRACK、CAT、AUD、AUTH integration。
4. 在受控file roots執行 MEDIA、IMP及worker故障／重啟案例。
5. 執行Vue component與端到端核心旅程，之後才執行效能、備份還原及部署演練。
6. 每輪更新Actual Evidence、Status、defect及追蹤總覽；不得只以「suite pass」取代逐案例證據。

## 8. Entry／Exit Criteria

### 8.1 Entry Criteria

- requirement.md與design_spec.md版本已凍結；重複NFR-005及Migration序號已得到可追溯處置。
- 測試build、commit、環境、APP_TIME_ZONE、MySQL版本及Item config已記錄。
- 隔離MySQL、media/import roots、scheduler及可控時鐘／故障注入能力可用。
- 測試permission users、approved device、catalog、SKU、引用、CSV及效能fixtures可重建。
- 如執行下游案例，Purchasing／Sales／Inventory／Receiving contract stub或已部署模組可用。

### 8.2 Exit Criteria

- 所有P0與P1案例已執行，或有業務／技術負責人核准的NOT APPLICABLE理由；不得以環境缺失直接視為PASS。
- P0 defect為0；P1 defect已修復重測或有明確風險接受人、期限及補償控制。
- 所有成功寫入與audit reconciliation一致；Migration、concurrency、rollback、security、media/import cleanup有真環境證據。
- NFR-001、NFR-003、NFR-004、NFR-005(A)、AC-035的效能結果達標，備份還原及forward-only rollback演練成功。
- Traceability可由需求／風險定位到案例、結果、證據及defect，release owner完成簽核。

## 9. 已知未決事項與殘留風險

| ID | 類型 | 事項 | 測試影響／解除條件 |
| --- | --- | --- | --- |
| OPEN-001 | 規格缺陷 | requirement.md的NFR-005重複編號 | 本文件暫用(A)/(B)；BA正式重新編號並同步所有文件後關閉，否則報告須一直保留語意別名。 |
| OPEN-002 | 實作基線 | design_spec.md預留0009～0025，但main已有0009_add_user_email.js | 實作分支按最新main重新編號並更新design/tasks；MIG-001通過前不得執行部署簽核。 |
| OPEN-003 | 業務資料 | 初始Category、UOM、Attribute及Internal Barcode規則樣本尚待業務提供 | 可用QA fixture測技術規則，但正式UAT與catalog smoke要待核准樣本。 |
| OPEN-004 | 合規 | 7年主資料/audit與1年import file期限仍需上線前合規核對 | 未核對前可測現行規則，不可作正式retention sign-off；若改期須更新需求、cleanup及案例。 |
| OPEN-005 | 下游依賴 | Inventory、Purchasing、Sales、Pricing、Receiving可能尚未實作 | 先執行ItemLookup contract tests；真正交易snapshot、提交時重驗及效期override在相應模組可用後完成，未執行狀態為BLOCKED而非PASS。 |
| OPEN-006 | Supplier關係 | item_supplier_refs明確延後，現階段不得保存無FK supplier_id | FR-UOM-005涉及supplier relation的分支只能在正式Supplier FK設計上線後執行；目前先驗Barcode/transaction引用及schema absence。 |
| OPEN-007 | 非功能門檻 | 除明確p95與10分鐘外，允許error rate、資源上限、RPO/RTO沿用ERP政策但數值未在本文件給出 | Release test開始前記錄組織級門檻；不得由測試人員臨場自訂PASS線。 |

## 10. 需求覆蓋檢查

本文件的案例文字已逐一引用 requirement.md 中全部154個唯一需求ID；重複的NFR-005則按兩個獨立語意條款覆蓋，因此實際覆蓋155條需求敘述。覆蓋範圍如下：

- 功能需求：FR-LIST-001～FR-LIST-010、FR-VIEW-001～FR-VIEW-005、FR-CREATE-001～FR-CREATE-009、FR-EDIT-001～FR-EDIT-007、FR-DELETE-001～FR-DELETE-007、FR-UOM-001～FR-UOM-005、FR-PRICE-001～FR-PRICE-006、FR-IMPORT-001～FR-IMPORT-009、FR-AUDIT-001～FR-AUDIT-006。
- 業務規則：BR-001～BR-032。
- 安全需求：SEC-001～SEC-009。
- 非功能需求：NFR-001～NFR-012，其中NFR-005(A)與NFR-005(B)分別測試。
- 驗收準則：AC-001～AC-037。

### 10.1 AC 可追溯性對照表（T36）

以下逐條列出 AC-001～AC-037 對應嘅自動化測試（`server/test/**`／`client/test/**`），冇自動化測試覆蓋嘅部分明確標注理由，唔勉強配一個唔相關嘅測試湊數。

| AC | 對應測試（檔案:測試名稱） | 備註 |
| --- | --- | --- |
| AC-001 | `itemCreate.integration.test.js`:「建立 Standard Item＋SKU（唔啟用）」；`itemRead.integration.test.js`:「GET /items/:id：完整詳情」；`itemAudit.integration.test.js` | 建立→詳情→稽核三段分別覆蓋 |
| AC-002 | `itemCreate.integration.test.js`:「SKU Code 唔分大小寫全域唯一…撞咗就 409，冇殘留」 | |
| AC-003 | `itemCreate.integration.test.js`:「Variant Item：兩個 SKU 用唔同規格組合」 | |
| AC-004 | `itemUpdate.integration.test.js`:「更新 SKU：淨係改 RRP」「改追蹤政策連同 reason」 | 「下游可取得」由 `itemLookupService.test.js` 佐證 |
| AC-005 | `itemHighRisk.integration.test.js`:「刪除 Item／SKU：非草稿狀態：409」 | Phase 1 冇庫存／交易表，以「非 Draft 拒絕刪除」近似「已被引用」（design_spec §8.4 已記錄嘅範圍決定） |
| AC-006 | `itemHighRisk.integration.test.js`:「刪除 Item／SKU：Draft 狀態，成功刪除」 | |
| AC-007 | `itemRead.integration.test.js`:「GET /items：q 搜名稱及 SKU Code／名稱／條碼」「GET /skus：exact／prefix／contains 排序」 | |
| AC-008 | `itemRead.integration.test.js`:「GET /items 同 /skus：Archived 預設隱藏」 | |
| AC-009 | `itemValidation.test.js`:「SKU Code／名稱空白：一次過收集埋兩個問題」；`itemCreate.integration.test.js`:「activate:true 但唔完整：422」 | |
| AC-010 | `itemLookupService.test.js`／`itemLookup.integration.test.js`:purchase purpose 對 inactive／discontinued SKU 一律唔 usable | |
| AC-011 | `itemLifecycle.integration.test.js`:「停用 Item：同交易全部轉 inactive」 | |
| AC-012 | `itemLookup.integration.test.js`：findByBarcode 真 JOIN 搵到 SKU；`itemLookupService.test.js`：projection 含完整 UOM／factor | 未見一個測試逐字斷言「1 箱=24 瓶」呢個具體情境，**建議人工驗證**呢個確切數字組合 |
| AC-013 | `itemCreate.integration.test.js`／`itemUpdate.integration.test.js`／`itemLookup.integration.test.js`：條碼全域唯一（建立／更新／DB 三層） | |
| AC-014 | `barcodeValidation.test.js`:「GTIN：check digit 錯誤就拒絕」 | |
| AC-015 | `itemValidation.test.js`:「batch_expiry 必須有正整數 shelf life」 | |
| AC-016 | `itemUpdate.integration.test.js`:「改追蹤政策／Base UOM 冇填 reason：400」 | Phase 1 冇庫存表，「偵測已有交易」近似為「關鍵變更一定要 reason」；**AC 字面上嘅精確語意建議待下游庫存模組落地後補測** |
| AC-017 | `itemImport.integration.test.js`:「有一列 invalid：job 轉 invalid，唔寫入正式資料」 | |
| AC-018 | `itemImport.integration.test.js`:「Confirm：version 唔啱就 409 IMPORT_STATE_CONFLICT」 | 以 job version 樂觀鎖間接防重送；未見逐字模擬「完全相同 request 重送兩次」嘅測試 |
| AC-019 | `itemUpdate.integration.test.js`／`itemBulkStatus.integration.test.js`：冇 `item.mgmt` 一律 403 | 刪除端點（`itemHighRisk`）未見獨立嘅權限拒絕測試，**建議補測或人工驗證** |
| AC-020 | `itemConcurrency.integration.test.js`:「Version race：兩個並行 update 撞同一個 version」 | |
| AC-021 | `itemAuditLogService.test.js`／`itemAudit.integration.test.js`：operator／時間／reason／target／前後值 | |
| AC-022 | `itemValidation.test.js`:「Sellable SKU 必須有大於零嘅建議售價」 | |
| AC-023 | 未找到專門測試 | RRP 逐 SKU 儲存、結構上天然獨立，但冇一個測試直接斷言「兩個唔同 SKU 嘅 RRP 互不覆蓋」，**建議人工驗證** |
| AC-024 | `itemUpdate.integration.test.js`:「更新 SKU：改 RRP，audit 保存前後值」 | 「既有銷售交易成交價不變」超出模組範圍（冇交易表），**人工驗證／待下游模組補測** |
| AC-025 | `itemCreate.integration.test.js`:「建立並直接 activate」；`itemLifecycle.integration.test.js`:「啟用 Item：帶 skuIds 一齊啟用」 | |
| AC-026 | 未找到專門測試 | 系統本身冇對 SKU Code 強制固定格式（搜尋 `src/modules/item/` 冇 regex 限制），各建立測試用自由格式代碼間接印證，但冇針對性測試，**建議人工驗證** |
| AC-027 | `itemCreate.integration.test.js`:「Standard Item 送兩個 SKU：409 STANDARD_ITEM_SKU_LIMIT」 | |
| AC-028 | `itemRead.integration.test.js`／`itemAudit.integration.test.js`／`itemMedia.integration.test.js`／`itemUpdate.integration.test.js`／`itemCreate.integration.test.js`／`itemBulkStatus.integration.test.js`：`item.view` 讀取允許、寫入一律 403 | |
| AC-029 | `itemValidation.test.js`:「冇條碼嘅 SKU 都可以啟用」；`itemLookup.integration.test.js`:「findByCode」 | |
| AC-030 | `itemLookupService.test.js`：sale purpose 對 discontinued SKU 仍 usable（清貨）；purchase purpose 拒絕 | |
| AC-031 | `itemImport.integration.test.js`:「執行中 SKU Code race：整批 rollback」「有一列 invalid：唔會轉 ready」 | |
| AC-032 | `itemValidation.test.js`:「Base UOM 必須恰好一個，factor 必須係 1」「UOM factor 超出範圍」；`itemCreate.integration.test.js`:「UOM 結構性錯誤」 | 「小數 Base UOM 數量」字面指交易輸入，屬下游模組範圍；本模組負責嘅 UOM 換算整數規則有完整覆蓋 |
| AC-033 | `itemExport.integration.test.js`：固定 HKD／tax_not_applicable；`itemUpdate.integration.test.js`：audit 記錄同一口徑 | 前端 UI 實際渲染「HKD」文字未見斷言，**建議人工驗證畫面顯示** |
| AC-034 | 超出 Item Management 模組範圍 | 效期豁免收貨屬下游採購／收貨模組，本模組只提供 `minReceiptLifeDays` 欄位（已由 `itemValidation.test.js` 驗證欄位本身合法性） |
| AC-035 | `test/performance/itemManagement.performance.test.js`（T35，見上面 T35 實測結果） | |
| AC-036 | `itemImportFileCleanupJob.test.js`：UTC 週年到期清理／未到期唔刪；`itemImportFileCleanup.integration.test.js`：compare-and-set；`itemImport.integration.test.js`：清理後 job summary 仍查得到（410 result download） | 「至少 7 年保留」呢個下限本身冇專門測試強制驗證，**建議人工驗證**（保留期由 `ITEM_DATA_RETENTION_YEARS=7` 常數定義，冇對應嘅到期清理邏輯——即冇任何 job 會在 7 年內主動清除，行為上天然滿足，但冇自動化斷言） |
| AC-037 | `itemLifecycle.integration.test.js`：停用／停產／封存嘅同交易級聯、失敗回滾（version 衝突）、Item 恢復但 SKU 唔自動恢復 | |

**需要人工驗證或標注範圍嘅項目摘要：**

- **超出 Item Management 模組範圍**：AC-034（下游採購／收貨模組未實作）。
- **設計上嘅範圍近似（唔係測試缺口，design_spec 已記錄嘅 Phase 1 決定）**：AC-005、AC-016、AC-024 後半句（Phase 1 冇庫存／交易表）。
- **建議人工驗證**：AC-012（carton/24 倍換算嘅精確情境）、AC-018（真正嘅「同一 confirm request 重送」情境）、AC-019（SKU 刪除端點權限矩陣）、AC-023（同 Item 下兩個 RRP 互不覆蓋）、AC-026（SKU Code 非固定格式接受）、AC-033（前端 UI 實際渲染 HKD 文字）、AC-036（7 年保留下限）。

## 11. 測試執行記錄

| Round | Date | Build / Commit | Environment | Passed | Failed | Blocked | Not Run | Report |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | 2026-09-10 | `f4d6d8d`（`worktree-item-management-t27`，PR #73） | 本機 `erp_dev`（真 MySQL）＋ GitHub Actions CI | server 單元 1206／integration 219／lint clean／T35 performance 4／CI 4 job 全綠 | 0 | 0 | 7 個 AC 標注「建議人工驗證」（見上表） | T34／T35 兩個 Task 段落（`docs/items_management/tasks.md`）；CI run 見 PR #73 checks |
<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal Technical Test Definitions

The canonical suite table and preserved detailed catalogue remain the scenario source. These definitions establish the required v2 test entities; every result remains `PLANNED/NOT_RUN` until executed against an immutable candidate.

## TC-001 — Migration/DB / P0

### Preconditions and data
Fresh and upgrade MySQL; execute legacy MIG-001–MIG-008

### Steps
Execute the detailed source cases referenced by the `TC-001` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
Ordered/idempotent migrations, constraints and permission seeds are correct; upgrade rerun is safe

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
disposable DB, schema/ledger/log evidence

## TC-002 — API/DB/UI / P1

### Preconditions and data
100k-SKU fixture and authorized/unauthorized actors; legacy LIST-001–LIST-010

### Steps
Execute the detailed source cases referenced by the `TC-002` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
Stable search/filter/page/detail/audit behavior; full projections; correct empty/error/403 states

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
fixture teardown; response, SQL, screenshot, console/network evidence

## TC-003 — API/transaction / P0

### Preconditions and data
Standard/Variant fixtures; duplicate/race/failure injection; legacy CREATE-001–CREATE-014

### Steps
Execute the detailed source cases referenced by the `TC-003` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
Atomic, idempotent, authorized creation with valid variants and no orphan/audit gap

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
transaction/DB/audit diff and UI evidence; remove fixtures

## TC-004 — API/concurrency / P0

### Preconditions and data
stale versions, cross-owned children, referenced/unreferenced SKU; legacy EDIT-001–EDIT-009

### Steps
Execute the detailed source cases referenced by the `TC-004` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
Optimistic locking, strong auth, full validation, reference guards and audit atomicity hold

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
DB/audit snapshots and race logs; reset fixtures

## TC-005 — Lifecycle/DB / P0

### Preconditions and data
all statuses, child mixes, references and races; legacy LIFE-001–LIFE-013

### Steps
Execute the detailed source cases referenced by the `TC-005` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
Legal transitions are atomic; destructive actions preserve references/history and stable public errors

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
DB/audit/reference evidence and cleanup

## TC-006 — Validation/DB/integration / P0

### Preconditions and data
UOM/barcode boundaries, duplicate and concurrency fixtures; legacy UOM-001–UOM-012

### Steps
Execute the detailed source cases referenced by the `TC-006` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
Integer conversion, ownership, primary/default rules, GTIN normalization and lookup are correct

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
SQL/API/lookup evidence; remove fixtures

## TC-007 — Domain/API / P0

### Preconditions and data
price/tracking/catalog/attribute boundaries; legacy PRICE/TRACK/CAT cases

### Steps
Execute the detailed source cases referenced by the `TC-007` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
HKD precision, tracking invariants, typed attributes and Catalog guards behave consistently

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
request/DB/audit evidence; reset Catalog fixtures

## TC-008 — File/security/integration / P0

### Preconditions and data
valid/invalid files, traversal/symlink, auth and failure injection; legacy MEDIA-001–MEDIA-012

### Steps
Execute the detailed source cases referenced by the `TC-008` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
allowlist/signature/size/path/ownership/primary/cleanup controls hold without orphan state

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
redacted file inventory/hash, API/DB/audit; purge test files

## TC-009 — Batch/file/transaction / P0

### Preconditions and data
mixed/duplicate/10k CSV, retry/lease/failure fixtures; legacy IMP-001–IMP-017

### Steps
Execute the detailed source cases referenced by the `TC-009` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
preflight is non-mutating; execution is all-or-nothing/idempotent; exports are safe; files retain/purge correctly

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
file hashes, job/row/item/SKU/audit DB evidence; purge fixtures

## TC-010 — Security/audit / P0

### Preconditions and data
actor revocation, role matrix, IDOR/input/audit failure; legacy AUD-001–AUD-006 and AUTH-001–AUTH-010

### Steps
Execute the detailed source cases referenced by the `TC-010` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
every critical change is authorized and transactionally auditable; logs redact secrets and audit is immutable/queryable

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
auth matrix, request/DB/audit/log evidence; revoke fixtures

## TC-011 — Browser/accessibility / P1

### Preconditions and data
running application and role fixtures; legacy UI-001–UI-008

### Steps
Execute the detailed source cases referenced by the `TC-011` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
happy/negative flows, dirty-state handling, keyboard/focus, refresh/navigation and error states work with no relevant console/network failures

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
Playwright screenshots/trace; remove fixtures

## TC-012 — Performance/observability / P1

### Preconditions and data
representative 100k-SKU/10k-row workload; legacy OPS-001–OPS-006/OPS-009

### Steps
Execute the detailed source cases referenced by the `TC-012` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
p95/error/resource thresholds and alerts/log correlation meet defined limits

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
performance report, metrics/log evidence, fixture cleanup

## TC-013 — API/DB regression / P0

### Preconditions and data
persist item_attribute_values and item_sku_attribute_values, then read detail/API/UI

### Steps
Execute the detailed source cases referenced by the `TC-013` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
typed values and canonical variant combination are returned; no empty-array placeholder or cross-owner disclosure

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
response/schema/SQL/Playwright evidence; cleanup

## TC-014 — API/DB negative / P0

### Preconditions and data
referenced and unreferenced Brand/UOM with expected versions

### Steps
Execute the detailed source cases referenced by the `TC-014` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
referenced delete returns `CATALOG_IN_USE` and no audit/data mutation; unreferenced delete succeeds with audit

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
true-MySQL response/DB/audit diff; cleanup

## TC-015 — Batch/transaction/audit / P0

### Preconditions and data
create/update import, reason, injected row/audit/commit failures and retry

### Steps
Execute the detailed source cases referenced by the `TC-015` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
each aggregate change uses the same validation and has per-item audit in the same transaction; failure leaves neither change nor audit

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
job/item/SKU/audit before/after and transaction logs; cleanup

## TC-016 — Backup/restore/DR / P0

### Preconditions and data
approved staging-like environment, backups, media/import storage and timestamped writes

### Steps
Execute the detailed source cases referenced by the `TC-016` row using the declared suite and controlled failure/negative paths; record request, persisted state, audit and browser evidence where applicable.

### Expected result
restore returns usable service in <=4h and no more than 15 minutes of committed data is lost; integrity/reconciliation passes

### Acceptance criteria
Every required source case passes with the expected observable and persisted result; missing tools, skipped mandatory cases, stale reports or baseline drift block acceptance.

### Cleanup
timed runbook, backup IDs, RPO calculation, smoke/reconciliation; securely remove exercise data

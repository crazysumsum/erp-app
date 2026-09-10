# Invoicing & Accounts Receivable Aligned Requirement Specification

## 1. Normative Baseline

本文件是software-engineering-harness的追溯入口；完整且具業務權威的Requirement仍是同目錄[業務需求書](requirement.md)。本文件不複製或改寫已確認內容，而是：

- 將既有分組Requirement ID一對一映射為harness canonical ID。
- 明確記錄需求來源、未決議題及設計不得降低的邊界。
- 供Design、Task、Technical Test、UAT及機械validator引用。

如本文件與`requirement.md`語意不一致，以`requirement.md`及使用者已確認決策為準；canonical ID不得被理解為新需求。

## 2. Purpose and Business Outcome

把所有合資格`SHIPPED` Shipment準確、完整且不重複地轉為Invoice及AR，並提供Credit Note、Receipt、Allocation、Outstanding、Aging、Statement、Credit Exposure、Opening AR及長期歸檔閉環。目標用戶是單一公司的中小型批發企業，正常規模約每日10,000張Sales Order、50名並發使用者及24個月Active資料。

## 3. Scope

### 3.1 In Scope

以`requirement.md`§2.1為準，包括Settings、Invoiceable Workbench、Shipment-based／Manual／Opening Invoice、Batch、Credit、Receipt、AR Inquiry、Exposure、Documents、Export、Audit及Archive。

### 3.2 Out of Scope

以`requirement.md`§2.2為準；Tax、GL、FX、Bank Reconciliation、Payment Gateway、Refund、Return、Debit Note、自動Email、Collection及多公司不在本期。

## 4. Canonical Functional Requirement Map

| Canonical IDs | Existing IDs | Requirement source |
| --- | --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010 | FR-SET-001～010 | `requirement.md` §8.1 |
| FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021 | FR-WB-001～011 | §8.2 |
| FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038 | FR-INV-001～017 | §8.3 |
| FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045 | FR-MAN-001～007 | §8.4 |
| FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058 | FR-BATCH-001～013 | §8.5 |
| FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071 | FR-CN-001～013 | §8.6 |
| FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085 | FR-REC-001～014 | §8.7 |
| FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098 | FR-AR-001～013 | §8.8 |
| FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107 | FR-EXP-001～009 | §8.9 |
| FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119 | FR-OPEN-001～012 | §8.10 |
| FR-120, FR-121, FR-122, FR-123, FR-124, FR-125 | FR-DOC-001～006 | §8.11 |
| FR-126, FR-127, FR-128, FR-129 | FR-EXPORT-001～004 | §8.11 |
| FR-130, FR-131, FR-132 | FR-AUDIT-001～003 | §8.11 |
| FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140, FR-141, FR-142, FR-143 | FR-ARC-001～011 | §8.11 |

每個canonical ID依表格位置與Existing ID一對一對應，例如`FR-001 = FR-SET-001`、`FR-011 = FR-WB-001`、`FR-143 = FR-ARC-011`。Priority、Actor、Precondition、main／alternate behavior及Acceptance Criteria均完整繼承，不得只採用章節摘要。

## 5. Non-Functional Requirements

| Canonical | Existing | Requirement／Measure | Provenance |
| --- | --- | --- | --- |
| NFR-001 | NFR-PERF-001 | 每日10,000張、24個月730萬Shipment-based候選及相關資料的容量基線。 | EXISTING |
| NFR-002 | NFR-PERF-002 | Active常用列表及精確查詢p95≤2秒。 | EXISTING |
| NFR-003 | NFR-PERF-003 | ≤100-Line互動保存／確認p95≤3秒；更大工作3秒內返回可追蹤狀態。 | EXISTING |
| NFR-004 | NFR-PERF-004 | 10,000 Shipment標準批量開票在30分鐘內完成。 | EXISTING |
| NFR-005 | NFR-PERF-005 | 50名互動使用者與批量、匯出、Exposure及Archive並行。 | EXISTING |
| NFR-006 | NFR-PERF-006 | PDF／A4預覽p95≤3秒；大型產出背景化。 | EXISTING |
| NFR-007 | NFR-PERF-007 | Archive精確單號≤3秒、Customer＋366日≤5秒。 | EXISTING |
| NFR-008 | NFR-PERF-008 | 大型Statement、Export、Import及Archive使用有界背景處理，不長鎖或全載入記憶體。 | EXISTING |
| NFR-009 | NFR-PERF-009 | 超過24個月未收Invoice仍留Active的分佈必須納入索引及測試資料。 | EXISTING |
| NFR-010 | NFR-DR-001 | Production RTO≤4小時、RPO≤15分鐘，須以隔離Restore演練及完整性對賬證明。 | NEW — USER APPROVED 2026-09-10 |

Availability、integrity、accessibility、retention及operability的Must要求已分布於`FR-053～058`、`FR-120～143`及`SEC-001～015`，下游不得因未以NFR前綴出現而省略。

## 6. Security Requirements

`SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015`一對一沿用`requirement.md` §11。其核心包括後端最小權限、IDOR防護、銀行資料加密／遮蔽、重新認證、私有檔案、輸出注入、審計、服務身份與安全重送。

## 7. Assumptions

- 單一公司；Currency及Payment Term使用共用目錄，不在AR複製主檔。
- 金額採Currency minor unit整數；日期採業務時區`DATE`，事件時間採epoch milliseconds。
- Sales、Fulfillment、Customer及Item Provider在對應Phase前交付正式版本；不存在或結果UNKNOWN時fail closed。
- RTO≤4小時及RPO≤15分鐘已獲使用者批准，成為正式production target。

## 8. Open Issues

| ID | Issue | Owner | Required by | Status |
| --- | --- | --- | --- | --- |
| OI-001 | RTO≤4小時、RPO≤15分鐘。 | Product Owner／Operations | Resolved 2026-09-10 | APPROVED |
| OI-002 | 財務記錄≥7年；Import檔90日；Export結果及可重建PDF檔7日；legal hold／較長法規優先。 | Finance／Legal／Security | Resolved 2026-09-10 | APPROVED |
| OI-003 | Sales／Fulfillment文件及Provider合併main後，重驗版本、payload、錯誤碼及Archive contract。 | Sales／Fulfillment owners | PHASE-001 entry | IMPLEMENTATION DEPENDENCY |

## 9. Dependencies and Constraints

- 依賴User Management的fresh permission、重新認證及service identity。
- 依賴Customer purpose-based Billing Address／Contact、Currency、Payment Term及Credit Hold projection。
- 依賴Sales未開票承諾及Exposure consumer；依賴Fulfillment的Shipment source、reversal guard及archive source index。
- UI／UX必須按`docs/frontend-design.md`，並達WCAG 2.1 AA、375～1440px及鍵盤操作。
- Migration序號只在實作時依最新main分配；本文件不預留固定序號。

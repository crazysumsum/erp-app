# Invoicing & Accounts Receivable Standards Gap Analysis

## 1. Gap Summary

| Severity | Open | Resolved by this package | Implementation dependency |
| --- | ---: | ---: | ---: |
| CRITICAL | 0 | 0 | 0 |
| HIGH | 0 | 6 | 3 |
| MEDIUM | 0 | 4 | 0 |
| LOW | 0 | 0 | 0 |

「Implementation dependency」不是本輪文件缺陷；必須在對應Phase開始前由正式程式及測試證據關閉。

### GAP-RQ-001 — 缺少Harness Canonical Requirement ID

- Area: REQUIREMENT
- Severity: MEDIUM
- Type: DOCUMENTATION_GAP
- Evidence: 現有需求使用`FR-WB-001`等分組ID；機械validator只識別`FR-001`、`NFR-001`及`SEC-001`格式。
- Impact: 無法機械核對Requirement → Design → Task → Test／UAT鏈。
- Proposed action: 保留原ID並在`01_requirement_spec.md`建立一對一canonical alias。
- Human clarification required: NO
- Status: RESOLVED

### GAP-RQ-002 — RTO／RPO未量化

- Area: REQUIREMENT
- Severity: MEDIUM
- Type: UNKNOWN
- Evidence: 已定義Backup／Restore演練及資料完整性，但沒有獲業務確認的RTO／RPO數值。
- Impact: 無法對災難復原演練作最終Pass／Fail判定。
- Proposed action: 採`RTO ≤ 4小時、RPO ≤ 15分鐘`，並以隔離環境演練量度。
- Human clarification required: NO — 使用者於2026-09-10確認接受。
- Status: RESOLVED

### GAP-RQ-003 — 保留政策尚待法務／業務簽核

- Area: REQUIREMENT
- Severity: MEDIUM
- Type: UNKNOWN
- Evidence: Requirement指定財務記錄及Audit至少7年，短期檔案期限仍只列為Gate。
- Impact: 不能把法定保留及清除工作標記為production-ready。
- Proposed action: 財務記錄至少7年；Import source／result 90日，Export result及可重建PDF 7日；legal hold或較長法規優先。
- Human clarification required: NO — 使用者於2026-09-10確認接受。
- Status: RESOLVED

### GAP-DES-001 — 缺少可執行系統設計

- Area: DESIGN
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: 目錄只有BRD，沒有前端、後端、API、DB、交易、並發、Archive及Recovery設計。
- Impact: 開發者可能各自推斷金額守恆、來源防重及跨模組交易，造成財務不一致。
- Proposed action: 產出`design_spec.md`及`03_system_design_spec.md`入口文件。
- Human clarification required: NO
- Status: RESOLVED

### GAP-DES-002 — Sales／Fulfillment Provider只存在於未合併文件

- Area: DESIGN
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: main沒有Sales／Fulfillment模組文件或正式Provider實作；相關契約只在獨立worktree。
- Impact: Shipment防重、Reversal guard、Exposure轉換及跨Archive追溯不能安全開發。
- Proposed action: 在設計中固定consumer contract；PHASE-001把Provider readiness列為硬性Entry Gate，UNKNOWN fail closed。
- Human clarification required: NO
- Status: OPEN — implementation dependency

### GAP-DES-003 — Customer／Currency共用Provider未落地

- Area: DESIGN
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: Customer有設計文件但main未見正式模組Provider；Currency／Payment Term共用目錄亦未完成。
- Impact: Draft及確認時無法可靠重驗Customer ownership、Billing目的、Currency precision及Due Date規則。
- Proposed action: 定義版本化lookup／validation contract；Provider不存在時Phase 1 BLOCKED，不在AR複製上游主檔。
- Human clarification required: NO
- Status: OPEN — implementation dependency

### GAP-DES-004 — 財務交易Recovery及commit-unknown模型缺失

- Area: DESIGN
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: Requirement要求安全重送及結果查回，但沒有durable operation、lease、payload hash及恢復演算法。
- Impact: timeout或連線中斷可能重複取號、重複開票、重複貸項或錯誤核銷。
- Proposed action: 設計兩階段durable intent、單交易commit、operation outcome lookup及recovery worker。
- Human clarification required: NO
- Status: RESOLVED

### GAP-DES-005 — 金額、來源及Exposure守恆未落成資料約束

- Area: DESIGN
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: BRD有規則但沒有整數minor unit、remainder ownership、unique source、CAS、lock order及reconciliation schema。
- Impact: 並發Credit／Allocation或分批Shipment可能超額、負數或雙計。
- Proposed action: 在DB、service算法、transaction與真MySQL測試中建立可證明不變式。
- Human clarification required: NO
- Status: RESOLVED

### GAP-TASK-001 — 缺少Phase／Task執行計劃

- Area: TASK
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: 沒有開發拆解、PR邊界、依賴及Gate。
- Impact: 易在Provider／Schema未ready前開發UI或把高風險交易塞入單一PR。
- Proposed action: 產出4個Phase及atomic tasks，每Phase可獨立測試及建立PR。
- Human clarification required: NO
- Status: RESOLVED

### GAP-TEST-001 — 缺少技術測試規格

- Area: TECH_TEST
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: 只有BRD驗收準則，沒有Unit、API、真MySQL、Concurrency、Recovery、Security、Performance及Restore案例。
- Impact: 高風險不變式無客觀工程證據。
- Proposed action: 產出`05_technical_test_spec.md`。
- Human clarification required: NO
- Status: RESOLVED

### GAP-UAT-001 — 缺少用戶驗收規格

- Area: UAT
- Severity: MEDIUM
- Type: DOCUMENTATION_GAP
- Evidence: 70項AC尚未組織成Finance／AR使用者可執行流程。
- Impact: 業務無一致簽核基線。
- Proposed action: 產出`06_uat_test_spec.md`，所有案例初始`NOT_RUN`且證據為`—`。
- Human clarification required: NO
- Status: RESOLVED

### GAP-TRC-001 — 缺少端到端追溯

- Area: TRACEABILITY
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: 現有摘要只連接舊ID與AC，沒有DES／PHASE／TASK／TC／UAT。
- Impact: 不能證明所有需求均被設計、計劃及驗證。
- Proposed action: 產出`07_traceability_matrix.md`並執行harness validator。
- Human clarification required: NO
- Status: RESOLVED

### GAP-IMP-001 — 模組程式尚未實作

- Area: TASK
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: main不存在Invoicing／AR server module、client pages或Migration。
- Impact: 所有業務能力均未可執行。
- Proposed action: 本輪只形成可執行Tasks；後續以FULL_LIFECYCLE或逐Phase實作。
- Human clarification required: NO
- Status: OPEN — implementation dependency

## 2. Scope Integrity

審查未發現需求把Sales Tax、GL、FX、Bank Reconciliation、Refund、Customer Return、自動Email或複雜審批暗中帶入。設計只會為明確的未來Provider留下邊界，不建立本期功能。

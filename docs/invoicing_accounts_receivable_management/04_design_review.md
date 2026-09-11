# Invoicing & Accounts Receivable Independent Design Review

## Gate Summary

- Gate status: **READY_FOR_PLANNING**
- CRITICAL open: 0
- HIGH open: 0
- MEDIUM open: 0
- Review lenses: Solution Architecture、Security、Database、SRE、Senior Engineering及QA。

### Architecture Summary

設計沿用現有Node.js／Vue modular monolith及單MySQL transaction，以durable operation、document/source unique、append-only ledger、transactional balance projection及Permanent Source Index保證財務一致。大型Batch、Import、Export、PDF及Archive使用有lease的背景Job；上游provider UNKNOWN一律fail closed。

### Key Decisions

- Shipment完整開票，以Claim＋Registry雙層防重。
- Invoice／Credit／Receipt使用Phase A durable intent及Phase B單transaction。
- Money為decimal string／`DECIMAL(19,4)`，不用JavaScript float。
- Ledger保存As-of歷史，root balances只作同transaction projection。
- 固定跨模組lock order及domain／framework雙層idempotency。
- Finance aggregate獨立Archive，永久索引保持跨tier及跨模組追溯。

## Findings

### DR-001 — Sequence複合主鍵及Prefix回切語意不完整

- Severity: HIGH
- Related requirements: FR-005、FR-006、FR-053、FR-064、FR-078
- Related design items: DES-006
- Evidence: 初稿同時把兩欄及`generation`稱為composite PK，未說明改回曾用prefix時如何避免號碼重用。
- Impact: 實作者可能建立錯誤PK或在prefix回切時由1重發正式號碼。
- Recommendation: 固定PK `(document_type,business_year,generation)`；舊prefix復用原generation／next value；Permanent Index作全域unique。
- Disposition: RESOLVED — 已修訂§6.2。

### DR-002 — Active Claim唯一約束缺少可執行MySQL表示

- Severity: HIGH
- Related requirements: FR-018～FR-020
- Related design items: DES-004
- Evidence: 初稿只寫`UNIQUE(shipment_id,active_scope)`，沒有active scope欄位算法。
- Impact: MySQL NULL／歷史列語意可能令雙人同時取得Claim或阻止正常歷史保留。
- Recommendation: generated active key只在ACTIVE時返回Shipment ID，其他狀態NULL，並建唯一索引。
- Disposition: RESOLVED — 已修訂§6.4。

### DR-003 — Receipt Reversal未明示撤銷未核銷餘額

- Severity: HIGH
- Related requirements: FR-080～FR-084
- Related design items: DES-007、DES-012
- Evidence: 初稿只明示反向active allocations，未明示Receipt尚未使用的available amount不能繼續存在。
- Impact: 已沖銷Receipt仍可能被核銷，造成虛假可用收款及Exposure低估。
- Recommendation: Reversal transaction同時反向allocations、移除unallocated effect並令allocated／available均為0。
- Disposition: RESOLVED — 已修訂§6.6。

### DR-004 — Customer Statement跨Active／Archive讀取邊界不明

- Severity: HIGH
- Related requirements: FR-091～FR-098、FR-133～FR-143
- Related design items: DES-013、DES-018
- Evidence: 初稿允許document-level archive，卻未定義Statement在同Customer尚有Active資料時如何取得已archive ledger events。
- Impact: 長期Statement可能漏交易，或日常查詢無界掃描兩個tier。
- Recommendation: 用completed cutoff及query range route；需要時明確`UNION ALL`且以manifest／PK保證單tier唯一，current view只查Active。
- Disposition: RESOLVED — 已修訂§6.10。

### DR-005 — AR Close Date倒退行為未鎖定

- Severity: MEDIUM
- Related requirements: FR-007、FR-008
- Related design items: DES-003、DES-017
- Evidence: Requirement說向前推進，初稿只描述更新前open matter檢查。
- Impact: 一般更新可能重新打開歷史期，允許backdated effect。
- Recommendation: 一般API只允許單調向前；修復需獨立support runbook與批准。
- Disposition: RESOLVED — 已修訂§9.3。

### DR-006 — 初稿缺少已批准RTO／RPO

- Severity: MEDIUM
- Related requirements: NFR-009、OI-001
- Related design items: DES-025
- Evidence: 初版Requirement要求restore但未給目標；review時提出RTO≤4h／RPO≤15m。
- Impact: 未批准時不能作最終production承諾；現已消除該不確定性。
- Recommendation: Product Owner／Operations在Release Gate批准或替換，並按結果更新TC及runbook。
- Disposition: RESOLVED — 使用者於2026-09-10批准RTO≤4h／RPO≤15m。

### DR-007 — 初稿短期檔案期限未量化

- Severity: MEDIUM
- Related requirements: FR-119、FR-128、FR-141～FR-143、SEC-007～SEC-008、OI-002
- Related design items: DES-016、DES-018
- Evidence: 至少7年是原業務基線，但初稿未量化Import／Export／可重建PDF檔案期限。
- Impact: 未批准時Purge Job不可在production刪檔；現已轉為可測量門檻。
- Recommendation: 財務記錄≥7年；Import source/result 90日；Export result及可重建PDF 7日；legal hold／較長法規優先。
- Disposition: RESOLVED — 使用者於2026-09-10批准。

### DR-008 — Provider契約並非main上的可用實作

- Severity: HIGH
- Related requirements: FR-011、FR-052、FR-071、FR-099～FR-107
- Related design items: DES-020
- Evidence: Sales／Fulfillment文件只在另一worktree，Customer亦未見正式Provider實作。
- Impact: 無法安全進入Invoice Phase業務開放。
- Recommendation: PHASE-001明確BLOCKED至正式provider版本、owner及consumer contract test存在；禁止production fake。
- Disposition: RESOLVED AS PLANNING GATE — implementation dependency保留，沒有用設計繞過。

### DR-009 — 設計複雜度是否超過中小企需要

- Severity: LOW
- Related requirements: FR-046～FR-058、FR-133～FR-143、NFR-003～NFR-009
- Related design items: DES-005、DES-007、DES-018～DES-019
- Evidence: Durable operation、ledger及archive增加表與worker數。
- Impact: 開發成本較單純CRUD高。
- Recommendation: 保留，因每日10k SO、財務不可重複及7年As-of是已確認實際風險；不再加入event bus、microservice、partition或GL。
- Disposition: ACCEPTED_RISK — 最小可靠架構。

## Security Review Summary

後端fresh permission、composite ownership、IDOR 404、銀行AES-GCM／mask、private owner-safe files、structured redaction、CSV/PDF neutralization、service identity及payload hash均有設計與測試入口。沒有依賴前端授權、沒有公開Archive mutation，未發現open HIGH security finding。

## Database and Concurrency Review Summary

核心不變式具unique／FK／append-only trigger、transactional projection、固定lock order及真MySQL測試要求。序號、Claim及Receipt Reversal缺口已修正。Balance cache若與ledger不符只由Reconciliation報警及forward repair，不允許人工直接改表。

## Human Decisions Required

沒有未決人工作業設計選擇。OI-001及OI-002已於2026-09-10批准；Production Release仍須以TC-092及TC-099～100的實際執行證據證明。任何實作Phase只有在其Entry Criteria滿足後才可由PLANNED轉IN_PROGRESS。

## Gate Decision

**READY_FOR_PLANNING。** 所有CRITICAL／HIGH設計發現已處理，營運參數已批准；上游Provider仍屬明示的實作依賴，不被錯誤標記為已完成。

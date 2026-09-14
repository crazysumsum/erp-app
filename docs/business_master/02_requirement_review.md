# Business Master Requirement Review

## Review result

狀態：`READY_FOR_SYSTEM_DESIGN`。需求已涵蓋 owner、管理者、consumer、資料生命週期、日期算法、
權限、audit、併發、停用影響、效能、復原、無障礙及相容性。沒有未解的 CRITICAL/HIGH requirement
ambiguity；design/plan baseline 的人工作品批准仍待完成。

## Confirmed human decisions

| ID | 決定 | 影響 | 來源 |
| --- | --- | --- | --- |
| HD-001 | `OUTPUT_DIR=docs/business_master/`、模式 DESIGN_AND_PLAN | 文件與 mode boundary | 2026-09-11 使用者「同意」 |
| HD-002 | Currency／Payment Term 均有完整管理 UI/API | scope、actor、API/UI | 2026-09-11 使用者「同意」 |
| HD-003 | Payment Term 提供 deterministic Due Date 或 MANUAL | public provider、AR | 2026-09-11 使用者「是」 |
| HD-004 | Type 為 IMMEDIATE／NET_DAYS／END_OF_MONTH／MANUAL | data semantics | 2026-09-11 使用者「同意」 |
| HD-005 | Currency 僅 ISO 4217；code immutable；production 只 seed HKD | schema、validation、migration | 2026-09-11 使用者「同意」 |
| HD-006 | 權限為 business_master.view／mgmt；consumer 用自身權限 | authorization boundary | 2026-09-11 使用者「是」 |
| HD-007 | 可停用既有引用；保留歷史、阻止新用；不永久刪除 | lifecycle、impact guard | 2026-09-11 使用者「是」 |
| HD-008 | 不 seed production Payment Term | deployment/data ownership | 2026-09-11 使用者「是」 |
| HD-009 | 確認完整 intent（含 out-of-scope） | requirement baseline | 2026-09-11 使用者「是」 |
| HD-010 | Currency decimalPlaces 與 Payment Term calculationType/dueDays 的修改，採與停用相同的 impact、reason 與明確確認流程 | semantic-change guard | 2026-09-11 使用者「是」 |

## Gaps and dispositions

### GAP-RQ-001 — Business Master owner 分散
- Area: REQUIREMENT
- Severity: CRITICAL
- Type: DOCUMENTATION_GAP
- Evidence: Customer 曾建立 foundation tables；Supplier 已明確改為 consumer。
- Impact: 多個 migration/write API 可令 Currency／Payment Term 漂移。
- Proposed action: Business Master sole owner；其他模組只讀／驗證／引用。
- Human clarification required: YES
- Status: RESOLVED by HD-002/HD-009

### GAP-RQ-002 — Payment Term 計算語意矛盾
- Area: REQUIREMENT
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: Supplier 的 custom label 與 AR deterministic Due Date 要求不一致。
- Impact: 同一條款可得不同到期日，破壞 invoice snapshot/replay。
- Proposed action: 固定四種算法；MANUAL 明確不回 dueDate。
- Human clarification required: YES
- Status: RESOLVED by HD-003/HD-004

### GAP-RQ-003 — 停用可能破壞現行 defaults
- Area: REQUIREMENT
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: consumer 要保留 inactive history，但新交易只可用 active。
- Impact: 停用後 Customer/Supplier 預設需要更換，且 required consumer outage 會令影響未知。
- Proposed action: registry-based impact preview、token/version confirmation、unknown fail closed。
- Human clarification required: YES
- Status: RESOLVED by HD-007

### GAP-RQ-004 — 正式 seed 未獲業務批准
- Area: REQUIREMENT
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: 舊文件提到 NET30/60/90 等例子，但不是 production authority。
- Impact: 範例值可能被錯當正式商業條款。
- Proposed action: 只 seed HKD；Payment Term 由 owner 建立。
- Human clarification required: YES
- Status: RESOLVED by HD-005/HD-008

### GAP-RQ-005 — Baseline-bound design/plan approval 尚不存在
- Area: TRACEABILITY
- Severity: HIGH
- Type: UNKNOWN
- Evidence: 人類確認發生於文件與 hash 產生之前。
- Impact: 不可把 intent confirmation 誤稱為 final design/plan approval。
- Proposed action: 完成 design、self-review、traceability 與 PR 後，由 Product Owner 對 exact hashes 批准。
- Human clarification required: YES
- Status: OPEN

### GAP-RQ-006 — 一般 update 可繞過高語意影響欄位確認
- Area: REQUIREMENT/SECURITY
- Severity: HIGH
- Type: DESIGN_GAP
- Evidence: 初稿把 decimalPlaces、calculationType、dueDays 放在一般 PATCH。
- Impact: 已有交易或 consumer 可能在沒有 impact preview 的情況下改變新交易語意。
- Proposed action: 一般 PATCH 只允許展示欄位；精度與規則變更改為高影響 command。
- Human clarification required: YES
- Status: RESOLVED by HD-010

## Missing scenarios added

- Unicode/case duplicate、unknown field、非法 precision/type/date boundaries。
- lost update、double-submit、idempotency payload reuse、summary stale、consumer outage。
- Active selector 與 Inactive history 的 purpose 分離；caller transaction 內 revalidation。
- half-applied/idempotent migration、schema compatibility、HKD readiness、backup/restore。
- permission revocation、error redaction、XSS/SQL injection、projection minimization。
- loading/empty/error/409/403、keyboard、responsive、console/network Playwright evidence。

## Readiness

需求可驅動系統設計；GAP-RQ-005 不改變 requirement semantics，但阻止 `PLAN_READY` 與 implementation
開始，直至實際人類審閱完成後的 exact design/plan hashes。

# Invoicing & Accounts Receivable Existing Artifact Inventory

## 1. Review Context

| Item | Value |
| --- | --- |
| Mode | `REVIEW_AND_ALIGN` |
| Output directory | `docs/invoicing_accounts_receivable_management/` |
| Review baseline | `origin/main` at `3bc4277` on 2026-09-10 |
| Feature scope | Shipment-to-Invoice、Credit Note、Receipt、Allocation、AR inquiry、Credit Exposure、Opening AR、Export及Archive |
| Source-code change allowed | No；本輪只產出及對齊文件 |

## 2. Artifact Inventory

| Source | Apparent Type | Quality | Authority / Confidence | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `docs/invoicing_accounts_receivable_management/requirement.md` | REQUIREMENT | GOOD | 已合併`main`；HIGH | PRESERVE + ALIGN | 143項FR、52項BR、15項SEC、9項NFR及70項AC；既有分組ID保持不變。 |
| `docs/frontend-design.md` | DESIGN STANDARD | GOOD | 已合併`main`；HIGH | PRESERVE + APPLY | 所有AR頁面、響應式、可達性及共用元件的規範來源。 |
| `docs/customer_management/requirement.md`、`design_spec.md` | UPSTREAM DESIGN | GOOD | 已合併`main`；HIGH | VERIFY + REUSE CONTRACT | Customer、Billing Address／Contact、Currency、Payment Term、Credit Hold與銀行資料邊界。 |
| `docs/items_management/requirement.md`、`design_spec.md` | UPSTREAM DESIGN | GOOD | 已合併`main`；HIGH | VERIFY + REUSE CONTRACT | SKU、UOM及Item快照來源。 |
| `docs/inventory_management/requirement.md`、`design_spec.md` | ADJACENT DESIGN | GOOD | 已合併`main`；HIGH | VERIFY | 證明Credit／Receipt不得產生Inventory Movement；只讀取Shipment結果。 |
| `docs/purchasing_receiving_management/requirement.md`、`design_spec.md` | ADJACENT DESIGN | GOOD | 已合併`main`；MEDIUM | VERIFY | 文件序號、批量Job、Active／Archive及財務邊界的參考模式。 |
| External worktree `docs/sales_order_management/*` | UPSTREAM REQUIREMENT / DESIGN / TASK / UAT | GOOD | 未在`origin/main`；MEDIUM | VERIFY + MARK DEPENDENCY | Sales承諾、Credit Exposure consumer及Archive契約；實作前必須以最新main正式版本重驗。 |
| External worktree `docs/fulfillment_shipping_management/*` | UPSTREAM REQUIREMENT / DESIGN / TASK / UAT | GOOD | 未在`origin/main`；MEDIUM | VERIFY + MARK DEPENDENCY | Shipment、Reversal guard、Source mapping及Archive participant契約；不可當成已部署Provider。 |
| `server/src/framework/*`、`server/src/infrastructure/*` | IMPLEMENTATION STANDARD | GOOD | 現行程式；HIGH | PRESERVE + REUSE | ES Modules、Handler discovery、`BaseRequestHandler`、AJV、MySQL transaction、service container、idempotency、scheduler、log。 |
| `client/src/*` | IMPLEMENTATION STANDARD | GOOD | 現行程式；HIGH | PRESERVE + REUSE | Vue 3、Quasar、Pinia、page/service discovery及共用UI元件。 |
| `server/src/modules/invoicing*`、`client/src/pages/*Invoice*` | IMPLEMENTATION | MISSING | 檔案不存在；HIGH | GENERATE TASKS ONLY | 本模式不寫程式；缺口轉為Phase／Task／TC。 |
| `design_spec.md`、`03_system_design_spec.md` | DESIGN | GOOD | 本輪產出；待Human Design Gate | GENERATED | 詳細前後端、API、DB、transaction、recovery、security、archive及test design。 |
| `tasks.md`、`05_development_tasks.md` | TASK | GOOD | 本輪產出；PLANNED | GENERATED | 4 Phases、32 Tasks、每Phase獨立PR及測試Gate。 |
| `06_technical_test_cases.md` | TECH_TEST | GOOD | 本輪產出；PLANNED | GENERATED | 100項technical cases；沒有執行。 |
| `07_uat_test_cases.md` | UAT | GOOD | 本輪產出；NOT_RUN | GENERATED | 90項business UAT及Phase sign-off；沒有執行。 |
| `08_traceability_matrix.md`、`09_traceability_validation.md` | TRACEABILITY | GOOD | validator PASS | GENERATED | 168項需求Design／Task／Technical coverage 100%；全部FR有UAT。 |

## 3. Authority Order

發生矛盾時依序採用：

1. 已由使用者確認且合併main的`requirement.md`業務決策。
2. main上的共用架構、`docs/frontend-design.md`及已合併上下游規格。
3. Sales／Fulfillment獨立worktree文件，只作預期契約證據；實作前須Provider readiness gate。
4. 本輪新增的設計假設；所有未經使用者確認者必須標示`ASSUMED`或`DECISION REQUIRED`。

## 4. Preservation Rules

- 不重新編排或刪除既有`FR-*`、`BR-*`、`SEC-*`、`NFR-*`、`AC-*`識別碼。
- 新增`FR-001`等canonical ID只作harness追溯別名，不改變既有需求語意。
- 不以Production fake、Stub table或AR內重寫Sales／Fulfillment規則來填補上游未實作契約。
- 本輪不修改應用程式、Migration、CI或部署設定。

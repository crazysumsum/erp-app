# Sales Order Management Aligned System Design — Canonical Entry

## 1. Normative Design Body

The complete 2,386-line legacy architecture is embedded in section 6 of this file, with only obsolete self-reference paths normalized to canonical filenames. This canonical entry assigns design IDs, carries the approved DR targets, and records implementation-readiness boundaries without pretending proposed interfaces exist in code.

## 2. Canonical Design Map

| ID | Design item / decision | Normative section | Requirement drivers | Provenance |
| --- | --- | --- | --- | --- |
| DES-001 | Modular monolith; Sales owns its aggregate while User/Customer/Item/Inventory/Fulfillment own their truths. | §2.1–2.2 | FR-001–140, NFR-012 | EXISTING |
| DES-002 | Quotation/SO aggregates, state machines, snapshots, monetary/quantity invariants and monthly numbering. | §3, §4.3–4.13, §7.1–7.3 | FR-001–075 | EXISTING |
| DES-003 | Versioned provider/consumer boundaries with fail-closed missing/UNKNOWN behavior. | §2.4 | FR-002,023–026,043–061,121–140 | EXISTING |
| DES-004 | Durable two-transaction manual confirmation with `CONFIRMING`, operation lease and same-event recovery. | §2.5, §7.4 | FR-042–061, NFR-009 | EXISTING |
| DES-005 | Inventory batch reserve/release in the same MySQL transaction and one global lock order. | §2.4, §2.8, §7.5–7.6 | FR-049–061,062–075 | EXISTING; owner approval pending |
| DES-006 | Warehouse+SKU FIFO backorder allocation with bounded scheduler and safe manual wake. | §2.6, §7.7 | FR-050–061 | EXISTING |
| DES-007 | Three-layer transport/event/external-key idempotency and exact-key routing. | §2.7, §4.7, §4.13 | FR-012–015,048,073,082–095,096–108, SEC-015 | EXISTING |
| DES-008 | Active/Archive relational schema, constraints, indexes, immutable archive and forward-only migration slices. | §4 | FR-109–140, NFR-016, SEC-011 | EXISTING |
| DES-009 | Versioned REST contracts, CAS versions, stable errors, owner-safe projections and 200/202 operation lookup. | §5.1–5.6, §5.10–5.12 | FR-018–075,109–120, SEC-001/002/008/014 | EXISTING |
| DES-010 | Opt-in disk-stream upload, CSV v1 parser/precheck/jobs/results and bounded retention. | §5.7–5.8, §7.8, §12.1 | FR-076–095, NFR-004/008/010, SEC-005–007 | EXISTING; implementation gap |
| DES-011 | Canonical Channel Intake only; authenticated transport and address handoff deferred to Adapter gate. | §2.4, §5.9 | FR-096–108, SEC-003/010/015 | EXISTING |
| DES-012 | Vue page/component/service boundaries, permission-aware navigation, responsive and accessible states. | §2.3, §6 | FR-001–140, NFR-013 | EXISTING |
| DES-013 | Fresh actor/service authorization, minimum data, threat controls and safe output. | §8 | SEC-001–015 | EXISTING; implementation gap |
| DES-014 | Append-only history/audit plus structured logs, metrics, alerts and correlation. | §4.12/4.18, §8, §12.3–12.4 | FR-016,041,060,075,095,118–120,137, NFR-011 | EXISTING |
| DES-015 | Scheduler leases, bounded workers, backpressure, retention and recovery runbooks. | §7.7–7.11, §12.2/12.5 | FR-076–108,121–140, NFR-008–010 | EXISTING |
| DES-016 | Active inquiry, outstanding projections, safe export jobs and exact source routing. | §5.10–5.11, §7.9 | FR-018–041,109–120 | EXISTING |
| DES-017 | Eligibility recheck, atomic aggregate archive, manifest/hash validation, restore and reconciliation. | §3.7, §4.19–4.22, §7.10–7.11, §11.8 | FR-121–140, NFR-016 | EXISTING |
| DES-018 | Configuration validation, deployment order, feature disablement and forward-fix rollback strategy. | §12–13 | NFR-008–012, SEC-006/014 | EXISTING |
| DES-019 | Production-like data generation and measurable query/command/batch capacity gates. | §11.7 | NFR-001–008 | EXISTING; workload input pending |
| DES-020 | Active+Archive+keys+operations backup, isolated restore, reconciliation, RTO <=4h and RPO <=15m. | §11.8 enhanced by this review | NFR-014–016 | NEW/ENHANCED — USER APPROVED target |

## 3. Architecture Boundaries and Failure Model

- Sales code must not directly update Inventory balances, lots or bins.
- Any missing/wrong-version/UNKNOWN provider fails closed; no shadow master or production fake is allowed.
- The planned same-database transaction boundary is a hard assumption until Inventory/DBA approval and real concurrency proof.
- Channel HTTP transport is intentionally absent until authenticated service identity and Fulfillment address delivery are designed.
- Archive failure degrades Archive functions only; Active create/confirm/query remains available.
- No automated archive purge is permitted before legal retention policy is explicitly approved.

## 4. Design Readiness

The design is technically detailed but **CONDITIONAL** because `DR-001`–`DR-005` remain open. It can drive Phase planning, not implementation approval. `DES-020` adds measurable DR acceptance without selecting an unapproved HA product or topology.

## 5. Mechanical Requirement Coverage

Functional coverage: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140.

Cross-cutting coverage: NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-014, NFR-015, NFR-016; SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015.


---

## 6. Embedded Legacy System Design Body

The content below preserves the full legacy source semantics; only obsolete document paths were normalized. The exact original source has SHA-256 aa2b38ebb9db6af62097e7923cd8debbdf30ab2e65ad0b778d157816f9fe9272 and remains in the temporary recovery backup.

# Sales Order Management 系統設計規格

## 0. 文件資訊

| 項目 | 內容 |
|---|---|
| 文件版本 | 0.1 |
| 狀態 | Draft — 可供技術評審及拆分 Tasks |
| 建立日期 | 2026-09-08 |
| 依據 | `docs/sales_order_management/01_requirement_spec.md` |
| UI／UX 基準 | `docs/frontend-design.md` |
| 目標技術棧 | Node.js 26、Express 5、MySQL 5.7+、Vue 3、Quasar 2 |

### 0.1 文件目的

本文件把 Sales Order Management 業務需求轉換為可執行的系統設計，詳細定義：

- 前端頁面、元件、狀態管理及操作流程。
- 後端 module boundary、Service 責任、交易及併發策略。
- REST API、內部模組接口、輸入／輸出及穩定錯誤語意。
- MySQL tables、欄位、約束、索引、Archive Tables 及 Migration 次序。
- 人工同步確認、CSV／渠道非同步接單、Reservation／Backorder 及自動 FIFO 補配。
- Unit、Integration、Frontend、Security、Concurrency、Performance 及 Archive 測試。
- 具體需新增及修改的程式碼、部署、回滾、監察及需求追溯。

本文件不實作程式碼。後續開發必須以本文件及 Requirement 為準；如設計與需求發生衝突，先更新並重新確認文件，不以程式碼默認取代業務決策。

### 0.2 訪談已確認的架構決策

| ID | 決策 |
|---|---|
| SAD-001 | 沿用現有 Modular Monolith，不另建 Sales 微服務。 |
| SAD-002 | Active 與 Archive 使用同一 MySQL 實例內的獨立 relational tables。 |
| SAD-003 | 人工 SO 確認為同步使用體驗，成功時立即回每行 Reserved／Backorder。 |
| SAD-004 | CSV 及渠道訂單經 durable background jobs 非同步確認，但共用同一個 Confirmation Service。 |
| SAD-005 | 庫存競爭時在 Inventory lock 內重新讀取 ATP，能保留多少便保留多少，餘額成為 Backorder，不因不足拒絕 SO。 |
| SAD-006 | Inventory 結果不確定時不得重開新意圖；以原 eventId 查詢及安全恢復 `CONFIRMING`。 |
| SAD-007 | Backorder 按同一 Warehouse＋SKU 的 SO 確認時間 FIFO 自動補配；可手動觸發重跑，不支援插隊或客戶優先級。 |
| SAD-008 | 未有 Fulfilled Quantity 的 Confirmed SO 可輸入原因撤回 Draft，先釋放 Reservation；已有履約後不可撤回。 |
| SAD-009 | Quotation 轉換建立 Draft SO；只有 SO 確認才保留庫存。 |
| SAD-010 | 每月以小批次把合資格 Order Aggregate 搬至 Archive Tables；Archive 唯讀且第一階段不自動永久刪除。 |

### 0.3 設計中關閉的 Requirement Gates

| Gate | 設計結論 |
|---|---|
| GATE-01 | SO Number：`SO-YYYYMM-NNNNNN`；Quotation：`QT-YYYYMM-NNNNNN`。月份以 `Asia/Hong_Kong` 建立時間決定，每月最多 999,999 張／類型。 |
| GATE-02 | CSV v1 採一行一個訂單明細，以 `sourceOrderKey` 分組；完整欄位見 §5.8。最大 10,000 張來源訂單、100,000 行、50 MB。現有 Upload Framework 會先把整檔載入記憶體，Phase 0 必須先加入預設關閉、向後兼容的 `storageMode:"disk"` 串流落盤模式，Sales CSV 才可啟用 50 MB 上限。 |
| GATE-03 | 第一階段提供 versioned canonical JavaScript contract 及 contract tests；未選定服務身份認證前不註冊公共 Channel HTTP route。首個 Adapter 實作時才加入受認證 transport。 |
| GATE-04 | 新增 Inventory 專用 batch internal contract，在固定 Inventory lock order 內計算 ATP 及建立確切數量 Reservation；不逐行呼叫 generic create。 |
| GATE-05 | Customer Credit `ON_HOLD` 阻止確認；AR 尚未提供 Exposure 前，Credit Limit 只顯示警告。 |
| GATE-06 | 容量基線為每日 10,000 張、24 個月約 730 萬張 Active Header；平均／P95 行數須由實際數據補充，測試先採平均 5 行、P95 20 行、上限 100 行。 |
| GATE-07 | Archive 預設每月 2 日 02:00 HKT 執行，每次 500 張 Order Aggregate；值可由環境設定調整並在 startup 驗證。 |
| GATE-08 | 第一階段不實作 purge；因此不會早於 7 年刪除。正式 purge 前必須另行確認保存期起算及法規要求。 |
| GATE-09 | 下游以具名 internal contract 提供／查詢 open matters；未接入的 provider 不可被當作「沒有未完成事項」。 |

### 0.4 明確不做

- 不實作指定電商平台 Adapter、平台憑證管理或平台狀態回傳。
- 不實作多倉拆單、自動選倉、跨倉 Fulfillment 或調撥。
- 不在 Sales 分配 Lot／Bin，不實作 Picking、Packing、Issue 或 Shipping。
- 不在 SO 選擇或保存 Shipping Address；渠道地址由首個 Adapter 設計 Fulfillment Instruction 時處理。
- 不實作 Price List、Customer Price、Discount、Promotion、Tax 或自動匯率換算。
- 不實作 SO／Quotation Approval、毛利審批或信用超額覆核。
- 不實作 Invoice、AR、Payment、Return、Refund 或會計分錄。
- 不把 Archive 改成資料湖、搜尋引擎或第二套資料庫。
- 不建立 generic workflow engine、generic repository framework 或 event-bus abstraction。

---

## 1. 成功條件、Capability Map 與工程邊界

### 1.1 可驗證成功條件

1. 人工使用者確認不超過 100 行的 SO，正常情況同步收到每行 Reserved／Backorder；P95 不超過 3 秒。
2. 兩張訂單競爭相同 Warehouse＋SKU 時不超賣、不出現負 ATP、不重複 Reservation。
3. CSV 10,000 張訂單在標準容量環境 30 分鐘內完成；單一無效來源訂單不建立部分 SO，也不阻止其他有效訂單。
4. `channelCode + externalOrderId` 在 HTTP retry、Job retry、Process crash 及跨批次重送下只建立一張 SO。
5. Backorder Job 只按 `confirmedAt, salesOrderId, lineNo` FIFO 分配，並可在 crash 後安全續跑。
6. 未履約 Confirmed SO 撤回或取消時，SO 與 Inventory Reservation 在同一 DB transaction 保持一致。
7. 24 個月、約 730 萬張 Active Header 的資料集下，常用 Active 查詢 P95 不超過 2 秒。
8. 每月 Archive 可中斷續跑；成功 Order Aggregate 完整搬移，失敗資料仍留 Active，日常交易不被長鎖阻塞。
9. Archive 精確查詢 P95 不超過 3 秒、一般受限日期查詢 P95 不超過 5 秒，並且只能唯讀／匯出。
10. Requirement 的 FR、BR、NFR 及 Acceptance Criteria 均在 §14 有設計與測試追溯。

### 1.2 Capability Map

| Capability ID | 實作責任 | 依賴 |
|---|---|---|
| SO-CAP-01 | Quotation／SO aggregate、人工輸入、金額、快照、狀態及版本 | Customer、Item、Business Master、User |
| SO-CAP-02 | Quotation 發出及一對一轉換 | SO-CAP-01 |
| SO-CAP-03 | CSV Job、canonical channel intake、例外及 source dedupe | SO-CAP-01、Scheduler、Upload |
| SO-CAP-04 | 同步 Reservation、Backorder queue、自動 FIFO 補配及 Release | SO-CAP-01、Inventory |
| SO-CAP-05 | Active Inquiry、Audit、Operation Lookup 及 Export Jobs | SO-CAP-01 至 04 |
| SO-CAP-06 | Archive eligibility、搬移、Archive Inquiry 及保留 | SO-CAP-01、SO-CAP-05、下游 open-matter contracts |

依賴次序維持：`SO-CAP-01 → SO-CAP-02／03／04 → SO-CAP-05 → SO-CAP-06`。

### 1.3 現有專案約束

- 後端使用原生 ESM JavaScript、Express 5、AJV、mysql2；不引入 ORM、queue broker 或 TypeScript。
- `server/src/framework/` 是 framework，業務功能放 `server/src/modules/sales/`。
- 一支 API 一個 Handler，按 URL prefix 放 `server/src/handlers/sales/`、`sales-imports/` 等目錄。
- 業務 Service 不進 framework service discovery；Handler 直接建立並注入 Database、Logging、Time、Scheduler 等依賴。
- 寫入使用 `MySqlDatabaseService.withTransaction()`；金額及 quantity 不使用 JavaScript 浮點數運算。
- API 成功信封為 `{ success, data, meta }`，錯誤為 `{ success:false, error, meta }`。
- 前端使用 Vue 3 Composition API、Quasar、auto-discovered pages、`HttpClient`、`DataTable`、`FormPanel`、`PageHeader` 及 `notify`。
- MySQL 最低 5.7；不能依賴 MySQL 8 專有功能、partial indexes 或 enforced CHECK constraints。
- 現有 Upload Framework 是完整檔案記憶體緩衝後再落盤，預設單檔 10 MB；這不能滿足本模組 50 MB 且 memory-bounded 的要求。唯一必要的 framework 變更是 §9.1 的 opt-in disk-stream mode，既有 routes 繼續使用 `memory` mode且行為不變。
- 現有已落地 Migration 最後序號可能在開發前改變；Sales Migration 實作時按目標分支下一個連續可用序號命名，本文件不用固定號碼搶佔序號。

### 1.4 開發與驗證命令

```bash
# 只在獨立 worktree 執行
npm install
npm run dev

# 靜態及單元驗證
npm run lint
npm test --workspace server
npm test --workspace client
npm run test:coverage --workspace server
npm run test:coverage --workspace client
npm run build --workspace client

# 真 MySQL migration／integration，只可使用專用測試 DB
npm run migrate --workspace server
DB_INTEGRATION_TESTS=1 npm test --workspace server

# 完整品質關卡
npm run verify
```

禁止把開發或自動化測試指向 production、共用 UAT 或含真實業務資料的 Database。

### 1.5 Code style

- ESM import 使用 `.js` 副檔名；class／component 用 PascalCase，function／field 用 camelCase，DB 用 snake_case。
- DB enum 值及 API enum response 用 `UPPER_SNAKE_CASE`；可見文字由前端映射成繁體中文。
- Handler 只處理 auth context、validated input、Service 呼叫及 response；SQL、狀態轉換及商業運算不可放 Handler。
- API input／output schema 分開，全部 `additionalProperties:false`；不可 spread DB row 作 response。
- Money API 使用 decimal string，DB 使用 `DECIMAL(19,4)`；Sales UOM quantity 使用 decimal string／`DECIMAL(20,6)`，Inventory Base Quantity 使用正整數 `BIGINT UNSIGNED`。
- 可變 Aggregate 使用 `version` compare-and-set；所有 command 使用穩定 `eventId`。
- 只有第二個真實 storage implementation 出現時才抽 generic repository；本期 Service 以注入的 database executor 執行清楚的參數化 SQL。

```js
export class SalesOrderConfirmationService {
  constructor({ database, inventoryReservation, customerLookup, itemLookup, time, logger }) {
    this.database = database;
    this.inventoryReservation = inventoryReservation;
    this.customerLookup = customerLookup;
    this.itemLookup = itemLookup;
    this.time = time;
    this.logger = logger;
  }

  async confirm(command) {
    return this.database.withTransaction((transaction) =>
      this.confirmInTransaction(transaction, command)
    );
  }
}
```

### 1.6 三層工程邊界

#### Always do

- 以獨立 worktree 開發，先測試再提交。
- 所有 SQL 參數化，sort／filter column 使用 allowlist。
- State-changing API 同時使用 framework idempotency 及 domain operation event。
- 在 transaction 提交點重新驗證 Actor、Customer、SKU、Warehouse、Version 及數量。
- 所有跨 Sales／Inventory 寫入使用同一 MySQL transaction executor。
- 新頁面遵循 `docs/frontend-design.md`，列表使用 `DataTable`，表單使用 `FormPanel`。
- Migration、constraint、真併發、Archive move 及 restore 使用真 MySQL integration tests。

#### Ask first

- 新增 npm dependency、Queue Broker、第二個 Database、Search Engine 或 Object Storage。
- 改變 Inventory provider contract 以外的既有 Inventory 行為。
- 修改 API version、公開 Channel transport 或 authentication strategy。
- 更改 SO／Quotation 編號、24 個月資格、7 年保留或效能門檻。
- 新增 Price、Discount、Tax、Approval、Address 或跨倉能力。

#### Never do

- 不直接寫 Inventory tables 或複製一套 ATP 算法到 Sales。
- 不以 JavaScript `Number` 計算 money 或大 quantity。
- 不接受 client 提交 snapshot、line amount、total、Reserved 或 Backorder 作真相。
- 不以 `SELECT then INSERT` 無 unique constraint 的方式做 source dedupe 或 idempotency。
- 不在 Archive 校驗完成前刪除 Active Order Aggregate。
- 不用 unbounded query／export 掃描 730 萬 Active 或多年 Archive rows。
- 不記錄 Token、Password、完整 CSV、平台 Credential、客戶銀行資料或不必要個資。
- 不為通過測試而刪除、skip 或降低既有 coverage threshold。

---

## 2. 整體架構

### 2.1 元件與依賴關係

```text
Vue / Quasar pages
  └─ client/src/services/sales.js
       └─ /api/v1/sales-* handlers
            └─ server/src/modules/sales/*
                 ├─ CustomerLookupService
                 ├─ ItemLookupService
                 ├─ InventoryReservationService batch contract
                 ├─ MySqlDatabaseService
                 ├─ SchedulerService / JobLeaseStore
                 ├─ Logging / Time / FileType
                 └─ Active Tables + Archive Tables (same MySQL instance)

CSV upload ──> disk-stream temp file ──> SalesImportService ──> durable import rows ──> SalesIntakeWorker
Future Adapter ──> SalesChannelIntake contract ────────────> SalesIntakeWorker
Inventory replenishment / schedule ──> BackorderAllocationJob
Monthly schedule ────────────────────> SalesArchiveJob
```

Sales 是 business aggregate owner；Customer、Item、Inventory 仍各自擁有其主檔及庫存真相。Frontend 不直接組合多個 provider API 後自行決定訂單是否有效，所有提交判定由 Sales backend 完成。

### 2.2 Backend module boundary

| 類別 | 責任 |
|---|---|
| `SalesSequenceService` | 原子分配 SO／Quotation 月度號碼。 |
| `SalesQuotationService` | Quotation CRUD、issue、expire、cancel 及一對一 conversion。 |
| `SalesOrderService` | Draft create／update、detail 及 current projection。 |
| `SalesOrderConfirmationService` | `CONFIRMING` workflow、master revalidation、snapshot、Inventory batch reservation、Backorder 建立及完成。 |
| `SalesOrderLifecycleService` | Withdraw、cancel、close remaining、Reservation release 及狀態守恆。 |
| `SalesBackorderService` | FIFO queue、手動觸發及單次 allocation transaction。 |
| `SalesIntakeService` | Canonical CSV／CHANNEL input、source dedupe、enqueue 及共用結果語意。 |
| `SalesImportService` | 接手已安全落盤的 CSV、stream parse、precheck、job／order／error persistence 及 result CSV；multipart transport 仍由 framework負責。 |
| `SalesInquiryService` | Active lists、Outstanding、detail、Archive routing 及 bounded projections。 |
| `SalesExportService` | Durable Export Job、keyset read、safe CSV 及 file retention。 |
| `SalesArchiveService` | Eligibility、batch claim、aggregate move、validation、report 及 retry。 |
| `SalesOperationService` | Domain event claim、payload hash、result lookup 及 unknown-outcome recovery。 |
| `SalesAuditService` | 固定 action allowlist 及安全 detail builders。 |
| `SalesReconciliationService` | Sales line、Reservation mapping、Inventory truth、Backorder 及 Archive manifest 的只讀對數。 |

不建立 `SalesRepository`、`QuotationRepository` 等一對一包裝 SQL 的類別；Service 直接使用 transaction executor，避免只有單一 storage 時的無效抽象。Active／Archive Query 是兩個有真實不同 storage semantics 的實作，因此由 `SalesInquiryService` 以明確方法分開，而非用 runtime generic repository switch。

### 2.3 Frontend architecture

```text
pages/sales/
  SalesOrdersPage.vue
  SalesOrderCreatePage.vue
  SalesOrderEditPage.vue
  SalesOrderDetailPage.vue
  OutstandingSalesOrdersPage.vue
  SalesQuotationsPage.vue
  SalesQuotationCreatePage.vue
  SalesQuotationEditPage.vue
  SalesQuotationDetailPage.vue
  SalesQuotationPrintPage.vue
  SalesImportsPage.vue
  SalesImportCreatePage.vue
  SalesImportDetailPage.vue
  SalesImportExceptionsPage.vue
  SalesArchivePage.vue
  SalesArchiveDetailPage.vue
  SalesExportJobsPage.vue

components/sales/
  SalesOrderForm.vue
  SalesOrderLineEditor.vue
  SalesOrderQuantitySummary.vue
  SalesOrderSourcePanel.vue
  SalesOrderStatusTimeline.vue
  SalesQuotationForm.vue
  QuotationDifferencePanel.vue
  SalesImportSummary.vue
  SalesImportErrorTable.vue
  BackorderAllocationDialog.vue

composables/sales/
  useSalesFilters.js
  useSalesCommandEvent.js
  useImportJobPolling.js
```

- 頁面負責 route、permission、query-string、notification 及頁面組裝。
- Form／Line Editor 負責輸入狀態及 client-side usability validation，不重做 server business rules。
- `sales.js` 是唯一 HTTP adapter，將 server list `{items,total,page,pageSize}` 轉為 DataTable `{rows,rowsNumber}`。
- 不建立全域 Sales Pinia store；Draft 只在當前 form component 管理，避免跨頁 stale state。Session Store 仍只處理身份。
- Background Job 頁只輪詢當前可見 Job；離開頁面即 abort，不啟動全域永久 polling。

### 2.4 Provider／consumer boundaries

#### Customer provider

使用既定 contract：

```js
CustomerLookupService.findById(customerId, { purpose: "new_sale", atMs })
CustomerLookupService.getCreditPolicy(customerId, { atMs })
```

確認點要求 Customer `ACTIVE`。回傳最小 projection：ID、Code、Legal Name、Default Currency、Payment Term、Credit Status／Version；不得回 Bank 或 Address。Credit `ON_HOLD` 阻止確認；Limit／Currency 只產生 warning snapshot，直至 AR Exposure contract 落地。

#### Item provider

新增具名 consumer contract，不讓 Sales 直接讀 Item tables：

```js
ItemLookupService.findManyForSale(skuIds, { atMs, purpose: "new_sale" })
ItemLookupService.findSaleUom(skuId, skuUomId, { atMs })
ItemLookupService.searchForSale({ q, barcode, page, pageSize, atMs })
```

回傳 Active／Sellable／effective SKU、SKU／Item display snapshot、Sales UOM、`toBaseFactor`、tracking minimum-sale-life 及 Suggested Price `{amount,currency,taxBasis}`。不同 Currency 不由 Sales 自動換算。

#### Inventory provider

在 Inventory module 新增以下 Sales-specific internal contracts：

```js
InventoryReservationService.reserveAvailableForSalesBatchInTransaction(transaction, command)
InventoryReservationService.releaseSalesBatchInTransaction(transaction, command)
InventoryLookupService.getSalesReservationStates(transaction, query)
```

`reserveAvailableForSalesBatchInTransaction()` 接受一個 Warehouse 及按 `(skuId, sourceLineId)` 排序的 demand lines。Inventory 在自己的固定 lock order 內鎖 Warehouse／Stock Controls，重新計算 ATP，為每行建立 `0..orderedBaseQuantity` 的確切 Reservation，並回 `reservedBaseQuantity`、`uncoveredBaseQuantity`、`reservationId`。這不是放寬 generic Reservation 的「部分成功」：每個真正建立的 Reservation 仍以其確切數量全有或全無；uncovered demand 由 Sales 建 Backorder。

同一 SO 確認只有一個 Warehouse，整批在同一 DB transaction 完成。禁止 Sales 逐行呼叫 generic create，否則多 SKU 會以使用者行順序取得 Inventory lock，破壞全域鎖順序。

#### Fulfillment consumer boundary

Sales 只擁有 SO 與 Reservation mapping；Fulfillment 上線後沿用以下正式 contract，不能直接寫 Sales tables：

```js
SalesFulfillmentService.getOrderForFulfillment(orderId, { atMs })
SalesFulfillmentService.lockLinesForFulfillmentInTransaction(transaction, command)
SalesFulfillmentService.applyFulfillmentResultInTransaction(transaction, command)
FulfillmentOpenMatterService.assertSalesLifecycleAllowedInTransaction(transaction, command)
FulfillmentOpenMatterService.getOrderArchiveStatus(orderId, { atMs })
FulfillmentArchiveParticipant.archiveOrderInTransaction(transaction, command)
```

`applyFulfillmentResultInTransaction()` 只接受 `SHIPMENT_CONFIRMED`／`SHIPMENT_REVERSED`。Confirm 把 Reserved 移至 Fulfilled；Reversal 必須引用原 Shipment Issue 及已恢復的 Reservation，把 Fulfilled 移回 Reserved。Sales 信任已驗證的 provider result，不接受 caller 自報的 Inventory balance。

固定 lock order 是 Sales Order／Lines／Reservation mappings → Fulfillment aggregate → Inventory batch Issue／Reversal，並在同一 transaction 更新 Sales。不得先持有 Inventory lock 再反向鎖 Sales。

`getOrderArchiveStatus()` 只回 `CLOSED`／`OPEN`／`UNKNOWN`；provider unavailable 必須回 `UNKNOWN`。Sales Archive Job 是 coordinator，並在同一 transaction 呼叫 Fulfillment Archive Participant 搬移相關 aggregate。

Withdraw／Cancel／Close Remaining 必須先呼叫 lifecycle guard；存在 `DRAFT`／`PICKING`／`PICKED`／`SHIPPING`／`REVERSING` Fulfillment 或 active claim 時回 `OPEN_FULFILLMENT_EXISTS`。Provider 只可在已鎖定 Sales owner 後依相同 lock order加鎖，不可反向鎖 Sales。

#### Channel Adapter boundary

第一階段提供 JavaScript canonical contract，不開匿名或 API-key HTTP endpoint：

```js
SalesChannelIntake.submit({
  schemaVersion: "1.0",
  channelIdentity,
  requestId,
  idempotencyKey,
  order
})
```

`channelIdentity` 必須由未來 transport 的已驗證身份產生，不能信任 payload 自報。首個 Adapter 另行決定 JWT service identity 或 HMAC；決定前只以 contract fake 驗證核心接入。

### 2.5 人工同步確認與 durable recovery

為同時提供即時結果及可恢復 `CONFIRMING`，確認分成兩個受控 transaction：

```text
Phase A — claim intent
BEGIN
  1. fresh actor + sales.mgmt
  2. atomic claim sales_operation_requests(eventId, payloadHash)
  3. lock SO；驗證 DRAFT + version
  4. status DRAFT -> CONFIRMING；保存 confirmation_event_id
  5. operation = IN_PROGRESS；配置短 lease
COMMIT

Phase B — execute immediately in same HTTP request
BEGIN
  1. lock operation + SO + lines
  2. verify same event/hash and CONFIRMING owner
  3. re-read Customer / SKU / UOM / Warehouse
  4. build immutable snapshots and exact base quantities
  5. Inventory reserveAvailableForSalesBatchInTransaction()
  6. update line Reserved/Backorder + mapping + queue
  7. status CONFIRMING -> CONFIRMED；append history/audit
  8. operation = SUCCEEDED + replay-safe result
COMMIT
return CONFIRMED detail
```

- Phase A 完成後如 HTTP timeout、process crash 或 Inventory 暫不可用，SO 留在 `CONFIRMING`，使用者不可修改、取消或用新 eventId 再確認。
- `SalesConfirmationRecoveryJob` 以 operation lease 找出超時 `CONFIRMING`，使用相同 eventId 續跑 Phase B。
- Phase B 發現 Customer／SKU 等業務資格已失效時，在同一 transaction 把 SO 回 `DRAFT`、清除 `confirmation_event_id`、operation 標記 `FAILED` 並保存 public error；不建立 Reservation。
- Phase B 的 Inventory 操作與 Sales 完成同一 transaction；任何中途錯誤完整 rollback，SO 仍 `CONFIRMING` 等候原 event 恢復。
- COMMIT outcome unknown 時不可換 eventId；Client 呼叫 Operation Lookup，只有 server fact 證明未完成才續跑。

CSV／Channel Worker 共用 Phase B 內的 `confirmDraftInTransaction()` 核心，但不把未完成 SO 提前公開：它在單一 transaction 內 claim External Key、建立 Draft、執行確認核心並直接提交 Confirmed SO。Business failure 整個 rollback，所以不留下部分 SO；technical retry 狀態保存在 Intake row。人工路徑才需要先持久化可見的 `CONFIRMING`。

### 2.6 Backorder FIFO 補配

```text
SalesBackorderAllocationJob / manual trigger
  1. 找到有 OPEN queue 的 Warehouse + SKU（bounded keyset）
  2. 對 scope 取得 scheduler/domain lease
  3. 依 confirmed_at, sales_order_id, line_no 排 OPEN entries
  4. 在同一 transaction 鎖 entries 與對應 SO/Lines
  5. 呼叫 reserveAvailableForSalesBatchInTransaction()
  6. 依 FIFO 將 ATP 配給最早 entry
  7. 更新 line reserved/backorder、reservation mapping、queue、audit
  8. ATP 用盡即停止該 scope，不掃描後續全部 rows
```

- Job 預設每 5 分鐘處理，也可由有 `sales.mgmt` 的使用者按 Warehouse／SKU 或 SO 手動觸發。
- FIFO tie-breaker 固定為 `confirmed_at, sales_order_id, line_no`，不接受 client priority。
- 新入庫不需要可靠 message broker 才會觸發；Inventory 可作 best-effort scheduler wake-up，但 polling 是可靠底線。
- 技術失敗採 exponential backoff；業務上仍無 ATP 不是 error，不快速重試。

### 2.7 Source dedupe 與 Intake

三層身份不可混用：

| 層級 | Identity | 目的 |
|---|---|---|
| HTTP framework | actor／service + method + route + `Idempotency-Key` | 防同一 transport request 短期重送 |
| Sales domain operation | `eventId` unique + canonical payload hash | 防人工、worker、recovery 重複產生同一業務效果 |
| External order key | normalized Channel Code + exact External Order ID SHA-256 | 跨檔案、跨批次、長期防重複 SO |

外部 key 在建立 SO 的同一 transaction 以 unique constraint 原子 claim。相同 key：

- 已 `SUCCEEDED`：回既有 SO，Intake result 為 `DUPLICATE`。
- 正在 `PROCESSING`：競爭 transaction 等待第一個 unique claim 完成；lock timeout 時回 `TECHNICAL_RETRY`，不讓第二個 worker 穿透。
- 相同 key 但不同已成功來源 payload：仍回 Duplicate 並記 conflict warning，不建立第二張。
- 業務驗證失敗且從未建立 SO：claim transaction rollback，修正後可用同一 External Order ID 重試。

### 2.8 全域 lock order

所有 Sales 寫入 transaction 必須按以下順序，不能依畫面行順序：

1. `sales_operation_requests`／Job lease row。
2. `sales_document_sequences`（只在建立文件）。
3. `sales_external_order_keys`（只在 intake 建單）。
4. `sales_quotations`，按 ID 升序。
5. `sales_orders`，按 ID 升序。
6. `sales_quotation_lines`／`sales_order_lines`，按 ID 升序。
7. `sales_backorder_entries` 及 `sales_order_line_reservations`，按 ID 升序。
8. Inventory batch contract：Inventory operation claims → Warehouse → Stock Controls → Reservation rows。
9. Current projection update、History、Audit append。

Archive transaction 只鎖已符合資格且沒有進行中 operation 的 finalized SO；不呼叫 Inventory。任何 Inventory workflow 不得持有 Inventory lock 後反向取得 Sales lock。Deadlock／lock timeout映射為可重試 `CONCURRENT_OPERATION`，同一業務意圖仍使用原 eventId 查結果。

---

## 3. Domain 模型、狀態機與不變量

### 3.1 Aggregate boundaries

| Aggregate | Root | Transaction children |
|---|---|---|
| Sales Quotation | `sales_quotations` | lines；conversion 在轉單 transaction 建立 |
| Sales Order | `sales_orders` | lines、reservation mappings、backorder entries、status history |
| Import Job | `sales_import_jobs` | intake orders、intake errors |
| Export Job | `sales_export_jobs` | 單一 job row；檔案在 private job storage |
| Archive Batch | `sales_archive_batches` | 每個 Order Aggregate 分批獨立搬移；Batch 保存總結 |

Audit 及 Operation 是 append／idempotency records，不由 Aggregate cascade delete；Archive Service 明確搬移相關 Sales Audit。

### 3.2 Quotation state machine

```text
DRAFT ──issue──> ISSUED ──convert──> CONVERTED
  │                │
  └──cancel────────┴──cancel──> CANCELLED
                   └──validUntil passed──> EXPIRED
```

- `DRAFT` 可完整修改 Lines；`ISSUED` 不可直接修改，變更需 Copy 成新 Draft。
- `EXPIRED` 可由查詢時計算及由每日 job 固化，兩者結果必須一致。
- Conversion transaction 同時建立 Draft SO、conversion row 及把 Quotation 改為 `CONVERTED`。
- `UNIQUE(quotation_id)` 及 `UNIQUE(sales_order_id)` 是一對一最終防線。

### 3.3 Sales Order state machine

```text
DRAFT ──confirm phase A──> CONFIRMING ──success──> CONFIRMED
  │                              └──business invalid──> DRAFT
  └──cancel───────────────────────────────────────────> CANCELLED

CONFIRMED ──withdraw, fulfilled=0──> DRAFT
CONFIRMED ──cancel, fulfilled=0────> CANCELLED
CONFIRMED ──first fulfillment──────> PARTIALLY_FULFILLED
CONFIRMED ──all fulfilled──────────> COMPLETED
PARTIALLY_FULFILLED ──all fulfilled──> COMPLETED
PARTIALLY_FULFILLED ──close remaining──> CLOSED
COMPLETED ──shipment reversal──> PARTIALLY_FULFILLED / CONFIRMED
PARTIALLY_FULFILLED ──shipment reversal──> PARTIALLY_FULFILLED / CONFIRMED
CLOSED ──shipment reversal──> PARTIALLY_FULFILLED / CONFIRMED
```

- `CONFIRMING` 不接受 edit／cancel／second confirm；只接受 original event recovery。
- 撤回必須輸入原因，釋放全部 outstanding Reservation 後才回 Draft；確認快照及數量 projection 清除，但 History／Audit 保留。
- 已 Fulfilled Quantity 大於 0 後不允許撤回或整張取消。
- `COMPLETED`、`CLOSED`、`CANCELLED` 一般是 finalized states；未歸檔且沒有不可逆下游事項時，前兩者可由已授權 Fulfillment Shipment Reversal 原子重開。`CANCELLED` 不可重開。

### 3.4 Intake／Job states

Import Job：

```text
UPLOADED -> VALIDATING -> READY -> QUEUED -> PROCESSING
     └──────────────> FAILED       ├-> COMPLETED
READY/QUEUED -> CANCELLED          ├-> PARTIAL_SUCCESS
                                   └-> FAILED
```

Intake Order：`RECEIVED → VALIDATING → VALID／INVALID／DUPLICATE → QUEUED → PROCESSING → SUCCEEDED／FAILED`。

只有 Job `READY` 可確認。`VALIDATING`／`PROCESSING` 不可取消。Job Result 是其所有 Intake Order terminal status 的 projection，不由 client 提交。

### 3.5 金額、Quantity 與 Snapshot

- Money 以 decimal string 入 API，先正規化至 4 decimals，再用 decimal-string arithmetic；DB `DECIMAL(19,4)`。
- `lineAmount = round(quantity × unitSellingPrice, 4)`；`documentTotal = sum(lineAmount)`。不含 Discount／Tax。
- Input Quantity DB `DECIMAL(20,6)`；`orderedBaseQuantity = quantity × toBaseFactor` 必須為正整數且不超 `BIGINT UNSIGNED`／JavaScript safe integer boundary。
- Server 從 Item provider 取得 UOM factor；client 傳入的 factor／base quantity 一律因 unknown property 拒絕。
- Suggested Price 只有 Currency 相同才可預設；不同幣別必須手輸，沒有 FX conversion。
- Confirmation Snapshot 保存 Customer、SKU、UOM、Currency、Payment Term、Warehouse 及 Unit Price；主檔之後變更不更新 Snapshot。

### 3.6 核心不變量

對 Confirmed／Partially Fulfilled／Finalized Line：

```text
ordered_base_quantity
  = fulfilled_base_quantity
  + reserved_outstanding_base_quantity
  + backordered_base_quantity
  + cancelled_base_quantity
```

並且：

- 所有 quantity 為非負整數 Base UOM。
- `reserved_outstanding_base_quantity` 等於該 Line 所有有效 Inventory Reservation 的 outstanding 總和。
- `releasedBaseQuantity` 是 Reservation mapping 的歷史累計顯示值，不加入 current demand equation。
- 初次確認時 Fulfilled／Cancelled 為 0，故 `Ordered = Reserved + Backorder`。
- Backorder allocation 只把 Backordered 移到 Reserved，不改 Ordered。
- Shipment Confirm 把 Reserved 移到 Fulfilled；Shipment Reversal 把該 Shipment 的 Fulfilled 移回原 Reservation 的 Reserved；Close／Cancel 把 Reserved／Backorder 移到 Cancelled。
- Reversal 不改動 `cancelled_base_quantity`。若 Reversal 後仍有 Fulfilled，SO 重算為 `PARTIALLY_FULFILLED`；否則重算為 `CONFIRMED`。
- 已恢復的 Reserved 重新進入 Fulfillment Queue；歷史 Close／Complete status history 不可修改或刪除。
- SO `has_backorder = 1` 當且僅當至少一行 `backordered_base_quantity > 0`。
- `COMPLETED` 要求所有行 Reserved／Backorder 為 0 且 Cancelled 為 0；`CLOSED` 可有 Fulfilled＋Cancelled。
- Quotation 及 Draft SO 的庫存 projection 全為 0。

### 3.7 Archive eligibility invariant

Archive 候選同時滿足：

```text
status IN (COMPLETED, CLOSED, CANCELLED)
AND last_business_updated_at < cutoff(24 months)
AND has_backorder = 0
AND no outstanding sales reservation mapping
AND no in-progress sales operation
AND every required downstream open-matter provider returns CLOSED
```

Provider unavailable 回 `UNKNOWN`，不得當作 `CLOSED`。Fulfillment 是 required open-matter provider及同一 transaction 的 Archive Participant；Archive Service 在候選掃描及搬移 transaction 內各檢查一次。

---

## 4. Database Table 詳細設計

### 4.1 共通資料庫規則

- Storage engine：InnoDB；database charset／collation 沿用專案 `utf8mb4` 設定。
- Primary key：`BIGINT UNSIGNED AUTO_INCREMENT`；API 只接受 positive safe integer。
- Timestamp：`BIGINT UNSIGNED` epoch milliseconds；Business Date：`DATE`。
- Money：`DECIMAL(19,4)`；輸入 quantity：`DECIMAL(20,6)`；Inventory Base Quantity：`BIGINT UNSIGNED`。
- Boolean：`TINYINT(1)`，由 Service 限定 0／1。MySQL 5.7 CHECK 不視作唯一保護。
- 可變 row 有 `version INT UNSIGNED NOT NULL DEFAULT 1`，更新使用 `WHERE id=? AND version=?` 並 `version=version+1`。
- Snapshot 文字 `NOT NULL`，沒有值用空字串；正式 snapshot 不以 `NULL` 表示「之後再取主檔」。
- Active tables 對 Customer、Item、Warehouse 等使用 FK `ON DELETE RESTRICT`；Archive Tables 不依賴會變動的 master FK，只保存原 ID 及 snapshot。
- 所有列表索引最後加入 `id` 作 deterministic tie-breaker；sort field 只可由 allowlist 映射固定 SQL。
- JSON 欄位在 Service 寫入前做 schema、byte-size 及 canonical serialization 驗證；不可保存任意 request body。
- Append-only History／Audit 以 trigger 拒絕 `UPDATE`。Active history 的 `DELETE` 只由 Archive Service 受控搬移；Archive history 同時拒絕 `UPDATE`／`DELETE`。
- 正式資料沒有 hard-delete API；Draft 更新可明確 replace child lines，但不得刪除整個已分配號碼的文件。

### 4.2 ER 關係

```text
sales_document_sequences

sales_quotations 1 ── * sales_quotation_lines
sales_quotations 1 ── 0..1 sales_quotation_conversions 0..1 ── 1 sales_orders

sales_import_jobs 1 ── * sales_intake_orders 1 ── * sales_intake_errors
sales_external_order_keys 1 ── 0..1 sales_orders

sales_orders 1 ── * sales_order_lines
sales_order_lines 1 ── * sales_order_line_reservations ── 1 inventory_reservations
sales_order_lines 1 ── 0..1 sales_backorder_entries
sales_orders 1 ── * sales_order_status_history

sales_operation_requests  ... idempotent command results
sales_audit_logs          ... append-only business audit
sales_export_jobs         ... background CSV output
sales_archive_batches 1 ── * sales_orders_archive
sales_orders_archive 1 ── * archive child tables
```

### 4.3 `sales_document_sequences`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Sequence row。 |
| `document_type` | VARCHAR(20) | NOT NULL | `SALES_ORDER`／`QUOTATION`／`IMPORT_BATCH`／`ARCHIVE_BATCH`。 |
| `period_key` | CHAR(6) ASCII | NOT NULL | HKT `YYYYMM`。 |
| `next_value` | INT UNSIGNED | NOT NULL／1 | 下一個可分配值。 |
| `updated_at` | BIGINT UNSIGNED | NOT NULL | 最後分配時間。 |

約束／索引：`UNIQUE uq_sales_sequence(document_type,period_key)`。Service 以 `INSERT ... ON DUPLICATE KEY UPDATE id=id` 建 row，再 `SELECT ... FOR UPDATE`；分配 `next_value` 後加一。值大於 999,999 時回 `SALES_SEQUENCE_EXHAUSTED`，不 rollover、不重用。

### 4.4 `sales_quotations`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Quotation ID。 |
| `quotation_number` | VARCHAR(20) ASCII | NOT NULL | `QT-YYYYMM-NNNNNN`。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `DRAFT`／`ISSUED`／`EXPIRED`／`CONVERTED`／`CANCELLED`。 |
| `customer_id` | BIGINT UNSIGNED | NOT NULL／FK customers RESTRICT | Customer identity。 |
| `customer_code_snapshot` | VARCHAR(100) | NOT NULL | Draft 隨選擇更新；Issue 後凍結。 |
| `customer_name_snapshot` | VARCHAR(190) | NOT NULL | Legal Name snapshot。 |
| `currency_code` | CHAR(3) ASCII | NOT NULL／FK currencies RESTRICT | 文件幣別。 |
| `payment_term_id` | BIGINT UNSIGNED | NULL／FK payment_terms RESTRICT | 可選。 |
| `payment_term_code_snapshot` | VARCHAR(50) | NOT NULL／`''` | 歷史顯示。 |
| `payment_term_name_snapshot` | VARCHAR(190) | NOT NULL／`''` | 歷史顯示。 |
| `quotation_date` | DATE | NOT NULL | 報價日期。 |
| `valid_until` | DATE | NOT NULL | 不早於 quotation date。 |
| `external_reference` | VARCHAR(190) | NOT NULL／`''` | 客戶參考。 |
| `notes` | VARCHAR(2000) | NOT NULL／`''` | 內部／列印備註；UI 明確標示。 |
| `line_count` | INT UNSIGNED | NOT NULL | 1–100。 |
| `total_amount` | DECIMAL(19,4) | NOT NULL | Server 計算。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Header＋完整 Lines CAS。 |
| `issued_at`,`cancelled_at` | BIGINT UNSIGNED | NULL | Lifecycle milestones。 |
| `issued_by`,`cancelled_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `cancel_reason` | VARCHAR(500) | NOT NULL／`''` | Cancel 時必填。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `last_business_updated_at` | BIGINT UNSIGNED | NOT NULL | 查詢不更新。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |

約束／索引：

- `UNIQUE uq_sales_quotation_number(quotation_number)`。
- `INDEX idx_sales_quotations_status_date(status,quotation_date,id)`。
- `INDEX idx_sales_quotations_customer(customer_id,quotation_date,id)`。
- `INDEX idx_sales_quotations_expiry(status,valid_until,id)` 供每日 expiry job。
- Service／trigger 阻止 terminal row 修改商業欄位；`CONVERTED` 只可由 Conversion Service 設定。

### 4.5 `sales_quotation_lines`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Line ID。 |
| `quotation_id` | BIGINT UNSIGNED | NOT NULL／FK quotations CASCADE | Aggregate owner。 |
| `line_no` | SMALLINT UNSIGNED | NOT NULL | 1–100，按提交順序重排。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus RESTRICT | SKU identity。 |
| `item_name_snapshot` | VARCHAR(190) | NOT NULL | Item 顯示。 |
| `sku_code_snapshot`,`sku_name_snapshot` | VARCHAR(190) | NOT NULL | SKU 顯示。 |
| `sku_uom_id` | BIGINT UNSIGNED | NOT NULL／FK item_sku_uoms RESTRICT | 選用 Sales UOM。 |
| `uom_code_snapshot`,`uom_name_snapshot` | VARCHAR(100) | NOT NULL | UOM 顯示。 |
| `to_base_factor_snapshot` | INT UNSIGNED | NOT NULL | 1–1,000,000。 |
| `quantity` | DECIMAL(20,6) | NOT NULL | Input UOM quantity。 |
| `base_quantity` | BIGINT UNSIGNED | NOT NULL | Server 算出的正整數。 |
| `unit_selling_price` | DECIMAL(19,4) | NOT NULL | 最終單價，可為 0。 |
| `price_source` | VARCHAR(20) ASCII | NOT NULL | `SUGGESTED`／`MANUAL`。 |
| `line_amount` | DECIMAL(19,4) | NOT NULL | Server 計算。 |
| `line_note` | VARCHAR(500) | NOT NULL／`''` | 行備註。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

約束／索引：`UNIQUE(quotation_id,line_no)`、`UNIQUE(quotation_id,sku_id,sku_uom_id)`、`INDEX(sku_id,quotation_id)`。Draft replace 由 Service 鎖 Header、刪除原 lines、批量 insert 新 lines、更新 total/version 並同 transaction Audit；Issued 後不 replace。

### 4.6 `sales_quotation_conversions`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Conversion ID。 |
| `quotation_id` | BIGINT UNSIGNED | NOT NULL／FK quotations RESTRICT | Source；unique。 |
| `sales_order_id` | BIGINT UNSIGNED | NOT NULL | Target 原始 ID；不設 FK，容許 SO 歸檔。 |
| `sales_order_number_snapshot` | VARCHAR(20) ASCII | NOT NULL | Target number。 |
| `difference_summary` | JSON | NOT NULL | 新增／刪除／數量／價格差異，最多 64 KiB。 |
| `difference_hash` | CHAR(64) ASCII | NOT NULL | Canonical summary SHA-256。 |
| `event_id` | CHAR(36) ASCII | NOT NULL | Conversion intent。 |
| `is_order_archived` | TINYINT(1) | NOT NULL／0 | Archive routing hint。 |
| `converted_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |
| `converted_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |

`UNIQUE(quotation_id)`、`UNIQUE(sales_order_id)`、`UNIQUE(event_id)`。Conversion row 的核心關係及 difference 不可改；Archive Service 只可把 `is_order_archived` 由 0 改 1。

### 4.7 `sales_external_order_keys`

此表長期保留 source uniqueness，不跟 Active SO 搬走；否則歸檔後同一 External Order ID 會再次開單。

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Key ID。 |
| `channel_code` | VARCHAR(50) ASCII | NOT NULL | 受控 UPPER_SNAKE code。 |
| `external_order_id` | VARCHAR(190) | NOT NULL | Trim 後保留原大小寫。 |
| `external_order_id_hash` | BINARY(32) | NOT NULL | UTF-8 exact value SHA-256。 |
| `source_type` | VARCHAR(20) ASCII | NOT NULL | `CSV`／`CHANNEL`。 |
| `payload_hash` | CHAR(64) ASCII | NOT NULL | 標準化來源訂單 hash。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `PROCESSING`／`SUCCEEDED`。 |
| `sales_order_id` | BIGINT UNSIGNED | NULL | 成功後原始 SO ID；不設 FK。 |
| `sales_order_number` | VARCHAR(20) ASCII | NOT NULL／`''` | Replay-safe result。 |
| `is_order_archived` | TINYINT(1) | NOT NULL／0 | 查詢 routing。 |
| `claimed_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |

約束／索引：

- `UNIQUE uq_sales_external_key(channel_code,external_order_id_hash)` 是 atomic winner。
- `UNIQUE uq_sales_external_order_sales_order(sales_order_id)`；NULL 可多個，成功後一個 key 只指向一張 SO。
- Duplicate 後必須比較 `external_order_id` exact value；理論上的 hash collision 回 `SALES_SOURCE_HASH_COLLISION` 並告警，不可錯回另一訂單。
- `INDEX idx_sales_external_order_id(external_order_id_hash,id)` 支援不知道 Channel 的受限查詢。
- 驗證失敗 transaction rollback key row；正常流程在同一 transaction 把 `PROCESSING` 改為 `SUCCEEDED`，故不會留下可由時間到期搶走的 claim。COMMIT 未知時按 Domain Operation／key 查事實。

### 4.8 `sales_orders`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | SO ID。 |
| `sales_order_number` | VARCHAR(20) ASCII | NOT NULL | `SO-YYYYMM-NNNNNN`。 |
| `status` | VARCHAR(30) ASCII | NOT NULL | §3.3 狀態。 |
| `source_type` | VARCHAR(20) ASCII | NOT NULL | `MANUAL`／`QUOTATION`／`CSV`／`CHANNEL`。 |
| `source_quotation_id` | BIGINT UNSIGNED | NULL／FK quotations RESTRICT | 報價轉單。 |
| `source_intake_order_id` | BIGINT UNSIGNED | NULL | Intake row ID；Migration 後補 FK 或以 service guard，避免 circular creation。 |
| `external_order_key_id` | BIGINT UNSIGNED | NULL／FK external keys RESTRICT | CSV／Channel 必填。 |
| `channel_code_snapshot` | VARCHAR(50) ASCII | NOT NULL／`''` | Source display。 |
| `external_order_id_snapshot` | VARCHAR(190) | NOT NULL／`''` | Source display。 |
| `customer_id` | BIGINT UNSIGNED | NOT NULL／FK customers RESTRICT | Customer identity。 |
| `customer_code_snapshot` | VARCHAR(100) | NOT NULL | Confirmed snapshot。 |
| `customer_name_snapshot` | VARCHAR(190) | NOT NULL | Confirmed snapshot。 |
| `currency_code` | CHAR(3) ASCII | NOT NULL／FK currencies RESTRICT | SO 幣別。 |
| `payment_term_id` | BIGINT UNSIGNED | NULL／FK payment_terms RESTRICT | 可選 identity。 |
| `payment_term_code_snapshot`,`payment_term_name_snapshot` | VARCHAR(50)／VARCHAR(190) | NOT NULL／`''` | Confirmed snapshot。 |
| `credit_status_snapshot` | VARCHAR(20) ASCII | NOT NULL／`NOT_CONFIGURED` | 確認時政策。 |
| `credit_limit_snapshot` | DECIMAL(19,4) | NULL | Advisory snapshot。 |
| `credit_currency_snapshot` | CHAR(3) ASCII | NULL | Limit currency。 |
| `credit_policy_version_snapshot` | INT UNSIGNED | NULL | 對數。 |
| `fulfillment_warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK inventory_warehouses RESTRICT | 全單唯一倉。 |
| `warehouse_code_snapshot`,`warehouse_name_snapshot` | VARCHAR(100)／VARCHAR(190) | NOT NULL | Confirmed snapshot。 |
| `order_date` | DATE | NOT NULL | Business date。 |
| `requested_delivery_date` | DATE | NULL | 不早於 Order Date。 |
| `customer_po_reference` | VARCHAR(190) | NOT NULL／`''` | Customer PO／reference。 |
| `notes` | VARCHAR(2000) | NOT NULL／`''` | 內部備註。 |
| `line_count` | SMALLINT UNSIGNED | NOT NULL | 1–100。 |
| `total_amount` | DECIMAL(19,4) | NOT NULL | Server 計算。 |
| `has_backorder` | TINYINT(1) | NOT NULL／0 | Current projection。 |
| `backorder_line_count` | SMALLINT UNSIGNED | NOT NULL／0 | Current projection。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Aggregate CAS。 |
| `confirmation_event_id` | CHAR(36) ASCII | NULL | CONFIRMING／CONFIRMED intent；一次確認週期。 |
| `confirmed_at`,`cancelled_at`,`closed_at` | BIGINT UNSIGNED | NULL | Milestones。 |
| `confirmed_by`,`cancelled_by`,`closed_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `cancel_reason`,`close_reason` | VARCHAR(500) | NOT NULL／`''` | 對應動作原因。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Technical row time。 |
| `last_business_updated_at` | BIGINT UNSIGNED | NOT NULL | Archive cutoff；read／job heartbeat 不更新。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor／service。 |

索引：

- `UNIQUE uq_sales_order_number(sales_order_number)`。
- `UNIQUE uq_sales_order_confirmation_event(confirmation_event_id)`；NULL 可多個。
- `UNIQUE uq_sales_order_source_quotation(source_quotation_id)`、`UNIQUE uq_sales_order_source_intake(source_intake_order_id)`、`UNIQUE uq_sales_order_external_key(external_order_key_id)`；各欄 NULL 可多個。
- `INDEX idx_sales_orders_status_date(status,order_date,id)`。
- `INDEX idx_sales_orders_customer(customer_id,order_date,id)`。
- `INDEX idx_sales_orders_warehouse(fulfillment_warehouse_id,status,order_date,id)`。
- `INDEX idx_sales_orders_source(source_type,order_date,id)`。
- `INDEX idx_sales_orders_backorder(has_backorder,status,confirmed_at,id)`。
- `INDEX idx_sales_orders_customer_po(customer_id,customer_po_reference,id)`。
- `INDEX idx_sales_orders_archive_eligibility(status,last_business_updated_at,id)`。
- `source_intake_order_id` 在 Intake tables 建立後加 `UNIQUE` 及 FK RESTRICT；Migration 必須分片處理 circular order。

`customer_po_reference` 不是全域 unique；若相同 Customer 的近期 reference 重複，UI 可警告但 Requirement 沒有拒絕規則，因此 DB 不建 unique。

### 4.9 `sales_order_lines`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Line ID。 |
| `sales_order_id` | BIGINT UNSIGNED | NOT NULL／FK orders CASCADE | Aggregate owner。 |
| `line_no` | SMALLINT UNSIGNED | NOT NULL | 1–100。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus RESTRICT | SKU identity。 |
| `item_name_snapshot` | VARCHAR(190) | NOT NULL | Item display。 |
| `sku_code_snapshot`,`sku_name_snapshot` | VARCHAR(190) | NOT NULL | SKU display。 |
| `sku_uom_id` | BIGINT UNSIGNED | NOT NULL／FK item_sku_uoms RESTRICT | Sales UOM。 |
| `uom_code_snapshot`,`uom_name_snapshot` | VARCHAR(100) | NOT NULL | Display。 |
| `to_base_factor_snapshot` | INT UNSIGNED | NOT NULL | Confirmation factor。 |
| `tracking_policy_snapshot` | VARCHAR(30) ASCII | NOT NULL | Downstream Fulfillment hint。 |
| `minimum_sale_life_days_snapshot` | INT UNSIGNED | NOT NULL／0 | Reservation purpose。 |
| `ordered_quantity` | DECIMAL(20,6) | NOT NULL | Input UOM。 |
| `ordered_base_quantity` | BIGINT UNSIGNED | NOT NULL | Base UOM demand。 |
| `unit_selling_price` | DECIMAL(19,4) | NOT NULL | 最終單價。 |
| `price_source` | VARCHAR(20) ASCII | NOT NULL | `SUGGESTED`／`MANUAL`／`QUOTATION`／`IMPORT`。 |
| `line_amount` | DECIMAL(19,4) | NOT NULL | Server 計算。 |
| `reserved_outstanding_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Current reservation projection。 |
| `backordered_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Current backorder。 |
| `fulfilled_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 下游已完成。 |
| `cancelled_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Cancel／close remaining。 |
| `line_note` | VARCHAR(500) | NOT NULL／`''` | 行備註。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Fulfillment／allocation CAS。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

約束／索引：

- `UNIQUE(sales_order_id,line_no)`、`UNIQUE(sales_order_id,sku_id,sku_uom_id)`。
- `UNIQUE(id,sales_order_id)` 供 child composite ownership FK 使用。
- `INDEX idx_sales_order_lines_sku(sku_id,sales_order_id,id)`。
- 數量守恆在每個 write Service 及 integration test 驗證；Migration 可加 `BEFORE INSERT／UPDATE` trigger，以 `SIGNAL SQLSTATE '45000'` 擋負值、超 Ordered 或 finalized state 不一致。
- Draft replace 可刪除／重建 lines；離開 Draft 後 line identity 穩定，不能 replace。

### 4.10 `sales_order_line_reservations`

這是 Sales 對 Inventory Reservation 的可對數 projection，不是第二套可獨立修改的庫存賬。

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Mapping ID。 |
| `sales_order_line_id` | BIGINT UNSIGNED | NOT NULL／FK lines CASCADE | Owner line。 |
| `inventory_reservation_id` | BIGINT UNSIGNED | NOT NULL／FK inventory_reservations RESTRICT | Inventory truth。 |
| `inventory_operation_id` | BIGINT UNSIGNED | NOT NULL | Inventory domain operation reference。 |
| `source_event_id` | CHAR(36) ASCII | NOT NULL | Confirmation／backorder allocation event。 |
| `original_base_quantity` | BIGINT UNSIGNED | NOT NULL | Reservation 原始量。 |
| `consumed_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 已 Fulfillment／Issue。 |
| `released_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 已釋放。 |
| `outstanding_base_quantity` | BIGINT UNSIGNED | NOT NULL | Inventory outstanding projection。 |
| `status` | VARCHAR(30) ASCII | NOT NULL | `ACTIVE`／`PARTIALLY_CONSUMED`／`CONSUMED`／`RELEASED`／`CANCELLED`。 |
| `inventory_version` | INT UNSIGNED | NOT NULL | 最後同步 Inventory version。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(inventory_reservation_id)`、`UNIQUE(sales_order_line_id,source_event_id)`、`INDEX(sales_order_line_id,status,id)`。每次 Sales／Fulfillment 同 transaction 更新 Inventory 後，以 provider result 覆蓋 projection；不得用 Sales 自己加減猜測 Inventory outcome。

### 4.11 `sales_backorder_entries`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Queue entry。 |
| `sales_order_id` | BIGINT UNSIGNED | NOT NULL | Denormalized owner；composite FK。 |
| `sales_order_line_id` | BIGINT UNSIGNED | NOT NULL／FK line CASCADE | 一行最多一 entry。 |
| `line_no` | SMALLINT UNSIGNED | NOT NULL | FIFO tie-break display。 |
| `warehouse_id`,`sku_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Queue scope。 |
| `outstanding_base_quantity` | BIGINT UNSIGNED | NOT NULL | OPEN 時 >0；terminal 時 0。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `OPEN`／`FULFILLED`／`CANCELLED`。 |
| `priority_at` | BIGINT UNSIGNED | NOT NULL | 首次 confirmedAt，不因 retry 改變。 |
| `last_allocation_event_id` | CHAR(36) ASCII | NULL | 最近一次原子補配意圖；COMMIT 未知時用作查詢。 |
| `next_attempt_at` | BIGINT UNSIGNED | NOT NULL | Technical retry／poll eligibility。 |
| `last_attempt_at` | BIGINT UNSIGNED | NULL | 最近嘗試。 |
| `attempt_count` | INT UNSIGNED | NOT NULL／0 | 技術觀測；無 ATP 不增加 error count。 |
| `last_error_code` | VARCHAR(80) ASCII | NOT NULL／`''` | Safe code。 |
| `version` | INT UNSIGNED | NOT NULL／1 | CAS。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

約束／索引：

- `UNIQUE(sales_order_line_id)`。
- Composite FK `(sales_order_line_id,sales_order_id)` 指向 Line `(id,sales_order_id)`。
- `INDEX idx_sales_backorder_fifo(status,warehouse_id,sku_id,priority_at,sales_order_id,line_no,id)`。
- `INDEX idx_sales_backorder_retry(status,next_attempt_at,id)`。
- FIFO priority 欄位一經建立不可改；Service／trigger 只准更新 outstanding、status、retry metadata、version。

### 4.12 `sales_order_status_history`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | History ID。 |
| `sales_order_id` | BIGINT UNSIGNED | NOT NULL／FK orders CASCADE | Owner。 |
| `sequence_no` | INT UNSIGNED | NOT NULL | Order 內事件順序。 |
| `from_status`,`to_status` | VARCHAR(30) ASCII | from 可空／to 必填 | 狀態。 |
| `action` | VARCHAR(50) ASCII | NOT NULL | CREATE／CONFIRM_START／CONFIRM／WITHDRAW／CANCEL／FULFILL／COMPLETE／CLOSE。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | 適用原因。 |
| `order_version_after` | INT UNSIGNED | NOT NULL | 事件後 version。 |
| `event_id` | CHAR(36) ASCII | NOT NULL | Domain event。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Human actor。 |
| `actor_label` | VARCHAR(190) | NOT NULL | User／service snapshot。 |
| `occurred_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(sales_order_id,sequence_no)`、`UNIQUE(sales_order_id,event_id,action)`、`INDEX(sales_order_id,occurred_at,id)`。只准 INSERT／SELECT，Archive 除外。

### 4.13 `sales_operation_requests`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Operation ID。 |
| `event_id` | CHAR(36) ASCII | NOT NULL | 全 Sales module unique intent。 |
| `command_type` | VARCHAR(50) ASCII | NOT NULL | CREATE_ORDER／CONFIRM_ORDER 等。 |
| `target_type` | VARCHAR(30) ASCII | NOT NULL | QUOTATION／SALES_ORDER／IMPORT／EXPORT。 |
| `target_id` | BIGINT UNSIGNED | NULL | Create 前可空；不設 FK。 |
| `request_hash` | CHAR(64) ASCII | NOT NULL | Canonical business payload hash；不含 password。 |
| `recovery_payload` | JSON | NULL | 只保存恢復必要 IDs／version；最多 16 KiB。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `IN_PROGRESS`／`SUCCEEDED`／`FAILED`。 |
| `result_type` | VARCHAR(30) ASCII | NOT NULL／`''` | Replay projection type。 |
| `result_id` | BIGINT UNSIGNED | NULL | Result ID。 |
| `result_summary` | JSON | NULL | 最小 safe response，最多 32 KiB。 |
| `error_code` | VARCHAR(80) ASCII | NOT NULL／`''` | Stable public error。 |
| `lease_owner` | CHAR(36) ASCII | NULL | Recovery worker token。 |
| `lease_until` | BIGINT UNSIGNED | NULL | CONFIRMING recovery。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Human actor。 |
| `actor_label` | VARCHAR(190) | NOT NULL | Actor snapshot。 |
| `request_id`,`correlation_id` | VARCHAR(64) ASCII | NOT NULL／`''` | Trace。 |
| `created_at`,`updated_at`,`completed_at` | BIGINT UNSIGNED | completed nullable | 時間。 |

`UNIQUE(event_id)`、`INDEX(status,lease_until,id)`、`INDEX(target_type,target_id,created_at,id)`。同 event 不同 hash 回 `SALES_EVENT_CONFLICT`。Operation 至少保存 7 年；本期不 purge。

### 4.14 `sales_import_jobs`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Import Job ID。 |
| `batch_number` | VARCHAR(30) ASCII | NOT NULL | 顯示識別，例如 `SI-202609-000001`；可共用 sequence type。 |
| `template_version` | VARCHAR(10) ASCII | NOT NULL | 首版 `1.0`。 |
| `original_file_name` | VARCHAR(255) | NOT NULL | Sanitized display name。 |
| `source_file_path`,`result_file_path` | VARCHAR(500) | NOT NULL／`''` | Private storage relative path。 |
| `file_sha256` | BINARY(32) | NOT NULL | 重傳 warning。 |
| `file_size_bytes` | BIGINT UNSIGNED | NOT NULL | 最大 50 MB。 |
| `status` | VARCHAR(30) ASCII | NOT NULL | §3.4 Job state。 |
| `total_row_count`,`source_order_count` | INT UNSIGNED | NOT NULL／0 | 行／訂單數。 |
| `valid_count`,`invalid_count`,`duplicate_count` | INT UNSIGNED | NOT NULL／0 | Precheck projection。 |
| `success_count`,`failed_count` | INT UNSIGNED | NOT NULL／0 | Processing projection。 |
| `warning_count` | INT UNSIGNED | NOT NULL／0 | Warning total。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Confirm／cancel CAS。 |
| `lease_owner` | CHAR(36) ASCII | NULL | Worker lease。 |
| `lease_until` | BIGINT UNSIGNED | NULL | Worker recovery。 |
| `created_by`,`confirmed_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |
| `confirmed_at`,`processing_started_at`,`completed_at` | BIGINT UNSIGNED | NULL | Milestones。 |
| `files_purged_at` | BIGINT UNSIGNED | NULL | 90 日後檔案清理；structured records 保留。 |

`UNIQUE(batch_number)`、`INDEX(status,created_at,id)`、`INDEX(created_by,created_at,id)`、`INDEX(file_sha256,created_at,id)`。相同 file hash 只 warning，真正防重在 External Order Key。

### 4.15 `sales_intake_orders`

同一模型支援 CSV source order 及未來 Channel canonical order，避免建立兩套驗證與結果狀態。

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Intake ID。 |
| `import_job_id` | BIGINT UNSIGNED | NULL／FK import jobs CASCADE | Channel direct 可空。 |
| `source_type` | VARCHAR(20) ASCII | NOT NULL | `CSV`／`CHANNEL`。 |
| `source_order_key` | VARCHAR(190) | NOT NULL | CSV group key；Channel 可等於 external ID。 |
| `source_order_key_hash` | BINARY(32) | NOT NULL | Job 內 unique。 |
| `channel_code` | VARCHAR(50) ASCII | NOT NULL | Controlled code。 |
| `external_order_id` | VARCHAR(190) | NOT NULL | Exact trimmed source ID。 |
| `external_order_id_hash` | BINARY(32) | NOT NULL | Dedupe lookup。 |
| `schema_version` | VARCHAR(10) ASCII | NOT NULL | Canonical contract。 |
| `transport_request_id` | VARCHAR(190) | NOT NULL／`''` | Channel request trace；CSV 用空字串。 |
| `transport_idempotency_key_hash` | BINARY(32) | NULL | Channel transport key；CSV 為 NULL。 |
| `payload_hash` | CHAR(64) ASCII | NOT NULL | Canonical payload。 |
| `safe_payload` | JSON | NULL | 已正規化且不含 Credential／地址；最多 128 KiB。 |
| `first_row_no`,`last_row_no`,`line_count` | INT UNSIGNED | NOT NULL | CSV diagnostics；Channel 可用 1。 |
| `status` | VARCHAR(30) ASCII | NOT NULL | §3.4 Intake state。 |
| `processing_event_id` | CHAR(36) ASCII | NOT NULL | Worker retry identity。 |
| `external_order_key_id` | BIGINT UNSIGNED | NULL | 成功／duplicate key。 |
| `sales_order_id` | BIGINT UNSIGNED | NULL | 原始 SO ID；不設 FK以容許 Archive。 |
| `sales_order_number` | VARCHAR(20) ASCII | NOT NULL／`''` | Result。 |
| `result_code` | VARCHAR(80) ASCII | NOT NULL／`''` | Safe result。 |
| `attempt_count` | INT UNSIGNED | NOT NULL／0 | Worker attempts。 |
| `next_attempt_at`,`last_attempt_at` | BIGINT UNSIGNED | nullable | Retry。 |
| `created_at`,`updated_at`,`completed_at` | BIGINT UNSIGNED | completed nullable | 時間。 |
| `payload_purged_at` | BIGINT UNSIGNED | NULL | 90 日後清除 safe payload；result key保留。 |

約束／索引：

- `UNIQUE(processing_event_id)`。
- CSV row：`UNIQUE(import_job_id,source_order_key_hash)`；Channel direct 另以 request transport idempotency 控制。
- Channel row：`UNIQUE(channel_code,transport_idempotency_key_hash)`；NULL 可多個。同 key 不同 payload hash 回 conflict。
- `INDEX(import_job_id,status,id)`、`INDEX(status,next_attempt_at,id)`、`INDEX(channel_code,external_order_id_hash,id)`、`INDEX(sales_order_id,id)`。
- Hash match 後仍比較 exact value；不同值回 collision error。

### 4.16 `sales_intake_errors`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Error ID。 |
| `intake_order_id` | BIGINT UNSIGNED | NOT NULL／FK intake CASCADE | Owner。 |
| `row_no` | INT UNSIGNED | NOT NULL | CSV row；Channel 為 1。 |
| `field_path` | VARCHAR(190) | NOT NULL／`''` | Canonical field。 |
| `error_code` | VARCHAR(80) ASCII | NOT NULL | Stable code。 |
| `safe_message` | VARCHAR(500) | NOT NULL | 可顯示繁中／參數化訊息。 |
| `value_summary` | VARCHAR(190) | NOT NULL／`''` | Neutralized、截斷；不存完整敏感值。 |
| `created_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |

`INDEX(intake_order_id,row_no,id)`、`INDEX(error_code,created_at,id)`。一張來源訂單最多保存 200 個錯誤；超出以 `TOO_MANY_ERRORS` summary 收斂。

### 4.17 `sales_export_jobs`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Export Job。 |
| `scope` | VARCHAR(20) ASCII | NOT NULL | `ACTIVE`／`ARCHIVE`／`IMPORT_RESULT`。 |
| `filters` | JSON | NOT NULL | 經 schema 驗證的 allowlisted filter snapshot。 |
| `filters_hash` | CHAR(64) ASCII | NOT NULL | Audit／dedupe觀測。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `QUEUED`／`PROCESSING`／`COMPLETED`／`FAILED`／`EXPIRED`。 |
| `row_count` | BIGINT UNSIGNED | NOT NULL／0 | 寫出行數。 |
| `file_path` | VARCHAR(500) | NOT NULL／`''` | Private relative path。 |
| `error_code` | VARCHAR(80) ASCII | NOT NULL／`''` | Safe code。 |
| `lease_owner`,`lease_until` | CHAR(36)／BIGINT UNSIGNED | NULL | Worker recovery。 |
| `created_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `created_at`,`started_at`,`completed_at`,`expires_at` | BIGINT UNSIGNED | milestones nullable | 檔案預設 7 日後過期。 |

`INDEX(status,created_at,id)`、`INDEX(created_by,created_at,id)`、`INDEX(expires_at,status,id)`。所有 export 一律 background，保持單一路徑及避免先 count 大表再決定同步／非同步。

### 4.18 `sales_audit_logs`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Audit ID。 |
| `occurred_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Human。 |
| `actor_label` | VARCHAR(190) | NOT NULL | Human／service snapshot。 |
| `action` | VARCHAR(80) ASCII | NOT NULL | §10.2 allowlist。 |
| `target_type` | VARCHAR(30) ASCII | NOT NULL | QUOTATION／ORDER／IMPORT／EXPORT／ARCHIVE。 |
| `target_id` | BIGINT UNSIGNED | NULL | 不設 FK，Archive 後保留。 |
| `target_number` | VARCHAR(30) | NOT NULL／`''` | Safe display。 |
| `outcome` | VARCHAR(20) ASCII | NOT NULL | `SUCCESS`／`FAILED`／`WARNING`。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | 使用者原因；不放 Log labels。 |
| `details` | JSON | NULL | 固定 builder，最多 16 KiB。 |
| `event_id` | CHAR(36) ASCII | NOT NULL／`''` | Correlation。 |
| `request_id`,`correlation_id` | VARCHAR(64) ASCII | NOT NULL／`''` | Trace。 |
| `ip_address` | VARCHAR(45) ASCII | NOT NULL／`''` | Audit，export projection不預設顯示。 |

`INDEX(target_type,target_id,occurred_at,id)`、`INDEX(action,occurred_at,id)`、`INDEX(actor_user_id,occurred_at,id)`。Order-related audit 隨 SO 歸檔；其他 audit 留表並至少保存 7 年。本期不 purge。

### 4.19 `sales_archive_batches`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Batch ID。 |
| `batch_number` | VARCHAR(30) ASCII | NOT NULL | `SA-YYYYMM-...`。 |
| `period_key` | CHAR(6) ASCII | NOT NULL | HKT `YYYYMM`；同月份只可有一個可恢復 Batch。 |
| `cutoff_at` | BIGINT UNSIGNED | NOT NULL | 24 個月 cutoff snapshot。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `RUNNING`／`COMPLETED`／`PARTIAL`／`FAILED`。 |
| `candidate_count`,`archived_count`,`skipped_count`,`failed_count` | BIGINT UNSIGNED | NOT NULL／0 | 結果。 |
| `last_scanned_order_id` | BIGINT UNSIGNED | NOT NULL／0 | Keyset resume。 |
| `checksum_summary` | JSON | NULL | Table counts／amount hashes。 |
| `lease_owner`,`lease_until` | CHAR(36)／BIGINT UNSIGNED | NULL | Recovery。 |
| `started_at`,`updated_at`,`completed_at` | BIGINT UNSIGNED | completed nullable | 時間。 |

`UNIQUE(batch_number)`、`UNIQUE(period_key)`、`INDEX(status,started_at,id)`。Global lease 防同時開兩個月度 batch；period unique 處理多 instance race，Batch row 支援 process crash resume。

#### 4.19.1 `sales_archive_order_manifests`

| Column | Type | Null／Default | 說明 |
|---|---|---|---|
| `id` | BIGINT UNSIGNED | PK／AI | Manifest ID。 |
| `archive_batch_id` | BIGINT UNSIGNED | NOT NULL | FK `sales_archive_batches.id`，ON DELETE RESTRICT。 |
| `sales_order_id` | BIGINT UNSIGNED | NOT NULL | 原 SO ID；不對 Active／Archive 任一側建立單邊 FK。 |
| `sales_order_number` | VARCHAR(20) ASCII | NOT NULL | 永久文件路由鍵。 |
| `sales_table_counts` | JSON | NOT NULL | Sales 各表列數。 |
| `sales_hash_summary` | JSON | NOT NULL | Sales canonical hash 摘要。 |
| `fulfillment_table_counts` | JSON | NOT NULL | Fulfillment 各表列數；Fulfillment 部署前固定 `{}`。 |
| `fulfillment_hash_summary` | JSON | NOT NULL | Fulfillment canonical hash 摘要；Fulfillment 部署前固定 `{}`。 |
| `participant_versions` | JSON | NOT NULL | 各 Archive Participant contract／schema version。 |
| `archived_at` | BIGINT UNSIGNED | NOT NULL | 原子搬移完成時間。 |

約束及索引：`UNIQUE(sales_order_id)`、`UNIQUE(sales_order_number)`、`INDEX(archive_batch_id,sales_order_id,id)`。Manifest、Sales Archive rows及Fulfillment Archive rows必須在同一 transaction建立；沒有 Update／Delete API，重跑發現hash差異時不得覆寫。

### 4.20 Archive Tables

Archive Tables 使用 Active 表的原始 ID 作 PK，另加 `archive_batch_id`、`archived_at` 及 `row_hash`。不 `AUTO_INCREMENT`、不對 active master 建 FK、所有 enum／decimal／snapshot 欄位型別與 Active 相同。

第一階段不使用 table partitioning：MySQL 5.7 對 partitioned InnoDB及foreign key有實質限制，而本設計要保留 Archive Aggregate的FK完整性。以Active／Archive物理分表、bounded date filters及covering indexes達標；只有production-like explain／load test證明不達門檻時才另開schema review，不預先移除FK或加第二套storage。Archive Job也不自動執行 `OPTIMIZE TABLE`，避免長時間metadata lock。

#### 4.20.1 `sales_orders_archive`

完整鏡像 §4.8 所有業務欄位，另加：

| Column | Type | 說明 |
|---|---|---|
| `archive_batch_id` | BIGINT UNSIGNED | FK archive_batches RESTRICT。 |
| `archived_at` | BIGINT UNSIGNED | 搬移時間。 |
| `row_hash` | CHAR(64) ASCII | Active canonical row hash。 |

索引：`UNIQUE(sales_order_number)`、`INDEX(customer_id,order_date,id)`、`INDEX(status,order_date,id)`、`INDEX(channel_code_snapshot,order_date,id)`、`INDEX(order_date,id)`、`INDEX(archive_batch_id,id)`。

#### 4.20.2 `sales_order_lines_archive`

鏡像 §4.9，以原 `id` 作 PK，`sales_order_id` FK archive order CASCADE，另有 batch、archivedAt、rowHash。索引 `UNIQUE(sales_order_id,line_no)`、`INDEX(sku_id,sales_order_id,id)`。

#### 4.20.3 `sales_order_line_reservations_archive`

鏡像 §4.10；`inventory_reservation_id` 只保存數值不建 FK。索引 `UNIQUE(inventory_reservation_id)`、`INDEX(sales_order_line_id,id)`。

#### 4.20.4 `sales_backorder_entries_archive`

只接受 terminal `FULFILLED`／`CANCELLED` entry 且 outstanding=0；鏡像 §4.11。索引 `UNIQUE(sales_order_line_id)`、`INDEX(sales_order_id,id)`。

#### 4.20.5 `sales_order_status_history_archive`

鏡像 §4.12，`sales_order_id` FK archive order CASCADE；`UNIQUE(sales_order_id,sequence_no)`。

#### 4.20.6 `sales_audit_logs_archive`

鏡像與該 SO 相關的 §4.18 Audit；`target_id` 指向原 Order ID 但不建 FK，索引 `(target_type,target_id,occurred_at,id)`。

所有 Archive Tables 建 `BEFORE UPDATE`／`BEFORE DELETE` trigger 拒絕變更。第一階段沒有 override session variable 或 purge stored procedure；避免 application connection 意外繞過唯讀保護。

### 4.21 Archive 搬移 transaction

每次最多 500 張 Order IDs，實際以單張 Aggregate transaction 搬移，縮短 lock：

```text
BEGIN
  1. SELECT sales_order FOR UPDATE
  2. 重驗 finalized/cutoff/no backorder/no outstanding reservation/no operation
  3. 重驗 downstream providers 均為 CLOSED（provider unavailable -> rollback/skip）
  4. Fulfillment participant鎖該SO的Fulfillment/Shipment roots並重驗CLOSED
  5. SELECT Sales children + audit；計 row counts、money totals、canonical hashes
  6. INSERT Sales archive header/children/history/audit
  7. Fulfillment participant INSERT Fulfillment archive rows並驗證
  8. 從兩邊archive tables讀回counts/hashes；不一致立即rollback
  9. 更新external key/conversion及Fulfillment routing hints
 10. Fulfillment participant先刪其active children/roots，再刪Sales active rows
 11. 更新batch counters及跨模組order manifest
COMMIT
```

使用相同 MySQL instance 令「Archive insert＋Active delete」可原子提交。`INSERT` 遇原 ID 已存在時，比較 row hash：完全相同表示前次 outcome unknown，可完成 routing／cleanup；不同則回 `ARCHIVE_DATA_CONFLICT`、保留 Active 並告警。不得使用 `INSERT IGNORE` 掩蓋差異。

### 4.22 Trigger、referential constraints 與 Migration 切片

Migration 實作時按 main 下一個可用序號依次建立：

1. Sales permissions、document sequences、operation requests。
2. Quotation header／lines。
3. External keys、Sales Order header／lines。
4. Reservation mapping、Backorder、History、Audit。
5. Import／Intake／Error tables，之後補 `sales_orders.source_intake_order_id` FK。
6. Export jobs、Archive batch、`sales_archive_order_manifests` 及所有 Archive Tables；Fulfillment 上線時以 additive migration 擴充 participant hash欄位／contract version。
7. Immutable／quantity guard triggers、indexes 及 scheduler config seed（如專案使用 DB seed）。

Migration 每片可向前執行且有真 MySQL test；不要在同一 migration 建全部 tables。部署前用 production-like row count 驗證 index 建立時間。Rollback 只在未有正式資料時允許 drop；有資料後以 forward migration 修正，不能刪 Active／Archive tables 回退。

---

## 5. API 與 Internal Interface 詳細設計

### 5.1 共通 API contract

- Base path `/api/v1`；GET 只查詢，業務 command 使用 POST，配合現有 Handler convention。
- 成功：`{success:true,data,meta:{requestId,timestamp}}`；失敗：`{success:false,error:{code,message,details?},meta}`。
- Query params／JSON fields 使用 camelCase；enum response 使用 UPPER_SNAKE_CASE。
- Timestamp 是 epoch ms；Business Date 是 `YYYY-MM-DD`；Money／decimal quantity 一律是 string。
- List query 使用 `page,pageSize,q,sortBy,descending` 及具名 filters；pageSize 預設 20、最大 100。
- List response：`{items,total,page,pageSize}`；每個 sort 最後用 `id` 穩定排序。
- Request params／query／body 皆 `additionalProperties:false`；未知欄位直接 400，不靜默忽略。
- State-changing body 必須有 UUID `eventId`，HTTP header `Idempotency-Key` 使用同一值；同 key 不同 canonical body 回 409。
- 可變 Aggregate command 必須帶 `version`；stale 回 409 及 safe `currentVersion`，不自動 merge。
- Manual confirm 在設定等待時間內完成回 200；仍在處理或 outcome 未知回 202，包含 `operationId,statusUrl,retryAfterSeconds`。
- 任何 child route 同時以 parent ID＋child ID 查詢；owner 不符與不存在都回相同 404。
- Response 使用具名 projection function，禁止 `{...row}`；History Snapshot 與 Current Master Difference 分開。
- CSV／job file response 使用 `Cache-Control:no-store, private`、`X-Content-Type-Options:nosniff`、安全 `Content-Disposition`。

### 5.2 Sales Quotation APIs

| Method／Path | Auth／Permission | Handler | 行為 |
|---|---|---|---|
| `GET /api/v1/sales-quotations` | jwt／`sales.view` | `listSalesQuotationsHandler.js` | Server pagination；number／customer／status／dates filters。 |
| `POST /api/v1/sales-quotations/create` | jwt／view＋`sales.mgmt` | `createSalesQuotationHandler.js` | 建 Draft＋月度號碼＋完整 Lines；201。 |
| `GET /api/v1/sales-quotations/:id` | jwt／`sales.view` | `getSalesQuotationHandler.js` | Header、lines、conversion、allowedActions。 |
| `POST /api/v1/sales-quotations/:id/update` | jwt／view＋`sales.mgmt` | `updateSalesQuotationHandler.js` | Draft only；完整 replace editable projection。 |
| `POST /api/v1/sales-quotations/:id/issue` | jwt／view＋`sales.mgmt` | `issueSalesQuotationHandler.js` | 重驗 Customer／SKU／日期後凍結。 |
| `POST /api/v1/sales-quotations/:id/cancel` | jwt／view＋`sales.mgmt` | `cancelSalesQuotationHandler.js` | Draft／Issued；reason＋version。 |
| `POST /api/v1/sales-quotations/:id/convert` | jwt／view＋`sales.mgmt` | `convertSalesQuotationHandler.js` | 建一張 Draft SO＋difference；201，重送回既有。 |

Quotation 沒有 PDF generator API。`SalesQuotationPrintPage.vue` 使用受權 Detail projection 產生 A4 browser print；避免第一階段引入 server-side PDF dependency。

### 5.3 Sales Order APIs

| Method／Path | Auth／Permission | Handler | 行為 |
|---|---|---|---|
| `GET /api/v1/sales-orders` | jwt／`sales.view` | `listSalesOrdersHandler.js` | Active list；filters、server pagination。 |
| `GET /api/v1/outstanding-sales-orders` | jwt／`sales.view` | `listOutstandingSalesOrdersHandler.js` | Reserved／Backorder／未履約 order。獨立 resource path 避免被 `/sales-orders/:id` 攔截。 |
| `POST /api/v1/sales-orders/create` | jwt／view＋`sales.mgmt` | `createSalesOrderHandler.js` | 人工 Draft＋SO Number；201。 |
| `GET /api/v1/sales-orders/:id` | jwt／`sales.view` | `getSalesOrderHandler.js` | Active detail；不存在時不自動掃 Archive。 |
| `POST /api/v1/sales-orders/:id/update` | jwt／view＋`sales.mgmt` | `updateSalesOrderHandler.js` | Draft only；完整 replace header editable fields＋lines。 |
| `POST /api/v1/sales-orders/:id/confirm` | jwt／view＋`sales.mgmt` | `confirmSalesOrderHandler.js` | Phase A＋同步 Phase B；200／202。 |
| `POST /api/v1/sales-orders/:id/confirmation/withdraw` | jwt／view＋`sales.mgmt` | `withdrawSalesOrderConfirmationHandler.js` | 零 fulfilled；reason＋version，原子 release。 |
| `POST /api/v1/sales-orders/:id/cancel` | jwt／view＋`sales.mgmt` | `cancelSalesOrderHandler.js` | Draft 或零 fulfilled Confirmed；reason。 |
| `POST /api/v1/sales-orders/:id/close-remaining` | jwt／view＋`sales.mgmt` | `closeSalesOrderRemainingHandler.js` | Partially Fulfilled；釋放／取消所有 remaining。 |
| `POST /api/v1/sales-backorders/allocations/run` | jwt／view＋`sales.mgmt` | `runSalesBackorderAllocationHandler.js` | 以 orderId 或 warehouseId＋skuId 提醒 durable Job；202。 |

List filters：`q,status[],sourceType[],channelCode,customerId,warehouseId,hasBackorder,orderDateFrom,orderDateTo,updatedFrom,updatedTo,sortBy,descending,page,pageSize`。`q` 只搜尋 bounded number／customer code／name／customer PO；External Order 精確查詢以 `externalOrderId`＋可選 `channelCode` 走 hash index，不做 `%contains%`。

### 5.4 Core create／update request

```json
{
  "eventId": "542c7fc7-1525-44e8-8f85-115adf37c1d2",
  "version": 3,
  "customerId": 31,
  "currencyCode": "HKD",
  "paymentTermId": 4,
  "fulfillmentWarehouseId": 2,
  "orderDate": "2026-09-08",
  "requestedDeliveryDate": "2026-09-12",
  "customerPoReference": "PO-88931",
  "notes": "",
  "lines": [
    {
      "id": 101,
      "skuId": 55,
      "skuUomId": 88,
      "quantity": "12.000000",
      "unitSellingPrice": "125.5000",
      "lineNote": ""
    }
  ]
}
```

- Create 不送 `version` 及 existing line `id`；Update 必須送目前 `version` 及完整 Lines。
- Quotation create／update 同形，但使用 `quotationDate,validUntil,externalReference` 且沒有 Warehouse／delivery date。
- Client 不可送 `lineNo`、snapshot、factor、base quantity、line amount、total、priceSource、Reserved、Backorder 或 status。
- `currencyCode` 與 Customer default 不同可接受；UI 警告並由 SO 保存實際幣別。不同於 Suggested Price Currency 時，Unit Selling Price 仍必填且不自動換算。

### 5.5 Confirm／lifecycle requests and responses

Confirm request：

```json
{
  "eventId": "c3221e52-a5e0-48fd-aaf8-15a7b526278b",
  "version": 4
}
```

200 result：

```json
{
  "outcome": "CONFIRMED",
  "salesOrder": {
    "id": 901,
    "salesOrderNumber": "SO-202609-000101",
    "status": "CONFIRMED",
    "version": 6,
    "hasBackorder": true,
    "lines": [
      {
        "id": 902,
        "orderedBaseQuantity": "12",
        "reservedOutstandingBaseQuantity": "8",
        "backorderedBaseQuantity": "4",
        "fulfilledBaseQuantity": "0",
        "cancelledBaseQuantity": "0"
      }
    ]
  },
  "warnings": ["PARTIAL_BACKORDER"]
}
```

202 result：

```json
{
  "outcome": "CONFIRMING",
  "operationId": 6001,
  "eventId": "c3221e52-a5e0-48fd-aaf8-15a7b526278b",
  "statusUrl": "/api/v1/sales-operations/by-event/c3221e52-a5e0-48fd-aaf8-15a7b526278b",
  "retryAfterSeconds": 2
}
```

Withdraw／Cancel／Close body：`{eventId,version,reason}`，reason trim 後 5–500 chars。Cancel Draft 不呼叫 Inventory；其他動作把所有 line changes 及 Inventory release 放同一 transaction。

### 5.6 Lookup APIs

| Method／Path | Permission | 行為 |
|---|---|---|
| `GET /api/v1/sales-lookups/customers` | view＋`sales.mgmt` | q／page；只回 new_sale 可用 Customer、currency／term／credit summary。 |
| `GET /api/v1/sales-lookups/skus` | view＋`sales.mgmt` | q／barcode／currencyCode；Active Sellable SKU、sale UOM、suggested price及是否同幣。 |
| `GET /api/v1/sales-lookups/warehouses` | view＋`sales.mgmt` | Active Fulfillment Warehouses。 |
| `GET /api/v1/sales-lookups/channels` | view＋`sales.import` | 受控 active Channel Codes；不回 Credential。 |
| `GET /api/v1/sales-orders/:id/current-master-differences` | `sales.view` | 目前主檔與確認 snapshot 的安全差異。 |

Lookup Handler 只做 Sales permission 及 projection；資格由 provider Service 決定。Submit／Confirm 永遠重新驗證，不能相信頁面先前 lookup。

### 5.7 CSV Import APIs

| Method／Path | Auth／Permission | 行為 |
|---|---|---|
| `GET /api/v1/sales-import-templates/current` | jwt／view＋`sales.import` | UTF-8 CSV v1＋欄位說明；獨立 resource path 避免與 `/sales-imports/:id` 衝突。 |
| `POST /api/v1/sales-imports/upload` | jwt／view＋`sales.import` | multipart single CSV；建立 Job、排 precheck；201。 |
| `GET /api/v1/sales-imports` | jwt／`sales.view` | Job list；status/date/actor/file filters。 |
| `GET /api/v1/sales-imports/:id` | jwt／`sales.view` | Summary、progress、allowedActions。 |
| `GET /api/v1/sales-imports/:id/orders` | jwt／`sales.view` | Intake orders server pagination。 |
| `GET /api/v1/sales-imports/:id/orders/:orderId/errors` | jwt／`sales.view` | Owner-safe errors。 |
| `POST /api/v1/sales-imports/:id/confirm` | jwt／view＋`sales.import` | READY only；version＋eventId，排 processing。 |
| `POST /api/v1/sales-imports/:id/cancel` | jwt／view＋`sales.import` | 非 VALIDATING／PROCESSING；version＋eventId。 |
| `GET /api/v1/sales-imports/:id/result` | jwt／`sales.view` | Completed result CSV；purged 後 410。 |

Upload route framework idempotency 只防同一 upload request；`fileSha256` 相同顯示 warning，不自動拒絕。Confirm worker 每張 Intake Order 使用已保存 `processingEventId`，成功與否互相獨立。

Upload Handler 的 route-specific設定固定如下；50 MB 是檔案上限，`maxRequestBytes` 額外保留 multipart framing及少量fields空間：

```js
upload: {
  enabled: true,
  storageMode: "disk",
  directory: "storage/uploads/tmp/sales-imports",
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxFiles: 1,
  maxTotalFileBytes: 50 * 1024 * 1024,
  maxFieldCount: 2,
  maxFieldSizeBytes: 4096,
  maxRequestBytes: 50 * 1024 * 1024 + 128 * 1024,
  allowedMimeTypes: ["text/csv", "application/csv"]
}
```

`req.files[0]`只含受管 `path,storedName,size,mimeType,contentHash,originalName,prefix` metadata；`contentHash` 是完整檔案 SHA-256，`prefix` 上限64 KiB，disk mode不得提供完整 `buffer`。Handler只接受field name `file`，其他file field或多檔都拒絕。

### 5.8 CSV v1 contract

固定 header：

```text
templateVersion,sourceOrderKey,channelCode,externalOrderId,customerId,
warehouseCode,orderDate,requestedDeliveryDate,currencyCode,paymentTermCode,
customerPoReference,orderNotes,skuCode,salesUomCode,quantity,unitSellingPrice,lineNote
```

規則：

- 第一個 data row 前必須有唯一 header；未知、缺少或重複 header 令整檔失敗。
- `templateVersion` 每行固定 `1.0`；同一 Source Order Key 的 header fields 必須完全一致。
- 每 row 是一個來源 line。相同 SKU＋UOM且 `unitSellingPrice,lineNote` 相同時，Precheck以exact decimal加總quantity後形成一個SO line，並保留來源row numbers供結果追溯；若價格或行備註不同則該來源訂單驗證失敗，避免為強行合併而改變金額或丟失備註。
- 必填：source key、channel、external ID、customer ID、warehouse、order date、currency、SKU、UOM、quantity、unit price。
- 日期 `YYYY-MM-DD`；money／quantity 不接受 exponent、thousand separator、NaN 或 Infinity。
- UTF-8 可接受 BOM；換行接受 CRLF／LF；欄位遵循 RFC 4180 quote。其他 encoding 拒絕並提示轉 UTF-8。
- 最大 50 MB、100,000 rows、10,000 source orders、每 order 100 lines；route 使用 §9.1 的 `storageMode:"disk"`，由 multipart 到 CSV parser 全程不把整檔載入 heap。
- CSV 沒有可信的 binary magic signature；framework只以 allowlisted extension／declared MIME及 bounded prefix做初篩，Service其後嚴格驗 UTF-8、NUL byte、唯一 Header及 CSV grammar。允許 MIME 僅為 `text/csv`、`application/csv`；內容仍一律視為不可信。
- 預檢時只保存 normalized safe payload；原始自由文字按長度及公式規則 neutralize。
- Result CSV 固定：`sourceOrderKey,channelCode,externalOrderId,status,salesOrderNumber,errorCode,errorField,errorMessage`。

### 5.9 Canonical Channel Intake contract

```js
const intakeV1 = {
  schemaVersion: "1.0",
  channelIdentity: { code: "PLATFORM_X", serviceId: "adapter-platform-x" },
  requestId: "platform-request-10998",
  idempotencyKey: "platform-x-order-7788-v1",
  order: {
    externalOrderId: "7788",
    customerId: 31,
    fulfillmentWarehouseCode: "WH-01",
    orderDate: "2026-09-08",
    requestedDeliveryDate: null,
    currencyCode: "HKD",
    paymentTermCode: null,
    customerPoReference: "",
    notes: "",
    lines: [
      {
        skuCode: "SKU-1001",
        salesUomCode: "EA",
        quantity: "2.000000",
        unitSellingPrice: "39.9000",
        lineNote: ""
      }
    ]
  }
};
```

Result 是 discriminated union：

```js
{ outcome: "ACCEPTED", intakeOrderId, statusUrl }
{ outcome: "DUPLICATE", salesOrderId, salesOrderNumber, isArchived }
{ outcome: "VALIDATION_FAILED", intakeOrderId, errors: [{ code, field }] }
{ outcome: "TECHNICAL_RETRY", requestId, retryAfterSeconds }
```

- Adapter response 永遠是 accepted／duplicate／validation failed／technical retry，不暴露 SQL／stack。
- `channelIdentity.code` 由 authenticated transport context 覆蓋，不使用 payload 聲稱值。
- 同 idempotencyKey 不同 payload 必須失敗；key retention 長於 Adapter 最大 retry／DLQ window。
- Shipping Address 不在 intakeV1；首個平台 Adapter 需要此資料時，另建 versioned Fulfillment Instruction contract，不向 intakeV1 偷加未審批欄位。

### 5.10 Inquiry、Archive、Export、Audit 及 Operation APIs

| Method／Path | Auth／Permission | 行為 |
|---|---|---|
| `GET /api/v1/archived-sales-orders` | jwt／`sales.view` | Archive-only bounded filters；不 union Active。 |
| `GET /api/v1/archived-sales-orders/:id` | jwt／`sales.view` | Archive detail，唯讀。 |
| `POST /api/v1/sales-exports/create` | jwt／`sales.view` | ACTIVE／ARCHIVE filters snapshot；一律 background；202。 |
| `GET /api/v1/sales-exports` | jwt／`sales.view` | 只列本人 jobs；主管全域匯出不在第一階段。 |
| `GET /api/v1/sales-exports/:id` | jwt／`sales.view` | Owner-safe status。 |
| `GET /api/v1/sales-exports/:id/download` | jwt／`sales.view` | Owner-safe file；expired 回410。 |
| `GET /api/v1/sales-audit-logs` | jwt／`sales.view` | target／action／actor／date；Active＋非歸檔 Audit。 |
| `GET /api/v1/archived-sales-orders/:id/audit` | jwt／`sales.view` | 該 Archive SO audit，分頁。 |
| `GET /api/v1/sales-operations/by-event/:eventId` | jwt／原操作權限 | 精確查本人或有權 target operation；不可列舉。 |
| `GET /api/v1/sales-archive-batches` | jwt／`sales.view` | Batch safe metrics／errors；不回完整業務資料或提供重跑。 |

Active detail 404 可回 safe hint `{mayExistInArchive:true,archiveSearchUrl}`，但不自動查 Archive。External ID lookup 先查 `sales_external_order_keys`，再依 `isOrderArchived` 路由到唯一 store。

### 5.11 Response projections

建立：

```text
toQuotationSummary / toQuotationDetail / toQuotationPrint
toSalesOrderSummary / toSalesOrderDetail / toOutstandingOrderSummary
toSalesOrderArchiveSummary / toSalesOrderArchiveDetail
toImportJobSummary / toIntakeOrderResult / toIntakeError
toExportJobSummary / toOperationResult / toAuditEvent
```

Sales Order Detail 至少回：

- Header snapshots、source、dates、amount string、status、version、hasBackorder、allowedActions。
- 每 line 的 input UOM quantity、base quantity、Unit Price、Line Amount，以及 Reserved／Backorder／Fulfilled／Cancelled。
- Reservation references 只回業務需要的 ID、status、quantity；不回 Inventory internal operation hash。
- Status History、Quotation／Import source links、Current Master Differences。
- `releasedBaseQuantity` 從 mappings 加總；明確標示 cumulative history，不放入 current demand equation。

Archive projection 不回 `allowedActions` 中任何 write action，固定 `isArchived:true`。

### 5.12 Stable public error codes

| HTTP | Code | 條件 |
|---|---|---|
| 400 | `SALES_INPUT_INVALID` | AJV、未知欄位、長度、格式。 |
| 400 | `SALES_QUANTITY_INVALID`／`SALES_UOM_CONVERSION_INVALID` | quantity、scale、base非整數／超限。 |
| 400 | `SALES_PRICE_INVALID` | 負數、scale、幣別不符時缺 final price。 |
| 400 | `SALES_DATE_INVALID` | delivery／valid-until 日期順序。 |
| 404 | `SALES_ORDER_NOT_FOUND`／`SALES_QUOTATION_NOT_FOUND` | 不存在或無權。 |
| 404 | `SALES_IMPORT_NOT_FOUND`／`SALES_EXPORT_NOT_FOUND` | owner-safe not found。 |
| 409 | `SALES_STATE_CONFLICT`／`QUOTATION_STATE_CONFLICT` | 狀態不允許命令。 |
| 409 | `VERSION_CONFLICT` | stale version。 |
| 409 | `SALES_EVENT_CONFLICT`／`IDEMPOTENCY_CONFLICT` | 同 event/key 不同 payload。 |
| 409 | `SALES_CONFIRMATION_IN_PROGRESS` | 已有 CONFIRMING original event。 |
| 409 | `QUOTATION_ALREADY_CONVERTED` | 回 safe target SO summary。 |
| 409 | `CUSTOMER_NOT_SALEABLE`／`CUSTOMER_CREDIT_ON_HOLD` | Customer provider policy。 |
| 409 | `SKU_NOT_SALEABLE`／`SKU_UOM_INVALID` | Item provider policy。 |
| 409 | `WAREHOUSE_INVALID` | Inventory Warehouse policy。 |
| 409 | `ORDER_ALREADY_FULFILLED` | Withdraw／Cancel 不容許。 |
| 409 | `RESERVATION_RELEASE_FAILED` | 不可完成 withdraw／cancel／close。 |
| 409 | `EXTERNAL_ORDER_DUPLICATE` | 已成功來源；response含 existing summary。 |
| 409 | `SALES_SOURCE_HASH_COLLISION` | hash相同但exact key不同；告警。 |
| 409 | `CONCURRENT_OPERATION` | lock timeout／deadlock，可按指引重讀。 |
| 422 | `SALES_IMPORT_ORDER_INVALID` | Source Order 業務驗證失敗。 |
| 400 | `SALES_IMPORT_FILE_INVALID`／`SALES_IMPORT_VERSION_UNSUPPORTED` | 檔案／schema。 |
| 410 | `SALES_IMPORT_RESULT_EXPIRED`／`SALES_EXPORT_EXPIRED` | File已清理，structured summary仍在。 |
| 409 | `ARCHIVE_NOT_ELIGIBLE`／`ARCHIVE_DATA_CONFLICT` | 資格／hash不一致。 |
| 503 | `SALES_DEPENDENCY_UNAVAILABLE` | Customer／Item／Inventory／DB required dependency。 |
| 500 | `TRANSACTION_OUTCOME_UNKNOWN` | COMMIT未知；必須查 Operation。 |

Frontend `errorMessages.js` 為所有使用者可見 code 提供繁體中文及下一步。`error.details` 只回 safe field path、currentVersion、existing resource summary、status URL 或 retry hint；不回 SQL、constraint、stack、raw payload 或其他客戶資料。

---

## 6. UI／UX 詳細設計

所有頁面嚴格按 `docs/frontend-design.md` 實現：Vue 3＋Quasar、`PageHeader`、`DataTable`、`FormPanel`、`EllipsisCell`、Material Icons、繁體中文、WCAG 2.1 AA，以及 375／768／1024／1440 px 驗證。

### 6.1 Navigation 與頁面權限

| Menu／Route | Page | Permission |
|---|---|---|
| 銷售／銷售訂單 | `/sales/orders` | `sales.view` |
| 銷售／未完成訂單 | `/sales/orders/outstanding` | `sales.view` |
| 銷售／新增訂單 | `/sales/orders/new` | `sales.mgmt` |
| 銷售／報價單 | `/sales/quotations` | `sales.view` |
| 銷售／新增報價 | `/sales/quotations/new` | `sales.mgmt` |
| 銷售／批量匯入 | `/sales/imports` | `sales.view`；上傳操作另需 `sales.import` |
| 銷售／匯入例外 | `/sales/imports/exceptions` | `sales.view` |
| 銷售／歷史訂單 | `/sales/archive` | `sales.view` |
| 銷售／匯出工作 | `/sales/exports` | `sales.view` |

Detail／Edit routes 不放獨立 Menu item，由 List navigation。Router guard 與 API 各自驗證；沒有 permission 時不只隱藏按鈕。

### 6.2 Sales Order List

- `PageHeader` actions：新增訂單、匯出；按權限顯示。
- 篩選：關鍵字、Status、Source、Channel、Customer、Warehouse、Has Backorder、Order Date。
- 常用 View：最近訂單、全部 Active、Outstanding、Has Backorder、Finalized；轉為固定 filter preset，不另建 user dashboard。
- `DataTable sticky-actions` server pagination；預設 `orderDate DESC,id DESC`。
- 欄位：SO Number、Customer、Source、Date、Warehouse、Status、Amount、Reservation／Backorder摘要、Updated At。
- 自由文字用 `EllipsisCell`；Status 用帶文字 `q-badge`，不能只靠顏色。
- 搜尋不到時顯示「搜尋歷史訂單」連結，不自動混合 Archive rows。

### 6.3 Sales Order Create／Edit

- 使用單頁 `SalesOrderForm`，不做多步 Wizard。
- Header：Customer、Currency、Payment Term、Warehouse、Order Date、Requested Delivery Date、Customer PO、Notes。
- Customer 選擇後帶入 defaults；Credit `ON_HOLD` 顯示阻擋 banner，Limit advisory 顯示非阻擋提示。
- `SalesOrderLineEditor` 支援 SKU code／name／barcode search、鍵盤新增、quantity／price 快速輸入、刪行及 100 行上限。
- 再選已存在的SKU＋UOM時不新增第二行，而是聚焦既有行並讓使用者增加quantity；貼上／API提交的重複行仍由Backend按§7.2–7.3規則合併或回商業條件衝突。
- Suggested Price 幣別相同才預填；不同時清楚顯示「請輸入此訂單幣別的售價」。零價顯示 warning，但不要求原因。
- Sticky summary 顯示 line count、currency、total；不顯示 Discount／Tax。
- Save 使用 `FormPanel`；stale version error 聚焦總覽並提供 reload，不自動覆蓋。
- Confirm 前 dialog 列出 Customer、Warehouse、line count、total；零價／credit warning／master difference 一併列出。
- Confirm 按鈕只提交一次 event；timeout 後保持 eventId 並輪詢 Operation，不生成新 UUID。

### 6.4 Sales Order Detail

- Header 顯示 number、status、source、Customer、Warehouse、dates、total 及 Active／Archive 標記。
- Lines table 顯示 Ordered、Reserved、Backorder、Fulfilled、Cancelled；所有 quantity 同時標示 UOM，Base Quantity 放展開詳情。
- Backorder 用 warning badge＋文字，不用 error 阻止整頁。
- Tabs／sections：Order、Inventory Commitment、Source、Status History、Current Master Differences。
- Allowed Actions 完全採 server response：Edit、Confirm、Withdraw、Cancel、Close Remaining、Run Backorder Allocation。
- Withdraw／Cancel／Close 使用 reason dialog；說明會釋放庫存及不可影響已履約部分。
- 202 Confirming 顯示 live region、Operation status 及安全重試；不可顯示第二個 Confirm 按鈕。

### 6.5 Quotation pages

- List／Form 延用 SO 視覺，但沒有 Warehouse、Shipping、Reservation 欄位。
- Form 包含 Customer、Currency、Payment Term、Quotation Date、Valid Until、Reference、Notes、Lines、Total。
- Issued detail 提供 Browser Print 及「轉為銷售訂單」。
- Conversion 先開預填 Draft SO Form；使用者修改後提交，成功才顯示 Difference Summary。
- 已 Converted／Expired／Cancelled 只讀；Converted 顯示唯一 Target SO link。
- A4 Print 使用語意 table、公司名稱、Quotation Number、Customer、日期、明細及 Total；Print CSS 隱藏 navigation/actions。

### 6.6 Import pages

- Import Create：下載模板、拖放／選擇一個 CSV、顯示版本／大小限制及上傳。
- Precheck 頁顯示 Valid、Invalid、Duplicate、Warning；未 READY 不顯示 Confirm。
- Processing 頁每 2 秒輪詢，連續 1 分鐘後退至 5 秒；頁面 hidden 時停止，返回時立即刷新。
- Order Result 使用 `DataTable`；可按 status／errorCode／external ID 篩選。
- Error 顯示 Source Order Key、row、field、message、neutralized value summary。
- Result CSV download 及成功 SO link；失敗資料不提供「直接在 server row 編輯」，使用者修正新 CSV 重傳。

### 6.7 Archive／Export pages

- Archive Search 必須先提供至少一個限制條件：SO Number、External ID、Customer 或最多 366 日 Date Range；禁止空條件掃描。
- Archive Detail 與 Active Detail 使用相同閱讀 layout，但固定唯讀，顯示 Archived At／Batch。
- Export 建立 dialog 顯示 scope、filters、預估可能耗時；建立後進 Export Jobs。
- Job 只列本人；Completed 可下載、Expired 顯示重新建立，不提供猜測 file URL。

### 6.8 Responsive／Accessibility acceptance

- 375／768 px：Header actions 可換行；Line Editor 使用橫向 scroll 或 card rows，但 action 永遠可見。
- 1024／1440 px：Header field 使用 2–4 column Quasar grid，Summary 不遮擋 Lines。
- 每頁一個 `h1`；Section 順序使用 `h2`，不跳級。
- Loading 使用 `aria-busy`；Confirming／Job progress 使用 polite live region；錯誤 summary 用 alert 並聚焦。
- Icon-only button 有 `aria-label`；Status／Backorder 除顏色外有文字及 quantity。
- 鍵盤可以完成 Customer、SKU 搜尋、加行、編輯、保存及確認。
- 不用 `v-html`、inline hex 或自建 raw `q-table`。

---

## 7. Service 與核心算法詳細設計

### 7.1 `SalesSequenceService`

- `nextNumberInTransaction(transaction,{documentType,nowMs})` 以 Time Service 轉 HKT period，不用 DB server timezone。
- 先 upsert sequence row，再 `FOR UPDATE`，驗證未 exhausted，回完整 number 並遞增。
- 分配與文件 insert 同 transaction；rollback 不消耗號碼。若業務要求日後「即使 rollback 亦不可缺號」才需改決策，本期不做。
- Import／Channel worker 每張 SO 各自分配；不預取號碼 range，避免 crash 造成大段空號。

### 7.2 `SalesQuotationService`

`create／update`：

1. `assertActorFresh()` 及 permissions。
2. normalize strings／dates／decimal，以共用 `mergeDocumentLines()` 按SKU＋UOM合併相同價格／備註的數量；同key但價格或備註不同回 `SALES_LINE_MERGE_CONFLICT`。
3. 從 Customer／Item providers 取得當前資料；計 base quantities、line amounts、total。
4. Create 分配號碼並 insert Header／Lines；Update 鎖 Header、CAS version、Draft only、replace Lines。
5. append Audit；commit 後用具名 detail projection 回應。

`issue` 在 transaction 內重驗 Customer、SKU、UOM、Currency、有效期及版本，再把 status 改 `ISSUED`。`expire` 每日 job 以 bounded keyset 把 `ISSUED AND valid_until < HKT today` 改 `EXPIRED`；查詢 projection 即使 job 未跑亦用相同 pure function顯示 effective status，避免過期報價短暫可轉單。

`convert`：

1. claim operation，鎖 Quotation／Lines，重驗 effective `ISSUED` 及未有 conversion。
2. 接受使用者提交的完整 Draft SO editable input，而非先建空 SO 再更新。
3. 使用同一 validators 建 SO Header／Lines、分配 SO Number。
4. 以 SKU ID＋UOM ID 比較 quotation lines 與 target lines，產生固定結構 difference summary：added、removed、quantityChanged、priceChanged；每組只保存 IDs、line numbers、before／after decimal strings。
5. 插入 conversion unique rows、Quotation `CONVERTED`、雙 Audit 及 operation result，同 transaction commit。

Duplicate conversion unique error讀 existing row並回 replay result；不同 event 仍不得產生第二張 SO。

### 7.3 `SalesOrderService`

- `create()` 只接受 `MANUAL`；`QUOTATION／CSV／CHANNEL` 由其 owner Service 建立，client 不能自報 source type。
- `update()` 僅 Draft，鎖 Order 後驗 version，完整 replace editable Lines；number／source／status／snapshot／inventory quantities 不在 schema。
- Create／update／Quotation conversion都在計算前使用同一 `mergeDocumentLines()`；API不依賴Frontend先行合併，DB的 `UNIQUE(document_id,sku_id,sku_uom_id)` 是最後防線。
- Draft snapshot 是方便畫面的 current copy；Confirmation 會從 providers 重新取得並凍結。
- 每次 create／update 使用 `salesMoneyMath` 及 `salesQuantityMath` 純函式，DB 取回 decimal 仍以 string 處理。
- `getDetail()` 使用 bounded queries：先 Header，再 Lines，再按 IDs 取 mappings／history；不以一個多 child join 產生 Cartesian rows。

### 7.4 `SalesOrderConfirmationService`

Phase A 詳見 §2.5。Phase B `completeConfirmation(eventId)`：

1. transaction lock Operation、Order、Lines；確認 operation hash、status、lease、Order status／event。
2. fresh actor：人工／CSV 使用原 initiating user，Channel 使用已註冊 service identity。已停用／撤權者不可繼續新確認。
3. 批量 provider lookup：Customer 一次、所有 SKU／UOM 一次、Warehouse 一次；不可每行 N+1。
4. 重算 factor、base quantity、money；與 Draft 內容不一致屬 provider change，使用最新有效資料及記錄 master difference，若已失效則回 Draft＋FAILED。
5. Customer credit `ON_HOLD` fail closed；Limit 只加 `CREDIT_LIMIT_ADVISORY` warning。
6. 建立 confirmation snapshot；按 `(skuId,lineId)` 排 demand。
7. 呼叫 Inventory batch contract；缺貨是正常 result，不 catch 成 error。
8. 每個 positive Reservation 建 mapping；每個 uncovered line 建／更新 Backorder entry。
9. 逐 line 設 Reserved／Backorder，驗數量 equation；更新 Header hasBackorder／count。
10. Append `CONFIRM` history／audit，Order `CONFIRMED`，Operation SUCCEEDED。

Inventory provider 回傳的 line set 必須與 request 完全相等且每行 `reserved + uncovered = ordered`；缺漏、重複或超量回 `INVENTORY_CONTRACT_MISMATCH`，整個 transaction rollback並 critical alert。

### 7.5 Inventory Sales batch contract algorithm

```text
assert one warehouse and unique sourceLineId
sort demands by warehouseId, skuId, sourceLineId
claim all inventory source operations in deterministic order
lock warehouse
upsert + lock stock controls by warehouseId, skuId
for each demand:
  recompute eligible ATP under lock using minimumSaleLifeDays
  reservable = min(orderedBaseQuantity, ATP)
  if reservable > 0:
    create exact full reservation(reservable)
    increment stock_control.reserved_quantity by reservable
  complete inventory operation with reserved/uncovered result
return results in sourceLineId order
```

同一 SKU 有多個 SO lines 的 Backorder batch，Inventory 按 Sales 已排序的 FIFO demands 依次扣同一 locked ATP。Generic Reservation API 的 all-or-none contract不變；此方法只服務已驗證 Sales demand。

### 7.6 `SalesOrderLifecycleService`

`withdrawConfirmation()`：

- 鎖 Order／Lines，狀態必須 Confirmed、Fulfilled 全 0、event/version 符合。
- 在任何 Reservation release 前呼叫 Fulfillment lifecycle guard；`OPEN`／`UNKNOWN` 均 fail closed。
- 呼叫 `releaseSalesBatchInTransaction()` 釋放所有 outstanding reservations；驗證每個 mapping result。
- Lines 回到 Draft semantics：Reserved／Backorder／Fulfilled／Cancelled 全 0；刪除 terminal Backorder queue rows及 mappings之前先保留 History／Audit summary。
- 清 confirmation snapshots中只在 confirm產生的 credit／warehouse display結果；Customer／SKU current Draft display重新取 provider。
- status `DRAFT`，confirmation_event_id 清空，version++，保存 reason／history。原 Inventory rows retained by Inventory Audit。

`cancel()`：Draft 直接 terminal；Confirmed 零 fulfilled 時先通過 Fulfillment lifecycle guard，再 release outstanding reservations、把 Reserved＋Backorder 移到 Cancelled，Backorder entry `CANCELLED`，status `CANCELLED`。

`closeRemaining()`：只限 `PARTIALLY_FULFILLED`；先通過 Fulfillment lifecycle guard，再釋放所有 outstanding reservations，把 Reserved＋Backorder 移到 Cancelled，保留 Fulfilled，status `CLOSED`。所有操作全有或全無；Inventory result 缺一筆便 rollback。

`applyFulfillmentResultInTransaction(transaction, { action: "SHIPMENT_REVERSED", ... })`：

- 只接受已驗證、未歸檔 Shipment、原 Issue references及Inventory Reservation restore results；Line／Reservation／Quantity集合必須完全匹配。
- 在同一 transaction減少 Fulfilled、減少Reservation mapping consumed並增加outstanding；不改 Ordered／Backorder／Cancelled。
- 重算 `COMPLETED`／`PARTIALLY_FULFILLED`／`CLOSED`：仍有Fulfilled則為 `PARTIALLY_FULFILLED`，否則為 `CONFIRMED`。
- Append-only寫入 `FULFILLMENT_REVERSE` history／audit及遞增version；相同event replay必須冪等。

### 7.7 `SalesBackorderService`

- `runBatch({scope,maxEntries,abortSignal})` 先取得 Scheduler global cluster lease `sales.backorder.allocate`，手動觸發只 wake／縮短 next run，不另開並行 allocator。
- 找出最早 `OPEN` scope，對每個 Warehouse＋SKU 最多取設定數量並在 transaction 重讀／鎖 FIFO rows。
- 跳過非 `CONFIRMED／PARTIALLY_FULFILLED`、已取消或 outstanding 已 0 的 stale entry，修正為 terminal並 warning Audit。
- 使用新的 system eventId，並在同一 allocation transaction 寫入 `last_allocation_event_id`；COMMIT未知後若 row已保存便查原 event結果，若整個 transaction rollback才可產生新 event。
- 成功 allocation 將 line Backorder 減少、Reserved 增加，插入 mapping；0 ATP 不改 business version，只延後 `next_attempt_at`。
- 一個 scope 用盡 ATP 立即停止；避免為同 SKU 對數千 entries做無意義 provider calls。
- 不提供 priority update API；`priority_at` immutable。

### 7.8 `SalesImportService` 與 `SalesIntakeService`

Precheck：

1. Upload route明確設定 `storageMode:"disk"`、單檔及單request 50 MB、單檔、CSV MIME allowlist。Middleware把 bytes直接寫入受管 request temp，同時計算 SHA-256、size及最多64 KiB prefix；成功後交給 Handler，Handler在建立 Job transaction後 atomic move至private job storage。任何前置失敗或請求中止都由framework cleanup。
2. Streaming CSV parser 驗 Header／UTF-8／limits；按連續或 hash group組合 Source Order。若同一 key 分散在檔案不同區段，仍以 bounded spool／DB rows合併，不要求整檔常駐 heap。
3. Normalize canonical order、計 payload hash、執行 pure schema validation；批量查 Customer／SKU／Warehouse mapping。
4. 每張來源訂單寫 Intake Order；errors最多200。Precheck不建 SO、External Key 或 Reservation。
5. Job `READY` 只表示檔案結構完成且有結果；可同時有 Invalid／Duplicate。

Confirm Worker：

- CAS Job `QUEUED→PROCESSING`、取得 lease；按 Intake ID keyset claim `VALID` rows。
- 每張 row 以一個 transaction完成：claim Domain Operation＋External Key → 建 Draft SO → 呼叫共用 `confirmDraftInTransaction()` → 更新為 Confirmed＋External Key Succeeded。
- Intake 不先 commit `CONFIRMING` SO；Business validation／Inventory dependency failure令整個 transaction rollback，因此不保留 SO、SO Lines、Reservation或External Key，Intake在另一個短 transaction記錄 `FAILED`或下一次 technical retry。
- COMMIT outcome unknown時先按 processingEventId／External Key查 server fact；證明沒有成功才以相同 event重試，不能直接建立另一張。
- Duplicate 讀 External Key routing，標記 `DUPLICATE`並連原 SO。
- Worker heartbeat更新 lease，不更新 SO business timestamp；Job terminal summary只由 child terminal states重算。

Channel `submit()` 先做 boundary schema／identity validation，durably insert Intake row並回 `ACCEPTED`。實際 SO creation走同一 Worker；不在 Adapter process內直接呼叫核心建單。

### 7.9 `SalesInquiryService` 與 `SalesExportService`

- Active／Archive SQL 是兩套明確 allowlist；每個 endpoint只查一套 tables。
- List 採 count＋page IDs＋detail projection，或先以 covering index取 IDs 再 join，避免 Lines join令 count倍增。
- `%term%` 只用於受限 Customer display search；Number／External ID先 exact hash。若未來模糊全文搜尋成為必要，再以量測結果決定 search service，不預先加入。
- Outstanding 以 status／hasBackorder及 EXISTS line quantity條件；SQL必須同 domain invariant contract test。
- Export Job保存 filter snapshot，worker按 `(sortKey,id)` keyset讀取、逐行寫 private temp CSV後 atomic rename；不放整份 rows於 heap。
- CSV formula prefix `= + - @ TAB CR` 前置單引號；所有 cell RFC 4180 escape。
- Job permission在建立時及真正開始時重驗。下載再做 owner／permission check並先寫 Audit。

### 7.10 `SalesArchiveService`

- Candidate scan使用 `(status,last_business_updated_at,id)` keyset，不以 OFFSET。
- 每月 Batch cutoff 在開始時固定；重跑不隨時間漂移。
- 下游 provider registry 必須列出已部署 providers及版本；required provider absent/unavailable使該 order skip `OPEN_MATTER_UNKNOWN`。
- Fulfillment 是 required provider及Archive Participant；Fulfillment已部署但participant缺失屬配置錯誤，該Order必須skip並告警。
- 每張 Order transaction按 §4.21 搬移；Batch只是總控，不把 500 張放同一 transaction。
- 使用共同 `archive_batch_id`及order manifest；任何copy、hash驗證或delete失敗均完整rollback，不得把父SO與Shipment分拆在Active／Archive兩側。
- Archive row hash使用固定 column order、normalized decimal strings、UTF-8 bytes；不包含 archive metadata。
- Job尊重 AbortSignal／timeout，在當前 order transaction結束後停止並保存 cursor。
- Archive完成後 Active search可透過 External Key／Conversion routing hint提示 Archive；routing更新與搬移同 transaction。

### 7.11 `SalesReconciliationService`

提供只讀 CLI／Service，不提供一般業務修復 API：

- Sales line `reserved_outstanding` 對 Inventory Reservation outstanding sum。
- Mapping original = consumed＋released＋outstanding。
- Order line current demand equation。
- Backorder entry outstanding 對 line backordered。
- Header hasBackorder／count 對 lines。
- External Key 對 Active或Archive唯一 SO number／ID。
- Archive manifest counts／hash對 Archive rows，且 Active不存在。

任何 mismatch 輸出 internal IDs、safe codes及 counts，不自動改數據。修復需獨立、經審批的 forward script及前後 reconciliation evidence。

---

## 8. 權限、安全與威脅模型

### 8.1 Permission Catalogue

| Permission | 後端能力 |
|---|---|
| `sales.view` | Active／Archive／Quotation／Import結果／Audit查詢及本人 Export。 |
| `sales.mgmt` | Quotation／人工 SO create、update、confirm、withdraw、cancel、close、manual backorder run。 |
| `sales.import` | CSV upload、confirm、cancel及 retry。 |

現有 authorization 沒有 permission inheritance：角色如要管理，必須同時配置 `sales.view + sales.mgmt`；Import Operator 必須配置 `sales.view + sales.import`。Write Handlers 使用 `view＋對應 write permission` policy，避免存在「能改但不能查看」的角色。

新增三項 permission需同步：`permissionCatalogue.js`、migration seed、handler policies及 permission convention tests。Scheduled system jobs使用固定 service identity，不加入可由角色分配的 `sales.archive` permission。

### 8.2 Authentication strength

- 一般建單、確認、withdraw、cancel、close及 import使用 `jwt`；Requirement沒有要求 password re-auth或 device signature。
- Export download仍以 `jwt`＋owner check；response no-store。
- Channel transport尚未選定，不得暫用公開 route／共用 static API key。首個 Adapter須完成 threat review。
- 每個寫入點在 transaction內 `assertActorFresh()`；只信任 token claims會造成撤權後仍可批量開單。

### 8.3 STRIDE 摘要

| 威脅 | 防護 |
|---|---|
| Spoofing | JWT／fresh actor；Channel identity由transport建立。 |
| Tampering | AJV strict schema、canonical hash、version CAS、parameterized SQL、Archive row hash。 |
| Repudiation | Domain event、status history、audit、source key、actor/service snapshot。 |
| Information disclosure | Projection allowlist、owner-safe job、no bank/address/credential、safe errors。 |
| Denial of service | Upload limits、page limits、rate limit、bounded workers、job leases、query range要求。 |
| Elevation of privilege | Handler policies、transaction fresh permission、service identity purpose allowlist。 |

### 8.4 Input、files、logs與資料保護

- CSV 不信任 filename／MIME；檢查 allowlisted extension／MIME、bounded prefix、嚴格 UTF-8／NUL／Header／CSV grammar、大小、路徑 traversal、symlink及 temp cleanup。CSV沒有可靠 magic signature，不得把 MIME 初篩描述成內容安全證明。
- CSV／Channel第三方 payload先 schema validate；instruction-like text只當資料，不可控制程式流程。
- Notes、reference、external ID、error value全部有長度上限；輸出由 Vue escaping，禁止 `v-html`。
- Logs只記 IDs、counts、duration、event／request／correlation IDs及 safe error code；不記完整 payload、notes、reason、Customer name或 Token。
- Audit 可保存業務 reason，但 projection按 permission；CSV file 90日、Export file 7日後由 job清理，structured Audit／Operation至少7年。
- Temp file在 success、validation failure、abort及 exception path均清理；process crash由 age-based orphan cleanup處理。

---

## 9. 具體程式碼架構與變更清單

### 9.1 修改既有檔案

| File | 變更 |
|---|---|
| `server/src/modules/authorization/permissionCatalogue.js` | 新增 `sales.view`、`sales.mgmt`、`sales.import`。 |
| `client/config/menu.js` | 新增 Sales menu group。 |
| `client/src/framework/http/errorMessages.js` | 新增 §5.12 可見錯誤繁中對照。 |
| `server/config/api.js` | 新增 global disk-upload concurrency／temporary-directory budget；既有 memory upload預設及10 MB限制不變。 |
| `server/config/scheduler.js` | 加具名 Sales Job overrides示例；實際 Job仍由 Service static jobs註冊。 |
| `server/scripts/checkCoverageFloors.js` | 把確認、生命週期、Backorder、Intake及Archive高風險 Services加入 per-file門檻。 |
| `server/src/framework/upload/normalizeUploadConfig.js` | 加 `storageMode:"memory"\|"disk"`，預設 `memory`；分開驗證 memory及disk budgets，disk route仍強制單檔／總檔案／request byte limits。 |
| `server/src/framework/upload/uploadMiddleware.js` | 保留現有 memory path；disk mode把 Busboy file stream直接 pipe到 request-scoped隨機 temp file（directory `0700`、file `0600`），同時累計 SHA-256、size及bounded prefix，不使用 client filename作路徑。 |
| `server/src/framework/upload/uploadConcurrencyGate.js` | 分開但同樣強制 memory／disk slots；disk滿載回503＋`Retry-After`，不得繞過全域 upload gate。 |
| `server/src/framework/upload/cleanupUploadedFiles.js` | 覆蓋 disk mode在auth/schema/handler/idempotency replay/abort/exception的清理；age-based orphan cleanup只刪受管 temp root內超齡檔案。 |
| `server/src/services/filetype/builtInFileTypes.js`、`FileTypeService.js` | 支援 disk-mode bounded-prefix validator；註冊 `text/csv`及`application/csv`的保守文字初篩，明確不宣稱CSV有magic signature。 |
| `server/src/modules/item/ItemLookupService.js` | 新增 §2.4 Sale lookup；不改採購／Inventory語意。 |
| `server/src/services/idempotency/IdempotencyService.js` | Upload fingerprint沿用 `contentHash` metadata並更新其「只在buffer計算」的過時註解；若前置模組尚未修正，統一所有authenticated JWT strategy identity scope，不可為Sales重複修第二套。 |
| Inventory module files（落地時） | 新增 §2.4 Sales batch reservation／release contract及consumer tests。 |
| Customer module files（落地時） | 確保 new_sale及credit provider contract符合已核准Customer設計。 |

除上述已確認的 Upload 缺口外，不修改 `BaseRequestHandler`、Handler Discovery、`HttpClient` envelope、`DataTable` 或 `FormPanel`。Disk mode必須是獨立 Phase 0提交及framework tests；若實作發現還要改其他 framework能力，先更新設計並取得確認。

### 9.2 新增 Backend config／domain files

```text
server/config/sales.js
server/src/modules/sales/
  salesConstants.js
  salesErrors.js
  salesSchemas.js
  salesValidation.js
  salesMoneyMath.js
  salesQuantityMath.js
  salesOrderStateMachine.js
  salesQuotationStateMachine.js
  salesProjections.js
  salesCsv.js
  salesCanonicalHash.js
  SalesSequenceService.js
  SalesOperationService.js
  SalesAuditService.js
  SalesQuotationService.js
  SalesOrderService.js
  SalesOrderConfirmationService.js
  SalesOrderLifecycleService.js
  SalesBackorderService.js
  SalesIntakeService.js
  SalesImportService.js
  SalesInquiryService.js
  SalesExportService.js
  SalesArchiveService.js
  SalesReconciliationService.js
```

`salesSchemas.js` 是 canonical domain payload validation，不取代 Handler AJV boundary schemas。純算法 files不可 import Database／Logger／Time。

背景工作由 framework lifecycle管理，另新增薄層 runtime：

```text
server/src/services/salesJobs/
  SalesJobRuntimeService.js
  jobs/
    SalesConfirmationRecoveryJob.js
    SalesBackorderAllocationJob.js
    SalesImportJob.js
    SalesExportJob.js
    SalesQuotationExpiryJob.js
    SalesArchiveJob.js
    SalesFileRetentionJob.js
```

Runtime只負責 service discovery、dependency injection、Scheduler registration及AbortSignal，業務規則仍委派 `modules/sales`。

### 9.3 新增 Handlers

```text
server/src/handlers/sales/
  salesSchemas.js
  listSalesOrdersHandler.js
  getSalesOrderHandler.js
  createSalesOrderHandler.js
  updateSalesOrderHandler.js
  confirmSalesOrderHandler.js
  salesOrderLifecycleHandlers.js
  salesLookupHandlers.js
  runSalesBackorderAllocationHandler.js
  salesOperationLookupHandler.js
  salesAuditHandler.js

server/src/handlers/outstanding-sales-orders/
  listOutstandingSalesOrdersHandler.js

server/src/handlers/sales-quotations/
  salesQuotationSchemas.js
  listSalesQuotationsHandler.js
  getSalesQuotationHandler.js
  createSalesQuotationHandler.js
  updateSalesQuotationHandler.js
  issueSalesQuotationHandler.js
  cancelSalesQuotationHandler.js
  convertSalesQuotationHandler.js

server/src/handlers/sales-imports/
  salesImportSchemas.js
  uploadSalesImportHandler.js
  listSalesImportsHandler.js
  getSalesImportHandler.js
  listSalesIntakeOrdersHandler.js
  listSalesIntakeErrorsHandler.js
  confirmSalesImportHandler.js
  cancelSalesImportHandler.js
  downloadSalesImportResultHandler.js

server/src/handlers/sales-import-templates/
  getCurrentSalesImportTemplateHandler.js

server/src/handlers/archived-sales-orders/
  salesArchiveSchemas.js
  listArchivedSalesOrdersHandler.js
  getArchivedSalesOrderHandler.js
  listArchivedSalesAuditHandler.js

server/src/handlers/sales-exports/
  salesExportSchemas.js
  createSalesExportHandler.js
  listSalesExportsHandler.js
  getSalesExportHandler.js
  downloadSalesExportHandler.js
```

相同 schema／auth且只有action不同的 lifecycle handlers可放一個 file，但每個 exported class仍有唯一 handlerName／static api。不同 permission或upload middleware不可用 body action switch。

### 9.4 新增 Frontend files

```text
client/src/services/sales.js
client/src/pages/sales/
  SalesOrdersPage.vue
  SalesOrderCreatePage.vue
  SalesOrderEditPage.vue
  SalesOrderDetailPage.vue
  OutstandingSalesOrdersPage.vue
  SalesQuotationsPage.vue
  SalesQuotationCreatePage.vue
  SalesQuotationEditPage.vue
  SalesQuotationDetailPage.vue
  SalesQuotationPrintPage.vue
  SalesImportsPage.vue
  SalesImportCreatePage.vue
  SalesImportDetailPage.vue
  SalesImportExceptionsPage.vue
  SalesArchivePage.vue
  SalesArchiveDetailPage.vue
  SalesExportJobsPage.vue
client/src/components/sales/
  SalesOrderForm.vue
  SalesOrderLineEditor.vue
  SalesOrderQuantitySummary.vue
  SalesOrderSourcePanel.vue
  SalesOrderStatusTimeline.vue
  SalesQuotationForm.vue
  QuotationDifferencePanel.vue
  SalesImportSummary.vue
  SalesImportErrorTable.vue
  BackorderAllocationDialog.vue
client/src/composables/sales/
  useSalesFilters.js
  useSalesCommandEvent.js
  useImportJobPolling.js
```

`useSalesCommandEvent` 為一次 user intent產生 UUID並在 timeout／202 polling期間保留；只有 server terminal outcome或使用者明確放棄並重新載入事實後才清除。不要長期放 localStorage或URL。

### 9.5 Migrations 及 test support

- 按 §4.22 建多支 migration，實作時取得連續可用號碼；不要預先假定 Supplier／Customer／Inventory／Purchasing 的未落地編號。
- 新增 `server/test-support/fakeSalesDatabase.js` 只覆蓋 unit service所需 SQL；FK、unique、trigger、lock及Archive move必須用真 MySQL。
- 新增／擴充 `server/test/framework/uploadMiddleware.test.js`、`normalizeUploadConfig.test.js`、`uploadConcurrencyGate.test.js`及`cleanupUploadedFiles.test.js`，覆蓋§10.3 disk-stream contract且保留全部memory-mode regression。
- 新增 Customer／Item／Inventory contract fakes；production code不可在 provider未完成時 fallback直讀表或回假 ATP。
- CSV fixtures只使用合成資料，不提交真 Customer／Channel資料。

---

## 10. Unit Test 設計

### 10.1 原則與門檻

- Server 使用 `node:test`；Client 使用 Vitest＋Vue Test Utils＋jsdom。
- 維持 Server global coverage：lines 92%、branches 83%、functions 90%；不可下調。
- 把 `SalesOrderConfirmationService.js`、`SalesOrderLifecycleService.js`、`SalesBackorderService.js`、`SalesIntakeService.js`、`SalesArchiveService.js` 加入 `checkCoverageFloors.js`，建議 lines 95%、branches 90%、functions 90%。
- Pure calculation／state machine tests不接 DB；Service unit tests使用明確 fake executor／provider。
- Fake DB tests只證明 Service call、SQL參數及 error mapping，不可代替真 constraint／transaction tests。
- 每個公開 Error Code至少有一條測試證明 HTTP status及 safe details。

### 10.2 Pure math／validation tests

#### `server/test/salesMoneyMath.test.js`

- Decimal string normalize、4位、rounding boundary、最大值、0 price。
- Quantity × Unit Price及多行 sum不經 floating point。
- 負數、exponent、NaN、Infinity、千分位及超 precision拒絕。
- Currency minor-unit display不改 DB 4位真值。

#### `server/test/salesQuantityMath.test.js`

- 6位 input quantity × integer factor成 exact positive Base integer。
- 非整數 base、0／負數、超 safe integer、factor越界拒絕。
- `ordered = fulfilled + reserved + backorder + cancelled` 全組合。
- Backorder→Reserved、Reserved→Fulfilled、Remaining→Cancelled轉移保持守恆。

#### `server/test/salesValidation.test.js`

- 合併前後1–100 lines、同SKU＋UOM且價格／備註相同的exact quantity merge、商業條件衝突、date order、field length、zero price warning。
- Suggested Price Currency相同才 default；不同幣不換算。
- Customer／SKU／Warehouse provider projection缺欄或失效 fail closed。
- Client送 snapshot／total／reserved／unknown field由 Handler schema拒絕。

#### State machines

- `salesOrderStateMachine.test.js` 覆蓋 §3.3 每條合法／非法 transition。
- `salesQuotationStateMachine.test.js` 覆蓋 effective expiry、issued immutable、one conversion。
- `salesImportStateMachine.test.js` 覆蓋 job／intake states、cancel windows及terminal states。

#### `salesCanonicalHash.test.js`

- Object key順序不同但語意相同得到相同 hash。
- Decimal／Unicode normalization規則固定。
- 同 event body不同 hash觸發 conflict。
- Password、request ID等 transport-only資料不進 business hash；真正業務欄位全部進 hash。

### 10.3 Service unit tests

#### `salesSequenceService.test.js`

- HKT month boundary、new row、increment、rollback、999999 exhausted、concurrent duplicate mapping。

#### `salesQuotationService.test.js`

- Create／update total、issue revalidation、expire、cancel reason。
- Convert exact copy、added／removed／quantity／price difference。
- 重複轉換 replay existing、different payload conflict、失敗不標 Converted。
- Quotation永不呼叫 Inventory。

#### `salesOrderService.test.js`

- Manual-only create、full Draft replace、version conflict、server snapshot／total。
- 非 Active Customer、non-sale SKU、invalid UOM／Warehouse、currency price behavior。
- Detail使用bounded child queries及具名 projection。

#### `salesOrderConfirmationService.test.js`

- Phase A claim、duplicate same hash replay、different hash conflict、existing CONFIRMING。
- Phase B full stock、partial stock、zero stock、多行混合、Customer On Hold。
- Provider revalidation批量且無 N+1；line set mismatch rollback。
- Inventory unavailable keeps CONFIRMING；business invalid returns Draft＋failed operation。
- Completion update line equation、mapping、queue、Header flags、history、audit同 transaction。
- Timeout／unknown outcome只回 operation status，不換 event。

#### `salesOrderLifecycleService.test.js`

- Draft cancel不呼叫 Inventory。
- Confirmed zero fulfilled withdraw／cancel batch release成功。
- Fulfillment lifecycle guard回 `OPEN`／`UNKNOWN` 時不呼叫release並拒絕操作。
- Release任一缺漏／失敗完整 rollback。
- Partially fulfilled不能withdraw／cancel，只可close remaining。
- Close保留 fulfilled、其餘轉 cancelled、queue terminal、數量守恆。
- Shipment Reversal重算 `COMPLETED`／`PARTIALLY_FULFILLED`／`CLOSED`，保留Cancelled並append history。
- Provider回傳Line／Reservation／Quantity集合不一致時整筆transaction rollback。
- 所有 command version／event／reason及replay。

#### `salesBackorderService.test.js`

- 跨 Orders FIFO固定 `priorityAt,orderId,lineNo`；不接受 priority input。
- 部分 ATP只配最早 rows、ATP用盡停止。
- 新 Reservation mapping、line quantities、queue terminal／remaining。
- 0 ATP非error；technical failure backoff；stale order清理。
- Global lease使scheduled／manual不重疊；crash同 event恢復。

#### Intake／Import tests

- `salesCsv.test.js`：BOM、CRLF、quotes、headers、grouping、same SKU＋UOM quantity merge／price-note conflict、limits、formula neutralization、stream chunks。
- `salesImportService.test.js`：precheck無SO effect、row errors、partial batch、job counts、file cleanup。
- `salesIntakeService.test.js`：atomic external key claim、success、duplicate、processing、hash collision、failed validation release key。
- Worker fresh permission、lease recovery、same processing event、success／failed／duplicate terminal mapping。
- Canonical channel union outcomes及untrusted service identity rejection。

#### Upload Framework regression tests

- 既有未指定 `storageMode` route仍走 `memory`，metadata、signature validation及錯誤碼不變。
- Disk mode以多個小 chunks寫入隨機 request temp，`req.files`只暴露受管 `path,storedName,size,mimeType,contentHash,originalName`及bounded prefix，不含完整 `buffer`。
- 50 MB路徑以heap instrumentation證明峰值不隨檔案線性增長；不得用測試只斷言「成功」取代memory bound。
- 宣告／未宣告 Content-Length的單檔、總檔案及request超限都立刻終止；partial file清除。
- Client abort、Busboy error、type rejection、schema/auth失敗、Handler throw及idempotency replay全部釋放slot並清temp file。
- Random stored name、`0600/0700`、path traversal filename、symlink replacement及temp-root containment。
- Memory與disk concurrency gate各自滿載、503／Retry-After、slot recovery及startup budget validation。
- CSV的MIME／extension／prefix初篩與Service層UTF-8、NUL、Header、grammar驗證分工有contract tests。

#### Inquiry／Export／Archive tests

- Active與Archive SQL不混用，sort allowlist，exact external hash routing。
- Export keyset、row cap、formula safety、abort cleanup、owner check。
- Archive eligibility所有 predicates；provider UNKNOWN skip。
- Copy/hash/delete order、existing identical Archive recovery、different hash conflict。
- Batch counters/cursor、one order failure不影響已commit order、AbortSignal。
- Reconciliation每個 mismatch category及no auto-fix。

### 10.4 Handler／Client service tests

- 每個 Handler metadata：method、path、auth、permissions、idempotency、request／response schemas。
- Route registry test證明 `/outstanding-sales-orders`、`/archived-sales-orders`及`/sales-import-templates/current`不會被任何 `/:id` route shadow；不得依賴檔名排序解決literal/parameter collision。
- 200／201／202／400／403／404／409／410／422／503及unknown transaction mapping。
- `client/test/services/sales.test.js` 驗 URL、params、body、explicit Idempotency-Key、list projection、AbortSignal。
- `useSalesCommandEvent.test.js` 驗 retry／202保留 UUID、terminal清除、new intent新 UUID。
- Polling composable驗頁面 hidden／unmount abort及backoff，不留 timer。

---

## 11. Integration、Frontend、安全及效能測試

### 11.1 真 MySQL Migration／Constraint Integration

- 空 DB 全 migration、重跑、從目前 main schema升級。
- 三 permission catalogue／seed一致，漏 seed時 startup fail。
- Document／source／event／conversion unique constraints實際阻擋 race。
- FK ownership、RESTRICT、CAS、quantity triggers、append-only／Archive immutable triggers。
- Decimal／BIGINT邊界及 mysql2 decimal string behavior。
- Migration分片失敗後重新執行；不留下半個 trigger／index。

### 11.2 API＋DB Integration

- 真 application＋HTTP＋DB完成 Quotation create→issue→convert→SO Draft。
- Manual SO create→confirm，驗 Sales tables及 Inventory reservations同時 commit。
- Partial／zero ATP確認成功且沒有 negative stock。
- Withdraw／cancel／close同時更新 Inventory及Sales；failure injection全部 rollback。
- CSV upload→precheck→confirm→worker→result download；一張invalid不影響其他。
- 50 MB CSV 經真 HTTP multipart驗 disk-stream metadata、SHA-256、atomic move及success/failure/abort cleanup，不出現完整內容 Buffer。
- Active／Outstanding／Archive list pagination、filters、permissions及response schema。
- Framework HTTP idempotency expiry後，Domain Operation／External Key仍防重。

### 11.3 真併發及 crash／unknown outcome

- 20–100個 concurrent SO競爭同 Warehouse＋SKU，總 Reserved不超 ATP。
- 同一 event、同一 external key、同一 Quotation conversion多連線競爭只有一個 winner。
- Confirm與Withdraw、Fulfillment Confirm／Reversal、Archive candidate同時執行，lock order不死鎖；可重試衝突不丟資料。
- 在 Phase A後、Inventory effect中、Phase B commit前、commit response後注入 crash，Recovery只完成一次。
- Backorder job與新確認、Inventory Receipt、manual run並行仍保持 FIFO及quantity invariant。
- Archive搬移中斷、connection drop、commit outcome unknown後安全重跑。

### 11.4 Provider／consumer contract tests

- Customer `new_sale` projection、Credit On Hold／Not Configured／Normal。
- Item saleability、Sales UOM factor、barcode、effective date、Suggested Price Currency。
- Inventory Sales batch request排序、line completeness、reserved／uncovered equation、source event idempotency。
- Fulfillment future contract fixture證明 consumer需先鎖Sales再呼叫Inventory。
- Channel V1 schema backward compatibility；新增 optional fields不破壞 existing fixture。
- Open-matter provider false／true／unknown，unknown永不容許 Archive。

### 11.5 Vue page／component tests

- Route discovery、menu permission、guard、deep-link forbidden。
- Sales Order List filters→URL、server pagination、sticky actions、Archive hint。
- Order／Quotation Form add/remove lines、currency behavior、totals、100-line guard、server field errors。
- Confirmation 200／202／timeout／operation terminal、duplicate click disabled、Backorder warning。
- Detail allowedActions、withdraw／cancel／close dialog及state refresh。
- Import upload/precheck/progress/error/result；polling stop/resume。
- Archive empty-filter guard、read-only detail、Export Job owner download。
- 375／768／1024／1440 layout snapshots或DOM assertions；heading、focus、aria-live、badge text、keyboard flow。

### 11.6 Security tests

- Missing／invalid JWT、view without write、mgmt without view、import without view、stale permission。
- IDOR：Order、Quotation、Import child、Export owner、Archive detail。
- SQL wildcard／sort injection、XSS notes、CSV injection、path traversal、symlink、MIME spoof、oversized／slow upload。
- Channel identity spoof、same idempotency different payload、external hash collision simulated。
- Error／Log／Audit projection不含 Token、Password、bank、address、raw file、SQL或stack。
- Rate limit及upload concurrency gate在大批量仍生效。

### 11.7 Performance and capacity

建立可重現 generator，不提交生成資料：

| Dataset／Scenario | 目標 |
|---|---|
| 730萬 Active headers、平均5 lines、P95 20、少量100 | Active常用／exact query P95 ≤2s。 |
| 10,000 orders／50,000 lines CSV | end-to-end ≤30 min；50 MB multipart＋parse期間heap增量由Phase 0基線門檻限制，結果須證明不隨檔案大小線性增長。 |
| 50 interactive users＋background import／backorder | Confirm P95 ≤3s，無pool starvation。 |
| Archive exact number | P95 ≤3s。 |
| Archive Customer＋最多366日 range | P95 ≤5s。 |
| Monthly 300,000 candidate orders，500 per run | 不出現超 transaction timeout長鎖；新order latency維持門檻。 |
| External key 2,500萬 rows | exact dedupe及routing使用unique/hash index。 |

測試報告記錄 hardware、Node/MySQL版本、pool size、buffer pool、資料分佈、warm/cold cache及 explain plan。不能只以空 DB或全部相同一行訂單宣稱達標。

### 11.8 Backup、Restore、Archive及 reconciliation

- 備份 Active＋Archive＋External Keys＋Operations；在隔離 DB restore。
- 隨機抽樣按 Number／Customer／External ID查回，驗 row hashes、line totals及status history。
- Restore後重跑 Domain event／external source不重複開單。
- Archive Batch report對搬移前後 counts／amounts／hashes。
- 模擬 Archive tables不可寫時 Active資料保持完整，日常建單仍可用。

---

## 12. Configuration、Jobs、Logging 與營運

### 12.1 `server/config/sales.js`

```js
const salesConfig = {
  maxDocumentLines: 100,
  quantityDecimalPlaces: 6,
  moneyDecimalPlaces: 4,
  documentSequenceMax: 999999,
  manualConfirmationWaitMs: 2500,
  confirmationLeaseMs: 60000,
  confirmationRecoveryBatchSize: 50,
  importMaxBytes: 50 * 1024 * 1024,
  importMaxRows: 100000,
  importMaxOrders: 10000,
  importWorkerBatchSize: 50,
  importFileRetentionDays: 90,
  intakePayloadRetentionDays: 90,
  backorderBatchSize: 500,
  backorderNoStockRetryMs: 300000,
  archiveAfterMonths: 24,
  archiveDayOfMonth: 2,
  archiveHourHkt: 2,
  archiveBatchSize: 500,
  archiveQueryMaxRangeDays: 366,
  exportMaxRows: 250000,
  exportFileRetentionDays: 7,
  auditDetailMaxBytes: 16384,
  transactionTimeoutMs: 30000
};
```

`maxDocumentLines`、money／quantity scale、sequence max、24 months及不自動purge是 domain constants，變更需 requirement／design review；其他 deployment tuning由 startup normalizer驗正整數、合理上下限、timeout及retention關係。`manualConfirmationWaitMs` 必須小於 HTTP processing timeout。

Upload的process-wide設定留在 `server/config/api.js`，不複製到Sales config：

```js
upload: {
  maxConcurrentUploads: 10,
  maxUploadMemoryBytes: 256 * 1024 * 1024,
  maxConcurrentDiskUploads: 4,
  maxDiskUploadBytesInFlight: 200 * 1024 * 1024,
  diskTempDirectory: "storage/uploads/tmp",
  diskOrphanMaxAgeSeconds: 3600
}
```

Startup按所有已註冊disk routes的最大request bytes驗證 slot乘積不超 `maxDiskUploadBytesInFlight`；temp root必須是非symlink、可寫且realpath位於server受管storage內。設定值是部署起點，不是容量承諾；Phase 0以實測memory、disk及concurrency結果調整，但不得降低50 MB單檔業務上限。

### 12.2 Scheduler jobs

| Job name | Scope／Interval | 行為 |
|---|---|---|
| `sales.confirmationRecovery` | cluster／30秒 | 恢復 expired CONFIRMING leases。 |
| `sales.importWorker` | cluster／2秒 | bounded Intake work。 |
| `sales.exportWorker` | cluster／5秒 | Export Jobs。 |
| `sales.backorderAllocate` | cluster／5分鐘 | FIFO補配；wake-up只縮短等待。 |
| `sales.quotationExpire` | cluster／1小時 | 固化 effective expired status。 |
| `sales.archive` | cluster／15分鐘 | 每次檢查 HKT day/hour及本月是否已有Batch；真正每月只開始一次。 |
| `sales.fileRetention` | cluster／24小時 | 清除到期 import/export files及 intake payload。 |

現有 Scheduler只支援 interval，不假裝有 cron。Archive Job以 interval醒來後，使用 HKT window＋`sales_archive_batches` monthly unique business key判斷是否執行；多 instance由cluster lease及unique row雙重防護。所有 Job尊重 AbortSignal、publish stats、不得吞掉錯誤。

Business rules仍在 `modules/sales`；為取得 framework lifecycle，新增薄層 `server/src/services/salesJobs/SalesJobRuntimeService.js` 及 `jobs/*.js`，只負責注入、scheduler registration、AbortSignal及呼叫 domain Service，不在 technical service重寫商業規則。

### 12.3 Audit action allowlist

```text
sales_quotation.created / updated / issued / expired / cancelled / converted
sales_order.created / updated / confirmation_started / confirmed
sales_order.confirmation_failed / confirmation_recovered
sales_order.withdrawn / cancelled / partially_fulfilled / completed / remaining_closed
sales_order.backorder_created / backorder_allocated
sales_import.uploaded / prechecked / confirmed / completed / cancelled
sales_intake.succeeded / failed / duplicate / conflict
sales_export.created / completed / downloaded / expired
sales_archive.started / order_archived / order_skipped / completed / failed
sales_reconciliation.mismatch
```

每個 action用固定 builder；大 line集合保存 count、ID sample及 hash，不保存完整 request／CSV。Audit寫入若是核心 business transaction的一部分，失敗須 rollback；純失敗觀測可用 structured log補足但不冒充成功 Audit。

### 12.4 Structured logs／metrics／alerts

Logs：event name、requestId、correlationId、eventId、internal IDs、job／batch ID、duration、outcome、safe error code。External ID只記不可逆短 hash，不記原值。

Metrics：

- SO／Quotation create、confirm、convert outcome及duration。
- Reservation requested／reserved／backordered base counts；Backorder open count／age／allocation latency。
- Intake accepted／success／invalid／duplicate／retry、queue depth及oldest age。
- Confirmation recovery count／age、transaction unknown、deadlock、provider mismatch。
- Active／Archive query duration、rows scanned、Export queue／rows。
- Archive candidates／archived／skipped／failed、order duration及lock wait。
- Reconciliation mismatch必須為0。

Labels不得使用 SO Number、External ID、Customer、SKU、User或Reason等高基數／敏感值。

Alerts：

- CONFIRMING oldest age >5分鐘或 recovery連續失敗。
- Intake queue oldest age >10分鐘，或10,000張標準 batch >30分鐘。
- Domain／Inventory contract mismatch、external hash collision、transaction outcome unknown。
- Backorder Job 24小時未成功執行，或存在庫存但最早 Backorder長期未配。
- Archive 本月窗口後24小時仍未完成、hash conflict、provider unknown持續。
- Active query P95／DB pool wait持續超門檻。

### 12.5 File、data retention 與 runbooks

- Import source／result files 90日；Intake normalized payload 90日；結構化 source result及External Key至少7年。
- Export file 7日，Job／Audit至少7年。
- Active finalized SO滿24月且合資格才Archive；Archive第一階段無 purge。
- Sales Archive與Fulfillment participant在同一transaction copy／hash／delete；任一provider `UNKNOWN`、count／hash差異或中斷均不分拆父子資料。
- Runbooks：Confirmation Recovery、Stuck Import、Backorder Reconciliation、Archive Failure、Archive Hash Conflict、External Duplicate Dispute、Restore Validation。
- 所有修復先執行 read-only reconciliation；禁止直接 SQL修改數量或刪 source key。

---

## 13. 分階段實作、部署與回滾

### Phase 0 — Upload foundation、Provider及DB foundation

目標：先加入向後兼容的 opt-in disk-stream Upload mode及安全清理，再完成Permissions、Sales config、migration foundation、Customer／Item sale contracts、Inventory Sales batch contract、operation/idempotency修正及容量 generator。Disk mode未通過framework regression及memory-bound測試前，不可啟用 Sales CSV 50 MB route。

獨立驗證：Upload memory/disk compatibility、50 MB memory bound、abort/cleanup/security/concurrency tests、Provider contract tests、migration tests、Inventory concurrency及Idempotency identity scope。

### Phase 1 — Quotation及人工 Draft SO

目標：Quotation create／issue／cancel／convert、Manual SO create／update、money／quantity／snapshot、Active list及detail。

獨立驗證：Quotation-to-Draft UAT、價格／幣別、版本衝突、權限及UI accessibility。

### Phase 2 — Confirmation、Reservation及Backorder lifecycle

目標：durable CONFIRMING、同步確認、Inventory Reservation、Backorder FIFO、withdraw／cancel／close及recovery。

獨立驗證：真DB transaction、庫存競爭、crash injection、數量守恆、release rollback及50-user performance。

### Phase 3 — CSV及Channel intake boundary

目標：CSV V1、precheck、background worker、exception、External Key dedupe、canonical Channel contract。

獨立驗證：10,000張 batch、partial batch、duplicate storm、worker crash、file security及contract compatibility。

### Phase 4 — Inquiry、Export、Archive及release evidence

目標：Outstanding／Audit／Export、Active／Archive分離、每月Archive、reconciliation、metrics、alerts及runbooks。

獨立驗證：730萬 Active、2,500萬 source keys、monthly archive、restore、Archive query及完整 regression。

### 13.1 部署順序

1. 部署 provider-compatible migrations／code，先不上 Sales menu及jobs。
2. 執行 Sales migrations，驗 permission catalogue、FK、indexes、triggers。
3. 部署 backend Services／Handlers，Scheduler Sales jobs先 disabled。
4. 部署 frontend，按 Phase capability開 menu／route。
5. 啟用 confirmation recovery，再啟用 import／backorder；監察一個完整業務週期。
6. 以 production-like copy完成 archive dry-run及校驗後，才啟用 monthly archive。
7. 保留上一版本 application artifact及 forward migration方案。

### 13.2 Rollback

- Application可回上一版，但已確認 SO、Reservation、External Key、Operation及Archive資料不能刪除。
- 新 tables在尚未有資料時可回退；有正式資料後只 forward-fix。
- 停用 Job不等於刪除 queue；重啟後必須沿用原 event／lease續跑。
- 如果 Phase B有問題，先停止新 Confirmation入口／worker，保留 Inquiry及Operation lookup，執行 reconciliation後修復。
- Archive出現差異即停 Job；Active未刪者保持使用，已commit Archive不得搬回Active作普通rollback，需經受控restore plan。

### 13.3 Release evidence

- 所有 quality commands結果、真MySQL integration、performance report、security test、migration rehearsal。
- Capability對應驗收案例及缺陷狀態。
- Reconciliation零 mismatch、Archive dry-run counts／hash、backup restore evidence。
- Metrics dashboards／alerts及runbook owner。

---

## 14. 需求追溯矩陣

### 14.1 Business objectives／Capabilities

| Requirement | Design |
|---|---|
| KPI-01／SO-CAP-01 | §1.1、§2、§3、§4.8–4.13、§7.2–7.6 |
| KPI-02／SO-CAP-03 | §2.7、§4.7、§4.14–4.16、§5.7–5.9、§7.8 |
| KPI-03／SO-CAP-03 | §2.5、§7.8、§11.2–11.3 |
| KPI-04／SO-CAP-04 | §2.4–2.6、§3.6、§4.9–4.11、§7.4–7.7 |
| KPI-05／SO-CAP-03 | §5.7–5.9、§7.8、§12.2 |
| KPI-06／SO-CAP-03 | §4.15–4.16、§6.6、§10.3 |
| KPI-07／SO-CAP-05 | §4 indexes、§5.10–5.11、§7.9、§11.7 |
| KPI-08／SO-CAP-06 | §3.7、§4.19–4.21、§7.10、§11.8 |
| KPI-09／SO-CAP-05 | §4.12／4.18、§5.10、§12.3 |

### 14.2 Functional Requirements

| Requirement range | Design sections |
|---|---|
| FR-QUOTE-001–017 | §3.2、§4.4–4.6、§5.2、§6.5、§7.2、§10.3 |
| FR-SO-001–024 | §3.3／3.5、§4.8–4.9、§5.3–5.6、§6.2–6.4、§7.3 |
| FR-CONF-001–020 | §2.4–2.5／2.8、§3.6、§4.10–4.13、§5.5、§7.4–7.5 |
| FR-LIFE-001–014 | §3.3／3.6、§5.3／5.5、§6.4、§7.6 |
| FR-CSV-001–020 | §3.4、§4.14–4.16、§5.7–5.8、§6.6、§7.8 |
| FR-CH-001–013 | §2.4／2.7、§4.7／4.15、§5.9、§7.8、§8 |
| FR-INQ-001–012 | §4 indexes／4.17–4.18、§5.10–5.11、§6.2／6.4／6.7、§7.9 |
| FR-ARC-001–020 | §3.7、§4.19–4.22、§5.10、§6.7、§7.10–7.11、§12.2／12.5 |

### 14.3 Business Rules、Security、NFR及Decisions

| Range | Design |
|---|---|
| BR-001–018 | §3.2–3.5、§4.3–4.9、§5.2–5.6、§7.1–7.3 |
| BR-019–027 | §2.4–2.6、§3.6、§4.9–4.11、§7.4–7.7 |
| BR-028–035 | §2.7、§4.7／4.14–4.16、§5.7–5.9、§7.8 |
| BR-036–040 | §3.2、§4.6、§5.2、§7.2 |
| BR-041–048 | §3.7、§4.19–4.21、§7.10–7.11、§12.5 |
| Permission／Security | §5 auth、§6 routes、§8、§10.4、§11.6 |
| NFR-PERF-001–008 | §4 indexes、§7.9–7.10、§11.7、§12.1–12.4 |
| SAD-001–010 | §0.2、§2、§4、§7、§12 |

### 14.4 Acceptance Criteria execution mapping

| Requirement AC | Primary verification |
|---|---|
| AC 1–7 | Quotation unit／API／Vue／browser print tests。 |
| AC 8–14 | Draft SO API、price／currency、version、snapshot tests。 |
| AC 15–24 | Inventory integration、concurrency、lifecycle、quantity reconciliation。 |
| AC 25–33 | CSV parser、upload、worker、10,000-order capacity及result tests。 |
| AC 34–38 | Canonical Channel contract、identity、dedupe及compatibility tests。 |
| AC 39–43 | Permission matrix、IDOR、Audit、Export security tests。 |
| AC 44–53 | 730萬 dataset、Archive eligibility／move／recovery／query／restore tests。 |

---

## 15. 評審門檻與剩餘上線輸入

### 15.1 可拆 Tasks 前必須確認

- Customer、Item、Inventory 已核准 internal contract名稱及 lock order，特別是 Sales batch Reservation。
- `CONFIRMING` two-phase durable workflow及 Recovery Job的複雜度獲技術評審接受；不可在實作時靜默改回無恢復的單次HTTP流程。
- Database table、Active／Archive separation、External Key不搬移及 Archive immutable trigger獲 DBA／Engineering評審。
- API 200／202、eventId、operation lookup、CSV V1及no public Channel route獲 Frontend／Integration評審。
- §11.7測試資料量、硬件基線及測試時限有可執行方案。

### 15.2 不阻擋核心開發、但阻擋相關整合／Go-Live

| Input | 阻擋範圍 |
|---|---|
| 真實平均／P95 order line分佈及尖峰每分鐘訂單量 | Performance sign-off。 |
| 初始 Channel Code及CSV映射資料 | CSV go-live。 |
| 首個平台 transport auth及地址交付 Fulfillment方式 | Platform Adapter go-live。 |
| Archive實際執行日／窗口及Operations owner | Archive job enable。 |
| 法規確認7年起算及是否更長 | Future purge；不阻擋no-purge Archive。 |
| Fulfillment／Invoice／Return open-matter providers | 對應下游上線後的Archive eligibility。 |

### 15.3 規格變更控制

- 新價格規則、Tax、Approval、Address、Cross-warehouse、平台專屬欄位或Archive purge均是 scope change，先改 Requirement。
- API field移除／改型別、enum語意改變、CSV header變更必須 version及migration，不就地破壞 V1。
- Inventory batch contract是 provider public internal interface；實作後新增 optional fields優先，不複製 V2 service。
- 任一效能指標不能以縮小資料集、取消Archive查詢或skip test方式降低；如需改門檻須有量測證據及明確核准。

# Purchasing & Receiving Management 系統設計規格（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 模組 | Purchasing & Receiving Management |
| 文件類型 | 可執行系統設計規格 |
| 版本 | 0.2 Approved Planning Baseline |
| 日期 | 2026-09-08 |
| 需求來源 | `docs/purchasing_receiving_management/01_requirement_spec.md` 0.2 |
| UI／UX基準 | `docs/frontend-design.md` |
| 目標技術棧 | Node.js ESM、Express 5、AJV、MySQL 8.0、Vue 3、Quasar 2 |
| 實作狀態 | 本文件只定義設計；尚未實作、測試、提交或部署 |
| 文件狀態 | ERP Product Owner（Sam）已批准為 planning baseline；尚未授權進入 IMPLEMENT |

### 0.1 文件目的

本文件把業務需求轉成可直接拆解開發任務的前端、後端、API、資料庫、權限、交易、併發、冪等、測試及部署設計。它不改變需求書的業務範圍；如本文件與已批准的業務需求衝突，以需求書及其後明確確認的決策為準，先更新規格再開發。

### 0.2 本輪已確認並關閉的需求 Gate

以下五項決策已由ERP Product Owner（Sam）於Harness 2.0對齊時正式批准，並已回寫`01_requirement_spec.md`的BR-038、BR-039及§18.3。

| Gate | 最終設計決策 | 實作影響 |
| --- | --- | --- |
| OPEN-001 | Confirmed PO的Supplier後來變成`blocked`仍可收貨，但GR所有details只可為`QUARANTINED`，並強制輸入原因。 | Receiving policy不可把Blocked當一般Active，也不可硬性拒收。 |
| OPEN-002 | 只要Confirmed PO仍有可收數量，SKU後來變成Inactive、Discontinued、Archived，或其採購／庫存旗標改變，仍可收貨；顯示警告並要求每個受影響PO Line輸入原因。 | 使用PO確認快照履行既有承諾；不可放寬新PO資格。Expired、位置、Lot衝突及其他安全規則仍照常阻擋。 |
| OPEN-003 | Unit Price最多4位小數；Line Amount按Currency小數位以`ROUND_HALF_UP`計算，PO Total為已round的Line Amount加總；GR只保存PO價格快照，不改價。 | 金額在API使用decimal string，在程式使用整數縮放／BigInt，不使用binary float。 |
| OPEN-004 | PO為`PO-YYYYMM-000001`，GR為`GR-YYYYMM-000001`；各文件類型每月重置，首次保存Draft時產生，取消後亦不可重用。 | 需要transaction-safe monthly sequence table。 |
| OPEN-005 | 本期只有A4 browser print；使用者可用瀏覽器另存PDF。系統不產生或保存PDF artifact。 | 不新增PDF library、檔案表、電郵或範本引擎。 |

OPEN-006屬上線資料及責任人輸入，不阻擋核心設計或開發，但阻擋正式Go-Live。

### 0.3 核心架構決策

1. Purchasing與Receiving是同一個monolith domain module，使用同一MySQL schema及transaction，不拆微服務。
2. PO、Approval、GR、Receipt Reversal各自有清楚aggregate root；跨aggregate命令由具名application service協調。
3. GR Confirm及Receipt Reversal必須與Inventory Movement、Balance、PO progress及必要Audit共用同一`withTransaction()`。
4. 新PO資格使用Supplier／Item目前狀態；既有Confirmed PO收貨使用不可變PO快照履行承諾，並把目前主資料差異轉成明確warning＋reason。
5. State-changing API沿用專案POST command風格、framework idempotency及永久domain operation記錄；同一event不同payload回409。
6. PO／GR顯示編號只是人類識別；所有FK、owner檢查及整合使用不可重用內部ID。
7. Mutable Draft使用optimistic version；Confirmed交易歷史採append-only記錄及受限狀態projection，不提供一般edit／delete。
8. 所有頁面與元件必須依`docs/frontend-design.md`實作，不建立第二套UI pattern。

### 0.4 明確不做

- 不設Purchase Requisition、RFQ、報價比較、合約價格表或自動供應商選擇。
- 不設Tax、Discount、Freight、Landed Cost、匯率、AP、Invoice matching、Payment或會計分錄。
- 不設無PO收貨、合併多PO收貨、部分確認一張GR、盲收、序號追蹤或質檢workflow。
- 不設Supplier Return；Receipt Reversal只更正錯誤收貨，不代表把貨退回Supplier。
- 不設多層／按金額審批、代理審批、外部通知、EDI或Supplier Portal。
- 不設服務端PDF、附件、電郵寄送、自訂列印範本、Dashboard或報表設計器。

---

## 1. 成功條件、Capability Map與工程邊界

### 1.1 可驗證成功條件

- 可建立一張含1～100 Lines的Draft PO，保存唯一月度編號、精確UOM／金額及server version，且不影響Inventory。
- 審批關閉時合法Draft可直接Confirmed；審批開啟時只有另一名指定且仍有權的使用者可批准。
- 一張PO可由多張GR分批收貨；一個PO Line可拆到多Lot／Warehouse／Bin／Status details。
- 一張最多200 details的GR只會整張成功或整張失敗；成功後PO progress、Inventory Movements與Audit可雙向追溯。
- 同一event重送不會重複建單、審批、入庫或反向；相同event搭配不同payload會被拒絕。
- 兩張GR同時收同一PO Line不會lost update；提交次序決定哪一張構成超收及必填原因。
- 已確認GR不可直接修改或刪除；合法部分／全部Reversal建立新反向Movement並重新計算PO progress。
- `purchasing.view`只能查詢／匯出；每個命令均在route及transaction提交點重新驗證actor與permission。
- PO／GR列表、CSV、A4列印、Audit及Inventory來源使用相同數量、金額、狀態與時間語意。
- 常用列表及精確查找在需求容量與20名並行使用者下p95少於2秒。

### 1.2 Capability Map

| Capability ID | 技術責任 | 主要提供者 | 依賴 |
| --- | --- | --- | --- |
| PUR-CAP-01 | PO Draft、lines、金額、編號、快照、列表與詳情 | `PurchaseOrderService` | Supplier、Item、Currency、User |
| PUR-CAP-02 | Settings、提交、指定審批、批准／拒絕／撤回 | `PurchasingSettingsService`、`PurchaseApprovalService` | PUR-CAP-01、Authorization |
| PUR-CAP-03 | Confirm、取消、撤回確認、Close Remaining、狀態推導 | `PurchaseOrderLifecycleService` | PUR-CAP-01／02 |
| PUR-CAP-04 | GR Draft、receipt lines／details、掃碼與版本 | `GoodsReceiptService` | PUR-CAP-03、Supplier、Item、Inventory master |
| PUR-CAP-05 | UOM、Tracking、Lot、Expiry、Location、超收及例外 | `ReceivingPolicyService` | PUR-CAP-04、Item、Inventory |
| PUR-CAP-06 | 批次Inventory posting、冪等、Reversal與對賬 | `GoodsReceiptPostingService`、`ReceiptReversalService` | PUR-CAP-05、Inventory、Audit |
| PUR-CAP-07 | 列表、Outstanding、CSV、print projection及Audit | `PurchasingInquiryService` | PUR-CAP-01～06 |

建置順序固定為：`PUR-CAP-01 → PUR-CAP-02／03 → PUR-CAP-04／05 → PUR-CAP-06 → PUR-CAP-07`。每個Capability可分階段交付，但不可暴露會造成不完整業務結果的入口。

### 1.3 現有專案約束

- Backend handler繼承`BaseRequestHandler`，以靜態`api`宣告method、path、auth、permission、AJV schemas及idempotency，由handler discovery自動註冊。
- API base path為`/api/v1`；查詢用GET，業務命令用POST，不另加router或GraphQL。
- Service使用JavaScript ESM、constructor injection及`MySqlDatabaseService.withTransaction()`。
- 權限正本是`server/src/modules/authorization/permissionCatalogue.js`；migration只同步資料庫投影。
- Actor freshness沿用`assertActorFresh()`；JWT claim不是提交時權限正本。
- Frontend page及service由`import.meta.glob`發現；page metadata定義route、menu與permission。
- 前端使用Vue 3＋Quasar 2、`PageHeader`、`DataTable`、`FormPanel`、`EllipsisCell`、confirm helpers及notify。
- 測試使用Node built-in test runner及Vitest，不新增測試框架或runtime dependency。
- Migration runner按檔名排序，MySQL DDL implicit commit；實作前須fetch最新main並配置當時下一個可用連續序號。
- 目前Item已部分落地；Supplier及Inventory設計已完成但未完全實作。本模組不可假設未存在的table／service已可呼叫。

### 1.4 開發與驗證命令

```bash
# 只在獨立worktree執行
npm install
npm run lint
npm test --workspace server
npm test --workspace client
npm run test:coverage
npm run build --workspace client
npm run security:audit

# 真MySQL integration只可使用專用測試資料庫
npm run migrate --workspace server
node --test --import ./server/test-support/testEnv.js server/test/integration/purchasing*.integration.test.js
node --test --import ./server/test-support/testEnv.js server/test/integration/receiving*.integration.test.js
```

### 1.5 Code style

沿用兩空格縮排、double quotes、semicolon、具名service及參數化SQL。Handler只做邊界工作；transaction及業務規則留在service：

```js
export class GoodsReceiptPostingService {
  constructor({ database, inventoryPosting, itemLookup, supplierLookup, audit, time }) {
    this.database = database;
    this.inventoryPosting = inventoryPosting;
    this.itemLookup = itemLookup;
    this.supplierLookup = supplierLookup;
    this.audit = audit;
    this.time = time;
  }

  confirm(command) {
    return this.database.withTransaction((transaction) =>
      this.confirmInTransaction(transaction, command)
    );
  }
}
```

不得建立接收table name、status或permission name的generic CRUD service；具名方法讓狀態、權限及Audit可被靜態檢查與測試。

### 1.6 三層工程邊界

#### Always do

- API schema設`additionalProperties:false`、長度／enum／數值上限，response用projection allowlist。
- 所有寫入route驗權，service在transaction內重讀actor、PO／GR狀態、version及provider資料。
- Money以decimal string進出API；Base Quantity為正整數且不超`Number.MAX_SAFE_INTEGER`及config上限。
- 收貨／反向使用固定lock order、domain operation claim、Inventory batch contract及必要Audit。
- 使用內部ID＋owner ID查child；owner不符與不存在均回404，避免水平越權洩漏。
- 所有SQL參數化；sort、status、action與column只從server allowlist選擇。

#### Ask first

- 新增runtime dependency、外部服務、background queue、檔案儲存、CI變更或新認證流程。
- 改變PO／GR狀態機、允許無PO收貨、改變超收政策或增加Stock Status。
- 改變Item Tracking／UOM語意、Inventory lock protocol、負庫存或Reversal不變量。
- 把目前browser print改成server-side PDF artifact。

#### Never do

- 直接改`inventory_stock_balances`、已確認Receipt Detail、Inventory Movement或Approval snapshot。
- 用PO／GR Number、Supplier Code、SKU Code取代FK或owner-safe內部ID。
- 信任client計算的Total、Outstanding、Over-received、Tracking Policy、permission或Inventory result。
- 把password、token、完整payload、SQL、stack、Supplier銀行資料或內部路徑寫入log、audit、URL或CSV。
- 為了讓測試通過而跳過失敗測試、降低coverage、加入`eslint-disable`或繞過交易。

---

## 2. 整體架構

### 2.1 元件與依賴關係

```text
Vue／Quasar pages
  ├─ Purchase Orders／Approvals／Outstanding／Print
  └─ Goods Receipts／Receipt Draft／Reversal／Settings
                 │
                 ▼
        /api/v1 REST handlers
  (AJV + auth + permission + HTTP idempotency)
                 │
                 ▼
 Purchasing & Receiving application services
  ├─ PurchaseOrderService / Lifecycle / Approval / Settings
  ├─ GoodsReceiptService / ReceivingPolicyService
  ├─ GoodsReceiptPostingService / ReceiptReversalService
  ├─ PurchasingInquiryService / Sequence / Operation / Audit
  │
  ├── SupplierLookupService / SupplierRelationService
  ├── ItemLookupService
  ├── InventoryLookupService
  └── InventoryPostingService batch internal contracts
                 │
                 ▼
 MySqlDatabaseService.withTransaction()
  ├─ purchasing current state + immutable history
  └─ inventory operations + movements + balances + audit
```

Supplier、Item與Inventory是provider modules；Purchasing不得複製它們的主資料資格或直接寫其tables。反過來，provider只暴露目的限定的internal contracts，不認識Purchasing頁面角色。

### 2.2 後端分層與Service責任

| Service | 責任 |
| --- | --- |
| `PurchaseOrderService` | PO list/get/create/update/copy、完整Draft replace、快照及金額計算。 |
| `PurchaseOrderLifecycleService` | 直接Confirm、Confirmed withdraw、cancel、close remaining及PO狀態推導。 |
| `PurchaseApprovalService` | Submit、assigned approver、approve、reject、withdraw與Approval snapshot。 |
| `PurchasingSettingsService` | Singleton approval setting、version、高風險更新及歷史。 |
| `GoodsReceiptService` | GR list/get/create/update/cancel、Draft header／lines／details及duplicate delivery-note warning。 |
| `ReceivingPolicyService` | 純規則：UOM換算、Tracking、Lot、Expiry、minimum life、Supplier／SKU exception、超收及status限制。 |
| `GoodsReceiptPostingService` | Lock PO／GR、提交點重驗、呼叫Inventory batch receipt、更新progress與Audit。 |
| `ReceiptReversalService` | 驗證可反向數量、呼叫Inventory batch partial reversal、更新GR／PO projection。 |
| `PurchasingSequenceService` | PO／GR月度流水號，transaction內不可重用配置。 |
| `PurchasingOperationService` | 永久event claim、canonical payload hash、result replay／lookup。 |
| `PurchasingAuditService` | action allowlist、安全before／after摘要、成功同transaction、拒絕事件持久化。 |
| `PurchasingInquiryService` | PO／GR／Outstanding／Approval／Audit server-side查詢、CSV及print projection。 |
| `PurchasingReconciliationService` | 只讀檢查PO progress、GR、Reversal及Inventory來源一致性，不自動改數。 |

Handlers只取得已由AJV驗證的`req.input`、建立actor／request context、呼叫一個service方法及回白名單projection。Handler不得拼SQL、重算Total、決定狀態或直接呼叫多個寫入service。

### 2.3 前端分層

```text
client/src/pages/purchasing/*.vue
client/src/pages/receiving/*.vue
        │
        ├─ client/src/components/purchasing/*
        ├─ client/src/components/receiving/*
        ├─ PageHeader / DataTable / FormPanel / EllipsisCell
        └─ client/src/services/purchasing.js
                         │
                         └─ framework/http/HttpClient.js
```

- 不建立全域Purchasing store。列表filter保存在URL；detail／draft以API server fact及local component state管理。
- 每個命令先由client產生一個UUID `eventId`，同一intent的重試沿用它，並同時作`Idempotency-Key`。
- 前端Total、Outstanding及warning只作即時預覽；保存／提交後必須使用server回傳值。
- Timeout後不可產生新event盲目重做；先以eventId查operation結果。
- 未保存Draft離頁使用route leave guard；版本衝突保留使用者輸入並並排顯示最新server version。

### 2.4 Provider與Consumer邊界

#### Supplier provider

沿用／落地以下contract：

```js
SupplierLookupService.assertUsable(supplierId, { purpose: "purchase", atMs })
SupplierLookupService.findById(supplierId, { purpose: "history", atMs })
SupplierLookupService.listForSku(skuId, { q, page, pageSize, atMs })
SupplierLookupService.getPurchaseDefaults(supplierId, { atMs })
```

`getPurchaseDefaults()`只回Supplier基本資料、ordering address、default currency及payment term，不回銀行資料。PO提交／批准使用`purchase`並要求Active；GR Confirm使用`history`取得目前status，按§3.6處理，不把非Active誤當不存在。

Confirmed GR後可用idempotent post-commit projection更新`SupplierRelationService.recordSupply()`的`last_supplied_at`。此soft relation失敗不可回滾已提交Inventory；以結構化告警及reconciliation補回，且不得自動標成preferred。

#### Item provider

新PO使用現有`ItemLookupService.findManyByIds(ids,{purpose:"purchase"})`。為了不放寬其他Inventory／Purchase用途，新增專用唯讀contract：

```js
ItemLookupService.findManyForCommittedReceipt(skuIds, { atMs })
```

它要求SKU row仍存在，但不因目前Item／SKU lifecycle、`purchasable`或`inventoryTracked`變更而回不可用；回傳目前值及warning codes。Receiving必須同時提供PO確認快照及exception reason。它不允許新PO使用舊快照，也不繞過Expired Lot、位置、數量或Lot一致性。

#### Inventory provider

Purchasing需要在Inventory設計上增加兩個具名、只供內部同步呼叫的batch contracts：

```js
InventoryPostingService.postPurchaseReceiptBatchInTransaction(transaction, command)
InventoryPostingService.reversePurchaseReceiptBatchInTransaction(transaction, command)
InventoryLookupService.findOperationsBySource(transaction, query)
```

`postPurchaseReceiptBatchInTransaction()`先原子claim所有detail source operations，再按Inventory固定順序鎖全部Warehouse／Stock Control／Bin／Lot／Balance，最後一次過寫Movement、Balance及Inventory Audit。逐detail循環呼叫單筆`postReceiptInTransaction()`會破壞全局lock order，因此禁止。

這個contract沒有HTTP route，也不能由一般Inventory caller自行開啟「existing commitment」模式。它只接受Purchasing傳入、已由Confirmed PO Line證明的`inventoryTrackedSnapshot=true`及`trackingPolicySnapshot`；Inventory仍重驗SKU identity、Warehouse／Bin、Lot一致性、Expiry、Stock Status及數量，但不以SKU目前lifecycle或後來變更的`inventoryTracked`旗標拒絕該既有承諾。

`reversePurchaseReceiptBatchInTransaction()`支援一或多個Receipt Details的部分反向；鎖原Movement及所有既有reversal links，確保累計反向量不超原量。Inventory generic reversal仍可保留「整組完整反向」語意，Purchasing不得以generic endpoint模擬部分反向。

### 2.5 寫入交易骨架

```text
BEGIN REPEATABLE READ
  1. assertActorFresh()及固定required permission
  2. claim purchasing_operation_requests；同event同hash回原結果，異hash回409
  3. 依command鎖settings／sequence／PO／Approval／GR／receipt rows
  4. 批量讀Supplier／Item目前資料並重驗版本、狀態、快照與原因
  5. 如涉及庫存，呼叫Inventory batch internal contract
  6. 更新PO／GR current projections及append immutable history
  7. append必要Purchasing Audit
  8. 完成domain operation result
COMMIT
```

任一步失敗完整rollback。`DATABASE_TRANSACTION_INDETERMINATE`表示COMMIT結果未知，UI必須用eventId查詢operation及GR／PO server fact，不可更換eventId直接重送。

### 2.6 全域鎖順序

同一transaction只可依以下順序取得鎖：

1. `purchasing_operation_requests` event claim。
2. `purchasing_settings`（需要判定提交政策時）。
3. `purchasing_document_sequences`（只在首次建立PO／GR）。
4. `purchase_orders`按ID升序。
5. `purchase_order_approvals` active row，再鎖`purchase_order_lines`按ID升序。
6. `goods_receipts`按ID升序、`goods_receipt_lines`及`goods_receipt_details`按ID升序。
7. `goods_receipt_reversals`及details按ID升序。
8. Inventory batch contract內：Inventory operation claims → Warehouses → Stock Controls → Bins／locks → Lots → Balances → original Movements。
9. Current projection update、Status History、Movements及Audit append。

任何Inventory流程不得在持有Inventory鎖後反向取得PO／GR鎖。Receipt Confirm與Reversal均先鎖同一PO root，因此兩張同時收同一PO的GR會序列化：第二張在第一張commit後重算Outstanding／Over-received，防止lost update或兩張都誤認未超收。

### 2.7 冪等與結果查詢

| 層級 | Identity | 保存 | 行為 |
| --- | --- | --- | --- |
| HTTP framework | authenticated actor＋method＋route＋`Idempotency-Key` | 現有idempotency store，route TTL至少1小時 | 同payload replay；不同payload 409；in-flight 409＋Retry-After。 |
| Purchasing domain | document type＋document ID／空值＋eventId | `purchasing_operation_requests`至少7年 | 與業務結果同transaction；HTTP TTL後仍可防重及查結果。 |
| Inventory domain | source module＋document type＋document ID＋detail ID＋eventId | Inventory operation table至少7年 | 每個receipt／reversal detail只產生一次庫存效果。 |

所有state-changing request body含UUID `eventId`，client把相同值放入`Idempotency-Key`。同一event不同canonical payload回`IDEMPOTENCY_CONFLICT`／`PURCHASING_EVENT_CONFLICT`。Canonical hash排除password但包含command type、resource ID、version及所有業務欄位。

現有`IdempotencyService.identityScope()`只識別`auth.type === "jwt"`；Phase 0必須把所有已認證JWT策略（`jwt`、`jwt-password`、`jwt-device`、`jwt-device-password`）映射到同一user scope，否則高風險Approval／Settings／Reversal會錯用IP scope。

### 2.8 數量與金額算法

- `orderedQuantity`及`receivedQuantity`以最多6位小數的decimal string傳輸及保存為`DECIMAL(20,6)`。
- `toBaseFactor`為1～1,000,000正整數；`quantity × factor`必須精確成為正整數，否則`UOM_CONVERSION_INVALID`。
- Base quantities使用`BIGINT UNSIGNED`，但API及service config上限不得超`Number.MAX_SAFE_INTEGER`；計算時先用BigInt避免乘法溢位。
- `unitPrice`為0～`999999999999999.9999`的decimal string，最多4位小數，DB為`DECIMAL(19,4)`。
- Currency `decimal_places`支援0～4；確認PO時保存`currency_decimal_places_snapshot`。
- `lineAmount = roundHalfUp(orderedQuantity × unitPrice, currencyDecimalPlaces)`；先逐Line round，再加總得到Subtotal／Total。
- Amount DB欄位用`DECIMAL(25,4)`；API一律回固定scale decimal string，CSV及print使用同一formatter。
- 不使用`Number`乘除金額，不以browser結果作正式Total。`moneyMath.js`以decimal parser＋BigInt scaled arithmetic實作並有邊界unit tests。
- GR保存PO Line的Unit Price／Line Amount只作read-only snapshot projection；Inventory command完全不帶價格或成本。

---

## 3. Domain模型、狀態機與核心流程

### 3.1 Purchase Order aggregate

PO root擁有Header及Lines。Draft更新使用「完整editable projection＋child IDs」一次取代：沒有ID代表新增；有ID必須屬於該PO；現有Draft line未出現在payload代表刪除。保存前完整驗證，任一Line錯誤整張不寫。

PO首次保存即取得編號。Draft可修改Supplier、Currency、Payment Term、dates、Warehouse、Buyer、reference、notes及Lines。進入Pending／Confirmed後商業欄位凍結；只有需求明確允許且沒有Confirmed GR的withdraw可回Draft。

### 3.2 PO狀態機

```text
DRAFT ── approval OFF / confirm ───────────────> CONFIRMED
DRAFT ── approval ON / submit ──> PENDING_APPROVAL ── approve ──> CONFIRMED
                                     │       │
                                     │       └── reject ──> DRAFT
                                     └────────── withdraw ──> DRAFT

CONFIRMED（零Confirmed GR）── withdraw confirmation ──> DRAFT
CONFIRMED（零Confirmed GR）── cancel ─────────────────> CANCELLED
CONFIRMED ── first partial GR ────────────────────────> PARTIALLY_RECEIVED
CONFIRMED／PARTIALLY_RECEIVED ── all lines satisfied ─> FULLY_RECEIVED
PARTIALLY_RECEIVED ── close remaining ────────────────> CLOSED
```

每個Line推導：

```text
netReceived = grossConfirmedReceived - reversed
unreceived = max(ordered - netReceived, 0)
outstanding = max(ordered - netReceived - closedRemaining, 0)
overReceived = max(netReceived - ordered, 0)
```

`outstanding`是仍可安排正常收貨的數量；`closedRemaining`分開顯示。超收不增加Ordered。若所有Lines `outstanding=0`：有任何`closedRemaining>0`則PO為CLOSED，否則為FULLY_RECEIVED。人工CLOSED在Reversal後不自動重開，但顯示差異warning。

### 3.3 Approval與Settings

- Setting預設`requirePoApproval=false`；Submit transaction鎖setting row並保存policy version。
- OFF：`purchasing.mgmt`經完整確認驗證後直接CONFIRMED。
- ON：必須提供另一名Active且具`purchasing.approval`的assigned approver，建立immutable snapshot並轉PENDING_APPROVAL。
- Approve／Reject只接受assigned approver；Approve／Reject route均為`jwt-password`。Reject reason必填；Approve reason選填。
- Submitter與Approver以user ID比較，不能用username；提交人即使有approval permission也不能自批。
- Approve鎖PO及pending approval，重驗PO version、snapshot version、Supplier、SKU、UOM、Currency、兩名使用者狀態及approver permission。
- Reject／withdraw令PO回DRAFT；已完成approval record保留，新的submit建立新record。
- Setting變更使用`jwt-device-password`、`purchasing.settings`、reason及version，只影響其後開始的submit，不掃描既有PO。

### 3.4 Goods Receipt aggregate

GR root固定引用一張PO及其Supplier。Draft由Header、Receipt Lines及Physical Details組成：

- Receipt Line一對一引用本次涉及的PO Line，保存本次合計、超收與SKU exception。
- Physical Detail表示確切SKU＋UOM＋Lot／Expiry＋Warehouse＋Bin＋Stock Status＋數量。
- Draft不改PO progress或Inventory；保存使用完整replace＋version及整張transaction。
- 一張GR內相同PO Line／Warehouse／Bin／normalized Lot／Status只可有一個Detail；不同輸入UOM仍須合併成同一physical dimension。
- Supplier Delivery Note只觸發同Supplier近期疑似重複warning，不是unique key或冪等identity。

GR狀態：`DRAFT → CONFIRMED → PARTIALLY_REVERSED → REVERSED`，另有`DRAFT → CANCELLED`。Confirmed後Header、Lines及Details不可直接改；只有Reversal更新status projection。

### 3.5 GR確認流程

1. Route驗證`purchasing.view`＋`receiving.operation`，schema及HTTP idempotency。
2. Transaction內重讀actor並claim domain event。
3. 鎖GR、PO、所有PO Lines及GR children；驗證GR仍DRAFT、version一致、PO仍CONFIRMED／PARTIALLY_RECEIVED。
4. 批量取得Supplier現在狀態、SKU committed-receipt projection及Warehouse／Bin資料。
5. 依PO確認快照驗證SKU identity、Purchase／Base UOM、tracking baseline；依現在資料產生warning及reason要求。
6. 驗證數量、duplicate dimension、Lot／Expiry／Manufacture、Minimum Receipt Life、Stock Status、超收與Blocked Supplier規則。
7. 以提交時已鎖定的PO progress重新計算每個Receipt Line的over-received quantity；缺reason整張拒絕。
8. 呼叫Inventory batch receipt contract；任何Detail失敗令transaction rollback，GR保持DRAFT。
9. 寫回每Detail movement IDs、GR CONFIRMED、PO Line gross/net progress及PO status；append history與Audit。
10. Commit後重新讀detail projection；再以best-effort idempotent方式更新Supplier soft supply history。

### 3.6 Supplier／SKU變更政策

| 提交時情況 | 行為 |
| --- | --- |
| Supplier Active | 正常收貨。 |
| Supplier Suspended／Archived | 允許既有PO收貨；Header顯示warning，`supplierExceptionReason`必填。 |
| Supplier Blocked | 允許既有PO收貨；reason必填，且每個Detail必須`QUARANTINED`，其他Status回409。 |
| SKU仍符合PO確認時狀態 | 正常按Tracking／效期／位置規則收貨。 |
| SKU／Item變Inactive、Discontinued、Archived或purchase／inventory flags改變 | 允許仍有Outstanding的Confirmed PO收貨；每個受影響PO Line顯示warning codes並要求`skuExceptionReason`。 |
| Tracking／UOM設定在PO後改變 | 使用PO確認時snapshot履行該PO；顯示差異並要求reason。新PO不得使用舊snapshot。 |
| SKU row不存在 | 正常FK應使此情況不可能；視為資料完整性事故並fail closed，不可建立匿名庫存。 |
| Expired Lot、Lot資料矛盾、Inactive／錯Warehouse Bin、非正整數Base qty | 即使有既有PO仍拒絕；一般SKU exception reason不能繞過實體庫存安全規則。 |

Minimum Receipt Life使用「PO snapshot與目前值中較嚴格且非空的一個」作提交門檻；低於門檻仍須`receiving.expiry.override`及detail-level reason，Expired不可override。這是貨品質量規則，不屬SKU lifecycle exception。

Receipt輸入UOM只接受該PO Line確認時的Purchase UOM或Base UOM：Purchase UOM使用PO factor snapshot，即使關係其後停用仍可完成承諾；Base UOM固定factor 1。這個範圍已覆蓋現場以採購包裝或最小庫存單位收貨的需要，避免引入與PO無關的第三種Pack UOM及factor漂移。

### 3.7 Receipt Reversal

- Route使用`jwt-device-password`及`purchasing.view`＋`inventory.adjust`，body含GR version、eventId、整體reason及1～200個detail quantities。
- Reversal command在一個transaction建立Confirmed reversal header／details並立即過帳，不提供Draft reversal。
- 每個quantity為正整數Base UOM，且不得超過該Receipt Detail `receivedBaseQuantity - reversedBaseQuantity`。
- Inventory重驗當下On Hand、Allocation、Reservation、Lot、Bin、Status及Stocktake lock；任何一筆不合法整次拒絕。
- 成功建立新的OUT reversal Movements及link，不修改原Movement；更新Receipt Detail reversed projection、GR status、PO Line net／outstanding／over-received及PO status。
- Reversal後若需正確收貨，建立新GR；不得改原GR。物理Supplier Return另走未來流程。

### 3.8 不變量

1. 一張PO只有一個Supplier及Currency；一張GR只有一個PO。
2. PO至少一個Line；GR至少一個Receipt Line及一個Detail。
3. Detail的PO Line必須屬GR的PO，SKU必須等於PO Line SKU，Bin必須屬Warehouse。
4. Base quantities均為正整數；gross、reversed、net、closed及overreceived永不為負。
5. `reversed <= grossReceived`；Receipt Detail累計反向不超原收到量。
6. Draft PO／GR不改Inventory；Confirmed GR的Inventory結果不可缺。
7. Confirmed／Reversed歷史不可直接update／delete；更正一定產生新事件。
8. 每個domain event只產生一次結果；同ID不同payload永遠衝突。
9. Server才計算Amount、Total、Outstanding、Over-received及狀態。
10. 必要Audit失敗時成功業務transaction必須rollback。

---

## 4. Database Table詳細設計

### 4.1 共通規則

- Engine為InnoDB；charset／collation沿用現有`utf8mb4_unicode_ci`。
- PK使用`BIGINT UNSIGNED AUTO_INCREMENT`；一家公司，不加tenant／company column。
- Timestamp使用epoch milliseconds `BIGINT UNSIGNED`；業務日期用`DATE`；顯示依`APP_TIME_ZONE`。
- Mutable root使用`version INT UNSIGNED NOT NULL DEFAULT 1`及compare-and-set。
- 相容基線為MySQL 8.0：`CHECK` constraints可用，適合用於單row的數量、金額及enum下限上限防護；跨row與跨aggregate規則仍由service在transaction內驗證，DB另以UNSIGNED、NOT NULL、FK、UNIQUE及generated columns作第二層防護。（對齊修正：原稿以MySQL 5.7為基線並聲明不依賴CHECK constraints；實際CI服務為`mysql:8.0`，且Inventory模組已批准MySQL 8.0為相容基線。）
- Business master及歷史FK預設`ON DELETE RESTRICT`；actor FK可`SET NULL`並保存username snapshot。
- Confirmed交易、Approval snapshot、Status History、Operation及Audit至少保留7年，不提供一般DELETE。
- 所有normalized keys由service產生；dynamic sort只能用allowlist映射。

### 4.2 ER關係

```text
purchasing_settings
purchasing_document_sequences

suppliers 1 ──< purchase_orders 1 ──< purchase_order_lines >── 1 item_skus
                         │                   │
                         ├──< purchase_order_approvals
                         ├──< purchase_order_status_history
                         └──< goods_receipts 1 ──< goods_receipt_lines
                                      │                 │
                                      │                 └──< goods_receipt_details >── inventory_movements
                                      └──< goods_receipt_reversals 1 ──< goods_receipt_reversal_details

purchasing_operation_requests ── logical source/result links
purchasing_audit_logs ─────────── logical immutable audit links
```

### 4.3 `purchasing_document_sequences`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `document_type` | VARCHAR(10) | PK part | `PO`、`GR`。 |
| `year_month` | CHAR(6) | PK part | APP_TIME_ZONE的`YYYYMM`。 |
| `next_value` | INT UNSIGNED | NOT NULL／1 | 下一個可配置值；最大999999。 |
| `updated_at` | BIGINT UNSIGNED | NOT NULL | 最近分配時間。 |

Primary key為`(document_type,year_month)`。分配時以`INSERT ... ON DUPLICATE KEY UPDATE document_type=VALUES(document_type)`確保row存在，再`SELECT ... FOR UPDATE`讀current value及遞增；PO／GR insert與sequence update同transaction。Rollback可令未commit號碼再次可用，但任何已commit Draft的號碼即使其後Cancelled也不可重用。

### 4.4 `purchasing_settings`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | TINYINT UNSIGNED | PK，固定1 | 單公司singleton。 |
| `require_po_approval` | TINYINT(1) | NOT NULL／0 | 本期唯一設定。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Optimistic lock。 |
| `updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `updated_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | 最後修改人。 |
| `updated_by_label` | VARCHAR(190) | NOT NULL | Actor snapshot。 |

Migration只在row不存在時insert預設值，不以`INSERT IGNORE`吞掉其他錯誤。未知setting fields在API boundary被拒絕；歷史由`purchasing_audit_logs`查詢。

### 4.5 `purchase_orders`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | PO內部ID。 |
| `po_number` | VARCHAR(20) | NOT NULL／UNIQUE | `PO-YYYYMM-000001`。 |
| `document_year_month` | CHAR(6) | NOT NULL | 編號月份。 |
| `sequence_no` | INT UNSIGNED | NOT NULL | 月內sequence。 |
| `supplier_id` | BIGINT UNSIGNED | NOT NULL／FK suppliers RESTRICT | 正式Supplier。 |
| `supplier_code_snapshot` | VARCHAR(64) | NOT NULL | 確認時快照；Draft亦保存最近選擇值。 |
| `supplier_name_snapshot` | VARCHAR(190) | NOT NULL | 歷史顯示。 |
| `ordering_address_id` | BIGINT UNSIGNED | NULL／FK supplier_addresses RESTRICT | 選用地址。 |
| `ordering_address_snapshot` | JSON | NULL | 白名單地址行／國家／電話，上限2048 bytes。 |
| `currency_code` | CHAR(3) | NOT NULL／FK currencies RESTRICT | PO Currency。 |
| `currency_name_snapshot` | VARCHAR(100) | NOT NULL | 顯示快照。 |
| `currency_decimal_places_snapshot` | TINYINT UNSIGNED | NOT NULL | 0～4，金額round基準。 |
| `payment_term_id` | BIGINT UNSIGNED | NULL／FK payment_terms RESTRICT | 選填。 |
| `payment_term_snapshot` | JSON | NULL | code／name／type／days快照，上限1024 bytes。 |
| `order_date` | DATE | NOT NULL | 採購日期。 |
| `expected_delivery_date` | DATE | NULL | Header交期。 |
| `default_receiving_warehouse_id` | BIGINT UNSIGNED | NULL／FK inventory_warehouses RESTRICT | 只作GR預設。 |
| `default_warehouse_code_snapshot` | VARCHAR(50) | NOT NULL／`''` | 歷史顯示。 |
| `buyer_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Service建立時必填。 |
| `buyer_label` | VARCHAR(190) | NOT NULL | Buyer snapshot。 |
| `supplier_reference` | VARCHAR(190) | NOT NULL／`''` | 外部參考。 |
| `notes` | VARCHAR(2000) | NOT NULL／`''` | 純文字。 |
| `status` | VARCHAR(30) | NOT NULL／`DRAFT` | PO狀態。 |
| `subtotal_amount` | DECIMAL(25,4) | NOT NULL／0 | 已round Lines加總。 |
| `total_amount` | DECIMAL(25,4) | NOT NULL／0 | 本期等於Subtotal。 |
| `has_outstanding` | TINYINT(1) | NOT NULL／1 | 列表projection。 |
| `has_confirmed_receipt` | TINYINT(1) | NOT NULL／0 | Withdraw／Cancel guard。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Root version。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor IDs。 |
| `created_by_label`,`updated_by_label` | VARCHAR(190) | NOT NULL | Actor snapshots。 |
| `confirmed_at`,`closed_at`,`cancelled_at` | BIGINT UNSIGNED | NULL | Lifecycle時間。 |
| `confirmed_by`,`closed_by`,`cancelled_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Lifecycle actor。 |

Indexes／constraints：

- `UNIQUE uq_purchase_orders_number(po_number)`及`UNIQUE(document_year_month,sequence_no)`。
- `UNIQUE uq_purchase_orders_id_supplier(id,supplier_id)`供GR ownership FK。
- `INDEX idx_po_list(status,updated_at,id)`、`idx_po_supplier(supplier_id,status,order_date,id)`。
- `INDEX idx_po_buyer(buyer_id,status,order_date,id)`、`idx_po_currency(currency_code,status,id)`。
- `INDEX idx_po_delivery(status,expected_delivery_date,id)`、`idx_po_outstanding(has_outstanding,status,expected_delivery_date,id)`。
- `po_number`格式由service驗證；sequence table及unique keys處理競態。

### 4.6 `purchase_order_lines`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Stable PO Line ID。 |
| `purchase_order_id` | BIGINT UNSIGNED | NOT NULL／FK PO RESTRICT | Owner。 |
| `line_number` | SMALLINT UNSIGNED | NOT NULL | 1～100顯示順序。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus RESTRICT | 正式SKU。 |
| `sku_code_snapshot`,`sku_name_snapshot` | VARCHAR(190) | NOT NULL | 確認快照。 |
| `tracking_policy_snapshot` | VARCHAR(20) | NOT NULL | `none`／`batch`／`batch_expiry`；serial不可確認。 |
| `inventory_tracked_snapshot` | TINYINT(1) | NOT NULL | 確認時必須1。 |
| `minimum_receipt_life_days_snapshot` | INT UNSIGNED | NULL | PO確認時效期門檻。 |
| `base_uom_id` | BIGINT UNSIGNED | NOT NULL／FK item_uoms RESTRICT | Base UOM。 |
| `base_uom_code_snapshot` | VARCHAR(50) | NOT NULL | 歷史顯示。 |
| `purchase_sku_uom_id` | BIGINT UNSIGNED | NOT NULL | FK至item_sku_uoms。 |
| `purchase_uom_code_snapshot` | VARCHAR(50) | NOT NULL | Purchase UOM顯示。 |
| `uom_to_base_factor_snapshot` | INT UNSIGNED | NOT NULL | 1～1,000,000。 |
| `supplier_sku_ref_id` | BIGINT UNSIGNED | NULL／FK supplier_sku_refs RESTRICT | 軟關係來源。 |
| `supplier_item_code_snapshot` | VARCHAR(190) | NOT NULL／`''` | 可由Draft覆寫顯示值。 |
| `ordered_quantity` | DECIMAL(20,6) | NOT NULL | Purchase UOM quantity。 |
| `ordered_base_quantity` | BIGINT UNSIGNED | NOT NULL | 精確Base quantity。 |
| `unit_price` | DECIMAL(19,4) | NOT NULL | PO Currency每Purchase UOM價格。 |
| `line_amount` | DECIMAL(25,4) | NOT NULL | 依Currency scale round。 |
| `zero_price_reason` | VARCHAR(500) | NOT NULL／`''` | Unit Price=0時必填。 |
| `expected_delivery_date` | DATE | NULL | Line override。 |
| `line_note` | VARCHAR(1000) | NOT NULL／`''` | 純文字。 |
| `gross_received_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Confirmed GR合計。 |
| `reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 成功Reversal合計。 |
| `net_received_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | gross－reversed projection。 |
| `closed_remaining_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 人工結束未收量。 |
| `has_outstanding`,`is_over_received` | TINYINT(1) | NOT NULL | 列表projection。 |
| `close_reason` | VARCHAR(500) | NOT NULL／`''` | 關閉時原因。 |
| `closed_at`,`closed_by` | BIGINT UNSIGNED | NULL／actor FK SET NULL | Line close資料。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Draft edit及progress CAS。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |

Indexes／constraints：

- `UNIQUE uq_po_lines_number(purchase_order_id,line_number)`。
- `UNIQUE uq_po_lines_id_po(id,purchase_order_id)`及`UNIQUE uq_po_lines_id_sku(id,sku_id)`供GR composite FK。
- `INDEX idx_po_lines_sku(sku_id,purchase_order_id,id)`及`idx_po_lines_outstanding(purchase_order_id,has_outstanding,id)`。
- Composite FK `(purchase_sku_uom_id,sku_id)`→`item_sku_uoms(id,sku_id)`，確保UOM ownership。
- `gross/reversed/net/closed`只由Lifecycle／Posting／Reversal service更新；client不可輸入。

### 4.7 `purchase_order_approvals`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Approval ID。 |
| `purchase_order_id` | BIGINT UNSIGNED | NOT NULL／FK PO RESTRICT | Owner。 |
| `purchase_order_version` | INT UNSIGNED | NOT NULL | 提交版本。 |
| `settings_version` | INT UNSIGNED | NOT NULL | 提交政策版本。 |
| `requested_by`,`assigned_approver_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | 提交人／指定人；service要求非空。 |
| `requested_by_label`,`approver_label` | VARCHAR(190) | NOT NULL | Actor快照。 |
| `approval_snapshot` | JSON | NOT NULL | Supplier、lines、price、total、currency、terms、dates及warnings，上限64KiB。 |
| `snapshot_hash` | CHAR(64) | NOT NULL | Canonical SHA-256。 |
| `status` | VARCHAR(20) | NOT NULL／`PENDING` | PENDING／APPROVED／REJECTED／WITHDRAWN／INVALIDATED。 |
| `pending_slot` | TINYINT GENERATED | `IF(status='PENDING',1,NULL)` | 每PO最多一個pending。 |
| `request_note` | VARCHAR(500) | NOT NULL／`''` | 提交說明。 |
| `decision_reason` | VARCHAR(500) | NOT NULL／`''` | Reject必填。 |
| `requested_at`,`decided_at` | BIGINT UNSIGNED | decided可NULL | 時間。 |
| `decided_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | 決定人。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Lifecycle CAS。 |

`UNIQUE(purchase_order_id,pending_slot)`、`INDEX(assigned_approver_id,status,requested_at,id)`、`INDEX(purchase_order_id,requested_at,id)`。Snapshot、hash、requester及submitted version建立後不可更新；只可改status／decision fields／version。

### 4.8 `purchase_order_status_history`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | History ID。 |
| `purchase_order_id` | BIGINT UNSIGNED | NOT NULL／FK PO RESTRICT | PO。 |
| `sequence_no` | INT UNSIGNED | NOT NULL | PO內事件順序。 |
| `from_status`,`to_status` | VARCHAR(30) | from可`''`／to必填 | 狀態轉移。 |
| `action` | VARCHAR(50) | NOT NULL | CREATE／SUBMIT／APPROVE／REJECT／WITHDRAW／CONFIRM／RECEIVE／CLOSE／CANCEL／REVERSE。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | 適用原因。 |
| `purchase_order_version_after` | INT UNSIGNED | NOT NULL | 事件後版本。 |
| `event_id` | CHAR(36) | NOT NULL | Domain event。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `actor_label` | VARCHAR(190) | NOT NULL | Snapshot。 |
| `occurred_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(purchase_order_id,sequence_no)`及`INDEX(purchase_order_id,occurred_at,id)`；只准INSERT／SELECT，以trigger拒絕UPDATE／DELETE。

### 4.9 `goods_receipts`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | GR內部ID。 |
| `gr_number` | VARCHAR(20) | NOT NULL／UNIQUE | `GR-YYYYMM-000001`。 |
| `document_year_month`,`sequence_no` | CHAR(6)／INT UNSIGNED | NOT NULL | 編號來源。 |
| `purchase_order_id` | BIGINT UNSIGNED | NOT NULL／FK PO RESTRICT | 唯一PO來源。 |
| `supplier_id` | BIGINT UNSIGNED | NOT NULL | 與PO composite FK驗證。 |
| `supplier_code_snapshot`,`supplier_name_snapshot` | VARCHAR(64)／VARCHAR(190) | NOT NULL | 從PO取得。 |
| `business_receipt_date` | DATE | NOT NULL | 實際收貨業務日期。 |
| `supplier_delivery_note` | VARCHAR(190) | NOT NULL／`''` | 選填，僅作搜尋／warning。 |
| `notes` | VARCHAR(2000) | NOT NULL／`''` | 純文字。 |
| `status` | VARCHAR(30) | NOT NULL／`DRAFT` | DRAFT／CONFIRMED／PARTIALLY_REVERSED／REVERSED／CANCELLED。 |
| `supplier_status_at_confirm` | VARCHAR(30) | NOT NULL／`''` | Confirm提交時目前Supplier狀態。 |
| `supplier_exception_reason` | VARCHAR(500) | NOT NULL／`''` | 非Active時必填。 |
| `total_received_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 本GR總Base qty projection。 |
| `total_reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 累計反向。 |
| `has_over_receipt`,`has_expiry_override`,`has_sku_exception` | TINYINT(1) | NOT NULL／0 | 列表filter projection。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Draft及reversal status CAS。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `created_by_label`,`updated_by_label` | VARCHAR(190) | NOT NULL | Actor snapshot。 |
| `confirmed_at`,`confirmed_by` | BIGINT UNSIGNED | NULL／actor FK SET NULL | 正式確認。 |
| `confirm_event_id` | CHAR(36) | NULL／UNIQUE | Confirm event；Draft為NULL。 |
| `inventory_result_summary` | JSON | NULL | Detail count及Movement IDs摘要，上限64KiB。 |
| `cancelled_at`,`cancelled_by`,`cancel_reason` | BIGINT UNSIGNED／actor／VARCHAR(500) | NULL／`''` | Draft cancel資料。 |

Constraints／indexes：

- `UNIQUE(gr_number)`及`UNIQUE(document_year_month,sequence_no)`。
- `UNIQUE uq_gr_id_po(id,purchase_order_id)`供child owner FK。
- Composite FK `(purchase_order_id,supplier_id)`→`purchase_orders(id,supplier_id)`。
- `INDEX idx_gr_list(status,business_receipt_date,id)`、`idx_gr_po(purchase_order_id,status,id)`。
- `INDEX idx_gr_supplier(supplier_id,business_receipt_date,id)`、`idx_gr_delivery_note(supplier_id,supplier_delivery_note,business_receipt_date,id)`。
- `INDEX idx_gr_flags(has_over_receipt,has_expiry_override,has_sku_exception,business_receipt_date,id)`。

### 4.10 `goods_receipt_lines`

Receipt Line是一張GR內對一個PO Line的合計及例外記錄，不等於實際庫位Detail。

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Receipt Line ID。 |
| `goods_receipt_id` | BIGINT UNSIGNED | NOT NULL／FK GR RESTRICT | Owner。 |
| `purchase_order_id` | BIGINT UNSIGNED | NOT NULL | Composite owner。 |
| `purchase_order_line_id` | BIGINT UNSIGNED | NOT NULL | 必須屬同一PO。 |
| `line_number` | SMALLINT UNSIGNED | NOT NULL | GR內顯示順序。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL | 與PO Line composite FK。 |
| `sku_code_snapshot`,`sku_name_snapshot` | VARCHAR(190) | NOT NULL | 從PO Line取得。 |
| `received_base_quantity` | BIGINT UNSIGNED | NOT NULL | 所有details合計。 |
| `po_outstanding_before_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Confirm鎖定後計算。 |
| `over_received_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 本次實收超過提交前outstanding的部分。 |
| `over_receipt_reason` | VARCHAR(500) | NOT NULL／`''` | Over>0時必填。 |
| `item_status_at_confirm`,`sku_status_at_confirm` | VARCHAR(20) | NOT NULL／`''` | 目前主資料狀態。 |
| `purchasable_at_confirm`,`inventory_tracked_at_confirm` | TINYINT(1) | NULL | 目前flags。 |
| `current_tracking_policy` | VARCHAR(20) | NOT NULL／`''` | 與PO snapshot比對。 |
| `sku_warning_codes` | JSON | NULL | server allowlist，例如`SKU_ARCHIVED`、`TRACKING_CHANGED`。 |
| `sku_exception_reason` | VARCHAR(500) | NOT NULL／`''` | 有warning時必填。 |
| `po_net_received_after_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Confirm後projection。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |

Constraints／indexes：

- `UNIQUE(goods_receipt_id,purchase_order_line_id)`及`UNIQUE(goods_receipt_id,line_number)`。
- Composite FK `(goods_receipt_id,purchase_order_id)`→`goods_receipts(id,purchase_order_id)`。
- Composite FK `(purchase_order_line_id,purchase_order_id)`→`purchase_order_lines(id,purchase_order_id)`。
- Composite FK `(purchase_order_line_id,sku_id)`→`purchase_order_lines(id,sku_id)`。
- `INDEX idx_gr_lines_po_line(purchase_order_line_id,goods_receipt_id,id)`及`idx_gr_lines_sku(sku_id,goods_receipt_id,id)`。

### 4.11 `goods_receipt_details`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Physical Detail ID。 |
| `goods_receipt_id`,`goods_receipt_line_id` | BIGINT UNSIGNED | NOT NULL／FK | GR及Receipt Line。 |
| `purchase_order_id`,`purchase_order_line_id` | BIGINT UNSIGNED | NOT NULL | 強化ownership。 |
| `detail_number` | SMALLINT UNSIGNED | NOT NULL | 1～200顯示順序。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus RESTRICT | 必須等於PO Line SKU。 |
| `sku_code_snapshot`,`sku_name_snapshot` | VARCHAR(190) | NOT NULL | PO快照。 |
| `input_uom_id` | BIGINT UNSIGNED | NOT NULL／FK item_uoms RESTRICT | 實際輸入UOM。 |
| `input_uom_code_snapshot` | VARCHAR(50) | NOT NULL | 歷史顯示。 |
| `uom_to_base_factor_snapshot` | INT UNSIGNED | NOT NULL | Confirm採用factor。 |
| `received_quantity` | DECIMAL(20,6) | NOT NULL | 輸入數量。 |
| `received_base_quantity` | BIGINT UNSIGNED | NOT NULL | Inventory quantity。 |
| `warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK inventory_warehouses RESTRICT | Warehouse。 |
| `bin_id` | BIGINT UNSIGNED | NOT NULL | Composite FK驗證ownership。 |
| `warehouse_code_snapshot`,`bin_code_snapshot` | VARCHAR(50) | NOT NULL | Confirm快照。 |
| `tracking_policy_applied` | VARCHAR(20) | NOT NULL | PO確認snapshot；serial不可出現。 |
| `lot_number` | VARCHAR(100) | NOT NULL／`''` | none時空字串。 |
| `normalized_lot_number` | VARCHAR(100) | NOT NULL／`''` | Unique dimension scope。 |
| `expiry_date`,`manufacture_date` | DATE | NULL | Tracking規則。 |
| `stock_status` | VARCHAR(20) | NOT NULL | AVAILABLE／QUARANTINED／DAMAGED。 |
| `minimum_life_days_applied` | INT UNSIGNED | NULL | PO與目前規則較嚴格值。 |
| `actual_remaining_life_days` | INT | NULL | Confirm date基準；可為負但Expired會被拒絕。 |
| `expiry_override_reason` | VARCHAR(500) | NOT NULL／`''` | 例外時必填。 |
| `expiry_override_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | 具權限actor。 |
| `reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 累計正式Reversal。 |
| `inventory_operation_request_id` | BIGINT UNSIGNED | NULL／FK inventory_operation_requests RESTRICT | Confirm後必填。 |
| `inventory_movement_id` | BIGINT UNSIGNED | NULL／FK inventory_movements RESTRICT | 原Receipt IN movement。 |
| `inventory_movement_group_id` | CHAR(36) | NOT NULL／`''` | 追溯。 |
| `confirmed_at` | BIGINT UNSIGNED | NULL | Confirm時間。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Draft edit時間。 |

Constraints／indexes：

- `UNIQUE(goods_receipt_id,detail_number)`。
- `UNIQUE uq_gr_detail_dimension(goods_receipt_id,purchase_order_line_id,warehouse_id,bin_id,sku_id,normalized_lot_number,stock_status)`，阻止同GR重複physical bucket。
- `UNIQUE(inventory_movement_id)`確保一個原IN movement只對應一個Receipt Detail。
- Composite FK `(goods_receipt_line_id,goods_receipt_id)`、`(goods_receipt_id,purchase_order_id)`、`(purchase_order_line_id,purchase_order_id)`及`(purchase_order_line_id,sku_id)`。
- Composite FK `(bin_id,warehouse_id)`→`inventory_bins(id,warehouse_id)`。
- `INDEX idx_gr_details_sku(sku_id,goods_receipt_id,id)`、`idx_gr_details_location(warehouse_id,bin_id,goods_receipt_id,id)`、`idx_gr_details_lot(sku_id,normalized_lot_number,id)`。

Draft可更新／刪除details；Parent轉CONFIRMED後trigger拒絕除`reversed_base_quantity`外的UPDATE及所有DELETE。`reversed_base_quantity`只能由Reversal transaction更新。

### 4.12 `goods_receipt_reversals`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Reversal ID。 |
| `goods_receipt_id` | BIGINT UNSIGNED | NOT NULL／FK GR RESTRICT | 原GR。 |
| `reversal_sequence` | SMALLINT UNSIGNED | NOT NULL | GR內由1遞增。 |
| `reversal_reference` | VARCHAR(30) | NOT NULL／UNIQUE | `${grNumber}-R01`等顯示值。 |
| `status` | VARCHAR(20) | NOT NULL／`CONFIRMED` | 本期只有CONFIRMED；不建Draft workflow。 |
| `reason` | VARCHAR(500) | NOT NULL | 更正原因。 |
| `event_id` | CHAR(36) | NOT NULL／UNIQUE | 冪等event。 |
| `total_reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL | 合計。 |
| `inventory_result_summary` | JSON | NOT NULL | 安全結果projection。 |
| `confirmed_at` | BIGINT UNSIGNED | NOT NULL | 時間。 |
| `confirmed_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `confirmed_by_label` | VARCHAR(190) | NOT NULL | Snapshot。 |
| `request_id`,`correlation_id` | VARCHAR(64) | NOT NULL／`''` | 追蹤。 |

`UNIQUE(goods_receipt_id,reversal_sequence)`、`INDEX(goods_receipt_id,confirmed_at,id)`；只准INSERT／SELECT，trigger拒絕UPDATE／DELETE。

### 4.13 `goods_receipt_reversal_details`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Reversal Detail。 |
| `reversal_id` | BIGINT UNSIGNED | NOT NULL／FK reversal RESTRICT | Owner。 |
| `goods_receipt_id`,`goods_receipt_detail_id` | BIGINT UNSIGNED | NOT NULL | 原來源ownership。 |
| `purchase_order_line_id`,`sku_id` | BIGINT UNSIGNED | NOT NULL | PO progress mapping。 |
| `reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL | 本次正整數反向量。 |
| `original_inventory_movement_id` | BIGINT UNSIGNED | NOT NULL／FK inventory_movements RESTRICT | 原IN。 |
| `reversal_inventory_movement_id` | BIGINT UNSIGNED | NOT NULL／UNIQUE／FK | 新OUT。 |
| `reversal_inventory_operation_id` | BIGINT UNSIGNED | NOT NULL／FK | Inventory operation。 |
| `created_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

Composite FK `(goods_receipt_detail_id,goods_receipt_id)`確保owner；`UNIQUE(reversal_id,goods_receipt_detail_id)`避免同一command重複列；indexes為`(goods_receipt_detail_id,id)`及`(purchase_order_line_id,id)`。只准INSERT／SELECT。

Inventory schema配合部分反向時，`inventory_movements.reversal_of_movement_id`不可再有「一個原Movement只能一個Reversal」unique constraint；改為普通index，transaction鎖原Movement並以reversal rows合計驗證上限。若Inventory尚未建立，直接在首次migration採正確設計；不可先建立衝突constraint再以未評審migration移除。

### 4.14 `purchasing_operation_requests`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Domain operation ID。 |
| `command_type` | VARCHAR(60) | NOT NULL | Server allowlist。 |
| `source_document_type` | VARCHAR(40) | NOT NULL | PURCHASE_ORDER／GOODS_RECEIPT／SETTING／REVERSAL。 |
| `source_document_id` | VARCHAR(100) | NOT NULL／`''` | Create前可空；其他用內部ID字串。 |
| `source_line_id` | VARCHAR(100) | NOT NULL／`''` | Header命令留空。 |
| `event_id` | CHAR(36) | NOT NULL | Client intent UUID。 |
| `request_hash` | CHAR(64) | NOT NULL | Canonical payload SHA-256，不含password。 |
| `result_type`,`result_id` | VARCHAR(40)／VARCHAR(100) | NULL | PO／GR／APPROVAL／REVERSAL。 |
| `result_summary` | JSON | NULL | 安全、可重播的最小projection。 |
| `completed_at` | BIGINT UNSIGNED | NULL | 同transaction完成。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `actor_label` | VARCHAR(190) | NOT NULL | Snapshot。 |
| `request_id`,`correlation_id` | VARCHAR(64) | NOT NULL／`''` | 追蹤。 |
| `created_at` | BIGINT UNSIGNED | NOT NULL | Claim時間。 |

`UNIQUE(source_document_type,source_document_id,source_line_id,event_id)`是永久冪等核心；`command_type`納入hash但不放unique key，防同一event換command產生第二個效果。另設`INDEX(event_id,id)`及`INDEX(source_document_type,source_document_id,id)`。Domain operation與business effect同transaction，不存在永久IN_PROGRESS row；至少保留7年。

### 4.15 `purchasing_audit_logs`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Audit ID。 |
| `occurred_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `actor_label` | VARCHAR(190) | NOT NULL | Snapshot。 |
| `action` | VARCHAR(80) | NOT NULL | 具名allowlist。 |
| `outcome` | VARCHAR(20) | NOT NULL | SUCCEEDED／REJECTED／FAILED。 |
| `target_type` | VARCHAR(30) | NOT NULL | PO／PO_LINE／APPROVAL／SETTING／GR／GR_DETAIL／REVERSAL／EXPORT。 |
| `target_id` | BIGINT UNSIGNED | NULL | 邏輯ID，不設target FK。 |
| `purchase_order_id`,`goods_receipt_id` | BIGINT UNSIGNED | NULL | 查詢scope，邏輯引用。 |
| `target_label` | VARCHAR(190) | NOT NULL／`''` | PO／GR Number等安全標籤。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | 適用原因。 |
| `detail` | JSON | NULL | Action-specific before／after摘要，上限8192 bytes。 |
| `request_id`,`correlation_id` | VARCHAR(64) | NOT NULL／`''` | 跨log追蹤。 |
| `ip` | VARCHAR(45) | NOT NULL／`''` | Actor IP。 |

Indexes：`(occurred_at,id)`、`(purchase_order_id,occurred_at,id)`、`(goods_receipt_id,occurred_at,id)`、`(actor_user_id,occurred_at,id)`、`(action,outcome,occurred_at,id)`。只准INSERT／SELECT；trigger拒絕UPDATE／DELETE。

成功命令的必要Audit與業務寫入同transaction，Audit失敗則rollback。被拒絕／版本衝突／越權等沒有業務寫入的結果，以獨立短transaction插入REJECTED audit後才回response；若DB本身不可用，至少寫結構化security log及告警，不能聲稱已持久化Audit。

### 4.16 Trigger與不可變保護

Migration建立並用真MySQL測試以下保護：

- `purchase_order_status_history`、`goods_receipt_reversals`、`goods_receipt_reversal_details`及`purchasing_audit_logs`拒絕UPDATE／DELETE。
- `purchase_order_approvals`建立後拒絕改snapshot、hash、PO版本、requester及assigned approver；只允許合法lifecycle columns更新。
- `purchase_orders`離開DRAFT後拒絕改Supplier、Currency、Payment Term、dates、Warehouse、Buyer、reference、notes及金額；只允許合法status、progress flags、version及lifecycle actor／time更新。
- `purchase_order_lines`在parent非DRAFT時拒絕改SKU、UOM、quantity、price、dates、notes及snapshots，只允許Posting／Reversal／Close projections。
- `goods_receipts`在CONFIRMED後拒絕改PO、Supplier、business date、delivery note、notes及confirmation result；只允許reversal status／quantity projection。
- `goods_receipt_lines`在parent Confirmed後全部凍結；Reversal只更新原Detail、GR及PO projections，不回寫收貨當時的Line evidence。
- `goods_receipt_details`在parent CONFIRMED後拒絕改physical facts或DELETE，只允許累計reversed quantity。
- PO／GR一旦存在Approval／Confirmed Receipt／Reversal／Audit引用，FK阻止永久刪除。

Trigger不是授權機制；正常寫入仍只能經service。Migration account才可在受控schema變更時移除／重建trigger。

### 4.17 Migration切片與依賴順序

實作時先fetch最新main並配置當時下一個可用migration序號；本文不預留固定號碼。建議每支migration只做一個邏輯增量：

1. `*_seed_purchasing_permissions.js`
2. `*_create_purchasing_settings.js`
3. `*_create_purchasing_document_sequences.js`
4. `*_create_purchase_orders.js`
5. `*_create_purchase_order_lines.js`
6. `*_create_purchase_order_approvals.js`
7. `*_create_purchase_order_status_history.js`
8. `*_create_goods_receipts.js`
9. `*_create_goods_receipt_lines.js`
10. `*_create_goods_receipt_details.js`
11. `*_create_goods_receipt_reversals.js`
12. `*_create_goods_receipt_reversal_details.js`
13. `*_create_purchasing_operation_requests.js`
14. `*_create_purchasing_audit_logs.js`
15. `*_add_purchasing_immutability_triggers.js`

前置Gate：Supplier tables＋lookup、Item tables＋committed receipt lookup、Inventory master／posting tables＋batch contracts均已落地。若provider未就緒，只可交付PO Draft／Approval的feature-disabled slice，不可建立失去FK或用自由文字代替provider ID的臨時表。

---

## 5. API與Internal Interface詳細設計

### 5.1 共通API契約

- JSON envelope沿用`{success,data,meta}`／`{success:false,error,meta}`；`meta`含requestId及timestamp。
- Query params使用camelCase；enum response使用UPPER_SNAKE；使用者可見文字由Frontend error map轉繁中。
- List query統一`page,pageSize,q,sortBy,descending`加特定filters；預設20、上限100；最後以`id`作穩定tie-breaker。
- List response為`{items,total,page,pageSize}`；client service轉成`{rows,rowsNumber}`。
- Timestamp response為epoch ms；日期為`YYYY-MM-DD`；money及非整數quantity為decimal string。
- 所有POST commands要求`eventId`、`Idempotency-Key:eventId`；mutable resource另帶`version`。
- Schema一律`additionalProperties:false`。IDs為positive safe integer；reason trim後5～500字；notes最大2000；references最大190。
- 409 version conflict只回`currentVersion`及安全摘要，不自動覆蓋或洩漏無權detail。
- CSV response使用`Content-Disposition`、`Cache-Control:no-store, private`及`X-Content-Type-Options:nosniff`，公式字首`= + - @ tab CR`必須neutralize。
- Child查詢同時帶owner ID；owner不符與不存在回相同404。

### 5.2 Purchase Order APIs

| Method／Path | Auth／Permission | Handler | 行為 |
| --- | --- | --- | --- |
| `GET /api/v1/purchase-orders` | jwt／`purchasing.view` | `listPurchaseOrdersHandler.js` | Server pagination；PO／Supplier／SKU／status／dates／buyer／currency／outstanding filters。 |
| `POST /api/v1/purchase-orders/create` | jwt／`purchasing.mgmt` | `createPurchaseOrderHandler.js` | 建Draft＋月度編號＋完整Lines；201。 |
| `GET /api/v1/purchase-orders/:id` | jwt／`purchasing.view` | `getPurchaseOrderHandler.js` | Header、lines、approval、GR、progress、history及allowedActions。 |
| `POST /api/v1/purchase-orders/:id/update` | jwt／`purchasing.mgmt` | `updatePurchaseOrderHandler.js` | DRAFT only，完整replace editable projection＋version。 |
| `POST /api/v1/purchase-orders/:id/copy` | jwt／`purchasing.mgmt` | `copyPurchaseOrderHandler.js` | 建新Draft／新編號；重驗所有master，不複製狀態。 |
| `POST /api/v1/purchase-orders/:id/submit` | jwt／`purchasing.mgmt` | `submitPurchaseOrderHandler.js` | 按setting直接Confirm或建立Approval。 |
| `POST /api/v1/purchase-orders/:id/approval/approve` | jwt-password／view＋`purchasing.approval` | `approvePurchaseOrderHandler.js` | Assigned approver only；直接Confirmed。 |
| `POST /api/v1/purchase-orders/:id/approval/reject` | jwt-password／view＋approval | `rejectPurchaseOrderHandler.js` | Reason必填；回Draft。 |
| `POST /api/v1/purchase-orders/:id/approval/withdraw` | jwt／`purchasing.mgmt` | `withdrawPurchaseOrderApprovalHandler.js` | Submitter撤回pending。 |
| `POST /api/v1/purchase-orders/:id/confirmation/withdraw` | jwt／`purchasing.mgmt` | `withdrawConfirmedPurchaseOrderHandler.js` | 零Confirmed GR才可；reason＋version。 |
| `POST /api/v1/purchase-orders/:id/cancel` | jwt／`purchasing.mgmt` | `cancelPurchaseOrderHandler.js` | DRAFT／PENDING／零收貨CONFIRMED；reason。 |
| `POST /api/v1/purchase-orders/:id/close-remaining` | jwt／`purchasing.mgmt` | `closePurchaseOrderRemainingHandler.js` | 指定Lines或全部outstanding；reason＋version。 |
| `GET /api/v1/purchase-order-approvals/mine` | jwt／view＋`purchasing.approval` | `listMyPurchaseOrderApprovalsHandler.js` | 只回assigned actor的Pending；server pagination。 |
| `GET /api/v1/purchase-orders/outstanding` | jwt／`purchasing.view` | `listOutstandingPurchaseOrdersHandler.js` | Supplier／SKU／buyer／delivery／overdue filters。 |
| `GET /api/v1/purchase-orders/export` | jwt／`purchasing.view` | `exportPurchaseOrdersHandler.js` | 同畫面filters；stable CSV v1。 |
| `GET /api/v1/purchase-orders/outstanding/export` | jwt／view | `exportOutstandingPurchaseOrdersHandler.js` | Outstanding CSV v1。 |

Create／Update核心request：

```json
{
  "eventId": "82ab8414-6879-4d87-9857-7ef3accbcf06",
  "version": 3,
  "supplierId": 12,
  "orderingAddressId": 33,
  "currencyCode": "HKD",
  "paymentTermId": 4,
  "orderDate": "2026-09-08",
  "expectedDeliveryDate": "2026-09-15",
  "defaultReceivingWarehouseId": 2,
  "buyerId": 7,
  "supplierReference": "QUOTE-892",
  "notes": "",
  "lines": [
    {
      "id": 101,
      "skuId": 55,
      "purchaseSkuUomId": 88,
      "orderedQuantity": "3.000000",
      "unitPrice": "125.5000",
      "zeroPriceReason": "",
      "expectedDeliveryDate": null,
      "lineNote": ""
    }
  ]
}
```

Create沒有`version`，existing line沒有`id`；Update必須送完整Lines。Client送來的snapshot、factor、base quantity、line amount或total均為unknown property而被拒絕。

Submit request：

```json
{
  "eventId": "88f3c5ab-c8d3-41b0-8293-6058a3a45795",
  "version": 4,
  "assignedApproverId": 19,
  "requestNote": "請覆核本次補貨"
}
```

Approval OFF時`assignedApproverId`必須省略；ON時必填。Server response明確回`outcome:"CONFIRMED"`或`outcome:"PENDING_APPROVAL"`。

### 5.3 Goods Receipt APIs

| Method／Path | Auth／Permission | Handler | 行為 |
| --- | --- | --- | --- |
| `GET /api/v1/goods-receipts` | jwt／`purchasing.view` | `listGoodsReceiptsHandler.js` | GR／PO／Supplier／SKU／status／date／warehouse／risk filters。 |
| `POST /api/v1/goods-receipts/create` | jwt／view＋`receiving.operation` | `createGoodsReceiptHandler.js` | 從單一PO建Draft＋GR Number；201。 |
| `GET /api/v1/goods-receipts/:id` | jwt／`purchasing.view` | `getGoodsReceiptHandler.js` | Header、lines、details、Inventory、reversals、allowedActions。 |
| `POST /api/v1/goods-receipts/:id/update` | jwt／view＋`receiving.operation` | `updateGoodsReceiptHandler.js` | DRAFT only；完整replace、version。 |
| `POST /api/v1/goods-receipts/:id/cancel` | jwt／view＋receiving | `cancelGoodsReceiptHandler.js` | DRAFT only；reason＋version。 |
| `POST /api/v1/goods-receipts/:id/confirm` | jwt／view＋receiving | `confirmGoodsReceiptHandler.js` | 全有或全無Inventory posting。 |
| `POST /api/v1/goods-receipts/:id/reversals/create` | jwt-device-password／view＋`inventory.adjust` | `reverseGoodsReceiptHandler.js` | 部分／全部detail reversal，即時確認。 |
| `GET /api/v1/goods-receipts/export` | jwt／`purchasing.view` | `exportGoodsReceiptsHandler.js` | 同畫面filters；CSV v1。 |

Create只接受`purchaseOrderId,businessReceiptDate,supplierDeliveryNote,notes,eventId`。Server回可收PO lines，但不自動把Outstanding變成已收數量。

Update／Confirm Draft body核心：

```json
{
  "eventId": "9fa8efad-d94c-4882-89df-f8c706df660b",
  "version": 2,
  "businessReceiptDate": "2026-09-08",
  "supplierDeliveryNote": "DN-10028",
  "notes": "",
  "supplierExceptionReason": "供應商已封鎖；本批貨先隔離待採購主管處理",
  "lines": [
    {
      "purchaseOrderLineId": 101,
      "overReceiptReason": "供應商按完整外箱多送2件",
      "skuExceptionReason": "此PO確認後SKU被封存，仍完成在途收貨",
      "details": [
        {
          "id": 501,
          "inputUomId": 5,
          "receivedQuantity": "12.000000",
          "warehouseId": 2,
          "binId": 35,
          "lotNumber": "LOT-260901-A",
          "expiryDate": "2027-09-01",
          "manufactureDate": "2026-09-01",
          "stockStatus": "QUARANTINED",
          "expiryOverrideReason": ""
        }
      ]
    }
  ]
}
```

Draft Save可不送尚未需要的exception reason；Confirm會按提交時事實條件式要求。`receivedBaseQuantity`、over amount、warning codes及Inventory IDs一律由server計算。

Reversal request：

```json
{
  "eventId": "56c40984-a0a9-4df6-8929-5c181cedaeca",
  "version": 4,
  "reason": "收貨數量重複錄入",
  "password": "<current-password>",
  "details": [
    { "goodsReceiptDetailId": 501, "baseQuantity": 2 }
  ]
}
```

Request須device signed；password由auth strategy消耗，不傳入domain hash、log或Audit。

### 5.4 Settings、Audit及Operation APIs

| Method／Path | Auth／Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/purchasing-settings` | jwt／`purchasing.settings` | 回typed singleton、version、最後修改及說明。 |
| `POST /api/v1/purchasing-settings/update` | jwt-device-password／`purchasing.settings` | `requirePoApproval`、version、eventId、reason、password；signed。 |
| `GET /api/v1/purchasing-audit-logs` | jwt／`purchasing.view` | PO／GR／actor／action／outcome／date filters，分頁。 |
| `GET /api/v1/purchasing-operations/by-event/:eventId` | jwt／依原操作permission | 精確查本人可見operation結果；不可列舉。 |

Operation lookup先用eventId找候選，再按target resource及permission做owner-safe projection。不存在與無權同樣404。它只回`status,resultType,resultId,resultSummary,completedAt`，不回request hash、原payload或其他actor資料。

### 5.5 Lookup APIs供頁面使用

| Method／Path | Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/purchasing-lookups/suppliers` | `purchasing.mgmt` | q、skuId；只回Active，relation只影響排序。 |
| `GET /api/v1/purchasing-lookups/skus` | `purchasing.mgmt` | q／barcode；只回新PO可採購SKU、UOM及tracking摘要。 |
| `GET /api/v1/purchasing-lookups/approvers` | `purchasing.mgmt` | Active且有approval permission，排除目前actor。 |
| `GET /api/v1/receiving-lookups/purchase-orders` | view＋`receiving.operation` | Confirmed／Partially Received且hasOutstanding。 |
| `GET /api/v1/receiving-lookups/warehouses` | view＋receiving | Active Warehouses；由Inventory contract提供。 |
| `GET /api/v1/receiving-lookups/warehouses/:id/bins` | view＋receiving | 該Warehouse Active Bins；提交仍重驗。 |

Lookup handlers只做consumer permission及projection，實際資格由provider service決定；不能以直接讀provider tables建立第二份規則。

### 5.6 Response projection

建立具名mapping：`toPurchaseOrderSummary()`、`toPurchaseOrderDetail()`、`toApprovalSummary()`、`toGoodsReceiptSummary()`、`toGoodsReceiptDetail()`、`toReversalResult()`及CSV projections。不得spread DB row。

PO detail至少回：

- Header快照、status、currency、amount strings、version、timestamps、allowedActions。
- 每Line purchase／base UOM、ordered、gross received、reversed、net、outstanding、over-received、closed remaining。
- Approval history、GR摘要、status history及Inventory source links。
- `currentMasterDifferences`與歷史快照分開，不以目前name冒充交易時資料。

GR detail至少回：

- PO／Supplier快照、business／confirmed time、status、delivery note、version及risk flags。
- Receipt Lines、Physical Details、warning codes、reasons、minimum life evidence、movement IDs及reversed quantities。
- Reversal history及PO最新progress link。

### 5.7 穩定公開錯誤碼

| HTTP | Code | 條件 |
| --- | --- | --- |
| 400 | `PURCHASING_INPUT_INVALID` | AJV schema、未知欄位、長度或格式。 |
| 400 | `PURCHASING_QUANTITY_INVALID`／`UOM_CONVERSION_INVALID` | 0／負數／scale／非整數Base／超上限。 |
| 400 | `UNIT_PRICE_INVALID`／`ZERO_PRICE_REASON_REQUIRED` | Price scale／負值／零價缺原因。 |
| 404 | `PURCHASE_ORDER_NOT_FOUND`／`GOODS_RECEIPT_NOT_FOUND` | 不存在或owner不符。 |
| 409 | `PO_STATE_CONFLICT`／`GR_STATE_CONFLICT` | 狀態不允許命令。 |
| 409 | `VERSION_CONFLICT` | Stale version。 |
| 409 | `PURCHASING_EVENT_CONFLICT`／`IDEMPOTENCY_CONFLICT` | 同event不同payload。 |
| 409 | `PO_APPROVAL_REQUIRED`／`PO_APPROVER_INVALID` | Policy／指定人錯誤。 |
| 403 | `SELF_APPROVAL_DENIED`／`APPROVAL_ASSIGNEE_MISMATCH` | 職責分離。 |
| 409 | `SUPPLIER_NOT_PURCHASABLE`／`SKU_NOT_PURCHASABLE` | 新PO提交時Provider不合資格。 |
| 409 | `SUPPLIER_EXCEPTION_REASON_REQUIRED` | Existing PO非Active Supplier缺原因。 |
| 409 | `BLOCKED_SUPPLIER_QUARANTINE_REQUIRED` | Blocked Supplier detail不是QUARANTINED。 |
| 409 | `SKU_COMMITMENT_REASON_REQUIRED` | Existing PO SKU目前狀態／flags改變但缺原因。 |
| 409 | `PO_LINE_NOT_RECEIVABLE`／`GR_DETAIL_MISMATCH` | Line不屬PO、已關閉或替換SKU。 |
| 409 | `OVER_RECEIPT_REASON_REQUIRED` | 提交時Over>0缺原因。 |
| 409 | `DUPLICATE_RECEIPT_DIMENSION` | 同GR重複physical bucket。 |
| 409 | `LOT_REQUIRED`／`EXPIRY_REQUIRED`／`LOT_DATA_CONFLICT`／`LOT_EXPIRED` | Tracking及Lot規則。 |
| 409 | `MINIMUM_RECEIPT_LIFE_FAILED` | 低效期未合法override。 |
| 409 | `WAREHOUSE_INVALID`／`BIN_INVALID`／`BIN_WAREHOUSE_MISMATCH` | Inventory master。 |
| 409 | `RECEIPT_REVERSAL_EXCEEDS_AVAILABLE` | 超過detail尚可反向量。 |
| 409 | `RECEIPT_REVERSAL_NOT_ALLOWED` | Inventory現況不容許反向。 |
| 409 | `CONCURRENT_OPERATION` | Deadlock／lock timeout可安全重新讀取。 |
| 403 | `PERMISSION_STALE`／`EXPIRY_OVERRIDE_DENIED` | 撤權、停用或無例外權。 |
| 503 | `PURCHASING_DEPENDENCY_UNAVAILABLE` | 必要Supplier／Item／Inventory／DB依賴不可用。 |
| 500 | `TRANSACTION_OUTCOME_UNKNOWN` | COMMIT結果未知；必須查operation。 |

底層Inventory error使用明確mapping保留可行動語意，不直接把SQL、constraint、stack或內部path回client。Frontend在`errorMessages.js`為每個使用者可見code提供繁中訊息及下一步。

---

## 6. 權限、安全與威脅模型

### 6.1 Permission Catalogue

| Permission | Backend能力 | 頁面能力 |
| --- | --- | --- |
| `purchasing.view` | 查PO／GR／Audit、export、print data | 所有read-only頁面。 |
| `purchasing.mgmt` | PO Draft CRUD、submit、withdraw、cancel、close | PO create／edit及lifecycle actions。 |
| `purchasing.approval` | 只處理assigned approval | 「待我審批」及approve／reject。 |
| `receiving.operation` | GR Draft CRUD及Confirm | GR create／edit／confirm。 |
| `receiving.expiry.override` | 低於Minimum Life但未Expired的例外 | 顯示override輸入；不含普通收貨權。 |
| `purchasing.settings` | Read／update approval setting | Purchasing Settings。 |
| `inventory.adjust` | Receipt Reversal | GR detail的Reversal action。 |

權限沒有inheritance；角色必須明確同時配置所需集合。`system-admin`名稱不自動繞過route policy。

### 6.2 Authentication strength

| 動作 | authType | 理由 |
| --- | --- | --- |
| 一般查詢、PO Draft、submit／withdraw／cancel／close、GR Draft／Confirm | `jwt` | 已有permission及提交點freshness。 |
| PO approve／reject | `jwt-password` | 審批是職責分離的正式決定。 |
| Purchasing Settings update | `jwt-device-password` | 改變所有後續PO控制政策。 |
| Receipt Reversal | `jwt-device-password` | 直接減少已入庫數量。 |

高強度route的`authType`固定寫在handler static api，不依body或角色動態降低。Client對device-password route使用`signed:true`。Password由auth strategy驗證，不進service、hash、audit或log。

### 6.3 Trust boundary與STRIDE摘要

| 威脅 | 具體濫用 | 控制 |
| --- | --- | --- |
| Spoofing | 偽造approver／receiver或使用被停用token | JWT策略＋device signature＋`assertActorFresh()`。 |
| Tampering | 換PO Line ID收另一SKU、改Total、改Bin owner、重用event換payload | AJV allowlist、composite FK、server計算、owner query、canonical hash。 |
| Repudiation | 否認批准、超收、Blocked收貨、expiry override或reversal | Actor／time／reason／event／request ID及immutable Audit。 |
| Information Disclosure | 透過lookup、錯誤、CSV看到銀行資料、SQL或其他單據 | Projection allowlist、404 owner semantics、safe errors、CSV allowlist、no-store。 |
| Denial of Service | 100+ PO lines、200+ GR details、無界search／export、重試風暴 | Schema caps、server pagination、export caps、HTTP limiter、idempotency、transaction timeout。 |
| Elevation of Privilege | 自建自批、普通receiver做expiry override／reversal、改setting | 分離permissions、assigned approver、fixed authType、service freshness checks。 |

### 6.4 Input、輸出與資料保護

- 自由文字trim、控制字元檢查、長度限制；Vue預設text interpolation，不使用`v-html`顯示使用者內容。
- SQL一律placeholder；sort field及enum由Map轉固定SQL fragment。
- PO／GR不保存Supplier銀行資料。Ordering address只保存業務所需白名單快照。
- API及CSV不回password、token、raw claims、request hash、完整Audit detail、SQL、stack或內部path。
- CSV neutralization在最後serialization前執行，不以UI顯示值代替安全處理。
- 所有JSON response及下載`Cache-Control:no-store`；HTTPS、CSP、HSTS及CORS沿用現有framework。
- Retention至少7年；到期清理屬後續受控政策，不在本期加入自動刪除job。

### 6.5 Security abuse tests

- 替換PO／PO Line／GR／Detail／Approval／Warehouse／Bin／Movement IDs。
- 自我批准、非assigned approver、approve後撤權、receiver直接送expiry override flag。
- Client送Total、Base Quantity、warning codes、Inventory IDs或額外欄位。
- 同event並發、同event不同payload、IP相同的兩個高風險使用者。
- CSV formula payload、stored XSS文字、超長reason／note、任意sort column。
- Blocked Supplier把部分details改AVAILABLE；SKU archived時省略原因。
- Reversal超量、反向別張GR movement、Counting Bin、已Allocation庫存。

---

## 7. UI／UX詳細設計

所有頁面必須完全依`docs/frontend-design.md`實現：頁面使用`PageHeader`，列表使用`DataTable`，表單使用`FormPanel`，長文字使用`EllipsisCell`，高風險操作使用既有confirm helpers，結果使用`notifySuccess`／`notifyError`。不得直接使用raw `q-table`、inline hex、emoji icon或另一套表單錯誤流程。

### 7.1 Navigation與頁面權限

在`client/config/menu.js`新增一個群組：

```js
{
  name: "purchasingReceiving",
  label: "採購與收貨",
  icon: "local_shipping",
  order: 300
}
```

| Page／Route | Menu | Requires | 主要用途 |
| --- | --- | --- | --- |
| `PurchaseOrdersPage.vue` `/purchasing/purchase-orders` | 採購單 | `purchasing.view` | 列表、filter、progress及新增入口。 |
| `PurchaseOrderCreatePage.vue` `/purchasing/purchase-orders/new` | 否 | `purchasing.mgmt` | 建立Draft。 |
| `PurchaseOrderDetailPage.vue` `/purchasing/purchase-orders/:id` | 否 | `purchasing.view` | Header、lines、approval、receipts、history及actions。 |
| `PurchaseOrderEditPage.vue` `/purchasing/purchase-orders/:id/edit` | 否 | `purchasing.mgmt` | DRAFT only。 |
| `PurchaseOrderPrintPage.vue` `/purchasing/purchase-orders/:id/print` | 否 | `purchasing.view` | A4 browser print。 |
| `MyPurchaseOrderApprovalsPage.vue` `/purchasing/approvals` | 待我審批 | view＋`purchasing.approval` | Assigned pending工作清單。 |
| `OutstandingPurchaseOrdersPage.vue` `/purchasing/outstanding` | 未完成採購 | `purchasing.view` | 逾期及outstanding分析。 |
| `GoodsReceiptsPage.vue` `/receiving/goods-receipts` | 收貨單 | `purchasing.view` | GR列表及risk filters。 |
| `GoodsReceiptCreatePage.vue` `/receiving/goods-receipts/new` | 否 | view＋`receiving.operation` | 選PO並建立Draft。 |
| `GoodsReceiptDetailPage.vue` `/receiving/goods-receipts/:id` | 否 | `purchasing.view` | Details、Inventory、Reversal及Audit。 |
| `GoodsReceiptEditPage.vue` `/receiving/goods-receipts/:id/edit` | 否 | view＋receiving | DRAFT錄入及Confirm。 |
| `PurchasingSettingsPage.vue` `/purchasing/settings` | 採購設定 | `purchasing.settings` | Approval setting及history。 |

Page metadata只控制入口顯示；後端仍獨立驗權。詳情頁按API `allowedActions`及frontend permission共同決定按鈕，任一方不允許即隱藏／disabled，但不能依此取代server guard。

### 7.2 Purchase Orders列表

- `DataTable` server-side模式，預設`updatedAt DESC,id DESC`，有actions欄時使用`sticky-actions`。
- Filters：q、status、supplier、buyer、currency、order date、delivery date、hasOutstanding；全部同步URL query。
- Columns：PO Number、Supplier、Order Date、Expected Delivery、Currency、Total、Received／Ordered進度、Outstanding、Status、Updated At、Actions。
- Status badge連繁中label，不只用顏色；超收、逾期、零價及非Active master差異用icon＋文字。
- `purchasing.mgmt`才顯示「新增採購單」；row actions只顯示當前合法行為。
- CSV export沿用目前filters；截斷或達上限時UI清楚提示，不默默漏資料。

### 7.3 PO建立／編輯

版面分四個`FormPanel` section，但一次提交整張aggregate：

1. Supplier與商業條件：Supplier、ordering address、currency、payment term、order／delivery dates、default Warehouse、Buyer。
2. PO Lines：SKU搜尋／barcode、Purchase UOM、quantity、base conversion、unit price、line amount、zero-price reason、delivery date、note。
3. Notes／Reference。
4. Total及風險摘要。

桌面使用可編輯line grid；375／768px改為每Line card／accordion，不把100欄寬表格縮入手機。新增／刪除／排序可用鍵盤按鈕，不只靠drag-and-drop。每Line保留穩定local key；server回傳後改用正式ID。

Supplier選中時載入default值，但使用者覆寫後不因後續lookup refresh自動蓋掉。SKU選中時顯示purchase資格、Base UOM、可用Pack UOM、factor及Tracking。Browser預覽金額使用同一decimal string helper，但保存後以server值為準。

Submit前顯示Supplier、Line數、總額、Currency、交期、零價及缺Payment Term提示。Approval ON時顯示Approver選擇；OFF時明確顯示「確認後可收貨」。離開dirty form須確認。

### 7.4 PO詳情、審批及Close

- Header顯示快照資料；如目前Supplier／SKU名稱或狀態不同，以「目前主資料」另區顯示，不改歷史。
- Lines同時顯示Ordered Purchase UOM、Ordered Base、Gross Received、Reversed、Net、Outstanding、Over-received及Closed Remaining。
- Tabs／sections：概覽、Lines、Approval History、Goods Receipts、Status History、Audit。
- Pending頁及詳情顯示完整Approval snapshot，不能以目前PO Draft資料代替。
- Approve／Reject使用`promptPassword()`；Reject要求reason。非assigned使用者不顯示操作。
- Withdraw、Cancel、Close Remaining均顯示影響及reason dialog。Close可勾選一或多個仍有Outstanding的Lines，顯示將關閉數量。
- 已有Confirmed GR後不顯示Edit、Cancel或Withdraw Confirmation。

### 7.5 Goods Receipts列表與建立

- GR list filters：GR／PO、Supplier、SKU、status、business date、Warehouse、hasOverReceipt、hasExpiryOverride、hasSkuException。
- Columns：GR Number、PO Number、Supplier、Receipt Date、Quantity、Warehouse count、Risk labels、Status、Confirmed By／At、Actions。
- 建立流程先搜尋可收PO；選中後只把PO Lines及Outstanding載入作參考，不自動填任何received quantity。
- Duplicate Delivery Note warning列出最多5張近期同Supplier GR連結，但使用者可確認「不是重複」繼續保存。

### 7.6 GR Draft錄入

- 頂部固定顯示PO、Supplier、Receipt Date、Delivery Note及整體warning。
- 左側／上方為PO Lines與歷史進度；右側／下方為本次Physical Details。
- Barcode掃描只定位這張PO內唯一合法Line；0或多個匹配均要求人工選擇，不靜默取第一個。
- 每個PO Line可「新增分拆」，輸入UOM、quantity、Warehouse、Bin、Lot、Expiry、Manufacture及Status。
- Warehouse選中後只列該Warehouse Active Bins；更換Warehouse會清空Bin，不能保留舊owner ID。
- Tracking欄位由PO snapshot決定顯示與必填；當目前Tracking不同，顯示差異warning及SKU reason欄。
- 每Line即時顯示本次Base總數、提交前Outstanding預覽、可能Over-received及reason；正式結果以Confirm時server重算。
- Blocked Supplier時Stock Status控制固定為Quarantined並說明原因；不能只在提交後才報錯。
- Minimum Life顯示門檻、剩餘天數及資格。無override permission者看到阻擋原因；有權者才顯示reason輸入。
- Confirm前顯示逐detail「將增加哪個Warehouse／Bin／Lot／Status多少Base UOM」及「整張全有或全無」。

### 7.7 Timeout、衝突及恢復

- Save失敗保留local Draft輸入；validation error由`FormPanel`集中摘要並focus。
- Version conflict顯示server最新status／version；使用者可下載／複製自己輸入，但不得一鍵無腦覆蓋。
- Confirm timeout顯示eventId與「查詢處理結果」按鈕；結果Confirmed則導向GR detail，Not Found才允許用原eventId重試。
- `CONCURRENT_OPERATION`先reload PO／GR；如重新提交代表新意圖才產生新eventId。
- Confirmed GR detail只讀；Reversal按鈕只對具`inventory.adjust`者顯示並使用device-password dialog。

### 7.8 A4 browser print

- `PurchaseOrderPrintPage.vue`讀取PO detail snapshot，使用專用`@media print` CSS及語意table。
- A4 portrait為預設；100 Lines可自然分頁，header在每頁重現，行不可被不合理切斷。
- 顯示公司名稱、PO Number、Supplier／Ordering Address、Order／Delivery Date、Currency、Payment Term、Lines、Unit Price、Line Amount、Total及Notes。
- 只允許Confirmed／Partially Received／Fully Received／Closed PO列印正式版本；Draft列印顯示明顯「草稿」水印。
- 不保存生成檔，不加入PDF dependency；瀏覽器另存PDF是使用者端功能。

### 7.9 Accessibility及responsive驗收

- 每頁一個真正`h1`，section headings順序正確；dialog title使用`h2`。
- 所有input有label／hint／error；line錯誤同時出現在欄位及總覽，不只用紅框。
- Icon-only按鈕有`aria-label`；decorative icon有`aria-hidden`；status不只靠顏色。
- Keyboard可完成新增Line、分拆Detail、選Warehouse／Bin、提交、批准、Confirm及Close。
- Dialog有focus trap並返回觸發按鈕；table loading有`aria-busy`。
- 375／768／1024／1440px實測；窄屏使用cards／accordion，主要action保持可見且不出現頁面級橫向捲動。
- Chrome、Edge、Safari目前支援版本執行核心流程；console無error／warning。

---

## 8. Service與核心算法詳細設計

### 8.1 `PurchasingSequenceService`

`nextNumberInTransaction(transaction,{documentType,localDate})`：

1. 驗證documentType allowlist。
2. 從APP_TIME_ZONE local date取得`YYYYMM`，不使用server OS timezone。
3. Upsert sequence row並`FOR UPDATE`。
4. 若current>999999回`DOCUMENT_SEQUENCE_EXHAUSTED`，不得轉成7位或重置。
5. 格式化6位數並更新`next_value=current+1`。
6. 返回`{number,yearMonth,sequenceNo}`；只有外層transaction commit才正式使用。

### 8.2 `PurchaseOrderService`

`create()`及`update()`共用`validateDraftProjection()`：

- 批量載入Supplier defaults、SKU／UOM、Currency、Payment Term、Warehouse及Buyer；禁止逐Line N+1。
- Supplier Relation只帶入建議值，不阻止沒有relation的Active Supplier。
- Purchase UOM必須屬SKU；factor server讀取。Decimal quantity乘factor後必須整數Base。
- SKU必須`purpose:"purchase"`可用、`inventoryTracked=true`且tracking不為serial，否則新PO不可確認；Draft可保存暫時未完整資料，但submit完整重驗。
- Draft save可容許Supplier／SKU在載入後剛失效，response標warning；submit／approve必須fail closed。
- 金額用`moneyMath`計算；client amount被schema拒絕。
- Update先鎖PO並CAS version，再完整compare children；任何child ID不屬PO回404。
- Create、copy及update都claim event。Copy只複製仍合法的editable values；新編號、新IDs、新version，無approval／receipt歷史。

### 8.3 `PurchaseApprovalService`

`submit()`鎖setting→PO→lines；完整驗證後：

- Policy OFF：呼叫Lifecycle內部`confirmValidatedDraftInTransaction()`，寫status history及Audit。
- Policy ON：重讀assigned user的Active狀態及permission，拒絕自己，建立snapshot／hash／pending approval並改PO status。

`approve()`鎖PO→pending approval→lines，檢查actor是assigned、不是submitter、approval與PO versions一致，再重新驗證Supplier／SKU／UOM／Currency。任何失效令approval保留PENDING但回可行動錯誤；提交人可withdraw後修正。Approve成功直接CONFIRMED。

`reject()`及`withdraw()`只轉pending approval status及PO回DRAFT，不改snapshot。所有操作使用event claim，防雙擊與並發決定；PO root lock令Approve與Withdraw只有一個勝出。

### 8.4 `PurchaseOrderLifecycleService`

- `withdrawConfirmation()`／`cancel()`以`has_confirmed_receipt=0`及實際`NOT EXISTS confirmed GR`雙重驗證，不只信projection。
- `closeRemaining()`鎖PO及指定Lines；每Line關閉當刻的`max(ordered-net,0)`，已0的Line拒絕或明確no-op，不允許client送關閉數量。
- `closeRemaining()`只接受PARTIALLY_RECEIVED PO。取消PENDING_APPROVAL PO時，同一transaction把pending approval轉為INVALIDATED；不可留下仍可批准的request。
- `recalculateStatusInTransaction()`只接受已鎖PO及Lines，依§3.2公式決定CONFIRMED／PARTIALLY_RECEIVED／FULLY_RECEIVED／CLOSED。
- CLOSED及CANCELLED不重開。Reversal遇人工CLOSED只更新數量、Audit及`hasOutstanding=false`，另回`CLOSED_PO_RECEIPT_GAP`warning。
- 每次狀態改變append status history；數量變但status未變仍寫Audit，不造假status event。

### 8.5 `GoodsReceiptService`

- Create鎖／讀PO確認可收、分配GR Number、保存空Draft；只允許CONFIRMED／PARTIALLY_RECEIVED且至少一Line有Outstanding。
- Draft Update鎖GR並CAS version，批量owner驗證PO Lines、SKU、UOM、Warehouse／Bin lookup；允許保存尚缺Confirm條件的資料，但0／負數、owner mismatch、未知ID及重複dimension不能保存。
- Lines由details聚合；client不能送line total。Service把per-line reasons保存，但Confirm才決定是否必填。
- Cancel只限DRAFT且reason必填；保留Number及資料快照供Audit，不永久刪除。
- Duplicate Delivery Note query限定同Supplier、非Cancelled、近90日、最多5筆；只回warning。

### 8.6 `ReceivingPolicyService`

此service保持純函式，輸入已載入的PO snapshot、current provider projections、日期、actor permissions及details，輸出normalized command或完整issues array。

主要方法：

```js
calculateBaseQuantity({ quantity, factor })
evaluateSupplierException({ currentStatus, details, reason })
evaluateSkuCommitment({ poSnapshot, currentSku, reason })
validateTracking({ policy, lotNumber, expiryDate, manufactureDate })
evaluateMinimumLife({ receiptDate, expiryDate, snapshotDays, currentDays, canOverride, reason })
calculateOverReceipt({ outstandingBefore, receivedBaseQuantity, reason })
assertUniqueDimensions(details)
```

Issues使用`{path,code,messageKey,meta}`，不含SQL或敏感值。Service一次回所有可修正field issues；permission／owner／狀態等安全錯誤可立即fail。

### 8.7 `GoodsReceiptPostingService`

Confirm實作要點：

- Lock PO root令同PO所有Confirm／Close／Reversal序列化；不可只靠optimistic version，因兩張不同GR各有自己的version。
- 依`purchase_order_line_id`排序鎖Lines；先以當前net與closed計算outstanding，再判超收。
- 所有details先完成policy validation，然後一次呼叫Inventory batch；不得在部分Inventory成功後才驗下一Detail。
- `overReceived=0`時server把`overReceiptReason`正規化為空字串，不建立虛假的超收Audit；只有提交時重新計算為正數的Line才保存原因及risk flag。
- Inventory command使用內部ID作source：

```js
{
  actor,
  authorization: {
    purpose: "PURCHASE_RECEIPT",
    requiredCallerPermission: "receiving.operation"
  },
  source: {
    module: "PURCHASING_RECEIVING",
    documentType: "GOODS_RECEIPT",
    documentId: String(goodsReceiptId),
    eventId
  },
  lines: [
    {
      sourceLineId: String(goodsReceiptDetailId),
      skuId,
      baseQuantity,
      warehouseId,
      binId,
      trackingPolicy: poTrackingSnapshot,
      lotNumber,
      expiryDate,
      manufactureDate,
      stockStatus,
      minimumLifeEvidence
    }
  ]
}
```

- Inventory response為`{operationId,movementId,movementGroupId,baseQuantity}` per sourceLineId；集合必須與request details完全相等，否則視為provider contract breach並rollback。
- 寫PO progress時使用BigInt／DB integer，不以client或Inventory aggregate猜測。GR與PO updated version各加1。
- 成功response在transaction內存最小result summary，回應遺失可按event查回。

### 8.8 `ReceiptReversalService`

- 鎖GR→PO→Receipt Details→PO Lines→既有Reversal Details；驗證GR已Confirmed或Partially Reversed。
- 對每Detail計算`reversible=received-reversed`，server不信client顯示值。
- 呼叫Inventory batch partial reversal，source document為`GOODS_RECEIPT_REVERSAL`，sourceLineId使用新Reversal Detail ID。
- Inventory鎖原Movement及current buckets，累計反向不超原Movement；OUT效果不可令On Hand／free quantity等違規。
- 任何Inventory line missing／extra、quantity不符或operation衝突整次rollback。
- 成功後更新Detail／GR反向projection及PO progress，appendstatus history（如狀態變）、Purchasing／Inventory Audit及domain result。

### 8.9 Query、CSV與對賬

- PO／GR列表先查root IDs page，再以bounded batch query載入必要summary，避免join child後count重複。
- q搜尋優先精確PO／GR Number、Supplier Code、SKU Code／Barcode；name搜尋先由provider lookup取得最多100 IDs再filter，不用`%term%`掃全部交易表。
- CSV使用keyset pagination及streaming；預設最大50,000 rows、120秒，達上限加response header及最後summary row。
- Reconciliation只讀比較：

```text
PO Line gross = SUM(Confirmed GR Detail received)
PO Line reversed = SUM(Confirmed Reversal Detail quantity)
PO Line net = gross - reversed
GR detail movement IN = receivedBaseQuantity
GR detail reversal movement OUT sum = reversedBaseQuantity
Inventory source detail集合 = Confirmed GR／Reversal detail集合
```

差異產生告警及報表，不直接UPDATE數字掩蓋事故。

---

## 9. 具體程式碼架構與變更清單

### 9.1 修改既有檔案

| File | 變更 |
| --- | --- |
| `server/src/modules/authorization/permissionCatalogue.js` | 新增六項Purchasing／Receiving permissions；`inventory.adjust`由Inventory模組新增，不重複定義。 |
| `server/src/services/idempotency/IdempotencyService.js` | 修正authenticated JWT strategy identity scope，並補高強度route tests。 |
| `server/src/modules/item/itemConstants.js` | 加入專用committed receipt lookup用途／warning allowlist。 |
| `server/src/modules/item/ItemLookupService.js` | 新增`findManyForCommittedReceipt()`；不改既有purchase／inventory語意。 |
| `client/config/menu.js` | 新增`purchasingReceiving`群組。 |
| `client/src/framework/http/errorMessages.js` | 新增§5.7錯誤的繁中訊息。 |
| `server/config/scheduler.js` | 只在實作soft supply projection reconciliation job時加具名job；核心Phase不預先加空job。 |
| Inventory module files（落地時） | 新增batch purchase receipt／partial reversal contracts及reversal link規則，保持其他Inventory API不變。 |
| Supplier module files（落地時） | 新增purchase defaults及idempotent recordSupply contract；不得回銀行資料。 |

不需要修改`BaseRequestHandler`、handler discovery、`HttpClient`基本信封、DataTable或FormPanel；現有framework已能支援本模組。

### 9.2 新增Backend設定及Domain files

```text
server/config/purchasing.js
server/src/modules/purchasing/
  purchasingConstants.js
  purchasingErrors.js
  purchasingValidation.js
  moneyMath.js
  quantityMath.js
  purchaseOrderStateMachine.js
  purchasingProjections.js
  purchasingCsv.js
  PurchasingSequenceService.js
  PurchasingOperationService.js
  PurchasingAuditService.js
  PurchasingSettingsService.js
  PurchaseOrderService.js
  PurchaseApprovalService.js
  PurchaseOrderLifecycleService.js
  GoodsReceiptService.js
  ReceivingPolicyService.js
  GoodsReceiptPostingService.js
  ReceiptReversalService.js
  PurchasingInquiryService.js
  PurchasingReconciliationService.js
```

`moneyMath`／`quantityMath`是純函式；Service不另建repository abstraction，直接以注入的database executor寫清楚參數化SQL，符合現有codebase。只有當第二個真實storage implementation出現才抽repository。

### 9.3 新增Handlers與schemas

```text
server/src/handlers/purchasing/
  purchasingSchemas.js
  listPurchaseOrdersHandler.js
  getPurchaseOrderHandler.js
  createPurchaseOrderHandler.js
  updatePurchaseOrderHandler.js
  copyPurchaseOrderHandler.js
  purchaseOrderApprovalHandlers.js
  purchaseOrderLifecycleHandlers.js
  listOutstandingPurchaseOrdersHandler.js
  purchasingExportHandlers.js
  purchasingSettingsHandlers.js
  purchasingAuditHandler.js
  purchasingOperationLookupHandler.js
  purchasingLookupHandlers.js

server/src/handlers/receiving/
  receivingSchemas.js
  listGoodsReceiptsHandler.js
  getGoodsReceiptHandler.js
  createGoodsReceiptHandler.js
  updateGoodsReceiptHandler.js
  cancelGoodsReceiptHandler.js
  confirmGoodsReceiptHandler.js
  reverseGoodsReceiptHandler.js
  receivingExportHandler.js
  receivingLookupHandlers.js
```

相同auth／schema但不同業務動作可用小型handler base class減少重複；不同authType必須是不同class／static api，不可用body選擇。

### 9.4 新增Frontend files

```text
client/src/services/purchasing.js
client/src/pages/purchasing/
  PurchaseOrdersPage.vue
  PurchaseOrderCreatePage.vue
  PurchaseOrderEditPage.vue
  PurchaseOrderDetailPage.vue
  PurchaseOrderPrintPage.vue
  MyPurchaseOrderApprovalsPage.vue
  OutstandingPurchaseOrdersPage.vue
  PurchasingSettingsPage.vue
client/src/pages/receiving/
  GoodsReceiptsPage.vue
  GoodsReceiptCreatePage.vue
  GoodsReceiptEditPage.vue
  GoodsReceiptDetailPage.vue
client/src/components/purchasing/
  PurchaseOrderForm.vue
  PurchaseOrderLineEditor.vue
  PurchaseOrderProgress.vue
  PurchaseOrderRiskSummary.vue
  ApprovalSnapshotPanel.vue
client/src/components/receiving/
  GoodsReceiptForm.vue
  ReceiptLineEditor.vue
  ReceiptDetailEditor.vue
  ReceivingRiskSummary.vue
  ReceiptReversalDialog.vue
client/src/composables/purchasing/
  usePurchasingFilters.js
  useCommandEvent.js
```

`useCommandEvent`只在一個intent生命週期內產生／保存UUID，成功或使用者明確開始新意圖才清除；它不把eventId放URL或localStorage長期保存。

### 9.5 新增Migrations及Test Support

- 新增§4.17的migration files，實作時才填連續號碼。
- `server/test-support/fakePurchasingDatabase.js`只支援unit service所需明確queries；跨表約束與transaction不以fake代替真MySQL integration。
- 如Inventory／Supplier provider尚未落地，先提供contract fakes與consumer contract tests；不可在production service中加入假fallback。

---

## 10. Unit Test設計

### 10.1 原則與門檻

- 新domain code line coverage至少95%、branch至少90%、function至少95%；不得降低repository既有全域floor。
- 純算法先測再實作；每個公開錯誤碼至少一個負向case。
- Unit tests不連真DB；transaction、FK、trigger、lock、decimal DB round及並發由Integration驗證。
- 測試時間使用fake time，固定APP_TIME_ZONE；不得依執行機器現在日期。

### 10.2 Pure calculation／validation tests

#### `server/test/purchasingMoneyMath.test.js`

- Unit Price 0／4 decimals、Quantity 6 decimals、Currency scale 0～4。
- HALF_UP邊界：1.004／1.005／1.006；每Line round後加總與先總後round不同的案例。
- 大數乘法、leading zeros、非法scientific notation、負數、超scale及overflow。
- API固定decimal string及CSV／print formatter一致。

#### `server/test/purchasingQuantityMath.test.js`

- 3 BOX×24=72 EA、0.5 BOX×24=12、不能整除Base、0／負／超MAX_SAFE。
- gross／reversed／net／outstanding／over／closed公式及BigInt邊界。
- Reversal後Fully Received→Confirmed／Partially Received；Closed不重開。

#### `server/test/purchaseOrderStateMachine.test.js`

- 所有合法及非法From→To；有Receipt時禁止withdraw／cancel。
- Approval ON／OFF分支、reject／withdraw返回Draft、terminal states。
- Line close與status推導，不允許client指定任意status。

#### `server/test/receivingPolicy.test.js`

- Tracking none／batch／batch_expiry及serial拒絕新PO。
- Supplier Active／Suspended／Archived／Blocked；Blocked只可Quarantined。
- SKU status／flags／tracking變更要求reason但不拒絕existing commitment。
- Expired不可override；minimum life較嚴格規則、permission及reason。
- Short／exact／over receipt；提交時outstanding改變後重新計算。
- Duplicate dimension、Bin owner、Lot normalize、Manufacture／Expiry ordering。

#### `server/test/purchasingValidation.test.js`

- IDs、dates、reason／notes length、event UUID、decimal strings、line／detail count caps。
- additional properties、client totals／snapshots／warning flags被拒絕。
- CSV formula neutralization及stable column order。

### 10.3 Service unit tests

#### `purchasingSequenceService.test.js`

- PO／GR獨立序列、跨月重置、6位padding、999999耗盡、rollback不留下已用number。

#### `purchaseOrderService.test.js`

- Create／update／copy、Supplier soft relation非白名單、defaults可覆寫、批量SKU lookup。
- 完整Draft replace、foreign child ID、version conflict、provider失效、serial、zero price。
- 同event replay／conflict、Audit failure rollback、server total。

#### `purchaseApprovalService.test.js`

- OFF直接Confirm；ON指定另一人；self／non-assignee／inactive／撤權拒絕。
- Snapshot hash、PO version變動、approve／withdraw race、reject reason、replay。

#### `purchaseOrderLifecycleService.test.js`

- Confirmed zero receipt withdraw／cancel、confirmed receipt guard、close selected／all lines。
- Recalculate status、history append、CLOSED reversal gap。

#### `goodsReceiptService.test.js`

- Create只接受可收PO；Draft save不動Inventory；完整replace及duplicate dimension。
- Delivery note warning不阻擋；cancel保留number；owner mismatch。

#### `goodsReceiptPostingService.test.js`

- 多detail單次batch call、provider result集合精確match、全有或全無。
- Supplier／SKU exceptions、overreceipt、minimum life、Blocked quarantine。
- Inventory failure／Audit failure rollback、timeout result lookup、兩GR序列化所需lock順序。

#### `receiptReversalService.test.js`

- 部分／全部／多detail反向、超量、重播／conflict、Inventory拒絕、GR／PO status更新。
- Closed PO不重開、原Movement不改、result mapping missing／extra時rollback。

#### `purchasingInquiryService.test.js`

- Server pagination、allowlist sort、filters、root-first query、CSV cap、projection不含銀行／內部欄位。

### 10.4 Handler、Client service及Framework regression

- 每個Handler測method／path／authType／permissions／idempotency／schema及response status。
- 確認所有command的`eventId`與Idempotency-Key相同；missing／mismatch拒絕。
- `IdempotencyService`測`jwt-password`／`jwt-device-password`按user隔離，兩個同IP使用者不共享key。
- `client/test/services/purchasing.test.js`測URL、params、body、signed flag、event key reuse、DataTable projection及AbortSignal。

---

## 11. Integration、Frontend、安全與效能測試

### 11.1 真MySQL Migration／Constraint Integration

- 乾淨DB完整migrate及重跑skip；從當前schema forward migrate。
- PO／GR number unique、sequence concurrent allocation及month boundary。
- 所有FK／composite FK：GR→PO Supplier、Detail→GR／PO Line／SKU、Bin→Warehouse、UOM→SKU。
- Generated pending slot、duplicate dimension、event unique及actor SET NULL。
- Immutability triggers阻止Confirmed commerce fields、Movement／history／audit update或delete。
- Decimal欄位精度、大數上限及JSON payload size service guard。
- Migration失敗可識別停在哪一支；DDL不可假設rollback。

### 11.2 API＋DB Integration

`server/test/integration/purchasingManagement.integration.test.js`：

- Settings default／update、PO CRUD、金额、UOM、Approval OFF／ON、lifecycle及CSV。
- Supplier／SKU提交時失效、snapshot不回寫、權限及high-auth routes。

`server/test/integration/receivingManagement.integration.test.js`：

- Partial／multi-lot／multi-bin／multi-status／over receipt、current master warnings。
- Blocked Supplier Quarantined、Archived SKU＋reason、Expired及minimum life。
- Confirm全有或全無、PO progress、Inventory Balance／Movement／Audit雙向來源。

`server/test/integration/receiptReversal.integration.test.js`：

- 部分多次反向至上限、跨detail全有或全無、Inventory現況阻擋、PO狀態回退、Closed保持。

### 11.3 真並發與失敗注入

- 20 workers同月建立PO／GR，編號唯一且連續commit結果無重用。
- Approve vs withdraw、Confirm vs close、兩GR同PO Line、Confirm vs cancel、兩Reversal同Detail。
- 同event同payload並發只一個結果；同event不同payload一個成功一個409。
- 在Inventory第N detail、Audit insert、PO progress update前注入失敗，證明全部rollback。
- COMMIT response遺失後按event查唯一結果，不重複Movement。
- Deadlock／lock timeout映射`CONCURRENT_OPERATION`且無部分資料。

### 11.4 Consumer／Provider contract tests

- Supplier projection永不含bank fields；purchase只Active，history回Blocked等狀態。
- Item committed receipt lookup對Inactive／Discontinued／Archived／flag changes回warning而非不可用；不存在仍fail。
- Inventory batch receipt接受多details並先claim後lock；結果集合與sourceLine一對一。
- Inventory partial reversal允許同原Movement多次反向但sum不超原量；generic full reversal行為不被破壞。
- Provider dependency unavailable時Receiving fail closed且GR保持Draft。

### 11.5 Vue page／component tests

- List URL filters、server pagination、sticky actions、empty／loading／retry。
- PO form defaults不覆寫使用者修改、decimal preview、line cards mobile、dirty leave guard。
- Approval snapshot、assigned actions、password dialog及reason validation。
- GR拆分、barcode 0／1／many matches、Warehouse清Bin、tracking fields、risk summary。
- Blocked supplier status control固定Quarantined；SKU warning及reason focus。
- Confirm timeout operation lookup、version conflict保留輸入、Confirmed read-only。
- Print A4 DOM、draft watermark、snapshot內容及print CSS。
- Accessibility：heading、label、role alert、focus、aria-label、status文字及keyboard flow。

### 11.6 Security tests

- 401／403矩陣覆蓋全部routes；view-only無任何寫入；settings／approval／reversal authentication strength。
- Horizontal ID substitution及owner mismatch不洩漏存在性。
- Permission撤銷／user停用後提交被`PERMISSION_STALE`拒絕。
- SQL／XSS／CSV formula／超長payload／任意sort／unexpected property。
- Password、token、bank data、raw payload、SQL、stack及internal path不出現在response／log／audit／CSV。
- Native package audit在release前執行；本模組不新增dependency，若日後增加必須另行評審。

### 11.7 效能與容量

基線：100,000 SKUs、10,000 Suppliers、每年50,000 POs×100 Lines、100,000 GRs×200 Details、20 concurrent users。

| 測試 | 目標 |
| --- | --- |
| 精確PO／GR／SKU／barcode查找 | p95 < 2s |
| 常用PO／GR／Outstanding第一頁 | p95 < 2s |
| 100-Line PO save／submit | p95 < 3s，明確loading |
| 200-Detail GR validation／confirm | 正常負載p95 < 5s，完整transaction |
| 50k-row CSV | 在120s cap內stream，不超合理memory budget |

以query count assertion防N+1；使用`EXPLAIN`確認主要filters走§4 indexes。效能失敗不得以移除提交重驗或Audit換取達標。

### 11.8 Backup、Restore及Reconciliation

- Backup包含所有Purchasing、Inventory source及Audit tables。
- 隔離環境restore後執行§8.9 invariants，PO／GR／Movement／Reversal集合100%對賬。
- 以一張含partial、over、reversal、Blocked及Archived SKU的PO作restore smoke。
- 發現差異只產生報告；任何修復使用經批准的一次性migration／正式Adjustment，不直接手改current projection。

---

## 12. Configuration、Logging與營運

### 12.1 `server/config/purchasing.js`

```js
const purchasingConfig = {
  maxPurchaseOrderLines: 100,
  maxGoodsReceiptDetails: 200,
  maxQuantity: Number.MAX_SAFE_INTEGER,
  quantityDecimalPlaces: 6,
  unitPriceDecimalPlaces: 4,
  documentSequenceMax: 999999,
  duplicateDeliveryNoteLookbackDays: 90,
  exportMaxRows: 50000,
  exportTimeoutMs: 120000,
  approvalSnapshotMaxBytes: 65536,
  auditDetailMaxBytes: 8192,
  transactionTimeoutMs: 30000
};
```

PO／GR format、status、permissions、reason rules及7-year retention是domain constants，不用環境變數任意覆寫。Config normalization在startup驗證正整數、上下限及transaction timeout與route timeout關係，錯誤則fail startup。

### 12.2 Audit action allowlist

至少包括：

```text
purchasing.setting.updated
purchase_order.created / updated / copied / submitted / confirmed
purchase_order.approved / rejected / approval_withdrawn
purchase_order.confirmation_withdrawn / cancelled / remaining_closed
goods_receipt.created / updated / cancelled / confirmed
goods_receipt.over_received / supplier_exception / sku_exception / expiry_overridden
goods_receipt.reversed
purchasing.exported / purchasing.operation_conflict
```

每個action有固定detail builder及欄位allowlist；大集合只保存count、IDs sample及hash，不存完整request body。

### 12.3 Structured logs

Logs使用event name、requestId、correlationId、eventId、internal resource IDs、duration、outcome及安全error code。不要重複保存Supplier／SKU自由文字、reason全文或任何password／token。

重要events：transaction indeterminate、inventory contract mismatch、audit failure、reconciliation mismatch、sequence exhausted、duplicate delivery warning、dependency unavailable及idempotency conflict。

### 12.4 Metrics與告警

- PO create／submit／approve outcome與duration。
- GR confirm outcome／duration／detail count；overreceipt、Blocked supplier、SKU exception、expiry override counts。
- Receipt reversal outcome及blocked reason category。
- Idempotent replay／conflict／in-progress、transaction timeout／indeterminate、DB deadlock。
- Reconciliation mismatch count必須為0；Inventory contract mismatch立即告警。
- Supplier soft supply-history projection failure可警告，不影響已完成Receipt正本。

Metrics labels不得包含PO／GR Number、Supplier／SKU名稱、reason或user ID等高基數／敏感值。

### 12.5 Retention與營運工具

- Confirmed PO／Approval／GR／Reversal／Operation／Audit至少7年；本期不自動purge。
- Draft／Cancelled retention日後由正式政策決定；沒有政策前不刪除，避免編號及Audit斷裂。
- 提供只讀reconciliation command／service，輸出安全CSV或structured summary。
- Supplier soft relation可由idempotent reconciliation補寫`last_supplied_at`；不得重算PO／Inventory正本。

---

## 13. 分階段實作、部署與回滾

### Phase 0：Provider與Framework Gate

- 修正Idempotency authenticated identity scope。
- Supplier／Item committed receipt contracts及Currency／Payment Term tables可用。
- Inventory Warehouse／Bin／Lot／Balance、batch receipt及partial reversal contracts可用。
- 新增permissions及migration／contract tests。

**明確結果**：所有必要provider contract及transaction能力已通過測試，但一般使用者尚看不到Purchasing入口。

### Phase 1：Purchase Order Foundation

- Sequence、Settings default、PO tables、Draft CRUD、lookup、money、UOM、list／detail／copy、browser print。
- Approval OFF的Draft→Confirmed。

**明確結果**：可建立、確認、查詢及列印正式PO，Inventory完全不變。

### Phase 2：Approval與PO Lifecycle

- Approval ON、assigned worklist、approve／reject／withdraw。
- Confirmation withdraw、cancel、close remaining、status history及完整Audit。

**明確結果**：PO控制符合可配置審批及不可改寫歷史。

### Phase 3：Goods Receiving與Inventory Posting

- GR Draft、分拆details、barcode、tracking、UOM、Warehouse／Bin、partial／over receipt、exceptions。
- 批次Inventory posting、timeout lookup、PO progress及雙向來源。

**明確結果**：每次實收到確切SKU／Lot／Bin，GR、PO與Inventory全有或全無一致。

### Phase 4：Reversal、Reporting與Release Evidence

- 部分／全部Receipt Reversal、Outstanding／GR reports、CSV、Supplier supply history projection。
- Security、capacity、reconciliation、backup／restore及完整UAT。

**明確結果**：錯誤可正式更正，資料可查、可對賬並具備Go-Live證據。

每個Phase一個獨立PR及一次完整測試週期。下一Phase入口由feature capability gate控制，不可在provider或migration未就緒時顯示半成功功能。

### 13.1 部署順序

1. 在獨立worktree fetch最新main，整合target變動並完成review／lint／test／coverage／build／audit。
2. 備份目標DB並驗證restore；確認Supplier、Item、Inventory migrations已套用。
3. 套用additive Purchasing migrations、permission seed及triggers。
4. 部署Backend，執行readiness及provider contract smoke；未通過保持Frontend capability關閉。
5. 部署Frontend，指派角色permissions，驗證Approval setting預設OFF。
6. 以代表性PO做Draft→Confirm→partial GR→over GR→reversal rehearsal及對賬。
7. 完成performance、security、backup／restore及UAT簽核後才Go-Live。

### 13.2 Rollback原則

- Backend／Frontend可回退至未暴露新routes版本；additive tables保留，不在事故期間drop有資料table。
- 一旦任何Confirmed PO／GR存在，不得回滾migration刪表或刪column；以forward fix及feature disable處理。
- Inventory posting已commit時不可用SQL刪除Movement回滾；使用正式Receipt Reversal／Inventory correction。
- 如果新版本不能確認GR，保留read-only PO／GR查詢並關閉Confirm入口；不得改為無Inventory的「假成功」。

---

## 14. 需求追溯矩陣

### 14.1 Business Objectives與Capabilities

| Requirement | Design |
| --- | --- |
| OBJ-01／PUR-CAP-01 | §2、§3.1～3.3、§4.3～4.8、§5.2、§7.2～7.4、§8.1～8.4 |
| OBJ-02／PUR-CAP-01 | §2.4、§3.6、§4.5～4.7、§8.2 |
| OBJ-03／PUR-CAP-02 | §3.3、§4.4／4.7、§5.2／5.4、§6 |
| OBJ-04／PUR-CAP-03～05 | §3.2～3.6、§4.9～4.11、§5.3、§7.5～7.7 |
| OBJ-05／PUR-CAP-04～06 | §2.5～2.6、§3.5、§4.11、§8.6～8.8 |
| OBJ-06／PUR-CAP-06～07 | §2.7、§4.12～4.15、§8.9、§11.8 |
| OBJ-07 | §2.5～2.7、§4.14、§10～11 |
| OBJ-08 | §0.4、§1.6、§13 |

### 14.2 Functional Requirements

| Requirement group | Design coverage |
| --- | --- |
| FR-SET | §3.3、§4.4、§5.4、§6.2、§8.3、§12.2 |
| FR-LIST | §4 indexes、§5.2、§5.6、§7.2／7.4、§8.9 |
| FR-PO | §2.8、§3.1、§4.3／4.5／4.6、§5.2、§7.3、§8.1／8.2 |
| FR-APPROVAL | §3.3、§4.7、§5.2、§6、§7.4、§8.3 |
| FR-LIFE | §3.2、§4.8、§5.2、§8.4 |
| FR-GR | §3.4／3.5、§4.9～4.11、§5.3、§7.5／7.6、§8.5 |
| FR-VAL | §2.8、§3.5／3.6、§4.10／4.11、§8.6 |
| FR-POST | §2.4～2.7、§3.5、§5.3、§8.7、§11.2／11.3／11.4 |
| FR-REV | §3.7、§4.12／4.13、§5.3、§8.8、§11.2 |
| FR-REPORT | §5.2～5.6、§7.2／7.5／7.8、§8.9 |
| FR-AUDIT | §4.8／4.14／4.15、§5.4、§6.4、§12.2／12.3 |

### 14.3 Rules、Security與NFR

| Requirement | Design coverage |
| --- | --- |
| BR-001～013 | §2.8、§3.1、§4.3／4.5／4.6、§8.1／8.2 |
| BR-014～024 | §3.2／3.3、§4.7／4.8、§8.3／8.4 |
| BR-025～039 | §3.4～3.7、§4.9～4.13、§8.5～8.8 |
| BR-040～052 | §2.5～2.7、§3.8、§4.14～4.16、§8.9 |
| SEC-001～016 | §5 auth矩陣、§6、§10.4、§11.6 |
| NFR-001～005 | §4 indexes、§8.9、§11.7、§12.1 |
| NFR-006～011 | §2.5～2.7、§4.14～4.16、§8.7～8.9、§11.3／11.8 |
| NFR-012～016 | §2.4、§2.8、§6.4、§7.9、§12.5 |

### 14.4 Acceptance Criteria執行映射

| AC | 主要設計與測試 |
| --- | --- |
| AC-001～010 | §3.1／3.3、§4.3～4.7、§5.2、§10.2／10.3、§11.1／11.2 |
| AC-011～020 | §3.2／3.3、§4.7／4.8、§8.3／8.4、Approval／Lifecycle integration |
| AC-021～035 | §3.4～3.6、§4.9～4.11、§7.5／7.6、Receiving policy／integration |
| AC-036～047 | §2.5～2.7、§3.5／3.7、§4.12～4.14、§8.7／8.8、concurrency／reversal integration |
| AC-048～055 | §5～7、§8.9、§11.4～11.8、§12、§13 |

### 14.5 Decision traceability

| Decision | Design |
| --- | --- |
| DEC-001～003 | §0.4、§3.3、§5.2、§6.2 |
| DEC-004～005 | §3.2／3.4／3.5、§4.10、§8.6／8.7 |
| DEC-006～007 | §2.8、§4.5／4.6、§5.2 |
| DEC-008～010 | §3.4～3.6、§4.9～4.11 |
| DEC-011～013 | §2.5、§3.4／3.5／3.7、§8.7／8.8 |
| 本輪OPEN-001～005 | §0.2、§2.8、§3.6、§4.3、§7.8 |

---

## 15. 評審門檻與剩餘上線輸入

### 15.1 可拆Tasks前必須確認

- Capability Map、module boundaries、API命名、permission及auth strength獲Engineering／Product確認。
- Supplier／Item／Inventory owners確認§2.4 contracts，特別是Inventory batch receipt及partial reversal。
- DBA確認§4 tables、FK、CHECK、indexes、trigger及migration順序可在MySQL 8.0執行。
- QA確認§10～11覆蓋55項AC及真並發／失敗注入。
- Frontend確認§7符合`docs/frontend-design.md`及375／768／1024／1440驗收。

### 15.2 不阻擋核心開發、但阻擋Go-Live

- OPEN-006：舊系統未完成PO、Previously Received及Inventory Opening的切換資料、日期、owner與對賬簽核人。
- 正式Currency清單及各currency decimal places；至少HKD seed須存在。
- Production角色分工、Approval setting初始簽核、Warehouse／Bin及Supplier／SKU主資料ready。
- Backup／restore rehearsal、容量數據、security review及完整UAT證據。

### 15.3 規格變更控制

若實作發現需求或provider contract需改變，先修改`01_requirement_spec.md`／本文件並取得確認，再修改tasks及code。不可在程式內以未記錄fallback放寬Blocked Supplier、existing SKU commitment、無PO收貨、部分GR確認、超收原因、金額round或Reversal不變量。

---

## 16. Harness 2.0 正式設計定義

本節把 §1～§15 的設計敘述整理成 12 個穩定的設計實體，作為 `08_traceability.json` 的 `DES` 節點。每個實體指向其權威章節；章節內容本身仍然是設計細節的來源，本節不重複也不取代它們。


### 16.1 設計實體與權威章節

| Design ID | 名稱 | 權威章節 |
| --- | --- | --- |
| DES-001 | 架構、模組邊界與Provider契約 | §1、§2.1～§2.4 |
| DES-002 | 寫入交易骨架、全域鎖順序與冪等 | §2.5～§2.7 |
| DES-003 | 數量與金額算法 | §2.8 |
| DES-004 | Domain aggregate、狀態機與不變量 | §3 |
| DES-005 | Database table、約束與migration切片 | §4 |
| DES-006 | API與internal interface契約 | §5 |
| DES-007 | 權限、安全與威脅模型 | §6 |
| DES-008 | UI／UX、導航與A4列印 | §7 |
| DES-009 | Service與核心算法 | §8 |
| DES-010 | 程式碼架構與變更清單 | §9 |
| DES-011 | 測試設計 | §10～§11 |
| DES-012 | Configuration、logging、營運與分階段部署 | §12～§13 |

## Formal definitions

## DES-001 — 架構、模組邊界與Provider契約

### Decision
Purchasing與Receiving為同一monolith domain module，共用MySQL schema及transaction；對Supplier、Item、Inventory、User、Currency／Payment Term只經具名provider契約讀取，提交時重驗，provider不可用時fail closed。

### Rationale
設計規格 §1、§2.1～§2.4。單一交易邊界令GR確認可與Inventory過帳共用原子性；具名契約令跨模組語意可被contract test靜態驗證，避免以自由文字或本地table複製他模組主資料。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-002 — 寫入交易骨架、全域鎖順序與冪等

### Decision
所有state-changing命令走POST command＋framework idempotency＋永久domain operation記錄；固定全域鎖順序，同一event重送返回原結果，同一event搭配不同payload回409。

### Rationale
設計規格 §2.5～§2.7。雙層claim（HTTP idempotency與domain operation）令TTL過後的重送仍不會重複建單或重複入庫；固定鎖順序避免PO／GR／Inventory交叉deadlock。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-003 — 數量與金額算法

### Decision
Base Quantity為正整數且受config上限限制；Unit Price最多4位小數，Line Amount按Currency小數位ROUND_HALF_UP，PO Total為已round Line Amount之和；金額在API為decimal string，在程式以整數縮放／BigInt計算。

### Rationale
設計規格 §2.8，關閉需求OPEN-003。避免binary float造成可見rounding誤差，並令UI、CSV、列印與整合介面得到同一個server端正本數值。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-004 — Domain aggregate、狀態機與不變量

### Decision
PO、Approval、Goods Receipt及Receipt Reversal各自為aggregate root；PO狀態機為Draft／Pending Approval／Confirmed／Partially Received／Fully Received／Closed／Cancelled，狀態由Confirmed Receipt、Reversal及Close Remaining結果一致推導。

### Rationale
設計規格 §3。狀態由事實推導而非人工設定，令PO進度、Outstanding、Over-received與Inventory保持可對賬；Confirmed歷史採append-only，錯誤只能由Reversal更正。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-005 — Database table、約束與migration切片

### Decision
15張purchasing／receiving表（settings、document sequences、PO header／lines／approvals／status history、goods receipts／lines／details、reversals／reversal details、operation requests、audit logs）採InnoDB、BIGINT UNSIGNED PK、epoch毫秒時間、optimistic version及ON DELETE RESTRICT；migration按切片依賴順序additive交付。

### Rationale
設計規格 §4。以FK、UNIQUE、NOT NULL、generated column及trigger作第二層防護，令不變量不完全依賴應用層；additive migration令每個Phase可獨立forward migrate及回滾。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-006 — API與internal interface契約

### Decision
`/api/v1`之下查詢用GET、業務命令用POST；handler以靜態`api`宣告method、path、auth strength、permission、AJV schema（`additionalProperties:false`）及idempotency；response經projection allowlist輸出，錯誤使用穩定公開錯誤碼。

### Rationale
設計規格 §5。宣告式邊界令權限與schema可被自動註冊及靜態檢查；projection allowlist防止內部欄位、銀行資料或路徑意外外洩。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-007 — 權限、安全與威脅模型

### Decision
六項模組權限互不繼承；Approval使用password、Settings及Receipt Reversal使用device-password等高強度重新認證；route與transaction提交點各驗一次actor freshness，owner不符與不存在同回404。

### Rationale
設計規格 §6。職責分離必須在後端成立，前端隱藏按鈕不構成授權；提交點重驗令畫面載入後被撤權的使用者無法完成寫入。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-008 — UI／UX、導航與A4列印

### Decision
七個頁面沿用`PageHeader`、`DataTable`、`FormPanel`、`EllipsisCell`、confirm helper及notify；風險（超收、零單價、效期不足、版本衝突、逾時）以文字＋icon呈現而非只靠顏色；列印只提供A4 browser print。

### Rationale
設計規格 §7，關閉需求OPEN-005。沿用既有framework避免第二套UI pattern；不產生server-side PDF artifact令本期不需引入PDF library、檔案表或範本引擎。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-009 — Service與核心算法

### Decision
九個具名service（Sequence、PurchaseOrder、PurchaseApproval、PurchaseOrderLifecycle、GoodsReceipt、ReceivingPolicy、GoodsReceiptPosting、ReceiptReversal、PurchasingInquiry）以constructor injection取得database、provider、audit及time，transaction由service持有。

### Rationale
設計規格 §8。具名方法令狀態、權限與Audit可被靜態檢查及單元測試；禁止接收table name／status／permission的generic CRUD service。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-010 — 程式碼架構與變更清單

### Decision
明確列出需修改的既有檔案（權限正本、idempotency identity scope、menu、error messages）與新增的backend config／domain／handler／schema、frontend page／service及migration／test support檔案。

### Rationale
設計規格 §9。把設計轉成可核對的檔案清單，令Task拆分維持1～5檔案規模，並令越界修改在review時可見。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-011 — 測試設計

### Decision
純算法／service unit test、真MySQL migration與constraint integration、API＋DB integration、真並發與失敗注入、consumer／provider contract test、Vue page test、security test、效能容量及backup／restore對賬。

### Rationale
設計規格 §10～§11。冪等、原子性與lock order無法由mock證明，必須以真資料庫並發及失敗注入驗證；contract test令跨模組語意變更可被偵測。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

## DES-012 — Configuration、logging、營運與分階段部署

### Decision
`server/config/purchasing.js`集中數量／金額／分頁上限；audit action allowlist、結構化log（脫敏）、metrics與告警、7年保留；Phase 0～4依序部署，每Phase一個PR與capability gate。

### Rationale
設計規格 §12～§13。集中config令上限可被測試引用而非散落；capability gate令未完成Phase的入口不會提前暴露給一般使用者。

### Failure behavior
違反此設計決策的實作（例如繞過交易邊界、以generic CRUD取代具名service、以client計算值取代server正本、或在未記錄的fallback中放寬不變量）必須在 review 或測試被攔截，而不是以警告放行；相關 Gate 記為 BLOCKED，先修訂本規格並重新取得批准。

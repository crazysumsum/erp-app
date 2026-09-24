# Inventory Management 系統設計規格（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Inventory Management 系統設計規格 |
| 文件版本 | 0.4 Approved Planning Baseline |
| 文件日期 | 2026-09-23 |
| 上游文件 | `docs/inventory_management/01_requirement_spec.md` 0.4 Approved Planning Baseline |
| 適用系統 | ERP App；單一公司；中小企業；主要營運規模為5個以內Warehouse |
| 技術基線 | Node.js 26＋Express 5＋MySQL Server 26.7.0＋Vue 3＋Quasar 2 |
| 文件狀態 | Sam以獨立人工評審人身分批准MySQL Server 26.7.0設計及P0～P5計畫；是否恢復IMPLEMENT仍待另行確認 |

### 0.1 文件目的

本文件把Inventory Management業務需求轉成可執行的系統設計，定義模組邊界、交易與並發模型、資料庫表、API契約、頁面、權限、程式碼變更、測試、部署及營運要求。若本文與`01_requirement_spec.md`的業務語意衝突，以需求書為準並先走變更控制，不可由實作者自行改變需求。

### 0.2 已確認的架構決策

1. 沿用現有模組化單體，不建立Inventory微服務、message broker或第二套庫存資料庫。
2. `inventory_movements`是不可變的數量事實流水；`inventory_stock_balances`、`inventory_stock_controls`及Transfer current state是同一交易內維護的查詢模型，不可由一般CRUD直接修改。
3. Purchasing／Receiving、Sales／Fulfillment及Returns等模組同步呼叫Inventory domain service；來源單據變更與Inventory效果共用同一個MySQL transaction。
4. 所有Inventory command具來源識別、payload hash及冪等結果；API層冪等不能取代domain層的業務事件唯一性。
5. 同一`Warehouse＋SKU`的競爭操作先鎖定一筆Stock Control row，再按固定順序鎖定Bin、Lot及Stock Balance，嚴格禁止負Bucket及超額Reserved／Allocation。
6. Stocktake採可稽核的業務層Bin lock。Counting可能持續數小時，絕不以長時間資料庫transaction或row lock維持盤點鎖。
7. 跨Warehouse Transfer維持需求書的整張Dispatch／整張Receive；本期不支援部分收發。
8. 所有Base UOM數量使用整數；所有日期及時間遵守`APP_TIME_ZONE`與現有Time Service。
9. 所有Inventory UI／UX設計與實作必須遵守`docs/frontend-design.md`。

### 0.3 明確不做

- Serial Number、成本、估值、COGS、會計分錄、MRP、自動補貨或高階WMS。
- 另一套event-sourced runtime、CQRS平台、分散式鎖、Kafka／RabbitMQ或跨服務Saga。
- 部分Transfer Dispatch／Receive、負庫存、Inventory雙人審批、Bin容量或固定SKU規則。
- 通用Workflow engine、通用自訂欄位平台、通用報表設計器或為未確認未來需求預建抽象層。
- 在Inventory內建立Purchase Order、Sales Order、Shipment、Return或財務單據。

---

## 1. 成功條件、Capability Map與實作邊界

### 1.1 可驗證成功條件

- 每次On Hand變化均可由Stock Bucket追溯至不可變Movement、domain operation、source reference及Audit。
- 合法Receipt／Issue／Move／Transfer／Adjustment／Stocktake在單一transaction全有或全無；注入任一步失敗後無半套資料。
- 並發Reservation、Allocation及Issue不會令Reserved、Allocated、On Hand或ATP出現非法負數或超額。
- SKU／Barcode精確查找、常用庫存列表及FEFO／FIFO候選在需求容量基線下p95少於2秒。
- 同一業務事件安全重送；同key同payload回原結果，同key不同payload回穩定衝突。
- Stocktake Counting期間所有會改變目標Bin On Hand的入口均被同一個guard阻擋。
- 50項AC均有明確測試層與驗證方法；125項FR、45項BR、14項SEC及14項NFR均可追溯至設計章節。

### 1.2 Capability Map

Capability ID沿用已確認需求書，不另改名：

| Capability ID | 技術責任 | 主要依賴 |
| --- | --- | --- |
| `INV-CAP-01` | Warehouse／Bin master、狀態、版本及引用guard | User／Authorization |
| `INV-CAP-02` | Lot、Stock Control、Stock Balance、Expiry及數量投影 | Item、CAP-01 |
| `INV-CAP-03` | Operation claim、Movement ledger、Audit、Reversal | CAP-01、CAP-02 |
| `INV-CAP-04` | Reservation、Allocation、ATP及FEFO／FIFO | CAP-02、CAP-03、Sales／Fulfillment |
| `INV-CAP-05` | Bin Move、Transfer及In Transit | CAP-02、CAP-03、CAP-04 |
| `INV-CAP-06` | Adjustment、Status Transfer、Stocktake及Bin lock | CAP-02、CAP-03、CAP-04 |
| `INV-CAP-07` | Inquiry、CSV、Opening、internal contracts及營運對賬 | CAP-01～06、上下游模組 |

實作依賴順序：`CAP-01 → CAP-02 → CAP-03 → CAP-04 → CAP-05/CAP-06 → CAP-07`。CAP-05與CAP-06可在CAP-04的Stock Control及lock protocol穩定後平行開發。

### 1.3 現有專案約束

- Backend handler以`BaseRequestHandler`、靜態`api`定義、AJV request／response schema及自動discovery註冊。
- API沿用`/api/v1`及現有GET／POST command風格；不為本模組另加路由框架。
- 業務service沿用顯式constructor injection；資料庫操作使用`MySqlDatabaseService`及`withTransaction()`。
- 權限正本是`server/src/modules/authorization/permissionCatalogue.js`，migration只是資料庫投影。
- 前端page及service分別由`import.meta.glob`自動發現；頁面metadata決定route、menu及permission。
- 測試使用Node.js built-in test runner及Vitest；不新增測試框架。
- Migration runner按檔名排序且MySQL DDL會implicit commit。`HD-007`固定Inventory使用`0054`～`0063`；每支尚未建立的migration動工前必須fetch最新main並驗證配額，碰撞時停止並重新批准，不自行改號或修改既有migration。
- 現有`IdempotencyService.identityScope()`只把`auth.type === "jwt"`視為authenticated；`jwt-password`／`jwt-device-password`會錯誤退回IP scope。Phase 0必須先作§8.1的最小framework修正，否則高風險Inventory routes不可啟用framework idempotency。
- `HD-008`採納由Item module擁有的transaction-aware `ItemLookupService` contract；Inventory只消費其白名單projection，不複製Item資格邏輯。Contract publication合併前TASK-005保持阻擋。

### 1.4 開發與驗證命令

```bash
# 於獨立worktree執行
npm install
npm run lint
npm test --workspace server
npm test --workspace client
npm run test:coverage
npm run build --workspace client
npm run security:audit

# 真MySQL migration／integration（使用專用測試DB）
npm run migrate --workspace server
node --test --import ./server/test-support/testEnv.js server/test/integration/inventory*.integration.test.js
```

不得對非測試資料庫執行Integration、Opening或破壞性測試。實作時應沿用專案既有環境旗標與測試DBguard，不新增第二種命令語意。

### 1.5 Code style

沿用現有JavaScript ESM、兩空格縮排、double quotes、semicolon及constructor injection；SQL使用參數，不插入使用者可控identifier：

```js
export class InventoryPostingService {
  constructor({ database, audit, time, itemLookup }) {
    this.database = database;
    this.audit = audit;
    this.time = time;
    this.itemLookup = itemLookup;
  }

  postReceipt(command) {
    return this.database.withTransaction((transaction) =>
      this.postReceiptInTransaction(transaction, command)
    );
  }
}
```

內部已有transaction的上下游模組必須呼叫`postReceiptInTransaction(transaction, command)`；Inventory HTTP handler則呼叫外層方法建立transaction，避免nested transaction或來源單據先commit、庫存後失敗。

### 1.6 三層實作邊界

#### Always do

- 在API boundary使用`additionalProperties:false` schema及field length／enum／integer限制。
- 每個protected endpoint在route policy驗權；每個寫入service再以`assertActorFresh()`重讀actor狀態與權限。
- 所有business write帶domain operation claim、固定lock order、Movement／Audit及明確response projection。
- SQL參數化；sort、status、command type及dynamic table選擇只用server allowlist。
- 高風險操作使用固定`authType` route，不在handler內依body動態降低認證強度。

#### Ask first

- 改變需求書狀態機、部分Transfer政策、負庫存政策或新增Stock Status。
- 引入新runtime dependency、外部服務、background queue產品或修改CI。
- 更改Item Tracking Policy語意、Base UOM或上下游單據交易邊界。

#### Never do

- 直接`UPDATE inventory_stock_balances`作管理修正，或修改／刪除已過帳Movement。
- 在未取得Stock Control row lock時寫Reserved、Allocated或可銷售On Hand。
- 接受client提供的`balanceAfter`、ATP、SKU tracking policy或權限作事實。
- 在log、audit、error或CSV中輸出password、token、SQL、stack或未過濾payload。

---

## 2. 整體架構

### 2.1 元件關係

```text
Vue／Quasar pages
        │  /api/v1/inventory-*  (AJV + auth + permission + idempotency)
        ▼
Inventory handlers ───────────────────────────────────────────┐
        │                                                      │
        ▼                                                      │
Inventory domain services ◄── synchronous internal contracts ─┤ Purchasing/Receiving
        │                                                      ├ Sales/Fulfillment
        ├── ItemLookupService                                  └ Returns
        ├── Authorization freshness guard
        ├── InventoryOperationService
        ├── InventoryLockService
        └── InventoryAuditService
        │
        ▼
MySqlDatabaseService.withTransaction()
        │
        ├── immutable operations / movements / audit
        └── current balances / reservations / allocations / workflows
```

Inventory是同一個domain module，不拆成七個deployable services。Service按責任分開是為了交易規則可測試及避免一個巨型class，全部仍共享同一schema與lock protocol。

### 2.2 後端分層與Service責任

| Service | 責任 |
| --- | --- |
| `InventoryMasterService` | Warehouse／Bin CRUD、狀態、唯一性、version及reference guard。 |
| `InventoryInquiryService` | Stock、Lot、Movement、Reservation、Transfer、Stocktake分頁查詢及CSV projection。 |
| `InventoryPostingService` | Receipt、Issue、Bin Move、Status Transfer、Adjustment及Reversal的原子過帳。 |
| `InventoryReservationService` | ATP檢查、Reservation state、release／cancel／consume及Allocation。 |
| `InventoryPickSequenceService` | 合資格bucket查詢、FEFO／FIFO穩定排序及override判定；保持純規則以利unit test。 |
| `InventoryTransferService` | Draft、Dispatch、In Transit及Receive狀態機與成對Movement。 |
| `InventoryStocktakeService` | Draft、snapshot、semantic Bin lock、count、ready、post及cancel。 |
| `InventoryOpeningService` | CSV template、job、precheck、confirm、worker及Go-Live guard。 |
| `InventoryOperationService` | Domain source identity、canonical payload hash、atomic claim及result lookup。 |
| `InventoryLockService` | 統一Stock Control／Bin lock／Lot／Balance鎖順序與防deadlock helper。 |
| `InventoryAuditService` | action allowlist、safe before／after摘要、必要Audit同交易寫入。 |
| `InventoryLookupService` | 對上下游提供最小、目的限定的internal read／write contract。 |

Handler只做：取得已驗證`req.input`、建立command context、呼叫service及回明確projection。Handler不得拼SQL、重算ATP或自行寫Movement。

### 2.3 前端分層

```text
client/src/pages/inventory/*.vue
        │
        ├── PageHeader / DataTable / FormPanel / EllipsisCell
        ├── composables/inventory/useInventoryFilters.js
        └── services/inventory.js
                    │
                    └── framework/http/HttpClient.js
```

- server-side table狀態保存在URL query，支援重新整理與分享。
- 表單只提交使用者輸入及resource version，不在browser計算可信ATP或balance。
- 任何前端FEFO／FIFO提示只是輔助；最終資格、權限、版本及數量一律由server提交時重驗。
- 不新增全域Inventory store。跨頁需要的資料由URL及API重新載入，避免長期保存過時庫存。

### 2.4 交易邊界

所有寫入command遵守以下骨架：

```text
BEGIN (REPEATABLE READ；bulk Opening另設明確timeout)
  1. 重讀actor／permission及必要Item／SKU政策
  2. atomic claim domain operation；同key同hash回既有結果，不同hash回409
  3. 按排序鎖Warehouse、Stock Control、Bin／semantic lock、Lot、Balance及workflow root
  4. 提交時重驗狀態、版本、效期、數量、ownership及來源
  5. 寫current state
  6. append Movement（如On Hand／In Transit變化）
  7. append必要Inventory Audit
  8. 完成domain operation result
COMMIT
```

任何一步失敗完整rollback。`DATABASE_TRANSACTION_INDETERMINATE`不可盲目重送；caller以source identity查詢`GET /inventory-operations/by-source`，若已完成取回結果，未找到才使用原event id重試。

### 2.5 並發與固定鎖順序

同一transaction只能按以下順序取得lock，不可逆序：

1. `inventory_operation_requests`唯一claim。
2. `inventory_warehouses`按`warehouse_id`升序；每個Warehouse-scoped write在此鎖內重驗`ACTIVE`。
3. `inventory_stock_controls`按`warehouse_id, sku_id`升序。
4. `inventory_bins`及active `inventory_bin_locks`按`bin_id`升序。
5. `inventory_lots`按`sku_id, normalized_lot_number`升序。
6. `inventory_stock_balances`按`warehouse_id, sku_id, bin_id, lot_scope, stock_status`升序。
7. Workflow root：`reservations → transfers → stocktakes`，同類按ID升序。
8. Child rows、current state update、Movement及Audit append。

Warehouse row是啟用狀態的serialization point：Warehouse停用及所有Receipt、Reservation、Issue、Move、Transfer、Adjustment、Stocktake與Opening都先鎖相同Warehouse row。Posting先取得鎖者完成後，停用方會看到新阻擋而拒絕；停用先完成者令後續posting讀到INACTIVE並拒絕，不會產生「停用成功後又新增存貨」的競態。跨倉命令一律按兩個Warehouse ID排序。

`inventory_stock_controls`是每個Warehouse＋SKU的quantity serialization point。所有會改變Reserved、Allocated或合資格Available On Hand的command都必須在Warehouse鎖之後鎖它；因此Reservation與同時發生的Issue、Status Transfer、Transfer Dispatch或Adjustment不會各自看到可用數量而造成超額。

不存在的Stock Control／Balance先用`INSERT ... ON DUPLICATE KEY UPDATE id = id`建立或競爭唯一鍵，再`SELECT ... FOR UPDATE`；禁止先SELECT、看不到後無鎖地INSERT。Deadlock／lock timeout轉成可重試`409 CONCURRENT_OPERATION`，client須重新讀取後以新idempotency key提交新意圖；原業務event重送則沿用原source event id。

### 2.6 ATP及時間流逝

對用途`minimumRemainingDays = D`：

```text
eligibleOnHand = SUM(
  AVAILABLE buckets where expiry_date is null
  or expiry_date >= APP_TIME_ZONE.localDate + D days
)
outstandingReserved = inventory_stock_controls.reserved_quantity
rawATP = eligibleOnHand - outstandingReserved
ATP = GREATEST(rawATP, 0)
uncoveredReserved = GREATEST(-rawATP, 0)
```

新的Reservation只有`rawATP >= requestedQuantity`才成功。日期跨日可能令原本合資格的未分配批次變成低效期或過期；系統不自動刪除正式Reservation，而是把`uncoveredReserved`顯示在Reservation／零ATP查詢，禁止新Reservation及要求Sales／Fulfillment處理。這是Reservation不過早綁Lot與效期自然流逝之間的必要結果，不以負ATP掩蓋。

### 2.7 冪等的兩層責任

| 層 | 防護範圍 | 規則 |
| --- | --- | --- |
| Framework Idempotency | 同authenticated actor、HTTP method、route、`Idempotency-Key`的重送 | state-changing route啟用；同payload replay，異payload 409；TTL至少7日，須長於已知client retry window。Phase 0先修正§8.1的強認證identity scope。 |
| Domain Operation | HTTP、internal service、worker共用的業務事件 | unique source tuple；`commandType`放入SHA-256 canonical payload而非unique key；與業務效果同transaction；結果可按source查回。 |

Domain source tuple嚴格依需求為`sourceModule＋sourceDocumentType＋sourceDocumentId＋sourceLineId＋sourceEventId`，不含`commandType`。空Line以空字串表示，不用NULL，避免MySQL UNIQUE允許多個NULL而失效。`commandType`是payload hash的一部分，所以同一source event改成另一種command必然回`INVENTORY_SOURCE_CONFLICT`，不能產生第二個庫存效果；不同業務動作必須由來源產生不同event ID。

---

## 3. Domain模型、狀態機與核心不變量

### 3.1 Aggregate與交易邊界

| Aggregate／模型 | Root | 同交易內容 |
| --- | --- | --- |
| Warehouse | Warehouse | Warehouse或其單一Bin變更＋Audit；停用時只讀其他引用作guard。 |
| Stock posting | Domain Operation | Stock Control、Lot、Balance、Movement、Reservation／Allocation效果及Audit。 |
| Reservation | Reservation | Stock Control、Reservation、Allocation及Audit；Issue時納入Stock posting。 |
| Transfer | Transfer | Header、所有lines、Stock Controls、Balances、Movements及Audit；整張全有或全無。 |
| Stocktake | Stocktake | Header、scope bins、locks、snapshot lines；Posting再包含所有Balance／Movement。 |
| Opening | Opening Job | Precheck不改庫存；Confirm worker以一個posting transaction處理全部valid rows。 |

### 3.2 SKU與Lot規則

- 每次提交由`ItemLookupService`按SKU ID讀取`inventoryTracked`、status、Base UOM、tracking policy及minimum life；client snapshot不可信。
- `none`：Lot／Expiry／Manufacture禁止提交；Balance的`lot_id=NULL`。
- `batch`：Lot必填，Expiry選填；同SKU＋normalized lot唯一。
- `batch_expiry`：Lot及Expiry必填。
- `serial`：所有Inventory posting回`SERIAL_TRACKING_UNSUPPORTED`，不自動降級。
- Expiry用MySQL`DATE`保存「最後可使用日」；`expiry_date < currentLocalDate`才Expired，等於今日仍未Expired。
- Lot identity建立後不提供一般修改API；資料錯誤由受控Reversal及正確Lot重新過帳處理，避免跨倉同Lot漂移。

### 3.3 Stock不變量

1. `on_hand_quantity >= 0`、`allocated_quantity >= 0`、`allocated_quantity <= on_hand_quantity`。
2. Balance的Bin必須屬同一Warehouse；Lot如非NULL必須屬同一SKU。
3. `inventory_stock_controls.reserved_quantity`等於所有Reservation outstanding總和。
4. 同Warehouse＋SKU所有active Allocation outstanding總和不得超過Reserved，且同一Balance的Allocation outstanding不得超過其On Hand。
5. 除了消耗匹配Allocation的Issue外，任何Bucket OUT只能使用`on_hand_quantity - allocated_quantity`；Bin Move、Transfer、Status Transfer、負Adjustment及Reversal不得移走已分配數量。
6. Quarantined、Damaged、Expired及low-life bucket不進正常Sales eligible quantity。
7. 零Balance row可保留作鎖與歷史定位；日常列表預設不顯示，不能物理刪除有Movement引用的row。
8. 所有current quantity update必須有相同transaction內的Operation及Audit；On Hand／In Transit變化另須有Movement。

### 3.4 Reservation狀態

```text
ACTIVE ──consume部分──> PARTIALLY_CONSUMED
   │                         │
   ├──release部分────────────┤
   ├──cancel未耗用───────────┤
   └──consume/release至0─────┴──> CONSUMED / RELEASED / CANCELLED
```

- `original = consumed + released + outstanding`由service每次更新後assert。
- `CANCELLED`表示來源取消並已釋放全部未耗用；已耗用數量不復活。
- 對已完成Reservation重送原事件回原結果，新的狀態變更回`RESERVATION_STATE_CONFLICT`。

### 3.5 Allocation狀態、FEFO及FIFO

Allocation保存`allocated_quantity`、`consumed_quantity`、`released_quantity`，同樣維持總和不變。候選先分為有Expiry及無Expiry兩組；同一SKU混合兩組時，有Expiry組全部排在無Expiry組之前：

1. 有Expiry（FEFO）：`expiry_date ASC, normalized_lot_number ASC, first_receipt_date ASC, bin_code ASC, balance_id ASC`。
2. 無Expiry有Lot（FIFO）：`first_receipt_date ASC, normalized_lot_number ASC, bin_code ASC, balance_id ASC`。
3. 無Lot（FIFO）：`fifo_anchor_date ASC, bin_code ASC, balance_id ASC`。

`fifo_anchor_date`代表該無Lot balance目前連續持有正數庫存的起點：On Hand由0變正時設為本次入庫／移入的APP_TIME_ZONE日期，保持正數時不改，降至0時清空。它提供可重現的Bin級FIFO，不假裝追蹤不存在的單件receipt layer。

一般提交所選bucket必須等於按上述規則可滿足該數量的最前候選集合。偏離FIFO須由來源模組已授權的operation actor提供5～500字元原因；偏離FEFO除原因外另須`inventory.fefo.override`。Inventory仍須在提交點重驗actor及專門權限，並在Audit保存`selectionStrategy`、建議與實選摘要；任何override都不可繞過expiry、minimum life、status、warehouse、bin lock或quantity。越過仍合資格的有Expirybucket而選無Expirybucket屬FEFO偏離。

### 3.6 Transfer狀態

```text
DRAFT ──dispatch整張──> IN_TRANSIT ──receive整張──> RECEIVED
  └────────cancel────────> CANCELLED
```

- DRAFT不動庫存，可帶version修改lines。
- Dispatch每行建立Bin OUT及In Transit IN Movement；原子扣來源On Hand並把line `in_transit_quantity`設為完整數量。
- Receive每行必須指定目的Active Bin；建立In Transit OUT及目的Bin IN Movement，將整張in-transit清零。
- Receive可保持原Status或改為QUARANTINED並填原因，不可直接改為其他SKU／Lot／Expiry。
- IN_TRANSIT後不可修改或取消；差異在完整Receive後走關聯Adjustment／Status Transfer。

### 3.7 Stocktake狀態

```text
DRAFT ──start──> COUNTING ──complete counts──> READY_TO_POST ──post──> POSTED
  └ cancel           └ cancel                         └ cancel
```

- Start transaction先驗證scope，再為所有Bin建立active semantic lock，最後snapshot所有現存bucket；任一失敗不留部分lock。
- 現場發現的新bucket以`snapshot_quantity=0`加入；相同維度在同一Stocktake只能一行。
- READY_TO_POST後count欄位不可再改；需要修正時取消本次並建立新Stocktake，本期不增加reopen流程。
- Posting由`inventory.adjust`＋`jwt-device-password`執行，全部variance在一個transaction完成；失敗保持READY及Bin lock。
- Posted／Cancelled只解除由該Stocktake持有的locks，不可解除其他owner lock。

### 3.8 Movement與Reversal

- Movement每列是一個單向leg，`direction`為`IN`或`OUT`，quantity永遠正整數。
- 成對操作共用`movement_group_id`：Bin Move、Status Transfer、Transfer Dispatch／Receive各有兩個legs。
- Movement不提供update／delete API；Reversal建立新的相反legs並以`reversal_of_movement_id`連回原記錄。
- Generic Reversal只允許完整`RECEIPT`、`ISSUE`、`BIN_MOVE`、`STATUS_TRANSFER`及`ADJUSTMENT` movement group；所有legs須一次反向。`TRANSFER_DISPATCH/RECEIVE`、`STOCKTAKE_VARIANCE`、`OPENING`、`IN_TRANSIT`及既有`REVERSAL`不可使用generic endpoint，依需求以完成原workflow後的關聯Adjustment／Status Transfer處理，保持terminal workflow不可變。
- Reverse Receipt／Adjustment Increase會產生OUT，須通過free quantity、Allocation及Reserved保障；Generic Reverse Issue只把相同SKU／Lot／Bin／Status數量IN回，不復活已Consumed Reservation／Allocation，來源模組如要重新出貨須建立新Reservation／Allocation事件。唯一例外是§5.11的Fulfillment專用受限命令：它必須引用同一Shipment的原Issue及原Reservation，在同一transaction減少Reservation consumed、增加outstanding並回補原bucket；原Allocation保持Consumed且不可重開。
- Reverse Bin Move／Status Transfer反向完整paired legs；不改Warehouse、SKU、Lot或其他workflow state。
- 同一原Movement group只可被完整Reversal一次；任何leg已reversed、group不完整或當下反向效果違反不變量時，整組拒絕。
- Movement保存Code／Name／Lot／Bin／Status的必要快照，主資料後續改名不回寫歷史。

---

## 4. Database Table詳細設計

### 4.1 共通資料庫規則

- Engine一律InnoDB；charset／collation沿用現有schema的`utf8mb4`設定。
- Primary key使用`BIGINT UNSIGNED AUTO_INCREMENT`；業務外鍵使用不可重用ID，不使用Code／Name。
- 時間點使用epoch milliseconds的`BIGINT UNSIGNED`，由Time Service提供；Expiry／Manufacture／First Receipt使用`DATE`，沒有時區轉換。
- Quantity使用`BIGINT UNSIGNED`正整數；Movement方向分欄保存，不使用負unsigned或JavaScript浮點數。
- Mutable aggregate使用`version INT UNSIGNED NOT NULL DEFAULT 1`及`UPDATE ... WHERE id=? AND version=?`。
- MySQL Server 26.7.0須執行可安全表達的row-local `CHECK` constraints；enum、字串長度與所有跨row／跨aggregate規則仍由service在持鎖transaction內驗證，DB另以UNSIGNED、FK、UNIQUE、NOT NULL、CHECK及generated column作第二層保護。
- Foreign key預設`ON DELETE RESTRICT`。Actor FK可`SET NULL`，同時保存username snapshot；歷史、Movement、Audit及operation不可cascade刪除。
- 代碼另存normalized欄位並以binary/case-stable值作唯一索引；service執行trim、case fold及控制字元檢查。
- 所有大量列表以覆蓋主要filter及穩定tie-breaker `id`的index支援；不得允許任意client sort column。
- Migration每支只做一個邏輯schema增量，使用`CREATE TABLE IF NOT EXISTS`或明確existence guard。由於DDL implicit commit，migration不可假設rollback可撤回前一條DDL。

### 4.2 ER關係

```text
inventory_warehouses 1 ──< inventory_bins
inventory_bins       1 ──< inventory_stock_balances >── 1 item_skus
item_skus             1 ──< inventory_lots

inventory_stock_controls (warehouse + sku reservation serialization point)
inventory_operation_requests 1 ──< inventory_movements
inventory_reservations       1 ──< inventory_allocations >── inventory_stock_balances
inventory_transfers          1 ──< inventory_transfer_lines
inventory_stocktakes         1 ──< inventory_stocktake_bins >── inventory_bins
inventory_stocktakes         1 ──< inventory_stocktake_lines
inventory_stocktake_bins     1 ──< inventory_bin_locks
inventory_opening_jobs       1 ──< inventory_opening_rows
inventory_audit_logs         >── operation / business target (logical reference)
```

### 4.3 `inventory_warehouses`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Warehouse ID。 |
| `warehouse_code` | VARCHAR(50) | NOT NULL | 使用者顯示值。 |
| `normalized_code` | VARCHAR(50) | NOT NULL／UNIQUE | trim＋case fold後全公司唯一；Inactive仍占用。 |
| `warehouse_name` | VARCHAR(190) | NOT NULL | 顯示名稱。 |
| `address` | VARCHAR(500) | NULL | 簡單地址文字，不連Supplier／Customer地址。 |
| `description` | VARCHAR(500) | NOT NULL／`''` | 選填說明。 |
| `status` | VARCHAR(20) | NOT NULL／`ACTIVE` | `ACTIVE`、`INACTIVE`。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Optimistic lock。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users | Actor；刪User時SET NULL。 |

Indexes／constraints：

- `UNIQUE uq_inventory_warehouses_code(normalized_code)`。
- `INDEX idx_inventory_warehouses_list(status, warehouse_name, id)`。
- Permanent delete只由service對從未被Bin、Movement、Transfer、Reservation、Stocktake或Opening引用的row執行；FK是最後防線。

### 4.4 `inventory_bins`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Bin ID。 |
| `warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK | 所屬Warehouse。 |
| `bin_code` | VARCHAR(50) | NOT NULL | 顯示值。 |
| `normalized_code` | VARCHAR(50) | NOT NULL | 在Warehouse內唯一。 |
| `bin_name` | VARCHAR(190) | NULL | 選填名稱。 |
| `description` | VARCHAR(500) | NOT NULL／`''` | 選填說明。 |
| `status` | VARCHAR(20) | NOT NULL／`ACTIVE` | `ACTIVE`、`INACTIVE`。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Optimistic lock。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users | Actor。 |

Indexes／constraints：

- `UNIQUE uq_inventory_bins_code(warehouse_id, normalized_code)`。
- `UNIQUE uq_inventory_bins_id_warehouse(id, warehouse_id)`供Stock Balance composite FK驗證ownership。
- `INDEX idx_inventory_bins_list(warehouse_id, status, bin_code, id)`。
- Warehouse為Inactive時不可建立／恢復Bin；Bin停用guard須查On Hand、active Allocation、open Transfer及active Stocktake lock。

### 4.5 `inventory_lots`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Lot ID。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus | 所屬SKU。 |
| `lot_number` | VARCHAR(100) | NOT NULL | 原始顯示批號；`none` policy不建Lot row。 |
| `normalized_lot_number` | VARCHAR(100) | NOT NULL | trim後case規則由service統一；SKU內唯一。 |
| `expiry_date` | DATE | NULL | 最後可使用日期。 |
| `manufacture_date` | DATE | NULL | 不得晚於Expiry。 |
| `first_receipt_date` | DATE | NOT NULL | 首次正式Receipt／Opening的APP_TIME_ZONE日期。 |
| `sku_code_snapshot` | VARCHAR(190) | NOT NULL | 首次建立時SKU Code，供歷史讀取。 |
| `created_at`,`created_by` | BIGINT UNSIGNED | NOT NULL／actor可NULL | 建立資料。 |

Indexes／constraints：

- `UNIQUE uq_inventory_lots_sku_number(sku_id, normalized_lot_number)`。
- `UNIQUE uq_inventory_lots_id_sku(id, sku_id)`供Balance composite FK驗證ownership。
- `INDEX idx_inventory_lots_expiry(expiry_date, sku_id, id)`及`idx_inventory_lots_sku_receipt(sku_id, first_receipt_date, id)`。
- 同SKU／Lot再次收貨使用`SELECT ... FOR UPDATE`，Expiry／Manufacture只允許「既有NULL由首個有值Receipt補齊」的行為必須在需求簽核前決定；本設計較保守，預設任何既有值差異或後補均拒絕，避免同Lot語意漂移。

### 4.6 `inventory_stock_controls`

這是`Warehouse＋SKU`的併發serialization point及Warehouse-level Reserved current projection，不是另一套On Hand。

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Row ID。 |
| `warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK | Warehouse。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus | SKU。 |
| `reserved_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 所有active Reservation outstanding總和。 |
| `version` | INT UNSIGNED | NOT NULL／1 | 每次相關quantity command遞增。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

Constraints／indexes：`UNIQUE uq_inventory_stock_controls_scope(warehouse_id, sku_id)`；`INDEX idx_inventory_stock_controls_sku(sku_id, warehouse_id)`。所有相關command先lock此row，確保聚合ATP計算與寫入互斥。

### 4.7 `inventory_stock_balances`

每列唯一表示`Warehouse＋Bin＋SKU＋Lot/No Lot＋Stock Status`。它是current projection，沒有一般CRUD route。

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Stable bucket ID。 |
| `warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK | 冗餘保存以支援ownership FK及查詢。 |
| `bin_id` | BIGINT UNSIGNED | NOT NULL | 與warehouse composite FK。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus | SKU。 |
| `lot_id` | BIGINT UNSIGNED | NULL | `none` policy為NULL；否則與sku composite FK。 |
| `lot_scope` | BIGINT UNSIGNED GENERATED | STORED | `IFNULL(lot_id,0)`，封閉NULL unique漏洞。 |
| `stock_status` | VARCHAR(20) | NOT NULL | `AVAILABLE`、`QUARANTINED`、`DAMAGED`。 |
| `on_hand_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Current實體數量。 |
| `allocated_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Active Allocation尚未consume／release數量。 |
| `fifo_anchor_date` | DATE | NULL | 無Lot bucket目前連續正數On Hand的FIFO起點；零庫存必須為NULL。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Bucket optimistic version及查詢etag來源。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

Indexes／constraints：

- `UNIQUE uq_inventory_stock_bucket(warehouse_id, bin_id, sku_id, lot_scope, stock_status)`。
- `FOREIGN KEY (bin_id,warehouse_id) REFERENCES inventory_bins(id,warehouse_id)`。
- `FOREIGN KEY (lot_id,sku_id) REFERENCES inventory_lots(id,sku_id)`；NULL lot合法。
- `INDEX idx_inventory_stock_sku(warehouse_id,sku_id,stock_status,lot_id,bin_id,id)`支援ATP。
- `INDEX idx_inventory_stock_fifo(warehouse_id,sku_id,stock_status,fifo_anchor_date,bin_id,id)`支援無Lot FIFO候選。
- `INDEX idx_inventory_stock_bin(bin_id,sku_id,lot_id,stock_status,id)`支援Bin inquiry／Stocktake snapshot。
- `INDEX idx_inventory_stock_nonzero(sku_id,on_hand_quantity,id)`只作一般篩選；MySQL Server 26.7.0沒有partial index，query必須同時限制scope。
- `CHECK (allocated_quantity <= on_hand_quantity)`提供row-local第二層保護；service仍須在持鎖transaction內驗證同一條件及所有跨row Reservation／Allocation不變量。

### 4.8 `inventory_operation_requests`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Domain operation ID。 |
| `command_type` | VARCHAR(50) | NOT NULL | Server allowlist，如`RECEIPT_POST`。 |
| `source_module` | VARCHAR(40) | NOT NULL | `RECEIVING`、`FULFILLMENT`、`RETURNS`、`INVENTORY_UI`等。 |
| `source_document_type` | VARCHAR(50) | NOT NULL | 穩定來源類型。 |
| `source_document_id` | VARCHAR(100) | NOT NULL | 來源不可變ID字串。 |
| `source_line_id` | VARCHAR(100) | NOT NULL／`''` | Header command用空字串。 |
| `source_event_id` | VARCHAR(100) | NOT NULL | caller在同一意圖重試時保持不變。 |
| `request_hash` | CHAR(64) | NOT NULL | Canonical payload SHA-256；不含password。 |
| `result_type` | VARCHAR(40) | NULL | `MOVEMENT_GROUP`、`RESERVATION`等。 |
| `result_id` | VARCHAR(100) | NULL | 可按source查回的結果ID。 |
| `result_summary` | JSON | NULL | 可安全重播的最小projection，不保存敏感payload。 |
| `completed_at` | BIGINT UNSIGNED | NULL | 同transaction完成時間。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users | UI actor；系統整合可NULL。 |
| `actor_label` | VARCHAR(190) | NOT NULL | Username或service identity snapshot。 |
| `request_id`,`correlation_id` | VARCHAR(64) | NOT NULL／`''` | 跨log串聯。 |
| `created_at` | BIGINT UNSIGNED | NOT NULL | Claim時間。 |

`UNIQUE uq_inventory_source_operation(source_module,source_document_type,source_document_id,source_line_id,source_event_id)`是domain冪等核心。`command_type`仍保存在row並納入`request_hash`，但不可放入unique key而令同一來源事件繞出第二個效果。另設`INDEX idx_inventory_operations_source(source_module,source_document_type,source_document_id,source_line_id,id)`及`idx_inventory_operations_created(created_at,id)`。

同tuple插入競爭由unique constraint決定winner；捕捉duplicate後讀existing hash。相同hash且已完成回result；不同hash回409。由於claim與business effect同transaction，外部不可見永久`IN_PROGRESS` domain row；API framework負責HTTP in-flight 409。

Domain operation是Movement及來源追溯的一部分，至少保留7年，且不得早於所有linked Movement／Reservation／Transfer／Stocktake／Opening／Audit的保留期限。本期不實作domain operation purge；§11.1的HTTP TTL只適用framework idempotency store，不適用此表。

### 4.9 `inventory_movements`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Movement ID。 |
| `movement_group_id` | CHAR(36) | NOT NULL | 一個business posting的UUID；成對legs共用。 |
| `operation_request_id` | BIGINT UNSIGNED | NOT NULL／FK | Domain source operation。 |
| `movement_type` | VARCHAR(40) | NOT NULL | Opening、Receipt、Issue、Move、Transfer、Status、Adjustment、Stocktake、Reversal細分類。 |
| `location_kind` | VARCHAR(20) | NOT NULL | `BIN`或`IN_TRANSIT`。 |
| `warehouse_id`,`bin_id` | BIGINT UNSIGNED | warehouse必填／bin可NULL | BIN須有bin；IN_TRANSIT無bin。 |
| `sku_id`,`lot_id` | BIGINT UNSIGNED | sku必填／lot可NULL | 正式identity。 |
| `stock_status` | VARCHAR(20) | NOT NULL | 該leg的狀態。 |
| `direction` | VARCHAR(10) | NOT NULL | `IN`、`OUT`。 |
| `quantity` | BIGINT UNSIGNED | NOT NULL | 正整數Base UOM。 |
| `balance_before`,`balance_after` | BIGINT UNSIGNED | NULL | BIN leg必填；In Transit leg保存line前後值。 |
| `balance_version_after` | INT UNSIGNED | NULL | BIN current projection版本。 |
| `reservation_id`,`allocation_id` | BIGINT UNSIGNED | NULL／FK | Issue相關引用。 |
| `transfer_id`,`transfer_line_id` | BIGINT UNSIGNED | NULL／FK | Transfer相關引用。 |
| `stocktake_id`,`stocktake_line_id` | BIGINT UNSIGNED | NULL／FK | Stocktake相關引用。 |
| `reversal_of_movement_id` | BIGINT UNSIGNED | NULL／FK self | 原Movement；原row不改。 |
| `reason_category`,`reason_text` | VARCHAR(40)／VARCHAR(500) | NOT NULL／`''` | 需要時必填。 |
| `sku_code_snapshot`,`sku_name_snapshot` | VARCHAR(190) | NOT NULL | 歷史顯示。 |
| `warehouse_code_snapshot`,`bin_code_snapshot` | VARCHAR(50) | NOT NULL／bin可`''` | 歷史位置。 |
| `lot_number_snapshot` | VARCHAR(100) | NOT NULL／`''` | 歷史Lot。 |
| `expiry_date_snapshot` | DATE | NULL | 歷史效期。 |
| `posted_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `posted_by`,`posted_by_label` | BIGINT UNSIGNED／VARCHAR(190) | actor可NULL | Actor snapshot。 |

Indexes／constraints：

- `INDEX idx_inventory_movements_time(posted_at,id)`、`idx_inventory_movements_sku(sku_id,posted_at,id)`、`idx_inventory_movements_bin(bin_id,posted_at,id)`。
- `INDEX idx_inventory_movements_warehouse(warehouse_id,posted_at,id)`、`idx_inventory_movements_lot(lot_id,posted_at,id)`、`idx_inventory_movements_actor(posted_by,posted_at,id)`、`idx_inventory_movements_type(movement_type,posted_at,id)`，分別支援需求指定的Warehouse、Lot、Actor及Type＋Date查詢。
- `INDEX idx_inventory_movements_group(movement_group_id,id)`及`idx_inventory_movements_operation(operation_request_id,id)`。
- `UNIQUE uq_inventory_movement_reversal(reversal_of_movement_id)`只適用非NULL，防同一原Movement重複Reversal；成對原Movement需同一Reversal group逐leg關聯。
- `IN_TRANSIT` leg的`warehouse_id`固定使用目的Warehouse，來源／目的完整關係以`transfer_id/transfer_line_id`取得；不得把它當成目的Bin On Hand。
- 不提供任何update／delete repository方法。Migration建立`BEFORE UPDATE`及`BEFORE DELETE` trigger，以`SIGNAL SQLSTATE '45000'`拒絕修改；只有schema migration帳號可在受控維護時處理trigger。

### 4.10 `inventory_reservations`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Reservation ID。 |
| `create_operation_id` | BIGINT UNSIGNED | NOT NULL／UNIQUE／FK | 建立來源operation。 |
| `warehouse_id`,`sku_id` | BIGINT UNSIGNED | NOT NULL／FK | Reservation scope。 |
| `original_quantity` | BIGINT UNSIGNED | NOT NULL | 初始完整預留。 |
| `consumed_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 已Issue數量。 |
| `released_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Release／Cancel數量。 |
| `outstanding_quantity` | BIGINT UNSIGNED | NOT NULL | Current未耗用未釋放數量。 |
| `minimum_remaining_days` | INT UNSIGNED | NOT NULL／0 | 建立時來源用途要求的最低剩餘效期快照。 |
| `purpose` | VARCHAR(40) | NOT NULL | `SALE`等server allowlist用途。 |
| `status` | VARCHAR(30) | NOT NULL | `ACTIVE`、`PARTIALLY_CONSUMED`、`CONSUMED`、`RELEASED`、`CANCELLED`。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Consume／release／cancel compare-and-set。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users | Actor／system identity另由operation保存。 |

Indexes：`idx_inventory_reservations_scope(warehouse_id,sku_id,status,id)`、`idx_inventory_reservations_status(status,updated_at,id)`。Service必須在同一transaction assert四個quantity相等式；`inventory_stock_controls.reserved_quantity`每次以相同delta更新，不以非鎖定SUM覆蓋。

### 4.11 `inventory_allocations`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Allocation line ID。 |
| `create_operation_id` | BIGINT UNSIGNED | NOT NULL／FK | 建立／重新分配operation。 |
| `reservation_id` | BIGINT UNSIGNED | NOT NULL／FK | 所屬Reservation。 |
| `stock_balance_id` | BIGINT UNSIGNED | NOT NULL／FK | 實際Lot／Bin／Status bucket。 |
| `allocated_quantity` | BIGINT UNSIGNED | NOT NULL | 原始Allocation數量。 |
| `consumed_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 已Issue數量。 |
| `released_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 已釋放數量。 |
| `outstanding_quantity` | BIGINT UNSIGNED | NOT NULL | Current仍占用bucket數量。 |
| `selection_strategy` | VARCHAR(20) | NOT NULL | `FEFO`或`FIFO`；由server按候選資料決定。 |
| `is_sequence_override` | TINYINT(1) | NOT NULL／0 | 是否偏離server建議序列。 |
| `recommended_rank_snapshot` | INT UNSIGNED | NULL | 所選bucket提交時在完整建議序列的排名。 |
| `recommended_summary` | JSON | NULL | Override時保存最小建議bucket／expiry摘要。 |
| `override_reason` | VARCHAR(500) | NOT NULL／`''` | 任何序列偏離必填；一般分配為空字串。 |
| `status` | VARCHAR(30) | NOT NULL | `ACTIVE`、`PARTIALLY_CONSUMED`、`CONSUMED`、`RELEASED`。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Reallocate／release compare-and-set。 |
| `created_at`,`updated_at`,`created_by`,`updated_by` | BIGINT UNSIGNED | actor可NULL | 稽核欄位。 |

Indexes：`idx_inventory_allocations_reservation(reservation_id,status,id)`、`idx_inventory_allocations_balance(stock_balance_id,status,id)`、`idx_inventory_allocations_operation(create_operation_id,id)`。每次變更同時以delta更新Balance的`allocated_quantity`；Issue同時扣On Hand、Allocated、Reservation outstanding及Stock Control reserved。

### 4.12 `inventory_transfers`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Transfer ID。 |
| `transfer_number` | VARCHAR(50) | NOT NULL／UNIQUE | Server產生的人類可讀編號；不作跨模組FK。 |
| `source_warehouse_id`,`destination_warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK | 必須不同。 |
| `status` | VARCHAR(20) | NOT NULL／`DRAFT` | `DRAFT`、`IN_TRANSIT`、`RECEIVED`、`CANCELLED`。 |
| `create_operation_id` | BIGINT UNSIGNED | NOT NULL／UNIQUE／FK | 建立command。 |
| `dispatch_operation_id`,`receive_operation_id`,`cancel_operation_id` | BIGINT UNSIGNED | NULL／UNIQUE／FK | 各狀態command。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | 建立／Receive隔離等理由。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Draft edit／state transition。 |
| `created_at`,`updated_at`,`dispatched_at`,`received_at`,`cancelled_at` | BIGINT UNSIGNED | state times可NULL | Epoch ms。 |
| `created_by`,`updated_by`,`dispatched_by`,`received_by`,`cancelled_by` | BIGINT UNSIGNED | NULL／FK users | Actor。 |

Indexes：`idx_inventory_transfers_status(status,updated_at,id)`、`idx_inventory_transfers_source(source_warehouse_id,status,id)`、`idx_inventory_transfers_destination(destination_warehouse_id,status,id)`。`CHECK (source_warehouse_id <> destination_warehouse_id)`提供row-local第二層保護；service仍須提交時重驗兩端狀態、權限及ownership。

### 4.13 `inventory_transfer_lines`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Line ID。 |
| `transfer_id` | BIGINT UNSIGNED | NOT NULL／FK | Header。 |
| `line_number` | INT UNSIGNED | NOT NULL | Transfer內穩定排序。 |
| `sku_id`,`lot_id` | BIGINT UNSIGNED | NOT NULL／lot可NULL | 原SKU／Lot。 |
| `source_bin_id` | BIGINT UNSIGNED | NOT NULL／FK | Source Warehouse內Bin。 |
| `destination_bin_id` | BIGINT UNSIGNED | NULL／FK | Receive前可NULL；Receive必填。 |
| `dispatch_stock_status` | VARCHAR(20) | NOT NULL | Dispatch時狀態。 |
| `receive_stock_status` | VARCHAR(20) | NULL | 原狀態或`QUARANTINED`。 |
| `quantity` | BIGINT UNSIGNED | NOT NULL | 整張完整數量。 |
| `in_transit_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Dispatch後=quantity，Receive後=0。 |
| `dispatch_movement_group_id`,`receive_movement_group_id` | CHAR(36) | NULL | 對賬。 |
| `sku_code_snapshot`,`lot_number_snapshot`,`expiry_date_snapshot` | VARCHAR／DATE | NOT NULL／lot可空 | 歷史顯示。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Draft line version。 |

Constraints／indexes：`UNIQUE uq_inventory_transfer_line_number(transfer_id,line_number)`；`idx_inventory_transfer_lines_in_transit(transfer_id,in_transit_quantity,id)`；SKU／Lot composite FK及source／destination Bin ownership由service在Header warehouse lock後驗證。Header非DRAFT後不提供line update／delete。

### 4.14 `inventory_stocktakes`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Stocktake ID。 |
| `stocktake_number` | VARCHAR(50) | NOT NULL／UNIQUE | 人類可讀編號。 |
| `warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK | 單一Warehouse。 |
| `status` | VARCHAR(30) | NOT NULL／`DRAFT` | `DRAFT`、`COUNTING`、`READY_TO_POST`、`POSTED`、`CANCELLED`。 |
| `create_operation_id`,`start_operation_id`,`ready_operation_id`,`post_operation_id`,`cancel_operation_id` | BIGINT UNSIGNED | create必填，其餘可NULL／UNIQUE／FK | 狀態command。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | Posting／cancel需要時使用。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Workflow compare-and-set。 |
| `created_at`,`updated_at`,`started_at`,`ready_at`,`posted_at`,`cancelled_at` | BIGINT UNSIGNED | state times可NULL | Epoch ms。 |
| 對應`*_by` | BIGINT UNSIGNED | NULL／FK users | Actor。 |

Indexes：`idx_inventory_stocktakes_list(warehouse_id,status,updated_at,id)`及`idx_inventory_stocktakes_status(status,updated_at,id)`。

### 4.15 `inventory_stocktake_bins`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Scope row。 |
| `stocktake_id`,`bin_id` | BIGINT UNSIGNED | NOT NULL／FK | Stocktake與Bin。 |
| `bin_code_snapshot` | VARCHAR(50) | NOT NULL | 歷史顯示。 |
| `created_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE uq_inventory_stocktake_bin(stocktake_id,bin_id)`；另設candidate key `UNIQUE uq_inventory_stocktake_bin_owner(id,stocktake_id,bin_id)`供Lock及Line composite FK。如此DB可證明`stocktake_bin_id`確實屬同一Stocktake及同一Bin。同Bin同時最多一個未完成Stocktake由下一張active lock唯一鍵強制，不以查詢後插入的race-prone方式保證。

### 4.16 `inventory_bin_locks`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Lock record。 |
| `bin_id` | BIGINT UNSIGNED | NOT NULL／FK | 被鎖Bin。 |
| `lock_type` | VARCHAR(20) | NOT NULL | 本期只有`STOCKTAKE`，保留欄位不是通用workflow。 |
| `stocktake_id`,`stocktake_bin_id` | BIGINT UNSIGNED | NOT NULL／FK | Lock owner。 |
| `locked_at`,`locked_by` | BIGINT UNSIGNED | NOT NULL／actor可NULL | 取得資訊。 |
| `released_at`,`released_by` | BIGINT UNSIGNED | NULL | 解除資訊。 |
| `release_reason` | VARCHAR(100) | NOT NULL／`''` | `POSTED`或`CANCELLED`。 |
| `active_scope` | TINYINT GENERATED | STORED | `IF(released_at IS NULL,1,NULL)`。 |

`UNIQUE uq_inventory_bin_active_lock(bin_id,active_scope)`利用NULL可重複語意保留歷史但只允許一個active lock；`idx_inventory_bin_locks_owner(stocktake_id,released_at,id)`支援owner-safe release。所有會改Bin On Hand的service在lock `inventory_bins`後查`released_at IS NULL`並回`BIN_LOCKED_BY_STOCKTAKE`。

`FOREIGN KEY (stocktake_bin_id,stocktake_id,bin_id) REFERENCES inventory_stocktake_bins(id,stocktake_id,bin_id) ON DELETE RESTRICT`取代三個彼此獨立、可能交叉錯配的ownership FKs。

### 4.17 `inventory_stocktake_lines`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Count line。 |
| `stocktake_id`,`stocktake_bin_id` | BIGINT UNSIGNED | NOT NULL／FK | Header及scope。 |
| `stock_balance_id` | BIGINT UNSIGNED | NULL／FK | Snapshot時已有bucket；現場新發現可NULL直到posting建立。 |
| `bin_id`,`sku_id`,`lot_id`,`stock_status` | IDs／VARCHAR | NOT NULL／lot可NULL | 完整盤點維度。 |
| `lot_scope` | BIGINT GENERATED | STORED | `IFNULL(lot_id,0)`。 |
| `snapshot_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Start時帳面數。 |
| `snapshot_balance_version` | INT UNSIGNED | NOT NULL／0 | 新發現row為0。 |
| `counted_quantity` | BIGINT UNSIGNED | NULL | 未點算為NULL；0是有效實數。 |
| `is_not_found` | TINYINT(1) | NOT NULL／0 | 明確標記未發現，Ready時視為count 0。 |
| `variance_quantity` | BIGINT SIGNED | NULL | Ready時計算`actual-snapshot`；不接受client值。 |
| `movement_id` | BIGINT UNSIGNED | NULL／FK | Posting差異為0時可NULL。 |
| `version` | INT UNSIGNED | NOT NULL／1 | 兩人輸入衝突。 |
| `counted_at`,`counted_by` | BIGINT UNSIGNED | NULL | 最後點算資訊。 |

`UNIQUE uq_inventory_stocktake_dimension(stocktake_id,bin_id,sku_id,lot_scope,stock_status)`；`idx_inventory_stocktake_lines_progress(stocktake_id,counted_quantity,is_not_found,id)`。Posting不使用舊snapshot version作一般optimistic update，因Counting期間Bin lock已阻止合法變更；若current與snapshot仍不同，視為完整性事故並拒絕。

每行另以`FOREIGN KEY (stocktake_bin_id,stocktake_id,bin_id) REFERENCES inventory_stocktake_bins(id,stocktake_id,bin_id) ON DELETE RESTRICT`強制scope一致；不得只設三個獨立FK。

### 4.18 `inventory_control`

單列控制Inventory是否已正式Go-Live，不建立通用設定平台。

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | TINYINT UNSIGNED | PK／固定1 | Singleton。 |
| `lifecycle_status` | VARCHAR(20) | NOT NULL／`PRE_GO_LIVE` | `PRE_GO_LIVE`或`LIVE`；不可逆。 |
| `go_live_at`,`go_live_by` | BIGINT UNSIGNED | NULL | 正式啟用資料。 |
| `go_live_reason` | VARCHAR(500) | NOT NULL／`''` | 高風險操作原因。 |
| `version`,`updated_at`,`updated_by` | INT／BIGINT | NOT NULL／actor可NULL | Compare-and-set及稽核。 |

Migration以idempotent insert建立`id=1`。Go-Live command使用`jwt-device-password＋inventory.mgmt`、version、reason及operation claim；只允許`PRE_GO_LIVE → LIVE`，不提供回復API。

### 4.19 `inventory_opening_jobs`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Job ID。 |
| `job_number` | VARCHAR(50) | NOT NULL／UNIQUE | 顯示編號。 |
| `template_version` | VARCHAR(20) | NOT NULL | 本期`v1`。 |
| `status` | VARCHAR(30) | NOT NULL | `UPLOADED`、`VALIDATING`、`READY`、`INVALID`、`QUEUED`、`POSTING`、`COMPLETED`、`FAILED`、`CANCELLED`。 |
| `source_file_path` | VARCHAR(500) | NULL | Server-generated相對路徑；不可由client指定。 |
| `source_file_hash` | CHAR(64) | NOT NULL | SHA-256。 |
| `source_file_size` | BIGINT UNSIGNED | NOT NULL | Upload limit驗證。 |
| `total_rows`,`valid_rows`,`error_rows`,`movement_rows` | INT UNSIGNED | NOT NULL／0 | Summary。 |
| `precheck_snapshot_hash` | CHAR(64) | NULL | 所有normalized rows＋版本的hash，confirm時重驗。 |
| `confirm_operation_id` | BIGINT UNSIGNED | NULL／UNIQUE／FK | Posting domain operation。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | Confirm必填。 |
| `lease_owner` | VARCHAR(64) | NULL | Worker claim。 |
| `lease_generation` | BIGINT UNSIGNED | NOT NULL／0 | 每次claim/takeover遞增的fencing token。 |
| `lease_expires_at`,`next_attempt_at` | BIGINT UNSIGNED | NULL | Restart recovery。 |
| `attempt_count` | INT UNSIGNED | NOT NULL／0 | bounded retry。 |
| `error_code`,`error_summary` | VARCHAR(80)／VARCHAR(500) | NOT NULL／`''` | Safe job error。 |
| `version` | INT UNSIGNED | NOT NULL／1 | State compare-and-set。 |
| `created_at`,`updated_at`,`confirmed_at`,`completed_at` | BIGINT UNSIGNED | state times可NULL | Epoch ms。 |
| `created_by`,`confirmed_by` | BIGINT UNSIGNED | NULL／FK users | Actor。 |

Indexes：`idx_inventory_opening_jobs_queue(status,next_attempt_at,lease_expires_at,id)`、`idx_inventory_opening_jobs_list(status,created_at,id)`、`idx_inventory_opening_jobs_hash(source_file_hash,id)`。Worker沿用Scheduler與DB lease；claim在短transaction原子設定新owner並遞增generation。Worker每20秒以獨立短connection續租60秒；所有進度／完成／失敗寫入均帶`WHERE lease_owner=? AND lease_generation=?`，affected rows不是1即視為失去ownership並停止。

Opening business posting transaction不長時間鎖Job row，讓heartbeat可續租；最後的`COMPLETED` job update放在同一business transaction內並帶owner＋generation fence。若第一個worker失去lease而第二個已takeover，第一個final update為0並令整個Inventory posting rollback，杜絕stale worker寫數量或結果。

### 4.20 `inventory_opening_rows`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Row ID。 |
| `job_id`,`row_number` | BIGINT／INT UNSIGNED | NOT NULL | CSV row。 |
| `warehouse_code`,`bin_code`,`sku_code` | VARCHAR | NOT NULL | Safe normalized display input。 |
| `lot_number` | VARCHAR(100) | NOT NULL／`''` | No lot用空字串。 |
| `expiry_date` | DATE | NULL | 解析後日期。 |
| `stock_status` | VARCHAR(20) | NOT NULL | 三種狀態。 |
| `quantity` | BIGINT UNSIGNED | NULL | 解析成功後Base UOM整數。 |
| `warehouse_id`,`bin_id`,`sku_id`,`lot_id` | BIGINT UNSIGNED | NULL／FK | Precheck resolved IDs；Lot可待posting建立。 |
| `normalized_dimension_hash` | CHAR(64) | NULL | 重複列偵測。 |
| `input_version_hash` | CHAR(64) | NULL | Master／SKU政策版本快照。 |
| `validation_status` | VARCHAR(20) | NOT NULL／`PENDING` | `PENDING`、`VALID`、`INVALID`。 |
| `error_details` | JSON | NULL | 只含row、field、public code及safe message。 |
| `movement_id` | BIGINT UNSIGNED | NULL／FK | 成功Posting後關聯；quantity 0不建row且precheck警告。 |

Constraints／indexes：`UNIQUE uq_inventory_opening_row(job_id,row_number)`、`INDEX idx_inventory_opening_dimension(job_id,normalized_dimension_hash,row_number)`、`idx_inventory_opening_rows_validation(job_id,validation_status,row_number)`。Dimension不可設DB UNIQUE，否則第二個重複row無法保存其precheck錯誤；worker以group query標示所有重複rows。CSV formula prefix在parse前拒絕或匯出時加單引號；不保存原始未過濾整列。

### 4.21 `inventory_audit_logs`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Audit ID。 |
| `occurred_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |
| `actor_user_id` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `actor_label` | VARCHAR(190) | NOT NULL | Username／service identity snapshot。 |
| `action` | VARCHAR(80) | NOT NULL | 固定allowlist。 |
| `target_type` | VARCHAR(40) | NOT NULL | warehouse、bin、reservation、allocation、movement_group、transfer、stocktake、opening等。 |
| `target_id`,`target_label` | BIGINT UNSIGNED／VARCHAR(190) | ID可NULL／label必填 | 不設target FK以保留歷史。 |
| `outcome` | VARCHAR(20) | NOT NULL | `SUCCEEDED`、`REJECTED`、`FAILED`。成功記錄與業務效果同交易；失敗記錄不得冒充成功。 |
| `reason_category`,`reason_text` | VARCHAR(40)／VARCHAR(500) | NOT NULL／`''` | 高風險／例外必填。 |
| `before_summary`,`after_summary` | JSON | NULL | 白名單最小摘要；不存完整CSV或request body。 |
| `operation_request_id` | BIGINT UNSIGNED | NULL／FK | Source trace。 |
| `request_id`,`correlation_id` | VARCHAR(64) | NOT NULL／`''` | Log串聯。 |
| `ip` | VARCHAR(45) | NOT NULL／`''` | UI request；internal可空。 |

Indexes：`idx_inventory_audit_time(occurred_at,id)`、`idx_inventory_audit_target(target_type,target_id,occurred_at,id)`、`idx_inventory_audit_actor(actor_user_id,occurred_at,id)`、`idx_inventory_audit_operation(operation_request_id,id)`。同Movement一樣不提供update／delete repository；以DB trigger阻擋一般修改。

必要的`SUCCEEDED` Audit在business transaction內寫入，Audit失敗令業務回滾。Service validation／version／source conflict等拒絕在原transaction rollback後，以獨立短transaction寫`REJECTED`／`FAILED`安全摘要；若這個次要寫入也失敗，必須fallback至現有system/security log並觸發failure visibility。Auth middleware在進入handler前拒絕的401／403由框架request/security log保存，不能為寫Inventory Audit而繞過原本的authorization boundary。

### 4.22 Referential constraint矩陣

| Child | Foreign key | Parent／Delete rule |
| --- | --- | --- |
| `inventory_bins` | `warehouse_id` | `inventory_warehouses.id`／RESTRICT |
| `inventory_lots` | `sku_id` | `item_skus.id`／RESTRICT |
| `inventory_stock_controls` | `warehouse_id`,`sku_id` | Warehouse、Item SKU／RESTRICT |
| `inventory_stock_balances` | `(bin_id,warehouse_id)`,`sku_id`,`(lot_id,sku_id)` | Bin ownership、SKU、Lot ownership／RESTRICT |
| `inventory_operation_requests` | `actor_user_id` | `users.id`／SET NULL |
| `inventory_movements` | `operation_request_id`,`warehouse_id`,`(bin_id,warehouse_id)`,`sku_id`,`(lot_id,sku_id)` | Operation／Warehouse／Bin ownership／SKU／Lot；全部RESTRICT，nullable composite可跳過Bin/Lot。 |
| `inventory_movements` optional | reservation、allocation、transfer／line、stocktake／line、reversal self | 全部RESTRICT；在parent tables建立後補FK。 |
| `inventory_reservations` | create operation、warehouse、sku、actor | Business parent RESTRICT；actor SET NULL。 |
| `inventory_allocations` | create operation、reservation、stock balance、actor | Business parent RESTRICT；actor SET NULL。 |
| `inventory_transfers` | source/destination warehouse、各operation、actors | Business parent RESTRICT；actors SET NULL。 |
| `inventory_transfer_lines` | transfer、sku／lot ownership、source/destination bins | Header及master RESTRICT；draft line只可由service顯式刪除。 |
| `inventory_stocktakes` | warehouse、各operation、actors | Business parent RESTRICT；actors SET NULL。 |
| `inventory_stocktake_bins` | stocktake、bin；candidate `(id,stocktake_id,bin_id)` | RESTRICT。 |
| `inventory_bin_locks` | composite `(stocktake_bin_id,stocktake_id,bin_id)`、actors | Composite owner RESTRICT；actors SET NULL。 |
| `inventory_stocktake_lines` | composite `(stocktake_bin_id,stocktake_id,bin_id)`、balance、sku／lot、movement、actor | Composite scope及business refs RESTRICT；actor SET NULL。 |
| `inventory_control` | go-live/update actor | `users.id`／SET NULL。 |
| `inventory_opening_jobs` | confirm operation、actors | Operation RESTRICT；actors SET NULL。 |
| `inventory_opening_rows` | job、resolved master IDs、movement | Job可在PRE_GO_LIVE未confirm時由顯式cancel清理；已confirm後全部RESTRICT。 |
| `inventory_audit_logs` | actor、operation | Actor SET NULL；operation RESTRICT。Target刻意不設FK以保留被刪對象歷史。 |

所有`created_by/updated_by/*_by`均按相同actor SET NULL規則。任何CASCADE只可用於尚未產生業務歷史的Draft child，不能由刪除Master連鎖刪除Movement、Audit、Reservation、Transfer、Stocktake或Opening結果。

### 4.23 FK建立順序與Migration切片

`HD-007`把原本混合 operation／movement 的切片拆開，並固定目前已核准的實體配置。Operation與Audit屬P0基礎，不能依賴P1才建立的master／stock tables；Movement則保留到P1，在master與stock之後建立。

| Prefix | Logical migration | Phase／Task | 內容 |
| --- | --- | --- | --- |
| `0054` | `seed_inventory_permissions` | P0-T03 | 五項permission seed；可重跑且與catalogue一致。 |
| `0055` | `create_inventory_operations` | P0-T05 | Domain operation requests及source tuple唯一鍵；不依賴Inventory master／stock。 |
| `0056` | `create_inventory_audit` | P0-T05 | Audit及immutable triggers；在第一個business write前完成。 |
| `0057` | `create_inventory_master` | P1-T01 | Warehouses、bins。 |
| `0058` | `create_inventory_stock` | P1-T05 | Lots、stock_controls、stock_balances。 |
| `0059` | `create_inventory_movements` | P1-T05 | Movements及immutable triggers；依賴master與stock。 |
| `0060` | `create_inventory_reservations` | P2-T01 | Reservations、allocations。 |
| `0061` | `create_inventory_transfers` | P3-T01 | Transfer headers／lines；補Movement optional FKs。 |
| `0062` | `create_inventory_stocktakes` | P4-T01 | Headers／bins／locks／lines；補Movement optional FKs。 |
| `0063` | `create_inventory_opening` | P5-T01 | Control singleton、opening jobs／rows。 |

`0054`已在未合併的P0實作分支建立；`0055`～`0063`在寫入前仍須重新檢查最新main及其他已批准配額。若任何編號已被占用，停止並回到設計／計畫重新配置，不改寫已存在migration。DDL依賴順序比章節展示順序優先。若optional FK造成cycle，先建nullable欄位與index，待兩端table存在後用後續`ALTER TABLE`補FK；不移除關聯欄位或改用無約束自由文字逃避依賴。

---

## 5. API與Internal Interface詳細設計

### 5.1 共通API契約

- Base path為`/api/v1/inventory`；沿用現有GET查詢、POST command風格。
- Handler目錄第一段使用`server/src/handlers/inventory/`，並通過既有handler discovery及convention tests。
- 所有request schema設`additionalProperties:false`；params ID為positive safe integer string；quantity為JSON safe positive integer，上限由config設定且不得超過DB／JavaScript safe範圍。
- 列表query統一`page,pageSize,q,sortBy,descending`加特定filters；預設20、上限100，固定以`id`作最後tie-breaker。
- 列表response為`{items,total,page,pageSize}`；client service轉成DataTable的`{rows,rowsNumber}`。
- 日期輸入為`YYYY-MM-DD`；timestamp response為epoch ms，UI以`APP_TIME_ZONE`顯示；CSV timestamp為ISO 8601＋offset。
- 所有POST command要求`Idempotency-Key`並啟用framework idempotency；domain command另要求／建立source identity。
- Mutable resource command帶`version`；stale回HTTP 409及`VERSION_CONFLICT`，不自動重送或回傳未授權current detail。
- Response由`inventoryProjections.js`白名單映射，不spread DB row。錯誤沿用`ApplicationError`公開信封，client在`errorMessages.js`提供繁體中文。
- Child ID必須連同owner ID查找；不屬owner與不存在都回404，避免水平越權資料洩漏。
- CSV download加`Content-Disposition`、`nosniff`及`Cache-Control:no-store, private`；輸出文字以`=,+,-,@,tab,CR`開頭時作公式注入neutralization。

### 5.2 Warehouse／Bin APIs

| Method／Path | Handler | Auth／Permission | 行為 |
| --- | --- | --- | --- |
| `GET /api/v1/inventory/warehouses` | `listWarehousesHandler.js` | jwt／`inventory.view` | 分頁；q搜code/name；status filter；預設Active。 |
| `GET /api/v1/inventory/warehouses/:id` | `getWarehouseHandler.js` | jwt／`inventory.view` | Warehouse、Bin摘要、阻擋狀態及version。 |
| `POST /api/v1/inventory/warehouses/create` | `createWarehouseHandler.js` | jwt／view＋`inventory.mgmt` | normalized unique、Active建立、idempotent。 |
| `POST /api/v1/inventory/warehouses/:id/update` | `updateWarehouseHandler.js` | jwt／view＋mgmt | code/name/address/description完整editable projection＋version。 |
| `POST /api/v1/inventory/warehouses/:id/deactivate` | `deactivateWarehouseHandler.js` | jwt-password／view＋mgmt | reference／balance／open flow guard、reason、version。 |
| `POST /api/v1/inventory/warehouses/:id/reactivate` | `reactivateWarehouseHandler.js` | jwt-password／view＋mgmt | version＋reason；不自動恢復Bins。 |
| `POST /api/v1/inventory/warehouses/:id/delete` | `deleteWarehouseHandler.js` | jwt-device-password／view＋mgmt | 只限從未使用及無Bin；reason＋version。 |
| `GET /api/v1/inventory/warehouses/:warehouseId/bins` | `listBinsHandler.js` | jwt／`inventory.view` | 分頁；q、status、lockStatus。 |
| `GET /api/v1/inventory/warehouses/:warehouseId/bins/:binId` | `getBinHandler.js` | jwt／`inventory.view` | Bin、current lock、阻擋摘要及version。 |
| `POST /api/v1/inventory/warehouses/:warehouseId/bins/create` | `createBinHandler.js` | jwt／view＋mgmt | Warehouse內unique；Warehouse須Active。 |
| `POST /api/v1/inventory/warehouses/:warehouseId/bins/:binId/update` | `updateBinHandler.js` | jwt／view＋mgmt | 完整editable fields＋version。 |
| `POST .../bins/:binId/deactivate`／`reactivate`／`delete` | 對應handlers | password或device-password／view＋mgmt | 依風險執行guard、reason、version。 |

Warehouse／Bin status command使用各自固定route，讓`authType`在啟動時確定。停用檢查與狀態更新在同一transaction重驗，不能只依detail頁預檢結果。

### 5.3 Stock／Lot／Movement查詢 APIs

| Method／Path | Auth | Query／行為 |
| --- | --- | --- |
| `GET /api/v1/inventory/stocks` | jwt／`inventory.view` | q（SKU Code／Name／Barcode）、warehouseId、binId、skuId、lot、expiryFrom/To、status、availability、page/sort；回明確數量欄。 |
| `GET /api/v1/inventory/stocks/:balanceId` | jwt／view | Bucket detail、Lot、current allocation摘要、最近movements及version。 |
| `GET /api/v1/inventory/stocks/summary` | jwt／view | 指定skuId及可選warehouseId／purpose／minimumRemainingDays，回Total、Available、Reserved、ATP、uncoveredReserved、Quarantined、Damaged、InTransit。 |
| `GET /api/v1/inventory/lots` | jwt／view | skuId／lot／expiry range／expiryState／warehouse；分頁。 |
| `GET /api/v1/inventory/movements` | jwt／view | 日期、type、source、sku、warehouse、bin、lot、actor；固定`posted_at DESC,id DESC`。 |
| `GET /api/v1/inventory/movements/:id` | jwt／view | Movement、group legs、source及reversal link。 |
| `GET /api/v1/inventory/operations/by-source` | jwt／view或呼叫方已授權internal use | 完整source tuple精確查詢；只回結果projection，不列舉其他來源。 |
| `GET /api/v1/inventory/expiry` | jwt／view | expired／withinDays、sku／warehouse／status；不自動發通知。 |

Stock list每個row回：`balanceId,warehouse,bin,sku,lot,stockStatus,isExpired,onHand,allocated,bucketFree,baseUom,version`。SKU aggregate另外回`totalOnHand,eligibleOnHand,reserved,atp,uncoveredReserved,inTransit`，不可把不同scope混成單一`quantity`。

### 5.4 Receipt／Issue／Move／Adjustment APIs

| Method／Path | Handler | Auth／Permission | 行為 |
| --- | --- | --- | --- |
| `POST /api/v1/inventory/receipts` | `postReceiptHandler.js` | jwt／view＋`inventory.operation` | 正式source、SKU／UOM、Bin、Lot／Expiry、Status；原子Balance＋Movement＋Audit。 |
| `POST /api/v1/inventory/issues` | `postIssueHandler.js` | jwt／view＋operation | 正式source、Reservation及Allocation lines；全有或全無Issue。 |
| `POST /api/v1/inventory/bin-moves` | `postBinMoveHandler.js` | jwt／view＋operation | 同Warehouse、同SKU／Lot／Status；成對Movement。 |
| `POST /api/v1/inventory/status-transfers` | `postStatusTransferHandler.js` | jwt-device-password／view＋`inventory.adjust` | 同bucket維度轉Status；reason＋versions。 |
| `POST /api/v1/inventory/adjustments` | `postAdjustmentHandler.js` | jwt-device-password／view＋adjust | 正／負、reason category/text、source、version。 |
| `POST /api/v1/inventory/movements/:id/reverse` | `reverseMovementHandler.js` | jwt-device-password／view＋adjust | 完整反向原movement group；reason＋source；重驗現況。 |

Inventory UI不提供沒有來源的Receipt／Issue表單；上述HTTP endpoints供已取得Inventory operation權限的倉務整合／營運入口。正式Receiving／Fulfillment頁應由其handler驗證自己的權限後直接呼叫§5.11 internal service，令下游角色不必取得Inventory管理頁權限。

Receipt request核心範例：

```json
{
  "source": {
    "module": "RECEIVING",
    "documentType": "GOODS_RECEIPT",
    "documentId": "GR-2026-000123",
    "lineId": "10",
    "eventId": "b7f42d2d-54d2-4b25-b3df-22d1dbfc1073"
  },
  "skuId": 101,
  "quantity": 120,
  "uomId": 5,
  "warehouseId": 2,
  "binId": 35,
  "lotNumber": "LOT-260901-A",
  "expiryDate": "2027-09-01",
  "manufactureDate": "2026-09-01",
  "stockStatus": "AVAILABLE",
  "minimumLifeOverride": {
    "permission": "receiving.expiry.override",
    "reason": "Approved short-dated receipt",
    "minimumLifeDaysApplied": 60,
    "actualRemainingLifeDays": 45,
    "actorId": 42,
    "receiptId": "GR-2026-000123",
    "requestId": "req-7f8c"
  }
}
```

`quantity`如以Pack UOM提交，Inventory在transaction內讀有效`toBaseFactor`並換算，response同時回`inputQuantity,inputUom,baseQuantity,baseUom`。若caller已提交Base UOM，仍須帶base UOM ID或明確`quantityUnit:"BASE"`，不可猜測。`minimumLifeOverride`只接受固定permission `receiving.expiry.override`，並須保存逐筆reason、actor、SKU／Lot／Expiry、適用門檻、實際剩餘日數、Receipt／GR、request／operation及Movement trace；已過期Lot永遠拒絕。一般Receipt不傳此物件。

Adjustment `reasonCategory`只接受`COUNT_GAIN, COUNT_LOSS, DAMAGE, EXPIRY, DATA_CORRECTION, TRANSFER_VARIANCE, OTHER`；所有類別均須reason text，`OTHER`須提供足以人工理解的更詳細說明。

### 5.5 Reservation／Allocation APIs

| Method／Path | Auth／Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/inventory/reservations` | jwt／`inventory.view` | source／sku／warehouse／status／uncovered；分頁。 |
| `GET /api/v1/inventory/reservations/:id` | jwt／view | quantity breakdown、source、allocations、version。 |
| `POST /api/v1/inventory/reservations/create` | jwt／view＋operation | 全有或全無；source、sku、warehouse、quantity、purpose、minimumRemainingDays。 |
| `POST /api/v1/inventory/reservations/:id/release` | jwt／view＋operation | release正整數、source event、version；可部分。 |
| `POST /api/v1/inventory/reservations/:id/cancel` | jwt／view＋operation | 釋放全部outstanding；來源取消事件、version。 |
| `GET /api/v1/inventory/reservations/:id/allocation-candidates` | jwt／view＋operation | FEFO／FIFO排序候選、requestedQuantity、asOf及balance versions。 |
| `POST /api/v1/inventory/reservations/:id/allocations/create` | jwt／view＋operation | 一或多bucket；依FEFO／FIFO建議，偏離時按策略驗權及要求原因。 |
| `POST /api/v1/inventory/reservations/:id/allocations/release` | jwt／view＋operation | 指定allocation IDs／quantities，全有或全無。 |
| `POST /api/v1/inventory/reservations/:id/allocations/reallocate` | jwt／view＋operation | 在一個transaction release舊＋建立新，避免中途失去一致性。 |

Allocation create request必須帶Reservation version及每個Balance version；server重新產生候選，不信任client提供的策略或推薦rank。Response回新的Reservation、Allocation及Balance versions，方便下一個Issue提交。

### 5.6 Transfer APIs

| Method／Path | Auth／Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/inventory/transfers` | jwt／`inventory.view` | number、source/destination、status、date；分頁。 |
| `GET /api/v1/inventory/transfers/:id` | jwt／view | header、lines、In Transit、movements、versions。 |
| `POST /api/v1/inventory/transfers/create` | jwt／view＋`inventory.operation` | 建Draft及完整lines；不動庫存。 |
| `POST /api/v1/inventory/transfers/:id/update` | jwt／view＋operation | DRAFT only；完整replace lines＋header version。 |
| `POST /api/v1/inventory/transfers/:id/cancel` | jwt／view＋operation | DRAFT only；reason＋version。 |
| `POST /api/v1/inventory/transfers/:id/dispatch` | jwt／view＋operation | 整張Dispatch；source event＋version；全部lines原子。 |
| `POST /api/v1/inventory/transfers/:id/receive` | jwt／view＋operation | 每line目的Bin／receive status；整張Receive。 |

Receive body line ID集合必須與Transfer全部lines完全相等，不可缺漏、重複或多出；每行quantity固定等於dispatched quantity，client不可提交部分數量。

### 5.7 Stocktake APIs

| Method／Path | Auth／Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/inventory/stocktakes` | jwt／`inventory.view` | warehouse／bin／status／date；分頁。 |
| `GET /api/v1/inventory/stocktakes/:id` | jwt／view | header、scope、progress、variance summary、version。 |
| `GET /api/v1/inventory/stocktakes/:id/lines` | jwt／view | progress／variance filters；分頁。 |
| `POST /api/v1/inventory/stocktakes/create` | jwt／view＋`inventory.operation` | Draft及一或多Bins；不鎖。 |
| `POST /api/v1/inventory/stocktakes/:id/update` | jwt／view＋operation | DRAFT only，完整replace scope＋version。 |
| `POST /api/v1/inventory/stocktakes/:id/start` | jwt／view＋operation | 建active Bin locks及snapshot，全有或全無。 |
| `POST /api/v1/inventory/stocktakes/:id/counts/save` | jwt／view＋operation | 1～100 lines；counted或notFound；每line version。 |
| `POST /api/v1/inventory/stocktakes/:id/lines/add` | jwt／view＋operation | 現場新發現dimension，snapshot 0。 |
| `POST /api/v1/inventory/stocktakes/:id/ready` | jwt／view＋operation | 全部line完成才COUNTING→READY。 |
| `POST /api/v1/inventory/stocktakes/:id/post` | jwt-device-password／view＋`inventory.adjust` | 全部variance原子過帳並owner-safe解鎖。 |
| `POST /api/v1/inventory/stocktakes/:id/cancel` | jwt-password／view＋operation | DRAFT／COUNTING／READY；reason＋version；不產生Movement。 |
| `GET /api/v1/inventory/stocktakes/:id/export` | jwt／view | scope、snapshot、actual、variance、movement IDs。 |

Count save不是高風險adjustment，因它不改On Hand；真正Posting固定要求`inventory.adjust`及重新認證。

### 5.8 Opening／Go-Live APIs

| Method／Path | Auth／Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/inventory/opening/template` | jwt／view＋`inventory.mgmt` | UTF-8 CSV v1及欄位說明。 |
| `POST /api/v1/inventory/opening/upload` | jwt／view＋mgmt | multipart單一CSV、size／signature／headers檢查，建立job及排precheck。 |
| `GET /api/v1/inventory/opening/jobs` | jwt／view＋mgmt | status/date/actor；分頁。 |
| `GET /api/v1/inventory/opening/jobs/:id` | jwt／view＋mgmt | summary、safe row errors及precheck版本。 |
| `POST /api/v1/inventory/opening/jobs/:id/confirm` | jwt-device-password／view＋mgmt | READY only；reason＋version；排posting worker。 |
| `POST /api/v1/inventory/opening/jobs/:id/cancel` | jwt-password／view＋mgmt | 非VALIDATING／POSTING／COMPLETED才可取消。 |
| `GET /api/v1/inventory/opening/jobs/:id/result` | jwt／view＋mgmt | Safe CSV result；已清理檔案回410，job/audit仍在。 |
| `POST /api/v1/inventory/go-live` | jwt-device-password／view＋mgmt | singleton version＋reason；不可逆關閉Opening。 |

Template v1固定欄位：`warehouseCode,binCode,skuCode,lotNumber,expiryDate,stockStatus,baseQuantity`。不包含Reserved、Allocated、In Transit、成本、自訂欄位或Pack UOM。Upload上限10,000 data rows；未知header、重複header、額外欄位、公式內容、BOM／encoding問題均回row／field安全錯誤。

Precheck只寫job／row validation資料，不寫Lot、Balance、Movement或Audit success。Confirm worker先鎖`inventory_control`確認PRE_GO_LIVE，再依固定順序處理所有scope；precheck snapshot失效則job回READY並標示`OPENING_PRECHECK_STALE`，要求重新Precheck，不能使用舊解析結果硬過帳。

### 5.9 CSV匯出 APIs

| Path | Permission | 內容 |
| --- | --- | --- |
| `GET /api/v1/inventory/exports/stocks` | `inventory.view` | 與Stock畫面相同filters及數量語意。 |
| `GET /api/v1/inventory/exports/movements` | `inventory.view` | 與Movement畫面相同filters。 |
| `GET /api/v1/inventory/exports/expiry` | `inventory.view` | Expired／withinDays結果。 |
| `GET /api/v1/inventory/exports/reservations` | `inventory.view` | Active／uncovered及來源最小資訊。 |
| `GET /api/v1/inventory/exports/transfers` | `inventory.view` | In Transit及收發對賬。 |

匯出以keyset pagination分批讀取並stream response，不把全部2M Movement載入記憶體。單次最大row數及執行時間由config限制；截斷時response header及最後summary row明確指出，不靜默少資料。每次匯出寫`inventory.export` Audit，保存filter hash及row count，不保存整份檔案。

### 5.10 穩定公開錯誤碼

| HTTP | Code | 條件 |
| --- | --- | --- |
| 400 | `INVENTORY_INPUT_INVALID`、`INVENTORY_QUANTITY_INVALID` | schema、0／負數／小數／超限。 |
| 400 | `WAREHOUSE_INVALID`、`BIN_INVALID`、`BIN_WAREHOUSE_MISMATCH` | Master狀態或ownership。 |
| 400 | `SKU_NOT_INVENTORY_TRACKED`、`SERIAL_TRACKING_UNSUPPORTED` | SKU不適用。 |
| 400/409 | `LOT_REQUIRED`、`EXPIRY_REQUIRED`、`LOT_DATA_CONFLICT` | Tracking／同Lot資料。 |
| 409 | `WAREHOUSE_CODE_TAKEN`、`BIN_CODE_TAKEN` | normalized unique。 |
| 409 | `WAREHOUSE_IN_USE`、`BIN_IN_USE` | 停用／刪除guard。 |
| 409 | `INSUFFICIENT_STOCK`、`INSUFFICIENT_ATP`、`ALLOCATION_INSUFFICIENT` | 全有或全無不足。 |
| 409 | `RESERVATION_STATE_CONFLICT`、`ALLOCATION_STATE_CONFLICT` | 狀態／數量不再符合。 |
| 409 | `VERSION_CONFLICT`、`CONCURRENT_OPERATION` | stale或DB lock競爭。 |
| 409 | `INVENTORY_SOURCE_CONFLICT`、`IDEMPOTENCY_CONFLICT` | 同identity不同payload。 |
| 409 | `PICK_SEQUENCE_REASON_REQUIRED`、`FEFO_OVERRIDE_REQUIRED` | 偏離FIFO缺原因，或偏離FEFO缺專門權限／原因。 |
| 403 | `FEFO_OVERRIDE_DENIED`、`PERMISSION_STALE` | 無權或actor已失效。 |
| 409 | `LOT_EXPIRED`、`LOT_MINIMUM_LIFE_FAILED`、`STOCK_STATUS_INELIGIBLE` | 不合資格bucket。 |
| 409 | `BIN_LOCKED_BY_STOCKTAKE` | Counting semantic lock；details只回可見Stocktake number。 |
| 409 | `TRANSFER_STATE_CONFLICT`、`TRANSFER_PARTIAL_NOT_SUPPORTED` | Transfer狀態／部分收發。 |
| 409 | `STOCKTAKE_STATE_CONFLICT`、`STOCKTAKE_INCOMPLETE`、`STOCKTAKE_SNAPSHOT_MISMATCH` | Stocktake。 |
| 409 | `MOVEMENT_ALREADY_REVERSED`、`MOVEMENT_TYPE_NOT_REVERSIBLE`、`REVERSAL_NOT_ALLOWED` | 已反向、非generic allowlist或當下不變量阻擋。 |
| 409 | `OPENING_PRECHECK_STALE`、`OPENING_STATE_CONFLICT` | Opening。 |
| 403 | `OPENING_CLOSED` | Go-Live後永久拒絕。 |
| 404 | `INVENTORY_RESOURCE_NOT_FOUND` | 不存在或owner不符。 |
| 410 | `OPENING_RESULT_EXPIRED` | Job仍在但result file已清理。 |
| 503 | `INVENTORY_DEPENDENCY_UNAVAILABLE` | 提交必需Item／DB依賴失效，fail closed。 |

MySQL duplicate／FK error按constraint name映射公開code，不回SQL、constraint原文或stack。`error.details`只含安全field、public rule及必要currentVersion。

### 5.11 下游同步Internal Contracts

下游模組不得直接寫Inventory tables，也不需要取得Inventory管理頁permission。其handler先驗證自己的業務權限，再把同一transaction executor及可信command context傳入：

```js
InventoryPostingService.postReceiptInTransaction(transaction, command)
InventoryPostingService.postIssueInTransaction(transaction, command)
InventoryReservationService.createInTransaction(transaction, command)
InventoryReservationService.releaseInTransaction(transaction, command)
InventoryReservationService.cancelInTransaction(transaction, command)
InventoryReservationService.allocateInTransaction(transaction, command)
InventoryReservationService.allocateForFulfillmentBatchInTransaction(transaction, command)
InventoryReservationService.releaseFulfillmentAllocationsInTransaction(transaction, command)
InventoryPostingService.postFulfillmentIssueBatchInTransaction(transaction, command)
InventoryPostingService.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(transaction, command)
InventoryTransferService.dispatchInTransaction(transaction, command)
InventoryTransferService.receiveInTransaction(transaction, command)
InventoryLookupService.getStockSummary(transaction, query)
InventoryLookupService.listAllocationCandidates(transaction, query)
```

Internal `command`必須包括：

```js
{
  actor: { userId, serviceName, claimedRoles, claimedPermissions },
  authorization: { purpose, requiredCallerPermission },
  source: { module, documentType, documentId, lineId, eventId },
  correlationId,
  payload
}
```

- `requiredCallerPermission`由provider contract針對Receiving／Fulfillment等固定映射，不接受caller傳入任意permission name再自稱通過。
- Receiving低效期例外固定映射`receiving.expiry.override`並驗證逐筆evidence；Customer Return Receipt固定預設`QUARANTINED`，品質檢查完成後才可另走Status Transfer轉為`AVAILABLE`或`DAMAGED`。
- Service要求已傳入transaction；若沒有則立即拋TypeError，避免上下游以為共用transaction但Inventory偷偷另開transaction。
- Inventory在提交點重讀actor、SKU及位置狀態。若必要依賴不可用，整個來源transaction rollback。
- Query contract可用database service非transaction執行；任何數量寫入只能走command contract。
- Fulfillment batch allocation由Inventory計算完整推薦序列及`FEFO／FIFO`偏離類型；caller不可自報`selectionStrategy`以降低權限。
- `reverseFulfillmentIssueAndRestoreReservationBatchInTransaction()`只接受已成功且未沖銷的Fulfillment Shipment Issue references，整批回補原bucket及原Reservation；它不修改或重開原Allocation，generic HTTP reversal endpoint亦不可呼叫此能力。

---

## 6. 權限、安全與威脅模型

### 6.1 Permission Catalogue

| Permission | 能力 | 不包含 |
| --- | --- | --- |
| `inventory.view` | 所有一般Inventory查詢及CSV匯出 | 任何寫入。 |
| `inventory.operation` | Receipt／Issue、Reservation／Allocation、Bin Move、Transfer及Stocktake count | Master、Adjustment、FEFO override。 |
| `inventory.mgmt` | Warehouse／Bin、Opening及Go-Live | Adjustment、FEFO override。 |
| `inventory.adjust` | Adjustment、Status Transfer、Reversal、Stocktake Posting | Master、一般operation自動授權。 |
| `inventory.fefo.override` | 偏離FEFO但仍合資格；FIFO偏離由來源模組自身operation permission＋原因控制 | 過期／低效期／非AVAILABLE／不足繞過。 |

五項權限互不繼承。頁面若要讀後寫，route requirement可要求view，按鈕再依額外permission顯示；後端仍完整驗證。System administrator角色名稱不自動取得任何Inventory權限。

### 6.2 Authentication strength

| 操作 | `authType` | 理由 |
| --- | --- | --- |
| 查詢、一般正常operation、count save | `jwt` | 標準已登入操作。 |
| Warehouse／Bin停用恢復、Stocktake cancel、Opening cancel | `jwt-password` | 具營運影響且需要當次確認。 |
| Adjustment、Status Transfer、Reversal、Stocktake Posting、Opening Confirm、Go-Live、永久刪除Master | `jwt-device-password` | 高風險數量或不可逆操作；綁actor＋device＋action＋短有效時間。 |
| FEFO override | `jwt`＋專門permission＋reason | 需求明確不要求另一人審批；提交點重讀permission。 |

高風險route固定認證策略，不接受前端傳`isHighRisk`切換。Password只供auth strategy消耗，不進domain command、hash、log或audit。

### 6.3 Trust boundaries及STRIDE摘要

| Boundary／資產 | 主要威脅 | 控制 |
| --- | --- | --- |
| Browser／HTTP → Handler | 偽造actor、越權、XSS、超大payload、參數污染 | JWT／device-password、route policy、AJV strict schema、body/upload limits、Quasar escaping。 |
| CSV → Opening parser | Formula injection、惡意欄、壓垮記憶體、路徑控制 | multipart限制、stream parser、10k row cap、server path、header allowlist、formula拒絕。 |
| 下游module → Inventory service | 偽造source、重播、繞過Inventory permission | 固定caller contract、同transaction、domain unique source、payload hash、purpose allowlist。 |
| Inventory service → MySQL | SQL injection、lost update、deadlock、半套寫入 | 參數化SQL、allowlist identifiers、Stock Control lock、fixed order、transaction rollback。 |
| Movement／Audit／Balance | Tampering、repudiation、直接修數 | 無CRUD、DB immutable trigger、必要Audit同交易、source/correlation trace、least-privilege DB account。 |
| Stocktake semantic lock | 競爭插入、錯owner解鎖、服務重啟失鎖 | DB unique active lock、owner-safe release、持久化狀態、所有posting共用guard。 |
| Export／Logs | 未授權外洩、CSV執行、敏感payload | Permission、projection allowlist、formula neutralization、no-store、redaction、row/time limit。 |

Abuse cases必須納入測試：替換Bin／Lot／Reservation ID跨owner、以同source event改quantity、繞過FEFO permission、直接呼叫高風險route、上傳巨大／畸形CSV、在Counting Bin由另一入口過帳、嘗試UPDATE／DELETE ledger。

### 6.4 資料保護與日誌

- Inventory不收集Customer／Supplier銀行、付款或健康資料；只保存庫存需要的業務ID及歷史快照。
- 自由文字reason最大500字，輸出由Vue文字binding逃逸；不得使用`v-html`。
- Request logging對`password,token,authorization,csv,file,rawRows`及可配置敏感欄位redact。
- Error response不含SQL、stack、file path、其他Warehouse未授權資料或完整source payload。
- Movement、Stocktake、Opening及Audit保存至少7年；job source／result檔案可依營運政策較早清理，但hash、normalized result、movement links及audit仍須保留7年。
- App DB account不得有`DROP`、`ALTER`、`TRIGGER`或對Movement／Audit的UPDATE／DELETE權限；migration account必須獨立且只在受控部署使用。帳號分離及一次成功的backup／restore rehearsal是Go-Live硬性gate，不接受正式環境共用帳號例外。

---

## 7. UI／UX詳細設計

本章所有頁面必須遵守`docs/frontend-design.md`：使用`PageHeader`、`DataTable`、`FormPanel`、`EllipsisCell`及既有Notify／confirm helpers；使用Quasar spacing及theme tokens；真正heading；繁體中文；WCAG 2.1 AA；375／768／1024／1440px驗證。不可自行使用raw `q-table`、inline hex或另一套表單錯誤處理。

### 7.1 Navigation與頁面權限

| Page | Route | Route Permission | 主要用途 |
| --- | --- | --- | --- |
| 庫存總覽 | `/inventory/stocks` | `inventory.view` | SKU／Barcode、Warehouse／Bin／Lot／Status查詢及數量摘要。 |
| 批次與效期 | `/inventory/lots` | `inventory.view` | 即將到期、已過期、low-life及分布。 |
| 庫存異動 | `/inventory/movements` | `inventory.view` | Ledger、source、group及reversal link。 |
| 預留與分配 | `/inventory/reservations` | `inventory.view` | Active／uncovered Reservation及Allocation詳情。 |
| 倉庫與庫位 | `/inventory/warehouses` | `inventory.view` | Master列表；mgmt可編輯。 |
| 跨倉調撥 | `/inventory/transfers` | `inventory.view` | Draft／In Transit／Received／Cancelled；operation可操作。 |
| 庫存調整 | `/inventory/adjustments` | view＋`inventory.adjust` | Adjustment、Status Transfer、Reversal入口及近期結果。 |
| 盤點 | `/inventory/stocktakes` | `inventory.view` | 建立、Counting、差異及Posting。 |
| 開帳與上線 | `/inventory/opening` | view＋`inventory.mgmt` | Template、Precheck、Confirm、Go-Live狀態。 |

Sidebar group「庫存管理」只顯示使用者可進入的頁面。無權限直接URL進403；後端完全獨立驗證。Receipt／Issue不提供獨立Inventory無來源建單頁，由Receiving／Fulfillment頁觸發。

### 7.2 庫存總覽

- 預設以SKU聚合列表顯示SKU Code／Name、Base UOM、Total On Hand、Available、Reserved、ATP、Quarantined、Damaged及In Transit。
- 點擊row展開／進detail，再以Warehouse → Bin → Lot／No Lot → Status顯示bucket，清楚呈現同Lot可分多Bin。
- 搜尋支援SKU Code、Name及Barcode；精確Code／Barcode排在partial name之前。
- Filter包含Warehouse、Bin、Lot、Status、zero ATP、no stock、expired及within days；URL保存filter／page／sort。
- Status badge必須有文字；Expired、low-life及uncovered Reservation使用文字＋icon，不以顏色作唯一訊號。
- 表格有detail action時使用`sticky-actions`；長SKU／Lot／Bin文字使用`EllipsisCell`。

### 7.3 Warehouse／Bin維護

- Warehouse列表與選中Warehouse下Bin列表採主從版面；mobile改成先選Warehouse再進Bin頁，不硬塞雙欄。
- 新增／修改使用`FormPanel`，後端normalized conflict映射到code field。
- 停用前detail顯示預檢摘要，但dialog明確說明提交時會重新檢查；有阻擋時列出類型及數量，不暴露無權detail。
- Delete、deactivate及reactivate使用既有password reason dialog或擴充同一helper，不另造prompt元件。

### 7.4 Reservation與Allocation

- Reservation detail同時顯示Original、Consumed、Released、Outstanding及source link。
- Allocation drawer顯示Server FEFO／FIFO候選、Expiry、remaining days、First Receipt、Bin、free quantity及建議順序。
- 偏離任何建議序列都顯示原因欄；偏離FEFO另驗`inventory.fefo.override`，偏離FIFO使用來源模組operation權限。畫面固定說明「仍不可選過期／低效期／非AVAILABLE」。
- 資料載入後若bucket改變，409時保留使用者輸入但強制重新載入候選；不可自動改選另一Lot。

### 7.5 Transfer

- Draft editor一次維護完整lines；每line選SKU／Lot／source Bin／quantity。離開前提示未保存變更。
- Dispatch確認頁顯示來源總數、Reservation保障及「整張過帳，不支援部分」警告。
- Receive要求每line選目的Bin；可選保持原Status或Quarantined，後者必填reason。
- In Transit detail清楚顯示來源已扣、目的未入及每line in-transit數量；不顯示可修改／取消按鈕。

### 7.6 Stocktake

- Wizard只有四步：選Warehouse／Bins → Start → Count → Review／Post。
- Start前提示目標Bins將暫停所有庫存異動；Counting頁持續顯示lock狀態及Stocktake number。
- Count欄接受非負整數，0與未輸入明確不同；「未發現」是獨立checkbox/action。
- 以DataTable server pagination顯示count progress，支援SKU／Barcode快速定位及加入帳外bucket。
- Ready頁顯示總lines、未完成、盤盈、盤虧、零差異；只有未完成=0才可提交。需要修改時取消並重建，不提供reopen捷徑。
- Post由具adjust權限者輸入密碼及原因；失敗後顯示Bin仍鎖定，不可誤報完成。

### 7.7 Opening

- 頁首固定顯示PRE_GO_LIVE或LIVE。LIVE後隱藏upload／confirm並顯示「後續差異請使用調整或盤點」。
- 流程為下載模板 → Upload → Precheck progress → Row errors → Confirm → Reconciliation；不把Upload直接當成入帳。
- Row errors以row number、field及繁中訊息顯示／下載；不在頁面輸出原始未過濾CSV。
- Confirm顯示row count、quantity摘要、file hash短值及不可部分成功說明，使用device-password。
- Worker狀態poll使用有上限interval並在頁面離開時取消；FAILED可查看safe error及重新Precheck／新upload指引。

### 7.8 可用性與無障礙驗收

- 所有icon-only actions有`aria-label`；loading表格`aria-busy`；dialog focus trap及關閉後focus返回觸發點。
- FormPanel error summary取得focus並連到field error；quantity／date欄具有可理解label、hint及錯誤。
- 鍵盤可完成filter、開啟detail、count、Transfer及高風險確認；不要求drag-and-drop。
- 任何成功／失敗用`notifySuccess`／`notifyError`；狀態改變後重新fetch server事實，不只在前端改row。

---

## 8. 具體程式碼架構與變更清單

### 8.1 修改既有檔案

| File | 修改 |
| --- | --- |
| `server/src/modules/authorization/permissionCatalogue.js` | 加五項Inventory permissions。 |
| `server/src/services/idempotency/IdempotencyService.js` | `identityScope()`只要有可信`req.auth.claims.sub`便使用authenticated actor scope，涵蓋jwt／jwt-password／jwt-device-password；public request才使用IP。 |
| `server/config/application.js` | 掛入typed inventory config；不直接讀散落env。 |
| `server/config/scheduler.js` | 註冊Opening worker schedule／lease設定（若現有job自註冊模式則只由service definition註冊）。 |
| `client/src/framework/http/errorMessages.js` | 加§5.10所有會顯示的繁中錯誤。 |
| `client/config/menu.js` | 只在現有menu group metadata需要明確group label／order時加「庫存管理」；route本身由page discovery。 |
| `server/test/permissionCatalogueConventions.test.js` | 期望Inventory permission catalogue與DB seed一致。 |
| `server/test/idempotencyService.test.js` | 同IP不同authenticated actors不共用key；同actor強認證route可正確replay且不退回public scope。 |
| `server/test/integration/migrations.integration.test.js` | 新tables、FK、indexes、triggers及seed驗證。 |

除上述已證實的Idempotency actor scope缺陷外，不修改framework dispatcher、authorization、database transaction或frontend discovery來遷就Inventory。該修正應作為獨立atomic commit先通過既有及新增framework tests，再由Inventory routes使用。若實作發現確實缺少「共享現有transaction」能力，先以現有RequestContext中的`databaseTransaction`評估，提出獨立framework變更，不在Inventory service內私自取pool connection。

### 8.2 新增Backend設定與Domain Module

```text
server/config/inventory.js
server/src/modules/item/ItemLookupService.js
server/src/modules/inventory/
  inventoryConstants.js
  inventoryErrors.js
  inventoryValidation.js
  inventoryProjections.js
  normalizeInventoryConfig.js
  InventoryMasterService.js
  InventoryInquiryService.js
  InventoryPostingService.js
  InventoryReservationService.js
  InventoryPickSequenceService.js
  InventoryTransferService.js
  InventoryStocktakeService.js
  InventoryOpeningService.js
  InventoryOperationService.js
  InventoryLockService.js
  InventoryAuditService.js
  InventoryLookupService.js
  opening/
    inventoryCsv.js
    InventoryOpeningWorker.js
```

`ItemLookupService`由Item module擁有，提供`getInventoryProfileInTransaction(transaction,skuId)`及`resolveUomInTransaction(transaction,skuId,uomId)`，回SKU status、inventoryTracked、trackingPolicy、Base UOM、整數factor及minimum life的白名單projection；不得要求下游actor持有`item.view`。新增`server/test/itemLookupService.test.js`及Inventory consumer contract test，證明Inactive／Archived／Serial／UOM版本語意一致。

若已有跨Item／Supplier／Customer共用CSV parser dependency，沿用同一版本；否則新增一個RFC 4180 parser並在lockfile記錄。不得自行`split(',')`。

### 8.3 新增Handlers

```text
server/src/handlers/inventory/
  inventorySchemas.js
  warehouseHandlers.js
  binHandlers.js
  stockHandlers.js
  lotHandlers.js
  movementHandlers.js
  postingHandlers.js
  reservationHandlers.js
  allocationHandlers.js
  transferHandlers.js
  stocktakeHandlers.js
  openingHandlers.js
  exportHandlers.js
```

為控制檔案大小，可按resource拆成單一handler檔案；每個exported class必須有唯一`handlerName`及完整static api。共同schema只放真正共用的source、pagination、quantity、version及reason，不建立一個允許任意body的萬用schema。

### 8.4 新增Frontend

```text
client/src/services/inventory.js
client/src/pages/inventory/StocksPage.vue
client/src/pages/inventory/LotsPage.vue
client/src/pages/inventory/MovementsPage.vue
client/src/pages/inventory/ReservationsPage.vue
client/src/pages/inventory/WarehousesPage.vue
client/src/pages/inventory/TransfersPage.vue
client/src/pages/inventory/AdjustmentsPage.vue
client/src/pages/inventory/StocktakesPage.vue
client/src/pages/inventory/OpeningPage.vue
client/src/components/inventory/StockSummary.vue
client/src/components/inventory/StockBucketTable.vue
client/src/components/inventory/AllocationPanel.vue
client/src/components/inventory/TransferEditor.vue
client/src/components/inventory/StocktakeCounter.vue
client/src/composables/inventory/useInventoryFilters.js
```

只在兩個以上頁面真正重用時抽component／composable。第一個垂直slice可把小型編輯器留在page內；後續出現第二個使用點才抽出，避免預先抽象。

### 8.5 新增Migrations與Test Support

```text
server/database/migrations/0054_seed_inventory_permissions.js
server/database/migrations/0055_create_inventory_operations.js
server/database/migrations/0056_create_inventory_audit.js
server/database/migrations/0057_create_inventory_master.js
server/database/migrations/0058_create_inventory_stock.js
server/database/migrations/0059_create_inventory_movements.js
server/database/migrations/0060_create_inventory_reservations.js
server/database/migrations/0061_create_inventory_transfers.js
server/database/migrations/0062_create_inventory_stocktakes.js
server/database/migrations/0063_create_inventory_opening.js
server/test-support/fakeInventoryDatabase.js
server/test-support/inventoryFixtures.js
```

這是`HD-007`核准的實體配置，不是可自行平移的示例。每支尚未建立的migration開始前仍要fetch main並檢查全部migration filenames、`fr_schema_migrations`及其他worktree配額；碰撞時停止並重新批准配置，不得重用空缺或修改已套用migration。

---

## 9. Unit Test設計

### 9.1 原則與門檻

- Pure rule tests不連DB；service tests注入fake transaction／database、time、item lookup、authorization及audit。
- 每個state transition、quantity invariant、expiry boundary、lock order及idempotency branch至少一個正向及一個反向case。
- 新增代碼不得降低現有全專案coverage floors：server lines 92%、branches 83%、functions 90%；Inventory核心純規則及state machine目標branch 100%。
- Unit test不得以stub成永遠成功掩蓋transaction rollback、Audit failure、duplicate key或concurrency conflict。
- 時間測試注入Time Service固定clock，不依真實今日或process timezone。

### 9.2 Pure validation／calculation tests

| Test file | 必測內容 |
| --- | --- |
| `inventoryValidation.test.js` | code trim/case/control chars、quantity正整數／safe max、source tuple、reason、IDs、status allowlist、unknown fields。 |
| `inventoryExpiry.test.js` | APP_TIME_ZONE local date、expiry=今日仍可用、次日Expired、minimum remaining days、DST無關date-only語意。 |
| `inventoryQuantity.test.js` | Base UOM整數、Pack factor整數、overflow、ATP／uncovered公式、不使用float。 |
| `inventoryPickSequence.test.js` | 有Expiry先FEFO、其後FIFO、fifo anchor／lot／bin／id穩定排序、跨Bin同Lot、部分跨bucket建議。 |
| `inventoryStateMachines.test.js` | Reservation、Allocation、Transfer、Stocktake所有合法／非法transition。 |
| `inventoryOperationHash.test.js` | canonical key order、同payload同hash、欄位／quantity變更不同hash、password排除但business fields保留。 |
| `inventoryCsv.test.js` | RFC4180 quotes/newlines/BOM、header exactness、duplicate rows、formula、10k cap、row/field errors。 |
| `inventoryProjections.test.js` | quantity語意分欄、敏感/internal欄位不外洩、history snapshot不被current master取代。 |

### 9.3 Service unit tests

#### `inventoryMasterService.test.js`

- Warehouse Code全公司case-insensitive unique；Bin Code只在Warehouse內unique。
- Warehouse/Bin update version conflict；Inactive parent不可新增Bin。
- On Hand、Reservation／Allocation、open Transfer或active lock阻擋停用；Movement history只阻擋永久刪除，current blockers已清除後仍可停用。
- Warehouse deactivate與同時Receipt／Reservation使用同一Warehouse row lock；測兩種先後都不會留下Inactive Warehouse＋新庫存／open flow。
- Audit failure令write rollback；actor stale被拒絕。

#### `inventoryOperationService.test.js`

- First claim成功；同tuple＋hash replay result；同tuple＋不同hash衝突。
- Unique race只一個winner；空sourceLine仍唯一。
- Result summary只含allowlist；indeterminate commit指引可按source查回。

#### `inventoryPostingService.test.js`

- Receipt依none／batch／batch_expiry建立或取得Lot、更新正確bucket、movement、audit。
- 無Lotbucket由0變正時設定`fifo_anchor_date`、保持正數時不改、歸零時清空；所有IN／OUT／Move／Reversal路徑一致。
- Serial、不追蹤、Inactive SKU／Warehouse／Bin、Lot conflict、low receipt life無有效override均拒絕。
- Issue扣On Hand、Allocated、Reservation outstanding及Control reserved；任一步失敗全rollback。
- Bin Move及Status Transfer成對legs、總On Hand不變；已Allocation部分不可移走；不足、跨Warehouse、Counting lock拒絕。
- Adjustment正負、Reserved保障、Reversal唯一性及當下規則重驗；只允許Receipt／Issue／Bin Move／Status Transfer／Adjustment group。
- Generic Reverse Issue不復活Reservation／Allocation；Fulfillment專用反向命令只恢復原Reservation、不重開Allocation；Transfer／Stocktake／Opening／Reversal group回`MOVEMENT_TYPE_NOT_REVERSIBLE`。

#### `inventoryReservationService.test.js`

- ATP足夠全量成功，不足零寫入；並發路徑先鎖Stock Control。
- Consume／release／cancel quantity等式及terminal state。
- Allocation不扣On Hand但更新bucket allocated；不得超Reservation或bucket。
- Reallocate在同transaction release＋create；中途失敗保留原allocation。
- FEFO／FIFO一般排序、混合Expiry順序、兩類override、無權／缺reason／仍不合資格各分支。

#### `inventoryTransferService.test.js`

- Draft不改quantity；完整replace line version及warehouse ownership。
- Dispatch全lines全有或全無，來源扣減、in-transit增加、movements及state正確。
- Receive line集合exact、目的Bin、status保持／Quarantined reason、in-transit歸零。
- 部分收發、同Warehouse、In Transit edit/cancel、重送不同payload均拒絕。

#### `inventoryStocktakeService.test.js`

- Start先建全部locks及snapshot；任一Bin已鎖時零新增。
- 所有posting service共用lock guard；DRAFT不阻擋。
- count 0、未輸入、notFound、新發現bucket及dimension duplicate。
- Ready completeness；Ready後不可修改；Post全差異／零差異、Audit及owner-safe unlock。
- Posting一行失敗時全部rollback、狀態及locks不變；cancel無Movement並解鎖。

#### `inventoryOpeningService.test.js`

- PRE_GO_LIVE guard、upload metadata、async lease、worker restart接手。
- Precheck零inventory business writes；任一錯誤令整job INVALID。
- snapshot stale要求recheck；Confirm需要fresh actor、mgmt、device-password、reason。
- 10k rows固定lock order及單transaction；任一步失敗無Lot／Balance／Movement半套。
- 長於60秒的job持續heartbeat；takeover令舊generation所有progress/final writes為0，舊worker的business transaction完整rollback。
- Go-Live不可逆；LIVE後template可否下載依UI政策，但upload／confirm必定拒絕。

### 9.4 Handler及Client service tests

`inventory*Handlers.test.js`覆蓋：static API metadata、authType、permission、idempotency enabled、schema strictness、params conversion、service mapping、response status及error propagation。GET不意外啟用write idempotency；所有POST均要求key。

`client/test/services/inventory.test.js`覆蓋每個API path、query omission、Idempotency-Key傳遞、list response映射、file download及取消請求；不得在client重算可信quantity。

---

## 10. Integration、Frontend、安全及效能測試

### 10.1 真MySQL Migration／Constraint Integration

`server/test/integration/inventoryMigrations.integration.test.js`使用與CI及production完全相同的MySQL Server 26.7.0驗證：

- 全新DB及既有schema兩種路徑均可apply；重跑skip安全。
- 所有FK、unique、generated columns及indexes實際存在。
- 同Warehouse重複Bin被擋、不同Warehouse相同Bin成功。
- NULL lot bucket unique不被MySQL NULL語意繞過。
- 同Bin只有一個active semantic lock，released history可多筆。
- 以Stocktake A的`stocktake_bin_id`搭配Stocktake B或另一Bin直接insert Lock／Line時，composite FK拒絕。
- Movement／Audit UPDATE及DELETE triggers實際拒絕。
- Permission code catalogue、DB rows及handler references完全一致。
- Migration失敗後重新執行能收斂，且不依賴DDL transaction rollback。

### 10.2 API＋DB Integration

| Test file | 核心scenario |
| --- | --- |
| `inventoryMaster.integration.test.js` | AC-001～003、006；CRUD、status、history guard、permissions。 |
| `inventoryStock.integration.test.js` | AC-004～012；跨Bin／混放、數量摘要、Lot／Expiry／Status／Serial。 |
| `inventoryPosting.integration.test.js` | AC-013～018；Receipt／Issue、replay、payload conflict、rollback、Reversal。 |
| `inventoryReservation.integration.test.js` | AC-019～027；真並發Reservation、consume/release、Allocation及FEFO／FIFO。 |
| `inventoryMovement.integration.test.js` | AC-028～029、035～039；Move、Adjustment、Status及stale version。 |
| `inventoryTransfer.integration.test.js` | AC-030～034；Draft、Dispatch、Receive、replay及partial rejection。 |
| `inventoryStocktake.integration.test.js` | AC-040～043；persistent lock、所有入口阻擋、atomic post／cancel。 |
| `inventoryOpening.integration.test.js` | AC-044～046；precheck、atomic confirm、Go-Live close。 |
| `inventoryContracts.integration.test.js` | AC-047～048；下游permission、同transaction rollback、撤權後提交。 |

Transaction failure injection至少覆蓋：operation後、Balance後、Movement後、Reservation後、Audit前／Audit寫入時及commit indeterminate模擬。測試必須驗證所有相關tables，而不只看HTTP status。

### 10.3 真並發測試

- ATP 10時兩條獨立connection各Reservation 7，以barrier同時通過初始讀；最終最多一個成功且Reserved=7。
- On Hand 10時並發Issue 7與Transfer Dispatch 7；最多一個quantity效果成功。
- 同bucket兩個Adjustment使用相同version；一個成功，一個409。
- Stocktake Start與Receipt競爭同Bin；結果只能是Start先成功並阻擋Receipt，或Receipt先完成後snapshot包含其效果。
- 同source event兩個並發request；一個執行，另一個replay／in-progress，不可兩個Movement groups。
- 同IP的兩名authenticated users使用相同Idempotency-Key及payload不可互相replay；三種JWT auth type均使用actor scope。
- Lock順序測試以多SKU、多Bin反向輸入證明service先排序；deadlock若仍發生轉穩定可重試錯誤且無半套資料。

### 10.4 Frontend component／page tests

| Test file | 核心驗證 |
| --- | --- |
| `inventoryStocks.test.js` | URL filters、server pagination、聚合／bucket數量不混淆、badge文字、permission。 |
| `inventoryWarehouses.test.js` | Master／Bin CRUD、FormPanel errors、deactivate blocker及version conflict。 |
| `inventoryReservations.test.js` | source、quantity breakdown、FEFO／FIFO候選、兩類override UI、409 reload。 |
| `inventoryTransfers.test.js` | Draft editor、完整line集合、In Transit read-only、Receive bins。 |
| `inventoryStocktakes.test.js` | count 0 vs empty、notFound、progress、lock banner、post permission。 |
| `inventoryOpening.test.js` | PRE_GO_LIVE／LIVE、upload/precheck/poll/cancel、row errors、confirm。 |
| `inventoryMovements.test.js` | stable filters、group legs、source link、reversal visibility。 |

共通檢查：route guard、action button permission、DataTable而非raw q-table、sticky actions、FormPanel focus error、abort stale request、loading／empty／error／retry、375px layout及keyboard操作。

### 10.5 Security tests

- 每支endpoint分別測未登入401、缺permission 403、撤權／停用actor 403。
- 以另一Warehouse／Transfer／Reservation／Stocktake child ID替換URL或body，回404／安全409且零資料改變。
- SQL wildcard、quotes、control chars、prototype-like keys及超長值不改變query結構。
- Reason／Lot／SKU snapshots以文字escape，無stored XSS；CSV export無公式執行。
- Password、token、完整CSV、SQL、stack、server path不出現在response、structured log或Audit。
- High-risk routes不能以普通JWT通過；reauth proof不可由另一actor／device／action重放。
- Direct DB UPDATE／DELETE Movement／Audit被trigger阻擋；application account privilege驗證列入部署smoke。
- Upload拒絕錯MIME／signature、超size、超row、未知headers、symlink/path traversal及多檔案。

### 10.6 效能與容量驗證

資料集：5 Warehouses、1,000 Bins、100,000 SKUs、500,000個non-zero Stock Buckets、2,000,000 Movements、20名並發Inventory users。

| Scenario | Gate |
| --- | --- |
| SKU Code／Barcode exact search | p95 < 2s；query plan使用exact index，不full scan Movement。 |
| SKU stock summary及Bin drill-down | p95 < 2s；分頁total正確。 |
| FEFO／FIFO candidates | p95 < 2s；使用warehouse/sku/status/expiry/fifo anchor indexes及bounded result。 |
| Movement list常用filters | p95 < 2s；固定sort，無filesort over full table。 |
| 20-user mixed Receipt／Issue／Reservation | 無不合法quantity；lock wait及error rate在驗收環境記錄。 |
| 10,000-row Opening precheck＋posting | 系統處理合計 <= 10分鐘；記錄parse、validate、lock、write各階段。 |

效能測試保存MySQL `EXPLAIN`、資料生成參數、硬體／DB設定及p50/p95/p99；不能用空DB結果聲稱符合NFR。

### 10.7 Backup、Restore與Reconciliation Test

- 對完整測試資料做backup，再在隔離DB restore。
- 比對每SKU/Warehouse：Balance On Hand、Reservation outstanding、Allocation outstanding、In Transit及Movement signed totals。
- 比對Movement group legs及source operation uniqueness；Stocktake／Opening movement links不得斷裂。
- 執行reconciliation queries後差異=0，才滿足AC-050；只證明table row count相同不足夠。

---

## 11. Configuration、Logging、Jobs與營運

### 11.1 `server/config/inventory.js`

只放部署／容量參數，不把已確認業務規則變成可隨意切換的flags：

```js
export default {
  defaultPageSize: 20,
  maxPageSize: 100,
  maxCommandLines: 100,
  maxQuantity: Number.MAX_SAFE_INTEGER,
  httpIdempotencyTtlMs: 7 * 24 * 60 * 60 * 1000,
  domainOperationRetentionDays: 2557,
  exportMaxRows: 100000,
  exportTimeoutMs: 120000,
  openingMaxRows: 10000,
  openingMaxBytes: 10 * 1024 * 1024,
  openingWorkerIntervalMs: 5000,
  openingLeaseMs: 60000,
  openingLeaseRenewIntervalMs: 20000,
  openingMaxAttempts: 3,
  retainedHistoryDays: 2557
};
```

實際值由typed normalizer驗證。`httpIdempotencyTtlMs`只設定framework HTTP replay window且至少7日；`inventory_operation_requests`依`domainOperationRetentionDays`保存且本期不purge。`domainOperationRetentionDays`及`retainedHistoryDays`均不得低於7年政策；`negativeStockEnabled`、`partialTransferEnabled`或任意Stock Status config不得存在。Lease renew interval必須小於lease的一半，否則config啟動驗證失敗。

### 11.2 Audit action allowlist

至少包含：

```text
warehouse.create/update/deactivate/reactivate/delete
bin.create/update/deactivate/reactivate/delete
receipt.post issue.post bin_move.post status_transfer.post
adjustment.post movement.reverse
reservation.create/release/cancel/consume
allocation.create/release/reallocate fefo.override
transfer.create/update/cancel/dispatch/receive
stocktake.create/update/start/count/add_line/ready/post/cancel
opening.upload/precheck/confirm/post/cancel
inventory.go_live inventory.export
```

Action必須由server constant選取，不接受request自由輸入。成功事件的`outcome=SUCCEEDED`與業務效果同transaction；進入service後的拒絕／失敗在rollback後另寫`REJECTED`／`FAILED`安全Audit，auth middleware的提早拒絕由framework security log負責。任何失敗記錄都不可看似已完成數量效果。

### 11.3 Structured logs

事件名稱至少包括：

- `inventory.command.started|completed|rejected|failed|indeterminate`
- `inventory.idempotency.replayed|conflict`
- `inventory.lock.wait|conflict|deadlock`
- `inventory.stocktake.bin_locked|bin_released|posting_failed`
- `inventory.opening.validation_completed|posting_completed|lease_recovered|failed`
- `inventory.reconciliation.mismatch`

Context保存`requestId,correlationId,operationId,commandType,targetType,targetId,actorUserId,authType,requiredPermission,authorizationOutcome,reauthenticatedAt,reasonCategory,conditionSummary,sourceModule,sourceDocumentType,hashedSourceId,durationMs,rowCount,outcome,errorCode`。`reauthenticatedAt`只記時間，不記password／token／proof；`conditionSummary`只用server allowlist（例如bucket count、是否locked），不放自由文字或完整payload。Source document ID若可能含客戶資料，以hash或安全短碼記錄。

### 11.4 Metrics與告警

在未引入metrics backend前，先由結構化log／現有job stats產出下列計數與時延；不為Inventory單獨加入監控產品：

- command成功／拒絕／失敗及p95 duration，按command type。
- insufficient stock／ATP、FEFO override、version conflict、idempotency conflict、deadlock數量。
- active／uncovered Reservation、In Transit age、Counting Stocktake age。
- Opening queue age、attempts、lease recovery、processing duration及rows/sec。
- Reconciliation mismatch必須立即高優先告警；transaction indeterminate、Opening FAILED及長時間Bin lock需營運告警。

### 11.5 Jobs與復原

- Opening worker由現有Scheduler啟動，短transaction claim並遞增`lease_generation`；每20秒以獨立connection續租60秒。所有job state write以owner＋generation fencing，shutdown時停止取新job並讓在途transaction完成或由transaction timeout回滾。
- Worker crash在Commit前：transaction rollback，lease到期後重跑原operation；Commit結果不明：先按job/source查operation result，不盲目再寫。
- 定期reconciliation job只讀取並報告差異，不自動「修正」Balance。
- Expiry／uncovered Reservation可由查詢即時計算；本期不新增自動release或通知job。

### 11.6 Reconciliation invariants

營運runbook至少檢查：

1. 每Bucket的On Hand等於其Movement IN減OUT累計。
2. Stock Control reserved等於Reservation outstanding SUM。
3. Balance allocated等於Allocation outstanding SUM。
4. Transfer line In Transit等於Dispatch legs減Receive legs，RECEIVED為0。
5. Posted Stocktake variance等於關聯Movement效果；Cancelled無Movement。
6. Completed Opening valid rows與Opening Movement一一對應（quantity 0例外）。

任何差異不得直接SQL update；先凍結相關scope、保存證據、找根因，再透過正式Reversal／Adjustment或受控資料修復程序處理。

---

## 12. 分階段實作、部署與回滾

### 12.1 Phase 0：Integration foundation

- 確認最新main migration編號及Item實際schema／service contract。
- 加permission catalogue／seed、Inventory config、operation／lock／audit foundation。
- 明確處理Item `serial` policy：Inventory startup／posting fail closed，並在上線前確保沒有Active inventory-tracked Serial SKU。
- 建立真MySQL migration及transaction／idempotency／immutable trigger測試。

Gate：operation claim、fixed lock order、Movement/Audit不可變及同transaction internal call均有測試證據。

### 12.2 Phase 1：Core stock

- Warehouse／Bin、Lot、Stock Control、Stock Balance。
- Receipt／Issue、Movement inquiry、基本stock summary。
- Master／Stock／Movement UI及核心permissions。

Gate：AC-001～018、禁止負數、同source replay及Audit failure rollback通過；容量基線精確查找符合p95。

### 12.3 Phase 2：Order and warehouse operations

- Reservation／Allocation／FEFO／FIFO。
- Bin Move、Transfer、Adjustment、Status Transfer及Reversal。
- Stocktake semantic lock、count及Posting。

Gate：AC-019～043、真並發、所有Bin mutation入口lock coverage及高風險auth通過。

### 12.4 Phase 3：Opening、reporting及完整整合

- Opening CSV worker、Go-Live control及result。
- 全部exports、expiry／uncovered查詢、reconciliation runbook。
- Receiving、Fulfillment、Returns contract tests及backup/restore。

Gate：AC-044～050、10k Opening、2M Movement查詢、復原／對賬、上線演練通過。

### 12.5 部署順序

1. Fetch最新main，在獨立worktree整合並跑完整lint／test／coverage／build／audit。
2. 備份目標DB並驗證restore程序；確認migration account與app account權限。
3. 先部署additive migrations、permission seed及immutable triggers。
4. 部署Backend，再部署Frontend；先不執行Opening或Go-Live。
5. 指派五項permissions，建立Warehouse／Bins，執行smoke及一個隔離scope rehearsal。
6. 在隔離／UAT完成Opening Precheck、全量導入演練、舊系統及實物對賬。
7. 正式切換前凍結舊系統、再跑最新Precheck；Confirm Opening後完成全量對賬。
8. Product／Warehouse／QA簽核後執行不可逆Go-Live command，關閉Opening。

### 12.6 Rollback原則

- Migrations為additive；部署失敗可回退application code，空的新tables保留，不在事故中DROP。
- 尚未有正式Inventory posting前，可回退route／UI並修正migration後重部署。
- 已有Movement後不可回退到會繞過Inventory或不理解新schema的舊寫入版本；進入read-only營運、修復後forward deploy。
- 已完成Opening但未Go-Live，如資料錯誤以受控整批Reversal方案處理，不直接清表；需保留原job、hash、movements及audit。
- Go-Live狀態不可由一般rollback改回PRE_GO_LIVE。真正需要重做切換屬重大資料修復，需獨立runbook、備份及業務簽核。

### 12.7 Smoke及release evidence

- Permission route matrix、Warehouse/Bin query、Receipt replay、Reservation競爭、FEFO／FIFO、Issue、Bin Move、Transfer Dispatch/Receive、Stocktake lock/Post各一條。
- `SHOW TRIGGERS`及app account嘗試修改Movement/Audit均證明被拒絕。
- Reconciliation六項invariants全部差異0。
- 保存migration output、commit SHA、測試報告、capacity結果、backup ID、restore證據及Go-Live actor/time，不保存密碼或CSV原文。

---

## 13. 需求追溯矩陣

### 13.1 Business objectives及KPI

| Requirement IDs | 設計落點 | 驗證 |
| --- | --- | --- |
| `OBJ-01～OBJ-03` | §§2.1、3.3、4.6～4.9、5.3 | Stock／Movement integration及reconciliation。 |
| `OBJ-04～OBJ-05` | §§2.5～2.6、3.4～3.5、4.10～4.11 | Concurrency、Reservation、FEFO tests。 |
| `OBJ-06～OBJ-08` | §§3.6～3.8、5.4～5.11 | Transfer／Stocktake／internal contract tests。 |
| `KPI-01～KPI-05` | §§2.4～2.7、3.2～3.8、11.6 | Integration＋reconciliation counters。 |
| `KPI-06～KPI-09` | §§6～7、10.5～10.7、11.3～11.4 | Performance、security、transfer reconciliation。 |

### 13.2 Functional Requirements

| Requirement IDs | 設計落點 | 主要測試 |
| --- | --- | --- |
| `FR-MASTER-001～010` | §§4.3～4.4、5.2、7.3 | Master unit／integration、AC-001～006。 |
| `FR-STOCK-001～010` | §§2.6、3.3、4.6～4.7、5.3、7.2 | Stock query、performance、AC-004～006/011/049。 |
| `FR-LOT-001～010` | §§3.2、4.5、5.3～5.4 | Expiry／Lot tests、AC-007～012。 |
| `FR-POST-001～012` | §§2.4～2.7、3.8、4.8～4.9、5.4、5.11 | Posting/idempotency/rollback、AC-013～018。 |
| `FR-RES-001～010` | §§2.5～2.6、3.4、4.6、4.10、5.5 | Reservation concurrency、AC-019～022。 |
| `FR-ALLOC-001～010` | §§3.5、4.7、4.11、5.5、7.4 | FEFO／allocation、AC-023～027。 |
| `FR-MOVE-001～007` | §§3.3、3.8、4.7～4.9、5.4 | Move tests、AC-028～029。 |
| `FR-TRANSFER-001～012` | §§3.6、4.12～4.13、5.6、7.5 | Transfer tests、AC-030～034。 |
| `FR-ADJUST-001～010` | §§3.3、3.8、5.4、6.2、7.1 | Adjustment/status/reversal、AC-035～039。 |
| `FR-COUNT-001～012` | §§3.7、4.14～4.17、5.7、7.6 | Stocktake/lock tests、AC-040～043。 |
| `FR-OPEN-001～007` | §§4.18～4.20、5.8、7.7、11.5 | Opening tests、AC-044～046。 |
| `FR-REPORT-001～008` | §§5.3、5.9、7.2、10.6 | Query/export/performance。 |
| `FR-AUDIT-001～007` | §§3.8、4.8～4.9、4.21、6.4、11.2～11.3 | Audit failure、immutability及redaction tests。 |

### 13.3 Business Rules、Security及NFR

| Requirement IDs | 設計落點 |
| --- | --- |
| `BR-001～004` | §§4.3～4.7，Master uniqueness、formal IDs及flexible mixing。 |
| `BR-005～009` | §§3.3、4.1、4.6～4.9，integer、no-negative、ledger-only changes。 |
| `BR-010～015` | §§3.2、2.6、4.5，Tracking、Expiry及eligibility。 |
| `BR-016～020` | §§3.4～3.5、4.10～4.11，Reservation／Allocation／FEFO。 |
| `BR-021～022` | §§3.3、3.8、5.4，Stock Status及paired movement。 |
| `BR-023～027` | §§3.6、4.12～4.13、5.6，Move／Transfer／In Transit。 |
| `BR-028～031` | §§2.5、3.8、5.4、6.2，Reserved protection、Adjustment／Reversal。 |
| `BR-032～035` | §§3.7、4.14～4.20、5.7～5.8，Stocktake lock及Opening closure。 |
| `BR-036～045` | §§2.4～2.7、3.2～3.8、5.1、5.11，idempotency、submit revalidation、history、timezone及single writer。 |
| `SEC-001～004` | §§6.1、7.1，authentication及view/operation/mgmt separation。 |
| `SEC-005～008` | §§5.11、6.1～6.3，high-risk auth、FEFO及access control。 |
| `SEC-009～014` | §§5.1、5.8～5.10、6.3～6.4、10.5，validation、CSV、reauth、logging及data minimization。 |
| `NFR-001～005` | §§4.1、4.5～4.9、5.1、10.6、11.1，pagination、indexes及capacity gates。 |
| `NFR-006～010` | §§2.4～2.7、3.3、10.2～10.3、10.7、11.5～11.6，一致性、復原及備份。 |
| `NFR-011～014` | §§3.2、5.1、5.11、6.4、10.7，依賴隔離、7年保留、全渠道語意及timezone/integer。 |

### 13.4 Acceptance Criteria執行映射

| Acceptance Criteria | 測試設計 |
| --- | --- |
| `AC-001～006` | §10.2 `inventoryMaster.integration.test.js`及Stock inquiry。 |
| `AC-007～012` | §9.2 expiry/validation＋§10.2 Stock integration。 |
| `AC-013～018` | §9.3 Posting＋§10.2 Posting integration及failure injection。 |
| `AC-019～022` | §9.3 Reservation＋§10.3 concurrent connections。 |
| `AC-023～027` | §9.2 FEFO＋Reservation integration。 |
| `AC-028～034` | Movement／Transfer service及integration。 |
| `AC-035～039` | Adjustment／Status／Reversal及concurrency integration。 |
| `AC-040～043` | Stocktake persistent lock及atomic posting integration。 |
| `AC-044～046` | Opening parser／worker／Go-Live integration。 |
| `AC-047～048` | Internal contract、route policy及actor freshness integration。 |
| `AC-049` | §10.6完整容量效能測試。 |
| `AC-050` | §10.7 backup／restore／reconciliation。 |

### 13.5 Decision traceability

| Decision IDs | 設計結果 |
| --- | --- |
| `DEC-001～003` | 5-Warehouse SME定位；精確Bin；多SKU/Lot混放，§§0.2、3.3、4.7。 |
| `DEC-004～007` | Warehouse-level Reservation、pick-time Allocation、FEFO override，§§3.4～3.5、5.5。 |
| `DEC-008～013` | 三種Status、no-negative、Adjustment、無成本／Serial、integer Base UOM，§§0.3、3.2～3.3。 |
| `DEC-014～016` | Atomic Bin Move、two-stage Transfer、no partial，§§3.6、5.4、5.6。 |
| `DEC-017～019` | Persistent Bin lock、pre-Go-Live Opening、無雙人審批，§§3.7、4.16、4.18、6.2。 |
| `DEC-020` | Inventory只接受正式source及internal contracts，§§2.7、5.4、5.11。 |
| `DEC-027` | Production、CI及開發整合測試精確固定MySQL Server 26.7.0；P0先把現有CI的`mysql:8.0`服務改為可重現的26.7.0並驗證DDL、constraint、locking及migration，§§4.1、10.1、14.2。 |
| `DEC-028` | Migration固定為`0054`～`0063`；P0先建立permissions、operations、audit，P1再依序建立master、stock、movements，避免P0 DDL依賴P1 tables，§§4.23、8.5。 |
| `DEC-029` | 採納Item-owned `ItemLookupService` transaction contract `transaction-v1`；`getInventoryProfileInTransaction`及`resolveUomInTransaction`只使用caller transaction，Inventory manifest綁定實作hash且不得複製Item資格規則，§§5.11、8.2。 |

---

## 14. 評審門檻與剩餘上線輸入

### 14.1 已達成的設計門檻

- Capability boundary、依賴順序、single-writer及同步transaction contract已明確。
- 19張核心tables／projections、keys、indexes、FK、immutability及migration切片已定義。
- 頁面、API、internal interface、permission及authentication strength已映射。
- Unit、Integration、Frontend、Security、Concurrency、Performance及Recovery測試均有可執行範圍。
- 所有OBJ、KPI、FR、BR、SEC、NFR、AC及DEC範圍均納入traceability。

### 14.2 已確認、但仍須在對應Phase提供實際輸入的整合／Go-Live約束

1. 本期不實作Serial Tracking；Inventory對Serial SKU過帳fail closed，Go-Live檢查須證明沒有Active inventory-tracked Serial SKU。
2. Receiving低效期例外固定使用`receiving.expiry.override`及§5.4的逐筆evidence；已過期Lot不可Override。
3. Customer Return固定預設進`QUARANTINED`；品質檢查後才可轉為`AVAILABLE`或`DAMAGED`。
4. Adjustment reason category固定為`COUNT_GAIN,COUNT_LOSS,DAMAGE,EXPIRY,DATA_CORRECTION,TRANSFER_VARIANCE,OTHER`，其中`OTHER`須有更詳細說明。
5. P5提供首批Warehouse／Bin master、Opening CSV及實際Data Freeze時間；凍結後舊系統不得再寫庫存。Warehouse／Operations Lead負責對賬，Sam負責不可逆Go-Live最終簽核。
6. Production app DB account與migration account分離，並在Go-Live前完成backup／restore rehearsal。
7. 資料庫相容性基線精確固定為MySQL Server 26.7.0。26.7屬Calendar Versioning的Innovation track；不得因有較新patch而靜默升級。P0須先確認CI可取得並固定26.7.0 runtime，再以同版驗證DDL、constraint、locking及migration。

以上業務決策及MySQL Server 26.7.0基線已由Sam逐項確認，0.4設計及P0～P5計畫亦已重新批准；實際資料、時間及rehearsal evidence仍在相應Phase gate提供。這些約束不應促使開發建立通用設定平台。是否恢復`IMPLEMENT`仍須另行確認。

### 14.3 規格變更控制

下列改變視為需求變更，必須先更新`01_requirement_spec.md`、本文件及測試案例：支援Serial、成本／會計、負庫存、部分Transfer、更多人工Stock Status、Reservation綁定Lot於下單時、自動釋放Reservation、Bin容量／固定SKU、自動通知、多公司、雙人審批或外部分散式Inventory service。

<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal Design Definitions

These definitions index the detailed design above. They preserve its Draft status and unresolved human decisions.

## DES-001 — Warehouse and Bin master boundary

### Decision
Warehouse and Bin are Inventory-owned masters with versioned lifecycle, ownership-safe lookup and shared Warehouse-row serialization.

### Rationale
Keeps location ownership and state transitions explicit while preserving the modular-monolith boundary.

### Failure behavior
Invalid ownership, stale versions or active references fail closed without changing stock.

## DES-002 — Stock, Lot and quantity model

### Decision
Immutable movements are the quantity fact; stock controls and balance buckets are transactional read models using Base-UOM integers.

### Rationale
This preserves auditability and supports Lot, expiry and Stock Status rules without a second inventory store.

### Failure behavior
Any invariant, tracking-policy, expiry, status or ownership violation rolls back the full command.

## DES-003 — Atomic posting, operation identity and audit

### Decision
Every state-changing command uses a durable source identity, canonical payload hash, one MySQL transaction, immutable movement and required audit.

### Rationale
A shared operation claim makes HTTP, internal-service and worker retries converge on one business effect.

### Failure behavior
Conflicting payloads return a stable conflict; indeterminate outcomes are queried by source and never blindly replayed.

## DES-004 — Reservation, allocation and FEFO

### Decision
Reservations are Warehouse/SKU commitments; allocations bind eligible Lot/Bin buckets at pick time under the shared stock-control lock.

### Rationale
Separating commitment from physical selection supports ATP, FEFO and expiry changes without premature Lot binding.

### Failure behavior
Insufficient ATP, stale state, ineligible buckets or unauthorized FEFO deviation fail atomically.

## DES-005 — Bin movement and whole-document transfer

### Decision
Same-Warehouse moves are atomic paired movements; cross-Warehouse transfers use whole-document Draft, Dispatch/In-Transit and Receive states.

### Rationale
This matches the stated no-partial-transfer policy and provides explicit custody and reconciliation.

### Failure behavior
Any invalid line, lock, quantity or destination rejects the whole transition with no partial movement.

## DES-006 — Adjustment, status transfer and reversal

### Decision
Corrections create authorized new movements with reason and audit; posted movements are never edited or deleted.

### Rationale
Compensating entries preserve history and keep Stock Status changes separate from quantity corrections.

### Failure behavior
Commands that would violate quantity, reservation, expiry, permission or idempotency rules fail closed.

## DES-007 — Persistent Stocktake scope and lock

### Decision
Stocktake uses persistent Bin ownership locks, immutable snapshots and one all-or-nothing variance posting.

### Rationale
A business-duration lock lock must survive process restarts and cannot rely on a long database transaction.

### Failure behavior
Concurrent scope claims, non-owner unlocks, incomplete counts or invalid variance lines are rejected without partial posting.

## DES-008 — Fenced Opening and irreversible Go-Live

### Decision
Opening is a pre-Go-Live-only, prechecked, fenced worker flow; Go-Live permanently disables new Opening commands.

### Rationale
This isolates high-volume initial loading from daily corrections while retaining deterministic recovery and audit.

### Failure behavior
Stale prechecks, lost leases, invalid rows or unauthorized confirmation cause zero inventory effect.

## DES-009 — Inquiry, export and operator UI

### Decision
Server-side paginated projections expose stock, movement, reservation, transfer, expiry and audit information; the UI keeps filters in the URL.

### Rationale
Thin clients and stable projections prevent browser-calculated stock facts and unbounded result loading.

### Failure behavior
Unauthorized fields, CSV formulas, unstable ordering and dependency errors are rejected or shown safely.

## DES-010 — Security, reliability and operational controls

### Decision
All boundaries validate input, re-check actor authorization for writes, apply fixed lock ordering, expose safe errors and emit operational reconciliation signals.

### Rationale
Inventory quantity and audit are high-risk shared data requiring least privilege, recoverability and observable failure semantics.

### Failure behavior
Authentication, authorization, concurrency, performance, retention or recovery failures block the affected command or release gate.

# Inventory Management 系統設計規格（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Inventory Management 系統設計規格 |
| 文件版本 | 1.1 Candidate — HD-066 Migration Reallocation |
| 文件日期 | 2026-09-30 |
| 上游文件 | `docs/inventory_management/01_requirement_spec.md` 0.4 Approved Planning Baseline |
| 適用系統 | ERP App；單一公司；中小企業；主要營運規模為5個以內Warehouse |
| 技術基線 | Node.js 26＋Express 5＋MySQL Server 26.7.0＋Vue 3＋Quasar 2 |
| 文件狀態 | HD-066：Sam已選定保留已合併`0055`～`0060`，把未合併Inventory `0061`～`0064`改配`0063`～`0066`；新DESIGN／PLAN hash待批准，P2產品migration尚未改名 |

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
- Migration runner按檔名排序且MySQL DDL會implicit commit。`HD-026`因main已占用Customer `0054`，曾將Inventory配置固定為`0055`～`0064`。`HD-066`因main再占用Supplier `0061`～`0062`，保留已合併的Inventory `0055`～`0060`，只將未合併Inventory `0061`～`0064`改配`0063`～`0066`；產品migration只可在新DESIGN／PLAN hash批准後改名，歷史執行證據保持原檔名記錄。
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

建立`SALE` Reservation時，`D = max(來源要求的minimumRemainingDays, SKU的minimumSaleLifeDays)`；將此實際採用值保存於Reservation快照。來源可以要求更長效期，但不能降低SKU銷售政策。

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

- 每次提交由`ItemLookupService`按SKU ID讀取`skuCode`、`skuName`、`inventoryTracked`、status、Base UOM、tracking policy及minimum life；Movement使用該次讀取的SKU code/name建立不可變snapshot，client snapshot不可信。
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

- HD144 A：DRAFT／COUNTING／READY_TO_POST的scope對其他未完成盤點排他；Draft只佔盤點scope，不建立semantic Bin lock、不阻擋庫存異動。Create／scope replace在Warehouse鎖內current read重驗，移除scope／Draft cancel釋出規劃名額但保留terminal歷史。
- Start transaction先驗證scope，再為所有Bin建立active semantic lock，最後snapshot所有現存bucket；任一失敗不留部分lock。
- 現場發現的新bucket以`snapshot_quantity=0`加入；相同維度在同一Stocktake只能一行。
- HD147 A：本期帳外Bucket只引用既有合法Lot（tracking=none明確NULL），不接受從未登記的新批號；Counting不建立Lot／Balance／Control、不改Lot日期或產生假Receipt。未知Lot以穩定安全錯誤明確拒絕，此限制須在後续API／UI可見。
- READY_TO_POST後count欄位不可再改；需要修正時取消本次並建立新Stocktake，本期不增加reopen流程。
- Posting由`inventory.adjust`＋`jwt-device-password`執行，全部variance在一個transaction完成；失敗保持READY及Bin lock。
- HD152 A：Stocktake正差異是既有實物對帳，既有合法同SKU Lot即使過期／低於minimumReceiptLife仍可記錄正variance IN；不建立Lot、不改Bin／Lot／Status或日期、不借用Receiving override。Sale eligibility、Allocation／Reserved保障及Receipt／正Adjustment硬拒絕維持原規則。精確Ready／Post／Cancel合約見§5.7.2，採用需另行Sam DESIGN／PLAN批准。
- Posted／Cancelled只解除由該Stocktake持有的locks，不可解除其他owner lock。

### 3.7.1 P4/P5 acceptance responsibility — HD170 direction / HD171 candidate

FR094's runtime requirement remains universal: every actual OnHand writer must respect active Stocktake Bin ownership; changing phase evidence cannot exempt a future writer. PHASE005/TASK041 developer closure covers all currently implemented writers, real process restart and atomicity/security, plus its fullscale capacity, export crash/resource recovery and shared-stream warning risk obligations. Opening is not implemented in P4: its genuine locked-Bin writer/API-worker proof is allocated explicitly to PHASE006 TASK044/TASK045 and final TASK051, linked FR094/DES007/TC008. Until actual P5 execution it is NOT_IMPLEMENTED/NOT_RUN, not PASS/N/A/404 proof. P5 still depends on P4 and cannot close without this inherited blocking evidence. Whole-module formal TC/UAT and inventory-technical stay unchanged; P4 phase implementation closure never means full-module acceptance.

TASK041 is sequential but has no new Task IDs. The first test-only safety increment cannot close the Task: precise later capacity/soak, CSV abrupt-process residue/retention/ownership recovery, multi-worker reader resource and existing ServerResponse warning disposition contracts and their current-source proof remain mandatory P4 closure prerequisites. This candidate defines no new TTL/tmp sweep/shared-framework remediation/SLA or production risk waiver. Missing later precise contracts/results keeps TASK041/P4 NOT_READY. First-increment source review is not complete-Task DONE authority.

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
| `minimum_remaining_days` | INT UNSIGNED | NOT NULL／0 | 建立時實際採用的最低剩餘效期快照；`SALE`取來源要求與SKU最低銷售效期的較大值。 |
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

`UNIQUE uq_inventory_stocktake_bin(stocktake_id,bin_id)`；另設candidate key `UNIQUE uq_inventory_stocktake_bin_owner(id,stocktake_id,bin_id)`供Lock及Line composite FK。如此DB可證明`stocktake_bin_id`確實屬同一Stocktake及同一Bin。HD144 A：同Bin最多屬於一張DRAFT／COUNTING／READY_TO_POST Stocktake；Draft create／scope replace在既有Warehouse serialization lock內以current read重驗其他未完成header的scope（排除本張），衝突整筆拒絕。這是scope規劃排他：Draft不建立inventory_bin_locks，也不阻擋Receipt／Issue／Move等庫存異動；scope移除或Draft取消後釋出此規劃名額，terminal歷史保留。下一張active lock唯一鍵只負責Start後的實體盤點鎖排他，不宣稱它單獨保證Draft排他；並發Create／replace必須走相同Warehouse鎖及等待後current validation，不能以未序列化的查詢後插入取代。

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
| `0055` | `seed_inventory_permissions` | P0-T03 | 五項permission seed；可重跑且與catalogue一致。 |
| `0056` | `create_inventory_operations` | P0-T05 | Domain operation requests及source tuple唯一鍵；不依賴Inventory master／stock。 |
| `0057` | `create_inventory_audit` | P0-T05 | Audit及immutable triggers；在第一個business write前完成。 |
| `0058` | `create_inventory_master` | P1-T01 | Warehouses、bins。 |
| `0059` | `create_inventory_stock` | P1-T05 | Lots、stock_controls、stock_balances。 |
| `0060` | `create_inventory_movements` | P1-T05 | Movements及immutable triggers；依賴master與stock。 |
| `0063` | `create_inventory_reservations` | P2-T01／T05 | Reservations、allocations及P2下游契約權限`sales.operation`／`fulfillment.operation`的idempotent seed；不修改已合併的`0055`。 |
| `0064` | `create_inventory_transfers` | P3-T01 | Transfer headers／lines；補Movement optional FKs。 |
| `0065` | `create_inventory_stocktakes` | P4-T01 | Headers／bins／locks／lines；補Movement optional FKs。 |
| `0066` | `create_inventory_opening` | P5-T01 | Control singleton、opening jobs／rows。 |

`HD-007`的`0054`～`0063`配置已被`HD-026`取代，原因是main已存在Customer migration `0054_create_customer_export_jobs.js`；`HD-026`的未合併`0061`～`0064`配置又被`HD-066`取代，原因是main已存在Supplier migrations `0061_create_supplier_import_jobs.js`及`0062_create_supplier_import_rows.js`。已合併Inventory `0055`～`0060`保持不變，歷史可拋棄schema的執行紀錄仍按當時檔名保存，不冒充新配置證據。`0063`～`0066`在寫入前仍須重新檢查最新main及其他已批准配額。若再碰撞，停止並回到設計／計畫重新配置。DDL依賴順序比章節展示順序優先。若optional FK造成cycle，先建nullable欄位與index，待兩端table存在後用後續`ALTER TABLE`補FK；不移除關聯欄位或改用無約束自由文字逃避依賴。

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
| `POST /api/v1/inventory/movements/:id/reverse` | `postingHandlers.js` / `ReverseInventoryMovementHandler` | jwt-device-password／view＋adjust | §5.4.3完整反向原group；reason＋source＋完整current-version guards；重驗現況。 |

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

#### 5.4.1 Bin Move whole-document contract（TASK-030；HD107 A）

HD109 A的最小相容擴充：Bin Move的static api設定inputCoercion=false，在schema驗證階段拒絕數字字串／boolean等非數字輸入，先於HTTP idempotency claim／cached replay及handler。這是選用的route metadata，只允許省略或literal false；省略沿用現有全域RequestValidator設定，true／null／string／object等非法設定須在啟動時拒絕，不能靜默轉型或重新啟用全域已停用的驗證。TASK030只由Bin Move選用；TASK031另由§5.4.2兩條新route選用已有能力。其他既有API的params／query／body轉型、defaults、trim、unknown-field及錯誤格式均保持原有政策。

沿用API definition resolver→dispatcher→RequestValidator.compile流程；compile接受可省略的第三參數{coerceTypes:false}，只於route編譯時建立同配置但不轉型的validator，不修改共用instance或每request重建。保留原global validation.enabled、allErrors、useDefaults、removeAdditional、錯誤detail／上限等設定；不修改shared auth／Idempotency Service、全域request config或新增dependency。六個shared框架／測試精確路徑列於manifest approval_required_paths，使用新PLAN綁定的Sam scope批准；對其他route的相容性及嚴格route在cache前拒絕的順序須有框架回歸及real Bin Move HTTP／MySQL證據。

`POST /api/v1/inventory/bin-moves`使用既有JWT、`inventory.view`＋`inventory.operation`及API idempotency框架；handler從已認證claims建立actor，固定domain purpose=`bin_move.post`／requiredCallerPermission=`inventory.operation`。Domain提交及重送前均沿用fresh authorization，不接受body自報actor／permission。

Request body只接受`{source,warehouseId,reason?,lines}`，沿用既有完整source tuple及安全字串限制；reason可省略，trim後最多500 UTF-8 bytes，不接受control／DEL。`lines`為1～100行；每行只接受`{sourceBalanceId,destinationBinId,quantity,expectedSourceVersion,expectedDestinationVersion}`。IDs／quantity／非null versions均為positive safe integers；quantity明確是來源SKU的Base UOM，不接受Pack轉換或另一UOM。`expectedDestinationVersion`必填：positive version表示預期已有Bucket；explicit `null`表示預期該完整目的Bucket不存在，省略或把null當免檢均拒絕。未知fields及非法shape依既有schema／domain輸入錯誤拒絕。

SKU、Lot、Expiry、Stock Status及Base UOM只從來源Balance、既有Lot及Item-owned inventory profile取得；不可由caller改動。來源及目的Bin必須不同、Active、屬於body同一Active Warehouse；跨倉須用Transfer。重用InventoryPostingService、InventoryOperationService及InventoryLockService，不新增表、權限、外部服務或通用movement framework；handler沿用現有postingHandlers／inventorySchemas及自動發現慣例。

新執行先取得來源維度，按既有Warehouse→Stock Control→Bin／active Bin lock→Lot→完整sorted Balance protocol鎖定並重新驗證來源識別、profile、Lot、所有權及狀態，不把交易前預讀當作提交保證。Expected versions以整份操作開始的locked snapshot為準；同一Bucket重複引用須一致，目的不存在須在Control鎖持有下確認後才建立。不得把自建zero row誤判成原本存在；另一交易先建立即VERSION_CONFLICT，whole rollback包括新zero rows。

同一來源Bucket的所有OUT quantity先合計，safe-integer溢位或超過原`on_hand - allocated`即整份拒絕；不得用本份操作的IN抵充OUT或搬走Allocation。共用目的Bucket亦須檢查累加overflow。每個SKU／Lot／Status在同倉內守恆，Reserved／Allocation總量不變，不得增加uncoveredReserved；既有因自然到期形成的uncovered不是新增「必須先完全覆蓋」門檻，不改Reservation或Expiry eligibility政策。任一來源／目的Counting lock均拒絕。

所有行共用一個`BIN_MOVE_POST` Operation及一個movement group，每行按提交順序產生OUT／IN `BIN_MOVE` legs。完整Bucket versions在寫入前檢查；同Bucket多次leg採交易內依序before／after／version鏈，不重用client version作每個leg的中間版本。FIFO anchor沿用§3.5現有規則；每leg保存既有不可變Movement snapshots及安全source／actor／reason／correlation Audit。Balance、Movement、成功Audit及Operation completion同交易，任一行或任一階段失敗全部回滾。

200沿用既有success envelope，data精確為`{status:"POSTED",operationId,movementGroupId,lineCount}`；不回raw rows／SQL或新增不可持久化的巢狀Operation summary。Movement細節由既有group／source查詢追溯。同source＋正規化payload重送，在fresh authorization後回原immutable scalar結果，不能以當前Balance版本重新計算原結果；不同payload（包括不同lines順序）沿用INVENTORY_SOURCE_CONFLICT。Stale來源／目的版本沿用VERSION_CONFLICT；missing／權限／Bin／stock／安全500錯誤沿用既有公開碼，不洩露內部資料。

#### 5.4.2 Adjustment／Status Transfer exact contract（TASK-031；HD112–122 A）

本增量只實作單次正／負Adjustment及單次Status Transfer，不含batch、Reversal、UI或Stocktake Posting。沿用兩條§5.4 POST route、`jwt-device-password`、`inventory.view`＋`inventory.adjust`，固定domain purpose=`adjustment.post`／`status_transfer.post`及requiredCallerPermission=`inventory.adjust`；caller不能指定actor、permission、proof或isHighRisk。

**Request contract。** Params/query均為EMPTY；body為strict object、additionalProperties=false，兩條route明訂inputCoercion=false，沿用TASK030已有能力而不改RequestValidator。必填共通fields為`source,password,quantity,uomId,reasonText`。source沿用完整五欄tuple及既有安全限制；password沿用現有PASSWORD schema，只作認證，不能trim、正規化為業務資料或持久化。quantity與IDs為positive safe integers，versions為1～4294967295。

| Request variant | 除共通fields外唯一接受的fields | Required guards |
| --- | --- | --- |
| Adjustment IN | `direction:"IN",warehouseId,binId,skuId,stockStatus,lotNumber?,expiryDate?,manufactureDate?,expectedBalanceVersion,reasonCategory` | Complete target；expectedBalanceVersion必填positive version或explicit null expected absent |
| Adjustment OUT | `direction:"OUT",balanceId,expectedBalanceVersion,reasonCategory` | Server從既有Balance派生完整dimensions；expectedBalanceVersion必填positive version，不能null |
| Status Transfer | `sourceBalanceId,destinationStatus,expectedSourceVersion,expectedDestinationVersion` | Source positive version；destination positive version或explicit null；destinationStatus與source不同 |

不接受另一套target selector、caller lotId／firstReceiptDate／trackingPolicy、minimum-life override、quantityUnit alias或混合IN/OUT fields。`uomId`明確宣告quantity單位；Base及Pack均沿用ItemLookupService.resolveUomInTransaction及toBaseQuantity，必須是該SKU當下有效整數factor，無猜測、float或新Item規則。Stock只保存Base UOM整數。Payload hash保留caller inputQuantity/uomId及expected versions，不把當前factor或重新計算的Balance塞入intent；source重送須先通過當下強認證／fresh guard再回原immutable結果，不因後來UOM、Lot或版本改變而重算已完成結果。

Adjustment固定七項reasonCategory allowlist不變，不新增category-direction配對限制。兩種操作reasonText均trim後非空、最多500 UTF-8 bytes且無control／DEL；OTHER另外至少10個非空白Unicode code points。這是長度下限，不是假裝能機械驗證原因真实性；仍須人工可理解的差異及調整說明。不同reason/category是不同payload。Status不接受reasonCategory；其Movement/Audit使用既有空category。

**HTTP preparation / cached replay。** 只供這兩個新handler選用的server-owned static api metadata為`idempotencyPreparation:true`，省略保持所有舊route原行為；false/null/string/object等非法值或缺失hook、未啟用idempotency須啟動失敗。兩route明訂`idempotency:{enabled:true,ttlMs:604800000}`，不更改現有global 1h預設、header/key scope、store、lease、response limits或清理政策。保留既有timeout<lease啟動檢查。

Resolver只傳遞metadata；dispatcher在既有auth→authorization→strict schema後、HTTP claim前呼叫handler.prepareIdempotency(req)。該方法先驗證／正規化全部業務shape和原因，排除password，建立frozen credential-free `{params:{},query:{},body:businessBody}`及Inventory-local trusted context並作fresh preflight。回傳server-owned `{input,replay}`；IdempotencyService.execute新增可省略第五參數接受此物件。選用route缺失／非法準備結果不得fallback回含password的req.input；省略選用的舊route沿用原四參數行為。

Service以prepared input作原有HTTP fingerprint；replay分支將原生cached response發送動作交給`replay(sendCachedResponse)`。Inventory replay hook在一個短交易內重讀／鎖定最新actor/roles/permissions/device/token-version，驗證原signed window及JWT/session時效，再同步呼叫sendCachedResponse，中間不await其他工作；鎖持有到該read-only交易結束。Callback須恰好一次；missing／未呼叫／重複呼叫皆fail closed，不得另跑handler、釋放／覆寫既有成功key或新增Movement／成功Audit。失敗進入既有安全error及failure-audit路徑。既有store conflict/inProgress/unavailable/capacity/fencing及response capture lifecycle保持原樣。

每次HTTP retry仍重新通過原強認證（新nonce／signature及當前password），不能重用nonce。相同actor/method/route/key及相同正規化業務input可回原成功；新password/token/signature/context不能改業務fingerprint；不同source／quantity／uom／target／versions／reason拒絕。Domain source tuple仍是第二道防重，不把header當eventId或另建Inventory快取。全域validation停用不能令新handler跳過自己的strict business normalization或缺失proof guard；不修改global config／認證策略／policy registry／bootstrap。

**Trusted context / submission guard。** 小型Inventory-owned process-local WeakMap機制由已成功fixed strong-auth的Inventory HTTP adapter建立，綁actor、claims、device binding識別、公鑰fingerprint、action、source、正規化payload及原header signed timestamp。Context與serializable五欄command分開傳入；JSON、複製object、錯action／actor／payload／device或跨request重用都不是proof。密碼、token、signature、raw body及context不得進domain/hash/Audit/log/cache response；不新增bearer grant、auth strategy、表或service。只支援本process同步呼叫。

Guard沿用APP_TIME_ZONE/time及現有signatureMaxSkewSeconds（目前60），abs clock skew含future timestamp，不在handler／lock-wait後刷新；同時檢查claims exp/auth_time／sessionMaxAge及當前fr_token_versions，不以可能落後的revocation snapshot代替提交驗證。缺失／偽造context沿用403安全拒絕、stale signature沿用DEVICE_SIGNATURE_STALE，JWT/session/token version沿用原401，actor／permission stale為PERMISSION_STALE，device不合資格沿用deviceStatusError／DEVICE_MISMATCH；未知錯誤安全500/503，不曝光SQL／proof。

開始posting交易、Operation claim前先在該交易重讀actor/permissions/device/version並核对proof／時效；domain replay在可能等待unique claim後必須作current locking guard再回原結果。新posting在全部blocking stock locks／destination creation後、第一筆Movement/Balance業務mutation前，作current `FOR SHARE` guard：順序users→user_roles/roles→role_permissions/permissions（role ID排序）→user_devices→fr_token_versions，使用參數化查詢、JS dedup及既有assertPermissionsCurrent比較。不把先前RR snapshot或claims當最新資格；security表唯讀，無新serialization row或shared-auth SQL改寫。重新核對proof／time須在最後blocking read後；完成Operation前亦核對時效與request abort，逾時回滾包括此前Lot／zero Balance／Operation。

**Actor FK staging（HD122 A；僅兩條TASK031新操作）。** 初始非鎖security檢查後，Operation claim在同一未提交posting transaction暫存`actor_user_id=NULL`，保留原actor_label及opaque context內可信actor ID；不得在stock／destination等待前以非NULL使用者外鍵取得隱含security鎖。Claim的source/hash/unique semantics不變；domain replay不綁定或改寫既有Operation／Lot，在unique等待後仍須current locking guard才回原結果。

Positive Adjustment若確實建立新Lot，其nullable `created_by`也在同一未提交交易暫存NULL，以免0059的使用者外鍵在後续Bucket等待前提前鎖users。僅由本transaction成功INSERT的結果辨識本次新建Lot，不能以缺失snapshot、NULL created_by、時間戳或upsert affectedRows推測ownership；唯一鍵競爭沿既有並發拒絕／whole rollback，不自動重試。既有Lot（包括合法NULL建立者）、其日期與actor attribution不得補填／改寫；Receipt及其他writer維持既有行為，不新增caller控制的deferActor旗標或通用actor-binding API。

全部stock／Lot／Bucket／Item/UOM blocking reads及final current security guard完成後、第一筆Balance／Movement mutation前，以參數化conditional UPDATE將可信actor ID綁到exact claimed、actor尚NULL且completed_at尚NULL的Operation（並限定本次command type）；若本次建立Lot，同時只綁exact owned new Lot的NULL created_by。每個應更新row須affectedRows=1，否則沿用CONCURRENT_OPERATION並回滾；binding後再檢查原proof時效／abort，不刷新憑證。安全read locks持有至同一posting交易結束；binding、stock、Movement、success Audit與Operation completion原子提交，提交成功當下不得留下這兩條操作的NULL-actor Operation或本次新建NULL-creator Lot。任何binding／guard／Audit／completion失敗包括temporary metadata全部回滾，不能另開交易補填或commit後修補。既有FK／ON DELETE SET NULL、schema、users/admin及其他routes不變；不關閉FK checks或改全域isolation。

撤權已在final guard前提交者優先，包含stock／claim／cache等待期間完成的撤權；final guard先取得security read locks者先序列化完成，後來的停用／撤device／role change／token revoke會等待該交易結束，不能追溯取消已提交結果。不得持有preflight交易跨HTTP cache-store或stock等待；posting初始非鎖snapshot檢查不是最終許可。這不是宣稱無deadlock：security read鎖與既有admin寫入仍可能互等，沿用timeout/abort及whole rollback，不自動刷新proof或重送。需實際DB驗證兩種先後次序及stale RR snapshot；不更改全域isolation。

**Stock transaction。** InventoryPostingService仍唯一owner，重用Operation/Audit/Lock/Item helpers。正Adjustment可按SKU＋normalized Lot resolve/create，重用Receipt的既有Lot resolution SQL，不虛構Receipt Movement；同一transaction內新Lot／Balance／ADJUSTMENT Movement／成功Audit／Operation全部提交或回滾。Existing expiry/manufacture incl NULL必須exact match，不填補／改日期。New Lot first_receipt_date使用本次server APP_TIME_ZONE submission date，意義為首次系統Adjustment IN而非historical receipt；caller不能倒填。Negative／Status不建立Lot。

保持Warehouse→Warehouse/SKU Control→Bin/Counting lock→Lot→sorted full Bucket鎖協議、Active warehouse/bin/profile/tracking及ownership規則；目的original presence/version須在Control下current locking read確認，explicit null不得等於免檢，並發先建立者VERSION_CONFLICT。正Adjustment所有Status均拒絕expired及不足current minimumReceiptLifeDays的有expiry Lot，不接受override；none/batch無expiry照既有policy。Profile/UOM及submission local date在blocking locks後重驗，不能用過期的交易前資格。

OUT只能扣onHand-allocated；allocated與Reserved不變。按相同Warehouse/SKU在Control鎖下current read其合資格AVAILABLE Buckets及Lot（非舊aggregate snapshot），計算操作前後uncoveredReserved，不能增加。自然到期已造成的uncovered不是要求全覆蓋的新門檻。Status三種Status六種不同方向均可，paired STATUS_TRANSFER OUT/IN同Warehouse/Bin/SKU/Lot、同Operation/group、總On Hand不變；不搬Allocation或改Lot，不新增expiry blanket ban，expired AVAILABLE仍非saleable。Counting lock、overflow／version overflow或任一leg/Audit失敗全部回滾。FIFO anchor既有positive→positive保留、0→positive當前local date、回0清空；existing Lot date不變。

**Result / audit。** 200沿用success envelope，data固定且additionalProperties=false：`{status:"POSTED",operationId,movementGroupId,lineCount,inputQuantity,inputUom:{id,code},baseQuantity,baseUom:{id,code}}`。Adjustment lineCount=1；Status lineCount=2指legs。只持久化既有Operation scalar allowlist的對應欄位，replay從原summary還原相同data，不新增巢狀summary欄／re-query當前stock。Movement完整不可變snapshots、每Bucket before/after/version、category/reason與source trace保留；細節走既有Movement/group查詢。成功Audit保存既有actor/action/occurred_at及安全`deviceId,signedRequestAt` summary identifiers（只新增這兩個owned allowlist fields），沒有憑證／context；reject/failure可獨立記安全Audit但沒有stock／成功Audit半套。

Stale版本／source衝突／stock及Lot規則沿用既有公開碼與格式；schema400 REQUEST_VALIDATION_FAILED、domain400 INVENTORY_INPUT_INVALID／INVENTORY_QUANTITY_INVALID、現有409 VERSION_CONFLICT／INVENTORY_SOURCE_CONFLICT／INSUFFICIENT_STOCK／INSUFFICIENT_ATP／LOT_*／BIN_LOCKED_BY_STOCKTAKE、404 INVENTORY_RESOURCE_NOT_FOUND。No silent partial success。TASK032 Reversal、TASK033 UI、formal Technical/UAT／full-P3 capacity未被本增量實作或接受。

鎖語意依[MySQL26.7 locking reads](https://dev.mysql.com/doc/refman/26.7/en/innodb-locking-reads.html)及[foreign-key locks](https://dev.mysql.com/doc/refman/26.7/en/innodb-locks-set.html)：current locking reads與FK隱含鎖皆須納入上述順序；這只支持設計推論，不替代已批准26.7.0環境上的實測。MySQL DATE仍是calendar date，owned SQL讀取沿用既有Transfer的DATE_FORMAT pattern以保留YYYY-MM-DD／NULL，不能以全域或fixture-only dateStrings、JS時區切日或弱化日期驗證掩蓋DEF010。

### 5.4.3 TASK032 Generic Reversal精確合約

本節延續§3.8，不提供partial reversal、retarget或Fulfillment Reservation restoration。HD127 A選定current-version方向；以下精確契約須由Sam審閱批准後採用，不能把方向選擇視為未見契約或程式的批准。

**入口與input：** 固定`POST /api/v1/inventory/movements/:id/reverse`，`jwt-device-password`且同時具備`inventory.view`＋`inventory.adjust`；只新增Inventory-owned第三個high-risk consumer。`inputCoercion:false`；query必須empty，params只接受id原始canonical decimal字串`^[1-9][0-9]*$`，再明確檢查正safe integer，不能靠global coercion。body只接受既有source、auth-only password、reasonText及`expectedBalances`；任何額外quantity/uom/direction/status/target/group/reauth-proof欄位均拒絕。reasonText沿用trim後nonempty、最多500 UTF8 bytes、禁止Cc/DEL；不新增reasonCategory或理由allowlist。

`expectedBalances`必填1～200項，每項僅`{balanceId,expectedVersion}`，balanceId為正numeric safe integer，expectedVersion為numeric integer1～4294967295；不接受字串、bool、null、重複balanceId。normalize後按balanceId排序，對應完整原group實際涉及的**當下既存**Balance ID集合，missing/extra guard均拒絕。Movement歷史只有bucket維度及balance_version_after，不能把後者當成current version或暗中替client更新version。缺失歷史bucket fail closed，不upsert重建。新posting持鎖核對current version，stale回409 VERSION_CONFLICT且整組零效果；較舊group在後續事件後仍可反向，只要caller確認最新版本且全部current rules成立。

**可信意圖與雙層冪等：** 固定purpose `movement.reverse`、command `MOVEMENT_REVERSE`，在現有process-opaque trusted context中綁actor/device/public-key claims、route、path movementId、source和credential-free normalized intent；不能冒充Adjustment/Status proof，不能接受serialized/copied context。selected movementId也是意圖的一部分，同group另一anchor不暗中視為同source payload。password只交既有auth；不得進business command/hash/Audit/result/log/cache fingerprint。此route選用既有idempotencyPreparation、7-day TTL604800000；排序後guards集合相同即同意圖。HTTP cache wait及domain unique-claim wait後，均須fresh current security guard及original signature/JWT/auth_time/token-version/deadline/abort檢查，不能renew proof。completed replay回原immutable scalar result，不重新比較已變動的stock/Lot/Item/version，不再次產生stock/Movement/success Audit；payload改變維持既有HTTP/source conflict。現有兩條high-risk routes、ordinary defaults及shared framework/store不改。

**Group完整性與一次性：** id只是原immutable group定位點；server導出全部1～200 legs，確認同group、同original Operation、同allowlisted movement type、BIN location及completed MOVEMENT_GROUP result。原Operation summary須完整且與group一致：Receipt唯一movementId共1 leg；Adjustment lineCount=1；Status lineCount=2；Issue rowCount；Bin Move lineCount×2，並驗證各paired legs相同SKU/Lot/quantity及相應位置/Status守恆。缺資料、混合/損坏/不完整group拒絕，不能用client提供的數量補齊。Transfer、Stocktake、Opening、IN_TRANSIT、REVERSAL及其他type仍409 MOVEMENT_TYPE_NOT_REVERSIBLE；任一leg已有reversal link回409 MOVEMENT_ALREADY_REVERSED。只建立新REVERSAL group，每leg唯一reversal_of_movement_id，原Movement/Operation及terminal workflow不更新。

**交易與鎖序：** 初始非locking discovery只用來選擇scope，之後既有Posting owner的單一transaction按§2.5 claim新Operation（暫時NULL actor）→sorted Warehouse→Warehouse/SKU controls→Bin/counting locks→sorted既存Lot→sorted全Bucket；再對原completed Operation/group及reversal links作current locking read並重驗discovery/guards。不能先锁原Movement再等待stock，也不能用舊RR snapshot決定once-only。使用TASK031已驗證的ordered current security guard（users→roles→permissions→devices→token）於所有blocking business reads後重驗，精確conditional bind本次未完成NULL-actor Operation且affectedRows=1，再重查original proof/abort。此流程不建Lot，不改Lot creator，也不引入public defer flag或generic binder。然後stock、全部新legs、required success Audit及Operation completion原子提交；任何失敗整組rollback，包括placeholder actor/Operation。最終成功actor必須是真實trusted actor。

Warehouse/SKU control與full-bucket locks序列化同group不同source並發；existing unique reversal_of_movement_id是第二層保障，僅精確該constraint duplicate可映射already reversed，不吞其他DB错误。deadlock/lock timeout沿用409 CONCURRENT_OPERATION與whole rollback，不新增自動retry或改FK。MySQL locking reads在等待後讀當下committed rows，不以ordinary snapshot代替。

**反向效果與current invariants：** 不重新套用當下Pack UOM factor，直接逐leg反向原positive Base quantity及原WH/Bin/SKU/Lot/Status；Item Base UOM已按既有contract於交易後禁止變更，current tracked/usable/nonserial profile仍須核對。所有Warehouse/Bin active、Counting exclusion、Lot/tracking identity、safe quantity/version上限仍生效。以original movement id descending作deterministic undo order；先對每Bucket聚合全部OUT，要求不超過其當下free=onHand−allocated，不能用同group預期IN替OUT融資。預先模擬逐legbalance/version chain，overflow或任何中途不變量失敗拒絕。按完整WH/SKU現況及最終效果重驗eligible coverage，不得增加uncovered Reserved；naturally expired既有uncovered不變成全覆蓋新門檻。Reserved/Allocation數量與狀態完全不改，Reverse Issue不復活Consumed workflow。

**本期效期提案（須明確Sam批准）：** Reversal IN是把既有原Lot回到原位置/Status，不是新Receipt或positive Adjustment。因此過期或低於minimum receipt life的原Lot可回原Bucket，但始終按當下日期/Profile計算Sale eligibility，expired AVAILABLE不計入eligible，不能覆蓋需要可售庫存的Reserved；不允許override、新Lot、改Expiry/Manufacture/first_receipt_date或retarget。原Lot dates不變；no-Lot Bucket依既有0→positive設當下local date、positive→positive保留、歸0清NULL的FIFO政策，使用owned SQL DATE_FORMAT，不改global DB date parsing。Receipt／positive Adjustment的expiry/minlife硬拒絕及Status Transfer既有政策不變。若業務要求連歷史回庫都拒絕，須先修訂本節並重審，不能在實作中默默選擇。

**結果／錯誤／Audit：** 成功200回既有scalar shape `{status:"POSTED",operationId,movementGroupId,lineCount}`，lineCount為新反向legs數；不新增Operation summary欄位或查詢endpoint，detail沿用Movement inquiry及reversal links。既有auth/input錯誤不改；non-reversible/already-reversed/current-rule failure使用現有MOVEMENT_TYPE_NOT_REVERSIBLE／MOVEMENT_ALREADY_REVERSED／REVERSAL_NOT_ALLOWED，stale VERSION_CONFLICT及concurrency/source conflicts不混淆。成功使用已存在`movement.reverse` Audit action，可信actor/device/signedAt、source/business references及每leg前後狀態由server提供，required Audit與posting同tx；失敗可用既有安全獨立failure Audit，但不得留下success artifacts或秘密。

**交付限制：** 最小新增owned `inventoryReversalPosting.js`供既有Posting owner使用，handler/schema/context僅增加固定第三consumer；不改shared auth/framework/admin/Item/downstream、Operation/Audit service契約、migration/FK、lock runner/profile/floors或依賴。TASK033 UI、TASK034收斂、formal/UAT及capacity仍獨立，TASK032 developer checks不是這些階段的驗收。

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

#### 5.6.1 Draft SKU精確查找（HD-102 A）

`GET /api/v1/inventory/sku-lookup?code=...` 是Inventory-owned唯讀入口，固定jwt＋`inventory.view`；不要求或授予`item.view`／`item.mgmt`，不接受caller自報權限。沿用框架當下JWT／撤權檢查及既有限流，不新增permission、migration或Item管理入口。目的只為支援既有Draft選料，不建立商品目錄。

- Params為空；query只允許必填單一string `code`（1～190 Unicode code points，拒絕ASCII control／DEL）。未知query、重複code解析為array、非string、超界均400 `REQUEST_VALIDATION_FAILED`。通過schema後重用Item的`normalizeAndValidateSkuCode` trim及驗證，純空白回400 `SKU_CODE_INVALID`。保留大小寫及內部字元；使用Item `findByCode` 的參數化等值查詢與既有DB collation，不另設case-sensitive／uppercase規則。`%`／`_`是literal，不作LIKE；無barcode、模糊、分頁或batch查找。
- 一次`withTransaction`（既有REPEATABLE READ）內，將同一executor交給ItemLookupService作`findByCode(code, {purpose: "inventory"})`及`getInventoryProfileInTransaction(tx, skuId)`；沿用Item-owned profile／Base UOM／可用性，不複製SQL或qualification規則，不修改Item code。兩次查找及UOM讀取必須在同一snapshot，不可把code查找留在交易外。無Balance row仍可查到SKU，不讀庫存作SKU資格門檻。
- 200的既有success envelope中，`data`只含下列required whitelist；`data`及`baseUom`均`additionalProperties: false`。ID為positive safe integer；code/name/UOM code為既有Item string。200表示本次snapshot可供Transfer選料，不是庫存、Reservation或過帳保證，不另回`usable`／raw reasons／Item狀態／價格／media／行政欄位。

```json
{"skuId": 101, "skuCode": "SKU-001", "skuName": "示例商品", "trackingPolicy": "batch", "baseUom": {"uomId": 1, "uomCode": "EA"}}
```

`trackingPolicy`只允許`none`／`batch`／`batch_expiry`。未找到回404 `INVENTORY_RESOURCE_NOT_FOUND`；profile非inventoryTracked回400 `SKU_NOT_INVENTORY_TRACKED`，否則不可用回400 `INVENTORY_INPUT_INVALID`（safe field `skuId`），否則serial回400 `SERIAL_TRACKING_UNSUPPORTED`，與Transfer reference validation相同。不另要求Item active：SKU active且Item discontinued如既有inventory profile允許，仍可選。Base UOM缺失／factor不是1沿用400 `UOM_CONVERSION_INVALID`。認證／權限失敗沿用框架401／403及`PERMISSION_STALE`；未預期失敗沿用框架500 safe error，不回SQL、raw profile或內部錯誤細節。

此GET不建立／修改Item、Lot、Balance、Transfer、Operation、Movement、Idempotency或業務Audit；只保留既有框架request logging。不持久cache查找資格，不新增retry、stock鎖或permission cache。create/update/dispatch仍在自己的交易重驗SKU／Lot／Bin／version及過帳規則；舊查找結果或client傳入skuId不能豁免驗證。Lookup成功後改碼／撤權／停用，不自動以其他SKU替換；失敗保留其他Draft輸入並要求重新查找／選料。

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

### 5.7.1 TASK-037 Count/add/progress internal contract — HD147 A candidate

This precise candidate requires independent Sam DESIGN/PLAN adoption before implementation; it does not activate the §5.7 routes. Existing Draft/Start, route JWT/view+operation and future Ready/Post/Cancel permissions remain unchanged.

**Count save.** InventoryStocktakeService.saveCounts and saveCountsInTransaction use the established trusted context, fixed purpose stocktake.count/inventory.operation and domain source. Payload only {stocktakeId,lines}; 1–100 unique lineIds, sorted canonical intent/lock order. Each line is {lineId,expectedVersion,countedQuantity:q} with safe integer q>=0, OR {lineId,expectedVersion,notFound:true}, never both. NULL/blank/string/negative/fraction/unsafe q, false marker, duplicates/unknown fields/client snapshots or variance reject. UncountedNULL is initial state, not a new clear action. Numeric save sets counted_quantity=q/is_not_found=0; explicit notFound sets counted_quantity=NULL/is_not_found=1 (actual0); either may replace the other with current lineversion whileCOUNTING. variance remainsNULL until Ready.

Current headerCOUNTING, line/scope/Bin ownership, active Ware/Bin and own semantic lock are rechecked after waits. Follow operation→Warehouse→applicable business locks→workflow root→children; lock childIDs ascending and do not use stale discovery or initialize absent stock rows. Validate all line versions/uint32 ceilings before effects; batch updates, count actor/time, bounded Audit and completed Operation commit or rollback together. Increment only each changed line.version once; update header updated_at/updated_by without incrementing workflow header.version or changingstatus. Different-line saves may both succeed; a stale selected line rejects the whole batch. No OnHand/Balance/Control/Lot/Allocation/Reservation/Movement/lock-release effect. Fresh authorization rechecked before writes/replay; original replay does not re-read/recount later state.

HD149 A: immutable scalar Count receipt exactly {id:stocktakeId,operationId,status:"COUNTING",version:workflowVersion,rowCount}. No lines array/count results are returned or persisted. Original replay never rereads changed lines; current values/versions are obtained separately from paginated progress and cannot be passed off as the old result. Complete using existing resultType STOCKTAKE/resultId String(stocktakeId), scalar whitelist and8192byte limit. Existing source conflict semantics and no automatic unknown-outcome retry remain. Write one stocktake.count Audit per selected line in the same transaction, targetType stocktake/targetId parent/targetLabel stocktakeNumber and shared operationRequestId. Before/after summaries exactly {id:lineId,stocktakeId,quantity:effectiveActual,version:lineVersion,status:progressState}; UNCOUNTED has quantityNULL, COUNTED has numeric q including0, NOT_FOUND has quantity0. Status preserves0-vs-notFound, IDs/versions preserve the exact line history; actor/time/source attribution stays existing Audit input, no nested summaries/credentials or shared parser change. A100line batch yields100 bounded scalar Audit rows or entirely rolls back; successful replay writes no further Audit. Capacity remains a later measured gate, not assumed from small fixtures.

**Field-discovered add / actual HD147 A.** addLine/addLineInTransaction use purpose stocktake.add_line/inventory.operation; payload only {stocktakeId,binId,skuId,lotId,stockStatus}, required explicitlotId. Current Item-owned profile must be usable/inventoryTracked with valid BaseUOM, nonserial; none requiresNULL, batch/batch_expiry require an existing same-SKU Lot and batch_expiry storedexpiry. The three existing Statuses are accepted. Existing expired/low-life Lots can be physically counted; this does not grant sales/Receipt eligibility or eventual Posting approval. Count of an existing snapshot does not require the SKU still be sellable; no Item mutation is allowed.

Validate current COUNTING scope/activeWareBin and exact own active lock; current Item validation after waits uses Item's transaction method, no copied rules. Lock existing Lot/full-dimension Balance before root/child, never create absent Balance/Control. Duplicate dimension rejects STOCKTAKE_STATE_CONFLICT with safe rule; an unexpected existing Balance missing from immutable snapshot rejects STOCKTAKE_SNAPSHOT_MISMATCH. Real0065 dimension/composite ownership constraints remain the final concurrency guard. New line snapshot_quantity=0/snapshot_balance_version=0/stock_balance_id=NULL/counted_quantity=NULL/is_not_found=0/variance=NULL/version1; count via later explicitsave, not implicitadd. HD149 A Add scalar receipt exactly {id:newLineId,stocktakeId:parentId,operationId,status:"COUNTING",version:1,rowCount:1}; id/version name the new line, stocktakeId names the parent, and header workflowversion is read separately. Persist as existing resultType STOCKTAKE/resultId String(parentId), so operation resultId remains the parent navigation reference and the scalar summary identifies the line. One stocktake.add_line Audit targets the parent; beforeSummaryNULL, afterSummary exactly {id:newLineId,stocktakeId,quantity:NULL,version:1,status:"UNCOUNTED",binId,skuId,lotId,stockStatus}. Original replay returns unchanged scalar fields with no line/Audit insertion or current-query reconstruction. No line object, new result tag, whitelist, size-limit or shared serializer change. No Lot identity/date write, stock effect, fake IN or foreign unlock. Unknown Lot returns existing INVENTORY_RESOURCE_NOT_FOUND with safe lotId/REGISTERED_LOT_REQUIRED detail; raw lotNumber/expiry/manufacture/firstReceiptDate/tracking/snapshot overrides reject. TASK039/040 must expose the known-Lot-only limitation, not hide or bypass it.

**Internal progress inquiry.** Add InventoryInquiryService.listStocktakeCountLines({stocktakeId,page=1,pageSize=20,progress="ALL"}); existing pagination validation/bounds page>=1/pageSize1–100/safeoffset, fixed idASC order and whitelisted SQL. ALL/UNCOUNTED/COUNTED/NOT_FOUND; numericcount, explicitnotFound and uncounted are disjoint. One owned consistent read transaction reads header, SQLaggregate progress and LIMIT/OFFSET rows; no eager complete line load or Operation/Audit/business writes. Return {id,status,version,items,total,page,pageSize,summary:{totalLines,countedLines,notFoundLines,uncountedLines}}; items carry stored dimensions/snapshot/count/marker/version and effectiveactual=NULL/q/0, not Ready variance calculation. Missing header not-found; empty/beyond-end page items[] with truthful totals. This retains the established internal Inquiry trust boundary, not an authenticated entry point or caller-reported permission API; the future TASK039 handler must freshly enforce inventory.view before routing. No actual HTTP/JWT/UI/export proof is claimed here.

See TASK037's exact developer contract/cases in 05_development_tasks.md. Existing0065 and earlier migrations are not changed. Ready/Post/startedCancel, fullP4 writer/restart/capacity/HTTP/browser gates remain later work.

### 5.7.2 TASK-038 Ready/Post/Cancel internal contract — HD152 A candidate

This proposal is not adopted until actual independent Sam approval of exact DESIGN/PLAN and scope. It does not activate HTTP/UI. TASK038's exact contract/cases in05_development_tasks.md define24unit/34realDB DEVELOPER tests; all NOT_RUN. Existing0065/Item/auth/framework/Posting/Adjustment/Reversal/Reservation/Lock services and counted/inquiry tests remain unchanged; no shared generic guard bypass.

**Entry points/intent.** Add StocktakeService.ready/post/cancel and caller-owned transaction variants. Ready payload only{stocktakeId,expectedVersion}; Post/Cancel additionally require safe nonblank reason(max500UTF8bytes). IDs/version positive safe integers, expectedVersion<=uint32; no client quantity/snapshot/variance/status/actor/permission/password/proof/device overrides. Existing source uniqueness and altered intent conflict, atomic Operation/Audit and unknown-outcome source lookup apply. Ready/Cancel fixed inventory.operation; Post fixed inventory.adjust, no operation-role substitute.

**Ready.** COUNTING/current expected workflowversion, active scope/Bins and exact own active locks. After Warehouse/business waits current-read header/scope/all lines and fresh actor. Each line numeric>=0 or explicitnotFound(null+flag1), never untouchednull+flag0/corrupt form. Empty complete scope allowed, explicit Ready still required. Freeze latest committed current counts, not a client display list; safely store signedactual-snapshot variance, linecount/snapshot/lineversions unchanged, header+1 with ready metadata/operation. Scalar header Audit plus parent completed Operation, no stock effects/unlock. No reopen or subsequent Count/Add.

**Cancel authentication.** New inventoryStocktakeCancelContext.js issues/consumes a one-use opaque WeakMap capsule from trusted already-verified jwt-password POST /api/v1/inventory/stocktakes/:id/cancel metadata, canonical path/body id, actor/claims and normalized source/action/payload/correlation intent. Current view+operation, user/roles, token version, JWT expiry/session age/time and abort rechecked after business waits/replay; no device required and no caller boolean/raw password/claims accepted as proof. Existing session/clock policy reused, no auth framework change. DRAFT/COUNTING/READY only,current version,mandatory reason. Started states require exact active lock per owned scope; retain all history and release only exact owned rows; any missing/released/foreign/composite mismatch rejects with no foreign effect. Inactive Ware/Bin cannot strand valid own Cancel. No Movement/stock/Allocation/Reservation mutation. Header+1,cancel metadata/reason/operation,scalarAudit/result atomically. Existing cancelDraft remains trusted-domain DRAFT-only compatibility; future HTTP Cancel must use the sealed method.

**Post authentication.** Extend existing inventoryHighRiskContext.js only with stocktake.post→/api/v1/inventory/stocktakes/:id/post→STOCKTAKE_POST, exact canonical id binding. All old actions unchanged. It still requires jwt-device-password/view+adjust, approved exact actor/device/key, signed-request time, current JWT version/expiry/session/roles/permission and signal checks. Forged/mismatched/reused proof or stale post/replay rejects before effects. New action claims defer nullable actor FK until post-wait current checks, preserving Audit/header actor attribution without early user FK preventing revocation; old command claims unchanged. No new global auth defaults or secret persistence. Trusted fixture capsules do not prove actual HTTP password/signature middleware; later TASK039/040 gates remain mandatory.

**Atomic Post/integrity.** READY_TO_POST/current workflowversion and complete frozen owned lines, active Warehouse/Bins, all exact own locks. Lock operation→Warehouse→changed-SKU Control→scopeBins/locks→knownLots→full-dimension Balances→Stocktake root/children, validate current state after waits. Current coverage reads reuse established Warehouse/Control serialization, not stale RR SUM. Count/flag/variance/ownership must be consistent. Existing snapshot Balance identity/dimension/quantity/version match; mismatch is integrity SNAPSHOT_MISMATCH, not stale client optimistic retry. Writes use current locked version, preserve snapshot history. Added snapshot0/nullbalance requires still-absent dimension; zero variance never initializes Balance/Control. Current Item-owned usable/tracked/nonserial/BaseUOM/Tracking and existing sameSKU Lot/requiredstoredexpiry/date-order validation; no copied master rules or newLot.

**HD152 A physical IN.** For positivevariance, existing legal expired/belowminimumReceiptLife Lot can be reconciled at original Bin/Lot/Status, dates unchanged. Not a Receipt/positiveAdjustment/Receiving override; their policy unchanged. Expired AVAILABLE stays ineligible and low-life sale eligibility retains current sale-purpose cutoff; negative/zero gains no blanket expiry ban. Each Bucket finalactual>=currentallocated; no Allocation/Reserved mutation. Current Warehouse/SKU uncoveredReserved cannot increase after the complete final variance effect; natural-expiry existinguncovered is not a new full-coverage gate. Same-Stocktake eligible gain may offset aggregate coverage loss in another Bucket, never a perBucket allocated shortage. This is proposed final-state atomic validation, not independent per-row Adjustment. Date crossing rejects CONCURRENT_OPERATION, no mixed-date evaluation/new-event retry.

**Persistence/results.** One parent Operation and one shared group for all nonzero lines. Each nonzero variance creates positiveBasequantity STOCKTAKE_VARIANCE IN/OUT Movement with parent/lineFK,current snapshots,before/after/version; changes corresponding Balance/FIFO/version and line movement_id/version+1 only. Zero lines unchanged/noMovement,nozeroBalance/control creation. NoneLot FIFO positive→positive preserve,0→positive serverlocaldate,→0 NULL; Lot dates unchanged. One scalar per nonzero line Audit{id:lineId,stocktakeId,quantity:before|actual,version:balanceVersion,status:stockStatus,movementId:null|newId}, plus scalar workflowheaderAudit; existing whitelist/8192 unchanged. Only after all effects/Audits, setPOSTED/header+1/metadata, release exact own active locks and complete Operation, in one commit. Any later-row/Movement/link/Audit/header/release/complete/commit failure leaves originalREADY+locks and no newly created stockrows. No partialPost/reopen/foreignunlock.

Scalar Ready{id,operationId,status:READY_TO_POST,version,rowCount:totalLines}; Post{id,operationId,status:POSTED,version,rowCount:nonzeroLines,movementGroupId:UUID|null}; Cancel{id,operationId,status:CANCELLED,version,rowCount:scopeBins}. All resultType STOCKTAKE/resultId parent. All-zero Post still requires strongproof, records parentAudit/Operation and releases exact own locks,groupNULL/rowCount0. Fresh applicable capsule/currentauth needed to replay originalscalar; no current row reconstruction/Audit/Movement/unlock repeat. Terminal newevent/wrongversion/state conflicts, alteredsourceintent conflicts. Old Count/Add replay unchanged.

### 5.7.3 TASK-039 public Stocktake/query/CSV contract — HD155 A / HD156 candidate

PROPOSED_NOT_APPLIED until actual independent Sam approves exact DESIGN/PLAN/scope. Existing §5.7 twelve routes and §5.7.1–2 domain contracts remain. The complete explicit public payloads, stage-specific read projections, paginated scope, export columns/limits, authentication/cache guards, 12 source/test paths and 78 DEVELOPER NOT_RUN cases are the TASK-039 exact proposal in05_development_tasks.md; they are normative together after adoption, not a claim of implemented behavior.

HD155 A: COUNTING derives marked PREVIEW actual−snapshot from one consistent read snapshot; uncounted actual/variance=NULL, notFound actual0. READY_TO_POST/POSTED use validated persisted FROZEN variance. CANCELLED preserves ready→FROZEN/started→PREVIEW/otherwiseNOT_STARTED with cancelled:true and never claims posted. Snapshot/header/row versions and asOf identify stale previews; no preview persistence, stock mutation or Post authority. Same semantics for global/filtered line-count summaries, gain/loss/zero filters and CSV; do not sum quantities across different SKU/Base UOMs. Public reads use current JWT/view checks separate from the data snapshot.

Use existing auth/password/device middleware and scalar domain receipts. All eight POSTs opt into existing credential-free preparation/current cached-replay hook with7-dayTTL; fixed permissions and strong auth of §5.7 remain. Only additive non-consuming CancelContext check is proposed, no generic auth/framework/cache/serializer/Operation/Audit change. Count/Add keep per-line version semantics; no wizard/reopen/unknownLot/newpermission.

GET detail pages scopes, lines pages counts; fixed SQL whitelists/bounds/ownership and same-snapshot metadata. Original internal listStocktakeCountLines and all other inquiry contracts unchanged. Current display refs explicitly labelled current, binCodeSnapshot remains historic.

Stocktake CSV uses installed quoting and existing Item-owned text formula neutralization, complete SCOPE/filteredLINE/finalSUMMARY records with exact stable columns inTASK039 plan. Keyset batches<=500, one RR data snapshot, current authorization guards outside stale snapshot, existing max100000 data rows/120000ms generation defaults unchanged. Incremental request-owned0600 tempfile generation then existing file-stream response permits truthful cap/time headers/footer without unbounded memory or holding a read snapshot for a slow client. Route-only120000ms deadline (never raise shared receive timeout): generation budget is min(config.exportTimeoutMs, floor(current remaining route deadline/2)), at most60000ms under defaults and lower after authentication/wait; preserve remaining time for delivery. Actual generationBudgetMs is exposed in a response header and SUMMARY; TIME_LIMIT means this effective budget, not a promise of120s generation, private/no-store, no reusable download URL/job/cache, current auth checked per delivery chunk, exact own cleanup on all normal/error/abort paths. HD158 A candidate — bounded independent generation reader: one non-queued active Stocktake CSV generation slot per primary MySqlDatabaseService identity per application process. Acquire only after trusted initial authorization; when busy return existing INVENTORY_DEPENDENCY_UNAVAILABLE503, no hidden wait/job/cache and no file or auxiliary pool creation. The active generation owns a temporary one-connection MySqlDatabaseService pool made by existing connection factory using the same normalized primary database endpoint/schema/user/credentials/TLS/session options; connectionLimit/queueLimit are fixed1 for this owned reader and a module-local owned-transport close observer is required. No broader database grant/new credential/global config/source change. RR data snapshot uses this reader only; short current authorization and Audit use primary database, never its stale RR snapshot. Maximum one additional client SQL connection per process/database-service identity during generation (deployment worker count multiplies that bound), not one extra per concurrent request; primary connectionLimit1 remains usable. Close/abort auxiliary transaction, shutdown owned pool and release slot before delivery; all acquisition/SQL/error/abort/init/shutdown paths are accounted, fail closed on teardown failure and do not release for replacement while previous owned reader remains live. Explicit terminal ownership condition: MySqlDatabaseService.shutdown()/mysql2 pool.end() promise alone is not sufficient because installed Quit invokes its callback before writing COM_QUIT/socket closure. The Stocktake-owned reader must observe each newly created client transport from creation before connect/handshake, using a module-local mysql2 supported stream-factory observer and Node Unix/TCP socket lifecycle, preserving transport/TLS verification/keepalive/session behavior; no shared primary socket, private pool-array inspection, framework patch or global configuration change. Only connectionLimit/queueLimit plus this transport lifecycle observer differ in the owned reader configuration. Gate release/delivery requires all observed client sockets to emit terminal close (including failed handshake/acquisition, transaction abort and rejected shutdown), not merely end/destroy-called/service.closed. No second owned client may start while an earlier observed transport has not closed; no reconnect/retry before that terminal condition. On teardown error/unknown close, fail closed, retain the occupied slot until eventual confirmed close; if never confirmed, that process export path remains503 and needs controlled process recovery, not a silent release. D11/D17 must inject delayed close and rejected shutdown/handshake, assert no replacement/delivery before close, eventual slot recovery and zero owned client sockets on completed paths. Request failure may return promptly; owned cleanup must still settle/account pending writes and transport closure after request termination if necessary, without continued dataset work or new request deadline. This is not a hard realtime OS/server-transaction termination guarantee. Full process/restart recovery and deployment worker connection budget remain TASK041 obligations. No auxiliary connection during streaming; chunks still current-check primary authority. Busy503 is a disclosed throughput tradeoff, not a blanket availability guarantee under ordinary primary DB overload. Fullscale/cross-worker/restart/retention verification stays TASK041. HD158 A candidate — explicit work-cutoff semantics: keep original route120000ms, shared defaults and generationBudgetMs=min(config.exportTimeoutMs,floor(original remaining route deadline/2)); start budget after initial authorization without refreshing the original deadline. An owned timer/signal plus after-await time checks covers auxiliary reader acquisition, snapshot metadata/summaries/keysets, batch current-auth and temporary-file data writes, including empty/full results. At a safe complete-batch boundary before starting further data work, if metadata and a confirmed complete prefix exist, deliberate stop may finalize TIME_LIMIT SUMMARY using the remaining original request time. If the cutoff occurs during an in-flight wait/query/auth/data write, or metadata is unavailable, abort/fail closed using existing RequestTimeoutError REQUEST_TIMEOUT504; do not salvage/reclassify a failed query or partially written file as a successful truncated CSV. Genuine DB/query/disk/Audit errors and request disconnect/abort retain failure, not TIME_LIMIT. No late NONE/untruncated result accepted; distinguish a causally owned generation abort from a competing genuine/request failure. After work cutoff only prefix footer/transaction and pool teardown/final authorization/Audit/delivery may use original remaining route time, never a new deadline or further data reads. Failure cleanup alone may settle/account owned resources after request termination; no generation continuation or success after the original request abort. Thus generationBudgetMs is the cutoff for starting/accepting dataset work, not a hard real-time guarantee that OS writes/server queries/cleanup finish instantly; cancellation is best-effort and in-flight file writes must settle before closing/removing owned files. No partial data stream on failure. Audit failure before response remains closed. This choice can return504 rather than partialCSV for a slow successful query; preserving partial output from interrupted operations would require a separate prefix recovery design, not silently implemented here. Stocktake data-row cap is min(config.exportMaxRows,100000), SCOPE+LINE together, excluding SUMMARY; higher global env override cannot raise this module ceiling.

**HD160 A / HD161 candidate — temporary reader ownership.** Only the Stocktake Export module creates one private existing ServiceContainer per admitted generation; this is not an application/global registration or a reusable shared factory. Register the existing MySqlDatabaseService definition using its actual static name/lifecycle/dependencies/ServiceClass and resolve it through the existing container path; never directly construct that public service, alias/reflect a constructor, fake successful initialization, or weaken serviceContainer.test.js. The container owns only this MySQL service. Borrow the primary logger via a non-owning logging dependency value and the primary RequestContext through a non-owning get/update dependency value; these values are not owned definitions, recreated services or shutdown targets. The context value returns the original request fields/deadline with only signal overlaid by the combined original-request/generation workSignal, delegates update to the existing context, and never mutates the primary request signal/deadline. This minimal overlay is required so the existing initialize/healthCheck SELECT1 receives the generation cancellation as well as request abort; primary current authorization/Audit keep their original context. Use config.database copied from normalized primary config with only approved connectionLimit1/queueLimit1/owned stream observer, and the existing createMySqlDatabasePool through the existing options.poolFactory seam. Endpoint/schema/user/SecretValue/TLS/session and primary pool remain unchanged; no private driver arrays or new dependency/config/environment knob.

Publish the private owner handle and attach its workSignal listener before starting asynchronous container resolve. Pre-aborted signals and a closed owner cannot begin initialization, factory/connection creation or data work. Start/retain exactly one initialization promise, await it through the existing work-budget check, and require actual MySQL initialize plus successful healthCheck before RR data access. The original generation budget includes container dependency resolution, pool creation, logging/health check/handshake and acquisition; no fresh deadline/extra initialization allowance. Abort/close first marks the owner closing synchronously (factory/stream observer forbids all later pool/transport creation), destroys only already observed owned transports, and consumes late initialization resolution/rejection. Generic singleton container.shutdown does not await in-flight initialization: the module must await the owned initialization settlement before invoking/awaiting container.shutdown, and still await every pre-handshake observed socket terminal close. A delayed initializer may not publish a usable reader after abort, perform late dataset work, or escape cleanup. Close is one idempotent owner promise; remove its signal listener when cleanup settles, never shutdown caller-owned logging/context/primary pool. Failed initialization retains the original error; causal owned timeout retains REQUEST_TIMEOUT504, original request abort and independent DB/health/logging errors are not relabelled TIME_LIMIT. Container shutdown reports failures instead of necessarily throwing: inspect its report and fail delivery on any teardown failure. Do not equate report.closed, pool.end, service.closed or destroy-called with transport closure.

Successful delivery requires completed generation, settled initialization, successful owned container teardown and all owned terminal sockets closed, followed by unchanged final current auth/Audit. Slot release requires no possible late initializer/resource creation and confirmed closure of every owned client; on teardown error with those terminal conditions proven the failed request may release for a fresh owner, never reuse the failed instance. If initialization/teardown/closure remains unknown, fail/no CSV and retain busy503 until eventual owned settlement/confirmed closure or controlled process recovery; request failure can finish before asynchronous cleanup, but no further data work/deadline renewal or false success is allowed. All late promises/errors must be consumed/accounted; no unhandled rejection or silent cleanup failure. This is best-effort cancellation, not instant OS/MySQL termination or full TASK041 restart proof. HD158 one additional client/nonqueued slot/primary pool1/current auth/strict cap/budget, HD159 exact evidence recovery and zero-prefetch per-chunk guard remain unchanged.

Existing inventory.export scalar audit stores filterhash/count/cap metadata without rawdata/secret or new whitelist. Success means generated/authorized, never certified client delivery. Crash orphan/recovery and fullscale capacity remain explicit TASK041 obligations before fullP4 closure; not deployment approval. This bounded disk/cleanup tradeoff is part of HD156 review, not silently applied.

Actual HTTP cryptographic password/JWT/device/replay/wait tests and real Playwright client/browser plus named CLI checks are mandatory DEVELOPER scope. Old service tests alone do not prove them; absent tool/runtime meansBLOCKED. UI wizard remainsTASK040, globalwriter/restart/capacity remainsTASK041, formalTC/UAT/fiveCI/finalhumanhead/freshmain/MERGE_READY and phase-PR cadence unchanged.

### 5.7.4 TASK041 anonymous-before-data CSV — HD174 A / HD175 candidate

本節精確取代§5.7.3的「生成與傳送期間保留有名暫存CSV」生命週期；仍先在private0700目錄wx+／0600開檔，但所有CSV bytes前移除名稱並驗證。§5.7.3的成功API／CSV／Audit格式、reader容器所有權與socket確認、主要pool1、generation slot、budget／row上限、撤權及零預讀全保留；不改其他匯出或共享框架。

#### 匿名檔案的安全合約

1. 仍在realpath(os.tmpdir())下建立request-owned0700目錄及wx+／0600檔案，立即記錄成功取得的handle及identity；只接受可取得可信numeric effective UID、regular file／directory、相同owner、精確0700／0600 permission bits、原file size=0／nlink=1的受信任本機環境。這不是單靠OS名稱的支援宣告；必須觀察實際runtime／FS語義。
2. **任何CSV header／row／footer bytes之前**，核對當前目錄、檔案entry及同一open descriptor的dev／ino／type／owner／permissions／empty／link條件；只unlink該次已核對的檔名。再對原descriptor核對相同dev／ino／regular／owner／permissions、size=0、nlink=0，並以lstat確認原pathname ENOENT。再次確認own-directory identity，只rmdir自己的空目錄，確認其pathname已不存在。全部成功且原signal／budget仍有效後，才用原handle寫入。
3. 生成、傳送都只使用原handle，不重開路徑、不複製到有名檔、不整份載入memory、不依賴GC。明確追蹤本次成功unlink／rmdir狀態；正常EOF、error、abort、destroy-before-first-next以及準備途中失敗均等待自己的已開始I/O完成後close一次。除非有成功操作紀錄及identity，不將任意ENOENT視為ownership證明。清理只處理原own inode／emptydir，不遞迴、不刪replacement／foreign entry；未知cleanup保留原錯誤與最小診斷，不宣稱乾淨。
4. 本合約信任OS帳戶與private目錄；pathname檢查不是對惡意同UID／root或遭竄改filesystem的原子防禦。unlink後的handle仍保留資料至關閉；不是安全抹除、保證立即回收disk、無FD／disk成本或防止host forensic。正式部署OS／filesystem尚未確認；未經目標環境驗證不得宣稱可用。Windows／NFS／SMB／FUSE不預設支援；缺少numeric effective UID或上述能力時CSV fail closed，其他Inventory功能不受影響。
5. semantic ownership／identity／mode／empty／link不符，以及新unlink／rmdir步驟的EPERM、EACCES、EBUSY、ENOSYS、ENOTSUP、EOPNOTSUPP、ENOTEMPTY、EEXIST或非預期ENOENT，回既有 `INVENTORY_DEPENDENCY_UNAVAILABLE`／503，無CSV response bytes；錯誤不暴露path／SQL／資料。只有預期的post-unlink／post-rmdir lstat ENOENT是成功。真正EIO／ENOSPC／EDQUOT、既有取得資源chmod／lstat／stat失敗保留原始error／既有安全500語義，不偽裝成完整／截斷成功；原request abort、401／403、generation504政策不變。失敗Audit仍由主要DB持久化；Audit本身失敗保留失敗，不承諾不存在的記錄。
6. unlink／rmdir／metadata工作計入既有生成budget；耗盡時不交付CSV，原timer／等待中abort及reader所有權規則不改。I/O無法瞬停時等待其settle再close；不在error後另起寫入。相容性失敗不回退named plaintext、memory或另一tmp root。成功路徑在首次data write前兩個pathname都消失；descriptor後續size成長時nlink仍0。

#### 崩潰、資源與安全清理邊界

child以真正OS abrupt termination驗證，不以正常finally代表crash。父程序只在收到實際syscall完成的checkpoint後終止自己啟動的精確PID/process group，等待正面exit事件；再查已記錄的primary／reader connection ID及INNODB_TRX是否消失。SQL可能仍在server等待：先證明child退出，再釋放本測試父程序持有的metadata／row阻擋鎖，才等待SQL清理，不能將等待中的連線誤稱已回收。替代worker可重新授權建立全新CSV，沒有持久job／resume，舊下載永不復活。

崩潰點涵蓋empty-open、unlink後但rmdir前、匿名且未寫入、已寫header／batch／summary、SQL等待、HTTP傳送中。前兩者最多留下本次own空file／emptydir；有資料時兩個pathname已不存在，父程序對自己的隔離scratch root作完整目錄inventory，核對沒有linked nonempty CSV。沒有把logger/checkpoint宣告當成OS／SQL terminal證據，沒有以回傳503代替無額外連線斷言。

不授權任何worker掃除別人的目錄。每個test worker使用父程序實際保留的獨立TMPDIR/private scratch root；清理核對parent登記的root／inode及child positive exit，僅逐項刪除可證明屬本次的空檔／空目錄，foreign sentinel與其他worker始終保留。未知ownership或nonempty residue立即FAIL、保留最小證據且停止刪除；不得以prefix／PID不存在／mtime作刪除權限。觀察只記path identity／mode／link／size／count／hash、HTTP status及SQL IDs，不保存CSV原文、JWT、密碼、key或簽章。

**尚未解除的P4 gate：** 這段僅量測功能案例的FD／socket／SQL／owned pathname回到已觀察baseline；不替完整容量／soak定新SLA。反覆在unlink前crash仍可累積空metadata，沒有production trusted ownership journal／清理授權；正式運維的磁碟／FD／emptymetadata監測、告警、受控處理runbook與容量／soak門檻仍需後續精確合約及人類處置，不能接受本段就視為豁免。既存shared ServerResponse listener warning風險亦保持blocking。完成本段後TASK041仍IN_PROGRESS。


完整30個開發風險案例、精確四個來源／測試路徑與兩組新命令在TASK041第二增量；案例目前NOT_RUN，不是正式TC/UAT。其他41個累積檔與guards禁止修改；完成本增量仍保持TASK041 IN_PROGRESS，後續容量／soak、運維emptymetadata與shared warning門檻不得省略。

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
| 400 | `INVENTORY_INPUT_INVALID`、`INVENTORY_QUANTITY_INVALID` | schema、負數／小數／超限；0只在要求正數的命令拒絕，Stocktake count 0有效。 |
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
- Sales Reservation create／release／cancel固定驗`sales.operation`；Fulfillment Allocation（含release／reallocate）、candidates及Issue固定驗`fulfillment.operation`。這兩項為下游業務權限，不授予`inventory.view`、`inventory.operation`或Inventory管理頁。直接Inventory HTTP route仍按§§5.4～5.5要求`inventory.view`＋`inventory.operation`，與internal provider入口分開。
- Receiving低效期例外固定映射`receiving.expiry.override`並驗證逐筆evidence；Customer Return Receipt固定預設`QUARANTINED`，品質檢查完成後才可另走Status Transfer轉為`AVAILABLE`或`DAMAGED`。
- Service要求已傳入transaction；若沒有則立即拋TypeError，避免上下游以為共用transaction但Inventory偷偷另開transaction。
- Inventory在提交點重讀actor、SKU及位置狀態。若必要依賴不可用，整個來源transaction rollback。
- Query contract可用database service非transaction執行；任何數量寫入只能走command contract。
- Fulfillment batch allocation由Inventory計算完整推薦序列及`FEFO／FIFO`偏離類型；caller不可自報`selectionStrategy`以降低權限。
- Fulfillment HD018 A (actual Sam approval,2026-10-23) adds explicit read-only `InventoryLookupService.listFulfillmentBatchAllocationCandidates(tx,{warehouseId,asOf,demands})` while preserving the original independent `listAllocationCandidates` ABI/behavior. Demands bind real persisted Fulfillment Line/Claim/Reservation/SKU IDs, requestedQuantity and page; Inventory derives current Reservation minimum remaining days and follows actual writer Line-ID/Reservation-ID order. A transaction-local shared Balance budget accounts for all preceding members and prefix pages, including different eligibility sets; exhausted buckets disappear from later virtual rank. Physical freeQuantity and initial expectedBalanceVersion remain actual owner facts; batchAvailableQuantity is explicitly virtual. Quantity summary distinguishes proven insufficient stock from incomplete source/result/prefix proof, which always fails closed. Actual RC/fresh permission, all owner membership/eligibility locks and bounds, original20sec/full P1 gates remain. No Inventory writes or allocation receipt are produced, and no existing writer, schema, global isolation or Archive contract is changed.
- `reverseFulfillmentIssueAndRestoreReservationBatchInTransaction()`只接受已成功且未沖銷的Fulfillment Shipment Issue references，整批回補原bucket及原Reservation；它不修改或重開原Allocation，generic HTTP reversal endpoint亦不可呼叫此能力。

### 5.7.1 Manual Sales batch（2026-10-02採納；source candidate）

`InventoryReservationService.reserveAvailableForSalesBatchInTransaction(transaction,command)`、`releaseSalesBatchInTransaction(transaction,command)`及`getSalesReservationStatesInTransaction(transaction,command)`使用同一caller executor；固定fresh `sales.mgmt`與`SALES/SALES_ORDER`，manual actor userId必填、serviceName/lineId空字串，order ID為safe numeric string。Sales caller仍須自己的view/mgmt及aggregate access/locks。既有單行Sales adapters的`sales.operation`不變，不自動grant、不授權background delegation。

Reserve payload `{warehouseId,expectedOrderVersion,lines:[{sourceLineId,skuId,orderedBaseQuantity,minimumRemainingDays}]}`：numeric safe IDs，1–100 unique demand IDs，64KiB canonical input上限。按SKU/line排序，root及全部children先claim；new execution在stock前取Item current minimum life，再完整Warehouse/control鎖定。Lots按SKU/normalized lot number分頁SHARE，ATP current query同時SHARE balances/lots，AVAILABLE與effective life=`max(caller,current Item)`；逐line扣本批reserved，回partial/zero與conservation。Root source line空、child使用numeric line string；positive Reservation各自綁child operation，zero結果仍保存。

Release payload `{warehouseId,expectedOrderVersion,intent:"ALL_OUTSTANDING"}`不接受client任意Reservation IDs。Owner以reservation ID keyset每頁100列舉全部outstanding mappings，child identity `reservation:<id>`；保存原sourceLineId/SKU/version/exact quantity/root ID/hash，全部claims與immutable scalar staging在stock locks前。取得完整sorted controls後current reservation version/conservation及active allocation guard重驗；全部pages同transaction，final current owned outstanding check拒絕RR漏項/競態並rollback，沒有total mapping cap或page commit。結果`{operationId,lineCount,membershipDigest,results}`的async iterator每頁≤100，caller必須於同transaction完整消費並驗EOF count/digest再完成Sales mappings。State payload `{warehouseId,afterId?}`回owned current `{rows,nextCursor}` page。

四個command types `SALES_BATCH_RESERVE/SALES_LINE_RESERVE/SALES_BATCH_RELEASE/SALES_LINE_RELEASE`重用既有operation table與8192-byte scalar summaries；root只存identity/count/digest，children先complete、root最後complete。Completed replay先驗fresh權限/source/hash與root result type/id與原children command/root identity/hash/count/digest及completion，不讀mutable Item、不重新算ATP或以目前outstanding set重建membership。Incomplete/unknown outcome維持原event查詢，不構成Sales lease/recovery worker。

1/100 demand的Item snapshot與ATP聚合查詢數為常數；child claims/completions及Reservation/audit writes按line數增加，release及lot/result traversal每頁100僅保證returned memory pages；完整control scope仍按unique SKUs，既有indexes的scan/lock footprint需CI EXPLAIN及實際並發/300 mappings計時，不聲稱LIMIT100等於bounded DB work。所有新MySQL回歸只在CI執行，本地SQL未授權；Fulfillment全域互鎖/worker delegation/後續formal acceptance仍pending。

### 5.7.2 P2 Backorder worker sibling — Inventory owner contract

Only `reserveAvailableForSalesBackorderInTransaction(transaction,command)` is added. Trusted server registration binds `sales.backorderAllocate` / NULL user to reserve-only system authority, a fresh authorization callback and current fixed-job lease owner; arbitrary caller serviceName/permissions are not authority. Scheduler stopped/disabled, aborted signal, missing registration or expired/wrong lease fails before any effect and on replay. The lease row is locked before Sales owners and uses DB-clock expiry; the same row lock fences takeover until caller commit. Manual entry and hashes remain unchanged; P3 intake and worker release are not enabled. Add only `SALES_BACKORDER_BATCH_RESERVE` / `SALES_BACKORDER_LINE_RESERVE` to inventoryConstants.INVENTORY_COMMAND_TYPES; preserve every existing manual member and hash. Worker operation types/purpose bind service, actual SALES/SALES_ORDER owner, persistent event/line and original root/child membership. No Inventory schema or role grants are added. Reuse the established sorted claims, ATP locking, exact partial/zero results and replay validation. One FIFO entry per transaction respects the single-SO batch boundary; never claim later Inventory operations after stock locks. Inventory owns this provided reserve-only contract and its operation, Reservation and Audit writes; Sales owns its order, queue and scheduler registration. Inventory does not write Sales records or the lease row. Specification adoption is not evidence of execution, scheduler activation, formal acceptance or release authorization.

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

P2另在待改名、尚未合併的Inventory `0063`建立`sales.operation`（Sales預留）與`fulfillment.operation`（Fulfillment分配／出庫）兩個下游契約權限，並同步登錄權限目錄及seed一致性檢查；它們不屬於上述五項Inventory管理權限，也不自動grant給任何角色。`0055`已合併，保持不變；Inventory `0064`～`0066`預留給後續Phase。

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
- SKU以§5.6.1精確Code查找後顯示名稱、Base UOM及tracking；不call Item管理list，不限已存在Balance的SKU。輸入Code改變即清除該行已選SKU及Lot，未完成查找不可保存該行；僅使用者明確選擇成功結果才綁定skuId。舊／較慢查找response不得覆蓋最新輸入；載入、未找到、資格／撤權／伺服器錯誤清楚顯示，不用numeric-ID輸入或stock-only picker降級。非交易寫入失敗不清除其他未保存lines；儲存失敗／409保留输入並提示重載／重新查找，不自動替換SKU或重送過帳。
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

### 7.6.1 TASK-040 UI and additive lookup/query candidate — HD164 A / HD165

PROPOSED_NOT_APPLIED until actual Sam approves the exact DESIGN/PLAN/source/check candidate. HD164 selected additive Barcode lookup direction only. The complete normative UI/intent/lookup/query/storage/compatibility/scope and66 DEVELOPER NOT_RUN cases are in TASK040 of05_development_tasks.md; §5.7.1–3 domain/auth/scalar/CSV safeguards and all existing routes remain, except explicitly proposed optional q read filters and lookup one-of addition.

Existing Inventory GET sku-lookup extends with exactly one raw code or barcode and the same view/minimum/profile contract, using pinned Item read-only findByBarcode; Code callers stay compatible. No Item permission/source or new catalog/Barcode conversion/automatic count/Bin-Lot-Status guess. Stocktake-only lines/export gain safe parameterized literal q Code/Name substring matching through an owned correlated EXISTS, including bounded candidate keysets and identical CSV line filtering. Same snapshot/stage/global-vs-filtered/NULL/order/cap/budget/currentauth/cleanup semantics, no legacy inquiry/write/CSV columns change. Name locating covers existing Stocktake lines; absent field-discovered SKU uses exact Code/Barcode, not new Item name search. Shared error mapping adds only two existing Item error translations.

Revision2 fixes the three candidate gaps: Barcode raw1–190 Unicode points/760UTF8/no Cc before trim and nonblank, existing400 REQUEST_VALIDATION_FAILED versus printable-unmatched404; current Code unchanged. Mandatory logout/401/view-loss/actor-change bypass dirty/unknown guards, synchronously clear visible data/proof and retain only minimized original-source reference; render authority gates prevent stale display. Shared DataTable remains unchanged: bound keyed instance per read generation, one fetch per instance, later page/reload retires/remounts before fresh read, so late old success/error/finally never updates a live newer table. Explicit expanded U02/A03/C03/C09/C21/B05/B14 cases remain NOT_RUN with same66 IDs/minima. Revision3 removes the dirty Count table before opening its independent persistent editor, preserves committed pagination/input and refuses voluntary paging before state changes; saved/discarded editor remounts at committed page. B14 distinguishes server revoke from observed authority: actual signed existing session.refresh test trigger yields changed real claims before403 assertion, while401/logout and device-only403 remain distinct. No instant server-push or false view-loss claim. Final revision4 splits B14 logout: accessible topbar gesture versus labelled existing real session.logout()+router trigger for persistent-modal states; no forced clicks/mock clear, clearing asserted at existing logout finally, not before async settlement. Full precise sequencing and trade-offs remain in TASK040.

New view-only page/menu uses existing framework discovery and Quasar/PageHeader/DataTable/FormPanel. Four workflow steps follow authoritative server state; Draft scope exclusion is not stock lock, started scope remains locked until confirmed terminal state, unknown response/current-read failure never claims unlock. One explicit Count-row FormPanel dialog per save preserves blank/0/notFound and original line version, blocks unsaved navigation until save/explicit discard; no bulk UI/pack conversion/reopen. Add uses owned scope/current profile/known legitimate Lot only and treats returned id/version as line-owned. Global completion, not filtered subset, gates Ready; whole frozen difference Post and password-only Cancel retain distinct permissions/security, including inactive-scope cancellation. Reuse existing Inventory native transient password confirmation with only additive label prop preserving other callers, no new generic password/auth framework or reactive secret.

Every write has one frozen original body/source/key in current page and minimized actor-namespaced sessionStorage source/action/parent identity before sending. No payload/count/reason/key/credentials persisted. Null/failed/malformed source lookup is UNKNOWN; an ever-unknown later rejection cannot establish no effect. User-explicit retry first queries original result, then only original intent with fresh applicable proof; no automatic replay/new versions/events. Refresh is QUERY_ONLY without reconstructed payload/key; unresolved identity can block indefinitely and tab/storage loss may lose reference, requiring manual reconciliation. Storage unavailable/corrupt/conflict blocks before send, no unknown-clear shortcut. Validate original scalar/parent and Add child distinction, separate historical receipt/current facts, clear only matching identity, guard actor/disposed/late responses. These availability/retention/interaction trade-offs require precise candidate approval, not inferred from HD164.

Business forms retain FormPanel focus/error behavior, Traditional Chinese safe details, textual states/contrast/keyboard and actual320/375/768/1024/1440 rendering. CSV uses existing Blob envelope/all active filters and warns finalSUMMARY completeness, no unreviewed parser or false complete toast. Product scope20 paths/nine existing incremental boundaries/twenty immutable regressions and five exact native groups, including only the HD167 shared-topbar exception, are reviewed as one Task with thin slice checks; old tests/coverage/CI/phase-PR/formal requirements unchanged. Dedicated UI/realHTTP/MySQL/browser16+actualCLI proof and final Sam source review required; none has executed at proposal. Existing shared-stream warning/capacity/writer/restart/crash recovery remain041, not a UI PASS or launch decision.

### 7.6.2 Shared AppTopbar responsive increment — HD166 direction / HD167 candidate

The precise contract and six new DEVELOPER H cases are in TASK040. Only AppTopbar.vue and its existing test join the prior18 paths. Keep full displayName as the existing Quasar accessible label source; bound the account trigger to50% of toolbar inner width with scoped flex/label ellipsis, never truncate stored identity or hide whole-button/body overflow. Preserve icons/arrow/brand/drawer, native keyboard/focus, profile/change-password/logout and all session/auth/router behavior. The visual change affects all authenticated AppShell pages; AppShell/global styles stay byte-identical. Verify real home+Stocktake320/375/768/1024/1440 with no overlay masking, long Latin/Unicode and short names, native Topbar/Shell15+ cases, old coverage/CI and actual Playwright/CLI. All new checks remain NOT_RUN; HD166 direction is not exact adoption or source approval.

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

### 7.8.1 TASK033 high-risk operations UI exact contract（HD130 A；candidate）

This increment implements only TASK033/P3-T08 UI over the unchanged §5.4.2/§5.4.3 APIs. No new endpoint, shared auth/UI/http service, permission, dependency, Item contract or DDL. Backend posting/current authorization remains authoritative; client checks are UX guards, not permission or transaction proof. Pack submission remains supported by the existing API; this minimal UI explicitly accepts Base UOM positive safe integers only, displaying the unit and submitting the server-read base uomId. It does not guess a Pack conversion or expose arbitrary numeric UOM IDs.

**Pages and permissions.** New `/inventory/adjustments` metadata requires both `inventory.view` and `inventory.adjust`; use existing automatic page/menu discovery, not a shared menu/router change. Existing `/inventory/movements` remains view-only for reading history. Only its high-risk entry buttons require view+adjust. Neither inventory.operation nor inventory.fefo.override substitutes for adjust. Support single Adjustment IN/OUT, single Status Transfer and whole-group Reversal; no batch, Stocktake/Opening posting, history edits or downstream workflow resurrection. Movements links into the same Adjustments page with only allowlisted action and canonical positive movementId, never password, reason or command payload in URL. Recheck current session and selected target on confirmation; close/clear transient confirmation when actor changes or permission is lost.

**Selection and current guards.** Reuse Inventory-only exact SKU Code lookup, active Warehouse/Bin selectors and Stock/Lot inquiry. IN supports a tracked usable SKU even without existing Balance, all three stock statuses, no-Lot or existing/new Lot according to tracking policy. Show existing Lot immutable dates; a new Lot takes explicit required expiry for batch_expiry and optional manufacture date. Never fill/change an existing Lot date or firstReceiptDate, use a numeric-ID picker, invent a minimum-life override, or treat an incomplete/failed query as expected absence. Paginate the narrow SKU/WH/Bin/status/Lot queries to completion, match full identity (including null versus actual Lot ID), deduplicate and fail closed on ambiguous/missing/inconsistent data. Explicit expectedBalanceVersion is current version or null only after a complete successful target read. Concurrent changes remain server VERSION_CONFLICT, not silently updated versions.

OUT and Status start from a selected actual Stock bucket; get current detail to bind complete dimensions and base UOM. OUT never chooses new target dimensions. Status changes only status at identical WH/Bin/SKU/Lot, requires a distinct one of AVAILABLE/QUARANTINED/DAMAGED, current source version and current destination version or confirmed absence. Show On Hand, Allocated, Bucket Free and Reserved/uncovered summary without treating preview as a submission guarantee. Expired Status/reversal restoration is not a Sale eligibility override; show that warning without adding a new blanket ban.

Reversal loads the immutable full original group through Movement detail and reads each unique affected current Stock bucket by complete original dimensions. Only RECEIPT/ISSUE/BIN_MOVE/STATUS_TRANSFER/ADJUSTMENT BIN groups, with no selected-leg reversal link and 1–200 complete guards, offer the entry. Unsupported or already-reversed groups show read-only explanation, not a misleading action. Missing historical bucket or incomplete current reads prevent confirmation; never reconstruct a bucket, use balanceVersionAfter as current intent, retarget, reconvert historical quantities or update original history. Show all legs, inverse Base quantity/direction, locations/Lot/status, current versus projected quantity and explicitly identify whole-group effects. Sort unique current `{balanceId,expectedVersion}`; no partial reversal. Server derives actual effects and rejects any concurrent/current-rule conflict.

**Form and confirmation.** Adjustment uses the existing seven reason categories; all operations use existing trim/nonempty/no-control/500 UTF-8-byte reasonText, with OTHER's additional10 nonwhitespace Unicode-code-point minimum. No category-direction pairing or new validation semantics. Reject zero/negative/float/unsafe quantity and malformed dates; inline messages and focusable summary retain safe business input on errors. Review shows actual SKU/name/Base UOM, WH/Bin, Lot/expiry, status, quantity/direction, current versions, expected effects and reason. Escape all content using Vue, not raw HTML.

Use an Inventory-owned Quasar confirmation dialog for the three actual high-risk actions and existing layout/form tokens. A native labelled password input is uncontrolled: no v-model/reactive password, Pinia/URL/storage/intent/cache/log, no prop or emitted password. Read it only into the transient submission call, clear DOM immediately after capture and on cancel/hide/unmount/actor change, and release the local reference in finally. Cancel never sends a POST; retries require new entry. This minimizes retention but cannot promise zeroization of immutable JS strings or protection from an active same-origin XSS/browser extension. Existing HttpClient/device signer transmits a one-use request with `signed:true`, supplied stable idempotency key and a new signature/nonce; no shared signing/auth changes.

**Source and outcome recovery (HD130 A).** Create one Inventory UUID intent before first POST: source.module=INVENTORY, documentType=ADJUSTMENT/STATUS_TRANSFER/REVERSAL, independent UUID documentId and eventId, lineId empty; the header key is a separately generated UUID stable across attempts. Freeze the credential-free original business body/current guards/source/key. Disable duplicate submits and mutation of this intent; do not substitute later versions, reason, targets or quantity on retry.

Before POST, save only `{source,action,movementId?}` under a versioned sessionStorage key namespaced to the authenticated actor; action is an allowlisted enum and movementId is a canonical safe positive ID. No header key, reason, password/token/signature/proof, command payload, quantity, versions or free-text identifiers are persisted. Validate the exact stored shape/UUIDs/action/path relationship before using it; never trust stored identity for authentication or turn a stored URL into a signed request. Storage failure blocks submission with a visible error; do not silently overwrite an unresolved recovery record. This is one unresolved intent per actor/tab, not a durable server inbox or cross-tab serialization.

TIMEOUT, NETWORK_ERROR, indeterminate5xx/in-progress outcomes and navigation abort after submission retain UNKNOWN. Query the exact original source through existing operations/by-source first. A returned completed operation resolves from its original server result and matching Movement source/group; a null response or query error is not failed/rolled back, cannot clear UNKNOWN, generate a new event or authorize an automatic POST. Bounded/manual result queries do not alter the operation. Only while the original page still owns the unchanged intent may the user explicitly request a same-intent retry, after a fresh source query and fresh password/device signature/current session check. If source is already completed, return its result and never resend. After an UNKNOWN outcome, a later rejected attempt does not prove the earlier attempt failed; retain the reference until resolution/manual reconciliation.

Initial definitive validation/auth/version/business rejection retains safe form input and explains the current error; no automatic repeat/new source. A fresh edited intent is permitted only after the prior attempt is known rejected without an older unknown attempt, an exact-source lookup shows no completed operation, and the user explicitly reloads/confirms current facts. A recovered completed result removes only that owned source record; deleting/abandoning an unknown record is not a UI workaround. On reload/navigation, original business body/key is gone: restore query-only recovery, no reconstructed retry, no new-effect controls while unresolved. Actor changes clear memory/dialog but never show another actor's recovery record. Keep same-actor unresolved record until resolved; browser/tab closure or storage clearing can lose it, so display/copy the safe source reference and explain manual reconciliation. No TTL expiry is used as permission to repeat an unknown event.

**Results/history/accessibility.** Show original operation/group/result quantities, then re-fetch actual server Stock/Movement facts, never optimistic success. Locate result Movement by complete source (module/type/document/line/event and operation/group), not a loose source search's first row; source query has scalar resultSummary, not the POST nested result shape. Existing selected-leg reversal links remain bidirectional; full group display includes SKU/Lot/status/quantity and each leg navigation. Detail fetch generations/cancellation must prevent a late prior selection's result or error from rendering or launching a reversal for the current selection. Loading/empty/error/permission/UNKNOWN/resolved states have clear text/ARIA, keyboard focus/error summary, dialog focus trap/return and no color-only signal; validate320/768/1024/1440 widths.

**Verification/evidence boundary.** Add native unit/service tests and eight real MySQL26.7.0/API/browser cases, not mocked-success Playwright. Browser uses the real client non-extractable device key, approved synthetic binding, password hash, JWT, limiter and strong-auth handler; response-loss/pre-forward abort are explicit transport fault injection, never fabricated API success. For the new high-risk browser spec, turn trace/video/automatic screenshots off; capture only explicit credential-cleared screens and safe boolean/allowlisted diagnostics, never raw POST body/auth headers/session exports. No raw high-risk trace is a fallback diagnostic. Retain existing Transfer browser8 and ordinary browser regression18; all applicable checks on the new source, zero forbidden skips and unchanged coverage/global34 floors. Developer PASS is not formal TC/UAT, capacity, Phase completion or publication approval. TASK034 and later remain separate.


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

`ItemLookupService`由Item module擁有，提供`getInventoryProfileInTransaction(transaction,skuId)`及`resolveUomInTransaction(transaction,skuId,uomId)`，回`skuCode`、`skuName`、SKU status、inventoryTracked、trackingPolicy、Base UOM、整數factor及minimum life的白名單projection；不得要求下游actor持有`item.view`。新增`server/test/itemLookupService.test.js`及Inventory consumer contract test，證明Inactive／Archived／Serial／UOM版本語意一致。

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
server/database/migrations/0055_seed_inventory_permissions.js
server/database/migrations/0056_create_inventory_operations.js
server/database/migrations/0057_create_inventory_audit.js
server/database/migrations/0058_create_inventory_master.js
server/database/migrations/0059_create_inventory_stock.js
server/database/migrations/0060_create_inventory_movements.js
server/database/migrations/0063_create_inventory_reservations.js
server/database/migrations/0064_create_inventory_transfers.js
server/database/migrations/0065_create_inventory_stocktakes.js
server/database/migrations/0066_create_inventory_opening.js
server/test-support/fakeInventoryDatabase.js
server/test-support/inventoryFixtures.js
```

這是`HD-066`選定、待新hash批准的實體配置，不是可自行平移的示例。每支尚未建立的migration開始前仍要fetch main並檢查全部migration filenames、`fr_schema_migrations`及其他worktree配額；碰撞時停止並重新批准配置，不得重用空缺或修改已套用migration。

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

### 10.6.1 TASK041 measurement-first characterization — HD177 A / HD178-179 reconciliation / HD180 candidate

保持§10.6全資料基線及既有查詢p95<2秒；不從API30秒／DB20秒截止推定大型Start／Post成功SLA，也不借用其他模組的memory預算。下一段只新增三個test/child路徑，以真實全容量schema、20名不同使用者、1／10／200同倉Bins及30分鐘穩態觀察，明確保留2worker topology、auth續期、原rate limits及完整交易／ID效果比對。前置15張真HTTP Reservation的Reserved／Operation／Audit效應單列；candidate GET只由原writer權限lane呼叫，view-only readers不升權。30分鐘固定每worker14400個round-robin offers，busy／late仍入分母，達minimum後不停止。精確fixture、採樣、進度minimum、九個developer案例及命令在TASK041第三增量。

JUnit PASS只表示當次已定義的硬安全／NFR／量測完整性斷言通過；所有尚無批准gate的write latency、RSS／heap／anonymous disk數字是MEASURED，performanceAcceptance固定NOT_EVALUATED_PENDING_APPROVED_NUMERIC_GATE。未觀察到的phase／樣本／效果或未完成30分鐘不可PASS；大盤點timeout／missing Post保留原結果並FAIL完整性，不減fixture／延長deadline／direct SQL補狀態。測後固定證據再經Sam審閱數值gate、並實際重驗，之前TASK041／P4仍不得完成。此處無新business scope cap／非同步／pipeline／DDL／timeout變更或風險接受。

Counterfactual完整性保護：成功／busy503／rate429／timeout／abort／denied／network／UNKNOWN與未送offer各自記錄，全部分母不可抹除；原query gate除成功p95<2秒外要求合法查詢無不預期失敗，不能剔除失敗後報達標。最終排空全量reconcile必須0差異。二worker只是合成測試topology，不是部署認證；30分鐘不是長期無leak保證。shared ServerResponse warning只觀測不壓制／修復／接受；production empty-metadata可信運維與target filesystem仍是獨立阻擋。舊46組／37floors／global coverage／五項CI／formal TC-UAT全部不變；原45個累積來源／測試／migration與guards禁止修改。

### 10.6.2 TASK041 bounded Control SQL remediation — HD181 direction / HD182 precise candidate

只有InventoryLockService的Control upsert與其locking reads按既有正規化／dedup／全局數值順序切最多1000鍵；先完成全部upsert，後完成全部locking reads，串接原DB rows，再進入原Bin及後續lock classes。同一caller-owned transaction／executor／now，無batch commit、平行化、重試、新連線、業務行數上限、DB設定或timeout變更。每INSERT最多4000bind，read最多2000bind；保留原SQL欄位、預設值、id=id及ORDER BY ... FOR UPDATE／錯誤映射。對<=1000鍵維持原SQL與次序。

本節只對§10.6.1／TASK041第三增量的不可變guard作一個精確例外：LockService原edd2eec3…的Control兩句路徑可修，並只append其既有單元測試；45個累積來源／測試／migration及其他guards全部不改。三個已批准新test/child範圍保留，不修改Lot／Balance或其他鎖定SQL、Stocktake／auth／Operation／Audit／DB service。詳細五路徑、LU07–12及CP09契約在TASK041第四增量。原48組僅characterization min8提高至9，另append新unit12例零skip，合計49組；舊門檻／coverage／CI／formal全部保留。

100k行／50k SKU會由2句Control SQL變100句，鎖仍持續到原交易終止，總輸入／結果仍O(n)；只限制單句SQL，不承諾全局memory有界、無deadlock或完整Post效能。其他大型SQL若再失敗不得默默擴修。完整同規模Post及原回歸必須重新執行；所有write/resource仍只MEASURED，另審數值gate與重驗，production空metadata／target filesystem／shared warning及TASK041／P4完成條件不變。本候選尚未採用，新增驗證全部NOT_RUN，HD181只准備方向。

### 10.6.3 TASK041 Lot tuple-IN candidate — HD185 preparation / HD186 exact decision

只准候選將Lot locking read的OR-pairs換為單句`(sku_id, normalized_lot_number) IN ((?, ?), ...)`；原SELECT *／query／params／ORDER BY sku_id, normalized_lot_number FOR UPDATE、空輸入、DB collation／結果基數及所有前後lock classes不變。不切batch、不用JS取代DB排序、不加hint／索引／CAST／設定／pool／期限／業務上限。這是§10.6.2及TASK041第四增量「Lot不改」的唯一後續候選例外；已實作Control路徑不動，其餘45檔／20guards保持原bytes。總五來源／測試路徑不增加，既有12單元正文不改。

採用後先test-only以原OR與固定tuple-IN在fresh完整容量／同settings做EXPLAIN、六個交替warm配對、25k原生row／DB排序及實際wait／locks／current read／rollback比較；詳細CP10–12及LU13–18見TASK041第五增量。只在候選六次原10秒內完整、max(IN)小於OR所有完成時間或timeout10秒下界，且語義／並發前置檢查通過後才實作產品predicate；neutral／worse／不相容保留原產品，不自動改batch／FORCE INDEX或放寬門檻。已定位原request的Lot query timeout，不等於已證明底層optimizer或wait機制。plan／trace或觀測缺失須明示，候選plan或必需鎖觀測不足則不實作。

Profile只提高原control-lock-unit min12→18與characterization min9→12，49組／所有argv、env、timeout、zero-skip、coverage／CI／正式要求不變。完整100k Post、舊CP02／06–08及soak仍必需；本比較不是新的生產SLA，數字仍MEASURED／另審數值gate重驗。全部新檢查NOT_RUN，本候選未採用，不等於source批准／TASK041或P4完成；production metadata／target filesystem／shared warning義務保留。

### 10.6.4 TASK041 Post transaction-local lookup — HD195 preparation / HD197 exact decision (HD196 P2 revision)

候選只改StocktakeService.postInTransaction的local查找索引，原lineDimension／Number語義、first-row+duplicate-count、row identity／順序／first-error、完整snapshot／allocated與整張Reserved、fresh auth／replay／atomicity及所有產品SQL／參數／鎖序／20秒交易／30秒HTTP不變。不修改其他方法／Item／共享timer，不加cache或public API。索引只避免重複全掃描，增加線性memory；每SKU查詢／逐行寫入及總資源仍可能阻擋100k，不承諾SLA。這是TASK041第五增量StocktakeService不可變guard的唯一後續候選例外，其餘44檔／20guards及當前Control／Lot與18unit bytes凍結。

14個新PostLookup單元以實際Post方法及有界getter tripwire先RED後GREEN，保留duplicate／NULL／error順序與同SQL oracle；成本計數不是生產wall-time或memory gate。PU13／14成本域固定一個盤點Bin，分母另含每SKU全倉AVAILABLE查詢的所有回傳列（含範圍外Bin）；在fixture過濾後觀測service讀取並加入範圍外1000／10000列對照，不宣稱未改helpers或任意Bin數的整個服務均為線性。test helper只加同request最小化CPU／SQL里程碑、parent30秒JSON／120秒CSV transport watchdog及實際owned child／SQL terminal核對；abort不等於worker停止或rollback，強制清理不轉原case為PASS。原CP01–12全保留，最後新增CP13固定test-only CPU hold／有界強制終止情境，無新HTTP endpoint／app／pool／monitor；預先登記的單一注入只驗證測試owner恢復，不代表產品deadline或真Post成功。

詳細演算法邊界、14單元、CPU phase證據限制、5/5/5 stop與20秒terminal、CP13及來源before pins見TASK041第六增量。新增DEVELOPER unit組min14／zero-skip；characterization min12→13，原49組argv/env/timeout/coverage/CI/正式要求保留，PHASE005 append至50組。新檢查全NOT_RUN，canonical／產品未採用。數值gate／實際重驗、production空metadata／target filesystem／shared warning與Sam最終source審閱仍必需，不等於TASK041或P4完成。

### 10.6.5 TASK041 developer observation lifecycle — HD204 preparation / HD205 exact candidate

PROPOSED_NOT_APPLIED。本候選只調整既有test helper／characterization test的監測生命週期，不改產品SQL／Item／DDL／共享框架／auth／lock order／10s query、20s transaction、30s HTTP、120s CSV或5/5/5 owned stop。CP10從RPC dispatch前即建立原20s採樣截止，包含start identity等待；沒有start在同deadline FAIL。保留原20s terminal窗口；依HD219待批准的窄例外，CP10開始完整sample前須至少1000ms剩餘准入，末段不發送記NOT_ADMITTED而非成功；它不改20s硬截止，也不把已發query的真錯誤改成WINDOW_CLOSED。sample內下一句尚未dispatch且原預算已用盡才記WINDOW_CLOSED，已發query的真錯誤仍FAIL。terminal從completion或sampling截止的較早時刻起算，不因late IPC或重試延長；work回執與正面SQL狀態缺一不可，且成功所用完整SQL終止觀察必須在matching completion後才開始並於既定terminalDeadline內完成；不能鎖存較早Sleep／零活動後拼接回執。

本fixture私有registry只保存實測live native/P_S mapping及後續已讀InnoDB IDs／lock-engine tokens，namespace分開、原字串／owner／時間保留；missing live mapping只能使用先前已驗證身分繼續實際終止查核，不能從缺值或aggregate0補證據。未捕獲就消失、衝突／foreign／歧義仍UNKNOWN；不保證捕獲所有短命連線。只在既有monitor上做startup原5s capture及實際觀測點metadata讀取，不新增pool／monitor或business executor SQL。

依HD217精確隔離候選（另須Sam批准才採用），CP14／CP15改由同full-capacity schema的一個短命OBSERVATION_ONLY pool1 test app序列完成；原capacity兩個pool10／20actors不變。CP14於該app原交易固定鎖warehouse5，實測並保存identity後，以strict UUID/incarnation/nonce綁定的固定test-only HOLD／ABORT IPC中止自己的交易；必須看到callback settle、舊SQL／locks終止、先核對實際單一連線，再以真GET期間的新建通知／新ID核對replacement；CP14失敗quarantine並阻擋後續負載，原normal退出／歷史identity對賬不變。沒有新HTTP endpoint、任意SQL／PID／duration、產品故障豁免或新timeout；完整16表rowhash不是rollback／terminal替代品。characterization min13→14，原50組命令／env／timeout／zero-skip、coverage37及全局92/83/90、五項CI、正式TC/UAT不變。完整合約、17個support情境／九個mutation、CP14與精確兩路徑及凍結範圍見TASK041第七增量；新檢查全NOT_RUN。原失敗／941run refs保留，新PLAN／最終來源全重驗。未獲精確候選批准不採用；實作後仍需Sam來源審閱，TASK041/P4未完成。

### 10.6.6 TASK041 bounded Post SQL and pre-loan connection identity — HD207 preparation / HD208 precise candidate

PROPOSED_NOT_APPLIED；HD207／APR-297只批准準備，需另經Sam精確採用。本節是§10.6.4產品SQL bytes及§10.6.5 monitor-only身分來源的精確後續例外，不放寬其他邊界。Post只在changedSkus>100時按最多100SKU有序AVAILABLE FOR SHARE讀取，changed legs>100時以每批最多100行／3200bind／string UTF8共1MiB的參數化SQL序列完成Balance CAS、逐行Movement及line CAS與逐行scalar Audit；小單及全零原路徑保留。真實ID由完整維度／operation+line owner讀回、驗證bijection，不推算insertId或連續ID。原caller-owned單一交易、lock classes、snapshot／allocated／整張Reserved、current auth／replay／時效／日期／原10sSQL20sTX30sHTTP120sCSV與header／own鎖收尾保持。batch有SQL／I/O故障次序與timestamp取樣差異，正常成功讀取下first-business-error／公開映射不變；不承諾SQLtrace／跨表全域寫入次序。Item原介面及每SKU profile讀取不改，不保證100k Post即達標。

InventoryAuditService只增量提供recordSucceededBatch(tx,inputs[0..100])，與single共用原validation／scalar serializer／8192bytes，保持每行Audit而非合併summary；沿原executor、無獨立transaction／commit，任何後批失敗全張rollback。原single成功／rejection／failure介面、SQL及fallback保留；不繞過共享Audit ownership。部署配置／DDL／依賴／Item及其他writers不改，DB08只在隔離測試session改AUTO_INCREMENT step並還原，不套用app／全容量設定。

僅test child的原pool getConnection增加第一次實體core借出前的固定同連線live P_S SQL＋incarnation/nonce IPC來源，須parent實際保存entry後matching ACK才loan，全部沿原絕對5s acquire預算、實際own connection；不是每業務SQL、不是新monitor／pool。原parent monitor來源亦保留，所有來源記provenance，missing／foreign／collision維持UNKNOWN。原request abort及晚到pending清理不改；mapping／ACK失敗destroy own connection並設child永久failure latch、parent盡力quarantine，通知遺失亦不再loan新業務連線；既有交易不假稱終止。after hook仍需當前實際SQL核對全部歷史identity。依HD217窄隔離例外，CP15接續CP14同一OBSERVATION_ONLY incarnation完成真短命replacement／socket終止與真GET對照，正常關閉及全歷史terminal後才進入原capacity負載；test-only額外SQL／IPC／acquire成本明示，不把instrumented數字當生產SLA。原透明observer／watchdog／CPU／5/5/5元件bytes不改。新owner-map異常及批次CAS不足固定既有CONCURRENT_OPERATION，其他既有業務／driver／serializer錯誤與公開映射保留。

精確九路徑、44累積檔＋21guards凍結、34新unit／18真DB／CP15、原PU14不弱化及全部NOT_RUN合約見TASK041第八增量。新增兩個DEVELOPER組使PHASE00550→52；characterization min14→15但原缺少CP02／06–08／13與soak不可替代。其餘舊命令／env／deadline／37floors／global92/83/90／五項CI／正式TC-UAT保持，950run refs與原8PASS2FAIL保留，新PLAN最終來源全重驗及Sam最終source review仍必需；不是TASK041／P4完成、數值gate、部署filesystem／metadata或shared warning豁免。

### 10.6.7 TASK041 transaction-bound existing Item bulk profile consumption — HD209 precise candidate

PROPOSED_NOT_APPLIED。APR297準備授權下的後續精確候選，非HD208自動擴權。Post對全部uniqueSKU>100才以排序最多100SKU/chunk，透過tx-bound ItemLookupService.findManyByIds(chunk,{purpose:"inventory"})讀profile；<=100原單筆路徑不改。constructor僅新增optional inventoryProfileLookupFactory(shareExecutor)，同步回既有lookup；預設new ItemLookupService以同shareExecutor作database，兩句既有SKU/Item與UOM SQL都用原tx.query加FOR SHARE。不得用主要DB/pool、cache、新transaction、環境/fake fallback或改Item來源/SQL/consumed pin。原13-key inventory profile、BaseUom第一匹配/factor1/uomConversionInvalid、逐SKU sorted首個business error及原Item purpose政策保留；前批驗證完才讀下批。同檔named export pure toStocktakeInventoryProfile由Post實際使用並只保留其結果，供直接單元/真Item對照，不是新HTTP/service/Item API；Post wiring與不保留generic Map另作來源審查，不虛稱動態retention證據。原profile階段沒有guard，不得新增batch/逐SKU guard改變原UOM/auth錯誤優先序。詳細projection/DI/test oracle見TASK041第九增量。

原auth/sealed proof/replay/snapshot/allocated/整張Reserved、Inventory lock classes、單一原子交易、逐行Movement/scalarAudit、原header/own-lock收尾、原guard位置與10sSQL20sTX30sHTTP120sCSV不改。bulk的Item row-lock interleaving、SQL/I/O錯誤先後與trace不承諾相同，不保證無deadlock；等待後current read/錯誤映射/rollback必須真MySQL驗證。只保留當前generic chunk及原exact profiles Map，單SKU UOM列數無新上限，不假稱硬memory上限。50kSKU預期100000→最多1000 profile SQL，仍不保證100k Post成功或生產SLA。

精確五路徑及PB/PU fixture-only例外；Item/其文件/tests與原consumedSHA不改，44+21guards/原Auditunit/四frozencomponents及HD208 Audit/AB/OM/DB18新增freeze保留。新增14unit/16真MySQL零skip、PHASE00552→54 developer組，舊命令/env/min/deadline/37floors/global92/83/90/五CI/正式TC-UAT不變。原100k20sFAIL及952run refs保留，新PLAN最終來源全重驗/Sam source review仍必需；CP02/06–08/13/soak私有draft不是PASS。本候選不關閉TASK041/P4，不豁免數值gate/targetFS/production metadata/shared warning，不授權publication/P5/formal/deploy。

### 10.6.8 TASK041 scoped Export Audit verification — HD212 A preparation / HD213 precise candidate

PROPOSED_NOT_APPLIED。HD212／APR306只批准準備分層驗證，不改產品Audit。對既有正常CP07三個dispatch，以事前fixture／request intent固定精確DOMAIN／ROUTE descriptor：兩份完成CSV各一列DOMAIN SUCCEEDED、無ROUTE；健康Audit DB且已授權並有真active-generation busy證據的503，一列DOMAIN FAILED加一列ROUTE FAILED。DOMAIN=inventory.export/stocktake/正stocktakeId/stocktake:<id>；ROUTE相同action/type但target_id嚴格NULL與精確路由模板。每列核對actor及其既有label、request/correlation、operation、before/after scalar摘要及正常reason欄位；按預期multiset比對，拒絕同scope/outcome重複、漏列、未知scope與額外列，不以outcome去重或從待驗readback生成預期。成功Audit表示generation完成，不保證下載送達；stream失敗／前置拒絕／Audit DB故障或未知提交不套此三dispatch基數，也不承諾exactly-once或FAILED必定持久化。精確欄位、TDD/mutation及原生oracle見TASK041第十增量。

CP08／全庫Audit對帳同時保留DOMAIN和ROUTE，以事前dispatch ledger與原生唯一Audit ID union核對全部增量，不排除NULL-target generic列、未註冊request或其他未解釋action/target，不改既有庫存／Operation／Movement／原始Audit保護。Audit列數不等於logical HTTP request數。只改兩個已批准performance helper／characterization測試路徑；ExportService、handler、dispatcher、AuditService及所有產品/Item/schema/權限/timeout/immutable pins不改。原CP07跨層outcome唯一與單target/單FAILED斷言只可換成更精確的scope/完整欄位/精確列集斷言，不能放寬成任意<=N。HD211採樣clock/yield及原coverage函式保持原bytes。

只三檔canonical候選：本節、manifest衍生provided pin、TASK041計劃。profile/trace/commands/env/min/skip/deadlines/54組/37floors/global/五CI/正式TC-UAT均不變；全量fixture、查詢2秒與30分鐘soak不縮減。所有新PLAN最終來源檢查/新增oracle/native均NOT_RUN，舊原生反例與失敗保留，不改為PASS。準備批准不是本精確採用/最終Sam來源批准；TASK041/P4/numeric gates/targetFS/metadata/shared warning仍未完成。APR291後續跨模型全面略過，不含publication/P5/formal/deploy。

### 10.6.9 TASK041 CS01 test-only lifecycle/Audit 與 refresh — HD214 A preparation / HD215 precise candidate

PROPOSED_NOT_APPLIED。只在 CS01 owned application child 透過既有 handlerRegistry moduleLoader，對唯一 Stocktake export handler／其 owned ExportService及DOMAIN／ROUTE Audit instances 作被動 call-through 觀察；不改產品或共享 prototype／HTTP framework，不加 ServerResponse／stream listeners，不改原 return／Promise／error／callback／event order、signal或期限。獨立事件包含 generation transaction return、prepare stream、真 pipe／source end/error/close與原destroy、原handle settlement、實際Audit attempts及其原交易settlement；request／incarnation事前登記，bounded primitive receipts失敗／溢出或關聯不足即INCOMPLETE。所有細節及透明性／身份／成本驗證見TASK041第十一增量；這是準備候選，不是已證明可用的instrumentation。

成功Audit仍只表示generation完成，不代表client已收完。真client首段後abort不能自動決定FAILED列數；依獨立source／pipeline／dispatcher／交易事件分類，事前意圖與generation facts核對每個原Audit attempt及精確DOMAIN／ROUTE descriptor，與全庫unique Audit ID union對帳，含NULL-target路由列。未匹配事件、漏／重／未知attempt、recordFailed/Rejected false、顯式unknown commit均FAIL/INCOMPLETE，不以待驗DB列選branch／拼預期，也不容許任意<=N／outcome dedup／重試補寫。HD213正常CP07三dispatch精確基數不改；不保證FAILED一定持久化或exactly-once。

CS01所有actor於steady600／1200秒各有獨立signed refresh到期事件，於第一個可admit的自己原lane turn執行，writer每第四intended turn仍固定candidate；原JWT15m／簽章／session／singleinflight／offers／原產品期限不改，不隱藏refresh、不另加request或擠掉candidate。記due／dispatch／complete／lateness，兩次均須在steady內及真expiry前完成；早期expiry refresh不能預先抵未到期事件。這取代舊文字「第10／20分鐘完成」窗口要求，不擅設新lateness SLO。原完整fresh fixture、20actors／2workers、120warm＋1800steady＋<=180drain、2700coordinator、每worker14400offers、sampling1Hz95%／max5s／queryp95<2s及全部workflow/export/reconciliation/cleanup硬門檻保留。

本候選只改本節、manifest provided pin及TASK041計劃，來源增量只准helper／planned resource-soak兩條測試路徑；70 immutable pins／四 frozen components／HD211 clock+coverage+yield及profile／trace／matrix／54組／37floors／五CI／正式TC-UAT不改。原CP13已批准範圍保留且仍需其獨立原生證據／最終Sam source審閱，不能繼承forced-stop成功例外給CS01。所有新增檢查NOT_RUN；TASK041／P4、數值gate、targetFS／production空metadata／sharedwarning仍未完成，不含publication／P5／formal／deploy。APR291後續跨模型SKIP。

### 10.6.10 TASK041 developer lifecycle isolation — HD216 preparation／HD217 precise candidate

PROPOSED_NOT_APPLIED。HD216 A／APR314只准備精確候選。原source13bea／PLAN7e5 native ff5b僅CP01／09通過，CP14在原worker1已有兩條真live PRIMARY identity時正確FAIL，尚未執行100k／CP06。本候選明示取代原OL-C與CP15「同原worker1／不新增app／pool／connection」前提，不能把兩條當一條或重跑至偶然通過。只在CP14→CP15原生前置階段新增一個短命OBSERVATION_ONLY pool1 app，同schema／原handler／真view-only actor copy／signedrefresh／HTTP，不改原capacity兩個pool10／20actor／全部資料與期限。

single-identity／noalternate／uniqueGET-interval new mapping／callback settle／實際socket及SQL終止／完整16表不變的原證據強度不改；CP14成功只允許接CP15。新app正常ack0／exit0、全部historical mapping／SQL／socket終止且固定slot2移除／monitor恢復後，才可放行正常負載；任何失敗清兩flag／quarantine／保留原錯誤並阻擋後續／業務cleanup。retired owner不刪歷史，最終仍有新鮮all-owned SQLterminal對帳，不另發IPC給已退出child。boot前owner登記、一次建立、真JWT無grace/relogin、透明frozenrequest及原slots／clock保持的精確合約見TASK041第十二增量。這不證明pool10產品恢復SLA，也不修背景pool行為。

只准helper及characterization兩來源路徑；三canonical檔（design、manifest衍生pin、TASK041計劃）候選，profile／trace／matrix不變。70filepins＋4productpins、四frozen components、HD211及本次另列CP06 whole-function pin保留，原CP13／HD215 CS01 scope獨立保留。新增12 SUPPORT_ONLY情境／6mutation、CP14／15真原生與新PLAN最終54組全部NOT_RUN；characterization15cases／7200s、soak1case／2700s、全資料／queryp95<2s／37floors／global92/83/90／五CI／正式TC-UAT不降。額外app／metadata／normalstop成本計入原預算，可能仍FAIL。原失敗、run refs及Sam最終source審閱仍保留；TASK041／P4、數值gate、targetFS／metadata／sharedwarning未完成，不含發布／P5／正式驗收或部署，APR291後續crossmodelSKIP。

### 10.6.11 TASK041 CP10 sample admission — HD218 preparation／HD219 precise candidate

PROPOSED_NOT_APPLIED。HD218 A／APR318只批准準備。9b4d實測CP01／09／14／15／02 PASS後，CP10的OR round1在119ms剩餘時發出的LOCK監測約120.735ms後TIMEOUT，monitor失效；final SQL terminal UNKNOWN。這不是已證明的產品缺陷或新100k HTTP500。原失敗／正常app退出與coordinator精確清理的不同證據保留。

候選只調整CP10新完整sample的准入：child尚未settled、當時距同一samplingDeadline至少1000ms（含等於）才開始；不足但未過deadline記NOT_ADMITTED_RESERVE並停止後續sampling offers；deadline已過記WINDOW_CLOSED_BEFORE_DISPATCH。這些未發SQL，不算完整sample／PASS／terminal。1000ms為固定developer取樣政策，不是保證完成上限；最後不足1s可能少收診斷，須Sam明確批准，不能說成等價連續20s觀測。原至少一份完整sample、所有已發fail／partial／UNKNOWN與實際未發送offer分母保留。

已准入sample及每句SQL仍使用原samplingDeadline剩餘與原10000ms的較小值；timeout或deadline後結果仍FAIL／quarantine／destroy原monitor，不能改名或retry。原RPC前dispatch+20000ms（含start等待）及min(completionObservedAt,samplingDeadline)+原20000ms terminal窗口不改，不從reserve-stop重新計時。提早停offer且completion未知時，等待只可暫用samplingDeadline+20000ms；matching completion到達後、terminal查詢前必須按其實際時刻只收緊有效deadline。19.2s停offer／19.5s完成，只可於39.5s前完整terminal，39.8s結果FAIL，不沿用40s。仍須matching completion後完整fresh terminal。失敗monitor不重連／不加pool／connection，原owner停止仍獨立嘗試；無fresh證據維持SQL_TERMINAL_UNKNOWN，外部teardown不轉PASS。

精確範圍只helper的小型pure判斷／CP10 loop及primitive紀錄、原characterization CP10 case內的12支持性oracle；lotMonitorRead whole-function新增不變pin。四frozen／CP06／HD211／70file＋4product／profile與原54組、15case／7200s／1soak／2700s／全容量／所有期限／37floors／global92/83/90／五CI不變。六mutation、原生CP10完整配對比較／25k結果及Inventory16hash、CP11／12／100k／CP13／CS01／最終54與Sam來源審閱仍須實跑；本候選不是DONE/P4/numericgate/發布或正式驗收。詳見TASK041第十三增量；APR291後續跨模型全部略過。

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

Gate：AC-019～043、真並發、本階段已實作Bin mutation入口的真實persistent-lock coverage及高風險auth通過；Opening的實際writer鎖證據由§3.7.1明確配置至下一階段，不作已通過。TASK041其他容量／崩潰恢復／warning風險門檻不得省略。

### 12.4 Phase 3：Opening、reporting及完整整合

- Opening CSV worker、Go-Live control及result。
- 全部exports、expiry／uncovered查詢、reconciliation runbook。
- Receiving、Fulfillment、Returns contract tests及backup/restore。

Gate：AC-044～050、10k Opening、2M Movement查詢、復原／對賬、上線演練通過，並以真實Opening writer及API/worker鏈完成§3.7.1繼承的FR094／TC008 persistent-lock拒絕及零部分效果證據。

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
| `DEC-028` | 歷史決策：Migration原固定為`0054`～`0063`；因main後來占用`0054`，由`DEC-030`取代。 |
| `DEC-029` | 採納Item-owned `ItemLookupService` transaction contract `transaction-v1`；`getInventoryProfileInTransaction`及`resolveUomInTransaction`只使用caller transaction，Inventory manifest綁定實作hash且不得複製Item資格規則，§§5.11、8.2。 |
| `DEC-030` | 維持相同依賴順序，將Inventory整段migration配置順延為`0055`～`0064`；歷史可拋棄schema證據保留原檔名，既有產品migration須在新baseline批准後一併改名，§§1.3、4.23、8.5。 |
| `DEC-031` | `HD-066`取代`DEC-030`未合併部分：保留已合併Inventory `0055`～`0060`，因Supplier已占用`0061`～`0062`，將Inventory Reservation／Transfer／Stocktake／Opening分配為`0063`～`0066`；待新DESIGN／PLAN hash批准後才改產品migration，§§1.3、4.23、8.5。 |

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
Bin Move uses the §5.4.1 1–100-line contract with server-derived dimensions, complete source/destination expected-version guards, shared-Bucket gross-OUT protection and one atomic Operation/group.
Draft selection uses the minimal Inventory-permission exact-Code read contract in §5.6.1, reusing Item-owned qualification and allowing SKUs without Balance rows.

### Rationale
This matches the stated no-partial-transfer policy and provides explicit custody and reconciliation.
The lookup preserves existing Draft semantics and least privilege without a new catalogue, Item administrative access or duplicated Item rules.

### Failure behavior
Any invalid line, lock, quantity or destination rejects the whole transition with no partial movement.
Bin Move absent/existing destination mismatches, inconsistent shared-Bucket versions, allocation/free-stock violations and any Balance/Movement/Audit/completion failure reject the whole document; retries never duplicate paired legs.
Lookup failure selects nothing; stale selection never bypasses transaction-time validation or silently substitutes a different SKU.

## DES-006 — Adjustment, status transfer and reversal

### Decision
Corrections create authorized new movements with reason and audit; posted movements are never edited or deleted.

### Rationale
Compensating entries preserve history and keep Stock Status changes separate from quantity corrections.

### Failure behavior
Commands that would violate quantity, reservation, expiry, permission or idempotency rules fail closed.

## DES-007 — Persistent Stocktake scope and lock

### Decision
Stocktake uses persistent Bin ownership locks, immutable snapshots and one all-or-nothing variance posting. HD152 A: existing legal Lot positive variance is physical reconciliation even if expired/below receipt minlife, without changing dates, sale eligibility or other posting policies; exact Ready/Post/sealed Cancel proposal in§5.7.2. HD147 A limits field-discovered dimensions to existing legal Lots (explicit NULL for tracking=none), never Lot creation or stock mutation during Counting; per-line versions govern atomic count batches, with read-only paginated progress. HD149 A preserves scalar Operation receipts and8192byte guards; exact per-line history uses same-transaction scalar Audit rows, never nested summary persistence. HD144 A: Draft/Counting/Ready scope is exclusive under Warehouse serialization and fresh current validation; Draft scope exclusivity does not create semantic Bin locks or block stock writers. HD170/HD171 proposes explicit evidence allocation only: implemented-writer proof remains TASK041/P4; actual Opening writer proof is mandatory TASK044/045/051/P5, never N/A or presumed green; all other P4 closure obligations remain blocking (§3.7.1).

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

HD018 read-anchor implementation: named Fulfillment Inventory state/candidate reads lock Warehouse first, then SELECT existing StockControls by ordered owner keys, then Reservations (complete influence retains PK batches500). They never invoke the writer upsert or repair missing controls; missing controls or reserved_quantity below the scoped locked Reservation outstanding total fail503. This proves the requested scope only, not an unmeasured warehouse-global total. No-op DML is excluded as well as quantity-changing writes; the original independent candidate API and all writer APIs remain unchanged.


TASK016 preparation detail (existing approved Allocate wire): Fulfillment claims/replays the public event before deriving owner CAS. Only new work invokes InventoryLookup.prepareFulfillmentAllocationInTransaction for plain, nonlocking current Reservation/source facts and Inventory-purpose Item profiles. Inventory assesses the actual selected prior-member budget in writer order and derives each member reason from the single public Line reason; exact members get empty reason, only deviating members inherit the validated reason. All-normal unused reason stays invalid. The assessor is shared with the existing writer, whose fixed physical-reader wrapper retains original fresh permission/reason enforcement. Preparation grants no write authority; all Inventory operation preclaims still precede Sales/Fulfillment roots, locked Item and Warehouse/Bin/Lot/Balance/Reservation posting checks. No client ReservationVersion, bypass flag, new isolation strategy, changed old provider ABI or threshold waiver is introduced. A reason-classification/version race rejects atomically with reload guidance, never silently changes the prepared command/hash. Exact owner source review and regression remain required.


TASK017 release-aware preparation detail (approved atomic Reallocate semantics): InventoryLookup.prepareFulfillmentReallocationInTransaction independently enumerates and proves the complete own-Fulfillment live Allocation set and exact old CAS/current outstanding before deriving all release credits. All members’ credits precede new selection; Inventory’s shared eligibility/sort/pagination query includes zero-physical-free credited buckets before LIMIT, with physicalFreeQuantity, ownReleaseCredit and availableAfterOwnRelease distinct. Reject corrupt physical counters, excessive credits and unknown/incomplete dedicated operations; never infer credits from client quantities, local projection alone or other Fulfillments. Existing candidate APIs and normal Allocate preparation remain unchanged. Actual write anchors must revalidate the complete old set/current CAS; all old releases precede new allocations, original initial Balance CAS is retained, and receipts account for actual release increments before new-leg increments. Fulfillment preserves historical cumulative allocated and derived released, unchanged Claim/Sales quantities, exact replay and full rollback. No new write authority, stock reservation, permission, global isolation, schema or20second exception. Necessary shared source scope includes InventoryPickSequenceService.js to avoid duplicating owner eligibility SQL. See implementation/38_task017_reallocation_owner_preparation.md for actual separate direction review and pending source/runtime gates.


TASK018 necessary Pick owner proof (approved existing §2.4/§8.4 RELEASE semantics, separate direction review in implementation/39_task018_pick_confirmation_increment.md): explicit InventoryLookup.readFulfillmentAllocationScopeInTransaction derives immutable complete own Allocation/Balance and original Sales Reservation source/four-counter/current-CAS facts from strict persisted IDs on the actual RC caller transaction with fresh operation permission, without writes/domain locks or write authority. A separate lockFulfillmentPickScopeInTransaction locks the COMPLETE existing work after all actual positive-Short RELEASE preclaims and Sales/Fulfillment roots/Lines/Claims/localAllocations: all Item first, then Warehouse/Controls→Bins/binLocks→Lots→existing Balances→all Reservations→all Inventory Allocations. Guard uses SELECT locks only, never the InventoryLockService Control/Balance upserts, and fails closed on missing schema/rows/unknown or incomplete dedicated sources. Existing RELEASE writer only reenters an already-held subset; no new earlier-class keys are acquired. Entirely normal Pick creates no zero command, Inventory operation or scope claim; still verifies complete current owner proof. Exact owner/parent/CAS/source/counter conservation is revalidated under locks and after posting; short quantities release Allocation and Claim active quantities without consuming Reservation, OnHand or SO fulfillment. Do not add ranking/expiry eligibility to Pick. No existing public ABI, write authority, permission, isolation, schema, lock-order exception, quantity limit or20second policy changes.


### TASK019 necessary DRAFT cancellation source proof

Within already approved Claim-only cancellation, InventoryLookup exposes `lockFulfillmentCancellationReservationScopeInTransaction(tx,{warehouseId,salesOrderId,members:[{inventoryReservationId,salesOrderLineId,skuId}]})` for1–5000 distinct persisted members. Copy/freeze the exact positive-ID source scope before authorization await. Validate the entire original SALES/SALES_ORDER source, Warehouse/SKU/Line/purpose, four-counter conservation/current version and positive outstanding through bounded plain reads before any Item/Inventory domain anchor. Then lock existing Item profiles, Warehouse, existing StockControls and PK-ordered Reservation batches; repeat the identical complete source/counter proof and control coverage under locks. This is SELECT-only, creates no Inventory posting/receipt/zero operation and never relaxes the old allocation eligibility reader. Existing archived/nontracked/serial Item or inactive Warehouse does not prohibit releasing only local DRAFT Claims. PICKING/PICKED still require actual Inventory RELEASE writer permission/source/CAS/Warehouse ACTIVE/Stocktake guards. Fulfillment treats impossible owner immutable result identities as one safe critical503; ordinary current counter drift remains a business conflict. This DRAFT source proof does not alter Pick history; Sam separately approved HD019 A for Fulfillment-only forward schema/history correction, with existing Inventory RELEASE contracts unchanged.
## Fulfillment HD020 A additive read contract — actual Sam approval2026-10-26

InventoryLookup.listFulfillmentReallocationCandidates(tx,query) is a separate read-only batch advisory for complete saved PICKING/unpicked work, not an extension/mode of the old DRAFT/independent candidates or a posting interface. Its strict trusted module query binds parent Fulfillment/Sales/Warehouse, complete Lines/Claim/Reservation members and exact old effect IDs/expectedCAS/outstanding, current page/asOf; public clients supply only Fulfillment expected version/page via the distinct Fulfillment GET endpoint. Parent/Item/Inventory anchors and current source/counter proof remain ordered and complete; actual transactionRC metadata and fresh view+operation authority are mandatory.

Independently enumerate every positive dedicated own effect, including unknown/incomplete sources for rejection; prove completed original ownership/exact set and all current Allocation/Balance/Reservation CAS. Derive every legal own unconsumed outstanding credit before querying/ranking/budgeting any member/page. No foreign/consumed/released history credit; credit≤allocated≤OnHand. Reuse owner release-aware eligibility SQL before WHERE/LIMIT/rank so a physically exhausted eligible own Bin can reappear; old expired/inactive buckets can release but cannot be recommended. Shared recommendation budget follows actual FulfillmentLine/Reservation writer order across all preceding members and complete page prefixes, preserving true initial CAS and all existing eligibility/FEFO/FIFO/minimum-life policies. Never simulate version increments.

New candidates explicitly distinguish physicalFreeQuantity, ownReleaseCredit, availableAfterOwnRelease and batchAvailableQuantity. Existing requested/recommended summaries, current Reservation version/baseUom and bounded page metadata retain quantity-only completion semantics. Internal complete release/source facts must match saved local work/Sales proof and are not a public client proof. No DML/upsert/operation preclaim/zero command/audit/receipt/reservation or automatic post. Original independent/DRAFT APIs and all atomic writer contracts remain unchanged; writer rechecks all selection/old/new/source/CAS/exception guards. Applicable inquiry/API P95, actual100Lines5000members, zeroDML/foreign/rank>100/page/shared-budget/eligibility/schema/role/race tests, independent owner review and20000ms/fullP1/currentCI remain mandatory. Canonical Fulfillment HD020 section and proposal44 define the same adopted boundary; HD021/HD022 are separate decisions.

## Fulfillment HD024 — Additive actual-prefix read-only preview owner contract

Actual Sam approved proposal53 A2026-10-26, SHA254b2a0c871990c0e0fd26dc597ed0e3dc25c599a341ca8b6b85624e0aaa0ff6. New InventoryLookup preview method receives only Fulfillment server-derived complete savedroot/Line/Claim/Reservation identities and actual editable selection/reason data after locked Sales/Fulfillment membership validation; public caller identities are selectors, never source/credit authority. Independently verify full current Inventory sources/counters/CAS/status/profile/lifetime and actualRC/freshactor/resource anchors. REALLOCATE independently proves every positive own effect/completed source and derives ALL own credit before selectedClaim filtering; DRAFT credit0, no foreign effects. Old batch recommendation/prepare/write methods and permission/reason checks are unchanged; no bypass flag, event/operation/audit/stock/Claim writes.

Reuse current exported Inventory eligibility SQL and inventoryFulfillmentAllocation assessor with actual quantity/CAS/eligibility-valid earlier choices in true savedLine/Reservation order; selected/current/later choices do not deplete selectedClaim options. Incomplete or stock-invalid earlier prefix explicitly blocks downstream options/assessment rather than substituting defaults. Reason/FEFO deficiencies separately prevent readiness without changing a stock-feasible conditional budget. Complete source/schema/contract uncertainty fails safely503, never partialready.

Canonical publicstrict request/DTO and all responsefields/precedence are defined by Fulfillment03 HD024: one POST allocation-preview,≤100 selectedClaim options plus≤100 Line assessments. Owner options preserve actualphysicalFree/ownReleaseCredit/priorSelectedQuantity/availableQuantity decomposition and genuine initialCAS/ranking. UNKNOWN overrides any unassessable prefix/member, otherwiseFEFO>FIFO>NONE; truefull50legsperLine/5000/allrequestedquantities/stock/CAS/reasons/FEFOpermission are required for canSubmit. Internal source proofs are excluded frompublicDTO. Existing normal-Line unusedreason rejection remains. Frontend never computes eligibility/override/credits or treats preview as a capability; actualwrite revalidates.

Named changes only InventoryLookupService, newinventoryFulfillmentAllocationPreview, necessarysharedreadproof extraction ininventoryFulfillmentReallocationAdvisory/CandidateAdvisory; reuseexisting exportedassessor withoutwriteredits, and onlyreadonlyvirtual-pageadapter export/reuse ininventoryFulfillmentAllocationPreparation ifneeded. No newmigration/reservation/globalisolation/permission or20swaiver. CompletezeroDML/source/prefix/expiry/stocktake/foreigncredit/realCAS/IDOR/nativeconcurrency, actualwriter swap/multiLine-UOM classification, full5000scope native+HTTP/memory/latency, existingABI regressions and exactcandidateCI are required. OnlynamedFulfillmentpreview addsfourth2MiBhandler; otherglobalparser/limiter/100kb/10s policies remain.


HD024 faithful display completion (existing DES-010 §10.3, actual approved A; no new business or writer policy): each selected preview option additionally carries `lotNumber` and `remainingDays`. Inventory alone resolves at most100 distinct nonnull eligible Lot IDs in one bounded parameterized nonlocking read; require exact identity/SKU/expiry coverage and actual nonempty Lot number≤100 Unicode characters. Nonlot =>lotNumber=null; no expiry=>remainingDays=null. Otherwise use existing inventoryRemainingLifeDays with the same captured owner-local date/asOf used by eligibility, including today0/tomorrow1/calendar boundaries. Missing or malformed facts fail closed through the existing dependency/critical contract boundary. Frontend displays these values without expiry arithmetic. Old recommendation DTOs, atomic writers, rank/budget/eligibility/CAS, one read-only POST/fourth2MiB route, all100/50/5000 and10s/20s gates remain unchanged. Independent direction review explicitly classifies this as faithful completion of already-required display behavior under HD024A; exact canonical lineage and final source review remain required, not a new human approval claim.

## DES-011 — Purchasing batch receipt provider

### Decision
PROPOSED，待Sam精確候選批准。正式ABI、可信context、transaction與來源結果協定定義於 [provider v1](implementation/purchase-provider-contract-v1.md) §1–3、5–6；以manifest另行pin該權威addendum。只供Purchasing已鎖定Confirmed PO的批次接入。

### Rationale
整批claims及全域鎖序避免逐行單筆posting的跨明細死鎖／部分效果；分開交易意圖hash與可持久重建的membershipDigest。獨立PHASE007，不以P4完整容量或P5為前置。

### Failure behavior
任一驗證／DB／Audit／caller故障整批rollback，未知commit保留原event查詢；NOT_FOUND不是失敗或另建event的證明。舊入口語義保持。

## DES-012 — Purchasing partial reversal provider

### Decision
PROPOSED，待Sam精確候選批准。[provider v1](implementation/purchase-provider-contract-v1.md) §2–6定義專用partial reversal及link migration；保留舊generic reversal unique，不遷移歷史來源。

### Rationale
原Movement鎖序列化累計反向；獨立append-only link同交易留存原量關聯。PHASE008只依賴已合併PHASE007。

### Failure behavior
超額、allocated／Reserved不足、來源或認證錯誤全rollback。新purchase來源不能fallback generic，舊generic一次完整反向不變。

# TASK-041 latest-main integration and bounded verification — candidate addendum

PROPOSED_NOT_APPLIED. This addendum qualifies DES-007/DES-009 and the existing P4 plan; it changes no stocktake business policy, public Purchasing ABI, production deadline, data scale or acceptance threshold.

## Exact integration baseline and ownership

Integrate main `e6398b70e0ce8d32ccfd036a20ec3f5b04d21df3` into the preserved P4 work, retaining all already-merged Purchasing/Fulfillment/Sales/Item/framework changes. Carry forward the already-approved P4 source, 0065, historical decisions and raw evidence. Do not reset, replace main with the old worktree, renumber a migration, modify Item/framework sources, or reopen delivered provider PRs. Any later main movement is inspected for affected dependencies; it is not automatically equivalent to this exact baseline.

The latest main increment after provider merge changes only CI and the lockfile: body-parser2.3.0→2.4.0, nested content-type2.0.0→2.1.0, qs6.16.0→6.16.1, undici8.11.2→8.12.3, plus the digest-pinned Playwright1.63.0 CI image. Consume those reviewed main bytes without dependency downgrade, lockfile regeneration or CI relaxation. Use a clean locked installation in the integrated worktree; before full load, revalidate affected request-watchdog/body/rejection/absolute-budget behavior through existing small loopback scenarios. Unchanged MySQL/monitor source and its actual dependencies do not acquire a fictitious new native PASS because the global lockfile moved. Current main CI is observed separately; it is not assumed green or reused for a later candidate.

Two overlapping Inventory adapters need explicit resolution: Audit must keep main's `recordSucceeded`, `createSucceededBatch`, current scalar serializer and Unicode reason validation, and add P4's bounded `recordSucceededBatch` using that same validator. Keep P4's at-most100 rows,3200 parameter/1MiB string budgets, affectedRows check and caller-owned atomic transaction. Do not alter either existing provider API, record ownership or flush semantics. SKU lookup must keep P4's exclusive raw code/barcode input and barcode limits, but consume main's single current Item lookup result/UOM projection rather than taking a second potentially stale profile read. Do not restore redundant `FOR SHARE`. The merged source sketches are supplied separately; implementation remains subject to TDD and final exact-source review.

The client error map is an additive union only: keep every current main translation and P4's two approved lookup translations. All other incoming dependency files are main bytes, not new implementation scope. Update the consumed Item pin to the exact main source and retain the merged purchase-provider1.1 contract pin without editing those providers. The source-pin reconciliation map distinguishes incoming main bytes, unchanged P4 bytes and the two explicit overlapping adapters; no blanket unfreeze is granted.

## Verification semantics and evidence

Before changing code, record the affected source/dependency/command/environment/validation semantics and the smallest disproving check. Test tooling first uses deterministic tests and fresh minimal MySQL scenarios; the full5-warehouse/1000-bin/100k-SKU/500k-bucket/2M-movement fixture is reserved for actual capacity/coexistence/soak checks. A supporting probe is not a replacement or PASS for CP01–15, CS01 or a mandatory suite. CP10 retains HD219's fixed1000ms admission, its original absolute sampling/terminal deadlines and FAIL/UNKNOWN treatment for dispatched failures. Its nonperiodic admission is not the CSV/CS01 1Hz contract.

Keep original evidence bytes, hashes and applicability identities. Confirmed unchanged dependencies/commands/environment/semantics retain their original historical applicability; do not edit old source/PLAN identities, treat them as current candidate runs, or fabricate a generic gate adapter. Documentation-only or unrelated main changes do not trigger repeated full-load debugging. After the final integrated candidate is frozen, execute every required final suite, native coverage/floors, real Playwright/CLI, current-candidate CI and actual review. If an adapter still cannot represent a necessary check, report it BLOCKED rather than exempt it.

HD209's three real100k Post successes remain source-bound historical evidence, not this candidate's PASS. The interrupted HD219 fixture setup with cases=[] remains an environment/tool failure with unproven connection-loss cause. The2026-10-26 minimal native monitor probe4/4 only proves its stated completion/error/timeout/socket/SQL-terminal boundary. No operational DB tuning, larger timeout, reduced fixture, skip or renamed failure is authorized.

## Real downstream-writer joint regression

Add one dedicated unit compatibility suite(min10) and one dedicated real MySQL joint suite(min12), zero skips. Keep all54 original P4 developer suites, append the10 current-main purchase suites and these2 suites:66 final groups. No formal TC/UAT is marked executed. The real joint suite uses actual Stocktake Start/Cancel/Post and actual merged Purchase/Fulfillment/Reservation providers, not a fake stocktake-lock service. Test-only owner fixtures may create valid synthetic owner documents but cannot replace Inventory execution or prove Purchasing production adoption.

Joint cases cover receipt/reversal blocked by real started-bin locks, multi-detail atomic failure, both directions of Start/writer serialization with independently observed lock wait, current Reservation/Allocation/Post protections, true Fulfillment Issue blocking, and own/foreign-lock cancellation/retry. The plan specifies independent persisted-row/original-result/rollback oracles. Main's generic full-reversal, cumulative partial limits, fresh auth/device/replay and transaction ownership remain unchanged.

P4 numeric resource/write gates, target-filesystem compatibility, production empty-metadata handling and shared ServerResponse warning remain explicit open conditions. Characterization/soak measurements alone cannot satisfy still-unapproved numeric gates. Opening/P5 actual writer evidence remains P5, not a fake P4 PASS. No deployment, formal acceptance, evidence export or unseen-source approval is granted.


## HD221 — current-main Item scalar adapters and legacy fixture compatibility (PROPOSED)

This exact supplement supersedes the HD220 byte-immutable guard only for the ten paths in the accompanying fixture compatibility mapping; it is not adopted until Sam approves the exact candidate. All remaining P4 and incoming-main pins remain binding.

Only the two scalar getInventoryProfileInTransaction adapters in Stocktake Post and addLine pass the actual caller transaction directly to the current immutable Item provider. Item itself owns discovery and ordered UOM/Item/SKU/mapping fact locks; Inventory must not append another FOR SHARE. The greater-than100-SKU findMany executor, Inventory global lock order, actor current reads, auth/replay, full rollback, snapshot/allocated/final Reserved guards and every deadline remain unchanged. No Item/provider/shared framework or migration source changes are permitted.

Legacy test-only compatibility consists of exact current-main scalar Audit SQL whitespace, a pure unit catalogue reflecting Item's actual five scalar queries with one lock clause on each fact read (and unchanged two-query bulk path), and six native minimal fixtures with the existing Item version columns/default1 and explicit original four-column Item inserts. Current Item's empty-UOM error reason is asserted separately from the Inventory bulk projection reason; the public error code and rejection remain. Preserve all other business/failure/rollback assertions, case counts, synthetic rows, runtime guards, data volumes, permissions, source ownership and time limits. This is not a production DDL migration or a policy to accept duplicate lock clauses in a fake.

Small deterministic and native checks precede capacity. The complete final66 groups, current39 coverage floors/global floors, actual Playwright/CLI, current-candidate CI/latest-main integration and final Sam implementation review remain mandatory. Old source PASS and prospective scratch previews cannot satisfy current candidate Gates. HD209's three real100k successes remain historical; TASK041/P4 numeric gates, target filesystem/metadata operations and shared warning remain open.


## HD225 — Stocktake export failure Audit independent bounded lifecycle (PROPOSED)

This supplement qualifies DES-009/DES-010 only. It is NOT_APPLIED until Sam approves its exact DESIGN/PLAN. HD224 established that a real client-close signal aborts ROUTE failure Audit acquisition, returning false while the database remains healthy. Keep the strict CS01 false/unknown/missing-evidence failure rule and the existing DOMAIN/ROUTE attribution; do not accept missing rows or retry until green.

### Ownership and trust boundary

Use one Stocktake-export-local factory/facade around the unchanged InventoryAuditService. Bind it only to InventoryStocktakeExportService.audit and the export handler's audit instance. All non-export handlers and the shared Audit implementation remain unchanged. recordSucceeded keeps its actual caller-owned transaction, original cancellation and return semantics. Only recordFailed/recordRejected receive an independently owned cancellation lifecycle. This permits a security evidence INSERT after client disconnect; it grants no Inventory read/write permission, creates no new download, and never resumes the original export or business transaction.

Capture the existing internally constructed scalar Audit input synchronously before asynchronous work. DOMAIN retains the validated actor/username, positive stocktake ID and stocktake:<id>; ROUTE retains its existing nullable actor, user:<id>/unavailable label, NULL target ID and exact route template. Preserve action, outcome, request/correlation, IP, reason and summary serialization/limits. Do not retain req/res, JWT, passwords, raw request bodies or arbitrary Error objects in an owner registry. Never detach or mutate the original request/context signal, deadline, claims or transaction; those remain cancelled. Do not add fresh authorization to the failure evidence path, which must also record an authorization rejection.

### Absolute budget and bounded admission

Propose a fixed 5000ms monotonic absolute budget for EACH independent failure/rejection Audit attempt, starting before admission/connection acquisition and never renewed for BEGIN, INSERT, COMMIT or fallback logging. DOMAIN and ROUTE remain separate transactions/attempts; sequential failure handling can therefore consume up to two such budgets (10000ms total), even after the original client disconnect. This is a new internal failure-evidence grace policy requiring explicit Sam approval, not a larger HTTP deadline or a write-success SLA. Original SQL10s/transaction20s/HTTP30s/CSV120s and all test/coordinator limits remain unchanged.

A WeakMap keyed by the actual borrowed primary database instance admits at most ONE active independent Stocktake export failure Audit per process/service. DOMAIN and ROUTE factories share that slot; no queue, new pool, reader/client, retry, outbox or persistent job is added. Busy/closed-primary admission returns false with a safe bounded diagnostic, without issuing SQL. This conservative bound can fail strict Gates during simultaneous failures and is an explicit availability trade-off, not permission to classify those failures as PASS. Other Inventory Audit/business transactions and primary pool size/queue configuration are unchanged.

Each admitted attempt owns a new AbortController, timer and the original Audit completion promise. Its database facade dynamically calls the live primary.withTransaction(work,{signal:ownSignal}) synchronously before the first await, retaining the original callback, transaction and default timeout options. Never capture an earlier uninstrumented method, pass the aborted parent signal, clear the shared context, replace a prototype, or create a new service container. This preserves the existing CS01 synchronous independent-Audit-to-transaction association without changing the observer/oracle.

An attempt can return true only when the unchanged generic Audit promise positively returns true BEFORE its absolute deadline. At expiry, abort only its own database operation, return false, and preserve the original export/handler error; do not throw a new Audit error over that error. A late true cannot revise the public false. A database/validation/logging failure or explicit indeterminate commit remains false/UNKNOWN, with no automatic retry and no assertion of rollback. Failure diagnostics retain safe stage/code/request identity and commit uncertainty; never log credentials or claim persistence from an INSERT callback alone.

The budget bounds the awaited Audit method including a stalled logger. A timed-out method does NOT free the slot merely because a timer, driver callback, AbortController or Promise.race completed. Keep the owner quarantined after ANY admitted false, timeout or uncertain commit, EVEN IF the original Audit promise later settles; consume all late rejections. Only a positively committed true BEFORE the deadline releases admission. Generic false settlement is not a reliable acquisition-terminal receipt: the existing pool may still retain its pending waiter. Do not reopen admission based on that settlement, a later true or test-side terminal observations. Recovery of this quarantine requires a controlled process restart; no automatic reset API/service recreation is introduced. Once the original promise settles, release its captured work/input references but retain the small safe quarantine marker. This bounds retained unresolved Audit work/pool acquisition at one per primary instance; even a transient admitted failure can disable subsequent failure Audit until process restart. This availability cost is explicit and requires Sam disposition. Only owned timers/listeners are removed; never destroy another pool borrower's connection. Late acquisition must execute no Audit callback/SQL after cancellation, and its actual return/destruction must be observed separately in native tests. Public bounded return, original promise settlement and independently proven SQL/socket termination are distinct facts; missing terminal proof remains UNKNOWN.

### Shutdown and unchanged evidence rules

Borrow the primary database/logger/time; do not acquire ownership of them or shut them down. Refuse new attempts when the primary reports closed. Already admitted work keeps its original 5s budget; the existing application shutdown may close the pool before that Audit persists. No shared shutdown/drain hook or larger process grace is introduced and no shutdown persistence guarantee is made. After the deadline, safe process recovery may still be needed for an unproven owner. The existing process/SQL cleanup Gates remain exact and cannot treat unknown work as stopped.

Keep DOMAIN failure memoization, handler WeakSet attribution, SUCCEEDED transaction behavior, original action/error ordering, reader/anonymous-file ownership, per-chunk authorization, zero prefetch, CSV headers/budgets/100k cap, and all stocktake/provider quantity/lock/replay semantics. CS01 still derives its exact row multiset from independent lifecycle/transaction events; false, unknown commit, missing event/row, duplicate target or wrong identity is FAIL/INCOMPLETE. No observer/oracle/frozen helper change is included.

This change does not guarantee persistence during database outage, admission saturation, shutdown or commit uncertainty, or guarantee CS01 passes. Preserve all failures and source-bound HD209/current characterization three-round100k successes; none is a new candidate or CS01 PASS. Full frozen-candidate Gates, 39 coverage floors/global92/83/90, real Playwright/CLI, current-candidate CI/latest-main and Sam final source review remain mandatory. Full-load execution remains separately stopped pending an explicit later Sam decision.


## HD227 — Developer performance failure stops further workload (PROPOSED)

This supplement qualifies DES-010's developer verification only. Sam HD226 authorized one original-condition full LOCAL Gate and immediate stop on any performance failure/timeout; no lowering data, case count, offered-load minima, authentication, deadline or threshold. Current Node26 JUnit reporter buffers case results until the entire test file ends; Characterization registers later cases regardless of an earlier case failure, and CS01's failed() records firstError while both offer loops continue. These source-observed tool contracts do not implement that stop directive. Do not start the affected capacity/soak suites until this exact amendment is separately adopted.

### Stop semantics, successful runs unchanged

Characterization gets a module-local registration wrapper around the original node:test call. Preserve every original15 case name/order/options/callback body and global after/fixture.close. On the first synchronous throw or asynchronous rejection, retain/rethrow the exact original error. Also latch runner-owned timeout/cancellation through the actual test-context signal while its callback is still pending; distinguish normal post-callback completion abort from failure so a healthy first case never blocks later cases. Do not replace the runner original timeout result or claim that an aborted still-running callback has stopped. Remaining callbacks stay blocked until original owned work/SQL has independently settled or the existing coordinator retains UNKNOWN. Every later callback is NOT_RUN_AFTER_PRIOR_GATE_FAILURE, uses the runner's explicit skipped/not-executed outcome and executes no test body/SQL/HTTP/fixture mutation. Never erase registration, replace the first failure, mark blocked cases PASS or count them as executed. Original min15/maxSkipped0 remain: the failed prefix plus unexecuted remainder cannot PASS. A healthy run still executes all15 cases and original full workload; cleanup always runs independently of the stop flag.

CS01's first-error handler synchronously closes admission on its existing lane. The lane itself must latch and synchronously notify its first unexpected preparation/sign/send/complete error BEFORE rejecting the work promise; do not rely on the later outer row.pending.catch microtask. External producer/minute-check failures also latch the same stop state synchronously. A competing already-prepared signer must see the latch before it can dispatch. Notifier/cleanup failure cannot replace the original first error. Guard the warmup/steady producer before and after every timing await, and guard the lane at offer entry and immediately before real fetch after all async preparation/signing. Already-prepared but not dispatched work cannot refresh, sign anew or issue HTTP after the first failure becomes known. Work already actually dispatched keeps its original request/JWT/transaction deadlines and must settle as observed, never be relabelled NOT_SENT or assumed rolled back. Completion callbacks may record actual outcomes of in-flight work, but cannot begin the next workflow. No automatic retry, new timer budget or second actor turn is added.

Record first failure identity/code/hash/stage/time, the actual offered/dispatched prefix and the exact remaining unoffered planned warmup/steady denominator (1920/28800 respectively); report stopped/unexecuted work explicitly, never fill a missing interval with fake completed offers. Pending offers rejected before dispatch receive an explicit run-stopped disposition tied to the original intended actor/family/tick. Successful runs retain original125ms/62.5ms pacing, 20actors, all offer/failed/busy/not-sent denominators,600/1200 refresh policy, first-byte abort ratios, full1800s steady and all original count/latency/auth/resource/atomicity/minute/final-oracle assertions. The stop state must not affect the normal Characterization/preparation paths or revive a quarantined worker.

After failure, stop only new load. Bounded settlement/diagnostic and exact owned cleanup remain necessary; use the original <=180s drain allowance once, clipped by any earlier existing drain deadline and original2700s outer gate. Never start a fresh180s for a later cleanup error, extend HTTP/SQL/transaction/CSV limits, or imply OS/socket/SQL termination from cancellation. Keep the exact first error even if cleanup also fails; preserve unknown commit/SQL terminal/ownership as FAIL/UNKNOWN. Existing fixture.close/worker stop and global native coordinator recovery requirements remain, including no unauthorized business retry. Interrupted30-minute runs are FAIL, never partial capacity/soak success. Test-injected expected fault cases that PASS their existing oracle do not trip this first-unexpected-case-failure guard.

### Narrow developer-only boundary

Only performance helper createStocktakeSoakLane and runStocktakeResourceSoak, Characterization's import/registration wrapper, and one new fail-fast unit file are in scope after adoption. All15 Characterization callback bodies, CS01 test entry/catch/finally, its37 existing support checks, audit oracle, Item/provider/product/auth/DDL, all legacy frozen helper components/other helper bodies and every existing suite definition remain unchanged. No reporter/argv/env change is required for either original performance suite. Add one DEVELOPER-only12-case zero-skip unit Gate, so all original68 mandatory groups remain and total becomes69. Formal TC/UAT,39 coverage floors/global92/83/90, true Playwright/CLI, current CI/latest main and final Sam source review remain.

### Coverage dependency order, no threshold change

Keep the original inventory-p3-server-coverage command as unit-only evidence; it is not the final native/global coverage verdict. The actual current full-native coverage collection must complete before copying its exact source-bound LCOV to the existing ignored default path and running the unchanged39-floor command/global92/83/90 checks. Record provenance/hash and native guarded cases as NOT_RUN; separately required native groups still need zero skips. A partial unit LCOV below global native targets is an incomplete collection, not a reason to lower targets or relabel its tool assertion as a final Gate PASS. Defer the dependent floor until its actual input exists. No new coverage collector argv/env or generic Harness adapter/baseline bypass is authorized by this amendment; unavailable valid input keeps the Gate BLOCKED.


## 10.6.11 P4 developer evidence binding adapter — HD228 candidate

### Purpose, scope and unchanged controls

PROPOSED_NOT_APPLIED. A project-scoped, read-only attested adapter may be adopted only after Sam approves this exact DESIGN/PLAN. It applies solely to Inventory PHASE-005's complete merge group. It is not a generic Harness modification or a release/formal acceptance gate. Installed Harness scripts remain byte-identical and their audited hashes are pinned; unknown versions/issue codes fail closed. Preserve and display the unchanged generic MERGE_READY result, including its binding failures. Never claim it passed if it did not. The adapter's distinct result is INVENTORY_PHASE005_MERGE_READY / BLOCKED.

Every original69 developer suite object/order, test/assertion, fixture/data size, threshold, timeout, auth/transaction/rollback policy, coverage collection/floors/global limits, Playwright/CLI, current-candidate CI, latest-main integration, independent review and final Sam exact-source review remains mandatory. Add only32 deterministic adapter unit cases and4 minimal true MySQL26.7/resource cases, both zero skip; total71 groups. No formal TC/UAT or product/provider ABI changes. The existing required Lint CI job additionally executes the new deterministic adapter tests; no required job or protection is removed.

### Preserve raw truth; applicability is not a new test execution

Never mutate, copy/relabel or normalize an original run's runtime/source/PLAN, times, outcome, counts or artifacts into a purported new execution. Keep original reports, failures, unknowns and hashes at original paths. A separate applicability proof identifies original raw run, actual tested source/PLAN/runtime, current candidate identities, exact unchanged suite contract and verified input/resource proof. Its label is APPLICABLE or NOT_APPLICABLE/UNKNOWN, never newly executed PASS. The final gate can be satisfied only by actual passing required cases plus proven current applicability. Missing proof/unexecuted required cases remain BLOCKED.

Classify every later actual attempt of the same module/suite/stage before selecting a prior PASS: proven equivalent participates in latest-attempt selection; only positively proven non-equivalent attempts may be excluded; unresolved equivalence of a later attempt blocks that suite. Select by the original actual end time/order, not whichever is green. A later equivalent FAIL/timeout/skip/not-run/unknown cannot be masked, and an earlier applicable PASS followed by a later FAIL with incomplete equivalence proof is BLOCKED. Unknown equivalence never makes a PASS applicable. Do not reuse old CI, PR/source/human review or business/release observations across candidate identities: those retain the original exact current-commit requirements.

### Narrow PLAN/source equivalence

For the original69 only, administrative adoption of this exact Gate-only patch can be recognized when all original suite objects, authority/test/data/command/environment/validation meanings and executed product/test/dependency bytes remain identical. Record before/after full source maps including file modes/symlinks, exact canonical patch and approval references, and hashes of Node/MySQL/Harness plus external input/data receipts. Also pin the actual script/data/document inputs excluded by the generic fingerprint, including the two HD227 before-source fixture texts; identical global source fingerprints alone cannot establish this input closure. The current source956a8611 full map, original34 actual passing groups and originalPLAN44f7a236 remain historical evidence, not current candidate test runs.

The only initially proposed source exceptions are the three new standalone Gate-tool paths and the exact added CI unit-test step listed in TASK-041 HD228. They are not imported/executed by the original69 local commands; new CI itself must run on the actual new head. This must be checked against the actual commands/dependencies, not assumed from file extension. New adapter unit/native proofs cannot use these exceptions for changes to their own source: they require their exact current code/tool pins.

Foreign-module documentation or an unrelated main change is not blanket permission to reuse evidence. Reuse requires a separate exact per-suite input/dependency proof, actual full before/after source-map delta, unchanged command/environment/data/semantics and real independent review of that scope. No unknown dependency may be omitted. An unproven or affected input requires that affected suite's actual rerun; do not mechanically rerun unrelated full fixtures or pretend an old-source run was executed on a new candidate. External/advisory inputs without immutable equivalence proof require fresh relevant checks. No product Post/lock/Audit/shared-transaction change is an administrative exception: include its affected atomicity/rollback/concurrency/capacity checks.

### Per-run runtime proof, no fictitious shared identity

Different genuinely isolated per-suite runtimes are acceptable only with their own actual owner/resource bindings and positive completion proof. Validate each raw runtime against its own immutable receipt, never against an invented shared label/current idle runtime. Require exact workspace/source/tool/data/command bindings; actual private schema/socket/datadir/port/file-root/PID/incarnation ownership; original deadlines; worker/socket/SQL/transaction/lock terminal proof where used; schema deletion, normal shutdown and precise directory cleanup. A driver callback, destroyed flag, cancellation or empty table is not terminal/rollback evidence. Unknown ownership/commit/cleanup stays BLOCKED. A stopped runtime is historical and must never be represented as live to satisfy a missing resource field. Before any new execution reserve and verify a new actual runtime normally.

The known FILES-only runtime4f5df5186756 is a narrowly disclosed recovery disposition:33 typed actual exits0/source/dependency hashes matched, original outer UNKNOWN/FAIL from PASS_23-versus-PASS_33 label mismatch retained, independent recovery verified zero SQL/trx/locks, own empty schema dropped, original daemon/socket/FD gone and exact root removed. Sam's adoption may authorize applicability of those FILES results using that exact recovery proof; it does not relabel original cleanup, claim daemon exit0 or application rollback. No native/performance UNKNOWN receives this exception. Historical HD209 successes keep their original identities.

### Boundaries against bypass

Call the original generic gate read-only and retain its complete result. For every selected historical raw run that the generic baseline filter did not visit, also call the original evidence_issues against the unmodified current Context and actual current suite contract; preserve and satisfy every original integrity, command/cwd/tool, report/count/case, time, environment/data and artifact/path check. Do not construct an altered Context or skip this direct validation. Resolve only exact per-required-suite binding issues (EVIDENCE_RUNTIME, EVIDENCE_SPEC/EVIDENCE_SOURCE or REQUIRED_RUN_MISSING caused solely by the above proven administrative mapping) and validation-only RUNTIME_RESOURCE caused by honestly closed, positively verified historical runtimes. Each resolution needs its specific applicability/resource proof. Never blanket-filter codes or tolerate a truly missing run. Reject unrecognized issues and every unresolved issue.

All other original controls remain blocking: current design/PLAN/human authority and actual provenance, module boundary/complete merge group, task DoD, frozen/clean candidate, current default/main integration, raw report integrity/counts/latest failure, all required scopes and zero forbidden skips, actual full-native coverage input plus39floors/global92/83/90, real Playwright/CLI, exact current-head mandatory CI and final independent Sam source review. No missing run, failure, insufficient discovery, missing formal authority or absent CI can be converted through this adapter. Its positive unit fixtures are explicitly synthetic verifier tests, not actual Inventory readiness or acceptance.

### Small verification then remaining original workload

Before adopting/executing any new full load, finish the current frozen Characterization and its exact cleanup. First TDD the32 adapter boundaries (at least8 positive/24 rejection cases) including tamper, latest-failure, missing data, wrong runtime, unsafe state and unchanged-scope versus affected-source controls. Then4 small true MySQL/resource cases exercise actual positive ownership/termination, active or foreign/unknown resource rejection, identity mismatch and precise own cleanup. No Inventory full fixture is needed to debug the adapter.

After those pass, recompute applicability of the original current34 real groups without rewriting them; run every remaining required original suite and the2 new checks. Continue the original once-authorized CS01 only if current Characterization PASS, no unresolved performance failure, all small checks PASS and Sam adopts this candidate. It is not permission for another Characterization or failed performance retry. Any performance Gate failure/timeout stops new load, preserves evidence and exactly cleans; another cycle requires Sam's disposition. No GateReady/DONE/P4/publication/merge/deployment approval arises from candidate adoption or small tests.


## 10.6.12 CS01 supporting-preflight compatibility and dependency-proof integrity — HD230 candidate

This test-only supplement requires Sam's exact adoption. It unlocks only the existing CS01 performance test's signing-rejection supporting oracle and failure-reporting prefix; no product/helper/other supporting case or native workflow changes. The already approved fail-fast lane preserves its first signing rejection and admits no later request. Its matching oracle must require NOT_SENT_BUSY/RUN_STOPPED, zero sends, one rejected preparation request, both intended offers retained and empty settled pending/busy ownership. It must not restore post-failure sending to satisfy the old expectation. Keep all39 supporting checks and all original native cases/data/rates/deadlines/zero-skip rules.

Before any native fixture import/preparation, supporting failure records its actual structured results (or explicit INCOMPLETE/null when it rejected before aggregating results) and safe scalar actual/expected values in its own unique HARNESS_RUN_DIR, then throws the original error. Reporting failure attaches a safe diagnostic without changing that original rejection. The coordinator may classify only this positively sealed pre-native branch as NO_NATIVE_WORK_STARTED, while preserving typed FAIL and independently verifying all owned process/SQL/schema/socket terminal facts before cleanup. Missing, unknown or after-start worker evidence is never converted to that branch or to PASS.

The new installed-dependency review finding is not an observed product or dependency mutation. Git source maps and equal package-lock files do not prove equal ignored installed bytes. The Gate verifier must not hard-code dependency_complete/immutable without a verified actual input receipt. Until complete historical/current proof exists, affected applicability is UNKNOWN, while original execution PASS/FAIL and all artifacts stay unchanged. Capture actual relevant installed package/tree/symlink/tool identities before and after new runs; never manufacture a past dependency snapshot from current files. Any suite-specific non-executed-test-source projection must be independently justified; this one CS01 test correction is not a blanket equivalence exception.

Keep the explicit no-repeat instruction for already successful Characterization. Its historical15PASS/three100k success and positive cleanup remain facts; missing dependency applicability evidence is a separate final-Gate blocker, not a failed100k or permission to substitute a smaller case. Adoption of this supplement does not waive the missing proof or authorize a Characterization rerun. If the evidence cannot be found, final readiness remains blocked and must be disclosed.

After adoption, first verify all39 deterministic supporting checks including a wrong-lane mutation, the reporting/original-error boundary, current32+4 small checks and actual receipt/input proof. Only on small PASS/no unresolved material difference may Sam's explicit disposition allow ONE original-condition CS01 retry and remaining original checks. Any performance Gate FAIL/timeout again stops new load and preserves exact cleanup; no automatic fix/retry. Original71 groups, full5warehouse/1000Bin/100kSKU/500kBucket/2M Movement baseline,20actors/30minutes,2700/7200seconds, original SQL10s/transaction20s/HTTP30s,39floors/global92/83/90, real browser/CLI/current CI/main/final Sam source review remain mandatory. No Task/P4 completion, numeric acceptance, publication/merge or deployment follows from candidate approval.


## 10.6.13 Stocktake Draft Create lock-footprint candidate — HD231

PROPOSED, not product implementation or new Gate PASS. A real small MySQL graph reproduces Create's scope INSERT1213: Create owns an empty-match active-lock index gap and waits for scope supremum; another Warehouse's Start owns scope supremum and waits for that active-lock gap. Original CS01 has the matching victim SQL/error, but its peer/graph were not retained. Never claim the exact original rival or all possible deadlocks are established.

Add only the narrow InventoryLockService.lockForStocktakeDraftCreate(tx,{warehouseIds,binIds},writeDraft) entry. Normalize/sort/dedup IDs by existing rules, require one warehouse/nonempty bins/function and the existing caller-owned executor; lock existing Warehouse and Bin rows in original order using existing helpers. Call writeDraft exactly once in that same tx with the actual locked rows. This callback validates active Warehouse/Bins/membership, current unfinished-Draft scope exclusion and before-write current actor authorization, then inserts the header and ALL scope rows. After all these writes, run the unchanged lockActiveBinLocks query for ALL requested Bins, preserving its compatibility/error behavior; reject any active lock. Return the draft/locked data only for the service's remaining checks. No separate connection, new transaction, commit, auto-retry, generic skip/defer flag or configurable hook in the existing lockForCommand API. Existing lockForCommand and all its other callers remain unchanged.

Only StocktakeService.createInTransaction adopts that entry. Keep context validation and source-operation claim before business locks, original replay/current-auth behavior and all metadata/number/scalar/Audit contracts. Preserve before-write current authorization; recheck current authorization again after the final active-bin-lock read/wait before Audit and operation completion. A required check failure rolls back the original claim/header/ALL scopes/Audit/completion as one atomic tx; a rejected active-lock check may follow uncommitted inserts, never a committed Draft or external receipt. Sequence all scopes before the check, never insert/check per Bin. This deliberately changes metadata-write versus active-bin-lock-read timing, not isolation or locks retained through commit. The new path temporarily holds insert locks earlier and adds one current auth recheck; failure ordering for SQL versus a late lock check can differ. No promise all cross-Warehouse waits/deadlocks disappear, and no capacity success claimed.

Retain REPEATABLE READ, original global shared-command lock order and every existing lock/protection outside this explicitly scoped Draft path. Inventory bin row locks still serialize same-Bin Start/other writers; unfinished-Draft and persistent-lock rejection both remain. No plain RR read, SKIP LOCKED, weaker absence oracle, lost active-row check, Warehouse sentinel/global mutex, DDL, Item/auth framework rewrite or retry policy. Post/Start/Count/Ready/Cancel/Receipt/Reversal/Reservation/Allocation/Move/shared transaction code remain byte-identical.

Before implementation, Sam must adopt the precise candidate. First TDD twelve dedicated unit and fourteen small real MySQL cases, zero skip: preserve original cycle evidence, show fixed positive transactions and negative locks/rollback/auth/replay, retain foreign state and actual cleanup. Existing test bodies/assertions and helpers stay unchanged; the one explicitly listed old unit fixture adds the new narrow lock entry interface, preserving its existing fake state/lockCalls/overrides and simulating callback-before-active-check. No product fallback to old lock API. Add two dedicated files. Suite additions use the exact profile commands/env/minima; all original71 objects/order and requirements remain, total73. No full load for tool debugging.

After small checks, evaluate evidence applicability suite by suite on actual code/dependency/command/env/semantics. A changed source pin is not equivalence: original Characterization/Create-path evidence and Post successes stay historical, affected Create/concurrency evidence cannot become current PASS. Keep the no-Characterization-repeat instruction and historical installed-input proof gap; if new final Gate cannot be demonstrated under these constraints it remains BLOCKED. This candidate does not waive that issue or authorize another full CS01/Characterization. Full final Gate/coverage39floors/global92/83/90, real browser/CLI, current candidate CI/latestmain/final Sam source review remain mandatory. Original5Warehouse/1000Bin/100kSKU/500kBucket/2M Movement/20actors/30minutes, timeouts and fail-fast/drain/cleanup rules remain unchanged. No Task/P4 completion, formal acceptance, publication/merge or deployment approval follows.

## 10.6.14 P4 concentrated Gate evidence completion — HD233 candidate

PROPOSED_NOT_APPLIED. This supplement supersedes only the obsolete fixed-HD230 adoption/receipt-collector restrictions in sections10.6.11–12 and their TASK041 plans; all substantive evidence, protection and completion controls remain. It is a read-only Inventory PHASE-005 developer adapter, not a Harness modification, product change, acceptance gate or permission to execute load. Canonical adoption needs Sam's actual exact DESIGN/PLAN decision. Preserve the unchanged generic MERGE_READY output and emit the distinct INVENTORY_PHASE005_MERGE_READY only when every remaining control succeeds. Otherwise emit BLOCKED with per-suite reasons.

### Exact source, PLAN and attempt applicability

Keep the historical956a/44f7 runs, the HD231 a1a3109e/4101de16 six typed runs and future candidate runs as different actual executions. Never rewrite raw reports, hashes, counts, outcomes, source/PLAN/runtime or their FAIL/UNKNOWN. The HD232 Sam review covers only its seen five-file source increment and SELF disposition; it is not future Gate-tool source approval or P4 completion. Load the original full observed source maps and verify their digests against raw fingerprints. Require exact adopted canonical patch/pins and actual approval/reviewer references; data files do not authenticate humans or CI.

A narrowly reviewed administrative mapping from the HD231 six-run baseline to this Gate-only candidate may disregard ONLY the exact three Gate-tool paths, and the four declared canonical changes, when those six suites' complete original/current contracts and actual execution input closure are proved unchanged. The profile delta is solely the Gate unit minimum32→48; its six other suite objects remain identical. Actual producer source must establish that the six Node suites do not import/execute the Gate tools. Producer snapshot reads of those tools/profile are explicitly observational inputs, not falsely claimed byte-identical execution inputs; record their full before/after delta and reviewed role. Any additional product, test, executable dependency, mode, symlink, data, argv/env or semantic difference blocks that mapping. No transitive or prefix/directory-wide exception and no a1 product-lock change projected away from older956a runs. Adapter unit/native tests require exact current tool/source/PLAN inputs; Lint, broad discovery and advisory audit may consume changed files and cannot borrow the six-run exception. Independently proved unrelated documentation/main changes still require exact per-suite input/contract/dependency proof and real scope review; they are never blanket administrative equivalence.

For every required suite, inspect all actual registered attempts, using original actual end order. A later equivalent FAIL/timeout/skip/not-run blocks an older PASS; unresolved later equivalence also blocks it. Exclude an attempt only on positively complete non-equivalence proof, not missing maps, missing dependencies or a convenient label. Preserve the original direct evidence_issues call with the unchanged current Context/suite/raw. Resolve only existing exact binding issues and honestly closed-resource findings with their specific proved applicability; unknown/unrelated core issues, task DoD, dirty/scope, CI/head/main and final source-review requirements remain blocking.

### Real receipt recipes, complete input closure and bounded read-only preflight

Receipts are original local observations, not a supplied approved:true bundle. For each supported recipe read its exact pinned original producer bytes, typed-run bytes/artifacts, full source/spec snapshots, actual executed Node/Python/MySQL/Harness identities and installed tree/package/mode/symlink/resolved-target input observations. Before/after equality without complete enumeration/known resolution is insufficient; missing, unreadable or unsupported runtime/dependency identity remains UNKNOWN. The six HD231 archives contain actual installed Node input observations, but do not by themselves capture historical external Harness scripts/schemas, Python dependency closure or PATH resolution of the Harness node/mysql executables. Those exact missing facts remain UNKNOWN unless separate original evidence exists; current HARNESS_PIN or binaries cannot repair them. New small runs must capture before/after actual Harness script/schema bytes, interpreter/runtime imported-input closure, effective allowlisted executable resolution including symlink targets, and the real producer/source inputs; no secrets/env dump. Package-lock, today's installed files and state booleans cannot manufacture a historical snapshot. Hash/path checks prove integrity, not independent truth; Sam's actual provenance/final review and external CI checks remain separate.

First support only (1) the three exact archived HD231 producer recipes and their six actual runs pinned in the candidate receipt inventory, (2) the existing Gate minimal-native recipe plus the actual reviewed private outer runner/cleanup producer captured before its execution, and (3) existing historical recipes under their original restrictions. No arbitrary receipt schema/producer becomes trusted from a status string. New unrecognized producers remain BLOCKED, with one consolidated missing-recipe/input list before any execution; no generic runner or new receipt-normalization framework is authorized. The historical FILES recovery remains limited to its actual33 receipts/exact recovery, never native UNKNOWN or application rollback. Historical installed-dependency gaps remain UNKNOWN; no Characterization repeat or waiver.

HD231 in-process Node suites have no application IPC worker. Validate their actual Python Harness runner, Node process/group completion, command/JUnit/hash binding, shared runtime's earlier unitEvidence and later native typedEvidence, positive other-connection/transaction/owned-lock zero, normal daemon exit0, socket/schema and exact directory cleanup. A unit may use that same runtime's final successful cleanup receipt, but must bind its own earlier command/run/hash and the entire encompassing time interval. Do not demand a fabricated StocktakePerformance child report from a direct suite. Original optional draft-lock-range report lookup ENOENT for036/038 remains in the original observation; admit it only after exact producer/source proves it is the wrong optional filename for those direct suites and independent real runner/terminal facts remain complete. Missing required artifacts or any actual ownership/SQL/cleanup uncertainty still block. Performance recipes retain their full worker-incarnation/connection/transaction-history/statement/wait proofs; direct-suite rules cannot weaken them. Callback/destroyed/cancel/empty-table/PID absence alone proves neither terminal nor rollback.

Add only the read-only CLI mode --receipt-preflight with repeated --suite restricted to the candidate's six HD231 suite IDs and two Gate-tool suite IDs. It reads the real current repository/module and registered evidence (allow registry/raw-identity discovery, then ALL registered attempts for at most eight allowlisted selected suite IDs and their referenced proofs, not just one chosen raw per suite), invokes the original direct validator, applies the same source/attempt/resource rules and returns RECEIPT_PREFLIGHT_PASS or BLOCKED; it never emits MERGE_READY or suppresses aggregate remaining blockers. It accepts no external approved JSON, alternate Context, state edit, execution or cleanup option. Default full Gate still runs and preserves the original aggregate gate; preflight is a small collector check, not a substitute.

### Native coverage provenance, not a lower coverage gate

Replace the unconditional provenance blocker only with actual complete proof, never deletion/bypass. A coverage record must bind the original full-native producer execution's source/commit/tool/config/installed inputs and unchanged collection command, all expected input parts, complete start/end/exit status, raw V8/LCOV bytes and hashes, existing native merge command where used, unchanged global92/83/90 enforcement in that actual native collection/merge process, its emitted LCOV hash, and the exact same emitted LCOV bytes consumed by the original39-floor check. Global thresholds operate on native V8 coverage during collection/merge, not on LCOV as an input; LCOV is the output and subsequent floor input. Reject unit-only, partial, stale, missing/duplicate/conflicting parts, source/commit mismatch, changed dependency/producer, changed thresholds or a merged summary without original inputs. Guarded coverage skips remain disclosed and do not satisfy any required suite's zero-skip obligation.

Accept only an already reviewed full-native local producer with complete actual receipt, or the existing four-shard CI recipe at the exact current head/run/attempt with externally verified successful jobs/artifact origin, all four matching manifests, raw files and existing native merge/global/floor output. The current shard manifests have commit/node/cwd/count but no content digests: they alone are NOT integrity/execution proof. Hash observed archived parts and bind them to independently observed download/source/producer/merge receipts; missing artifact/output or unverified CI identity keeps BLOCKED. Do not average LCOV percentages, copy old LCOV as current, reimplement weakened floors, add a new collector command or change CI/package scripts here. Obtaining/running a missing producer, merging inputs or rerunning floor commands needs the corresponding reviewed execution authorization later; this candidate's small tests use labelled verifier fixtures, not fake native coverage PASS.

### Scope, verification and remaining workload

After adoption, implementation is limited to the existing three Gate paths plus ONE explicitly declared local-only outer-coordinator template at docs/inventory_management/implementation/task041-hd233-small-runtime.mjs.txt. This fourth path is required to produce real Harness/cleanup receipts, not an undisclosed private-script change. Derive it only from the pinned archived HD231 coordinator: adapt suite/profile selection, guarded Gate-native schema/socket/env, original typed-result/report binding, actual IPC-child ownership validation for the Gate native recipe, complete input snapshots and original CAS evidence registration for48+4; preserve lifecycle/deadlines/terminal/cleanup/first-error controls. In this new child recipe, never clear innerMayBeRunning from the old direct-suite no-child assumption; require the real GB-N04 ownedStops/ownedSql report and independent terminal proof. Register each actual returned typed path/hash through the unchanged state_tool CAS, preserving FAIL/UNKNOWN if produced; do not fabricate or rewrite raw records, approvals or prior history. Copy it byte-identically into its owned private runtime for execution and bind its exact before/after producer bytes in receipts. It is not imported by products, shipped as a provider or a generic runner; changes outside these narrow regions require review. Preserve the original32 deterministic test names/bodies/assertions, add16 distinct persisted standard-library unit cases GB-U33–48 (minimum48, no skips), keep and strengthen the four real minimal MySQL/resource cases (minimum4, no skips), and preserve their existing commands/env/300s/600s. No new mandatory group: all73 remain; only that unit minimum rises. Existing required Lint CI already invokes the complete same unit file and must discover the new cases without workflow change. No product/Item/provider/DDL/old business/performance helper/command, shared Harness, coverage threshold or deadline change.

Small-first end-to-end verification is explicitly two-stage to avoid self-attestation: run the true48-unit then4-native groups under an owned minimal runtime and CAS-register both actual original typed records (including a returned FAIL if any) before attempting final positive lookup; while that runtime is still live, the new preflight must reject incomplete cleanup. Only after both original typed runs exist AND the outer process/SQL/schema/socket/daemon/root cleanup is positively complete, invoke the read-only preflight again against those two actual records. Positive preflight is supporting collector evidence, not extra fake test cases, aggregate Gate PASS or P4 completion. Native tests cannot assert their own future completed outer receipt. Missing actual outer producer proof remains BLOCKED, not a fake positive.

After approved implementation, TDD48+4 and the real small preflight may run first. No full workload or other Gates are authorized by this candidate. Then present a current per-suite applicability matrix: preserve proved six-run applicability, retain three support-only results in that role, and run only affected/unproved other checks under subsequent authorization. Current complete native coverage/browser/Playwright CLI/current-head CI/latest-main/final Sam review and all original P4 numeric/filesystem/metadata/warning controls remain required. All four full-load groups remain HOLD; Characterization is explicitly not repeated. If its historical dependency/change-of-Create applicability cannot be proved, final Gate stays BLOCKED even if every small tool check succeeds. No task/P4 DONE, new load, publication/merge, formal acceptance or deployment follows.


## 10.6.15 P4 consolidated completion contract — HD235 candidate

PROPOSED_NOT_APPLIED. Adoption needs Sam's exact decision. This supplement replaces only HD233's eight-suite receipt-preflight restriction, fixed producer set and the concrete coverage producer receipt requirements for the future adopted baseline; it does not alter product semantics or erase historical restrictions/results. Preserve the original generic result, direct evidence_issues/current Context and distinct project readiness. No local JSON authenticates Sam or GitHub. All73 required developer groups, original business cases/data/deadlines/zero-skip rules,39 floors/global92/83/90, true HTTP/Playwright/CLI, current-head mandatory CI, latest-main integration, independent review and final Sam complete-source review remain.

Only the three existing Gate tools, one Inventory-local coordinator implementation/task041-hd235-verification-runtime.mjs.txt, new server/scripts/inventoryPhase005CoverageEvidence.mjs and narrowly listed .github/workflows/ci.yml recording/upload hooks may change after adoption. Existing HD233 coordinator stays byte-identical. No product, Item/provider ABI, DDL, framework, package script, existing business/performance helper, checker, CI job/matrix/dependency or original test/coverage/capacity command change. Preserve48 unit bodies/assertions and four native case bodies/assertions; add32 distinguishing units (80 total) and four minimal native cases (8 total), keeping300/600 seconds. Other72 suite objects and the two suites' argv/env/timeout/side-effect fields remain unchanged. No new group.

Use a finite Inventory PHASE005 suite-to-recipe registry, not a general runner/framework or trusted-JSON normalization. The exact original profile contract, literal73 IDs, data/guard/socket requirements and original producer recipe determine execution and proof. Families are FILES_DIRECT, MYSQL_DIRECT, MYSQL_HTTP, MYSQL_IPC_PROCESS, BROWSER_REAL_APP, BROWSER_DECLARED_MOCK, STOCKTAKE_CHARACTERIZATION, STOCKTAKE_SOAK and CI_NATIVE_4SHARD. Browser entries retain real-app versus existing labelled mock modes. New receipts preserve original typed command/result/artifact/source/PLAN/runtime identities and CAS-register actual FAIL as well as PASS before classification. Expand read-only selected receipt preflight only to these73 exact IDs; never execute/clean/register from that mode.

New local receipts capture the actual owned runner/Node/Python/Harness/MySQL as used, complete installed package bytes/modes/symlink targets, resolved executables, source/spec/producer input manifests before/after, data reference and actual process/IPC/HTTP/SQL/trx/lock/schema/socket/root completion. FILES-only does not invent DB work, but its real Harness/Python/Node inputs and process/artifact facts remain required; native/application recipes retain all extra lifecycle obligations. No statuses or driver destroy/empty-table/PID absence alone replace terminal proof. Known historical administrative mappings remain limited to previously approved exact deltas and complete original inputs. This supplement grants no blanket source/PLAN equivalence to old runs; unresolved later attempts and all integrity/control issues stay blocking.

First perform a real small end-to-end using the reviewed coordinator and existing original suites: inventory-task036-unit, inventory-task041-draft-lock-range-database and inventory-task041-export-failure-audit-api, with their original minimums/data/timeouts. Bind each actual registered typed result to live-runtime BLOCKED and completed own-runtime proof, including a true failure/tampered-copy counterexample without changing product. These executions belong to their existing groups, not extra counted cases. Only after real wiring and80+8 pass may the approved remaining non-load work proceed.

Coverage uses the existing actual GitHub Actions four-shard MySQL26.7 erp_dev lane and original test:coverage:merge command, not the incompatible local single-schema auto-discovery command. Local Fulfillment and unguarded Stocktake Audit fixtures demand incompatible schema prefixes; do not spoof CI/GITHUB_ACTIONS or weaken either guard. The original inventory-p3-server-coverage suite remains unit-only; it cannot substitute full native/global evidence. No extra counted group.

Add a finite CI-only recorder with four modes before-shard, finish-shard, before-merge, finish-merge. The before-shard hook runs separately without NODE_V8_COVERAGE so it does not contaminate the original raw coverage set. Keep the existing native transport assertion, native npm/shard commands, matrix, Sales capacity commands, merge/global92/83/90 and39-floor checker unchanged. Bind before/after source/workflow/package/installed Node/npm/executable inputs and safe actual runner/image/action identities. For this genuine Node-only CI recipe, imported Python/Harness inputs are NOT_USED only when the exact reviewed workflow/commands establish that fact; do not fabricate snapshots or generalize this to local Harness-launched runs. Query actual MySQL identity/image/container ownership and SQL/trx/lock terminal after all original shard work; use existing synthetic admin env without storing credentials. The finish-shard hook may close only the exact GitHub job.services.mysql.id independently matched to the observed container/immutable image; observe own monitor socket close, zero work, docker stop with fixed10-second graceful budget and actual container ExitCode0 before complete proof. Missing ownership/terminal or forced/unknown stop keeps proof failed; preserve original job outcome and rely on platform cleanup only as separate failed-recovery evidence. No shared-service or arbitrary prefix/PID cleanup.

The original shard upload keeps its name/path/retention1 day but runs always to preserve actual failures and observed proof. Each archive includes its own minimal proof alongside unchanged raw/manifest. Merge captures exact downloaded four native artifact byte identities, original command/outcome, emitted native LCOV and the unchanged39-floor consumption via its reviewed original command chain; add one private1-day upload of merged LCOV/proof. Failure/missing LCOV is never success. Independent current-head GitHub run/attempt/job/upload-log/artifact ID/download digest lookup must anchor these bytes; self-reported proof cannot authenticate CI. Actual current native global enforcement produces LCOV; the same output feeds floors. Keep raw artifacts/minimal proof in existing private CI artifact policy, not committed/public raw evidence. All current mandatory jobs remain separate merge prerequisites.


All raw historical PASS/FAIL/UNKNOWN remain unchanged. Characterization recovery is incomplete in the checked original artifacts/archives: installed Node bytes, historical external Harness/Python and actual child/PATH resolution lack anchored capture, and Create/Lock product inputs later changed. Current files/versions/lockfiles cannot repair this. If Sam explicitly chooses the single-baseline revalidation option, exactly one new original Characterization execution is allowed after small/non-load prerequisites, with original15 cases/full data7200 seconds, preserving old PASS separately; this is a specific override of the earlier no-repeat restriction, not historical waiver. Exactly one original CS01 may then run only after current Characterization passes and no unresolved performance failure, preserving2700 seconds/30-minute20actors and fail-fast. Customer/Core capacity keep original fixtures/timeouts and require current or fully proved applicable evidence. Any performance FAIL/timeout stops subsequent load, preserves evidence, drains/cleans under original budgets and returns for consolidated human disposition; never auto-fix/retry.

Freeze the complete candidate before expensive work. Test-tool corrections within this reviewed scope use deterministic/minimal real checks first; changed actual inputs invalidate only dependent evidence with explicit reasons, not all results for a document/unrelated-main hash. Post/lock/Audit/shared transaction changes are outside this scope and require separate material disposition with transaction/rollback/capacity impact. Independent review must actually cover the implementation; no SELF replacement of required independence. Final exact source review remains Sam's. Any unproved capacity numeric gate, target filesystem/empty-metadata operational policy or shared-listener risk remains an explicit P4 completion blocker even if all developer checks pass. No formal acceptance, deployment, P5, historical waiver or unseen product/merge approval follows from adoption.

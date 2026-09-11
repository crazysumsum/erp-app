# Fulfillment & Shipping Management 系統設計規格

## 0. 文件資訊、決策及設計門檻

| 項目 | 內容 |
| --- | --- |
| 文件名稱 | Fulfillment & Shipping Management 系統設計規格 |
| 對應需求 | `docs/fulfillment_shipping_management/requirement.md` |
| 目標版本 | Phase 1（中小企核心履約及出貨） |
| 技術棧 | Node.js ES Modules、Express 5、AJV、MySQL 5.7、Vue 3、Quasar 2、Pinia、Vitest／Node Test Runner |
| 容量基線 | 每日約10,000張SO、最多5個Warehouse、24個月最少730萬張Active Fulfillment及Shipment |
| 文件狀態 | Implementation-ready；實作前仍須按最新main分配Migration序號 |

### 0.1 已鎖定架構決策

| ID | 決策 | 理由／影響 |
| --- | --- | --- |
| FSD-001 | Fulfillment、Sales及Inventory維持同一應用、同一MySQL schema內的domain modules。 | 可用真正ACID transaction完成Issue、Reservation Consume及SO Fulfilled，不引入不必要的eventual consistency。 |
| FSD-002 | Shipment Confirm及Reversal採Phase A durable intent＋Phase B原子執行。 | 同時提供即時結果、`SHIPPING／REVERSING`可見狀態及commit unknown恢復。 |
| FSD-003 | DRAFT Fulfillment以Reservation Claim防止可履約量被多張工作重複佔用。 | Allocation尚未建立前亦能在DB層及transaction lock下保護數量。 |
| FSD-004 | Inventory是Balance、Reservation、Allocation及Movement唯一事實來源；Fulfillment只保存owner-safe projection及不可變快照。 | 禁止兩套庫存賬及自行加減Inventory數量。 |
| FSD-005 | 有Expiry bucket全部先於無Expiry bucket；前者FEFO，後者FIFO。 | 降低已知效期庫存過期風險，且混合資料有唯一、可測的順序。 |
| FSD-006 | FIFO偏離需`fulfillment.operation`＋原因；FEFO偏離另需`inventory.fefo.override`。 | 對齊已確認業務權限；任何偏離仍不能使用不合資格庫存。 |
| FSD-007 | Shipment Reversal使用Inventory專用internal command恢復原Reservation；原Allocation保持Consumed。 | 保留原追溯鏈，同時不放寬generic Inventory Reversal。 |
| FSD-008 | 未歸檔`CLOSED` SO可在合法Shipment Reversal後重開。 | 保留錯誤出貨更正能力；Cancelled quantity不變，恢復量回Reservation。 |
| FSD-009 | Sales Archive Job是唯一歸檔協調者，同transaction搬移Sales＋Fulfillment aggregate。 | 防止父SO與Shipment分處Active／Archive。 |
| FSD-010 | 一張Fulfillment只屬一張SO及一個Warehouse；一張Shipment只屬一張Fulfillment。 | 本期不加入多SO、跨倉或wave picking。 |
| FSD-011 | 不強制Packing Confirm；Carrier及包裝欄位選填。 | 中小企簡單實用優先。 |
| FSD-012 | Active及Archive使用同一MySQL instance內的獨立relational tables。 | 保留FK／transaction能力，避免MySQL 5.7 partition限制及第二套storage。 |

### 0.2 設計門檻關閉結果

| Requirement Gate | 本設計關閉方式 |
| --- | --- |
| GATE-001 有效Shipment唯一性 | `fulfillments.active_shipment_id`＋composite ownership FK＋transaction lock；Cancelled Draft清空pointer，Shipped／Reversed保留。 |
| GATE-002 Confirm一致性 | §§2.4、2.6、5.6、8.6定義Phase A／B、operation、lock order、unknown outcome及reconciliation。 |
| GATE-003 Reversal語意 | §§3.5、5.7、6.2、8.7定義原bucket回補、原Reservation恢復、Allocation不重開。 |
| GATE-004 SO狀態回退 | §3.6定義Completed／Partially Fulfilled／Closed在Reversal後按數量重算。 |
| GATE-005 Archive邊界 | §§2.7、4.17、6.5、8.10定義Sales-owned原子搬移、hash／count校驗及routing。 |
| GATE-006 容量分佈 | §10.6定義730萬headers、lines／Lot／Bin分散度及50-user mixed load。 |
| GATE-007 Serial防護 | 建立Fulfillment、Allocation及Shipment Confirm三個submit point均經Item／Inventory拒絕Serial。 |

### 0.3 Out of Scope

- 多SO合併Shipment、跨倉履約、自動選倉。
- Wave／Batch／Zone Picking、掃描槍專用流程、路線或車隊管理。
- 強制Packing、箱內明細、棧板、電子面單或Carrier API。
- 臨時地址、Proof of Delivery、Customer Return、換貨、退款、Invoice、AR、成本或會計分錄。
- 部分Shipment Reversal、Serial Number、Catch Weight、Bundle／Kit。
- Archive資料的一般使用者修改、刪除或第一階段自動purge。

---

## 1. 目標、能力及現有工程約束

### 1.1 成功條件

1. 兩名使用者競爭同一SO Reservation時，Planned總量永不超過可用Reservation。
2. Allocation、Pick Confirm、Shipment Confirm、Cancel及Reversal任一步失敗均不留下部分數量效果。
3. 同一event重送不重複建工作、Release、Issue、增加SO Fulfilled或Reversal。
4. Shipment顯示`SHIPPED`時，Inventory Movement／Reservation及Sales quantity必然已在同一commit完成。
5. `SHIPPING／REVERSING`只表示未確定結果，能由原event查詢或Recovery Job收斂。
6. 所有Bin／Lot／Expiry、Address／Contact、SKU／UOM及物流歷史可由snapshot追溯。
7. Active容量下Queue及精確查詢P95≤2秒；最多100行寫操作P95≤3秒或3秒內回202。
8. 父SO與所有Fulfillment／Shipment資料只會同處Active或Archive。

### 1.2 Capability Map

| Capability | 責任 | 依賴 |
| --- | --- | --- |
| `FUL-CAP-01 queue-work` | Queue、Reservation Claim及DRAFT Fulfillment | Sales、Inventory Reservation |
| `FUL-CAP-02 allocation-picking` | FEFO／FIFO、Allocation、Pick List、Pick Confirm及Short Pick | CAP-01、Inventory、Item |
| `FUL-CAP-03 shipment` | Shipment Draft、Customer地址、Confirm及Delivery Note | CAP-02、Customer、Sales、Inventory |
| `FUL-CAP-04 reversal` | 整張Shipment Reversal及SO重開 | CAP-03、Sales、Inventory |
| `FUL-CAP-05 inquiry-lifecycle` | Lists、Audit、Export、Archive、Reconciliation及Operations | CAP-01～04、Scheduler |

建置順序固定為CAP-01 → CAP-02 → CAP-03 → CAP-04 → CAP-05；API及內部contract可先以consumer contract tests鎖定。

### 1.3 現有專案模式

- Server handler繼承`BaseRequestHandler`，以static `api`聲明method、path、authorization、idempotency、request／response schemas；handler不得直接寫response。
- Domain service由handler以service container提供的Database／Logging／Time建立；不為單一MySQL實作增加無價值repository wrapper。
- 所有外部input由AJV strict schema驗證；未知欄位拒絕。DB error按constraint name映射穩定public code。
- `MySqlDatabaseService.withTransaction()`提供同connection executor；internal write contract必須接收該executor，禁止偷偷另開transaction。
- Client頁面由`client/src/pages/**/*.vue`自動發現，頁面export `page` metadata；服務由`client/src/services`集中呼叫`HttpClient`。
- UI必須遵循`docs/frontend-design.md`，包括`PageHeader`、`DataTable`、`FormPanel`、`EllipsisCell`、共用notify／confirm及WCAG focus行為。

### 1.4 工程命令

```bash
# Server development / verification
cd server
npm run dev
npm test
npm run test:coverage
npm run migrate

# Client development / verification
cd client
npm run dev
npm test
npm run test:coverage
npm run build
```

Migration、FK、trigger、真並發及archive move使用真MySQL integration tests；fake database只供純service unit tests。

---

## 2. 系統架構、資料流及交易

### 2.1 Component Architecture

```text
Vue / Quasar Pages
  -> HttpClient
    -> BaseRequestHandler + AJV + Authorization + Idempotency
      -> Fulfillment Domain Services
        -> SalesFulfillmentService
        -> CustomerLookupService
        -> ItemLookupService
        -> InventoryReservationService / InventoryPostingService
          -> MySqlDatabase transaction executor

Scheduler
  -> ConfirmationRecoveryJob / ReversalRecoveryJob
  -> FulfillmentExportJob
  -> SalesArchiveJob -> FulfillmentArchiveParticipant
  -> FulfillmentReconciliationJob
```

Fulfillment不拆成deployable microservices。Service分責任只為狀態、交易與測試可讀；所有quantity write仍在同一database transaction內完成。

### 2.2 Aggregate及事實來源

| Aggregate／Projection | Owner | 同transaction內容 |
| --- | --- | --- |
| Fulfillment | Fulfillment | Header、Lines、Reservation Claims、Allocation projections、History、Audit。 |
| Shipment | Fulfillment | Shipment、Lines、Issue details、History、Address／Contact snapshots。 |
| Shipment Reversal | Fulfillment | Reversal header/details、Shipment／Fulfillment state、History、Audit。 |
| Inventory stock | Inventory | Balance、Lot、Reservation、Allocation、Movement、Inventory operation。 |
| Sales Order | Sales | Ordered／Reserved／Backorder／Fulfilled／Cancelled projections及SO state。 |
| Customer master | Customer | Current address／contact status及用途；Shipment只保存選擇及成功時snapshot。 |

### 2.3 Queue及Reservation Claim流程

```text
GET queue
  Sales current quantity + reservation mappings
  minus active Fulfillment Claims
  -> bounded Queue projection

POST fulfillment/create
  BEGIN
    claim fulfillment operation
    lock Sales Order + selected Lines + reservation mappings
    lock existing active Fulfillment claims in deterministic order
    re-read status/version and calculate fulfillable
    allocate requested quantity across Reservation mappings by mapping id
    insert Fulfillment + Lines + Claims + History + Audit
  COMMIT
```

Queue GET是提示，Create transaction才是權威。Claim不改Inventory Reservation outstanding、SO Reserved或On Hand，只阻止另一Fulfillment使用同一份Reserved quantity。

### 2.4 Allocation及Pick Confirm

Allocation整批按`fulfillment_line_id, reservation_id, inventory_balance_id`排序：

1. 鎖Fulfillment／Lines／Claims並驗`DRAFT`及version。
2. 呼叫Inventory batch candidates；Inventory決定eligibility、FEFO／FIFO及偏離類型。
3. 建立所有Inventory Allocations；任何一行不足整批rollback。
4. 保存只讀projection與建議／實選摘要，Fulfillment轉`PICKING`。

Pick Confirm：

1. 每個Allocation接受`0..allocated`的actual picked；整張至少一個正數。
2. `picked < allocated`必須逐行提供5～500字原因。
3. Inventory在同transaction release差額；Fulfillment Claim active quantity同步減少，差額立即返回Queue。
4. 保留picked部分的Allocation outstanding，不扣On Hand、不consume Reservation。
5. 全部成功才轉`PICKED`；結果不可修改，需取消並重建。

### 2.5 Shipment Draft及地址

- 建立Shipment鎖Fulfillment；只接受`PICKED`且`active_shipment_id IS NULL`。
- 重複相同create event回原Shipment；已有有效Shipment則回該記錄，不建立第二張。
- Draft只保存Customer child IDs及載入時versions；地址文字snapshot在成功Confirm的Phase B保存。
- Draft可改Shipping Address、Contact及物流欄位，不可改Shipment Lines、SKU、Bin、Lot或quantity。
- Cancel Draft清空`active_shipment_id`並令Fulfillment回`PICKED`；歷史Cancelled Shipment保留。

### 2.6 Shipment Confirm兩階段交易

```text
Phase A — claim intent
BEGIN
  atomic claim fulfillment_operation_requests(eventId, payloadHash)
  lock Shipment + Fulfillment
  validate DRAFT/PICKED/version/active pointer
  Shipment DRAFT -> SHIPPING
  operation IN_PROGRESS + lease + correlation
COMMIT

Phase B — execute immediately or recover
BEGIN
  lock operation
  lock Sales Order + Lines + Reservation mappings
  lock Fulfillment + Lines + Claims + Shipment + Shipment Lines
  lock/revalidate Customer + Address + optional Contact
  revalidate Item tracking policy; reject Serial
  Inventory postFulfillmentIssueBatchInTransaction()
  Sales applyFulfillmentResultInTransaction(SHIPMENT_CONFIRMED)
  save snapshots + Issue details
  Shipment/Fulfillment -> SHIPPED; operation -> SUCCEEDED
  append histories + audits
COMMIT
```

- Phase B業務驗證失敗：同transaction把Shipment退回`DRAFT`、清除confirmation event、operation=`FAILED`並保存stable public error；沒有Inventory／Sales效果。
- DB deadlock／lock timeout：回可重試狀態；Recovery沿用原event。
- COMMIT connection lost／request deadline：Shipment保持`SHIPPING`，API回202或indeterminate error；不得用新event重做。
- Recovery Job只接管lease過期operation；以同一event／payload hash執行Phase B。

### 2.7 Shipment Reversal及Archive

Reversal使用同樣Phase A／B：Phase A令Shipment`SHIPPED → REVERSING`並建立Reversal intent；Phase B在單一transaction：

1. 重驗actor、`fulfillment.reverse`、原因、goods-returned confirmation、未歸檔及無不可逆下游事項。
2. 鎖Sales → Fulfillment／Shipment → Inventory，引用全部原Issue details。
3. Inventory回補原Warehouse／Bin／Lot／Status，減Reservation consumed並增加原Reservation outstanding；Allocation不改。
4. Sales把同量Fulfilled移回Reserved並重算SO state。
5. Shipment／Fulfillment轉`REVERSED`，保存反向Movement及前後數量。

永久業務失敗令Shipment回`SHIPPED`、Reversal attempt=`FAILED`；技術不明保留`REVERSING`供原event恢復。

Archive由Sales Job協調；每張SO一個transaction，先鎖Sales root，再鎖全部Fulfillment／Shipment roots，確認只有`CANCELLED／SHIPPED／REVERSED`且無未完成claim／allocation／operation，copy兩邊archive、核對count/hash、更新routing、刪Active。任何差異rollback。

### 2.8 全域Lock Order

所有跨模組write依下列順序；同類ID升序，不能依畫面行順序：

1. Domain operation／scheduler lease row。
2. Sales Order、Lines、Reservation mappings。
3. Fulfillment Headers、Lines、Reservation Claims。
4. Shipment、Shipment Lines、Reversal row。
5. Customer／Address／Contact驗證鎖；它們不反向取得Sales／Fulfillment lock。
6. Inventory Operation → Warehouse → Stock Controls → Bins／Bin Locks → Lots → Balances → Reservations → Allocations。
7. Current projections、History、Audit append。

Archive不呼叫Inventory；只按Sales root → Fulfillment roots → archive rows順序。Deadlock及lock timeout映射`409 CONCURRENT_OPERATION`，原event先查operation outcome。

### 2.9 冪等三層責任

| 層 | Identity | 規則 |
| --- | --- | --- |
| HTTP framework | actor＋method＋route＋`Idempotency-Key` | state-changing routes啟用；同payload replay、異payload 409；TTL至少7日。 |
| Fulfillment domain | global `eventId`＋operationType＋canonical payload hash | 與Phase A intent原子claim；IN_PROGRESS回202，SUCCEEDED replay結果，FAILED可讀safe錯誤。 |
| Inventory／Sales source | module＋documentType＋documentId＋lineId＋eventId | provider side防重；同event不同command／quantity拒絕。 |

Client為同一使用者意圖只產生一次event及idempotency key並跨retry保存；Recovery Job不能產生新event。

---

## 3. Domain Model、狀態機及不變量

### 3.1 Fulfillment狀態

```text
DRAFT --allocate--> PICKING --pick confirm--> PICKED --shipment confirm--> SHIPPED
  |                    |                         |
  +------cancel--------+-----------cancel--------+  (沒有有效Shipment)

SHIPPED --shipment reversal--> REVERSED
```

- DRAFT可update Lines但每次重建Claims；PICKING可reallocate；PICKED不可改picked結果。
- PICKING／PICKED取消要原因；有實際picked另要`goodsReturnedToOriginalBins=true`。
- 有非Cancelled Shipment時Fulfillment不可取消。
- `SHIPPED／CANCELLED／REVERSED`不可一般修改或刪除。

### 3.2 Shipment及Reversal狀態

```text
Shipment: DRAFT -> SHIPPING -> SHIPPED -> REVERSING -> REVERSED
             |          |         |
             |          |         +-- business failure --> SHIPPED
             |          +-- business failure --> DRAFT
             +-- cancel --> CANCELLED

Reversal attempt: REVERSING -> REVERSED / FAILED
```

`SHIPPING／REVERSING`禁止update、cancel或另一個新event。只有同event lookup／recovery可繼續。

### 3.3 Fulfillment數量不變量

對每個Fulfillment Line：

```text
planned_base_quantity = picked_base_quantity + short_base_quantity
allocated_base_quantity = picked_base_quantity + allocation_released_base_quantity
shipped_base_quantity IN (0, picked_base_quantity)
reversed_base_quantity IN (0, shipped_base_quantity)
```

- DRAFT：Allocated／Picked／Short／Shipped／Reversed全0。
- PICKING：Allocated=Planned，Picked／Short／Shipped=0。
- PICKED：Picked>0、Short=Planned-Picked、Shipped=0。
- SHIPPED：Shipped=Picked、Reversed=0。
- REVERSED：Shipped保留歷史，Reversed=Shipped。

### 3.4 Reservation Claim不變量

每筆Claim：

```text
original_claimed_quantity
  = active_claimed_quantity
  + released_quantity
  + consumed_quantity

reversed_quantity <= consumed_quantity
```

- Queue只扣減`ACTIVE` claim的`active_claimed_quantity`；Consumed、Released、Cancelled、Reversed不佔Queue。
- Shipment Issue把active移至consumed；Reversal不重開舊Claim，而是記`reversed_quantity=consumed_quantity`，由已恢復Inventory Reservation重新出現在Queue。
- 同一Sales Reservation可有多筆Claim，但所有active總和不得超過Inventory outstanding；建立／更新時持Sales mapping及existing claim locks驗證。

### 3.5 Allocation及Issue不變量

- Inventory Allocation是正式記錄；`fulfillment_allocations`只可由provider result insert／update。
- `allocated = picked + released`在Pick Confirm後成立；Shipment Issue後Inventory Allocation為Consumed但Fulfillment projection仍保留原allocated／picked／released。
- 有Expiry先按`expiry, lot, firstReceipt, bin, balanceId`；其後無Expiry按`firstReceipt／fifoAnchor, lot, bin, balanceId`。
- 選擇序列必須是可滿足requested quantity的最前候選集合；越過有Expiry選無Expiry屬FEFO override。
- Issue line集合必須與所有picked Allocation集合完全相等，不可缺漏、重複、多出或改bucket。

### 3.6 Sales Order狀態重算

Shipment Confirm後：

- 首次部分出貨：`CONFIRMED → PARTIALLY_FULFILLED`。
- 所有Line `reserved=backorder=cancelled=0`且fulfilled=ordered：`COMPLETED`。

Shipment Reversal後保持Ordered、Backorder及Cancelled不變，把該Shipment數量由Fulfilled移回原Reservation的Reserved：

- 更新後任一Line Fulfilled>0：Order=`PARTIALLY_FULFILLED`。
- 全部Line Fulfilled=0：Order=`CONFIRMED`。
- 原Order可為`COMPLETED／PARTIALLY_FULFILLED／CLOSED`；CLOSED中既有cancelled quantity保留。
- 原Complete／Close history不可update；新增`FULFILLMENT_REVERSE_REOPEN`事件。

### 3.7 Snapshot及時間規則

- Customer、Address、Contact、SKU、UOM、Warehouse、Bin、Lot、Expiry及Stock Status在Shipment成功時保存。
- Draft Shipment只保存current IDs／versions；主檔在Confirm前改變即拒絕，不靜默替代。
- Epoch milliseconds由Time Service產生；Shipment Date及Expiry等business date用APP_TIME_ZONE的`DATE`。
- Notes、Reasons、Carrier、Tracking及snapshot text視為不可信資料；render時escape，CSV時防formula injection。

---

## 4. Database Table詳細設計

### 4.1 共通規則

- Engine InnoDB；charset／collation沿用現有`utf8mb4`。
- PK使用`BIGINT UNSIGNED AUTO_INCREMENT`；API只接受positive JavaScript safe integer。
- Quantity使用`BIGINT UNSIGNED` Base UOM；不可用JavaScript浮點運算。
- Current aggregate使用`version INT UNSIGNED NOT NULL DEFAULT 1`作CAS。
- Active master FK採`ON DELETE RESTRICT`；aggregate children可在受控archive transaction使用CASCADE。
- MySQL 5.7不可靠執行`CHECK`，核心數量／狀態由service＋BEFORE trigger＋integration test三層保護。
- History、Issue details、Reversal details及Archive tables無一般update／delete repository；trigger拒絕非archive maintenance變更。
- Migration不在本文件硬編序號；依§9.3切片並於實作時使用main下一個可用值。

### 4.2 `fulfillment_document_sequences`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Row ID。 |
| `document_type` | VARCHAR(20) ASCII | NOT NULL | `FULFILLMENT／SHIPMENT／REVERSAL`。 |
| `period_key` | CHAR(6) ASCII | NOT NULL | APP_TIME_ZONE的`YYYYMM`。 |
| `next_value` | BIGINT UNSIGNED | NOT NULL／1 | 在transaction鎖row後配置。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Sequence CAS／觀測。 |
| `updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(document_type,period_key)`。顯示格式`FUL-YYYYMM-NNNNNN`、`SHP-YYYYMM-NNNNNN`、`REV-YYYYMM-NNNNNN`；號碼可有間斷但不可重用。

### 4.3 `fulfillments`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Fulfillment ID。 |
| `fulfillment_number` | VARCHAR(24) ASCII | NOT NULL | 唯一人類可讀單號。 |
| `sales_order_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | 單一父SO。 |
| `sales_order_number_snapshot` | VARCHAR(20) ASCII | NOT NULL | 顯示及Archive。 |
| `customer_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | 必須等於SO Customer。 |
| `customer_code_snapshot`,`customer_name_snapshot` | VARCHAR(100)／VARCHAR(190) | NOT NULL | 建立時顯示快照；出貨另凍結。 |
| `warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK inventory_warehouses RESTRICT | 必須等於SO Warehouse。 |
| `warehouse_code_snapshot`,`warehouse_name_snapshot` | VARCHAR(100)／VARCHAR(190) | NOT NULL | 建立時快照。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `DRAFT/PICKING/PICKED/SHIPPED/CANCELLED/REVERSED`。 |
| `line_count` | SMALLINT UNSIGNED | NOT NULL | 1～100。 |
| `has_short_pick` | TINYINT(1) | NOT NULL／0 | Current summary。 |
| `active_shipment_id` | BIGINT UNSIGNED | NULL | 建Shipment後指向同owner Shipment；取消Draft才清空。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Aggregate CAS。 |
| `allocated_at`,`picked_at`,`shipped_at`,`cancelled_at`,`reversed_at` | BIGINT UNSIGNED | NULL | Milestones。 |
| `picked_by`,`shipped_by`,`cancelled_by`,`reversed_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor IDs。 |
| `cancel_reason` | VARCHAR(500) | NOT NULL／`''` | 適用時5～500字。 |
| `notes` | VARCHAR(2000) | NOT NULL／`''` | 工作備註。 |
| `last_business_updated_at` | BIGINT UNSIGNED | NOT NULL | Archive cutoff；read／print不更新。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Technical time。 |
| `created_by`,`updated_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |

約束／索引：

- `UNIQUE(fulfillment_number)`、`UNIQUE(id,sales_order_id)`、`UNIQUE(active_shipment_id)`。
- 建立Shipments後加`FOREIGN KEY(active_shipment_id,id) REFERENCES shipments(id,fulfillment_id) RESTRICT`。
- `INDEX(status,warehouse_id,last_business_updated_at,id)`供active work。
- `INDEX(sales_order_id,status,id)`、`INDEX(customer_id,created_at,id)`。
- `INDEX(created_by,status,updated_at,id)`供My Recent Work。
- `INDEX(last_business_updated_at,status,id)`供archive candidate。

### 4.4 `fulfillment_lines`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Line ID。 |
| `fulfillment_id` | BIGINT UNSIGNED | NOT NULL／FK CASCADE | Aggregate owner。 |
| `sales_order_id`,`sales_order_line_id` | BIGINT UNSIGNED | NOT NULL | Composite FK至Sales Line owner。 |
| `line_no` | SMALLINT UNSIGNED | NOT NULL | Fulfillment內1～100。 |
| `sales_order_line_no` | SMALLINT UNSIGNED | NOT NULL | Source display。 |
| `sku_id` | BIGINT UNSIGNED | NOT NULL／FK item_skus RESTRICT | SKU identity。 |
| `sku_code_snapshot`,`sku_name_snapshot` | VARCHAR(190) | NOT NULL | 建立時快照。 |
| `base_uom_id` | BIGINT UNSIGNED | NOT NULL／FK item_uoms RESTRICT | Base UOM。 |
| `base_uom_code_snapshot`,`base_uom_name_snapshot` | VARCHAR(100) | NOT NULL | 顯示。 |
| `tracking_policy_snapshot` | VARCHAR(30) ASCII | NOT NULL | `none/batch/batch_expiry`；Serial拒絕。 |
| `minimum_sale_life_days_snapshot` | INT UNSIGNED | NOT NULL／0 | 建立時提示，提交由Item／Inventory重驗。 |
| `planned_base_quantity` | BIGINT UNSIGNED | NOT NULL | 本工作原計劃。 |
| `allocated_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Inventory成功Allocation總和。 |
| `picked_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 實際確認。 |
| `short_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Planned-Picked。 |
| `shipped_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 成功Issue；0或Picked。 |
| `reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 0或Shipped。 |
| `short_pick_reason` | VARCHAR(500) | NOT NULL／`''` | 有Short時必填。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Line CAS。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

- `UNIQUE(fulfillment_id,line_no)`、`UNIQUE(fulfillment_id,sales_order_line_id)`、`UNIQUE(id,fulfillment_id)`。
- Composite FK `(sales_order_line_id,sales_order_id)`至Sales Line `(id,sales_order_id)`。
- `INDEX(sales_order_line_id,fulfillment_id,id)`、`INDEX(sku_id,fulfillment_id,id)`。
- BEFORE INSERT／UPDATE trigger驗數量關係及不可接受Serial snapshot。

### 4.5 `fulfillment_line_reservation_claims`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Claim ID。 |
| `fulfillment_id`,`fulfillment_line_id` | BIGINT UNSIGNED | NOT NULL | Composite owner FK。 |
| `sales_order_line_reservation_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Sales mapping。 |
| `inventory_reservation_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Inventory真實Reservation。 |
| `original_claimed_quantity` | BIGINT UNSIGNED | NOT NULL | 建立時claim。 |
| `active_claimed_quantity` | BIGINT UNSIGNED | NOT NULL | 尚由此工作佔用。 |
| `released_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Short／Cancel返回Queue。 |
| `consumed_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 成功Shipment Issue。 |
| `reversed_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 成功Reversal歷史量。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `ACTIVE/RELEASED/CONSUMED/CANCELLED/REVERSED`。 |
| `inventory_version` | INT UNSIGNED | NOT NULL | 最近provider result。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

- `UNIQUE(fulfillment_line_id,inventory_reservation_id)`。
- Composite FK `(fulfillment_line_id,fulfillment_id)`；`INDEX(inventory_reservation_id,status,id)`供競爭claim SUM。
- Service在持Sales mapping lock下驗active claims總和；trigger驗§3.4等式。

### 4.6 `fulfillment_allocations`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Projection ID。 |
| `fulfillment_id`,`fulfillment_line_id` | BIGINT UNSIGNED | NOT NULL | Owner。 |
| `claim_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Reservation slice。 |
| `inventory_reservation_id`,`inventory_allocation_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Inventory refs。 |
| `inventory_balance_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Exact bucket。 |
| `warehouse_id`,`bin_id`,`lot_id` | BIGINT UNSIGNED | lot可NULL | Owner-safe refs。 |
| `bin_code_snapshot`,`lot_number_snapshot` | VARCHAR(100) | NOT NULL／`''` | Pick display。 |
| `expiry_date_snapshot` | DATE | NULL | Confirm時仍重驗。 |
| `stock_status_snapshot` | VARCHAR(20) ASCII | NOT NULL | 必須AVAILABLE。 |
| `selection_strategy` | VARCHAR(20) ASCII | NOT NULL | `FEFO/FIFO`。 |
| `recommended_rank_snapshot` | INT UNSIGNED | NOT NULL | Server rank。 |
| `is_sequence_override` | TINYINT(1) | NOT NULL／0 | 是否偏離。 |
| `override_reason` | VARCHAR(500) | NOT NULL／`''` | 偏離必填。 |
| `recommended_summary` | JSON | NULL | 偏離時最小安全摘要。 |
| `allocated_base_quantity` | BIGINT UNSIGNED | NOT NULL | 原Allocation。 |
| `picked_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Pick Confirm。 |
| `released_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | Short／Cancel release。 |
| `status` | VARCHAR(30) ASCII | NOT NULL | `ACTIVE/PARTIALLY_RELEASED/RELEASED/CONSUMED`。 |
| `inventory_version`,`balance_version` | INT UNSIGNED | NOT NULL | 提交及reconciliation。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

- `UNIQUE(inventory_allocation_id)`、`UNIQUE(fulfillment_line_id,inventory_allocation_id)`。
- `INDEX(fulfillment_id,status,id)`、`INDEX(inventory_reservation_id,status,id)`、`INDEX(inventory_balance_id,status,id)`。
- Projection沒有自由update API；只接受Inventory provider result。

### 4.7 `fulfillment_status_history`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | History ID。 |
| `fulfillment_id` | BIGINT UNSIGNED | NOT NULL／FK CASCADE | Owner。 |
| `sequence_no` | INT UNSIGNED | NOT NULL | Aggregate內順序。 |
| `from_status`,`to_status` | VARCHAR(20) ASCII | from可NULL | Transition。 |
| `action` | VARCHAR(50) ASCII | NOT NULL | CREATE／ALLOCATE／PICK／CANCEL／SHIP／REVERSE。 |
| `reason` | VARCHAR(500) | NOT NULL／`''` | Safe business reason。 |
| `event_id` | CHAR(36) ASCII | NOT NULL | Domain event。 |
| `version_after` | INT UNSIGNED | NOT NULL | Result version。 |
| `actor_user_id`,`actor_label` | BIGINT UNSIGNED／VARCHAR(190) | ID可NULL | Actor snapshot。 |
| `occurred_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(fulfillment_id,sequence_no)`、`UNIQUE(fulfillment_id,event_id,action)`、`INDEX(fulfillment_id,occurred_at,id)`；append-only。

### 4.8 `shipments`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Shipment ID。 |
| `shipment_number` | VARCHAR(24) ASCII | NOT NULL | 唯一不可重用。 |
| `fulfillment_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | 單一Fulfillment。 |
| `sales_order_id`,`customer_id`,`warehouse_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Denormalized owner，提交時核對。 |
| `status` | VARCHAR(20) ASCII | NOT NULL／`DRAFT` | `DRAFT/SHIPPING/SHIPPED/CANCELLED/REVERSING/REVERSED`。 |
| `effective_fulfillment_id` | BIGINT UNSIGNED GENERATED | `IF(status='CANCELLED',NULL,fulfillment_id)` STORED | DB層限制最多一張非Cancelled Shipment。 |
| `shipping_address_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Customer保存地址；Draft亦必須選擇。 |
| `shipping_address_version` | INT UNSIGNED | NOT NULL | Confirm optimistic check。 |
| `shipping_contact_id` | BIGINT UNSIGNED | NULL／FK RESTRICT | 選填。 |
| `shipping_contact_version` | INT UNSIGNED | NULL | Contact選用時必填。 |
| `customer_code_snapshot`,`customer_name_snapshot` | VARCHAR(100)／VARCHAR(190) | NOT NULL／`''` | Confirm成功才凍結。 |
| `address_name_snapshot`,`recipient_company_snapshot`,`recipient_name_snapshot` | VARCHAR(190) | NOT NULL／`''` | 必要出貨抬頭。 |
| `address_line1_snapshot`,`address_line2_snapshot`,`address_line3_snapshot` | VARCHAR(255) | NOT NULL／`''` | 地址文字。 |
| `city_snapshot`,`region_snapshot`,`postal_code_snapshot`,`country_code_snapshot` | VARCHAR(190)／VARCHAR(190)／VARCHAR(40)／CHAR(2) | NOT NULL／`''` | 地址快照。 |
| `contact_name_snapshot`,`contact_phone_snapshot`,`contact_email_snapshot` | VARCHAR(190)／VARCHAR(100)／VARCHAR(254) | NOT NULL／`''` | 未選Contact則空。 |
| `carrier_name` | VARCHAR(190) | NOT NULL／`''` | 選填自由文字；不建Carrier Master。 |
| `tracking_number` | VARCHAR(190) | NOT NULL／`''` | 選填；Customer／Carrier內不要求unique。 |
| `package_count` | INT UNSIGNED | NULL | 輸入時>0。 |
| `total_weight` | DECIMAL(20,6) | NULL | 輸入時>0。 |
| `weight_uom` | VARCHAR(20) ASCII | NOT NULL／`''` | 有weight時server allowlist，否則空。 |
| `notes` | VARCHAR(2000) | NOT NULL／`''` | 選填。 |
| `line_count` | SMALLINT UNSIGNED | NOT NULL | 1～100。 |
| `shipment_date` | DATE | NULL | Confirm成功的APP_TIME_ZONE日期。 |
| `confirmation_event_id`,`reversal_event_id` | CHAR(36) ASCII | NULL | 當前durable intent。 |
| `correlation_id` | CHAR(36) ASCII | NULL | Processing／support。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Aggregate CAS。 |
| `shipped_at`,`cancelled_at`,`reversed_at` | BIGINT UNSIGNED | NULL | Milestones。 |
| `shipped_by`,`cancelled_by`,`reversed_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |
| `cancel_reason` | VARCHAR(500) | NOT NULL／`''` | Cancel Draft。 |
| `last_business_updated_at` | BIGINT UNSIGNED | NOT NULL | Archive cutoff。 |
| `created_at`,`updated_at`,`created_by`,`updated_by` | BIGINT UNSIGNED | actor可NULL | Audit columns。 |

- `UNIQUE(shipment_number)`、`UNIQUE(id,fulfillment_id)`、`UNIQUE(effective_fulfillment_id)`、`UNIQUE(confirmation_event_id)`、`UNIQUE(reversal_event_id)`；NULL可多個。
- `INDEX(fulfillment_id,status,id)`、`INDEX(sales_order_id,status,id)`、`INDEX(customer_id,shipped_at,id)`。
- `INDEX(warehouse_id,status,shipped_at,id)`、`INDEX(tracking_number,shipped_at,id)`、`INDEX(status,last_business_updated_at,id)`。
- Service確保snapshot在DRAFT為空、SHIPPED／REVERSING／REVERSED完整；一般API不可提交snapshot欄位。

### 4.9 `shipment_lines`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Shipment Line ID。 |
| `shipment_id`,`fulfillment_id`,`fulfillment_line_id` | BIGINT UNSIGNED | NOT NULL | Composite ownership FKs。 |
| `line_no` | SMALLINT UNSIGNED | NOT NULL | 1～100。 |
| `sales_order_line_id`,`sku_id`,`base_uom_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Source identities。 |
| `sku_code_snapshot`,`sku_name_snapshot`,`base_uom_code_snapshot` | VARCHAR(190)／VARCHAR(190)／VARCHAR(100) | NOT NULL | Confirm snapshot。 |
| `shipped_base_quantity` | BIGINT UNSIGNED | NOT NULL | 必須等於Fulfillment picked。 |
| `reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL／0 | 0或Shipped。 |
| `created_at`,`updated_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(shipment_id,line_no)`、`UNIQUE(shipment_id,fulfillment_line_id)`、`UNIQUE(id,shipment_id)`；索引`(sales_order_line_id,shipment_id,id)`及`(sku_id,shipment_id,id)`。

### 4.10 `shipment_issue_details`

每筆對應一個成功Inventory Issue leg／Allocation，建立後append-only。

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Detail ID。 |
| `shipment_id`,`shipment_line_id` | BIGINT UNSIGNED | NOT NULL | Composite owner。 |
| `fulfillment_allocation_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Fulfillment projection。 |
| `inventory_operation_id`,`inventory_movement_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Inventory truth refs。 |
| `inventory_reservation_id`,`inventory_allocation_id`,`inventory_balance_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | Exact source。 |
| `warehouse_id`,`bin_id`,`lot_id` | BIGINT UNSIGNED | lot可NULL | Exact bucket identities。 |
| `warehouse_code_snapshot`,`bin_code_snapshot`,`lot_number_snapshot` | VARCHAR(100) | NOT NULL／`''` | 歷史顯示。 |
| `expiry_date_snapshot` | DATE | NULL | Lot expiry。 |
| `stock_status_snapshot` | VARCHAR(20) ASCII | NOT NULL | 原status。 |
| `sku_code_snapshot`,`base_uom_code_snapshot` | VARCHAR(190)／VARCHAR(100) | NOT NULL | Item snapshot。 |
| `issued_base_quantity` | BIGINT UNSIGNED | NOT NULL | 正整數。 |
| `reversal_movement_id` | BIGINT UNSIGNED | NULL／FK RESTRICT | 成功Reversal後唯一回填欄；只可NULL→value。 |
| `created_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(inventory_movement_id)`、`UNIQUE(inventory_allocation_id)`、`UNIQUE(reversal_movement_id)`、`INDEX(shipment_id,shipment_line_id,id)`。Trigger只容許Reversal Service設定一次`reversal_movement_id`，其他欄不可改。

### 4.11 `shipment_status_history`

欄位與§4.7同形，以`shipment_id`為owner；action allowlist為`CREATE/UPDATE/CANCEL/CONFIRM_START/CONFIRM/CONFIRM_FAIL/REVERSE_START/REVERSE/REVERSE_FAIL`。`UNIQUE(shipment_id,sequence_no)`及`UNIQUE(shipment_id,event_id,action)`；append-only。

### 4.12 `shipment_reversals`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Reversal attempt ID。 |
| `reversal_number` | VARCHAR(24) ASCII | NOT NULL／UNIQUE | 每次已claim意圖唯一，不重用。 |
| `shipment_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | 原Shipment。 |
| `effective_shipment_id` | BIGINT UNSIGNED GENERATED | `IF(status IN ('REVERSING','REVERSED'),shipment_id,NULL)` STORED | 防同時／重複有效Reversal。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `REVERSING/REVERSED/FAILED`。 |
| `event_id`,`correlation_id` | CHAR(36) ASCII | NOT NULL | Domain identities。 |
| `reason` | VARCHAR(500) | NOT NULL | 5～500字。 |
| `goods_under_company_control` | TINYINT(1) | NOT NULL | 必須1。 |
| `goods_returned_to_original_bins` | TINYINT(1) | NOT NULL | 必須1。 |
| `failure_code` | VARCHAR(80) ASCII | NOT NULL／`''` | FAILED safe code。 |
| `before_summary`,`after_summary` | JSON | NULL | 數量及狀態摘要，不含完整地址。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Recovery CAS。 |
| `created_at`,`completed_at` | BIGINT UNSIGNED | completed可NULL | 時間。 |
| `created_by`,`completed_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Actor。 |

`UNIQUE(event_id)`、`UNIQUE(effective_shipment_id)`、`INDEX(shipment_id,created_at,id)`。FAILED row不阻止修正後的新event；Audit及Operation保存所有失敗嘗試。

### 4.13 `shipment_reversal_details`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Detail ID。 |
| `reversal_id`,`shipment_id`,`shipment_issue_detail_id` | BIGINT UNSIGNED | NOT NULL | Composite owner及原Issue。 |
| `inventory_reversal_operation_id`,`inventory_reversal_movement_id` | BIGINT UNSIGNED | NOT NULL／FK RESTRICT | 反向事實。 |
| `inventory_reservation_id`,`warehouse_id`,`bin_id`,`lot_id` | BIGINT UNSIGNED | lot可NULL | 原identities。 |
| `stock_status_snapshot` | VARCHAR(20) ASCII | NOT NULL | 原status。 |
| `reversed_base_quantity` | BIGINT UNSIGNED | NOT NULL | 必須等於原Issue quantity。 |
| `reservation_before_summary`,`reservation_after_summary` | JSON | NOT NULL | Safe version／quantity evidence。 |
| `created_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`UNIQUE(shipment_issue_detail_id)`、`UNIQUE(inventory_reversal_movement_id)`、`INDEX(reversal_id,id)`；append-only。

### 4.14 `fulfillment_operation_requests`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Operation ID。 |
| `event_id` | CHAR(36) ASCII | NOT NULL／UNIQUE | 全Fulfillment domain唯一。 |
| `operation_type` | VARCHAR(50) ASCII | NOT NULL | CREATE／ALLOCATE／PICK／SHIP／REVERSE等allowlist。 |
| `target_type`,`target_id` | VARCHAR(30) ASCII／BIGINT UNSIGNED | target可NULL | Fulfillment／Shipment／Export。 |
| `payload_hash` | CHAR(64) ASCII | NOT NULL | Canonical SHA-256。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `IN_PROGRESS/SUCCEEDED/FAILED`。 |
| `result_json` | JSON | NULL | Stable replay-safe result。 |
| `public_error_code`,`public_error_details` | VARCHAR(80) ASCII／JSON | code預設`''` | Safe failure。 |
| `lease_owner` | VARCHAR(190) ASCII | NOT NULL／`''` | Recovery instance。 |
| `lease_expires_at`,`next_attempt_at` | BIGINT UNSIGNED | NULL | Durable retry。 |
| `attempt_count` | INT UNSIGNED | NOT NULL／0 | Technical attempts。 |
| `correlation_id` | CHAR(36) ASCII | NOT NULL | Logs／UI。 |
| `is_document_archived` | TINYINT(1) | NOT NULL／0 | Archive routing hint。 |
| `created_at`,`updated_at`,`completed_at` | BIGINT UNSIGNED | completed可NULL | 時間。 |
| `initiated_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | 原actor。 |

Indexes：`(status,lease_expires_at,next_attempt_at,id)`、`(target_type,target_id,status,id)`、`(is_document_archived,updated_at,id)`。Operation與business effect在相同transaction更新；Phase A本身是獨立已commit intent。

### 4.15 `fulfillment_audit_logs`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Audit ID。 |
| `target_type`,`target_id` | VARCHAR(30) ASCII／BIGINT UNSIGNED | NOT NULL | Aggregate／job。 |
| `action` | VARCHAR(60) ASCII | NOT NULL | Server allowlist。 |
| `event_id`,`correlation_id` | CHAR(36) ASCII | event可NULL | Trace。 |
| `actor_user_id`,`actor_label` | BIGINT UNSIGNED／VARCHAR(190) | ID可NULL | Human／service。 |
| `before_summary`,`after_summary`,`details` | JSON | NULL | Bounded safe evidence。 |
| `ip_address` | VARCHAR(45) ASCII | NOT NULL／`''` | 適用HTTP操作。 |
| `is_archived` | TINYINT(1) | NOT NULL／0 | Archive routing。 |
| `occurred_at` | BIGINT UNSIGNED | NOT NULL | Epoch ms。 |

`INDEX(target_type,target_id,occurred_at,id)`、`INDEX(action,occurred_at,id)`、`INDEX(event_id,id)`；不保存password、token、銀行資料或完整address payload。

### 4.16 `fulfillment_export_jobs`

| Column | Type | Null／Default | 說明 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Job ID。 |
| `export_type` | VARCHAR(30) ASCII | NOT NULL | FULFILLMENTS／SHIPMENTS／ARCHIVE。 |
| `filter_json`,`filter_hash` | JSON／CHAR(64) ASCII | NOT NULL | Server canonical allowlist。 |
| `status` | VARCHAR(20) ASCII | NOT NULL | `QUEUED/PROCESSING/COMPLETED/FAILED/CANCELLED`。 |
| `cursor_json` | JSON | NULL | Keyset resume。 |
| `row_count` | BIGINT UNSIGNED | NOT NULL／0 | Output count。 |
| `stored_name`,`sha256` | VARCHAR(255) ASCII／CHAR(64) ASCII | NOT NULL／`''` | Private file。 |
| `expires_at` | BIGINT UNSIGNED | NULL | 有限下載期。 |
| `failure_code` | VARCHAR(80) ASCII | NOT NULL／`''` | Safe error。 |
| `version` | INT UNSIGNED | NOT NULL／1 | Worker CAS。 |
| `created_at`,`updated_at`,`completed_at` | BIGINT UNSIGNED | completed可NULL | 時間。 |
| `created_by` | BIGINT UNSIGNED | NULL／FK users SET NULL | Owner。 |

`INDEX(created_by,status,created_at,id)`、`INDEX(status,updated_at,id)`、`INDEX(expires_at,id)`。下載驗owner及fresh permission；檔案只在private configured root。

### 4.17 Archive Tables及Manifest

由Sales的`sales_archive_batches`及`sales_archive_order_manifests`統一協調。Fulfillment建立以下mirror：

- `fulfillments_archive`
- `fulfillment_lines_archive`
- `fulfillment_line_reservation_claims_archive`
- `fulfillment_allocations_archive`
- `fulfillment_status_history_archive`
- `shipments_archive`
- `shipment_lines_archive`
- `shipment_issue_details_archive`
- `shipment_status_history_archive`
- `shipment_reversals_archive`
- `shipment_reversal_details_archive`
- `fulfillment_audit_logs_archive`

每張mirror保留Active原ID及所有業務欄位，移除對Active master的FK，另加：

| Column | Type | 說明 |
| --- | --- | --- |
| `archive_batch_id` | BIGINT UNSIGNED | FK `sales_archive_batches` RESTRICT。 |
| `archived_at` | BIGINT UNSIGNED | 搬移時間。 |
| `row_hash` | CHAR(64) ASCII | 固定欄序、normalized quantity／date／UTF-8的SHA-256。 |

Archive header indexes支援唯一number、SO、Customer＋date、Warehouse＋date、Tracking exact及`archive_batch_id`；所有Archive tables有BEFORE UPDATE／DELETE trigger拒絕變更。若相同ID已存在，hash相同視為unknown-outcome recovery，hash不同回`ARCHIVE_DATA_CONFLICT`並保留Active。

### 4.18 FK建立次序及不可變保護

1. 先建Sequence、Operation、Fulfillment Headers／Lines／Claims。
2. 建Shipment Headers／Lines、Issue、History、Reversal tables。
3. 以ALTER加入`fulfillments.active_shipment_id` circular composite FK。
4. 建Audit、Export及Archive mirrors。
5. 在Sales／Inventory tables已存在後補cross-module FK；未存在時Migration不得以無FK的service guard假裝完成，必須由相依Phase先落地。
6. 建quantity、history、issue、reversal及archive triggers，並以真MySQL測試。

---

## 5. HTTP API設計

### 5.1 共通契約

- Base path `/api/v1`；JSON field camelCase，enum回UPPER_SNAKE，quantity回decimal string避免精度遺失。
- List統一`page,pageSize,sortBy,descending`及bounded filters；`pageSize`預設20、最大100。
- State-changing route需JWT、fresh actor、business permission、AJV strict schema及framework Idempotency-Key。
- Domain command body另帶`eventId`；update／transition另帶`version`。Client不可提交status、snapshot、calculated quantity或provider result。
- 成功沿用framework response envelope；錯誤沿用`{error:{code,message,details}}`，details只含安全field、currentVersion、statusUrl或correlationId。

### 5.2 Queue及Fulfillment APIs

| Method／Path | Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/fulfillment-queue` | `fulfillment.view` | Sales＋Claim projection；server pagination。 |
| `GET /api/v1/fulfillments` | `fulfillment.view` | Active list／My Recent／Exceptions／Finalized filters。 |
| `POST /api/v1/fulfillments/create` | view＋`fulfillment.operation` | 單SO Lines及quantity，原子建立Claims；201。 |
| `GET /api/v1/fulfillments/:id` | `fulfillment.view` | Header、Lines、Claims summary、Allocations、History、allowedActions。 |
| `POST /api/v1/fulfillments/:id/update` | view＋operation | DRAFT only；完整replace Lines並重建Claims。 |
| `GET /api/v1/fulfillments/:id/allocation-candidates` | view＋operation | Inventory FEFO／FIFO candidates及versions。 |
| `POST /api/v1/fulfillments/:id/allocate` | view＋operation | 全行batch Allocation；偏離FEFO另驗專門permission。 |
| `POST /api/v1/fulfillments/:id/reallocate` | view＋operation | PICKING only；同transaction release舊＋create新。 |
| `POST /api/v1/fulfillments/:id/pick-confirm` | view＋operation | Actual picked＋short reason；全有或全無。 |
| `POST /api/v1/fulfillments/:id/cancel` | view＋operation | DRAFT／PICKING／PICKED；按規則release。 |
| `GET /api/v1/fulfillments/:id/pick-list` | `fulfillment.view` | A4 print projection；只限PICKING及後續可讀狀態。 |

Queue filters：`q,customerId,warehouseId,salesOrderStatus,hasBackorder,hasActiveWork,requestedDateFrom,requestedDateTo,sortBy,descending,page,pageSize`。預設排序`requestedDeliveryDate ASC,orderDate ASC,salesOrderNumber ASC,id ASC`；number exact優先，不做unbounded `%contains%`。

Create body：

```json
{
  "eventId": "d3351050-87d0-4f9b-9913-7c46af35cf50",
  "salesOrderId": 901,
  "salesOrderVersion": 6,
  "lines": [
    { "salesOrderLineId": 902, "plannedBaseQuantity": "8" }
  ],
  "notes": ""
}
```

Response回Fulfillment detail及最新SO quantity summary；不可回其他Customer／Warehouse不可見資料。

Allocate body：

```json
{
  "eventId": "b52ba5b3-68bc-4201-b93c-822927d8ccbf",
  "version": 2,
  "lines": [
    {
      "fulfillmentLineId": 1102,
      "allocations": [
        {
          "inventoryReservationId": 4001,
          "inventoryBalanceId": 7002,
          "balanceVersion": 9,
          "baseQuantity": "8"
        }
      ],
      "overrideReason": ""
    }
  ]
}
```

Client不傳`selectionStrategy`或override type；Inventory按fresh完整推薦序列判定。

Pick Confirm body（Short reason以Fulfillment Line為單位，不要求每個Allocation重複輸入）：

```json
{
  "eventId": "74856b46-eddb-49ef-b751-beb1ef84ac55",
  "version": 3,
  "lines": [
    {
      "fulfillmentLineId": 1102,
      "shortPickReason": "現場少兩件",
      "allocations": [
        {
          "fulfillmentAllocationId": 3101,
          "inventoryAllocationVersion": 4,
          "pickedBaseQuantity": "6"
        }
      ]
    }
  ]
}
```

### 5.3 Shipment APIs

| Method／Path | Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/shipments` | `fulfillment.view` | Active／Finalized list；server pagination。 |
| `POST /api/v1/fulfillments/:id/shipments/create` | view＋operation | PICKED only；建立或replay active Shipment。 |
| `GET /api/v1/shipments/:id` | `fulfillment.view` | Lines、address／contact、issues、history、reversal、allowedActions。 |
| `POST /api/v1/shipments/:id/update` | view＋operation | DRAFT only；物流及Customer child IDs。 |
| `POST /api/v1/shipments/:id/cancel` | view＋operation | DRAFT only；清Fulfillment active pointer。 |
| `POST /api/v1/shipments/:id/confirm` | view＋operation | Phase A＋同步Phase B；200或202。 |
| `POST /api/v1/shipments/:id/reverse` | view＋`fulfillment.reverse` | 整張Reversal；200或202。 |
| `GET /api/v1/shipments/:id/delivery-note` | `fulfillment.view` | A4 Delivery Note／Packing List projection。 |

Shipment filters：`q,salesOrderId,customerId,warehouseId,status[],shipmentDateFrom,shipmentDateTo,carrier,trackingNumber,sortBy,descending,page,pageSize`。Tracking Number提供exact path；模糊search限制在Active及bounded date。

Create／Update body：

```json
{
  "eventId": "e8b0ab78-dce1-43cf-9cf8-79c04db4f4b8",
  "version": 2,
  "shippingAddressId": 501,
  "shippingAddressVersion": 7,
  "shippingContactId": 601,
  "shippingContactVersion": 3,
  "carrierName": "",
  "trackingNumber": "",
  "packageCount": null,
  "totalWeight": null,
  "weightUom": "",
  "notes": ""
}
```

Create不送`version`；Contact相關欄位須同為NULL或同為正整數。Weight與Weight UOM成對；packageCount為正整數。

Confirm body：`{eventId,version}`。200回`{outcome:"SHIPPED",shipment,inventoryMovementIds,salesOrder}`；202回：

```json
{
  "outcome": "SHIPPING",
  "operationId": 8801,
  "eventId": "c2e7f6b5-5b56-46f9-83cc-0ce21382bd8c",
  "correlationId": "b5e03d47-e9fc-4b17-9d78-d19f06897a6e",
  "statusUrl": "/api/v1/fulfillment-operations/by-event/c2e7f6b5-5b56-46f9-83cc-0ce21382bd8c",
  "retryAfterSeconds": 2
}
```

Reverse body：

```json
{
  "eventId": "ca0704c7-113b-4bb0-b2c9-873af9bd120f",
  "version": 8,
  "reason": "錯誤確認出貨，貨物仍在倉內",
  "goodsUnderCompanyControl": true,
  "goodsReturnedToOriginalBins": true
}
```

不接受line／quantity／target Bin；任何多餘欄位由strict schema拒絕。

### 5.4 Customer／Item Lookup APIs

| Path | Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/fulfillment-lookups/customers/:customerId/shipping-addresses` | view＋operation | Customer provider active shipping地址；default first。 |
| `GET /api/v1/fulfillment-lookups/customers/:customerId/shipping-contacts` | view＋operation | Active shipping contacts；可為空。 |
| `GET /api/v1/fulfillment-lookups/warehouses/:warehouseId/bins` | view＋operation | 只作顯示；Allocation資格仍由candidate contract。 |

Lookup handler驗Fulfillment permission及父SO Customer／Warehouse ownership；不要求使用者另持`customer.view`、`item.view`或`inventory.view`。

### 5.5 Operation、Export及Archive APIs

| Method／Path | Permission | 行為 |
| --- | --- | --- |
| `GET /api/v1/fulfillment-operations/by-event/:eventId` | 對應target view＋owner-safe | SUCCEEDED／FAILED／IN_PROGRESS安全結果。 |
| `POST /api/v1/fulfillment-exports/create` | `fulfillment.view` | 建立本人bounded export job；202。 |
| `GET /api/v1/fulfillment-exports` | `fulfillment.view` | 本人jobs。 |
| `GET /api/v1/fulfillment-exports/:id` | owner＋view | Safe status。 |
| `GET /api/v1/fulfillment-exports/:id/download` | owner＋fresh view | Private CSV；Audit後stream。 |
| `GET /api/v1/archived-fulfillments` | `fulfillment.view` | Archive-only bounded filters。 |
| `GET /api/v1/archived-fulfillments/:id` | `fulfillment.view` | 唯讀detail。 |
| `GET /api/v1/archived-shipments` | `fulfillment.view` | Archive-only bounded filters。 |
| `GET /api/v1/archived-shipments/:id` | `fulfillment.view` | 唯讀detail及Reversal。 |

Archive list至少要number exact、SO number、Customer或≤366日date range其中一項；禁止空條件全掃描。Active 404只回`mayExistInArchive`安全提示，不自動union Archive。

### 5.6 Stable Error Catalogue

| HTTP | Code | 條件 |
| --- | --- | --- |
| 400 | `FULFILLMENT_INPUT_INVALID`、`FULFILLMENT_QUANTITY_INVALID` | Schema、0／負數／小數／超safe range。 |
| 403 | `FULFILLMENT_PERMISSION_DENIED`、`FEFO_OVERRIDE_DENIED`、`PERMISSION_STALE` | 權限不足或已撤權。 |
| 404 | `FULFILLMENT_NOT_FOUND`、`SHIPMENT_NOT_FOUND` | 不存在或owner不符；不洩漏。 |
| 409 | `FULFILLMENT_STATE_CONFLICT`、`SHIPMENT_STATE_CONFLICT`、`VERSION_CONFLICT` | 狀態／CAS。 |
| 409 | `FULFILLABLE_QUANTITY_CHANGED`、`RESERVATION_CLAIM_CONFLICT` | Reservation或其他工作已佔量。 |
| 409 | `ALLOCATION_CANDIDATE_CHANGED`、`ALLOCATION_INSUFFICIENT` | Bucket／version／quantity失效。 |
| 409 | `PICK_SEQUENCE_REASON_REQUIRED`、`FEFO_OVERRIDE_REQUIRED` | FIFO缺原因；FEFO缺權／原因。 |
| 409 | `SHORT_PICK_REASON_REQUIRED`、`PICK_RESULT_INVALID` | Pick Confirm規則。 |
| 409 | `SHIPPING_ADDRESS_CHANGED`、`SHIPPING_ADDRESS_UNAVAILABLE` | Address ownership／purpose／version。 |
| 409 | `SHIPMENT_ALREADY_EXISTS`、`SHIPMENT_ALREADY_REVERSED` | 唯一性；相同event則replay。 |
| 409 | `IDEMPOTENCY_CONFLICT`、`FULFILLMENT_SOURCE_CONFLICT` | 同key／event不同payload。 |
| 409 | `CONCURRENT_OPERATION`、`DOWNSTREAM_MATTER_BLOCKS_REVERSAL` | Lock競爭或不可逆事項。 |
| 409 | `ORIGINAL_BUCKET_UNAVAILABLE` | Reversal原Bin／Lot不能合法回補。 |
| 409 | `SERIAL_TRACKING_UNSUPPORTED` | 本期Serial防護。 |
| 503 | `FULFILLMENT_DEPENDENCY_UNAVAILABLE` | Sales／Customer／Item／Inventory不可用。 |
| 503/202 | `DATABASE_TRANSACTION_INDETERMINATE` | Commit結果不明；帶status URL／correlation。 |
| 410 | `EXPORT_RESULT_EXPIRED` | Job在但檔案已清理。 |

Public message使用繁體中文且提供下一步；不回SQL、constraint、stack、完整路徑或其他Customer資料。

---

## 6. Internal Provider／Consumer Contracts

所有write contract接收現有MySQL transaction executor及可信command context；沒有transaction立即throw `TypeError`。Caller handler先驗自己的business permission，provider再按固定purpose重驗actor及owner，不能讓caller傳任意permission name自稱已授權。

共通command：

```js
{
  actor: { userId, serviceName, claimedRoles, claimedPermissions },
  authorization: { purpose },
  source: {
    module: "fulfillment",
    documentType: "SHIPMENT",
    documentId: "2401",
    lineId: "",
    eventId: "ca0704c7-113b-4bb0-b2c9-873af9bd120f"
  },
  correlationId,
  payload
}
```

IDs及quantities在跨模組JSON contract使用decimal string；進入已驗證service後才轉safe integer／BigInt策略，絕不經浮點運算。

### 6.1 Sales Contracts

```js
SalesFulfillmentService.getOrderForFulfillment(orderId, { atMs })
SalesFulfillmentService.lockLinesForFulfillmentInTransaction(transaction, command)
SalesFulfillmentService.applyFulfillmentResultInTransaction(transaction, command)
```

`getOrderForFulfillment()`回purpose-limited projection：

```js
{
  orderId, orderNumber, status, version,
  customer: { id, code, name },
  warehouse: { id, code, name },
  lines: [{
    lineId, lineNo, skuId, skuCode, skuName,
    baseUomId, baseUomCode, trackingPolicy, minimumSaleLifeDays,
    orderedBaseQuantity, reservedOutstandingBaseQuantity,
    backorderedBaseQuantity, fulfilledBaseQuantity, cancelledBaseQuantity,
    reservationMappings: [{
      salesReservationMappingId, inventoryReservationId,
      outstandingBaseQuantity, inventoryVersion
    }]
  }]
}
```

只接受`CONFIRMED／PARTIALLY_FULFILLED`且positive outstanding Reservation；純Backorder不回可選量。`lockLinesForFulfillmentInTransaction()`要求完整line IDs、expected order／line versions，按ID排序鎖定並回fresh projection。

`applyFulfillmentResultInTransaction()` command：

```js
{
  action: "SHIPMENT_CONFIRMED" | "SHIPMENT_REVERSED",
  salesOrderId,
  shipmentId,
  lines: [{
    salesOrderLineId,
    baseQuantity,
    reservations: [{
      inventoryReservationId,
      baseQuantity,
      inventoryVersion,
      inventoryOperationId
    }]
  }]
}
```

- Confirm：Reserved減、Fulfilled加；Reversal：Fulfilled減、同一Reservation outstanding加。
- Provider驗line set、mapping ownership、quantity及Inventory versions；缺漏或超額回`SALES_FULFILLMENT_CONTRACT_MISMATCH`並rollback。
- 回`{orderId,status,version,lines:[quantity projections]}`；Fulfillment用result保存before／after，不自行推算。

### 6.2 Inventory Contracts

```js
InventoryLookupService.listAllocationCandidates(transaction, query)
InventoryReservationService.allocateForFulfillmentBatchInTransaction(transaction, command)
InventoryReservationService.releaseFulfillmentAllocationsInTransaction(transaction, command)
InventoryPostingService.postFulfillmentIssueBatchInTransaction(transaction, command)
InventoryPostingService.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(transaction, command)
```

Candidate query包含Warehouse、SKU、Reservation IDs、minimum remaining days、requested quantities及asOf；Inventory回完整bounded候選、`selectionStrategy`、rank、eligibility及versions。Fulfillment不能自行計FEFO／FIFO。

Allocation batch payload包含每個source Fulfillment Line、Claim、Reservation、Balance及quantity。Inventory：

1. 驗Reservation scope／outstanding、SKU、Warehouse及source。
2. 產生有Expiry先FEFO、其後FIFO的完整序列。
3. 比較所選集合；FIFO偏離驗trusted Fulfillment operation actor＋reason，FEFO偏離另驗fresh `inventory.fefo.override`。
4. 按Inventory lock order整批建立Allocation及Audit。
5. 回每個Inventory Allocation、Balance／Reservation versions、策略、rank及recommended summary。

Release batch只接受本Fulfillment擁有的Allocation及正數quantity；Reallocate在一個transaction先release舊再allocate新，中途失敗保留原結果。

Issue batch要求selected allocation set與picked projection完全相等；回Movement、Operation、Reservation／Allocation versions及每bucket snapshot。

專用Reversal batch：

- 只接受原Shipment Issue IDs及原Inventory Movement／Reservation／Allocation refs，不接受caller指定bucket。
- 驗原Movement未反向、貨物回原Bin可入庫、Bin未停用／Counting、Lot／Status相同及Shipment source一致。
- 建相反Movement回原bucket；原Reservation `consumed -= quantity, outstanding += quantity`並重算status/version。
- 原Allocation保持Consumed；不減其consumed、不增加outstanding。
- 每個原Issue最多一個reversal movement；整批任一失敗rollback。
- Generic `/inventory/movements/:id/reverse`不能調用此專用能力。

### 6.3 Customer Contracts

沿用Customer Management已設計接口：

```js
CustomerLookupService.listAddresses(customerId, { purpose: "shipping", atMs })
CustomerLookupService.assertAddressUsableInTransaction(transaction, customerId, addressId, { purpose: "shipping", expectedVersion, atMs })
CustomerLookupService.listContacts(customerId, { purpose: "shipping", atMs })
CustomerLookupService.assertContactUsableInTransaction(transaction, customerId, contactId, { purpose: "shipping", expectedVersion, atMs })
```

List只供UI；Confirm必須在Phase B transaction重做assert並驗expected version。Address必須屬父SO Customer、Active及有shipping purpose；Contact選填但選用時同樣重驗。Provider回白名單snapshot fields，不回銀行資料或其他用途child。

### 6.4 Item Contracts

```js
ItemLookupService.findManyByIds(skuIds, { purpose: "inventory", atMs })
ItemLookupService.assertUsable(skuId, { purpose: "inventory", atMs })
```

Projection包含SKU／Item status、code／name、Base UOM、inventoryTracked、trackingPolicy及minimumSaleLifeDays。建立Fulfillment、Allocation及Confirm都拒絕`serial`、Archived、非inventory tracked或不符合Inventory規則的SKU；歷史detail使用snapshot，不因現在Inactive而消失。

### 6.5 Archive及Downstream Matter Contracts

```js
FulfillmentOpenMatterService.getOrderArchiveStatus(orderId, { atMs })
FulfillmentOpenMatterService.assertSalesLifecycleAllowedInTransaction(transaction, command)
FulfillmentArchiveParticipant.archiveOrderInTransaction(transaction, command)
FulfillmentDownstreamMatterService.assertShipmentReversibleInTransaction(transaction, command)
```

`getOrderArchiveStatus()`回：

```js
{ status: "CLOSED" | "OPEN" | "UNKNOWN", reasonCodes: [] }
```

PICKING、PICKED、SHIPPING、REVERSING、active Claim、outstanding Allocation、IN_PROGRESS operation均回OPEN；provider故障回UNKNOWN。`archiveOrderInTransaction()`只可由Sales Archive Service使用，接收order ID、archive batch、cutoff及expected manifest；回逐tablecount/hash及routing refs。

`assertSalesLifecycleAllowedInTransaction()`由已鎖Sales Order／Lines的withdraw／cancel／close remaining流程呼叫；它按Fulfillment ID鎖相關非terminal工作及Claims。任何active工作回`OPEN_FULFILLMENT_EXISTS`，依賴失效回UNKNOWN／503，不能讓Sales先行release Reservation。固定lock order仍為Sales → Fulfillment → Inventory。

Returns／Invoicing未上線時，Downstream Matter registry顯式註冊`NO_PROVIDER_REQUIRED`版本。對應模組上線後必須成為required provider；缺失或UNKNOWN即阻止Reversal／Archive，不可默認false。

---

## 7. 權限、安全及資料保護

### 7.1 Permission Matrix

| 能力 | `fulfillment.view` | `fulfillment.operation` | `fulfillment.reverse` | `inventory.fefo.override` |
| --- | --- | --- | --- | --- |
| Queue／Active／Archive查詢 | 必須 | — | — | — |
| 建立／更新Fulfillment | 必須 | 必須 | — | — |
| Allocation／Reallocation／Pick／Cancel／Shipment Confirm | 必須 | 必須 | — | FEFO偏離時另須 |
| FIFO偏離 | 必須 | 必須＋原因 | — | 不需要 |
| Shipment Reversal | 必須 | 不需要 | 必須＋原因及兩項確認 | 不需要 |
| Print／本人Export | 必須 | — | — | — |

- Permissions獨立加入`permissionCatalogue.js`、seed migration、role UI及convention tests；System Administrator不因名稱自動取得。
- 每次write／job開始時從DB重讀Active actor及permission；JWT claims只作初步拒絕。
- 下游internal call以Fulfillment handler的business permission授權，不要求倉務角色取得Inventory／Customer管理頁權限。

### 7.2 Authentication及高風險操作

- 一般建立、Allocation、Pick、Shipment Confirm使用JWT＋fresh permission；需求沒有要求額外password，不擅自增加。
- Reversal使用JWT＋fresh `fulfillment.reverse`＋5～500字原因＋兩個server-required boolean confirmations；不把checkbox當授權替代品。
- 若未來法規要求device-password，須先更新Requirement；本期API schema不接受password欄位。

### 7.3 Ownership及IDOR防護

- 所有child query以`child_id + parent_id`或composite FK查詢；先確認父aggregate權限，不以單一child ID跨owner讀取。
- Address／Contact必須由父SO customer scope查找；Bin／Lot／Balance必須由父Warehouse＋SKU＋Reservation scope驗證。
- Not found及not visible對外統一404；不得透露其他Customer、Warehouse或Archived record存在性。
- Sort field、status、view及export columns用server allowlist；SQL全部parameterized。

### 7.4 XSS、CSV、Log及Download

- Vue不使用`v-html`顯示Notes、Reasons、Carrier、Tracking或snapshot；瀏覽器列印同樣text escape。
- CSV cell以RFC 4180 escape，首字符為`= + - @ TAB CR`時前置單引號。
- Logger profiles對address lines、phone、email及任何credential field redaction；業務log只保存IDs、counts、safe code及correlation。
- Print／download response使用`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`及安全filename。
- Export path resolve後必須位於configured private root；拒絕symlink、path traversal及expired file。

### 7.5 Abuse Cases

必測：替換SO／Line／Reservation／Allocation／Address／Shipment／Movement ID；同event改quantity／reason；繞過FEFO權限；以FIFO reason偽裝FEFO；雙擊Confirm／Reverse；巨大filters／page size；CSV formula；Archive空條件掃描；直接呼叫Inventory專用internal command；在Counting／Inactive Bin回補。

---

## 8. Backend Service設計及算法

### 8.1 `FulfillmentQueueService`

- 使用Sales purpose-specific projection，不join全部Sales child tables。
- 先以Sales covering index取得bounded Order IDs，再批量取Lines／Mappings及Fulfillment active Claim SUM，避免N+1及Cartesian count。
- `fulfillable = inventory reservation outstanding - active claim sum`；任何負值是critical reconciliation error，不以0掩蓋。
- Stable sort最後加Sales Order ID；頁面filters與export共用同一normalized filter builder。

### 8.2 `FulfillmentService`

- `create()`在鎖Sales mappings後按mapping ID分配Claims；同一SO Line可跨多筆Reservation，但不能claim Backorder。
- `update()`只限DRAFT，完整replace selected Lines；先計新舊claim delta，在同transaction鎖所有受影響mappings後更新，不能先release再讓競爭者穿透。
- `cancel()`：DRAFT release Claims；PICKING／PICKED先驗reason及goods returned，再Inventory batch release outstanding Allocations，成功後Claim active轉released。
- Number、status、snapshot、versions及quantity projections永不接受client輸入。

### 8.3 `FulfillmentAllocationService`

- 批量收集全部reservation demands，一次取Item profiles及Inventory candidates。
- 先驗client selected set完整及無duplicate，再交Inventory判定sequence；不在Fulfillment複製eligibility算法。
- Inventory回傳line set必須與request完全相等，且每Claim allocated總和等於active claim；不一致回`INVENTORY_CONTRACT_MISMATCH`及critical metric。
- Reallocate以單event、單transaction完成release＋create；History保存舊／新摘要及例外理由。

### 8.4 `FulfillmentPickingService`

- `confirmPick()`驗每筆Inventory Allocation version及exact ID set；遺漏一筆視為input invalid，不把缺漏當0。
- Short quantity按Allocation release，對應Claim active減少、released增加；各Line彙總picked／short及保存一個Line reason。
- 對同event replay使用operation result，不重讀現在Allocation後重新計算。
- 全0回`PICK_RESULT_INVALID`並提示取消；不自動取消，避免隱藏actor intent。

### 8.5 `ShipmentService`

- `createDraft()`鎖Fulfillment；若active pointer存在，same create intent replay原結果，其他event回existing Shipment summary。
- 使用Customer list contract預設唯一有效default address／contact；沒有address不建空地址Shipment，UI可留在PICKED並連Customer維護。
- `updateDraft()`重驗child ownership及version；不提前保存address snapshot。
- `cancelDraft()`鎖Shipment＋Fulfillment，status轉Cancelled並清active pointer；Picked data／Allocations不變。

### 8.6 `ShipmentConfirmationService`

`startConfirmation()`執行§2.6 Phase A；`completeConfirmation(eventId)`：

1. Lock operation並驗payload hash／lease；從target refs取得Sales及Fulfillment IDs。
2. 按全域順序鎖Sales Order／Lines／Mappings、Fulfillment／Claims、Shipment／Lines。
3. Fresh actor及`fulfillment.operation`；重驗SO不為Cancelled／Closed／Archived，Fulfillment=PICKED，Shipment=SHIPPING。
4. Customer assert address／contact及versions；Item batch assert非Serial；所有provider unavailable fail closed。
5. 建exact Issue command：每個picked Allocation一行，按Reservation／Balance ID排序。
6. Inventory batch Issue；驗result set、quantity、bucket及versions。
7. Sales apply `SHIPMENT_CONFIRMED`；驗quantity projection。
8. 保存Shipment／Line／Issue snapshots及histories；Claim active→consumed；Fulfillment／Shipment→SHIPPED。
9. Operation SUCCEEDED保存bounded replay result並commit。

若步驟3～5是永久business error，同transaction寫operation FAILED並Shipment回DRAFT；步驟6～9throw則整個Phase B rollback，保留Phase A SHIPPING供Recovery。只有可以證明未commit的deadlock／validation可安全返回；connection lost一律indeterminate。

### 8.7 `ShipmentReversalService`

`startReversal()`先驗body、fresh permission及兩項confirmation，Phase A插入Reversal row、claim operation並令Shipment REVERSING。`completeReversal(eventId)`：

1. Lock operation、Sales、Fulfillment、Shipment、Reversal及全部Issue details。
2. 重驗未歸檔、未Reversed、goods flags、Downstream Matter=CLOSED及原Issue完整。
3. Inventory專用batch command回補及restore原Reservation；驗每個原Issue恰有一個result。
4. Sales apply `SHIPMENT_REVERSED`；CLOSED／COMPLETED按§3.6重開。
5. Claims保留consumed並設定reversed；Issue details只填一次reversal movement；寫Reversal details。
6. Shipment／Fulfillment／Reversal→REVERSED；Operation SUCCEEDED及Audit。

Business failure在同transaction令Reversal FAILED、Shipment回SHIPPED並保存safe reason；失敗attempt的number不重用。Technical unknown保留REVERSING及同event lease。

### 8.8 `FulfillmentOperationService`

- `claim(eventId,type,target,payload)`以unique insert原子claim；canonical hash固定key排序、decimal normalization、UTF-8 bytes。
- Existing same hash：SUCCEEDED／FAILED replay；IN_PROGRESS回202；different hash回`FULFILLMENT_SOURCE_CONFLICT`。
- Lease compare-and-set需existing event、expired lease及matching target；Recovery不改payload／actor。
- Operation result不保存完整地址或100行完整details，只保存target IDs、versions、status及status URL；detail另由authorized endpoint讀取。

### 8.9 Inquiry、Print及Export Services

- Detail分批查Header → Lines → Claims／Allocations或Issues → Histories，避免多child join笛卡兒積。
- `allowedActions`由server按fresh status＋permission計算；Frontend只作顯示，不取代route authorization。
- Print projection使用snapshot及current document status；REVERSED固定顯眼文字／watermark，不顯示price、tax、cost、bank或internal errors。
- Export使用keyset cursor、stream writer及atomic temp rename；限制row count／duration，截斷時明確summary，不靜默漏資料。

### 8.10 `FulfillmentArchiveParticipant`

- `getOrderArchiveStatus()`以`(sales_order_id,status,id)`及operation indexes做bounded EXISTS，不載完整aggregate。
- Participant只接受Sales Archive service identity及已傳入transaction；不公開HTTP archive mutation。
- Lock Fulfillment roots按ID；重驗所有terminal、無active pointer矛盾、無outstanding Allocation／Claim及無IN_PROGRESS operation。
- 以固定table／column order計counts及row hashes，insert archive parents再children；read-back驗證後才delete active children／parents。
- Archive copy須先保存原`active_shipment_id`；校驗成功後以archive-only受控update清空Active pointer，才可依FK順序刪Shipment children／Shipment／Fulfillment。這個技術清理不得產生新的business history或改`last_business_updated_at`。
- Operation rows不搬移，改`is_document_archived=1`以保留event outcome；Audit搬至archive並保留event link。
- Sales manifest同時保存Sales及Fulfillment table counts／hashes；任一不符rollback。

### 8.11 `FulfillmentReconciliationService`

提供只讀CLI／scheduled service，不提供自動修復API：

- SO Reserved／Fulfilled對Sales Reservation mapping及Shipment Issues。
- Inventory Reservation outstanding／consumed對Sales mapping及Claims。
- Inventory Allocation outstanding／consumed對Fulfillment Allocation projection。
- Inventory Movement source對Shipment Issue／Reversal details。
- Fulfillment／Shipment state、active pointer及quantity equations。
- Active／Archive唯一routing及manifest counts／hashes。

Mismatch輸出internal IDs、safe codes、counts及correlation，不輸出完整地址；修復須另行批准的forward script及前後證據。

---

## 9. 具體程式碼及Migration變更設計

### 9.1 Server新增結構

```text
server/src/modules/fulfillment/
  fulfillmentConstants.js
  fulfillmentErrors.js
  fulfillmentValidation.js
  fulfillmentQuantityMath.js
  FulfillmentOperationService.js
  FulfillmentQueueService.js
  FulfillmentService.js
  FulfillmentAllocationService.js
  FulfillmentPickingService.js
  ShipmentService.js
  ShipmentConfirmationService.js
  ShipmentReversalService.js
  FulfillmentInquiryService.js
  FulfillmentPrintService.js
  FulfillmentExportService.js
  FulfillmentArchiveParticipant.js
  FulfillmentOpenMatterService.js
  FulfillmentAuditService.js
  FulfillmentReconciliationService.js

server/src/handlers/fulfillments/
server/src/handlers/shipments/
server/src/handlers/fulfillment-lookups/
server/src/handlers/fulfillment-operations/
server/src/handlers/fulfillment-exports/
server/src/handlers/archived-fulfillments/
server/src/handlers/archived-shipments/

server/src/services/scheduler/jobs/
  ShipmentConfirmationRecoveryJob.js
  ShipmentReversalRecoveryJob.js
  FulfillmentExportJob.js
  FulfillmentReconciliationJob.js
```

Handler按resource分schema file；不建一個巨型`fulfillmentSchemas.js`涵蓋全部API。Pure quantity／state／candidate comparison helper不讀DB，方便branch-complete unit tests。

### 9.2 Server既有檔案修改

| 區域 | 修改 |
| --- | --- |
| Authorization | Permission catalogue及seed加入三個Fulfillment permissions；更新permission convention tests。 |
| Configuration | 加Fulfillment limits、operation lease、export、archive query及reconciliation設定，startup fail-fast驗證。 |
| Scheduler | 註冊兩個Recovery、Export及Reconciliation jobs；Sales Archive Job註冊Fulfillment participant。 |
| Logging | 新事件名稱及address/contact redaction；不得記完整payload。 |
| Sales module | 落地§6.1 confirm／reverse contract、state recalculation及archive participant coordination。 |
| Inventory module | 落地§6.2 sequence、batch Issue及專用Reversal／Reservation restore。 |
| Item／Customer | 只補consumer contract tests或缺失的transaction-aware assert；不複製規則。 |
| Coverage floors | 高風險Confirmation、Reversal、Operation及Archive services加入per-file門檻。 |

### 9.3 Migration邏輯切片

實際序號由實作當日main決定，不能沿用本文件示例或其他尚未合併設計的預留號：

1. Fulfillment permissions、sequences、operation requests。
2. Fulfillment headers、lines、reservation claims、history。
3. Inventory FIFO anchor及generic sequence override欄位／indexes；不得破壞既有資料，backfill規則需在實作時按真資料確認。
4. Fulfillment allocations及cross-module FK。
5. Shipment headers／lines、active shipment circular FK、history。
6. Issue details、Reversal headers／details及不可變trigger。
7. Audit、Export jobs、config defaults。
8. Archive mirrors、hash／immutability triggers及Sales manifest擴充。

每片向前可重跑或由migration registry保護；正式資料存在後不以down migration drop table，rollback採application rollback＋forward corrective migration。

### 9.4 Client新增結構

```text
client/src/pages/fulfillment/
  FulfillmentQueuePage.vue
  FulfillmentsPage.vue
  FulfillmentDetailPage.vue
  ShipmentListPage.vue
  ShipmentDetailPage.vue
  FulfillmentArchivePage.vue
  FulfillmentArchiveDetailPage.vue
  ShipmentArchiveDetailPage.vue
  PickListPrintPage.vue
  DeliveryNotePrintPage.vue

client/src/components/fulfillment/
  FulfillmentCreatePanel.vue
  AllocationPanel.vue
  PickConfirmationPanel.vue
  ShipmentFormPanel.vue
  ShipmentConfirmationSummary.vue
  ShipmentReversalDialog.vue
  FulfillmentQuantitySummary.vue
  FulfillmentHistory.vue

client/src/services/
  fulfillment.js
  shipment.js
```

不新增另一套table、form、notify或permission framework；共用現有元件與`can()`。

---

## 10. 前端頁面及互動設計

### 10.1 Route及頁面

| Route | Page | 行為 |
| --- | --- | --- |
| `/fulfillment/queue` | Queue | Warehouse／date／SO filters；選Lines建立工作。 |
| `/fulfillments` | Work List | Tabs：My Recent、Active、Exceptions、Finalized；server pagination。 |
| `/fulfillments/:id` | Detail | Quantity、Claims、Allocations、History及狀態相關actions。 |
| `/shipments` | Shipment List | Shipment／tracking／date filters。 |
| `/shipments/:id` | Shipment Detail | Address、lines、issues、reversal及documents。 |
| `/fulfillment/archive` | Archive Search | 強制number／customer／date其中一項。 |
| `/fulfillment/archive/:id` | Archive Detail | 唯讀Fulfillment及related Shipment。 |
| `/fulfillments/:id/pick-list/print` | Pick Print | A4 browser print。 |
| `/shipments/:id/delivery-note/print` | Delivery Print | A4；REVERSED明確標記。 |

所有頁面export `page` metadata、route permission及menu group；literal routes不得被`/:id`影子覆蓋，加入discovery order test。

### 10.2 Queue／Create UX

- `PageHeader`＋Warehouse filter＋`DataTable sticky-actions`；filter、page、sort同步URL。
- 每張SO展開Line時顯示Ordered、Reserved、Backorder、Fulfilled、Already Planned及Fulfillable。
- Planned輸入只接受Base UOM正整數，前端即時限制但submit以server為準。
- Version conflict保留使用者輸入，顯示最新quantity及「重新載入」；不自動改成較小quantity提交。
- 無資料區分「沒有可履約訂單」與filter沒有結果。

### 10.3 Allocation／Picking UX

- Allocation Panel以Bin／Lot作主要視覺，顯示Expiry、remaining days、First Receipt、Available、rank及建議量。
- 預設帶入server建議；改選時先顯示差異。任何偏離要求reason；FEFO偏離在無專門權限時禁用submit並解釋。
- Error精確對應Fulfillment Line／Allocation；Inventory candidate changed時整批reload，不靜默換bucket。
- Pick List按Bin、Lot、SKU穩定排序；長值用`EllipsisCell`，print顯示完整安全文字。
- Pick Confirm逐Allocation輸入actual；Short即顯示差額會返回Queue，`FormPanel`集中錯誤及focus。

### 10.4 Shipment UX

- 建立Shipment預選Customer唯一有效default Shipping Address及Contact；可改其他active shipping child。
- 無地址時顯示阻擋及Customer detail link，不提供free-text欄。
- Confirm前顯示Customer、Address、Warehouse、SKU、Bin／Lot、Quantity及「此動作會正式扣庫存」。
- Carrier、Tracking、Package、Weight選填；只有填值時驗證配對。
- SHIPPING／REVERSING顯示processing banner、Correlation ID、最後嘗試及「查詢原結果」，不顯示再次提交新event。

### 10.5 Reversal UX

- Dialog清楚寫明只用於貨物仍由公司控制的錯誤出貨，不是Customer Return。
- 顯示整張Shipment全部lines／original bins及Inventory／SO影響，不提供checkbox選line。
- Reason及兩項確認必填；按鈕只對`fulfillment.reverse`顯示，後端仍獨立驗權。
- 成功後detail及所有print／export顯示`REVERSED`；原Delivery Note不可看似有效。

### 10.6 Accessibility及Responsive

- 每頁一個由`PageHeader`提供的`h1`；dialog／panel用正確`h2`，不能只用styled div。
- 所有field有label／help／error association；提交錯誤focus到`role=alert`摘要。
- Loading帶`aria-busy`；status badge有文字，不以顏色作唯一訊息；focus visible。
- 375／768px將多欄表轉成可橫向scroll的DataTable，action column sticky；不隱藏quantity或status。
- Keyboard可完成filter、line選取、Allocation、Pick、Shipment及Reversal；dialog有合理focus trap及return focus。

---

## 11. 測試設計

### 11.1 Unit Tests

| Test file／area | 覆蓋 |
| --- | --- |
| `fulfillmentStateMachines.test.js` | 全合法／非法Fulfillment、Shipment、Reversal transitions。 |
| `fulfillmentQuantityMath.test.js` | Lines、Claims、Short、Issue、Reversal equations及boundary。 |
| `pickSequence.test.js` | FEFO、FIFO、mixed Expiry、stable tie-break、override分類。 |
| `fulfillmentOperationService.test.js` | Claim、same hash replay、different hash conflict、lease。 |
| `shipmentConfirmationService.test.js` | Provider ordering、result set mismatch、business／technical failure。 |
| `shipmentReversalService.test.js` | 原bucket、Reservation restore、Allocation不重開、CLOSED reopen。 |
| `fulfillmentArchiveParticipant.test.js` | eligibility、manifest、same hash recovery、different hash conflict。 |
| `fulfillmentPermissions.test.js` | view／operation／reverse／FEFO組合。 |

每個狀態轉換、數量不變量、idempotency branch及permission branch至少一正一反；高風險四個services建議lines≥95%、branches≥90%、functions≥90%，不得降低全域既有floor。

### 11.2 真MySQL Integration Tests

- Migration從乾淨schema及最新pre-feature schema均成功；FK、generated unique、trigger、indexes存在。
- 兩個Create同時claim同一Reservation，最多一個超出前成功；active claims總和不超outstanding。
- Multi-line Allocation任一不足全部rollback；On Hand及SO Fulfilled不變。
- Reallocate release後create失敗，原Allocation完整保留。
- Pick Short release差額且Reservation outstanding不變；Claim及Queue正確。
- Shipment Confirm多Line／Bin／Lot任一驗證失敗，沒有部分Movement、Consume、SO update或SHIPPED。
- Phase A後process crash，Recovery用原event完成一次；commit connection lost查回唯一結果。
- Concurrent Confirm／Cancel／Reallocate、Confirm／Inventory adjustment遵守lock order且不負數。
- Reversal全部bucket回補、原Reservation restored、Allocation仍Consumed、Sales quantity及states一致。
- Reversal遇Inactive／Counting Bin、已reversed Movement或不可逆downstream全部rollback。
- CLOSED SO Reversal保留Cancelled、恢復Reserved並重開；History不改寫。
- Active Shipment pointer：同時create最多一張；Cancel後可新建；Shipped／Reversed不可在原Fulfillment新建。
- Archive copy／hash／delete原子；中斷重跑、same hash、conflict、provider UNKNOWN及Archive unavailable。

### 11.3 API Contract Tests

- 每個route的auth、permission、schema strictness、response schema、pagination及stable errors。
- State-changing endpoint真正honourIdempotency-Key；same key different payload 409。
- Domain event IN_PROGRESS回202＋status URL；success／failure replay固定結果。
- Literal lookup／archive／operation routes不被`/:id`攔截。
- Print／download headers、safe filename、owner check及no-store。
- Not found／IDOR不洩漏resource是否存在。

### 11.4 Provider Consumer Contract Tests

- Sales line／reservation projection field、status、version及confirm／reverse result完全匹配。
- Inventory mixed Expiry排序、FIFO anchor、override permission、batch set及專用Reversal語意匹配。
- Customer list後停用／改用途／改owner／改version，Confirm必須失敗。
- Item改為Serial／Archived／非tracked，三個submit point拒絕。
- Provider回缺line、duplicate、wrong quantity、wrong owner或unknown field時fail closed並critical alert。

### 11.5 Frontend Tests

- Route permission及sidebar visibility；直接URL 403。
- Queue filters／pagination／URL state、stale quantity conflict及input保留。
- Allocation預設建議、FIFO reason、FEFO permission、candidate reload及Short errors。
- Default address/contact、no-address block、optional logistics、version conflict。
- SHIPPING／REVERSING status polling不建立新event；success後reload正確。
- Reversal dialog無部分選項、兩confirmation、REVERSED print mark。
- Keyboard、focus、alert、heading、badge text、375／768／1024／1440 snapshots／DOM checks。

### 11.6 Security Tests

- Horizontal／vertical IDOR matrix涵蓋SO、Fulfillment Line、Claim、Allocation、Shipment、Address、Movement及Archive。
- JWT撤權後submit、job start及recovery actor policy；service identity只能執行固定purpose。
- XSS strings在detail／print不執行；CSV formula及CRLF安全。
- Logs／errors不含address payload、phone、email、token、SQL或stack。
- 專用Inventory Reversal沒有HTTP入口，直接未授權調用被拒絕。

### 11.7 Performance及容量測試

資料集至少：

- 730萬Active Fulfillments及730萬Active Shipments；另建25% SO分2～4次出貨的較高header場景。
- 平均5 Lines、P95 30、最大100；每Line平均2 Allocation、P95 6，混合Expiry／Lot／Bin。
- 50名互動使用者與Sales Import、Backorder、Export、Archive並行。

門檻：Queue／Active list／number exact P95≤2秒；100行Allocate／Pick／Confirm／Reverse P95≤3秒或3秒內202；Archive exact≤3秒、Customer＋366日≤5秒；print preview≤3秒。保存EXPLAIN、rows examined、lock wait、pool usage及heap evidence，不能以縮小資料集通過。

### 11.8 Backup、Restore及Reconciliation

- 備份Active／Archive、Operations、Sales mapping、Inventory truth及routing；隔離環境restore。
- 對每個Shipment由SO → Fulfillment → Allocation → Issue／Reversal Movement雙向追溯。
- Archive manifest逐table count/hash一致且Active不存在。
- 任何mismatch只報告，不以測試／job直接修資料。

---

## 12. 設定、Scheduler、Observability及Runbook

### 12.1 Configuration

```js
fulfillment: {
  maxLinesPerDocument: 100,
  maxAllocationsPerLine: 50,
  defaultPageSize: 20,
  maxPageSize: 100,
  operationLeaseMs: 60_000,
  recoveryBatchSize: 100,
  exportBatchSize: 1_000,
  exportMaxRows: 250_000,
  exportRetentionHours: 24,
  archiveQueryMaxRangeDays: 366,
  reconciliationBatchSize: 500
}
```

Number format、APP_TIME_ZONE、Archive 24 months／7 years及Sales Archive schedule沿用中央／Sales設定，不建立重複可漂移參數。Startup驗所有數值正整數、batch不超pool／timeout安全範圍及private paths可用。

### 12.2 Scheduler Jobs

| Job | Cluster／頻率 | 行為 |
| --- | --- | --- |
| Confirm recovery | cluster lease／每分鐘 | 接管過期SHIPPING operations，原event續跑。 |
| Reversal recovery | cluster lease／每分鐘 | 接管過期REVERSING operations。 |
| Export worker | cluster lease／短interval | Bounded keyset、stream、resume。 |
| Reconciliation | cluster lease／每日off-peak | Bounded read-only差異報告。 |
| Archive participant | 由Sales monthly job呼叫 | 不自行排程。 |

所有job尊重AbortSignal；process shutdown只在當前transaction結束後停止。Business validation failure不無限retry；transient failure exponential backoff＋jitter；unknown commit先lookup source outcome。

### 12.3 Structured Events及Metrics

Events至少：

```text
fulfillment.created / updated / allocated / reallocated
fulfillment.pick_confirmed / short_picked / cancelled
shipment.created / updated / confirm_started / shipped / confirm_failed
shipment.reversal_started / reversed / reversal_failed
fulfillment.operation_replayed / conflict / recovery_claimed
fulfillment.export_started / completed / failed
fulfillment.archive_started / archived / skipped / conflict
fulfillment.reconciliation_mismatch
```

Metrics：Queue depth／age、Fulfillments created、Short Pick rate、FEFO／FIFO overrides、confirm／reversal latency及outcome、SHIPPING／REVERSING age、lock wait／deadlock、provider failure、export queue、archive counts／duration、reconciliation mismatches。

Alert：processing超過lease＋grace、recovery連續失敗、source conflict、Inventory contract mismatch、negative／overclaim detection、archive hash conflict、provider UNKNOWN持續、reconciliation mismatch及monthly archive未完成。

### 12.4 Runbooks

- Stuck SHIPPING：以event lookup判斷SUCCEEDED／FAILED／IN_PROGRESS；不得手工再Issue。
- Stuck REVERSING：核對原Issue及Inventory source operation；不得以generic reversal替代。
- Claim mismatch：凍結相關SO Fulfillment create，保存鎖／operation證據，先reconciliation再forward fix。
- FEFO dispute：保存candidate snapshot、actual selection、permission及reason；不直接改Allocation。
- Archive conflict：停止該order搬移，保留Active，核對兩邊hash；不`INSERT IGNORE`。
- Restore validation：核對Sales／Fulfillment／Inventory及Active／Archive manifests後才開放寫流量。

---

## 13. 實作Phase、部署及Rollback

### Phase 0 — Contracts、Schema及Quantity Proof

目標：Permission、tables、state／quantity pure rules、Sales／Inventory／Customer／Item contracts及真MySQL lock proof。

驗證：Migration、FK／trigger、provider contract、雙人Claim競爭、mixed Expiry及Serial rejection。獨立PR及一次完整Phase測試。

### Phase 1 — Queue、Fulfillment及Picking

目標：Queue → DRAFT → Allocation → PICKING → Pick／Short → PICKED，包含取消及Pick List。

驗證：權限、overclaim、多Line／Bin／Lot、reallocate、Short、idempotency、print及Inventory Allocation對賬。獨立PR。

### Phase 2 — Shipment及Atomic Issue

目標：地址選擇、Shipment Draft、Phase A／B Confirm、Inventory Issue、Sales update、Delivery Note及Recovery。

驗證：地址變更、optional logistics、100行原子出庫、timeout／commit unknown、double click及SO state。獨立PR。

### Phase 3 — Reversal、Archive及Release Evidence

目標：整張Reversal、CLOSED重開、Active／Archive inquiry、Export、Reconciliation、observability及runbooks。

驗證：原bucket／Reservation restore、Allocation不重開、downstream block、730萬容量、archive中斷、backup restore及security regression。獨立PR。

### 13.1 Deployment Order

1. 先合併／部署Sales及Inventory additive provider contracts與schema支援，舊consumer不受影響。
2. 執行Fulfillment Active migrations及permission seed；功能仍不顯示。
3. 部署Server read APIs及Phase 1，完成reconciliation baseline後開權限。
4. 部署Shipment Confirm及Recovery jobs；先小量warehouse角色。
5. 部署Reversal；由Supervisor角色pilot。
6. 建Archive mirrors並做production-like dry-run；hash/count及restore證據完成才註冊Sales participant。

### 13.2 Rollback

- Application可回上一版，但已配置numbers、Claims、Allocations、Operations、Issues、Reversals及Archive資料不可刪除。
- 若Confirm／Reversal異常，停新mutation route及Recovery claim，保留查詢和operation evidence；不得手工改status假裝回退。
- Archive conflict停Job，已commit aggregate不搬回Active；以routing及唯讀查詢維持，另作forward repair。
- 有正式資料後只用forward migration修正，不drop或改寫ledger／history。

---

## 14. 需求追溯及交付檢查

### 14.1 Traceability

| Requirement | 設計／驗證 |
| --- | --- |
| FR-QUEUE-001～012 | §§2.3、3.4、4.3～4.5、5.2、8.1～8.2；Unit／MySQL／Queue UI tests。 |
| FR-PICK-001～012 | §§2.4、3.5、4.6、5.2、6.2、8.3、10.3；sequence／Allocation tests。 |
| FR-PICKCONF-001～010 | §§2.4、3.3～3.4、5.2、8.4；Short／release／idempotency tests。 |
| FR-SHIP-001～012 | §§2.5、4.8～4.9、5.3～5.4、6.3、8.5、10.4。 |
| FR-CONF-001～016 | §§2.6、3.5～3.7、4.10、5.3、6.1～6.4、8.6；atomic／recovery tests。 |
| FR-LIFE-001～005 | §§2.4～2.5、3.1～3.2、8.2／8.5。 |
| FR-REV-001～012 | §§2.7、3.2／3.6、4.12～4.13、5.3、6.1～6.5、8.7、10.5。 |
| FR-INQ／DOC／EXPORT／AUDIT | §§4.15～4.16、5.2～5.5、7.4、8.9、10；API／UI／security tests。 |
| FR-ARC-001～010 | §§2.7、4.17、5.5、6.5、8.10、11.2／11.8、12～13。 |
| BR-001～036 | §§2～8的number、ownership、quantity、state、snapshot及archive invariants。 |
| SEC-001～012 | §7及§11.3～11.6。 |
| NFR-PERF-001～007 | §§4 indexes、8 bounded algorithms、11.7、12 metrics。 |
| AC-001～056 | §11所有測試層及Phase驗證；每個AC在後續`test_case.md`建立一對一case ID。 |

### 14.2 Implementation Readiness Checklist

- [ ] Requirement權限勘誤已同步，無重複條文。
- [ ] Sales Confirm／Reverse及Archive participant contracts已同步至Sales design。
- [ ] Inventory FEFO／FIFO、FIFO anchor及專用Reversal contracts已同步至Inventory design。
- [ ] 所有table有PK、FK、ownership、unique、index、version及archive語意。
- [ ] 每個write API有permission、strict schema、event、version、idempotency及stable error。
- [ ] Phase A／B、lock order、commit unknown及Recovery有真MySQL測試設計。
- [ ] Frontend routes、components、responsive、accessibility及print contract完整。
- [ ] 730萬Active容量、50-user concurrency、archive及restore驗證不可被縮減。
- [ ] 沒有加入Out of Scope能力、額外dependency或未確認approval流程。
- [ ] Migration實作時按最新main分配序號，不使用設計階段預留號。

本文件沒有未決設計問題；如未來加入Returns、Invoicing、Carrier、Serial或多SO Shipment，必須先更新Requirement、provider contracts、state machine、Archive eligibility及驗收案例。

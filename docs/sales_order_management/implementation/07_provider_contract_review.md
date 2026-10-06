# TASK-009–011 契約對齊與審查

## 範圍、基線與結論

2026-10-02，Sam 回覆「繼續」，授權 TASK-009–011 的契約對齊與審查。此文件是可審查的方案，不是 provider owner 採納、產品實作授權、migration 配額、SQL 執行或部分 Phase 合併例外。現有產品實作範圍仍為 TASK-001–008。

Sales candidate：`062c1880605a966086a0d8ec2702ff097027af58`，PR #174 OPEN DRAFT，repository CI run `36700077774` 五項 PASS。最新 fetched main：`29893c304eac11716b1758d9b5e25bd8f0080a7e`；相對已整合的 `ad27a18` 只增加 Supplier 文件，Customer／Item／Inventory／Business Master provider source 相同。此輪沒有合併 main 到 candidate，也没有改動產品程式。

DESIGN：`a2a10a5ce6102a0a6c059d1b896e747a3643a2e711be357340204c9ba3067781`；PLAN：`98dd16b2de8a9c69364c20affe0d4d8730247deb4e49bdbbcf1d749751089f0d`。既有核准保留原 hash；本次 review scope 不替代新的跨模組契約決策。

結論：**契約審查完成；產品實作 readiness 為 CHANGES_REQUIRED。** 原規格需要下列明確修正及 owner 決策，不能直接以現有單行 provider 組合冒充完整契約。

## 已觀察到的差異

| 項目 | 現況及來源 | 實作前必須處理 |
| --- | --- | --- |
| Customer 確認快照 | `CustomerLookupService.findById/getCreditPolicy` 使用 configured database；`atMs` 只驗型別，沒有同一 caller transaction 或 current row lock。狀態為小寫；Customer version 與 policyVersion 分開；Payment Term 只有 ID。 | 同交易鎖定 Customer／credit，取得明確版本及安全快照；Currency／Payment Term 使用既有 Business Master provider。 |
| Item Sales projection | `findManyByIds` 固定兩個 pool query，但沒有數量上限；沒有 SKU-UOM mapping ID、UOM status／name、Item／SKU versions 或 price。`purpose:"sale"` 允許部分 discontinued；`new_sale` 是未知 purpose。 | 新增具名、有界、同交易的 Sales projection；明確採用 Active-only，保留 generic sale 規則。 |
| Item mapping identity | `ItemAdminService.updateSku` 先UPDATE SKU，再DELETE全部barcode/UOM mappings並重建新ID（§source lines485–634）；Sales quotation/order lines設計有 `sku_uom_id → item_sku_uoms` RESTRICT FK。 | Sales有引用後，連只改price的SKU update都可能因delete被拒絕；同association必須保留mapping ID，不能只增加lookup。 |
| Inventory batch | 只有 `create/release/cancelSalesReservationInTransaction` 單行 adapter；固定 `sales.operation`。建立全有或全無，minimum life 為 `max(caller, Item)`。 | 新增 owner 內部 batch；一次取得完整鎖 scope，不能 loop 現有單行 public method。新批次權限及 replay 語意須明確採納。 |
| Batch result persistence | `inventory_reservations.create_operation_id` UNIQUE；operation summary 只允許 scalar、最多 8192 bytes。 | 一個 operation 不能建立多筆 Reservation；不能直接塞 batch arrays 或提高 generic summary 上限。採用 root＋line operations 建議。 |
| 全域鎖順序 | Sales §2.8 漏 Customer／credit／Business Master／Item；§7.2 convert 先鎖 Quotation 後取 Sequence，與 §2.8 相反。Inventory 完整順序比 Sales 簡表長。 | 採一份完整表，含 provider、insert／upsert／FK／replay 的隱含鎖；conversion 先取得 sequence。真並發驗證仍必要。 |
| Sequence／Operation | Sales 兩個 foundation tables／services 尚未實作。Framework authenticated identity scope 已處理非 public auth variants。 | 保留原 tables 設計；重用 framework，不預先改 shared IdempotencyService；DB 配額另核對。 |

上述差異是既有設計與 provider 的整合缺口，不是本輪引入的 production defect。

## TASK-009 建議契約

### Customer

保留目前 UI lookup 的 `findById({purpose:"new_sale"})`、`getCreditPolicy()` 及既有用途矩陣。在 Customer owner 內新增具名確認快照：

```js
CustomerLookupService.getSalesSnapshotInTransaction(transaction, customerId, { atMs })
```

要求 caller 已開啟 transaction；provider 不 begin／commit、不讀 pool、不接收任意 executor／table fallback。依序鎖 Customer，再鎖 credit；Customer root lock 防止無 credit row 時的並發新增／clear（現有 credit writer 同樣先鎖 Customer）。回傳 customerId/code/legalName、defaultCurrencyCode、defaultPaymentTermId、customerVersion，以及原樣的 credit configured／limit decimal string／currencyCode／status／policyVersion。不得回銀行、地址、聯絡資料、notes。

資格以 `active`、`on_hold`、`not_configured` 等 owner 實際字面值判斷，Sales 再明確轉成自己的 snapshot enum。Customer 不 active 或 credit on_hold 拒絕確認；未設定 credit 與 limit 0 不混淆，limit 僅 advisory。確認取得當前版本並保存，不要求頁面 lookup 的舊 Customer／credit version 作 CAS，除非正式 input schema 明確要求。

Currency／Payment Term 用 `BusinessMasterProvider.assertCurrencyUsableInTransaction/assertPaymentTermUsableInTransaction`，按採納的全域順序呼叫。鎖定並取得 status／version／code／name；無 default term 保存空 snapshot，不虛構 ID 或文字。不能把兩個 pool reads 視為一致快照。

### Item

保留 `purchase/sale/inventory` 泛用用途，不改变已落地的 discontinued 銷售語意。具名 Sales 入口採原 Sales 設計的 **Item active＋SKU active＋sellable＋有效日期範圍**，serial 行為沿用既有明確限制，不能以 generic inventory usable 代替 Sales 資格。

```js
ItemLookupService.findManyForSale(skuIds, { atMs, purpose: "new_sale" })
ItemLookupService.findSaleUom(skuId, skuUomId, { atMs })
ItemLookupService.getSalesSnapshotsInTransaction(transaction, requests, { atMs })
```

前兩個供原定 lookup；後者供 write／confirmation，`requests` 為 `{skuId, skuUomId}`，去重後最多 100 行；submit 時不逐行呼叫 `findSaleUom`。Owner 回傳每個指定 mapping 的 ID、master uomId、code/name/status、factor 1–1,000,000、default Sale flag，以及 Item／SKU versions、display、tracking/minimumSaleLife、effective dates、suggestedPrice。批量查詢數量為常數（可分 Item／SKU／mapping／UOM 鎖階段），沒有每行 N+1。

SKU-UOM mapping ID 與 master uomId 不可互換；後者是現有 `resolveUomInTransaction` 的參數。價格直接使用 stored `suggested_price_amount` 及現有 `ITEM_PRICE_CURRENCY="HKD"`、`ITEM_PRICE_TAX_BASIS="tax_not_applicable"`，回 decimal string 或 null，不讀 admin HTTP、不自行換匯。不 active／不存在的 UOM 或錯誤 factor fail closed。搜尋入口 `searchForSale` 留在原定 lookup slice，不是 TASK-009 確認契約的 substitute。

Row locks 必須與 Item owner writer、UOM lifecycle／FK 實際順序相容；不能假設僅加 `ORDER BY` 就證明安全。Item／SKU／mapping／UOM 順序需 owner 在下述鎖表採納前定案。

**必要的Item writer相容slice**：`ItemAdminService.updateSku` 對仍存在的 `(skuId, masterUomId)` association更新原mapping row，保留id；新增association才INSERT，移除的mapping在owner既定reference guard／FK保護下處理。Barcode原有owner驗證保留；不能改Sales FK為CASCADE、改用不存在的mapping或關閉constraint來繞過問題。被引用的Base UOM／factor關鍵變更依Item原§8.4契約fail closed／明確錯誤，不憑理由繞過。此是本次確認的新必要shared scope，須把ItemAdminService及相應tests列入採納決策，而非已授權改動。

必要驗證：price-only／名稱修改保留mapping ID、factor及Barcode行為；不帶穩定id的新association正常建立；foreign/cross-SKU mapping id拒絕；已有Sales引用時移除／critical conversion變更安全拒絕；任一步失敗全部rollback。這些是跨模組新引用帶來的真相容性痛點，不做無關Item重構。Sales line schema尚未落地，本輪僅靜態確認預期FK衝突，未宣稱已在實際DB重現。

## TASK-010 建議契約

### 權限、輸入、數量與釋放

保留既有單行 Sales adapter 的 `sales.operation`。建議新的 **manual Sales batch adapter** 固定使用 fresh `sales.mgmt`，source 固定 `SALES/SALES_ORDER`；client 不可指定 permission/module/document type。此是需 Inventory owner／Sam 採納的新安全契約，不是現行事實；不新增自動 role grant、不合成 actor claims。Sales 入口仍自行驗 view／mgmt 及 aggregate 存取權。

Import／background worker delegation 不由此 manual contract 默認授權；其 fresh actor／service principal／原始操作人及 required permission 要在原定後續 Phase 明確定義，仍屬 gate。

```js
InventoryReservationService.reserveAvailableForSalesBatchInTransaction(transaction, command)
InventoryReservationService.releaseSalesBatchInTransaction(transaction, command)
InventoryReservationService.getSalesReservationStatesInTransaction(transaction, query)
```

狀態查詢建議放在現有 ReservationService，不新增只有一個用途的 InventoryLookupService；這是對 Sales §2.4 未實作名稱的明確提案，需 owner 採納。

Reserve input：server-authorized actor/source/correlationId、單 Warehouse、完整唯一 server-owned line IDs、SKU、orderedBaseQuantity、minimumRemainingDays；最多100 demand lines，在 hash／claim／SQL 前限制行數、字串及 JSON bytes；ID／quantity 均 safe integer，數量語意與已實作 Sales quantity/Inventory primitives 一致。Reserve root hash 含 action、target ID/version、Warehouse、完整規範化需求及排序，不受使用者行順序影響。Release input 是已鎖 Sales aggregate 的 order/source、expectedOrderVersion、Warehouse 及明確 ALL_OUTSTANDING 意圖，不能把最多100 SO行誤當最多100 Reservation mappings。

Inventory 一次鎖全部 stock controls，依 `(skuId, sourceLineId)` 處理；每行先計有效 minimum life `max(caller, current Item minimumSaleLifeDays)`，ATP 只含 AVAILABLE／合資格效期。用 `min(ordered, max(rawATP,0))` 建確切 Reservation；同 SKU 後續行扣除本批已預留值；任何 overflow、mismatch 或 technical failure rollback。回每行 `{sourceLineId,skuId,reservedBaseQuantity,uncoveredBaseQuantity,reservationId,version,minimumRemainingDays}`；零預留 `reservationId/version` 為 null，且仍持久化結果。`reserved + uncovered = ordered`。不放寬 generic all-or-none。

release 驗每個 Reservation 的原始 source tuple、order/line/Warehouse/SKU、version、outstanding 與 conserved quantities，完整回每個 mapping；不同來源或漏項整批 rollback。沿用 generic release 對 active allocations 的保護，不能偷偷透過 cancel 清 allocations。呼叫者先完成既定 Fulfillment lifecycle guard；後續 Fulfillment 互鎖仍需其 owner 採納。

**Release完整性與容量獨立於reserve**：一個SO line可有多筆Reservation。由Inventory owner按已授權的order/source，以穩定keyset、每頁最多100 mappings列舉全部outstanding set；不是client送任意ID，也不截斷第一頁。Release child identity固定為 `reservation:<reservationId>`，另保存原sourceLineId；對每個mapping保存發現時的expectedVersion及exact outstanding quantity。Root intent hash綁action/order/expectedOrderVersion/Warehouse/ALL_OUTSTANDING；持久化root membership count/digest另綁完整 `(reservationId,sourceLineId,expectedVersion,releaseQuantity)` 集合，children綁root identity/hash。重試先讀原membership及結果，不依目前已釋放的set重算hash。

所有mapping claims在stock locks之前，以reservation ID排序；取得全Warehouse/Stock Control scope後依相同順序處理，version race整批rollback。分頁只控制查詢／記憶體，不分頁commit。結果由同transaction的bounded page iterator／operation lookup完整消費並驗count/digest，再由Sales完成全部mapping更新；不得宣稱永遠最多101 operations。沒有新total mapping業務上限；大set的transaction時間／鎖資源須量測，逾時整批rollback，不留下成功前幾頁。

### Root＋line operation：保留現有 schema／summary 上限

1. Root source 的 lineId 固定空字串；reserve child使用唯一、非空、server-owned demand lineId；release child使用 `reservation:<reservationId>`，保存原lineId。同order/event/action namespace，不能與root混用；同SO行的多個mappings不共用一個child operation。
2. Reserve root claim hash綁完整canonical demand；release root使用上述穩定ALL_OUTSTANDING intent及原始membership digest。Child claim hash另綁root identity/hash及該行／mapping完整input。新 root/child command types 與 scalar summary fields 由 Inventory owner 明確列名，不借用 generic RESERVATION_CREATE 的不同 payload。
3. Root然後按reserve `(skuId,sourceLineId)`／release reservationId claim全部children，**全部早於任何 Warehouse/stock lock**。真正建立 Reservation 使用其 child operationId，符合 `UNIQUE(create_operation_id)`。
4. Child summary 保存每行安全 scalar 結果（包含零預留）；每筆維持 8192 bytes 限制。Root summary 僅 count／membership digest／target identity；不塞 array，不提高 generic byte floor、不新增 Inventory table。
5. Children 結果與 Reservation／control／audit 同 transaction 寫入；root 最後 complete；沒有 line-only commit。已 complete root 必須可 bounded bulk 查出精確 count、membership/digest 及全 completed children，缺行、額外行或混合狀態 fail closed。
6. Replay 先驗當前 actor／Sales aggregate access 及 immutable source/hash；回原持久化結果，不因 Item／minimum-life 後來改變重新算 ATP 或結果。Sales global event uniqueness 不能代替 replay 存取授權。
7. 一般 failure 整個 caller transaction rollback；commit 後回應遺失以原 event 查完整結果。Commit outcome unknown 不生成新 event 或假定 failure；先查 root/children，無法確定則回原定 retryable conflict。現有 `InventoryOperationService.claim()` 會拒絕 incomplete record，**沒有 lease/recovery protocol**；不能用它聲稱完成 Sales CONFIRMING recovery。

## 全域鎖順序修正提案

下面是 **owner-review candidate 的 NEW_EXECUTION 路徑**，不是已證明／已採納的全域規則。不要只鎖payload前幾行後再補鎖。

**Replay先分支**：在任何Customer／credit／Currency／Item資格重驗前，完成fresh actor／aggregate access及immutable event/request hash核對，查Sales domain operation。已完成則回原safe結果，不再走下表。Inventory batch自身同樣先驗權及root intent/hash；已完成root則bulk/page驗原children完整性，回原結果，不能先跑Item inventory profile或minimum-life驗證。新執行才走下表。

Sales domain unique claim／aggregate鎖序列化相同event；若Inventory claim等待後得到completed replay，立即驗原結果並返回，不再執行mutable master checks或stock mutation。Incomplete／未知結果fail closed並沿用原event查結果；不能因沒有可讀complete結果而啟動第二次新執行。此preflight分支須在實作測試明確覆蓋master停用／policy改變後的replay，不能只在文檔宣稱。

| 階段 | 先後／約束 |
| --- | --- |
| Sales domain | operation/lease → sequence（create/convert）→ external key（intake）→ quotation → order → lines → backorder/mappings；各類 ascending ID。 |
| Customer snapshot | Customer → credit；對 absent credit 的 write 由 Customer root serialization；不可 Currency-first。 |
| Business Master snapshot | Customer/credit後，document-assignment Currency按code、Payment Term按ID，使用現有transaction asserts。Document currency使用new_assignment；advisory credit只保存已鎖credit的原currencyCode，若另取名稱用history purpose，不用new_assignment阻擋inactive advisory currency；不增加不必要lookup。 |
| Item snapshot | Item/SKU/mapping/UOM 的精確 owner 順序需明確採納；於任何 Inventory stock locks 前完成；不能從已持有 Inventory locks 回頭取得新的 Item lock。 |
| Inventory claims | root → 全部 deterministic children；replay duplicate-key/FOR UPDATE 同順序。 |
| Inventory resource | Warehouse → Stock Controls → Bins/active bin locks → Lots → Balances → Reservations → Transfers → Stocktakes → children/current state/audit。必要 FOR SHARE／insert/FK 同樣納入。 |
| Completion | 各 line 結果 → root complete → Sales projections/history/audit/result；全部 caller transaction。 |

`convert` 必須在 Quotation/Lines locks 前取得 SO sequence；驗證失敗 transaction rollback，不先提交序號或空 SO。實作前另逐條對照 create、convert、confirm、release、recovery 的 lock trace；未實作的 future Fulfillment 只保留 Sales → Fulfillment → Inventory 原則，不聲稱已驗證其細節。

已檢查 CustomerCreditService 的 Customer → credit → Currency 及 BusinessMasterProvider 的 FOR UPDATE。跨 master writer、Item FK/UOM mutations、兩種 direction 的 release/fulfillment races仍須完整 lock graph 與 real DB 測試，不能以此 static table 宣稱無死鎖。

## TASK-011 foundation 與執行順序

保留 Sales §4.3 `sales_document_sequences` 的 `UNIQUE(document_type,period_key)`、HKT period、999999 exhaustion／不 rollover，以及 §4.13 `sales_operation_requests` 的 UNIQUE(event_id)、payload conflict、safe result/recovery byte bounds、7 年 retention／本期不 purge。Migration、service、lease/recovery 各自需要實作與真 MySQL 證據；hash helper 或 framework HTTP replay 不代替 domain operation。

重用現有 IdempotencyService：非 public auth variants 已隔離到 authenticated scope，不預先修改。Domain replay 必須再次驗權及 target access；相同 global event 不得洩漏另一 actor 的結果。

先採納契約／鎖圖 → Customer/Item thin slice → Inventory batch slice → 原兩個 Sales foundation migration／test support → 完整 Phase developer/CI/review gates。每個 source slice仍 1–5 個主要檔案；不能把所有 shared code 混成一個大 commit。

Inventory0063–0066 配額保留，Sales permission0067 不變。觀察 active `codex/inventory-p3-operations` HEAD `0d4d0c2` 已有0064 Transfer migration；未合併工作不能被忽略，也不能在 Sales worktree修改。原兩個新 Sales foundation migration **本輪不分配編號、不寫檔、不執行 SQL**，到獲准 schema slice 前 fresh fetch／檢查 active worktrees 配額。

## 驗證需求與已執行結果

| 對象 | 新契約實作後必要證據（本輪未執行） |
| --- | --- |
| Customer | pool query 設為 throw 仍能 caller-transaction 取 snapshot；status/hold/zero/null/version/PII tests；兩連線 status、credit create/clear/update race及 rollback。 |
| Item | 1/100 行固定 query budget、101 拒絕；mapping/master ID不混用；Active/discontinued/effective boundaries；price decimal/HKD/tax/null、UOM status/factor；與 price/status/UOM mutation 並發快照；updateSku保留association ID與既有Sales RESTRICT FK相容、critical/removed mapping保護及rollback。 |
| Inventory | repeated SKU及不同 shelf-life需求、partial/zero ATP、overflow、inactive Warehouse、source/permission/version mismatch；兩個 batches 反向 payload 順序競爭、不超賣；root+child unique/replay/changed/full-membership/rollback/unknown commit outcome。 |
| Lock graph | create↔convert、confirm↔credit/status/Item edits、batch↔receipt/issue/warehouse disable、release↔allocation；lock timeout bounded conflict；FK及insert/upsert traces。 |
| Foundation | fresh/upgrade/rerun/schema mismatch、parallel sequence及exhaustion/HKT boundary、unique event changed hash、authenticated identity variants、actor-safe replay、lease generation/competing recovery、rollback。 |

本輪執行既有 provider/guard unit suites：customerLookupService、customerCreditService、itemLookupService、inventoryProviderContracts、inventoryOperationService、inventoryLockService、idempotencyService；Node test 結果 **93 PASS／0 FAIL／0 SKIP**。它們驗證既有行為，不證明不存在的新 batch／snapshot contracts。私有 log：`/private/tmp/sales-contract-existing-tests.log`；沒有本地 SQL、UI 變更或 formal TC/UAT 執行。

## Reviewer 與待決策

Reviewer：Codex `/root/sales_readiness_review`，SEPARATE_AGENT/read-only，initial review 為 CHANGES_REQUIRED；指出 Customer transaction gap、Item eligibility/mapping gap、permission/batch/replay gap、global-lock-order缺口及conversion矛盾。Root＋line preliminary feedback確認 schema-preserving 方向可供 owner review，要求完整 identity/membership/atomicity/unknown-outcome invariants；不是 owner 採納或 live concurrency PASS。初版proposal `d23eb1eb23a36ff3181a4214b891418ec6cf25494bfbd02dfcc68233f450d498` review CHANGES_REQUESTED：release不能沿用100行cap／line identity；replay不可先做mutable master eligibility；advisory credit currency不能被new_assignment變成blocking。此修正版分別補完整mapping分頁/child identity、NEW_EXECUTION與REPLAY分支、history/advisory語意，待修正版review。

建議一次採納此方案及相應 shared source/test scope：Active-only Sales named projection；Customer transaction snapshot；manual batch 使用 fresh sales.mgmt、舊 sales.operation 不變；root＋line operations保留schema/8KiB上限；修正全域鎖圖/convert順序。代價是新增provider方法；reserve最多101 operation records／100 demand lines，release為1＋完整outstanding mapping數（分頁、單transaction），實作時需量測及證明並發/rollback。替代方案是保留目前草稿，待各 provider owner 完成契約；延後會阻止完整 PHASE-001 exit。未採納前只允許此輪 review/doc 工作。

TASK-009另需上述必要Item writer相容slice（ItemAdminService及對應測試），以免Sales外鍵落地後凍結正常price edits；每個slice仍拆成最多5個主要檔案，不把provider lookup和writer mutation混成一次大改。

即使採納，worker delegation、精確 Item/FK鎖圖、fresh migration allocation及完整 Phase驗證不能省略；後續不另造第四個permission的隱式grant、不擴大summary限制、不提前開Sales UI/jobs。

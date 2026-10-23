# Inventory Purchasing provider v1 — 精確契約候選

Status: PROPOSED / NOT_IMPLEMENTED。Issue #267；owner Inventory / Sam。基線 `e272f5d3ce05d0ca50be42e6d8764f0ef20d3dd1`。
權威需求：Purchasing design §2.4–2.8、§3.5–3.7、§8.7–8.8；Inventory FR031–033／035／037–042、NFR006–009、SEC007–010／013。

## 1. 邊界及交付順序

1. PR-A：`postPurchaseReceiptBatchInTransaction()`、可信提交 context、批次冪等／結果映射、專用測試及 ABI。
2. PR-B：A 合併後從最新 main 建新 worktree；`reversePurchaseReceiptBatchInTransaction()`、獨立 reversal-link migration、專用測試。依賴已合併 A，不依賴 TASK041／P4。

不新增 HTTP route／UI。不修改 Item／Supplier 或 Purchasing 資料；Purchasing 持有 PO／GR 的驗證及 projection 寫入。provider 只寫 Inventory 表並沿用同一 caller transaction。其失敗必須傳播至最外層 withTransaction rollback；不能吞錯後 commit，不在 provider 自行 commit／另開交易／逐行重試。

這兩個方法不以逐行呼叫舊單筆 posting／generic reversal 實作。一般 Inventory／Returns／Fulfillment 入口不增加 existing-commitment 開關。

## 2. ABI 與可信來源

方法回傳 Promise；第一參數必須是同一 request context 中實際 active `REPEATABLE READ` transaction，非只有 query／execute 的物件。兩個方法均為 `(transaction, command)`。

Receipt command 的精確欄位：

```js
{
  context, // server-issued opaque object; excluded from serialization/hash
  actor: { userId, serviceName: "", claimedRoles, claimedPermissions },
  correlationId,
  source: { documentId, eventId }, // GR id string / canonical lowercase UUID
  lines: [{
    sourceLineId, // GR detail id string, unique in batch
    skuId, baseQuantity, warehouseId, binId,
    lotNumber, expiryDate, manufactureDate, stockStatus,
    commitment: {
      purchaseOrderId, purchaseOrderLineId, confirmedVersion,
      skuId, inventoryTrackedSnapshot: true, trackingPolicySnapshot,
      baseUomIdSnapshot, baseUomCodeSnapshot,
      minimumReceiptLifeDaysSnapshot, skuExceptionReason
    },
    minimumLifeEvidence: null // or { reason, minimumLifeDaysApplied, actualRemainingLifeDays }
  }]
}
```

Reversal command：相同 context／actor／correlationId／source（documentId 為新 reversal header ID），新增 `goodsReceiptId`、`reasonText`，lines 精確為 `{ sourceLineId, originalSourceLineId, originalMovementId, baseQuantity }`；sourceLineId 是新 reversal detail ID。每次1–200行；本次同 originalMovementId 只一行。receipt 同一 physical bucket 可由不同 PO line 收入，必須按 bucket 合計及逐行結果更新；同一 PO line＋physical dimension 重複拒絕。

所有物件拒絕額外欄位；provider 固定 module=`PURCHASING_RECEIVING`，documentType=`GOODS_RECEIPT`／`GOODS_RECEIPT_REVERSAL`，purpose／permission 不能由 command 提供。數量和數值 ID 為正 safe integer；來源 ID 為非零十進位字串且須可安全轉換；不把不安全 BIGINT 轉 Number。qty 合計、balance、version 溢位 fail closed。tracking 只接受 none／batch／batch_expiry；serial 維持不支援。

回傳 `{ status: "POSTED", operationId, lines }`；root operationId 及每行 `{ sourceLineId, operationId, movementId, movementGroupId, baseQuantity }` 全部必要。Reversal 行另含 `originalMovementId`。結果行與輸入 sourceLineId 集合完全相等，依輸入順序回傳，不能 missing／extra／重複。相同已完成事件 replay 從原 per-line scalar summaries 解碼，不能用現在 Balance 重建。

### Context 介面及責任

新增 Inventory-owned `InventoryPurchaseContext.js`，提供 `issuePurchaseReceiptContext(req, transaction, command, confirmedLines, options)`／`issuePurchaseReversalContext(req, transaction, command, options)`。它們在實際已認證 handler 路徑發行一次性 WeakMap capsule；command.context 不納入 intent hash，其餘完整標準化意圖、actor、來源、transaction、request及 deadline 綁定。consume 後只可在同次 provider call 使用，重送需新 request 認證及 capsule。JSON仿造／跨 actor／跨transaction／變更任一行或快照均拒絕。

Receipt 固定 POST `/api/v1/goods-receipts/:id/confirm`、jwt、`purchasing.view`＋`receiving.operation`，`req.input.params.id` 必須精確等於 source.documentId。Reversal 固定 POST `/api/v1/goods-receipts/:id/reversals/create`、jwt-device-password、`purchasing.view`＋`inventory.adjust`，params.id 必須精確等於 goodsReceiptId，保持現有密碼及 device 驗證流程。一般 receiving／purchasing role 無調整權限不能反向。不賦予 inventory.view。

issuer 必須對上 server request context 的 auth／apiRoute／transaction，不能只檢查 caller boolean。Receipt 的 confirmedLines 由 Purchasing 在同 transaction 已鎖定的 Confirmed PO／PO Lines 提供（與 GR detail ownership核對後）；issuer 核對每個 sku／PO／line／version／snapshot與command一致。Reversal issuer 的 options.ownerProof 必須是consumer由同transaction鎖定的GR／新reversal header／detail rows投影，核對source.documentId所屬goodsReceiptId及原detail映射，不能取request body自報關係。它不能證明任意同process惡意程式誠實：Purchasing 是受信任的業務 owner，browser不能提供這些參數；consumer contract test必須證明採用 locked rows 而非 request body。Inventory 不反向鎖 PO／GR，不讀寫其raw tables。

provider 入場、等待後寫入前、cached replay返回前均重新檢查使用者／角色／權限／JWT token version及時效；最後 current locking read 使用原transaction。Reversal另核對相同 device binding／key／簽章時間及已驗證 password策略；使用既有 request signal／JWT／session／signature限額，不建立較長有效時間。密碼／token不進 command hash、summary、Audit 或日誌。

## 3. Receipt 交易與冪等

先固定整批正規化（行按 sourceLineId 排序作 identity；輸入順序只控制回應）。root 用 source.lineId=""，command `PURCHASE_RECEIPT_BATCH`；每行用 sourceLineId，command `PURCHASE_RECEIPT_LINE`，其 request hash 包含 root 的完整業務 request hash及本行標準化內容。先 claim root，再按明確數字 ID 順序 claim 全部 lines，全部 claim 完才可進 Warehouse 鎖。任一 payload／membership 衝突整批拒絕；不接受 fresh/replay 混合、未完成root或不完整既有行集。結果的 membershipDigest 與業務hash分開：固定以sourceLineId數字升序的 `[sourceLineId, operationId, request_hash]` tuples作canonical JSON的SHA256，全部欄位都可從持久化Operation重算；另逐筆核對rootOperationId／來源／command／status。不得把無法由持久化回執重建的完整command hash當成結果membershipDigest。

root claim 與所有行同一 caller transaction，root summary為 scalar `{status,operationId,rowCount,membershipDigest}`，每行scalar summary儲存原結果、rootOperationId/sourceLineId、skuId及已驗證PO原始 `trackingPolicy`／`baseUomId`／`baseUomCode`。這三個policy欄位是後續反向的持久snapshot；request digest不能代替它們。PR-A僅新增Operation白名單 `trackingPolicy`，其餘已存在。沿用 Operation 8192-byte/scalar限制，不塞200行nestedJSON。claim／complete失敗與所有效果一起回滾。replay不增加Movement／Audit；權限仍須現在有效。

Receipt root hash包含固定purpose／source／排序後業務lines（含commitment及minimumLifeEvidence）；Reversal root hash包含固定purpose／source／goodsReceiptId／reasonText／排序後業務lines。兩者均不含context、actor、correlationId、輸入排列或重新查出的動態Item值。顯式null與預設null先正規化。context的安全intent另包含actor／correlationId／transaction等，不與業務event hash混用。同event換requestId或合法新actor可以在fresh auth後得到同原結果；調整membership、數量、快照、goodsReceiptId或reason則衝突。

補齊既有Purchasing §2.4要求的 `InventoryLookupService.findOperationsBySource(transaction, query)`：query精確 `{documentType,documentId,eventId}`，documentType僅本provider兩種。使用實際request context／active transaction及fresh `purchasing.view`；consumer必須以新獨立只讀transaction呼叫，不得沿用先前業務快照或持有PO／Inventory鎖。以單一非鎖定SELECT的一致快照讀精確source，LIMIT 202（root＋200line外多一列只用來偵測超額並拒絕）；回 `{status:"NOT_FOUND"}` 或 `{status:"COMPLETED",result}`，COMPLETED的result與原batch receipt相同、lines按sourceLineId數字升序。核對rowCount／可重算membershipDigest／root IDs及每列completed狀態；可見的未完成root、missing／extra／corrupt列均是完整性錯誤，不能回IN_PROGRESS或部分結果。

尚未commit的batch對此查詢不可見，因此NOT_FOUND只表示本次快照沒有已提交結果，不證明從未送出／失敗／可另建event；consumer只能保留原event再查或以相同意圖重試。查詢期間commit可能在下一個新transaction才可見；rollback後仍NOT_FOUND，測試必須涵蓋兩種並發時序。不輪詢、不自行延長期限、不增加Inventory寫入；不取代consumer的GR ownership檢查。PR-A交付receipt查詢，PR-B擴充reversal kind。

全批 lock order：Inventory claims → Warehouse ID → Stock Control(warehouse,sku) → Bin ID／active Bin lock → Lot(sku,normalized lot key) → Balance(warehouse,sku,bin,lot_scope,status)。新Lot先全部 resolve，再取任何 Balance 鎖；同批共用Lot的輸入日期先核對一致。字串比較及existing Lot身份以DB現有collation／唯一鍵判斷，不能用JS大小寫去重改變DB語義。主 warehouse serialization與現有lock helpers保留，deadlock／lock timeout拋錯令整批rollback。

在同一transaction，以既有 `ItemLookupService.findManyForCommittedReceipt` 讀目前 facts，每批≤100 SKU，使用綁定原tx的query adapter及必要 current `FOR SHARE`；不改Item contract。SKU必須存在；既有PO承諾的lifecycle／inventoryTracked／purchase flags差異需reason但不直接拒絕；tracking／base UOM採已驗證PO快照。provider明確比較目前tracking及唯一base UOM的ID／code與快照，差異同樣必須有5–500字節skuExceptionReason；Purchasing驗證purchase UOM/factor漂移及原因，不能只看Item warning codes。現在serial仍為既有Item provider不支援情況，fail closed，不靜默改Item。minimum life取snapshot/current兩者較嚴格非空值；expired永遠拒絕；低剩餘效期需 fresh `receiving.expiry.override`及5–500字節reason，日期／實際天數由server重算，不能信caller數字。

位置須active且Bin屬Warehouse；持久盤點鎖拒絕。blocked Supplier必須QUARANTINED、outstanding／超收／source-document ownership由Purchasing鎖內驗證。所有Inventory條件成功才變更 Balance；每detail一筆RECEIPT IN Movement、一筆 `receipt.post` scalar Audit、原結果complete。相同Bucket多行依sourceLineId順序產生連續before/after/version，任何後段故障全rollback。新receipt的每行使用自己的movementGroupId，避免將跨operation的200行偽作generic group。

## 4. Partial reversal 與 migration

PR-B 新增 `0101_create_inventory_purchase_reversal_links.js`（目前main最高0100；實作／合併前重新檢查占用，不覆寫碰撞）。新 `inventory_purchase_reversal_links`：id PK；original_movement_id／reversal_movement_id／operation_request_id BIGINT UNSIGNED NOT NULL；quantity BIGINT UNSIGNED CHECK>0；created_at BIGINT UNSIGNED NOT NULL。三個reference均FK RESTRICT；UNIQUE(reversal_movement_id)、UNIQUE(operation_request_id)、INDEX(original_movement_id,id)。UPDATE／DELETE trigger拒絕，與ledger同保留期。migration可安全重跑且驗完整欄位／constraint／index／trigger；無schema破壞式down或歷史backfill。

**保留 `inventory_movements.uq_inventory_movement_reversal` 和 generic reverse來源原bytes。** 新partial reversal Movement type=REVERSAL／direction=OUT，reversal_of_movement_id=NULL，以新link table作正式關聯。它只接受本provider v1成功完成的 PURCHASE_RECEIPT_LINE 原Movement，並驗root/membership/GR/detail/quantity/IN/BIN完整一致；不接管既有單筆receipt或任意genericMovement。這避免兩套ownership同時反向同一原量。新purchase receipt由新commands識別，generic existing `assertCompletedGroup`會拒絕；舊generic receipts仍維持原完整一次反向行為。既有歷史資料不重新解釋。

同樣先claim整批 `PURCHASE_REVERSE_BATCH`／`PURCHASE_REVERSE_LINE`，replay仍走fresh auth，原結果有originalMovementId。發現原Movement維度後，先依Inventory全域順序鎖所有warehouse/control/bin/lot/balance，再鎖original Movement IDs升序及各original的links升序，全部current read。相同original之並發由原Movement鎖序列化；amount ≤ original.quantity − SUM(links.quantity)，安全整數相加；不使用最初discovery快照判定累計。

逐Bucket合計OUT後 `onHand >= allocated`；同倉SKU在整批最終效果下 uncoveredReserved不得增加。保留original Bin／Lot／Status，原Lot日期不能改，On Hand降至0才清FIFO anchor；不新增匿名Balance或替換SKU。用目前SKU可用性計算Reserved coverage，但既有承諾撤銷不以lifecycle變更單獨拒絕；原receipt snapshot的tracking身份必須與Lot一致。跨多行、重複Bucket、邊界safe integer均先驗再寫。

每行新增OUT Movement、link及 `movement.reverse` Audit（`beforeSummary.movementId`指原Movement、`afterSummary.movementId`指新Movement、`afterSummary.baseQuantity`指反向量），與operationcomplete、Purchasing projections同交易；沿用現有Audit白名單，不新增originalMovementId/resultMovementId Audit欄位。第二行／第二Audit／link／completion／caller commit故障全rollback。資料庫未知commit回既有indeterminate錯誤，由consumer按原event查事實，不換event重試。

## 5. 變更範圍

PR-A產品：既有 `InventoryPostingService.js` 只加factory/delegation；`InventoryLookupService.js`增量委派上述read-only查詢；`inventoryConstants.js` 加四個purchase commands（B使用的兩個可延至B）；新增 `InventoryPurchaseService.js`、`InventoryPurchaseContext.js`、`inventoryPurchaseValidation.js`、`inventoryPurchaseReceipts.js`。`InventoryOperationService.js`僅增量允許 `trackingPolicy` scalar欄位；`originalMovementId`已經由Fulfillment白名單提供，不重複加入；不改既有hash/serializer/claim語義。batch都使用既有lock／Lot resolver，範圍不包含LockService、Item或框架修改。

PR-B新增 `inventoryPurchaseReversal.js`、0101 migration，增量PurchaseService/context及上述scalar欄位。若實作需改範圍外產品或business policy，集中具體差異供審閱。

測試：新增 `server/test/inventoryPurchaseReceipt.test.js`、`inventoryPurchaseContext.test.js`、`inventoryPurchaseReversal.test.js`、`server/test/integration/inventoryPurchaseReceipt.integration.test.js`、`inventoryPurchaseReversal.integration.test.js`、`inventoryPurchaseAuth.integration.test.js`、`server/test-support/inventoryPurchaseFixtures.js`、consumer-facing `server/test/inventoryPurchaseContract.test.js`。既有unit／native regression不刪改assertions。

文件：本契約及plan／handoff；採用後把本正式addendum連到Inventory canonical design／plan、provided contract pin、typed trace／matrix及profile（新的獨立merge groups），不把TASK048或P5標成全部完成。Purchasing對齊§2.4／§8.7 ABI及§4.13：明確以本契約的獨立link取代「移除舊reversal unique」要求；§3.5／§8.8鎖序統一服從既有§2.6的PO→PO Lines→GR→GR children→reversal children→Inventory，避免反向鎖序。業務consumer實作由其owner負責。

## 6. 風險與待批准選擇

新增 opaque context補齊原Purchasing示例缺少的server可信邊界；消費端需要接issuer。新receipt只走專用partial reversal，不提供generic對新來源的另一入口；legacy generic資料不遷移。額外root claim與links是可追溯／並發保護成本，200行仍受原10s SQL／20s交易／30sHTTP期限。正式兩個provider交付不意味Purchasing端已完成UI或整體上線。

本候選需Sam集中批准新ABI／context邊界／link資料模型及獨立PR Gate後才能實作。單模型獨立review按實際報告記錄；跨模型沿用Sam全面略過。最終每個實作候選仍需實際review、當前CI與最新main整合；不宣稱測試已PASS。

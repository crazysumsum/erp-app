# TASK-035 前置：一筆原出庫、兩筆 Movement 的沖銷契約

2026-11-04。源碼基線 `99d0f6d8f3de4f4273be24bbaeb045f1fbfcc677`，tree `309275f4c1d1da7272c1aa6d1d70ea06220d6121`；隔離 worktree `fulfillment-task034-main-integration`。本稿只核實既有 callable 與表，未執行程式、測試或 DB，未新增 job／API／公開入口。TASK-034 未過完整 DoD，不越 gate 執行 TASK-035 寫入；20 秒與全部安全檢查不變。

沿用 [04 provider coordination](04_provider_wire_coordination.md) 的 complete-set／original-bucket／receipt 規則；該稿未完整連起本例、0097 及反向結果查證，故只在此補缺。以下方法名稱、三參數 writer 與 exact 欄位以此基線實碼為準，不套用設計 §6.1 的簡化 `action` DTO。例中 ID、版本、數量均為紙上示例，不是新增 fixture 或測試結果。

## 原集合與唯一數量單位

S1＝Shipment `300`，Fulfillment `100`，SO `200`；Shipment Line `301`／Fulfillment Line `101`／Sales Line `201`；Claim `102`／Sales mapping `202`／Reservation `400`。原確認 event 為 `E_S`，本次不同的撤銷 event 為 `E_R`（實作均須合法 UUID）。原 Inventory ISSUE root `500` 下只有一個 member operation `501`，該 member 下有兩個 leg operation `502/503`。

| 0097 Issue row | 原 member operation | Fulfillment Allocation／Inventory Allocation | 原 Movement／Balance | 原桶（Warehouse／Bin／SKU／Lot／Status） | q |
| --- | --- | --- | --- | --- | ---: |
| `310` | `501` | `110`／`410` | `510`／`420` | `1/2/10/null/AVAILABLE` | 2 |
| `311` | `501` | `111`／`411` | `511`／`421` | `1/3/10/null/AVAILABLE` | 3 |

`shipment_issue_details.inventory_operation_id` 是 **member 501**，不是 root500／leg502，也不是每 Movement 各建一個 Reservation。兩筆 Issue 合計5；只建立一個 q5 的 Reservation／Claim member，內含 q2、q3 兩 allocation legs。原 Allocation 已 CONSUMED，沖銷後仍保持 CONSUMED、outstanding0、原版本不變。

完整集合的來源及雙向對帳：

1. 先核實 S1 的 `confirmation_event_id=E_S`、已完成 SHIP operation 的 target／event／hash／actor／結果及確認 history，並保留原 reversal intent 的 `E_R`、reason、兩確認、actor、correlation／lease。不能把單一 `shipment_issue_details` 查詢當原 SHIP 完成證明；不能套用只接受 SHIPPING 的 `assertShipmentConfirmationSnapshot`。
2. 由 S1 父資料取得**全部** Shipment Lines、對應 Fulfillment Lines／Claims／Allocations 及全部 `shipment_issue_details`；含零出貨行，不能從提交的兩個 ID 限縮 discovery。檢查 parent／SO／SKU／base-UOM／原 Reservation／Claim／mapping、每行 shipped 及零 reversed、各層數量和。尚有既存 reversal ref／detail 或不完整原集合即拒絕。
3. 將全部 Issue 的 member operation IDs 去重，本例恰為 `["501"]`，不是 `["501","501"]` 或 `["500"]`。`getFulfillmentReversalPreparationInTransaction` 內部 `readOriginalFulfillmentIssueBatch` 會驗原 member 全屬同一 dedicated ISSUE root／event／hash，讀回 root 的完整 line／member／leg receipt；getter 再要求輸入 member 集合與完整結果恰等。Fulfillment 仍須核此 event 是 S1 的 `E_S`，逐項對上本地原集合。getter不回傳event；E_S綁定來自已驗真0097 schema／trigger、S1不可變confirmation_event_id與鎖內完整本地Issue→原member關係，不從advisory推造event或反向import owner codec。
4. 兩邊按 `(claimId, reservationId, inventoryAllocationId, originalMovementId)` 精確一一對應；檢查無遺漏／多項／重複、原桶及 q2/q3、Issue IDs310/311、原 member501。不可只比較總量5；原始庫位、批次／expiry／status及 UOM 來自 immutable owner receipt 與原 Issue 快照，不接受 caller 指定替代桶。

## 實際 callable、輸入與回執

| 次序／owner | 基線實際方法 | 輸入及權威界線 |
| --- | --- | --- |
| advisory／InventoryLookup | `getFulfillmentReversalPreparationInTransaction(tx,{shipmentId:"300",originalInventoryOperationIds:["501"]})` | 真 active RC、fresh view＋reverse；只 SELECT、不 claim／鎖域資料。回 `{fulfillmentId,shipmentId,originalOperationId:"500",lines}`，member 包含 `currentState`、目前 Reservation `expectedVersion`；leg 包含 `originalMovementId`、`inventoryAllocationId`、q、目前 `expectedBalanceVersion`、原 `bucketSnapshot`。**不是 writer preparation／零效果證據** |
| preclaim／InventoryPosting | `claimFulfillmentBatchInTransaction(tx,{action:"REVERSE",command})` | 回 genuine、同 instance／同 tx 的 opaque `preparation={operationId,requestHash}`，內部 WeakMap 綁 command。取得 scope／root／member／leg operation 鎖；不能傳 advisory DTO 當此 proof |
| Sales lock | `SalesFulfillmentService.lockLinesForFulfillmentInTransaction(tx,intent)` | purpose `SHIPMENT_REVERSED`，核原 E_S 完成 journal 及原 member501，claim E_R 專用 Sales journal，鎖 SO／lines／mapping，回 `{replay:false,order}` 或真正 completed replay。不可在 Inventory 已改動後才補 claim |
| Inventory write | `reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,command,preparation)` | 真同交易、fresh reverse；重驗完整原 ISSUE／Movement、原桶、目前 CAS、Counting／inactive／already-reversed 等；返回真正 root／member／兩 leg 結果 |
| Sales apply | `applyFulfillmentResultInTransaction(tx,{intent,inventoryResult})` | 向**同一 InventoryFulfillmentService instance** 呼叫 `verifyFulfillmentBatchReceiptInTransaction`，驗本 tx 真 receipt 與目前 Reservation counters，再寫 Sales。Fulfillment 不自行重算 Sales 結果 |

實際 command（`actor` 為 fresh 普通使用者 `{userId,serviceName:"",claimedRoles,claimedPermissions}`；不是 serviceName 代權限）：

```js
{
  actor, source: { documentId: "300", eventId: E_R }, correlationId,
  payload: { fulfillmentId: "100", shipmentId: "300", lines: [{
    fulfillmentLineId: "101", salesOrderLineId: "201", baseQuantity: "5",
    reservations: [{ claimId: "102", inventoryReservationId: "400",
      expectedVersion: 9, baseQuantity: "5", originalInventoryOperationId: "501",
      allocations: [
        { inventoryAllocationId: "410", shipmentIssueId: "310", originalMovementId: "510", expectedBalanceVersion: 12, baseQuantity: "2" },
        { inventoryAllocationId: "411", shipmentIssueId: "311", originalMovementId: "511", expectedBalanceVersion: 17, baseQuantity: "3" }
      ]
    }]
  }] }
}
```

只從 advisory whitelist 重建 payload：不能把 `currentState`／`bucketSnapshot`／`originalOperationId`／`inventoryBalanceId` 整個 spread 進 strict writer。`shipmentIssueId` 必須來自已核本地310/311；Inventory只把此 opaque ref 綁 hash／receipt，**不替 Fulfillment 證明該 ref 存在或屬 S1**。line 按 Sales Line ID、member 按 Reservation ID、legs 按 Inventory Allocation ID 升序；維持100行／每行50／總5000等既有 exact bounds，零行原樣保留。

Sales intent 為 exact fields：`{actor,purpose:"SHIPMENT_REVERSED",salesOrderId:"200",expectedOrderVersion:7,eventId:E_R,shipmentId:"300",inventoryRequestHash:preparation.requestHash,originalConfirmationEventId:E_S,lines:[{salesOrderLineId:"201",expectedVersion:6,baseQuantity:"5",reservations:[{claimId:"102",inventoryReservationId:"400",expectedVersion:9,baseQuantity:"5",originalInventoryOperationId:"501"}]}]}`。Inventory hash 來自正式 preclaim；SO／Line versions 必須是目前 owner facts，不可用原確認版本。本例已 COMPLETED 的 SO 不能用僅接受 CONFIRMED／PARTIALLY_FULFILLED 的 `getOrderForFulfillment()` 取得這些 facts；缺專用準備 reader，見下表。

成功 Inventory result 的 root `operationId` 假設600；唯一 member 為 `{claimId:"102",inventoryReservationId:"400",expectedVersion:9,version:10,baseQuantity:"5",inventoryOperationId:"601",originalInventoryOperationId:"501",allocations:[…]}`，每 leg 含實際 `movementId`610／611、`shipmentIssueId`310／311、`originalMovementId`510／511、原 allocation／balance、q2／q3、原 bucketSnapshot與真正 balanceVersion13／18。root600、member601、leg operation602／603不可混用；Movement 的 `operation_request_id` 是 **601**。

## 同一交易鎖序、下游重查及各方寫入

所有步驟在 caller 的同一 active RC transaction，依已存在 Confirmation／04 的 preclaim 做法，而非把 Inventory operation claim 延到 Sales／庫存域鎖之後：

1. `Fulfillment operation E_R FOR UPDATE`，核原 target/hash/actor/nonce/DB lease；先辨真正 terminal replay，不為已完成事件重新跑 advisory。讀原集合／目前 advisory，凍結完整 command。這些讀取不代替後續鎖內重驗。
2. Inventory `claimFulfillmentBatchInTransaction`：穩定 `FULFILLMENT_SCOPE_LOCK` → REVERSE root → members（claim ID升序）→ legs；其後 Sales `lockLinesForFulfillmentInTransaction`：原 E_S immutable proof、E_R journal → SO → 完整 Lines → mappings（同類主鍵升序）。Sales completed replay 必須走正式原事件結果路徑，不再把已消耗的 advisory 當新寫入。
3. Fulfillment 根 → Lines → Claims → Allocations → Shipment → Shipment Lines → Reversal（按既有 `FulfillmentLockService` rank，同類ID升序）；原 Issue details 在已持 S1／Reversal 父鎖後按ID鎖定，重新列出及精確核完整集合／原 source／current versions／歸檔、reason與雙確認。不能對不相容狀態重用 Confirmation 的 snapshot guard。
4. 下游：Phase A 開始已查 guard，**Phase B 要再查** Returns 的 S1已實收份額／未決售後及 AR 開票／貸項／可沖銷狀態。required provider未能證明即 UNKNOWN／拒絕；已知不可逆是業務衝突。這一查及 provider writers 必須共同受 S1 的同交易序列化保護，不能只讀一次舊 CLOSED。正式 provider及其鎖契約尚缺，不能假定當前 no-provider guard完成此步；具體新增鎖 rank 由 TL／各 owner 契約確定，不自行插入反序鎖。
5. Inventory writer 取得 Warehouse → stock controls → Bins／active bin-locks → Lots → Balances（自然桶序）→ Reservations → Allocations；從原 ISSUE重新驗全集合／原桶及目前CAS。每 leg回補 balance＋Movement；每 **member** 才恢復一次 Reservation及stock-control reserved。沒有新 allocation、不重開原 allocation。
6. Sales apply驗同 tx receipt、完整 q／source／current counters及 mapping CAS；更新原 mapping consumed/outstanding/status/inventory_version、選中 Line quantities/version、SO status/version、其 history／audit／SUCCEEDED journal。原 reserve operation、source event、Cancelled及Backorder身份／數量保留。
7. Fulfillment驗 result exact集合、實際版本與 Sales result後寫本地 projection：逐Issue CAS `reversal_movement_id IS NULL`、每Issue一筆 reversal detail；Claims累計consumed保持、reversed加q／active仍0、Allocation仍Consumed，Line reversed累加，Shipment Line reversed量、Shipment／Fulfillment及Reversal終局，history／audit；最後 `FulfillmentOperationService.succeedInTransaction(tx,{request,result})`。result須為其既有 safe terminal格式，保持原nonce/hash/actor／到期CAS。下游到commit的安全依賴第4步持鎖不變；若需final recheck只可用既持鎖，不得在Inventory之後新取早階鎖。

本例 Inventory Reservation `original5/consumed5/released0/outstanding0,v9` → `5/0/0/5,v10`；stock controls reserved只加5；Balance420＋2、421＋3，各版本＋1且 allocated不變。Sales mapping與Line由fulfilled5／outstanding0移回0／5，SO COMPLETED v7→CONFIRMED v8、Line v6→7；**不是每Movement各恢復5而變10**。部分／CLOSED依 Sales planner計算，Cancelled保持。Fulfillment及Shipment轉REVERSED；原Claim仍consumed5、reversed由0→5、active0、status REVERSED，`inventory_version`同步真實回執10；遵守 `original=active+released+consumed`、`reversed≤consumed`，不把歷史consumed減掉或回補成新active Claim。這是待實作的對帳要求，不是已跑過的結果。

## 0097 逐 Issue 防重與 owner 邊界

`0097_create_shipment_issues_and_reversals.js` 已有：Issue的 `uq_shipment_issue_movement`／`uq_shipment_issue_allocation`／`uq_shipment_issue_reversal`；Reversal有效Shipment唯一鍵及event唯一鍵；detail的 `uq_reversal_detail_issue`／`uq_reversal_detail_movement`。Issue UPDATE trigger只准從 null寫一次 reversal Movement，其他原事實不變；detail append-only trigger要求同S1、Reversal、原Issue／claim、反向Movement及已完成 REVERSE member source吻合。

Fulfillment以回執 member601＋Movement610/611更新Issue310/311、寫兩detail，不能用root600當 `inventory_reversal_operation_id`；`shipment_reversal_details.reservation_before_summary/after_summary` 每筆可引用同一個Reservation的整次member前／後快照，**不可把兩份summary再相加**。Inventory獨立防止原Movement已反向；Fulfillment的FK／unique／trigger仍全保留。任何第二筆detail、末筆audit、任一owner CAS失敗，整個PhaseB效果都須rollback；不能靠逐Issue commit或忽略重複鍵取得部分成功。

## 結果可信度及精確缺口（給 TASK-036）

| 情況／缺口 | 現有能力及界線 | 需要的交付／owner |
| --- | --- | --- |
| 本次PhaseB確實 `ROLLED_BACK` | DB module具名匯出 `getTransactionOutcome(attempt.tx)` 是只讀、實際executor證據；只有該次可信rollback才證明該次所有反向effects沒提交。舊PhaseA audit rollback證據不等於新PhaseB已驗。它也不排除較早不明attempt成功 | future caller保存真正attempt tx及原事件fence；任何較早不明attempt須另查。確知零反向效果且永久業務拒絕，才在新transaction以原lease／CAS寫FAILED＋SHIPPED；技術不明留REVERSING |
| commit成功但讀取／ACK失敗 | `COMMITTED`證明該attempt已提交，不能改FAILED；`INDETERMINATE`／rollback失敗／例外本身不能證明反向ABSENT。當前數量變回去也不能識別是哪個event | 先查原 E_R終局及完整owner證據；不造新event、不自動重做反向、不靠原 ISSUE成功推定反向成功 |
| Inventory反向結果 reader **缺** | `InventoryLookupService.prepareShipmentIssueOutcomeReadInTransaction`／`readShipmentIssueOutcomeInTransaction`／verify proof為SHIP/ISSUE專用，不能套用REVERSE。internal receipt codec確能decode已知completed REVERSE root，但不是正式owner ABSENT／SUCCEEDED／UNKNOWN reader；`verifyFulfillmentBatchReceipt…`亦需本tx genuine writer receipt | Inventory owner須提供綁 E_R／S1／actor／hash／原member501及完整2legs的正式只讀反向proof；查root/member/leg pending／completed、原→反向Movement及Reservation source，缺少、不完整或矛盾回UNKNOWN。不能由Fulfillment直接import SQL codec當Recovery權威 |
| Sales反向結果 reader **缺** | `readShipmentOutcomeInTransaction` 明確只認 `SHIPMENT_CONFIRMED`；其ABSENT判斷與selection也是原出貨方向，不是反向零效果證據 | Sales owner須提供 E_R、purposeSHIPMENT_REVERSED、E_S及原member501完整集合的正式反向結果proof，驗Sales journal／result／quantity/source／版本及Inventory反向receipt關係；兩owner及本地不一致維持UNKNOWN |
| Sales目前 reverse準備 reader **缺** | writer支持COMPLETED／PARTIALLY_FULFILLED／CLOSED；既有公開owner getter只允許CONFIRMED／PARTIALLY_FULFILLED。原E_S journal有歷史版本，不能當目前CAS；不能偽造版本或用Fulfillment raw SQL讀Sales私有表 | TASK035需Sales owner提供狹窄只讀目前SO／Line／mapping／來源資料（或明確擴充其既有owner介面）以組完整reverse intent；writer仍鎖內重驗，advisory不得成proof |
| required下游及部署 **缺** | 現 `FulfillmentDownstreamMatterService.assertShipmentReversibleInTransaction(tx,{shipmentId})` 只認明確 no-provider registry；實際部署兩方均UNKNOWN／維護人未指定，不能採NO_PROVIDER_REQUIRED | TL領Returns／Invoicing-AR設計契約、各資料owner供provider；Fulfillment同S1交易消費並在start／complete／recovery核實，PM追按環境／版本的具名維護人。此依賴不阻本稿，但阻真單執行 |

以上正式反向 reader須在新鮮RC reconciliation-only transaction、真Recovery capability／原event與lease fence下取得完整來源鎖；**不能拿新preclaim來查存在性，也不能把 ABSENT 同交易升級成 writer**。具體反向read鎖設計與與writer的次序須owner覆核；沿用原Issue reader函式名或null→無效果均不足。已有原事件成功時先回原結果，勿再要求當前consumed足夠做另一筆reverse。

## 第一段可落地範圍與後續順序

當前內部 caller只有 `ShipmentReversalService.startReversal()`，沒有 `completeReversalPhaseB()`、同process trusted started-token／原nonce的private綁定或Reversal Recovery。pending DTO不是業務寫入 capability，不能把return tuple再傳回就當授權。

最小下一段產品改動應為 Fulfillment 私有scope／projection mapper：接收完整原集合與Inventory advisory，whitelist組command、對應310/311及檢查兩leg回執；由未來內部 `completeReversalPhaseB` 使用，不在 `startReversal` 增加庫存寫入。真正連起writer之前必須：TASK034完整DoD通過；Sales owner補目前reverse準備資料；建立仿照既有Confirmation的可信原started／committed-PhaseA／lease binding；完成鎖內完整集合與required下游的可核契約。這輪**沒有實作這段**。

反向結果reader是TASK036 Recovery的明確輸入依賴；TASK035的正常原子交易設計可先完成，但不明結果只能停REVERSING，不得在缺reader時啟用自動恢復或宣稱036完成。沒有新增營運政策需Sam決定；現階段無另需TL選擇的方案，需TL協調Sales owner補上述準備介面，及Inventory／Sales owner分別交反向reader契約。TASK035／036均未因本稿改為完成，後續測試／執行仍受既有gate、准入及資源授權限制。

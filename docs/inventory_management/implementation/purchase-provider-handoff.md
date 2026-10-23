# Purchasing consumer handoff — inventory-purchase-provider/1.0

Status: RECEIPT_PROVIDER_DELIVERED / partial reversal IN_PROGRESS / consumer NOT_UNLOCKED。PR-A [#275](https://github.com/crazysumsum/erp-app/pull/275)已於2026-10-23合併，實際merge commit `5c055d79e94c74e58ccb27afe0fc3e0bd3edf151`；PR-B自該fresh main的獨立worktree啟動。Purchasing TASK006可接入已合併receipt ABI；TASK007仍待PR-B，TASK008仍須consumer真實接入驗證。

正式command/result及安全語義以[provider v1契約](purchase-provider-contract-v1.md)為準。下列PR-A接入細節已固定於上述實際merge SHA；不表示consumer已採用或Purchasing已整體解鎖。

## PR-A接入

1. Purchasing既有鎖序先鎖PO→PO Lines→GR→GR children，驗證Confirmed ownership、剩餘收貨量、Supplier狀態及原PO承諾。GR固定保留一個eventId；重試及未知commit不得換event。
2. 在同request、同實際active RR transaction內，由server建立command。actor取已驗證JWT；source.documentId為GR ID；每line.sourceLineId為其GR detail ID。Browser不提供issuer options或owner proof。
3. `issuePurchaseReceiptContext(req, tx, command, confirmedLines, options)`中的options為`{database,time,sessionMaxAgeSeconds,clockToleranceSeconds}`。兩個時間上限取現有JWT service/config，不能延長；database須與caller交易／request context一致。
4. `confirmedLines`為已鎖PO資料與GR ownership核對後的server投影，逐行精確提供`sourceLineId,status:"CONFIRMED",purchaseOrderId,purchaseOrderLineId,confirmedVersion,skuId,inventoryTrackedSnapshot,trackingPolicySnapshot,baseUomIdSnapshot,baseUomCodeSnapshot,minimumReceiptLifeDaysSnapshot`。不得用`purchaseConfirmedLines(command)`這個測試helper作production proof；它只適用合成測試。
5. 將opaque返回值放入command.context，一次呼叫`InventoryPostingService.postPurchaseReceiptBatchInTransaction(tx, command)`處理完整1–200行。禁止逐detail呼叫舊posting或自行commit。依返回sourceLineId逐筆寫Purchasing projection，任一後段失敗必須傳播到最外層withTransaction回滾。

回應root及每行ID/quantity為safe integer，來源ID為canonical decimal string；lines依輸入順序，無缺漏／重複。snapshot tracking/baseUOM與原結果持久保留，replay不由目前Balance重建。`skuExceptionReason`與minimum-life override各遵循正式契約，expired不因override獲准。

## 未知commit查詢

以新的獨立read-only RR transaction呼叫`InventoryLookupService.findOperationsBySource(tx,{documentType:"GOODS_RECEIPT",documentId,eventId})`。service建構時傳入`database,time,sessionMaxAgeSeconds,clockToleranceSeconds`，同樣取既有服務設定。需要現在有效的purchasing.view；查詢caller自行驗證GR可見性／ownership。不可沿用原業務transaction快照或持有PO／Inventory鎖。

只回NOT_FOUND或COMPLETED/result；COMPLETED的lines按sourceLineId數字排序。未commit的請求不可見，NOT_FOUND不等於未送出／失敗，不是換event的理由。可保留原event再查，或以相同業務意圖及fresh context重試。來源／payload／membership衝突回INVENTORY_SOURCE_CONFLICT409；可見但不完整或corrupt receipt也fail closed。

常見拒絕：PERMISSION_STALE403、JWT_REQUIRED/JWT_INVALID/SESSION_EXPIRED401（HTTP對外沿用Unauthorized Access）、輸入／不安全數量400、位置／Lot／最短效期或並發衝突依既有Inventory error定義。DB未知commit沿用既有framework錯誤，不能推斷rollback已完成。token/password/device密鑰不進hash、Audit或handoff。

## Migration與後續

PR-A無新schema，使用既有Operation/Movement/Audit等migration，Purchasing權限已有0100。PR-B預計0101 reversal links；合併前核對下一空號。PR-A新receipt不能改走generic full reversal；PR-B未合併前不能宣稱TASK007解鎖。

Consumer TASK008仍需證明locked-row proof、相同tx passing、全projection rollback、dependency-unavailable fail closed及無production fake/raw Inventory table fallback。最終填入兩個實際merge SHA、migration、精確測試結果後，以Issue267交接；未見consumer真實採用測試，只能標PROVIDER_DELIVERED，不能標Purchasing實際解鎖。未合併Stocktake Start互斥聯測仍由P4另外追蹤。

# Purchasing consumer handoff — Receipt 1.0／Reversal 1.1（PR-B pending）

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

## PR-B接入預備：Reversal 1.1，尚未合併

1. Receipt 1.0不變；部分反向採正式[1.1契約](purchase-provider-contract-v1.md)，`source.documentId === goodsReceiptId`為原GR ID，`sourceLineId === originalSourceLineId`為原GR Detail ID。新的反向意圖用新event，同意圖重送／未知commit保留原event，不能用尚不存在的新Reversal PK作Inventory source。
2. Consumer先依既有PO→GR→原Details鎖序核對ownership及原Movement映射，由同request、同active RR transaction的已鎖定rows提供`ownerProof:{goodsReceiptId,status,details:[{sourceLineId,goodsReceiptId,originalMovementId}]}`。Browser不能提供此proof；測試fixture投影不可取代正式owner的locked-row投影。
3. `issuePurchaseReversalContext(req,tx,command,{database,time,sessionMaxAgeSeconds,clockToleranceSeconds,signatureMaxSkewSeconds,ownerProof})`沿用真`jwt-device-password`及原期限；固定`purchasing.view`＋`inventory.adjust`，不授予`inventory.view`或一般Receiving角色調整權。GR已REVERSED僅允許fresh-auth exact replay，不允許新event再反向。
4. 將opaque capsule放入command.context，只呼叫一次`reversePurchaseReceiptBatchInTransaction(tx,command)`處理整批1–200行；不得逐明細呼叫單筆posting。按返回sourceLineId映射原Detail，再INSERT正式new Reversal header/details，填真實Movement／Operation ID及非空結果，之後更新PO／GR projection；任一步失敗必須回滾整個caller transaction。禁止假ID、NULL FK、placeholder或跨交易預提交。
5. 新增migration `0101_create_inventory_purchase_reversal_links.js`，保留generic原full-reversal唯一鍵。多次partial links不可UPDATE／DELETE，按原Movement的current鎖內累計量限制；generic不能處理新Purchase batch，Purchase partial也不能處理legacy generic來源。回滾運維保留既有links及已提交來源的replay/query能力，不自動DROP資料。
6. 未知commit以fresh獨立read-only RR query查`{documentType:"GOODS_RECEIPT_REVERSAL",documentId:原GR ID,eventId:原event}`；NOT_FOUND仍不能當成失敗或換event的許可。Consumer對賬逐原GR＋event＋原Detail，核對已持久Operation／Movement／originalMovement／quantity，不比較新Reversal Detail PK或跨event合併。

目前為本機候選：35例真MySQL（含200行、競爭超額、第二Movement/link/Audit/completion及consumer後段回滾）及真JWT/password/device認證已執行；正式完整驗證／coverage、當前PR CI與最終Sam精確來源審閱以PR-B審閱文件的最終結果為準。真auth中的consumer tables是明示合成接入，不是Purchasing production consumer已實作。**PR-B實際merge commit尚未產生；Purchasing仍未實際解鎖。** TASK041/P4完整容量／soak不是此provider的前置，真正Stocktake Start聯合驗證維持獨立追蹤。

# TASK-036：同一次回補的雙 owner 消費契約

## 本次交付及固定來源

本稿依 TL 在接納 `77dbcb77550ed229e4425f1de27c4fa2713dcb20` 後的技術裁定，只交共同本機來源及消費／決策契約。沒有新增 coordinator、issuer、session helper、writer、route、儲存機制或測試。所有敘述為源碼核對，沒有建 container、呼叫 reader、DB／功能驗證、CI 或 push；不是 TASK-035／036 完成或可重試的證明。

| 輸入 | 精確增量及本機整合 |
| --- | --- |
| Fulfillment 已驗收來源 | `77dbcb77550ed229e4425f1de27c4fa2713dcb20`，含原 SHIP witness `c6bcc3b5`、私有唯讀 runtime、Sales `getShipmentReversalScope` |
| Sales outcome | `251e6f64e878155b8d064eee4c2a7c93bb6bf9df` → cherry-pick `c7a2bfc7`，只加 62 行；保留共同來源的 scope 方法，不用其 parent `591634bb` 的整檔覆寫 |
| Inventory outcome | `50c9cabe9d7c49f991b12875ce5ec5ee5b6551f8` → cherry-pick `c8254710`，三檔 +112／−2；保留原 ISSUE API／語意 |
| 共同產品候選 | `c8254710`，四個 owner 檔相對 `77dbcb77` 共 +174／−2；本稿另外提交，產品碼不再改動 |

關聯：[原 Issue／回補設計及本地投影](98_task035_original_issue_reversal_contract.md)、[TASK-034 邊界](97_task034_main_integration_boundary.md)、[TASK-036 定義](../05_development_tasks.md#task-036--交付reversal-apioperation-lookup及recovery-job)。Doc98 的早期「reader 缺」是當時紀錄；本稿更新為已有兩個 owner 的本機 source，**可信 REVERSE issuer／真正 caller 仍缺**。

## 實際 owner API 與 session 契約

InventoryLookupService 只轉接其同一個 `fulfillment` 實例：`prepareShipmentReversalOutcomeReadInTransaction(tx,session)`、`readShipmentReversalOutcomeInTransaction(tx,context)`、`verifyShipmentReversalOutcomeProofInTransaction(tx,session,proof)`。SalesFulfillmentService 提供 `readShipmentReversalOutcomeInTransaction(tx,session)` 及 `verifyShipmentReversalOutcomeProofInTransaction(tx,session,proof)`。名稱中的 Inventory `read` 就是下表的 finish；沒有另一個公開 finish 方法。

兩方各自使用 private WeakMap 綁定真 proof／context、同一 `tx`、原 opaque `session`、同一 source 物件。公開 proof 僅有 `state`，不能靠傳入 `{state:"SUCCEEDED"}` 或把已 decode 的普通物件當 proof；只有同一 owner 實例的 verify 才回傳可信結果 clone。Inventory context 只可 finish 一次。跨交易、跨程序或重新建物件不能重用這些 capability。

未來正式 Fulfillment coordinator 須以一個全新、實際 active **READ COMMITTED** 交易持有 E_R operation 的排他行鎖，先驗原 request、actor、nonce、lease、attempt 及排除舊 writer 的 fence，再發出私有 session。verifier 每次回同一個遞迴 frozen source，精確包含：

| 欄位 | 意義及限制 |
| --- | --- |
| `purpose` | 固定 `SHIPMENT_REVERSED`，不可借 SHIP session |
| `fulfillmentId, shipmentId, salesOrderId, customerId, warehouseId` | 同一完整來源的正整數字串 |
| `eventId, originalIssue.eventId` | 分別 E_R、E_S；canonical UUID、兩者不同；不得以 E_S 成功替代 E_R 查證 |
| `actorId, scopeHash, correlationId` | 原 E_R actor、Fulfillment REVERSE domain hash、原 correlation；綁定鎖住的 E_R，不是新造查詢身份 |
| `inventoryRequestHash` | 原 E_R 真實 Inventory REVERSE preclaim requestHash，必須已知且可信；不是 domain hash 或今日 advisory hash |
| `salesRequestHash` | 原 E_R 真實 Sales normalized intentHash；兩方 SUCCEEDED 需要非 null 且與原 Sales journal 相等；null 不能 bootstrap 完成 |
| `pickedLines[]` | 完整行集合，含零行。每行恰有 `fulfillmentLineId,salesOrderLineId,skuId,baseQuantity,reservations`；member 恰有 `claimId,inventoryReservationId,baseQuantity,allocations`；leg 恰有 `inventoryAllocationId,inventoryBalanceId,baseQuantity`。正量 member／leg、精確加總，不能按 caller 選取子集 |
| `originalIssue.references[]` | 完整 0097 Issue 集合；每項恰有 `shipmentIssueId,originalMovementId,originalInventoryOperationId,inventoryAllocationId`，四值須來自同一鎖內原 Issue。member operation 可跨腿重複，其他三種 ID 各自唯一；不得提交 caller DTO／普通查詢結果代替可信來源 |

現有 owner 會重新核實當前 context 的 fresh view＋reverse，actor 必須匹配 source。原 E_S 確認者可不同於 E_R 操作者；不能借此繞過目前授權。撤權後的 Recovery capability／policy 尚未接入，本稿不新增例外。

## 同一 fresh RC 的確切順序（尚未接入產品 caller）

| 順序 | coordinator 必持／呼叫 | owner 實際 verifier phase |
| --- | --- | --- |
| 0 | 沿既有 `readReversalTerminal` 查原 E_R 真終局；已有真正結果則原路返回。只有仍待查且有可信 attempt/fence 才進下列 fresh RC；不能由待查列自簽 session | 不借 SHIP session |
| 1 | 鎖 E_R operation、核原 domain intent／nonce／actor／lease／attempt、原 tx 實際結果及排除全部舊 writer 的 fence；綁定 session/source/phase | 新 REVERSE issuer 尚缺 |
| 2 | `inventoryLookup.prepareShipmentReversalOutcomeReadInTransaction(tx,session)`：先鎖 Inventory Fulfillment scope 及 E_R event 的 operation 集合，保存真 context | `reversal.inventory.prepare`，前後重驗 |
| 3 | `sales.readShipmentReversalOutcomeInTransaction(tx,session)`：鎖 E_S/E_R Sales journals，再依 owner 鎖 SO／Lines／mappings，取得真 Sales proof | `reversal.sales.read`，前後重驗 |
| 4 | 按既有 Fulfillment rank／同類 ID 升序鎖根、Lines、Claims、Allocations、S1、Shipment Lines、Reversal及完整 0097；核 E_S 原 witness、E_R Phase A／本地投影／歸檔／版本／全部 Issues；在 Inventory domain locks 前完成必要下游讀鎖及證明 | coordinator 私有鎖內階段；缺部署／provider 一律 UNKNOWN |
| 5 | `inventoryLookup.readShipmentReversalOutcomeInTransaction(tx,inventoryContext)`：Inventory finish 依其序取得 Warehouse 等 domain locks，讀真正原 ISSUE／REVERSE receipts、Movement、Reservation／Allocation／Balance | `reversal.inventory.finish`，前後重驗 |
| 6 | `inventoryLookup.verifyShipmentReversalOutcomeProofInTransaction(tx,session,inventoryProof)` | `reversal.inventory.verify` |
| 7 | `sales.verifyShipmentReversalOutcomeProofInTransaction(tx,session,salesProof)` | `reversal.sales.verify` |
| 8 | coordinator 在相同 tx／fence／source 下作下述逐欄交叉核對；離開即失效 session，不把 reconciliation-only tx 升成 writer | 不新取早階鎖、不作 DML |

verifier 須核真 tx、同一 session/source identity、當前允許 phase、取消／關閉、實際 operation fence；僅接受字串 phase 的函式或 `{}` 並不構成 issuer。原 ISSUE API／`inventory.prepare` 等 SHIP phase 保持原義。

目前真正建構鏈的 verifier 是 `ShipmentConfirmationService` 閉包連到 `ShipmentFailureReconciliation.verifyReadInTransaction`，其 private sessions／operation 檢查明確為 SHIP。它不會產生上述 reversal phases。035 私有 runtime 只注入這組現存 owner 作 advisory；**沒有可供這些新方法接受的 REVERSE session／正式 caller**。因此本次到共同來源及契約即止，不增加未使用 helper 或讓 SHIP verifier 放行。

## 真 proof verify 後的交叉核對

Inventory SUCCEEDED 返回 `{state,result,requestHash}`，Sales SUCCEEDED 返回 `{state,result,originalConfirmationEventId,inventoryRequestHash,inventoryApplyHash,inventoryMembers,sourceFacts}`。Sales 的 `salesRequestHash` 在 reader 內已對原 journal 及 normalized intent 核實；不是 verify 結果中另一個可讀欄位。消費方不得發明不存在的 output。

| 對照 | 精確要求；缺一項即 UNKNOWN |
| --- | --- |
| 事件／身份 | source 綁鎖住的原 E_R/S1/Fulfillment/SO/customer/warehouse/actor/correlation；Sales `originalConfirmationEventId===E_S`。Inventory owner 自行 decode 原 ISSUE 並核其 root event=E_S、反向 root event=E_R；Fulfillment 不 import 私有 codec 冒充 owner |
| 兩個原 hash | `Inventory.requestHash===source.inventoryRequestHash===Sales.inventoryRequestHash`；Sales reader 已驗 E_R journal.request_hash=source.salesRequestHash=原 intentHash。兩個 owner requestHash 與 Fulfillment domain hash 各有不同含義，不互相代替 |
| 真正 apply 結果 | **`Sales.inventoryApplyHash===salesPayloadHash(Inventory.result)`**，使用既有 Sales canonical hash 與 verify 回來的完整原 Inventory result，不自行挑欄位／改排序／重建 result 後比較 |
| 完整行／member | Inventory.result.lines 與 source 完整行 ID／Sales line ID／baseQuantity 一一相等，含零行；逐 Claim／Reservation／q 恰等且無多漏。Sales.inventoryMembers 與 Inventory result flatten members 恰等：claimId、inventoryReservationId、q、反向 member.inventoryOperationId、originalInventoryOperationId；Sales.result/sourceFacts 的完整來源行／mapping／數量及版本由 owner 驗真，再與鎖內本地 Claims／Sales mapping 身份對上 |
| 原→反向 operation | 原 member 屬原 ISSUE E_S；Inventory reverse member 帶同一 originalInventoryOperationId，Sales 保存的原／反向 member 對上。Inventory batch root、member、leg operation 不可混用；每 Claim 一 member，兩腿可共用該 member |
| 逐 Issue／Movement | 每 0097 Issue 的 shipmentIssueId、originalMovementId、inventoryAllocationId、Balance、q 對上 Inventory reverse leg；leg.originalMovementId=該原 Movement、Movement.reversal_of_movement_id 指回同一原 Movement。全部 legs／Movement／Issues 精確集合，不能只核總數；同一原 Movement 只能被其真反向 Movement 引用 |
| 本地終局證據 | 若讀到本地效果，完整 Issue.reversal_movement_id、每 Issue 的 reversal detail、其 inventory_reversal_operation_id=反向 **member**、reservation summaries 不重複加總、Claims 累計 consumed 保持而 reversed 加 q、各 Line/ShipmentLine reversed、S1/Fulfillment/Reversal、E_R history/audit／safe operation result 均須相符；存在一部分或矛盾不能猜成成功／失敗。既有真 operation 終局仍經原 terminal 路徑返回；owner proof 本身不能寫或補齊此終局 |

上述 local projection 與 writer 的鎖內逐欄重驗仍依 Doc98；本稿沒有實作 projection、修復或任何終局寫入。所有 owner proof 即使 SUCCEEDED 亦僅證 owner 已驗的效果，不能發出重試許可。

## 決策表

| 原 E_R／雙 owner／本地證據 | 可得結論 | 允許動作 |
| --- | --- | --- |
| 既有真正 E_R terminal 經原身份／hash／權限路徑驗真 | 原終局結果 | 沿原路返回；不新建 event、不再要求今日狀態能重做 |
| 同一真 session/tx/fence，兩 owner SUCCEEDED，全部交叉欄位一致 | 僅 `OWNER_EFFECTS_VERIFIED`（本稿敘述標籤，非新 API 狀態） | 不據此改寫 Fulfillment operation；本地終局未驗真仍待查 |
| 兩 owner SUCCEEDED 但任一 ID/hash/完整集合/原反關係不符，或本地投影部分／矛盾 | UNKNOWN | 保持待查／報契約異常；不 retry、不補寫終局 |
| 空 event 列、只有一方 SUCCEEDED、任何一方 UNKNOWN／缺 schema／不完整 receipt／missing fence | UNKNOWN | 不把 null／空列當零效果；不新增 preclaim 查存在性 |
| 傳入偽 proof、跨 tx/session/source/owner 實例，或 verifier phase 不符 | 無可信 proof；依 owner 錯誤／權限分類拒絕 | 不吞實際 403 或程式錯誤冒稱業務失敗；不取得 writer 權限 |
| 聲稱兩方 ABSENT 或拿 SHIP 的 ABSENT 套用反向 | 不成立；兩個 REVERSE reader 都未提供 ABSENT | 不回 SHIPPED／FAILED、不重做回補 |

沒有一格允許由此次對照呼叫 writer、修改 operation、建立新 event 或自動接管 lease。完整 TASK-036 的恢復決策須另有真正 issuer／attempt/fence 及正式產品實作。

## 兩腿 2＋3 的來源推演（沒有執行 fixture）

沿 Doc98：S1=300、Fulfillment100、SO200、Line101／Sales201、Claim102、Reservation400。原 E_S 的 ISSUE root500／member501；Issue310／311 分別對 Allocation410／411、Balance420／421、原 Movement510／511，q2／q3。source.references 是 `(310,510,501,410)`、`(311,511,501,411)`，共用501必須保留；零行仍在完整 lines 中但沒有 references。

若未來真 E_R 的 REVERSE root600／member601／Movement610及611，Inventory.result 的 member601 必須指原501，兩leg分別帶 `(Issue310,old510,new610,Allocation410,Balance420,q2)`、`(Issue311,old511,new611,Allocation411,Balance421,q3)`。Sales.inventoryMembers 應有 Claim102/Reservation400/q5/反向601/原501，且 applyHash 恰為**該完整 Inventory.result**的 salesPayloadHash；不是對 q5 作 hash。Fulfillment detail須用601而非600，且各原Issue指向其對應反向Movement。

把任一 Issue、原 member、原／反向 Movement、E_R/E_S 或 requestHash 換成另一筆，即使總數仍5，也不得判定 joint complete。若只有 Inventory 真成功而 Sales 無列，或兩者成功但 S1 仍 REVERSING 且本地終局缺失，仍待查；原 E_S 成功不能補出 E_R 的結果。

## 可信 issuer 所需資料：現有來源／首次真捕獲點／跨程序界線

| 資料 | 已有來源 | 首次可由哪個真邊界捕獲；現況 | 跨程序可否重取 |
| --- | --- | --- | --- |
| E_R、原 normalized domain command、domain scopeHash、actor/correlation | `startReversal` 真 Phase A；同實例 #startedAttempts 保存 request/hash/actor，0092／Reversal／history 保存事實 | 只從提交成功 Phase A 的私有 binding 取得；DTO不是能力 | 可核對保存的 journal/hash／history；現無授權重建 REVERSE session 的 loader，不能只查 row 重造能力 |
| E_S、S1／SO／客戶／倉庫、原 SHIP witness | 035 同 RR collector，原 journal/history/audit；原 Issue不可變引用 | 未來持 E_R fence 後在固定鎖序內重讀並核全部 source | 原持久事實可重讀，仍須權限／鎖內驗真；今日欄位不能重算歷史 payload |
| 完整 lines／Claims／原 allocations／Issue references／q | 035 collector＋mapper 是 advisory／historical source；0097保存原 member/Movement引用 | 真 Phase B／reconciliation 固定父鎖內完整 discovery、逐欄核後 frozen；不能用 advisory 當 fence | 可重新完整讀原事實，但不能還原原 attempt 的 expected versions 或私有能力 |
| 原 E_R Inventory preclaimHash／command | **035 尚無**真正 Phase B preclaim | 未來實際 `claimFulfillmentBatchInTransaction(...action:"REVERSE")` 回傳的 genuine preparation.requestHash，綁當次 actor/command/tx，而非預算 hash | 完成時 owner journal保存hash；現 reader要求先有可信原hash，沒有正式 REVERSE跨程序bootstrap／issuer，不能拿待查row自簽 |
| 原 E_R Sales intentHash／intent | mapper只有 salesIntentFields，缺原 actor/event/真 Inventory hash；**無真正 E_R Sales attempt** | 未來完整 normalized intent 綁 genuine preclaim 後，由既有 salesFulfillmentIntentHash 取得並隨真 Sales驗證／journal受理保存至可信 attempt | 完成 journal有原 recovery_payload/intent/hash；現正式 reader可驗，沒有可供Fulfillment跳過issuer的普通loader |
| 原 executor/tx 實際結果及取消邊界 | DB只讀 getTransactionOutcome；035保存的是 **Phase A** tx提交證據 | 真 Phase B executor／caller保存那一次 tx、COMMITTED/ROLLED_BACK/INDETERMINATE、signal及attempt關聯；目前尚無 | executor物件證據不跨程序；不能以例外、ACK失敗、或Phase A結果代替Phase B；未知commit須查真原事件 |
| lease nonce／attempt／排除舊 writer 的 fence | 035原 started有Phase A nonce/attempt1觀察；**不足以排除舊 Phase B writer** | 真 Phase B／Recovery 在持E_R operation鎖與可信lease/CAS及全attempt barrier下建立；目前未實作 | row可讀不是全attempt fence；需真正接管契約／排他邊界，不能由expired/pending本身推定安全 |
| 原 Inventory executor result、Sales applyHash/result／雙proof | owner源碼可讀已完成資料；035沒有真E_R executor結果 | 真 Phase B Inventory post結果及Sales apply同交易產生；查證時僅上述同session reader→verify取回真proof | 結果資料可由正式reader重新驗，但proof/context本身不能跨程序；現缺發行session的正式coordinator |
| 必要下游部署及provider／本地終局 | registry無正式宣告仍UNKNOWN；本地schema已定義投影history/audit/detail | owner正式部署契約＋真writer鎖內完成投影與0092終局，不能由兩reader補寫 | 保存的真終局可沿原路查；下游狀態須在同鎖域重驗，不能預設no-provider |

本次可驗收止於同樹來源、欄位消費與上述缺口。下階段才在真正 Phase B 寫入／恢復邊界建立 REVERSE issuer/caller；不把 SHIP verifier 改成接受 REVERSE、不新增未被使用的helper、不自創儲存或替舊結果補hash。全部權限、鎖序／CAS／FK／unique、原子性、100行／每行50／總5,000及20秒交易限制保持；非功能驗證延至UAT後依授權執行。

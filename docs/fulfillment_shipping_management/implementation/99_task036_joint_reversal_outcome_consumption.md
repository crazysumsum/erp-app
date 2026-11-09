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

順序2之前使用的 frozen source 必須來自既有可信 original attempt／已證完整原集合；本候選尚無該 issuer。順序4只作鎖內重驗，不能補填、改造或重新發行 source。若沒有這個可信前置來源即 UNKNOWN；不得先逆序取得 Fulfillment 父鎖來 bootstrap，也不得把035 advisory升成 capability。

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
| 完整 lines／Claims／原 allocations／Issue references／q | 035 collector＋mapper 是 advisory／historical source；0097保存原 member/Movement引用 | 首次由真 Phase B 在固定父鎖內完整 discovery／核對時捕獲為可信 original attempt 的完整來源；日後 reconciliation 須在步驟2前已有該 frozen source，步驟4只重驗，缺來源即 UNKNOWN | 可重新完整讀原事實，但不能還原原 attempt 的 expected versions 或私有能力；不能以 advisory／待查row自簽補足 |
| 原 E_R Inventory preclaimHash／command | **035 尚無**真正 Phase B preclaim | 未來實際 `claimFulfillmentBatchInTransaction(...action:"REVERSE")` 回傳的 genuine preparation.requestHash，綁當次 actor/command/tx，而非預算 hash | 完成時 owner journal保存hash；現 reader要求先有可信原hash，沒有正式 REVERSE跨程序bootstrap／issuer，不能拿待查row自簽 |
| 原 E_R Sales intentHash／intent | mapper只有 salesIntentFields，缺原 actor/event/真 Inventory hash；**無真正 E_R Sales attempt** | 未來完整 normalized intent 綁 genuine preclaim 後，由既有 salesFulfillmentIntentHash 取得並隨真 Sales驗證／journal受理保存至可信 attempt | 完成 journal有原 recovery_payload/intent/hash；現正式 reader可驗，沒有可供Fulfillment跳過issuer的普通loader |
| 原 executor/tx 實際結果及取消邊界 | DB只讀 getTransactionOutcome；035保存的是 **Phase A** tx提交證據 | 真 Phase B executor／caller保存那一次 tx、COMMITTED/ROLLED_BACK/INDETERMINATE、signal及attempt關聯；目前尚無 | executor物件證據不跨程序；不能以例外、ACK失敗、或Phase A結果代替Phase B；未知commit須查真原事件 |
| lease nonce／attempt／排除舊 writer 的 fence | 035原 started有Phase A nonce/attempt1觀察；**不足以排除舊 Phase B writer** | 真 Phase B／Recovery 在持E_R operation鎖與可信lease/CAS及全attempt barrier下建立；目前未實作 | row可讀不是全attempt fence；需真正接管契約／排他邊界，不能由expired/pending本身推定安全 |
| 原 Inventory executor result、Sales applyHash/result／雙proof | owner源碼可讀已完成資料；035沒有真E_R executor結果 | 真 Phase B Inventory post結果及Sales apply同交易產生；查證時僅上述同session reader→verify取回真proof | 結果資料可由正式reader重新驗，但proof/context本身不能跨程序；現缺發行session的正式coordinator |
| 必要下游部署及provider／本地終局 | registry無正式宣告仍UNKNOWN；本地schema已定義投影history/audit/detail | owner正式部署契約＋真writer鎖內完成投影與0092終局，不能由兩reader補寫 | 保存的真終局可沿原路查；下游狀態須在同鎖域重驗，不能預設no-provider |

本次可驗收止於同樹來源、欄位消費與上述缺口。下階段才在真正 Phase B 寫入／恢復邊界建立 REVERSE issuer/caller；不把 SHIP verifier 改成接受 REVERSE、不新增未被使用的helper、不自創儲存或替舊結果補hash。全部權限、鎖序／CAS／FK／unique、原子性、100行／每行50／總5,000及20秒交易限制保持；非功能驗證延至UAT後依授權執行。

## 2026-11-09 Recovery 契約補充 — main `06caf911`，尚未實作

本節依 TL `fulfillment-task036-next-scope-verdict-20261109.md` 補充**下一個真正 consumer 的契約**；上文保留為各原 commit 的歷史觀察，不把其「尚無真正 Phase B」沿用為現在缺口。固定來源為 main `06caf9119d72d940d88192d6ebc1cd6eb065847c`／tree `4c5ce07671ec4b8f31aea28a554cc3f2994473d1`：PR #348 的 normal Phase B、原 PR CI `42554850522` 及自然 main CI `42557160760` 已成功。這些結果不驗證本節尚未實作的 Recovery，也不完成 TASK-036／整個 P2 或 UAT。

### 唯一實作方向及真正 caller

沿原 TASK-036，由其既定 `ShipmentReversalRecoveryJob` 消費私有 `recoverExpiredReversal(eventId, invocationCapability, {signal})` 契約；名稱在此描述待實作入口，不是現存公開 API。Job 對實際 scheduler invocation／cluster lease 的私有 token 負責，Fulfillment 對原 E_R、bootstrap、fence 與恢復決策負責。沒有獨立 same-process diagnostic／read-only helper 交付；不能用新的診斷標籤代替可恢復結果。

真正 REVERSE consumer 使用 **reversal-owned、同實例 InventoryLookup／InventoryFulfillment＋Sales pair，共用原 database／pool**；正常 writer 及其 Recovery reader 使用該同一組實例，建構時綁私有 purpose-bound verifier。不改 SHIP verifier，不加 phase 字串 router，不在建構後更換 owner verifier，不跨 instance／process 搬 proof。本文件不建立該 pair、issuer、Job 或 scheduler registration。

### 三個 crash 窗口與可得結果

| 原事件窗口 | 必查事實 | 可獨立辨認的結果；現有不足 |
| --- | --- | --- |
| Phase A 已提交，Phase B 未開始；或 Phase B 全部 rollback | 原 Phase A request／history／Reversal、有效原 actor、過期 E_R；取得真 operation X 及下列完整零效果證據 | 證據充分後才可按原計劃建立同 E_R 的新 fenced attempt；永久業務拒絕才走已批准的 failure／回 SHIPPED 流程。現有 REVERSE readers 只回 SUCCEEDED／UNKNOWN，**尚不能完成這項零效果證明**；不能靠「看來未開始」接管。 |
| Phase B 在途、client timeout／process 消失或 COMMIT 結果未知 | 同一 operation 的真 X lock、DB 目前終局及完整 source；不能以程序的 outcome enum／signal 作跨程序事實 | 尚取不到 X、資料不全或結果矛盾則保持待查；取到 X 後若原真終局已存在，返回原結果；否則仍須雙 owner 零效果與本地證明。不能因 lease 過期推斷舊 writer 已停。 |
| 原 native COMMIT 已成功但 ACK 遺失 | normal writer 把 Inventory、Sales、本地投影／audit 及 E_R SUCCEEDED 放在**同一交易**；原 terminal 的身份／hash／權限驗證 | 先由現有 `readReversalTerminal` 查回同一真終局，零追加 business write。兩 owner 有成功效果而本地 E_R 缺終局屬矛盾／非此正常原子狀態，維持 UNKNOWN；不靠 owner-only success 補寫終局。 |

來源：[正常 writer／Phase A](../../../server/src/modules/fulfillment/ShipmentReversalService.js) 的 `completeReversalPhaseB`／`startReversal`、[原終局讀取](../../../server/src/modules/fulfillment/FulfillmentOperationService.js) 的 `getShipmentReversalReplayInTransaction`。先查終局仍須重建並驗原 command 及目前原 actor；不是以任意 event row 返回他人結果。

### 先用既有 durable facts，逐欄重建而不新選 storage

| 所需原事實 | 既有權威來源與核對 | 能否跨程序取得／不能替代的資料 |
| --- | --- | --- |
| E_R、target S1、domain hash、correlation | `fulfillment_operation_requests.event_id,operation_type='REVERSE',target_type='SHIPMENT',target_id,payload_hash,correlation_id`；須對唯一 `shipment_reversals.event_id,shipment_id,correlation_id` 及 Shipment 的 reversal event 核對 | 0092 **只有 payload_hash，沒有完整 command、Inventory hash 或 Sales hash 欄位**；不能把 hash 本身 decode 為 payload。 |
| 原 command 的 version、reason、兩確認 | Phase A `shipment_reversals.reason,goods_under_company_control,goods_returned_to_original_bins,before_summary`；`before_summary` 保存 `{shipmentId,fulfillmentId,version,status:'SHIPPED',registryVersion}`；同 E_R 的唯一 `REVERSE_START` history 必須由 SHIPPED→REVERSING，`version_after=原version+1`，reason／actor 相同；Phase A audit 的 target、event、correlation、reversalId／version 亦對上 | 以這些原事實構造五欄 command，經既有 `normalizeShipmentReversal` 及 `fulfillmentOperationHash({operationType:'REVERSE',target,payload})` 恰等 0092 hash。不得只用今天 Shipment.version−1；before_summary 也不是單獨 authority，須交叉核對。其 registryVersion 只證當時觀察，不替代現在部署宣告。 |
| 原 actor、nonce／attempt／期限 | 0092 `initiated_by,lease_owner,attempt_count,lease_expires_at,next_attempt_at,status,is_document_archived`；Reversal `created_by`、Phase A history／audit actor 交叉核對；原 role／permission 從目前 directory 驗真 | Actor FK 可 SET NULL，label／username 不是原 user ID。刪除、缺失、歸檔、actor 不一致或 directory 不明都不補造身份／能力。nonce／attempt 是 DB 的目前 fence tuple，不是舊 callback 已結束的證明。 |
| E_S、SO／Customer／Warehouse、完整原行／member／leg | Shipment `confirmation_event_id`、原 SHIP operation／history／audit witness；完整 Shipment／Fulfillment Lines（含零行）；Claims 與歷史 Allocations；0097 Issue 的 `shipment_line_id,fulfillment_allocation_id,inventory_reservation_id,inventory_allocation_id,inventory_balance_id,inventory_operation_id,inventory_movement_id,issued_base_quantity` 及 bucket snapshots | 由原 Issue／關聯重建全部原 member／leg／quantity，原 member operation 可以跨腿重複。不能由 caller subset、現有 outstanding quantity 或只有 count／sum 取代。必驗 exact set、source／quantity conservation、archive 無分裂及原 witness；維持 100 行／每行 50／總 5,000 上限。 |
| 原 E_R Inventory hash／結果 | **有真 committed owner event 時**，`inventory_operation_requests` 原 root 的 `request_hash`、root/member/leg result summaries 及 Movement 有持久資料；現有 Inventory reader／codec 負責驗原 source、完整集合、原→反向引用 | normal Phase B 已在私有 attempt 捕獲真正 preclaim hash／command；WeakMap 不跨程序。0092／Phase A 沒保存它。原版本／candidate facts 不能由今天 Balance／Reservation versions 重算；Fulfillment 不直接查 owner journal 就自簽可信 hash。 |
| 原 Sales intent／hash／apply | 有真 committed E_R 時，`sales_operation_requests.request_hash,recovery_payload.intent,result_summary,completed_at` 保存原 normalized intent、Inventory requestHash／applyHash／members；由 Sales owner 的正式驗證契約核實 | normal Phase B 已捕獲真 normalized intent/hash，並非缺 Sales 交付。現有 reader 要求先有可信原 source/hashes，不是跨程序 bootstrap API。沒有 committed event 時，不存在可還原的「舊成功 hash」；零效果證明不應捏造它。 |
| 實際 executor／取消／完整 locked source | 本程序 normal attempt 已有真 `tx,signal,inventoryCommand,inventoryRequestHash,salesIntent,salesRequestHash,outcome`；完整 locked snapshot 仍是 callback local 變數 | executor、WeakMap、signal、proof 都不跨程序；新的 Recovery 只能重新證原 durable facts 與 DB fence，不能假造 COMMITTED／ROLLED_BACK、舊 expected versions 或把 advisory 升為 capability。 |

來源：[0092 schema](../../../server/database/migrations/0092_create_fulfillment_operations_and_sequences.js)、[0097 schema／triggers](../../../server/database/migrations/0097_create_shipment_issues_and_reversals.js)、[snapshot／完整鎖內檢查](../../../server/src/modules/fulfillment/shipmentReversalSnapshot.js)、[Sales 原事件驗證](../../../server/src/modules/sales/SalesFulfillmentService.js) 及 [Inventory 原事件驗證](../../../server/src/modules/inventory/inventoryFulfillmentOutcome.js)。本節**不預建新表或 JSON payload**：原 domain command 可先用上述 facts/hash 證明；沒有足夠事實則列為具體缺口，不把 storage 當答案。讀到原 owner rows 但無法正式驗原 hashes 時保持 UNKNOWN；本節不新增 partial-effect repair。

### 真 old-writer fence：inspection 與重試授權分開

1. 私有 Job capability 只證真正 scheduler invocation／cluster lease／deadline，不給業務權限。先以原 actor 的目前 fresh view＋reverse context 驗原 terminal；若非終局，開全新 actual RC，對同 E_R `FOR UPDATE`，以 DB clock 重讀。核 id/event/type/target/hash/actor/correlation、IN_PROGRESS、未歸檔、空 result/error/completed、old nonce、old attempt、精確 expiry／next-attempt 到期條件；超界／等待逾時／不一致一律待查，不改全域隔離或 20 秒上限。
2. X lock 是正在此 DB transaction 中的**inspection fence**：normal Phase B 在任何 Inventory preclaim 前已取得並持 E_R X 至 COMMIT／rollback。若舊 DB transaction 仍可能提交，Recovery 不能先取得該 X；若舊 COMMIT 已成功，取得 X 後須看到原 terminal，重走原結果。原程序仍可能在 timeout 後執行 JS callback，不能把外層 promise reject 當 drain；它的舊 DB writer 不是靠 signal／lease 字面排除，而是此 DB X 的互斥、closed/aborted executor 及下面的 nonce/attempt fencing。
3. 持 X 本身不授權 retry／回 SHIPPED。保持上文 Doc99 鎖序：先 Inventory scope／E_R operations，再 Sales journals／SO／Lines／mappings，再 Fulfillment root／children／S1／Reversal／完整 Issues 及必要 downstream guard，最後 Inventory domain locks。**不得為 bootstrap 先拿 Fulfillment 父鎖再倒回 Inventory/Sales。** 現 RR `readShipmentReversalSnapshot` 明確拒絕 caller transaction；它不能直接充當持 X 的 fresh-RC bootstrap。Fulfillment 必須提供從已核 Phase A＋不可變原 SHIP/Issue facts 建立完整 source、在正確父鎖階段再重驗 exact set 的真正 loader；未證來源不先 mint owner session。
4. 只有下節同 transaction 的完整零效果 proof、原身份／權限／deadline 重驗及既定 eligibility 均通過，後續實作才可把 takeover CAS 與 proof 放在同一原子決策。CAS 應綁原 id/event/type/target/hash/actor/correlation、status、old nonce、**old attempt**、精確 old expiry 與到期條件，換全新 nonce、attempt+1、DB-clock lease，保留原 event/domain command。`takeOverInTransaction` 已有 X／nonce/hash／到期 CAS 原語，但沒有獨立 expected-attempt/input capability，不能把通用方法直接當完整 Recovery fence。UNKNOWN 不提交 takeover；此為待核定 Recovery 決策契約，不是上文 read-only session 自行取得 DML 權限。owner read session 驗證完即失效，不能升成 owner writer；後續 Fulfillment 決策須有其本身已核定的 job／actor／fence authority，且本文件沒有 DML 授權。
5. 釋放 inspection locks 後，待執行的新 writer 必須重新持 E_R X，核新 nonce／attempt／identity／lease／實際 active RC，再按同一鎖序重新驗業務來源；不沿用 read-proof 當寫入 proof。舊 queued writer 的私有 binding 仍是 old nonce／attempt，必須在 preclaim **之前**被拒絕；既有 pending-row lookup 不產生新 started capability。保留半租約／原子 X 期間續租的 HD-027 限定規則，原 framework/query/acquire/deadline 不放寬。

來源：[normal operation fence／私有 binding](../../../server/src/modules/fulfillment/ShipmentReversalService.js)、[generic takeover／terminal CAS](../../../server/src/modules/fulfillment/FulfillmentOperationService.js)、[DB callback race、abort destroy／unknown commit](../../../server/src/services/mysqldatabase/MySqlDatabaseService.js)。新的 loader、私有 job admission 與完整 attempt fencing 是 **Fulfillment 尚缺的 consumed contract**，不是缺 Inventory/Sales 原有 readers。

### 零效果：現契約不足及最小 owner-contract delta（提請 TL 核定）

選定路徑是 **terminal-first → 同一 fence 下完整三方零效果證明 → 才依原 TASK-036 決定新 attempt 或已批准永久失敗**。不引入 pending-row 推論、shared phase router、owner-only success 修復或新的撤權例外。現有 API 無法完成中間一步：Inventory 的 reversal binding 要求可信 Inventory hash，`finishFulfillmentReversalOutcome` 無完整 root 便 UNKNOWN；Sales 的 reversal read 對缺 journal／null hashes 亦 UNKNOWN。SHIP 的 ABSENT 不適用。

所需的是以下具名 owner 的**狹窄新證明契約**，不是要求把既有 UNKNOWN 改名為 ABSENT，也不在此發明 endpoint／response enum 或修改現有成功讀取介面：

| Owner／尚缺的證明 | 最小精確範圍與鎖責任 |
| --- | --- |
| **Fulfillment：durable bootstrap＋本地零效果／fence** | 證上表原五欄 domain command/hash/actor、唯一 Phase A、完整不可變 E_S/Issue/member source；在同 E_R X 下依正確 rank 重驗全部父子集合。原 E_R 沒有成功 root/shipment terminal history/audit，沒有任何 reversal detail／Issue reversal pointer／Line 或 Claim reversed 效果，root 仍 SHIPPED 且 active_shipment_id 為原 S1、未有 reversed_at/by；S1 仍 REVERSING／原 version+1、Reversal 仍 REVERSING／version1，原 reason/確認/before_summary及原 audit／REVERSE_START完整，不能只看 status/count。Archive、schema、原 actor、來源不足或 callback/writer fence不明均不發 proof。 |
| **Inventory owner：同 E_R 原庫存效果的零效果證明** | 私有 verifier 必須核真正 Fulfillment Recovery inspection session/fence、完整原 E_S/Issue references及 fresh actor。沿既有 scope/operation → 後段 Warehouse 等 domain 鎖序，驗原 ISSUE 真 receipts、member/leg/Reservation/Allocation/bucket 身份及現有 conservation；查同 E_R 的全部 SHIPMENT／SHIPMENT_LEG root/member/leg journals，並查**每個原 Movement 的任何 reversal reference**，不可只查一個 root 或總數。存在任何 partial/pending/其他事件的反向資料、未知 writer、缺 schema/來源皆不證零；scope 缺失不是可新 claim 的空集合。不能用新的 preclaim/INSERT 查存在性；不得改舊 hash 規則或以今日 versions 偽造原 hash。 |
| **Sales owner：同 E_R 原 Sales 效果的零效果證明** | 在相同真正 session/fence 下，鎖原 E_S及E_R journal再SO/Lines/mappings；驗原 SHIP normalized intent/receipt、原 reserve identity、完整行/member/原 Inventory member 對照及現有 conservation，證 E_R 沒有 journal、fulfillment-reverse history/audit 或任何 attributable apply效果。不能把 mapping/currentVersion 當「舊 attempt 沒做過」；其他合法 event 的版本變化也不能冒稱原 E_R效果。partial/缺來源/未知結果不證零，不授權 service actor、不回寫 Sales。 |

兩 owner 均須以 private same-tx/session/source-bound proof 供原實例 verify；完整零效果須與本地 proof 在同 fence 逐欄對齊，不能以兩個查詢 null 拼成結論。證明「原 E_R 沒有效果」與「現在可再執行」分開；bucket/downstream 等現在 eligibility 不明，仍不能 retry／terminal DML。若零效果充分但沒有可信舊 hashes，不為不存在的舊提交創造 hash；只有正式新 fenced attempt 的真 preclaim/normalized intent 產生新的實際 hashes，且原 domain event/理由/確認/數量不變。

有任一原 owner row／效果則不得走這條零效果路徑：原終局可驗真才返回，否則 UNKNOWN，保留原證據交 owner/TL查明。只有當正式 owner 契約能驗其持久原 hashes/結果時，才可沿上文現有雙成功查證；成功 proof 本身依然不補本地 terminal。若上述完整否定證明尚不能由 owner writer/locking invariants成立，缺的就是該**具體 proof/serialization contract**；目前不能宣稱已具 safe retry 或需要先建新 storage。

### 原 actor／撤權與具名接續

Job capability 仿現有 [confirmation Job](../../../server/src/services/fulfillment/ShipmentConfirmationRecoveryJob.js) 的私有 invocation／framework lease 驗證方向，但不借其 SHIP token。原 `initiated_by` 須與 Phase A actor 一致，載入目前 directory 的原 user/roles/permissions並重驗 **fulfillment.view＋fulfillment.reverse**；不把 background service claims 當原 actor。現 [readShipmentRecoveryActor](../../../server/src/modules/fulfillment/shipmentRecoveryActor.js) 的 `eligible` 檢查是 view＋operation，不能原樣當 REVERSE eligibility。此為 Fulfillment 的精確目的綁定缺口；不是增加權限例外。

原 actor disabled/revoked、deleted／SET NULL、directory失敗或來源歸檔一律不取得新的業務／failure-only／retry能力，保留待查並按既有安全診斷交接。現兩 owner reversal readers要求當前原 actor 的 fresh view＋reverse；SHIP 已有的撤權 failure-only policy 不自動套用 REVERSE。若將來要為 REVERSE 擴展撤權例外，須 PM 集中把具體業務／權限取捨交 Sam；本節沒有作此決定。

下一個可驗收交付是 **Fulfillment loader/fence/job-purpose 契約＋Inventory/Sales 上述零效果 proof/serialization 的 TL 核定**，再定真正 consumed source 的最小範圍；不是先建 pair/helper 等 caller。TL 協調精確新 owner delta，不重交已有 read/verify／normal hashes；PM統一協調後續 source及新功能案例准入。Returns／AR 的真 providers與部署 membership仍是適用執行／公開啟用 gate：未能驗真則UNKNOWN，不能預設 no-provider；它們不阻擋這次內部契約整理。保留原TASK036 API/Job/回SHIPPED/並發/Crash/UAT全部驗收義務，沒有標DONE、降低門檻或以文件／既有綠CI代替新Recovery驗證。

### 2026-11-09 Joint event-admission：權威 mapping 與 claim 前入口的精確缺口

本窄補充沿 TL `task036-joint-owner-contract-verdict-20261109.md`，只消費已完成的 Inventory 三問及 Sales 四入口評估；不要求重交 readers。產品仍固定 main `06caf911`；上面 `de1d1d68` 已接受內容不改。**本次交付驗收結果為「尚無已證相容的全 caller 入口；列明具體矛盾」**，不是一個可直接實作的 admission helper。共同命題仍是：原事件所有合法 journal／attributable-effect 路徑，在 inspection 至決策期間，均由同序屏障排除，或由 owner 權威證明不屬該 identity；UNKNOWN passthrough 不能滿足它。

#### 真 TASK-036 entry 能從哪些現有資料辨識 current identity

| 入口所需權威 | 既有 records／fields及 current-read 位置 |
| --- | --- |
| 原 managed E_R及S1 | 真 Job invocation進入前節私有 Recovery entry；以已正規化 event定位現存 `fulfillment_operation_requests`，在新 actual RC 先持其 X，重驗 `operation_type='REVERSE',target_type='SHIPMENT',target_id,event_id,payload_hash,initiated_by,correlation_id,lease_owner,attempt_count,lease_expires_at,is_document_archived` 及完整 Phase A。target_id 是owner保存的S1身份，不是把 Inventory caller.documentId 直接 numeric 化。 |
| S1 → Fulfillment／SO／Warehouse | 同一RC中普通 current read `shipments.id,fulfillment_id,sales_order_id,customer_id,warehouse_id,reversal_event_id,correlation_id`；對 `fulfillments.id,sales_order_id,customer_id,warehouse_id,active_shipment_id`、同E_R唯一Reversal及前節原hash/history核實。0096 `trg_shipment_update`固定S1的id/fulfillment_id/SO/customer/warehouse；不能只信denormalized before_summary或caller另給的fulfillmentId。這裡不先鎖Shipment／Fulfillment父行；持E_R X且完整bootstrap成立後，才可交給早階scope admission，於既定Fulfillment rank再鎖全來源並逐欄重驗。單次無鎖讀取本身不發proof。 |
| 既有 PICK_SCOPE 身份 | 由上述owner核實的fulfillmentId定位 `inventory_operation_requests`：`source_module='FULFILLMENT',source_document_type='PICK_SCOPE',source_document_id=fulfillmentId,source_line_id='',source_event_id='scope-v1'`；Inventory核其command/result為 `FULFILLMENT_SCOPE_LOCK/FULFILLMENT_SCOPE`、result_id、原scope request_hash、completed_at及result_summary的warehouseId/salesOrderId，必須與owner身份相同。inspection只讀／鎖既有row，不INSERT scope或placeholderclaim。 |
| 真／歸檔／不完整身分 | 除operation.is_document_archived，須核 `shipments_archive`／`fulfillments_archive` 及原所需完整來源，必要時以0099的archive_batch_id/archived_at/row_hash與 `sales_archive_order_manifests` 的sales_order_id／fulfillment_table_counts／fulfillment_hash_summary及批次對照。這些只能識別歸檔／live-archive分裂，**不是從archive重建active writer的授權**；本Recovery entry對archived、缺schema、缺任一關聯／scope或互相矛盾一律不admit。 |

欄位來源：[0092](../../../server/database/migrations/0092_create_fulfillment_operations_and_sequences.js)、[0096及其immutable owner關係](../../../server/database/migrations/0096_create_shipments.js)、[0097](../../../server/database/migrations/0097_create_shipment_issues_and_reversals.js)、[0099 mirrors](../../../server/database/migrations/0099_create_fulfillment_archives.js)、[0088 manifests](../../../server/database/migrations/0088_create_sales_archive_batches.js)、[scope receipt](../../../server/src/modules/inventory/inventoryFulfillmentScope.js)。這些支援 **已知原E_R的Recovery loader**；並不等於已有可供任意generic caller使用的共同mapping API。

legacy/non-Shipment是另一個來源判定，不能以「不是數字／查無Shipment」自動證outside。`SHIP-42`／`posted-1`及provider random-UUID documentId是現有接受的識別方式；不存在權威alias→Shipment映射或反向owner證據時，身份仍未證。即使今天用RC查無資料，也不能證先前獲准、尚未claim的caller在之後不會進原event；更不能用其原RR舊snapshot查無row作outside。已證是其他owner來源，亦須同時證不屬被檢視的event／effect身份；特別是Sales全域event唯一，不因target是別的SO／IMPORT_JOB便能排除。

#### 必需的合法早階位置，及現有 caller 的實際證據

單一共同規則應先由Fulfillment owner核原identity及真transaction／phase，然後由各入口在**第一個原event INSERT／duplicate-read，以及任何較後owner/domain/parent鎖之前**消費同序admission；inspection與claim兩邊必須持有相衝突的既有barrier，不能只發一個mapping結果。已知managed Recovery／normal REVERSE的順序是 E_R X → Inventory PICK_SCOPE／event operations → Sales journals／SO／Lines／mappings → Fulfillment父子 → Inventory domain；generic的caller-owned交易若已在較後rank，不能再補早階鎖。沒有現存證據可把任意這類tx聲稱為early；不新增lock-rank框架去假裝可證。

| 真實入口／第一個相關動作 | 已證可用位置與沒有被它涵蓋的事實 |
| --- | --- |
| `ShipmentReversalService.completeReversalPhaseB` | 自建fresh RC，`#lockReversalOperation`先於Inventory preclaim；`claimFulfillmentBatchInTransaction`先scope再batch。這是現有真正合法early caller；它不能替其他generic／Sales呼叫者簽admission。未來真正TASK036 Job必須在自己fresh RC開始即消費同一identity/fence，而不是從query到pending DTO自簽token。 |
| `InventoryOperationService.claim` | source/type/hash驗證之後、`INSERT inventory_operation_requests`／duplicate `FOR UPDATE`之前是單一攔截**候選位置**。但input只有source/commandType/payload，並無上述權威S1→scope入口；`assertExecutor`與 `assertInventoryTransaction`只要求query/execute，不能證current RC、尚無later locks或scope-first。`InventoryPostingService.#postIssueInTransaction`在本方法內是claim→Warehouse，但provider接受caller-owned tx，外層之前是否已持Warehouse／父鎖未由其契約保證；不能在claim一律補scope／E_R X。原scope-v1 claim本身也不能遞迴取這條路。 |
| `SalesOperationService.claimConfirmation/claim` | 自己直接INSERT／duplicate event read，不持Fulfillment E_R或scope；所屬target可為SO、Quotation或Import。不能用它作唯一攔截點，因下面三條沒有經過它。 |
| `SalesImportService.upload` 的stage | 自己的 `operations.run` callback，在freshactor後直接INSERT `UPLOAD_IMPORT/IMPORT_JOB`，之後才建立Import Job；補償會鎖operation/job並刪自己的未完成stage。共同event准入需涵蓋這個pre-INSERT位置及其retention契約，不能等原SO鎖，也不能只查stage當下是否存在。 |
| `SalesIntakeService.process/#operation` | process持其framework/job fence，從intake讀 `processing_event_id`及actor後，直接claim `PROCESS_INTAKE/INTAKE_ORDER`；之後才 `#job`／intake `FOR UPDATE`。可指出其目前pre-claim位置，但framework/job fence不是Fulfillment E_R ownership。不能把intake的非SO target當原event不可能有journal的證明。 |
| `SalesFulfillmentService.lockLinesForFulfillmentInTransaction` | non-CLAIM直接INSERT shipment event，之後才SO/Lines/mappings；REVERSE另先讀原SHIP journal。normal coordinator已持正確E_R/scope；直接modulecaller只驗自己的active RC及actor/receipts，並不證Fulfillment先行admission。共同規則須在首次event claim／後階鎖之前由真正caller消費，不能只在apply或SO鎖後補檢。 |

直接source：[normal reversal](../../../server/src/modules/fulfillment/ShipmentReversalService.js)、[Inventory generic claim](../../../server/src/modules/inventory/InventoryOperationService.js)、[generic/provider transaction契約](../../../server/src/modules/inventory/inventoryValidation.js)、[generic ISSUE入口](../../../server/src/modules/inventory/InventoryPostingService.js)、[Sales Operation](../../../server/src/modules/sales/SalesOperationService.js)、[Import](../../../server/src/modules/sales/SalesImportService.js)、[Intake](../../../server/src/modules/sales/SalesIntakeService.js)、[Fulfillment direct claim](../../../server/src/modules/sales/SalesFulfillmentService.js)。這是既有named入口及已評估範圍，不把任意SQL／audit helper發明成額外公開攻擊路徑。

現有查詢也不能補出早階准入：[ShipmentInquiryService.#read](../../../server/src/modules/fulfillment/ShipmentInquiryService.js)拒絕已有caller transaction並另開RR；`readShipmentReversalSnapshot`亦是獨立RR，`readLockedShipmentReversalSnapshot`則先取後階Fulfillment父子鎖。Inventory `getFulfillmentReversalPreparationInTransaction`要求numeric shipmentId＋完整原operation IDs，不能只傳generic source得到scope。換成Shipment `FOR SHARE`再返回scope、在caller原RR普通讀「看不到」便放行、或在Warehouse之後才admit，都不符合本契約。

#### 目前不能同時成立的條件、before/after與處置

- **身份矛盾**：要保留generic/provider既有opaque documentId及無Shipment／無scope的合法呼叫，同時又以這些caller字串、查無row或missing原opIDs得到權威outside判定，目前沒有相容契約。具名證據為 `inventoryIssueService.test.js` 的TASK023 `postFulfillmentIssueInTransaction` 使用 `SHIP-42/posted-1`，及 `inventoryStocktakeSafety.integration.test.js` 的同provider random-UUID source；這是已接受API行為證據，非聲稱這些fixture就是某個已部署訂單流程。現在可依原權限/receipt/冪等規則posting；若改numeric-only、要求新scope/source token或一概封FULFILLMENT namespace，這些呼叫會在原業務效果前被新拒絕／須遷移，屬真相容性變更，未批准。
- **位置矛盾**：generic caller-owned tx目前沒有「尚未持later鎖／current RC」的可驗入口保證。強加早階E_R/scope可能形成較後domain→早階operation/scope的倒序；強制另開tx或切isolation也改變現有transaction契約。normal REVERSE的正確入口不能證所有generic caller都符合，不能只靠函式命名或client加alreadyLocked。
- **event矛盾**：Sales四入口共用UUID，其他target可先claim同E_R；原SO鎖只穩同root效果。Inventory generic能claimexact SHIPMENT/SHIPMENT_LEG tuple但不持PICK_SCOPE。若任一合法入口仍可unknown passthrough，inspection後仍可能有新journal，不能同時簽Doc99的stable全event零效果proof。scope/row不存在時不INSERT補足；不以減弱命題解決。

**現階段採取的處置**：保留目前generic/legacy接受行為與UNKNOWN，Recovery沒有零效果proof便不takeover／retry／terminal DML；這不是原TASK036驗收豁免。TL可消費的精確缺口是「Fulfillment的已知current identity可由上述記錄驗真，但尚無覆蓋所有合法caller、在later locks前可驗且處理legacy/缺失/歸檔的共同owner admission入口」。不是再缺一份成功reader或一個獨立proof helper。

後續現實選項只有：（A）若TL另有能直接出示的既有producer身份／caller順序契約，僅交其精確差額，證可在原輸出／原transaction語義不變下前移並消費同一admission，對legacy取得**真正owner outside-identity證據**；目前沒有，不據此要求兩owner重盤同一問題或宣稱可實作；（B）若實際caller沒有這個位置／身分來源，明確改managed event/namespace及legacy接受契約，列出上面合法provider的before/after、必要caller遷移及業務影響，再由PM判定是否交Sam。**建議目前維持保守處置，由TL只就這些精確identity／early-entry差額裁定A是否成立；不成立則PM一次整理B，不能在產品偷偷選B。** 不預選新event registry／storage／隔離策略，不再請兩owner重盤模塊；Revoked actor、Doc99全event要求及原成功readers不變。本補充沒有source/helper/API/schema/job/test/validator/DB/CI/push授權。

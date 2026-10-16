# TASK-043 解鎖交接：權威 GR、Supplier 投影與 reconciliation

日期：2026-10-14。Item 負責人整理；接收方：Purchasing／Receiving、Supplier 負責人。

本文件整理既有要求與待確認接線，不另立 schema／API／事件合約，不代表接收方已核准或實作。只修改 Item 文件；TASK-043 保持 IN_PROGRESS，DEF-107 保持 HIGH／OPEN。正式 UAT、business／release acceptance 另行處理。

## 1. 現況與權威來源

### 2026-10-16 main 重核（優先於下列歷史 baseline 敘述）

本次 fetch 後的 `origin/main` 為 `089dd45b6ca5558511ae6396a88f732d5df43927`，即 [PR #236](https://github.com/crazysumsum/erp-app/pull/236) 的實際 merge commit；沒有較新的 main 來源可解鎖 GR。只做 repository source／migration／接線盤點，沒有查驗部署中資料庫，也沒有重跑 DB、Technical Acceptance 或 UAT。既有測試保留其原始 baseline，不改標成本次執行 PASS。

| 能力／剩餘工作 | 最新 main 觀察與分工 |
| --- | --- |
| Item 已交付 | Inventory／Sales 引用保護（TASK-045）、已安裝 Supplier 引用回歸（TASK-047）、purchase lookup（TASK-046）均已整合；TASK-048 `findManyForCommittedReceipt()` 現亦已透過 PR #236 合併，不再是待 Item 開發的 provider。這些局部交付不等於 TASK-043 完成。 |
| GR 正本、Confirm、Inventory 原子結果 | `server/database/migrations` 未有 `goods_receipts`／`goods_receipt_lines`／`goods_receipt_details` 的建表實作；`server/src` 未有正式 Purchasing／Receiving Confirm runtime。由 Purchasing／Receiving 交回實作及正式流程產生的合成來源。 |
| 正式來源 verifier | `SupplierRelationService` 仍以 `sourceVerifierUnavailable` 為預設；production 建構點 `supplierSkuRelationHandlers.js` 沒有注入 `verifySource`。測試注入的 verifier 不算正式接線。由 Purchasing／Supplier 按第 2–5 節交回來源一致性及 ownership 證據。 |
| post-commit caller／reconciliation | `server/src` 中未找到正式 `recordSupply()` caller 或由權威 GR 發現漏投影的補寫實作；方法本身與低敏失敗告警不是完整補寫流程。由 Purchasing／Supplier 完成，不由 Item 代建。 |
| Item 尚欠的 TASK-043 C | GR-01 首次延遲歷史投影、GR-02 真來源重送／衝突、GR-03 失敗後 reconciliation 的實際 consumer integration，均等待上述正式路徑；維持 BLOCKED／DEF-107 HIGH OPEN。 |
| Item 尚欠的 TASK-043 D | 完整 TC-004／TC-005 技術接受及 UAT-005／UAT-013；不能由既有局部 34-case 或 TASK-048 developer checks 代替。正式 UAT 仍另行處理。 |

### TASK-048 已交付邊界及可採用入口

權威合約仍是 [Item DES-022](03_design_spec.md#des-022--dedicated-committed-receipt-current-facts-provider)；實作位於 [ItemLookupService](../../server/src/modules/item/ItemLookupService.js) 的 `findManyForCommittedReceipt(skuIds, { atMs })`。這是唯讀的**目前事實**，不是已提交 PO／GR 證明，不會自行核准 Receiving 例外，也沒有改變既有 purchase／inventory 用途的資格規則。

- 輸入為最多 100 個去重後的正 safe-integer SKU IDs，回傳按 ID 排序的 Map；不存在的 SKU 或 serial tracking 仍 fail closed。
- 回傳目前 lifecycle／flags、UOM association identity／ownership／master status 與 warnings，不因目前停用／到期等情況授予新採購資格。呼叫方仍須核對 Confirmed PO 快照、例外原因、交易內重驗及 Inventory 收貨規則；不能把目前 facts 當作原單據 snapshot。
- Purchasing 可在其自身獲批准的 consumer 實作流程採用此 provider，本文件不代其授權；若有新的 snapshot、警告、鎖／交易需求，先交回具體 contract diff，不能由 Item 在無 caller 的情況下猜測或新增用途。Supplier 的來源 verifier／事件投影仍是獨立交接條件。

本次可推進的是修正這份 Item 交接狀態及確認上述入口；未發現另一項已具備真來源前提、尚未開發的 Item 產品改動。不新增假 GR、測試專用成功 verifier、空 reconciliation job，也不更改現有 PLAN、核心 gate、正式接受或其他模組文件。第 5 節的「尚未提供」及規劃狀態保留為 2026-10-14 歷史，已由本節的實際合併觀察取代。

### 歷史 baseline 與交接沿革

檢查 baseline：main `cb75f25a87cb8f0cb97b14dc6bdc4131c3217b17`。Inventory／Sales 引用保護、Supplier 已安裝引用的增量 C、採購 lookup 已分別合併；[限定引用驗證報告](testing/09_tc004_tc005_reference_verification_20261014.md)保存兩次各34個 leaf PASS，但不是完整 TC-004／TC-005 或 GR 正向證據。

PR #220 合併前再觀察 main `3239b98f8938697475bf6201ba1a52c48ccef127`：新增 Supplier for-SKU lookup 效能／測試／報告；Item provider、SupplierRelationService 與 Purchasing GR 接線未變。整合此 main 後的新文件 candidate 必須重新通過 CI／review，不能沿用舊 head 的 CI；本交接的 GR 缺口及 owner 待確認事項保持不變。

- [Item 設計 §5.14](03_design_spec.md#514-supplier-referencesupplier-擁有)：已提交 Confirmed GR 的歷史 projection 不套用新採購資格，仍須核實來源、未物理刪除的 SKU identity 及相關 UOM ownership；不得恢復 Active、preferred 或新採購資格。
- [TASK-043](05_development_tasks.md#task-043--integrate-first-real-downstream-reference-guard)：C 的剩餘 GR 整合與 D 的完整技術／UAT 接受不能由局部完成取代。
- [Supplier 設計 §6.8](../supplier_management/03_design_spec.md#68-supplier－sku-relation-與-lookup-apis)與[實際 service](../../server/src/modules/supplier/SupplierRelationService.js)：`verifySource(connection, command)`預設回503 `SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE`，尚無正式來源 adapter；既有 event 重送會先回 durable fence 結果，不再次呼叫 verifier。
- [Purchasing 設計 §2.4、§4.9–4.11、§12](../purchasing_receiving_management/03_design_spec.md)：描述 GR 正本、提交與復原；baseline 未有正式 Purchasing GR runtime／schema／post-commit caller。設計中的表名與 method 不等於已安裝能力。

合成資料可以由**正式 Purchasing 流程**產生，重點是實際正本與提交事實、正式 verifier／caller 存在。僅 seed `supplier_supply_events`、手填來源ID、注入永遠通過的測試 verifier，或 Inventory 單筆 receipt，都不足以證明權威 completed GR。

## 2. 分工及需交回 Item 的證據

| 工作 | Purchasing／Receiving 責任 | Supplier 責任 | 交回證據 |
| --- | --- | --- | --- |
| 權威 GR 正本 | 落地經自己流程核准的 GR header／line／detail、ownership、Confirm 提交與 Inventory 原子結果；保留可核實的 confirmation 事實及不可變來源 snapshot | 不以 soft relation／supply event 自己證明 GR 已完成 | 已合併 PR／commit、migration、實際來源查詢／provider 路徑、由正式 Confirm 產生的合成 fixture |
| verifier | 提供能核實 GR 已提交及 command 與正本一致的 adapter／provider；擁有來源讀取與一致性責任 | 在正式 `SupplierRelationService` 建構／接線處注入該 verifier，所有新增來源投影均經核實；無法核實時 fail closed | 實際 constructor／registration 路徑與無來源、未提交、錯誤 ownership／payload 的負向測試 |
| post-commit 投影 | GR 真正 commit 後產生穩定逐來源 command；呼叫 Supplier；回應丟失時先核實 commit outcome，不盲目產生新 event | 同一 Supplier transaction 原子寫 event、relation 摘要及低敏 audit；維持既有來源唯一鍵與 payload fence | 真正的 commit→caller→verifier→Supplier 路徑、原子 rollback／並行／重送結果 |
| reconciliation | 從權威已提交來源發現漏投影，保留原 event／來源／payload，提供受控重試入口及復原證據 | 提供同一 `recordSupply` outcome／冪等回覆；配合告警與安全查核，不重建 Purchasing／Inventory 正本 | 首次投影故意失敗後，正式補寫入口成功；重跑不重複 event／audit／relation 累計 |

Item 只提供／驗證自己的 SKU／UOM identity、引用保護與歷史讀取；不建立 GR 表、不直接寫 Purchasing／Supplier 資料、不替其 owner 核准 migration、排程或合約。

## 3. command 與 verifier 核對要求

沿用現有 `recordSupply(command)`，不新增 endpoint：

```js
{
  eventId, sourceType: "goods_receipt", sourceId, sourceLineId,
  supplierId, skuId, purchaseSkuUomId, supplierItemCode, suppliedAt
}
```

Purchasing／Supplier 須共同確認並文件化每欄的**權威欄位來源**：

- `eventId`：同一來源行首次、重送及補寫沿用同值；現有 service 接受1–64個可見 ASCII 字元，區分大小寫。不得重用一個 GR header 的 eventId 給多個不同來源行。逐行產生／保存方案由接收方確認，本文件不指定新演算法。
- `sourceType`固定為`goods_receipt`；`sourceId`／`sourceLineId`須為正整數穩定 identity。確認 Supplier 的來源粒度是 GR line 還是 physical detail；不能直接沿用 Inventory detail 的 sourceLineId 而未確認 Supplier 投影粒度。
- `supplierId`／`skuId`須與來源 header／line／PO ownership 一致；不得接受只「ID存在」或由任意 caller 自報已完成的證明。
- `suppliedAt`須來自可重現的已提交來源 timestamp，現有 validator 接受非負 safe-integer epoch ms；`supplierItemCode`從來源 snapshot 重建，不能在重送時改用目前主檔值。
- `purchaseSkuUomId`是 `item_sku_uoms.id`，不是 UOM master ID；可為NULL。非NULL時核實該 mapping 屬於同一SKU及來源，而非重新要求目前 active UOM。現行 Supplier 投影不會把這欄綁到新 relation，只在 command／payload fence及audit保留；不可把它描述成已實作採購單位自動回填。

Verifier 必須區分「無法取得／核實來源」與「來源不符合已完成／ownership／payload」並使用兩方核准的錯誤處置；本文件不新增 error code。DRAFT／未提交／確認前取消不能作已完成來源。Supplier／SKU 後來停用、停產、封存或到期，不應因新採購資格 gate 而否定一個真實已提交來源。

現有 durable fence 語義須保留：同event同normalized payload回原結果，不重複audit；同event不同payload、同來源換event或不同payload回`IDEMPOTENCY_CONFLICT`。來源核實失敗時，新的 Supplier event／relation／audit 不得部分落地。

## 4. 投影及補寫邊界

1. 正式 GR／Inventory 的 commit 與 Supplier soft projection 是不同完成點。後者失敗不得回滾已提交 GR／Inventory，也不得把正本標成「未提交」重新收貨。
2. 新歷史 relation 保持既有`source=purchasing`／`relationship_status=alternative`；既有關係狀態不被自動改 preferred。首次／最後供貨時間沿用現行 earliest／latest 規則，不改 Supplier／Item／SKU 狀態，不授予新採購資格。
3. 投影失敗留下低敏 event／來源ID／錯誤代碼，能找到原已提交來源並沿用同command補寫。低敏告警不是 durable retry 來源本身；接收方須交代如何從正本發現與補回遺漏、處理中斷及不確定 outcome。
4. 補寫不重跑 GR Confirm／Inventory receipt、不重算或重寫其正本。以真來源驗證首次延遲投影與重送，不以已seed的Supplier歷史代替首筆流程。

## 5. 接收方需確認的未決接線

以下是**待兩方 owner 確認**，不是本文件已選定的政策：

- Supplier 逐來源事件粒度、欄位 mapping及穩定event生成／保存方式，包含 `suppliedAt`與`purchaseSkuUomId`的 snapshot來源。
- GR 後來`PARTIALLY_REVERSED`／`REVERSED`時，歷史來源核實及首次延遲投影怎樣判定；不能只比對目前header status就擅自接受或拒絕。保持既有不可變歷史，新增補償語義須另走 owner 決策。
- 正式 verifier 的接線／來源讀取一致性／鎖順序、錯誤處置；reconciliation入口、執行owner、授權、批次／重試與runtime隔離。不得為了通過測試另開每次成功的fallback verifier。
- Purchasing §2.4 提到的`ItemLookupService.findManyForCommittedReceipt(skuIds,{atMs})`在 baseline **尚未由Item提供**。它涉及 Receiving 已有承諾與目前 lifecycle／flags／warnings 的新專用合約，不等於現有泛用`findById`或purchase lookup。若Purchasing需要，須向Item交回具體consumer合約與snapshot／warning／exception要求，由Item另行 DESIGN／PLAN 審查及owner核准後開發；本次交接不授權或宣告已交付。
  - 2026-10-14 Sam已另外授權只做規劃；Item的[DES-022／TASK-048提案與待核准決策](09_committed_receipt_planning_review.md)已整理。這不是provider已實作、consumer已採用或GR已解鎖；既有purchase／inventory規則不放寬。

## 6. TASK-043 解鎖／Item 重入條件

接收方以自己的流程完成核准、實作、developer regression、CI／review與main合併後，交回上述來源與接線證據；文件寫「完成」或測試fixture verifier不代替實際接線。Item先檢查新main與own contract，再批准／凍結相應實作及測試PLAN／candidate；不沿用舊34-case結果宣告新baseline PASS。

| Item 後續案例 | 必須觀察的結果 | 尚未就緒時 |
| --- | --- | --- |
| GR-01 首次延遲歷史投影 | 正式 Confirm 已提交後才將SKU停用／到期／封存，再首次投影；真verifier通過，保留identity／相關UOM ownership，記歷史但不恢復Active／preferred／purchase eligibility | BLOCKED |
| GR-02 權威來源重送 | 首次真投影後同command重送／並行重送；同event同payload回原outcome，衝突拒絕；event／audit不重複，摘要正確 | BLOCKED |
| GR-03 reconciliation | GR已提交、首次projection失敗；SKU其後失去新採購資格，正式補寫仍只恢復缺漏歷史；重跑不重複effects，GR／Inventory正本不變 | BLOCKED |

GR-01／02／03 是[原結果報告](testing/09_tc004_tc005_reference_verification_20261014.md#blocking--excluded-branches)的執行別名，不是新增canonical TC。保留 TASK-043→TC-004／TC-005 traceability、所有既有required suites／門檻／failures／waiver；只在取得新baseline完整證據與應有決策後處置DEF-107及技術接受。正式UAT-005／UAT-013、provider UAT-017及business／release接受另行安排，不由此交接或技術PASS代簽。

本輪不執行DB／migrations／測試／UAT，不匯出新raw evidence，不修改產品、其他模組文件或既有pinned design／PLAN；此文件供接收方評估、排期與回覆解鎖證據。

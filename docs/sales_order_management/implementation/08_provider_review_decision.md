# 契約審查結果及一次性實作決策

## 審查結果

2026-10-02，獨立 reviewer Codex `/root/sales_readiness_review`（SEPARATE_AGENT、read-only）**APPROVE 作為 human/provider-owner 決策提案**：[完整方案](07_provider_contract_review.md)。確切 reviewed bytes SHA-256：`fa3352d7098e8551a27ea691c7d388321a1417088c8dc3b62753587044836a6e`。此結論不是產品實作或 provider 採納的核准。

歷史版本 `d23eb1eb23a36ff3181a4214b891418ec6cf25494bfbd02dfcc68233f450d498` 曾 CHANGES_REQUESTED。Release完整mapping／identity、replay在mutable eligibility之前分支、advisory credit currency三項已修正；中間版 `97982f49514c32d9a8288544e23b7b65da120c21fa8b765439688d37a621ff3f` 通過proposal review。最終版另納入Item writer維持mapping ID的必要相容slice，再獲上述APPROVE。沒有隱藏或清除先前問題。

Reviewer另要求實作測試覆蓋default-sale/default-purchase flag交換的unique-slot約束；保留mapping ID時不能造成中途unique conflict或多個default。Reference guards須有真實實作及並發證據，原critical-change reason檢查不足。此是實作驗證義務，不是額外產品能力。

已執行既有provider/guard單元測試93 PASS／0 FAIL／0 SKIP；白空間檢查PASS。結構檢查仍只有Inventory consumed-contract舊pin的CONTRACT_DRIFT；不以更新hash假裝owner採納。沒有新增產品程式、local SQL、formal TC/UAT或UI變更。

觀察基線：Sales `062c1880605a966086a0d8ec2702ff097027af58`；fresh main `29893c304eac11716b1758d9b5e25bd8f0080a7e`，providers相同。Inventory現設計SHA `6fc91e710adc48ec56fb567fa24b8b378741f0b48ffcb115d2a54c08927844ce`，Customer現設計SHA `ab567021254b09d5103caac5bba9b2e3324c0278e726d84999870abcdd7fe440`。Active Inventory P3 worktree有0064 Transfer migration及正在開發的測試；保留其0063–0066配額，未修改或訊息通知另一個chat。

## Decision Required — 採納契約及 TASK-009–011 實作 scope

Context：先前「繼續」只授權契約對齊與審查，此工作現已完成。要實作原剩餘三個Tasks，需要採納shared provider安全／交易／相容性契約。Sam為Sales manifest owner；任何需要的provider owner／lock-order review仍須實際記錄，不能以本文件替代。

建議選項A：採納完整方案並授權TASK-009–011按下列scope分slice實作，保留原Phase gate；先完成精確Item/FK鎖图review，再改shared source。這包含必要的Item writer相容修正，以及manual batch用fresh sales.mgmt（既有單行sales.operation不變），不是額外角色grant。

| Slice | 擬授權source／tests及文件 |
| --- | --- |
| Customer snapshot | CustomerLookupService及既有customerLookupService tests；Sales consumer與專用provider snapshot integration tests；Customer/Sales相關contract文件。 |
| Item Sales lookup | ItemLookupService及itemLookupService tests、itemLookup.integration；Sales consumer及Item/Sales相關contract文件。 |
| 必要Item writer相容 | ItemAdminService；itemUpdate/itemConcurrency integration及對應Sales-UOM compatibility tests；保留mapping IDs、default unique-slot及referenced conversion/removal保護。 |
| Inventory batch | InventoryReservationService、InventoryOperationService、inventoryValidation、inventoryConstants的最小所需改動；Inventory/Sales batch unit、operation/replay、real concurrency tests；Inventory/Sales契約文件。保留schema與8KiB generic summary上限。 |
| Sales DB foundation | 原兩個Sales sequence/operation migrations、Sales foundation migration integration／fakeSalesDatabase test support及Sales consumer contract tests。重用既有IdempotencyService；無具體失敗不改其source。後續Phase的document服務及recovery worker不提前實作。 |
| Harness維護 | 受影響modules的manifest/profile/traceability及canonical需求/設計/計畫/測試條文，真實review/state/report紀錄。不得提前把未實作provider pin標為IMPLEMENTED或把CI當正式驗收。 |

擬保留新Sales migration編號 **0068／0069**（sequence／operation）；這是本次待核准的**檔案配額提案**，不是已配置／已執行。當前main最高0063、Sales已有核准0067、Inventory0064–0066保留；寫檔前再次fresh fetch及核對active worktrees，若配額有新衝突停止該路徑並合併一次決策，不覆蓋其他module migration。此選項不授權local SQL execution；沿用repo既有ephemeral CI integration policy。

Trade-offs：新增provider方法、Item writer必要相容變更與operation記錄；reserve最多101 records/100 demand lines，release為1＋全部mapping數、分頁但同transaction。需要真MySQL證明並發、rollback、完整replay及大set資源；feature/UI/jobs仍依原Phase邊界啟用。好處是沿用現有data ownership及schema，避免錯誤單行loop、不必要的summary上限放寬及後續SKU價格更新被Sales FK凍結。

選項B：延後採納／實作，保留已完成的TASK-001–008基礎與PR174草稿。代價是完整PHASE-001仍無法exit或合併。

Recommendation：選A。Default action在實際答覆前是保留可審查結果，不改shared product code、不配置0068/0069、不做部分Phase merge。精確Item/FK鎖序、worker delegation及formal/Phase驗證仍依相應原gates處理，不能默認通過。

此確認依據 [software-engineering-harness SKILL.md](/Users/sam/.agents/skills/software-engineering-harness/SKILL.md)：「Major impact means ask a human before choosing.」及references/08-implement.md：「Do not silently change architecture, transaction semantics, security model, public interface, data ownership, acceptance criteria, or Phase boundaries.」本次涉及新增internal provider契約、manual batch權限選擇、UOM相容性及migration配額；與已核准的review scope不同。

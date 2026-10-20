# DEC-029 — P4 與正式 Fulfillment Archive 依賴的共同交付

狀態：具體提案，待人類決策；未套用新增產品／migration scope，未改舊批准雜湊，未宣告任何新測試 PASS。

## 已核實的現況

- P4 在專用 worktree `sales-p4-archive/erp-app`，HEAD `2a6a6441de89a4ca68c3df8a8eea57829531c1ed`，原 state revision1082；TASK-050～056 DONE，TASK-057 BLOCKED，058～063 依原 typed dependencies 等待。
- 已存在的 648 份活動證據引用全都有原檔。此提案不退休、刪除或改寫任何歷史證據、批准、失敗或 reviewer provenance。
- 實際遠端 main 已到 `64bee2e00dfae71131c7cfa54049cac0941d6f85`，包含正常合併的獨立死鎖修復 PR250。可見遠端分支／open PR 無正式 Fulfillment provider 實作。
- Fulfillment 原 state6 的完整45-task計劃尚未啟動；其「Sales／Inventory／Customer 完全不存在」等舊缺口紀錄已過期，不能照抄。Customer shipping 與 Item transaction-aware profile 已存在，Inventory 亦已有若干 Fulfillment 操作；完整 SalesFulfillmentService、設計具名 batch/reverse-original-reservation 等仍缺。因此本提案不承諾開啟完整出貨業務。
- Sales TASK057 需要正式 open-matter provider；058 依057。Fulfillment TASK041（P3-T08）又要求 Sales Archive framework；TASK042（P3-T09）要求 Sales Archive aggregate move。未拆清共同驗證順序，就形成實際交付循環。只補 Sales 接線、以表不存在回 CLOSED、或 fake participant 都不成立。
- Sales P4 的0088/0089 archive persistence 尚只在 P4 分支；Fulfillment 的12張 mirror 要 FK 至 sales_archive_batches，因此也不能直接把僅依 main 的 Fulfillment schema PR 先合併。

## 建議：在 P4 單一合併單位補入正式 Archive 前置切片

以現有 P4 隔離分支整合最新 main，保留 Sales 的模組所有權及全部原 P4 交付項。新增的 Fulfillment canonical tables、Open Matter service 與 Archive Participant 始終由 Fulfillment 擁有；Sales 只使用具名契約，不直接讀寫其業務 tables。Sam 以兩模組 owner 批准此次明列的 shared/provider contribution。這次貢獻由 Sales 的 IMPLEMENT execution unit 管理、獨立 owner/contract review 與 mandatory developer suites 核實；不把未執行的 Fulfillment 整個 P0～P3 或原45個 Task 標為 DONE，也不據此宣告 Fulfillment 全模組 READY_FOR_TESTING。

新工作以 Sales PHASE-005 的 dependency-delivery group（建議 TASK064～068，保留既有001～063身份）追溯；Fulfillment 原計劃明載提前交付的 subcapabilities 及日後真實 Shipment/Allocation writer 上線前必須重驗的 owner contract。兩模組 canonical DESIGN/PLAN/contract pins 依這次新決策建立新綁定；保留所有舊批准，不能把它們改成新 hash。

### 明確產品及資料範圍

1. 依 Fulfillment 已批准 Design §4.3～4.15／§4.17～4.18 建 canonical owner persistence：Fulfillment、Lines、Claims、Allocations、History、Shipment、Lines、Issue details、History、Reversals、Details、Audit 這12類 active rows，加 durable operations／必要 routing marker，及對應12張 archive mirrors。只新增實際必需的 sequence/guard structures；原 Export/UI/出貨 mutation 不在本切片。所有既有欄位、型別、數量及 snapshot 語意沿用 owner 規格；Archive 增量限既定 batch/time/row_hash metadata。用最新 migration inventory 分配 forward-only 序號，不重寫已套用 migration；先 Sales archive parents，再 Fulfillment children／mirrors，所有已設計 cross-module FK 必須真實存在，不能用無 FK 或 shadow schema 假裝完成。
2. `FulfillmentOpenMatterService.getOrderArchiveStatus(orderId,{atMs})` 讀真實 owner tables，回 `{status:CLOSED|OPEN|UNKNOWN,reasonCodes:[]}`。非 terminal 工作、active Claim、outstanding Allocation、IN_PROGRESS operation 一律 OPEN；缺 schema、錯版本、不可用或不一致一律 UNKNOWN。CLOSED 必須有完整已安裝 schema 與實際查詢證據，不能由空 registry／表不存在推論。新增明確的 transaction-aware sibling method 供 Sales 已鎖 root 後重驗，避免另開連線／read-view。
3. 正式 lifecycle assertion 接入既有 `fulfillmentOpenMatter` service name，Sales withdraw/cancel/closeRemaining 以同一 Sales→Fulfillment→Inventory lock order 檢查。已安裝／部分安裝不能再依 DEC021 未安裝例外釋放 Reservation。Schema先於application rollout、所有node實際註冊核對及 release-quiesce 為部署runbook條件；本批准不授權正式部署或操作正式DB。
4. `FulfillmentArchiveParticipant.archiveOrderInTransaction(tx,command)` 只供實際 Sales Archive coordinator identity 使用，要求 caller 既有 transaction、order、batch、cutoff、expected manifest／routing。Participant 不自行 BEGIN／COMMIT、不反向鎖 Sales；依 root ID 鎖 owner aggregates，重驗 terminal／Claims／Allocation／operations，保存原 active_shipment_id，按固定 table/column order copy、read-back count/hash 比對後才清 active pointer、更新 operation routing 及按 FK 次序刪 Active。相同 batch/hash 可恢復已確定的相同效果，不同 hash 回 ARCHIVE_DATA_CONFLICT 並保留 Active；任何失敗整筆 rollback。
5. Sales TASK057～063 完整交付：本地 eligibility、上述正式 providers、Sales/Fulfillment 同交易完整 manifest、immutable guards、scheduler/recovery、Archive-only bounded APIs/pages、reconciliation、容量與restore證據。Archive 入口與排程在真實 provider／schema／契約檢核未通過時維持 fail closed；不合併半套 P4、不減少本來的 full-Phase Gate。

### Scope 白名單（核准後才啟用）

- 保留原全部 Sales P4 已核准 source/test/migration paths。
- 加入此次 provider-only `server/src/modules/fulfillment/**` 的正式 OpenMatter、ArchiveParticipant、canonical table/hash/validation 支援檔；禁止在此 scope 偷加 Queue/Pick/Shipment create/confirm/reverse 業務入口。
- 加入 `server/src/services/fulfillmentArchive/**` 的正式 service discovery adapters；只為上述兩契約接線，不修改服務發現 framework、不公開 archive mutation HTTP。
- 加入上述 forward migrations、`server/test/fulfillmentArchive*.test.js`、`server/test/fulfillmentOpenMatter*.test.js`、對應具名 `server/test/integration/fulfillmentArchive*.integration.test.js`／`fulfillmentOpenMatter*.integration.test.js`／Sales consumer/transaction tests。
- 兩模組 canonical docs 的精確契約、scope、計劃／typed traceability、review/decision/binding 記錄。原 Fulfillment45個 Task、12個正式TC及120個UAT的完整義務與狀態不能被本次 dependency evidence 偷換。
- 僅新建自有0700 private runtime 及專用 MySQL26.7 synthetic schemas/socket/port 來驗 migration／rollback／concurrency／restore；先讀取確認舊 P4 resources 的真實 owner 與狀態，不 reset/reuse/drop 他人或不明資料，不擴大到正式DB，不輸出／commit raw logs、token、地址、credential或bank資料。

### 可執行順序與完成條件

| 新 dependency task | 完成條件 | 次序 |
| --- | --- | --- |
| TASK064 契約、scope、baseline與fresh-main整合 | 兩 owner 規格一致；新決策綁定；保留648舊refs；共同變更範圍與獨立review | 最先 |
| TASK065 正式 owner persistence | fresh/upgrade migrations、完整 FK/columns、12 mirrors、原ledger保留、真MySQL constraints | 064 |
| TASK066 Open Matter及lifecycle provider | 真實 CLOSED/OPEN/UNKNOWN、缺失及partial-install failclosed、bounded EXPLAIN、同交易鎖序／race | 065；Sales057在此後才能DONE |
| TASK067 正式 Archive Participant | 真實tx/unit/native copy/readback/hash/delete、immutable、same/different manifest、rollback/unknown outcome | 065/066；不宣稱完整 Fulfillment業務Phase完成 |
| TASK068 Sales/owner共同整合證據 | 與Sales058同一候選完成真實coordinator＋participant transaction/rollback/recovery；確證同connection/transaction、無其他aggregate受影響 | 057、067、058；063最終Gate必須依賴068 |

核准後的 typed dependency 必須保留原依賴並明列：Sales TASK057依TASK066；TASK058依TASK057及TASK067；TASK068依TASK058及TASK067；TASK063依TASK062及TASK068。因此不能在真實participant前把058標DONE，也不能在共同驗證前通過最終Gate。

Fulfillment canonical decision/state/trace明載這個具名subcapability是Sam授權Sales execution unit的shared contribution，原45個Task與原Phase門檻仍未完成。相關owner文件、契約pins與新決策綁定先於Sales最終source freeze完成並固定；不得為後補owner state/review重寫已跑evidence的fingerprint，不運行兩個互相改state而自我參照的當前source Gate。如freeze後必須再改owner文件，原來源驗證按真實新fingerprint重新執行，不能投影或偽造舊PASS。

TASK067的前置條件是已核准且有實際 caller/transaction fixture 驗證的 Sales coordinator ABI；不再循環要求 Sales058已宣告完成。TASK068則必須由真實兩方實作共同通過，不能用fixture/mock替代共同整合。這是本提案需要新決策的實質順序調整。

## 保持的驗證與交付標準

- 原 Sales P4 39 組 developer contracts、原 coverage/per-file/memory/latency/restore門檻、原正式60個TC/UAT義務與完整Phase Gate不降低；新增的 owner persistence/provider/consumer suites 作為額外 mandatory Gate，有正數最低案例數、禁止 skip，先 RED 再 GREEN，獨立 reviewer 真正存在。
- 原 P4 7.3M Active headers、25M External Keys、300k monthly candidates、50 foreground users、原容量／RTO/RPO要求保持，不能從較小樣本推斷通過。
- 上游 PR254 已明列 Sam 另行核准的 developer/CI 1/5 business benchmark；本次正常 CI 隨最新 main，但該2,000單/10人/10MiB結果不替代原 P4 大容量或正式10,000單/50人/50MiB驗收。歷史全量證據保留，不改成較小負載的證據。
- 本機 Node/MySQL tests 低優先級、順序執行，client最多2 workers、Playwright1 worker，保留完整正常CI／精確候選／獨立整階段review／fresh-main／未修改標準MERGE_READY。已核准 commit/push/PR/main merge 不重問。
- 單一 joint P4 PR 在全部原 P4 Gate及新增provider suites通過後才合併。若新資料語意、現有provider契約或DDL與這個已批准設計真正衝突，先回報具體差異，不能默認擴大本決策。

## 真實替代與取捨

建議選項：批准上述窄化正式依賴切片及交付順序。收益是解除兩模組的交付循環，不需為 Sales Archive 順帶開整個 Fulfillment UI/出貨流程；代價是此PR增加正式Fulfillment資料層／migrations／兩個provider、相應測試與owner review，以及部署時必須協調schema/provider切換。

另一選項：維持原 Phase 邊界，等待完整 Fulfillment P0～P3及缺少的上游交易契約完成；Sales保留已做功能及原證據，TASK057～063維持BLOCKED，不合併半套P4。收益是不用提前交付owner persistence；代價是不能靠只修改Sales解除目前阻塞。

若沒有新限制，建議採納前置切片；人類尚未答覆前只做原 Sales 範圍內 eligibility／UNKNOWN failclosed 的可審查實作與測試，不套用新的跨模組產品／schema scope。

## 為何需要這次決策

這次不是再次詢問P4開發或merge授權，而是提前交付另一個資料owner的正式persistence/providers，並改變已批准的跨模組任務先後及共同合併單位。已讀 software-engineering-harness/SKILL.md要求 major scope/architecture/data semantics先由人類決定；references/08-implement.md明定「Do not silently change ... Phase boundaries」，references/19-state-and-recovery.md要求「Do not rewrite an old approval's hash ... Obtain a new decision」。本提案保留那些邊界與全部歷史；核准後建立新綁定，並非修改已安裝的Harness或降低Gate。

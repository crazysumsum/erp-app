# TASK-034：最小功能驗證提案（尚未准許執行）

2026-11-04。依 TL 指令，以 `ca8f973fe6ea5821c458521ebaac48858abb2c77`、[Doc97](97_task034_main_integration_boundary.md) 為本地覆核起點。只交提案，不寫 runner／案例碼、不新增 CI、不跑 DB／測試、不推送。TL 觀察到的 main `3a778e4b` 是後續 Customer／Purchasing 整合，並非本候選、TASK-034 Gate 或部署批准；執行前仍須固定實際候選與依賴影響。

目標是補不同的 guard／crash 風險，不重跑已知正向、audit rollback、pending replay 或固定競爭來湊數。下列 proposed ID 只屬本提案，初始狀態均 **NOT RUN**；不冒充既有 TC-001／TC-008 的正式 PASS、不改 traceability/state 或舊證據。

## 既有證據及批准可沿用甚麼

Doc93／94／96 在保留分支 `codex/fulfillment-p3-reversal-release` 的 `f47029fe8a25b75b4d2ab1ab4e502d3b9c79fc46`；它們連結的原 runner及收據各保留原件，不複製成今日候選結果。

| 已有來源及真 runner | 當時 source／執行版本／實際內容 | 可沿用及不可外推 |
| --- | --- | --- |
| Doc93；runtime `task034-phase-a-r2-20261104/phase-a.private.mjs` SHA `cd6d4de87bfadccb7f5fe8368423f1181465a2f48aa77b2d2d43d027aabdabd1` | 產品 `1cdd41f0`，執行 HEAD `1edb06df`；exact2：normal commit、末筆 REVERSE audit 注入錯誤後 rollback，各1次 start。各獨立1SO／1SKU／1行5件／pick3／short2 | 原真提交／25表 rollback、Sales6＋Inventory7零反向效果證據保留。正常返回及 JS錯誤後 rollback **不是 process crash**；不新增重複正向／audit fault |
| Doc94；`task034-pending-replay-20261104/replay.private.mjs` SHA `f15a20f90d8eeac661881785a1c11da08d4fe1f9a3001132a99e1aa5eef94c35` | 同 `1cdd41f0`，執行 `efb258e1`；exact1流程：首次、同event完全相同、只改reason，共3次串行 start | 原ID／number／correlation／版本重送及不同reason拒絕有證據；不新增同事件／不同reason案例。不是撤權、stale CAS或跨程序 crash |
| Doc96；`task034-different-event-race-proposal-20261104/private/race.private.mjs` SHA `ccc290f7892a1d4fc41bcb8af88bc896dfac183eb7fc49ce4e1e52a71fc136c7` | 同 `1cdd41f0`，執行 `ce2132a3`；exact1固定交錯，一張S1／同actor／同原version／兩不同event，各start1，真PFS等待後A成功B409 | 只沿用該交錯服務層唯一性；B走 state-before-CAS，**不是仍有效 SHIPPED 上的 stale CAS**；不加第二個競爭排程 |
| 原 pure probe及原 DB unique/migration 回歸 | strict輸入／reason／兩確認／未知registry拒絕，以及generic operation唯一鍵，依原收據所列範圍 | 不再新增同義 pure／DB unique 案。generic ALLOCATE replay不能當 `startReversal` 新分支已覆蓋；不刪任何原測試 |

上述三檔產品的原 fingerprint是 `5677fe2b2a90c0f0290551f6e0b67c5275159c045a3c62e204b5020a3f5915af`。今日 Reversal service已增加 trusted started、terminal／readonly prepare，runtime及owners亦有增量；Doc97還指出 fixture cache差異。舊runner是 historical evidence，不能換 import 到新tree後仍標「沿用舊PASS」，亦不能借舊 once journal 再執行。

| 實際授權原件 | 已核的範圍；這次如何處理 |
| --- | --- |
| r2 `actual-techlead-execution-grant.json`，Lead item `exec-bb1b0e61-5161-4674-894f-22b71d95c974` | 只補正式0099及兩個原路徑，固定稿／新once／PM時段；已使用，不含今日5案或routine CI |
| replay `actual-techlead-execution-grant.json`，Lead items `exec-305a636c-d375-45dc-b433-8728ed0e07d3`、`exec-a100e0b5-f258-43da-a5c1-04c894700da6` | 一個串行3-start流程及pinned fixture處置；已使用，不是standing runtime grant |
| race `private/actual-sam-execution-decision.json`，PM chat Sam user item `01a1a4aa-c1ff-7203-abee-9cf21725c763`、reply `call_3d402a33596d4092aa63ebb0173e0f3c` | Sam明確批准本機1個固定競爭案例一次、不重試／不跑CI；已執行完，不能轉授其他風險或新候選 |
| PM今日工作及TL技術授權 | 是工作／提案權限，不等於新 routine CI准入；Lead舊技術決定不改寫成Sam批准文字 |

由 PM 單一窗口核對原決定、實際候選／runner blobs及本提案。現無匹配本稿的開跑決定或CI receipt，不執行；若需新Sam決定，由PM整合申請，不由 feature agent 自批receipt或改admission變數。

## 擬補：5個私有 functional 情境，各只執行一次

共同資料：每案一個全新隔離schema，最多1SO／1SKU／1行／原5件／pick3／short2、1Reservation、1Allocation／Balance、1Shipment。用既有真 Draft→Allocate→Pick→Confirm建SHIPPED v3；正式0088、0097、0099及12個archive mirrors／triggers先由正式inspector核實。普通actor及當前view／operation／reverse來自真DB。合成no-provider聲明**僅限fixture**，不冒稱Returns／AR已採用。

Priority均P1（授權／交易完整性）；需求追溯為TASK-034 acceptance及共通DoD、既有TC-001／TC-008家族；不是新增正式TC PASS。測試入口為真正 `ShipmentReversalService.startReversal`，不替換其actor、SQL結果、receipt或回傳結果。

| ID／確切擬用名稱 | 風險、前置與最小差異／步驟 | 期望及必收證據 | 次數／狀態 |
| --- | --- | --- | --- |
| T034-F01 — `TASK034 revoked reverse permission rejects a still-valid claimed actor` | 初態SHIPPED、input合法；只移除synthetic role的reverse permission binding，保留原claims。以該actor呼叫一次，不能換成一開始就無權的claims | fresh DB權限對帳回typed `PERMISSION_STALE`／403；無E_R意圖／狀態變更，Sales／Inventory不變。auth seed改動在業務baseline前分列；序號檢查亦記實值，不以任何403充數 | start1；NOT RUN |
| T034-F02 — `TASK034 stale version rejects an otherwise eligible shipped shipment` | 新SHIPPED v3、正確來源／archive空／有權；唯一差異input.version=2，兩確認和reason均合法，新event | `VERSION_CONFLICT`／409，必須實際仍SHIPPED而非已REVERSING；domain rollback、25表對照無本event效果。序號獨立提交的合法gap另列 | start1；NOT RUN |
| T034-F03 — `TASK034 archived shipment mirror blocks a new reversal intent` | 新SHIPPED、正確version；只為archive guard準備正式0088 batch＋0099的該S1完整mirror row（真columns、合法row_hash、append-only約束），不執行archive job、不搬熱表。保留同S1 hot row供真guard辨識 | `FULFILLMENT_SOURCE_CONFLICT`／409，因該Shipment mirror命中而非缺表／錯version；25表、mirror／batch及owner事實在assertion前後不變。此案證mirror-presence拒絕，不證整個Archive workflow或另一根mirror分支的動態路徑 | start1；NOT RUN |
| T034-F04 — `TASK034 reversed shipment status rejects a new reversal event` | 用真Phase A setup start一次得到REVERSING；在隔離fixture按0096合法status transition及version CAS只建立REVERSED header作status guard負向初態，然後以目前version／新event呼叫一次。**不偽造Inventory／Sales receipt或SUCCEEDED operation** | `SHIPMENT_ALREADY_REVERSED`／409，assertion後完整業務baseline不變。明列這是schema約束但刻意未形成完整一致REVERSED aggregate的header guard fixture，不是已完成真Phase B的正向初態；舊pending／未回補owner數量分列，不拿它證整張回補成功或effective-reversal另一分支 | setup start1＋assert start1；NOT RUN |
| T034-F05 — `TASK034 process crash after committed Phase A preserves the original pending intent` | **commit後、回傳前**：child用真服務start一次；透明recorder forward原callback／options／結果，確認真正domain executor `getTransactionOutcome(tx)=COMMITTED`，在withTransaction已提交、結果尚未交回start caller的邊界只送一次IPC barrier。parent保存證據後對該owned child一次SIGKILL，等待OS exit。parent以新service實例／相同actor與原command start一次查原pending | 獨立raw連線見原E_R operation／Reversal／history／audit恰一套、SHIPPED→REVERSING只一次；新實例回原IDs／number／correlation／版本，沒有新domain寫入、Inventory／Sales不變。保存childPID/exit signal、真executor commit證據、原command hash、前後25表及sequence。新物件不成genuine started，無Phase B／接管。**不證commit前crash rollback或native COMMIT ACK遺失／INDETERMINATE**；這是DB已ACK commit後的application-return窗，亦不把正常shutdown或audit exception當SIGKILL | child start1＋parent replay1；NOT RUN |

F03／F04明示guard fixture邊界，避免為測一個早期拒絕而先實作不存在的Archive／Phase B writer。若TL／獨立review認定此種precondition不足以關對應acceptance，該項保留缺口，不以假完成替代；不得把guard fixture稱實際已歸檔／已回補的全流程驗收。

5案串行，最多5資料集、7次Reversal start（含F04 setup、F05原事件replay），不加競爭／samples／重跑。F01～04每案沿原pool2，另分列admin／observer；F05 parent pool2＋child pool2＋admin1＋獨立observer1，最多6個實體連線，一次只有一筆Phase A業務嘗試，不是並發負載。現有fixture交易10秒、query/acquire各5秒、產品20秒及lease設定不變；180秒case/process安全上限只防runner掛住，不是效能門檻。IPC/exit事件驅動，不固定sleep、不無限poll；任何非預期失敗／基礎設施逾時立即停批、只安全清理、不自動重跑。

所有案以原12本地＋Sales6＋Inventory7的25表完整row sets作差異證據；auth／archive seed baseline、獨立sequence、schema清理分開記錄。每個case的完整前置、input、真錯誤cause分類、executor結果、JUnit exact數、原始失敗、清理及獨立結果覆核均保留。F05的SIGKILL是預期故障，不是capacity/performance失敗。這份提案沒有創建上述runner、child或測試檔。

## 私有執行與 routine CI 的分界及成本

**建議A：先批本機5案一次，routine新增0。** 先取得不同風險的功能證據，required providers／部署另待就緒；不把本機PASS自動當當前候選CI或034 DONE。PM核准實際範圍、固定稿／依賴及獨佔DB時段，獨立review具體runner後才可執行；本輪仍只提案。估計含準備／schema inspectors／child／清理 **3–8分鐘**，未量測；沒有跑未批工作來估時。舊r2整案1.83／2.32秒、replay1.69秒只屬舊腳本／版本，不能當新5案或coverage的預測。

若希望同一輪順便決定日後routine准入，可選 **B：同一5案另外准入routine functional CI**，內容完全如下，不隱含新增case：

| 項目 | B的精確擬批准範圍（目前未批准／未建立） |
| --- | --- |
| literal案例 | 上表F01～F05的5個確切名稱；每run各1次，最多5fixtures／7start；同資料、前置、錯誤及差異斷言、故障位置與20秒等限制，不加暖機／sampling／scale |
| 擬檔案／helper | 一個新 `server/test/fulfillment/fulfillmentReversalPhaseA.integration.test.js`（5個literal node:test，serial），一個非discovery child `server/test-support/fulfillmentReversalPhaseACrashChild.mjs`，一個限本5案的 `server/test-support/fulfillmentReversalPhaseAFixture.js`。三檔完整blob須實作後獨立覆核並綁receipt；不改既有案例或共用fixture內容／資料量。若無法只靠本範圍完成，停在提案，不擴helper scope |
| runner／trigger | 沿現有8個server shards、native coverage與serial test concurrency；無新job／step／matrix／額外dispatch／路由或頻率。現有controller准入的每個PR、main push及既有週一schedule，若執行server functional discovery即帶此檔；沒有新增schedule。單檔5案可能同落一個shard，不聲稱平均分成八份 |
| thresholds | 精確授權／409 code／本地及兩owner全集／原事件重送／真SIGKILL結果；0FAIL／0SKIP，原coverage全域lines92%／branches83%／functions90%及全部per-file floors保持。不加P95／吞吐或容量案例 |
| 時間／runner成本估算 | coverage runner新增工作估計 **60–180秒／run**（約1–3 runner-minutes），不是實測或上限；child／schema費用未知。新增檔會改變既有shard分配，最慢shard／整輪增量可能高於新增檔時間；沒有承諾整輪只加3分鐘。既有8shards不增加，但每次PR/main/schedule累積成本增加 |
| 安全及准入 | **B必須Sam實際明確批准**，由PM單一窗口核原批准與scope，實作後綁所有case/child/helper/unchanged inputs的exact mode/blob，trusted administrator才能發布digest；feature agent不自批receipt、不改workflow/admission variables、不繞controller |
| 替代／取捨 | A保留所有原測試，以一次私有證據先解不同風險，無新增routine成本；B有持續回歸但每輪有成本，且不能解除required-provider／deployment Gate。只用舊證據成本最低但不足以證這5個差異。建議先A，若PM判定持續coverage／回歸必須B，可把同一範圍一次向Sam提出，不能默認A包括B |

日後若將私有案例搬進CI，即使不改workflow也屬新准入；本稿不是receipt。依[准入流程](../../ci-test-admission.md)保存Sam真決定及exact workload／file versions，沒有匹配批准不得建立discoverable case。fixture／child若更動data、重複次數、並行或failure位置，重審影響而不借舊批准。

## 當前候選既定 Gate：與新增5案分列

- 執行前固定actual source/tree、正式schema及依賴；如要整合最新main，在隔離候選做影響核對，舊結果只保留原版本，不重標新head PASS。source-only ca8／Doc99及TL來源驗收不等於動態功能結果。
- 保留既有affected functional regression、全repo lint、既有build／security checks、原native coverage及per-file floors、當前候選admitted functional CI和實際獨立review。不直接跑可能帶capacity的未過濾 `npm run verify`／全glob來替代現有catalog routing；既有8shard functional CI沿原controller及capacity exclusions，沒有post-UAT dispatch或NFR。
- 上述既定Gate的候選／受影響paths／批准runner在實作與最新main整合後核實，現未跑、沒有可信新計數／runtime／runner成本。A新增routine0；即使5案全部PASS，不能省既定CI、覆蓋率或required-provider項。

## required-provider 尚不能驗收的項目及交接

TL已交固定設計 `6cc959d1`：`.worktrees/b2c-finance-design-plan/tasks/shipment-reversal-downstream-contract.md`。Returns／AR各提供同caller交易的 `getShipmentReversalStatusInTransaction(tx,{shipmentId})`，所有影響S1的writers共用Fulfillment根→Shipment排他鎖；不全503、已知BLOCKED409、兩方CLEAR才可繼續。實收1件擋整張回補；合併發票須按S1來源有效貸項。這是設計，不是provider／部署／測試批准。

正式transaction-aware providers、所有相關writers／FK提早鎖影響、熱／archive完整來源、同S1競爭行為、實際部署版本及具名維護人仍須TL／owner／PM交付，不能由本5案fixture合成no-provider或stub CLOSED代替。這些項目在034 readiness保持BLOCKED／NOT VERIFIED；不放入本提案5案偽裝可測。Phase B writer／genuine preclaim／Sales intent／executor與fence捕獲須待034與必要下游真Gate就緒，不為解除循環提前實作。

本提案完成條件是原證據與准入比對、5個可區分風險的NOT RUN情境、成本／替代及所需決定清楚，經獨立review交PM／TL。它不關閉TASK-034，不新增或執行任何NFR、公開route、Phase B或Recovery，也不改任何原測試／斷言／限制。

# P4 native migration and Archive export completion — developer result

Status: scoped developer verification completed; full Phase verification remains in progress. This is neither formal Technical Acceptance nor UAT/release approval.

## 固定交付阻塞表（持續更新，2026-10-30）

下一個交付：保留DEC046兩項修復與成功證據，準備本地可審閱候選／Draft PR內容；依Sam新規則，任何效能容量及會自動觸發它的CI，先按下列DEC047清單取得明確批准。Outstanding200樣本已在通知前完成PASS；新的lint及26項P4 Playwright亦PASS。新候選完整coverage已安全中止，原runner FAIL保留並分類USER_POLICY_INTERRUPTION，不是SLO失敗／不是PASS；owned輔助MySQL正常STOPPED、主DB零交易、無本chat負載在跑。兩個缺陷已獨立結案，原44項具名處置／三組效能PASS與舊FAIL完整保留。未取得新批次批准前不push／開PR觸發CI；未通過全部剩餘Gate前不合main。

| 具體阻塞／證據 | 最小處置 | 完成條件 | 責任人 | 需要 Sam 決定？ |
| --- | --- | --- | --- | --- |
| DEF043 coverage discovery／namespace／guard 已限定結案：同一524真實 test files、24 helper 不獨立執行；owned R2 TCP/socket/UUID、JWT、低 CPU 接線已核對。DEF045 舊 owner fixture 亦結案；實際20+87+22+10=139 native PASS/0 FAIL/0 SKIP，原始 source9fa3 保留；唯一後續 package glob 差異由獨立整倉 fingerprint bridge 核實。closing f356131b… | 保留既有修正及證據，不重做已完成的限定修復。 | 已達成；完整 coverage 仍須實際通過，不能以139案例代替。 | Sales agent | 否 |
| DEF044 TC060 同步已限定結案：普通／instrumented 原失敗 case 各1 PASS；原完整 CSV native88 PASS/0 FAIL/0 SKIP。實際 registered worker 保留2秒冷卻／5秒期限及業務斷言，僅關閉該測試的自動 calendar，人工 runCount/overlap/timeout皆驗證。review299d6cf7… | 沿用已完成修正，不再重跑同一診斷。 | 已達成；仍由完整 coverage 與原 native Gate 覆蓋。 | Sales agent | 否 |
| R10完整server coverage已PASS：4,546 tests＝4,339 PASS／0 FAIL／207原conditional skip；行95.78%、分支87.86%、函式94.78%，39檔per-file floors全過，原run20261029T075102-dbb22be03fa8。 | 保留真LCOV／checker／raw、原Source ed279／PLAN eea0bb／時間；不改標整合後Source e205。 | 測試執行已達標；104個Supplier純文件造成的metadata接入一併由DEC045明列處置。 | Sales agent | DEC045 A已批准並完成具名接入；若DEC046改產品，必須實跑新候選完整coverage。 |
| DEC045：獨立逐項核對32組無影響成功、3組真補驗及上述真fullcoverage；102原artifacts／35命令hash／8檔beforeimage與104純Supplier文件差異已核實，但installed genericGate只接全倉FP／PLAN完全相同run，無attestation入口。 | [一次具體政策提案](/Users/sam/.codex/worktrees/sales-p4-archive/phase4-private/dec045-evidence-intake-r1/decision.md)：A具名人工metadata處置、保留generic真阻塞及所有其他Gate；B堅持generic字面PASS、整套48重跑。無新通用工具／舊報告改標。 | 實際Sam選擇後按該邊界完成；proposal a3c27268、獨立最終覆核579413c1。已由Sam直接批准A；僅適用具名範圍，其餘Gate全保留。 | Sam決策；Sales執行 | 已批准A；不重問既有selective／commit／PR／merge授權。 |
| 最後容量組真FAIL：shape1m／5m／300k PASS；Active矩陣第803req503，rootlog證明snapshotAge302s→正式revocation closed300s，容量harness誤停30s安全refresh。另Outstanding62／62成功皆>2s，partialP953445ms，完整首100的P95下界3400.510ms；原COUNT/page各materialize約5m明細。 | 已停止修復／重試／後續負載。只讀既有logs／PFS及normal EXPLAIN，備妥保留真正安全refresh＋同WHERE bounded scalar lookup的兩檔proposal；未套用、未宣稱加速。具體[DEC046提案](/Users/sam/.codex/worktrees/sales-p4-archive/phase4-private/capacity-active-failure-r1/decision.md) d1999025…／patch8f7bad09…，獨立覆核7d746b82…零待修正。 | 先Sam按原效能失敗停令授權；小型真等價／實際讀量／完整HTTP成本達標後才重跑原最後完整容量，2s及其他原門檻不變。 | Sam決策；Sales執行 | DEC046已直接批准；不再重問一般開發或merge授權。 |
| TC032、TC042／匯入及25m索引原三組已PASS；最後mixed／300k Archive／Archive query三案因前案halt未開始。CI／TaskDoD／最終整階段review仍未過。原run20261029T090204-75866e28d87a＝1PASS／4FAIL原樣保留，只有Active是真量測失敗。 | 保留三組PASS與44項具名來源、原fail/raw；不重建有效1m／5m／25m資料，不改來源／PLAN標籤。 | 實際修復及所有剩餘Gate通過才直接merge；任一新容量／效能FAIL或timeout再次停Sam。 | Sales agent | 既有commit／PR／merge授權保留；效能修復依DEC046集中處置。 |

## DEC-047 — 效能／容量事前批准清單（2026-10-30 香港時間）

依Sam在project manager chat的直接新指示，以下尚未執行或須重新執行的負載，必須先由Sam選定批次及規模；DEC046不視為未來負載的自動批准。沒有答覆時維持停測。普通非負載審查、文件、本地commit及Draft PR內容準備可繼續。建立PR會觸發下列CI，因此批准相關負載前不push／開PR，不刪減CI。

### 已完成、保留，不因本次停測重跑

- Outstanding原資料100萬張／500萬行，兩個各100樣本HTTP窗口已在新通知前完成：全部200，P95 1582.867／1855.748ms，原2秒通過，原EXISTS對帳相符；原始3733ms單次峰值照留。COUNT實際每次130萬rows examined；兩方向頁查詢40／300091。這不是完整13類矩陣通過。
- 90項功能／安全單元、35項完整P4原生回歸及兩次真30秒安全refresh已通過，兩項缺陷獨立結案；新的lint及26項真Playwright亦PASS。原44項具名非效能證據、三組原效能2／4／4及獨立2500萬筆索引均保留原來源／時間／hash；不重建100萬／500萬／2500萬資料。
- 新候選完整coverage在新規則送達前已開始，之後安全暫停案例派發，當前child已結束；只對owned測試群組SIGTERM，owned MySQL正常關閉、lease釋放。原runner FAIL輸出原樣保留，分類USER_POLICY_INTERRUPTION；未完成、不作PASS，也不是SLO失敗。舊完整coverage4339PASS／39floors仍僅是舊候選證據。

### 尚待選定的一份清單

| 項目／業務目的 | 現有及新增規模／並發／輪次 | 原門檻／正確性 | 耗時及資源（估算明列） |
| --- | --- | --- | --- |
| C：新候選完整coverage，確認全部功能與高風險程式覆蓋 | 原524檔；owned輔助DB。含一個25萬訂單／25萬明細fixture、兩次25萬列CSV匯出；5005張／行keyset、16原排序加2個Outstanding方向；501張Archive／FIFO及1000／500個有界鎖定fixtures。並非只跑小單元，故一併待批。TC032／TC035／TC042專項沿原分離旗標留給CI，不刪案例。 | global92／83／90及39個file floors；原案例與原conditional skip理由不變；兩個25萬匯出各<30秒，原worker／transaction期限不變。 | 舊整倉實測約25分鐘；新候選估25–40分鐘，既有3600秒執行預算保留。單Node worker、nice10、輔助MySQL併發2／buffer256MiB；峰值Node記憶體未知。 |
| A1：完整Active常用查詢，驗證大資料下正確count／排序／分頁與互動延遲 | 重用100萬Active-store訂單／500萬明細；13類×100樣本×2階段＝2600次HTTP，交替排序、50個帳戶輪用，非50個同時查詢；獨立oracle在計時後；不再另跑剛完成的200樣本probe。 | 每類每階段P95≤2秒；count／ID／欄位一致，零被排除失敗；不宣稱冷cache。 | 原完整成功耗時未知；依Outstanding200次315秒及其餘未知查詢估10–30分鐘，非保證。主DBbuffer1.125GiB／併發2，單SQL測試工作。 |
| A2：真50人混合流程，驗證匯入／匯出／背景工作不拖垮前景交易 | 原100萬／500萬基底；50JWT、60秒ramp＋15分鐘steady＋最多5分鐘drain、10秒think；比例list40%／detail30%／Archive10%／confirm20%。另真匯入1萬張／5萬行（CSV≤50MiB）、5個匯出job（每個45000–250000列）、precheck與processing各一次50人確認burst（45×1行＋5×100行）。先搬500張再以500張真Draft按原line_count補位；mixed再搬500張。互動新增訂單／明細依實際吞吐量變動並完整記錄，不冒稱固定總量。 | list／detail P95≤2秒、Archive讀取及確認P95≤3秒；匯入1萬成功／零失敗且≤30分鐘；兩個burst各50人完整入樣；五匯出完整、worker零失敗／timeout、對帳一致。 | 負載窗口至少16分鐘，最多21分鐘，另加setup、首批搬移與對帳；整段估25–45分鐘，實際未知。真安全refresh始終30秒；Import／Export／Backorder／Recovery／metrics依原配置啟用，Archive每次500／600秒。量測process peak及pool queue；沒有新造整機記憶體門檻。 |
| A3：月度30萬Archive完整排空及歷史查詢，驗證長批次完整性、前景不阻塞與replay | 原30萬eligible candidates，18類Sales／Fulfillment資料；500／次，至少600次invocation（含前兩次），剩餘298000於同batch續跑。10個前景reader、10秒think。全量counts／amount／canonical hash／30萬manifest與Inventory不變對帳；完成後3類Archive查詢×100×2＝600次HTTP及非法範圍負例。新增Archive mirrors取代已搬Active；不另建全歷史或2500萬張訂單。 | 每次≤600秒，零漏／重複／失敗／skip，Active前景P95≤2秒；Archive精確≤3秒／Customer或366日範圍≤5秒；同batch replay不變。原整組21600秒預算保留，超時即停，不自行延長。 | 舊500張34.63秒的單次結果線性外推約5.77小時，尚未包含新資料形狀、雜湊及其他階段；不是目前完整實測或完成承諾，可能超出整組6小時預算。600次採加速呼叫，不冒稱正式15分鐘cadence的150小時日曆已驗證。 |
| O：TASK062營運表／backlog實際用量 | 僅讀既有兩張operational表rows／bytes、FIFO scope、contributing instances及backlog；完整容量前後記錄。無新增業務fixture、無24小時等待／偽造歷史。 | 數值來源／估算性質分明；未覆蓋的24h歷史仍UNKNOWN；不自行開production activation。 | 只讀metadata及有界彙總，估數分鐘，實際未知；不作額外benchmark或擴量。 |
| I：當前候選CI，含隱含的效能負載，必要時才可push／開Draft PR觸發 | 四個server coverage shards各自DB，合併原floors；上述C內25萬匯出／5005keyset／501及1000／500 fixtures亦執行。Shard1另跑TC032兩情境，各50人×3輪＝150確認（135×1行＋15×100行；一情境另5warmups）；TC035兩個50MiB／10萬CSV列（1000及10000 source-orders）worker案例。獨立TC042：2000張／10000行HTTP CSV＋10前景人、10秒think、precheck／processing各≥50樣本；另1MiB／10MiB非連續grouping。其他Item／Customer／Inventory大型release opt-in與DR未啟用。 | TC032僅原兩例P95≤10秒；TC035兩個worker各<30秒；TC042匯入≤30分鐘／前景P95≤3秒，10MiB grouping原heap／external／RSS增量≤16／32／64MiB；coverage與所有必要CI不刪減。 | GitHub遠端估15–40分鐘，排隊／原生負載／資源峰值未知；不使用本機CPU，但會消耗原有Actions資源。新候選原一次CI必須實跑，不能用舊head綠燈替代。 |

本機共同限制：只跑一組SQL／browser／build負載，nice10、UV_THREADPOOL_SIZE=2、GOMAXPROCS=2、InnoDB concurrency2；這是單worker／有界併發，不保證固定CPU百分比。主buffer1.125GiB，coverage輔助buffer256MiB；Node峰值須實際記錄，目前未知。2026-10-30停止後磁碟可用526.71GiB；既有admission的追加logs32GiB＋temp32GiB＋files8GiB共72GiB為保守預留，非聲稱實耗；保留105GiB入場／100GiB硬reserve。現成資料不重建，seed專用binlog例外不延伸至量測，正式global／session binlog及durability維持1，不PURGE／RESET／TRUNCATE，不做DR。上述耗時不能簡單相加成保證完成時間；原完整容量6小時預算有真實超時風險。

### 建議及較小方案的取捨

建議先批准C＋I（完整coverage與當前CI，含明列的有界容量案例），及O的既有資料只讀用量；先交可審閱Draft PR，A1～A3維持待批。這不降低或豁免完整容量Gate，仍不能合main。若接受可能約6小時以上且整組有超時風險，可一次批准C／I／O及原A1～A3，依序執行，任何效能FAIL／timeout即停Sam。

較小容量方案可保留現有100萬／500萬資料與原2／3／5秒門檻、50人／1萬匯入／5匯出，只先做A1＋A2及首兩批共1000張Archive，停止後續298000排空；能覆蓋大表查詢與前景／背景互動，不能證明30萬長批次、全量hash／manifest及完成後Archive矩陣。此方案亦須Sam明確選擇，局部／未測不冒充完整Gate，不能據此合併。其他自訂較小規模先由Sam指定，再核對受影響驗證契約，不自動改數字或門檻。

同一明列批准批次內不逐條重問；新增／改變負載、資料量、樣本或實際效能FAIL／timeout，先停下解釋再由Sam決定。既有一般開發／commit／審查及全部Gate通過後直接合main授權保留。

## Candidate and authority

Current HEAD `b720617e87924fc255dcf0130cf5e91fff3131da` integrates fresh main `4f101642a284c44d6dd53338ddfeb431582aa5f4`. The six-file target delta affects Supplier only; all 3,272 immediately captured owned file hashes survived integration. Source fingerprint after the functional changes is `3677fbb205ad6b79015b830e5ce704fbe2fc309cfc283bea0654db368cb2a700`; DESIGN `1fb4cad885249fc86e8a0ae4ecb991c14aa3770ad44a6d46754236dce50ada36`, PLAN `656a613193abd9d2a92f8aac779d4a25ffdfcba6f910fd4ea3f83358e8e97be4`.

Sam's DEC-043 and DEC-044 approvals and standing implementation/commit/PR/main-merge authority apply. The original proposals, approval hashes and failures remain intact. Forwarding the existing isolated Fulfillment activation variable into the original 48 command contracts is a mechanical environment repair: no fixed value, production default, command, assertion, load, minimum count or threshold changed. Four derived PLAN/SCOPE/same-reason N/A bindings were appended with their true authority; no new human answer or later manual hash inspection is claimed.

## Observed fixes and evidence

- New migration 0109 uses MySQL's canonical parentheses for the same eleven CHECK expressions. Historical inspectors 0070/0083 remain untouched. A real native regrouping-drift test rejects a changed boolean grouping and validates restoration.
- Sales metrics now yields one microtask before authenticating the exact live Scheduler signal, matching actual instance-job admission. The reproducer changed from 4 PASS/1 FAIL to 5 PASS/0 FAIL; actual registered native metrics paths passed.
- Nine focused native cases passed together with zero failures/skips. They cover index/session/drift/unknown-DDL acknowledgement handling, original order predicates, cancellation replay, reconciliation, actual Archive, durable Backorder START/terminal facts, guarded activation, Inventory owner snapshots, 501-scope pagination and honest engine availability.
- Normal migration CLI applied only 0108/0109 to the owned initialized source schema. Its 2,045,000 Backorder entries retained COUNT/MIN/MAX; these markers are not a full row hash. The new index occupies 3,110 InnoDB pages, 50,954,240 bytes (about 48.6 MiB). Six EXPLAIN plans use the new order index with estimates at most 100 rows; estimates are not measured row counts. Migration/inspection completed in 1.724 seconds, not a full capacity-SLO result. Stale information_schema table-length values are retained in raw evidence and are not used for the index size claim.
- The legacy native base schema was also brought to 0109. Pool-wait tests retain old local/CI protections and add only the exact approved current schema/socket/server-UUID tuple.
- Independent whole-phase static review found DEF-040: Archive export could expose supported partial mirrors before the durable completion manifest. A native test reproduced one exported row where zero was required. ARCHIVE export now applies the same matching order-ID/batch-ID manifest condition as Inquiry; Active export, parameters, sorting, keyset and row caps remain unchanged.
- The replacement TC-050 fixture uses real create/cancel services under an explicitly historical fixture clock, correct canonical hashes and retained Active rows. It verifies hidden partial mirrors, then uses the original registered Archive worker to recover and publish a real manifest before export becomes visible. Original CSV field and quantity assertions remain.
- Full affected regression passed: Node reports 112 passing tests including six parent tests; JUnit contains 106 actual passing testcases, zero failures/skips. It includes the full Export/CSV native files, three pure Export/Archive Inquiry files, original 250,000-row export budgets and TC-060. The earlier 87/88 CSV run's cooldown failure remains recorded; its root cause has not been proven. New assertions verify worker success and a persisted retry deadline; neither the two-second retry nor the five-second test deadline was widened.

DEF-037/038/039 and DEF-040 have separate scoped closure reviews. None of these results is a full Phase or merge approval.

## Runtime and pending work

Only the owned socket-only MySQL runtime UUID `b65c23c2-d269-11f1-943c-6d91932a1b08` was maintained. Normal restarts occurred between complete runs, with original data, UUID, binlog/durability, nice 10, concurrency 2 and 1.125 GiB buffer pool preserved. Digest capacity is bounded at 100,000 entries; old full-buffer UNKNOWN observations remain historical facts. Counts from different boots are never stitched into a measurement window. No TRUNCATE/PURGE/RESET, global binlog disablement, DR or restore test was performed.

The 1m Active-store/5m-line initializer and separate 25m index-only proof remain retained. Complete standard checks on the current source are running in `phase4-private/developer48-r4`; they intentionally checkpoint after 44 nonperformance suites. All four original performance suites remain mandatory and unexecuted for this final candidate. Capacity SLOs, 300k-candidate Archive drain, current-candidate CI, real-browser review and final independent whole-phase review/Gates must pass before the already authorized merge.

Private evidence is retained under the sibling `phase4-private` directory: `dec043044-native-r6`, `source-index-migration-r1`, `base-runtime-migration-r1`, `archive-export-completion-native-{red,green}-r1`, `archive-export-cooldown-impact-regression-r1`, `archive-export-completion-fix-r1` and `runtime-digest-restart-r{1,2}`. Preserve this directory and relative module evidence before any worktree cleanup. Source initialization is not relabeled as a current capacity PASS; no previous run is relabeled with a new source/specification identity.

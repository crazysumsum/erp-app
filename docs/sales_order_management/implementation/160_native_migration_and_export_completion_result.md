# P4 native migration and Archive export completion — developer result

Status: scoped developer verification completed; full Phase verification remains in progress. This is neither formal Technical Acceptance nor UAT/release approval.

## 固定交付阻塞表（持續更新，2026-10-30）

目前：DEC047R2方案C已由Sam在project-manager chat直接批准，原DEC048 package入口亦已批准；不再等這兩項答覆。正在整合main5feb（FulfillmentP1／Supplier／Purchasing），8個具名衝突已解，保留雙方功能及唯一文件。DEF048三項0104/0106相容性缺口已真重現並作helper-only修復，既有migration bytes不變；37單元及19真MySQL功能回歸PASS/零FAIL／SKIP，獨立closing仍在收束。已備妥C的5case最小入口與report-onlyCI保存接線，尚未執行本機C負載／push／開PR／CI。新增main CI從524增至預計588檔、14個新容量情境屬DEC049待答；不自動啟動擴大CI。以下舊Candidate/Observed/Runtime段落為歷史snapshot，不代表目前在執行或已通過新候選Gate。

| 具體阻塞／證據 | 最小處置 | 完成條件 | 責任人 | 需要 Sam 決定？ |
| --- | --- | --- | --- | --- |
| DEF043 coverage discovery／namespace／guard 已限定結案：同一524真實 test files、24 helper 不獨立執行；owned R2 TCP/socket/UUID、JWT、低 CPU 接線已核對。DEF045 舊 owner fixture 亦結案；實際20+87+22+10=139 native PASS/0 FAIL/0 SKIP，原始 source9fa3 保留；唯一後續 package glob 差異由獨立整倉 fingerprint bridge 核實。closing f356131b… | 保留既有修正及證據，不重做已完成的限定修復。 | 已達成；完整 coverage 仍須實際通過，不能以139案例代替。 | Sales agent | 否 |
| DEF044 TC060 同步已限定結案：普通／instrumented 原失敗 case 各1 PASS；原完整 CSV native88 PASS/0 FAIL/0 SKIP。實際 registered worker 保留2秒冷卻／5秒期限及業務斷言，僅關閉該測試的自動 calendar，人工 runCount/overlap/timeout皆驗證。review299d6cf7… | 沿用已完成修正，不再重跑同一診斷。 | 已達成；仍由完整 coverage 與原 native Gate 覆蓋。 | Sales agent | 否 |
| R10完整server coverage已PASS：4,546 tests＝4,339 PASS／0 FAIL／207原conditional skip；行95.78%、分支87.86%、函式94.78%，39檔per-file floors全過，原run20261029T075102-dbb22be03fa8。 | 保留真LCOV／checker／raw、原Source ed279／PLAN eea0bb／時間；不改標整合後Source e205。 | 測試執行已達標；104個Supplier純文件造成的metadata接入一併由DEC045明列處置。 | Sales agent | DEC045 A已批准並完成具名接入；若DEC046改產品，必須實跑新候選完整coverage。 |
| DEC045：獨立逐項核對32組無影響成功、3組真補驗及上述真fullcoverage；102原artifacts／35命令hash／8檔beforeimage與104純Supplier文件差異已核實，但installed genericGate只接全倉FP／PLAN完全相同run，無attestation入口。 | [一次具體政策提案](/Users/sam/.codex/worktrees/sales-p4-archive/phase4-private/dec045-evidence-intake-r1/decision.md)：A具名人工metadata處置、保留generic真阻塞及所有其他Gate；B堅持generic字面PASS、整套48重跑。無新通用工具／舊報告改標。 | 實際Sam選擇後按該邊界完成；proposal a3c27268、獨立最終覆核579413c1。已由Sam直接批准A；僅適用具名範圍，其餘Gate全保留。 | Sam決策；Sales執行 | 已批准A；不重問既有selective／commit／PR／merge授權。 |
| 最後容量組真FAIL：shape1m／5m／300k PASS；Active矩陣第803req503，rootlog證明snapshotAge302s→正式revocation closed300s，容量harness誤停30s安全refresh。另Outstanding62／62成功皆>2s，partialP953445ms，完整首100的P95下界3400.510ms；原COUNT/page各materialize約5m明細。 | DEC046已由Sam批准並實作；90／35／26、真安全refresh、兩個100HTTP樣本及實際rows-cost已通過並獨立結案。原FAIL完整保留，新的效能／容量及隱含CI依DEC047 R2待批。具體[DEC046提案](/Users/sam/.codex/worktrees/sales-p4-archive/phase4-private/capacity-active-failure-r1/decision.md) d1999025…／patch8f7bad09…，獨立覆核7d746b82…零待修正。 | DEC046限定修復驗證已完成；DEC047 R2擬改驗證位置與fullArchive合併時點，未批准前不執行新負載。 | Sam決策；Sales執行 | DEC046／048已直接批准；只待DEC047 R2明確選擇，不重問一般開發／merge授權。 |
| TC032、TC042／匯入及25m索引原三組已PASS；最後mixed／300k Archive／Archive query三案因前案halt未開始。CI／TaskDoD／最終整階段review仍未過。原run20261029T090204-75866e28d87a＝1PASS／4FAIL原樣保留，只有Active是真量測失敗。 | 保留三組PASS與44項具名來源、原fail/raw；不重建有效1m／5m／25m資料，不改來源／PLAN標籤。 | 實際修復及所有剩餘Gate通過才直接merge；任一新容量／效能FAIL或timeout再次停Sam。 | Sales agent | 既有commit／PR／merge授權保留；效能修復依DEC046集中處置。 |

## DEC-047 — 去重後最小驗證與合併門檻（R2，Sam已批准C）

Actual adoption: Actual Sam userMessage `01a18b64-3404-7fc2-8660-569b8f76099e` in project-manager chat `01a0e71b-fccb-7c81-b9fe-ed817cc58e1f`, verified from the actual thread: 「按方案C通知 Sales agent 推進」; DEC047 R2 proposal SHA `67ce4dd7ec11fc9260499d1ea911d05f18cb865e5306f6ef6fcecd0933e0d25e`. 原提案文字與其他選項保留如下；本輪實作／執行以已批准C為準，A/B不是現行選擇。新增main負載另待DEC049；未有新CI或merge結果。

本節取代尚未獲答覆的首版C＋I＋O／完整容量選項。依Sam在project manager chat的直接指示（userMessage `01a18aeb-19b5-77a1-b7d0-8a7a30076919`），本輪只讀核對、文件及本地提交；不執行待批測試、不push／開PR觸發CI。原首版完整清單／已呈交文字／原始錯誤計數保留在私有保存點，不改舊結果。DEC-048單一package入口已由Sam直接批准並通過原範圍檢查，不再待決策。

### 已完成證據與當前狀態

保留原來源、時間、command、runtime與hash：90功能／安全單元、35項完整P4 native、26項真Playwright、lint、兩次真30秒安全refresh，以及Outstanding兩個100樣本（P95 1582.867／1855.748ms、200HTTP200、原EXISTS oracle一致）。COUNT實際每次130萬rows、頁ASC300091／DESC40；初段單次3733ms照留，不能冒稱所有請求低於2秒。原44個非效能位置具名處置、三組效能2／4／4及2500萬獨立索引維持原身份，這輪不重測或重建。

本地產品候選`ae66d3db`／Source `f864dad5…`；本次只查GitHub，該SHA的PR-triggered workflow runs為0，沒有可拿來沿用的當前候選CI。舊完整coverage4339PASS／39floors只屬舊候選；新候選coverage已按新規則中止，原runner FAIL分類USER_POLICY_INTERRUPTION，未完成／非SLO失敗，不能採作PASS。

### C與I實際重複核對

| 核對項 | 本機C | 目前CI I | 去重處置 |
| --- | --- | --- | --- |
| 真實入口／探索 | profile執行`npm run test:coverage --workspace server`，Node26、serial、testEnv、明確`.test` glob | 四個`test:coverage:shard --test-shard=N/4`，相同glob／serial／testEnv | 本輪純檔案探索實得524檔；不是以suite名字推定。CI四shard須聯集完整且無重複／缺檔，依實際JUnit及來源核對。 |
| 測試內容／資料 | 全部普通／原生回歸，包括25萬Header＋25萬Line fixture的兩個25萬列CSV、5005筆×18keyset、501及1000／500有界fixtures | 同一測試來源／fixture；四個獨立隔離DB，不是四倍每一案例。TC032／035／042依原規則另跑 | 保留內容；不再先本機跑完整一遍。沒有另造較小fixture冒充相同案例。 |
| 旗標 | SALES_CAPACITY_SEPARATE_STEP=1、SALES_IMPORT_CAPACITY_SEPARATE_STEP=1、DB_INTEGRATION_TESTS=1、Fulfillment lifecycle=true | coverage步驟同值，專項步驟按原規則啟用 | 小型條件skip依實際理由逐案核對；沒有新增skip豁免。 |
| 環境 | macOS／owned MySQL26.7.0／輔助buffer256MiB／socket＋TCP | Linux／獨立MySQL26.7.0／原CI帳號與socket；Node major26，實際minor需記錄 | 環境不完全相同。重用的是完整功能coverage義務，不把Linux效能冒稱Mac結果；已有Mac90／35／26功能證據保留。缺環境證明時先查該項，不一律全量重跑。 |
| instrumentation／global範圍 | 原生Node experimental coverage，產LCOV，92／83／90 | 同原生V8 raw，原合併器合併range，不平均四份百分比；合併命令仍92／83／90 | 既有repo rules test明列lossless合併／不足函式覆蓋仍失敗。本輪沒有執行該測試；只讀舊LCOV640個source，CI exclude glob沒有排除其中任何一個，assembler另明確排除。將來實際LCOV仍須核對必要產品source／分母／uncovered項。 |
| 39檔floors | 同`checkCoverageFloors.js`讀同一LCOV | 原merge命令亦呼叫同checker | 只能採用同一次CI產生的合併LCOV＋該checker真實結果，不能只看workflow綠燈。 |
| 原始artifact現況 | 原本機stdout／LCOV可留存；本次中止不完整 | 四raw包有commit／Node／cwd／shard manifest，僅保存1天；合併LCOV及floor stdout未upload，四shard未產JUnit | 最小補正僅加內建JUnit、保存合併LCOV／原門檻日誌／checker／package。具體私有patch SHA `1f0ca0ef…`，未套用；不加通用平台、不改測試／floors／shard／分離旗標或保留期限。 合併artifact使用`sales-merged-coverage-evidence-${{ github.run_attempt }}`，不匹配原`server-coverage-*`四shard下載pattern，且每attempt獨名保留歷史，不覆寫舊merged包。 |
| candidate／可信來源 | 原本機回執保留其原HEAD／Source／PLAN | 未來唯一新CI須記錄repo、run／attempt／job／artifact ID、實際checkout SHA/tree、PR head／base／synthetic merge、Node／MySQL與4 manifests | 不以不同SHA字面相等推定：用immutable Git objects與product／test／CI／lockfiles實際tree核對。不同tree只處理真正受影響範圍，不用舊head綠燈或過期raw。下載原ZIP與logs並存SHA，不改manifest來源。 若CI真check位於synthetic merge SHA，保存該真SHA，對本候選head／base／merge的Git objects及product/test/CI/lockfile tree逐項映射；不可把provider check或manifest改標branch SHA。若generic精確CI觀察仍因這個已證明的身份差異報缺失，本次具名接入亦須明列該差異並由最終獨立覆核處置，不冒稱generic字面PASS；tree有實際影響時先分流處理，不用映射掩蓋。 |

結論：建議**取消本機完整C的重複執行，只以一次新候選CI產生完整coverage並同時支援C／I兩項義務**。開發者自測並未取消，90／35／26／lint已實跑。可省一次本機全套，舊實測約25分鐘、新候選估25–40分鐘及重啟／fixture工作；不是已實測節省值。CI原client coverage／lint／audit／browser等可同時提供現候選證據，沒有理由再本機重做未受影響項目。

**接入限制必須明確決定：**未修改Harness `harness_checks.py`150–170要求本機suite／command hash／environment／runtime及run.json，350–360只選完全同Source／PLAN的本機回執。它沒有CI artifact→C的入口。建議Sam本次批准本候選具名CI coverage接入：保留generic對本機回執缺失／不相同的真輸出，以真CI完整artifact、下列等價核對及最終獨立覆核逐項處置；不造本機PASS、不改舊run、不修改已安裝Harness／不擴張通用adapter。這超出DEC045原32＋3／舊coverage的具名範圍，所以現在只是提案，沒有自動套用。若不批准此接入，明列為政策阻塞，不自行回頭重跑C。

### 去重後建議最小清單（方案A）

| 本次改動／風險 | 已有有效證據 | 尚缺／唯一執行位置與規模 | 原門檻／merge必要性／預計時間 |
| --- | --- | --- | --- |
| 跨模組Archive／觀測／query完整回歸與覆蓋 | 具名舊44、新90／35／26、lint；沒有新候選完整coverage | **CI一次**：524檔／四shards、原全部CI與明列fixture；補JUnit及merged LCOV保存後才觸發 | 92／83／90＋39floors；原所有required checks／零必要案例缺失。**必要**，估15–40分鐘，排隊／資源峰值未知。取消本機C，不取消任何功能案例。 |
| CI原必跑效能，不能因已在本機過而刪 | 原TC032／匯入效能組保留原身份 | **同一次CI**：TC032兩情境各50人×3輪150確認（1／100行，一案另5warmups）；TC035兩個50MiB／10萬列（1000／10000來源訂單）；TC042實際2000張／10000行＋10人／10秒think、兩階段各≥50樣本；1／10MiB grouping | TC032僅原兩例10秒；TC035 worker各<30秒；TC042≤30分鐘／P95≤3秒，memory16／32／64MiB。**必要**，包含上列CI估時，不另本機跑一次。 |
| 大表Inquiry共同builder／觀測開銷 | 現成1m／5m，Outstanding200已PASS，其他12類的先前中止樣本不是完整窗口 | **本機一次**：其餘12類×100×2＝2400HTTP、原排序／oracle，重用既有Outstanding200做具名證據聯集，**不再重跑這200** | 每類每階段P95≤2秒／精確count與row。**建議保留必要**；估10–25分鐘，實際未知；不重新執行整個13類入口。 |
| 真50人、Import／Export／Archive同時爭用pool與worker | TC032只屬burst／10秒；CI TC042只有10人、2000匯入；小型事務證據不能證明完整持續競爭 | **本機一次**：50JWT、60秒ramp＋15分鐘steady＋最多5分鐘drain、10秒think、原比例；1萬張／5萬行Import、5個45000–250000列Export、precheck／processing各50人burst；第一次Archive500後500真Draft補位，mixed再Archive500 | list／detail≤2秒、Archive讀／confirm≤3秒、Import≤30分鐘、worker及對帳零失敗。**方案A保留必要**；估25–45分鐘含準備，數量可依實際吞吐量增加並完整記錄，不能冒稱固定總數。 |
| Archive跨batch、18類不可變內容、foreground互不干擾 | 原native501的500＋1／完成／replay，rollback／unknown commit、provider／routing／Inventory原生joint證據；25m外鍵不是Archive長跑證據 | **本機與上一項同次**：只搬2×500＝1000個原eligible aggregate，18類原圖，固定選中ID before／after canonical counts／amounts／hash與manifest；不為此先hash全30萬。先無業務mutator的500搬移驗Inventory不變；mixed期間的500不冒稱全庫Inventory靜止，沿真事務＋混合對帳證明。只讀記錄batch RUNNING與剩餘299000；完成狀態另由501原生案例覆蓋 | 500／次、600秒deadline及前景零錯誤保留；bounded first500只如實報N／P95，舊full-drain的foreground至少100樣本且P95≤2秒一併延後，不冒稱這個原長跑Gate通過。Active完整窗口／mixed的原2秒另保留；不將1000當30萬PASS。**方案A必要**，預算包含上一項，hash成本未知；僅merge專用有界入口，原完整容量入口保留。 |
| Archive查詢路由／manifest／合法範圍 | 26真browser、native／CSV及501；沒有大Archive table latency證據 | **本機一次**：真搬完1000上，3類×100×2＝600HTTP＋非法範圍負例。使用同一1000集合，無新歷史seed | 精確≤3秒、受限range≤5秒與oracle。**小型合併驗證必要**，估數分鐘，未實測；不能代表30萬Archive索引／分母或冷cache。 |
| TASK062 operational用量與backlog | pure/native功能證據，沒有可冒充的完整實際footprint回執 | **本機只讀**：既有兩表rows／bytes、FIFO scope、instances、backlog，mixed前後取值；不擴量／不造24h歷史 | 來源／估計值分明、24h未覆蓋仍UNKNOWN。**必要**，估數分鐘；不另跑容量generator。 |
| 完成整月30萬、長期memory／disk／hash與大Archive查詢 | 小型交易／501／1000計劃不能覆蓋數百次長跑 | **正式驗收／Archive啟用前**保留原300000 full drain＋大Archive矩陣，原測試檔／SLO不刪，列NOT RUN／啟用阻塞 | **方案A移出本次merge、不是免測或PASS**。需Sam明確變更merge時點；現`server/config/scheduler.js`的` sales.archive`預設false保持，未通過不能宣稱可啟用／上線。 |

上列pipeline拆分及「12類＋既有Outstanding200」／「1000局部＋原501終止案例」需要在Sam採納後更新developer執行契約與獨立覆核，才能執行，不能拿原五案命令的skip／局部結果冒充整組PASS。只增加Sales專用有界入口／既有helper最小接線，原full entry保留；不改產品業務、schema、查詢或Scheduler設定。所有正式TC與原驗收負載保留，不因developer合併批次而宣稱Technical Acceptance或release PASS。

### A2／A3數字的依據與獨特風險

- **50人有明文需求，不是僅工程師寫在測試中。**`01_requirement_spec.md`§13.1／NFR-PERF-005（772／3182行）寫至少50名互動使用者＋背景工作；§16.3（939行）要求**上線前**完成50人容量驗證，NFR-004另明列1萬匯入／30分鐘。Design§11.7把它具體化成Confirm3秒。沒有找到真實線上同時活躍使用者／尖峰arrival rate的統計，不能聲稱現場已量度50人；15分鐘steady及5Export亦是工程測試情境。P4不只是兩行修復，還有shared pool-wait、持久化觀測、Export與Archive owner交易；CI10人及50人burst不測這些長時間同時競爭，所以建議本次保留A2原50人／原窗口，成本約半小時量級。若Sam選擇縮至10人，明列未證NFR005，必須改merge Gate並將50人留在上線前。
- **30萬是設計容量情境，不是已核實的月度營運事實。**Requirement§13.1／§13.3要求每日約1萬、月度分批、不長鎖；沒有30萬實際業務量記錄。Design§11.7（2229行）明列monthly300000，與1萬×約30日的容量推算相符；這個推導不等於生產每月必有30萬eligible。Sam DEC041／042曾明確保留300k測試規模，故它目前確實是核准契約的一部分，不能因本次核對自行免除，但可以請Sam把驗證時點移至正式驗收／啟用前。
- A3獨特價值是數百batch累積cursor／checksum、長時間memory／disk/binlog／清理、300k manifest與較大Archive索引的表現。每單rollback／hash／routing／replay、500／501邊界及18類owner真正同交易，已有真原生與joint證據；2500萬索引只證明外鍵索引，絕不能替代Archive整圖長跑。現容量generator主要有一個完整Fulfillment owner圖，其餘候選主要為簡單finalized Orders，跑30萬不等於30萬種owner圖組合。移後A3會留下上述長跑風險，必須記為未完成。

### 整組時限、筆數及入場規則

本輪只讀既有owned source狀態：Archive headers **0**、manifests **0**、原eligible **300000**（UUID b65c23c2…；`dec047-readonly-archive-state.json`）；Archive batches **0**另由單一空表COUNT回執`dec047-readonly-batch-count.json`明確確認，不把第一份未輸出batch欄的raw冒稱獨立計數證明。沒有偷跑A2／A3或新seed。計數應為：first500後299500；mixed再500、累計1000後**299000**。舊清單298000是算術錯誤，已更正；原已呈交snapshot仍保留。

原`performance.capacity.js`雖每案timeout21600000ms，profile `sales-phase005-performance.timeout_seconds=21600`是**整個五案process共6小時**，包含setup／Active查詢／mixed／hash／完整排空／Archive矩陣，並不是每案各有獨立可累加6小時。600個有效搬移batch之外，還可能有空查終止及replay呼叫。

舊first500=34.632616833秒單次值×600=20779.57秒＝5小時46分20秒；6小時只剩約13分40秒，連原mixed最短16分鐘也容不下，還未加其他步驟。資料形狀／metadata／cache／後續索引變更可能令實際快或慢，這個外推不是timeout定論，但**現有證據沒有證明6小時有足夠餘量，不應明知此風險仍先跑再說**。原量測及期限保留；若保留完整A3作merge Gate，先等可審閱的資源／時間admission及Sam明確批准，不在這輪自行加budget或先做新pilot。原15分鐘cadence至少約150小時的calendar量級也不是加速600次測試可替代；Archive啟用前須處置維運窗口／告警風險。

本機只一組SQL／browser／build負載、nice10、單Node worker／UV2／GOMAX2、MySQL concurrency2；主buffer1.125GiB，Node peak未知。上次停止後磁碟526.71GiB為當時觀察，非現在重測；原追加log／temp／file保守預留72GiB與105GiB入場／100GiB硬reserve保留，開跑前只做必要安全preflight。CI用遠端原runner資源，實際費用／peak未知。所有量測binlog／durability=1、不PURGE／RESET／TRUNCATE、不做本輪DR；不重建1m／5m／25m。

### 一次需要Sam決定的選項

**A（建議）：**一次批准新候選CI（含原隱含容量）、最小report保存patch及具名C／I證據共用；本機只執行上列12類／2400＋原50人完整mixed＋1000局部Archive／600查詢＋operational只讀用量。保留原200樣本與全部無影響成功。將原30萬完整排空／大Archive容量移至正式驗收／Archive啟用前，明列NOT RUN，更新合併契約但不刪需求／測試／SLO。估本機約40–90分鐘、CI15–40分鐘（可能重疊；非保證）。須同時批准這個有界執行及merge時點變更，才可按新契約執行／完成Gate。

**B：保留原全部merge Gate。**可先批准同一份去重CI／本機項目，但A3仍阻塞合併；未證明原6小時admission足夠及未批准具體時間／資源前不啟動full A3，不自行延時。沒有省去實際長跑風險，但P4交付時間維持不確定。

**C：只用CI的10人／2000匯入作本輪有界負載，A2與A3都移至上線前。**同樣完成完整CI coverage、12類大表／1000小型Archive及必要查詢／footprint（執行位置仍如表，1000需另外無mixed方式做兩批及10前景reader），不跑50人長mixed。需Sam明確批准較大merge Gate變更；未證50人、1萬端到端Import＋5Export／Archive同時競爭，不可聲稱NFR004／005已達標或啟用Archive。

未明確選擇時全部待批負載繼續停止；新方案亦待獨立覆核。取得同一清單的實際批准後不逐項重問；新增／改變規模或真效能FAIL／timeout再次立即停報。既有一般開發、commit／review與全部**獲批准的**剩餘merge Gate通過後直接合main的授權保留，沒有自動批准合併或正式驗收。

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

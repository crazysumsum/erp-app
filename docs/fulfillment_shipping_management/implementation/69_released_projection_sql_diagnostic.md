# 舊投影50批UPDATE的server診斷

Sam 已授權按報告68建議，先檢查原舊投影UPDATE的執行計劃、掃描列數及等待，確認原因後再提出具體方案。原HEAD30d／PLAN142a／DESIGNf790，全部安全與20秒保留，PR297不合併；本輪不修改或試執行任何候選產品UPDATE，不重跑CI，不push。

沿用現有隔離worktree／私有runtime。上一輪原完整full5000 Reallocate單case及cleanup已完成，原CI408FAIL／HIGH022025OPEN與TASK017022未完成保持；不把本輪診斷當成全套回歸或CI修復。

先獨立覆核fresh prepare及read-only Performance Schema欄位／instrument／consumer inventory；再依實際支援能力做最小collector與透明性純驗證／必要獨立synthetic smoke，凍結並獨立准入後，才在原完整full5000 case觀察50個原UPDATE。所有真容量／效能失敗仍停報，不重試或調低門檻。

預定以獨立observer connection讀取actual transaction thread／prepared handle的scalar counters，以及table index I/O、thread waits、trigger program摘要；不在業務executor新增SQL。原native receiver／args／result／error identity不變，observer問題明確拒絕診斷資格，不取代業務結果。EXPLAIN只規劃原SQL與原參數，不使用會執行DML的EXPLAIN ANALYZE。詳細方式等待欄位確認及獨立覆核。

語意界限：ROWS_EXAMINED只計server layer，handler／index I/O另列；LOCK_TIME是table lock等待，不能當成全部InnoDB row lock等待。Trigger與其nested statement時間包含在top UPDATE內，不能相加；非SQL wall不是CPU。新observer／EXPLAIN的開銷另列，原交易20秒一路覆蓋，不扣除診斷時間。

## 官方方法來源

- [Prepared statement instance](https://dev.mysql.com/doc/refman/26.7/en/performance-schema-prepared-statements-instances-table.html)：以owner thread與statement handle綁定執行及累計統計，不依賴可能被覆寫的history ring。
- [Statement event欄位](https://dev.mysql.com/doc/refman/26.7/en/performance-schema-events-statements-current-table.html)：時間單位、ROWS_EXAMINED／LOCK_TIME及nested語意。
- [Stored program／statement摘要](https://dev.mysql.com/doc/refman/26.7/en/performance-schema-statement-summary-tables.html)、[thread wait摘要](https://dev.mysql.com/doc/refman/26.7/en/performance-schema-wait-summary-tables.html)：schema／program及thread差值觀察，不把不同層級重複加總。

## 中繼資料及相容性探針（保留失敗）

已獨立覆核准入guarded prepare＋7項metadata inventory，receipt SHA `558ccd51b4160148abc5aa1caaa6d2734dd05357ecbb7c606ab80c8a1313d949`。本輪runtime為 `fulfillment_p0_p1_a329dc43`／`p1post_9b96a4c4`，socket-only MySQL26.7，原128MiB buffer／100MiB redo不改。先驗證server UUID／socket／datadir／networking再查metadata；prepared／program／index I/O所需欄位存在。Default CPU及wait current／history consumer未啟用，只有部分wait instruments啟用；本輪不改PFS設定，缺失觀察明列不可取得。

source helper／純測試及一次100列compatibility probe另已獨立覆核0C/H/M，receipt SHA `4df163414fd80134ad739afb9bbc01cf299da2376443085d5eabd458b6f0c874`。root34 pure PASS／lint PASS；reviewer27 pure PASS。原產品source、原case全部assertions仍原樣，只多4行明確診斷import／env啟用行。

該probe在獨立minimal synthetic schema用一個原shape UPDATE檢查計數器介面，不是產品功能／5,000筆容量／效能取樣；沒有disable任何真產品guard，也沒有執行產品候選SQL改寫。原UPDATE已affected100並提交，但helper把capture標為invalid，probe第28行assert FAIL／exit1。沒有20秒逾時證據，不能稱產品超時或PASS。精確probe child schema已刪除，原FAILED result/stdout/stderr均保留。

Root工具有一個證據保存缺陷：probe僅在成功assert後才把capture.records放進result，令此次失敗沒有保存到被拒絕的counter細節。這些未保存的明細目前不可恢復；保留真失敗與未知原因，不重建舊PASS或捏造拒絕原因。下一步只先以唯讀metadata postmortem分辨SQL_TEXT儲存／截斷格式與foreground背景thread識別；prepare原句但不execute，不重試該probe或容量案例。新工具必須在finally保留records/state及安全check識別，再獨立覆核。完整原full5000案例尚未准入／執行。

## 診斷器修復及有限readiness

唯讀prepare-only postmortem已准入並exit0／COUNT_EXECUTE0（receipt SHA `8d7a70118afc1d8b74f92e4e61cce40eb103c3500356db1aa89a149caac4be53`）。實際原句11,996字元、server保存1,024字元的精確prefix；截斷假設在此環境成立。已證實舊quiescence判斷會將 `thread/sql/event_scheduler` 及 `thread/sql/compress_gtid_table` 的預設Daemon誤判為其他業務工作；這足以令舊判斷拒絕，但第一probe未保存的實際check仍UNKNOWN。

修復只允許這兩個精確NAME／USER／TYPE／COMMAND／DB組合，另查enabled SQL events必須0及其他InnoDB transaction必須0；未知活動仍拒絕。沒有廣泛忽略Daemon或改PFS設定。program／target table I/O／global row-lock delta仍是隔離物件／server aggregate，不能宣稱per-thread；內部背景thread可能對global counters有貢獻。

明示的新v2 probe經獨立覆核後執行一次（receipt SHA `afd3a25f314f36e207ed37a795940412759ba7ef9d3a7e6b7038b45b7b706a3c`），**整體仍FAILED／exit1**，原UPDATE成功affected100，完整保存COUNT_EXECUTE1／examined100／trigger100次、index／handler／wait／row-lock計數。這次只在 `explain-original` parser失敗、plans0；沒有業務／容量逾時。精確probe schema已刪除。新finally保存已由independent fake-connection測試強制失敗驗證；證據保存Medium為CLOSED_FORWARD_ONLY，舊未知細節不追認。

再經獨立准入兩項只讀EXPLAIN格式查驗（receipt SHA `54fb17e09efa68253dd69d20865847e3650bfc8fa1ae6a31f1a6677134ddf713`）確認：JSON v2只回 `query_plan.operation=<not executable by iterator executor>`／query_type UPDATE／schema_version2.0，沒有table節點；舊parser的targettable斷言因此拒絕。TRADITIONAL則有完整UPDATE／target table／type／key／estimated rows／Extra欄位。本輪只將診斷改用TRADITIONAL，沒有改server格式設定或產品SQL。

獨立覆核接受split-evidence readiness，0C/H/M，receipt SHA `9bac22dfac8f316f217c63773d2847d84a4c9df9a1d41e591bd03a32b40d352f`：v2已保存的counter介面事實，加上另外只讀實際TRADITIONAL格式與修正formatter的純驗證，可供原完整案例准入；**不把v2 FAILED改成PASS，不做第三次DMLprobe，也不是新的容量通過證據**。空base的EXPLAIN估算不代表5,000筆資料的計劃或瓶頸。

修正後root35 pure／lint PASS；新collector22＋原caller25個synthetic拒絕／通過案例PASS。原產品檔案完全沒有diff，原case移除4診斷行後逐byte等於HEAD30d。最後完整量測待exact runner／collector／source freeze獨立准入。Default wait current/history consumer關閉仍可有部分summary counter；只解讀已啟用instrument實際觀察，CPU與未啟用mutex等明列不可取得。

## 原完整5,000筆案例的一次結果

最終獨立准入0C/H/M，receipt `independent-release-plan-final-measurement-admission-review.json` SHA `4e132b12460b41db5f33af40affa39da082aae8d94f66cdeff4e18fc209e119c`。凍結HEAD `30d442b5082bdcd32b1beffac6219473ebe22a4b`、source FP `2f819706602d468b3a16d686f19fce10ed869c5a7bc58a9dc68f5bb11ab82af6`、PLAN142a；16 private／10 source及5 module／10 body AST前後吻合。收集器缺欄位Medium已修，原3個反例拒絕，28＋原caller25＝53 synthetic PASS；舊凍結及失敗保留。

執行原完整single full5000 case一次：**1 PASS／0 FAIL／0 CANCEL／0 SKIP，exit0，strict collector VALID／issues空／sourceUnchanged true**。coverage開啟，原120秒case／20秒transaction／100行／每行50／總5,000／strict45000末批故障／完整facts rollback／同event恢復／數量對帳全部原assertions不改且通過。未重跑此容量案例。

| 指標 | 預期末批故障的rollback交易 | 同event恢復成功交易 |
| --- | ---: | ---: |
| actual parent tx | 8,557.924ms | 8,173.692ms |
| actual RC callback root | 7,996.173ms | 8,155.001ms |
| Inventory返回後tail | 2,201.362ms | 2,348.806ms |
| 舊投影50 UPDATE client總時間 | 1,191.579ms | **1,202.884ms** |
| server prepared執行時間（含trigger等） | 1,154.640ms | **1,164.821ms** |
| observer／50個EXPLAIN等額外時間 | 217.112ms | 222.967ms |
| 包含上述診斷的release span | 1,417.157ms | 1,434.158ms |
| 原UPDATE次數／affected rows | 50／5,000 | 50／5,000 |
| server-layer rows examined | **260,000** | **260,000** |
| main thread Handler_read_next | **250,000** | **250,000** |
| 原owner trigger calls／總時間 | 5,000／97.346ms | 5,000／100.004ms |
| prepared table LOCK_TIME | 0.036ms | 0.039ms |
| server全域row-lock waits／time增量 | 0／0ms | 0／0ms |

成功service整個呼叫含提交後RR Inquiry為8,191.718ms，ordinal8 Inquiry11.442ms／11 query單列，未混入RC tail。原成功parent947 query＋40,511 execute；observer查詢不經business executor，不混進原SQL次數。新增觀察開銷全程計入原20秒，沒有扣除或延長限制；這不是優化前後的效能比較，也不是穩定P95或當前CI修復證據。

### 已證實的掃描及等待

每一批100筆UPDATE均記錄：prepared `COUNT_EXECUTE=1`、`SUM_ROWS_AFFECTED=100`、`SUM_ROWS_EXAMINED=5200`、`Handler_read_next=5000`，沒有error／warning。50批只更新5,000筆，卻發生25萬次索引前進讀取；主表候選訪問反覆覆蓋本fixture的5,000筆集合。server examined26萬與engine Handler／index I/O是不同定義，不能互加，也不能把多出來的200列任意指定為某個trigger join。

成功phase的目標表I/O attribution：samples1–4各PRIMARY FETCH5,001（合計20,004）；samples5–50各 `idx_ful_allocation_work` FETCH5,001（合計230,046）；另有無index attribution的FETCH5,000及PRIMARY UPDATE5,000。這是實際I/O觀察，並非從事後EXPLAIN倒推每一批歷史plan。50個counter-first、matched-session的事後原句TRADITIONAL EXPLAIN都顯示 `key=idx_ful_allocation_work`、`type=range`、`rows estimate=1`、`Using where; Using temporary`；它們是代表性事後規劃結果，**不是50份原執行計劃原件**。尤其不能因type為range或估計1便當作實際只讀1列。

owner trigger全5,000次保留，成功總100.004ms，約佔server prepared1,164.821ms的8.59%，已包含在UPDATE時間。Default `statement/sp/jump_if_not`未啟用，所以nested statement count0不能解讀成trigger沒有內部工作。trigger／索引／table handler時間均是inclusive或不同層級，不重複加總或相減冒稱純CPU。

成功phase enabled table handler觀察519.214ms，其中 `idx_ful_allocation_work` FETCH453.200ms；table lock wait event另記0.022795ms、prepared LOCK_TIME0.039ms。全server row-lock wait次數／time增量為0，各sample前後current wait gauge亦0。全域值可能受兩個已確認internal daemon影響，仍不是per-thread專屬計數；在這次隔離window沒有新的已記錄row-lock等待。這足以排除**本次量測中主要時間花在row-lock contention**，不能推廣到多人競爭或先前CI。未啟用CPU／其他wait instruments保持不可取得。

### 原因結論及界限

已確認本案例有**每批100筆的UPDATE重複作5,000列的廣泛索引讀取**；既有SQL的 `fulfillment_id=? AND (逐筆id／version／quantity OR CAS)` 沒有產生按本批100主鍵收窄的實際存取。這是已量到的可消除工作；trigger驗證及已記錄鎖等待不是這輪主要成本。server的OR／CASE評估、temporary處理與其他未量細節不能逐項硬分毫秒。

事後估計1和實際讀取明顯不符，但本輪沒有optimizer trace／統計分佈變更對照；**不宣稱統計過期是已證實的唯一成因，也不宣稱這已證實先前CI20秒的全部根因**。本機兩個有不同目的的phase不是足夠的多次獨立效能樣本。原CI408FAIL／HIGH022025OPEN仍保留。

## 具體最小優化候選（尚未實作或規劃候選SQL）

建議A：把本批**100個已依原鎖序鎖定的主鍵**變成獨立 `id IN (...)` 存取範圍，保留原 `fulfillment_id` 及完整逐筆OR CAS（id／inventory_version／released_quantity／picked=0）、原CASE更新與affectedRows等於batch長度。每批100、總50 SQL不變；不新增index／migration／owner API，不減trigger／FK／來源／數量／權限／replay／原子rollback檢查。

採納前先做原型的唯讀EXPLAIN對照及實際主表訪問量驗證，確認是**PRIMARY上的本批100筆range／point access**。事後估計偏差表示單加IN未必自動選對索引；若仍寬掃，才評審在同一條UPDATE局部限定 `FORCE INDEX(PRIMARY)` 與 `id IN (...)` 一起使用。**單獨FORCE PRIMARY不代表範圍已縮小**，本次前4個sample本來就有PRIMARY的大量FETCH。MySQL26.7支援UPDATE index hints（[官方規則](https://dev.mysql.com/doc/refman/26.7/en/index-hints.html)）；本輪沒有執行或EXPLAIN任何候選IN／hint／JOIN語句。

改變索引訪問可能改變physical row／trigger次序，須先證明所有目標已完整預鎖及鎖序保留、trigger／FK／CAS／錯誤版本／錯誤來源／數量／picked拒絕語意等價。再執行原末批45000 failure的全facts rollback、同event恢復、原5,000容量及20秒，獨立覆核及完整回歸／當前候選CI；任一真容量／效能失敗即停報。

目標是消除每批5,000列的重複候選訪問，使主投影按100主鍵工作；**不是承諾整筆交易快50倍，也不要求包含必要trigger／FK讀取的總ROWS_EXAMINED必須恰等於5,000**。不以只修改fixture統計、ANALYZE、放大buffer、刪安全檢查或加大時限來替代SQL修復；本輪也沒有做這些操作。若原型無實際改善便不採納，先報告，不預做較複雜JOIN或擴大owner介面。

## 最終證據及清理

所有原件位於private0700 runtime，未export／commit原始log或credentials：

| 檔案 | SHA256 |
| --- | --- |
| `release-plan-measurement-result.json` | `dd68fbefed9d58ca4833a6bcacf611e462420a2c807632ccc2d2f325b2c2ce6a` |
| `release-plan-measurement.stdout.log` | `0e8c2b88bb8cdc3baa90c474695543cf380b86419b844ee07b98fde6a8530d5b` |
| `release-plan-measurement.stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `release-plan-pfs-unchanged.json` | `c96b0b56f8307d1dacdccd9ba48e5541238e745b7517e59377341c481a986f78` |
| `release-plan-runtime-cleanup.json` | `d06663da72d485c3f72e9813f64c963eb60d1c68685dc748412c94ee0ab495cc` |

設定比對的consumers／instruments／objects／PFS及optimizer變數全部UNCHANGED。確認零活躍clients／owned child schema及server UUID／socket／datadir後，僅移除本輪a329dc43／p1post_9b96a4c4，正常停止own MySQL；socket／pid absent，datadir與全部舊FAILED及新證據保留。沒有產品source／SQL／schema／index變更、CI重跑或PR297 merge。

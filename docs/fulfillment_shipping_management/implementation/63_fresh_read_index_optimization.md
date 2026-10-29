# PERF-CI-002 A：fresh-read 查找索引及 HTTP 診斷

Sam 已直接批准：「批准方案 A，先優化 fresh-read 查找索引並補足 HTTP 診斷，保留全部安全檢查及原有限制；完成獨立覆核後重新量測及跑當前候選 CI，若仍有容量或效能失敗便停下報告。」state 229 已記錄實際答覆及恢復 IMPLEMENT；不將前次診斷批准或「繼續」冒充這項新選擇。

## 產品範圍

只調整既有 owner／consumer proof 的本次讀取內查找方式：

- Inventory Allocation Preparation：Reservation／Balance 分組、Reference 查找及 membership；before 與 current 資料仍各自讀取、各自建立索引。
- Inventory Reallocation Advisory：同一份已鎖定 scope 依 Balance 分組，仍核對每一筆 SKU／版本。
- Fulfillment Pick／Cancel proof：保留原始完整集合與迴圈，將反覆全陣列搜尋改為每次呼叫內 first-match lookup／完整分組；Pick 最終投影亦從本次 current Reservation facts 查找。
- Preview consumer：從本次 snapshot Claims 建立查找，不跨交易／讀鎖階段重用。

`firstBy` 保持原 `find` 的第一筆語意，分組保留全部成員與順序；原本的 seen／長度／重複／額外／缺少／來源／不可變／數量／版本／錯誤分類及 critical contract checks 留在原有邊界。不新增快取真實資料、公開 API、寫入批次、SQL、鎖序、隔離或 operation receipt 策略。六個產品檔案的 35 個 query／execute／lockForCommand 呼叫，SQL 與引數 AST 均與 79aef39d 原件相同；這是靜態證據，不代替原生驗證。

## 測試限定診斷

只在 full real-HTTP capacity 案例啟用真正 HTTP app database 的計數與交易錯誤代碼鏈，另於每個 HTTP action 回應後、原斷言前立即輸出安全的 action／status／elapsed，保留原公開回應及全部斷言。callback 開始與完成分別記錄，避免將未完成當成未進入。

獨立覆核先找出 1 Medium：背景 scheduler 也使用該 app database，不能以 fetch 期間的全域 action window 判定交易歸屬。已改為讀取實際 request context 的註冊 method／path／handler，僅三條固定路由可綁到 HTTP action；其他交易標記 BACKGROUND_OR_UNBOUND，windowPhase 只作時間視窗。未修改 context／JWT／scheduler 行為，也不記具體 URL、token、SQL／參數或原始 error message。交錯 request／scheduler 的單元回歸已加入。

## 覆核前的正確性證據

- 新增 4 個行為契約，先在 79aef39d 原程式執行 PASS，再在索引版本執行 PASS：100 行／5,000 members、順序與數量、不可變輸入、duplicate／missing／extra／錯配／版本及 fresh-read 變更、Cancel 退回實物條件。
- 私有 differential 比較 7 個 proof 函式 × 27 種變化＝189 組，與修改前原始碼的輸出／錯誤 name／code／status 及輸入不變性一致；不冒充容量量測或正式接受。
- 最終 Fulfillment 單元／契約回歸 143 PASS、0 fail／skip；診斷 helper 含 7 個測試。首次較大單元啟動因我漏載 testEnv 及 sandbox 禁止 listener 而失敗，原紀錄保留；修正為既定 `--import testEnv` 與自有 listener 權限後執行，沒有修改測試斷言。
- 原 5,000、20 秒交易、20 樣本、300 秒案例、coverage、完整 rollback／replay／source／庫存對帳及當前 CI Gate 均保留。

以上為覆核前的紀錄；當時容量與效能尚未重新取樣，須待獨立覆核完成才執行。覆核通過不代表改善已證實或 P1／CI 通過。無改善或仍有容量／效能失敗即停報，不自動轉用 Reservation CAS 批次化或提高限制。

## 同輪必要回歸的最小去重

Sam 在 project-manager chat 的真實人類訊息 `01a17c33-9b60-7011-8fda-9a74a2bad727` 已要求：「收斂 P0／P1 重複驗證，保留全部案例及門檻，不要為去重重跑目前已通過的測試」。既有只讀等價覆核及兩份真實 542 PASS 原件全部保留。

這輪產品來源已因實際批准的效能修正而改變，必要完整回歸只執行一次既有 `fulfillment-p1-developer`。最小變更僅在 manifest default 及 PHASE-001 的 developer binding 將 p0 ID 改為既有 p1 ID；PHASE-002 已使用 p1，無需更改。兩個歷史 profile suite 定義、argv／環境／timeout／原案例集合保持 byte-identical，共用較嚴的 p1 min230／maxskip0，不偽造兩次執行。P0／P1 browser 仍各自保留，formal technical／regression／UAT／coverage／CI 全部不變。修正與本輪必要產品候選一起送一次 CI，沒有額外治理候選或為去重重跑舊報告。

## 覆核後一次 focused coverage 量測

產品／測試 source FP `b6f466b07d73d63e75b4cf0f87ecb6aefb67a124e14d5123d0f612b6dd24cbbb`，獨立 source review 0 C/H/M（SHA `cae05905d3ea10cece9df6218485b25f4ce026893e96c0021b46a6be6c9684a0`）後，執行同四個診斷案例及新失敗的真實 HTTP 案例：5 PASS、0 fail／skip，168.039 秒。仍使用原生 MySQL 26.7.0、coverage、test-concurrency=1、新 UUID synthetic child fixture、5,000 規模及全部原有斷言。沒有產品／spec 在量測期間變更。

| 本機指標 | 前次同類本機值 | 本輪 | 判讀 |
|---|---:|---:|---|
| 5,000 balances Allocate preview P95（20 樣本） | 807.86ms | 622.61ms | 每次最多 180 SQL，仍零 DML |
| Reallocate preview P95（20 樣本） | 5,398.61ms | 1,166.93ms | 每次最多 411 SQL，仍零 DML，first／middle／HTTP 全部完成 |
| 已揀貨 Cancel 命令（單次） | 11,934.87ms | 6,223.01ms | 50 Allocation／50 Claim 批、三個末批故障及對帳通過 |
| 4,999 Short + 1 正常 Pick 命令（單次） | 13,431.65ms | 6,174.64ms | 50 projection／2 audit 批及末批 rollback 通過 |
| Reallocate 命令（單次） | 9,247.57ms | 8,885.57ms | 差幅較小，單次樣本不足以獨立證明此寫入路徑有穩定效能改善 |

新增的真實 HTTP 診斷得到 Allocate 5,446.38ms、Reallocate 8,293.69ms、Pick 1,998.47ms，均 200；late-Pick rollback、三次原事件 replay、Sales／OnHand 等原有對帳全部通過。20 筆實際 app transactions 中，14 筆有精確註冊路由歸屬，6 筆為 BACKGROUND_OR_UNBOUND；沒有將背景交易算成 HTTP 失敗。預期 late-Pick 的錯誤代碼鏈可見 `DATABASE_OPERATION_FAILED`／`ER_SIGNAL_EXCEPTION`，未暴露原始 error message／SQL／參數。

raw log 138,377 bytes SHA `47c0524bec3b9c359f2f5ffe06e2261b49b0764cfa26810c3b6b51cfdaa1fd1b`。獨立量測結果覆核 0 C/H/M，receipt SHA `bed4adad99afd5df7e3db62b7f7db2782d328f33684256eef351f83f58af1a3b`。數值為 developer 本機觀察；不宣稱修好了舊 CI 的 HTTP500 cause、不取代完整回歸／當前 CI，也不構成正式 NFR／Technical Acceptance／UAT。

## 當前來源完整 developer 回歸

同一 source FP b6f466b…／PLAN 142a24e… 已完成以下原命令：

| 實際 suite | 結果 | 唯一 run |
|---|---|---|
| fulfillment-p1-developer（P0／P1 共用一次） | 553 PASS／0 fail／0 skip，143 unit + 410 integration | 20261028T032503-64150925bcca |
| lint | exit 0 | 20261028T033112-6d72134db890 |
| security-audit | exit 0；原 high 門檻，仍有 1 low／4 moderate | 20261028T033112-ff6786c9214a |
| client-build | exit 0 | 20261028T034115-9bff23c8c917 |
| fulfillment-p0-browser | 2 PASS／0 fail／0 skip | 20261028T034134-eb989ffc4f7d |
| fulfillment-p1-browser | 2 PASS／0 fail／0 skip | 20261028T034217-3d3a0e854d18 |

來源、PLAN 及 HEAD 在各次實際執行期間均未變。553 案例原生完整執行耗時 947.869 秒，並非單一交易耗時；原 20 秒、5,000 筆、rollback／replay／來源／數量斷言全通過。原生 JUnit reporter 沒有保存 t.diagnostic，stdout／stderr 為空，因此不能從這次完整報告還原精確 SQL／stage／P95；上一節 focused coverage 的數字是另一份真實執行，沒有冒充本 run 的診斷。原始 JUnit 保留私有原件，各 run 有獨立來源、命令及 artifact hash。

兩組真瀏覽器維持原有登入／權限、提交／恢復、fresh work／Pick／列印、console／network 斷言；當前產生的 A4 PDF 已實際 render／view，中文、狀態與數量正確，無空白或截斷。完成後確認無 child schema／active clients，僅清理本次 exact synthetic base／帳號，正常關閉自有 MySQL；API／client ports 已釋放。

這些命令使用 Sam 明確批准的 remediation 及已獨立覆核的私有擷取工具，沿用 canonical argv／環境 allowlist／工具探針／timeout／report parser／min count／skip contract。原始 PLAN_READY 仍因 DEF-022／025／026 HIGH OPEN 而 BLOCKED，保留於每份報告；沒有偽稱 canonical run_check 或 Gate PASS。可驗證的是實際 suite PASS；完整獨立結果／provenance 覆核及當前候選 CI 仍須完成，舊失敗與所有缺陷歷史保留。

## 當前 e54 候選 CI 實際結果

唯一 workflow run [40628810071](https://github.com/crazysumsum/erp-app/actions/runs/40628810071)，exact HEAD `e54a53984a3fbfc15c9c1bbd94f7b9c46af27949`，於 2026-10-28 04:11:46 UTC 完成 SUCCESS，13／13 jobs 成功，包括四個 native coverage shards、server／client coverage 彙總、原 high dependency audit、lint、build、一般及真實 P1 browser、TC-032／TC-042。完整 developer 的 553 零 skip 與全域 CI 是不同執行；四個 CI shards 合計 4,332 tests＝4,125 PASS／0 FAIL／0 CANCEL／207 conditional／discovery SKIP，不冒稱所有上游案例零 skip。

| 當前 CI 容量指標 | 實際結果 |
|---|---:|
| 原生 Allocate／Pick／Reallocate／Picked Cancel 成功命令 | 10.43／11.74／17.26／10.33 秒 |
| Reallocate 預期末批故障／rollback phase | 18.12 秒；實際故障交易 18.103 秒，為精確 ER_SIGNAL_EXCEPTION，非 watchdog |
| 真實 HTTP Allocate／Reallocate／Pick | 8.74／12.34／2.60 秒，全部 200、rollback／3 次 replay／對帳通過 |
| 5,000 balances Allocate／Reallocate preview P95，分別 20 樣本 | 1.401／2.546 秒；180／411 client statements，零 DML |
| 5,000 balances preview 完整 case | 129.378 秒，在原 300 秒整案時限內；不是單一交易耗時 |

重要風險：上述 preview 案例建立 Allocation 的準備交易實際耗時 **19,968.595ms**，距原 20,000ms 僅 **31.405ms**；其外層 setup phase 為 19,994.380ms，不能當作交易值。沒有錯誤、callback／promise 均完成，整案與全 CI 實際 PASS；原契約沒有另設最低餘裕，故不虛構失敗或新增 Gate，也不聲稱充分餘裕、穩定寫入 P95 或原失敗的唯一原因已證實。原 20 秒／5,000／20 樣本／300 秒、完整安全及錯誤 predicate 全部保留，沒有為此重跑或追加未批准優化。

新測試檔案改變 Node 原生分片分派，真實 HTTP 容量實際在 shard 2；不能只根據「舊 shard 4 曾失敗、本輪 shard 4 通過」推定同一案例通過。原生 Pick／Reallocate 在 shard 3，preview／Cancel 在 shard 1，均按本輪原始 case／diagnostic 核對。

全部四份 decoded CI raw log、解析紀錄、final API 及原始雜湊保存在 private runtime；不輸出原始 log 或偽造舊 PASS。精確候選 published bridge 獨立覆核 0 C/H/M，另記一項非阻塞 LOW：本次 `perf` commit 類型超出計劃字面列舉。最終 CI／缺陷結案／P1 DoD 的獨立覆核完成後才採納狀態並建立 draft，不授權 merge、正式接受或發布。


最終採納：獨立 CI／DoD／缺陷結案覆核 SHA `c707e8d0ba317459bd85d8d8db13895504094da9eaed0ff1d22fdc830f2a5cb1`，0 C/H/M、1 非阻塞 Low，已確認 31.405ms 風險及 skip 資格。state 238 採納 DEF-020–026 結案與 TASK-012–023 developer DONE，實際 PHASE-002 local gate 回 LOCAL_CHECKS_PASS／issues=[]（僅本地證據一致性，不代替人類 merge 許可）。

已建立並附加 [draft PR #297](https://github.com/crazysumsum/erp-app/pull/297)，exact e54、base a98、OPEN／DRAFT／未合併，已讀回核對 body。GitHub connector 的建立功能回 403，確認沒有產生 PR 後，使用既有 gh CLI 成功建立；原失敗及 fallback 已記錄。PR 建立後自動啟動的 [pull_request CI 40632110878](https://github.com/crazysumsum/erp-app/actions/runs/40632110878) 尚在執行，不能冒稱已全綠；建立前的 branch CI 40628810071 13／13 SUCCESS 保留其原資格。未進行 merge／發布／P2，也未清除開放 PR 的 worktree／分支。

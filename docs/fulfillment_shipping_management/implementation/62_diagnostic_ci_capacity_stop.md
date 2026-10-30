# 診斷候選 CI 的容量失敗與停止紀錄

候選 `79aef39d07940d1e37e46b122bcd9d78a89c93db` 已依 Sam 實際 PERF-CI-001 A 及獨立覆核推送，既有 workflow 僅啟動一次：[CI 40472547220](https://github.com/crazysumsum/erp-app/actions/runs/40472547220)。本輪沒有產品效能修改、workflow／coverage／20 秒／5,000 筆／安全檢查變更，也沒有為 P0／P1 名稱去重重跑本機完整測試。

## 已觀察的新失敗

Server coverage shard 4（job `122082872415`）已完成 FAILURE。全 shard 998 cases：960 PASS、1 FAIL、37 SKIP、0 cancelled；這是全域 CI 的原始摘要，不冒充 P0／P1 零 skip developer 契約。

失敗案例是 `fulfillmentHttpCapacity.integration.test.js` 的 `Full5000 actualHTTP Allocate/Reallocate/Pick retain20s, strict permissions, late rollback and exact replay`。第 20 行的真實 HTTP Reallocate，在第 16 行檢查回應時得到 **500／INTERNAL_SERVER_ERROR，預期 200**。案例總耗時 46,099.923ms 不能當成單一交易耗時。

- 之前的 HTTP Allocate 已通過 200／正確 outcome／既定 `no-store`／原有 `<20,000ms` 斷言，但其實際時間只在案例結尾輸出，這輪沒有該數值。
- Reallocate 失敗在 status assertion，沒有到達其 `<20,000ms` 斷言。raw log 沒有 `DATABASE_TRANSACTION_TIMEOUT`；500 不能證明 watchdog、特定慢步驟、rollback 或 commit outcome。
- 後續 HTTP Pick、late-Pick rollback、三次 replay、Sales／OnHand 對帳在**這個案例**未執行，不能宣稱通過。

原始 decoded log 289,412 bytes，SHA `d723a56846a180e6a6395564832160157caaa7e5b6ea9117280308b9725f65ed`。獨立 reviewer 已核對原始 log、source 行號與上述可主張界線；不以猜測補上內部錯誤。

## 停止範圍

依 Sam「當前候選效能測試失敗，再停下報告」的指令，已停止修改、測試重試、新 workflow、產品優化及 PR；state 225 為 BLOCKED、PERF-CI-002／DEF-025 OPEN。只繼續唯讀收集**同一輪已在執行**的剩餘診斷紀錄，未啟動另一輪驗證。自有本機 DB／帳號／MySQL 已於本機診斷後精確清理。

本輪 lint、build、audit、client coverage、既有 browser 及 TC-042 已通過。其餘 server job 的結果須以實際完成紀錄為準；未將未執行／尚未完成的 TC-032、P1 browser 或 aggregate Test 當作 PASS。

本機一次 4/4 coverage 診斷及其 SQL／階段數據保留於 [61](61_ci_capacity_stage_diagnostics.md)，不能代替這次 CI 的真實結果。產品優化方案尚未選擇，下一步需以本輪實際 CI 診斷作可審閱的定位／建議，再由 Sam 決定超出本次限定診斷的工作。

## 同輪最終結果與分階段定位

同一輪 CI 已完成 FAILURE，實際 head 仍是 `79aef39d`。8 個 jobs 成功、3 個 native shards 失敗、aggregate Test 失敗、aggregate coverage skipped。TC-032 及新 P1 真實 browser 步驟因 shard 1 的 native 步驟失敗而未執行；不使用本機或 main 的舊 PASS 代替。

| 案例 | 實際失敗 | 交易已嘗試的 client SQL | 可以確認的階段 |
|---|---|---:|---|
| 5,000 member Short Pick 的 projection rollback | 20,000.08ms watchdog | 539 query + 10,965 execute = 11,504 | preclaim 3.14s、ownerFacts 2.09s、完整 guard 4.24s 已完成；releasePost 執行約 0.89s 後被取消，未到預定末批故障。 |
| 5,000 old + 5,000 new Reallocate 的 projection rollback | 20,002.07ms watchdog | 5,841 + 40,266 = 46,107 | preclaim 4.78s、Inventory post 11.89s、prepare 0.60s、current proof 0.82s 已完成；後續步驟未能到達預定末批注入。 |
| 5,000 已揀 Allocation Cancel 的 projection rollback | 20,002.50ms watchdog | 712 + 25,157 = 25,869 | preclaim 2.38s、完整 guard 3.19s、releasePost 4.45s 已完成；第二次 ownerFacts 讀取被中止，沒有到達原定 projection 故障。 |
| 5,000 balances preview | **整個案例 300,000ms 上限** | 完成的 Reallocate preview 每筆 411 query／0 execute | 20 筆 last-claim preview 交易全部完成，耗時約 10.44–10.94s；first selector 完成，第 22 次直接 preview 起始時因 whole-case 期限被取消（0 SQL、未記錄 callback 完成，進入狀態未知）。不能將此列算成 20s watchdog。 |
| 真實 HTTP Reallocate | 500，內部原因未知 | 獨立 HTTP app executor 未納入這次直接 service 計數 | 上述 shard 4 界線不變；不以其他直接案例的 watchdog 推定這個 HTTP500 的 cause／commit 結果。 |

前三列現在都有實際 `DATABASE_TRANSACTION_TIMEOUT` 記錄及 cause stack；嚴格 synthetic marker 檢查因此正確拒絕這些上游 timeout。不能把它們當作預期的末批注入成功，也不能憑舊的 0／50 assertion 認定 batch writer 有 bug。owner 時間是 inclusive 的方法牆鐘時間，不能稱為純 SQL server 執行時間；未被這些 owner 計時涵蓋的時間也不能直接稱為 CPU。

Preview 的 100 balances control 在同一輪通過；5,000 balances 情境的 Allocate 準備交易完成約 19,345.47ms，已接近原 20 秒上限。所有 20 樣本、first／middle selector、HTTP、零 DML 及 300 秒 whole-case 上限均原樣保留，未因取消而縮減案例。

Queue 真實 HTTP 與 `every handler's directory matches its URL prefix` 在這次 CI 均通過，確認已批准的兩項修正有實際 runner 證據；這不使整體 CI／Phase Gate 通過。

原始 shard 摘要：1＝1,200／1,107 pass／2 fail／91 skip；2＝1,179／1,106 pass／0 fail／73 skip；3＝948／940 pass／1 fail／1 cancelled／6 skip；4＝998／960 pass／1 fail／37 skip。Preview whole-test timeout 在 Node 摘要計入 cancelled，不將其改寫為另一宗一般 assertion fail。

本輪剩餘 raw log：job `122082872397` 341,117 bytes SHA `e3c67f85393fba607f8870a534c2e894df2b831fed4fc5427a4f3a2c7b8f2eb3`；`122082872324` 321,488 bytes SHA `516212d1e12b4d5ffd2f7b80a820d5c2473381bb5c11d2e4c2d2e0838f83168f`；`122082872306` 318,673 bytes SHA `39a12103e615ce77a375655f2a34d292a7136170acf0e242bdc81eb02076110a`。原始與 parsed／summary／最終 run status 均保存在 private runtime。

## 可供決定的下一步，尚未實作

建議先處理同一份 fresh rowset 的重複全陣列查找：在既有 owner／consumer 驗證函式內建立 local lookup／group 索引，保持每次讀取及取鎖後重新建索引、重複／缺少／額外 ID 的拒絕、原始順序、所有數量／完整集合／版本／CAS／不可變證據／critical contract 檢查。不得跨交易或讀鎖階段重用快照，不更改 SQL、鎖序、隔離、operation receipt 或公開 API。CPU 效益尚未量測，不保證單靠此項便通過；必須先做 negative／equivalence 回歸及獨立覆核，再量測與執行當前候選 CI，若仍失敗停報。

同一修正範圍可補足真實 HTTP app executor 的測試限定時間／SQL／安全 error-code 診斷，取得 HTTP500 的內部 cause；不改公開 error envelope，不輸出 SQL／參數／token／原始錯誤訊息。另一選項是先批次化 Reservation CAS，可能少約 4,950 calls，但須額外證明每列 CAS／affectedRows／trigger 等價，風險較大；不建議在未決定前直接實作。

以上兩項選擇仍保留 100 行／每行 50／總數 5,000、20 秒交易、20 樣本、300 秒案例、coverage 與全部既有 Gate。先前已批次化的成功 audit／投影／完整 receipt chunks 不重做；尾批 receipt 的小修正最多只省 97 calls，不能冒稱足以解決本輪超時。Sam 這次「繼續」用於收齊與說明既有診斷，尚未據此選定產品優化或重跑 CI。

## 提交後來源指紋的機械核對

原本 `6fb7a3e0…f15e5` 是本機量測／覆核時的 pre-commit 指紋：其 Git index 仍包含兩個已刪除的舊 Queue 路徑，故 fingerprint 含兩個 deleted sentinel。100% rename 提交後，兩個舊路徑從 index 移除，實際 committed 指紋為 `54333a94a995df50c89d88c29ebebd04f56671fdbb9ae7e1e7d4590a869d1690`。以當前檔案集合只加回這兩個 deleted sentinel，可精確重建原 `6fb7…`；量測 source／test 逐檔 hash 全數相同。

保留原 pre-commit／本機及中途 CI 觀察，不倒改其 hash；另記錄已觀察的 committed 指紋與同一實際 SHA 的最終 FAILURE。這是 provenance 校正，不是新產品版本、測試重認證、Harness 演算法修改或重跑理由。核對原件 `79aef39d-rename-fingerprint-reconciliation.json` 保存在 private runtime。

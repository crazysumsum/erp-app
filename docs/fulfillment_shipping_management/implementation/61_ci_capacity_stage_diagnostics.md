# CI 容量失敗的分階段診斷

Sam 已實際批准 PERF-CI-001 方案 A（`call_b314959146c743aa9aaf7b4fb78bd12f`）：只先加入階段時間、SQL 次數及嚴格故障注入辨識，修正已確認的 Queue fixture／目錄問題；定位後才選擇產品效能優化。這份記錄接續 [失敗與暫停紀錄](60_current_candidate_ci_performance_stop.md)，不追溯修改其失敗或先前兩份 542 PASS 原件。

## 最小修正及覆核

- Queue HTTP fixture 從自有 child fixture 的連線設定取得 host／port／socket／user／password，不再混用 base app 帳號；未擴大任何帳號 grant。只對 exact base 有權限的 app 帳號配合自有 admin fixture，真實 Queue HTTP 案例 1 PASS、0 skip。
- 將 Queue handler／schema 原件移到 `handlers/fulfillment-queue`，公開 `GET /api/v1/fulfillment-queue`、handler 名稱與 schema 原樣保留。原 convention 失敗保留，修正後 convention／schema／handler 4 PASS。
- 測試限定 helper 使用實際 transaction executor，保留 callback context／signal、options、回傳值及錯誤身份。只計算 client-visible query／execute；不增加 SQL、不記 SQL 文字／參數／payload。最多保留 128 筆交易明細，owner 計時是 inclusive，不可彼此相加。promise 已拒絕但 callback 尚未結束的狀態分別記錄。
- Pick／Reallocate／Cancel 的末批注入必須匹配原生 SQLSTATE `45000`、`ER_SIGNAL_EXCEPTION`／1644 及精確 synthetic marker。超時或另一條業務 guard 不再能被當成預期故障。
- 獨立覆核先找出重複 preclaim 統計（1 Medium），已移除重複註冊並加入拒絕重複包裝的 regression；最終 0 Critical／High／Medium。helper 單元 5 PASS；原有容量／rollback 斷言均保留。覆核收據 SHA `45ad109e4582930103c05fd5f74a439935cdbda2814ca03aa1a0be1c054b2227`。

## 一次針對性原生 coverage 執行

四個 CI 失敗情境以原有 `--experimental-test-coverage`、`--test-concurrency=1` 執行，4 PASS／0 FAIL／0 SKIP，總耗時 307.494 秒。這是明確篩選的診斷執行，不是完整 P0／P1 契約或當前候選 CI 通過；其餘案例並未刪除或改為 skip。

本機為 macOS arm64、15 logical CPU、Node 26.6.0、MySQL 26.7.0。原失敗 CI 是 4 CPU／約 16GB、Node 26.12.1。未更改全域／局部 isolation、5,000 member 規模、100 行／每行 50、20,000ms watchdog、coverage 或任何安全檢查。所有 schema／帳號均為 synthetic 自有資源，完成後核對零活動連線、零 child schema，再精確移除該 base／帳號並停止自有 MySQL；資料目錄與證據保留。

下列數值為**單一實際交易**；client SQL 不含 transaction framework 的 BEGIN／COMMIT／ROLLBACK／SET、trigger 內部 SQL、後續 inquiry 或獨立 HTTP app 的連線。

| 階段 | 交易時間 | query + execute | 明細 |
|---|---:|---:|---|
| Allocate（5,000 balances，供 preview 後半準備） | 10,279.85ms | 5,312 + 25,362 = 30,674 | Inventory post 7,732.12ms／20,278 SQL；preclaim 1,295.77ms／10,007 SQL |
| Allocate（100 balances，另三個案例的準備） | 5,342.62–5,358.92ms | 30,674 | 與上列 SQL 次數一致，但實際候選／balance 情境不同，不能合併為同一負載的樣本 |
| Pick（全數正常揀貨，供 Cancel 準備） | 8,049.20ms | 530 + 205 = 735 | 沒有 Short release；與下一列負載不同 |
| Pick（4,999 Short + 1 正常） | 13,420.12ms | 757 + 25,454 = 26,211 | ownerFacts 1,570.25ms；completeGuard 1,624.59ms；preclaim 1,148.55ms；releasePost 2,246.67ms |
| Cancel（已揀 5,000 allocations） | 11,929.69ms | 759 + 25,261 = 26,020 | ownerFacts 1,554.87ms；fullGuard 1,662.39ms；preclaim 1,140.80ms；releasePost 2,225.82ms |
| Reallocate（釋放 5,000 + 新增 5,000） | 9,230.15ms | 5,847 + 40,511 = 46,358 | prepare 249.76ms；preclaim 1,706.05ms／15,007 SQL；Inventory post 4,484.15ms／30,533 SQL；current proof 373.78ms |

Pick 兩個末批故障、Cancel 三個末批故障及 Reallocate 最後 projection 故障，均被精確識別為預期原生注入錯誤，原有 50 批斷言及完整 rollback 對帳通過。最慢的這類交易為 Pick audit 注入的 13,591.48ms；不能稱為產品逾時。這亦未證明舊 CI 的 0／50 正是 timeout，舊 CI 沒有精確 cause 證據。

5,000 balances 的 ALLOCATE preview 20 樣本 P95 807.86ms／max 808.98ms、每次最多 180 SQL；REALLOCATE preview P95 5,398.61ms／max 5,756.23ms、每次最多 411 SQL。另有 first／middle 選取及三次各用途真 HTTP 證明，全部通過、零 DML。REALLOCATE 的 22 次直接呼叫（含兩個 selector）的 owner inclusive 合計 86,012.22ms，占這 22 次總時間 113,045.31ms 約 76.1%；不是單次 86 秒交易，也不是純 SQL 執行時間。

## 已知瓶頸與仍未證實之處

實測已定位到重的 owner 路徑：寫入有大量逐 member／leg SQL 往返；Reallocate preview 則主要在 owner 的完整 release-aware 驗證。source 可見 operation member／leg claim、逐筆 CAS／allocation 建立、每 member 候選查詢；這些都是安全／追蹤契約的一部分，不能直接省略。亦可見部分驗證使用反覆陣列搜尋，但本輪沒有分離其 CPU 成本，不能聲稱它已是 CI 超時根因。

**本機沒有重現 CI 的 20 秒超時，不能宣稱 coverage 是根因、產品已修好或 CI 已通過。** 未選擇或實作任何產品優化。下一個最小診斷步驟是把已覆核的同一組診斷及 Queue 已確認修正帶到原有 CI workflow，取得失敗 runner 上的實際階段／SQL 次數；不改 workflow、負載、門檻或 coverage，也不為 P0／P1 名稱去重重跑已完成的本機完整集合。當前候選 CI、其餘 Gate 與 draft PR 仍待完成。

完整 raw log、parsed transactions／provider aggregates、環境與來源快照、cleanup 及獨立覆核收據保存在 private `fulfillment-p1-runtime`。這些是 developer 診斷證據，不作正式 TC／NFR／UAT 接受結論。

## 診斷候選基線

新增 namespace 的 manifest allowlist 與 NFR-023 原批准引用的機械承繼，產生 DESIGN `f7902ae0f02984b5feeb8cb02d5893c57820e99b1e90c471b6f6044305270584`、PLAN `82e58fbf999fb9418584a1cf764803e3cc2f6e434489d7d71d3430d237133f97`；source fingerprint `6fb7a3e02fc7b720f4a44f02c9279e14557d94af15ccb17ceaad02c8810f15e5`。APR-158–161 僅如實記錄本次實際 A 及既有 P1／HD／NFR-023 批准的範圍承繼，不稱為 Sam 看過新 hash，不新增政策或豁免。原批准、run、失敗及 mode-entry commit 全數保留。

全域 lint 通過，traceability 結構及 state 一致性通過；module boundary 以已整合的 default `f104bd848b78b415595906f852962ae17dd3f7ba` 通過。原 mode-entry 跨越已整合 main 歷史，會包含其他模塊改動，未藉此擴大 allowed paths。這些均不等於完整 developer Gate／當前 CI／Phase PASS；DEF-022／023／024 仍 OPEN。

# 當前候選 CI 失敗：依指令暫停

候選 `dc46b48ba28a08f1e0d1bf1ca9e205bbbf73092f` 的 [CI 40464059084](https://github.com/crazysumsum/erp-app/actions/runs/40464059084) 已完成，結果 FAILURE。依 Sam「當前候選效能測試失敗／逾時立即停下、保存與清理、說明並等待決定」的指令，未修改 source／profile／門檻、未重跑、未建立 PR。

## 實際失敗

| 類別 | 案例／位置 | 已知與未確定事項 |
|---|---|---|
| 20 秒交易 watchdog | HD024：100 行／5,000 member／5,000 balances | 確認 `DATABASE_TRANSACTION_TIMEOUT`。Allocate 用途 preview 的 20 樣本、first／middle 及 HTTP 已完成；其後的真實 Allocate 準備或 Reallocate preview／selector／HTTP 哪個交易超時，現有 timer-only stack 無法定位。 |
| 20 秒交易 watchdog | 5,000 筆已揀 Allocation 的取消容量情境 | 確認 `DATABASE_TRANSACTION_TIMEOUT`。案例包含 Create／Allocate／Pick 準備、故障注入及最終 Cancel；現有 stack 無法證明是最終 Cancel 自身超時。 |
| rollback 批次證明 | 5,000 member Pick | projection batch counter 為 0，預期 50；`assert.rejects` 吸收了上游錯誤，原因尚未確定，不能直接算作另一個已證實 timeout。 |
| rollback 批次證明 | 5,000 member Reallocate | 同樣為 0／50；上游原因尚未確定。 |
| fixture 連線 | Queue HTTP integration 第 126 行 | 第三處獨立 `createApplication` 仍只覆寫 child database name，沿用沒有該 UUID 子庫權限的 `erp_user`，啟動 health check 得到 `ER_DBACCESS_DENIED_ERROR`。前兩處修正未涵蓋此處；未在暫停後修正。 |
| repository convention | `handlerConventions.test.js` | `ListFulfillmentQueueHandler` 位於 `handlers/fulfillments`，但已批准路由是 `/api/v1/fulfillment-queue`。未改動路由、handler 或測試以繞過要求。 |

前兩個案例的 77.640／40.640 秒是**整個案例**耗時，包含準備及多個交易，不能報成單一操作耗時。兩者的交易設定仍為 20,000ms；不是 Node 的 300／180 秒 whole-test timeout。

CI 使用 `--experimental-test-coverage` 與四個獨立 shard；MySQL log 顯示 runner 4 CPU、約 16GB RAM。這與本機 developer 執行有差異，但尚未建立 instrumentation、SQL、CPU 或鎖等待的因果關係，不能宣稱根因只是 coverage。

## 已保留的結果

- 本機七個必要 developer 契約均曾在其真實基線通過；P0／P1 backend 各 542 PASS、P0／P1 browser 各 2 PASS，原件不追溯修改。
- 當前 CI 的 lint、build、audit、client coverage、既有瀏覽器及 TC-042 已通過。
- Shard 1：967 cases，958 pass／3 fail／6 skip；Shard 3：1,176 cases，1,082 pass／3 fail／91 skip。這是全域 CI 的實際摘要，不冒充本機 P0／P1 零 skip 契約；本輪未新增 skip。
- 本候選的 TC-032 及新 P1 真瀏覽器步驟因 shard 1 前一步失敗而未執行，不能引用 main 的舊綠燈或本機 browser PASS 代替。
- P1 browser report upload 的缺檔失敗是未執行 browser 步驟的衍生結果。

Shard 1 原始 decoded log：299,699 bytes，SHA `9b83d07eb92ada8fadf8fcd2fdb4fa8e1e5b99e996fbde7d396d0c772657465d`。Shard 3：328,080 bytes，SHA `59d2270e5b070c1b94cae9205c9b281e6e3f295f727e69027680463a8bf55f48`。完整 log 與 triage 保存在本機 private runtime；不另行發布 raw logs／trace。

## 暫停與恢復條件

CI 已自行完成，無需再取消；本機 synthetic schema／MySQL／web apps 已精確清理，datadir、全部證據及分支保留。當前 source 指紋仍為 `6bbf59686c17482e07fe855a29616707e9d8531e6b2b7e48bbe6c38d0b034daf`，沒有另造治理候選或重跑 CI。

Sam 的 P0／P1 去重指令已從 project manager chat 的真實 user message `01a17c33-9b60-7011-8fda-9a74a2bad727` 核對。兩份真實 542 PASS 原件及已完成的只讀等價觀察保留（receipt SHA `18f496f6b5d1ecc816e82736945db2a3b4de0df1a26deb9a41fe90d327469718`）；去重實作亦暫停，不為去重再跑同一測試集合。

建議恢復後先針對上述失敗情境加入分階段計時、SQL 次數及故障注入的明確錯誤辨識，先定位再選擇優化；Queue fixture／目錄 convention 修正另行保留完整公開契約。此為待決方案，未開始修改或執行。所有 5,000 筆、20 秒、安全、coverage 與當前 CI 要求保持，等待 Sam 的實際處置。

## 後續處置

Sam 已實際批准上述方案 A，已按限定範圍恢復；修正、獨立覆核及一次 coverage 診斷結果見 [分階段診斷記錄](61_ci_capacity_stage_diagnostics.md)。本文件保留原暫停時的觀察，不將後續本機 PASS 覆寫成原 CI PASS。

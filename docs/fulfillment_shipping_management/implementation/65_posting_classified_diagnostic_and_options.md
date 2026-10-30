# Posting 分類診斷及具體優化選項

## 授權與範圍

Sam 已實際指示：「先補 posting 內部分類計時及 SQL 次數……完成獨立覆核後針對性量測，再提出具體優化方案，暫不合併 PR #297。」本輪只實作測試限定診斷及一次量測，未實作以下任何優化，沒有修改產品、業務 SQL、schema、鎖序、RC、CAS、權限、client 或 workflow，也沒有 commit／push／重跑 CI／合併。

HEAD e54a53984a3fbfc15c9c1bbd94f7b9c46af27949、PLAN 142a24e513c6889dcd6da31cc5c7313f98d1e937a50998ff56c0a45025c4b23e；本次未提交的 test-only source FP bd214c427bdf428f0c4ca4d088eb616a0e1bcd83915d868575a5b5eeb2c24012。不能把歷史 CI／完整 developer 報告重新標成這個診斷工作區的新資格。

## 診斷可信度與實際執行

17 個單元／契約、23 個 collector positive／negative cases、實際 5 modules／13 targets preload smoke 通過；獨立准入覆核 0 C/H/M，receipt SHA 0c43799ea1b5b4bd3ae49a901f0ce8e94199011dd0efe599cc344b29f56c852f。原診斷工具的缺失 capture、交疊 exclusive 歸因、合法缺表探測資格及 parent identity 問題均在量測前修正並純驗證；原 RED／失敗紀錄保留，沒有改寫成 PASS。

測試限定 preload 只在明確 --import 時啟用，以 SHA／AST 種類及唯一命中綁定 5 個產品模組的 13 個觀察位置。加入觀察包覆後，移除包覆的完整 business AST 與原件相同；原產品檔案沒有修改。正常產品不 import 這些 test helpers。原兩個容量案例移除新增的兩行診斷即逐 byte 等於 HEAD；原 parent helper 只增一個 WeakMap accessor，其餘逐 byte 相同。SQL／所有業務斷言完整保留。

一次實際量測：2026-10-28 07:45:06.077177 至 07:46:59.707535 UTC，約 113.63 秒。原 100／5,000 Balance 兩個完整案例在原 test-concurrency=1／coverage 下執行，**2 PASS／0 fail／0 cancel／0 skip**；4 個 purpose／fixture 組合各 20 樣本，共 80 樣本、98 個完整 parent transactions，5/13 source proofs 與每個 posting 的實際 parent ordinal26／ALLOCATE_SETUP／20,000ms 綁定全部通過。原 20 秒交易、300 秒 case、5,000 規模、零 DML preview、HTTP、first／middle selector及數量／版本等斷言均未減少。

Collector 結果 VALID／issues=[]；source／HEAD／PLAN／7 個私有工具在執行前後不變。它會拒絕缺 proof、父交易集合不完整、無 span、錯 parent、omission、observerInvalid、重疊／未結束及非原 SQL 次數，不能僅以 native exit0 冒充有效量測。原 Stocktake probe 的一筆 ER_NO_SUCH_TABLE 保留為 failed1；只有原 schema query 真實確認兩表皆缺、原 owner 合法處理且全案成功才資格化，不完整／未知 schema 或其他錯誤／timeout 仍拒絕。

原始 stdout 144,325 bytes，SHA b5fe03ac19e6363c2f8c827fbb3c8304524ba2aea677129b8d42b5ea515fc766；stderr 為 0 bytes。5 個 loader proof 實際位於 stdout，collector 掃描兩流；不臆稱 framework 合併了 stream。原件及分類 JSON 保留私有 runtime，不上傳 raw logs／參數／資料列／token。

首次啟動只在 preflight 因本地 execution ledger 預先 STARTED 而遭拒：當時 start／result 不存在、Node／native／容量未執行。已保存 no-start 證明並修正帳本；沒有改 reviewed runner 或降低驗證，真正量測僅上述一次，不是容量重跑求綠。

## 實測瓶頸

以下是**本機、含診斷開銷的一輪**，Node 26.6.0／MySQL 26.7.0，socket-only 專用 synthetic 庫；原 128MiB buffer pool／100MiB redo 設定未調整。不是原 GitHub 4CPU／Node26.12.1 runner，不能把本機 9.03 秒相對原 CI 19.97 秒稱作優化成果；本輪沒有產品優化，也不能精確逐秒回填舊 CI 內部耗時。

兩個 owner posting profile 都是 100／5,000 Balance 案例的真正 **ALLOCATE_SETUP**；案例後段的 REALLOCATE 是唯讀 preview，沒有執行 Reallocate writer。因此以下分類定位的是 Allocation 準備路徑，不能據此宣稱已定位或解決 PR 的兩個 Reallocate watchdog，也沒有量到其 Release／currentProof 階段。

| 不重疊的 owner posting 分類 | 5,000 Balance 實測 | client SQL 次數 |
|---|---:|---:|
| 完整 scope／Balance 等鎖定 | 1,087.483ms | 21 |
| 候選讀取及選擇判斷（含排序） | **3,322.144ms** | **5,000** |
| Balance CAS／Allocation INSERT／Reservation CAS | 1,514.390ms | 15,000 |
| Audit record／validation／flush（含最後 empty flush） | 225.341ms | 50 |
| Operation receipt completion | 375.910ms | 101 |
| Receipt 讀回及驗證 | 108.564ms | 103 |
| 其餘 owner 授權／loop／wrapper 差額 | 78.209ms | 3 |
| **owner posting 總計** | **6,712.041ms** | **20,278** |

此表把 nested 子項合併，不再重加以下細項：

- **候選 SELECT：5,000 次，共 3,111.273ms，最多單次 5.891ms，實際返回 127,500 rows。** 候選 JavaScript sort 5,000 次共 91.881ms，已與 SQL await wall time 分開。最大累計讀取成本在重複候選 SQL，JavaScript sort 並非本機主要成本。
- **Balance upsert：1 次、148.634ms；5,000 複合 OR 的 FOR UPDATE：1 次、845.395ms。** 後者是本輪最慢的單次 SQL，但累計仍小於候選 5,000 次讀取。affectedRows 不能解讀為實際插入／物理寫入行數。
- 三類逐筆寫入各 5,000 次，分別 459.940／517.088／537.362ms；成功 audit 已是 50 個 100-row INSERT 批（flush span51次含最後空 flush），receipt completion 已是 100 個 child/member batch＋1 root，不是尚未做的批次優化。
- 兩個 posting 都仍是 5,124 query＋15,154 execute；數字是 executor client 呼叫，不含 BEGIN／COMMIT／trigger 內部 SQL。SQL／span 時間是 client wall time，包含 driver／等待／JS／GC／觀察開銷，不等於 server execution time或純 CPU。

| 同輪對照 | 100 Balance | 5,000 Balance |
|---|---:|---:|
| 完整 Allocation 主交易 | 5,862.412ms | 9,032.428ms |
| owner posting | 3,530.277ms | 6,712.041ms |
| 候選 SELECT 累計 | 907.564ms | 3,111.273ms |
| 候選實際返回 rows | 5,000 | 127,500 |
| JavaScript sort | 6.249ms | 91.881ms |
| Balance lock 子步驟（含 upsert＋SELECT） | 4.465ms | 995.196ms |

兩個 posting 的 SQL 次數一樣。Balance 分散後，增加主要集中在候選查詢／回傳資料及大型 Balance 鎖定；其他組稍快／慢，不能把 nested span 或單輪差值當作線性因果／穩定 P95。之前 127,500 row-visits 的靜態推導，這次已由返回行數計數確認。

## 優先方案 A：Inventory owner 的鎖定後、同交易候選 budget（建議；尚未批准實作）

改動焦點為 inventoryFulfillmentAllocation.js 的 posting 候選 reader；不是 UI 自算、公開 API 改名，也不是沿用鎖前的 preparation／preview cache。

1. 原有 scope／root claims、Sales／Fulfillment／master 及 Warehouse→StockControl→Bin→Lot→Balance→Reservation→Allocation 鎖定與 fresh facts 全部保留。ALLOCATE 在完成該鎖階段後才建立新的 owner candidate pages。若同一機制涵蓋 REALLOCATE，必須等原有全部自身 Release 真正成功後才載入，基準是已釋放後的真實 physical free，不能再加一次 own-release credit；RELEASE-only 原路徑保持。
2. 使用 bounded lazy pages，key 至少包括 Warehouse、SKU、日期／minimum remaining days、tracking policy、physical page／目前 stage。不同 Reservation 的 policy 不可只因 SKU 相同便混用，也不能一次載入整倉或跨交易保存。
3. 按既有 Line／Reservation 排序，僅按使用者實際成功寫入的選擇扣量。每次原 Balance CAS 成功後同步更新本交易 candidate view 的 free quantity、version及 membership；耗盡後每個 member 重新判斷 first／rank／FIFO／FEFO／例外原因。保留初始 expectedVersion 檢查及每一筆真正 CAS，不把初始 rank／version 當作後續目前值。
   寫入亦會改變 SQL 可用量過濾後的 OFFSET 頁面；新頁須與目前有效前綴、fresh baseline 及 version generation 對齊，不可重用過期 offset，或再扣已反映於 DB 的歷史使用量。不能直接套用唯讀 preview 的 virtualPages；跨頁與 cache eviction 的正確演算法仍須先設計及證明。
4. **先由 Inventory owner 證明完整候選穩定性。** 包括未選中的 Bin／Lot／Stocktake／Item eligibility 等所有相關 writers，不能只以 selected rows 已鎖便推定安全。若實際 anchors 不足以保護某項資料，必須保留必要 fresh revalidation 或不採用此快取，不能靠假設刪掉檢查。
5. 本 fixture 每 SKU50個 Balance、每頁上限100且同 policy，理論可把候選 SELECT 5,000→100（少4,900）、返回 rows 127,500→5,000；owner total calls 20,278→15,378，三類逐筆寫入及全部 audit／operation 身份均不變。這是**數量目標，尚無實作後秒數**，不保證所有合法不同 policy／跨頁／手動選擇都有固定100次查詢。

實作前需明確選擇／獨立設計覆核這項 owner 讀取策略，不能把舊 fresh-map/no-SQL 方案 A 或本次「診斷」授權當作已批准。驗證需涵蓋共享庫存跨 Claim、實際手動偏離、耗盡／跨頁重排、多 policy、同 Balance連續版本、完整來源／Stocktake partial schema拒絕、未選候選並發變更、原生雙連線、末批 rollback／exact replay及全數量對帳；原 5,000／20s／300s／樣本／coverage Gate 全保留。最後仍須當前候選 CI，不能以本機量測結案原 HIGH。

## 方案 B：只改善 Fulfillment 已存在 Balance 的取鎖查詢（第二優先）

研究 Inventory owner 的 existing-ID 路徑，避免該條 5,000 複合 OR SELECT，例如以已驗證的 Balance IDs 取得完整目前行，再保持原自然鍵 identity／exact-set／鎖類別與順序／CAS。先保留原 upsert 及所有 guards，不順便改通用 create-if-absent 語意；是否可安全取代 query plan、實際鎖取得順序及 shared owner 介面，須原生並發／query plan證明及明確批准。已量到單條 845ms 的成本，但尚未量新方案能省多少。

本機 audit／receipt 成本合計不足候選讀取，不建議重寫；Reservation／Balance CAS 或 operation claim 批次化的資料語意／generated ID／版本／末批失敗面較大，先不選它們。

## 現況與停止邊界

兩個實際案例及 capture 本輪成功，沒有新的容量／效能失敗；並非 PR CI 已修好。[PR #297](https://github.com/crazysumsum/erp-app/pull/297) 仍應保持 DRAFT／不合併；已知最新整合 run40632110878 的 Reallocate watchdog、DEF-022／025 HIGH 仍開啟，TASK-017／022 未完成。正式 NFR／UAT／發布未執行。本輪專用 base／帳號已刪除、所有 child／clients 歸零後自有 MySQL正常關閉，datadir及證據保留。

分析結果及未採納方案正文（SHA 767f8d1fc698ce6919c3b9d63b2ab1acda1076829c3090158f3638676ee3bdea）已由 /root/fulfillment_independent_review 獨立覆核，0 C/H/M；receipt 為私有 runtime 的 independent-posting-diagnostic-results-and-unadopted-options-review.json，SHA 3fceb600528dfd19f4761c29a4dd1e83c2850fbe31c0787a14ed6c29b2dad685。Reviewer 只讀重解析原 log，未重跑容量／DB。此項覆核僅涵蓋診斷結果與未採納方案，不是產品完整 Gate 或實作批准。無任何效能優化已被採納；後續若獲實作授權，任何真正容量／效能失敗仍須停報，不放寬門檻或盲目重跑。

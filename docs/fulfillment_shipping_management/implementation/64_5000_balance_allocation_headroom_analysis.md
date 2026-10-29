# 5,000 Balance Allocation 準備交易：分析及餘裕建議

本輪依 Sam 指令先分析並提出建議；不實作效能改動、不重跑 benchmark／CI、不合併 PR #297。產品／測試／SQL／schema／鎖序／RC／權限／CAS／20 秒限制／5,000 規模／coverage／原 Gate 均未改動。

## 這筆交易實際在做甚麼

來源為 branch CI 40628810071、exact e54a53984a3fbfc15c9c1bbd94f7b9c46af27949，shard1 原始 log SHA 255ce95d315373ec70900def93f4f6967908e3162d6dcefa5ff25be11d8fd562。test 是 `fulfillmentAllocationPreviewCapacity.integration.test.js` 的 5,000 balances 變體。

`ALLOCATE_SETUP` 是測試階段名稱：先完成 ALLOCATE preview，再呼叫真正的 `FulfillmentAllocationService.allocate`，建立 Allocation，讓後面的 REALLOCATE preview 有自身可釋放額度。它不是只造 fixture、不是重新 Confirm SO，也不是重新建立 Reservation。100 SO SKU lines × 每行 50 個已存在 Reservation／Claim，共 5,000；每 SKU 有 50 個 Balance、每個 1 件，合計 5,000 個 Balance。100 Balance 對照則每 SKU 一個 Balance、每個 50 件，需求／Reservation／Allocation 數量相同。

主交易 ordinal26 實際 elapsed 19,968.595ms；callback settle 累計 19,797.435ms；兩者差 171.160ms 包括提交及框架收尾，沒有逐條 COMMIT 計時，不能全部稱作 commit SQL。外層 phase 19,994.380ms 另含服務回傳 detail 的獨立只讀交易 ordinal27（13.931ms）及其他呼叫開銷，不能混用。主交易距 20,000ms 僅 31.405ms。

## 已實測的步驟及 SQL 次數

| 範圍 | 包覆耗時 | SELECT／query | execute | 合計 client calls |
|---|---:|---:|---:|---:|
| Inventory posting、完成 operation 及讀回 receipt | 14,977.130ms | 5,124 | 15,154 | 20,278 |
| 前置 operation scope／root／member／leg claim | 2,439.436ms | 4 | 10,003 | 10,007 |
| Sales 行／來源鎖定 | 459.993ms | 11 | 0 | 11 |
| Allocation preparation／推薦初驗 | 322.885ms | 108 | 0 | 108 |
| posting 後 fresh Reservation proof | 132.746ms | 13 | 0 | 13 |
| Sales source facts | 31.924ms | 3 | 0 | 3 |
| 其餘 Fulfillment 檢查、投影及交易外框（差額） | 1,604.482ms | 49 | 205 | 254 |
| **主交易總計** | **19,968.595ms** | **5,312** | **25,362** | **30,674** |

六個 provider 在這條命令依次呼叫；每格是 client 包覆耗時，混合 DB／等待／CPU／序列化，不能解讀為純 SQL server 時間。診斷只計實際 executor 的 query／execute 呼叫，排除 framework BEGIN／COMMIT 等控制 SQL、trigger 內部語句及其他 DB instance；也不是行數。主交易依語句首字分類為 SELECT 5,312、INSERT 15,108、UPDATE 10,254；multi-row 與 INSERT ON DUPLICATE KEY 的實際行效果不能用這些數字代替。

最慢層已確定為 inventoryPost，約佔交易 75%。同一 run／同一 shard 的 100 Balance 對照交易為 12,955.304ms，inventoryPost 8,019.524ms，兩者的 SELECT／execute 次數完全相同。5,000 Balance 多出的 7,013.291ms，其中 inventoryPost 增加 6,957.606ms（約 99.2%）。這是不同 fixture 的單輪觀察，不是單一 SQL 因果實驗。

## posting 內的程式碼歸因及未知處

`postFulfillmentAllocationBatch` 先完整 lockAllocationSet，然後逐個 member 呼叫 selection → assessFulfillmentAllocationSelection → loadInventoryCandidates。這個成功 fixture 有 5,000 members，每次一頁便足夠，因此有 5,000 次候選 SELECT；preparation 已有本次讀取共享 virtualPages，posting 本身仍每個 member 重查。

在本 fixture，每 SKU 的候選庫存依次由 50 個非零 Balance 減到 1 個。按程式與資料可推導：重複 candidate row-visits 合計 100 × (50+49+…+1)＝127,500；100 Balance 對照為約 5,000。這是靜態推導，並未實測 rows examined／returned／server sort time。每次讀取仍有 Bin／Lot JOIN、有效性／效期／stocktake 檢查、FIFO／FEFO 排序及 DTO／JS rank 處理。

15,154 次 posting execute 可對上現有控制流：5,000 Balance CAS UPDATE、5,000 Allocation INSERT、5,000 Reservation version CAS UPDATE；50 個成功 audit INSERT 批、100 個 member／leg completion UPDATE 批及 1 root completion；另外 2 個 StockControl upsert 及 1 個 Balance upsert。每筆原有紀錄及安全檢查均保留。audit／completion 已各最多 100 筆成批，不能把它們再次批次化冒充尚未做的優化。

另一個應細分的可能成本是 InventoryLockService.upsertAndLockBalances：5,000 個 VALUES 的 upsert，加一條 5,000 個複合 OR、按原 natural key 排序的 FOR UPDATE。雖只計成少數 client calls，仍可能有昂貴的 plan／掃描／FK／trigger／鎖處理。**現有 log 沒有單條 SQL 或這些內部子步驟的計時，不能聲稱 14.98 秒全由 5,000 次候選 SELECT 造成，也不能證實缺索引、純 commit、pool 排隊或 coverage 是根因。**

## 建議次序（尚未採納／實作）

1. **先補 posting 內的精確分類診斷。** 分開計時：Balance upsert／完整鎖定；候選 SQL 及 JS 排序；Balance CAS／Allocation INSERT／Reservation CAS；audit flush；operation completion／receipt decode；交易 callback 後收尾。記錄次數、累計／最大耗時、返回／影響行數及安全錯誤代碼，不記 SQL 原文／參數／JWT／業務 payload。不要累加巢狀計時當作總耗時。先只用這個 5,000 Balance 失敗風險案例及原 100 Balance 對照定位，保留原負載、coverage 與所有限制；不得為診斷提高或關掉 watchdog。
2. **候選重複讀取是第一個有明確數量空間的優化候選。** 若細分計時確認值得做，研究 Inventory owner 在完成原有 Warehouse／StockControl／Bin／Lot／Balance／Reservation 鎖定後，以新鮮 candidate page 建立本交易共享庫存 budget，只按實際成功寫入的選擇扣量，不能按 default 推薦扣量；同步更新 free quantity／version／耗盡 membership，耗盡後每個 member 的 first／rank／FEFO 判定亦須重新計算。不得重用鎖前 preparation snapshot、跨交易 cache、快取權限／來源 proof，也不能直接把 read-only preview 的 virtual cache 不經證明套進 writer。須先證明所有會改動候選庫存、Bin／Lot／Item eligibility／stocktake 的 writers 均受實際持有的 anchors 保護；這也包括未被選中的候選 Bin／Lot／Stocktake 等；只有 selected rows 被鎖不能自動推出全部候選穩定，不能證明時須保留必要 fresh revalidation。完整 member order、跨頁、耗盡後重排 rank、FIFO／FEFO／例外原因及權限、原 CAS／source／overflow／own-release／receipt 全保留。維持 bounded lazy pages，不能一次載入全倉庫。僅本 fixture 理論可由 5,000 次候選 SELECT 降至 100 個 SKU pages，少 4,900 calls（總數約 30,674→25,774）；**省幾秒尚未量測，這不是所有資料形狀的固定承諾。**
3. **若大 OR 鎖定比候選讀取更重，才優先評估 Fulfillment 的 existing-ID lock 路徑。** 可研究使用已驗證 Balance IDs，在保持原鎖類別／排序、完整 exact-set／自然鍵身份、FK／CAS／fail-closed 的情況下避免巨大 OR。不能改共用 lock service 的其他命令語意、刪掉保護或擅自移除 upsert；須由 Inventory owner 確認完整契約及真實 query plan，再決定是否需要這條變化。
4. **逐筆 CAS／claim 批次化放後面。** 這涉及逐筆版本、同 Balance 多次更新次序、generated IDs／operation 身份及末批失敗原子性；變更面比候選讀取大。前置 claim 本次只佔約 2.44 秒，不應先為它擴大 shared API／receipt 策略。所有未採納的方案仍需獨立覆核及人類對重大介面／資料語意改動的實際選擇，不能從本次「先分析」推定已授權實作。

若將來實作，必須保留缺表／不完整 schema 拒絕、20 秒、100 行／每行 50／合計 5,000、原 20 樣本及 300 秒整案限制、完整權限／fresh read／CAS／FK／unique／trigger／原子 rollback／exact replay／數量對帳／coverage；原生雙連線競爭及最後一批 rollback 仍須驗證，任何真正容量或效能失敗即停報，不以重跑求綠。

## 新發現的 PR 整合 CI 失敗

[PR #297](https://github.com/crazysumsum/erp-app/pull/297) 讀回仍 DRAFT、未合併，feature head e54、base a98。建立前 branch run 40628810071 的 PASS 原件不變，但建立後 [PR run 40632110878](https://github.com/crazysumsum/erp-app/actions/runs/40632110878) 已完成 FAILURE；兩份實際 job log 均 checkout integration commit `22b1742b8b65f1072f4ad19e5d2e4e1210ca6fdf`。最新結果必須反映為不具合併資格，不能沿用舊綠燈。

- HTTP 5,000 members：Allocate 200／16,147.729ms，隨後 Reallocate 500／20,115.181ms；真實 HTTP app 的 route-bound Reallocate transaction 記錄 `DATABASE_TRANSACTION_TIMEOUT`，elapsed 20,002.592ms、5,413 query＋40,256 execute。這次可證實 500 對應 watchdog，不能追溯當作舊 79aef HTTP500 的已知原因。後續 Pick／rollback／replay未完成。
- 原生 Reallocate rollback：transaction elapsed 20,053.780ms、5,841 query＋40,257 execute，watchdog；inventoryPost 12,177.549ms，接下來 ownerCurrentProof 853.590ms 未完成，沒有到達本來要求的精確 synthetic 45000 末批故障。不能把 watchdog 當作預期 rollback PASS。
- 原 5,000 Balance preview 的 shard1 本輪仍 SUCCESS，不能把以上兩宗 Reallocate 失敗說成它再次失敗，也不能把整案 47.86／42.25 秒說成單一交易時間。

這是新整合候選／執行環境的實際失敗，未證實 main 差異、runner 或 coverage 哪一項為唯一原因。原始兩個 log、解析紀錄與 final API 均保存在 private runtime；不修改或上傳原始敏感證據。沒有重跑、修正 source／tests、推送或合併。現有 HIGH 容量缺陷須重新打開；本輪只完成 Sam 新授權的分析及建議，實作等待另行選擇。

# 同交易 posting 候選共用 — 方案 A

## 授權及基線

Sam 於 2026-10-29 明確指示「按建議方案執行」，承接報告65及其後具體方案A。此為 Inventory owner 內部讀取策略，保留全部原有 source／permission／quantity／CAS／鎖序／schema／rollback／replay／audit／receipt 驗證及 20 秒限制。方案B未選；PR297不合併。任何實際容量／效能失敗仍停報，不盲目重跑。原最新 PR CI40632110878 FAIL、HIGH022／025 OPEN，不因本修改自動結案。

HEAD e54a53984a3fbfc15c9c1bbd94f7b9c46af27949，PLAN142a24e513c6889dcd6da31cc5c7313f98d1e937a50998ff56c0a45025c4b23e，DESIGNf7902ae0f02984b5feeb8cb02d5893c57820e99b1e90c471b6f6044305270584。原診斷 FPbd214及報告65證據保留，不冒稱新候選資格。

## 最小演算法（方向覆核通過；source／原生驗證另列）

- 每次 postFulfillmentAllocationBatch 完成原有 lockAllocationSet 和全部 RELEASE 寫入後，建立一個閉包；RELEASE-only不建立候選。所有讀取仍用原 loadInventoryCandidates SQL／schema fallback，初次頁面是鎖定後的真正 RC fresh read。
- closure 使用已鎖定、由 writer 真正 CAS 成功後更新的 leg.balance object 索引，讓各 policy／日期 view 共用 current free quantity／version。未選中的候選使用實際讀取的 facts；不預扣推薦量、不重用 preparation／preview cache、不加虛擬 Release credit。
- key 包含 warehouse／SKU／date／minimum days／tracking。各 key 保存原順序的 prefix，每次讀取以目前 Balance facts 投影、去除耗盡行，再 slice 該次的目前 offset／limit。延伸 prefix 時，原 SQL 的 offset 是仍可用 prefix 行數，而非歷史頁數；自身寫入只移除候選、排序鍵保持，故新頁緊接目前有效 prefix。
- 完整 prefix 保留已耗盡行以支援去重及不變性。所有 key 合計最多5,000 cached rows；超出時清除 cache 並對該讀取使用原 fresh reader，沒有新拒絕門檻。空結果不積累空 key。各 Balance quantity／version 只有 writer 既有 CAS 改動；cache 不寫 DB。
- 獨立核實現有 Warehouse X 排除 Bin master／stock membership writers，Item owner讀鎖固定 policy；Lot eligibility／sort欄目前沒有 production UPDATE writer（不冒稱 DB trigger 強制不可變）。Stocktake目前沒有可證明 anchor 的實作 writer，因此僅原 loader 已確認同一 active executor 的兩表皆缺時才共用；tables present／unknown 每次原 fresh reader，partial schema仍拒絕。新增 owner內部 WeakSet proof accessor同時檢查實際active metadata；closed／timeout不共用，且不同executor不重用prefix。

## 驗證次序

1. 純差分測試：與原 fresh reader 比對耗盡、跨頁／超過5,000 prefix、跨 policy 共用量及版本、手動選擇與 rank、unknown rows及原錯誤。
2. 獨立設計／source覆核，原生並發及 correctness／末批 rollback／replay 回歸。
3. 原100／5,000 Balance完整案例（20樣本／原coverage）及曾失敗的真實Reallocate writer容量／HTTP案例；分階段計時與SQL次數。更新診斷 source pins 僅綁定新產品 bytes，保留原基線與所有歷史結果。Collector的舊固定5,000查詢預期不能冒充新候選驗收，須明確審核新的計數／原始完整性條件。
4. 完整 developer驗證、獨立結果覆核、當前候選 CI；未完成前不得宣稱 P1全部完成或修好原CI。

## 實作與覆核紀錄

方向覆核 receipt independent-posting-candidate-budget-direction-review.json，SHA e85759a9e92988d5ec9dfb9337489498e7212267e72073da1656aa3542c6ce63，0 C/H/M，僅條件准入。

初版13個差分測試已通過；診斷／parent合計30個純測試通過，0 skip。曾有一個測試fixture將內部要求的字串ID錯寫成number，修正型別後按同一原斷言驗證；失敗log保留。Reviewer另找到active-proof MEDIUM：WeakSet在executor關閉後仍記錄原物件，原helper可於cache hit略過active檢查；已補actual active metadata及所有proof-loss fresh路徑、跨executor隔離，RED repro／GREEN測試保留。不是容量失敗，尚未執行任何本輪原生／容量量測。

新增native correctness案例涵蓋雙連線 Warehouse NOWAIT、實際closed executor proof失效、Stocktake present fresh及partial拒絕；已實際執行一次2 PASS／0 FAIL／0 SKIP，保留coverage。原始紀錄 budget-a-native-correctness.log/json。產品沒有修改業務SQL、schema、鎖序、CAS、audit或receipt；原診斷source pins僅更新到新的實際產品bytes，原runtime歷史pins保留。

## 結果

尚未完成，所有原 Gate 保留。

本輪環境歷史：首次 sandbox 中 MySQL init SIGSEGV，尚未建立DB／帳號或執行native；原pub／logs保留於 budget-a-startup-failure-before-db。確認程序已死、socket／pid／privateenv不存在後，使用既有授權在允許啟動的環境恢復，仍原socket-only／128MiB／100MiB；新base c9dd4a1d／base-only帳號。另copy runner沿用舊p1diag guard造成一次Node前preflight拒絕；已改為精確p1post且比對public receipt，原失敗保留。這些不是產品或容量結果；不改寫成PASS。原生command只實際執行上述一次。私有runner亦補receipt O_EXCL／0600避免重複label覆蓋，原正常結果保留。

## 原兩個容量案例實際結果

本輪一次實際執行於2026-10-29 01:01:10–01:02:51 UTC，原兩個完整case 2 PASS／0 FAIL／0 SKIP，80樣本／98 parent transactions，strict capture VALID／issues=[]，source／HEAD／PLAN／8 private hashes不變。原20秒、300秒、5,000規模、零DML preview及所有斷言保留。

| 5,000 Balance 本機含診斷開銷 | 報告65舊基線 | 本輪方案A |
|---|---:|---:|
| 完整 Allocation 主交易 | 9,032.428ms | 5,562.812ms |
| owner provider 整體 | 6,712.041ms | 3,305.370ms |
| 候選 SQL | 5,000次／3,111.273ms | 100次／78.768ms |
| 候選返回 rows | 127,500 | 5,000 |
| owner query／execute | 5,124／15,154 | 224／15,154 |
| 完整主交易 query／execute | 5,312／25,362 | 412／25,362 |

100 Balance對照的主交易為4,488.364ms，owner2,289.877ms，候選100次／30.932ms／100 returned rows。原三類逐筆寫入、audit及receipt數量未刪。原最慢Balance取鎖路徑未作方案B修改。這兩次是不同日期的各單輪本機量測，沒有寫入穩定P95／CI成果／秒數保證；確定的結構改善是每個fixture少4,900次候選讀取，不能將原CI19.97秒當作同環境before。

這次 posting 都是 ALLOCATE_SETUP；REALLOCATE後半是唯讀preview，不是實際Reallocate writer，原PR兩個watchdog仍須後續真正writer／HTTP及當前候選CI重新驗證。所有原始result／stdout／stderr及source proofs保留私有runtime，不能以此關閉HIGH或合併。

## 完整原有 developer 及真瀏覽器驗證

同一底層 P0／P1 原生套件只執行一次：578 PASS／0 FAIL／0 SKIP／0 NOT_RUN，96個檔案，evidence/20261029T011008-d465ed47dc84/run.json，source／PLAN不變，不建立另一份假P0 run。原profile完整JUNIT argv本身無coverage旗標，此處不冒稱local全域coverage；當前候選CI仍保留原globalcoverage及floors。原始JUnit先私存，沒有刪掉原報告或刪案例。

本機真正5,000筆命令：Allocate3,257.604ms、Reallocate6,808.291ms、Pick5,166.696ms、Picked Cancel5,214.001ms；HTTP Allocate／Reallocate／Pick 3,594.816／5,853.379／1,585.150ms、全部200。原末批故障辨識、rollback、same-event replay及數量對帳通過；單輪本機結果，不能取代當前CI。

原lint、client build、high-threshold dependency audit均PASS；原P0／P1真Playwright各2 PASS／0 skip，含原真API流程與console/network斷言，不是mock替代。全6suite的direct remediation adapter provenance、命令、counts、tools與原先BLOCKED Gate均保留；不是canonical run_check invocation或formal acceptance。完整結果待獨立review/import，不以本地JSON自證遠端CI。

本輪final專用base／帳號已於零clients／受管children後精確刪除，自有MySQL正常關閉；datadir及證據保留。fresh target觀察：main ef5a61a4a3c71a2b969369fec9a9dbc9cdecf2c7，topic仍e54。incoming Supplier-only內容的獨立影響覆核支持保留已測branch，發布後以真正PR synthetic checkout／parents／最新base及全部必要CI檢查驗證；不冒稱local已驗證merged source fingerprint。未來任何merge前仍須按AGENTS整合及驗證最新target，本輪不merge，不豁免該義務。

完整六份結果、原553案例保留／新增23 pure及2 native、真故障注入辨識、raw artifact／contract／source／PLAN，以及最新main影響均已完成獨立覆核，0 C/H/M。私有receipt independent-budget-a-all-local-results-publication-review.json SHA 994ff9d2fe9818a3b377e4dcc56a3d0764989215a65146cd2309dd3464009e71，准一次凍結commit及正常push以取得現有PR自動CI；不是CI PASS或merge批准。build既有chunk warning、audit 1 low／4 moderate保留。當前候選CI尚未執行，HIGH022／025仍開啟。

# Inventory 返回後的 Fulfillment caller 診斷

## 本輪邊界

Sam 實際授權恢復量測 Inventory posting 完成後的 Fulfillment 投影、audit 及 operation 完成階段，取得具體耗時及 SQL 次數後才提出優化。只改 test helpers／原容量案例的明確診斷啟用行；產品檔案／SQL／鎖／數量／權限／CAS／rollback／replay／schema／120秒case及20秒交易不改。HEAD30d、PLAN142a、DESIGNf790；原CI408失敗／HIGH022025／TASK017022未完成保留。不push、不重跑CI、不merge297。

## 設計

- 沿用現有 test-only ALS observer及SHA／可還原AST loader，以真正 READ COMMITTED 業務 transaction callback作root，綁定既有capacityDiagnostics實際executor WeakMap的parent ordinal／phase／20s。只收 REALLOCATE_ROLLBACK／REALLOCATE 的RC callback；同phase的postcommit RR Inquiry仍由原parent profiler另外列出，不混入。
- 在同一 actual executor 的 Inventory provider成功返回後設一次marker，當下必須無未結SQL／child；callback前段繼續由原parent／provider profiler量測。marker後SQL totals作差值，只有後段span列入分組；未量到的前段／後段gap不冒稱某個SQL的根因。
- 產品仍原樣：只由明確private preload包覆Fulfillment私有projection／audit方法、純receipt/source斷言及真正async operation #complete。succeedInTransaction本身只是return Promise，不能用sync body span冒稱其完整await耗時。
- 完整method/function原body僅包覆trace，剝除wrapper後整個business AST必須與SHA鎖定原件相同。所有SQL仍走原executor，receiver／args／return／原error identity不變，不記SQL text／params／rows／business IDs。
- 分類包含舊allocation projection UPDATE、新projection INSERT、Claim版本CAS、Line版本CAS、Header、history、audit、operation讀／完成；以span包含／exclusive分開，nested不可重複加總。timeline及as-of inFlight時間保留，observer缺失／重疊／omission不能被視為有效量測。
- rollback預期最後projection的原strict45000錯誤；它不應到Header／audit／operation完成。success才要求完整後段。真正timeout必須保留原失敗和未完成span／callback／promise snapshot，停報而不重跑，不能用預期故障的PASS替代。

## 實作前紀錄

開始時尚未執行原生量測，先完成測試限定實作及獨立准入覆核。原full5000 case全部assertions、故障／恢復流程及限制不變，不以縮小fixture或移除rollback來取樣。其後的一次執行結果見下文；本輪沒有採納任何新效能優化。

## 測試限定實作及純驗證

測試 WIP baseline：HEAD `30d442b5082bdcd32b1beffac6219473ebe22a4b`，source fingerprint `9d40549b39f9f5cfd2ff87faa29bfab1d97c78c77af437804bd2537e772e086e`，PLAN `142a24e513c6889dcd6da31cc5c7313f98d1e937a50998ff56c0a45025c4b23e`。這個 fingerprint 包含診斷測試變更；不是原 CI 的 synthetic merge baseline，也不是已提交的新產品候選。

- root 純測試26 PASS；獨立覆核28 PASS（26 repository＋2 private transparency），lint PASS。收集器25個 synthetic 正／負案例 PASS，沒有資料庫或效能取樣。
- reviewer 最初找出 selector lookup／phase getter 及同步 provider throw 的兩項 Medium；現已修正並保存原 RED。observer 錯誤回原 business callback，另以 `selectionFailures` 明確拒絕量測資格；原同步結果／throw identity 保留。獨立 source/pure closing 0 C/H/M，receipt SHA `3c753018ae2b93d5741df2d76839cf7745758f086a724463c7e57d10e9c106b6`。
- 五個產品模塊、十個 function/method body 綁 SHA 與可還原 AST。舊 Inventory 診斷預設五模塊／十三 target 的轉換輸出逐 byte 保持一致。原案例移除兩行明確診斷啟用行後與 HEAD30d 逐 byte 相同。
- 執行只篩選原 `P1 full5000-member Reallocate retains20s and restores the final projection batch before same-event recovery`，開啟原生 Node coverage；原 file 的其他案例不在本次限定量測範圍，不能宣稱全套回歸通過。
- 原資料為一張 SO／一張 Fulfillment、100 SKU 行、每行50筆已成立 Reservation／Claim（各1件），一個 Warehouse／Bin、100 Balance（各50件）。Reallocate 釋放5,000筆舊 Allocation，再建立5,000筆新 Allocation；不建立新 Reservation，不出貨。保留第50批投影故障、完整 rollback、同 event 恢復、累計10,000筆／live5,000筆與所有數量對帳。
- 收集兩個真 RC callback（parent ordinal6 rollback、7成功），保留原8筆 parent transaction；ordinal8 RR Inquiry 分開列示。收集器對跨 phase、錯誤 parent、缺失 target、重複／缺失 SHA、selection failure、負數／NaN、重疊／in-flight、真20秒逾時及錯誤 SQL／batch 數一律拒絕資格。

本階段沒有產品優化、資料庫取樣、CI 重跑、push 或 PR merge。原 CI408失敗及 HIGH022／025、TASK017／022未完成保持。

## 一次原生量測結果

獨立准入 receipt `independent-caller-tail-final-measurement-admission-review.json` SHA `2ed14e4e27d077b6633783ce1039db690008a12b6e8a3b821d973f4efc5c1873`，0 C/H/M。凍結 baseline SHA `024a46d66a52d92ae6ea9ed78805132c8943a824834779063129c4d81a001a6c`。執行一次，原完整案例 **1 PASS／0 FAIL／0 CANCEL／0 SKIP**，coverage 開啟、exit0、collector `VALID`／issues空、source／HEAD／PLAN／9 private files前後未變；沒有重跑。

| 交易 | parent transaction | RC callback root span | Inventory 返回後 tail | tail query／execute |
| --- | ---: | ---: | ---: | ---: |
| ordinal6：原末批投影故障／rollback | 8,604.344ms | 7,975.364ms | 2,025.409ms | 275／100 |
| ordinal7：同事件恢復成功 | 8,243.758ms | 8,223.979ms | 2,168.509ms | 281／254 |

parent 是整筆 `withTransaction` 外層 client wall，包含開啟／完成或 rollback 等交易邊界；root 是實際 callback body。兩個數字不可互代。成功後 RR Inquiry 是 ordinal8，11.091ms／11 query，另列、不計入 RC tail。整個成功 service call含Inquiry為8,261.473ms；整個案例含建資料、初次Allocation、故障及恢復為23,668.864ms，不是單筆交易逾時。

成功交易在 Inventory 返回前約6,055.5ms，尾段約2,168.5ms；尾段535次 client SQL共2,000.468ms，其餘約168.041ms是非 SQL wall（含程式／排程等），不能當成純 CPU。原 parent完整成功交易為947 query＋40,511 execute；root記錄SQL數亦為41,458。Inventory `inventoryPost` 本身3,659.160ms／379 query＋25,254 execute，不在以下 tail 重複計算。

| 成功 tail 階段 | span wall | client SQL數 | SQL wall／備註 |
| --- | ---: | ---: | --- |
| 解析／驗證 Reallocate receipt及新投影 | 30.044ms | 0 | 包含新投影decode21.342ms，不能再加一次 |
| 鎖定及驗證目前 Reservation | 63.749ms | 13 query | 56.018ms |
| 再驗證 Sales／Reservation來源 | 2.786ms | 0 | 不移除 |
| Inventory owner完整舊／新 Allocation proof | 363.450ms | 262 query | 266.181ms；完整驗證10,000筆 |
| Fulfillment receipt／目前 owner對帳 | 12.367ms | 0 | 不移除 |
| **舊5,000筆投影標記 released** | **1,240.194ms** | **50 execute** | **1,237.338ms**；每批100、affected5,000 |
| 新投影＋Claims／Lines版本更新 | 446.268ms | 200 execute | 新投影50 INSERT／337.056ms；Claim50 CAS／92.148ms；Line100 CAS／10.210ms |
| Header／history／成功audit | 直接SQL0.647ms | 1 query＋3 execute | Header0.258、history讀0.147／寫0.109、audit0.132ms |
| 順序偏離 audit method | 0.058ms | 0 | **本案例沒有override，因此0筆；不能推廣為5,000筆override audit的量測** |
| 真正async operation complete | 7.801ms | 5 query＋1 execute | 0.870ms；包括actor／operation狀態／時鐘等SQL及原CAS |

root child及直接SQL以外 tail residual約1.146ms；表內的小量呼叫間隔不硬歸某一函式。所有時間皆是 instrumented client wall，包含trigger、server／driver往返等可能成本，不代表已分離出 server純執行或某個索引的掃描時間。

故障路徑舊投影50 UPDATE全部成功；新投影50 INSERT到第50批原 `ER_SIGNAL_EXCEPTION`／SQLSTATE45000故障，49批affected4,900，之後完整rollback與before facts相等。沒有到達Claim／Line／Header／history／audit／operation完成。移除原trigger後同event成功，原10000歷史／live5000、Reservation outstanding5000／consumed0／released0／version3及20秒設定全部原assertions通過。

本機成功不取代實際 PR CI408的20,001.046ms失敗；兩者runner／整合baseline不同，亦沒有穩定P95或CI回歸已修復的證據。先前CI已完成Inventory owner proof後仍逾時，與本輪已完成的2.17秒本機tail不可直接相減或按比例外推。

## 優化建議（尚未實作）

優先處理**舊投影批次UPDATE**：只50次SQL已用1,237.338ms，佔本機成功tail約57.2%，幾乎全在等待SQL完成；receipt解碼、Fulfillment audit及operation不是本案例主要瓶頸。這個定位已獲量測支持；「原SQL全表／全SO掃描」或「某trigger是根因」尚未獲執行計劃或server等待證據支持。

建議最小方案A：

1. 對這50個UPDATE取得原 `EXPLAIN`／使用索引／估算及實際rows examined、server等待及trigger相關成本，先核對是否反覆掃描同一Fulfillment的完整投影集合。只做隔離合成資料診斷，所有真容量／效能失敗仍停報。
2. 若確有較寬掃描，在原UPDATE明確加入**本批已鎖定100個主鍵的 `id IN (...)` 限定**，繼續以原 `fulfillment_id` 及每筆原id／inventory_version／released_quantity／picked=0的完整OR CAS驗證。`CASE`更新、每批100／50次SQL、affectedRows必須等於batch長度、同一交易、原trigger／FK／數量／鎖序全部保留。這是要縮短每次SQL，不是假稱減少SQL數；不新增schema／公開API／owner介面。
3. 只有執行計劃／實際Rows examined和同尺度量測顯示改善才採納；若原已有效用PK而無益，保留原實作，再單獨評審以derived table等值JOIN逐id／CAS的改寫。**不預先實作較複雜JOIN，也不承諾毫秒／CI保證**。
4. 必須獨立覆核、原末批45000 rollback／完整facts／同event恢復及錯誤版本／來源／數量／picked安全回歸通過，再完整回歸及當前候選CI；保留5,000規模、20秒、coverage及原Gate。這些尚未執行，PR297不合併。

Inventory owner proof的262 query／363.450ms可作後續第二優先候選；本輪不擴大成跨owner批次介面或刪除重讀。audit／operation不建議為這個案例再加新抽象或快取。

## 私有證據及清理

全部原始證據位於 `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p1-runtime`（private0700），沒有export／commit原始log或secret：

| 檔案 | SHA256 |
| --- | --- |
| `caller-tail-measurement-result.json` | `688093d8571774872bcd25c8c9d94e4c1ae88e3328eac83c0ccd2bf91c292613` |
| `caller-tail-measurement.stdout.log` | `7064f6f10f91d4bdb083ca4d7144a9c056334ee1348a29087c58682f34eb5428` |
| `caller-tail-measurement.stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `caller-tail-runtime-public.json` | `0b182d2e9a75bfbda41536f1975e7a4ca98602384b32f71310e06a3b067f6104` |
| `caller-tail-runtime-cleanup.json` | `c571afd0d8ad788a3bcd8a06767f9587d7aba7c0f218fd64c4f91b533975532c` |

已驗證本輪server UUID／datadir／socket／skip_networking、零活躍clients／ownedchildren後，只移除本輪 `fulfillment_p0_p1_cd0c9a30`／`p1post_c997e1e8`，正常停止本輪MySQL、socket／pid已消失；datadir與所有證據保留。本機runtime已清理，不是等待中的背景工作。產品source／原SQL／schema未改；CI未重跑、PR未merge。

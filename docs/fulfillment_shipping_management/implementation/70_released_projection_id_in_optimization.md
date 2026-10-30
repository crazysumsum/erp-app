# 舊投影UPDATE的本批主鍵範圍

Sam 已批准只在原UPDATE加入本批100個已鎖定主鍵的獨立 `id IN (...)`，保留完整CAS、全部安全檢查及20秒。完成獨立覆核後驗證計劃、實讀量及效能；若仍寬掃只提出後續方案，不加索引提示，不合併PR297。

前次報告69原full5000案例已通過及清理：每個phase50UPDATE／affected5000／server examined260000／Handler_read_next250000；成功SQL client1202.884ms／server1164.821ms／trigger100.004ms。原CI408FAIL／HIGH022025OPEN仍保留。HEAD30d／PLAN142a／DESIGNf790不改；本輪是新source候選，不沿用舊PASS作新候選通過。

產品僅改 `FulfillmentAllocationService.#saveReleasedProjections` 的WHERE範圍及對應bind：在fulfillment_id後加入本批ids，再接完整原OR CAS。原CASE欄位、batch100、affectedRows等於batch長度、原資料／版本／released／picked=0驗證不改；無新schema／index／API／隔離級別／hint。原完整snapshot先按PK鎖定active allocations，Inventory owner完成後再投影；新增IN只限定該已鎖定batch，不能取代任何source／數量／owner驗證。

沿用已覆核server診斷，僅更新新source SHA pin及原100列參數由702→802的計量匹配；不改SQL分類／counter規則／原20秒／120秒／故障識別。使用全新private `release-in-*` 工具／runtime／證據前綴，原release-plan及全部失敗原件保留。原整個ReallocationApi integration file的所有functional安全／並發／缺schema／rollback及最後原full5000案例，將在獨立准入後一次執行、coverage開啟；zero skip，沒有縮小容量。純skip-discovery只作原生case數預檢，不算PASS。真正capacity／performance失敗或captureINVALID停報不重試；若仍廣掃則不追加其他優化。

執行前紀錄：當時待獨立source／執行准入；其後的一次量測結果見下文。本輪沒有CI／push／merge。

## 執行前計數校正

獨立覆核發現skip-discovery的24只列出top-level parents；原callback內另有20個 `t.test` 子案例（2＋4＋4＋3＋2＋2＋3），真正整個file的Node footer應為44 tests。已在任何DB／原生執行前修正collector及命令契約為**24主案例＋20子案例＝44 PASS／0 SKIP**；沒有移除、改名或減少原案例／斷言。以原source的AST靜態列舉及另外synthetic Node計數語意44PASS交叉確認，兩者均非native驗證。原24SKIP／0PASS discovery及修正前凍結紀錄保留。產品source與原20秒完全沒有因這次報告計數校正而改動。

## 獨立准入及一次實測

獨立source及執行准入0C/H/M，receipt `independent-release-in-source-final-execution-admission-review.json` SHA `41799fb2c13f793532ca88fdc4f76e1262d0e51c7e193b9e48e96fa901dd1a53`。reviewer實際抽取method body做0／1／100／101等SQL／bind／affectedRows純驗證4 PASS，加diagnostic9／collector53 PASS；完整PK prelocks／current owner／receipt完整性／OR⇒IN／原CASE與CAS均確認，沒有聲稱physical traversal完全相同。

凍結baseline：HEAD `30d442b5082bdcd32b1beffac6219473ebe22a4b`，WIP FP `867e0bcca9a5f75f37db845dea7d627430a95d6cffa457fdeba22441366b6133`，PLAN `142a24e513c6889dcd6da31cc5c7313f98d1e937a50998ff56c0a45025c4b23e`，20 private／10 source hashes，5 module／10 body AST proofs；freeze SHA `7c759747325c589fc723db1a85c53f5c3d1229f5246b7fc278abe220c6026972`。產品blob `32039f6e93e19742354273bdf92e78c2ca6f82076a8d3acb7adb168384cdfffd`，100列SQL指紋 `3c39479e3e6a27c129929ea4588e3985b2b8e78b28755d340e6af6f3d365446e`／802 binds。這是未提交的新source候選，不能叫HEAD30d的CI已通過。

原整個ReallocationApi integration file執行一次：**44 PASS／0 FAIL／0 CANCEL／0 SKIP，exit0，strict collector VALID／issues空／sourceUnchanged true**。原source／版本／數量／權限／FEFO／並發／缺schema／owner contract／projection／Header／audit晚期故障／replay等全部既有案例保留。原full5000 case在同一次執行中只跑一次，coverage開、120秒case／20秒交易不改；strict45000末批故障、before facts完全rollback、同event恢復、10,000歷史／5,000 live及Reservation數量／版本對帳全部原assertions通過。沒有重跑容量或降低任何標準。

### 實讀量仍未降低

| 本次IN候選 | rollback phase | 恢復成功phase |
| --- | ---: | ---: |
| UPDATE次數／affected rows | 50／5,000 | 50／5,000 |
| 每個UPDATE server examined | 5,200 | 5,200 |
| 合計server examined | **260,000** | **260,000** |
| 每批／合計Handler_read_next | 5,000／**250,000** | 5,000／**250,000** |
| 實際target PRIMARY FETCH | 20,004 | 20,004 |
| 實際target idx_ful_allocation_work FETCH | 230,046 | 230,046 |
| 額外無index attribution FETCH | 5,000 | 5,000 |
| owner trigger calls | 5,000 | 5,000 |
| global row-lock waits／time增量 | 0／0ms | 0／0ms |

以上各實讀／UPDATE數與報告69原SQL相同；實際I/O仍為samples1–4各PRIMARY FETCH5,001、5–50各idx_ful_allocation_work FETCH5,001。原句事後50個matched-session TRADITIONAL EXPLAIN都仍為 `range / idx_ful_allocation_work / estimated rows=1 / Using where; Using temporary`。這是事後代表性計劃，不是50份原執行plan；估算1不代表實讀1。

結論：**獨立IN已加入且語意／功能驗證通過，但沒有達到減少廣泛讀取的目標**。目前它沒有成為有效的本批100主鍵範圍存取路徑。按Sam要求，停在本候選及結果／下一方案；不自動加入FORCE INDEX／其他hint／JOIN／schema或optimizer設定變更。

### 耗時：僅記錄單次觀察，不認證整體改善

| 成功phase | 報告69原SQL | 本次IN候選 |
| --- | ---: | ---: |
| 50 UPDATE client總時間 | 1,202.884ms | 777.870ms |
| server prepared總時間 | 1,164.821ms | 730.095ms |
| 5,000次trigger總時間（含在UPDATE內） | 100.004ms | 106.456ms |
| observer／EXPLAIN額外時間 | 222.967ms | 255.434ms |
| release span（含觀察成本） | 1,434.158ms | 1,042.293ms |
| Inventory返回後tail | 2,348.806ms | 2,000.478ms |
| 完整RC parent transaction | 8,173.692ms | **8,255.884ms** |

本次rollback parent8,794.022ms／root8,261.435ms；成功root8,236.140ms，提交後RR Inquiry ordinal8為13.045ms／11 query另列，整個成功service含Inquiry8,273.758ms。成功parent仍947 query／40,511 execute，原SQL次數沒減少；新IN多100 binds但不是多一條SQL。觀察與EXPLAIN開銷仍完整計入原20秒。

本輪UPDATE client觀察值較前次低約35.3%，但前次是filtered單案例、本次是完整44測試file，而且只有單次／不同目的兩個phase；沒有控制順序、暖機或足夠獨立樣本。**不將時間差全部歸因於IN、不宣稱穩定改善35%、不宣稱整筆交易更快／有穩定餘裕／當前CI已修**。CPU instrument未啟用，不能把未分類時間說成OR評估CPU；trigger／table I/O／prepared時間inclusive，不相加。

## 下一個具體候選（尚未授權／執行）

建議下一步保留目前100 ID IN及完整原CAS，先對照**現有SQL**與**局部 `FORCE INDEX(PRIMARY)`＋同一IN**的唯讀計劃（可保存安全optimizer warning codes以協助判斷，但不改memory／optimizer設定）。只有確認PRIMARY上能形成該100筆range／point access，再獨立覆核及另行實作／原完整44測試與actual讀量／效能驗證。

理由：IN單獨沒有改變實讀路徑，當前仍選fulfillment範圍索引。局部PRIMARY提示是下一個最小候選，不需新增index／migration／公開API；[MySQL26.7官方index hint規則](https://dev.mysql.com/doc/refman/26.7/en/index-hints.html)亦要求以實際計劃確認。**單獨看到PRIMARY或加入hint不構成成功**：本次前4批已有PRIMARY的廣泛FETCH；必須同時保留IN並以實際主表訪問量證明範圍收窄。若唯讀計劃或實測仍寬掃，不繼續疊加其他改寫，先提出新方案。

下一候選必須保留全部已預鎖targets、原鎖序、OR CAS／CASE／batch100／50SQL／affectedRows一致性、來源／數量／權限／owner proof／trigger／FK／原子rollback與replay；核對physical row／trigger次序改變的等價性，再跑原strict45000末批故障／fullfacts／同event恢復、完整回歸及當前候選CI。所有原規模、20秒及真容量／效能失敗停報規則不變，不承諾速度或P95。

本輪IN改動保留為未提交WIP候選供審閱，**不宣稱讀量優化已完成、Gate通過或採納下一hint**。沒有推送、重跑CI或合併PR297；原CI408FAIL／HIGH022025OPEN與TASK017022未完成保留。

## 證據及清理

所有原件在private0700 `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p1-runtime`，未export／commit原始log、參數或credentials：

| 檔案 | SHA256 |
| --- | --- |
| `release-in-measurement-result.json` | `9316d86feed1667aa04424ad958bc61e2386b07ac207e7c517cdfcf0ae843fc1` |
| `release-in-measurement.stdout.log` | `50714923f3763083f035fa6727e661e15d7e4cc5ba97a2a9005ce0fbd2ef6257` |
| `release-in-measurement.stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `release-in-pfs-unchanged.json` | `c96b0b56f8307d1dacdccd9ba48e5541238e745b7517e59377341c481a986f78` |
| `release-in-runtime-cleanup.json` | `d384348c6220bdff62d6a3c9ad9794fffef9d64b3bb81834cfba24fd80165903` |

全4組PFS consumers／instruments／objects／變數比對UNCHANGED。確認實際server UUID／socket／datadir／zero clients／owned child schemas0後，只移除本輪 `fulfillment_p0_p1_aa6dc08d`／`p1post_fefe1a44`，正常停止own MySQL，socket／pid absent；datadir及全部歷史／本輪證據保留。沒有活躍的本輪DB／native工作在等待。

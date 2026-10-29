# 方案 A 當前候選 CI 失敗及停止紀錄

## 候選及停止指令

Sam 已批准方案 A，同時明確要求當前候選容量／效能失敗即停報。本次已停止所有開發、效能調整、重跑及推送；沒有放寬原 20 秒、5,000 規模、安全檢查或 coverage，也沒有合併 PR297。

候選 HEAD `30d442b5082bdcd32b1beffac6219473ebe22a4b`，本機 source FP `6a31aa80082fe885f28320b16c2393453ce5546ef5fa3ba8a4043f8fa42604ca`、PLAN142a。實際 PR checkout `f074273b2f00af509f4960119f912c0d0d9c47fc`，真正 parents 為 main `ef5a61a4…`＋HEAD30d，tree `6fd9e6a1f81f1490d017f17dc904a80e636a4081` 與本地只計算的 merge-tree 相同；未在本機整合 target，也不把合併候選冒稱本機 FP6a31。

[CI40801317549](https://github.com/crazysumsum/erp-app/actions/runs/40801317549) 為 pull_request／attempt1／FINAL FAILURE。13 jobs 中10 SUCCESS、2 FAILURE（shard4及總Test）、1 SKIPPED（全域合併coverage）。四個原生shards合計4,361 tests＝4,153 PASS／1 FAIL／0 CANCEL／207既有條件式或discovery SKIP；不冒稱上游零skip或全域coverage已通過。

## 唯一實際失敗

原 `fulfillmentReallocationApi.integration.test.js:185`：100 SKU lines、每行50 Reservations，5,000筆舊 Allocation釋放後建立5,000筆新 Allocation，100個Balance。失敗發生於 `REALLOCATE_ROLLBACK`、ordinal6，預期測到末批 projection 的45000故障並驗證整筆 rollback／同event恢復。

- 真正交易 elapsed **20,001.045634ms**，callback20,001.289631ms，941 query＋40,338 execute；`DATABASE_TRANSACTION_TIMEOUT`。
- 整個 case 38,373.236757ms 包含fixture及先前成功操作，不能當作單筆交易時間。外層 rollback phase20,021.392540ms亦不可取代實際交易elapsed。
- 原嚴格故障辨識拒絕這個 watchdog abort，沒有將其誤認成預期 `ER_SIGNAL_EXCEPTION`／SQLSTATE45000。因此未完成該case的末批故障、數量還原及同event恢復驗收，不能宣稱這個 rollback Gate通過，也沒有證據宣稱已發生資料破壞。

| 已有 provider 時間（不可與其巢狀子項重複相加） | ms | client query／execute | 結果 |
|---|---:|---:|---|
| prepare | 696.828 | 214／0 | completed |
| preclaim | 4,528.262 | 5／15,002 | completed |
| Inventory posting | 9,073.143 | 379／25,254 | completed |
| ownerCurrentProof | 810.222 | 262／0 | completed |

逾時在上述已完成階段之後的 Fulfillment 處理期間發生。現有資料不能指出後段哪條 SQL／projection／audit／operation完成步驟最慢，不能把假設寫成根因；也不能直接以coverage或runner作原因。

## 仍有效的改善及通過證據

方案 A 確實消除重查：本機 instrumented 候選SELECT5,000→100、returned rows127,500→5,000，原兩個完整容量case2 PASS／80samples／98parents／strictVALID。CI 的100／5,000 Balance Allocation準備交易為11,686.100／13,609.708ms，各412 query＋25,362 execute、PASS；未改方案B的Balance鎖查詢。

CI 真正5,000筆HTTP Allocate／Reallocate／Pick為6,345.539／10,083.355／2,587.220ms，全部200並完成原rollback／replay／數量對帳。這些局部PASS不能消除上述直接Reallocate rollback失敗。

本機完整原P0／P1共用套件578 PASS／0 fail／0 skip（166 pure＋412 integration，舊553全保留），lint／build／audit及真P0／P1 Playwright各2 PASS亦保留；與CI是不同執行，不冒稱已滿足當前候選CI。全部本地測試庫／帳號及服務已guarded cleanup，datadir／證據保留。

## 證據及後續界線

私有原件 `budget-a-ci40801317549-job123209834839.log`，SHA `7a31b31144e90ad88e6a824c82f73974ec1dd1533fecfba572fcfd78e82c884d`；另三個raw、actual final run／jobs及checkout／parent／tree證明一併保留，不上傳raw logs。舊CI失敗、本輪本機PASS及所有批准均不改寫。

DEF022／025維持OPEN，TASK017／022維持IN_PROGRESS，PR297維持DRAFT／不合併，不宣稱P1全部Gate完成。下一步建議在收到實際恢復指示後，先針對 posting之後的 Fulfillment projection、audit與operation完成補計時及SQL分類，再選具體優化；本次不新增量測或實作。方案B的大型Balance取鎖查詢不是這個100 Balance失敗已被證實的瓶頸，不能直接套用。

報告正文（本段前SHA c4adbba242f91b945006e13878a9cd067684f78ff06774609411ce000b8a73af）、blocked body及state266已完成獨立只讀覆核，0 C/H/M僅指事實及停止處置正確，不代表候選HIGH容量阻塞已解除。私有receipt independent-budget-a-ci-failure-report-body-review.json SHA 43e9c1b0d94dd13f5b98dcfd35d8d21750631bd339204156f3f652c049d5a998。既有PR說明只更新停止／失敗報告，不改HEAD、不重跑CI、不merge；GitHub connector403保留，使用原已授權gh transport完成metadata更新，沒有改token或權限。

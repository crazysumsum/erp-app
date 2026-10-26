# Sales Order Management 營運手冊

依據 Sales Design §7.11、§12.4–12.5，適用現有確認、匯入、補配與原子 Archive。此文件是處理程序，不是容量、還原或整個 Phase 已通過的證據。正式環境的設定變更、修復與還原仍走各自維護／發布程序。

## 共同起點與只讀對帳

先記錄觀測時間、候選版本、內部 Order／Job／Batch／Operation ID、固定錯誤碼與影響筆數；保留原始證據於受限位置。日誌與 metric labels 不放訂單編號、External ID、Customer、SKU、User、reason、SQL 或完整 payload。必要的來源比對在有權限的既有畫面或受控管理工作階段進行，不把資料複製到告警。

已交付 `SalesReconciliationService`，目前沒有一般業務修復 API。以真實且仍有效的 `sales.view + sales.mgmt` 管理身分，在既有驗證 request context 呼叫 `reconcileOrder({claims, orderId})`；永久來源鍵另呼叫 `reconcileExternalKey({claims, keyId})`。每次呼叫自行開 RR transaction，不能包在另一筆 transaction。對每個相關 Order **及**每個永久來源鍵分別檢查；單一 Order 的 CONSISTENT 不是全資料集對帳。

- `CONSISTENT`：該次已觀測範圍一致，仍需核對原事件終態及其餘相關鍵。
- `MISMATCH`：保存固定 code／內部 ID／issueCount；停止對受影響資料重試寫入，交資料 owner 判定修復。
- `INCONCLUSIVE`：確認中、部分 Archive、並發變更或依賴不可用都可能出現；先排除原因再讀，不當成成功或沒有資料。
- `NOT_FOUND`：確認來源鍵與 conversion 路由，不能直接補建替代訂單。

修復須另備 owner 審批的 forward script、明確前置條件、rollback／restore 方法及前後完整對帳。不得直接 SQL 修改數量、刪除永久 source key、關閉 immutable guard，或用新增事件掩蓋未知交易結果。

## 指標與告警的解讀

`sales.metrics` 每5分鐘由 instance scope 只讀採樣；同一資料庫的全域 queue gauges 跨 instance 用 max／去重，不能相加。`sales.alert.*` 只含固定事件碼與有界數字。Collector 讀不到資料時由 Scheduler 記失敗，不發布全零健康快照。

CONFIRMING 超過5分鐘、Intake 等待超過10分鐘、10,000張標準 Import 處理超過30分鐘、Archive 窗口結束24小時未完成均須處理。Archive 停用時不報錯過窗口；窗口觀測追蹤最近已到期限的真實月份；當月沒有設定日期時仍查上一個有效窗口，不自動改排程。舊未完成 Batch 不被新月份完成狀態遮掉；無法驗證的歷史窗口另報未知。Hash conflict 與失敗計數立即告警；provider UNKNOWN 單次讀值僅證明目前未知，不能冒稱已持續多久。

Scheduler 最新 instance stats 會清理，不是完整24小時歷史。Recovery 讀值須在實際 statsFlush interval × staleAfterRuns 的更新期限內；過期、未來或缺列均回報未知。Publisher 的 updated_at 是資料庫時鐘秒，不能與 instance completion 的毫秒直接相比；TTL 沿用資料庫秒級過期規則。若只見舊成功或缺列，Backorder 回報 history unknown；只有可驗證完整歷史才能判定24小時完全無成功。近期實際成功可證明該時段曾成功，不能推導所有 instance 或所有 FIFO 項目正常。

實際 pool acquisition 邊界與窗口／累計計數已接入下方的 instance 觀測。尚待補齊的觀測來源包括引擎 ROWS_EXAMINED／lock wait、可驗證24小時 job log window，以及 stock-present-oldest 的正式 provider 證據。查詢 P95 必須有固定 operation、時間窗、sample count 與 unmatched／丟失覆蓋率；不能拿 SQL 總時間當 pool wait、回傳筆數當掃描筆數、HTTP202 當確認終態成功。這些缺口未補齊前不宣告 TASK062／完整 Phase Gate 完成。

## 1. Confirmation Recovery

觸發：`sales.alert.confirmation_overdue`、重複 recovery failure、或同一 Operation 長期 IN_PROGRESS。

1. 讀原事件狀態及 Order 版本，執行只讀對帳；確認 actor 撤權、Inventory provider 狀態、租約與 Scheduler 的 `sales.confirmationRecovery` 結果。
2. HTTP202 僅表示已接受，不能再建立另一個 confirm event。未知 COMMIT 結果先查原 Operation 終態；保留原 event／request hash。
3. 排除依賴後，由既有 cluster recovery worker 接手過期租約。不要修改 lease、清空 recovery payload 或跳過 fresh actor／Inventory fencing。
4. 結束條件：原 Operation 可確認終態、Order／Inventory 只讀對帳一致，連續後續觀測無同一 stuck intent；失敗保留明確原因與原意圖，不偽造確認成功。

## 2. Stuck Import

觸發：`sales.alert.intake_overdue`、`sales.alert.import_batch_overdue` 或 Import processing failure。

1. 在原 Job 讀 precheck／processing 狀態、有效／無效／重複／成功／失敗計數，核對 source file 與 worker 啟用／租約；操作者尚未確認的 READY 不當成已排隊超時。
2. 保存原 Job、Intake、External Key 與 operation 關聯；逐一對帳已產生的 Order 和來源鍵，確認原成功不被重送成第二張單。
3. 依原 Job 已提供的可重試操作處理暫時失敗；schema／hash／來源衝突先由 owner 判定，不用重新上傳、換 source ID 或刪鍵繞過衝突。
4. 結束條件：該批所有來源均有可核對結果與計數、無未解未知交易；檔案按原90日策略保留，結構化結果／永久鍵按至少7年策略保留。

## 3. Backorder Reconciliation

觸發：已證明24小時無成功補配、未知 job history、FIFO 長期未配或數量 mismatch。

1. 先分辨「沒有完整歷史」與「已證明沒有成功」。確認 `sales.backorderAllocate` 的實際啟用、近期完成與固定失敗碼。
2. 對受影響 Order 執行只讀對帳，核對 line equation、mapping 及現行 Inventory provider 真值。庫存存在／可用性須由正式 Inventory provider 證明，不能只看一筆 balance 或 UI 舊快取。
3. 排除 provider／鎖定原因後，讓既有 FIFO allocator 或已授權 wake 操作工作；保留 priority_at、原會員關係與事件，不直接分配數量或重排優先權。
4. 結束條件：同一事件的原結果可重播、FIFO 與 line／Inventory 對帳一致；有庫存但舊需求未配仍須獨立證據，不用 job 成功計數代替。

## 4. Archive Failure

觸發：Archive window overdue、`sales.alert.archive_failed`、provider UNKNOWN 或未完成 Batch。

1. 保存原 Batch、cutoff、cursor／pending 計數與 manifest，只讀核對6類 Sales＋12類 Fulfillment；確認正式 migration／provider／participant readiness。
2. `UNKNOWN` 與未通過資格保留原 Active aggregate，不改成 CLOSED。若有歷史部分 mirrors，需完整 Active 與同批／同時間／同 hash 證據；缺件保持 INCONCLUSIVE。
3. 排除依賴後由既有 cluster Archive worker 在原 Batch 續跑；不能拆開 Sales／Fulfillment transaction、手寫 manifest／routing flag 或用新 Batch 覆蓋舊失敗。
4. 結束條件：各類 count／row hash／table hash、manifest／永久路由一致、Active 子父列無殘留、Inventory facts 不變；pending 原因及 Batch 終態可核對。

## 5. Archive Hash Conflict

觸發：`sales.alert.archive_hash_conflict`、ARCHIVE_DATA_CONFLICT 或對帳 count／hash mismatch。

1. 保存來源、原 mirror、Batch／manifest 與版本，依維護流程停止受影響 Archive 寫入；保留所有 guard 與原失敗。
2. 在隔離還原副本重現，區分錯批／錯時間／snapshot 型別或 byte 差異／Active 殘留／真實內容遺失。不可用 case-insensitive 字串比較代替 canonical hash。
3. 資料 owner 必須核准具體 forward repair 或可信備份還原；不刪衝突 mirror、不重算 hash 掩蓋差異、不改舊批准或驗證結果。
4. 結束條件：受影響18類完整重驗及只讀對帳一致，必要技術／獨立覆核通過後才恢復排程。

## 6. External Duplicate Dispute

觸發：來源重送、payload conflict、external hash collision 或永久路由找不到唯一目標。

1. 以原 Channel＋完整來源 identity 在受控畫面比對；告警只保留不可逆短 hash、內部 key ID 及固定碼，不寫原 External ID。
2. 核對永久 Key 的 exact bytes／hash、payload hash、原 Operation 終態，以及唯一 Active 或同批 manifest 綁定的 Archive 目標；檢查 Quotation conversion／CSV 結果中的歷史路由。
3. 原事件重送應回原結果；未知交易先查原結果，不換 event／External ID 造新單。真正 hash collision 或業務爭議交 owner，不刪鍵或覆寫原綁定。
4. 結束條件：原來源和永久鍵都有一致、可解釋且唯一的結果；payload90日清理不構成刪除永久鍵的理由。

## 7. Restore Validation

觸發：備份演練、還原需求或版本發布前的 restore Gate。

1. 記錄可信備份時間與 checksum、binlog／事件範圍、schema／app 版本、受保護 config／keys、Active／Archive／permanent keys／Operations／Import／Export files 清單；憑證與原始備份不進 Git。
2. 只在新隔離 schema／socket／檔案根還原，保留原環境與原 ledger；先驗證來源／目標身分與資源 owner。不得因新 migration 名稱而改寫舊已套用 ledger。
3. 計時還原並核對所有預期類別與 metadata，再以只讀 Service 對所有 Order、所有永久鍵及18類 Archive 對帳；缺件或 UNKNOWN 不能當成零 mismatch。
4. 重播已成功來源與原 Operation，證明沒有第二張單／重複 reservation／重複出庫；確認 retained CSV／Quotation 到 Archive 的實際路由與檔案可用性。
5. Gate 保持 RTO≤4小時、RPO≤15分鐘，含時間／資料範圍／覆蓋率與失敗證據；NFR014／015 的 business UAT_NA 不豁免這些技術驗證。完整結果與獨立覆核完成前，不把這份程序本身列作 Restore PASS。

### Pool acquisition observations

The instance metrics job reports poolWait from actual connection acquisition snapshots. BASELINE and RESET provide no healthy-window claim; zero samples leaves latencynull. WINDOW elapsedMs is the actual interval between successful collections, not guaranteed five minutes. The histogram P95 is an upper bound; the final overflow bucket is censored/null. Count acquired/timeout/aborted/rejected and threshold exceedances together with samples. An abort alone is not overload. inFlight counts waiting callers, not residual mysql2 queue entries after cancellation. Monitoring acquisitions are included; transaction-bound SQL time is not pool wait. No per-query SQL/user/business labels are emitted. Follow capacity/recovery procedures for repeated timeout/rejection; never increase pool limits or bypass admission merely to clear alerts. Request/query/terminal P95, engine rows/locks and full capacity remain separate evidence.

For throw-capable publishers, the prior sample advances only after all publication calls resolve; this is a local attempt boundary, not a delivery ACK. A partial failed report may have emitted an overlapping window. Use windowStartAtMs/windowEndAtMs and instance identity to recognize that coverage; do not sum overlapping or retried windows as disjoint counters. A logger rejection preserves the prior sample and fails the Scheduler run. Production SystemLogger may instead catch writer errors or filter/drop entries while resolving; observe logging.system_write_failed / entries_lost and the underlying stderr/sink independently.

Every snapshot also carries fixed lifetime observations/outcomes/aboveThreshold for this executor, plus deliveryCoverage=UNKNOWN. After a filtered, dropped or failed write, a later recovered snapshot still exposes earlier lifetime failures; do not confuse them with new-window failures or sum repeated lifetime gauges. Process replacement resets these counters and cannot recover unpublished history. The standard logger does not embed an instance ID in its five-field format: associate records with their trusted per-process log stream externally; without that identity, reset/order/delivery remain unknown and no cross-instance completeness is claimed. Actual durable sink acknowledgement/full24h history remains separate.

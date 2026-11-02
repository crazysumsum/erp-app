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

`sales.metrics` 每5分鐘由 instance scope 對業務資料只讀採樣，另以獨立交易寫 Sales 自有營運觀測表；同一資料庫的全域 queue gauges 跨 instance 用 max／去重，不能相加。`sales.alert.*` 只含固定事件碼與有界數字。Collector 讀不到資料時由 Scheduler 記失敗，不發布全零健康快照。

CONFIRMING 超過5分鐘、Intake 等待超過10分鐘、10,000張標準 Import 處理超過30分鐘、Archive 窗口結束24小時未完成均須處理。Archive 停用時不報錯過窗口；窗口觀測追蹤最近已到期限的真實月份；當月沒有設定日期時仍查上一個有效窗口，不自動改排程。舊未完成 Batch 不被新月份完成狀態遮掉；無法驗證的歷史窗口另報未知。Hash conflict 與失敗計數立即告警；provider UNKNOWN 單次讀值僅證明目前未知，不能冒稱已持續多久。

Scheduler 最新 instance stats 會清理，不是完整24小時歷史。Recovery 讀值須在實際 statsFlush interval × staleAfterRuns 的更新期限內；過期、未來或缺列均回報未知。Publisher 的 updated_at 是資料庫時鐘秒，不能與 instance completion 的毫秒直接相比；TTL 沿用資料庫秒級過期規則。若只見舊成功或缺列，Backorder 回報 history unknown；只有可驗證完整歷史才能判定24小時完全無成功。近期實際成功可證明該時段曾成功，不能推導所有 instance 或所有 FIFO 項目正常。

DEC-043 的來源與啟用界線見下方：真正 engine facts、Sales 持久化 coverage／run facts、Inventory readonly owner observation，以及確認提交後的固定 attempt/outcome counters。沒有有效來源／完整歷史就保留 UNKNOWN；部署檔案及初始資料存在也不代表實際指標、runbook、容量或 Phase 已通過。不能拿 SQL 總時間當 pool wait、回傳筆數當掃描筆數、HTTP202 當確認終態成功；完整 SLO 與交付仍須最終候選的原生／容量／CI／獨立覆核及全部 Gate。

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

本輪 P4 IMPLEMENT 依 Sam DEC-040 不執行災難還原，不產生 Restore／RTO／RPO PASS；以下程序保留供未來另行授權的正式流程。

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

### Inquiry operation completion windows

queryOperations observes six fixed service operations: active_list, outstanding_list, active_detail, archive_exact, archive_range and archive_detail. Elapsed monotonic time includes authorization, the original transaction/SQL and read-model work. It is neither SQL-engine time nor pool wait, HTTP dispatch time or Confirmation terminal latency. Input validation before admission is not a measured query; every admitted success or error, including denied/not-found reads, contributes a completion sample. Started/inFlight and cumulative success/error/above-threshold counters are separate from completed-window samples. A long operation begun before the window belongs to its completion cohort; never infer start-cohort request throughput from these counts.

BASELINE/RESET publishes no latency window; zero completed samples has null mean/P95/threshold result. WINDOW carries actual start/end timestamps, elapsed interval, sample count and success/error totals. Histogram P95 is an upper bound, with null/censored overflow. Threshold alerts use the exact count strictly above the unchanged boundary and nearest-rank95%, including errors:2000ms Active,3000ms Archive exact/detail,5000ms bounded Archive range. The fixed thirteen histogram bins and six labels carry no SQL, identifiers, filters, request payload or error text. Do not use small or idle windows to certify a full-capacity SLO.

Both query and pool samples advance only after all awaited info/alert calls resolve. If an alert fails after info succeeds, later windows overlap: deduplicate by process/operation/window boundaries rather than sum. Real SystemLogger may swallow failed/filter/drop writes, so resolved publication is not durable acknowledgment. deliveryCoverage remains UNKNOWN; lifetime completion/error/above-threshold counts retain evidence of lost intervals but cannot reconstruct every missing time window or histogram. Process resets and externally managed stream identity require monitoring reconciliation. Engine rows examined/lock waits, durable24h FIFO/history/provider evidence, terminal timings and full capacity/restore remain independent required work.


## DEC-043：營運歷史啟用與判讀

只新增 `sales_operational_job_runs`、`sales_operational_alert_state`。Backorder 的原 batch 在 durable START 已提交後才開始；寫 START 失敗沿原 Scheduler retry，不執行未觀測的該次補配。這個 availability prerequisite 不套到 Confirmation 等其他業務交易。取消後無法再用原 live principal 記終態時，保留 RUNNING／UNKNOWN；不得直接把它改成成功／失敗或刪除，以便解除告警。

先確認已套用相容 migration，所有 contributing Backorder workers 都部署同一受測 instrumentation baseline，舊 workers 已 drained，沒有有效的 `sales.backorderAllocate` lease。操作人員須保留這些外部部署證明；工具只驗證受控 attestation／本機實際 source+policy hash／DB lease／CAS，不能自動證明每台主機。

1. 在同一完整發行 artifact／實際設定執行 `node server/scripts/activateSalesObservations.js --print-baseline`。只輸出 protocol 與 hash，不啟動 HTTP／Scheduler；需要隨 artifact 保留指定 source 檔案及 activation script。
2. 準備由目前 OS 使用者持有、mode0600、單一 regular file 的受限 JSON，內容恰為 `protocolVersion`（`1`）、實際 `baselineHash`、`allWorkersInstrumented: true`、`oldWorkersDrained: true`。不使用 symlink／共享權限／超過8192bytes檔案，不在檔案放 credentials 或業務資料。
3. 只讀核對 COVERAGE 的目前 epoch。初次用 `--expected-epoch none`，後續用確切舊 UUID；執行 `node server/scripts/activateSalesObservations.js --attestation /absolute/private/attestation.json --expected-epoch <none-or-current-uuid>`。建立真實 DB-time 新 boundary；版本衝突／仍有 live lease 時停下重新核對，不能盲重送。若回報 COMMIT outcome unknown，先查持久化 COVERAGE／epoch，不能假定未提交。
4. 本次開發不授權 production activation。正常部署後也須等完整新24小時窗口；未知／缺失終態、版本不符或不完整啟用證明都不能判定「24小時完全無成功」。過去某次成功只證明那次成功。重新啟用建立新界線，原 facts／舊 epoch 保留。

FIFO／provider persistence 只代表同一 identity/version 的三次合格5分鐘樣本跨至少10分鐘，不證明樣本之間的狀態。270～330秒是 cadence 容差，重複早取樣不能湊10分鐘。缺／未知／負樣本、變更 head、採樣 gap、時鐘倒退或 baseline/epoch 改變會重設或拒絕沿用。先以只讀對帳及 owner 狀態查明無庫存、保質期、Item／Base UOM、warehouse/control／權限或依賴；不使用 reserve probe、不改 FIFO priority，不借 Fulfillment 身分。

### 指標來源與 cohort

| 原設計訊號 | 實際來源／範圍 | 不得推論 |
|---|---|---|
| SO／Quotation create、convert outcome/duration | `domainOperations` 固定 service-request cohort，包含 validation、transaction、replay/error | 不是每個既有來源或原始資料集的完整歷史 |
| 確認終態時間 | fresh manual/recovery：原 intent created_at 至 acknowledged terminal COMMIT；replay不新增 sample，rollback/unknown另列 fault | HTTP202、未解決 retry 或 unknown ACK 不是已完成耗時 |
| Reservation requested/reserved/backordered | `transactionOperations.reservationAttempts`：CONFIRMATION含manual/recovery/Intake，BACKORDER為fresh每次請求；只在外層 acknowledged COMMIT累加 exact base量 | repeated outstanding attempts 不等於 unique demand／淨 backlog；rollback/replay不增加，unknown不補成功量 |
| 成功 Backorder allocation latency | positive quantity 的 priority_at 至 acknowledged COMMIT wall-time；invalid/negative clock列unobserved | 不是queue oldest gauge；跨主機須另確認時鐘健康；不認證 latency SLO |
| Intake received/accepted/invalid/duplicate/succeeded/failed/retried | fixed CSV／CHANNEL acknowledged fresh row／classification／terminal／prior-attempt>0 claim；Channel submission request outcomes另列 | accepted是驗證通過，非已成單；request replay不是新record；deferred不是已發生retry |
| Queue depth／age、recovery結果 | 真實 queue/state及有freshness的 Scheduler stats；run ledger另供Backorder24h proof | overwrite/purge後的最新stats不證明24h完整歷史 |
| Query duration／pool waits | 既有六類 query完成窗口、實際borrow boundary；lifetime/reset/delivery皆明列 | 不等同engine rows／rowwait／HTTP terminal latency |
| Engine rows／locks | instrumentation有效且未overflow的nativePFS，current-schema匹配Sales-table statement digests；table lock ps、instance-wideInnoDB rowlock ms/waits分開 | 累計不是完整window／per-Order attribution；無法驗證reset／truncation時UNKNOWN |
| Export queue／rows、Archive counts | `sales_export_jobs` queue/row_count、既有完成audit／worker counts；Archive batch及manifest的candidate/archived/skipped/failed、固定candidate duration | Export上傳202不是完成；candidate耗時不保證月度完整drain |
| transaction unknown／deadlock／provider mismatch | fixed faults來自原Ops.run與Backorder／Archive／precheck／processing實際交易包裝；原始error傳播不重複，新recovery fault另計；既有safecriticalevents保留 | counter不能取代原結果查詢／對帳，與underlyingenginecause／delivery完整性不同 |
| reconciliation mismatch | `SalesReconciliationService` 的有界具名範圍結果與原existing tests／runbook；全部相關orders/keys需逐一核對 | 單一CONSISTENT不代表全資料集／未知範圍0mismatch |

新增 counters 只涵蓋本 process／executor 自啟動後觀測的 committed attempts，固定labels、exact quantity strings、固定histogram儲存；`coverage=ACKNOWLEDGED_COMMITS_ONLY`、`deliveryCoverage=UNKNOWN`。原初始化資料不被回填成新 counters，跨程序不能把重覆 lifetime 快照相加。Unknown commit 可令成功數量漏樣，本來就不能當作完整總帳；以 durable業務結果與只讀對帳判斷實際結果。

### 保存量與關閉條件

完成 run 的7日清理及過期非coverage signal，每輪各最多500；未完成 run 保留，history保持UNKNOWN。這是有界清理，不是全表資料固定上限。以實際 schema `DATA_LENGTH+INDEX_LENGTH`／filesystem allocated bytes、實際run數、contributing instances及distinctFIFO scope數記錄容量；正常每instance每5分鐘最多288次排程/日，但clusterlease只防重疊，不代表多instance每天合計只有288次。未解決rows會繼續累積；先排除活躍worker／未知業務結果，owner另行處置，不能無證明刪除／改寫舊facts。

Native 開發案例中的控制timestamp投影只驗證邊界／CAS，不宣稱真的過了24小時或10分鐘。Backorder dry-run 須先觀測無庫存／short-life不合格，然後以正式補貨／受控合成庫存fixture及既有manual wake／原worker處理，核對實際positive reservation、remaining quantity、舊head/sample reset及只讀CONSISTENT。Stuck Import 使用原event／真實cooldown／registered retry／terminal result與對帳，不人工修租約／數量。Confirmation與Archive仍按原runbook與全部native原子性／未知commit／18類對帳案例；沒有實際證據不能以這張來源表宣告完成。

### P4 developer execution CPU controls

The Harness runner forwards only each reviewed suite’s declared `env_keys`; invoking its parent with UV/GOMAX settings alone does not forward them. All 48 required P4 developer suite contracts therefore declare `UV_THREADPOOL_SIZE` and `GOMAXPROCS`. The authorized local orchestration supplies both as `2`, invokes the runner at nice `10` (inherited by child processes), retains test concurrency `1` and MySQL InnoDB concurrency `2`, and serializes SQL/browser/build workloads. These are execution limits, not changed SLOs, sample sizes, workload, suite timeout or acceptance criteria. The active source initializer remains on its original frozen controls; this private contract correction is applied only after it finishes.

### DEC-044 Backorder order index migration

Only the approved forward migration adds `idx_sales_backorder_order(sales_order_id,id)` to the active Sales Backorder table. Old migrations and original readers/orphan diagnostics are retained. The migration itself establishes and verifies DDL/read threads1 and metadata-lock wait10 on the same connection, gives the ALTER a600s budget, validates its definition and restores the original session settings. On failure it destroys that session. The deployment operator must inspect the real index and `fr_schema_migrations` before any retry: DDL can commit independently of its acknowledgement/ledger write. A compatible committed index with an absent ledger row is reconciled using the normal idempotent migration path only after that observation; incompatible state is rejected, never auto-dropped or silently replaced. The native drift fixture alone may intentionally alter its owned nonce schema for proof. No global settings, production execution, business-query timeout or capacity-SLO changes are authorized here.

Local developer execution remains nice10 and serial after the original1m/5m initializer has a valid receipt; observe actual index size/build duration and capacity access plans before claiming the defect closed. Neither prior initialization sleep failure nor private metadata prototype PASS is a capacity/native PASS. All48 suites/current CI/whole-phase review still gate main merge.

### P4 DEC047C Archive enable blockers

Sam approved bounded1000-order developer Archive verification and deferred full300k drain, large Archive index/query capacity, original>=100 Archive-only foreground cohort and50-user sustained mixed/10k end-to-end Import+5Exports/Archive contention until formal/prelaunch verification. These remain NOT RUN; full NFR004/005 is not established by a small CI batch. Keep `sales.archive.enabled=false` in product defaults and deployment until those gates, operational cadence/admission and actual observation coverage are dispositioned. The developer test's real controlled two500-order invocations enable only its isolated test application; they do not enable production Archive or prove a150-hour calendar. No disaster restore test is required for this delivery by direct Sam instruction. Persistent24h history remains UNKNOWN until actual version/coverage activation and elapsed evidence exist.

# P2 啟動與 cross-module 契約 — DEC-021（待人類採納）

MODE IMPLEMENT; PHASE-003 / TASK-028–037。使用者 2026-10-07「繼續下一階段」授權接續 P2；既有 commit／push／create PR／main merge 授權沿用。本提案是尚未批准的 worker／部署邊界與執行契約補充，不是重問已批准的 Git 工作。

## 已觀察入場與恢復

P1 PR184 actualMERGED main `6936736ba1fb98f4fcb8365377f59f0a0f7a4897`，5 exactcandidate CI PASS、23 developer suites PASS、兩份實際獨立覆核、無 HIGH/CRITICAL。主工作目錄 clean，P1 branch/worktree 與5個自有 MySQL 均清理；所有原 failure/approval/evidence 保留。已按 final-manifest SHA 恢復 checkpoint160及原 raw artifacts 到 P2工作樹；checkpoint161 僅登錄 actual recovery，不冒稱新 P2 PASS。P2專用 `/private/tmp/erp-sales-p2`，branch `codex/sales-order-phase-2-commitment` 從剛fetch最新main建立；最高 migration0077，未預留號碼。舊 Python tmp symlink已失效，已驗證既有 bundledPython3.12.14；沒有安裝工具。

兩個 separate reviewers `/root/sales_p1_review`、`/root/sales_readiness_review` 已實際核對原 D52bc/Pf602/source3e5、manual Inventory actor限制及不存在 Fulfillment runtime。TASK028 schema 本身可進行，但完整 P2需以下新邊界。R2 exact-diff review已由兩位實際separate reviewers批准（DEC021-proposal-R2-20261007）；R1 findings及hash保留於state。批准只表示提案可呈交，agent review不代替人類或模塊 owner 採納。

## 可審查基準

- Fresh code/main：`6936736ba1fb98f4fcb8365377f59f0a0f7a4897`。
- Proposed DESIGN：`dbb9b2eabe3c1089b748c22bbafec53abae8d77fbedda13e749197227af2420f`。
- Proposed PLAN：`e61659d852b66566085d80a53f0437ef79f101a1449fc15c52f9e59223b068e4`。
- Proposed source fingerprint：`137bd360f0f8da58b7efa9bdee607e4884367d1c6ae3d4e833a4f3e60e16f3fa`（只有 Inventory/Fulfillment owner docs納入source fingerprint，沒有改產品碼）。
- Canonical proposed diff：`/private/tmp/sales-p2-private/dec021-canonical.patch`；patch SHA `3462cb6cf517e751d24f132ad5bebc700a0d4f057a62e6623ac474042287e1cc`，另存 baseline sidecar。
- Prospective fixed UATNA approval ID：`APR-PHASE2-UATNA-DEC021` 已先放入 ledger再算hash；原 NFR014/015理由與技術DR義務不變，沒有新批准記錄。

## 建議採納的具體範圍

1. 原10項P2任務：mapping／Backorder persistence，durable two-phase confirmation、同步200/202與event polling、recovery、withdraw/cancel/close、FIFO allocator與manual wake、UI及真實併發／crash／效能檢查。一個完整P2 PR，沒有 partial Phase merge，沒有新增 P3/P4入口。
2. Recovery 保留原 initiating human user與event，重新查實際active／roles／view+mgmt。已撤權者不得繼續新effect；不把recovery改為system權限，也不捏造claims。
3. **Inventory owner worker補充**：增加固定 `sales.backorderAllocate` server principal 的 reserve-only sibling method，重用原batch engine。live principal authorization與固定job的DB-clock有效lease必須在同一 caller transaction驗證；lease row先鎖並fence takeover。來源只可真正 `SALES/SALES_ORDER`、實際owner/line與持久化systemevent，worker root/child types `SALES_BACKORDER_BATCH_RESERVE` / `SALES_BACKORDER_LINE_RESERVE`／purpose identity獨立；live停止／disabled／AbortSignal必須重新檢查。manual contract/hash不變；無role grant、generic bypass、worker release或P3 import delegation。純caller自報serviceName、permission或lease資料不構成授權。Exact callback/fence與spoof/revocation/replay/expiry rollback tests必須通過實作覆核。
4. **Fulfillment 未部署例外**：受限 versioned `UNINSTALLED_FULFILLMENT_V1 / NO_PROVIDER_REQUIRED`，只在無active registered provider且同一locked Sales transaction驗證 owned tables與applied migration history皆0時回distinct NOT_REQUIRED，絕不合成CLOSED。任何 schema/history/partial/archive/provider或SQL錯誤都需真正provider，缺失/UNKNOWN/失敗503且不release。無negative cache、無shadow Fulfillment tables、無production fake。Inventory active allocation與quantity guards仍必跑。這是明確改變部署邊界的例外，須本次人類採納。
5. 例外不能單獨證明live cluster migration安全：Fulfillment rollout先quiesce Sales lifecycle release、migration先行、移除NPR契約、啟用並驗證所有節點/provider、證明Sales→Fulfillment→Inventory writer/guard lock順序，才恢復release。禁止drop schema/history來重新啟用例外。Archive仍required Fulfillment participant，沒有豁免。
6. Allocator每transaction一個FIFO entry，global scheduler lease與manual wake透過Sales runtime adapter選取固定真正registered job，驗enabled/started/not-stopped後共用既有Scheduler.execute(job)/overlap/cluster lease；Sales root在queue locks前，Inventory operations在stock前，不能跨SO batch或拿stocklocks後再claim下一batch。Backorder queue依原priority排序；初次人工確認沿用ATP-at-submit語意。本提案不額外承諾把舊Backorder優先於所有新人工SO；如需此新業務優先級，另有獨立需求決策。

## Developer merge contract

保留完整23項P1回歸，新增5項，共28項，必須在同一P2來源／PLAN實際PASS：

| 新suite | min tests／skip | 必需證據 |
| --- | --- | --- |
| sales-phase003-unit | 12／0 | TC021–031相關behavior、worker authorization／lease、原actors、line-set/conservation/replay/lease/abort/FIFO/lifecycle |
| sales-phase003-native | 16／0 | TC021–031實際MySQL/HTTP：clean/upgrade/rerun/FK/trigger、20/100並發、rollback、真正owned process crash/restart、真正COMMIT完成後ack loss與rollback區分、FIFO/global lease、release故障、revoke/IDOR/reconciliation |
| sales-phase003-client | 8／0 | TC022/024/028/029/030：原UUID202/timeout/poll、terminal、409/reason/allowedActions/quantities/history、manual wake |
| sales-phase003-browser | 8／0 | 同上真應用API/DB與Playwright、happy/error/refresh/navigation/responsive/accessibility、console/network；P1 config仍固定測P1，不改成P2 |
| sales-phase003-performance | 2／0 | TC032：20及100並發正確性；50interactiveusers、1/100line混合，加actualrecovery/backorder背景，completed-confirmationP95<=3s且pool無starvation；202必pollterminal才計完成 |

效能證據需samples、分位數算法、持續時間、warmup、資料分布、hardware/pool/Node/MySQL版本及全部excluded dependency failure。TC033是全28suites/品質/CI/review的Phase aggregate，禁止空測試偽造PASS。全域92/83/90與原34per-file floors保持，confirmation/lifecycle/backorder三檔新增95/90/90。10個Inventory native suites全部必跑，只保留原 implementation/15_phase0_validation_decision.md 的四項跨模組延期：Customer TC064 import10k（server/test/performance/customerImport.performance.test.js）、Customer TC028 100k lookup（server/test/performance/customerManagement.performance.test.js）、Inventory TASK018（server/test/performance/inventoryCore.performance.test.js）、Item TC012/T35 2.1M（server/test/performance/itemManagement.performance.test.js）；沒有blanket skip放寬。

全部60個正式TC、TC021–033/UAT038–064及laterPhase規格保持，於TEST_AND_VERIFY／業務驗收另行實際執行。P2 implementation merge不是formal acceptance/UAT/release。

## 精確scope與runtime

Shared／schema補充：

- `server/test/migrate.test.js`
- `server/config/scheduler.js`
- `server/test/serviceContainer.test.js`
- `server/scripts/checkCoverageFloors.js`
- `server/src/modules/inventory/InventoryReservationService.js`
- `server/src/modules/inventory/inventoryConstants.js`（只增兩個worker reserve types，保留manual members/hash；對應regression驗證）
- `server/test/inventoryProviderContracts.test.js`
- `server/test/inventorySalesWorkerContracts.test.js`
- `docs/inventory_management/03_design_spec.md`
- `docs/fulfillment_shipping_management/03_design_spec.md`
- `server/database/migrations/*_create_sales_order_line_reservations.js`
- `server/database/migrations/*_create_sales_backorder_entries.js`

Sales-owned additions限定兩個SalesJobs jobs、sales-backorders handler、Sales composable/tests，以及既有Sales modules/pages/components/operations/order handlers/native/e2e範圍。TASK031/033等拆成<=5主要檔案的atomic slices；沒有package/lockfile/framework registry rewrite。

採納後僅在全新 `/private/tmp` 自有namespace建立一次性MySQL26.7.0/schema/socket與一致TCP、privateHTTP/frontendport。全部synthetic資料/credentials；ordinaryapp SUPER=N、binlog1/trust0，trigger/migration fixture用獨立syntheticadmin。授權empty/upgrade/rerun migrations、受控本次child process crash／restart／ack-loss、bounded load及cleanup；不指向先前DB或production/sharedUAT，不部署、不得rawlog/XML/trace/secret export。原datadirs/failedproof保留。所有SQL/process effects先ledger後觀察，僅清理核對ownedUID/PID/argv/path/socket資源。

原commit/PR/mainmerge授權沿用；只在全P2 DoD、28當前developer、5 exactcandidateCI、实际separatereview、freshmain/MERGE_READY通過後合併並安全清理。

## 選項、代價與預設建議

**A（建議）**：採納此具體P2契約／sharedscope／ownedruntime與受限未部署例外。優點：完整P2能進行、worker身分有可撤銷fence、無影子Fulfillment，原驗收/安全門檻保留。代價：新增Inventory worker能力、部署例外治理、28suites與實際負載驗證時間；未來Fulfillment上線要明確移除例外並整合真provider。

**B**：保持Fulfillment必須已上線的原嚴格前提，拒絕未部署例外。可整理與實作不依赖此provider的已授权切片，但TASK033/034與完整P2 merge必須等待Fulfillment owner交付真正guard；不得宣告完整P2完成或partialmerge。仍需單獨採納worker與developer契約才可開始其affected路径。

Default recommendation A；尚未採納前，不套用產品／SQL／worker權限效果。本提案沒有利用「繼續」自動批准尚未呈現的hash或cross-module例外。

## 決策依據

[Harness implement](/Users/sam/.agents/skills/software-engineering-harness/references/08-implement.md)：
> Do not silently change architecture, transaction semantics, security model, public interface, data ownership, acceptance criteria, or Phase boundaries.

[Harness state/recovery](/Users/sam/.agents/skills/software-engineering-harness/references/19-state-and-recovery.md)：
> Do not rewrite an old approval's hash to make it look current. Obtain a new decision, retain the old record, and explicitly dispose of obsolete evidence.

原Inventory provider review明確未授權workerdelegation；原Sales guard要求不存在providerfailclosed。此次是安全/部署/執行契約新補充，需一次具體人類採納，並非重問Git授權。原所有批准/失敗/證據保持。

## Actual adoption

2026-10-07 Sam在本次Codex chat直接回覆「同意」，採納Option A及上述完整R2基準／scope／runtime。原提案上下文與R1歷史保留；新增批准不重寫舊hash。既有Git授權沿用，P2尚未實作或通過驗證。

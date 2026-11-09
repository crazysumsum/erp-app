# TASK-034：最新 main 上的內部 Phase A 覆核候選

2026-11-04。依 Tech Lead 本輪指示建立獨立整合 worktree，只帶三個 TASK-034 產品檔及本項追溯；不發布公開 reverse，不投入真單，不實作 Phase B／Recovery，不 push／CI／UAT／NFR，不新增或執行測試。原候選與原始證據保持原版本，沒有轉綁新 head。

## 可核版本及最小差異

- 保留原 P3 候選 `f47029fe8a25b75b4d2ab1ab4e502d3b9c79fc46`，worktree `../fulfillment-p3`；原產品提交 `1cdd41f089c7f5a95e9657450195772b88c52947`。
- 本次實際 `git fetch origin main` 得到 `d434a85767045613ac6d7a64ed81742bc6937fc9`。它是本次整合 target，不聲稱 main 之後不會前進。
- 隔離分支 `codex/fulfillment-task034-main-integration`，worktree `../fulfillment-task034-main-integration`；無衝突 cherry-pick 產品提交為 `72311236e7f39c318e37740c40c67971272f3ab7`，當時 tree `1052715e2e3cca4835040fc5e7a07cfae3243fa2`。本說明另作文件提交，不修改產品。
- 相對 target 的產品差異恰為以下三個新增檔；沒有 handler、配置、migration、測試、fixture、workflow、其他模塊或既有文件的更動。三檔在原 source／保留候選／整合候選的 blob 各自相同，target 原本三檔均不存在。

| 產品檔（`server/src/modules/fulfillment/`） | 三版本共用 Git blob |
| --- | --- |
| `ShipmentReversalService.js` | `49b0f94219002a1c7671691d4a46dddaa782f32c` |
| `FulfillmentDownstreamMatterService.js` | `2ff7abdb8c86bc86c171cd440fd6c6bf6e635d54` |
| `shipmentReversalCommand.js` | `0d617b5a9c4226e60d53a9ddabd9985c3bc0063b` |

完整只讀 Git／檔案對照：`../fulfillment-p2-runtime/task034-main-integration-20261104/source-main-impact.json`，SHA256 `0313190e37f750aa15026996b99de9f05c0c1fc1bbb06ea1a4d97f6ae3544878`。這不是測試或新候選獨立覆核收據。

## 重要依賴與 fixture 差異

沿用原 r2 `source-main-impact.json` 明列的 315 個選定依賴逐檔比較：314 個與保留候選相同，唯一差異為 `server/test/sales/phase4/salesFulfillmentFixtures.js`；整合候選的 315 檔全部等於本次 target。這是指定集合的比較，不代表整個 repo 或所有可能依賴皆相同。

該 fixture 新增 schema／migration seed dump cache，只在 `GITHUB_JOB=server-tests` 且 `SALES_CAPACITY_SEPARATE_STEP=1` 同時成立時採用。保留候選該檔 SHA256 `cc89632e30d66d692a77c513256bfba9ce0a37336a7699ebb1c61188f672053d`；target／整合候選為 `1bc8fca2ddb7a45e5e9e2bccd8deb9c869bef179c0785f1abb672f833c17aefc`。本輪保留最新 fixture，沒有把 pinned r2 配方帶回或重跑；舊私有結果仍只屬原 tree，沒有證明新 cache 路徑或整合候選通過。

另核原分支 base `87edf064…` 至本次 target：Fulfillment／Inventory 產品、DB service、authorization、正式 `server/database` migrations、`package-lock.json` 無差異；Sales 產品另有 `SalesInquiryService.js` 的 audit 查詢新增，不在上述選定集合。現 Phase A 不呼叫該查詢，沒有據此擴改 Sales。自先前觀察 main `59c6e740…` 至本次 target 的新增差異屬 Purchasing TASK-017／其准入，沒有帶入額外 feature 分支。

目前 Phase A 實際依賴仍為既有 RC transaction／可信 isolation、fresh actor／operation claim、獨立 sequence reserve、Fulfillment→Shipment 行鎖、正式 archive mirrors、history／audit 及明確 downstream registry。缺表或部署不明均保留拒絕；正式 migrations 不能由空表、repo 缺模塊或 fixture 聲明代替。

## TASK-034 原 acceptance／DoD 尚未完成之處

本輪沒有發現必須修改這三檔才能供內部源碼覆核的新增具體產品缺陷，亦不以「未證明」斷言產品已壞。下列區分保留，不把內部可覆核誤記為 Task DONE 或可發布。

| 原條件 | 已有 bounded 證據及仍欠項目 | 對內部覆核／完成的影響 |
| --- | --- | --- |
| SHIPPED／未歸檔／未沖銷、fresh reverse、原因及兩項確認 | 原 pure probe 已驗 strict 欄位、原因界限、兩項確認及版本格式；原 native 正常 Phase A 成功。現有證據未逐項完成 revoked permission、stale CAS、歸檔／已沖銷等服務層負向驗收 | 可檢視實作；不能宣稱本列全部動態驗收完成。競爭失方的 state-before-CAS 409 不等於獨立 stale CAS 案例 |
| 明確版本 registry；required provider UNKNOWN／不可逆阻擋 | 原 pure probe 驗缺失／未知／REQUIRED 拒絕。現產品只支援明確 `NO_DOWNSTREAM_MODULES_V1`、兩 owner 均 `NO_PROVIDER_REQUIRED`；沒有實際 required-provider 查證契約或部署採用證據 | 內部候選只覆蓋這個明定子集；required-provider 支援及實際部署仍是未解依賴，不能稱該 owner 接線已完成 |
| 同 event/hash、異 payload、競爭、Phase A 無 Inventory／Sales 效果 | 原 93 正常／末筆 audit rollback、94 pending replay／reason conflict、96 固定兩 event 交錯已覆核；Sales／Inventory 全量對照與合法 sequence 跳號分列 | 可直接沿用原件作審查背景，不重跑。terminal replay 及完成後效果屬後續；末筆 audit rollback 不是 process crash 證據 |
| Phase-A crash 與共通 DoD | 未取得本 TASK 的 process-crash 證明；只有原 focused 三檔 lint，尚無新整合候選的 affected regression、完整 lint／coverage／當前 CI。既有 traceability IDs 仍為 TC-001／TC-008，不能用私有案例冒充 formal TC 關閉 | TASK-034 保持 IN_PROGRESS；新候選尚未通過完整 DoD／獨立整合覆核。這輪不新增或執行補證 |

原文件與證據索引保存在 `f47029fe…:docs/fulfillment_shipping_management/implementation/92_…` 至 `96_…`，原 state revision380 記 TASK-034 IN_PROGRESS。本整合分支只繼承 target 的整份 state（revision372／current TASK-027，TASK-034 PENDING），沒有把原分支全量 state／P2 對帳帶入，亦未改寫其狀態或宣稱通過 gate；本項明列實際進度供後續正式 state 對帳。

## 跨階段及具名部署阻塞

TASK-034 Approach 曾列 reverse handler/schema；TASK-036 又明確擁有 Reverse API 的 200／202、operation lookup 及 Recovery。依本次 TL 指示，三檔現在只作內部候選，**沒有公開入口**。完整 Phase B／原 bucket 與 Reservation／Sales 恢復屬 TASK-035；失敗收斂、unknown commit、lease、接管及 API 屬 TASK-036。不能只開 Phase A endpoint 讓真單停在 REVERSING。

PM 本輪盤點 `59c6e740…` 的配置／runtime／env／manifest／workflows，回報「**實際部署聲明／維護人未確認**」；本次 target 後續增量未改上述部署位置。本輪源碼核對亦未見 runtime composition 建立此 service 或注入正式 `downstreamRegistry`。repo 內沒有版本化實際環境 Returns／Invoicing 聲明；manifest 的 AR 引用或 TL 的設計責任均不能證明部署。依賴協調交 **PM／Tech Lead**，實際部署維護人尚待其確認，不能代填其姓名。

公開使用前須由 PM／TL 取得對應環境及版本、Returns／Invoicing 各自採用狀態、實際聲明維護人；若 required，須有正式 transaction-aware provider 及其明確結果，否則維持 UNKNOWN／拒絕。還須完成 TASK-035／036 與正式功能 gates；本輪沒有改營運政策或以合成 fixture 採用 `NO_PROVIDER_REQUIRED`。

原計劃每 Phase 一個完整 PR／測試週期未更動。依 TL 已選方向先交這個內部本機 review ref；不另拆可合併的 Phase A PR，不把待完成的 Task／公開部署 Gate 豁免。下一步由 TL 覆核最小整合差異並裁定 required-provider 與部署依賴歸屬，PM協調具名維護人；後續實作及驗證另按原任務／既有准入推進。20秒限制、全部安全檢查、原失敗和原始結果均保留。

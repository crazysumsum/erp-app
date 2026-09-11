# Sales Order Management 開發執行計劃

## 0. 文件資訊

| 項目 | 內容 |
|---|---|
| 依據 | `docs/sales_order_management/requirement.md`、`docs/sales_order_management/design_spec.md` |
| 產生日期 | 2026-09-09 |
| 任務狀態 | 待人工 review／批准後執行；本文件不代表已開始開發 |
| Task List target | 本文件；依使用者指定，不另建 `tasks/plan.md` 或 `tasks/todo.md` |
| 交付模式 | Phase 0–4；每個 Phase 一個獨立 worktree／分支、一個 PR、一次完整測試週期 |
| Commit 模式 | 每個 Task 完成、驗證後形成一個 atomic commit；Checkpoint 不是額外功能 commit |
| Task sizing | 每項 Task 原則上修改 1–5 個主要檔案；預計超過 5 個時，實作前必須再拆分 |

本文件同時承載 implementation plan 與可執行 Task List。每個 Task 必須能在一個專注工作階段內完成，並同時交付該切片的 production code、focused tests及必要文件更新，不接受「先寫完全部程式、最後才補測試」。

---

## 1. 執行原則

### 1.1 每個 Task 的 Definition of Done

- [ ] 只修改 Task 列明範圍；沒有無關重構、格式化或預先實作未要求能力。
- [ ] Acceptance Criteria 全部有自動化測試或列明的人工驗證證據，先看到失敗測試再完成實作。
- [ ] 新 API 有 strict request／response schema、權限、穩定 Error Code及IDOR保護。
- [ ] DB unique／FK／trigger／transaction／lock行為以專用MySQL integration test驗證，不以mock代替。
- [ ] Focused tests、受影響workspace regression及`npm run lint`通過；有Frontend改動時`npm run build --workspace client`通過。
- [ ] 不skip／刪除既有測試、不降低coverage floor、不加suppressions、不引入production fake或raw-table fallback。
- [ ] Diff無secret、token、完整CSV、Customer銀行資料或不必要個資；log／audit只含allowlisted內容。
- [ ] 形成一個可獨立revert的atomic commit，message採`feat:`、`fix:`、`test:`、`docs:`或`chore:`。

### 1.2 每個 Phase 的 PR Gate

- [ ] Phase內全部Tasks及intermediate checkpoints完成，沒有TODO stub、未處理migration或未解決blocker。
- [ ] 在該Phase專用worktree執行`npm run lint`、server／client tests、coverage、client build及`npm run security:audit`。
- [ ] 需要DB的Phase在專用測試MySQL執行全量migration、integration、concurrency及rollback／recovery案例。
- [ ] PR描述列出需求追溯、migration／rollback影響、測試證據、效能數據、已知限制及下一Phase gate。
- [ ] 合併前fetch最新`main`；若目標已移動，先在Phase分支整合最新main並重跑Phase Gate。
- [ ] PR批准及合併後移除該Phase worktree與branch；下一Phase才由更新後main建立新worktree。

### 1.3 分支與發佈策略

```text
Phase 0 PR: codex/sales-order-phase-0-foundation
       |
       v
Phase 1 PR: codex/sales-order-phase-1-draft
       |
       v
Phase 2 PR: codex/sales-order-phase-2-commitment
       |
       v
Phase 3 PR: codex/sales-order-phase-3-intake
       |
       v
Phase 4 PR: codex/sales-order-phase-4-archive
```

- Phase必須依序合併；同一Phase內只有在shared contract固定後才可並行。
- Migration、shared provider contract、同一aggregate狀態機及Inventory lock order必須順序實作。
- 純函式與對應tests、獨立Vue components、已固定contract的consumer tests可平行，但每個Task仍保持單一owner。
- Capability未完成前以menu／route／job設定保持不可用；不可讓一般使用者進入半成品流程。

### 1.4 實作前硬性 Gate

- Customer、Item、Inventory、Business Master及Scheduler實際程式碼未落地時，相關Task標記BLOCKED，不建立影子table、自由文字ID或production fake繞過。
- 每個Phase開始先盤點main的最新migration；只使用當時下一個連續可用序號，本文不預留固定號碼。
- Inventory Sales batch contract及全域lock order需由Inventory owner review；Sales不得直接寫Inventory tables。
- 50 MB CSV route啟用前，disk-stream Upload mode必須通過memory bound、abort cleanup、symlink及concurrency tests。
- 未選定Channel transport authentication前，只交付canonical JavaScript contract及contract tests，不註冊公共HTTP route。

### 1.5 全域驗證命令

```bash
npm run lint
npm test --workspace server
npm test --workspace client
npm run test:coverage --workspace server
npm run test:coverage --workspace client
npm run build --workspace client
DB_INTEGRATION_TESTS=1 npm test --workspace server
npm run security:audit
npm run verify
```

禁止把migration、integration、capacity或recovery測試指向production、共享UAT或含真實業務資料的資料庫。

---

## 2. Task 索引與依賴摘要

### Phase 0：Upload、Provider與DB Foundation

- [ ] P0-T01 鎖定主幹基線、Migration及Provider readiness
- [ ] P0-T02 擴充Upload設定與disk concurrency budgets
- [ ] P0-T03 實作disk-stream multipart寫入
- [ ] P0-T04 完成disk upload檔案驗證與安全清理
- [ ] P0-T05 完成Upload Framework regression及50 MB memory gate
- [ ] P0-T06 建立Sales permissions、config及公開錯誤基礎
- [ ] P0-T07 建立Sales money、quantity及validation primitives
- [ ] P0-T08 建立Sales state machine及canonical hash primitives
- [ ] P0-T09 落地Customer與Item Sales provider contracts
- [ ] P0-T10 落地Inventory Sales batch reserve／release contract
- [ ] P0-T11 建立Sequence／Operation DB foundation並關閉Phase 0 Gate

### Phase 1：Quotation與人工Draft SO

- [ ] P1-T01 建立Quotation persistence
- [ ] P1-T02 建立Sales Order core persistence
- [ ] P1-T03 建立History、Audit及Conversion persistence
- [ ] P1-T04 實作Sequence、Operation及Audit services
- [ ] P1-T05 完成Quotation Draft垂直切片
- [ ] P1-T06 完成Quotation lifecycle與conversion後端
- [ ] P1-T07 完成Quotation APIs與client contract
- [ ] P1-T08 完成Quotation editor pages
- [ ] P1-T09 完成Quotation read／print pages
- [ ] P1-T10 完成Quotation expiry job
- [ ] P1-T11 完成Sales lookup APIs
- [ ] P1-T12 完成人工Draft SO後端垂直切片
- [ ] P1-T13 完成人工SO editor components
- [ ] P1-T14 完成人工SO建立／編輯pages
- [ ] P1-T15 完成Active inquiry後端
- [ ] P1-T16 完成Active inquiry pages及Phase 1驗收

### Phase 2：Confirmation、Reservation與Backorder

- [ ] P2-T01 建立Reservation mapping與Backorder persistence
- [ ] P2-T02 實作durable confirmation Phase A
- [ ] P2-T03 實作Inventory原子reservation Phase B
- [ ] P2-T04 完成Confirm API、operation polling及UI
- [ ] P2-T05 完成Confirmation Recovery Job
- [ ] P2-T06 完成withdraw／cancel／close後端
- [ ] P2-T07 完成lifecycle操作UI
- [ ] P2-T08 完成Backorder FIFO allocator及manual wake
- [ ] P2-T09 完成Backorder UI與job runtime
- [ ] P2-T10 完成Phase 2併發、crash及效能驗收

### Phase 3：CSV與Channel Intake

- [ ] P3-T01 建立External Key及Import／Intake persistence
- [ ] P3-T02 完成CSV V1 parser與template
- [ ] P3-T03 完成安全Upload及Import Job建立
- [ ] P3-T04 完成Precheck worker
- [ ] P3-T05 完成Import查詢APIs
- [ ] P3-T06 完成Import控制及結果APIs
- [ ] P3-T07 完成External Key claim及atomic Intake confirmation
- [ ] P3-T08 完成Intake worker、lease及recovery
- [ ] P3-T09 完成Canonical Channel V1 contract
- [ ] P3-T10 完成Import UI components及polling
- [ ] P3-T11 完成Import pages
- [ ] P3-T12 完成retention、10,000張容量及Phase 3安全驗收

### Phase 4：Inquiry、Export、Archive與Release Evidence

- [ ] P4-T01 建立Export persistence
- [ ] P4-T02 建立Archive persistence
- [ ] P4-T03 完成Outstanding、Audit及Operation inquiry
- [ ] P4-T04 完成Inquiry pages及安全導覽
- [ ] P4-T05 完成background Export service與worker
- [ ] P4-T06 完成Export APIs
- [ ] P4-T07 完成Export UI及owner-safe download
- [ ] P4-T08 完成Archive eligibility及Open Matter contracts
- [ ] P4-T09 完成Archive aggregate原子搬移
- [ ] P4-T10 完成Archive scheduler、recovery及immutable guards
- [ ] P4-T11 完成Archive inquiry APIs
- [ ] P4-T12 完成Archive pages
- [ ] P4-T13 完成Reconciliation及營運可觀測性
- [ ] P4-T14 完成容量、Restore、Regression及Release Gate

### 2.1 關鍵依賴圖

```text
P0 Upload gate ────────────────┐
P0 Customer/Item contracts ────┼─> Phase 1 Draft/Quotation
P0 Inventory contract ─────────┘          |
                                          v
                               Phase 2 Commitment
                                          |
                                          v
                               Phase 3 Intake/Dedupe
                                          |
                                          v
                               Phase 4 Archive/Release
```

---

## 3. Phase 0 — Upload、Provider與DB Foundation

### 3.1 Phase目標與PR結果

**目標：** 關閉所有共用框架、跨模組、權限、基礎domain及資料庫前置風險。

**完成結果：** 50 MB disk-stream upload、Customer／Item／Inventory contracts、Sales permission／config及Sequence／Operation foundation可被後續垂直切片使用；Sales menu、API及jobs仍不對一般使用者開放。

**Phase PR範圍：** 只包含foundation及contract tests，不包含Quotation／SO可操作頁面。

### Task P0-T01：鎖定主幹基線、Migration及Provider readiness

**Outcome：** 從最新main建立Phase worktree，記錄基線commit、下一migration序號及所有provider的PASS／BLOCKED狀態。

**Dependencies：** None。

**Files likely touched：** `docs/sales_order_management/tasks.md`的Phase 0 readiness紀錄及PR checklist；不修改production code。

**Acceptance criteria：**
- [ ] Customer、Item、Inventory、Currency、Payment Term、Warehouse及Scheduler各有實際owner、檔案路徑及可重現readiness結論。
- [ ] 現有migration前綴唯一且既有檔案不改；記錄Phase 0可用連續序號。
- [ ] 任一硬依賴未落地時清楚標記BLOCKED，沒有fallback table／stub service。

**Verification：** `git status --short --branch`、`git log --oneline -5`、`find server/database/migrations -maxdepth 1 -type f -print | sort`及provider focused tests。

**Commit：** `docs: record sales phase zero readiness`；必須包含實際基線、migration及Provider結論，不建立無內容commit。

**Traceability：** Design §1.3、§2.4、§4.22、§15.1；Requirement §2.4、§12、§16。

**Estimated scope：** XS（read-only readiness gate）。

### Task P0-T02：擴充Upload設定與disk concurrency budgets

**Outcome：** 在不改既有memory route行為下，加入opt-in `storageMode:"disk"`及process-wide disk slot／bytes budgets。

**Dependencies：** P0-T01。

**Files likely touched：** `server/config/api.js`、`server/src/framework/upload/normalizeUploadConfig.js`、`server/src/framework/upload/uploadConcurrencyGate.js`、`server/test/uploadLimits.test.js`、`server/test/configNormalizers.test.js`。

**Acceptance criteria：**
- [ ] 未指定mode仍為memory；disk mode獨立驗max file／total／request bytes、temp root及slot乘積。
- [ ] 無效mode、symlink／不可寫temp root、超budget設定令startup fail closed。
- [ ] memory與disk gate滿載均回503＋`Retry-After`，釋放後可再次取得slot。

**Verification：** `npm test --workspace server -- test/uploadLimits.test.js test/configNormalizers.test.js`。

**Commit：** `feat: add bounded disk upload configuration`。

**Traceability：** Design §0.3 GATE-02、§9.1、§12.1；NFR-PERF-002、FR-CSV-001。

**Estimated scope：** M（3–5個主要檔案）。

### Task P0-T03：實作disk-stream multipart寫入

**Outcome：** Busboy直接把disk-mode file寫入隨機request temp，同時計算size、SHA-256及最多64 KiB prefix。

**Dependencies：** P0-T02。

**Files likely touched：** `server/src/framework/upload/uploadMiddleware.js`、`server/src/framework/upload/normalizeUploadConfig.js`、`server/test/fileTransfer.test.js`、`server/test/fileTransferFailureModes.test.js`。

**Acceptance criteria：**
- [ ] `req.files`只提供`path,storedName,size,mimeType,contentHash,originalName,prefix`，不含完整buffer。
- [ ] Client filename永不參與storage path；file／directory mode為0600／0700。
- [ ] Content-Length存在與否都強制file、total及request byte limits。

**Verification：** `npm test --workspace server -- test/fileTransfer.test.js test/fileTransferFailureModes.test.js`。

**Commit：** `feat: stream opt-in uploads to managed temp files`。

**Traceability：** Design §5.7–5.8、§7.8、§9.1；FR-CSV-001～003、NFR-PERF-002。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 0A：Upload transport

- [ ] P0-T02～P0-T03 focused tests通過，既有memory upload response metadata不變。
- [ ] Review確認disk mode沒有跳過global gate或request size enforcement。

### Task P0-T04：完成disk upload檔案驗證與安全清理

**Outcome：** 補齊CSV bounded-prefix檢查、所有失敗路徑cleanup及受管temp orphan清理。

**Dependencies：** P0-T03。

**Files likely touched：** `server/src/framework/upload/cleanupUploadedFiles.js`、`server/src/services/filetype/FileTypeService.js`、`server/src/services/filetype/builtInFileTypes.js`、`server/test/fileTransferFailureModes.test.js`、`server/test/uploadLimits.test.js`。

**Acceptance criteria：**
- [ ] `text/csv`／`application/csv`只做extension、MIME及文字prefix初篩，不宣稱magic signature。
- [ ] Abort、parser error、auth/schema failure、handler throw及idempotency replay均刪partial file並釋放slot。
- [ ] Orphan cleaner只刪realpath位於受管temp root內且超齡檔案，拒絕symlink traversal。

**Verification：** Upload failure、path traversal、symlink及cleanup focused tests。

**Commit：** `feat: secure and clean disk-stream uploads`。

**Traceability：** Design §8.4、§10.3、§11.6；Requirement §11.2、FR-CSV-018～020。

**Estimated scope：** M（3–5個主要檔案）。

### Task P0-T05：完成Upload Framework regression及50 MB memory gate

**Outcome：** 用真HTTP multipart證明50 MB上傳heap不隨檔案線性增長，並凍結memory-mode backward compatibility。

**Dependencies：** P0-T04。

**Files likely touched：** `server/test/fileTransfer.test.js`、`server/test/fileTransferFailureModes.test.js`、`server/test/uploadLimits.test.js`、`server/test/applicationFactory.test.js`。

**Acceptance criteria：**
- [ ] 50 MB多chunk upload完成且`req.files`沒有完整buffer，heap增量符合review批准門檻。
- [ ] oversized／slow／aborted／concurrent disk uploads不留檔案、不洩漏slot。
- [ ] 全部既有memory upload及idempotency tests無regression。

**Verification：** 上述focused tests加`npm test --workspace server`。

**Commit：** `test: prove disk upload memory and cleanup bounds`。

**Traceability：** Design §10.3、§11.2／11.6／11.7；AC 25、32。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 0B：Upload Foundation Gate

- [ ] Disk-stream 50 MB、security、cleanup及memory regression全部通過。
- [ ] 此checkpoint未通過前，不可實作或註冊Sales Import upload route。

### Task P0-T06：建立Sales permissions、config及公開錯誤基礎

**Outcome：** 建立`sales.view`、`sales.mgmt`、`sales.import`，Sales config normalizer、constants及公開錯誤目錄。

**Dependencies：** P0-T01。

**Files likely touched：** `server/src/modules/authorization/permissionCatalogue.js`、一支動態編號Sales permission migration、`server/config/sales.js`、`server/src/modules/sales/salesConstants.js`、`server/src/modules/sales/salesErrors.js`。

**Acceptance criteria：**
- [ ] 三項permission無隱式inheritance；seed、catalogue及startup guard一致。
- [ ] Domain constants與deployment tuning分開，無效容量／timeout／retention設定在startup失敗。
- [ ] §5.12 error codes有單一後端定義；尚未加入menu或公開Sales handler。

**Verification：** Permission、configuration、`salesConfig.test.js`及error catalogue tests。

**Commit：** `feat: establish sales permissions and configuration`。

**Traceability：** Requirement §4、§11、§13；Design §5.12、§8.1、§12.1。

**Estimated scope：** M（3–5個主要檔案）。

### Task P0-T07：建立Sales money、quantity及validation primitives

**Outcome：** 先以純函式固定money、quantity、UOM factor、line merge及數量守恆。

**Dependencies：** P0-T06。

**Files likely touched：** `server/src/modules/sales/salesMoneyMath.js`、`salesQuantityMath.js`、`salesValidation.js`、`server/test/salesMoneyMath.test.js`、`server/test/salesQuantityValidation.test.js`。

**Acceptance criteria：**
- [ ] Decimal不經JavaScript Number；rounding、factor、base integer及守恆邊界有測試。
- [ ] 同SKU＋UOM且price／note相同會exact merge；不同則`SALES_LINE_MERGE_CONFLICT`。
- [ ] 1～100 merged lines、field lengths、日期、zero-price warning及client-controlled fields有pure validation tests。

**Verification：** `salesMoneyMath.test.js`及`salesQuantityValidation.test.js`。

**Commit：** `feat: define sales money quantity and validation rules`。

**Traceability：** BR-003～010、BR-019～027；Design §3.5–3.6、§10.2。

**Estimated scope：** M（3–5個主要檔案）。

### Task P0-T08：建立Sales state machine及canonical hash primitives

**Outcome：** 固定Quotation／SO／Intake狀態轉換、canonical payload serialization及hash。

**Dependencies：** P0-T06。

**Files likely touched：** `server/src/modules/sales/salesOrderStateMachine.js`、`salesQuotationStateMachine.js`、`salesCanonicalHash.js`、`server/test/salesStateMachines.test.js`、`server/test/salesCanonicalHash.test.js`。

**Acceptance criteria：**
- [ ] State machines只允許Design §3列明的transition，effective quotation expiry可重用pure rule。
- [ ] Canonical serialization不受object key順序影響，decimal及array次序不被改寫。
- [ ] 同event不同payload hash可穩定判定conflict。

**Verification：** State machine全transition table及canonical hash tests。

**Commit：** `feat: define sales state and canonical event rules`。

**Traceability：** BR-001～002、BR-027、BR-036～040；Design §3.2–3.4、§10.2。

**Estimated scope：** M（3–5個主要檔案）。

### Task P0-T09：落地Customer與Item Sales provider contracts

**Outcome：** 提供`new_sale` Customer lookup／credit summary及Item sellability／Sales UOM／suggested price批量lookup。

**Dependencies：** P0-T01；Customer及Item核心模組已落地。

**Files likely touched：** Customer lookup service及test、`server/src/modules/item/ItemLookupService.js`、`server/test/itemLookupService.test.js`及一個lookup integration test，總數不超過5。

**Acceptance criteria：**
- [ ] Customer lookup區分Active、Credit Hold及advisory limit；projection不含銀行帳戶或地址。
- [ ] Item lookup一次批量回Sale UOM、factor、sellability、price／currency及tracking hints，無N+1。
- [ ] Provider unavailable或projection缺欄時fail closed，Sales不直接讀Customer／Item tables。

**Verification：** Customer／Item provider unit、integration及Sales consumer contract tests。

**Commit：** `feat: expose customer and item contracts for sales`。

**Traceability：** FR-SO-003～010、FR-CONF-004～008、BR-011～018；Design §2.4、§11.4。

**Estimated scope：** M（3–5個主要檔案）。

### Task P0-T10：落地Inventory Sales batch reserve／release contract

**Outcome：** 在Inventory owner內提供`reserveAvailableForSalesBatchInTransaction()`、release及event lookup，遵守固定lock order。

**Dependencies：** P0-T01；Inventory核心tables／services已落地。

**Files likely touched：** Inventory reservation service、source/event lookup、unit test、真MySQL concurrency test及Sales consumer contract test。

**Acceptance criteria：**
- [ ] 一次batch在Inventory lock內重讀ATP，逐line回`reserved + uncovered = ordered`且不超賣。
- [ ] 同event replay只回原結果；任一contract mismatch或technical failure令caller transaction rollback。
- [ ] Release batch完整回報每個mapping；不修改generic reservation既有語意。

**Verification：** Inventory provider unit、true-concurrency、unknown-outcome及consumer contract tests。

**Commit：** `feat: add inventory batch reservation contract for sales`。

**Traceability：** FR-CONF-001～020、BR-019～027；Design §2.4–2.6、§2.8、§7.5。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 0C：Provider Contract Gate

- [ ] Customer、Item及Inventory contracts獲各owner review並通過consumer tests。
- [ ] Sales code沒有raw-table fallback、production fake或逐行Inventory call。

### Task P0-T11：建立Sequence／Operation DB foundation並關閉Phase 0 Gate

**Outcome：** 建立`sales_document_sequences`、`sales_operation_requests`及必要test support，完成migration／idempotency foundation。

**Dependencies：** P0-T06～P0-T10。

**Files likely touched：** 兩支按最新main編號的foundation migrations、`server/test/integration/salesFoundationMigrations.integration.test.js`、`server/test-support/fakeSalesDatabase.js`、`server/src/services/idempotency/IdempotencyService.js`。

**Acceptance criteria：**
- [ ] Sequence period／document type及Operation event／payload hash unique constraints按Design §4.3／4.13建立。
- [ ] Migration在空DB、升級DB及重跑情境可收斂；JWT auth variants均按authenticated user scope隔離。
- [ ] Phase 0全量framework、provider、migration及coverage gate通過，Sales capability仍關閉。

**Verification：** Migration integration、idempotency、provider contracts、`npm run verify`及50 MB upload gate。

**Commit：** `feat: add sales operation and sequence foundation`。

**Traceability：** Design §4.3、§4.13、§4.22、§10.3；NFR-PERF-001～002、FR-CH-006～010。

**Estimated scope：** M（3–5個主要檔案）。

### Phase 0 PR Checkpoint

- [ ] Phase 0所有Tasks與Intermediate Checkpoints完成。
- [ ] Upload memory/disk compatibility及50 MB memory-bound證據附於PR。
- [ ] Provider readiness全部PASS；Inventory lock order及contract獲owner批准。
- [ ] 全migration、server regression、coverage、lint及security audit通過。
- [ ] 一般使用者仍無Sales menu／route，Phase 1可安全建立垂直切片。

---

## 4. Phase 1 — Quotation與人工Draft SO

### 4.1 Phase目標與PR結果

**目標：** 交付第一個完整Sales垂直切片，讓使用者可建立、查詢及修改Quotation與人工Draft SO，並可把有效Quotation轉成一張Draft SO。

**完成結果：** Quotation create／issue／cancel／convert、Manual Draft SO create／update、Active list／detail、權限及responsive UI可獨立UAT；本Phase不建立Inventory Reservation。

### Task P1-T01：建立Quotation persistence

**Outcome：** 建立`sales_quotations`及`sales_quotation_lines`，包括unique、FK、version及查詢索引。

**Dependencies：** Phase 0 PR已合併；P0-T11。

**Files likely touched：** 兩支動態編號migrations、`server/test/integration/salesQuotationMigrations.integration.test.js`、`server/test/migrate.test.js`。

**Acceptance criteria：**
- [ ] Header／line欄位、decimal scale、status、snapshot、1–100 line及`UNIQUE(quotation_id,sku_id,sku_uom_id)`符合Design §4.4–4.5。
- [ ] FK delete rules、optimistic version及list indexes由真MySQL驗證。
- [ ] 空DB、升級DB及migration重跑成功。

**Verification：** Migration及constraint integration tests。

**Commit：** `feat: add sales quotation persistence`。

**Traceability：** FR-QUOTE-001～017、BR-001～018；Design §4.4–4.5。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T02：建立Sales Order core persistence

**Outcome：** 建立`sales_orders`及`sales_order_lines`的Draft／confirmed-ready schema與核心索引。

**Dependencies：** P1-T01。

**Files likely touched：** 兩支動態編號migrations、`server/test/integration/salesOrderMigrations.integration.test.js`、`server/test/migrate.test.js`。

**Acceptance criteria：**
- [ ] Header保存source、customer／warehouse／currency snapshot、money totals、status、version及business timestamps。
- [ ] Lines保存ordered／reserved／backorder／fulfilled／cancelled projections並具唯一SKU＋UOM及守恆guard。
- [ ] 常用Active list及exact number索引由production-like explain fixture驗證可使用。

**Verification：** Sales Order migration／constraint／decimal boundary integration tests。

**Commit：** `feat: add sales order core persistence`。

**Traceability：** FR-SO-001～024、BR-001～027；Design §4.8–4.9。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T03：建立History、Audit及Conversion persistence

**Outcome：** 建立`sales_order_status_history`、`sales_audit_logs`及`sales_quotation_conversions`，固定append-only及一對一轉單關係。

**Dependencies：** P1-T01～P1-T02。

**Files likely touched：** 最多三支動態編號migrations、`server/test/integration/salesAuditConversionMigrations.integration.test.js`、`server/test/migrate.test.js`。

**Acceptance criteria：**
- [ ] History／Audit update被trigger拒絕，Active delete只留給受控Archive流程。
- [ ] Quotation與SO conversion均一對一，event id唯一且routing fields可支援未來Archive。
- [ ] Audit detail byte limit及ownership indexes符合Design。

**Verification：** 真MySQLappend-only、unique race及FK tests。

**Commit：** `feat: add sales history audit and conversion persistence`。

**Traceability：** FR-QUOTE-013～017、FR-INQ-009～012、BR-036～040；Design §4.6、§4.12、§4.18。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 1A：Core schema

- [ ] P1-T01～P1-T03 migrations從乾淨及現有schema均可套用。
- [ ] Quantity／money／append-only／conversion constraints有真DB證據。

### Task P1-T04：實作Sequence、Operation及Audit services

**Outcome：** 提供可在同一transaction使用的月度編號、domain event claim／replay及固定Audit builders。

**Dependencies：** P1-T03、P0-T11。

**Files likely touched：** `SalesSequenceService.js`、`SalesOperationService.js`、`SalesAuditService.js`及兩個對應unit test files。

**Acceptance criteria：**
- [ ] SO／QT編號按HKT月份原子遞增，rollback不耗號，999999後fail closed。
- [ ] 同event同payload replay原結果；不同payload回conflict，並能表達unknown outcome。
- [ ] Audit只用action allowlist及safe builders，核心transaction中Audit失敗會rollback。

**Verification：** Sequence concurrency、operation replay及audit projection unit／integration tests。

**Commit：** `feat: add sales sequence operation and audit services`。

**Traceability：** BR-001、BR-027；Design §4.3、§4.13、§7.1、§12.3。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T05：完成Quotation Draft垂直切片

**Outcome：** 交付Quotation create／update的Service、schemas及Handlers。

**Dependencies：** P1-T04、P0-T08～P0-T09。

**Files likely touched：** `SalesQuotationService.js`、`salesQuotationSchemas.js`、create／update handlers及`server/test/salesQuotationService.test.js`；list/detail handlers移至P1-T07。

**Acceptance criteria：**
- [ ] Active Customer及可售SKU可建立Draft；defaults、價格、line merge及totals由server計算。
- [ ] Update只限Draft並使用version CAS；stale或master invalid回穩定error。
- [ ] Create／update與Audit同transaction，失敗不留下header或lines。

**Verification：** Quotation service unit、handler schema及rollback tests。

**Commit：** `feat: add quotation draft commands`。

**Traceability：** FR-QUOTE-001～009、BR-003～018；AC 1～2。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T06：完成Quotation lifecycle與conversion後端

**Outcome：** 交付issue、cancel、effective expiry及一對一conversion至Draft SO。

**Dependencies：** P1-T05、P1-T02。

**Files likely touched：** `SalesQuotationService.js`、issue／cancel／convert handlers、`server/test/salesQuotationConversion.test.js`。

**Acceptance criteria：**
- [ ] Issue重驗Customer／SKU／日期；expiry job或projection令過期Quotation不可轉單。
- [ ] Convert在一個transaction建立完整Draft SO、difference summary及雙向link；重送只回原SO。
- [ ] Cancel／convert非法狀態、競態及不同payload event全部安全拒絕。

**Verification：** Quotation lifecycle、conversion unique race及transaction rollback tests。

**Commit：** `feat: add quotation lifecycle and conversion`。

**Traceability：** FR-QUOTE-010～017、BR-036～040；AC 3～7。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 1B：Quotation backend

- [ ] Quotation Draft→Issue→Convert／Cancel的API＋DB流程通過。
- [ ] Conversion不建立Inventory Reservation，重試不產生第二張SO。

### Task P1-T07：完成Quotation read APIs與client contract

**Outcome：** 加入list／detail handlers、frontend Sales API client及URL／schema contract tests。

**Dependencies：** P1-T05～P1-T06。

**Files likely touched：** list／get Quotation handlers、`client/src/services/sales.js`、`server/test/salesQuotationHandlers.test.js`、`client/test/services/sales.test.js`。

**Acceptance criteria：**
- [ ] List採server pagination、allowlisted filters／sort；detail只回具名projection及allowedActions。
- [ ] Client保留decimal strings、version及eventId，不重算server truth。
- [ ] Viewer可讀、無view不可讀、mgmt without view不可寫。

**Verification：** Server handler metadata tests及`npm test --workspace client -- test/services/sales.test.js`。

**Commit：** `feat: expose quotation query contracts`。

**Traceability：** FR-QUOTE-001～017、FR-INQ-001～004；Design §5.1–5.2、§5.11。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T08：完成Quotation editor pages

**Outcome：** 建立Quotation共用Form及create／edit pages。

**Dependencies：** P1-T07。

**Files likely touched：** `SalesQuotationForm.vue`、`SalesQuotationCreatePage.vue`、`SalesQuotationEditPage.vue`、`QuotationDifferencePanel.vue`、`client/test/pages/sales/quotationEditor.test.js`。

**Acceptance criteria：**
- [ ] UI遵循`docs/frontend-design.md`，權限、loading／empty／error、keyboard及375～1440px可用。
- [ ] 使用者可建立／修改Draft，line merge、currency、totals、server errors及stale version清楚。
- [ ] Convert editor允許加／減SKU及修改數量／價格，提交完整Draft SO input。

**Verification：** Quotation form／create／edit page tests及client build。

**Commit：** `feat: add quotation editing flows`。

**Traceability：** Requirement §10、AC 1～7；Design §6.5。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T09：完成Quotation read／print pages

**Outcome：** 建立Quotation list、detail及A4 browser print，串接issue／cancel／convert allowedActions。

**Dependencies：** P1-T07～P1-T08。

**Files likely touched：** `SalesQuotationsPage.vue`、`SalesQuotationDetailPage.vue`、`SalesQuotationPrintPage.vue`、`client/test/pages/sales/quotationRead.test.js`、`client/test/pages/sales/quotationPrint.test.js`。

**Acceptance criteria：**
- [ ] List server pagination／filters及detail status、totals、difference、target SO link正確。
- [ ] Allowed actions及permission由server result控制，mutation後重新載入事實。
- [ ] Print只用受權detail projection，不加server PDF dependency且不顯示Inventory承諾。

**Verification：** Quotation list／detail／print tests、client build及browser print人工檢查。

**Commit：** `feat: add quotation inquiry and print views`。

**Traceability：** FR-QUOTE-001～017、AC 1～7；Design §6.5。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T10：完成Quotation expiry job

**Outcome：** 以bounded hourly job固化有效過期狀態，並與read projection使用同一pure effective-status規則。

**Dependencies：** P1-T06、P0-T08。

**Files likely touched：** `SalesQuotationExpiryJob.js`、`SalesJobRuntimeService.js`、`server/test/salesQuotationExpiryJob.test.js`、`server/config/scheduler.js`。

**Acceptance criteria：**
- [ ] `ISSUED`且valid-until已過HKT今日的Quotation轉EXPIRED；其他狀態不變。
- [ ] Job未跑前read／convert亦以同rule視為過期，不存在短暫可轉單窗口。
- [ ] Job keyset、cluster lease、AbortSignal、Audit及metrics完整。

**Verification：** HKT boundary、job overlap、projection consistency及shutdown tests。

**Commit：** `feat: expire sales quotations consistently`。

**Traceability：** FR-QUOTE-010～012、BR-036；AC 7。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T11：完成Sales lookup APIs

**Outcome：** 提供Customer、SKU、Warehouse及Channel的Sales purpose lookup handlers與client methods。

**Dependencies：** P0-T09、P1-T07。

**Files likely touched：** `salesLookupHandlers.js`、`salesSchemas.js`、`server/test/salesLookupHandlers.test.js`、`client/src/services/sales.js`、`client/test/services/sales.test.js`。

**Acceptance criteria：**
- [ ] Customer只回new-sale projection；SKU只回sellable UOM／price；Warehouse只回active fulfillment choices。
- [ ] Lookup要求view＋相應write permission，Channel lookup不回credential。
- [ ] q／barcode／page有bounds，submit時仍由Service重驗而不信任lookup結果。

**Verification：** Lookup handler、provider projection、permission、pagination及client contract tests。

**Commit：** `feat: expose bounded sales entry lookups`。

**Traceability：** FR-SO-003～010、FR-CSV-004；Design §5.6。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T12：完成人工Draft SO後端垂直切片

**Outcome：** 交付Manual SO create／update，尚不開放confirm。

**Dependencies：** P1-T04、P0-T08～P0-T09、P1-T02。

**Files likely touched：** `SalesOrderService.js`、`salesSchemas.js`、create／update handlers及`server/test/salesOrderService.test.js`；read handlers納入P1-T15。

**Acceptance criteria：**
- [ ] Source固定MANUAL；Customer、Currency、Warehouse、1–100 lines及price由server驗證／計算。
- [ ] Duplicate line按共用規則merge；update只限Draft及version CAS。
- [ ] Shipping Address、Discount、Tax、Reserved及Backorder不在client writable schema。

**Verification：** Sales Order service、handler strict schema、stale version及rollback tests。

**Commit：** `feat: add manual draft sales order commands`。

**Traceability：** FR-SO-001～024、BR-001～018；AC 8～14。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T13：完成人工SO editor components

**Outcome：** 建立可被create／edit重用的SO Form、line editor及quantity summary。

**Dependencies：** P1-T11～P1-T12、P1-T07的client service。

**Files likely touched：** `SalesOrderForm.vue`、`SalesOrderLineEditor.vue`、`SalesOrderQuantitySummary.vue`、`client/test/components/sales/salesOrderForm.test.js`、`client/test/components/sales/salesOrderLineEditor.test.js`。

**Acceptance criteria：**
- [ ] Customer defaults、SKU／barcode lookup、suggested price currency及zero-price warning正確。
- [ ] 重選同SKU＋UOM聚焦既有行；100-line guard、totals及server field errors可操作。
- [ ] 無Shipping Address／Discount／Tax，component只emit editable projection。

**Verification：** Form／line editor component tests、accessibility assertions及client build。

**Commit：** `feat: add sales order editor components`。

**Traceability：** FR-SO-001～019、Requirement §10.2；AC 8～13。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T14：完成人工SO建立／編輯pages

**Outcome：** 以共用editor components建立create／edit route wrappers及command error handling。

**Dependencies：** P1-T13。

**Files likely touched：** `SalesOrderCreatePage.vue`、`SalesOrderEditPage.vue`、`client/test/pages/sales/salesOrderCreate.test.js`、`client/test/pages/sales/salesOrderEdit.test.js`。

**Acceptance criteria：**
- [ ] Create保存後導向detail；Edit載入version並只送完整editable projection。
- [ ] 409 stale version提供reload，不自動覆蓋；validation errors回填正確field／line。
- [ ] Route guard要求mgmt，API仍獨立要求view＋mgmt。

**Verification：** Create／edit page、route permission、stale／validation及client build tests。

**Commit：** `feat: add sales order create and edit pages`。

**Traceability：** FR-SO-001～019、AC 8～13；Design §6.3。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T15：完成Active inquiry後端

**Outcome：** 提供Active SO list／detail的bounded query、具名projection及response schemas。

**Dependencies：** P1-T12。

**Files likely touched：** `SalesInquiryService.js`、`listSalesOrdersHandler.js`、`getSalesOrderHandler.js`、`server/test/salesOrderQueryHandlers.test.js`、`server/test/integration/salesOrderRead.integration.test.js`。

**Acceptance criteria：**
- [ ] List採count＋page IDs或covering index，server pagination、allowlisted filters／sort及exact keys。
- [ ] Detail bounded讀Header、lines、history，不用多child Cartesian join且不自動掃Archive。
- [ ] Projection不含Customer bank／address、raw internal errors或client不可寫狀態。

**Verification：** Query SQL、handler schema、pagination、permission、IDOR及integration tests。

**Commit：** `feat: expose active sales order inquiries`。

**Traceability：** FR-INQ-001～004、FR-SO-020～024；Design §5.3、§7.9。

**Estimated scope：** M（3–5個主要檔案）。

### Task P1-T16：完成Active inquiry pages及Phase 1驗收

**Outcome：** 完成Active SO list/detail、menu／routes、source／timeline顯示及Phase 1 E2E。

**Dependencies：** P1-T09～P1-T15。

**Files likely touched：** `SalesOrdersPage.vue`、`SalesOrderDetailPage.vue`、`client/config/menu.js`、一個page test及一個Phase 1 integration test。

**Acceptance criteria：**
- [ ] Active list有bounded filters、server pagination、exact number查詢；detail不自動掃Archive。
- [ ] Viewer只讀、Operator可處理Draft；menu、route guard及API權限一致。
- [ ] Quotation→Draft SO及Manual Draft SO E2E、snapshot不被主檔後改寫的測試通過。

**Verification：** Phase 1 API＋DB integration、client pages、permission matrix、lint、coverage及build。

**Commit：** `feat: complete draft sales order inquiry`。

**Traceability：** FR-INQ-001～004、AC 1～14、39～41；Design §6.1–6.5。

**Estimated scope：** M（3–5個主要檔案）。

### Phase 1 PR Checkpoint

- [ ] Quotation及Manual Draft SO可由真HTTP＋MySQL完整操作。
- [ ] Conversion一對一、optimistic version、money／quantity及snapshot tests通過。
- [ ] 所有write permission均為`sales.view + sales.mgmt`；無任何confirm／Reservation effect。
- [ ] 375／768／1024／1440px、keyboard、heading、focus及WCAG 2.1 AA檢查通過。
- [ ] Server／client regression、coverage、lint、build及security audit通過。

---

## 5. Phase 2 — Confirmation、Reservation與Backorder

### 5.1 Phase目標與PR結果

**目標：** 把Draft SO轉成可恢復的庫存承諾，支援partial／zero ATP、Backorder FIFO、撤回、取消及關閉剩餘。

**完成結果：** 人工確認同步顯示每行Reserved／Backorder；技術不確定狀態可恢復；所有Sales與Inventory數量在同一MySQL transaction保持一致。

### Task P2-T01：建立Reservation mapping與Backorder persistence

**Outcome：** 建立`sales_order_line_reservations`及`sales_backorder_entries`，補齊所需indexes、FK及quantity guards。

**Dependencies：** Phase 1 PR已合併；P1-T02。

**Files likely touched：** 兩支動態編號migrations、`server/test/integration/salesCommitmentMigrations.integration.test.js`、`server/test/migrate.test.js`。

**Acceptance criteria：**
- [ ] Inventory reservation ID及line relation唯一；mapping original = consumed＋released＋outstanding可驗。
- [ ] Backorder每line最多一筆，FIFO priority immutable，OPEN時outstanding大於0。
- [ ] Trigger／FK／unique在真MySQL阻擋負數、超量及owner mismatch。

**Verification：** Commitment migration、constraint及quantity invariant integration tests。

**Commit：** `feat: add sales commitment persistence`。

**Traceability：** FR-CONF-009～020、BR-019～027；Design §4.10–4.11。

**Estimated scope：** M（3–5個主要檔案）。

### Task P2-T02：實作durable confirmation Phase A

**Outcome：** `confirm()`先以短transaction claim operation，把Draft轉`CONFIRMING`並保存穩定event／lease。

**Dependencies：** P2-T01、P1-T04。

**Files likely touched：** `SalesOrderConfirmationService.js`、`salesOrderStateMachine.js`、`server/test/salesOrderConfirmationService.test.js`、`server/test-support/fakeSalesDatabase.js`。

**Acceptance criteria：**
- [ ] 同event同payload重送回原狀態；不同payload或stale version拒絕。
- [ ] Phase A只寫Operation、Header、History及Audit，不建立Reservation。
- [ ] Phase A後process crash留下可識別`CONFIRMING`，不能建立第二個intent。

**Verification：** Confirmation Phase A unit、replay及crash-boundary tests。

**Commit：** `feat: persist recoverable sales confirmation intents`。

**Traceability：** FR-CONF-001～003、BR-027；Design §2.5、§7.4。

**Estimated scope：** M（3–5個主要檔案）。

### Task P2-T03：實作Inventory原子reservation Phase B

**Outcome：** 在第二個transaction重驗主檔及line snapshot，批量鎖Inventory並原子寫入Reservation／Backorder。

**Dependencies：** P2-T02、P0-T10。

**Files likely touched：** `SalesOrderConfirmationService.js`、`salesProjections.js`、`server/test/salesOrderConfirmationService.test.js`、`server/test/integration/salesConfirmation.integration.test.js`。

**Acceptance criteria：**
- [ ] Full、partial、zero ATP都成功CONFIRMED，逐line`reserved + backorder = ordered`。
- [ ] Customer Hold、invalid SKU／UOM／Warehouse屬business failure並安全回Draft；Inventory unavailable保持CONFIRMING。
- [ ] Sales header／lines／mapping／queue／History／Audit與Inventory Reservation同transaction commit或rollback。

**Verification：** Unit、真DBtransaction、provider mismatch及rollback injection tests。

**Commit：** `feat: confirm sales orders with atomic inventory reservation`。

**Traceability：** FR-CONF-004～020、AC 15～19；Design §7.4–7.5。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 2A：Confirmation core

- [ ] Full／partial／zero ATP及多line混合結果符合守恆。
- [ ] Phase A／B各crash boundary可重播且不重複Reservation。

### Task P2-T04：完成Confirm API、operation polling及UI

**Outcome：** 提供confirm 200／202 contract、operation-by-event lookup及Frontend穩定event polling。

**Dependencies：** P2-T03。

**Files likely touched：** `confirmSalesOrderHandler.js`、`salesOperationLookupHandler.js`、`useSalesCommandEvent.js`、`SalesOrderDetailPage.vue`、一個client/server contract test。

**Acceptance criteria：**
- [ ] 正常同步回逐line結果；timeout回202、status URL及Retry-After，不誤報成功／失敗。
- [ ] Client在202／network timeout保留同UUID並poll，terminal後才清除。
- [ ] Lookup不可列舉他人event，原操作權限失效時fail closed。

**Verification：** Handler response schema、idempotency、polling timer／abort及detail UI tests。

**Commit：** `feat: expose recoverable sales confirmation flow`。

**Traceability：** FR-CONF-001～020、NFR availability；Design §5.5、§6.3–6.4。

**Estimated scope：** M（3–5個主要檔案）。

### Task P2-T05：完成Confirmation Recovery Job

**Outcome：** 以cluster lease安全恢復過期CONFIRMING，查原event事實後完成或保留重試。

**Dependencies：** P2-T03。

**Files likely touched：** `SalesJobRuntimeService.js`、`SalesConfirmationRecoveryJob.js`、`server/test/salesConfirmationRecoveryJob.test.js`、`server/config/scheduler.js`。

**Acceptance criteria：**
- [ ] Job只claim過期lease，使用原event且遵守AbortSignal／bounded batch。
- [ ] Unknown commit先查Sales Operation及Inventory event，不能盲目重建意圖。
- [ ] 多instance只有一個有效worker，failure有backoff、metrics及safe logs。

**Verification：** Lease、process crash、unknown outcome及shutdown tests。

**Commit：** `feat: recover interrupted sales confirmations`。

**Traceability：** FR-CONF-017～020；Design §2.5、§12.2／12.4。

**Estimated scope：** M（3–5個主要檔案）。

### Task P2-T06：完成withdraw／cancel／close後端

**Outcome：** 實作未履約撤回Draft、取消及部分履約後close remaining，全部原子release Reservation。

**Dependencies：** P2-T03、P0-T10。

**Files likely touched：** `SalesOrderLifecycleService.js`、`salesOrderLifecycleHandlers.js`、`server/test/salesOrderLifecycleService.test.js`、一個lifecycle integration test。

**Acceptance criteria：**
- [ ] Withdraw只限零fulfilled Confirmed並要求5～500字原因；release完成後才回Draft。
- [ ] Draft cancel不呼Inventory；Confirmed零fulfilled可cancel；partially fulfilled只能close remaining。
- [ ] Release缺漏／失敗完整rollback，fulfilled歷史及quantity equation不被改寫。

**Verification：** Lifecycle unit、HTTP＋DB＋Inventory integration及failure injection tests。

**Commit：** `feat: add safe sales order lifecycle commands`。

**Traceability：** FR-LIFE-001～014、AC 21～24；Design §7.6。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 2B：Lifecycle integrity

- [ ] Confirm→Withdraw／Cancel及Partially Fulfilled→Close flows全有或全無。
- [ ] Audit、History、business reason及version CAS完整。

### Task P2-T07：完成lifecycle操作UI

**Outcome：** 在SO detail加入withdraw、cancel、close remaining dialogs及allowedActions刷新。

**Dependencies：** P2-T06。

**Files likely touched：** `SalesOrderDetailPage.vue`、`SalesOrderStatusTimeline.vue`、`SalesOrderQuantitySummary.vue`、`client/src/services/sales.js`、一個detail page test。

**Acceptance criteria：**
- [ ] 按鈕只依server allowedActions及permission顯示，dialog要求有效reason並防重複提交。
- [ ] Release failure／409／202清楚顯示且不樂觀改狀態。
- [ ] 成功後重載Header、lines、History及quantity summary。

**Verification：** Detail page、dialog、permission及error-state tests；client build。

**Commit：** `feat: add sales lifecycle controls`。

**Traceability：** FR-LIFE-001～014、Requirement §10.2；AC 21～24。

**Estimated scope：** M（3–5個主要檔案）。

### Task P2-T08：完成Backorder FIFO allocator及manual wake

**Outcome：** 交付`SalesBackorderService`、FIFO allocation transaction及manual wake API。

**Dependencies：** P2-T01、P2-T03。

**Files likely touched：** `SalesBackorderService.js`、`runSalesBackorderAllocationHandler.js`、`server/test/salesBackorderService.test.js`、一個Backorder integration test。

**Acceptance criteria：**
- [ ] 同Warehouse＋SKU按`priorityAt,orderId,lineNo`配貨，無priority input或插隊API。
- [ ] ATP不足只處理最早entries並停止；0 ATP非error，stale rows安全terminal。
- [ ] Allocation以穩定system event原子新增mapping、Reserved及減少Backorder。

**Verification：** FIFO、partial allocation、stale／technical failure及true-concurrency tests。

**Commit：** `feat: allocate sales backorders in fifo order`。

**Traceability：** FR-CONF-012～016、BR-023；AC 20。

**Estimated scope：** M（3–5個主要檔案）。

### Task P2-T09：完成Backorder UI與job runtime

**Outcome：** 加入Backorder status／summary、manual wake dialog及scheduled allocator runtime。

**Dependencies：** P2-T08。

**Files likely touched：** `SalesBackorderAllocationJob.js`、`BackorderAllocationDialog.vue`、`SalesOrderDetailPage.vue`、`server/test/salesBackorderJob.test.js`、一個client dialog test。

**Acceptance criteria：**
- [ ] Scheduled與manual trigger共用global lease；manual只wake，不開第二個allocator。
- [ ] UI顯示line-level Reserved／Backorder及FIFO說明，不承諾即時配到。
- [ ] Job metrics含open count、oldest age及outcome，不用SO／SKU作高基數labels。

**Verification：** Scheduler overlap、UI及metrics tests。

**Commit：** `feat: operate sales backorder allocation`。

**Traceability：** FR-CONF-012～016、NFR observability；Design §6.4、§12.2／12.4。

**Estimated scope：** M（3–5個主要檔案）。

### Task P2-T10：完成Phase 2併發、crash及效能驗收

**Outcome：** 以真MySQL及production-like負載關閉Commitment capability release gate。

**Dependencies：** P2-T04～P2-T09。

**Files likely touched：** `server/test/integration/salesConcurrency.integration.test.js`、`salesRecovery.integration.test.js`、capacity generator／report及必要coverage floor更新。

**Acceptance criteria：**
- [ ] 20～100 concurrent SO競爭同Warehouse＋SKU，總Reserved不超ATP且無負stock。
- [ ] 所有指定crash／unknown outcome邊界重跑只形成一次effect，reconciliation零mismatch。
- [ ] 50 interactive users加background recovery／backorder時manual confirm P95 ≤3秒且無pool starvation。

**Verification：** 真DBconcurrency、crash injection、capacity run及Phase 2完整regression。

**Commit：** `test: validate sales commitment concurrency and recovery`。

**Traceability：** KPI-04、AC 15～24、NFR-PERF-003；Design §11.2–11.7。

**Estimated scope：** M（3–5個主要檔案）。

### Phase 2 PR Checkpoint

- [ ] Manual confirm 200／202、full／partial／zero ATP及recovery全部通過。
- [ ] Withdraw／cancel／close及Backorder allocation保持Sales／Inventory原子一致。
- [ ] Quantity reconciliation為零差異，沒有duplicate Reservation或queue jump。
- [ ] Confirm P95、DB pool、deadlock retry及job lease證據附於PR。
- [ ] 全量server／client regression、coverage、lint、build及security audit通過。

---

## 6. Phase 3 — CSV與Channel Intake

### 6.1 Phase目標與PR結果

**目標：** 交付版本化CSV批量開單、逐來源訂單例外、長期source dedupe及可供未來平台Adapter使用的canonical contract。

**完成結果：** 一個最多10,000張／100,000行／50 MB的CSV可precheck、確認及背景建立SO；單張失敗不影響其他訂單，重送不重複；本Phase不實作任何指定電商平台Adapter或公共Channel HTTP route。

### Task P3-T01：建立External Key及Import／Intake persistence

**Outcome：** 建立`sales_external_order_keys`、`sales_import_jobs`、`sales_intake_orders`及`sales_intake_errors`。

**Dependencies：** Phase 2 PR已合併；P1-T02、P2-T03。

**Files likely touched：** 兩至三支動態編號migrations、`server/test/integration/salesIntakeMigrations.integration.test.js`、`server/test/migrate.test.js`。

**Acceptance criteria：**
- [ ] Channel＋exact external ID hash具長期unique；原external ID不進index／log但可受控保存。
- [ ] Job／Intake lease、counts、payload hash、processing event及owner FK完整。
- [ ] Error child ownership、最多200 errors及source-intake-to-SO一對一由DB／Service guards保護。

**Verification：** Migration、unique race、FK ownership及lease index integration tests。

**Commit：** `feat: add sales intake and import persistence`。

**Traceability：** FR-CSV-001～020、FR-CH-001～013、BR-028～035；Design §4.7、§4.14–4.16。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T02：完成CSV V1 parser與template

**Outcome：** 實作streaming CSV parser、UTF-8／Header／limit validation、source grouping及versioned template下載。

**Dependencies：** P3-T01、P0-T07。

**Files likely touched：** `salesCsv.js`、`getCurrentSalesImportTemplateHandler.js`、template fixture、`server/test/salesCsv.test.js`、handler test。

**Acceptance criteria：**
- [ ] 支援BOM、CRLF／LF及RFC4180 quotes；拒絕unknown／missing／duplicate header、NUL及非UTF-8。
- [ ] 同source key跨區段可bounded grouping；same SKU＋UOM相同商業條件合併，衝突令整張來源訂單invalid。
- [ ] 50 MB／100,000 rows／10,000 orders／100 lines limits在建立SO前拒絕，templateVersion固定1.0。

**Verification：** `npm test --workspace server -- test/salesCsv.test.js`及template handler contract test。

**Commit：** `feat: define sales csv v1 parsing contract`。

**Traceability：** FR-CSV-001～008、BR-003、BR-010；AC 25～27、32。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T03：完成安全Upload及Import Job建立

**Outcome：** 註冊disk-mode upload handler，把安全temp file在Job transaction後atomic move至private storage。

**Dependencies：** P0-T05、P3-T01～P3-T02。

**Files likely touched：** `uploadSalesImportHandler.js`、`salesImportSchemas.js`、`SalesImportService.js`、`server/test/salesImportUpload.test.js`、一個HTTP＋file integration test。

**Acceptance criteria：**
- [ ] Route只接受field `file`、單一CSV、50 MB file limit及`sales.view + sales.import`。
- [ ] Job建立與source file接手一致；schema／auth／DB／move失敗不留orphan或無檔Job。
- [ ] Upload idempotency按contentHash；相同檔案只warning，不取代External Key業務去重。

**Verification：** 真HTTP multipart、permission、idempotency、atomic move及cleanup tests。

**Commit：** `feat: accept secure sales import uploads`。

**Traceability：** FR-CSV-001～004、FR-CSV-018～020；Design §5.7、§7.8。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 3A：Upload與CSV contract

- [ ] 50 MB disk upload及parser全程無完整buffer。
- [ ] Template、limits、security及failed upload cleanup可獨立驗收。

### Task P3-T04：完成Precheck worker

**Outcome：** 背景stream parse並批量驗證Customer／Item／Warehouse，持久化normalized Intake及bounded errors，但不建SO。

**Dependencies：** P3-T03、P0-T09。

**Files likely touched：** `SalesImportService.js`、`SalesImportJob.js`、`server/test/salesImportService.test.js`、一個precheck integration test。

**Acceptance criteria：**
- [ ] Precheck產生VALID／INVALID／DUPLICATE／WARNING counts與逐order errors，對Sales／Inventory零副作用。
- [ ] Provider lookup批量且無N+1；一張來源訂單任一line錯誤令整張invalid。
- [ ] Worker lease、heartbeat、AbortSignal及crash resume不重複child rows。

**Verification：** Precheck unit、partial batch、provider failure、lease recovery及DB integration tests。

**Commit：** `feat: precheck sales import batches`。

**Traceability：** FR-CSV-005～012、BR-033～035；AC 26～27、29。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T05：完成Import查詢APIs

**Outcome：** 提供Job list／detail、Intake orders及owner-safe errors的bounded read APIs。

**Dependencies：** P3-T04。

**Files likely touched：** list／get Import handlers、list Intake orders／errors handlers及`server/test/salesImportQueryHandlers.test.js`。

**Acceptance criteria：**
- [ ] 所有列表server pagination、allowlisted sort／filters，child ID必須同時驗parent ownership。
- [ ] Viewer可讀安全summary；response不含raw file、normalized full payload或其他Job資料。
- [ ] 不存在與owner mismatch都回相同404，避免IDOR oracle。

**Verification：** Handler metadata、pagination、projection及IDOR tests。

**Commit：** `feat: expose sales import query APIs`。

**Traceability：** FR-CSV-009～013、FR-INQ-001～004；AC 27、33、39～41。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T06：完成Import控制及結果APIs

**Outcome：** 提供confirm、cancel及result CSV下載，固定version／event及安全CSV輸出。

**Dependencies：** P3-T04～P3-T05。

**Files likely touched：** confirm／cancel grouped lifecycle handler、download result handler、`SalesImportService.js`、`server/test/salesImportCommands.test.js`。

**Acceptance criteria：**
- [ ] READY可confirm進QUEUED；cancel只限設計允許狀態，均使用version CAS及event replay。
- [ ] Result逐source order回success／duplicate／error，formula cells neutralize，過期回410。
- [ ] Write需`sales.view + sales.import`；download需view並通過owner-safe relation。

**Verification：** Import command state machine、replay、CSV injection及download security tests。

**Commit：** `feat: control sales imports and download results`。

**Traceability：** FR-CSV-013～020、AC 28～33；Design §5.7。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 3B：Precheck與控制

- [ ] Upload→Precheck→Review→Confirm／Cancel流程在真DB可用。
- [ ] Precheck沒有SO／Reservation effect，所有child queries通過IDOR測試。

### Task P3-T07：完成External Key claim及atomic Intake confirmation

**Outcome：** 實作`SalesIntakeService`，每張VALID Intake以單一transaction claim source key、建Draft並共用confirmation core。

**Dependencies：** P3-T06、P2-T03。

**Files likely touched：** `SalesIntakeService.js`、`salesCanonicalHash.js`、`server/test/salesIntakeService.test.js`、一個external-key concurrency integration test。

**Acceptance criteria：**
- [ ] 成功訂單在同transaction形成SO、Reservation／Backorder、External Key SUCCESS及Intake terminal。
- [ ] Business validation rollback不留下SO、Reservation或External Key；Intake另以短transaction記FAILED。
- [ ] 同Channel＋External ID重送回原SO；不同Channel可各自建立；hash collision fail closed並告警。

**Verification：** Atomic success/failure、duplicate storm、hash collision及commit-unknown tests。

**Commit：** `feat: atomically convert sales intake into confirmed orders`。

**Traceability：** FR-CSV-014～017、FR-CH-004～010、BR-028～035；AC 28～31、34～37。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T08：完成Intake worker、lease及recovery

**Outcome：** Worker以keyset及lease處理VALID Intake，每張互相獨立並沿用processingEventId恢復。

**Dependencies：** P3-T07。

**Files likely touched：** `SalesImportJob.js`、`SalesJobRuntimeService.js`、`server/test/salesIntakeWorker.test.js`、一個worker crash integration test。

**Acceptance criteria：**
- [ ] Job CAS QUEUED→PROCESSING，bounded claim及heartbeat；一張failed不阻止其他成功。
- [ ] Crash／lease expiry／commit unknown先查operation／external key，再以同event重試。
- [ ] Job summary只由child terminal states重算，worker使用fresh service identity permission。

**Verification：** Partial batch、worker crash、stale permission、lease takeover及shutdown tests。

**Commit：** `feat: process sales intake with recoverable workers`。

**Traceability：** FR-CSV-014～020、NFR availability；AC 28～33。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T09：完成Canonical Channel V1 contract

**Outcome：** 建立versioned JavaScript intake contract、authenticated context boundary及discriminated outcomes，不新增HTTP route。

**Dependencies：** P3-T07。

**Files likely touched：** `salesSchemas.js`、`SalesIntakeService.js`、`server/test/salesChannelContract.test.js`、versioned fixtures。

**Acceptance criteria：**
- [ ] V1輸入只接受canonical Customer／Warehouse／SKU／UOM／Currency IDs及decimal strings。
- [ ] Channel identity由transport context覆蓋payload聲稱值；untrusted service identity拒絕。
- [ ] ACCEPTED／DUPLICATE／VALIDATION_FAILED／TECHNICAL_RETRY契約及backward compatibility tests固定。

**Verification：** Channel V1 schema、identity spoof、same-key-different-payload及fixture compatibility tests。

**Commit：** `feat: publish canonical sales channel intake contract`。

**Traceability：** FR-CH-001～013、AC 34～38；Design §5.9。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 3C：Intake與Dedupe

- [ ] CSV與Channel共用同一confirmation core及source dedupe語意。
- [ ] Duplicate、invalid、technical retry及unknown outcome可機器判定且無半張SO。

### Task P3-T10：完成Import UI components及polling

**Outcome：** 建立Import summary、error table、可停止polling及client API contract。

**Dependencies：** P3-T05～P3-T08。

**Files likely touched：** `SalesImportSummary.vue`、`SalesImportErrorTable.vue`、`useImportJobPolling.js`、`client/src/services/sales.js`、`client/test/components/sales/salesImportComponents.test.js`。

**Acceptance criteria：**
- [ ] Summary正確顯示precheck／processing counts及allowedActions，不自行推算job truth。
- [ ] Error table按source／field呈現safe errors，不渲染raw HTML或公式。
- [ ] Polling在hidden／unmount abort並backoff；Import permission只控制write，不阻止有view者查結果。

**Verification：** Components、client service、polling／abort及permission tests。

**Commit：** `feat: add sales import UI components`。

**Traceability：** FR-CSV-001～020、Requirement §10.1–10.2；AC 25～33。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T11：完成Import pages

**Outcome：** 以已測components建立Import list／upload／detail／exceptions pages。

**Dependencies：** P3-T10。

**Files likely touched：** `SalesImportsPage.vue`、`SalesImportCreatePage.vue`、`SalesImportDetailPage.vue`、`SalesImportExceptionsPage.vue`、`client/test/pages/sales/salesImports.test.js`。

**Acceptance criteria：**
- [ ] 使用者可下載template、upload、看precheck、confirm／cancel及下載result。
- [ ] Exceptions可按source／field瀏覽，成功／duplicate結果可導向原SO。
- [ ] Write controls要求import permission；375～1440px、keyboard、loading／empty／error可用。

**Verification：** Import page、route、responsive、accessibility tests及client build。

**Commit：** `feat: add sales import user workflow`。

**Traceability：** FR-CSV-001～020、Requirement §10.1–10.2；AC 25～33。

**Estimated scope：** M（3–5個主要檔案）。

### Task P3-T12：完成retention、10,000張容量及Phase 3安全驗收

**Outcome：** 加入Import file／payload retention，並以標準batch完成容量、安全及恢復驗收。

**Dependencies：** P3-T08～P3-T11。

**Files likely touched：** `SalesFileRetentionJob.js`、retention test、sales import capacity generator／report及一個Phase 3 E2E integration test。

**Acceptance criteria：**
- [ ] Source／result file及payload按90日清理，結構化source result／External Key保留至少7年。
- [ ] 10,000 orders／50,000 lines標準CSV端到端≤30分鐘且memory bounded。
- [ ] MIME spoof、path traversal、symlink、CSV injection、duplicate storm、worker crash及file purge 410通過。

**Verification：** Phase 3真HTTP＋DB E2E、capacity、security、retention及完整regression。

**Commit：** `test: validate sales intake capacity security and retention`。

**Traceability：** KPI-02／03／05／06、NFR-PERF-001～004、AC 25～38。

**Estimated scope：** M（3–5個主要檔案）。

### Phase 3 PR Checkpoint

- [ ] CSV upload、precheck、confirm、worker、result及exceptions可獨立UAT。
- [ ] 10,000張標準batch達時間／memory門檻，一張invalid不影響其他。
- [ ] External Key在retry、crash、跨batch及Channel contract重送下只建立一張SO。
- [ ] 無公共Channel route、平台credential或平台專屬欄位。
- [ ] Server／client regression、coverage、lint、build及security audit通過。

---

## 7. Phase 4 — Inquiry、Export、Archive與Release Evidence

### 7.1 Phase目標與PR結果

**目標：** 交付高容量下的Outstanding／Audit／Export查詢、可恢復月度Archive、Reconciliation及完整發布證據。

**完成結果：** 24個月約730萬Active headers及長期External Keys下常用查詢達標；合資格SO可原子搬至同一MySQL的唯讀Archive並可查詢／匯出；第一階段不永久purge。

### Task P4-T01：建立Export persistence

**Outcome：** 建立`sales_export_jobs`及owner／status／expiry indexes。

**Dependencies：** Phase 3 PR已合併；P3-T01。

**Files likely touched：** 一支動態編號migration、`server/test/integration/salesExportMigration.integration.test.js`、`server/test/migrate.test.js`。

**Acceptance criteria：**
- [ ] Job保存ACTIVE／ARCHIVE filter snapshot、owner、progress、file metadata、expiry及lease。
- [ ] Filter JSON canonical且有byte limit，filename／path不接受client input。
- [ ] Owner/status/created及worker claim indexes在真MySQL驗證。

**Verification：** Export migration、FK、lease及JSON boundary integration tests。

**Commit：** `feat: add sales export job persistence`。

**Traceability：** FR-INQ-005～008、FR-ARC-016；Design §4.17。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T02：建立Archive persistence

**Outcome：** 建立`sales_archive_batches`及所有Active aggregate mirror Archive tables。

**Dependencies：** P4-T01、Phase 3全部Sales schema。

**Files likely touched：** 最多三支動態編號migrations、`server/test/integration/salesArchiveMigrations.integration.test.js`、`server/test/migrate.test.js`。

**Acceptance criteria：**
- [ ] Archive保留原ID、所有snapshot／quantity／source／history／audit，另有batch、archivedAt及rowHash。
- [ ] Archive child FK及query indexes完整，不對可變master或Inventory建立FK。
- [ ] MySQL 5.7不使用partitioning；Archive rows update／delete由後續immutable guard保護。

**Verification：** 空DB／升級DBmigration、mirror column parity、FK及index integration tests。

**Commit：** `feat: add relational sales archive persistence`。

**Traceability：** FR-ARC-001～020、BR-041～048；Design §4.19–4.20。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 4A：Query storage

- [ ] Export及Archive schema可從最新main完整遷移。
- [ ] Active／Archive欄位parity、FK及index review通過。

### Task P4-T03：完成Outstanding、Audit及Operation inquiry

**Outcome：** 提供Outstanding list、Sales Audit list及operation-by-event安全查詢。

**Dependencies：** P3-T08、P2-T09。

**Files likely touched：** `SalesInquiryService.js`、Outstanding／Audit／Operation handlers及`server/test/salesInquiryService.test.js`。

**Acceptance criteria：**
- [ ] Outstanding只回Reserved／Backorder／未履約Active orders，SQL與domain invariant一致。
- [ ] Audit按target／action／actor／date bounded pagination；Operation只能本人或有原操作權限精確查。
- [ ] 三條resource paths不被`/:id` shadow，所有sort／filter由allowlist映射。

**Verification：** Query unit、handler registry collision、pagination、permission及IDOR tests。

**Commit：** `feat: add outstanding audit and operation inquiries`。

**Traceability：** FR-INQ-001～004、009～012；AC 39～43。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T04：完成Inquiry pages及安全導覽

**Outcome：** 建立Outstanding page、Audit／source／status timeline導覽及Active找不到時Archive hint。

**Dependencies：** P4-T03。

**Files likely touched：** `OutstandingSalesOrdersPage.vue`、`SalesOrderSourcePanel.vue`、`SalesOrderStatusTimeline.vue`、`SalesOrderDetailPage.vue`、一個Inquiry page test。

**Acceptance criteria：**
- [ ] Outstanding／Has Backorder filters、server pagination及line quantity summary可用。
- [ ] Active 404只顯示safe Archive搜尋link，不自動union或洩漏Archive existence。
- [ ] Source external ID、Audit reason及operation狀態按permission安全投影。

**Verification：** Page、route、IDOR-safe hint、responsive及accessibility tests。

**Commit：** `feat: add sales outstanding inquiry experience`。

**Traceability：** FR-INQ-001～004、009～012；Design §6.2、§6.4。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T05：完成background Export service與worker

**Outcome：** 實作durable Export Service／Worker、ACTIVE／ARCHIVE filter routing、keyset CSV writer及retention metadata。

**Dependencies：** P4-T01、P4-T03。

**Files likely touched：** `SalesExportService.js`、`SalesExportJob.js`、`server/test/salesExportService.test.js`、`server/test/integration/salesExport.integration.test.js`。

**Acceptance criteria：**
- [ ] Service建立durable job；worker只查一套store、使用keyset、row cap及AbortSignal，不把全結果載入heap。
- [ ] CSV公式字元neutralize、RFC4180 escape，完成前只寫private temp再atomic rename。
- [ ] Worker lease／retry／unknown outcome不產生不完整可下載檔，完成後才atomic publish。

**Verification：** Export service、worker lease、formula、abort cleanup及large-row integration tests。

**Commit：** `feat: generate sales exports through durable jobs`。

**Traceability：** FR-INQ-005～008、FR-ARC-016；AC 43、49。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T06：完成Export APIs

**Outcome：** 提供create／list／status／download handlers及owner-safe response schemas。

**Dependencies：** P4-T05。

**Files likely touched：** create／list／get／download Export handlers及`server/test/salesExportHandlers.test.js`。

**Acceptance criteria：**
- [ ] Create一律202並保存ACTIVE／ARCHIVE filter snapshot；list只回本人jobs。
- [ ] Status及download驗owner relation，不存在與他人job同樣404；expired file回410。
- [ ] Download限定private root、safe Content-Disposition、no-store及nosniff。

**Verification：** Handler metadata、schema、owner／IDOR、path containment及expired download tests。

**Commit：** `feat: expose owner-safe sales export APIs`。

**Traceability：** FR-INQ-005～008、FR-ARC-016；AC 43、49。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T07：完成Export UI及owner-safe download

**Outcome：** 建立Export Jobs page及Active／Archive list的建立匯出入口。

**Dependencies：** P4-T06。

**Files likely touched：** `SalesExportJobsPage.vue`、`SalesOrdersPage.vue`、`SalesArchivePage.vue`、`client/src/services/sales.js`、一個Export page test。

**Acceptance criteria：**
- [ ] 建立時顯示filter snapshot及store，不提供unbounded「全部歷史」捷徑。
- [ ] Polling／download／expired／failed states清楚，使用者只能看到自己的jobs。
- [ ] CSV下載不在client重組資料，頁面hidden／unmount停止polling。

**Verification：** Export page、service、permission、polling及client build tests。

**Commit：** `feat: add sales export job experience`。

**Traceability：** FR-INQ-005～008、AC 43；Design §6.7。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 4B：Inquiry與Export

- [ ] Outstanding、Audit、Operation及Export可在大Active dataset下以bounded query運作。
- [ ] Owner-safe／IDOR／CSV injection及expired file行為通過。

### Task P4-T08：完成Archive eligibility及Open Matter contracts

**Outcome：** 實作finalized＋24月＋無Backorder／Reservation／Operation／下游Open Matter的唯一eligibility判定。

**Dependencies：** P4-T02、P2-T06、下游provider owners可提供contract。

**Files likely touched：** `SalesArchiveService.js`、open-matter provider interface／fixtures、`server/test/salesArchiveEligibility.test.js`及consumer contract test。

**Acceptance criteria：**
- [ ] Cutoff使用last business update，不因read／report更新；所有本地predicate fail closed。
- [ ] 每個已配置downstream provider只可回CLOSED／OPEN／UNKNOWN，UNKNOWN或unavailable必須skip。
- [ ] 沒有接入的未來provider不被假裝為CLOSED；接入新下游須擴充正式contract。

**Verification：** 每個eligibility predicate、boundary date、provider true／false／unknown tests。

**Commit：** `feat: determine safe sales archive eligibility`。

**Traceability：** FR-ARC-001～008、018～020、BR-041～045；AC 45～46。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T09：完成Archive aggregate原子搬移

**Outcome：** 單張Aggregate transaction內copy、read-back hash驗證、routing更新及Active delete。

**Dependencies：** P4-T08。

**Files likely touched：** `SalesArchiveService.js`、`salesCanonicalHash.js`、`server/test/salesArchiveService.test.js`、一個archive transaction integration test。

**Acceptance criteria：**
- [ ] 鎖Header後重驗資格，完整copy header／lines／mapping／terminal backorder／history／audit。
- [ ] Counts、money及canonical row hashes read-back一致後才更新routing並按child順序刪Active。
- [ ] Existing identical Archive row可恢復unknown outcome；different hash回`ARCHIVE_DATA_CONFLICT`並保留Active。

**Verification：** Copy/hash/delete order、failure injection、unknown commit及conflict integration tests。

**Commit：** `feat: atomically archive sales order aggregates`。

**Traceability：** FR-ARC-009～015、BR-046～048；AC 47～51。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T10：完成Archive scheduler、recovery及immutable guards

**Outcome：** 加入月度batch、500張keyset resume、Archive immutable triggers及job lifecycle。

**Dependencies：** P4-T09。

**Files likely touched：** `SalesArchiveJob.js`、`SalesJobRuntimeService.js`、一支immutable trigger migration、`server/test/salesArchiveJob.test.js`、一個job recovery integration test。

**Acceptance criteria：**
- [ ] Interval job以HKT window＋period unique row確保每月只啟動一次，單張transaction避免長鎖。
- [ ] Crash從last scanned cursor續跑；一張失敗不回滾已commit orders且Batch counters正確。
- [ ] Archive UPDATE／DELETE被trigger拒絕，沒有application override或自動`OPTIMIZE TABLE`。

**Verification：** Multi-instance、resume、AbortSignal、immutable及Active availability tests。

**Commit：** `feat: run recoverable monthly sales archiving`。

**Traceability：** FR-ARC-009～015、NFR archive operations；AC 50～52。

**Estimated scope：** M（3–5個主要檔案）。

#### Intermediate Checkpoint 4C：Archive write path

- [ ] Eligibility、atomic move、routing、resume及immutability有真MySQL證據。
- [ ] Archive不可用或hash conflict時Active create／confirm／search仍可運作。

### Task P4-T11：完成Archive inquiry APIs

**Outcome：** 提供Archive-only list／detail／audit及Archive Batch safe metrics APIs。

**Dependencies：** P4-T10。

**Files likely touched：** list／get／audit Archive handlers、archive schemas及`server/test/salesArchiveHandlers.test.js`。

**Acceptance criteria：**
- [ ] Archive list要求bounded filters／最多366日range，exact number可直接查；不union Active。
- [ ] Detail／Audit唯讀且只回snapshot／final state／safe audit；所有write method不存在。
- [ ] External ID先查永久External Key，再依routing只查唯一store。

**Verification：** API schema、route collision、range guard、read-only、permission及routing tests。

**Commit：** `feat: expose bounded sales archive inquiries`。

**Traceability：** FR-ARC-016～017、FR-INQ-001～004；AC 47～49。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T12：完成Archive pages

**Outcome：** 建立Archive list／detail、Active↔Archive明確導覽及read-only匯出入口。

**Dependencies：** P4-T11、P4-T07。

**Files likely touched：** `SalesArchivePage.vue`、`SalesArchiveDetailPage.vue`、`client/src/services/sales.js`、`client/config/menu.js`、一個Archive page test。

**Acceptance criteria：**
- [ ] Empty filter不發unbounded query；日期range、exact number及Customer filters可用。
- [ ] Detail明確標示「歷史唯讀」，沒有edit／confirm／cancel actions。
- [ ] Active與Archive不混在同一table，找不到／服務暫不可用不顯示為零結果。

**Verification：** Archive page、route、read-only、empty-filter及responsive tests；client build。

**Commit：** `feat: add read-only sales archive experience`。

**Traceability：** FR-ARC-016～017、AC 47～49；Design §6.7。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T13：完成Reconciliation及營運可觀測性

**Outcome：** 建立只讀Reconciliation、structured metrics／alerts及Confirmation／Import／Backorder／Archive runbooks。

**Dependencies：** P4-T05、P4-T10。

**Files likely touched：** `SalesReconciliationService.js`、`server/test/salesReconciliationService.test.js`、logging／metrics配置、`docs/runbooks/sales-order-management.md`及一個job stats test。

**Acceptance criteria：**
- [ ] 對數line equation、Inventory mappings、Backorder、External routing及Archive manifest；只報告不自動修復。
- [ ] Alerts涵蓋stuck CONFIRMING／Intake、contract mismatch、old Backorder、Archive failure及query P95。
- [ ] Logs／metric labels不含SO number、External ID、Customer、SKU、User、reason或完整payload。

**Verification：** 每類mismatch、safe logging、metric cardinality及runbook dry-run tests／review。

**Commit：** `feat: reconcile and observe sales order processing`。

**Traceability：** FR-INQ-009～012、FR-ARC-018～020、Requirement §13.4；Design §7.11、§12.3–12.5。

**Estimated scope：** M（3–5個主要檔案）。

### Task P4-T14：完成容量、Restore、Regression及Release Gate

**Outcome：** 以production-like dataset完成效能、備份復原、安全回歸及發布證據。

**Dependencies：** P4-T01～P4-T13。

**Files likely touched：** 容量generator、performance report、restore／archive integration test、release checklist及必要coverage floor更新。

**Acceptance criteria：**
- [ ] 730萬Active headers下常用query P95≤2秒；Archive exact≤3秒、Customer＋366日≤5秒。
- [ ] 2,500萬External Keys exact dedupe／routing走unique hash index；月度30萬candidates不造成長transaction lock。
- [ ] 隔離DB restore後counts／amounts／hashes一致，重播event／source不重複，全部AC 1～53有PASS證據或已批准豁免。

**Verification：** 全量migration、server／client tests、coverage、build、security audit、performance suite、backup／restore及UAT evidence review。

**Commit：** `test: complete sales order release evidence`。

**Traceability：** KPI-01～09、NFR-PERF-001～008、AC 1～53；Design §11.7–11.8、§13.3。

**Estimated scope：** M（3–5個主要檔案）。

### Phase 4 PR Checkpoint

- [ ] Active／Outstanding／Archive queries及Export在目標資料量達標。
- [ ] 月度Archive可中斷續跑、Archive唯讀、失敗不移除Active。
- [ ] Reconciliation為零mismatch，backup／restore及source replay通過。
- [ ] Import／Export file retention已運作；Archive第一階段無永久purge。
- [ ] 所有requirements、BR、NFR及AC都有Task與測試證據追溯。
- [ ] 全量lint、tests、coverage、build、security audit及release review通過，可合併至main。

---

## 8. 需求與Phase追溯

| Phase | Capability／Requirement | 主要驗收 |
|---|---|---|
| Phase 0 | Cross-cutting foundation、GATE-01～09、Provider contracts | Upload／Migration／Provider contract gates |
| Phase 1 | SO-CAP-01／02；FR-QUOTE、FR-SO、BR-001～018／036～040 | AC 1～14、39～41 |
| Phase 2 | SO-CAP-04；FR-CONF、FR-LIFE、BR-019～027 | AC 15～24 |
| Phase 3 | SO-CAP-03；FR-CSV、FR-CH、BR-028～035 | AC 25～38 |
| Phase 4 | SO-CAP-05／06；FR-INQ、FR-ARC、BR-041～048、NFR-PERF | AC 39～53及Release Evidence |

---

## 9. 已知風險與處理

| 風險 | 影響 | 處理 |
|---|---|---|
| Customer／Inventory模組尚未落地 | Phase 0硬阻塞 | P0-T01明確PASS／BLOCKED；不以stub繞過 |
| Upload Framework由memory改支援disk | 共用framework regression | Opt-in mode、既有memory預設不變、Phase 0獨立完整測試 |
| Confirmation跨Sales／Inventory且HTTP可能timeout | 重複Reservation或錯誤結果 | Durable Phase A／B、stable event、operation lookup及recovery |
| Backorder與新訂單競爭相同ATP | FIFO破壞或超賣 | Inventory lock內重讀、固定lock order、global allocator lease |
| 10,000張／日及24月Active資料 | 查詢與DB pool變慢 | Production-like dataset、covering indexes、bounded query／worker |
| Archive搬移跨多個child tables | 資料遺失或雙store衝突 | 單aggregate transaction、read-back hash、routing及immutable triggers |
| 長期External Key資料量 | Dedupe／routing退化 | SHA-256 unique index及2,500萬row explain／load test |
| Phase PR過大 | Review及rollback困難 | 每Task atomic commit、1–5檔、intermediate checkpoints；超限先拆Task |

---

## 10. 明確不在本計劃內

- 指定電商平台Adapter、平台credential管理、公共Channel HTTP transport及平台狀態回傳。
- 多倉拆單、自動選倉、跨倉Fulfillment或調撥。
- Sales階段Lot／Bin分配、Picking、Packing、Issue、Shipping或送貨地址。
- Price List、Customer Price、Discount、Promotion、Tax、自動匯率或Sales Approval。
- Invoice、AR、Payment、Return、Refund或會計分錄。
- Archive永久purge、第二個Database、Data Lake、Search Engine、Queue Broker或Object Storage。
- 重寫既有framework、generic repository／workflow engine或與Sales無關的重構。

任何上述能力若變成需求，先修改`requirement.md`及`design_spec.md`並重新拆分Tasks，不直接塞入現有Phase。

---

## 11. 執行狀態規則

- 只有Task的Acceptance Criteria及Verification均完成並已有commit，才把索引與Task checkbox改為`[x]`。
- Intermediate Checkpoint只代表局部contract穩定，不代表Phase可合併。
- Phase PR Checkpoint未完成時，不得開始下一Phase一般功能；只可做不依賴該結果的read-only準備。
- 出現規格衝突、Provider contract改變、migration collision、效能門檻不可達或安全風險時，立即停止該Task並回報，不靜默改低標準。
- 每個Phase合併後，把實際commit、PR、migration編號及測試報告連結回填本文件，再由最新main建立下一Phase worktree。

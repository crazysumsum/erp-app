# Fulfillment & Shipping Management 開發執行計劃（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 依據 | `docs/fulfillment_shipping_management/01_requirement_spec.md` 0.2、`docs/fulfillment_shipping_management/03_design_spec.md` 0.2 |
| 產生日期 | 2026-09-09 |
| 任務狀態 | ERP Product Owner（Sam）已於 2026-09-14 批准 Phase P0～P3 計劃為 planning baseline；尚未授權執行任何 Task，本文件不代表已開始功能開發 |
| Task List target | 本文件（`05_development_tasks.md`）；依使用者指定，不另建 `tasks/plan.md` 或 `tasks/todo.md` |
| 交付模式 | Phase P0～P3；每個 Phase 一個獨立 worktree／分支、一個 PR、一次完整測試週期 |
| Commit 模式 | 每個 Task 完成並通過 focused verification 後形成一個 atomic commit；Checkpoint 不建立功能 commit |
| Task sizing | 每項 Task 原則上修改 1～5 個主要檔案；預計超過 5 個時須在實作前再拆分 |

本文件同時承載 implementation plan 與可執行 Task List。每個 Task 是一個可在單一專注工作階段完成的最小成果，須同步交付 production code、focused tests及必要文件更新；不得先完成整層程式後才補測試，也不得為通過 Gate 而降低既有品質門檻。

---

## 1. 執行原則

### 1.1 每個 Task 的 Definition of Done

- [ ] 只修改 Task 列明範圍；沒有無關重構、格式化、重複上游規則或預先實作 Out of Scope 能力。
- [ ] Acceptance Criteria 全部有自動化測試或列明的人工證據；行為變更先有可重現失敗，再完成實作。
- [ ] 新 API 使用 strict request／response schema、後端 permission、stable public error、CAS version及適用的 idempotency／IDOR防護。
- [ ] DB unique、FK、trigger、transaction、lock及archive行為以專用真MySQL integration test驗證，不以mock SQL取代。
- [ ] Focused tests、受影響workspace regression及`npm run lint`通過；有Frontend改動時`npm run build --workspace client`通過。
- [ ] 不skip／刪除測試、不降低coverage floor、不增加lint suppression、production fake、raw-table fallback或不受控retry。
- [ ] Log、Audit、error及test evidence不包含token、完整地址／聯絡資料、Customer銀行資料、SQL、stack或完整輸入payload。
- [ ] 形成一個可獨立revert的atomic commit，message使用`feat:`、`fix:`、`test:`、`docs:`或`chore:`。

### 1.2 每個 Phase 的 PR Gate

- [ ] Phase內全部Tasks及Intermediate Checkpoints完成，沒有TODO stub、未解決blocker或未配置migration。
- [ ] 在該Phase專用worktree執行`npm run lint`、server／client tests、coverage、client build及`npm run security:audit`。
- [ ] 涉及DB的Phase在明確標記的專用MySQL 8.0測試庫執行fresh／upgrade migration、integration、concurrency及rollback／recovery案例。（2026-09-14 對齊更正：原文為MySQL 5.7；專案CI實際執行`mysql:8.0`，決策 HD-001。）
- [ ] PR描述列出需求追溯、migration／rollback影響、測試命令與結果、效能或安全證據、已知限制及下一Phase gate。
- [ ] 合併前fetch最新`origin/main`；如target已移動，先在Phase分支整合、解決衝突並重跑完整Phase Gate。
- [ ] 人工review批准後才合併；合併完成後移除該Phase worktree及已合併分支，再從最新main開始下一Phase。

### 1.3 Phase、分支及明確交付結果

| Phase | 建議分支 | PR 的明確結果 | 依賴 |
| --- | --- | --- | --- |
| P0 Contracts, Schema & Quantity Proof | `codex/fulfillment-p0-foundation` | Fulfillment權限、active／archive schema、狀態／數量規則、durable operation及所有跨模組交易契約可安全使用；一般使用者仍看不到功能入口。 | Item、Customer、Sales、Inventory provider readiness；最新main |
| P1 Queue, Fulfillment & Picking | `codex/fulfillment-p1-queue-picking` | 倉務人員可由Queue建立DRAFT工作，完成FEFO／FIFO Allocation、Reallocation、Pick／Short Pick、取消及Pick List。 | P0 |
| P2 Shipment & Atomic Issue | `codex/fulfillment-p2-shipment` | 可由PICKED工作建立Shipment，經兩階段可恢復操作原子完成Inventory Issue、Sales Fulfilled及Delivery Note。 | P1 |
| P3 Reversal, Archive & Release Evidence | `codex/fulfillment-p3-reversal-release` | 可整張Reversal並重開SO；Active／Archive查詢、Export、Archive、Reconciliation及正式發布證據完整。 | P2；Sales Archive協調能力 |

### 1.4 實作前硬性 Gate

Phase P0開始前必須確認：

- [ ] Item Management正式提供SKU／Base UOM／Tracking Policy／Minimum Sale Life的transaction-aware lookup，且Serial SKU可fail closed。
- [ ] Customer Management正式提供Shipping Address／Contact list及transaction-aware ownership、purpose、status、version assertions。
- [ ] Sales Order Management正式提供Fulfillment projection、line／reservation mapping locks、confirm／reverse result及lifecycle guard契約。
- [ ] Inventory Management正式提供candidate、batch allocation／release／issue及「reverse issue並恢復原Reservation」契約與固定lock order。
- [ ] 上游Provider contracts、錯誤碼、decimal-string數量及同transaction executor語意已由provider owner批准並有consumer contract tests。
- [ ] 已fetch最新main並重新盤點全部migration；不得沿用設計文件示例號碼或修改已套用migration。
- [ ] Phase測試使用可清除的專用MySQL測試庫；不得指向開發者日常資料或正式資料。

任何Sales、Inventory或Customer硬依賴未落地時，P0-T01須回報`BLOCKED`並停止該依賴鏈；不得建立影子table、複製domain規則、以自由文字reference或production fake繞過。

### 1.5 依賴圖

```text
Item + Customer + Sales + Inventory provider implementations
                         │
                         ▼
P0: baseline → permission/config → pure rules
              → provider contracts → operation/schema/lock proof
                         │
                         ▼
P1: Queue → DRAFT Claims → Allocation/Reallocation
          → Pick/Short/Cancel → Inquiry/UI/Pick List
                         │
                         ▼
P2: Shipment Draft → Address assertion → Confirm Phase A
                   → Atomic Phase B → Recovery → UI/Documents
                         │
                         ▼
P3: Reversal → Inquiry/Export → Sales-coordinated Archive
             → Reconciliation/Observability → Release Evidence
```

### 1.6 串並行規則及 shared hotspots

- 可平行：契約鎖定後的純規則與schema fixtures；已穩定API的client service／獨立頁面；既有功能的額外安全或效能測試。
- 必須順序：migration allocation先於DDL；schema先於service；provider contract先於consumer；Phase A先於Phase B；confirm完成後才實作reversal；archive eligibility先於archive move。
- 必須共用同一實作者或明確協調：`permissionCatalogue.js`、application configuration、scheduler registry、client menu、public error map、migration integration suite及Sales／Inventory provider services。
- 同一shared hotspot同一時間只由一個Task修改；其他Task等待或整合最新commit，不複製常數、schema、lock helper或錯誤碼。
- Phase不得重疊向一般使用者開放。下一Phase可做read-only研究，但不得在上一Phase Gate前合併依賴其未完成行為的production入口。

### 1.7 全域驗證命令

```bash
npm run lint
npm test --workspace server
npm run test:coverage --workspace server
npm test --workspace client
npm run test:coverage --workspace client
npm run build --workspace client
npm run security:audit
```

Focused verification可使用`npm test --workspace server -- <test-file>`及`npm test --workspace client -- <test-file>`；Phase Gate仍須執行本節完整命令及該Phase列明的真MySQL、效能、安全或恢復驗證。

---

## 2. Task 索引

### Phase P0：Contracts、Schema & Quantity Proof

- [ ] P0-T01 鎖定最新主幹、Migration序號及Provider readiness
- [ ] P0-T02 建立Fulfillment permissions、設定、常數及公開錯誤
- [ ] P0-T03 建立狀態機、數量守恆及canonical payload hash純規則
- [ ] P0-T04 落地Sales Fulfillment provider及lifecycle契約
- [ ] P0-T05 落地Inventory allocation／issue／reversal契約
- [ ] P0-T06 完成Customer Shipping及Item eligibility契約
- [ ] P0-T07 建立文件序號及durable operation persistence／service
- [ ] P0-T08 建立Fulfillment、Claim、Allocation及History schema
- [ ] P0-T09 建立Shipment、Issue、Reversal及History schema
- [ ] P0-T10 建立Audit、Export及Archive schema與不可變保護
- [ ] P0-T11 建立固定lock order、transaction context及測試支援
- [ ] P0-GATE 完成Foundation完整測試及PR

### Phase P1：Queue、Fulfillment & Picking

- [ ] P1-T01 交付Fulfillment Queue查詢垂直切片
- [ ] P1-T02 交付DRAFT Fulfillment建立及Reservation Claim
- [ ] P1-T03 交付Fulfillment list、detail及versioned update
- [ ] P1-T04 交付Allocation Candidates及推薦次序
- [ ] P1-T05 交付批次Allocation及FEFO／FIFO例外控制
- [ ] P1-T06 交付原子Reallocation
- [ ] P1-T07 交付Pick Confirmation及Short Pick
- [ ] P1-T08 交付未出貨Fulfillment取消及Allocation release
- [ ] P1-T09 建立Fulfillment client services及stable error mapping
- [ ] P1-T10 交付Queue、Create及Fulfillment列表頁
- [ ] P1-T11 交付詳情、Allocation、Reallocation及Pick介面
- [ ] P1-T12 交付A4 Pick List投影及列印頁
- [ ] P1-GATE 完成Queue／Picking完整測試及PR

### Phase P2：Shipment & Atomic Issue

- [ ] P2-T01 交付Shipment Draft create／update／cancel
- [ ] P2-T02 交付Customer地址／聯絡人lookup及transaction重驗
- [ ] P2-T03 實作Shipment Confirm Phase A durable intent
- [ ] P2-T04 實作Phase B固定鎖序及跨模組原子交易
- [ ] P2-T05 交付Confirm API、domain idempotency及operation lookup
- [ ] P2-T06 交付Confirm Recovery Job及commit-unknown收斂
- [ ] P2-T07 交付Shipment查詢及Delivery Note／Packing List投影
- [ ] P2-T08 建立Shipment client service及polling控制
- [ ] P2-T09 交付Shipment列表、建立、詳情及取消介面
- [ ] P2-T10 交付Confirm摘要、恢復及A4文件列印頁
- [ ] P2-GATE 完成Shipment／Atomic Issue完整測試及PR

### Phase P3：Reversal、Archive & Release Evidence

- [ ] P3-T01 實作Reversal guard及Phase A intent
- [ ] P3-T02 實作原bucket回補、Reservation恢復及Sales重算
- [ ] P3-T03 交付Reversal API、operation lookup及Recovery Job
- [ ] P3-T04 交付Reversal雙重確認及處理中恢復介面
- [ ] P3-T05 交付Active、Operation、Audit及Finalized查詢
- [ ] P3-T06 交付bounded background Export service及worker
- [ ] P3-T07 交付Export APIs、owner-safe下載及前端工作清單
- [ ] P3-T08 實作Fulfillment Open Matter及Sales Archive eligibility
- [ ] P3-T09 實作Sales協調的Fulfillment原子Archive Participant
- [ ] P3-T10 交付Archive查詢API及唯讀詳情頁
- [ ] P3-T11 交付Reconciliation、可觀測性及runbooks
- [ ] P3-T12 完成容量、安全、restore及UAT release evidence
- [ ] P3-GATE 完成最終完整測試及PR

---

## 3. Phase P0 — Contracts、Schema & Quantity Proof

### 3.1 Phase目標與PR結果

**目標：** 在任何業務入口出現前，關閉跨模組一致性、數量、狀態、冪等、身份、migration及lock order風險。

**明確結果：** 全部active／archive schema、純規則、durable operation及Sales／Inventory／Customer／Item契約可供後續Phase使用；一般使用者沒有Fulfillment menu、route或業務API入口。

### Task P0-T01：鎖定最新主幹、Migration序號及Provider readiness

**Description：** 從最新`origin/main`建立P0 worktree，記錄基線commit、實際下一個migration序號及四個上游Provider的實作位置、版本和測試結果；任何硬依賴缺失均明確標為BLOCKED。

**Acceptance criteria：**

- [ ] Item、Customer、Sales及Inventory每項必要contract均有PASS／BLOCKED、owner、實際symbol及可重現證據。
- [ ] 所有現有migration前綴唯一且已套用內容不變；P0 logical migrations獲分配連續實際序號及FK次序。
- [ ] 任一硬依賴BLOCKED時不建立Fulfillment production stub、影子資料表或可被誤用的feature入口。

**Verification：** `git status --short --branch`、`git log --oneline -5`、migration inventory及Provider focused tests；結果附於P0 PR checklist。

**Dependencies：** 最新`origin/main`；Item、Customer、Sales、Inventory實作分支已合併。

**Files likely touched：** `docs/fulfillment_shipping_management/05_development_tasks.md`及P0 PR描述；如無規格碰撞，不修改production code。

**Traceability：** Requirement §2.4、§12、§16.2；Design §§0.2、6、9.3、13.1、14.2。

**Estimated scope：** XS。

**Commit：** 不需要production commit；若只回填證據，使用`docs: record fulfillment provider readiness`。

### Task P0-T02：建立Fulfillment permissions、設定、常數及公開錯誤

**Description：** 加入三項Fulfillment權限、冪等seed、typed configuration normalizer、狀態／操作／原因allowlists及stable public errors；System Administrator不因名稱自動取得業務權限。

**Acceptance criteria：**

- [ ] `fulfillment.view`、`fulfillment.operation`、`fulfillment.reverse`在catalogue與seed一致且互不繼承；FEFO仍由`inventory.fefo.override`擁有。
- [ ] 設定對lines、allocations、page、lease、export、archive query及reconciliation範圍fail closed，無效值令startup失敗。
- [ ] Server errors與繁中client mapping覆蓋Design §5.6，且不洩漏SQL、stack、path或他人resource存在性。

**Verification：** permission convention、migration、config normalizer、startup guard及error mapping focused tests。

**Dependencies：** P0-T01。

**Files likely touched：** `server/src/modules/authorization/permissionCatalogue.js`、一支動態編號permission migration、`server/config/fulfillment.js`、`server/src/modules/fulfillment/fulfillmentConstants.js`、`server/src/modules/fulfillment/fulfillmentErrors.js`。

**Traceability：** Requirement §4、SEC-001～012；Design §§5.6、7、9.2、12.1。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment permissions and bounded configuration`。

### Task P0-T03：建立狀態機、數量守恆及canonical payload hash純規則

**Description：** 建立不讀DB的Fulfillment／Shipment／Reversal狀態轉換、Base UOM safe-integer數量等式、candidate selection比較及canonical operation hash規則。

**Acceptance criteria：**

- [ ] 所有合法／非法狀態轉換及Planned、Claim、Allocated、Picked、Short、Shipped、Reversed邊界有branch-complete tests。
- [ ] 數量只接受Base UOM正整數decimal string／safe conversion，不使用浮點；全0 Pick與超額在純規則層拒絕。
- [ ] Canonical hash固定key順序、decimal normalization及UTF-8 bytes；相同意圖穩定，同event異payload可識別衝突。

**Verification：** `fulfillmentStateMachines.test.js`、`fulfillmentQuantityMath.test.js`、`pickSequence.test.js`及operation hash unit tests。

**Dependencies：** P0-T02。

**Files likely touched：** `fulfillmentConstants.js`、`fulfillmentValidation.js`、`fulfillmentQuantityMath.js`、`server/test/fulfillmentStateMachines.test.js`、`server/test/fulfillmentQuantityMath.test.js`。

**Traceability：** Requirement §§7、9.1、9.3；BR-001～011、BR-022～030；Design §§3、8.8、11.1。

**Estimated scope：** M。

**Commit：** `feat: define fulfillment state and quantity invariants`。

#### Intermediate Checkpoint 0A：Identity、Configuration及Pure Rules

- [ ] Provider readiness沒有未記錄缺口，migration分配已鎖定。
- [ ] 權限、設定、公開錯誤、狀態及數量純規則focused tests通過。
- [ ] 未新增任何Fulfillment業務route或menu入口。

### Task P0-T04：落地Sales Fulfillment provider及lifecycle契約

**Description：** 在Sales模組落地purpose-limited Fulfillment projection、排序鎖Line／Reservation mapping、confirm／reverse result及Sales lifecycle guard；Reversal須保留Cancelled數量並按正式數量重算SO狀態。

**Acceptance criteria：**

- [ ] Provider只接受可履約SO狀態並回完整line／reservation versions；IDs及quantities與Design §6.1 wire contract一致。
- [ ] Confirm為Reserved減／Fulfilled加，Reversal為Fulfilled減／同Reservation outstanding加；line set、owner、quantity或version不符整筆rollback。
- [ ] Withdraw／cancel／close remaining在Sales已取鎖後呼叫Fulfillment guard；active工作或UNKNOWN依賴均fail closed。

**Verification：** Sales provider consumer contract、state recalculation、lifecycle guard及真MySQL rollback／lock-order integration tests。

**Dependencies：** P0-T01、P0-T03；Sales Order core及Reservation mapping已落地。

**Files likely touched：** `SalesFulfillmentService.js`、Sales lifecycle service、Sales provider tests、Sales/Fulfillment contract integration test、Sales state tests。

**Traceability：** Requirement §§12.1、18.2 GATE-002／004；Design §§2.8、3.6、6.1、6.5。

**Estimated scope：** M。

**Commit：** `feat: add sales fulfillment transaction contracts`。

### Task P0-T05：落地Inventory allocation／issue／reversal契約

**Description：** 在Inventory模組落地bounded candidate、batch allocation／release、batch issue及Fulfillment專用reverse issue並恢復原Reservation的同transaction contracts，所有命令沿用Inventory固定lock order。

**Acceptance criteria：**

- [ ] Candidate對有Expiry採FEFO、其後無Expiry採First Receipt FIFO並回rank、strategy、eligibility及versions；Fulfillment不自行重算資格。
- [ ] Batch allocate／release／issue具exact-set、ownership、version及全有或全無語意；FIFO偏離需原因，FEFO偏離另驗fresh override權限。
- [ ] 專用Reversal只接受原Issue refs，回原bucket並恢復Reservation；原Allocation保持Consumed且每個Issue最多一個reversal movement。

**Verification：** Inventory provider contract、mixed-expiry排序、batch rollback、concurrent allocation／issue及specialized reversal真MySQL tests。

**Dependencies：** P0-T01、P0-T03；Inventory Reservation／Allocation／Posting已落地。

**Files likely touched：** `InventoryLookupService.js`、`InventoryReservationService.js`、`InventoryPostingService.js`、Inventory provider tests、Fulfillment consumer contract integration test。

**Traceability：** Requirement §§8.2、8.5～8.6、12.2；GATE-002／003；Design §§6.2、8.3～8.7。

**Estimated scope：** M。

**Commit：** `feat: add inventory fulfillment batch contracts`。

### Task P0-T06：完成Customer Shipping及Item eligibility契約

**Description：** 驗證並補足Customer Shipping Address／Contact list與transaction assertions，以及Item inventory-purpose batch lookup／eligibility；Fulfillment只消費allowlisted projection，不複製主檔狀態規則。

**Acceptance criteria：**

- [ ] Address／Contact list只回父Customer的Active shipping用途資料並穩定排序default；transaction assert重驗owner、purpose、status及expected version。
- [ ] Item projection包含SKU／Item狀態、Base UOM、inventoryTracked、trackingPolicy及minimumSaleLifeDays；Archived、非tracked或Serial在指定submit points拒絕。
- [ ] Contract接受caller transaction executor，不暗中另開transaction；projection不含銀行資料或其他用途child。

**Verification：** Customer／Item provider tests、停用／改用途／改owner／改version cases及Fulfillment consumer contract tests。

**Dependencies：** P0-T01、P0-T03；Customer及Item provider實作完成。

**Files likely touched：** `CustomerLookupService.js`、`ItemLookupService.js`、Customer provider tests、Item provider tests、Fulfillment master-data contract test。

**Traceability：** Requirement §§8.4、9.2、12.3～12.4；BR-012～021；Design §§6.3～6.4、7.3。

**Estimated scope：** M。

**Commit：** `feat: complete fulfillment master data contracts`。

#### Intermediate Checkpoint 0B：Provider Contract Gate

- [ ] Sales、Inventory、Customer、Item provider／consumer contract tests全部通過。
- [ ] 所有internal write拒絕缺少transaction executor及不可信purpose／actor context。
- [ ] 跨模組payload、stable errors、versions及Sales → Fulfillment → Inventory lock order一致。

### Task P0-T07：建立文件序號及durable operation persistence／service

**Description：** 建立文件序號及operation request schema，實作不可重用單號、event atomic claim、payload hash、lease CAS、bounded replay result及safe source lookup。

**Acceptance criteria：**

- [ ] Fulfillment／Shipment／Reversal單號只在首次成功保存時分配，全系統唯一且失敗後不重用。
- [ ] 同event＋同hash按SUCCEEDED／FAILED／IN_PROGRESS replay；同event＋不同hash回固定source conflict，並發只有一個winner。
- [ ] Lease接管要求matching target及expired lease；operation保留期支持歷史重送且result不保存完整地址或100行payload。

**Verification：** sequence、operation hash、claim race、lease takeover、replay/conflict及真MySQL unique tests。

**Dependencies：** P0-T02、P0-T03。

**Files likely touched：** 一支sequence／operation migration、`FulfillmentOperationService.js`、`fulfillmentOperationService.test.js`、`fulfillmentOperationMigrations.integration.test.js`、operation fixtures。

**Traceability：** Requirement BR-001、BR-024～027、FR-QUEUE-008～009；Design §§4.2、4.14、8.8。

**Estimated scope：** M。

**Commit：** `feat: add durable fulfillment operation foundation`。

### Task P0-T08：建立Fulfillment、Claim、Allocation及History schema

**Description：** 建立Fulfillment header／line、reservation claim、allocation projection及status history tables，加入composite ownership、CAS version、covering indexes及active claim invariants。

**Acceptance criteria：**

- [ ] 所有table具有設計要求的PK、FK、composite ownership、unique、version、epoch時間及Base UOM整數欄位。
- [ ] Active Claims對同SO line／reservation可聚合且不重疊；兩個connection競爭時總active claim不超Inventory outstanding。
- [ ] Allocation保存Inventory refs、selection strategy、rank、recommended摘要、override reason及snapshot；History append-only。

**Verification：** fresh／upgrade／rerun migration、FK／unique／index／trigger tests及雙connection Claim競爭測試。

**Dependencies：** P0-T01、P0-T03、P0-T04、P0-T05、P0-T07。

**Files likely touched：** 兩支動態編號migration、`fulfillmentMigrations.integration.test.js`、Claim concurrency test、schema fixtures。

**Traceability：** Requirement §§6.2～6.4、FR-QUEUE、FR-PICK；Design §§4.3～4.7、9.3。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment claim and allocation schema`。

### Task P0-T09：建立Shipment、Issue、Reversal及History schema

**Description：** 建立Shipment／lines、issue details、shipment history、reversal／details及Fulfillment active shipment pointer，以DB約束保證單一有效Shipment及不可重複成功Reversal。

**Acceptance criteria：**

- [ ] 一張Fulfillment最多一張非CANCELLED Shipment；Cancel後可新建，SHIPPED／REVERSED不能重用原Fulfillment建立另一張。
- [ ] Issue／Reversal details以composite ownership連結原Allocation、Reservation及Movement；每個原Issue最多一筆reversal movement。
- [ ] Snapshot、status、version、operation及history欄位符合設計；不可變facts不能由一般app SQL更新或刪除。

**Verification：** circular FK建立次序、active pointer concurrent create、reversal unique及immutable trigger真MySQL tests。

**Dependencies：** P0-T07、P0-T08。

**Files likely touched：** 兩支動態編號shipment／reversal migration、`shipmentMigrations.integration.test.js`、active-pointer race test、schema fixtures。

**Traceability：** Requirement §§6.5～6.7、FR-SHIP、FR-CONF、FR-REV；Design §§4.8～4.13、4.18。

**Estimated scope：** M。

**Commit：** `feat: add shipment issue and reversal schema`。

#### Intermediate Checkpoint 0C：Active Aggregate Schema

- [ ] Fulfillment、Shipment及Reversal active schema可由fresh及pre-feature DB前向migration。
- [ ] Claim競爭、active Shipment pointer及Reversal唯一性由真MySQL約束證明。
- [ ] 已套用migration不變，所有新constraint名稱可映射stable public errors。

### Task P0-T10：建立Audit、Export及Archive schema與不可變保護

**Description：** 建立Fulfillment Audit、Export Job及全部Archive mirrors，擴充Sales archive manifest，加入必要indexes、owner scope、retention及append-only／immutable triggers。

**Acceptance criteria：**

- [ ] Audit只存allowlisted before／after摘要及actor/source，支持成功／拒絕／失敗證據且一般app account不可UPDATE／DELETE。
- [ ] Export Job由creator owner scope隔離並保存safe filter／cursor／expiry；路徑欄位只允許private export root內受控值。
- [ ] Archive mirrors完整覆蓋header、lines、claims、allocations、issues、history、reversal及必要audit；Sales manifest可保存逐table count／hash。

**Verification：** migration、permission/owner、trigger、archive mirror column parity、manifest及app-account immutability真MySQL tests。

**Dependencies：** P0-T08、P0-T09。

**Files likely touched：** 兩支動態編號audit／archive migration、Sales manifest migration、`fulfillmentArchiveMigrations.integration.test.js`、archive schema parity test。

**Traceability：** Requirement FR-AUDIT、FR-EXPORT、FR-ARC；Design §§4.15～4.18、6.5、9.3。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment audit export and archive schema`。

### Task P0-T11：建立固定lock order、transaction context及測試支援

**Description：** 建立Sales → Fulfillment → Inventory固定取鎖helper、transaction-required command context、sorted ID utilities，以及可注入Phase A／provider／commit邊界故障和雙connection barrier的測試支援。

**Acceptance criteria：**

- [ ] Helper對IDs去重排序並禁止逆序或nested transaction；缺transaction executor／可信actor／固定purpose立即失敗。
- [ ] 測試支援可在operation、provider result、snapshot、history及commit邊界注入失敗，並可同步兩條真connection競爭。
- [ ] 雙人Claim、mixed Expiry sequence及Serial rejection proof不出現deadlock、overclaim或部分寫入。

**Verification：** lock-order unit、transaction context contract、fault injection smoke及真MySQL two-connection tests。

**Dependencies：** P0-T04～P0-T10。

**Files likely touched：** `FulfillmentLockService.js`、`fulfillmentValidation.js`、`server/test-support/fulfillmentFixtures.js`、`server/test-support/fulfillmentConcurrency.js`、`fulfillmentLockService.test.js`。

**Traceability：** Requirement BR-023～027、NFR一致性要求；Design §§2.8～2.9、6、11.2。

**Estimated scope：** M。

**Commit：** `test: add fulfillment transaction and concurrency proof`。

### P0-GATE：Foundation完整測試及PR

**一次完整測試：** 執行§1.7全部命令，加上fresh／upgrade／rerun migrations、Provider consumer contracts、Claim race、mixed Expiry、Serial防護、immutable trigger及lock-order真MySQL套件；保存commit SHA、DB版本、命令及結果。

**Merge acceptance：**

- [ ] 所有P0 Tasks及Intermediate Checkpoints完成，Provider readiness全為PASS。
- [ ] Migration、FK、unique、trigger、operation replay/conflict、雙人Claim及transaction-required contracts有通過證據。
- [ ] 一般使用者仍沒有Fulfillment menu／route；P0 diff只含foundation、provider contracts及schema。
- [ ] PR描述列明forward-only migration與application rollback，經Sales／Inventory／Customer／DB owner review。

---

## 4. Phase P1 — Queue、Fulfillment & Picking

### 4.1 Phase目標與PR結果

**目標：** 交付第一個可由倉務人員端到端操作的垂直流程：Queue → DRAFT → Allocation → PICKING → Pick／Short → PICKED，並支援安全取消及Pick List。

**明確結果：** 獲授權使用者能從一張SO建立一張或多張不超額的Fulfillment工作，按Inventory唯一事實分配到Bin／Lot並完成揀貨；任何步驟均不扣On Hand或增加SO Fulfilled。

### Task P1-T01：交付Fulfillment Queue查詢垂直切片

**Description：** 建立bounded Queue service及`GET /api/v1/fulfillment-queue` handler，按Sales Reservation outstanding減active Claim計算可履約量，提供filter、keyset pagination及穩定排序。

**Acceptance criteria：**

- [ ] 只顯示CONFIRMED／PARTIALLY_FULFILLED且fulfillable>0的SO；純Backorder、CONFIRMING、Cancelled、Closed及Completed不出現。
- [ ] 支援SO、Customer、Warehouse、delivery date、status、has backorder及active work filters；先取bounded order IDs再batch讀lines／claims，無N+1。
- [ ] Negative calculated fulfillable觸發critical mismatch而非截成0；route要求fresh `fulfillment.view`並對未知filter fail closed。

**Verification：** Queue service unit、API schema／permission、MySQL projection及EXPLAIN tests。

**Dependencies：** P0-GATE。

**Files likely touched：** `FulfillmentQueueService.js`、Queue handler/schema、`fulfillmentQueueService.test.js`、Queue API contract test、Queue integration test。

**Traceability：** FR-QUEUE-001～004、FR-QUEUE-010～011；FR-INQ-001；Design §§2.3、5.2、8.1。

**Estimated scope：** M。

**Commit：** `feat: add bounded fulfillment queue inquiry`。

### Task P1-T02：交付DRAFT Fulfillment建立及Reservation Claim

**Description：** 實作`POST /api/v1/fulfillments`，在單一transaction鎖Sales mappings、分配單號、建立header／lines／Claims／history／audit及operation result；同event重送返回原結果。

**Acceptance criteria：**

- [ ] 只接受一張SO、一個Warehouse及正數Base UOM line quantities；提交重驗SO／line／reservation versions及Serial防護。
- [ ] Claims按mapping ID排序分配，active總量不超outstanding；多line任一衝突時整張不建立，On Hand／SO數量不變。
- [ ] Same event/hash replay同一Fulfillment；same event異payload conflict；成功response含server產生number、version及quantity projection。

**Verification：** create service、strict API contract、domain replay、雙connection overclaim及failure rollback真MySQL tests。

**Dependencies：** P1-T01；P0-T04～P0-T11。

**Files likely touched：** `FulfillmentService.js`、create handler/schema、`fulfillmentService.test.js`、create API test、create integration test。

**Traceability：** FR-QUEUE-005～009、FR-QUEUE-012；BR-001～007；Design §§2.3、3.4、8.2。

**Estimated scope：** M。

**Commit：** `feat: create draft fulfillment with reservation claims`。

### Task P1-T03：交付Fulfillment list、detail及versioned update

**Description：** 交付Active Fulfillment list／detail及DRAFT update，detail分批載入children；update完整replace lines並在同transaction以claim delta調整，避免先release產生競爭窗口。

**Acceptance criteria：**

- [ ] List／detail支援設計filters、bounded pagination、history及server-calculated `allowedActions`，child以parent ownership查詢。
- [ ] DRAFT update要求expected version及完整line set；鎖全部受影響mappings後原子套用delta，過時或超額回穩定conflict。
- [ ] 非DRAFT不可修改，client不可寫number、status、snapshots或quantity projections；read不更新business timestamp。

**Verification：** inquiry/update unit、API schema／IDOR、concurrent claim delta及read projection integration tests。

**Dependencies：** P1-T02。

**Files likely touched：** `FulfillmentService.js`、`FulfillmentInquiryService.js`、list/detail/update handlers、`fulfillmentInquiryService.test.js`、Fulfillment API integration test。

**Traceability：** FR-INQ-002、FR-INQ-005；FR-QUEUE-006～007、010；BR-022～027；Design §§5.2、8.2、8.9。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment inquiry and versioned draft update`。

#### Intermediate Checkpoint 1A：Queue及DRAFT Claims

- [ ] Queue → create → detail垂直流程可在專用MySQL執行。
- [ ] 同時建立／修改不造成overclaim或lost update，same event replay不重複工作。
- [ ] Fulfillment建立／更新不改Inventory On Hand、Reservation outstanding、SO Fulfilled或Backorder。

### Task P1-T04：交付Allocation Candidates及推薦次序

**Description：** 交付每張DRAFT Fulfillment的allocation candidate endpoint，批量呼叫Inventory候選contract並返回合資格Bin／Lot、FEFO／FIFO次序、versions及recommended summary。

**Acceptance criteria：**

- [ ] Query綁定父Fulfillment、Warehouse、SKU、Claims及minimum remaining days，拒絕替換任一owner ID。
- [ ] 有Expiry先FEFO，其後無Expiry按First Receipt FIFO；stable tie-break及rank直接使用Inventory結果，不由Fulfillment改寫。
- [ ] Candidate已變更、依賴不可用或Inventory result set不完整時fail closed並提供reload指引。

**Verification：** candidate service、provider contract、API IDOR、mixed Expiry及bounded result tests。

**Dependencies：** P1-T03；P0-T05。

**Files likely touched：** `FulfillmentAllocationService.js`、candidate handler/schema、`fulfillmentAllocationService.test.js`、candidate API test、Inventory candidate contract test。

**Traceability：** FR-PICK-001～005；BR-014～016；Design §§2.4、5.2、6.2、8.3。

**Estimated scope：** M。

**Commit：** `feat: expose inventory-ranked allocation candidates`。

### Task P1-T05：交付批次Allocation及FEFO／FIFO例外控制

**Description：** 交付Fulfillment Allocate命令，以一個event及transaction建立整批Inventory Allocations與本地projection，成功後狀態轉PICKING並保存recommendation、selection及例外證據。

**Acceptance criteria：**

- [ ] Selected set無duplicate且完整覆蓋active Claims；任一line不足或version失效時全部rollback，狀態維持DRAFT。
- [ ] FIFO偏離要求`fulfillment.operation`及原因；FEFO偏離另要求fresh `inventory.fefo.override`，不合資格庫存任何權限都拒絕。
- [ ] Provider result IDs、quantity、owner、strategy及versions須exact match；不匹配回critical contract error，不保存部分projection。

**Verification：** allocation unit、permission matrix、strict API、multi-line rollback及Inventory reconciliation真MySQL tests。

**Dependencies：** P1-T04。

**Files likely touched：** `FulfillmentAllocationService.js`、allocate handler/schema、`fulfillmentAllocationService.test.js`、allocate API test、allocation integration test。

**Traceability：** FR-PICK-003～007、FR-PICK-012；SEC-003；Design §§3.5、5.2、8.3。

**Estimated scope：** M。

**Commit：** `feat: allocate fulfillment with sequence controls`。

### Task P1-T06：交付原子Reallocation

**Description：** 交付PICKING狀態下的Reallocate命令，在同一event及transaction先驗舊Allocation、再由Inventory原子release＋allocate；任何後段失敗保留完整原結果。

**Acceptance criteria：**

- [ ] 只允許未Pick Confirm的PICKING工作，要求expected Fulfillment及Allocation versions與exact old/new sets。
- [ ] Release舊結果後create新結果任一步失敗均rollback；不出現無Allocation窗口或部分新projection。
- [ ] History／Audit保存舊／新摘要、recommendation、actual selection、actor、reason及Inventory refs；same event重送不重複release。

**Verification：** reallocate service、API contract、failure injection、concurrent reallocate／cancel及Inventory projection reconciliation tests。

**Dependencies：** P1-T05。

**Files likely touched：** `FulfillmentAllocationService.js`、reallocate handler/schema、`fulfillmentReallocationService.test.js`、reallocate API test、reallocate integration test。

**Traceability：** FR-PICK-011～012；BR-023～027；Design §§2.4、5.2、8.3。

**Estimated scope：** M。

**Commit：** `feat: add atomic fulfillment reallocation`。

#### Intermediate Checkpoint 1B：Allocation及Reallocation

- [ ] Mixed Expiry／FIFO、FEFO權限、multi-Bin／Lot及candidate stale cases通過。
- [ ] Allocate／Reallocate failure injection沒有部分Inventory或Fulfillment效果。
- [ ] Inventory Allocation truth與Fulfillment projection逐ID、quantity及version一致。

### Task P1-T07：交付Pick Confirmation及Short Pick

**Description：** 交付PICKING工作的Pick Confirm命令，要求完整Allocation set並原子保存實揀、短揀、差額release、Claim調整、history、audit及PICKED狀態。

**Acceptance criteria：**

- [ ] 每個Allocation actual picked可為0但不可負或超額；遺漏ID不當0，整張至少一筆picked>0。
- [ ] Short quantity要求line reason，差額只release Allocation並使Claim active減／released增；Inventory Reservation outstanding保持不變。
- [ ] 任一步失敗全部rollback；same event replay不重複release或累加picked，成功後結果不可直接修改。

**Verification：** pick quantity unit、strict API、short reason、multi-line rollback、idempotency及Inventory release integration tests。

**Dependencies：** P1-T05；P1-T06如使用者曾reallocate。

**Files likely touched：** `FulfillmentPickingService.js`、pick-confirm handler/schema、`fulfillmentPickingService.test.js`、pick API test、pick integration test。

**Traceability：** FR-PICKCONF-001～010；BR-004～005、008～009；Design §§2.4、3.3、8.4。

**Estimated scope：** M。

**Commit：** `feat: confirm fulfillment picks and short quantities`。

### Task P1-T08：交付未出貨Fulfillment取消及Allocation release

**Description：** 交付DRAFT／PICKING／PICKED Fulfillment取消；按狀態要求原因及goods-returned確認，原子release未消耗Allocations及Claims後才轉CANCELLED。

**Acceptance criteria：**

- [ ] DRAFT可直接取消；PICKING／PICKED要求原因，有實際picked時另要求已放回原Bin／Lot確認。
- [ ] 有非CANCELLED Shipment的Fulfillment拒絕取消；release失敗時狀態、Claims及Allocations完整保留。
- [ ] 成功後Queue可重新看到未消耗Reservation，且取消不改On Hand、SO Fulfilled或Backorder。

**Verification：** cancel policy、strict API、shipment guard、release rollback、concurrent cancel／reallocate及Queue reconciliation tests。

**Dependencies：** P1-T02、P1-T05、P1-T07。

**Files likely touched：** `FulfillmentService.js`、cancel handler/schema、`fulfillmentCancelService.test.js`、cancel API test、cancel integration test。

**Traceability：** FR-LIFE-001～003；BR-008～009、029；Design §§3.1、5.2、8.2。

**Estimated scope：** M。

**Commit：** `feat: cancel unshipped fulfillments safely`。

### Task P1-T09：建立Fulfillment client services及stable error mapping

**Description：** 建立typed-ish Fulfillment HTTP service、filter／pagination normalization、operation response處理及安全繁中錯誤映射，作為全部P1頁面的唯一client contract。

**Acceptance criteria：**

- [ ] Queue、Fulfillment CRUD、candidate、allocate、reallocate、pick、cancel及Pick List calls與server schemas一致。
- [ ] 409 stale/candidate/sequence/short conflicts保留使用者輸入並提供reload／修正動作；403／404不洩漏resource存在性。
- [ ] Query filters可序列化至URL且未知status／sort不送出；client不自行計算allowed actions或business quantities。

**Verification：** client service request/response、error mapping、URL filter及202/409 branch unit tests。

**Dependencies：** P1-T01～P1-T08 API contracts穩定。

**Files likely touched：** `client/src/services/fulfillment.js`、client error message map、`client/test/fulfillmentService.test.js`、`client/test/fulfillmentErrors.test.js`。

**Traceability：** Design §§5.1～5.2、9.4、10；SEC-001～005。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment client contracts`。

#### Intermediate Checkpoint 1C：Picking Backend及Client Contract

- [ ] Create → allocate → reallocate → short/full pick → cancel的合法／非法路徑有API及MySQL證據。
- [ ] Client request／response與stable errors已固定，Frontend無重複business calculation。
- [ ] 權限撤銷、stale version及provider unavailable均fail closed並保留可恢復輸入。

### Task P1-T10：交付Queue、Create及Fulfillment列表頁

**Description：** 依`docs/frontend-design.md`交付Queue、create panel及Fulfillment list，以PageHeader、DataTable、URL filters及server pagination呈現工作；route及sidebar按`fulfillment.view`控制。

**Acceptance criteria：**

- [ ] Queue顯示SO／Customer／Warehouse／日期／狀態及quantity摘要，可選lines／quantity建立工作並處理stale conflict。
- [ ] List支援My Recent Work、Active、Exceptions、Finalized視圖與design filters；直接URL無權時安全403。
- [ ] 375～1440px、鍵盤、焦點、loading／empty／error及非純顏色狀態表達符合前端規範。

**Verification：** Vue component／route／permission tests、responsive DOM checks及手動鍵盤流程。

**Dependencies：** P1-T09。

**Files likely touched：** `FulfillmentQueuePage.vue`、`FulfillmentsPage.vue`、`FulfillmentCreatePanel.vue`、client menu config、P1 list/page tests。

**Traceability：** FR-QUEUE、FR-INQ-001～003；Requirement §10；Design §§10.1～10.2、10.6。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment queue and work list pages`。

### Task P1-T11：交付詳情、Allocation、Reallocation及Pick介面

**Description：** 交付Fulfillment detail與Allocation／Pick panels，顯示quantity守恆、Bin／Lot／Expiry、推薦與實選、history及server允許操作；所有例外與確認使用共用元件。

**Acceptance criteria：**

- [ ] Allocation預設顯示Inventory推薦次序；FIFO原因與FEFO權限／原因明確區分，candidate conflict可reload而不靜默改選。
- [ ] Pick表單按Allocation輸入actual quantity，Short必填reason，全0提示使用取消；stale submit保留輸入並引導重載。
- [ ] 頁面tabs、heading、focus、alert、badge文字及responsive table/card均可及，按鈕只顯示server `allowedActions`。

**Verification：** allocation/picking component、detail page、permission、focus/error recovery及responsive tests。

**Dependencies：** P1-T09、P1-T10。

**Files likely touched：** `FulfillmentDetailPage.vue`、`AllocationPanel.vue`、`PickConfirmationPanel.vue`、`FulfillmentQuantitySummary.vue`、detail/picking page tests。

**Traceability：** FR-PICK-001～012、FR-PICKCONF-001～010、FR-INQ-005；Design §§10.3、11.5。

**Estimated scope：** M。

**Commit：** `feat: add allocation and pick confirmation experience`。

### Task P1-T12：交付A4 Pick List投影及列印頁

**Description：** 建立server-side Pick List projection及A4 browser print page，以當前PICKING Allocation及已保存snapshot產生穩定排序的內部作業文件。

**Acceptance criteria：**

- [ ] 文件包含Fulfillment／SO、Customer、Warehouse、SKU、Planned、Bin、Lot、Expiry、sequence及notes，按Bin／Lot／SKU穩定排序。
- [ ] 只有`fulfillment.view`可列印，projection與當前Allocation一致；列印Audit不改last business update或archive eligibility。
- [ ] 使用escaped text、private no-store headers及A4 print CSS；不顯示price、tax、cost、銀行資料或技術錯誤。

**Verification：** print projection unit、API authorization/header、XSS及browser print DOM／A4 snapshot tests。

**Dependencies：** P1-T05、P1-T09。

**Files likely touched：** `FulfillmentPrintService.js`、Pick List handler/schema、`PickListPrintPage.vue`、print service test、print page test。

**Traceability：** FR-PICK-008～010、FR-DOC-001；BR-031、033；Design §§8.9、10.3。

**Estimated scope：** M。

**Commit：** `feat: add auditable fulfillment pick list`。

#### Intermediate Checkpoint 1D：完整Queue至PICKED體驗

- [ ] 一般Warehouse Operator可由Queue完成create、allocate、pick及Pick List；Viewer只有查詢／列印。
- [ ] 375／768／1024／1440視圖、鍵盤、焦點及直接URL權限測試通過。
- [ ] 所有狀態與數量由server projection顯示，Frontend沒有自報status或重算Inventory eligibility。

### P1-GATE：Queue／Picking完整測試及PR

**一次完整測試：** 執行§1.7，加上Queue／Claims／Allocation／Reallocation／Pick／Cancel真MySQL及雙connection tests、FEFO／FIFO權限矩陣、Pick List安全／列印、P1頁面responsive及Inventory reconciliation。

**Merge acceptance：**

- [ ] Queue → DRAFT → PICKING → PICKED／Short Pick與取消流程均有端到端證據。
- [ ] Overclaim、multi-Line／Bin／Lot、stale version、same-event replay及任一步rollback均不留下部分效果。
- [ ] P1操作不減On Hand、不consume Reservation、不增加SO Fulfilled，也不建立Shipment。
- [ ] PR只開放P1能力；P2 Shipment action仍由capability gate隱藏／拒絕。

---

## 5. Phase P2 — Shipment & Atomic Issue

### 5.1 Phase目標與PR結果

**目標：** 由PICKED Fulfillment建立一張有效Shipment，經可恢復的Phase A／B流程，在單一MySQL transaction原子完成Inventory Issue、Reservation consume、Shipment／Fulfillment狀態及Sales Fulfilled更新。

**明確結果：** 使用者可選Customer有效Shipping Address、保存選填物流資料及確認出貨；HTTP timeout、process crash或commit結果不明不會產生第二份出庫效果，並可由原event收斂。

### Task P2-T01：交付Shipment Draft create／update／cancel

**Description：** 交付Shipment list／detail基礎及DRAFT create／update／cancel命令；create鎖Fulfillment並使用active pointer保證最多一張非CANCELLED Shipment，Draft只允許修改地址／Contact及物流欄位。

**Acceptance criteria：**

- [ ] 只可由PICKED Fulfillment建立；same create intent返回既有Shipment，其他event回`SHIPMENT_ALREADY_EXISTS`，並發create最多一個winner。
- [ ] Draft只能修改有效Address／Contact reference、carrier、tracking、package、weight及notes，不可修改SKU、Bin、Lot或picked quantity。
- [ ] Cancel Draft不產生Issue／SO效果，清active pointer並使Fulfillment維持／返回PICKED；SHIPPED不可update或一般cancel。

**Verification：** Shipment service、strict API、active-pointer race、version conflict及create/update/cancel真MySQL tests。

**Dependencies：** P1-GATE；P0-T09。

**Files likely touched：** `ShipmentService.js`、Shipment CRUD handlers/schemas、`shipmentService.test.js`、Shipment API test、Shipment integration test。

**Traceability：** FR-SHIP-001～003、008～012；FR-LIFE-004～005；BR-029；Design §§2.5、5.3、8.5。

**Estimated scope：** M。

**Commit：** `feat: add versioned shipment draft lifecycle`。

### Task P2-T02：交付Customer地址／聯絡人lookup及transaction重驗

**Description：** 交付Fulfillment專用Shipping Address／Contact lookup handlers及Shipment Draft選擇行為，並建立Confirm提交時使用同transaction executor的ownership、purpose、status、version assertions。

**Acceptance criteria：**

- [ ] Lookup要求view＋operation及父SO Customer ownership，只回Active shipping資料，唯一有效default排前；Contact可為空。
- [ ] 沒有Address可保留PICKED工作但不可Confirm；不得接受自由文字或靜默改選，提供Customer維護入口。
- [ ] 頁面載入後停用、移除用途、改owner或改version時Confirm必須失敗；Contact選填但選用時同樣重驗。

**Verification：** lookup API permission／IDOR、Customer provider contract、address change race及no-address integration tests。

**Dependencies：** P2-T01；P0-T06。

**Files likely touched：** fulfillment lookup handlers/schemas、`ShipmentService.js`、Customer contract integration test、lookup API test、address assertion test。

**Traceability：** FR-SHIP-004～007；FR-CONF-002、004；BR-017～021；Design §§5.4、6.3、8.5。

**Estimated scope：** M。

**Commit：** `feat: add shipment address and contact validation`。

#### Intermediate Checkpoint 2A：Shipment Draft及地址

- [ ] PICKED → DRAFT Shipment建立／修改／取消及重建流程通過。
- [ ] Active pointer並發唯一性、Address owner／purpose／version及no-address分支有真MySQL證據。
- [ ] 尚未開放Confirm時，Draft操作不扣Inventory或修改Sales quantities。

### Task P2-T03：實作Shipment Confirm Phase A durable intent

**Description：** 實作`startConfirmation()`，在短transaction內以event/hash claim operation、保存immutable target/payload摘要、取得lease並把Shipment轉SHIPPING；回202 status URL，不執行Inventory或Sales效果。

**Acceptance criteria：**

- [ ] 只接受完整DRAFT Shipment、父Fulfillment=PICKED、fresh actor及`fulfillment.operation`；新event不能繞過既有SHIPPING intent。
- [ ] 同event／hash按原狀態replay，同event異payload conflict；Phase A commit後只存在SHIPPING及operation evidence，無Issue或Sales更新。
- [ ] Payload hash涵蓋Shipment/version/Address/Contact/物流欄位及確認意圖；result／log不含完整地址或敏感payload。

**Verification：** confirmation Phase A unit、API preflight、same/different event、concurrent double-click及post-Phase-A crash tests。

**Dependencies：** P2-T01、P2-T02；P0-T07。

**Files likely touched：** `ShipmentConfirmationService.js`、confirm handler/schema、`shipmentConfirmationService.test.js`、confirm API test、Phase A integration test。

**Traceability：** FR-CONF-001、006～007、015；BR-024～026；Design §§2.6、8.6、8.8。

**Estimated scope：** M。

**Commit：** `feat: persist durable shipment confirmation intent`。

### Task P2-T04：實作Phase B固定鎖序及跨模組原子交易

**Description：** 實作`completeConfirmation(eventId)`，鎖operation後依Sales → Fulfillment → Inventory固定順序重驗全部資料，以exact Issue batch呼叫Inventory，再套用Sales結果及保存snapshot／history／audit／operation success。

**Acceptance criteria：**

- [ ] Fresh驗證涵蓋actor、SO、lines/mappings、Fulfillment、Shipment、Address/Contact、Item/Serial、Claims、Allocations、Bin/Lot/Expiry/Status及versions。
- [ ] Inventory Issue、Reservation consume、Sales Reserved/Fulfilled、Shipment／Fulfillment SHIPPED、Claims consumed及所有snapshots在同一commit；result set／quantity／owner不符全部rollback。
- [ ] Business error證明未有外部效果時同transaction回DRAFT並標記FAILED；technical／commit unknown保留SHIPPING供Recovery，不推測失敗。

**Verification：** confirmation unit、provider set mismatch、100-line multi-Bin/Lot atomicity、failure injection、deadlock/rollback及Sales/Inventory reconciliation真MySQL tests。

**Dependencies：** P2-T03；P0-T04～P0-T06、P0-T11。

**Files likely touched：** `ShipmentConfirmationService.js`、confirmation transaction test、Sales provider integration test、Inventory issue integration test、confirmation failure-injection test。

**Traceability：** FR-CONF-002～005、008～014、016；BR-005、009～011、026～027；GATE-002；Design §§2.6、6.1～6.4、8.6。

**Estimated scope：** M。

**Commit：** `feat: atomically confirm shipment across sales and inventory`。

### Task P2-T05：交付Confirm API、domain idempotency及operation lookup

**Description：** 完成Confirm handler的同步成功／202不明結果envelope及`GET /api/v1/fulfillment-operations/by-event/:eventId`，安全回傳SUCCEEDED／FAILED／IN_PROGRESS結果並套用target owner visibility。

**Acceptance criteria：**

- [ ] Confirm要求strict schema、version、event及framework idempotency；3秒內未完成時回202、correlation、status URL及Retry-After。
- [ ] Operation lookup只讓具target view且可見該aggregate的actor讀取，回bounded IDs/status/versions，不回完整payload、address或internal error。
- [ ] Same HTTP key異payload及same event異payload分別穩定409；重送成功結果不重複Issue、Consume或Fulfilled。

**Verification：** Confirm／operation API contract、permission/IDOR、same-key conflict、same-event replay及202 envelope tests。

**Dependencies：** P2-T03、P2-T04。

**Files likely touched：** confirm handler/schema、operation lookup handler/schema、`FulfillmentOperationService.js`、Confirm API test、operation API test。

**Traceability：** FR-CONF-006～009、015～016；SEC-001～005；Design §§5.1、5.3、5.5、8.8。

**Estimated scope：** M。

**Commit：** `feat: expose recoverable shipment confirmation outcomes`。

#### Intermediate Checkpoint 2B：Atomic Confirmation Core

- [ ] 100行／多Bin／Lot confirm成功只產生一組Issue、Sales及Shipment效果。
- [ ] 任一provider／snapshot／history／audit失敗均不留下部分效果。
- [ ] Double click、HTTP retry、event replay及commit結果不明均以原event收斂。

### Task P2-T06：交付Confirm Recovery Job及commit-unknown收斂

**Description：** 建立cluster-leased Confirmation Recovery Job，掃描過期SHIPPING operations，以原event/hash/actor/target CAS接管並續跑Phase B；unknown commit先按source outcome查證，絕不產生新event。

**Acceptance criteria：**

- [ ] Job每次bounded batch、lease renew小於lease一半、尊重AbortSignal；同一operation同時最多一個有效worker。
- [ ] Phase A後crash、Phase B前crash及connection lost after commit均收斂為唯一SUCCEEDED／FAILED／仍IN_PROGRESS結果。
- [ ] 永久business failure不無限retry；transient failure使用bounded exponential backoff+jitter並產生safe metrics／alerts。

**Verification：** recovery job unit、lease race、process crash、commit-unknown source lookup、shutdown及retry exhaustion真MySQL tests。

**Dependencies：** P2-T05。

**Files likely touched：** `ShipmentConfirmationRecoveryJob.js`、scheduler registry、`shipmentConfirmationRecoveryJob.test.js`、recovery integration test、scheduler lease test。

**Traceability：** FR-CONF-015～016；NFR一致性／可用性；Design §§2.6、12.2～12.4。

**Estimated scope：** M。

**Commit：** `feat: recover indeterminate shipment confirmations`。

### Task P2-T07：交付Shipment查詢及Delivery Note／Packing List投影

**Description：** 完成Shipment active list／detail及server-side Delivery Note／Packing List projection，detail分批載入lines、issues及history，文件使用確認時snapshot並明確反映current status。

**Acceptance criteria：**

- [ ] List支援number、SO、Customer、Warehouse、status、date、carrier、tracking filters及exact lookup；detail可追至Fulfillment、SO、Inventory movements。
- [ ] SHIPPED文件包含Shipment／SO／Customer／Address snapshot／SKU／quantity及選填物流資料，不含price、tax、cost、bank或internal errors。
- [ ] Projection escaped、private/no-store、safe filename及Audit；未SHIPPED拒絕有效Delivery Note，read/print不改business timestamp。

**Verification：** Shipment inquiry、print projection、API filters/IDOR/headers、XSS及A4 document tests。

**Dependencies：** P2-T04、P2-T05。

**Files likely touched：** `FulfillmentInquiryService.js`、`FulfillmentPrintService.js`、Shipment read/print handlers、Shipment inquiry test、Delivery Note test。

**Traceability：** FR-INQ-003～007、FR-DOC-002～004；BR-031～033；Design §§5.3、8.9、10.4。

**Estimated scope：** M。

**Commit：** `feat: add shipment inquiry and delivery document projection`。

#### Intermediate Checkpoint 2C：Recovery及Read Model

- [ ] Recovery與operation lookup對所有crash／unknown結果只使用原event。
- [ ] Shipment exact inquiry及Delivery Note符合權限、snapshot與no-sensitive-data要求。
- [ ] SHIPPING狀態不接受update、cancel、第二次confirm或有效Delivery Note。

### Task P2-T08：建立Shipment client service及polling控制

**Description：** 建立Shipment CRUD／Confirm／lookup／document client service，以及只poll原status URL的bounded controller；頁面離開或terminal outcome時停止polling。

**Acceptance criteria：**

- [ ] Client contracts覆蓋list/detail/create/update/cancel/confirm/document及operation lookup，request與server strict schemas一致。
- [ ] 202只保存event、correlation及status URL並poll原operation；不得自動建立新event或重送Phase A。
- [ ] DRAFT／SHIPPING／SHIPPED／FAILED outcome及Address／Allocation conflicts有安全繁中訊息和下一步。

**Verification：** Shipment client request/response、polling lifecycle、202→success/failure及component-unmount tests。

**Dependencies：** P2-T05、P2-T07。

**Files likely touched：** `client/src/services/shipment.js`、client polling helper、client error map、`shipmentService.test.js`、polling controller test。

**Traceability：** Design §§5.3、5.5、9.4、10.4；FR-CONF-015～016。

**Estimated scope：** M。

**Commit：** `feat: add shipment client and outcome polling`。

### Task P2-T09：交付Shipment列表、建立、詳情及取消介面

**Description：** 依前端規範交付Shipment list、create/edit form及detail頁，預選有效default Address／Contact，呈現物流欄位、quantity／issue/history及server allowed actions。

**Acceptance criteria：**

- [ ] Shipment list/detail filters、URL state、loading/empty/error及跨SO／Fulfillment links正確；直接URL權限安全拒絕。
- [ ] Form不提供自由地址，default可改選其他有效shipping address；Contact與物流欄位選填，package／weight條件驗證清楚。
- [ ] Cancel Draft有共用確認；SHIPPING／SHIPPED表單唯讀，375～1440px、鍵盤及焦點行為符合規範。

**Verification：** Vue page/form、route permission、validation、address default及responsive/a11y tests。

**Dependencies：** P2-T02、P2-T08。

**Files likely touched：** `ShipmentListPage.vue`、`ShipmentDetailPage.vue`、`ShipmentFormPanel.vue`、client menu config、Shipment page tests。

**Traceability：** FR-SHIP-001～012、FR-INQ-003／006；Requirement §10.3；Design §§10.1、10.4、10.6。

**Estimated scope：** M。

**Commit：** `feat: add shipment management pages`。

### Task P2-T10：交付Confirm摘要、恢復及A4文件列印頁

**Description：** 交付Confirm summary、二次確認、SHIPPING progress/recovery及Delivery Note／Packing List print page；顯示Address snapshot、完整quantity摘要及不可重複操作提示。

**Acceptance criteria：**

- [ ] Confirm前顯示Shipment／SO／Address／Lines／Bin／Lot／quantities及選填物流摘要，submit後鎖表單並只poll原operation。
- [ ] Address／Allocation stale時保留可修正資料並導向重新選擇／分配；technical unknown顯示correlation及安全等待狀態。
- [ ] A4頁使用server projection、escaped text及status watermark；REVERSED預留顯眼標記，不可被CSS隱藏。

**Verification：** confirmation summary、double-click、poll recovery、focus/error及browser print tests。

**Dependencies：** P2-T08、P2-T09。

**Files likely touched：** `ShipmentConfirmationSummary.vue`、`DeliveryNotePrintPage.vue`、`ShipmentDetailPage.vue`、confirmation UI test、print page test。

**Traceability：** FR-CONF-001～016、FR-DOC-002～004；Design §§10.4、11.5。

**Estimated scope：** M。

**Commit：** `feat: add shipment confirmation and document experience`。

#### Intermediate Checkpoint 2D：完整Shipment體驗

- [ ] PICKED → DRAFT Shipment → SHIPPING → SHIPPED及Draft cancel/recreate可由UI端到端完成。
- [ ] Address變更、Allocation失效、撤權、double click及unknown outcome均有可理解且可恢復體驗。
- [ ] Delivery Note／Packing List與確認snapshot一致，不顯示商業價格、銀行或技術敏感資料。

### P2-GATE：Shipment／Atomic Issue完整測試及PR

**一次完整測試：** 執行§1.7，加上Address／Contact contract、100行多bucket confirm、double click、timeout、process crash、deadlock、commit unknown、Recovery lease、Sales／Inventory reconciliation、Shipment UI及A4文件安全測試。

**Merge acceptance：**

- [ ] Shipment顯示SHIPPED時，Issue、Reservation consume、Sales Fulfilled、Claims及snapshots必在同一commit完成。
- [ ] 所有永久業務失敗回可修正DRAFT且無成功效果；技術或commit不明保持SHIPPING並可由原event收斂。
- [ ] Queue／Pick既有流程無回歸，P2 API／UI／文件權限及IDOR矩陣通過。
- [ ] Reversal入口仍由P3 capability gate隱藏／拒絕；PR經Sales、Inventory、Customer及Warehouse owner review。

---

## 6. Phase P3 — Reversal、Archive & Release Evidence

### 6.1 Phase目標與PR結果

**目標：** 完成錯誤Shipment整張Reversal、Active／Archive inquiry、背景Export、Sales協調的aggregate archive、Reconciliation、Observability及正式發布證據。

**明確結果：** Supervisor可把仍由公司控制且已回原位置的整張Shipment安全沖銷，Inventory及Sales完整回復；所有交易可跨Active／Archive追溯，並以生產等級容量、安全、備份還原及UAT證據支持發布。

### Task P3-T01：實作Reversal guard及Phase A intent

**Description：** 實作Reversal request驗證、Downstream Matter registry及Phase A短transaction，以event/hash claim operation、分配不可重用Reversal Number、保存兩項確認與原因，並把Shipment轉REVERSING。

**Acceptance criteria：**

- [ ] 只接受SHIPPED且未歸檔／未沖銷Shipment、fresh `fulfillment.reverse`、5～500字原因、貨物受公司控制及已回原Bin兩項true確認。
- [ ] Returns／Invoicing未上線時registry明確為`NO_PROVIDER_REQUIRED`版本；required provider的UNKNOWN／不可逆事項均阻止Reversal。
- [ ] Same event/hash replay原結果，異payload conflict；Phase A後只存在REVERSING、Reversal intent及operation evidence，未回補庫存或改Sales。

**Verification：** reversal policy、permission、downstream registry、same/different event、concurrent start及Phase-A crash tests。

**Dependencies：** P2-GATE；P0-T07、P0-T09。

**Files likely touched：** `ShipmentReversalService.js`、`FulfillmentDownstreamMatterService.js`、reverse handler/schema、`shipmentReversalService.test.js`、reversal Phase A integration test。

**Traceability：** FR-REV-001～004、009～012；GATE-003；Design §§2.7、6.5、8.7。

**Estimated scope：** M。

**Commit：** `feat: persist guarded shipment reversal intent`。

### Task P3-T02：實作原bucket回補、Reservation恢復及Sales重算

**Description：** 實作Reversal Phase B，按固定lock order鎖原Issues及相關aggregates，呼叫Inventory專用batch reversal，再由Sales provider減Fulfilled／恢復Reservation，保存details／history／audit並原子轉REVERSED。

**Acceptance criteria：**

- [ ] 每個原Issue恰有一個結果並回原Warehouse／Bin／Lot／Expiry／Status；caller不能選bucket，原Allocation維持Consumed。
- [ ] 原Reservation consumed減／outstanding增，Sales Fulfilled減；Cancelled量保持，CLOSED／COMPLETED按剩餘Fulfilled重算為PARTIALLY_FULFILLED或CONFIRMED。
- [ ] 任一bucket、provider、snapshot、history或audit失敗全部rollback；business failure令Shipment回SHIPPED／Reversal FAILED，technical unknown保留REVERSING。

**Verification：** original-bucket、inactive/counting Bin、already-reversed movement、Sales reopen、multi-line rollback及failure injection真MySQL tests。

**Dependencies：** P3-T01；P0-T04、P0-T05。

**Files likely touched：** `ShipmentReversalService.js`、reversal transaction test、Inventory specialized reversal integration test、Sales reversal integration test、reversal failure-injection test。

**Traceability：** FR-REV-005～011；BR-010、028、030；GATE-003／004；Design §§3.6、6.1～6.2、8.7。

**Estimated scope：** M。

**Commit：** `feat: atomically reverse shipment effects`。

### Task P3-T03：交付Reversal API、operation lookup及Recovery Job

**Description：** 完成Reverse API的同步／202 envelope、沿用owner-safe operation lookup，並建立cluster-leased Reversal Recovery Job以原event接管過期REVERSING operation。

**Acceptance criteria：**

- [ ] API不接受line、quantity或target Bin等多餘欄位；重送不重複Movement、Reservation restore或Sales decrement。
- [ ] Recovery只接管matching target/hash的expired lease；unknown commit先查Inventory/Sales source outcome，不用generic movement reversal替代。
- [ ] 永久downstream／bucket業務失敗停止retry；transient failure bounded backoff，stuck/failed產生安全metrics及alerts。

**Verification：** Reverse／operation API、strict schema、lease race、process crash、commit unknown及retry exhaustion tests。

**Dependencies：** P3-T02。

**Files likely touched：** reverse handler/schema、`ShipmentReversalRecoveryJob.js`、scheduler registry、Reverse API test、reversal recovery integration test。

**Traceability：** FR-REV-002、004、008～010；NFR一致性／恢復；Design §§5.3、5.5、12.2～12.4。

**Estimated scope：** M。

**Commit：** `feat: expose and recover shipment reversals`。

#### Intermediate Checkpoint 3A：Reversal Core

- [ ] SHIPPED → REVERSING → REVERSED及business failure回SHIPPED的狀態／operation evidence完整。
- [ ] Inventory原bucket、Reservation restore、Allocation維持Consumed及Sales狀態重算逐ID對賬一致。
- [ ] Concurrent reverse、same-event replay、unknown commit及downstream UNKNOWN不產生重複或部分效果。

### Task P3-T04：交付Reversal雙重確認及處理中恢復介面

**Description：** 交付Shipment Reversal dialog及detail狀態，明確區分操作更正與Customer Return，要求原因與兩項確認，提交後鎖定並只poll原operation。

**Acceptance criteria：**

- [ ] 只有server allowed action及`fulfillment.reverse`顯示入口；沒有部分line／quantity選項，文案說明需整張沖銷後重新履約。
- [ ] 原因、貨物受公司控制、已回原Bin兩項確認缺一不可；double submit只使用同event。
- [ ] REVERSING顯示correlation／安全等待狀態；成功reload完整detail，REVERSED頁面與文件有文字及watermark標示。

**Verification：** Reversal dialog、permission route、validation、double-click、poll recovery、keyboard/focus及REVERSED rendering tests。

**Dependencies：** P3-T03；P2-T08～P2-T10。

**Files likely touched：** `ShipmentReversalDialog.vue`、`ShipmentDetailPage.vue`、`DeliveryNotePrintPage.vue`、Reversal dialog test、Shipment reversed-state test。

**Traceability：** FR-REV-001～004、012；FR-DOC-004；Requirement §10.4；Design §§10.5～10.6。

**Estimated scope：** M。

**Commit：** `feat: add guarded shipment reversal experience`。

### Task P3-T05：交付Active、Operation、Audit及Finalized查詢

**Description：** 補齊My Recent Work、Active、Exceptions、Finalized、operation及Audit read models與頁面tabs，以bounded/keyset查詢及server filters連結SO、Fulfillment、Shipment、Movement及Reversal。

**Acceptance criteria：**

- [ ] Fulfillment／Shipment exact number、SO、Customer、Warehouse、status、date、short、carrier及tracking filters使用covering indexes並穩定分頁。
- [ ] History供`fulfillment.view`查看，技術operation細節只供獲授權運維；not found／not visible不洩漏其他owner資料。
- [ ] UI tabs保留URL state、支援375～1440px及鍵盤，REVERSED／CANCELLED等final狀態不用純顏色表示。

**Verification：** inquiry filter/API/IDOR、EXPLAIN、operation/audit redaction及Vue tab/URL/a11y tests。

**Dependencies：** P3-T04；P1/P2 inquiry基礎。

**Files likely touched：** `FulfillmentInquiryService.js`、Active inquiry handlers、`FulfillmentsPage.vue`、`ShipmentListPage.vue`、inquiry API/UI tests。

**Traceability：** FR-INQ-001～007、FR-AUDIT-001～003；Design §§5.2～5.5、8.9、10.1。

**Estimated scope：** M。

**Commit：** `feat: complete fulfillment lifecycle inquiry`。

#### Intermediate Checkpoint 3B：Reversal UI及Active Inquiry

- [ ] Reversal API／UI由SHIPPED到REVERSED或安全失敗的狀態、權限及恢復行為一致。
- [ ] Active、Exceptions、Finalized、Operation及Audit查詢不洩漏其他Customer／Warehouse或技術敏感資料。
- [ ] REVERSED在頁面、列印及匯出projection均有文字狀態，不只依賴顏色。

### Task P3-T06：交付bounded background Export service及worker

**Description：** 實作owner-scoped Export Job create／claim／stream／resume／complete／expire，以Active列表相同normalized filters及keyset cursor產生UTF-8 CSV，使用private temp file及atomic rename。

**Acceptance criteria：**

- [ ] Job限制rows、batch、duration及concurrency，結果截斷時有明確summary；大型匯出不佔用HTTP transaction或阻塞日常交易。
- [ ] CSV使用RFC 4180 escaping，`= + - @ TAB CR`開頭cell前置單引號；只輸出Design允許欄位及使用者可見資料。
- [ ] Worker cluster lease、resume、AbortSignal及expired cleanup正確；失敗不暴露路徑／SQL或留下可下載partial file。

**Verification：** export filter parity、CSV formula/CRLF、worker lease/resume、row limit、file cleanup及concurrency tests。

**Dependencies：** P3-T05；P0-T10。

**Files likely touched：** `FulfillmentExportService.js`、`FulfillmentExportJob.js`、export worker tests、CSV security test、export integration test。

**Traceability：** FR-EXPORT-001～004；SEC-006～012；Design §§7.4、8.9、12.2。

**Estimated scope：** M。

**Commit：** `feat: add bounded fulfillment export worker`。

### Task P3-T07：交付Export APIs、owner-safe下載及前端工作清單

**Description：** 交付Export create/list/detail/download handlers及本人Job頁面／狀態控制；下載時fresh permission、owner、expiry及private-root路徑全部重驗並保存Audit。

**Acceptance criteria：**

- [ ] Create回202；list只見本人Jobs，detail/download同時要求owner及fresh `fulfillment.view`，expired結果回410。
- [ ] Download拒絕symlink／path traversal，使用safe filename、`text/csv; charset=utf-8`、no-store及nosniff；Audit後才stream。
- [ ] UI顯示queued/running/completed/failed/expired、polling及安全錯誤；使用當前list filters建立Job，不接受client任意columns。

**Verification：** Export API auth/IDOR/header/path tests、expired cleanup、client polling及Export job page tests。

**Dependencies：** P3-T06。

**Files likely touched：** export handlers/schemas、`client/src/services/fulfillment.js`、Export jobs component/page、Export API test、Export UI test。

**Traceability：** FR-EXPORT-001～004、FR-AUDIT-001；Design §§5.5、7.4、10.1。

**Estimated scope：** M。

**Commit：** `feat: add owner-safe fulfillment exports`。

#### Intermediate Checkpoint 3C：Background Export

- [ ] Reversal UI/API及Active lifecycle查詢可端到端使用，權限與IDOR矩陣通過。
- [ ] Export filters與列表一致，公式注入、路徑、owner、expiry及大量工作不影響交易。
- [ ] Read、print及export均不修改last business timestamp或archive eligibility。

### Task P3-T08：實作Fulfillment Open Matter及Sales Archive eligibility

**Description：** 實作bounded `getOrderArchiveStatus()`及Sales lifecycle/archive guards，按索引檢查非terminal Fulfillment、active Claims、outstanding Allocations及IN_PROGRESS operations；Provider故障回UNKNOWN並fail closed。

**Acceptance criteria：**

- [ ] PICKING、PICKED、SHIPPING、REVERSING、active Claim、outstanding Allocation或IN_PROGRESS operation均回OPEN及穩定reason codes。
- [ ] 全部terminal且無open matter才回CLOSED；dependency失效回UNKNOWN，不以false或empty results放行Sales archive。
- [ ] Query使用bounded EXISTS及covering indexes，不載入完整aggregate；Sales lifecycle在release Reservation前調用guard。

**Verification：** open-matter unit、provider UNKNOWN、Sales lifecycle integration及production-like EXPLAIN tests。

**Dependencies：** P3-T03、P3-T05；Sales Archive framework已落地。

**Files likely touched：** `FulfillmentOpenMatterService.js`、Sales archive eligibility service、open-matter tests、Sales consumer contract test、open-matter integration test。

**Traceability：** FR-ARC-001～003；BR-034～036；GATE-005；Design §§6.5、8.10。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment archive eligibility provider`。

### Task P3-T09：實作Sales協調的Fulfillment原子Archive Participant

**Description：** 實作只供Sales Archive service identity調用的`archiveOrderInTransaction()`，在同一transaction鎖定並複製Fulfillment aggregate、逐table驗count/hash、更新routing／operation marker後才按FK順序移除Active。

**Acceptance criteria：**

- [ ] Participant要求caller transaction、Sales service identity、order/batch/cutoff及expected manifest；不得提供HTTP mutation或自行排程。
- [ ] Archive parents先於children寫入，read-back count/hash全部符合後才清active pointer及刪Active；任一conflict／中斷整批rollback並保留Active。
- [ ] Sales manifest同時包含Sales及Fulfillment hashes/counts；same batch/hash可恢復，different hash conflict，不使用`INSERT IGNORE`。

**Verification：** archive participant unit、copy/hash/delete、failure injection、same/different hash、active/archive routing及Sales-coordinated transaction真MySQL tests。

**Dependencies：** P3-T08；P0-T10；Sales Archive aggregate move已落地。

**Files likely touched：** `FulfillmentArchiveParticipant.js`、Sales Archive service、archive participant tests、archive transaction integration test、routing/manifest test。

**Traceability：** FR-ARC-004～006、008～010；GATE-005；Design §§2.7、4.17、6.5、8.10。

**Estimated scope：** M。

**Commit：** `feat: archive sales and fulfillment aggregates atomically`。

### Task P3-T10：交付Archive查詢API及唯讀詳情頁

**Description：** 交付Archived Fulfillment／Shipment list/detail APIs及頁面，使用Archive-only bounded filters、唯一routing及唯讀snapshot；Archive unavailable顯示不可用而非零結果。

**Acceptance criteria：**

- [ ] List至少要求exact number、SO、Customer或≤366日date range其一；禁止空條件全掃描，Active/Archive不做無界union。
- [ ] Detail完整顯示lines、allocations、issues、address/contact snapshots、history及Reversal，但沒有修改、取消、Confirm或Reverse action。
- [ ] Active 404只回安全`mayExistInArchive`提示；Archive unavailable回明確錯誤，頁面保留filters並不顯示假empty state。

**Verification：** Archive API filter/IDOR/routing/unavailable tests、EXPLAIN及Archive list/detail Vue tests。

**Dependencies：** P3-T09。

**Files likely touched：** archive handlers/schemas、`FulfillmentArchivePage.vue`、archive detail pages、Archive API test、Archive page test。

**Traceability：** FR-ARC-006～010；FR-INQ-004～007；Design §§5.5、10.1、11.5。

**Estimated scope：** M。

**Commit：** `feat: add bounded fulfillment archive inquiry`。

#### Intermediate Checkpoint 3D：Archive Aggregate

- [ ] Sales與Fulfillment只會同處Active或Archive，exact routing永遠唯一。
- [ ] Archive中斷、same hash重跑、different hash conflict及provider UNKNOWN全部保留可證明一致的Active結果。
- [ ] Archive頁唯讀且不可用時不顯示假零資料；operation outcome在歸檔後仍可追溯。

### Task P3-T11：交付Reconciliation、可觀測性及runbooks

**Description：** 實作read-only Reconciliation service/job，加入bounded scheduler、structured events、metrics、alerts及操作runbooks，雙向核對Sales、Fulfillment、Inventory、Active／Archive及operation truth；不自動修資料。

**Acceptance criteria：**

- [ ] 對賬覆蓋SO Reserved/Fulfilled、Reservation、Claims、Allocations、Issues/Reversals、states、active pointer、routing及manifest count/hash。
- [ ] Events/metrics涵蓋Queue age、short/override、confirm/reverse outcome、stuck age、lock wait、provider failure、export/archive及mismatch；log只含allowlisted IDs/counts/codes。
- [ ] Runbooks涵蓋stuck SHIPPING／REVERSING、Claim mismatch、FEFO dispute、archive conflict及restore validation；任何修復需另行批准forward script。

**Verification：** reconciliation unit/integration、scheduler lease、redaction、metric/event contract及runbook scenario review。

**Dependencies：** P3-T03、P3-T07、P3-T10。

**Files likely touched：** `FulfillmentReconciliationService.js`、`FulfillmentReconciliationJob.js`、observability registration、reconciliation tests、Fulfillment runbook document。

**Traceability：** FR-AUDIT-001～003；NFR可觀測性／營運；Design §§8.11、12.2～12.4。

**Estimated scope：** M。

**Commit：** `feat: add fulfillment reconciliation and operations evidence`。

### Task P3-T12：完成容量、安全、restore及UAT release evidence

**Description：** 在production-like資料與專用環境執行最終容量、50-user並發、安全、archive中斷、backup/restore及需求追溯驗證；只修正本模組發現的問題，不降低資料集或門檻。

**Acceptance criteria：**

- [ ] 730萬Active Fulfillments及Shipments、平均5/P95 30/最大100 lines、mixed allocations及25%分批SO下，所有P95門檻、EXPLAIN、rows examined、pool及heap證據達標。
- [ ] IDOR、撤權、XSS、CSV、log redaction、download path、direct internal reversal及Counting/Inactive Bin abuse cases全部通過。
- [ ] 隔離restore後Sales → Fulfillment → Inventory → Archive可雙向追溯，manifest count/hash一致；AC-001～056及UAT owner簽核無缺口。

**Verification：** performance harness、50-user concurrency、security regression、backup/restore rehearsal、archive interruption及UAT evidence review。

**Dependencies：** P3-T01～P3-T11。

**Files likely touched：** Fulfillment load-test scenario、security regression suite、restore verification script、release evidence document、UAT traceability checklist。

**Traceability：** AC-001～056；NFR-PERF-001～007；Requirement §§13、15～16；Design §§11.6～11.8、13。

**Estimated scope：** M。

**Commit：** `test: add fulfillment release qualification evidence`。

#### Intermediate Checkpoint 3E：Release Candidate Evidence

- [ ] 功能、transaction、recovery、security、performance、archive及restore證據均對應固定commit SHA與測試環境。
- [ ] 所有56項AC、FR／BR／SEC／NFR及Design Gates均可追至Task與測試結果。
- [ ] 沒有skip、suppressions、降低coverage／資料量／效能門檻或未批准的自動修復。

### P3-GATE：最終完整測試及PR

**一次完整測試：** 執行§1.7及P0～P3所有真MySQL、provider contract、concurrency、failure injection、security、performance、archive、backup/restore、responsive/a11y及UAT套件；保存完整release evidence。

**Merge acceptance：**

- [ ] Reversal按原bucket回補、恢復Reservation、減Sales Fulfilled、保留Consumed Allocation並正確重開SO。
- [ ] Active／Archive唯一、Export安全、Reconciliation無未處理mismatch，所有stuck operation可依runbook收斂。
- [ ] 730萬資料、50-user、100行操作、Archive及restore門檻全部達標；所有critical/high安全問題關閉。
- [ ] Product、Warehouse、Sales、Inventory、Customer、QA、DBA及Operations owner完成批准，才可合併及開放完整功能。

---

## 7. Phase完整測試週期

| Phase | 一次完整測試重點 | 必須保存的證據 |
| --- | --- | --- |
| P0 | 全migration、FK/unique/trigger、provider contracts、state/quantity/hash、operation lease、Claim race、mixed Expiry、Serial及lock order | 基線SHA、migration inventory、MySQL版本、命令／結果、constraint及雙connection證據 |
| P1 | Queue、create/update、allocate/reallocate、pick/short、cancel、permissions、IDOR、print及Inventory reconciliation | E2E結果、rollback/並發證據、API contract、UI responsive/a11y及Pick List樣本 |
| P2 | Shipment Draft、Address/Contact、100行confirm、Phase A/B、double-click、timeout、crash、unknown commit、Recovery、SO/Inventory及Delivery Note | Fault injection位置、operation/event結果、movement/quantity reconciliation、UI polling及文件樣本 |
| P3 | Reversal、CLOSED reopen、Export、Archive、Reconciliation、730萬容量、50-user、安全、backup/restore及UAT | Load/EXPLAIN/pool/heap、security matrix、manifest hashes、restore trace及owner sign-off |

每個Phase只有一次正式Gate test cycle；Task開發期間的focused tests只作快速回饋，不能取代Phase完整測試。Gate失敗時修正後須重新執行整個對應Phase cycle，不能只重跑失敗case便宣告通過。

---

## 8. 需求與Phase追溯

| Phase | Capability／Requirements | 主要驗收 |
| --- | --- | --- |
| P0 | Cross-cutting foundation；GATE-001～007；BR-001～036；SEC基礎；Sales／Inventory／Customer／Item contracts | Migration/contract/quantity/lock proof；Serial及Claim競爭 |
| P1 | FUL-CAP-01／02；FR-QUEUE-001～012、FR-PICK-001～012、FR-PICKCONF-001～010、FR-LIFE-001～003、FR-DOC-001 | AC-001～021及Queue/Picking相關AC；Inventory Allocation對賬 |
| P2 | FUL-CAP-03；FR-SHIP-001～012、FR-CONF-001～016、FR-LIFE-004～005、FR-DOC-002～004 | AC-022～038；Address、Atomic Issue、Recovery及文件 |
| P3 | FUL-CAP-04／05；FR-REV-001～012、FR-INQ、FR-EXPORT、FR-AUDIT、FR-ARC-001～010及NFR-PERF | AC-039～056；Reversal、Archive、Security、Capacity及Restore |

Task實作時須把每項新增測試case ID回填到本表或Phase evidence；不得只以章節範圍聲稱覆蓋。`07_uat_test_cases.md`已產出，保留本文件Task ID並經`08_traceability.json`建立AC ↔ Test Case ↔ Task ↔ Commit四向追溯。

---

## 9. 主要風險與處理

| 風險 | 影響 | 處理 |
| --- | --- | --- |
| Sales／Inventory／Customer尚未落地 | P0不能安全完成，後續交易無真實owner | P0-T01硬Gate；不使用stub、影子schema或重寫Provider規則 |
| Migration與平行模組碰撞 | Deploy失敗或FK次序錯誤 | 每Phase從最新main動態分配；fresh/upgrade/rerun真MySQL驗證 |
| DRAFT Claims競爭超額 | 多張工作重疊使用同Reservation | Sales mapping鎖＋active Claim aggregation＋雙connection proof |
| Fulfillment自行計FEFO／FIFO | 與Inventory資格漂移、錯揀貨 | Inventory為唯一候選與sequence正本；exact provider result驗證 |
| Confirm跨三模組且HTTP timeout | 重複Issue或Shipment假成功 | Durable Phase A/B、固定event、single transaction、operation lookup及Recovery |
| Reversal誤用generic movement reversal | Reservation/Sales未恢復或bucket錯誤 | 只用無HTTP入口的專用Inventory batch command，逐Issue唯一link |
| Address或Allocation載入後改變 | 出貨至錯地址或錯bucket | Phase B transaction內重驗owner/purpose/status/version，不靜默替換 |
| Active／Archive分裂 | SO已歸檔但Shipment遺失或雙store | Sales-owned single transaction participant、read-back hash及unique routing |
| 24個月高資料量 | Queue、exact lookup、Export／Archive拖慢交易 | Production-like 730萬資料、covering index、keyset、bounded worker及pool證據 |
| Phase PR過大 | Review、rollback及ownership困難 | 每Task 1～5主要檔案／atomic commit；每2～3 Task checkpoint，超限先拆Task |

---

## 10. 明確不在本計劃內

- 多SO合併Shipment、跨倉Fulfillment、自動選倉或調撥。
- Wave／Batch／Zone Picking、掃描器、Pick Route或大型WMS能力。
- 強制Packing、箱／棧板明細、Carrier API、電子面單、司機、車隊或Proof of Delivery。
- 臨時地址、在Shipment內修改Customer主檔或選擇非Shipping用途聯絡資料。
- 部分Shipment Reversal、Customer Return、換貨、退款或重新寄送。
- Invoice、AR、Payment、Tax、成本過帳或會計分錄。
- Serial Number作業、Catch Weight、Bundle／Kit或多Base UOM數量。
- Archive永久purge、第二個Database、Search Engine、Queue Broker或Data Lake。

任何上述能力成為正式需求時，必須先更新`01_requirement_spec.md`、`03_design_spec.md`、provider contracts、狀態機、Archive eligibility及驗收案例，再重新拆分Tasks；不得直接塞進現有Phase。

---

## 11. 執行狀態及變更控制

- 只有Task的Acceptance Criteria、Verification及atomic commit全部完成，才可把索引與Task checkbox改為`[x]`。
- Intermediate Checkpoint只代表局部contract穩定，不代表Phase可合併；Phase Gate未完成時不得開放下一Phase入口。
- 每個Phase合併後，把實際commit、PR、migration序號、測試報告及環境證據回填本文件，再由最新main建立下一個worktree。
- 發現規格衝突、Provider payload或error變更、migration collision、lock order破壞、效能門檻不可達或安全風險時，立即停止相關Task並更新規格取得批准，不靜默改低標準。
- Requirement與Design已鎖定的Must及Should都在本計劃內；明確Out of Scope不做預留實作。
- 本文件批准只代表可以按順序開始P0，不代表上游Provider readiness已自動通過，也不取代每個Phase的人工PR review及測試Gate。

---

## 12. Harness 2.0 正式計劃定義

本節把 §2～§7 的 Phase 與 Task 敘述整理成穩定的 `PHASE` 及 `TASK` 實體，作為 `08_traceability.json` 的計劃節點。§3～§6 的逐項 Task 內容仍然是執行細節的來源；本節不重複也不取代它們。`P0-GATE`～`P3-GATE` 不是獨立 Task，而是各自 Phase 的 `Exit criteria`。Task 進度記錄於 `00_harness_state.json`，不在本文件另設第二份可編輯狀態表。


### 12.1 Phase 與 Task ID 對照

| Harness ID | Legacy ID | 名稱 | 所屬 Phase |
| --- | --- | --- | --- |
| PHASE-001 | P0 | Contracts、Schema & Quantity Proof | — |
| PHASE-002 | P1 | Queue、Fulfillment & Picking | — |
| PHASE-003 | P2 | Shipment & Atomic Issue | — |
| PHASE-004 | P3 | Reversal、Archive & Release Evidence | — |
| TASK-001 | P0-T01 | 鎖定最新主幹、Migration序號及Provider readiness | PHASE-001 |
| TASK-002 | P0-T02 | 建立Fulfillment permissions、設定、常數及公開錯誤 | PHASE-001 |
| TASK-003 | P0-T03 | 建立狀態機、數量守恆及canonical payload hash純規則 | PHASE-001 |
| TASK-004 | P0-T04 | 落地Sales Fulfillment provider及lifecycle契約 | PHASE-001 |
| TASK-005 | P0-T05 | 落地Inventory allocation／issue／reversal契約 | PHASE-001 |
| TASK-006 | P0-T06 | 完成Customer Shipping及Item eligibility契約 | PHASE-001 |
| TASK-007 | P0-T07 | 建立文件序號及durable operation persistence／service | PHASE-001 |
| TASK-008 | P0-T08 | 建立Fulfillment、Claim、Allocation及History schema | PHASE-001 |
| TASK-009 | P0-T09 | 建立Shipment、Issue、Reversal及History schema | PHASE-001 |
| TASK-010 | P0-T10 | 建立Audit、Export及Archive schema與不可變保護 | PHASE-001 |
| TASK-011 | P0-T11 | 建立固定lock order、transaction context及測試支援 | PHASE-001 |
| TASK-012 | P1-T01 | 交付Fulfillment Queue查詢垂直切片 | PHASE-002 |
| TASK-013 | P1-T02 | 交付DRAFT Fulfillment建立及Reservation Claim | PHASE-002 |
| TASK-014 | P1-T03 | 交付Fulfillment list、detail及versioned update | PHASE-002 |
| TASK-015 | P1-T04 | 交付Allocation Candidates及推薦次序 | PHASE-002 |
| TASK-016 | P1-T05 | 交付批次Allocation及FEFO／FIFO例外控制 | PHASE-002 |
| TASK-017 | P1-T06 | 交付原子Reallocation | PHASE-002 |
| TASK-018 | P1-T07 | 交付Pick Confirmation及Short Pick | PHASE-002 |
| TASK-019 | P1-T08 | 交付未出貨Fulfillment取消及Allocation release | PHASE-002 |
| TASK-020 | P1-T09 | 建立Fulfillment client services及stable error mapping | PHASE-002 |
| TASK-021 | P1-T10 | 交付Queue、Create及Fulfillment列表頁 | PHASE-002 |
| TASK-022 | P1-T11 | 交付詳情、Allocation、Reallocation及Pick介面 | PHASE-002 |
| TASK-023 | P1-T12 | 交付A4 Pick List投影及列印頁 | PHASE-002 |
| TASK-024 | P2-T01 | 交付Shipment Draft create／update／cancel | PHASE-003 |
| TASK-025 | P2-T02 | 交付Customer地址／聯絡人lookup及transaction重驗 | PHASE-003 |
| TASK-026 | P2-T03 | 實作Shipment Confirm Phase A durable intent | PHASE-003 |
| TASK-027 | P2-T04 | 實作Phase B固定鎖序及跨模組原子交易 | PHASE-003 |
| TASK-028 | P2-T05 | 交付Confirm API、domain idempotency及operation lookup | PHASE-003 |
| TASK-029 | P2-T06 | 交付Confirm Recovery Job及commit-unknown收斂 | PHASE-003 |
| TASK-030 | P2-T07 | 交付Shipment查詢及Delivery Note／Packing List投影 | PHASE-003 |
| TASK-031 | P2-T08 | 建立Shipment client service及polling控制 | PHASE-003 |
| TASK-032 | P2-T09 | 交付Shipment列表、建立、詳情及取消介面 | PHASE-003 |
| TASK-033 | P2-T10 | 交付Confirm摘要、恢復及A4文件列印頁 | PHASE-003 |
| TASK-034 | P3-T01 | 實作Reversal guard及Phase A intent | PHASE-004 |
| TASK-035 | P3-T02 | 實作原bucket回補、Reservation恢復及Sales重算 | PHASE-004 |
| TASK-036 | P3-T03 | 交付Reversal API、operation lookup及Recovery Job | PHASE-004 |
| TASK-037 | P3-T04 | 交付Reversal雙重確認及處理中恢復介面 | PHASE-004 |
| TASK-038 | P3-T05 | 交付Active、Operation、Audit及Finalized查詢 | PHASE-004 |
| TASK-039 | P3-T06 | 交付bounded background Export service及worker | PHASE-004 |
| TASK-040 | P3-T07 | 交付Export APIs、owner-safe下載及前端工作清單 | PHASE-004 |
| TASK-041 | P3-T08 | 實作Fulfillment Open Matter及Sales Archive eligibility | PHASE-004 |
| TASK-042 | P3-T09 | 實作Sales協調的Fulfillment原子Archive Participant | PHASE-004 |
| TASK-043 | P3-T10 | 交付Archive查詢API及唯讀詳情頁 | PHASE-004 |
| TASK-044 | P3-T11 | 交付Reconciliation、可觀測性及runbooks | PHASE-004 |
| TASK-045 | P3-T12 | 完成容量、安全、restore及UAT release evidence | PHASE-004 |

### 12.2 正式定義


## PHASE-001 — Contracts、Schema & Quantity Proof

### Outcome
在任何業務入口出現前，關閉跨模組一致性、數量、狀態、冪等、身份、migration及lock order風險。

明確結果：全部active／archive schema、純規則、durable operation及Sales／Inventory／Customer／Item契約可供後續Phase使用；一般使用者沒有Fulfillment menu、route或業務API入口。 範圍為本 Phase 的 11 個 Task（`TASK-001`～`TASK-011`，legacy `P0-T01`～`P0-T11`）。Owner：ERP Product Owner（Sam）指派的實作者；本文件不代表已開始功能開發。

### Entry criteria
`05_development_tasks.md` §1.4 的七項硬性 Gate 全部確認：Item、Customer、Sales、Inventory 四個 Provider 的 transaction-aware 契約、錯誤碼及 decimal-string 數量語意已由 provider owner 批准並有 consumer contract tests；已 fetch 最新 `origin/main` 並重新盤點全部 migration；Phase 測試使用可清除的專用 MySQL 8.0 測試庫。任一硬依賴未落地時 `TASK-001` 回報 `BLOCKED` 並停止該依賴鏈，不得建立影子 table、production fake 或可被誤用的 feature 入口。

### Acceptance criteria
- 所有P0 Tasks及Intermediate Checkpoints完成，Provider readiness全為PASS。
- Migration、FK、unique、trigger、operation replay/conflict、雙人Claim及transaction-required contracts有通過證據。
- 一般使用者仍沒有Fulfillment menu／route；P0 diff只含foundation、provider contracts及schema。
- PR描述列明forward-only migration與application rollback，經Sales／Inventory／Customer／DB owner review。

### Integration and regression
Consumers：Sales、Inventory、Customer、Item 四個 provider 契約與 `authorization`、`framework idempotency` 共用資源。共用 hotspots 為 `permissionCatalogue.js`、application configuration、scheduler registry、migration 整合套件及 Sales／Inventory provider services，同一時間只由一個 Task 修改。必跑套件：`lint`、`client-build`、`security-audit`、`fulfillment-technical`；回歸理由為權限目錄、idempotency identity scope 及 migration 全域序號皆為跨模組共用資源。

### Git and merge plan
`branch_strategy` 為 `DEFAULT`：合併前先 `git fetch origin --prune`，由最新 `origin/main` 建立專用 worktree 與分支 `codex/fulfillment-p0-foundation`，一個 PR、一次完整測試週期。Merge group `fulfillment-p0`。合併時機由 P0-GATE 控制：開發者自測（§1.7 全部命令）→ 當前 candidate 的 mandatory CI（Dependency audit、Lint、Test、Build frontend）→ 實際人工 review 批准 → 合併。合併後移除 worktree 及已合併分支，下一 Phase 由最新 main 重新開始。一般使用者在本 Phase 結束時仍沒有 Fulfillment menu、route 或業務 API 入口，因此不需要 feature flag。

### Rollback
Application 可回上一版；已套用的 migration 及已配置的 permission seed 不刪除，只以 forward corrective migration 修正（設計 §13.2）。本 Phase 沒有業務入口，回退不影響既有使用者。

### Exit criteria
P0-GATE「Foundation完整測試及PR」：執行§1.7全部命令，加上fresh／upgrade／rerun migrations、Provider consumer contracts、Claim race、mixed Expiry、Serial防護、immutable trigger及lock-order真MySQL套件；保存commit SHA、DB版本、命令及結果。 全部 Task 及 Intermediate Checkpoint 完成，沒有 TODO stub、未解決 blocker 或未配置 migration；§1.7 全部命令、該 Phase 列明的真 MySQL／效能／安全／恢復驗證及 mandatory CI 在當前 candidate 上通過；PR 描述列出需求追溯、migration／rollback 影響、測試命令與結果及已知限制；人工 review 批准後才合併，合併後清理 worktree 與分支。Gate 失敗時修正後須重新執行整個對應 Phase 測試週期，不得只重跑失敗案例便宣告通過。

## PHASE-002 — Queue、Fulfillment & Picking

### Outcome
交付第一個可由倉務人員端到端操作的垂直流程：Queue → DRAFT → Allocation → PICKING → Pick／Short → PICKED，並支援安全取消及Pick List。

明確結果：獲授權使用者能從一張SO建立一張或多張不超額的Fulfillment工作，按Inventory唯一事實分配到Bin／Lot並完成揀貨；任何步驟均不扣On Hand或增加SO Fulfilled。 範圍為本 Phase 的 12 個 Task（`TASK-012`～`TASK-023`，legacy `P1-T01`～`P1-T12`）。Owner：ERP Product Owner（Sam）指派的實作者；本文件不代表已開始功能開發。

### Entry criteria
`PHASE-001` 的 P0-GATE 已完成完整測試週期、人工 review 批准並合併；Provider readiness 全為 PASS；已從最新 `origin/main` 建立本 Phase 專用 worktree／分支並重新分配 migration 序號。

### Acceptance criteria
- Queue → DRAFT → PICKING → PICKED／Short Pick與取消流程均有端到端證據。
- Overclaim、multi-Line／Bin／Lot、stale version、same-event replay及任一步rollback均不留下部分效果。
- P1操作不減On Hand、不consume Reservation、不增加SO Fulfilled，也不建立Shipment。
- PR只開放P1能力；P2 Shipment action仍由capability gate隱藏／拒絕。

### Integration and regression
Consumers：Sales Reservation mapping、Inventory allocation／release 契約。共用 hotspots 另加 client menu 及 public error map。必跑套件：`lint`、`client-build`、`security-audit`、`fulfillment-technical`；回歸須包含 P0 的 Claim race、mixed Expiry、Serial 防護及 lock order 案例。

### Git and merge plan
`branch_strategy` 為 `DEFAULT`，分支 `codex/fulfillment-p1-queue-picking`，merge group `fulfillment-p1`，依賴 `PHASE-001` 已合併。Phase 不得重疊向一般使用者開放；下一 Phase 可做 read-only 研究，但不得在本 Gate 前合併依賴其未完成行為的 production 入口。合併流程與 cleanup 同 `PHASE-001`。

### Rollback
Application rollback 至上一版並停用 Fulfillment 業務 route；已配置的 Fulfillment Number、Claims 及 Inventory Allocation 不刪除，異常以 Inventory release 的正式流程處理，不手工改 status 假裝回退。

### Exit criteria
P1-GATE「Queue／Picking完整測試及PR」：執行§1.7，加上Queue／Claims／Allocation／Reallocation／Pick／Cancel真MySQL及雙connection tests、FEFO／FIFO權限矩陣、Pick List安全／列印、P1頁面responsive及Inventory reconciliation。 全部 Task 及 Intermediate Checkpoint 完成，沒有 TODO stub、未解決 blocker 或未配置 migration；§1.7 全部命令、該 Phase 列明的真 MySQL／效能／安全／恢復驗證及 mandatory CI 在當前 candidate 上通過；PR 描述列出需求追溯、migration／rollback 影響、測試命令與結果及已知限制；人工 review 批准後才合併，合併後清理 worktree 與分支。Gate 失敗時修正後須重新執行整個對應 Phase 測試週期，不得只重跑失敗案例便宣告通過。

## PHASE-003 — Shipment & Atomic Issue

### Outcome
由PICKED Fulfillment建立一張有效Shipment，經可恢復的Phase A／B流程，在單一MySQL transaction原子完成Inventory Issue、Reservation consume、Shipment／Fulfillment狀態及Sales Fulfilled更新。

明確結果：使用者可選Customer有效Shipping Address、保存選填物流資料及確認出貨；HTTP timeout、process crash或commit結果不明不會產生第二份出庫效果，並可由原event收斂。 範圍為本 Phase 的 10 個 Task（`TASK-024`～`TASK-033`，legacy `P2-T01`～`P2-T10`）。Owner：ERP Product Owner（Sam）指派的實作者；本文件不代表已開始功能開發。

### Entry criteria
`PHASE-002` 的 P1-GATE 已完成完整測試週期、人工 review 批准並合併；Queue、Allocation、Pick／Short、取消及 Pick List 有通過證據；已從最新 `origin/main` 建立本 Phase 專用 worktree／分支。

### Acceptance criteria
- Shipment顯示SHIPPED時，Issue、Reservation consume、Sales Fulfilled、Claims及snapshots必在同一commit完成。
- 所有永久業務失敗回可修正DRAFT且無成功效果；技術或commit不明保持SHIPPING並可由原event收斂。
- Queue／Pick既有流程無回歸，P2 API／UI／文件權限及IDOR矩陣通過。
- Reversal入口仍由P3 capability gate隱藏／拒絕；PR經Sales、Inventory、Customer及Warehouse owner review。

### Integration and regression
Consumers：Customer address／contact 契約、Inventory posting 契約、Sales `applyFulfillmentResultInTransaction`。必跑套件：`lint`、`client-build`、`security-audit`、`fulfillment-technical`；回歸須包含 P0～P1 全部核心案例，並加入 100 行原子 confirm、failure injection 及 Recovery。

### Git and merge plan
`branch_strategy` 為 `DEFAULT`，分支 `codex/fulfillment-p2-shipment`，merge group `fulfillment-p2`，依賴 `PHASE-002` 已合併。部署按設計 §13.1 先小量 warehouse 角色開放 Shipment Confirm 及 Recovery jobs。合併流程與 cleanup 同 `PHASE-001`。

### Rollback
若 Confirm 異常，停新 mutation route 及 Recovery claim，保留查詢與 operation evidence；已 commit 的 Issue、Reservation consume 及 SO Fulfilled 不得以直接改資料回退，只能以正式 Shipment Reversal 更正。

### Exit criteria
P2-GATE「Shipment／Atomic Issue完整測試及PR」：執行§1.7，加上Address／Contact contract、100行多bucket confirm、double click、timeout、process crash、deadlock、commit unknown、Recovery lease、Sales／Inventory reconciliation、Shipment UI及A4文件安全測試。 全部 Task 及 Intermediate Checkpoint 完成，沒有 TODO stub、未解決 blocker 或未配置 migration；§1.7 全部命令、該 Phase 列明的真 MySQL／效能／安全／恢復驗證及 mandatory CI 在當前 candidate 上通過；PR 描述列出需求追溯、migration／rollback 影響、測試命令與結果及已知限制；人工 review 批准後才合併，合併後清理 worktree 與分支。Gate 失敗時修正後須重新執行整個對應 Phase 測試週期，不得只重跑失敗案例便宣告通過。

## PHASE-004 — Reversal、Archive & Release Evidence

### Outcome
完成錯誤Shipment整張Reversal、Active／Archive inquiry、背景Export、Sales協調的aggregate archive、Reconciliation、Observability及正式發布證據。

明確結果：Supervisor可把仍由公司控制且已回原位置的整張Shipment安全沖銷，Inventory及Sales完整回復；所有交易可跨Active／Archive追溯，並以生產等級容量、安全、備份還原及UAT證據支持發布。 範圍為本 Phase 的 12 個 Task（`TASK-034`～`TASK-045`，legacy `P3-T01`～`P3-T12`）。Owner：ERP Product Owner（Sam）指派的實作者；本文件不代表已開始功能開發。

### Entry criteria
`PHASE-003` 的 P2-GATE 已完成完整測試週期、人工 review 批准並合併；Shipment Confirm 原子性、Recovery 及 Delivery Note 有通過證據；Sales Archive framework 及 aggregate move 能力已落地；已從最新 `origin/main` 建立本 Phase 專用 worktree／分支。

### Acceptance criteria
- Reversal按原bucket回補、恢復Reservation、減Sales Fulfilled、保留Consumed Allocation並正確重開SO。
- Active／Archive唯一、Export安全、Reconciliation無未處理mismatch，所有stuck operation可依runbook收斂。
- 730萬資料、50-user、100行操作、Archive及restore門檻全部達標；所有critical/high安全問題關閉。
- Product、Warehouse、Sales、Inventory、Customer、QA、DBA及Operations owner完成批准，才可合併及開放完整功能。

### Integration and regression
Consumers：Inventory 專用 reversal 契約、Sales 狀態重算與 Archive Job、未來 Returns／Invoicing 的 Downstream Matter registry。必跑套件：`lint`、`client-build`、`security-audit`、`fulfillment-technical`；回歸須重跑 P0～P2 全部核心案例，並加入 730 萬容量、50-user、security matrix、archive hash／count 及 backup／restore。

### Git and merge plan
`branch_strategy` 為 `DEFAULT`，分支 `codex/fulfillment-p3-reversal-release`，merge group `fulfillment-p3`，依賴 `PHASE-003` 已合併。Reversal 先由 Supervisor 角色 pilot；Archive mirrors 須完成 production-like dry-run、hash／count 及 restore 證據，才可註冊 Sales participant。合併流程與 cleanup 同 `PHASE-001`。

### Rollback
Reversal 異常時停用 reverse route 並保留 `REVERSING` 證據；Archive conflict 停 Job，已 commit aggregate 不搬回 Active，以 routing 及唯讀查詢維持，另作 forward repair。

### Exit criteria
P3-GATE「最終完整測試及PR」：執行§1.7及P0～P3所有真MySQL、provider contract、concurrency、failure injection、security、performance、archive、backup/restore、responsive/a11y及UAT套件；保存完整release evidence。 全部 Task 及 Intermediate Checkpoint 完成，沒有 TODO stub、未解決 blocker 或未配置 migration；§1.7 全部命令、該 Phase 列明的真 MySQL／效能／安全／恢復驗證及 mandatory CI 在當前 candidate 上通過；PR 描述列出需求追溯、migration／rollback 影響、測試命令與結果及已知限制；人工 review 批准後才合併，合併後清理 worktree 與分支。Gate 失敗時修正後須重新執行整個對應 Phase 測試週期，不得只重跑失敗案例便宣告通過。

## TASK-001 — 鎖定最新主幹、Migration序號及Provider readiness

### Goal
從最新`origin/main`建立P0 worktree，記錄基線commit、實際下一個migration序號及四個上游Provider的實作位置、版本和測試結果；任何硬依賴缺失均明確標為BLOCKED。 （Legacy identity：`P0-T01`；規模估算：XS。）

### Approach
預計變更範圍：`docs/fulfillment_shipping_management/05_development_tasks.md`及P0 PR描述；如無規格碰撞，不修改production code。

依賴：最新`origin/main`；Item、Customer、Sales、Inventory實作分支已合併。

規格追溯：Requirement §2.4、§12、§16.2；Design §§0.2、6、9.3、13.1、14.2。

### Acceptance criteria
- Item、Customer、Sales及Inventory每項必要contract均有PASS／BLOCKED、owner、實際symbol及可重現證據。
- 所有現有migration前綴唯一且已套用內容不變；P0 logical migrations獲分配連續實際序號及FK次序。
- 任一硬依賴BLOCKED時不建立Fulfillment production stub、影子資料表或可被誤用的feature入口。

### Definition of Done
驗證方式：`git status --short --branch`、`git log --oneline -5`、migration inventory及Provider focused tests；結果附於P0 PR checklist。

Commit：不需要production commit；若只回填證據，使用`docs: record fulfillment provider readiness`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-002 — 建立Fulfillment permissions、設定、常數及公開錯誤

### Goal
加入三項Fulfillment權限、冪等seed、typed configuration normalizer、狀態／操作／原因allowlists及stable public errors；System Administrator不因名稱自動取得業務權限。 （Legacy identity：`P0-T02`；規模估算：M。）

### Approach
預計變更範圍：`server/src/modules/authorization/permissionCatalogue.js`、一支動態編號permission migration、`server/config/fulfillment.js`、`server/src/modules/fulfillment/fulfillmentConstants.js`、`server/src/modules/fulfillment/fulfillmentErrors.js`。

依賴：P0-T01。

規格追溯：Requirement §4、SEC-001～012；Design §§5.6、7、9.2、12.1。

### Acceptance criteria
- `fulfillment.view`、`fulfillment.operation`、`fulfillment.reverse`在catalogue與seed一致且互不繼承；FEFO仍由`inventory.fefo.override`擁有。
- 設定對lines、allocations、page、lease、export、archive query及reconciliation範圍fail closed，無效值令startup失敗。
- Server errors與繁中client mapping覆蓋Design §5.6，且不洩漏SQL、stack、path或他人resource存在性。

### Definition of Done
驗證方式：permission convention、migration、config normalizer、startup guard及error mapping focused tests。

Commit：`feat: add fulfillment permissions and bounded configuration`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-003 — 建立狀態機、數量守恆及canonical payload hash純規則

### Goal
建立不讀DB的Fulfillment／Shipment／Reversal狀態轉換、Base UOM safe-integer數量等式、candidate selection比較及canonical operation hash規則。 （Legacy identity：`P0-T03`；規模估算：M。）

### Approach
預計變更範圍：`fulfillmentConstants.js`、`fulfillmentValidation.js`、`fulfillmentQuantityMath.js`、`server/test/fulfillmentStateMachines.test.js`、`server/test/fulfillmentQuantityMath.test.js`。

依賴：P0-T02。

規格追溯：Requirement §§7、9.1、9.3；BR-001～011、BR-022～030；Design §§3、8.8、11.1。

### Acceptance criteria
- 所有合法／非法狀態轉換及Planned、Claim、Allocated、Picked、Short、Shipped、Reversed邊界有branch-complete tests。
- 數量只接受Base UOM正整數decimal string／safe conversion，不使用浮點；全0 Pick與超額在純規則層拒絕。
- Canonical hash固定key順序、decimal normalization及UTF-8 bytes；相同意圖穩定，同event異payload可識別衝突。
- Provider readiness沒有未記錄缺口，migration分配已鎖定。
- 權限、設定、公開錯誤、狀態及數量純規則focused tests通過。
- 未新增任何Fulfillment業務route或menu入口。

### Definition of Done
驗證方式：`fulfillmentStateMachines.test.js`、`fulfillmentQuantityMath.test.js`、`pickSequence.test.js`及operation hash unit tests。

Commit：`feat: define fulfillment state and quantity invariants`。

#### Intermediate Checkpoint 0A：Identity、Configuration及Pure Rules

- [ ] Provider readiness沒有未記錄缺口，migration分配已鎖定。
- [ ] 權限、設定、公開錯誤、狀態及數量純規則focused tests通過。
- [ ] 未新增任何Fulfillment業務route或menu入口。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-004 — 落地Sales Fulfillment provider及lifecycle契約

### Goal
在Sales模組落地purpose-limited Fulfillment projection、排序鎖Line／Reservation mapping、confirm／reverse result及Sales lifecycle guard；Reversal須保留Cancelled數量並按正式數量重算SO狀態。 （Legacy identity：`P0-T04`；規模估算：M。）

### Approach
預計變更範圍：`SalesFulfillmentService.js`、Sales lifecycle service、Sales provider tests、Sales/Fulfillment contract integration test、Sales state tests。

依賴：P0-T01、P0-T03；Sales Order core及Reservation mapping已落地。

規格追溯：Requirement §§12.1、18.2 GATE-002／004；Design §§2.8、3.6、6.1、6.5。

### Acceptance criteria
- Provider只接受可履約SO狀態並回完整line／reservation versions；IDs及quantities與Design §6.1 wire contract一致。
- Confirm為Reserved減／Fulfilled加，Reversal為Fulfilled減／同Reservation outstanding加；line set、owner、quantity或version不符整筆rollback。
- Withdraw／cancel／close remaining在Sales已取鎖後呼叫Fulfillment guard；active工作或UNKNOWN依賴均fail closed。

### Definition of Done
驗證方式：Sales provider consumer contract、state recalculation、lifecycle guard及真MySQL rollback／lock-order integration tests。

Commit：`feat: add sales fulfillment transaction contracts`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-005 — 落地Inventory allocation／issue／reversal契約

### Goal
在Inventory模組落地bounded candidate、batch allocation／release、batch issue及Fulfillment專用reverse issue並恢復原Reservation的同transaction contracts，所有命令沿用Inventory固定lock order。 （Legacy identity：`P0-T05`；規模估算：M。）

### Approach
預計變更範圍：`InventoryLookupService.js`、`InventoryReservationService.js`、`InventoryPostingService.js`、Inventory provider tests、Fulfillment consumer contract integration test。

依賴：P0-T01、P0-T03；Inventory Reservation／Allocation／Posting已落地。

規格追溯：Requirement §§8.2、8.5～8.6、12.2；GATE-002／003；Design §§6.2、8.3～8.7。

### Acceptance criteria
- Candidate對有Expiry採FEFO、其後無Expiry採First Receipt FIFO並回rank、strategy、eligibility及versions；Fulfillment不自行重算資格。
- Batch allocate／release／issue具exact-set、ownership、version及全有或全無語意；FIFO偏離需原因，FEFO偏離另驗fresh override權限。
- 專用Reversal只接受原Issue refs，回原bucket並恢復Reservation；原Allocation保持Consumed且每個Issue最多一個reversal movement。

### Definition of Done
驗證方式：Inventory provider contract、mixed-expiry排序、batch rollback、concurrent allocation／issue及specialized reversal真MySQL tests。

Commit：`feat: add inventory fulfillment batch contracts`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-006 — 完成Customer Shipping及Item eligibility契約

### Goal
驗證並補足Customer Shipping Address／Contact list與transaction assertions，以及Item inventory-purpose batch lookup／eligibility；Fulfillment只消費allowlisted projection，不複製主檔狀態規則。 （Legacy identity：`P0-T06`；規模估算：M。）

### Approach
預計變更範圍：`CustomerLookupService.js`、`ItemLookupService.js`、Customer provider tests、Item provider tests、Fulfillment master-data contract test。

依賴：P0-T01、P0-T03；Customer及Item provider實作完成。

規格追溯：Requirement §§8.4、9.2、12.3～12.4；BR-012～021；Design §§6.3～6.4、7.3。

### Acceptance criteria
- Address／Contact list只回父Customer的Active shipping用途資料並穩定排序default；transaction assert重驗owner、purpose、status及expected version。
- Item projection包含SKU／Item狀態、Base UOM、inventoryTracked、trackingPolicy及minimumSaleLifeDays；Archived、非tracked或Serial在指定submit points拒絕。
- Contract接受caller transaction executor，不暗中另開transaction；projection不含銀行資料或其他用途child。
- Sales、Inventory、Customer、Item provider／consumer contract tests全部通過。
- 所有internal write拒絕缺少transaction executor及不可信purpose／actor context。
- 跨模組payload、stable errors、versions及Sales → Fulfillment → Inventory lock order一致。

### Definition of Done
驗證方式：Customer／Item provider tests、停用／改用途／改owner／改version cases及Fulfillment consumer contract tests。

Commit：`feat: complete fulfillment master data contracts`。

#### Intermediate Checkpoint 0B：Provider Contract Gate

- [ ] Sales、Inventory、Customer、Item provider／consumer contract tests全部通過。
- [ ] 所有internal write拒絕缺少transaction executor及不可信purpose／actor context。
- [ ] 跨模組payload、stable errors、versions及Sales → Fulfillment → Inventory lock order一致。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-007 — 建立文件序號及durable operation persistence／service

### Goal
建立文件序號及operation request schema，實作不可重用單號、event atomic claim、payload hash、lease CAS、bounded replay result及safe source lookup。 （Legacy identity：`P0-T07`；規模估算：M。）

### Approach
預計變更範圍：一支sequence／operation migration、`FulfillmentOperationService.js`、`fulfillmentOperationService.test.js`、`fulfillmentOperationMigrations.integration.test.js`、operation fixtures。

依賴：P0-T02、P0-T03。

規格追溯：Requirement BR-001、BR-024～027、FR-QUEUE-008～009；Design §§4.2、4.14、8.8。

### Acceptance criteria
- Fulfillment／Shipment／Reversal單號只在首次成功保存時分配，全系統唯一且失敗後不重用。
- 同event＋同hash按SUCCEEDED／FAILED／IN_PROGRESS replay；同event＋不同hash回固定source conflict，並發只有一個winner。
- Lease接管要求matching target及expired lease；operation保留期支持歷史重送且result不保存完整地址或100行payload。

### Definition of Done
驗證方式：sequence、operation hash、claim race、lease takeover、replay/conflict及真MySQL unique tests。

Commit：`feat: add durable fulfillment operation foundation`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-008 — 建立Fulfillment、Claim、Allocation及History schema

### Goal
建立Fulfillment header／line、reservation claim、allocation projection及status history tables，加入composite ownership、CAS version、covering indexes及active claim invariants。 （Legacy identity：`P0-T08`；規模估算：M。）

### Approach
預計變更範圍：兩支動態編號migration、`fulfillmentMigrations.integration.test.js`、Claim concurrency test、schema fixtures。

依賴：P0-T01、P0-T03、P0-T04、P0-T05、P0-T07。

規格追溯：Requirement §§6.2～6.4、FR-QUEUE、FR-PICK；Design §§4.3～4.7、9.3。

### Acceptance criteria
- 所有table具有設計要求的PK、FK、composite ownership、unique、version、epoch時間及Base UOM整數欄位。
- Active Claims對同SO line／reservation可聚合且不重疊；兩個connection競爭時總active claim不超Inventory outstanding。
- Allocation保存Inventory refs、selection strategy、rank、recommended摘要、override reason及snapshot；History append-only。

### Definition of Done
驗證方式：fresh／upgrade／rerun migration、FK／unique／index／trigger tests及雙connection Claim競爭測試。

Commit：`feat: add fulfillment claim and allocation schema`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-009 — 建立Shipment、Issue、Reversal及History schema

### Goal
建立Shipment／lines、issue details、shipment history、reversal／details及Fulfillment active shipment pointer，以DB約束保證單一有效Shipment及不可重複成功Reversal。 （Legacy identity：`P0-T09`；規模估算：M。）

### Approach
預計變更範圍：兩支動態編號shipment／reversal migration、`shipmentMigrations.integration.test.js`、active-pointer race test、schema fixtures。

依賴：P0-T07、P0-T08。

規格追溯：Requirement §§6.5～6.7、FR-SHIP、FR-CONF、FR-REV；Design §§4.8～4.13、4.18。

### Acceptance criteria
- 一張Fulfillment最多一張非CANCELLED Shipment；Cancel後可新建，SHIPPED／REVERSED不能重用原Fulfillment建立另一張。
- Issue／Reversal details以composite ownership連結原Allocation、Reservation及Movement；每個原Issue最多一筆reversal movement。
- Snapshot、status、version、operation及history欄位符合設計；不可變facts不能由一般app SQL更新或刪除。
- Fulfillment、Shipment及Reversal active schema可由fresh及pre-feature DB前向migration。
- Claim競爭、active Shipment pointer及Reversal唯一性由真MySQL約束證明。
- 已套用migration不變，所有新constraint名稱可映射stable public errors。

### Definition of Done
驗證方式：circular FK建立次序、active pointer concurrent create、reversal unique及immutable trigger真MySQL tests。

Commit：`feat: add shipment issue and reversal schema`。

#### Intermediate Checkpoint 0C：Active Aggregate Schema

- [ ] Fulfillment、Shipment及Reversal active schema可由fresh及pre-feature DB前向migration。
- [ ] Claim競爭、active Shipment pointer及Reversal唯一性由真MySQL約束證明。
- [ ] 已套用migration不變，所有新constraint名稱可映射stable public errors。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-010 — 建立Audit、Export及Archive schema與不可變保護

### Goal
建立Fulfillment Audit、Export Job及全部Archive mirrors，擴充Sales archive manifest，加入必要indexes、owner scope、retention及append-only／immutable triggers。 （Legacy identity：`P0-T10`；規模估算：M。）

### Approach
預計變更範圍：兩支動態編號audit／archive migration、Sales manifest migration、`fulfillmentArchiveMigrations.integration.test.js`、archive schema parity test。

依賴：P0-T08、P0-T09。

規格追溯：Requirement FR-AUDIT、FR-EXPORT、FR-ARC；Design §§4.15～4.18、6.5、9.3。

### Acceptance criteria
- Audit只存allowlisted before／after摘要及actor/source，支持成功／拒絕／失敗證據且一般app account不可UPDATE／DELETE。
- Export Job由creator owner scope隔離並保存safe filter／cursor／expiry；路徑欄位只允許private export root內受控值。
- Archive mirrors完整覆蓋header、lines、claims、allocations、issues、history、reversal及必要audit；Sales manifest可保存逐table count／hash。

### Definition of Done
驗證方式：migration、permission/owner、trigger、archive mirror column parity、manifest及app-account immutability真MySQL tests。

Commit：`feat: add fulfillment audit export and archive schema`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-011 — 建立固定lock order、transaction context及測試支援

### Goal
建立Sales → Fulfillment → Inventory固定取鎖helper、transaction-required command context、sorted ID utilities，以及可注入Phase A／provider／commit邊界故障和雙connection barrier的測試支援。 （Legacy identity：`P0-T11`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentLockService.js`、`fulfillmentValidation.js`、`server/test-support/fulfillmentFixtures.js`、`server/test-support/fulfillmentConcurrency.js`、`fulfillmentLockService.test.js`。

依賴：P0-T04～P0-T10。

規格追溯：Requirement BR-023～027、NFR一致性要求；Design §§2.8～2.9、6、11.2。

### Acceptance criteria
- Helper對IDs去重排序並禁止逆序或nested transaction；缺transaction executor／可信actor／固定purpose立即失敗。
- 測試支援可在operation、provider result、snapshot、history及commit邊界注入失敗，並可同步兩條真connection競爭。
- 雙人Claim、mixed Expiry sequence及Serial rejection proof不出現deadlock、overclaim或部分寫入。

### Definition of Done
驗證方式：lock-order unit、transaction context contract、fault injection smoke及真MySQL two-connection tests。

Commit：`test: add fulfillment transaction and concurrency proof`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-012 — 交付Fulfillment Queue查詢垂直切片

### Goal
建立bounded Queue service及`GET /api/v1/fulfillment-queue` handler，按Sales Reservation outstanding減active Claim計算可履約量，提供filter、keyset pagination及穩定排序。 （Legacy identity：`P1-T01`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentQueueService.js`、Queue handler/schema、`fulfillmentQueueService.test.js`、Queue API contract test、Queue integration test。

依賴：P0-GATE。

規格追溯：FR-QUEUE-001～004、FR-QUEUE-010～011；FR-INQ-001；Design §§2.3、5.2、8.1。

### Acceptance criteria
- 只顯示CONFIRMED／PARTIALLY_FULFILLED且fulfillable>0的SO；純Backorder、CONFIRMING、Cancelled、Closed及Completed不出現。
- 支援SO、Customer、Warehouse、delivery date、status、has backorder及active work filters；先取bounded order IDs再batch讀lines／claims，無N+1。
- Negative calculated fulfillable觸發critical mismatch而非截成0；route要求fresh `fulfillment.view`並對未知filter fail closed。

### Definition of Done
驗證方式：Queue service unit、API schema／permission、MySQL projection及EXPLAIN tests。

Commit：`feat: add bounded fulfillment queue inquiry`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-013 — 交付DRAFT Fulfillment建立及Reservation Claim

### Goal
實作`POST /api/v1/fulfillments`，在單一transaction鎖Sales mappings、分配單號、建立header／lines／Claims／history／audit及operation result；同event重送返回原結果。 （Legacy identity：`P1-T02`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentService.js`、create handler/schema、`fulfillmentService.test.js`、create API test、create integration test。

依賴：P1-T01；P0-T04～P0-T11。

規格追溯：FR-QUEUE-005～009、FR-QUEUE-012；BR-001～007；Design §§2.3、3.4、8.2。

### Acceptance criteria
- 只接受一張SO、一個Warehouse及正數Base UOM line quantities；提交重驗SO／line／reservation versions及Serial防護。
- Claims按mapping ID排序分配，active總量不超outstanding；多line任一衝突時整張不建立，On Hand／SO數量不變。
- Same event/hash replay同一Fulfillment；same event異payload conflict；成功response含server產生number、version及quantity projection。

### Definition of Done
驗證方式：create service、strict API contract、domain replay、雙connection overclaim及failure rollback真MySQL tests。

Commit：`feat: create draft fulfillment with reservation claims`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-014 — 交付Fulfillment list、detail及versioned update

### Goal
交付Active Fulfillment list／detail及DRAFT update，detail分批載入children；update完整replace lines並在同transaction以claim delta調整，避免先release產生競爭窗口。 （Legacy identity：`P1-T03`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentService.js`、`FulfillmentInquiryService.js`、list/detail/update handlers、`fulfillmentInquiryService.test.js`、Fulfillment API integration test。

依賴：P1-T02。

規格追溯：FR-INQ-002、FR-INQ-005；FR-QUEUE-006～007、010；BR-022～027；Design §§5.2、8.2、8.9。

### Acceptance criteria
- List／detail支援設計filters、bounded pagination、history及server-calculated `allowedActions`，child以parent ownership查詢。
- DRAFT update要求expected version及完整line set；鎖全部受影響mappings後原子套用delta，過時或超額回穩定conflict。
- 非DRAFT不可修改，client不可寫number、status、snapshots或quantity projections；read不更新business timestamp。
- Queue → create → detail垂直流程可在專用MySQL執行。
- 同時建立／修改不造成overclaim或lost update，same event replay不重複工作。
- Fulfillment建立／更新不改Inventory On Hand、Reservation outstanding、SO Fulfilled或Backorder。

### Definition of Done
驗證方式：inquiry/update unit、API schema／IDOR、concurrent claim delta及read projection integration tests。

Commit：`feat: add fulfillment inquiry and versioned draft update`。

#### Intermediate Checkpoint 1A：Queue及DRAFT Claims

- [ ] Queue → create → detail垂直流程可在專用MySQL執行。
- [ ] 同時建立／修改不造成overclaim或lost update，same event replay不重複工作。
- [ ] Fulfillment建立／更新不改Inventory On Hand、Reservation outstanding、SO Fulfilled或Backorder。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-015 — 交付Allocation Candidates及推薦次序

### Goal
交付每張DRAFT Fulfillment的allocation candidate endpoint，批量呼叫Inventory候選contract並返回合資格Bin／Lot、FEFO／FIFO次序、versions及recommended summary。 （Legacy identity：`P1-T04`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentAllocationService.js`、candidate handler/schema、`fulfillmentAllocationService.test.js`、candidate API test、Inventory candidate contract test。

依賴：P1-T03；P0-T05。

規格追溯：FR-PICK-001～005；BR-014～016；Design §§2.4、5.2、6.2、8.3。

### Acceptance criteria
- Query綁定父Fulfillment、Warehouse、SKU、Claims及minimum remaining days，拒絕替換任一owner ID。
- 有Expiry先FEFO，其後無Expiry按First Receipt FIFO；stable tie-break及rank直接使用Inventory結果，不由Fulfillment改寫。
- Candidate已變更、依賴不可用或Inventory result set不完整時fail closed並提供reload指引。

### Definition of Done
驗證方式：candidate service、provider contract、API IDOR、mixed Expiry及bounded result tests。

Commit：`feat: expose inventory-ranked allocation candidates`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-016 — 交付批次Allocation及FEFO／FIFO例外控制

### Goal
交付Fulfillment Allocate命令，以一個event及transaction建立整批Inventory Allocations與本地projection，成功後狀態轉PICKING並保存recommendation、selection及例外證據。 （Legacy identity：`P1-T05`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentAllocationService.js`、allocate handler/schema、`fulfillmentAllocationService.test.js`、allocate API test、allocation integration test。

依賴：P1-T04。

規格追溯：FR-PICK-003～007、FR-PICK-012；SEC-003；Design §§3.5、5.2、8.3。

### Acceptance criteria
- Selected set無duplicate且完整覆蓋active Claims；任一line不足或version失效時全部rollback，狀態維持DRAFT。
- FIFO偏離要求`fulfillment.operation`及原因；FEFO偏離另要求fresh `inventory.fefo.override`，不合資格庫存任何權限都拒絕。
- Provider result IDs、quantity、owner、strategy及versions須exact match；不匹配回critical contract error，不保存部分projection。

### Definition of Done
驗證方式：allocation unit、permission matrix、strict API、multi-line rollback及Inventory reconciliation真MySQL tests。

Commit：`feat: allocate fulfillment with sequence controls`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-017 — 交付原子Reallocation

### Goal
交付PICKING狀態下的Reallocate命令，在同一event及transaction先驗舊Allocation、再由Inventory原子release＋allocate；任何後段失敗保留完整原結果。 （Legacy identity：`P1-T06`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentAllocationService.js`、reallocate handler/schema、`fulfillmentReallocationService.test.js`、reallocate API test、reallocate integration test。

依賴：P1-T05。

規格追溯：FR-PICK-011～012；BR-023～027；Design §§2.4、5.2、8.3。

### Acceptance criteria
- 只允許未Pick Confirm的PICKING工作，要求expected Fulfillment及Allocation versions與exact old/new sets。
- Release舊結果後create新結果任一步失敗均rollback；不出現無Allocation窗口或部分新projection。
- History／Audit保存舊／新摘要、recommendation、actual selection、actor、reason及Inventory refs；same event重送不重複release。
- Mixed Expiry／FIFO、FEFO權限、multi-Bin／Lot及candidate stale cases通過。
- Allocate／Reallocate failure injection沒有部分Inventory或Fulfillment效果。
- Inventory Allocation truth與Fulfillment projection逐ID、quantity及version一致。

### Definition of Done
驗證方式：reallocate service、API contract、failure injection、concurrent reallocate／cancel及Inventory projection reconciliation tests。

Commit：`feat: add atomic fulfillment reallocation`。

#### Intermediate Checkpoint 1B：Allocation及Reallocation

- [ ] Mixed Expiry／FIFO、FEFO權限、multi-Bin／Lot及candidate stale cases通過。
- [ ] Allocate／Reallocate failure injection沒有部分Inventory或Fulfillment效果。
- [ ] Inventory Allocation truth與Fulfillment projection逐ID、quantity及version一致。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-018 — 交付Pick Confirmation及Short Pick

### Goal
交付PICKING工作的Pick Confirm命令，要求完整Allocation set並原子保存實揀、短揀、差額release、Claim調整、history、audit及PICKED狀態。 （Legacy identity：`P1-T07`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentPickingService.js`、pick-confirm handler/schema、`fulfillmentPickingService.test.js`、pick API test、pick integration test。

依賴：P1-T05；P1-T06如使用者曾reallocate。

規格追溯：FR-PICKCONF-001～010；BR-004～005、008～009；Design §§2.4、3.3、8.4。

### Acceptance criteria
- 每個Allocation actual picked可為0但不可負或超額；遺漏ID不當0，整張至少一筆picked>0。
- Short quantity要求line reason，差額只release Allocation並使Claim active減／released增；Inventory Reservation outstanding保持不變。
- 任一步失敗全部rollback；same event replay不重複release或累加picked，成功後結果不可直接修改。

### Definition of Done
驗證方式：pick quantity unit、strict API、short reason、multi-line rollback、idempotency及Inventory release integration tests。

Commit：`feat: confirm fulfillment picks and short quantities`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-019 — 交付未出貨Fulfillment取消及Allocation release

### Goal
交付DRAFT／PICKING／PICKED Fulfillment取消；按狀態要求原因及goods-returned確認，原子release未消耗Allocations及Claims後才轉CANCELLED。 （Legacy identity：`P1-T08`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentService.js`、cancel handler/schema、`fulfillmentCancelService.test.js`、cancel API test、cancel integration test。

依賴：P1-T02、P1-T05、P1-T07。

規格追溯：FR-LIFE-001～003；BR-008～009、029；Design §§3.1、5.2、8.2。

### Acceptance criteria
- DRAFT可直接取消；PICKING／PICKED要求原因，有實際picked時另要求已放回原Bin／Lot確認。
- 有非CANCELLED Shipment的Fulfillment拒絕取消；release失敗時狀態、Claims及Allocations完整保留。
- 成功後Queue可重新看到未消耗Reservation，且取消不改On Hand、SO Fulfilled或Backorder。

### Definition of Done
驗證方式：cancel policy、strict API、shipment guard、release rollback、concurrent cancel／reallocate及Queue reconciliation tests。

Commit：`feat: cancel unshipped fulfillments safely`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-020 — 建立Fulfillment client services及stable error mapping

### Goal
建立typed-ish Fulfillment HTTP service、filter／pagination normalization、operation response處理及安全繁中錯誤映射，作為全部P1頁面的唯一client contract。 （Legacy identity：`P1-T09`；規模估算：M。）

### Approach
預計變更範圍：`client/src/services/fulfillment.js`、client error message map、`client/test/fulfillmentService.test.js`、`client/test/fulfillmentErrors.test.js`。

依賴：P1-T01～P1-T08 API contracts穩定。

規格追溯：Design §§5.1～5.2、9.4、10；SEC-001～005。

### Acceptance criteria
- Queue、Fulfillment CRUD、candidate、allocate、reallocate、pick、cancel及Pick List calls與server schemas一致。
- 409 stale/candidate/sequence/short conflicts保留使用者輸入並提供reload／修正動作；403／404不洩漏resource存在性。
- Query filters可序列化至URL且未知status／sort不送出；client不自行計算allowed actions或business quantities。
- Create → allocate → reallocate → short/full pick → cancel的合法／非法路徑有API及MySQL證據。
- Client request／response與stable errors已固定，Frontend無重複business calculation。
- 權限撤銷、stale version及provider unavailable均fail closed並保留可恢復輸入。

### Definition of Done
驗證方式：client service request/response、error mapping、URL filter及202/409 branch unit tests。

Commit：`feat: add fulfillment client contracts`。

#### Intermediate Checkpoint 1C：Picking Backend及Client Contract

- [ ] Create → allocate → reallocate → short/full pick → cancel的合法／非法路徑有API及MySQL證據。
- [ ] Client request／response與stable errors已固定，Frontend無重複business calculation。
- [ ] 權限撤銷、stale version及provider unavailable均fail closed並保留可恢復輸入。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-021 — 交付Queue、Create及Fulfillment列表頁

### Goal
依`docs/frontend-design.md`交付Queue、create panel及Fulfillment list，以PageHeader、DataTable、URL filters及server pagination呈現工作；route及sidebar按`fulfillment.view`控制。 （Legacy identity：`P1-T10`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentQueuePage.vue`、`FulfillmentsPage.vue`、`FulfillmentCreatePanel.vue`、client menu config、P1 list/page tests。

依賴：P1-T09。

規格追溯：FR-QUEUE、FR-INQ-001～003；Requirement §10；Design §§10.1～10.2、10.6。

### Acceptance criteria
- Queue顯示SO／Customer／Warehouse／日期／狀態及quantity摘要，可選lines／quantity建立工作並處理stale conflict。
- List支援My Recent Work、Active、Exceptions、Finalized視圖與design filters；直接URL無權時安全403。
- 375～1440px、鍵盤、焦點、loading／empty／error及非純顏色狀態表達符合前端規範。

### Definition of Done
驗證方式：Vue component／route／permission tests、responsive DOM checks及手動鍵盤流程。

Commit：`feat: add fulfillment queue and work list pages`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-022 — 交付詳情、Allocation、Reallocation及Pick介面

### Goal
交付Fulfillment detail與Allocation／Pick panels，顯示quantity守恆、Bin／Lot／Expiry、推薦與實選、history及server允許操作；所有例外與確認使用共用元件。 （Legacy identity：`P1-T11`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentDetailPage.vue`、`AllocationPanel.vue`、`PickConfirmationPanel.vue`、`FulfillmentQuantitySummary.vue`、detail/picking page tests。

依賴：P1-T09、P1-T10。

規格追溯：FR-PICK-001～012、FR-PICKCONF-001～010、FR-INQ-005；Design §§10.3、11.5。

### Acceptance criteria
- Allocation預設顯示Inventory推薦次序；FIFO原因與FEFO權限／原因明確區分，candidate conflict可reload而不靜默改選。
- Pick表單按Allocation輸入actual quantity，Short必填reason，全0提示使用取消；stale submit保留輸入並引導重載。
- 頁面tabs、heading、focus、alert、badge文字及responsive table/card均可及，按鈕只顯示server `allowedActions`。

### Definition of Done
驗證方式：allocation/picking component、detail page、permission、focus/error recovery及responsive tests。

Commit：`feat: add allocation and pick confirmation experience`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-023 — 交付A4 Pick List投影及列印頁

### Goal
建立server-side Pick List projection及A4 browser print page，以當前PICKING Allocation及已保存snapshot產生穩定排序的內部作業文件。 （Legacy identity：`P1-T12`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentPrintService.js`、Pick List handler/schema、`PickListPrintPage.vue`、print service test、print page test。

依賴：P1-T05、P1-T09。

規格追溯：FR-PICK-008～010、FR-DOC-001；BR-031、033；Design §§8.9、10.3。

### Acceptance criteria
- 文件包含Fulfillment／SO、Customer、Warehouse、SKU、Planned、Bin、Lot、Expiry、sequence及notes，按Bin／Lot／SKU穩定排序。
- 只有`fulfillment.view`可列印，projection與當前Allocation一致；列印Audit不改last business update或archive eligibility。
- 使用escaped text、private no-store headers及A4 print CSS；不顯示price、tax、cost、銀行資料或技術錯誤。
- 一般Warehouse Operator可由Queue完成create、allocate、pick及Pick List；Viewer只有查詢／列印。
- 375／768／1024／1440視圖、鍵盤、焦點及直接URL權限測試通過。
- 所有狀態與數量由server projection顯示，Frontend沒有自報status或重算Inventory eligibility。

### Definition of Done
驗證方式：print projection unit、API authorization/header、XSS及browser print DOM／A4 snapshot tests。

Commit：`feat: add auditable fulfillment pick list`。

#### Intermediate Checkpoint 1D：完整Queue至PICKED體驗

- [ ] 一般Warehouse Operator可由Queue完成create、allocate、pick及Pick List；Viewer只有查詢／列印。
- [ ] 375／768／1024／1440視圖、鍵盤、焦點及直接URL權限測試通過。
- [ ] 所有狀態與數量由server projection顯示，Frontend沒有自報status或重算Inventory eligibility。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-024 — 交付Shipment Draft create／update／cancel

### Goal
交付Shipment list／detail基礎及DRAFT create／update／cancel命令；create鎖Fulfillment並使用active pointer保證最多一張非CANCELLED Shipment，Draft只允許修改地址／Contact及物流欄位。 （Legacy identity：`P2-T01`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentService.js`、Shipment CRUD handlers/schemas、`shipmentService.test.js`、Shipment API test、Shipment integration test。

依賴：P1-GATE；P0-T09。

規格追溯：FR-SHIP-001～003、008～012；FR-LIFE-004～005；BR-029；Design §§2.5、5.3、8.5。

### Acceptance criteria
- 只可由PICKED Fulfillment建立；same create intent返回既有Shipment，其他event回`SHIPMENT_ALREADY_EXISTS`，並發create最多一個winner。
- Draft只能修改有效Address／Contact reference、carrier、tracking、package、weight及notes，不可修改SKU、Bin、Lot或picked quantity。
- Cancel Draft不產生Issue／SO效果，清active pointer並使Fulfillment維持／返回PICKED；SHIPPED不可update或一般cancel。

### Definition of Done
驗證方式：Shipment service、strict API、active-pointer race、version conflict及create/update/cancel真MySQL tests。

Commit：`feat: add versioned shipment draft lifecycle`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-025 — 交付Customer地址／聯絡人lookup及transaction重驗

### Goal
交付Fulfillment專用Shipping Address／Contact lookup handlers及Shipment Draft選擇行為，並建立Confirm提交時使用同transaction executor的ownership、purpose、status、version assertions。 （Legacy identity：`P2-T02`；規模估算：M。）

### Approach
預計變更範圍：fulfillment lookup handlers/schemas、`ShipmentService.js`、Customer contract integration test、lookup API test、address assertion test。

依賴：P2-T01；P0-T06。

規格追溯：FR-SHIP-004～007；FR-CONF-002、004；BR-017～021；Design §§5.4、6.3、8.5。

### Acceptance criteria
- Lookup要求view＋operation及父SO Customer ownership，只回Active shipping資料，唯一有效default排前；Contact可為空。
- 沒有Address可保留PICKED工作但不可Confirm；不得接受自由文字或靜默改選，提供Customer維護入口。
- 頁面載入後停用、移除用途、改owner或改version時Confirm必須失敗；Contact選填但選用時同樣重驗。
- PICKED → DRAFT Shipment建立／修改／取消及重建流程通過。
- Active pointer並發唯一性、Address owner／purpose／version及no-address分支有真MySQL證據。
- 尚未開放Confirm時，Draft操作不扣Inventory或修改Sales quantities。

### Definition of Done
驗證方式：lookup API permission／IDOR、Customer provider contract、address change race及no-address integration tests。

Commit：`feat: add shipment address and contact validation`。

#### Intermediate Checkpoint 2A：Shipment Draft及地址

- [ ] PICKED → DRAFT Shipment建立／修改／取消及重建流程通過。
- [ ] Active pointer並發唯一性、Address owner／purpose／version及no-address分支有真MySQL證據。
- [ ] 尚未開放Confirm時，Draft操作不扣Inventory或修改Sales quantities。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-026 — 實作Shipment Confirm Phase A durable intent

### Goal
實作`startConfirmation()`，在短transaction內以event/hash claim operation、保存immutable target/payload摘要、取得lease並把Shipment轉SHIPPING；回202 status URL，不執行Inventory或Sales效果。 （Legacy identity：`P2-T03`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentConfirmationService.js`、confirm handler/schema、`shipmentConfirmationService.test.js`、confirm API test、Phase A integration test。

依賴：P2-T01、P2-T02；P0-T07。

規格追溯：FR-CONF-001、006～007、015；BR-024～026；Design §§2.6、8.6、8.8。

### Acceptance criteria
- 只接受完整DRAFT Shipment、父Fulfillment=PICKED、fresh actor及`fulfillment.operation`；新event不能繞過既有SHIPPING intent。
- 同event／hash按原狀態replay，同event異payload conflict；Phase A commit後只存在SHIPPING及operation evidence，無Issue或Sales更新。
- Payload hash涵蓋Shipment/version/Address/Contact/物流欄位及確認意圖；result／log不含完整地址或敏感payload。

### Definition of Done
驗證方式：confirmation Phase A unit、API preflight、same/different event、concurrent double-click及post-Phase-A crash tests。

Commit：`feat: persist durable shipment confirmation intent`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-027 — 實作Phase B固定鎖序及跨模組原子交易

### Goal
實作`completeConfirmation(eventId)`，鎖operation後依Sales → Fulfillment → Inventory固定順序重驗全部資料，以exact Issue batch呼叫Inventory，再套用Sales結果及保存snapshot／history／audit／operation success。 （Legacy identity：`P2-T04`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentConfirmationService.js`、confirmation transaction test、Sales provider integration test、Inventory issue integration test、confirmation failure-injection test。

依賴：P2-T03；P0-T04～P0-T06、P0-T11。

規格追溯：FR-CONF-002～005、008～014、016；BR-005、009～011、026～027；GATE-002；Design §§2.6、6.1～6.4、8.6。

### Acceptance criteria
- Fresh驗證涵蓋actor、SO、lines/mappings、Fulfillment、Shipment、Address/Contact、Item/Serial、Claims、Allocations、Bin/Lot/Expiry/Status及versions。
- Inventory Issue、Reservation consume、Sales Reserved/Fulfilled、Shipment／Fulfillment SHIPPED、Claims consumed及所有snapshots在同一commit；result set／quantity／owner不符全部rollback。
- Business error證明未有外部效果時同transaction回DRAFT並標記FAILED；technical／commit unknown保留SHIPPING供Recovery，不推測失敗。

### Definition of Done
驗證方式：confirmation unit、provider set mismatch、100-line multi-Bin/Lot atomicity、failure injection、deadlock/rollback及Sales/Inventory reconciliation真MySQL tests。

Commit：`feat: atomically confirm shipment across sales and inventory`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-028 — 交付Confirm API、domain idempotency及operation lookup

### Goal
完成Confirm handler的同步成功／202不明結果envelope及`GET /api/v1/fulfillment-operations/by-event/:eventId`，安全回傳SUCCEEDED／FAILED／IN_PROGRESS結果並套用target owner visibility。 （Legacy identity：`P2-T05`；規模估算：M。）

### Approach
預計變更範圍：confirm handler/schema、operation lookup handler/schema、`FulfillmentOperationService.js`、Confirm API test、operation API test。

依賴：P2-T03、P2-T04。

規格追溯：FR-CONF-006～009、015～016；SEC-001～005；Design §§5.1、5.3、5.5、8.8。

### Acceptance criteria
- Confirm要求strict schema、version、event及framework idempotency；3秒內未完成時回202、correlation、status URL及Retry-After。
- Operation lookup只讓具target view且可見該aggregate的actor讀取，回bounded IDs/status/versions，不回完整payload、address或internal error。
- Same HTTP key異payload及same event異payload分別穩定409；重送成功結果不重複Issue、Consume或Fulfilled。
- 100行／多Bin／Lot confirm成功只產生一組Issue、Sales及Shipment效果。
- 任一provider／snapshot／history／audit失敗均不留下部分效果。
- Double click、HTTP retry、event replay及commit結果不明均以原event收斂。

### Definition of Done
驗證方式：Confirm／operation API contract、permission/IDOR、same-key conflict、same-event replay及202 envelope tests。

Commit：`feat: expose recoverable shipment confirmation outcomes`。

#### Intermediate Checkpoint 2B：Atomic Confirmation Core

- [ ] 100行／多Bin／Lot confirm成功只產生一組Issue、Sales及Shipment效果。
- [ ] 任一provider／snapshot／history／audit失敗均不留下部分效果。
- [ ] Double click、HTTP retry、event replay及commit結果不明均以原event收斂。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-029 — 交付Confirm Recovery Job及commit-unknown收斂

### Goal
建立cluster-leased Confirmation Recovery Job，掃描過期SHIPPING operations，以原event/hash/actor/target CAS接管並續跑Phase B；unknown commit先按source outcome查證，絕不產生新event。 （Legacy identity：`P2-T06`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentConfirmationRecoveryJob.js`、scheduler registry、`shipmentConfirmationRecoveryJob.test.js`、recovery integration test、scheduler lease test。

依賴：P2-T05。

規格追溯：FR-CONF-015～016；NFR一致性／可用性；Design §§2.6、12.2～12.4。

### Acceptance criteria
- Job每次bounded batch、lease renew小於lease一半、尊重AbortSignal；同一operation同時最多一個有效worker。
- Phase A後crash、Phase B前crash及connection lost after commit均收斂為唯一SUCCEEDED／FAILED／仍IN_PROGRESS結果。
- 永久business failure不無限retry；transient failure使用bounded exponential backoff+jitter並產生safe metrics／alerts。

### Definition of Done
驗證方式：recovery job unit、lease race、process crash、commit-unknown source lookup、shutdown及retry exhaustion真MySQL tests。

Commit：`feat: recover indeterminate shipment confirmations`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-030 — 交付Shipment查詢及Delivery Note／Packing List投影

### Goal
完成Shipment active list／detail及server-side Delivery Note／Packing List projection，detail分批載入lines、issues及history，文件使用確認時snapshot並明確反映current status。 （Legacy identity：`P2-T07`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentInquiryService.js`、`FulfillmentPrintService.js`、Shipment read/print handlers、Shipment inquiry test、Delivery Note test。

依賴：P2-T04、P2-T05。

規格追溯：FR-INQ-003～007、FR-DOC-002～004；BR-031～033；Design §§5.3、8.9、10.4。

### Acceptance criteria
- List支援number、SO、Customer、Warehouse、status、date、carrier、tracking filters及exact lookup；detail可追至Fulfillment、SO、Inventory movements。
- SHIPPED文件包含Shipment／SO／Customer／Address snapshot／SKU／quantity及選填物流資料，不含price、tax、cost、bank或internal errors。
- Projection escaped、private/no-store、safe filename及Audit；未SHIPPED拒絕有效Delivery Note，read/print不改business timestamp。
- Recovery與operation lookup對所有crash／unknown結果只使用原event。
- Shipment exact inquiry及Delivery Note符合權限、snapshot與no-sensitive-data要求。
- SHIPPING狀態不接受update、cancel、第二次confirm或有效Delivery Note。

### Definition of Done
驗證方式：Shipment inquiry、print projection、API filters/IDOR/headers、XSS及A4 document tests。

Commit：`feat: add shipment inquiry and delivery document projection`。

#### Intermediate Checkpoint 2C：Recovery及Read Model

- [ ] Recovery與operation lookup對所有crash／unknown結果只使用原event。
- [ ] Shipment exact inquiry及Delivery Note符合權限、snapshot與no-sensitive-data要求。
- [ ] SHIPPING狀態不接受update、cancel、第二次confirm或有效Delivery Note。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-031 — 建立Shipment client service及polling控制

### Goal
建立Shipment CRUD／Confirm／lookup／document client service，以及只poll原status URL的bounded controller；頁面離開或terminal outcome時停止polling。 （Legacy identity：`P2-T08`；規模估算：M。）

### Approach
預計變更範圍：`client/src/services/shipment.js`、client polling helper、client error map、`shipmentService.test.js`、polling controller test。

依賴：P2-T05、P2-T07。

規格追溯：Design §§5.3、5.5、9.4、10.4；FR-CONF-015～016。

### Acceptance criteria
- Client contracts覆蓋list/detail/create/update/cancel/confirm/document及operation lookup，request與server strict schemas一致。
- 202只保存event、correlation及status URL並poll原operation；不得自動建立新event或重送Phase A。
- DRAFT／SHIPPING／SHIPPED／FAILED outcome及Address／Allocation conflicts有安全繁中訊息和下一步。

### Definition of Done
驗證方式：Shipment client request/response、polling lifecycle、202→success/failure及component-unmount tests。

Commit：`feat: add shipment client and outcome polling`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-032 — 交付Shipment列表、建立、詳情及取消介面

### Goal
依前端規範交付Shipment list、create/edit form及detail頁，預選有效default Address／Contact，呈現物流欄位、quantity／issue/history及server allowed actions。 （Legacy identity：`P2-T09`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentListPage.vue`、`ShipmentDetailPage.vue`、`ShipmentFormPanel.vue`、client menu config、Shipment page tests。

依賴：P2-T02、P2-T08。

規格追溯：FR-SHIP-001～012、FR-INQ-003／006；Requirement §10.3；Design §§10.1、10.4、10.6。

### Acceptance criteria
- Shipment list/detail filters、URL state、loading/empty/error及跨SO／Fulfillment links正確；直接URL權限安全拒絕。
- Form不提供自由地址，default可改選其他有效shipping address；Contact與物流欄位選填，package／weight條件驗證清楚。
- Cancel Draft有共用確認；SHIPPING／SHIPPED表單唯讀，375～1440px、鍵盤及焦點行為符合規範。

### Definition of Done
驗證方式：Vue page/form、route permission、validation、address default及responsive/a11y tests。

Commit：`feat: add shipment management pages`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-033 — 交付Confirm摘要、恢復及A4文件列印頁

### Goal
交付Confirm summary、二次確認、SHIPPING progress/recovery及Delivery Note／Packing List print page；顯示Address snapshot、完整quantity摘要及不可重複操作提示。 （Legacy identity：`P2-T10`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentConfirmationSummary.vue`、`DeliveryNotePrintPage.vue`、`ShipmentDetailPage.vue`、confirmation UI test、print page test。

依賴：P2-T08、P2-T09。

規格追溯：FR-CONF-001～016、FR-DOC-002～004；Design §§10.4、11.5。

### Acceptance criteria
- Confirm前顯示Shipment／SO／Address／Lines／Bin／Lot／quantities及選填物流摘要，submit後鎖表單並只poll原operation。
- Address／Allocation stale時保留可修正資料並導向重新選擇／分配；technical unknown顯示correlation及安全等待狀態。
- A4頁使用server projection、escaped text及status watermark；REVERSED預留顯眼標記，不可被CSS隱藏。
- PICKED → DRAFT Shipment → SHIPPING → SHIPPED及Draft cancel/recreate可由UI端到端完成。
- Address變更、Allocation失效、撤權、double click及unknown outcome均有可理解且可恢復體驗。
- Delivery Note／Packing List與確認snapshot一致，不顯示商業價格、銀行或技術敏感資料。

### Definition of Done
驗證方式：confirmation summary、double-click、poll recovery、focus/error及browser print tests。

Commit：`feat: add shipment confirmation and document experience`。

#### Intermediate Checkpoint 2D：完整Shipment體驗

- [ ] PICKED → DRAFT Shipment → SHIPPING → SHIPPED及Draft cancel/recreate可由UI端到端完成。
- [ ] Address變更、Allocation失效、撤權、double click及unknown outcome均有可理解且可恢復體驗。
- [ ] Delivery Note／Packing List與確認snapshot一致，不顯示商業價格、銀行或技術敏感資料。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-034 — 實作Reversal guard及Phase A intent

### Goal
實作Reversal request驗證、Downstream Matter registry及Phase A短transaction，以event/hash claim operation、分配不可重用Reversal Number、保存兩項確認與原因，並把Shipment轉REVERSING。 （Legacy identity：`P3-T01`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentReversalService.js`、`FulfillmentDownstreamMatterService.js`、reverse handler/schema、`shipmentReversalService.test.js`、reversal Phase A integration test。

依賴：P2-GATE；P0-T07、P0-T09。

規格追溯：FR-REV-001～004、009～012；GATE-003；Design §§2.7、6.5、8.7。

### Acceptance criteria
- 只接受SHIPPED且未歸檔／未沖銷Shipment、fresh `fulfillment.reverse`、5～500字原因、貨物受公司控制及已回原Bin兩項true確認。
- Returns／Invoicing未上線時registry明確為`NO_PROVIDER_REQUIRED`版本；required provider的UNKNOWN／不可逆事項均阻止Reversal。
- Same event/hash replay原結果，異payload conflict；Phase A後只存在REVERSING、Reversal intent及operation evidence，未回補庫存或改Sales。

### Definition of Done
驗證方式：reversal policy、permission、downstream registry、same/different event、concurrent start及Phase-A crash tests。

Commit：`feat: persist guarded shipment reversal intent`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-035 — 實作原bucket回補、Reservation恢復及Sales重算

### Goal
實作Reversal Phase B，按固定lock order鎖原Issues及相關aggregates，呼叫Inventory專用batch reversal，再由Sales provider減Fulfilled／恢復Reservation，保存details／history／audit並原子轉REVERSED。 （Legacy identity：`P3-T02`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentReversalService.js`、reversal transaction test、Inventory specialized reversal integration test、Sales reversal integration test、reversal failure-injection test。

依賴：P3-T01；P0-T04、P0-T05。

規格追溯：FR-REV-005～011；BR-010、028、030；GATE-003／004；Design §§3.6、6.1～6.2、8.7。

### Acceptance criteria
- 每個原Issue恰有一個結果並回原Warehouse／Bin／Lot／Expiry／Status；caller不能選bucket，原Allocation維持Consumed。
- 原Reservation consumed減／outstanding增，Sales Fulfilled減；Cancelled量保持，CLOSED／COMPLETED按剩餘Fulfilled重算為PARTIALLY_FULFILLED或CONFIRMED。
- 任一bucket、provider、snapshot、history或audit失敗全部rollback；business failure令Shipment回SHIPPED／Reversal FAILED，technical unknown保留REVERSING。

### Definition of Done
驗證方式：original-bucket、inactive/counting Bin、already-reversed movement、Sales reopen、multi-line rollback及failure injection真MySQL tests。

Commit：`feat: atomically reverse shipment effects`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-036 — 交付Reversal API、operation lookup及Recovery Job

### Goal
完成Reverse API的同步／202 envelope、沿用owner-safe operation lookup，並建立cluster-leased Reversal Recovery Job以原event接管過期REVERSING operation。 （Legacy identity：`P3-T03`；規模估算：M。）

### Approach
預計變更範圍：reverse handler/schema、`ShipmentReversalRecoveryJob.js`、scheduler registry、Reverse API test、reversal recovery integration test。

依賴：P3-T02。

規格追溯：FR-REV-002、004、008～010；NFR一致性／恢復；Design §§5.3、5.5、12.2～12.4。

### Acceptance criteria
- API不接受line、quantity或target Bin等多餘欄位；重送不重複Movement、Reservation restore或Sales decrement。
- Recovery只接管matching target/hash的expired lease；unknown commit先查Inventory/Sales source outcome，不用generic movement reversal替代。
- 永久downstream／bucket業務失敗停止retry；transient failure bounded backoff，stuck/failed產生安全metrics及alerts。
- SHIPPED → REVERSING → REVERSED及business failure回SHIPPED的狀態／operation evidence完整。
- Inventory原bucket、Reservation restore、Allocation維持Consumed及Sales狀態重算逐ID對賬一致。
- Concurrent reverse、same-event replay、unknown commit及downstream UNKNOWN不產生重複或部分效果。

### Definition of Done
驗證方式：Reverse／operation API、strict schema、lease race、process crash、commit unknown及retry exhaustion tests。

Commit：`feat: expose and recover shipment reversals`。

#### Intermediate Checkpoint 3A：Reversal Core

- [ ] SHIPPED → REVERSING → REVERSED及business failure回SHIPPED的狀態／operation evidence完整。
- [ ] Inventory原bucket、Reservation restore、Allocation維持Consumed及Sales狀態重算逐ID對賬一致。
- [ ] Concurrent reverse、same-event replay、unknown commit及downstream UNKNOWN不產生重複或部分效果。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-037 — 交付Reversal雙重確認及處理中恢復介面

### Goal
交付Shipment Reversal dialog及detail狀態，明確區分操作更正與Customer Return，要求原因與兩項確認，提交後鎖定並只poll原operation。 （Legacy identity：`P3-T04`；規模估算：M。）

### Approach
預計變更範圍：`ShipmentReversalDialog.vue`、`ShipmentDetailPage.vue`、`DeliveryNotePrintPage.vue`、Reversal dialog test、Shipment reversed-state test。

依賴：P3-T03；P2-T08～P2-T10。

規格追溯：FR-REV-001～004、012；FR-DOC-004；Requirement §10.4；Design §§10.5～10.6。

### Acceptance criteria
- 只有server allowed action及`fulfillment.reverse`顯示入口；沒有部分line／quantity選項，文案說明需整張沖銷後重新履約。
- 原因、貨物受公司控制、已回原Bin兩項確認缺一不可；double submit只使用同event。
- REVERSING顯示correlation／安全等待狀態；成功reload完整detail，REVERSED頁面與文件有文字及watermark標示。

### Definition of Done
驗證方式：Reversal dialog、permission route、validation、double-click、poll recovery、keyboard/focus及REVERSED rendering tests。

Commit：`feat: add guarded shipment reversal experience`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-038 — 交付Active、Operation、Audit及Finalized查詢

### Goal
補齊My Recent Work、Active、Exceptions、Finalized、operation及Audit read models與頁面tabs，以bounded/keyset查詢及server filters連結SO、Fulfillment、Shipment、Movement及Reversal。 （Legacy identity：`P3-T05`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentInquiryService.js`、Active inquiry handlers、`FulfillmentsPage.vue`、`ShipmentListPage.vue`、inquiry API/UI tests。

依賴：P3-T04；P1/P2 inquiry基礎。

規格追溯：FR-INQ-001～007、FR-AUDIT-001～003；Design §§5.2～5.5、8.9、10.1。

### Acceptance criteria
- Fulfillment／Shipment exact number、SO、Customer、Warehouse、status、date、short、carrier及tracking filters使用covering indexes並穩定分頁。
- History供`fulfillment.view`查看，技術operation細節只供獲授權運維；not found／not visible不洩漏其他owner資料。
- UI tabs保留URL state、支援375～1440px及鍵盤，REVERSED／CANCELLED等final狀態不用純顏色表示。
- Reversal API／UI由SHIPPED到REVERSED或安全失敗的狀態、權限及恢復行為一致。
- Active、Exceptions、Finalized、Operation及Audit查詢不洩漏其他Customer／Warehouse或技術敏感資料。
- REVERSED在頁面、列印及匯出projection均有文字狀態，不只依賴顏色。

### Definition of Done
驗證方式：inquiry filter/API/IDOR、EXPLAIN、operation/audit redaction及Vue tab/URL/a11y tests。

Commit：`feat: complete fulfillment lifecycle inquiry`。

#### Intermediate Checkpoint 3B：Reversal UI及Active Inquiry

- [ ] Reversal API／UI由SHIPPED到REVERSED或安全失敗的狀態、權限及恢復行為一致。
- [ ] Active、Exceptions、Finalized、Operation及Audit查詢不洩漏其他Customer／Warehouse或技術敏感資料。
- [ ] REVERSED在頁面、列印及匯出projection均有文字狀態，不只依賴顏色。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-039 — 交付bounded background Export service及worker

### Goal
實作owner-scoped Export Job create／claim／stream／resume／complete／expire，以Active列表相同normalized filters及keyset cursor產生UTF-8 CSV，使用private temp file及atomic rename。 （Legacy identity：`P3-T06`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentExportService.js`、`FulfillmentExportJob.js`、export worker tests、CSV security test、export integration test。

依賴：P3-T05；P0-T10。

規格追溯：FR-EXPORT-001～004；SEC-006～012；Design §§7.4、8.9、12.2。

### Acceptance criteria
- Job限制rows、batch、duration及concurrency，結果截斷時有明確summary；大型匯出不佔用HTTP transaction或阻塞日常交易。
- CSV使用RFC 4180 escaping，`= + - @ TAB CR`開頭cell前置單引號；只輸出Design允許欄位及使用者可見資料。
- Worker cluster lease、resume、AbortSignal及expired cleanup正確；失敗不暴露路徑／SQL或留下可下載partial file。

### Definition of Done
驗證方式：export filter parity、CSV formula/CRLF、worker lease/resume、row limit、file cleanup及concurrency tests。

Commit：`feat: add bounded fulfillment export worker`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-040 — 交付Export APIs、owner-safe下載及前端工作清單

### Goal
交付Export create/list/detail/download handlers及本人Job頁面／狀態控制；下載時fresh permission、owner、expiry及private-root路徑全部重驗並保存Audit。 （Legacy identity：`P3-T07`；規模估算：M。）

### Approach
預計變更範圍：export handlers/schemas、`client/src/services/fulfillment.js`、Export jobs component/page、Export API test、Export UI test。

依賴：P3-T06。

規格追溯：FR-EXPORT-001～004、FR-AUDIT-001；Design §§5.5、7.4、10.1。

### Acceptance criteria
- Create回202；list只見本人Jobs，detail/download同時要求owner及fresh `fulfillment.view`，expired結果回410。
- Download拒絕symlink／path traversal，使用safe filename、`text/csv; charset=utf-8`、no-store及nosniff；Audit後才stream。
- UI顯示queued/running/completed/failed/expired、polling及安全錯誤；使用當前list filters建立Job，不接受client任意columns。
- Reversal UI/API及Active lifecycle查詢可端到端使用，權限與IDOR矩陣通過。
- Export filters與列表一致，公式注入、路徑、owner、expiry及大量工作不影響交易。
- Read、print及export均不修改last business timestamp或archive eligibility。

### Definition of Done
驗證方式：Export API auth/IDOR/header/path tests、expired cleanup、client polling及Export job page tests。

Commit：`feat: add owner-safe fulfillment exports`。

#### Intermediate Checkpoint 3C：Background Export

- [ ] Reversal UI/API及Active lifecycle查詢可端到端使用，權限與IDOR矩陣通過。
- [ ] Export filters與列表一致，公式注入、路徑、owner、expiry及大量工作不影響交易。
- [ ] Read、print及export均不修改last business timestamp或archive eligibility。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-041 — 實作Fulfillment Open Matter及Sales Archive eligibility

### Goal
實作bounded `getOrderArchiveStatus()`及Sales lifecycle/archive guards，按索引檢查非terminal Fulfillment、active Claims、outstanding Allocations及IN_PROGRESS operations；Provider故障回UNKNOWN並fail closed。 （Legacy identity：`P3-T08`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentOpenMatterService.js`、Sales archive eligibility service、open-matter tests、Sales consumer contract test、open-matter integration test。

依賴：P3-T03、P3-T05；Sales Archive framework已落地。

規格追溯：FR-ARC-001～003；BR-034～036；GATE-005；Design §§6.5、8.10。

### Acceptance criteria
- PICKING、PICKED、SHIPPING、REVERSING、active Claim、outstanding Allocation或IN_PROGRESS operation均回OPEN及穩定reason codes。
- 全部terminal且無open matter才回CLOSED；dependency失效回UNKNOWN，不以false或empty results放行Sales archive。
- Query使用bounded EXISTS及covering indexes，不載入完整aggregate；Sales lifecycle在release Reservation前調用guard。

### Definition of Done
驗證方式：open-matter unit、provider UNKNOWN、Sales lifecycle integration及production-like EXPLAIN tests。

Commit：`feat: add fulfillment archive eligibility provider`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-042 — 實作Sales協調的Fulfillment原子Archive Participant

### Goal
實作只供Sales Archive service identity調用的`archiveOrderInTransaction()`，在同一transaction鎖定並複製Fulfillment aggregate、逐table驗count/hash、更新routing／operation marker後才按FK順序移除Active。 （Legacy identity：`P3-T09`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentArchiveParticipant.js`、Sales Archive service、archive participant tests、archive transaction integration test、routing/manifest test。

依賴：P3-T08；P0-T10；Sales Archive aggregate move已落地。

規格追溯：FR-ARC-004～006、008～010；GATE-005；Design §§2.7、4.17、6.5、8.10。

### Acceptance criteria
- Participant要求caller transaction、Sales service identity、order/batch/cutoff及expected manifest；不得提供HTTP mutation或自行排程。
- Archive parents先於children寫入，read-back count/hash全部符合後才清active pointer及刪Active；任一conflict／中斷整批rollback並保留Active。
- Sales manifest同時包含Sales及Fulfillment hashes/counts；same batch/hash可恢復，different hash conflict，不使用`INSERT IGNORE`。

### Definition of Done
驗證方式：archive participant unit、copy/hash/delete、failure injection、same/different hash、active/archive routing及Sales-coordinated transaction真MySQL tests。

Commit：`feat: archive sales and fulfillment aggregates atomically`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-043 — 交付Archive查詢API及唯讀詳情頁

### Goal
交付Archived Fulfillment／Shipment list/detail APIs及頁面，使用Archive-only bounded filters、唯一routing及唯讀snapshot；Archive unavailable顯示不可用而非零結果。 （Legacy identity：`P3-T10`；規模估算：M。）

### Approach
預計變更範圍：archive handlers/schemas、`FulfillmentArchivePage.vue`、archive detail pages、Archive API test、Archive page test。

依賴：P3-T09。

規格追溯：FR-ARC-006～010；FR-INQ-004～007；Design §§5.5、10.1、11.5。

### Acceptance criteria
- List至少要求exact number、SO、Customer或≤366日date range其一；禁止空條件全掃描，Active/Archive不做無界union。
- Detail完整顯示lines、allocations、issues、address/contact snapshots、history及Reversal，但沒有修改、取消、Confirm或Reverse action。
- Active 404只回安全`mayExistInArchive`提示；Archive unavailable回明確錯誤，頁面保留filters並不顯示假empty state。
- Sales與Fulfillment只會同處Active或Archive，exact routing永遠唯一。
- Archive中斷、same hash重跑、different hash conflict及provider UNKNOWN全部保留可證明一致的Active結果。
- Archive頁唯讀且不可用時不顯示假零資料；operation outcome在歸檔後仍可追溯。

### Definition of Done
驗證方式：Archive API filter/IDOR/routing/unavailable tests、EXPLAIN及Archive list/detail Vue tests。

Commit：`feat: add bounded fulfillment archive inquiry`。

#### Intermediate Checkpoint 3D：Archive Aggregate

- [ ] Sales與Fulfillment只會同處Active或Archive，exact routing永遠唯一。
- [ ] Archive中斷、same hash重跑、different hash conflict及provider UNKNOWN全部保留可證明一致的Active結果。
- [ ] Archive頁唯讀且不可用時不顯示假零資料；operation outcome在歸檔後仍可追溯。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-044 — 交付Reconciliation、可觀測性及runbooks

### Goal
實作read-only Reconciliation service/job，加入bounded scheduler、structured events、metrics、alerts及操作runbooks，雙向核對Sales、Fulfillment、Inventory、Active／Archive及operation truth；不自動修資料。 （Legacy identity：`P3-T11`；規模估算：M。）

### Approach
預計變更範圍：`FulfillmentReconciliationService.js`、`FulfillmentReconciliationJob.js`、observability registration、reconciliation tests、Fulfillment runbook document。

依賴：P3-T03、P3-T07、P3-T10。

規格追溯：FR-AUDIT-001～003；NFR可觀測性／營運；Design §§8.11、12.2～12.4。

### Acceptance criteria
- 對賬覆蓋SO Reserved/Fulfilled、Reservation、Claims、Allocations、Issues/Reversals、states、active pointer、routing及manifest count/hash。
- Events/metrics涵蓋Queue age、short/override、confirm/reverse outcome、stuck age、lock wait、provider failure、export/archive及mismatch；log只含allowlisted IDs/counts/codes。
- Runbooks涵蓋stuck SHIPPING／REVERSING、Claim mismatch、FEFO dispute、archive conflict及restore validation；任何修復需另行批准forward script。

### Definition of Done
驗證方式：reconciliation unit/integration、scheduler lease、redaction、metric/event contract及runbook scenario review。

Commit：`feat: add fulfillment reconciliation and operations evidence`。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

## TASK-045 — 完成容量、安全、restore及UAT release evidence

### Goal
在production-like資料與專用環境執行最終容量、50-user並發、安全、archive中斷、backup/restore及需求追溯驗證；只修正本模組發現的問題，不降低資料集或門檻。 （Legacy identity：`P3-T12`；規模估算：M。）

### Approach
預計變更範圍：Fulfillment load-test scenario、security regression suite、restore verification script、release evidence document、UAT traceability checklist。

依賴：P3-T01～P3-T11。

規格追溯：AC-001～056；NFR-PERF-001～007；Requirement §§13、15～16；Design §§11.6～11.8、13。

### Acceptance criteria
- 730萬Active Fulfillments及Shipments、平均5/P95 30/最大100 lines、mixed allocations及25%分批SO下，所有P95門檻、EXPLAIN、rows examined、pool及heap證據達標。
- IDOR、撤權、XSS、CSV、log redaction、download path、direct internal reversal及Counting/Inactive Bin abuse cases全部通過。
- 隔離restore後Sales → Fulfillment → Inventory → Archive可雙向追溯，manifest count/hash一致；AC-001～056及UAT owner簽核無缺口。
- 功能、transaction、recovery、security、performance、archive及restore證據均對應固定commit SHA與測試環境。
- 所有56項AC、FR／BR／SEC／NFR及Design Gates均可追至Task與測試結果。
- 沒有skip、suppressions、降低coverage／資料量／效能門檻或未批准的自動修復。

### Definition of Done
驗證方式：performance harness、50-user concurrency、security regression、backup/restore rehearsal、archive interruption及UAT evidence review。

Commit：`test: add fulfillment release qualification evidence`。

#### Intermediate Checkpoint 3E：Release Candidate Evidence

- [ ] 功能、transaction、recovery、security、performance、archive及restore證據均對應固定commit SHA與測試環境。
- [ ] 所有56項AC、FR／BR／SEC／NFR及Design Gates均可追至Task與測試結果。
- [ ] 沒有skip、suppressions、降低coverage／資料量／效能門檻或未批准的自動修復。

另須滿足 §1.1 每個 Task 的 Definition of Done：只修改本 Task 列明範圍；行為變更先有可重現失敗再完成實作；新 API 具 strict schema、後端 permission、stable public error、CAS version 及適用的 idempotency／IDOR 防護；DB unique／FK／trigger／transaction／lock／archive 行為以專用真 MySQL integration test 驗證；focused tests、受影響 workspace regression 及 `npm run lint` 通過，有前端改動時 `npm run build --workspace client` 通過；不 skip／刪除測試、不降低 coverage floor、不增加 lint suppression 或 production fake；log／audit／error／test evidence 不含 token、完整地址或聯絡資料、Customer 銀行資料、SQL、stack 或完整輸入 payload；形成一個可獨立 revert 的 atomic commit；並把本 Task 的測試案例 ID 回填 `08_traceability.json` 與 Phase evidence。

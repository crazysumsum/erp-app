# Purchasing & Receiving Management 開發任務計劃

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 依據 | `requirement.md`、`design_spec.md` |
| 目的 | 把已批准需求及設計拆成可在單一專注工作階段完成、測試及審查的工程任務 |
| 交付模式 | 5 個 Phase；每個 Phase 一個獨立 worktree／分支、一個 PR、一次完整測試週期 |
| 實作狀態 | 本文件只制定計劃；尚未執行任何開發或功能測試 |
| Task sizing | 每項 Task 原則上修改 1～5 個檔案；如實作時超過 5 個檔案，須先再拆分 |
| Migration 規則 | 不預留固定序號；每個 Phase 開始前先 fetch 最新 `main`，按當時下一個連續序號命名 |

本文件是本模組唯一 Task List target，取代通用技能建議的 `tasks/plan.md` 及 `tasks/todo.md`，以符合本專案按模組在 `docs/<module>/tasks.md` 管理計劃的慣例。

---

## 1. 執行原則與完成定義

### 1.1 每項 Task 的完成定義

- [ ] 只實作該 Task 列明的範圍，所有驗收條件均有自動化測試或明確人工驗證證據。
- [ ] 新增或修改的 API schema 使用 `additionalProperties:false`；寫入操作在提交點重驗權限、版本、狀態及 Provider 資料。
- [ ] Task 指定的 focused tests 通過；不得 skip 測試、降低 coverage、加入 suppressions 或建立 production fallback。
- [ ] 每個 Task 形成一個可審查的 atomic commit；commit message 使用 `feat:`、`fix:`、`test:`、`docs:` 或 `chore:`。
- [ ] 如實作發現需求、狀態機、Provider contract、Inventory lock protocol 或 Reversal 不變量需要改變，先停止並更新規格取得確認。

### 1.2 每個 Phase 的 PR Gate

- [ ] Phase 內全部 Tasks 及 Checkpoint 完成，沒有未解決的 blocker、TODO stub 或 migration failure。
- [ ] 在該 Phase 的獨立 worktree 執行 `npm run lint`、server／client tests、coverage、client build及security audit。
- [ ] 需要資料庫驗證的 Phase 必須在專用測試 MySQL 執行 migrations及指定 integration tests，不得使用開發或正式資料庫。
- [ ] PR 說明列出需求追溯、migration／rollback影響、測試證據、已知限制及下一 Phase capability gate。
- [ ] 合併前 fetch 最新 `main`；如目標已移動，先在 Phase 分支整合並重新執行 Gate，合併後移除 worktree及分支。

### 1.3 依賴圖與串並行規則

```text
Phase 0 Provider / Framework Gate
        |
        v
Phase 1 PO Foundation
        |
        v
Phase 2 Approval & PO Lifecycle
        |
        v
Phase 3 Goods Receiving & Inventory Posting
        |
        v
Phase 4 Reversal, Reporting & Release Evidence
```

- Phase 必須依序執行；下一 Phase 不得在上一 Phase PR Gate 未通過前向一般使用者開放入口。
- 同一 Phase 內，純函式／schema、Provider contract tests及獨立前端元件可在契約固定後並行。
- Migration、共用 service contract、同一 aggregate 狀態機及 Inventory lock order 修改必須順序執行。
- Supplier、Item及Inventory只納入 Purchasing & Receiving 所需的最小契約；不在此計劃重做完整主資料或庫存模組。

---

## 2. Phase 0：Provider 與 Framework Gate

### 2.1 Phase 目標與結果

**目標：** 關閉 Purchasing 所有跨模組與共用框架前置風險，證明交易、身份、主資料及 Inventory batch contract 可供後續 Phase 安全使用。

**明確結果：** 所有必要 Provider contract、權限及冪等身份隔離均通過測試；一般使用者仍看不到 Purchasing／Receiving 入口。

**PR 範圍：** 只包含最小 Provider／framework 契約及測試，不包含 PO／GR UI 或業務表。

### Task P0-T01：鎖定基線與 Provider readiness

**描述：** 在 Phase worktree fetch 最新 `main`，確認 Supplier、Item、Currency、Payment Term及Inventory實際落地狀態，記錄可用 migration 序號及契約差距；未落地的完整 Provider 能力列為 blocker，不以自由文字 FK、stub table 或 production fake 繞過。

**驗收條件：**

- [ ] 基線 commit、下一個 migration 序號及各 Provider owner／實際檔案路徑已記錄於 PR checklist。
- [ ] Supplier、Item、Inventory、Currency及Payment Term各項 Gate 都有 PASS／BLOCKED 結論及可重現證據。
- [ ] 如任何硬依賴 BLOCKED，Phase 0 不宣告完成且不暴露 Purchasing capability。

**驗證：** `git status --short --branch`、`git log --oneline -5`、migrations清單及 Provider focused tests。

**依賴：** 無。

**預計檔案：** PR 描述／測試證據；不預設修改 production code。

**規格追溯：** Design §1.3、§2.4、§4.17、§15.1；Requirement §12、§16.1。

**規模：** XS。

### Task P0-T02：修正 authenticated idempotency identity scope

**描述：** 令 `jwt`、`jwt-password`、`jwt-device`及`jwt-device-password`全部使用 authenticated user scope，避免高強度路由按 IP 共用 idempotency key。

**驗收條件：**

- [ ] 四種 JWT auth type 都產生同一規則的 user identity scope；匿名請求仍沿用既有安全行為。
- [ ] 同 IP 的不同使用者不能 replay 或衝突彼此的 key；同一使用者同 route／payload仍可 replay。
- [ ] 現有 idempotency 行為沒有 regression。

**驗證：** `node --test --import ./server/test-support/testEnv.js server/test/idempotencyService.test.js server/test/idempotencyStore.test.js`。

**依賴：** P0-T01。

**預計檔案：** `server/src/services/idempotency/IdempotencyService.js`、`server/test/idempotencyService.test.js`，必要時一個 high-auth handler regression test。

**規格追溯：** Design §2.7、§10.4；BR-041～043、AC-038～040。

**規模：** S。

### Task P0-T03：加入 Purchasing／Receiving permissions

**描述：** 在權限正本加入六項模組權限並以 additive migration 同步資料庫；`inventory.adjust`仍由 Inventory 模組擁有，不重複定義。

**驗收條件：**

- [ ] `purchasing.view`、`purchasing.mgmt`、`purchasing.approval`、`receiving.operation`、`receiving.expiry.override`及`purchasing.settings`符合 catalogue conventions。
- [ ] Migration可在乾淨及已存在資料庫安全執行，預設不自動賦予 System Administrator。
- [ ] Catalogue startup guard及migration integration通過。

**驗證：** permission catalogue focused tests，加專用 MySQL migration integration。

**依賴：** P0-T01。

**預計檔案：** `server/src/modules/authorization/permissionCatalogue.js`、一支動態編號permission migration、`server/test/permissionCatalogueConventions.test.js`、一個migration integration test。

**規格追溯：** Design §6.1、§9.1、§13 Phase 0；SEC-001～005、AC-048～050。

**規模：** M。

### Task P0-T04：落地 Supplier purchasing provider contracts

**描述：** 在 Supplier 模組實作／補齊 purchase defaults、history lookup、SKU supplier list及冪等soft `recordSupply`契約，只回採購需要的 allowlisted 欄位，永不回銀行資料。

**驗收條件：**

- [ ] `assertUsable`、`findById(...history)`、`listForSku`、`getPurchaseDefaults`及`recordSupply`契約符合設計。
- [ ] Purchase purpose只接受Active；history可回非Active及狀態；projection不含bank fields。
- [ ] `recordSupply`重試不重複建立效果且不自動設preferred。

**驗證：** Supplier provider unit／integration tests及consumer contract test。

**依賴：** P0-T01；Supplier 基礎模組已落地。

**預計檔案：** Supplier lookup／relation service、各自test及必要migration，實作時按主分支實際路徑確定，總數不得超過5。

**規格追溯：** Design §2.4、§11.4；FR-PO-003、FR-REPORT-008～009、BR-004～006。

**規模：** M。

### Task P0-T05：加入 Item committed receipt lookup

**描述：** 增加只供既有Confirmed PO收貨使用的 `findManyForCommittedReceipt()`，讓生命周期／flags後續改變產生warning而非錯誤，同時對不存在SKU fail closed。

**驗收條件：**

- [ ] Inactive／Discontinued／Archived及purchasable／inventoryTracked變更會回目前值與allowlisted warning codes。
- [ ] 新PO既有purchase lookup語意完全不變；不存在SKU及Serial tracking仍按規格拒絕。
- [ ] Consumer必須提供PO確認快照及例外原因，不能把本contract用作新PO資格繞過。

**驗證：** `node --test --import ./server/test-support/testEnv.js server/test/itemLookupService.test.js`及Item lookup integration。

**依賴：** P0-T01；Item 基礎模組已落地。

**預計檔案：** `server/src/modules/item/itemConstants.js`、`server/src/modules/item/ItemLookupService.js`、`server/test/itemLookupService.test.js`、一個Item lookup integration test。

**規格追溯：** Design §2.4、§3.6、§11.4；FR-VAL-013～015、BR-037～039。

**規模：** M。

### Task P0-T06：建立 Inventory purchase receipt batch contract

**描述：** 實作 `postPurchaseReceiptBatchInTransaction()`及來源查詢，原子claim全部detail，再按Inventory全域次序鎖Warehouse／Bin／Lot／Balance及寫Movement；禁止逐detail調用單筆posting。

**驗收條件：**

- [ ] 多details只進行一次batch call，所有source operation先claim後lock，結果集合與source detail一對一。
- [ ] 任一位置、Lot、Status、Expiry或數量失敗會rollback全部Movement、Balance及Inventory Audit。
- [ ] Existing commitment只接受Purchasing提供的已確認快照，不放寬一般Inventory caller或HTTP route。

**驗證：** Inventory provider unit tests、真MySQL batch posting／failure injection／lock-order integration tests。

**依賴：** P0-T01；Inventory基礎tables及transaction service已落地。

**預計檔案：** Inventory posting service、lookup service、provider unit test及integration test，按Inventory實際結構拆成不超過5檔。

**規格追溯：** Design §2.4～2.6、§8.7、§11.3～11.4；FR-POST、BR-040～045、BR-050。

**規模：** M。

### Task P0-T07：建立 Inventory partial receipt reversal contract

**描述：** 實作 `reversePurchaseReceiptBatchInTransaction()`及多次部分反向link規則，保持generic reversal完整反向語意不變。

**驗收條件：**

- [ ] 同一原Movement可多次部分反向，鎖原Movement及全部links後驗證累計量不超原量。
- [ ] 跨detail reversal全有或全無，失敗不改原Movement、Balance或任何projection。
- [ ] 現有generic full reversal regression tests保持通過。

**驗證：** Inventory partial reversal unit／integration／concurrency tests。

**依賴：** P0-T06。

**預計檔案：** Inventory reversal service、reversal link migration／model、unit test及integration test，總數不超過5。

**規格追溯：** Design §2.4、§3.7、§8.8、§11.4；FR-REV、BR-046～047、AC-044～047。

**規模：** M。

### Task P0-T08：完成 Provider／Framework contract Gate

**描述：** 建立consumer contract套件，驗證Provider projection、交易傳入、dependency unavailable、identity scope及permission同步，作為後續Phase的明確阻擋門檻。

**驗收條件：**

- [ ] Supplier不洩漏銀行資料、Item committed lookup、Inventory batch receipt／partial reversal及source lookup全部通過。
- [ ] Provider不可用時fail closed；沒有任何production fake、raw table fallback或半成功transaction。
- [ ] capability仍關閉，Phase 0完整regression及MySQL contract suite通過。

**驗證：** 新增provider contract suite；執行server tests、coverage、lint及指定MySQL integration。

**依賴：** P0-T02～P0-T07。

**預計檔案：** 2～4個provider contract／integration test files及必要test fixture。

**規格追溯：** Design §1.6、§11.4、§13 Phase 0；Requirement §12、§16.1。

**規模：** M。

### Checkpoint P0：Provider 與 Framework Ready

- [ ] P0-T01～P0-T08全部完成，Phase 0 PR通過review。
- [ ] Provider contract、真MySQL transaction／failure injection及framework regression均通過。
- [ ] 未新增一般使用者可見menu／route；任何未落地Provider仍明確阻擋Phase 1／3相關能力。

---

## 3. Phase 1：Purchase Order Foundation

### 3.1 Phase 目標與結果

**目標：** 交付可建立、修改、複製、確認、查詢及列印的正式PO；審批設定關閉時由採購人員直接確認，完全不改Inventory。

**明確結果：** 使用者可完成Draft→Confirmed PO端到端流程，金額、UOM、快照、版本、編號及Audit正確。

### Task P1-T01：建立 Money／Quantity純算法

**描述：** 先以測試定義decimal money及quantity／UOM算法，再實作不使用浮點乘除的BigInt scaled arithmetic與共用domain constants。

**驗收條件：**

- [ ] Money支援Unit Price 4位、Currency scale 0～4、逐行HALF_UP後加總及固定scale輸出。
- [ ] Quantity×factor必須精確成正整數並守住safe integer／config上限。
- [ ] 非法scientific notation、負數、不能整除Base及overflow明確拒絕。

**驗證：** `purchasingMoneyMath.test.js`及`purchasingQuantityMath.test.js`。

**依賴：** Checkpoint P0。

**預計檔案：** `purchasingConstants.js`、`moneyMath.js`、`quantityMath.js`、`purchasingMoneyMath.test.js`及`purchasingQuantityMath.test.js`。

**規格追溯：** Design §2.8、§8.1、§10.2、§12.1；FR-PO-010～020、BR-007～013、AC-006～010。

**規模：** M。

### Task P1-T02：建立 Purchasing config及輸入驗證

**描述：** 實作purchasing config normalization及共用輸入驗證，集中限制IDs、日期、event UUID、decimal scale、line／detail caps、reason／notes及禁止的client projection。

**驗收條件：**

- [ ] Startup config對正整數、上下限、sequence、export及transaction timeout錯誤fail fast。
- [ ] Schema／service validation拒絕額外欄位、client totals／snapshots、超長文字、非法日期及不安全整數。
- [ ] 驗證錯誤使用穩定公開code且不回raw payload或內部細節。

**驗證：** `purchasingValidation.test.js`及purchasing config test。

**依賴：** P1-T01。

**預計檔案：** `server/config/purchasing.js`、`purchasingValidation.js`及最多2個focused test files。

**規格追溯：** Design §1.6、§5.1、§10.2、§12.1；SEC-013～016、NFR-001～005。

**規模：** S。

### Task P1-T03：建立 Settings、Sequence及PO核心資料表

**描述：** 按MySQL 5.7設計建立settings、document sequence、PO header及PO lines的additive migrations，包含FK、unique、indexes及decimal精度。

**驗收條件：**

- [ ] Approval required預設OFF且只在row不存在時seed；PO／GR sequence可按月及document type隔離。
- [ ] PO header／line constraints、FK、snapshot、version及indexes符合Design §4.4～4.6。
- [ ] 乾淨migrate、forward migrate及重跑skip均成功，DDL失敗能定位到單支migration。

**驗證：** 專用MySQL `purchasingMigrations.integration.test.js` focused cases。

**依賴：** P1-T02；Checkpoint P0的Provider tables已存在。

**預計檔案：** 4支動態編號migration及1個integration test。

**規格追溯：** Design §4.3～4.6、§4.17、§11.1；FR-SET、FR-PO、AC-001、AC-006～010。

**規模：** M。

### Task P1-T04：建立 operation、audit及不可變基礎

**描述：** 建立domain operation request、purchasing audit及初始immutability trigger migrations，提供跨HTTP TTL的冪等結果正本及不可修改歷史。

**驗收條件：**

- [ ] 同document／event唯一，保存canonical hash、狀態及安全result projection至少7年。
- [ ] Audit append-only且敏感欄位不在schema／builder；trigger拒絕受保護row update／delete。
- [ ] Trigger不是授權替代，service正常交易寫入仍可完成。

**驗證：** 真MySQL event unique、audit／trigger update-delete及actor SET NULL tests。

**依賴：** P1-T03。

**預計檔案：** operation migration、audit migration、trigger migration及一個integration test。

**規格追溯：** Design §4.14～4.16、§8.2、§12.2；FR-AUDIT、BR-041～043、BR-052。

**規模：** M。

### Task P1-T05：實作 Sequence、Operation及Audit services

**描述：** 實作PO／GR月度編號、domain event claim／complete及allowlisted audit builder，確立所有後續命令的transaction骨架。

**驗收條件：**

- [ ] PO／GR編號獨立、月度重置、6位padding、耗盡及rollback行為正確。
- [ ] 同event同hash回原結果、不同hash 409；Audit失敗令業務交易rollback。
- [ ] Service使用constructor injection及既有`withTransaction()`，不建立generic repository。

**驗證：** sequence、operation及audit focused unit tests。

**依賴：** P1-T04。

**預計檔案：** `PurchasingSequenceService.js`、`PurchasingOperationService.js`、`PurchasingAuditService.js`及最多2個test files。

**規格追溯：** Design §2.5～2.7、§8.1、§12.2；BR-001～002、BR-041～043。

**規模：** M。

### Task P1-T06：實作 PO Draft create／update domain service

**描述：** 實作完整editable projection的Draft建立及版本化更新domain service，批量驗證Supplier／SKU／UOM、server端快照及Total，任一Line失敗整張不寫。

**驗收條件：**

- [ ] Create取得唯一PO Number；Update完整replace lines並拒絕foreign child ID、過時version及client totals／snapshots。
- [ ] Active Supplier及當下可採購、非Serial SKU才可使用；Supplier-SKU relation只影響排序不作白名單。
- [ ] Inventory完全不變，operation及Audit與PO交易全有或全無。

**驗證：** `purchaseOrderService.test.js` create／update／rollback cases。

**依賴：** P1-T01～P1-T05。

**預計檔案：** `PurchaseOrderService.js`、`purchasingProjections.js`、`purchaseOrderService.test.js`及必要fake purchasing database fixture。

**規格追溯：** Design §3.1、§5.2、§8.2；FR-PO-001～020、AC-003～010。

**規模：** M。

### Task P1-T07：交付 PO Draft create／update handlers

**描述：** 建立嚴格Create／Update schemas及handlers，把HTTP auth、permission、idempotency、status code與domain service連接，不在handler複製業務規則。

**驗收條件：**

- [ ] Create為201；Update只接受version及完整editable projection，兩者都要求eventId與Idempotency-Key一致。
- [ ] `additionalProperties:false`拒絕client totals、snapshots、factor、base quantity及任意status。
- [ ] Handler metadata固定為正確method、path、auth及`purchasing.mgmt`。

**驗證：** create／update handler contract、schema及idempotency tests。

**依賴：** P1-T06。

**預計檔案：** `purchasingSchemas.js`、`createPurchaseOrderHandler.js`、`updatePurchaseOrderHandler.js`及最多2個test files。

**規格追溯：** Design §5.1～5.2、§9.3、§10.4；FR-PO-001～020、AC-006～010。

**規模：** M。

### Task P1-T08：交付 PO list／detail／copy API slice

**描述：** 提供server pagination、allowlisted filters／sort、owner-safe detail projection及重新驗證主資料的copy-to-new-Draft。

**驗收條件：**

- [ ] List／detail回安全projection、穩定排序、allowedActions及交易快照，不含Supplier銀行／內部欄位。
- [ ] Copy取得新編號並重驗目前master，不複製狀態、approval、receipt或舊資格。
- [ ] 水平ID替換以一致404處理；query count無N+1。

**驗證：** inquiry／copy service tests及三個handler contract tests。

**依賴：** P1-T07。

**預計檔案：** `PurchasingInquiryService.js`、list／detail／copy handlers及一個focused test。

**規格追溯：** Design §5.2、§5.6、§8.2、§8.9；FR-LIST、FR-PO-021～024、AC-048、AC-051。

**規模：** M。

### Task P1-T09：交付 Approval OFF 的 PO submit／confirm

**描述：** 實作設定預設OFF時的Draft提交，在同一交易重驗actor、settings、PO版本、Supplier／SKU／UOM，保存確認快照並轉Confirmed。

**驗收條件：**

- [ ] 合法完整Draft回`outcome:"CONFIRMED"`；client不能送approver或任意status。
- [ ] Provider在提交時失效、version衝突、serial或零價無原因會完整拒絕。
- [ ] Confirmed commerce fields受不可變保護，Inventory仍零效果。

**驗證：** state machine、PurchaseOrderService submit及API＋DB integration focused tests。

**依賴：** P1-T06～P1-T07；approval setting仍OFF。

**預計檔案：** `purchaseOrderStateMachine.js`、`submitPurchaseOrderHandler.js`、`PurchaseOrderService.js`及最多2個tests。

**規格追溯：** Design §3.2～3.3、§5.2；FR-SET-004、FR-APPROVAL-001～003、AC-011。

**規模：** M。

### Task P1-T10：交付 PO 前端服務及建立／編輯表單

**描述：** 建立typed client service、command event生命週期及responsive PO form／line editor，帶入Supplier defaults但不覆寫使用者已修改值。

**驗收條件：**

- [ ] Create／update／submit正確傳`eventId`及Idempotency-Key，相同intent重試沿用ID。
- [ ] 桌面line grid及375／768px line cards均可用鍵盤操作，decimal preview與server結果一致。
- [ ] Dirty leave、version conflict及field errors保留使用者輸入並提供可恢復路徑。

**驗證：** Vitest client service、form及line editor focused tests。

**依賴：** P1-T07、P1-T09的API契約固定。

**預計檔案：** `client/src/services/purchasing.js`、`useCommandEvent.js`、`PurchaseOrderForm.vue`、`PurchaseOrderLineEditor.vue`及一個focused test；pages另列下一Task。

**規格追溯：** Design §2.3、§7.3、§10.4、§11.5；Requirement §10.2、AC-005～010。

**規模：** M。

### Task P1-T11：交付 PO列表及詳情頁

**描述：** 建立PO list及detail頁，呈現server pagination、filters、status、progress、risk、history及server允許的actions。

**驗收條件：**

- [ ] 只有`purchasing.view`可進列表／詳情，只有`purchasing.mgmt`顯示create及合法write actions。
- [ ] Loading／empty／retry、status文字、focus及1024／1440px layout符合`docs/frontend-design.md`。
- [ ] Detail只使用安全projection並分清交易快照與目前主資料。

**驗證：** PO list／detail page tests及client build。

**依賴：** P1-T08、P1-T10。

**預計檔案：** `PurchaseOrdersPage.vue`、`PurchaseOrderDetailPage.vue`、`PurchaseOrderProgress.vue`及最多2個page／component tests。

**規格追溯：** Design §7.1～7.4、§7.9；FR-LIST、FR-PO-021～024、AC-048、AC-051。

**規模：** M。

### Task P1-T12：交付 PO建立／編輯頁及A4列印

**描述：** 把PO form裝配到create／edit頁並建立browser A4 print頁，使用確認快照列印且不產生server-side PDF artifact。

**驗收條件：**

- [ ] Create／edit頁正確處理defaults、dirty leave、version conflict及submit outcome。
- [ ] Confirmed列印使用交易快照；Draft有watermark；不建立或保存PDF artifact。
- [ ] Print heading、table、page breaks及A4 CSS通過DOM測試及瀏覽器列印預覽。

**驗證：** create／edit page tests、print DOM／CSS test及client build。

**依賴：** P1-T10～P1-T11。

**預計檔案：** `PurchaseOrderCreatePage.vue`、`PurchaseOrderEditPage.vue`、`PurchaseOrderPrintPage.vue`及最多2個page tests。

**規格追溯：** Design §7.1～7.4、§7.8～7.9；FR-LIST、FR-REPORT-006～007、AC-051。

**規模：** M。

### Task P1-T13：註冊PO導航及公開錯誤訊息

**描述：** 在Phase 1功能通過focused tests後加入Purchasing／Receiving menu group、PO頁面metadata及繁中公開錯誤訊息；尚未完成的Receiving／Approval入口不得顯示。

**驗收條件：**

- [ ] `purchasingReceiving`群組只因已有授權PO頁面而顯示，view permission撤除後不出現在menu。
- [ ] Phase 1已實作錯誤code都有清楚繁中訊息，未知錯誤仍使用既有安全fallback。
- [ ] 未完成的Approval、Receiving及Settings actions／pages不會向一般使用者曝光。

**驗證：** app shell／menu discovery、permission conventions及error message focused tests。

**依賴：** P1-T11～P1-T12。

**預計檔案：** `client/config/menu.js`、`client/src/framework/http/errorMessages.js`及最多3個discovery／permission／error tests。

**規格追溯：** Design §5.7、§7.1、§9.1；FR-LIST、SEC-001～005、AC-048～049。

**規模：** M。

### Checkpoint P1：可用 PO Foundation

- [ ] 完成P1-T01～P1-T13；Approval OFF下完成Draft→Confirmed→查詢→列印端到端流程。
- [ ] 真MySQL驗證sequence、decimal、FK、version、operation、Audit及trigger；Inventory在所有PO流程保持不變。
- [ ] Phase 1完整lint、server／client tests、coverage、build及audit通過；新domain coverage達line 95%／branch 90%／function 95%。

---

## 4. Phase 2：Approval 與 PO Lifecycle

### 4.1 Phase 目標與結果

**目標：** 交付可配置單人審批、指定審批工作清單及PO撤回／取消／Close Remaining，保存不可改寫的完整歷史。

**明確結果：** PO控制符合審批設定與職責分離；一旦有Confirmed GR便不能改寫商業資料。

### Task P2-T01：建立 Approval／Status History schema及services

**描述：** 建立approval與status history migrations、pending唯一保護、snapshot hash及settings／approval service基礎。

**驗收條件：**

- [ ] 每張PO最多一個active pending approval；已決定snapshot及history不可修改／刪除。
- [ ] Settings使用version、high-auth、reason及Audit；預設OFF且unknown fields拒絕。
- [ ] Approval ON時指定另一名Active且具權限使用者，保存提交版本快照hash。

**驗證：** MySQL constraint／trigger integration及settings／approval service unit tests。

**依賴：** Checkpoint P1。

**預計檔案：** approval migration、history migration、`PurchasingSettingsService.js`、`PurchaseApprovalService.js`及一個focused test。

**規格追溯：** Design §3.3、§4.4、§4.7～4.8、§8.3；FR-SET、FR-APPROVAL、AC-001～002、AC-012～017。

**規模：** M。

### Task P2-T02：交付Settings及Approval命令 APIs

**描述：** 提供高強度settings讀寫與submit／approve／reject／approval withdraw handlers，每個action使用固定auth type、permission及schema。

**驗收條件：**

- [ ] Settings update使用`jwt-password`＋`purchasing.settings`；Approval決定使用`jwt-password`＋view＋approval。
- [ ] 只指定approver可決定；self approval、撤權、停用、snapshot／version過時及非assignee全部拒絕。
- [ ] Approve直接Confirmed；Reject／withdraw回Draft並使舊approval不可再用。

**驗證：** handler metadata／schema tests及purchasing management integration approval cases。

**依賴：** P2-T01。

**預計檔案：** `purchasingSettingsHandlers.js`、`purchaseOrderApprovalHandlers.js`、`purchasingSchemas.js`及最多2個tests。

**規格追溯：** Design §5.2、§5.4、§6.2；FR-SET、FR-APPROVAL、SEC-006～009、AC-012～017。

**規模：** M。

### Task P2-T03：交付 Approval工作清單及前端流程

**描述：** 建立「待我審批」、approval snapshot、密碼重新認證及設定頁，按assigned actor及permission限制資料與actions。

**驗收條件：**

- [ ] 工作清單只回目前使用者的Pending項目，server pagination及filter正確。
- [ ] Approve／reject顯示固定snapshot，reason／password驗證可存取且錯誤後保留安全輸入。
- [ ] Settings及Approval入口按permission隱藏，直接URL仍由backend拒絕。

**驗證：** Vitest approval list／snapshot／password dialog／settings page tests及manual keyboard flow。

**依賴：** P2-T02。

**預計檔案：** `MyPurchaseOrderApprovalsPage.vue`、`PurchasingSettingsPage.vue`、`ApprovalSnapshotPanel.vue`及最多2個tests。

**規格追溯：** Design §7.1、§7.4、§11.5；FR-SET、FR-APPROVAL、AC-012～017。

**規模：** M。

### Task P2-T04：交付 PO lifecycle domain commands

**描述：** 實作Confirmed撤回、cancel及selected／all Close Remaining，以PO root lock、version及Confirmed receipt fact決定合法狀態。

**驗收條件：**

- [ ] 零Confirmed GR的Confirmed PO可填原因撤回；有收貨後withdraw／cancel／commerce update全部拒絕。
- [ ] Cancel只適用Draft／Pending／零收貨Confirmed；Close Remaining不產生Inventory效果。
- [ ] Status history及Audit與狀態變更同transaction；Closed日後不因reversal自動重開。

**驗證：** lifecycle service／state machine tests及approve-vs-withdraw、close-vs-confirm concurrency tests。

**依賴：** P2-T01、P2-T02。

**預計檔案：** `PurchaseOrderLifecycleService.js`、`purchaseOrderStateMachine.js`、`purchaseOrderLifecycleHandlers.js`及最多2個tests。

**規格追溯：** Design §3.2、§8.4；FR-LIFE、BR-018～024、AC-018～020。

**規模：** M。

### Task P2-T05：補齊 lifecycle UI、progress及Audit history

**描述：** 在PO詳情呈現allowedActions、progress、risk、approval及不可變status history；完成撤回、取消及Close Remaining對話流程。

**驗收條件：**

- [ ] UI只呈現server允許的當前action，但不把UI當授權正本。
- [ ] Reason必填、版本衝突及permission stale有清楚可恢復訊息；已收貨後只讀。
- [ ] History顯示actor、action、時間、reason摘要及outcome，不洩漏敏感payload。

**驗證：** PO detail／progress／risk component tests及manual role matrix。

**依賴：** P2-T04。

**預計檔案：** `PurchaseOrderDetailPage.vue`、`PurchaseOrderProgress.vue`、`PurchaseOrderRiskSummary.vue`、一個page test及`errorMessages.js`。

**規格追溯：** Design §7.4、§12.2；FR-LIFE、FR-AUDIT、AC-018～020、AC-050、AC-053。

**規模：** M。

### Checkpoint P2：Approval 與 Lifecycle Ready

- [ ] Approval OFF／ON、self／non-assignee、approve／reject／withdraw及settings high-auth完整通過。
- [ ] 零收貨與已有收貨的withdraw／cancel／close界線由unit、API＋DB及真並發證明。
- [ ] Phase 2完整Gate通過，一般view-only使用者無任何寫入能力。

---

## 5. Phase 3：Goods Receiving 與 Inventory Posting

### 5.1 Phase 目標與結果

**目標：** 交付以Confirmed PO為唯一來源的GR Draft、精確SKU／Lot／Warehouse／Bin分拆及原子Inventory入庫。

**明確結果：** 每次實收都能定位至具體SKU、Lot及Bin；GR、PO progress、Inventory Movement／Balance及Audit全有或全無一致。

### Task P3-T01：建立 Goods Receipt核心schema

**描述：** 建立GR header、lines及details migrations，包含PO／Supplier／SKU／UOM／Warehouse／Bin owner-safe FK、version、duplicate dimension及查詢indexes。

**驗收條件：**

- [ ] 一張GR只屬一張PO／Supplier；detail SKU必須等於PO line快照且Bin屬於Warehouse。
- [ ] Header／line／detail保存必要交易快照、gross／reversed projection、risk reason及版本。
- [ ] 乾淨／forward migration、FK、unique、decimal精度及index integration通過。

**驗證：** 真MySQL purchasing migration／constraint integration focused cases。

**依賴：** Checkpoint P2、Checkpoint P0 Inventory／Item contracts。

**預計檔案：** 3支動態編號migration、1個integration test及必要fixture。

**規格追溯：** Design §4.9～4.11、§11.1；FR-GR、FR-VAL、AC-021～035。

**規模：** M。

### Task P3-T02：實作 Receiving validation及policy

**描述：** 以純policy集中處理Tracking、UOM、位置、Lot日期、minimum life、stock status、supplier／SKU變更、short／over receipt及原因規則。

**驗收條件：**

- [ ] none／batch／batch_expiry準確驗證，Serial、Expired、lot date conflict、無效Bin及非法Base quantity fail closed。
- [ ] Suspended／Archived要求原因；Blocked只准Quarantined＋原因；SKU committed changes要求warning＋原因。
- [ ] 超收按提交時最新Outstanding重算並要求原因；效期override不能繞過其他安全規則。

**驗證：** `receivingPolicy.test.js`、`purchasingValidation.test.js`及quantity boundary tests。

**依賴：** P3-T01、P1-T01、P0-T05。

**預計檔案：** `ReceivingPolicyService.js`、`purchasingValidation.js`、`receivingSchemas.js`及最多2個tests。

**規格追溯：** Design §3.4～3.6、§8.6；FR-VAL、BR-025～039、AC-025～035。

**規模：** M。

### Task P3-T03：交付 GR Draft create／update／cancel API

**描述：** 從單一Confirmed／Partially Received PO建立GR Draft，完整replace lines／details並支援Draft cancel；保存Draft絕不改Inventory或PO received。

**驗收條件：**

- [ ] 只有仍有未完成收貨承諾的PO可建立GR；Draft／Pending／Closed／Cancelled拒絕。
- [ ] 可只選部分PO lines並跨Lot／Warehouse／Bin／Status分拆；foreign child／owner mismatch拒絕。
- [ ] Draft save／cancel保留編號與Audit，但PO progress、Balance及Movement完全不變。

**驗證：** `goodsReceiptService.test.js`及receiving handler／API＋DB Draft integration。

**依賴：** P3-T01～P3-T02。

**預計檔案：** `GoodsReceiptService.js`、create／update／cancel handlers及一個focused test。

**規格追溯：** Design §5.3、§8.5；FR-GR-001～018、AC-021～024、AC-035。

**規模：** M。

### Task P3-T04：交付 GR client service及分拆表單

**描述：** 建立GR client service、command event處理、receipt form及line／detail editors，支援barcode、tracking欄位、Warehouse換Bin及responsive分拆操作。

**驗收條件：**

- [ ] Barcode 0／1／many matches、Warehouse變更清Bin、tracking欄位及PO outstanding顯示正確。
- [ ] 可用鍵盤新增／刪除／編輯多details；375／768px使用card／accordion而非壓縮寬表格。
- [ ] Client正確映射API projection、AbortSignal、event key重試及field errors。

**驗證：** Vitest service、form及line／detail editor focused tests；manual 375／768驗證。

**依賴：** P3-T03 API契約固定。

**預計檔案：** `client/src/services/purchasing.js`、`GoodsReceiptForm.vue`、`ReceiptLineEditor.vue`、`ReceiptDetailEditor.vue`及一個focused test。

**規格追溯：** Design §7.5～7.7、§11.5；Requirement §10.3～10.5、AC-022～035。

**規模：** M。

### Task P3-T05：交付 GR Draft列表及建立／編輯頁

**描述：** 把GR表單裝配到list／create／edit頁，提供PO選擇、server pagination、Draft保存恢復、duplicate delivery note提示及dirty leave保護。

**驗收條件：**

- [ ] List及PO lookup filters、pagination、loading／empty／retry狀態正確。
- [ ] Create／edit可只選部分PO lines，保存後重入能還原全部details且Inventory不變。
- [ ] 375／768／1024／1440 layout、focus、labels、alerts及keyboard flow符合`docs/frontend-design.md`。

**驗證：** Vitest GR list／create／edit page tests及client build。

**依賴：** P3-T03～P3-T04。

**預計檔案：** `GoodsReceiptsPage.vue`、`GoodsReceiptCreatePage.vue`、`GoodsReceiptEditPage.vue`及最多2個page tests。

**規格追溯：** Design §7.5～7.6、§11.5；Requirement §10.3～10.5、AC-022～035。

**規模：** M。

### Task P3-T06：實作原子 GR confirm transaction

**描述：** 依固定lock order鎖operation→PO root→GR→details，重讀actor及Providers，單次呼叫Inventory batch posting，再更新GR／PO projection及Audit。

**驗收條件：**

- [ ] 多detail只呼叫一次batch contract，provider／Inventory結果集合缺失或多出均rollback。
- [ ] Inventory第N detail、Audit或PO progress failure都令GR保持Draft且零部分Movement／Balance效果。
- [ ] 成功時GR Confirmed、PO gross／net／outstanding／over及雙向source一次更新。

**驗證：** `goodsReceiptPostingService.test.js`及receiving MySQL integration failure injection。

**依賴：** P3-T02～P3-T03、P0-T06。

**預計檔案：** `GoodsReceiptPostingService.js`、`PurchasingOperationService.js`（如需具名command）、confirm service test及integration test。

**規格追溯：** Design §2.5～2.7、§3.5、§8.7；FR-POST、BR-040～045、AC-036～042。

**規模：** M。

### Task P3-T07：交付 confirm API、operation lookup及timeout recovery

**描述：** 建立GR confirm及operation lookup handlers，強制eventId／Idempotency-Key一致，對COMMIT結果未知提供server fact查詢而非新event重送。

**驗收條件：**

- [ ] missing／mismatch key拒絕；同event同payload replay原結果，不同payload回穩定409。
- [ ] `DATABASE_TRANSACTION_INDETERMINATE`後可按event查唯一結果及GR／PO facts。
- [ ] auth使用view＋`receiving.operation`，提交點撤權／停用會拒絕且無庫存效果。

**驗證：** handler tests、idempotency concurrency及COMMIT response loss integration。

**依賴：** P3-T06。

**預計檔案：** `confirmGoodsReceiptHandler.js`、`purchasingOperationLookupHandler.js`、schemas及最多2個tests。

**規格追溯：** Design §2.7、§5.3～5.4、§7.7；FR-POST-008～013、AC-038～042、AC-050。

**規模：** M。

### Task P3-T08：交付 GR detail／risk／confirm前端流程

**描述：** 建立GR詳情、risk summary、confirm dialog及timeout recovery，清楚呈現Blocked supplier、SKU change、overreceipt、expiry override及Inventory來源。

**驗收條件：**

- [ ] Blocked supplier時Status固定Quarantined；各exception原因定位至正確field並可用鍵盤完成。
- [ ] Confirmed GR完全只讀；edit／cancel／delete不可用並提示後續Reversal能力。
- [ ] Timeout先查operation；version／policy conflict保留Draft輸入且不自動換eventId。

**驗證：** Vitest risk／detail／timeout tests及manual receiving flow。

**依賴：** P3-T05、P3-T07。

**預計檔案：** `GoodsReceiptDetailPage.vue`、`ReceivingRiskSummary.vue`、confirm相關composable／service及最多2個tests。

**規格追溯：** Design §7.6～7.7、§11.5；FR-GR、FR-VAL、AC-036～043。

**規模：** M。

### Checkpoint P3：Receiving 與 Inventory一致

- [ ] 完成P3-T01～P3-T08及partial、multi-lot、multi-bin、multi-status、short、over、Blocked、Archived SKU及minimum-life端到端流程。
- [ ] 兩GR同PO、confirm-vs-close／cancel、同event並發、deadlock／timeout及第N detail失敗均有真MySQL證據。
- [ ] 對每個成功detail可由GR追到Inventory Movement／Balance／Audit並反查PO；失敗流程為零部分效果。
- [ ] Phase 3完整Gate通過後才開放Receiving confirm入口。

---

## 6. Phase 4：Reversal、Reporting 與 Release Evidence

### 6.1 Phase 目標與結果

**目標：** 交付正式部分／全部收貨沖銷、Outstanding／GR查詢匯出、供貨soft projection、對賬及Go-Live證據。

**明確結果：** 錯誤收貨可受控更正，所有結果可查、可追溯、可對賬並具備release readiness證據。

### Task P4-T01：建立 Reversal schema及domain service

**描述：** 建立reversal header／details migrations與`ReceiptReversalService`，鎖PO root、GR、原Movement及links後執行部分／全部原子反向。

**驗收條件：**

- [ ] 原GR／Movement不可變；每次成功建立新OUT Movement及link，累計反向不超原量。
- [ ] Inventory不足、Reservation、Counting Bin或結果mapping異常令整次rollback。
- [ ] GR reversed projection及PO net／outstanding／status正確；人工Closed PO不重開。

**驗證：** reversal service unit test、MySQL constraint及partial-multiple reversal integration。

**依賴：** Checkpoint P3、P0-T07。

**預計檔案：** 2支reversal migrations、`ReceiptReversalService.js`及最多2個tests。

**規格追溯：** Design §3.7、§4.12～4.13、§8.8；FR-REV、BR-044～047、AC-044～047。

**規模：** M。

### Task P4-T02：交付高強度 Reversal API及UI

**描述：** 提供`jwt-device-password`＋view＋`inventory.adjust`的reversal命令及dialog，要求原因、version、eventId並顯示可反向餘量。

**驗收條件：**

- [ ] 一般receiving／purchasing使用者不可反向；撤權、停用、owner替換及弱auth全部拒絕。
- [ ] 支援單／多detail部分或全部反向；同event replay一次，不同payload 409。
- [ ] 成功後UI重讀GR／PO／Inventory facts；失敗保留輸入且不顯示假成功。

**驗證：** handler auth／schema tests、`receiptReversal.integration.test.js`及Vitest dialog tests。

**依賴：** P4-T01。

**預計檔案：** `reverseGoodsReceiptHandler.js`、`ReceiptReversalDialog.vue`、client service及最多2個tests。

**規格追溯：** Design §5.3、§6.2、§7.6；FR-REV、SEC-010～012、AC-043～047、AC-049～050。

**規模：** M。

### Task P4-T03：交付 PO Outstanding inquiry APIs

**描述：** 完成PO Outstanding查詢，使用root-first pagination、allowlisted sort／filters及安全projection。

**驗收條件：**

- [ ] Supplier、SKU、buyer、delivery及overdue filters語意符合規格，Closed／Cancelled不被誤列為outstanding。
- [ ] List穩定pagination且無N+1，quantity／UOM／Currency projection與PO詳情一致。
- [ ] View-only可查詢但無寫入；銀行資料、token、SQL、stack及內部路徑永不輸出。

**驗證：** `purchasingInquiryService.test.js`的outstanding cases、handler tests及API＋DB query tests。

**依賴：** P4-T01。

**預計檔案：** `PurchasingInquiryService.js`、`listOutstandingPurchaseOrdersHandler.js`及最多2個focused tests。

**規格追溯：** Design §5.2、§5.6、§8.9；FR-LIST、FR-REPORT-003、AC-048、AC-054。

**規模：** M。

### Task P4-T04：交付 GR及Audit inquiry APIs

**描述：** 完成GR list／detail及Purchasing Audit查詢，提供status、date、warehouse、risk及雙向Inventory來源，同時維持owner-safe projection。

**驗收條件：**

- [ ] GR filters、pagination及stable sort正確；detail包含PO、details、Inventory operations、reversals及allowedActions。
- [ ] Audit可按PO／GR Number、Supplier、actor、action、outcome及日期查詢，沒有N+1或敏感payload。
- [ ] Child owner不符與不存在回相同404；view-only只有查詢能力。

**驗證：** inquiry service GR／Audit cases、handlers及API＋DB query tests。

**依賴：** P4-T01。

**預計檔案：** `listGoodsReceiptsHandler.js`、`getGoodsReceiptHandler.js`、`purchasingAuditHandler.js`及最多2個focused tests。

**規格追溯：** Design §5.3～5.6、§8.9；FR-LIST、FR-REPORT-001～002、FR-AUDIT-003／008、AC-048、AC-053。

**規模：** M。

### Task P4-T05：交付 CSV匯出及報表前端

**描述：** 建立PO／Outstanding／GR穩定CSV v1、公式注入防護、50k cap及對應列表頁filters／export操作。

**驗收條件：**

- [ ] CSV與畫面filters、Currency／UOM／time語意一致，欄位順序穩定且公式字首已neutralize。
- [ ] Response有no-store／nosniff／安全filename，無銀行或未授權欄位，超cap明確拒絕。
- [ ] Outstanding及GR pages具server pagination、loading／empty／retry及responsive操作。

**驗證：** CSV validation／handler tests、client page tests及代表性匯出人工檢查。

**依賴：** P4-T03～P4-T04。

**預計檔案：** `purchasingCsv.js`、export handlers、`OutstandingPurchaseOrdersPage.vue`、`GoodsReceiptsPage.vue`及一個focused test；必要時拆成backend／frontend兩個commits。

**規格追溯：** Design §5.1、§7.2、§7.5、§8.9；FR-REPORT-004～007、BR-048～049、AC-052。

**規模：** M。

### Task P4-T06：交付 Supplier soft projection及reconciliation

**描述：** Confirmed GR commit後冪等更新Supplier最近供貨日期／soft SKU relation；失敗只告警並由只讀／受控reconciliation補回，不回滾Inventory正本。

**驗收條件：**

- [ ] Post-commit projection重試不重複、不設preferred，失敗不令已commit GR顯示失敗。
- [ ] Reconciliation只補soft projection並輸出安全summary，不重算或直接修改PO／Inventory正本。
- [ ] Structured log／metric不含Supplier／SKU名稱、reason全文、銀行資料或高基數labels。

**驗證：** Supplier relation consumer contract、projection failure及reconciliation unit／integration tests。

**依賴：** P3-T06、P0-T04。

**預計檔案：** `PurchasingReconciliationService.js`、GR post-commit hook／service、必要scheduler config及最多2個tests；只有真正落地job才修改scheduler。

**規格追溯：** Design §2.4、§8.9、§12.3～12.5；FR-REPORT-008～009、AC-053。

**規模：** M。

### Task P4-T07：完成授權及資料安全硬化

**描述：** 補齊全部route 401／403、高強度auth、horizontal ID、fresh actor、payload／SQL／XSS／CSV攻擊及敏感資料洩漏測試。

**驗收條件：**

- [ ] 全route permission matrix及提交點fresh actor通過，敏感資料不出現在response／log／audit／CSV。
- [ ] Settings／approval／reversal只有指定高強度auth可用；view-only沒有任何寫入路徑。
- [ ] 任意sort／unexpected property／超長payload／SQL／XSS／CSV formula輸入安全拒絕且不洩漏存在性。

**驗證：** Design §11.6 security suite、handler convention tests及`npm run security:audit`。

**依賴：** P4-T01～P4-T06。

**預計檔案：** 最多4個security／handler integration test files；如發現production缺陷，按根因另開小型修復Task。

**規格追溯：** SEC-001～016、NFR-012～015、AC-048～053。

**規模：** M。

### Task P4-T08：完成真並發及失敗注入硬化

**描述：** 驗證sequence、approval、close、confirm、cancel及reversal的真並發與deadlock／timeout／COMMIT response loss行為。

**驗收條件：**

- [ ] 20 workers同月建立PO／GR編號唯一；同event同payload只有一個效果，不同payload只有一個成功。
- [ ] Approve-vs-withdraw、兩GR同PO、confirm-vs-cancel／close及兩reversal同detail均無lost update或部分資料。
- [ ] 第N detail／Audit／progress失敗完整rollback；deadlock／timeout回安全錯誤並可按event查明結果。

**驗證：** Design §11.3的專用MySQL concurrency／failure injection suite。

**依賴：** P4-T01～P4-T06。

**預計檔案：** 最多4個concurrency／failure injection test files及必要test fixture。

**規格追溯：** Design §2.5～2.7、§11.3；NFR-006～011、AC-038～047。

**規模：** M。

### Task P4-T09：完成容量及查詢效能驗證

**描述：** 建立規格容量資料集，量度精確查找、常用列表、100-line PO、200-detail GR及50k CSV，使用query count與`EXPLAIN`定位問題。

**驗收條件：**

- [ ] 精確及常用列表p95 <2s、100-line PO <3s、200-detail GR <5s。
- [ ] 50k CSV在120秒cap內完成且不超合理memory budget；主要query使用Design §4 indexes且無N+1。
- [ ] 不以移除提交重驗、Audit、lock或資料正確性換取效能；任何調優另作可驗證atomic commit。

**驗證：** Design §11.7 performance suite、query count assertions及保存的`EXPLAIN`證據。

**依賴：** P4-T03～P4-T05、P4-T08。

**預計檔案：** performance fixture、PO／GR／CSV performance tests及安全結果摘要，最多5檔。

**規格追溯：** Design §4 indexes、§11.7；NFR-001～005、AC-054。

**規模：** M。

### Task P4-T10：完成備份還原、對賬及UAT release evidence

**描述：** 在隔離環境完成backup／restore、代表性完整流程、100%來源對賬、角色／設定／主資料readiness及UAT簽核包；不在此Task建立未經批准的修復工具。

**驗收條件：**

- [ ] Restore後PO、Approval、GR、progress、Movement、Reversal及Audit集合100%對賬。
- [ ] 代表性PO涵蓋none／batch／batch_expiry、partial、over、Blocked、Archived SKU、expiry override及reversal。
- [ ] Release evidence包含版本、migrations、permissions、Approval OFF初值、性能、安全、backup／restore、reconciliation及UAT結果；OPEN-006未解決則阻擋Go-Live。

**驗證：** 隔離restore rehearsal、reconciliation command及已批准`test_case.md`／UAT執行記錄。

**依賴：** P4-T07～P4-T09；正式Currency、角色、Warehouse／Bin、Supplier／SKU資料及cutover inputs ready。

**預計檔案：** 測試／release evidence文件及必要只讀reconciliation test；任何一次性data migration另行評審。

**規格追溯：** Design §11.8、§13、§15.2；Requirement §16、NFR-016、AC-055。

**規模：** M。

### Checkpoint P4：Release Candidate Ready

- [ ] Reversal、報表、CSV、Supplier projection、Audit及reconciliation均完成並可雙向追溯。
- [ ] 完整lint、server／client tests、coverage、build、security audit、MySQL integration、concurrency及performance Gate通過。
- [ ] Backup／restore、migration／rollback、角色權限、Approval初值及UAT evidence由指定owner簽核。
- [ ] 所有Go-Live blocker關閉；否則系統維持feature-disabled或read-only，不提供無Inventory的假成功路徑。

---

## 7. Phase 級需求追溯

| Phase | 主要需求 | 主要驗收準則 | 交付證據 |
| --- | --- | --- | --- |
| Phase 0 | Integration、SEC identity／permissions、Provider contracts | AC-038～040、AC-048～050的framework前置 | Contract tests、MySQL provider tests、capability disabled證據 |
| Phase 1 | FR-SET基礎、FR-LIST、FR-PO、Approval OFF、print | AC-001～011、AC-048、AC-051 | PO Draft→Confirmed E2E、金額／UOM／migration／print tests |
| Phase 2 | FR-APPROVAL、FR-LIFE、FR-AUDIT | AC-012～020、AC-049～050、AC-053 | Approval ON E2E、lifecycle concurrency、history／Audit tests |
| Phase 3 | FR-GR、FR-VAL、FR-POST | AC-021～043、AC-049～050、AC-053 | Receiving E2E、Inventory atomicity、lock／failure injection tests |
| Phase 4 | FR-REV、FR-REPORT、完整FR-AUDIT及NFR | AC-044～055 | Reversal、CSV、安全、效能、restore、對賬及UAT evidence |

---

## 8. 主要風險與處理

| 風險 | 影響 | 處理方式 |
| --- | --- | --- |
| Supplier或Inventory尚未落地 | Phase 0／3不能安全完成 | 以P0 readiness及contract Gate阻擋；不建臨時table／fallback |
| Migration序號與其他模組衝突 | Deploy順序錯誤 | 每個Phase開始前fetch最新main並動態編號；真MySQL forward migrate |
| 逐detail Inventory posting破壞lock order | Deadlock或部分入庫 | 只使用batch in-transaction contract；failure injection及真並發驗證 |
| HTTP idempotency TTL後重送 | 重複PO／Movement | HTTP與domain operation雙層claim；event result lookup至少保留7年 |
| 金額使用JS Number | rounding／大數錯誤 | BigInt scaled decimal、逐行HALF_UP、server為唯一Total正本 |
| Provider狀態在PO後改變 | 在途貨被錯拒或不安全放行 | 使用history／committed contracts、快照、warning＋reason；Expired／位置等仍fail closed |
| Partial reversal與generic reversal衝突 | 超量反向或既有功能regression | 專用Purchasing batch reversal及link累計鎖；保留generic full reversal tests |
| Phase入口提前顯示 | 使用者遇到半成功流程 | capability gate；只在Phase Checkpoint通過後開menu／action |
| OPEN-006 cutover資料未定 | 無法安全Go-Live | 不阻擋核心開發，但P4-T10及Go-Live必須BLOCKED |

---

## 9. 實作前人工確認點

Phase 0開始前，Engineering／Product／DBA／QA／Frontend應確認Design §15.1列出的Capability Map、API／permission、Provider contracts、MySQL 5.7 table／trigger、55項AC測試覆蓋及`docs/frontend-design.md`驗收。上述確認不代表可略過每個Phase的PR review及測試Gate。

本計劃不包含PR提交、實作或測試執行；開始任一Phase時，應把該Phase tasks複製到實際執行追蹤工具，保持Task ID及依賴不變，完成一項便附上commit與測試證據。

# Inventory Management 開發任務分解（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件版本 | 0.3 Approved Planning Baseline |
| 文件日期 | 2026-09-08 |
| Requirement | `docs/inventory_management/01_requirement_spec.md` 0.3 Approved Planning Baseline |
| Design | `docs/inventory_management/03_design_spec.md` 0.3 Approved Planning Baseline |
| 任務狀態 | 設計及P0～P5計畫已由Sam獨立人工評審並批准；所有Task仍為PENDING，且尚未授權進入IMPLEMENT |
| Task list target | 本文件；依使用者指定，不另建 `tasks/plan.md` 或 `tasks/todo.md` |
| 交付模型 | 6 個獨立 Phase；每個 Phase 使用一個 worktree、分支、PR 及一次完整 Phase 測試 |
| 技術基線 | Node.js 26、Express 5、MySQL 8.0、Vue 3、Quasar 2 |

本文件同時承載 implementation plan 與可執行 task checklist。每個 Task 是一個單一成果的 focused work unit；Task 內須同步建立相應測試，但正式測試證據在該 Phase 全部 Tasks 完成後，以一次完整 Phase verification cycle 產出。不得把未通過 Phase Gate 的 PR 合併至 `main`。

---

## 1. 執行策略

### 1.1 已確認的交付原則

- 一個 Phase 對應一個明確可示範的結果、一個 `codex/` feature branch、一個獨立 worktree、一個 PR，以及一次完整 Phase 測試與驗收。
- Phase 內含多個小型 Tasks；可在不共用熱點檔案時平行開發，但整個 Phase 只形成一個整合 PR。
- 每個 Task 須連同其 unit／integration／frontend tests 一起完成；「一次 Phase 測試」是指 Phase 收斂後統一執行完整驗證，不表示可以延後編寫測試。
- 每個 Phase 由最新 `origin/main` 建立 worktree。PR 合併前必須重新 fetch；若 target 已移動，先在 Phase 分支整合並解決衝突，再重跑該 Phase 完整測試。
- 每個 Phase 合併後才開始依賴它的下一 Phase；合併完成後移除該 Phase 的 worktree及已合併分支。
- 所有 UI／UX 必須遵守 `docs/frontend-design.md`；所有數量、狀態、版本、權限、冪等及 SKU 資格以後端提交時重驗為準。

### 1.2 Phase 與 PR 邊界

| Phase | 建議分支 | PR 的明確結果 | 依賴 |
| --- | --- | --- | --- |
| P0 Integration Foundation | `codex/inventory-p0-foundation` | Inventory 的權限、設定、Item contract、domain operation、Audit 及固定鎖協議可供後續功能安全使用；尚不提供庫存業務 UI。 | Item T18～T22；最新 main |
| P1 Core Stock | `codex/inventory-p1-core-stock` | 使用者可管理 Warehouse／Bin；已授權來源可 Receipt；使用者可查即時 Stock／Lot／Movement。 | P0 |
| P2 Reservation & Allocation | `codex/inventory-p2-reservation-allocation` | Sales／Fulfillment 可全量預留、FEFO 分配、釋放、重分配及以 Allocation 原子 Issue 出庫。 | P1 |
| P3 Warehouse Operations | `codex/inventory-p3-warehouse-operations` | 可完成 Bin Move、跨倉 Transfer、Adjustment、Status Transfer 及受控 Reversal。 | P2 |
| P4 Stocktake | `codex/inventory-p4-stocktake` | 可按 Bin 持久鎖定、點算、審閱及原子過帳完整盤點。 | P3 |
| P5 Opening & Release | `codex/inventory-p5-opening-release` | 可安全導入 Opening、不可逆 Go-Live、匯出／對賬、完成容量、安全、復原及正式交付驗證。 | P4；§1.4 Go-Live inputs |

### 1.3 依賴圖

```text
Item Management T18–T22 + latest main
                  │
                  ▼
P0 Foundation: migration allocation → idempotency fix → permission/config
                  │                  → Item lookup contract
                  └─────────────────→ operation/audit/lock protocol
                                      │
                                      ▼
P1 Core Stock: master → stock/lot/ledger → receipt → inquiry/UI
                                      │
                                      ▼
P2 Reservation: ATP/reservation → FEFO/allocation → issue integration/UI
                                      │
                                      ▼
P3 Operations: move/status/adjust/reversal → transfer → UI
                                      │
                                      ▼
P4 Stocktake: persistent bin lock → count → atomic post → UI
                                      │
                                      ▼
P5 Opening/Release: CSV precheck → fenced worker → Go-Live
                    → export/contracts/reconciliation/performance/release
```

### 1.4 開發前與 Go-Live gate

Phase P0 開始前：

- [ ] Item Management T18～T22 已合併；`ItemLookupService` 已提供 `purchase`、`sale`、`inventory` purpose，且 Item／SKU lifecycle 語意已有 contract tests。
- [ ] 已 fetch 最新 main 並重新盤點所有 migration 檔；不得沿用文件中的假設號碼，也不得修改任何已套用 migration。
- [x] `03_design_spec.md` §14.2 第 1 項 Serial衝突處置已批准：本期不實作Serial Tracking，Inventory對`serial` fail closed；P5另須以實際掃描證明上線資料沒有Active inventory-tracked Serial SKU。
- [ ] Phase 測試使用明確標記、與CI及production相同major版本的專用 MySQL 8.0 DB；不得對開發者日常資料或正式資料執行 destructive integration tests。

只阻擋相關整合／P5 Go-Live、不阻擋 P0～P4 核心開發的輸入：

- [x] Receiving低於Minimum Receipt Life的專門permission固定為`receiving.expiry.override`，使用逐筆reason及完整threshold／actor／source／request／movement evidence；Expired不可Override。
- [x] Customer Return預設`QUARANTINED`，品質檢查後才可轉為`AVAILABLE`或`DAMAGED`。
- [x] Adjustment Reason Category固定為`COUNT_GAIN, COUNT_LOSS, DAMAGE, EXPIRY, DATA_CORRECTION, TRANSFER_VARIANCE, OTHER`；`OTHER`須詳細說明。
- [ ] P5準備首批Warehouse／Bin、Opening CSV及實際Data Freeze時間；Warehouse／Operations Lead已指定為對賬owner，Sam已指定為Go-Live簽核人。
- [ ] Production app DB account與migration account按已批准政策分離，且P5完成backup／restore rehearsal並保存證據。

### 1.5 Phase 工作流程

每個 Phase 一律使用以下生命週期：

1. 從最新 `origin/main` 建立指定的獨立 worktree／branch，確認工作樹乾淨。
2. 依 Task 順序實作；每項行為以測試先描述，完成後更新本文件 checkbox。
3. 每 2～3 個 Tasks 做 code review checkpoint，但不另開 PR、不產生正式 Phase 測試報告。
4. 全部 Tasks 收斂後，只執行一次 §5 對應的完整 Phase test cycle，保存命令、commit SHA、DB 環境與結果。
5. 檢查 diff 只包含該 Phase、同步必要文件，建立一個 PR；禁止以 skip／降低 coverage／修改測試來取得綠燈。
6. PR 合併前 fetch target；target 有移動時先在 feature worktree 整合並重跑完整 Phase test cycle。
7. 人工 review 批准且 Phase Gate 全通過才合併；之後清理已合併 worktree 與 branch。

### 1.6 每個 Task 的 Definition of Done

- [ ] Acceptance criteria 全部滿足；新增行為具有 success、reject、edge、rollback／conflict 適用測試。
- [ ] Task 只修改必要範圍，沒有無關 refactor、重複業務邏輯、dead code、debug output 或未實作 stub。
- [ ] 新 API 具有 strict request／response schema、後端 permission、stable public error 及繁中 client mapping。
- [ ] DB unique／FK／generated slot／trigger／locking 等行為由真 MySQL integration test 驗證，不以 mock SQL 字串代替。
- [ ] 所有 business write 與必要 Audit 在同一 transaction；失敗不留下半套 current state、Movement 或 operation result。
- [ ] Password、token、完整 CSV、SQL、stack、server path 及未過濾 payload 不出現在 response、log、Audit 或 test evidence。
- [ ] 文件、API contract、config、migration、rollback 及 backward compatibility 已同步；完成後可納入該 Phase 的一次完整驗證。

### 1.7 平行化與 shared hotspots

- 可平行：純規則與 schema test fixtures；後端 contract 凍結後的 client service／UI；不同獨立頁面及其 component tests。
- 必須順序：migration allocation先於任何 DDL；schema先於 service；domain contract先於 handler/client；posting protocol先於任何數量流程；precheck先於 Opening confirm worker。
- 需要協調：`permissionCatalogue.js`、`applicationConfiguration.js`、`IdempotencyService.js`、`client/config/menu.js`、`client/src/framework/http/errorMessages.js`、migration integration suite，以及 Inventory shared constants／schemas。
- 同一 shared hotspot 同一時間只由一個 Task 修改；其他 Task 等候或先 rebase，不用複製檔案形成第二套常數／錯誤／validation。
- P3 與 P4 不平行：Stocktake 要求所有既有 Bin mutation 入口已統一接入 lock guard，必須以 P3 完成後的入口集合為基線。

---

## 2. 任務索引

### Phase P0：Integration Foundation

- [ ] P0-T01 凍結 migration 編號與前置 contract
- [ ] P0-T02 修正強認證 Idempotency actor scope
- [ ] P0-T03 建立 Inventory 權限、設定、常數與公開錯誤
- [ ] P0-T04 驗證並完成 ItemLookup transaction contract
- [ ] P0-T05 建立 Domain Operation 與 Audit persistence
- [ ] P0-T06 完成 Operation／Audit services 與不可變保護
- [ ] P0-T07 建立固定鎖協議、internal command context 與 test support
- [ ] P0-GATE 執行 Foundation Phase 完整測試並建立一個 PR

### Phase P1：Core Stock

- [ ] P1-T01 建立 Warehouse／Bin persistence
- [ ] P1-T02 完成 Warehouse／Bin domain service
- [ ] P1-T03 完成 Warehouse／Bin API 與 client contract
- [ ] P1-T04 完成 Warehouse／Bin 管理頁
- [ ] P1-T05 建立 Lot、Stock Control、Balance 與 Movement persistence
- [ ] P1-T06 完成 quantity、expiry、lot 與 projection 純規則
- [ ] P1-T07 完成 Receipt 原子過帳
- [ ] P1-T08 完成 Receipt 下游同步入口與故障邊界
- [ ] P1-T09 完成 Stock／Lot／Movement 查詢 API
- [ ] P1-T10 完成 Stock／Lot／Movement UI
- [ ] P1-T11 完成 Core Stock 整合、並發與效能驗收
- [ ] P1-GATE 執行 Core Stock Phase 完整測試並建立一個 PR

### Phase P2：Reservation & Allocation

- [ ] P2-T01 建立 Reservation／Allocation persistence
- [ ] P2-T02 完成 ATP 與 Reservation state service
- [ ] P2-T03 完成 FEFO candidate 與 Allocation service
- [ ] P2-T04 完成 Release／Cancel／Reallocate 與 Issue consume 整合
- [ ] P2-T05 完成 Reservation／Allocation API 與 internal contracts
- [ ] P2-T06 完成 Reservation／Allocation UI
- [ ] P2-T07 完成真並發、FEFO、安全及端到端驗收
- [ ] P2-GATE 執行 Reservation Phase 完整測試並建立一個 PR

### Phase P3：Warehouse Operations

- [ ] P3-T01 建立 Transfer persistence 與 state rules
- [ ] P3-T02 完成 Draft Transfer domain 與查詢
- [ ] P3-T03 完成 Transfer Dispatch／Receive 原子過帳
- [ ] P3-T04 完成 Transfer API 與 UI
- [ ] P3-T05 完成 Bin Move 原子過帳
- [ ] P3-T06 完成 Adjustment 與 Status Transfer
- [ ] P3-T07 完成 Movement Reversal
- [ ] P3-T08 完成 Adjustments／Movements 操作 UI
- [ ] P3-T09 完成倉務操作整合、並發及安全驗收
- [ ] P3-GATE 執行 Warehouse Operations Phase 完整測試並建立一個 PR

### Phase P4：Stocktake

- [ ] P4-T01 建立 Stocktake、scope、line 與 persistent Bin lock persistence
- [ ] P4-T02 完成 Draft／Start、snapshot 與 lock acquisition
- [ ] P4-T03 完成 Count save 與現場新增 Bucket
- [ ] P4-T04 完成 Ready／Post／Cancel state flow
- [ ] P4-T05 完成 Stocktake API、查詢與 CSV
- [ ] P4-T06 完成 Stocktake UI
- [ ] P4-T07 完成鎖覆蓋、原子過帳、並發及安全驗收
- [ ] P4-GATE 執行 Stocktake Phase 完整測試並建立一個 PR

### Phase P5：Opening, Reporting & Release

- [ ] P5-T01 建立 Inventory Control、Opening Job／Row persistence
- [ ] P5-T02 完成 Opening CSV parser 與 Precheck
- [ ] P5-T03 完成 fenced Opening worker 與失敗復原
- [ ] P5-T04 完成 Opening／Go-Live API
- [ ] P5-T05 完成 Opening UI
- [ ] P5-T06 完成 Stock／Movement／Expiry／Reservation／Transfer 匯出
- [ ] P5-T07 完成 Receiving／Fulfillment／Returns contracts
- [ ] P5-T08 完成 structured logs、營運查詢與 reconciliation runbook
- [ ] P5-T09 完成容量、效能、backup／restore 及安全驗證
- [ ] P5-T10 完成部署、Smoke、文件與 Release Gate
- [ ] P5-GATE 執行最終完整測試並建立一個 PR

---

## 3. 詳細任務

## Phase P0：Integration Foundation

**Phase outcome：** 後續 Inventory 功能可共用同一套身份、權限、SKU eligibility、domain idempotency、Audit 與鎖順序；任何新數量流程尚未開始前，最容易造成重複過帳、跨使用者 replay 或半套資料的基礎風險已被測試鎖定。

### P0-T01：凍結 migration 編號與前置 contract

**Description：** Fetch 最新 main，盤點實際 migration 與 Item/Supplier/Customer 尚未合併的配額；確認 Item T18～T22 及 Inventory `serial` fail-closed 前置，產出本 Phase 使用的實際 migration allocation，不修改既有檔案。

**Traceability：** Design §§1.3、4.23、8.5、12.1；BR-011、BR-040、NFR-009。

**Acceptance criteria：**

- [ ] 每個既有 migration 四位前綴唯一，已套用檔名、內容與 checksum 不變。
- [ ] Inventory logical migrations 有明確實際編號及 FK 順序；與其他模組已存在或已批准配額沒有碰撞。
- [ ] Item lifecycle／lookup contract 已合併；未完成時 P0 停在此 Task，不在 Inventory 複製 SKU 規則。

**Verification（納入 P0-GATE）：** migration file inventory、跨文件編號搜尋及 Technical Lead 人工確認。

**Dependencies：** Item T18～T22、最新 `origin/main`。

**Files likely touched：** `docs/inventory_management/03_design_spec.md`、`docs/inventory_management/05_development_tasks.md`，以及只有實際碰撞時才需同步的其他模組設計文件。

**Estimated scope：** S。

### P0-T02：修正強認證 Idempotency actor scope

**Description：** 修正 framework idempotency identity，使 `jwt`、`jwt-password`、`jwt-device-password` 及其他具有可信 `claims.sub` 的 authenticated request 以 actor scope 隔離；只有 public request 使用 IP scope。

**Traceability：** Design §§1.3、2.7、8.1、10.3；FR-POST-007～008、BR-036～037、SEC-010。

**Acceptance criteria：**

- [ ] 同 IP 的不同 authenticated actors 使用相同 key 不會互相 replay。
- [ ] 同 actor 的強認證 route 仍可同 payload replay，異 payload 回固定 conflict。
- [ ] Public route 行為及既有 idempotency tests 無回歸，identity 不以未驗證 body/header 決定。

**Verification（納入 P0-GATE）：** `server/test/idempotencyService.test.js` 及既有 dispatcher/idempotency regression。

**Dependencies：** P0-T01。

**Files likely touched：** `server/src/services/idempotency/IdempotencyService.js`、`server/test/idempotencyService.test.js`。

**Estimated scope：** S。

### P0-T03：建立 Inventory 權限、設定、常數與公開錯誤

**Description：** 建立五項 Inventory permissions、冪等 seed、typed config normalizer、固定狀態／數量／source／reason allowlists及 stable public errors；不得把負庫存、部分 Transfer 或自訂 Stock Status 變成可切換 flag。

**Traceability：** Design §§5.10、6.1～6.2、8.1～8.2、11.1；SEC-001～006、SEC-009～013。

**Acceptance criteria：**

- [ ] Catalogue 與 seed 精確包含 `inventory.view`、`inventory.operation`、`inventory.mgmt`、`inventory.adjust`、`inventory.fefo.override`，互不繼承。
- [ ] Config 對 page/quantity/export/opening/lease/retention 範圍 fail closed，lease renew interval 必須小於 lease 一半。
- [ ] 所有錯誤、status、command type、Audit action 只取 server allowlist；client 有繁中安全訊息。

**Verification（納入 P0-GATE）：** config、permission conventions、startup guard、error mapping unit tests及 migration integration。

**Dependencies：** P0-T01。

**Files likely touched：** `server/src/modules/authorization/permissionCatalogue.js`、`server/config/inventory.js`、`server/src/modules/inventory/normalizeInventoryConfig.js`、`server/src/modules/inventory/inventoryConstants.js`、`server/src/modules/inventory/inventoryErrors.js`。

**Estimated scope：** M。

### P0-T04：驗證並完成 ItemLookup transaction contract

**Description：** 沿用 Item Management 的唯一 `ItemLookupService`，補足 Inventory 在現有 transaction 中讀取 SKU eligibility、Base UOM conversion、Tracking Policy、Shelf Life 與 minimum life 的方法；不要求下游 actor 持有 `item.view`，也不在 Inventory 重寫 Item 狀態矩陣。

**Traceability：** Design §§3.2、5.11、8.2、14.2；FR-LOT-001～009、BR-006、BR-010～015、BR-040。

**Acceptance criteria：**

- [ ] `purchase`、`sale`、`inventory` purpose 與 Item design 一致；Inactive／Discontinued／Archived／Serial 分支有 contract tests。
- [ ] Lookup 接受 caller 提供的 transaction executor，查詢 Base UOM 及有效整數 factor，不暗中另開 transaction。
- [ ] Lookup 只回白名單 projection，不讀 HTTP claims、不洩漏 Item 管理資料；批量方法避免 N+1。

**Verification（納入 P0-GATE）：** `itemLookupService.test.js`、Inventory consumer contract test及真 MySQL lookup integration。

**Dependencies：** P0-T01；Item T21。

**Files likely touched：** `server/src/modules/item/ItemLookupService.js`、`server/test/itemLookupService.test.js`、`server/test/integration/inventoryItemContract.integration.test.js`。

**Estimated scope：** M。

### P0-T05：建立 Domain Operation 與 Audit persistence

**Description：** 建立 domain operation request 及 Inventory Audit tables、source tuple unique key、必要 indexes、actor/source snapshots與 immutable triggers；domain operation history 不使用短期 HTTP idempotency TTL 清除。

**Traceability：** Design §§4.8、4.21～4.23；FR-AUDIT-001～007、NFR-008、NFR-012。

**Acceptance criteria：**

- [ ] Source unique key 精確為 module＋document type＋document ID＋line ID＋event ID，不含 command type，空 line 使用 `''`。
- [ ] Audit 支援 `SUCCEEDED`、`REJECTED`、`FAILED`，只保存白名單摘要；Movement/Audit retention 至少 7 年。
- [ ] 一般 app account 或 application SQL 無法 UPDATE／DELETE Audit；FK、indexes、SET NULL／RESTRICT 行為符合設計。

**Verification（納入 P0-GATE）：** 真 MySQL migration／constraint／trigger tests，含 duplicate source race及 migration rerun。

**Dependencies：** P0-T01、P0-T03。

**Files likely touched：** 兩支實際編號 migration、`server/test/integration/inventoryMigrations.integration.test.js`。

**Estimated scope：** M。

### P0-T06：完成 Operation／Audit services 與不可變保護

**Description：** 實作 canonical payload hash、atomic domain claim、result replay／source lookup、safe success/reject/failure Audit，並確保必要 Audit 失敗會令 business transaction rollback。

**Traceability：** Design §§2.4、2.7、4.8、4.21、11.2～11.3；FR-POST-003～009、FR-AUDIT-002～007。

**Acceptance criteria：**

- [ ] 同 tuple＋同 hash 回原結果；同 tuple＋不同 hash 回 `INVENTORY_SOURCE_CONFLICT`；並發只有一個 winner。
- [ ] Password／token 不進 hash、result、log 或 Audit；business fields 變化必定改變 hash。
- [ ] Success Audit 與效果同 transaction；rollback 後的 reject/failure Audit 不會冒充已完成數量效果。

**Verification（納入 P0-GATE）：** operation hash、service replay/conflict、Audit failure injection及 indeterminate-result lookup tests。

**Dependencies：** P0-T02、P0-T03、P0-T05。

**Files likely touched：** `InventoryOperationService.js`、`InventoryAuditService.js`、`inventoryOperationHash.test.js`、`inventoryOperationService.test.js`、`inventoryAuditService.test.js`。

**Estimated scope：** M。

### P0-T07：建立固定鎖協議、internal command context 與 test support

**Description：** 建立所有後續寫入必須共用的 Warehouse → Stock Control → Bin/semantic lock → Lot → Balance → workflow root 固定鎖 helper、transaction-required internal command context，以及可注入故障與並發 barrier 的測試支援。

**Traceability：** Design §§2.4～2.5、5.11、8.2、8.5；BR-007、BR-036～038、BR-045、NFR-006～010。

**Acceptance criteria：**

- [ ] Helper 對輸入 IDs 先去重排序，禁止逆序取鎖；不存在的 control/balance 使用 upsert 後 `FOR UPDATE`。
- [ ] Internal write 沒有 transaction executor 時立即失敗，不會私取 pool connection或 nested transaction。
- [ ] Test support 可在 operation、current state、Movement、Audit 與 commit 邊界注入失敗，並可用兩條真 connection 同步競爭。

**Verification（納入 P0-GATE）：** lock order unit tests、transaction-required contract tests及雙 connection smoke test。

**Dependencies：** P0-T04、P0-T06。

**Files likely touched：** `InventoryLockService.js`、`inventoryValidation.js`、`server/test-support/fakeInventoryDatabase.js`、`server/test-support/inventoryFixtures.js`、`inventoryLockService.test.js`。

**Estimated scope：** M。

### P0-GATE：Foundation Phase 完整測試與 PR

**一次完整測試：** 執行 §5.1 的所有命令並保存一份 Phase evidence；不得把各 Task 的零散執行當作 Phase Gate。

**Merge acceptance：**

- [ ] Domain operation replay/conflict、三種 JWT actor scope、Audit rollback、fixed lock order及同 transaction internal call均有通過證據。
- [ ] 新 migration 在 fresh DB、既有 DB及 rerun 均收斂；app account immutable guard通過。
- [ ] Diff 不含任何實際 Stock UI／未完成 workflow；PR 只有 P0 範圍並經人工 review。

---

## Phase P1：Core Stock

**Phase outcome：** Warehouse 與 Bin 可正式維護；Receiving／Returns 類來源可用原子 Receipt 增加指定 SKU／Lot／Bin；使用者可即時查閱 Stock、Lot 與不可變 Movement。Issue 必須消耗正式 Reservation／Allocation，因此在 P2 完成前不對外啟用。

### P1-T01：建立 Warehouse／Bin persistence

**Description：** 建立 Warehouse、Bin tables、normalized unique keys、ownership candidate key、version、status、actor FK與查詢 indexes。

**Traceability：** Design §§4.3～4.4、4.22；FR-MASTER-001～010、BR-001～004。

**Acceptance criteria：**

- [ ] Warehouse Code 全公司 case-insensitive unique；Bin Code 只在 Warehouse 內 unique。
- [ ] `(bin_id,warehouse_id)` ownership 可由後續 composite FK 強制；actor delete 使用 SET NULL，業務引用使用 RESTRICT。
- [ ] Migration 可在 fresh／existing DB 安全套用及 rerun，不依賴 DDL transaction rollback。

**Verification（納入 P1-GATE）：** master migration integration及 duplicate/ownership constraint tests。

**Dependencies：** P0-GATE。

**Files likely touched：** master migration、`inventoryMigrations.integration.test.js`。

**Estimated scope：** S。

### P1-T02：完成 Warehouse／Bin domain service

**Description：** 實作列表、詳情、建立、更新、停用、恢復與受控刪除，所有狀態變更使用 version、fresh permission、Warehouse row lock、reference guard及 Audit。

**Traceability：** Design §§2.5、5.2、9.3；FR-MASTER-001～010、AC-001～006。

**Acceptance criteria：**

- [ ] Inactive Warehouse 不可新增／恢復 Bin；停用在 transaction 內重驗所有 current blockers。
- [ ] Current blockers 清除後可停用；只有歷史 Movement 阻擋永久刪除，不錯誤阻擋停用。
- [ ] Warehouse deactivate 與同時 posting 共用 Warehouse row lock，兩種先後都不留下 Inactive＋新庫存競態。

**Verification（納入 P1-GATE）：** `inventoryMasterService.test.js` 及真 MySQL deactivate/posting race tests。

**Dependencies：** P1-T01、P0-T06～T07。

**Files likely touched：** `InventoryMasterService.js`、`inventoryProjections.js`、`inventoryMasterService.test.js`、`inventoryMaster.integration.test.js`。

**Estimated scope：** M。

### P1-T03：完成 Warehouse／Bin API 與 client contract

**Description：** 建立 §5.2 全部 strict handlers及 client methods，固定 auth strength、permissions、idempotency、version、reason與安全公開錯誤。

**Traceability：** Design §§5.1～5.2、6.1～6.2；SEC-001～005、SEC-008～010。

**Acceptance criteria：**

- [ ] GET／create／update／deactivate／reactivate／delete route metadata與 design 完全一致。
- [ ] Child Bin 以 Warehouse＋Bin 一起查找；跨 owner 與不存在回相同安全 404。
- [ ] Client 不自動重送 version conflict，所有 POST 傳遞 Idempotency-Key，錯誤有繁中映射。

**Verification（納入 P1-GATE）：** handler metadata/schema tests、client service tests及 permission matrix integration。

**Dependencies：** P1-T02。

**Files likely touched：** `server/src/handlers/inventory/warehouseHandlers.js`、`binHandlers.js`、`inventorySchemas.js`、`client/src/services/inventory.js`、相關 tests。

**Estimated scope：** M。

### P1-T04：完成 Warehouse／Bin 管理頁

**Description：** 依 frontend design 建立主從式 Warehouse／Bin 管理頁，支援列表、表單、版本衝突、阻擋摘要及高風險確認；mobile 使用逐頁選擇。

**Traceability：** Design §§7.1、7.3、7.8；FR-MASTER-001～010、AC-001～003。

**Acceptance criteria：**

- [ ] 使用 `PageHeader`、`DataTable`、`FormPanel` 與既有 confirm helpers，不新增平行 UI framework。
- [ ] Action 依 permission 顯示，但後端仍獨立驗證；409 保留輸入並提示 reload。
- [ ] Loading、empty、forbidden、blocked及 375px keyboard flow均可驗收。

**Verification（納入 P1-GATE）：** `inventoryWarehouses.test.js`、client service tests、production build及 manual responsive/accessibility check。

**Dependencies：** P1-T03。

**Files likely touched：** `WarehousesPage.vue`、必要的小型 Warehouse/Bin form component、page tests、`client/config/menu.js`。

**Estimated scope：** M。

### P1-T05：建立 Lot、Stock Control、Balance 與 Movement persistence

**Description：** 建立 current quantity tables與 immutable Movement ledger，包含 no-lot unique scope、SKU/Lot/Bin ownership composite FK、query indexes及 UPDATE/DELETE triggers。

**Traceability：** Design §§4.5～4.9、4.22～4.23；FR-STOCK-001～009、FR-LOT-001～006、FR-POST-003～011。

**Acceptance criteria：**

- [ ] Balance 唯一表示 Warehouse＋Bin＋SKU＋Lot/No Lot＋Status；MySQL NULL 不可繞過 no-lot unique。
- [ ] Lot 必屬 SKU、Bin 必屬 Warehouse；Movement 保存 source、actor及必要 master snapshots。
- [ ] Movement 的 warehouse／SKU／Bin／Lot／actor／type/date及 group/source 查詢均有相符 index，且一般 app 無法修改或刪除。

**Verification（納入 P1-GATE）：** 真 MySQL FK、unique、generated column、index及 immutable trigger tests。

**Dependencies：** P1-T01、P0-T05。

**Files likely touched：** stock migration、operation/movement migration、`inventoryMigrations.integration.test.js`。

**Estimated scope：** M。

### P1-T06：完成 quantity、expiry、lot 與 projection 純規則

**Description：** 建立 Base UOM safe integer、UOM conversion、Tracking Policy、Lot consistency、APP_TIME_ZONE expiry／minimum life、Stock Status及 response projection規則。

**Traceability：** Design §§2.6、3.2～3.3、9.2；FR-STOCK-002～010、FR-LOT-001～010、BR-005～015、BR-021。

**Acceptance criteria：**

- [ ] Decimal、0、負數、overflow及非整數 factor全部拒絕；Pack 轉換不產生小數 Base UOM。
- [ ] Expiry 等於今日仍有效，翌日才 Expired；`none`／`batch`／`batch_expiry`／`serial`規則準確。
- [ ] Projection 明確分開 On Hand、free、Reserved、ATP、Quarantined、Damaged與 In Transit，不 spread DB row。

**Verification（納入 P1-GATE）：** `inventoryQuantity.test.js`、`inventoryExpiry.test.js`、`inventoryValidation.test.js`、`inventoryProjections.test.js`。

**Dependencies：** P0-T03～T04。

**Files likely touched：** `inventoryValidation.js`、`inventoryProjections.js`、四個對應 unit test files。

**Estimated scope：** M（按純規則分 commit，仍屬同一 Phase PR）。

### P1-T07：完成 Receipt 原子過帳

**Description：** 實作 HTTP／internal Receipt，共用 operation claim、SKU purpose、Warehouse/Bin/Stock Control/Lot/Balance固定鎖、current update、Movement與 Audit transaction。

**Traceability：** Design §§2.4～2.5、3.2～3.3、5.4、5.11；FR-POST-001～010、AC-013～016。

**Acceptance criteria：**

- [ ] 正確處理 Base／Pack UOM、三種人工 Status、Lot/Expiry與 minimum receipt life evidence。
- [ ] 相同 source replay 不重複；同 source 異內容衝突；任何注入失敗均無半套 Lot／Balance／Movement／Audit。
- [ ] Inactive/Archived/not tracked/Serial SKU、Inactive Warehouse/Bin、Lot conflict及無效 override皆 fail closed。

**Verification（納入 P1-GATE）：** Receipt service/handler tests、failure injection及真 DB posting integration。

**Dependencies：** P1-T05～T06、P0-T04～T07。

**Files likely touched：** `InventoryPostingService.js`、`postingHandlers.js`、`inventoryPostingService.test.js`、`inventoryPosting.integration.test.js`。

**Estimated scope：** M。

### P1-T08：完成 Receipt 下游同步入口與故障邊界

**Description：** 把 Receipt 以 transaction-required internal contract提供給 Receiving／Returns，驗證 caller source write與 Inventory效果共用同一 MySQL transaction；Issue route及成功路徑明確保持未註冊，直到 P2具備 Reservation／Allocation。

**Traceability：** Design §§2.4、5.4、5.11；FR-POST-001～009、BR-036～038、BR-045、AC-013～016、AC-047～048。

**Acceptance criteria：**

- [ ] Internal Receipt沒有 transaction executor時立即失敗；caller source write失敗會連同 Inventory rollback，反向亦然。
- [ ] Provider固定 Receiving／Returns purpose與 caller permission mapping，不接受 caller自由傳入 permission名稱。
- [ ] `/inventory/issues`不註冊或固定 fail closed；不得提供不消耗 Reservation／Allocation的臨時 Issue捷徑。

**Verification（納入 P1-GATE）：** same-transaction rollback、permission revocation、dependency unavailable及 Receipt replay contract tests。

**Dependencies：** P1-T07。

**Files likely touched：** `InventoryPostingService.js`、`InventoryLookupService.js`、posting/contract integration tests。

**Estimated scope：** M。

### P1-T09：完成 Stock／Lot／Movement 查詢 API

**Description：** 實作 server-side paginated inquiry、SKU aggregate、bucket drill-down、Lot/expiry及 Movement/source/group detail；所有 filters/sorts使用 allowlist及相符 index。

**Traceability：** Design §§5.3、9.4、10.6；FR-STOCK-001～010、FR-LOT-010、FR-REPORT-001～002、005。

**Acceptance criteria：**

- [ ] SKU Code／Barcode exact搜尋優先，name partial安全 escape；列表以 `id` stable tie-breaker。
- [ ] 查詢即時使用 current Balance/Control及 expiry規則，不依賴人工重建 cache。
- [ ] Movement可按日期/type/source/SKU/Warehouse/Bin/Lot/actor查詢，結果只回白名單快照與安全 source link。

**Verification（納入 P1-GATE）：** inquiry service、handler、client mapping及 EXPLAIN/index integration tests。

**Dependencies：** P1-T05～T08。

**Files likely touched：** `InventoryInquiryService.js`、`stockHandlers.js`、`lotHandlers.js`、`movementHandlers.js`、對應 tests。

**Estimated scope：** M。

### P1-T10：完成 Stock／Lot／Movement UI

**Description：** 建立庫存總覽、批次與效期、Movement頁面，提供 URL filters、server pagination、aggregate到bucket drill-down及source/reversal關聯顯示。

**Traceability：** Design §§7.1～7.2、7.8；FR-STOCK-001～010、FR-REPORT-001～002、005、AC-004～012。

**Acceptance criteria：**

- [ ] 數量欄不可混成單一 quantity；Expired／low-life／Status具文字及 icon，不只靠顏色。
- [ ] URL可還原 filters/page/sort且不含敏感資料；stale request可取消。
- [ ] 375/768/1024/1440px、keyboard、loading/empty/error/retry及 `inventory.view` route guard通過。

**Verification（納入 P1-GATE）：** `inventoryStocks.test.js`、`inventoryMovements.test.js`、service tests、production build及 manual responsive check。

**Dependencies：** P1-T09；P1-T04可平行提供 UI pattern。

**Files likely touched：** `StocksPage.vue`、`LotsPage.vue`、`MovementsPage.vue`、`StockSummary.vue`、`StockBucketTable.vue`及 tests。

**Estimated scope：** M（頁面可由不同開發者平行，但共用 client contract先凍結）。

### P1-T11：完成 Core Stock 整合、並發與效能驗收

**Description：** 收斂 AC-001～015及 AC-016的 Receipt路徑，補足 Warehouse deactivate/posting、Receipt source duplicate、rollback、權限與核心查詢容量測試，不新增業務功能。

**Traceability：** Design §§10.1～10.6、12.2；AC-001～016的 P1適用部分、AC-047～049適用部分。

**Acceptance criteria：**

- [ ] 兩條 connection 競爭同 Receipt source/bucket時不重複 Movement；deadlock/timeout轉 stable conflict且零半套資料。
- [ ] 每個 Core endpoint通過 401/403/stale actor/owner mismatch/strict schema及敏感資料檢查。
- [ ] 需求容量下 exact SKU/Barcode、stock summary、bucket drill-down及 Movement common filters p95 < 2 秒並保存 EXPLAIN。

**Verification（納入 P1-GATE）：** Core integration/concurrency/security/performance suites及 manual Receipt→Stock→Movement示範。

**Dependencies：** P1-T01～T10。

**Files likely touched：** Core integration test files、capacity fixture/generator、必要的 index migration（只可 additive）。

**Estimated scope：** M。

### P1-GATE：Core Stock Phase 完整測試與 PR

**一次完整測試：** 執行 §5.2；以專用 MySQL 完成 migration、真 transaction、API、client、build、coverage及 core capacity驗證。

**Merge acceptance：**

- [ ] 可示範 Warehouse/Bin建檔 → Receipt → Stock/Lot查詢 → Movement追溯；每一步有 Audit/source，Issue仍安全關閉。
- [ ] AC-001～015及 AC-016 Receipt路徑通過；任何 failure injection後 reconciliation為0差異。
- [ ] 一個 P1 PR 經 code/security/DB review；未包含 Reservation、Transfer或 Stocktake 半成品。

---

## Phase P2：Reservation & Allocation

**Phase outcome：** Sales 可在 Warehouse 層全量預留 SKU；Fulfillment 可取得穩定 FEFO 候選、分配至實際 Lot／Bin、釋放或重分配，並由 Issue 原子耗用 Allocation 與 Reservation。

### P2-T01：建立 Reservation／Allocation persistence

**Description：** 建立 Reservation、Allocation tables、quantity breakdown、purpose/minimum-life snapshot、status/version、operation/source及 Balance關聯 indexes/FKs。

**Traceability：** Design §§4.10～4.11、4.22；FR-RES-001～010、FR-ALLOC-001～010。

**Acceptance criteria：**

- [ ] Reservation 保存 original/consumed/released/outstanding；Allocation保存 allocated/consumed/released/outstanding，所有欄位使用 unsigned Base UOM integer。
- [ ] Create operation、Warehouse、SKU、Reservation、Balance及 actor FK delete rules符合歷史保留要求。
- [ ] Warehouse＋SKU＋status與 Reservation＋Balance 查詢有穩定 index；MySQL 8.0 CHECK只作row-local第二層保護，不取代service的跨row invariant。

**Verification（納入 P2-GATE）：** 真 MySQL migration、FK、index、rerun及直接非法資料寫入測試。

**Dependencies：** P1-GATE。

**Files likely touched：** Reservation migration、`inventoryMigrations.integration.test.js`。

**Estimated scope：** S。

### P2-T02：完成 ATP 與 Reservation state service

**Description：** 實作 purpose-aware eligible On Hand、Reserved、raw ATP、ATP/uncovered計算，以及 create、partial release、cancel與 state/version transition；所有改量先鎖 Warehouse＋Stock Control。

**Traceability：** Design §§2.5～2.6、3.4、9.3；FR-RES-001～010、BR-016～018、AC-019～022。

**Acceptance criteria：**

- [ ] 建立 Reservation 全有或全無，只有 raw ATP 足夠才成功；Expired／low-life／Quarantined／Damaged不合資格。
- [ ] 每次 state change保持 `original = consumed + released + outstanding`，terminal state不可被 stale event復活。
- [ ] 日期跨日造成 uncovered時不自動刪除 Reservation，但禁止新超額 Reservation並回明確數量。

**Verification（納入 P2-GATE）：** ATP/expiry boundary、state transition、version conflict、Audit rollback及 concurrent Reservation tests。

**Dependencies：** P2-T01、P1-T06、P0-T07。

**Files likely touched：** `InventoryReservationService.js`、`inventoryQuantity.js`或既有純規則檔、`inventoryReservationService.test.js`、`inventoryReservation.integration.test.js`。

**Estimated scope：** M。

### P2-T03：完成 FEFO candidate 與 Allocation service

**Description：** 實作有 expiry／無 expiry／無 lot的穩定 FEFO排序、跨多 Bucket candidate selection、Allocation create及受權限控制的 FEFO override。

**Traceability：** Design §§3.5、5.5、9.2；FR-ALLOC-001～006、008～010、BR-019～020、AC-023～027。

**Acceptance criteria：**

- [ ] Candidate排序精確依 expiry/first receipt、lot、bin、balance ID，並只回 eligible free quantity與 version。
- [ ] Allocation不扣 On Hand；總 outstanding不超過 Reservation，單 Bucket outstanding不超過 On Hand。
- [ ] 偏離建議只有 `inventory.fefo.override`＋5～500字原因可通過，仍不可選過期、低效期、非 AVAILABLE、Inactive/locked Bin或不足 Bucket。

**Verification（納入 P2-GATE）：** `inventoryFefo.test.js`、Allocation service tests、override Audit及跨 Bin同 Lot integration。

**Dependencies：** P2-T02。

**Files likely touched：** `InventoryFefoService.js`、`InventoryReservationService.js`、`inventoryFefo.test.js`、`inventoryReservationService.test.js`、Reservation integration test。

**Estimated scope：** M。

### P2-T04：完成 Release／Cancel／Reallocate 與 Issue consume 整合

**Description：** 補齊 Allocation release/reallocate，並首次啟用只可消耗匹配 Allocation的 Issue，同步扣 On Hand/allocated/reserved與 Reservation/Allocation outstanding的單一 transaction。

**Traceability：** Design §§3.3～3.5、5.4～5.5；FR-POST-004、006、010、FR-RES-004～007、FR-ALLOC-006～009。

**Acceptance criteria：**

- [ ] Reallocate在同一 transaction釋放舊分配並建立新分配，中途失敗保留原狀態。
- [ ] Issue逐行鎖定並只消耗相同 Reservation/Allocation/Balance；任何 mismatch、不合資格或不足令整批 rollback。
- [ ] Issue完成後四組 current quantities、Movement、operation及 Audit一致；Reverse Issue不復活已耗用 Reservation/Allocation。

**Verification（納入 P2-GATE）：** release/reallocate failure injection、Issue consume integration、replay/conflict及 reconciliation assertions。

**Dependencies：** P2-T03、P1-T07～T08。

**Files likely touched：** `InventoryReservationService.js`、`InventoryPostingService.js`、`postingHandlers.js`、兩個 service tests、Reservation/Posting integration tests。

**Estimated scope：** M。

### P2-T05：完成 Reservation／Allocation API 與 internal contracts

**Description：** 建立 §5.5 全部查詢／command handlers、client methods及 Sales/Fulfillment transaction-aware service entry points；provider固定 caller permission/purpose mapping，不接受 caller自報權限名稱。

**Traceability：** Design §§5.1、5.5、5.11、6.1；SEC-003、SEC-006～008、AC-047～048。

**Acceptance criteria：**

- [ ] Create/release/cancel/candidates/allocate/release allocation/reallocate route具有 strict schema、version、source及 idempotency。
- [ ] FEFO candidates query不改資料；所有 command共用既有 caller transaction且提交點重讀 actor permission。
- [ ] 下游角色不因呼叫 Inventory capability取得 `inventory.view`或管理頁權限。

**Verification（納入 P2-GATE）：** handler/client contract tests、internal transaction rollback及 permission revocation integration。

**Dependencies：** P2-T02～T04。

**Files likely touched：** `reservationHandlers.js`、`allocationHandlers.js`、`client/src/services/inventory.js`、handler/client tests。

**Estimated scope：** M。

### P2-T06：完成 Reservation／Allocation UI

**Description：** 建立 Reservation列表／詳情、quantity breakdown、Allocation drawer、FEFO候選、override提示與 conflict reload flow；前端不重算可信 ATP或 FEFO rank。

**Traceability：** Design §§7.1、7.4、7.8；FR-RES-004～007、FR-ALLOC-002～010、AC-019～021、AC-023～027。

**Acceptance criteria：**

- [ ] Original/Consumed/Released/Outstanding及 source清楚分列；uncovered有文字下一步。
- [ ] 具 override權限才顯示原因操作；無論 UI顯示與否，後端拒絕仍能安全呈現。
- [ ] 409時保留使用者輸入但強制重載 candidates，不自動改選另一 Lot；keyboard/mobile flow可完成。

**Verification（納入 P2-GATE）：** `inventoryReservations.test.js`、client service tests、production build及 manual FEFO flow。

**Dependencies：** P2-T05。

**Files likely touched：** `ReservationsPage.vue`、`AllocationPanel.vue`、`useInventoryFilters.js`、page tests。

**Estimated scope：** M。

### P2-T07：完成真並發、FEFO、安全及端到端驗收

**Description：** 補足 Reservation/Allocation/Issue在真 MySQL的並發、時間流逝、權限撤銷、FEFO override及多 Bucket端到端驗證，不增加新功能；需要 Bin Move的 AC-022留待 P3。

**Traceability：** Design §§10.2～10.6、12.3；AC-017、AC-019～021、AC-023～027、AC-047～049。

**Acceptance criteria：**

- [ ] ATP 10並發 Reservation 7＋7最多一個成功；Reserved及 Reservation SUM一致。
- [ ] 同 Bucket Allocation／Issue／release競爭不超額、不負數、不 lost update；失敗方回 stable conflict。
- [ ] Normal、override、expired、low-life、status、Inactive Bin、跨 owner及撤權情境均有真 API＋DB證據。

**Verification（納入 P2-GATE）：** Reservation/Allocation/Issue integration、concurrency/security suites及 Sales→Reserve→Allocate→Issue manual flow。

**Dependencies：** P2-T01～T06。

**Files likely touched：** Reservation/Posting/Contract integration tests及必要 additive index migration。

**Estimated scope：** M。

### P2-GATE：Reservation Phase 完整測試與 PR

**一次完整測試：** 執行 §5.3；完整覆蓋 P0/P1 regression、P2 unit/integration/concurrency/client/build/coverage。

**Merge acceptance：**

- [ ] 可示範 Sale source → Reservation → FEFO candidates → Allocation → Issue，並追溯 current quantities、Movement、source及 Audit。
- [ ] AC-017、AC-019～021、AC-023～027及相關 security/internal contract AC通過；AC-022明確由 P3 Bin Move驗收，並發結果 reconciliation為0差異。
- [ ] 一個 P2 PR 經 code/security review；未包含 Transfer或 Stocktake半成品。

---

## Phase P3：Warehouse Operations

**Phase outcome：** 倉務使用者可在不破壞 Reservation/Allocation的前提下完成 Bin Move與整張跨倉 Transfer；授權人可執行 Adjustment、Status Transfer及受控 Reversal，所有操作均有成對或反向 Movement。

### P3-T01：建立 Transfer persistence 與 state rules

**Description：** 建立 Transfer header/line tables、operation IDs、source/destination ownership、In Transit current quantity、versions及 state machine純規則。

**Traceability：** Design §§3.6、4.12～4.13；FR-TRANSFER-001～012、BR-024～027。

**Acceptance criteria：**

- [ ] Draft/In Transit/Received/Cancelled狀態與合法 transition固定；source與 destination Warehouse不同。
- [ ] Line保存 SKU/Lot/source Bin、完整 quantity及 dispatch snapshots；header/line/source/destination indexes完整。
- [ ] Partial dispatch/receive、In Transit edit/cancel在純規則層明確拒絕。

**Verification（納入 P3-GATE）：** migration/FK/index tests及 `inventoryStateMachines.test.js` Transfer cases。

**Dependencies：** P2-GATE。

**Files likely touched：** Transfer migration、`inventoryStateMachines.js`或既有 validation檔、migration/state tests。

**Estimated scope：** M。

### P3-T02：完成 Draft Transfer domain 與查詢

**Description：** 實作 Draft建立、完整 replace lines、取消、列表及詳情；Draft不改 On Hand、Reserved或 In Transit。

**Traceability：** Design §§3.6、5.6、9.3；FR-TRANSFER-001～003、006、011～012。

**Acceptance criteria：**

- [ ] 建立／更新驗證兩個 Active Warehouses、SKU/Lot/source Bin ownership、positive quantity及 version。
- [ ] Replace lines全有或全無；cancel只限 Draft且保存 actor/time/reason/Audit。
- [ ] 查詢明確顯示 header/line versions與四種狀態，跨 owner child ID安全拒絕。

**Verification（納入 P3-GATE）：** Transfer service Draft tests、API/DB integration及 Audit rollback。

**Dependencies：** P3-T01、P0-T06～T07。

**Files likely touched：** `InventoryTransferService.js`、`InventoryInquiryService.js`、`inventoryTransferService.test.js`、`inventoryTransfer.integration.test.js`。

**Estimated scope：** M。

### P3-T03：完成 Transfer Dispatch／Receive 原子過帳

**Description：** 實作整張 Dispatch及整張 Receive；Dispatch扣來源 Bin並增加目的 Warehouse In Transit，Receive清除 In Transit並增加逐行指定的目的 Active Bin。

**Traceability：** Design §§2.5、3.6、5.6；FR-TRANSFER-003～011、AC-030～034。

**Acceptance criteria：**

- [ ] Dispatch按兩 Warehouse ID及所有 Stock Control/Balance固定排序鎖定，任一行失敗整張零效果。
- [ ] Receive line ID集合exact；每行 quantity不可修改，目的 Bin屬目的 Warehouse，Status只可保持或改 Quarantined＋reason。
- [ ] Dispatch/Receive各自冪等；Movement paired legs、In Transit與 Transfer state在同一 transaction一致。

**Verification（納入 P3-GATE）：** full/partial rejection、multi-line rollback、replay/conflict及 concurrent Issue/Dispatch tests。

**Dependencies：** P3-T02、P2-T04。

**Files likely touched：** `InventoryTransferService.js`、`InventoryPostingService.js`、Transfer service/integration tests、Movement integration test。

**Estimated scope：** M。

### P3-T04：完成 Transfer API 與 UI

**Description：** 建立 Transfer handlers/client及 Draft editor、Dispatch確認、In Transit read-only、逐行 Receive Bin/Status畫面。

**Traceability：** Design §§5.6、7.1、7.5；FR-TRANSFER-001～012、AC-030～034。

**Acceptance criteria：**

- [ ] API route/auth/permission/idempotency/version與 design一致；Receive schema拒絕少行、重複行、多行或部分 quantity。
- [ ] UI在 Dispatch後不顯示可編輯／取消；清楚分開來源、目的及 In Transit。
- [ ] Quarantined收貨強制原因；同名 Bin不會誤用來源 ID；responsive/keyboard/conflict states通過。

**Verification（納入 P3-GATE）：** handler/client tests、`inventoryTransfers.test.js`、production build及 manual完整 Transfer flow。

**Dependencies：** P3-T02～T03。

**Files likely touched：** `transferHandlers.js`、`TransfersPage.vue`、`TransferEditor.vue`、client service及 tests。

**Estimated scope：** M。

### P3-T05：完成 Bin Move 原子過帳

**Description：** 實作同 Warehouse兩 Active Bins之間指定 SKU/Lot/Status的原子 Move，產生成對 OUT/IN legs且不改總 On Hand。

**Traceability：** Design §§3.3、3.8、5.4；FR-MOVE-001～007、BR-023、AC-028～029。

**Acceptance criteria：**

- [ ] 來源/目的不同且同 Warehouse；SKU/Lot/Status保持不變；quantity使用 Base UOM正整數。
- [ ] 不可移走 allocated quantity或令 eligible stock低於 Reserved；任一 Bin locked時拒絕。
- [ ] paired legs共用 group，任何失敗零 Balance/Movement/Audit半套；version/source重送語意正確。

**Verification（納入 P3-GATE）：** Bin Move service/handler/integration、reserved protection及 concurrency tests。

**Dependencies：** P2-GATE、P0-T07。

**Files likely touched：** `InventoryPostingService.js`、`postingHandlers.js`、posting service/integration tests。

**Estimated scope：** M。

### P3-T06：完成 Adjustment 與 Status Transfer

**Description：** 實作只有 `inventory.adjust`＋device/password reauth可執行的正／負 Adjustment及三種人工 Status間的原子轉換，強制 reason category/text及當下規則。

**Traceability：** Design §§3.3、5.4、6.2；FR-ADJUST-001～007、009～010、BR-021～022、028～030、AC-035～037。

**Acceptance criteria：**

- [ ] 負 Adjustment只可扣 free quantity且不破壞 Reserved/Allocation；正 Adjustment遵守 Tracking/Lot/Bin/Expiry。
- [ ] Status Transfer保持 Warehouse/Bin/SKU/Lot不變，paired legs令 Total On Hand不變；轉出 AVAILABLE重驗 Reservation保障。
- [ ] High-risk route不能用普通 JWT；permission、reauth actor/device/action/time及原因在提交點重驗並 Audit。

**Verification（納入 P3-GATE）：** Adjustment/Status unit+integration、version race、auth strength、Audit failure及 reason allowlist tests。

**Dependencies：** P3-T05；Adjustment reason固定使用已批准的七項allowlist，任何新增／改名須先走需求變更。

**Files likely touched：** `InventoryPostingService.js`、`postingHandlers.js`、posting tests、`client/src/framework/http/errorMessages.js`。

**Estimated scope：** M。

### P3-T07：完成 Movement Reversal

**Description：** 實作完整 Movement group反向，僅允許 Receipt、Issue、Bin Move、Status Transfer及 Adjustment；Transfer、Stocktake、Opening、In Transit與 Reversal本身走關聯 Adjustment/Status流程。

**Traceability：** Design §3.8、§4.9、§5.4；FR-POST-011、FR-ADJUST-008～009、BR-031、AC-038～039。

**Acceptance criteria：**

- [ ] 一個原 group只能完整 reverse一次，每個 leg以 unique `reversal_of_movement_id`連結，原 row不修改。
- [ ] Reverse Receipt／increase再次檢查 free/Reserved/Allocation；Reverse Issue只回庫存，不復活已耗用 Reservation/Allocation。
- [ ] 不支援 group回固定 `MOVEMENT_TYPE_NOT_REVERSIBLE`；任何當下 invariant失敗整組零效果。

**Verification（納入 P3-GATE）：** allowlist、完整 group、already reversed、concurrent reversal及 current-rule failure tests。

**Dependencies：** P3-T05～T06。

**Files likely touched：** `InventoryPostingService.js`、`movementHandlers.js`、posting service/integration tests。

**Estimated scope：** M。

### P3-T08：完成 Adjustments／Movements 操作 UI

**Description：** 建立 Adjustment/Status/Reversal入口與 Movement group/reversal顯示；高風險確認須顯示位置、Lot、Status、數量、預期效果及原因。

**Traceability：** Design §§7.1～7.2、7.8；FR-ADJUST-001～010、SEC-005、SEC-010～012。

**Acceptance criteria：**

- [ ] 只有 view＋adjust顯示頁/按鈕；FEFO override或 operation權限不被誤當 adjust。
- [ ] device-password不進 client state、URL或重送 payload cache；timeout後先查 source結果。
- [ ] 原 Movement與 reversal group雙向連結，非可 reverse類型不顯示誤導操作。

**Verification（納入 P3-GATE）：** `inventoryMovements.test.js`、Adjustments page tests、client auth/error tests、build及 manual high-risk flow。

**Dependencies：** P3-T06～T07。

**Files likely touched：** `AdjustmentsPage.vue`、`MovementsPage.vue`、client service、page tests。

**Estimated scope：** M。

### P3-T09：完成倉務操作整合、並發及安全驗收

**Description：** 收斂 Bin Move、Transfer、Adjustment、Status、Reversal的真 DB原子性、並發、權限、source replay及 Movement reconciliation，並完成 AC-018與 AC-022的跨 Phase依賴。

**Traceability：** Design §§10.2～10.6、12.3；AC-018、AC-022、AC-028～039、AC-047～049。

**Acceptance criteria：**

- [ ] On Hand 10並發 Issue 7與 Dispatch 7最多一個成功；同 version Adjustments只有一個成功。
- [ ] 所有 paired/reversal groups可對賬且任一 failure injection差異為0；未 Allocation的 Reserved庫存可同倉移 Bin並保持 Reserved，Issue錯誤只能以 Reversal更正。
- [ ] Cross-owner IDs、普通 JWT high-risk、撤權 actor、stored XSS/source tampering及 direct ledger update皆被阻擋。

**Verification（納入 P3-GATE）：** Movement/Transfer/Posting concurrency/security/reconciliation suites及 manual warehouse flow。

**Dependencies：** P3-T01～T08。

**Files likely touched：** Movement/Transfer/Posting integration tests、security tests、必要 additive indexes。

**Estimated scope：** M。

### P3-GATE：Warehouse Operations Phase 完整測試與 PR

**一次完整測試：** 執行 §5.4；包含 P0～P2 regression、全部 P3 unit/integration/concurrency/client/build/coverage。

**Merge acceptance：**

- [ ] 可示範 Bin Move、完整 Dispatch/Receive、Status Transfer、Adjustment及 Reversal，所有結果可由 source/Movement/Audit追溯。
- [ ] AC-018、AC-022及 AC-028～039全通過，Reservation/Allocation保障未因新入口失效。
- [ ] 一個 P3 PR 經 code/security/DB review；所有會改 Bin On Hand的入口已登記供 P4 lock coverage使用。

---

## Phase P4：Stocktake

**Phase outcome：** 倉務使用者可選定一個 Warehouse內的一或多個 Bins開始盤點；鎖定跨服務重啟仍有效，Counting期間所有 Bin異動被拒絕，完成後由 `inventory.adjust`一次原子過帳全部差異或安全取消。

### P4-T01：建立 Stocktake、scope、line 與 persistent Bin lock persistence

**Description：** 建立 Stocktake header、scope bins、semantic locks及 count lines，使用 active generated slot與 composite owner FK保證同 Bin只有一個 active lock且 lock/line不會交叉指向另一 Stocktake/Bin。

**Traceability：** Design §§4.14～4.17、4.22；FR-COUNT-001～012、BR-032～034。

**Acceptance criteria：**

- [ ] Stocktake狀態、各 command operation、versions及 actor/time欄位完整；posted/cancelled歷史保留。
- [ ] `(stocktake_bin_id,stocktake_id,bin_id)` composite FK在 DB層拒絕錯 owner組合。
- [ ] `UNIQUE(bin_id,active_scope)`只允許一個 active lock，released history可多筆；count dimension的 no-lot unique不可被 NULL繞過。

**Verification（納入 P4-GATE）：** 真 MySQL migration、active slot、composite FK、dimension unique及 rerun tests。

**Dependencies：** P3-GATE。

**Files likely touched：** Stocktake migration、`inventoryMigrations.integration.test.js`。

**Estimated scope：** S。

### P4-T02：完成 Draft／Start、snapshot 與 lock acquisition

**Description：** 實作 Draft建立／scope replace／取消及 Start；Start先驗證所有 scope Bins，再以固定順序原子建立所有 locks及 snapshot現存 buckets。

**Traceability：** Design §§2.5、3.7、5.7；FR-COUNT-001～003、010～011、AC-040～041。

**Acceptance criteria：**

- [ ] Draft不鎖也不改庫存；同一 Warehouse的一或多 Bins scope完整 replace且使用 version。
- [ ] Start任一 Bin inactive/locked/owner mismatch時不留下部分 lock或 snapshot。
- [ ] Start成功後 snapshot包含開始前已提交效果；與同時 Receipt競爭只有「Receipt先完成被納入」或「Start先鎖定並阻擋 Receipt」兩種結果。

**Verification（納入 P4-GATE）：** Stocktake service tests、multi-Bin rollback及 Start/Receipt真並發 barrier test。

**Dependencies：** P4-T01、P0-T07、P3-T09入口清單。

**Files likely touched：** `InventoryStocktakeService.js`、`inventoryStocktakeService.test.js`、`inventoryStocktake.integration.test.js`。

**Estimated scope：** M。

### P4-T03：完成 Count save 與現場新增 Bucket

**Description：** 實作逐批1～100 lines保存非負整數 counted quantity、明確 notFound、progress及新增 snapshot=0的現場 Bucket；不得把空值與0混淆。

**Traceability：** Design §§3.7、5.7、7.6；FR-COUNT-004～007、011。

**Acceptance criteria：**

- [ ] 每行使用 version防兩人覆蓋；counted=0有效，未填為 NULL，notFound明確代表 actual=0。
- [ ] 新 Bucket重驗 SKU/Tracking/Lot/Bin/Status並遵守相同 dimension unique；不可提交 client snapshot/variance。
- [ ] READY後 save/add全部拒絕；progress分頁不一次載入所有 lines。

**Verification（納入 P4-GATE）：** count 0/empty/notFound、duplicate dimension、version race及 new bucket integration tests。

**Dependencies：** P4-T02、P1-T06。

**Files likely touched：** `InventoryStocktakeService.js`、`stocktakeHandlers.js`、service/handler/integration tests。

**Estimated scope：** M。

### P4-T04：完成 Ready／Post／Cancel state flow

**Description：** 實作 completeness檢查、READY_TO_POST、device-password＋adjust原子 Posting及 owner-safe Cancel；不提供 reopen或部分差異過帳。

**Traceability：** Design §§3.7、5.7、6.2；FR-COUNT-007～011、FR-ADJUST-001、AC-042～043。

**Acceptance criteria：**

- [ ] 所有 lines counted或 notFound才可 Ready；Ready後修正只能 cancel後重建。
- [ ] Post一次處理全部 variance，逐行更新 Balance/Movement/Audit後才 owner-safe release locks；任一失敗狀態仍 READY且 locks保持。
- [ ] Cancel只釋放該 Stocktake持有的 locks，不產生 Movement；Posted/Cancelled重送回原結果或 stable state conflict。

**Verification（納入 P4-GATE）：** completeness、zero variance、multi-line failure injection、reauth/permission及 owner-safe unlock tests。

**Dependencies：** P4-T03、P3-T06。

**Files likely touched：** `InventoryStocktakeService.js`、`InventoryPostingService.js`、Stocktake service/integration tests。

**Estimated scope：** M。

### P4-T05：完成 Stocktake API、查詢與 CSV

**Description：** 完成 §5.7 handlers/client、header/scope/progress/variance查詢及安全 CSV export，固定各 route auth strength、permission、schema、version與 idempotency。

**Traceability：** Design §§5.7、5.9、9.4；FR-COUNT-001～012、FR-REPORT-006～007。

**Acceptance criteria：**

- [ ] Create/update/start/save/add/ready/post/cancel及 GET endpoints與 design contract一致。
- [ ] Post固定 `jwt-device-password`＋adjust；Cancel固定 `jwt-password`＋operation；密碼不進 domain/hash/log。
- [ ] CSV包含 scope/snapshot/actual/variance/movement IDs，沿用相同 filters/Base UOM並 neutralize公式。

**Verification（納入 P4-GATE）：** handler/client/schema/auth tests、CSV security tests及 API integration。

**Dependencies：** P4-T02～T04。

**Files likely touched：** `stocktakeHandlers.js`、`exportHandlers.js`、`client/src/services/inventory.js`、handler/client tests。

**Estimated scope：** M。

### P4-T06：完成 Stocktake UI

**Description：** 建立四步 Stocktake wizard、lock banner、server-paginated Counting、Barcode/SKU定位、progress、Ready summary、高風險 Post及取消流程。

**Traceability：** Design §§7.1、7.6、7.8；FR-COUNT-001～012、AC-040～043。

**Acceptance criteria：**

- [ ] 選 Warehouse/Bins→Start→Count→Review/Post流程清晰；0、未輸入及未發現有不同控制與文字。
- [ ] Counting持續顯示 locked Bins、Stocktake number及完成率；READY不顯示 edit/reopen。
- [ ] Post失敗明確顯示 locks仍有效；permission、responsive、keyboard、loading/conflict/retry通過。

**Verification（納入 P4-GATE）：** `inventoryStocktakes.test.js`、client service tests、production build及 manual keyboard/mobile盤點流程。

**Dependencies：** P4-T05。

**Files likely touched：** `StocktakesPage.vue`、`StocktakeCounter.vue`、page tests、`client/config/menu.js`必要 metadata。

**Estimated scope：** M。

### P4-T07：完成鎖覆蓋、原子過帳、並發及安全驗收

**Description：** 以 P3 所有 Bin mutation入口清單建立 parameterized lock coverage，驗證服務重啟、並發 Start/post/cancel、owner mismatch、partial failure及 persistent lock復原。

**Traceability：** Design §§10.2～10.5、12.3；FR-COUNT-002～011、BR-032～034、AC-040～043。

**Acceptance criteria：**

- [ ] Receipt、Issue、Bin Move來源/目的、Transfer Dispatch/Receive、Adjustment、Status、Reversal及 Opening對 locked Bin全部拒絕。
- [ ] 服務 restart不遺失 active locks；同 Bin並發 Start最多一個成功；非 owner不能 release。
- [ ] Post任一步失敗無部分 Balance/Movement/Audit，state/locks保持可重試；成功後 reconciliation為0差異。

**Verification（納入 P4-GATE）：** parameterized lock suite、真並發、restart simulation、security tests及 manual lock banner/blocked operation流程。

**Dependencies：** P4-T01～T06。

**Files likely touched：** Stocktake/Posting/Transfer integration tests、security tests、test fixtures。

**Estimated scope：** M。

### P4-GATE：Stocktake Phase 完整測試與 PR

**一次完整測試：** 執行 §5.5；包含 P0～P3 regression、P4 migration/service/API/UI/concurrency/security/build/coverage。

**Merge acceptance：**

- [ ] 可示範多 Bin Start → restart後仍 locked →逐行 count/new bucket → Ready →全部 Post，及 Cancel零 Movement。
- [ ] AC-040～043全通過；所有已存在 Bin mutation入口的 lock coverage為100%。
- [ ] 一個 P4 PR 經 code/security/DB review；不包含 Opening半成品。

---

## Phase P5：Opening, Reporting & Release

**Phase outcome：** 企業可在 PRE_GO_LIVE安全預檢及原子導入最多10,000行 Opening、完成對賬後不可逆 Go-Live；日常匯出、下游合約、可觀測性、2M Movement容量、backup/restore及 release evidence齊備。

### P5-T01：建立 Inventory Control、Opening Job／Row persistence

**Description：** 建立單列 Go-Live control、Opening jobs/rows、validation/result metadata、lease owner/generation fencing、operation/movement links及 queue/list indexes。

**Traceability：** Design §§4.18～4.20、4.22；FR-OPEN-001～007、BR-035。

**Acceptance criteria：**

- [ ] Control只允許 PRE_GO_LIVE→LIVE；migration冪等建立 id=1，不提供一般回復或 delete。
- [ ] Job保存 file hash/size、row counts、precheck snapshot、lease owner/generation/expiry/attempts及 safe error；不保存 Audit中的完整 CSV。
- [ ] Row number在 job內唯一；duplicate dimension以 group validation保留所有錯誤 rows，不用 DB unique吞掉第二列。

**Verification（納入 P5-GATE）：** Opening migration/FK/index/rerun、control singleton及 duplicate row persistence tests。

**Dependencies：** P4-GATE、P0-T05。

**Files likely touched：** Opening migration、`inventoryMigrations.integration.test.js`。

**Estimated scope：** S。

### P5-T02：完成 Opening CSV parser 與 Precheck

**Description：** 建立 UTF-8 RFC4180 streaming parser、固定 v1 template、10,000 row/size/header/formula限制及不改庫存的 async Precheck；解析後重用 Item/Warehouse/Bin/Lot/Status規則。

**Traceability：** Design §§5.8、6.3、9.2；FR-OPEN-001～003、005、007、SEC-009、SEC-011。

**Acceptance criteria：**

- [ ] Template只有 Warehouse/Bin/SKU/Lot/Expiry/Status/Base Quantity；quantity必須為正整數，任何錯誤整份不可 confirm。
- [ ] 錯 MIME/signature/encoding/header/extra field/formula/oversize/too many rows/path traversal全部安全拒絕。
- [ ] Precheck只寫 job/normalized rows/errors/version hash，不建立 Lot/Balance/Movement或成功 Audit；錯誤可定位 row/field。

**Verification（納入 P5-GATE）：** `inventoryCsv.test.js`、malformed/security fixtures、10k streaming memory及 Precheck zero-business-write integration。

**Dependencies：** P5-T01、P1-T06、P0-T04。

**Files likely touched：** `opening/inventoryCsv.js`、`InventoryOpeningService.js`、CSV/unit/integration tests及必要 parser dependency lockfile。

**Estimated scope：** M。

### P5-T03：完成 fenced Opening worker 與失敗復原

**Description：** 使用現有 Scheduler/DB lease完成 claim、20秒 heartbeat續60秒 lease、generation fencing、stale precheck重驗及全部 valid rows單一 business transaction過帳。

**Traceability：** Design §§4.19、11.5、12.4；FR-OPEN-002～005、007、NFR-006～010、AC-044～046。

**Acceptance criteria：**

- [ ] Claim/takeover原子遞增 generation；所有 progress/final writes帶 owner＋generation，lost ownership立即停止。
- [ ] Heartbeat使用獨立短 connection；final COMPLETED update在 business transaction內，stale worker affected rows=0令整個 posting rollback。
- [ ] 任一 row/lock/Audit/commit前失敗不留下部分 Lot/Balance/Movement；commit indeterminate先查 source結果再決定重試。

**Verification（納入 P5-GATE）：** lease expiry/takeover、>60秒 heartbeat、worker crash/restart、failure injection、duplicate worker及 10k atomic posting tests。

**Dependencies：** P5-T02、P0-T06～T07、P4 lock protocol。

**Files likely touched：** `InventoryOpeningWorker.js`、`InventoryOpeningService.js`、`server/config/scheduler.js`、Opening service/integration tests。

**Estimated scope：** M。

### P5-T04：完成 Opening／Go-Live API

**Description：** 建立 template/upload/jobs/detail/confirm/cancel/result及不可逆 Go-Live handlers/client，固定 management permission、auth strength、idempotency、polling projection及 no-store下載。

**Traceability：** Design §§5.8、6.1～6.4；FR-OPEN-001～007、SEC-004～005、010～013。

**Acceptance criteria：**

- [ ] Upload、confirm、cancel在 LIVE後拒絕；Confirm固定 device-password＋mgmt＋reason＋version，Cancel固定 password。
- [ ] Confirm對 stale precheck回 READY＋明確錯誤，不使用舊 snapshot；Go-Live只有對賬 gate後可執行且不可逆。
- [ ] Job/result response不暴露 server path/raw CSV；已清理 result回410但 job/Audit/Movement仍可查。

**Verification（納入 P5-GATE）：** handler/client schema/auth/idempotency、LIVE closure、stale precheck及 data leakage integration tests。

**Dependencies：** P5-T02～T03。

**Files likely touched：** `openingHandlers.js`、`client/src/services/inventory.js`、handler/client tests、`errorMessages.js`。

**Estimated scope：** M。

### P5-T05：完成 Opening UI

**Description：** 建立 PRE_GO_LIVE/LIVE頁、template、upload、bounded polling、row errors、Confirm摘要、result及 reconciliation指引；LIVE後移除寫入入口。

**Traceability：** Design §§7.1、7.7～7.8；FR-OPEN-001～007、AC-044～046。

**Acceptance criteria：**

- [ ] Upload不等於入帳；流程清楚分為 template→upload→precheck→errors→confirm→reconciliation。
- [ ] Confirm顯示 rows、quantity summary、短 hash及全有或全無警告；device password不保存在 component/global state。
- [ ] Polling有上限並在離頁取消；FAILED/STALE/410/LIVE均有可執行下一步，responsive/keyboard通過。

**Verification（納入 P5-GATE）：** `inventoryOpening.test.js`、client service tests、production build及 manual 10k/invalid/LIVE flows。

**Dependencies：** P5-T04。

**Files likely touched：** `OpeningPage.vue`、必要的小型 row-error component、page tests、`client/config/menu.js`。

**Estimated scope：** M。

### P5-T06：完成 Stock／Movement／Expiry／Reservation／Transfer 匯出

**Description：** 建立與畫面 filters一致的 keyset-streaming CSV exports、100k row/time上限、截斷標示、Base UOM/公司時區及 export Audit。

**Traceability：** Design §§5.9、7.2、10.6；FR-REPORT-001～008、SEC-009、SEC-011～012。

**Acceptance criteria：**

- [ ] 五類 export使用同一 inquiry語意及 stable columns，不載入全部2M Movement至記憶體。
- [ ] 所有危險公式前綴 neutralize；headers含 attachment/nosniff/no-store/private，無成本/路徑/認證/未定義預測值。
- [ ] 超 row/time上限明確標示截斷；每次 export Audit只保存 filter hash及 row count。

**Verification（納入 P5-GATE）：** CSV projection/formula、filter parity、stream memory、timeout/truncation及 permission tests。

**Dependencies：** P1-T09、P2-T05、P3-T04、P4-T05。

**Files likely touched：** `exportHandlers.js`、`InventoryInquiryService.js`、`client/src/services/inventory.js`、CSV/integration tests。

**Estimated scope：** M。

### P5-T07：完成 Receiving／Fulfillment／Returns contracts

**Description：** 以已存在的下游模組接上同 transaction Inventory methods；尚未存在的模組只交付 provider contract fixtures/tests，不建立虛構業務 tables或讓下游直接寫 Balance。

**Traceability：** Design §5.11、Requirement §12.3～12.5；FR-POST-001～012、SEC-007、BR-040、BR-043～045、AC-047～048。

**Acceptance criteria：**

- [ ] Receiving Receipt、Fulfillment Reservation/Allocation/Issue及 Returns Receipt/Issue使用固定 purpose/permission/source mapping。
- [ ] 來源寫入與 Inventory效果共用同一 MySQL transaction；任一側失敗另一側完整 rollback。
- [ ] 撤權／停用actor、dependency unavailable、low receipt life evidence不完整或Customer Return未使用`QUARANTINED`時全部fail closed。

**Verification（納入 P5-GATE）：** consumer contract、same-transaction rollback、permission revocation、retry/source conflict及 unavailable dependency tests。

**Dependencies：** P2-GATE、P3-GATE；已批准的`receiving.expiry.override` evidence與Customer Return `QUARANTINED` contract。

**Files likely touched：** `InventoryLookupService.js`、既有 consumer service（若已存在）、`inventoryContracts.integration.test.js`、consumer fixtures。

**Estimated scope：** M。

### P5-T08：完成 structured logs、營運查詢與 reconciliation runbook

**Description：** 加入 design指定 command/idempotency/lock/stocktake/opening/reconciliation事件與安全 context，實作只讀 reconciliation queries/runbook及異常告警輸入，不引入新監控產品或自動修數。

**Traceability：** Design §§11.2～11.6；FR-AUDIT-001～007、NFR-007～010、AC-050。

**Acceptance criteria：**

- [ ] Logs包含 request/correlation/operation/actor/auth/permission/outcome/duration等 allowlist欄位，source ID必要時 hash；無自由 payload/secret。
- [ ] 六項 reconciliation invariants均有 bounded read-only query及差異輸出；任何 mismatch不直接 UPDATE Balance。
- [ ] Transaction indeterminate、Opening failed/lease recovered、長時間 Bin lock及 reconciliation mismatch有明確營運訊號。

**Verification（納入 P5-GATE）：** logging redaction、reconciliation fixture、mismatch alert及 no-auto-fix tests；runbook人工演練。

**Dependencies：** P5-T03、P5-T06及 P0～P4所有 current/ledger tables。

**Files likely touched：** Inventory services logging hooks、reconciliation script/query、runbook、logging/reconciliation tests。

**Estimated scope：** M。

### P5-T09：完成容量、效能、backup／restore 及安全驗證

**Description：** 以設計容量資料集驗證常用查詢、混合寫入、10k Opening及2M Movement；對完整資料執行隔離 backup/restore/reconciliation及全 endpoint安全測試。

**Traceability：** Design §§10.5～10.7、12.4；NFR-001～014、SEC-001～014、AC-049～050。

**Acceptance criteria：**

- [ ] 5 Warehouses、1,000 Bins、100k SKUs、500k buckets、2M Movements、20 users下指定查詢 p95 <2秒；保存 p50/p95/p99與 EXPLAIN。
- [ ] 10k Opening precheck＋posting合計≤10分鐘；20-user mixed commands無非法 quantity，lock wait/error有記錄。
- [ ] 隔離 restore後六項 reconciliation為0差異；所有 endpoint通過 auth/owner/input/XSS/CSV/upload/redaction/ledger tamper安全矩陣。

**Verification（納入 P5-GATE）：** capacity harness、security suite、backup/restore rehearsal及 DBA/security人工 review。

**Dependencies：** P5-T01～T08；production-like test環境。

**Files likely touched：** capacity/security/restore test assets、必要 additive index migration、performance evidence文件。

**Estimated scope：** M（測試資料生成與執行可分工，但結果在同一 Phase Gate收斂）。

### P5-T10：完成部署、Smoke、文件與 Release Gate

**Description：** 凍結部署順序、permission assignment、Opening data freeze/confirm/Go-Live、rollback/forward-fix、app/migration DB account、smoke及 evidence清單；不在未簽核時執行正式 Go-Live。

**Traceability：** Design §§12.5～12.7、14；Requirement §§16～19、AC-050。

**Acceptance criteria：**

- [ ] Deployment runbook涵蓋 backup→migrations→backend→frontend→permissions→smoke→Opening→reconciliation→人工 sign-off→Go-Live。
- [ ] 已有 Movement後只允許 read-only/forward-fix，不以 drop/reset/直接 SQL改 ledger回滾；Go-Live不可一般回復。
- [ ] 保存 migration output、commit SHA、Phase test report、capacity、backup/restore、reconciliation、smoke及 sign-off，不保存 password或 CSV原文。

**Verification（納入 P5-GATE）：** staging deployment rehearsal、app account trigger test、完整 smoke及 Product/Warehouse/QA/Technical Lead sign-off。

**Dependencies：** P5-T01～T09及 §1.4全部 Go-Live inputs。

**Files likely touched：** deployment/reconciliation runbooks、README/API docs、release evidence template。

**Estimated scope：** M。

### P5-GATE：最終完整測試與 PR

**一次完整測試：** 執行 §5.6。這是 P5 PR及整個 Inventory Management的正式 release verification；若 target在 review期間移動，整合最新 main後整套重跑。

**Merge acceptance：**

- [ ] AC-001～050、FR/BR/SEC/NFR追溯全通過，沒有 skipped/not-run必測項。
- [ ] Opening 10k、2M Movement、20-user concurrency、backup/restore/reconciliation及安全矩陣全部有證據。
- [ ] 所有 §1.4 Go-Live inputs與人工 sign-off齊備；一個 P5 PR經 code/security/DB/QA review後才可合併。

---

## 4. Phase Checkpoint 與審查規則

Phase 內每完成2～3項 Tasks做一次只讀 code review checkpoint。Checkpoint不等同正式測試輪次，不建立額外 PR；目的是在錯誤 contract擴散前修正。

| Checkpoint | Tasks | Review gate |
| --- | --- | --- |
| P0-A | P0-T01～T03 | Migration、framework idempotency、permission/config基線 |
| P0-B | P0-T04～T07 | Item contract、operation/Audit/lock protocol |
| P1-A | P1-T01～T04 | Master schema/service/API/UI |
| P1-B | P1-T05～T08 | Stock schema、rules、Receipt及下游 transaction contract |
| P1-C | P1-T09～T11 | Inquiry/UI、concurrency、capacity |
| P2-A | P2-T01～T03 | Reservation schema/ATP/FEFO |
| P2-B | P2-T04～T07 | Issue consume、contracts/UI/concurrency |
| P3-A | P3-T01～T04 | Transfer完整切片 |
| P3-B | P3-T05～T07 | Move/Adjustment/Status/Reversal invariants |
| P3-C | P3-T08～T09 | UI、安全、並發與對賬 |
| P4-A | P4-T01～T03 | Persistent lock、snapshot、count |
| P4-B | P4-T04～T07 | Post/cancel、API/UI、全入口 lock coverage |
| P5-A | P5-T01～T03 | Opening persistence/parser/fenced worker |
| P5-B | P5-T04～T07 | Opening UI、exports、downstream contracts |
| P5-C | P5-T08～T10 | Observability、capacity/recovery、release |

每個 checkpoint至少確認：

- [ ] Task acceptance criteria與設計不變量一致，沒有因方便實作而降低 no-negative、atomicity、idempotency或 auth strength。
- [ ] Shared hotspot沒有平行衝突或第二套 constants/validation；跨 Task interface已由 contract test鎖定。
- [ ] Diff只含本 Phase，沒有提前塞入下一 Phase未完成入口或無法驗證的 speculative abstraction。

---

## 5. 每個 Phase 的一次完整測試

所有命令均在該 Phase獨立 worktree執行。Integration tests只可使用與CI及production相同major版本的專用 MySQL 8.0測試 DB及專案既有安全 guard。命令若因實作後 test file名稱調整，可更新精確路徑，但不可縮小覆蓋範圍。

### 5.1 P0 Foundation test cycle

```bash
npm run lint
npm test --workspace server -- test/idempotencyService.test.js test/permissionCatalogueConventions.test.js test/permissionCatalogueStartupGuard.test.js test/itemLookupService.test.js test/inventoryOperationHash.test.js test/inventoryOperationService.test.js test/inventoryAuditService.test.js test/inventoryLockService.test.js
DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/inventoryMigrations.integration.test.js test/integration/inventoryItemContract.integration.test.js
npm run test:coverage --workspace server
npm run security:audit
```

### 5.2 P1 Core Stock test cycle

```bash
npm run lint
npm test --workspace server -- test/inventoryMasterService.test.js test/inventoryPostingService.test.js test/inventoryQuantity.test.js test/inventoryExpiry.test.js test/inventoryValidation.test.js test/inventoryProjections.test.js
DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/inventoryMigrations.integration.test.js test/integration/inventoryMaster.integration.test.js test/integration/inventoryStock.integration.test.js test/integration/inventoryPosting.integration.test.js test/integration/inventoryContracts.integration.test.js
npm test --workspace client -- test/services/inventory.test.js test/pages/inventory/inventoryWarehouses.test.js test/pages/inventory/inventoryStocks.test.js test/pages/inventory/inventoryMovements.test.js
npm run test:coverage
npm run build --workspace client
npm run security:audit
```

### 5.3 P2 Reservation test cycle

```bash
npm run lint
npm test --workspace server -- test/inventoryReservationService.test.js test/inventoryFefo.test.js test/inventoryPostingService.test.js
DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/inventoryReservation.integration.test.js test/integration/inventoryPosting.integration.test.js test/integration/inventoryContracts.integration.test.js
npm test --workspace client -- test/services/inventory.test.js test/pages/inventory/inventoryReservations.test.js
npm run test:coverage
npm run build --workspace client
npm run security:audit
```

### 5.4 P3 Warehouse Operations test cycle

```bash
npm run lint
npm test --workspace server -- test/inventoryTransferService.test.js test/inventoryPostingService.test.js test/inventoryStateMachines.test.js
DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/inventoryMovement.integration.test.js test/integration/inventoryTransfer.integration.test.js test/integration/inventoryPosting.integration.test.js test/integration/inventoryReservation.integration.test.js
npm test --workspace client -- test/services/inventory.test.js test/pages/inventory/inventoryTransfers.test.js test/pages/inventory/inventoryMovements.test.js test/pages/inventory/inventoryAdjustments.test.js
npm run test:coverage
npm run build --workspace client
npm run security:audit
```

### 5.5 P4 Stocktake test cycle

```bash
npm run lint
npm test --workspace server -- test/inventoryStocktakeService.test.js test/inventoryPostingService.test.js
DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/inventoryMigrations.integration.test.js test/integration/inventoryStocktake.integration.test.js test/integration/inventoryPosting.integration.test.js test/integration/inventoryTransfer.integration.test.js
npm test --workspace client -- test/services/inventory.test.js test/pages/inventory/inventoryStocktakes.test.js
npm run test:coverage
npm run build --workspace client
npm run security:audit
```

### 5.6 P5 Final test cycle

```bash
npm run lint
npm test
DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/inventoryMigrations.integration.test.js test/integration/inventoryMaster.integration.test.js test/integration/inventoryStock.integration.test.js test/integration/inventoryPosting.integration.test.js test/integration/inventoryReservation.integration.test.js test/integration/inventoryMovement.integration.test.js test/integration/inventoryTransfer.integration.test.js test/integration/inventoryStocktake.integration.test.js test/integration/inventoryOpening.integration.test.js test/integration/inventoryContracts.integration.test.js
npm run test:coverage
npm run build --workspace client
npm run security:audit
```

P5另須執行非一般 unit command可取代的受控驗證：

- [ ] 2M Movement／500k Bucket／100k SKU capacity run及 EXPLAIN。
- [ ] 20-user混合寫入與所有指定 concurrency barriers。
- [ ] 10,000-row Opening precheck＋posting，合計不超過10分鐘。
- [ ] 隔離 backup→restore→六項 reconciliation全部差異0。
- [ ] Staging完整 smoke、DB least privilege／immutable trigger及 Go-Live rehearsal。

---

## 6. 需求追溯到 Phase

| Requirement group | Primary Phase | Final verification |
| --- | --- | --- |
| `OBJ-01～08`、`KPI-01～09` | P0～P5按成果 | 各 Phase demo＋P5容量／安全／對賬 evidence |
| `INV-CAP-01～07` | P1 Master/Stock、P0/P1 Ledger、P2 Reservation、P3 Move、P4 Stocktake、P5 Integration | 對應 Phase Gate |
| `FR-MASTER-001～010` | P1 | P1-GATE＋P5 regression |
| `FR-STOCK-001～010`、`FR-LOT-001～010` | P1 | P1-GATE、P5 capacity |
| `FR-POST-001～012` | P0/P1 Receipt；P2 Issue；P3 Reversal | P1/P2/P3 gates＋P5 contracts |
| `FR-RES-001～010`、`FR-ALLOC-001～010` | P2 | P2-GATE＋P5 regression |
| `FR-MOVE-001～007`、`FR-TRANSFER-001～012` | P3 | P3-GATE＋P5 reconciliation |
| `FR-ADJUST-001～010` | P3，Stocktake variance於P4 | P3/P4 gates |
| `FR-COUNT-001～012` | P4 | P4-GATE＋P5 regression |
| `FR-OPEN-001～007` | P5 | P5-GATE |
| `FR-REPORT-001～008` | P1 inquiry＋P5 export | P5-GATE |
| `FR-AUDIT-001～007` | P0 foundation；每 Phase持續 | 每個 Phase Gate＋P5 retention/recovery |
| `BR-001～045` | P0～P5依功能 | 對應 Phase Gates＋P5 reconciliation |
| `SEC-001～014` | P0基線；每 Phase endpoint | 每個 Phase Gate＋P5完整安全矩陣 |
| `NFR-001～014` | 每 Phase；容量/復原集中P5 | P5-GATE |
| `AC-001～016` | P1；AC-016 Issue rollback在P2補齊 | P1/P2 gates |
| `AC-017`、`AC-019～021`、`AC-023～027` | P2 | P2-GATE |
| `AC-018`、`AC-022`、`AC-028～039` | P3 | P3-GATE |
| `AC-040～043` | P4 | P4-GATE |
| `AC-044～050` | P5 | P5-GATE |
| `DEC-001～020` | 全局設計約束 | 每個 code review checkpoint |

---

## 7. 主要風險與緩解

| 風險 | 影響 | 緩解／阻擋點 |
| --- | --- | --- |
| Item lifecycle／lookup尚未完成 | Inventory重複或猜錯 SKU資格 | P0-T01硬 gate；只依賴 Item module唯一 contract |
| Migration與多個模組 worktree碰撞 | DDL無法安全合併或破壞歷史 | 每 Phase起點 fetch＋重新分配；不預先硬編號、不修改已套用 migration |
| Phase PR過大 | Review遺漏或整合延遲 | Tasks維持 S/M、每2～3項 checkpoint、shared hotspot單一 owner、Phase結果單一 |
| 同 Warehouse/SKU並發超額 | 負庫存或超 Reserved/Allocation | Warehouse＋Stock Control serialization、fixed lock order、真並發 barrier tests |
| HTTP重試或下游事件重送 | 重複入出庫 | P0先修 actor scope；HTTP與domain兩層 idempotency；source result lookup |
| Stocktake只在記憶體鎖定 | restart後錯誤異動或重複盤點 | DB persistent active slot、owner composite FK、全入口 parameterized coverage |
| Opening worker lease失效後舊 worker仍提交 | 重複 Opening或半套資料 | heartbeat＋generation fencing＋final update同 business transaction |
| Movement查詢隨資料增長退化 | 日常操作不可用 | filter-aligned indexes、server pagination、P1基線與P5 2M Movement gate |
| Audit或log洩漏敏感資料 | 安全／稽核風險 | projection allowlist、redaction、安全 failure Audit、每 Phase security tests |
| Go-Live後需要回復 Opening | 破壞 ledger及對賬 | 不可逆 control、事前 backup/rehearsal/sign-off；錯誤走 Reversal/Adjustment/forward-fix |

---

## 8. 尚待確認但已有明確阻擋點

以下不是讓實作者自行猜測的 open-ended工作；各項已有明確最晚決策點：

| 輸入 | 最晚確認／證據點 | 決策／未備妥時行為 |
| --- | --- | --- |
| Receiving low-life override permission/evidence | 已確認；P1-T07實作 | 固定`receiving.expiry.override`及逐筆evidence；Expired不可Override |
| Returns預設 Stock Status | 已確認；P5-T07實作 | 固定`QUARANTINED`；品質檢查後才可Status Transfer |
| Adjustment Reason Categories | 已確認；P3-T06實作／review | 固定七項allowlist；`OTHER`須詳細說明 |
| Active Serial SKU處置 | 已確認；P0-T01實作，P5提供資料證據 | Posting fail closed；存在Active serial資料時禁止Go-Live |
| Production DB帳號分離 | 政策已確認；P5-T09提供配置／演練證據 | 未分離或未完成backup／restore rehearsal時Release blocked |
| Warehouse/Bin/Opening資料與簽核人 | 責任已確認；P5-T10提供實際資料／時間 | Warehouse／Operations Lead對賬、Sam簽核；資料未齊不執行Opening／Go-Live |

---

## 9. 計劃批准與模式邊界

- [x] Product Owner Sam確認6個Phase的業務結果與P0→P5順序。
- [x] 獨立人工評審人Sam批准目前transaction、lock、migration、PR邊界、Phase測試／evidence範圍，以及high-risk auth、immutable ledger、least privilege、Opening fencing與backup／restore gates。
- [x] Sam批准目前Design及Plan baseline；批准記錄須綁定當次重新計算的hash。
- [ ] 明確`IMPLEMENT`模式授權；Sam已指示本輪只提交文件，先不要進入IMPLEMENT。
- [ ] 收到後續`IMPLEMENT`授權並刷新`origin/main`後，才建立P0 worktree並開始實作；目前所有Task保持`PENDING`。

<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal Phase and Task Definitions

Legacy `P*` and `P*-T*` identities are retained as aliases. Every item remains planned and unstarted.

## PHASE-001 — Integration Foundation (legacy P0)

### Outcome
Deliver the reviewed `P0` outcome described in the legacy plan without weakening Inventory quantity, audit, authorization or recovery invariants.

### Entry criteria
The preceding Phase gate (if any), current design/plan approval, fresh default baseline, isolated worktree and required human decisions for this scope are confirmed.

### Acceptance criteria
All included Tasks meet their acceptance criteria and the complete Phase test cycle has current evidence with no unaccepted critical/high finding.

### Integration and regression
Run the observed project lint, build and technical suites plus affected Item, authorization, database and downstream contract regression.

### Git and merge plan
Use the default-baseline strategy and merge group `inventory-p0`; dependencies: none.

### Rollback
Revert the Phase change set while preserving immutable production history; schema/data rollback requires a separately reviewed migration and recovery plan.

### Exit criteria
The Phase PR has current mandatory CI and actual required review, and merge occurs only under the approved plan.

## PHASE-002 — Core Stock (legacy P1)

### Outcome
Deliver the reviewed `P1` outcome described in the legacy plan without weakening Inventory quantity, audit, authorization or recovery invariants.

### Entry criteria
The preceding Phase gate (if any), current design/plan approval, fresh default baseline, isolated worktree and required human decisions for this scope are confirmed.

### Acceptance criteria
All included Tasks meet their acceptance criteria and the complete Phase test cycle has current evidence with no unaccepted critical/high finding.

### Integration and regression
Run the observed project lint, build and technical suites plus affected Item, authorization, database and downstream contract regression.

### Git and merge plan
Use the default-baseline strategy and merge group `inventory-p1`; dependencies: PHASE-001.

### Rollback
Revert the Phase change set while preserving immutable production history; schema/data rollback requires a separately reviewed migration and recovery plan.

### Exit criteria
The Phase PR has current mandatory CI and actual required review, and merge occurs only under the approved plan.

## PHASE-003 — Reservation and Allocation (legacy P2)

### Outcome
Deliver the reviewed `P2` outcome described in the legacy plan without weakening Inventory quantity, audit, authorization or recovery invariants.

### Entry criteria
The preceding Phase gate (if any), current design/plan approval, fresh default baseline, isolated worktree and required human decisions for this scope are confirmed.

### Acceptance criteria
All included Tasks meet their acceptance criteria and the complete Phase test cycle has current evidence with no unaccepted critical/high finding.

### Integration and regression
Run the observed project lint, build and technical suites plus affected Item, authorization, database and downstream contract regression.

### Git and merge plan
Use the default-baseline strategy and merge group `inventory-p2`; dependencies: PHASE-002.

### Rollback
Revert the Phase change set while preserving immutable production history; schema/data rollback requires a separately reviewed migration and recovery plan.

### Exit criteria
The Phase PR has current mandatory CI and actual required review, and merge occurs only under the approved plan.

## PHASE-004 — Warehouse Operations (legacy P3)

### Outcome
Deliver the reviewed `P3` outcome described in the legacy plan without weakening Inventory quantity, audit, authorization or recovery invariants.

### Entry criteria
The preceding Phase gate (if any), current design/plan approval, fresh default baseline, isolated worktree and required human decisions for this scope are confirmed.

### Acceptance criteria
All included Tasks meet their acceptance criteria and the complete Phase test cycle has current evidence with no unaccepted critical/high finding.

### Integration and regression
Run the observed project lint, build and technical suites plus affected Item, authorization, database and downstream contract regression.

### Git and merge plan
Use the default-baseline strategy and merge group `inventory-p3`; dependencies: PHASE-003.

### Rollback
Revert the Phase change set while preserving immutable production history; schema/data rollback requires a separately reviewed migration and recovery plan.

### Exit criteria
The Phase PR has current mandatory CI and actual required review, and merge occurs only under the approved plan.

## PHASE-005 — Stocktake (legacy P4)

### Outcome
Deliver the reviewed `P4` outcome described in the legacy plan without weakening Inventory quantity, audit, authorization or recovery invariants.

### Entry criteria
The preceding Phase gate (if any), current design/plan approval, fresh default baseline, isolated worktree and required human decisions for this scope are confirmed.

### Acceptance criteria
All included Tasks meet their acceptance criteria and the complete Phase test cycle has current evidence with no unaccepted critical/high finding.

### Integration and regression
Run the observed project lint, build and technical suites plus affected Item, authorization, database and downstream contract regression.

### Git and merge plan
Use the default-baseline strategy and merge group `inventory-p4`; dependencies: PHASE-004.

### Rollback
Revert the Phase change set while preserving immutable production history; schema/data rollback requires a separately reviewed migration and recovery plan.

### Exit criteria
The Phase PR has current mandatory CI and actual required review, and merge occurs only under the approved plan.

## PHASE-006 — Opening, Reporting and Release (legacy P5)

### Outcome
Deliver the reviewed `P5` outcome described in the legacy plan without weakening Inventory quantity, audit, authorization or recovery invariants.

### Entry criteria
The preceding Phase gate (if any), current design/plan approval, fresh default baseline, isolated worktree and required human decisions for this scope are confirmed.

### Acceptance criteria
All included Tasks meet their acceptance criteria and the complete Phase test cycle has current evidence with no unaccepted critical/high finding.

### Integration and regression
Run the observed project lint, build and technical suites plus affected Item, authorization, database and downstream contract regression.

### Git and merge plan
Use the default-baseline strategy and merge group `inventory-p5`; dependencies: PHASE-005.

### Rollback
Revert the Phase change set while preserving immutable production history; schema/data rollback requires a separately reviewed migration and recovery plan.

### Exit criteria
The Phase PR has current mandatory CI and actual required review, and merge occurs only under the approved plan.

## TASK-001 — 凍結 migration 編號與前置 contract (legacy P0-T01)

### Goal
Fetch 最新 main，盤點實際 migration 與 Item/Supplier/Customer 尚未合併的配額；確認 Item T18～T22 及 Inventory serial fail-closed 前置，產出本 Phase 使用的實際 migration allocation，不修改既有檔案

### Approach
Implement only the scope and dependencies of legacy task `P0-T01` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 每個既有 migration 四位前綴唯一，已套用檔名、內容與 checksum 不變。
- Inventory logical migrations 有明確實際編號及 FK 順序；與其他模組已存在或已批准配額沒有碰撞。
- Item lifecycle／lookup contract 已合併；未完成時 P0 停在此 Task，不在 Inventory 複製 SKU 規則。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-002 — 修正強認證 Idempotency actor scope (legacy P0-T02)

### Goal
修正 framework idempotency identity，使 jwt、jwt-password、jwt-device-password 及其他具有可信 claims.sub 的 authenticated request 以 actor scope 隔離；只有 public request 使用 IP scope

### Approach
Implement only the scope and dependencies of legacy task `P0-T02` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 同 IP 的不同 authenticated actors 使用相同 key 不會互相 replay。
- 同 actor 的強認證 route 仍可同 payload replay，異 payload 回固定 conflict。
- Public route 行為及既有 idempotency tests 無回歸，identity 不以未驗證 body/header 決定。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-003 — 建立 Inventory 權限、設定、常數與公開錯誤 (legacy P0-T03)

### Goal
建立五項 Inventory permissions、冪等 seed、typed config normalizer、固定狀態／數量／source／reason allowlists及 stable public errors；不得把負庫存、部分 Transfer 或自訂 Stock Status 變成可切換 flag

### Approach
Implement only the scope and dependencies of legacy task `P0-T03` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Catalogue 與 seed 精確包含 `inventory.view`、`inventory.operation`、`inventory.mgmt`、`inventory.adjust`、`inventory.fefo.override`，互不繼承。
- Config 對 page/quantity/export/opening/lease/retention 範圍 fail closed，lease renew interval 必須小於 lease 一半。
- 所有錯誤、status、command type、Audit action 只取 server allowlist；client 有繁中安全訊息。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-004 — 驗證並完成 ItemLookup transaction contract (legacy P0-T04)

### Goal
沿用 Item Management 的唯一 ItemLookupService，補足 Inventory 在現有 transaction 中讀取 SKU eligibility、Base UOM conversion、Tracking Policy、Shelf Life 與 minimum life 的方法；不要求下游 actor 持有 item.view，也不在 Inventory 重寫 Item 狀態矩陣

### Approach
Implement only the scope and dependencies of legacy task `P0-T04` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- `purchase`、`sale`、`inventory` purpose 與 Item design 一致；Inactive／Discontinued／Archived／Serial 分支有 contract tests。
- Lookup 接受 caller 提供的 transaction executor，查詢 Base UOM 及有效整數 factor，不暗中另開 transaction。
- Lookup 只回白名單 projection，不讀 HTTP claims、不洩漏 Item 管理資料；批量方法避免 N+1。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-005 — 建立 Domain Operation 與 Audit persistence (legacy P0-T05)

### Goal
建立 domain operation request 及 Inventory Audit tables、source tuple unique key、必要 indexes、actor/source snapshots與 immutable triggers；domain operation history 不使用短期 HTTP idempotency TTL 清除

### Approach
Implement only the scope and dependencies of legacy task `P0-T05` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Source unique key 精確為 module＋document type＋document ID＋line ID＋event ID，不含 command type，空 line 使用 `''`。
- Audit 支援 `SUCCEEDED`、`REJECTED`、`FAILED`，只保存白名單摘要；Movement/Audit retention 至少 7 年。
- 一般 app account 或 application SQL 無法 UPDATE／DELETE Audit；FK、indexes、SET NULL／RESTRICT 行為符合設計。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-006 — 完成 Operation／Audit services 與不可變保護 (legacy P0-T06)

### Goal
實作 canonical payload hash、atomic domain claim、result replay／source lookup、safe success/reject/failure Audit，並確保必要 Audit 失敗會令 business transaction rollback

### Approach
Implement only the scope and dependencies of legacy task `P0-T06` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 同 tuple＋同 hash 回原結果；同 tuple＋不同 hash 回 `INVENTORY_SOURCE_CONFLICT`；並發只有一個 winner。
- Password／token 不進 hash、result、log 或 Audit；business fields 變化必定改變 hash。
- Success Audit 與效果同 transaction；rollback 後的 reject/failure Audit 不會冒充已完成數量效果。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-007 — 建立固定鎖協議、internal command context 與 test support (legacy P0-T07)

### Goal
建立所有後續寫入必須共用的 Warehouse → Stock Control → Bin/semantic lock → Lot → Balance → workflow root 固定鎖 helper、transaction-required internal command context，以及可注入故障與並發 barrier 的測試支援

### Approach
Implement only the scope and dependencies of legacy task `P0-T07` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Helper 對輸入 IDs 先去重排序，禁止逆序取鎖；不存在的 control/balance 使用 upsert 後 `FOR UPDATE`。
- Internal write 沒有 transaction executor 時立即失敗，不會私取 pool connection或 nested transaction。
- Test support 可在 operation、current state、Movement、Audit 與 commit 邊界注入失敗，並可用兩條真 connection 同步競爭。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-008 — 建立 Warehouse／Bin persistence (legacy P1-T01)

### Goal
建立 Warehouse、Bin tables、normalized unique keys、ownership candidate key、version、status、actor FK與查詢 indexes

### Approach
Implement only the scope and dependencies of legacy task `P1-T01` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Warehouse Code 全公司 case-insensitive unique；Bin Code 只在 Warehouse 內 unique。
- `(bin_id,warehouse_id)` ownership 可由後續 composite FK 強制；actor delete 使用 SET NULL，業務引用使用 RESTRICT。
- Migration 可在 fresh／existing DB 安全套用及 rerun，不依賴 DDL transaction rollback。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-009 — 完成 Warehouse／Bin domain service (legacy P1-T02)

### Goal
實作列表、詳情、建立、更新、停用、恢復與受控刪除，所有狀態變更使用 version、fresh permission、Warehouse row lock、reference guard及 Audit

### Approach
Implement only the scope and dependencies of legacy task `P1-T02` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Inactive Warehouse 不可新增／恢復 Bin；停用在 transaction 內重驗所有 current blockers。
- Current blockers 清除後可停用；只有歷史 Movement 阻擋永久刪除，不錯誤阻擋停用。
- Warehouse deactivate 與同時 posting 共用 Warehouse row lock，兩種先後都不留下 Inactive＋新庫存競態。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-010 — 完成 Warehouse／Bin API 與 client contract (legacy P1-T03)

### Goal
建立 §5.2 全部 strict handlers及 client methods，固定 auth strength、permissions、idempotency、version、reason與安全公開錯誤

### Approach
Implement only the scope and dependencies of legacy task `P1-T03` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- GET／create／update／deactivate／reactivate／delete route metadata與 design 完全一致。
- Child Bin 以 Warehouse＋Bin 一起查找；跨 owner 與不存在回相同安全 404。
- Client 不自動重送 version conflict，所有 POST 傳遞 Idempotency-Key，錯誤有繁中映射。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-011 — 完成 Warehouse／Bin 管理頁 (legacy P1-T04)

### Goal
依 frontend design 建立主從式 Warehouse／Bin 管理頁，支援列表、表單、版本衝突、阻擋摘要及高風險確認；mobile 使用逐頁選擇

### Approach
Implement only the scope and dependencies of legacy task `P1-T04` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 使用 `PageHeader`、`DataTable`、`FormPanel` 與既有 confirm helpers，不新增平行 UI framework。
- Action 依 permission 顯示，但後端仍獨立驗證；409 保留輸入並提示 reload。
- Loading、empty、forbidden、blocked及 375px keyboard flow均可驗收。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-012 — 建立 Lot、Stock Control、Balance 與 Movement persistence (legacy P1-T05)

### Goal
建立 current quantity tables與 immutable Movement ledger，包含 no-lot unique scope、SKU/Lot/Bin ownership composite FK、query indexes及 UPDATE/DELETE triggers

### Approach
Implement only the scope and dependencies of legacy task `P1-T05` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Balance 唯一表示 Warehouse＋Bin＋SKU＋Lot/No Lot＋Status；MySQL NULL 不可繞過 no-lot unique。
- Lot 必屬 SKU、Bin 必屬 Warehouse；Movement 保存 source、actor及必要 master snapshots。
- Movement 的 warehouse／SKU／Bin／Lot／actor／type/date及 group/source 查詢均有相符 index，且一般 app 無法修改或刪除。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-013 — 完成 quantity、expiry、lot 與 projection 純規則 (legacy P1-T06)

### Goal
建立 Base UOM safe integer、UOM conversion、Tracking Policy、Lot consistency、APPTIMEZONE expiry／minimum life、Stock Status及 response projection規則

### Approach
Implement only the scope and dependencies of legacy task `P1-T06` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Decimal、0、負數、overflow及非整數 factor全部拒絕；Pack 轉換不產生小數 Base UOM。
- Expiry 等於今日仍有效，翌日才 Expired；`none`／`batch`／`batch_expiry`／`serial`規則準確。
- Projection 明確分開 On Hand、free、Reserved、ATP、Quarantined、Damaged與 In Transit，不 spread DB row。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-014 — 完成 Receipt 原子過帳 (legacy P1-T07)

### Goal
實作 HTTP／internal Receipt，共用 operation claim、SKU purpose、Warehouse/Bin/Stock Control/Lot/Balance固定鎖、current update、Movement與 Audit transaction

### Approach
Implement only the scope and dependencies of legacy task `P1-T07` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 正確處理 Base／Pack UOM、三種人工 Status、Lot/Expiry與 minimum receipt life evidence。
- 相同 source replay 不重複；同 source 異內容衝突；任何注入失敗均無半套 Lot／Balance／Movement／Audit。
- Inactive/Archived/not tracked/Serial SKU、Inactive Warehouse/Bin、Lot conflict及無效 override皆 fail closed。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-015 — 完成 Receipt 下游同步入口與故障邊界 (legacy P1-T08)

### Goal
把 Receipt 以 transaction-required internal contract提供給 Receiving／Returns，驗證 caller source write與 Inventory效果共用同一 MySQL transaction；Issue route及成功路徑明確保持未註冊，直到 P2具備 Reservation／Allocation

### Approach
Implement only the scope and dependencies of legacy task `P1-T08` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Internal Receipt沒有 transaction executor時立即失敗；caller source write失敗會連同 Inventory rollback，反向亦然。
- Provider固定 Receiving／Returns purpose與 caller permission mapping，不接受 caller自由傳入 permission名稱。
- `/inventory/issues`不註冊或固定 fail closed；不得提供不消耗 Reservation／Allocation的臨時 Issue捷徑。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-016 — 完成 Stock／Lot／Movement 查詢 API (legacy P1-T09)

### Goal
實作 server-side paginated inquiry、SKU aggregate、bucket drill-down、Lot/expiry及 Movement/source/group detail；所有 filters/sorts使用 allowlist及相符 index

### Approach
Implement only the scope and dependencies of legacy task `P1-T09` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- SKU Code／Barcode exact搜尋優先，name partial安全 escape；列表以 `id` stable tie-breaker。
- 查詢即時使用 current Balance/Control及 expiry規則，不依賴人工重建 cache。
- Movement可按日期/type/source/SKU/Warehouse/Bin/Lot/actor查詢，結果只回白名單快照與安全 source link。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-017 — 完成 Stock／Lot／Movement UI (legacy P1-T10)

### Goal
建立庫存總覽、批次與效期、Movement頁面，提供 URL filters、server pagination、aggregate到bucket drill-down及source/reversal關聯顯示

### Approach
Implement only the scope and dependencies of legacy task `P1-T10` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 數量欄不可混成單一 quantity；Expired／low-life／Status具文字及 icon，不只靠顏色。
- URL可還原 filters/page/sort且不含敏感資料；stale request可取消。
- 375/768/1024/1440px、keyboard、loading/empty/error/retry及 `inventory.view` route guard通過。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-018 — 完成 Core Stock 整合、並發與效能驗收 (legacy P1-T11)

### Goal
收斂 AC-001～015及 AC-016的 Receipt路徑，補足 Warehouse deactivate/posting、Receipt source duplicate、rollback、權限與核心查詢容量測試，不新增業務功能

### Approach
Implement only the scope and dependencies of legacy task `P1-T11` inside `PHASE-002` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 兩條 connection 競爭同 Receipt source/bucket時不重複 Movement；deadlock/timeout轉 stable conflict且零半套資料。
- 每個 Core endpoint通過 401/403/stale actor/owner mismatch/strict schema及敏感資料檢查。
- 需求容量下 exact SKU/Barcode、stock summary、bucket drill-down及 Movement common filters p95 < 2 秒並保存 EXPLAIN。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-019 — 建立 Reservation／Allocation persistence (legacy P2-T01)

### Goal
建立 Reservation、Allocation tables、quantity breakdown、purpose/minimum-life snapshot、status/version、operation/source及 Balance關聯 indexes/FKs

### Approach
Implement only the scope and dependencies of legacy task `P2-T01` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Reservation 保存 original/consumed/released/outstanding；Allocation保存 allocated/consumed/released/outstanding，所有欄位使用 unsigned Base UOM integer。
- Create operation、Warehouse、SKU、Reservation、Balance及 actor FK delete rules符合歷史保留要求。
- Warehouse＋SKU＋status與 Reservation＋Balance 查詢有穩定 index；MySQL 8.0 CHECK只作row-local第二層保護，不取代service的跨row invariant。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-020 — 完成 ATP 與 Reservation state service (legacy P2-T02)

### Goal
實作 purpose-aware eligible On Hand、Reserved、raw ATP、ATP/uncovered計算，以及 create、partial release、cancel與 state/version transition；所有改量先鎖 Warehouse＋Stock Control

### Approach
Implement only the scope and dependencies of legacy task `P2-T02` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 建立 Reservation 全有或全無，只有 raw ATP 足夠才成功；Expired／low-life／Quarantined／Damaged不合資格。
- 每次 state change保持 `original = consumed + released + outstanding`，terminal state不可被 stale event復活。
- 日期跨日造成 uncovered時不自動刪除 Reservation，但禁止新超額 Reservation並回明確數量。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-021 — 完成 FEFO candidate 與 Allocation service (legacy P2-T03)

### Goal
實作有 expiry／無 expiry／無 lot的穩定 FEFO排序、跨多 Bucket candidate selection、Allocation create及受權限控制的 FEFO override

### Approach
Implement only the scope and dependencies of legacy task `P2-T03` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Candidate排序精確依 expiry/first receipt、lot、bin、balance ID，並只回 eligible free quantity與 version。
- Allocation不扣 On Hand；總 outstanding不超過 Reservation，單 Bucket outstanding不超過 On Hand。
- 偏離建議只有 `inventory.fefo.override`＋5～500字原因可通過，仍不可選過期、低效期、非 AVAILABLE、Inactive/locked Bin或不足 Bucket。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-022 — 完成 Release／Cancel／Reallocate 與 Issue consume 整合 (legacy P2-T04)

### Goal
補齊 Allocation release/reallocate，並首次啟用只可消耗匹配 Allocation的 Issue，同步扣 On Hand/allocated/reserved與 Reservation/Allocation outstanding的單一 transaction

### Approach
Implement only the scope and dependencies of legacy task `P2-T04` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Reallocate在同一 transaction釋放舊分配並建立新分配，中途失敗保留原狀態。
- Issue逐行鎖定並只消耗相同 Reservation/Allocation/Balance；任何 mismatch、不合資格或不足令整批 rollback。
- Issue完成後四組 current quantities、Movement、operation及 Audit一致；Reverse Issue不復活已耗用 Reservation/Allocation。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-023 — 完成 Reservation／Allocation API 與 internal contracts (legacy P2-T05)

### Goal
建立 §5.5 全部查詢／command handlers、client methods及 Sales/Fulfillment transaction-aware service entry points；provider固定 caller permission/purpose mapping，不接受 caller自報權限名稱

### Approach
Implement only the scope and dependencies of legacy task `P2-T05` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Create/release/cancel/candidates/allocate/release allocation/reallocate route具有 strict schema、version、source及 idempotency。
- FEFO candidates query不改資料；所有 command共用既有 caller transaction且提交點重讀 actor permission。
- 下游角色不因呼叫 Inventory capability取得 `inventory.view`或管理頁權限。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-024 — 完成 Reservation／Allocation UI (legacy P2-T06)

### Goal
建立 Reservation列表／詳情、quantity breakdown、Allocation drawer、FEFO候選、override提示與 conflict reload flow；前端不重算可信 ATP或 FEFO rank

### Approach
Implement only the scope and dependencies of legacy task `P2-T06` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Original/Consumed/Released/Outstanding及 source清楚分列；uncovered有文字下一步。
- 具 override權限才顯示原因操作；無論 UI顯示與否，後端拒絕仍能安全呈現。
- 409時保留使用者輸入但強制重載 candidates，不自動改選另一 Lot；keyboard/mobile flow可完成。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-025 — 完成真並發、FEFO、安全及端到端驗收 (legacy P2-T07)

### Goal
補足 Reservation/Allocation/Issue在真 MySQL的並發、時間流逝、權限撤銷、FEFO override及多 Bucket端到端驗證，不增加新功能；需要 Bin Move的 AC-022留待 P3

### Approach
Implement only the scope and dependencies of legacy task `P2-T07` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- ATP 10並發 Reservation 7＋7最多一個成功；Reserved及 Reservation SUM一致。
- 同 Bucket Allocation／Issue／release競爭不超額、不負數、不 lost update；失敗方回 stable conflict。
- Normal、override、expired、low-life、status、Inactive Bin、跨 owner及撤權情境均有真 API＋DB證據。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-026 — 建立 Transfer persistence 與 state rules (legacy P3-T01)

### Goal
建立 Transfer header/line tables、operation IDs、source/destination ownership、In Transit current quantity、versions及 state machine純規則

### Approach
Implement only the scope and dependencies of legacy task `P3-T01` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Draft/In Transit/Received/Cancelled狀態與合法 transition固定；source與 destination Warehouse不同。
- Line保存 SKU/Lot/source Bin、完整 quantity及 dispatch snapshots；header/line/source/destination indexes完整。
- Partial dispatch/receive、In Transit edit/cancel在純規則層明確拒絕。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-027 — 完成 Draft Transfer domain 與查詢 (legacy P3-T02)

### Goal
實作 Draft建立、完整 replace lines、取消、列表及詳情；Draft不改 On Hand、Reserved或 In Transit

### Approach
Implement only the scope and dependencies of legacy task `P3-T02` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 建立／更新驗證兩個 Active Warehouses、SKU/Lot/source Bin ownership、positive quantity及 version。
- Replace lines全有或全無；cancel只限 Draft且保存 actor/time/reason/Audit。
- 查詢明確顯示 header/line versions與四種狀態，跨 owner child ID安全拒絕。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-028 — 完成 Transfer Dispatch／Receive 原子過帳 (legacy P3-T03)

### Goal
實作整張 Dispatch及整張 Receive；Dispatch扣來源 Bin並增加目的 Warehouse In Transit，Receive清除 In Transit並增加逐行指定的目的 Active Bin

### Approach
Implement only the scope and dependencies of legacy task `P3-T03` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Dispatch按兩 Warehouse ID及所有 Stock Control/Balance固定排序鎖定，任一行失敗整張零效果。
- Receive line ID集合exact；每行 quantity不可修改，目的 Bin屬目的 Warehouse，Status只可保持或改 Quarantined＋reason。
- Dispatch/Receive各自冪等；Movement paired legs、In Transit與 Transfer state在同一 transaction一致。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-029 — 完成 Transfer API 與 UI (legacy P3-T04)

### Goal
建立 Transfer handlers/client及 Draft editor、Dispatch確認、In Transit read-only、逐行 Receive Bin/Status畫面

### Approach
Implement only the scope and dependencies of legacy task `P3-T04` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- API route/auth/permission/idempotency/version與 design一致；Receive schema拒絕少行、重複行、多行或部分 quantity。
- UI在 Dispatch後不顯示可編輯／取消；清楚分開來源、目的及 In Transit。
- Quarantined收貨強制原因；同名 Bin不會誤用來源 ID；responsive/keyboard/conflict states通過。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-030 — 完成 Bin Move 原子過帳 (legacy P3-T05)

### Goal
實作同 Warehouse兩 Active Bins之間指定 SKU/Lot/Status的原子 Move，產生成對 OUT/IN legs且不改總 On Hand

### Approach
Implement only the scope and dependencies of legacy task `P3-T05` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 來源/目的不同且同 Warehouse；SKU/Lot/Status保持不變；quantity使用 Base UOM正整數。
- 不可移走 allocated quantity或令 eligible stock低於 Reserved；任一 Bin locked時拒絕。
- paired legs共用 group，任何失敗零 Balance/Movement/Audit半套；version/source重送語意正確。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-031 — 完成 Adjustment 與 Status Transfer (legacy P3-T06)

### Goal
實作只有 inventory.adjust＋device/password reauth可執行的正／負 Adjustment及三種人工 Status間的原子轉換，強制 reason category/text及當下規則

### Approach
Implement only the scope and dependencies of legacy task `P3-T06` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 負 Adjustment只可扣 free quantity且不破壞 Reserved/Allocation；正 Adjustment遵守 Tracking/Lot/Bin/Expiry。
- Status Transfer保持 Warehouse/Bin/SKU/Lot不變，paired legs令 Total On Hand不變；轉出 AVAILABLE重驗 Reservation保障。
- High-risk route不能用普通 JWT；permission、reauth actor/device/action/time及原因在提交點重驗並 Audit。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-032 — 完成 Movement Reversal (legacy P3-T07)

### Goal
實作完整 Movement group反向，僅允許 Receipt、Issue、Bin Move、Status Transfer及 Adjustment；Transfer、Stocktake、Opening、In Transit與 Reversal本身走關聯 Adjustment/Status流程

### Approach
Implement only the scope and dependencies of legacy task `P3-T07` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 一個原 group只能完整 reverse一次，每個 leg以 unique `reversal_of_movement_id`連結，原 row不修改。
- Reverse Receipt／increase再次檢查 free/Reserved/Allocation；Reverse Issue只回庫存，不復活已耗用 Reservation/Allocation。
- 不支援 group回固定 `MOVEMENT_TYPE_NOT_REVERSIBLE`；任何當下 invariant失敗整組零效果。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-033 — 完成 Adjustments／Movements 操作 UI (legacy P3-T08)

### Goal
建立 Adjustment/Status/Reversal入口與 Movement group/reversal顯示；高風險確認須顯示位置、Lot、Status、數量、預期效果及原因

### Approach
Implement only the scope and dependencies of legacy task `P3-T08` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 只有 view＋adjust顯示頁/按鈕；FEFO override或 operation權限不被誤當 adjust。
- device-password不進 client state、URL或重送 payload cache；timeout後先查 source結果。
- 原 Movement與 reversal group雙向連結，非可 reverse類型不顯示誤導操作。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-034 — 完成倉務操作整合、並發及安全驗收 (legacy P3-T09)

### Goal
收斂 Bin Move、Transfer、Adjustment、Status、Reversal的真 DB原子性、並發、權限、source replay及 Movement reconciliation，並完成 AC-018與 AC-022的跨 Phase依賴

### Approach
Implement only the scope and dependencies of legacy task `P3-T09` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- On Hand 10並發 Issue 7與 Dispatch 7最多一個成功；同 version Adjustments只有一個成功。
- 所有 paired/reversal groups可對賬且任一 failure injection差異為0；未 Allocation的 Reserved庫存可同倉移 Bin並保持 Reserved，Issue錯誤只能以 Reversal更正。
- Cross-owner IDs、普通 JWT high-risk、撤權 actor、stored XSS/source tampering及 direct ledger update皆被阻擋。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-035 — 建立 Stocktake、scope、line 與 persistent Bin lock persistence (legacy P4-T01)

### Goal
建立 Stocktake header、scope bins、semantic locks及 count lines，使用 active generated slot與 composite owner FK保證同 Bin只有一個 active lock且 lock/line不會交叉指向另一 Stocktake/Bin

### Approach
Implement only the scope and dependencies of legacy task `P4-T01` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Stocktake狀態、各 command operation、versions及 actor/time欄位完整；posted/cancelled歷史保留。
- `(stocktake_bin_id,stocktake_id,bin_id)` composite FK在 DB層拒絕錯 owner組合。
- `UNIQUE(bin_id,active_scope)`只允許一個 active lock，released history可多筆；count dimension的 no-lot unique不可被 NULL繞過。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-036 — 完成 Draft／Start、snapshot 與 lock acquisition (legacy P4-T02)

### Goal
實作 Draft建立／scope replace／取消及 Start；Start先驗證所有 scope Bins，再以固定順序原子建立所有 locks及 snapshot現存 buckets

### Approach
Implement only the scope and dependencies of legacy task `P4-T02` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Draft不鎖也不改庫存；同一 Warehouse的一或多 Bins scope完整 replace且使用 version。
- Start任一 Bin inactive/locked/owner mismatch時不留下部分 lock或 snapshot。
- Start成功後 snapshot包含開始前已提交效果；與同時 Receipt競爭只有「Receipt先完成被納入」或「Start先鎖定並阻擋 Receipt」兩種結果。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-037 — 完成 Count save 與現場新增 Bucket (legacy P4-T03)

### Goal
實作逐批1～100 lines保存非負整數 counted quantity、明確 notFound、progress及新增 snapshot=0的現場 Bucket；不得把空值與0混淆

### Approach
Implement only the scope and dependencies of legacy task `P4-T03` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 每行使用 version防兩人覆蓋；counted=0有效，未填為 NULL，notFound明確代表 actual=0。
- 新 Bucket重驗 SKU/Tracking/Lot/Bin/Status並遵守相同 dimension unique；不可提交 client snapshot/variance。
- READY後 save/add全部拒絕；progress分頁不一次載入所有 lines。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-038 — 完成 Ready／Post／Cancel state flow (legacy P4-T04)

### Goal
實作 completeness檢查、READYTOPOST、device-password＋adjust原子 Posting及 owner-safe Cancel；不提供 reopen或部分差異過帳

### Approach
Implement only the scope and dependencies of legacy task `P4-T04` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 所有 lines counted或 notFound才可 Ready；Ready後修正只能 cancel後重建。
- Post一次處理全部 variance，逐行更新 Balance/Movement/Audit後才 owner-safe release locks；任一失敗狀態仍 READY且 locks保持。
- Cancel只釋放該 Stocktake持有的 locks，不產生 Movement；Posted/Cancelled重送回原結果或 stable state conflict。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-039 — 完成 Stocktake API、查詢與 CSV (legacy P4-T05)

### Goal
完成 §5.7 handlers/client、header/scope/progress/variance查詢及安全 CSV export，固定各 route auth strength、permission、schema、version與 idempotency

### Approach
Implement only the scope and dependencies of legacy task `P4-T05` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Create/update/start/save/add/ready/post/cancel及 GET endpoints與 design contract一致。
- Post固定 `jwt-device-password`＋adjust；Cancel固定 `jwt-password`＋operation；密碼不進 domain/hash/log。
- CSV包含 scope/snapshot/actual/variance/movement IDs，沿用相同 filters/Base UOM並 neutralize公式。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-040 — 完成 Stocktake UI (legacy P4-T06)

### Goal
建立四步 Stocktake wizard、lock banner、server-paginated Counting、Barcode/SKU定位、progress、Ready summary、高風險 Post及取消流程

### Approach
Implement only the scope and dependencies of legacy task `P4-T06` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 選 Warehouse/Bins→Start→Count→Review/Post流程清晰；0、未輸入及未發現有不同控制與文字。
- Counting持續顯示 locked Bins、Stocktake number及完成率；READY不顯示 edit/reopen。
- Post失敗明確顯示 locks仍有效；permission、responsive、keyboard、loading/conflict/retry通過。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-041 — 完成鎖覆蓋、原子過帳、並發及安全驗收 (legacy P4-T07)

### Goal
以 P3 所有 Bin mutation入口清單建立 parameterized lock coverage，驗證服務重啟、並發 Start/post/cancel、owner mismatch、partial failure及 persistent lock復原

### Approach
Implement only the scope and dependencies of legacy task `P4-T07` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Receipt、Issue、Bin Move來源/目的、Transfer Dispatch/Receive、Adjustment、Status、Reversal及 Opening對 locked Bin全部拒絕。
- 服務 restart不遺失 active locks；同 Bin並發 Start最多一個成功；非 owner不能 release。
- Post任一步失敗無部分 Balance/Movement/Audit，state/locks保持可重試；成功後 reconciliation為0差異。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-042 — 建立 Inventory Control、Opening Job／Row persistence (legacy P5-T01)

### Goal
建立單列 Go-Live control、Opening jobs/rows、validation/result metadata、lease owner/generation fencing、operation/movement links及 queue/list indexes

### Approach
Implement only the scope and dependencies of legacy task `P5-T01` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Control只允許 PRE_GO_LIVE→LIVE；migration冪等建立 id=1，不提供一般回復或 delete。
- Job保存 file hash/size、row counts、precheck snapshot、lease owner/generation/expiry/attempts及 safe error；不保存 Audit中的完整 CSV。
- Row number在 job內唯一；duplicate dimension以 group validation保留所有錯誤 rows，不用 DB unique吞掉第二列。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-043 — 完成 Opening CSV parser 與 Precheck (legacy P5-T02)

### Goal
建立 UTF-8 RFC4180 streaming parser、固定 v1 template、10,000 row/size/header/formula限制及不改庫存的 async Precheck；解析後重用 Item/Warehouse/Bin/Lot/Status規則

### Approach
Implement only the scope and dependencies of legacy task `P5-T02` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Template只有 Warehouse/Bin/SKU/Lot/Expiry/Status/Base Quantity；quantity必須為正整數，任何錯誤整份不可 confirm。
- 錯 MIME/signature/encoding/header/extra field/formula/oversize/too many rows/path traversal全部安全拒絕。
- Precheck只寫 job/normalized rows/errors/version hash，不建立 Lot/Balance/Movement或成功 Audit；錯誤可定位 row/field。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-044 — 完成 fenced Opening worker 與失敗復原 (legacy P5-T03)

### Goal
使用現有 Scheduler/DB lease完成 claim、20秒 heartbeat續60秒 lease、generation fencing、stale precheck重驗及全部 valid rows單一 business transaction過帳

### Approach
Implement only the scope and dependencies of legacy task `P5-T03` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Claim/takeover原子遞增 generation；所有 progress/final writes帶 owner＋generation，lost ownership立即停止。
- Heartbeat使用獨立短 connection；final COMPLETED update在 business transaction內，stale worker affected rows=0令整個 posting rollback。
- 任一 row/lock/Audit/commit前失敗不留下部分 Lot/Balance/Movement；commit indeterminate先查 source結果再決定重試。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-045 — 完成 Opening／Go-Live API (legacy P5-T04)

### Goal
建立 template/upload/jobs/detail/confirm/cancel/result及不可逆 Go-Live handlers/client，固定 management permission、auth strength、idempotency、polling projection及 no-store下載

### Approach
Implement only the scope and dependencies of legacy task `P5-T04` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Upload、confirm、cancel在 LIVE後拒絕；Confirm固定 device-password＋mgmt＋reason＋version，Cancel固定 password。
- Confirm對 stale precheck回 READY＋明確錯誤，不使用舊 snapshot；Go-Live只有對賬 gate後可執行且不可逆。
- Job/result response不暴露 server path/raw CSV；已清理 result回410但 job/Audit/Movement仍可查。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-046 — 完成 Opening UI (legacy P5-T05)

### Goal
建立 PREGOLIVE/LIVE頁、template、upload、bounded polling、row errors、Confirm摘要、result及 reconciliation指引；LIVE後移除寫入入口

### Approach
Implement only the scope and dependencies of legacy task `P5-T05` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Upload不等於入帳；流程清楚分為 template→upload→precheck→errors→confirm→reconciliation。
- Confirm顯示 rows、quantity summary、短 hash及全有或全無警告；device password不保存在 component/global state。
- Polling有上限並在離頁取消；FAILED/STALE/410/LIVE均有可執行下一步，responsive/keyboard通過。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-047 — 完成 Stock／Movement／Expiry／Reservation／Transfer 匯出 (legacy P5-T06)

### Goal
建立與畫面 filters一致的 keyset-streaming CSV exports、100k row/time上限、截斷標示、Base UOM/公司時區及 export Audit

### Approach
Implement only the scope and dependencies of legacy task `P5-T06` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 五類 export使用同一 inquiry語意及 stable columns，不載入全部2M Movement至記憶體。
- 所有危險公式前綴 neutralize；headers含 attachment/nosniff/no-store/private，無成本/路徑/認證/未定義預測值。
- 超 row/time上限明確標示截斷；每次 export Audit只保存 filter hash及 row count。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-048 — 完成 Receiving／Fulfillment／Returns contracts (legacy P5-T07)

### Goal
以已存在的下游模組接上同 transaction Inventory methods；尚未存在的模組只交付 provider contract fixtures/tests，不建立虛構業務 tables或讓下游直接寫 Balance

### Approach
Implement only the scope and dependencies of legacy task `P5-T07` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Receiving Receipt、Fulfillment Reservation/Allocation/Issue及 Returns Receipt/Issue使用固定 purpose/permission/source mapping。
- 來源寫入與 Inventory效果共用同一 MySQL transaction；任一側失敗另一側完整 rollback。
- 撤權／停用actor、dependency unavailable、low receipt life evidence不完整或Customer Return未使用`QUARANTINED`時全部fail closed。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-049 — 完成 structured logs、營運查詢與 reconciliation runbook (legacy P5-T08)

### Goal
加入 design指定 command/idempotency/lock/stocktake/opening/reconciliation事件與安全 context，實作只讀 reconciliation queries/runbook及異常告警輸入，不引入新監控產品或自動修數

### Approach
Implement only the scope and dependencies of legacy task `P5-T08` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Logs包含 request/correlation/operation/actor/auth/permission/outcome/duration等 allowlist欄位，source ID必要時 hash；無自由 payload/secret。
- 六項 reconciliation invariants均有 bounded read-only query及差異輸出；任何 mismatch不直接 UPDATE Balance。
- Transaction indeterminate、Opening failed/lease recovered、長時間 Bin lock及 reconciliation mismatch有明確營運訊號。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-050 — 完成容量、效能、backup／restore 及安全驗證 (legacy P5-T09)

### Goal
以設計容量資料集驗證常用查詢、混合寫入、10k Opening及2M Movement；對完整資料執行隔離 backup/restore/reconciliation及全 endpoint安全測試

### Approach
Implement only the scope and dependencies of legacy task `P5-T09` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 5 Warehouses、1,000 Bins、100k SKUs、500k buckets、2M Movements、20 users下指定查詢 p95 <2秒；保存 p50/p95/p99與 EXPLAIN。
- 10k Opening precheck＋posting合計≤10分鐘；20-user mixed commands無非法 quantity，lock wait/error有記錄。
- 隔離 restore後六項 reconciliation為0差異；所有 endpoint通過 auth/owner/input/XSS/CSV/upload/redaction/ledger tamper安全矩陣。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-051 — 完成部署、Smoke、文件與 Release Gate (legacy P5-T10)

### Goal
凍結部署順序、permission assignment、Opening data freeze/confirm/Go-Live、rollback/forward-fix、app/migration DB account、smoke及 evidence清單；不在未簽核時執行正式 Go-Live

### Approach
Implement only the scope and dependencies of legacy task `P5-T10` inside `PHASE-006` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Deployment runbook涵蓋 backup→migrations→backend→frontend→permissions→smoke→Opening→reconciliation→人工 sign-off→Go-Live。
- 已有 Movement後只允許 read-only/forward-fix，不以 drop/reset/直接 SQL改 ledger回滾；Go-Live不可一般回復。
- 保存 migration output、commit SHA、Phase test report、capacity、backup/restore、reconciliation、smoke及 sign-off，不保存 password或 CSV原文。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

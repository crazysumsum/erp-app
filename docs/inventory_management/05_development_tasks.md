# Inventory Management 開發任務分解（Harness Aligned）

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件版本 | 1.1 Candidate — HD-066 Migration Reallocation |
| 文件日期 | 2026-09-30 |
| Requirement | `docs/inventory_management/01_requirement_spec.md` 0.4 Approved Planning Baseline |
| Design | `docs/inventory_management/03_design_spec.md` 1.1 Candidate — HD-066 Migration Reallocation |
| 任務狀態 | Sam已選定保留已合併`0055`～`0060`，把未合併Inventory `0061`～`0064`改配`0063`～`0066`；新DESIGN／PLAN hash待批准，P2產品migration尚未改名 |
| Task list target | 本文件；依使用者指定，不另建 `tasks/plan.md` 或 `tasks/todo.md` |
| 交付模型 | 6 個獨立 Phase；每個 Phase 使用一個 worktree、分支、PR 及一次完整 Phase 測試 |
| 技術基線 | Node.js 26、Express 5、MySQL Server 26.7.0、Vue 3、Quasar 2 |

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
- [ ] Phase 測試使用明確標記、與CI及production完全相同的專用MySQL Server 26.7.0 DB；不得對開發者日常資料或正式資料執行 destructive integration tests。
- [ ] P0先把`.github/workflows/ci.yml`的`mysql:8.0`服務改為可重現的26.7.0 runtime，確認映像／發行來源可固定且健康檢查可用，才執行migration相容性驗證。

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

**Description：** Fetch 最新 main，盤點實際 migration 與 Item/Supplier/Customer 尚未合併的配額；確認 Item T18～T22、Inventory `serial` fail-closed前置及MySQL Server 26.7.0可重現runtime，產出本 Phase 使用的實際 migration allocation，不修改既有migration。

**Traceability：** Design §§1.3、4.23、8.5、12.1；BR-011、BR-040、NFR-009。

**Acceptance criteria：**

- [ ] 每個既有 migration 四位前綴唯一，已套用檔名、內容與 checksum 不變。
- [ ] Inventory logical migrations 有明確實際編號及 FK 順序；與其他模組已存在或已批准配額沒有碰撞。
- [ ] 實體配置為已合併`0055` permissions、`0056` operations、`0057` audit、`0058` master、`0059` stock、`0060` movements，及待新hash批准後才改名的`0063` reservations、`0064` transfers、`0065` stocktakes、`0066` opening；`0061`～`0062`屬Supplier；任何再碰撞先停止並重新批准，不自行平移。
- [ ] Item lifecycle／lookup contract 已合併；未完成時 P0 停在此 Task，不在 Inventory 複製 SKU 規則。
- [ ] `.github/workflows/ci.yml`不再使用`mysql:8.0`；CI及本機整合測試均固定到MySQL Server 26.7.0，並以實際server version assertion防止漂移。

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
- [ ] Inventory manifest的consumed contract版本／hash與實際`ItemLookupService.js`一致，traceability validation無`CONTRACT_DRIFT`。

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

**Files likely touched：** `0056_create_inventory_operations.js`、`0057_create_inventory_audit.js`、`server/test/integration/inventoryMigrations.integration.test.js`。

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

**Files likely touched：** `0059_create_inventory_stock.js`、`0060_create_inventory_movements.js`、`inventoryMigrations.integration.test.js`。

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
- [ ] Warehouse＋SKU＋status與 Reservation＋Balance 查詢有穩定 index；MySQL Server 26.7.0 CHECK只作row-local第二層保護，不取代service的跨row invariant。

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

**Verification（納入 P2-GATE）：** `inventoryPickSequence.test.js`、Allocation service tests、override Audit及跨 Bin同 Lot integration。

**Dependencies：** P2-T02。

**Files likely touched：** `InventoryFefoService.js`、`InventoryReservationService.js`、`inventoryPickSequence.test.js`、`inventoryReservationService.test.js`、Reservation integration test。

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

**P2授權決策：** Sam批准Sales預留使用`sales.operation`、Fulfillment分配／Issue使用`fulfillment.operation`；兩者由待改名、尚未合併的Inventory `0063` idempotent seed，不修改已合併的`0055`或後續預留的migration序號。直接Inventory HTTP route維持`inventory.view`＋`inventory.operation`，與下游internal入口分開。

**Traceability：** Design §§5.1、5.5、5.11、6.1；SEC-003、SEC-006～008、AC-047～048。

**Acceptance criteria：**

- [ ] Create/release/cancel/candidates/allocate/release allocation/reallocate route具有 strict schema、version、source及 idempotency。
- [ ] FEFO candidates query不改資料；所有 command共用既有 caller transaction且提交點重讀 actor permission。
- [ ] 下游角色不因呼叫 Inventory capability取得 `inventory.view`或管理頁權限。
- [ ] Inventory `0063` seed兩項下游契約權限且不自動grant；同步更新權限目錄及seed一致性檢查；Sales／Fulfillment provider固定驗其對應權限，caller不能自報替換。

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

**Verification（納入 P2-GATE）：** `client/e2e/inventory-management/inventory-reservations.spec.js`、client service tests、production build及 manual FEFO flow。

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
包含Design §5.6.1 Inventory-owned精確SKU Code lookup及Draft selector；重用Item lookup／transactional inventory profile，不修改Item code、permission seeds、migration或共用框架。

**Traceability：** Design §§5.6、7.1、7.5；FR-TRANSFER-001～012、AC-030～034。

**Acceptance criteria：**

- [ ] API route/auth/permission/idempotency/version與 design一致；Receive schema拒絕少行、重複行、多行或部分 quantity。
- [ ] 精確SKU查找僅需inventory.view，200 strict whitelist／輸入／錯誤／同一read snapshot符合§5.6.1；無Balance SKU仍可選及建立Draft，不授予Item permission或以現有stock替代選料。
- [ ] Code變更清除該行SKU/Lot，過期response不覆蓋新輸入；查找、資格、撤權及錯誤狀態可用keyboard操作，其他Draft輸入保留；写入端仍重驗資格及stock。
- [ ] UI在 Dispatch後不顯示可編輯／取消；清楚分開來源、目的及 In Transit。
- [ ] Quarantined收貨強制原因；同名 Bin不會誤用來源 ID；responsive/keyboard/conflict states通過。

**Verification（納入 P3-GATE）：** handler/client tests、`inventoryTransfers.test.js`、production build及 manual完整 Transfer flow。
新增TC-006 lookup子案例於既有`inventory-p3-unit`、`inventory-p3-api` suites；client/component及真API Playwright加入Inventory-only actor／無Balance Draft／stale lookup及錯誤流程。最低discovery、zero-skip、34 file floors、capacity與CI／獨立review／merge gates不變；新baseline重跑適用developer checks，不把舊PLAN evidence改標新PASS。正式TC／UAT保持NOT_RUN直到相應階段實際執行。

**Dependencies：** P3-T02～T03。

**Files likely touched：** `transferHandlers.js`、`TransfersPage.vue`、`TransferEditor.vue`、client service及 tests。
Lookup新增Inventory handler/schema及最小read orchestration，測試重用`inventoryTransferHandlers.test.js`、`inventoryWarehouseOperationsApi.integration.test.js`，不新增套件或測試框架。

**Estimated scope：** M。

### P3-T05：完成 Bin Move 原子過帳

**Description：** 實作同 Warehouse兩 Active Bins之間指定 SKU/Lot/Status的原子 Move，產生成對 OUT/IN legs且不改總 On Hand。
依Design §5.4.1／HD107 A實作1～100行whole-document service＋HTTP handler；版本涵蓋來源及目的Bucket（explicit null僅指預期不存在），共用Bucket按整份操作snapshot及gross OUT驗證。SKU／Lot／Status／Base UOM由source派生，不新增schema／權限／依賴或TASK033 UI。
依HD109 A追加僅Bin Move選用的inputCoercion=false，沿用resolver／dispatcher／RequestValidator compile；省略維持global既有行為，非法metadata啟動拒絕。只擴充manifest列出的三個framework source及三個回歸test路徑，不改全域設定或其他route政策；先取得精確新DESIGN／PLAN及shared-path scope批准，才實作和執行新source驗證。

**Traceability：** Design §§3.3、3.8、5.4；FR-MOVE-001～007、BR-023、AC-028～029。

**Acceptance criteria：**

- [ ] 來源/目的不同且同 Warehouse；SKU/Lot/Status保持不變；quantity使用 Base UOM正整數。
- [ ] 不可移走 allocated quantity或令 eligible stock低於 Reserved；任一 Bin locked時拒絕。
- [ ] paired legs共用 group，任何失敗零 Balance/Movement/Audit半套；version/source重送語意正確。

**Verification（納入 P3-GATE）：** Bin Move service/handler/integration、reserved protection及 concurrency tests。
沿用已配置Posting service/handler與Inventory developer回歸、real API及`inventoryMovement.integration.test.js`；最低discovery／zero-skip／coverage floors／CI政策不變。TASK030 developer結果只證明Bin Move增量，不宣告尚未實作的Adjustment／Status／Reversal或full-P3完成；formal TC／UAT維持NOT_RUN直到獨立執行。
既有完整server root suite包含新增的apiDefinitionResolver／apiDispatcher／requestValidator相容性回歸；configured P3 real API suite新增Bin Move成功、非法型別／source／versions、HTTP cache前拒絕、domain replay、權限／零DB效果案例。沿用原argv／parser／min_tests／zero-skip／34 floors與full-P3 gate；新source／PLAN令既有證據變成歷史，必須重跑適用developer suites，不重綁舊PASS。

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

TASK031依§5.4.2及HD112–120 A，以三個薄增量交付：(1) 六個新shared boundary source/test路徑的選用capability與原route相容性；(2) owned trusted context＋單次Adjustment／Status domain及unit/failure regression；(3) strict HTTP handlers／real API＋MySQL race/replay/revocation/rollback驗證。每段先red case再最小實作，未有全部DoD證據不宣告DONE。無新auth策略／policy/bootstrap、全域config／isolation、schema／permission／dependency、client或其他TASK。

HD122 A remediation只在既有owned Posting／Adjustment helper及其測試內延後Operation actor binding；positive Adjustment新Lot的created_by使用相同temporary-NULL／final-guard後綁定，須有實際INSERT ownership，不改寫existing Lot或Receipt。Final guard→exact-row actor binding（每row=1）→proof/abort recheck→stock／Movement／Audit／Operation complete全部同一transaction；任一失敗整組回滾，不允許成功提交時缺actor／new-Lot creator。No newOperation service／generic binder／DDL／auth policy；原shared framework paths保持本候選的現有bytes，只重新綁定新PLAN scope。DEF009先寫red回歸，再修最小owned source；DEF010沿用owned SQL DATE_FORMAT並實測，不以fixture設定或放寬contract替代。

精確新shared路徑：`server/src/framework/api/apiDefinitionResolver.js`、`server/src/framework/middleware/apiDispatcher.js`、`server/src/services/idempotency/IdempotencyService.js`、`server/test/apiDefinitionResolver.test.js`、`server/test/apiDispatcher.test.js`、`server/test/idempotencyService.test.js`。只有新兩條route選用idempotencyPreparation:true／7-day TTL及已有inputCoercion:false；global default／原route契約不變。既有TASK030 RequestValidator source/test保持byte-identical，連同原六個shared paths及0064既有isolated migration使用需要綁新PLAN重新確認，不擴大寫入。

Owned source範圍：InventoryPostingService.js、inventoryHighRiskContext.js（新）、inventoryAdjustmentPosting.js（新）、InventoryAuditService.js、postingHandlers.js、inventorySchemas.js；測試沿用inventoryPostingService／inventoryPostingHandlers／inventoryAuditService／inventoryEndpointSecurity、fakeInventoryDatabase.js、inventoryMovement.integration.test.js及inventoryWarehouseOperationsApi.integration.test.js。只把Receipt既有Lot resolution移為同Posting owner的內部可重用helper，Receipt行為及已有proof回歸不變；不增加另一writer或任意movement engine。

Mandatory developer contract為TC007下TASK031 named scenarios全部實際執行且zero-skip；沿用profile native runner、Inventory unit、full server/client regression、P3 movement DB、P3 real API、lint/build、既有coverage34 floors，不降低min_tests／改parser／用已通過TASK030結果代替新case。DB沿用owned synthetic socket-only26.7.0及精確清理；缺新增case或工具為BLOCKED。需要完整原schema/fencing/ordinary-route/Receipt/BinMove regression；不新增frontend，既有Transfer browser coverage仍納入P3回歸而非TASK031 UI完成證據。FormalTC/UAT仍NOT_RUN。

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

**TASK032 exact approach：** 採§5.4.3 current-version完整expectedBalances、固定movement.reverse強認證context、immutable原group/current locking once-only、TASK031 final guard及NULL-actor exact binding。只新增Inventory-owned第三consumer與Reversal helper；不接受partial/retarget、不修改workflow、不計算新UOM。效期回原Bucket但不增加Sale eligibility的條款須另獲Sam精確審閱；HD127 A只批准版本方向及candidate準備。

**Minimum increments：** (1) strict route/schema/normalizer/proof及credential-free HTTP/domain replay red→green；(2) 同Posting owner的full-group locks/current-version/invariants/atomic inverse legs與Audit；(3) TC007全部16 REV032 named scenarios及TC004並發、fresh native DB/API和既有P3/security/Receipt/Issue/BinMove/Transfer/Adjustment/Status regression。每增量只做批准路徑，不預建TASK033 UI或generic movement engine。

**Scope／unchanged rebind：** owned source僅InventoryPostingService.js、inventoryHighRiskContext.js、inventoryReversalPosting.js（新）、postingHandlers.js、inventorySchemas.js；tests僅inventoryPostingService／inventoryPostingHandlers／inventoryEndpointSecurity、fakeInventoryDatabase.js、inventoryMovement.integration.test.js、inventoryWarehouseOperationsApi.integration.test.js。既有八shared framework/test paths、root package-lock.json及0064 synthetic migration-use在新PLAN下僅rebind且byte-identical/no-write；不新增DDL、permissions、dependencies、profile/parser/command或floor更動。

**Developer gate：** 必須有全部16 REV032 scenarios的current-source/PLAN實際named runner evidence，strict zero-skip；既有17 ADJ031/security/ordinary/Receipt/Issue/BinMove/Transfer契約及full server/Inventory/client/lint/build/global92/83/90＋全部34 per-file floors均維持。MySQL26.7.0 owned synthetic migrations、Movement及real API concurrent barriers／zero-effects snapshots與精確清理必做；既有real Transfer Playwright僅P3 regression，不是TASK033 UI完成。舊205 refs／TASK03119 PASS不可挪用為新Reversal證據。最後實作必須有實際Sam獨立source review；formalTC/UAT NOT_RUN、capacity4 NOT_EXECUTED不獲豁免。

**Dependencies：** P3-T05～T06。

**Files likely touched：** `InventoryPostingService.js`、`inventoryReversalPosting.js`、`inventoryHighRiskContext.js`、`postingHandlers.js`、`inventorySchemas.js`及上述owned posting/security/integration tests。

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

- [ ] Receipt、Issue、Bin Move來源/目的、Transfer Dispatch/Receive、Adjustment、Status及Reversal對真實Start取得的locked Bin全部拒絕；Opening實際writer證據明確配置至P5的TASK044／TASK045／TASK051，保持強制阻擋且未執行前為NOT_IMPLEMENTED／NOT_RUN，不是PASS或N/A。
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
- [ ] AC-040～043在IMPLEMENT只代表相應developer證據，不代替正式驗收；所有已存在Bin mutation入口有完整真實persistent-lock覆蓋。Opening僅按TASK041／TASK044／TASK045／TASK051明確分配為P5繼承強制證據，不能冒稱已驗證。
- [ ] 一個 P4 PR 經 code/security/DB review；不包含 Opening半成品。TASK041容量／soak、CSV崩潰與多worker資源復原、共享stream warning風險必須按精確後續合約收斂並有當前證據；首段24例或既有群組通過不足以關閉P4。

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

所有命令均在該 Phase獨立 worktree執行。Integration tests只可使用與CI及production完全相同的專用MySQL Server 26.7.0測試 DB及專案既有安全 guard。命令若因實作後 test file名稱調整，可更新精確路徑，但不可縮小覆蓋範圍。

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
npm test --workspace server -- test/inventoryReservationService.test.js test/inventoryPickSequence.test.js test/inventoryAllocationTransitions.test.js test/inventoryProviderContracts.test.js test/inventoryPostingService.test.js
DB_INTEGRATION_TESTS=1 INVENTORY_RESERVATION_MIGRATION_TESTS=1 npm test --workspace server -- test/integration/inventoryReservationMigrations.integration.test.js
DB_INTEGRATION_TESTS=1 INVENTORY_RESERVATION_TESTS=1 npm test --workspace server -- test/integration/inventoryReservation.integration.test.js
DB_INTEGRATION_TESTS=1 INVENTORY_ALLOCATION_TESTS=1 npm test --workspace server -- test/integration/inventoryAllocation.integration.test.js
DB_INTEGRATION_TESTS=1 INVENTORY_POSTING_TESTS=1 npm test --workspace server -- test/integration/inventoryPosting.integration.test.js
DB_INTEGRATION_TESTS=1 INVENTORY_TASK025_TESTS=1 npm test --workspace server -- test/integration/inventoryTask022.integration.test.js
DB_INTEGRATION_TESTS=1 INVENTORY_TASK025_API_TESTS=1 npm test --workspace server -- test/integration/inventoryTask025Api.integration.test.js
npm test --workspace client -- test/services/inventory.test.js
npx playwright test --config client/e2e/inventory-management/playwright.config.js inventory-reservations.spec.js
npm run test:coverage
npm run build --workspace client
npm run security:audit
```

DB整合命令各自需要其測試guard規定的獨立、另行批准的MySQL 26.7.0 schema／socket／環境變數；skip不算PASS。產品migration改名後，須同步更新測試的`0061` import及API測試的migration計數，再以新順序重跑，不能沿用舊編號的開發證據。Playwright目前用攔截API驗證UI；P2-GATE的真實Sales→Reservation→FEFO→Allocation→Issue及DB／Audit正向追溯仍須新增並實際通過，不由現有guarded API測試或模擬UI測試代替。

### 5.4 P3 Warehouse Operations test cycle

本節只固定 `IMPLEMENT` 的 P3 developer commands。正式 `inventory-technical` 套件的 argv、stages、TC-001～010、`max_skipped=0` 與全部正式 technical／regression／UAT mappings 原封保留；只解除 PHASE-004 對其 DEVELOPER 使用。TASK-026 局部結果不等於完整 P3-GATE，也不等於正式 Technical Acceptance。

PHASE-004 完整 developer gate 必須執行 ledger 的全部 `developer_suites`：既有 `lint`、`client-build`、`inventory-developer`（108 leaf floor）、`inventory-p2-database`（7）、`inventory-p2-api`（1，包含其全部現有 assertions），以及以下套件。精確 argv、cwd、timeout、env allowlist 與 adapter 以 `00_project_profile.json` 為準。下表的最低數是 planned execution floors，不是已發現／已通過的測試數；必測 case 不能以湊數、少檔、跳過或改斷言代替。

| Suite | 必須覆蓋的範圍 | 最低 executed leaves | 首次適用 |
| --- | --- | ---: | --- |
| `inventory-task026-unit` | Transfer migration 靜態合約＋合法狀態／整張操作拒絕規則 | 12 | TASK-026 |
| `inventory-task026-database` | 真 MySQL DDL、重跑保留資料、索引、ownership FK、值／operation constraints | 6 | TASK-026 |
| `inventory-task027-unit` | TASK-027 Draft create／full replace／cancel／query 與版本、ownership、Audit rollback；只供本 Task 中間驗證，不替代任何完整 PHASE-004 developer suite、server coverage／floors 或正式 TC／UAT。既有全 server JUnit 多 TC ID 解析阻擋仍須在完整 P3 gate 前修復。 | 12 | TASK-027 |
| `inventory-task028-unit` | TASK-028 整張 Dispatch／Receive、current actor／version／ownership、庫存及 Reservation 保護、全行集合、Quarantined reason、Audit rollback 與 replay；只供本 Task 中間驗證，搭配既有真 MySQL Transfer suite，不替代完整 PHASE-004 suites、coverage／floors、CI 或正式 TC／UAT。DEF-003 仍須在完整 P3 completion／merge gate 前修復。 | 12 | TASK-028 |
| `inventory-p3-unit` | Draft domain、Dispatch／Receive 與 handler 權限／payload／version | 12 | TASK-027～029 |
| `inventory-p3-transfer-database` | 完整 Dispatch／Receive、partial rejection、multi-line rollback、replay、Issue race、In Transit 對賬 | 12 | TASK-027～028、034 |
| `inventory-p3-movement-database` | Bin Move、Adjustment、Status Transfer、Reversal、Reserved／Allocation 保護、same-version races／failure rollback | 12 | TASK-030～032、034 |
| `inventory-p3-api` | 真 HTTP 正向過帳、cross-owner、ordinary JWT high-risk、撤權、source tampering、Audit rollback | 8 | TASK-029～034 |
| `inventory-p3-transfers-client` | Draft／In Transit／Receive、quantity／line-set／Bin 驗證與 conflict states | 4 | TASK-029 |
| `inventory-p3-movements-client` | 完整 group／reversal 雙向追溯、eligible action 與錯誤 states | 4 | TASK-033 |
| `inventory-p3-adjustments-client` | 高風險 reason／reauth／timeout、permission 與敏感 state 不保存 | 4 | TASK-033 |
| `inventory-p3-server-coverage` | 全 server root unit regression、strict JUnit 與原始 LCOV；全部既有 assertions、108 leaf floor、zero-skip 與每檔高風險 floors 保留；全域 92／83／90 改由下述完整 server coverage 判定，不再要求 root-only LCOV 獨立達標 | 108 | 完整 Phase |
| `inventory-p3-coverage-floors` | 既有全部高風險 per-file coverage floors，消費當輪已核對 hash 的 LCOV | 0 | 完整 Phase |
| `inventory-p3-client-coverage` | 全 client regression／coverage；保留 Vitest 設定；baseline 687 leaves 下限 | 687 | 完整 Phase |
| `inventory-p3-dependency-audit` | 既有 npm audit --audit-level=high；非測試的靜態相依檢查 | 0 | 完整 Phase |
| `inventory-p3-browser` | 真瀏覽器＋真本機 API：Transfer、Move、Adjustment、Status、Reversal、錯誤／權限、keyboard、refresh；禁止 route.fulfill 代替 | 8 | TASK-029、033～034 |
| `inventory-p3-browser-regression` | 既有 Warehouse／Inquiry／Reservation Playwright regression；模擬 UI 不能替代上列 live P3 | 18 | 完整 Phase |

所有新增測試 suite 只允許 DEVELOPER、JUnit、非零最低測試數、`max_skipped=0`；不偽裝成 TC/UAT 結果。Coverage-floors／dependency-audit 與既有 lint/build 是非測試品質檢查，EXIT_CODE 不代表測試執行。新套件的檔案按其 Task 到期實作；缺檔／工具／環境／證據或不足最低數均保持 NOT_READY，不建立 placeholder tests。完整 Phase 前不得把尚缺的套件移出必測清單。

TASK-026 先執行其兩個 focused suites、既有 Inventory unit regression 及適用 lint/build。純規則與 DDL／FK／indexes 採 red→green；migration 0064 只在新鮮 allocation 檢查與精確 shared-path scope 批准後才寫入。真 DB 用 task-owned 一次性 `erp_inventory_task026_*` schema、socket-only MySQL 26.7.0、合成 fixtures；依 Sam APR-071 使用本機資源並精確清理，不接觸共用／正式資料庫。

到完整 P3 cycle 時，P2 的 `erp_inventory_task025_*` regression、TASK-026 migration 與每項 P3 DB/API fixture 各有自己的合成 schema；保持既有 guard，不把不同 test-owned namespace 強行共用。P3 DB/API suite 必須檢查實際 server version 26.7.0、socket／schema ownership 與 `skip_networking=1`，使用新 `erp_inventory_p3_*` schemas；API test 必須驗證真成功效果與拒絕後零差異，不能只有負向驗證。新增 migration 後，P2 API 的既有 migration-history assertion 須按真實最新 migration 列表更新並重跑；不沿用舊 66-row 結果作新 baseline 證據。

Server root unit 執行全部 `server/test/*.test.js`，保留 strict JUnit、非零 discovery、全部 assertions、`max_skipped=0`、原始 LCOV 及全部高風險 per-file floors；允許傳入新鮮合成 Customer／Supplier Bank rings 並 redaction，無 DB enable flags 或真實 keys。全域 92% lines／83% branches／90% functions 固定由既有完整 `npm run test:coverage --workspace server`（含適用 DB integration）判定；取消 root-only LCOV 也須獨立達到相同全域百分比的重複條件，這是經 Sam 精確 PLAN 批准後才可生效的驗證準則變更，不是格式修正。不得加 coverage-exclude、降低任何完整 server／client 或 per-file 數字、改斷言或用 skip 取得通過。Guarded DB integration 的 test-owned namespaces／guards 不改；完整命令的任何 guard skip 必須逐一分類並指向同 source／PLAN、本輪獨立非 skip 的適用 DB／capacity／release evidence，缺少任何必測 evidence 就不通過。完整 `npm run test:coverage`（含 client）仍是 Phase 必測命令；native SPEC exit0 不是 strict JUnit／formal acceptance 證據，Customer mixed-ID 與任何其他 parser 阻擋須另行修復／實測。現有 14 項 skip、舊 fix-worktree coverage、舊 PLAN 或其他模組 TC 不可充作本輪 Inventory PASS。額外影響到的 Item／Auth／shared migration consumer regression 仍按設計及實際 diff 執行。

Coverage-floors 在本輪 server coverage 成功後執行：先將新 evidence run 內原始 `server-coverage.lcov` 按位元複製到 ignored `server/coverage/lcov.info`，核對 SHA-256 相等、source／PLAN baseline 相同、該 worktree 沒有競爭 writer，再執行既有 `checkCoverageFloors.js`。保存原始 LCOV 到 producer evidence，記錄 producer→consumer/hash 關係；舊報告或未知 producer 不算 PASS。Client coverage 執行全部 client tests，不刪除原有 tests、不改 coverage include 或設定。

P3 live Playwright 透過 `VITE_API_BASE_URL`／`INVENTORY_P3_API_ORIGIN` 指向 task-owned 本機真 API，僅使用合成資料及本次 process 的 credentials；不得持久化 session 或密碼。現有 5205 web port 必須確認僅屬本次 worktree，不能 reuse 別人的 server；無法隔離便 BLOCKED。實際 browser 必須檢查主要成功流程、validation／error／empty／loading、navigation／refresh、keyboard 與相關 console/network，模擬 regression 不證明交易／授權／DB 正確性。

五項既有 mandatory CI、獨立 Sam review、單一完整 P3 PR／merge group `inventory-p3`、fresh main 與清理規則不變。TASK-027～034、CI、push／PR／merge、正式驗收及 deployment 均不由配置批准自動授權；本次產品啟動仍只限 TASK-026。

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
| Migration與多個模組 worktree碰撞 | DDL無法安全合併或破壞歷史 | 每 Phase起點 fetch並驗證已合併`0055`～`0060`及Inventory待用`0063`～`0066`配額；碰撞時停止及重新批准，不自行改號、不修改已套用 migration |
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
- [x] Sam曾於2026-09-23明確授權進入`IMPLEMENT`，但其後的MySQL Server 26.7.0重大基線變更使原設計／計畫批准失效。
- [x] Sam已重新批准更新後Design及Plan baseline。
- [ ] Sam另行確認恢復`IMPLEMENT`後，才重新開始P0；目前所有Task保持`PENDING`。

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
Fetch 最新 main，盤點實際 migration 與 Item/Supplier/Customer 尚未合併的配額；確認 Item T18～T22、Inventory serial fail-closed前置及MySQL Server 26.7.0可重現runtime，產出本 Phase 使用的實際 migration allocation，不修改既有migration

### Approach
Implement only the scope and dependencies of legacy task `P0-T01` inside `PHASE-001` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- 每個既有 migration 四位前綴唯一，已套用檔名、內容與 checksum 不變。
- Inventory logical migrations 有明確實際編號及 FK 順序；與其他模組已存在或已批准配額沒有碰撞。
- 實體配置為已合併`0055` permissions、`0056` operations、`0057` audit、`0058` master、`0059` stock、`0060` movements，及待新hash批准後才改名的`0063` reservations、`0064` transfers、`0065` stocktakes、`0066` opening；`0061`～`0062`屬Supplier；任何再碰撞先停止並重新批准，不自行平移。
- Item lifecycle／lookup contract 已合併；未完成時 P0 停在此 Task，不在 Inventory 複製 SKU 規則。
- `.github/workflows/ci.yml`不再使用`mysql:8.0`；CI及本機整合測試均固定到MySQL Server 26.7.0，並以實際server version assertion防止漂移。

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
- Inventory manifest的consumed contract版本／hash與實際`ItemLookupService.js`一致，traceability validation無`CONTRACT_DRIFT`。

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
- 本Task只建立`0056_create_inventory_operations.js`及`0057_create_inventory_audit.js`；不得提前建立依賴P1 master／stock的Movement table。

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
- 本Task依序建立`0059_create_inventory_stock.js`及`0060_create_inventory_movements.js`；Movement不得早於`0058_create_inventory_master.js`與`0059`。

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
- Warehouse＋SKU＋status與 Reservation＋Balance 查詢有穩定 index；MySQL Server 26.7.0 CHECK只作row-local第二層保護，不取代service的跨row invariant。

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

Sam批准的固定映射：Sales Reservation create／release／cancel驗`sales.operation`，Fulfillment candidates／Allocation／Issue驗`fulfillment.operation`；待改名、尚未合併的Inventory `0063`負責idempotent seed，`0055`及後續migration序號不變。直接Inventory HTTP route仍用`inventory.view`＋`inventory.operation`，不借此授予下游管理頁權限。

### Approach
Implement only the scope and dependencies of legacy task `P2-T05` inside `PHASE-003` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Create/release/cancel/candidates/allocate/release allocation/reallocate route具有 strict schema、version、source及 idempotency。
- FEFO candidates query不改資料；所有 command共用既有 caller transaction且提交點重讀 actor permission。
- 下游角色不因呼叫 Inventory capability取得 `inventory.view`或管理頁權限。
- Inventory `0063` seed兩項下游契約權限且不自動grant；同步更新權限目錄及seed一致性檢查；provider固定purpose／permission，拒絕caller自報替換。

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
Include §5.6.1 exact SKU Code lookup and Draft selection using the existing Item-owned read contract; no Item source, permission seed, migration, dependency or shared-framework changes. Reuse configured unit/API suites and add affected client/component/live-API Playwright cases. New baseline requires applicable developer rechecks; preserve earlier evidence as history, not current-PLAN PASS.

### Acceptance criteria
- API route/auth/permission/idempotency/version與 design一致；Receive schema拒絕少行、重複行、多行或部分 quantity。
- Minimal lookup obeys §5.6.1 whitelist, bounded input/errors, inventory.view-only access and same read snapshot; no-Balance SKU remains selectable and Draft creation does not post stock.
- Changed Code clears selected SKU/Lot; stale responses cannot replace newer input. Keyboard, loading/empty/error/revocation states pass, other Draft input is retained and write-time eligibility/stock validation is unchanged.
- UI在 Dispatch後不顯示可編輯／取消；清楚分開來源、目的及 In Transit。
- Quarantined收貨強制原因；同名 Bin不會誤用來源 ID；responsive/keyboard/conflict states通過。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-030 — 完成 Bin Move 原子過帳 (legacy P3-T05)

### Goal
實作同 Warehouse兩 Active Bins之間指定 SKU/Lot/Status的原子 Move，產生成對 OUT/IN legs且不改總 On Hand

### Approach
Implement only the scope and dependencies of legacy task `P3-T05` inside `PHASE-004` using the design decisions mapped in `08_traceability.json`.
Implement §5.4.1 whole-document Bin Move using existing Posting/Operation/Lock ownership, handler/schema conventions and configured developer checks. HD109 A additionally permits only the narrowly scoped route-level inputCoercion=false extension and six exact shared source/test paths after current DESIGN/PLAN and scope approval; other routes/global request configuration remain unchanged. No migration, permission, dependency, generic framework or frontend expansion. Preserve mandatory future P3 checks and historical source-bound evidence.

### Acceptance criteria
- 來源/目的不同且同 Warehouse；SKU/Lot/Status保持不變；quantity使用 Base UOM正整數。
- 不可移走 allocated quantity或令 eligible stock低於 Reserved；任一 Bin locked時拒絕。
- paired legs共用 group，任何失敗零 Balance/Movement/Audit半套；version/source重送語意正確。
- 1～100 lines全部成功或回滾；來源及目的expected versions按locked起始snapshot驗證，null只代表目的不存在；shared Bucket gross OUT／overflow／一致版本、並發建立目的及撤權重送均有實際developer證據。
- Bin Move的HTTP schema在冪等claim／cached replay及handler前拒絕numeric strings／booleans；其他route的既有轉型及validation政策不變，非法inputCoercion metadata啟動拒絕。Framework regression＋real HTTP／MySQL須同source／PLAN通過。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

## TASK-031 — 完成 Adjustment 與 Status Transfer (legacy P3-T06)

### Goal
實作只有 inventory.adjust＋device/password reauth可執行的正／負 Adjustment及三種人工 Status間的原子轉換，強制 reason category/text及當下規則

### Approach
Implement only legacy `P3-T06` inside `PHASE-004`, using §5.4.2 / HD112–120 A and the three increments/exact scope under P3-T06. The opt-in HTTP preparation/replay hooks precede two consumers; trusted context is separate from serializable command. Current locking reads after waits, scalar original result, 500-byte reasons/OTHER detail, Lot creation/date/life and required versions are mandatory, not optional fallback.
HD122 A adds transaction-local NULL actor staging for the new Operation and only an actually inserted new Lot, exact-row binding after the final current security guard, original-proof/abort recheck and atomic rollback. Existing rows/Receipt/shared auth remain unchanged. All17 TASK031 named scenarios, including early-FK regressions and owned DATE normalization, require fresh current-source/PLAN evidence; known DEF009/010 and final Sam source review block DONE.

### Acceptance criteria
- 負 Adjustment只可扣 free quantity且不破壞 Reserved/Allocation；正 Adjustment遵守 Tracking/Lot/Bin/Expiry。
- Status Transfer保持 Warehouse/Bin/SKU/Lot不變，paired legs令 Total On Hand不變；轉出 AVAILABLE重驗 Reservation保障。
- High-risk route不能用普通 JWT；permission、reauth actor/device/action/time及原因在提交點重驗並 Audit。

### Definition of Done
The exact reviewed TASK031 scope and every named TC007 TASK031 developer scenario have current-source/PLAN observed evidence, zero skip, mandatory native regression/floors and actual Sam implementation review. TASK032 reversal cases remain NOT_RUN, no blanket TC007 or full-P3/formal acceptance claim. No publication before its separate actual CI/review/merge authority.

## TASK-032 — 完成 Movement Reversal (legacy P3-T07)

### Goal
實作完整 Movement group反向，僅允許 Receipt、Issue、Bin Move、Status Transfer及 Adjustment；Transfer、Stocktake、Opening、In Transit與 Reversal本身走關聯 Adjustment/Status流程

### Approach
Implement only legacy `P3-T07` inside `PHASE-004` using §5.4.3 / HD127 A plus Sam's exact candidate approval. Use the three increments and precise source/test/no-write rebind scope above; current-version guards, full-group undo, current strong-auth/replay/final guard, atomic once-only and current invariants are mandatory. The proposed historical-Lot restoration policy needs explicit approval; direction A alone is not authority to adopt or implement it.

### Acceptance criteria
- 一個原 group只能完整 reverse一次，每個 leg以 unique `reversal_of_movement_id`連結，原 row不修改。
- Reverse Receipt／increase再次檢查 free/Reserved/Allocation；Reverse Issue只回庫存，不復活已耗用 Reservation/Allocation。
- 不支援 group回固定 `MOVEMENT_TYPE_NOT_REVERSIBLE`；任何當下 invariant失敗整組零效果。

### Definition of Done
Every16 REV032 named developer scenarios has current-source/approved-PLAN observed evidence with zero skip, required native regression/floors/real MySQL/API checks and actual independent Sam implementation review. TASK033/034, blanket formal TC007/UAT, capacity and full-P3 completion remain unclaimed. CI/PR/main integration requires separate publication authority and refreshed target/head gates.

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

### TASK033 exact local increment and developer checkpoints（candidate）

Implement §7.8.1 only after actual Sam exact candidate approval. HD130 A selects recovery direction, not these unseen source/spec/profile changes. Keep canonical task/Phase/merge relationships and all prior invariants; do not introduce a second task ledger or rename this Task.

1. Add signed Inventory service methods and credential-free intent/result recovery; add native service/Adjustment tests before behavior. Verify fixed routes, stable explicit key, current-source lookup and no credential persistence or automatic retry.
2. Build Adjustment IN/OUT and Status selection/review over existing reads, with native uncontrolled confirmation and exact current guards. Verify numeric/reason/Lot/permission/error/UNKNOWN/refresh cases with at least12 native Adjustment cases.
3. Add Movement-to-Reversal entry/full-group review and safe bidirectional navigation. Verify allowlist, incomplete guard rejection, current versus historical version, wrong/stale detail response and read-only actor with at least6 native Movement cases.
4. Execute eight actual high-risk browser/MySQL cases and unchanged Transfer8, ordinary browser18, all current applicable developer/native functional/server/client/lint/build/audit/coverage-floor checks. Review sanitized screenshots320/768/1024/1440 and keyboard/console/network results. Final exact-source actual Sam review remains required before local TASK033 DONE.

Proposed owned paths only: `client/src/services/inventory.js`, `client/src/pages/inventory/AdjustmentsPage.vue`, `client/src/pages/inventory/MovementsPage.vue`, `client/src/components/inventory/AdjustmentForm.vue`, `client/src/components/inventory/InventoryHighRiskDialog.vue`, `client/test/services/inventory.test.js`, `client/test/pages/inventory/inventoryAdjustments.test.js`, `client/test/pages/inventory/inventoryMovements.test.js`, `client/test/pages/inventory/inventoryInquiries.test.js` (existing page mounting/session compatibility only), `client/e2e/inventory-management/inventory-high-risk.spec.js`. No generic auth engine, store, shared confirmation or backend writer changes. Split actual form/confirmation responsibilities only, no speculative factory/helper library.

Reviewed existing suite contracts gain stronger discovery floors: inventory-p3-adjustments-client4→12, inventory-p3-movements-client4→6; inventory-p3-browser retains existing warehouse-operations8 and adds high-risk8 with min8→16. Existing argv/result adapter/skip/timeout contracts otherwise unchanged; the new spec's bounded test watchdog fits the1800-second suite contract and has credential-sensitive capture disabled. Ordinary browser-regression18 is required here too; no missing or guarded-disabled browser run is PASS. Existing mandatory suite/profile/traceability relationships are retained.

New PLAN must explicitly rebind the already-approved, byte-identical shared framework/test8, existing0064 and root lockfile scope only because existing dirty P3 changes remain in this worktree. Rebind is no-write adoption of verified pins, not permission for new shared/auth/DDL/dependency changes. Local owned synthetic MySQL/API/browser setup and precise cleanup reuse existing approved methods; no shared/production resource, CI/publication/main integration/formal/capacity waiver. Historical source/PLAN reports remain historical and cannot prove the new UI candidate.


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

#### TASK034 coverage reconciliation and local increments (HD133 A; exact candidate pending)

Use the existing full P3-T09 acceptance, not the old FR063-only typed mapping. TASK034 links FR034, FR037–041, FR063–091 and SEC001–013 through DES003/005/006/010 and TC001/004/006/007; each TC inverse link includes TASK034. Add the five previously missing Issue/source requirements to PHASE004, preserve all existing Phase membership, and explicitly depend on TASK026–033. Requirements/design/UAT definitions and business rules do not change. The ledger and regenerated matrix remain the only typed relationship authority.

Three sequential increments, each followed by current-source evidence verification:

1. Exact quantity/version concurrency and invariants: add Issue7 versus Dispatch7 on OnHand10 and an existing-Bucket same-version Adjustment race; verify all-or-none effects, Control/Reservation/Allocation and immutable original rows. Reuse existing deterministic barrier/fixture patterns, no sleeps or weakened guards.
2. Reconciliation/security gap closure: map the12 INT034 developer rows to exact native names/assertions; add or strengthen only missing tests in the three owned integration files. Preserve all existing tests/names/assertions. Verify complete rollback, required Audit, paired/inverse effects, source conflict/replay, ownership, ordinary-JWT rejection and current revocation. Movement/Audit UPDATE and DELETE must fail for the actual immutable trigger, not an unrelated SQL error.
3. Integration evidence and writer handoff: fresh applicable native developer suites, full functional compatibility, unchanged Transfer/high-risk Playwright and ordinary browser regression, lint/build/audit/global/per-file floors; record the current Bin OnHand entry inventory with file pins for P4. Independent Sam source review is required before local TASK034 DONE; complete P3 integration/CI/PR/main/formal gates are separate.

Owned test writes are limited to `server/test/integration/inventoryTransfer.integration.test.js`, `server/test/integration/inventoryMovement.integration.test.js` and `server/test/integration/inventoryWarehouseOperationsApi.integration.test.js`, plus this module's documentation/evidence. No product/UI/shared/auth/provider/DDL/dependency/config/parser writes are included. If a test exposes a product defect, retain the failure and request scoped remediation rather than fixing outside this candidate.

Exact Issue7 case: establish valid Reservation7 and Allocation7 using the existing Issue contract; do not invent an unallocated Issue or let Dispatch consume reserved/allocated stock to create artificial competing winners. Exercise deterministic arrival/lock ordering and require at most one committed operation, valid Issue consumption, rejected Dispatch zero-effects, final OnHand3/Allocated0/Reserved0, Draft Transfer/no transit. Existing Issue4/Dispatch7 remains a separate regression. The version race uses two distinct source events, existing Bucket OnHand10/versionV and two OUT4 Adjustments; sufficient quantity for both ensures the loser is rejected for stale version rather than aggregate shortage.

All existing project-profile argv, tool versions, suite floors, stages, parser, timeout, required IDs and zero-skip rules are byte-identical; no new suite or count-only substitution. INT034 rows require their exact new or verified existing native names and assertions on the new approved PLAN/current source. The original22 registered contracts, supporting functional commands and full-native skip classification remain required where applicable; old reports retain original baselines. Global92/83/90 and34 file floors are unchanged. Full-command guarded skips need their separate applicable non-skip evidence; capacity4 remains NOT_EXECUTED and is not deferred/waived. Local Task closure is not full-P3 completion or MERGE_READY.

The new PLAN explicitly rebinds the prior byte-identical eight shared framework/test paths, root lockfile and existing0064 only for boundary consistency of accumulated dirty P3 work. Their verified pins permit no new writes. Standing local-resource authority supports owned synthetic MySQL26.7.0/API/browser setup, existing migrations and precise cleanup after exact candidate approval; no shared/production resource or credential export.

#### Current Bin OnHand entry inventory for P4 (source discovery, not executed P4 proof)

| Operation | HTTP / internal entry | Writer implementation | Relevant Bin scope |
| --- | --- | --- | --- |
| Receipt | `POST /api/v1/inventory/receipts`; `postReceipt[InTransaction]`, `postReceivingReceiptInTransaction`, `postCustomerReturnReceiptInTransaction` | `InventoryPostingService.js` Receipt core | Receipt destination; downstream providers retain fixed existing permissions/purpose |
| Issue | `POST /api/v1/inventory/issues`; `postIssue[InTransaction]`, `postFulfillmentIssueInTransaction` | `InventoryPostingService.js` Issue core | Every allocated source Bin; HTTP and internal permissions stay distinct |
| Bin Move | `POST /api/v1/inventory/bin-moves`; `postBinMove[InTransaction]` | `inventoryBinMovePosting.js` | All source/destination Bins, including shared Buckets |
| Dispatch | `POST /api/v1/inventory/transfers/:id/dispatch`; `dispatch[InTransaction]` | `InventoryTransferService.js` | Every source Bin; destination InTransit is not a Bin |
| Receive | `POST /api/v1/inventory/transfers/:id/receive`; `receive[InTransaction]` | `InventoryTransferService.js` | Every receiving destination Bin |
| Adjustment IN/OUT | `POST /api/v1/inventory/adjustments`; `postAdjustment[InTransaction]` with trusted context | `inventoryAdjustmentPosting.js` | Selected existing/new Bucket Bin; new Lot/balance also rolls back |
| Status Transfer | `POST /api/v1/inventory/status-transfers`; `postStatusTransfer[InTransaction]` with trusted context | `inventoryAdjustmentPosting.js` | Both status Buckets in the same Bin |
| Whole-group Reversal | `POST /api/v1/inventory/movements/:id/reverse`; `reverseMovement[InTransaction]` with trusted context | `inventoryReversalPosting.js` | Every server-derived original group Bin, current full guards |

All paths above are relative to `server/src/modules/inventory/`; HTTP definitions are in `server/src/handlers/inventory/postingHandlers.js` and `transferHandlers.js`. `InventoryLockService.js` also materializes zero Buckets inside owned transactions; it is a shared preparation primitive, not an independent posting route, and rollback/lock evidence must include it. Reservation/Allocation only change Reserved/Allocated, not OnHand, and remain explicitly classified rather than accidentally omitted or presented as OnHand writers. Draft create/update/cancel and inquiries are non-OnHand routes.

This inventory reflects current source; later execution must mechanically reconcile current handlers/internal aliases and the actual OnHand write sites, with no unexplained writer omission. P4 persistent Stocktake and later Opening writers are not implemented here. Existing injected Counting-signal tests and confirmed no-P4-table behavior do not prove persistent Stocktake workflow or restart recovery. P4 must extend this inventory when those real writers/locks exist; no claim that future lock coverage is already complete.


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

#### TASK-035 developer persistence verification contract

TASK-035 is the first P4 persistence slice, not a runnable Stocktake workflow or a complete PHASE-005 gate. Before product writes, obtain actual Sam approval for the precise new PLAN and the existing planned `server/database/migrations/0065_create_inventory_stocktakes.js` scope. Prefix0065 is currently free on the observed default baseline; recheck the global migration ledger immediately before creating it. Do not renumber or modify previously merged migrations.

| Developer suite | Native file | Planned minimum / skip ceiling | Scope |
| --- | --- | --- | --- |
| `inventory-task035-unit` | `server/test/inventoryStocktakeMigration.test.js` | 6 / 0 | Creation ordering, complete-schema no-op rerun and fail-closed schema inspection |
| `inventory-task035-database` | `server/test/integration/inventoryStocktakeMigrations.integration.test.js` | 12 / 0 | Actual MySQL26.7.0 DDL, ownership/uniqueness/FK enforcement, history-preserving rerun and incompatible-schema rejection |

Both use Node26, serial `node --test`, the existing testEnv import and fresh native JUnit output under the actual Harness run directory; timeout1800s and DEVELOPER stage only. Neither reports formal TC-001/TC-008 PASS. A missing file, fewer discovered cases, any skipped case, incompatible environment or absent current-PLAN proof blocks TASK-035 closure.

Planned unit families: (1) four-table and optional Movement-FK creation order; (2) complete compatible schema emits no further DDL; (3) incompatible column/null/type/actor fields reject before DDL; (4) defaults and generated expressions reject drift; (5) required indexes/enforced checks reject drift; (6) FK parent/composite ordering/schema/delete rules reject drift.

Planned real database families: (1) fresh complete four-table schema and optional Movement FKs; (2) repeat up preserves schema, headers, lines and lock history; (3) state/version/operation uniqueness constraints; (4) restrictive business references and actor SET NULL; (5) scope candidate-key ownership; (6) at most one active lock per Bin with multiple released-history rows; (7) wrong Stocktake/Bin composite lock owner rejected; (8) wrong composite count-line owner rejected; (9) no-lot NULL cannot bypass dimension uniqueness; (10) SKU/Lot and Balance references remain constrained; (11) interrupted optional-FK attachment resumes without rewriting immutable Movement history; (12) incompatible columns/defaults/generated slots/index/check/FK shapes fail closed before additional DDL. These are planned coverage families, not discovered or executed test results.

Use only an owned socket-only MySQL26.7.0 instance under `/private/tmp/erp-inventory-task035-mysql-2670.<unique>/mysql.sock`, one fresh synthetic `erp_inventory_task035_<unique>` schema, and actual owner/PID/version/skip_networking observations. Forward only `DB_NAME`, `DB_SOCKET`, `DB_INTEGRATION_TESTS`, `INVENTORY_STOCKTAKE_MIGRATION_TESTS`; no literal credentials or shared database reuse. Execute existing prerequisite migrations plus this reviewed0065 only in that instance, record real DDL actions and precisely clean only owned schemas/accounts/daemon/socket/datadir. Standing Sam local-resource authority applies; no production, deployment, evidence-export, CI waiver or remote write authority is inferred.

Keep all existing suites, formal case IDs/Technical/UAT applicability, thresholds, tool probes, parsers and CI unchanged. The old PHASE-005 `inventory-technical` relation is not silently removed here: the complete phase-appropriate developer suite mapping must be separately reconciled before the P4 merge gate, and TASK-035's two groups never substitute for later TASK-036–041 workflow/API/UI/concurrency/restart/lock-coverage proof. P4 remains one reviewed phase PR; final precise-head Sam review, all five current CI, fresh main and generic MERGE_READY remain mandatory.

Implement only persistence migration0065, its inspection and these two scoped test files for this slice. Do not activate Stocktake routes/services/UI, touch Opening/P5 or existing shared auth/framework/DDL, waive writer coverage, or claim formal acceptance. Independent Sam implementation review is still required before TASK-035 DONE.


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

#### TASK-036 Draft/Start developer verification contract (HD144 A)

Implement this service-only slice after approval of the exact updated DESIGN/PLAN candidate. Draft scope is exclusive against any other `DRAFT`, `COUNTING` or `READY_TO_POST` Stocktake, but Draft never creates semantic Bin locks or blocks ordinary stock writers. Create/full scope replacement use the existing Warehouse serialization point and fresh current reads; the current header is excluded, terminal history is retained, and removal/cancel frees planning membership. This implements FR-092 under actual Sam HD144 A, not a new generic reservation system.

Precise new product/test paths:

- `server/src/modules/inventory/InventoryStocktakeService.js`
- `server/test/inventoryStocktakeService.test.js`
- `server/test/integration/inventoryStocktake.integration.test.js`

Reuse the established Operation, Audit, InventoryLockService, transaction and fresh authorization patterns. The existing fakeInventoryDatabase accepts injected queries/execute behavior; do not alter it or other shared helpers merely for this slice. Existing0065 and all earlier migrations remain byte-identical. No dependency, global auth/framework, public route, configuration or frontend activation.

Service scope is Draft create/full scope replace/Draft cancel and Start only, with actor identity, fixed `inventory.operation`, header expectedVersion and immutable domain operation receipt/replay. Validate one Warehouse, one or more distinct owned Active Bins and reject client snapshots/lock/state/actor/permission overrides. Do not introduce an arbitrary Bin or snapshot-count ceiling in this verification contract; a justified new business limit requires a separate decision. Public HTTP field/auth wiring remains later P4 work: §5.7 create/update/start keep jwt/view+operation and cancel keeps jwt-password/view+operation. No caller boolean is treated as password proof, and this unexposed service slice does not claim HTTP password-flow verification.

Start acquires all Bin semantic locks and snapshots all existing SKU/Lot/Status buckets, including zero quantity, in one transaction. It does not update Balance, Control, Lot, Allocation, Reservation or Movement; uncounted lines remain NULL. Do not initialize absent Control/Balance rows merely to take a snapshot. Follow §2.5 operation→Warehouse→applicable Control→Bin/active-lock→Lot→Balance→workflow root→child/write order; no root/child lock before its preceding business locks and no reversed lock order. Scope discovery before a wait is not authoritative: revalidate current header/version/scope and snapshot state using current reads under held locks, not stale RR snapshots. Canonical scalar receipts contain no raw auth or proof. Replays reauthorize and return the original receipt without remaking locks/snapshots or replacing events.

| Developer suite | Native file | Planned minimum / skip ceiling |
| --- | --- | --- |
| `inventory-task036-unit` | `server/test/inventoryStocktakeService.test.js` | 12 / 0 |
| `inventory-task036-database` | `server/test/integration/inventoryStocktake.integration.test.js` | 18 / 0 |

Both are DEVELOPER-only, serial Node26 native `node --test` with the existing testEnv import, fresh JUnit in the Harness run directory and timeout1800s. Unit declares FILES only; database declares FILES/ISOLATED_DATA and the four exact forwarded env names `DB_NAME`, `DB_SOCKET`, `DB_INTEGRATION_TESTS`, `INVENTORY_STOCKTAKE_TESTS`. The database test requires a fresh owned synthetic `erp_inventory_task036_<unique>` schema and socket-only MySQL26.7.0 at `/private/tmp/erp-inventory-task036-mysql-2670.<unique>/mysql.sock`, actual owner/PID/version/datadir/skip_networking checks, real prerequisite migrations plus unchanged0065, and exact owned cleanup under standing Sam local-resource authority. No shared/production database, credentials in profile, new resource permission request or evidence export.

Planned unit families (not discovered results): Draft create/no stock effect; invalid IDs/empty/duplicate scope/client fields; fixed permission/current actor rejection; full scope replacement; unfinished overlap/self exclusion/terminal history; expectedVersion/state guard; Start canonical lock order; all-status/zero/no-lot snapshot and uncounted NULL; invalid Bin/existing lock rejection; immutable replay/payload conflict; required Audit/Operation failure rollback; Draft cancel reason/version/state/history with no stock or lock effect.

Planned realDB families (not executed results): (1) multi-Bin Draft persists without stock effects; (2) overlap with each unfinished state rejects; (3) competing Draft creates have one complete winner; (4) scope replacement overlap rolls back wholly; (5) removal/cancel frees membership but preserves history; (6) Draft permits a real Receipt; (7) Start captures all Lot/Status/zero dimensions; (8) invalid/inactive/wrong-owner multi-Bin Start has no partial effect; (9) foreign active lock is never taken/released; (10) same-version competing Starts have one complete effect; (11) committed scope/version changes during Warehouse wait defeat stale discovery; (12) Receipt-first effect is included; (13) Start-first rejects Receipt with unchanged quantity; (14) mid-lock/snapshot/Audit/completion fault points roll back; (15) original domain replay retains receipt/no second effects and altered payload conflicts; (16) revoked actor/permission rejects writes and replay; (17) committed revocation during Warehouse wait rejects stale RR claims; (18) competing Draft cancel/replace uses version guards and leaves retained scope/history/quantities intact. Race orderings need deterministic two-connection barriers and proof of the intended wait; fixed sleeps or injected lock flags are not concurrency proof.

Missing files, below-minimum discovery, any skip, failed intended barrier, absent current source/PLAN proof, failed DB ownership/version probe or incomplete cleanup block TASK036 closure. Preserve failed reports. Re-run unchanged TASK035 unit6/DB12 on the adopted updated PLAN alongside TASK036, supporting existing developer/lint/build/audit/native floors as applicable; never rewrite old-baseline evidence to the new hash. Independent actual Sam implemented-source review is required before TASK036 DONE.

Do not implement counts/add/ready/post, Counting/Ready cancellation, query/export/UI, Opening/P5 or a process-global memory lock here. TASK037–041 remain separate; these two groups do not replace full-P4 writer-lock coverage, restart verification, real HTTP/Playwright or the unresolved complete PHASE005 developer-suite mapping. All old suites, formalTC/UAT IDs, global92/83/90 and37 per-file floors, five current CI and final exact-head Sam/fresh-main/MERGE_READY gates remain unchanged. One reviewed P4 phase PR remains the merge boundary; no publication/PR/merge/formal acceptance/deploy or waiver is inferred.


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

#### TASK-037 Count/add/progress developer contract (HD147 A / HD149 A scalar candidate)

This candidate is not adopted until actual Sam exact DESIGN/PLAN approval. Implement the existing TASK037 service/query slice only, in three thin TDD increments: count save → registered-Lot add → paginated progress; verify each increment and then the final source. Dependencies TASK035/036 are historical local DONE, not fullP4 or merged acceptance.

Precise proposed product/test scope:

- `server/src/modules/inventory/InventoryStocktakeService.js`: additive saveCounts/addLine and their caller-owned transaction variants; preserve existing Draft/Start behaviors.
- `server/src/modules/inventory/InventoryInquiryService.js`: additive listStocktakeCountLines query only; no changes to other inquiry methods.
- `server/test/inventoryStocktakeCounts.test.js`: new scoped native unit file.
- `server/test/integration/inventoryStocktakeCounts.integration.test.js`: new scoped realDB file.

Existing0065, TASK035 two tests and TASK036 two tests remain byte-identical. All earlier migrations, ItemLookupService, authorization/framework/helpers/config/permission catalogue/package/lockfile/client/handlers remain unchanged. No new dependency, global isolation or process-memory lock. Existing source review remains historical; the extended service requires new independent actual Sam implemented-source review before TASK037 DONE.

**Save contract.** `saveCounts(command)` accepts the established trusted command envelope with purpose `stocktake.count` and fixed `inventory.operation`. Payload only `{stocktakeId,lines}`; 1–100 distinct lines sorted by lineId for intent/hash and locking. Every line is exactly `{lineId,expectedVersion,countedQuantity}` with a nonnegative safe integer including0, OR `{lineId,expectedVersion,notFound:true}`; the two forms cannot coexist. Null, missing, blank/string, negative/fraction/unsafe quantity, duplicate lineId, false notFound and client snapshot/variance/actor/permission fields reject. No new clear-to-uncounted action: NULL represents the untouched initial state, not an accepted input; later numeric save can replace prior notFound and vice versa while COUNTING. Numeric form persists counted_quantity=q/is_not_found=0; notFound persists counted_quantity=NULL/is_not_found=1, effective actual0. variance_quantity remainsNULL until future Ready.

Validate current headerCOUNTING, every requested line's Stocktake/scope/Bin ownership and active semantic lock ownership; all selected Ware/Bins must remain active. Lock/recheck under existing Warehouse serialization and §2.5 order; discovery before a wait is not authoritative. Use current Workflow-root/child reads, each line's expectedVersion and uint32 ceiling. Validate the whole batch before effects and commit all updates, last-count actor/time, Audit and completed Operation together. Every changed line increments its own version once; count/add update header updated_at/updated_by but do not increment workflow header.version or change status. This preserves independent per-line input, while later Ready/Cancel must current-read under the same Warehouse/root protocol; no header version is accepted as a substitute for the individual line versions. Same-line stale saves wholly reject; different-line saves can both succeed without clearing each other's result. No OnHand/Balance/Control/Lot/Allocation/Reservation/Movement or lock release effect.

**HD149 A scalar Count receipt:** exactly `{id:stocktakeId,operationId,status:"COUNTING",version:workflowVersion,rowCount}`; no lines/count array. Use real existing Operation.complete/resultType STOCKTAKE/resultId String(stocktakeId) and its unchanged scalar whitelist/8192bytes. Fresh actor/permission checks after waits/before replay remain; replay returns the original scalar receipt without reading/recounting changed lines or metadata/Audit updates. Current line values/versions come from separate paginated inquiry, never reconstructed as the original result. Same source changed payload/action remains INVENTORY_SOURCE_CONFLICT; unknown completion is not automatically retried.

**Per-line scalar Audit:** for every selected changed line, write one stocktake.count record under the same transaction and operationRequestId, targetType stocktake/targetId parent/targetLabel stocktakeNumber. Both before/after summaries use exactly `{id:lineId,stocktakeId,quantity:effectiveActual,version:lineVersion,status:progressState}`. UNCOUNTED→quantityNULL, COUNTED→numericq including0, NOT_FOUND→quantity0; status retains the distinction. Existing actor/time/source/request/correlation attribution remains in the Audit envelope; no credentials, nested JSON or duplicated request body. A100line batch must have100 correct scalar Audit rows linked to its one Operation, or no committed line/header/Audit/Operation effects. Replays never append history. Real Audit failure at the second/per-later row and completion/commit failure must wholly roll back. No aggregate-only Audit may replace the per-line before/after information.

**Add contract / HD147 A.** `addLine(command)` and caller-owned variant use purpose `stocktake.add_line` / fixed inventory.operation. Payload only `{stocktakeId,binId,skuId,lotId,stockStatus}`; lotId is required explicitly, NULL only when current Item tracking=none, positive ID of an existing same-SKU Lot for batch/batch_expiry. Current Item profile must be usable/inventoryTracked with one Base UOM; reject serial, wrong/nonexistent Lot or unsupported status, and require stored expiry for batch_expiry. Accept the three existing Stock statuses. Counting records physical findings, so an existing expired/low-life Lot is not denied merely by sales/Receipt eligibility; its identity/dates and sale eligibility remain unchanged and eventual Posting has its own revalidation. Existing snapshot lines can be counted without requiring the SKU still to be sellable; no SKU reclassification or new stock permission is inferred.

Revalidate current scope, Ware/Bin active ownership and the semantic lock belonging to this Stocktake. Use Item-owned transaction methods and a current reader after waits; do not duplicate Item rules or write master data. Lock existing Lot/full-dimension Balance before workflow root/child per §2.5, without creating absent Balance/Control rows. If the dimension already has a Stocktake line, fail existing STOCKTAKE_STATE_CONFLICT with safe duplicate-dimension rule; if an existing Balance is unexpectedly not represented by the immutable Start snapshot, fail STOCKTAKE_SNAPSHOT_MISMATCH rather than treating it as absent. Use current reads, not an earlier ordinary RR snapshot. Concurrent NULL-Lot/known-Lot duplicate adds have at most one line, with the real0065 unique key as final backstop.

Insert only the owned Stocktake line: snapshot_quantity=0, snapshot_balance_version=0, stock_balance_id=NULL, counted_quantity=NULL, is_not_found=0, variance_quantity=NULL, version=1. Add does not count the new line automatically; saveCounts is the explicit next action. **HD149 A scalar Add receipt:** exactly `{id:newLineId,stocktakeId:parentId,operationId,status:"COUNTING",version:1,rowCount:1}`. id/version are the new line; stocktakeId is parent, not an alias for lineID; header workflowversion is available separately. Use unchanged Operation resultType STOCKTAKE/resultId String(parentId); root navigation reference is retained while scalar summary identifies the line. One stocktake.add_line Audit targets the parent, beforeSummaryNULL and afterSummary exactly `{id:newLineId,stocktakeId,quantity:NULL,version:1,status:"UNCOUNTED",binId,skuId,lotId,stockStatus}`. Original replay returns the scalar result without insert/count/Audit/current-query reconstruction. No line object, new resultType, shared summary whitelist/parser/byte-limit changes. No Lot/Balance/Control creation, date replacement, Receipt/Adjustment/Movement, stock effect or foreign unlock. Never-registered batch ID returns existing INVENTORY_RESOURCE_NOT_FOUND with safe lotId/REGISTERED_LOT_REQUIRED detail; caller lotNumber/expiry/manufacture/firstReceiptDate/tracking/snapshot overrides reject. This explicit phase limitation must be reflected in the later TASK039/040 route/UI, not hidden or bypassed.

**Progress query.** Add `InventoryInquiryService.listStocktakeCountLines({stocktakeId,page=1,pageSize=20,progress="ALL"})`, reusing existing pagination validation: page>=1, pageSize1–100, safe offset and whitelisted SQL. Filters ALL/UNCOUNTED/COUNTED/NOT_FOUND are disjoint exceptALL; COUNTED means numeric actual, NOT_FOUND means explicit marker, UNCOUNTED means NULL plus flag0. Read header, SQL aggregate progress and LIMIT/OFFSET rows in one owned consistent read transaction; deterministic idASC ordering, no eager all-line load and no business/Operation/Audit writes. Result `{id,status,version,items,total,page,pageSize,summary:{totalLines,countedLines,notFoundLines,uncountedLines}}`; items carry stored dimensions/snapshot/count/notFound/version and effective actualQuantity=NULL/q/0, without calculating/storing Ready variance. Missing Stocktake is existing not-found; empty/beyond-end page is items[] with truthful total/summary. Existing internal Inquiry trust boundary is retained: it is not an authenticated HTTP entry point and does not accept caller permission overrides. Actual future handler must freshly enforce inventory.view under TASK039; this slice does not claim view/JWT/browser verification. No query/export/API/UI activation or live authorization bypass.

**Real-summary compatibility gate.** Happy-path unit completion/replay and Audit assertions must use real InventoryOperationService and InventoryAuditService serialization/parsing (fake DB executor is allowed); do not mock away the interfaces that caused HD149. Injected fault/race wrappers may wrap the real methods, not silently accept forbidden results. RealDB uses actual source lookup/replay, result JSON, per-line Audit rows and SQL transaction rollback. Assert exact Count/add key sets, correct header-vs-line IDs/versions, 100-line success at valid safe-integer quantity/ID/version boundaries, every individual summary<=8192UTF8bytes, rejected nested/sensitive fields under unchanged serializer, and no rows/metadata/Audit added by replay. These strengthen the existing14unit/22DB named cases; commands/env/minimums/skip ceilings are unchanged. Large-scale100-Audit transaction capacity remains fullP4 work, not this interface diagnostic.

| Developer suite | Native file | Planned minimum / skip ceiling |
| --- | --- | --- |
| inventory-task037-unit | server/test/inventoryStocktakeCounts.test.js | 14 / 0 |
| inventory-task037-database | server/test/integration/inventoryStocktakeCounts.integration.test.js | 22 / 0 |

Both are serial Node26 native node--test/testEnv/JUnit in fresh Harness run directories, DEVELOPER only, timeout1800s. Unit FILES only; database FILES/ISOLATED_DATA with only DB_NAME/DB_SOCKET/DB_INTEGRATION_TESTS/INVENTORY_STOCKTAKE_COUNTS_TESTS forwarded. Database requires a fresh owned synthetic `erp_inventory_task037_<unique>` schema and socket-only MySQL26.7.0 at `/private/tmp/erp-inventory-task037-mysql-2670.<unique>/mysql.sock`; verify actual owner/PID/datadir/version/skip_networking, existing prerequisite migrations plus unchanged0065, then exact owned cleanup under standing Sam authority. No shared/production DB or literal credentials. Missing/short-discovery/any-skipped/stale-evidence/failed-barrier/fault-not-reached/cleanup failure blocks closure; preserve original failures. All listed native IDs must genuinely run with expected assertions, not merely satisfy a total count.

Each P0/P1 case below is planned **NOT_RUN**, not current evidence. Common unit precondition: scoped fakeInventoryDatabase with injectable read/execute/fault behavior and real owned Inventory modules. Common realDB precondition: isolated instance/schema above, synthetic active actor with inventory.operation, real service create→Start, reviewed0065 and concrete owned fixtures. Baseline data include two active Bins, two tracked SKUs, none/batch/batch_expiry/serial and nontracked/inactive variants, known same-SKU/foreign/expired Lots, all three Statuses, zero/positive snapshots, absent dimensions and current actor/role claims. Required unit evidence: named native JUnit plus invariant assertions; DB evidence: named JUnit, before/after line/header/Operation/Audit/lock and stock-table snapshots, actual ownership/version proof. Race cases require actual two-connection barrier and intended wait observation via performance_schema, not fixed sleeps; fault cases assert the intended fault point was reached. Exact-source/spec fingerprints/artifact hashes apply to every final check.

| ID | Priority / Requirement-risk | Preconditions / data | Input / steps | Expected result / required assertion | Initial status |
| --- | --- | --- | --- | --- | --- |
| ST037-U01 | P1 FR095, zero/NULL | uncounted owned lines | save0,positive,notFound | distinct persisted forms, real scalar Audit before/after per line, versions/time/actor, exact scalar receipt; no stock effects | NOT_RUN |
| ST037-U02 | P1 FR095, boundaries | valid fake context | 0/101 lines, duplicate IDs, null/string/fraction/unsafe quantities, mixed forms/fields | stable input/quantity errors, no writes | NOT_RUN |
| ST037-U03 | P0 FR095, version | two owned current lines | whole-batch save; stale/ceiling version | all succeed once or whole rejection; header workflowversion unchanged | NOT_RUN |
| ST037-U04 | P1 FR095, replacement | prior numeric/notFound | versioned swap to alternate form | no ambiguous old count/flag; variance remainsNULL | NOT_RUN |
| ST037-U05 | P0 FR093/098, ownership/state | foreign line/missing or foreign lock/nonCOUNTING | save/add attempted | rejects without line/Operation/Audit/stock effects | NOT_RUN |
| ST037-U06 | P0 DES007, current reads | injected stale discovery vs current root/child | wait-equivalent current recheck | canonical lock order, current owner/state/version authoritative | NOT_RUN |
| ST037-U07 | P0 FR102, replay | completed original receipt, later line changed | replay/same event changed payload/action | real Operation scalar completion/parse/replay or source conflict, original IDs/versions, no new effects/Audit | NOT_RUN |
| ST037-U08 | P0 SEC013, fresh authority | stale actor/role/permission | write and replay, post-wait actor change | fixed operation permission and fresh guard; no caller override | NOT_RUN |
| ST037-U09 | P0 FR095, atomicity | injected row/Audit/completion error | save/add faults | real per-line Audit/completion failure rollback, no partial result; existing concurrency mapping | NOT_RUN |
| ST037-U10 | P1 FR096/097, known dimensions | legal none/known batch/batch_expiry | add absent dimension | snapshot0/unfilledNULL, exact flattened line/parent receipt and scalar Audit; no master/stock creation | NOT_RUN |
| ST037-U11 | P0 FR096, Item/Lot | unknown/wrong-SKU Lot, tracking/status/field errors | invalid add | stable rejected rule, no Lot or stock side effect | NOT_RUN |
| ST037-U12 | P0 FR097, duplicate/integrity | existing line or unexpected matching Balance | add same dimension | state conflict or snapshot mismatch; no substitution or quantity rewrite | NOT_RUN |
| ST037-U13 | P1 FR095, pagination | >one page mixed progress | whitelisted filters/page edge cases | bounded rows, complete SQL summary, deterministic order, zero writes | NOT_RUN |
| ST037-U14 | P1 FR095, inquiry trust | missing/empty/beyond-end Stocktake page | query invalid fields/page/filter and valid empty page | not-found or strict error; truthful empty/summary, no auth/API claim | NOT_RUN |

| ID | Priority / Requirement-risk | Preconditions / data | Input / steps | Expected result / required evidence assertion | Initial status |
| --- | --- | --- | --- | --- | --- |
| ST037-D01 | P1 FR095, forms | 3 snapshotted owned lines | save0/positive/notFound then fresh read | distinct zero/NULL/flag, effective actual, metadata/version, no stock effects | NOT_RUN |
| ST037-D02 | P1 FR095, maximum | 100 real snapshotted lines | save full100 | all100 updated once incl valid maximum-safe quantity, exactly100 scalar Audits linked to oneOperation, summaries<=8192; one transaction | NOT_RUN |
| ST037-D03 | P1 FR095, invalid | current header/lines | empty/101/duplicate/null/string/negative/fraction/unsafe/mixed/client overrides | all rejected, complete before/after effects identical | NOT_RUN |
| ST037-D04 | P0 FR095, atomic stale | 2 current lines, one stale expectedVersion | mixed batch save | neither changed, no operation/audit commit | NOT_RUN |
| ST037-D05 | P0 FR095, horizontal owner | line from another real Stocktake | valid+foreign batch | entire batch rejects, foreign/own history untouched | NOT_RUN |
| ST037-D06 | P0 FR098, workflow guard | synthetic legitimate DRAFT/READY/POSTED/CANCELLED fixtures | save/add in each state | COUNTING-only rejection, no late effects/locks released | NOT_RUN |
| ST037-D07 | P0 FR102, same-line race | 2 connections same current lineversion | concurrent different count events | one complete winner, one version conflict; no lost update | NOT_RUN |
| ST037-D08 | P1 FR095, different-line race | 2 connections different lines | concurrent saves then current read | both results retained, header workflowversion stable | NOT_RUN |
| ST037-D09 | P0 FR102, immutable intent | completed save/add followed by later changes | original source replay and altered payload/action | real source lookup returns original exact scalar result after later line changes; no increment/reinsert/Audit; changed intent conflict | NOT_RUN |
| ST037-D10 | P0 SEC013, wait revocation | held Ware lock, waiting save/add actor | prove wait then commit revocation/release | fresh current authority rejects stale RR claims, all effects rollback | NOT_RUN |
| ST037-D11 | P0 SEC013, replay authority | prior complete receipt then revoked actor/role | new write and replay | rejects before leaking receipt/effect, original completed history unchanged | NOT_RUN |
| ST037-D12 | P0 FR095, faults | real transaction, >=2 selected lines | mid-row/second per-line Audit/complete/commit faults with reached markers | every failure fully rollback line/header/operation/audit, no stock effects | NOT_RUN |
| ST037-D13 | P1 FR096, none add | absent no-Lot dimension within owned scope | add then save0/positive/notFound | one line snapshot0/unfilled→counted, scalar Add line/parent binding, per-line Audit states; no Lot/Balance/Control creation | NOT_RUN |
| ST037-D14 | P1 FR096, registered Lots | known batch/batch_expiry, all Statuses | add legal absent dimensions incl expired/low-life | identity/date unchanged, owned FK, snapshot0, no sales eligibility/stock changes | NOT_RUN |
| ST037-D15 | P0 FR096, unknown scope | nonexistent/wrong-SKU Lot, none withLot, batch withoutLot/expiry, serial/nontracked/inactive | invalid add/forged client dates/fields | explicit fixed rejection; no master record/substitution/fake IN | NOT_RUN |
| ST037-D16 | P0 FR096, Item changed during wait | before-wait eligible Item, held Ware lock | change Item profile via synthetic owned test fixture; prove wait, release | current Item validation rejects now-invalid add, no side effects | NOT_RUN |
| ST037-D17 | P0 FR097, add race | 2 connections NULL-Lot then registered-Lot dimensions | concurrent same dimension different events | at most one committed line; real unique/FK and stable conflict, loser no operation/audit | NOT_RUN |
| ST037-D18 | P0 FR093, owner integrity | scoped Bin with missing/foreign/released semantic lock or wrongscope | save/add attempted | rejects, foreign lock never modified/released | NOT_RUN |
| ST037-D19 | P0 FR098, state changed while waiting | held Ware lock and COUNTING discovery | prove waiting save/add; commit synthetic legal READY transition under held protocol then release | current read rejects, no post-READY count/add effects; not TASK038 implementation proof | NOT_RUN |
| ST037-D20 | P1 FR095, paginated progress | >100 mixed lines incl added snapshot0/notFound | all four filters, page1/2/end/invalid | bounded ordered exact rows/total/partition summary, zero business writes | NOT_RUN |
| ST037-D21 | P1 FR095, read consistency | two connections, concurrent committed count change | coordinate header/summary/page reads in one consistent transaction | internally consistent progress snapshot; later query sees commit, no business locks/audit write | NOT_RUN |
| ST037-D22 | P0 FR093/096, snapshot anomaly | real zero/positive Balance unexpectedly absent from immutable line set | add that full dimension; fresh read count state | snapshot mismatch rather than invented0, original quantities/history unchanged | NOT_RUN |

Native IDs are DEVELOPER cases only, not new TC/UAT definitions. Risk trace: FR095→count/version/batch/query U01–09/U13–14,D01–12/D20–21; FR096/097→registered-Lot add U10–12,D13–18/D22; FR093/098/102 and SEC013→owner/state/wait/replay U05–09,D05–12/D18–19. No formal coverage result is inferred from this table.

Re-run unchanged TASK035 unit6/realDB12 and TASK036 unit12/realDB18 on the adopted new PLAN/final source, plus existing Inventory developer/inquiry regression, lint/build/audit and supporting full-native coverage with original92/83/90 and37 floors. Preserve old runs/approvals; do not relabel their source or PLAN. All original suites/TC/UAT/ledger/matrix remain unchanged. Complete P4 mapping, all writer-lock coverage, restart/capacity/HTTP/Playwright and current fiveCI/final exact-head Sam/fresh-main/MERGE_READY remain separate phase gates. P4 is one phase PR, not a per-task publication grant. No Ready/Post/started Cancel, frontend/handlers, Opening/P5, evidence export/push/PR/merge/formalTC/UAT/deploy or waiver. TASK037 requires actual independent Sam final-source review after developer proof before DONE.


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

#### TASK-038 Ready/Post/Cancel developer contract — HD152 A candidate

Proposed only until actual Sam exact DESIGN/PLAN adoption. Implement three thin TDD slices: Ready → sealed Cancel → sealed atomic Post. Historical TASK035/036/037 local DONE remains; no HTTP/UI, schema, public route, P5 or formal acceptance activation.

Exact source/test scope (five paths):

- `server/src/modules/inventory/InventoryStocktakeService.js`: additive ready/readyInTransaction, post/postInTransaction and cancel/cancelInTransaction; preserve Create/update/Start/saveCounts/addLine and trusted-domain cancelDraft behavior.
- `server/src/modules/inventory/inventoryHighRiskContext.js`: additive fixed `stocktake.post` / `/api/v1/inventory/stocktakes/:id/post` / `STOCKTAKE_POST` intent and canonical route-id binding only. Existing Adjustment/Status/Reversal contracts and strength unchanged.
- `server/src/modules/inventory/inventoryStocktakeCancelContext.js`: new single-purpose non-forgeable server-issued jwt-password capsule for `stocktake.cancel`; no device required, no generic auth replacement.
- `server/test/inventoryStocktakeFlow.test.js`: new24-case native unit file using actual Operation/Audit/guard serializers with scoped fake DB.
- `server/test/integration/inventoryStocktakeFlow.integration.test.js`: new34-case owned realMySQL26.7 native file with actual transactions, source lookup, capabilities and persistence.

Immutable regression:0065, TASK035/036/037 six tests and the whole InquiryService remain byte-identical. Existing PostingService, Adjustment/Reversal/Reservation/Lock services, Item/authorization/framework/config/permission catalogue/migrations, frontend/handlers and dependency/CI/coverage config remain untouched. Do not create a generic lock bypass or loop through single Adjustment operations. Changed HighRiskContext must regress existing issuer/consumer/handler tests from the fixed inventory-developer group, plus full-native/37 floors. Historical approval of StocktakeService does not approve unseen new methods.

**Input and receipt.** Ready only `{stocktakeId,expectedVersion}`; Post and new sealed Cancel only `{stocktakeId,expectedVersion,reason}` (nonblank trimmed safe text, max500UTF8bytes). IDs/versions are positive safe integers, expectedVersion<=uint32; no lines, quantities, snapshots, variance, status, actor, permission, auth proof, password or device override fields. Different actions need distinct domain events. Ready/post/cancel use STOCKTAKE_READY/POST/CANCEL and resultType STOCKTAKE/resultId parent. Ready scalar `{id,operationId,status:"READY_TO_POST",version,rowCount:totalLines}`; Post scalar `{id,operationId,status:"POSTED",version,rowCount:nonzeroVarianceLines,movementGroupId:UUID|null}`; Cancel scalar `{id,operationId,status:"CANCELLED",version,rowCount:scopeBins}`. Replays reauthorize with a fresh applicable request capsule and return the original scalar, no current-state reconstruction or repeated Audit/Movement/release. Altered source intent conflicts; unknown commit is resolved by source lookup, never blind new-event retry.

**Ready.** Fixed stocktake.ready/inventory.operation and fresh actor. Claim then Warehouse/Bins/own persistent locks/root/scope/all lines under canonical order; revalidate after waits. COUNTING/current expected workflowversion only. Every line must have numeric count>=0 or explicit NOT_FOUND(null+flag1); null+flag0 is incomplete. Reject corrupt count flags, dimensions/ownership or unsafe stored counts/snapshots. Complete zero-line scope is allowed: no rows is not fabricated stock, explicit Ready still required. Freeze the latest committed current counts (Count/Add do not bump workflowversion), not a client-displayed list. Compute signed actual-snapshot safely for every line, store variance only; line.count/snapshot and line.version unchanged. Header increments once, ready_operation_id/time/user set, scalar header Audit and completed Operation atomically; no stock changes or lock release. Ready state prohibits all count/add; no reopen.

**Sealed Cancel.** New cancel requires a fresh server-issued, one-use opaque context with exact jwt-password auth type, POST route template, canonical path/body id, actor/claims, normalized command action/source/payload/correlation intent and existing session/clock limits. Keep only minimal trusted metadata, no raw password/JWT/device secret. Domain consumes the actual WeakMap record, rejects caller objects/booleans, reused/changed contexts and device-password substitution for this fixed flow. Recheck current user/roles/view+operation, token version, JWT exp/absolute session age/time/cancellation signal before effects and replay, with current locking reads after business waits. No new auth framework or global time policy.

Cancel accepts DRAFT/COUNTING/READY_TO_POST only with current workflowversion and mandatory reason. Retain scope/lines/variance/operation/audit history. DRAFT expects no own active locks; started states require one exact own active lock per scope, no missing/released/foreign/mismatched owner. Release only exact owned rows in this transaction; no delete, foreign unlock, stock/movement/allocation/reservation mutation. Header increments once, cancelled metadata/operation/reason set with Audit/Operation. Inactive Warehouse/Bin does not strand a valid own cancellation; fixed ownership and fresh authorization still apply. Existing cancelDraft remains trusted-domain DRAFT-only compatibility for already reviewed callers/tests; TASK039 HTTP cancellation must use the new sealed cancel entry, never route to that old method.

**Sealed Post.** Fixed stocktake.post/inventory.adjust; actual existing high-risk capsule extended only for the new allowlisted action, commandType and route id. It continues to require jwt-device-password, view+adjust, current actor/roles/JWT version/expiry/session limits, approved exact device+key and signed-request time. No inventory.operation substitute or caller proof. Consume once, check before claim and using current locking reads after business waits/before writes/replay; expiry/revocation/abort during waits fully reject. For new Ready/Post/Cancel operations defer nullable actor FK attribution until post-wait current authorization, as in existing high-risk posting, to avoid user-FK locks preventing the revocation being tested; Audit/header retain actual actor and request attribution. Do not change old command claims.

READY_TO_POST/current workflowversion only. Warehouse/Bins active; all scope rows, locks and lines current and owned. Discover metadata only to sort locks, then current-read again. Lock Warehouse→changed-SKU StockControls→scope Bins/active locks→known Lots→full-dimension Balances→Stocktake root/children; current coverage reads use the established Warehouse/Control serialization pattern, not an earlier RR aggregate. Full stored line set must be complete, count/flag/variance consistent, and actual-snapshot equal the stored Ready variance. Existing snapshot Balance identity/full dimension/current quantity and snapshot version must match; mismatch is integrity STOCKTAKE_SNAPSHOT_MISMATCH, not a stale client optimistic update. Use current locked versions for writes; keep snapshot versions historical. Added snapshot0/null-balance lines require the full dimension still absent; do not substitute a later Balance or create a zero Balance for a zero difference.

Validate all before effects: safe quantities/versions/deltas, current Item-owned usable/tracked/nonserial/BaseUOM/Tracking rules, existing same-SKU Lot identity/required stored expiry/valid stored date order; no Lot creation/date edits. **HD152 A**: positive physical variance of such an existing legal Lot may be expired or below minimumReceiptLife; this is Stocktake reconciliation, not Receipt/positive Adjustment and not receiving.expiry.override. Original Bin/Lot/Status retained; current sale-purpose expiry/minlife eligibility unchanged, expired AVAILABLE never eligible. Negative/zero variance gets no new blanket expiry ban. Receipt/Adjustment/Reversal behavior remains byte-identical.

For every Bucket, final actual>=current allocated; no moving/consuming/releasing Allocation or changing Reserved. Calculate unchanged Warehouse/SKU uncoveredReserved before and after the **complete final** multi-Bucket variance effect using current sale-eligible quantities; cannot increase uncovered, existing natural-expiry uncovered does not demand full coverage. A gain in another eligible Bucket may offset aggregate reserved coverage loss in this same atomic Stocktake, but can never pay for an allocated shortage in a specific Bucket. This final-state rule is a precise proposal for review, not an implicit per-row Adjustment loop. Date crossing during the transaction rejects CONCURRENT_OPERATION rather than mixing eligibility/FIFO dates; no automatic retry with a new event.

Each nonzero variance writes one positive Base-quantity STOCKTAKE_VARIANCE IN/OUT leg in one shared group/one parent Operation, with stocktake_id/line_id, current Item/location/Lot snapshots and before/after/version. Update only the relevant Balance, metadata/FIFO/version and the corresponding line movement_id/line.version+1. None-Lot FIFO: positive→positive preserve,0→positive server local date,→0 NULL; Lot dates unchanged. Zero differences have no Movement or Balance/version/control creation; their movement_id staysNULL. All-zero Post still requires strong proof, records header/audit/completed Operation with movementGroupIdNULL/rowCount0 and releases owned locks. Include one scalar per nonzero line Audit `{id:lineId,stocktakeId,quantity:onHandBefore|actual,version:balanceVersion,status:stockStatus,movementId:null|newId}` plus one scalar workflow header Audit; shared whitelist/8192 unchanged. No nested line summaries, password/proof/claims in payload/hash/receipt/audit.

Only after all effects/Audits succeed, link header post_operation_id/metadata, set POSTED+version once, release all exact owned active Bin locks and complete parent Operation in the same transaction. Any second/later Balance/Movement/line-link/Audit/header/release/completion/commit fault must leave original READY data and active locks, including originally absent Balance/Control rows. Zero/terminal replay and Post/Cancel race must retain one complete final outcome; no shared memory-duration lock.

**Developer execution candidate.** Two serial Node26 `node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/<suite>.xml <nativefile>`,1800s, DEVELOPER only, minima24unit/34realDB, zero skips. Real DB forwards only DB_NAME/DB_SOCKET/DB_INTEGRATION_TESTS/INVENTORY_STOCKTAKE_FLOW_TESTS; both test flags must be1. Fresh owned `erp_inventory_task038_<unique>` and socket-only26.7.0 `/private/tmp/erp-inventory-task038-mysql-2670.<unique>/mysql.sock`, actual PID/datadir/schema/version/skip_networking/fresh-table ownership verified. Existing0055–0065 dependency slice and minimal synthetic auth tables only, no new migration. Standing local-resource authority/exact cleanup unchanged. Unit fake DB may inject faults/current reads; both suites use actual Operation/Audit/capsule issuers/consumers, never a fake accepting guard. Trusted request fixtures model already-successful middleware metadata only, not proof of actual HTTP password/device-signature validation; actual routes/browser remain later mandatory P4 gates.

Common preconditions/data: synthetic active view+operation counter and view+adjust device approver, distinct no-op/no-adjust/revoked actors, current JWT/version/time/approved device/key, owned two-Bin Draft→Start→Count→Ready, none/batch/batch_expiry/serial/nontracked/inactive variants, existing expired/low-life Lots,0/positive snapshots/added absent dimensions, current Allocation/Reserved and known later-fault checkpoints. Evidence: named zero-skip native JUnit, exact-source/PLAN/command/env metadata, whole header/scope/line/lock/Balance/Control/Lot/Movement/Reservation/Allocation/Operation/Audit before/after queries. All races require two real connections and performance_schema intended Warehouse wait, fault cases assert reached point. All cases initially NOT_RUN; no executable new test file or new run exists yet.

| ID | Priority / requirement-risk | Specific precondition / input | Expected result and required assertion | Status |
| --- | --- | --- | --- | --- |
| ST038-U01 | P1 FR098 Ready | complete0/positive/notFound lines; ready | correct signed variance,headerv+1,linecounts/versions unchanged,no stock effect | NOT_RUN |
| ST038-U02 | P0 FR098 incomplete | one null+flag0 amongst complete rows | entire Ready reject/no op,audit,variance,lock effects | NOT_RUN |
| ST038-U03 | P0 FR098/102 input | badID/version/unknown fields/missing reason/stale/ceiling/wrong state | fixed input/state/version rejection,zero effects | NOT_RUN |
| ST038-U04 | P0 SEC013 ready/replay | current actor lostpermission after discovery | fresh op permission,original scalar replay reauth/changed intent conflict | NOT_RUN |
| ST038-U05 | P0 FR101 cancel | missing/forged/reused/mismatched raw context | actual Cancel WeakMap rejects before business effects | NOT_RUN |
| ST038-U06 | P0 SEC013 cancel claims | valid capsule, staleuser/role/JWT/time/abort | fixed view+operation and current guard,replay denied | NOT_RUN |
| ST038-U07 | P1 FR101 validcancel | DRAFT/COUNTING/READY including inactive bins | own release/history preserved,no stock/Movement;scalarreceipt | NOT_RUN |
| ST038-U08 | P0 FR093/101 owner | foreign/missing/released/scope-corrupt lock | entire cancelreject,foreign untouched | NOT_RUN |
| ST038-U09 | P0 FR101/102 terminal | successful original cancel then replay/new event | original scalar/no repeated release;terminal conflict | NOT_RUN |
| ST038-U10 | P0 SEC013 highrisk | post forged/cross-action/route-id/reused proof | actual old HighRisk issuer/consumer binding rejects | NOT_RUN |
| ST038-U11 | P0 SEC013 postcurrent | capsuleJWT/device/key/time/signal changes | fresh view+adjust/device/time checks,op role no substitute | NOT_RUN |
| ST038-U12 | P1 FR099 mixedpost | positive/negative/zero variances | oneparentOp/group,nonzero Movement/link/Audit only,scalarreceipt | NOT_RUN |
| ST038-U13 | P1 FR099/HD152 expiry | known expired/low-receipt-life Lot,+variance | physicalIN allowed,saleeligibility/dates/Status unchanged | NOT_RUN |
| ST038-U14 | P0 FR085/099 ItemLot | serial/nontracked/inactive/wrongLot/expiry/override | reject all, no master/substitution/Receipt | NOT_RUN |
| ST038-U15 | P0 FR099 snapshot | identity/quantity/version or added-Balance mismatch | integrity error,original READY/locks intact | NOT_RUN |
| ST038-U16 | P0 FR099 allocation | actual below allocated despite anothergain | perBucket protection rejects,no Allocation mutation | NOT_RUN |
| ST038-U17 | P0 FR050/099 reserved | preexistinguncovered and multibucketfinalgain/loss | finalcoverage cannot worsen,no perrowloop false failure | NOT_RUN |
| ST038-U18 | P1 FR099 zero | zero/allzero including added absent dimension | no stock/control/Movement/group creation,requiredproof/release | NOT_RUN |
| ST038-U19 | P1 FR099 FIFO | noneLot positive→positive/0→positive/→0 | anchorpreserve/currentdate/NULL;Lotdates immutable | NOT_RUN |
| ST038-U20 | P0 FR099 safeints | signedvar/maxqty/uint32/midnight | validboundaries/overflow or datechange reject beforeeffects | NOT_RUN |
| ST038-U21 | P0 FR099 faults | injected laterMovement/Audit/release/complete/commit | whole rollback incl newrows;reached fault markers | NOT_RUN |
| ST038-U22 | P0 FR099/102 replay | completed post then later unrelateddata | real source parser/originalscalar/no duplicates;alteredintentconflict | NOT_RUN |
| ST038-U23 | P0 FR098/101/102 ordering | current states differ from discovery | current root/complete lines/ownership dominate after wait | NOT_RUN |
| ST038-U24 | P0 compatibility | existing Adjustment/Status/Reversal capsules and old Draft/count paths | original strict semantics and old fixtures preserved | NOT_RUN |

| ID | Priority / requirement-risk | Specific precondition / input | Expected result and required evidence | Status |
| --- | --- | --- | --- | --- |
| ST038-D01 | P1 FR098 Ready | real3forms in multipleBins | exact signedvariance,metadata/version,readonly stocks,locks held | NOT_RUN |
| ST038-D02 | P0 FR098 incomplete | one uncounted vs explicitmissing,empty scope | incomplete rejects;explicit complete empty Ready allowed;no inventedline | NOT_RUN |
| ST038-D03 | P0 FR098/102 ready race | actual Warewait, waiting sameversion Ready | onewinner/oneversion conflict,one frozenline set | NOT_RUN |
| ST038-D04 | P0 FR095/098 count race | both Count-first and Ready-first with observedwait | latestcountfreeze OR subsequentcountreject,no postReadyedit | NOT_RUN |
| ST038-D05 | P0 FR096/098 add race | both Add-first and Ready-first with observedwait | newuncountedline makesReady reject OR AddrejectafterREADY | NOT_RUN |
| ST038-D06 | P0 FR098 faults | midvariance/header/Audit/complete/commit failures | reached checkpoints;fullReady rollback | NOT_RUN |
| ST038-D07 | P0 SEC013 Ready | real revokedpermissions/current actor during Warewait/replay | freshop authority,no metadata leakage/effects | NOT_RUN |
| ST038-D08 | P0 FR101 Cancel capsule | wrongauth/method/path/id/actor/intent/forged/reuse | real issuer/consumer denies,wholebusinessstate unchanged | NOT_RUN |
| ST038-D09 | P1 FR101 Cancel | Draft/Counting/Ready active and inactiveWare/Bin | valid own cancellation retains history/releases exactowned,no stock movement | NOT_RUN |
| ST038-D10 | P0 FR093/101 Cancel owner | missing/released/foreign/composite mismatch real fixtures | realFK+serviceguard reject,noforeignunlock | NOT_RUN |
| ST038-D11 | P0 SEC013 Cancel revocation | JWTversion/user/role/time abort committed during actualwait | currentcapsuleguard denies,ownlocks retained | NOT_RUN |
| ST038-D12 | P0 FR101/102 Cancel race | concurrent cancels/Ready vsCancel with intendedwait | one validfinaloutcome/versionconflict,no lostscope/history | NOT_RUN |
| ST038-D13 | P0 FR101 faults | secondrelease/header/Audit/complete/commit | reached failure fully rolls back header+alllocks | NOT_RUN |
| ST038-D14 | P0 FR101/102 replay | terminaloriginalcancel vsnewevent/changedreason | real originalscalar/no unlockrepeat;terminal/source conflict | NOT_RUN |
| ST038-D15 | P0 SEC013 Post capsule | fixed post route/action/id/actor/intent and legacyroutes | rejectforgeries,wrongmode/reuse;oldproof contracts regress | NOT_RUN |
| ST038-D16 | P0 SEC013 Post revocation | real user/role/JWT/device/key changes during intendedWarewait | fresh view+adjust+exactdevice deny/rollback;opnot substitute | NOT_RUN |
| ST038-D17 | P0 SEC013 Post time | expiry/session/skew/abort during wait and replay | no stale capsule posting/replay;original history untouched | NOT_RUN |
| ST038-D18 | P1 FR099 mixedPost | 3statuses/none/knownLot,positive/negative/zero,multipleBins | exact stocktargets/links/oneOp+group/perlineAudit,releaseafterall | NOT_RUN |
| ST038-D19 | P1 FR099 HD152 | expired andunexpired belowreceiptmin all3statuses positivevar | acceptphysicalIN,Lotdates/Status/saleATP/Allocation rules unchanged | NOT_RUN |
| ST038-D20 | P1 FR099 zeroPost | existingzero andnewabsentzero plusallzero fullscope | nobalance/control/version/Movement creation,strongproof,scalarNULLgroup,ownrelease | NOT_RUN |
| ST038-D21 | P0 FR099 snapshot | actualquantity/identity/version changed ornewBalance foraddedline | SNAPSHOT_MISMATCH,READYandlocks retained, no inventedzero | NOT_RUN |
| ST038-D22 | P0 FR099 allocation | real currentallocated greaterthan actual,anotherBucketgain | entirepost blocked;Allocated/Reservationunchanged | NOT_RUN |
| ST038-D23 | P0 FR050/099 reserved | finalcoverage decreases/unchanged/alreadyuncovered/netgain-loss | cannotworsen,finalatomicnetaccepted ifsufficient,no reservationrewrites | NOT_RUN |
| ST038-D24 | P1 FR099 FIFO | noneLot0/positive targets withserverdate + existingLots | correct anchors/datepreservation,Balance version+1 only changed | NOT_RUN |
| ST038-D25 | P0 FR099 quantity | safeMAX/signeddelta/uint32/aggregate overflow | validlimits accepted;unsafe/overflow whollyreject | NOT_RUN |
| ST038-D26 | P0 FR099 dayboundary | clock changesafterbusinesswait/eligibilitybaseline | CONCURRENT_OPERATION, no mixed-dateeffect or automaticnewretry | NOT_RUN |
| ST038-D27 | P0 FR099 Item | Item/Tracking/BaseUOM/Lot state committedduring actualWarewait | Item-owned currentvalidation rejectsinvalid,nostaleprofile/extraLot | NOT_RUN |
| ST038-D28 | P0 FR093/099 Post owner | inactiveWare/Bin,foreign/missing/released/scope-corruptlocks | wholepostreject andforeignlockunchanged | NOT_RUN |
| ST038-D29 | P0 FR099 faults | secondBalance/Movement/linelink/Audit/header/release/complete/commit | reached faults roll back ALL incl originallyabsentrows,READYlocks persist | NOT_RUN |
| ST038-D30 | P0 FR099/102 Post race | two real postrequests sameworkflowversion,observedwait | one complete winner,no doubled stock/Movement/Audit/release | NOT_RUN |
| ST038-D31 | P0 FR099/101 terminalrace | Post-first andCancel-first actualWarewait | exactlyone terminaleffect;otherstableconflict,nopartialIN/unlock | NOT_RUN |
| ST038-D32 | P0 FR099/102 Post replay | actualsource lookup afterlater unrelatedwrite,changedintent/noauth | exactoriginalscalar/currentauth,nonewrows;terminal/source conflict | NOT_RUN |
| ST038-D33 | P0 FR100 immutable | postthenrepeatReady/Count/Add/Cancel/NewPost | allterminal mutationsreject,nohistory change;oldcount replaystilloriginal | NOT_RUN |
| ST038-D34 | P1 FR099 fullbatch | 100nonzero lines and100zero,multiBucket,realguards | onefulltransaction/Op/group,exactnonzeroAudits/links andzeroabsence,notcapacitySLA | NOT_RUN |

Risk trace: FR098→U01–04/U23,D01–07; FR101→U05–09/U23,D08–14/D31; FR099/100→U12–22,D18–34; SEC013→U04–06/U10–11,D07–08/D11/D15–17/D32; HD152/FR085/050→U13–17,D19/D21–23/D27. These are DEVELOPER IDs, not new formal TC/UAT definitions. No test can becomePASS until actually run on the adopted spec/final source; check all native IDs, not just totals.

After adoption and implementation rerun immutable0356/12,03612/18,03714/22, old Inventory207/current inquiry/posting/issuer tests, lint/build/audit and full-native coverage retaining original92/83/90 and37 floors. All old commands/env/case minima/skip ceilings remain. New source/spec invalidates old evidence use, not history; no old PASS rebinding. Actual Sam final-source review needed before TASK038 DONE; fullP4 writer/restart/capacity/authenticatedHTTP/password/Playwright/current fiveCI/finalhead/freshmain/MERGE_READY and phase-PR timing unchanged. No evidenceexport/push/PR/merge/formalTC/UAT/deploy/P5/waiver.


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

### TASK-039 exact public contract and developer verification proposal — HD156

PROPOSED / NOT_ADOPTED / NOT_RUN. Actual HD155 A authorizes PREVIEW/FROZEN direction, not this exact public/file/authentication/command contract. Adoption requires actual Sam DESIGN/PLAN/scope approval. All checks are DEVELOPER; no formal TC/UAT or release inference.

**Public routes and writes.** Activate exactly the twelve existing §5.7 routes, no new workflow state/permission/schema migration. Four GETs use jwt+inventory.view; create/update/start/counts-save/lines-add/ready use jwt+view+operation; Post uses jwt-device-password+view+adjust; Cancel uses jwt-password+view+operation, no device. URI :id must be canonical positive safe-integer decimal text; no coercion of write body. Body uses existing source object and domain payload fields, not client actor/authorization/proof/status/snapshot/variance. Create {source,warehouseId,binIds,reason?}; update {source,binIds,expectedVersion,reason?}; start/ready {source,expectedVersion}; save {source,lines:[{lineId,expectedVersion,countedQuantity}|{lineId,expectedVersion,notFound:true}]} (1–100, unique lineId); add {source,binId,skuId,lotId,stockStatus} with existing legal Lot/none=NULL; post/cancel {source,expectedVersion,reason,password}. No workflow expectedVersion on Count/Add; Add lineId/version remain line-owned. Bin IDs unique/nonempty, no new artificial Bin-count limit. Preserve existing scalar replies/error codes, Base-UOM integer quantities, source replay and public success envelope. Reason trims, excludes control chars, <=500 UTF8 bytes; post/cancel require nonblank; password 1–1024 characters never normalized/persisted. Strict schemas and handler-owned business normalization both apply even if global validation is disabled. Old endpoints remain unchanged.

**Authentication/idempotency.** All eight POSTs explicitly use 604800000ms HTTP TTL, existing source tuples are domain identities, never equated to header keys. Handler-owned preparation on all writes returns frozen credential-free canonical input plus replay callback, rechecks current JWT/user/roles/view+action permission before cached replay and after HTTP-store waits; ordinary writes still call unchanged StocktakeService. Post reuses unchanged HighRiskContext; CancelContext gains only non-consuming check export using the same private intent/time/current checks, then consumes once in existing domain method or cached replay. No fake boolean proof, claims from body, bypass, global auth/framework/Idempotency/Operation/Audit/serializer change. Cached replay sends original response exactly once while current authorization/token-version/device (Post only) read locks are held; failures retain prior success key/result and produce only safe failure audit. Retry requires fresh actual password/JWT/signature/nonce; changed credentials do not change business fingerprint, changed source/business intent conflicts. Capsule binds action, URI id, actor, complete normalized source/payload/correlation. No claim that trusted fixtures prove real HTTP verification.

**Read contracts (HD155 A).** Add public Inquiry methods without changing existing listStocktakeCountLines or other inquiries. Public reads current-check trusted JWT/user/role/view/token-version/session/abort before data access and immediately before response; current auth reads must not use an old data snapshot. Each response uses a single RR consistent data snapshot (no business writer locks), asOf epoch ms at first data read, header workflow version and each returned line version. GET list filters {warehouseId,binId,status:ALL|DRAFT|COUNTING|READY_TO_POST|POSTED|CANCELLED,dateFrom?,dateTo?,page=1,pageSize=20}; dates are valid inclusive YYYY-MM-DD created-local-day limits, from<=to. Fixed id descending; bin filter uses EXISTS so no duplicate header; safe offset, pageSize<=100. Result {items,total,page,pageSize,asOf}. GET detail query {scopePage=1,scopePageSize=20}, returns header, paginated scope {items,total,page,pageSize}, global progress and varianceSummary; no all-Bins eager load. Scope shows immutable binCodeSnapshot and separately labelled current code/status; current SKU/name/Lot/BaseUOM display references are not historic snapshots. Missing header 404 safe existing error.

GET lines/export share filters {binId?,skuId?,lotId?,stockStatus:ALL|AVAILABLE|QUARANTINED|DAMAGED,progress:ALL|UNCOUNTED|COUNTED|NOT_FOUND,variance:ALL|GAIN|LOSS|ZERO}; GET lines also page/pageSize, fixed id ascending. Filtered total and filtered summary explicitly separate from global progress/summary; no mixed-page summary. Numeric counts/ids/versions validated as safe integers. Summary counts lines in gains/losses/zero/uncounted, never adds incomparable quantities across SKUs/UOMs. DRAFT stage NOT_STARTED; COUNTING stage PREVIEW; READY_TO_POST/POSTED FROZEN; CANCELLED with ready metadata uses FROZEN, otherwise with started metadata PREVIEW, otherwise NOT_STARTED, plus cancelled:true. Corrupt marker/frozen-null/inconsistent count/variance fails integrity, not silent coercion. actual is counted quantity, explicit notFound=0, untouched=NULL. Preview computed only for actually counted rows, never written. Frozen comes from persisted variance and validates actual-snapshot consistency. GAIN/LOSS/ZERO exclude NULL; explicit count0/notFound with snapshot0 belong ZERO; uncounted never ZERO. Every line includes stage, countState, snapshotQuantity, snapshotBalanceId/version, actualQuantity, varianceQuantity, version, movementId (NULL before real post), scope/Bin/SKU/Lot/Status and current display BaseUOM. Cancelled never labelled posted. Independent requests need not share asOf; earlier previews can become stale. Post ignores public previews.

**CSV and resource boundary.** Stocktake-only InventoryStocktakeExportService, no generic P5 export framework. Reuse installed csv-stringify and Item-owned sanitizeCsvCell read-only; RFC quoting/UTF8/CRLF, every text cell neutralized including formula/CR/tab prefixes, numeric quantities remain numeric. Stable columns: recordType,stocktakeId,stocktakeNumber,status,cancelled,varianceStage,asOf,workflowVersion,scopeId,binId,binCodeSnapshot,binCodeCurrent,lineId,lineVersion,skuId,skuCodeCurrent,skuNameCurrent,baseUomId,baseUomCodeCurrent,lotId,lotNumberCurrent,stockStatus,snapshotBalanceId,snapshotBalanceVersion,snapshotQuantity,countState,actualQuantity,varianceQuantity,movementId,filteredLineCount,scopeCount,exportedRows,truncated,truncationReason,generationBudgetMs,filterHash. SCOPE record for every selected Bin even empty; LINE for matching lines; final SUMMARY always carries filterHash/counts/cap metadata. generationBudgetMs is populated only on SUMMARY, blank on SCOPE/LINE; TIME_LIMIT refers to the reported effective limit. Scope is the complete planned scope, not falsely reduced by line filters; quantities on SCOPE/SUMMARY blank. SQL keyset batches <=500 for scopes then lines in one RR snapshot, bounded batches/backpressure, never materialize entire dataset. Stocktake effectiveMaxRows=min(config.exportMaxRows,100000) caps SCOPE+LINE rows (footer excluded), including global env overrides above100000; lower configured caps remain effective. Existing config values/defaults are not rewritten. exportTimeoutMs120000 is the existing generation upper bound. At a deliberate safe complete-batch stop with known metadata/prefix, add SUMMARY truncated true ROW_LIMIT/TIME_LIMIT; in-flight generation cutoff is REQUEST_TIMEOUT504 and no CSV. A genuine DB timeout/abort/error is failure, never relabelled successful truncation.

To truthfully set final truncation headers before response bytes, generate incrementally into one request-owned random 0700 directory/0600 CSV file, no reusable export URL/job/cache. Close generation transaction/file before streaming through existing BaseRequestHandler.file({stream}); not an in-memory buffer. Header X-Inventory-Export-Truncated:true|false, X-Inventory-Export-Reason:NONE|ROW_LIMIT|TIME_LIMIT, X-Inventory-Export-As-Of, plus existing safe Content-Disposition/UTF8/private,no-store and Pragma:no-cache. HD157 A candidate: export route timeoutMs120000 only, compatible with unchanged default requestReceiveTimeoutMs120000. Before generation compute remainingMs from trusted req.requestTimeout.deadline minus current server time; nonpositive/invalid deadline fails closed. Effective generationBudgetMs=min(config.exportTimeoutMs,floor(remainingMs/2)), <=60000ms under defaults and lower after authentication/wait, never refresh or extend original deadline. Keep remaining request time for delivery; original request abort still terminates generation/stream, never successful truncation. Config exportTimeoutMs120000 is an upper bound, not a promise to spend120s on generation. Header X-Inventory-Export-Generation-Budget-Ms and SUMMARY generationBudgetMs report actual limit; global/auth/lease/receive defaults unchanged. Current JWT/session/token-version/view rechecked using short current reads between generation batches and before each delivery chunk; denial stops disclosure (after headers: failed connection, not new JSON/complete footer). No Inventory business locks held for download. Audit existing inventory.export action with STOCKTAKE target, scalar {stocktakeId,rowCount,version,status}, reasonCategory EXPORT and bounded reasonText containing canonical SHA256 filter hash/truncation metadata; no whitelist extension/rawCSV/password/token/signature. Audit SUCCEEDED means completed generation authorized for delivery, not claimed client delivery; later disconnect/revocation logged as failed outcome separately. Audit failure before response fails closed. Exact owned file/dir removal on success, preparation error, abort, stream error/close; no broad tmp cleanup. Crash orphan risk is explicit and requires TASK041 recovery/retention verification before fullP4 closure; not production readiness. Memory-bounded generation adds temporary-disk/I/O cost; no new global file root/dependency. Client getBlob uses existing abstraction and same encoded filters (no auth-bearing download URL); CSV SUMMARY is authoritative truncation metadata because existing getBlob need not expose custom headers.

HD158 A candidate — bounded independent generation reader: one non-queued active Stocktake CSV generation slot per primary MySqlDatabaseService identity per application process. Acquire only after trusted initial authorization; when busy return existing INVENTORY_DEPENDENCY_UNAVAILABLE503, no hidden wait/job/cache and no file or auxiliary pool creation. The active generation owns a temporary one-connection MySqlDatabaseService pool made by existing connection factory using the same normalized primary database endpoint/schema/user/credentials/TLS/session options; connectionLimit/queueLimit are fixed1 for this owned reader and a module-local owned-transport close observer is required. No broader database grant/new credential/global config/source change. RR data snapshot uses this reader only; short current authorization and Audit use primary database, never its stale RR snapshot. Maximum one additional client SQL connection per process/database-service identity during generation (deployment worker count multiplies that bound), not one extra per concurrent request; primary connectionLimit1 remains usable. Close/abort auxiliary transaction, shutdown owned pool and release slot before delivery; all acquisition/SQL/error/abort/init/shutdown paths are accounted, fail closed on teardown failure and do not release for replacement while previous owned reader remains live. Explicit terminal ownership condition: MySqlDatabaseService.shutdown()/mysql2 pool.end() promise alone is not sufficient because installed Quit invokes its callback before writing COM_QUIT/socket closure. The Stocktake-owned reader must observe each newly created client transport from creation before connect/handshake, using a module-local mysql2 supported stream-factory observer and Node Unix/TCP socket lifecycle, preserving transport/TLS verification/keepalive/session behavior; no shared primary socket, private pool-array inspection, framework patch or global configuration change. Only connectionLimit/queueLimit plus this transport lifecycle observer differ in the owned reader configuration. Gate release/delivery requires all observed client sockets to emit terminal close (including failed handshake/acquisition, transaction abort and rejected shutdown), not merely end/destroy-called/service.closed. No second owned client may start while an earlier observed transport has not closed; no reconnect/retry before that terminal condition. On teardown error/unknown close, fail closed, retain the occupied slot until eventual confirmed close; if never confirmed, that process export path remains503 and needs controlled process recovery, not a silent release. D11/D17 must inject delayed close and rejected shutdown/handshake, assert no replacement/delivery before close, eventual slot recovery and zero owned client sockets on completed paths. Request failure may return promptly; owned cleanup must still settle/account pending writes and transport closure after request termination if necessary, without continued dataset work or new request deadline. This is not a hard realtime OS/server-transaction termination guarantee. Full process/restart recovery and deployment worker connection budget remain TASK041 obligations. No auxiliary connection during streaming; chunks still current-check primary authority. Busy503 is a disclosed throughput tradeoff, not a blanket availability guarantee under ordinary primary DB overload. Fullscale/cross-worker/restart/retention verification stays TASK041.

HD158 A candidate — explicit work-cutoff semantics: keep original route120000ms, shared defaults and generationBudgetMs=min(config.exportTimeoutMs,floor(original remaining route deadline/2)); start budget after initial authorization without refreshing the original deadline. An owned timer/signal plus after-await time checks covers auxiliary reader acquisition, snapshot metadata/summaries/keysets, batch current-auth and temporary-file data writes, including empty/full results. At a safe complete-batch boundary before starting further data work, if metadata and a confirmed complete prefix exist, deliberate stop may finalize TIME_LIMIT SUMMARY using the remaining original request time. If the cutoff occurs during an in-flight wait/query/auth/data write, or metadata is unavailable, abort/fail closed using existing RequestTimeoutError REQUEST_TIMEOUT504; do not salvage/reclassify a failed query or partially written file as a successful truncated CSV. Genuine DB/query/disk/Audit errors and request disconnect/abort retain failure, not TIME_LIMIT. No late NONE/untruncated result accepted; distinguish a causally owned generation abort from a competing genuine/request failure. After work cutoff only prefix footer/transaction and pool teardown/final authorization/Audit/delivery may use original remaining route time, never a new deadline or further data reads. Failure cleanup alone may settle/account owned resources after request termination; no generation continuation or success after the original request abort. Thus generationBudgetMs is the cutoff for starting/accepting dataset work, not a hard real-time guarantee that OS writes/server queries/cleanup finish instantly; cancellation is best-effort and in-flight file writes must settle before closing/removing owned files. No partial data stream on failure. Audit failure before response remains closed. This choice can return504 rather than partialCSV for a slow successful query; preserving partial output from interrupted operations would require a separate prefix recovery design, not silently implemented here.

**HD160 A / HD161 candidate — temporary reader ownership.** Only the Stocktake Export module creates one private existing ServiceContainer per admitted generation; this is not an application/global registration or a reusable shared factory. Register the existing MySqlDatabaseService definition using its actual static name/lifecycle/dependencies/ServiceClass and resolve it through the existing container path; never directly construct that public service, alias/reflect a constructor, fake successful initialization, or weaken serviceContainer.test.js. The container owns only this MySQL service. Borrow the primary logger via a non-owning logging dependency value and the primary RequestContext through a non-owning get/update dependency value; these values are not owned definitions, recreated services or shutdown targets. The context value returns the original request fields/deadline with only signal overlaid by the combined original-request/generation workSignal, delegates update to the existing context, and never mutates the primary request signal/deadline. This minimal overlay is required so the existing initialize/healthCheck SELECT1 receives the generation cancellation as well as request abort; primary current authorization/Audit keep their original context. Use config.database copied from normalized primary config with only approved connectionLimit1/queueLimit1/owned stream observer, and the existing createMySqlDatabasePool through the existing options.poolFactory seam. Endpoint/schema/user/SecretValue/TLS/session and primary pool remain unchanged; no private driver arrays or new dependency/config/environment knob.

Publish the private owner handle and attach its workSignal listener before starting asynchronous container resolve. Pre-aborted signals and a closed owner cannot begin initialization, factory/connection creation or data work. Start/retain exactly one initialization promise, await it through the existing work-budget check, and require actual MySQL initialize plus successful healthCheck before RR data access. The original generation budget includes container dependency resolution, pool creation, logging/health check/handshake and acquisition; no fresh deadline/extra initialization allowance. Abort/close first marks the owner closing synchronously (factory/stream observer forbids all later pool/transport creation), destroys only already observed owned transports, and consumes late initialization resolution/rejection. Generic singleton container.shutdown does not await in-flight initialization: the module must await the owned initialization settlement before invoking/awaiting container.shutdown, and still await every pre-handshake observed socket terminal close. A delayed initializer may not publish a usable reader after abort, perform late dataset work, or escape cleanup. Close is one idempotent owner promise; remove its signal listener when cleanup settles, never shutdown caller-owned logging/context/primary pool. Failed initialization retains the original error; causal owned timeout retains REQUEST_TIMEOUT504, original request abort and independent DB/health/logging errors are not relabelled TIME_LIMIT. Container shutdown reports failures instead of necessarily throwing: inspect its report and fail delivery on any teardown failure. Do not equate report.closed, pool.end, service.closed or destroy-called with transport closure.

Successful delivery requires completed generation, settled initialization, successful owned container teardown and all owned terminal sockets closed, followed by unchanged final current auth/Audit. Slot release requires no possible late initializer/resource creation and confirmed closure of every owned client; on teardown error with those terminal conditions proven the failed request may release for a fresh owner, never reuse the failed instance. If initialization/teardown/closure remains unknown, fail/no CSV and retain busy503 until eventual owned settlement/confirmed closure or controlled process recovery; request failure can finish before asynchronous cleanup, but no further data work/deadline renewal or false success is allowed. All late promises/errors must be consumed/accounted; no unhandled rejection or silent cleanup failure. This is best-effort cancellation, not instant OS/MySQL termination or full TASK041 restart proof. HD158 one additional client/nonqueued slot/primary pool1/current auth/strict cap/budget, HD159 exact evidence recovery and zero-prefetch per-chunk guard remain unchanged.

**Exact implementation scope.**

- server/src/modules/inventory/InventoryInquiryService.js (add public Stocktake read/query helpers only; preserve old contracts).
- server/src/modules/inventory/inventoryStocktakeCancelContext.js (add check, same one-use consume/guards).
- server/src/modules/inventory/InventoryStocktakeExportService.js (new Stocktake-only bounded export owner).
- server/src/handlers/inventory/stocktakeHandlers.js (new 12 routes/adapters).
- server/src/handlers/inventory/stocktakeSchemas.js (new strict public schema/normalization; import existing policies/source).
- client/src/services/inventory.js (12 additive methods, existing HttpClient/getBlob, signed only Post, stable source/key/signal).
- server/test/inventoryStocktakeApi.test.js (18 unit cases).
- server/test/integration/inventoryStocktakeQueries.integration.test.js (20 real-MySQL cases).
- server/test/integration/inventoryStocktakeApi.integration.test.js (24 actual-HTTP/auth/MySQL cases).
- client/test/pages/inventory/inventoryStocktakeService.test.js (8 actual service-adapter Vitest cases).
- client/e2e/inventory-management/inventory-stocktake-contract.spec.js (8 actual browser/client cases, no mock API).
- client/e2e/inventory-management/playwright.stocktake.config.js (new owned-loopback-port config, workers1, no reuse of unowned runtime, secrets/raw trace/video/screenshots off).

Existing 0065 and eight TASK035–038 unit/DB files, StocktakeService and HighRiskContext byte-identical (11 files); all old schema/auth/handler/client/config/migration/package/CI/coverage/Item helper sources unchanged. Fixtures inline in new tests; no global helper/config rewrite. No Stocktake wizard/menu/page UI (TASK040), no global writer/restart/capacity completion (TASK041), P5/deploy/formal acceptance. Final-source regress old fixed Inventory207, old inquiry/auth/posting/client suites, 0356/12,03612/18,03714/22,03824/34, lint/build/audit, full native/global92/83/90/37originalfloors. New groups min18/20/24/8/8, maxSkipped0; old suite contracts remain byte-identical. Static plans do not prove discovery or coverage.

**QA execution contract.** Every table row is P0/P1, initially NOT_RUN. Each row supplies ID/requirement-risk, precondition/data/input, expected result, evidence. Unit evidence native assertion/report; D real MySQL26.7 schema/version/SQL pre/post plus synchronized concurrent session evidence, no fixture emulator; A real running application HTTP status/body/crypto-auth and persisted business/cache/Audit state plus minimized logs; C actual exported service with spy-only transport verifies adapter (not end-to-end proof); B actual running app login/device/client/HTTP/MySQL, console+network ledger/download assertions. All use final source+adopted PLAN; actual source/spec fingerprints and exact runtime cleanup recorded. Fault cases require reached checkpoint and unchanged whole business rows. No skipped subcases hidden under totals.

| ID | Requirement / risk | Preconditions / test data / input | Expected result / required evidence | Status |
| --- | --- | --- | --- | --- |
| ST039-U01 | P0 SEC008 schema | all12 routes/unknownfields/write numeric strings/URI01 | fixed routes/policies, strict rejection before effects; native route/schema assertions; require actual export route startup validation with unchanged default120000ms receive timeout | NOT_RUN |
| ST039-U02 | P0 FR095 inputs | q0/notFound/NULL/both/101/duplicate/unsafe/uint32 | exact count union/versions and bounds; no false zero | NOT_RUN |
| ST039-U03 | P0 FR102 intent | password change/source/reason normalization/callerproof | canonical credential-free immutable input, changed intent conflicts | NOT_RUN |
| ST039-U04 | P0 SEC013 Cancel | issued capsule preflight/check/consume/reuse/mismatch | check non-consuming, consume once, same fixed intent/time/current rules | NOT_RUN |
| ST039-U05 | P0 SEC013 cache | ordinary/Post/Cancel authorization changes during wait | replay exactly once under fresh locking guard; no handler/effects on denial | NOT_RUN |
| ST039-U06 | P1 HD155 preview | snapshot5/q3,uncounted,notFound,explicit0 | -2/NULL/-5/-5 correct stage, no persisted preview | NOT_RUN |
| ST039-U07 | P0 FR098 frozen | Ready/Posted/cancel-fromReady/Counting/Draft/corrupt | metadata stage, stored frozen validated, cancelled neverposted | NOT_RUN |
| ST039-U08 | P1 FR103 filters | GAIN/LOSS/ZERO crossed progress/bin/SKU/Lot/status | parameterized matching predicates, NULL excluded, filtered/global separate | NOT_RUN |
| ST039-U09 | P1 FR103 summary | multiple SKUs/UOMs/maxsafe counts | line counts only, no mixed-UOM summedquantity/unsafe conversion | NOT_RUN |
| ST039-U10 | P0 NFR006 read | header/summary/page selection interleaved count | one data snapshot/time and rowversions, no writer locks | NOT_RUN |
| ST039-U11 | P1 FR103 pagination | invalid dates/offset/sort/empty/multiple matching scopes | bounded safe fixed-order pages and EXISTS no duplicate roots | NOT_RUN |
| ST039-U12 | P0 SEC012 CSV | formula/control text/comma/quote/newline/Unicode | existing sanitizer every text cell plus valid quoting; numeric preserved | NOT_RUN |
| ST039-U13 | P1 FR103 CSV scope | emptyBins/Draft/Cancelled/mixed filters | SCOPE/LINE/SUMMARY fixedcolumns, emptyNULL notzero, same stage/filters | NOT_RUN |
| ST039-U14 | P0 NFR006 export bounds | >500 batch cap/exact maxrows/extra row | deterministic keysets/bounded residency/truthful header+footer; hard100000 cap despite higher configured override and lower configured cap honored | NOT_RUN |
| ST039-U15 | P0 SEC012 export failures | timecap vsDBerror/abort/diskerror/Auditfault | deliberate safe boundary cap flagged; in-flight cutoff/late metadata/empty result fail504, genuine SQL/request/disk/Audit faults never success; effective half-remaining deadline <=config cap, no refresh; partial initializer faults preserve original error and exact cleanup; actual existing container definition/resolve and healthCheck are mandatory, borrowed primary logger/context never closed; pre-abort/late-init/idempotent-close/report-failure branches asserted | NOT_RUN |
| ST039-U16 | P0 SEC013 export revocation | JWT/session/user/view change during generation/delivery | fresh perbatch/chunk guard stops disclosure; bounded safe Audit | NOT_RUN |
| ST039-U17 | P0 FR102 source | fake operation original scalar vscurrentheader | pass scalar unmodified; Add id/version line-owned, no reconstruction | NOT_RUN |
| ST039-U18 | P0 compatibility | existing route/client/importer/highrisk/cancel fixtures | additive scope only, old actions/one-use tests unchanged | NOT_RUN |
| ST039-D01 | P1 HD155 query | real snapshot5/count3/notFound/0/untouched | preview exact/NULL/zero distinctions, variance column stillNULL | NOT_RUN |
| ST039-D02 | P0 FR098 stages | Ready/Post/three Cancel predecessor states | persisted FROZEN/current Preview/NotStarted, cancellation truth | NOT_RUN |
| ST039-D03 | P0 NFR006 consistency | competing count commits between header/summary/page reads | observed concurrency, whole old or whole new snapshot nevermixed | NOT_RUN |
| ST039-D04 | P1 FR103 predicates | multibin/status/SKU/Lot progress+variance matrix | SQL totals/rows/summary match independent expected set | NOT_RUN |
| ST039-D05 | P1 FR103 list | dates/timezone/exact boundaries/duplicate binmatches | inclusive local day, stable unique roots, safe pages | NOT_RUN |
| ST039-D06 | P1 FR103 detail | >100scope/line refs,current renamedcode | paginated immutable/current labels separated, truthful totals | NOT_RUN |
| ST039-D07 | P0 SEC008 ownership | missing header/foreign line/Bin/Lot filters | safe404 or emptyfiltered set, no cross-parent rows | NOT_RUN |
| ST039-D08 | P0 integrity | corrupt frozen/null/count marker/safeinteger | explicit integrity rejection, no plausible falsevalues | NOT_RUN |
| ST039-D09 | P1 FR103 export | known expected queried subset incl emptyBin | parsed realCSV exactScope/Line/footer/filterhash/asOf, nostockwrites | NOT_RUN |
| ST039-D10 | P0 NFR006 export read | concurrent count/Ready commits between keyset batches | coherent original export snapshot, not mixedworkflow | NOT_RUN |
| ST039-D11 | P0 NFR006 keysets | >1000 rows, >500scopes, exact boundary/rowcap | no duplicate/omitted uncapped data, <=500 batch, hard100000/override capfooter; actual primary limit1 works with separate reader, synchronized busy attempts503 without extra pools; <=one auxiliary connection, slot/reader released before delivery; actual ServiceContainer-created reader completes real SELECT1, same security config and primary pool remain usable | NOT_RUN |
| ST039-D12 | P0 SEC012 timeout | injected generation clockdeadline vsactual SQLtimeout | TIME_LIMIT only safe complete-prefix stop; real slow header/summary/batch/current-auth cutoff504 incl empty dataset, actual querytimeout/requestabort distinct; no live reader/handle after failure; real handshake/healthCheck cancellation is inside original generation budget, causal504/request-abort/independent failure separated and no late data read | NOT_RUN |
| ST039-D13 | P0 SEC012 injection | formula/CSV quoting/safe strings inrealdisplayrefs | parsedCSV neutralized columns, validUnicode, no secret/internal fields | NOT_RUN |
| ST039-D14 | P0 SEC012 Audit | successful/truncated export and auditwriteerror | real boundedhash/count audit; failure prohibitsdelivery, no rawdata | NOT_RUN |
| ST039-D15 | P0 SEC013 auth | stale view/user/role/JWT whilebatch gate paused | current committed revocation denies/no staleclaim, no same-RR auth or blocking role lock for whole generation; real independent primary reader/aux pool ownership and cleanup | NOT_RUN |
| ST039-D16 | P0 SEC013 delivery | revocation/abort after first readstream chunk | real partial failure/no finalsuccessfooter, precise cleanup | NOT_RUN |
| ST039-D17 | P0 resources | diskwrite/streamclose/abort beforehandoff failures | reached init/write/abort/teardown faults, original error preserved, handles/ownedtemp/schema/aux connection and slot accounted; no release while reader live, no later generation inherits dirty state; initialization settlement before container shutdown, delayed init/health check/close and shutdown report faults observed, borrowed services unaffected, unknown terminal ownership holds503 until confirmed cleanup, late rejections consumed | NOT_RUN |
| ST039-D18 | P0 SEC013 capsule | real Cancel preflight/wait/check/consume/replay | latest token/roles fixedauth/oneconsume, oldflow tests preserved | NOT_RUN |
| ST039-D19 | P0 FR102 mutations | Count/Add/Post scalar throughpublic projections | exact row/parent version semantics, query causes no domainchanges | NOT_RUN |
| ST039-D20 | P0 compatibility | final-source old035–038/currentinquiry/scalars | old migrations/services/tests pins intact and real regress zeroSKIP; original whole-repo serviceContainer construction guard and global/37 floors must pass unchanged | NOT_RUN |
| ST039-A01 | P0 SEC auth | realanonymous/invalidsignature/expiredJWT12routes | real401/403 safeerrors, nobusiness/cache/Audit-success sideeffects | NOT_RUN |
| ST039-A02 | P0 SEC permissions | viewer/operator/adjuster across12routes | exact permission matrix; adjust not operation substitute/no elevation | NOT_RUN |
| ST039-A03 | P1 FR092 create/update | actualPOST uniqueDraftscope/update/source | scalar/version/full scope, no inventory locks beforeStart | NOT_RUN |
| ST039-A04 | P1 FR093 Start | realPOST start then query persistentlocks | current snapshot/multiBucket locks, truthfulscope/progress | NOT_RUN |
| ST039-A05 | P0 FR095 Count | actualHTTP0/notFound/untouched/lineversions | atomiccounts, workflowversionunchanged, previewread notpersisted | NOT_RUN |
| ST039-A06 | P0 FR096 Add | knownLot/noLot/unknownLot/wrongSKU | only legitimate snapshot0 added, no Lot/Balance/Movement creation | NOT_RUN |
| ST039-A07 | P0 FR098 Ready | incomplete vscomplete/empty/currentexpectedversion | only explicitcomplete freezes, no subsequent Count/Add/reopen | NOT_RUN |
| ST039-A08 | P0 SEC013 Post | realpassword/JWT+approveddevice valid ECDSAsignature | wholePost exact stock/Movements/Audit/ownrelease; no trustedfixture shortcut | NOT_RUN |
| ST039-A09 | P0 SEC013 strongnegatives | wrongpassword/unsigned/unapproveddevice/wrongkey/nonce | middleware rejects actualbadcrypto; READYlocks intact | NOT_RUN |
| ST039-A10 | P0 SEC013 Cancel | realpassword operator withoutdevice acrossvalidstates | validsealedCancel/history+ownrelease, badpassworddeny | NOT_RUN |
| ST039-A11 | P0 SEC008 strictinput | callerproof/actor/variance/snapshot/passwordonordinary,URI01/IDoverflow | ownschema+normalization denial, safeerror/no effects | NOT_RUN |
| ST039-A12 | P0 FR102 HTTPcache | samekey/business changedpassword validauth,changedreason | cachedoriginal accepted acrosscredentials; changedbusiness409, no repeat | NOT_RUN |
| ST039-A13 | P0 FR102 domainreplay | newHTTPkey same source post/count/add afterlaterdata | originalscalars exact/no newMovement/Audit; alteredsourceintent409 | NOT_RUN |
| ST039-A14 | P0 SEC013 cachedrevocation | existingcache then actualrole/JWT/device/key revoke | replay currentdeny, priorcache remains, no responsedata/effects | NOT_RUN |
| ST039-A15 | P0 SEC013 wait | realHTTPstore/business wait then committedrevocation | observedwait/currentchecks reject Post/Cancel/ordinary replay | NOT_RUN |
| ST039-A16 | P0 SEC013 time | signedwindow/JWT/session expire/abort duringwait | no refreshedtime/staleproof, rollback/current cache not overwritten | NOT_RUN |
| ST039-A17 | P0 FR102 races | realconcurrentCount/PostvsCancel sameversion/source | onecorrectterminal/countwinner, no duplicate or partialstock | NOT_RUN |
| ST039-A18 | P1 FR103 read | allGETs filters/paging/stage/currentmetadata | response schemas/globalfiltered consistency/queryreadonly | NOT_RUN |
| ST039-A19 | P0 FR103 CSV | realGETexport full/truncated/empty/cancelled/formulafixture | actualheaders/parsedfooter/filters/asOf/quantities matchSQL; real HTTP uses initialized container-owned reader, primary fresh auth remains independent, close/abort lifecycle failures never deliver CSV | NOT_RUN |
| ST039-A20 | P0 SEC012 export deny | viewer lostview/timeexpire/abort duringstream | partialconnection failure flagged, no silentcompleteCSV/leftoverfile | NOT_RUN |
| ST039-A21 | P0 FR099 rejection | stale snapshot/allocated/reserved/secondAuditfault | existingservice guards safeHTTPerror/whole rollback/locksremain | NOT_RUN |
| ST039-A22 | P0 SEC secrets | synthetic distinctive password/token/signature, success/failure/cache/log | none in hash input/business/Audit/cache/proof outputs/minimizedlogs | NOT_RUN |
| ST039-A23 | P0 NFR recovery | response lost aftercommit then source lookup/retry | detect committedscalar, sametransactionevent retry no duplicate | NOT_RUN |
| ST039-A24 | P0 compatibility | oldAdjustment/Reversal/Transfer and sourceerror/authroutes | no newhandler discovery collision/auth change, oldactualAPI regression; actual default-config route registration, no test-only receive-timeout elevation | NOT_RUN |
| ST039-C01 | P1 client routes | call twelve actualservice methods withspytransport | exactpath/body and response no extraactor/proof | NOT_RUN |
| ST039-C02 | P0 client signing | Post versusCancel/ordinarywrites | Post signed:true, Cancelpassword-only, stableidempotencykey | NOT_RUN |
| ST039-C03 | P1 client queries | filters/paging/asOf/globalfilteredmetadata | correctencodedwhitelist, response metadata not discarded | NOT_RUN |
| ST039-C04 | P0 client counts | zero/notFound/expectedlineversion/UNKNOWNresult | exactscalar/lineownership, no reconstruction or defaultzero | NOT_RUN |
| ST039-C05 | P0 client CSV | reservedchars/filtervalues/emptyoptionalfields | getBlob auth-basedencodedURL, samefiltercontract/no tokenURL | NOT_RUN |
| ST039-C06 | P0 client abort | abortsignal all read/write/downloadcalls | signal passed,no swallowedexception/automaticnewsource | NOT_RUN |
| ST039-C07 | P0 client errors | ApiError401/403/409/networkunknown | propagate existingerror and source/key preserved forcontrolledretry | NOT_RUN |
| ST039-C08 | P0 compatibility | alloldinventory methods exportedbeforecandidate | existingadapter exports/behavior unchanged | NOT_RUN |
| ST039-B01 | P1 realclient flow | realbrowserlogin+actualservice import, Draft→Start→Count→Ready | realAPI/SQL/progress+preview→frozen, no mockroute/wizardclaim | NOT_RUN |
| ST039-B02 | P0 realPost | approvednonextractablebrowserkey/password/clientPost | actualsignedHTTP+SQLpost, scalar effects/locks, no secrettrace | NOT_RUN |
| ST039-B03 | P0 realCancel | operator realpassword/noapproveddevice | actualCancel accepted vswrongpassworddenied, historyownedrelease | NOT_RUN |
| ST039-B04 | P0 roles/errors | view-only/directwrite/staleversion/incomplete counts | actualsafeerrors,no effects, classify expectednetwork failures | NOT_RUN |
| ST039-B05 | P1 realCSV | clientgetBlob filters/formulafixture/truncated export | parsed Blob/optionaltemporaryanchor download correctfooter/filename, cleanup | NOT_RUN |
| ST039-B06 | P0 retry | stablekey/source withfreshsignature then changedintent | exactoriginalcachedreply/no duplicate, conflict intentional | NOT_RUN |
| ST039-B07 | P0 browserstate | refresh/sessionexpiry/currenttoken+device revoke thenretry | realsession/auth failure, no stale disclosure or key/source replacement | NOT_RUN |
| ST039-B08 | P0 diagnostics | aborteddownload/APIerror/emptypage plus console/network observers | no unexpected JS/console/network failures; localminimizeddiagnostics, cleanup | NOT_RUN |

Risk trace: FR092–102→U01–05/U17,D18–20,A03–17/A21/A23,B01–04/B06–07; HD155/FR095/098/103→U06–14,D01–13,A18–19,C03–05,B01/B05; SEC008/012/013→U01–05/U12/U15–16,D07–08/D12–18,A01–02/A08–16/A20–22,B02–04/B07–08; NFR006→U10–11/U14,D03/D10–11,A17–19/A23. Critical preconditions include owned synthetic26.7.0 schema only; deterministic session synchronization, no fixed arbitrary sleeps. Planned native/API/client/browser groups18/20/24/8/8 allzeroSKIP. In addition actual Playwright CLI on namedownedbrowser against runningapp exerciseslogin/client/query/download/console/network, with assertions and sanitized local observation; CLI cannot substitute missing8JUnit browser cases. Current tools/CLI availability must be observed before execution, unavailable=>BLOCKED not mockPASS. Stocktakewizard/a11y/responsive/forms deferredTASK040, not silently claimed complete. Fullscale latency/memory/soak and globalwriter/restart remainTASK041; >1000 keyset functionalcase is not100kcapacityPASS. Actual Sam final implemented-source review remains required before TASK039 localDONE.


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

### TASK-040 precise UI/lookup/query and developer-check candidate — HD164 A / HD165

PROPOSED_NOT_APPLIED / NOT_RUN. HD164 A selected the additive Barcode direction only. The exact candidate, including Name query, UI recovery/storage trade-offs, shared two-code translations, source scope and new checks, needs actual Sam DESIGN/PLAN/scope approval before adoption. This is IMPLEMENT developer work, not formal TC/UAT, product/source approval, publication or deployment.

**Public lookup (HD164 A).** Extend only existing GET `/api/v1/inventory/sku-lookup`: exactly one raw string `code` or `barcode`, no unknown fields, arrays/coerced numbers/duplicate query parameters, no auto-detect/fallback/Code-vs-Barcode precedence. Existing Code normalization, Inventory view policy, response whitelist and inventory-profile/nonserial/Base-UOM checks remain. Barcode trims/normalizes through pinned ItemLookupService.findByBarcode(barcode,{purpose:"inventory"}) and then the same current inventory profile in one executor; no Item grant, new Item method/write, Balance requirement, price or pack-conversion output. Unknown lookup remains safe not-found, inconsistent multi-match fails closed. UI modes are explicit Code/Barcode; a scan locates a SKU only, never increments quantity, submits or chooses Bin/Lot/Status. Add only `lookupSkuByBarcode(barcode,{signal})` to the client; `lookupSku` keeps its exact signature/request semantics. Existing Transfer/Adjustment callers require compatibility regression.

**Barcode boundary (revision2).** Check the original raw `req.query.barcode` before trim/normalization: string only,1–190 Unicode code points and<=760 UTF8 bytes, no Unicode Cc characters (U+0000–001F or U+007F–009F), including leading/trailing TAB/CR/LF/NUL/DEL/C1. Then require trim to be nonempty; whitespace-only is invalid. These checks precede any Item/profile/database lookup; no schema trim or numeric coercion may hide bad raw input. Pass the validated raw value to the pinned Item helper, whose trim/numeric ASCII-space-and-hyphen removal cannot increase length; its normalized lookup value is also nonempty and<=190 code points/760 bytes. Do not duplicate Item normalization or infer barcodeType/check digits. Printable unmatched strings remain safe404 INVENTORY_RESOURCE_NOT_FOUND, not GTIN_INVALID. Raw-type/one-of/unknown-field/duplicate/blank/control/length failures use existing400 REQUEST_VALIDATION_FAILED with safe field-only details, never echoed raw value. Existing Code rules/errors remain separate and byte-for-behavior compatible; Barcode raw bound deliberately rejects191-character padded input even if trimming would fit. Cases include raw190/191,190 supplementary characters(760bytes) versus191, whitespace-only, all specified controls at prefix/interior/suffix, numeric-spaced/hyphenated and internal examples; assert pre-lookup rejection versus accepted-boundary404/known match.

**Name locating / same CSV filter.** Add optional `q` only to Stocktake lines and export queries (not header list/detail/write bodies). Raw string, trim, <=190 Unicode code points and <=760 UTF8 bytes, reject Unicode controls; empty means no text filter. Literal case/collation matching follows the existing database; escape !/%/_ and use parameterized substring predicates over current SKU Code/Name. Use an Item-SKU EXISTS predicate correlated to owned `l.sku_id` so the same predicate is valid inside bounded line candidates, summary SQL and joined page reads without referencing an unavailable outer alias. Combine AND with existing Bin/SKU/Lot/Status/progress/variance filters; asOf/versions/global-vs-filtered summaries, stage/NULL rules, keyset<=500, ordering, CSV columns/cap/budget/auth/cleanup remain unchanged. Client export whitelist gains q; do not silently download unfiltered lines. Name locating covers the stocktake's existing lines, not a new Item catalog search; field-discovered SKU selection uses exact Code/Barcode and known legal Lot only. No live whole-catalog or eager full Count-line load.

**Page and permissions.** New `/inventory/stocktakes`, name inventory-stocktakes, title 盤點管理, automatic menu discovery under inventory/order70/icon fact_check, requires inventory.view; no global router/menu/store change. Read-only viewers can inspect scopes/counts/differences/export/history. View+operation is necessary for Create/update/Start/count/add/Ready/Cancel; view+adjust for Post only, no implication in either direction. Session actor/permission changes clear transient drafts, passwords, proof/confirmation and generation-bound UI callbacks; stored recovery remains actor-namespaced. Backend current checks remain authoritative. All table fetch adapters project only allowed query fields, stripping DataTable sort/descending/filter extras unless explicitly mapped to q; fixed server sort is not falsely shown as user-selectable. URL state allowlists only selected positive id, list Warehouse/Bin/status/date/page, current line filters/page/q; never payload/count/reason/source/key/password/proof/token. Unsupported/tampered query state fails safely, not a command.

**Authorization exit precedes edit protection (revision2).** Stocktake leave/update/beforeunload guards protect only voluntary navigation while the captured actor remains authenticated and retains inventory.view. Logout/session.clear, global401/session expiry, loss of inventory.view and actor replacement never show a discard prompt or veto required login/403/other framework redirects, even dirty/sending/QUERY_ONLY. A synchronous local session/authority watcher and direct authority check at guard entry invalidate page/read/write generations, abort owned requests, clear visible header/scopes/rows/summaries/selection/errors/transient input/original body+key/proof and unmount the password dialog before allowing the existing redirect. The render gate independently requires current actor+view, so stale content is hidden without depending on redirect completion. Retain only the already-minimized old actor sessionStorage reference, not a visible business-data copy or body/key; old callbacks cannot clear that record or write into a new actor namespace. Abort is UNKNOWN for any sent command, not rollback; re-login recovery stays QUERY_ONLY. Losing operation/adjust while view remains permits read-only inspection but clears obsolete editors/proofs and never grants writes; an ordinary403 alone does not fabricate session claims or suppress existing global auth behavior. Shared router/main/session/HttpClient are unchanged; existing global401 redirects are never intercepted, including a401 from a retiring request.

**Stocktake-local DataTable request isolation (revision2).** Preserve shared DataTable bytes. Use a keyed instance for each captured actor/document/filter/read generation and frozen initialPagination, with a fetch closure bound to that generation, not a getter of the current generation. Each mounted server-mode table may issue at most one HTTP fetch; the first request is its initial read. Any subsequent QTable page/pageSize request or internal reload/retry retires that instance in the owning Stocktake component: capture the permitted requested pagination/filter, bump the key, abort its owned fetch and mount a fresh instance with the requested initialPagination and one new read. Stale callbacks/events from a retired instance cannot trigger another remount or update owner state. Parent refresh/filter/document/actor changes likewise retire/remount rather than invoking shared reload on a live instance. Rejection/late success/finally may settle only inside the retired instance; never return stale A or a stale-error rejection to the live B table. Apply this rule to every Stocktake server-mode list/scope/count table and paged selector implemented with DataTable. Local header/lookup/summary/selector reads additionally use captured generation+actor checks. No shared-table fix, whole-dataset client pagination, request queue or automatic HTTP retry. Cost: fresh table state per read, stable focus/explicit selection restored only after a current successful read, never an unsaved editor or unchecked old selection. C03 must mount the real unchanged DataTable and prove B survives delayed A success and A rejection, plus multiple same-instance page/reload events; assert current rows/pagination/error/loading and no extra live-instance request. Browser B05 exercises rapid requests/filters and current pagination, not only a mocked callback.

**Dirty Count editor and denied paging (revision3).** A Count editor may open only after its selected page read has settled and the captured row/page/filter identity is committed. Before mounting the persistent editor, retire/unmount its Count DataTable and invalidate its read generation; keep only committed pagination/filter identity and the independently frozen row input/version, not a live table accepting paging. The editor is outside the table subtree, so table unmount does not discard it. While the editor is open, Count pagination/filter controls are absent or noninteractive; voluntary URL/page/document changes are refused before updating committed state until explicit save/discard. A captured request/event from the retired table settles only in that retired instance and cannot initiate HTTP/remount or change owner pagination. Thus refusal never returns page1 rows as page2, blanks a visible live table through rejection, or leaves a live table loading forever. Mandatory auth exit still unmounts/clears the editor immediately. On confirmed save or explicit discard, close the editor and mount one fresh server-mode table at the last committed page/filter; apply a newly requested page only after a separate explicit allowed navigation. Do not cache the entire list, merge newer line versions into the frozen editor, or change shared DataTable. Real mounted-table tests must first verify pagination, then open dirty editor and assert its pagination is unavailable; reject URL/page intents and inject captured retired events/late settlements, asserting original editor/page/filter preserved and no fresh query. After discard/save, verify last committed page reload and functioning real pagination. Browser B05 exercises the actual modal/pager rather than pretending a click penetrates a persistent modal.

**Observable authority in B14 (revision3).** Frontend exit guarantees begin when the existing session is cleared or its real current claims lose view/change actor, not at an unobservable server DB write. For the valid-device VIEW/operation/adjust revocation variants, first revoke only the owned synthetic actor in the real DB; then the browser test triggers the existing session.refresh() action and observes the actual signed POST /api/v1/user/token/refresh and its server-issued changed permission claims. This is an explicitly labelled deterministic auth-refresh test trigger using the existing store, not a business UI flow, mock response, injected claim/token, new test endpoint or product refresh control. No token/cookie/private storage inspection or secret response export. Only after successful real claim replacement assert existing router403 navigation/local content clearing without a dirty/sending/QUERY_ONLY veto; when VIEW remains, assert read-only inspection and cleared obsolete proof/editor rather than forced403. JWT/session expiry/revocation variants instead observe real401 and the unchanged global clear/login path; explicit logout uses the existing topbar when reachable. For dirty Count or sending persistent password dialogs, do not force-click through the modal or discard it first: use an explicitly labelled deterministic call to the existing session.logout() action in the running app, observe its real POST /api/v1/user/logout, and after its finally-clearing settles perform the same existing router.push({name:"login"}) as AppTopbar. This is a test trigger for mandatory exit under an otherwise inaccessible modal, not proof that the ordinary topbar gesture is reachable there, a new product logout control, mocked session.clear or a synthetic success. Frontend immediate clearing is asserted when the existing logout finally calls session.clear, not before the asynchronous logout request settles; even a failed logout request still clears by the existing finally. Assert no discard prompt, cleared visible data/proof/dialog and retained minimized unresolved source reference, including a sent Stocktake request whose outcome remains unknown. Separately verify the accessible real topbar logout user flow. Device-only403 does not imply view loss and does not make password-only Cancel require a device. A failed refresh/network/403 without authoritative changed claims must not be labelled successful revocation propagation or forced403; current backend denies revoked requests, original UNKNOWN/reference stays unresolved, and no automatic business retry is introduced. Existing watchdog latency/global auth policy is unchanged; this candidate makes no instantaneous server-push revocation/display-erasure claim before the frontend observes updated authority.

**Four-step wizard and scope.** Follow existing PageHeader/DataTable/FormPanel/EllipsisCell/Quasar/tokens and Traditional Chinese rules. Step1 selects one Warehouse and belonging active Bins, with incremental paged selectors, explicit selection, no fabricated/foreign ID. Existing Draft scope replacement must read all selected-scope IDs across pages under an unchanged header version before replacing, detect partial/duplicate/drifting reads and never drop unseen Bins; no artificial new Bin-count cap. Whole selected ID set costs memory/request size, subject to unchanged existing server limits. DRAFT shows scope exclusivity but no physical inventory lock. Step2 confirms whole scope and warns Start pauses stock mutation; no optimistic transition/lock acquisition. COUNTING shows number plus persistent-lock explanation, current scope pagination and complete global progress; READY is review-only, no Count/Add/edit/reopen. POSTED/CANCELLED are read-only; cancelled history never looks posted. Zero-line valid scope can Ready; progress displays 0/0 explicitly, no divide-by-zero. Current physical state is server-owned: unknown/failed current read must not assert unlocked or still-locked as a confirmed fact.

**Count interaction, minimum complete slice.** Server-paginated DataTable shows snapshot/current dimensions/Base UOM, actual/countState/versions and clearly labelled PREVIEW/FROZEN. Edit exactly one selected row in a persistent FormPanel dialog; submit one row through existing atomic Count API (the API1–100 range is unchanged, no bulk UI promised). Blank is unsaved/unentered, not numeric0; explicit notFound is a separate control, mutually exclusive with quantity; counted/notFound may replace each other but no reset-to-uncounted action. Canonical nonnegative safe-integer Base quantities only; no fractions/sign/coercion/pack automatic conversion. Row carries its original expectedVersion, not header workflowVersion; header version does not advance on Count. While current actor+view authority holds, unsaved edit blocks voluntary page/filter/selected-document/navigation changes until save or explicit discard; mandatory authorization exits above always take precedence; never merge newer line values/versions into an already prepared submission. Conflict keeps the original input for inspection and offers current query plus explicit new preparation, never automatic resubmit/version replacement. After confirmed save, refresh current line/header summary; if refresh fails, show confirmed save with separate stale-progress warning. Fewer calls are not traded for silent multi-page draft storage: one explicit save per row is the disclosed UI cost.

**Field-discovered line.** Separate FormPanel selects an owned scope Bin, exact Inventory Code/Barcode profile, explicit stock status and existing same-SKU Lot (none=>NULL), with paged known-Lot selection. No new/unknown Lot, fake Receipt, new Balance/Movement, automatic source quantity or barcode pack factor. Known expired/belowreceipt-life Lot can be recorded under approved physical Stocktake policy, with warning that no sale/Receipt qualification is granted. Add returns line-owned id/version1 and parent stocktakeId; never treat it as header id/version. Query the new line under the exact parent/SKU/Bin/Lot/status filters; duplicate dimension/current state failure keeps the whole server transaction intact.

**Review/strong confirmation.** Global summary (not filtered subset) gates Ready only when uncounted0; state/row versions still checked by server. Ready displays current submitted PREVIEW counts/difference categories and freezes only on success; no auto-Ready or local freeze/reopen. Post shows whole frozen difference/allocated/Reserved safeguard reminder, counts not mixed-UOM sum, reason(required trimmed nonblank <=500UTF8/no controls), fixed view+adjust and current password/device signature. Cancel shows cancellation/history/own-lock consequence, same safe reason with view+operation/password-only, no device condition, including inactive Warehouse/Bin. Reuse existing InventoryHighRiskDialog's native transient password pattern; only additive confirmLabel prop default 確認過帳 permits 取消盤點 confirmation text. Existing password/raw form/clearing and other callers remain unchanged; this is reuse of the previously approved Inventory-owned confirmation, not new shared promptPassword/reactive-secret handling. All new business forms use FormPanel. Password is cleared before awaiting, after attempt/hide/unmount/actor change, never in reactive intent/storage/URL/log/proof; fresh input and fresh actual signature/nonce for every explicit attempt. No JS zeroization/XSS immunity promise. Default dialog label and old Adjustment behavior require regression.

**Eight-command intent / unknown-result recovery.** One immutable credential-free original body/source/key per explicit Create/update/Start/Count/Add/Ready/Post/Cancel intent in the current page; no auto retry or regenerated expected versions/event/key. Source module INVENTORY/documentType STOCKTAKE, lineId empty, eventId UUID; Create documentId UUID, existing-parent documentId canonical parent ID. Record before sending, one outstanding intent per actor/tab within this Stocktake page; header/other writes cannot supersede it. SessionStorage key inventory-stocktake-recovery:v1:<actorId> stores only strict source/action/parentStocktakeId (Create has none). No body/quantity/reason/key/credentials; storage unavailable/corrupt/conflicting record blocks before send, never silently clears/overwrites unresolved identity. Minimized IDs remain business data, local-only; no cross-tab/global-store/background replay/durable-delivery claim. No browser token/cookie/storage inspection through automation.

Known success is either a validated direct original scalar response or exact by-source completed result with resultType STOCKTAKE, canonical positive resultId and safe scalar summary; verify parent identity/operationId/versions/status/count, and Add child-id+parent-id distinction. Preserve original receipt as historical, separately reload current header/line facts; a later workflow status never rewrites the old receipt. Null/failed/malformed/mismatched source lookup means UNKNOWN, not failure/rollback/no-effect/unlocked. After an ever-unknown attempt a later403/409 cannot prove the earlier attempt failed. Current page retry is user-explicit, first queries exact original source; a failed lookup prevents sending; unresolved/null permits only original frozen body/key/source with fresh applicable auth, never new intent or rewritten version. A first definitive non-in-progress4xx rejection can be explicitly re-prepared only after successful original-result lookup/null and current state refresh; do not use this path for ever-unknown requests. Refresh/actor change/unmount drops body/key; recovery is QUERY_ONLY, cannot reconstruct/retry. Confirmed original completion clears only matching stored identity, then reloads current facts. Unknown QUERY_ONLY can block new writes indefinitely and needs manual reconciliation; closing a tab/clearing storage can lose the reference. Show/copy safe reference and limitation, do not invent a clear-and-resend shortcut. Disable voluntary navigation while sending; route changes with unsaved editor or unresolved intent are not silent discard. This never blocks mandatory authorization exits: apply the immediate clearing/QUERY_ONLY retention rule above. Requests from disposed/other-actor generations never update visible state or clear another record.

**Errors/export/accessibility.** Add only BARCODE_LOOKUP_INCONSISTENT and UOM_CONVERSION_INVALID Traditional Chinese entries to existing errorMessages; no mapping removal/behavior change. Stocktake forms pass safe localized Error messages and only well-shaped localized field-error arrays to FormPanel; Inventory object details or English/raw SQL/error bodies must not be rendered or make FormPanel iteration throw. No v-html/eval. CSV uses existing getBlob envelope and unchanged file download/objectURL cleanup; pass all active line filters including q. Always warn download success alone does not prove completeness: inspect final SUMMARY truncated/reason; no unsupported header access, custom CSV parser, whole-file pre-read or falsely complete toast. Actual browser tests parse downloaded CSV in Node to verify rows/footer. Keyboard labels/focus/error-summary/return focus, textual lock/state, contrast and existing responsive375/768/1024/1440 plus320 acceptance widths; table-scoped horizontal scrolling may be needed, never body/dialog offscreen overflow. No new dependency, framework, auth, CORS, limiter, migration or shared data mutation.

**Thin slices and source boundary.** 1 lookup/q with server12+HTTP14 checks;2 page/scope/Draft/Start;3 Counter/Add and line guards;4 original-intent/review/strong Cancel/Post;5 actual browser/old compatibility. Each slice gets focused native TDD/verification before the next, within one TASK040 and existing P4 phase-PR group; not new Tasks/branches or premature commits/publication. Exact source/test20 paths are in the HD167 proposal JSON:the prior18 plus only AppTopbar.vue/AppTopbar.test.js. Existing nine changed files receive only listed incremental behavior; 0065/StocktakeService/HighRisk/CancelContext/Export/StocktakeHandlers and all035–039 old tests/039 config remain pinned (20 files), Item contract unchanged. Inquiry increment is Stocktake q only; legacy internal count query/all other inquiries preserve behavior. Default labels/Code/old routes/byte-identical tests and all mandatory developer/floors/CI/formal gates are not weakened.

**Executable developer profile.** Append server unit12, real MySQL26.7/API14, client component24 and true wizard Playwright16, all zero-skip, with actual CLI in addition to16 JUnit browser cases. Case IDs below are DEVELOPER only. Native existing Node --test/JUnit, client npm/Vitest/JUnit, npx --no-install Playwright with a new owned UI config; no parser/timeout/global version policy lowering. New config uses strict owned loopback origins/ports, actual app/MySQL/synthetic users and original auth/limiter, workers1/retries0; trace/video/automatic screenshots off to avoid raw passwords, manual cleared minimized screenshots local-only. Exact env allowlist/minima/argv live in proposed profile; env DB passwords/bank keys remain redacted. Standing owned resource/existing migrations/exact cleanup authority is reused, no shared DB or external effect. All new checks NOT_RUN. Require old035–039 dedicated checks at final source/newPLAN, Inventory207, old Code/Transfer/Adjustment/client/real browser regressions, full server and client coverage/floors, lint/build/audit, current candidate structural checks, final Sam source review. P4 final typed developer gate keeps old lint/build/inventory-technical and the four original TASK040 groups, and adds only inventory-task040-topbar; old placeholder/formal/P5 applicability is not claimed solved by UI checks and needs honest TASK041 integration disposition, no silent skip.

**Fixtures/evidence.** N=isolated fake executor/native unit (not real DB); R=owned real MySQL26.7 synthetic app with VIEW(view),OP(view+operation),ADJ(view+adjust),ALL and ITEM-only actors, actual JWT/password/device and safe dataset; V=actual Vue/Quasar/Pinia/router mounted with mock HTTP(client unit only); B=running actual app/client/R dataset and real browser/crypto. Seed owned multi-Bin/no-Lot/known-Lot/expired/short-life0-Balance fixtures,200-row pagination, Base EA/Pack factor>1, literalSKU-%_/Name中文/GTIN-normalized/internal barcode and Code-vs-Barcode collision. Assert DB before/after quantities/versions/Movement/Operation/Audit/lock history for browser writes, not only toast/200. Delay/drop real response only after observed commit for unknown-result cases, no fake success; deterministic latches/actual predicates, no arbitrary sleep/limiter bypass. Critical cases exist before automation, initial NOT_RUN; DTD-free testcase names and exact IDs manually checked at final review.

| Test ID | Priority / requirement-risk | Preconditions | Test data | Steps/input | Expected result | Required evidence | Initial status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ST040-U01 | P0 SEC008 oldCode compatibility | N schema/handler | old Code literal/trim | validate/execute old Code | same route/view/shape/admission, no Barcode fallback | native assertions/JUnit | NOT_RUN |
| ST040-U02 | P0 SEC008 raw input | N schema/handler | both/neither/type/duplicate; blank,raw190/191,760-byte supplementary,raw prefix/interior/suffix C0/DEL/C1 | validate before trim/Item/query |400 REQUEST_VALIDATION_FAILED before lookup; valid bound proceeds, old Code unchanged | field-only errors/zero lookup calls/JUnit | NOT_RUN |
| ST040-U03 | P0 FR095 scan identity | N Item seam | numeric/internal/multi-row | execute Barcode | pinned normalization/exact params; multi-row reject | SQL params/native assertions | NOT_RUN |
| ST040-U04 | P0 FR096 no Balance | N profile | tracked SKU with none/batch | lookup minimum | no stock query/Item grant; Base-UOM identity only | query/response assertions | NOT_RUN |
| ST040-U05 | P0 SEC012 admission | N profile | inactive/archived/serial/badBase | lookup invalid profiles | existing inventory guards fail closed | native error assertions | NOT_RUN |
| ST040-U06 | P0 FR011 text matching | N Inquiry | q literal %_!中文 | build owned predicates | correlated parameterized EXISTS, no guessed joins | SQL/params/native assertions | NOT_RUN |
| ST040-U07 | P0 SEC008 q bounds | N schema+normalizer | raw numeric/array/control/191 chars | query lines/export/write | reject invalid q; writes/header no q | native schema assertions | NOT_RUN |
| ST040-U08 | P1 FR098/103 summaries | N Inquiry | q plus gain/progress, NULL/0/notFound | read page/global+filtered | disjoint counts/stage preserved, no stock write | native query/response facts | NOT_RUN |
| ST040-U09 | P0 NFR006 candidate bound | N keyset | q and cursor/morethan500 | build/export batch | q valid inside candidates, limit<=500/order intact | native SQL/bound assertions | NOT_RUN |
| ST040-U10 | P1 FR103 CSV parity | N unchanged Export | q/filter/emptyBin | generate CSV | same line filter, all SCOPE, truthful SUMMARY | native CSV/assertions | NOT_RUN |
| ST040-U11 | P0 FR095 Code collision | N handler | Code text equals other Barcode | explicit mode lookup | no precedence/fallback; correct distinct IDs | executor/native assertions | NOT_RUN |
| ST040-U12 | P0 SEC012 privacy/executor | N failure | missing/malformed/profile SQL fault | lookup/query rejection | no SQL/price/secret leak or escaped transaction | native response/error assertions | NOT_RUN |
| ST040-A01 | P0 SEC012 auth | R VIEW/ITEM/noJWT | usable Barcode | real GET | view succeeds without Item; unauth/Item-only denied | HTTP+DB before/after | NOT_RUN |
| ST040-A02 | P0 FR096 noBalance | R known Lot/none | Barcode SKU without Balance | real lookup then approved Add | valid identity/Add snapshot0; no fake stock/Lot | HTTP+row/Audit/Movement facts | NOT_RUN |
| ST040-A03 | P0 SEC008 strictness | R real route/lookup observation | raw190/191,760byte supplementary,whitespace,encoded C0/DEL/C1/type/duplicate/injection | real GET malformed+valid boundary+known barcode | exact400 prelookup; valid printable unknown404 or correct match, no value echo/effect | HTTP status/code+lookup observation+DB snapshot | NOT_RUN |
| ST040-A04 | P0 FR095 identity | R two SKUs | colliding Code/Barcode text | both explicit modes | exact distinct intended SKU, no fallback | HTTP+known IDs | NOT_RUN |
| ST040-A05 | P1 FR095 normalization | R unique barcodes | spaced GTIN/internal | real Barcode GET | normalized unique SKU and minimum response | HTTP+DB uniqueness facts | NOT_RUN |
| ST040-A06 | P0 SEC012 Inventory profile | R variants | notpurchasable/notsellable/inactive/serial/Base | real lookup | inventory purpose retained, unsafe admission rejected | HTTP+profile/zero mutation | NOT_RUN |
| ST040-A07 | P0 SEC012 safe errors | R controlled fault | Item query failure/unknown | real HTTP error | privacy preserved, no fabricated result | HTTP+safe log/DB snapshot | NOT_RUN |
| ST040-A08 | P0 FR011 scoped q | R two Stocktakes | Unicode/literal Name/Code/q bounds | lines/export GET | only owned matching lines, no text SQL injection | HTTP+SQL rows/CSV | NOT_RUN |
| ST040-A09 | P1 FR103 pagination | R200rows/multiBuckets | q+Bin/Lot/status+pages | read filtered pages | stable unique ordered matching IDs/totals, global distinct | HTTP+native DB rows | NOT_RUN |
| ST040-A10 | P0 FR095/098 stages | R COUNTING | blank/q0/notFound and q | lines/summary/export | NULL/0 distinction/PREVIEW/no variance persistence | HTTP+CSV+persisted rows | NOT_RUN |
| ST040-A11 | P1 FR098 history | R READY/POSTED/CANCELLED | Name filter/emptyBin | read/export history | FROZEN/cancelled label/SCOPE/summary intact | HTTP+CSV+stored header | NOT_RUN |
| ST040-A12 | P0 SEC012 current authority | R VIEW token | q CSV + actual revoke | revoke before response/delivery | actual existing guard denies, no new post-revoke bytes | HTTP barrier/bytes+DB | NOT_RUN |
| ST040-A13 | P0 FR103 no mutation | R all read modes | old Code/q/barcode | snapshot around reads | no Balance/Movement/Operation/lock changes | exact DB before/after | NOT_RUN |
| ST040-A14 | P0 compatibility | R existing oldCode fixtures | old lookup + Stocktake workflow | actual old calls | old signatures/statuses/roles/scalars unchanged | HTTP+native old regressions | NOT_RUN |
| ST040-C01 | P0 FR116/117 roles | V actors | VIEW/OP/ADJ/ALL/ITEM | mount page/switch actors | view vs count vs Post separation, no Item grant | mounted DOM/API calls/JUnit | NOT_RUN |
| ST040-C02 | P0 SEC008 URL | V router | valid/foreign/secret query | restore/deep-link | only allowed read state, no command/credential | router/DOM assertions | NOT_RUN |
| ST040-C03 | P0 FR103 stale DataTable | V mounted real unchanged DataTable | A late success/rejection,B newdoc/filter/page; repeated retired events; dirty-editor pause | real paginate then retire/remount or open editor,release A/events | current rows/pagination/error/loading intact; no live table while dirty,no stale remount/fetch | real DataTable DOM+latches/committed state/query counts | NOT_RUN |
| ST040-C04 | P0 FR092 scope | V paged selectors | >100scopes/foreign/inactive/partial | create/replace selection | complete owned set or block, no unseen drop | request IDs/DOM/JUnit | NOT_RUN |
| ST040-C05 | P1 FR092 Draft | V Draft | create/update source/result | submit Draft | exclusivity/no physical-lock claim, correct status | DOM+immutable request | NOT_RUN |
| ST040-C06 | P0 FR093 Start | V current Draft | success/conflict/unknown | confirm Start | no optimistic state, whole-scope warning | DOM+request/result state | NOT_RUN |
| ST040-C07 | P0 FR095 count states | V row editor | blank/0/notFound | edit/save each | no blank=>0, mutually exclusive explicit states | DOM+exact one-row payload | NOT_RUN |
| ST040-C08 | P0 FR095 quantities | V BaseEA | negative/fraction/unsafe/Pack | submit row editor | safe Base integer only, no conversion/scan count | FormPanel/error/payload | NOT_RUN |
| ST040-C09 | P0 FR095/SEC008 navigation | V actual router+real Count table/editor | dirty Count after committedpage; declined voluntary URL/page intent vs auth exits | open editor,assert pager unavailable; refuse route/page,settle retired events; logout/401/view loss | refusal retains frozen input/committedpage,zero query; discard remounts samepage; auth exit no prompt/content | real controls/router/editor/page/query assertions | NOT_RUN |
| ST040-C10 | P0 FR095 line version | V Count receipt | headerv2/linev7 | save line | original linev7, header not incremented locally | body/receipt/refetch assertions | NOT_RUN |
| ST040-C11 | P0 FR095 conflict | V stale row | typed quantity then409 | current query/reprepare | input inspectable; no merge/version rewrite/retry | exact calls/DOM | NOT_RUN |
| ST040-C12 | P0 FR095 locator | V delayed lookup | Barcode/Code/q/multiBucket | scan/change input | unique SKU location, explicit row selection, no writes | calls/filter/DOM | NOT_RUN |
| ST040-C13 | P0 FR096 known Lot | V noBalance profiles | none/batch/expired/unknown | prepare Add | NULL/known sameSKU only, warning/no fake Receipt | request/profile/DOM | NOT_RUN |
| ST040-C14 | P0 FR096 Add identity | V child scalar | childid/parentid/version1 | resolve Add | child never header; correct parent line query | scalar/query/DOM assertions | NOT_RUN |
| ST040-C15 | P1 FR098 empty/history | V stage variants | 0lines/Ready/Cancelled | render wizard |0/0 truthful, no Ready edit/reopen/cancel-as-post | DOM/status assertions | NOT_RUN |
| ST040-C16 | P0 FR098 global Ready | V filtered table | hidden uncounted rows | Ready action | global uncounted gates, backend freezes only | global summary/call/DOM | NOT_RUN |
| ST040-C17 | P0 SEC013 Post | V ADJ/password DOM | reasonUTF8/attempt/signal | confirm Post then hide | password cleared/no retained secrets; signed onlyPost | DOM/storage/payload flags | NOT_RUN |
| ST040-C18 | P0 FR101 Cancel | V OP/no approved device | inactive Bin/reason/password | cancel + old default dialog | password-only, cancelLabel, oldPost default intact | DOM/client flags/regression | NOT_RUN |
| ST040-C19 | P0 FR102 original intent | V delayed write | repeat/doubleclick/new edit | submit/retry | frozen originalbody/source/key once, no auto newintent | captured bodies/keys | NOT_RUN |
| ST040-C20 | P0 FR102 unknown chain | V everUNKNOWN | timeout/null then403/mismatch | query/explicit retry | keepUNKNOWN; only original body after safe lookup | request sequence/DOM | NOT_RUN |
| ST040-C21 | P0 SEC012 recovery storage | V actor/router/owned storage fixture | corrupt/quota/refresh/unmount plus dirty/sending/QUERY_ONLY401/view revoke | prepare/restore/replace actor/revoke then release old callbacks | block before send; mandatory exit; old minimized reference unchanged; body/key gone, no visible data/newactor writes | owned storage fixture+DOM/redirect/callback assertions | NOT_RUN |
| ST040-C22 | P0 FR102 receipt | V validated original receipt | parent/Add child/later header/refetch fail | resolve/reload | historic original/current separate, no falseunlock | response identity/DOM | NOT_RUN |
| ST040-C23 | P1 FR103 download | V Blob envelope | allfilters/q/failure/abort | export | correct filters/objectURL cleanup/completeness warning | calls/Blob/DOM | NOT_RUN |
| ST040-C24 | P0 SEC008/a11y | V FramePanel/errors | objectdetails/English/2codes/labels | invalid form + dialogs | Chinese safe errors/focus, no iteration/raw leak | DOM/focus/mapping assertions | NOT_RUN |
| ST040-B01 | P0 FR092 real entry | B VIEW/OP/ADJ | actual login/nav/roles | navigate menu/list | exact page visible/read-only vs actions; actual permissions | browser+HTTP+DB | NOT_RUN |
| ST040-B02 | P0 FR092 Draft scope | B paged Bins | foreign/overlap/partial selection | UI create/edit Draft | own complete scope/exclusive/no active lock | UI+actual rows/locks | NOT_RUN |
| ST040-B03 | P0 FR093 Start | B Draft/multiBin | actual snapshot/emptyBin | confirm Start | COUNTING after commit only, snapshot/persistent lock facts | UI+DB/Audit/Operation | NOT_RUN |
| ST040-B04 | P0 FR095 real counts | B Counting | empty/0/notFound/changeBack | edit row/keyboard/save | actual disjoint state/version/Audit and progress | UI+HTTP+stored lines | NOT_RUN |
| ST040-B05 | P0 FR095 paged isolation | B200rows/two actors | real rapid pages/late read,dirty Count modal,staleversion | real paginate; open editor,attempt back/URL and refuse,discard then paginate | no pager reachable while editor; original input/page unchanged; committed-page reload then valid nextpage, no auto merge | browser actual controls/requests+DB versions | NOT_RUN |
| ST040-B06 | P0 FR095 Barcode/Name | B collision/multiBucket | keyboard scan/Nameq/unknown | locator then choose explicit row | correct unique SKU/filter; no count increment | UI+HTTP IDs/zero write | NOT_RUN |
| ST040-B07 | P0 FR096 field discovery | B noBalance/knownexpiredLot | none/batch/unknownLot | UI Add and count | snapshot0/knownLot only, no Lot/stock creation | UI+DB/Audit/Movement | NOT_RUN |
| ST040-B08 | P0 FR098 Ready | B filtered/empty scope | uncounted-hidden/0lines | review then Ready | global gate, frozen server state, no reopen/edit | UI+HTTP+persisted variance | NOT_RUN |
| ST040-B09 | P0 FR099/SEC013 Post | B ADJ actual signer | positive/negative/zero/failure | password/reason Post | whole commit/release or rollback/lock; safe passwordDOM | UI+DB groups/Audit/locks | NOT_RUN |
| ST040-B10 | P0 FR101 Cancel | B OP actual password | Draft/Counting/Ready/device-revoked/inactive | UI Cancel | no device need, exact history/release/no Movement | UI+HTTP+DB/clearedDOM | NOT_RUN |
| ST040-B11 | P1 FR103 CSV/history | B stages/q/emptyBin | escapedCSV/truncated/terminal | UI download/view | q parity/SCOPE/footer/history/completeness warning | real downloaded CSV+UI | NOT_RUN |
| ST040-B12 | P0 FR102 lost response | B real commit barrier | drop Post response after commit | query/retry same source | one Movement/Operation, original receipt, no duplicate | actual HTTP barrier+DB counts | NOT_RUN |
| ST040-B13 | P0 FR102 refresh unknown | B controlled unresolved request | original frozen intent then refresh | refresh/query oldsource | minimal storage, QUERY_ONLY/no reconstructed write | UI+requests+DB+safe record | NOT_RUN |
| ST040-B14 | P0 SEC012 observable auth exit | B actual JWT/device/session/owned DB revoke | dirty/sending/QUERY_ONLY;VIEW vs OP/ADJ loss;failed refresh/device403;accessible topbar vs blocked modal | real revoke+signed refresh;401;actual topbar when reachable;labelled real logout-action+existing router trigger while modal | real changed claims precede403;clear at logout finally,no discard prompt;no forced click/mock clear;UNKNOWN/reference retained;no false view loss | real refresh/logout/401 request+minimized claim/clear timing+route/dialog/DB facts | NOT_RUN |
| ST040-B15 | P1 a11y/responsive | B cleared screens |320/375/768/1024/1440/keyboard/errors | Tab/Enter/Escape/resize | labels/focus/contrast/dialog/body bounds; no relevant errors | real DOM/bounds/cleared screenshots | NOT_RUN |
| ST040-B16 | P0 tool proof/diagnostics | B owned CLI/session | actual wizard Count/Ready/query/export | named CLI+console+requests/abort/empty | real controls exercised, zero unexpected JS/network; owned cleanup |16JUnit+actual CLI observation | NOT_RUN |

Risk trace: FR092–094→C04–06/B02–03; FR095–097/FR011→U01–11/A02–11/C07–14/B04–07; FR098–103→U08–10/A10–14/C15–23/B08–13; SEC008/012/013+FR116/117→U01–05/U07/U11–12/A01/A03/A06–07/A12–14/C01–03/C17–22/C24/B01/B09–10/B12–14/B16. Typed Task040 also links existing query/security/permission designs/tests additively; no formal definitions/mandatory flags, procedures, applicability or required IDs removed. A requirement is planned, not execution-covered merely by this table.

Old 664 run reports/failures/source approvals remain historical on their exact baselines. New DESIGN/PLAN/source adoption invalidates their use for current checks, never relabels them. UI functional/paged200/row-count evidence is not capacity/SLA/soak/writer/restart/crash recovery or proof existing shared ServerResponse warning is fixed. These remain TASK041/fullP4 obligations. Five current CI/freshmain/MERGE_READY/finalhead review and phase-PR grouping remain; no Task040 localDONE before actual final Sam implemented-source review.


### Shared topbar bounded-label contract — HD166 A / HD167 exact candidate

PROPOSED_NOT_APPLIED / NOT_RUN. HD166 approves preparing this candidate only. This addendum is the sole exception to TASK040's prior18-path/shared-layout exclusion: add AppTopbar.vue and its existing AppTopbar.test.js, total20 source/test paths. Keep the old20 immutable regression pins and the new unchanged-shell guard pins. No new route, permission, public API, Item/DDL/auth/session/router/menu logic, global stylesheet, dependency, DataTable or AppShell modification. Every authenticated AppShell page consumes this one header, so impact is application-wide visual layout, not Stocktake-only business behavior.

**Minimal presentation policy.** Keep QToolbar, original brand/menu button, QBtnDropdown icon/arrow and all three existing menu handlers. Keep the original full `session.user?.displayName` value as the QBtnDropdown label; the installed Quasar derives its expanded/collapsed accessible name from that full prop. If a label slot is used for an ellipsis span, do not replace that full prop, inject HTML, slice strings or write a shortened value to session/storage/API/DB. Render names as plain Vue text, including Unicode and literal markup-like characters. Use local scoped flex/min-width constraints and existing ellipsis conventions: the account trigger takes at most50% of toolbar inner width, with only its label shrinking/ellipsizing; icon, arrow, drawer toggle, focus indicator and menu gestures remain visible, nonzero and within the viewport. Short names retain their current presentation when they fit; long names may be visually shortened even on a wide viewport. App title may retain its existing natural ellipsis; the M brand and drawer toggle are not hidden. No fixed-character cutoff, whole-button clipping, body overflow hiding, global CSS override or DOM-mutating measurement watcher. Do not add a tooltip dependency or invent new missing-name/auth semantics.

**Accessible and behavioral preservation.** Full current name remains the trigger's accessible identity before/after opening, keyboard activation and live session-name change; preserve native expanded/control/focus behavior rather than masking it with a shortened aria-label. Profile/change-password/logout routes and session.logout finally-clearing stay unchanged, including logout request failure. This is not a new logout route, authentication guarantee or claim that topbar is reachable behind a persistent Stocktake dialog; keep the approved B14 labelled real action/router trigger split. During an ordinary reachable menu flow, Tab/Enter/Escape must open/close it and return focus to its trigger; menu entries and arrow must not be offscreen at any required width.

**Developer proof, not a claim of repair.** Existing native AppTopbar6 and AppShell3 cases remain, plus6 new H01–H06 cases, total at least15 zero-skip in one new mandatory DEVELOPER suite. Native/jsdom does not prove pixel layout or real keyboard behavior. Retain every old U12/API14/client24/browser16 minimum and zero-skip requirement; expand B15, do not add a passing substitute for it. On the actual running app, exercise home and Stocktake pages at320/375/768/1024/1440, with original long Latin, long valid Unicode and short-name fixtures obtained through real login/current authenticated reads, not injected claims. Check closed-sidebar/no-overlay document scrollWidth<=innerWidth before opening dialogs; measure header/account-trigger/drawer/icon/arrow bounds separately so an overlay or body clipping cannot conceal failure. Table-local horizontal scroll remains allowed; clipped table descendants are not body overflow. Use natural clicks/keyboard/scroll, no force-click, fixed sleep or shortened fixture. Verify drawer open/normal backdrop close and account menu geometry/focus in their separately valid states. Cover profile and change-password navigation plus successful and failed real logout on fresh owned actors without dirty/UNKNOWN navigation blockers; B14 separately retains its mandatory dirty/sending/QUERY_ONLY exits. B16 still requires actual named Playwright CLI. Preserve B15's Count error-summary focus, focus return, dialog/body bounds, contrast, screenshots with password fields cleared and all unexpected-console/network assertions. Capture at least the original five cleared-width screenshots, plus minimized geometry; manually inspect them. Console/request statuses from intentional negative cases must be exact and observed, not blanket-ignored.

**Regression and rebaseline.** Add only inventory-task040-topbar to profile/PHASE005; original suites, timeouts, tool/env/side-effect contracts, five CI checks,37 coverage floors, formal TC/UAT and phase-PR grouping stay unchanged. Run new native suite and existing full client coverage including Topbar/Shell/Sidebar/Profile/Password/Session tests, full old Inventory/Transfer/Adjustment/backend checks, true MySQL/API/Playwright and structural checks at final adopted PLAN/source. All old681 run refs, including latest15/16 FAIL and earlier masked-width diagnostic, retain original bytes/hashes and are not rebound to new PLAN. All new H cases and expanded B15 are NOT_RUN. No TASK040 DONE until all developer verification and actual final Sam exact implemented-source review; TASK041 capacity/writer/restart/crash recovery and shared-stream warning remain distinct. This candidate never grants evidence export, commit/push/PR/merge,CI waiver,P5,formal acceptance or deployment.

| Test ID | Priority / risk | Preconditions/data | Steps/input | Expected result | Required evidence | Initial status |
| --- | --- | --- | --- | --- | --- | --- |
| ST040-H01 | P1 full identity | mounted real Quasar, original long Latin | render/open/close dropdown | full label/accessibility name and native expanded state, no data truncation | native DOM/props/session values | NOT_RUN |
| ST040-H02 | P1 text/current identity | long valid Unicode/literal markup then short name | render and update current displayName | plain text/no HTML, current full name, original source value unchanged | native DOM/session snapshots | NOT_RUN |
| ST040-H03 | P1 profile compatibility | long-name actor and actual memory router | choose existing profile item | original profile route, one handler, no auth/scope mutation | native route/call assertions | NOT_RUN |
| ST040-H04 | P1 password compatibility | long-name actor and router | choose change-password item | original change-password route and menu behavior | native route/DOM assertions | NOT_RUN |
| ST040-H05 | P0 logout compatibility | long-name actor, successful logout seam | choose logout once | one existing logout call then login route; real clearing separately B14/B15 | native call/route plus real browser | NOT_RUN |
| ST040-H06 | P0 failure exit | long-name actor, rejected logout seam | choose logout once | existing catch/finally path still reaches login; no new handler/auth semantics | native failure/call/route plus real browser | NOT_RUN |

The new suite command is `npm test --workspace client -- test/framework/layout/AppTopbar.test.js test/framework/layout/AppShell.test.js --reporter=junit --outputFile={run_dir}/inventory-task040-topbar.xml`, timeout1800s, min15, maxSkipped0, Node^v26, FILES only, DEVELOPER only, no env additions. Six old Topbar cases and three old Shell cases cannot be removed or assertions weakened to meet the minimum. These are6 added risk cases:original66 stay intact, planned total72; 39 supporting client cases do not replace the24 minimum or these new H cases. Root/agent structural review cannot establish layout PASS.


## TASK-041 — 完成鎖覆蓋、原子過帳、並發及安全驗收 (legacy P4-T07)

### Goal
以 P3 所有 Bin mutation入口清單建立 parameterized lock coverage，驗證服務重啟、並發 Start/post/cancel、owner mismatch、partial failure及 persistent lock復原

### Approach
Implement only the scope and dependencies of legacy task `P4-T07` inside `PHASE-005` using the design decisions mapped in `08_traceability.json`.

### Acceptance criteria
- Receipt、Issue、Bin Move來源/目的、Transfer Dispatch/Receive、Adjustment、Status及Reversal對真實Start取得的locked Bin全部拒絕；Opening實際writer證據明確配置至P5的TASK044／TASK045／TASK051，保持強制阻擋且未執行前為NOT_IMPLEMENTED／NOT_RUN，不是PASS或N/A。
- 服務 restart不遺失 active locks；同 Bin並發 Start最多一個成功；非 owner不能 release。
- Post任一步失敗無部分 Balance/Movement/Audit，state/locks保持可重試；成功後 reconciliation為0差異。

### Definition of Done
The task diff is scoped, reviewed and covered by its mandatory technical cases; no formal acceptance is inferred from developer checks.

#### TASK041 sequential developer contract — HD170 direction / HD171 exact candidate

PROPOSED_NOT_APPLIED; all new checks NOT_RUN. This is the first test-only increment under the existing TASK041 identity, not the complete Task or P4 gate. After exact adoption, add only `server/test/integration/inventoryStocktakeSafety.integration.test.js` and `server/test-support/inventoryStocktakeSafetyChild.js`. The second file is a narrowly owned subprocess fixture, not a production service, new test framework or generic runner. Keep every existing product/config/migration/handler/client/test/helper byte-identical. A real product defect preserves the failure and requires a separate exact remediation proposal; this scope cannot silently fix it.

**Phase acceptance allocation.** P4's OnHand lock obligation covers every currently implemented Receipt/Issue/BinMove/Transfer/Adjustment/Status/Reversal entry and internal alias, plus Stocktake's exact own-lock posting/release. Opening's actual writer and its API/worker integration proof are explicitly allocated to PHASE006 TASK044/TASK045 and integrated TASK051 under FR094/DES007/TC008; the old full-module technical suite and all formal TC/UAT definitions/flags remain. Until actual P5 execution, Opening proof is NOT_IMPLEMENTED/NOT_RUN, never PASS, N/A, a fake writer or an absent-route404. P5 cannot close without genuine Start-created locked-Bin rejection and zero partial Lot/Control/Balance/Movement/Operation/Audit effects. PHASE006 still depends on PHASE005; no early P5 implementation or cross-phase Task dependency cycle is introduced. This is an explicit acceptance responsibility change, not merely command cleanup or a change to runtime Stocktake/Opening business rules.

**No residual gate waiver.** TASK041 cannot be DONE and PHASE005 cannot close merely because this first suite or the currently enumerated groups pass. Before Task closure, separately reviewed exact follow-up contracts and current-source execution must discharge (a) fullscale P4/Stocktake capacity and bounded resource/soak behavior, (b) abrupt-process CSV residue/retention/ownership-safe recovery and cross-worker reader/connection recovery, and (c) the existing shared ServerResponse listener-warning operational risk. No automatic TTL/tmp sweep/shared-framework fix/new SLA or risk acceptance is approved here. Undefined follow-up criteria are an unresolved closure prerequisite, not an optional test, a pass or an item silently moved to P5. At the end of this first increment, preserve TASK041 IN_PROGRESS and stop for those precise contracts; there is no Task-DONE/source-approval grant for the complete Task in this candidate. Independent Sam first-increment source review is still required but cannot close TASK041.

**New native command.** `inventory-task041-safety`: `node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/inventory-task041-safety.xml server/test/integration/inventoryStocktakeSafety.integration.test.js`. JUNIT, minimum24 individually named cases, maximum0 skipped, timeout1800s, DEVELOPER only, existing Node^v26 and MySQL26.7.0 probes, FILES/ISOLATED_DATA only. Missing fixture/file, disabled flag, fewer than24 cases, missing mandatory ST041-S01–S24 behavior, unexpected early rejection or any skip/failure blocks the increment. These names are developer IDs, not fabricated TC008 formal PASS. Parent/child evidence must establish each named scenario rather than passing setup-only cases.

The environment allowlist is the unchanged TASK039 API group minus INVENTORY_STOCKTAKE_API_TESTS plus INVENTORY_STOCKTAKE_SAFETY_TESTS: DB_NAME, DB_SOCKET_PATH, DB_USER, DB_PASSWORD, DB_INTEGRATION_TESTS and existing eight Supplier/Customer synthetic bank-key ID/ring variables. Preserve its five existing redaction keys and append only the new test-enable flag to permitted names. Use fresh `erp_inventory_task041_<unique>` on a positively owned socket-only MySQL26.7.0 under `/private/tmp/erp-inventory-task041-mysql-2670.<unique>/mysql.sock`. Fresh test-side existing migrations/full application schema and minimal synthetic fixtures only; do not re-run migrations on shared databases. Each child validates the same exact owned schema/socket before opening a connection. No new production migration/DDL contract. Standing Sam local synthetic resource/existing-migration/exact-cleanup authority remains, not another resource-permission question.

**Real boundaries.** Obtain semantic locks by the actual create/Start workflow; prove header/scope/lock ownership in DB. Exercise HTTP using the actual application, server-issued synthetic JWT, applicable real device signature/password and permission policy; internal aliases use existing fixed trusted caller contracts, never caller-reported permissions. Native process cases may use the existing approved trusted test contexts/proof constructors, labelled as such, and do not replace HTTP-signature proof. Existing TASK039 API24 and browser8, TASK040 API14/browser16+actual CLI remain mandatory regressions on the new PLAN/final source.

**No effect is more than an error status.** Establish valid stock/lot/Item/source/permission/version fixtures and a successful unlocked control for each writer, so rejection cannot be credited to missing auth, shortage, wrong Lot or a nonexistent endpoint. Assert expected existing semantic-lock code (Reversal keeps its approved safe reversal error contract), rollback of transient zero Control/Balance creation and unchanged successful business history. Failed-attempt Audit may be added only where the existing action contract requires it; distinguish it from forbidden successful Movement/Operation/audit effects. Test both COUNTING and READY locks, no automatic unlock on process startup. Original authorized replay is separately required to preserve its original result with no new OnHand effect even after lock state changes; a new source remains blocked.

**Subprocess synchronization and cleanup.** Two real service processes use separate DB connections and their own service/container objects, with exact process owner/PIDs and IPC readiness/barriers at observed transaction boundaries. Record positive SQL connection/transaction IDs, held lock/wait evidence and committed rows. A reconstructed object, fake restart, arbitrary sleep, injected binLocks array, forged successful COMMIT or mocked request cannot prove recovery. For before-commit termination, parent waits for observed connection termination and completed DB rollback before replacement process assertions. For post-commit lost response, parent observes actual committed operation/rows before killing the owned child. IPC sends only minimized synthetic IDs/status/handshake, never passwords/JWT/signatures in argv, reports or persistent session-state files. Child errors, timeout, signal, disconnect and parent failure must settle and clean owned process groups/connections. Never kill by broad process name or delete by prefix/glob. All new resources are inside the test-owned instance/schema/root; preserve original redacted failure evidence.

| Developer ID | Priority / requirement-risk | Preconditions / data | Steps / input | Expected result | Required evidence | Initial status |
| --- | --- | --- | --- | --- | --- | --- |
| ST041-S01 | P0 FR094/SEC008 HTTP Receipt | valid real HTTP actor/Item/Lot; Start-locked destination in COUNTING then READY | new-source Receipt plus unlocked control | semantic-lock rejection and no quantity/business effect; valid control commits | HTTP code, before/after DB/source/Audit classification | NOT_RUN |
| ST041-S02 | P0 FR094 internal Receipt aliases | valid fixed Receiving/Customer Return and ordinary Receipt transaction callers | each alias targets Start-locked Bin, then unlocked control | same no-OnHand effect under each fixed authority; no permission substitution | actual service entry membership, DB deltas/caller rollback | NOT_RUN |
| ST041-S03 | P0 FR094 HTTP Issue | actual Reservation/Allocation and sufficient multi-Bucket stock, second source Bin locked | valid signed/authenticated Issue using existing contract | all legs rejected atomically, allocations/reserved unchanged | HTTP, allocation/control/balance/source/history deltas | NOT_RUN |
| ST041-S04 | P0 FR094 ordinary versus Fulfillment Issue authority | separate valid inventory.operation actor and fixed fulfillment.operation provider, enough genuine Allocation | postIssue/postIssueInTransaction use inventory.operation; postFulfillmentIssueInTransaction uses its fixed fulfillment.operation contract; each targets locked source and has unlocked control | correct caller reaches semantic lock; zero inventory effect, caller rollback whole, no permission substitution or early auth failure credited | exact entry/caller/permission membership, guard error and persisted before/after | NOT_RUN |
| ST041-S05 | P0 FR094 BinMove source | valid move, source locked, destination unlocked | HTTP and InTransaction move | no paired leg, no new destination zero Bucket/Control residue | HTTP/native entry, all affected rows/history | NOT_RUN |
| ST041-S06 | P0 FR094 BinMove destination | valid source, locked destination with existing and absent target Bucket | execute both new-source moves and unlocked controls | rejection for destination lock; complete rollback | locks, all Bucket/source/group counts | NOT_RUN |
| ST041-S07 | P0 FR094 Dispatch | legal Draft multi-line Transfer, enough stock, a later source Bin locked | HTTP and native dispatch | Draft/transit/stock/history unchanged, no partial dispatch | transfer/lines/control/balance/Movement/Audit deltas | NOT_RUN |
| ST041-S08 | P0 FR094 Receive | legal InTransit Transfer, a later destination Bin locked | HTTP and native receive | remains InTransit; no partial destination receipt | transit/group/destination/source rows | NOT_RUN |
| ST041-S09 | P0 FR094 Adjustment IN/OUT | valid high-risk real proof, current version, eligible Lot, sufficient quantity | HTTP and native IN/OUT against locked Bin | existing lock rejection; no new Lot/Control/Balance or partial audit success | proof outcome/DB delta/unlocked controls | NOT_RUN |
| ST041-S10 | P0 FR094 Status | valid high-risk proof and current status Buckets | all supported status-leg directions in locked Bin | both legs reject atomically, no status quantity shift | exact paired effects and rollback | NOT_RUN |
| ST041-S11 | P0 FR094 Reversal | complete allowed server-derived group, later touched Bin locked | HTTP and native whole-group reversal with actual proof | approved safe rejection, no reversal links or partial inverse | original group immutable, source/Movement/Audit deltas | NOT_RUN |
| ST041-S12 | P0 FR094/102 replay compatibility | completed original source, then its Bin Start-locked; current auth valid | replay each reversible writer family and send distinct new source | original receipt unchanged/no new effect; new source blocked | original Operation summary bytes, membership/count deltas | NOT_RUN |
| ST041-S13 | P0 NFR007 Start-first races | current valid unlocked writer fixtures, two connections/processes | Start wins Warehouse serialization, each ordinary writer actually waits | waiting writer re-reads persistent lock and rejects entirely | observed SQL wait, commit order, zero loser effects | NOT_RUN |
| ST041-S14 | P0 NFR006/007 writer-first races | same valid fixtures with no synthetic preloaded lock | each ordinary writer commits before waiting Start | snapshot equals committed final current stock, including new/moved/status dimensions | actual wait and row/version/snapshot equality | NOT_RUN |
| ST041-S15 | P0 FR092/102 same-Bin exclusivity | legitimate Draft create/replace contenders; one legal Draft for Start | concurrent create/replace then two Start commands on same Draft/version | at most one unfinished scope owner and one committed snapshot/lockset; no fabricated overlapping Draft setup | both process results and unique DB ownership | NOT_RUN |
| ST041-S16 | P0 NFR009 COUNTING restart | child completes real Start on owned DB | terminate owned service process; fresh process reads and attempts all ordinary writers | exact active locks/snapshots survive; all new writes reject; authorized cancel can release only own locks | old/new PIDs/connections, committed rows, writer matrix | NOT_RUN |
| ST041-S17 | P0 NFR009 READY restart | Ready frozen through actual workflow | fresh process re-reads, renews required proof, Post or Cancel | frozen values unchanged; exactly one complete authorized terminal result | actual process identity/auth path/Movement/lock rows | NOT_RUN |
| ST041-S18 | P0 NFR006 Start crash before commit | IPC at actual in-transaction lock/snapshot boundary | terminate child before COMMIT; observe DB connection terminal/rollback, then retry original source in new process | no partial scope/lock/snapshot/business effect; one later complete Start | transaction/connection IDs, rollback observation, original-source rows | NOT_RUN |
| ST041-S19 | P0 NFR006 Post crash before commit | Ready multi-Bucket variance, child pauses after actual later Balance/Movement write | terminate child, wait DB rollback, inspect via fresh process and retry | all stock/history/state/locks return to prior READY, retry whole and once | actual uncommitted checkpoint and complete persisted equality | NOT_RUN |
| ST041-S20 | P0 NFR008/009 committed lost reply | Ready variance, parent positively observes real COMMIT/operation completion | kill owned process before response delivery; fresh current-authorized original-source query/replay | exact scalar original result; one effect and no duplicate Movement | actual COMMIT/rows before kill, source lookup/replay equality | NOT_RUN |
| ST041-S21 | P0 FR101 cancel crash | COUNTING and READY, multiple own active locks | child pauses after first actual unlock before commit then is killed; fresh-process retry | no partial release/terminal state; original source later releases entire own set, no Movement | before/after owned locks/history/connection rollback | NOT_RUN |
| ST041-S22 | P0 FR102 terminal races | two real processes with valid current proofs | Post-vs-Post and both Post/Cancel arrival orders with positive SQL waiting | one complete winner, loser version/state conflict, no duplicate/foreign release | wait evidence, terminal/version/source/effect totals | NOT_RUN |
| ST041-S23 | P0 SEC008/013 owner and revocation | valid scope plus foreign Stocktake/child IDs, current role/device/session fixtures | tamper ownership; revoke during actual Warehouse wait and retry/replay | no foreign unlock/effect, fresh authority refusal; no forged client permission accepted | exact rejection/current authority rows/full state deltas | NOT_RUN |
| ST041-S24 | P0 NFR006/FR099/101 reconciliation | genuine count/gain/loss/zero/notFound and existing Reserved/Allocated controls | complete Post and separate Cancel after restart; query ledger projections | OnHand vs signed Movements/Stocktake variance links match; allocated floor and Reserved coverage hold; Cancel zero Movement; no unrelated history rewrite | explicit per-SKU/Warehouse/Bucket/line/operation reconciliation queries with0 mismatches | NOT_RUN |

**Regression and rebaseline.** Replace only PHASE005's DEVELOPER relation to whole-module inventory-technical, not that suite's definition/stages/requiredTC IDs or module formal mapping. The phase now explicitly requires every already-defined compatible DEVELOPER suite plus inventory-task041-safety; root lint/build/Inventory, all035–040, P2/P3, Sales, original Customer/Core capacity, server/client coverage/floors/audit and actual old/current Playwright groups remain. Those older capacity groups do not substitute P4-specific future capacity/soak proof. Existing37floors/global92/83/90/fivecurrentCI/freshmain/finalheadSam/MERGE_READY/oneP4PR are unchanged. Before eventual TASK041 completion, the exact follow-up P4 recovery/capacity suite contracts must be adopted and added to this phase mapping; without them closure remains NOT_READY.

Rebind all current40 accumulated P4 source/test/migration pins without changing a byte, including0065 and existing shared Topbar/error translations, solely for scope consistency at the proposed PLAN. This is no-write revalidation of previously reviewed work, not permission to alter historical source or prior tests. All715 original run reports retain original source/PLAN and hashes. Every required current-source check must be rerun at adopted PLAN after the two new test files are implemented; do not relabel old PASS. The new suite's HTTP and subprocess evidence must actually run with zero skips. Actual Playwright CLI and existing browser groups remain required for the phase, although no UI source change is authorized here. No product remediation, future increment source, CSV recovery policy, new SLA, P5 implementation, evidence export/commit/push/PR/merge/CI waiver/formalTC/UAT/deployment is included.

### TASK041 second increment — anonymous-before-data CSV / HD174 A, HD175 candidate

PROPOSED_NOT_APPLIED。這一段只收斂短命CSV原文的pathname生命週期及程序／多worker功能恢復，不是TASK041 DONE／完整P4容量與soak／正式部署平台批准。所有新案例NOT_RUN。

#### 精確範圍與不變條件

只允許增量修改 `server/src/modules/inventory/InventoryStocktakeExportService.js`；只新增 `server/test/inventoryStocktakeExportRecovery.test.js`、`server/test/integration/inventoryStocktakeExportRecovery.integration.test.js`、`server/test-support/inventoryStocktakeExportChild.js`。其餘41個累積產品／測試檔及既有guards保持byte-identical。沒有新endpoint／schema／migration／依賴／設定、shared framework／auth／reader factory改造，沒有自動tmp掃除器、TTL、job、resume或下載URL。

成功CSV格式、filter／PREVIEW／FROZEN、Audit、100k上限、500批次、原route120秒／半剩餘生成budget、pool1、單process／primary service一個非排隊generation slot、最多一條額外reader、實際socket終止後才釋放slot、逐chunk最新授權與零預讀均不變。41檔／guards的精確pins與46組開發檢查清單在候選JSON；原44組逐項不變，新加兩組，不移除正式TC／UAT／37floors／五項CI或Opening的P5真writer責任。

#### 匿名檔案的安全合約

1. 仍在realpath(os.tmpdir())下建立request-owned0700目錄及wx+／0600檔案，立即記錄成功取得的handle及identity；只接受可取得可信numeric effective UID、regular file／directory、相同owner、精確0700／0600 permission bits、原file size=0／nlink=1的受信任本機環境。這不是單靠OS名稱的支援宣告；必須觀察實際runtime／FS語義。
2. **任何CSV header／row／footer bytes之前**，核對當前目錄、檔案entry及同一open descriptor的dev／ino／type／owner／permissions／empty／link條件；只unlink該次已核對的檔名。再對原descriptor核對相同dev／ino／regular／owner／permissions、size=0、nlink=0，並以lstat確認原pathname ENOENT。再次確認own-directory identity，只rmdir自己的空目錄，確認其pathname已不存在。全部成功且原signal／budget仍有效後，才用原handle寫入。
3. 生成、傳送都只使用原handle，不重開路徑、不複製到有名檔、不整份載入memory、不依賴GC。明確追蹤本次成功unlink／rmdir狀態；正常EOF、error、abort、destroy-before-first-next以及準備途中失敗均等待自己的已開始I/O完成後close一次。除非有成功操作紀錄及identity，不將任意ENOENT視為ownership證明。清理只處理原own inode／emptydir，不遞迴、不刪replacement／foreign entry；未知cleanup保留原錯誤與最小診斷，不宣稱乾淨。
4. 本合約信任OS帳戶與private目錄；pathname檢查不是對惡意同UID／root或遭竄改filesystem的原子防禦。unlink後的handle仍保留資料至關閉；不是安全抹除、保證立即回收disk、無FD／disk成本或防止host forensic。正式部署OS／filesystem尚未確認；未經目標環境驗證不得宣稱可用。Windows／NFS／SMB／FUSE不預設支援；缺少numeric effective UID或上述能力時CSV fail closed，其他Inventory功能不受影響。
5. semantic ownership／identity／mode／empty／link不符，以及新unlink／rmdir步驟的EPERM、EACCES、EBUSY、ENOSYS、ENOTSUP、EOPNOTSUPP、ENOTEMPTY、EEXIST或非預期ENOENT，回既有 `INVENTORY_DEPENDENCY_UNAVAILABLE`／503，無CSV response bytes；錯誤不暴露path／SQL／資料。只有預期的post-unlink／post-rmdir lstat ENOENT是成功。真正EIO／ENOSPC／EDQUOT、既有取得資源chmod／lstat／stat失敗保留原始error／既有安全500語義，不偽裝成完整／截斷成功；原request abort、401／403、generation504政策不變。失敗Audit仍由主要DB持久化；Audit本身失敗保留失敗，不承諾不存在的記錄。
6. unlink／rmdir／metadata工作計入既有生成budget；耗盡時不交付CSV，原timer／等待中abort及reader所有權規則不改。I/O無法瞬停時等待其settle再close；不在error後另起寫入。相容性失敗不回退named plaintext、memory或另一tmp root。成功路徑在首次data write前兩個pathname都消失；descriptor後續size成長時nlink仍0。

#### 崩潰、資源與安全清理邊界

child以真正OS abrupt termination驗證，不以正常finally代表crash。父程序只在收到實際syscall完成的checkpoint後終止自己啟動的精確PID/process group，等待正面exit事件；再查已記錄的primary／reader connection ID及INNODB_TRX是否消失。SQL可能仍在server等待：先證明child退出，再釋放本測試父程序持有的metadata／row阻擋鎖，才等待SQL清理，不能將等待中的連線誤稱已回收。替代worker可重新授權建立全新CSV，沒有持久job／resume，舊下載永不復活。

崩潰點涵蓋empty-open、unlink後但rmdir前、匿名且未寫入、已寫header／batch／summary、SQL等待、HTTP傳送中。前兩者最多留下本次own空file／emptydir；有資料時兩個pathname已不存在，父程序對自己的隔離scratch root作完整目錄inventory，核對沒有linked nonempty CSV。沒有把logger/checkpoint宣告當成OS／SQL terminal證據，沒有以回傳503代替無額外連線斷言。

不授權任何worker掃除別人的目錄。每個test worker使用父程序實際保留的獨立TMPDIR/private scratch root；清理核對parent登記的root／inode及child positive exit，僅逐項刪除可證明屬本次的空檔／空目錄，foreign sentinel與其他worker始終保留。未知ownership或nonempty residue立即FAIL、保留最小證據且停止刪除；不得以prefix／PID不存在／mtime作刪除權限。觀察只記path identity／mode／link／size／count／hash、HTTP status及SQL IDs，不保存CSV原文、JWT、密碼、key或簽章。

**尚未解除的P4 gate：** 這段僅量測功能案例的FD／socket／SQL／owned pathname回到已觀察baseline；不替完整容量／soak定新SLA。反覆在unlink前crash仍可累積空metadata，沒有production trusted ownership journal／清理授權；正式運維的磁碟／FD／emptymetadata監測、告警、受控處理runbook與容量／soak門檻仍需後續精確合約及人類處置，不能接受本段就視為豁免。既存shared ServerResponse listener warning風險亦保持blocking。完成本段後TASK041仍IN_PROGRESS。

#### Developer案例設計（不是正式TC／UAT）

共同前置：原approved Node26 runtime；U組fake SQL／auth但使用真local FS，只有錯誤分支可用明示注入；D組全新隔離MySQL26.7／既有migrations／合成user-role-permission／實際application／JWT HTTP，主要pool1。所有案例獨立fixture／確定性barrier，無固定sleep、無skip。每列指定的子邊界都必須斷言，不以一個happy path代表整列。

| ID | Priority／風險 | 資料與步驟 | 預期結果 | 必需證據 | 狀態 |
|---|---|---|---|---|---|
| ST041-EU01 | P0 ordering/privacy | 合成scope＋line；記錄實際open/stat/unlink/rmdir及每次write/read | 所有CSV bytes前identity／size0／link1→0與兩pathname不存在；同handle完成 | syscall先後、FD identity/link/size、parsed CSV與原內容一致 | NOT_RUN |
| ST041-EU02 | P0 directory ownership | 在pre-unlink檢查前受控替換目錄identity | 503、0 writes，不刪replacement／sentinel；只close owned FD | before/after dev/ino／write count／close count | NOT_RUN |
| ST041-EU03 | P0 file ownership | 受控替換entry為不同inode或symlink | 503、0 writes，foreign目標／entry保留 | 原及foreign identity、data hash不變 | NOT_RUN |
| ST041-EU04 | P0 preconditions | table-driven directory/file owner、mode、type、size非0、nlink非1、UID unavailable | 每個不符均503／無CSV；原始readonly條件斷言確實觸發 | 各分支輸入／拒絕點／0write／owned cleanup | NOT_RUN |
| ST041-EU05 | P0 unsupported unlink | 注入列明permission/busy/unsupported errno各支 | 每支503／0write；無named或memory fallback，原owned空資源清理 | errno映射／Audit errorCode／FS inventory | NOT_RUN |
| ST041-EU06 | P0 post-unlink proof | syscall後注入descriptor identity/size/nlink不符或原entry仍可見 | 503／0write，不據假成功寫資料 | pre/post stat與lstat、close，foreign保留 | NOT_RUN |
| ST041-EU07 | P0 emptydir removal | rmdir失敗含foreign child、directory identity改變、postcheck非預期可見 | 503／0write，非recursive／foreign不刪 | directory inventory／sentinel hash／errno | NOT_RUN |
| ST041-EU08 | P1 acquisition cleanup | mkdtemp/open/chmod/lstat/firststat前後注入原EIO；含資源已取得尚未完整記錄 | 原error identity不被包裝；已知owned資源精確close／清理，unknown明報 | 原error===、各取得點與cleanup結果，原U15回歸 | NOT_RUN |
| ST041-EU09 | P0 EOF lifecycle | 完整SCOPE/LINE/SUMMARY／零line／ROW_LIMIT | CSV契約不變、同handle讀完、close一次、無owned names | parse/footer／close count／baseline | NOT_RUN |
| ST041-EU10 | P0 abort/destroy | anonymous生成前abort、stream first-next前destroy、讀取中error／abort | 無晚到寫入／chunk；等待I/O settle／close一次，錯誤不變 | causal barriers、terminal事件、0post-terminal IO | NOT_RUN |
| ST041-EU11 | P0 true I/O failures | first／secondwrite、footer及read注入EIO/ENOSPC/EDQUOT | 失敗不是truncated success，0unexpected later IO／檔案closure | 原error／write timeline／Audit outcome | NOT_RUN |
| ST041-EU12 | P0 budget | controlled time耗盡於unlink／rmdir／metadata等待，actual operation先settle | 504／0data、原budget不延長，cleanup後可再生成 | deadline／causal error／slot及FD終止 | NOT_RUN |
| ST041-ED01 | P0 real FS capability | 真MySQL＋JWT HTTP最小CSV，observer在首次write前查FD與names | verified installedruntime/localFS nlink0／names absent；正常CSV200 | FS/runtime觀察、parsed synthetic data/hash、HTTP／Audit | NOT_RUN |
| ST041-ED02 | P0 empty-open crash | child成功wx+／size0後、unlink前barrier；SIGKILL | positive exit；僅own empty artifacts，SQL/trx終止；新worker可重做 | inode/size、exit、processlist/trx查詢、清理proof | NOT_RUN |
| ST041-ED03 | P0 unlink crash | 真unlink／nlink0後rmdir前kill | 只可能空dir；無named CSV；FD隨exit不再由child持有 | child actualstat、parent inventory/exit／SQL IDs | NOT_RUN |
| ST041-ED04 | P0 anonymous prewrite crash | own空dir已移除、首write前kill | names皆無，無資料殘留pathname／無resume | syscall barrier、root inventory、positiveexit／connections | NOT_RUN |
| ST041-ED05 | P0 partial-data crash | first CSV header write完成且size>0後kill | FD nlink0、root無linked plaintext；新export完整不續寫 | actualwrite/stat、exit、重新授權200與footer | NOT_RUN |
| ST041-ED06 | P0 multi-batch crash | >500行、首完整data batch寫後kill | 舊沒有pathname、不假稱成功Audit／完整download | bytes/row boundary、DB Audit實際結果／no mutations | NOT_RUN |
| ST041-ED07 | P0 generated crash | SUMMARY完成後、delivery/Audit前kill | 未送bytes、無復活URL，stocktake/stock/operation不變 | realHTTP bytes count、DBbefore/after與path inventory | NOT_RUN |
| ST041-ED08 | P0 streaming crash | >1000合成行且實際生成長度>131072 bytes、SUMMARY起點>65536；完成successAudit；首次實際FileHandle.read最多65536 bytes，第二次實際read前設barrier，不得取得額外來源bytes或EOF；父真HTTP client已收到0<累計body bytes<=65536且尚無SUMMARY／end，再kill並等positiveexit | 確定不完整下載且footer未送出，需新授權request重做；保留真successAudit不偽造rollback；不宣稱觀察server send callback | 生成size／SUMMARY offset、真client data事件／累計body bytes、barrier未放行／第二次native read未開始、HTTP premature close／positiveexit、Audit及newrequest；無server callback或send次數證據主張 | NOT_RUN |
| ST041-ED09 | P0 simultaneous workers | A/B獨立process私有TMPDIR；A真正在generation，B正常；killA | B可完整下載，互不刪檔／不共享process slot；每worker最多2SQLclients | 兩worker PIDs／connIDs／FS inventories／B200 | NOT_RUN |
| ST041-ED10 | P0 same-worker slot | A實際blocking generation；同process B匯出，再releaseA | B503／0CSV且不新增reader/ownedfile；A終止後新request200 | SQLconnection觀察／FD counts／HTTP outcomes | NOT_RUN |
| ST041-ED11 | P0 SQL wait crash | ownedmetadata鎖阻擋真readerSQL；killchild，positiveexit後釋放parentlock | 已記錄全部primary/reader連線及trx才消失；replacement可完成 | actualWAIT證據、exit/release/query timeline／0unknownIDs | NOT_RUN |
| ST041-ED12 | P0 revoke stream | 真JWT HTTP、actualread後撤銷role/view、再放行待send | 最新auth拒絕，撤權後0chunk；FAILED Audit、anonymousclose | realpermissionDB mutation／bytes／Audit／cleanup | NOT_RUN |
| ST041-ED13 | P0 timeout/abort | 真HTTP初始化／SQL／FS checkpoint等待超budget及client abort | 原504或aborted，無CSV成功；無晚到query/write或leakedslot | realtimer／socketterminal／DBprocesslist／nextrequest200 | NOT_RUN |
| ST041-ED14 | P0 unsupported platform | 真HTTP＋真FS但對新unlink/rmdir注入明示unsupported errno | 503無CSV／FAILED Audit；不影響合法Inventory GET；下一次正常可用 | 明示injection非平台proof、HTTP／DBAudit／ownedcleanup | NOT_RUN |
| ST041-ED15 | P0 underlying disk error | 真HTTP對firstwrite／footer注入真error object EIO/ENOSPC | safe500／不漏path資料，不偽裝ROW/TIME_LIMIT；FD終止 | errno／HTTPbodyallowlist／Audit／cleanup | NOT_RUN |
| ST041-ED16 | P0 cross-worker foreign protection | 父ownedscratch內放foreign sentinel與另一活worker；僅清killchild已知空artifacts | 只清精確ownedempty inode；foreign及活workerbytes／hash不變 | ownerregistry／positiveexit／beforeafteridentity | NOT_RUN |
| ST041-ED17 | P1 repeat lifecycle | serial 10次normal／abort／fail／crash mixed，每次重授權重做 | 已知FD／SQL／trx／ownednames回baseline，prewrite emptyresidue先記錄後精確清；不稱soak | 每輪非平均counts、cleanup outcomes、0unknown | NOT_RUN |
| ST041-ED18 | P0 existing contract regression | 分頁>500、zero-line scope、filtered PREVIEW／FROZEN、ROW_LIMIT及合法TIME_LIMIT | 200前ready header/footer一致、無未點算假0，主pool1auth/Audit、原500/504邊界保留 | parsed CSV（不保存原文）／authcalls／realDB+HTTPcounts | NOT_RUN |

#### 精確命令／runtime／證據

新 `inventory-task041-export-recovery-unit`：`node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/inventory-task041-export-recovery-unit.xml server/test/inventoryStocktakeExportRecovery.test.js`，UNIT／DEVELOPER／FILES、timeout1800s、min12、max_skipped0、Node ^v26 probe，無新env。

新 `inventory-task041-export-recovery-process`：同一原生命令形狀，report `inventory-task041-export-recovery-process.xml`、file `server/test/integration/inventoryStocktakeExportRecovery.integration.test.js`，INTEGRATION／DEVELOPER／FILES＋ISOLATED_DATA、timeout1800s、min18、max_skipped0、原Node ^v26及MySQL26.7 probes。精確env沿用原Safety的DB／合成bank-key設定，只把enable flag換成 `INVENTORY_STOCKTAKE_EXPORT_RECOVERY_TESTS` 並加入 `TMPDIR`；完整argv／allowlist在候選JSON。缺少真DBflag不得把skip算PASS。

隔離runtime：parent唯一owner／run UUID、`erp_inventory_task041_export_<unique>` schema、`/private/tmp/erp-inventory-task041-export-mysql-2670.<unique>/mysql.sock`、parent保留的worker私有scratch root／動態loopback port。既有migrations與合成本機資源沿既有授權，不碰共享／正式DB。父程序在spawn前登記exactpaths、PID與保留埠，child實際使用後回報connIDs；child以正常application啟動、自己的JWT簽章與真HTTP GET匯出，不透過IPC傳credential。監控不修改production hook：測試只在child包裝實際fs/FileHandle／已存在SQLclient觀測，始終呼叫真正syscall／application；positive syscall checkpoint與故障注入在證據分開標明。HTTP送達只以真client的data事件／body byte數證明；不包裝或宣稱已觀察server write callback／send次數。ED08的barrier只攔在第二次native FileHandle.read之前，故未取得額外來源bytes或EOF，不額外修改HTTP pipeline。parent disconnect須停止／closeownedresources，不留下孤兒process。

先寫可失敗案例→觀察RED→最小修正→GREEN；realplatform capability不能用fakeFS或injectedstats判PASS。最終所有46組依新PLAN／最終source重跑，原失敗與799reports不換hash；舊guarded DB組各自真執行零skip，原全庫guardedskip不可冒充功能通過。既有真browser／CLI仍依原命令驗證但本段不改UI；本段最終精確source仍須Sam獨立審閱，且只批准本增量、不是TASK041 DONE。


#### TASK041 third increment — HD177 A / HD178-179 reconciliation / HD180 measurement-only candidate

PROPOSED_NOT_APPLIED。這是容量／resource characterization 的開發檢查契約，不是Start／Post或memory／disk新SLA。HD177只批准準備；所有新案例NOT_RUN。即使下列兩組全部PASS，TASK041仍IN_PROGRESS，P4仍NOT_READY，直到固定量測結果、另行Sam精確數值gate批准及新來源重驗，以及production空metadata／shared warning風險處置全部完成。禁止從本次數字自動採納一個容易通過的門檻。

**Exact source scope.** 只新增三檔：`server/test/performance/inventoryStocktakeCharacterization.performance.test.js`、`server/test/performance/inventoryStocktakeResourceSoak.performance.test.js`、`server/test-support/inventoryStocktakePerformanceChild.js`。前兩個是現有node:test原生測試，第三個只服務本次owned application subprocess／dataset／sampling，不是新框架或production service。45個累積P4來源／測試／migration及舊guards（含fileResponse.js、DB／HTTP／auth／limiter／JWT config）byte-identical。不能修產品、批次SQL、schema/index、共用pipeline或timeout；若量測暴露缺陷，保留原FAIL／NOT_OBSERVED並另提精確修正候選。不可把舊Core fixture縮小、改assertion或重用舊PLAN證據。

**Data, schema and ownership.** 每組使用獨立fresh `erp_inventory_task041_perf_<unique>` schema，socket-only MySQL26.7.0，daemon/socket位於 `/private/tmp/erp-inventory-task041-perf-mysql-2670.<unique>/mysql.sock`，必須正面核對PID／datadir／version／@@skip_networking／schema及完整既有migration ledger（含0065、framework JWT／idempotency／scheduler），再seed合成資料。沿用已批准本機資源／既有migration／精確清理，不碰共享DB或新production DDL。兩組不得共用上一組已改變的測試資料。

資料固定5 active Warehouses、每倉200 Bins、100000 active inventory-tracked SKUs、每SKU一個合法BaseUOM／exact Barcode、500000 nonzero Stock Buckets、2000000 Movements。50000 stocked SKUs在每倉各有2個Bucket，另50000合法無Balance SKUs；每倉100000行，每Bin500行，同SKU的兩個Bucket分配到不同Bin。stocked SKU按50% none／25% batch／25% expiry；none為NULL Lot，tracked兩個Bucket引用合法同SKU既有Lot；batch Lot的expiry_date明定NULL，batch_expiry Lot有合法expiry_date。每SKU第一Bucket AVAILABLE，第二依SKU交替QUARANTINED／DAMAGED；所有日期／BaseUOM／Item狀態合法，expiry在當次APPTIMEZONE業務日後365天，FIFO anchor可對賬。每Bucket初始OnHand100，allocated0；seed基線controls reserved0，250000個Warehouse/SKU controls的quantity／version正確；以下HTTP Reservation準備後的reserved／version按實際結果另列，不再聲稱全部reserved0。原有allocated／reserved競爭仍由未改Safety及035–040回歸驗證，本fixture不冒充大規模Reserved負載。

基線Movement為每Bucket4筆IN25，before/after為0→25→50→75→100，Balance version4；固定500000個基線Operation／movement groups及500000個基線scalar Audit，各group對應該Bucket四個ledger legs，Audit afterSummary固定使用原白名單quantity100／version4／rowCount4，Operation result使用原movementGroupId／status／lineCount欄位；result及source唯一且符合原serializer／schema。兩百萬筆Movement的Operation／source／Audit及維度／snapshot關聯必須合法；使用完整現有schema，不能刪FK／CHECK、只建簡化Item表或跳migration。fixture可用test-side bounded bulk INSERT建立基線，必須明示不是實際Receipt workflow執行證據；reconciliation在量測前為0差異。`ANALYZE TABLE`與seed時間單獨記錄，不算API延遲；不做OS cache flush、DB安全設定變更或擅自調cache／buffer pool。count／ready／post等被測流程不能用SQL直接改狀態、quantity或版本。所有容量指標在seed後SQL COUNT及全維度校核，不能只報生成參數。

**Candidate prerequisites, after seed verification.** 先完成原500k／2M／reserved0基線校核及20名actor真登入，再由既有6名writer以真HTTP `POST /api/v1/inventory/reservations/create`，每Warehouse對固定三個stocked SKU（none／batch／expiry各一）各建立quantity1、purpose符合原schema、minimumRemainingDays0的Reservation，共15張。這些SKU的minimumSaleLifeDays0且AVAILABLE OnHand100，Lot日期合法；create回應及當前DB必須ACTIVE／outstanding1／allocated0，對應15個control reserved1、version+1、15個新Operation及15個新Audit逐一比對，原500k基線Operation/Audit另列，總數不是仍500k。準備成本不算候選GET延遲，所有後續reconciliation包括實際Reserved及上述記錄；不SQL插入Reservation、不更改ATP或fake授權。後續盤點保持原Reserved覆蓋檢查，不豁免這15張預留；fixture不是大規模Reserved負載。

候選查詢只用這些真實有效reservationId、requestedQuantity1，輪流取5倉及三種tracking；策略按候選expiry_date而非Warehouse決定：每倉expiry候選是FEFO，無expiry的batch／none候選是FIFO。空結果以同一有效Reservation的page2取得（此SKU僅一個AVAILABLE Bucket，因此不多於一頁），並核對page1的實際候選／持久Bin鎖排除結果；不能以不存在Reservation、已取消Reservation或無Balance SKU取得預期成功。50k合法無Balance SKU只用於Code／Barcode／summary／Bin／Movement等適用查詢，不要求它們可預留或出現FEFO候選。排空後由writer走既有真HTTP cancel，逐張核對version／reserved釋放、Operation／Audit及replay；不直接SQL取消或抹除歷史。

**Real application/auth.** 使用現有createApplication與真實Stocktake／Inventory lookup／inquiry及user login／refresh handlers，既有security／limits完整啟用；相關app-owned file roots全部指向本次private runtime，無法證明隔離則BLOCKED。建立20個不同合成使用者／approved P-256 devices，固定12名reader／6名writer／2名exporter（每worker6／3／1）；reader與exporter只view，writer有view+operation+adjust。FEFO／FIFO候選HTTP沿用view+operation，只交給這6名writer；不給reader增加operation。這些是明示的DB fixture身份，不是正式授權證據；隨後以真HTTP `/api/v1/user/login`取得server JWT，每次Post有真password及新nonce／timestamp／body-bound signature，refresh用既有真簽章endpoint，不能caller自報permissions、fake JWT、trusted capsule代替HTTP auth或調長JWT15m／session8h。兩個workers共享本次生成的synthetic JWT key和同schema，secret只留private IPC／記憶體，不入argv／report；初始10名／worker登入不超過原每IP20次／10分鐘限制。依HD215精確候選，全部actor於steady600／1200秒各有一次signed refresh到期，在該actor下一個可admit原turn執行，逐筆記完成／延遲；writer每第四intended turn不讓位，兩次仍須在steady及原JWT expiry前完成。詳細admission／早期expiry／原配額規則見第十一增量；不能以401後重登或hidden refresh切掉續期案例。

**Actual bounds, not new SLOs.** 不覆寫write route30000ms、CSV route120000ms／generation半剩餘預算、DB acquire5000/query10000/transaction20000ms、queue200、requestLimiter100 concurrent／每IP20每1000ms、token expiry/session、one-generation-slot／最多每worker一額外reader。Soak固定2個真app subprocess，每個primary pool原10，configured primary容量合計20，另列最多2個owned auxiliary readers與1條parent監測SQL。20是primary的配置容量，不把closing/replaced transport或server PROCESSLIST瞬時數誤當保證的OS/socket上限；primary live／closing transport分開實測，不為它們另訂數值pass gate。auxiliary每worker前一transport未terminal不得重開的既有硬規則不變。pool1相容性另在characterization末尾串行用owned child現有test-side config測量，不改全域DB設定或混入2worker高水位。

**Timing and denominators.** parent使用monotonic elapsed clock。每次request記錄intended／actual dispatch、queue/scheduler lateness、first-byte／complete-body latency、method／固定action類別、status／安全error code、bytes、original command/source／key的不可逆識別hash（不含raw payload／token／password／signature）。JWT／password／key生成、auth／body receive、DB工作、回應傳送均在相應端到端request觀察內；warmup／seed獨立列出。以相同排序nearest-rank算p50/p95/p99，另保存每類sample count及最大值，CP01用已知數列self-check，但self-check不算負載證據。不得只取成功樣本判所有request延遲：成功、busy503、rate429、timeout、denied、abort、network及未知結果分開列percentiles／counts，並列包括失敗和未送出的全部offers分母；維持每actor／worker／minute分類和冷首輪／暖後輪，不能混合成一個漂亮均值。

未被新SLA約束的寫入／resource數字只有MEASURED，不自動PASS或FAIL。既有查詢p95<2000ms、不非法數量／部分交易、已批准authorization／idempotency／ownership是硬門檻，不能降成warning。查詢成功樣本p95仍單獨計算並斷言，同時對每個預期合法查詢要求真成功、正確內容、無429／503／timeout；失敗查詢不能剔除後說NFR已過。大型Start／Post未完成、不符合下述95%／max5秒容許缺失預算的採樣、未知效果或未執行分支必須逐項NOT_OBSERVED／INCOMPLETE，對應native case FAIL，不能以「timeout也是量測」令缺失的Post變PASS、skip或direct SQL準備Ready。保留已取得的安全原始metrics，未完成整體仍不閉合。

**Characterization matrix.** 同一全資料schema上按1／10／200同倉Bins（500／5000／100000行）各做3個獨立完整盤點，列每次首輪／後輪；另有一次zero-variance工作流作對照。Bins／Warehouse分配固定且公開，不能挑較少行的bin；每個flow的Draft→Start→分頁讀全行→100行/次Count→Ready→Post都走真HTTP。非零flow每行按id奇偶+1／−1，三種status／tracking均納入，至少半數GAIN及半數LOSS；每行的新Movement、line version、Audit、Operation、scope／完整owned lockset與OnHand效果一一比對，不以count或HTTP200代替。Start／Ready／Post的end-to-end、SQL query count／耗時與peak resources分開記錄；量測不宣稱具2秒寫SLA。任一操作失敗先用原source／operation query及當前DB確認無效果／完整效果／UNKNOWN；不盲重送或另key製造重複。確定無效果才可明確一次same-intent retry並獨立計樣本；需要人工處理或無法完成時保留FAIL，不能直接修DB以完成case。

**Fixed query workload.** 六類固定named families：Code exact、Barcode exact、SKU stock summary、Bin drill-down、FEFO/FIFO candidates、Movement常用warehouse/SKU/date filters。每family至少100個合法完成樣本：五個view-only families各由20actors每人5個，FEFO/FIFO family由6名writer依固定17／17／17／17／16／16分配100個，不要求view-only reader呼叫operation endpoint；20actor同時有其合法工作。適用的五個view families涵蓋stocked／legitimate-empty SKU與固定hot/cold IDs，candidate只用前述15張有效Reservation並涵蓋page1／page2，驗證結果和total／排序及parameterized EXPLAIN；plan不能full scan Movement或不受控full-table filesort。五倉各自都取expiry候選FEFO與無expiry的batch／none候選FIFO樣本；按原expiry_date、Lot／FIFO anchor及Bin／id次序核對，不新增或假設Warehouse策略設定。其後在每個100k-line盤點完整workflow的活躍期間，六family各另取100個樣本，這個minimum是跨Start／Count／Ready／Post的每round合計，並非要求快速Ready單一phase內600次。每phase至少一個query有真實server SQL／write in-flight重疊證據，其餘標明所屬phase；不能只在寫入前／結束後發送查詢，不靠delay/barrier延長產品phase以湊樣本。必要時在既有Count批次持續query dispatch；未取得重疊／樣本則INCOMPLETE／FAIL，不默默以閒置樣本替代。Stocktake list／detail／lines及progress／variance filters亦量測p95／SQL plans與正確分頁，但其新數值門檻待後審，不能僭稱屬原2秒SLA。

**Soak schedule.** 第二組fresh基線，2workers／20actors，120秒warmup（不計30分鐘）→1800秒steady→停止新offers／最多180秒drain；個別原HTTP／DB截止不變。每worker6reader／3writer／1exporter，固定依這10個lane順序round-robin。parent以同一monotonic steady epoch排定worker1的`t=n*125ms`、worker2的`t=62.5ms+n*125ms`，各n=0..14399；每worker恰14400個intended offers、每actor1440個，持續覆蓋全1800秒，達到minimum後仍不得停止lane。單actor最多1個in-flight HTTP，本候選不保留待送queue：該lane忙則此tick記notSentBusy，不能派給別的actor；落後一個完整125ms tick則記notSentLate，不補送過期offers。所有intended tick（含排程停頓）均須在報告分母及逐分鐘lane覆蓋中對賬；每worker每分鐘480、每actor每分鐘48個intended offers，任何缺段都FAIL完整性。真正dispatch間隔仍至少125ms；不到間隔的tick記notSentRate而非積壓／catch-up burst；記實際lateness，無隱藏queue。fresh auth／query佔用該actor原turn，不另增加request配額。clock只排定外部offers，不延遲產品SQL／commit／close以湊重疊或進度。

12reader輪流五個view-only fixed families及盤點list／detail／lines，不呼叫allocation-candidates；每reader steady內至少120次合法完整查詢。6writer的每第4個intended turn固定作candidate查詢（busy亦按該turn記notSent，不改成其他turn），其餘turn推進盤點或到期refresh；candidate sample由這6名writer提供。六原NFRfamilies各至少100個steady成功樣本且p95<2秒、零不預期query失敗。6writer各負責不同1-bin rolling scope，依完整500行工作流循環，delta交替±1避免長期quantity漂移；每actor至少3次已完成Post workflow，全部terminal效果校核、原source replay至少1次證明無重複。2exporter共同讀取本次事先以真Start建立且固定保留COUNTING的Warehouse5整倉100k行盤點，writer六個scope明確分配於Warehouses1–4、不重疊；不能建立兩張相互重疊的Draft來準備export。每actor至少10次steady attempted CSV、每worker至少1份成功完整或明確ROW_LIMIT footer。每10次中的第10次在真client已收第一body bytes後abort，若本次在傳送前已503則仍計真503、不假稱abort；各worker至少1個真正post-first-byte abort，缺少則INCOMPLETE。busy503／真abort不是下載成功，busy碼不能包裝availability達標；逐批／逐chunkauth、100k SCOPE+LINE cap、摘要／ordered-ID/hash與0foreign effects仍須驗證。Client以stream parser/hash消費CSV，不getBlob／buffer整份到parent，client自耗memory另列，不能污染server RSS。若強度／最小進度達不到，保留結果並FAIL量測完整性，不宣稱空跑30分鐘PASS。本組是Stocktake-focused mixed workload，不聲稱實測Receipt／Issue／Reservation全族在同一30分鐘負載；原Core mixed-capacity及Safety全writer回歸仍mandatory，未量到的交互負載在最終報告明列，後續數值gate不得因此豁免。

**Resources and warning evidence.** 每worker每秒一個server內生process.memoryUsage sample（RSS／heapUsed／heapTotal／external／arrayBuffers），以及實際own client socket／pool／transaction身份、FD計數、已建立own匿名CSV handle的size／dev／ino／nlink、own visible空metadata數量；parent每秒記自身resource、DB PROCESSLIST／INNODB_TRX／Warehouse waits。不得把pathname不存在當disk0、把RSS包括parent當server或把pool.end當socket已關。不同views不是原子snapshot，若未能精確關聯記UNKNOWN。每分鐘保存分布、high-watermark、首末與trend；不能僅每分鐘最大值掩蓋採樣缺失。逐秒sampling至少95%時點有完整採樣，最長gap<=5秒；這是量測完整性檢查，不是記憶體／disk效能門檻。所有遺失／I/O失敗如實記錄，不能補插平滑數字。FD enumeration／fstat／監測SQL自身成本單獨列明；observer不能改write/read/commit/close返回值、注入延遲或retaining已關handle，不能用GC強制回收／--expose-gc掩蓋成長。

既有資源觀察仍只包裝child自己的真fs/FileHandle及既有SQLclient；HD215只額外允許第十一增量精確列明的CS01-only被動Stocktake export lifecycle／Audit instance觀察，不擴至共享prototype／其他handler或HTTP框架，必須仍呼叫原操作並不替換資料；只追蹤由本worker本次own mkdtemp/open正面建立的inode，不掃全域tmp、不依prefix／PID／mtime刪東西。process warning事件只保存aggregate count/type/stack hash及最早3個安全stack；不調maxListeners、不移除logger／framework listeners或filter stderr。warning.emitter如要識別，只使用WeakMap及primitive ID，不在報告容器保留res／req／Warning物件；不為計數再掛ServerResponse close listeners。完成後warning與記憶體成長僅是觀察，不推斷無洩漏或接受風險。任何shared-framework修正仍不在scope。

**Persistence/recovery and exit.** seed／每round／steady每分鐘與drain後都用當前DB校核quantity／Bucket allocated底線／Reserved coverage、完整Operation結果／逐行Movement/Audit及stocktake own/foreign locks、snapshot/count/version／原source唯一性；不在不一致的多條即時查詢之間捏造原子reconciliation，steady只用明確single RR observation或可關聯已commit boundary，最終全量排空後reconcile=0差異。週期檢查自身成本列出且不持有業務鎖阻擋load。排空時先用正常password Cancel釋放本測試COUNTING盤點，再按前述真HTTP取消15張準備Reservation並核對Reserved回復；未知Post先查明，不直接DELETE鎖／改status；歷史POSTED保留直到整個owned schema清理。最後所有已開始工作settle／child positive exit、已記錄SQL／trx／FD／anonymous handle／own names回到相應app baseline或明確失敗；觀察timeout不等於已清理。180秒drain後未終止仍FAIL／UNKNOWN，coordinator可在驗證owned PID/group／schema/socket後精確終止本次資源，保留診斷；不聲稱OS即時回收、無leak或production cleanup已完成。

**Evidence and closure.** 每組寫 `{run_dir}/stocktake-characterization.json` 或 `stocktake-resource-soak.json`，包含source／PLAN／runtime／seed counts／actor lanes／sampler cadence／cold/warm／all denominators／samples及per-action outcomes／SQL plans／cleanup。內含 `kind:DEVELOPER_CHARACTERIZATION`、`performanceAcceptance:NOT_EVALUATED_PENDING_APPROVED_NUMERIC_GATE`、`task041:IN_PROGRESS`、`p4:NOT_READY`。安全與完整性每case的PASS／FAIL由實際JUnit判定；no new write/resource metric gets a passing numerical threshold. 所有新case NOT_RUN，TC/UAT flags不改。秘密／rawCSV／raw request bodies不寫evidence，只保存minimized metrics／hash／安全error code，local-only分類與原證據保留規則不變。

#### Exact P0/P1 developer cases — all NOT_RUN

以下共同前提為上述完整schema／資料、真HTTP與current auth、原timeouts／config、正面owned runtime；不符合前提不能當例外PASS。CP03–05各要求三個真完整nonzero flow，CP08補zero對照。每列都有required evidence，不以setup-only counts滿足minimum。

| ID | Priority／risk | Preconditions／data | Steps／input | Expected result | Required evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| ST041-CP01 | P0 NFR003/006 fixture／measurement correctness | fresh full migrated owned schema，5/1000/100k/500k/2M及20fixture actors | verify exactcounts/FK/CHECK／OnHand歷史／BaseUOM/lot/status及0reconcile；quantile／分類分母已知數列self-check；actual20login及15張真HTTP Reservation準備／差異校核 | 完整合法fixture與20不同真JWT/device，沒有改安全config；工具self-check不冒充load | actualcounts／ledger／schema/socket/version／fixturemanifest／primitive auth facts／self-check output | NOT_RUN |
| ST041-CP02 | P1 NFR001/005 unchanged query baseline | CP01 data，20users ready，尚無盤點write | 五view family各20×5、candidate由6writer依17/17/17/17/16/16合法queries，固定適用hot/cold/empty及有效Reservation page2，取實際EXPLAIN | 正確結果／排序total，各family>=100且p95<2000ms、零合法query失敗 | all latency/outcome分母、plans、data/host/config facts | NOT_RUN |
| ST041-CP03 | P0/P1 FR092–101 small scope |1Bin500行，三個fresh workflows，跨tracking/status | 真create/start，分頁全部IDs，100行/次Count±1，ready/post/replay | 三次完整效果及0reconcile／精確own解鎖；writes只MEASURED，缺phase則FAIL | eachphase latencies/versions/SQL counts/Movement/Audit/Operation/locks and known source replay | NOT_RUN |
| ST041-CP04 | P0/P1 FR092–101 medium scope |10Bins5000行，三個fresh workflows | 同CP03，不跳Count或減fixture | 完整三次效果；5k scalar Audits及原snapshot／status／Lot／日期保留；缺Post不算PASS | orderedID digest／perline effects及各phase resource/latency | NOT_RUN |
| ST041-CP05 | P0/P1 FR092–101 fullwarehouse |200Bins100000行，三個fresh workflows，所有行非零 | 原30sHTTP／20sDB constraints真完整workflow；不直接SQL製造Ready | 三次完整phase才算完整量測；若有timeout保留其原結果／rollback／UNKNOWN與未達phase，case FAIL，不設新writeSLA或自動改timeout | perroundphase／source outcome／all100k行effects／peakresources／unaltered constraints | NOT_RUN |
| ST041-CP06 | P0/P1 NFR001/005/006 coexistence | CP05寫入期間，20users六family | 每fullscope round之Start/Count/Ready/Post活躍期間派query；查明實際重疊，取每family>=100 | 既有queryp95<2s且合法queries全成功；真重疊／樣本不足則FAIL；no partial quantity/reconcile | overlaptimeline／allqueryfailures分母／perphase samplecounts／plans／currentDB | NOT_RUN |
| ST041-CP07 | P0 SEC012/013/NFR009 export bounds | 真100k行COUNTING，串行另測primarypool1；原cap／generation deadline | 原CSV實際生成/streamparse/orderedID hash，pool1非mock；採樣匿名disk／socket／busy | 真footer/rowcap／原auth／pool1及ownedreader上限保持；FAIL不能稱部分成功，no newmemory threshold | bytes／footer／fullIDdigest／actualFileHandle size+nlink／SQL/socket IDs／timings/errors | NOT_RUN |
| ST041-CP08 | P0 NFR006/008/009 complete result／zero control | 上述全部原結果及一個1Bin500行zero workflow | 真zero Start/Count/Ready/Post、原source replay；全量排空DB比對與cleanup | zero無新Movement/Balance版本效果但完整強auth/完成/解鎖；all prior完整effects／replay，未執行／未知不PASS；原失敗保留 | zero before/after／allphase coverage manifest／0reconcile／positive termination/ownedresource proof | NOT_RUN |
| ST041-CS01 | P0/P1 NFR001/005/006/009 sustained characterization | 第二fresh全容量DB、2apps／20actors／既有settings |120s warmup→1800s固定每worker14400offers的12read/6write/2export workload→<=180s drain，600/1200秒到期且下一可admit own-turn真signedrefresh並記完成／延遲，完整每秒採樣／逐分鐘data校核 | 全30min／樣本進度／正確分類、硬query與auth/atomicity／ownership維持；未知、少樣本、少phase或少時間FAIL；memory/write僅MEASURED，warning未waive，P4仍NOT_READY | all minute/actor/worker latency/offer/error/resource samples、refresh事实、periodic/finalreconcile、warning aggregates、native terminal and exactcleanup | NOT_RUN |

#### Commands, regression and authorization

`inventory-task041-characterization`：`node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/inventory-task041-characterization.xml server/test/performance/inventoryStocktakeCharacterization.performance.test.js`；DEVELOPER／INTEGRATION／JUNIT，min8個named cases、maxSkipped0、timeout7200s。

`inventory-task041-resource-soak`：同argv，report `inventory-task041-resource-soak.xml`，test `server/test/performance/inventoryStocktakeResourceSoak.performance.test.js`；DEVELOPER／INTEGRATION／JUNIT，min1個實際1800秒steady named case、maxSkipped0、timeout2700s。2700／7200是native coordinator上限，不是延長任何app／SQL／auth deadline或production SLA；二組完整可能超過45分鐘，未完成／被runner終止保留FAIL/BLOCKED。不存在env縮資料／縮soak／縮樣本的開關。

兩組tool probes沿用Node^v26／MySQL26.7.0；FILE／ISOLATED_DATA；cwd`.`。Environment沿用export-recovery-process的DB_NAME／DB_SOCKET_PATH／DB_USER／DB_PASSWORD／DB_INTEGRATION_TESTS及8個Supplier／Customer合成bank-key ID/ring、TMPDIR，唯一enable flag改為`INVENTORY_STOCKTAKE_CHARACTERIZATION_TESTS`；兩組均要求DB_INTEGRATION_TESTS=1與該flag=1。redaction keys與既有runtime isolation／ownedcleanup政策不變，HARNESS_RUN_DIR等由原runner提供。DB／app／client ports由owner正面預留及strict bind，衝突不reuse別人的server。fixture fullmigration及test data由外層明確紀錄，不在runner偷偷連sharedDB。

PHASE005 developer suites只append這兩組，46→48，所有原commands／env／minima／maxskip／coverage37floors／global92/83/90／dependencyaudit／fiveCI／formalTC-UAT不變。原46組需在新PLAN及最終來源全重跑，全部專用DB／HTTP零skip；actual existingPlaywright＋CLI亦重跑，不改UI測試。新guarded performance files在未enable的支持性全庫native可明示disabled skip，不能算驗收，也不能豁免新兩組真實執行。最終新test source仍需Sam實際獨立審閱；兩組PASS不授予TASK041 DONE/P4closure，更不能拿characterization代替尚未批准的新write/resource gate、production emptymetadata維運或shared warning處置。


### TASK041 第四增量 — HD182 Control SQL 有界修復候選（HD181 A 準備授權）

PROPOSED_NOT_APPLIED。HD181／APR-263只准備方向；本段仍須 Sam 審閱精確 DESIGN／PLAN／scope 後才能採用、TDD及新負載。只解決已獨立重現的 Control prepared-statement 參數阻擋，不把原 HTTP500 的來源推論改寫為已捕捉原生錯誤；最新4例3PASS／1FAIL及 normalization 缺口、871份run refs全部保留。

#### 精確實作邊界

沿用HD180三檔：`server/test/performance/inventoryStocktakeCharacterization.performance.test.js`、`server/test/performance/inventoryStocktakeResourceSoak.performance.test.js`、`server/test-support/inventoryStocktakePerformanceChild.js`。只額外准修改 `server/src/modules/inventory/InventoryLockService.js`、`server/test/inventoryLockService.test.js`，總五個來源／測試路徑；不新增檔案、依賴、設定或DDL。

45個累積035–041來源／測試／migration仍全數byte-identical；HD180其餘guards不變。唯一解除舊guard的是LockService，原SHA256 `edd2eec39bfb3d51b17181833b89a4aa6aa37bc608a0840850abc78b7bbabb0b` 必須保留為before pin及後續增量審閱基線，不等於整檔任意重構授權。舊LockService單元六個既有test正文不改，只append六個新案例；它目前不是累積45檔之一。StocktakeService、Operation／Audit／auth／DB service／config、Lot／Balance／Bin／Reservation／Transfer鎖定SQL與legacy integration test均不改。

#### 最小演算法與不變式

1. 沿用完整input正規化、驗證、dedup及全局 `(warehouseId,skuId)` 數值排序。只在正規化後的Control陣列切連續、非重疊、最多1000鍵的固定內部batch；1000不是環境選項、業務盤點行數上限或SLA。
2. Warehouse鎖全部取得後，先按上述順序await**全部Control upsert batches**；每句保留原欄位、固定預設值與`ON DUPLICATE KEY UPDATE id = id`，每行四個bind、每句最多4000參數，同一原`now`。保持`connection.execute`及參數陣列，不將值拼進SQL、不改為較高DB限制、不改reserved／version／dates。
3. 隨後按同樣batch順序await全部Control locking reads；每句保留原OR鍵條件、`ORDER BY warehouse_id, sku_id FOR UPDATE`與`connection.query`參數陣列，每句最多2000參數。將各批DB原rows依batch順序串接成原`locked.stockControls`，不假造缺行、不覆寫row欄位。不把INSERT與SELECT逐批交錯，也不平行執行。
4. 所有Control INSERT／SELECT均完成後才進入原Bin／active Bin lock／Lot／Balance／Reservation／Transfer／Stocktake stages；每個stage與現有呼叫／回傳shape／錯誤映射不改。1000鍵以下保持原SQL和呼叫次序；空陣列仍無Control SQL。若後批失敗，不執行後續批或lock class，也不吞掉錯誤。
5. 仍使用caller-owned同一transaction與executor；LockService不begin／commit／rollback／另借連線、不在批間釋放鎖或更新deadline、不內建重試。由現有交易擁有者處理全量rollback或原commit-unknown語義；`ER_LOCK_DEADLOCK`／`ER_LOCK_WAIT_TIMEOUT`含cause包裝仍映射原`CONCURRENT_OPERATION`，其他原生錯誤仍原樣拋出。

代價：50k Control從原2句變為50句upsert＋50句locking read，鎖持續到原交易終止，完整鍵與結果仍O(n)記憶體，僅單句SQL／參數有界。這不是全局memory有界／所有SQL已修復／無deadlock／100k Post成功的保證。Lot／Balance或Stocktake其他大型SQL與每SKU成本尚未完整量測，若再失敗保留原證據，另作最小定位／必要決策，不自動擴大本候選。查詢p95<2秒、寫HTTP30秒、DB20秒、CSV120秒及7200／2700秒coordinator上限全部不變。

#### 新增六個單元案例（全部 NOT_RUN）

| ID | 風險／輸入與操作 | 必需斷言及證據 |
| --- | --- | --- |
| ST041-LU07 | 空Control、其他stage仍可輸入 | 無Control INSERT／SELECT；原空結果與stage順序，不需now；不是單純skip |
| ST041-LU08 | 999／1000／1001鍵，逆序及跨邊界duplicate、兩Warehouse | dedup後每個唯一鍵恰一次、批次999或1000/1、每句bind數、同timestamp；先全部INSERT再全部SELECT，全部Warehouse先於Control、全部Control先於Bin |
| ST041-LU09 | 50000個唯一Control，逆序 | 50個INSERT／50個SELECT，最大4000／2000bind，無超界／空批／漏鍵／重鍵；完整排序和原欄位不變，不把fake executor當DB效能證據 |
| ST041-LU10 | 1001鍵與分批DB rows | 回傳locked.stockControls完整順序、identity和reserved／version／timestamps與DB原值一致；既有其餘locked欄位不變 |
| ST041-LU11 | 第二個INSERT失敗，分別原生及cause-wrapped deadlock／timeout及generic error | 不進入任何Control SELECT／Bin或後續stage；原映射／generic identity；LockService未呼叫交易控制／其他連線。單元本身不宣稱真rollback |
| ST041-LU12 | 第二個Control SELECT失敗，原生及cause-wrapped錯誤 | 第一批回傳不被當成功；後續stage不執行、原映射不變、同executor；原六例及post-Lot timeout舊案例保留 |

新增一組DEVELOPER `inventory-task041-control-lock-unit`，Node26原生JUnit、`server/test/inventoryLockService.test.js`、至少12例（原6＋新6）、零skip、300秒coordinator，無DB／新env。不能以迴圈scenario數假裝額外native testcase。

#### 新增一個原生案例（NOT_RUN；增強而非替代HD180）

`ST041-CP09` 放在已准characterization test／child，不新增integration檔。沿用CP01真完整fresh資料、20actors、15真HTTP Reservation。執行位置在CP01之後、CP02與CP03–08負載之前，不修改CP02量測前的持久基線。原CP01–08／CS01所有前提、案例與最低值不刪；characterization min_tests從8提高至9，該組含CP09共9例，soak仍1例，共10個新案例。

透過已啟動child的`app.services`取得原application-owned MySqlDatabaseService，在固定私有IPC test action中呼叫其原`withTransaction`；使用原20秒transaction預算，不另建service／pool、不改timeout或假executor。wrapper只觀察實際交給原executor的SQL method／bind數／排序hash，或在指定第二個Control INSERT呼叫前投出明示TEST_INJECTED故障；所有未攔截SQL必須真的執行。此測試不是公開HTTP合約、不是額外handler或產品服務。不得傳raw SQL／任意函式／憑證給IPC action；只接受固定scenario，沿用既有正面runtime／schema／owner核對。原fixture parent monitor只做外部前後查核，不取得application-owned pool所有權。

必需三個subscenario，全部成功才此單一native testcase PASS：

- **原生50k現存Control。** 同倉50000鍵先shuffle／duplicate再送真正LockService；核對實際50個upsert＋50個SELECT及每句上限、全局順序、全部50000個原DB row identity／Reserved／version／created／updated，特別包含已真HTTP建立的預留。完整交易成功，外部monitor確認Control全表語義資料及所有其他業務表均無變化；不是只PREPARE或只比數量。日誌只保存鍵序／行資料雜湊及primitive count，不輸出憑證。
- **成功的未存在1001鍵再caller rollback。** 選同倉原無Control的合法既有無Balance SKU 50001～51001，assert前置確實不存在；同transaction真執行2個upsert／2個SELECT、確認當前可見1001新row及正確預設值，然後由callback明示TEST_ROLLBACK令原owner rollback。外部monitor核對1001鍵仍不存在、原250k Control及Balance／Movement／Operation／Audit前後完整行序雜湊相同；不依賴auto-increment counter不變，因rollback可能消耗ID。
- **第二批故障的原子清理。** 同一1001個原不存在鍵，第一個1000鍵INSERT必須真執行且transaction內看得到；wrapper僅在第二個Control INSERT原executor呼叫前投出固定TEST_INJECTED，不是偽稱MySQL原生故障。驗證原錯誤到owner、沒有Control SELECT或後續lock stage，owner真rollback；外部monitor完整對賬上述資料不變、無新Control／部分提交，SQL連線／transaction按既有owner清理。不能由fake單元推論此結果。

CP09不能證明Stocktake原500完整rollback。CP05仍須三次真HTTP100k行完整流程、原結果replay及每行效果／Audit／鎖終止全量核對；任何失敗都保留並FAIL，不靠CP09的局部成功洗綠。既有Safety／Counts／Flow／API的實際等待、撤權、allocation／reserved、foreign lock與全局writer／restart回歸仍必需，不新增未要求的SQL效能／死鎖承諾。

#### 驗證、來源與完成邊界

採用後先為原未修LockService寫六個單元及CP09的RED證據；RED不冒充新最終來源驗證。再實作最小修正，先跑12單元與原生CP09，之後完整characterization9例／soak1例；全部新來源與新PLAN重跑原48組，加新unit組為49。原48組只調整characterization min8→9，其他argv／cwd／env／timeout／max_skip／probes／adapter不變；無skipped放寬。全庫native／原37floors及global92/83/90、真DB／HTTP／Playwright＋實際CLI、既有容量、lint／build／audit、五項當前CI與正式TC/UAT要求不變。候選階段不跑新測試或負載。

原871份native refs／失敗原路徑及hash保留，不重綁舊green至新PLAN。HD180尚未完整實作或通過，所有尚未觀察的前提／phase／sampler仍未完成。最終實作須Sam獨立審閱精確來源；本段通過也只解決Control參數阻擋，所有write/resource仍MEASURED，另審數值gate及實際重驗。production空metadata、target filesystem、shared warning仍阻擋TASK041／P4；不授權source DONE／證據匯出／commit／push／PR／merge／CI豁免／P5／正式驗收或部署。


### TASK041 第五增量 — HD186 Lot tuple-IN 精確候選（HD185／APR-269只批准準備）

PROPOSED_NOT_APPLIED。只準備一個可否證的最小SQL候選：將Lot read的OR-pairs predicate改為單句row-constructor IN，先在test child比較原句與候選，滿足以下前置檢查才實作產品。沒有實測前不稱索引／optimizer／鎖等待是原500的底層根因，也不稱tuple-IN必然較快。本節是HD182「Lot不改」的唯一後續候選例外；HD182的Control演算法、45檔與其他guards保持不變。

#### 範圍與精確SQL

總五個來源／測試路徑不增加：`server/src/modules/inventory/InventoryLockService.js`只改Lot read predicate；`server/test/inventoryLockService.test.js`保留現有12例正文並append LU13–18；原characterization／resource-soak兩個performance tests及`server/test-support/inventoryStocktakePerformanceChild.js`承接CP10–12與原未完成的完整量測。後者仍須完成舊CP02／06／07／08與soak，不能以新三例取代。

候選Lot SQL固定為：

```sql
SELECT * FROM inventory_lots
WHERE (sku_id, normalized_lot_number) IN ((?, ?), ...)
ORDER BY sku_id, normalized_lot_number FOR UPDATE
```

`...`只由既有`lots.map(() => "(?, ?)").join(", ")`產生placeholders；沿用原`connection.query`、原`lots.flatMap`參數及原DB rows直接回傳。空陣列仍不查，單一Lot也用一個tuple；不增加fallback／feature flag／批次／SQL hint／FORCE INDEX／LIMIT／CAST／COLLATE／JSON／temporary table，不更動`lotRows`驗證、精確字串dedup、JavaScript輸入排序或其他SQL。不要改成`sku_id IN (...) AND normalized_lot_number IN (...)`造成交叉組合，也不改為JOIN而重複DB rows。

只換predicate，不新增輪詢、預讀、pool、transaction或外部服務。Control及Bin／active-lock階段仍全部先完成，之後才取得全部Lot，再進入Balance／Reservation／Transfer／Stocktake。全部Lot仍同一句、同一caller-owned transaction／executor，原`ORDER BY`及DB collation決定回傳順序；不把JS字串排序假作DB collation，也不把ORDER BY當成普遍的實體取鎖順序保證。保留原deadlock／lock-timeout映射、其他error identity、撤權／replay／current reads／rollback；不調高任何期限或DB設定。

0059定義`normalized_lot_number`為NOT NULL／utf8mb4_bin，既有唯一索引`uq_inventory_lots_sku_number(sku_id,normalized_lot_number)`；本候選不改DDL或索引。官方[MySQL26.7 range optimization](https://dev.mysql.com/doc/refman/26.7/en/range-optimization.html#row-constructor-range-optimization)說明多tuple IN可具備range access條件，但不保證本資料或單tuple採何plan。[InnoDB locking](https://dev.mysql.com/doc/refman/26.7/en/innodb-locks-set.html)指出實際掃描索引會影響鎖範圍，因此相同邏輯結果不足以證明並發相容；必需以下真DB觀察，不能只由官方文件推論本機結果。

#### 先診斷，再決定是否實作（新檢查全部NOT_RUN）

只在精確候選獲Sam採用後執行。採用後先在未改產品、完整fresh容量schema做CP10的固定OR／tuple-IN對照，再寫LU13–18 RED，及CP11／12的原語義基線。test child只接受固定`OR_BASELINE`／`TUPLE_IN_CANDIDATE`與固定scenario；SQL形狀由child常數生成，不接受raw SQL／函式／任意schema或HTTP新入口。兩個形狀都透過application-owned MySqlDatabaseService原`withTransaction`／tx.query，原query10000ms／transaction20000ms／acquire5000ms；不覆蓋每次timeout，不修改config、optimizer變數或統計，不加ANALYZE TABLE。原baseline SQL及shape hash固定保存，不以新產品SQL重建成舊句。

parent沿用既有一條owned monitor連線，只觀察受控app thread的plan／wait／lock／terminal和前後資料。不建立第二個monitor或額外app pool；test action使用原主要pool，不冒充新HTTP合約。對照前的connection／transaction ID必須記錄，未知terminal時禁止下一次對照／寫入負載；先確認原owned工作停止，再清理自己的資源，不殺其他thread。timeout／diagnostic failure保留primary錯誤及獨立診斷錯誤，observer原tx、剩餘callback參數、signal／options透明轉交。

每個形狀先執行原SQL的`EXPLAIN FORMAT=JSON`，另一次真正locking SELECT，不能把EXPLAIN或非locking替代當原查詢已成功。各自遵守原10秒deadline；EXPLAIN不執行原SELECT，不做EXPLAIN ANALYZE偷加一次執行。記錄最小化的access_type／possible_keys／key／used_key_parts／rows estimate／filesort／warning code；不保存SQL literal或參數。timeout時保存明確NOT_OBSERVED原因，不能臆測plan；候選plan必須實際取得，若無法取得不進入產品修改。讀取SHOW WARNINGS／P_S是診斷，不提高optimizer memory或開啟新server instrumentation；所需既有觀測不可用則相應case FAIL／BLOCKED，不靠空結果宣稱無等待。

25k組Lot採已觀察失敗的同一完整fixture keyset（100k盤點行所需的25k唯一Lot），查詢前由獨立有界keyset讀取保存完整預期row／DB順序雜湊。先標記首次觸及，不聲稱OS cold cache。接著六個warm配對round，固定交替OR→IN／IN→OR，兩形狀各六次，同一資料與原settings，每個獨立原owner transaction終止後才下一個；不flush cache、縮fixture、並行加載或排除失敗樣本。保存wall duration／SQL duration／成功與失敗分母，timeout是原10000ms右設限，不假作完成時間。有限參數與O(n)結果不等於全局memory有界。

只有以下同時成立才採用本候選產品predicate：候選六次全數在原query deadline完成、完整DB rows／順序一致，已取得實際候選plan；`max(IN完成時間)`小於所有OR樣本的最小已觀察完成時間或timeout的10000ms下界，避免把均值小幅變動當改善；CP11／12語義與鎖定相容前置檢查通過。這是保留這個優化的比較規則，不是新的生產寫入SLA／resource gate。若neutral／worse／語義或並發失敗，保留原產品及原失敗，停止此候選實作；不自動改成分批、FORCE INDEX、加索引或調整期限。需要另一方案時先提出新精確候選。

#### 六個append-only單元（NOT_RUN，原12例正文byte-identical）

| ID | 輸入／風險 | 必需斷言 |
| --- | --- | --- |
| ST041-LU13 | 空與單一Lot | 空無Lot SQL／原[]；單一tuple、query不是execute、placeholder／params、DB row identity、同executor及原stage |
| ST041-LU14 | 多SKU／同SKU多Lot、逆序、duplicate | 原正規化後的參數順序及精確dedup不變，只有tuple-IN、不含OR或cross-product IN，原ORDER BY／FOR UPDATE及SELECT *；所有值參數化 |
| ST041-LU15 | 25000唯一Lot | 一句50000bind、完整每鍵恰一次、結果不截斷／不分頁、不新增交易／pool；fake不算native效能證據 |
| ST041-LU16 | Unicode／大小寫／引號／trailing-space及無效鍵 | 合法原字串完整傳參、100-byte邊界原驗證不變；控制字元／空字串／超限／不合法SKU仍在SQL前拒絕；fake不證明DB collation |
| ST041-LU17 | Lot query原生或cause-wrapped deadlock／timeout／generic error | 原CONCURRENT_OPERATION映射與generic identity、不進Balance及後續stage、不吞部分結果、不自行commit／rollback／重試 |
| ST041-LU18 | 所有stage與DB原rows | 全部Control／Bin先於Lot、全部Lot先於後續classes；其他SQL／返回欄位與caller-owned交易不變，DB row欄位／identity不重建 |

#### 三個新增真MySQL案例（NOT_RUN，原CP01–09／CS01不削減）

**ST041-CP10：完整容量上的診斷與比較。** 位置CP01／CP09之後、CP02讀負載及CP03–08之前。執行上述EXPLAIN、六配對round、全25krow與DB排序hash、client／server thread correlation、deadline與terminal查核。只有取得候選plan／完整結果及通過比較與安全前提才PASS，baseline原超時作明示預期診斷結果，不能當產品CP05已通過；原timeout完整保存。test-side OR／IN對照在最終產品來源仍重跑，不由產品新句假造舊baseline。每次只讀且owner終止；16個Inventory表前後全rowhash相同、無新Operation／Audit／Lot或Inventory變化。

**ST041-CP11：語義、DB排序及不增減列。** 同一fresh schema，從既有batch／expiry合法SKU挑選固定測試對象；若需額外fixture Lot，只在原owned交易內建立、核對、最後明示owner rollback，逐表前後hash一致，不改持久容量基線。原OR與IN在相同tx／資料逐欄及完整有序ID相等：單tuple、多SKU／同SKU多Lot、重複input、合法但不存在key、大小寫／accent／BMP及astral Unicode／引號、trailing-space的DB相等別名（先實際核對欄位collation及PAD屬性）、相同Lot文字不同SKU、最大100-byte值。DB相等的input可能回同一row，預期以原OR／DB語義為準，不用input count硬湊結果或重複回傳。最終真正LockService回傳也須與oracle一致；原未改語義結果須保留為RED／對照證據，不能只比fake。

**ST041-CP12：實際鎖、等待後current read及owner rollback。** 使用獨立真連線持有已知Lot row，受控app交易進Lot階段後由既有P_S data_locks／data_lock_waits核對其requesting／blocking thread／transaction及index／key；取得關聯後才釋放，無任意sleep。等待者取得鎖後必須讀到blocker剛提交的完整row變更。為單獨看Lot不被Warehouse先序列化遮蔽，固定test-side`lockForCommand`只傳合法lots，warehouse/control/bin空（既有service允許）；這不新增業務入口。另在真正多stage caller中確認Control／Bin→Lot→其他class不變。

同SKU多Lot與跨SKU反向input各做受控late-key blocker：保存等待時較前key已GRANTED／目標WAITING、較後key未先取得的實際快照；DB key序由原collation查詢取得，不用JS順序。對missing key比較原OR／IN的相同索引區間insert阻擋／放行與最後row結果；對不相關SKU的更新也記錄是否受掃描擴鎖，出現候選特有的可重現鎖／deadlock回歸則FAIL，不以ORDER BY文字掩蓋。觀察只證明測試情境，不是普遍無deadlock或物理鎖序的數學證明。

在Lot取得後、Balance前注入明示TEST_INJECTED，原owner完整rollback；若before有測試新Control／Lot，核對全數不存在、既有16表完整hash不變，實際SQL session／transaction／lock terminal。額外fixture和blocker提交僅在可完全回復的專有測試資料；最後恢復原完整持久基線並全表hash核對，失敗不能污染後續負載。failure/error映射原unit與既有真API／Safety全局writer／撤權／replay案例重跑；不以單純SELECT成功取代原強認證或完整Stocktake流程。

#### Profile、保留證據與完成門檻

僅修改兩個既有suite的min_tests：`inventory-task041-control-lock-unit` 12→18、`inventory-task041-characterization` 9→12。名稱／argv／cwd／env／adapter／tool probes／timeout／maxSkipped0全不變，resource-soak仍1例。PHASE005仍49組，trace ledger及matrix不改；增加的是六個named native unit與三個named真DB案例，不把scenario迴圈冒充額外case。所有新案例現在NOT_RUN；現有characterization僅5個implemented cases、CP02／06–08及soak仍未完成，不能稱舊49組已全綠。

候選canonical只改design／manifest provided pin／profile minima／TASK041計劃四檔；manifest其他scope／contracts不動。產品before pin是HD182 Control完成後LockService `4338dee3378d13c39b686ba2684ca54a3e3897936d6f7a037c7737dcd37fa926`；舊12單元 `c00ded43e69cacd27542f805b66174a9e62fc901f7cc0f3bffb51f79cb58733f`。相較該before，只准Lot predicate與append六單元；Control／Balance等其他SQL、Stocktake／Posting／Transfer／Reservation callers、Item／auth／Operation／Audit／DB service／config／DDL／原45檔及其他20guards仍byte-identical。原共享writer消費者的既有unit／DB／HTTP／writer restart回歸全保留。

舊880份run refs／失敗保持原路徑與hash；本次沒有執行新SQL／負載、採用canonical或修改產品。採用後新PLAN與最終source須完整重跑49組、原37floors／global92/83/90、真MySQL／HTTP／Playwright＋實際CLI、既有容量、lint／build／audit與五項當前CI；正式TC/UAT不變。局部診斷符合並不等於100k Post成功，CP05仍需三輪完整100k流程／原scalar replay／全量Movement、Audit、Balance、Operation及own lock核對；任何後續大型SQL／逐行成本失敗保留證據再處置，不順便擴修。

所有Start／Post／memory／disk數字仍MEASURED，後續Sam精確數值gate批准及實際重驗、production空metadata／target filesystem／shared warning處置仍必需。最終來源需Sam獨立審閱；不含TASK041 DONE／P4關閉、證據匯出、commit／push／PR／merge、CI豁免、P5、正式驗收或部署。HD185只批准準備；精確DESIGN／PLAN／本五路徑及前置量測契約仍待Sam批准。


### TASK041 第六增量 — HD195 準備授權／HD197 精確 Post lookup 候選（HD196 P2修訂）

PROPOSED_NOT_APPLIED。HD195／APR-281只批准準備；本節需Sam精確採用後才可修改canonical／產品／測試或執行新負載。原HD186 Lot／Control修正及所有失敗保持原來源；不把靜態二次方工作量、worker CPU快照或client headers timeout當成已完成JS profile／同request SQL根因證明。

#### 精確範圍及保留邊界

本增量只允許四個來源／測試路徑：

1. `server/src/modules/inventory/InventoryStocktakeService.js`：只修改`postInTransaction`內的本地記憶體查找，不改其餘方法／`lineDimension`／介面。
2. 新增`server/test/inventoryStocktakePostLookup.test.js`：14個專用DEVELOPER單元，使用既有fakeInventoryDatabase、inventoryFixtures及真實sealed high-risk context issuer；這是trusted request fixture，不冒充真HTTP／簽章驗證。
3. `server/test/performance/inventoryStocktakeCharacterization.performance.test.js`：保留CP01–12（含仍待實作CP02／06–08），最後新增CP13；原1／10／200Bins各三輪及全零對照不縮減。
4. `server/test-support/inventoryStocktakePerformanceChild.js`：Post階段診斷、request失敗分母、有界transport及owned child終止／SQL終止核對，另加CP13固定test-only IPC action。原SQL observer透明轉交callback所有參數／signal／options。

原resource-soak測試路徑仍在既定TASK041容量工作範圍、尚待實作；不藉本增量改其workload／命令／門檻。已完成的LockService與18個單元新增當前byte pins，不能再改Control／Lot／Balance SQL。原45個累積檔只解除StocktakeService此一guard，其餘44檔及原20個guards保持原bytes；0065、035–040舊單元／整合／browser檔、Item、Inquiry、Export、HighRisk／CancelContext、共享framework／auth／timer、DDL、配置及dependencies不動。新的單元不修改或匯入會自動執行舊測試的檔案。

#### 產品演算法：同一次交易、同一批已鎖定資料

只用local Map／Set，以既有`lineDimension`結果及原`Number`等值規則建索引；不加class、共享cache／utility、依賴、外部服務或public export。索引每次Post新建；cached replay仍按原順序先fresh auth、回原scalar，不建立／重用上一個command的資料索引。

- Balance按完整Bin／SKU／NULL-Lot映射0／Stock Status dimension保留`first row + count`，不是最後一筆覆蓋。`matches.length`原先0／1／>1三種語義及原snapshot錯誤位置維持；不提前合併數量或用別的Bucket補allocated。使用原row引用，不clone／重排／替換DB欄位。
- Lot按`Number(id)`、Control按`Number(sku_id)`、Bin按`Number(id)`，保留原陣列第一個符合者；不默默新增不同的duplicate rejection或改成最後一筆。Scope採原`id+bin_id`配對，不能只比Bin。只存引用／count／必要key，不改Item profile或讀取來源。
- 依原`rows`順序建立legs；依完整dimension查找leg，並按SKU收集原順序的「無既有Balance且AVAILABLE」legs。原DB AVAILABLE查詢／回傳順序、changedSkus排序、eligible expiry／minimumSaleLife、逐步safe-integer累加及整張最終uncoveredReserved比較不變。不同SKU不混加；盤盈不能補另一Bucket的allocated缺口。
- 索引在原對應資料已取得後建立，不提前驗證其他行而改變first-error次序。所有原完整snapshot pin／row版本／狀態／身分、own locks、profile／tracking／Lot日期驗證、guard.check／assertTime／date檢查及交易內副作用順序保持。保留first-match與duplicate-count不是授權容忍資料損壞，而是避免優化改變原失敗語義。
- 所有產品SQL字串、參數、query／execute、caller-owned交易、鎖class及DB順序一 byte不改；每SKU profile／Reserved查詢與每行Balance／Movement／Audit寫入仍維持。因此本候選不保證100k Post達成原deadline，也不順便做batch SQL或改認證。若下一瓶頸需擴改，保留實測再問Sam。

只消除重複全陣列查找；允許一次線性建立索引及一次線性分組，不建立跨command cache。額外空間為所讀Rows／Balances／Lots／Controls／Scopes／Bins的線性索引，這不是總memory有界或RSS gate已達標；容量／memory數字仍MEASURED、另審數值gate並重驗。

#### 14個新單元：全部NOT_RUN，最低14例／零skip

| ID | 風險 | 必需斷言 |
| --- | --- | --- |
| ST041-PU01 | 空／全零Post | 原強認證、scalar結果／replay、完成與own解鎖；零Movement／Balance版本效果 |
| ST041-PU02 | 完整Bucket維度 | 同SKU跨Bin／Lot／NULL／三種Status不交叉匹配，DB原row引用及原順序 |
| ST041-PU03 | 重複／缺失Balance | count0／1／>1各保留原snapshot語義；不能Map覆蓋duplicate或替代stock_balance_id |
| ST041-PU04 | 帳外正差異／既有合法Lot | snapshot0／新Balance與原日期政策，第二副作用故障全回滾，無新Lot |
| ST041-PU05 | snapshot／版本／數量 | 身分、維度、onHand、version、安全整數不符仍原錯誤；不部分更新 |
| ST041-PU06 | Scope及first-error | scope id+Bin、錯行／錯tracking等成對錯誤按原行及原驗證次序失敗 |
| ST041-PU07 | allocated | 每Bucket底線，另一Bucket盤盈不得補allocated，整筆rollback |
| ST041-PU08 | 最終Reserved | 同SKU合法盤盈抵銷覆蓋損失，未覆蓋量不得增加；不可銷售／過期排除及safe sums不變 |
| ST041-PU09 | Control／Bin第一匹配 | 缺失仍原dependency錯誤，Number等值及原first-match，不重排或clone |
| ST041-PU10 | Lot第一匹配／日期 | SKU／NULL tracking／expiry／minimumSaleLife與原日期／第一匹配；不能由索引放寬 |
| ST041-PU11 | fresh auth／replay | 每次重取current資料／撤權後拒絕，原scalar replay，不跨command cache |
| ST041-PU12 | 副作用與原生錯誤 | SQL及params順序與before oracle一致、第二Audit故障rollback、原error identity／映射、無額外commit或query |
| ST041-PU13 | 查找成本／TDD RED | 真正呼叫當前Post方法，N=100與1000、反向keys及完整維度；只對service看到的row key getters計數，fixture自身篩選成本不算產品成本 |
| ST041-PU14 | 成本邊界／錯誤優先 | 在下述固定單Bin工作域，getter計數不超過`128*(rows+balances+lots+controls+scopes+bins+availableRows)`；`availableRows`是每個changed SKU之AVAILABLE查詢結果長度總和，含範圍外Bin及重複回傳列；保持同資料的原完整語義、SQL及錯誤次序；產品lookup改回全掃描的mutation必須被捕獲 |

PU13／14只主張固定一個selected Bin／一個scope／一個own lock的查找工作域，不把未改的`#bins`／`#ownedLocks`或整個服務宣稱為任意Bin數下的線性演算法；多Bin語義仍由PU02／06／09及原生1／10／200Bin流程驗證，不能以此限制縮減容量fixture。PU13在此工作域擴增rows／scoped balances至N=100與1000；PU14另固定一行盤點，將同SKU、同倉但不在盤點Bin的AVAILABLE結果擴增至1000與10000列，並含原順序的合資格／過期排除及safe-sum邊界對照。`availableRows`按實際各SKU SQL回傳陣列逐列計數，不能以SKU數、eligible數、去重後數或scoped balances取代；即使與scoped查詢指向同一Bucket，也各計該次回傳。對所有傳給service的discovery／locked rows及AVAILABLE回傳列，在fake DB完成WHERE／排序後才加getter觀測，連被排除列的key讀取也不能漏記。fixture自己的filter不計；原SQL／回傳順序／數值與錯誤次序不變。此額外範圍外案例併入PU14，不增加或降低14例門檻。

PU13／14使用有界getter tripwire，before舊source在超出同一計數界限時明示TEST_OBSERVATION_BUDGET_EXCEEDED而fail，不再跑100億次；這是測試注入／演算法回歸，不是產品deadline、原生SQL或新的生產性能SLA。getter不改row欄位值；fake DB oracle按WHERE／原排序回相同資料，記數不能由fixture自己的filter製造或掩蓋。新source需相同計數／資料／完整結果GREEN，保留before source／原失敗。不得複製產品函式作為唯一被測對象。

#### 真HTTP／CPU階段與有界失敗：不改產品timer

只增量改test helper。每個HTTP嘗試在fetch前分配synthetic UUID `X-Request-ID`，沿用現有requestLogger接受上游ID的行為，device簽章仍依原method／path／body／JWT，不賦予該header權限。先核對child context及實際response echo；無echo或缺事件標示NOT_OBSERVED，不猜同request根因。

所有characterization／soak JSON calls的parent transport watchdog固定30000ms，CSV固定120000ms，涵蓋fetch headers及body消耗，不延長既有server預算。parent與worker是不同程序；Abort只結束client等待，不宣稱已停止worker CPU／SQL或rollback。每次嘗試無論HTTP錯誤、header／body timeout、abort或parse失敗，都在原分母記錄status（無response為NULL）、code chain、requestId、worker incarnation、原route budget、dispatch／elapsed及未知結果，再保留primary error；不能只push成功response。當source結果UNKNOWN，不自動重試／取消／新寫入到同一worker。

沿用既有test-only transaction observer，記錄同request的開始／結束、process.cpuUsage差量、SQL count／累積wall-time及固定里程碑（locked rows read、第一個Reserved SQL、第一個mutation、complete／fail）；每request最多16個里程碑及100個最小化SQL failure摘要，超出須計數明示。用test-only IPC及parent時間標記，保留event可能延遲／缺失；transaction CPU不是JS函式profile，查詢間gap仍可能含profile queries／GC／其他worker工作，不能直接命名某函式根因。不記raw SQL／params／body／token／password，不改產品logger或Item prototype。

timeout／transport failure後先quarantine worker，再嘗試有界owned stop，不先對仍活動交易做全表snapshot而宣稱rollback。stop只用實際fork回傳的ChildProcess及其IPC boot incarnation／連線IDs，不能按prefix／任意PID／SQL KILL其他thread。每worker依序：graceful stop IPC最多5秒→尚未退出則SIGTERM最多5秒→仍未退出則SIGKILL並最多5秒觀察實際exit；OS未確認停止即UNKNOWN，不宣稱已關閉或恢復。獨立處理每個worker，第一個失敗不能跳過其他worker；primary失敗與每個secondary清理錯誤分開保留。

只有worker實際exit後，沿用唯一owned monitor及原bounded讀取，在最多20秒內以觀察到的connection／P_S thread／engine transaction IDs核對session／statement／transaction／locks terminal（保留失敗重試間新IDs）。沒有這些正面證據則DATA／SQL_TERMINAL_UNKNOWN，不刪／恢復fixture、不啟動下一個負載；coordinator精確shutdown／DROP只算強制隔離清理，不升格為應用Cancel／rollback或case PASS。正常工作負載任何watchdog／強制signal仍使原case FAIL，即使資源後來清乾淨；不以新狀態名稱吞掉原失敗。

#### ST041-CP13：單獨明示的test-only recovery情境（NOT_RUN）

此唯一新增named原生案例放在CP01–12及所有正常工作負載／reconcile之後，使用原fixture worker1（不新增app／pool／monitor或重新登入），worker0供正常fixture收尾。任何先前案例／terminal未完成先FAIL prerequisites，不在不明狀態注入新工作。CP13成功不取代CP05三輪Post成功。

原child只新增固定`TEST_ONLY_CPU_HOLD` IPC action，strict keys、boot incarnation／nonce綁定，沒有新HTTP endpoint／raw SQL／任意程式入口。於原application-owned交易讀取identity並`SELECT id FROM inventory_warehouses WHERE id=5 FOR UPDATE`，不寫資料。先經IPC送出actual session／P_S thread／transaction關聯，再以固定monotonic上限60000ms執行明示CPU hold；不是無限迴圈、產品timeout或效能樣本。原query10秒／transaction20秒設定不改；此fault刻意不能配合event-loop timer，不能宣稱其交易在20秒內正常停止。

注入前先用既有真簽章refresh更新worker1該actor的JWT，核對實際expiresAt距開始至少210000ms；同一actor及worker origin先完成正常authorized GET作存活／權限基線。不能在hold後才隱含refresh、把refresh timeout當Inventory GET結果。parent在identity通知後最多5秒內以原bounded monitor觀察實際own lock，再以worker1既有Inventory GET及真JWT發送請求；hold後必須實際等到parent30000ms transport watchdog，取得NULL status／明確timeout，不接受HTTP回應或連線錯誤就當相同情境。這不保證重用同一TCP連線、handler已收到請求或已驗JWT，不能作正式HTTP認證證據。接著使用上述5/5/5 owned stop及20秒terminal核對；必須在固定60秒hold自然結束前觀察強制終止，否則case FAIL。核對已發出的原SQL session／transaction／locks消失、完整16表before／after rowhash不變，worker0仍能正常授權query。為CP13預先登記的單一fault／incarnation可報EXPECTED_TEST_INJECTED_RECOVERY；不得把實際Post timeout、其他signal或相同worker另一請求包成預期成功。沒有正面terminal證據則case FAIL，原data hash相等不能單獨證明rollback。

after hook保留正常業務Cancel／解鎖與故障teardown區分。CP13已驗證退出的worker1可精確跳過二次stop；worker0仍需正常退出及SQL終止。任何非CP13的emergency stop都保留原case／cleanup失敗，不能報全綠。CP13只驗證合成故障下測試owner能有界收斂資源，不是產品CPU正確／正式恢復RTO或SLA。

#### Profile、trace與回歸

新增一組DEVELOPER-only `inventory-task041-post-lookup-unit`：沿用原control unit的Node26／testEnv／JUnit命令形狀，唯一測試路徑為新增PostLookup單元；timeout300秒、min14、maxSkipped0、FILES、無新env／tool依賴。原characterization只提高min12→13，不改argv／env／7200秒coordinator；soak原2700秒、所有其他欄位不變。PHASE-005 developer_suites append新unit，49→50；原49組均保留。trace registry／TC／UAT IDs不新增或改語義，matrix由ledger重算並核對，若相同保持bytes。

精確canonical候選只改design、manifest provided contract pin、profile、TASK041計劃、trace phase suite清單五檔。原893份run refs／報告保留原路徑與hash；新PLAN／最終source須重驗全部50組、37floors／global92/83/90、真DB／HTTP／Playwright＋實際CLI、lint／build／audit與五項當前CI。舊1d99各green／fail不得換hash重用。新14單元／CP13／watchdog及lookup全部NOT_RUN，不提前標PASS。

本候選不修改原正式TC／UAT，不關閉TASK041／P4。測後數值gate及實際重驗、production空metadata維運／目標filesystem／共享ServerResponse warning仍必需。實作後仍需Sam精確來源審閱；本候選不包含未見實作批准、證據匯出、commit／push／PR／merge、CI豁免、P5、正式驗收或部署。



### TASK041 第七增量 — HD204 準備授權／HD205 精確監測生命週期候選

PROPOSED_NOT_APPLIED。Sam APR-292 只批准準備本候選，沒有批准採用或實作。原 HD197 DESIGN／PLAN、來源 `32e05c95d7ee78e52b1a9130093761e76e007f62ce64c3f040c451695487bc4e`、helper `b1687670b37521a93eda08603c7a8ae1112f7043a638a5f91bd7701d7433d321` 保持不變。

#### 範圍與失敗基線

本增量只允許後續修改 `server/test-support/inventoryStocktakePerformanceChild.js` 及 `server/test/performance/inventoryStocktakeCharacterization.performance.test.js`。沒有產品、Item、DDL、DB／HTTP／auth框架、logging設定或新依賴修改；不新增app、pool、SQL monitor或HTTP endpoint。既有 Post-only 產品修改／14單元及其他44個累積來源、22個guard pins在本增量保持byte-identical；原soak與未完成CP02／06–08／13仍須完成，不能由新案例取代。`installTransactionObserver` 保持原透明call-through與原位元組；不在business executor插入metadata SQL。

實際失敗基線是 `evidence/task041-native-characterization-758bfa5fcd92/`：JUnit 2 PASS／7 FAIL／0 SKIP，9結果含after hook，未達原min13。CP10在OR SELECT round3出現TEST_OBSERVATION_TIMEOUT；其後CP11／12／03／04／05前置檢查失敗，沒有執行100k Post。最後OR SQL約10005.4ms、整體20001.7ms，符合20s採樣邊界風險，但沒有逐句monitor dispatch證據，不能斷言是哪句metadata SQL慢或已完全證明timeout分支。after hook缺少歷史native connection的當前P_S對應，正確保留SQL_TERMINAL_UNKNOWN。兩app實際exit0及完整16表rowhash相同，不代替SQL／rollback證據。coordinator已精確移除own隔離資源，亦不將原case轉PASS。

#### OL-A — 採樣窗口與工作／終止回執

保留原CP10兩個不同的20s預算：採樣窗口及終止核對窗口，不新增第三個等待窗口。所有底層monitor讀取仍使用同一絕對deadline的剩餘時間，單句最多原10000ms；產品query10000／transaction20000／HTTP30000／CSV120000ms、原graceful／TERM／KILL各5000ms及coordinator7200s均不變。這不是把任何20s產品期限延為40s。

在原RPC送出嘗試前記錄monotonic dispatchAt並立即設定samplingDeadline=dispatchAt+原20000ms，這個同一預算包含IPC／啟動身分等待，不能收到lot-probe-start後才開始計時。alive child若到samplingDeadline仍無matching start identity，或先完成卻沒有start，立即FAIL／quarantine，不再等待另一個啟動窗口；原owned stop／SQL cleanup另列而不轉PASS。每個CP10 probe記錄上述dispatchAt、samplingDeadline、child completion observedAt、terminalDeadline及逐句metadata的固定query-label、dispatch／settle／timeout、elapsed／remaining，不記SQL文字、params、secret或原文payload。最多保存原500份完整sample；超出仍計actualSampleCount與droppedStoredSamples，不能把儲存上限當完成。新增輕量query事件每probe最多10000個，超出仍有dropped計數；缺少必需失敗query事件則該證據UNKNOWN，不靠漂亮摘要宣稱定位。

依HD219待批准的窄例外，開始新完整sample先採固定1000ms剩餘准入，末段NOT_ADMITTED不發SQL且不算成功；詳第十三增量。已准入sample內下一句SQL仍只查原絕對deadline的剩餘預算，不套新reserve或重新計時。已耗盡而尚未發送SQL，只記SAMPLING_WINDOW_CLOSED；這既不是成功，也不能作SQL terminal或work completion。若預算在已發出的SQL期間用盡、SQL真正報錯、monitor被destroy、instrumentation／mapping無效或必要sample不完整，保留primary錯誤並FAIL，不能改名為正常窗口結束。不整份丟棄partial sample，保留已完成階段與已學身分；不從缺值補0。sample內只有「下一句尚未發送前預算已耗盡」可記明確WINDOW_CLOSED的partial observation；它不算完整sample，既有至少一份完整sample要求不變。

以 `min(actualChildCompletionObservedAt, samplingDeadline)` 作終止窗口起點（尚無completion時使用samplingDeadline）；terminalDeadline=該起點+原20000ms。sampling結束、late IPC、查詢重試或下一輪不能重新計時。終止窗口有界等待原child completion，只有收到matching completion後才可開始作為成功依據的完整正面SQL終止觀察，且其全部查詢必須在既定terminalDeadline內完成；completion前的Sleep／零活動觀察只屬歷史診斷，不能鎖存後拼接晚到回執通過。若completion先到，立即使用其既有終止窗口。沒有completion、完成後仍有statement／transaction／locks／waits、或正面結果在deadline後才到，一律FAIL。缺completion／未知SQL則先quarantine並走原owned stop／失敗cleanup，不能啟動下一probe或全表對帳。

OR baseline只有原DATABASE_QUERY_TIMEOUT可作明示預期診斷失敗；保留其原error、10s right-censor與實際wall time，且必須在上述窗口取得原工作回執與SQL終止證據，才可繼續配對比較。候選tuple-IN仍須六次完整、每次原10s內、完整25k結果／排序hash正確且max(IN)小於OR各完成值或10s下界；neutral／worse不採用。任何真正monitor失敗都不能因後來SQL乾淨而升格PASS。

#### OL-B — 已觀察身分的生命週期保存

使用本fixture owner私有的worker-keyed registry，鍵包含實際ChildProcess的boot incarnation／native connection ID／已實測P_S THREAD_ID。只有本次owned monitor的實際live mapping查詢確認PROCESSLIST_ID、唯一正整數THREAD_ID與INSTRUMENTED=YES後，才建立歷史entry；不能從PID、caller任意JSON、aggregate0或預期ID建立。啟動後、首個負載前用原metadata 5s預算保存兩workers已開連線的真對應；已存在probe、CP07／soak resource sampler的實際live mapping觀測及最後stop前capture亦更新同一registry，不增加背景輪詢或每條產品SQL觀測查詢。原pool connection通知只另記parent實際接收時刻，不能拿該時刻冒稱OS socket建立時間。

先前的可信mapping不因session從P_S移除或pool換線而刪除。新的native ID另建entry；同native ID改映射、跨worker重用已綁identity、外來incarnation、mapping尚未取得就消失、instrumentation缺失，均UNKNOWN／FAIL，不能沿用或猜測。這不保證捕獲所有可能的極短命新連線；未曾正面觀察到的歷史連線仍會阻擋terminal，不能藉此放寬。

`lotProbeState`在實際live mapping成立後記錄已讀身分，即使後續query失敗亦由finally保存；終止查核與cleanup retry直接更新同一owner entry，不複製後遺失新ID。另在同一既有monitor／絕對期限內讀取與該P_S thread關聯的實際data_locks engine token，將其原字串與THREAD_ID、ENGINE及觀測時間保留。InnoDB TRX_ID與data_locks ENGINE_TRANSACTION_ID分開保存，不轉JavaScript Number、不混用namespace、不以GROUP_CONCAT截斷或0補值。read-only engine token不解讀為已分配的InnoDB TRX_ID，也不假設跨時間全局唯一；歧義／foreign token碰撞保持UNKNOWN，絕不KILL或刪除別人資料。

在已知native／P_S mapping消失時，可使用**先前實際驗證**的歷史identity繼續做正面終止查核，而非立即把缺mapping當0。正常完整stop仍要求actual child exit、所有historical connection集合／incarnation精確對賬；目前session／P_S row／active statement不存在，已觀察InnoDB IDs不存在，其P_S及lock-token關聯的data_locks／requesting與blocking waits亦不存在，且全在原20s內。缺registry、未對賬的新connection、部分資料／metadata錯誤或無法消除的歧義一律SQL_TERMINAL_UNKNOWN。活worker的單一probe則仍可回到已實測Sleep／無活動statement／transaction／lock／wait的原terminal語義，不能拿它代替整個worker退出。

MySQL 26.7官方說明：threads row會隨session結束移除；read-only的ENGINE_TRANSACTION_ID不能直接解讀為一般transaction ID。本候選只據此定義保守命名空間；本機26.7的實際行為仍須原生測試，不由文件推定PASS。[threads](https://dev.mysql.com/doc/refman/26.7/en/performance-schema-threads-table.html)、[data_locks](https://dev.mysql.com/doc/refman/26.7/en/performance-schema-data-locks-table.html)。

#### OL-C — 新增單一ST041-CP14原生生命週期案例

CP14在CP01／CP09成功後、CP10及正常盤點負載之前執行；依HD217精確窄例外，在同一原full-capacity schema／monitor上建立一次短命OBSERVATION_ONLY pool1 app，和CP15共用同incarnation及原view-only actor私有copy；不更改原capacity兩個pool10／20actors或現存連線。第十二增量的owner／auth／retired終止合約須整體滿足；不是允許其他新app／pool或改產品。只有所有CP14斷言成功才設fixture.observationLifecycleVerified=true。CP14任何不完整／失敗（包括ABORT前失敗）都quarantine fixture，不執行新的probe／業務cleanup寫入；後續CP10／11／12、CP02–08及CP13必須先斷言此flag與無UNKNOWN，不能因node:test繼續下一case而再送工作，亦不以skip掩蓋前置失敗。它只驗證test owner的觀測生命週期，不作產品恢復RTO／SLA、真Post或正式授權證據。

child增加兩個固定test-only IPC：`TEST_ONLY_OBSERVATION_HOLD`與`TEST_ONLY_OBSERVATION_ABORT`，嚴格四欄`type/id/incarnation/nonce`，均UUIDv4／boot綁定。每worker最多一個預先登記的hold；ABORT只能處理同一active nonce、不能任意SQL／PID／程式碼／duration，無HTTP入口。hold用現有application-owned withTransaction及其原20000ms期限，僅讀native/P_S identity及固定`SELECT id FROM inventory_warehouses WHERE id=5 FOR UPDATE`，不寫Inventory。傳送實際identity與鎖checkpoint後等待該交易signal；ABORT對這個私有transaction的AbortController發出固定TEST_OBSERVATION_ABORT，沿用既有DB service signal中斷／destroy，不調timeout、不修改DB service或pool設定。signal亦須使等待中的callback本身settle，finally移除listener／active handle並回報callback settled checkpoint；只看到withTransaction的race返回不算callback已停止，不允許晚到SQL或工作。未發ABORT時原20s transaction timeout仍會取消callback，案例必須FAIL，不能當成預期TEST_OBSERVATION_ABORT。

依HD217，parent對OBSERVATION_ONLY app先真signed refresh及正常authorized GET，再正面斷言該owner所有已觀察／live app-pool identity恰好一條，保存HOLD／ABORT前完整集合；原capacity pool10不變，也不為湊條件主動關閉別條連線，不符合就FAIL。下述worker1的HOLD／recovery身分僅由該OBSERVATION_ONLY owner／slot2取代；原worker0對照GET及其餘證據不變。最多原5s內以真monitor核對該session／P_S／warehouse5 lock並保存identity／engine歷史，才發exact nonce ABORT。要取得含固定abort cause的原交易失敗回執，以及原20s內舊session／P_S／statement／InnoDB與locks／waits消失的正面證據；不能只看error code或connection.destroy呼叫。actual worker必須仍活著。recovery GET前再次核對沒有pre-existing alternate connection，也沒有其他worker1 in-flight請求；同actor／origin發唯一一個非cached、必須讀DB的真Inventory SKU lookup GET。其dispatch至完整response期間，parent必須收到原pool新建connection通知；完成後identity集合精確為原集合加一個從未出現的新native ID，且當前P_S只剩該新連線並正面核對mapping，舊registry entry仍在。以單一可用連線前提、真DB GET及實際新建通知關聯replacement，不宣稱直接追蹤每句SQL的connection；若有預先存在的第二連線／額外新連線／通知過晚／缺少mapping，就FAIL，不能只拿「與舊ID不同」通過。worker0仍可正常授權GET。依HD217，CP15完成時OBSERVATION_ONLY必須先正常ack0／exit0及全歷史SQL／socket terminal，才移除slot2並放行後續；最終normal after hook對兩capacity workers及retired owner全部歷史重新核對，不刪記錄、不新增forced-stop豁免；原CP13的單一預先登記CPU故障豁免不擴用至任何其他失敗。

CP14前／後完整16表rowhash相同、無新Inventory Operation／Audit／Movement；rowhash不是terminal的替代品。hold／ABORT及callback correlation的所有原始失敗保留。若true signal沒有終止原session或無法觀察replacement，就FAIL，不改fixture／DB或fake結果完成案例。CP13仍在CP01–12、CP14及所有正常負載／reconcile完成後才可注入；舊missing CP02／06–08不能由CP14或支援性案例湊足。

#### 必需開發驗證 — 全部NOT_RUN

採用後先以精確函式／完整helper的私有support TDD重現，再實作最小修正。fake clock／controlled peer／故障注入必須標SUPPORT_ONLY，不增加原生case分母；最低17個support scenarios及targeted mutation均需保留原始輸出。真MySQL／HTTP結果不能由support推定。

| ID | 支援性風險與預期結果 |
| --- | --- |
| OL01 | 已到20s且下一句未dispatch：不發query；WINDOW_CLOSED不算完整sample或成功 |
| OL02 | 已發query在deadline到期／真正SQL錯誤：原錯誤identity保留且FAIL，不降為窗口結束 |
| OL03 | 20.001s才收到原OR query-timeout回執：只有在原terminal窗口內完整正面終止才可接受預期診斷；非OR錯誤仍FAIL |
| OL04 | child永不reply／reply或terminal過期：FAIL；late reply不重開20s，actual owned cleanup另列 |
| OL05 | child提早完成：terminal窗口從實際completion開始；不等到sampling上限才計時 |
| OL06 | zero完整sample／partial metadata／instrumentation缺失：FAIL／UNKNOWN，不補零 |
| OL07 | 正面live mapping後session消失：保留歷史，再實際查核所有終止條件；未曾有mapping則FAIL |
| OL08 | 同native改P_S、foreign incarnation或跨worker碰撞：拒絕且保留協定錯誤，foreign狀態不變 |
| OL09 | 讀到新ID後下一句query失敗／cleanup retry：原owner仍保留ID，不因副本或primary錯誤遺失 |
| OL10 | read-only engine token／大整數ID：字串與namespace分離，不能冒充InnoDB TRX_ID或截斷 |
| OL11 | engine／thread等待任一仍在、token有歧義或late connection：必須UNKNOWN，即使child已exit0或rowhash相同 |
| OL12 | first worker清理失敗不跳過第二個；normal錯誤不套CP13豁免；report caps超出有drop分母且不洩raw資料 |
| OL13 | alive child不送start也不完成：從dispatch起原20s FAIL／quarantine，不等outer7200s |
| OL14 | start在deadline後才到或收到start才計時的錯誤變體：不能重開採樣窗口 |
| OL15 | pre-existing alternate connection冒充replacement、額外新連線或GET區間外通知：拒絕，不拿ID不同作證據 |
| OL16 | CP14在ABORT前及ABORT後未terminal兩處失敗：後續probe／workload／CP13均零dispatch，保留前置FAIL及owner cleanup |
| OL17 | completion前曾Sleep／零活動、其後再有SQL才送matching completion：舊觀察不得拼接通過；只有completion後重新開始並於原deadline內完成的完整terminal查核可成功 |

至少以「到期仍再dispatch」「late reply重計terminal」「缺mapping補0」「把engine token當TRX_ID」「cleanup副本丟ID」「收到start才計時」「pre-existing alternate冒充replacement」「CP14失敗仍dispatch下個probe」「鎖存completion前terminal後拼接回執」九個wrong variants驗證oracle能拒絕；產品及原始報告不改。所有新support、CP14、CP10全六配對及完整同來源回歸均為NOT_RUN。

#### Profile、來源凍結與回歸門檻

characterization只提高min_tests **13→14**（新增一個真原生CP14），原argv／env／tool probes／7200s／max_skipped0全不變；其餘49組、soak2700s、PHASE005合計50組不變。不得用after hook、support或新增setup子案例代替CP01–14；正式TC／UAT flags與trace關係不改，matrix應保持原bytes。

精確canonical patch只有design、manifest provided pin／planning版號、TASK041計劃、profile四檔。候選採用時凍結本增量不修改的產品StocktakeService／PostLookup unit及原44累積檔、22guards；helper內原request whole-body watchdog、透明transaction observer、CP13固定CPU component及所有非生命週期邏輯保持精確byte pins，若實作必須超出要先提出差異，不默默擴改。既有尚未實作的容量／soak任務依原批准範圍續行，不等同本增量可修改其他已凍結檔。

保存941份既有run refs、所有本輪native原報告／診斷路徑與hash。舊PLAN/source的green不能換hash沿用；新PLAN／最終來源全部50組、37原coverage floors及global92/83/90、真DB／HTTP／Playwright與實際CLI、lint／build／audit及五項當前CI重驗。CP10失敗或terminal不明仍阻擋後續正常負載；CP14成功不免除CP05三輪100k Post。

代價是startup一次metadata capture、觀測時追加engine-token讀取、registry歷史記憶體與CP14整表對帳／重驗時間；均需另記實際成本，不能以插桩觀察宣稱未插桩SLA。history僅保存在本次owner／report，結束釋放記憶體；不新增持久scheduler／跨worker清理器。未知時仍可能使整輪FAIL。寫入／資源數值gate、production空metadata／目標filesystem／shared ServerResponse warning仍阻擋TASK041／P4收尾。

本候選只在Sam實際審閱精確DESIGN／PLAN／patch後才可採用與TDD／隔離原生重驗；不代表未見實作批准或TASK041 DONE。APR291所有後續跨模型檢查統一略過，不再逐輪詢問；單模型獨立三輪上限與最終Sam來源審閱保留。不包含證據匯出、commit／push／PR／merge、CI豁免、P5、正式TC／UAT或部署。



### TASK041 第八增量 — HD207／APR-297 準備授權；HD208 精確 Post SQL／connection mapping 候選

PROPOSED_NOT_APPLIED。HD207的A只批准準備；本節、canonical patch、產品／helper／新測試均須Sam精確審閱採用後才可套用。現在沒有新負載，所有新增案例NOT_RUN。原始來源10bc1402…、950份formal run refs及實際8PASS／2FAIL／0skip保留，不把原先錯誤改成PASS。

#### 已觀察問題與最小選擇

完整容量下100k行Post的同一request `064a0c74-056e-4cce-85df-4093d0d240be`，HTTP500於20116.75ms完整回傳；主交易trace於20000.58ms報原DATABASE_TRANSACTION_TIMEOUT，累計233651個SQL呼叫／19443.99ms SQL wall。locked rows returned於1418.22ms／count123，first Reserved SQL call於8518.20ms／count100124，first mutation call於13054.05ms／count150130。這是透明test observer，不是DB逐句／JS profile，不能宣稱單一句為唯一根因。after hook因native connection18消失前沒有實測P_S歷史而UNKNOWN；兩child實際ack0／exit0和coordinator精確清理不代替SQL終止／rollback。

先只減少Post擁有的AVAILABLE及逐行副作用往返，新增Inventory內Audit批次入口；Item及每SKU兩次profile查詢保持原bytes／介面，避免同時擴大Item模組。100k profile queries與其他成本仍存在，不保證批次化足夠。沒有cache／新pool／async job／逐批commit／DDL／索引／部署DB設定或生產行數上限。唯一另列的session變體是DB08隔離測試連線的AUTO_INCREMENT step，測後還原，不套用app或full-capacity設定。

#### 精確九個可修改來源／測試路徑

1. `server/src/modules/inventory/InventoryStocktakeService.js`：只在Post路徑增加有界AVAILABLE及大量changed legs的batch；可新增Post-only private helpers，不改Create／Start／Count／Add／Ready／Cancel及其helpers。
2. `server/src/modules/inventory/InventoryAuditService.js`：新增`recordSucceededBatch(connection, inputs)`，共用原參數驗證／scalar serializer；原single success／rejection／failure入口的SQL、回傳、錯誤及獨立transaction行為保持。
3. 新`server/test/inventoryStocktakePostBatch.test.js`：16個PB單元。
4. 新`server/test/inventoryAuditBatch.test.js`：8個AB單元。
5. 新`server/test/inventoryStocktakeObservationMapping.test.js`：10個OM單元，直接測真正test-only acquire mapping實作而非複製函式。
6. 新`server/test/integration/inventoryStocktakePostBatch.integration.test.js`：18個DB案例。
7. `server/test/inventoryStocktakePostLookup.test.js`：只增量擴充同檔fake SQL oracle以理解新batch；原14個案例、全部assert／tripwire／duplicate／scope／expiry／溢位拒絕及mutation證據不刪不弱化，不改通用fakeInventoryDatabase／inventoryFixtures。
8. `server/test-support/inventoryStocktakePerformanceChild.js`：CP15、actual connection mapping／相應report及原生batch診斷；原透明transaction observer、whole-body request watchdog、CPU hold、5/5/5 stop元件維持原component pins。
9. `server/test/performance/inventoryStocktakeCharacterization.performance.test.js`：在CP14後、CP10及後續負載前新增CP15；所有原案例及缺少CP02／06–08／13的義務保持。

在HD205的46累積檔中只解除StocktakeService／PostLookup unit兩檔guard，其餘44檔保持byte-identical；22個source guards只解除AuditService一檔，其餘21檔保持，包括Item、LockService及18個Control/Lot單元。原Audit單元、safe serializer、Operation service、auth／DB／HTTP框架及配置不改。不因本次準備取得其他檔案實作權。

#### SQL與交易等價範圍

原claim／current auth／cached scalar replay、完整snapshot／scope身分、allocated逐Bucket底線及整張Reserved計算、Item／Lot／expiry檢查、原warehouse→Control→Bin→Lot→Balance鎖class、caller-owned單一交易及header／own lock完成順序保留。不平行發SQL、不新增transaction或部分commit，任何後批失敗整張回滾；原日期／guard.assertTime保留，batch建構逐行及每次await前後均檢查原時效，不重新計時。

changedSkus超過100時，依原數值排序／dedup切最多100個SKU的AVAILABLE locking read；仍同倉、`stock_status='AVAILABLE'`、LEFT JOIN Lot、原date projection及`ORDER BY warehouse_id,sku_id,bin_id,lot_scope,stock_status FOR SHARE`。將每個回傳row按SKU分組，原SKU順序／每組DB回傳順序逐列計算，範圍外Bin、重複回傳列及無合資格Lot／minimumSaleLife、safe integer、new AVAILABLE legs與Reserved比較不丟失。少於等於100個changedSkus保留原單SKU SQL。單批結果列可能多於100，不宣稱查詢結果或整個Post memory有固定上限。

changed legs超過100時才走Post批次副作用；少於等於100維持原逐行SQL路徑，零差異保持原無庫存／Movement路徑。此100是內部SQL策略門檻，不限制單據規模。每個chunk維持原line id順序、最多100個legs；每句最多3200個bind，string參數UTF8位元組總和最多1048576，超過前先縮小chunk，不用SQL字串插值資料。這不是wire packet／total RSS保證；單列若超過上限則原子失敗，不改max_allowed_packet或截短內容。批次不預先構建整張新增Audit／SQL字串，保留原legs／profiles與必要ID Map，額外參數buffer限當前chunk。

每個chunk依序：

1. 帳外新Balance用原完整維度／0數量／version1／NULL anchor／timestamps欄位multi-VALUES INSERT，不用IGNORE／REPLACE／ON DUPLICATE；同交易以最多100個完整`warehouse/bin/sku/lot_scope/status`鍵讀回真實ID。必須完整、唯一、owner／quantity0／allocated0／version1一致，缺失／重複即失敗；不推算AUTO_INCREMENT ID。其餘原snapshot行不改stock_balance_id。
2. 已持有Balance鎖，以parameterized CASE UPDATE／完整id+expectedVersion的OR predicates更新原on_hand／anchor／updated_at並version+1，逐行where含原版本；affectedRows必須等於該chunk數。每個target原本已通過snapshot／allocated，CAS不足整張失敗，不補寫／忽略。新Balance也按真實ID／version1更新。
3. 原Movement欄位multi-VALUES INSERT，原row順序及同movementGroupId／operationId／stocktake／line IDs；每個非零行仍一個Movement。用既有operation index按`operation_request_id=? AND id>? ORDER BY id LIMIT 101`讀回本chunk真實rows，起始watermark0、之後為上批已核對最大實際id。必須恰好本chunk數、lineId bijection、所有owner／group／bucket／quantity／before／after／version完全一致；不按返回位置或`insertId+n`連結，缺失／重複／foreign／額外行均FAIL，不讀MAX(id)推測。
4. 用真實Movement Map parameterized CASE UPDATE點算行，where含id／stocktake_id／原line version／movement_id IS NULL；version+1，affectedRows精確相等。每行仍只連自己的Movement。
5. 以原stocktake.post target／actor／request／correlation欄位及相同before／after scalar語義呼叫Audit batch。每個非零行一個SUCCEEDED Audit，最後header Audit仍原single入口；不合併成巢狀summary、不改whitelist／8192byte限制。

所有業務驗證先後階段及成功讀取後的first-business-error順序保留；大量路徑的SQL字串／次數及批內I/O故障先後不再承諾與逐行trace相同，整批CAS錯誤亦不能定位為某個SQL位置。新增Balance／Movement owner-map的missing／duplicate／foreign／額外行及批次CAS不足使用既有`CONCURRENT_OPERATION`，不新增公開錯誤碼；正常既有業務錯誤維持原碼／優先次序，driver／Audit serializer錯誤仍原樣傳出映射。全交易原子性不變；新增／回滾造成的AUTO_INCREMENT gaps、bulk timestamps的取樣時刻不當成連續ID／跨表全域寫入順序承諾。既有對外API／scalar receipt／replay不改；上述大量路徑與錯誤次序取捨須Sam在本精確候選處置。

#### Inventory Audit additive contract

`recordSucceededBatch(connection, inputs)`只接受原caller-owned executor及Array（0～100）：空陣列no-op／undefined；超長或非Array拒絕。每input沿原順序使用與single入口相同的action／actor／bounded strings／positive IDs及serializeInventorySummary，逐row捕捉原time.nowMs；先驗完本次inputs才發INSERT，單句rows／string byte budget同上，必要時序列切小批。所有執行均沿用connection，不begin／commit／rollback／補償／獨立失敗Audit；任何serializer／SQL／affectedRows不足錯誤傳出，caller負責整張rollback。輸出仍undefined，不回傳Audit ID／繞過scalar白名單。原recordSucceeded／recordRejected／recordFailed所有既有caller照舊使用single入口；只Post大量路徑採新入口。

只可把原#record的參數建構提取為同檔private單一來源，以免批次複製validation；原單列SQL literal及原validation次序保持，原錯誤／return／fallback不變。不得以新method不存在為由在產品做fake／環境偵測fallback；測試collaborators必須滿足明列contract。

#### 短命原生連線的取得前身分證據

原parent通知時刻不證明OS建立時間，且parent等到after hook再查已消失ID會正確UNKNOWN。本候選明確新增test-only的同一實體connection、第一次借出前mapping barrier；不是偷偷把舊UNKNOWN升級PASS。

只在child既有mysql.createPool返回的Promise pool之getConnection安裝私有wrapper，原getConnection只呼叫一次；以實際Promise connection的core connection物件為WeakMap key，不以數值ID／每次新wrapper判斷。首次實體connection在交給app以前，以它自己的固定SELECT讀`CONNECTION_ID()`與`performance_schema.threads`的唯一live PROCESSLIST_ID／THREAD_ID／INSTRUMENTED=YES（條件是同一CONNECTION_ID）。它不在business tx executor內、不建立新pool／monitor／連線或更改共享DB service；重借同core不重查，replacement不同core必重查。原health check也經此barrier。

wrapper在原getConnection呼叫前固定絕對5s截止；等待原pool、mapping SQL、IPC送出callback、parent matching ACK及所有post-settle cutoff核對共用其剩餘預算，不重開5s，不延長app acquire5s／transaction20s／HTTP30s。wrapper自身失敗或晚到只destroy這次實際借到的own connection並拒絕，不能送business SQL、回池或接受遲到成功。原getConnection晚到的connection亦須觀察並精確destroy；pending拒絕須被消耗，不引入unhandled rejection。若app request signal先中止，原acquire立即拒絕caller；其原pending-completion清理仍保留，mapping在原截止前正常完成的無交易connection由既有service release，mapping自身失敗則destroy，不擅改共享abort行為或宣稱已停止交易。此wrapper的5s只是原acquire上限的test-only封裝，不是額外可用時間。

先在原physical connection事件為該core保存一次UUID nonce並通知parent（native ID／incarnation／nonce），再透過已存在的有序private IPC送`connection-mapping`（strict keys、actualboot incarnation／同nonce／native ID／P_S ID／INSTRUMENTED、provenance SAME_CONNECTION_DRIVER_QUERY）。parent只接受已由實際fork／該worker physical event登記的ID與對應nonce；該訊息明確表示受信任child實際SQL結果，不接受API caller／任意JSON／aggregate0作證據。新的registry允許此精確來源或原owned monitor的live mapping；保留provenance／child觀測與parent接收時刻，碰撞／foreign／變更mapping仍UNKNOWN，不以driver threadId本身替代P_S。parent須實際驗證並保存entry後才回strict matching ACK（同incarnation／nonce／native／P_S ID）；child收到匹配ACK、並在固定原截止內，才可loan connection。IPC送出callback本身不是ACK或socket close證明；ACK亦不代表SQL／socket已關閉，after hook仍以目前實際SQL完成歷史對賬。ACK/NACK只傳固定身分欄位，沒有額外metadata SQL、caller命令或新等待窗口。

任何mapping query／IPC／ACK錯誤或deadline失敗，child私有wrapper設永久failure latch，拒絕該worker後續所有新pool loans（含已知core），並best-effort透過原IPC回報固定failure；parent收到即quarantine。即使failure通知無法送達，child也不能再送新的business工作；parent仍以原request/watchdog／stop收斂，不假定failure event可靠送達。既有已執行交易不因此假稱中止，仍須獨立SQL terminal；不更改原stop元件或允許正常負載強制退出算PASS。OM04／06涵蓋lost／wrong／late ACK與failure通知遺失、latch零後續loan／dispatch；原10個OM門檻不減，也不把timer觸發當實際socket關閉。

新增固定CP15：依HD217，原full-capacity schema上接續CP14的同一OBSERVATION_ONLY pool1 owner（不是原capacity worker1），先正面捕捉並destroy其目前own pool connection，再經原pool取得一條真正新連線，通過上述mapping barrier後立即destroy，故意讓parent後續live查詢看到無mapping；必須已保留那條new native/P_S正面歷史、實際socket終止、當前session／statement／InnoDB／locks／waits為零，callback／command回執完整；不能只看destroy呼叫。原worker0仍能真授權GET、16表完整rowhash不變，後續OBSERVATION_ONLY真GET replacement亦須新mapping；正常關閉／retired對帳及原兩capacity workers恢復依第十二增量全部滿足。使用strict固定test-only IPC、UUID／incarnation／nonce，無raw SQL／PID／任意duration入口、無新產品endpoint。CP15在CP14後、CP10及後續負載前，失敗即quarantine／前置FAIL，不能繼續後續probe／workload或用skip隱藏。保留正常ack0／exit0、全部歷史connections的真正terminal；沒有新增CP13以外forced-stop例外。

所有每connection新增SQL／byte／IPC／acquire成本與不成功分母進入diagnostic report；CP14／15及全容量數字明示這個test-only instrumentation，原SQL observer計數不含取得連線前metadata，不把它當無instrumentation生產SLA。profile／command原參數不改，constructor alias／guard ignore等繞過禁止。

#### 新DEVELOPER案例，全部NOT_RUN／零skip

| IDs／數目 | 最低必要行為與證據 |
| --- | --- |
| PB01–04／4 | 100與101門檻、201跨三批、混合既有／帳外Balance及NULL-Lot三狀態、真實非連續／反序ID mapping；完整scalar結果與原replay |
| PB05–08／4 | snapshot／Scope配對／duplicate／first-error、每Bucket allocated、同SKU最終Reserved／過期及範圍外AVAILABLE重複safe sums；保留原14 getter guards |
| PB09–12／4 | 後批Balance CAS不足、Movement缺失／duplicate／foreign、line CAS不足、後批Audit故障，整張rollback；無自動retry／partial commit |
| PB13–16／4 | 撤權／device／time／date邊界與replay、全零大型、SQL每批100／string1MiB／bind有界、N=101／1001 query計數及逐行mutation反轉被oracle捕獲 |
| AB01–08／8 | 空／一／100／超長／非Array、原single參數與錯誤次序等價、巢狀／未知field／8192限制、UTF8切批、後批SQL與affectedRows不足傳出、同executor無獨立transaction及原rejection／failure fallback不變 |
| OM01–10／10 | 實際core重借一次／replacement重查、pool等待佔同5s、mapping SQL timeout、IPC失敗／逾期settle、晚到raw connection回收、錯incarnation／nonce／foreign mapping拒絕、先physical事件後mapping、已消失但有真history可核對／無history仍UNKNOWN、不得從缺值補0／不得延期限 |

PB／AB trusted executor與sealed proof單元不冒充真HTTP／MySQL。OM使用真正helper函式＋受控driver邊界，延遲／故障明示為注入，不當作OS拒絕signal／真socket證據。舊14 PU不刪assert；新增至少6個targeted wrong variants：推算insertId、按返回位置連Movement、批次CAS忽略不足、漏Audit／serializer、AVAILABLE去重、mapping只信nativeID，須被新增斷言捕獲，還原產品hash。

DB01–18專用真MySQL26.7的18個獨立named cases：

| ID | 原生預期／關鍵證據 |
| --- | --- |
| DB01 | 100行原單列路徑，100 Movement／100逐行Audit＋1header Audit，完成／精確解鎖 |
| DB02 | 101行跨兩批，所有CAS／Movement／line／Audit一一對應 |
| DB03 | 201行跨三批，後批完整、SQL每批上限及無部分commit |
| DB04 | 帳外Balance／NULL-Lot／三Status及FIFO anchor，原snapshot FK不被擅改 |
| DB05 | 既有合法過期／低效期盤盈及AVAILABLE資格／sale-life排除維持原政策 |
| DB06 | 範圍外AVAILABLE納入／同SKU盤盈抵銷最終Reserved，不能跨SKU補覆蓋 |
| DB07 | 另一Bucket盤盈不能補allocated缺口，完整rollback／原錯誤 |
| DB08 | non-default AUTO_INCREMENT increment下真實非連續Movement／新Balance ID，正確owner+line mapping；只改該隔離test session，不改global／appDB配置，精確還原 |
| DB09 | 第二批Balance CAS不足注入，所有早批副作用rollback |
| DB10 | 第二批Movement後注入故障或讀回missing／foreign，完整rollback而非猜ID |
| DB11 | 第二批line CAS不足注入，Movement／Balance／line／Audit無部分留存 |
| DB12 | 第二批Audit SQL故障注入，包含先前Audit全部rollback |
| DB13 | 最後header更新故障注入，全部資料保持READY及原locks |
| DB14 | own解鎖中途故障注入，包含header／所有鎖釋放完整rollback／foreign locks不變 |
| DB15 | 真資料角色／JWT version／device撤權後current check與cached replay拒絕，無額外成功效果 |
| DB16 | 時效／日期改變原拒絕及rollback，注入clock明示，不冒充OS真time故障 |
| DB17 | 同intent原scalar replay，Movement／Audit／Balance versions不重複 |
| DB18 | 大型全零強認證完成且無庫存／Movement改動，UTF8／summary邊界及Audit限額不截短 |

oracle比對所有相關Balance／Movement／line／Operation／Audit／own locks及非目標owner不變。注入故障明示，任何before/after reconciliation必須在真正callback及SQL terminal後；共用DB deadline失敗不假稱rollback。專用DB以隔離fresh schema／既有migrations及合成資料驗證，**不替代**原full-capacity CP05三輪或HTTP認證；既有真API／browser／capacity全部保留。

CP15在原full-capacity schema實際驗證上述短命連線；CP05仍200Bins／100k行各三輪完整真HTTP／相同fixture／原20sTX／30sHTTP，compare原固定來源的實際500及新結果／SQL calls／CPU階段，不跑舊來源長失敗作無用重複。只接受完成全部工作且安全門檻通過的改善；沒有改善／仍timeout保留FAIL，未經Sam新方向不得繼續擴改Item或期限。診斷instrumentation overhead明示，不用純querycount取代wall time／資料效果。

#### 精確命令與Profile／trace增量

1. 新`inventory-task041-post-batch-unit`：`node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/inventory-task041-post-batch-unit.xml server/test/inventoryStocktakePostBatch.test.js server/test/inventoryAuditBatch.test.js server/test/inventoryStocktakeObservationMapping.test.js`；UNIT／DEVELOPER／JUNIT／min34／maxSkipped0／timeout300s／FILES，沿用原PostLookup unit tool probes／無新env。
2. 新`inventory-task041-post-batch-database`：`node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/inventory-task041-post-batch-database.xml server/test/integration/inventoryStocktakePostBatch.integration.test.js`；INTEGRATION／DEVELOPER／JUNIT／min18／maxSkipped0／timeout600s／FILES+ISOLATED_DATA。沿用既有TASK038 database的env形狀／空redaction／Node26與MySQL26.7 probes；精確env allowlist為`DB_NAME, DB_SOCKET, DB_INTEGRATION_TESTS, INVENTORY_STOCKTAKE_POST_BATCH_TESTS`，執行guard兩flag為1（不是產品開關）；run前仍須實際隔離owner／fresh schema及精確清理。
3. 原characterization只提高min14→15，argv／env／7200s／zero-skip不變；CP15不能替代缺少的CP02／06–08／13，原resource-soak2700s及1case不變。

PHASE005 developer_suites由50 append至52；其餘50組、coverage37 floors／global92/83/90、真DB／HTTP／Playwright＋命名CLI、lint／build／audit、五項當前CI與正式TC/UAT不變。trace registry／relations／test applicability不改，只append兩個developer suite，matrix由ledger重算若相同維持bytes。精確canonical patch五檔：design、manifest provided pin／planning版號、TASK041計劃、profile、trace phase suite清單。

新增／修訂後全部必需開發檢查在新PLAN／最終source重跑；950原run refs保留，不換hash重用。舊失敗、不完整CP05／unknown afterhook及原metadata-cache診斷均保留原路徑／hash。實作後仍須Sam精確來源審閱；數值gate／重驗、production empty metadata／target filesystem與shared warning仍阻擋TASK041／P4，Opening真writer留P5。本候選不含未見來源批准／DONE／證據匯出／commit／push／PR／merge／CI豁免／正式TC-UAT或部署。

#### 來源依據與未執行事項

原生證據見`implementation/task041-hd206-native-final-observation.json`與`evidence/task041-native-characterization-90a995936310/`原報告。來源直接核對Post、Audit及唯讀Item profile；沒有圖譜可重用，未因本候選安裝／重建全庫graphify，改用精確來源與caller搜尋。

MySQL官方[INSERT](https://dev.mysql.com/doc/refman/8.4/en/insert.html)／[UPDATE](https://dev.mysql.com/doc/refman/8.4/en/update.html)語法作SQL形狀依據；[Information Functions](https://dev.mysql.com/doc/refman/8.4/en/information-functions.html)明示multi-row LAST_INSERT_ID只提供第一個生成值，因此候選另讀真實ID而不推算。這些8.4文件不是本機26.7實測，原生相容性仍NOT_RUN。mysql2官方[pool介面](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-pool)與本機已安裝`lib/promise/pool.js`／`connection.js`確認借出wrapper與core物件的關係；對內部core身分的測試依賴有版本耦合，OM單元與CP15須實際驗證，失配fail closed而不改依賴版本。現在只有候選結構／trace／hash／patch核對，不宣稱SQL／batch／socket／容量已PASS。



### TASK041 第九增量 — HD207／APR-297 準備授權；HD209 精確交易綁定 Item profile 批次消費候選

PROPOSED_NOT_APPLIED。HD208 已採用，但本候選尚未採用；不改來源／canonical、不執行新負載，新增檢查全部 NOT_RUN。沿用 APR-291，全部後續跨模型略過，不再詢問；實際本機驗證、受限單模型審查及 Sam 最終精確來源審閱仍必需。

#### 原生失敗與決策邊界

固定來源 `ba44ec2ef4f5743eecfad18f794708c430fc719dfdc1d19023596c9ab0c4d3c8` 的真 MySQL26.7／原全容量 targeted diagnosis，CP01／09／14／15／10／11／12 通過，1Bin／500行及10Bins／5000行各三輪完整流程通過。200Bins／100000行的第一輪 Post 仍 FAIL，後兩輪 NOT_RUN。相同 request `e89b24a0-18e9-4511-8119-150fc1a175c6` 在 20104.52ms 完整回 HTTP500；主交易 20000.325ms 報 DATABASE_TRANSACTION_TIMEOUT，104166 SQL calls／19223.393ms cumulative SQL wall。locked rows read 1569.566ms／123 calls，firstReservedSql 9090.399ms／100124 calls，firstMutation 9717.105ms／100630 calls。這是透明 test observer，不是逐函式 CPU profile；不能斷言 profile 查詢是唯一瓶頸，後續 mutation 也消耗約10秒而未完成。

失敗後完整16表診斷只有 Audit 多一筆 FAILED，其餘 Balance／Movement／header／lines／locks 等雜湊未變；這是資料核對，不單獨冒稱 callback rollback 證明。正常 business cleanup、全部 child exit 及歷史 SQL terminal 本次均 CONFIRMED，coordinator 精確隔離 schema／daemon／group／目錄／port 清理完成且無 cleanup errors。原失敗、952份 formal run refs、CP15 supporting proof 均保留；這不是完整15case characterization、52組、soak、數值 gate 或 P4完成。

只減少 Post 每 SKU 的兩次 profile SQL 往返，不改 Item 來源或合約、不另建 Item API。現有 `ItemLookupService.findManyByIds(ids,{purpose:"inventory"})` 及其 SKU／UOM projection 已是 Items §8.3 的公開唯讀下游入口。它本身沒有100個上限，所以由 Inventory 呼叫端固定最多100個 unique SKU 一批，序列 await，不平行、不新增 connection／pool／transaction／cache／DDL／設定／依賴／業務行數上限。100是內部策略門檻，不是單據上限。

#### 精確五個新實作／測試路徑

1. `server/src/modules/inventory/InventoryStocktakeService.js`：只改 Post profile 讀取及其專用 pure projection helper；constructor 增加 optional `inventoryProfileLookupFactory` 依賴。helper以同檔 named export `toStocktakeInventoryProfile(projection)` 供實際Post及單元直接使用，只是Inventory模組內函式，不是HTTP／service contract或新的Item入口。Create／Start／Count／Add／Ready／Cancel、原 lookup／batch／lock／Audit 其他邏輯不改。
2. `server/test/inventoryStocktakePostBatch.test.js`：只調整 fake collaborator／constructor fixture，使大量 SKU 路徑明確注入 factory；原16個 PB 案例、assertions、wrong-variant oracle 及各 SQL／rollback 上限不刪不弱化。
3. `server/test/inventoryStocktakePostLookup.test.js`：同樣只改 fixture dependency helper；原14個 PU case bodies、accessor tripwires、成本域／預算及三個 mutation 拒絕斷言保持原 bytes，不改共用 fake database。
4. 新 `server/test/inventoryStocktakeProfileBatch.test.js`：14個獨立 named 單元，對實際 StocktakeService 與真 ItemLookupService 的 SQL executor 邊界驗證，不能只測複製 adapter。
5. 新 `server/test/integration/inventoryStocktakeProfileBatch.integration.test.js`：16個真 MySQL26.7／真 caller-owned transaction 專用案例，無跳過。

既有 helper／characterization／soak 路徑仍依 HD180／197／205／208 累積批准範圍繼續，不因本候選重寫四個 frozen components。CP02／06–08／13 與 CS01 的私有 draft 尚未套用、部分有待核對 findings，全部 NOT_RUN，不能當成已完成。保留現有44個 accumulated guards（其中 PostLookup fixture 的已批准例外延續）、21個 source guards、原 Audit single test 與四個 component pins。此次另外固定已完成 HD208 的 AuditService／AB8／OM10／PostBatch DB18 bytes；PostBatch／PostLookup 僅明列 fixture 例外。ItemLookupService、Item migrations／tests／設計文件、Item consumed SHA256、所有非 Post writers 不改。

#### 交易、projection 與錯誤順序的精確合約

Post 原先對全部盤點行取 unique SKU 並數值排序。`uniqueSkuCount <= 100`（包括0、1、100及大型但只100SKU）保留原單筆 `getInventoryProfileInTransaction` 迴圈、原 SQL／參數／授權與驗證順序；不呼叫 factory。`uniqueSkuCount > 100` 才採下面增量，包含全零 variance 的大型單據：

1. 在既有 lock/header/snapshot 檢查之後、原 profile 階段建立一次 tx-local `shareExecutor = {query:(sql,params)=>tx.query(sql+" FOR SHARE",params)}`。optional `inventoryProfileLookupFactory` 的精確同步合約是 `(shareExecutor) => lookup`，lookup 提供 `findManyByIds`；僅呼叫一次。預設由 StocktakeService 直接建立 `new ItemLookupService({database:shareExecutor,logger:this.logger,time:this.time})`。這是業務服務依賴，不是新 DB service／container。既有 `itemLookup` 只供原單筆路徑，不以有無方法、環境、fake 偵測或失敗 fallback 決定策略；測試須明確注入完整新 collaborator，不能產品假成功。
2. 依原 sorted unique IDs 分批最多100，對同一 lookup 呼叫 `findManyByIds(chunk,{purpose:"inventory"})`。真入口的 SKU/Item join 及 UOM join 兩句均透過同一 shareExecutor，所以都是原 tx 的 locking current reads；不呼叫主要 this.database.query／getConnection／withTransaction，不讀 transaction 外快照。每批讀完立刻依 chunk 的原 SKU 順序逐個投影與業務驗證，然後才讀下一批，不先讀完整50k SKU。任何 missing SKU 使用既有 INVENTORY_RESOURCE_NOT_FOUND；不以缺值補 profile。
3. 同檔 pure `toStocktakeInventoryProfile(projection)` 只從既有 generic projection 取原 getInventoryProfileInTransaction 的13個top-level欄位：skuId／skuCode／skuName／skuStatus／itemStatus／inventoryTracked／trackingPolicy／shelfLifeDays／minimumReceiptLifeDays／minimumSaleLifeDays／baseUom／usable／reasons（baseUom 含2 keys），不得加入 extra Item／UOM 欄位至 profiles 或回應。Base UOM 保留原 `.find(isBase)` 與 `toBaseFactor === 1` 規則；missing／invalid factor 使用既有 Item `uomConversionInvalid` 和原訊息，不新增多個Base／inactiveUom／integer factor政策。正常資料 base_slot unique 已由既有0016約束；不得假稱任意壞資料列順序也等價。Post必須呼叫此同一函式並只把其結果放進原profiles Map，不把generic object／Map跨批保存。直接import此實際函式可驗13-key深比較；Post呼叫及Map保留邊界另作精確來源審查，不把不可觀測的memory retention宣稱為動態測試證據。之後按原 `inventoryTracked → serial → usable/baseUom` 順序驗證，再存入原 profiles Map。不複製或另寫 Item eligibility／日期規則；沿用 purpose inventory，不借 Sales eligibility。
4. 保留原第一個 business error：成功取得一批 SQL 的情況下，先處理較小 SKU 的 Base UOM／Inventory 錯誤，不讓後面 SKU 的缺失／serial／inactive 蓋過它；跨批也是前批先驗證。批內 SKU/UOM SQL 可能先遭遇較後列的 driver/I/O error，且兩句 bulk SQL 的 row-lock interleaving 不同，這些**不承諾**與舊每SKU SQL trace／I/O錯誤先後相同。沒有自動 retry 或 partial commit；錯誤仍走原 mapping／整張 rollback。
5. 庫存全局 lock classes 及原 auth／sealed proof／replay／期限／snapshot／allocated／Reserved／Movement／逐行 scalar Audit／own-lock 完成順序保持。但 Item row locks 從 SKU1+UOM1／SKU2+UOM2 改成 chunk SKU/Item rows 後 chunk UOM rows，未新增 ORDER BY 並不承諾 MySQL 實體取得列鎖順序、完全相同 lock footprint 或無 deadlock；等待／deadlock按原期限及錯誤映射失敗，完整 rollback。必須以實際鎖等待、current read及 Item 更新競爭驗證，不用 SQL字串後綴單獨宣稱安全。
6. profiles Map仍 O(unique SKUs)，generic多餘 projection／uoms 只保留當前chunk，處理完釋放；額外buffer以chunk為單位，但單SKU的UOM列數沒有新業務上限，不能宣稱硬memory上限。沿用原 clock/time.nowMs 調用，Inventory eligibility不消耗effective window，不私自固定新日期語義。**原profile迴圈沒有guard.assertTime；不得在每批前後或逐SKU新增它。**原後續guard位置及SQL10s／TX20s／HTTP30s／CSV120s照舊，不重新計時。若成功SQL等待期間proof到期且先SKU有invalid Base，維持原UOM錯誤先於後續auth檢查；若profiles合法則在原後續位置拒絕過期proof。

50k unique SKU 的 profile 查詢預期由100000句變最多1000句（每批2句；missing時UOM句可能no-op），不是整個 Post SQL 上限或完成時間保證。generic Map row order與缺失不決定業務驗證順序；chunks只按原 SKU排序，原重複行／NULL-Lot／各Status／outside AVAILABLE與safe-integer語義保留。沒有改動或複製 Item SQL／private methods，消費契約 pin 保持原 `30d6807978b27252fde194cc821c8fef5de000f27fa7eed404ed204abab2764a`。

#### 新單元 PBU01–14，全部 NOT_RUN／零skip

| ID | 必需 oracle／證據 |
| --- | --- |
| PBU01 | 0／1／100 unique 保留原單筆SQL；101才factory/bulk；100k行100SKU仍單筆策略，factory零呼叫 |
| PBU02 | 101／201／1001 IDs排序dedup、chunk≤100、factory一次、每批兩句及全部同一tx executor，原主DB query/getConnection呼叫即失敗 |
| PBU03 | 真Item入口的generic projection→直接import實際toStocktakeInventoryProfile函式與原單筆13-key profile深比較，含BaseUom、NULL／number／bool／reasons及none/batch/batch_expiry，禁止Sales規則或多餘欄位；Post wiring另來源審查 |
| PBU04 | chunk返回Map反序／missingSKU仍原排序首個錯誤；missing不補預設 |
| PBU05 | 先SKU invalidBase與後SKU missing/serial，必須原UOM錯誤優先；跨100/101邊界同理 |
| PBU06 | inventoryTracked=false／serial／unusable 三種原錯誤優先序與原碼，inactive/archived／effective dates保持Item目的語義 |
| PBU07 | 無Base／factor非1原uomConversionInvalid碼與訊息；不新增nonbase factor或inactive UOM政策，第一Base語義對受控projection不重排序 |
| PBU08 | 混合existing/new、NULL-Lot／三Status、allocated底線與整張Reserved／低sale-life／outsideBin重複safe sums，完整原receipt及逐行效果 |
| PBU09 | 第2批SKU SQL拒絕、不再讀第3批；原錯誤傳出，tx原子，不降回單筆／主要DB |
| PBU10 | 第2批UOM SQL拒絕、clock在batch等待後過期：合法profiles在原後續guard拒絕；先SKU invalidBase則仍先UOM錯誤，不能在batch新增guard改優先序；沒有獨立transaction/commit |
| PBU11 | 後續Balance／Movement／Audit或header故障仍rollback，重用原PB oracle，不用querycount假稱原子性 |
| PBU12 | 全零large仍驗全部profiles與強認證、零庫存／Movement副作用；replay不重讀profiles或重寫效果，current-auth gate不繞過 |
| PBU13 | 真StocktakeService+真ItemLookup 的101/1001查詢成本為2*ceil(unique/100)，不得以複製helper或fake factory代替此成本證據；舊PU accessor預算不降低 |
| PBU14 | 直接import實際pure函式驗exactprofile keys／不帶extra UOM或Item欄位；Post只保留其結果／generic Map不跨批是明示來源審查項，不宣稱動態GC/retention證據。SQL error、wrongpurpose、反序驗證及漏FOR SHARE mutations可區分，不把heap估算當容量gate |

至少四個 targeted wrong variants 必須由新增斷言拒絕：第二UOM查詢走主要DB；去掉任一句FOR SHARE；依返回Map順序驗證或先全量讀再驗；將缺少BaseUom/factor非1當成usable。每次精確還原產品hash；真Lock mutation另由DB鎖等待案例捕獲，不能只依字串檢查。

#### 真 MySQL PBD01–16，全部 NOT_RUN／零skip

每個named case使用既有隔離migration與合成資料；真正getInventoryProfileInTransaction對照與bulk都在明確caller-owned transaction。query wrapper只收集實際SQL/connectionID／注入明示故障，不替代SQL執行。對照不得只比自己複製的projection。

| ID | 必需原生證據 |
| --- | --- |
| PBD01 | 100SKU原單筆路徑／101SKU真bulk Post，完整Balance／line／Movement／Operation／Audit／header／own-lock結果 |
| PBD02 | 201SKU三批／1001SKU十一批、排序dedup及實際querycount/bind≤100；同tx native connection ID |
| PBD03 | 同一真資料none/batch/batch_expiry與多UOM的真bulk結果經實際pure函式／原單筆13-key深比較；Base factor1、NULL期限值；另真Post效果驗wiring，不能只以純函式當工作流已驗證 |
| PBD04 | active/inactive/discontinued/archived與tracked/serial有效組合，用真Item原方法作oracle，原錯誤碼／優先序 |
| PBD05 | missing Base／invalid Base factor真資料，前SKU錯誤不被後SKU缺失或serial蓋過；資料異常fixture明示 |
| PBD06 | missingSKU在第一／第二批，原INVENTORY_RESOURCE_NOT_FOUND與之前批所有庫存無副作用；query順序證據 |
| PBD07 | blocker持有SKU更新，Post實際等待；blocking transaction提交停用後，bulk current-read取得新值並拒絕；不能只有promise未完成 |
| PBD08 | blocker持有Item row更新，實際等待後讀archived新值拒絕；原locks完整保留且無庫存副作用 |
| PBD09 | blocker持有UOM mapping更新（factor或Base移除），實際等待後拒絕；確實走第二句share read |
| PBD10 | UOM master更新競爭及一個已取得share-lock的batch阻擋writer，直到Post transaction結束才解阻；保留原inactiveUOM政策，不把UOM停用當新拒絕 |
| PBD11 | 第2批SKU/UOM SQL故障注入，分別確認實際transaction outcome／terminal及完整rowhash／Operation/Audit原有失敗政策，無部分commit |
| PBD12 | 等待期間真角色／JWT/device撤權或proof到期後原current checks拒絕；cached replay仍重查auth，不等於新HTTP認證證據 |
| PBD13 | allocated Bucket缺口及跨Bin整張Reserved覆蓋、低sale-life資格保持原碼與rollback，不用其他SKU補缺 |
| PBD14 | 101+ unique全零差異仍驗profiles／強認證／完成解鎖，無Balance/Movement寫入；原scalar replay無新增效果 |
| PBD15 | 後批Movement/Audit／最後header或own-unlock明示故障，早批全部rollback，foreign owner／未選Bin不變 |
| PBD16 | 真concurrent Item edit/Post交錯壓力（有界且原期限），成功只接受完整單一結果；deadlock/timeout拒絕保留原映射、terminal及完整資料核對，不能把競爭失敗算成功容量 |

鎖等待必須有真P_S/connection/wait證據、同request/transaction關聯、release後current read及terminal，不以sleep／innodb_trx=0單獨替代；missing instrumentation fail closed，不改DB設定。故障／clock cases明示注入，不冒充真HTTP密碼／簽章。舊Item tests、原Inventory219及035–040真DB/API/browser+CLI均保留；本段不改Item安全與權限責任。

#### 精確 Profile／trace／最終回歸

新增 `inventory-task041-profile-batch-unit`：`node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/inventory-task041-profile-batch-unit.xml server/test/inventoryStocktakeProfileBatch.test.js`；UNIT/DEVELOPER/JUNIT/min14/maxSkipped0/timeout300s/FILES，沿用已批准PostBatch unit的tool probes/既有env。

新增 `inventory-task041-profile-batch-database`：`node --test --test-concurrency=1 --import ./server/test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/inventory-task041-profile-batch-database.xml server/test/integration/inventoryStocktakeProfileBatch.integration.test.js`；INTEGRATION/DEVELOPER/JUNIT/min16/maxSkipped0/timeout600s/FILES+ISOLATED_DATA；沿用既有PostBatch database工具、runtime/最小env形狀，allowlist精確為DB_NAME/DB_SOCKET/DB_INTEGRATION_TESTS/INVENTORY_STOCKTAKE_PROFILE_BATCH_TESTS。其他env/redaction/permissions不改。

PHASE005原52組追加兩組成54；舊suite命令／env／min／maxSkip／timeout均byte-identical，characterization仍min15、原CP01–15及CS01全部義務不變。只追加phase developer_suites，不改正式TC/UAT flags/relations，generated matrix應維持原bytes。37 floors及global92/83/90、五項CI與正式驗收要求不降；新PLAN／最終來源所有54組重新實際執行，歷史green不換hash沿用。

CP05必須原5倉／1000Bins／100kSKU／500kBuckets／2M Movements、200Bins／100k行各三輪完整真HTTP，1/10Bin流程、15真Reservation、20users、固定30分鐘soak、所有queryp95<2s／offer/503/timeout分母不縮減；原10sSQL20sTX30sHTTP120sCSV與coordinator7200/2700上限保持。新profile SQL count、firstReserved／firstMutation時間及transaction/processCPU只作MEASURED，比同request原始失敗，不能用減少querycount代替完成時間及全資料效果。全局writer/restart、CSV匿名disk／production空metadata、target filesystem與shared warning風險／數值gate仍須完成；修正後若100k仍失敗，保留FAIL，按已批准範圍診斷，不擴改其他產品或放寬期限。

#### 人工採用與限制

本精確候選將修改五個canonical檔（design、manifest衍生provided pin、TASK041增量、profile兩suite及trace phase清單）；不是現在套用。Item原檔／Item文件與consumed pin不改；Inventory provided version只標明新候選策略，sha綁定新design。Sam精確採用後才TDD／隔離本機重驗；完成仍需Sam獨立source review，不等同TASK041／P4完成、數值gate、生產SLA或部署相容性。

選A表示實際審閱滿意後批准精確DESIGN／PLAN、上述五路徑／兩fixture例外及chunk鎖／SQL錯誤次序取捨；選B提出修訂且不採用。未回答預設canonical／產品不變、不跑新負載。不是未見實作批准、evidence export、commit/push/PR/merge、CI豁免、P5、正式TC/UAT或部署；跨模型依APR291全部略過。



### TASK041 第十增量 — HD212／APR-306 準備方向；HD213 分層 Export Audit 精確驗證候選

狀態：PROPOSED_NOT_APPLIED。HD212 A 只批准準備；以下 canonical 修訂、測試 oracle 與來源範圍仍須 Sam 審閱精確 DESIGN／PLAN 後才採用。不是修正產品 Audit、重寫舊失敗或宣告 CP07 通過。

#### 原生反例與決策

`evidence/task041-cp07-native-support-91f990c7ed32/` 保留 CP07 FAIL。同一實際 busy503 request `653c894b-51a8-4926-b5a9-63d4c67558c9` 有兩列 FAILED：819118 的 target_id=1、target_label=stocktake:1，來自 ExportService 的 failurePromise；819119 的 target_id=NULL、target_label=/api/v1/inventory/stocktakes/:id/export，來自既有 dispatcher 呼叫 handler.auditFailure。兩列 actor／request／correlation 相同，但歸屬不同。原測試跨歸屬假設每種 outcome 唯一而失敗；不能把兩列計為兩次 HTTP 失敗，也不能把其中一列丟棄以湊數。

HD211 的 pool10／pool1 真 CSV、原 1Hz／95%／5秒 gap、所有 CSV 欄位／ID digest、own FileHandle／socket close 及 SQL terminal 已通過原生支持性驗證；這些不把原 CP07 FAIL 變成 PASS，也不是當前新 PLAN／最終來源 54 組已通過。所有原失敗／原始 reports 保持原路徑／hash。

#### 固定的正常容量場景 oracle

採用後只修正驗證契約，不改任何 Audit writer。CP07 的兩份 COMPLETE CSV，各要求恰好一列 DOMAIN／SUCCEEDED、零 ROUTE Audit；有有效 actor 且經 ACTIVE_GENERATIONS 真 busy barrier 證明的那次 503，要求恰好一列 DOMAIN／FAILED 加一列 ROUTE／FAILED，不能套用到未認證、guard 前失敗或所有任意 503。

DOMAIN 身分固定為 action=inventory.export、target_type=stocktake、target_id=本次 stocktakeId、target_label=stocktake:<id>；ROUTE 身分固定為相同 action/type、target_id 必須嚴格 NULL、target_label 必須精確為路由模板 /api/v1/inventory/stocktakes/:id/export。不得以 label 前綴、Number(NULL)、未知 target 或只按 outcome／總列數分組。列集必須和事先定義的預期 descriptor multiset 完全相同，同歸屬／同 outcome 不得重複，也不得接受未預期 outcome、其他歸屬或多餘列；不依 AUTO_INCREMENT 的連續性或跨層 INSERT 先後判定。

每列核對唯一正 Audit ID、actor_user_id、正確的既有 actor_label（DOMAIN 為 fixture 的真 username；ROUTE 為 user:<actorId>）、action/type/target、outcome、request_id、correlation_id、operation_request_id、before_summary、after_summary 與既有 reason 欄位。兩筆 BUSY FAILED 的 reason_category／reason_text 均為空字串；DOMAIN SUCCEEDED 的 reason_category 必須為 EXPORT，reason_text 精確為 `filterHash=<hash>;truncated=true;reason=ROW_LIMIT;budgetMs=<budget>`。hash 由已知 stocktakeId 及本次原始 request 經既有規則正規化／排序的 filters，在測試獨立計算 SHA256(JSON.stringify({stocktakeId,filters}))；本 CP07 無 query，filters 固定為 {}。同一 hash 也須匹配 CSV SUMMARY。budget 取自已驗證的 CSV SUMMARY 與 HTTP header 相等值，仍需正安全整數且 >0、<=60000；不得從 Audit reason_text 反推 hash／budget 當預期，也不改原生成期限。

DOMAIN 成功 after_summary 必須精確為已知 COUNTING 的 stocktakeId／rowCount=100000／workflow version／status，before_summary 與 operation_request_id 是 NULL；失敗及 ROUTE 的 after_summary、before_summary、operation_request_id 都是 NULL。request/correlation 必須等於本次 client 指定且 server echo 已核對的 request ID；預期 actor／stocktake／版本／summary 從發送前的已確認 fixture/HTTP 狀態固定，不能由待驗 Audit 回填成預期。摘要按原 scalar JSON 契約解析比較，不改 serializer 或儲存格式。errorCode 目前不是此表的獨立持久欄位，不得偽稱從 reason_category 讀到 INVENTORY_DEPENDENCY_UNAVAILABLE；busy 的錯誤碼仍從真 HTTP body 驗證。

上述精確基數只對這三個正常、健康 Audit DB 的已定義 CP07 dispatch 成立。其他 stream 中途撤權／timeout／abort、Audit DB 失敗或未知提交，不得依 HTTP status 猜成功列數、無條件要求兩筆失敗、或承諾 exactly-once；沿用既有專用 fault/recovery 檢查與 FAILED Audit 持久化限制，不在本候選新增或重定那些場景。若後續容量／soak 引入其他 export outcome，先依已批准場景和實際生命周期定義 descriptor，再執行，不能把未知 outcome 當空集合或寬鬆 <=N 通過。

#### CP08 全庫對帳與紀錄歸屬

exportAuditRequests 以所有實際 dispatch 前註冊的 request ID 保存預期 actor／stocktake／phase／允許的 DOMAIN、ROUTE descriptor；NOT_SENT 仍在 offer 分母，不可捏造 Audit。native readback 的實際 Audit IDs 與列內容另存 observation，不能取代預期。每個實際 export 都須出現在 request ledger，缺 request、未送卻有列、未註冊 request、重用 request ID 或同歸屬重複均失敗。

CP08 在舊完整 business cleanup／基線對帳義務上，必須把 DOMAIN 和 ROUTE 都納入全庫 Audit 增量／內容核對，以已驗且互斥的 Audit ID 集合核算 union；不得只查 target_id=stocktakeId、過濾 NULL target、以 DISTINCT outcome 去重、容許任意增量列數或僅比總數。對帳以 native SQL 讀到的整體 Audit 差異對照事前命令／request intent 及精確 descriptor，和預期相符才標 verified；現場出現其他 action／target／request 的增量必須分類且核對，不能整體排除。基線 500000 Audit 的原內容 hash／既有命令行 Audit／Operation／Movement 與未觸及資料保護不減。新結果只代表該來源／PLAN，原 CP07 FAIL 不換標。

#### 精確實作範圍與不可變項

只使用兩個已批准的 performance 路徑：

1. `server/test-support/inventoryStocktakePerformanceChild.js`：CP07 的原生 Audit readback／嚴格 descriptor 比對、發送前 request ledger 與 CP08 全庫 Audit 對帳增量；必要的同檔小型純比對函式可供這些測試共用，不改 app child／SQL instrumentation／sampling／stop／timeout 實作。
2. `server/test/performance/inventoryStocktakeCharacterization.performance.test.js`：CP07／CP08 的分層 Audit 外層斷言及 oracle 支持性案例，原 CP01–15 的其餘案例義務全部保留；CP08 原本尚未完成，不能宣稱已通過。既有 CS01 義務保留，但這次不增加 soak 檔修改範圍。

不得修改 ExportService、StocktakeHandler、apiDispatcher、InventoryAuditService、Item、所有產品／DDL／schema／auth／serializer／DB設定或已批准 immutable file/component pins。49 個累積 file pins（44＋5）與21個 source guards，共70個不同檔案，加四個 helper component pins 保持原值；額外固定目前 coverage function、固定節拍、client yield 觀測增量的 bytes，不能借 Audit 候選改採樣。非 Audit 的 CSV／資源／cleanup／SQL terminal 斷言不刪改。唯一取代的是跨 DOMAIN＋ROUTE 的 outcome 唯一性、單 target 及單 FAILED 預期，改成上述更精確的身份與列集核對；不能只把上限從1放到2或移除失敗分支。

#### TDD／mutation／真實重驗

採用後先以原生反例的最小合成列集重現原 oracle FAIL，再驗新 oracle 對固定 COMPLETE 與 BUSY 列集成立。這是純邏輯支持性測試，不冒充 DB／HTTP 或全庫容量。至少八個負向邊界必須拒絕：①漏 DOMAIN ②漏 ROUTE ③同 scope/outcome 重複 ④錯 actor/actor_label ⑤錯 target/type/label（含 NULL 被轉成0）⑥錯 request/correlation／非 NULL operation ⑦錯 summary／多餘 outcome／未知歸屬 ⑧未知或重用 dispatch／CP08 漏算 ROUTE 的全庫增量。

至少三組 targeted wrong variants 必須被新增斷言捕獲：丟棄 NULL-target route 列、同 outcome 或同 scope 去重、將實際 readback 當成預期。只在私有受控函式／fixture 中注入並保留每組失敗證據；不得把錯誤變體留在產品或覆寫原 reports。

之後在原 full-capacity fixture（5倉／1000Bins／100kSKU／500kBuckets／2M Movements＋15真 Reservation／20 actors）下重跑 CP07 的 pool10＋pool1、真 busy503、兩份200 SCOPE＋99800 LINE＋SUMMARY CSV、逐欄／ID digest、1Hz／95%完整度／5秒 gap、own匿名檔／socket close／SQL終止及精確三個 dispatch 的 Audit；完整 characterization 必須再涵蓋 CP08 的零／非零流程、所有原 CP01–15 及 CP06 三輪查詢共存／CP13 CPU 清理義務。支持性 subset 不能冒稱原 characterization min15 通過。

profile／trace／suite argv／env／min／maxSkipped／timeout／permissions 全部 byte-identical，無新 suite／新依賴／新 DB grant，PHASE005 仍54組。原 native20秒交易／30秒HTTP／120秒CSV、7200／2700秒 coordinator、查詢p95<2秒、固定30分鐘soak、所有成功／503／timeout／NOT_SENT分母不變。所有新增 oracle／mutation／原生及新 PLAN 最終來源54組現在均 NOT_RUN；37 floors／全局92/83/90／五項CI／正式TC-UAT不變。舊 green 保留歷史，不可換 hash 沿用。

#### 代價、審閱與限制

保留分層安全記錄的代價是 Audit 列數不同於 logical HTTP request 數，報表須按 target 歸屬解讀；本候選不改公開 API、CSV 格式或正式門檻。只有健康正常場景主張精確列集，不作跨崩潰／Audit DB 失效的 exactly-once 或 FAILED 一定持久化保證。

本精確候選只改三個 canonical 檔：design 的第10.6.8節、manifest 的該 design 衍生 provided pin／描述、TASK041 本段計劃。profile、trace、generated matrix、consumed pin 均原 bytes。Sam 精確批准後才採用並 TDD；完成仍須 Sam 最終精確來源審閱。後續跨模型依 APR291 全面略過；新候選單模型評審不等於第四輪 HD211 採樣評審。

TASK041／P4 仍未完成。CP08／CP13／CS01、全54組／數值gate、production空metadata／target filesystem及共享ServerResponse warning仍待收斂。不是未見來源批准、證據匯出、commit/push/PR/merge、CI豁免、P5、正式TC/UAT或部署；未獲實際精確批准維持canonical／產品／斷言不變，不啟動新負載。



### TASK041 第十一增量 — HD214 A / HD215 CS01 lifecycle、Audit 與 refresh 精確候選

PROPOSED_NOT_APPLIED。HD214／APR310 只批准準備；本候選仍須 Sam 實際審閱精確 DESIGN／PLAN／scope 才可採用及實作。新觀察、支持性測試、原生 CS01 與新 PLAN 最終54組全部 NOT_RUN，既有原生結果不換 hash 沿用。



#### 精確來源／保留範圍

Only two implementation paths: existing `server/test-support/inventoryStocktakePerformanceChild.js` (CS01-only child observer, primitive receipts, fixture/lane/report support) and planned new `server/test/performance/inventoryStocktakeResourceSoak.performance.test.js` (single native CS01 plus focused assertion probes in that file). Other than the explicit passive lifecycle/Audit observation below, this does not expand test instrumentation beyond existing source/resource observations. No extra suite/command/minimum/env; all54 remain mandatory.

The previously approved CP13 characterization/owned-recovery increment remains separately authorized, not re-approved as unseen source by this candidate. At preparation time its private patch `1d53b384bc8870477d35b11137c410c8bc563057b64b0fbec64f01944e1375b5` is NOT_APPLIED and native NOT_RUN. Its existing characterization path is not made immutable by this CS01 candidate. CP08/13 normal characterization behavior may not be altered by the new CS01 observer/lane code; all original CP01–15 obligations remain. Final cumulative exact source requires actual Sam review.

No product, Item, framework, schema, roles/auth, DB settings, package/dependency, deadlines,70 immutable file pins/four frozen components/HD211 sampling clock+coverage+yield changes. Only the three canonical files described here change; profile/trace/matrix remain byte-identical. If passive observer/owned association or scheduler cannot be implemented inside those limits, stop and surface the precise delta before implementation.

#### Minimal passive observer contract

Use the existing test-child `createApplication({handlerRegistryOptions})` boundary (helper3831–3844). The already-supported `moduleLoader` hook (`handlerRegistry.js:44–73`, `createApplication.js:502–506`) returns original module exports unchanged except a test-only subclass of `ExportInventoryStocktakeHandler` (`stocktakeHandlers.js:167`). Its constructor calls original `super(services)` unchanged, then installs wrappers on that owned handler, its owned `exports`/DOMAIN Audit and handler/ROUTE Audit objects. Inherited static api/kind/handlerName, original constructor, execute, handle and auditFailure implementations remain the actual implementations. Do not replace any other handler class, change routes or patch shared prototypes. Installation is CS01-only before app.start, never late during load.

Each wrapper calls the original exactly once with the same receiver/arguments and returns the original value/Promise; synchronous errors and original rejection objects propagate unchanged. Callback wrappers forward once with unchanged arguments; original event emission, listener order and return values are retained. Observation does not await IPC, alter a signal, retry SQL, consume/read/pause/resume/destroy a stream, or inject timers/barriers/delay. Bounded synchronous scalar capture and attached settlement observation have real overhead: measure and report it, not claim timing-neutral instrumentation. Capture failure/overflow/send failure makes evidence INCOMPLETE, never mutates the application result. No new ServerResponse listeners, warning filters or maxListener changes. Report storage never retains req/res/stream/Error/connection/FileHandle objects; transient ownership associations use WeakMap, and closure-held references are released after settlement. The primary transaction wrapper immediately forwards non-owned calls untouched: ownership is the existing context requestId recorded at this owned export handler entry, or the exact synchronous independent-Audit invocation association; no global SQL-event collector or new async-context service.

Events are independently tagged by type, not reconstructed from persisted Audit rows. Common envelope: worker incarnation, monotonically increasing per-child sequence, child monotonic observation timestamp, original requestId, known handler, per-request invocation/stream/transaction/Audit-attempt primitive IDs. Parent separately registers the exact request/source hash, actor, target, filters and actual dispatch row BEFORE sending HTTP; event request IDs must join that ledger and server echo, never another event's guessed identity. No raw payload, token, password, signature, arbitrary error message/stack or CSV enters the report. Safe error fields are code/name and optional statusCode; UNKNOWN remains explicit.

| Type / actual insertion point | Captured fact, without changing the operation |
| --- | --- |
| `generation.return` / owned ExportService.createGenerationReader at line157; wrap its original initialize settlement, then that owned auxiliary database.withTransaction return at202–254 | Observe the ORIGINAL fulfilled generation-transaction return, before prepare continues to success Audit/stream. Whitelist only stocktakeId, stocktakeNumber, status, cancelled, varianceStage, asOf, workflowVersion, exportedRows, truncated, truncationReason, generationBudgetMs, filterHash. It is NOT the public prepare descriptor or success-Audit input. Original initialize/transaction Promises and reader object remain returned unchanged; no extra SQL/connection. A rejected generation has a separate safe error event, not invented metadata. |
| `prepare.return` / original owned exports.prepare at94/292 | Associate the actual returned stream with request; whitelist descriptor scalar fields only. Do not infer rowCount from this descriptor: it is absent. Install stream observation before the original caller can start delivery. |
| `stream.pipe`, `stream.event`, `stream.destroy.call/result` / that returned stream only | Call-through wrappers of its original pipe, emit (only end/error/close recorded) and already-product-installed _destroy (274–285). Record destination identity equality with the owned handler response, original destroy error presence/safe code, readableEnded/destroyed flags, and callback error. No additional stream/response listeners. Observe original events before forwarding to the original emitter; do not synthesize an event or alter listeners. These facts distinguish source EOF/normal destroy from errorful source termination. |
| `delivery.return/error` / original owned handler.handle (BaseRequestHandler104–245) | Capture original Promise settlement and primitive response finished/destroyed/headersSent flags, plus whether the matching stream's pipe was actually invoked. A handle return without pipe is NOT declared clean pipeline delivery. A rejection after pipe is an observed started-file-delivery failure, not guessed from client abort. `auditFailure.call/result` at stocktakeHandlers62 observes the actual dispatcher invocation separately, including source error/status; do not fabricate a ROUTE write from handle rejection alone. |
| `audit.attempt/result` / owned DOMAIN and ROUTE Audit.recordSucceeded / recordFailed / recordRejected (AuditService50,95–100) | Independent attempt ID, declared owner/method/outcome, exact bounded scalar input fields and original public return/rejection. SUCCEEDED method resolution is only INSERT completion inside caller transaction, NOT commit. FAILED/REJECTED true/false is separately recorded. Deduplication is whatever actual original methods do; never deduplicate observed attempts or rows by outcome. |
| `audit.transaction.result/error` / existing primary database.withTransaction call-through, additional CS01 observer outside frozen installTransactionObserver | Associate a transaction with an actual owned Audit attempt using the original callback's transaction object (WeakMap); for independent recordFailed/Rejected capture the synchronous method-to-withTransaction invocation identity, not a later time heuristic. Record original transaction settlement/safe error. Non-associated/non-Stocktake transactions produce no new events; unchanged original observer still runs. Preserve original work/options, return and errors; no second transaction/SQL or new connection. If transaction association requires callback wrapping, call original work exactly once with identical this/args and return its original value. Explicit `DATABASE_TRANSACTION_INDETERMINATE` is UNKNOWN_COMMIT, not rollback. |

Generation return metadata is independently known before an aborted client can fail to consume the footer. Compare target/number/version/status/filters/hash against preregistered source and the fixed COUNTING snapshot, plus known200 scopes/100000 lines and the unchanged cap. Compare every actually received row/prefix against the independently ordered expected rows; complete exports require the real footer/full ordered digest. On abort, metadata records the generated count/reason, not a claim that the unconsumed suffix was client-validated. Do not fabricate a footer or count from Audit readback; TIME_LIMIT does not satisfy the complete-or-ROW_LIMIT minimum.

#### Exact outcomes and Audit accounting

Every actual Audit increment remains in the global unique-row-ID union, including NULL-target ROUTE rows, unexpected action/request/target and unrelated increments. Expected descriptor values come from predispatch intent, known actors/target/filters, independently observed generation return and ORIGINAL Audit attempts/transaction settlements; never from Audit rows under validation. Validate attempt identity against intent before using it as expected data. DOMAIN uses known positive stocktakeId, `stocktake:<id>` and fixture username; ROUTE uses strict NULL targetId, exact route template and `user:<actorId>`. Success category/reason/after-summary are source-defined generation fields; failure/rejection reason defaults, after/before/operation NULL follow original serialization. Do not persist errorCode as a fictitious reason. Retain full original scalar/identity/timestamp protection; where occurred_at is not exposed by public input, use the original Audit call/transaction time interval as provenance, never select an expected branch using that timestamp/readback.

For healthy, positively returned Audit transactions: one exact persisted descriptor per actual successful Audit write attempt, including any duplicate or unexpected attempt as a failure of the expected source branch, not an allowed count. No blanket per-outcome dedup or `<=N` rule. The following sets apply only after all independent events establish the named branch:

- Clean server source EOF/normal destroy, matching pipe and successful original handle return, no DOMAIN/ROUTE failure attempt: exactly DOMAIN SUCCEEDED. Client abort may race after this server completion; it is still recorded as client abort, not clean client download.
- Source already normally ended/destroyed, then started delivery rejects and dispatcher actually attempts ROUTE failure, but no DOMAIN failure attempt: DOMAIN SUCCEEDED plus the exact ROUTE attempt outcome (plain no-status disconnect => FAILED; original4xx => REJECTED). Do not demand a DOMAIN failure merely because the later pipeline failed.
- Actual stream error/errorful destruction causes the memoized DOMAIN failure attempt, and dispatcher actually attempts ROUTE failure after delivery rejection: DOMAIN SUCCEEDED plus those independently observed exact DOMAIN/ROUTE attempt outcomes. Source error and handler/dispatcher outcomes are separate events; their order is not presumed.
- Any unmatched/missing lifecycle event, non-terminal stream, missing expected attempt, duplicate attempt or unjoined request is INCOMPLETE/FAIL, not another accepted branch. Pre-generation BUSY retains source-grounded healthy DOMAIN FAILED + ROUTE FAILED with no generation return or stream, not a post-first-byte abort.

Audit `recordFailed/Rejected === false` is explicitly AUDIT_WRITE_FAILED even when its underlying transaction rejection is observed. It does NOT authorize an expected missing row, a row-count union/range, or success. Preserve all actual rows and error diagnostics; overall exact reconciliation cannot PASS. `DATABASE_TRANSACTION_INDETERMINATE` is separately UNKNOWN_COMMIT even if the public method later returns false; neither absence nor presence readback selects a lifecycle branch or converts UNKNOWN into persistence certainty. A source-method error/false without the underlying transaction event is unresolved evidence, not known rollback. No Audit retry, delete or compensating SQL is authorized. The observer exposes these failures; it does not repair best-effort persistence or promise exactly-once delivery.

#### Refresh due / fixed writer candidate interaction

For each actor, two distinct mandatory signed refresh events become due at monotonic steady elapsed600s and1200s. Each uses the actor's first subsequently ADMITTED own original lane turn: actor idle, intended tick not at least125ms late, worker actual-spacing requirement satisfied; a writer's fourth intended turn is reserved for candidate and is NOT refresh-eligible. On each fourth writer turn the planned family remains candidate, even if busy/late/rate-limited; no silent refresh, workflow or delayed candidate replacement. Other writer turns prioritize required/expiry-safe refresh over the next workflow step; readers/exporters use their own ordinary eligible turns. Admission never queues an old offer, borrows another actor's turn, overlaps an actor, or adds an HTTP request outside the fixed offers.

Register the next action family before admission, including deferred candidate ticks and refresh-due state. If an actor is in a legal120s CSV at the boundary, refresh waits for its first eligible own turn after settlement; actual due→dispatch lateness and complete time are reported without a newly invented completion-window bound. Both mandatory events still must complete successfully within steady and before real JWT expiry; late beyond steady, expired auth, failed/absent signature or hidden login is FAIL/INCOMPLETE, not a waived event. No401-driven relogin or off-lane retry.

**Final admission after signing.** The CS01-only transport/lane adapter lives outside frozen `request()` and is used for its streaming CSV and signed/ordinary HTTP offers; normal characterization transport remains unchanged. Keep the original watchdog/result-unknown/quarantine/original-error and remaining-diagnostics-budget contract, actual endpoint/authenticator and exact one-send semantics; do not add retry, implicit refresh or new public HTTP entry. A worker has one preparation reservation from an admitted candidate offer through signature preparation and the immediate actual dispatch or NOT_SENT settlement, not through response completion. Other actor ticks during that preparation are retained as NOT_SENT_BUSY with a preparation-busy subreason, never queued or borrowed. The same actor remains in-flight through full body consumption. After preparation, synchronously recheck the original tick lateness<125ms, worker not quarantined, token still safe, due-refresh/candidate family unchanged and actual worker dispatch spacing>=125ms; failure becomes NOT_SENT_LATE/RATE/BUSY with its intended family and denominator intact, not a delayed send. Actual fetch dispatch records lastDispatch before releasing preparation in the same synchronous segment; no await gap may let a second actor pass the final check. Original HTTP watchdog starts at actual dispatch, signing/preparation elapsed and intended-to-complete cost are separately recorded. Probe delayed signing across another actor's tick, early signing rejection, post-sign quarantine/token safety and abort/body cleanup; prove no compressed actual send spacing, hidden request, retained queue or off-lane refresh. If this cannot preserve the existing watchdog contract without altering frozen code, surface the exact conflict before implementation.

An earlier refresh required by the actual token expiry uses a non-candidate ordinary own turn and is recorded separately. It does NOT pre-satisfy either future mandatory due event. A single actual refresh initiated after a due boundary may satisfy that one due event and expiry need together; it can never stand for both600/1200 events. Record JWT issued/expiry primitive times (never JWT), dueAt, intended tick, admission/actual dispatch/response complete, signed-request fact and safe outcome for every actual refresh. CS01 steady requests go only through the explicit adapter above, never nested frozen request() calls that could secretly refresh/throttle or fully buffer CSV. The frozen normal request remains unchanged for its existing characterization/preparation/known cleanup obligations. Do not redefine a fourth candidate as refresh just because token safety was missed; an impossible safe admission fails rather than changing expiry or candidate policy.

#### Preserved bounds, verification and remaining limits

2700s coordinator includes full setup,120s warmup,1800s steady and<=180s drain; originalHTTP/DB deadlines and JWT15m/session8h remain. Full5warehouse/1000bin/100kSKU/500kBalance/2MMovement fixture,20real actors/15real Reservations,2workers10primary each/single parent SQL/one auxiliary per worker,14400offers per worker125ms+62.5ms offset, per-actor/per-minute all NOT_SENT denominators, reader/query/workflow/export minima, each real tenth-attempt post-first-byte abort,95%complete1Hz/max5s gap, coherent minute checks/final full0reconciliation and realHTTP business cleanup remain unchanged. No new resource/write SLO. CP08 memoized cleanup/drained maps cannot silently be reused as a live CS01 oracle or let post-run effects escape verification. The full setup cost may make2700 infeasible; do not increase it, shorten soak or predeclare PASS.

**Explicit CS01 fixture/oracle/close route.** Add an explicit CS01-only fixture mode/entry in the same helper, chosen before boot. Its default characterization path, CP08 oracle, private memoized cleanup and CP13 recovery behavior remain unchanged. The CS01 return/close path must select its own live-ledger/fresh-final oracle and normal business cleanup, not delegate to the drained-only CP08 `verifyBusinessReconciliation` or accidentally invoke that private cleanup later. The six declared rolling scopes in Warehouses1–4 and Warehouse5 exporter scope are preregistered from fixture IDs; derive touched Bucket/Control dimensions from those exact scopes/commands, never retain the characterization assumption that every Warehouse<>1 Balance is untouched. Keep the same owned db/workers/stopWorkers and unchanged normal request for its existing obligations, with only the explicit CS01 workload adapter above; no second application factory, parent SQL connection or generic pluggable framework.

Each intended command is recorded before dispatch with independent normalized source/hash/action/actor/scope/count/version intent. Each minute, on the single parent SQL connection, take one bounded read-only REPEATABLE READ snapshot and capture the set of actually committed matching original-source Operations at that snapshot. Validate each stored Operation input hash/scalar result against the preregistered command, not derive intended values from DB. A committed operation whose HTTP result is still pending is labelled COMMITTED_HTTP_PENDING and included exactly once in that snapshot's effects, without declaring the request successful or permitting retries. Noncommitted in-flight work contributes no effect in that snapshot. Unknown/unregistered/mismatched source is FAIL; a later unresolved HTTP request still fails final readiness even if its commit became visible. Monitor reads do not hold business locks, pause actors or alter workload.

Within the same snapshot, reconcile all touched dimensions' baseline-plus-committed deltas, OnHand ledger, per-Bucket allocated floor, per-Warehouse/SKU Reserved coverage, current workflow/count/snapshot/version/own-and-foreign locks, and every increment Operation/Movement/Audit row above the immutable verified seed-table ID cutoffs, including NULL-target route rows. Rescan that entire post-seed increment range in each minute snapshot using bounded keyset pages (at most500), with unique-ID set reconciliation and original intents/event-derived Audit expectations; never advance the next snapshot's lower bound to max visible/verified ID. Auto-increment allocation is not commit order: an allocated lower ID can become visible after a higher ID was already checked. No increment is silently skipped as a gap or assumed foreign-free because its request was not yet observed. This rescans only test-run increments, not the full2M seeded ledger every minute. Keep pending observed Audit transaction/lifecycle receipts separate until a compatible snapshot can see their positively settled writes, and record snapshot cutoff, seed cutoffs and actual checked-ID union/count/digest instead of silently dropping concurrent rows. Nonterminal or missing evidence remains pending only during live load and must settle for final PASS; no ignored interval or unknown foreign increment is permitted. Minute-check SQL time, sampled reads and all missing/failed/late minute checks are reported, never replaced by post-run checks or excused as sampling cost. Add a commit-inversion probe (lower ID commits after higher ID), a foreign lower-ID variant and a mutation that advances the lower bound, proving all later-visible increments are caught.

After stopping offers and settling every actor within the original drain, run a fresh full500k/2M/all-table reconciliation against the entire committed source ledger and independent export event union; it is not a cached minute/CP08 result. Perform normal password Cancel of the still-owned exporter and any known nonterminal rolling Stocktakes, verify full exact own locks released/foreign locks unchanged, then true HTTP Cancel/replay of all15 original Reservations and verify Released/Reserved/control/history effects. Cleanup after any failed check still collects safe independent diagnostics and preserves the first plus all cleanup errors; UNKNOWN/quarantined/stopped workers forbid further business writes. Finally rerun the full fresh reconciliation including every cleanup command, before own worker/SQL/resource terminal verification. Failure cleanup still uses the same explicit CS01 route, never the W1-only fallback. Final observed row-ID union must include all original and cleanup effects exactly once; unresolved rows, actions or lifecycle receipts are FAIL. CPU/fault-stop success exceptions from CP13 never apply to CS01.

After separate exact adoption, focused tests must prove original Promise/return/error identity and callback/event order, generation return before stream, clean versus source-destroyed late failure versus stream error, false versus explicit unknown commit, wrong actor/target/metadata/duplicate/missing Audit, and refresh due/busy/fourth-turn/early-expiry denominators. Use actual extracted observer/verifier functions, clearly label fake/model support, and retain real native validation as NOT_RUN until executed. Unknown/missing observations stay FAIL/INCOMPLETE. No CP13 exception or forced-stop success is inherited by CS01.

No static source conflict currently requires a third implementation path or a profile change: the existing loader hook and instance methods expose the proposed events. This is feasibility from source, NOT proof of transparent implementation or usable native cost. If original Promise-preserving call-through/ownership association cannot be implemented without changing frozen code or adding framework/HTTP listeners, that is the exact stop condition. The candidate still needs main reconciliation, precise hashed canonical patch review, separate actual Sam adoption/source approval and bounded implementation review. APR291 cross-model SKIP remains. TASK041/P4, numeric gates, production empty metadata/target filesystem/shared warning, final54-source rerun and final Sam review remain open; no publication, formal TC/UAT acceptance, P5 or deployment.



### TASK041 第十二增量 — HD216 A／APR-314 準備；HD217 精確 lifecycle 隔離候選

PROPOSED_NOT_APPLIED。HD216 只批准準備，本候選 DESIGN／PLAN、三檔 canonical patch、兩個 test/helper 路徑及回歸合約仍須 Sam 精確審閱後才能採用。沒有新 app／SQL／負載或產品修改；以下新增驗證全部 NOT_RUN。原 CP14 失敗保留，不換 hash 宣稱原生通過。

#### 問題與唯一隔離例外

固定來源13bea、原 PLAN7e5 的原生 ff5b 測試只完成 CP01／CP09。CP14 要求原 worker1 只有一條 observed/live PRIMARY connection，實際映射14／15兩條，兩個 socket 均直到正常收尾才關閉；HOLD／ABORT、100k流程尚未執行。第二條建立時 requestId=NULL，不據此判定確切背景工作或連線洩漏。兩個 app 正常 ack0／exit0、歷史 SQL terminal 及外層精確清理已證實；quarantine 後業務 cleanup 依原規則被拒絕，不宣稱業務取消成功。

CP15 也依賴 CP14 留下的「只有一條當前連線」，所以本精確候選把 CP14／CP15 的 destructive lifecycle probe 共同移到一個短命 OBSERVATION_ONLY application child。它只證明同一 test-owned app 的 single-connection abort／recreate 與短命 mapping，不證明原 pool10 在任意多連線時的 replacement、產品恢復 RTO 或一般斷線重試保證。這是明示取代原 OL-C／第八增量中「原 worker1／不新增 app／pool／連線」的窄測試例外，不是把兩條改判一條、忽略 alternate、刪歷史或反覆重跑到碰巧通過。

原 full-capacity schema、5倉／1000Bins／100kSKU／500k非零Buckets／2M Movements、15真Reservation效應不改；原兩個 CAPACITY workers 仍各 pool10，原20個 actor身分／roles／device／worker／lane／token不就地更改。不得關掉它們的連線、停背景jobs、調DB或把容量負載移到pool1。額外 app只在CP14／15前置階段存活，必須正常關閉並正面terminal後才可進入CP02／CP10–12／正常1、10、200Bins／CP13／CS01負載。

#### 最小可修改來源與不變範圍

1. `server/test-support/inventoryStocktakePerformanceChild.js`：只允許 lifecycle owner factory／建立前登記、CP14／CP15 owner及request歸屬、短命第三slot的有界設置／移除、retired owner的失敗／正常cleanup與報告／最終歷史對帳。可增量擴充既有 `worker` 的 owner-ready-before-boot callback及 parent peer ownership登記，沒有新產品、SQL操作或IPC種類。`testOnlyObservationHold`／`testOnlyShortConnection`／mapping loan barrier／原5s ACK／20s TX／read／abort／late cleanup語義保持；不擴大任意SQL、PID或duration能力。
2. `server/test/performance/inventoryStocktakeCharacterization.performance.test.js`：只有 CP14／CP15 身分標籤、必要fixture／owner生命週期斷言及同檔support oracle接合。保留15個原生case、CP14→CP15→後續負載順序、其他case bodies／assertions／minima；不刪、skip、把support加進原生分母或以after hook當case PASS。

原70個 file pins（44 accumulated＋21 guards＋5 immutable）、另4個既有product pins、四個 frozen components及 HD211 clock／coverage／client-yield 全保留。新候選另明定 CP06 最新 `beginQueryCoexistence` whole-function SHA256 pin；已修 cursor／required views／phase-auth preflight／early reader rejection capture不在本次可改範圍。profile、trace、matrix、需求、正式TC／UAT不變。原已批准但未套用的 CP13 private patch1d53及 HD215 CS01兩路徑 scope 各自保留，不等同本次批准未見來源；與本候選整合仍需精確hash核對／真原生及最終Sam來源審閱。

#### Ownership／真認證／透明 frozen request

沿用既有 `worker(root, secret, peers, primaryLimit=1)` 的同schema／endpoint／test JWT secret／原handler modules／app配置；唯一新app配置差異是自己的 PRIMARY connectionLimit=1，不改原兩個pool10。使用唯一private worker目錄、boot incarnation、實際OS origin／PID與 mapping nonce，OBSERVATION_ONLY標籤從建立即固定。最多建立一次，不能失敗後重建至PASS，也不復用CP07原有serial pool1 exporter的單次建立額度。

owner handle 必須在呼叫／等待boot前加入本次獨立lifecycle registry，包含partial initialization時的child／pending／已觀察physical／P_S／socket歷史；只有實際ready後才可發HTTP。boot失敗即保留第一個錯誤及所有cleanup結果，無正常PASS，停止後續工作；同原5/5/5 stop及20秒terminal核對清理。handle尚未完整ready不豁免SQL/mapping缺證，不能只拿worker throw或coordinator移除作terminal。

不新增actor／role／permission／device seed。選原worker1的view-only actor作私有request copy：相同userId／credentials／approved device，不就地改原actor.worker/token。copy只在CP14／15維護自己的真signed refresh回傳token／expiresAt，`auth_time`／15m JWT／8h session／固定權限及簽章規則不改。refresh失敗／過期401仍FAIL，不重登入、不偽造claims、不延expiry。原設備私鑰／token／password不放報告。

為重用 byte-identical frozen `request()`，在兩個原capacity entries之後暫時加入固定slot2，copy.worker=2；原兩個worker物件／slot0、1及其dispatch時鐘保持。建立自己的nextDispatch[2]=0，只發CP14／15的明列refresh／SKU lookup，不新增HTTP adapter、不改frozen request、不把extra dispatch塞進原20actor容量／soak offers。每筆row明示實際worker slot2／incarnation／OBSERVATION_ONLY／原actorId，原requests記錄不丟棄。slot存在時禁止容量／export／Stocktake寫入，CP14只允許接CP15；slot不是供外部caller選任意worker的介面。

CP14／15各自在完整before-rowhash後、HOLD／short command前，先真signed refresh及非cached Inventory SKU lookup，核對原view-only權限與有效JWT來源。refresh及其明示Auth request列在capture original connection之前完成；recovery GET仍恰好單一真HTTP／不含hidden refresh。固定原30秒HTTP、10秒SQL、5秒acquire與mapping ACK、20秒transaction／terminal，沒有新可用時間；每個完整16表核對成本及app boot／停止成本均記錄且計入原7200秒coordinator，不拉長原期限。

#### CP14／CP15 必須保留的證據

CP14：before/after完整16表及原worker0授權GET不變。對OBSERVATION_ONLY owner正面核對所有observed／live PRIMARY identity恰好一條，pool配置1且無auxiliary／alternate；strict HOLD／ABORT UUID、incarnation、nonce、固定Warehouse5鎖、原5秒觀測、callback settle、原20秒內session／P_S／statement／InnoDB／engine locks／requesting及blocking waits消失均不變。活app recovery真GET區間內必須收到唯一真正新native ID／P_S mapping；前後完整registry=old+new、live只新一條、noalternate／late通知／mapping缺失仍FAIL，不能只因pool1配置就推定證明。

CP15：接續同一OBSERVATION_ONLY incarnation，不重boot／清registry，原CP14留下的唯一live replacement為ORIGINAL；固定short-connection command正面映射後destroy ORIGINAL，再同pool取得真正FRESH並在mapping ACK後立即destroy。保留兩個各自nonce／native／P_S歷史、真socket close／command和callback終止、當前SQL／locks／waits正面全零及缺mapping反證。原worker0仍真授權GET；OBSERVATION_ONLY的後續recovery GET必須再建立新mapped connection。每個原deadline不變，不能把隱含refresh／borrow alternate／destroy呼叫當作新replacement或terminal。

兩case每次都核對原兩個capacity owners未換incarnation／pool10／slot／actor routing；對它們已有多條合法連線只保留完整歷史，不要求singleconnection或殺掉alternate。兩者不得拿OBSERVATION_ONLY的native mapping冒充自己的。原normal整張資料／ledger／Reservation對帳、CP05三輪100k、CP06六families100樣本／20actor每view family至少5／native Start-Count-Ready-Post overlap／p95<2s、CP07 pool10與pool1／CP08全庫對帳、CP13故障及CS01要求全部保留。

#### 成功、失敗與retired owner

只有CP14所有斷言成功可將observationLifecycleVerified設true以允許緊接CP15；它不是正常負載放行。只有CP15資料／mapping全部成功、OBSERVATION_ONLY app原normal close已得到實際ack0／exit0、所有歷史native／P_S／statement／InnoDB／locks／waits及socket均在原窗口terminal、slot2已移除且monitor ownership回到原兩個workers後，才設shortConnectionVerified=true／允許後續正常負載。現有requireObservationLifecycle仍要求兩flag及無quarantine，不可用prepared／stopped／fixture exists取代。

所有失敗（含boot／refresh／pre-HOLD／between CP14&15／close／restore／report）清除兩flag、quarantine全fixture，保留第一錯誤＋每個cleanup錯誤；後續probe／capacity／CP13及業務cleanup寫入零dispatch。已啟動的command／callback仍須收束和正面terminal，不能因提前assert而略過。允許原5/5/5 best-effort escalation清理自己的故障child，但normal案例出現TERM／KILL、缺ack、wrong exit或terminal不明一律FAIL；CP13單一CPU故障豁免不擴用。

scope slot2與clock只有在其request／IPC已settle且owner stop／terminal已確認後才移除；失敗時不得先刪slot或registry掩蓋unknown owner。容量slots0、1／時鐘不得重置。退出後owner仍留在retired lifecycle registry：原physical events／mapping／transactions／resources／stop／error回執全保留，明示角色與incarnation；從active dispatch list移除不是刪歷史或移除最終對帳責任。

正常fixture close在原兩個workers之外，亦核對retired owner的整個歷史集合與已memoized實際stop回執，原5s capture及20s terminal內做新鮮SQL核對，不接受舊terminal字串作現在證據。不向已退出child再發IPC，不重開app／清registry，不把OBSERVATION_ONLY的正常stop誤判capacity故障；但unknown／late mapping、socket缺證、extra connection或incarnation不符仍FAIL。原兩個workers不得因先前retired owner錯誤而漏清；全部owner集合才可報SQL_TERMINAL_CONFIRMED。monitor metadata ownership在active／retired核對間明確包含相應歷史、最後恢復原active array，不能把foreign ID補成本worker。

報告分開保存normal capacity2workers與OBSERVATION_ONLY證據及成本，並有all-owned終止union；不把額外app的吞吐／RSS／query／refresh當原capacity／CS01用戶分母，不丟其resource或失敗列。owner建立／ready／lastdispatch／close／exit／socket／SQLterminal／retire時刻皆為觀察，不拿PID／prefix／mtime猜ownership。precision清理由原own coordinator最後執行，不動其他run或shared資源。

#### 必需驗證與反證，全部 NOT_RUN

既有OL01–17、九wrong variants、OM01–10及全部原生條件保留（owner來源按本例外精確改綁）；新增至少12個focused SUPPORT_ONLY scenarios，須執行實際新factory／owner-join／case／cleanup functions，fake依賴與故障注入標明，不增加15個原生case分母：

| ID | 必須可區分的結果 |
| --- | --- |
| LI01 | 原capacity兩個pool10已各有多條合法歷史：不修改它們；新獨立pool1 owner實際mapping／角色分開，原actor/token/slot0、1／clock完全保持 |
| LI02 | 原始單連線precondition oracle仍拒絕OBSERVATION_ONLY owner的兩條live／額外mapping；不因配置pool1放行 |
| LI03 | owner在ready前登記；boot失敗／晚ready有完整own handle清理，原錯誤保留，不開第二個app或dispatchHTTP |
| LI04 | view-only actor copy只用真signedrefresh／有效JWT；refresh401／簽章失敗不重登；recovery GET不混hidden refresh，原actor不改 |
| LI05 | active slot2與own clock只存活至同一ownerterminal；跨worker／foreign native/P_S／nonce／incarnation拒絕，mapping缺失保持UNKNOWN |
| LI06 | CP14成功只可接同incarnation CP15；短命history未保留、假socket close、late ACK及借用舊alternate均拒絕 |
| LI07 | CP14/15資料或callback失敗後，後續case／capacity／CP13及業務cleanup零dispatch；已開始command仍收束，原first error＋cleanup error均保留 |
| LI08 | CP15成功但normal close缺ack、wrong exit、需TERM/KILL或SQL/socket未terminal：不設ready、不移除未知owner、不算PASS |
| LI09 | 成功retire後不再向該child發IPC，但最終monitor對所有歷史ID重新查核；晚到新ID／錯owner／foreign或缺terminal均FAIL |
| LI10 | retired核對失敗仍清理原兩個capacity workers，不能靠刪registry／只看active2count通過all-owned union |
| LI11 | slot恢復後原capacity identity／pool10／actor／requests／clock不變，原CP06whole-function與四components／HD211 pins不變；CS01／CP13無新成功豁免 |
| LI12 | 初始Inventory16表、CP14後、CP15後完整hash一致；all-owned resource報告包含extraapp且capacity分母不含它，超cap／缺報告不默默忽略 |

至少六個targeted wrong variants要被新斷言捕獲：改掉原pool10／原actor；pool1就跳過實際single-identity核對；boot前漏owner登記；CP15關閉失敗仍ready；刪retired owner讓unknown terminal消失；retired核對失敗就跳過capacity owner清理。保留每輪原始輸出與hash，還原helper/產品後核對；不能從合成support推出真HTTP／P_S／socket／原生容量通過。

在新PLAN／最終來源，CP14及CP15真MySQL26.7／真app／真signed auth／完整schema實測零skip；其後完整15case characterization（含三輪1／10／200Bins及所有原風險）與CS01，以及全部54個必需DEVELOPER組、37個原coverage floors及全局92/83/90、真browser／實際Playwright CLI／lint／build／audit依舊。characterization min15／7200s、soak min1／2700s、30分鐘steady、1Hz／95%／5s、原query p95<2s及原所有成功／失敗／NOT_SENT分母不改。

新增代價是一個一次性的test application／最多一條live PRIMARY（歷史replacement另計）、真refresh及全16表/metadata核對／normal退出時間；需實際量測，仍可能無法在原7200s完成，超時如實FAIL。這不修背景pool行為、不聲稱pool10無leak／soak風險已解。原ff5b／f874／023c等所有失敗與run refs、HD216準備批准及review provenance保持原path/hash；新來源green不回綁舊source。

本候選只改design明示隔離例外、manifest provided pin及TASK041計劃；尚未採用。最終仍需Sam實作來源審閱，TASK041／P4、數值gate、target filesystem／production空metadata及shared ServerResponse warning未完成。不含證據匯出、commit/push/PR/merge、CI豁免、P5、正式驗收或部署；APR291全部後續跨模型略過。



### TASK041 第十三增量 — HD218 準備批准／HD219 精確 CP10 sample 准入候選

PROPOSED_NOT_APPLIED。Sam HD218 A／APR318 只批准準備。現有 HD217 DESIGN／PLAN、source `db630d121f3742cc0c1d728152f5871134f84480b643941db6203c828dced5eb`、helper `b0bd064c7933875fc99e1055e9a2f8932889bacc0519981c6844847d47a5e65c` 不變。原生9b4d的CP01／09／14／15／02 PASS、CP10 FAIL及清理缺證完整保留；100k Post／CP13／CS01未執行，不說成新的HTTP500。

#### 精確取捨與數值

只對CP10的sampling-phase「開始一整份metadata sample」增加固定1000ms准入餘額，不改任何已發SQL的期限或分類。這是提請Sam批准的測試取樣政策變更，不是既有HD205已批准的語義，也不是runtime已證明的安全修復。

在每次本來準備呼叫 `lotProbeState` 的位置，先檢查child是否已settled；已settled直接進既有completion／terminal流程，不另發sampling SQL。否則以當時monotonic now計算 `remainingMs = samplingDeadline - now`：剩餘至少1000ms（含等於）才准入一份sample；0至不足1000ms則只記 `NOT_ADMITTED_RESERVE`、停止發出後續sampling offers；已到／過samplingDeadline記 `WINDOW_CLOSED_BEFORE_DISPATCH`。兩者都沒有送SQL、不是完整sample、不是成功或terminal，不能用來代替至少一份完整sample要求。

1000ms是固定、不可由env/caller放寬的developer取樣准入參數，約佔原20s窗口5%；它是保守候選值，不是從一次120.7ms事件推導的最壞上限，不保證一份sample一定在1s內完成。代價是窗口最後不足1s不再啟動新的sample，可能少收尾端診斷；候選必須明示此資料密度差異，不能聲稱仍連續取滿原20秒。CP10原非固定1Hz offer，這不改HD211的CSV／CS01 1Hz／95%／5s觀察契約或任何capacity offered request配額。

准入後仍原樣呼叫 `lotProbeState(..., samplingDeadline, samplingObservation)`：每一句繼續取同一絕對deadline剩餘時間與原10000ms的較小值。已發SQL若逾時、錯誤、timer／driver超時、結果在deadline後才到或monitor被destroy，一律保留原FAIL／quarantine，不因准入reserve或後來乾淨而通過。下一句尚未dispatch且原deadline用盡，才沿用原 `TEST_SAMPLING_WINDOW_CLOSED` 的partial記錄；partial不算完整sample，已學的IDs／tokens／query事件仍保留。1000ms不會延到每句SQL前重新加時，也不增加新wait或重試。

原samplingDeadline仍在RPC嘗試前固定為dispatchAt+20000ms並包含start identity等待；沒有matching start仍按原deadline FAIL。提早停止offers不改這個deadline。completion未知而提早停止offers時，只可暫以samplingDeadline+20000ms作原completion等待上限。收到matching completion後、開始任何作成功依據的terminal查詢之前，必須依實際completionObservedAt重新計算並只收緊 `terminalDeadline=min(completionObservedAt,samplingDeadline)+20000ms`；不能保留較寬的暫定值。例：dispatch+19.2s不准入、child在+19.5s完成，terminal必須於+39.5s前完成，+39.8s結果必須FAIL，不能沿用+40s。已過有效deadline就FAIL，不重新計時。這項probe內「暫定→實際deadline收緊」亦明列兩檔增量範圍；原matching completion與其後完整正面SQL terminal雙證據不變，先前Sleep／零活動仍不能拼接回執。

#### Scope、記錄與失敗monitor所有權

增量只限兩個既有路徑：`server/test-support/inventoryStocktakePerformanceChild.js` 的一個小型pure准入判斷、CP10 probe sampling loop／matching completion後的暫定deadline收緊／primitive記錄；`server/test/performance/inventoryStocktakeCharacterization.performance.test.js` 的原CP10 case內新增支持性oracle，之後仍完整執行原生CP10。原case bodies與assertions除這些明列增量外不變，不能靠新增synthetic test數充當原生15case門檻。無產品、Item、DDL、auth、DB／HTTP／logging框架、pool配置或依賴變動。

每個probe記錄固定reserve、每次實際sample offer的now／remaining／decision、attempted／admitted／completed／partial／failed／notAdmitted計數及保留上限／dropped計數；只保存primitive、不得SQL文字、params、credentials。offer明細最多500筆、逐句query事件原10000筆及sample原500筆上限不變；超限仍記總數。每個offer有單調seq與sampling query-event起訖index；即時斷言後才按上限存primitive明細。每份offer最終恰屬COMPLETE、PARTIAL_WINDOW_CLOSED、FAIL或NOT_ADMITTED之一；有任何真錯誤優先歸FAIL，仍保存其partial payload，不重複計入partial。終態attempted=admitted+notAdmitted，admitted=completed+partial+failed，另列pending並要求成功時為0；stored+dropped=attempted。只有真正準備取sample才算offer，不為剩餘1s捏造timer ticks／假offers。NOT_ADMITTED只計一個真實未發送offer與實際停止時刻／餘額，不算PASS／complete；舊query events、所有fail／UNKNOWN與未發送分母不丟棄。每probe總量須對帳，缺必要失敗事件仍UNKNOWN／FAIL。

本候選評估後不採用fresh monitor／reconnect／新pool。失敗monitor仍由原fixture持有，`lotMonitorRead` 的destroy與原normal／failure cleanup語義不變；一旦它已失效，禁止新probe／正常負載與業務cleanup寫入。仍獨立嘗試每個原capacity／retired owner的停止與既有SQL核對，無法取得fresh SQL證據就維持SQL_TERMINAL_UNKNOWN及整組FAIL；coordinator精確teardown不取代應用證據，不保證FAILED情況一定能重新證明terminal。缺點是本候選只降低窗口尾端新sample被准入的機會，不解決任意真監測SQL失敗後的可恢復性；若後續確需新monitor，另提精確設計，不偷偷加連線或改成成功。

`lotMonitorRead` whole-function新增byte-identical pin（含start、不含end）；原四個legacy frozen component沿用不含start及end的舊抽取慣例，hash值不改。既有四frozen components、CP06 whole-function、HD211、70個檔案＋4個產品pin、所有其他累積來源保持。兩個實作檔的before hash隨本候選提供；原CP13／HD215 CS01獨立已批准範圍保留，但仍須相應開發／native／最終Sam審閱，不視為這次新實作批准。

#### 計劃驗證 — 全部 NOT_RUN

在既有CP10 case中先執行至少12個pure／fake collaborator支持性oracle，不新增native case或改原命令／profile／env／min15／7200s：

| ID | 必須證明的結果 |
|---|---|
| CA01 | remaining=1000准入，remaining略低於1000不發SQL；不把邊界取整成1000 |
| CA02 | remaining=119的原生事件形狀為NOT_ADMITTED，query數0、未發送分母1、無destroy；不是原事件重分類 |
| CA03 | remaining=0／負數是尚未dispatch的WINDOW_CLOSED；無query／完整sample／成功增量 |
| CA04 | child已settled先停sampling，不再作准入或SQL；completion仍必須matching |
| CA05 | 准入後的完整sample沿用原samplingDeadline，未加reserve、未重設任何clock |
| CA06 | 准入後真SQL錯誤／已發query deadline競爭仍FAIL，原first error保留、monitor destroy／quarantine仍被觀察 |
| CA07 | sample部分完成後在下一句前耗盡deadline仍保留partial與IDs／tokens；不補0、不算完整sample |
| CA08 | NOT_ADMITTED後等待matching completion；19.2s停offer／19.5s完成時只接受39.5s前完整terminal，39.8s必FAIL，不接受早先Sleep或暫定40s |
| CA09 | missing／late completion、terminal超時或缺SQL證據仍FAIL；NOT_ADMITTED不重開20秒 |
| CA10 | 沒有完整sample即使有NOT_ADMITTED／terminal也FAIL；原samples.length>0保持 |
| CA11 | offer／query／sample的三種原上限與dropped／failed／UNKNOWN／NOT_SENT計數對帳，不能丟失已發失敗 |
| CA12 | 失敗monitor不重連；兩capacity與retired都嘗試cleanup、證據不足保持UNKNOWN／FAIL；原外部精確cleanup獨立 |

六個targeted wrong variants須被明確斷言捕獲並保留原輸出／精確還原hash：跳過reserve而發出119ms sample；把NOT_ADMITTED算complete／PASS；替已發SQL延後deadline；忽略真timeout；從reserve-stop重新起terminal時計；丟棄failed／NOT_SENT或允許零完整sample。支持性fake clock不是native SQL／socket證據。

原生CP10還必須在每probe直接驗證新接線，而非只跑12個fake oracle：真offer記錄的未取整remaining=同一samplingDeadline−實際offer.now，decision由獨立literal1000比較斷言（不把pure helper回傳當預期）；admitted／COMPLETE／partial／failed與真samples、query-event ranges及總計／dropped對帳。NOT_ADMITTED的sampling event range為空，stop後不得新增sampling SQL；terminal事件另在matching completion之後開始。已准入sampling query的dispatch／remaining／settle必須符合原deadline／10000ms與原FAIL分類；COMPLETE sample的完整metadata labels／狀態均須存在，不以非准入或partial灌數。成功時pending=0、完整samples>0、有效terminalDeadline按真completion收緊且所有成功terminal事件在其內。沒有自然發生reserve分支就明示NOT_EXERCISED／count0，不造假或retry至出現；邊界分支的fake支持與native實際覆蓋分開呈現，不能宣稱未觀察到的native分支已證明。逐筆assert在明細上限前執行，超限保留各類總數／dropped；缺必要失敗query事件仍UNKNOWN。這些新增原生assertion與primitive索引也在同兩檔範圍內。

新PLAN／最終來源須完整重跑原生CP10的兩shape PLAN、六輪balanced SELECT、原25k結果／排序hash、original10s right-censor及候選max(IN)<baseline完成值或10s下界；完整before／after Inventory16表hash與monitor可用性仍必需。只有sampling／terminal／完整結果／資料不變與所有必要事件均通過才記CP10 PASS，之後才CP11／12、三輪1／10／200Bins、CP06原六family／20actors／p95<2s、CP07／08／13和CS01。

54個必需DEVELOPER組、characterization15case／7200s、soak1case／2700s及30分鐘steady、原所有產品／SQL／交易／HTTP／CSV／5/5/5停止期限、fixture全資料、37floors與global92/83/90、五CI及正式TC/UAT不變；不以這12個oracle或本候選結構檢查宣稱通過。全部既有歷史run refs以實際清單hash保存，不硬改歷史數量；9b4d原失敗與27support／六mutations／舊來源結果都不回綁到新PLAN。

採用前需Sam精確DESIGN／PLAN／三檔patch及兩來源scope批准，實作後仍需Sam最終精確來源審閱。TASK041／P4、數值gate、targetFS／production空metadata、shared ServerResponse warning未完成。不含證據匯出、commit/push/PR/merge、CI豁免、P5、正式驗收或部署；後續跨模型依APR291全面略過。


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

- HD170／HD171明確繼承FR094／DES007／TC008：真實Opening writer及其API／worker接入鏈須在P5驗證COUNTING與READY的persistent Bin lock拒絕、實際等待後current read、全交易零部分效果。只有原生worker／真API與DB效果證據可計入，不能以mock writer、404或N/A替代；未完成則本Task及P5 gate不得DONE。

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

- HD170／HD171明確繼承FR094／DES007／TC008：真實Opening writer及其API／worker接入鏈須在P5驗證COUNTING與READY的persistent Bin lock拒絕、實際等待後current read、全交易零部分效果。只有原生worker／真API與DB效果證據可計入，不能以mock writer、404或N/A替代；未完成則本Task及P5 gate不得DONE。

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

## P3 fresh-main integration contract — owner adoption candidate

This integration preserves the single `inventory-p3` merge group and TASK026–034 scope. Main target is `9e9b0ff9ad87846a32036fc86138a834bdb5c82a`; current P3 source is `0cbbea162a3e377df50214fd63b2484b0585d68a2be8dc52ee1615d8b013178c`. These are candidate inputs, not a declaration that integration or approval occurred. A changed target requires a new bounded diff and affected-scope reapproval; a Supplier-only bookkeeping advance may be mechanically reconciled without expanding product authority.

Adopt only Inventory design §5.7.2's reserve-only Backorder sibling, with two worker command types, server-injected registration callback, NULL user, fixed job identity, current DB-clock fenced lease and original root/child replay membership. Manual `sales.mgmt` reserve/release contracts and their operation hashes remain unchanged. No new HTTP Inventory endpoint, human role grant, Inventory DDL, worker release or scheduler activation is authorized by this specification.

Preserve P3 strict input coercion, idempotency preparation and credential-free guarded replay together with main's authorization preflight and optional 202 `Retry-After`. The replay header belongs inside `sendReplay`, reached only after the preparation callback authorizes sending; pass the route options through both callers. A denied callback sends no replay body, flags, header or success log. Ordinary routes remain unchanged apart from main's already-declared optional header behavior. Use main's exact lockfile (`shell-quote` 1.12.0); no forced upgrade, new dependency or regenerated lockfile.

### Developer execution and evidence

Main also adds only `ItemLookupService.searchForSale` relative to this worktree. Import its exact main bytes and rebind the consumed-source hash; existing Inventory transaction lookup methods remain unchanged. Full root Item/Sales lookup tests, native Item compatibility and the new Sales suite must verify this consumed baseline. No authored Item implementation or caller behavior change is included.

All existing phase suites, commands, discovery floors, zero-skip rules, global 92/83/90 and all 34 per-file floors remain unchanged. Add three DEVELOPER-only JUnit suites to PHASE-004: `inventory-p3-sales-compatibility`, `inventory-p3-customer-capacity` and `inventory-p3-core-capacity`. The profile contains their exact argv, tools, env allowlist, result paths and timeouts. These strengthen, never replace, the original 20 suites. The existing task-local suites, full functional compatibility, full native server/client coverage, guarded-skip reconciliation and real16 plus ordinary18 Playwright remain required. Consumer TC names are not Inventory formal acceptance IDs.

Sales compatibility executes main's exact worker unit contracts and complete native Confirmation/Backorder integration files against an owned fully migrated synthetic schema. Check fixed registration, lease expiry/takeover/abort/stop, partial/zero ATP, replay membership and caller rollback; preserve manual reserve/release and current revocation. Do not rewrite Sales source or assertions. Core capacity uses a separate empty `erp_inventory_task018_*` schema with unchanged 100k SKU/500k Bucket/2M Movement, concurrency20/rounds5, indexed EXPLAIN, p95<2 seconds and two-connection rollback. Customer capacity uses a separate fully migrated synthetic schema, unchanged10k import, total<10 minutes, API p95<2 seconds, zero errors/lock waits and heap growth<256MiB. These two native wrappers discharge the four previously unexecuted capacity obligations only after their complete assertions actually pass; no reduced fixture or waiver.

The capacity/consumer fixtures use loopback TCP configuration. A coordinator must positively verify a new owned MySQL26.7.0 instance, exact schemas, loopback-only binding and port ownership before enabling the flags; refuse `erp_dev`, shared/prod schemas, default credentials fallback or external hosts. P3's existing socket-only fixtures retain their original isolation checks. Serial execution avoids competing writers; synthetic Customer/Supplier rings remain process-only and redacted. Existing migration files alone may be executed in the owned schemas; observe the exact current ledger and reconcile migration-count assertions with that list, not historical70/66-row values. Any new DDL, fixture/assertion change or product defect outside the reviewed patch requires scoped remediation approval.

New runs use the generic runner's actual private `evidence/<run-id>` paths, native reports/argv and one actually owned coordinator runtime. Preserve all348 historical references and report bytes under their original source/PLAN/runtime IDs; do not move, relabel or import them as current-main passes. No generic Harness change or evidence adapter bypass is proposed. Standard new reports avoid the old nested-path convention. The generic MERGE_READY gate is evaluated while the recorded runtime resources are actually reserved and owned; retired resources cannot be described as live. Missing report, tool, scope permission, runtime, mandatory assertion, capacity evidence or current-baseline check blocks publication/merge.

### Publication and final review

Only after actual human adoption and scoped implementation authority: preserve the dirty P3 work in a local savepoint, integrate freshly checked main in the dedicated worktree, apply only the reviewed resolutions/rebinding, run the new-baseline developer cycle, then commit/push and open the single P3 PR under publication authority. A preparatory savepoint is not a verified publication candidate. Classify exportable evidence and exclude secrets/raw credential captures before staging.

The exact final candidate needs all five mandatory CI checks and independent Sam source review, plus generic MERGE_READY and an unchanged/reconciled main target. Candidate or target changes invalidate dependent evidence/review; do not infer final-head approval from adoption of this proposal. Final merge requires separate exact-head Sam approval. Clean the owned runtime, merged branch and worktree only after observable successful merge and dependency checks. No P4 implementation, formal Technical/UAT/business acceptance or deployment is included.


# Purchasing provider independent delivery — PROPOSED

本增量不關閉TASK041／TASK048／P4／P5；詳細案例與範圍見 [provider plan](implementation/purchase-provider-plan-v1.md)。
詳細計劃內容 SHA256：`d7106522cba405482c9e93bd662b196f7bd36e594220f7b72825255111978b8d`；此pin將案例與精確執行說明綁定本PLAN，不能只改addendum而沿用批准。

## PHASE-007 — Purchasing receipt

### Outcome
交付provider v1的receipt，保持caller原子交易。

### Entry criteria
精確DESIGN／PLAN獲Sam批准；以最新main建立獨立worktree。

### Acceptance criteria
[詳細計劃](implementation/purchase-provider-plan-v1.md)中TASK-052全部必需案例實際通過、零skip；原資料量／期限／最低權限不放寬。

### Integration and regression
08_traceability.json的本phase developer_suites、當前CI及相關transaction／rollback／200行回歸必需；P4未合併能力聯合驗證另追蹤，不以fixture偽稱完成。

### Git and merge plan
DEFAULT分支，PR-A；Sam精確來源審閱、實際獨立review、當前CI及最新main整合檢查通過後，依既有授權合併並精確清理已合併branch/worktree。

### Rollback
關閉新consumer寫入，保留持久Operation／Movement／Audit及原結果查詢；不drop歷史資料或fallback generic。

### Exit criteria
實際merge SHA、ABI／migration／證據交接。未有consumer真實接入測試前不宣稱Purchasing已解鎖；不等於正式TC/UAT或部署。

## TASK-052 — Purchasing receipt implementation

### Goal
實作provider v1精確範圍，不引入P4依賴。

### Approach
確定性TDD→最小真MySQL／auth→完整200行／並發→最終gate；每次先記影響與重驗理由。

### Acceptance criteria
[詳細計劃](implementation/purchase-provider-plan-v1.md)的TASK-052條件及profile精確suite全部成立，任何缺證保留NOT_RUN／FAIL。

### Definition of Done
實際來源審閱、專用測試零skip、原coverage／CI／回歸通過、合併與consumer交接可追溯。正式TC/UAT另行執行。

## PHASE-008 — Purchasing partial reversal

### Outcome
交付provider v1的partial reversal，保持caller原子交易。

### Entry criteria
精確DESIGN／PLAN獲Sam批准；PHASE007已合併，再從最新main建立獨立worktree。

### Acceptance criteria
[詳細計劃](implementation/purchase-provider-plan-v1.md)中TASK-053全部必需案例實際通過、零skip；原資料量／期限／最低權限不放寬。

### Integration and regression
08_traceability.json的本phase developer_suites、當前CI及相關transaction／rollback／200行回歸必需；P4未合併能力聯合驗證另追蹤，不以fixture偽稱完成。

### Git and merge plan
DEFAULT分支，PR-B依賴已合併A；Sam精確來源審閱、實際獨立review、當前CI及最新main整合檢查通過後，依既有授權合併並精確清理已合併branch/worktree。

### Rollback
關閉新consumer寫入，保留持久Operation／Movement／Audit／links及原結果查詢；不drop歷史資料或fallback generic。

### Exit criteria
實際merge SHA、ABI／migration／證據交接。未有consumer真實接入測試前不宣稱Purchasing已解鎖；不等於正式TC/UAT或部署。

## TASK-053 — Purchasing partial reversal implementation

### Goal
實作provider v1精確範圍，不引入P4依賴。

### Approach
確定性TDD→最小真MySQL／auth→完整200行／並發→最終gate；每次先記影響與重驗理由。

### Acceptance criteria
[詳細計劃](implementation/purchase-provider-plan-v1.md)的TASK-053條件及profile精確suite全部成立，任何缺證保留NOT_RUN／FAIL。

### Definition of Done
實際來源審閱、專用測試零skip、原coverage／CI／回歸通過、合併與consumer交接可追溯。正式TC/UAT另行執行。

# TASK-041 resumption integration / verification order — proposed exact supplement

This supplement supersedes only older blanket wording requiring every unchanged historical check to be rerun after each tool/document change. It does not waive the final frozen-candidate gates or change prior results. Existing HD219/CP13/HD215-CS01 scopes, all production deadlines, full capacity data, zero-skip requirements and formal acceptance boundaries remain.

## Scope and order

1. Preserve the existing P4 worktree and evidence. Integrate exact main `e6398b70e0ce8d32ccfd036a20ec3f5b04d21df3` in isolation; import its provider specifications, trace entries, suites, source pins, lockfile, framework and Item dependency bytes without overwriting P4 additions. Do not rerun a completed external delivery. Preserve receipt1.0/reversal1.1 and migration0101 unchanged;0065 remains the approved stocktake migration.
2. The only new overlapping-adapter implementation resolutions are `server/src/modules/inventory/InventoryAuditService.js` and `server/src/handlers/inventory/skuLookupHandlers.js`, as precisely specified by the design/source sketches. The error translation map is a mechanical additive union. Other P4 implementation changes remain their previously approved scope. Add only `server/test/inventoryStocktakeMainCompatibility.test.js` and `server/test/integration/inventoryStocktakeProviders.integration.test.js` for these new regressions. Main's existing tests and original P4 assertions are retained; if fixture adaptation outside these scopes is required, report the exact additional delta rather than deleting an assertion.
3. Before each increment record impact and revalidation rationale in the existing closeout record. Preserve the already-verified unchanged HD21912-case/six-mutation support results and original per-source reports. Run small compatibility/unit/native transaction checks first. Import main's exact locked dependency security updates and digest-pinned Playwright CI image; use a clean locked installation, and rerun the existing small HTTP watchdog/body/rejection/absolute-budget scenarios affected by undici/body-parser/qs before full load. This is dependency-specific revalidation, not permission to change frozen request code or budgets. For pure tool defects use deterministic/minimal native probes; do not rebuild the full capacity fixture solely to debug an oracle, JWT refresh, asynchronous rejection, sampling, monitor or cleanup helper. Such probes stay supporting-only.
4. After small checks pass and source is frozen, execute original CP01–15 with the complete capacity fixture, then the separately approved CP13/CS01 work as applicable; CP13 is not double-counted as another case. Preserve original ordering/preconditions,7200s characterization and2700s/30-minute steady soak,20actors, all offered/failed/busy/not-sent denominators, original queryp95<2s, SQL10s/transaction20s/HTTP30s/CSV120s,5/5/5 app stop,1Hz/95%/5s CSV/soak sampling. No new production limit or SLA is invented. A failed prerequisite blocks affected load only; preserve the first error and exact cleanup evidence.
5. Final mandatory developer groups are the54 original P4 groups plus10 unmodified current-main purchase groups and2 new compatibility/joint groups(66). Execute the existing full server/client native coverage and original global92/83/90 floors; enforce all39 current main per-file floors, retaining the original37. Use actual current-main native runtime/feature/keyring requirements, including true Fulfillment lifecycle for Sales; never relax an owned-runtime guard or fake CI environment identity. Real Playwright and actual CLI remain required. Do not reuse old-candidate green CI for the new head. Independent bounded reviews, declared SELF increments and actual Sam final precise-source review remain required before normal PR merge.
6. Reconcile still-open numeric resource/write gate decisions, filesystem/empty-metadata operations and shared streaming warning before claiming TASK041/P4 DONE. Do not automatically enter P5/formal acceptance/deployment. Provider delivery and Purchasing production adoption remain separately tracked; issue267 is authoritative for actual delivery, not a fabricated consumer PASS.

## New unit compatibility cases —10, all NOT_RUN

| ID | Required oracle |
| --- | --- |
| MC01 | Main scalar Audit behavior remains unchanged; same validation, parameters and independent outcome paths. |
| MC02 | Main createSucceededBatch retains active caller-transaction ownership and fixed100-row flush behavior. |
| MC03 | P4 recordSucceededBatch retains0/1/100 boundaries, original budgets and exact affectedRows proof. |
| MC04 | Main and P4 batch APIs use the same scalar validation, including500 Unicode-codepoint reason bounds and rejection beyond them. |
| MC05 | A later P4 batch insert failure propagates unchanged; no partial completion/commit performed by the Audit service. |
| MC06 | Code lookup keeps existing normalization and consumes a single current Item result without a second profile read. |
| MC07 | Barcode preserves the original raw value and190-codepoint/760-byte/control-character boundaries. |
| MC08 | Neither/both lookup keys, nonstring, empty barcode and malformed Item/UOM projections fail closed. |
| MC09 | Missing base UOM or factor!=1 is rejected; valid minimal Inventory response matches current main projection. |
| MC10 | Existing permission/inventoryTracked/usable/serial decisions remain, with no Item-source write or redundant FOR SHARE. |

## New real MySQL provider/stocktake joint cases —12, all NOT_RUN

| ID | Required oracle |
| --- | --- |
| JP01 | A real started-bin lock rejects receipt batch; no new Operation/Movement/Balance/Audit effects. |
| JP02 | A real started-bin lock rejects partial reversal; cumulative links and original facts unchanged. |
| JP03 | Receipt with one permitted and one locked detail fails atomically across both details, preserving source-event retry. |
| JP04 | Partial reversal with one locked detail rolls back every link/movement/result/owner projection effect. |
| JP05 | Start wins actual Warehouse-lock wait against receipt: committed snapshot/own locks match the serialized winner; receipt fails closed. |
| JP06 | Receipt wins actual wait against Start: Start snapshot includes the complete committed receipt, never a partial batch. |
| JP07 | Start wins actual wait against reversal: original/links remain unchanged and persistent bin lock prevents mutation. |
| JP08 | Reversal wins actual wait against Start: snapshot matches the complete committed inverse, with cumulative cap intact. |
| JP09 | Actual current Reservation contention rechecks full final coverage before stocktake Post; no increased uncovered Reserved. |
| JP10 | Actual Allocation contention keeps per-Bucket allocated floor, including a fixture isolating it from warehouse Reserved coverage. |
| JP11 | Actual merged Fulfillment Issue cannot bypass a started-bin lock; no fake lock reader or partial ledger effect. |
| JP12 | Real stocktake Cancel releases only its own locks; foreign locks remain; identical previously-blocked source event can safely retry with fresh authorization. |

For JP01–12, independent before/after persisted rowsets cover header/scope/lines/locks, Balance/Control/Lot, Operation/Movement/Audit, reversal links and applicable owner projections. Observe actual waits where stated, not timing guesses. Rollback/error branches preserve original errors; exact replay does not mutate results. Successful and deliberately failed native operations must both reach independently proved SQL terminal; unknown/timeout is FAIL, not a later cleanup substitute. Keep product auth rules; synthetic fixtures are explicitly not production consumer adoption. No new shared transaction, Audit ownership or schema policy is introduced.

## Baseline and evidence handling

The candidate patch contains merged canonical metadata/specs and a source-pin reconciliation manifest; it is not yet adopted. Old approval/report hashes remain historical, never edited into new approvals/PASS. New candidate gates are NOT_RUN until executed on its actual integrated source. Unaffected historical results can support diagnostic planning but cannot satisfy a different-current-fingerprint generic Gate. No generic Harness/CI adapter is changed or bypassed.

Native-minimal recovery evidence remains under the module evidence directory before deleting a private runtime; do not use /private/tmp alone as durable proof retention. The previously missing PR-B private archive is a recorded historical limitation, not evidence to reconstruct or relabel. Source, actual CI and minimized merged artifacts remain independently available.


## HD221 — exact ten-file compatibility exception (PROPOSED_NOT_APPLIED)

The attached source patch SHA256 is ecd3a7ea562db748da2e445712ac4b0021427a50eadff7a28850b01e5a5542a7; exact before/after mapping SHA256 is 71ba00056a43072e07ce126554a21e06e4e528f0003a07582ca461a7d5054652. This supplement overrides only those ten file guards; it does not unfreeze unrelated paths/components or alter the66-group profile/commands/environment.

- Product: InventoryStocktakeService Post and addLine scalar Item calls delegate the original tx directly; do not alter the bulk findMany executor or any other SQL/auth/business branch.
- Unit: AuditBatch and PostLookup literal scalar SQL expectations follow current main whitespace; ProfileBatch's synthetic Item catalogue handles discovery plus four owned locking reads, exact IDs/versions/same tx, no duplicated lock clause. Bulk two-query/count/size constraints remain. Empty-association scalar rejection uses the current Item reason while preserving the existing public code and exact bulk reason.
- Native: only Stocktake036, Counts, Flow, Queries, PostBatch and ProfileBatch minimal Item fixture definitions gain items.version/item_skus.version INT UNSIGNED NOT NULL DEFAULT1; positional Item inserts use the explicit original four columns. Preserve all case bodies, data amounts, negative oracles, guarded environment and deadlines. The Queries fixture's existing DEFAULT1-to-DEFAULT 1 substitution remains byte-identical.

Implementation order: verify all ten before hashes; apply exact patch only after Sam approval; first run the three affected unit suites plus existing/new Counts/Post adapters and targeted mutations dropping one required Item lock or restoring the duplicate wrapper. Run affected native036/037/038/039/PostBatch/ProfileBatch groups and actual JP01–12 with independent SQL terminal evidence. Resolve tool observations with deterministic/minimal native scenarios first; do not repeat the full capacity fixture for tool debugging. Product adapter changes require the relevant transaction/rollback/wait regressions and final capacity validation. Freeze the final candidate and run all required66 groups, native coverage/floors, real Playwright/CLI, current CI, latest main check and final Sam exact-source review. No old/source-swapped PASS or not-run PASS is allowed.

Existing observations remain source-bound: MC plus main Audit21/21 PASS; broader scoped unit249 PASS/9 FAIL; actual native JP9 PASS/3 FAIL (JP06 diagnostic/oracle discrepancy, JP09/10 unexpected INTERNAL_SERVER_ERROR, not relabelled PASS); independent Item boundary reproduces ER_BAD_FIELD_ERROR/version and ER_DUPLICATE_TABLE_LOCK3569. Scratch proposed three-unit preview36/36 is supporting only, not an applied candidate Gate. The original native coordinator SQL-terminal UNKNOWN and FAIL are preserved; offline daemon/process/file closure recovery does not replace live SQL or rollback proof. All final new-PLAN/full Gate results remain NOT_RUN until actually executed.

This candidate approval is not final implementation approval, TASK041/P4 completion, formal acceptance, deployment or a claim that Purchasing has adopted the delivered providers.


### TASK-041 HD225 — Independent bounded Stocktake export failure Audit (PROPOSED)

**Authority/status.** Sam authorized preparing the exact candidate only. Until separate exact DESIGN/PLAN adoption, product/test source and canonical files stay unchanged and no new runtime/load is started. This supplement grants no TASK041/P4 DONE, numeric gate, evidence export, commit/push/PR/merge, formal TC/UAT, P5 or deployment approval. Cross-model reviews follow Sam's standing APR291 skip.

**Root cause and impact.** HD224's minimal MySQL26.7 diagnosis3/3 reproduced DATABASE_OPERATION_ABORTED from the original client-close signal; recordFailed returned false/0 rows while SELECT1 remained healthy. The strict AUDIT_WRITE_FAILED false!==true oracle was correct. This is a product failure-Audit lifetime correction, not a tool assertion relaxation. Preserve the original CS01 FAIL, stopped/cleaned runtime and all historical source-bound characterization/100k results. See implementation/task041-hd224-minimal-diagnosis-report.md; its cleared-context control is not the product fix.

**Exact implementation scope, pending adoption:**
- `server/src/modules/inventory/inventoryStocktakeExportAudit.js` — NEW: local facade only.
- `server/src/modules/inventory/InventoryStocktakeExportService.js` — GUARD_EXCEPTION: Audit construction/import only; failure memoization and success work untouched.
- `server/src/handlers/inventory/stocktakeHandlers.js` — GUARD_EXCEPTION: export-kind-only Audit binding/import; every non-export instance unchanged.
- `server/test/inventoryStocktakeExportAudit.test.js` — NEW: 16 deterministic cases/mutations.
- `server/test/integration/inventoryStocktakeFailureAudit.integration.test.js` — NEW: 12 minimal native DB/HTTP cases.

The two existing product files are the ONLY byte-immutable guard exceptions. Shared InventoryAuditService, MySQL service/config, requestTimeout/apiDispatcher/application/ServiceContainer, Item/provider/Stocktake posting/lock code, DDL, auth, CI/dependencies, existing tests, performance helper/CS01 verifier and frozen components stay byte-identical. No monkey-patching shared prototypes or copied Audit serializer. No public route/response change. If the plan cannot be implemented within these boundaries, stop and present one consolidated exact scope difference; do not silently widen it.

**Budget/admission contract.** Implement the HD225 design verbatim: fixed per-attempt5000ms absolute monotonic budget including acquisition/transaction/logger; own signal, live synchronous primary.withTransaction call; one active owner per primary service, no queue or new DB connection pool; any admitted false/timeout retains a quarantine marker until controlled process restart even after original promise settlement, only before-deadline true releases admission, late true cannot become success, indeterminate commit no retry; borrowed resources and existing shutdown budget unchanged. The per-attempt5s, possible sequential10s and cap1 availability cost are new explicit candidate policies, not observed performance guarantees. Never claim bounded OS/SQL termination solely from a bounded Promise return.

**TDD and minimal scenarios first.** After exact adoption, deterministic RED must first catch inherited request cancellation. Cover fake-clock absolute deadlines plus actual loopback/native behavior separately; mutations are support, not native PASS. Native uses a fresh owned MySQL26.7 schema with current real migrations and minimum valid actors/stocktake rows (at most128 synthetic lines, padded legal SKU names to make measured CSV > first chunk), no full capacity fixture. Real app/auth/HTTP routes execute unchanged. Readbarrier/fault observation is test-owned/per-instance, calls original native operations and does not patch shared prototypes or fabricate Audit rows. The incomplete-abort case must positively observe client delivery, hold before the next native read/EOF, and prove unfinished response before abort. No fixed sleep in place of a barrier.

Local ownership is an isolated one-run schema/daemon/socket/root; exact name/account/version/source freeze checked before use. CI uses its existing fresh migrated per-shard MySQL service and DB_INTEGRATION_TESTS=1; no new environment feature switch/workflow is added. New native test is discovered by current Node native test/coverage command, uses unique owned fixture rows, and cleans only those rows/resources (never drops CI's shared schema). Native failures cannot silently skip. Test setup/cleanup must support both observed transports and their real account/grants without DB tuning; if unsupported, report BLOCKED rather than mutate globals. Original 10s SQL/20s transaction and all original HTTP/process limits remain; the new own5s signal is stricter. The timer is cooperative with the Node event loop, not a hard OS/wall-clock interrupt: record actual elapsed/overshoot and do not promise instantaneous return/SQL termination during event-loop starvation. Use a fresh actually shut-down/restarted test application/service per quarantining fault case, not a reset hook or a new facade on the same primary to evade the marker. Timed native assertion observations must record actual elapsed and independently correlate thread/query/transaction/socket terminal facts; observation deadlines never count as proof of termination.

**New DEVELOPER checks.** Append only inventory-task041-export-failure-audit-unit (min16,300s) and inventory-task041-export-failure-audit-api (min12,900s), both zero skipped. Existing67 profile suites/PHASE00566 required suites are unchanged; required phase groups become68. Both use existing Node26/testEnv/JUnit command shape; native allows only reviewed DB endpoint/account/password/DB_INTEGRATION_TESTS inputs, with password redaction. These are planned cases, not formal technical/UAT acceptance or current PASS.

| Case | Required observable contract | Status |
| --- | --- | --- |
| FAU01 | Success stays in supplied transaction; non-export generic instances stay unchanged; no extra service/pool | NOT_RUN |
| FAU02 | Original aborted request stays aborted; independent signal is different and context/claims/deadline never mutated | NOT_RUN |
| FAU03 | DOMAIN/ROUTE trusted scalar input captured before await; exact targets/labels/outcomes/serializer limits unchanged | NOT_RUN |
| FAU04 | Acquisition wait consumes the original 5000ms budget; late acquisition never invokes Audit work | NOT_RUN |
| FAU05 | BEGIN/INSERT wait cannot renew budget; own abort only; exact original business error preserved | NOT_RUN |
| FAU06 | COMMIT indeterminate is false/UNKNOWN with no retry, rollback claim or substituted success | NOT_RUN |
| FAU07 | Late true after deadline stays public false and quarantine persists; original promise observed and late rejection consumed | NOT_RUN |
| FAU08 | Two facade instances share cap1 on same DB; no queue; distinct DB instances remain independent | NOT_RUN |
| FAU09 | Only before-deadline true releases slot; false/timeout plus later settlement still quarantined, captured work dropped only after original settles | NOT_RUN |
| FAU10 | Rejected/throwing/stalled logger is bounded by same absolute budget; false never resets quarantine; safe throttled fallback | NOT_RUN |
| FAU11 | Already closed primary refuses without SQL; borrowed primary/logger/context never shut down | NOT_RUN |
| FAU12 | Live synchronous withTransaction delegation preserves original callback/arguments/observer association | NOT_RUN |
| FAU13 | DOMAIN memoization/ROUTE once-per-request unchanged; separate target rows not deduplicated together | NOT_RUN |
| FAU14 | Boundary success before deadline versus at/after deadline; timer/owned listener cleanup is exact | NOT_RUN |
| FAU15 | Cleanup/fallback errors do not replace original export error; no unhandled late rejection | NOT_RUN |
| FAU16 | Targeted mutations: inherited signal, renewed budget, premature slot release, late true each fail their intended assertion | NOT_RUN |
| FAD01 | Healthy independent DOMAIN/ROUTE writes: true and exact persisted identity/field/row sets; normal success transaction unchanged | NOT_RUN |
| FAD02 | Real signed HTTP client receives first bytes then aborts an export larger than first chunk; barrier before second native read/EOF; exact event-derived rows and true results | NOT_RUN |
| FAD03 | Real stream source failure before EOF: original error plus exact DOMAIN/ROUTE outcomes, original anonymous handle/reader cleanup | NOT_RUN |
| FAD04 | Real permission revocation after first chunk: zero further data, original auth rejection, correct failure/rejection Audit, no authorization bypass | NOT_RUN |
| FAD05 | Pool1 real HTTP abort writes exact rows through original primary; no auxiliary Audit pool/client or hidden second primary connection | NOT_RUN |
| FAD06 | Own blocked pool acquisition reaches own deadline; attempt again BEFORE blocker release and prove busy/no second waiter; release blocker afterward, prove no late INSERT/callback and owned termination; settlement must not reset quarantine | NOT_RUN |
| FAD07 | Own actor-row FK lock blocks actual Audit INSERT; deadline false, independently observed SQL/trx terminal and zero row; no false rollback claim | NOT_RUN |
| FAD08 | Explicitly labelled owned connection COMMIT acknowledgement-loss injection: UNKNOWN/no retry, preserve readback and uncertainty, never promise zero row | NOT_RUN |
| FAD09 | Real DB failure plus test-owned stalled logger: bounded false, cap quarantined; release logger and settle original promise; prove slot STILL quarantined with no new SQL until controlled test-app shutdown/restart | NOT_RUN |
| FAD10 | Two overlapping failures on same primary: exact admitted versus busy-false outcomes/rows, no queued or late write; strict Gate still rejects false | NOT_RUN |
| FAD11 | Actual application shutdown races an admitted attempt: original process budget, no new attempt after closed, persistence or uncertainty reported honestly, owned SQL/socket terminal | NOT_RUN |
| FAD12 | Real busy503/non-export failure and ordinary clean export regression: original DOMAIN/ROUTE multiset, generic Audit cancellation unchanged; no stock/Operation/Movement/lock side effects | NOT_RUN |


**Affected verification and evidence applicability.** Before each future edit name affected sources/dependencies/commands/environment/semantics and its smallest disproving check. Tool-only edits first run deterministic tools and affected minimal native scenarios; product Audit edits require these28 cases plus existing InventoryAudit/unit, handler/dispatcher lifecycle, TASK039 native/API/export recovery, TASK040 actual browser and no-effect transaction regression. No product Post/lock/quantity SQL was changed, so do not use full500k fixture merely to debug a logger/timer. Confirm source-bound unchanged evidence applicability; retain old report bytes/source/PLAN identities. Existing evidence never becomes new candidate PASS.

Full load remains STOPPED: neither this candidate preparation nor its future adoption automatically authorizes another CP/CS01 full run. After small checks pass, report exact results and request the explicit later full-load disposition required by Sam's stop-on-failure instruction. At the separately authorized final frozen candidate, ALL68 applicable developer groups, original full capacity/soak data/offer denominators/deadlines, native merged coverage and current39 floors/global92/83/90, actual Playwright/CLI, current candidate CI, latest main integration, independent bounded review and Sam exact source review remain mandatory. Keep all existing formal TC/UAT and other P4 blockers (numeric gates, target filesystem/empty metadata, shared listener warning). No waiver, reduced rows/thresholds, delayed deadline, invented PASS or duplicate run-index import.


### TASK-041 HD227 — Performance developer-driver fail-fast amendment (PROPOSED)

**Status and reason.** Precise candidate only; NOT_APPLIED, no source/test/canonical adoption or capacity/soak load. HD226's one original full-load allowance has NOT been consumed: latestmain6cdc was integrated safely, PLAN_READY passed, and unaffected current FILES-only checks run separately. Node's installed JUnit reporter yields case XML only after consuming the complete event source; the current Characterization runner schedules remaining cases after failure; current CS01 failed() sets firstError without breaking1920warmup/28800steady offers. Do not claim failure-stop coverage from buffered XML or journal recording alone. This is a developer-tool control correction, not an Inventory product defect or new100k Post failure.

**Exact future source scope (three paths):**
- server/test/performance/inventoryStocktakeCharacterization.performance.test.js — rename imported node:test binding and wrap registration only; retain all15 original case callbacks/options/order and after cleanup byte-identically.
- server/test-support/inventoryStocktakePerformanceChild.js — only createStocktakeSoakLane and runStocktakeResourceSoak gain first-failure admission/dispatch/producer-stop and failed-prefix/remaining-denominator reporting. All other ranges/legacy frozen components, request watchdog, owned stop, monitor/deadlines, DB/auth/CSV/Audit/oracle functions remain byte-identical.
- NEW server/test/inventoryStocktakeFailFast.test.js —12 persisted deterministic/controlled loopback scenarios on extracted actual functions and a private real node:test child. No copied replacement workflow or fake native PASS.

This explicitly unfreezes the two existing test-tool paths/ranges only. No product, main source, Item, framework, CI/config/dependency, migration, existing test body/assertion, profile command/env/minimum/timeout or original footprint gate changes. If those bounds cannot implement the approved behavior, report one consolidated exact difference before writing outside them.

**DEVELOPER suite.** Append inventory-task041-fail-fast-unit with existingNode26/testEnv/JUnit command shape,300s/min12/maxSkipped0/FILES-only; append its PHASE005 relation. Original68 suite objects and order are unchanged. Existing Characterization15/min15/7200s and CS01min1/2700s keep exactargv/env/limits. Current69 final mandatory groups cannot PASS with any failed/blocked/unexecuted required case. No formal acceptance case is marked executed.

| Case | Required observable result | Status |
| --- | --- | --- |
| FF01 | Healthy Characterization preserves all15 callbacks/order/options/results and after cleanup exactly once | NOT_RUN |
| FF02 | Real private node:test child: assertion and runner timeout while callback pending each block later bodies; explicit NOT_RUN/skip cannot PASS; normal completion abort still permits all healthy callbacks | NOT_RUN |
| FF03 | Synchronous throw, async rejection and runner cancellation latch original result; normal post-completion signal abort is harmless; lingering callback/SQL is UNKNOWN, not stopped | NOT_RUN |
| FF04 | Expected injected fault whose existing case oracle succeeds does not stop later cases; no success workload/threshold change | NOT_RUN |
| FF05 | Warmup failure stops producer before and after scheduling await; exact1920 planned prefix/remainder and zero later offers | NOT_RUN |
| FF06 | Steady minute-check failure stops next actor/tick; exact28800 planned prefix/remainder, no fabricated full1800s PASS | NOT_RUN |
| FF07 | Stop while JWT refresh preparation is pending: no new refresh/send/actor turn after admission closes; actual prior dispatch remains observed | NOT_RUN |
| FF08 | Competing failure/signer microtasks: lane latches/notifies before rejecting, later signer cannot fetch even before outer catch runs; preserve intended actor/family/tick denominator and release preparation reservation exactly once | NOT_RUN |
| FF09 | Notifier failure preserves original error; actual dispatched loopback request may settle under original deadline; outcome retained; no NOT_SENT relabel or implicit retry/rollback | NOT_RUN |
| FF10 | Failure drain uses original allowance once and earlier absolute deadline; later cleanup failure cannot reset clock; UNKNOWN remains failure | NOT_RUN |
| FF11 | Failed prefix retains original first error, per-request evidence, worker/socket/SQL unknowns; global after/fixture.close still runs | NOT_RUN |
| FF12 | Targeted mutations continuing next case, continuing offers, post-sign late send, resetting drain budget and losing remainder are detected; all original frozen/body pins unchanged | NOT_RUN |

**Coverage execution ordering.** Existing inventory-p3-server-coverage is unchanged unit-only argv; inventory-p3-coverage-floors remains mandatory but waits for the actual complete current native LCOV, exacthash copied into its ignored default path. Native global92/83/90/floors39 are neither evaluated on a partial unit report nor waived. Preserve HD226's first9 typed PASS and the caller's premature partial-coverage assertion FAIL as separate original observations; do not rewrite either. Existing reviewed native coverage workflow supplies final input, with guarded skips NOT_RUN and every separately required native group zeroSkip; no unseen command/env/collector or genericHarness change is smuggled into this proposal.

**TDD and applicability.** After exact Sam adoption, deterministic support first, then minimal real loopback/private-child validation; these12 are developer tool evidence, not CP/CS01 PASS. Freeze final source after small checks. Preserve HD22516/12/369 and all current FILES-only results under original source/PLAN; confirm actual dependency/argv/env/semantic applicability rather than rewriting their identities or blanket rerunning full capacity for a docs change. The generic final Gate still needs valid actual current-candidate evidence; do not invent a cross-baseline adapter or fake typed result. All performance gates remain NOT_RUN until explicitly authorized/adopted and actually executed. If Sam permits continuation with this precise amendment, run the original one full cycle with preserved data/deadlines and stop on first unexpected performance failure. Any failed Gate ends related fixes/retries/load/merge pending Sam disposition; only preservation/read-only diagnosis/exact cleanup continue.

**Remaining boundaries.** Last test-tool implementation still needs actual review and final Sam exact-source disposition. No TaskDONE/P4close, publishing/PR/merge, evidence export, CI waiver, numeric resource gate, target-filesystem/metadata or shared warning disposition, P5, formalTC/UAT or deployment is granted. Purchasing delivery remains separate. Unaffected checks are recorded honestly; this candidate is no runtime success.


### TASK-041 HD228 — proposed module-scoped developer Gate binding remedy

PROPOSED_NOT_APPLIED. This is one consolidated major Gate decision, not a product fix. Actual current source956a8611 has33 FILES groups and15/15 Characterization/CP13 PASS at PLAN44f7a236, with positive native cleanup. These34 groups have two actual runtime IDs, so unchanged generic evidence_issues cannot accept all of them together. Its final cleanup strips resource fields as well. Do not relabel reports or repeatedly reconstruct full capacity fixtures to debug this tool constraint.

Canonical scope: design10.6.11, derived provided-design pin/version in manifest, this verification plan, two new profile suites and two PHASE005 relations. Source scope after approval: NEW server/scripts/inventoryPhase005Gate.py (read-only verifier plus minimal-native wrapper), NEW server/scripts/inventoryPhase005Gate.test.py (32 deterministic tests/HARNESS_JSON), NEW server/test-support/inventoryPhase005GateNative.mjs.txt (exact Node native source copied byte-identically to own run_dir .mjs;4 real cases/JUnit), and only one new unit-test step in existing .github/workflows/ci.yml Lint job. No installed Harness, package/lockfile, product/Item/provider, migration, old test/helper/case or original69 command changes. Source artifacts/pins and raw input snapshots are reviewed explicitly, including unknown dependencies.

Read-only adapter command: {python} server/scripts/inventoryPhase005Gate.py --gate MERGE_READY --phase PHASE-005 --module docs/inventory_management --repo-root . --harness-scripts /Users/sam/.agents/skills/software-engineering-harness/scripts --json. Require audited actual Harness hashes/version; no fallback implementation, context monkeypatch, fabricated result or suppressed unknown gate issues. Record generic result separately and emit distinct INVENTORY_PHASE005_MERGE_READY only when every required control and exact per-binding proof succeeds. Tasks remain IN_PROGRESS / P4 NOT_READY until all original obligations, remaining numeric/filesystem/metadata/warning contracts and final human/source gates actually finish.

New DEVELOPER inventory-task041-gate-binding-unit:32 cases, maxSkipped0,300s,FILES, Python standard library only, actual HARNESS_JSON test report. CI runs these same deterministic cases inside required Lint job; it does not claim native success. Cases include32 real oracle assertions with at least8 positive and24 negative boundaries, targeted mutations of runtime/source/PLAN/count/latest-error checks, and exact restoration; no fake Inventory testing.

Required deterministic matrix (32 persisted unittest cases; all fixture results are verifier-unit evidence only):

| Case | Required distinct boundary |
| --- | --- |
| GB-U01 | Exact current run/inputs/resource proof accepted |
| GB-U02 | Historically distinct normal-clean runtime accepted with all actual proof |
| GB-U03 | Exact disclosed33-FILES recovery accepted only with adoption/complete original receipts |
| GB-U04 | Exact approved Gate-only PLAN patch, unchanged original suite contract |
| GB-U05 | Exact three-tool/CI source delta with proven original69 input closure |
| GB-U06 | New two checks require their own exact current code and inputs |
| GB-U07 | Independently proven unrelated document input change records applicability, not a new test run |
| GB-U08 | Later exact applicable PASS after a genuinely earlier FAIL, preserving both originals |
| GB-U09 | Missing required actual run blocks |
| GB-U10 | Wrong module/suite/stage blocks |
| GB-U11 | Changed argv/cwd/contract/tool pin blocks |
| GB-U12 | Changed validation/minima/data/threshold/deadline/skip semantics blocks |
| GB-U13 | Malformed/duplicate/report-count/case metadata blocks |
| GB-U14 | Missing or tampered original artifact/path/symlink escape blocks |
| GB-U15 | FAIL/timeout/forbidden skip/not-run/insufficient discovery blocks |
| GB-U16 | Later equivalent failure cannot select earlier green |
| GB-U17 | Earlier applicable PASS then later FAIL with UNKNOWN equivalence blocks |
| GB-U18 | Missing before/after source/spec freeze or excluded script/data fixture pin blocks |
| GB-U19 | Arbitrary source change or unknown dependency cannot gain applicability |
| GB-U20 | Old CI/head/human/source review cannot become current authority |
| GB-U21 | Wrong owner/workspace/tool/config/data identity blocks |
| GB-U22 | Unapproved or missing actual resource receipt blocks |
| GB-U23 | Live/unknown worker/SQL/trx/lock/socket terminal blocks |
| GB-U24 | Callback/destroyed/cancel/empty-table alone cannot prove terminal/rollback |
| GB-U25 | Fictitious shared runtime or normalized/relabelled original record rejected |
| GB-U26 | FILES recovery exception applied to native UNKNOWN or absent approval rejected |
| GB-U27 | Other core issues (CI/task/dirty/boundary/authority) and unknown issue codes remain blocking |
| GB-U28 | Changed adapter-source checks cannot borrow the old69 infrastructure exception |
| GB-U29 | Partial LCOV/missing original floor/global/browser/CLI proof cannot close Gate |
| GB-U30 | Other phase/formal/release escalation rejected |
| GB-U31 | Invalid/future timestamps or unproven external/advisory data equivalence blocks |
| GB-U32 | Installed Harness drift or missing exact adapter-code final review blocks GateReady |

Four minimal true-resource cases: GB-N01 verifies actual private MySQL26.7/schema/socket and a real owned transaction/rollback; GB-N02 rejects an actual still-open owned probe connection/transaction as incomplete cleanup and verifies disappearance after its own close; GB-N03 rejects a second actually owned but mismatching schema/identity without touching unrelated resources; GB-N04 verifies actual controlled loopback/own SQL/socket terminal and precise own cleanup. These are not real foreign-user interference or Inventory business/soak PASS. Actual outer daemon/schema/FD cleanup receipts remain required separately.

New DEVELOPER inventory-task041-gate-binding-native:4 cases, maxSkipped0,600s,FILES/ISOLATED_DATA; minimal actual MySQL26.7/Node26 and controlled local resources, never reduced full-capacity substitutes. Guard DB_INTEGRATION_TESTS=1 plus INVENTORY_GATE_BINDING_TESTS=1, private task041-gate-binding-mysql-2670.<unique> socket, own erp_inventory_gate_binding_<hex> schema family only. Verify actual DB identity, own transaction/rollback facts, reject live/foreign/unknown resource and wrong-identity facts, and exact own cleanup/SQL/socket terminal. Not a product stocktake/soak acceptance test.

Before each edit identify affected source/dependency/command/env/semantics and smallest disproving case. All69 old suite objects/order, original data, zero-skip/minima, SQL10s/transaction20s/HTTP30s/CSV120s, Characterization7200s/CS012700s, 20actors/30minutes/once180s drain, p95<2s,39floors/global92/83/90, CI/protection/review/formal controls stay intact. Original69+2 new=71, not a replacement for unexecuted groups. No automatic heavy rerun due solely to administrative baseline/runtime metadata; unknown input applicability blocks affected checks.

Adoption includes only the exact disclosed33-FILES recovery applicability disposition, never an unseen implementation approval or conversion of original UNKNOWN/FAIL. Last mechanical HD227 cwd-path repair remains root SELF and final Sam source review remains required. Cross-model checks remain permanently skipped under Sam APR291. Local isolation/cleanup uses existing authorization. After small validations, remaining once-authorized original Gates may continue under the condition above, but no new Characterization or performance retry, publication/PR/merge, evidence export, formal acceptance/P5/deployment is granted.


### TASK-041 HD230 — concentrated CS01 preflight tool repair candidate

PROPOSED_NOT_APPLIED. Actual source1e9b7b43/PLANdcce2cfc completed current32+4 small checks, then CS01 typed1FAIL/0PASS before native fixture:39 supporting checks yielded38PASS/1FAIL. The legacy signing-rejection oracle expected a subsequent send1/request2; the already approved fail-fast lane correctly producedsend0/request1. Original typedFAIL/outerUNKNOWN remain, separate exact external recovery verified all17Inventory tables empty, no other SQL/trx/locks, owned schema/PID/socket/FD/root gone. Do not claim normal original daemonexit0 or application rollback from that recovery.

Only unlock server/test/performance/inventoryStocktakeResourceSoak.performance.test.js regions in the exact candidate source patch: signing-rejection assertions, scalar failure diagnostics, and pre-native reporting catch. Keep original39check bodies otherwise, original native callback after the supporting prefix, all case/fixture quantities and deadlines, and the existing helper/product/Item/auth/DDL byte-identical. Existing three Gate-tool paths remain the only verifier implementation scope; fix ignored dependency proof fail-closed there and add corresponding assertions within32 cases. No new suite, command, env key, reduction or installed-Harness change.

Small-first order: actual preserved error reproduction -> candidate39/39 deterministic plus mutation retaining both offers and no later HTTP -> structured pre-native report/original-error test -> verified installed-input receipts -> current32+4 and per-suite applicability -> once-authorized original CS01/remaining Gate. No full fixture for tool debugging. Native failure before its normal report may clean only after typed FAIL plus source-bound structured NO_NATIVE_WORK_STARTED proof and independent resource checks; unknown app/SQL stays retained/blocked.

Original Characterization never automatically reruns. Its prior case successes remain; unrecorded old installed dependency bytes cannot silently become equal to today. A historical applicability claim without complete proof must remain UNKNOWN, and final Gate cannot close despite completing other groups. Preserve original69+2=71, all39/global coverage thresholds, actual Playwright/CLI, current-head CI/latest-main and final independent Sam exact-source review. No final source/DONE/merge approval is implied.


### TASK-041 HD231 — minimal Draft Create lock-range remediation candidate

PROPOSED_NOT_APPLIED. Exact incremental scope: InventoryLockService.js new lockForStocktakeDraftCreate method only (existing lockForCommand/helpers byte-identical); InventoryStocktakeService.js createInTransaction only; new inventoryStocktakeDraftLockRange.test.js and integration/inventoryStocktakeDraftLockRange.integration.test.js; inventoryStocktakeService.test.js only its fixture locks object adds new method simulation, retaining every case/assertion/old method/call recording. No other edits to old tests/helpers/DDL/Item/shared transactions or other service methods. Existing three Gate-tool paths retain prior authorization only, with no expanded semantic equivalence or missing-proof exception from this candidate.

Observed baseline ce673c47/HD230 retains current small PASS and CS01 actual FAIL, matching scopeINSERT1213 and SQL-terminal UNKNOWN; small causal graph/peer and exact cleanup are separate evidence, not original-run rewrite. Authoritative causal report: implementation/task041-cs01-mixed-history-root-cause.md. Temporary diagnostic barrier/statement timeouts are not product deadlock repetitions or successful negative controls.

One transaction order for Create: validate/source claim -> Warehouse/Bin row locks -> callback bin/scope exclusivity + currentauth -> header and ALL scope INSERT -> unchanged current activeBinlock read/reject -> currentauth again -> Audit/completion -> caller commit. All checks/locks retained. No perBin insertion/check interleave, early receipt, newtx/connection, weaker isolation, skip flag, global mutex or automatic409retry.

Two new DEVELOPER-only suites, 12 unit +14 small native, zero skip; node26/MySQL26.7, guarded fresh schema erp_inventory_task041_draftlock_*, private socket /private/tmp/erp-inventory-task041-draftlock-mysql-2670.*/mysql.sock. Existing local runtime/migration/precise cleanup authorization applies to synthetic existing migrations; no newDDL or deployment. Native coordinator must preserve failures/graphs/source freeze and separate actual terminal proof from recovery. No diagnostic report self-label becomes typedGatePASS.

Unit obligations:
1. Empty/invalid/noninteger WH/Bin and missing callback/executor fail before SQL; original normalize/sort/dedup semantics retained.
2. One-warehouse Draft-only method locks Warehouse then all requested Bins before exactly one callback; existing lockForCommand byte-identical.
3. Callback receives same tx and actual locked rows; method creates no tx/commit/retry/isolation or connection.
4. All header and ALL scope writes precede first active-bin-lock read, including multiBin; no perBin insert/check interleave.
5. Existing active lock is rejected after callback and before Audit/completion; returned IDs never escape a failed tx.
6. Invalid WH/Bin/membership, Draft overlap or before-write auth stops callback before writes; business validation unchanged.
7. Callback throw/first or later scope failure propagates original error; no bin check/finish/commit follows.
8. Final current-auth failure is rejected before Audit/completion; entire transaction rolls back. Unit fault injection is not proof of concurrent revocation committing through retained SHARE locks.
9. No active rows returns draft metadata; release/status/ownership checks not removed or replaced by snapshot read.
10. Native SQLdeadlock/timeout retain existing concurrent mapping; no automatic retry or accepted409.
11. Same-source replay returns original result and current auth; new callback/write not repeated.
12. Audit/operation completion throw rolls back whole create; shared helpers/old lockForCommand and other service methods unchanged.

Native obligations:
1. Reproduce original-product exact scopeINSERT gapcycle with actual observed holds/waits/1213 on unfixed source; save victim, peer, graph before teardown.
2. Fixed controlled two-warehouse Create/Start same fixture/barriers has both actual commits and complete own state; no injected SQL success, no weakened oldassertion.
3. Natural two-warehouse mixed Create/Start with terminal history and200emptyBin exporter; SQL counts/times/wait identities recorded, notfullcapacity.
4. MultiBinCreate writes allscopes beforeactivecheck; later matchingactive lock rejects entireoperation/header/allscopes/Audit.
5. SameBin Create/Create exactlyoneDraft winner, loser no orphanoperation/header/scope; no overlappingDrafts.
6. DraftReplace/Create overlap sameWarehouse serialization and waited current-read preserves exclusivity.
7. Start-first/Create-first sameBin bothdirections enforce existing Draft/persistent-lock protection and real Warehouse wait.
8. Receipt/Issue/Move blocked by active stocktake locks; ordinary Draft still doesnot create persistentlock or block those writers.
9. Two real revocation schedules: committed before pre-write currentauth means reject/fullrollback; attempted after pre-write FOR SHARE must show actual auth-row wait and serialized completion after Create, not impossible midwait commit. In both applicable schedules assert final currentauth is after final activeBinread and before Audit/completion; controlled pause and realSQL wait are labeled separately, no fake auth result.
10. Same-source concurrent Create/replay yields original scalar once; payload mismatch retains prior conflict, no duplicateeffects.
11. Header/secondscope/latecheck/Audit/operationcompletion fault points each rollback allcreatedrows; retain originalerror.
12. Inactive/mismatched Warehouse/Bin reject; failedcallback/SQL leaves no client loan or latework; original deadlines.
13. Compare all unaffected tables and foreignlocks before/after everynegativecase; foreign rowbyte identities retained.
14. Actual process/socket/connection/transaction/lock terminal0 and exactownedcleanup; absenceofmap/lateworker/unknown rejects report; no normalclose boolean asproof.

Revalidation impact: targeted new cases then all affected035–041 Create/Start/Count/Ready/Post/Cancel/auth/API, purchasing receipt/reversal and Reservation/Move lock/rollback regressions. Existing lockForCommand unchanged is byte-checked, not a substitute for calling-writer regression. Original71 groups+2 additions=73 remain. New/affected tests are NOT_RUN now; original successful runs remain only on their true scope/source, no blanket administrative rerun or baseline hash swapping. Keep no Char rerun; original Char's changed Create section is not automatically current proof, and final readiness remains blocked where current applicability cannot be shown. Complete required fullGate/coverage/browser/CI/main/source review later only under valid authorization; no full-load retry is granted by adopting this candidate. Full workload remains stopped until explicit separate disposition, with any performance failure stopping again.

### TASK-041 HD233 — concentrated Gate-tool completion candidate

PROPOSED_NOT_APPLIED; adoption and later implementation are different decisions. Sam authorized preparation only. Parent sourcea1a3109e/HD231 DESIGNf81a3bf8/PLAN4101de16 has six actual typed increment runs approved by SamHD232; all73 required groups are not currently proved. Preserve the HD23273-row inventory and all actual oldPASS/FAIL/UNKNOWN. Never describe this as an unresolved100k Post defect: historical three-run100k success and later Char15/15 remain true at their original identities; current CS01 remains failed/stopped and historical installed-dependency applicability remains incomplete.

Precise canonical scope: append design10.6.14, this TASK041 supplement, provided-design manifest pin/version and ONLY Gate-unit profile min_tests32→48. The other73 profile objects (74 profile suites total), the unit's other fields, all73 PHASE005 IDs/order and trace/matrix stay byte/semantically unchanged as applicable. No CI workflow, package script, new group/env/command/deadline or formal TC/UAT change. Existing Lint CI executes the expanded standard-library test file unchanged.

Incremental source scope after adoption:
- server/scripts/inventoryPhase005Gate.py: precise adopted-baseline/canonical proof, three original HD231 recipe collectors plus reviewed Gate minimal recipe, complete installed-input/attempt/source classification and coverage provenance; add bounded-scope read-only --receipt-preflight/--suite mode as defined in design. Preserve original generic result and direct evidence_issues/current Context, remaining original issues and distinct project readiness. Not a universal evidence/runner framework; no writes, migrations, business command, cleanup, trusted-JSON import or state monkeypatch.
- server/scripts/inventoryPhase005Gate.test.py: preserve all existing32 persisted methods/bodies/assertions; add the following16 named cases using synthetic verifier fixtures only. Metadata/docstring may identify the expanded range. Real installed Harness/DB are not silently mocked into Inventory success; all fixtures are labelled verifier-unit data.
- server/test-support/inventoryPhase005GateNative.mjs.txt: preserve four named real cases and all old assertions, strengthen collector-boundary checks within them; actual copied .mjs remains byte-identical to source. No fifth native case, reduced data, shortened oracle or longer deadline. Actual outer producer must be captured/reviewed before execution and normal terminal proof kept separately.
- docs/inventory_management/implementation/task041-hd233-small-runtime.mjs.txt: ONE local-only explicit execution-coordinator scope exception, derived from the pinned archived hd231-small-coordinator.mjs bytes. Only adapt suite/profile selection for48+4, Guard-native schema/socket/env, original typed-result/report binding, actual IPC-child ownership proof, complete input snapshots and original state_tool CAS registration of exact returned typed paths/hashes (including actual FAIL); keep existing ownership/lifecycle/deadline/terminal/cleanup/first-error controls. Gate-native starts a real IPC child, so do not reuse the direct-suite no-child assumption: require actual ownedStops/ownedSql identity and independent terminal proof before clearing innerMayBeRunning. Keep state history/approvals/raw bytes unchanged; preflight itself never registers or writes state. A byte-identical own .mjs copy executes after adoption and exact coordinator review, never while preparing. Record its actual executed hash before/after; no arbitrary private helper/fallback runner. This fourth path is included because a true outer-receipt positive cannot be produced inside the native test that has not yet completed. It is not evidence export permission.

| New unit | Required distinguishing boundary |
| --- | --- |
| GB-U33 | Six-run a1→candidate narrow administrative mapping accepts only unchanged original suite/complete installed inputs and reviewed observational hash-read roles; raw source/PLAN remain original. |
| GB-U34 | 956a→a1 product Create/Lock change cannot become a Gate-only exception; historical missing installed bytes stays UNKNOWN. |
| GB-U35 | Any undeclared path, executable dependency, mode/symlink/target or extra canonical/profile delta rejects the mapping. |
| GB-U36 | Adapter suites require exact current inputs; Lint/broad discovery/actual Gate import cannot borrow six-run exception. |
| GB-U37 | Real-shape archived unitEvidence/native typedEvidence pair binds two distinct actual commands/runs to one fully encompassing runtime; original CAS registration is required, missing/changed/unregistered unit binding rejects. |
| GB-U38 | Direct in-process producer needs no imaginary IPC child report; optional wrong filename is classified only by exact producer/suite evidence. Missing required artifacts/worker proof in actual child recipe still rejects. |
| GB-U39 | Tampered/unrecognized producer, raw hash, maps, installed before/after tree, unresolved PATH/Python/Harness input or incomplete symlink target rejects; approved:true/currentHARNESS_PIN cannot substitute for historical capture. |
| GB-U40 | Live/missing/unknown process/SQL/trx/lock/schema/socket/root/normal shutdown and native recovery substitution reject. |
| GB-U41 | Latest equivalent failure/unknown ordering/tie cannot hide behind old PASS or the six selected pins. |
| GB-U42 | Receipt-preflight is restricted to8 suite IDs/current module/phase, uses original validator, and cannot emit aggregate readiness; arbitrary context/JSON/suite is rejected. |
| GB-U43 | Preflight requires completed outer cleanup and actual typed native record; self/future or live outer receipts reject. |
| GB-U44 | Complete source-bound native-global-enforcement/producer/input/emitted-LCOV/floor chain is accepted by collector fixture; labels remain verifier-only. |
| GB-U45 | Unit-only/partial/stale source or LCOV, missing/duplicate/conflicting CI shards and unverified job/run/artifact origin reject. |
| GB-U46 | Native global-enforcement/output provenance mismatch, wrong emitted LCOV hash at floor input, merge-input tamper, threshold/command/dependency mismatch or missing original producer rejects; do not model global thresholds as consuming LCOV. |
| GB-U47 | CurrentCI/head/main/final source review/task/scope/unknown core blockers remain, even if all8 preflight receipts or coverage fixture pass. |
| GB-U48 | Other60/3support/4HOLD remain distinct; no absent result becomes PASS, no Characterization retry or historical-gap waiver is generated. |

All16 tests must each include a passing control when appropriate and a specific counterexample; at least targeted mutations distinguish ignored dependency/tamper, broadened source exceptions, later failure, incomplete cleanup and unit-only LCOV. Retain mutation artifacts/failures and exactly restore products/tools; no mutation execution is authorized during preparation. Existing32 + new16 = at least48 units, zero skip; native stays4, zero skip. Profile timeouts remain300/600 seconds. If these cannot contain the mandatory checks, report failure; do not extend budget or drop an obligation.

Actual small end-to-end sequence after adoption only: reserve/verify owned minimalMySQL26.7 runtime using existing local authorization; capture actual runner/producer/tool/source/config/installed before snapshots, including external Harness script/schema bytes, Python runtime imported-input closure, and actual PATH executable/symlink resolution; missing historical6 snapshots are not replaced by this new capture; run the unchanged Harness DEVELOPER command for inventory-task041-gate-binding-unit, then inventory-task041-gate-binding-native. The coordinator must CAS-register each returned original run path/hash regardless of actual PASS/FAIL, preserving history; a still-live runtime preflight must remain BLOCKED; after original native typed completion and independently verified final cleanup, run:

{python} server/scripts/inventoryPhase005Gate.py --receipt-preflight --suite inventory-task041-gate-binding-unit --suite inventory-task041-gate-binding-native --phase PHASE-005 --module docs/inventory_management --repo-root . --harness-scripts /Users/sam/.agents/skills/software-engineering-harness/scripts --json

Use actual supportedPython3.12/Node26/MySQL26.7; do not repair user symlinks or download tools. Mode-specific preflight may inspect registry/raw identity metadata to identify relevant attempts, then must read ALL registered attempts for the selected allowlisted suite IDs (at most8 suite IDs) and their referenced artifacts, never just two/six chosen passing records; no database/resource probing against a stopped runtime, spawning business tests, broad artifact scan or cleanup. The completed positive supporting check must use actual unmodified Context/evidence_issues, not the SyntheticCoreBoundary from unit tests. Full aggregate command remains unchanged and is not invoked as a small test substitute. Positive end-to-end report is not another counted test, formal Gate or authorization.

Coverage collector requirements are design10.6.14. Pin actual server/package.json, current39-floor checker, existing CI workflow and shard merge source when reading a proof; do not edit them. This candidate supplies no new collection/merge execution command. Only an already approved local native producer or the already existing exact-head CI four-shard producer with complete observed inputs/output/authority can satisfy it. A future missing producer contract must be concentrated and reviewed before execution; absent proof staysBLOCKED. Do not remove NATIVE_COVERAGE_PROVENANCE_NOT_ATTESTED except for a fully proved actual input chain; no generated PASS placeholder or unconditional false replacement.

After48+4/actual preflight pass, produce an updated impact/applicability report before requesting any remaining execution. Six actuala1 typed receipts may be APPLICABLE only with proved narrow mapping; the three support results remain supporting (cheap original-command typed reruns may later be used), other60 are not presumed all failures or all compulsory reruns. Any affected/non-equivalent source requires its real relevant tests under valid authorization, with transaction/rollback/capacity regression if product/locking/Audit/shared transaction changes. No product or those changes are in this candidate.

ALL_FULL_LOAD_STOPPED remains binding: no CS01, Characterization, Customer/Core capacity, full native collection, broad Gate campaign, browser run or CI dispatch from this candidate. The future all-required current/proved evidence, full-native39floors/global92/83/90, realPlaywright/CLI/currentCI/latestmain/finalSam review and P4 numerical/filesystem/metadata/shared-warning requirements remain. Historical gap not resolved by this policy means final readiness cannot close. Keep TASK041IN_PROGRESS; no Task/P4DONE/evidence export/publication/push/PR/merge/formalTC-UAT/P5/deployment permission.


### TASK-041 HD235 — consolidated verification completion candidate

PROPOSED_NOT_APPLIED. Parent source713ff8d4/HD233 DESIGN60ba9951/PLANd34893c1 is actually Sam-reviewed at HD234; its48+4 and real receipt remain historical/current facts, not all73 green. This exact candidate changes only design10.6.15, this supplement, manifest derived pin/version and two profile minimums: gate-binding-unit48→80, gate-binding-native4→8. All73 groups/trace/matrix and original other suite fields stay unchanged. Product/provider, shared Harness/framework, package/checker and original CI jobs/matrix/commands are not in scope; only the precise evidence hooks/uploads may change.

Precise future source paths: server/scripts/inventoryPhase005Gate.py; server/scripts/inventoryPhase005Gate.test.py; server/test-support/inventoryPhase005GateNative.mjs.txt; docs/inventory_management/implementation/task041-hd235-verification-runtime.mjs.txt; server/scripts/inventoryPhase005CoverageEvidence.mjs; .github/workflows/ci.yml (finite recording/upload hooks only). The coordinator is one module-local fixed-registry producer derived from the hash-recovered HD227 and reviewed HD233 owners. It may execute only the original PHASE005 suite contracts ; no arbitrary argv/config/SQL or global cleanup. It must preserve raw failure/UNKNOWN, source freeze, actual CAS registration and first error; use actual fixed guard-specific private runtimes and independent SQL/process cleanup. No per-format directions are needed within this scope, but a changed contract or extra product/shared path remains material.

Preserve all48 original unit methods/assertions and four native bodies/assertions; add the following32 deterministic cases, all NOT_RUN:

| New unit | Required distinguishing boundary |
| --- | --- |
| GB-U49 | Finite73-suite registry rejects arbitrary/cross-module IDs and altered suite contract. |
| GB-U50 | Exact current FILES receipt accepts real command and process/artifact proof without invented DB. |
| GB-U51 | Missing executed Python/Harness/Node or installed tree in FILES remains UNKNOWN. |
| GB-U52 | New MYSQL_DIRECT receipt binds real original run, full ownership and completion. |
| GB-U53 | Wrong schema/socket/datadir/prefix/account or borrowed ownership rejects. |
| GB-U54 | MYSQL_HTTP binds actual app incarnation, request/JWT/device path and native artifact. |
| GB-U55 | HTTP status/fixture mocks cannot substitute real required native HTTP result. |
| GB-U56 | MYSQL_IPC_PROCESS requires actual ownedStops/ownedSql and historical connection/transaction observations. |
| GB-U57 | Exit0 without required shutdown acknowledgement, or unknown SQL terminal, rejects. |
| GB-U58 | FILES/native/HTTP/IPC cross-recipe substitution rejects. |
| GB-U59 | All registered attempts retained; later equivalent FAIL blocks older PASS. |
| GB-U60 | Unresolved later equivalence or equal-time ambiguity blocks; no convenient exclusion. |
| GB-U61 | Original typed failure is registered before result rejection; missing run stays original BLOCKED. |
| GB-U62 | Actual live runtime remains BLOCKED; only final encompassing cleanup makes receipt eligible. |
| GB-U63 | Resource cleanup does not claim transaction rollback or normal forced-child exit. |
| GB-U64 | Original historical absent inputs cannot be filled by present snapshots or same versions. |
| GB-U65 | Historical full source/PLAN mapping rejects changed Create/Lock/business helper. |
| GB-U66 | Old reviewed observational-only tool hashes do not imply executed-input equality. |
| GB-U67 | Existing73-suite contracts/data/zero-skip/deadlines and all original cases stay mandatory. |
| GB-U68 | Read-only preflight may select only explicit73 IDs; cannot spawn/write/CAS/clean or declare aggregate readiness. |
| GB-U69 | Four current native CI shards accept only actually observed source/workflow/input/owned service proof. |
| GB-U70 | Unit-only/partial raw coverage, absent or conflicting shards cannot satisfy full native provenance. |
| GB-U71 | Wrong Node/npm/script/cwd/command/global threshold or absent original outcome rejects. |
| GB-U72 | Floor consumes the same emitted native LCOV through unchanged39 checker and original chain. |
| GB-U73 | Native guarded skips remain explicit and cannot satisfy separately required zero-skip groups. |
| GB-U74 | Unanchored/self-reported proof cannot substitute current-head GitHub origin/job/artifact bytes. |
| GB-U75 | Wrong run/attempt/head, artifact publisher/job linkage, expired/missing/changed artifact rejects. |
| GB-U76 | Unknown MySQL image/container ownership, SQL terminal/socket close or forced container stop rejects. |
| GB-U77 | Before/after changes in source/dependencies/producer/executables are explicit non-equivalence, not administrative. |
| GB-U78 | Source freeze covers the new coordinator independently of generic docs exclusion. |
| GB-U79 | Performance FAIL synchronously halts later load; no automatic retry/skip-as-PASS. |
| GB-U80 | All remaining dirty/task/scope/main/CI/final Sam/numeric/ops blockers remain, even with73 receipt fixtures. |

Add GBN05–08, all NOT_RUN: (05) real FILES/typed owner process/artifact receipt with active versus completed negative; (06) real direct MySQL ownership/rollback/terminal boundary, including foreign owner rejection; (07) own loopback HTTP/IPC lifecycle proof and failed-result preservation, explicitly tool-only not Inventory business evidence; (08) actual Node CI-proof output/floor-input file binding using a small tool fixture plus changed-copy rejection, explicitly not full native/global PASS. Keep600-second native/300-second unit envelopes. First validate original existing small business suites listed in design through the real outer producer before relying on these abstractions. Prove missing inputs/wrong recipe/later failure/incomplete cleanup/unit-only LCOV/local-as-CI mutants are caught.

After actual small end-to-end and80+8, use the exact73-row execution/disposition manifest in the consolidated decision pack; do not label65 unsupported recipes as65 failures or schedule blanket reruns merely for a PLAN change. Reuse only individually established original applicability. Where required contemporaneous inputs are unavailable, perform new affected original suites under the frozen candidate, preserving old results and original min_tests/data/deadlines. All original73 zero-skip obligations remain. The actual current four-shard CI native/global/LCOV/39floor chain is mandatory provenance, not a new counted suite; unchanged local unit-only collection is not full native coverage.

Sam's selected consolidated decision controls the optional one-current-Characterization override and later one-CS01; without it all full load stays stopped. No alternate fixture/timeouts, failed-performance retry or history waiver. After authorized local evidence, minimize commit artifacts, create a draft PR only if expressly included in Sam's chosen scope, run current-head original mandatory CI and latest-main checks, obtain actual independent implementation review and final Sam complete-source review, and only then assess merge readiness under valid merge authority. Raw logs/native reports/trace/video/credentials remain LOCAL_ONLY, not automatically committed/exported. Numeric/resource budgets, target filesystem/metadata operations and shared-warning disposition remain explicit human/external blockers, never silently accepted.

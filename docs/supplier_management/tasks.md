# Supplier Management 開發任務分解

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件版本 | 0.1 Draft |
| 文件日期 | 2026-09-04 |
| Requirement | `docs/supplier_management/requirement.md` 0.1 Draft |
| Design | `docs/supplier_management/design_spec.md` 0.2 Draft |
| Task list target | 本文件；依使用者指定，不另建`tasks/plan.md`或`tasks/todo.md` |
| 狀態 | 待人工review／批准後執行；本文件不代表已開始開發 |

本文件依已確認的`SUP-CAP-01`～`SUP-CAP-05`拆成單一focused session可完成的XS／S／M任務。每個task同時列出需求ID、驗收、驗證命令、依賴及最多五個主要檔案；實作不得跳過Checkpoint或把多個task合成無法review的XL change。

## 1. 執行計畫

### 1.1 關鍵決策

- 以垂直切片交付；必要schema／pure rule foundation完成後，逐一交付API、UI及runtime verification。
- `SUP-CAP-01`先完成；`SUP-CAP-02`與`SUP-CAP-03`可在Core contract穩定後平行；`SUP-CAP-04`等待Item tables；`SUP-CAP-05`的Draft流程依賴Core，activate mode另依賴Approval。
- T01是硬性前置：目前repository只有`0001`～`0009`，但Item未完成task與Supplier design均提議由`0010`開始。若最新main仍相同，Supplier按task依賴配置`0010`permission、`0011`currencies、`0012`payment terms、`0013`suppliers、`0014`name grams、`0015`audit、`0016`addresses、`0017`contacts、`0018`identifiers、`0019`bank、`0020`approval、`0021`settings、`0022`～`0023`import；T42須在Item第一支migration前完成，Item再由下一可用號開始，`supplier_sku_refs`最後取Item之後的下一號。任何新migration建立前必須同步兩份design／tasks。
- Bank keys不得進repository或task evidence；銀行明文不得出現在log、audit、CSV、URL、notification、test snapshot或錯誤內容。
- 每個task完成時套用§1.4 Definition of Done；只有acceptance criteria與verification均完成才勾選index。

### 1.2 依賴圖

```text
T01 Migration allocation → T02 Permissions → T04/T05 Core persistence
T03 Config/security ───────────────────────┐
T04–T24 SUP-CAP-01 Core ─┬→ T25–T31 Approval & Settings
                         ├→ T25/T32–T37 Bank Security
                         ├→ T38–T40 Supplier–SKU ← Item tables
                         └→ T41–T49 Import/Export
T31 Approval complete ────────────────────→ T45 activate-mode import
T41–T42 Import migrations → Item migrations → T38 Supplier–SKU
T24/T31/T37/T40/T49 ─────────────────────→ T50–T51 Release
```

### 1.3 平行化規則

- 可平行：Core完成後的Approval與Bank；Bank完成前不妨礙Draft-only Import foundation。
- 必須順序：Migration allocation與migrations、shared API contract先於client、Import precheck先於confirm worker、Bank crypto先於Bank service及UI；`T41 → T42 → Item migrations → T38`是跨capability硬依賴。
- 需要協調：`SupplierAdminService.js`、`client/src/services/supplier.js`、`client/config/menu.js`及integration test files是shared hotspots；同一時間只由一個task修改。
- `SUP-CAP-04`不得用fake free-form SKU IDs先做正式migration；可先寫pure contract test，但落地須等待Item正式tables及service。

### 1.4 Definition of Done（每個task）

- [ ] Task acceptance criteria全部滿足，新增行為有先失敗後通過的測試，error／edge paths已覆蓋。
- [ ] Focused tests、受影響workspace regression及`npm run lint`通過；有client變更時production build通過。
- [ ] Runtime或真MySQL行為已按task驗證，不以mock SQL代替constraint／locking／migration證據。
- [ ] 沒有重複business logic、dead code、debug output、無關refactor或敏感資料洩漏。
- [ ] API／config／migration／操作行為已同步文件，rollback及backward compatibility已檢查。
- [ ] Security／observability適用項已review；Checkpoint或merge前取得人工review。

### 1.5 Checkpoints

每完成2至3項task即執行相應Checkpoint；Checkpoint只阻擋依賴其contract或schema的後續工作，不阻擋依賴圖上的獨立分支。Task ID是追蹤編號而非強制串行順序，因此T38等待T42及Item migrations時，可先執行T41–T42。

| Checkpoint | Tasks | Gate |
| --- | --- | --- |
| A | T01–T03 | Migration、permission、config與secret baseline |
| B | T04–T06 | Catalog、core schema及pure rules |
| C | T07–T09 | Duplicate、state／projection及audit |
| D | T10–T12 | Create、list、detail後端可用 |
| E | T13–T15 | Core pages及Address切片 |
| F | T16–T18 | Contact及Identifier backend |
| G | T19–T21 | Identifier／editor UI及root update |
| H | T22–T24 | Core lifecycle與CAP-01驗收 |
| I | T25–T27 | Control schema與Settings完整驗收 |
| J | T28–T30 | Approval domain、API及UI |
| K | T31–T33 | Approval驗收及Bank crypto／service |
| L | T34–T36 | Bank API、UI及rotation |
| M | T37–T39 | Bank驗收及Supplier–SKU relation |
| N | T40–T42 | SKU lookup及Import foundation |
| O | T43–T45 | Import precheck、jobs及執行 |
| P | T46–T48 | Import result、Export及retention |
| Final | T49–T51 | Bulk、效能及release evidence |

## 2. 任務索引

### Phase 0：安全與實作基線

- [ ] T01 凍結 Migration 編號與跨模組依賴
- [ ] T02 建立 Supplier 權限目錄與 seed
- [ ] T03 建立 Supplier 設定、秘密驗證與日誌遮罩

### SUP-CAP-01A：Core foundations

- [ ] T04 完成 Currency／Payment Term 後端切片
- [ ] T05 建立 Supplier root 與名稱索引 schema
- [ ] T06 建立 Core constants、normalization 與 validation
- [ ] T07 建立 Supplier Name 疑似重複候選
- [ ] T08 建立狀態機、reference guard 與 projections
- [ ] T09 建立 Supplier Audit service 與查詢 API

### SUP-CAP-01B：Core vertical slices

- [ ] T10 完成 Supplier 建立與直接啟用後端
- [ ] T11 完成 Supplier 建立頁
- [ ] T12 完成 Supplier 列表與詳情後端
- [ ] T13 完成 Supplier 列表與詳情頁
- [ ] T14 完成 Address 後端切片
- [ ] T15 完成 Address UI 切片
- [ ] T16 完成 Contact 後端切片
- [ ] T17 完成 Contact UI 切片
- [ ] T18 完成 Identifier 後端切片
- [ ] T19 完成 Identifier UI 切片
- [ ] T20 完成一般更新、Code 修正與完整度後端
- [ ] T21 完成一般編輯與完整度 UI
- [ ] T22 完成生命週期、封鎖、封存與受控刪除後端
- [ ] T23 完成生命週期操作 UI
- [ ] T24 完成 Core lookup、整合契約與安全驗收

### SUP-CAP-02：Approval & Settings

- [ ] T25 建立 Bank／Approval／Settings persistence gate
- [ ] T26 完成 Supplier Settings 後端
- [ ] T27 完成 Settings 與 Payment Terms UI
- [ ] T28 建立啟用審批 domain
- [ ] T29 完成 Approval API 與 queue
- [ ] T30 完成 Approval UI
- [ ] T31 完成 Approval 並發、安全與端到端驗收

### SUP-CAP-03：Bank Security

- [ ] T32 建立 Bank crypto primitives
- [ ] T33 完成 Bank domain service
- [ ] T34 完成 Bank API 與敏感資料邊界
- [ ] T35 完成 Bank UI
- [ ] T36 完成 Encryption／Lookup key 輪替工具
- [ ] T37 完成 Bank 安全與復原驗收

### SUP-CAP-04：Supplier–SKU Sourcing

- [ ] T38 建立 Item 依賴與 Supplier–SKU relation 後端
- [ ] T39 完成 Supplier–SKU relation UI
- [ ] T40 完成 for-SKU lookup 與整合驗收

### SUP-CAP-05：Bulk Import & Export

- [ ] T41 建立 Import dependencies、config 與 scheduler
- [ ] T42 建立 Import persistence 與 worker 基線
- [ ] T43 完成 CSV template 與 precheck
- [ ] T44 完成 Import job 查詢與控制 API
- [ ] T45 完成 Confirm 與逐列原子執行
- [ ] T46 完成 Import 結果與 UI
- [ ] T47 完成一般 Supplier Export
- [ ] T48 完成 Import 檔案保留與清理
- [ ] T49 完成 Import／Export 整合及容量驗收

### Release hardening

- [ ] T50 完成整體效能、容量與可觀測性驗證
- [ ] T51 完成部署、Smoke、回歸與 Release Gate

## 3. 詳細任務

## T01：凍結 Migration 編號與跨模組依賴

**Description：** 在任何DDL檔建立前取得最新main的migration inventory，決定Supplier與尚未實作Item的全域編號所有權，並一次同步設計及兩份task文件，消除`0010`起的重複預留。

**Capability：** Cross-cutting foundation

**Traceability：** BR-001、NFR-009、SEC-009

**Acceptance criteria：**
- [ ] 列出main現有migration並證明每個四位前綴唯一；既有`0001`～`0009`名稱與內容不變。
- [ ] 若`0010`～`0023`仍空閒，依已確認Supplier-first方案配置給Supplier；Item由下一可用號開始，否則Supplier整組順延。
- [ ] Supplier／Item design及tasks的migration表完全一致，FK順序與Item-dependent `supplier_sku_refs`延後規則保留。

**Verification：**
- [ ] `find server/database/migrations -maxdepth 1 -type f -print | sort`
- [ ] `rg -n '00[0-9]{2}.*migration|Migration' docs/items_management docs/supplier_management`
- [ ] Manual review：Technical Lead確認全域編號表後才開始T02／T04／T05。

**Dependencies：** None

**Files likely touched：**
- `docs/supplier_management/design_spec.md`
- `docs/supplier_management/tasks.md`
- `docs/items_management/design_spec.md`
- `docs/items_management/tasks.md`

**Estimated scope：** S（4 files）

## T02：建立 Supplier 權限目錄與 seed

**Description：** 新增六項Supplier permissions、以migration冪等種入並授予受保護的system-admin break-glass角色，同時用現有convention及startup guard證明catalogue與DB一致。

**Capability：** Cross-cutting foundation（SUP-CAP-01～03）

**Traceability：** BR-022、SEC-001、SEC-002、SEC-003、SEC-004、SEC-005、SEC-006、SEC-007、SEC-008、SEC-009、AC-036、AC-039

**Acceptance criteria：**
- [ ] Permission catalogue精確加入`supplier.view`、`supplier.mgmt`、`supplier.approval`、`supplier.bank.view`、`supplier.bank.mgmt`、`supplier.settings`，沒有隱式inheritance。
- [ ] Permission seed可在空DB、已套用DB及重跑情境收斂，system-admin取得六項且日常role不被自動修改。
- [ ] Catalogue、seed或handler policy使用未知／漏失permission時convention／startup tests失敗。

**Verification：**
- [ ] `npm test --workspace server -- test/permissionCatalogueConventions.test.js test/permissionCatalogueStartupGuard.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`
- [ ] `npm run lint`

**Dependencies：** T01

**Files likely touched：**
- `server/src/modules/authorization/permissionCatalogue.js`
- `server/database/migrations/0010_seed_supplier_management_permissions.js`
- `server/test/permissionCatalogueConventions.test.js`
- `server/test/permissionCatalogueStartupGuard.test.js`
- `server/test/integration/migrations.integration.test.js`

**Estimated scope：** M（5 files）

## T03：建立 Supplier 設定、秘密驗證與日誌遮罩

**Description：** 加入Supplier config normalizer、Bank encryption／lookup key rings及import容量設定，讓錯誤secret在startup fail closed，並把所有銀行敏感欄位加入現有logger profiles。

**Capability：** Cross-cutting security foundation（SUP-CAP-03／05）

**Traceability：** FR-BANK-007、FR-AUDIT-003、FR-AUDIT-004、BR-020、SEC-010、SEC-011、SEC-013、NFR-010

**Acceptance criteria：**
- [ ] 兩組key ring、active IDs、threshold及import limits均作typed bounded validation；secret inspect／JSON只顯示`[REDACTED]`。
- [ ] 所有logger profiles大小寫不敏感遮罩design指定欄位，且`.env.example`不含任何真key。
- [ ] `SUP-CAP-03`部署後缺失／錯誤key令startup失敗，不能只停用Bank endpoint後繼續。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierConfig.test.js test/configuration.test.js test/loggingRedaction.test.js`
- [ ] `npm run lint -- server/config/supplier.js server/src/modules/supplier/normalizeSupplierConfig.js`
- [ ] Manual check：以缺key、錯誤base64、未知active ID啟動均安全失敗且輸出無secret。

**Dependencies：** T01

**Files likely touched：**
- `server/config/supplier.js`
- `server/src/framework/configuration/applicationConfiguration.js`
- `server/src/modules/supplier/normalizeSupplierConfig.js`
- `server/config/logging.js`
- `server/.env.example`

**Estimated scope：** M（5 files）

## Checkpoint A：T01–T03

- [ ] Migration編號及Item依賴由Technical Lead確認，沒有重複預留。
- [ ] Permission seed、config startup及logging redaction focused tests全綠。
- [ ] 人工Security review接受system-admin break-glass及兩組key ring基線。

## T04：完成 Currency／Payment Term 後端切片

**Description：** 以共享catalog形式建立Currency與Payment Term schema、HKD seed、read／management service及API，支援Supplier最低幣別與選填付款條件。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-LIST-004、FR-VIEW-001、FR-CREATE-005、FR-EDIT-001、FR-EDIT-003、BR-007、BR-008、BR-025、AC-020、AC-022

**Acceptance criteria：**
- [ ] Currency migration冪等建立catalog並種一筆Active HKD；一般selector只回Active，inactive歷史值仍可顯示。
- [ ] Payment Term code唯一，`net_days`與dueDays規則受service及DB引用保護；被引用後只可停用。
- [ ] Read使用`supplier.view`，Payment Term寫入使用`supplier.settings`＋`jwt-device-password`，未知欄位拒絕。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierCatalogService.test.js test/supplierCatalogHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`
- [ ] `npm run lint`

**Dependencies：** T01、T02

**Files likely touched：**
- `server/database/migrations/0011_create_currencies.js`
- `server/database/migrations/0012_create_payment_terms.js`
- `server/src/modules/supplier/SupplierCatalogService.js`
- `server/src/handlers/supplier-catalog/catalogHandlers.js`
- `server/test/supplierCatalogService.test.js`

**Estimated scope：** M（5 files）

## T05：建立 Supplier root 與名稱索引 schema

**Description：** 建立Supplier root及名稱bigram索引，先以真MySQL證明唯一鍵、FK、索引、時間與forward-only migration規則。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** BR-001、BR-002、BR-004、BR-010、BR-018、BR-029、NFR-006、NFR-007、NFR-009

**Acceptance criteria：**
- [ ] Supplier root欄位、status、version、normalized keys、currency／payment term FKs及索引與design一致。
- [ ] `supplier_name_grams`具owner composite PK及gram lookup index；Supplier刪除時只cascade其grams。
- [ ] 兩支migration可重跑，且不存在較高Supplier migration先被套用後才補入較低編號的情況。

**Verification：**
- [ ] `npm test --workspace server -- test/migrate.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`
- [ ] Manual schema check：`SHOW CREATE TABLE`結果與design §5.4／§5.4.1／§5.12一致。

**Dependencies：** T01、T04

**Files likely touched：**
- `server/database/migrations/0013_create_suppliers.js`
- `server/database/migrations/0014_create_supplier_name_grams.js`
- `server/test/integration/migrations.integration.test.js`

**Estimated scope：** M（3 files）

## T06：建立 Core constants、normalization 與 validation

**Description：** 以pure functions集中Supplier code、name、identifier、contact、URL、currency及啟用完整度規則，讓UI、API與import共用同一業務語意。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-CREATE-002、FR-CREATE-003、FR-CREATE-005、FR-EDIT-003、FR-EDIT-004、BR-003、BR-006、BR-007、BR-008、BR-010、BR-029、BR-030、BR-031、AC-002、AC-004、AC-020、AC-038

**Acceptance criteria：**
- [ ] Code只trim／NFKC／case-normalize，不加入格式前綴；Identifier依type／country形成唯一key。
- [ ] `assertSupplierActivatable`只阻擋Code、Name、Active Currency，其他缺項只回bounded warnings。
- [ ] 所有輸入具長度、控制字元、cross-field及unknown-property防護；pure tests覆蓋Unicode與error paths。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierNormalization.test.js test/supplierValidation.test.js`
- [ ] `npm run lint -- server/src/modules/supplier`
- [ ] Manual review：normalization沒有讀DB、時間、environment或request object。

**Dependencies：** T04

**Files likely touched：**
- `server/src/modules/supplier/supplierConstants.js`
- `server/src/modules/supplier/supplierNormalization.js`
- `server/src/modules/supplier/supplierValidation.js`
- `server/src/modules/supplier/supplierErrors.js`
- `server/test/supplierNormalization.test.js`

**Estimated scope：** M（5 files）

## Checkpoint B：T04–T06

- [ ] Catalog及core migrations在空DB與重跑DB均成功。
- [ ] Pure rules的focused tests與lint通過，最低三欄啟用規則沒有被擴大。
- [ ] Review確認schema與normalization contract後才開始create/list handlers。

## T07：建立 Supplier Name 疑似重複候選

**Description：** 實作indexed Unicode bigram候選與deterministic Dice ranking，保留名稱可重複的業務彈性，同時避免100k Supplier全表逐列相似度計算。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-CREATE-004、BR-009、AC-003、NFR-001、NFR-003

**Acceptance criteria：**
- [ ] Exact normalized name最高優先；gram交集最多取50候選，score達0.85才回、最多10筆且ID穩定排序。
- [ ] 中英文、重音、全半形及首／中／尾錯字fixture可召回；單字名稱只做exact。
- [ ] 候選永遠只是warning，不提供automatic merge或blocking decision；name與grams在同一transaction更新。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierDuplicateCandidates.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierDuplicateCandidates.integration.test.js`
- [ ] Manual EXPLAIN：候選查詢使用gram index且不掃描100k Supplier。

**Dependencies：** T05、T06

**Files likely touched：**
- `server/src/modules/supplier/supplierDuplicateCandidates.js`
- `server/test/supplierDuplicateCandidates.test.js`
- `server/test/integration/supplierDuplicateCandidates.integration.test.js`

**Estimated scope：** M（3 files）

## T08：建立狀態機、reference guard 與 projections

**Description：** 把Supplier lifecycle、可刪除／可改Code的引用判斷及所有公開response白名單做成可獨立測試的domain helpers。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-STATUS-001、FR-STATUS-005、FR-STATUS-006、FR-STATUS-008、BR-014、BR-015、BR-016、BR-017、BR-018、BR-032、AC-014、AC-015、AC-016、AC-017、AC-018、AC-019

**Acceptance criteria：**
- [ ] State matrix完整拒絕非法轉換；unblock／restore只到Suspended，Pending只走approval lifecycle。
- [ ] Reference guard回具名計數並阻止已引用Supplier delete／Code change；下游查詢可增量加入。
- [ ] 所有projection只回allowlist，絕不spread DB row或包含normalization／Bank secret columns。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierStateMachine.test.js test/supplierReferenceService.test.js test/supplierProjections.test.js`
- [ ] `npm run lint -- server/src/modules/supplier`
- [ ] Manual review：每個state與projection分支均有negative test。

**Dependencies：** T05、T06

**Files likely touched：**
- `server/src/modules/supplier/supplierStateMachine.js`
- `server/src/modules/supplier/SupplierReferenceService.js`
- `server/src/modules/supplier/supplierProjections.js`
- `server/test/supplierStateMachine.test.js`
- `server/test/supplierProjections.test.js`

**Estimated scope：** M（5 files）

## T09：建立 Supplier Audit service 與查詢 API

**Description：** 建立Audit migration、transaction-bound writer及只讀、分頁、遮罩的audit查詢，使後續每個Supplier write slice可在同一交易留下可追溯證據。

**Capability：** SUP-CAP-01～05 cross-cutting audit

**Traceability：** FR-VIEW-003、FR-AUDIT-001、FR-AUDIT-002、FR-AUDIT-003、FR-AUDIT-004、FR-AUDIT-005、FR-AUDIT-006、FR-AUDIT-007、SEC-011、SEC-012、AC-001

**Acceptance criteria：**
- [ ] Audit writer要求既有connection，action-specific allowlist及8192-byte策略；audit失敗令業務transaction rollback。
- [ ] Audit API支援Supplier、actor、action、target及time filters，固定分頁／排序且只有INSERT／SELECT能力。
- [ ] `0015` migration在`0014`後套用且可重跑；Bank及personal details在service、response及failure log均遮罩。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierAuditLogService.test.js test/supplierAuditHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierAudit.integration.test.js`
- [ ] `npm run lint`

**Dependencies：** T02、T05、T08

**Files likely touched：**
- `server/src/modules/supplier/SupplierAuditLogService.js`
- `server/database/migrations/0015_create_supplier_audit_logs.js`
- `server/src/handlers/supplier-audit/auditHandlers.js`
- `server/test/supplierAuditLogService.test.js`
- `server/test/integration/supplierAudit.integration.test.js`

**Estimated scope：** M（5 files）

## Checkpoint C：T07–T09

- [ ] Duplicate candidate、state／reference及projection pure tests全綠。
- [ ] Audit write與business write的commit／rollback一致性由真MySQL證明。
- [ ] 沒有任何response／audit detail包含internal keys或Bank明文。

## T10：完成 Supplier 建立與直接啟用後端

**Description：** 交付第一條完整後端垂直切片：具管理權限者建立Draft或在approval OFF時直接Active，原子寫入root、選填children、name grams及audit。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-CREATE-001、FR-CREATE-003、FR-CREATE-005、FR-CREATE-006、BR-003、BR-007、BR-008、AC-001、AC-002、AC-007、AC-020、AC-039

**Acceptance criteria：**
- [ ] Create使用idempotency、fresh actor check及單一transaction；任一步驟失敗不留下root／child／grams／audit部分資料。
- [ ] Code／Identifier競態由DB unique轉穩定public error；duplicate name只回warning且可確認繼續。
- [ ] `activate=true`在policy OFF時只檢查最低三欄後Active；policy ON的完整行為留給T27並先回明確未就緒結果。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierAdminService.test.js test/supplierCreateHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierManagement.integration.test.js`
- [ ] Manual API check：Draft create、direct activate、duplicate及rollback情境。

**Dependencies：** T04、T05、T06、T07、T08、T09

**Files likely touched：**
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/src/handlers/suppliers/supplierSchemas.js`
- `server/src/handlers/suppliers/createSupplierHandler.js`
- `server/test/supplierAdminService.test.js`
- `server/test/integration/supplierManagement.integration.test.js`

**Estimated scope：** M（5 files）

## T11：完成 Supplier 建立頁

**Description：** 建立Supplier menu、client service及create route page，讓使用者清楚選擇儲存Draft或啟用，並顯示最低條件、duplicate warning及可識別結果。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-CREATE-001、FR-CREATE-002、FR-CREATE-004、FR-CREATE-005、FR-CREATE-008、FR-EDIT-006、BR-009

**Acceptance criteria：**
- [ ] 頁面只強制Code、Name、Default Currency；其他缺項顯示non-blocking completeness warnings。
- [ ] Draft與activate action分開，duplicate candidates可檢視及確認；成功訊息包含Supplier Code、status及下一步。
- [ ] Route／menu按permission呈現，無`supplier.mgmt`直接URL被guard拒絕，dirty form離開前提示。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/create.test.js test/services/supplier.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual keyboard check：完成create、warning確認、error focus及dirty-leave流程。

**Dependencies：** T10

**Files likely touched：**
- `client/config/menu.js`
- `client/src/services/supplier.js`
- `client/src/pages/suppliers/SupplierCreatePage.vue`
- `client/src/components/suppliers/SupplierBasicForm.vue`
- `client/test/pages/suppliers/create.test.js`

**Estimated scope：** M（5 files）

## T12：完成 Supplier 列表與詳情後端

**Description：** 提供server-side Supplier list、detail、duplicate check及completeness API，以indexed query、stable sort、masked projection與IDOR防護支援日常查詢。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-LIST-001、FR-LIST-002、FR-LIST-003、FR-LIST-004、FR-LIST-005、FR-LIST-006、FR-LIST-007、FR-LIST-010、FR-VIEW-001、FR-VIEW-003、FR-VIEW-005、NFR-001、NFR-002

**Acceptance criteria：**
- [ ] List預設20、上限100、排除Archived，支援design指定搜尋／filter／allowlist sort並穩定分頁。
- [ ] Detail回一般主資料、children、付款預設、狀態、warnings及masked Bank summary；內部keys不出response。
- [ ] Empty、not found、permission、validation及DB failure有不同穩定結果；cross-Supplier child ID不洩漏存在性。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierQueryHandlers.test.js test/supplierAdminService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierManagement.integration.test.js`
- [ ] Manual EXPLAIN：Code exact／prefix及主要filters使用設計索引。

**Dependencies：** T10

**Files likely touched：**
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/src/handlers/suppliers/supplierQueryHandlers.js`
- `server/src/handlers/suppliers/supplierSchemas.js`
- `server/test/supplierQueryHandlers.test.js`
- `server/test/integration/supplierManagement.integration.test.js`

**Estimated scope：** M（5 files）

## Checkpoint D：T10–T12

- [ ] Create／list／detail API可在真MySQL完成主要happy及negative flows。
- [ ] Client create page build通過，permission與duplicate warning行為一致。
- [ ] Core API contract review完成後，後續child及editor tasks才可平行。

## T13：完成 Supplier 列表與詳情頁

**Description：** 建立server-side DataTable列表與detail shell，支援URL query、狀態／完整度提示、權限操作及Audit入口，不在前端重新實作domain規則。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-LIST-001、FR-LIST-002、FR-LIST-003、FR-LIST-004、FR-LIST-005、FR-LIST-006、FR-LIST-007、FR-LIST-009、FR-LIST-010、FR-VIEW-001、FR-VIEW-003、FR-VIEW-005

**Acceptance criteria：**
- [ ] List的page、sort、q及filters同步URL；loading、empty、error及forbidden狀態可區分。
- [ ] Detail tabs按permission與資料可用性呈現，所有狀態同時有文字／icon及不可採購提示。
- [ ] 一般Bank欄永遠masked／presence-only，view-only使用者看不到write actions但可正常查歷史。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/list.test.js test/pages/suppliers/detail.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual keyboard check：filter、sort、pagination、直接URL及狀態提示。

**Dependencies：** T11、T12、T09

**Files likely touched：**
- `client/src/pages/suppliers/SuppliersPage.vue`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/src/components/suppliers/SupplierCompletenessBanner.vue`
- `client/test/pages/suppliers/list.test.js`
- `client/test/pages/suppliers/detail.test.js`

**Estimated scope：** M（5 files）

## T14：完成 Address 後端切片

**Description：** 建立Address與purpose mapping schema、CRUD／deactivate API及transaction rules，保證每用途最多一個Active primary並防止水平越權。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-EDIT-001、FR-EDIT-003、FR-PARTY-001、FR-PARTY-002、FR-PARTY-003、FR-PARTY-004、AC-020

**Acceptance criteria：**
- [ ] Migration建立Address與purpose composite FK／generated primary slot；重跑收斂。
- [ ] Create／update／deactivate使用supplierId＋addressId ownership、version及單一transaction切換primary。
- [ ] 停用Address同交易清除primary但保留歷史mapping；inactive owner不可重新設primary。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierAddressService.test.js test/supplierAddressHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierParty.integration.test.js`
- [ ] Manual concurrent check：兩個primary request最終只有一個成功。

**Dependencies：** T10、T12

**Files likely touched：**
- `server/database/migrations/0016_create_supplier_addresses.js`
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/src/handlers/suppliers/supplierAddressHandlers.js`
- `server/test/supplierAddressService.test.js`
- `server/test/integration/supplierParty.integration.test.js`

**Estimated scope：** M（5 files）

## T15：完成 Address UI 切片

**Description：** 在Supplier detail提供多地址新增、編輯、用途、primary切換及停用操作，保持可存取錯誤與版本衝突處理。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-EDIT-001、FR-EDIT-004、FR-EDIT-006、FR-PARTY-001、FR-PARTY-002、FR-PARTY-003、FR-PARTY-004

**Acceptance criteria：**
- [ ] Address panel可新增／修改／停用、排序及設定多用途，清楚標示每用途primary。
- [ ] Version conflict不自動覆蓋，保留草稿並要求reload；inactive address沒有primary action。
- [ ] 表單可鍵盤操作，欄位錯誤有accessible summary，成功訊息包含Supplier Code／address label。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/address.test.js test/services/supplier.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：切換primary、停用primary及模擬stale version。

**Dependencies：** T13、T14

**Files likely touched：**
- `client/src/components/suppliers/SupplierAddressPanel.vue`
- `client/src/services/supplier.js`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/test/pages/suppliers/address.test.js`

**Estimated scope：** M（4 files）

## Checkpoint E：T13–T15

- [ ] List／detail與Address API／UI tests通過。
- [ ] URL state、permission、primary切換及stale version完成manual check。
- [ ] Client production build與lint通過。

## T16：完成 Contact 後端切片

**Description：** 建立Contact與purpose schema及CRUD／deactivate API，原子維持每用途最多一名Active primary並保留離職聯絡人的歷史。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-EDIT-001、FR-PARTY-001、FR-PARTY-002、FR-PARTY-003、FR-PARTY-004、FR-PARTY-006、AC-021

**Acceptance criteria：**
- [ ] Migration建立Contact與purpose composite FK／generated primary slot，email／phone為選填且格式受驗證。
- [ ] Create／update／deactivate使用ownership、version、fresh permission及transactional audit。
- [ ] 設定新primary同交易清舊值；停用Contact清primary但不刪歷史，缺主要聯絡只回warning。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierContactService.test.js test/supplierContactHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierParty.integration.test.js`
- [ ] Manual concurrent check：同用途雙primary受DB與service共同阻止。

**Dependencies：** T10、T12

**Files likely touched：**
- `server/database/migrations/0017_create_supplier_contacts.js`
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/src/handlers/suppliers/supplierContactHandlers.js`
- `server/test/supplierContactService.test.js`
- `server/test/integration/supplierParty.integration.test.js`

**Estimated scope：** M（5 files）

## T17：完成 Contact UI 切片

**Description：** 在Supplier detail交付聯絡人、用途、primary與停用流程，並把缺少主要聯絡人的完整度提示接回現有detail。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-LIST-006、FR-EDIT-001、FR-EDIT-006、FR-PARTY-001、FR-PARTY-002、FR-PARTY-003、FR-PARTY-006、AC-021

**Acceptance criteria：**
- [ ] Contact panel可管理姓名、職位、部門、電話、Email、語言、用途、primary及status。
- [ ] 切換／停用primary後detail與列表summary同步；沒有primary只顯示warning且不阻止啟用。
- [ ] Stale version、validation及permission錯誤保留輸入並提供可存取提示。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/contact.test.js test/pages/suppliers/detail.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual keyboard check：建立兩名Contact並切換orders／accounts payable primary。

**Dependencies：** T13、T16

**Files likely touched：**
- `client/src/components/suppliers/SupplierContactPanel.vue`
- `client/src/services/supplier.js`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/test/pages/suppliers/contact.test.js`

**Estimated scope：** M（4 files）

## T18：完成 Identifier 後端切片

**Description：** 建立Supplier identifiers schema及CRUD，按type＋issuer country＋normalized value執行全公司唯一，並保留被引用資料的歷史語意。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-CREATE-003、FR-EDIT-001、FR-EDIT-003、FR-PARTY-004、FR-PARTY-005、BR-010、AC-004

**Acceptance criteria：**
- [ ] Migration建立composite unique及Supplier FK；不同identifier type／country可使用相同顯示值。
- [ ] Create／update競態將DB duplicate映射為`SUPPLIER_IDENTIFIER_TAKEN`，不洩漏其他Supplier敏感資料。
- [ ] Delete只允許未引用identifier；所有write具version、fresh permission、reason適用項及audit。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierIdentifierService.test.js test/supplierIdentifierHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierParty.integration.test.js`
- [ ] Manual check：case／separator normalization及跨Supplier並發duplicate。

**Dependencies：** T06、T10、T12

**Files likely touched：**
- `server/database/migrations/0018_create_supplier_identifiers.js`
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/src/handlers/suppliers/supplierIdentifierHandlers.js`
- `server/test/supplierIdentifierService.test.js`
- `server/test/integration/supplierParty.integration.test.js`

**Estimated scope：** M（5 files）

## Checkpoint F：T16–T18

- [ ] Contact及Identifier migrations可重跑。
- [ ] Primary、unique、ownership與歷史保留由真MySQL證明。
- [ ] Supplier啟用仍只要求最低三欄。

## T19：完成 Identifier UI 切片

**Description：** 在Supplier detail提供識別資料新增、修改及受控刪除，清楚顯示類型／簽發地區與唯一衝突。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-EDIT-001、FR-EDIT-005、FR-EDIT-006、FR-PARTY-004、FR-PARTY-005

**Acceptance criteria：**
- [ ] Identifier panel可維護type、issuer country、value及notes，無資料時不影響啟用。
- [ ] Unique conflict顯示type／country及可理解訊息，不揭露無權查看Supplier內容。
- [ ] 被引用identifier沒有delete action；version conflict保留草稿並要求reload。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/identifier.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：建立、duplicate、修改及被引用刪除拒絕。

**Dependencies：** T13、T18

**Files likely touched：**
- `client/src/components/suppliers/SupplierIdentifierPanel.vue`
- `client/src/services/supplier.js`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/test/pages/suppliers/identifier.test.js`

**Estimated scope：** M（4 files）

## T20：完成一般更新、Code 修正與完整度後端

**Description：** 交付Supplier root update、受控Code change及completeness API，確保每次更新重驗唯一性、catalog、狀態、引用與version。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-EDIT-001、FR-EDIT-002、FR-EDIT-003、FR-EDIT-004、FR-EDIT-005、FR-EDIT-007、BR-005、BR-025、BR-029、AC-005、AC-006、AC-032、AC-038

**Acceptance criteria：**
- [ ] 一般update不接受Supplier Code；Code change只在unreferenced Supplier以`jwt-device-password`＋reason執行。
- [ ] Currency／Payment Term／Identifier及格式規則重驗；version conflict不寫資料或audit。
- [ ] 更新只改master，不回寫下游snapshot；completeness分開回blocking issues與non-blocking warnings。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierAdminService.test.js test/supplierUpdateHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierManagement.integration.test.js`
- [ ] Manual API check：合法Code change、referenced拒絕及雙人stale update。

**Dependencies：** T14、T16、T18

**Files likely touched：**
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/src/handlers/suppliers/supplierUpdateHandlers.js`
- `server/src/handlers/suppliers/supplierSchemas.js`
- `server/test/supplierAdminService.test.js`
- `server/test/integration/supplierManagement.integration.test.js`

**Estimated scope：** M（5 files）

## T21：完成一般編輯與完整度 UI

**Description：** 完成Supplier detail一般資料editor、付款預設、completeness及受控Code change dialog，統一處理dirty state與version conflict。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-EDIT-001、FR-EDIT-002、FR-EDIT-004、FR-EDIT-005、FR-EDIT-006、FR-VIEW-005

**Acceptance criteria：**
- [ ] General editor可更新允許欄位與付款預設，Supplier Code平時readonly；合法時才顯示獨立高風險修正。
- [ ] Completeness清楚區分blocking與warning；缺Address／Contact／Payment／Bank不被UI誤設為啟用阻擋。
- [ ] Dirty leave及version conflict保留可複製草稿；Code change要求password、approved device及reason。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/editor.test.js test/pages/suppliers/detail.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual keyboard check：edit、dirty leave、stale conflict及Code change。

**Dependencies：** T13、T20

**Files likely touched：**
- `client/src/components/suppliers/SupplierPaymentDefaults.vue`
- `client/src/components/suppliers/SupplierCompletenessBanner.vue`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/src/services/supplier.js`
- `client/test/pages/suppliers/editor.test.js`

**Estimated scope：** M（5 files）

## Checkpoint G：T19–T21

- [ ] Identifier與general editor UI tests通過。
- [ ] Code change／version／snapshot規則有後端negative tests。
- [ ] 所有dirty-state及error focus manual checks完成。

## T22：完成生命週期、封鎖、封存與受控刪除後端

**Description：** 實作activate、suspend、reactivate、block、unblock、archive、restore及delete commands，按狀態、權限、reason、re-auth與reference guard原子更新audit。

**Capability：** SUP-CAP-01 Supplier Core；Block權限供SUP-CAP-02使用

**Traceability：** FR-STATUS-001、FR-STATUS-002、FR-STATUS-003、FR-STATUS-004、FR-STATUS-005、FR-STATUS-006、FR-STATUS-007、FR-STATUS-008、BR-014、BR-015、BR-016、BR-017、BR-018、BR-032、AC-014、AC-015、AC-016、AC-017、AC-018、AC-019

**Acceptance criteria：**
- [ ] 每個command只接受design state matrix，重複同終態不重複audit；unblock／restore只到Suspended。
- [ ] Block／unblock使用`supplier.view`＋`supplier.approval`及device-password；其他高風險route使用指定auth與reason。
- [ ] Referenced／曾Active Supplier不可delete；archive先回具名open-flow blockers，所有失敗均無部分狀態。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierLifecycleService.test.js test/supplierLifecycleHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierManagement.integration.test.js`
- [ ] Manual API matrix：所有允許及禁止state transitions逐項核對。

**Dependencies：** T08、T20

**Files likely touched：**
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/src/handlers/suppliers/supplierLifecycleHandlers.js`
- `server/src/handlers/suppliers/supplierSchemas.js`
- `server/test/supplierLifecycleService.test.js`
- `server/test/integration/supplierManagement.integration.test.js`

**Estimated scope：** M（5 files）

## T23：完成生命週期操作 UI

**Description：** 把合法狀態actions、影響說明、原因、re-auth及結果提示接到Supplier列表／詳情，避免前端提供非法或含糊操作。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** FR-CREATE-008、FR-STATUS-002、FR-STATUS-004、FR-STATUS-005、FR-STATUS-006、FR-STATUS-007、FR-STATUS-008、AC-014、AC-016、AC-017、AC-018、AC-019

**Acceptance criteria：**
- [ ] 列表／詳情只顯示目前狀態合法且actor有權限的actions；Blocked／Archived不可採購提示明確。
- [ ] Dialog列出Supplier Code、結果狀態、歷史保留與阻擋項，要求design指定reason／password／device。
- [ ] 完成後刷新version／status並顯示可識別結果；409 conflict不假裝成功。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/lifecycle.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：suspend、block、unblock、archive、restore及delete的keyboard流程。

**Dependencies：** T13、T22

**Files likely touched：**
- `client/src/components/suppliers/SupplierStatusActions.vue`
- `client/src/pages/suppliers/SuppliersPage.vue`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/src/services/supplier.js`
- `client/test/pages/suppliers/lifecycle.test.js`

**Estimated scope：** M（5 files）

## T24：完成 Core lookup、整合契約與安全驗收

**Description：** 交付下游按Supplier ID／Code查詢、用途型狀態驗證與歷史projection，並完成SUP-CAP-01的端到端、並發、IDOR及回歸gate。

**Capability：** SUP-CAP-01 Supplier Core

**Traceability：** BR-002、BR-014、BR-015、BR-025、BR-032、SEC-008、SEC-009、NFR-006、NFR-007、NFR-010、AC-032、AC-038、AC-039

**Acceptance criteria：**
- [ ] `purpose=purchase`只接受Active，`history`可讀未物理刪除狀態；呼叫方權限與Supplier projection分離。
- [ ] findById／findByCode／findManyByIds／assertUsable使用stable ID、bounded inputs及提交時重新驗證。
- [ ] Core full flow、concurrent unique／version、IDOR、audit rollback及client smoke全綠，沒有P0／P1 defect。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierLookupService.test.js test/integration/supplierManagement.integration.test.js`
- [ ] `npm test --workspace client -- test/pages/suppliers`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T09、T12、T14、T16、T18、T20、T22、T23

**Files likely touched：**
- `server/src/modules/supplier/SupplierLookupService.js`
- `server/test/supplierLookupService.test.js`
- `server/test/integration/supplierManagement.integration.test.js`
- `client/test/pages/suppliers/coreFlow.test.js`

**Estimated scope：** M（4 files）

## Checkpoint H：T22–T24

- [ ] SUP-CAP-01全部focused／integration／client tests通過。
- [ ] Lifecycle、lookup、IDOR、concurrency及audit rollback evidence完整。
- [ ] 人工review批准Core contract後才開始依賴它的Approval／Bank／Import工作。

## T25：建立 Bank／Approval／Settings persistence gate

**Description：** 依已凍結的全域序號一次建立`0019`～`0021`控制類tables，避免日後先套用較高編號再回補較低編號；本task只建立schema與default setting，不實作業務API。

**Capability：** SUP-CAP-02／SUP-CAP-03 persistence foundation

**Traceability：** FR-BANK-003、FR-APPROVAL-001、FR-SET-003、BR-011、BR-019、NFR-006、NFR-009

**Acceptance criteria：**
- [ ] Bank table沒有plaintext欄位，具encryption／blind-index key IDs、唯一default及duplicate indexes。
- [ ] Approval table保證每Supplier最多一個pending；Settings singleton冪等種`id=1`且approval預設OFF。
- [ ] 三支migration按`0019`、`0020`、`0021`順序在空DB、重跑及半套用情境收斂。

**Verification：**
- [ ] `npm test --workspace server -- test/migrate.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`
- [ ] Manual schema check：Bank無明文column，generated／unique／FK符合design。

**Dependencies：** T01、T02、T18

**Files likely touched：**
- `server/database/migrations/0019_create_supplier_bank_accounts.js`
- `server/database/migrations/0020_create_supplier_activation_requests.js`
- `server/database/migrations/0021_create_supplier_settings.js`
- `server/test/integration/migrations.integration.test.js`

**Estimated scope：** M（4 files）

## T26：完成 Supplier Settings 後端

**Description：** 實作typed singleton setting的read／update service與API，使用獨立permission、device-password、version、reason及transactional audit。

**Capability：** SUP-CAP-02 Approval & Settings

**Traceability：** FR-SET-002、FR-SET-003、FR-SET-004、FR-SET-005、BR-011、BR-022、SEC-007、SEC-013、AC-013、AC-036、AC-037

**Acceptance criteria：**
- [ ] Get／update只接受`supplier.settings`且write先fresh-authorize；unknown fields拒絕。
- [ ] Update鎖`id=1`、檢查version、保存before／after／reason audit，設定變更不掃描Supplier或Pending requests。
- [ ] `getActivationPolicy(connection)`可在既有transaction deterministic讀取並供create／approval／import共用。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierSettingsService.test.js test/supplierSettingsHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierSettings.integration.test.js`
- [ ] `npm run lint`

**Dependencies：** T09、T25

**Files likely touched：**
- `server/src/modules/supplier/SupplierSettingsService.js`
- `server/src/handlers/supplier-settings/settingsSchemas.js`
- `server/src/handlers/supplier-settings/settingsHandlers.js`
- `server/test/supplierSettingsService.test.js`
- `server/test/integration/supplierSettings.integration.test.js`

**Estimated scope：** M（5 files）

## T27：完成 Settings 與 Payment Terms UI

**Description：** 建立獨立Supplier Settings頁，交付approval toggle與Payment Terms管理，顯示影響、預設、目前值、最後修改及不追溯Pending的說明。

**Capability：** SUP-CAP-02 Approval & Settings

**Traceability：** FR-SET-001、FR-SET-002、FR-SET-004、FR-SET-005、FR-SET-006、AC-036、AC-037

**Acceptance criteria：**
- [ ] 只有`supplier.settings`可看到／進入頁面；直接URL與API仍分別由guard／server拒絕。
- [ ] Toggle保存要求reason、password、approved device及version；conflict重載後要求重新確認。
- [ ] Payment Terms可create／update／deactivate，沒有generic future setting或未確認規則。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/settings.test.js test/services/supplierSettings.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：toggle ON／OFF、Pending不追溯文案及Payment Term被引用停用。

**Dependencies：** T04、T26

**Files likely touched：**
- `client/src/services/supplierSettings.js`
- `client/src/pages/suppliers/SupplierSettingsPage.vue`
- `client/config/menu.js`
- `client/test/pages/suppliers/settings.test.js`

**Estimated scope：** M（4 files）

## Checkpoint I：T25–T27

- [ ] Control migrations按全域順序套用且可重跑。
- [ ] Settings API／UI、權限、audit及不追溯Pending測試通過。
- [ ] Technical／Product review接受Settings contract。

## T28：建立啟用審批 domain

**Description：** 實作approval decision、eligible approver、snapshot、submit／approve／reject／withdraw／reassign／invalidate規則，所有狀態與audit在同一transaction。

**Capability：** SUP-CAP-02 Approval & Settings

**Traceability：** FR-CREATE-007、FR-APPROVAL-001、FR-APPROVAL-002、FR-APPROVAL-003、FR-APPROVAL-004、FR-APPROVAL-005、FR-APPROVAL-006、FR-APPROVAL-007、BR-011、BR-012、BR-013、AC-008、AC-009、AC-010、AC-011、AC-012、AC-013

**Acceptance criteria：**
- [ ] Policy OFF直接Active且拒絕多餘approver；ON只接受另一名Active且目前具approval permission的人。
- [ ] Submit保存bounded snapshot／Supplier version；significant change同交易invalidate並回Draft，設定切換不追溯。
- [ ] Approve／reject／withdraw／reassign鎖定並驗證actor、assignment、request／Supplier version；重送不重複transition或audit。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierApprovalService.test.js`
- [ ] `npm run lint -- server/src/modules/supplier/SupplierApprovalService.js`
- [ ] Manual transaction review：lock order符合settings→Supplier→request→audit。

**Dependencies：** T22、T26

**Files likely touched：**
- `server/src/modules/supplier/SupplierApprovalService.js`
- `server/src/modules/supplier/SupplierAdminService.js`
- `server/test/supplierApprovalService.test.js`

**Estimated scope：** M（3 files）

## T29：完成 Approval API 與 queue

**Description：** 建立eligible approver、mine／all／unassigned queue、detail及全部approval commands的handlers與schemas，固定auth強度及最小化User projection。

**Capability：** SUP-CAP-02 Approval & Settings

**Traceability：** FR-APPROVAL-002、FR-APPROVAL-003、FR-APPROVAL-004、FR-APPROVAL-005、FR-APPROVAL-006、FR-APPROVAL-007、SEC-004、SEC-009、AC-008、AC-009、AC-010、AC-011、AC-012

**Acceptance criteria：**
- [ ] Queue預設mine，all／unassigned server-side分頁；eligible lookup只回id、username、displayName。
- [ ] Approve／reject／reassign使用jwt-password，block相關route維持device-password；每個policy精確要求view＋approval。
- [ ] 只有assigned approver可決定；任一approval holder可帶reason reassign，Bank明文不出approval response。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierApprovalHandlers.test.js test/handlerConventions.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierApproval.integration.test.js`
- [ ] Manual API check：mine／all／unassigned、self／disabled approver及stale snapshot。

**Dependencies：** T28

**Files likely touched：**
- `server/src/handlers/supplier-approvals/approvalHandlers.js`
- `server/src/handlers/supplier-approvals/approvalSchemas.js`
- `server/src/handlers/supplier-approvers/listSupplierApproversHandler.js`
- `server/test/supplierApprovalHandlers.test.js`
- `server/test/integration/supplierApproval.integration.test.js`

**Estimated scope：** M（5 files）

## T30：完成 Approval UI

**Description：** 交付approver selector、Pending panel及approval queue／detail，支援diff、批准、拒絕、撤回、重新指派與失效提示。

**Capability：** SUP-CAP-02 Approval & Settings

**Traceability：** FR-CREATE-007、FR-CREATE-008、FR-APPROVAL-003、FR-APPROVAL-004、FR-APPROVAL-005、FR-APPROVAL-006、FR-VIEW-005、AC-008、AC-010、AC-011、AC-012

**Acceptance criteria：**
- [ ] Create／activate在policy ON顯示排除自己的eligible selector；OFF不送approver。
- [ ] Queue支援mine／all／unassigned，detail顯示snapshot與current diff；stale時禁用approve。
- [ ] Approve／reject／reassign要求password，reject／reassign要求reason；Requester可withdraw且結果包含Supplier Code／status。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/approvals.test.js test/pages/suppliers/create.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual keyboard check：submit→approve、reject、withdraw、unassigned reassign及invalidate。

**Dependencies：** T11、T13、T27、T29

**Files likely touched：**
- `client/src/services/supplierApproval.js`
- `client/src/pages/suppliers/SupplierApprovalsPage.vue`
- `client/src/components/suppliers/SupplierApprovalPanel.vue`
- `client/src/pages/suppliers/SupplierCreatePage.vue`
- `client/test/pages/suppliers/approvals.test.js`

**Estimated scope：** M（5 files）

## Checkpoint J：T28–T30

- [ ] Approval domain、API及UI happy／negative flows通過。
- [ ] Queue scopes、self rule、snapshot diff及reassign audit完成。
- [ ] Client build與server lint通過。

## T31：完成 Approval 並發、安全與端到端驗收

**Description：** 用真MySQL與HTTP／UI flow驗證settings race、雙approver、stale snapshot、permission撤銷及audit一致性，作為SUP-CAP-02獨立驗收出口。

**Capability：** SUP-CAP-02 Approval & Settings

**Traceability：** FR-APPROVAL-001、FR-APPROVAL-004、FR-APPROVAL-005、FR-APPROVAL-007、FR-SET-005、BR-011、BR-012、BR-013、SEC-004、SEC-009、NFR-006、NFR-007、NFR-008、AC-007、AC-008、AC-009、AC-010、AC-011、AC-012、AC-013

**Acceptance criteria：**
- [ ] Settings toggle與activation並發產生deterministic順序；已Pending不被OFF自動批准。
- [ ] 雙approve／approve-vs-update只有一個合法terminal結果及一筆decision audit；重送idempotent。
- [ ] JWT後撤權、disabled approver、IDOR及unassigned reassign全部安全失敗／恢復，SUP-CAP-02無P0／P1 defect。

**Verification：**
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierApproval.integration.test.js test/integration/supplierSettings.integration.test.js`
- [ ] `npm test --workspace client -- test/pages/suppliers/approvals.test.js test/pages/suppliers/settings.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T27、T28、T29、T30

**Files likely touched：**
- `server/test/integration/supplierApproval.integration.test.js`
- `server/test/integration/supplierSettings.integration.test.js`
- `client/test/pages/suppliers/approvals.test.js`
- `client/test/pages/suppliers/settings.test.js`

**Estimated scope：** M（4 files）

## T32：建立 Bank crypto primitives

**Description：** 實作AES-256-GCM payload、AAD、masking及多lookup-key blind indexes，保持pure／injectable並讓任何integrity或key錯誤安全失敗。

**Capability：** SUP-CAP-03 Bank Security

**Traceability：** FR-BANK-002、FR-BANK-003、FR-BANK-007、BR-019、BR-020、SEC-010、SEC-011、NFR-010

**Acceptance criteria：**
- [ ] Encrypt每列random 96-bit IV、128-bit tag，AAD綁supplierId＋cryptoContext；tamper／搬row驗證失敗。
- [ ] Lookup ring可計算全部candidate indexes，write只用active key並回key ID；一般SHA-256不處理帳號。
- [ ] Mask短帳號不洩漏完整值；所有error／inspect／test output不含明文、key或ciphertext。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierBankCrypto.test.js test/supplierConfig.test.js`
- [ ] `npm run lint -- server/src/modules/supplier/SupplierBankCrypto.js`
- [ ] Manual review：crypto使用Node標準primitive且沒有自行設計cipher format之外的演算法。

**Dependencies：** T03、T25

**Files likely touched：**
- `server/src/modules/supplier/SupplierBankCrypto.js`
- `server/test/supplierBankCrypto.test.js`
- `server/src/modules/supplier/supplierNormalization.js`

**Estimated scope：** M（3 files）

## T33：完成 Bank domain service

**Description：** 建立masked list、create、update、default、deactivate及reveal service，統一permission freshness、duplicate、encryption、reference、lock與audit規則。

**Capability：** SUP-CAP-03 Bank Security

**Traceability：** FR-BANK-001、FR-BANK-002、FR-BANK-003、FR-BANK-004、FR-BANK-005、FR-BANK-006、BR-019、BR-020、BR-021、AC-023、AC-024、AC-025、AC-026、AC-027

**Acceptance criteria：**
- [ ] List不select encrypted columns；create／account-change才encrypt，same-Supplier duplicate阻擋、cross-Supplier只回必要warning。
- [ ] Default切換原子清舊設新；deactivate清default且尊重Payment reference，沒有Bank仍不阻止Supplier。
- [ ] Reveal先成功寫audit／commit才回request-local明文；任何audit／decrypt失敗不回帳號。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierBankService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierBank.integration.test.js`
- [ ] Manual DB check：fixture明文在Bank table、audit及system log搜尋結果為0。

**Dependencies：** T09、T24、T32

**Files likely touched：**
- `server/src/modules/supplier/SupplierBankService.js`
- `server/src/modules/supplier/supplierProjections.js`
- `server/test/supplierBankService.test.js`
- `server/test/integration/supplierBank.integration.test.js`

**Estimated scope：** M（4 files）

## Checkpoint K：T31–T33

- [ ] SUP-CAP-02獨立驗收完成。
- [ ] Bank crypto與service在fake及真MySQL測試通過。
- [ ] Bank fixture明文未出現在DB非預期欄位、audit或log。

## T34：完成 Bank API 與敏感資料邊界

**Description：** 建立masked list與Bank command handlers，將view／mgmt組合、device-password、reveal no-store及AJV白名單固定在static metadata。

**Capability：** SUP-CAP-03 Bank Security

**Traceability：** FR-VIEW-002、FR-BANK-001、FR-BANK-002、FR-BANK-005、FR-BANK-006、FR-BANK-007、SEC-002、SEC-005、SEC-006、SEC-009、SEC-013、AC-023、AC-024、AC-025、AC-026

**Acceptance criteria：**
- [ ] 所有人只由GET取得masked list；reveal是獨立POST、jwt-password、view＋bank.view及no-store response。
- [ ] Bank writes要求view＋bank.view＋bank.mgmt及jwt-device-password；child ownership／unknown fields／IDOR受拒。
- [ ] Request logging、validation details、duplicate warning與public errors均不含accountNumber或crypto metadata。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierBankHandlers.test.js test/handlerConventions.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierBank.integration.test.js`
- [ ] Manual header check：reveal含`Cache-Control: no-store, private`及`Pragma: no-cache`。

**Dependencies：** T33

**Files likely touched：**
- `server/src/handlers/suppliers/supplierBankSchemas.js`
- `server/src/handlers/suppliers/supplierBankHandlers.js`
- `server/test/supplierBankHandlers.test.js`
- `server/test/integration/supplierBank.integration.test.js`

**Estimated scope：** M（4 files）

## T35：完成 Bank UI

**Description：** 在Supplier detail交付masked Bank panel、主動reveal、create／update／default／deactivate dialogs，讓明文只存在component-local memory並自動清除。

**Capability：** SUP-CAP-03 Bank Security

**Traceability：** FR-VIEW-002、FR-BANK-001、FR-BANK-002、FR-BANK-003、FR-BANK-006、FR-BANK-007、AC-023、AC-024、AC-025、AC-026

**Acceptance criteria：**
- [ ] 初始render不呼叫reveal；有bank.view者主動輸入password後只展開單筆30秒並顯示倒數。
- [ ] 明文在close、timeout、unmount、route change及session expiry清除，不進Pinia、storage、URL、toast或hidden DOM。
- [ ] Writes要求design re-auth並在成功後清空帳號／password fields；無權限者沒有controls。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/bank.test.js test/services/supplierBank.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual browser check：DOM／storage／URL／network cache及30秒清除。

**Dependencies：** T13、T34

**Files likely touched：**
- `client/src/services/supplierBank.js`
- `client/src/components/suppliers/SupplierBankPanel.vue`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/test/pages/suppliers/bank.test.js`

**Estimated scope：** M（4 files）

## T36：完成 Encryption／Lookup key 輪替工具

**Description：** 新增兩個可續跑、bounded batch的Bank key rotation commands與reports，重用正式config／crypto並禁止舊key仍被引用時移除。

**Capability：** SUP-CAP-03 Bank Security

**Traceability：** SEC-010、SEC-011、NFR-009、NFR-010

**Acceptance criteria：**
- [ ] Encryption command只處理from key rows並用active key重加密；lookup command同交易更新index＋key ID，兩者按ID續跑。
- [ ] Transition期間BankService查全部lookup keys，舊key row count為0及duplicate report通過後才允許移除。
- [ ] CLI參數、progress、error及report不包含key、明文、ciphertext或blind index；ring超3或過渡超30日告警。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierBankKeyRotation.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierBankRotation.integration.test.js`
- [ ] Manual interrupted run：各command執行一半中止、續跑並核對old-key count。

**Dependencies：** T32、T33

**Files likely touched：**
- `server/scripts/rotateSupplierBankEncryption.js`
- `server/scripts/reindexSupplierBankBlindIndexes.js`
- `server/package.json`
- `server/test/supplierBankKeyRotation.test.js`
- `server/test/integration/supplierBankRotation.integration.test.js`

**Estimated scope：** M（5 files）

## Checkpoint L：T34–T36

- [ ] Bank API auth／projection／headers及UI memory tests通過。
- [ ] 兩個rotation commands可中斷續跑且report無敏感值。
- [ ] Security review同意後才執行Bank release驗收。

## T37：完成 Bank 安全與復原驗收

**Description：** 執行完整Bank permission matrix、no-plaintext、tamper、rotation、backup／restore及client memory驗證，形成SUP-CAP-03可簽核證據。

**Capability：** SUP-CAP-03 Bank Security

**Traceability：** FR-BANK-001、FR-BANK-002、FR-BANK-003、FR-BANK-004、FR-BANK-005、FR-BANK-006、FR-BANK-007、BR-019、BR-020、BR-021、SEC-005、SEC-006、SEC-010、SEC-011、SEC-013、NFR-009、NFR-010、AC-023、AC-024、AC-025、AC-026、AC-027

**Acceptance criteria：**
- [ ] 六種permission組合、stale claim、IDOR、re-auth、no-store及audit success／failure paths全部符合design。
- [ ] DB dump、request／system／audit logs、CSV、errors及client storage搜尋測試帳號明文結果為0。
- [ ] 帶key ring的backup可restore／reveal；缺key restore fail closed；rotation完成且SUP-CAP-03無P0／P1 defect。

**Verification：**
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierBank.integration.test.js test/integration/supplierBankRotation.integration.test.js`
- [ ] `npm test --workspace client -- test/pages/suppliers/bank.test.js`
- [ ] Manual Security／Operations review：backup、restore、rotation runbook與evidence獲批准。

**Dependencies：** T34、T35、T36

**Files likely touched：**
- `server/test/integration/supplierBank.integration.test.js`
- `server/test/integration/supplierBankRotation.integration.test.js`
- `client/test/pages/suppliers/bank.test.js`
- `docs/supplier_management/bank_operations.md`

**Estimated scope：** M（4 files）

## T38：建立 Item 依賴與 Supplier–SKU relation 後端

**Description：** 在Item正式SKU／UOM schema存在後建立soft relation migration、domain service及CRUD API；未滿足依賴時不建立無FK自由ID或runtime缺表fallback。

**Capability：** SUP-CAP-04 Supplier–SKU Sourcing

**Traceability：** FR-SKU-003、FR-SKU-004、FR-SKU-005、FR-SKU-006、BR-023、BR-024

**Acceptance criteria：**
- [ ] Migration取得當時main下一個序號，FK精確引用Item SKU／UOM並按design保留歷史及Supplier Item Code unique。
- [ ] Relation create／update驗證Supplier、SKU、UOM ownership、MOQ、lead time及preferred／alternative／stopped，絕不保存價格。
- [ ] Purchasing callback可idempotent create／update供貨紀錄，不能改Supplier／SKU狀態或建立白名單。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierRelationService.test.js test/supplierRelationHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierSkuLookup.integration.test.js`
- [ ] Manual dependency check：移除Item schema時migration明確拒絕，不建立弱化table。

**Dependencies：** T01、T24、T42；Blocked until Item SKU／UOM tables and service contract exist

**Files likely touched：**
- `server/database/migrations/<next>_create_supplier_sku_refs.js`
- `server/src/modules/supplier/SupplierRelationService.js`
- `server/src/handlers/suppliers/supplierSkuRelationHandlers.js`
- `server/test/supplierRelationService.test.js`
- `server/test/integration/supplierSkuLookup.integration.test.js`

**Estimated scope：** M（5 files）

## T39：完成 Supplier–SKU relation UI

**Description：** 在Supplier detail提供soft relation列表與維護介面，清楚顯示Supplier Item資料、UOM、MOQ、交期及關係狀態而不暗示採購限制。

**Capability：** SUP-CAP-04 Supplier–SKU Sourcing

**Traceability：** FR-VIEW-004、FR-SKU-003、FR-SKU-005、FR-SKU-006

**Acceptance criteria：**
- [ ] Relation panel可搜尋／分頁並create／updatedesign欄位，使用正式Item selector及SKU UOM。
- [ ] Preferred／alternative／stopped只顯示排序／歷史語意；UI不出現「唯一允許Supplier」文案。
- [ ] Inactive Supplier／SKU不可新建或修改為可用，但既有relation仍以history狀態顯示。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/skuRelations.test.js test/services/supplier.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：無relation、preferred、stopped及inactive Item顯示。

**Dependencies：** T13、T38

**Files likely touched：**
- `client/src/components/suppliers/SupplierSkuRelationsPanel.vue`
- `client/src/services/supplier.js`
- `client/src/pages/suppliers/SupplierDetailPage.vue`
- `client/test/pages/suppliers/skuRelations.test.js`

**Estimated scope：** M（4 files）

## Checkpoint M：T37–T39

- [ ] SUP-CAP-03安全／復原驗收已簽核。
- [ ] Supplier–SKU migration及UI使用正式Item IDs／UOM且沒有白名單語意。
- [ ] Relation capabilityfocused tests與client build通過。

## T40：完成 for-SKU lookup 與整合驗收

**Description：** 交付採購情境的for-SKU lookup，使用LEFT JOIN保留所有Active Supplier，按exact、preferred、last supplied及名稱穩定排序並在提交時重新驗證。

**Capability：** SUP-CAP-04 Supplier–SKU Sourcing

**Traceability：** FR-LIST-008、FR-SKU-001、FR-SKU-002、FR-SKU-004、FR-SKU-005、BR-023、BR-024、BR-032、NFR-005、AC-028、AC-029、AC-030、AC-031、AC-032

**Acceptance criteria：**
- [ ] 沒有relation的Active Supplier仍出現；preferred／history只改排名及reason metadata，不令無效對象可交易。
- [ ] Count不因join重複，sort具stable tie-breaker；100k Supplier基準p95符合2秒目標。
- [ ] Purchasing提交再次`assertUsable`，並以Supplier ID／SKU ID交換資料及保留交易snapshot。

**Verification：**
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierSkuLookup.integration.test.js`
- [ ] `npm test --workspace server -- test/supplierLookupService.test.js`
- [ ] Manual Purchasing contract review及EXPLAIN／load evidence。

**Dependencies：** T24、T38

**Files likely touched：**
- `server/src/modules/supplier/SupplierLookupService.js`
- `server/src/handlers/supplier-lookups/listSuppliersForSkuHandler.js`
- `server/test/supplierLookupService.test.js`
- `server/test/integration/supplierSkuLookup.integration.test.js`
- `docs/supplier_management/integration_contracts.md`

**Estimated scope：** M（5 files）

## T41：建立 Import dependencies、config 與 scheduler

**Description：** 加入成熟RFC4180 CSV dependencies、import limits、受控檔案root及scheduler設定，確保capacity、path與secret邊界在startup可驗證。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-001、FR-IMPORT-010、NFR-004、NFR-009

**Acceptance criteria：**
- [ ] csv-parse／csv-stringify只加入一次並鎖定lockfile；禁止自行`split(',')`。
- [ ] max bytes、max rows、retention及受控root是bounded config，source／result filename由server產生。
- [ ] Scheduler可分開控制precheck／worker／purge，且不跟隨symlink或離開Supplier import root。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierImportConfig.test.js test/configuration.test.js`
- [ ] `npm audit --audit-level=high`
- [ ] `npm run lint`

**Dependencies：** T03、T24

**Files likely touched：**
- `server/package.json`
- `package-lock.json`
- `server/config/supplier.js`
- `server/config/scheduler.js`
- `server/test/supplierImportConfig.test.js`

**Estimated scope：** M（5 files）

## T42：建立 Import persistence 與 worker 基線

**Description：** 建立Import job／row migrations、lease-based worker adapter及service skeleton，先固定狀態機、terminal marker及逐列transaction contract。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-002、FR-IMPORT-004、FR-IMPORT-005、FR-IMPORT-007、FR-IMPORT-010、BR-026、BR-027、NFR-006、NFR-008

**Acceptance criteria：**
- [ ] `0022`／`0023`依序建立jobs／rows、indexes、counts、lease及`applied_supplier_id`，可重跑且不早於`0021`。
- [ ] Worker只claim queued／expired lease job，按row number處理並在shutdown停止claim新job。
- [ ] Row terminal狀態與job counts可重建；success contract明定Supplier＋audit＋applied marker同一transaction。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierImportService.test.js test/supplierImportWorkerService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`
- [ ] Manual worker lifecycle check：claim、lease expiry、shutdown及resume。

**Dependencies：** T25、T41

**Files likely touched：**
- `server/database/migrations/0022_create_supplier_import_jobs.js`
- `server/database/migrations/0023_create_supplier_import_rows.js`
- `server/src/modules/supplier/SupplierImportService.js`
- `server/src/services/supplierImport/SupplierImportWorkerService.js`
- `server/test/supplierImportService.test.js`

**Estimated scope：** M（5 files）

## Checkpoint N：T40–T42

- [ ] for-SKU lookup在100k基準符合正確性與p95目標。
- [ ] Import dependencies、config、migrations及worker lifecycle tests通過。
- [ ] 沒有migration out-of-order或受控root逃逸。

## T43：完成 CSV template 與 precheck

**Description：** 交付versioned template、upload parsing及逐列precheck；只保存normalized白名單payload與可理解errors／warnings，絕不寫Supplier正式資料。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-001、FR-IMPORT-002、FR-IMPORT-003、FR-IMPORT-006、FR-IMPORT-008、BR-026、BR-028、AC-034

**Acceptance criteria：**
- [ ] RFC4180 quotes／comma／newline／BOM正確；unknown與Bank headers明確invalid，formula-risk只在export處理。
- [ ] Create row最低欄位及選填單組children驗證；upsert child欄位回`IMPORT_CHILD_UPDATE_UNSUPPORTED`，空白optional root為no change。
- [ ] Precheck逐列標create／update／warning／invalid及field reason，但Supplier tables row count不變。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierCsvSchema.test.js test/supplierImportPrecheck.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierImport.integration.test.js`
- [ ] Manual check：mixed valid／warning／invalid檔及Bank header檔。

**Dependencies：** T06、T07、T42

**Files likely touched：**
- `server/src/modules/supplier/import/supplierCsvSchema.js`
- `server/src/modules/supplier/import/SupplierImportProcessor.js`
- `server/src/handlers/supplier-imports/importTemplateUploadHandlers.js`
- `server/test/supplierCsvSchema.test.js`
- `server/test/supplierImportPrecheck.test.js`

**Estimated scope：** M（5 files）

## T44：完成 Import job 查詢與控制 API

**Description：** 建立job list／detail／confirm前狀態／cancel／result metadata handlers與client mapping，使用owner／permission、bounded pagination及stable lifecycle errors。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-002、FR-IMPORT-003、FR-IMPORT-005、FR-IMPORT-007、FR-IMPORT-010

**Acceptance criteria：**
- [ ] Upload／list／get／cancel具`supplier.mgmt`、ownership／IDOR防護、idempotency及正確terminal transitions。
- [ ] Detail逐列分頁回summary、warning／error與progress；cancel只接受尚未running job。
- [ ] 已purged file回410但job／row summary仍可查；response不回filesystem path或raw CSV payload。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierImportHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierImport.integration.test.js`
- [ ] `npm run lint`

**Dependencies：** T42、T43

**Files likely touched：**
- `server/src/handlers/supplier-imports/importSchemas.js`
- `server/src/handlers/supplier-imports/importJobHandlers.js`
- `server/src/modules/supplier/SupplierImportService.js`
- `server/test/supplierImportHandlers.test.js`
- `server/test/integration/supplierImport.integration.test.js`

**Estimated scope：** M（5 files）

## T45：完成 Confirm 與逐列原子執行

**Description：** 實作password-confirm、approval policy snapshot及worker逐列apply，封住「Supplier已commit但row仍可重做」的crash window。

**Capability：** SUP-CAP-05 Bulk Import & Export；activate mode依賴SUP-CAP-02

**Traceability：** FR-IMPORT-004、FR-IMPORT-006、FR-IMPORT-007、BR-026、BR-027、NFR-006、NFR-008、AC-033、AC-035

**Acceptance criteria：**
- [ ] Confirm同交易保存mode、policy value／version、approver及actor；activate＋approval ON要求另一名eligible approver。
- [ ] 每列先lock非terminal row，Supplier aggregate／audit／applied marker一次commit；failure rollback後才另交易標failed。
- [ ] Commit前中斷不留Supplier或marker；commit後中斷兩者同在且retry skip；雙worker只套用一次。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierImportService.test.js test/supplierImportWorkerService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierImport.integration.test.js`
- [ ] Manual fault injection：commit前／後process termination及lease takeover。

**Dependencies：** T28、T31、T42、T44

**Files likely touched：**
- `server/src/modules/supplier/SupplierImportService.js`
- `server/src/modules/supplier/import/SupplierImportProcessor.js`
- `server/src/services/supplierImport/SupplierImportWorkerService.js`
- `server/test/supplierImportService.test.js`
- `server/test/integration/supplierImport.integration.test.js`

**Estimated scope：** M（5 files）

## Checkpoint O：T43–T45

- [ ] Template／precheck／job API及confirm worker focused tests通過。
- [ ] Precheck不寫正式資料，Bank headers拒絕，partial row保持原子。
- [ ] Crash-window及雙worker idempotency由fault injection證明。

## T46：完成 Import 結果與 UI

**Description：** 完成匯入四步驟UI、job進度與逐列結果查閱／下載，並以client service統一處理active、terminal及已清理檔案狀態。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-002、FR-IMPORT-003、FR-IMPORT-005、FR-IMPORT-007、FR-IMPORT-009、FR-IMPORT-010、BR-027、NFR-004、AC-033、AC-034、AC-035

**Acceptance criteria：**
- [ ] UI依序提供upload、precheck、confirm、result；可依狀態／行號篩選，confirm前完整顯示模式、warning、error及approval影響。
- [ ] Progress、成功／失敗／跳過count及逐列reason與API一致；refresh或重新進入頁面不會重送confirm或遺失job。
- [ ] Result下載使用server filename及安全content headers；已清理檔案顯示410語意而summary仍可查，頁面不暴露path或raw payload。

**Verification：**
- [ ] `npm test --workspace client -- test/pages/suppliers/import.test.js test/services/supplierImport.test.js`
- [ ] `npm test --workspace server -- test/supplierImportResultHandlers.test.js`
- [ ] `npm run build --workspace client`及manual refresh／expired-file flow。

**Dependencies：** T44、T45

**Files likely touched：**
- `client/src/services/supplierImport.js`
- `client/src/pages/suppliers/SupplierImportPage.vue`
- `client/test/pages/suppliers/import.test.js`
- `server/src/handlers/supplier-imports/importResultHandlers.js`
- `server/test/supplierImportResultHandlers.test.js`

**Estimated scope：** M（5 files）

## T47：完成一般 Supplier Export

**Description：** 交付受權限與目前filter約束的Supplier CSV export，使用正式schema／RFC4180 writer並防止試算表公式注入；Bank資料在所有路徑永久排除。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-008、FR-IMPORT-009、FR-AUDIT-001、FR-AUDIT-002、BR-028、SEC-012、AC-040

**Acceptance criteria：**
- [ ] Export沿用Supplier list filters／sort與`supplier.mgmt`授權，欄位、header版本及encoding符合template契約。
- [ ] 任何以`=`, `+`, `-`, `@`或控制字元開頭的cell均被安全處理；逗號、引號、換行及Unicode round-trip正確。
- [ ] Bank account name／number、ciphertext、blind index及key IDs不在query、CSV、audit或errors；每次export留低敏metadata audit。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierExportService.test.js test/supplierExportHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierExport.integration.test.js`
- [ ] Manual spreadsheet check：formula payload不執行，Bank欄位搜尋結果為0。

**Dependencies：** T12、T41、T43

**Files likely touched：**
- `server/src/modules/supplier/SupplierExportService.js`
- `server/src/handlers/suppliers/supplierExportHandler.js`
- `server/test/supplierExportService.test.js`
- `server/test/integration/supplierExport.integration.test.js`

**Estimated scope：** M（4 files）

## T48：完成 Import 檔案保留與清理

**Description：** 建立受控root內的source／result檔案retention與purge job，保留job／row summary及audit，並讓清理失敗可觀測、可重試。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-005、FR-IMPORT-010、BR-027、NFR-008、NFR-009、SEC-009

**Acceptance criteria：**
- [ ] 到期source／result依設定清除，但job、逐列summary、counts與audit按七年政策保留；重跑purge具idempotency。
- [ ] 只刪除canonical Supplier import root下由server命名的regular files，拒絕`..`、absolute path、symlink及root外target。
- [ ] 刪除失敗保存低敏error code、metric及retry狀態；API對已purged檔穩定回410而非500或filesystem detail。

**Verification：**
- [ ] `npm test --workspace server -- test/supplierImportPurgeService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierImportRetention.integration.test.js`
- [ ] Manual filesystem test：expired、missing、symlink及permission-denied cases。

**Dependencies：** T41、T42、T44

**Files likely touched：**
- `server/src/services/supplierImport/SupplierImportPurgeService.js`
- `server/src/jobs/purgeSupplierImportFiles.js`
- `server/config/scheduler.js`
- `server/test/supplierImportPurgeService.test.js`
- `server/test/integration/supplierImportRetention.integration.test.js`

**Estimated scope：** M（5 files）

## Checkpoint P：T46–T48

- [ ] Import UI、result download、refresh及410流程通過client／server focused tests。
- [ ] Export RFC4180／formula-injection／no-Bank測試通過。
- [ ] Retention purge不越界且summary／audit保留，失敗可重試與告警。

## T49：完成 Import／Export 整合及容量驗收

**Description：** 以真MySQL及production-like worker配置驗證完整bulk流程、fault recovery、10,000-row容量與安全邊界，形成SUP-CAP-05簽核證據。

**Capability：** SUP-CAP-05 Bulk Import & Export

**Traceability：** FR-IMPORT-001、FR-IMPORT-002、FR-IMPORT-003、FR-IMPORT-004、FR-IMPORT-005、FR-IMPORT-006、FR-IMPORT-007、FR-IMPORT-008、FR-IMPORT-009、FR-IMPORT-010、BR-026、BR-027、BR-028、NFR-004、NFR-006、NFR-008、AC-033、AC-034、AC-035、AC-040

**Acceptance criteria：**
- [ ] Mixed create／update／warning／invalid、Draft／activate、approval ON／OFF、cancel、purge及export end-to-end結果符合逐列與job counts。
- [ ] 10,000-row檔在design環境10分鐘內完成，process memory及DB connection bounded；worker crash／lease takeover不重複套用。
- [ ] Upload、result、logs、audit及export不存在Bank／path／raw payload洩漏，惡意CSV及formula cases被安全處理。

**Verification：**
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierImport.integration.test.js test/integration/supplierExport.integration.test.js`
- [ ] `npm test --workspace client -- test/pages/suppliers/import.test.js`
- [ ] `npm run perf:supplier-import --workspace server -- --rows=10000`並保存時間、memory、DB pool及fault-injection evidence。

**Dependencies：** T45、T46、T47、T48

**Files likely touched：**
- `server/test/integration/supplierImport.integration.test.js`
- `server/test/integration/supplierExport.integration.test.js`
- `server/scripts/benchmarkSupplierImport.js`
- `client/test/pages/suppliers/import.test.js`
- `docs/supplier_management/bulk_operations.md`

**Estimated scope：** M（5 files）

## T50：完成整體效能、容量與可觀測性驗證

**Description：** 對100,000 Supplier、合理child資料量及50並發使用者執行查詢／寫入基準，補足metrics、alerts、query evidence與容量報告。

**Capability：** Cross-capability release hardening

**Traceability：** NFR-001、NFR-002、NFR-003、NFR-004、NFR-005、NFR-006、NFR-007、NFR-008、NFR-010

**Acceptance criteria：**
- [ ] List／search／detail／for-SKU p95及50-user concurrent CRUD達到design門檻，EXPLAIN證明使用預期indexes且分頁結果穩定。
- [ ] Approval queue、Bank reveal failure、import queue／lease／purge及duplicate candidate均有低敏metrics、structured logs與可行alerts。
- [ ] 容量報告記錄dataset、環境、指令、p50／p95／error rate、DB pool／CPU／memory與任何未達標項；未達標不得進release。

**Verification：**
- [ ] `npm run perf:supplier --workspace server -- --suppliers=100000 --concurrency=50`
- [ ] `npm test --workspace server -- test/supplierObservability.test.js`
- [ ] Manual SRE review：dashboard／alerts、EXPLAIN及容量報告獲批准。

**Dependencies：** T24、T31、T37、T40、T49

**Files likely touched：**
- `server/scripts/seedSupplierPerformanceFixtures.js`
- `server/scripts/benchmarkSupplierManagement.js`
- `server/src/modules/supplier/supplierMetrics.js`
- `server/test/supplierObservability.test.js`
- `docs/supplier_management/performance_report.md`

**Estimated scope：** M（5 files）

## T51：完成部署、Smoke、回歸與 Release Gate

**Description：** 彙整五個capability的自動化、真MySQL、security、operations與人工驗收證據，驗證migration／rollback／backup後才批准release。

**Capability：** SUP-CAP-01～SUP-CAP-05 Release

**Traceability：** NFR-009、SEC-001、SEC-002、SEC-003、SEC-004、SEC-005、SEC-006、SEC-007、SEC-008、SEC-009、SEC-010、SEC-011、SEC-012、SEC-013

**Acceptance criteria：**
- [ ] Fresh DB與upgrade DB migration、backup／restore、application restart及config fail-fast均通過；runbook列明rollback邊界與Bank key依賴。
- [ ] `npm run verify`、全部Supplier unit／integration／client tests、build、audit及五個capability smoke pass，無P0／P1與未批准P2。
- [ ] BA／Product Owner、Technical Lead、QA、Security及Operations對traceability、evidence與known limitations完成簽核後才標記release-ready。

**Verification：**
- [ ] `npm run verify`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration`及`npm test --workspace client`
- [ ] Manual production-like smoke：各角色、approval ON／OFF、Bank reveal、for-SKU、Import／Export、backup／restore及rollback rehearsal。

**Dependencies：** T24、T31、T37、T40、T49、T50

**Files likely touched：**
- `server/scripts/smokeSupplierManagement.js`
- `server/package.json`
- `docs/supplier_management/operations.md`
- `docs/supplier_management/release_evidence.md`
- `docs/supplier_management/tasks.md`

**Estimated scope：** M（5 files）

## Final Checkpoint：T49–T51

- [ ] SUP-CAP-05容量／安全證據、全模組效能與observability gates全部通過。
- [ ] Fresh／upgrade migration、backup／restore、rollback rehearsal及production-like smoke通過。
- [ ] 所有需求ID可由task與test evidence追蹤；指定角色完成release簽核。

## 4. 風險與實作門檻

| 風險 | 影響 | 對應控制／Task |
| --- | --- | --- |
| Supplier與Item Migration序號衝突 | Migration排序、FK及部署可能失敗 | T01先凍結全域編號；任何DDL前人工批准 |
| Bank keys或明文外洩 | 高風險資料事故 | T03、T32–T37；Security與Operations雙重gate |
| Item contract未落地 | 產生無FK relation或錯誤UOM語意 | T38 blocked至正式SKU／UOM schema及service存在 |
| Import worker crash／雙重執行 | Supplier重複或row狀態失真 | T42、T45、T49 transaction marker與fault injection |
| 100k搜尋或for-SKU退化 | 列表與採購流程超時 | T07、T40、T50以真MySQL、EXPLAIN及load gate驗證 |
| Shared hotspot平行修改 | Merge conflict或contract漂移 | §1.3單一owner規則及每2–3 task checkpoint |

## 5. 開工前與外部批准

- [ ] 使用者／Product Owner批准本`tasks.md`後才開始T01；批准task plan不等於批准release。
- [ ] T01由Technical Lead確認全域Migration allocation，並同步Supplier／Item設計與tasks。
- [ ] Finance確認初始Currency、Payment Term seed；Security／Operations確認Bank key custody、backup、rotation及re-auth設計。
- [ ] Purchasing／Item owner在T38前確認正式SKU／UOM IDs、status semantics及lookup／snapshot contract。
- [ ] Product Owner確認疑似重複threshold與Import copy；QA確認test environment、100k dataset及10,000-row performance基線。
- [ ] Release須另由BA／Product Owner、Technical Lead、QA、Security及Operations依T51簽核。

## 6. 執行與狀態更新規則

- 每次只把真正完成且驗證通過的task由`[ ]`改為`[x]`；進行中狀態寫在該task下，不以預先勾選表示承諾。
- 若實作發現design或requirement缺口，先記錄問題並取得決策，再更新受影響的traceability、acceptance與verification；不得靜默擴充scope。
- Checkpoint failure須保留命令、環境及低敏evidence，修復後重跑；Final Checkpoint通過前文件狀態保持Draft。

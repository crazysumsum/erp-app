# Item Management 開發任務分解

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 來源 | `docs/items_management/design_spec.md` 0.2 Draft |
| 產生日期 | 2026-09-04 |
| 任務狀態 | Phase A（T01–T07）已完成並 merge；Phase B 進行中（T08–T09 已完成，T10 起尚未開始） |
| 任務清單位置 | 本文件；依指定檔名，不另建 `tasks/plan.md` 或 `tasks/todo.md` |
| 技術基線 | Node.js 26、Express 5、MySQL 5.7+、Vue 3、Quasar、Pinia |

本文件同時承載 implementation plan 與可執行 task list。每個 Task 應由一個專注工作時段完成，完成時必須一併提交該切片的測試；不得只標記程式完成而略過 Verification。

## 1. 執行策略

### 1.1 交付原則

- 先處理 migration 編號衝突、權限及設定，再建立可被垂直切片使用的基礎。
- 功能以「資料庫／domain → API → client → UI → focused tests」形成可驗證切片；因單一切片過大而拆成相鄰 Tasks 時，須在緊接的 Checkpoint 完成端到端驗證。
- 每次資料修改與 `item_audit_logs` 使用同一 transaction；任何部分失敗不得留下半套 aggregate。
- 所有更新使用 optimistic version；DB unique／FK 是競態下的最後防線。
- 不修改已套用 migration，不把 Item 業務規則放進 `server/src/framework/`，不修改共用 `DataTable.vue` 來容納商品專用篩選。
- Phase 3 的 import、duplicate check 及 bulk status 不得提前塞進核心 CRUD Task。

### 1.2 已發現的實作前置差異

目前 repository 已存在 `server/database/migrations/0009_add_user_email.js`，但設計規格仍把 Item permission migration 命名為 `0009`。實作前必須保留既有 migration，將 Item migrations 整體順延：

| 設計規格編號 | 實際實作編號 | 內容 |
| --- | --- | --- |
| 0009 | 0010 | Item permissions |
| 0010–0023 | 0011–0024 | Catalog、Item／SKU、UOM／Barcode、Attribute、Media、Audit |
| 0024–0025 | 0025–0026 | Import jobs／rows |

這個差異由 Task T01 先回寫 `design_spec.md`，後續 Tasks 一律使用實際編號 `0010`–`0026`。不得覆寫或重新命名既有 `0009_add_user_email.js`。

### 1.3 依賴主幹

```text
T01 migration freeze
 ├─ T02 permissions
 ├─ T03 config/constants
 └─ T04 catalog schema
      ├─ T05–T07 catalog slices
      └─ T08–T12 core persistence/domain/read
           ├─ T13–T20 core CRUD/lifecycle UI
           ├─ T21 lookup + T22 integration
           ├─ T23–T24 attributes/variants
           ├─ T25–T26 media
           └─ T27–T34 import/export/bulk
                    └─ T35 performance → T36 release readiness
```

### 1.4 全域完成定義

每個 Checkpoint 除其專屬條件外，均須滿足：

- [ ] `npm run lint` 通過。
- [ ] 受影響 workspace 的 focused tests 通過，且沒有跳過應執行的測試。
- [ ] 新 API 具 request／response schema、後端權限驗證及公開錯誤映射。
- [ ] 新寫入路徑具成功、拒絕、rollback、audit 及 stale-version 測試。
- [ ] 不降低現有 coverage floor；Checkpoint PR 前執行 `npm run test:coverage`。
- [ ] 有前端改動時執行 `npm run build --workspace client`。

## 2. 任務索引

### Phase A：基礎與 Catalog

- [x] T01 修正 migration 編號並凍結實作映射
- [x] T02 建立 Item 權限目錄與 seed
- [x] T03 建立 Item 設定、常數與公開錯誤基礎
- [x] T04 建立 Category、Brand、UOM schema
- [x] T05 完成 Category 管理切片
- [x] T06 完成 Brand 與 UOM 管理切片
- [x] T07 完成 Catalog 整合、權限與頁面 metadata 驗證

### Phase B：核心 Item／SKU

- [x] T08 建立 Item、SKU 與 Audit schema
- [x] T09 建立 SKU UOM 與 Barcode schema
- [ ] T10 建立核心驗證與 Barcode 規則
- [ ] T11 建立 Item Audit service 與查詢 API
- [ ] T12 建立 Item／SKU 列表與詳情後端
- [ ] T13 建立商品導航與列表頁
- [ ] T14 建立 Item＋初始 SKU 原子建檔後端
- [ ] T15 建立 Item／SKU 建檔頁與基本 Editor
- [ ] T16 建立 Item／SKU aggregate 更新後端
- [ ] T17 建立 Item／SKU 詳情與編輯頁
- [ ] T18 建立 Item／SKU 生命週期後端
- [ ] T19 建立生命週期與狀態操作 UI
- [ ] T20 建立受控刪除、複製、SKU Code 修改與 Barcode 釋放
- [ ] T21 建立下游 ItemLookupService contract
- [ ] T22 完成核心端到端、並發與安全驗證

### Phase C：零售消耗品擴充

- [ ] T23 建立 Attribute schema、variant signature 與 domain 規則
- [ ] T24 完成 Attribute／Variant API 與 UI
- [ ] T25 建立 Media schema、service、API 與孤兒檔清理
- [ ] T26 建立 Media UI 與檔案安全整合測試

### Phase D：批量能力

- [ ] T27 建立 Import persistence、dependencies 與 worker 設定
- [ ] T28 建立 CSV preflight processor
- [ ] T29 建立 Import confirm／execution／result API
- [ ] T30 建立 Import UI
- [ ] T31 建立 SKU Export
- [ ] T32 建立疑似重複商品提示
- [ ] T33 建立 bounded bulk status change
- [ ] T34 建立 Import 檔案保留清理

### Phase E：非功能與交付

- [ ] T35 完成效能、容量及營運可觀測性驗證
- [ ] T36 完成部署文件、Smoke、回歸及 Release Gate

## 3. 詳細任務

### Task T01：修正 migration 編號並凍結實作映射

**Description:** 保留既有 `0009_add_user_email.js`，把設計規格的 Item migrations 順延至 `0010`–`0026`，先消除會導致覆寫歷史 migration 的阻塞風險。

**Acceptance criteria:**

- [x] `design_spec.md` 的 §5.15、§9.1、§9.5、Phase 0 與 migration tests 引用全部改用 `0010`–`0026`。
- [x] 既有 `0001`–`0009` 檔名及內容不變，且新舊編號沒有重複。
- [x] migration 映射仍保持 FK 依賴順序，並經開發與 DBA review。

**Verification:**

- [x] `find server/database/migrations -maxdepth 1 -type f -print | sort`
- [x] `npm test --workspace server -- test/migrate.test.js`

**Dependencies:** None

**Files likely touched:**

- `docs/items_management/design_spec.md`
- `server/test/migrate.test.js`

**Estimated scope:** S（1–2 files）

### Task T02：建立 Item 權限目錄與 seed

**Description:** 新增 `item.view`、`item.mgmt`，以冪等 migration 授予 `system-admin`，並修正 permission catalogue 測試使其支援多支 seed migration。

**Acceptance criteria:**

- [x] Permission catalogue 精確包含兩個新權限，沒有隱含 inheritance。
- [x] `0010_seed_item_management_permissions.js` 可重跑，並只授予既定 system-admin。
- [x] catalogue、seed 與 startup guard 不一致時測試會失敗。

**Verification:**

- [x] `npm test --workspace server -- test/permissionCatalogueConventions.test.js test/permissionCatalogueStartupGuard.test.js`
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`

**Dependencies:** T01

**Files likely touched:**

- `server/src/modules/authorization/permissionCatalogue.js`
- `server/database/migrations/0010_seed_item_management_permissions.js`
- `server/test/permissionCatalogueConventions.test.js`
- `server/test/integration/migrations.integration.test.js`

**Estimated scope:** M（3–5 files）

### Task T03：建立 Item 設定、常數與公開錯誤基礎

**Description:** 建立受控 media／import 設定、啟動期 normalizer，以及全模組共用的狀態、價格口徑、保留期和公開錯誤常數。

**Acceptance criteria:**

- [x] `applicationConfiguration.item` 驗證路徑、容量、批次與 timeout 上下限，錯誤在 startup 顯示。
- [x] HKD、`tax_not_applicable`、狀態、tracking policy、barcode type、sort whitelist 及 1 年 import file retention 只有一個定義來源。
- [x] `.env.example` 只暴露部署設定，不允許環境變數覆寫固定價格口徑。

**Verification:**

- [x] `npm test --workspace server -- test/itemConfig.test.js test/configuration.test.js`
- [x] `npm run lint -- server/config/item.js server/src/modules/item`

**Dependencies:** T01

**Files likely touched:**

- `server/config/item.js`
- `server/src/modules/item/normalizeItemConfig.js`
- `server/src/modules/item/itemConstants.js`
- `server/src/modules/item/itemErrors.js`
- `server/src/framework/configuration/applicationConfiguration.js`

**Estimated scope:** M（3–5 logical files；`.env.example` 同步記錄）

## Checkpoint A：T01–T03 基礎凍結

- [x] Migration 編號無衝突，既有 migration checksum／內容不變。
- [x] Permission seed 在空 DB 與已套用 DB 均可收斂。
- [x] Server startup、focused tests、lint 全部通過。
- [x] Review 同意後才建立商品資料表。

### Task T04：建立 Category、Brand、UOM schema

**Description:** 以 `0011`–`0013` 建立三個共享 Catalog 表，完成 generated scope、unique key、FK、狀態及 optimistic version 欄位。

**Acceptance criteria:**

- [x] Category root／同父名稱唯一、self FK、Brand 名稱唯一及 UOM Code 唯一由 DB 保證。
- [x] 欄位型別、collation、delete rule、索引及共通 audit columns 符合 §5.3–§5.5。
- [x] 每支 migration 可重跑，半套 DDL 不會阻止下一次收斂。

**Verification:**

- [x] `npm test --workspace server -- test/migrate.test.js`
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`

**Dependencies:** T01, T03

**Files likely touched:**

- `server/database/migrations/0011_create_item_categories.js`
- `server/database/migrations/0012_create_item_brands.js`
- `server/database/migrations/0013_create_item_uoms.js`
- `server/test/integration/migrations.integration.test.js`

**Estimated scope:** M（4 files）

### Task T05：完成 Category 管理切片

**Description:** 實作 Category tree、建立、更新、移動、狀態與受控刪除，連接後端 API、client service 及 Category 頁面。

**Acceptance criteria:**

- [x] Tree 最大 8 層；拒絕 self／descendant cycle、inactive parent 及有 child／Item 的刪除。
- [x] GET 使用 `item.view`，寫入使用 `item.mgmt`，archive／restore／delete 使用 `jwt-password`。
- [x] 頁面可用 parent selector 移動，顯示 version conflict 及不可刪原因，後端仍獨立重驗。

**Verification:**

- [x] `npm test --workspace server -- test/itemCatalogService.test.js test/itemCatalogHandlers.test.js`
- [x] `npm test --workspace client -- test/services/itemCatalog.test.js test/pages/items/catalogPages.test.js`
- [ ] Manual check：建立 8 層 tree、嘗試 cycle／第 9 層／刪除有子節點分類（尚未實際喺瀏覽器手動操作過，只有自動化測試同 API smoke test 覆蓋）。

**Dependencies:** T02, T03, T04

**Files likely touched:**

- `server/src/modules/item/ItemCatalogService.js`
- `server/src/handlers/catalog/categoryHandlers.js`
- `client/src/services/itemCatalog.js`
- `client/src/pages/items/CategoriesPage.vue`
- `server/test/itemCatalogService.test.js`

**Estimated scope:** M（5 logical files；handler/page tests 同切片）

### Task T06：完成 Brand 與 UOM 管理切片

**Description:** 在既有 Catalog pattern 上完成 Brand、UOM 的分頁／小目錄查詢、CRUD、狀態、version 及 in-use delete 保護。

**Acceptance criteria:**

- [x] Brand 名稱及 UOM Code 的大小寫唯一衝突映射為穩定公開錯誤。
- [ ] 被 Item、SKU UOM、Attribute 或 net content 使用時不可永久刪除——按 design_spec.md §8.4 的 reference-guard 延後原則，Item／SKU／Attribute 等表尚未建立，這部分保護要等對應表存在、T08 之後才能接上並驗證；本階段只完成 Brand／UOM 自身欄位（名稱、Code）唯一性保護。
- [x] Brands／UOM pages 正確處理只讀、管理、高風險認證及 empty／error state。

**Verification:**

- [x] `npm test --workspace server -- test/itemCatalogService.test.js test/itemCatalogHandlers.test.js`
- [x] `npm test --workspace client -- test/services/itemCatalog.test.js test/pages/items/catalogPages.test.js`
- [ ] Manual check：建立、停用、恢復 Brand／UOM，驗證使用中刪除提示（尚未實際喺瀏覽器手動操作過，只有自動化測試同 API smoke test 覆蓋）。

**Dependencies:** T02, T03, T04

**Files likely touched:**

- `server/src/modules/item/ItemCatalogService.js`
- `server/src/handlers/catalog/brandHandlers.js`
- `server/src/handlers/catalog/uomHandlers.js`
- `client/src/pages/items/BrandsPage.vue`
- `client/src/pages/items/UomsPage.vue`

**Estimated scope:** M（5 logical files；共用 schema／tests 隨切片更新）

## Checkpoint B：T04–T06 Catalog 可用

- [x] 三個 Catalog migration、service、API、client 與頁面測試通過。
- [x] `item.view` 與 `item.mgmt` 分權在 UI 與後端一致。
- [x] `npm run build --workspace client` 與 coverage floor 通過。
- [ ] 手動完成 Category、Brand、UOM 最小 CRUD flow（尚未實際喺瀏覽器手動操作過，只有自動化測試同 API smoke test 覆蓋）。

### Task T07：完成 Catalog 整合、權限與頁面 metadata 驗證

**Description:** 補齊 Catalog 的真 MySQL、HTTP、route discovery、menu metadata 與 security matrix，避免薄 handler 或前端隱藏按鈕成為唯一防線。

**Acceptance criteria:**

- [x] 真 DB 證明 generated unique、FK RESTRICT、version compare-and-set 與 migration rerun。
- [x] 未登入、只有 view、只有 mgmt、stale permission 的所有 Catalog 路徑符合 401／403 規則。
- [x] Static routes 不被 `/items/:id` 誤接，非 menu 頁不出現在 sidebar。

**Verification:**

- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemCatalog.integration.test.js`
- [x] `npm test --workspace client -- test/pages/system/pages.test.js test/framework/routing/router.test.js`

**Dependencies:** T05, T06

**Files likely touched:**

- `server/test/integration/itemCatalog.integration.test.js`
- `server/test/itemCatalogHandlers.test.js`
- `client/test/pages/system/pages.test.js`
- `client/test/framework/routing/router.test.js`

**Estimated scope:** M（4 files）

### Task T08：建立 Item、SKU 與 Audit schema

**Description:** 建立 `0014_create_items.js`、`0015_create_item_skus.js`，鎖定主資料、價格、狀態、時間、版本與 audit projection 所需欄位。`0024_create_item_audit_logs.js` 已在 T04 提前建立（見該檔案開頭說明：不依賴 items／skus，先建好讓 Catalog 寫入路徑從一開始就能正確寫稽核），本任務不再重覆。

**Acceptance criteria:**

- [x] Item 沒有 `item_code`、tenant、cost 或 tax setting 欄位；SKU Code 全域不分大小寫唯一。
- [x] SKU price 用 `DECIMAL(19,4)`，tracking／shelf-life／effective fields 與索引符合 §5.7。
- [x] Audit target 不設 FK、actor 使用 `SET NULL`，歷史在 target 刪除後仍保留（T04 已驗證，見 `0024 built item_audit_logs...` 測試）。

**Verification:**

- [x] `npm test --workspace server -- test/migrate.test.js`
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`（沿用 T04 建立嘅同一份整合測試檔案延伸，跟實際做法一致；下面「Files likely touched」同步更正）

**Dependencies:** T01, T02, T04

**Files likely touched:**

- `server/database/migrations/0014_create_items.js`
- `server/database/migrations/0015_create_item_skus.js`
- `server/test/integration/migrations.integration.test.js`

**Estimated scope:** M（3 files）

### Task T09：建立 SKU UOM 與 Barcode schema

**Description:** 以 `0016`、`0017` 建立包裝換算與條碼表，使用 generated unique slots 及 composite FK 保護 ownership。

**Acceptance criteria:**

- [x] DB 阻止同 SKU 多個 base／default purchase／default sale 及全域重複 normalized barcode。
- [x] Composite FK 阻止 Barcode 指向其他 SKU 的 UOM；Archived barcode 仍佔用唯一值（barcode 表本身沒有 status 欄位，封存是 SKU／SKU UOM 層級的狀態變更，不會刪除或釋放 barcode 列，唯一值天生持續佔用；真正的刪除只有 T20 的「barcode release」高風險端點）。
- [x] MySQL 5.7 真實整合測試覆蓋 generated columns、collation、FK delete rules 與唯一性（序列化重複寫入測試，證明 unique key 本身存在且生效）。並發（`Promise.all` 兩個真正同時的請求）留給 design_spec.md §11.2 明確指定嘅 `itemConcurrency.integration.test.js`——那是 T22 嘅任務，涵蓋整個 Item 功能的並發場景（version CAS、SKU Code、barcode、variant signature、Base UOM、最後一個 Active SKU 停用），現在單獨為 T09 先做一次会是提前重複 T22 的工作。

**Verification:**

- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/migrations.integration.test.js`（沿用 T04／T08 建立嘅同一份整合測試檔案延伸，跟實際做法一致；下面「Files likely touched」同步更正。並發測試檔案留給 T22。）

**Dependencies:** T04, T08

**Files likely touched:**

- `server/database/migrations/0016_create_item_sku_uoms.js`
- `server/database/migrations/0017_create_item_sku_barcodes.js`
- `server/test/integration/migrations.integration.test.js`

**Estimated scope:** M（3 files）

## Checkpoint C：T07–T09 Persistence Gate

- [ ] Migration 從空 DB 可一次完成，第二次全為 safe skip／no-op。
- [ ] Catalog、Item、SKU、UOM、Barcode、Audit schema 的索引及 FK 已由真 MySQL 證明。
- [ ] 沒有修改 `init.sql` 或既有 migrations。
- [ ] Review schema 後才開始核心 aggregate service。

### Task T10：建立核心驗證與 Barcode 規則

**Description:** 實作 activatability、狀態、decimal-string、UOM 整數、日期及 barcode normalization／GTIN check digit 等純 domain 規則。

**Acceptance criteria:**

- [ ] `assertSkuActivatable()` 一次回傳全部 issues，無條碼仍可啟用，Sellable Active 必須有正 RRP。
- [ ] Base UOM factor／交易量只接受有界整數；decimal 欄不經 JavaScript floating point 計算。
- [ ] GTIN-8／UPC-A／EAN-13／GTIN-14 及 internal barcode 的合法、非法與 Unicode 邊界均有測試。

**Verification:**

- [ ] `npm test --workspace server -- test/itemValidation.test.js test/barcodeValidation.test.js`
- [ ] `npm run lint -- server/src/modules/item/itemValidation.js server/src/modules/item/barcodeValidation.js`

**Dependencies:** T03, T04, T08, T09

**Files likely touched:**

- `server/src/modules/item/itemValidation.js`
- `server/src/modules/item/barcodeValidation.js`
- `server/test/itemValidation.test.js`
- `server/test/barcodeValidation.test.js`

**Estimated scope:** M（4 files）

### Task T11：建立 Item Audit service 與查詢 API

**Description:** 建立 append-only `ItemAuditLogService`、固定 action vocabulary、白名單 detail 及分頁查詢 API，與 user audit 保持領域分離。

**Acceptance criteria:**

- [ ] 寫入可接收 caller transaction connection，不能在業務 transaction 外另開 query。
- [ ] Audit detail 不保存 password、token、device key、整份 CSV、檔案內容或未受限 body。
- [ ] `GET /api/v1/item-audit/logs` 只允許 `item.view`，固定排序並支援規定 filters。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAuditLogService.test.js test/itemAuditHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemAudit.integration.test.js`

**Dependencies:** T02, T03, T08

**Files likely touched:**

- `server/src/modules/item/ItemAuditLogService.js`
- `server/src/handlers/item-audit/listItemAuditLogsHandler.js`
- `server/src/handlers/item-audit/itemAuditSchemas.js`
- `server/test/itemAuditLogService.test.js`
- `server/test/itemAuditHandlers.test.js`

**Estimated scope:** M（5 files）

### Task T12：建立 Item／SKU 列表與詳情後端

**Description:** 在 `ItemAdminService` 實作 Item／SKU 分頁、精確與模糊搜尋、filters、sort whitelist 及白名單 response projection，完成 read handlers。

**Acceptance criteria:**

- [ ] SKU exact Code／Barcode 優先，LIKE wildcard 被 escape，Item 查詢用 `EXISTS` 避免重複及錯誤 total。
- [ ] 回應只包含設計欄位，RRP 固定組成 HKD／`tax_not_applicable`，不直接 spread DB row。
- [ ] 所有 GET 只接受 `item.view`；只有 `item.mgmt` 而沒有 view 仍回 403。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAdminService.test.js test/itemHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemRead.integration.test.js`

**Dependencies:** T02, T08, T09, T10

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/items/listItemsHandler.js`
- `server/src/handlers/items/getItemHandler.js`
- `server/src/handlers/skus/listSkusHandler.js`
- `server/src/handlers/skus/getSkuHandler.js`

**Estimated scope:** M（5 logical files；schemas／tests 同切片）

## Checkpoint D：T10–T12 Read Model Gate

- [ ] Pure rules、Audit 及 read API focused tests 通過。
- [ ] 真 DB 查詢與 projection 不洩漏內部欄位。
- [ ] Read permission matrix 與 response schema 通過。
- [ ] 以 seed data 手動驗證 Code、Barcode、Name、Archived filter。

### Task T13：建立商品導航與列表頁

**Description:** 新增 items menu、`ItemsPage.vue`、Item client service 與 URL-synchronised filters，預設顯示 SKU 平鋪視圖。

**Acceptance criteria:**

- [ ] 搜尋 debounce 300ms，page／sort／view／q／filters 可從 URL 還原。
- [ ] `item.view` 可進入列表；寫入 actions 只有 `item.mgmt` 顯示，Archived 預設隱藏。
- [ ] Static routes 與 `/items/:id` 無衝突，列表不修改共用 `DataTable.vue`。

**Verification:**

- [ ] `npm test --workspace client -- test/services/item.test.js test/pages/items/items.test.js`
- [ ] `npm test --workspace client -- test/framework/discovery/pages.test.js test/framework/routing/router.test.js`
- [ ] Manual check：重新整理及分享帶 filters 的 URL，結果保持一致。

**Dependencies:** T05, T06, T07, T12

**Files likely touched:**

- `client/config/menu.js`
- `client/src/services/item.js`
- `client/src/pages/items/ItemsPage.vue`
- `client/test/services/item.test.js`
- `client/test/pages/items/items.test.js`

**Estimated scope:** M（5 files）

### Task T14：建立 Item＋初始 SKU 原子建檔後端

**Description:** 實作 `createItem()` 與 create handler，使 Standard／Variant Item、至少一個 SKU、UOM／Barcode 集合、直接 Active 及 audit 在單一 transaction 完成。

**Acceptance criteria:**

- [ ] 任一 SKU、UOM、Barcode 或 audit 失敗時 Item aggregate 全部 rollback。
- [ ] Standard 恰好一個 SKU；Variant 組合不可重複；SKU Code／Barcode unique race 映射為公開錯誤。
- [ ] Create API 啟用 idempotency；建檔人可直接啟用但仍須通過完整性及 `item.mgmt` 驗證。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAdminService.test.js test/itemHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemCreate.integration.test.js`

**Dependencies:** T08, T09, T10, T11

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/items/itemSchemas.js`
- `server/src/handlers/items/createItemHandler.js`
- `server/src/handlers/skus/createSkuHandler.js`
- `server/test/itemAdminService.test.js`

**Estimated scope:** M（5 logical files；integration test 同切片）

### Task T15：建立 Item／SKU 建檔頁與基本 Editor

**Description:** 建立 `ItemCreatePage`、`SkuCreatePage` 及 Item／SKU／UOM／Barcode／Tracking／Price 基本 editors，接通 Draft 與直接啟用兩條 flow。

**Acceptance criteria:**

- [ ] 「儲存 Draft」與「儲存並啟用」分開；後端 issues 對應欄位並保留輸入。
- [ ] SKU Code 接受任意合法人工格式；Barcode 選填；價格 UI 固定顯示 HKD／`tax_not_applicable`。
- [ ] Dirty route leave／browser unload、鍵盤操作、focusable error summary 及狀態文字均可測。

**Verification:**

- [ ] `npm test --workspace client -- test/pages/items/itemCreate.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：建立 Standard Draft、Variant Active、無 Barcode Active 及驗證失敗保留草稿。

**Dependencies:** T06, T13, T14

**Files likely touched:**

- `client/src/pages/items/ItemCreatePage.vue`
- `client/src/pages/items/SkuCreatePage.vue`
- `client/src/components/items/ItemBasicForm.vue`
- `client/src/components/items/SkuEditor.vue`
- `client/src/components/items/SkuUomEditor.vue`

**Estimated scope:** M（5 logical files；Barcode／Tracking／Price 子元件與測試同切片）

## Checkpoint E：T13–T15 Create Flow

- [ ] system-admin 可由 menu 進入、建立 Draft 及直接 Active Item。
- [ ] 只有 view 的使用者看得到列表但看不到／不能呼叫 create。
- [ ] Create idempotency、rollback、audit 與前端錯誤回填全部通過。
- [ ] Client build、server/client coverage 通過。

### Task T16：建立 Item／SKU aggregate 更新後端

**Description:** 實作 Item 與 SKU 更新、整組替換 UOM／Barcode／attributes 的 transaction 及 optimistic version，區分普通 RRP 與關鍵變更 reason 規則。

**Acceptance criteria:**

- [ ] Stale version 回 `VERSION_CONFLICT`，不寫資料或 audit；child ID 不屬 SKU 回 `SKU_CHILD_MISMATCH`。
- [ ] 有交易／庫存後不可直接改 SKU Code、Base UOM、factor 或 tracking policy；關鍵變更 reason 必填。
- [ ] 純 RRP 更新可不填 reason，但 audit 保存前後 amount、HKD、tax basis、actor 及時間。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAdminService.test.js test/itemHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemUpdate.integration.test.js`

**Dependencies:** T10, T11, T14

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/items/updateItemHandler.js`
- `server/src/handlers/skus/updateSkuHandler.js`
- `server/src/handlers/skus/skuSchemas.js`
- `server/test/itemAdminService.test.js`

**Estimated scope:** M（5 logical files；integration test 同切片）

### Task T17：建立 Item／SKU 詳情與編輯頁

**Description:** 建立 Item／SKU detail routes、tabs 及 editor reuse，支援 version conflict、readonly Code、UOM／Barcode 集合與 RRP 編輯。

**Acceptance criteria:**

- [ ] `item.view` 可看完整詳情；`item.mgmt` 才顯示／執行 edit，直接 URL 仍由 API 防護。
- [ ] Version conflict 重新載入最新資料但保留使用者草稿供比較，不自動重送。
- [ ] UOM base/default 防呆、Barcode ownership、RRP 固定口徑及 server issues 均正確呈現。

**Verification:**

- [ ] `npm test --workspace client -- test/pages/items/itemDetail.test.js test/pages/items/skuDetail.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：兩個瀏覽器分頁製造 stale version，確認不覆蓋先完成的修改。

**Dependencies:** T13, T15, T16

**Files likely touched:**

- `client/src/pages/items/ItemDetailPage.vue`
- `client/src/pages/items/SkuDetailPage.vue`
- `client/src/components/items/SkuBarcodeEditor.vue`
- `client/src/components/items/TrackingPolicyFields.vue`
- `client/src/components/items/SuggestedPriceField.vue`

**Estimated scope:** M（5 logical files；tests 同切片）

### Task T18：建立 Item／SKU 生命週期後端

**Description:** 實作 activate、deactivate、discontinue、archive、restore 狀態機，按 DEC-024 在同一 transaction 實際同步受影響 children。

**Acceptance criteria:**

- [ ] Item deactivate、discontinue、archive 原子同步 SKU；任一 child 失敗時 Item、全部 SKU、flags 及 audit rollback。
- [ ] Item restore 只到 Inactive，不自動 restore／activate SKU；Active Item 不可單獨停用最後一個 Active SKU。
- [ ] 各 route 使用設計指定的 `jwt`／`jwt-password`、`item.mgmt`、reason 及 version。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAdminService.test.js test/itemHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemLifecycle.integration.test.js`

**Dependencies:** T11, T16

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/items/itemStatusHandlers.js`
- `server/src/handlers/skus/skuStatusHandlers.js`
- `server/test/itemAdminService.test.js`
- `server/test/integration/itemLifecycle.integration.test.js`

**Estimated scope:** M（5 logical files；每支 endpoint 仍各自 export handler）

## Checkpoint F：T16–T18 Core Mutation Gate

- [ ] Update、version、child ownership 與所有 lifecycle transitions 通過。
- [ ] DEC-024 cascade 及 rollback 由 unit 與真 DB integration 同時證明。
- [ ] RRP 可選 reason 與關鍵欄位必填 reason 沒有互相污染。
- [ ] API auth metadata 及 error response 不洩漏 SQL／constraint。

### Task T19：建立生命週期與狀態操作 UI

**Description:** 在列表與詳情頁加入合法 row actions、影響預覽、PasswordReasonDialog 及 restore flow，狀態以文字與 icon 呈現。

**Acceptance criteria:**

- [ ] UI 只顯示目前狀態合法的動作，Item 操作前顯示受影響 SKU 數及不可逆後果。
- [ ] Discontinue／Archive／Restore 走 password reauth 並帶 reason；Deactivate 使用明確確認。
- [ ] Restore 後不把 SKU 顯示為自動 Active，需明確逐一恢復／啟用。

**Verification:**

- [ ] `npm test --workspace client -- test/pages/items/items.test.js test/pages/items/itemDetail.test.js test/pages/items/skuDetail.test.js`
- [ ] Manual check：Item deactivate → restore → 選定 SKU activate，全程核對狀態與 audit。

**Dependencies:** T17, T18

**Files likely touched:**

- `client/src/services/item.js`
- `client/src/pages/items/ItemsPage.vue`
- `client/src/pages/items/ItemDetailPage.vue`
- `client/src/pages/items/SkuDetailPage.vue`
- `client/test/pages/items/itemDetail.test.js`

**Estimated scope:** M（5 files）

### Task T20：建立受控刪除、複製、SKU Code 修改與 Barcode 釋放

**Description:** 完成 Draft delete、Item copy、SKU Code 特批修改、Barcode release 的後端與對應 UI actions，維持高強度認證及完整稽核。

**Acceptance criteria:**

- [ ] 永久刪除只允許未引用 Draft，且不可令 Item 零 SKU；copy 不複製 Barcode 並要求每個新 SKU Code。
- [ ] Code change／Barcode release 使用 `jwt-device-password`、reason、version、全域唯一與 audit before／after。
- [ ] UI 不以一般 edit 偷改 Code／刪 Barcode；所有高風險 dialog 清楚列出 target 與後果。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAdminService.test.js test/itemHandlers.test.js`
- [ ] `npm test --workspace client -- test/services/item.test.js test/pages/items/skuDetail.test.js`
- [ ] Manual check：未核准設備、錯密碼、duplicate Code、被引用 Draft 均無資料變更。

**Dependencies:** T16, T17, T18, T19

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/items/itemHighRiskHandlers.js`
- `server/src/handlers/skus/skuHighRiskHandlers.js`
- `client/src/services/item.js`
- `client/src/pages/items/SkuDetailPage.vue`

**Estimated scope:** M（5 logical files；focused tests 同切片）

### Task T21：建立下游 ItemLookupService contract

**Description:** 建立只供後端下游模組使用的 ID／Code／Barcode／批量 lookup，按 purchase／sale／inventory purpose 套用狀態、有效期與 flags。

**Acceptance criteria:**

- [ ] Purchase 拒絕 Discontinued；Sale 允許合資格 Discontinued 清貨；Inventory 按 tracking 與 includeInactive 規則運作。
- [ ] Projection 包含 SKU ID、UOM factor、tracking、shelf life 及 minimum receipt／sale life，不要求 `item.view`。
- [ ] `findManyByIds(100)` 使用固定少量 queries，不產生 N+1；重複 Barcode 視為資料事故而非任選第一筆。

**Verification:**

- [ ] `npm test --workspace server -- test/itemLookupService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemLookup.integration.test.js`

**Dependencies:** T12, T18

**Files likely touched:**

- `server/src/modules/item/ItemLookupService.js`
- `server/test/itemLookupService.test.js`
- `server/test/integration/itemLookup.integration.test.js`

**Estimated scope:** M（3 files）

## Checkpoint G：T19–T21 Core Feature Complete

- [ ] Core Item／SKU CRUD、狀態、高風險操作及 Lookup 均有可用 end-to-end path。
- [ ] Read-only、management、password、device-password 權限矩陣通過。
- [ ] 下游 purchase／sale／inventory contract 經真 DB 驗證。
- [ ] Client build 與全量 server/client tests 通過。

### Task T22：完成核心端到端、並發與安全驗證

**Description:** 建立 design §11.2–§11.4 的核心 HTTP＋DB、race、IDOR、input、projection 與 permission regression suite。

**Acceptance criteria:**

- [ ] 端到端涵蓋 Catalog → Variant Item＋兩 SKU → 搜尋 → 更新 → lifecycle → audit → cleanup。
- [ ] 同 version、SKU Code、Barcode、Base UOM 及 last-active race 只有合法請求成功。
- [ ] 401／403／stale permission、LIKE escape、sort whitelist、XSS text、IDOR 與 error redaction 全部有斷言。

**Verification:**

- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemManagement.integration.test.js test/integration/itemConcurrency.integration.test.js`
- [ ] `npm test --workspace server -- test/security.test.js test/itemHandlers.test.js`

**Dependencies:** T07, T19, T20, T21

**Files likely touched:**

- `server/test/integration/itemManagement.integration.test.js`
- `server/test/integration/itemConcurrency.integration.test.js`
- `server/test/itemHandlers.test.js`
- `server/test/security.test.js`

**Estimated scope:** M（4 files）

### Task T23：建立 Attribute schema、variant signature 與 domain 規則

**Description:** 以 `0018`–`0022` 建立 Attribute definition／option／category mapping／typed values，並完成 deterministic variant signature。

**Acceptance criteria:**

- [ ] Typed value 僅有一個 value column 有值，category mapping 與 option FK delete rules 符合設計。
- [ ] Signature 不受輸入順序影響；同 Item 相同組合由 `(item_id, variant_signature)` 擋下。
- [ ] Active SKU 使用中的 data type／variant flag 不可破壞性修改，Unicode normalization 有固定測試向量。

**Verification:**

- [ ] `npm test --workspace server -- test/variantSignature.test.js test/itemValidation.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemAttributeMigrations.integration.test.js`

**Dependencies:** T04, T08, T10

**Files likely touched:**

- `server/database/migrations/0018_create_item_attribute_definitions.js`
- `server/database/migrations/0019_create_item_attribute_options.js`
- `server/database/migrations/0020_create_item_category_attributes.js`
- `server/database/migrations/0021_create_item_attribute_values.js`
- `server/database/migrations/0022_create_item_sku_attribute_values.js`

**Estimated scope:** M（5 logical files；`variantSignature.js` 與 tests 同切片）

### Task T24：完成 Attribute／Variant API 與 UI

**Description:** 擴充 Catalog service／handlers 與 Item editors，支援 Attribute CRUD、options、category rules、typed values 及 Variant matrix。

**Acceptance criteria:**

- [ ] Attribute option 更新與 category assignment 原子執行，`expectedAttributeIds` stale 時拒絕覆蓋。
- [ ] Variant Item 必須有完整且唯一組合；Standard Item 不接受 variant values。
- [ ] Attributes page 與 VariantMatrixEditor 支援資料型別、選項、必填及錯誤回填。

**Verification:**

- [ ] `npm test --workspace server -- test/itemCatalogService.test.js test/itemAdminService.test.js`
- [ ] `npm test --workspace client -- test/pages/items/catalogPages.test.js test/pages/items/itemCreate.test.js`
- [ ] Manual check：建立 Flavor options，產生兩個 Variant SKU，嘗試重複組合。

**Dependencies:** T05, T17, T23

**Files likely touched:**

- `server/src/modules/item/ItemCatalogService.js`
- `server/src/handlers/catalog/attributeHandlers.js`
- `client/src/pages/items/AttributesPage.vue`
- `client/src/components/items/AttributeValueEditor.vue`
- `client/src/components/items/VariantMatrixEditor.vue`

**Estimated scope:** M（5 logical files；tests 同切片）

## Checkpoint H：T22–T24 Retail Data Gate

- [ ] 核心安全／並發 suite 綠燈。
- [ ] Attribute migrations、typed values、signature 與 UI flow 完成。
- [ ] Standard／Variant 邊界與 duplicate combination 在 service、DB、UI 三層一致。
- [ ] Full coverage 與 client build 通過。

### Task T25：建立 Media schema、service、API 與孤兒檔清理

**Description:** 建立 `0023_create_item_media.js`、ItemMediaService、upload／download／update／delete handlers 及 `ItemMediaCleanupJob`，處理 DB 與檔案系統非原子一致性。

**Acceptance criteria:**

- [ ] 只接受 PNG／JPEG／WebP／PDF 的合法 extension、MIME、signature 及大小；拒絕 SVG、polyglot、traversal、symlink 越界。
- [ ] DB commit 前失敗清 orphan；delete 先提交 metadata／audit 再 unlink，失敗記 log 並由 cleanup 重試。
- [ ] Primary image unique、SKU／Item ownership composite FK、download headers 及 stored path 白名單正確。

**Verification:**

- [ ] `npm test --workspace server -- test/itemMediaService.test.js test/itemMediaCleanupJob.test.js test/itemFileHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemMedia.integration.test.js`

**Dependencies:** T03, T08, T11, T16

**Files likely touched:**

- `server/database/migrations/0023_create_item_media.js`
- `server/src/modules/item/ItemMediaService.js`
- `server/src/handlers/item-media/`
- `server/src/services/itemMedia/ItemMediaCleanupJob.js`
- `server/config/scheduler.js`

**Estimated scope:** M（5 logical files／directories；focused tests 同切片）

### Task T26：建立 Media UI 與檔案安全整合測試

**Description:** 建立 client media service、ItemMediaPanel、上傳進度、preview、primary、排序與刪除操作，補齊 browser-facing security regression。

**Acceptance criteria:**

- [ ] FormData 不手動設定 multipart boundary；boolean／integer／version 以後端明確可解析格式提交。
- [ ] 圖片安全 inline preview，PDF 只下載；無 view／mgmt 權限時分別隱藏或拒絕。
- [ ] Upload abort、超限、錯 signature、DB failure、delete unlink failure 均有可理解 UI／log 結果。

**Verification:**

- [ ] `npm test --workspace client -- test/services/itemMedia.test.js test/pages/items/itemMedia.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：上傳四種 allowlist 檔案、拒絕 SVG、切換 primary、刪除後重新整理。

**Dependencies:** T17, T25

**Files likely touched:**

- `client/src/services/itemMedia.js`
- `client/src/components/items/ItemMediaPanel.vue`
- `client/src/pages/items/ItemDetailPage.vue`
- `client/src/pages/items/SkuDetailPage.vue`
- `client/test/pages/items/itemMedia.test.js`

**Estimated scope:** M（5 files）

### Task T27：建立 Import persistence、dependencies 與 worker 設定

**Description:** 新增 CSV libraries、`0025`／`0026` import tables、worker／scheduler settings 與 config normalization，先建立可重入 Job state persistence。

**Acceptance criteria:**

- [ ] Jobs／Rows 欄位、索引、lease、version、`files_purged_at` 與 FK 符合 §5.13。
- [ ] `csv-parse`／`csv-stringify` 版本鎖定；10,000 rows、batch、transaction timeout 設定有安全上限。
- [ ] Validation、execution、retention cleanup 使用不同 scheduler job／lock key，設定錯誤在 startup 被拒。

**Verification:**

- [ ] `npm test --workspace server -- test/itemConfig.test.js test/itemImportWorkerService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemImportMigrations.integration.test.js`

**Dependencies:** T01, T03, T08, T11

**Files likely touched:**

- `server/database/migrations/0025_create_item_import_jobs.js`
- `server/database/migrations/0026_create_item_import_rows.js`
- `server/package.json`
- `package-lock.json`
- `server/config/scheduler.js`

**Estimated scope:** M（5 logical files；worker config tests 同切片）

## Checkpoint I：T25–T27 Files and Jobs Foundation

- [ ] Media end-to-end、安全與 cleanup 測試通過。
- [ ] Import schema、libraries、scheduler registration 及 config guards 通過。
- [ ] 所有檔案路徑限定於 configured roots，錯誤不回絕對路徑。
- [ ] Full tests、client build、security audit 通過。

### Task T28：建立 CSV preflight processor

**Description:** 建立 versioned CSV template、RFC 4180 parsing、mapping、normalization、逐列 validation 與 all-or-nothing preflight；預檢不得改商品表。

**Acceptance criteria:**

- [ ] 正確處理 BOM、quoted comma／newline、Unicode、未知欄、欄位上限及 10,000 rows。
- [ ] 任一 invalid row 令 Job 不能 confirm；errors／warnings 有界且可下載，不含 stack／SQL。
- [ ] Upsert 使用 SKU ID＋expected version 配對，不能藉 CSV 繞過 SKU Code 特批流程。

**Verification:**

- [ ] `npm test --workspace server -- test/itemImportService.test.js test/itemImportProcessor.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemImport.integration.test.js`

**Dependencies:** T10, T14, T16, T23, T27

**Files likely touched:**

- `server/src/modules/item/import/itemCsvSchema.js`
- `server/src/modules/item/import/ItemImportProcessor.js`
- `server/src/modules/item/ItemImportService.js`
- `server/src/services/itemImport/ItemImportWorkerService.js`
- `server/src/services/itemImport/jobs/validateItemImportJob.js`

**Estimated scope:** M（5 logical files；tests 同切片）

### Task T29：建立 Import confirm／execution／result API

**Description:** 完成 upload、list、get、confirm、cancel、result handlers 與 execution worker，使用 lease、idempotency、單一商品 transaction 及失敗後短交易更新 Job。

**Acceptance criteria:**

- [ ] Confirm 只接受 ready Job、`jwt-password`、version；重送不重複建立，cancel 只允許設計狀態。
- [ ] Execution 重新驗證 catalog／unique／SKU version，任一 row 失敗整批商品變更 rollback；Job 最終狀態仍可靠更新。
- [ ] Result download 使用受控 path；已到期回 `410 IMPORT_FILE_EXPIRED`，Job summary 仍可查。

**Verification:**

- [ ] `npm test --workspace server -- test/itemImportService.test.js test/itemImportHandlers.test.js test/itemImportWorkerService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemImport.integration.test.js`

**Dependencies:** T22, T27, T28

**Files likely touched:**

- `server/src/modules/item/ItemImportService.js`
- `server/src/services/itemImport/jobs/executeItemImportJob.js`
- `server/src/handlers/item-imports/itemImportSchemas.js`
- `server/src/handlers/item-imports/`
- `server/test/integration/itemImport.integration.test.js`

**Estimated scope:** M（5 logical files／directories；handler tests 同切片）

### Task T30：建立 Import UI

**Description:** 建立 Import client service 與 ItemImportsPage，完成 template、upload、poll、row errors、confirm、cancel 及 result download flow。

**Acceptance criteria:**

- [ ] UI 明確區分 preflight 與 execution；有任何 invalid row 時不能確認且不誤顯示已寫入。
- [ ] Poll 支援 abort／route leave，不建立重複 timer；confirm 使用 password signing。
- [ ] 檔案過期顯示不可下載但保留 Job summary／audit，不以一般 500 呈現。

**Verification:**

- [ ] `npm test --workspace client -- test/services/itemImport.test.js test/pages/items/itemImports.test.js`
- [ ] `npm run build --workspace client`
- [ ] Manual check：valid／invalid CSV、重複 confirm、執行失敗與 410 expired result。

**Dependencies:** T13, T29

**Files likely touched:**

- `client/src/services/itemImport.js`
- `client/src/pages/items/ItemImportsPage.vue`
- `client/test/services/itemImport.test.js`
- `client/test/pages/items/itemImports.test.js`

**Estimated scope:** M（4 files）

## Checkpoint J：T28–T30 Import End-to-End

- [ ] 10,000-row preflight、confirm、execute、rollback、poll、result 全流程可用。
- [ ] Invalid batch 對商品表零寫入；duplicate confirm 零重複。
- [ ] Lease 接手、abort、timeout、失敗狀態與 UI 恢復測試通過。
- [ ] CSV 內容及路徑不進 audit／log／error response。

### Task T31：建立 SKU Export

**Description:** 建立依目前 SKU filters 匯出的 UTF-8 CSV，沿用固定價格口徑、時間格式、白名單欄位及 audit。

**Acceptance criteria:**

- [ ] Export filters 與列表語意一致，輸出 HKD／`tax_not_applicable`、ISO 8601＋offset 及穩定欄位順序。
- [ ] 不輸出 stored path、audit IP、internal hash、成本或未授權欄位。
- [ ] 只有 `item.mgmt` 可匯出，每次成功／失敗均有合適 audit／log，不保存整份 CSV 到 audit。

**Verification:**

- [ ] `npm test --workspace server -- test/itemExportHandlers.test.js`
- [ ] `npm test --workspace client -- test/services/itemImport.test.js test/pages/items/itemImports.test.js`
- [ ] Manual check：用相同 filters 比較列表 total 與 CSV records。

**Dependencies:** T11, T12, T30

**Files likely touched:**

- `server/src/handlers/item-exports/exportSkusHandler.js`
- `server/src/modules/item/ItemAdminService.js`
- `client/src/services/itemImport.js`
- `client/src/pages/items/ItemImportsPage.vue`
- `server/test/itemExportHandlers.test.js`

**Estimated scope:** M（5 files）

### Task T32：建立疑似重複商品提示

**Description:** 建立 deterministic duplicate candidate service／API 及 create-flow warning，按 normalized name、brand、category、variant summary 回最多 10 筆。

**Acceptance criteria:**

- [ ] 結果可解釋、順序穩定、有上限；不使用 fuzzy black box、自動合併或阻擋合法建立。
- [ ] API 只允許 `item.mgmt`，輸入與 sort 使用白名單及 parameterized query。
- [ ] Create UI 顯示候選並允許使用者確認繼續，idempotency 不受重複提示影響。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAdminService.test.js test/itemHandlers.test.js`
- [ ] `npm test --workspace client -- test/pages/items/itemCreate.test.js`
- [ ] Manual check：建立相似名稱候選後仍可確認建立新 Item。

**Dependencies:** T14, T15, T22, T24

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/items/checkItemDuplicatesHandler.js`
- `client/src/services/item.js`
- `client/src/pages/items/ItemCreatePage.vue`
- `client/test/pages/items/itemCreate.test.js`

**Estimated scope:** M（5 files）

### Task T33：建立 bounded bulk status change

**Description:** 建立最多 100 筆 Item／SKU 的全有全無批量狀態 API 與列表 UI，重用單筆狀態規則並固定鎖定順序。

**Acceptance criteria:**

- [ ] 只接受 1–100 IDs、expected versions、合法 action、reason、password；不支援永久刪除。
- [ ] 先按 ID 排序鎖 rows，再驗證全部 targets；任一失敗時零狀態／flag／audit 變更。
- [ ] UI 顯示 target 數、預檢阻擋、全有全無語意及每個 target 結果。

**Verification:**

- [ ] `npm test --workspace server -- test/itemAdminService.test.js test/itemBulkHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemManagement.integration.test.js`
- [ ] `npm test --workspace client -- test/services/item.test.js test/pages/items/items.test.js`

**Dependencies:** T18, T19, T22

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/item-bulk/changeItemStatusBulkHandler.js`
- `client/src/services/item.js`
- `client/src/pages/items/ItemsPage.vue`
- `server/test/itemBulkHandlers.test.js`

**Estimated scope:** M（5 files）

## Checkpoint K：T31–T33 Bulk Operations

- [ ] Export、duplicate warning、bulk status 的 API／UI／audit 全部完成。
- [ ] Bulk 100 成功、101 拒絕及中間一筆失敗全 rollback 通過。
- [ ] Export 資料白名單與 CSV injection／formula handling 經 security review。
- [ ] Full server/client tests 與 build 通過。

### Task T34：建立 Import 檔案保留清理

**Description:** 建立 1 年 import source／result file cleanup job，以 UTC 周年日、terminal Job、受控路徑及 compare-and-set 更新 `files_purged_at`。

**Acceptance criteria:**

- [ ] 未滿 1 年、非 terminal、root 外、symlink 或已被其他 Job 引用的檔案不刪除。
- [ ] 部分 unlink 失敗可安全重跑；只有全部應刪檔案成功後標記 `files_purged_at`，並留下結構化 log。
- [ ] Job summary／rows／audit 至少保留 7 年且詳情仍可查；result download 回 410。

**Verification:**

- [ ] `npm test --workspace server -- test/itemImportFileCleanupJob.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemImport.integration.test.js`

**Dependencies:** T27, T29

**Files likely touched:**

- `server/src/services/itemImport/ItemImportFileCleanupJob.js`
- `server/config/scheduler.js`
- `server/src/modules/item/ItemImportService.js`
- `server/test/itemImportFileCleanupJob.test.js`

**Estimated scope:** M（4 files）

### Task T35：完成效能、容量及營運可觀測性驗證

**Description:** 建立 100,000 SKU／1,000,000 Barcode／1,000,000 UOM rows 的可重複壓測資料與混合負載，驗證 50 concurrent users、每日 1,000 次變更比例及 10,000-row import KPI。

**Acceptance criteria:**

- [ ] Exact Code／Barcode、首頁與常用 filters 在混合負載下 p95 < 2 秒，`EXPLAIN` 無不合理 full scan。
- [ ] Preflight＋execution 系統處理時間合計 ≤ 10 分鐘，期間一般 lookup 仍 p95 < 2 秒。
- [ ] Metrics／logs 可觀察 API latency、error rate、constraint conflict、queue age、running duration、lease recovery、media cleanup failure，且不含敏感 payload。

**Verification:**

- [ ] 執行並保存 `server/test/performance/itemManagement.performance.test.js` 的環境、資料量與結果摘要。
- [ ] `npm test --workspace server -- test/databasePoolPressure.test.js test/logQueueBudget.test.js`
- [ ] Review `EXPLAIN`、pool queue、deadlock／retry、error rate，未達標時只做有證據的索引／query 修正。

**Dependencies:** T21, T22, T24, T26, T30, T31, T33, T34

**Files likely touched:**

- `server/test/performance/itemManagement.performance.test.js`
- `server/test-support/itemPerformanceFixtures.js`
- `server/src/modules/item/ItemAdminService.js`
- `server/src/modules/item/ItemLookupService.js`
- `server/src/services/logging/`

**Estimated scope:** M（5 logical files／directories）

### Task T36：完成部署文件、Smoke、回歸及 Release Gate

**Description:** 完成 README、部署／回滾、初始 Catalog、scheduler、media persistence、合規前置確認及最終自動／手動驗收，產出可簽核的 release evidence。

**Acceptance criteria:**

- [ ] README 記錄 migration、設定、持久化 volume、workers、固定價格口徑、backup／restore、forward-only rollback 與 smoke steps。
- [ ] 業務提供首版 Category／UOM／Attribute／internal Barcode 樣本；合規核對 DEC-023，差異已回寫 requirement／design／tests。
- [ ] AC-001–AC-037 有可追溯測試或人工證據，沒有未分類失敗、跳過的必跑測試或未核准 scope change。

**Verification:**

- [ ] `npm run verify`
- [ ] `npm run build --workspace client`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server`
- [ ] Manual smoke：Draft → Active → Code／Barcode search → update → deactivate／restore → audit → media → import／export。

**Dependencies:** T35 and all earlier Tasks

**Files likely touched:**

- `README.md`
- `docs/items_management/requirement.md`
- `docs/items_management/design_spec.md`
- `docs/items_management/test_case.md`
- Release evidence／testing report（由 QA 流程建立）

**Estimated scope:** M（文件、測試與 release evidence）

## Checkpoint L：T34–T36 Release Ready

- [ ] Retention、安全、效能、容量、備份與回滾要求全部有證據。
- [ ] `npm run verify`、client production build、真 MySQL integration 全綠。
- [ ] Migration 在 staging 由現行版本升級及重跑均成功。
- [ ] 業務、開發、QA、營運及合規完成各自簽核項目。
- [ ] Release 可進入正式測試；本 Task 清單不等同測試執行報告。

## 4. Parallelization 建議

| 條件 | 可平行工作 | 不可平行／需先凍結 |
| --- | --- | --- |
| T01–T04 完成後 | T05 Category 與 T06 Brand／UOM | 共享 `ItemCatalogService` 與 schemas，合併前需協調 |
| T10–T12 完成後 | T13 List UI、T14 Create backend、T21 Lookup | API response projection 與 constants 必須先凍結 |
| T18 完成後 | T19 Lifecycle UI、T20 High-risk、T22 tests | 不可同時無協調修改 `ItemAdminService` |
| T23 完成後 | T24 Attributes、T25 Media | 兩者可獨立，但都會修改 Item detail／aggregate mapping |
| T27 完成後 | T28 Preflight 與 T34 retention scaffolding | Job state machine 與 file ownership contract 先凍結 |
| T29 完成後 | T30 Import UI、T31 Export、T32 Duplicate、T33 Bulk | 共用 client services／ItemsPage 的工作需小步合併 |

同一 shared file 有兩個進行中的 Task 時，不應平行實作；可改為先合併 service／schema contract，再讓 UI 或測試 Task 平行。

## 5. 風險與緩解

| 風險 | 影響 | 緩解 |
| --- | --- | --- |
| `0009` migration 已被佔用 | 高：可能覆寫歷史或順序錯誤 | T01 先順延並回寫設計；禁止改既有 migration |
| Item aggregate／狀態同步交易過大 | 高：部分寫入或 deadlock | 固定 lock order、有界 child arrays、同 transaction audit、真 DB race tests |
| MySQL 5.7 generated unique／collation 行為 | 高：重複 Base UOM、Code 或 Barcode | Migration integration 直接在 MySQL 5.7+ 驗證，不用 mock 代替 |
| 10,000-row all-or-nothing transaction | 高：timeout、pool starvation | Preflight、batch preparation、明確 timeout、scheduler abort、壓測期間監控 pool |
| DB 與檔案系統不能同 transaction | 中：孤兒檔或 metadata 指向缺檔 | Commit ordering、grace cleanup、重跑冪等及失敗 log |
| 未來下游表加入 SKU 引用 | 中：刪除／封存 guard 不完整 | 第一個真引用出現時加 FK、ReferenceService 及 integration test |
| 初始 Catalog／Barcode 樣本未提供 | 中：UAT 與資料 seed 延遲 | 不阻塞核心開發，但 T36 前必須由業務提供並驗證 |
| 保留期限尚待合規核對 | 中：清理太早或保存不足 | 1 年／7 年作營運下限；T36 前合規核對，只允許延長後同步更新測試 |

## 6. 開放問題與非開發依賴

核心 Item／SKU 模型目前沒有未決需求問題。以下不是開發者可自行決定的欄位或示例值：

- [ ] 業務提供首版 Category、UOM、Attribute 及 internal Barcode 規則樣本。
- [ ] 合規人員在正式上線前核對 DEC-023；如要求更長期限，更新 requirement、design、cleanup 與 tests。
- [ ] 未來 Receiving 模組實作 `receiving.override_shelf_life`、必填原因及完整 audit；本模組只交付 shelf-life policy lookup contract。
- [ ] 第一個 Purchasing／Inventory／Sales 真實 SKU FK 出現時，再建立 `ItemReferenceService`；本期不建立空 interface。

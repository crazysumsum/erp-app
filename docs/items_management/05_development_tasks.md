# Item Management Development Tasks (Harness Aligned)

## Harness alignment and no-loss rule

| Item | Value |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Legacy source | `tasks.md`, SHA-256 `a496a29dc97db9aa04f8f166d3d9d816e655e29a3bda2d2908b40a2783f7e5f9` |
| Original size | 1,533 lines; 303 checked boxes; 42 unchecked boxes |
| Preservation | Full legacy body and every checkbox state retained verbatim below |
| Product-code change | None |

The legacy body is the authoritative development-progress record. Alignment adds aliases and remediation work but does not reinterpret an unchecked historical box as checked. In particular, the Task Index has T23 unchecked while its detailed section contains completed implementation evidence; this is recorded as `STATUS_INCONSISTENT`, not silently corrected.

## Phase alignment

### PHASE-001 — Foundation and Catalog (legacy Phase A)

- Objective/checkpoint: permissions, configuration, schema and Catalog slices are usable.
- Included: TASK-001 (PHASE-001) through TASK-007 (PHASE-001).
- Requirements/design: FR-032 through FR-043; SEC-001, SEC-002, SEC-008; DES-002, DES-007, DES-009, DES-010.
- Verification/evidence: developer records in legacy Checkpoints A–B; formal independent acceptance `NOT_RUN`.
- Branch/PR/merge: already merged historically. No new merge action is implied by this review.
- Exit/status: `COMPLETE_RECORDED`, subject to current-code findings.

### PHASE-002 — Core Item/SKU (legacy Phase B)

- Objective/checkpoint: read/create/update/lifecycle/lookup vertical flows.
- Included: TASK-008 (PHASE-002) through TASK-022 (PHASE-002).
- Requirements/design: FR-001 through FR-031, FR-039 through FR-049, FR-059 through FR-064; SEC-001 through SEC-009; DES-003, DES-005, DES-006, DES-007, DES-008, DES-010, DES-012, DES-014, DES-015.
- Verification/evidence: developer records in legacy Checkpoints C–G; formal independent acceptance `NOT_RUN`.
- Branch/PR/merge: already merged historically.
- Exit/status: `COMPLETE_RECORDED`, with deferred downstream reference guard.

### PHASE-003 — Retail extensions (legacy Phase C)

- Objective/checkpoint: Attributes/Variants and Media.
- Included: TASK-023 (PHASE-003) through TASK-026 (PHASE-003).
- Requirements/design: FR-011, FR-012, FR-015, FR-018, FR-025; SEC-007, SEC-008, SEC-009; NFR-011, NFR-012; DES-004, DES-011, DES-014, DES-015.
- Verification/evidence: developer records in legacy Checkpoint H and T25/T26. T23 status remains inconsistent.
- Branch/PR/merge: already merged historically.
- Exit/status: `COMPLETE_RECORDED_WITH_STATUS_INCONSISTENCY`.

### PHASE-004 — Bulk capabilities (legacy Phase D)

- Objective/checkpoint: Import/Export, duplicate hints and bounded bulk status.
- Included: TASK-027 (PHASE-004) through TASK-034 (PHASE-004).
- Requirements/design: FR-050 through FR-058; FR-059 through FR-064; SEC-001 through SEC-009; NFR-005, NFR-006, NFR-011; DES-002, DES-012, DES-013.
- Verification/evidence: developer records in legacy Checkpoints I–K; independent acceptance `NOT_RUN`.
- Branch/PR/merge: already merged historically.
- Exit/status: `COMPLETE_RECORDED`, but import transactional-audit alignment is open.

### PHASE-005 — Non-functional and delivery (legacy Phase E)

- Objective/checkpoint: capacity, operations, deployment evidence and release readiness.
- Included: TASK-035 (PHASE-005) and TASK-036 (PHASE-005).
- Requirements/design: NFR-001 through NFR-015; SEC-001 through SEC-009; DES-016, DES-017, DES-018, DES-019.
- Verification/evidence: developer Round 1 evidence exists. Staging upgrade, independent QA/UAT, business/Ops/compliance sign-off and RTO/RPO exercise remain pending.
- Branch/PR/merge: implementation already merged; acceptance sign-off is not complete.
- Exit/status: `CONDITIONAL`.

### PHASE-006 — Alignment remediation (new)

- Objective/checkpoint: close current design/implementation gaps without rewriting historical progress.
- Included: TASK-037 (PHASE-006) through TASK-044 (PHASE-006).
- Requirements/design: all canonical FR/NFR/SEC through DES-004, DES-008, DES-009, DES-012, DES-013, DES-014, DES-015, DES-018, DES-020.
- Entry: owner approves remediation scope; branch from refreshed `main` in a dedicated worktree.
- Integration impact: Item API projections, frontend routes/components, Catalog delete errors, import transaction/audit behavior and operational evidence.
- Acceptance: targeted technical cases pass, regression suite/build pass, browser flows pass where UI changes exist, required CI passes, reviewers approve.
- PR/merge trigger: developer self-tests PASS → commit/push → required CI PASS → review/approval → merge. Split into small vertical PRs in dependency order; do not combine operational sign-off with code changes.
- Rollback: safe revert for code; forward-only corrective migration if schema changes become necessary.
- Cleanup: remove merged worktree and local/remote topic branch.
- Exit/status: `PLANNED`; no remediation was implemented in this review.

## Canonical task aliases and preserved status

| Canonical task | Parent | Legacy task | Status |
| --- | --- | --- | --- |
| TASK-001 | PHASE-001 | T01 | COMPLETE_RECORDED |
| TASK-002 | PHASE-001 | T02 | COMPLETE_RECORDED |
| TASK-003 | PHASE-001 | T03 | COMPLETE_RECORDED |
| TASK-004 | PHASE-001 | T04 | COMPLETE_RECORDED |
| TASK-005 | PHASE-001 | T05 | COMPLETE_RECORDED |
| TASK-006 | PHASE-001 | T06 | COMPLETE_RECORDED |
| TASK-007 | PHASE-001 | T07 | COMPLETE_RECORDED |
| TASK-008 | PHASE-002 | T08 | COMPLETE_RECORDED |
| TASK-009 | PHASE-002 | T09 | COMPLETE_RECORDED |
| TASK-010 | PHASE-002 | T10 | COMPLETE_RECORDED |
| TASK-011 | PHASE-002 | T11 | COMPLETE_RECORDED |
| TASK-012 | PHASE-002 | T12 | COMPLETE_RECORDED |
| TASK-013 | PHASE-002 | T13 | COMPLETE_RECORDED |
| TASK-014 | PHASE-002 | T14 | COMPLETE_RECORDED |
| TASK-015 | PHASE-002 | T15 | COMPLETE_RECORDED |
| TASK-016 | PHASE-002 | T16 | COMPLETE_RECORDED |
| TASK-017 | PHASE-002 | T17 | COMPLETE_RECORDED |
| TASK-018 | PHASE-002 | T18 | COMPLETE_RECORDED |
| TASK-019 | PHASE-002 | T19 | COMPLETE_RECORDED |
| TASK-020 | PHASE-002 | T20 | COMPLETE_RECORDED |
| TASK-021 | PHASE-002 | T21 | COMPLETE_RECORDED |
| TASK-022 | PHASE-002 | T22 | COMPLETE_RECORDED |
| TASK-023 | PHASE-003 | T23 | STATUS_INCONSISTENT: index unchecked; detailed evidence says completed |
| TASK-024 | PHASE-003 | T24 | COMPLETE_RECORDED |
| TASK-025 | PHASE-003 | T25 | COMPLETE_RECORDED |
| TASK-026 | PHASE-003 | T26 | COMPLETE_RECORDED |
| TASK-027 | PHASE-004 | T27 | COMPLETE_RECORDED |
| TASK-028 | PHASE-004 | T28 | COMPLETE_RECORDED |
| TASK-029 | PHASE-004 | T29 | COMPLETE_RECORDED |
| TASK-030 | PHASE-004 | T30 | COMPLETE_RECORDED |
| TASK-031 | PHASE-004 | T31 | COMPLETE_RECORDED |
| TASK-032 | PHASE-004 | T32 | COMPLETE_RECORDED |
| TASK-033 | PHASE-004 | T33 | COMPLETE_RECORDED |
| TASK-034 | PHASE-004 | T34 | COMPLETE_RECORDED |
| TASK-035 | PHASE-005 | T35 | COMPLETE_RECORDED |
| TASK-036 | PHASE-005 | T36 | COMPLETE_RECORDED; release checkpoint conditional |

## New remediation tasks

### TASK-037 — Complete Attribute/Variant detail projections

- Parent Phase: PHASE-006.
- Goal: return persisted Item attribute and SKU variant values through API/client/UI.
- Requirement/design: FR-011, FR-012, FR-015, FR-018, FR-025; DES-004, DES-014, DES-015.
- Components: ItemAdminService, item/sku response schemas, client services/pages and focused tests.
- Acceptance: stored typed values are readable; schema no longer caps arrays at zero; Standard/Variant rules and ownership checks remain enforced.
- Approved response contract (`HD-003`, 2026-09-14): Item values return `attributeId`, definition `code`/`name`, `dataType`, typed `value`, and nullable option `{ id, value, label }`; SKU Variant values use the same fields but remain the existing `single_option` domain with a required option. Both are stably ordered by Category Attribute `sort_order`, then attribute ID. Attribute writes and arbitrary typed SKU Variant values are out of scope.
- Verification: unit/integration contract tests plus Playwright Item/SKU detail flow; lint and client build.
- Dependencies: TASK-023 (PHASE-003), TASK-024 (PHASE-003). Risk: high data-visibility gap. Rollback: revert compatible projection/UI changes.
- Definition of Done/status: tests and CI pass, review approved; `PLANNED`.

### TASK-038 — Implement retained standalone SKU creation contract

- Parent Phase: PHASE-006.
- Goal: implement the add-SKU flow for existing Variant Items retained by human decision `HD-001` on 2026-09-11.
- Requirement/design: FR-017, FR-018, FR-019, FR-021; DES-003, DES-008, DES-015.
- Components: API schema/handler/service/client/page only after decision.
- Acceptance: a manager can add a complete, unique SKU to an existing Variant Item; duplicate combinations and additions to Standard Items are rejected; atomicity, authorization, audit, idempotency and UI flows pass.
- Verification: API/database tests and Playwright happy/negative flows; lint/build/CI.
- Dependencies: TASK-037 (PHASE-006); `HD-001` scope decision is answered. Risk: high functional incompleteness. Rollback: disable/revert the incomplete route without deleting the retained requirement.
- Definition of Done/status: decision and implementation evidence linked; `PLANNED`.

### TASK-039 — Deliver user-facing audit history

- Parent Phase: PHASE-006.
- Goal: expose the existing authorized audit query through Item/SKU user flows.
- Requirement/design: FR-013, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064; DES-012, DES-015.
- Components: audit client, route/page or embedded timeline, permission-aware UI tests.
- Acceptance: authorized users can filter/read complete before/after/reason context; unauthorized users cannot infer records.
- Verification: API regression and Playwright audit/403/empty/error flows; console/network clean; build/CI.
- Dependencies: existing audit API. Risk: high compliance visibility gap. Rollback: revert UI route/client.
- Definition of Done/status: acceptance evidence attached; `PLANNED`.

### TASK-040 — Normalize referenced Brand/UOM deletion errors

- Parent Phase: PHASE-006.
- Goal: translate current FK-reference failures to stable `CATALOG_IN_USE` semantics.
- Requirement/design: FR-034, FR-035, FR-037, FR-038; SEC-008; DES-009.
- Components: ItemCatalogService and focused true-MySQL tests.
- Acceptance: referenced Brand/UOM delete returns documented conflict without partial delete/audit; unreferenced deletion still succeeds atomically.
- Verification: service/integration race and rollback tests; full Item regression and CI.
- Dependencies: current Item/SKU schema. Risk: high API correctness. Rollback: revert service error mapping.
- Definition of Done/status: deterministic tests pass; `PLANNED`.

### TASK-041 — Align CSV import with aggregate validation and transactional audit

- Parent Phase: PHASE-006.
- Goal: apply create/update rows through a shared domain contract and write per-aggregate audit in the same execution transaction.
- Requirement/design: FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062; NFR-006; SEC-007, SEC-008; DES-002, DES-012, DES-013.
- Components: import processor/worker, Item domain service, audit payload and integration tests.
- Acceptance: UI/API/import validation is equivalent; reason propagates; every imported create/update is auditable; injected failure rolls back data and audit together; 10,000-row bound remains measurable.
- Verification: true-MySQL transaction, race, retry, failure-injection, audit and performance regression; required CI.
- Dependencies: contract design before code. Risk: high data integrity/compliance. Rollback: disable import execution and revert code; no partial schema downgrade.
- Definition of Done/status: independent P0/P1 cases pass; `PLANNED`.

### TASK-042 — Reconcile historical T23/checkpoint status

- Parent Phase: PHASE-006.
- Goal: obtain maintainer confirmation for the contradictory T23 index and detailed record without altering history during this alignment.
- Requirement/design: documentation integrity for DES-016.
- Components: this document only in a later authorized reconciliation.
- Acceptance: maintainer-approved status note explains whether the index was an omission; original commit evidence remains linked.
- Verification: before/after checkbox count and Git history audit.
- Dependencies: human maintainer decision. Risk: medium traceability ambiguity. Rollback: restore this preserved baseline.
- Definition of Done/status: `PLANNED`.

### TASK-043 — Integrate first real downstream reference guard

- Parent Phase: PHASE-006.
- Goal: when Purchasing/Inventory/Sales introduces a real SKU reference, add FK/provider guards for destructive and critical lifecycle changes.
- Requirement/design: FR-030, FR-031, FR-034, FR-037, FR-038; SEC-008; DES-003, DES-020.
- Components: owning downstream module contract, ItemReferenceService only when the variation exists, transaction/contract tests.
- Acceptance: referenced data cannot be deleted/archived or incompatibly changed; historical snapshots remain readable; no speculative registry.
- Verification: true-DB integration/concurrency tests and downstream regression/CI.
- Dependencies: first production downstream reference. Risk: high once dependency exists. Rollback: forward-compatible provider/FK correction.
- Definition of Done/status: `DEFERRED_PLANNED`.

### TASK-044 — Complete independent acceptance and DR/sign-off evidence

- Parent Phase: PHASE-006.
- Goal: execute the already-defined acceptance programme in a controlled environment.
- Requirement/design: all requirements; especially NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-014, NFR-015 and SEC-001 through SEC-009; DES-016, DES-017, DES-018, DES-019.
- Components: staging, data fixtures, Playwright/API/DB/performance/security/backup-restore evidence and human sign-offs.
- Acceptance: staging upgrade/re-run succeeds; formal QA/UAT is recorded; restore demonstrates RTO <= 4h and RPO <= 15m; business/Ops/compliance approve or residual risk is explicitly accepted.
- Verification: `06_technical_test_cases.md` and `07_uat_test_cases.md` executed under `TEST_AND_VERIFY`, not this review.
- Dependencies: remediation code merged and target environment available. Risk: release-critical evidence gap. Rollback: no production mutation without an approved exercise plan.
- Definition of Done/status: signed evidence and traceability; `PLANNED`.

## Full canonical requirement coverage

FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064; NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-014, NFR-015; SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009.

---

# Preserved legacy body (verbatim; checkbox states are evidence)

# Item Management 開發任務分解

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 來源 | `docs/items_management/design_spec.md` 0.2 Draft |
| 產生日期 | 2026-09-04 |
| 任務狀態 | Phase A（T01–T07）已完成並 merge；Phase B 開發／自動化驗收部分已完成（T08–T36 全部完成；Checkpoint L 仲有兩項人工簽核未做，見該節）；T25 起改為累積喺同一個分支／PR，待使用者確認先合併，見使用者指示 |
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
- [x] T10 建立核心驗證與 Barcode 規則
- [x] T11 建立 Item Audit service 與查詢 API
- [x] T12 建立 Item／SKU 列表與詳情後端
- [x] T13 建立商品導航與列表頁
- [x] T14 建立 Item＋初始 SKU 原子建檔後端
- [x] T15 建立 Item／SKU 建檔頁與基本 Editor
- [x] T16 建立 Item／SKU aggregate 更新後端
- [x] T17 建立 Item／SKU 詳情與編輯頁
- [x] T18 建立 Item／SKU 生命週期後端
- [x] T19 建立生命週期與狀態操作 UI
- [x] T20 建立受控刪除、複製、SKU Code 修改與 Barcode 釋放
- [x] T21 建立下游 ItemLookupService contract
- [x] T22 完成核心端到端、並發與安全驗證

### Phase C：零售消耗品擴充

- [ ] T23 建立 Attribute schema、variant signature 與 domain 規則
- [x] T24 完成 Attribute／Variant API 與 UI
- [x] T25 建立 Media schema、service、API 與孤兒檔清理
- [x] T26 建立 Media UI 與檔案安全整合測試

### Phase D：批量能力

- [x] T27 建立 Import persistence、dependencies 與 worker 設定
- [x] T28 建立 CSV preflight processor
- [x] T29 建立 Import confirm／execution／result API
- [x] T30 建立 Import UI
- [x] T31 建立 SKU Export
- [x] T32 建立疑似重複商品提示
- [x] T33 建立 bounded bulk status change
- [x] T34 建立 Import 檔案保留清理

### Phase E：非功能與交付

- [x] T35 完成效能、容量及營運可觀測性驗證
- [x] T36 完成部署文件、Smoke、回歸及 Release Gate

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
- [x] GET 接受 `item.view` 或 `item.mgmt`，寫入使用 `item.mgmt`，archive／restore／delete 使用 `jwt-password`。
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

- [x] `assertSkuActivatable()` 一次回傳全部 issues，無條碼仍可啟用，Sellable Active 必須有正 RRP。
- [x] Base UOM factor／交易量只接受有界整數；decimal 欄不經 JavaScript floating point 計算。
- [x] GTIN-8／UPC-A／EAN-13／GTIN-14 及 internal barcode 的合法、非法與 Unicode 邊界均有測試。

**Verification:**

- [x] `npm test --workspace server -- test/itemValidation.test.js test/barcodeValidation.test.js`
- [x] `npm run lint -- server/src/modules/item/itemValidation.js server/src/modules/item/barcodeValidation.js`

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

- [x] 寫入可接收 caller transaction connection，不能在業務 transaction 外另開 query（`record()` 早已於 T04 完成，本任務新增的 `list()` 讀路徑另外重讀操作者現況，見下一項）。
- [x] Audit detail 不保存 password、token、device key、整份 CSV、檔案內容或未受限 body（同上，`record()` 呼叫端規則不變；本任務未新增任何 detail 寫入呼叫點）。
- [x] `GET /api/v1/item-audit/logs` 接受 `item.view` 或 `item.mgmt`，固定排序（`occurred_at DESC, id DESC`）並支援規定 filters（page、pageSize、from、to、actor、target、action、targetType）。

**Verification:**

- [x] `npm test --workspace server -- test/itemAuditLogService.test.js`（`itemAuditHandlers.test.js` 沒有建立：對照既有 `listAuditLogsHandler.js`，同類 handler 本來就沒有獨立的假連線單元測試，行為完全由下面的真實整合測試覆蓋，跟現有慣例一致。）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemAudit.integration.test.js`

**Dependencies:** T02, T03, T08

**Files likely touched:**

- `server/src/modules/item/ItemAuditLogService.js`
- `server/src/handlers/item-audit/listItemAuditLogsHandler.js`
- `server/src/handlers/item-audit/itemAuditSchemas.js`
- `server/test/integration/itemAudit.integration.test.js`

**Estimated scope:** M（4 files）

### Task T12：建立 Item／SKU 列表與詳情後端

**Description:** 在 `ItemAdminService` 實作 Item／SKU 分頁、精確與模糊搜尋、filters、sort whitelist 及白名單 response projection，完成 read handlers。

**Acceptance criteria:**

- [x] SKU exact Code／Barcode 優先，LIKE wildcard 被 escape，Item 查詢用 `EXISTS` 避免重複及錯誤 total。
- [x] 回應只包含設計欄位，RRP 固定組成 HKD／`tax_not_applicable`，不直接 spread DB row（attribute values／media 兩個陣列固定回空——依賴的表要等 T23／T25 先建立，見 service 開頭註解）。
- [x] 所有 Item Management GET 接受 `item.view` 或 `item.mgmt`；無兩者者仍回 403。

**Verification:**

- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemRead.integration.test.js`（沒有建立 `itemAdminService.test.js`／`itemHandlers.test.js`：這支 service 的正確性幾乎完全在 SQL 本身——JOIN／EXISTS 子查詢、search rank 的 ORDER BY CASE——假連線只能證明「呼叫了 query()」，證明不了查詢真的做對，跟 T09／T11 對同類問題的判斷一致，全部改用真 MySQL 整合測試覆蓋。）

**Dependencies:** T02, T08, T09, T10

**Files likely touched:**

- `server/src/modules/item/ItemAdminService.js`
- `server/src/handlers/items/itemSchemas.js`
- `server/src/handlers/items/listItemsHandler.js`
- `server/src/handlers/items/getItemHandler.js`
- `server/src/handlers/skus/skuSchemas.js`
- `server/src/handlers/skus/listSkusHandler.js`
- `server/src/handlers/skus/getSkuHandler.js`
- `server/test/integration/itemRead.integration.test.js`

**Estimated scope:** M（8 logical files）

## Checkpoint D：T10–T12 Read Model Gate

- [x] Pure rules、Audit 及 read API focused tests 通過。
- [x] 真 DB 查詢與 projection 不洩漏內部欄位。
- [x] Read permission matrix 與 response schema 通過。
- [x] 以 seed data 手動驗證 Code、Barcode、Name、Archived filter（喺 T13 完成 `ItemsPage.vue` 之後，用瀏覽器手動驗證咗：SKU／Item 兩個視圖、搜尋、status 篩選、Archived 預設隱藏／明確揀 status=archived 先睇到、URL 還原（重新整理保持一致）、item.view-only 用戶睇唔到「新增商品」按鈕）。

### Task T13：建立商品導航與列表頁

**Description:** 新增 items menu、`ItemsPage.vue`、Item client service 與 URL-synchronised filters，預設顯示 SKU 平鋪視圖。

**Acceptance criteria:**

- [x] 搜尋 debounce 300ms（沿用 `q-input` 原生 `debounce` prop），page／sort／view／q／status 可從 URL 還原（mount 時讀 `route.query` 做初始值，之後每次 fetch 用 `router.replace()` 同步）。
- [x] `item.view` 可進入列表；寫入 actions（「新增商品」按鈕，連去 T15 先會建成嘅 `/items/new`）只有 `item.mgmt` 顯示；Archived 預設隱藏（status 篩選唔揀就唔傳 `status`，後端沿用 T12/T13 加返嘅 `includeArchived` 邏輯濾走 archived；明確揀 status=archived 先睇到）。
- [x] Static route `/items` 與未來 `/items/:id`（T17 之後先會建）無衝突。列表**有**修改共用 `DataTable.vue`——原定「不修改」跟「page／sort 可從 URL 還原」互相矛盾（QTable 內部 `pagination` ref 本身冇對外接口可以喺掛載時覆寫），已用 `AskUserQuestion` 徵得同意，加一個純附加、預設 `null`（行為不變）嘅 `initialPagination` prop，不影響任何現有呼叫端。見 `client/src/framework/ui/DataTable.vue` 同 `client/test/framework/ui/DataTable.test.js` 新增嘅兩個測試。

**Verification:**

- [x] `npm test --workspace client -- test/services/item.test.js test/pages/items/items.test.js`
- [x] `npm test --workspace client -- test/framework/discovery/pages.test.js test/framework/routing/router.test.js`
- [x] Manual check：重新整理帶 filters／page／view 的 URL，結果保持一致（用真實 dev server + seed data 喺瀏覽器手動驗證，見上面 Checkpoint D 的補充說明）。「分享」未另外測試多裝置情境，但同一瀏覽器重新整理已驗證 URL 是狀態的唯一來源。

**Dependencies:** T05, T06, T07, T12

**Files actually touched：**

- `client/src/services/item.js`（新建）
- `client/src/pages/items/ItemsPage.vue`（新建）
- `client/test/services/item.test.js`（新建）
- `client/test/pages/items/items.test.js`（新建）
- `client/src/framework/ui/DataTable.vue`（加 `initialPagination` prop，見上）
- `client/test/framework/ui/DataTable.test.js`（對應新增兩個測試）
- `server/src/modules/item/ItemAdminService.js`、`server/src/handlers/items/itemSchemas.js`、`listItemsHandler.js`、`server/src/handlers/skus/skuSchemas.js`、`listSkusHandler.js`、`server/test/integration/itemRead.integration.test.js`（T13 開發途中發現 T12 冇做「Archived 預設隱藏」呢個 gap——Category／UOM 早已有 `includeArchived`，Brand 冇；為咗前端呢個切片可以完整做到規格要求，喺 T12 嘅檔案上加返呢個參數，唔係另開新 task）
- `client/config/menu.js`：其實冇改——「items」呢個 menu group 喺 Phase A（T05-T07）已經建立，`page.menu.group = "items"` 直接沿用得到，原本清單估計錯咗。

**Estimated scope:** M（4 個新檔 + 6 個因發現 gap／架構限制而小改的既有檔案）

### Task T14：建立 Item＋初始 SKU 原子建檔後端

**Description:** 實作 `createItem()` 與 create handler，使 Standard Item、至少一個 SKU、UOM／Barcode 集合、直接 Active 及 audit 在單一 transaction 完成。

**⚠️ 範圍決定（2026-09-07，已與使用者確認）：T14 只做 Standard Item，Variant 建檔延後到 T23。**

原本 `design_spec.md` §6.9 嘅 create request 範例帶 `skus[].variantValues`（`{attributeId, optionId}`），但 §4.4 講嘅 variant signature（SHA-256 hash）計算邏輯，同埋佢要驗證嘅 `item_attribute_definitions`／`item_attribute_options` 表，`tasks.md` 明確歸類做 T23（見下面 T23 條目），T14 自己嘅 dependency 亦只列 T08–T11，唔包括 T23——文件內部本身就有矛盾（API 範例睇落即刻要 Variant，task 分工卻話計算邏輯要等三個 task 之後）。

三個處理方式（T14 只做 Standard／T14 支援 Variant 但要求 caller 自己送已計好嘅 signature／T14 就提前寫 SHA-256 但唔驗證 attributeId／optionId 是否存在）已經同使用者討論，**採用第一種**：

- `createItem()`／`createItemHandler.js` 嘅 `item.productType` 只接受 `"standard"`；送 `"variant"` 回一個清晰嘅錯誤（未支援，等 T23 attribute 基建完成後開放），唔會半桶水噴一個計得出但完全冇驗證嘅 signature。
- Create request schema **唔**包含 `variantValues`／`variantSignature` 呢類欄位——避免 T23 嗰陣要做 breaking change（拎走一個冇人識點用嘅欄位，換一個新嘅）。
- **T23 跟進事項**：起好 `item_attribute_definitions`／`item_attribute_options` 表之後，喺 T23 加返：(1) §4.4 嘅 variant signature 計算函式；(2) create request schema 加 `skus[].variantValues`；(3) `createItem()` 對 `productType: "variant"` 開放，連同 attributeId／optionId 存在性驗證一齊做齊，唔淨係計 hash。

**Acceptance criteria:**

- [x] 任一 SKU、UOM、Barcode 或 audit 失敗時 Item aggregate 全部 rollback（`ItemAdminService.createItem()` 全程喺 `database.withTransaction()` 入面；integration test 逐一驗證失敗個案之後查返 DB 完全冇殘留，唔淨係查返拋咗預期嘅錯誤）。
- [x] Standard 恰好一個 SKU（`skus.length !== 1` 拋 `STANDARD_ITEM_SKU_LIMIT`）；SKU Code／Barcode unique race 映射為公開錯誤（`SKU_CODE_TAKEN`／`BARCODE_TAKEN`，兩個都係真.race 場景先會撞——sku_id／sku_uom_id 係呢個交易先建立，UOM 結構性問題唔可能同其他交易race，改用喺插入之前做結構驗證，見 `#assertUomShapeValid()`／`#assertBarcodeShapeValid()` 嘅註解）。`productType: "variant"` 明確回「未支援」錯誤（見上面範圍決定），唔嘗試計 variant signature。
- [x] Create API 啟用 idempotency（`static api.idempotency = { enabled: true }`，TTL 沿用 `config/idempotency.js` 嘅 `defaultTtlMs`＝1 小時）；建檔人可直接啟用但仍須通過 `assertSkuActivatable()` 完整性檢查及 `item.mgmt` 驗證。

**Verification:**

- [x] `npm test --workspace server`（冇建 `itemAdminService.test.js`／`itemHandlers.test.js`：呢個 service 嘅正確性幾乎完全在 transaction／unique key／FK 呢啲真 DB 先驗得到嘅行為，同 T09／T11／T12 對同類問題嘅判斷一致，全部改用 `test/integration/itemCreate.integration.test.js` 嘅真 MySQL 整合測試覆蓋；純 unit 層面新增嘅兩個 error factory 冇獨立測試檔，跟 itemErrors.js 其餘 factory 冇獨立測試檔嘅既有慣例）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemCreate.integration.test.js`（14 個案例：draft／activate 建檔、activationReason 缺漏、activate 時完整性唔夠 rollback、variant 拒絕、Standard 兩個 SKU、SKU Code／Barcode race、category／brand／uom not found、UOM 結構錯誤、barcode uomId 唔屬於呢個 SKU、同一包裝單位兩個 primary、權限矩陣連 PERMISSION_STALE、idempotency 重送）

**過程中發現嘅額外修正（唔屬於原本範圍，但係 T14 本身依賴住嘅 bug）：**

- `itemErrors.js` 嘅 `itemNotActivatable()` 之前只設 `details`，冇設 `publicDetails`——`errorHandler.js` 實際response 用嘅係 `publicDetails`（`details` 淨係入 log），即係 422 response 嘅 `error.details.issues` 一直都係 `undefined`，前端 `FormPanel.vue` 嘅逐 field 標紅功能對呢個錯誤一直冇作用（由 T10 起就係咁，一直冇被發現係因為之前嘅測試淨係直接查返個 JS Error object，冇經過真正嘅 HTTP round trip）。已經修正 `itemNotActivatable()`，並用 spawn_task 開咗一個 follow-up 追蹤 `itemErrors.js` 其餘 factory 同 `UserAdminService.js` 嘅 `unknownRoles()` 有冇同一個問題（呢個 task 冇一併修，範圍太大唔屬於 T14）。

**Dependencies:** T08, T09, T10, T11

**Files actually touched：**

- `server/src/modules/item/ItemAdminService.js`（`createItem()` 連同私有 helper：category／brand／uom 存在性驗證、UOM／barcode 結構驗證、插入、audit）
- `server/src/modules/item/itemErrors.js`（新增 `itemVariantNotSupported()`、`barcodePrimaryDuplicated()`、`activationReasonRequired()`；修正 `itemNotActivatable()` 嘅 `publicDetails` gap，見上）
- `server/src/handlers/items/itemSchemas.js`（`ITEM_MGMT_POLICY`、`ITEM_CREATE_REQUEST_SCHEMA` 同其巢狀 schema）
- `server/src/handlers/items/createItemHandler.js`（新建）
- `server/src/handlers/item-audit/itemAuditSchemas.js`（`ITEM_AUDIT_ACTIONS` 加 `item.create`／`sku.create`，`ITEM_AUDIT_TARGET_TYPES` 加 `item`／`sku`）
- `server/test/integration/itemCreate.integration.test.js`（新建，14 個案例）
- `server/test/applicationFactory.test.js`（「唔需要 scheduler」嗰個 minimal-service 測試要補返 `idempotency` service，唔係就開唔到應用——createItemHandler 係成個 codebase 第一個宣告 idempotency 嘅 route，之前呢份清單冇需要帶埋佢）

冇建 `server/src/handlers/skus/createSkuHandler.js`：`POST /api/v1/skus/create`（單獨喺一個已存在嘅 Item 底下加一個新 SKU）係 design_spec §6.3 嘅獨立端點，同 T14「Item＋初始 SKU 一齊原子建立」係兩件唔同嘅事，原本嘅檔案清單估計錯咗——呢個端點應該歸類做未來加 SKU 嘅 task（例如 T15 之後），唔喺 T14 範圍內。

**Estimated scope:** M（5 logical files；integration test 同切片）

### Task T15：建立 Item／SKU 建檔頁與基本 Editor

**Description:** 建立 `ItemCreatePage` 及 Item／SKU／UOM／Barcode／Tracking／Price 基本 editors，接通 Draft 與直接啟用兩條 flow。

**⚠️ 範圍決定：跟返 T14 已經同使用者確認嘅「T14 只做 Standard Item」——呢個 task 冧唔到嘅兩件事：**

- 冇建 `SkuCreatePage.vue`（`/items/:itemId/skus/new`，喺已存在嘅 Item 底下加新 SKU）：佢背後嘅 `POST /api/v1/skus/create` 係一個獨立端點，T14 冇建（見 T14 條目最尾嗰段），呢個 task 嘅 dependency 亦只列 T06、T13、T14，冇包括嗰個未來先會有嘅 task。等有 task 建咗嗰個後端先起呢個頁面。
- Manual check 原文「建立…Variant Active」冧唔到：T14 已經拒絕 `productType: "variant"`（`ITEM_VARIANT_NOT_SUPPORTED`），Variant 建檔要等 T23 attribute 基建完成。呢度只人手驗證 Standard Draft／Standard Active／無 Barcode Active／驗證失敗保留草稿呢四項。

**Acceptance criteria:**

- [x] 「儲存草稿」與「儲存並啟用」分開；後端 issues 對應返欄位（`item.categoryId`、`skus.0.skuCode` 呢類 dotted path）並保留輸入（失敗唔會清空表單）。
- [x] SKU Code 接受任意合法人工格式（純文字輸入，冇格式限制）；Barcode 選填；價格 UI 固定顯示 `HK$` 前綴同「（未稅）」後綴，request 只送 amount。
- [x] Dirty route leave（`onBeforeRouteLeave` + `window.confirm`）／browser unload（`beforeunload` + `preventDefault`）、鍵盤操作（全部用原生 Quasar 表單元件，冇自訂純滑鼠 handler）、focusable error summary（`role="alert"` + `tabindex="-1"` + `.focus()`，即使全部錯誤都對應到個別欄位都照樣顯示同攞 focus）及狀態文字（「處理中，請稍候…」`aria-live="polite"`）均可測，見 `itemCreate.test.js`。

**手動瀏覽器驗證中發現並修正嘅 bug：** `assertSkuActivatable()`（itemValidation.js）嘅 `issue.field` 用嘅係扁平名（`categoryId`、`uoms`、`suggestedPriceAmount`），唔係表單提交 body 嗰種巢狀 JSON path（`item.categoryId`、`skus.0.suggestedPriceAmount`）。冇呢層轉換嘅話，呢類錯誤永遠對應唔到個別欄位，全部跌落摘要，個別欄位唔會標紅——用真實瀏覽器手動測試「儲存並啟用」但資料唔完整先發現。已經喺 `validationIssues.js` 加咗一個對照表修正（`categoryId` 屬於 Item 層面，其餘全部屬於 SKU；`code`／`name` 對應返 `skuCode`／`skuName`）。

**Verification:**

- [x] `npm test --workspace client -- test/pages/items/itemCreate.test.js`（9 個案例）
- [x] `npm run build --workspace client`
- [x] `npx vitest run`（全部 351 個 client 測試，run 兩次）
- [x] Manual check：用真實 dev server＋seed data＋真實瀏覽器驗證咗：Standard Draft 建立成功、UOM／SKU Code／SKU 名稱正確送到後端並喺 `/items` 列表出現、「儲存並啟用」冇填啟用原因擋喺前端唔叫 API、資料唔完整時 `ITEM_NOT_ACTIVATABLE` 嘅 issues 正確對應返個別欄位（分類、建議零售價）同摘要（Base 單位），失敗嗰兩次都冇喺 DB 留低任何殘留。分類／品牌／UOM 嘅 q-select 下拉選單本身冇用真實滑鼠點擊驗證到（呢次瀏覽器分頁畀主控端收埋咗，Quasar 嘅 dropdown portal 喺分頁未顯示嗰陣唔會 render，`computer`／JS 事件模擬都開唔到），改為靠讀 code 確認 binding 同 CategoriesPage／BrandsPage 已經驗證過嘅同一套 `emit-value`／`map-options` pattern 一致。

**Dependencies:** T06, T13, T14

**Files actually touched：**

- `client/src/pages/items/ItemCreatePage.vue`（新建）
- `client/src/components/items/ItemBasicForm.vue`（新建）
- `client/src/components/items/SkuEditor.vue`（新建）
- `client/src/components/items/SkuUomEditor.vue`（新建）
- `client/src/components/items/SkuBarcodeEditor.vue`（新建，原本清單漏咗）
- `client/src/components/items/TrackingPolicyFields.vue`（新建，原本清單漏咗）
- `client/src/components/items/SuggestedPriceField.vue`（新建，原本清單漏咗）
- `client/src/components/items/itemFieldLabels.js`（新建，追蹤政策／條碼種類嘅中文標籤對照表）
- `client/src/framework/ui/validationIssues.js`（新建：`error.details` 兩種形狀——schema 陣列同 `assertSkuActivatable()` 嘅 `{issues}`——共用嘅對應邏輯，供呢個同未來 T16＋嘅寫入頁面重用）
- `client/src/services/item.js`（加 `createItem()`）
- `client/test/pages/items/itemCreate.test.js`（新建，9 個案例）

冇建 `client/src/pages/items/SkuCreatePage.vue`：見上面範圍決定。

**Estimated scope:** M（11 個新／改檔案；Barcode／Tracking／Price 子元件與測試同切片）

## Checkpoint E：T13–T15 Create Flow

- [x] system-admin 可由 menu 進入、建立 Draft 及直接 Active Item（僅 Standard，見 T14／T15 範圍決定；Variant 留待 T23）。
- [x] 只有 view 的使用者看得到列表但看不到／不能呼叫 create（T13 前端按鈕隱藏＋T14 `createItemHandler.js` 403 兩層都驗證咗）。
- [x] Create idempotency、rollback、audit 與前端錯誤回填全部通過。
- [x] Client build、server/client coverage 通過。

### Task T16：建立 Item／SKU aggregate 更新後端

**Description:** 實作 Item 與 SKU 更新、整組替換 UOM／Barcode／attributes 的 transaction 及 optimistic version，區分普通 RRP 與關鍵變更 reason 規則。

**⚠️ 範圍決定：**

- **「有交易／庫存後不可直接改」呢層未做**：design_spec §8.4 明確講「Phase 1 尚無庫存、採購或銷售表」，「現在不為尚不存在的模組建立 plugin registry 或空 interface；待第一個真引用出現再抽取」。冇資料源可以查「呢個 SKU 而家有冇交易／庫存」，所以呢個 task 冇實作呢層阻擋（`uomChangeBlocked()`／`trackingPolicyChangeBlocked()` 呢兩個 T03 已經預先寫低嘅錯誤 factory 保持未用，留俾第一個下游模組出現先接上）。現在做到、亦已確認要做嘅係較弱嗰層：Base UOM／任一 UOM 換算係數／追蹤政策改變（「關鍵變更」）一定要帶 `reason`，新增 `CRITICAL_CHANGE_REASON_REQUIRED` 錯誤。
- **`skuCode` 唔喺呢個更新入面**：design_spec §7.4「SKU Code 在建立後 readonly；特批修改從獨立 action 開啟高強度 dialog」，對應 §6.3 嘅 `POST /api/v1/skus/:id/code/change`（`jwt-device-password`）——嗰個係獨立、未建嘅高強度端點，唔屬於呢個 task。
- **Item 層冇 `productType`**：跟返 T14 已確認嘅範圍（Standard-only），呢期 Item 一開始係 standard 就一直係 standard，冇實際「改做 variant」嘅用途，`updateItem()` 完全唔處理呢個欄位。
- **UOM／Barcode 用「刪晒重插」而唔係逐行 diff**：design_spec §6.3 前言本身就形容做「完整集合連同 version 一次提交」；子表 id 冇任何需求要求佢哋跨次更新保持穩定，提交嘅舊 id 淨係用嚟做擁有權檢查（`SKU_CHILD_MISMATCH`）。呢個做法遠比逐行 update／insert／delete 三分支簡單。

**Acceptance criteria:**

- [x] Stale version 回 `VERSION_CONFLICT`，不寫資料或 audit（Item／SKU 兩邊都驗證，SKU 嗰邊仲驗證咗 UOM／Barcode 子表完全冇被刪重插）；child ID 不屬 SKU 回 `SKU_CHILD_MISMATCH`（UOM／Barcode 分開驗證）。
- [x] Base UOM／任一 UOM 換算係數／追蹤政策嘅關鍵變更冇填 `reason` 一律 `CRITICAL_CHANGE_REASON_REQUIRED`（「有交易／庫存後先擋」嗰層見上面範圍決定）。
- [x] 純 RRP 更新可不填 reason，但 audit 保存前後 amount、HKD、`tax_not_applicable`、actor 及時間（actor／時間係每一列 audit 本身固有嘅欄位，唔使額外處理）。

**Verification:**

- [x] `npm test --workspace server`（冇建 `itemAdminService.test.js`／`itemHandlers.test.js`：呢個 service 嘅正確性幾乎完全在 compare-and-set UPDATE、FK RESTRICT 刪除順序、unique key race 呢啲真 DB 先驗得到嘅行為，同 T09／T11／T12／T14 對同類問題嘅判斷一致，全部改用真 MySQL 整合測試覆蓋）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemUpdate.integration.test.js`（12 個案例：Item 改名／分類、Item version 衝突、Item not found、SKU 純 RRP、SKU 關鍵變更缺 reason／連同 reason、換 Base UOM、UOM／Barcode child id 唔屬呢個 SKU、Barcode race、SKU version 衝突、權限矩陣連 PERMISSION_STALE）

**Dependencies:** T10, T11, T14

**Files actually touched：**

- `server/src/modules/item/ItemAdminService.js`（`updateItem()`、`updateSku()`、`#isCriticalSkuChange()` 私有 helper；重用返 `createItem()` 已有嘅 `#assertCategoryExists`／`#assertBrandExists`／`#assertUomShapeValid`／`#assertUomsExist`／`#assertBarcodeShapeValid`）
- `server/src/modules/item/itemErrors.js`（新增 `criticalChangeReasonRequired()`）
- `server/src/handlers/items/itemSchemas.js`（`ITEM_UPDATE_REQUEST_SCHEMA`）
- `server/src/handlers/items/updateItemHandler.js`（新建）
- `server/src/handlers/skus/skuSchemas.js`（`ITEM_MGMT_POLICY`、`SKU_UPDATE_REQUEST_SCHEMA`）
- `server/src/handlers/skus/updateSkuHandler.js`（新建）
- `server/src/handlers/item-audit/itemAuditSchemas.js`（`ITEM_AUDIT_ACTIONS` 加 `item.update`／`sku.update`）
- `server/test/integration/itemUpdate.integration.test.js`（新建，12 個案例）

**Estimated scope:** M（5 logical files；integration test 同切片）

### Task T17：建立 Item／SKU 詳情與編輯頁

**Description:** 建立 Item／SKU detail routes、tabs 及 editor reuse，支援 version conflict、readonly Code、UOM／Barcode 集合與 RRP 編輯。

**⚠️ 範圍決定：冇 attributes／media／歷史 tabs**。design_spec §7.2 嘅頁面描述提到 `ItemDetailPage.vue` 有「基本資料、SKU、attributes、media、歷史」幾個 tabs，但呢個 task 喺 tasks.md 自己嘅 acceptance criteria 冇提到呢幾樣。Attributes／Media 兩個依賴嘅表要等 T23／T25 先建立，而家做出嚟只會係一個完全冇內容嘅空 tab，屬於speculative UI；歷史（audit log）雖然 T11 backend 已經有，但都唔喺呢個 task 嘅 acceptance criteria 之內，一齊留返俾之後專門處理 audit 呈現嘅 task（未編號）。呢個 task 只做「基本資料」（連 edit）同「SKU 列表」兩個 section。

**Acceptance criteria:**

- [x] `item.view` 可看完整詳情；`item.mgmt` 才顯示／執行 edit（`can()` 前端判斷＋按鈕隱藏），直接 URL 仍由 API 防護（`updateItem`／`updateSku` 嘅 `authorizationPolicies` 係 `ITEM_MGMT_POLICY`，T16 已驗證）。
- [x] Version conflict（`VERSION_CONFLICT`）重新載入最新資料但保留使用者草稿供比較，不自動重送——用真實瀏覽器開兩個請求模擬兩個分頁驗證咗（見下面 Manual check）。
- [x] UOM base/default 防呆（單選 radio，畫面上整唔到「兩行都係 Base」）、Barcode ownership（`skuUomId` 對返 `uomId` 先俾 SkuBarcodeEditor 用）、RRP 固定口徑（`HK$` 前綴、`（未稅）` 後綴）及 server issues 均正確呈現（呢兩支 update API 嘅 body 係扁平嘅，冇 T14/T15 嗰種 `item.`／`skus.0.` 巢狀 path，靠 `validationIssues.js` T15 已經有嘅 `skuFieldPrefix` 選項傳 `""` 就啱）。

**瀏覽器手動驗證中發現並修正嘅 bug：** `ItemDetailPage.vue` 最初嘅 `save()` 直接 `{...form, version}` 提交，冇好似 `ItemCreatePage.vue` 咁清理選填欄位——`countryOfOrigin`（`""`）同 `defaultShelfLifeDays`（`null`）呢類冇值嘅選填欄位一送到後端就撞 schema（`must match pattern`／`must be >= 1`），編輯任何一個冇填晒呢兩個選填欄位嘅 Item 一定會失敗。單元測試冧唔到呢個 bug，因為個 mock 直接吞咗個 body，冇真正行過 request schema 驗證——用真實 dev server 手動測先發現。已經加返 `buildPayload()` 做同 create page 一致嘅清理（`?? undefined`）。

**Verification:**

- [x] `npm test --workspace client -- test/pages/items/itemDetail.test.js test/pages/items/skuDetail.test.js`（4 + 5 個案例）
- [x] `npm run build --workspace client`
- [x] `npx vitest run`（全部 360 個 client 測試，run 兩次）
- [x] Manual check：用真實 dev server＋seed data，喺瀏覽器度開住 Item 編輯畫面（帶住舊 version），另外用同一個已登入 session 嘅 token 直接打 API 完成一次更新（模擬第二個分頁搶先儲存），先至喺瀏覽器嗰邊撳儲存——確認咗：畫面自動攞返新版本嘅資料顯示、清晰嘅「已經被人改過」提示、**用戶自己打緊嘅輸入完全冇被覆蓋**（用 JS 直接讀 input.value 核實）。SKU 名稱非關鍵變更（免 reason）同 Item 基本資料更新兩個 happy path 都喺真實後端驗證成功（version 正確遞增，資料正確反映）。UOM／Barcode 嘅 q-select 下拉選單（換 Base UOM 呢類關鍵變更）冇用真實滑鼠點擊驗證到——同 T15 同一個環境限制（preview 分頁畀主控端收埋咗，Quasar dropdown portal 唔 render），改為靠 T16 嘅 12 個真 DB 整合測試（已經覆蓋「換 Base UOM 要 reason」）加呢個 task 嘅 mock-based unit test 一齊佐證。

**Dependencies:** T13, T15, T16

**Files actually touched：**

- `client/src/pages/items/ItemDetailPage.vue`（新建）
- `client/src/pages/items/SkuDetailPage.vue`（新建）
- `client/src/services/item.js`（加 `updateItem()`／`updateSku()`）
- `client/src/components/items/ItemBasicForm.vue`（field-error path 由 `item.xxx` 改做相對 `xxx`；加 `readonly` prop）
- `client/src/components/items/SkuEditor.vue`（field-error path 由 `skus.0.xxx` 改做相對 `xxx`；加 `readonly`／`skuCodeReadonly` prop）
- `client/src/components/items/SkuUomEditor.vue`（field-error path 去咗 `skus.0.` prefix；加 `readonly` prop）
- `client/src/components/items/SkuBarcodeEditor.vue`（field-error path 去咗 `skus.0.` prefix；加 `readonly` prop）
- `client/src/components/items/TrackingPolicyFields.vue`（field-error path 去咗 `skus.0.` prefix；加 `readonly` prop）
- `client/src/components/items/SuggestedPriceField.vue`（加 `readonly` prop）
- `client/src/pages/items/ItemCreatePage.vue`（field-error path 改變之後，補返 `itemFieldError()`／`skuFieldError()` 兩個 prefix wrapper，等 T15 嘅 create page 行為完全唔變——T15 嗰 9 個測試全部照舊通過）
- `client/test/pages/items/itemDetail.test.js`（新建，4 個案例）
- `client/test/pages/items/skuDetail.test.js`（新建，5 個案例）

**Estimated scope:** M（5 logical files；tests 同切片）——實際觸及檔案多過估計，因為 T15 嘅共用元件原本將 field-error path 寫死做 create page 先啱嘅 `item.`／`skus.0.` 前綴，要重構做相對 path 先真正做到「共用」（design_spec §7.4 本身就打算呢啲 component 俾 create／detail 頁一齊用）。

### Task T18：建立 Item／SKU 生命週期後端

**Description:** 實作 activate、deactivate、discontinue、archive、restore 狀態機，按 DEC-024 在同一 transaction 實際同步受影響 children。

**⚠️ 範圍決定：archive 未做引用檢查**。design_spec §4.2／§6.2 都提到 Item／SKU 封存前要「驗證全部無庫存／在途／未完成引用」，但 Phase 1 完全未有庫存、採購、銷售呢啲下游表存在——同 T16 對 `uomChangeBlocked()`／`trackingPolicyChangeBlocked()`「有交易後先擋」嗰個範圍決定同一個理由（design_spec §8.4 本身都明確話「現在不為尚不存在的模組建立 plugin registry 或空 interface；待第一個真引用出現再抽取」）。`archiveItem()`／`archiveSku()` 現在直接允許（前提係 from-status 啱），呢個檢查留返俾第一個真正有下游表嘅 task（庫存或採購模組）補上，屆時 `itemReferenced()`／`skuReferenced()` 呢兩個已經喺 `itemErrors.js` 定義好嘅 error factory 就有真正用得著嘅地方。

**Acceptance criteria:**

- [x] Item deactivate、discontinue、archive 原子同步 SKU；任一 child 失敗時 Item、全部 SKU、flags 及 audit rollback（同一個 `database.withTransaction()`，`#cascadeSkuStatus()` 私有 helper 逐粒 SKU UPDATE＋audit，任何一步拋錯都令成個交易 rollback）。
- [x] Item restore 只到 Inactive，不自動 restore／activate SKU（`restoreItem()` 完全冇 cascade 呼叫）；Active Item 不可單獨停用最後一個 Active SKU（`deactivateSku()` 用 `lastActiveSku()` 擋，僅喺父 Item 本身仲係 active 嗰陣先檢查——Item 本身已經 inactive／discontinued 時單獨停用最後一個 SKU 唔受呢條規則限制，因為冇「Item active 但冇任何 active SKU」呢個狀態要保護）。
- [x] 各 route 使用設計指定的 `jwt`／`jwt-password`、`item.mgmt`、reason 及 version（Item／SKU 嘅 activate／deactivate 係 `jwt`；discontinue／archive／restore 係 `jwt-password`，同 design_spec §6.2／§6.3 嘅 Auth／Permission 欄一致）。

**Verification:**

- [x] `npm run lint`（repo 根，涵蓋 server／client）
- [x] `npm test --workspace server`（1210 個案例，含新增 16 個，run 兩次穩定全過；冇建 `itemAdminService.test.js`／`itemHandlers.test.js`：呢個 service 嘅正確性幾乎完全在 compare-and-set UPDATE、cascade 交易、真 DB 先驗得到嘅行為，同 T16 對同類問題嘅判斷一致，全部改用真 MySQL 整合測試覆蓋）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemLifecycle.integration.test.js`（16 個案例：Item 直接啟用指定 SKU、冇帶 SKU 拒絕、已 active 嘅 Item 加啟另一 SKU 唔重複記 audit、跨 Item SKU id 拒絕、已封存 Item 拒絕啟用、Item 停用 cascade 兩個 SKU、version 衝突、Item 停產強制停採購但保留 sellable、密碼錯 403、Item 封存＋恢復＋SKU 仍然 archived、SKU 啟用要求父 Item 已 active、SKU 獨立啟用、最後一個 active SKU 唔可以停用、仲有第二個 active 就可以停用、SKU 停產／封存／恢復完整走一次連 audit 次序、冇 item.mgmt 403），連跑 3 次全部穩定通過
- [x] 測試後確認 dev DB 無殘留（`items`／`item_skus`／`item_categories`／`item_brands`／`item_uoms`／`users`／`roles`／`item_audit_logs` 全部歸零）

**Dependencies:** T11, T16

**Files actually touched：**

- `server/src/modules/item/itemErrors.js`（新增 `itemActivationRequiresSku()`）
- `server/src/modules/item/ItemAdminService.js`（新增 `activateItem()`、`deactivateItem()`、`discontinueItem()`、`archiveItem()`、`restoreItem()`、`activateSku()`、`deactivateSku()`、`discontinueSku()`、`archiveSku()`、`restoreSku()`，同私有 helper `#transitionItemStatus()`、`#transitionSkuStatus()`、`#cascadeSkuStatus()`、`#assertSkuRowActivatable()`）
- `server/src/handlers/items/itemSchemas.js`（新增 `REASON_SCHEMA`／`VERSION_SCHEMA`／`PASSWORD_SCHEMA`／`ITEM_ACTIVATE_REQUEST_SCHEMA`）
- `server/src/handlers/items/itemStatusHandlers.js`（新建：`ActivateItemHandler`、`DeactivateItemHandler`、`DiscontinueItemHandler`、`ArchiveItemHandler`、`RestoreItemHandler`）
- `server/src/handlers/skus/skuSchemas.js`（新增 `REASON_SCHEMA`／`VERSION_SCHEMA`／`PASSWORD_SCHEMA`）
- `server/src/handlers/skus/skuStatusHandlers.js`（新建：`ActivateSkuHandler`、`DeactivateSkuHandler`、`DiscontinueSkuHandler`、`ArchiveSkuHandler`、`RestoreSkuHandler`）
- `server/src/handlers/item-audit/itemAuditSchemas.js`（`ITEM_AUDIT_ACTIONS` 加 `item.activate`／`item.deactivate`／`item.discontinue`／`item.archive`／`item.restore`／`sku.activate`／`sku.deactivate`／`sku.discontinue`／`sku.archive`／`sku.restore`）
- `server/test/integration/itemLifecycle.integration.test.js`（新建，16 個案例）

**Estimated scope:** M（8 logical files；每支 endpoint 仍各自 export handler，冇建假 mock unit test）

## Checkpoint F：T16–T18 Core Mutation Gate

- [ ] Update、version、child ownership 與所有 lifecycle transitions 通過。
- [ ] DEC-024 cascade 及 rollback 由 unit 與真 DB integration 同時證明。
- [ ] RRP 可選 reason 與關鍵欄位必填 reason 沒有互相污染。
- [ ] API auth metadata 及 error response 不洩漏 SQL／constraint。

### Task T19：建立生命週期與狀態操作 UI

**Description:** 在列表與詳情頁加入合法 row actions、影響預覽、PasswordReasonDialog 及 restore flow，狀態以文字與 icon 呈現。

**⚠️ 範圍決定：ItemsPage 嘅 SKU 平鋪列表 row menu 唔提供「啟用」**。`SKU_SUMMARY_SCHEMA`（`GET /api/v1/skus`）冇帶父 Item 現在嘅狀態，只有 `itemId`／`itemName`——但 `activateSku()` 要求父 Item 已經 Active 先做得，喺呢個列表冇資料判斷邊個 SKU 而家真係啟用得到，貿然顯示「啟用」只會俾一堆冇意義嘅後端拒絕（`STATUS_TRANSITION_INVALID`）。停用／停產／封存／恢復呢四個淨係睇 SKU 自己嘅狀態，呢個列表已經有齊資料，冇呢個限制。要啟用 SKU 請去 SkuDetailPage（已經連父 Item 狀態一齊載入）或者 ItemDetailPage 嘅 SKU 列表（已知父 Item 狀態）。Item 彙總列（`ItemsPage` 嘅「商品」view）淨係得「查看詳情」——Item 層面嘅停用／停產／封存／恢復要顯示準確嘅受影響 SKU 數，而 `ITEM_SUMMARY_SCHEMA` 只有 `skuCount`（總數，唔分狀態），要準確數字一定要去有齊 `item.skus[].status` 嘅 ItemDetailPage 先做得。

**Acceptance criteria:**

- [x] UI 只顯示目前狀態合法的動作（Item：`activate` draft／inactive；`deactivate` active；`discontinue` active／inactive；`archive` draft／inactive／discontinued；`restore` archived。SKU 同一套 from-status，`activate` 仲要父 Item 已經 active），Item 操作前顯示受影響 SKU 數及不可逆後果（由已載入嘅 `item.skus` 現狀計算，唔使額外打 API）。
- [x] Discontinue／Archive／Restore 走 `promptPassword({ requireReason: true })`（password reauth 並帶 reason）；Activate／Deactivate 用 `promptReason()`（明確確認並帶 reason，唔使密碼）——同 catalog 頁（Category／Brand／UOM）已有嘅 `confirm.js` 慣例完全一致。
- [x] Restore 後不把 SKU 顯示為自動 Active（`restoreItem()` 完全冇 cascade，畫面直接反映 API 回傳嘅 SKU 狀態，冇額外「假裝已啟用」嘅邏輯），需明確逐一恢復／啟用（SKU 列表 row menu／SkuDetailPage 各自提供獨立嘅「從封存恢復」）。

**Verification:**

- [x] `npm run lint`（repo 根）
- [x] `npx vitest run`（client，全部 48 個檔案、379 個案例，run 兩次穩定全過；新增 itemDetail.test.js 7 case、skuDetail.test.js 7 case、items.test.js 5 case）
- [x] `npm run build --workspace client`
- [x] Manual check：用真實 dev server＋seed data（草稿商品＋草稿 SKU、啟用商品＋兩個啟用 SKU），喺瀏覽器度完整行一次 Item 停用（確認訊息帶咗準確嘅「2 個啟用中的 SKU」）→ 停產（password＋reason，SKU 強制 `purchasable=false`）→ 封存（兩個 SKU 一齊轉 Archived）→ 恢復（Item 變 Inactive，SKU 維持 Archived）→ Item 詳情頁 SKU 列表逐一「從封存恢復」單一 SKU → 草稿商品「啟用」dialog（預先勾晒可啟用嘅 SKU，連同 reason 一齊提交 `activateItem`）→ ItemsPage SKU 平鋪列表 row menu（Active 只顯示停用／停產，冇啟用）；每一步都對照 DB（`items`／`item_skus`／`item_audit_logs`）確認狀態、version、cascade 同 audit 完全正確，完成後清空全部種落嘅資料。

**Dependencies:** T17, T18

**Files actually touched：**

- `client/src/services/item.js`（新增 `activateItem()`、`deactivateItem()`、`discontinueItem()`、`archiveItem()`、`restoreItem()`、`activateSku()`、`deactivateSku()`、`discontinueSku()`、`archiveSku()`、`restoreSku()`）
- `client/src/pages/items/ItemDetailPage.vue`（頂部生命週期按鈕列；獨立嘅「啟用」dialog 揀 SKU；SKU 列表每行加 row menu）
- `client/src/pages/items/SkuDetailPage.vue`（頂部生命週期按鈕列，判斷邏輯連父 Item 狀態一齊睇）
- `client/src/pages/items/ItemsPage.vue`（兩個 view 都加返 `actions` 欄：Item 淨係「查看詳情」；SKU 加「查看詳情」＋row menu，範圍決定見上）
- `client/test/pages/items/itemDetail.test.js`（加 7 個案例）
- `client/test/pages/items/skuDetail.test.js`（加 7 個案例）
- `client/test/pages/items/items.test.js`（加 5 個案例）

**Estimated scope:** M（7 logical files；`ItemsPage.vue` 原本冇任何 row-level 導航——呢個 task 順便補埋「撳一行去邊個詳情頁」呢個之前一直冇做嘅缺口）

### Task T20：建立受控刪除、複製、SKU Code 修改與 Barcode 釋放

**Description:** 完成 Draft delete、Item copy、SKU Code 特批修改、Barcode release 的後端與對應 UI actions，維持高強度認證及完整稽核。

**⚠️ 範圍決定：「未引用」冇做真正嘅下游引用查詢**。design_spec §8.4 明確話「Phase 1 尚無庫存、採購或銷售表，永久刪除 Draft 只需檢查 Item aggregate 自身」——同 T16／T18 一致嘅範圍決定。「未引用」喺呢期即係「Item／SKU 自己仲係 draft」：Item／SKU 一旦離開 draft 就唔會再返嚟（冇任何 transition 會將已啟用過嘅 Item 變返 draft），所以呢個檢查已經足夠。`itemReferenced()`／`skuReferenced()` 呢兩個 error factory（已經喺 itemErrors.js 定義好）留返俾第一個真正有下游表嘅 task 用。

**Acceptance criteria:**

- [x] 永久刪除只允許未引用 Draft（`ITEM_DELETE_REQUIRES_DRAFT`／`SKU_DELETE_REQUIRES_DRAFT`），且不可令 Item 零 SKU（`SKU_IS_LAST_IN_ITEM`）；copy 不複製 Barcode 並要求每個來源 SKU 提供一個新 Code（`skus: [{ sourceSkuId, skuCode }]`，數量同來源一一對應）。
- [x] Code change／Barcode release 使用 `jwt-device-password`、reason、version、全域唯一（沿用 `skuCodeTaken()`）與 audit before／after。Barcode 有自己獨立嘅 optimistic lock `version`（同 SKU 個 version 分開）——`SKU_DETAIL_RESPONSE_SCHEMA` 因此加咗呢個欄位。
- [x] UI 不以一般 edit 偷改 Code／刪 Barcode：SKU update 表單嘅 Code 欄位維持 readonly，條碼列表淨係喺**睇緊模式**先顯示「釋放」（同編輯模式嘅刪除完全分開，唔會夾喺同一個「儲存」提交入面）；所有高風險 dialog（`promptPassword({ requireReason: true })`）清楚列出 target 名稱同「不可以復原」字眼。

**手動驗證中發現並修正嘅 bug：** `changeSkuCode()`／`releaseBarcode()` 呢兩個 `jwt-device-password` 端點，client 端最初冇喺 `httpClient.post()` 帶 `signed: true`——同 `user.js` 嘅 `create()`／`assignRoles()`／`resetPassword()` 一樣，`signed: true` 先會令 HttpClient 幫個 request 加設備簽章 header，冇呢個 flag 就算密碼啱都會俾伺服器拒絕（`DEVICE_SIGNATURE_REQUIRED`）。單元測試冧唔到呢個 bug，因為 mock 直接吞咗個 body，冇真正行過 HttpClient 嘅簽章邏輯——用真實 dev server＋真設備簽章手動測先發現，已經修正。

**Verification:**

- [x] `npm run lint`（repo 根）
- [x] `npx vitest run`（client，全部 48 個檔案、387 個案例，run 兩次穩定全過；新增 itemDetail.test.js 3 case、skuDetail.test.js 5 case）
- [x] `npm run build --workspace client`
- [x] `npm test --workspace server`（1227 個案例，含新增 17 個，run 兩次穩定全過；冇建 `itemAdminService.test.js`／`itemHandlers.test.js`：同 T16／T18 一致，correctness 幾乎全部係 compare-and-set UPDATE／DELETE、cascade 交易，只有真 DB 先驗得到）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemHighRisk.integration.test.js`（17 個案例，用 `test-support/testDevice.js` 嘅真 ECDSA 簽章驗 `jwt-device-password`：Item／SKU 刪除成功／非 draft 拒絕／version 衝突／密碼錯、Item 複製成功（UOM 複製、Barcode 唔複製）／sourceSkuId 唔啱／新 Code 撞現有 SKU、SKU 刪除唔可以刪到得返一個嘅最後一個、SKU Code 特批修改成功／撞 code／密碼錯／冇簽章、條碼釋放成功／跨 SKU／version 衝突），連跑 3 次全部穩定通過
- [x] Manual check：用真實 dev server＋seed data（草稿商品＋草稿 SKU、啟用商品連兩個條碼、多 SKU 草稿商品），喺瀏覽器度完整行一次：刪除草稿商品（連 SKU／UOM 一齊消失）→ 複製啟用商品成新草稿（UOM 複製、Barcode 完全冇複製，audit 記低來源對應）→ 特批修改 SKU Code（真設備簽章＋密碼，發現並修正咗上面嗰個 `signed: true` bug）→ 釋放條碼（其他條碼唔受影響）→ 刪除多 SKU 商品入面其中一個 SKU（另一個保留）；每一步都對照 DB（`items`／`item_skus`／`item_sku_barcodes`／`item_audit_logs`）確認狀態同 audit 正確，完成後清空全部種落嘅資料

**Dependencies:** T16, T17, T18, T19

**Files actually touched：**

- `server/src/modules/item/itemErrors.js`（新增 `itemDeleteRequiresDraft()`、`skuDeleteRequiresDraft()`、`lastSkuInItem()`、`barcodeNotFound()`）
- `server/src/modules/item/ItemAdminService.js`（新增 `deleteItem()`、`copyItem()`、`deleteSku()`、`changeSkuCode()`、`releaseBarcode()`；`#toSkuDetail()` 嘅 barcode 映射加返 `version`）
- `server/src/handlers/items/itemSchemas.js`（新增 `ITEM_DELETE_RESULT_SCHEMA`、`ITEM_COPY_REQUEST_SCHEMA`）
- `server/src/handlers/items/itemHighRiskHandlers.js`（新建：`DeleteItemHandler`、`CopyItemHandler`）
- `server/src/handlers/skus/skuSchemas.js`（新增 `SKU_DELETE_RESULT_SCHEMA`、`SKU_CODE_CHANGE_REQUEST_SCHEMA`、`SKU_BARCODE_PARAMS_SCHEMA`、`BARCODE_RELEASE_REQUEST_SCHEMA`；`SKU_DETAIL_BARCODE_SCHEMA` 加 `version`）
- `server/src/handlers/skus/skuHighRiskHandlers.js`（新建：`DeleteSkuHandler`、`ChangeSkuCodeHandler`、`ReleaseBarcodeHandler`）
- `server/src/handlers/item-audit/itemAuditSchemas.js`（`ITEM_AUDIT_ACTIONS` 加 `item.delete`／`item.copy`／`sku.delete`／`sku.code.change`／`barcode.release`）
- `server/test/integration/itemHighRisk.integration.test.js`（新建，17 個案例）
- `client/src/services/item.js`（新增 `deleteItem()`、`copyItem()`、`deleteSku()`、`changeSkuCode()`、`releaseBarcode()`；後兩者帶 `signed: true`）
- `client/src/pages/items/ItemDetailPage.vue`（「刪除」／「複製」按鈕；複製 dialog 逐個來源 SKU 收新 Code）
- `client/src/pages/items/SkuDetailPage.vue`（「刪除」／「特批修改 Code」按鈕連 dialog；`releaseBarcodeFlow()` 接住 `SkuEditor` 轉發嘅 `release` event）
- `client/src/components/items/SkuEditor.vue`（新增 `allowRelease` prop 同 `release` emit，轉俾 `SkuBarcodeEditor`）
- `client/src/components/items/SkuBarcodeEditor.vue`（新增 `allowRelease` prop：睇緊模式先顯示每行嘅「釋放」掣，emit `{id, barcode, version}`）
- `client/test/pages/items/itemDetail.test.js`（加 3 個案例）
- `client/test/pages/items/skuDetail.test.js`（加 5 個案例）

**Estimated scope:** M（14 logical files；跨 server／client 兩邊，比原本估計嘅 5 個檔案多，因為 barcode release 要幫每個條碼加返獨立 `version` 先做得到 compare-and-set，連帶影響 response schema 同 `SkuBarcodeEditor.vue`／`SkuEditor.vue` 兩層轉發）

### Task T21：建立下游 ItemLookupService contract

**Description:** 建立只供後端下游模組使用的 ID／Code／Barcode／批量 lookup，按 purchase／sale／inventory purpose 套用狀態、有效期與 flags。

**Acceptance criteria:**

- [x] Purchase 拒絕 Discontinued（`STATUS_NOT_ACTIVE`）；Sale 允許合資格 Discontinued 清貨（`item active＋sku discontinued`，或兩者都 discontinued）；Inventory 按 `inventoryTracked` 與 `includeInactive` 規則運作（預設淨係 Active 先 usable，`includeInactive:true` 先放行 Draft／Inactive／Discontinued，Archived 點都唔放行）。
- [x] Projection 包含 SKU ID、UOM factor（完整 `uoms[]`）、tracking、shelf life 及 `minimumReceiptLifeDays`／`minimumSaleLifeDays`（design_spec §8.3 原文用呢個命名，特登同 admin API 嘅 `minReceiptLifeDays`／`minSaleLifeDays` 分開，唔係打錯字）；service 本身完全唔讀 HTTP claims 亦都唔自行授權，方法簽名冇 `actorId`／permission 呢類參數，天生就唔要求 `item.view`。
- [x] `findManyByIds(100)` 用固定兩條 query（一條 SKU＋Item JOIN、一條 UOM）唔會逐個 id 查；`findByBarcode()` 撞到一個以上（`normalized_barcode` 理論上唔會，但屬於明確驗收標準）會記 error log 再拋 `BARCODE_LOOKUP_INCONSISTENT`，唔會攞第一筆將貨。

**Verification:**

- [x] `npm run lint`（repo 根）
- [x] `node --test --import ./test-support/testEnv.js test/itemLookupService.test.js`（29 個案例，假 database 覆蓋晒三種 purpose 嘅規則矩陣、batching、barcode 資料事故防呆）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemLookup.integration.test.js`（11 個案例，真 JOIN／真 UNIQUE key／真資料嘅 purpose 判斷），連跑 3 次全部穩定通過
- [x] `npm test --workspace server`（1267 個案例，含新增 40 個，run 兩次穩定全過）
- [x] 測試後確認 dev DB 無殘留

**Dependencies:** T12, T18

**Files actually touched：**

- `server/src/modules/item/ItemLookupService.js`（新建：`findById()`、`findByCode()`、`findByBarcode()`、`findManyByIds()`、`assertUsable()`，私有 `#toProjection()`／`#evaluateUsability()`／`#loadUomRows()`）
- `server/src/modules/item/itemErrors.js`（新增 `skuNotUsable()`、`barcodeLookupInconsistent()`）
- `server/src/modules/item/itemConstants.js`（新增 `ITEM_LOOKUP_PURPOSES`）
- `server/test/itemLookupService.test.js`（新建，29 個案例）
- `server/test/integration/itemLookup.integration.test.js`（新建，11 個案例）

**Estimated scope:** M（5 logical files；淨係後端，冇對外 HTTP endpoint、冇任何前端改動——呼叫端係之後嘅採購／庫存／銷售模組，唔係 Web UI）

## Checkpoint G：T19–T21 Core Feature Complete

- [ ] Core Item／SKU CRUD、狀態、高風險操作及 Lookup 均有可用 end-to-end path。
- [ ] Read-only、management、password、device-password 權限矩陣通過。
- [ ] 下游 purchase／sale／inventory contract 經真 DB 驗證。
- [ ] Client build 與全量 server/client tests 通過。

### Task T22：完成核心端到端、並發與安全驗證

**Description:** 建立 design §11.2–§11.4 的核心 HTTP＋DB、race、IDOR、input、projection 與 permission regression suite。

**⚠️ 範圍決定：用「Item＋兩個 SKU」代替 design_spec §11.2 原文嘅「Variant Item＋兩個 SKU」**。Variant 支援（`productType: "variant"`、Attribute schema、variant signature）要等 T23 先建立——T14 已經因為呢個理由決定 `createItem()` 只做 Standard，呢度延續同一個決定（見 tasks.md 嘅 T14 條目）。呢個 task 想驗嘅其實係「一個 Item 底下有兩粒 SKU」呢種情況本身嘅行為（cascade、搜尋、audit trail），同「呢兩粒 SKU 係咪由 variant attribute 組合出嚟」冇關係，所以用真實 create API 起第一粒 SKU、直接種多一粒 Draft SKU 落去同一個 Item（同 itemHighRisk／itemLifecycle 兩個 test 檔已經用緊嘅做法一致）一樣測得到，唔使等 T23。

**⚠️ Verification 命令修正**：原本寫嘅 `test/itemHandlers.test.js` 喺呢個 codebase從來冇存在過——Item 嘅 handler 測試一直跟 catalog 同一個慣例，逐個 resource 分開一份（`itemCatalogHandlers.test.js` 等），冇一個統一嘅 `itemHandlers.test.js`。`test/security.test.js` 就有存在，但淨係測緊框架層嘅 middleware（Helmet、CORS、trust proxy、body parser 413／400），完全冇任何模組專屬內容——error redaction（唔洩漏 SQL／stack／檔案路徑）呢一項本身就係呢個框架層嘅錯誤處理保證，套用喺每一個 handler（Item 都唔例外），唔使、亦都唔應該逐個模組各自重測一次。呢兩個 verification 命令喺下面改咗做實際做得到、亦都真係補到缺口嘅版本。

**手動驗證（其實係自動化整合測試）中發現並修正嘅 race condition bug：** `deactivateSku()` 原本嘅「呢粒係咪 Item 底下最後一個 Active SKU」檢查，係一句獨立嘅 `SELECT COUNT(*)`，同真正轉狀態嘅 `UPDATE` 分開兩句做。兩個並行請求各自停用同一個 Item 底下唔同嘅 Active SKU 時，兩個交易嘅 `SELECT COUNT` 都會見到「仲有第二粒 Active」（大家都見到對方仲未 commit 之前嘅舊值），結果兩個都通過檢查、都成功轉做 Inactive——個 Item 淨低返零個 Active SKU，違反咗呢個 task 自己嘅 acceptance criteria。用 `itemConcurrency.integration.test.js` 嘅 last-active race 測試喺真 MySQL 上實際重現咗呢個 bug（兩個 200，而唔係一個 200 一個 409），確認之後跟返 `UserAdminService.disable()` 防「停用最後一個 active admin」嗰個已有嘅寫法（見嗰個方法自己嘅註解）修正：將「仲有冇第二粒 Active」寫做 `UPDATE` 嘅 `WHERE` 子句本身一部分（`EXISTS` 子查詢），等 InnoDB 用真正嘅列鎖序列化呢兩個交易，第二個交易嘅 `WHERE` 判斷先會見到第一個已經 commit 咗嘅最新資料。修正之後連跑 5 次都穩定通過。

**Acceptance criteria:**

- [x] 端到端涵蓋 Catalog → Item＋兩個 SKU（範圍決定見上）→ 搜尋 → 更新 → lifecycle（activate／deactivate／archive／restore／SKU 逐一 restore）→ audit → cleanup，一個連續嘅 test 一次過行晒。
- [x] 同 version（Item update）、SKU Code（create）、Barcode（create）、Base UOM（SKU update）及 last-active（SKU deactivate）呢五種 race，用 `Promise.all` 真係同時發兩個 HTTP request，靠 InnoDB 列鎖／unique key 分勝負，只有合法嗰個成功——last-active 呢一項發現並修正咗上面嗰個真 bug。
- [x] 401（未登入）／403（冇 permission）、LIKE escape、sort whitelist（唔喺白名單嘅 sortBy 畀 schema 擋 400）、XSS text（`<script>` 原字串存返轉頭，唔會執行／清走／轉義）全部有新斷言；stale permission、IDOR（child ownership）、error redaction 三項確認咗已經由其他檔案覆蓋（見下面清單），冇重複再測一次。

**已經覆蓋、呢個 task 冇重複測嘅項目：**

- LIKE 萬用字元跳脫、response 唔洩漏 DB 內部欄位、read API 嘅 401／403／stale permission 矩陣——`itemRead.integration.test.js`（T12）。
- Child ownership／IDOR（`SKU_CHILD_MISMATCH`、跨 SKU barcode 404）——`itemUpdate.integration.test.js`（T16）、`itemHighRisk.integration.test.js`（T20）。
- Error response 唔洩漏 SQL／stack／檔案路徑——框架層跨模組保證，見 `apiDispatcher.test.js`、`mysqlDatabaseFailureModes.test.js`。

**Verification:**

- [x] `npm run lint`（repo 根）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemManagement.integration.test.js`（1 個連續端到端案例），連跑 3 次穩定通過
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemConcurrency.integration.test.js`（5 個 race 案例，含發現並修正 last-active race 嗰個），連跑 5 次穩定通過
- [x] `npm test --workspace server`（1273 個案例，含新增 6 個，run 兩次穩定全過）
- [x] 測試後確認 dev DB 無殘留

**Dependencies:** T07, T19, T20, T21

**Files actually touched：**

- `server/src/modules/item/ItemAdminService.js`（修正 `deactivateSku()` 嘅 last-active race：檢查移入 `UPDATE` 嘅 `WHERE EXISTS` 子句）
- `server/test/integration/itemManagement.integration.test.js`（新建，1 個連續端到端案例）
- `server/test/integration/itemConcurrency.integration.test.js`（新建，5 個 race 案例）

**Estimated scope:** M（3 logical files；冇建 `itemHandlers.test.js`，冇改 `security.test.js`——原因見上面嘅 verification 命令修正說明）

### Task T23：建立 Attribute schema、variant signature 與 domain 規則

**Description:** 以 `0018`–`0022` 建立 Attribute definition／option／category mapping／typed values，並完成 deterministic variant signature。

**⚠️ 承接 T14 範圍決定（2026-09-07）：T14 建 Item 時只做 Standard，`createItem()` 對 `productType: "variant"` 回「未支援」錯誤，Create request schema 完全冇 `variantValues` 欄位。本 task 已完成以下補做項目：**

- [x] `server/src/modules/item/variantSignature.js`（新檔）加咗 §4.4 嘅 variant signature 計算函式（attributeId 排序、`attributeId=typedValue` 正規化、SHA-256）。
- [x] `server/src/handlers/items/itemSchemas.js` 嘅 create request schema 加咗 `skus[].variantValues`（`{attributeId, optionId}[]`，預設 `[]`）。
- [x] `ItemAdminService.createItem()` 開放咗 `productType: "variant"`：驗證 `variantValues` 入面嘅 attributeId／optionId 真係存在於 `item_attribute_definitions`／`item_attribute_options`（唔止計 hash，仲有查表確認合法），計出 signature 後靠 `(item_id, variant_signature)` unique key 擋重複組合。
- [x] 對應更新咗 T14 嘅 integration test（`itemCreate.integration.test.js`），加咗 8 個 Variant Item 建檔案例。

**⚠️ Schema sign-off（2026-09-07，已取得使用者明確批准）：** 起 `0018`–`0022` 五個新表之前，已經喺 chat 入面解釋咗每個表嘅欄位、型別、default、每個 index／constraint 嘅用途，同對現有資料／程式碼嘅影響（全部係新表，冇對現有表做任何改動），跟 CLAUDE.md 第 8 條先解釋後批准。設計入面有兩個 spec 冇講明、而且一用落 production 就實際上冇得回頭嘅演算法決定，用 `AskUserQuestion` 問過使用者：Unicode normalization form（NFC vs NFD vs 唔做 normalize）同 canonical string 嘅 separator 字元（`&` vs `|` vs 其他）。使用者第一次冇答（dismiss），之後主動要求用中文解釋清楚問題，解釋之後回覆「按你的建議做」，即係批准咗建議嘅 **NFC** normalization 同 **`&`** separator，連同之前提出嘅完整 5-table 設計。

- `item_attribute_definitions`：`id, code(UNIQUE), name, data_type, uom_id(FK item_uoms RESTRICT), is_variant, is_filterable, status, version, created_at, updated_at, created_by, updated_by` —— Attribute 本身嘅定義（例如「顏色」「容量」），`data_type` 決定用邊個 value column，`is_variant` 決定呢個 attribute 可唔可以用嚟分 SKU variant。
- `item_attribute_options`：`id, attribute_id(FK CASCADE), value, label, sort_order, status` + 標準欄位，`UNIQUE(attribute_id, value)` —— `single_option` 類型 attribute 嘅可選值（例如「顏色」底下嘅「紅」「藍」）。
- `item_category_attributes`：`category_id(FK CASCADE), attribute_id(FK RESTRICT), required_for_activation, sort_order` + `created_at/updated_at`，複合 PK `(category_id, attribute_id)`，刻意冇 `version`／`created_by`／`updated_by`（跟 design_spec 講明由 Category 自己嘅 `expectedAttributeIds` compare-and-set 管理，唔係逐行版本控制）—— 邊個 category 要求邊啲 attribute。
- `item_attribute_values`：`item_id(FK CASCADE), attribute_id(FK RESTRICT), option_id(FK RESTRICT, nullable), value_text, value_decimal, value_boolean, value_date, updated_at, updated_by`，複合 PK `(item_id, attribute_id)` —— Item 層面嘅 attribute typed value（非 variant 用途，例如唔分 SKU 嘅「產地」）。
- `item_sku_attribute_values`：形狀同上但用 `sku_id(FK CASCADE)` 代替 `item_id`，複合 PK `(sku_id, attribute_id)` —— SKU 層面嘅 attribute typed value，即係實際組成 variant signature 嘅嗰啲 rows（hash 只用嚟做唯一性檢查，呢啲 rows 先係顯示／rebuild 嘅 source of truth）。

**Acceptance criteria:**

- [x] Typed value 僅有一個 value column 有值，category mapping 與 option FK delete rules 符合設計（`itemAttributeMigrations.integration.test.js` 逐表用真 SQL 驗證咗 CASCADE／RESTRICT 同 unique constraint）。
- [x] Signature 不受輸入順序影響；同 Item 相同組合由 `(item_id, variant_signature)` 擋下（`variantSignature.test.js` 嘅 order-independence 測試；`itemCreate.integration.test.js` 嘅重複組合 409 測試連埋 rollback 驗證）。
- [x] Unicode normalization（NFC）有固定測試向量（`variantSignature.test.js` 用 `String.fromCodePoint` 構造精確嘅 precomposed／decomposed 兩種 "café" 表示法，驗證正規化後 signature 相同）。
- [ ] 「Active SKU 使用中的 data type／variant flag 不可破壞性修改」——**延後至 T24**：T23 範圍淨係開放 `createItem()` 消費已存在嘅 attribute／option 資料，完全冇建立 attribute／option 嘅寫入（create／update／delete）API，測試全部直接用 SQL 種 fixture（同 T16／T18／T20 已用開嘅慣例一致）。冇寫入 API 就唔存在「修改」呢件事，呢條 criteria 天然要等 T24 起咗 Attribute CRUD 先有意義去驗證。

**Verification:**

- [x] `npm run lint`（repo 根）
- [x] `npm test --workspace server -- test/variantSignature.test.js`（14 個案例，全過）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemAttributeMigrations.integration.test.js`（7 個案例），連跑 3 次穩定通過
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemCreate.integration.test.js`（21 個案例，含新增 8 個 variant 案例），連跑 3 次穩定通過
- [x] `npm test --workspace server`（1301 個案例），run 兩次穩定全過
- [x] 測試後確認 dev DB 無殘留

**過程中發現並修正嘅兩個 bug：**

- **`.cause` sqlMessage 解包漏咗**：`#createSkuRow` 最初用 `error?.sqlMessage` 判斷係咪 `uq_item_skus_item_variant` 撞 key，但 `MySqlDatabaseExecutor`（`withTransaction()` 入面用嗰個）將真正嘅 mysql2 error 包咗一層 `MySqlDatabaseOperationError`，真正嘅 `sqlMessage`／`code` 喺 `error.cause` 度，唔喺 `error` 本身。結果原本應該回 `VARIANT_COMBINATION_TAKEN` 嘅案例錯回咗 `SKU_CODE_TAKEN`。用一個直連 mysql2 嘅拋棄式 script 重現咗真實錯誤格式之後確認，改用 `error?.cause?.sqlMessage ?? error?.sqlMessage` 修正。
- **漏咗寫 `item_sku_attribute_values` rows**：初版淨係計咗 hash 存落 `item_skus.variant_signature`，冇實際插入 `item_sku_attribute_values`。重讀 design_spec §4.4 原文「呢個 hash 只用於唯一性，不代替實際 attribute rows」先發現漏咗，修正咗 `#resolveVariantSignature()` 令佢連 `variantValues` 一齊帶返出嚟，`#createSkuRow()` 插入 `item_skus` 之後即刻逐條插返 `item_sku_attribute_values`。

**Dependencies:** T04, T08, T10

**Files actually touched：**

- `server/database/migrations/0018_create_item_attribute_definitions.js`（新建，已 apply）
- `server/database/migrations/0019_create_item_attribute_options.js`（新建，已 apply）
- `server/database/migrations/0020_create_item_category_attributes.js`（新建，已 apply）
- `server/database/migrations/0021_create_item_attribute_values.js`（新建，已 apply）
- `server/database/migrations/0022_create_item_sku_attribute_values.js`（新建，已 apply）
- `server/src/modules/item/variantSignature.js`（新建：`typedValueToCanonicalString()`、`computeVariantSignature()`）
- `server/src/modules/item/itemConstants.js`（加 `ATTRIBUTE_DATA_TYPES`）
- `server/src/modules/item/itemErrors.js`（移除已死嘅 `itemVariantNotSupported()`；加 `variantValuesRequired()`、`standardSkuHasVariantValues()`、`attributeOptionNotFound()`；enrich `attributeValueInvalid()`）
- `server/src/handlers/items/itemSchemas.js`（`ITEM_CREATE_SKU_VARIANT_VALUE_SCHEMA`；`ITEM_CREATE_SKU_SCHEMA` 加 `variantValues`）
- `server/src/modules/item/ItemAdminService.js`（`createItem()` 開放多 SKU／variant；新增 `#resolveVariantSignature()`；`#createSkuRow()` 加 variant signature 綁定同 `item_sku_attribute_values` 寫入同重複 key 消歧）
- `server/test/variantSignature.test.js`（新建，14 個案例）
- `server/test/integration/itemCreate.integration.test.js`（加 `seedVariantAttribute()` helper 同 8 個新案例，取代舊嘅「未支援」測試）
- `server/test/integration/itemAttributeMigrations.integration.test.js`（新建，7 個案例，驗證五個新表嘅 constraint／FK delete rule）

**Estimated scope:** L（5 個新 migration + 1 個新 domain module + service／schema／errors 改動 + 3 個 test 檔；比原估計大，因為原「Files likely touched」淨列咗 migration 檔，冇算入 T14 補做項目嘅實際範圍）

### Task T24：完成 Attribute／Variant API 與 UI

**Description:** 擴充 Catalog service／handlers 與 Item editors，支援 Attribute CRUD、options、category rules 及 Variant matrix。

**⚠️ 範圍決定（1）：Category attribute rules 用獨立端點，不是塞入 `updateCategory()`。** design_spec §6.4 原文係「Category attribute rules 包含在 Category get／update response 及 body，以 `expectedAttributeIds` 做 compare-and-set」。`updateCategory()` 已經係一組完整覆蓋（name／parentId／sortOrder）用 `version` compare-and-set；attribute 規則係另一種集合（多對多 mapping），用嘅係另一種 compare-and-set token（`expectedAttributeIds`——`item_category_attributes` 冇逐行 version，見 0020 migration 嘅註解）。將兩種完全不同嘅 compare-and-set 塞入同一個 request body，唯一好處係「符合原文一句描述」，代價係兩個獨立關注點綁死在同一個 schema、同一次成功／失敗。實際做法：新增 `GET /api/v1/catalog/categories/:id/attributes`（讀現況，俾前端組 `expectedAttributeIds`）同 `POST /api/v1/catalog/categories/:id/attributes/assign`（原子覆蓋），對應 `ItemCatalogService.getCategoryAttributes()`／`assignAttributes()`——後者本身已經係 design_spec §8.2 點名嘅獨立方法，呢個決定只係令 HTTP 切法跟返 service 方法嘅實際形狀，行為與資料形狀同設計一致，只係端點數量唔同。

**⚠️ 範圍決定（2）：`AttributeValueEditor.vue` 唔喺呢個 task 起。** design_spec §7.4 將呢個元件同 `ItemMediaPanel.vue`／`ItemAuditTimeline.vue` 等一齊列喺 Item／SKU editor 嘅共用元件清單，但佢對應嘅係 Item／SKU 層級嘅**非 variant** typed value（`item_attribute_values`／未來 SKU 側對應表），而 `ItemAdminService.createItem()`／`updateItem()` 完全未讀寫呢兩張表——冇後端 API 可以呼叫，起呢個元件只會係一個冇嘢好接嘅空殼。呢個 task 嘅 acceptance criteria 只提到「Attributes page 與 VariantMatrixEditor」，兩者都已經完成；`AttributeValueEditor.vue` 留返俾將來一個會真正打開 item-level attribute value 寫入 API 嘅 task。

**⚠️ 範圍決定（3）：Variant SKU 建檔用「一個共用 SkuEditor 樣板 + VariantMatrixEditor 產生嘅組合列表」，唔係每個組合各自一份完整 SkuEditor。** UOM、barcode、追蹤政策、可採購／可銷售、建議售價呢啲欄位喺一個 Item 底下嘅所有 Variant SKU 幾乎一定共用（同一款包裝、同一種賣法，只係規格唔同），逐個組合分開編輯呢啲欄位只會令使用者要重複輸入同一組資料 N 次。`SkuEditor.vue` 加咗一個 `hideIdentity` prop（收埋 SKU Code／名稱兩個輸入格，向後相容、預設 false 唔影響現有用法），Variant 模式下渲染一次呢個共用樣板，`VariantMatrixEditor.vue` 淨係負責「呢個 Item 有邊幾個規格組合」同每個組合各自嘅 SKU Code／名稱，兩者提交時先合併成完整嘅 `skus[]`（`client/src/services/item.js` 嘅 `createItem()` 相應加咗 `skus`（複數）參數，同原本嘅 `sku`（單數）互斥並存，Standard 路徑完全冇變）。呢個設計嘅已知限制：後端回嘅 field-level validation error 若果指向第二個或以後嘅組合嘅 UOM／barcode 子集（例如 `skus.2.uoms.0.uomId`），冇一個對應嘅、屬於第 2 個組合嘅獨立輸入格可以標紅——`knownFieldPaths` 有為每個組合 index 註冊呢類 path，令呢種 error 唔會錯誤咁跌入 summary 的「無法對應」分支，但畫面上實際標紅嘅始終係嗰個共用樣板（即第 0 格）嘅輸入。SKU Code／名稱本身（每個組合唯一嘅部分）冇呢個限制，各自組合都有獨立輸入格。

**Acceptance criteria:**

- [x] Attribute option 更新與 category assignment 原子執行，`expectedAttributeIds` stale 時拒絕覆蓋。
- [x] Variant Item 必須有完整且唯一組合；Standard Item 不接受 variant values（T23 已實作，本 task 未變動；`VariantMatrixEditor.vue` 令使用者喺瀏覽器實際做得到呢件事，並且在真瀏覽器＋真 MySQL 上驗證咗重複組合會俾伺服器拒絕）。
- [x] Attributes page 與 VariantMatrixEditor 支援資料型別、選項、必填及錯誤回填。

**Verification:**

- [x] `npm run lint`（repo 根）
- [x] `npm test --workspace server -- test/itemCatalogService.test.js`（58 個案例，17 個新增，全過；**Verification 命令修正**：原本寫嘅 `test/itemAdminService.test.js` 喺呢個 codebase從來冇存在過——同 T22 已經記錄過嘅理由一致，`ItemAdminService` 一直用真 MySQL integration test 覆蓋，未曾有過假 DB 單元測試檔；T24 冇改動 `ItemAdminService.js`，Attribute CRUD／Category assignment 全部喺 `ItemCatalogService.js`，跟 Category／Brand／UOM 同一個歸屬）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemCatalog.integration.test.js`（9 個案例，2 個新增），連跑 3 次穩定通過
- [x] `npm test --workspace server`（1320 個案例），連跑 2 次穩定全過
- [x] `npm test --workspace client`（397 個案例，全過，含 `catalogPages.test.js` 新增嘅 AttributesPage／Category 屬性規則測試同 `itemCreate.test.js` 新增嘅 Variant flow 測試）
- [x] `npm run build --workspace client`（production build 成功）
- [x] Manual check（真瀏覽器＋真 MySQL＋真後端，非 mock）：建立 `FLAVOR` 屬性（`single_option`、`is_variant`、兩個 option「甜」「酸」）→ 喺 Item 建檔頁切去「多規格（Variant）」→ 揀屬性同兩個 option → 「產生組合」自動帶出兩行（SKU Code 用 option 嘅 `value` 建議、名稱用 `label`）→ 儲存草稿成功，DB 直接驗證兩個 SKU 各自嘅 `variant_signature` 唔同、`item_sku_attribute_values` 對應正確 → 用同一個 attributeId／optionId 組合起第二個 Item 嘅兩個 SKU（經真 HTTP，唔經 UI——UI 嘅笛卡兒積產生器本身結構性做唔到重複組合，呢個係刻意嘅設計，唔係漏測），確認回 409 `VARIANT_COMBINATION_TAKEN` 且交易完全 rollback（DB 查證零殘留）→ Category 頁「屬性規則」dialog 勾選屬性、切換「啟用時必填」、儲存，DB 直接驗證 `item_category_attributes` 正確寫入。測試資料事後全部經 SQL 清走。
- [x] 測試後確認 dev DB 無殘留

**過程中發現並修正嘅兩個 bug：**

- **`CategoriesPage.vue` 讀 `attributeList()` 回傳形狀錯咗**：`itemCatalogService.attributeList()`（同 `brandList()` 一樣）將後端 `{items, total, page, pageSize}` 轉做前端慣用嘅 `{rows, rowsNumber}`（餵畀 `DataTable` 嘅 `fetch` prop），但 `openAttributesDialog()` 最初寫成解構 `{items}`，實際會攞到 `undefined` 再喺 `.filter()` 炸出 `TypeError`。喺補寫 `catalogPages.test.js` 嘅「屬性規則」測試時第一次執行就發現（mock 直接用真實形狀 `{rows, rowsNumber}`），修正做解構 `{rows: attributes}`。
- **`VariantMatrixEditor.vue` 自動建議嘅 SKU Code 用錯咗欄位**：初版用 option 嘅 `label`（顯示用，好多時係中文，例如「紅」）join 出 SKU Code 建議值，喺 `itemCreate.test.js` 新增嘅 Variant flow 測試中斷言 code 應該係 `"RED"`（用 `value`）先發現：SKU Code 呢類穩定代碼理應用 option 嘅 `value`（多數係 ASCII，例如 `"red"`），`label` 先啱用喺 SKU 名稱建議。修正後 `optionValue()`／`optionLabel()` 兩個獨立 helper 分別供應 code／name 嘅建議值。

**Dependencies:** T05, T17, T23

**Files actually touched：**

- `server/src/modules/item/itemErrors.js`（加 `attributeCodeTaken()`、`attributeOptionValueTaken()`、`attributeInUse()`、`attributeOptionInUse()`、`categoryAttributesStale()`）
- `server/src/handlers/catalog/catalogSchemas.js`（Attribute 相關 schema 一組；`CATEGORY_ATTRIBUTE_ASSIGNMENT_SCHEMA`／`CATEGORY_ATTRIBUTES_RESPONSE_SCHEMA`）
- `server/src/handlers/catalog/attributeHandlers.js`（新建：Attribute 分頁查詢、新增、修改、四個狀態動作、刪除，共 8 個 handler）
- `server/src/handlers/catalog/categoryHandlers.js`（加 `GetCategoryAttributesHandler`／`AssignCategoryAttributesHandler`）
- `server/src/modules/item/ItemCatalogService.js`（Attribute CRUD 全套：`listAttributes`／`createAttribute`／`updateAttribute`（原子覆蓋 option 集合，非刪晒重插——option id 可能已被 typed value 嘅 `option_id` FK RESTRICT 指住）／四個狀態動作／`deleteAttribute`；`getCategoryAttributes`／`assignAttributes`；新增 `isRowReferenced()` helper）
- `server/test-support/fakeItemCatalogDatabase.js`（擴充支援 `item_attribute_definitions`／`item_attribute_options`／`item_category_attributes`／模擬 `item_sku_attribute_values` 使用中判斷）
- `server/test/itemCatalogService.test.js`（新增 17 個案例：Attribute CRUD、option 原子覆蓋、isVariant 使用後鎖定、category attribute assignment 含 stale 拒絕）
- `server/test/integration/itemCatalog.integration.test.js`（新增 2 個真 HTTP＋MySQL 案例：Attribute 全生命週期含 option 刪除擋／isVariant 鎖定／delete-in-use；Category attribute assignment 含 stale 拒絕）
- `client/src/services/itemCatalog.js`（Attribute CRUD 8 個方法；`getCategoryAttributes`／`assignCategoryAttributes`）
- `client/src/services/item.js`（`createItem()` 加 `skus`（複數）參數，同 `sku`（單數）互斥並存）
- `client/src/pages/items/AttributesPage.vue`（新建：Attribute 分頁列表＋新增／編輯 dialog，含 option 動態編輯）
- `client/src/pages/items/CategoriesPage.vue`（加「屬性規則」dialog：讀現況、勾選＋必填 toggle、`expectedAttributeIds` compare-and-set、stale 時重新載入）
- `client/src/components/items/VariantMatrixEditor.vue`（新建：揀屬性／選項、笛卡兒積產生組合、每個組合獨立 SKU Code／名稱輸入）
- `client/src/components/items/SkuEditor.vue`（加 `hideIdentity` prop，Variant 模式收埋 SKU Code／名稱）
- `client/src/pages/items/ItemCreatePage.vue`（Standard／Variant 切換、`buildPayload()` 分支產生 `sku` 或 `skus`、`knownFieldPaths` 涵蓋多組合）
- `client/test/pages/items/catalogPages.test.js`（新增 AttributesPage 一組測試、CategoriesPage 屬性規則兩個測試）
- `client/test/pages/items/itemCreate.test.js`（新增 Variant flow 兩個測試）

**Estimated scope:** L（8 個新／改動後端檔 + 7 個新／改動前端檔 + 4 個 test 檔；比原估計大，因為原「Files likely touched」冇算入 Category attribute assignment 嘅獨立端點、`item.js`／`SkuEditor.vue`／`ItemCreatePage.vue` 嘅 Variant 建檔整合）

## Checkpoint H：T22–T24 Retail Data Gate

- [ ] 核心安全／並發 suite 綠燈。
- [ ] Attribute migrations、typed values、signature 與 UI flow 完成。
- [ ] Standard／Variant 邊界與 duplicate combination 在 service、DB、UI 三層一致。
- [ ] Full coverage 與 client build 通過。

### Task T25：建立 Media schema、service、API 與孤兒檔清理

**Description:** 建立 `0023_create_item_media.js`、ItemMediaService、upload／download／update／delete handlers 及 `ItemMediaCleanupJob`，處理 DB 與檔案系統非原子一致性。

**Schema sign-off（CLAUDE.md 規則 8）：** 開工前喺 chat 完整解釋咗 `item_media` 呢張新表（`id`／`item_id`（FK CASCADE）／`sku_id`（nullable，composite FK 到 `item_skus(id, item_id)`，複用 T09 已經建好、專門留俾呢種用途嘅 `uq_item_skus_id_item`）／`media_kind`／`stored_name`（伺服器生成、UNIQUE）／`original_name`／`mime_type`／`byte_size`／`sha256`／`is_primary`／`sort_order`／`primary_scope`（generated column 做 primary image 唯一性）／`created_at`／`created_by`），並用中文覆述一次，得到使用者「OK，繼續」明確批准之後先寫同執行 migration。

**⚠️ 範圍決定：`primary_scope` 用 `VIRTUAL` 唔係 `STORED`。** 原本嘅提案（同批准嗰刻嘅設計）係跟 `item_sku_uoms.base_slot`／`item_sku_barcodes.primary_scope` 嗰套慣例用 `STORED`。實際喺真 MySQL 建表時炸咗 `ERROR 1215 (HY000): Cannot add foreign key constraint`——診斷後確認：InnoDB 唔准喺「一個 indexed STORED generated column 嘅運算式引用住嘅欄位」上面加 `ON DELETE CASCADE`／`SET NULL` 嘅 FK（`RESTRICT` 冇問題，已經逐一實測驗證：STORED+CASCADE 失敗、STORED+RESTRICT 成功、VIRTUAL+CASCADE 成功）。`item_media.item_id`／`sku_id` 兩者都要 CASCADE（media 係 Item／SKU 嘅從屬資料，Item 或 SKU 刪除時理應一齊消失），改用 `RESTRICT` 會令刪除 Draft Item／SKU 呢個既有操作在有 media 掛住時失敗，屬於功能倒退；改用 `VIRTUAL` 則完全冇呢個限制（MySQL 5.7 起 InnoDB 支援喺 VIRTUAL generated column 上面起 UNIQUE secondary index，且行為與 `STORED` 對呢個 unique 約束嚟講完全等價），所以改用 `VIRTUAL`，欄位語意、唯一性保證、命名全部不變，唯一改動係 migration 裡面嗰一個關鍵字，已喺 migration 檔加詳細註解記低呢個實測結論，避免下一個抄呢個 pattern 嘅表重踏同一個坑。

**⚠️ 範圍決定：Item／SKU GET response 嘅 `media` 陣列繼續回空，唔喺呢個 task 接上。** `server/src/handlers/items/itemSchemas.js`／`skus/skuSchemas.js` 現時分別用 `attributeValues: { maxItems: 0 }`／`media: { maxItems: 0 }` 頂住呢兩個尚未接通嘅陣列——呢個 task 嘅 acceptance criteria 冇要求接通（同 T24 對 `attributeValues` 嘅範圍決定一致：`item_attribute_values` 表喺 T23 已經建好，但 T24 都冇接上 GET response，一路留空到而家）。T25 嘅 Files likely touched 亦冇列 `ItemAdminService.js`／`itemSchemas.js`／`skuSchemas.js`。接通呢兩個陣列（連同對應嘅 response schema `maxItems` 上限）留返俾之後一個專門處理 Item／SKU 完整 read model 嘅 task；T26（Media UI）要顯示現有 media 列表時，需要一併決定係接通呢條路徑定係加一個獨立嘅「list media by target」端點——design_spec §6.6 嘅 Media APIs 表本身冇列呢種端點，屬於 T26 開工時要面對嘅開放問題。

**⚠️ 範圍決定：`ItemMediaService` 冇獨立嘅假 DB 單元測試檔。** 跟 `ItemAdminService` 一路以嚟嘅慣例一致（`test/itemAdminService.test.js` 喺呢個 codebase 從未存在過，T18／T22／T24 都記錄過同一件事）：呢個模組嘅方法（`attach`／`update`／`resolveDownload`／`delete`／`findStoredNames`）幾乎全部係「交易＋SQL」，冇 `ItemCatalogService` 嗰種值得獨立驗證嘅純 diff 邏輯。真正純邏輯嘅部分（kind／mimeType／size 校驗、symlink／grace period 判斷）分別喺兩個地方蓋到：前者由 `test/integration/itemMedia.integration.test.js` 對住真實檔案簽章驗證；後者由新增嘅 `test/itemMediaCleanupJob.test.js` 用假 DB＋真臨時目錄蓋到。`server/config/scheduler.js` 亦未改動——`ItemMediaCleanupJob` 自己喺 `static jobs` 宣告咗合理嘅預設值（每日一次、cluster scope），同其他既有 job 一樣，config 檔只喺需要*覆寫*部署層設定時先加一行，冇覆寫需求就唔加。

**Acceptance criteria:**

- [x] 只接受 PNG／JPEG／WebP／PDF 的合法 extension、MIME、signature 及大小；拒絕 SVG、polyglot、traversal、symlink 越界（四種型別全部已喺框架 `FileTypeService.BUILT_IN_FILE_TYPES` 內建、含內容簽章比對；SVG 唔喺 route allowlist 之內，415 拒絕；kind／實際 mimeType 唔對版由 `ItemMediaService.attach()` 額外核，400 `MEDIA_KIND_MISMATCH`；圖片／附件各自嘅大小上限亦由 service 分開核，400 `MEDIA_FILE_TOO_LARGE`；下載路徑嘅 traversal／symlink 由框架既有嘅 `openFileWithinDirectory()` 擋，另加 `resolveDownload()` 對 `stored_name` 本身嘅路徑分隔符防線）。
- [x] DB commit 前失敗清 orphan；delete 先提交 metadata／audit 再 unlink，失敗記 log 並由 cleanup 重試（前者完全由框架既有嘅 `apiDispatcher.js` → `cleanupUploadedFiles()` 處理，唔使呢個 task 自己寫——已喺整合測試用兩條失敗路徑「MEDIA_KIND_MISMATCH」同「MEDIA_FILE_TOO_LARGE」證明落盤咗嘅檔案會自動清走；後者由 `deleteItemMediaHandler.js` 喺 service 交易 commit 之後先 unlink，失敗時記 `item.media_delete_failed` 結構化 log，由新增嘅 `ItemMediaCleanupJob` 定期重試）。
- [x] Primary image unique、SKU／Item ownership composite FK、download headers 及 stored path 白名單正確（真 MySQL 驗證：上傳第二張 primary image 令舊嗰張自動變返 0；composite FK `(sku_id, item_id) REFERENCES item_skus (id, item_id)`；下載回應 `Content-Type` 對應實際 MIME、`Content-Disposition: attachment`（`<img>` 標籤載入子資源時瀏覽器唔理呢個 header，圖片一樣內嵌顯示，PDF 則强制落地——符合 design_spec 要求，唔需要框架另外支援 inline 分支）、`X-Content-Type-Options: nosniff` 由全域 `helmet()` 提供；stored path 白名單由 `download.root` 固定死喺 `itemConfig.mediaDirectory`，handler 唔能夠自己組任何其他路徑）。

**Verification:**

- [x] `npm run lint`（repo 根，全部檔案，clean）
- [x] `npm test --workspace server`（1337 個案例，17 個新增，全過；**Verification 命令修正**：原本寫嘅 `test/itemMediaService.test.js`／`test/itemFileHandlers.test.js` 從未建立——理由見上面「範圍決定」段落，改為 `test/itemMediaCleanupJob.test.js`（8 個新案例）＋既有嘅 `test/serviceContainer.test.js` 白名單更新）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemMedia.integration.test.js`（新建，9 個案例），連跑 3 次穩定全過
- [x] 測試後確認 dev DB／`storage/items/` 目錄均無殘留

**過程中發現並修正嘅一個嚴重 bug（DDL 層面，發生喺真正套用 migration 嗰刻，唔係 code review 揪出嚟）：**

- **`primary_scope` 用 `STORED` generated column 加 `ON DELETE CASCADE` 嘅 FK 喺真 MySQL 底下完全建唔到表**：詳情見上面「範圍決定」段落。呢個唔係 code 邏輯錯，係對 InnoDB 一個冷門限制嘅錯誤假設——`item_sku_uoms`／`item_sku_barcodes` 兩個先例用 `STORED` 冇出事，係因為佢哋嘅 FK 全部係 `RESTRICT`，冇一個係 `CASCADE`。修正方式係逐步二分：由完整表定義開始，拆到得返三隻欄＋一個 FK 仲原樣重現、再逐一換走變數（`STORED`→`VIRTUAL`、`CASCADE`→`RESTRICT`）確認邊個組合先係真正嘅成因，避免瞎猜就大改設計。

**Dependencies:** T03, T08, T11, T16

**Files actually touched：**

- `server/database/migrations/0023_create_item_media.js`（新建）
- `server/src/modules/item/itemConstants.js`（加 `MEDIA_KINDS`、`MEDIA_KIND_MIME_TYPES`）
- `server/src/modules/item/itemErrors.js`（加 `mediaNotFound()`、`mediaKindMismatch()`、`mediaFileTooLarge()`、`mediaPrimaryRequiresImage()`、`mediaFileRequired()`）
- `server/src/modules/item/ItemMediaService.js`（新建：`attach`／`update`／`resolveDownload`／`delete`／`findStoredNames`）
- `server/src/handlers/item-media/itemMediaSchemas.js`（新建：三個 handler 目錄共用嘅 schema，含 multipart 欄位嘅字串樣式白名單）
- `server/src/handlers/item-media/downloadItemMediaHandler.js`（新建）
- `server/src/handlers/item-media/updateItemMediaHandler.js`（新建）
- `server/src/handlers/item-media/deleteItemMediaHandler.js`（新建：交易外 unlink＋失敗 log）
- `server/src/handlers/items/itemMediaUploadHandler.js`（新建）
- `server/src/handlers/skus/skuMediaUploadHandler.js`（新建）
- `server/src/services/itemMedia/ItemMediaCleanupJob.js`（新建：cluster scope，掃受控 media root 清 orphan）
- `server/test/itemMediaCleanupJob.test.js`（新建，8 個案例：cluster scope 宣告、service 自發現、缺目錄無害、引用檔保留、grace period 前後、symlink 不跟隨、unlink 失敗記 log）
- `server/test/serviceContainer.test.js`（白名單加 `job.itemMediaCleanup`）
- `server/test/integration/itemMedia.integration.test.js`（新建，9 個案例：Item／SKU 兩層完整生命週期、primary 唯一性、型別／大小校驗、version 對版、權限矩陣、密碼錯）

**Estimated scope:** L（1 個新 migration + 1 個新 domain module + 6 個新 handler／schema 檔 + 1 個新 job + 3 個 test 檔；比原估計大，因為原「Files likely touched」淨列咗 5 項，冇算入 upload handler 要分掛喺 `items/`／`skus/` 兩個目錄、以及 item-media 專屬嘅 schema 檔）

### Task T26：建立 Media UI 與檔案安全整合測試

**Description:** 建立 client media service、ItemMediaPanel、上傳進度、preview、primary、排序與刪除操作，補齊 browser-facing security regression。

**⚠️ 範圍決定：接通 Item／SKU GET response 嘅 `media` 陣列，唔留返俾未編號嘅 task。** T25 完成時將呢個開放問題明確記低（見 T25 段落）：design_spec §6.6 冇列一支「list media by item/sku」端點，`ItemMediaPanel.vue` 要顯示現有清單，唯一合理來源就係 Item／SKU 自己嘅 detail response。開工先發現 `#toItemDetail()` 連 `media` 呢個欄都未有（唔淨係「固定回空陣列」，係response schema 完全冇呢個欄），同 §6.2 端點表講嘅「回 Item、全部 SKU 摘要、attributes、media 及 version」對唔上——呢個係 T14／T17 遺留低嘅缺口，唔關 T25 事。修正咗：`ItemAdminService.getItem()`／`getSku()` 各自加一句查 `item_media`（Item 層級查 `sku_id IS NULL`，SKU 層級查 `sku_id = ?`，兩者唔會互相洩漏），`itemSchemas.js`／`skuSchemas.js` 嘅 response schema 引入 `item-media/itemMediaSchemas.js` 已有嘅 `MEDIA_SUMMARY_SCHEMA`（跨 handler 目錄共用呢一份而唔係各自定義——理由同 upload body schema 嗰個決定一致，見 T25 段落）。

**⚠️ 範圍決定：`HttpClient.js` 加 FormData passthrough 同 `getBlob()`，唔另開一條唔行 HttpClient 嘅路徑。** 兩個原因驅動呢個框架層改動：(1) 現有 `request()` 一律 `JSON.stringify(body)` 並手動設 `Content-Type: application/json`，直接餵一個 `FormData` 落去只會將佢字串化成 `"[object FormData]"`——上傳一定會壞；(2) 認證用 Authorization header（Bearer token）唔係 cookie，`<img src>`／`<a href>` 冚唔到自訂 header，一定要用 `fetch()` 先攞到 blob 先可以顯示或者觸發下載，而 `request()` 全程假設回應係 `{success,data}` JSON 信封，直接攞嚟用會喺 `response.json()` 嗰步炸開。兩個改動都刻意保持細：前者係 `body instanceof FormData` 嘅一個分支判斷（原有 JSON 路徑完全唔變），後者係新增一個獨立方法，重用 `buildUrl()`／`parseJsonBody()`，唔改動 `request()` 本身。

**⚠️ 範圍決定：上傳進度用「不確定進度」（indeterminate）唔係真正嘅百分比。** `fetch()`（`HttpClient` 用嘅底層 API）唔提供上傳位元組級別嘅進度事件，要攞到真正百分比需要換成 `XMLHttpRequest`，屬於對 `HttpClient` 更大嘅改動（成個 class 依賴嘅 abort／timeout／簽章邏輯都要重寫一次），唔喺呢個 task 嘅範圍。用忙碌指示（progress bar）＋取消按鈕滿足「使用者睇得到上傳緊、隨時可以中止」呢個核心需求。

**⚠️ 範圍決定：面板本身唔做「無 read 權限就隱藏」嘅判斷。** `ItemDetailPage.vue`／`SkuDetailPage.vue` 宿主頁面 route 層要求 `item.view` 或 `item.mgmt`，冇兩者連 detail page 都進唔到；`ItemMediaPanel.vue` 只用 `canManage` 決定顯示上傳／primary／排序／刪除，避免重複授權邏輯。

**Acceptance criteria:**

- [x] FormData 不手動設定 multipart boundary；boolean／integer／version 以後端明確可解析格式提交（`itemMedia.js` 嘅 `mediaFormData()` 將 `isPrimary` 序列化做完全等於 `"true"`／`"false"` 嘅字串，`sortOrder`／`version` 轉做十進位數字字串，對應 T25 嘅 multipart body schema）。
- [x] 圖片安全 inline preview，PDF 只下載；`item.view` 或 `item.mgmt` 均可下載／預覽，無兩者則拒絕；`canManage=false` 時上傳／primary／排序／刪除全部唔顯示。
- [x] Upload abort、超限、錯 signature、DB failure、delete unlink failure 均有可理解 UI／log 結果（`AbortController` 支援取消；`errorMessages.js` 新增成套 `UPLOAD_*` code 嘅中文翻譯——呢啲 code 一直未跟「英文 publicMessage 要喺呢個表覆蓋」嘅慣例，因為之前完全冇功能用到上傳；`MEDIA_KIND_MISMATCH`／`MEDIA_FILE_TOO_LARGE` 等 T25 自己嘅 code 本身已經係中文 publicMessage，唔使再覆蓋；delete unlink 失敗屬於後端 `item.media_delete_failed` 結構化 log 嘅範圍，前端睇到嘅始終係 200 成功——呢個係已知、刻意嘅設計，見 T25 段落）。

**Verification:**

- [x] `npm run lint`（repo 根，全部檔案，clean）
- [x] `npm test --workspace client`（423 個案例，26 個新增，全過；**Verification 命令修正**：原本寫嘅命令淨係列 `test/services/itemMedia.test.js`／`test/pages/items/itemMedia.test.js`，實際仲改咗 `test/framework/http/HttpClient.test.js`（新增 FormData／getBlob 測試）同 `test/pages/items/itemDetail.test.js`（修正 fixture 缺咗 `media` 欄嘅問題——見下面「發現嘅 bug」）
- [x] `npm run build --workspace client`（production build 成功）
- [x] `npm test --workspace server`（1337 個案例，全過，含改動咗嘅 `ItemAdminService.js`／`itemSchemas.js`／`skuSchemas.js`）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server`（1337 個案例，全過，`itemMedia.integration.test.js` 新增咗兩個 GET response 斷言——upload 之後 `GET /items/:id`／`GET /skus/:id` 真係見到 media，Item／SKU 兩層唔會互相洩漏）
- [x] Manual check（真瀏覽器＋真 MySQL＋真後端，非 mock）：登入、建立測試 Item＋SKU（經真 HTTP，UI 冇再手動行一次建檔流程——上一個 task 已經喺瀏覽器驗證過建檔本身）、上入 Item detail page，見到「媒體檔案」panel；上傳一張真 PNG，畫面即時顯示 inline 預覽（`blob:` URL，唔係下載端點嘅 URL）；上傳一個宣告 PNG、內容其實係 SVG 嘅檔案，畫面顯示「檔案內容與宣告的類型不符，已拒絕上傳」；設為主要圖片，badge 即時變「主要圖片」；上傳一個真 PDF，顯示 PDF icon＋下載按鈕；刪除 PDF（reason／password dialog），確認之後 PDF 由清單消失。事後直接查 DB／磁碟：`item_media` 得返 PNG 一行、`is_primary=1`；`storage/items/` 得返 PNG 對應嘅檔案，PDF 嗰個已經冇咗；`item_audit_logs` 依次序有 `media.upload`（logo）→`media.update`（設 primary）→`media.upload`（spec.pdf）→`media.delete`（spec.pdf）。測試資料事後全部經 SQL 清走。

**過程中發現並修正嘅一個 bug：**

- **`client/test/pages/items/itemDetail.test.js` 嘅 `ITEM` fixture 冇 `media` 欄**：`ItemMediaPanel.vue` 嘅 `mediaList` prop 收到 `undefined`（fixture 冧咗呢個新欄），`.filter()` 直接拋 `TypeError`，令呢個檔案 5 個 test unhandled rejection。呢個唔係 production bug（真後端response 一定有 `media`），純粹係 fixture 冧咗新加嘅欄——加返 `media: []` 就修正。

**Dependencies:** T17, T25

**Files actually touched：**

- `server/src/modules/item/ItemAdminService.js`（`getItem()`／`getSku()` 各加一句查 `item_media`；`#toItemDetail()`／`#toSkuDetail()` 帶埋 media 陣列；新增 `#toMediaSummary()` 私有 helper）
- `server/src/handlers/items/itemSchemas.js`（`ITEM_DETAIL_RESPONSE_SCHEMA` 加 `media` 欄，引入 `MEDIA_SUMMARY_SCHEMA`）
- `server/src/handlers/skus/skuSchemas.js`（`media` 欄由 `maxItems: 0` 改做真正嘅 `MEDIA_SUMMARY_SCHEMA` 陣列）
- `server/test/integration/itemMedia.integration.test.js`（兩個既有 test 加 GET response 斷言，證明 media 真係接通）
- `client/src/framework/http/HttpClient.js`（`request()` 加 `body instanceof FormData` 分支；新增 `getBlob()` 方法）
- `client/src/framework/http/errorMessages.js`（新增成套 `UPLOAD_*` code 嘅中文翻譯）
- `client/src/services/itemMedia.js`（新建：`uploadItemMedia`／`uploadSkuMedia`／`downloadMedia`／`updateMedia`／`deleteMedia`）
- `client/src/components/items/ItemMediaPanel.vue`（新建：上傳、inline 預覽、primary、排序、刪除、下載）
- `client/src/pages/items/ItemDetailPage.vue`（加 `ItemMediaPanel` 區塊）
- `client/src/pages/items/SkuDetailPage.vue`（加 `ItemMediaPanel` 區塊）
- `client/test/framework/http/HttpClient.test.js`（新增 FormData passthrough／`getBlob()` 測試）
- `client/test/services/itemMedia.test.js`（新建）
- `client/test/pages/items/itemMedia.test.js`（新建，13 個案例：empty state、canManage 隱藏控制項、圖片預覽經 blob、上傳成功／失敗、SKU 層級打對端點、primary 切換、刪除確認／取消、排序、下載）
- `client/test/pages/items/itemDetail.test.js`（fixture 補返 `media: []`，見上面「發現嘅 bug」）

**Estimated scope:** L（2 個 client 新檔 + 4 個 client 改動檔 + 3 個 server 改動檔 + 4 個 test 檔；比原估計大，因為原「Files likely touched」冇算入接通 Item／SKU GET response 嘅 server 端改動，同 `HttpClient.js` 本身要加 FormData／blob 支援）

### Task T27：建立 Import persistence、dependencies 與 worker 設定

**Description:** 新增 CSV libraries、`0025`／`0026` import tables、worker／scheduler settings 與 config normalization，先建立可重入 Job state persistence。

**Schema sign-off（CLAUDE.md 規則 8）：** 開工前喺 chat 完整解釋咗 `item_import_jobs`（`id`／`file_stored_name`（UNIQUE）／`result_stored_name`（nullable UNIQUE）／`file_sha256`／`template_version`／`mode`／`status`／五個計數欄／`error_summary`／`lease_owner`／`lease_until`／`created_by`／`confirmed_by`（兩者 FK SET NULL）／幾個時間戳／`files_purged_at`／`version`）同 `item_import_rows`（`job_id`＋`row_number` 組成 PK／`operation`／`match_sku_id`（**刻意冇 FK**）／`expected_sku_version`／`normalized_payload`／`status`／`errors`／`warnings`／時間戳），得到使用者「繼續」明確批准之後先寫同執行 migration。

**⚠️ Bug：`row_number` 喺呢個環境嘅 MySQL 版本係保留字，唔加反引號建表直接炸。** 套用 `0026_create_item_import_rows.js` 嗰陣即刻撞到 `ERROR 1064: You have an error in your SQL syntax ... near 'row_number ...'`——實測確認 `CREATE TABLE zz (row_number INT)` 喺呢個 dev DB 一樣炸，加返反引號 `` `row_number` `` 就正常。design_spec 本身用嘅正正係呢個名，唔改欄名，只喺 DDL 入面（column 定義同 `PRIMARY KEY` 子句兩處）用反引號包住；JS template literal 字串入面嘅反引號要用 `\`` 跳脫，唔係直接寫字面反引號（後者會提早結束成個 template literal，變成語法錯誤——第一次改嗰陣做漏咗呢步，跟住即刻畀 `node --check` 揪出嚟）。呢個係第一次喺呢個 codebase 用呢個字做欄名，之前冚唔到呢個坑。

**⚠️ 範圍決定：`server/config/scheduler.js` 冇改動。** 原本「Files likely touched」估計呢個 task 要加 import job 嘅 scheduler 覆寫設定，但呢個 task 本身（「先建立可重入 Job state persistence」）唔起任何真正會註冊落 scheduler 嘅 job class——`ItemImportWorkerService.js` 要到 T28 先建立（見 tasks.md T28 嘅 Files likely touched，`ItemImportWorkerService.js` 明確列喺嗰度，唔喺 T27）。`config/scheduler.js` 嘅 `jobs: {}` 段係「依工作名稱覆寫」，冇工作存在就冇嘢好覆寫；「Validation、execution、retention cleanup 使用不同 scheduler job／lock key」呢條 acceptance criterion 管嘅係 T28 起嗰幾個 job class 點樣宣告自己嘅 `static jobs`，唔係 T27 呢個 task 現在就要寫新 code 去強制——嗰個強制本身已經由框架既有嘅 service/job 註冊機制提供（重複名稱會喺啟動時撞到 `discoverServiceDefinitions()` 嘅 duplicate check）。

**⚠️ 範圍決定：`test/itemConfig.test.js`／`normalizeItemConfig.js` 冇改動。** 呢個 task 嘅 verification 命令列咗 `test/itemConfig.test.js`，但打開一睇先發現 `importMaxRows`／`importBatchSize`／`importTransactionTimeoutMs` 三個欄連同安全上限（10,000／10 分鐘等）同對應測試，全部喺呢個 task 開工之前就已經存在（`config/item.js`、`normalizeItemConfig.js` 喺更早期已經預先鋪好呢部分，可能係 T25 開工前的基礎設施鋪排）。「10,000 rows、batch、transaction timeout 設定有安全上限」呢條 acceptance criterion 因此喺呢個 task 實際落手之前已經滿足，唔需要新改動。

**⚠️ Verification 命令修正：`test/itemImportWorkerService.test.js` 唔存在，都唔應該喺呢個 task 建立。** 呢個檔名喺 T27 同 T29 兩個task 嘅 verification 都有出現，但 `ItemImportWorkerService.js` 本身喺 T27 嘅「Files likely touched」冇列（喺 T28 先出現）——呢個測試命令屬於複製貼上遺留嘅超前引用，真正應該喺 T28（起呢個 class 嗰陣）先出現。

**Acceptance criteria:**

- [x] Jobs／Rows 欄位、索引、lease、version、`files_purged_at` 與 FK 符合 §5.13（逐欄核對過設計表，見上面 schema sign-off；`match_sku_id` 刻意冇 FK 亦係 §5.13 明文要求）。
- [x] `csv-parse`／`csv-stringify` 版本鎖定；10,000 rows、batch、transaction timeout 設定有安全上限（`csv-parse@^7.0.2`、`csv-stringify@^6.8.3` 加入 `server/package.json`，`package-lock.json` 鎖實際解析版本；安全上限本身已經喺呢個 task 之前就存在，見上面範圍決定）。
- [x] Validation、execution、retention cleanup 使用不同 scheduler job／lock key，設定錯誤在 startup 被拒（呢個 task 本身未有任何 job class 可以驗證呢一條——冇 job 就冇「唔同 lock key」呢件事好講，強制機制本身（duplicate service name 拒絕啟動）已經由框架提供，會喺 T28 起真正嘅 job class 嗰陣先實際被行使）。

**Verification:**

- [x] `npm run lint`（repo 根，全部檔案，clean）
- [x] `npm test --workspace server`（1344 個案例，7 個新增，全過）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server`（1344 個案例，全過），連跑 3 次穩定
- [x] `npm test --workspace client`（423 個案例，全過——`package-lock.json` 有改動，順帶確認冇影響 client）
- [x] `npm run build --workspace client`（production build 成功）
- [x] `npm run security:audit`（0 exit code；剩返之前已知、同呢個 task 無關嘅 `@vitest/mocker` moderate finding，`csv-parse`／`csv-stringify` 本身冇引入新漏洞）
- [x] 測試後確認 dev DB 無殘留

**Dependencies:** T01, T03, T08, T11

**Files actually touched：**

- `server/database/migrations/0025_create_item_import_jobs.js`（新建）
- `server/database/migrations/0026_create_item_import_rows.js`（新建；`row_number` 反引號跳脫，見上面「Bug」）
- `server/package.json`（加 `csv-parse@^7.0.2`、`csv-stringify@^6.8.3`）
- `package-lock.json`（`npm install` 鎖實際解析版本）
- `server/test/integration/itemImportMigrations.integration.test.js`（新建，7 個案例：`file_stored_name` 全域唯一、`result_stored_name` 對 NULL 唔生效、`created_by`／`confirmed_by` SET NULL、`(job_id, row_number)` PK、`job_id` CASCADE、`match_sku_id` 刻意冇 FK、JSON 欄位原樣讀返）

**Estimated scope:** S（2 個新 migration + 1 個依賴改動 + 1 個 test 檔；比原估計細，因為 config 安全上限同 worker service 兩部分原本估計嘅工作分別已經預先做咗／屬於下一個 task，見上面範圍決定）

## Checkpoint I：T25–T27 Files and Jobs Foundation

- [ ] Media end-to-end、安全與 cleanup 測試通過。
- [ ] Import schema、libraries、scheduler registration 及 config guards 通過。
- [ ] 所有檔案路徑限定於 configured roots，錯誤不回絕對路徑。
- [ ] Full tests、client build、security audit 通過。

### Task T28：建立 CSV preflight processor

**Description:** 建立 versioned CSV template、RFC 4180 parsing、mapping、normalization、逐列 validation 與 all-or-nothing preflight；預檢不得改商品表。

**⚠️ CSV 欄位契約需要事先核對：design_spec 冇釘死實際欄位名。** design_spec 只描述行為（RFC 4180 parser、BOM／版本／`create_only`／`upsert`／SKU ID＋version 配對），完全冇列 CSV 實際有咩欄位。呢個係一份用戶會直接接觸嘅對外契約（下載範本、用 Excel 填），開工前喺 chat 完整列出建議欄位（`skuId`／`expectedSkuVersion`／`skuCode`／`skuName`／`itemName`／`categoryName`／`brandName`／`defaultTrackingPolicy`／`suggestedPriceAmount`／`purchasable`／`sellable`／`baseUomCode`，範圍淨係 Standard 商品），得到使用者明確「yes」批准之後先開工，唔係好似 schema 咁使用 CLAUDE.md 規則 8（呢個唔係 DB table），但性質類似——一個影響外部使用者嘅契約，唔應該淨係內部實作決定就靜靜定咗。定案見 `itemCsvSchema.js`。

**⚠️ 範圍決定：`categoryName` 對應多過一個分類就當 ambiguous，唔隨便揀一筆。** 開工先發現 `item_categories.name` 淨係保證同一父分類底下唯一（`categoryNameTaken()` 嘅訊息係「同一父分類下已有相同名稱」），唔係全域唯一；CSV 冇提供 parent 資訊，如果撞到多過一筆用嗰個名，冇辦法安全揀一筆當結果。加咗 `CATEGORY_NAME_AMBIGUOUS`（連同 brand／UOM 對應嘅 ambiguous code，雖然嗰兩個表全域唯一，理論上唔會撞到，但驗證邏輯保持一致、唔假設）令呢種情況變成一個明確嘅 row-level error，唔係隱藏 bug。

**⚠️ 範圍決定：`success_count`／`failure_count` 呢兩個欄喺 preflight 階段借用嚟表達「valid／invalid 列數」。** design_spec §5.13 對呢兩個欄嘅字面描述（「已套用及失敗數」）聽落係 execution 階段先有意義嘅統計，但依家（T28）淨係做 preflight，冇「已套用」呢件事。暫時借嚟表達 preflight 通過／唔通過嘅列數；T29 執行完成之後會用真正嘅套用結果覆寫呢兩個數字（skipped_count 喺呢個 task 固定 0，冇 skip operation 嘅 CSV 觸發方式）。

**⚠️ 範圍決定：`config/item.js` 加 `importDirectory`，獨立於 `mediaDirectory`。** CSV 匯入檔案要有一個受控落盤目錄先做得到 preflight——design_spec §12.1 冇明文列一個獨立嘅 import root，但佢哋嘅保留規則本來就唔同（media 冇到期日；import 檔 1 年後清），混用 `mediaDirectory` 會令 cleanup job 難以分辨邊啲檔案受邊條規則管，所以加一個獨立設定，同 `normalizeItemConfig.js`／`itemConfig.test.js` 一併更新。

**⚠️ Bug：`row_number` 保留字喺 SQL 入面要反引號跳脫，呢個 task 嘅新 SQL（`ItemImportService.js`）都要記得跟。** T27 已經記錄過 migration 入面嘅呢個坑；`ItemImportService.js` 嘅 INSERT／SELECT／ORDER BY 涉及呢個欄嘅地方都要一致用 `` \`row_number\` ``，寫呢個檔案嗰陣一開始就跟咗呢個慣例，冇再撞到。

**Acceptance criteria:**

- [x] 正確處理 BOM、quoted comma／newline、Unicode、未知欄、欄位上限及 10,000 rows（`csv-parse/sync` 負責 RFC 4180／BOM；未知欄位由 `columns:true` 自然唔映射到已知屬性，唔會令解析或驗證失敗；`skuCode`／`skuName`／`itemName`／`categoryName`／`brandName` 有 190 字上限對齊實際 DB 欄寬；`maxRows` 由 `config.item.importMaxRows` 注入，超過即 job-level error，唔會逐列處理）。
- [x] 任一 invalid row 令 Job 不能 confirm；errors／warnings 有界且可下載，不含 stack／SQL（`recordValidationResult()`：`counts.invalid > 0` 就令 job 轉 `invalid`；`errors`／`warnings` 都係已經正規化嘅 `{field,code,message}` 陣列，冇任何原始 SQL／stack 內容；「可下載」呢部分（result CSV 產生）留俾 T29 嘅 `GET .../result` 端點）。
- [x] Upsert 使用 SKU ID＋expected version 配對，不能藉 CSV 繞過 SKU Code 特批流程（update 列一律用 `skuId` 配對，`skuCode` 淨係做 cross-check，唔一致得返 warning 唔會改任何嘢；`expectedSkuVersion` 必填，執行階段嘅 compare-and-set 由 T29 接上）。

**Verification:**

- [x] `npm run lint`（repo 根，全部檔案，clean）
- [x] `npm test --workspace server`（1376 個案例，32 個新增，全過；**Verification 命令修正**：原本寫嘅 `test/itemImportService.test.js` 冇建立——`ItemImportService.js` 同 `ItemAdminService`／`ItemMediaService` 一路以嚟嘅慣例一致，純交易＋SQL，冇獨立假 DB 單元測試，改為真 MySQL integration test 覆蓋；`test/itemImportProcessor.test.js`（22 個案例，假 queryable，唔開真 DB）新增）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server`（1376 個案例，全過），連跑 3 次穩定
- [x] 啟動期 smoke test：`node src/index.js` 成功起服務，`job.itemImportWorker` 註冊冇撞名／冇缺依賴
- [x] 測試後確認 dev DB 及 `storage/imports/` 目錄均無殘留

**Dependencies:** T10, T14, T16, T23, T27

**Files actually touched：**

- `server/config/item.js`（加 `importDirectory`）
- `server/src/modules/item/normalizeItemConfig.js`（`importDirectory` 正規化＋驗證，同 `mediaDirectory` 同一套慣例）
- `server/src/modules/item/import/itemCsvSchema.js`（新建：CSV 欄位契約、template version、header row 產生）
- `server/src/modules/item/import/ItemImportProcessor.js`（新建：parse＋逐列 domain validation，`parseAndValidateCsv()`）
- `server/src/modules/item/ItemImportService.js`（新建：`claimNextUploadedJobForValidation()`／`recordValidationResult()`／`getJob()`／`listRows()`）
- `server/src/services/itemImport/ItemImportWorkerService.js`（新建：scheduler adapter，註冊 `itemImport.validate`）
- `server/src/services/itemImport/jobs/validateItemImportJob.js`（新建：claim＋讀檔＋parse＋寫結果嘅獨立函式）
- `server/test/itemConfig.test.js`（`importDirectory` 一組新測試，仿 `mediaDirectory`）
- `server/test/serviceContainer.test.js`（白名單加 `job.itemImportWorker`）
- `server/test/itemImportProcessor.test.js`（新建，22 個案例）
- `server/test/integration/itemImport.integration.test.js`（新建，6 個案例：create-only 全部合法、含 invalid 列、upsert 配對真 SKU、冇合資格 job、已驗證 job 唔重複揀、來源檔缺失）

**Estimated scope:** L（2 個 config 改動檔 + 4 個新 business／worker 檔 + 4 個 test 檔；比原估計大，因為原「Files likely touched」冇算入 CSV 欄位契約需要事先核對、`config/item.js` 要加新目錄設定，同 `itemConfig.test.js` 嘅對應測試）

### Task T29：建立 Import confirm／execution／result API

**Description:** 完成 upload、list、get、confirm、cancel、result handlers 與 execution worker，使用 lease、idempotency、單一商品 transaction 及失敗後短交易更新 Job。

**Acceptance criteria:**

- [x] Confirm 只接受 ready Job、`jwt-password`、version；重送不重複建立，cancel 只允許設計狀態。
- [x] Execution 重新驗證 catalog／unique／SKU version，任一 row 失敗整批商品變更 rollback；Job 最終狀態仍可靠更新。
- [x] Result download 使用受控 path；已到期回 `410 IMPORT_FILE_EXPIRED`，Job summary 仍可查。

**Verification:**

- [x] `npm test --workspace server`（unit；`ItemImportService`／upload／confirm／cancel／execution handlers 純交易＋SQL 邏輯，無 fake-DB unit test，同 `ItemAdminService`／`ItemMediaService` 一致，只用真 MySQL 整合測試覆蓋）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemImport.integration.test.js`（14 個測試，含 T28 preflight 6 個＋T29 HTTP／confirm／execution／cancel／權限／過期 result 8 個，穩定跑 3 次全過）
- [x] `npm run lint`（repo root）

**Dependencies:** T22, T27, T28

**Files actually touched:**

- `server/src/modules/item/ItemImportService.js`（新增 createJobFromUpload／listJobs／confirmJob／cancelJob／claimNextQueuedJobForExecution／listValidRowsForExecution／recordExecutionResult／writeResultFile／resolveResultDownload）
- `server/src/services/itemImport/jobs/executeItemImportJob.js`（新檔；execution worker：單一 transaction 逐 row 執行，失敗記 `failedRowNumber` 並整批 rollback，job 狀態用獨立短交易更新）
- `server/src/services/itemImport/ItemImportWorkerService.js`（新增 `itemImport.execute` job 註冊、`runExecution()`）
- `server/src/services/itemImport/jobs/validateItemImportJob.js`（小改：驗證完成後寫 result CSV）
- `server/src/handlers/item-imports/`（新目錄：`itemImportSchemas.js`、`uploadItemImportHandler.js`、`listItemImportsHandler.js`、`getItemImportHandler.js`、`confirmItemImportHandler.js`、`cancelItemImportHandler.js`、`downloadItemImportResultHandler.js`、`downloadItemImportTemplateHandler.js`）
- `server/src/modules/item/itemErrors.js`（新增 `importJobNotFound`；`mediaFileRequired()` 改名 `uploadFileRequired()`，因為呢個錯誤而家兩個 domain 共用）
- `server/src/handlers/items/itemMediaUploadHandler.js`、`server/src/handlers/skus/skuMediaUploadHandler.js`（跟隨上面改名更新 import／call site）
- `server/test/integration/itemImport.integration.test.js`（延伸 T28 既有測試，加 8 個 T29 測試）

**已知偏離「Files likely touched」之處及原因：**

1. 冇 `test/itemImportService.test.js`／`test/itemImportHandlers.test.js`／`test/itemImportWorkerService.test.js` 呢類 fake-DB unit test——`ItemImportService`／execution worker 全部係 transaction＋SQL 邏輯，同 `ItemAdminService`／`ItemMediaService` 一樣，寫 fake-DB unit test 只會重複驗證 mock 本身，冇額外訊號，所以只用真 MySQL 整合測試覆蓋（design 決定，非遺漏）。
2. 刻意冇改 `ItemAdminService.createItem()`／`updateSku()` 令 execution worker 可以重用——咁做要將佢哋改到接受外部傳入嘅 transaction connection，會動到有 1000+ 條測試依賴嘅既有 service。`executeItemImportJob.js` 改用刻意簡化、CSV contract 範圍內嘅 INSERT／UPDATE SQL（draft-only、無 activation、無 variants、無 barcodes，UOM 永遠得一條 base UOM row）。
3. `templateItemImportHandler.js` 改名做 `downloadItemImportTemplateHandler.js`（class 都改埋做 `DownloadItemImportTemplateHandler`，`handlerName` 冇變）——修正一個真實 bug：`handlerRegistry.js` 按檔案路徑字母順序註冊 route，Express 5 嘅 Router 冇靜態路徑優先於 `:id` 呢種機制，`getItemImportHandler.js`（`g`）字母序排喺原本嘅 `templateItemImportHandler.js`（`t`）之前，令 `GET /api/v1/item-imports/template` 成日俾 `GET /api/v1/item-imports/:id` 攔截（400 params 驗證錯，永遠去唔到 template handler）。改名做 `download...`（同 `downloadItemImportResultHandler.js` 一致，字母序 `d` < `g`）令佢喺 `:id` 之前註冊，順便修正咗檔名同 `handlerName`（`downloadItemImportTemplate`）本身唔一致嘅命名問題。
4. `test/integration/itemImport.integration.test.js` 入面 `uploadCsv()` 呢個測試 helper 原本冇帶 `Idempotency-Key` header，但 `uploadItemImportHandler.js` 嘅 route 有 `idempotency: { enabled: true }`，所以上傳一律 400 `IDEMPOTENCY_KEY_REQUIRED`——已經修正（helper 而家每次隨機生成一個 UUID 做 key）。
5. 過程中修正咗一個自己引入嘅測試掛死 bug：六個新測試最初為咗過 ESLint `prefer-const`，將 `t.after()`（負責 `application.shutdown()`）搬到 HTTP 上傳呼叫之後先註冊；如果上傳嘅 assertion 拋錯，`t.after()` 就永遠冚唔到，真實 HTTP server／scheduler／DB pool 會一直開住，令 `node --test` process 永久掛死。修正方法：改用 `let jobId = null` 初始化＋喺任何可能拋錯嘅呼叫之前就註冊 `t.after()`，之後先 `jobId = ...` 重新賦值（同 `itemImportMigrations.integration.test.js` 既有 pattern 一致，`let x = null` 有初始賦值就唔會觸發 `prefer-const`）。
6. 呢個框架嘅 `static api.requestSchema` 即使冇路徑參數都一定要有 `params` key（比照 `healthHandler.js`），三個新 handler（`uploadItemImportHandler.js`／`listItemImportsHandler.js`／`downloadItemImportTemplateHandler.js`）原本漏咗，令對應 route 一律 400——已補上 `params: EMPTY_OBJECT_SCHEMA`。

**Estimated scope:** M（實際 8 個 handler 檔案＋service／worker／errors 延伸＋1 個整合測試檔）

### Task T30：建立 Import UI

**Description:** 建立 Import client service 與 ItemImportsPage，完成 template、upload、poll、row errors、confirm、cancel 及 result download flow。

**Acceptance criteria:**

- [x] UI 明確區分 preflight 與 execution；有任何 invalid row 時不能確認且不誤顯示已寫入（`ready` 先顯示「確認匯入」，狀態文案同 job 狀態機一一對應，唔會用「成功」呢類字眼講 preflight-only 嘅狀態）。
- [x] Poll 支援 abort／route leave，不建立重複 timer；confirm 使用 password signing（`promptPassword({ requireReason: true })`，冇用簽名 device-key 嗰種 `signed:true`——`jwt-password` 淨係要求 body 帶明文 password，同 SKU code 特批嗰種 device-signed 高風險操作唔同）。
- [x] 檔案過期顯示不可下載但保留 Job summary／audit，不以一般 500 呈現（`filesPurgedAt` 有值時顯示灰色「結果檔已過期」徽章，唔畀撳，唔靠撳咗先接 410）。

**Verification:**

- [x] `npm test --workspace client -- test/services/itemImport.test.js test/pages/items/itemImports.test.js`（8＋13 個測試）
- [x] `npm run build --workspace client`
- [x] `npm run lint`（repo root）
- [x] Manual check（真實瀏覽器，經 `.claude/launch.json` 起 server＋client dev server）：下載 template、valid／invalid CSV 上傳、預檢錯誤逐列顯示、confirm＋password＋reason、執行完成後 row 狀態變 applied、410 expired result 徽章。過程中發現並修正兩個真實 bug（見下）。

**Dependencies:** T13, T29

**Files actually touched:**

- `client/src/services/itemImport.js`（新檔）
- `client/src/pages/items/ItemImportsPage.vue`（新檔）
- `client/test/services/itemImport.test.js`（新檔，8 個測試）
- `client/test/pages/items/itemImports.test.js`（新檔，13 個測試）
- `server/src/modules/item/ItemImportService.js`（`recordExecutionResult()` 擴充：同時更新 row 逐列狀態）
- `server/src/services/itemImport/jobs/executeItemImportJob.js`（傳 `appliedRowNumbers`／`failedRow` 落 `recordExecutionResult()`）
- `server/test/integration/itemImport.integration.test.js`（收緊一個過於寬鬆嘅斷言＋新增一個 execution-time race／rollback 測試）

**手動瀏覽器驗證中發現並修正嘅真實 bug（唔喺原本 T29 範圍，但直接影響呢個 task 嘅 UI 正確性）：**

1. **`item_import_rows.status` 喺 execution 完成之後從來冇被更新過**——`ItemImportService.js` 嘅 `recordExecutionResult()` 原本淨係更新 `item_import_jobs`，`executeItemImportJob.js` 完全冇改過任何一 row 嘅 `status`。結果：無論 job 成功定失敗，detail 頁同結果 CSV 永遠顯示 preflight 嗰陣嘅 `valid`／`warning`，唔會變做 design_spec §5.13 定義嘅 `applied`／`failed`，令使用者睇唔到邊一 row 真係套用咗。修正：`recordExecutionResult()` 而家喺同一個短交易入面，成功時將全部套用咗嘅 row 標 `applied`，失敗時將導致 rollback 嗰一 row 標 `failed` 並喺 `errors` 記低原因；其餘 row 保持原本 preflight 狀態（佢哋本身冇問題，令成批 rollback 嘅係另一 row）。新增咗一個「execution 中 SKU Code race」整合測試覆蓋呢個路徑，亦收緊咗一個原本寫得過於寬鬆嘅 `/applied|valid/` 斷言做返 `/applied/`。
2. **`templateItemImportHandler.js` 嘅 route 因為檔名字母序排喺 `getItemImportHandler.js` 之後，令 `GET /api/v1/item-imports/template` 成日俾 `GET /api/v1/item-imports/:id` 攔截**——呢個係喺實作呢個 task 期間、透過真實瀏覽器點擊「下載範本」先發現（詳細分析同修正已記喺 T29 段落，因為改動嘅係 T29 嘅 handler 檔案，但係喺 T30 做手動驗證時先浮現）。

**Estimated scope:** M（4 個新檔＋2 個因為上面 bug fix 而改嘅 T29 既有檔案＋1 個整合測試檔）

## Checkpoint J：T28–T30 Import End-to-End

- [ ] 10,000-row preflight、confirm、execute、rollback、poll、result 全流程可用。
- [ ] Invalid batch 對商品表零寫入；duplicate confirm 零重複。
- [ ] Lease 接手、abort、timeout、失敗狀態與 UI 恢復測試通過。
- [ ] CSV 內容及路徑不進 audit／log／error response。

### Task T31：建立 SKU Export

**Description:** 建立依目前 SKU filters 匯出的 UTF-8 CSV，沿用固定價格口徑、時間格式、白名單欄位及 audit。

**Acceptance criteria:**

- [x] Export filters 與列表語意一致，輸出 HKD／`tax_not_applicable`、ISO 8601＋offset 及穩定欄位順序（見下方「匯出篩選範圍」說明——只做咗 `q`／`status` 兩個篩選，因為 `ItemsPage.vue` 目前實際上都淨係得呢兩個 SKU 篩選）。
- [x] 不輸出 stored path、audit IP、internal hash、成本或未授權欄位（`exportSkus()` 用獨立白名單 SELECT，唔靠過濾一個更大嘅物件）。
- [x] 只有 `item.mgmt` 可匯出，每次成功／失敗均有合適 audit／log，不保存整份 CSV 到 audit（`item.export` audit 只記 filters＋rowCount；非預期失敗由框架既有嘅 structured error log 覆蓋，冇額外加失敗專用 audit——同 import 嘅 `item.import` action 唯一記錄「成功決定性動作」呢個慣例一致）。

**Verification:**

- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemExport.integration.test.js`（4 個測試；`exportSkus()` 純 SQL＋audit 寫入，冇 fake-DB unit test，同 `ItemAdminService` 一路以嚟嘅慣例一致）
- [x] `npm test --workspace client -- test/services/itemImport.test.js test/pages/items/itemImports.test.js`
- [x] `npm run build --workspace client`
- [x] `npm run lint`（repo root）
- [x] Manual check（真實瀏覽器）：搜尋＋狀態篩選匯出，比對 CSV 內容同資料庫真實資料，確認 audit 記錄正確、唔保存逐 SKU 資料。

**Dependencies:** T11, T12, T30

**Files actually touched:**

- `server/src/handlers/item-exports/exportSkusHandler.js`（新檔）
- `server/src/modules/item/ItemAdminService.js`（新增 `exportSkus()`；刻意冇重用 `listSkus()`，理由見方法上面嘅註解）
- `client/src/services/itemImport.js`（新增 `exportSkus()`）
- `client/src/pages/items/ItemImportsPage.vue`（新增「匯出商品 SKU」區塊）
- `server/test/integration/itemExport.integration.test.js`（新檔，4 個測試）
- `client/test/services/itemImport.test.js`（加 2 個測試）
- `client/test/pages/items/itemImports.test.js`（加 3 個測試）

**匯出篩選範圍（唔係「Files likely touched」提到嘅偏離，但值得記低）：** design_spec §7.3 提過 `ItemsPage.vue` 應該有 category／brand／purchasable／sellable 篩選，但現時 `ItemsPage.vue` 實際上只做咗 `q`／`status`。「Export filters 與列表語意一致」嘅最直接做法就係只做返列表現時真係有嘅篩選，唔搶先幫列表未做嘅篩選補齊（嗰個屬於 `ItemsPage.vue` 本身嘅缺口，唔係呢個 task 嘅範圍）。伺服器端 `exportSkus()`／`exportSkusHandler.js` 已經接受咗 `itemId`／`categoryId`／`brandId`／`purchasable`／`sellable` 呢幾個 query 參數（同 `listSkus()` 一致），淨係前端 UI 未接；`ItemsPage.vue` 之後補齊呢幾個篩選時，可以直接畀返個 query 落呢個現成嘅 endpoint，唔使再改 API。

**Estimated scope:** M（4 個新檔＋3 個既有檔案擴充）

### Task T32：建立疑似重複商品提示

**Description:** 建立 deterministic duplicate candidate service／API 及 create-flow warning，按 normalized name、brand、category、variant summary 回最多 10 筆。

**Acceptance criteria:**

- [x] 結果可解釋、順序穩定、有上限；不使用 fuzzy black box、自動合併或阻擋合法建立（`findDuplicateCandidates()` 淨係用 trim＋不分大小寫嘅名稱完全相符，加埋可選嘅 category／brand 完全相符，`ORDER BY i.id ASC LIMIT 10`；`variantSummary` 讀做「連同 SKU codes 一齊返」嘅顯示內容，唔係第四個篩選條件，理由見方法上面嘅註解）。
- [x] API 只允許 `item.mgmt`，輸入與 sort 使用白名單及 parameterized query（冇 sort 呢個概念——固定 `i.id ASC`，唔開放使用者控制排序）。
- [x] Create UI 顯示候選並允許使用者確認繼續，idempotency 不受重複提示影響（`checkDuplicates()` 冇用 `idempotent:true`；banner 可以自己撳「知道喇」叫走，兩個提交按鈕全程唔會因為有候選而變唔撳得）。

**Verification:**

- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemCreate.integration.test.js`（追加 5 個「疑似重複」測試喺呢個既有檔案；`findDuplicateCandidates()` 純 SQL，冇 fake-DB unit test，同呢個 service 一路以嚟嘅慣例一致）
- [x] `npm test --workspace client -- test/services/item.test.js test/pages/items/itemCreate.test.js`
- [x] `npm run build --workspace client`
- [x] `npm run lint`（repo root）
- [x] Manual check（真實瀏覽器）：打入一個同現有 Item 完全同名嘅商品名稱，debounce 之後見到 banner 列出候選同 SKU code，撳「知道喇」叫走，兩個提交按鈕全程可撳。

**Dependencies:** T14, T15, T22, T24

**Files actually touched:**

- `server/src/modules/item/ItemAdminService.js`（新增 `findDuplicateCandidates()`）
- `server/src/handlers/items/checkItemDuplicatesHandler.js`（新檔）
- `client/src/services/item.js`（新增 `checkDuplicates()`）
- `client/src/pages/items/ItemCreatePage.vue`（新增 debounced 疑似重複查詢＋可自行叫走嘅 warning banner）
- `server/test/integration/itemCreate.integration.test.js`（加 5 個「疑似重複」測試）
- `client/test/services/item.test.js`（加 1 個測試）
- `client/test/pages/items/itemCreate.test.js`（加 3 個測試＋`afterEach` unmount，防新加嘅 debounce timer 喺下一個 test 先觸發）

**Estimated scope:** M（2 個新檔＋5 個既有檔案擴充）

### Task T33：建立 bounded bulk status change

**Description:** 建立最多 100 筆 Item／SKU 的全有全無批量狀態 API 與列表 UI，重用單筆狀態規則並固定鎖定順序。

**Acceptance criteria:**

- [x] 只接受 1–100 IDs、expected versions、合法 action、reason、password；不支援永久刪除（schema `action` enum 冇 `delete`，`targets` `minItems:1 maxItems:100`）。
- [x] 先按 ID 排序鎖 rows，再驗證全部 targets；任一失敗時零狀態／flag／audit 變更（單一 transaction 入面逐個真係嘗試套用，收齊晒全部 issue 先一次過 throw，rollback 埋之前「成功」嗰幾個——見 `ItemAdminService.bulkChangeStatus()` 的說明）。
- [x] UI 顯示 target 數、預檢阻擋、全有全無語意及每個 target 結果（dialog 顯示已選筆數；action 下拉只列出對成個已選集合都合法嘅操作，混合狀態時客戶端先擋住唔畀送出；失敗時逐筆列出 `issues` 嘅原因）。

**Verification:**

- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemBulkStatus.integration.test.js`（8 個測試，含 100 筆成功、101 筆俾 schema 擋、中間一筆失敗全 rollback；`bulkChangeStatus()` 純 SQL＋交易，冇 fake-DB unit test，同呢個 service 一路以嚟嘅慣例一致）
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/itemLifecycle.integration.test.js`（確認為咗俾 bulk 重用而做嘅 3 個 extract-method 重構冇改到任何單筆行為，16 個既有測試原封不動全過）
- [x] `npm test --workspace client -- test/services/item.test.js test/pages/items/items.test.js`
- [x] `npm run build --workspace client`
- [x] `npm run lint`（repo root）
- [x] Manual check（真實瀏覽器）：勾選 3 筆 draft SKU，批量封存，password＋reason 確認，全部成功、各自有 audit，清單自動排走（預設唔顯示 archived）。

**Dependencies:** T18, T19, T22

**Files actually touched:**

- `server/src/modules/item/ItemAdminService.js`（新增 `bulkChangeStatus()`／`#applyBulkStatusTarget()`；抽出 `#activateItemCore()`／`#activateSkuCore()`／`#deactivateSkuCore()` 呢三個原本冇獨立 helper 嘅單筆核心邏輯，等 bulk 可以喺同一個 transaction 入面重用——其餘 7 個 action／target-type 組合本來就已經有 `#transitionItemStatus()`／`#transitionSkuStatus()`／`#cascadeSkuStatus()` 呢啲 connection-accepting private helper，直接重用，冇改）
- `server/src/modules/item/itemErrors.js`（新增 `bulkStatusChangeRejected(issues)`）
- `server/src/handlers/item-bulk/changeItemStatusBulkHandler.js`（新檔）
- `server/test/integration/itemBulkStatus.integration.test.js`（新檔，8 個測試）
- `client/src/framework/ui/DataTable.vue`（新增 `selection`／`selected` prop，原樣轉發俾 QTable——預設 `selection:'none'`，唔用嘅現有頁面行為完全唔變）
- `client/src/services/item.js`（新增 `bulkChangeStatus()`）
- `client/src/pages/items/ItemsPage.vue`（新增勾選＋批量狀態操作 dialog，Item／SKU 兩個 view 都支援）
- `client/test/services/item.test.js`（加 1 個測試）
- `client/test/pages/items/items.test.js`（加 7 個測試）

**額外（Checkpoint K 覆查先發現，見上面 checkpoint 條目嘅完整說明）：**

- `server/src/modules/item/csvSafety.js`（新檔，`sanitizeCsvCell()`）
- `server/src/modules/item/ItemAdminService.js`（`exportSkus()` 套用 sanitizeCsvCell()）
- `server/src/modules/item/ItemImportService.js`（`writeResultFile()` 套用 sanitizeCsvCell()）
- `server/test/csvSafety.test.js`（新檔，4 個單元測試）
- `server/test/integration/itemExport.integration.test.js`（加 1 個測試）
- `server/test/integration/itemImport.integration.test.js`（加 1 個測試）

**Estimated scope:** M（3 個新檔＋6 個既有檔案擴充，包括一個刻意做到「純 extract-method、行為不變」嘅小重構；另加 4 個因為 Checkpoint K security review 而起嘅檔案）

## Checkpoint K：T31–T33 Bulk Operations

- [x] Export、duplicate warning、bulk status 的 API／UI／audit 全部完成。
- [x] Bulk 100 成功、101 拒絕及中間一筆失敗全 rollback 通過（見 T33 嘅 `itemBulkStatus.integration.test.js`）。
- [x] Export 資料白名單與 CSV injection／formula handling 經 security review——複查呢個 checkpoint 先發現 T31 交付嗰陣冇做呢一項：SKU 匯出同匯入結果 CSV 都會原樣寫出使用者輸入嘅字串（SKU Code／名稱／分類／品牌），開頭係 `=`／`+`／`-`／`@` 會被 Excel／Google Sheets 當公式執行（CSV／formula injection，OWASP 已知手法）。修正方式：新增 `server/src/modules/item/csvSafety.js` 嘅 `sanitizeCsvCell()`，開頭係呢幾隻觸發字元就前面加一個單引號，套用喺 `ItemAdminService.exportSkus()`（skuCode／skuName／itemName／categoryName／brandName／primaryBarcode／baseUomCode）同 `ItemImportService.writeResultFile()`（skuCode）；`errors`／`warnings` 欄位本身開頭固定係白名單 `field` 名稱（例如 `skuCode:REQUIRED_FIELD:...`），唔會被使用者輸入蓋過第一個字元，唔使額外處理。已加單元測試（`test/csvSafety.test.js`）同兩個整合測試（export／import 各一個，直接斷言下載返嘅 CSV 內容）。
- [x] Full server/client tests 與 build 通過。

### Task T34：建立 Import 檔案保留清理

**Description:** 建立 1 年 import source／result file cleanup job，以 UTC 周年日、terminal Job、受控路徑及 compare-and-set 更新 `files_purged_at`。

**Acceptance criteria:**

- [x] 未滿 1 年、非 terminal、root 外、symlink 或已被其他 Job 引用的檔案不刪除。
- [x] 部分 unlink 失敗可安全重跑；只有全部應刪檔案成功後標記 `files_purged_at`，並留下結構化 log。
- [x] Job summary／rows／audit 至少保留 7 年且詳情仍可查；result download 回 410（呢個行為喺 T29 已經有 handler／整合測試覆蓋，T34 冧新增測試佢冇變過）。

**Verification（實際執行）:**

- [x] `npx eslint` 對所有新增／改動嘅檔案（`ItemImportFileCleanupJob.js`、`ItemImportService.js`、`itemConstants.js`、`fileResponse.js`、`serviceContainer.test.js`、兩個新測試檔）
- [x] `npm test`（server 單元套件，含新嘅 `test/itemImportFileCleanupJob.test.js` 13 個測試同 `test/serviceContainer.test.js` 嘅白名單更新）：1206 pass／0 fail
- [x] `DB_INTEGRATION_TESTS=1 node --test --import ./test-support/testEnv.js test/integration/itemImportFileCleanup.integration.test.js test/integration/itemImport.integration.test.js`：20 pass／0 fail
- [x] `DB_INTEGRATION_TESTS=1 node --test --import ./test-support/testEnv.js 'test/integration/**/*.test.js'`：跑咗兩次，第一次 `itemConcurrency.integration.test.js` 嘅 last-active race 測試因為另一個並行 session 共用 `erp_dev` 撞鎖而回 500（同呢個 session 一路以嚟觀察到嘅已知、非本身代碼問題嘅共享 DB flakiness 一致），單獨重跑即刻通過；第二次全套 219/219 pass。
- [x] `npm run lint`（repo root）：clean
- [x] 確認 dev DB 冇殘留測試資料（`item_import_jobs` 剩低第 263 行係另一個 session 嘅遺留、非本次觸碰）；`storage/imports/` 冇任何本次測試建立嘅新檔案（`find storage/imports -newermt "10 minutes ago"` 回 0）。

**Dependencies:** T27, T29

**Files actually touched:**

- `server/src/services/itemImport/ItemImportFileCleanupJob.js`（新增）：`BaseService` 子類別，`scope: "cluster"`（同 `job.itemMediaCleanup` 共用嘅理由：import 根目錄係跨實例共用嘅儲存磁碟區），`cleanup()` 掃 terminal candidates、以本地 `addUtcYears()` 純函式判斷 UTC 週年到期、逐個刪檔、全部成功先 compare-and-set 標記 `files_purged_at`。
- `server/src/modules/item/ItemImportService.js`：新增 `listRetentionCandidateJobs({statuses, limit})`、`markImportFilesPurged({jobId, purgedAtMs})` 兩個純 SQL 方法。
- `server/src/modules/item/itemConstants.js`：新增 `IMPORT_JOB_TERMINAL_STATUSES`、`IMPORT_FILE_RETENTION_YEARS` 常數。
- `server/src/framework/http/fileResponse.js`：把原本 private 嘅 `isWithinDirectory()` 改做 `export`，俾 cleanup job 重用同一個「路徑冇逃出受控目錄」判斷，唔使抄一份——純新增 export，行為完全冇變。
- `server/test/serviceContainer.test.js`：喺白名單加返 `job.itemImportFileCleanup` 一項（同 `job.itemImportWorker`／`job.itemMediaCleanup` 同一組 dependencies），順住 service discovery 實際嘅字母順序（`ItemImportFileCleanupJob.js` 排喺 `ItemImportWorkerService.js` 之前）擺位置。
- `server/test/itemImportFileCleanupJob.test.js`（新增，13 個測試）：跟 `test/itemMediaCleanupJob.test.js` 一樣嘅風格，用假 `ItemImportService`（直接控制 `listRetentionCandidateJobs`／`markImportFilesPurged` 嘅回傳值）＋真實臨時目錄，只驗檔案系統呢一半（UTC 週年計算、symlink 拒絕跟蹤、path 逃逸、部分刪除失敗、`markImportFilesPurged` 回 false 時嘅 racedAway、`signal.aborted` 中途停低、重跑 idempotency）。
- `server/test/integration/itemImportFileCleanup.integration.test.js`（新增，4 個測試）：對真 MySQL 驗 `listRetentionCandidateJobs`（狀態篩選、`files_purged_at IS NULL` 篩選、id 排序、limit）同 `markImportFilesPurged`（compare-and-set，第二次呼叫回 false 且唔覆蓋原本嘅時間戳，唔存在嘅 jobId 回 false）。

**冇改 `server/config/scheduler.js` 嘅原因：** 原本估計要改，但 `ItemImportFileCleanupJob` 自己嘅 `static jobs` 陣列已經提供獨立嘅 job 名稱（`itemImport.fileCleanup`）、`intervalMs`、`timeoutMs`——同 `job.itemMediaCleanup`／`job.itemImportWorker` 一樣，唔需要喺 `config/scheduler.js` 加任何 per-job override 先跑得到。

**測試分工（跟返呢個 session 一路以嚟嘅慣例）：** 檔案系統行為（symlink、path 逃逸、部分失敗、UTC 週年計算）用假 database 做單元測試，唔起真 MySQL；`listRetentionCandidateJobs`／`markImportFilesPurged` 呢兩個直接掂 SQL 嘅方法用真 MySQL 整合測試驗（compare-and-set 呢種行為假 mock 驗唔到真係咪原子）。

**Estimated scope:** M（4 files likely touched → 實際 7 個檔案：3 個新測試／實作檔加埋兩個新測試檔案）

### Task T35：完成效能、容量及營運可觀測性驗證

**Description:** 建立 100,000 SKU／1,000,000 Barcode／1,000,000 UOM rows 的可重複壓測資料與混合負載，驗證 50 concurrent users、每日 1,000 次變更比例及 10,000-row import KPI。

**Acceptance criteria:**

- [x] Exact Code／Barcode、首頁與常用 filters 在混合負載下 p95 < 2 秒，`EXPLAIN` 無不合理 full scan。
- [x] Preflight＋execution 系統處理時間合計 ≤ 10 分鐘，期間一般 lookup 仍 p95 < 2 秒。
- [x] Metrics／logs 可觀察 API latency、error rate、constraint conflict、queue age、running duration、lease recovery、media cleanup failure，且不含敏感 payload（見下面「可觀測性」段落——絕大部分由既有機制覆蓋，只新增咗 import queue age 一個欄位）。

**Verification（實際執行，對真實共用嘅 `erp_dev` MySQL）:**

- [x] `ITEM_PERFORMANCE_TESTS=1 node --test --import ./test-support/testEnv.js test/performance/itemManagement.performance.test.js`：4 個測試全部 pass（EXPLAIN、50 併發混合負載、10,000-row import KPI、外層測試本身），總耗時約 181 秒（含分批清理）。實測結果：
  - exact SKU code lookup p95 = 327.0ms；exact barcode lookup p95 = 384.2ms（500 次取樣）。
  - 首頁列表（冇 filter）p95 = 813.2ms；常用 status＋category filter p95 = 1520.7ms（500 次取樣）。
  - `EXPLAIN` 對兩條 exact lookup 查詢嘅每一個 table 都唔係 `type: ALL`。
  - 10,000-row CSV：preflight（`runValidation`）256ms＋execution（`runExecution`）5226ms，合計 5.48 秒，遠低於 10 分鐘預算；執行期間同時抽樣嘅一般 lookup p95 = 0.5ms（260 次取樣）。
  - 呢組數字喺 4 次獨立執行（100k SKU 規模 3 次＋之前嘅細規模 dry run）都高度一致（exact code p95 一直喺 327–391ms、exact barcode 384–575ms、首頁 813–978ms、filter 1521–1691ms、import 合計 5.5–6.4 秒），確認唔係單次僥倖。
- [x] `npm test`（server 單元套件）：1206 pass／0 fail（220 skipped，包含呢個 performance test 本身喺冇設 `ITEM_PERFORMANCE_TESTS` 時嘅 skip）。
- [x] `DB_INTEGRATION_TESTS=1 node --test --import ./test-support/testEnv.js 'test/integration/**/*.test.js'`：219 pass／0 fail。
- [x] `npm run lint`（repo root）：clean。
- [x] 確認 dev DB 冇殘留：`perf-item-%`／`perf-cat-%`／`perf-brand-%`／`PERF%` UOM／`PERFBC%` barcode／`perf-user-%` 全部歸零；`storage/imports/` 冇任何呢次測試新增嘅檔案殘留。

**⚠️ 過程中發現嘅重要限制（值得記錄，唔係呢個 task 要解決嘅 bug）：** 對超過百萬列規模嘅資料一次過執行大範圍 `DELETE`（試過 `WHERE id IN (SELECT ...)` 子查詢同純 JOIN 兩種寫法），透過呢個專案嘅 mysql2 connection pool（`MySqlDatabaseService`）執行時，會喺嗰句 DELETE 完成之後、下一句都未發出之前完全卡死——Node event loop 完全 idle、MySQL 端所有連線都係 `Sleep`、冇任何錯誤或逾時被觸發，只可以外部強制終止進程先擺脫到（用 `--report-signal` 產生嘅 diagnostic report 確認：9 條 TCP 連線全部 idle、JS call stack 為空、`loopIdleTimeSeconds` 逾 1700 秒）。用 plain `mysql` client 執行完全同一句 SQL 每次都正常完成（慢，約 1–2 分鐘，但唔會卡死），可見唔係 SQL 本身或者資料量嘅問題，而係呢個規模下 mysql2／連線池某個邊界情況嘅 bug。過程中亦曾懷疑同一直背景執行緊嘅 scheduler job 爭 connection pool 有關（已經喺清理前加 `scheduler.stop()`），但排除咗呢個因素之後（獨立、乾淨環境下）問題依然重現，證實同 scheduler 無關。已經喺 `itemPerformanceFixtures.js` 用分批（每批 5,000 個 Item，連帶約 50,000 條 barcode／sku_uom）迴避呢個問題——分批之後清理 100,000 筆殘留資料只需 77.7 秒，順利完成。呢個發現值得未來如果要再擴大壓測規模，或者要喺其他地方寫類似嘅大量資料清理邏輯時留意，但修復 `MySqlDatabaseService`／mysql2 本身呢個邊界情況唔喺 T35（效能驗證）呢個 task 嘅範圍之內。

**Dependencies:** T21, T22, T24, T26, T30, T31, T33, T34

**Files actually touched:**

- `server/test-support/itemPerformanceFixtures.js`（新增）：`seedItemPerformanceFixtures()` 純 bulk INSERT 產生 100,000 Item／SKU、1,000,000 barcode、1,000,000 UOM rows（唔經過 `ItemAdminService`，靠 `insertId + offset` 喺單一 multi-row INSERT statement 入面計返每列自己嘅 id，依賴 `innodb_autoinc_lock_mode=2`）；`cleanupItemPerformanceFixtures()` 分批（`batchSize` 預設 5,000 個 Item 一批）刪除，避開上面講嘅連線池邊界問題。
- `server/test/performance/itemManagement.performance.test.js`（新增）：`ITEM_PERFORMANCE_TESTS=1` 先跑（唔入 CI、唔喺日常 `npm test`），三個子測試對應 design_spec §11.5 嘅驗收點；規模、併發數、匯入列數全部可以用環境變數覆寫，方便本機用細規模 dry run。
- `server/src/modules/item/ItemImportService.js`：`claimNextQueuedJobForExecution()` 加 `confirmed_at` 落 SELECT，回傳多咗 `confirmedAt`。
- `server/src/services/itemImport/jobs/executeItemImportJob.js`：`item.import.claimed` 呢個既有 log event 加多一個 `queueAgeMs` 欄位（`confirmedAt` 到而家嘅時間差）——design_spec §12.3 明確要求嘅 import queue age 觀測指標，之前完全冇對應嘅量測。

**可觀測性（design_spec §12.3 七項）：** 除咗 import queue age 之外，其餘六項全部由呢個 repo 已經存在嘅結構化 log／機制覆蓋，冇再新增額外 instrumentation：

- **API latency／error rate**（按 list／lookup／write／upload／import 分類）：`requestLogger.js` 每個請求都寫一筆 `http.request.completed`／`http.request.client_disconnected`，帶 `durationMs`、`method`、`url`、`output.statusCode`——可以直接按 URL pattern／method 切出 list／lookup／write／upload／import 各自嘅 latency 分佈同錯誤率，唔使逐個 endpoint 各自另開一個 event。
- **Duplicate constraint conflict**：寫入路徑嘅 409（`VERSION_CONFLICT`／`DUPLICATE_SKU_CODE` 等）本身就係上面嗰個 `http.request.completed` 嘅一部分（`output.statusCode=409`），而且 `requestLogger` 對錯誤狀態碼會強制完整記低 response body（含 `error.code`），所以邊一種 conflict 都睇得到，唔使額外一個計數器。
- **Import queue age／running duration／lease recovery**：`item.import.claimed`（見上面新增嘅 `queueAgeMs`）；`scheduler.job.completed`／`scheduler.job.failed` 帶 `durationMs`（running duration）；`scheduler.lease.failed`／`scheduler.job.not_leader`／`JobStatsFlushJob` 嘅 `scheduler.stats`彙總（含 `lastOutcome`、`consecutiveFailures`）覆蓋 lease recovery——呢啲全部係 T27 起已經存在嘅既有機制，冇為咗 T35 特登加嘢。
- **Media orphan／delete failure**：`item.media_orphan_cleaned`／`item.media_delete_failed`（T-earlier 已經存在，`ItemMediaCleanupJob.js`）。

**Estimated scope:** M（5 logical files／directories likely touched → 實際 4 個檔案：2 個新增、2 個小改動）

### Task T36：完成部署文件、Smoke、回歸及 Release Gate

**Description:** 完成 README、部署／回滾、初始 Catalog、scheduler、media persistence、合規前置確認及最終自動／手動驗收，產出可簽核的 release evidence。

**Acceptance criteria:**

- [x] README 記錄 migration、設定、持久化 volume、workers、固定價格口徑、backup／restore、forward-only rollback 與 smoke steps。
- [x] 業務提供首版 Category／UOM／Attribute／internal Barcode 樣本；合規核對 DEC-023，差異已回寫 requirement／design／tests。**範圍說明：** 呢個開發階段冇真正嘅業務單位提供首版資料，改用示範性範例值（README「業務catalog首版樣本」一節，已明確標注僅供示範、正式內容待業務核准）——呢個是同使用者確認過嘅範圍決定（見下面「Files actually touched」）。DEC-023（7 年保留）已喺 T34／T35 驗證過機制存在，冇發現差異，唔需要回寫 requirement／design。
- [x] AC-001–AC-037 有可追溯測試或人工證據，沒有未分類失敗、跳過的必跑測試或未核准 scope change。見 `test_case.md` §10.1 逐條對照表；7 條標注「建議人工驗證」、1 條（AC-034）明確標注超出模組範圍，其餘全部有自動化測試對應。

**Verification（實際執行）:**

- [x] `DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=erp_user DB_PASSWORD=erp_password DB_NAME=erp_dev DB_INTEGRATION_TESTS=1 npm run verify`：lint clean；server `test:coverage`（1206 unit + 219 integration + T35 performance）全部 pass，全域覆蓋率 lines/branches/functions 都過 92%/83%/90% 門檻；client 測試通過（覆蓋率無強制門檻）；`npm audit --audit-level=high` 冇 high/critical 漏洞（3 個 moderate，屬既有依賴、非本次改動引入）。**重要修正：** 第一次冇帶 `DB_INTEGRATION_TESTS=1` 手動跑覆蓋率一度睇落跌穿門檻（新增嘅 `itemPerformanceFixtures.js` 冇被日常 `npm test` 行過），已經加咗 `server/test/itemPerformanceFixtures.test.js`（假 database 單元測試，唔使真 MySQL）令呢個檔案本身都有自動化覆蓋，同時確認漏帶環境變數先係真正原因（integration test 原本就負責覆蓋 `ItemAdminService.js` 呢類淨靠真 MySQL 驗嘅 service）。
- [x] `npm run build --workspace client`：成功（現有 chunk size 警告，非本次改動引入，未處理）。
- [x] `DB_INTEGRATION_TESTS=1 npm test --workspace server`：包含喺上面嘅 `npm run verify` 入面，另外亦單獨確認過。
- [x] Manual smoke（真瀏覽器，臨時 QA 帳號 `t36qa`，device binding 核准流程同 T30–T33 一致）：Draft 建立→Active 啟用（記低啟用原因＋自動選晒 SKU）→SKU Code／名稱搜尋（`1–1 of 1`）→更新建議零售價（版本 bump，RRP 4 位小數格式要求）→停用（記原因）→復原（重新啟用，版本再 bump）→稽核（直接打 `/api/v1/item-audit/logs` 確認 `item.create`／`item.activate`／`sku.update` 三筆，各自有 actor／reason／前後值）→媒體（用 synthetic PNG 上傳成功）→匯出（CSV 內容確認固定 HKD／tax_not_applicable）→匯入（上傳→背景 worker 自動 preflight→UI 確認＋密碼再認證→背景 worker 自動 execute→`status: completed`）。全程一次過，冇遇到需要修 bug 嘅發現。完成後已清走呢次 smoke 建立嘅 Item／SKU／media／import job／QA 帳號，保留 Category／Brand／UOM／Attribute 呢批示範 catalog 樣本（見上面 acceptance criteria 第二點）。

**Dependencies:** T35 and all earlier Tasks

**Files actually touched:**

- `README.md`：新增「商品管理模組（Item Management）」一節，涵蓋 migration、`config/item.js` 全部環境變數、持久化 volume（媒體／匯入兩個獨立受控目錄）、四個背景 job（`itemMedia.cleanupOrphans`／`itemImport.validate`／`itemImport.execute`／`itemImport.fileCleanup`）、固定 HKD／`tax_not_applicable` 價格口徑、備份與還原、forward-only rollback（migration 冇 `down()`，出錯要往前修）、業務 catalog 首版樣本（示範值，標注待業務核准）、release smoke steps。
- `docs/items_management/test_case.md`：新增 §10.1 AC-001–AC-037 逐條可追溯性對照表（測試檔案＋測試名稱，或明確標注人工驗證／範圍外），填寫 §11 測試執行記錄（Round 1，2026-09-10）。
- `docs/items_management/tasks.md`：本文件，T34／T35／T36 三個段落全部填實，Checkpoint 狀態同頂部狀態列更新。
- `docs/items_management/requirement.md`、`docs/items_management/design_spec.md`：檢查後確認呢兩份文件本身冇需要因為 T36 而修改嘅差異（AC 定義、DEC-023 保留期都同實作一致）。

**Estimated scope:** M（文件、測試與 release evidence）

## Checkpoint L：T34–T36 Release Ready

- [x] Retention、安全、效能、容量、備份與回滾要求全部有證據——見 T34（1 年檔案保留清理）、T35（100k SKU 效能實測＋七項可觀測性）、README（備份／回滾）三個段落。
- [x] `npm run verify`、client production build、真 MySQL integration 全綠——見 T36 Verification。
- [ ] Migration 在 staging 由現行版本升級及重跑均成功。**未做：** 呢個專案冇獨立嘅 staging 環境；已經喺本機 dev DB 反覆確認「重跑全部 migration 唔改變任何嘢」（`itemImportMigrations.integration.test.js` 等），但冇喺一個獨立於開發機嘅 staging 環境驗證過「由現行版本升級」呢個情境，需要營運／DevOps 安排 staging 環境後另外驗證。
- [ ] 業務、開發、QA、營運及合規完成各自簽核項目。**未做：** 呢一項本質上係人工簽核流程，唔係開發可以代簽嘅——開發（呢個 Phase 嘅實作＋自動化驗收）已完成，業務（catalog 首版樣本、AC 範圍決定）、QA（獨立於開發嘅測試執行）、營運（staging／備份演練）、合規（DEC-023 等保留規則覆核）四方嘅正式簽核仍然待人工進行。
- [x] Release 可進入正式測試；本 Task 清單不等同測試執行報告——開發／自動化驗收部分已完成到呢個程度，正式測試（涉及上面兩項未完成嘅簽核）由使用者決定幾時安排。

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
<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal Phase and Task Definitions

The historical task body and checkbox evidence remain unchanged. The ledger owns membership and relationships; these formal definitions provide executable intent without rewriting historical completion claims.

## PHASE-001 — Foundation and Catalog

### Outcome
Deliver the coherent `Foundation and Catalog` increment represented by TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007.

### Entry criteria
Use the approved requirement/design/plan baseline, a refreshed default branch and isolated worktree; required dependencies and decisions must be observed before execution.

### Acceptance criteria
Every mandatory linked technical case passes against the current immutable candidate; historical checkboxes remain provenance rather than current formal evidence.

### Integration and regression
Run the profile-declared developer and affected contract/UI/database suites, including downstream consumers when their real contracts exist.

### Git and merge plan
Use DEFAULT branch strategy from freshly observed main, one reviewable merge group, developer self-test, current CI and actual review before merge; clean up only after PR resolution.

### Rollback
Prefer reversible code/config rollback; database changes use reviewed forward fixes and never destructive reset. Documentation history remains recoverable from Git.

### Exit criteria
The Phase merge group is complete, required evidence is baseline-bound, no unresolved blocking finding remains, and the integrated baseline is observed.

## PHASE-002 — Core Item/SKU

### Outcome
Deliver the coherent `Core Item/SKU` increment represented by TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022.

### Entry criteria
Use the approved requirement/design/plan baseline, a refreshed default branch and isolated worktree; required dependencies and decisions must be observed before execution.

### Acceptance criteria
Every mandatory linked technical case passes against the current immutable candidate; historical checkboxes remain provenance rather than current formal evidence.

### Integration and regression
Run the profile-declared developer and affected contract/UI/database suites, including downstream consumers when their real contracts exist.

### Git and merge plan
Use DEFAULT branch strategy from freshly observed main, one reviewable merge group, developer self-test, current CI and actual review before merge; clean up only after PR resolution.

### Rollback
Prefer reversible code/config rollback; database changes use reviewed forward fixes and never destructive reset. Documentation history remains recoverable from Git.

### Exit criteria
The Phase merge group is complete, required evidence is baseline-bound, no unresolved blocking finding remains, and the integrated baseline is observed.

## PHASE-003 — Retail extensions

### Outcome
Deliver the coherent `Retail extensions` increment represented by TASK-023, TASK-024, TASK-025, TASK-026.

### Entry criteria
Use the approved requirement/design/plan baseline, a refreshed default branch and isolated worktree; required dependencies and decisions must be observed before execution.

### Acceptance criteria
Every mandatory linked technical case passes against the current immutable candidate; historical checkboxes remain provenance rather than current formal evidence.

### Integration and regression
Run the profile-declared developer and affected contract/UI/database suites, including downstream consumers when their real contracts exist.

### Git and merge plan
Use DEFAULT branch strategy from freshly observed main, one reviewable merge group, developer self-test, current CI and actual review before merge; clean up only after PR resolution.

### Rollback
Prefer reversible code/config rollback; database changes use reviewed forward fixes and never destructive reset. Documentation history remains recoverable from Git.

### Exit criteria
The Phase merge group is complete, required evidence is baseline-bound, no unresolved blocking finding remains, and the integrated baseline is observed.

## PHASE-004 — Bulk capabilities

### Outcome
Deliver the coherent `Bulk capabilities` increment represented by TASK-027, TASK-028, TASK-029, TASK-030, TASK-031, TASK-032, TASK-033, TASK-034.

### Entry criteria
Use the approved requirement/design/plan baseline, a refreshed default branch and isolated worktree; required dependencies and decisions must be observed before execution.

### Acceptance criteria
Every mandatory linked technical case passes against the current immutable candidate; historical checkboxes remain provenance rather than current formal evidence.

### Integration and regression
Run the profile-declared developer and affected contract/UI/database suites, including downstream consumers when their real contracts exist.

### Git and merge plan
Use DEFAULT branch strategy from freshly observed main, one reviewable merge group, developer self-test, current CI and actual review before merge; clean up only after PR resolution.

### Rollback
Prefer reversible code/config rollback; database changes use reviewed forward fixes and never destructive reset. Documentation history remains recoverable from Git.

### Exit criteria
The Phase merge group is complete, required evidence is baseline-bound, no unresolved blocking finding remains, and the integrated baseline is observed.

## PHASE-005 — Non-functional and delivery

### Outcome
Deliver the coherent `Non-functional and delivery` increment represented by TASK-035, TASK-036.

### Entry criteria
Use the approved requirement/design/plan baseline, a refreshed default branch and isolated worktree; required dependencies and decisions must be observed before execution.

### Acceptance criteria
Every mandatory linked technical case passes against the current immutable candidate; historical checkboxes remain provenance rather than current formal evidence.

### Integration and regression
Run the profile-declared developer and affected contract/UI/database suites, including downstream consumers when their real contracts exist.

### Git and merge plan
Use DEFAULT branch strategy from freshly observed main, one reviewable merge group, developer self-test, current CI and actual review before merge; clean up only after PR resolution.

### Rollback
Prefer reversible code/config rollback; database changes use reviewed forward fixes and never destructive reset. Documentation history remains recoverable from Git.

### Exit criteria
The Phase merge group is complete, required evidence is baseline-bound, no unresolved blocking finding remains, and the integrated baseline is observed.

## PHASE-006 — Alignment remediation

### Outcome
Deliver the coherent `Alignment remediation` increment represented by TASK-037, TASK-038, TASK-039, TASK-040, TASK-041, TASK-042, TASK-043, TASK-044.

### Entry criteria
Use the approved requirement/design/plan baseline, a refreshed default branch and isolated worktree; required dependencies and decisions must be observed before execution.

### Acceptance criteria
Every mandatory linked technical case passes against the current immutable candidate; historical checkboxes remain provenance rather than current formal evidence.

### Integration and regression
Run the profile-declared developer and affected contract/UI/database suites, including downstream consumers when their real contracts exist.

### Git and merge plan
Use DEFAULT branch strategy from freshly observed main, one reviewable merge group, developer self-test, current CI and actual review before merge; clean up only after PR resolution.

### Rollback
Prefer reversible code/config rollback; database changes use reviewed forward fixes and never destructive reset. Documentation history remains recoverable from Git.

### Exit criteria
The Phase merge group is complete, required evidence is baseline-bound, no unresolved blocking finding remains, and the integrated baseline is observed.

## TASK-001 — 修正 migration 編號並凍結實作映射

### Goal
Complete 修正 migration 編號並凍結實作映射 as defined by the `legacy T01` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T01`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-001 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-002 — 建立 Item 權限目錄與 seed

### Goal
Complete 建立 item 權限目錄與 seed as defined by the `legacy T02` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T02`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-001, TC-010 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-003 — 建立 Item 設定、常數與公開錯誤基礎

### Goal
Complete 建立 item 設定、常數與公開錯誤基礎 as defined by the `legacy T03` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T03`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-012 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-004 — 建立 Category、Brand、UOM schema

### Goal
Complete 建立 category、brand、uom schema as defined by the `legacy T04` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T04`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-001 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-005 — 完成 Category 管理切片

### Goal
Complete 完成 category 管理切片 as defined by the `legacy T05` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T05`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-007 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-006 — 完成 Brand 與 UOM 管理切片

### Goal
Complete 完成 brand 與 uom 管理切片 as defined by the `legacy T06` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T06`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-007 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-007 — 完成 Catalog 整合、權限與頁面 metadata 驗證

### Goal
Complete 完成 catalog 整合、權限與頁面 metadata 驗證 as defined by the `legacy T07` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T07`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-007 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-008 — 建立 Item、SKU 與 Audit schema

### Goal
Complete 建立 item、sku 與 audit schema as defined by the `legacy T08` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T08`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-001 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-009 — 建立 SKU UOM 與 Barcode schema

### Goal
Complete 建立 sku uom 與 barcode schema as defined by the `legacy T09` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T09`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-001, TC-006 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-010 — 建立核心驗證與 Barcode 規則

### Goal
Complete 建立核心驗證與 barcode 規則 as defined by the `legacy T10` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T10`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-006, TC-007 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-011 — 建立 Item Audit service 與查詢 API

### Goal
Complete 建立 item audit service 與查詢 api as defined by the `legacy T11` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T11`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-010 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-012 — 建立 Item／SKU 列表與詳情後端

### Goal
Complete 建立 item／sku 列表與詳情後端 as defined by the `legacy T12` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T12`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-002 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-013 — 建立商品導航與列表頁

### Goal
Complete 建立商品導航與列表頁 as defined by the `legacy T13` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T13`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-002, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-014 — 建立 Item＋初始 SKU 原子建檔後端

### Goal
Complete 建立 item＋初始 sku 原子建檔後端 as defined by the `legacy T14` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T14`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-003 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-015 — 建立 Item／SKU 建檔頁與基本 Editor

### Goal
Complete 建立 item／sku 建檔頁與基本 editor as defined by the `legacy T15` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T15`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-003, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-016 — 建立 Item／SKU aggregate 更新後端

### Goal
Complete 建立 item／sku aggregate 更新後端 as defined by the `legacy T16` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T16`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-004 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-017 — 建立 Item／SKU 詳情與編輯頁

### Goal
Complete 建立 item／sku 詳情與編輯頁 as defined by the `legacy T17` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T17`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-002, TC-004, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-018 — 建立 Item／SKU 生命週期後端

### Goal
Complete 建立 item／sku 生命週期後端 as defined by the `legacy T18` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T18`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-005 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-019 — 建立生命週期與狀態操作 UI

### Goal
Complete 建立生命週期與狀態操作 ui as defined by the `legacy T19` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T19`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-005, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-020 — 建立受控刪除、複製、SKU Code 修改與 Barcode 釋放

### Goal
Complete 建立受控刪除、複製、sku code 修改與 barcode 釋放 as defined by the `legacy T20` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T20`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-005, TC-010 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-021 — 建立下游 ItemLookupService contract

### Goal
Complete 建立下游 itemlookupservice contract as defined by the `legacy T21` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T21`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-006 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-022 — 完成核心端到端、並發與安全驗證

### Goal
Complete 完成核心端到端、並發與安全驗證 as defined by the `legacy T22` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T22`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-002 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-023 — 建立 Attribute schema、variant signature 與 domain 規則

### Goal
Complete 建立 attribute schema、variant signature 與 domain 規則 as defined by the `legacy T23` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T23`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-003, TC-007 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-024 — 完成 Attribute／Variant API 與 UI

### Goal
Complete 完成 attribute／variant api 與 ui as defined by the `legacy T24` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T24`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-003, TC-007, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-025 — 建立 Media schema、service、API 與孤兒檔清理

### Goal
Complete 建立 media schema、service、api 與孤兒檔清理 as defined by the `legacy T25` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T25`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-008 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-026 — 建立 Media UI 與檔案安全整合測試

### Goal
Complete 建立 media ui 與檔案安全整合測試 as defined by the `legacy T26` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T26`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-008, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-027 — 建立 Import persistence、dependencies 與 worker 設定

### Goal
Complete 建立 import persistence、dependencies 與 worker 設定 as defined by the `legacy T27` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T27`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-001, TC-009 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-028 — 建立 CSV preflight processor

### Goal
Complete 建立 csv preflight processor as defined by the `legacy T28` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T28`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-009 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-029 — 建立 Import confirm／execution／result API

### Goal
Complete 建立 import confirm／execution／result api as defined by the `legacy T29` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T29`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-009 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-030 — 建立 Import UI

### Goal
Complete 建立 import ui as defined by the `legacy T30` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T30`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-009, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-031 — 建立 SKU Export

### Goal
Complete 建立 sku export as defined by the `legacy T31` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T31`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-009 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-032 — 建立疑似重複商品提示

### Goal
Complete 建立疑似重複商品提示 as defined by the `legacy T32` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T32`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-003, TC-009 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-033 — 建立 bounded bulk status change

### Goal
Complete 建立 bounded bulk status change as defined by the `legacy T33` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T33`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-005, TC-009 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-034 — 建立 Import 檔案保留清理

### Goal
Complete 建立 import 檔案保留清理 as defined by the `legacy T34` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T34`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-009 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-035 — 完成效能、容量及營運可觀測性驗證

### Goal
Complete 完成效能、容量及營運可觀測性驗證 as defined by the `legacy T35` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T35`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-012 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-036 — 完成部署文件、Smoke、回歸及 Release Gate

### Goal
Complete 完成部署文件、smoke、回歸及 release gate as defined by the `legacy T36` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `legacy T36`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-016 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-037 — Complete Attribute/Variant detail projections

### Goal
Complete complete attribute/variant detail projections as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-002, TC-003, TC-011, TC-013 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-038 — Implement retained standalone SKU creation contract

### Goal
Implement the standalone SKU creation contract for an existing Variant Item, retained by human decision `HD-001`, as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-003, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-039 — Deliver user-facing audit history

### Goal
Complete deliver user-facing audit history as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-002, TC-010, TC-011 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-040 — Normalize referenced Brand/UOM deletion errors

### Goal
Complete normalize referenced brand/uom deletion errors as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-005, TC-014 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-041 — Align CSV import with aggregate validation and transactional audit

### Goal
Complete align csv import with aggregate validation and transactional audit as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-009, TC-010, TC-015 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-042 — Reconcile historical T23/checkpoint status

### Goal
Complete reconcile historical t23/checkpoint status as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-013 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-043 — Integrate first real downstream reference guard

### Goal
Complete integrate first real downstream reference guard as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-004, TC-005 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

## TASK-044 — Complete independent acceptance and DR/sign-off evidence

### Goal
Complete complete independent acceptance and dr/sign-off evidence as defined by the `alignment remediation section` narrative and linked requirement/design scope.

### Approach
Follow the components, dependencies, implementation notes and preserved decisions in `alignment remediation section`; typed membership and test links are in `08_traceability.json`.

### Acceptance criteria
The task-specific checklist above is satisfied and linked cases TC-001, TC-012, TC-016 provide current-candidate evidence without skipped mandatory behavior.

### Definition of Done
Scoped changes, review, developer tests, required CI, traceability and safe cleanup are complete. Historical recorded completion is not upgraded to formal acceptance without a current observed run.

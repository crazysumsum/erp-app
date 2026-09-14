# Business Master Development Execution Plan

`08_traceability.json` 是 Phase/Task 關係、dependency、suite、branch strategy 與 merge group 的 typed authority。
所有項目目前均為 `PENDING`；本文件是計畫，不是實作或測試證據。

## PHASE-001 — 共用 provider 與管理 API 基線

### Outcome
交付 Currency／Payment Term sole-owner schema、HKD seed、permissions、pure rules、transaction-aware provider、impact guard、
管理 API、audit、readiness 及 server acceptance suites。合併後下游可依 v1 provider 開始整合，管理 API 可獨立驗證。

### Entry criteria
Product Owner 批准 exact design/plan hashes；獨立 design review無 open CRITICAL/HIGH；implementation mode獲授權；從最新
origin/main新建 DEFAULT worktree；全域 migration sequence owner、隔離 MySQL schema及 ports 已確認。

### Acceptance criteria
Fresh/half-applied/repeated migration安全；恰好一筆 Active HKD且零 production Payment Term seed；所有 mutation具 permission、
strict schema、idempotency、CAS、atomic audit；停用、精度及規則修改都通過 fresh impact guard；provider
active/history/transaction/calculation與 impact fail-closed 契約通過真 MySQL 測試。

### Integration and regression
執行 lint、Business Master server integration/security/contract、performance、recovery及現有 framework/user/item regression。
Customer、Supplier、Sales、Purchasing、AR fixtures驗證 v1 projection；任何 required consumer 未驗證均阻止 merge。

### Git and merge plan
一個 fresh DEFAULT branch/worktree、一個 `business-master-phase-1` PR；migration number只在 branch建立後從最新 main分配。
Developer self-test PASS -> commit/push -> GitHub CI四個 mandatory jobs PASS -> 實際 required reviewer approval -> merge。
不使用 stacked branch或預留後續 migration；open PR保留remote branch，merge/close後安全移除 worktree/local/remote branch。

### Rollback
App route/provider 可回退至前一版但 schema/audit保留；已套 migration不修改或 down，問題用新 forward migration修復。
若 consumer尚未切換，可延後入口；不得回復 shadow catalog。

### Exit criteria
PR merged、integrated main可 build、mandatory developer/CI/review evidence綁 current candidate，provider readiness READY，
phase state/evidence完成且無未解 P0/P1 defect，cleanup依 PR狀態處理。

## PHASE-002 — 管理 UI、consumer adoption 與操作就緒

### Outcome
交付兩個可存取、回應式管理頁、高影響 impact/audit flow、中文錯誤、Playwright UAT pack、consumer adoption regression
與 runbook，使功能達 `READY_FOR_TESTING`，但不執行正式 Technical Acceptance/UAT。

### Entry criteria
PHASE-001 已 merge且 provider readiness/contract observed；重新 fetch並由最新 main新建 DEFAULT worktree；UI route/menu、測試 port、
synthetic roles及 DB schema已隔離；exact plan仍有效。

### Acceptance criteria
view/mgmt/system-admin/consumer permission UX正確；Currency/Payment Term CRUD（不含 delete）、calculation preview、impact confirm、
409/422/503 recovery、audit link、loading/empty/error狀態在375–1440px可完成；console/network無相關 unexpected failure。

### Integration and regression
執行 lint、client build、component/UI、server/consumer contract及 Playwright developer suites；完整 `npm run verify` 與 GitHub CI mandatory jobs。
回歸 User/Role/menu/page discovery、Customer/Supplier/Sales/Purchasing/AR contract，且不要求 consumer取得 Business Master管理權限。

### Git and merge plan
PHASE-001 merge後 fresh DEFAULT branch，一個 `business-master-phase-2` PR；不從舊 feature branch stacked。
Developer suites（含實際 Playwright flow）PASS -> commit/push -> current candidate CI PASS -> required reviewer approval -> merge。
正式 Technical Acceptance/UAT 留待 `TEST_AND_VERIFY`；PR open時 remote branch保留，resolved後安全 cleanup。

### Rollback
UI/menu/error mapping 可整體回退；backend/provider保留可用。Consumer adoption若發現 contract regression，以 additive adapter/forward fix處理，
不恢復雙寫或 duplicate schema。

### Exit criteria
兩個 Phase merge至同一 observed main baseline、所有 Task DONE、developer evidence與 current candidate一致、整合後 build/test/Playwright通過、
無 open required CI/review或 boundary violation，狀態才可標 `READY_FOR_TESTING`。

## TASK-001 — 配置 sole-owner migrations、permissions 與 HKD seed

### Goal
在最新 migration inventory上建立 compatible tables、audit、兩權限、system-admin mapping及唯一 HKD seed。

### Approach
先作 shape/adoption guard，再按最新連續序號新增 forward-only migrations；覆蓋 fresh、half-applied、repeat、不相容 schema及零 Payment Term seed。

### Acceptance criteria
Schema/keys/index/FK符合 DES-002；重跑無 duplicate；不相容 fail而不改資料；沒有 consumer-owned DDL。

### Definition of Done
Migration/permission tests與真 MySQL evidence通過；shared migration path有核准 owner；diff只含本 Task與測試。

## TASK-002 — 建立 ISO snapshot、normalization 與日期 pure rules

### Goal
交付可重現 ISO validation、Payment Term code normalization、conditional rule validation及 calendar calculator。

### Approach
版本化 ISO snapshot/provenance；pure helpers不讀 DB/locale clock；用 table-driven unit tests覆蓋 Unicode、leap/month/year及0/3650 boundaries。

### Acceptance criteria
只接受官方 uppercase code；四種 type結果確定；MANUAL不產 dueDate；非法組合無部分結果。

### Definition of Done
Pure unit suite及coverage達現有門檻；沒有新 runtime dependency；snapshot更新方法已記錄。

## TASK-003 — 建立 repositories、CAS 與 atomic audit

### Goal
封裝 parameterized list/detail/lock/CAS write與 business-master audit transaction。

### Approach
固定 sort allowlist與 keyset/page contract；mutations先鎖 row、`WHERE version=?`、更新與 allowlisted audit同 transaction。

### Acceptance criteria
duplicate/CAS/audit failure均 rollback；列表索引可用；audit可依 entity/actor/action/date查詢且無 secret/body。

### Definition of Done
Repository、true-MySQL concurrency與audit tests pass；query plans/evidence可追查。

## TASK-004 — 完成 Currency domain 管理服務

### Goal
實作 Currency list/detail/create/update/activate/deactivate/change-precision orchestration，不含 HTTP/UI。

### Approach
組合 TASK-002/003、IdempotencyService與 impact interface；code immutable，一般 update 只改 name；status 只由 lifecycle
command 修改，decimalPlaces 只由高影響 command 修改；回統一 projection/errors。

### Acceptance criteria
正常/重複/invalid/no-op/CAS/retry/lost-response scenarios可判定；Inactive history可讀，新用途拒絕。

### Definition of Done
Service unit/integration cases pass；API尚未接入前亦可直接測試；無 FX 或 delete path。

## TASK-005 — 完成 Payment Term domain 與 calculator service

### Goal
實作 term list/detail/create/update/lifecycle及 current/history calculation orchestration。

### Approach
id作 identity、code immutable、version/CAS；一般 update 只改 name/description，status 只走 lifecycle command，rule change
只走高影響 command；rule change只影響未來 lookup，既有 transaction用 snapshot replay。

### Acceptance criteria
Normalized unique、四種 conditional form、日期 boundaries、Inactive/new/history語意及 idempotent commands全部可驗證。

### Definition of Done
Pure/service/DB tests pass；沒有 production seed；calculation output完整且stable。

## TASK-006 — 實作 consumer impact registry 與高影響操作 guard

### Goal
取得完整引用摘要並在 fresh confirmation時安全停用或修改精度／規則，不改 consumer資料。

### Approach
註冊 Customer/Supplier/Sales/Purchasing/AR/AP checker與 readiness status；canonical token含 entity/version、operation、
proposed change、results/watermarks，五分鐘expiry並recompute。

### Acceptance criteria
Known zero、references、not-installed、timeout/error、stale token、actor/version mismatch及race行為符合DES-005。

### Definition of Done
Checker contract/concurrency/failure tests pass；任一required unknown fail closed；audit保存exact summary。

## TASK-007 — 交付 transaction-aware lookup provider 與 readiness

### Goal
提供 v1 active/history/assert/calculate methods及 startup self-check。

### Approach
Wrapper與`*InTransaction`共用 pure validation/projection；transaction method要求 caller connection並固定 lock order；readiness驗 schema/HKD/permissions/registry。

### Acceptance criteria
selector不含Inactive；history可讀；confirm-time state/version change拒絕；provider/schema不ready令consumer fail closed。

### Definition of Done
Provider/transaction/consumer fixture tests pass；contract version與minimal projections文件化。

## TASK-008 — 交付 strict 管理 handlers 與 idempotent API contract

### Goal
建立 DES-007 所有 handler、AJV schema、permission/error mapping與 mutation idempotency。

### Approach
依URL前綴放 handler；每endpoint strict request/response schema；handler只做auth/boundary/orchestration，不重複domain rule。

### Acceptance criteria
401/403/404/409/422/503與success shape一致；不同payload key reuse拒絕；state commands不能被PATCH繞過。

### Definition of Done
Handler convention、contract/security/integration tests pass；OpenAPI-equivalent tables/examples與implementation一致。

## TASK-009 — 建立 server acceptance、performance 與 recovery adapters

### Goal
讓 formal TC可由 harness runner辨認並產JUNIT/HARNESS_JSON evidence，而非只靠普通exit code。

### Approach
整理 business-master integration/security/contract directories與 performance/recovery scripts；case名稱帶TC ID、min discovered tests與zero skip。

### Acceptance criteria
TC-001～TC-015、TC-018～TC-020均被required suites發現；10k/100 concurrency及backup/restore contract可重現。

### Definition of Done
Developer stage允許的 suites通過；formal stages仍標PLANNED；沒有production data/side effect。

## TASK-010 — 接入 frontend service、menu、route 與中文錯誤

### Goal
提供UI所需typed-by-convention service、Business Master menu entries及所有stable error中文 mapping。

### Approach
沿用page/service discovery、HttpClient與system menu，不建新store；permission meta控制入口，server仍是security authority。

### Acceptance criteria
view/mgmt menu/action visibility正確；全部API錯誤有可理解中文；build/page/menu validation pass。

### Definition of Done
Service/menu/error tests與client build pass；未改無關視覺token或framework。

## TASK-011 — 交付 Currency 管理頁

### Goal
讓管理員搜尋、建立、修改、啟用與進入停用流程，並查看audit。

### Approach
PageHeader + DataTable + FormPanel + EllipsisCell；URL state、sticky action、readonly code、precision helper及完整loading/error/empty states。

### Acceptance criteria
375–1440px、keyboard、screen reader label、validation/409/403/503 recovery符合規格；沒有 delete/FX control。

### Definition of Done
Component tests與Playwright Currency flow pass；console/network無unexpected failure。

## TASK-012 — 交付 Payment Term 管理與 Due Date 預覽頁

### Goal
讓管理員維護條款並用baseDate預覽 deterministic/manual結果。

### Approach
type conditional dueDays field、date preview、readonly id/code、status/audit；同Currency頁共用既有framework而不抽象過度。

### Acceptance criteria
四種type、0/3650、month/leap、MANUAL、invalid combination與409 recovery在UI可觀察。

### Definition of Done
Component/Playwright tests pass；form error summary/focus與中文error完整。

## TASK-013 — 交付高影響 confirmation 與 audit UX

### Goal
在停用、精度或規則修改前顯示完整consumer影響、operation/diff、unknown阻擋、reason與exact target，成功後可追查audit。

### Approach
專用dialog取得preview、不把token存在長期global state；expired/drift自動要求refresh；double-click禁用並以同idempotency key重試。

### Acceptance criteria
references/known-zero/unknown/stale/race/lost-response行為清晰；focus trap/return及非純色狀態通過。

### Definition of Done
UI/Playwright/security tests pass；沒有generic destructive confirm取代impact內容。

## TASK-014 — 建立 frontend component 與 Playwright developer suites

### Goal
把TC-016/017及UAT browser cases映射到可重現測試與診斷輸出。

### Approach
Vitest驗form/table/state；Playwright用role/label/test-id走核心flow、375/768/1024/1440、console/request與trace-on-failure。

### Acceptance criteria
loading/success/empty/error、auth、validation、navigation/refresh、double-submit與accessibility critical paths有stable assertions。

### Definition of Done
JUNIT含所有required IDs、無arbitrary sleep/flaky skip；client build及Playwright developer run pass。

## TASK-015 — 對齊 consumer contracts 與跨模組 regression

### Goal
確認 Customer、Supplier、Sales、Purchasing、AR/AP 只經v1 provider使用且現有計畫契約可相容。

### Approach
更新/加入contract tests與必要consumer adapter；Supplier planned generic HTTP endpoint轉own-permission handler+internal provider；禁止DDL/write duplication。

### Acceptance criteria
Active/history/precision/rule/snapshot/errors及permission boundary全通過；未安裝consumer有明確NOT_INSTALLED fixture而非unknown假PASS。

### Definition of Done
TC-020及全部consumer regression pass；若需修改其他module docs/contracts，先取得scope approval並在同PR清楚列出。

## TASK-016 — 完成 runbook、readiness dashboard 與整合移交

### Goal
讓運維可判斷 provider/schema/checkers/active counts，處理inactive defaults、backup/restore與forward fix。

### Approach
記錄health/metrics/alerts、deployment order、rollback、RTO/RPO演練及正式TEST_AND_VERIFY handoff；不新增未要求infra。

### Acceptance criteria
Runbook可由非作者重現readiness與recovery檢查；所有Phase/Task/TC/UAT/consumer links一致。

### Definition of Done
完整`npm run verify`、current CI/review、boundary/traceability checks通過；integrated baseline標READY_FOR_TESTING，不誤稱UAT/acceptance PASS。

## Plan notes

- TASK-001～009 屬 PHASE-001；TASK-010～016 屬 PHASE-002。
- 所有新 implementation worktree 都使用 DEFAULT；沒有 STACKED/RELEASE exception。
- Migration/global menu/error map/permission catalogue及其他module contract文件是shared path，implementation前需精確scope approval/owner協調。
- Phase merge候選次序固定：self-test -> commit/push -> current CI -> actual required review -> merge trigger；不得用舊commit綠燈。

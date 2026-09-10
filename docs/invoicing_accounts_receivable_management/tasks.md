# Invoicing & Accounts Receivable Development Execution Plan

## 0. Execution Rules

- Status in this document is planning status only；all Tasks and Phases start `PLANNED`.
- One Phase = one dedicated worktree／branch, one PR and one complete Phase test cycle.
- Each Phase starts from then-latest`origin/main`; if main moves, integrate it into the Phase branch and rerun the full gate before merge.
- No Task may bypass an unavailable upstream provider with a production fake, duplicate master table or hand-edited DB result.
- Migration numbers are assigned only when implementation starts from latest main.
- A Phase is not DONE until all tasks, tests, regression, traceability, review, PR and safe-to-merge checks have actual evidence.

## PHASE-001 — AR Foundation、Contracts and Quantity Proof

- Objective / checkpoint outcome: permissions、settings、money/state rules、durable operation、core schema及正式upstream provider contracts可用，但AR business routes仍feature-off。
- Requirements: FR-001～FR-010、FR-022～FR-038、FR-052～FR-055、FR-099～FR-107、NFR-001～NFR-010、SEC-001～SEC-015。
- Design: DES-001～DES-010、DES-014、DES-017、DES-020～DES-023、DES-025。
- Dependencies: User／Item現有能力；Sales、Fulfillment、Customer及Currency正式owner確認。
- Entry criteria: latest main clean worktree；provider source branches可取得；MySQL integration environment可用。
- Included tasks: TASK-001～TASK-008。
- Integration impact: additive permissions、config、tables及provider interfaces；feature flags default off。
- Phase acceptance: migrations up成功；decimal／rounding／state proof；provider consumer tests；50-way Claim／sequence／lock proof；銀行遮蔽及operation recovery smoke。
- Required verification: TC-001～TC-020、security regression、server/client lint/test/build、coverage及真MySQL suite。
- PR strategy: `codex/invoicing-ar-p1-foundation`單一PR；provider如由不同owner交付，可先以additive prerequisite PR合併，AR PR不得帶fake。
- Rollback: 關閉flags及回退application；不down已寫business資料；只在空schema且批准時回退migration。
- Exit: 全Task DONE、Gate evidence齊全、無open S1/S2、traceability更新、PR review通過及safe to merge。
- Status: PLANNED

| Task | Goal | Requirements / Design | Scope and implementation approach | Dependencies | Acceptance / Verification | Migration / rollback | Risk / DoD / Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | 鎖定Provider readiness及contracts | FR-011, FR-052, FR-071, FR-099～FR-107；DES-020 | 在Sales／Fulfillment／Customer／Currency建立transaction-aware interfaces、version handshake及consumer fixtures；UNKNOWN fail closed。 | 上游owner及最新main | Contract完整／缺欄／wrong owner/version／UNKNOWN測試；TC-001～003。 | Additive interface；可安全revert consumer registration。 | HIGH；DoD=正式provider＋owner＋tests，無stub；PLANNED。 |
| TASK-002 | 建立permissions、config及flags | FR-001～FR-010；SEC-001～003；DES-021 | Permission catalogue/seed加入AR獨立權限；normalize limits、lease、file、archive及flags，startup fail-fast。 | TASK-001 contract names | Permission convention、invalid config及flag-off route tests；TC-004。 | 新seed forward-only；revert只關flag。 | MEDIUM；DoD=最小權限及System Admin無隱含授權；PLANNED。 |
| TASK-003 | 實作Money、date、state及payload純規則 | FR-022～038、FR-059～107；DES-002～003、DES-009 | Decimal-string arithmetic、4位round、pack/base remainder、close/as-of date、all transitions、canonical hash。 | 無 | Property／boundary unit tests；TC-005～008。 | 無資料變更。 | HIGH；DoD=禁止JS float、所有合法/非法transition有測試；PLANNED。 |
| TASK-004 | 建立Settings、Bank及Sequence schema/service | FR-001～010；DES-006、DES-010、DES-022 | 建表、AES-GCM、default scope、prefix generation、close-date monotonic CAS、history及API。 | TASK-002～003 | 真MySQL unique／concurrency、crypto vector、mask、reauth；TC-009～011。 | Logical migration slice 1；已用sequence不可回退。 | HIGH；DoD=同年/回切prefix不重號；PLANNED。 |
| TASK-005 | 建立Operation、Audit及transaction context | FR-053～055、FR-130～132；DES-005、DES-008、DES-017 | operation/event/hash/lease、fixed lock helper、audit builder/redaction及outcome endpoint。 | TASK-002～003 | same/different hash、lease race、commit unknown、redaction；TC-012～014。 | Operation至少7年，不purge。 | HIGH；DoD=recovery可收斂且無敏感log；PLANNED。 |
| TASK-006 | 建立Invoice／Claim／Source core schema | FR-018～024、FR-035～038；DES-004、DES-007、DES-009 | invoices/lines/sources/claims/registry/history/snapshot/ledger/balance tables、FK、generated unique及triggers。 | TASK-003～005 | Migration/FK/immutable/dual claim/source amount tests；TC-015～017。 | Logical slice 2；feature off；不destructive down。 | HIGH；DoD=真MySQL quantity/source proof；PLANNED。 |
| TASK-007 | 建立Source及Exposure provider services | FR-037～038、FR-099～107；DES-009、DES-014、DES-020 | lock Sales allocations、Fulfillment line set、classification event及Exposure UNKNOWN projection。 | TASK-001、006 | SO split remainder、classification before/after相同總exposure、provider failure；TC-018～019。 | Additive provider state；disable consumer on rollback。 | HIGH；DoD=不雙計、不複製上游規則；PLANNED。 |
| TASK-008 | Phase 1 Gate及migration proof | 全Phase 1；DES-001～025適用項 | 執行完整lint/tests/build/audit、真MySQL barrier、migration fresh/upgrade、EXPLAIN baseline；更新docs。 | TASK-001～007 | TC-001～020全Pass，coverage不降低，證據可重現。 | 僅驗證，不新增feature。 | HIGH；DoD=review-ready PR及Gate report；PLANNED。 |

## PHASE-002 — Invoiceable Workbench and Invoicing

- Objective / checkpoint outcome: Finance可由完整Shipment或Manual方式建立Draft，單張／批量正式確認、Void、列印及追溯；不重複開票。
- Requirements: FR-011～FR-058、FR-120～FR-125、FR-130～FR-132及相關SEC/NFR。
- Design: DES-003～DES-010、DES-016～DES-021、DES-024。
- Dependencies: PHASE-001 merged；Sales/Fulfillment provider versions green。
- Entry criteria: feature flags off；P1 migration／contract evidence approved。
- Included tasks: TASK-009～TASK-017。
- Integration impact: Invoice write/read APIs、UI、PDF、batch/recovery及Fulfillment downstream status。
- Phase acceptance: Workbench→claim→Draft→ISSUED/Void完整；10k batch group隔離；100-line atomic；A4可用；idempotent recovery。
- Verification: TC-021～TC-045、UAT-001～UAT-030及P1 high-risk regression。
- PR strategy: `codex/invoicing-ar-p2-invoicing`一PR，flag先off；merge後按角色小量開啟。
- Rollback: 關閉invoice mutation flag；保留已ISSUED資料、recovery及read routes。
- Status: PLANNED

| Task | Goal | Requirements / Design | Scope and implementation approach | Dependencies | Acceptance / Verification | Migration / rollback | Risk / DoD / Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-009 | Workbench query及preview API | FR-011～017；DES-004、019～020 | Fulfillment bounded query、registry anti-join、filters、group compatibility及preview reasons。 | P1 providers/schema | Eligibility/filter/group/query plan；TC-021～023。 | 無destructive change。 | MEDIUM；DoD=p95與無N+1 evidence；PLANNED。 |
| TASK-010 | Shipment Draft及atomic claims | FR-018～024；DES-004、008～010 | lock完整Shipment set、source amount allocation、create Invoice/lines/sources/claims；全有或全無。 | TASK-009 | 雙人競爭、partial line拒絕、retry；TC-024～026。 | 若加index只additive；cancel release。 | HIGH；DoD=0 duplicate/partial draft；PLANNED。 |
| TASK-011 | Draft detail/update/cancel | FR-025～036；DES-003、010、021 | versioned allowlist、billing/contact/payment/date、price override、zero warning、cancel release。 | TASK-010 | CAS、permission、provider version、validation；TC-027～029。 | 無正式資料修改。 | HIGH；DoD=正式欄位不可被update；PLANNED。 |
| TASK-012 | Manual Invoice vertical slice | FR-039～045；DES-002～003、010、021 | Active Customer lookup、reason/free lines/optional SKU、shared Draft/confirm path且無Sales/Inventory side effect。 | TASK-011 | blocked customer、optional SKU、same rules；TC-030～031。 | 無上游寫入；flag獨立。 | MEDIUM；DoD=MANUAL清晰且無偽source；PLANNED。 |
| TASK-013 | Invoice Confirm Phase A/B及Recovery | FR-046、FR-052～056；DES-005～010 | durable intent、locks、fresh providers、sequence、ISSUED、ledger/balance/classification/snapshot/audit及worker。 | TASK-010～012 | atomic、double click、timeout/crash/commit unknown；TC-032～036。 | 已取號/issued不可rollback刪除。 | CRITICAL；DoD=所有failure point收斂唯一結果；PLANNED。 |
| TASK-014 | Batch create/confirm workers | FR-046～051；DES-005、019 | materialized source set、group item isolation、lease/resume、counts及error result。 | TASK-013 | 10k/30m、one bad group、crash resume；TC-037～039。 | 停worker不丟job；保留已成功。 | HIGH；DoD=count守恆及無重複；PLANNED。 |
| TASK-015 | Invoice Void及Fulfillment guard | FR-057～058、FR-071；DES-005、008、020～021 | reauth、open period/no downstream links、reverse ledger/classification、release source registry、guard projection。 | TASK-013 | linked credit/receipt拒絕、retry、source reappears；TC-040～041。 | Void是forward event，不delete。 | HIGH；DoD=原號/快照保留；PLANNED。 |
| TASK-016 | Workbench/Invoice UI及A4/PDF | FR-011～058、FR-120～125；DES-016、024 | routes/pages/forms/source trace/polling/allowed actions/print/PDF；共用components及accessibility。 | TASK-009～015 | Vue、route、keyboard、375–1440px、visual/print、XSS；TC-042～044。 | UI可feature-off；files私有。 | MEDIUM；DoD=無client-only auth；PLANNED。 |
| TASK-017 | Phase 2 Gate | 全Phase 2 | 完整回歸、provider contract、security、performance、UAT evidence及docs更新。 | TASK-009～016 | TC-021～045＋P1 P0 tests；UAT-001～030。 | 只在Gate後開flag。 | HIGH；DoD=PR reviewed/safe-to-merge；PLANNED。 |

## PHASE-003 — Credit、Receipt and Settlement

- Objective / checkpoint outcome: 正式AR可用Credit及Receipt準確結清，支援Credit Balance、部分／多單核銷、重配、Void／Reversal及Shipment解除證據。
- Requirements: FR-059～FR-085、FR-086～FR-098相關查詢、SEC/NFR。
- Design: DES-003、DES-005～DES-008、DES-011～DES-013、DES-017、DES-021～DES-024。
- Dependencies: PHASE-002 merged及Invoice正式資料模型穩定。
- Included tasks: TASK-018～TASK-024。
- Phase acceptance: 所有credit/receipt守恆、並發不超額、Reversal全有或全無、As-of history正確。
- Verification: TC-046～TC-068、UAT-031～UAT-056及P1/P2核心回歸。
- PR strategy: `codex/invoicing-ar-p3-settlement`一PR；Credit及Receipt flags可分開啟用但同Phase測試後合併。
- Rollback: 關閉新mutation；保留ledger及recovery；不delete正式Credit／Receipt。
- Status: PLANNED

| Task | Goal | Requirements / Design | Scope and implementation approach | Dependencies | Acceptance / Verification | Migration / rollback | Risk / DoD / Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-018 | Credit schema及Draft | FR-059～063；DES-011 | Credit roots/lines/source allocation、original line selection、reason/date/version及UI/API。 | P2 Invoice source | composite ownership、cumulative availability；TC-046～048。 | Logical slice 3 additive。 | HIGH；DoD=不能任意customer/line；PLANNED。 |
| TASK-019 | Credit Confirm及Balance | FR-064～068；DES-005～008、011 | Phase A/B、origin reduction、excess balance、ledger/projection/sequence/recovery。 | TASK-018 | barrier超額、partial paid、commit unknown；TC-049～052。 | Formal credit forward-only。 | CRITICAL；DoD=無負outstanding/available；PLANNED。 |
| TASK-020 | Credit apply/unapply/void及guard | FR-066～071；DES-011、020～021 | same customer/currency locks、history、void preconditions、Shipment source full-credit guard。 | TASK-019 | cross-owner拒絕、reapply、local Shipment mapping；TC-053～055。 | 不deleteapplications。 | HIGH；DoD=guard CLEAR/BLOCKED/UNKNOWN正確；PLANNED。 |
| TASK-021 | Receipt schema、Draft及Confirm | FR-072～079；DES-005～008、012、022 | method validation、bank snapshot、sequence、ledger/available balance及recovery。 | P1 settings/ledger | method matrix、date/close、double confirm；TC-056～058。 | Logical slice 4 additive。 | CRITICAL；DoD=amount=allocated+available；PLANNED。 |
| TASK-022 | Allocation/unapply/reallocate | FR-075～080、FR-083、FR-085；DES-008、012 | multi-invoice set transaction、due-date suggestion、fresh locks及event history。 | TASK-021 | 50-way barrier、all-or-nothing reallocate、same currency；TC-059～062。 | Forward events only。 | CRITICAL；DoD=never overallocate；PLANNED。 |
| TASK-023 | Receipt Reversal及As-of | FR-081～084、FR-098；DES-005、007、012～013 | full reversal intent、all allocations反向、available歸零、effect-date ledger、recovery及UI confirmation。 | TASK-022 | failure injection、prior/current statement、retry；TC-063～066。 | Reversal不刪原Receipt。 | CRITICAL；DoD=無部分恢復；PLANNED。 |
| TASK-024 | Phase 3 Gate | 全Phase 3 | Settlement UI/API/security/DB/concurrency/recovery/UAT及reconciliation regression。 | TASK-018～023 | TC-046～068＋prior P0；UAT-031～056。 | Gate後才開flags。 | HIGH；DoD=review-ready PR；PLANNED。 |

## PHASE-004 — Inquiry、Exposure、Opening、Archive and Release Evidence

- Objective / checkpoint outcome: 高容量AR查詢、信用判斷、期初遷移、文件／匯出、獨立財務歸檔、對賬、監控及復原證據完整。
- Requirements: FR-086～FR-143、NFR-001～010、SEC-001～015。
- Design: DES-007、DES-013～DES-025。
- Dependencies: PHASE-003 merged；已批准RTO/RPO及retention targets。
- Included tasks: TASK-025～TASK-032。
- Phase acceptance: Account/Aging/Statement一致、Exposure不雙計、Opening安全可恢復、Archive hash/routing/restore及容量門檻達標。
- Verification: TC-069～TC-100、UAT-057～UAT-090、全部P0回歸及release evidence。
- PR strategy: `codex/invoicing-ar-p4-release`一PR；Purge與Archive schedule通過TC-092、TC-099～100前保持off。
- Rollback: disable workers/routes；已archive成功aggregate不搬回Active，以routing保持read並forward repair。
- Status: PLANNED

| Task | Goal | Requirements / Design | Scope and implementation approach | Dependencies | Acceptance / Verification | Migration / rollback | Risk / DoD / Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-025 | Customer Account/Outstanding/Aging/Statement | FR-086～098；DES-007、013、018 | 共用AsOfProjection、active/archive range routing、PDF/CSV口徑、UI views。 | P3 ledger | same as-of一致、multi-currency、overdue boundary；TC-069～073。 | Query-only；可關archive branch。 | HIGH；DoD=ledger/projection reconcile；PLANNED。 |
| TASK-026 | Credit Exposure provider | FR-099～107；DES-014、020 | AR balance＋Sales commitment、classification event、status/versions、Sales projection。 | TASK-007、P3 | before/after invariant、Hold/Warning/Unknown；TC-074～076。 | Provider flag rollback。 | CRITICAL；DoD=never assume zero；PLANNED。 |
| TASK-027 | Opening Import | FR-108～119；DES-005、015～017、019 | template/upload/precheck/document jobs/confirm/results/private files/recovery UI。 | P3 financial flows | mixed docs、same/different hash、formula、crash；TC-077～082。 | Logical slice 5；confirmed data forward-correct only。 | HIGH；DoD=precheck無side effect；PLANNED。 |
| TASK-028 | Documents、Export及Audit inquiry | FR-120～132；DES-016～017、019、021～024 | PDF/CSV jobs、owner-safe download、audit UI、7日expiry、injection controls。 | TASK-025、027 | permission/expiry/filter/hash/accessibility；TC-083～087。 | Purge先dry-run，TC通過後啟用。 | HIGH；DoD=無敏感洩漏；PLANNED。 |
| TASK-029 | Archive schema/service/query | FR-133～143；DES-018～020、023 | mirrors、manifest、eligibility、copy/hash/routing/delete、cross-tier read及UI。 | P3 terminal rules | interruption each step、same/different hash、unique routing；TC-088～092。 | Logical slice 6；schedule off by default。 | CRITICAL；DoD=0 loss/duplicate；PLANNED。 |
| TASK-030 | Reconciliation、metrics、alerts及runbooks | FR-132、FR-138～143；DES-017、023、025 | source/ledger/balance/exposure/routing checks、structured telemetry及operational docs。 | TASK-025～029 | seeded mismatch detection、no auto mutation、alert/runbook drill；TC-093～095。 | Observability additive。 | HIGH；DoD=forward repair process documented；PLANNED。 |
| TASK-031 | Capacity、security及DR evidence | NFR-001～010、SEC-001～015；DES-016、019、021～025 | 7.3m dataset、50 users、10k/30m batch、100-line、IDOR/crypto/files、backup restore及approved RTO/RPO。 | TASK-025～030 | TC-096～100；all thresholds/evidence。 | No prod purge/archive until tests pass。 | HIGH；DoD=production-like signed report；PLANNED。 |
| TASK-032 | Final UAT／release Gate | 全requirements | 執行全UAT、P0 regression、traceability validator、design drift review、cutover/rollback rehearsal及PR review。 | TASK-025～031 | UAT-057～090＋全P0；0 open S1/S2；all Must covered。 | Flags staged；rollback drill evidence。 | HIGH；DoD=approved/safe-to-merge release PR；PLANNED。 |

## Shared Hotspots and Parallelism

- `permissionCatalogue.js`、config、scheduler、DB migrations、Sales/Fulfillment providers及shared frontend error mapping是shared hotspots；同一Phase只指定一個owner合併。
- Pure rules、UI component tests及provider fixtures可並行；schema／contract定案前不可平行實作dependent services。
- TASK-013、019、021～023、026、029是critical transaction tasks，不應由多個未協調分支同時修改ledger／balance repositories。
- 每2～3個critical tasks建立intermediate checkpoint，但只有Phase Gate可宣稱獨立可合併。

## Out-of-Scope Guard

任何Task若需要Tax、GL、FX、bank feed reconciliation、Refund、Return、Email或多公司，必須停止並回Requirement Gate；不得以「未來擴展」在本Phase預建production schema／UI。

## Mechanical Requirement Coverage

Functional: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140, FR-141, FR-142, FR-143.

Non-functional/Security: NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010; SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015.

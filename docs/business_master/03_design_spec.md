# Business Master（Currency／Payment Term）系統設計

Relationship authority 是 `08_traceability.json`；module/data/API boundary 是
`00_module_manifest.json`。本文定義 Business Master v1 provider 及管理契約。

## Scope, goals, constraints and requirement baseline

設計沿用現有 modular monolith：Node.js ES modules、Express `BaseRequestHandler`、AJV strict
request/response schema、MySQL `withTransaction()`、JWT/permission catalogue、Vue 3、Quasar 2、
page/service discovery 與現有 UI framework。Business Master 是 Currency／Payment Term schema、
lifecycle、audit、management API/UI 及 provider 的唯一 owner；consumer 不可另建 shadow tables。

確認約束：ISO 4217 only、production 只 seed HKD、Payment Term 不 seed、四種計算 type、停用但不刪除、
transaction snapshot 不回寫、兩個管理 permissions。FX、會計與交易執行不在模組內。

```text
Admin UI -> Business Master handlers -> BusinessMasterAdminService
                                      -> Currency/PaymentTerm repositories
                                      -> ImpactRegistry -> consumer reference checkers
Consumer handler (own permission) -> BusinessMasterLookupService
                                  -> same MySQL connection for confirm-time checks
MySQL: currencies | payment_terms | business_master_audit_logs
Platform: JWT/permission | MySqlDatabaseService | IdempotencyService | logging/time
```

## Architecture and component responsibilities

| Component | Responsibility |
| --- | --- |
| `BusinessMasterAdminService` | Create/update/activate/deactivate、CAS、idempotency、transaction/audit |
| `BusinessMasterLookupService` | Active selector、history projection、transaction-aware asserts、due calculation |
| `businessMasterValidation.js` | ISO/code/text/type/date/conditional validation；pure deterministic helpers |
| `BusinessMasterImpactRegistry` | 註冊 required consumer checkers、canonical impact summary/token、unknown fail closed |
| handlers + schemas | `/api/v1/business-master/**` 管理契約、AJV boundary、stable errors |
| frontend pages/services | Currency、Payment Term、impact confirmation、audit links及可恢復 UI states |
| migrations/readiness | sole schema、HKD、permissions、shape/provider startup checks |

## DES-001 — 單一 owner 的模組邊界

### Decision
Business Master 獨立擁有 `currencies`、`payment_terms`、`business_master_audit_logs`、ISO snapshot、
管理 handler/service 及 lookup provider。Customer、Supplier、Sales、Purchasing、AR/AP 只讀、驗證及保存
FK/snapshot；其 consumer-facing selector endpoint 由各 consumer handler 以自身 permission 授權。

### Rationale
同一 modular monolith 可透過 injected service 與 caller connection 保持單一真相及 transaction consistency，
也避免一個 generic HTTP lookup handler硬編所有未來 consumer roles。拒絕每模組各自建 catalog 或跨模組直接寫表。

### Failure behavior
provider/schema 未 READY 時 consumer fail closed，不能建立自由文字 fallback、production fake 或影子 table。

## DES-002 — Canonical relational data model

### Decision
`currencies`：`code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin PK`、`name VARCHAR(100)`、
`decimal_places TINYINT UNSIGNED`、`status VARCHAR(20) ASCII`、`version INT UNSIGNED`、created/updated
epoch-ms 與 actor FK users SET NULL；index `(status,name,code)`。

`payment_terms`：`id BIGINT UNSIGNED AUTO_INCREMENT PK`、`code VARCHAR(50)`、`code_key VARCHAR(50)
utf8mb4_bin UNIQUE`、`name VARCHAR(100)`、`description VARCHAR(500)`、`calculation_type VARCHAR(30) ASCII`、
`due_days SMALLINT UNSIGNED NULL`、status/version/timestamps/actors；index `(status,name,id)`。

`business_master_audit_logs`：id、entity_type、entity_key、action、`result=SUCCESS|REJECTED`、before_json、after_json、impact_json、reason、
actor_user_id SET NULL、correlation_id、idempotency_key_hash、created_at；indexes `(entity_type,entity_key,created_at,id)`、
`(actor_user_id,created_at,id)`、`(action,created_at,id)`。JSON 只保存 allowlisted catalog fields。

### Rationale
Currency code 本身是穩定 ISO identity；Payment Term 使用 surrogate id 作 FK identity，code 同樣建立後不可修改，避免 CSV、
外部整合與人工溝通引用漂移。binary normalized key 提供跨 collation 一致唯一性；status 用 service allowlist 而非 DB ENUM 方便 forward migration。

### Failure behavior
FK 全部 RESTRICT catalog delete；MySQL 5.7 無法可靠表達的 conditional CHECK 由 service validation 加 true-MySQL tests
保護。不相容既有 table 由 migration shape guard 中止，不做部分 ALTER。

## DES-003 — ISO snapshot、normalization 與 validation

### Decision
repository 內受控 `iso4217Snapshot.js` 保存 runtime validation 所需的 active legal-tender code、來源標識及 snapshot date；
English name/minor unit 留在來源與 provenance 記錄，不覆寫管理 catalog。create/update 在 service boundary 使用 snapshot 驗證 official active code。
Currency code 不做自動 uppercase：trim 後必須已是 `[A-Z]{3}` 且存在，
避免使用者誤認輸入被更正。Payment Term code 使用 NFKC + trim + Unicode case-fold 形成 codeKey；所有 text 有 length limit，
只作 plain text output。

### Rationale
只檢查三個字母不能滿足 ISO-only；runtime call 外部標準站會引入 availability/TOCTOU。版本化 snapshot 令結果可重現，更新
snapshot 是受 review 的 additive maintenance change。拒絕把 ISO name 強制覆寫管理員 display name，因 display name 是業務文案。

### Failure behavior
snapshot 缺失、duplicate code、格式不符或 requested code 不存在時 startup/write fail closed。snapshot 更新不可自動停用現有
Currency；退役 code 的處置需新設計決策及 forward migration。

## DES-004 — Pure Payment Term calculator

### Decision
`calculateDueDate(termSnapshot, baseDate)` 是無 I/O pure function，使用 calendar date parser 而非 JavaScript local-time Date。
IMMEDIATE 回原日；NET_DAYS 以 UTC/calendar arithmetic 加 0–3650 日；END_OF_MONTH 用 Gregorian calendar 最後一日；
MANUAL 回 `{dueDate:null, requiresManualDueDate:true}`。輸出同時包含 term id/code/name/version/type/dueDays/baseDate。

### Rationale
把算法集中可讓 AR/AP/Sales/Purchasing 對同一快照得到相同結果，避免 timezone/DST 漂移。COD 是 business code/name，
若按交貨日計算由 caller 明確傳 delivery date；不增加依賴 logistics 的 type。

### Failure behavior
非法日期、Inactive term 用於新交易、expected version 不符或 invalid rule 拒絕；history snapshot 可用 pure calculator replay，
但不能偷偷用目前 term 代替交易 snapshot。

## DES-005 — Lifecycle、impact preview 與狀態機

### Decision
狀態只有 `ACTIVE <-> INACTIVE`。Currency 一般 PATCH 只接受 name；Payment Term 一般 PATCH 只接受
name/description。activate/deactivate 是獨立 lifecycle command；deactivate、Currency change-precision 與
Payment Term change-rule 是需 impact confirmation 的高影響 command。執行前 registry 依序執行已註冊 Customer、Supplier、Sales、Purchasing、AR/AP reference
checkers，回 active-default、open/new-use、historical count、checker status/watermark。
`impactToken=SHA-256(canonical entity identity + catalog version + operation + canonical proposed change + sorted checker results/watermarks)`；
確認時重新計算且 exact match、同 actor、五分鐘內有效，任一 required checker `UNKNOWN/ERROR` 即拒絕。

### Rationale
允許停用符合人類決定，但必須讓管理員知道 operational blast radius；stateless canonical token 不需要新增 secret/table，fresh
recompute 消除 client tampering/stale count。Missing consumer table 只有在該 module readiness 明確 `NOT_INSTALLED` 時算 known zero。

### Failure behavior
競爭 update、checker timeout、module readiness unknown、過期 token、actor mismatch 或 impact drift 回 409/503，無狀態/audit success
mutation。停用已成功的 retry 由 idempotency replay原結果；不得再執行 checkers 當作第二次命令。

## DES-006 — Transaction-aware provider 與 consistency

### Decision
`BusinessMasterLookupService` 提供 `listActiveCurrencies()`、`listActivePaymentTerms()`、history getters、
`assertCurrencyUsableInTransaction(connection, code, {purpose,expectedVersion})`、
`assertPaymentTermUsableInTransaction(connection,id,{purpose,expectedVersion})`、
`calculateDueDateInTransaction(...)`。confirm-time methods 使用 caller connection 及一致 lock order（Currency code，再 Payment Term id），
回 immutable allowlisted snapshot；非 transaction wrappers 只供 selector/draft preflight。

### Rationale
同 DB transaction 內 revalidation 才能避免 selector/read 與交易 write 之間停用或改 rule。固定 lock order減少 consumer 與 admin
deadlock；snapshot 令未來主資料變更不重寫既有正式交易。

### Failure behavior
沒有 connection TypeError；lock timeout/deadlock 由 caller transaction rollback並回可重試 conflict，不在 provider 內自動 retry
整個業務命令。purpose unknown 或 projection request 超出 allowlist 立即拒絕。

## DES-007 — REST API、error、CAS 與 idempotency

### Decision
管理 API：

| Method/path | Permission | Contract |
| --- | --- | --- |
| `GET /api/v1/business-master/currencies` | view | q/status/page/pageSize/sort；管理 projection |
| `POST /api/v1/business-master/currencies` | mgmt | create；Idempotency-Key |
| `GET/PATCH /api/v1/business-master/currencies/:code` | view/mgmt | detail／只修改 name + version；code immutable |
| `POST .../:code/impact-preview` | mgmt | operation/proposed payload；current canonical impact |
| `POST .../:code/activate\|deactivate` | mgmt | version/reason；deactivate另帶 token；Idempotency-Key |
| `POST .../:code/change-precision` | mgmt | decimalPlaces/version/reason/impactToken；Idempotency-Key |
| `GET/POST /api/v1/business-master/payment-terms` | view/mgmt | list/create |
| `GET/PATCH .../payment-terms/:id` | view/mgmt | detail／只修改 name/description + version |
| `POST .../:id/impact-preview\|activate\|deactivate` | mgmt | 同 Currency lifecycle |
| `POST .../:id/change-rule` | mgmt | calculationType/dueDays/version/reason/impactToken；Idempotency-Key |
| `POST .../payment-terms/:id/calculate` | view | baseDate、expectedVersion；preview only |
| `GET /api/v1/business-master/audit` | view | allowlisted filters/pagination |

所有 schema `additionalProperties:false`；request/response camelCase、enum UPPER_SNAKE。Error shape 沿用 framework，codes 包括
`CURRENCY_CODE_INVALID/CURRENCY_PRECISION_INVALID/CURRENCY_NAME_INVALID/CURRENCY_NOT_FOUND/CURRENCY_NOT_ACTIVE`、
`PAYMENT_TERM_CODE_INVALID/PAYMENT_TERM_NAME_INVALID/PAYMENT_TERM_DESCRIPTION_INVALID/PAYMENT_TERM_NOT_FOUND/PAYMENT_TERM_NOT_ACTIVE`、
`PAYMENT_TERM_RULE_INVALID`、`VERSION_CONFLICT`、`IMPACT_TOKEN_INVALID/IMPACT_TOKEN_EXPIRED/IMPACT_CHANGED/IMPACT_CHECK_UNAVAILABLE`、
`IDEMPOTENCY_CONFLICT`。POST/PATCH/commands 都使用現有 MySQL IdempotencyService；同 key 不同 payload及 in-flight 均回 409，
並以 error code 區分 `IDEMPOTENCY_CONFLICT` 與 `IDEMPOTENCY_IN_PROGRESS`。

### Rationale
resource-oriented endpoints、strict schemas、stable errors、pagination及 idempotent mutation 令 UI/consumer 安全重試；狀態、精度與
計算規則 command 分離，避免一般 PATCH 繞過高影響確認。

### Failure behavior
timeout 結果不明時 client 以相同 Idempotency-Key 重試／查回；transaction commit 後回應中斷仍 replay原 response。Internal errors
500 不暴露 SQL/stack；401/403/404/409/503 語意固定。

## DES-008 — Authentication、authorization、audit 與 threat controls

### Decision
handlers 明確 require JWT 及 permission；system-admin seed 取得 view/mgmt，其他 role 明確授予。Admin mutation 在 transaction 開始及
commit point 前 fresh authorization；audit 與 mutation atomic。所有 SQL parameterized、sort allowlist、output schema、Vue escaping、
reason/description 不入 executable HTML。STRIDE重點為 forged actor/token、catalog tampering、高影響操作 repudiation、permission leakage、
unbounded search與 privilege escalation。

### Rationale
主資料不是 PII，但它影響所有新交易，完整 access control、non-repudiation 與 availability 是高風險邊界。client menu guard 只改善 UX，
不構成安全控制。

### Failure behavior
authorization、audit 或 required impact checker unavailable 時 fail closed；可預期的高風險拒絕在 catalog transaction rollback 後，以獨立 audit transaction 記錄 `result=REJECTED` 且不保存 token/request body；log redaction failure/credential exposure 為 blocking security
defect。Rate/request limits 沿用 platform，模組不自行放寬。

## DES-009 — 管理 UI 與 interaction design

### Decision
在 `system` menu 下新增「Business Master」，包含 Currency 與 Payment Term 兩頁。每頁使用 PageHeader、server-mode DataTable、
EllipsisCell、status badge text、URL-backed filter/page/sort、FormPanel create/edit dialog。Payment Term form 依 type conditional 顯示 dueDays
及 live deterministic preview；Currency code create 後 readonly。高影響 dialog 顯示 operation、建議前後語意差異、每個 consumer
count/status、reason、明確 entity code/name，unknown 時禁用確認；Currency/Payment Term code建立後 readonly；409 重新載入並保留
未提交文字。Audit 以 filtered link 開現有/模組 audit view。

### Rationale
遵守既有 Vue/Quasar design system，避免新 UI abstraction；把風險資訊放在 action point，而不是藏在設定說明。實際中文錯誤由
`errorMessages.js` 統一 mapping。

### Failure behavior
loading、empty、slow、network error、400、403、404、409、503 各有可重試/重新載入狀態；dialog focus trap/return、error summary focus、
鍵盤與 screen reader label 必須可用。窄畫面操作欄 sticky，不截掉 impact details。

## DES-010 — Observability、performance、availability 與 capacity

### Decision
結構化 log/metrics 使用 correlationId/entity type/action/result/duration，不記 body/token。Metrics：admin/lookup/calculate latency與 error rate、
version conflict、idempotency replay、impact checker duration/status、readiness、active catalog counts。Slow query log/plan驗證索引；list pageSize
沿用 app 10/20/50/100。Alert 針對 readiness fail、required checker persistent failure、mutation/audit rollback及 p95/error-rate breach。

### Rationale
Business Master 是多模組共享依賴；fail closed 需要可觀察原因，且標準 query 必須在 10k rows/100 concurrency 下有界。沒有 queue/cache，
避免 invalidation 複雜度；MySQL 是單一真相。

### Failure behavior
metrics/logger failure依 platform failure visibility處理，不吞掉 mutation failure；DB unavailable 503/readiness fail，client 不 cache Inactive 值作
new use。RTO/RPO 由共同 MySQL HA/backup runbook承擔。

## DES-011 — Migration、seed、cutover、rollback 與 recovery

### Decision
implementation 以當時最新 main 的下一個序號 `0027` 建立/compatibility-check tables、兩 permissions、system-admin mapping、HKD seed。
Migration 可重跑及從 half-applied state恢復；已套用檔 immutable。若 Customer 舊 migration 已建立相容 tables，shape guard採用並補缺的 index/
audit/permissions；若不相容，停止並以新 forward compatibility migration修正，不 drop/recreate。部署順序：schema/permissions/HKD -> provider/readiness
-> admin API -> UI -> consumer switch/regression。Production `server/src/index.js` 明確註冊 eager provider/readiness service；通用 application factory
不隱含特定模組 schema。Rollback 為關閉新入口/回退 app code；schema 保留，往前修。

### Rationale
全域 migration sequence 是共享資源，不能在設計時預留 `0027`。兼容採用既有 table 可避免資料遺失與多 owner；production Payment Term 不 seed。

### Failure behavior
任何 shape/HKD/permission/readiness mismatch 中止 startup/deploy；不 hard reset schema、不刪 production data。backup/restore 必須以相同 recovery point
包含 catalog/audit並核對 RTO≤4h、RPO≤15m。

## DES-012 — Versioned consumer contract 與相容性治理

### Decision
提供 `business-master-currency-payment-term-provider/v1`：Currency `{code,name,decimalPlaces,status,version}`；Payment Term
`{id,code,name,calculationType,dueDays,status,version}`；description 為管理文案，不進最小 consumer projection。calculation output含
snapshot/baseDate/dueDate/manual flag。契約為 additive single version，
consumer contract suites覆蓋 Customer、Supplier、Sales、Purchasing、AR。舊 Supplier planned generic HTTP lookup改為其 own-permission handler + internal provider，
不得同時維護兩個真相 endpoint。

### Rationale
owner module 定義正式 contract；consumer docs 是需求證據但不能反向擁有 schema。單一版本降低 diamond contract，snapshot/expectedVersion 提供可演進語意。

### Failure behavior
任一 required consumer contract test 未執行、provider readiness unknown 或 breaking diff 無 migration/approval 時 NOT_READY。未安裝 consumer可標明
NOT_INSTALLED，但其 contract test fixture仍要驗證 provider shape。

## Detailed cross-cutting design

### Transaction、concurrency、idempotency

Create/Update/Activate/Deactivate/ChangePrecision/ChangeRule 每個 command 在一個 catalog MySQL transaction 完成 locked current row、fresh authorization、validation、
CAS mutation與audit；現有 framework IdempotencyService 在 handler 外層另行 claim/complete/fail，成功但response無法保存時標記 result unavailable。
Impact preview不鎖跨模組資料；confirm時重新計算 token。全域 lock order：idempotency operation -> catalog row
（Currency code先於Payment Term id）-> consumer checker自己的只讀順序 -> audit。checker 不得寫 consumer data。

### API projection and examples

```json
{
  "id": 42,
  "code": "NET30",
  "name": "月結 30 天",
  "description": "由基準日期起計三十個曆日",
  "calculationType": "NET_DAYS",
  "dueDays": 30,
  "status": "ACTIVE",
  "version": 3
}
```

```json
{
  "term": {"id": 42, "code": "NET30", "version": 3, "calculationType": "NET_DAYS", "dueDays": 30},
  "baseDate": "2026-01-31",
  "dueDate": "2026-03-02",
  "requiresManualDueDate": false
}
```

### Failure/degraded modes

- DB/readiness unavailable：503、health degraded、無 local stale fallback。
- Required impact checker unavailable：preview/confirm fail closed；一般 read不受影響。
- Consumer table未部署：只有經 readiness證明 NOT_INSTALLED 才 known zero。
- Commit response lost：相同 Idempotency-Key replay；不同 payload拒絕。
- Concurrent edit/deactivate：一個 version勝出，其餘409重載；不 lost update/double audit。
- ISO snapshot update：另開 reviewed change，不 retroactive 停用現有 row。

### Deployment/configuration and operations

不新增 runtime secret、external service、queue或 cache。沿用 DB/JWT/time/request limiter/logging config。Startup self-check輸出 provider version、schema hash、HKD、
active counts及 checker registry；不輸出 catalog full data。Operations runbook涵蓋 readiness、failed impact checker、inactive default remediation、backup/restore、
forward migration及 consumer compatibility dashboard。

### Trade-offs and rejected alternatives

- 拒絕 generic key/value catalog：Currency 與 Payment Term 有不同 identity/validation/calculation contract。
- 拒絕 runtime ISO API：外部 failure、變更與非重現性不值得；用 reviewed snapshot。
- 拒絕 hard block referenced deactivation：違反已確認業務決定；用 impact + fail-closed confirmation。
- Stateless SHA-256 impact token 是 canonical preview/重算的一致性憑證，不是授權 MAC；持有 mgmt 權限的 caller 本來即可取得 preview，
  真正安全邊界仍是 fresh authorization、catalog version、五分鐘 TTL、checker recompute 與 audit。首版因此不新增跨 instance signing secret。
- 拒絕 permanent delete：破壞 FK/history/audit。
- 拒絕 event-driven/cache：現階段同 DB modular monolith，直接 transaction provider較簡單可靠。
- 拒絕 approval workflow/import/export：未要求，增加不必要 scope。

## Assumptions, open issues and human decisions

- Minor assumption：impact preview有效五分鐘；可在 implementation 前依已存在 platform timeout convention作低風險調整，但不得移除 fresh recompute。
- Established contract：Currency 與 Payment Term code 均為 stable、create 後 immutable；Payment Term FK identity仍使用 id，交易保存code/name/rule snapshot。
- Major decisions HD-001～HD-010 已記錄於 `02_requirement_review.md`。
- OPEN：需要真實獨立 reviewer 及 Product Owner 對完成後 exact DESIGN/PLAN hashes 批准；self-review 不冒充 independence。

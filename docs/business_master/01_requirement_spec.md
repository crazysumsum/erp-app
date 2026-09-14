# Business Master（Currency／Payment Term）需求規格

Module、資料與契約權威見 `00_module_manifest.json`；typed 關係與 UAT 適用性以
`08_traceability.json` 為準。本文是 Business Master 的業務意圖權威。

## Context, business outcome, scope and actors

Business Master 是 Currency 與 Payment Term 的唯一寫入 owner，解除 Customer、
Supplier、Sales、Purchasing、AR／AP 各自建立影子 catalog 的風險。管理員可維護、
查詢、啟用及停用主資料；各業務模組只取得其用途所需的 lookup、交易內有效性驗證、
Due Date 計算及歷史顯示 projection。

Actor：`business_master.view` 查閱者、`business_master.mgmt` 管理員、受保護的
`system-admin`，以及具自身業務權限的下游模組使用者。首版只 seed Active HKD；
Payment Term 沒有 production seed。Currency 只接受 ISO 4217 法定幣別。

範圍內：兩類 catalog 的管理 UI/API、狀態、版本、audit、引用影響預覽、唯讀／驗證
provider、Payment Term Due Date 計算、readiness 及跨模組相容契約。範圍外：FX、
換匯、會計分錄、付款／收款交易、批量 import/export、主資料審批，以及永久刪除。

權威來源包括本次 2026-09-11 使用者確認、`README.md`、`docs/frontend-design.md`、
Customer／Supplier／Sales／AR 既有 consumer 約束、現有 Node.js／Express／AJV／
MySQL／Vue 3／Quasar 架構及 `.github/workflows/ci.yml`。

## FR-001 — 查詢 Currency 目錄

### Statement
具 `business_master.view` 的使用者可用分頁列表依 code／name 搜尋，以 status 篩選並以
allowlist 欄位排序。一般業務 selector 只取得 Active 值；管理畫面可明確包含 Inactive。

### Acceptance criteria
列表固定回 code、name、decimalPlaces、status、version 及更新摘要；同一查詢的分頁、
總數及排序穩定，空結果清楚顯示。

### Failure behavior
未知 filter／sort、超出 pageSize 或不合法狀態回穩定 validation error，不降級成全表掃描。

## FR-002 — 建立及修改 Currency

### Statement
具 `business_master.mgmt` 的管理員可建立 Currency；一般修改只允許 name，code 建立後不可修改。
decimalPlaces 必須透過高影響 command 修改，status 只透過 lifecycle command 修改；每次修改須提供目前 version。

### Acceptance criteria
成功建立／修改回傳完整最新 projection，version 每次有效修改加一；重複 code、過期
version 及 no-op 的行為可預測且有 audit。

### Failure behavior
重複 code 回 409；version 衝突回 409 且不覆寫；禁止的 code 變更或空 update 回 400。

## FR-003 — 驗證 ISO Currency 與精度

### Statement
Currency code 必須是官方 ISO 4217 uppercase alphabetic code；不接受 crypto、積分或
自訂代碼。name 為 1–100 字純文字；decimalPlaces 為整數 0–4。

### Acceptance criteria
輸入會先 trim，再按 exact uppercase code 驗證；ISO reference snapshot 有來源版本與更新
程序。HKD 定義為 code `HKD`、name `Hong Kong Dollar`、decimalPlaces `2`。

### Failure behavior
lowercase、混合字元、未知／退役 code、空 name 或越界 precision 均整筆拒絕，不寫 DB/audit。

## FR-004 — Currency 顯示與金額契約

### Statement
Business Master 提供 code、name、decimalPlaces 及 status；precision 只定義輸入／顯示
minor-unit 規則，不提供 FX，也不改變下游 `DECIMAL(19,4)` 的儲存真值。

### Acceptance criteria
所有 consumer 對同一 Currency version 得到一致 projection；不同 Currency 永不由本模組
相加或自動換算。

### Failure behavior
consumer 要求不存在 code 時回 `CURRENCY_NOT_FOUND`；新用途要求 Inactive 時回
`CURRENCY_INACTIVE`，歷史用途仍可取得顯示 projection。

## FR-005 — 查詢與維護 Payment Term

### Statement
查閱者可分頁搜尋及篩選 Payment Term；管理員可建立條款；一般修改只允許 name、description，
code 建立後不可修改。calculationType、dueDays 必須透過高影響 command 修改，status 只透過 lifecycle
command 修改；所有修改以 version 防止 lost update。

### Acceptance criteria
code 經 NFKC、trim、case-fold 形成唯一 codeKey；顯示 code 1–50、name 1–100、description
0–500 字；成功修改保留穩定 id/code 並增加 version。

### Failure behavior
normalized duplicate 回 409；過期 version 回 409；unknown fields 或越界文字整筆拒絕。

## FR-006 — Payment Term 計算規則

### Statement
首版 calculationType 只允許 `IMMEDIATE`、`NET_DAYS`、`END_OF_MONTH`、`MANUAL`。
`NET_DAYS` 唯一需要 dueDays（0–3650）；其他類型 dueDays 必須為 null。

### Acceptance criteria
給定 ISO `YYYY-MM-DD` baseDate 與 Payment Term id/version：IMMEDIATE 回 baseDate；
NET_DAYS 加 calendar days；END_OF_MONTH 回同月最後一日；MANUAL 回
`requiresManualDueDate:true` 且不捏造日期。相同輸入必得相同輸出。

### Failure behavior
不存在／Inactive term、version 不符、非法日期、非法 type/dueDays 組合皆拒絕；日期溢出
或無法表示時不回部分結果。

## FR-007 — 啟用、停用與高影響修改

### Statement
停用 Currency／Payment Term、修改 Currency decimalPlaces，或修改 Payment Term
calculationType／dueDays 前，必須取得 consumer impact summary 並由管理員明確確認該摘要版本。

### Acceptance criteria
摘要按已註冊 consumer 顯示 active-default/reference 數量、unknown/unavailable consumer、
產生時間、操作類型與建議變更；確認時在同一受控流程重新檢查 catalog version 與摘要 token。
停用後既有 reference 與 snapshot 不變，新指派／新交易不可選用；精度或規則修改後既有交易
snapshot 不回寫，新交易採用新版本；UI 提示更換仍使用停用值的 defaults。

### Failure behavior
任一 required consumer 無法判定、摘要過期、catalog version 已變或確認 token 不符時 fail
closed；不得在未知影響下執行高影響操作。

## FR-008 — 不永久刪除及歷史可讀

### Statement
Currency 與 Payment Term 不提供永久刪除。Inactive 資料、完整 audit 及正式交易 snapshot
必須保持可查，且後續主資料修改不得改寫歷史交易。

### Acceptance criteria
API/UI 沒有 DELETE；FK 採 RESTRICT；history purpose 可按穩定 code／id 解析 Inactive
projection；備份／還原包含兩張 catalog 及 audit。

### Failure behavior
任何未授權 direct delete 被 DB FK／權限與測試阻止；歷史 lookup dependency 暫時失敗時
consumer 顯示可恢復錯誤，不以目前值替代 snapshot。

## FR-009 — 共用 lookup 與交易內驗證契約

### Statement
Business Master 提供 versioned provider：Active selector、history lookup、
`assertCurrencyUsableInTransaction()`、`assertPaymentTermUsableInTransaction()` 與
`calculateDueDate()`；交易確認呼叫必須傳入 caller 的 MySQL connection。

### Acceptance criteria
purpose=`new_assignment` 只接受 Active；purpose=`history` 可讀 Inactive；transaction-aware
assert 在 caller transaction 的同一觀察點重新讀取並回 allowlisted snapshot（identity、code、
name、version、precision／rule）。wrapper 只供非交易 selector/preflight。

### Failure behavior
transaction 方法沒有 connection 立即 throw TypeError；catalog 在選取後、確認前被停用或改版
時，caller 安全拒絕並要求重載，不形成 TOCTOU 寫入。

## FR-010 — 權限與 purpose-specific 存取

### Statement
管理 UI/API 使用 `business_master.view`／`business_master.mgmt`；`system-admin` 具兩者。
Customer、Supplier、Sales、Purchasing、AR／AP 以其自身已授權 handler 呼叫 provider，無需取得
Business Master 管理權限。

### Acceptance criteria
前端隱藏未授權入口只是 UX；每支後端 handler 獨立驗證 JWT 與所需 permission。consumer
projection 只含用途必要欄位且不暴露管理 impact 或完整 audit。

### Failure behavior
未登入回 401；缺權回 403；permission 在操作期間撤銷時，寫入 commit point 前 fresh check
拒絕，且不留下 catalog 變更。

## FR-011 — 稽核、相關性與可追查修改

### Statement
Create、Update、Activate、Deactivate 與被拒絕的高風險停用須記錄 actor、action、target、
before/after allowlist、reason/impact summary、timestamp、correlationId 及結果。

### Acceptance criteria
成功狀態與 audit 在同一 DB transaction；audit 列表可依 entity、code/id、action、actor、日期查詢；
自由文字以純文字處理，token/secret/request body 不入 log。

### Failure behavior
audit 寫入失敗令 mutation rollback；logger 失敗不偽裝成功，按現有 failure visibility 回 500 並保留
correlationId。

## FR-012 — 首版資料與 readiness

### Statement
production migration 只 idempotent seed Active HKD，不 seed Payment Term。啟動 readiness 必須
驗證 schema shape、permission catalogue、HKD 與 provider contract；Business Master owner 在上線前
自行建立需要的 Payment Term。

### Acceptance criteria
fresh DB、半完成 migration 及重跑均得到恰好一筆正確 HKD；不相容既有 schema 明確 fail，不以
`IF NOT EXISTS` 掩蓋。至少一個 Active Currency 才可宣告 provider READY。

### Failure behavior
HKD 缺失／不相容、table/index/permission shape 錯誤或 provider 未註冊時 readiness fail closed；
consumer 不建立影子 catalog 或 production fake。

## NFR-001 — 效能與容量

### Statement
在 10,000 Currency/Payment Term 合計資料、100 concurrent mixed lookup、正常索引及 warm DB
條件下，list/lookup/calculate API p95 < 2 秒、p99 < 4 秒、technical error rate < 1%。

### Acceptance criteria
效能報告記錄硬體、Node/MySQL 版本、資料分布、warm-up、concurrency、p50/p95/p99、error rate 與
query plan；列表必須分頁且標準搜尋不使用 leading-wildcard full scan。

### Failure behavior
超過目標即不通過 Technical Acceptance；不得以降低資料量、略過 cold/warm 說明或移除 required
case 取得 PASS。

## NFR-002 — 可用性與復原

### Statement
沿用 ERP 已批准基線：RTO ≤ 4 小時、RPO ≤ 15 分鐘。主資料與 audit 在同一 MySQL backup set，
部署採 forward-only migration 與新 migration 修復。

### Acceptance criteria
隔離環境完成備份／還原演練並核對 row counts、HKD、inactive history、version 與 audit linkage；
應用重啟後 provider/readiness 無資料漂移。

### Failure behavior
還原不完整、audit linkage 斷裂或超出 RTO/RPO 時不宣告 READY；不修改已套用 migration 回退。

## NFR-003 — 無障礙與回應式管理介面

### Statement
UI 遵守 `docs/frontend-design.md`、WCAG 2.1 AA，並在 375、768、1024、1440px 完成核心流程。

### Acceptance criteria
鍵盤可完成搜尋、建立、修改及停用確認；焦點、錯誤摘要、標籤、heading、status text 與對比正確；
所有表格使用 DataTable，表單使用 FormPanel。

### Failure behavior
載入、空白、validation、403、409、500、慢速與 retry state 均有可理解呈現；不只以顏色表達狀態。

## NFR-004 — 向後相容與單一版本契約

### Statement
provider/API 採單一 v1 契約；新增欄位須 additive，破壞性 schema/field/enum 調整要有 consumer impact、
兼容 migration 及各 consumer contract regression。

### Acceptance criteria
Customer、Supplier、Sales、Purchasing、AR 的既有已記錄欄位/語意可由新 provider 滿足；contract tests
固定 active/history、precision、rule、snapshot 及 error semantics。

### Failure behavior
任一 required consumer regression 未執行／失敗即 NOT_READY；不得讓 consumer 自行 fork contract。

## SEC-001 — 認證、授權與最小權限

### Statement
所有 endpoint 必須 JWT authentication；管理 query/write 分別要求 view/mgmt；consumer 只經已授權
handler 使用最小 provider projection。

### Acceptance criteria
覆蓋匿名、view-only、mgmt、consumer role、system-admin、停用 user 及 permission revocation matrix；
沒有 client-only authorization。

### Failure behavior
缺少/過期 token 或權限資料不可用時 fail closed；錯誤不洩漏其他 entity 或 permission 內部細節。

## SEC-002 — 輸入、輸出與注入防護

### Statement
HTTP boundary 使用 strict AJV schema、reject unknown fields；SQL 全部 parameterized；Vue 預設 escaping，
不使用 `v-html` 顯示 code/name/description。

### Acceptance criteria
惡意排序欄、Unicode duplicate、SQL/XSS payload、超長字串、非法日期與 malformed JSON 均被拒絕或安全
編碼；response schema 只回 allowlisted 欄位。

### Failure behavior
validation failure 無 DB/audit mutation；server error 不回 stack/SQL/schema 內容並保留安全 correlationId。

## SEC-003 — 高影響操作防誤用

### Statement
Deactivate、Currency precision change 與 Payment Term rule change 都是需 reason、impact summary
token、catalog version 與明確確認的高影響命令；一般 update 不得夾帶相關欄位繞過它。

### Acceptance criteria
雙擊、重送、過期摘要、payload reuse、consumer outage 與競爭修改均只產生一個可判定結果；audit 能重建
誰看見哪個影響摘要後執行。

### Failure behavior
結果不明時 client 以 correlation/idempotency key 查回，不自動產生第二次命令；summary 不完整時拒絕。

## SEC-004 — 日誌與資料最小化

### Statement
Currency/Payment Term 為非 PII，但 actor/user ID、token、headers 及完整 request body 仍須依現有 redaction
policy 最小化；audit before/after 只保存 catalog allowlist。

### Acceptance criteria
安全測試驗證 token/password/authorization header 不出現在 app log、audit、browser console 或 export；
consumer response 不包含 actor/audit/impact 私有欄位。

### Failure behavior
發現 secret/credential exposure 為 blocking security finding；先輪替受影響 credential，再修復及重測。

## Assumptions, dependencies, open issues and human decisions

- CONFIRMED：`docs/business_master/`、`DESIGN_AND_PLAN`、完整管理 UI/API、deterministic Due Date contract、
  四種 Payment Term type、ISO-only Currency、共用兩權限、可停用既有引用但不刪除、只 seed HKD。
- CONFIRMED：Business Master 是 sole writer；下游保存交易快照且不得建立 shadow catalog。
- ASSUMPTION（沿用 repository）：單一公司、單一 MySQL primary、epoch-ms audit timestamp、業務日期用 ISO
  calendar date；Node.js 26+、MySQL 5.7+、Vue 3/Quasar 2。
- DEPENDENCY：User/Role/JWT、MySqlDatabaseService、Audit pattern、request validation、CSP/error mapping。
- OPEN APPROVAL：本文、設計與計畫完成後仍需實際 human baseline approval；本次 intent confirmation 不等於
  對尚未存在的 design/plan hash 批准。

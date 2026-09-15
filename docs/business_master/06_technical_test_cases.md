# Business Master Technical Test Specification

Typed metadata（relations、mandatory、blocking、applicability、suite_id）只在 `08_traceability.json`。
下列全部是 `PLANNED`，未執行、未 PASS。

## TC-001 — Migration、shape adoption 與 HKD seed

### Preconditions and data
空白、只完成部分 migration、已相容 tables、不相容 tables 四個隔離 MySQL schema；最新 migration inventory。

### Steps
配置當時序號後執行、重跑及中斷後恢復；查 schema/index/FK/permissions/system-admin/HKD/Payment Term rows。

### Expected result
相容情況成功且 HKD 恰一筆、Payment Term 零 seed；不相容 fail before mutation；applied migration不改寫。

### Acceptance criteria
Fresh/repeat/half-applied/adopt/incompatible assertions全通過，沒有 consumer shadow DDL。

### Cleanup
Drop 本 case 擁有的隔離 schemas；不觸碰 shared/production DB。

## TC-002 — ISO Currency validation boundaries

### Preconditions and data
版本化 ISO snapshot；HKD、JPY、BHD、lowercase、unknown、crypto、Unicode、0/4/5 precision vectors。

### Steps
直接測 pure validator並經 create/update service重測 boundary input。

### Expected result
官方 uppercase code及0–4 precision接受；其餘整筆拒絕；code不可更新。

### Acceptance criteria
Pure/service結果一致，invalid case無DB/audit mutation，stable error code正確。

### Cleanup
Rollback fixture transaction。

## TC-003 — Currency create/list/detail contract

### Preconditions and data
mgmt/view actors；多狀態、多名稱及10k資料集。

### Steps
建立後以code/name/status、page/pageSize、allowlisted sort查詢，取detail及空結果。

### Expected result
projection/pagination/order/total穩定；selector與admin includeInactive分離；unknown query拒絕。

### Acceptance criteria
API response schema、DB row、version及audit一致；無leading-wildcard standard query。

### Cleanup
刪除隔離 schema或回滾fixture；不走產品delete API。

## TC-004 — Currency CAS、idempotency 與 lifecycle concurrency

### Preconditions and data
一筆Active Currency、兩個connection、相同/不同Idempotency-Key payload。

### Steps
並發update、activate/deactivate/change-precision、重送、commit後斷線replay、同key異payload。

### Expected result
每個intent只一個mutation/audit/version winner；loser 409；replay同response；payload reuse 回 409 `IDEMPOTENCY_CONFLICT`。

### Acceptance criteria
無lost update/double audit/unknown state；驗證 framework idempotency envelope 與 catalog transaction 的既有協作契約。

### Cleanup
Restore fixture至初始version/status。

## TC-005 — Payment Term schema與 normalized uniqueness

### Preconditions and data
NET30 code的case/space/NFKC variants、長度0/50/51、description 500/501。

### Steps
建立及並發建立normalized duplicates；嘗試修改code、unknown field及invalid text。

### Expected result
唯一key由DB決勝；code immutable；valid boundaries成功，其餘無部分寫入。

### Acceptance criteria
恰一筆term/audit；duplicate 409；validation與response field allowlist一致。

### Cleanup
Rollback/restore fixture。

## TC-006 — Payment Term conditional rule validation

### Preconditions and data
四種type；dueDays null、0、1、3650、3651、negative/fraction/string。

### Steps
對create/update/pure validator跑完整type × dueDays decision table。

### Expected result
只有NET_DAYS要求0–3650 integer；其他type只接受null；unknown type拒絕。

### Acceptance criteria
每個vector有明確結果；invalid無DB/audit；rule change增加version。

### Cleanup
Rollback fixture。

## TC-007 — Due Date deterministic calendar calculations

### Preconditions and data
2024/2025 leap/non-leap、month/year end、Jan 31、Feb 28/29、NET 0/30/3650、MANUAL vectors。

### Steps
在不同process timezone/TZ env重複 pure及service calculation。

### Expected result
IMMEDIATE/NET_DAYS/END_OF_MONTH精確；MANUAL只回manual flag；timezone不改結果。

### Acceptance criteria
同snapshot/baseDate byte-equivalent output；非法/overflow date拒絕；無JavaScript local-time drift。

### Cleanup
無 mutation，N/A。

## TC-008 — Payment Term CAS、snapshot與歷史 replay

### Preconditions and data
Active term v1及其transaction snapshot；兩個editor。

### Steps
並發rule/name更新，使用舊snapshot/目前row分別計算，再停用並history lookup。

### Expected result
一個CAS winner；舊snapshot計算/顯示不變；current future use採新version；Inactive history可讀。

### Acceptance criteria
無retroactive rewrite；version/audit/current/history projections準確。

### Cleanup
Restore fixture。

## TC-009 — 高影響操作 preview complete、stale與 unavailable

### Preconditions and data
deactivate、change-precision、change-rule proposals；checker results：references、known zero、NOT_INSTALLED、
timeout/error、watermark change。

### Steps
逐種 operation 產 preview/token；改動 proposed payload 或引用後重算；以 expired、other actor、other
entity/version/operation token confirm，並嘗試用一般 PATCH 修改受保護欄位。

### Expected result
只有完整且fresh exact token可進行對應命令；任何unknown/drift/mismatch/expiry fail closed；一般 PATCH 拒絕
status、decimalPlaces、calculationType、dueDays。

### Acceptance criteria
摘要operation/proposed change/counts/status/watermark canonical且排序無關；失敗無 success audit。

### Cleanup
Reset synthetic checker state。

## TC-010 — Referenced deactivation與新舊用途

### Preconditions and data
Currency/term各有Customer/Supplier default及歷史交易snapshot；有效impact token。

### Steps
停用，再作admin/history lookup、new selector、new assignment/transaction confirm、old transaction display；再activate。

### Expected result
refs/snapshots保留；new use拒絕；history顯示Inactive；defaults提示可辨；reactivate恢復new use。

### Acceptance criteria
沒有consumer row被Business Master修改；FK/audit/version及provider語意一致。

### Cleanup
Reactivate及清理隔離consumer fixtures。

## TC-011 — Transaction-aware revalidation與lock order

### Preconditions and data
Caller transaction、Active values、另一connection準備update/deactivate；無connection call。

### Steps
在selector後、confirm前製造state/version race；以Currency→Term及反序consumer命令壓測；呼叫缺connection method。

### Expected result
stale confirm拒絕/rollback；無connection TypeError；固定lock order無未處理deadlock/lost update。

### Acceptance criteria
caller DB write、snapshot、audit全有或全無；deadlock按stable retryable conflict呈現。

### Cleanup
Rollback open transactions並restore rows。

## TC-012 — Authentication、authorization與 revocation matrix

### Preconditions and data
anonymous、view-only、mgmt、consumer、system-admin、disabled/revoked users。

### Steps
對每endpoint執行read/write/lifecycle/audit；操作開始後commit前撤銷permission/user。

### Expected result
401/403/allowed matrix精確；consumer不能用admin API但可經own handler lookup；fresh check阻止revoked write。

### Acceptance criteria
前端visibility不影響server enforcement；denied path無mutation且有安全audit/log correlation。

### Cleanup
還原synthetic roles/users。

## TC-013 — Strict schemas、injection、XSS與 redaction

### Preconditions and data
SQL/meta sort、XSS text、malformed JSON、unknown fields、oversize、token/password/header canaries。

### Steps
提交全部boundary payload，讀API/UI/log/audit/console及DB。

### Expected result
參數化/strict validation/escaping生效；無執行payload、stack/SQL/secret/credential leakage。

### Acceptance criteria
Response只含allowlist；invalid無mutation；任何canary exposure令case FAIL。

### Cleanup
刪除隔離logs/fixtures，保留redacted evidence。

## TC-014 — Audit atomicity、query與 failure visibility

### Preconditions and data
各mutation、audit insert failure injection、logger failure、actor/date/entity filters。

### Steps
執行success/rejected lifecycle，inject audit/logger failure，再query pagination/sort。

### Expected result
success mutation/audit atomic；audit failure rollback；rejected high-risk有result/correlation；query穩定。

### Acceptance criteria
before/after/impact/reason/actor/correlation完整且無敏感body；500不偽裝success。

### Cleanup
Reset failure injection並drop fixture schema。

## TC-015 — API error、pagination與 timeout/retry contract

### Preconditions and data
所有stable error vectors、page boundaries、slow DB/impact checker、commit-response-loss proxy。

### Steps
呼叫DES-007 endpoints，驗HTTP/status/body/schema/Retry behavior及相同key replay。

### Expected result
400/401/403/404/409/503/500語意一致；page max有界；timeout不鼓勵新intent重送。

### Acceptance criteria
每個error有correlationId、安全public message及無internal detail；replay不重做effect。

### Cleanup
關閉fault proxy，清除隔離idempotency records。

## TC-016 — Vue component states、forms與 permission UX

### Preconditions and data
Mocked validated API responses；view/mgmt/consumer sessions；loading/empty/success/error/409 states。

### Steps
Vitest mount Currency/Payment pages/forms/impact dialog，操作filters、conditional dueDays、focus及actions。

### Expected result
DataTable/FormPanel/PageHeader/EllipsisCell正確；permission visibility、中文errors、focus/error summary符合規範。

### Acceptance criteria
無console warning、raw q-table/v-html/client-only security；component tests全部發現且PASS才算execution成功。

### Cleanup
Unmount並restore mocks。

## TC-017 — Playwright real-browser UI、accessibility與 network

### Preconditions and data
實際app + isolated DB、synthetic roles/catalog、Chromium；375/768/1024/1440 viewports。

### Steps
走Currency/Payment CRUD、calculate、impact/deactivate/reactivate、audit、403/409/503、refresh/back；檢查keyboard、focus、console/requests。

### Expected result
核心flow端到端可完成；responsive/sticky actions/labels/headings/status/error recovery正確；無unexpected console/network failure。

### Acceptance criteria
使用role/label/test-id及deterministic waits；trace-on-failure；不得以mock browser替代實際running app。

### Cleanup
刪除case自有fixtures、關閉browser/server；保留經分類的trace/evidence。

## TC-018 — 10k/100-concurrency performance acceptance

### Preconditions and data
指定硬體/Node/MySQL、10k均衡Active/Inactive rows、100 concurrent mixed list/lookup/calculate、warm-up完成。

### Steps
定時負載並收p50/p95/p99/error/resource/query plans；另跑impact checker bounded timeout。

### Expected result
核心API p95<2s、p99<4s、technical error<1%；無pool exhaustion/unbounded scan。

### Acceptance criteria
報告含環境/分布/arrival/concurrency/duration/warm-up；任一threshold breach為FAIL。

### Cleanup
Drop performance schema並停止load generator。

## TC-019 — Backup、restore、restart與 RTO/RPO

### Preconditions and data
隔離DB含HKD、custom currencies/terms、Inactive refs、versions、audits；受控backup工具與計時。

### Steps
建立consistent backup、模擬loss、restore、重啟app/provider，核對資料/audit/readiness及elapsed/recovery point。

### Expected result
row/hash/linkage一致，RTO≤4h、RPO≤15m；restart不duplicate seed或改version。

### Acceptance criteria
原始backup/restore logs、before/after manifest與readiness evidence完整；不靠口頭判定。

### Cleanup
安全移除case擁有的backup/schema，保留最小redacted report。

## TC-020 — Consumer contract與 backward compatibility

### Preconditions and data
Customer、Supplier、Sales、Purchasing、AR/AP contract fixtures；installed/not-installed readiness states。

### Steps
驗active/history/assert/calculate/projection/errors/permission；掃描migrations/services確保無shadow write；跑consumer suites。

### Expected result
所有required consumers接受v1；未安裝有明確known state；planned Supplier endpoint可由own handler+provider滿足。

### Acceptance criteria
任一missing/skipped/failing consumer或breaking field semantics即FAIL/NOT_READY，不能以不同module test冒充。

### Cleanup
Reset contract fixtures；無cross-module product data cleanup。

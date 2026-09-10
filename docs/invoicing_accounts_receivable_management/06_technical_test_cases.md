# Invoicing & Accounts Receivable Technical Test Specification

## 1. Execution Contract

- 本文件是測試規格，不是執行報告；全部案例狀態為`PLANNED`，Evidence為`—`。
- 真MySQL、provider contract、browser、performance及restore案例必須在production-like環境執行；mock只可補充，不可代替財務不變式證據。
- 每案的Expected即Acceptance Criteria；失敗後保留correlation、operation、DB／job及log證據，再按Cleanup回復fixture。
- Priority `P0`表示不可接受的越權、重複、部分commit、負餘額、資料遺失或錯誤routing風險。

欄位：`ID｜Title｜Type/Priority｜Requirements / Design / Tasks｜Preconditions & Data｜Steps / Trigger｜Expected Technical Result / Acceptance｜Cleanup｜Automation｜Status｜Evidence`。

## 2. PHASE-001 Foundation Cases

| ID | Title | Type / Priority | Traceability | Preconditions & Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | Fulfillment provider完整projection | CONTRACT/P0 | FR-011,052；DES-020；TASK-001 | SHIPPED多Line Shipment | lock provider | 完整owner/status/version/line/source；缺項fail closed | rollback | YES | PLANNED | — |
| TC-002 | Sales classification契約 | CONTRACT/P0 | FR-037,038,101；DES-009,014；TASK-001,007 | 分批SO line | confirm/reverse classification | event唯一、before/after exposure總額不雙計 | rollback | YES | PLANNED | — |
| TC-003 | Provider missing/version/UNKNOWN | NEGATIVE/P0 | FR-052,071,105；DES-020；TASK-001 | provider absent/wrong version/timeout | startup及command | route disabled或503 UNKNOWN，無寫入 | restore provider | YES | PLANNED | — |
| TC-004 | Permission catalogue最小權限 | SECURITY/P0 | FR-001；SEC-001～003；DES-021；TASK-002 | 各單一permission user及System Admin | enumerate routes/actions | 只允許矩陣動作，名稱無隱含授權 | reset roles | YES | PLANNED | — |
| TC-005 | Decimal string與最大邊界 | UNIT/P0 | FR-033,061,073；DES-002；TASK-003 | 0、4位、max、overflow、scientific | normalize/arithmetic | 無float誤差；非法/overflow拒絕 | — | YES | PLANNED | — |
| TC-006 | Pack/Base及尾差property | UNIT/P0 | FR-037,038；DES-009；TASK-003 | factor24、12+12及隨機splits | allocate source amounts | 累計精確等於SO line amount且不超收 | — | YES | PLANNED | — |
| TC-007 | State transition exhaustive | UNIT/P0 | FR-035,056～058,069,079～084；DES-003；TASK-003 | 所有state pair | invoke transition | 只允許design矩陣；terminal不可改 | — | YES | PLANNED | — |
| TC-008 | Date／Close／As-of boundaries | UNIT/P0 | FR-007,008,027～029,063,073,089,098；DES-003,013；TASK-003 | HKT午夜、leap day、close date | validate/project | 未來/關帳拒絕；effect恰在日期正確 | — | YES | PLANNED | — |
| TC-009 | Bank AES-GCM及AAD | SECURITY/P0 | FR-003,004；SEC-004～006；DES-022；TASK-004 | known vector、兩row、wrong AAD | encrypt/decrypt/tamper | roundtrip；nonce不同；tamper/owner swap fail | destroy fixture key | YES | PLANNED | — |
| TC-010 | Bank default並發唯一 | DB/CONCURRENCY/P0 | FR-003；DES-022；TASK-004 | 同Currency兩accounts | parallel set default | 只有一個default，失敗方可理解 | rollback | YES | PLANNED | — |
| TC-011 | Sequence年度／prefix並發 | DB/CONCURRENCY/P0 | FR-005,006；DES-006；TASK-004 | 100 parallel、year boundary、prefix回切 | issue numbers | 全唯一、遞增、不重用；回切續舊next | rollback isolated DB | YES | PLANNED | — |
| TC-012 | Domain event same/different hash | API/P0 | FR-054；SEC-015；DES-005；TASK-005 | 同event payload A/A/B | submit thrice | A replay same；B 409；單一effect | rollback | YES | PLANNED | — |
| TC-013 | Operation lease競爭 | CONCURRENCY/P0 | FR-054,055；DES-005,019；TASK-005 | expired operation、2 workers | barrier claim | 一worker獲lease；另一不執行effect | reset lease | YES | PLANNED | — |
| TC-014 | Audit builder redaction | SECURITY/P0 | FR-130～132；SEC-004,012；DES-017；TASK-005 | bank/token/password/reason | success/failure audit/log | IDs/outcome/correlation存在；秘密不出現 | purge fixture logs | YES | PLANNED | — |
| TC-015 | Invoice composite ownership FK | DB/P0 | FR-023,024；SEC-002；DES-004；TASK-006 | Line/source來自不同invoice | insert/link | FK或service拒絕，無orphan | rollback | YES | PLANNED | — |
| TC-016 | 雙人Active Claim barrier | DB/CONCURRENCY/P0 | FR-018～020；DES-004；TASK-006 | 同Shipment兩transactions | simultaneous create | 恰一完整成功；另一無partial Draft/Claim | rollback | YES | PLANNED | — |
| TC-017 | Formal row immutable trigger | DB/SECURITY/P0 | FR-056；SEC-009；DES-003,007；TASK-006 | ISSUED invoice/line/source/ledger | direct application UPDATE/DELETE | DB拒絕；archive identity only allowed path | rollback | YES | PLANNED | — |
| TC-018 | Sales source amount locked race | INTEGRATION/P0 | FR-037,038；DES-008,009；TASK-007 | last two shipments concurrently | calculate/confirm | lock序一致；總source amount等SO amount | rollback | YES | PLANNED | — |
| TC-019 | Exposure classification invariant | INTEGRATION/P0 | FR-099～107；DES-014；TASK-007 | commitment100, AR0 | invoice then void | total exposure不在轉類時增加；void反向 | rollback | YES | PLANNED | — |
| TC-020 | Fresh/upgrade migration proof | DB/P0 | 全P1；DES-001～025；TASK-008 | empty DB及前一main schema | migrate up, restart, smoke | schema/index/trigger/provider startup一致且可重跑檢測 | disposable DB | YES | PLANNED | — |

## 3. PHASE-002 Invoicing Cases

| ID | Title | Type / Priority | Traceability | Preconditions & Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-021 | Workbench eligibility matrix | API/P0 | FR-011,012；DES-004,020；TASK-009 | PICKED/SHIPPING/SHIPPED/REVERSED/claimed | list | 只有可開票SHIPPED可選；原因正確 | rollback | YES | PLANNED | — |
| TC-022 | Workbench filter/keyset | API/P1 | FR-013,014；NFR-001,002；TASK-009 | 730萬fixture | filter/cursor/sort | 穩定無duplicate/missing，p95≤2s | retain perf DB | YES | PLANNED | — |
| TC-023 | Group compatibility | UNIT/API/P1 | FR-015～017；DES-004；TASK-009 | mixed customer/currency/term/date/warehouse | preview | 合法分組；跨warehouse可，錯因明示 | rollback | YES | PLANNED | — |
| TC-024 | 完整Shipment Draft | INTEGRATION/P0 | FR-018,022～024；TASK-010 | 多lines shipment | create | 全lines/qty/source映射與claim原子完成 | cancel | YES | PLANNED | — |
| TC-025 | Partial/duplicate source拒絕 | NEGATIVE/P0 | FR-023,024；DES-004；TASK-010 | omit line/qty、duplicate ID | create | 409，無Draft/Claim/registry部分結果 | rollback | YES | PLANNED | — |
| TC-026 | Create重送與衝突 | IDEMPOTENCY/P0 | FR-020；DES-005；TASK-010 | event A same/different payload | retry | replay同Draft；conflict無第二Draft | cancel | YES | PLANNED | — |
| TC-027 | Draft versioned allowlist | API/P0 | FR-025～031,035,036；TASK-011 | version1 two editors | patch legal/forbidden/stale | legal CAS+1；source/customer/qty拒絕；stale409 | rollback | YES | PLANNED | — |
| TC-028 | Price override permission/reason | SECURITY/P0 | FR-032,033；DES-021；TASK-011 | users with/without override | patch price | 無權拒絕；有權須reason且audit delta | rollback | YES | PLANNED | — |
| TC-029 | Draft cancel releases claim | INTEGRATION/P0 | FR-035；TASK-011 | shipment Draft | cancel/retry | 無AR/number；claim released；source可再選 | rollback | YES | PLANNED | — |
| TC-030 | Manual invoice no upstream effect | INTEGRATION/P0 | FR-039～044；TASK-012 | Active customer，optional SKU | create/confirm | MANUAL issued；Sales/Fulfillment/Inventory unchanged | void | YES | PLANNED | — |
| TC-031 | Manual blocked customer/validation | NEGATIVE/P1 | FR-040～045；TASK-012 | suspended/blocked/archived、bad lines | create | rejected；既有shipment invoice path unaffected | rollback | YES | PLANNED | — |
| TC-032 | Invoice confirm atomic success | INTEGRATION/P0 | FR-052,053；DES-005～010；TASK-013 | valid 100-line draft | confirm | one number、ISSUED、ledger/balance/source/classification/history/audit all commit | void | YES | PLANNED | — |
| TC-033 | Confirm validation rollback matrix | INTEGRATION/P0 | FR-052,055；TASK-013 | address/version/status/close/source invalid | fail each validation | DRAFT/FAILED可理解；0 formal effects/number | reset | YES | PLANNED | — |
| TC-034 | Confirm雙擊/transport replay | CONCURRENCY/P0 | FR-054；SEC-015；TASK-013 | same event/key simultaneous | submit | one effect/number；both resolve same outcome | void | YES | PLANNED | — |
| TC-035 | Crash before/after commit recovery | RECOVERY/P0 | FR-054,055；DES-005；TASK-013 | kill at Phase A, precommit, postcommit response | restart worker | converges one success/failure；no duplicate | rollback fixture | PARTIAL | PLANNED | — |
| TC-036 | Commit unknown connection loss | RECOVERY/P0 | FR-054,055；TASK-013 | sever connection at COMMIT | recover by event | no unsafe immediate retry；unique outcome found | repair network | PARTIAL | PLANNED | — |
| TC-037 | Batch one bad group isolation | INTEGRATION/P0 | FR-046～051；TASK-014 | 100 groups one invalid | run batch | 99 success/1 fail；counts守恆；details可重試 | void successes | YES | PLANNED | — |
| TC-038 | 10k batch throughput | PERFORMANCE/P1 | FR-046；NFR-004,005；TASK-014 | 10k eligible shipments | create+confirm job | ≤30min，interactive SLO仍達標 | perf DB | PARTIAL | PLANNED | — |
| TC-039 | Batch crash/resume/source freeze | RECOVERY/P0 | FR-048～051；TASK-014 | add new shipment after queue、kill worker | resume | 不加入新source；成功不重複；counts exact | reset | YES | PLANNED | — |
| TC-040 | Invoice Void preconditions | INTEGRATION/P0 | FR-057,058；TASK-015 | open/closed, linked/unlinked invoice | void | only eligible void；number/snapshot preserved；AR/source reversed | rollback | YES | PLANNED | — |
| TC-041 | Fulfillment reversal guard | CONTRACT/P0 | FR-071；DES-020；TASK-015 | uncredited/fully credited/unknown source | query guard | BLOCKED/CLEAR/UNKNOWN exact，unknown never clear | rollback | YES | PLANNED | — |
| TC-042 | Invoice routes/actions permission | FRONTEND/SECURITY/P0 | FR-011～058；SEC-001～003；TASK-016 | roles matrix | navigate/direct API | page/action visibility及server拒絕一致 | reset roles | YES | PLANNED | — |
| TC-043 | Draft UI errors/polling/accessibility | FRONTEND/P1 | FR-025～036,054；SEC-014；TASK-016 | server field error/202/375px/keyboard | operate form | focus summary、same operation polling、no hidden amount/status | — | YES | PLANNED | — |
| TC-044 | A4/PDF snapshot and injection | SECURITY/VISUAL/P0 | FR-120～125；SEC-011；TASK-016 | malicious text、missing billing、later master edits | render/download | escaped；no fake address；old snapshot stable；VOID marked | purge files | PARTIAL | PLANNED | — |
| TC-045 | Phase 2 full regression | OTHER/P0 | 全P2；TASK-017 | clean production-like build | full gate | lint/tests/build/audit/coverage/contracts/DB all green | disposable env | PARTIAL | PLANNED | — |

## 4. PHASE-003 Settlement Cases

| ID | Title | Type / Priority | Traceability | Preconditions & Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-046 | Credit Draft ownership | API/SECURITY/P0 | FR-059～063；DES-011；TASK-018 | invoice A/B lines | create using mixed IDs | only origin invoice lines accepted；no IDOR | cancel | YES | PLANNED | — |
| TC-047 | Credit date/reason/amount boundaries | UNIT/API/P1 | FR-060～063；TASK-018 | zero/max/future/closed | create/update | invalid rejected with field codes | rollback | YES | PLANNED | — |
| TC-048 | Credit source allocation | UNIT/P0 | FR-061,071；DES-011；TASK-018 | consolidated invoice sources | allocate credit | deterministic per-source sum equals line credit | — | YES | PLANNED | — |
| TC-049 | Credit confirm atomic | INTEGRATION/P0 | FR-064～067；TASK-019 | unpaid and partially paid invoices | confirm | origin reduced then excess balance；ledger/projections/number atomic | void if legal | YES | PLANNED | — |
| TC-050 | Concurrent credit cap | CONCURRENCY/P0 | FR-062；TASK-019 | 50 credits against same line | barrier confirm | successful total≤creditable；no negative | rollback | YES | PLANNED | — |
| TC-051 | Credit confirm recovery | RECOVERY/P0 | FR-064；DES-005；TASK-019 | crash/commit unknown | recover | unique document/effect/number | rollback fixture | PARTIAL | PLANNED | — |
| TC-052 | Credit balance creation precision | UNIT/DB/P0 | FR-065～067；TASK-019 | outstanding30 credit50 | confirm | outstanding0、available credit20 exact | rollback | YES | PLANNED | — |
| TC-053 | Credit apply same owner/currency | INTEGRATION/P0 | FR-066～068；TASK-020 | credit20、target invoice25 | apply partial/full/cross owner | legal exact；cross rejected no side effect | unapply | YES | PLANNED | — |
| TC-054 | Credit unapply/reapply/void | INTEGRATION/P0 | FR-067～070；TASK-020 | active applications | unapply/reapply/void | history append、balances exact、void blocked until clear | rollback | YES | PLANNED | — |
| TC-055 | Shipment partial reversal credit proof | CONTRACT/P0 | FR-071；TASK-020 | one shipment mappings partly/full credited | guard | clear only mapped source effective amount fully zero | rollback | YES | PLANNED | — |
| TC-056 | Receipt method schema matrix | API/P1 | FR-072～074；TASK-021 | bank/cash/cheque/other fields | create/update | method-required fields exact，unknown rejected | cancel | YES | PLANNED | — |
| TC-057 | Receipt confirm atomic | INTEGRATION/P0 | FR-075～079；TASK-021 | receipt with initial allocations | confirm | number、receipt、allocations、ledger/balances/audit atomic | reverse | YES | PLANNED | — |
| TC-058 | Receipt confirm retry/recovery | RECOVERY/P0 | FR-078,083；TASK-021 | double submit/crash/unknown | recover | one receipt/number/effect | rollback fixture | PARTIAL | PLANNED | — |
| TC-059 | Partial/multi invoice allocation | INTEGRATION/P0 | FR-075～077；TASK-022 | amount100 invoices30/80 | allocate | outstanding 0/10、available0；exact sums | unapply | YES | PLANNED | — |
| TC-060 | Cross customer/currency allocation拒絕 | SECURITY/P0 | FR-075,077；TASK-022 | mismatched invoices | allocate | 409/404，no FX/transfer/side effect | rollback | YES | PLANNED | — |
| TC-061 | 50-way receipt/invoice barrier | CONCURRENCY/P0 | FR-077；TASK-022 | shared receipt/invoice balances | simultaneous allocations | sums never exceed either balance；no deadlock leak | rollback | YES | PLANNED | — |
| TC-062 | Reallocate all-or-nothing | INTEGRATION/P0 | FR-080,083；TASK-022 | remove A/add B,C with one invalid | submit set | failure preserves original；success records all events | rollback | YES | PLANNED | — |
| TC-063 | Receipt full reversal | INTEGRATION/P0 | FR-081,082；TASK-023 | allocated＋unallocated receipt | reverse | allocations reversed、invoice outstanding restored、available=0、REVERSED | rollback | YES | PLANNED | — |
| TC-064 | Reversal partial failure rollback | INTEGRATION/P0 | FR-082；TASK-023 | inject failure nth invoice | reverse | no partial effects；processing/recovery state valid | remove injection | PARTIAL | PLANNED | — |
| TC-065 | Reversal idempotency/unique | CONCURRENCY/P0 | FR-083；TASK-023 | two reverse requests | submit | one completed reversal；same event replay | rollback | YES | PLANNED | — |
| TC-066 | Effect-date historical statement | INTEGRATION/P0 | FR-098；DES-007,013；TASK-023 | prior allocation/current reversal | query before/after | prior shows receipt effect；current shows reversal | rollback | YES | PLANNED | — |
| TC-067 | Settlement UI keyboard/errors | FRONTEND/P1 | FR-059～085；SEC-014；TASK-018～023 | roles/375px/server conflicts | operate credit/receipt | safe summaries、focus、currency clear、no auto allocation | — | YES | PLANNED | — |
| TC-068 | Phase 3 full regression | OTHER/P0 | 全P3；TASK-024 | production-like | full gate | all settlement invariants及prior P0 pass | env reset | PARTIAL | PLANNED | — |

## 5. PHASE-004 Inquiry、Opening、Archive and Release Cases

| ID | Title | Type / Priority | Traceability | Preconditions & Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-069 | Customer Account ledger守恆 | INTEGRATION/P0 | FR-086,092,093；TASK-025 | invoices/credits/receipts/reallocations | query | opening+activity=closing per currency；links exact | rollback | YES | PLANNED | — |
| TC-070 | Overdue/Aging boundaries | UNIT/API/P1 | FR-088～090；DES-013；TASK-025 | due today/1/30/31/60/61/90/91 | as-of query | exact buckets；today not overdue | — | YES | PLANNED | — |
| TC-071 | UI/PDF/CSV same As-of | INTEGRATION/P0 | FR-091,097,098；TASK-025 | fixed account dataset | compare outputs | identical transaction set/amount/buckets | purge files | YES | PLANNED | — |
| TC-072 | Multi-currency separation | API/P0 | FR-090,093；TASK-025 | HKD/USD customer | account/aging | separate results；no undefined grand total | rollback | YES | PLANNED | — |
| TC-073 | Active/Archive statement routing | DB/P0 | FR-095,096,133～140；TASK-025,029 | events both tiers | current/long range | current active-only；range union no duplicate/missing | rollback | YES | PLANNED | — |
| TC-074 | Exposure components and status | CONTRACT/P0 | FR-099～104；TASK-026 | AR/commitment/credit/receipt mix | query Sales projection | formula exact，versions/reasons explainable | rollback | YES | PLANNED | — |
| TC-075 | Limit warning vs hold | CONTRACT/P0 | FR-103,104；TASK-026 | null/0/over/hold | query | meanings distinct；only Hold blocks new credit sale | rollback | YES | PLANNED | — |
| TC-076 | Exposure provider outage | RECOVERY/P0 | FR-105～107；DES-020；TASK-026 | timeout/stale/missing | Sales check | UNKNOWN，never zero；alert/correlation | restore provider | YES | PLANNED | — |
| TC-077 | Opening template/precheck no side effect | API/P0 | FR-108～112；TASK-027 | valid/invalid CSV | precheck | detailed summary；0 number/AR/claim | purge job | YES | PLANNED | — |
| TC-078 | Opening same/different hash dedupe | IDEMPOTENCY/P0 | FR-110,117；TASK-027 | same external key A/A/B | confirm | replay duplicate；B conflict；one invoice/effect | void fixture | YES | PLANNED | — |
| TC-079 | Opening document isolation | INTEGRATION/P0 | FR-113～116；TASK-027 | mixed rows/documents | confirm | invalid doc all fails；valid docs succeed independently | void | YES | PLANNED | — |
| TC-080 | Opening worker crash/resume | RECOVERY/P0 | FR-118；TASK-027 | kill mid-job | restart | completed not duplicate；counts exact；failed retryable | reset | PARTIAL | PLANNED | — |
| TC-081 | CSV encoding/formula/size security | SECURITY/P0 | FR-111,119；SEC-011,013；TASK-027 | BOM/bad UTF8/`=CMD`/50MiB+ | upload/precheck/result | safe reject/neutralize；private file；bounded errors | purge files | YES | PLANNED | — |
| TC-082 | Opening permission/download owner | SECURITY/P0 | FR-108,119；SEC-001,007；TASK-027 | owner/other/no permission | APIs/download | only authorized owner/scope；no existence leak | purge | YES | PLANNED | — |
| TC-083 | Document snapshot stability | INTEGRATION/P0 | FR-120～123；TASK-028 | change masters after issue | regenerate | identical formal payload/hash；status watermark only | purge PDF | YES | PLANNED | — |
| TC-084 | PDF/CSV injection | SECURITY/P0 | FR-124；SEC-010,011；TASK-028 | HTML/script/formula/control chars | render/export | never executes；content safely encoded | purge | YES | PLANNED | — |
| TC-085 | Export filter/owner/expiry | SECURITY/P0 | FR-126～129；TASK-028 | huge filter, owner/other, expired | create/download | bounded snapshot；only owner/scope；expired 410 | purge | YES | PLANNED | — |
| TC-086 | Audit completeness | INTEGRATION/P0 | FR-130～132；TASK-028 | all critical actions success/fail | query audit | actor/time/reason/outcome/correlation complete, secrets absent | rollback | YES | PLANNED | — |
| TC-087 | Read/print/export no business side effect | INTEGRATION/P0 | FR-125,129；TASK-028 | capture versions/timestamps | read/render/export | settlement/version/last_business_updated unchanged | purge files | YES | PLANNED | — |
| TC-088 | Archive eligibility/open matter | INTEGRATION/P0 | FR-133～136；TASK-029 | outstanding/available/operation/legal hold | archive scan | only eligible terminal roots selected；UNKNOWN skipped | rollback | YES | PLANNED | — |
| TC-089 | Archive atomic copy/hash/routing/delete | DB/P0 | FR-137～140；DES-018；TASK-029 | eligible aggregate | archive | counts/hash exact；one tier；permanent index ARCHIVE | rollback isolated DB | YES | PLANNED | — |
| TC-090 | Archive interruption matrix | RECOVERY/P0 | FR-139,140；TASK-029 | kill copy/hash/manifest/routing/delete | rerun | active never lost；same hash resumes；different hash conflict | reset DB | PARTIAL | PLANNED | — |
| TC-091 | Archived source trace | INTEGRATION/P0 | FR-135～138；TASK-029 | SO/Shipment and Invoice in different tiers | traverse both directions | correct stable refs without Active FK dependency | rollback | YES | PLANNED | — |
| TC-092 | Archive immutable/retention/legal hold | SECURITY/P0 | FR-141～143；SEC-009；TASK-029 | archive rows, hold/no hold | update/delete/purge | app mutation denied；hold prevents purge；approved age only | rollback | YES | PLANNED | — |
| TC-093 | Reconciliation seeded mismatches | OBSERVABILITY/P0 | FR-132,139；DES-023；TASK-030 | corrupt isolated projections/source/routing | run checker | all classes detected with safe IDs；no auto mutation | restore fixture | YES | PLANNED | — |
| TC-094 | Metrics/log correlation and redaction | OBSERVABILITY/P1 | FR-130～132；SEC-012；TASK-030 | operation through job/provider | inspect telemetry | correlation end-to-end；bounded labels；no secrets/reason | purge test logs | YES | PLANNED | — |
| TC-095 | Alert/runbook drills | RECOVERY/P1 | FR-139～143；TASK-030 | stuck lease/provider unknown/hash conflict | trigger | expected alert、owner、safe stop及documented recovery | clear alerts | PARTIAL | PLANNED | — |
| TC-096 | 7.3m Active query performance | PERFORMANCE/P1 | NFR-001,002,007,009；TASK-031 | exact production-like dataset | mixed query benchmark | Active p95≤2s；Archive exact≤3s/range≤5s；evidence saved | retain perf DB | PARTIAL | PLANNED | — |
| TC-097 | 50-user mixed load/backpressure | PERFORMANCE/P1 | NFR-002,004,005,008；TASK-031 | 50 users+jobs | 30m+ load | 10k batch≤30m、interactive SLO met、no pool starvation；503/backpressure safe | stop load | PARTIAL | PLANNED | — |
| TC-098 | 100-line/PDF performance | PERFORMANCE/P1 | NFR-003,006,008；TASK-031 | 100 lines/500 sources | save/confirm/render | ≤3s or 202；preview≤3s；heap bounded | purge | PARTIAL | PLANNED | — |
| TC-099 | Backup/restore integrity | HA_DR/P0 | FR-139～143；NFR-010；DES-025；TASK-031 | Active/Archive/files/key versions | backup and isolated restore | manifests/source/ledger/balances/PDF samples exact | destroy isolated env | PARTIAL | PLANNED | — |
| TC-100 | Approved RTO/RPO drill | HA_DR/P1 | NFR-010；DES-025；TASK-031,032 | RTO≤4h/RPO≤15m | timed failover/restore | measured RTO≤4h、RPO≤15m且integrity reconciliation pass | restore normal | NO | PLANNED | — |

## 6. Mechanical Requirement Coverage

Functional requirements covered: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140, FR-141, FR-142, FR-143.

Non-functional and security requirements covered: NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010; SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015.

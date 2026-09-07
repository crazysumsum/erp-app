# Customer Management 測試案例

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/customer_management/requirement.md` 0.1 Draft |
| 設計來源 | `docs/customer_management/design_spec.md` 0.1 Draft |
| UI/UX基準 | `docs/frontend-design.md` |
| 文件日期 | 2026-09-07 |
| 測試階段 | 測試設計，尚未執行 |
| 初始狀態 | 所有案例均為`NOT RUN` |
| 目標環境 | 待執行前確認；Migration、constraint、transaction、concurrency、worker、crypto、file、效能及復原案例必須使用隔離的真實MySQL／private storage／scanner測試環境 |
| Build／Commit | 待執行前記錄 |

> 本文件只定義測試案例，不代表功能已通過。本輪不執行任何測試。涉及永久刪除、封鎖、銀行明文、金鑰輪替、惡意檔、Migration、故障注入、容量及復原的案例，只可在隔離測試環境使用虛構資料執行。

## 1. 測試目標與範圍

驗證 Customer Management 的公司客戶主資料、唯一性、地址、聯絡人、識別資料、交易預設、信用政策、狀態、啟用審批、設定、銀行帳戶、一般／敏感附件、CSV匯入匯出、稽核、權限、下游lookup、效能及營運復原符合需求與設計；所有state-changing操作在重送、並發、失敗及重啟後仍保持一致。

### 1.1 範圍內

- Customer CRUD、搜尋、詳情、完整度、狀態機、Code特批及reference guard。
- Address／Contact多用途與default、Identifier唯一性、optional Credit Policy。
- Customer Settings、Activation Approval、Block／Unblock及職責分離。
- Bank encryption、mask、reveal、duplicate、rotation、backup／restore及明文生命週期。
- General／Bank Sensitive attachments的upload、scan、storage、授權、preview/download、delete及orphan cleanup。
- RFC 4180 CSV template、precheck、row-level partial success、worker recovery、result、retention及安全export。
- Sales／Fulfillment／Invoice／AR及未來Payment／Refund的purpose-specific lookup contract；只驗證Customer邊界及快照，不重算交易。
- Migration、API、DB、UI、audit、security、performance、observability、deployment及rollback。

### 1.2 範圍外

- 客戶定價、折扣、促銷、匯率、AR暴露／可用信用額計算及交易豁免流程。
- Sales Order、Shipment、Invoice、Payment、Refund或Reconciliation交易本身及財務分錄正確性。
- Customer hierarchy、group credit、臨時送貨地址、個人會員、row-level sales隔離、OCR、電子簽署及入口網站。
- 正式滲透測試、密碼學演算法認證及法規合規認證；本文件涵蓋功能性安全回歸及security review evidence。

## 2. 系統模型與風險優先級

主要路徑是「Vue／API client → auth policy與AJV → Customer domain service → MySQL transaction＋Customer audit」。另有三個高風險邊界：「Bank service → shared key rings → encrypted DB」、「multipart → temp → malware scan → metadata transaction → private storage」及「CSV storage → precheck → job/row → lease worker → Customer aggregate」。

| 風險 | Likelihood | Impact | Priority | 核心案例 |
| --- | ---: | ---: | --- | --- |
| 銀行明文、key、cipher metadata或敏感文件經API、log、audit、CSV、cache、URL、備份外洩 | 4 | 5 | P0 | BANK-001～016、FILE-001～013、AUTH-008 |
| 權限組合、system-admin委派、自我審批、stale claim或IDOR造成越權 | 4 | 5 | P0 | AUTH-001～010、APR-003～012、BANK-003/004 |
| Code／Legal Name／Identifier或default只在應用層成立，競態產生重複／雙default | 4 | 5 | P0 | MIG-005、CORE-003/004/011、PARTY-002/007/009、BANK-009 |
| 狀態／審批並發或重送造成非法終態、錯誤交易資格或重複audit | 4 | 5 | P0 | STATE-001～010、APR-007～012 |
| Credit null／0／On Hold混淆，導致下游錯誤信用決定 | 3 | 5 | P0 | CREDIT-001～008、INT-005 |
| Attachment DB與filesystem部分失敗造成孤兒、遺失或未授權下載 | 4 | 5 | P0 | FILE-003～013、OPS-006 |
| CSV逐列交易／worker crash造成半個aggregate、重複Customer或錯誤統計 | 4 | 5 | P0 | IMP-004～014 |
| Customer／Address載入後被停用，submit未重驗仍產生新交易 | 3 | 5 | P0 | STATE-003、PARTY-003～005、INT-001～006 |
| Migration碰撞、半套用、缺key/scanner/storage造成不可啟動或不可復原 | 3 | 5 | P0 | MIG-001～008、BANK-016、FILE-013、OPS-004～008 |
| 100k Customers、50 users及10k CSV下超時、鎖競爭或資源失控 | 3 | 4 | P1 | LIST-001～006、IMP-015、OPS-001～003 |

## 3. 測試資料基線

| 代號 | 測試資料 |
| --- | --- |
| U-VIEW | Active user，只持有`customer.view` |
| U-MGMT | Active user，持有`customer.view＋customer.mgmt`；沒有approval、bank或settings |
| U-APR-A／U-APR-B | 兩名Active users，持有`customer.view＋customer.approval`，彼此獨立 |
| U-BANK-R | Active user，持有`customer.view＋customer.bank.view` |
| U-BANK-W | Active user，持有`customer.view＋customer.bank.view＋customer.bank.mgmt`；approved device |
| U-SET | Active user，持有`customer.view＋customer.settings`；approved device |
| U-SYS | 只有受保護`system-admin`角色；按設計有四項非Bank Customer permissions，沒有Bank permissions |
| U-SALES／U-FUL／U-AR／U-PAY | 只持對應下游流程權限，不持Customer管理權限 |
| U-NONE／U-DISABLED／U-STALE | 無Customer權限Active user／disabled user／token後被撤權user |
| C-DRAFT | 從未引用Draft，version=1，Code `CUS-001`、Legal Name `Alpha Wholesale Limited`、HKD |
| C-ACTIVE | Active Customer，含多地址／聯絡／識別／credit及兩個masked banks |
| C-PENDING | U-MGMT提交、指派U-APR-A的Pending Customer及request |
| C-SUSP／C-BLOCK／C-ARCH | Suspended／Blocked／Archived Customers |
| C-REF | 已被Order/Shipment/Invoice或Attachment reference引用，且ever_activated_at有值 |
| ADDR-SHIP-DEF／ALT | 同一Customer的active default／alternative Shipping Addresses |
| CONTACT-BILL-A／B | 同一Customer兩名active Billing/AR contacts；A為default |
| IDENT-HK | business_registration＋HK＋正規化值唯一fixture |
| CREDIT-NULL／ZERO／HOLD | 無policy row／limit `0.0000` normal／limit可空且status on_hold |
| CUR-HKD／USD／INACTIVE | Active HKD、Active USD、Inactive幣別；Payment Term亦備active/inactive/null |
| BANK-A | 虛構帳號`000-123456-789`；只可存在受控input與短暫reveal evidence |
| FILE-GEN／FILE-BANK | 合法General PDF／Bank Sensitive PNG；另備SVG、exe、polyglot、偽MIME、超20MiB及symlink fixture |
| CSV-MIXED | UTF-8 RFC4180 CSV，含valid create/upsert、warning、invalid、duplicate、child、credit及敏感header variants |
| REASON | 5～500字，例如`QA customer control verification`；另備4／501字邊界 |
| IDEM-A／IDEM-B | 不同idempotency keys；另備同key同payload與同key異payload |
| PERF | 100,000 Customers；每Customer最多20 addresses、50 contacts、10 identifiers、10 banks、20 attachments；50 concurrent users |

所有資料使用唯一run prefix。Bank、identifier、email、phone、files均為虛構；不得在evidence保存完整BANK-A或key。每個P0/P1案例執行前須記錄build、環境、actor、request ID、初始DB/file snapshot及故障注入方式。

## 4. 證據與狀態規則

- API/UI案例至少保存request、response及畫面/network evidence；state-changing案例另保存相關tables、files及audit前後快照。
- Transaction、constraint、locking、Migration、worker、crypto及file consistency案例必須提供真MySQL／真filesystem證據；mock或code inspection不能判PASS。
- Bank/File evidence不得直接保存完整帳號、key或敏感文件；以controlled search count=0、masked sample、hash／size、redacted artifact及access audit證明。
- `Actual Evidence`在實際執行前保持`—`；狀態只可由`NOT RUN`改為`PASS`、`FAIL`、`BLOCKED`或`NOT APPLICABLE`。
- 本文件是planning-only；案例存在只代表planned coverage，並不代表requirement已被實際驗證。

## 5. 需求／風險追蹤總覽

| Requirement / Risk | Priority | Test Case IDs | Latest Result | Defect IDs | Coverage Note |
| --- | --- | --- | --- | --- | --- |
| RQ-01 Migration、19 tables、catalog及startup基線 | P0 | MIG-001～008、OPS-004 | NOT RUN | — | 真MySQL、配額、半套用、shape、seed及fail-closed |
| RQ-02 列表、搜尋、詳情與一般UI | P1 | LIST-001～009、UI-001～008 | NOT RUN | — | 分頁、filter、sort、projection、URL、responsive及a11y |
| RQ-03 建立、修改、硬唯一、冪等及transaction | P0 | CORE-001～013 | NOT RUN | — | Code/Legal、aggregate、CAS、rollback、snapshot |
| RQ-04 Lifecycle、reference guard及交易資格 | P0 | STATE-001～010、INT-001～003 | NOT RUN | — | valid/invalid/repeat/race/delete及submit recheck |
| RQ-05 Address、Contact、Identifier | P0/P1 | PARTY-001～011 | NOT RUN | — | multi-purpose、default slot、ownership、unique、history |
| RQ-06 Credit Policy語意及下游界線 | P0 | CREDIT-001～008、INT-005 | NOT RUN | — | null、zero、on_hold、precision、reason、no override |
| RQ-07 Approval、Settings及Block | P0 | APR-001～012、STATE-004 | NOT RUN | — | setting snapshot、SoD、stale、reassign、concurrency |
| RQ-08 Bank敏感資料 | P0 | BANK-001～016、AUTH-008 | NOT RUN | — | permission、crypto、mask、audit、rotation、restore |
| RQ-09 General／Bank Sensitive附件 | P0 | FILE-001～013 | NOT RUN | — | validation、scanner、two-resource consistency、download |
| RQ-10 CSV Import／Export | P0 | IMP-001～015 | NOT RUN | — | RFC4180、partial success、idempotency、recovery、retention |
| RQ-11 Audit、認證、授權及輸入安全 | P0 | AUD-001～007、AUTH-001～010 | NOT RUN | — | same-transaction audit、IDOR、stale claims、redaction |
| RQ-12 Downstream contracts與snapshots | P0 | INT-001～008 | NOT RUN | — | Sales/Fulfillment/Invoice/AR/Payment boundaries |
| RQ-13 效能、監控、部署及復原 | P1/P0 | OPS-001～009 | NOT RUN | — | SLA、alerts、backup、rollback、smoke、release evidence |

## 6. 詳細測試案例

### 6.1 Migration、Schema、Permission及啟動基線

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MIG-001 | P0 | design §5.18；migration配額不可碰撞 | Migration/Git | 最新main及所有批准design可讀 | 實際migration inventory | Fetch main；掃描四位前綴、Item/Supplier配額及Customer provisional mapping | 每個prefix唯一；既有檔/checksum不變；Customer整組配置無碰撞並同步文件 | commit、inventory、checksum及review記錄 | — | NOT RUN |
| MIG-002 | P0 | NFR-009；全新DB可部署 | Migration/DB | 空白隔離MySQL 5.7；fake keys/scanner/storage ready | CUST-M01～M15 | 依正式runner執行全部migration並啟動server | 全部成功；ledger及19張table/schema符合design；health ready | migration output、schema hash、health log | — | NOT RUN |
| MIG-003 | P1 | Migration冪等及半套用收斂 | Migration/DB | 已完成DB；另逐支製造部分DDL/seed | 每支Customer migration | 重跑全部；對半套用情境再重跑 | 已完成no-op；半套用安全收斂；無重複seed、permissions或資料遺失 | 兩次output、ledger、schema/data diff | — | NOT RUN |
| MIG-004 | P0 | NFR-013；Business Master相容 | Migration/DB | 無tables、相容existing tables、不相容shape三DB | currencies/payment_terms、HKD | 執行CUST-M02及重跑 | 無table時正確建立；相容時收斂；不相容shape明確fail且不改資料；HKD恰一筆active | schema/seed/transaction evidence | — | NOT RUN |
| MIG-005 | P0 | BR-005～007/010/013/030、NFR-007；DB invariants | DB/Concurrency | 真MySQL兩connections | Code、Legal、Identifier、Address/Contact/Bank default、pending approval競態 | Barrier同步insert/update衝突資料 | Unique/generated slots只允許合法結果；另一交易stable error；無重複／雙default／雙pending | responses、constraints、lock log、final SQL | — | NOT RUN |
| MIG-006 | P0 | SEC-002～007；permission seed及delegation | Migration/Auth | 空DB；U-SYS/U-MGMT | 六permissions及system-admin role | Migration後查roles；用U-SYS委派Bank role；直接呼Bank route | 六permission rows恰一份；U-SYS只有四項非Bank；可在高強度role流程委派但未獲Bank role前不能access | role/permission SQL、responses、audit | — | NOT RUN |
| MIG-007 | P0 | SEC-010、NFR-010；安全config fail closed | Startup/Security | Customer Bank/File schema已部署 | 缺/壞encryption/lookup keys、scanner、private roots、limits | 各配置啟動server | 全部fail closed且health not ready；log只指設定類型，不洩漏value/path credential | exit/health、redacted logs | — | NOT RUN |
| MIG-008 | P1 | NFR-009；upgrade/forward-only/partial capability | Deployment | 有現行User/Item資料的DB及舊client/server | Customer migrations與分Phase deployment | Upgrade、驗既有功能、回滾相容server；檢查未完成capability routes/menu | 舊資料/功能不變；不drop/down；只有schema+server+client+permission齊全capability可見 | 前後SQL、route/menu inventory、regression/rollback log | — | NOT RUN |

### 6.2 列表、搜尋與詳情

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-001 | P1 | FR-LIST-001、NFR-002；server pagination | API/DB | U-VIEW；至少125 Customers含Archived | page缺省；pageSize 1/20/100及0/101 | GET `/customers`並跨頁 | 預設20、上限100；非法400；items/total正確；預設排除Archived | responses、count SQL、query trace | — | NOT RUN |
| LIST-002 | P1 | FR-LIST-002/003；多欄搜尋 | API/DB | U-VIEW；各欄唯一fixtures | Code、Legal/Trading、Identifier、phone、email、address；case/trim | 對每類完整/部分值搜尋 | 全部指定欄可命中；Code/Name忽略case/trim；沒有child join重複或錯total | responses、fixture對照、SQL | — | NOT RUN |
| LIST-003 | P1 | Exact Code優先及Unicode normalization | API/DB | 有exact code、name含同term、NFKC/空白變體 | q=`CUS-001`及Unicode variants | Search並比較排序 | Exact normalized Code第一；Legal exact其次；partial穩定；不同法人不被過度合併 | response ordering、normalized keys | — | NOT RUN |
| LIST-004 | P1 | FR-LIST-004；組合filters | API/DB | 跨status/currency/term/manager/category/industry/territory/credit/date資料 | 單一及多filter | 逐一及組合查詢 | 只回交集；inactive歷史值可明確filter；日期邊界按系統時間政策 | requests/responses、對照SQL | — | NOT RUN |
| LIST-005 | P1 | FR-LIST-005；完整度filters | API/DB | 逐一缺shipping/billing default、contact、term、credit、bank、attachment | missing[]單一/多值 | Filter及GET completeness | 每類判定正確；多值按設計交集；不因optional缺失標成不能Active | responses、EXISTS SQL、fixture matrix | — | NOT RUN |
| LIST-006 | P1 | FR-LIST-006/007；排序與projection | API/DB | 多筆相同sort value；有長名稱/聯絡資料 | allowlisted/invalid sort及asc/desc | 各排序翻頁 | Code/Legal/status/manager/updated排序正確且ID穩定；非法sort 400；summary欄完整 | responses、排序對照、SQL | — | NOT RUN |
| LIST-007 | P0 | FR-LIST-008、BR-031；敏感列表隔離 | API/Security | U-VIEW/U-BANK-R；Customer含Banks/Bank Sensitive files | list/search suggestions/export | 以兩角色查詢並掃payload | 不論bank.view，一般list/suggestion不含明文、可推導值、cipher、sensitive filename | payload/header/log scans | — | NOT RUN |
| LIST-008 | P1 | FR-VIEW-001～006；detail及large children | API/UI | U-VIEW；各status；>100 contacts/addresses | root/credit/children/masked banks/general files | GET detail並開各tabs/child pagination | 一般資料完整；children上限後走server pagination；non-Active警示；無下游重算 | response、screenshots、SQL counts | — | NOT RUN |
| LIST-009 | P1 | FR-LIST-009/010；URL與load states | UI | U-VIEW | q/filter/page/sort；empty/slow/403/500 | 操作後refresh/back/forward及注入response | URL還原非敏感狀態；empty/loading/error/forbidden分明；不建立未定義跨裝置saved filter | URL、screenshots、network | — | NOT RUN |

### 6.3 Core customer master（CORE）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| CORE-001 | P0 | FR-CREATE-001～003、AC-009；最小建檔 | API/DB/UI | U-MGMT；審批關閉 | 唯一Code/Legal Name，其餘optional留空 | UI/API建立Draft後查詢DB/detail | 單一Customer成功；預設status/版本/時間/actor正確；optional為null而非虛構值 | request/response、DB row、UI截图、audit | — | NOT RUN |
| CORE-002 | P0 | FR-CREATE-004～009；Aggregate原子性 | API/DB | U-MGMT；審批關閉 | Customer＋多地址/聯絡人/identifier/credit | 一次建立；再於最後child注入validation/DB失敗 | 成功時全量落庫；任一失敗時root、children、audit全回滾 | payload、DB before/after、transaction/audit logs | — | NOT RUN |
| CORE-003 | P0 | BR-001/005、AC-001/010；Code唯一與邊界 | API/DB/UI | U-MGMT | 空白、最短/最長、大小寫/前後空白、Unicode、特殊字元、重複；並發同Code | create/update及兩請求同步提交 | 僅符合人工輸入規則者成功；正規化後唯一；競態只一筆成功且錯誤可理解 | validation responses、DB constraint、concurrency trace | — | NOT RUN |
| CORE-004 | P0 | BR-006、AC-002；Legal Name禁止重複 | API/DB/Import | 已有同名Customer | 大小寫、全半形/Unicode normalization、前後/連續空白變體 | UI/API/import建立與修改 | 按規格canonicalization後重複即阻擋，不只是warning；競態仍由DB保護 | payloads、responses、canonical DB values | — | NOT RUN |
| CORE-005 | P1 | BR-004、AC-003；Trading Name柔性提示 | UI/API | 已有相同Trading Name | 相同/近似名稱 | 建立及修改後確認提示並繼續 | 提示不阻擋提交；Legal Name唯一規則不受影響；audit保留最終輸入 | screenshot、response、DB/audit | — | NOT RUN |
| CORE-006 | P0 | FR-CREATE-006/007、FR-APPROVAL-001；建檔啟用模式 | API/UI/Workflow | 分別審批OFF/ON | 完整與最小必填Customer | 選擇儲存Draft/直接啟用/提交審批 | OFF可直接Active；ON時需要審批的路徑不可繞過；Draft可保存 | state responses、DB history、audit | — | NOT RUN |
| CORE-007 | P1 | FR-CREATE-001～009、FR-EDIT-001～008、SEC-013；輸入契約 | API/UI | U-MGMT | null/empty/blank、超長、非法enum/date/decimal、unknown props、HTML/script | 對create/update逐欄送入 | 400含field-level錯誤；無部分寫入；輸出編碼安全；unknown欄不被mass assign | response matrix、DB diff、UI screenshot | — | NOT RUN |
| CORE-008 | P1 | FR-EDIT-001～004；一般資料更新 | API/DB/UI | Existing Draft/Active | Legal/Trading name、category、industry、territory、currency、term、manager | 逐欄與組合更新，含停用catalog值 | 合法更新成功；新選擇不可用inactive catalog；既有歷史值仍可顯示；version遞增 | responses、DB/audit、screenshots | — | NOT RUN |
| CORE-009 | P0 | FR-EDIT-005/006、BR-034/035；重要欄位理由與交易快照 | API/Integration | Active Customer已有下游交易快照 | 修改Legal Name、currency、term、tax identifier等critical欄位；空/過長reason | 更新後讀取Customer及舊交易 | 合法reason才可更新；Customer顯示新值；舊交易snapshot不被回寫；新交易取最新有效值 | request/response、old/new DB rows、downstream snapshot | — | NOT RUN |
| CORE-010 | P0 | FR-EDIT-007、BR-033、SEC-012；Customer Code高風險修改 | API/Security | U-MGMT與無權限actor；高強度驗證狀態 | 新Code、重複Code、過期/重放challenge | 嘗試改Code並查history/audit | 只有規格授權且驗證有效者可改；唯一性仍成立；舊Code可追溯；不得改寫交易snapshot | auth trace、responses、history/audit、DB | — | NOT RUN |
| CORE-011 | P0 | FR-EDIT-008、BR-038；樂觀鎖 | API/UI/DB | 同一Customer version=N | A/B同時修改不同或相同欄 | A先提交，B用舊version提交，再刷新重試 | A成功；B為409且不覆蓋；UI展示衝突/最新值；重試以新version成功 | requests、409 response、DB versions、screenshots | — | NOT RUN |
| CORE-012 | P0 | NFR-008、BR-041；建立冪等 | API/DB | U-MGMT | 同Idempotency-Key同payload、同key異payload、不同key同合法資料 | 順序/並發重送及模擬client timeout | 同key同payload只一個aggregate並回同結果；異payload衝突；唯一規則不被繞過 | request IDs、idempotency rows、DB counts、logs | — | NOT RUN |
| CORE-013 | P0 | NFR-006/008；提交不確定性與原子失敗 | API/DB/Ops | 可注入DB/audit failure及response丟失 | create/update請求 | 在commit前、commit後response前分別故障並安全重試 | commit前無殘留；commit後可由request/idempotency查明單一結果；audit與業務狀態一致 | fault-injection trace、DB/audit reconciliation | — | NOT RUN |

### 6.4 Lifecycle and status（STATE）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| STATE-001 | P0 | FR-STATUS-001、BR-022～029；合法狀態矩陣 | API/UI/DB | U-MGMT；各起始status | Draft/Active/Suspended/Blocked/Archived | 逐條執行design state machine允許轉移 | 只允許定義轉移；新status、version、effective_at、actor、reason與history一致 | request/response、state history、audit | — | NOT RUN |
| STATE-002 | P0 | FR-STATUS-002；非法/重複轉移 | API/UI | 各status | 自轉移、跳級、重複archive/activate | API及UI嘗試 | UI不提供非法action；直接API回409/422；狀態與version不變；不產生假history | responses、DB diff、screenshots | — | NOT RUN |
| STATE-003 | P0 | BR-025/026、AC-022/023；Active下游資格 | API/Integration | 每種Customer status；picker cache可控 | 建立Sales/fulfillment/AR等新交易 | 搜尋後先轉status，再提交交易 | 只有提交時仍Active者可建立新交易；picker舊結果不能繞過；既有交易仍可查 | downstream requests、responses、state timeline | — | NOT RUN |
| STATE-004 | P0 | FR-STATUS-003；Suspend/reactivate | API/UI | Active Customer | 合法/空/過長reason | Suspend後嘗試新交易，再reactivate | Suspend需理由並禁止新交易；歷史交易不受損；reactivate後恢復資格且全程留痕 | screenshots、responses、history/audit | — | NOT RUN |
| STATE-005 | P0 | FR-STATUS-004、BR-027、SEC-004/012；Block/unblock | API/Security | Active/Suspended；有/無所需高風險授權actor | fraud/credit等reason、過期challenge | Block/unblock及下游提交 | 權限與驗證均成立才成功；Blocked即時阻擋新交易；解除後依規格回到正確狀態 | auth evidence、responses、history | — | NOT RUN |
| STATE-006 | P0 | FR-STATUS-005、BR-029；Archive前置檢查 | API/Integration | Active/Suspended且有/無open flow | open orders/shipments/invoices等 | Archive | 有阻擋事項時拒絕並列出安全摘要；無阻擋時成功；外部檢查失敗採fail closed | dependency traces、response、DB state | — | NOT RUN |
| STATE-007 | P1 | FR-STATUS-006；Archived可見性/還原 | UI/API | 已Archived Customer | includeArchived filter及restore reason | 查list/detail、restore | 預設list排除或清楚標示；授權查詢可見；restore依狀態矩陣成功且版本留痕 | screenshots、responses、history | — | NOT RUN |
| STATE-008 | P0 | FR-STATUS-007、BR-029；永久刪除政策 | API/DB | Draft/Archived；分別有/無任何引用或audit | delete request及confirm token | 執行永久刪除 | 僅符合明訂條件者可刪；有引用/法定保留即拒絕；audit/必要墓碑依規格保留且無孤兒 | response、FK/reference query、audit | — | NOT RUN |
| STATE-009 | P0 | FR-STATUS-008；狀態競態 | API/DB | version=N Active且有open flow邊界 | A suspend、B block/archive/update | 同步送出 | 只一個基於N成功；另一個409；不出現非法終態或遺失history | concurrency trace、DB version/history | — | NOT RUN |
| STATE-010 | P0 | BR-041；狀態命令冪等/不確定結果 | API/DB | 可丟失response | 同request-id重送與異request-id重複命令 | 執行並重試 | 同命令不產生重複history/audit；可辨識已完成；相反命令仍需新version及授權 | request/audit correlation、DB rows | — | NOT RUN |

### 6.5 Addresses, contacts and identifiers（PARTY）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PARTY-001 | P1 | FR-PARTY-001；地址CRUD/多用途 | API/UI/DB | U-MGMT；Customer exists | billing/shipping/registered/other；一址多用途 | create/read/update/deactivate | 用途集合正確保存；驗證/版本/排序一致；停用不硬刪歷史 | responses、DB rows、screenshots | — | NOT RUN |
| PARTY-002 | P0 | FR-PARTY-002、BR-010；預設地址唯一性 | API/DB | 同Customer多個有效shipping/billing地址 | A/B同步設default；deactivate current default | 並發切換及停用 | 每Customer每用途最多一個有效default；切換原子；無瞬間/最終雙default；停用結果明確 | concurrency logs、unique/index evidence、DB query | — | NOT RUN |
| PARTY-003 | P0 | BR-011/042、AC-025；Fulfillment選址規則 | Integration/UI | Active Customer有default及其他有效shipping | default、非default、inactive、其他Customer address ID | 建shipment並選址 | 發貨時必選；default預選可更換；只接受該Customer有效shipping地址 | UI/network、shipment snapshot、responses | — | NOT RUN |
| PARTY-004 | P0 | BR-012、DEC-003～005；無地址/臨時地址邊界 | Integration | Customer無有效shipping或default | 無地址、臨時文字、wrong-purpose地址 | 建order與shipment | 下單不要求地址；發貨時必須阻擋，不允許臨時未保存地址，也不得靜默取billing | screenshots、responses、snapshot | — | NOT RUN |
| PARTY-005 | P1 | BR-035/041；地址歷史與引用 | API/DB/Integration | 地址已被shipment snapshot/reference | 修改/停用/嘗試刪除 | 操作後查舊shipment | 舊交易地址快照不變；受引用資料不可造成孤兒；current master反映新值 | before/after DB、responses | — | NOT RUN |
| PARTY-006 | P1 | FR-PARTY-003；聯絡人CRUD/多用途多筆 | API/UI | U-MGMT | ordering/billing/shipping/finance/general；一人多用途 | 建立多名同用途contact、修改/停用 | 每用途容許多名；字段及用途正確；停用後新流程不可選但歷史保留 | responses、DB rows、screenshots | — | NOT RUN |
| PARTY-007 | P0 | FR-PARTY-004、BR-013；預設聯絡人競態 | API/DB | 同用途多個active contacts | A/B同步設default | 並發切換、停用default | 每Customer每用途最多一個active default；結果原子可預期 | concurrency trace、constraint、DB query | — | NOT RUN |
| PARTY-008 | P1 | FR-PARTY-005；聯絡資料validation/history | API/UI/Integration | contact已被交易引用 | email/phone boundaries、Unicode name、opt-in flags | create/update/deactivate並查舊交易 | validation一致；PII按權限顯示；舊交易snapshot不被改寫 | responses、screenshots、snapshot | — | NOT RUN |
| PARTY-009 | P0 | FR-PARTY-006、BR-007；Identifier唯一性 | API/DB/Import | 已有tax/company/other IDs | 正規化變體、跨Customer重複、並發duplicate | create/update/import | 按type+canonical value唯一；競態只一個成功；敏感identifier不在無關projection | responses、DB constraint/query、payload scan | — | NOT RUN |
| PARTY-010 | P0 | SEC-006、NFR-008；Child IDOR及版本控制 | API/Security | Customer A/B各有children | 用A route操作B child；stale child version | CRUD/default/deactivate | 全部404/403且不洩漏存在性；stale update 409；沒有跨Customer污染 | request/response、DB diff、audit | — | NOT RUN |
| PARTY-011 | P1 | FR-PARTY-007/008；大量children與邊界 | API/UI/DB | Customer有>100地址/聯絡/identifier | 空白、長欄位、duplicate order、pagination | 分頁/search/sort及CRUD | 無截斷/重複/漏項；穩定排序；合理上限/錯誤；UI可操作 | counts、responses、screenshots、query trace | — | NOT RUN |

### 6.6 Credit policy（CREDIT）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| CREDIT-001 | P0 | FR-CREDIT-001、BR-016；未配置語義 | API/DB/Integration | Customer無credit row | detail、order/AR查詢 | 查詢並建立下游交易 | 回傳not configured/null語義；不得當成0或無限額；下游採明訂default policy | response、DB absence、downstream trace | — | NOT RUN |
| CREDIT-002 | P0 | BR-017；0與null區分 | API/UI/DB | U-MGMT | limit=null、0、0.00 | 儲存/顯示/下游判定 | null=未配置；0=明確零額度；序列化/UI/DB不混淆 | payloads、screenshots、DB values | — | NOT RUN |
| CREDIT-003 | P1 | FR-CREDIT-002；有效額度邊界 | API/DB | 有效currency catalog | 最小正數、正常值、最大值、允許小數位 | create/update/read | 精度無漂移；decimal schema一致；currency正確保存 | response、DB decimal、schema | — | NOT RUN |
| CREDIT-004 | P0 | FR-CREDIT-003；非法額度 | API/UI | U-MGMT | 負數、超最大、過多小數、NaN/科學記號、缺/停用currency | submit | 全部拒絕且無部分寫入/版本增加；field error清楚 | responses、DB before/after | — | NOT RUN |
| CREDIT-005 | P0 | FR-CREDIT-004、BR-018；Credit Hold獨立語義 | API/Integration | limit為null/0/正數 | hold on/off及reason | 設定後建order/AR操作 | hold不依賴limit是否存在；啟用hold需理由並按下游契約阻擋；解除可恢復 | responses、DB/audit、downstream trace | — | NOT RUN |
| CREDIT-006 | P0 | FR-CREDIT-005；更新/清除/競態 | API/DB | version=N credit row | 清除limit、換currency、A/B更新 | 順序與並發提交 | 清除回到not configured語義；合法換currency；stale update 409；無遺失更新 | requests、DB versions、audit | — | NOT RUN |
| CREDIT-007 | P0 | FR-CREDIT-006、SEC-011；授信留痕與外洩 | API/Audit/Export | 有credit變更 | old/new/reason及內部notes | 更新後查audit/list/export | audit有old/new/reason；未授權projection不含內部notes；export遵守欄位規則 | audit payload、CSV/API scans | — | NOT RUN |
| CREDIT-008 | P0 | FR-CREDIT-007、BR-039；下游最新政策及快照 | Integration | 已存在舊交易，後修改limit/hold/currency | 建新交易、查舊交易 | 比較修改前後 | 新決策取最新有效政策；歷史決策/交易snapshot不被追溯改寫；Customer模組不自行計算AR balance | downstream evidence、snapshots、DB | — | NOT RUN |

### 6.7 Approval and settings（APR）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| APR-001 | P0 | FR-SET-001、BR-022、DEC-006；預設OFF | API/UI/DB | 新環境/無設定row及顯式OFF | create/activate/update actions | 以U-MGMT操作 | 無設定等同OFF；可依權限直接完成；不得因殘缺設定卡住；讀API回typed effective value | response、config DB、state history | — | NOT RUN |
| APR-002 | P0 | FR-SET-002～006、BR-019；設定治理 | API/Security/Audit | U-SET與無權限actor；version=N | OFF→ON→OFF、非法值、stale version | read/update並並發提交 | 只有customer.settings可改；schema驗證；樂觀鎖；audit有old/new/reason；設定變更不追溯改寫已提交request | requests、DB versions、audit | — | NOT RUN |
| APR-003 | P0 | FR-APPROVAL-001/002；提交審批 | API/UI/DB | Approval ON；Draft/變更草稿；U-MGMT | 合法指定U-APR-A | Submit | request狀態Pending；snapshot固定；Customer狀態按設計；通知/queue產生一次；不可直接啟用繞過 | response、approval/request rows、queue/audit | — | NOT RUN |
| APR-004 | P0 | BR-023、AC-031；審批人資格 | API/Security | Approval ON | self、disabled、無approval permission、過期permission、合法他人 | 分別submit | 只有當下有效且非本人的指定審批人成功；失敗無殘留request | auth snapshots、responses、DB | — | NOT RUN |
| APR-005 | P0 | FR-APPROVAL-003、SEC-010/011；Snapshot最小化 | API/DB | Customer含bank、Bank Sensitive file及一般資料 | submit後再修改source | 查approval snapshot/API | snapshot為提交時版本且只含審批必要欄；不得含cipher、明文bank、restricted file內容；source後改不污染舊snapshot | snapshot row/payload scan、hash/diff | — | NOT RUN |
| APR-006 | P0 | FR-APPROVAL-004；Approve | API/UI/DB | Pending assigned to U-APR-A | valid reason/version | Approve後重查Customer/request | 一次原子完成；Customer/變更生效至正確狀態；decision actor/time/reason/version/audit一致 | request/response、DB/history/audit | — | NOT RUN |
| APR-007 | P0 | FR-APPROVAL-004、BR-022；Reject | API/UI | Pending | 空/邊界/超長/合法reason | Reject | 必填合法reason才成功；Customer維持可修訂狀態；不得套用pending changes；可追溯 | responses、DB diff、audit | — | NOT RUN |
| APR-008 | P1 | FR-APPROVAL-005；Withdraw | API/Security | Pending；submitter/其他user | withdraw reason | 雙方嘗試withdraw | 只有允許actor/狀態可撤回；queue移除；Customer回到規定狀態；已決策不可撤回 | responses、request/history | — | NOT RUN |
| APR-009 | P0 | FR-APPROVAL-006、BR-024；關鍵修改使審批失效 | API/Workflow | Pending request | 修改Code/Legal Name/credit/status等critical欄位 | 修改並嘗試approve舊request | 按design使舊request失效/拒絕；需重新submit新snapshot；不可批准過時內容 | versions、approval rows、responses | — | NOT RUN |
| APR-010 | P1 | FR-APPROVAL-006；非關鍵修改差異 | API/UI | Pending request | 修改非critical欄（如允許的note/tag） | 修改後查看request/detail | 行為與critical-field清單一致；UI清楚顯示pending snapshot與current差異；不靜默混合 | screenshots、payload diff、audit | — | NOT RUN |
| APR-011 | P0 | FR-APPROVAL-007；Queue與改派 | API/UI/Security | 多個Pending分配A/B | filters、reassign至合法/非法actor | 查queue及改派 | 只顯示授權範圍；穩定pagination；合法改派保留歷史並通知一次；非法改派拒絕 | responses、screenshots、assignment/audit rows | — | NOT RUN |
| APR-012 | P0 | BR-041；審批競態/冪等 | API/DB | 同一Pending version=N | A approve、B reject；雙擊/timeout重送 | 同步提交 | 僅首個合法decision成功；另一個409；無雙決策、重複通知或重複audit；結果可由request ID查明 | concurrency trace、DB constraints、audit/events | — | NOT RUN |

### 6.8 Customer bank accounts（BANK）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| BANK-001 | P0 | FR-BANK-001、BR-031、SEC-002/010/011；預設遮罩 | API/UI | Customer有多幣別bank accounts | U-VIEW/U-MGMT/U-BANK-R | list/detail/search/approval/export/錯誤路徑 | 所有一般projection只回masked display；無明文、cipher、hash、IV/tag/key version | response/HTML/log/CSV scans | — | NOT RUN |
| BANK-002 | P0 | FR-BANK-002、SEC-005/014；受控Reveal | API/UI/Audit | U-BANK-R且通過fresh high auth | 一筆active bank account | reveal後等待timeout、切tab/back、refresh | 只在受控端點短暫回明文；UI自動重遮；不寫local/session storage、URL、telemetry；每次留audit | network/storage/DOM screenshots、audit | — | NOT RUN |
| BANK-003 | P0 | SEC-002/005/006；銀行權限矩陣 | API/UI/Security | 六種權限及無權限角色 | bank list/masked/reveal/create/update/default/deactivate | 逐角色逐動作 | bank.view才可主動完整查看；bank.mgmt須同時具bank.view才可維護；一般權限不得存取；UI與server一致 | permission matrix responses、screenshots | — | NOT RUN |
| BANK-004 | P0 | DEC-022；System Admin不自帶Bank權限 | Security | fresh U-SYS，後建立明確Bank角色並指派 | bank.view/bank.mgmt | 指派前後操作 | 初始不可進Bank routes/reveal；可依既有受審計委派流程明確指派；指派後僅獲授權能力 | role assignment audit、token claims、responses | — | NOT RUN |
| BANK-005 | P0 | SEC-012；高強度驗證 | API/Security | U-BANK-R/U-BANK-W | 缺challenge、過期、錯裝置、重放、降級auth、合法fresh challenge | reveal及敏感修改 | 僅綁定actor/device/action且未過期的一次性驗證可用；失敗不洩漏資料且留安全audit | auth traces、responses、audit | — | NOT RUN |
| BANK-006 | P0 | FR-BANK-003、SEC-010/011；加密落庫 | API/DB | encryption/hash keys可用 | 本地/國際帳戶、Unicode holder、各currency | Create後檢查DB及讀回遮罩 | plaintext只在必要處理期存在；DB只有AEAD cipher metadata及lookup hash；masked末位正確；一般logs無敏感值 | DB columns、crypto metadata、log scan | — | NOT RUN |
| BANK-007 | P0 | SEC-005；AAD及篡改防護 | Service/DB | 已建立bank row | 交換Customer/account ciphertext、改cipher/tag/IV/key version | 讀/reveal | AAD阻止跨row/customer替換；篡改全部fail closed並產安全事件；不回半明文 | fault results、security logs、DB diff | — | NOT RUN |
| BANK-008 | P0 | NFR-010、Design §11.5；Key缺失/失效 | API/Ops | 缺active encryption key或lookup key；unknown old version | create/reveal/list masked | 啟動及操作 | startup/readiness依design fail closed；不可保存明文或空cipher；masked非解密路徑按明訂能力運作/明確失敗 | readiness、responses、DB/log scan | — | NOT RUN |
| BANK-009 | P0 | FR-BANK-004、BR-030；預設帳戶唯一性 | API/DB | 同Customer同currency兩個active accounts | A/B同步設default；停用default | 並發切換 | 每Customer/currency最多一個active default；原子切換；無雙default；停用後結果符合政策 | concurrency trace、constraint/index、DB | — | NOT RUN |
| BANK-010 | P0 | FR-BANK-005；同Customer重複阻擋 | API/DB | 已有account | 格式/空格/分隔符/大小寫等canonical變體 | create/update及並發提交 | lookup hash正規化後重複被阻擋；只一筆成功；錯誤不揭露完整帳號 | responses、hash comparison、DB count | — | NOT RUN |
| BANK-011 | P0 | BR-027、AC-038；跨Customer重複警告確認 | API/UI | Customer A已有account；於B新增相同canonical account | 無/過期/篡改/他人warning token、合法確認 | precheck及confirm create | 先警告不直接阻擋；只有綁actor+payload+expiry的確認token可完成；token不可重放；仍不顯示其他Customer敏感資料 | request sequence、token claims、audit | — | NOT RUN |
| BANK-012 | P0 | FR-BANK-006；metadata與帳號更新 | API/DB | Existing account version=N | bank name/branch/holder/currency；新account number | update並檢查cipher/hash/version | metadata更新不無故解密/重加密；帳號變更產新cipher/hash並重跑duplicate checks；stale version 409 | before/after crypto metadata、responses | — | NOT RUN |
| BANK-013 | P0 | FR-BANK-007、BR-041/042；停用及引用 | API/Integration | default/非default；已被付款流程引用 | deactivate/delete/select | 操作並建立新付款/退款選擇 | 停用需理由；歷史reference保留；新流程不可選；硬刪受阻；default處理符合政策 | responses、downstream selection、audit | — | NOT RUN |
| BANK-014 | P1 | FR-BANK-003；欄位邊界 | API/UI | U-BANK-W | currency/country/routing/SWIFT/IBAN/local number/name boundaries | 逐欄submit | 按country/通用規則驗證；optional銀行資料不阻礙Customer建檔；錯誤不回顯多餘明文 | validation matrix、screenshots、DB diff | — | NOT RUN |
| BANK-015 | P0 | SEC-010/011/014；全鏈路洩漏掃描 | Security/Ops | 可觸發validation、500、timeout、audit、APM | unique marker account number | 走create/reveal/update/export/error/backup metadata | marker不出現在普通log、trace、metric、exception、cache、URL、CSV、approval snapshot；只有授權response短暫存在 | automated grep/scans、headers、audit redaction | — | NOT RUN |
| BANK-016 | P0 | NFR-009；輪換、重索引及還原 | Ops/DB | 多key-version資料與備份 | rotate encryption key、lookup-key reindex、restore | 分批輪換/中斷重啟/restore後驗證 | 可斷點續跑、無資料遺失/雙重明文；舊新version均可在過渡期讀；hash切換保持duplicate控制；restore具正確keys才成功 | job checkpoints、counts/hash、restore/reveal evidence | — | NOT RUN |

### 6.9 Attachments（FILE）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| FILE-001 | P1 | FR-FILE-001；一般附件上載 | API/UI/Storage | U-MGMT；storage/scanner正常 | 合法PDF/JPG/PNG等；metadata | request upload session、upload、finalize、list/download | 物件與DB metadata一致；狀態由pending/scanning到available；checksum/size/type正確 | network、object metadata、DB row、screenshots | — | NOT RUN |
| FILE-002 | P0 | FR-FILE-002、BR-032、SEC-005/006；Bank Sensitive附件 | API/UI/Security | 一般及Bank權限角色 | sensitivity=bank_sensitive檔案 | upload/list/download/metadata update | 只有customer.bank.mgmt可維護、customer.bank.view可按規格查看；一般Customer角色看不到名稱、count或內容 | permission responses、UI/payload scans | — | NOT RUN |
| FILE-003 | P0 | FR-FILE-003、BR-028；類型/內容/大小/掃毒 | API/Scanner | 可回clean/infected/error/timeout | 超限、double extension、MIME欺騙、magic mismatch、惡意檔、零byte | upload/finalize | client filename/MIME不被信任；非法或infected不可available/download；scanner不確定時fail closed | scanner result、responses、object/DB states | — | NOT RUN |
| FILE-004 | P0 | SEC-013；路徑與檔名攻擊 | API/Storage | U-MGMT | `../`、absolute path、NUL、Unicode RTL、超長名、同名、symlink-like key | upload/list/download | storage key由server生成且不能越界/覆寫；顯示名安全編碼；同名可明確區分 | object keys、responses、HTML screenshots | — | NOT RUN |
| FILE-005 | P0 | NFR-006/008；上載原子與補償 | API/DB/Storage | 可注入presign、upload、scan、DB finalize失敗 | 單一合法檔 | 每階段中斷及client重試 | 不出現available但無object或孤立可下載object；pending可回收/重試；不得重複attachment row | fault traces、DB/object before/after | — | NOT RUN |
| FILE-006 | P0 | FR-FILE-004；列表projection隔離 | API/UI | 混合General/Bank Sensitive及inactive files | U-VIEW/U-BANK-R | list/detail/count/search | 各角色只見允許項目；總數、排序、empty state不側漏受限檔案存在；無storage internals | response/UI diff、payload scan | — | NOT RUN |
| FILE-007 | P0 | FR-FILE-005、SEC-009/010/013；下載/預覽安全 | API/Browser | available/quarantined/inactive files | inline/download；篡改ID/URL；過期signed URL | 下載/預覽 | 授權於每次簽發前重驗；短期URL；quarantined/inactive不可取；Content-Disposition、nosniff、CSP/類型安全 | headers、URL expiry、responses | — | NOT RUN |
| FILE-008 | P0 | FR-AUDIT-005；下載audit時序 | API/Audit | 可注入audit失敗/stream failure | General/Bank Sensitive file | download前使audit write失敗；stream中斷 | Bank Sensitive無成功audit即不開始stream；成功/失敗狀態準確；不把內容寫audit | timing trace、audit row、network | — | NOT RUN |
| FILE-009 | P0 | FR-FILE-006、SEC-005/006；metadata/敏感度修改 | API/Security | Existing General或Bank Sensitive attachment | rename/category/sensitivity/version | 各角色update，含General→Sensitive及反向 | 權限按目標敏感度及來源均檢查；version控制；不能藉降級繞過；audit含變更但不含內容 | requests、DB versions、audit | — | NOT RUN |
| FILE-010 | P1 | FR-FILE-007、BR-041；停用/刪除與引用 | API/DB | 未引用/已引用/法定保留檔 | deactivate/delete/restore | 操作後查DB/object/download | 引用或retention中的檔不可破壞性刪除；停用後新流程不可取；允許刪除時metadata/object政策一致 | responses、reference query、object listing | — | NOT RUN |
| FILE-011 | P0 | NFR-006/008；刪檔失敗與重試 | Worker/Storage | DB已標delete pending；storage暫時故障 | 同一attachment job重送 | retry worker及重複delivery | 最終一致且冪等；不復活/誤刪其他object；超限進DLQ並可安全人工重試 | job logs、DB/object state、DLQ record | — | NOT RUN |
| FILE-012 | P1 | BR-029；Orphan cleanup邊界 | Worker/Storage | 有新pending、過期pending、合法available、未知prefix objects | cleanup job | 正常/並發finalize時執行 | 只清理超過保留窗且確認無DB有效引用的object；不與finalize競態誤刪 | job plan/output、object inventory、DB | — | NOT RUN |
| FILE-013 | P0 | NFR-009/010；附件備份與依賴故障 | Ops | scanner/storage容量不足或不可用；完整備份 | upload/download及restore drill | 模擬故障再恢復 | 錯誤可觀測且fail closed；已存檔不被污染；restore後metadata、checksum、ACL、內容完整 | alerts、checksums、restore/download evidence | — | NOT RUN |

### 6.10 Import and export（IMP）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| IMP-001 | P1 | FR-IMPORT-001；模板契約 | API/UI | U-MGMT | 最新template | download/open | header、required/optional欄、enum說明、version與requirement一致；無未支持敏感欄 | file hash、header/schema comparison | — | NOT RUN |
| IMP-002 | P0 | FR-IMPORT-002、BR-030；RFC 4180解析 | Worker/API | import enabled | quoted comma/newline/quote、CRLF/LF、UTF-8 BOM、Unicode、空末欄 | upload/precheck | 合法CSV解析成正確rows/columns；row number穩定；不因locale破壞內容 | parser output、preview、diagnostics | — | NOT RUN |
| IMP-003 | P0 | FR-IMPORT-002、SEC-013；檔案限制/路徑 | API/Storage | U-MGMT | 非CSV、MIME偽裝、超size/row、zip bomb內容、惡意filename | upload | 在寫入/排隊前適當拒絕；storage key安全；錯誤不含server path | responses、object inventory、logs | — | NOT RUN |
| IMP-004 | P0 | FR-IMPORT-003；Precheck零寫入 | API/DB/Worker | CSV含合法與非法rows | precheck/preview | 比對Customer及所有child tables before/after | 只建import staging/job/diagnostics；不新增/更新Customer業務資料；重跑結果穩定 | DB diff、job rows、preview | — | NOT RUN |
| IMP-005 | P1 | FR-IMPORT-004；逐列診斷 | API/UI | CSV含缺欄、重複Code/Legal、非法catalog/decimal/status | 多錯誤同row及多rows | precheck查看/下載errors | 錯誤含row、field、code、可理解訊息；同row可呈現足夠診斷；不洩漏其他Customer敏感資料 | diagnostics JSON/CSV、screenshots | — | NOT RUN |
| IMP-006 | P0 | FR-IMPORT-005、BR-037；Create row原子性 | Worker/DB | create mode；一row含root及支援的aggregate欄 | 注入child/DB/audit失敗 | confirm import | 單row成功則完整落庫；失敗則該row全部回滾；依partial-success政策不影響其他合法row | DB before/after、job result、audit | — | NOT RUN |
| IMP-007 | P0 | FR-IMPORT-006；Upsert匹配與blank語義 | Worker/DB | Existing customers | by ID/code、ID/code矛盾、stale version、blank/null/clear token、unsupported child columns | precheck/confirm | 只按明訂key匹配；矛盾/舊版本拒絕；空白不意外清值；未支持children不被靜默忽略 | preview diff、responses、DB versions | — | NOT RUN |
| IMP-008 | P0 | FR-IMPORT-007、SEC-010；敏感欄位禁止 | API/Worker | U-MGMT | CSV加入bank account、Bank Sensitive file、secret/internal fields | upload/precheck/confirm | 敏感欄被明確拒絕；不進staging/log/result檔；一般Customer import不授予bank能力 | diagnostics、staging/log scans | — | NOT RUN |
| IMP-009 | P0 | FR-IMPORT-008；審批設定一致性 | Workflow/Worker | 同一file分別Approval OFF/ON；precheck後切換setting | create/activate rows | confirm | 以design規定的setting snapshot/effective rule處理；ON不可批量繞過approval；每row狀態/requests正確 | config/job snapshots、approval rows、audit | — | NOT RUN |
| IMP-010 | P0 | NFR-008；Upload/confirm冪等 | API/Worker/DB | 可模擬timeout及重複queue delivery | 同file hash/idempotency key；同confirm token | 串行/並發重送 | 只一個job/一次業務效果；重送回原結果或明確衝突；audit/notification不重複 | request IDs、job/customer counts、events | — | NOT RUN |
| IMP-011 | P0 | FR-IMPORT-009；部分成功 | Worker/UI | 混合合法、validation fail、duplicate、conflict rows | confirm | 查看summary/detail並重試失敗rows | 成功/失敗數相符；每row終態唯一；失敗不污染DB；重試不重做成功row | result totals、DB reconciliation、screenshots | — | NOT RUN |
| IMP-012 | P0 | NFR-006/008；Worker crash/lease恢復 | Worker/DB | 長job可kill worker | crash before/after row commit及checkpoint | restart/lease expiry/retry | 已commit row不重複；未commit安全重做；job最終可終止；poison row不無限loop | checkpoints、worker logs、DB counts、DLQ | — | NOT RUN |
| IMP-013 | P0 | NFR-008；與線上更新競態 | Worker/API/DB | precheck version=N；user在線update至N+1 | import confirm與online update同步 | 執行 | 不覆蓋較新線上資料；該row標conflict並可重新precheck；其他rows依政策處理 | concurrency trace、versions、result | — | NOT RUN |
| IMP-014 | P0 | FR-IMPORT-010、SEC-009；結果檔/保留期/CSV注入 | API/UI/Ops | import result含以 `= + - @` 開頭值及敏感錯誤 | download result、過期後再取、無權限取 | 操作 | CSV dangerous cells安全處理；下載鑑權；結果無敏感資料；到期不可取且purge可稽核 | CSV bytes、responses、purge/audit rows | — | NOT RUN |
| IMP-015 | P1 | FR-LIST-010、NFR-003；Export | API/UI | 100k Customers、複合filters、混合敏感資料 | export all/filter/selected；取消/重試 | 產出並核對 | 欄位/rows/filter/sort一致；不得含bank/Bank Sensitive/internal data；大檔非阻塞、可觀測、可安全重試 | CSV reconciliation、job metrics、payload scan | — | NOT RUN |

### 6.11 Audit（AUD）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| AUD-001 | P0 | FR-AUDIT-001、AC-047；行為覆蓋 | Audit/DB | 可執行各Customer操作 | CRUD、status、approval、credit、bank、file、import、settings | 每類成功/失敗各操作一次 | 所有design列出的可稽核事件均存在、action/object/outcome一致；無重複/缺漏 | action-to-audit matrix、DB rows | — | NOT RUN |
| AUD-002 | P0 | FR-AUDIT-002；上下文完整性 | Audit/API | 固定actor/device/request | old/new、reason、request/correlation/idempotency IDs | 操作後查audit | actor snapshot、UTC time、object/version、old/new摘要、reason、request/correlation/outcome齊全且可串聯 | audit payload、request logs | — | NOT RUN |
| AUD-003 | P0 | FR-AUDIT-003、SEC-010/011；敏感資料redaction | Audit/Security | unique bank/PII/file markers | success/validation/exception/reveal/import | 搜尋audit/logs | cipher、完整bank、token、file content、password均不存在；必要顯示只用安全mask/fingerprint | redaction scan、negative grep evidence | — | NOT RUN |
| AUD-004 | P0 | FR-AUDIT-004、NFR-006；同交易一致性 | API/DB | 可令audit insert失敗 | create/update/status/default/approval | 注入失敗 | 需要強一致的業務寫入不得在無audit下commit；回應與DB一致；可重試 | transaction trace、DB before/after | — | NOT RUN |
| AUD-005 | P1 | BR-032；Payload上限與截斷 | Audit/DB | 產生大量diff/長reason | >8192 bytes/大量children | 操作後查audit | 依design安全摘要/截斷且JSON仍有效；明示truncated/hash/count；不影響業務正確性 | audit bytes/schema、response | — | NOT RUN |
| AUD-006 | P1 | FR-AUDIT-006；查詢與分頁 | API/UI | 多actor/action/date/object/outcome audit records | filters、same timestamp、deep pages | query/export（若有） | filter準確、穩定cursor/order、權限正確；無跨scope或敏感資料；效能符合目標 | response/SQL plan/screenshots | — | NOT RUN |
| AUD-007 | P0 | FR-AUDIT-007、BR-039、NFR-014；不可變與時間 | DB/Security | 一般app DB identity及受限admin | direct UPDATE/DELETE、clock/timezone changes | 嘗試改寫及跨時區查詢 | 應用身份不可改/刪audit；時間統一UTC並正確顯示HK時區；actor名稱改後舊snapshot仍可辨識 | DB grants/errors、timestamps、rows | — | NOT RUN |

### 6.12 Authorization and API security（AUTH）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-001 | P0 | SEC-001；未登入 | API/UI | 無token/invalid/expired token | 所有Customer routes/API families | GET/POST/PATCH/DELETE | 401且無資源存在性/敏感內容；UI導向登入；無業務/audit side effect（安全事件除外） | route sweep、responses、DB diff | — | NOT RUN |
| AUTH-002 | P0 | SEC-002～007；六權限矩陣 | API/UI | 僅持有customer.view/mgmt/approval/settings/bank.view/bank.mgmt之一的角色 | 每個endpoint/action | positive與negative matrix | server逐endpoint enforcement與Capability Map完全一致；menu/button只作輔助不能替代server check | generated matrix、responses、screenshots | — | NOT RUN |
| AUTH-003 | P0 | SEC-012、Design §3.2；委派邊界 | Security/Audit | U-SYS及可管理role/user流程 | assign/revoke Customer與Bank perms | 使用既有fresh jwt+device+password+reason流程 | 只有catalogued permission可委派；操作完整audit；revocation於規定時間生效；不能自動繼承Bank權限 | auth/role DB、audit、token refresh results | — | NOT RUN |
| AUTH-004 | P0 | SEC-008；下游最小權限 | API/Integration | U-SALES/FUL/AR/PAY | picker/resolver與Customer management endpoints | 逐一呼叫 | 下游只能取contract所需投影；不能藉下游權限進Customer CRUD、Bank reveal或附件 | response field diff、403 matrix | — | NOT RUN |
| AUTH-005 | P0 | SEC-009；IDOR全面掃描 | API/Security | Customer A/B及其address/contact/id/bank/file/approval/import IDs | route/body/query替換ID、enumeration | read/update/default/download/decision | 跨Customer/未授權scope全部拒絕且不洩漏存在性；DB無變更；signed URLs不可跨用 | fuzz matrix、responses、DB diff | — | NOT RUN |
| AUTH-006 | P0 | SEC-004/005/006/007/012；身份生命週期 | API/Security | enabled後disabled user；permission revoked；old token/session | 長操作/import/approval/reveal | revocation前取得token，後執行/續跑 | 高風險與提交點重驗有效身份/權限；舊token不能長時間保留能力；背景job使用安全actor snapshot/policy | token timeline、responses、job/audit | — | NOT RUN |
| AUTH-007 | P0 | Design §3.1；Auth type與CSRF/CORS | API/Browser | cookie及bearer配置（按項目實際） | cross-origin、missing CSRF、wrong audience/issuer | state-changing calls | 只接受design允許auth型態；cookie流程有CSRF防護；CORS不容許任意credentialed origin | headers、browser/network evidence | — | NOT RUN |
| AUTH-008 | P0 | SEC-013；注入與解析攻擊 | API/UI/Import | authorized low privilege user | SQL/NoSQL-like、XSS、prototype keys、oversized JSON、duplicate JSON keys、CSV formula | 各輸入面提交/顯示 | schema/parameterization/encoding有效；不執行payload、不污染prototype、不繞過filters/roles；安全錯誤 | fuzz results、DB/log/UI scans | — | NOT RUN |
| AUTH-009 | P0 | SEC-010/011；Response/cache/log策略 | API/Browser/Ops | 含PII/bank/file資料 | detail/reveal/error/download | 檢查headers、browser cache、APM/log | 敏感response採適當no-store；不被共享cache；錯誤/trace無秘密；安全headers符合design | headers、cache tests、log/APM scans | — | NOT RUN |
| AUTH-010 | P1 | SEC-013/014、Design §11.5；濫用與協議錯誤 | API/Security | authorized/anonymous clients | rapid search/reveal/upload/import；wrong method/content-type/version | burst及變形requests | 429/405/415/版本錯誤一致且可恢復；rate limit不跨租戶議題但按actor/IP/action合理；不造成資源耗盡 | load trace、headers、metrics | — | NOT RUN |

### 6.13 UI/UX and accessibility（UI）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| UI-001 | P1 | FR-LIST-001～010、FR-VIEW-001～006、docs/frontend-design.md；導覽 | UI | 各權限角色 | desktop/tablet/mobile widths | 由menu進list/detail、直接URL、back/forward | 路由/標題/breadcrumb/active menu一致；無權限不顯示入口且直接URL有明確403 | screenshots、route/network | — | NOT RUN |
| UI-002 | P1 | FR-CREATE、FR-LIST；建檔/列表可用性 | UI | U-MGMT | 最小/完整Customer、validation errors | create、cancel、search/filter/sort/page | label/help/required標示與需求一致；錯誤對應欄位並保留安全輸入；成功回饋與列表更新正確 | screenshots/video、network | — | NOT RUN |
| UI-003 | P0 | FR-EDIT-008；未儲存與衝突 | UI/API | 同一record雙tab | dirty form、server version更新、network retry | navigate away、A/B儲存、refresh/retry | dirty warning；409顯示差異/重新載入選項；不靜默覆蓋或重複提交 | screenshots、network、DB version | — | NOT RUN |
| UI-004 | P1 | FR-PARTY；Party與default操作 | UI | 多地址/聯絡/identifier | add/edit/deactivate/set default、大量rows | 鍵盤/滑鼠完成 | 用途與default清楚；危險操作有正確確認；大量資料可分頁/搜尋；焦點回復合理 | screenshots、accessibility tree、network | — | NOT RUN |
| UI-005 | P0 | FR-STATUS、SEC-003；高風險操作 | UI/Security | 各status/權限/high-auth狀態 | suspend/block/archive/delete/code change | 執行/取消/失敗/timeout | action只在合法狀態顯示；reason/影響清楚；確認不誤觸；高驗證過期時安全重試；最終狀態準確 | screenshots/video、auth/network | — | NOT RUN |
| UI-006 | P1 | FR-APPROVAL-001～007、FR-SET-001～006；審批與設定 | UI | U-MGMT/U-APR/U-SET | queue、snapshot diff、setting ON/OFF | submit/approve/reject/reassign/update setting | current與pending清楚區分；決策理由/版本/assignee顯示；設定影響有說明且不誤導為追溯套用 | screenshots、network | — | NOT RUN |
| UI-007 | P0 | FR-BANK-001～007、FR-FILE-001～007；敏感UI | UI/Security | Bank與一般角色 | masked/reveal timer/copy、Sensitive file | list/reveal/離頁/download | mask一致；明文不進DOM殘留、history/autofill/clipboard超出必要範圍；restricted內容/計數不側漏 | DOM/storage inspection、screenshots、network | — | NOT RUN |
| UI-008 | P1 | NFR-011/014、frontend design；a11y/響應/狀態 | UI | Chrome/Firefox/Safari支援版本；slow/offline | keyboard only、screen reader、200% zoom、mobile、slow/500/empty | 完整主要journeys | WCAG目標的名稱/焦點/對比/錯誤提示可用；layout無阻斷；loading/empty/error/retry明確；不重複提交 | axe/manual evidence、screenshots、network | — | NOT RUN |

### 6.14 Downstream contracts（INT）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-001 | P0 | AC-022、DEC-016；Sales Customer picker | Integration/API | 多status Customers | code/name query、inactive exact ID | search/select/submit Sales transaction | picker只回Active且最小投影；提交再次驗證；Customer模組不承擔order建立 | contract payload、responses | — | NOT RUN |
| INT-002 | P0 | BR-007；選取後狀態變更 | Integration/Concurrency | Sales已選Active Customer | 選後變Suspended/Blocked/Archived | submit | server於提交拒絕新交易；清楚錯誤；不產生半成品交易；恢復Active後可重新選/送 | timeline、responses、transaction DB | — | NOT RUN |
| INT-003 | P0 | AC-025、DEC-004；Fulfillment地址 | Integration | Customer有default、多個active、後續修改地址 | 建shipment/改default/改master | 發貨時選並完成 | default只作快速預選；必須確認地址；shipment保存不可變snapshot；後改master不影響舊shipment | UI/API contract、snapshot DB | — | NOT RUN |
| INT-004 | P1 | FR-PARTY-003/004；聯絡人用途 | Integration | 同用途多contacts/default/inactive | ordering/shipping/billing/finance流程 | 各流程取聯絡人 | resolver只回該Customer、用途適合、active contacts並標default；可選非default；舊snapshot保留 | contract payloads、snapshots | — | NOT RUN |
| INT-005 | P0 | FR-CREDIT、DEC-010；Invoice/credit contract | Integration | term/currency/credit null/0/positive/hold | 建invoice/order及改policy | 比較決策 | 下游取得最新有效master/policy；null/0語義不混；Customer模組不計算receivable；交易保存決策snapshot | contract tests、DB snapshots | — | NOT RUN |
| INT-006 | P0 | FR-CREDIT-007、BR-039；AR讀取邊界 | Integration | 歷史交易及Customer改名/term/currency | AR查詢/新建後續動作 | 操作 | AR只透過明訂resolver/API取所需資料；歷史帳務不被master變更回寫；無Bank/file資料 | payload diff、historical records | — | NOT RUN |
| INT-007 | P0 | DEC-009/017；Payment/Refund銀行resolver | Integration/Security | Payment模組存在/不存在兩種部署能力 | active/default/inactive bank accounts | 探測capability並選帳戶 | 模組不存在時Customer功能不被阻斷；存在時只經受控masked resolver及授權選取，不傳明文到不需者；歷史reference保留 | capability/contract responses、audit | — | NOT RUN |
| INT-008 | P0 | NFR-010/011；依賴故障與契約相容 | Integration/Ops | Sales/Fulfillment/AR/Payment依賴timeout/舊新contract版本 | 5xx/timeout/partial response/retry | Customer與下游操作 | 讀取故障有明確降級/錯誤；寫入不形成半狀態；retry冪等；舊支援版本在相容窗可用，未知欄安全處理 | contract suite、traces、DB reconciliation | — | NOT RUN |

### 6.15 Performance, resilience and release（OPS）

| ID | Priority | Requirement / Risk | Area | Preconditions | Test Data | Steps / Input | Expected Result | Required Evidence | Actual Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| OPS-001 | P1 | NFR-001～003；100k列表效能 | Performance/API | production-like MySQL及100k Customers/分布式children | 50 concurrent users、常用filters/search/sort | warm-up後固定時窗load | p95/p99、error rate、throughput符合design SLO；結果仍正確；無敏感資料 | load report、APM/DB metrics、sample reconciliation | — | NOT RUN |
| OPS-002 | P1 | NFR-001/002；Query/index計畫 | DB/Performance | production-like statistics | list/detail/completeness/audit/duplicate queries | EXPLAIN ANALYZE/slow log under representative cardinality | 使用預期indexes、無不可接受full scan/N+1；pagination穩定；locks不放大 | query plans、slow log、metrics | — | NOT RUN |
| OPS-003 | P1 | NFR-004；10k匯入容量 | Performance/Worker | 10k mixed rows及多workers | clean/mixed-error files | upload→precheck→confirm→result | 系統處理時間合計10分鐘內；進度單調準確；無漏/重rows；不拖垮線上p95超允許值 | job timings、CPU/memory/DB metrics、counts | — | NOT RUN |
| OPS-004 | P0 | NFR-010；部分配置啟動 | Ops | 缺DB/storage/scanner/crypto/worker依賴組合 | readiness/liveness及各capability | 啟動/操作 | readiness反映必要依賴；可選能力按Capability Map明確disabled；不得出現可點但必然資料損壞的半功能 | health payload、UI capability、logs | — | NOT RUN |
| OPS-005 | P1 | SEC-011/014、Design §11.4；可觀測性與告警 | Ops | 可觸發5xx、403 burst、crypto/scanner/storage/job失敗 | correlation/request/job IDs | 操作並查dashboard/alerts | 指標、structured logs、traces可串聯且無PII/secret；門檻達成時告警含可行資訊、不含敏感值 | dashboard/alert/log samples | — | NOT RUN |
| OPS-006 | P0 | NFR-006/008；背景任務恢復 | Worker/Ops | import/delete/orphan/rotation jobs運行中 | kill -9、lease expiry、duplicate delivery、poison item | restart workers | checkpoint/lease/idempotency正確；最終一致；poison item隔離；人工retry有audit | job tables、logs、DLQ、DB/object counts | — | NOT RUN |
| OPS-007 | P0 | NFR-009；備份還原演練 | Ops/DB/Storage | encrypted DB、attachments、keys及audit備份 | 指定RPO/RTO時間點 | restore至隔離環境並驗證 | RPO/RTO達標；Customer/children/audit/object counts與checksums一致；具keys者可受控讀，無keys不洩漏 | restore log、timings、reconciliation、sample journeys | — | NOT RUN |
| OPS-008 | P0 | NFR-009/011；部署/回滾 | Ops/DB | pre-release DB copy與上一版app | expand migration→mixed-version→new app→rollback | 執行演練 | schema/app相容窗符合設計；rollback不遺失新資料或需明確阻擋；migration lock時間在窗口；health正常 | deploy timeline、migration logs、DB diff | — | NOT RUN |
| OPS-009 | P0 | 全體P0/P1；Release regression | End-to-end | production-like環境與凍結build | 核心happy/negative/security/recovery套件 | 按entry criteria執行完整回歸 | 所有P0執行且通過、P1達約定門檻；無open release-blocker；evidence可追溯；否則No-Go | signed run、case results、defect links、approvals | — | NOT RUN |

## 7. Formal requirement traceability

下表以`requirement.md`的正式ID為準。`Latest Result=NOT RUN`表示只有設計覆蓋，沒有執行證據；實測時須在個案與測試管理紀錄填入result、evidence及defect ID。

| Requirement IDs | Primary Risks | Test Case IDs | Latest Result | Defect IDs |
| --- | --- | --- | --- | --- |
| OBJ-01～03 | 重複主檔、非法狀態、不可追溯變更 | CORE-001～013、STATE-001～010、AUD-001～007 | NOT RUN | — |
| OBJ-04～05 | Party default錯誤、信用語義誤判 | PARTY-001～011、CREDIT-001～008、INT-003～006 | NOT RUN | — |
| OBJ-06 | 審批設定被繞過或stale decision | APR-001～012、AUTH-002/006 | NOT RUN | — |
| OBJ-07 | Bank／附件敏感資料外洩 | BANK-001～016、FILE-001～013、AUTH-005/009 | NOT RUN | — |
| OBJ-08 | CSV半筆aggregate、重複處理或錯誤結果 | IMP-001～015、OPS-003/006 | NOT RUN | — |
| OBJ-09 | 下游使用失效Customer或改寫歷史 | STATE-003/006、PARTY-003～005、INT-001～008 | NOT RUN | — |
| KPI-01～05 | 完整度、重複資料及critical audit不足 | LIST-005、CORE-002～004、PARTY-002/007/009、AUD-001～005 | NOT RUN | — |
| KPI-06～08 | 查詢／地址／匯入品質不達標 | LIST-001～006、PARTY-003/004、IMP-011、OPS-001～003 | NOT RUN | — |
| KPI-09 | 未授權銀行明文事件 | BANK-001～016、AUTH-001～010、AUD-003 | NOT RUN | — |
| FR-LIST-001～010 | 錯頁、錯filter、資料外洩、效能下降 | LIST-001～009、IMP-015、OPS-001/002 | NOT RUN | — |
| FR-VIEW-001～006 | Detail投影過量、子資料錯漏 | LIST-007/008、AUTH-002/004/005、UI-001 | NOT RUN | — |
| FR-CREATE-001～009 | Aggregate半寫、重複Code／Legal、審批繞過 | CORE-001～007/012/013、APR-001～005 | NOT RUN | — |
| FR-EDIT-001～008 | 未驗證更新、lost update、歷史被改寫 | CORE-003～013、UI-003 | NOT RUN | — |
| FR-STATUS-001～008 | 非法終態、錯誤交易資格、不可刪引用 | STATE-001～010、INT-001/002 | NOT RUN | — |
| FR-PARTY-001～008 | 雙default、跨Customer child、錯誤snapshot | PARTY-001～011、INT-003/004 | NOT RUN | — |
| FR-CREDIT-001～007 | null／0／hold／currency混淆 | CREDIT-001～008、INT-005/006 | NOT RUN | — |
| FR-BANK-001～007 | 明文外洩、錯誤權限、重複／雙default | BANK-001～016、AUTH-003/005/009 | NOT RUN | — |
| FR-FILE-001～007 | 惡意檔、孤兒檔、未授權下載 | FILE-001～013、AUTH-005/009 | NOT RUN | — |
| FR-APPROVAL-001～007 | 自我／錯人審批、stale snapshot、雙決策 | APR-003～012、AUTH-006 | NOT RUN | — |
| FR-SET-001～006 | 未授權／追溯式設定變更 | APR-001/002、AUTH-002/003 | NOT RUN | — |
| FR-IMPORT-001～010 | 解析、逐列原子、敏感欄、resume問題 | IMP-001～014、OPS-003/006 | NOT RUN | — |
| FR-AUDIT-001～007 | audit缺漏、可篡改、敏感資料進audit | AUD-001～007、BANK-002/015、FILE-008 | NOT RUN | — |
| BR-001～009 | Customer唯一、最低資料及狀態規則失守 | MIG-005、CORE-001～013、STATE-001～003 | NOT RUN | — |
| BR-010～016 | Delete／Party default／identifier invariant失守 | STATE-006～008、PARTY-001～011 | NOT RUN | — |
| BR-017～021 | Credit及審批設定語義錯誤 | CREDIT-001～008、APR-001～005 | NOT RUN | — |
| BR-022～029 | 審批、銀行、附件競態／安全錯誤 | APR-006～012、BANK-001～016、FILE-001～013 | NOT RUN | — |
| BR-030～035 | CSV／敏感投影／交易snapshot不一致 | IMP-001～015、INT-003～008、AUTH-009 | NOT RUN | — |
| BR-036～042 | UI/API/CSV parity、CAS、submit recheck、冪等 | CORE-011～013、STATE-003/009/010、IMP-007～013、AUTH-002、INT-001～008 | NOT RUN | — |
| SEC-001～014 | 越權、IDOR、敏感洩漏、注入、備份暴露 | AUTH-001～010、BANK-001～016、FILE-002～013、AUD-003/007、OPS-007 | NOT RUN | — |
| NFR-001～005 | 100k/50 users/10k CSV及查找效能 | LIST-001～006、IMP-015、OPS-001～003 | NOT RUN | — |
| NFR-006～010 | 一致性、race、冪等、DR、依賴隔離 | CORE-002/011～013、STATE-009/010、IMP-010～013、OPS-004/006～008 | NOT RUN | — |
| NFR-011～014 | channel契約、設定擴充、catalog、locale/time/decimal | MIG-004/007/008、CORE-007/008、CREDIT-003/004、UI-008、INT-008 | NOT RUN | — |
| AC-001～008 | Create/update/unique/code correction | CORE-001～013、MIG-005 | NOT RUN | — |
| AC-009～014 | Approval setting、submit、decision、stale snapshot | APR-001～012 | NOT RUN | — |
| AC-015～020 | Status、reference、delete、restore | STATE-001～010、INT-001/002 | NOT RUN | — |
| AC-021～028 | Party default及Sales/Fulfillment snapshot | PARTY-001～011、INT-001～004 | NOT RUN | — |
| AC-029～035 | Currency、Payment Term、Credit及AR界線 | CREDIT-001～008、CORE-008/009、INT-005/006 | NOT RUN | — |
| AC-036～043 | Bank crypto／permission／reveal及附件安全 | BANK-001～016、FILE-001～013 | NOT RUN | — |
| AC-044～046 | Mixed import、冪等及resume | IMP-002～013、OPS-003/006 | NOT RUN | — |
| AC-047～049 | Settings權限、version及非追溯 | APR-001/002、AUTH-002 | NOT RUN | — |
| AC-050～052 | Root CAS、拒絕無副作用、安全export/audit | CORE-011、AUTH-001～006、IMP-014/015、AUD-001～007 | NOT RUN | — |
| DEC-001～023 | 已確認業務決策被錯誤實作或範圍蔓延 | CORE、STATE、PARTY、CREDIT、APR、BANK、FILE、IMP、INT各相應案例 | NOT RUN | — |

## 8. Test approach and execution order

| Layer | Suitable coverage | Execution guidance |
| --- | --- | --- |
| Unit / component | canonicalization、state transition、validation、masking、CSV parser、snapshot builder、permission policy | 快速且可重複；但不能代替MySQL constraint、真crypto、真filesystem及browser證據 |
| MySQL integration | Migrations、unique/default slots、CAS、transactions、audit atomicity、leases | 使用與目標相同MySQL版本及collation；每次保存schema、SQL與transaction evidence |
| API / contract | 全endpoint auth、schema、idempotency、downstream resolver | 以request ID串聯response、DB、audit；同時做positive/negative及consumer-driven contract |
| UI / E2E | 核心journeys、權限顯示、conflict、reveal、upload/import、a11y | 瀏覽器network、DOM/storage及畫面共同取證；安全判斷仍以server結果為準 |
| Security / resilience | IDOR、injection、redaction、key/scanner/storage failure、worker crash、backup/restore | 隔離環境執行；Bank evidence只保留redacted結果；故障前先定義復原與停止條件 |
| Performance | 100k Customer、50 concurrent users、10k CSV | production-like data distribution、索引、MySQL參數及硬體；先warm-up，再固定時窗量測 |

建議執行次序為：`MIG/AUTH smoke → CORE/STATE/PARTY/CREDIT → APR/BANK/FILE → IMP/AUD → UI/INT → OPS`。任一Migration、auth bypass、明文洩漏、資料不可逆損壞或transaction原子性P0失敗時，停止相關破壞性／敏感後續測試，保留證據並先修復。

### 8.1 Exploratory charters

- 兩名管理者同時在UI、API及CSV更新同一Customer，探索版本提示、重試及最終audit是否一致。
- 由Customer list一路切換至Bank reveal、附件預覽、browser back及錯誤頁，探索DOM、cache、clipboard、telemetry及URL是否殘留敏感資訊。
- 在Approval、Import及File worker各階段注入timeout／duplicate delivery／restart，探索系統是否能回答「究竟有沒有完成」。
- 以Sales、Fulfillment、AR及Payment角色嘗試利用ID、search、export及resolver組合擴大資料投影。

## 9. Entry and exit criteria

### 9.1 Entry criteria

- `requirement.md`與`design_spec.md`版本凍結，Capability Map、API/OpenAPI、Migration號碼及共用Business Master契約可識別。
- 可使用production-like MySQL、private filesystem、scanner測試替身／隔離服務、crypto key rings、worker及至少一個支援browser。
- 六項Customer permissions、各測試actor、下游consumer fixture及真實失效／撤權情境已準備。
- 每個build可追溯commit；DB/file snapshots、request correlation、log/APM及audit查詢方式已驗證。
- 所有測試資料均為虛構；Bank／Sensitive File evidence的redaction與保存位置已批准。

### 9.2 Exit criteria

- 所有P0已執行且PASS；P1已全部執行，或其未執行項有具名owner、風險接受與期限。
- 無未解決的資料外洩、越權、唯一性、雙default、非法狀態、原子性、審批繞過、worker重複處理、備份不可還原缺陷。
- 所有FAIL／BLOCKED均有defect／blocker ID、可重現證據、影響面及重測結果；不得用code review或mock冒充真整合證據。
- 100k/50-user/10k-row目標、backup restore、migration/rollback及四個主要downstream contracts均有可審核結果。
- QA recommendation由實際結果決定；只有planned cases時不得給Go。

## 10. Execution prerequisites and open verification items

| Item | Required before execution | If unavailable |
| --- | --- | --- |
| Migration sequence | 實作時依main分支下一個可用序號及最終19-table schema更新expected baseline | MIG案例BLOCKED，不得猜測PASS |
| Payment/Refund consumer | 先以Capability Map判定本build是否存在該模組及正式contract | INT-007可記NOT APPLICABLE，但Customer Bank本身仍須完整測試 |
| Crypto / lookup key rings | 隔離測試keys、version與輪換runbook | Bank create/reveal/rotation BLOCKED；一般Customer不可因此錯誤開放敏感路徑 |
| Malware scanner / private storage | 可控clean/infected/error及filesystem故障注入 | FILE安全／恢復案例BLOCKED，不以mock推斷端到端PASS |
| Performance baseline | 固定build、硬體、MySQL config、資料分布與SLO量測窗 | OPS-001～003 BLOCKED，不以開發機結果作release證據 |
| Backup/restore environment | 包含DB、attachments、keys及audit的隔離還原目標 | OPS-007及相關Bank/File recovery BLOCKED |

## 11. Known untested and residual risks

- 本文件截至2026-09-07沒有任何執行證據；157個案例全部為`NOT RUN`。
- 正式penetration test、外部密碼學／合規認證不在本次功能測試範圍；即使本套件通過，仍是殘餘風險。
- Pricing、discount、tax、AR exposure calculation、transaction override、Customer hierarchy及臨時送貨地址已明確不屬本模組，不能由本報告推論已驗證。
- Payment／Refund若尚未實作，只能把其consumer contract記為`NOT APPLICABLE`；不能因此降低Customer Bank的access、crypto、audit與history要求。
- Production-like容量、browser support、scanner、storage、key management及災難復原若與生產不同，結果的可外推性須在報告中明示。

## 12. Planning status summary

| Metric | Count |
| --- | ---: |
| Planned test cases | 157 |
| Executed | 0 |
| Passed | 0 |
| Failed | 0 |
| Blocked | 0 |
| Not Run | 157 |

**Current QA recommendation：INSUFFICIENT EVIDENCE。** 本文件只完成測試案例設計；在符合entry criteria、執行P0/P1並取得可審核證據前，不能作release sign-off。

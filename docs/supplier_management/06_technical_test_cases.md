# Supplier Management Aligned Technical Test Specification

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/supplier_management/01_requirement_spec.md` 1.0 Aligned |
| 設計來源 | `docs/supplier_management/03_design_spec.md` 1.0 Aligned |
| 任務來源 | `docs/supplier_management/05_development_tasks.md` 1.0 Aligned |
| UI/UX 基準 | docs/frontend-design.md |
| 文件日期 | 2026-09-11 |
| 測試階段 | 測試設計，尚未執行 |
| Canonical planning status | 所有`TC-*`均為`PLANNED` |
| Legacy execution status | 詳細來源列保留`NOT RUN`，表示尚未執行；不等同PASS |
| 目標環境 | 待執行前確認；Migration、constraint、transaction、concurrency、worker、效能及復原案例必須使用隔離的真實 MySQL 測試環境 |
| Build / Commit | 待執行前記錄 |

> 本文件只定義測試案例，不代表功能已通過驗證。本輪不執行任何測試。涉及永久刪除、封鎖、銀行明文、金鑰輪替、Migration、故障注入及復原的案例，只可在隔離測試環境使用虛構資料執行。

## 1. 測試目標與範圍

驗證 Supplier Management 的主資料、地址、聯絡人、識別資料、狀態、審批、設定、銀行帳戶、Supplier–SKU 軟性關係、CSV 匯入／匯出、稽核、權限、效能及營運復原符合需求與設計，且 state-changing 操作在重送、並發、失敗及重啟後仍保持資料一致。

### 1.1 範圍內

- Supplier Core CRUD、搜尋、詳情、完整度、狀態機及 reference guard。
- Approval、Supplier-owned Settings、Business Master Currency／Payment Term read contract及職責分離。
- Bank encryption、masked projection、reveal、duplicate detection、rotation、backup／restore及明文生命週期。
- Supplier–SKU relation及採購 lookup；只驗證設計所定義的整合契約，不重算採購結果。
- RFC 4180 CSV template、precheck、row-level partial success、worker recovery、result、retention及一般 export。
- Migration、API、DB、UI、audit、security、performance、observability及deployment smoke。

### 1.2 範圍外

- 採購價、報價、合約價、銷售稅、付款執行、對帳及交易模組自身計算。
- Supplier 資格文件、合約、附件、評分、風險評級及多公司資料隔離。
- 深度滲透測試；本文件只涵蓋功能性安全、授權、敏感資料與常見輸入攻擊回歸。

## 2. 系統模型與高風險流程

主要路徑為「Vue／API client → auth policy及schema validation → Supplier domain service → MySQL transaction／audit」，另有「CSV storage → precheck → job／row tables → lease worker → Supplier aggregate」及「Bank service → secret key rings → encrypted DB columns」兩條高風險邊界。

| 風險 | Likelihood | Impact | Priority | 核心控制與案例 |
| --- | ---: | ---: | --- | --- |
| 銀行明文、ciphertext或key經API、log、audit、CSV、cache或備份外洩 | 4 | 5 | P0 | BANK-001～BANK-016、AUTH-008、IMP-014 |
| 權限組合、自我審批、stale claim或IDOR造成越權 | 4 | 5 | P0 | AUTH-001～AUTH-010、APR-004～APR-013 |
| 狀態／審批並發或重送造成非法終態或重複audit | 4 | 5 | P0 | STATE-008～STATE-010、APR-010～APR-013 |
| CSV逐列交易或worker crash造成部分aggregate、重複Supplier或錯誤統計 | 4 | 5 | P0 | IMP-006～IMP-013 |
| Unique、FK、primary/default slot或版本控制只在應用層成立 | 3 | 5 | P0 | MIG-003、CORE-004、CORE-011、PARTY-003、BANK-008 |
| Supplier失效後仍可建立新交易或preferred關係繞過狀態 | 3 | 5 | P0 | STATE-001～STATE-006、SKU-001～SKU-006 |
| Migration排序、半套用或缺key造成不可啟動／不可復原 | 3 | 5 | P0 | MIG-001～MIG-007、BANK-015～BANK-016、OPS-001～OPS-009 |
| 100k資料、50使用者及10k CSV下超時或資源失控 | 3 | 4 | P1 | LIST-001、SKU-008、IMP-016、OPS-001～OPS-003 |

## 3. 測試資料基線

| 代號 | 測試資料 |
| --- | --- |
| U-VIEW | Active user，只持有 supplier.view |
| U-MGMT | Active user，持有 supplier.view＋supplier.mgmt；沒有approval、bank或settings |
| U-APR-A／U-APR-B | 兩名Active user，持有supplier.view＋supplier.approval，彼此獨立 |
| U-BANK-R | Active user，持有supplier.view＋supplier.bank.view |
| U-BANK-W | Active user，持有supplier.view＋supplier.bank.view＋supplier.bank.mgmt；approved device |
| U-SET | Active user，只持有supplier.settings；approved device |
| U-SYS | 受保護的system-admin；系統最高權限、非日常使用者，Bank操作仍使用approved device及重新認證 |
| U-PO | Purchasing測試user，只持有呼叫方採購權限 |
| U-NONE／U-DISABLED | 無Supplier權限的Active user／已停用user |
| S-DRAFT | 未被引用的Draft Supplier，version=1，只有Code、Name、HKD |
| S-ACTIVE | Active Supplier，含一般資料、children及兩個masked Bank rows |
| S-REF | 已被purchase snapshot或relation引用的Supplier |
| S-PENDING | 由U-MGMT提交、指派U-APR-A的Pending Supplier及pending request |
| S-SUSP／S-BLOCK／S-ARCH | 分別為Suspended、Blocked及Archived Supplier |
| SKU-A／SKU-INACTIVE | Active SKU＋合法UOM／Inactive SKU |
| BANK-A | 虛構帳號 000-123456-789；只可存在於受控input與短暫reveal evidence |
| CSV-MIXED | UTF-8 CSV，包含valid create、valid upsert、warning、invalid、duplicate及Bank header variants |
| REASON | 5–500字元，例如 QA supplier risk-control verification |
| IDEM-A／IDEM-B | 不同idempotency keys；另準備同key同payload及同key異payload |
| PERF | 100,000 Suppliers；平均5 addresses、10 contacts、2 identifiers、2 Bank rows，20%有SKU relation；50 concurrent users |

所有資料使用唯一run prefix；銀行、email、電話及identifier均為虛構值。每個P0／P1案例執行前須保存build、環境、actor、request ID及初始DB snapshot。

## 4. 證據與狀態規則

- API／UI案例至少保存request、response、畫面或network evidence；state-changing案例另保存相關table及audit前後快照。
- Transaction、constraint、locking、Migration及worker案例必須提供真MySQL evidence；mock或code inspection不能判定PASS。
- Bank案例的evidence不得直接保存完整帳號或key；以受控搜尋count=0、masked sample、hash比對或redacted artifact證明。
- 狀態只可由NOT RUN改為PASS、FAIL、BLOCKED或NOT APPLICABLE；Actual Evidence在實際執行前保持「—」。

## 5. 需求／風險追蹤總覽

| Requirement / Risk | Priority | Test Case IDs | Latest Result | Defect IDs | Coverage Note |
| --- | --- | --- | --- | --- | --- |
| RQ-01 Migration、Business Master contract、schema及啟動基線 | P0 | MIG-001～MIG-007、OPS-004 | NOT RUN | — | 真MySQL、半套用、provider readiness、Item依賴及fail-closed |
| RQ-02 列表、搜尋、詳情與一般UI | P1 | LIST-001～LIST-009、UI-001～UI-007 | NOT RUN | — | 分頁、filter、sort、projection、URL及可用性 |
| RQ-03 建立、修改、唯一性、冪等及交易快照 | P0 | CORE-001～CORE-013 | NOT RUN | — | 最低欄位、duplicate warning、version、rollback及snapshot |
| RQ-04 狀態機、reference guard與新交易資格 | P0 | STATE-001～STATE-010 | NOT RUN | — | suspend、block、archive、delete、重送及並發 |
| RQ-05 Address、Contact、Identifier資料完整性 | P1 | PARTY-001～PARTY-009 | NOT RUN | — | CRUD、primary slot、ownership、unique及history |
| RQ-06 Approval、Supplier Settings及Business Master read contract | P0 | APR-001～APR-013 | NOT RUN | — | policy snapshot、SoD、stale、重派、並發及typed settings |
| RQ-07 Bank敏感資料及高風險操作 | P0 | BANK-001～BANK-016 | NOT RUN | — | permission、crypto、mask、audit、rotation及restore |
| RQ-08 Supplier–SKU與Purchasing lookup | P0 | SKU-001～SKU-008 | NOT RUN | — | soft relation、狀態重驗、UOM FK、排序及容量 |
| RQ-09 CSV Import／Export | P0 | IMP-001～IMP-017 | NOT RUN | — | RFC4180、預檢、原子性、idempotency、recovery及retention |
| RQ-10 Audit、敏感資料與可追溯性 | P0 | AUD-001～AUD-008、AUTH-008 | NOT RUN | — | transactional audit、allowlist、查詢、不可修改及保留 |
| RQ-11 認證、授權、IDOR及輸入防護 | P0 | AUTH-001～AUTH-010 | NOT RUN | — | 六權限、authType、fresh actor、schema、injection |
| RQ-12 效能、可觀測性、部署與復原 | P1 | OPS-001～OPS-009 | NOT RUN | — | SLA、alerts、backup、rollback、smoke及殘留風險 |

### 5.1 Harness canonical test registry

`TC-*`是Harness canonical test ID；每個ID一對一繼承下列既有詳細案例的Priority、Requirement/Risk、Preconditions、Test Data、Steps/Input、Expected Result及Required Evidence。Canonical status均為`PLANNED`；既有列的`NOT RUN`只表示未有execution evidence。

| Canonical IDs | Detailed case IDs | Primary phase/task coverage |
| --- | --- | --- |
| TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007 | MIG-001～MIG-007 | PHASE-001；TASK-001～TASK-005 |
| TC-008, TC-009, TC-010, TC-011, TC-012, TC-013, TC-014, TC-015, TC-016 | LIST-001～LIST-009 | PHASE-001；TASK-012～TASK-013 |
| TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024, TC-025, TC-026, TC-027, TC-028, TC-029 | CORE-001～CORE-013 | PHASE-001；TASK-006～TASK-011, TASK-020～TASK-021 |
| TC-030, TC-031, TC-032, TC-033, TC-034, TC-035, TC-036, TC-037, TC-038, TC-039 | STATE-001～STATE-010 | PHASE-001；TASK-008, TASK-022～TASK-024 |
| TC-040, TC-041, TC-042, TC-043, TC-044, TC-045, TC-046, TC-047, TC-048 | PARTY-001～PARTY-009 | PHASE-001；TASK-014～TASK-019 |
| TC-049, TC-050, TC-051, TC-052, TC-053, TC-054, TC-055, TC-056, TC-057, TC-058, TC-059, TC-060, TC-061 | APR-001～APR-013 | PHASE-002；TASK-025～TASK-031 |
| TC-062, TC-063, TC-064, TC-065, TC-066, TC-067, TC-068, TC-069, TC-070, TC-071, TC-072, TC-073, TC-074, TC-075, TC-076, TC-077 | BANK-001～BANK-016 | PHASE-003；TASK-032～TASK-037 |
| TC-078, TC-079, TC-080, TC-081, TC-082, TC-083, TC-084, TC-085 | SKU-001～SKU-008 | PHASE-004；TASK-038～TASK-040 |
| TC-086, TC-087, TC-088, TC-089, TC-090, TC-091, TC-092, TC-093, TC-094, TC-095, TC-096, TC-097, TC-098, TC-099, TC-100, TC-101, TC-102 | IMP-001～IMP-017 | PHASE-004；TASK-041～TASK-049 |
| TC-103, TC-104, TC-105, TC-106, TC-107, TC-108, TC-109, TC-110 | AUD-001～AUD-008 | PHASE-001～PHASE-004；TASK-009, TASK-026, TASK-033, TASK-045 |
| TC-111, TC-112, TC-113, TC-114, TC-115, TC-116, TC-117, TC-118, TC-119, TC-120 | AUTH-001～AUTH-010 | PHASE-001～PHASE-004；TASK-002, TASK-024, TASK-031, TASK-037 |
| TC-121, TC-122, TC-123, TC-124, TC-125, TC-126, TC-127 | UI-001～UI-007 | PHASE-001～PHASE-004；TASK-011, TASK-013, TASK-015, TASK-017, TASK-019, TASK-021, TASK-023, TASK-027, TASK-030, TASK-035, TASK-039, TASK-046 |
| TC-128, TC-129, TC-130, TC-131, TC-132, TC-133, TC-134, TC-135, TC-136 | OPS-001～OPS-009 | PHASE-004；TASK-050～TASK-051 |

### 5.2 Canonical requirement coverage manifest

本manifest透過`01_requirement_spec.md`的alias對應詳細案例所列legacy requirement ID；實際PASS仍須由詳細案例證據決定：

- FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087.
- NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011.
- SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014.

## 6. 詳細測試案例

### 6.1 Migration、Schema、Business Master contract及啟動基線

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MIG-001 | P0 | NFR-009；全新DB可部署 | Migration/DB | 空白隔離MySQL；已配置fake Bank keys及READY Business Master provider | 實作當時分配的Supplier migrations | 依runner順序執行全部migration並啟動server，從container解析`supplierCoreProvider`及`supplierBusinessMasterImpactChecker` | 全部成功；ledger、schema與設計一致；Supplier未建立Currency／Payment Term影子schema；兩個provider有固定contract/readiness且startup self-check健康 | migration輸出、schema hash、container/provider readiness、health log | — | NOT RUN |
| MIG-002 | P1 | NFR-009；Migration冪等及半套用收斂 | Migration/DB | 已完成DB及逐支模擬部分DDL/DML DB | 每支migration | 重跑全部；再對半套用情境重跑 | 已完成者no-op；半套用收斂；無重複seed、permission或資料遺失 | 兩次輸出、ledger及schema/data diff | — | NOT RUN |
| MIG-003 | P0 | BR-001、BR-004、BR-010、BR-019；DB競態防護 | DB/Concurrency | 真MySQL；兩條獨立connection | Code／Identifier／primary purpose／default Bank／pending approval競態 | barrier同步插入或切換衝突資料 | 每項constraint只允許一個合法結果；另一交易穩定失敗；無雙primary/default/pending | responses、transaction log、constraint及最終SQL | — | NOT RUN |
| MIG-004 | P1 | FR-SET-003、SEC-001～SEC-007、SEC-014；seed正確 | Migration/DB | 空DB；Business Master已提供Active Currency | 六permissions、system-admin、settings id=1 | Migration後查permission catalogue、Supplier-owned seed及Business Master引用；重跑 | 六權限及system-admin關聯各一份；approval預設OFF；Currency／Payment Term沒有Supplier-owned seed；無未知extra | SQL快照、catalogue及provider startup log | — | NOT RUN |
| MIG-005 | P0 | SEC-010、NFR-010；缺安全設定fail closed | Startup/Security | Bank schema已部署 | 缺key、壞base64、非32-byte、active ID不存在、threshold/limits越界 | 各配置啟動server | 全部啟動失敗且不提供部分服務；log只說設定類型，不洩漏值 | exit code、health、redacted logs | — | NOT RUN |
| MIG-006 | P1 | NFR-009；upgrade與forward-only相容 | Deployment/DB | 具目前main migrations及核心資料的DB與備份 | 現有users/roles/audit | 從最新main配置並套用Supplier migrations；驗證舊功能；演練server/client回滾 | 舊資料不變；新schema可讀；不drop/down；沒有修改或回填既有migration；回滾邊界符合runbook | 前後SQL、ledger、回歸輸出、rollback記錄 | — | NOT RUN |
| MIG-007 | P0 | FR-SKU-003、BR-002；Item依賴不可弱化 | Migration/Integration | 一組無Item tables DB；一組有正式SKU/UOM DB | supplier_sku_refs migration | 無依賴時嘗試部署；依賴存在後執行並測FK | 無Item時不建立自由ID表／不註冊能力；有Item時用正式FK成功，跨SKU UOM被拒 | schema、handler registry、FK error及SQL | — | NOT RUN |

### 6.2 列表、搜尋與詳情

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-001 | P1 | FR-LIST-001、NFR-002；server-side分頁 | API/DB | U-VIEW；至少125筆含Archived | page缺省；pageSize 1/20/100及0/101 | GET suppliers並翻頁 | 預設20、上限100；非法邊界400；items與total是filter後值；預設排除Archived | responses、count SQL、query trace | — | NOT RUN |
| LIST-002 | P1 | FR-LIST-002～003；多欄搜尋與正規化 | API/DB | U-VIEW；各欄唯一fixtures | Code、Name、Display Name、identifier、phone、email；大小寫及外圍空白 | 對每類完整／部分值搜尋 | 所有指定欄可命中；Code/Name忽略case及trim；無row重複、total正確 | responses、對照SQL | — | NOT RUN |
| LIST-003 | P1 | FR-LIST-004；組合篩選 | API/DB | 跨狀態、currency、term、completeness、日期資料 | 單一及多個filter | 逐一查詢並組合filter | 只回交集；missing primary/address/bank與updated range邊界正確 | request/response、fixture matrix、SQL | — | NOT RUN |
| LIST-004 | P1 | FR-LIST-005；穩定排序 | API/DB | 多筆同值資料 | Code、Name、status、updatedAt；ascending/descending | 各排序跨頁查詢 | allowlist欄位排序正確；同值以ID穩定；翻頁不漏不重 | responses、排序對照 | — | NOT RUN |
| LIST-005 | P0 | BR-031、SEC-009；LIKE與sort注入防護 | API/Security | U-VIEW；含%, _, \及Unicode資料 | q特殊字元、SQL片段、惡意sortBy | 查詢列表 | LIKE符號按字面escape；非法sort 400；SQL未拼接payload，DB不變 | response、SQL trace、DB health | — | NOT RUN |
| LIST-006 | P1 | FR-LIST-006～007、FR-LIST-010；列表projection與狀態 | API/UI | U-VIEW、U-BANK-R、U-NONE | 含Bank、缺Bank、各狀態資料；loading/error/empty | 以三角色讀列表並模擬狀態 | 指定columns及清楚狀態；最多masked／是否設定；無權限、空、載入、錯誤可區分 | responses、screenshots、network | — | NOT RUN |
| LIST-007 | P1 | FR-VIEW-001～005；詳情與歷史提示 | API/UI | U-VIEW；各狀態Supplier | 一般資料、children、payment、masked Bank及下游摘要 | GET detail並開各tab | 一般資料完整；下游只顯示摘要／連結；非Active有不可採購提示；不重算交易 | response、screenshots、對照SQL | — | NOT RUN |
| LIST-008 | P1 | FR-LIST-009；URL保留查詢 | UI | U-VIEW登入 | q、page、sort、filters | 操作列表、refresh、back/forward及分享URL | query state可還原；不另建未定義saved-filter；URL不含敏感值 | URL、screenshots、network | — | NOT RUN |
| LIST-009 | P1 | FR-LIST-008；SKU context入口 | UI/Integration | U-PO；Item能力已部署 | SKU-A及有／無relation Supplier | 從Purchasing開啟Supplier查找 | 帶skuId；顯示首選／曾供貨原因；所有Active Supplier仍可搜尋 | route、API response、screenshots | — | NOT RUN |

### 6.3 Supplier建立、修改、唯一性與交易

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CORE-001 | P1 | FR-CREATE-001、AC-001；建立Draft | API/DB | U-MGMT；HKD Active | 唯一Code、Name、HKD及選填children | POST suppliers/create activate=false | 建立Draft、version=1；root/children/audit同交易；detail可查 | request/response、Supplier/child/audit SQL | — | NOT RUN |
| CORE-002 | P0 | FR-CREATE-006、AC-007、BR-011；直接啟用 | API/DB | Approval OFF；U-MGMT | 只有Code、Name、HKD | Create activate=true及Draft activate | Supplier直接Active；無approval request；啟用audit恰一筆 | responses、settings/Supplier/approval/audit SQL | — | NOT RUN |
| CORE-003 | P0 | FR-CREATE-007～008、AC-008；建立並提交 | API/DB | Approval ON；U-MGMT、U-APR-A | 最低欄位＋approver | Create activate=true | Supplier Pending；request snapshot/assignee/version正確；回Code、狀態及下一步 | response、Supplier/request/audit SQL | — | NOT RUN |
| CORE-004 | P0 | FR-CREATE-002～003、BR-003～004、AC-002；Code規則 | API/DB | 各狀態已有SUP-001 | 手工Code、空白、control、64/65字、sup-001 | 建立／修改並做兩connection競態 | 不自動生成或加prefix；合法人工格式接受；invalid 400；normalized duplicate 409且無部分資料 | responses、constraint、DB/audit快照 | — | NOT RUN |
| CORE-005 | P1 | FR-CREATE-004、BR-009、AC-003；名稱只警告 | API/DB | 已有相同／近似中英文名稱 | exact、Dice 0.8499/0.85、重音、全半形、首中尾錯字 | duplicates/check後確認建立 | threshold以上最多10筆穩定候選；以下不回；warning不阻擋，合理確認後可建 | responses、candidate query/score evidence | — | NOT RUN |
| CORE-006 | P0 | FR-CREATE-005、BR-007～008、AC-020；啟用完整性 | API/DB | U-MGMT；Approval OFF | 逐一缺Code/Name/Currency；缺全部optional | activate | 缺最低欄位422並列全部issues；缺Address/Contact/Term/Identifier/Bank仍Active，只回warnings | responses、DB/audit快照 | — | NOT RUN |
| CORE-007 | P1 | FR-EDIT-003、BR-006、BR-030～031；輸入邊界 | Validation/Security | U-MGMT | email/URL/country/SWIFT/phone長度，HTML/script，company/type欄，unknown nested field | Create/update各輸入 | schema additionalProperties=false；不接受type；危險標記不執行；錯誤穩定且無部分寫入 | responses、rendered UI、DB值、CSP/log | — | NOT RUN |
| CORE-008 | P0 | NFR-008；Create冪等 | API/DB | U-MGMT | IDEM-A同payload重送；IDEM-A異payload；IDEM-B | 連續及並發POST create | 同key同payload只建一筆並回一致結果；同key異payload拒絕；新key按unique規則處理 | responses、idempotency/Supplier/audit SQL | — | NOT RUN |
| CORE-009 | P1 | FR-EDIT-001、FR-EDIT-005；一般更新與audit | API/DB | U-MGMT；S-ACTIVE | mutable fields、currency、payment term、reason | POST update | 只更新允許欄、version+1；重新驗證；關鍵前後值與reason audit正確 | request/response、前後SQL、audit | — | NOT RUN |
| CORE-010 | P0 | FR-EDIT-002、BR-005、AC-005～006；Code受控修改 | API/DB/Security | 未引用S-DRAFT及S-REF；approved device | 唯一／duplicate新Code、REASON、password | 呼叫code/change | 未引用且認證完整時成功並audit；有引用或duplicate拒絕，原Code及下游關聯不變 | responses、reference counts、DB/audit | — | NOT RUN |
| CORE-011 | P0 | FR-EDIT-004、BR-029、AC-038、NFR-007；optimistic lock | Concurrency/API | 兩session讀同version | 不同更新payload | A先保存；B以舊version保存；再並發保存 | 一個成功；另一個409 VERSION_CONFLICT；不自動重試或混合欄位 | responses、transaction log、DB/audit | — | NOT RUN |
| CORE-012 | P0 | FR-AUDIT-005、NFR-006；業務與audit原子性 | Failure/Transaction | 可注入child、audit及commit失敗 | Create aggregate及update | 在各步驟失敗後查DB並重試 | 失敗全部rollback且無誤導成功audit；修復後可安全重試 | error、transaction log、全表前後快照 | — | NOT RUN |
| CORE-013 | P1 | FR-EDIT-006～007、BR-025、AC-032；草稿與交易快照 | UI/Integration | 已有purchase snapshot；開啟dirty editor | 修改Name/address/currency/term/Bank | 離頁；選擇留頁／離開；保存後查既有交易 | 離頁先提示；Supplier新值保存，但既有交易snapshot完全不變 | UI evidence、Supplier及交易SQL | — | NOT RUN |

### 6.4 狀態、刪除與新交易資格

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STATE-001 | P0 | FR-STATUS-001、BR-014、AC-014；Active→Suspended | API/Integration | U-MGMT；S-ACTIVE | REASON、password | suspend後查purchase lookup及history | Suspended；立即退出新交易清單；既有單據／history可查；audit正確 | response、lookup/history、DB/audit | — | NOT RUN |
| STATE-002 | P1 | 狀態機；Suspended→Active | API/DB | U-MGMT；S-SUSP | 完整／缺最低欄位兩組 | reactivate | 完整者Active；不完整者422且仍Suspended；optional缺失不阻擋 | responses、DB/audit | — | NOT RUN |
| STATE-003 | P0 | FR-STATUS-002～003、BR-016、AC-015～016；Block權限 | API/Security | U-MGMT、U-APR-A；S-ACTIVE/S-BLOCK | REASON、password、device signature | mgmt嘗試block/unblock；approval user執行 | mgmt拒絕；approval user可block；unblock只到Suspended；高強度認證及audit齊全 | responses、auth logs、DB/audit | — | NOT RUN |
| STATE-004 | P1 | FR-STATUS-004；Archive open-flow guard | API/Integration | U-MGMT；有／無open flow Supplier | REASON、password | archive兩組 | 有open flow回409及具名阻擋項；無阻擋者Archived；不取消下游流程 | responses、reference evidence、DB/audit | — | NOT RUN |
| STATE-005 | P0 | FR-STATUS-007～008、BR-017、AC-017；Archive/restore | API/UI | U-MGMT；S-ARCH | includeArchived、REASON、password | 日常查詢、明確篩選、restore | 預設不見但可查回；restore為Suspended而非Active；新交易仍不可用 | list/lookup responses、DB/audit、UI | — | NOT RUN |
| STATE-006 | P0 | FR-STATUS-005～006、BR-018、AC-018～019；永久刪除 | API/DB | unreferenced S-DRAFT、曾Active及S-REF | REASON、password、device | 對三組delete | 只有從未引用Draft刪除；children按政策處理、audit保留；其餘409並提供替代狀態 | responses、reference/DB/audit快照 | — | NOT RUN |
| STATE-007 | P0 | BR-032；提交時重新驗證狀態 | Integration/Concurrency | U-PO先載入S-ACTIVE；兩條獨立MySQL connection及可控barrier | lookup後並發把Supplier suspend/block；另以未知status fixture驗impact分類 | connection A於purchase transaction執行`assertUsableInTransaction`並持鎖，connection B嘗試狀態改動；交換先後次序重跑，再以舊畫面提交新purchase及執行Business Master impact preview | `FOR UPDATE`序列化競態；先完成狀態變更時提交端重驗拒絕且不產生新交易；未知status令impact checker fail closed而不低報；歷史仍可讀 | barrier/lock結果、lookup、submit/preview response、DB | — | NOT RUN |
| STATE-008 | P0 | NFR-008；狀態command重送 | API/DB | 任一合法transition | 同idempotency key同payload及異payload | 重送相同target；送相反／過時transition | 相同終態回現況且不重複audit；異payload／非法轉換穩定拒絕 | responses、audit count、DB | — | NOT RUN |
| STATE-009 | P0 | NFR-006～008；狀態並發 | Concurrency/DB | S-ACTIVE；兩connection | suspend與block／archive同步 | barrier同時提交 | 只產生一條合法序列；另一請求409；終態、version及audit一致，無deadlock殘留 | responses、lock/transaction log、DB/audit | — | NOT RUN |
| STATE-010 | P1 | BR-015；非Active歷史語意 | API/Integration | S-SUSP、S-BLOCK、S-ARCH及歷史交易 | purpose purchase/history | 分別findById/findMany/查舊單 | purchase拒絕非Active；history保留名稱、地址及snapshot顯示 | service/API結果、DB對照 | — | NOT RUN |

### 6.5 Address、Contact與Identifier

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PARTY-001 | P1 | FR-PARTY-001；Address CRUD與排序 | API/DB/UI | U-MGMT；S-ACTIVE | 多地址、purpose、sort、valid country | create/update/deactivate並重排 | 值、purpose、status、sort及audit正確；detail/UI順序一致 | responses、DB/audit、UI | — | NOT RUN |
| PARTY-002 | P1 | FR-PARTY-001；Contact CRUD與排序 | API/DB/UI | U-MGMT；S-ACTIVE | 多聯絡人、語言、email/phone、purpose | create/update/deactivate並重排 | 聯絡資料、purpose、status、sort及audit正確；inactive歷史仍可辨識 | responses、DB/audit、UI | — | NOT RUN |
| PARTY-003 | P0 | FR-PARTY-002～003、AC-021；primary原子切換 | Concurrency/DB | 同purpose已有primary | 另一Address／Contact；兩個並發候選 | 設新primary；再同步設兩個 | 舊primary同交易清除；最終每Supplier/purpose恰一個；失敗不留零／雙primary | responses、constraint/transaction、SQL | — | NOT RUN |
| PARTY-004 | P1 | FR-PARTY-004；停用與歷史保留 | API/Integration | 已被交易snapshot引用的Address/Contact/Identifier | referenced children | deactivate/delete/update | 不破壞歷史；Address/Contact停用並清primary；被引用Identifier不可破壞語意 | responses、snapshot及child SQL/audit | — | NOT RUN |
| PARTY-005 | P0 | FR-PARTY-005、BR-010、AC-004；Identifier唯一 | API/DB/Concurrency | 已有identifier | type/country/value大小寫、分隔符、兩connection | 新增／修改及並發duplicate | type-aware normalization；同組409且只成功一筆；不同type/country可存在 | responses、unique constraint、DB/audit | — | NOT RUN |
| PARTY-006 | P0 | SEC-009；Child ownership IDOR | API/Security | Supplier A/B各有child；U-MGMT | B route＋A child ID | read/update/deactivate/delete各child | 對不可暴露組合回404；A/B資料及audit不變；不洩漏存在性 | responses、DB/audit、security log | — | NOT RUN |
| PARTY-007 | P1 | FR-PARTY-006；完整度提示不阻擋 | API/UI | 無primary contact/address的S-DRAFT | 最低三欄完整 | completeness及activate | warnings指出缺項但issues為空；可啟用；UI清楚標為非阻擋 | response、DB/audit、screenshot | — | NOT RUN |
| PARTY-008 | P1 | §5.5～5.7邊界與cross-field | Validation | U-MGMT | 長度邊界、ISO country、purpose enum、空陣列、重複purpose、unknown field | create/update children | 合法邊界接受；非法400；不截斷、不部分覆蓋mapping | responses、DB前後 | — | NOT RUN |
| PARTY-009 | P1 | FR-VIEW-001；大型children分頁 | API/DB | Supplier有>100 contacts及addresses | page/pageSize邊界 | detail及children list翻頁 | detail只回設計上限；專用端點server-side分頁，total準確且無漏重 | responses、count SQL | — | NOT RUN |

### 6.6 Approval、Supplier Settings與Business Master read contract

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| APR-001 | P0 | FR-SET-003、BR-011；設定預設OFF | API/DB | 新DB；U-SET及U-MGMT | settings id=1 | GET settings；以最低三欄activate | setting=false/version正確；新Supplier直接Active且無request | response、settings/Supplier/request/audit SQL | — | NOT RUN |
| APR-002 | P0 | FR-SET-002、SEC-007、AC-036；Settings授權 | API/Security | U-SET、U-MGMT、U-NONE | GET/update合法body | 三角色呼叫Settings頁及API | 只有U-SET可讀寫；mgmt不能繞過；拒絕時setting/audit不變 | responses、route/UI、DB/audit | — | NOT RUN |
| APR-003 | P1 | FR-SET-004～006、AC-037；typed設定更新 | API/DB/UI | U-SET；approved device | true/false、REASON、password、version、unknown field | 開關toggle；送unknown／stale版本 | 合法更新顯示影響並audit before/after；未知欄400；stale 409；無generic JSON欄 | responses、UI、settings/audit SQL | — | NOT RUN |
| APR-004 | P0 | FR-APPROVAL-001～002、BR-012、AC-008～009；提交與SoD | API/DB | Approval ON；U-MGMT、U-APR-A、U-DISABLED | self、disabled、無permission、合法approver | activate/submit各組 | 合法者Pending；self/disabled/無權限400且維持Draft；最多一個pending | responses、user permission join、Supplier/request/audit SQL | — | NOT RUN |
| APR-005 | P1 | FR-APPROVAL-003；最小化snapshot與approver目錄 | API/Security | U-MGMT/U-APR-A；S-PENDING有Bank | approver search、detail | 查eligible approvers及approval detail | 目錄只回id/username/displayName且≤100；snapshot含非敏感資料／masked identifier，不自動reveal Bank | responses、payload scan、DB對照 | — | NOT RUN |
| APR-006 | P0 | FR-APPROVAL-004、AC-010；批准 | API/DB | U-APR-A為assigned；S-PENDING完整 | password、request/version | approve | request Approved、Supplier Active；decidedBy/time及一筆decision audit一致；回Code與結果 | response、Supplier/request/audit SQL | — | NOT RUN |
| APR-007 | P0 | FR-APPROVAL-004、AC-011；拒絕 | API/DB/UI | U-APR-A assigned；S-PENDING | reason缺少/4/5/500/501及password | reject各邊界 | 5–500合法：request Rejected、Supplier Draft、requester可見原因；非法無變更 | responses、UI、Supplier/request/audit SQL | — | NOT RUN |
| APR-008 | P1 | FR-APPROVAL-005～006；撤回 | API/Security | S-PENDING | requester及其他mgmt user | withdraw | 只有原requester可撤回；成功回Draft並有time/audit；他人拒絕且無變更 | responses、request/Supplier/audit SQL | — | NOT RUN |
| APR-009 | P0 | BR-013、AC-012；關鍵修改使申請失效 | API/Transaction | S-PENDING | Code/Name/displayName/currency/term/identifier逐組 | U-MGMT更新後嘗試approve原request | 同交易request Invalidated、Supplier Draft再更新；原申請不可批准且要求重提 | update/approve responses、transaction及DB/audit | — | NOT RUN |
| APR-010 | P1 | FR-SET-005、AC-013；設定不追溯 | Concurrency/DB | S-PENDING；Approval ON | toggle OFF與既有request | 更新setting並查request；再建立新Supplier | 既有request仍Pending；不自動批准；新提交按OFF直接Active；setting audit正確 | responses、settings/request/Supplier/audit SQL | — | NOT RUN |
| APR-011 | P1 | FR-APPROVAL-006；Queue與重新指派 | API/UI | U-APR-A/B；含mine/all/unassigned資料 | scopes、filters、新approver、REASON | 列表翻頁、查看diff、reassign | server-side scopes/filter/total正確；任一approval user可重派；不得指派requester；before/after/reason有audit | responses、UI、request/audit SQL | — | NOT RUN |
| APR-012 | P0 | FR-APPROVAL-007、NFR-008；重送與並發決定 | Concurrency/DB | 同一Pending request；兩approval sessions | 重複approve；approve vs reject/reassign | barrier同步及重送 | 只一個terminal transition及一筆decision audit；其餘409/冪等現況；無矛盾終態 | responses、lock log、request/Supplier/audit SQL | — | NOT RUN |
| APR-013 | P0 | SEC-004、NFR-006；stale actor/assignee/snapshot | API/Security/Concurrency | token後撤權或停用approver；另有Supplier版本競態 | stale JWT、unassigned、舊request/version | approve/reject/reassign | stale claim回PERMISSION_STALE；已失效assignee不可決定；stale snapshot拒絕；資料原子不變 | responses、permission/request/Supplier/audit SQL | — | NOT RUN |

### 6.7 銀行帳戶與敏感資料

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BANK-001 | P0 | FR-BANK-002、AC-023；masked list一致 | API/Security | U-VIEW、U-BANK-R；S-ACTIVE | 一般及≤4字元虛構帳號 | list/detail Bank | 所有角色一般projection只masked；短帳號全遮；無ciphertext/IV/tag/index/keyId | responses及敏感欄位scan | — | NOT RUN |
| BANK-002 | P0 | FR-BANK-002、SEC-005、AC-024；受控reveal | API/DB | U-BANK-R；正確/錯誤password | BANK-A | POST reveal | 正確時先commit bank.reveal audit再回明文、expires=30及no-store/private；錯密碼不回值／audit | headers、redacted response proof、audit SQL | — | NOT RUN |
| BANK-003 | P0 | FR-BANK-001、SEC-006、AC-025；Bank write權限組合 | API/Security | U-MGMT、只有bank.mgmt、U-BANK-R、U-BANK-W | create/update/default/deactivate | 各角色逐route呼叫 | 只有同時view＋bank.view＋bank.mgmt且高強度認證者可寫；其餘拒絕且DB不變 | permission matrix responses、DB/audit | — | NOT RUN |
| BANK-004 | P0 | SEC-013；device/password/replay保護 | API/Security | U-BANK-W | 缺/錯password、缺/撤銷device、body/path簽章錯、nonce重放 | 對每個Bank write送出 | 全部拒絕；合法nonce只使用一次；不重複修改或audit；錯誤不洩密 | responses、device/nonce log、DB/audit | — | NOT RUN |
| BANK-005 | P0 | FR-BANK-001、SEC-010；Create只存密文 | API/DB/Crypto | U-BANK-W；fake key rings | BANK-A、metadata、isDefault | create後查API、DB、logs | DB只有AES-GCM密文/IV/tag/keyId/blind index及安全尾碼；找不到明文；audit masked | redacted request proof、schema/DB search count、logs/audit scan | — | NOT RUN |
| BANK-006 | P0 | §3.3；Crypto完整性與AAD | Unit/Integration | 可注入fake keys及DB bit mutation | 不同supplierId/context；改ciphertext/IV/tag各1 bit | encrypt/decrypt及reveal | round-trip正確；IV每次不同；搬row或tamper fail closed；公開500不含內部值並觸發告警 | unit output、redacted logs/metric、response | — | NOT RUN |
| BANK-007 | P0 | §3.3、FR-BANK-007；key unavailable | Startup/API | row引用舊key；ring缺該ID | encryption及lookup兩類 | 啟動／reveal／duplicate check | Production startup或操作依設計fail closed；503只回BANK_KEY_UNAVAILABLE，不公開key ID／ciphertext | exit/response、redacted log/alert | — | NOT RUN |
| BANK-008 | P0 | FR-BANK-003、BR-019、AC-026；唯一default | Concurrency/DB | S-ACTIVE已有default | 第二/第三active Bank；兩connection | 單次及同步set default | 舊default同交易清除；最終恰一個active default；並發不出現雙default，衝突可重試 | responses、transaction/constraint、SQL/audit | — | NOT RUN |
| BANK-009 | P0 | duplicate blind index規則 | API/DB/Crypto | 同／不同Supplier已有BANK-A | 分隔符/case normalization；同account；跨Supplier | create duplicate | 同Supplier硬性409且不回帳號；跨Supplier只給低敏warning及允許確認；rotation key並存仍可偵測 | responses、blind-index query proof、DB/audit | — | NOT RUN |
| BANK-010 | P1 | FR-BANK-001；Update加密行為 | API/DB | U-BANK-W；既有Bank version | 只改bankName；另改accountNumber | update兩組 | 不改帳號時密文/IV/index不變；改帳號時新IV/index/keyId且舊明文不可找；version/audit正確 | 前後binary hashes、DB/audit、response | — | NOT RUN |
| BANK-011 | P1 | FR-BANK-005～006；停用與付款引用 | API/DB | 未引用／已引用Bank；其中一個default | REASON及高強度認證 | deactivate/delete嘗試 | 停用成功並清default；已引用資料保留；不提供不允許的永久刪除；每次有masked audit | responses、reference/Bank/audit SQL | — | NOT RUN |
| BANK-012 | P0 | FR-BANK-006、NFR-006；audit失敗不reveal/不寫 | Failure/Transaction | 可注入audit insert failure | reveal/create/update/default/deactivate | 逐個操作 | 業務寫入全部rollback；reveal不回明文；無成功但無audit的狀態 | errors、transaction log、DB/audit | — | NOT RUN |
| BANK-013 | P0 | FR-BANK-007、BR-020、SEC-010～011；全通道洩漏掃描 | Security/Data | 使用唯一虛構marker執行成功與失敗Bank流程 | account、key、ciphertext marker | 搜DB dump、request/system/audit logs、errors、cache、CSV、notifications | 允許的encrypted columns外，完整帳號/key搜尋為0；一般輸出只masked | 受控scan命令與count、artifact inventory | — | NOT RUN |
| BANK-014 | P0 | Bank UX明文生命週期 | UI/Security | U-BANK-R；可控timer/session | BANK-A | reveal後等待30秒；close、route leave、unmount、session expiry；檢查storage/DOM/URL/toast | 初始不自動reveal；每種事件立即清值；不進Pinia/storage/URL/hidden DOM；write後清account/password | screenshots、network、DOM/storage scans | — | NOT RUN |
| BANK-015 | P0 | SEC-010；Encryption與lookup key輪替 | Operations/Crypto/DB | 新舊key ring；多批rows | 中斷點、last ID、同帳號duplicate | 各rotation執行一半中斷、續跑、重跑 | bounded batch可續跑；AAD/明文不變；index+keyId同交易；舊key row count=0前不可移除；report無敏感值 | rotation reports、row counts、duplicate test、redacted logs | — | NOT RUN |
| BANK-016 | P0 | NFR-009；Bank backup/restore | Recovery/DB | 有encrypted Bank資料；可建立隔離restore | 完整DB＋key ring、只有DB、錯key | 三種restore後啟動/reveal | DB＋正確keys可還原；缺/錯key fail closed；不以移除key回滾；備份artifact受控無明文 | backup manifest、restore logs、redacted reveal proof | — | NOT RUN |

### 6.8 Supplier–SKU軟性關係與Purchasing

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SKU-001 | P0 | FR-SKU-001、BR-023、AC-028；無relation仍可選 | API/Integration | U-PO；SKU-A；多個Active Supplier無relation | q/page | listForSku | 所有匹配Active Supplier仍出現且可選；LEFT JOIN及total不因relation缺失而少 | response、對照SQL/EXPLAIN | — | NOT RUN |
| SKU-002 | P1 | FR-SKU-002、AC-029；排序原因 | API/UI | SKU-A有preferred、recent、historical及none | 同名tie及lastSupplied時間 | 開選擇器及翻頁 | exact→preferred→recent supplied→other；顯示reason；同值以名稱/ID穩定 | response、UI、排序fixture | — | NOT RUN |
| SKU-003 | P0 | FR-SKU-005、BR-024、AC-030；無效狀態不可繞過 | Integration/Concurrency | preferred relation但Supplier或SKU inactive | Suspended/Blocked/Archived Supplier、SKU-INACTIVE | lookup後提交purchase | 無效對象不可成為可交易；提交時重驗；relation仍可作history | lookup/submit response、DB | — | NOT RUN |
| SKU-004 | P1 | FR-SKU-003；Relation CRUD與邊界 | API/DB | U-MGMT；S-ACTIVE、SKU-A及其UOM | item code/name、UOM、MOQ 0/1/max、lead 0/3650/3651、三status | create/update/list | 合法資料保存且version/audit正確；越界/錯UOM拒絕；多個preferred允許 | responses、relation/audit SQL | — | NOT RUN |
| SKU-005 | P0 | BR-002；Relation唯一性與FK | DB/Concurrency | 真MySQL；兩connection | 同Supplier/SKU、同itemCode、跨SKU UOM | 同步create及直接DB負測 | composite unique/FK阻止duplicate與錯owner；只用IDs關聯，不以Code/Name作FK | constraint errors、schema、final SQL | — | NOT RUN |
| SKU-006 | P1 | FR-SKU-004、AC-031；Purchasing回寫冪等 | Integration/DB | 已完成一筆向無relation Active Supplier的purchase | 重複callback/command | 回寫一次、重送、更新last supplied | 建立或更新一條relation；不改Supplier/SKU狀態；重送不duplicate | requests、relation/Supplier/SKU/audit SQL | — | NOT RUN |
| SKU-007 | P0 | FR-SKU-006；不得保存價格 | Security/Data | 建立／更新relation及Purchasing回寫 | price/quote/contractPrice unknown fields | 經API、UI及整合入口提交 | 欄位拒絕或忽略依schema但永不持久化；table/API/audit沒有價格資料 | responses、schema/DB/audit scan | — | NOT RUN |
| SKU-008 | P1 | NFR-005；100k lookup SLA | Performance | PERF dataset；50 users | exact、preferred、no relation及page workload | warm-up後穩定負載 | p95<2秒；error rate在批准門檻內；count不膨脹；使用預期indexes | workload、p50/p95/p99、error rate、EXPLAIN/resources | — | NOT RUN |

### 6.9 CSV Import與Export

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IMP-001 | P1 | FR-IMPORT-001；versioned template | API/File/UI | U-MGMT | Template v1 | 下載template並檢查header、說明、example、encoding | UTF-8 CSV含版本、root及各一組選填child；標示不接受Bank；required fields與設計一致 | response headers、file hash/content、UI | — | NOT RUN |
| IMP-002 | P1 | RFC4180與Unicode正確 | File/Unit | Parser可用 | quoted comma/newline/quote、BOM、CRLF/LF、中英文、前導零 | upload/precheck後下載結果再parse | 欄位無錯位或資料損失；前導零保留；結果可由RFC4180 parser讀回 | source/result hashes、parsed values | — | NOT RUN |
| IMP-003 | P0 | Upload邊界與path安全 | API/Security | U-MGMT；受控import root | empty、非CSV、壞UTF-8、malformed quote、10MB邊界、10000/10001 rows、偽MIME、../filename、symlink | 逐檔upload | 只接受合法raw CSV；超限/壞格式明確拒絕；server自命名且不離開root、不跟symlink | responses、filesystem inventory、logs | — | NOT RUN |
| IMP-004 | P0 | FR-IMPORT-002；precheck零正式寫入 | API/DB | U-MGMT；CSV-MIXED | upload job | 執行precheck前後比較Supplier及audit tables | Job/rows可寫，但Supplier root/children/Bank及業務audit row count不變 | response、全表前後SQL、job/row SQL | — | NOT RUN |
| IMP-005 | P1 | FR-IMPORT-003；逐列分類與reason | API/UI | 已precheck CSV-MIXED | create/update/warning/invalid rows | 查job detail、filter並開UI | 每列operation/status/field/reason可理解且bounded；summary與rows一致 | response、UI、對照matrix | — | NOT RUN |
| IMP-006 | P0 | FR-IMPORT-004～005、BR-027、AC-033；部分成功 | Integration/DB | ready_with_errors job | valid create、valid update及invalid row | confirm並等terminal | 合法列完整applied；錯誤列不寫；job為completed_with_errors；count與下載逐列一致 | job/row/Supplier/child/audit SQL、result file | — | NOT RUN |
| IMP-007 | P0 | BR-027；單列aggregate原子性 | Failure/Transaction | 可在root/Address/Contact/Identifier/audit各點注入失敗 | 一列含全部選填child | 各失敗點執行後查DB，再修復重試 | 該列全有或全無；失敗另短交易標failed；不留orphan/部分audit | transaction logs、相關表SQL、重試結果 | — | NOT RUN |
| IMP-008 | P0 | FR-IMPORT-007、AC-035、NFR-008；upload/confirm冪等 | API/DB/Concurrency | 同source hash及ready job | 同key同payload、同key異payload、不同key同file；雙擊confirm | 連續與barrier同步送出 | 不重複Job/Supplier/approval/audit；同key異payload拒絕；最終狀態唯一 | responses、idempotency/job/row/Supplier/audit SQL | — | NOT RUN |
| IMP-009 | P0 | Worker commit crash window | Resilience/DB | 可在commit前後kill worker | 單一valid create row | commit前kill/restart；commit後ack前kill/restart | 前者Supplier與marker皆無並可重做；後者兩者皆在且retry skip；無雙Supplier | process/lease logs、row/Supplier/audit SQL | — | NOT RUN |
| IMP-010 | P0 | Worker lease與雙worker競爭 | Concurrency/DB | 兩worker；短lease；多rows | 同Job claim、expired lease、graceful shutdown | 同步啟動、kill owner、接管及重啟 | 一次只一owner/row；terminal row不重做；停止時不claim新Job；恢復後完成 | worker logs、lease/row SQL、audit counts | — | NOT RUN |
| IMP-011 | P0 | FR-IMPORT-006、BR-026；Upsert匹配與版本 | Integration/DB | 已有Supplier | supplierId+matching/mismatching Code、only Code、unknown ID、stale version、child fields、blank optional root | precheck及confirm | ID優先且Code交叉檢查；未知/不一致拒絕；stale只該row failed；child欄回指定錯；blank不清空 | row errors、Supplier前後SQL、result | — | NOT RUN |
| IMP-012 | P0 | Approval policy snapshot | Integration/Concurrency | Approval ON/OFF；U-MGMT及U-APR-A | draft/activate、self/合法approver；confirm後toggle setting | confirm並在worker前改setting | Job保存confirm時value/version；OFF activate→Active且拒絕多餘approver；ON→Pending且要求他人；後改setting不追溯 | job/Supplier/request/settings/audit SQL | — | NOT RUN |
| IMP-013 | P1 | Job狀態、cancel及count重建 | API/DB | uploaded/validating/ready/queued/running/terminal jobs | cancel重送、running cancel、corrupt cached counts | list/detail/cancel並從rows重建 | 只取消未running；重送不矛盾；terminal不可倒退；total=applied+failed+skipped並可重建 | responses、job/row SQL、audit/log | — | NOT RUN |
| IMP-014 | P0 | FR-IMPORT-008、BR-028、AC-034；Bank欄位拒絕 | File/Security | U-MGMT | accountNumber/IBAN/ciphertext/key等header和值 | upload/precheck/export及全通道scan | precheck明確invalid、不靜默忽略；不寫Supplier/Bank/job payload敏感值；一般export永不包含 | response、DB/files/log/audit scans | — | NOT RUN |
| IMP-015 | P0 | FR-IMPORT-005、FR-IMPORT-010；result ownership與retention | API/Security/Operations | 不同creator jobs；到期files | owner/other mgmt user、不存在ID、purged result | list/detail/result；執行365日purge及重跑 | 授權/ownership依設計；IDOR不洩漏；到期file刪除且410，summary/rows/audit保留7年；purge不越root | responses、filesystem、job/row/audit SQL | — | NOT RUN |
| IMP-016 | P1 | NFR-004；10k-row SLA與線上共存 | Performance | 10,000-row realistic CSV；正常online load | create/update/invalid分布及worker配置 | warm-up後計時precheck+execution，同時量list p95 | 合計≤10分鐘；資源/DB pool bounded；線上query仍達批准門檻；無count或資料錯誤 | p50/p95/p99、throughput/resources、DB/result | — | NOT RUN |
| IMP-017 | P0 | FR-IMPORT-009、AC-040、SEC-012；一般Export | API/File/Security | U-MGMT及無權限user；有filters及Bank資料 | Unicode/逗號/換行；以=,+,-,@或control開頭cells | 按filter export、非法呼叫並以試算表開啟 | 只匯出filter內可見一般資料；無Bank；RFC4180正確；公式不執行且DB原值不變；事件記actor/條件/time/result | response/file、spreadsheet proof、DB/audit | — | NOT RUN |

### 6.10 稽核與資料可追溯性

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | P0 | FR-AUDIT-001～002；完整action coverage | API/DB | 各角色可成功執行動作 | §8.9所有Supplier/child/status/approval/bank/settings/relation/import/export actions | 每種成功一次並查audit | 每個state-changing或sensitive read恰一筆；time/actor/action/target/Code/before/after/reason/requestId/IP正確 | requests、request logs、audit SQL | — | NOT RUN |
| AUD-002 | P0 | FR-AUDIT-003～004、SEC-011；敏感allowlist | Security/Data | 使用唯一敏感markers | account/password/token/ciphertext/IV/tag/index/key IDs及PII | 成功與失敗動作後掃audit/log/error | Bank audit只含changed fields及masked摘要；所有禁止值搜尋為0 | redacted scan輸出、audit samples | — | NOT RUN |
| AUD-003 | P0 | FR-AUDIT-005、NFR-006；同交易一致 | Failure/Transaction | 可令audit insert/serialize失敗 | 一般、status、approval、Bank、setting及import row writes | 逐類注入失敗 | 業務資料與對應audit同成同敗；reveal在audit失敗時不回明文 | errors、transaction log、DB前後 | — | NOT RUN |
| AUD-004 | P1 | Detail 8192-byte策略 | Unit/DB | 可產生大before/after集合 | 8191/8192/8193 bytes及仍超限摘要 | 執行更新 | 可容納者合法JSON；超限集合轉count/sample/truncated；仍超限則整交易失敗並告警，不切壞JSON | serialized sizes、audit row、alert | — | NOT RUN |
| AUD-005 | P1 | FR-AUDIT-007；Audit查詢分頁篩選 | API/DB | 多actor/action/target/time資料 | supplier/code、actor、action、targetType、from/to、page boundaries | 單一/組合filter並翻頁 | 只回符合項；occurredAt DESC,id DESC穩定；total及邊界正確；Bank detail仍masked | responses、對照SQL | — | NOT RUN |
| AUD-006 | P0 | FR-AUDIT-006；Audit不可修改刪除 | API/Security/DB | U-VIEW/U-MGMT/system-admin日常API | PUT/DELETE/猜測route、直接一般service | 嘗試修改/刪除audit | 無UPDATE/DELETE route或能力；全部拒絕；歷史不變 | route inventory、responses、SQL | — | NOT RUN |
| AUD-007 | P1 | delete後audit保留及actor snapshot | DB/Data | 可合法刪除Draft及刪除/停用actor | Supplier/actor IDs | 建audit後刪target/actor | audit無target FK而保留；actor_user_id按FK處理但username/label仍可追溯 | 前後SQL、schema FK | — | NOT RUN |
| AUD-008 | P1 | BR-030；時間與request關聯 | API/UI/Time | APP_TIME_ZONE已設；可控時鐘 | epoch ms、跨日/年及offset CSV | 執行事件、查API/UI/export | DB/API為epoch ms；UI按統一時區；CSV為ISO8601+offset；同requestId可串API log與audit | DB/API/UI/CSV/log timeline | — | NOT RUN |

### 6.11 認證、授權與輸入安全

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | SEC-001；匿名不可存取 | API/UI/Security | 無token | 全部Supplier pages及routes最小合法request | 逐一直接導航／呼叫 | 全部拒絕並無DB/audit副作用；不洩漏resource存在性 | route matrix、responses、DB/audit | — | NOT RUN |
| AUTH-002 | P0 | SEC-002～007、SEC-014、BR-022；六權限矩陣 | API/Security | U-VIEW/U-MGMT/U-APR/U-BANK-R/U-BANK-W/U-SET/U-SYS | 所有read/write/actions | 每角色逐route呼叫 | 僅規格組合成功；mgmt不含approval/Bank/settings；bank write需三權限；approval需view+approval；system-admin具六權限但Bank仍需同等重新認證、遮罩、audit及alert | matrix responses、authorization logs、reauth/audit evidence | — | NOT RUN |
| AUTH-003 | P0 | SEC-008；Purchasing/Finance最小資料 | Contract/Security | U-PO及模擬Finance角色 | lookup/history/payment所需read | 呼叫授權整合入口及Supplier admin endpoints | 只取得必要projection；不能CRUD、reveal或Settings；不因此獲主資料permission | responses、claims、route logs | — | NOT RUN |
| AUTH-004 | P0 | SEC-009；水平/垂直越權與IDOR | API/Security | 兩Supplier、兩owners/actors、各類child/Bank/approval/job IDs | 替換route IDs及枚舉不存在ID | read/write/reveal/decision/result | 未授權返回403/404政策一致且不洩漏存在性；任何target資料/audit不變 | responses、DB/audit、security log | — | NOT RUN |
| AUTH-005 | P0 | PERMISSION_STALE；撤權即時生效 | API/Security | JWT仍含權限但DB已撤銷／user停用 | 所有write及sensitive read代表route | 撤權後不刷新token直接呼叫 | fresh actor check拒絕並回穩定code；無業務/audit變更 | responses、permission DB、audit | — | NOT RUN |
| AUTH-006 | P0 | §3.2；authType不可降級 | Contract/Security | 可列舉handler metadata | jwt、jwt-password、jwt-device-password routes | 比對每route並以低一級credential呼叫 | metadata與設計完全一致；低強度credential拒絕；payload不能動態降級 | handler inventory、contract test、responses | — | NOT RUN |
| AUTH-007 | P0 | API schema與邊界 | API/Validation | 已登入對應角色 | missing/null/wrong type/enum/0/negative/overflow/malformed JSON/wrong content-type/additionalProperties | 對每API類別送代表組合 | 400/415等穩定錯誤；ID只接受正整數；boolean不解析任意truthy；無部分寫入 | request/response matrix、DB | — | NOT RUN |
| AUTH-008 | P0 | SEC-010～012；response projection與bulk access | API/Security | 所有權限組合；資料含敏感markers | list/detail/approval/audit/export/reveal/error | 掃描response及headers；執行bulk export/reveal | 只有reveal專用response短暫含明文且no-store；其他projection無內部keys；bulk事件有低敏audit | payload/header scans、audit | — | NOT RUN |
| AUTH-009 | P0 | BR-031；XSS/prototype pollution | API/UI/Security | U-MGMT | script/HTML/Unicode controls、__proto__/constructor/prototype nested fields | create/update/import後render | dangerous fields拒絕或當純文字；不執行script、不污染object；log/error安全 | responses、DOM/CSP、DB/log | — | NOT RUN |
| AUTH-010 | P1 | API錯誤契約與資訊洩漏 | API/Security | 可觸發設計§6.11各錯誤 | 400/403/404/409/410/422/503及ER_DUP_ENTRY | 逐類觸發 | HTTP/code穩定；MySQL constraint映射正確；不回SQL、constraint原文、secret或其他Supplier資料 | response corpus、server logs、DB | — | NOT RUN |

### 6.12 UI/UX與關鍵E2E

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-001 | P1 | docs/frontend-design.md；Menu與route guard | UI/Security | 各permission user | Supplier menu group及七頁 | 登入、檢視menu、直接導航 | group位於指定順序；只顯示有權頁；Create/detail route亦受guard；無權到403 | screenshots、route/claims | — | NOT RUN |
| UI-002 | P1 | FR-CREATE-008；Create/Detail關鍵旅程 | UI/E2E | U-MGMT；Approval OFF/ON | 最低三欄及optional sections | 儲存Draft、直接啟用、提交審批 | actions分開；optional可跳過；成功顯示Code、狀態、下一步；錯誤focus summary/首欄 | screenshots、network、DB/audit | — | NOT RUN |
| UI-003 | P1 | FR-EDIT-006、VERSION_CONFLICT UX | UI/Concurrency | 兩browser sessions | dirty form及stale version | 離頁/back/unload；A存後B存 | dirty先提示；409不自動覆蓋，重載最新並保留草稿供比較/複製 | video/screenshots、network、DB | — | NOT RUN |
| UI-004 | P1 | 狀態與危險操作可理解 | UI/Accessibility | U-MGMT/U-APR；各狀態 | suspend/block/archive/delete dialogs | keyboard完成及檢查文案 | status有文字+icon；reason/password/device要求正確；文案列Code、終態、歷史及不可逆部分 | screenshots、keyboard recording、network | — | NOT RUN |
| UI-005 | P0 | Bank及Approval敏感UX | UI/Security | U-BANK-R/U-BANK-W/U-APR | reveal timer、diff/stale、reject/reassign | 完成主要流程及session expiry | Bank遵守BANK-014；Approval顯示snapshot/current diff，stale不可approve；reason/password驗證 | screenshots、DOM/storage/network | — | NOT RUN |
| UI-006 | P1 | Import partial-success UX | UI/E2E | U-MGMT；CSV-MIXED | invalid rows、approval ON/OFF、expired result | 四步流程、filter failed、download/refresh | 明示合法列寫入錯誤列不寫；approver條件顯示；refresh不重送confirm；410可理解 | screenshots、network、result | — | NOT RUN |
| UI-007 | P1 | 共通可用性與設計一致 | UI/Accessibility/Visual | 支援瀏覽器待確認 | keyboard、focus、labels、responsive widths、locale/time、loading/empty/error | 逐頁keyboard與viewport檢查 | 依frontend-design元件/token；無inline品牌hex；可鍵盤操作、focus可見、errors可讀、狀態不只靠顏色 | screenshots、DOM/accessibility scan、CSS diff | — | NOT RUN |

### 6.13 效能、可觀測性、部署與復原

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | P1 | NFR-001～003；100k/50-user一般查詢 | Performance | production-like MySQL；PERF dataset | exact Code、name、status/currency filter、detail混合負載 | warm-up、ramp-up後維持50 users並量測 | list及exact Code p95<2秒；記p50/p95/p99/error rate；CPU/memory/pool無不可恢復飽和 | workload/config、metrics、EXPLAIN/resources | — | NOT RUN |
| OPS-002 | P1 | Duplicate/query bounded與容量 | Performance/DB | PERF dataset | duplicate candidate、children/detail、contains search | 基線/負載/短spike | duplicate只取≤50候選再算分數；常用query使用index；count不因join膨脹 | timings、EXPLAIN、query counters | — | NOT RUN |
| OPS-003 | P1 | NFR-010；非必要服務失敗隔離 | Resilience/Integration | 可停Bank/nonessential summary服務 | lookup/list/detail/purchase submit | 令依賴timeout/connection reset/503後恢復 | 不洩漏Bank、不錯誤開放非Active；必要一般lookup按設計降級或明確失敗；恢復後正常 | responses、timeouts、logs/metrics、DB | — | NOT RUN |
| OPS-004 | P0 | Startup/schema/config readiness | Deployment | 缺table/column/permission/setting/key的各DB | 每種缺項 | 啟動新版 | 明確fail closed且health不ready；不自動篡改DB；修復後可啟動 | exit/health/log、DB前後 | — | NOT RUN |
| OPS-005 | P1 | Observability可行 | Operations | 可觸發成功、4xx、5xx、slow及critical Bank errors | route/status、approval age、import lease/purge | 執行代表事件並查metrics/log/alerts | route latency/error、conflict、approval、Bank、import、lookup指標存在；integrity/key error即時critical alert；全程低敏 | metric samples、alert delivery、redacted logs | — | NOT RUN |
| OPS-006 | P0 | NFR-009、NFR-011；全模組backup/restore | Recovery/DB | 有Core/approval/setting/Bank/import/audit資料；可量測的隔離restore環境 | DB、files、key rings、最近15分鐘transaction marker | 備份，隔離restore並執行smoke及對賬 | 主資料/關係/audit/job/files及keys一致恢復；RTO≤4小時、RPO≤15分鐘；Bank可受權reveal；缺key時不宣稱成功 | timestamps、backup manifest、restore SQL/log、reconciliation及smoke evidence | — | NOT RUN |
| OPS-007 | P1 | Worker rollback/restart | Deployment/Resilience | queued/running/completed jobs | stop claim、lease expiry、server restart、client rollback | 依runbook回滾及重啟 | 不claim新job；running安全結束或lease接管；已applied不回滾/重做；client rollback不刪資料 | timeline、worker logs、job/row/Supplier SQL | — | NOT RUN |
| OPS-008 | P1 | Capability部署及role smoke | Deployment/Security | migrations/server/client/roles可逐步部署 | Core、Approval、Bank、SKU、Import capabilities | 按§14順序部署並逐項smoke | 未完成能力不註冊route/menu；完成能力schema/server/client/permission一起可用；日常角色分離，break-glass有audit | deployment log、route/menu inventory、role SQL、smoke | — | NOT RUN |
| OPS-009 | P1 | Release regression與證據gate | Release | 候選build；所有依賴與資料ready | npm verify、真MySQL suites、client build及critical manual cases | 執行全回歸並彙總結果/defects/blocked | 只有實際證據可更新status；P0/P1未執行、失敗或blocked需明示；無足夠證據不得GO | CI/test outputs、case results、defects、release recommendation | — | NOT RUN |

## 7. 逐項需求追蹤

下表只表示「已設計案例」，不表示已取得coverage evidence；全部Latest Result均為NOT RUN。

| Requirement IDs | Priority | Test Case IDs | Latest Result | Defect IDs |
| --- | --- | --- | --- | --- |
| FR-LIST-001、FR-LIST-002、FR-LIST-003、FR-LIST-004、FR-LIST-005 | P1 | LIST-001～LIST-005 | NOT RUN | — |
| FR-LIST-006、FR-LIST-007、FR-LIST-008、FR-LIST-009、FR-LIST-010 | P1 | LIST-006～LIST-009、SKU-001～SKU-002 | NOT RUN | — |
| FR-VIEW-001、FR-VIEW-002、FR-VIEW-003、FR-VIEW-004、FR-VIEW-005 | P1 | LIST-006～LIST-009、PARTY-009、BANK-001、AUD-005 | NOT RUN | — |
| FR-CREATE-001、FR-CREATE-002、FR-CREATE-003、FR-CREATE-004 | P0 | CORE-001、CORE-004～CORE-005、CORE-008 | NOT RUN | — |
| FR-CREATE-005、FR-CREATE-006、FR-CREATE-007、FR-CREATE-008 | P0 | CORE-002～CORE-003、CORE-006、UI-002 | NOT RUN | — |
| FR-EDIT-001、FR-EDIT-002、FR-EDIT-003、FR-EDIT-004 | P0 | CORE-007、CORE-009～CORE-011、PARTY-001～PARTY-006 | NOT RUN | — |
| FR-EDIT-005、FR-EDIT-006、FR-EDIT-007 | P1 | CORE-009～CORE-010、CORE-013 | NOT RUN | — |
| FR-STATUS-001、FR-STATUS-002、FR-STATUS-003、FR-STATUS-004 | P0 | STATE-001～STATE-004、STATE-007～STATE-009 | NOT RUN | — |
| FR-STATUS-005、FR-STATUS-006、FR-STATUS-007、FR-STATUS-008 | P0 | STATE-005～STATE-006、STATE-010 | NOT RUN | — |
| FR-PARTY-001、FR-PARTY-002、FR-PARTY-003 | P1 | PARTY-001～PARTY-003 | NOT RUN | — |
| FR-PARTY-004、FR-PARTY-005、FR-PARTY-006 | P0/P1 | PARTY-004～PARTY-009 | NOT RUN | — |
| FR-BANK-001、FR-BANK-002、FR-BANK-003、FR-BANK-004 | P0 | BANK-001～BANK-005、BANK-008、CORE-006 | NOT RUN | — |
| FR-BANK-005、FR-BANK-006、FR-BANK-007 | P0 | BANK-011～BANK-016、AUD-001～AUD-003 | NOT RUN | — |
| FR-APPROVAL-001、FR-APPROVAL-002、FR-APPROVAL-003、FR-APPROVAL-004 | P0 | APR-004～APR-007、APR-013 | NOT RUN | — |
| FR-APPROVAL-005、FR-APPROVAL-006、FR-APPROVAL-007 | P0 | APR-008～APR-013 | NOT RUN | — |
| FR-SET-001、FR-SET-002、FR-SET-003 | P0/P1 | APR-001～APR-003、UI-001 | NOT RUN | — |
| FR-SET-004、FR-SET-005、FR-SET-006 | P1 | APR-003、APR-010 | NOT RUN | — |
| FR-SKU-001、FR-SKU-002、FR-SKU-003 | P0/P1 | SKU-001～SKU-005 | NOT RUN | — |
| FR-SKU-004、FR-SKU-005、FR-SKU-006 | P0/P1 | SKU-003、SKU-006～SKU-007 | NOT RUN | — |
| FR-IMPORT-001、FR-IMPORT-002、FR-IMPORT-003、FR-IMPORT-004、FR-IMPORT-005 | P0/P1 | IMP-001～IMP-007、IMP-015 | NOT RUN | — |
| FR-IMPORT-006、FR-IMPORT-007、FR-IMPORT-008、FR-IMPORT-009、FR-IMPORT-010 | P0/P1 | IMP-008～IMP-017 | NOT RUN | — |
| FR-AUDIT-001、FR-AUDIT-002、FR-AUDIT-003、FR-AUDIT-004 | P0 | AUD-001～AUD-004、BANK-012～BANK-013 | NOT RUN | — |
| FR-AUDIT-005、FR-AUDIT-006、FR-AUDIT-007 | P0/P1 | CORE-012、AUD-003～AUD-008 | NOT RUN | — |
| BR-001、BR-002、BR-003、BR-004、BR-005、BR-006、BR-007、BR-008 | P0 | MIG-003、MIG-007、CORE-004、CORE-006～CORE-007、CORE-010 | NOT RUN | — |
| BR-009、BR-010、BR-011、BR-012、BR-013、BR-014、BR-015、BR-016 | P0 | CORE-005、PARTY-005、APR-001、APR-004、APR-009、STATE-001、STATE-003、STATE-010 | NOT RUN | — |
| BR-017、BR-018、BR-019、BR-020、BR-021、BR-022、BR-023、BR-024 | P0 | STATE-005～STATE-006、BANK-001～BANK-003、BANK-008、CORE-006、SKU-001～SKU-003 | NOT RUN | — |
| BR-025、BR-026、BR-027、BR-028、BR-029、BR-030、BR-031、BR-032 | P0 | CORE-011～CORE-013、IMP-006～IMP-007、IMP-011、IMP-014、AUD-008、AUTH-009、STATE-007 | NOT RUN | — |
| SEC-001、SEC-002、SEC-003、SEC-004 | P0 | AUTH-001～AUTH-002、APR-004、APR-013 | NOT RUN | — |
| SEC-005、SEC-006、SEC-007、SEC-008 | P0 | BANK-002～BANK-004、APR-002～APR-003、AUTH-003 | NOT RUN | — |
| SEC-009、SEC-010、SEC-011、SEC-012、SEC-013 | P0 | AUTH-004～AUTH-010、BANK-004～BANK-016、IMP-014、IMP-017 | NOT RUN | — |
| NFR-001、NFR-002、NFR-003、NFR-004、NFR-005 | P1 | LIST-001、OPS-001～OPS-002、IMP-016、SKU-008 | NOT RUN | — |
| NFR-006、NFR-007、NFR-008、NFR-009、NFR-010 | P0/P1 | CORE-011～CORE-012、STATE-008～STATE-009、APR-012～APR-013、IMP-008～IMP-010、MIG-001～MIG-006、OPS-003～OPS-007 | NOT RUN | — |
| AC-001、AC-002、AC-003、AC-004、AC-005、AC-006 | P0/P1 | CORE-001、CORE-004～CORE-005、PARTY-005、CORE-010 | NOT RUN | — |
| AC-007、AC-008、AC-009、AC-010、AC-011、AC-012、AC-013 | P0 | CORE-002～CORE-003、APR-004、APR-006～APR-010 | NOT RUN | — |
| AC-014、AC-015、AC-016、AC-017、AC-018、AC-019 | P0 | STATE-001、STATE-003、STATE-005～STATE-006 | NOT RUN | — |
| AC-020、AC-021、AC-022、AC-023、AC-024、AC-025、AC-026、AC-027 | P0/P1 | CORE-006、PARTY-003、APR-013、BANK-001～BANK-003、BANK-008、BANK-011 | NOT RUN | — |
| AC-028、AC-029、AC-030、AC-031、AC-032 | P0/P1 | SKU-001～SKU-003、SKU-006、CORE-013 | NOT RUN | — |
| AC-033、AC-034、AC-035、AC-036、AC-037、AC-038、AC-039、AC-040 | P0 | IMP-006、IMP-008、IMP-014、IMP-017、APR-002～APR-003、CORE-011、AUTH-002 | NOT RUN | — |

## 8. 執行前置與分層建議

### 8.1 Entry criteria

- 候選build／commit、部署時間、APP_TIME_ZONE、MySQL版本與測試環境owner已記錄。
- 對應capability的Migration、route、client及permissions已完整部署；未完成capability不以stub或缺表fallback測成PASS。
- 六類測試user、approved device、fake Bank key rings、Item／Purchasing test double或真整合環境及受控import root已準備。
- 所有P0/P1自動或手動執行均以本文件既有案例為gate；故障注入與復原已有環境owner批准。

### 8.2 建議自動化層

| Layer | 優先內容 | 方法／現有工具 |
| --- | --- | --- |
| Pure unit | normalization、validation、state、duplicate score、crypto、projection、CSV schema | Node node:test；安全核心要求100% branches |
| Service/handler | transaction call order、error mapping、auth metadata、request schema、projection | 現有fakeMySqlPool及handler convention tests |
| Integration | Migration、unique/FK、locking、HTTP+DB、approval/Bank/import/SKU | 現有Node tests＋隔離真MySQL |
| Client component | permission rendering、conflict、Bank timer、approval、import | 現有Vue/Quasar test stack |
| Limited E2E/manual | Create、approval、Bank reveal、status、for-SKU、import/export、keyboard | 支援瀏覽器及network/DB evidence |
| Performance/operations | 100k/50-user、10k CSV、rotation、backup/restore、alerts | production-like環境及可重現scripts/runbook |

## 9. 執行前待確認事項

1. 支援的瀏覽器與viewport矩陣未在需求中明確列出；UI-007執行前由Product Owner／QA確認。
2. 無障礙要求定義了鍵盤、文字＋icon及可讀錯誤，但未指定完整WCAG版本與等級；本文件不自行擴大成正式合規認證。
3. NFR效能門檻未指定硬體、測試持續時間、ramp-up、允許error rate與資源飽和線；OPS-001、SKU-008、IMP-016執行前須凍結基準。
4. Item、Purchasing、Receiving、Returns、AP及Payment尚未全部存在時，相關整合案例應標BLOCKED而不是以假資料判PASS。
5. Currency及Payment Term初始資料由Business Master owner確認；Supplier測試只驗證readiness、Active／inactive引用及transaction內重驗，不驗證catalog寫入。
6. Archive的open-flow來源、Supplier/child的「已引用」完整清單須在下游schema落地後更新fixture與reference guard案例。
7. Bank reveal的實際browser autocomplete政策及security header基線須與docs/frontend-design.md及現有middleware在執行前對齊。

## 10. 已知未測範圍與殘留風險

- 本次只建立案例，136個案例全部NOT RUN；目前沒有任何PASS、缺陷或release-ready證據。
- Bank功能即使通過功能性安全案例，也不能取代專門的密碼學review、secret-store權限review或滲透測試。
- 下游交易模組未完成前，Supplier狀態即時重驗、交易snapshot及Supplier–SKU回寫只能取得contract或受控整合證據。
- MySQL DDL會implicit commit；半套用復原只能以逐支真實故障演練證明，不能由migration code review推定。
- Release recommendation在實際執行、缺陷評估、blocked範圍與殘留風險獲owner接受前一律為INSUFFICIENT EVIDENCE。


---

# Appendix A — Harness 2.0 Formal Technical Test Definitions

下列formal definitions與§6中的136個詳細row一對一；row仍是步驟、資料及期望的完整來源。

## TC-001 — MIG-001

### Preconditions and data

使用§6詳細案例`MIG-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`MIG-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`MIG-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-002 — MIG-002

### Preconditions and data

使用§6詳細案例`MIG-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`MIG-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`MIG-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-003 — MIG-003

### Preconditions and data

使用§6詳細案例`MIG-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`MIG-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`MIG-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-004 — MIG-004

### Preconditions and data

使用§6詳細案例`MIG-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`MIG-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`MIG-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-005 — MIG-005

### Preconditions and data

使用§6詳細案例`MIG-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`MIG-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`MIG-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-006 — MIG-006

### Preconditions and data

使用§6詳細案例`MIG-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`MIG-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`MIG-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-007 — MIG-007

### Preconditions and data

使用§6詳細案例`MIG-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`MIG-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`MIG-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-008 — LIST-001

### Preconditions and data

使用§6詳細案例`LIST-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-009 — LIST-002

### Preconditions and data

使用§6詳細案例`LIST-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-010 — LIST-003

### Preconditions and data

使用§6詳細案例`LIST-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-011 — LIST-004

### Preconditions and data

使用§6詳細案例`LIST-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-012 — LIST-005

### Preconditions and data

使用§6詳細案例`LIST-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-013 — LIST-006

### Preconditions and data

使用§6詳細案例`LIST-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-014 — LIST-007

### Preconditions and data

使用§6詳細案例`LIST-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-015 — LIST-008

### Preconditions and data

使用§6詳細案例`LIST-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-016 — LIST-009

### Preconditions and data

使用§6詳細案例`LIST-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`LIST-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`LIST-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-017 — CORE-001

### Preconditions and data

使用§6詳細案例`CORE-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-018 — CORE-002

### Preconditions and data

使用§6詳細案例`CORE-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-019 — CORE-003

### Preconditions and data

使用§6詳細案例`CORE-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-020 — CORE-004

### Preconditions and data

使用§6詳細案例`CORE-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-021 — CORE-005

### Preconditions and data

使用§6詳細案例`CORE-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-022 — CORE-006

### Preconditions and data

使用§6詳細案例`CORE-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-023 — CORE-007

### Preconditions and data

使用§6詳細案例`CORE-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-024 — CORE-008

### Preconditions and data

使用§6詳細案例`CORE-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-025 — CORE-009

### Preconditions and data

使用§6詳細案例`CORE-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-026 — CORE-010

### Preconditions and data

使用§6詳細案例`CORE-010`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-010`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-010`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-027 — CORE-011

### Preconditions and data

使用§6詳細案例`CORE-011`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-011`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-011`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-028 — CORE-012

### Preconditions and data

使用§6詳細案例`CORE-012`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-012`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-012`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-029 — CORE-013

### Preconditions and data

使用§6詳細案例`CORE-013`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`CORE-013`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`CORE-013`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-030 — STATE-001

### Preconditions and data

使用§6詳細案例`STATE-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-031 — STATE-002

### Preconditions and data

使用§6詳細案例`STATE-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-032 — STATE-003

### Preconditions and data

使用§6詳細案例`STATE-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-033 — STATE-004

### Preconditions and data

使用§6詳細案例`STATE-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-034 — STATE-005

### Preconditions and data

使用§6詳細案例`STATE-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-035 — STATE-006

### Preconditions and data

使用§6詳細案例`STATE-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-036 — STATE-007

### Preconditions and data

使用§6詳細案例`STATE-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-037 — STATE-008

### Preconditions and data

使用§6詳細案例`STATE-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-038 — STATE-009

### Preconditions and data

使用§6詳細案例`STATE-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-039 — STATE-010

### Preconditions and data

使用§6詳細案例`STATE-010`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`STATE-010`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`STATE-010`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-040 — PARTY-001

### Preconditions and data

使用§6詳細案例`PARTY-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-041 — PARTY-002

### Preconditions and data

使用§6詳細案例`PARTY-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-042 — PARTY-003

### Preconditions and data

使用§6詳細案例`PARTY-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-043 — PARTY-004

### Preconditions and data

使用§6詳細案例`PARTY-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-044 — PARTY-005

### Preconditions and data

使用§6詳細案例`PARTY-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-045 — PARTY-006

### Preconditions and data

使用§6詳細案例`PARTY-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-046 — PARTY-007

### Preconditions and data

使用§6詳細案例`PARTY-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-047 — PARTY-008

### Preconditions and data

使用§6詳細案例`PARTY-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-048 — PARTY-009

### Preconditions and data

使用§6詳細案例`PARTY-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`PARTY-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`PARTY-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-049 — APR-001

### Preconditions and data

使用§6詳細案例`APR-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-050 — APR-002

### Preconditions and data

使用§6詳細案例`APR-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-051 — APR-003

### Preconditions and data

使用§6詳細案例`APR-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-052 — APR-004

### Preconditions and data

使用§6詳細案例`APR-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-053 — APR-005

### Preconditions and data

使用§6詳細案例`APR-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-054 — APR-006

### Preconditions and data

使用§6詳細案例`APR-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-055 — APR-007

### Preconditions and data

使用§6詳細案例`APR-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-056 — APR-008

### Preconditions and data

使用§6詳細案例`APR-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-057 — APR-009

### Preconditions and data

使用§6詳細案例`APR-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-058 — APR-010

### Preconditions and data

使用§6詳細案例`APR-010`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-010`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-010`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-059 — APR-011

### Preconditions and data

使用§6詳細案例`APR-011`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-011`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-011`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-060 — APR-012

### Preconditions and data

使用§6詳細案例`APR-012`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-012`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-012`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-061 — APR-013

### Preconditions and data

使用§6詳細案例`APR-013`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`APR-013`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`APR-013`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-062 — BANK-001

### Preconditions and data

使用§6詳細案例`BANK-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-063 — BANK-002

### Preconditions and data

使用§6詳細案例`BANK-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-064 — BANK-003

### Preconditions and data

使用§6詳細案例`BANK-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-065 — BANK-004

### Preconditions and data

使用§6詳細案例`BANK-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-066 — BANK-005

### Preconditions and data

使用§6詳細案例`BANK-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-067 — BANK-006

### Preconditions and data

使用§6詳細案例`BANK-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-068 — BANK-007

### Preconditions and data

使用§6詳細案例`BANK-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-069 — BANK-008

### Preconditions and data

使用§6詳細案例`BANK-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-070 — BANK-009

### Preconditions and data

使用§6詳細案例`BANK-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-071 — BANK-010

### Preconditions and data

使用§6詳細案例`BANK-010`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-010`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-010`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-072 — BANK-011

### Preconditions and data

使用§6詳細案例`BANK-011`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-011`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-011`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-073 — BANK-012

### Preconditions and data

使用§6詳細案例`BANK-012`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-012`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-012`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-074 — BANK-013

### Preconditions and data

使用§6詳細案例`BANK-013`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-013`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-013`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-075 — BANK-014

### Preconditions and data

使用§6詳細案例`BANK-014`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-014`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-014`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-076 — BANK-015

### Preconditions and data

使用§6詳細案例`BANK-015`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-015`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-015`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-077 — BANK-016

### Preconditions and data

使用§6詳細案例`BANK-016`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`BANK-016`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`BANK-016`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-078 — SKU-001

### Preconditions and data

使用§6詳細案例`SKU-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-079 — SKU-002

### Preconditions and data

使用§6詳細案例`SKU-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-080 — SKU-003

### Preconditions and data

使用§6詳細案例`SKU-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-081 — SKU-004

### Preconditions and data

使用§6詳細案例`SKU-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-082 — SKU-005

### Preconditions and data

使用§6詳細案例`SKU-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-083 — SKU-006

### Preconditions and data

使用§6詳細案例`SKU-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-084 — SKU-007

### Preconditions and data

使用§6詳細案例`SKU-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-085 — SKU-008

### Preconditions and data

使用§6詳細案例`SKU-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`SKU-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`SKU-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-086 — IMP-001

### Preconditions and data

使用§6詳細案例`IMP-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-087 — IMP-002

### Preconditions and data

使用§6詳細案例`IMP-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-088 — IMP-003

### Preconditions and data

使用§6詳細案例`IMP-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-089 — IMP-004

### Preconditions and data

使用§6詳細案例`IMP-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-090 — IMP-005

### Preconditions and data

使用§6詳細案例`IMP-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-091 — IMP-006

### Preconditions and data

使用§6詳細案例`IMP-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-092 — IMP-007

### Preconditions and data

使用§6詳細案例`IMP-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-093 — IMP-008

### Preconditions and data

使用§6詳細案例`IMP-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-094 — IMP-009

### Preconditions and data

使用§6詳細案例`IMP-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-095 — IMP-010

### Preconditions and data

使用§6詳細案例`IMP-010`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-010`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-010`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-096 — IMP-011

### Preconditions and data

使用§6詳細案例`IMP-011`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-011`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-011`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-097 — IMP-012

### Preconditions and data

使用§6詳細案例`IMP-012`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-012`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-012`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-098 — IMP-013

### Preconditions and data

使用§6詳細案例`IMP-013`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-013`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-013`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-099 — IMP-014

### Preconditions and data

使用§6詳細案例`IMP-014`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-014`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-014`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-100 — IMP-015

### Preconditions and data

使用§6詳細案例`IMP-015`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-015`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-015`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-101 — IMP-016

### Preconditions and data

使用§6詳細案例`IMP-016`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-016`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-016`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-102 — IMP-017

### Preconditions and data

使用§6詳細案例`IMP-017`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`IMP-017`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`IMP-017`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-103 — AUD-001

### Preconditions and data

使用§6詳細案例`AUD-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-104 — AUD-002

### Preconditions and data

使用§6詳細案例`AUD-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-105 — AUD-003

### Preconditions and data

使用§6詳細案例`AUD-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-106 — AUD-004

### Preconditions and data

使用§6詳細案例`AUD-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-107 — AUD-005

### Preconditions and data

使用§6詳細案例`AUD-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-108 — AUD-006

### Preconditions and data

使用§6詳細案例`AUD-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-109 — AUD-007

### Preconditions and data

使用§6詳細案例`AUD-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-110 — AUD-008

### Preconditions and data

使用§6詳細案例`AUD-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUD-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUD-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-111 — AUTH-001

### Preconditions and data

使用§6詳細案例`AUTH-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-112 — AUTH-002

### Preconditions and data

使用§6詳細案例`AUTH-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-113 — AUTH-003

### Preconditions and data

使用§6詳細案例`AUTH-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-114 — AUTH-004

### Preconditions and data

使用§6詳細案例`AUTH-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-115 — AUTH-005

### Preconditions and data

使用§6詳細案例`AUTH-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-116 — AUTH-006

### Preconditions and data

使用§6詳細案例`AUTH-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-117 — AUTH-007

### Preconditions and data

使用§6詳細案例`AUTH-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-118 — AUTH-008

### Preconditions and data

使用§6詳細案例`AUTH-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-119 — AUTH-009

### Preconditions and data

使用§6詳細案例`AUTH-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-120 — AUTH-010

### Preconditions and data

使用§6詳細案例`AUTH-010`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`AUTH-010`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`AUTH-010`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-121 — UI-001

### Preconditions and data

使用§6詳細案例`UI-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`UI-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`UI-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-122 — UI-002

### Preconditions and data

使用§6詳細案例`UI-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`UI-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`UI-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-123 — UI-003

### Preconditions and data

使用§6詳細案例`UI-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`UI-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`UI-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-124 — UI-004

### Preconditions and data

使用§6詳細案例`UI-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`UI-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`UI-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-125 — UI-005

### Preconditions and data

使用§6詳細案例`UI-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`UI-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`UI-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-126 — UI-006

### Preconditions and data

使用§6詳細案例`UI-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`UI-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`UI-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-127 — UI-007

### Preconditions and data

使用§6詳細案例`UI-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`UI-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`UI-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-128 — OPS-001

### Preconditions and data

使用§6詳細案例`OPS-001`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-001`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-001`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-129 — OPS-002

### Preconditions and data

使用§6詳細案例`OPS-002`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-002`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-002`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-130 — OPS-003

### Preconditions and data

使用§6詳細案例`OPS-003`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-003`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-003`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-131 — OPS-004

### Preconditions and data

使用§6詳細案例`OPS-004`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-004`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-004`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-132 — OPS-005

### Preconditions and data

使用§6詳細案例`OPS-005`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-005`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-005`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-133 — OPS-006

### Preconditions and data

使用§6詳細案例`OPS-006`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-006`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-006`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-134 — OPS-007

### Preconditions and data

使用§6詳細案例`OPS-007`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-007`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-007`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-135 — OPS-008

### Preconditions and data

使用§6詳細案例`OPS-008`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-008`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-008`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

## TC-136 — OPS-009

### Preconditions and data

使用§6詳細案例`OPS-009`的Preconditions及Test Data；只在其要求的隔離環境、角色與依賴READY後執行。

### Steps

完整執行`OPS-009`列的Steps/Input，不省略負面、重送、並發或恢復步驟。

### Expected result

以`OPS-009`列的Expected Result為唯一判定標準；不得以部分成功或無錯誤訊息代替。

### Acceptance criteria

Required Evidence完整、低敏且綁定同一candidate／environment；mandatory assertion全部PASS、沒有未解釋skip。

### Cleanup

依案例清理虛構資料、session、檔案、worker／runtime資源；保留redacted evidence，不刪除失敗或audit證據。

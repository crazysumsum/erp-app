# Invoicing & Accounts Receivable UAT Specification

## 1. UAT Contract

- Actors: AR Viewer、Invoice Operator、Price Override Operator、Credit Manager、Receipt Manager、AR Settings Manager、Opening Import Operator、Export Operator及Sales User。
- Evidence只使用頁面、提示、前後金額、正式文件、Customer Account／Statement、Audit、Job結果及Correlation ID；DB/locks/fault injection由Technical Test report證明。
- Entry: 對應Phase technical tests全Pass、環境及角色固定、Opening/Active/Archive測試資料可重置。
- Exit: 所有P0 Pass、無open S1/S2、所有P1已執行或有Product Owner書面例外；每Currency可由來源對賬至Closing。
- 全部案例初始`Result=NOT_RUN`及`Evidence=—`；本文件不表示已測試。

欄位：`ID｜Scenario｜Priority / Phase｜Requirements｜Business objective / Actor｜Preconditions & Data｜User Steps｜Expected / Acceptance｜Result｜Evidence`。

## 2. Settings、Workbench and Invoicing

| ID | Scenario | Priority / Phase | Requirements | Objective / Actor | Preconditions & Data | User Steps | Expected / Acceptance | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-001 | 設定最小權限 | P0/P1 | FR-001～010 | Settings Manager | 有權/無權users | 進設定及直呼保存 | 有權可用；無權拒絕且無變更 | NOT_RUN | — |
| UAT-002 | 公司資料正式快照 | P1/P1-2 | FR-002,120～123 | Invoice Operator | 公司資料A | 發Invoice後改B再下載 | 舊Invoice仍顯示A | NOT_RUN | — |
| UAT-003 | 多Currency銀行默認 | P1/P1 | FR-003,004 | Settings Manager | HKD/USD accounts | 設default、看列表 | 每Currency一個default；一般只masked | NOT_RUN | — |
| UAT-004 | 文件流水號 | P0/P1-3 | FR-005,006 | Finance Owner | 年界/prefix change | 發Invoice/Credit/Receipt | 各類/年度唯一且舊號不改不重用 | NOT_RUN | — |
| UAT-005 | Close Date前進 | P0/P1 | FR-007,008 | Settings Manager | 處理中job及open/closed dates | 推進close date | 有open matter阻止並列原因；不能倒退 | NOT_RUN | — |
| UAT-006 | Aging固定分桶 | P1/P4 | FR-009 | AR Viewer | due boundaries | 看Aging | Current/1-30/31-60/61-90/90+固定正確 | NOT_RUN | — |
| UAT-007 | 設定歷史與銀行遮蔽 | P1/P1 | FR-010 | Settings Manager | 已改設定 | 看history | actor/time/value可查，無完整帳號 | NOT_RUN | — |
| UAT-008 | Workbench eligibility | P0/P2 | FR-011,012 | Invoice Operator | PICKED/SHIPPED/REVERSED/claimed | 開Workbench | 只有合資格SHIPPED可選，其他有原因 | NOT_RUN | — |
| UAT-009 | Workbench filters | P1/P2 | FR-013,014 | Invoice Operator | 多SO/customer/channel | filter/search | rows及顯示欄正確，URL可重開 | NOT_RUN | — |
| UAT-010 | 一Shipment快速Draft | P0/P2 | FR-015,022～024 | Invoice Operator | 多Line Shipment | 選取建立 | 全部尚未開票Line/qty納入及可trace | NOT_RUN | — |
| UAT-011 | 相容跨SO/Warehouse合併 | P1/P2 | FR-016,017,022 | Invoice Operator | 同客/幣/term/date | preview+create | 一Invoice group且保留全部來源 | NOT_RUN | — |
| UAT-012 | 不相容Shipment分組 | P1/P2 | FR-016,017 | Invoice Operator | mixed customer/currency/term | preview | 分組/拒絕及原因清楚，不暗改值 | NOT_RUN | — |
| UAT-013 | 雙人同Shipment | P0/P2 | FR-018～020 | Two Invoice Operators | 同Shipment | 同時建立 | 只有一人成功；另一無partial draft | NOT_RUN | — |
| UAT-014 | 我的Draft/衝突提示 | P2/P2 | FR-021 | Invoice Operator | 自己及他人claims | 查看views | 最近工作及安全提示可理解，不洩資料 | NOT_RUN | — |
| UAT-015 | Billing/Contact optional | P1/P2 | FR-025,026 | Invoice Operator | 無billing/term | 建立並confirm | 無虛構地址；無term必須明輸due date | NOT_RUN | — |
| UAT-016 | Due/Invoice Date rules | P0/P2 | FR-027～029 | Invoice Operator | before shipment/future/closed dates | confirm | 非法日期拒絕，合法override有原因 | NOT_RUN | — |
| UAT-017 | Draft允許/禁止修改 | P0/P2 | FR-030,031,035 | Invoice Operator | shared Draft | 改notes/date；改customer/source；兩人保存 | 只allowlist成功；stale衝突不覆蓋 | NOT_RUN | — |
| UAT-018 | Price override權限 | P0/P2 | FR-032,033 | Operators with/without override | SO price100 | 改80/零價 | 無權拒絕；有權需reason/差額；零價warning | NOT_RUN | — |
| UAT-019 | PDF line合併但可追溯 | P1/P2 | FR-034,120～123 | Invoice Operator | 同SKU/UOM/price多sources | 下載PDF/看detail | PDF可合併；不同價分行；detail逐source | NOT_RUN | — |
| UAT-020 | Cancel Draft | P0/P2 | FR-035 | Invoice Operator | Shipment Draft | cancel再搜尋 | 無AR/正式號；Shipment可再開票；history保留 | NOT_RUN | — |
| UAT-021 | Pack分批不多收 | P0/P2 | FR-037,038 | Finance Owner | 1箱=24、兩次12 | 分別開票 | 每張12件等值；累計等SO line amount | NOT_RUN | — |
| UAT-022 | Manual Invoice happy path | P1/P2 | FR-039～044 | Invoice Operator | Active Customer | 原因+自由line+optional SKU | 清楚MANUAL、可confirm、無物流/庫存結果 | NOT_RUN | — |
| UAT-023 | Manual Customer restriction | P1/P2 | FR-045 | Invoice Operator | suspended/hold/archived | 建Manual；處理既有invoice | 新Manual拒絕；既有債權仍可處理 | NOT_RUN | — |
| UAT-024 | Batch preview/source freeze | P1/P2 | FR-046～048 | Invoice Operator | 10k candidate | preview/create job；後加shipment | 摘要完整；新資料不暗中加入 | NOT_RUN | — |
| UAT-025 | Batch bad group isolation | P0/P2 | FR-049～051 | Invoice Operator | 多groups一錯 | run/view result | 合法成功、錯組定位/可重試、counts守恆 | NOT_RUN | — |
| UAT-026 | Confirm fresh validation | P0/P2 | FR-052 | Invoice Operator | Draft後改source/address/permission | confirm | 被拒及清楚原因，無正式部分結果 | NOT_RUN | — |
| UAT-027 | Formal Invoice atomic | P0/P2 | FR-053,055 | Invoice Operator | valid Draft | confirm | ISSUED/number/AR/source/history/audit同時可見 | NOT_RUN | — |
| UAT-028 | Confirm重送/逾時恢復 | P0/P2 | FR-054 | Invoice Operator | 逾時/雙擊 | submit/reopen outcome | 只一Invoice/號碼，processing後收斂 | NOT_RUN | — |
| UAT-029 | 正式Invoice不可改 | P0/P2 | FR-056 | Invoice Operator | ISSUED | 嘗試改header/line/source | UI無入口且direct request拒絕；snapshot不變 | NOT_RUN | — |
| UAT-030 | Invoice Void | P0/P2 | FR-057,058 | Invoice Operator | eligible及linked invoices | void with reason | eligible撤AR/釋來源保留號；linked拒絕 | NOT_RUN | — |

## 3. Credit、Receipt and Settlement

| ID | Scenario | Priority / Phase | Requirements | Objective / Actor | Preconditions & Data | User Steps | Expected / Acceptance | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-031 | Credit原Line部分貸項 | P0/P3 | FR-059～061 | Credit Manager | 多line issued invoice | 選一line/原因/confirm | 只降該line/outstanding，來源及reason可查 | NOT_RUN | — |
| UAT-032 | Credit超額拒絕 | P0/P3 | FR-062 | Credit Manager | creditable100 | 輸入101/並發 | 整張拒絕，無負數/partial credit | NOT_RUN | — |
| UAT-033 | Credit日期與正式確認 | P0/P3 | FR-063,064 | Credit Manager | future/closed/open | confirm | 非法拒絕；合法得唯一號及完整AR/Audit | NOT_RUN | — |
| UAT-034 | 已付款Invoice超額Credit | P0/P3 | FR-065 | Credit Manager | outstanding30 credit50 | confirm | invoice至0；20成同幣Credit Balance | NOT_RUN | — |
| UAT-035 | Credit Balance跨Invoice | P0/P3 | FR-066～068 | Credit Manager | same/different customer/currency | apply/unapply/reapply | 同戶同幣正確；跨戶/幣拒絕；history完整 | NOT_RUN | — |
| UAT-036 | Credit Void | P0/P3 | FR-069 | Credit Manager | with/without active applications | void | 有應用拒絕；解除後可Void且原號保留 | NOT_RUN | — |
| UAT-037 | Credit無物流效果 | P0/P3 | FR-070 | Credit Manager | issued shipment invoice | issue credit | SO/Shipment/Inventory數量不變 | NOT_RUN | — |
| UAT-038 | Shipment reversal guard | P0/P3 | FR-071 | Fulfillment Supervisor | partial/full source credit | request reversal | 未完全Credit被阻；完成後才進上游評估 | NOT_RUN | — |
| UAT-039 | Receipt method fields | P1/P3 | FR-072～074 | Receipt Manager | bank/cash/cheque/other | create each | method所需reference準確，日期/amount合法 | NOT_RUN | — |
| UAT-040 | Receipt部分/多Invoice核銷 | P0/P3 | FR-075～077 | Receipt Manager | receipt100 invoices30/80 | allocate | outstanding0/10，unallocated0，逐筆可trace | NOT_RUN | — |
| UAT-041 | 保留Unallocated Receipt | P1/P3 | FR-076 | Receipt Manager | receipt100 allocate30 | confirm/later allocate | 70獨立可見，日後同戶同幣可用，不自動猜配 | NOT_RUN | — |
| UAT-042 | Receipt跨Customer/Currency拒絕 | P0/P3 | FR-075,077 | Receipt Manager | mismatched invoice | allocate | 拒絕且不做FX/轉戶，數字不變 | NOT_RUN | — |
| UAT-043 | Receipt正式不可改 | P0/P3 | FR-078,079 | Receipt Manager | confirmed receipt | edit original fields | UI無入口/server拒絕，原憑證不變 | NOT_RUN | — |
| UAT-044 | Allocation解除及重配 | P0/P3 | FR-080,083 | Receipt Manager | receipt wrongly matched | unapply/reallocate | receipt fact不變；兩Invoice及history準確 | NOT_RUN | — |
| UAT-045 | Receipt整張Reversal | P0/P3 | FR-081,082 | Receipt Manager | allocated+unallocated receipt | reverse with reason/confirm | 所有核銷反向、outstanding恢復、receipt不可再用 | NOT_RUN | — |

| UAT-046 | Settlement重送不重複 | P0/P3 | FR-083 | Credit/Receipt Manager | confirm/apply/reverse逾時 | 重送原操作 | 返回同一結果，金額只影響一次 | NOT_RUN | — |
| UAT-047 | Receipt不等於銀行對賬 | P1/P3 | FR-084 | Receipt Manager | confirmed receipt | 看detail/export | 明確顯示未對賬，不宣稱銀行已配對 | NOT_RUN | — |
| UAT-048 | Due Date建議核銷 | P2/P3 | FR-085 | Receipt Manager | 多張不同Due invoice | 使用suggestion | 由舊至新建議；須人工確認且可修改 | NOT_RUN | — |

## 4. Inquiry、Exposure and Opening

| ID | Scenario | Priority / Phase | Requirements | Objective / Actor | Preconditions & Data | User Steps | Expected / Acceptance | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-049 | Customer Account守恆 | P0/P4 | FR-086,092,093 | AR Viewer | invoice/credit/receipt/reallocate | 查看account | 每Currency opening+activity=closing，全部可連回 | NOT_RUN | — |
| UAT-050 | 精確跨單據查詢 | P1/P4 | FR-087 | AR Viewer | numbers/customer/SO/shipment | 逐條件搜尋 | 找到正確Invoice/Credit/Receipt及來源 | NOT_RUN | — |
| UAT-051 | Outstanding欄位 | P0/P4 | FR-088 | AR Viewer | partially settled invoice | 看列表 | 原額、credit、receipt、outstanding、due/overdue正確 | NOT_RUN | — |
| UAT-052 | Overdue邊界 | P1/P4 | FR-089 | AR Viewer | due today/yesterday | as-of today | 今日到期不逾期；昨日逾期1日 | NOT_RUN | — |
| UAT-053 | Aging多幣分開 | P0/P4 | FR-090 | AR Viewer | HKD/USD invoices | 看Aging | 分Currency/桶正確，不虛構合計 | NOT_RUN | — |
| UAT-054 | Statement期間及餘額 | P0/P4 | FR-091,092 | AR Viewer | date range transactions | 生成screen/PDF | 期初、活動、期末完整且可trace | NOT_RUN | — |
| UAT-055 | Credit及Unallocated獨立顯示 | P1/P4 | FR-093 | AR Viewer | both balances | 看account | 兩者分開，不藏於負Invoice | NOT_RUN | — |
| UAT-056 | Suspended/Hold既有AR | P1/P4 | FR-094 | AR/Receipt Manager | suspended/hold customer | 查/credit/receipt | 既有債權可處理，新Manual仍拒絕 | NOT_RUN | — |
| UAT-057 | Active miss轉Archive | P1/P4 | FR-095,096 | AR Viewer | archived exact number | active search then archive | 提供Archive入口；找到唯讀詳情，不自動全掃 | NOT_RUN | — |
| UAT-058 | Screen/PDF/CSV同口徑 | P0/P4 | FR-097 | AR Viewer | same as-of/filter | compare outputs | transaction及餘額完全一致 | NOT_RUN | — |
| UAT-059 | Historical Effect Date | P0/P4 | FR-098 | AR Viewer | prior receipt/current reversal | statement before/after | 前期保留當時效果，本期顯示反向 | NOT_RUN | — |
| UAT-060 | Exposure可解釋 | P0/P4 | FR-099～102 | Sales User | commitment/invoice/credit/receipt mix | 查看credit summary | 組成及total正確；SO轉Invoice不雙計 | NOT_RUN | — |
| UAT-061 | Limit語意與Hold | P0/P4 | FR-103,104 | Sales User | no limit/0/over/hold | 建新credit SO | 狀態分明；超額warning；只有Hold阻擋 | NOT_RUN | — |
| UAT-062 | AR不可用不當作0 | P0/P4 | FR-105 | Sales User | AR dependency unavailable | 執行credit check | 顯示Unknown/不可可靠判斷，不通過為0 | NOT_RUN | — |
| UAT-063 | Hold不阻既有債權 | P1/P4 | FR-106 | Finance User | hold customer shipped | invoice/credit/receipt | 既有流程可完成 | NOT_RUN | — |
| UAT-064 | Sales最小Exposure projection | P1/P4 | FR-107 | Sales User | customer account has details | 查看Sales summary | 只見判斷所需字段，無銀行/財務明細 | NOT_RUN | — |
| UAT-065 | Opening模板 | P1/P4 | FR-108,109 | Import Operator | v1 template | download/read | 欄位/範例安全；只Invoice/Credit Balance | NOT_RUN | — |
| UAT-066 | Opening預檢 | P0/P4 | FR-110～112 | Import Operator | mixed valid/invalid/formula CSV | upload/precheck | errors/summary可定位；預檢不改AR/取號 | NOT_RUN | — |
| UAT-067 | Opening文件隔離 | P0/P4 | FR-113～116 | Import Operator | one invalid document among valid | confirm | invalid整張失敗；valid獨立成功且清楚OPENING | NOT_RUN | — |
| UAT-068 | Opening重送與更正 | P0/P4 | FR-110,117 | Import Operator | same key same/different content | upload again | same=Duplicate原結果；different=conflict；更正走正式流程 | NOT_RUN | — |
| UAT-069 | Opening中斷恢復 | P0/P4 | FR-118 | Import Operator | interrupted job | reopen/resume | 已成功不重複，失敗可重試，counts一致 | NOT_RUN | — |
| UAT-070 | Opening私有檔案 | P0/P4 | FR-119 | Import Operator | owner/other user | download source/result | 只owner/授權者；到期政策顯示；Audit保留 | NOT_RUN | — |

## 5. Documents、Export、Audit and Archive

| ID | Scenario | Priority / Phase | Requirements | Objective / Actor | Preconditions & Data | User Steps | Expected / Acceptance | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-071 | 正式/VOID文件 | P1/P2-4 | FR-120～123 | AR Viewer | issued/void invoice/credit | print/download | A4完整、VOID顯著、missing billing不虛構、snapshot穩定 | NOT_RUN | — |
| UAT-072 | 文件及CSV惡意內容 | P0/P4 | FR-124 | Security UAT delegate | formula/script/html/control text | export/open/render | 不執行，安全轉義或拒絕 | NOT_RUN | — |
| UAT-073 | 文件不表示已寄出 | P2/P2 | FR-125 | Invoice Operator | downloaded PDF | 查看status | 只顯示generated/downloaded，不標已email/delivered | NOT_RUN | — |
| UAT-074 | Authorized exports | P1/P4 | FR-126～129 | Export Operator | small/large datasets | create job/download | filters/as-of/count/owner/expiry正確，無完整銀行 | NOT_RUN | — |
| UAT-075 | Audit完整可查 | P0/P1-4 | FR-130～132 | AR Viewer/Auditor | success/failure critical actions | query audit | actor/time/reason/outcome/correlation可見且無秘密 | NOT_RUN | — |
| UAT-076 | 財務獨立Archive eligibility | P0/P4 | FR-133,134 | Operations/Finance | settled/unsettled/open matters | run approved archive | 只有符合條件aggregate搬移；SO archive不被未收invoice阻止 | NOT_RUN | — |
| UAT-077 | 跨tier來源追溯 | P0/P4 | FR-135～138 | AR Viewer | SO/Shipment/Invoice不同tiers | navigate trace | 雙向連結正確；日常Active仍快 | NOT_RUN | — |
| UAT-078 | Archive中斷重跑 | P0/P4 | FR-139,140 | Operations | interrupted archive batch | resume/search | Active不丟、Archive不重複、唯一routing、差異可見 | NOT_RUN | — |
| UAT-079 | Archive唯讀及保留 | P0/P4 | FR-141～143 | AR Viewer/Operations | archived record/legal hold | view/edit/purge attempt | 可讀不可改；未到期限/hold不刪；Audit可查 | NOT_RUN | — |

## 6. Role、Resilience and Phase Sign-off Scenarios

| ID | Scenario | Priority / Phase | Requirements | Objective / Actor | Preconditions & Data | User Steps | Expected / Acceptance | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-080 | 權限撤回後重驗 | P0/All | SEC-001～003 | Admin+Operator | user has open page/job | revoke then submit/continue job | 未開始工作停止；已commit保留；後端拒絕 | NOT_RUN | — |
| UAT-081 | IDOR安全拒絕 | P0/All | SEC-002 | Business Security Tester | known other IDs | replace URL/body IDs | 404/拒絕且無副作用/存在性洩漏 | NOT_RUN | — |
| UAT-082 | 完整銀行資料最小顯示 | P0/P1-4 | SEC-004～006 | Settings/other users | bank account | list/detail/document/export | 只有合法流程可見必要內容，其餘masked | NOT_RUN | — |
| UAT-083 | Private file owner及到期 | P0/P4 | SEC-007,008 | Two Export Users | completed/expired files | exchange link/download | 非owner拒絕；expired不可下載；Audit存在 | NOT_RUN | — |
| UAT-084 | 正式記錄不可覆寫 | P0/P2-4 | SEC-009 | Finance Roles | issued docs/ledger/archive | attempt edits | 只能用正式Void/Credit/Reversal；歷史保留 | NOT_RUN | — |
| UAT-085 | Responsive及鍵盤流程 | P1/All | SEC-014 | Keyboard/mobile user | 375/768/1440 viewports | complete core flows | 可完成、焦點清楚、狀態不只顏色、金額不隱藏 | NOT_RUN | — |
| UAT-086 | Operation processing恢復 | P0/P2-4 | SEC-015 | Finance Operator | command returns processing | leave/reopen page | 同一operation收斂；不要求再建新文件 | NOT_RUN | — |
| UAT-087 | PHASE-001 Foundation sign-off | P0/P1 | FR-001～010 | Product/Tech Owners | P1 reports ready | review settings/contracts/proofs | providers/permissions/schema證據完整，business routes still off | NOT_RUN | — |
| UAT-088 | PHASE-002 Invoicing sign-off | P0/P2 | FR-011～058 | Finance Process Owner | P2 environment | run core 008～030 | Shipment至Invoice閉環、0重複/partial effect | NOT_RUN | — |
| UAT-089 | PHASE-003 Settlement sign-off | P0/P3 | FR-059～085 | AR Process Owner | P3 environment | run core 031～048 | Credit/Receipt/Allocation/Reversal全守恆 | NOT_RUN | — |
| UAT-090 | PHASE-004 Release sign-off | P0/P4 | FR-086～143 | Product/Finance/Ops | full evidence及已批准營運門檻 | run core 049～086/review reports | inquiry/exposure/opening/archive/restore完成，無S1/S2 | NOT_RUN | — |

## 7. Phase Sign-off Record

| Phase | Business owner | Technical report | UAT result | Open exceptions | Decision / Date |
| --- | --- | --- | --- | --- | --- |
| PHASE-001 | — | — | NOT_RUN | — | — |
| PHASE-002 | — | — | NOT_RUN | — | — |
| PHASE-003 | — | — | NOT_RUN | — | — |
| PHASE-004 | — | — | NOT_RUN | — | — |

## 8. Mechanical Functional Coverage

Covered IDs: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140, FR-141, FR-142, FR-143.

# Business Master UAT Test Specification

Typed metadata以 `08_traceability.json` 為準。全部 result=`NOT_RUN`；Playwright preferred只表示未來執行方法，
不代表自動化或業務驗收已完成。

## UAT-001 — 管理員建立及查找 Currency

### Business objective and actor
Business Master管理員新增業務要用的官方Currency，查閱者能可靠找到；驗證集中主資料價值。

### Preconditions and data
mgmt/view角色；HKD已存在；選一個ISO測試code，未在catalog。

### Steps
進Currency頁，搜尋空結果，建立值，再用code/name/status查找及開detail。

### Expected business result
建立成功、projection/版本/更新者正確，view-only可看但無修改action。

### Acceptance criteria
資料只有一筆、可追到Create audit；無FX/delete功能。

## UAT-002 — Currency非法值與 immutable code

### Business objective and actor
管理員不會把crypto、自訂/錯字code或錯誤precision帶入所有交易模組。

### Preconditions and data
mgmt角色；lowercase、BTC、未知code、precision 5及已存在Currency。

### Steps
逐一提交invalid create，編輯既有Currency並嘗試改code。

### Expected business result
表單指出具體欄位且焦點到error summary；沒有資料被部分保存；code欄readonly/後端拒絕繞過。

### Acceptance criteria
刷新後原資料/version不變，invalid操作無success audit。

## UAT-003 — 維護 Payment Term 與四種規則

### Business objective and actor
管理員可建立清晰而一致的付款條件，不把示範條款預置到production。

### Preconditions and data
mgmt角色；catalog起初無Payment Term；IMMEDIATE、NET30、EOM、MANUAL測試值。

### Steps
逐一建立、搜尋、修改name/description/rule；嘗試duplicate/invalid dueDays及code change。

### Expected business result
四種有效規則保存；conditional dueDays清楚；duplicate/invalid/code change可理解拒絕。

### Acceptance criteria
每項穩定id/code/version及audit正確，無第五種type或production auto-seed。

## UAT-004 — Due Date預覽可重現

### Business objective and actor
財務/管理員能在採用條款前知道同一基準日會得到甚麼到期日。

### Preconditions and data
四種Active terms；月末、跨月、閏年及NET 0/30 base dates。

### Steps
在Payment Term頁輸入baseDate預覽；刷新/切換時區後重做；測MANUAL。

### Expected business result
IMMEDIATE/NET/EOM日期符合calendar；MANUAL清楚要求人工輸入而不顯示虛構due date。

### Acceptance criteria
相同term version/baseDate結果一致且顯示snapshot/version；invalid date不能提交。

## UAT-005 — 有引用資料的高影響操作與歷史保留

### Business objective and actor
管理員在知道 Customer/Supplier/交易影響後停用或修改精度／計算規則，歷史仍可信。

### Preconditions and data
mgmt角色；Currency/term各有active defaults及歷史snapshot。

### Steps
依次開啟停用、Currency precision change、Payment Term rule change，檢閱 operation/diff 與 consumer
counts/status，輸入reason確認；到consumer新建/歷史頁驗證，再reactivate。

### Expected business result
停用不改舊reference/snapshot，新selector/交易不可用且defaults提示更換；精度／規則修改不回寫舊 snapshot，
新交易採新 version；reactivate後新用恢復。

### Acceptance criteria
impact與Deactivate/Activate/ChangePrecision/ChangeRule audit完整；Business Master沒有修改consumer rows。

## UAT-006 — 不完整或過期影響不得執行高影響操作

### Business objective and actor
共享依賴失效或資料已變時，系統寧可安全拒絕也不盲目停用或修改精度／規則。

### Preconditions and data
mgmt角色；checker error、五分鐘過期、preview後新增reference及另一管理員修改version scenarios。

### Steps
逐一對 deactivate/change-precision/change-rule 取得/確認 impact preview，並在失敗後重新整理取得新摘要。

### Expected business result
unknown/stale/mismatch均阻擋並說明重試；fresh完整摘要才可停用。

### Acceptance criteria
每個拒絕後狀態不變；刷新不重複停用；correlation可交給支援人員。

## UAT-007 — 權限與撤銷

### Business objective and actor
只有被授權者能管理主資料，而業務使用者仍可在自身流程選擇Active值。

### Preconditions and data
anonymous、view、mgmt、consumer、system-admin及即時撤權帳號。

### Steps
逐角色開頁/直呼API/執行mutation；consumer在Supplier/Sales lookup；操作中撤權再提交。

### Expected business result
401/403及menu/action visibility正確；consumer不用取得mgmt；system-admin有完整權限；撤權阻止提交。

### Acceptance criteria
denied操作無資料變更，錯誤不洩漏內部permission或其他資料。

## UAT-008 — 版本衝突與安全重試

### Business objective and actor
兩名管理員同時編輯或網路中斷時，不會互相覆寫或重複高影響操作。

### Preconditions and data
兩browser sessions同一entity；可模擬response loss/slow network。

### Steps
A/B載入同version，A保存，B保存；停用double-click；commit後中斷以原request重試。

### Expected business result
A成功、B收到可重載409且文字保留；停用只一次；retry顯示原結果。

### Acceptance criteria
最新值/audit/version只有一個winner，沒有duplicate或unknown outcome。

## UAT-009 — 可存取、回應式及錯誤復原 UI

### Business objective and actor
查閱/管理員能以鍵盤與常用裝置可靠完成核心流程及從可恢復錯誤繼續。

### Preconditions and data
375/768/1024/1440 viewports；loading/empty/400/403/409/503 fixtures；鍵盤操作。

### Steps
瀏覽兩頁、tab至所有control、提交invalid form、停用dialog、refresh/back、network retry；檢查heading/focus/status。

### Expected business result
內容不被截掉，actions可到達，錯誤摘要獲focus，狀態不只用顏色，retry不重複effect。

### Acceptance criteria
WCAG 2.1 AA核心檢查、project breakpoints、console/request檢查無blocking問題。

## UAT-010 — 上線資料、readiness與 consumer continuity

### Business objective and actor
Business Master owner/運維確認上線只有核准HKD、沒有未核准條款，而且所有業務consumer取得同一契約。

### Preconditions and data
Staging fresh migration、owner/operations/consumer代表、readiness及contract reports。

### Steps
核對HKD/Payment rows/permissions/provider version；建立正式需要的測試term；在各consumer走selector/history/calculate；重啟app。

### Expected business result
只有HKD seed、零Payment seed；owner手建值可用；consumer無shadow catalog，重啟後結果不漂移。

### Acceptance criteria
Owner核對與required Technical cases均有證據；此case的automation結果仍不能代替Product Owner business acceptance。

## UAT-011 — 備份還原後的業務連續性

### Business objective and actor
Business Master owner與運維確認復原後不會失去可用目錄、inactive history或修改責任鏈。

### Preconditions and data
已由TC-019驗證的隔離restore；owner可查看catalog/audit，consumer可走lookup。

### Steps
在restore後核對HKD、Active/Inactive values、versions/audits，從consumer開歷史文件及建立新draft。

### Expected business result
歷史顯示與restore前一致，Active selector正常，Inactive不會誤入新交易；RTO/RPO報告可理解。

### Acceptance criteria
Owner明確確認業務資料完整；任何缺row/audit/history或錯誤new-use均不接受。

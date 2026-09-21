# TASK-031 — SUP-CAP-02 併發、安全與端到端驗收（PHASE-002 出口）

**Task：** TASK-031（T31）・**Phase：** PHASE-002・**Capability：** SUP-CAP-02
**分支：** `codex/supplier-task-031`（由 main `860183a` 切出）
**Plan baseline：** `a0d41e31…`・**Design baseline：** `e4083319…`

## 0. 一個要先講清楚嘅更正

Revision 136 嘅 `next_safe_action` 寫住「PHASE-002 嘅建置工作完成：TASK-025 到 TASK-030
全部 DONE」，並且建議下一步係一個 Phase 層面嘅決定。**嗰句少計咗一個 task。**
`05_development_tasks.md:222` 定義 PHASE-002 = TASK-025～TASK-031，而 T31 就係呢個 Phase
嘅 SUP-CAP-02 獨立驗收出口。所以 T31 唔係「PHASE-002 之後嘅嘢」，佢係 PHASE-002 本身
未做完嘅最後一格。呢個更正已經記入 revision 137 嘅 observation。

## 1. Scope

只改測試，**冇任何 production code 改動**。`git diff main --stat` 只得四個檔：

| 檔案 | 性質 |
| --- | --- |
| `server/test/integration/supplierApproval.integration.test.js` | +7 個測試 |
| `server/test/integration/supplierSettings.integration.test.js` | +2 個測試 |
| `client/test/pages/suppliers/create.test.js` | DEF-020 修法（3 行斷言） |
| `client/test/pages/suppliers/approvals.test.js` | N-1 選擇器收窄 |

四個檔全部喺 manifest 嘅 `allowed_write_paths` 入面；冇掂過任何
`approval_required_paths`。`00_project_profile.json` **冇改** —— profile 係 PLAN hash
嘅一部分，而 `supplier-phase-001-server` 個 argv 本身已經 glob 住
`server/test/integration/supplier*.integration.test.js`，新測試自動入到 suite。

## 2. 三條 Acceptance 逐條對賬

### AC 第一條 — 設定 toggle 與 activation 並發產生 deterministic 順序；已 Pending 不被 OFF 自動批准

**之前有嘅：** `an in-flight activation read blocks a concurrent settings write until it
finishes` —— 證咗其中一個方向。

**缺口一：toggle 側嘅鎖冇人測。** 加 `an in-flight settings write blocks a concurrent
activation read until it finishes`。

呢一段第一版寫錯咗，照講：我原本嘅理由係「次序只證咗一半，要補返轉頭嗰邊」，而
第一版嘅測試 writer 係手寫嘅 `SELECT … FOR UPDATE`。REV-032 M-3／L-5 指出咁樣證唔到
新嘢 —— 兩個鎖測試唯一掂到嘅 product code 都係 `getActivationPolicy` 嗰三個字，而 S 鎖
同 X 鎖唔相容係 MySQL 嘅保證，唔係應用層行為。佢用變異證咗：拆走 `FOR SHARE` 兩個都
紅，而拆走 `updateSettings` **自己嗰個** `FOR UPDATE`，兩個都照綠 —— 即係 toggle 側嘅
鎖根本冇人測。

修正後個 writer 行真嘅 `updateSettings`，喺 `FOR UPDATE` 讀返嚟之後、行到 `UPDATE`
之前停低（再遲少少，`UPDATE` 自己嗰個 X 鎖會蓋過答案）。而家 X5 變異紅，而且**只有**
新嗰個測試紅，舊嗰個照綠 —— 兩個測試唔再係變異等價。

**缺口二：「已 Pending 不被 OFF 自動批准」完全空白。** 呢條規則冇一段對應嘅程式碼 ——
佢係「冇任何一條路會咁做」，所以只可以用行為證。新測試
`turning the approval policy off does not decide an already pending request` 喺一個
**唔會 commit** 嘅交易入面真係關一次政策，然後證：

- 申請仍然 `pending`，`version` 仍然係 1（完全冇人郁過）
- Supplier 仍然 `pending_approval`
- 佢仍然只可以由被指派嘅審批人決定（非指派人 → `APPROVAL_NOT_ASSIGNED`）
- 而被指派人仍然批得到 —— 關政策係停咗**新**提交要審批，唔係廢咗現有隊列

**點解要喺一個交易入面做：** `supplier_settings` 係 singleton 而 `erp_dev` 係共用嘅，
`node --test` 會並行跑唔同檔案。REV-015 已經就呢一點出過聲。呢個測試用一個只借用
caller 交易、唔開新交易亦唔 commit 嘅 database wrapper（喺一個已開嘅交易入面再
`beginTransaction()`，MySQL 會隱式 commit 咗前面嗰個，等於將中間值放咗出去）。跑完
核對過 `supplier_settings` 嘅 `version` 仍然係 1，冇留低任何痕跡。

**同瀏覽器層嘅分工：** e2e 已經有
`the settings page turns approval on, then off, and says it is not retroactive`，但佢用
mock API，證到嘅係頁面寫住「不追溯處理已在審批中的申請」同 payload 啱。伺服器真係
有冇追溯，佢證唔到。而家兩層各證各自嗰半。

### AC 第二條 — 雙 approve／approve-vs-update 只有一個合法 terminal 結果及一筆 decision audit；重送 idempotent

之前十一個 approval integration test 冇一個覆蓋。加三個：

1. `two concurrent approves produce one transition and exactly one decision audit` ——
   兩條連線同時撳批准。斷言唔係「兩個都唔死」，而係 `replayed === false` 嘅**剛好一個**、
   `replayed === true` 嘅剛好一個、request version 停喺 2、而且
   `approval.approve` audit 剛好一行。兩行 audit 就係兩次決定，即使最終狀態睇落一樣。
2. `resending the same decision is idempotent and writes no second audit row` —— 上面
   嗰個靠真實鎖排序，邊邊贏唔固定；呢個係確定性控制。同一個 version 送兩次，第二次
   一定要行重送分支，version 停喺 2，audit 仍然一行。
3. `an approve racing a significant edit yields one terminal result, not both` ——
   刻意令編輯方贏（佢先攞 `suppliers` 鎖，跟設計 §2.6 嘅次序），因為咁先有確定性斷言：
   一個 terminal 結果 = `invalidated`，Supplier = `draft`，批准方
   `APPROVAL_REQUEST_NOT_OPEN`，`approval.approve` 零行、`approval.invalidate` 一行。

### AC 第三條 — JWT 後撤權、disabled approver、IDOR、unassigned reassign 全部安全失敗／恢復

四個新測試。**關鍵：呢四個入面有三個用真嘅 `assertActorFresh` 同真嘅
role → permission → user rows，唔用 stub。** 一個 stub `authorize` 本身就係「而家嘅
權限」嘅答案，改 `user_roles` 佢一無所知 —— 用 stub 去測撤權係證明唔到嘢嘅。

| 測試 | 證嘅嘢 |
| --- | --- |
| `a decision made after the approver's permission is revoked fails at both guards` | 撤權後揸舊 token → `PERMISSION_STALE`（第一層）；同一個人誠實 claim 返空集合 → `APPROVAL_PERMISSION_LOST`（第二層）。兩層擋嘅係兩件唔同嘅事，淨係有第一層嘅話一個誠實地冇權嘅 caller 就批到。 |
| `a disabled user can neither receive a reassignment nor decide` | 停用帳號唔可以被指派（`APPROVER_NOT_ELIGIBLE`），亦都自己批唔到。順手鎖住 reassign 嘅**檢查次序**：actor 檢查行先，唔可以借 reassign 去探測邊個帳號存在。 |
| `withdrawing through another Supplier's route is refused and changes nothing` | REV-026 H-1 嗰個 scope guard 嘅真 row 版本。`publicCode` 同「申請搵唔到」共用，所以斷言連 `publicMessage` 一齊比，再核對個申請原封不動。 |
| `an unassigned request refuses every decision until a reassignment restores it` | 安全失敗同恢復係同一條規則嘅兩邊：`assigned_approver_id IS NULL` 時邊個都批唔到（`sameUser(null, id)` 一定 false，一個 NULL 指派唔等於「邊個都得」），重新指派之後批得返。 |

## 3. 變異測試 —— 每一個新斷言都行過假嘅一面

九個新 server 測試冇一個係擺設。每個變異獨立套用、跑完即刻還原：

| # | 變異 | 結果 |
| --- | --- | --- |
| M1 | 拆走 `#decide` 嘅重送分支 | **RED** — 併發批准 + 重送兩個都紅 |
| M2 | 拆走決定時嘅 `supplier.approval` 檢查 | **RED** — 撤權 + 停用兩個都紅 |
| M3 | `assertEligibleApprover` 拆走 `AND status = 'active'` | **RED** — 停用帳號 |
| M4 | 拆走跨 Supplier scope guard | **RED** — IDOR |
| M5 | 將 `NULL` 指派當成「邊個都得」 | **RED** — 未指派 |
| M6 | 拆走 `APPROVAL_REQUEST_NOT_OPEN` conflict | **RED** — approve vs edit |
| M7 | `getActivationPolicy` 拆走 `FOR SHARE` | **RED** — 新舊兩個方向嘅鎖測試都紅 |
| M8 | 令關政策順手批晒 pending | **RED** — 已 Pending 不被 OFF 自動批准 |
| R6b / R7 / R7b | create page 唔傳 `:field-error`／panel 拆走 `:error`／`:error-message` | **RED ×3** — DEF-020 修法生效 |
| N1 | diff 行拆走 `:data-field` | **RED** — 收窄後嘅選擇器真係綁住個屬性 |

**過程中出過一次事，照講：** 第一版變異腳本嘅還原路徑寫錯（`eval` 加 pipe），四個
client 變異全部套用咗而一個都冇還原返。`git status` 揾到，`git diff` 逐行核對過只係
嗰四個變異、冇其他嘢，先至 `git checkout -- client/src` 還原，然後用一個逐個做、每次
都還原嘅 Python 腳本重跑。上表嘅 R6b/R7/R7b/N1 係重跑嘅結果，唔係第一次嗰次。跑完
再核對 `git diff -- client/src server/src` 係空。

## 4. Developer self-test

| Suite | 結果 | Evidence |
| --- | --- | --- |
| `supplier-phase-001-server` | **PASS** 314/314（原 305，+9） | `evidence/20260918T093455-840b9265baaa/run.json` |
| `supplier-phase-001-client` | **PASS** 71/71 | `evidence/20260918T093502-b4be748ad34f/run.json` |
| `lint` | **PASS** | `evidence/20260918T093507-4a2ef643ea2a/run.json` |
| `client-build` | **PASS** | `evidence/20260918T093510-90542a511e10/run.json` |

**瀏覽器驗證（CLAUDE.md §9）：**
`npx playwright test --config client/e2e/supplier-management/playwright.config.js` ——
**17 passed (14.0s)**，零 console 問題（各 spec 自己 `collectConsole` 斷言）。行嘅係
regression：T31 冇改任何 UI 行為，所以冇加新 spec。呢個係 UAT-stage suite，所以記錄成
MANUAL_TEST observation，唔當 DEVELOPER-stage 正式 suite evidence。

跑完核對過資料庫冇殘留：`supplier_settings.version` 仍然係 1，
`supplier-t31-it-%`／`supplier-approval-it-%`／`supplier-settings-it-%` 嘅 users、roles
同 `APR-%`／`SET-%` 嘅 suppliers 全部 0 行。

## 5. 順手收埋嘅

- **DEF-020（REV-031 L-1）** — 審批人欄位錯誤 render 咗但冇人測過。原本個斷言係摘要
  訊息「請先選擇審批人」，欄位錯誤係另一句「請選擇審批人」（請先 vs 請），所以摘要
  嗰句永遠去唔到個控制項。跟 REV-031 寫低嘅三行修法。修法本身喺
  `client/test/pages/suppliers/create.test.js`，屬於本模組 `client/test/**`。
- **REV-031 N-1** — diff 行選擇器由 `row.text().includes("名稱")`（靠 `FIELD_LABEL` 嘅
  key 次序先啱）收窄到 `[data-field="supplierName"]`，同瀏覽器層用返同一個精確屬性。

## 6. 未關嘅嘢

- **DEF-017 / DEF-019**（Item Management 共用資料庫並行）同 **DEF-018**（framework
  `PasswordReasonDialog` 撳 Enter 唔提交）已經由 HD-025 路由去佢哋各自嘅 owner，唔喺
  呢個 task 內處理。DEF-019 大機會會令呢條 branch 嘅 CI 紅一兩次；嗰啲紅同 T31 無關。
- **REV-031 N-2**（stale rejection 喺 audit 入面分唔出）仍然係一個 Nit，冇處理 —— 佢
  要加 audit detail 欄位，屬於 design 層面嘅改動，唔喺 T31 嘅 scope 入面。

## 7. Checkpoint

T31 係 PHASE-002 嘅 Exit criteria。**三條 Acceptance criteria** 全部有同 baseline 嘅
實際證據，`SUP-CAP-02` 冇未處理 P0／P1。

**一個要明講嘅限制（REV-032 M-4）：** T31 嘅 **Description** 寫住「用真MySQL與
**HTTP**／UI flow驗證」。新測試係 service 層打真 MySQL，**唔係**行 HTTP。REV-032 查過
另外兩層：`server/test/supplierApprovalHandlers.test.js` 十五個測試全部係宣告式（比對
route table、permission pair、schema closure），佢**唔會**起 server 亦唔會發 request；
而兩個 e2e spec 都 `page.route` 全 mock 咗個 API。所以 `supplier_management` 入面冇一層
係由 dispatcher → handler → service → MySQL 行足全程。

點解唔當佢 blocking：`05_development_tasks.md` §2.3 明文講綁住嘅係 task 段落嘅實際
**Acceptance criteria 或 Verification**，而三條 checkbox 冇一條講 HTTP，Verification 列
嘅就係嗰兩個 integration 檔、兩個 client vitest 檔同 lint／build，全部過。殘餘風險亦都
真係低：宣告式 handler 測試釘住 permission pair 同 schema closure，而通用 dispatcher
測試（`apiDispatcher.test.js`、`security.test.js`、`requestValidator.test.js`）覆蓋執行。

呢個缺口記錄喺度，唔係當佢唔存在。要收嘅話，repo 已經有現成樣板 ——
`server/test/business-master/http.integration.test.js` 用 `createApplication({ port: 0 })`
起真 app 再 `fetch` —— 而且佢已經喺呢個 suite 嘅 argv 入面。

PHASE-002 嘅收線仍然要獨立 review 同 required CI 核對同一個候選之後，先由 Product
Owner 決定。

## 8. REV-032 及其修補

獨立 review **REV-032** 判 **APPROVED**（head `8953514`），連四個 M。完整報告喺
`29_rev_032_independent_review.md`。reviewer 獨立重跑咗我十二個變異（12/12 RED，紅嘅係
同一批測試），再自己加六個，其中一個活咗 —— 就係下面 M-3。

| findings | 處理 |
| --- | --- |
| **M-1** DEF-020 記住 OPEN 兼喺 `next_safe_action` 消失 | 已修：defect 記錄補 closure evidence，並喺 `next_safe_action` 講明喺 merge 收 |
| **M-2** `next_safe_action` 丟失整個 carried-forward 風險清單 | 已修：重新接返 |
| **M-3** `updateSettings` 自己嗰個 `FOR UPDATE` 冇人測（X5 變異存活） | 已修：見 §2 缺口一，X5 而家紅 |
| **M-4** Description 要求 HTTP 驗證，冇一層行到 | 已喺 §7 明講缺口同理由；HTTP 測試未加 |
| **L-1** `seedRole` 喺兩個 INSERT 中間拋錯會漏 role row | 已修：`sink` 喺 dependent insert 之前就俾 `t.after` 見到 |
| **L-2** `joiningDatabase` 失敗時唔 rollback | 已修：改用 savepoint |
| **L-3** 300ms sleep 唔係 load-bearing，但註解話係 | 已修：改 0 並更正註解（測試由 333ms 跌到 16ms） |
| **L-4** `cleanup()` 個 `OR request_id IN (...)` 係全域掃 | **未郁** —— pre-existing，reviewer 亦都講明唔係呢個 task 嘅嘢 |
| **L-5** 新嗰個鎖測試同舊嗰個變異等價 | 隨 M-3 一齊修好 |
| **N-1…N-5** | reviewer 自己標明係 note，冇要求行動 |

修補之後重跑：25/25 integration PASS、client 71/71、lint、Playwright 17/17，而 M1／M6／
XA／M4／M8 五個關鍵變異全部仍然 RED。

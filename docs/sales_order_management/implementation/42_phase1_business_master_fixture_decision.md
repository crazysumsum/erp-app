# DEC-020 — Sales consumer impact 與測試管理員接線

Status: DECISION_REQUIRED / PENDING HUMAN。EXECUTION_MODE: IMPLEMENT；PHASE-002 / TASK-021～027。此文件是可審查提案與失敗紀錄，不是批准、實作完成、Formal Technical Acceptance、UAT 或 Release。

## 實際發現與更正

DEC-019＋018 已按 Sam 的「同意」套用並提交 `c3bda27236dc91761487faefdac4765534cfd7fe`；其 source fingerprint `f68595a942d95617f406250790fc134230e59db4d38a8cfbc699f1383f394760`，DESIGN `debc1b85f553f6baa4c024fb08fbeb11a63643f2866bb2af91881db1e20242d0`，PLAN `24280ccf2c73a9ab243d6fa635c58ab0c896be7fc5e6d61f6b145817d53eaa26`。本提案未套用；主 workspace 不受影響；PR #184 仍是 draft，remote head 仍是 53e5471。

23 個原型別 developer suites 中，22 個最新執行 PASS（包括原生 Inventory 10 suites／15 cases、P1 unit47/native46/client58/實際 Playwright8；全數 P1 case 零失敗／跳過）。Inventory019 初次 socket guard FAIL，僅更正 owned TCP binding 後依原命令重跑 PASS，失敗歷史保留。server coverage 尚未通過，不得宣告 P1 DONE 或 merge。

第一個 coverage 原始輸出 2665 tests／2571 PASS／80 FAIL／14 opt-in skips：78 次 TCP3306 連線拒絕、1 Item recovery 缺 DB_ADMIN、1 真實 Business Master 503。修正成已驗證的 owned localhost55800／fresh migrated schema 後，第二次完整命令結果 FAIL：2665 tests／2647 PASS／4 FAIL／14 opt-in skips。

第二次四個 terminal failure blocks：

1. Business Master 真 HTTP impact preview 503：Sales tables 已安裝，factory readiness fallback 回 UNKNOWN；此 guard 正確阻擋缺 consumer checker。
2. Item recovery `TC-016` 缺 DB_ADMIN_USER/PASSWORD。
3. Supplier restore `TC-077` 缺 DB_ADMIN_USER/PASSWORD；fixture 在註冊 cleanup 前開 connection 再 assert，因而留下連線令 test child 卡住。僅 SIGTERM 經 PID/PPID/file 核實的自建 child63438，parent collector 保留並完成其餘套件；此介入與 FAIL 保留，不能當成無介入的完整 PASS。
4. Supplier import `TASK-042` 以未設定 DB_ADMIN 的空 user 連線，ER_ACCESS_DENIED_ERROR。

第二次實際證據：`evidence/20261006T072659-a76ce254c212/run.json`，stdout SHA `77dab64db3fbc50b5bf96f00254e6e398c39983cd40c61200a0282c745f1bc33`。型別 EXIT_CODE evidence counts 為0；上述實際 runner 測試總數只作 diagnosis，不改其 approved parser 或聲稱 formal case 通過。

**更正先前 CI 說明**：CI37427146618／remote53e5471 的 Test job 有11個 failures：1 Business Master503、9 Sales fixture CREATE TRIGGER 在 binary logging 下要求 SUPER、1 strict service registry missing two Sales entries。不是只有 registry 失敗。audit/lint/build/browser 四個 job PASS；registry 已於 c3 修正，其餘尚未修正，沒有 current-candidate green CI。舊 observation／報告／approval 保留，新增此更正及 actual observation。

## 推薦最小補正

沿用 Customer／Supplier 既有 consumer checker 模式。Sales 自有一個 checker；Business Master factory 僅 import／instantiate 接線，不增 public service、API、registry framework 或依賴。Currency／Payment Term reference 只按 document currency_code／payment_term_id 計數；defaultCount=0。Quotation DRAFT/ISSUED 與 Order DRAFT/CONFIRMING/CONFIRMED/PARTIALLY_FULFILLED 是 open；Quotation EXPIRED/CONVERTED/CANCELLED 與 Order COMPLETED/CLOSED/CANCELLED 是 historical。尚未由 job 固化的 ISSUED 保守列 open，不改有效過期／轉單規則；credit snapshot currency 的原 consumer 責任不轉移。

同一 UNION ALL statement snapshot 的 count/version/max-time/max-id 聚合產生 deterministic SHA watermark；只回 counts/watermark，不露完整文件、customer、銀行或地址資料。保留 actor/version/change/expiry/recompute token 規則、UNKNOWN／error fail closed。全未安裝才 NOT_INSTALLED；partial schema、unknown status、unsafe integer、SQL error、installed sales_orders_archive 都阻擋。P1 不搶做 Archive；Phase4 安裝 Archive 前須擴充 checker，這是明確依賴。

Sales native fixture 只讓 CREATE/DROP TRIGGER DDL 使用 separate admin connection；普通 db 與所有業務 DML／race／rollback 仍以原 DB_USER 執行。CI 使用已有 ephemeral service root/root 的 DB_ADMIN env；本地後續只在自建一次性 MySQL instance 配置合成 admin／app fixture account，admin grant 不能流向共用或 production instance。Item／Supplier 既有 recovery fixtures 原碼不改。profile 明列並遮蔽 DB_ADMIN_USER/PASSWORD；不 disable binary logging、不改 global trust、不給 app SUPER、不把整套業務測試改成 root。

原 requirements、60個正式 technical cases、UAT、原 command entries、test/skip/coverage／memory thresholds、完整 P1 merge Gate 均保留。只追加一個真 MySQL Sales reference native test及4個 focused unit tests。額外工作限於此整合缺口；不是啟動 TASK028+。

## 精確 supplemental shared scope

- `server/src/modules/businessMaster/businessMasterFactory.js`：兩處 checker wiring。
- `server/test/business-master/http.integration.test.js`：Sales installed expectation 改 READY，保留所有真 HTTP/token/deactivation asserts。
- `.github/workflows/ci.yml`：只增加 owned ephemeral DB_ADMIN_USER/PASSWORD test env。

Sales 自有 checker、unit/native tests、fixture 與兩處 native trigger calls 已在 Sales allowlist；新的共享路徑仍需此次補充 scope 批准。Design/Task022/manifest/profile/UAT-NA ref 以新 baseline 綁定，不重寫舊批准。UAT-NA 保持原 NFR014/015理由，fixed future ID APR-PHASE1-UATNA-DEC020 在 hash 前寫入；批准後才 append 真實 human approval／re-render matrix／驗 Gate。可一併授權只限 hash/source-pin/matrix/decision-reference 的機械對齊，不能藉此改新語意／門檻。

## 具體 reviewable patch 與基準

Unapplied combined patch：`/private/tmp/sales-p1-private/dec020-proposal/combined.patch`。

SHA256 `75cdcf026241b88abe0f3434bdc51db0ae6552b28486c5851ea0643537f684b8`。

Proposed DESIGN `52bcb72e3a9ce8cbb46531d5367454da6bad05565a6dbadaa1e504d4a1d08e3d`；PLAN `f6020e25ec28d09bcef6029b1eea9e3c648cd248c222f4b08527518c05bf1ee8`。完整鏡像／基準：`/private/tmp/sales-p1-private/dec020-proposal/baselines.json`。Base commit `c3bda27236dc91761487faefdac4765534cfd7fe`。預計修改14個檔案，無 migration／production config／secret／新依賴。

兩位 actual separate reviewers /root/sales_p1_review、/root/sales_readiness_review 已對上述 final exact patch／D/P 各自 APPROVE，包含 prospective canonical labels 與 required code_key 的最後修正。獨立4/4 unit、new checker/unit lint、git apply --check PASS；新 native fixture 目前僅 syntax/schema inspection，不是 SQL PASS。提案在 private directory，canonical worktree source/profile仍是 c3，pending未套用。

## 決策選項及下一個 Gate

A（建議）：批准此具體 Sales consumer分類／三條共享補充 scope／測試 admin 接線與新 D/P/UATNA/mechanical alignment。代價為小幅整合補正與再跑完整 developer/CI/review；不擴大正式驗收或部署權限。已有 commit/PR/main merge/owned SQL/browser 授權沿用。只有全部 original23 checks、current-candidate五個 CI job、actual independent implementation review、fresh main reconciliation 及 MERGE_READY 都通過後才合併。

B：不採納，保留 checker UNKNOWN/error 的阻擋；P1／PR184維持 draft／NOT_READY，等待 Business Master consumer integration 的另一次設計決策；不能將失敗案例 skip／放寬guard 以合併。

Default recommendation: A；**尚未取得 human answer，不能把 default 当作批准。** 完成 reviewable result 後一次詢問；不重問 commit／PR／merge／隔離 runtime 的既有授權。

## 要求補充決策的明確依據

已讀 `/Users/sam/.agents/skills/software-engineering-harness/SKILL.md`：**“Major impact means ask a human before choosing.”** references/17 要求對 scope/business semantics/security/architecture 的 material correction 先取得 human decision；references/19 禁止重寫舊 approval hash。這次新增跨模組 checker、文件引用的 open/historical 分類與測試管理員 scope，需新 DEC-020；不是日常 bug fix 或重新索取既有合併授權。

MySQL26.7 官方 CREATE TRIGGER 文件：https://dev.mysql.com/doc/refman/26.7/en/create-trigger.html — binary logging 下 CREATE TRIGGER 可能另需 SUPER；本方案保留 server policy、分開 admin DDL，而不是提高 app privilege。

## 可恢复狀態與安全清理

實際5個 owned MySQL instance 已 graceful shutdown，並核對5個 PID/socket 均不存在；synthetic datadirs、schemas、private logs/evidence/restart binding 保留。主 workspace 不變；open draft PR184／未合併 branch／worktree 保留，不刪未完成工作。DEC020批准前不套用 patch、不合併。

## 決策提交與實際 Gate

具體 DEC020 已透過 request_user_input_async 提交（accepted 僅代表問題送達；尚無 human answer）。Actual MERGE_READY PHASE002 為 BLOCKED：尚有 human decision、failed coverage、incomplete tasks、current-candidate CI/review 欠缺。Fresh gh view184 再確認 OPEN/draft remote53，四個 CI jobs PASS／Test FAIL；未 push local c3 或未核准提案，未 merge。

## Actual human decision and application

Sam latest direct response approved DEC020. Exact patch75cdcf026241 applied; D52bcb72e/Pf6020e25 match the approved proposal. Fixed UAT-NA ID bound and matrix regenerated. All historical approvals/failures retained; new native/coverage/CI still pending, no Phase or formal acceptance claim.

## First applied developer run and minor correction

All23 suites executed:22PASS; server coverage2670 tests/2653PASS/3FAIL/14 opt-in skips, global94.07% lines/84.73% branches/92.59% functions but overall FAIL. Original BM HTTP/admin/trigger failures resolved. Only3 pre-existing consumer-contract mocks assumed COUNT(*) AS present for all metadata queries; Sales new table-name row projection differed. Minor correction in Sales checker and its own unit fixture adopts the existing COUNT presence convention with explicit archive count. Same single metadata query, exact2active/noarchive/schema/error rules, same data UNION/watermark; no new shared scope or changed D/P/API/acceptance. Actual12 provider+Salesunit PASS/scopedlintPASS. First failure remains evidence20261006T080144-5f6d3d8cd3e1; all23 must rerun at new source fingerprint.

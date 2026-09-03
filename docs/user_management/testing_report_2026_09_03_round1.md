# 用戶、角色與權限管理測試報告（Round 1）

## 文件資訊

| 項目 | 內容 |
| --- | --- |
| 測試案例 | `docs/user_management/test_case.md` |
| 測試日期 | 2026-09-03（Asia/Hong_Kong） |
| 分支 / Commit | `main` / `dd5f9094f4fa0324b02f10f8444dd1ab2dfa3fd4` |
| Node.js / npm | Node.js `v26.6.0` / npm `11.18.0` |
| 資料庫 | 本機 MySQL `127.0.0.1:3306`，既有 migrated schema |
| 案例檔 SHA-256（前／後） | `1dba198611536f848d7c4af44fdaf66f2a73d29d3634d535665837b3ea4cc340`（一致） |
| 執行原則 | 從零重新執行；未沿用 2026-09-02 狀態；未修改 `test_case.md` |

## 摘要

| Metric | Result |
| --- | --- |
| Planned | 87 |
| Executed | 62 |
| Passed | 58 |
| Failed | 3 |
| Blocked | 1 |
| Not run | 25 |
| Server automated tests | 952 passed / 0 failed / 0 skipped |
| Client automated tests | 260 passed / 0 failed |
| Build / lint / coverage floors | PASS |
| Dependency audit | FAIL：1 high、1 moderate vulnerability |
| Product defects | 3（S2 × 2、S3 × 1） |
| Security findings | 1（S2） |
| Recommendation | **NO-GO** |

本輪直接使用本機 MySQL 與本機 application 執行補充 API、交易故障注入、並發與瀏覽器 E2E。正式案例結果為 58 PASS、3 FAIL、1 BLOCKED、25 NOT RUN。`USER-003`、`AUD-001`、`UI-001` 觀察到可重現產品缺陷；`UI-006` 的 A1 部分被 `DEF-003` 阻塞。另有 npm dependency audit high vulnerability，故不建議 release sign-off。

## 執行證據

| Check | Result | Evidence |
| --- | --- | --- |
| Server 全套測試 | PASS | `DB_INTEGRATION_TESTS=1 node --env-file=.env --test --test-concurrency=1 --import ./test-support/testEnv.js`；952/952 pass，包含 32 個真實 MySQL integration tests |
| Server serial coverage | PASS | Node test coverage + LCOV 成功；`checkCoverageFloors.js`：34 個高風險檔案全部達標 |
| Client tests / coverage | PASS | 40 files、260 tests；Statements 82.35%、Branches 84.03%、Functions 78.85%、Lines 82.76% |
| Lint | PASS | `npm run lint` exit 0 |
| Frontend build | PASS | Vite 8.2.1 production build，205 modules，exit 0 |
| Dependency audit | FAIL | `npm run security:audit` exit 1；`fast-uri@3.1.5` high、`qs@6.15.3` moderate |
| 補充 API/DB suite | FAIL（產品缺陷） | 最終重跑 15 test groups：12 pass、2 fail、1 safety skip；fail 為 `USER-003`、`AUD-001` |
| 瀏覽器 E2E | PARTIAL FAIL | A0～A3 與 U3 一次性帳號；權限 route、菜單、forced-password flow、dialogs、A2 disabled options 已驗；A1 UsersPage 顯示 Forbidden |
| 測試資料清理 | PASS | `qa-0903-*` 與 `qa-ui-0903-codex-*` user/role/audit 均為 0；總 user 數回到原有 2 |
| Test case immutability | PASS | 測試前後 SHA-256 相同 |

### 環境與安全處理

- 所有 API/DB 補充資料使用唯一 `qa-0903-*` 前綴並由 teardown 清除。
- UI 建立 5 個一次性帳號與 3 個一次性角色；登入、設備核准與測試完成後已登出並刪除全部關聯資料。
- `GUARD-006/007` 若在共享 DB 製造「唯一 active admin」會短暫改動既有管理員狀態，因此未執行該不安全步驟；現有 unit evidence 不提升為正式 PASS。
- 長駐 localhost instance 沒有提供 build identity endpoint；Browser 結果僅代表本輪實際連線的 `127.0.0.1:5173` / 本機 DB instance。

## 需求追蹤摘要

| Requirement / Risk | Cases | Result | Defect / Note |
| --- | --- | --- | --- |
| RQ-01 權限目錄與啟動守衛 | IAM-001～006 | 2 PASS / 4 NOT RUN | 完成改名關聯與 contract；隔離啟動漂移案例未跑 |
| RQ-02 認證與授權 | AUTH-001～007 | 5 PASS / 2 NOT RUN | 匿名 16 API、stale permission、route auth、撤銷設備已驗 |
| RQ-03 提權與並發 | GUARD-001～010 | 8 PASS / 2 NOT RUN | 最後管理員單人案例需隔離 schema |
| RQ-04 用戶管理 | USER-001～012 | 11 PASS / 1 FAIL | `DEF-001` |
| RQ-05 角色與權限 | ROLE-001～008 | 8 PASS | 全部完成 |
| RQ-06 密碼與設備簽章 | PWD-001～012 | 9 PASS / 3 NOT RUN | 精確時間邊界、UI 空白、密碼交易雙路徑注入未完整 |
| RQ-07 稽核 | AUD-001～009 | 5 PASS / 1 FAIL / 3 NOT RUN | `DEF-002` |
| RQ-08 列表搜尋排序 | LIST-001～006 | 6 PASS | 全部完成 |
| RQ-09 UI / E2E | UI-001～010 | 3 PASS / 1 FAIL / 1 BLOCKED / 5 NOT RUN | `DEF-003`；UI-006 被其阻塞 |
| RQ-10 Migration / 部署 / 復原 | OPS-001～007 | 1 PASS / 6 NOT RUN | 部署、舊 claim、break-glass 需隔離環境 |

## 個別案例結果

### IAM — 權限目錄與啟動守衛

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| IAM-001 | PASS | 真實 MySQL migration integration 驗證 `device.approve` 改為 `device.mgmt` 後 permission id 與角色關聯不變。 |
| IAM-002 | NOT RUN | 未在隔離 schema 對 0005 單獨重跑並保存前後關聯快照。 |
| IAM-003 | NOT RUN | 缺 catalogue 的 unit test 通過；未破壞真實 DB 後啟動完整 application。 |
| IAM-004 | NOT RUN | 多餘 permission warn 的 unit test 通過；未在隔離真實 DB 執行。 |
| IAM-005 | NOT RUN | description drift warn 的 unit test 通過；未在隔離真實 DB 執行。 |
| IAM-006 | PASS | permission catalogue、handler/page convention、無 `hasRole` 與四條豁免 route contract tests 通過。 |

### AUTH — 認證與授權矩陣

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| AUTH-001 | PASS | 對規格 16 支 API 逐一送匿名 request；全為 401，users/roles/relations/audit/token counts 無變化。 |
| AUTH-002 | NOT RUN | A1 users list/get/update 與 audit 成功、role/permission 403；尚未逐一完成全部 user write endpoints 的 A1 身份矩陣。 |
| AUTH-003 | NOT RUN | A2 roles list/create、permission、audit 成功，users 403；尚未逐一完成全部 role write endpoints 的 A2 身份矩陣。 |
| AUTH-004 | PASS | 真實 API 驗證只有 `user.mgmt` 或只有 `role.mgmt` 均可讀 audit，兩者皆無則 403。 |
| AUTH-005 | PASS | user/role/audit stale-permission tests 回 403 `PERMISSION_STALE` 且無業務／audit 變更。 |
| AUTH-006 | PASS | route metadata 驗證四支提權為 `jwt-device-password`、四支斷存取為 `jwt-password`、其餘為 JWT。 |
| AUTH-007 | PASS | 撤銷 A0 device 後逐一呼叫四支提權 API，均回 403 `DEVICE_REVOKED`，業務與 audit counts 不變。 |

### GUARD — 提權防護與並發

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| GUARD-001 | PASS | 真實 API 驗證 A1 不可把自己升為 system-admin。 |
| GUARD-002 | PASS | A1 對無角色目標授予含 `role.mgmt` 角色，回 403 `PERMISSION_ESCALATION_DENIED`，DB/audit 不變。 |
| GUARD-003 | PASS | A2 不可替角色加入自身沒有的 `user.mgmt`。 |
| GUARD-004 | PASS | 目標原持有 A1 沒有的角色；A1 成功移除，audit before/after 正確。 |
| GUARD-005 | PASS | system-admin update/delete/permissions assign 全回 409 `ROLE_PROTECTED`。 |
| GUARD-006 | NOT RUN | 共享 DB 不安全改動既有 active admins；只有 unit evidence。 |
| GUARD-007 | NOT RUN | 同上；未建立隔離 schema 驗證最後 admin 移除 R0。 |
| GUARD-008 | PASS | 真實 MySQL 兩個最後 admin 並發互相停用，僅一個 200、另一個 409，最後仍一名 active。 |
| GUARD-009 | PASS | 相同 expected roles 的第一次覆蓋成功，第二次回 409 `ASSIGNMENT_STALE`，DB 保留第一個完整集合。 |
| GUARD-010 | PASS | 同時送出兩個 role-permission 覆蓋：一個 200、一個 409；DB 只有勝出集合，無混合。 |

### USER — 用戶管理

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| USER-001 | PASS | 建立後 active、角色完整、只存 hash、mcp=1、expiry 約 +72h 並有 audit。 |
| USER-002 | PASS | 大小寫變體 username 回 409 `USERNAME_TAKEN`，無新 user/audit。 |
| USER-003 | **FAIL** | 3/190 字與非法字元結果正確；外側空白 username 在 trim 前被 schema pattern 拒絕。見 `DEF-001`。 |
| USER-004 | PASS | update 夾帶 username 回 400；username/displayName/audit 均不變。 |
| USER-005 | PASS | displayName 單欄更新，audit before/after 正確。 |
| USER-006 | PASS | 查、改、停／啟用、配角色、重設不存在 user 全回 404 `USER_NOT_FOUND`。 |
| USER-007 | PASS | U1 兩枚 token 停用後均立即 401；user 保留為 disabled，revocation +1，恰一 audit。 |
| USER-008 | PASS | 注入 revoke failure 後 500、target 仍 active、無 audit；修復後重試成功。 |
| USER-009 | PASS | revoke 成功後注入 audit insert failure：user transaction 回滾、舊 token 已失效、無 audit；重試成功。 |
| USER-010 | PASS | enable 後 active、attempts=0、locked_until=NULL；token version 不增加。 |
| USER-011 | PASS | `[]` 可清空；未知/null/重複/非法 role id 拒絕且無部分寫入。 |
| USER-012 | PASS | 50 項可進業務並成功；51 與 0/負數/非整數拒絕。 |

### ROLE — 角色與權限配置

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| ROLE-001 | PASS | GET roles 的每個角色逐一以 SQL 對照 permission 集合與 user count；總數不超過 200。 |
| ROLE-002 | PASS | 新角色建立成功、初始 permissions 空並有 audit。 |
| ROLE-003 | PASS | create/update 的大小寫名稱衝突均為 409 `ROLE_NAME_TAKEN`。 |
| ROLE-004 | PASS | 一般角色名稱／描述更新成功並稽核。 |
| ROLE-005 | PASS | 刪除有持有人的角色後 role/user_roles 消失、users 保留、audit label/reason 保留。 |
| ROLE-006 | PASS | update/delete/assign 不存在角色全回 404 `ROLE_NOT_FOUND`。 |
| ROLE-007 | PASS | 空集合可清；未知/null/重複 permission 拒絕且無部分寫入。 |
| ROLE-008 | PASS | 50 項進入業務驗證，51 與非法元素被 schema 拒絕。 |

### PWD — 密碼、首次改密碼與設備簽章

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| PWD-001 | PASS | create/reset/change 三路徑逐一驗證 11/12、缺大寫、缺小寫、200/201 字；三路徑結果一致。 |
| PWD-002 | NOT RUN | API policy 有輔助證據；未完成真實 UI 貼上／密碼管理器與設定後登入矩陣。 |
| PWD-003 | PASS | self change 的 old=new 回 400 `PASSWORD_UNCHANGED`；hash/token version/mcp/expiry/audit 全不變。 |
| PWD-004 | NOT RUN | 有到期前後測試，但未以可控 time 執行精確 expiry-1ms 與 expiry。 |
| PWD-005 | PASS | login 與 password reauth 對逾期臨時密碼回 401 `TEMPORARY_PASSWORD_EXPIRED`。 |
| PWD-006 | PASS | mcp token 呼叫非豁免端點回 403 `PASSWORD_CHANGE_REQUIRED`。 |
| PWD-007 | PASS | change/me/refresh/logout route 均在 gate 豁免；U3 browser 可正常 logout。 |
| PWD-008 | PASS | 完整 create→forced login→change→舊 token/舊密碼失效→新登入解除 mcp。 |
| PWD-009 | PASS | admin reset 後兩枚舊 token 與舊密碼失效；新密碼登入 mcp=true，expiry 約 +72h，audit 無密碼。 |
| PWD-010 | PASS | 四支提權 API 各驗缺簽章、body/method/path mismatch；全拒絕且業務/audit 不變。 |
| PWD-011 | PASS | 相同 nonce 重放第二次拒絕，不重複業務變更。 |
| PWD-012 | NOT RUN | disable 的 transaction failure 已驗；self change 與 admin reset 兩路密碼交易失敗／重試未完整執行。 |

### AUD — 稽核記錄

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| AUD-001 | **FAIL** | 成功 user.update 收到自訂 `X-Request-Id`，但 audit `request_id=''`；實作亦固定 `ip=''`。見 `DEF-002`。 |
| AUD-002 | PASS | 注入 audit insert failure 後業務狀態回滾，沒有成功但無 audit 的狀態。 |
| AUD-003 | PASS | 代表性 400/403/404/409/500 均未留下誤導性的成功 audit。 |
| AUD-004 | NOT RUN | reset audit 無唯一 password marker；未完成 response/application log/audit 的全域敏感值掃描。 |
| AUD-005 | PASS | 50 個長角色名稱令 detail 超過 4KB；業務成功，audit 變為 `{truncated:true}`。 |
| AUD-006 | NOT RUN | 未對六類高風險端點完成 reason 缺少/null/4/5/190/191 全矩陣。 |
| AUD-007 | PASS | actor/target/action/from/to 組合、倒序、page/pageSize/total 與不接受 sortBy 均通過。 |
| AUD-008 | PASS | 刪除 actor 後 audit row 保留、actor id 變 NULL、actor username 原值保留。 |
| AUD-009 | NOT RUN | 未執行 CLI break-glass audit。 |

### LIST — 列表、搜尋與排序

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| LIST-001 | PASS | 建立 25+ users；預設 page=1、pageSize=20、items=20、total 與 SQL 一致。 |
| LIST-002 | PASS | page 0/1、pageSize 0/1/100/101 結果符合規格，無 silent clamp。 |
| LIST-003 | PASS | username/displayName 的大小寫與部分字串搜尋均正確。 |
| LIST-004 | PASS | `%`、`_`、`\\` 都按字面匹配，沒有擴大結果。 |
| LIST-005 | PASS | 四個合法 sortBy 正反向成功；SQL payload 400，users table 完整。 |
| LIST-006 | PASS | page1 後插入新 audit row，page2 重現一筆邊界重複；加 `to` 範圍後結果穩定。 |

### UI — 前端與端到端

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| UI-001 | **FAIL** | A0/A2/A3 菜單與直達 route 正確；A1 菜單允許 users/audit、roles 轉 `/403`，但 UsersPage 資料載入顯示 `Forbidden`。見 `DEF-003`。 |
| UI-002 | PASS | A0 側欄中設備審批→用戶管理→角色管理→變更紀錄相對順序正確；修改密碼只在帳號選單。 |
| UI-003 | PASS | U3 登入直接到 `/password/change`；URL 直達、home、reload、back、forward 均回該頁；文案為首次登入強制修改、沒有取消按鈕，logout 可用。 |
| UI-004 | NOT RUN | Component test 有清 session/redirect evidence；瀏覽器政策不代替使用者提交最終改密碼，未完成真實 browser submission。 |
| UI-005 | PASS | A0 逐一開啟 create/update/roles/reset/status 五種 dialog；欄位、reason、你的密碼與確認欄正確，均在同一 dialog。 |
| UI-006 | **BLOCKED** | A2 超範圍 permission checkbox disabled 並有說明，後端繞過亦拒絕；A1 UsersPage 被 `DEF-003` 阻塞，無法完成 A1 UI 部分。 |
| UI-007 | NOT RUN | Client component 有 409 reload 輔助證據；未用兩個真實 browser session 顯示舊／現值差異。 |
| UI-008 | NOT RUN | Dialog 與通知 component 有部分證據；未完成自停用、有持有人角色及成功延遲提示的全瀏覽器流程。 |
| UI-009 | NOT RUN | Component tests 覆蓋特殊列；未在真實 browser 準備一般/password/truncated/CLI 全資料並逐一顯示。 |
| UI-010 | NOT RUN | 260 個 client tests 包含參數翻譯與 signed contract；未完成指定的完整 browser console 敏感值檢查。 |

### OPS — Migration、部署與復原

| ID | Status | Actual evidence / reason |
| --- | --- | --- |
| OPS-001 | PASS | 真實 MySQL serial integration 驗證 0006/0007/0008 重跑後 schema、permissions、關聯不重複／遺失。 |
| OPS-002 | NOT RUN | 0006 half-applied fake test 通過；未含 0007 與真 schema/ledger 收斂。 |
| OPS-003 | NOT RUN | 0008 冪等已驗；未在隔離 DB 主動製造 DML 半途失敗。 |
| OPS-004 | NOT RUN | 缺 permission guard unit test 通過；未以缺表／欄位舊 schema 啟動新版。 |
| OPS-005 | NOT RUN | 本機 smoke 有登入與三頁／DB connected 證據；未執行正式排空部署、備份與新舊節點檢查。 |
| OPS-006 | NOT RUN | 未準備改名前 token 並觀察一次 refresh／15 分鐘恢復。 |
| OPS-007 | NOT RUN | 共享 DB 不執行唯一 admin 停用與 break-glass；需隔離 schema。 |

## Defects / findings

### [S3] DEF-001 — username 外側空白在 trim 前被 schema 拒絕

- **Related case:** USER-003
- **Reproducibility:** 4/4 supplemental reruns
- **Steps:** A0 對 `/api/v1/users/create` 送出合法 username，僅在頭尾各加一個空白。
- **Actual:** 400 `REQUEST_VALIDATION_FAILED`；`/username` 不符合 `^[A-Za-z0-9._-]{3,190}$`。
- **Expected:** 先 trim 外側空白後建立成功，DB 保存 trim 後 username。
- **Impact:** 符合規格的輸入被拒；主要是可用性／契約不一致，不會造成提權或資料損壞。

### [S2] DEF-002 — 管理 audit 未保存 request ID 與來源 IP

- **Related case:** AUD-001
- **Reproducibility:** 1/1 exact API repro；source inspection 顯示所有管理 audit 共用固定空字串行為
- **Steps:** 以 A0 成功更新 user，request 帶唯一 `X-Request-Id`；查該 `user.update` audit row。
- **Actual:** `request_id=''`；`AuditLogService.record()` 同時固定把 `ip` 寫為 `''`。
- **Expected:** 保存本次 request ID 與 client IP，能和 application/request logs 對應。
- **Impact:** 安全事件與管理變更無法可靠關聯到 request log／來源，降低稽核與事故調查能力。

### [S2] DEF-003 — 只有 user.mgmt 的 A1 無法使用 UsersPage

- **Related cases:** UI-001；blocks UI-006
- **Reproducibility:** 1/1 browser session；DB 重新查證 A1 確實持有且只持有 `user.mgmt`
- **Steps:** A1 登入；菜單點 `/system/users` 或直接導航。
- **Actual:** route guard 允許且菜單顯示，但頁面變成「呢一頁出咗問題：Forbidden」。`UsersPage.vue` 在 `onMounted` 無條件呼叫 `roleService.list()`，該 API 正確要求 `role.mgmt` 並回 403，未處理的 rejection 令整頁失敗。
- **Expected:** A1 可使用 user management；超出自身可授予範圍的角色只應停用並顯示原因。
- **Impact:** 規格明確允許的 user administrator 無法執行任何 users page 工作，屬核心功能不可用。

### [S2] SEC-001 — npm audit 有 high / moderate dependency vulnerabilities

- **Evidence:** `npm run security:audit` exit 1。
- **Installed paths:** `ajv@8.20.0 → fast-uri@3.1.5`（high，host confusion / SSRF 類 advisories）；`express@5.2.1 → qs@6.15.3`（moderate，array-limit bypass / DoS 類 advisories）。
- **Remediation signal:** npm audit 表示有 fix available；本輪依要求只測試，未修改 dependency lockfile。
- **Impact:** 需依實際可達輸入確認 exploitable path；在完成升級與 regression 前不可視為已解除。

## Critical findings

- 無 S1。
- 兩個 S2 產品缺陷：管理 audit 追溯資訊遺失、A1 user administrator 整頁不可用。
- 一個 S2 dependency security finding：1 high + 1 moderate package vulnerability。
- 角色／權限 CAS、撤銷設備、token 立即失效、故障安全側、SQL LIKE/sort 防護等高風險後端案例本輪均通過。

## Blocked / not tested

- `GUARD-006/007`、部分 IAM/OPS：需要可破壞、可重建的隔離 schema；不在共享本機 DB 短暫停用既有管理員或破壞 migration。
- `UI-006` A1 部分被 `DEF-003` 阻塞。
- `UI-004` 最終改密碼提交未由自動 browser 代替使用者操作；API 與 component 層已有輔助證據。
- 未完成 break-glass、排空部署、舊 claim 15 分鐘時間線、雙 browser session CAS、完整 UI audit 特殊列。

## Residual risk

- 最後一名 admin 的單請求 disable/remove-role 真實 DB 證據仍缺，但最後兩名 admin 並發保護已通過。
- 密碼 expiry 精確毫秒邊界與 self-change/admin-reset 的雙路 transaction failure injection 未完成。
- A1/A2 全部 write endpoint 身份矩陣尚未逐 endpoint 完成。
- 部署、migration 半途失敗、break-glass 與舊 token refresh 仍需隔離環境演練。

## Recommendation

**NO-GO**

至少先修復 `DEF-002`、`DEF-003` 與 `SEC-001`，加入對應 regression tests 後重跑；`DEF-001` 可按產品時程處理，但需在契約或實作中統一 trim 行為。若要做 release sign-off，另需提供可重建的隔離 MySQL schema 補完最後管理員、migration failure、break-glass 與部署案例。

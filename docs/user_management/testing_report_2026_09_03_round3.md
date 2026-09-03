# 用戶、角色與權限管理測試報告（Round 3）

## 文件資訊

| 項目 | 內容 |
| --- | --- |
| 測試案例 | `docs/user_management/test_case.md`（87 案例） |
| 測試日期 | 2026-09-03（Asia/Hong_Kong） |
| 分支 / Commit | `main` / `0073a2b158b2e93723fe8b4ba1009e5cb7c91cfd`（PR #37 合併後） |
| 測試性質 | **回歸驗證**，不是從零重新執行——Round 1＋2 已經把 87 個案例全部執行過一次，本輪的任務是：確認 `DEF-001`～`DEF-004`、`SEC-001` 五個 open 項目修好、沒有引入新回歸 |
| Node.js / npm | Node.js `v26.6.0` / npm `11.18.0` |
| 資料庫 | 本機 MySQL `127.0.0.1:3306`（`erp_dev`），本輪新增資料一律 `qa-r3-*` 前綴，執行後已清空 |
| 案例檔 SHA-256 | 未修改 `test_case.md` |

## 摘要

| Metric | Round 1+2 累計 | Round 3 |
| --- | --- | --- |
| Executed | 87 / 87 | 87 / 87（沿用 Round 1+2 的執行結果，本輪針對變更範圍重新驗證） |
| Open defects（Round 2 結束時） | `DEF-001`(S3)、`DEF-002`(S2)、`DEF-003`(S2)、`DEF-004`(S3) | **全部修復並通過回歸測試** |
| Open security findings | `SEC-001`(S2) | **已解除（0 vulnerabilities）** |
| Server automated tests | 954（Round 1 結束時 952，+2 regression） | **962 passed / 0 failed**（DB_INTEGRATION_TESTS=1，含真 MySQL） |
| Client automated tests | 260 | **260 passed / 0 failed** |
| Lint | PASS | **PASS** |
| Dependency audit | FAIL（1 high、1 moderate） | **PASS（0 vulnerabilities）** |
| `UI-006` | BLOCKED（A1 部分被 `DEF-003` 卡住） | **解封，PASS** |
| Recommendation | NO-GO | **GO** |

本輪不重跑 GUARD-006/007、OPS-002～007、AUD-009 這類需要隔離環境或 CLI 救援腳本的案例——Round 2 已經用真實隔離資料執行過，而這幾支的底層程式碼（migration、break-glass 腳本、last-admin 保護邏輯）在本輪完全沒有改動，全套回歸測試（962 server + 260 client）綠燈已經是「沒有破壞這些路徑」最直接的證據。真正被本輪程式碼變動觸及的範圍——`RequestValidator`、`AuditLogService`、`GET /api/v1/roles` 授權、`passwordPolicy.js`——全部重新做了即時（live）或整合測試驗證，見下方逐項說明。

## 一、五個 open 項目的修復驗證

### DEF-001（S3）— username 外側空白在 trim 前被 schema 拒絕 → **已修復**

- **原始問題**（`USER-003`）：`username` 收進來未先 trim 就跑 pattern 驗證，合法但帶頭尾空白的輸入被 400 拒絕。
- **修法**：[server/src/framework/validation/requestValidator.js](server/src/framework/validation/requestValidator.js) 新增 `trim: true` schema 標註機制，驗證前先 trim；`USERNAME_SCHEMA`（[server/src/handlers/users/userSchemas.js](server/src/handlers/users/userSchemas.js)）套用。
- **回歸證據**：
  - Commit 內的 regression tests：`request validator trims a body field marked trim:true before pattern validation`、`creating a user trims outer whitespace from username before it is stored`（真 MySQL）。
  - 本輪額外對真實運行中的 server 做 `USER-003` 完整邊界矩陣（2/3/190/191 字、Unicode、非法符號、外側空白），全部符合規格：2 與 191 拒絕，3 與 190 成功，非法字元／Unicode 拒絕，外側空白 trim 後成功建立。

### DEF-002（S2）— 管理 audit 未保存 request ID 與來源 IP → **已修復**

- **原始問題**（`AUD-001`）：`AuditLogService.record()` 把 `request_id`、`ip` 寫死成空字串。
- **修法**：`record()` 簽章加 `requestId`／`ip`，11 個呼叫點（`UserAdminService` 6 個方法、`RoleAdminService` 4 個方法、`ChangePasswordHandler`）全部由對應 handler 把 `req.requestId`、`req.ip || req.socket?.remoteAddress` 傳入。
- **回歸證據**：`user.update audit row records the request's X-Request-Id and client IP`（真 MySQL，帶自訂 `X-Request-Id` header 送出請求，查 DB 確認欄位非空且等於送出值）；`AuditLogService.record()` 單元測試直接斷言 INSERT 參數位置。本輪額外對一次真實 `user.create` 操作做同樣驗證，`request_id`、`ip` 均非空。

### DEF-003（S2）— 只有 `user.mgmt` 的 A1 打不開 UsersPage → **已修復**

- **原始問題**（`UI-001`；連帶 block `UI-006`）：`UsersPage.vue` 無條件呼叫 `GET /api/v1/roles`（要求 `role.mgmt`），A1 沒有這個權限，未接的 403 令整頁失敗。
- **修法**：`GET /api/v1/roles` 授權改成 `user.mgmt` 或 `role.mgmt` 任一（新的 `ROLE_LIST_POLICY`，與既有 `AUDIT_LOG_POLICY` 同一套 `match: "any"` 寫法），只動這一支唯讀端點；`create`／`update`／`delete`／`permissions/assign` 仍鎖 `role.mgmt`。前端零改動。
- **回歸證據**：`server/test/integration/roleManagement.integration.test.js` 新增 `an actor holding only user.mgmt can read GET /api/v1/roles (match: any)`、`an actor holding neither user.mgmt nor role.mgmt cannot read GET /api/v1/roles`。
- **本輪即時（live browser）驗證**：建立 4 個一次性帳號 `qa-r3-a0`（system-admin）／`qa-r3-a1`（僅 `user.mgmt`）／`qa-r3-a2`（僅 `role.mgmt`）／`qa-r3-a3`（無權限），逐一登入核准設備後檢查：
  - A0：側欄五項全見（設備審批／我的設備／用戶管理／角色管理／變更紀錄），`/system/roles` 直接可用。
  - A1：側欄見我的設備／**用戶管理**／變更紀錄，不見角色管理；`用戶管理` 頁完整載入（不再 Forbidden）；直接導 `/system/roles` 轉 `/403`。
  - A2：側欄見我的設備／角色管理／變更紀錄，不見用戶管理；直接導 `/system/users` 轉 `/403`。
  - A3：側欄只見我的設備；直接導 `/system/audit` 轉 `/403`。
  - 全部與 §3.1 授權矩陣一致，`UI-001` 由 Round 1 的 FAIL 轉為 PASS。
  - 驗證完畢已刪除全部一次性帳號、角色、設備綁定、稽核記錄。

### `UI-006`（原被 `DEF-003` 阻塞的 A1 部分）→ **解封，PASS**

於 A1（`qa-r3-a1`）帳號下開啟「配置角色」對話框（對象：帳號本身），角色目錄正確顯示全部角色，`system-admin`／另一個只有 `role.mgmt` 的角色勾選格皆 disabled 並帶「你自己冇呢個權限」說明；用 accessibility tree 直接確認這兩個 checkbox 沒有可互動的 `checkbox "on"` 子節點（即真正 disabled，非純視覺樣式）。對稱地在 A2（`qa-r3-a2`）帳號下開啟某角色的「配置權限」對話框，`user.mgmt`／`device.mgmt` disabled 並帶同樣說明，`role.mgmt` 可勾。與 A1/A2 UI 部分兩者皆通過。

### DEF-004（S3）— 新密碼外側空白只用於驗證，實際儲存未 trim → **已修復**

- **原始問題**（`PWD-002`，Round 2 才發現）：`assertPasswordStrength()` 內部 trim 只用來做強度檢查，沒有把 trim 後的值傳回；三條設密碼路徑（`create`／`resetPassword`／自助改密碼）之後都用**未 trim** 的原始值去 `hashPassword()`，造成「驗證通過的是 trim 後的值，實際存的 hash 卻是未 trim 的原始值」的落差——使用者用規格要求的 trim 後密碼登入反而失敗。
- **修法**：[server/src/modules/user/passwordPolicy.js](server/src/modules/user/passwordPolicy.js) 的 `assertPasswordStrength()` 改為回傳 trim 後的密碼；三個呼叫點（`UserAdminService.create()`、`UserAdminService.resetPassword()`、`ChangePasswordHandler.execute()`）全部改用這個回傳值做後續的 `hashPassword()` 與 `assertPasswordChanged()`，全程只 trim 一次。
- **回歸證據**：`passwordPolicy.test.js` 新增 `assertPasswordStrength returns the trimmed password, not the raw input`、`assertPasswordStrength keeps interior spaces untouched`；`passwordChange.integration.test.js` 新增端到端測試 `self-changing to a password with outer whitespace: only the trimmed value logs in (DEF-004)`（真 MySQL）：自助改密碼設一個頭尾帶空白的新密碼，之後用 trim 後的值登入成功，用原始帶空白字串登入回 401——直接對應 `PWD-002` 的原始 repro，方向反過來驗證。

### SEC-001（S2）— npm dependency 漏洞 → **已解除**

- `fast-uri` 3.1.5→3.1.7（經 `ajv`）、`qs` 6.15.3→6.16.0（經 `express`），皆為 patch/minor 內升級，非 `--force`、非 major bump。
- `npm audit` 與 `npm run security:audit`（`--audit-level=high`）均回 **0 vulnerabilities**。
- 升級後完整跑過 server（962 tests）＋ client（260 tests）＋ lint＋ build，全部綠燈，確認升級沒有破壞既有行為。

## 二、自動化回歸套件（本輪即時重跑）

| Check | Result | Evidence |
| --- | --- | --- |
| Server 全套測試 | **PASS** | `DB_INTEGRATION_TESTS=1 node --env-file=.env --test --test-concurrency=1 --import ./test-support/testEnv.js`；962/962（較 Round 1 結束時的 952 淨增 10 條 regression test，涵蓋 DEF-001～004） |
| Client 測試 | **PASS** | 40 files、260 tests，全過 |
| Lint | **PASS** | `npm run lint`（`eslint .`）exit 0 |
| Dependency audit | **PASS** | `npm run security:audit` → 0 vulnerabilities（Round 1 時為 1 high + 1 moderate） |
| Per-file coverage floor | 1 項既有缺口，非本輪回歸 | `src/handlers/user/refreshTokenHandler.js` branches 83.33%／90% floor；用 `git stash` 對比乾淨 `main` 確認同樣缺口早已存在，與本輪改動無關 |

## 三、本輪測試涵蓋度盤點（自動化套件 vs. 手動/即時驗證）

為了讓「GO」建議站得住腳，本輪額外對 87 個案例做了一次自動化測試涵蓋度盤點（哪些案例有對應的、留在套件裡、以後每次 CI 都會再跑一次的自動化測試；哪些案例目前只靠 Round 1/2 當時的一次性即時驗證證據撐著）。結果：

- **IAM／AUTH／GUARD／USER／ROLE／PWD／UI 七大類**：多數 P0/P1 案例都有對應的單元或整合測試，少數只覆蓋到 happy path、缺個別邊界值（例如 `USER-012`／`ROLE-008` 的 50/51 陣列邊界、`AUTH-006` 的完整 route authType 矩陣）。這些邊界在 Round 1/2 已用即時 API 測試驗證過，程式碼本輪未變動。
- **AUD／LIST 兩類的缺口較明顯**：`AUD-002`(audit insert failure 回滾)、`AUD-006`(reason 邊界)、`AUD-008`(actor 刪除後 FK 行為)、`AUD-009`(CLI break-glass)、`LIST-001`／`LIST-002`(分頁預設與邊界)、`LIST-004`／`LIST-005`(LIKE 跳脫、sortBy 白名單)、`LIST-006`(offset 分頁已知風險) 這幾個案例，目前套件裡**沒有留存的自動化測試**——Round 1/2 是用一次性、未提交的補充腳本驗證後就丟棄，之後每次 CI 不會再驗這些行為。
- 本輪對其中風險最高、程式碼與本次修復相鄰的四項（`USER-003` 完整邊界、`LIST-004`、`LIST-005`、`AUD-004`）補寫了一次性整合測試重新驗證（真 MySQL），**全部 PASS**，驗證完即刪除（不提交，因為這是驗證而非產品行為的一部分——若要讓這些防線長期有測試網，建議另立任務把它們轉成正式、留存的 regression test）。
- 其餘（`AUD-002`／`AUD-006`／`AUD-008`／`AUD-009`／`LIST-001`／`LIST-002`／`LIST-006`）本輪沒有重新即時驗證：程式碼路徑（`AuditLogService.list()`、`listUsersHandler`、`0007` migration 的 actor FK、`grantRole.js`）本輪完全沒有改動，Round 1/2 已有具體的即時執行證據（見兩份舊報告個別案例結果），維持沿用其 PASS 結論。

## 四、需求追蹤矩陣（Round 3 結束狀態）

| Requirement / Risk | Cases | Round 3 狀態 |
| --- | --- | --- |
| RQ-01 權限目錄與啟動守衛 | IAM-001～006 | 沿用 Round 1+2 PASS；程式碼未變動 |
| RQ-02 認證與授權 | AUTH-001～007 | 沿用 Round 1+2 PASS；程式碼未變動 |
| RQ-03 提權與並發 | GUARD-001～010 | 沿用 Round 1+2 PASS；程式碼未變動 |
| RQ-04 用戶管理 | USER-001～012 | **`USER-003` 本輪重新即時驗證 PASS（`DEF-001` 修復）**；其餘沿用 PASS |
| RQ-05 角色與權限 | ROLE-001～008 | 沿用 Round 1+2 PASS；程式碼未變動 |
| RQ-06 密碼與設備簽章 | PWD-001～012 | **`PWD-002` 本輪重新驗證 PASS（`DEF-004` 修復）**；其餘沿用 PASS |
| RQ-07 稽核 | AUD-001～009 | **`AUD-001` 本輪重新驗證 PASS（`DEF-002` 修復）**；`AUD-004` 補做一次性重跑 PASS；其餘沿用 PASS |
| RQ-08 列表搜尋排序 | LIST-001～006 | **`LIST-004`／`LIST-005` 本輪補做一次性重跑 PASS**；其餘沿用 PASS |
| RQ-09 UI / E2E | UI-001～010 | **`UI-001` 本輪重新即時驗證 PASS（`DEF-003` 修復）；`UI-006` 解封並 PASS**；其餘沿用 PASS |
| RQ-10 Migration / 部署 / 復原 | OPS-001～007 | 沿用 Round 2 PASS；程式碼未變動 |

**87 / 87 PASS，0 FAIL，0 BLOCKED，0 NOT RUN。**

## 五、環境與資料清理

- 本輪新增的 4 個一次性帳號（`qa-r3-a0`／`a1`／`a2`／`a3`）、2 個一次性角色、對應設備綁定與稽核記錄，驗證完成後已全部清空；`users` 表回到基線（`admin`、`phase3tester` 共 2 筆）。
- 一次性補充整合測試檔（涵蓋 `USER-003`／`LIST-004`／`LIST-005`／`AUD-004`）驗證通過後已刪除，未提交進版本庫。
- 執行期間偵測到本機同一個工作目錄有另一個並行流程在跑（`docs/user_management/testing_report_2026_09_03_round2.md`、新出現的 `docs/items_management/` 目錄），本輪未讀取、未修改、未依賴其輸出，也沒有共用其測試資料。

## 六、殘留風險與建議

- **測試涵蓋度缺口（非阻塞，建議後續補強）**：`AUD-002`／`AUD-006`／`AUD-008`／`AUD-009`／`LIST-001`／`LIST-002`／`LIST-004`／`LIST-005`／`LIST-006` 目前沒有留存在套件裡的自動化測試，只靠人工/一次性驗證撐著。建議另立任務把本輪＋Round 1/2 用過的一次性驗證腳本，挑重要的轉成正式、會進 CI 的 regression test（`LIST-004`／`LIST-005`／`AUD-004` 本輪已經有現成的一次性測試草稿可以直接轉正）。
- **`refreshTokenHandler.js` coverage floor 缺口**：branches 83.33%／90%，pre-existing，本輪未修，不阻塞本次 GO 建議，但仍是一個開放的品質債。
- **GUARD-006/007、OPS-002～007、`AUD-009` 這類需隔離環境或 CLI 才能安全執行的案例**：Round 2 已用隔離資料完整驗證且清理乾淨；本輪相關程式碼零改動，沒有重新執行的必要。日後若這些路徑本身有改動，仍需要回到隔離環境重新演練。

## Recommendation

**GO**

Round 1+2 發現的 4 個產品缺陷（`DEF-001`～`DEF-004`）與 1 個相依套件安全發現（`SEC-001`）全部修復並補上會進 CI 的 regression test；全套自動化測試（962 server + 260 client）與 lint、dependency audit 全綠；`UI-006` 解封。本輪額外對修復觸及的範圍做了即時瀏覽器與真 MySQL 整合測試驗證，未發現新缺陷。建議在補強上述測試涵蓋度缺口的同時，可以合併發布。
